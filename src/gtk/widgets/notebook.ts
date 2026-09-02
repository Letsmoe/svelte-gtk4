import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber, asString } from "../attrs";
import { Widget } from "./base";
import { POSITION } from "./enums";

/**
 * Pages with their own tab strip. Each child titles its tab with `title`, read
 * at insertion, so it has to be a literal.
 */
export class GtkNotebook extends Widget<Gtk.Notebook> {
  static override readonly tag = "gtknotebook";

  constructor(node: SElement) {
    super(node, new Gtk.Notebook());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "page":
        this.widget.set_current_page(asNumber(value, 0));
        return true;
      case "tabs":
        this.widget.set_show_tabs(asBool(value));
        return true;
      case "tab-position":
        this.widget.set_tab_pos(asEnum(POSITION, value, Gtk.PositionType.TOP));
        return true;
      case "border":
        this.widget.set_show_border(asBool(value));
        return true;
      case "scrollable":
        this.widget.set_scrollable(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  override insert(child: SElement, before: any): void {
    const tab = new Gtk.Label({
      label: asString(child.getAttribute("title")),
    });
    if (before === null) {
      this.widget.append_page(child.widget, tab);
      return;
    }
    this.widget.insert_page(child.widget, tab, this.widget.page_num(before));
  }

  override remove(child: SElement): void {
    const page = this.widget.page_num(child.widget);
    if (page < 0) {
      return;
    }
    this.widget.remove_page(page);
  }
}
