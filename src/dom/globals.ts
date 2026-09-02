// Svelte's client runtime reads `document`, `window` and the node constructors
// at module-evaluation time, so this must be the first import in any entry
// point — before anything that pulls in `svelte/internal/client`.

import GLib from "gi://GLib";
import "./parse";
import {
  SComment,
  SElement,
  SFragment,
  SNode,
  SText,
} from "./nodes";

const globals = globalThis as any;

class SMediaElement extends SElement {}

const documentElement = new SElement("html");
const head = new SElement("head");
const body = new SElement("body");
documentElement.appendChild(head);
documentElement.appendChild(body);

const fakeDocument = {
  // `IS_XHTML` is derived from this once, at import time; anything with "xml"
  // in it would switch the runtime to XHTML-compliant tag casing.
  contentType: "text/html",
  baseURI: "file:///",
  documentElement,
  head,
  body,
  activeElement: null,
  nodeType: 9,
  createElement: (tag: string) => new SElement(tag),
  createElementNS: (_ns: string, tag: string) => new SElement(tag),
  createTextNode: (data = "") => new SText(data),
  createComment: (data = "") => new SComment(data),
  createDocumentFragment: () => new SFragment(),
  importNode: (node: SNode, deep?: boolean) => node.cloneNode(deep),
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

function install(): void {
  if (globals.document !== undefined) {
    return;
  }

  globals.document = fakeDocument;
  globals.navigator = { userAgent: "gjs" };
  globals.Node = SNode;
  globals.Element = SElement;
  globals.HTMLElement = SElement;
  globals.HTMLMediaElement = SMediaElement;
  globals.Text = SText;
  globals.Comment = SComment;
  globals.DocumentFragment = SFragment;
  // `set_custom_element_data` branches on this being present; returning
  // undefined keeps it on the plain setAttribute path.
  globals.customElements = { get: () => undefined, define: () => {} };
  globals.MutationObserver = class {
    observe(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  };

  if (globals.queueMicrotask === undefined) {
    // A throwing microtask must not become an unhandled rejection of the
    // promise driving it: GJS reports those with only the main loop in the
    // stack, which names neither the callback nor its error.
    globals.queueMicrotask = (fn: () => void) => {
      void Promise.resolve().then(fn).catch(reportMicrotaskError);
    };
  }
  if (globals.requestAnimationFrame === undefined) {
    installFrameClock();
  }
  if (globals.performance === undefined) {
    globals.performance = {
      now: () => GLib.get_monotonic_time() / 1000,
    };
  }

  // GJS already defines `window` as a read-only alias of the global object, so
  // it is extended in place rather than replaced.
  define("window", {
    document: fakeDocument,
    navigator: globals.navigator,
    performance: globals.performance,
    requestAnimationFrame: globals.requestAnimationFrame,
    cancelAnimationFrame: globals.cancelAnimationFrame,
    trustedTypes: undefined,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  });
}

function reportMicrotaskError(error: unknown): void {
  console.error("svelte-gtk4: microtask failed:", error);
}

function define(name: string, value: Record<string, unknown>): void {
  try {
    Object.defineProperty(globals, name, {
      value,
      writable: true,
      configurable: true,
    });
  } catch {
    Object.assign(globals[name], value);
  }
}

// GTK drives its own frame clock per surface; a plain 60Hz timeout is enough
// for the runtime's internal scheduling, which only sequences work rather than
// painting it.
function installFrameClock(): void {
  const pending = new Map<number, number>();
  let nextHandle = 1;

  globals.requestAnimationFrame = (fn: (time: number) => void) => {
    const handle = nextHandle++;
    const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
      pending.delete(handle);
      fn(GLib.get_monotonic_time() / 1000);
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

install();
