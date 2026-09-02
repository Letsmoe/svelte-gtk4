import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { resolve } from "../registry";
import { Bin } from "./base";

/**
 * A slide-down bar around a search entry. `capture` names — by `id` — the
 * widget whose keystrokes should open it, which is normally the window.
 */
export class GtkSearchBar extends Bin<Gtk.SearchBar> {
  static override readonly tag = "gtksearchbar";

  constructor(node: SElement) {
    super(node, new Gtk.SearchBar());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "search":
        this.widget.set_search_mode(asBool(value));
        return true;
      case "close-button":
        this.widget.set_show_close_button(asBool(value));
        return true;
      case "capture":
        resolve(asString(value), (widget) =>
          this.widget.set_key_capture_widget(widget),
        );
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
