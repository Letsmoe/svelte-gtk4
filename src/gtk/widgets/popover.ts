import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber } from "../attrs";
import { Bin } from "./base";
import { POSITION } from "./enums";

/**
 * A bubble anchored to the widget it is a child of. It needs such a parent —
 * a `<gtkmenubutton>` with `place="popover"` is the usual one. Signal:
 * `closed`.
 */
export class GtkPopover extends Bin<Gtk.Popover> {
  static override readonly tag = "gtkpopover";

  private readonly offset = { x: 0, y: 0 };
  private readonly point = { x: -1, y: -1 };

  constructor(node: SElement) {
    super(node, new Gtk.Popover());
  }

  private applyPoint(): void {
    if (this.point.x < 0 || this.point.y < 0) {
      return;
    }
    this.widget.set_pointing_to({
      x: this.point.x,
      y: this.point.y,
      width: 1,
      height: 1,
    } as any);
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "open":
        if (asBool(value)) {
          this.widget.popup();
        } else {
          this.widget.popdown();
        }
        return true;
      // Off leaves the popover up until it is dismissed in code, and lets
      // clicks through to what is behind it.
      case "autohide":
        this.widget.set_autohide(asBool(value));
        return true;
      case "arrow":
        this.widget.set_has_arrow(asBool(value));
        return true;
      case "position":
        this.widget.set_position(
          asEnum(POSITION, value, Gtk.PositionType.BOTTOM),
        );
        return true;
      // Each axis keeps the other: set_offset takes both at once, so reading
      // the current pair back is what stops one attribute clobbering the other.
      case "offset-x":
        this.offset.x = asNumber(value, 0);
        this.widget.set_offset(this.offset.x, this.offset.y);
        return true;
      case "offset-y":
        this.offset.y = asNumber(value, 0);
        this.widget.set_offset(this.offset.x, this.offset.y);
        return true;
      // Where in the parent the bubble points. A menu opened by a right-click
      // needs the pointer's position, which no anchor widget can express.
      case "point-x":
        this.point.x = asNumber(value, 0);
        this.applyPoint();
        return true;
      case "point-y":
        this.point.y = asNumber(value, 0);
        this.applyPoint();
        return true;
      case "cascade-popdown":
        this.widget.set_cascade_popdown(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }
}
