import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverBundle = path.join(projectRoot, ".next", "server");
const forbiddenStrings = [
  "SCREENER_E2E_FIXTURES",
  "deterministic-v1",
  "PlaywrightFixtureMarketDataProvider",
  "playwright-fixture-provider",
  "provider-factory.e2e",
];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(target) : [target];
    }),
  );
  return nested.flat();
}

const files = await filesUnder(serverBundle);
const violations = [];
for (const file of files) {
  const contents = await readFile(file);
  for (const forbidden of forbiddenStrings) {
    if (contents.includes(Buffer.from(forbidden))) {
      violations.push(`${path.relative(projectRoot, file)}: ${forbidden}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `Canonical server bundle contains E2E fixture material:\n${violations.join("\n")}`,
  );
}

console.log(
  `Canonical bundle audit passed: ${files.length} server files, 0 fixture strings/modules.`,
);
