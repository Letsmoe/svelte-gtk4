import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum } from "../attrs";
import { IndexedContainer } from "./base";
import { SELECTION } from "./enums";

/**
 * A vertical list of selectable rows. A plain child is wrapped in a
 * `Gtk.ListBoxRow` by GTK itself, which is what makes it selectable.
 */
export class GtkListBox extends IndexedContainer<Gtk.ListBox> {
  static override readonly tag = "gtklistbox";

  constructor(node: SElement) {
    super(node, new Gtk.ListBox());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "selection":
        this.widget.set_selection_mode(
          asEnum(SELECTION, value, Gtk.SelectionMode.SINGLE),
        );
        return true;
      case "separators":
        this.widget.set_show_separators(asBool(value));
        return true;
      case "single-click":
        this.widget.set_activate_on_single_click(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
