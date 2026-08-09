import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(projectRoot, "scripts", "run-e2e.mjs");
const nextEnvironmentPath = path.join(projectRoot, "next-env.d.ts");
const port = 3197;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function canBindPort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(
      { host: "127.0.0.1", port, exclusive: true },
      () => probe.close(() => resolve(true)),
    );
  });
}

const before = await readFile(nextEnvironmentPath);
const failureProbe = spawn(
  process.execPath,
  [runner, "--grep", "__intentional_cleanup_probe_no_test__"],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "inherit", "pipe"],
    windowsHide: true,
  },
);
let failureOutput = "";
failureProbe.stderr.setEncoding("utf8");
failureProbe.stderr.on("data", (chunk) => {
  failureOutput += chunk;
});
const [exitCode] = await once(failureProbe, "exit");
if (exitCode === 0) {
  throw new Error("The deliberate failing E2E run unexpectedly passed.");
}
if (!failureOutput.includes("Playwright failed (exit 1).")) {
  throw new Error(
    `The cleanup probe failed for an unexpected reason:\n${failureOutput}`,
  );
}

const after = await readFile(nextEnvironmentPath);
if (!before.equals(after)) {
  throw new Error(
    `next-env.d.ts changed: ${digest(before)} -> ${digest(after)}.`,
  );
}
if (!(await canBindPort())) {
  throw new Error(`Port ${port} remained occupied after the failing E2E run.`);
}

console.log(
  `Cleanup probe passed: expected exit ${exitCode}, next-env SHA-256 ${digest(after)}, port ${port} free.`,
);
