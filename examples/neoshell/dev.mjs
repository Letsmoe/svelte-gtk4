// Rebuilds the shell on every source change and restarts it. GJS has no hot
// module replacement, so a restart is the reload; a build with errors leaves
// the running shell alone. `style.css` is loaded at startup rather than
// bundled, so a change to it restarts the shell without a rebuild.

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { buildOptions } from "../../build.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

const layerShellLibrary = "/usr/lib/libgtk4-layer-shell.so";
const stylesheetDebounceMilliseconds = 100;

let shell = null;
let restartQueued = false;
let stylesheetTimer = null;

const restartOnBuild = {
  name: "restart-shell",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        return;
      }
      restartShell();
    });
  },
};

const options = buildOptions({
  entry: here("./src/main.ts"),
  outfile: here("./dist/neoshell.js"),
});
options.plugins.push(restartOnBuild);

const context = await esbuild.context(options);
await context.watch();

// Editors save by replacing the file, which ends a watch on the file itself,
// so the directory is watched instead.
watch(here("."), (_eventType, filename) => {
  if (filename !== "style.css") {
    return;
  }
  clearTimeout(stylesheetTimer);
  stylesheetTimer = setTimeout(restartShell, stylesheetDebounceMilliseconds);
});

process.on("SIGINT", stopShellAndExit);
process.on("SIGTERM", stopShellAndExit);

function stopShellAndExit() {
  restartQueued = false;
  if (shell !== null) {
    shell.kill("SIGTERM");
  }
  process.exit(0);
}

// The next shell waits for the previous one to exit: two at once would race
// for the bus socket and stack two sets of layer surfaces.
function restartShell() {
  if (shell === null) {
    startShell();
    return;
  }
  restartQueued = true;
  shell.kill("SIGTERM");
}

function startShell() {
  shell = spawn("gjs", ["-m", "dist/neoshell.js"], {
    cwd: here("."),
    stdio: "inherit",
    env: { ...process.env, LD_PRELOAD: preloadWithLayerShell() },
  });
  shell.on("exit", onShellExit);
}

function onShellExit() {
  shell = null;
  if (!restartQueued) {
    return;
  }
  restartQueued = false;
  startShell();
}

// gtk4-layer-shell has to be loaded before libwayland-client, which language
// bindings cannot guarantee through normal imports.
function preloadWithLayerShell() {
  const current = process.env.LD_PRELOAD;
  if (current === undefined || current === "") {
    return layerShellLibrary;
  }
  if (current.split(":").includes(layerShellLibrary)) {
    return current;
  }
  return `${current}:${layerShellLibrary}`;
}
