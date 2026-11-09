import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asNumber } from "../attrs";
import { Widget } from "./base";

/**
 * Vector drawing from data rather than a callback, so a view that cannot hand
 * GTK a function — a remote client — can still draw a chart:
 *
 * ```svelte
 * <gtkcanvas viewbox={[0, 0, 10, 1]} commands={[["rgba", 1, 1, 1, 0.5], ["rect", 0, 0.2, 1, 0.8], ["fill"]]} />
 * ```
 *
 * `viewbox` is `[x, y, width, height]`; it is stretched over the widget, so
 * the commands never need the allocated size. Line widths are pixels.
 *
 *   ["rgba", r, g, b, a]      colours 0..1
 *   ["rect", x, y, w, h]  ["move", x, y]  ["line", x, y]
 *   ["arc", cx, cy, radius, startAngle, endAngle]   radians
 *   ["close"]  ["fill"]  ["stroke", pixels]
 */
export class GtkCanvas extends Widget<Gtk.DrawingArea> {
  static override readonly tag = "gtkcanvas";

  private commands: unknown[][] = [];
  private viewbox = [0, 0, 1, 1];

  constructor(node: SElement) {
    super(node, new Gtk.DrawingArea());
    this.widget.set_draw_func((_area, cr, width, height) => this.draw(cr, width, height));
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "commands":
        this.commands = commandsOf(value);
        this.widget.queue_draw();
        return true;
      case "viewbox":
        this.viewbox = viewboxOf(value);
        this.widget.queue_draw();
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

  private draw(cr: any, width: number, height: number): void {
    const [x, y, viewWidth, viewHeight] = this.viewbox;
    cr.scale(width / viewWidth, height / viewHeight);
    cr.translate(-x, -y);
    for (const command of this.commands) {
      run(cr, command);
    }
  }
}

function run(cr: any, command: unknown[]): void {
  const numbers = command.slice(1).map((item) => finite(item));
  switch (command[0]) {
    case "rgba":
      cr.setSourceRGBA(numbers[0], numbers[1], numbers[2], numbers[3]);
      return;
    case "rect":
      cr.rectangle(numbers[0], numbers[1], numbers[2], numbers[3]);
      return;
    case "move":
      cr.moveTo(numbers[0], numbers[1]);
      return;
    case "line":
      cr.lineTo(numbers[0], numbers[1]);
      return;
    case "arc":
      cr.arc(numbers[0], numbers[1], numbers[2], numbers[3], numbers[4]);
      return;
    case "close":
      cr.closePath();
      return;
    case "fill":
      cr.fill();
      return;
    case "stroke":
      strokeInPixels(cr, numbers[0]);
      return;
  }
}

// The path is already in device space; dropping the viewbox's scale first
// keeps a stretched line as wide as it was asked to be.
function strokeInPixels(cr: any, pixels: number): void {
  cr.save();
  cr.identityMatrix();
  cr.setLineWidth(Math.max(0, pixels));
  cr.stroke();
  cr.restore();
}

const MAX_COMMANDS = 4096;

function commandsOf(value: unknown): unknown[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, MAX_COMMANDS).filter((command): command is unknown[] => Array.isArray(command));
}

function viewboxOf(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 4) {
    return [0, 0, 1, 1];
  }
  const box = value.map((item) => finite(item));
  if (box[2] <= 0 || box[3] <= 0) {
    return [0, 0, 1, 1];
  }
  return box;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}
