// The GJS clock: a monotonic `performance.now` and a frame callback, both on
// GLib. Imported before `dom/globals`, which only fills in what is still
// missing, so the DOM layer itself stays free of `gi://` imports and also runs
// in a runner that brings its own clock.

import GLib from "gi://GLib";

const globals = globalThis as any;

function monotonicMilliseconds(): number {
  return GLib.get_monotonic_time() / 1000;
}

// GTK drives its own frame clock per surface; a plain 60Hz timeout is enough
// for the runtime's internal scheduling, which only sequences work rather than
// painting it.
function installFrameClock(): void {
  const pending = new Map<number, number>();
  let nextHandle = 1;

  globals.requestAnimationFrame = (callback: (time: number) => void) => {
    const handle = nextHandle++;
    const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
      pending.delete(handle);
      callback(monotonicMilliseconds());
      return GLib.SOURCE_REMOVE;
    });
    pending.set(handle, source);
    return handle;
  };

  globals.cancelAnimationFrame = (handle: number) => {
    const source = pending.get(handle);
    if (source === undefined) {
      return;
    }
    GLib.source_remove(source);
    pending.delete(handle);
  };
}

if (globals.performance === undefined) {
  globals.performance = { now: monotonicMilliseconds };
}
if (globals.requestAnimationFrame === undefined) {
  installFrameClock();
}
