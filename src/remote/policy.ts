// What a client may draw. The default refuses everything that reaches
// outside the client's own subtree: windows, stylesheet text, files, widget
// objects, and names in the display-wide id registry, which it rewrites into
// the client's own namespace instead.

import { isKnownTag } from "../gtk/widgets";
import { EMBED_TAG } from "./embed";

export const REFUSED = Symbol("refused");

/** What a policy answers to apply a different attribute than the one asked for. */
export class Rewrite {
  readonly name: string;
  readonly value: unknown;

  constructor(name: string, value: unknown) {
    this.name = name;
    this.value = value;
  }
}

export interface PolicyOptions {
  /**
   * The paintable behind a handle the host gave out, or null. A client shows
   * an image only as `handle={…}` on a picture or image, never as a file.
   */
  paintableOf?(handle: string): unknown;
}

const HANDLE_TAGS = new Set(["gtkpicture"]);

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
  /** The value to apply, possibly changed, a Rewrite, or REFUSED. */
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

// Attributes whose value is a name in gtk/registry.ts, or a carry group in
// gtk/carry.ts.
const REGISTRY_ATTRIBUTES = new Set(["id", "stack", "group", "capture", "carry", "carried-by", "banded-by"]);

// Sizes a client sets, clamped so a typo cannot ask GTK for a gigantic
// allocation.
const GEOMETRY = /^(width|height|min-width|min-height|spacing|row-spacing|column-spacing|margin(-.*)?|pixel-size|width-chars|max-width-chars)$/;
const MAX_GEOMETRY = 8192;

const ALLOWED_CALLS = new Set(["grab_focus"]);

/** The default policy; `namespace` keeps the client's registry ids apart from everyone else's. */
export function defaultPolicy(namespace: string, options: PolicyOptions = {}): Policy {
  return {
    limits: DEFAULT_LIMITS,
    allowsTag: (tag) => tag === EMBED_TAG || (isKnownTag(tag) && !REFUSED_TAGS.has(tag)),
    attribute: (tag, name, value) => {
      if (name === "handle") {
        return handleAttribute(options, tag, value);
      }
      return checkedAttribute(namespace, name, value);
    },
    allowsEvent: (_tag, type) => type.length > 0 && type.length < 64,
    allowsCall: (_tag, method) => ALLOWED_CALLS.has(method),
  };
}

// An empty or unknown handle clears the picture rather than failing: a handle
// can be released between the host publishing it and the client using it.
function handleAttribute(options: PolicyOptions, tag: string, value: unknown): unknown {
  if (!HANDLE_TAGS.has(tag) || options.paintableOf === undefined) {
    return REFUSED;
  }
  if (typeof value !== "string" || value === "") {
    return new Rewrite("paintable", null);
  }
  return new Rewrite("paintable", options.paintableOf(value));
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

// Data as JSON has it — strings, finite numbers, booleans, null, and lists
// and records of those, like a canvas's commands — within a bound on how
// much and how deep, so one attribute cannot carry an unbounded structure.
const MAX_PLAIN_ITEMS = 50_000;
const MAX_PLAIN_DEPTH = 6;

function isPlain(value: unknown): boolean {
  const budget = { items: MAX_PLAIN_ITEMS };
  return isPlainWithin(value, 0, budget);
}

function isPlainWithin(value: unknown, depth: number, budget: { items: number }): boolean {
  budget.items -= 1;
  if (budget.items < 0 || depth > MAX_PLAIN_DEPTH) {
    return false;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (!isPlainContainer(value)) {
    return false;
  }
  return Object.values(value as object).every((child) => isPlainWithin(child, depth + 1, budget));
}

function isPlainContainer(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype;
}
