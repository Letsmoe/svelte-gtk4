import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asNumber } from "../attrs";
import { Widget } from "./base";

/**
 * Children placed at explicit coordinates they carry themselves. Read at
 * insertion, so `x` and `y` have to be literals; move a child afterwards with
 * a `margin-start` / `margin-top` binding instead.
 */
export class GtkFixed extends Widget<Gtk.Fixed> {
  static override readonly tag = "gtkfixed";

  constructor(node: SElement) {
    super(node, new Gtk.Fixed());
  }

  override insert(child: SElement): void {
    this.widget.put(
      child.widget,
      asNumber(child.getAttribute("x"), 0),
      asNumber(child.getAttribute("y"), 0),
    );
  }

  override remove(child: SElement): void {
    this.widget.remove(child.widget);
  }
}
