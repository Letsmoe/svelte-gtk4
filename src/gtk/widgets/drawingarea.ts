import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asFunction, asNumber } from "../attrs";
import { Widget } from "./base";

/**
 * Cairo, drawn by hand. `draw` takes `(area, cr, width, height)` and has to be
 * an expression, not a literal:
 *
 * ```svelte
 * <gtkdrawingarea draw={(_area, cr, w, h) => { ... }} />
 * ```
 *
 * GTK only calls it when the area is invalidated, so a `draw` that closes over
 * reactive state needs a `queue_draw()` when that state changes.
 */
export class GtkDrawingArea extends Widget<Gtk.DrawingArea> {
  static override readonly tag = "gtkdrawingarea";

  constructor(node: SElement) {
    super(node, new Gtk.DrawingArea());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "draw":
        this.setDraw(asFunction(value));
        return true;
      case "content-width":
        this.widget.set_content_width(asNumber(value, 0));
        return true;
      case "content-height":
        this.widget.set_content_height(asNumber(value, 0));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  private setDraw(draw: ((...args: any[]) => any) | null): void {
    if (draw === null) {
      this.widget.set_draw_func(null);
      return;
    }
    this.widget.set_draw_func(draw as any);
    this.widget.queue_draw();
  }
}
