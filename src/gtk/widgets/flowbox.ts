import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber } from "../attrs";
import { IndexedContainer } from "./base";
import { SELECTION } from "./enums";

/** A reflowing grid of selectable children. */
export class GtkFlowBox extends IndexedContainer<Gtk.FlowBox> {
  static override readonly tag = "gtkflowbox";

  constructor(node: SElement) {
    super(node, new Gtk.FlowBox());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "orientation":
        this.widget.set_orientation(
          value === "vertical"
            ? Gtk.Orientation.VERTICAL
            : Gtk.Orientation.HORIZONTAL,
        );
        return true;
      case "selection":
        this.widget.set_selection_mode(
          asEnum(SELECTION, value, Gtk.SelectionMode.SINGLE),
        );
        return true;
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
      case "min-per-line":
        this.widget.set_min_children_per_line(asNumber(value, 0));
        return true;
      case "max-per-line":
        this.widget.set_max_children_per_line(asNumber(value, 7));
        return true;
      case "homogeneous":
        this.widget.set_homogeneous(asBool(value));
        return true;
      case "single-click":
        this.widget.set_activate_on_single_click(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
