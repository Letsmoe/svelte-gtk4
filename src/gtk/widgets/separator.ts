import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asOrientation } from "../attrs";
import { Widget } from "./base";

export class GtkSeparator extends Widget<Gtk.Separator> {
  static override readonly tag = "gtkseparator";

  constructor(node: SElement) {
    super(node, new Gtk.Separator());
  }

  override attr(name: string, value: unknown): boolean {
    if (name === "orientation") {
      this.widget.set_orientation(asOrientation(value));
      return true;
    }
    return super.attr(name, value);
  }
}
