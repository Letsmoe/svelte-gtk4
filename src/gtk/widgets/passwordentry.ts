import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { Editable } from "./editable";

/** Masked input, with the caps-lock warning and undo handling GTK expects. */
export class GtkPasswordEntry extends Editable<Gtk.PasswordEntry> {
  static override readonly tag = "gtkpasswordentry";

  constructor(node: SElement) {
    super(node, new Gtk.PasswordEntry());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "placeholder":
        this.widget.placeholder_text = asString(value);
        return true;
      // The eye that reveals what was typed.
      case "peek":
        this.widget.set_show_peek_icon(asBool(value));
        return true;
      case "activates-default":
        this.widget.activates_default = asBool(value);
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
