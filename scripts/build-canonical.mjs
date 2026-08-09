import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const environment = { ...process.env };
delete environment.E2E_BUILD;

const build = spawn(process.execPath, [nextBin, "build"], {
  cwd: projectRoot,
  env: environment,
  stdio: "inherit",
  windowsHide: true,
});
const [exitCode, signal] = await once(build, "exit");
if (exitCode !== 0) {
  throw new Error(`Canonical build failed (${signal ?? `exit ${String(exitCode)}`}).`);
}
