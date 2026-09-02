import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { Bin } from "./base";

/**
 * Everything with a label that is either text or a single child widget.
 * `set_label` replaces the child, so it only ever runs for buttons that are
 * already labelled or about to be.
 */
export abstract class ButtonLike<W extends Gtk.Widget = any> extends Bin<W> {
  setText(text: string): void {
    if (text === "" && (this.widget as any).get_label() === null) {
      return;
    }
    (this.widget as any).set_label(text);
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "label":
        (this.widget as any).set_label(asString(value));
        return true;
      // Reads the character after an underscore as the mnemonic.
      case "underline":
        (this.widget as any).set_use_underline(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}

/** A button that draws a frame and can hold an icon instead of a label. */
export abstract class FramedButton<
  W extends Gtk.Widget = any,
> extends ButtonLike<W> {
  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "frame":
        (this.widget as any).set_has_frame(asBool(value));
        return true;
      case "icon":
        (this.widget as any).set_icon_name(asString(value));
        return true;
      // Lets the label ellipsize instead of forcing the button wider.
      case "shrink":
        (this.widget as any).set_can_shrink(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}

/** Signals: `clicked`, `activate`. */
export class GtkButton extends FramedButton<Gtk.Button> {
  static override readonly tag = "gtkbutton";

  constructor(node: SElement) {
    super(node, new Gtk.Button());
  }
}
