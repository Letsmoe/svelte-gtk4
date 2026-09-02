import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asString } from "../attrs";
import { resolve } from "../registry";
import { Widget } from "./base";

/** The same thing as a stack switcher, down the side. */
export class GtkStackSidebar extends Widget<Gtk.StackSidebar> {
  static override readonly tag = "gtkstacksidebar";

  constructor(node: SElement) {
    super(node, new Gtk.StackSidebar());
  }

  override attr(name: string, value: unknown): boolean {
    if (name === "stack") {
      resolve(asString(value), (stack) => this.widget.set_stack(stack));
      return true;
    }
    return super.attr(name, value);
  }
}
