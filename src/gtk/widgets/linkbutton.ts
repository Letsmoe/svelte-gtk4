import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asString } from "../attrs";
import { FramedButton } from "./button";

/**
 * Opens its `uri` with the system handler. Signal: `activate-link` — return
 * true from it to keep GTK from opening the URI itself.
 */
export class GtkLinkButton extends FramedButton<Gtk.LinkButton> {
  static override readonly tag = "gtklinkbutton";

  constructor(node: SElement) {
    super(node, new Gtk.LinkButton({ uri: "" }));
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "uri":
        this.widget.set_uri(asString(value));
        return true;
      case "visited":
        this.widget.set_visited(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
