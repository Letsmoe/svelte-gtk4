import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber, asOrientation } from "../attrs";
import { Widget } from "./base";
import { POSITION } from "./enums";

/**
 * A slider. Signal: `value-changed`.
 *
 * The range and the value go through separate setters, and GTK clamps the
 * value to whatever range is in place at the time. Attributes arrive in
 * template order, so all four are kept and written together — otherwise
 * `value={80} max={100}` would clamp to the default range's 0 first.
 */
export class GtkScale extends Widget<Gtk.Scale> {
  static override readonly tag = "gtkscale";

  private min = 0;
  private max = 100;
  private step = 1;
  private value = 0;

  constructor(node: SElement) {
    super(node, new Gtk.Scale());
    this.sync();
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "min":
        this.min = asNumber(value, 0);
        this.sync();
        return true;
      case "max":
        this.max = asNumber(value, 100);
        this.sync();
        return true;
      case "step":
        this.step = asNumber(value, 1);
        this.sync();
        return true;
      case "value":
        this.value = asNumber(value, 0);
        this.sync();
        return true;
      case "orientation":
        this.widget.set_orientation(asOrientation(value));
        return true;
      case "digits":
        this.widget.set_digits(asNumber(value, 1));
        return true;
      case "draw-value":
        this.widget.set_draw_value(asBool(value));
        return true;
      case "value-position":
        this.widget.set_value_pos(
          asEnum(POSITION, value, Gtk.PositionType.TOP),
        );
        return true;
      // Fills the trough up to the handle. Right for a volume slider, wrong
      // for a balance one.
      case "origin":
        this.widget.set_has_origin(asBool(value));
        return true;
      case "inverted":
        this.widget.set_inverted(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  private sync(): void {
    this.widget.set_range(this.min, this.max);
    this.widget.set_increments(this.step, this.step * 10);
    this.widget.set_value(this.value);
  }
}
