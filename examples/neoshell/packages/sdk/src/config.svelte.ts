// Reactive view of the shell config store (the Go core is the authority).
// Subscribes to the "config" topic for live updates and writes changes back with
// config:set. .svelte.ts so the runes work outside components.

import { subscribe, send } from "./connection.svelte.js";

type ConfigTree = Record<string, any>;

export const config = $state<{ value: ConfigTree }>({ value: {} });

let started = false;
function ensureStarted() {
  if (started) {
    return;
  }
  started = true;
  subscribe("config", (data) => {
    config.value = data ?? {};
  });
  send({ type: "config:get" });
}

ensureStarted();

// Write a single dotted key, e.g. setConfig("appearance.accent", "#fff").
export function setConfig(key: string, value: unknown) {
  send({ type: "config:set", key, value });
}

// Read a dotted key from the current config, returning fallback when absent.
// Called inside a template or $derived, it reacts to config changes.
export function getConfig<T>(path: string, fallback: T): T {
  let node: any = config.value;
  for (const segment of path.split(".")) {
    if (node == null || typeof node !== "object") {
      return fallback;
    }
    node = node[segment];
  }
  if (node === undefined || node === null) {
    return fallback;
  }
  return node as T;
}
