import Gtk from "gi://Gtk?version=4.0";
import Pango from "gi://Pango";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber } from "../attrs";
import { Widget } from "./base";
import { ELLIPSIZE, JUSTIFY, WRAP } from "./enums";

export class GtkLabel extends Widget<Gtk.Label> {
  static override readonly tag = "gtklabel";

  constructor(node: SElement) {
    super(node, new Gtk.Label());
  }

  setText(text: string): void {
    this.widget.set_label(text);
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "xalign":
        this.widget.set_xalign(asNumber(value, 0.5));
        return true;
      case "yalign":
        this.widget.set_yalign(asNumber(value, 0.5));
        return true;
      case "wrap":
        this.widget.set_wrap(asBool(value));
        return true;
      case "wrap-mode":
        this.widget.set_wrap_mode(asEnum(WRAP, value, Pango.WrapMode.WORD));
        return true;
      case "lines":
        this.widget.set_lines(asNumber(value, -1));
        return true;
      case "ellipsize":
        this.widget.set_ellipsize(
          asEnum(ELLIPSIZE, value, Pango.EllipsizeMode.NONE),
        );
        return true;
      case "justify":
        this.widget.set_justify(
          asEnum(JUSTIFY, value, Gtk.Justification.LEFT),
        );
        return true;
      // Pango markup rather than plain text. Unbalanced tags make GTK warn and
      // show the source, so this is opt-in.
      case "markup":
        this.widget.set_use_markup(asBool(value));
        return true;
      case "selectable":
        this.widget.set_selectable(asBool(value));
        return true;
      case "single-line":
        this.widget.set_single_line_mode(asBool(value));
        return true;
      case "width-chars":
        this.widget.set_width_chars(asNumber(value, -1));
        return true;
      case "max-width-chars":
        this.widget.set_max_width_chars(asNumber(value, -1));
        return true;
      case "tabular":
        this.setTabularNumbers(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  // GTK CSS has no font-variant-numeric, so fixed-width digits — the thing
  // that stops a clock jittering — are a Pango attribute on the label itself.
  private setTabularNumbers(enabled: boolean): void {
    if (!enabled) {
      this.widget.set_attributes(null);
      return;
    }
    const attributes = new Pango.AttrList();
    attributes.insert(Pango.attr_font_features_new("tnum=1"));
    this.widget.set_attributes(attributes);
  }
}
