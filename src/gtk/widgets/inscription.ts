import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asEnum, asNumber } from "../attrs";
import { Widget } from "./base";
import { INSCRIPTION_OVERFLOW } from "./enums";

/**
 * A label that costs almost nothing: it sizes itself from a character count
 * rather than from its text, so changing the text never triggers a resize.
 * The right choice for anything updating every second. GTK 4.8.
 */
export class GtkInscription extends Widget<Gtk.Inscription> {
  static override readonly tag = "gtkinscription";

  constructor(node: SElement) {
    super(node, new Gtk.Inscription());
  }

  setText(text: string): void {
    this.widget.set_text(text);
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "xalign":
        this.widget.set_xalign(asNumber(value, 0.5));
        return true;
      case "yalign":
        this.widget.set_yalign(asNumber(value, 0.5));
        return true;
      case "min-chars":
        this.widget.set_min_chars(asNumber(value, 0));
        return true;
      case "nat-chars":
        this.widget.set_nat_chars(asNumber(value, 0));
        return true;
      case "min-lines":
        this.widget.set_min_lines(asNumber(value, 0));
        return true;
      case "nat-lines":
        this.widget.set_nat_lines(asNumber(value, 0));
        return true;
      case "overflow-text":
        this.widget.set_text_overflow(
          asEnum(
            INSCRIPTION_OVERFLOW,
            value,
            Gtk.InscriptionOverflow.CLIP,
          ),
        );
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
