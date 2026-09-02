import Gtk from "gi://Gtk?version=4.0";
import Pango from "gi://Pango";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { Widget } from "./base";

/**
 * Opens a font chooser. The 4.10 replacement for the deprecated
 * `Gtk.FontButton`, and like the colour one it needs a dialog handed to it.
 *
 * `font` is a Pango description — "Cantarell Bold 12". Read the result back
 * from `notify::font-desc`.
 */
export class GtkFontButton extends Widget<Gtk.FontDialogButton> {
  static override readonly tag = "gtkfontbutton";

  private readonly dialog = new Gtk.FontDialog();

  constructor(node: SElement) {
    super(node, new Gtk.FontDialogButton());
    this.widget.set_dialog(this.dialog);
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "font":
        this.widget.set_font_desc(Pango.FontDescription.from_string(
          asString(value),
        ));
        return true;
      case "title":
        this.dialog.set_title(asString(value));
        return true;
      // Draws the button's own label in the font it names.
      case "preview":
        this.widget.set_use_font(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
