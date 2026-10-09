import { transform } from "esbuild";
import { execSync } from "node:child_process";
const [,, rev, path] = process.argv;
let text;
try { text = execSync(`git show ${rev}:${path}`, { encoding: "utf8", maxBuffer: 1e8, stdio: ["ignore","pipe","ignore"] }); }
catch { console.log("MISSING"); process.exit(0); }
try {
  await transform(text, { loader: path.endsWith("x") ? "tsx" : "ts" });
  console.log(`OK ${text.split("\n").length}`);
} catch (err) {
  const msg = err?.errors?.map((e) => `${e.location?.line}:${e.location?.column} ${e.text}`).join(" | ") ?? String(err);
  console.log(`BAD ${text.split("\n").length} :: ${msg.slice(0,110)}`);
}
