import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { Widget } from "./base";

/**
 * A swatch that opens a colour chooser. `Gtk.ColorButton` is deprecated, so
 * this is the 4.10 replacement — which shows nothing at all until it is given
 * a dialog, hence the one built here.
 *
 * Read the result from `notify::rgba`.
 */
export class GtkColorButton extends Widget<Gtk.ColorDialogButton> {
  static override readonly tag = "gtkcolorbutton";

  private readonly dialog = new Gtk.ColorDialog();

  constructor(node: SElement) {
    super(node, new Gtk.ColorDialogButton());
    this.widget.set_dialog(this.dialog);
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "color":
        this.setColor(asString(value));
        return true;
      case "alpha":
        this.dialog.set_with_alpha(asBool(value));
        return true;
      case "title":
        this.dialog.set_title(asString(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  private setColor(spec: string): void {
    const rgba = new Gdk.RGBA();
    if (!rgba.parse(spec)) {
      return;
    }
    this.widget.set_rgba(rgba);
  }
}
