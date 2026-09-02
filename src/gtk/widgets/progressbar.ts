import Gtk from "gi://Gtk?version=4.0";
import Pango from "gi://Pango";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber, asOrientation, asString } from "../attrs";
import { Widget } from "./base";
import { ELLIPSIZE } from "./enums";

export class GtkProgressBar extends Widget<Gtk.ProgressBar> {
  static override readonly tag = "gtkprogressbar";

  constructor(node: SElement) {
    super(node, new Gtk.ProgressBar());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "value":
        this.widget.set_fraction(asNumber(value, 0));
        return true;
      case "orientation":
        this.widget.set_orientation(asOrientation(value));
        return true;
      case "text":
        this.widget.set_text(value === null ? null : asString(value));
        return true;
      case "show-text":
        this.widget.set_show_text(asBool(value));
        return true;
      case "inverted":
        this.widget.set_inverted(asBool(value));
        return true;
      // How far a `pulse()` moves the block. Only matters for indeterminate
      // progress, which has to be driven by calling `pulse()` on a timer.
      case "pulse-step":
        this.widget.set_pulse_step(asNumber(value, 0.1));
        return true;
      case "ellipsize":
        this.widget.set_ellipsize(
          asEnum(ELLIPSIZE, value, Pango.EllipsizeMode.NONE),
        );
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
