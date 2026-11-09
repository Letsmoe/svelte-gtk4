import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Graphene from "gi://Graphene?version=1.0";
import Gsk from "gi://Gsk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asNumber } from "../attrs";
import { Widget } from "./base";

// GTK4 has no widget that caps its child's width (libadwaita's AdwClamp is
// the one people reach for), and no signal for a widget's allocated width, so
// a layout cannot follow the window's size. This one does both: the child is
// given at most `maximum` pixels, centred, and `width-changed` fires after an
// allocation changes the width.

const UNLIMITED = 0;

class ClampWidget extends Gtk.Widget {
  static {
    GObject.registerClass(
      {
        GTypeName: "SvelteGtk4Clamp",
        Signals: { "width-changed": {} },
      },
      this,
    );
  }

  maximum = UNLIMITED;
  lastWidth = -1;
  child: Gtk.Widget | null = null;
  pendingNotify = 0;

  setChild(child: Gtk.Widget | null): void {
    if (this.child !== null) {
      this.child.unparent();
    }
    this.child = child;
    if (child !== null) {
      child.set_parent(this);
    }
  }

  setMaximum(maximum: number): void {
    this.maximum = maximum;
    this.queue_resize();
  }

  override vfunc_get_request_mode(): Gtk.SizeRequestMode {
    return Gtk.SizeRequestMode.HEIGHT_FOR_WIDTH;
  }

  override vfunc_measure(
    orientation: Gtk.Orientation,
    forSize: number,
  ): [number, number, number, number] {
    if (this.child === null) {
      return [0, 0, -1, -1];
    }
    if (orientation === Gtk.Orientation.VERTICAL) {
      return this.child.measure(orientation, this.childWidthFor(forSize));
    }
    const [minimum, natural] = this.child.measure(orientation, forSize);
    return [minimum, Math.max(minimum, this.childWidthFor(natural)), -1, -1];
  }

  override vfunc_size_allocate(width: number, height: number, baseline: number): void {
    if (this.child !== null) {
      this.allocateChild(this.child, width, height, baseline);
    }
    this.noteWidth(width);
  }

  override vfunc_dispose(): void {
    this.setChild(null);
    if (this.pendingNotify !== 0) {
      GLib.source_remove(this.pendingNotify);
      this.pendingNotify = 0;
    }
    super.vfunc_dispose();
  }

  // Never below the child's minimum: GTK warns on an allocation under it.
  private allocateChild(child: Gtk.Widget, width: number, height: number, baseline: number): void {
    const [minimumWidth] = child.measure(Gtk.Orientation.HORIZONTAL, -1);
    const childWidth = Math.max(this.childWidthFor(width), minimumWidth);
    const offset = Math.max(0, Math.floor((width - childWidth) / 2));
    const transform = new Gsk.Transform().translate(new Graphene.Point().init(offset, 0));
    child.allocate(childWidth, height, baseline, transform);
  }

  // A negative size is "not yet known" and passes through.
  private childWidthFor(available: number): number {
    if (this.maximum === UNLIMITED || available < 0) {
      return available;
    }
    return Math.min(available, this.maximum);
  }

  // Emitted from idle: a handler that changes the layout would otherwise
  // queue a resize in the middle of this allocation.
  private noteWidth(width: number): void {
    if (width === this.lastWidth) {
      return;
    }
    this.lastWidth = width;
    if (this.pendingNotify !== 0) {
      return;
    }
    this.pendingNotify = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.pendingNotify = 0;
      this.emit("width-changed");
      return GLib.SOURCE_REMOVE;
    });
  }
}

/** Caps its one child's width at `maximum` and reports its own width. */
export class GtkClamp extends Widget<ClampWidget> {
  static override readonly tag = "gtkclamp";

  constructor(node: SElement) {
    super(node, new ClampWidget());
  }

  override attr(name: string, value: unknown): boolean {
    if (name === "maximum") {
      this.widget.setMaximum(asNumber(value, UNLIMITED));
      return true;
    }
    return super.attr(name, value);
  }

  override insert(child: SElement): void {
    this.widget.setChild(child.widget);
  }

  // A replacement is inserted before the old child leaves; removing the old
  // one must not take the new one with it.
  override remove(child: SElement): void {
    if (this.widget.child !== child.widget) {
      return;
    }
    this.widget.setChild(null);
  }
}
