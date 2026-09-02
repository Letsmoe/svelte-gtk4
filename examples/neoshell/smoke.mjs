import { fileURLToPath } from "node:url";
import { build } from "../../build.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

await build({
  entry: here("./src/smoke.ts"),
  outfile: here("./dist/smoke.js"),
});
