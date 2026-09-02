import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asNumber, asStrings } from "../attrs";
import { Widget } from "./base";

/**
 * A button that pops a slider out — what a volume control is. `icons` is the
 * list GTK steps through as the value rises, lowest first.
 * Signal: `value-changed`.
 */
export class GtkScaleButton extends Widget<Gtk.ScaleButton> {
  static override readonly tag = "gtkscalebutton";

  // A scale button has no range of its own; it reads one off its adjustment.
  private readonly adjustment = new Gtk.Adjustment({
    lower: 0,
    upper: 100,
    step_increment: 1,
    page_increment: 10,
  });

  constructor(node: SElement) {
    super(node, new Gtk.ScaleButton());
    this.widget.set_adjustment(this.adjustment);
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "min":
        this.adjustment.set_lower(asNumber(value, 0));
        return true;
      case "max":
        this.adjustment.set_upper(asNumber(value, 100));
        return true;
      case "step":
        this.adjustment.set_step_increment(asNumber(value, 1));
        return true;
      case "value":
        this.widget.set_value(asNumber(value, 0));
        return true;
      case "icons":
        this.widget.set_icons(asStrings(value));
        return true;
      // GTK 4.14; the typings still describe the older surface.
      case "frame":
        (this.widget as any).set_has_frame(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
