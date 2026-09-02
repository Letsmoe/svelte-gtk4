import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { Widget } from "./base";

/** Signals: `day-selected`, `prev-month`, `next-month`, `prev-year`, `next-year`. */
export class GtkCalendar extends Widget<Gtk.Calendar> {
  static override readonly tag = "gtkcalendar";

  constructor(node: SElement) {
    super(node, new Gtk.Calendar());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      // The day/month/year properties are deprecated; the whole date goes in
      // at once as a GLib.DateTime.
      case "date":
        this.setDate(asString(value));
        return true;
      case "heading":
        this.widget.set_show_heading(asBool(value));
        return true;
      case "day-names":
        this.widget.set_show_day_names(asBool(value));
        return true;
      case "week-numbers":
        this.widget.set_show_week_numbers(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  private setDate(iso: string): void {
    const parts = iso.split("-").map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) {
      return;
    }
    const date = GLib.DateTime.new_local(parts[0], parts[1], parts[2], 0, 0, 0);
    if (date === null) {
      return;
    }
    // set_date landed in 4.14; the typings still only describe the deprecated
    // day/month/year setters.
    (this.widget as any).set_date(date);
  }
}
