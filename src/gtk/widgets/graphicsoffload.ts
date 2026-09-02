import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool } from "../attrs";
import { Bin } from "./base";

// GTK 4.14, and absent from the typings entirely.
const OFFLOAD = Gtk as unknown as {
  GraphicsOffload: new () => Gtk.Widget;
  GraphicsOffloadEnabled: { ENABLED: number; DISABLED: number };
};

/**
 * Hands its child's content straight to the compositor as a subsurface, which
 * is what keeps video off the normal compositing path.
 */
export class GtkGraphicsOffload extends Bin {
  static override readonly tag = "gtkgraphicsoffload";

  constructor(node: SElement) {
    super(node, new OFFLOAD.GraphicsOffload());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "enabled":
        (this.widget as any).set_enabled(
          asBool(value)
            ? OFFLOAD.GraphicsOffloadEnabled.ENABLED
            : OFFLOAD.GraphicsOffloadEnabled.DISABLED,
        );
        return true;
      case "black-background":
        (this.widget as any).set_black_background(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
