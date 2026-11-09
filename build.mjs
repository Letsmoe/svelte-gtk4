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

// The library's entry points, matched exactly: an alias would also rewrite
// every subpath under the package name.
const ENTRY_POINTS = {
  "@neoworks/svelte-gtk4": here("./src/index.ts"),
  "@neoworks/svelte-gtk4/client": here("./src/remote/client.svelte.ts"),
  "@neoworks/svelte-gtk4/host": here("./src/remote/index.ts"),
};

const entryPointsPlugin = {
  name: "svelte-gtk4-entry-points",
  setup(build) {
    build.onResolve({ filter: /^@neoworks\/svelte-gtk4(\/client|\/host)?$/ }, (args) => ({
      path: ENTRY_POINTS[args.path],
    }));
  },
};

export async function build(options) {
  await esbuild.build(buildOptions(options));
}

export function buildOptions(options) {
  return {
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
    // A package ships its stylesheet inside the bundle and hands the text to a
    // Gtk.CssProvider, since a GJS bundle has no file next to it to load.
    loader: { ".css": "text" },
    alias: {
      "esm-env": here("./src/esm-env.ts"),
    },
    plugins: [entryPointsPlugin, dedupeSvelte(dirname(options.entry)), sveltePlugin],
    logLevel: "info",
  };
}

/**
 * Bundles a client for the QuickJS runner: one script, no imports left. A
 * `gi://` import anywhere in it fails the build, since a client never has GTK.
 */
export async function buildClient(options) {
  await esbuild.build(clientBuildOptions(options));
}

export function clientBuildOptions(options) {
  return {
    ...buildOptions(options),
    format: "iife",
    target: "es2022",
    external: [],
  };
}
