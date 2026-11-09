import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asNumber, asStrings } from "../attrs";
import { Widget } from "./base";

/**
 * A list to pick one of. The GTK widget takes a `GListModel` and a factory;
 * the useful case here is a list of strings, so `items` builds the model:
 *
 * ```svelte
 * <gtkdropdown items={["Small", "Medium", "Large"]} position={size}
 *              onnotify-selected={(e) => (size = e.target.widget.get_selected())} />
 * ```
 *
 * There is no signal for the choice changing — watch `notify::selected`,
 * written `onnotify-selected` (Svelte warns on a colon in an attribute).
 *
 * The chosen row is `position`, not `selected`: Svelte treats `selected` as an
 * HTML boolean attribute and hands over "" for any truthy number.
 */
export class GtkDropDown extends Widget<Gtk.DropDown> {
  static override readonly tag = "gtkdropdown";

  // The `position` the view asked for, kept across a change of `items`.
  private wanted: number = Gtk.INVALID_LIST_POSITION;

  constructor(node: SElement) {
    super(node, new Gtk.DropDown());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "items":
        this.replaceItems(asStrings(value));
        return true;
      case "position":
        this.wanted = asNumber(value, Gtk.INVALID_LIST_POSITION);
        this.widget.set_selected(this.wanted);
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

  // A new model selects its first row and notifies; with notifications held
  // until the wanted row is selected again, a view hears only that, and does
  // not mistake the reset for the user picking the first entry.
  private replaceItems(items: string[]): void {
    this.widget.freeze_notify();
    this.widget.set_model(Gtk.StringList.new(items));
    this.widget.set_selected(this.wanted);
    this.widget.thaw_notify();
  }
}
