import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { resolve } from "../registry";
import { ButtonLike } from "./button";

/**
 * A checkbox, or a radio button once it is given a `group` — the `id` of
 * another check button. Signal: `toggled`.
 */
export class GtkCheckButton extends ButtonLike<Gtk.CheckButton> {
  static override readonly tag = "gtkcheckbutton";

  constructor(node: SElement) {
    super(node, new Gtk.CheckButton());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "active":
        this.widget.set_active(asBool(value));
        return true;
      case "group":
        resolve(asString(value), (leader) => this.widget.set_group(leader));
        return true;
      // Neither on nor off — the state of a "select all" over a mixed set.
      case "inconsistent":
        this.widget.set_inconsistent(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
