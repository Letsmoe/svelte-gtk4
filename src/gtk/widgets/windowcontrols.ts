import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asEnum, asString } from "../attrs";
import { Widget } from "./base";
import { PACK } from "./enums";

/**
 * Minimise / maximise / close, on their own. What to reach for when a header
 * bar is not wanted but its buttons are.
 */
export class GtkWindowControls extends Widget<Gtk.WindowControls> {
  static override readonly tag = "gtkwindowcontrols";

  constructor(node: SElement) {
    super(node, new Gtk.WindowControls());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      // Which half of the decoration layout to draw.
      case "side":
        this.widget.set_side(asEnum(PACK, value, Gtk.PackType.START));
        return true;
      case "decoration":
        this.widget.set_decoration_layout(asString(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
