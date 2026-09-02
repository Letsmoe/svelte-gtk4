import { send, subscribe } from "./connection.svelte.js";

// which monitor this webview instance is on
// Go passes ?monitor=DP-1 in the webview URL
export function monitor() {
  return (
    new URLSearchParams(window.location.search).get("monitor") ?? "default"
  );
}

// The shell surface this webview drives, from the ?view= selector the render
// host passes (absent = the default bar). Region/exclusive updates are tagged
// with it so the Go controller applies them to the right surface.
export function surfaceName() {
  return new URLSearchParams(window.location.search).get("view") ?? "bar";
}

export function toggle(name = "bar") {
  send({ type: "window", action: "toggle", name });
}

export function show(name = "bar") {
  send({ type: "window", action: "open", name });
}

export function hide(name = "bar") {
  send({ type: "window", action: "close", name });
}

// Change this surface's keyboard interactivity at runtime: "exclusive" grabs the
// keyboard (so an on-screen input can type immediately), "none" releases it.
export type KeyboardMode = "none" | "ondemand" | "exclusive";
export function setKeyboard(mode: KeyboardMode) {
  send({ type: "surface:keyboard", name: surfaceName(), mode });
}

// reserve `size` px along an edge so tiled windows avoid the bar.
// edge defaults to the top; size 0 clears the reservation.
export type ExclusiveEdge = "top" | "bottom" | "left" | "right";
export function setExclusiveZone(size: number, edge: ExclusiveEdge = "top") {
  send({ type: "window:exclusive", name: surfaceName(), edge, size });
}

// svelte action — use:surface.track on any element
// automatically sends cairo input regions whenever size/position changes
// attach to every element that should receive mouse input
const tracked = new Set<Element>();

function flush() {
  const rects = [];
  for (const el of tracked) {
    // Skip elements a missed destroy or HMR left detached: their rect is stale
    // (or zeroed) and would keep a phantom region interactive after removal.
    if (!el.isConnected) {
      tracked.delete(el);
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      continue;
    }
    rects.push({
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }
  send({ type: "window:region", name: surfaceName(), rects });
}

// Recompute and resend input regions on demand. Use after a layout change that
// ResizeObserver misses (e.g. a transform-based show/hide).
export function flushRegions() {
  flush();
}

export function track(node: Element) {
  const observer = new ResizeObserver(flush);
  observer.observe(node);
  tracked.add(node);
  flush();

  return {
    destroy() {
      observer.disconnect();
      tracked.delete(node);
      flush();
    },
  };
}

// ── surface class registry ──────────────────────────────────────────────────
// Toggleable UI surfaces register a class name and a handler; a `surface:toggle`
// broadcast carrying that class routes to the matching handler. A keybind
// (`neoshell emit surface:toggle settings`) can then target one surface by name
// without the core knowing which surfaces the frontend renders. Registration is
// kept at surface scope (not tied to a tracked element's lifecycle), so a
// surface whose visible content mounts/unmounts stays reachable.
export type SurfaceAction = "toggle" | "open" | "close";

const handlers = new Map<string, (action: SurfaceAction) => void>();

export function register(
  className: string,
  handler: (action: SurfaceAction) => void,
) {
  handlers.set(className, handler);
}

let started = false;

// ensure subscribes once; safe to call from every mounted surface.
export function ensure() {
  if (started) {
    return;
  }
  started = true;

  subscribe("surface:toggle", (data) => {
    const handler = handlers.get(data.class);
    if (handler) {
      handler(data.action);
    }
  });
}
