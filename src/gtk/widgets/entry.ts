import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asNumber, asString } from "../attrs";
import { Editable } from "./editable";

/** A single-line entry with a frame, icons and a progress overlay. */
export class GtkEntry extends Editable<Gtk.Entry> {
  static override readonly tag = "gtkentry";

  constructor(node: SElement) {
    super(node, new Gtk.Entry());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "placeholder":
        this.widget.set_placeholder_text(asString(value));
        return true;
      case "frame":
        this.widget.set_has_frame(asBool(value));
        return true;
      case "max-length":
        this.widget.set_max_length(asNumber(value, 0));
        return true;
      // Off masks the text. `gtkpasswordentry` is the better answer for a real
      // password field — it also gets the peek icon and input method handling.
      case "visibility":
        this.widget.set_visibility(asBool(value));
        return true;
      case "icon":
        this.widget.set_icon_from_icon_name(
          Gtk.EntryIconPosition.PRIMARY,
          asString(value),
        );
        return true;
      case "icon-end":
        this.widget.set_icon_from_icon_name(
          Gtk.EntryIconPosition.SECONDARY,
          asString(value),
        );
        return true;
      case "progress":
        this.widget.set_progress_fraction(asNumber(value, 0));
        return true;
      case "emoji":
        this.widget.show_emoji_icon = asBool(value);
        return true;
      // Makes Enter fire the window's default widget as well as `activate`.
      case "activates-default":
        this.widget.set_activates_default(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
