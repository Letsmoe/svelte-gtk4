import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber, asOrientation } from "../attrs";
import { Widget } from "./base";
import { LEVEL_MODE } from "./enums";

/**
 * A level readout — volume, battery, signal. Unlike a progress bar it has its
 * own scale and styles itself from GTK's `low` / `high` / `full` offsets.
 */
export class GtkLevelBar extends Widget<Gtk.LevelBar> {
  static override readonly tag = "gtklevelbar";

  constructor(node: SElement) {
    super(node, new Gtk.LevelBar());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "value":
        this.widget.set_value(asNumber(value, 0));
        return true;
      case "min":
        this.widget.set_min_value(asNumber(value, 0));
        return true;
      case "max":
        this.widget.set_max_value(asNumber(value, 1));
        return true;
      // `discrete` draws the range as separate blocks rather than one bar.
      case "mode":
        this.widget.set_mode(
          asEnum(LEVEL_MODE, value, Gtk.LevelBarMode.CONTINUOUS),
        );
        return true;
      case "orientation":
        this.widget.set_orientation(asOrientation(value));
        return true;
      case "inverted":
        this.widget.set_inverted(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
