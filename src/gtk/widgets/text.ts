import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asNumber, asString } from "../attrs";
import { Editable } from "./editable";

/**
 * The bare editing widget an entry is built from — no frame, no icons, no
 * styling of its own. Use it when the surrounding chrome is yours.
 */
export class GtkText extends Editable<Gtk.Text> {
  static override readonly tag = "gtktext";

  constructor(node: SElement) {
    super(node, new Gtk.Text());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "placeholder":
        this.widget.set_placeholder_text(asString(value));
        return true;
      case "max-length":
        this.widget.set_max_length(asNumber(value, 0));
        return true;
      case "visibility":
        this.widget.set_visibility(asBool(value));
        return true;
      case "activates-default":
        this.widget.set_activates_default(asBool(value));
        return true;
      // Asks for the width of its content rather than a fixed number of
      // characters.
      case "propagate-width":
        this.widget.set_propagate_text_width(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
