// Functions in a view's props. The host replaces each with a marker naming
// where it was, `{"$callback": "args.close"}`, and keeps the function; the
// client turns each marker back into a function that sends a callback
// message, which the host answers by calling the original with the
// arguments, as plain data. Nothing comes back: a callback is a notification.

import { CALLBACK_KEY } from "./protocol";

const MAX_DEPTH = 6;

export type Callbacks = Map<string, (...args: unknown[]) => unknown>;

/** Props as they cross to the client, and the functions taken out of them. */
export function withoutFunctions(props: Record<string, unknown>): { props: Record<string, unknown>; callbacks: Callbacks } {
  const callbacks: Callbacks = new Map();
  const plain = replaceFunctions(props, "", callbacks, 0) as Record<string, unknown>;
  return { props: plain, callbacks };
}

function replaceFunctions(value: unknown, path: string, callbacks: Callbacks, depth: number): unknown {
  if (typeof value === "function") {
    callbacks.set(path, value as (...args: unknown[]) => unknown);
    return { [CALLBACK_KEY]: path };
  }
  if (typeof value !== "object" || value === null || depth > MAX_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => replaceFunctions(item, joined(path, String(index)), callbacks, depth + 1));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = replaceFunctions(item, joined(path, key), callbacks, depth + 1);
  }
  return copy;
}

function joined(path: string, key: string): string {
  if (path === "") {
    return key;
  }
  return `${path}.${key}`;
}

/** The client's side: every marker in `value` becomes a function calling `call(name, args)`. */
export function withCallbacks(value: unknown, call: (name: string, args: unknown[]) => void, depth = 0): unknown {
  if (typeof value !== "object" || value === null || depth > MAX_DEPTH) {
    return value;
  }
  const name = markerName(value);
  if (name !== null) {
    return (...args: unknown[]) => call(name, args);
  }
  if (Array.isArray(value)) {
    return value.map((item) => withCallbacks(item, call, depth + 1));
  }
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = withCallbacks(item, call, depth + 1);
  }
  return copy;
}

function markerName(value: object): string | null {
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== CALLBACK_KEY) {
    return null;
  }
  const name = (value as Record<string, unknown>)[CALLBACK_KEY];
  if (typeof name !== "string") {
    return null;
  }
  return name;
}
