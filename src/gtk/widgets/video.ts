import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { Widget } from "./base";

/** Playback with GTK's own controls layered over it. */
export class GtkVideo extends Widget<Gtk.Video> {
  static override readonly tag = "gtkvideo";

  constructor(node: SElement) {
    super(node, new Gtk.Video());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "file":
        this.widget.set_filename(asString(value));
        return true;
      case "resource":
        this.widget.set_resource(asString(value));
        return true;
      case "autoplay":
        this.widget.set_autoplay(asBool(value));
        return true;
      case "loop":
        this.widget.set_loop(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
