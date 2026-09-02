import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asString } from "../attrs";
import { Widget } from "./base";
import { CONTENT_FIT } from "./enums";

/** An image at its own size, scaled to fit. */
export class GtkPicture extends Widget<Gtk.Picture> {
  static override readonly tag = "gtkpicture";

  constructor(node: SElement) {
    super(node, new Gtk.Picture());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "file":
        this.widget.set_filename(asString(value));
        return true;
      case "resource":
        this.widget.set_resource(asString(value));
        return true;
      case "fit":
        this.widget.set_content_fit(
          asEnum(CONTENT_FIT, value, Gtk.ContentFit.CONTAIN),
        );
        return true;
      // Off means the picture never asks for less than its natural size, which
      // is how a large image forces its window wide.
      case "shrink":
        this.widget.set_can_shrink(asBool(value));
        return true;
      case "alt":
        this.widget.set_alternative_text(asString(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
