import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber } from "../attrs";
import { Widget } from "./base";
import { JUSTIFY, TEXT_WRAP } from "./enums";

/**
 * Multi-line text. The content lives in a `Gtk.TextBuffer`, so anything beyond
 * plain text — tags, marks, iterators — goes through `get_buffer()` rather
 * than through attributes.
 *
 * Put it inside a `<gtkscrolledwindow>`; it does not scroll itself.
 */
export class GtkTextView extends Widget<Gtk.TextView> {
  static override readonly tag = "gtktextview";

  constructor(node: SElement) {
    super(node, new Gtk.TextView());
  }

  setText(text: string): void {
    const buffer = this.widget.get_buffer();
    if (buffer.text === text) {
      return;
    }
    buffer.set_text(text, -1);
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "editable":
        this.widget.set_editable(value === null ? true : asBool(value));
        return true;
      case "monospace":
        this.widget.set_monospace(asBool(value));
        return true;
      case "wrap":
        this.widget.set_wrap_mode(
          asEnum(TEXT_WRAP, value, Gtk.WrapMode.WORD_CHAR),
        );
        return true;
      case "cursor":
        this.widget.set_cursor_visible(asBool(value));
        return true;
      case "justify":
        this.widget.set_justification(
          asEnum(JUSTIFY, value, Gtk.Justification.LEFT),
        );
        return true;
      // Tab moves focus when off, which is usually what a form wants.
      case "accepts-tab":
        this.widget.set_accepts_tab(asBool(value));
        return true;
      case "padding":
        this.setPadding(asNumber(value, 0));
        return true;
      case "indent":
        this.widget.set_indent(asNumber(value, 0));
        return true;
      case "line-spacing":
        this.widget.set_pixels_below_lines(asNumber(value, 0));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  // GTK CSS padding on a text view moves the frame, not the text — the text's
  // own inset is these four margins.
  private setPadding(value: number): void {
    this.widget.set_top_margin(value);
    this.widget.set_bottom_margin(value);
    this.widget.set_left_margin(value);
    this.widget.set_right_margin(value);
  }
}
