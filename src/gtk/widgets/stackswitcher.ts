import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asString } from "../attrs";
import { resolve } from "../registry";
import { Widget } from "./base";

/**
 * A tab bar for a stack, named by that stack's `id`. Nothing guarantees the
 * stack exists yet, so the reference is resolved through the registry.
 */
export class GtkStackSwitcher extends Widget<Gtk.StackSwitcher> {
  static override readonly tag = "gtkstackswitcher";

  constructor(node: SElement) {
    super(node, new Gtk.StackSwitcher());
  }

  override attr(name: string, value: unknown): boolean {
    if (name === "stack") {
      resolve(asString(value), (stack) => this.widget.set_stack(stack));
      return true;
    }
    return super.attr(name, value);
  }
}
