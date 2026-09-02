// Bundles a svelte-gtk4 app into a single ESM file GJS can run. Everything a
// browser build would take for granted — the DOM, `esm-env`'s conditions, a
// TypeScript-aware Svelte preprocessor — is wired up here explicitly.

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { compile, compileModule, preprocess } from "svelte/compiler";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

const sveltePlugin = {
  name: "svelte",
  setup(build) {
    // A `.svelte.ts` module is ordinary TypeScript that may use runes, so it is
    // stripped of its types and then run through the compiler's module half —
    // the markup compiler would reject it as a component.
    build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const { code } = await transpileScript({
        content: source,
        attributes: { lang: "ts" },
      });
      const { js } = compileModule(code, {
        filename: args.path,
        generate: "client",
        dev: false,
      });
      return { contents: js.code, loader: "js" };
    });

    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const processed = await preprocess(
        source,
        { script: transpileScript },
        { filename: args.path },
      );
      const { js, warnings } = compile(processed.code, {
        filename: args.path,
        generate: "client",
        runes: true,
        dev: false,
      });
      for (const warning of warnings) {
        console.warn(`${args.path}: ${warning.message}`);
      }
      return { contents: js.code, loader: "js" };
    });
  },
};

// The Svelte compiler parses markup, not TypeScript, so `lang="ts"` blocks are
// stripped of their types first.
async function transpileScript({ content, attributes }) {
  if (attributes.lang !== "ts") {
    return { code: content };
  }
  const { code, map } = await esbuild.transform(content, {
    loader: "ts",
    target: "esnext",
    sourcemap: true,
    // A component imported only by the markup looks unused to a TypeScript
    // transform that never sees the markup, and would be dropped.
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  });
  return { code, map };
}

// The library and the app each resolve `svelte` from their own node_modules,
// and two copies of the runtime means two `active_effect` variables — every
// `$effect` then looks orphaned. Every svelte import is resolved from one
// directory instead.
function dedupeSvelte(root) {
  return {
    name: "dedupe-svelte",
    setup(build) {
      build.onResolve({ filter: /^svelte($|\/)/ }, (args) => {
        if (args.pluginData === "deduped") {
          return null;
        }
        return build.resolve(args.path, {
          kind: args.kind,
          resolveDir: root,
          pluginData: "deduped",
        });
      });
    },
  };
}

export async function build(options) {
  await esbuild.build({
    entryPoints: [options.entry],
    outfile: options.outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    // GJS runs SpiderMonkey, so it takes modern syntax but not Node builtins.
    target: "firefox115",
    conditions: ["browser", "production", "default"],
    mainFields: ["browser", "module", "main"],
    external: ["gi://*", "system", "console", "resource://*"],
    alias: {
      "@neoworks/svelte-gtk4": here("./src/index.ts"),
      "esm-env": here("./src/esm-env.ts"),
    },
    plugins: [dedupeSvelte(dirname(options.entry)), sveltePlugin],
    logLevel: "info",
  });
}
