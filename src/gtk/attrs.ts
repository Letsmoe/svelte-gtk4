// Attribute values arrive as whatever the template put there: a string from
// static markup, or any JavaScript value from a `{}` expression. Everything
// here turns one of those into something a GTK setter accepts.

import Gtk from "gi://Gtk?version=4.0";

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

export function asAlign(value: unknown): Gtk.Align {
  return asEnum(ALIGN, value, Gtk.Align.FILL);
}

export function asOrientation(value: unknown): Gtk.Orientation {
  return asEnum(ORIENTATION, value, Gtk.Orientation.HORIZONTAL);
}

/** Looks a spelling up in a table of GTK enum members. */
export function asEnum<T>(
  table: Record<string, T>,
  value: unknown,
  fallback: T,
): T {
  const member = table[asString(value)];
  if (member === undefined) {
    return fallback;
  }
  return member;
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

/** An array from an expression, or a whitespace/comma separated attribute. */
export function asStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(asString);
  }
  return asString(value)
    .split(/[\s,]+/)
    .filter((item) => item.length > 0);
}

export function asFunction(value: unknown): ((...args: any[]) => any) | null {
  if (typeof value === "function") {
    return value as (...args: any[]) => any;
  }
  return null;
}
