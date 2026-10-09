import { transform } from "esbuild";
import { readFileSync } from "node:fs";
const f = process.argv[2];
const text = readFileSync(f, "utf8");
try {
  await transform(text, { loader: f.endsWith("x") ? "tsx" : "ts" });
  console.log(`OK   ${f}  ${text.split("\n").length - 1} lines`);
} catch (err) {
  const msg = err?.errors?.map((e) => `${e.location?.line}:${e.location?.column} ${e.text}`).join(" | ") ?? String(err);
  console.log(`BAD  ${f}  ${text.split("\n").length - 1} lines :: ${msg}`);
}
