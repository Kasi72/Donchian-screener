import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
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
