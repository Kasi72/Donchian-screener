// Node 24 runner: npm run backtest:replay -- input.json output.json
// Input: { symbol, timeframe, candles: [{time,open,high,low,close,volume}],
//          execution: {slippageBps, feeBps, horizon?, exitTarget?} }
import { registerHooks } from "node:module";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, next) {
    let candidate;
    if (specifier.startsWith("@/")) candidate = resolve(root, specifier.slice(2));
    else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:"))
      candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    if (candidate) {
      if (!extname(candidate) && existsSync(`${candidate}.ts`)) candidate += ".ts";
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts")) return { format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText };
    if (url === pathToFileURL(resolve(root, "lib/signals/execution-policy.json")).href)
      return { format: "module", shortCircuit: true, source: `export default ${readFileSync(fileURLToPath(url), "utf8")}` };
    return next(url, context);
  },
});

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: npm run backtest:replay -- input.json output.json");
if (existsSync(outputPath)) throw new Error("Choose a new output filename; previous reports are preserved.");
const input = JSON.parse(readFileSync(inputPath, "utf8"));
if (typeof input.symbol !== "string" || !["5m", "15m", "1h", "1d", "1wk", "1mo"].includes(input.timeframe) ||
  !Array.isArray(input.candles) || !input.execution ||
  ![input.execution.feeBps, input.execution.slippageBps].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 10000))
  throw new Error("Provide symbol, timeframe, completed raw candles, and explicit nonnegative feeBps/slippageBps.");
const { replayHistoricalSignals } = await import("../lib/signals/historical-replay.ts");
const report = await replayHistoricalSignals({ symbol: input.symbol }, input.timeframe, input.candles, input.execution);
writeFileSync(outputPath, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report.summary, null, 2));
