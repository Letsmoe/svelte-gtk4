import Gtk from "gi://Gtk?version=4.0";
import LayerShell from "gi://Gtk4LayerShell?version=1.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber, asString } from "../attrs";
import { watchInputRegion } from "../inputRegion";
import { Widget } from "./base";

const LAYERS: Record<string, number> = {
  background: 0,
  bottom: 1,
  top: 2,
  overlay: 3,
};

const EDGES: Record<string, number> = { left: 0, right: 1, top: 2, bottom: 3 };

const KEYBOARD_MODES: Record<string, number> = {
  none: 0,
  exclusive: 1,
  ondemand: 2,
};

/** GTK reports an untouched default size as 0; -1 is what unsets it. */
function unsetIfZero(size: number): number {
  if (size === 0) {
    return -1;
  }
  return size;
}

/**
 * A toplevel, and — the moment any `layer`, `anchor`, `namespace`,
 * `exclusive-zone` or `keyboard-mode` attribute appears — a layer surface.
 *
 * One child, plus one marked `place="titlebar"`. Signal: `close-request`.
 */
export class GtkWindow extends Widget<Gtk.Window> {
  static override readonly tag = "gtkwindow";

  // gtk4-layer-shell has to be initialized before the window is realized, and
  // exactly once.
  private layered = false;

  constructor(node: SElement) {
    super(node, new Gtk.Window());
    // Idle until something under it carries `input`; then it starts publishing
    // an input region instead of claiming the whole surface.
    watchInputRegion(this.widget);
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "title":
        this.widget.set_title(asString(value));
        return true;
      case "decorated":
        this.widget.set_decorated(asBool(value));
        return true;
      case "resizable":
        this.widget.set_resizable(asBool(value));
        return true;
      case "modal":
        this.widget.set_modal(asBool(value));
        return true;
      case "icon":
        this.widget.set_icon_name(asString(value));
        return true;
      case "fullscreen":
        if (asBool(value)) {
          this.widget.fullscreen();
        } else {
          this.widget.unfullscreen();
        }
        return true;
      case "maximized":
        if (asBool(value)) {
          this.widget.maximize();
        } else {
          this.widget.unmaximize();
        }
        return true;
      // Setting a default size at all makes a layer surface fall back to its
      // natural size, overriding what its anchors would have taken from the
      // compositor — so these are only ever touched when asked for. The other
      // axis is read back as `unset` rather than raw: GTK reports an untouched
      // one as 0, and set_default_size rejects a 0 outright.
      case "default-width":
        this.widget.set_default_size(
          asNumber(value, -1),
          unsetIfZero(this.widget.default_height),
        );
        return true;
      case "default-height":
        this.widget.set_default_size(
          unsetIfZero(this.widget.default_width),
          asNumber(value, -1),
        );
        return true;

      case "layer":
        this.ensureLayerShell();
        LayerShell.set_layer(this.widget, asEnum(LAYERS, value, LAYERS.top));
        return true;
      case "namespace":
        this.ensureLayerShell();
        LayerShell.set_namespace(this.widget, asString(value));
        return true;
      case "anchor":
        this.ensureLayerShell();
        this.applyAnchors(asString(value));
        return true;
      // Space the compositor keeps clear for this surface. -1 means "as much
      // as the surface takes", 0 means none.
      case "exclusive-zone":
        this.ensureLayerShell();
        LayerShell.set_exclusive_zone(this.widget, asNumber(value, 0));
        return true;
      // A GTK margin on a layer surface does nothing; the compositor has to be
      // told about the gap instead.
      case "gap":
        this.ensureLayerShell();
        this.applyGap(asNumber(value, 0));
        return true;
      case "keyboard-mode":
        this.ensureLayerShell();
        LayerShell.set_keyboard_mode(
          this.widget,
          asEnum(KEYBOARD_MODES, value, KEYBOARD_MODES.none),
        );
        return true;
      default:
        return super.attr(name, value);
    }
  }

  override insert(child: SElement): void {
    if (child.slotName === "titlebar") {
      this.widget.set_titlebar(child.widget);
      return;
    }
    this.widget.set_child(child.widget);
  }

  override remove(child: SElement): void {
    if (child.slotName === "titlebar") {
      this.widget.set_titlebar(null);
      return;
    }
    this.widget.set_child(null);
  }

  private ensureLayerShell(): void {
    if (this.layered) {
      return;
    }
    LayerShell.init_for_window(this.widget);
    this.layered = true;
  }

  private applyAnchors(edges: string): void {
    const wanted = edges.split(/[\s,]+/).filter((edge) => edge.length > 0);
    for (const [name, edge] of Object.entries(EDGES)) {
      LayerShell.set_anchor(this.widget, edge, wanted.includes(name));
    }
  }

  private applyGap(value: number): void {
    for (const edge of Object.values(EDGES)) {
      LayerShell.set_margin(this.widget, edge, value);
    }
  }
}
