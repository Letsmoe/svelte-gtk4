import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber } from "../attrs";
import { Bin } from "./base";
import { REVEALER_TRANSITION } from "./enums";

/** Animates its child in and out. `reveal` is the thing to bind. */
export class GtkRevealer extends Bin<Gtk.Revealer> {
  static override readonly tag = "gtkrevealer";

  constructor(node: SElement) {
    super(node, new Gtk.Revealer());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "reveal":
        this.widget.set_reveal_child(asBool(value));
        return true;
      case "transition":
        this.widget.set_transition_type(
          asEnum(
            REVEALER_TRANSITION,
            value,
            Gtk.RevealerTransitionType.SLIDE_DOWN,
          ),
        );
        return true;
      case "duration":
        this.widget.set_transition_duration(asNumber(value, 250));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
