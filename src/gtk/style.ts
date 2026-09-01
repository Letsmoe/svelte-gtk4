import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../dom/nodes";

// GTK4 has no per-widget style context to write into, so an inline `css`
// attribute becomes a display-wide provider scoped to a class only this node
// carries. It is registered one step above the app stylesheet so it wins
// against rules of equal specificity no matter which loaded first.
const INLINE_PRIORITY = Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1;

const applied = new WeakMap<SElement, string[]>();
let nextId = 0;

export function applyClasses(node: SElement, value: unknown): void {
  const wanted = splitClasses(value);
  const current = applied.get(node);

  if (current !== undefined) {
    for (const name of current) {
      if (!wanted.includes(name)) {
        node.widget.remove_css_class(name);
      }
    }
  }
  for (const name of wanted) {
    node.widget.add_css_class(name);
  }
  applied.set(node, wanted);
}

export function applyInlineCss(node: SElement, value: unknown): void {
  const display = Gdk.Display.get_default();
  if (display === null) {
    return;
  }
  if (node.cssProvider !== null) {
    Gtk.StyleContext.remove_provider_for_display(display, node.cssProvider);
    node.cssProvider = null;
  }
  const declarations = asDeclarations(value);
  if (declarations === "") {
    return;
  }
  if (node.cssClass === "") {
    node.cssClass = `sg-${nextId++}`;
    node.widget.add_css_class(node.cssClass);
  }

  const provider = new Gtk.CssProvider();
  loadCss(provider, `.${node.cssClass} { ${declarations} }`);
  Gtk.StyleContext.add_provider_for_display(display, provider, INLINE_PRIORITY);
  node.cssProvider = provider;
}

export function loadStylesheet(path: string): void {
  const display = Gdk.Display.get_default();
  if (display === null) {
    return;
  }
  const provider = new Gtk.CssProvider();
  provider.load_from_path(path);
  Gtk.StyleContext.add_provider_for_display(
    display,
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  );
}

function loadCss(provider: Gtk.CssProvider, css: string): void {
  // load_from_string landed in GTK 4.12; the typings still describe the older
  // byte-oriented surface.
  (provider as unknown as { load_from_string(css: string): void })
    .load_from_string(css);
}

function splitClasses(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value.split(" ").filter((name) => name.length > 0);
}

function asDeclarations(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
