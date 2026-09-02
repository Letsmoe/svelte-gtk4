import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool } from "../attrs";
import { Bin } from "./base";

/** Makes a child that cannot scroll itself scrollable. */
export class GtkViewport extends Bin<Gtk.Viewport> {
  static override readonly tag = "gtkviewport";

  constructor(node: SElement) {
    super(node, new Gtk.Viewport());
  }

  override attr(name: string, value: unknown): boolean {
    if (name === "scroll-to-focus") {
      this.widget.set_scroll_to_focus(asBool(value));
      return true;
    }
    return super.attr(name, value);
  }
}
