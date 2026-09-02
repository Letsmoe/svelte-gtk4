import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber, asString } from "../attrs";
import { Widget } from "./base";
import { ICON_SIZE } from "./enums";

/** An icon, at icon sizes. Use `gtkpicture` for anything photographic. */
export class GtkImage extends Widget<Gtk.Image> {
  static override readonly tag = "gtkimage";

  constructor(node: SElement) {
    super(node, new Gtk.Image());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "icon":
        this.widget.set_from_icon_name(asString(value));
        return true;
      case "file":
        this.widget.set_from_file(asString(value));
        return true;
      case "resource":
        this.widget.set_from_resource(asString(value));
        return true;
      // Exact pixels. `icon-size` only picks between GTK's two named sizes.
      case "size":
        this.widget.set_pixel_size(asNumber(value, -1));
        return true;
      case "icon-size":
        this.widget.set_icon_size(
          asEnum(ICON_SIZE, value, Gtk.IconSize.INHERIT),
        );
        return true;
      case "fallback":
        this.widget.use_fallback = asBool(value);
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
