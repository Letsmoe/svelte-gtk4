import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asOrientation } from "../attrs";
import { Widget } from "./base";
import { BASELINE } from "./enums";

/** Three named positions rather than a list; children pick one with `place`. */
export class GtkCenterBox extends Widget<Gtk.CenterBox> {
  static override readonly tag = "gtkcenterbox";

  constructor(node: SElement) {
    super(node, new Gtk.CenterBox());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "orientation":
        this.widget.set_orientation(asOrientation(value));
        return true;
      case "baseline":
        this.widget.set_baseline_position(
          asEnum(BASELINE, value, Gtk.BaselinePosition.CENTER),
        );
        return true;
      // GTK 4.12; the typings still describe the older surface.
      case "shrink-center-last":
        (this.widget as any).set_shrink_center_last(asBool(value));
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
    if (slot === "start") {
      this.widget.set_start_widget(widget);
      return;
    }
    if (slot === "end") {
      this.widget.set_end_widget(widget);
      return;
    }
    this.widget.set_center_widget(widget);
  }
}
