import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asNumber, asOrientation } from "../attrs";
import { Widget } from "./base";

/** Two children either side of a draggable handle, picked with `place`. */
export class GtkPaned extends Widget<Gtk.Paned> {
  static override readonly tag = "gtkpaned";

  constructor(node: SElement) {
    super(node, new Gtk.Paned());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "orientation":
        this.widget.set_orientation(asOrientation(value));
        return true;
      case "position":
        this.widget.set_position(asNumber(value, 0));
        return true;
      case "wide-handle":
        this.widget.set_wide_handle(asBool(value));
        return true;
      case "resize-start":
        this.widget.set_resize_start_child(asBool(value));
        return true;
      case "resize-end":
        this.widget.set_resize_end_child(asBool(value));
        return true;
      case "shrink-start":
        this.widget.set_shrink_start_child(asBool(value));
        return true;
      case "shrink-end":
        this.widget.set_shrink_end_child(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  override insert(child: SElement): void {
    this.place(child.slotName, child.widget);
  }

  override remove(child: SElement): void {
    this.place(child.slotName, null);
  }

  private place(slot: string, widget: Gtk.Widget | null): void {
    if (slot === "end") {
      this.widget.set_end_child(widget);
      return;
    }
    this.widget.set_start_child(widget);
  }
}
