import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { Bin } from "./base";

/**
 * A disclosure triangle over one child. The heading is the `label` attribute,
 * not text content — text content would be the child.
 */
export class GtkExpander extends Bin<Gtk.Expander> {
  static override readonly tag = "gtkexpander";

  constructor(node: SElement) {
    super(node, new Gtk.Expander());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "label":
        this.widget.set_label(value === null ? null : asString(value));
        return true;
      case "expanded":
        this.widget.set_expanded(asBool(value));
        return true;
      case "markup":
        this.widget.set_use_markup(asBool(value));
        return true;
      case "resize-toplevel":
        this.widget.set_resize_toplevel(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
