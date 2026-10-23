// Lets node --test import app modules as written: "@/x" -> src/x, and
// extension-less relative imports -> .ts / .tsx / index.ts.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    for (const ext of ["", ...EXT]) {
      const file = base + ext;
      if (ext === "" && !path.extname(file)) continue;
      if (existsSync(file)) return next(pathToFileURL(file).href, context);
    }
  }
  return next(specifier, context);
}
