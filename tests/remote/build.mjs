import { fileURLToPath } from "node:url";
import { build, buildClient } from "../../build.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

for (const name of ["counter", "drag", "faulty", "garbage"]) {
  await buildClient({ entry: here(`./clients/${name}.ts`), outfile: here(`./dist/${name}.js`) });
}
await build({ entry: here("./run.ts"), outfile: here("./dist/run.js") });
