import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool } from "../attrs";
import { Widget } from "./base";

/**
 * A bar along the bottom, with the same `place="start" | "center" | "end"`
 * layout as a header bar. It animates in and out of view with `revealed`.
 */
export class GtkActionBar extends Widget<Gtk.ActionBar> {
  static override readonly tag = "gtkactionbar";

  constructor(node: SElement) {
    super(node, new Gtk.ActionBar());
  }

  override attr(name: string, value: unknown): boolean {
    if (name === "revealed") {
      this.widget.set_revealed(value === null ? true : asBool(value));
      return true;
    }
    return super.attr(name, value);
  }

  override insert(child: SElement): void {
    if (child.slotName === "center") {
      this.widget.set_center_widget(child.widget);
      return;
    }
    if (child.slotName === "end") {
      this.widget.pack_end(child.widget);
      return;
    }
    this.widget.pack_start(child.widget);
  }

  override remove(child: SElement): void {
    if (child.slotName === "center") {
      this.widget.set_center_widget(null);
      return;
    }
    this.widget.remove(child.widget);
  }
}
