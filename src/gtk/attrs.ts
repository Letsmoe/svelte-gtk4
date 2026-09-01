import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../dom/nodes";
import { markInput } from "./inputRegion";
import { applyClasses, applyInlineCss } from "./style";

const ALIGN: Record<string, Gtk.Align> = {
  fill: Gtk.Align.FILL,
  start: Gtk.Align.START,
  end: Gtk.Align.END,
  center: Gtk.Align.CENTER,
  baseline: Gtk.Align.BASELINE,
};

const ORIENTATION: Record<string, Gtk.Orientation> = {
  horizontal: Gtk.Orientation.HORIZONTAL,
  vertical: Gtk.Orientation.VERTICAL,
};

// Attributes every widget understands. Anything a single widget owns is
// handled by its own spec first and never reaches here.
export function applyCommon(
  node: SElement,
  name: string,
  value: unknown,
): boolean {
  const widget = node.widget as Gtk.Widget;

  switch (name) {
    case "class":
      applyClasses(node, value);
      return true;
    case "css":
      applyInlineCss(node, value);
      return true;
    case "halign":
      widget.set_halign(asAlign(value));
      return true;
    case "valign":
      widget.set_valign(asAlign(value));
      return true;
    case "hexpand":
      widget.set_hexpand(asBool(value));
      return true;
    case "vexpand":
      widget.set_vexpand(asBool(value));
      return true;
    case "width":
      widget.set_size_request(asNumber(value, -1), widget.height_request);
      return true;
    case "height":
      widget.set_size_request(widget.width_request, asNumber(value, -1));
      return true;
    case "tooltip":
      widget.set_tooltip_text(asString(value));
      return true;
    case "visible":
      widget.set_visible(value === null ? true : asBool(value));
      return true;
    case "opacity":
      widget.set_opacity(asNumber(value, 1));
      return true;
    case "margin":
      applyMargin(widget, asNumber(value, 0));
      return true;
    // Adds this widget's allocation to its layer surface's input region. Once
    // any widget on a surface asks for one, the rest of the surface stops
    // taking clicks.
    case "input":
      markInput(widget, asBool(value));
      return true;
    // Which of a parent's named positions this child occupies. Spelt `place`
    // rather than `slot` so Svelte's own slot handling never sees it.
    case "place":
      node.slotName = asString(value);
      return true;
    default:
      return false;
  }
}

function applyMargin(widget: Gtk.Widget, value: number): void {
  widget.set_margin_top(value);
  widget.set_margin_bottom(value);
  widget.set_margin_start(value);
  widget.set_margin_end(value);
}

export function asAlign(value: unknown): Gtk.Align {
  const align = ALIGN[asString(value)];
  if (align === undefined) {
    return Gtk.Align.FILL;
  }
  return align;
}

export function asOrientation(value: unknown): Gtk.Orientation {
  const orientation = ORIENTATION[asString(value)];
  if (orientation === undefined) {
    return Gtk.Orientation.HORIZONTAL;
  }
  return orientation;
}

export function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

export function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

// A bare attribute in a template arrives as the empty string, which is how
// HTML has always spelled "present, therefore true".
export function asBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined) {
    return false;
  }
  return value !== "false" && value !== "0";
}
