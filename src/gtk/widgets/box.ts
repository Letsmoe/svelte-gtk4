import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber, asOrientation } from "../attrs";
import { Container } from "./base";
import { BASELINE } from "./enums";

export class GtkBox extends Container<Gtk.Box> {
  static override readonly tag = "gtkbox";

  constructor(node: SElement) {
    super(node, new Gtk.Box());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "orientation":
        this.widget.set_orientation(asOrientation(value));
        return true;
      case "spacing":
        this.widget.set_spacing(asNumber(value, 0));
        return true;
      case "homogeneous":
        this.widget.set_homogeneous(asBool(value));
        return true;
      case "baseline":
        this.widget.set_baseline_position(
          asEnum(BASELINE, value, Gtk.BaselinePosition.CENTER),
        );
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
