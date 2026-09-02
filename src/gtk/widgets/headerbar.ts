import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { Widget } from "./base";

/**
 * A title bar. Children pick a side with `place="start"` or `place="end"`;
 * one marked `place="title"` replaces the title itself.
 *
 * Set it on a window with `place="titlebar"`.
 */
export class GtkHeaderBar extends Widget<Gtk.HeaderBar> {
  static override readonly tag = "gtkheaderbar";

  constructor(node: SElement) {
    super(node, new Gtk.HeaderBar());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "controls":
        this.widget.set_show_title_buttons(asBool(value));
        return true;
      // Which buttons appear on which side, e.g. "icon:minimize,close".
      case "decoration":
        this.widget.set_decoration_layout(asString(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  override insert(child: SElement): void {
    if (child.slotName === "title") {
      this.widget.set_title_widget(child.widget);
      return;
    }
    if (child.slotName === "end") {
      this.widget.pack_end(child.widget);
      return;
    }
    this.widget.pack_start(child.widget);
  }

  override remove(child: SElement): void {
    if (child.slotName === "title") {
      this.widget.set_title_widget(null);
      return;
    }
    this.widget.remove(child.widget);
  }
}
