// What a client may draw. The default refuses everything that reaches
// outside the client's own subtree: windows, stylesheet text, files, widget
// objects, and names in the display-wide id registry, which it rewrites into
// the client's own namespace instead.

import { isKnownTag } from "../gtk/widgets";

export const REFUSED = Symbol("refused");

export interface Limits {
  nodes: number;
  depth: number;
  textLength: number;
  listenersPerNode: number;
  opsPerBatch: number;
}

export interface Policy {
  limits: Limits;
  allowsTag(tag: string): boolean;
  /** The value to apply, possibly changed, or REFUSED. */
  attribute(tag: string, name: string, value: unknown): unknown;
  allowsEvent(tag: string, type: string): boolean;
  allowsCall(tag: string, method: string): boolean;
}

export const DEFAULT_LIMITS: Limits = {
  nodes: 5000,
  depth: 64,
  textLength: 10000,
  listenersPerNode: 16,
  opsPerBatch: 20000,
};

// Top-level surfaces belong to the host; the others draw through a callback
// or open files.
const REFUSED_TAGS = new Set([
  "gtkwindow",
  "gtkdrawingarea",
  "gtkvideo",
  "gtkgraphicsoffload",
  "gtkwindowcontrols",
  "gtkwindowhandle",
]);

// `css` becomes a display-wide stylesheet rule; the rest name files, take
// GObjects, or hand files to a drag.
const REFUSED_ATTRIBUTES = new Set([
  "css",
  "file",
  "filename",
  "resource",
  "uri",
  "paintable",
  "gicon",
  "monitor",
  "lock",
  "drag-files",
]);

// Attributes whose value is a name in gtk/registry.ts.
const REGISTRY_ATTRIBUTES = new Set(["id", "stack", "group", "capture"]);

// Sizes a client sets, clamped so a typo cannot ask GTK for a gigantic
// allocation.
const GEOMETRY = /^(width|height|min-width|min-height|spacing|row-spacing|column-spacing|margin(-.*)?|pixel-size|width-chars|max-width-chars)$/;
const MAX_GEOMETRY = 8192;

const ALLOWED_CALLS = new Set(["grab_focus"]);

/** The default policy; `namespace` keeps the client's registry ids apart from everyone else's. */
export function defaultPolicy(namespace: string): Policy {
  return {
    limits: DEFAULT_LIMITS,
    allowsTag: (tag) => isKnownTag(tag) && !REFUSED_TAGS.has(tag),
    attribute: (_tag, name, value) => checkedAttribute(namespace, name, value),
    allowsEvent: (_tag, type) => type.length > 0 && type.length < 64,
    allowsCall: (_tag, method) => ALLOWED_CALLS.has(method),
  };
}

function checkedAttribute(namespace: string, name: string, value: unknown): unknown {
  if (REFUSED_ATTRIBUTES.has(name) || name.startsWith("on") || !isPlain(value)) {
    return REFUSED;
  }
  if (REGISTRY_ATTRIBUTES.has(name) && typeof value === "string" && value !== "") {
    return `${namespace}/${value}`;
  }
  if (typeof value === "number" && GEOMETRY.test(name)) {
    return Math.max(-MAX_GEOMETRY, Math.min(MAX_GEOMETRY, value));
  }
  return value;
}

// Strings, numbers, booleans, null, and lists of them.
function isPlain(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => item === null || typeof item !== "object");
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return typeof value === "string" || typeof value === "boolean";
}
