import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asNumber, asStrings } from "../attrs";
import { Widget } from "./base";

/**
 * A list to pick one of. The GTK widget takes a `GListModel` and a factory;
 * the useful case here is a list of strings, so `items` builds the model:
 *
 * ```svelte
 * <gtkdropdown items={["Small", "Medium", "Large"]} selected={size}
 *              onnotify::selected={(e) => (size = e.target.widget.get_selected())} />
 * ```
 *
 * There is no signal for the choice changing — watch `notify::selected`.
 */
export class GtkDropDown extends Widget<Gtk.DropDown> {
  static override readonly tag = "gtkdropdown";

  constructor(node: SElement) {
    super(node, new Gtk.DropDown());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "items":
        this.widget.set_model(Gtk.StringList.new(asStrings(value)));
        return true;
      case "selected":
        this.widget.set_selected(asNumber(value, Gtk.INVALID_LIST_POSITION));
        return true;
      case "search":
        this.widget.set_enable_search(asBool(value));
        return true;
      case "arrow":
        (this.widget as any).set_show_arrow(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
