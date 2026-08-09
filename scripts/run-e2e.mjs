import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const playwrightBin = path.join(
  projectRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const nextEnvironmentPath = path.join(projectRoot, "next-env.d.ts");
const host = "127.0.0.1";
const port = 3197;
const e2eBuildEnvironment = "isolated-v1";
const fixtureEnvironment = "deterministic-v1";

const activeChildren = new Set();
let receivedSignal;

function startNode(args, environment) {
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  return child;
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  const [code, signal] = await once(child, "exit");
  return { code, signal };
}

async function runNode(args, environment, label) {
  const child = startNode(args, environment);
  const result = await waitForExit(child);
  if (result.code !== 0) {
    throw new Error(
      `${label} failed (${result.signal ?? `exit ${String(result.code)}`}).`,
    );
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exitPromise = waitForExit(child);
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exitPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

function canBindPort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function waitForPortFree(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canBindPort()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Port ${port} was not released.`);
}

async function waitForServer(server, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error("The E2E server exited before becoming ready.");
    }
    try {
      const response = await fetch(`http://${host}:${port}/`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The E2E server did not become ready.");
}

async function readNextEnvironmentBackup() {
  try {
    return { existed: true, bytes: await readFile(nextEnvironmentPath) };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { existed: false, bytes: undefined };
    }
    throw error;
  }
}

async function restoreNextEnvironment(backup) {
  if (backup.existed) {
    await writeFile(nextEnvironmentPath, backup.bytes);
  } else {
    await rm(nextEnvironmentPath, { force: true });
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    receivedSignal = signal;
    for (const child of activeChildren) {
      child.kill("SIGTERM");
    }
  });
}

const backup = await readNextEnvironmentBackup();
const baseEnvironment = { ...process.env, E2E_BUILD: e2eBuildEnvironment };
delete baseEnvironment.SCREENER_E2E_FIXTURES;
let server;
let failure;

try {
  await waitForPortFree(1_000);
  await runNode([nextBin, "build"], baseEnvironment, "Isolated E2E build");

  server = startNode(
    [nextBin, "start", "--hostname", host, "--port", String(port)],
    {
      ...baseEnvironment,
      SCREENER_E2E_FIXTURES: fixtureEnvironment,
    },
  );
  await waitForServer(server);

  await runNode(
    [playwrightBin, "test", ...process.argv.slice(2)],
    process.env,
    "Playwright",
  );
} catch (error) {
  failure = error;
} finally {
  for (const child of [...activeChildren]) {
    await stopChild(child);
  }
  try {
    await restoreNextEnvironment(backup);
    await waitForPortFree();
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError([failure, cleanupError], "E2E run and cleanup failed.")
      : cleanupError;
  }
}

if (receivedSignal) {
  process.kill(process.pid, receivedSignal);
} else if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
