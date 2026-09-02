import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool } from "../attrs";
import { Widget } from "./base";

export class GtkSpinner extends Widget<Gtk.Spinner> {
  static override readonly tag = "gtkspinner";

  constructor(node: SElement) {
    super(node, new Gtk.Spinner());
  }

  override attr(name: string, value: unknown): boolean {
    if (name === "spinning") {
      this.widget.set_spinning(value === null ? true : asBool(value));
      return true;
    }
    return super.attr(name, value);
  }
}
