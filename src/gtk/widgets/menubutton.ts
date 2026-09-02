import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum } from "../attrs";
import { ARROW } from "./enums";
import { FramedButton } from "./button";

/**
 * A button that drops something down. The popup is a `<gtkpopover>` child
 * marked `place="popover"`; any other child is the button's own content.
 *
 * ```svelte
 * <gtkmenubutton icon="open-menu-symbolic">
 *   <gtkpopover place="popover">…</gtkpopover>
 * </gtkmenubutton>
 * ```
 */
export class GtkMenuButton extends FramedButton<Gtk.MenuButton> {
  static override readonly tag = "gtkmenubutton";

  constructor(node: SElement) {
    super(node, new Gtk.MenuButton());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "active":
        this.widget.set_active(asBool(value));
        return true;
      case "direction":
        this.widget.set_direction(asEnum(ARROW, value, Gtk.ArrowType.DOWN));
        return true;
      case "arrow":
        this.widget.set_always_show_arrow(asBool(value));
        return true;
      // Opens on F10 as the window's primary menu.
      case "primary":
        this.widget.set_primary(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  override insert(child: SElement): void {
    if (child.slotName === "popover") {
      this.widget.set_popover(child.widget);
      return;
    }
    this.widget.set_child(child.widget);
  }

  override remove(child: SElement): void {
    if (child.slotName === "popover") {
      this.widget.set_popover(null);
      return;
    }
    this.widget.set_child(null);
  }
}
