import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asNumber, asString } from "../attrs";
import { Editable } from "./editable";

/**
 * An entry with a search icon and a clear button. Signals: `search-changed`
 * — debounced by `delay`, which is the point of using this over `gtkentry` —
 * plus `activate`, `next-match`, `previous-match` and `stop-search`.
 */
export class GtkSearchEntry extends Editable<Gtk.SearchEntry> {
  static override readonly tag = "gtksearchentry";

  constructor(node: SElement) {
    super(node, new Gtk.SearchEntry());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "placeholder":
        this.widget.set_placeholder_text(asString(value));
        return true;
      // Milliseconds of quiet before `search-changed` fires. 150 by default.
      case "delay":
        this.widget.set_search_delay(asNumber(value, 150));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
