import type Gtk from "gi://Gtk?version=4.0";
import { asBool, asNumber, asString } from "../attrs";
import { Widget } from "./base";

/**
 * Everything implementing `Gtk.Editable`. Signal: `changed`, plus `activate`
 * on the ones that have it.
 *
 * ```svelte
 * <gtkentry text={query} onchanged={(e) => (query = e.target.widget.get_text())} />
 * ```
 */
export abstract class Editable<W extends Gtk.Widget = any> extends Widget<W> {
  override attr(name: string, value: unknown): boolean {
    switch (name) {
      // Writing the text back on every keystroke would move the cursor to the
      // end, so an unchanged value is left alone.
      case "text":
        this.applyText(asString(value));
        return true;
      case "editable":
        (this.widget as any).set_editable(value === null ? true : asBool(value));
        return true;
      case "width-chars":
        (this.widget as any).set_width_chars(asNumber(value, -1));
        return true;
      case "max-width-chars":
        (this.widget as any).set_max_width_chars(asNumber(value, -1));
        return true;
      case "xalign":
        (this.widget as any).set_alignment(asNumber(value, 0));
        return true;
      case "undo":
        (this.widget as any).set_enable_undo(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  // Deliberately not `setText`: that is the hook for text *content*, and an
  // entry's value is an attribute. A stray whitespace node in the template
  // would otherwise clear whatever the user had typed.
  private applyText(text: string): void {
    if ((this.widget as any).get_text() === text) {
      return;
    }
    (this.widget as any).set_text(text);
  }
}
