import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool } from "../attrs";
import { Widget } from "./base";

/**
 * Signals: `state-set`, fired with the requested state before it is applied.
 * Return true from it to take over the transition — useful when the thing
 * being switched can fail.
 */
export class GtkSwitch extends Widget<Gtk.Switch> {
  static override readonly tag = "gtkswitch";

  constructor(node: SElement) {
    super(node, new Gtk.Switch());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "active":
        this.widget.set_active(asBool(value));
        return true;
      // What the switch shows, as opposed to what it was set to.
      case "state":
        this.widget.set_state(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
