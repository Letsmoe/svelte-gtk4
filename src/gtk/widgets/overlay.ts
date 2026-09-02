import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool } from "../attrs";
import { Widget } from "./base";

/**
 * One main child plus any number of children marked `overlay`, stacked on top
 * of it and positioned by their own alignment. An overlay child is unmeasured
 * unless it also carries `measure`.
 */
export class GtkOverlay extends Widget<Gtk.Overlay> {
  static override readonly tag = "gtkoverlay";

  constructor(node: SElement) {
    super(node, new Gtk.Overlay());
  }

  override insert(child: SElement): void {
    if (!child.hasAttribute("overlay")) {
      this.widget.set_child(child.widget);
      return;
    }
    this.widget.add_overlay(child.widget);
    if (asBool(child.getAttribute("measure"))) {
      this.widget.set_measure_overlay(child.widget, true);
    }
    // Not `clip` — that one is every widget's own overflow.
    if (asBool(child.getAttribute("clip-overlay"))) {
      this.widget.set_clip_overlay(child.widget, true);
    }
  }

  override remove(child: SElement): void {
    if (!child.hasAttribute("overlay")) {
      this.widget.set_child(null);
      return;
    }
    this.widget.remove_overlay(child.widget);
  }
}
