// node scripts/build-prediction-dataset.mjs archive-directory new-output-directory [symbol-limit]
import "./register-signal-typescript.mjs";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import Papa from "papaparse";
const { replayHistoricalSignals } = await import("../lib/signals/historical-replay.ts");
const [archive, output, limitArg] = process.argv.slice(2);
if (!archive || !output) throw new Error("Provide an archive directory and NEW output directory");
const limit = limitArg === undefined ? Infinity : Number(limitArg);
if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new Error("Invalid symbol limit");
mkdirSync(dirname(resolve(output)), { recursive: true });
mkdirSync(output); // Never overwrite a prior research run.
const observations = resolve(output, "observations.jsonl");
writeFileSync(observations, "", { flag: "wx" });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const manifest = { version: "prediction-dataset-v1", generatedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingDiffSha256: hash(execFileSync("git", ["diff", "HEAD"], { encoding: "utf8" })),
  adjustmentVerification: "UNVERIFIED_ARCHIVE", universeBias: "CURRENT_UNIVERSE_SURVIVORSHIP_NOT_RESOLVED",
  status: "BUILDING", execution: { slippageBps: 10, feeBps: 10, horizon: 10 }, files: [], failures: [] };
const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
for (const file of readdirSync(archive).filter((name) => name.endsWith("_NS_OHLCV.csv")).sort().slice(0, limit)) {
  try {
    const raw = readFileSync(resolve(archive, file), "utf8");
    const parsed = Papa.parse(raw, { header: true, skipEmptyLines: "greedy" });
    if (parsed.errors.length) throw new Error("Malformed CSV");
    const candles = parsed.data.map((row) => {
      const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(row.DATE?.trim());
      if (!match || months.indexOf(match[2]) < 0) throw new Error("Invalid archive date");
      const time = Date.UTC(+match[3], months.indexOf(match[2]), +match[1], 3, 45);
      if (new Date(time).getUTCDate() !== +match[1]) throw new Error("Nonexistent archive date");
      const numbers = ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"].map((key) => {
        if (typeof row[key] !== "string" || !row[key].trim()) throw new Error(`Missing ${key}`);
        return Number(row[key]);
      });
      return { time, open: numbers[0], high: numbers[1], low: numbers[2], close: numbers[3], volume: numbers[4] };
    });
    const symbol = file.slice(0, -"_NS_OHLCV.csv".length);
    const report = await replayHistoricalSignals({ symbol }, "1d", candles, manifest.execution);
    for (const signal of report.signals) appendFileSync(observations, `${JSON.stringify({ ...signal, sourceSha256: hash(raw) })}\n`);
    manifest.files.push({ file, sha256: hash(raw), candles: candles.length, first: candles[0]?.time,
      last: candles.at(-1)?.time, signals: report.signals.length, statusCounts: report.statusCounts });
    console.log(`${symbol}: ${report.signals.length} signals (${manifest.files.length} files)`);
  } catch (error) {
    manifest.failures.push({ file, error: error instanceof Error ? error.message : String(error) });
    console.error(`${file}: rejected`);
  }
}
manifest.status = manifest.failures.length ? "PARTIAL_RESEARCH_ONLY" : "RESEARCH_ONLY";
manifest.observationsSha256 = hash(readFileSync(observations));
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
if (!manifest.files.length) throw new Error("No archive files passed validation");
