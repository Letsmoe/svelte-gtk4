import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asNumber } from "../attrs";
import { Widget } from "./base";

/**
 * A number entry with steppers. Signal: `value-changed`.
 *
 * Range and value are written together for the same reason as `gtkscale`.
 */
export class GtkSpinButton extends Widget<Gtk.SpinButton> {
  static override readonly tag = "gtkspinbutton";

  private min = 0;
  private max = 100;
  private step = 1;
  private value = 0;

  constructor(node: SElement) {
    super(node, new Gtk.SpinButton());
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
      case "digits":
        this.widget.set_digits(asNumber(value, 0));
        return true;
      // Rejects anything that is not a number, rather than trying to parse it.
      case "numeric":
        this.widget.set_numeric(asBool(value));
        return true;
      case "wrap":
        this.widget.set_wrap(asBool(value));
        return true;
      case "snap":
        this.widget.set_snap_to_ticks(asBool(value));
        return true;
      case "climb-rate":
        this.widget.climb_rate = asNumber(value, 0);
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
