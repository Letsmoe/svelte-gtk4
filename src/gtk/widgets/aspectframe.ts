import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asNumber } from "../attrs";
import { Bin } from "./base";

/** Holds its child to a fixed aspect ratio. */
export class GtkAspectFrame extends Bin<Gtk.AspectFrame> {
  static override readonly tag = "gtkaspectframe";

  constructor(node: SElement) {
    super(node, new Gtk.AspectFrame());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "ratio":
        this.widget.set_ratio(asNumber(value, 1));
        return true;
      // Takes the ratio from the child's own request instead of `ratio`.
      case "obey-child":
        this.widget.set_obey_child(asBool(value));
        return true;
      case "xalign":
        this.widget.set_xalign(asNumber(value, 0.5));
        return true;
      case "yalign":
        this.widget.set_yalign(asNumber(value, 0.5));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
