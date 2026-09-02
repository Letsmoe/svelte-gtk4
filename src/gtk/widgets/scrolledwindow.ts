import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber } from "../attrs";
import { Bin } from "./base";
import { POLICY } from "./enums";

export class GtkScrolledWindow extends Bin<Gtk.ScrolledWindow> {
  static override readonly tag = "gtkscrolledwindow";

  // Both policies go through one setter, so the unset half has to be kept.
  private hpolicy = Gtk.PolicyType.AUTOMATIC;
  private vpolicy = Gtk.PolicyType.AUTOMATIC;

  constructor(node: SElement) {
    super(node, new Gtk.ScrolledWindow());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "hscroll":
        this.hpolicy = asEnum(POLICY, value, Gtk.PolicyType.AUTOMATIC);
        this.widget.set_policy(this.hpolicy, this.vpolicy);
        return true;
      case "vscroll":
        this.vpolicy = asEnum(POLICY, value, Gtk.PolicyType.AUTOMATIC);
        this.widget.set_policy(this.hpolicy, this.vpolicy);
        return true;
      case "frame":
        this.widget.set_has_frame(asBool(value));
        return true;
      case "kinetic":
        this.widget.set_kinetic_scrolling(asBool(value));
        return true;
      case "overlay-scrolling":
        this.widget.set_overlay_scrolling(asBool(value));
        return true;
      case "min-content-width":
        this.widget.set_min_content_width(asNumber(value, -1));
        return true;
      case "min-content-height":
        this.widget.set_min_content_height(asNumber(value, -1));
        return true;
      case "max-content-width":
        this.widget.set_max_content_width(asNumber(value, -1));
        return true;
      case "max-content-height":
        this.widget.set_max_content_height(asNumber(value, -1));
        return true;
      // Without these a scrolled window asks for the minimum its scrollbars
      // need and nothing more, whatever the content wants.
      case "propagate-width":
        this.widget.set_propagate_natural_width(asBool(value));
        return true;
      case "propagate-height":
        this.widget.set_propagate_natural_height(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
