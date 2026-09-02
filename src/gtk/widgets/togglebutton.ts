import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { resolve } from "../registry";
import { FramedButton } from "./button";

/**
 * A button that stays in. Give several the same `group` — the `id` of one of
 * them — to make them behave as radio buttons. Signal: `toggled`.
 */
export class GtkToggleButton extends FramedButton<Gtk.ToggleButton> {
  static override readonly tag = "gtktogglebutton";

  constructor(node: SElement) {
    super(node, new Gtk.ToggleButton());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "active":
        this.widget.set_active(asBool(value));
        return true;
      case "group":
        resolve(asString(value), (leader) => this.widget.set_group(leader));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
