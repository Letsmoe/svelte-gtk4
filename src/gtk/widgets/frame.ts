import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asNumber, asString } from "../attrs";
import { Bin } from "./base";

export class GtkFrame extends Bin<Gtk.Frame> {
  static override readonly tag = "gtkframe";

  constructor(node: SElement) {
    super(node, new Gtk.Frame());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "label":
        this.widget.set_label(value === null ? null : asString(value));
        return true;
      case "label-align":
        this.widget.set_label_align(asNumber(value, 0));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
