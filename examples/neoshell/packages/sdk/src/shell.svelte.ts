import { subscribe, send } from "./connection.svelte.js";

let idCounter = 0;
const id = () => String(idCounter++);

// Launch a GUI application detached (fire-and-forget). The Go core spawns it in
// its own session so the compositor maps the window; use this instead of a
// hyprland dispatch, which is version-dependent.
export function launch(cmd: string) {
  send({ type: "launch", cmd });
}

// openFile opens a path in the user's default application. The path is
// single-quoted so spaces and special characters survive the core's `sh -c`.
export function openFile(path: string) {
  const quoted = "'" + path.replace(/'/g, "'\\''") + "'";
  launch("xdg-open " + quoted);
}

// run a command once, returns a promise with the output
export function exec(cmd: string) {
  return new Promise((resolve, reject) => {
    const reqId = id();

    const unsub = subscribe("run:result", (data) => {
      if (data.id !== reqId) return;
      unsub();
      if (data.error) reject(new Error(data.error));
      else resolve(data.output);
    });

    send({ type: "run", id: reqId, cmd });
  });
}

// watch a streaming command line by line
// returns { lines: $state([]), stop() }
// great for: playerctl -F status, pactl subscribe, tail -f, etc.
export function watch(cmd: string): { lines: string[] } {
  const reqId = id();
  let state = $state({ lines: [] });

  const unsub = subscribe("watch:line", (data) => {
    if (data.id !== reqId) return;
    state.lines = [...state.lines, data.line];
  });

  send({ type: "watch", id: reqId, cmd });

  const stop = () => {
    unsub();
    send({ type: "watch:stop", id: reqId });
  };

  $effect(() => () => stop());

  return state;
}

// convenience: watch but only keep latest line as a string
// const status = watchLatest('playerctl -F status')
// status.value → 'Playing'
export function watchLatest(cmd: string) {
  const reqId = id();
  let state = $state({ value: "" });

  const unsub = subscribe("watch:line", (data) => {
    if (data.id !== reqId) return;
    state.value = data.line;
  });

  send({ type: "watch", id: reqId, cmd });

  $effect(() => () => {
    unsub();
    send({ type: "watch:stop", id: reqId });
  });

  return state;
}
