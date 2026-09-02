import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asNumber } from "../attrs";
import { Widget } from "./base";

/**
 * Children carry their own cell. Those attributes are read at insertion, so —
 * like `place` — they have to be literals in the template.
 */
export class GtkGrid extends Widget<Gtk.Grid> {
  static override readonly tag = "gtkgrid";

  constructor(node: SElement) {
    super(node, new Gtk.Grid());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "row-spacing":
        this.widget.set_row_spacing(asNumber(value, 0));
        return true;
      case "column-spacing":
        this.widget.set_column_spacing(asNumber(value, 0));
        return true;
      case "spacing":
        this.widget.set_row_spacing(asNumber(value, 0));
        this.widget.set_column_spacing(asNumber(value, 0));
        return true;
      case "row-homogeneous":
        this.widget.set_row_homogeneous(asBool(value));
        return true;
      case "column-homogeneous":
        this.widget.set_column_homogeneous(asBool(value));
        return true;
      case "homogeneous":
        this.widget.set_row_homogeneous(asBool(value));
        this.widget.set_column_homogeneous(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  override insert(child: SElement): void {
    this.widget.attach(
      child.widget,
      cell(child, "col", 0),
      cell(child, "row", 0),
      cell(child, "colspan", 1),
      cell(child, "rowspan", 1),
    );
  }

  override remove(child: SElement): void {
    this.widget.remove(child.widget);
  }
}

function cell(child: SElement, name: string, fallback: number): number {
  return asNumber(child.getAttribute(name), fallback);
}
