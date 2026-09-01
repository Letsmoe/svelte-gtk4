import Gtk from "gi://Gtk?version=4.0";
import LayerShell from "gi://Gtk4LayerShell?version=1.0";
import Pango from "gi://Pango";
import type { SElement } from "../dom/nodes";
import { asBool, asNumber, asOrientation, asString } from "./attrs";
import { watchInputRegion } from "./inputRegion";

export interface WidgetSpec {
  create(): any;
  insert(parent: SElement, child: SElement, before: any): void;
  remove(parent: SElement, child: SElement): void;
  /** Returns true when the spec has consumed the attribute itself. */
  attr?(node: SElement, name: string, value: unknown): boolean;
  /** Present only on widgets whose content is text rather than children. */
  setText?(node: SElement, text: string): void;
}

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

const ELLIPSIZE: Record<string, Pango.EllipsizeMode> = {
  none: Pango.EllipsizeMode.NONE,
  start: Pango.EllipsizeMode.START,
  middle: Pango.EllipsizeMode.MIDDLE,
  end: Pango.EllipsizeMode.END,
};

// A Gtk.Box is the only widget with real ordered children, so it is the only
// place insertion position means anything.
const boxChildren = {
  insert(parent: SElement, child: SElement, before: any): void {
    if (before === null) {
      parent.widget.append(child.widget);
      return;
    }
    parent.widget.insert_child_after(child.widget, before.get_prev_sibling());
  },
  remove(parent: SElement, child: SElement): void {
    parent.widget.remove(child.widget);
  },
};

const singleChild = {
  insert(parent: SElement, child: SElement): void {
    parent.widget.set_child(child.widget);
  },
  remove(parent: SElement): void {
    parent.widget.set_child(null);
  },
};

const noChildren = {
  insert(parent: SElement): void {
    console.error(`svelte-gtk4: ${parent.tagName} takes no children`);
  },
  remove(): void {},
};

function boxAttr(node: SElement, name: string, value: unknown): boolean {
  if (name === "orientation") {
    node.widget.set_orientation(asOrientation(value));
    return true;
  }
  if (name === "spacing") {
    node.widget.set_spacing(asNumber(value, 0));
    return true;
  }
  return false;
}

export const SPECS: Record<string, WidgetSpec> = {
  gtkbox: {
    create: () => new Gtk.Box(),
    ...boxChildren,
    attr: boxAttr,
  },

  // A Box that reports pointer input; GTK4 delivers that through controllers,
  // which events.ts attaches on demand.
  gtkpressable: {
    create: () => new Gtk.Box(),
    ...boxChildren,
    attr: boxAttr,
  },

  gtkcenterbox: {
    create: () => new Gtk.CenterBox(),
    insert(parent: SElement, child: SElement): void {
      setSlot(parent, child.slotName, child.widget);
    },
    remove(parent: SElement, child: SElement): void {
      setSlot(parent, child.slotName, null);
    },
    attr: boxAttr,
  },

  gtkoverlay: {
    create: () => new Gtk.Overlay(),
    insert(parent: SElement, child: SElement): void {
      if (isOverlayChild(child)) {
        parent.widget.add_overlay(child.widget);
        return;
      }
      parent.widget.set_child(child.widget);
    },
    remove(parent: SElement, child: SElement): void {
      if (isOverlayChild(child)) {
        parent.widget.remove_overlay(child.widget);
        return;
      }
      parent.widget.set_child(null);
    },
  },

  gtkbutton: {
    create: () => new Gtk.Button(),
    ...singleChild,
    // A button is either a label or a wrapper around one child widget.
    // set_label would replace that child, so it only ever runs for buttons
    // that are already labelled or about to be.
    setText(node: SElement, text: string): void {
      if (text === "" && node.widget.get_label() === null) {
        return;
      }
      node.widget.set_label(text);
    },
    attr(node: SElement, name: string, value: unknown): boolean {
      if (name === "frame") {
        node.widget.set_has_frame(asBool(value));
        return true;
      }
      return false;
    },
  },

  gtklabel: {
    create: () => new Gtk.Label(),
    ...noChildren,
    setText(node: SElement, text: string): void {
      node.widget.set_label(text);
    },
    attr(node: SElement, name: string, value: unknown): boolean {
      if (name === "xalign") {
        node.widget.set_xalign(asNumber(value, 0.5));
        return true;
      }
      if (name === "wrap") {
        node.widget.set_wrap(asBool(value));
        return true;
      }
      if (name === "ellipsize") {
        node.widget.set_ellipsize(ellipsizeOf(value));
        return true;
      }
      if (name === "tabular") {
        setTabularNumbers(node.widget, asBool(value));
        return true;
      }
      return false;
    },
  },

  gtkicon: {
    create: () => new Gtk.Image(),
    ...noChildren,
    attr(node: SElement, name: string, value: unknown): boolean {
      if (name === "icon") {
        node.widget.set_from_icon_name(asString(value));
        return true;
      }
      if (name === "file") {
        node.widget.set_from_file(asString(value));
        return true;
      }
      if (name === "size") {
        node.widget.set_pixel_size(asNumber(value, -1));
        return true;
      }
      return false;
    },
  },

  gtkwindow: {
    create: createWindow,
    ...singleChild,
    attr: windowAttr,
  },
};

function createWindow(): Gtk.Window {
  const window = new Gtk.Window();
  // Idle until something under it carries `input`; then it starts publishing
  // an input region instead of claiming the whole surface.
  watchInputRegion(window);
  return window;
}

function setSlot(parent: SElement, slot: string, widget: any): void {
  if (slot === "start") {
    parent.widget.set_start_widget(widget);
    return;
  }
  if (slot === "end") {
    parent.widget.set_end_widget(widget);
    return;
  }
  parent.widget.set_center_widget(widget);
}

function isOverlayChild(child: SElement): boolean {
  return child.hasAttribute("overlay");
}

function codeOf(
  table: Record<string, number>,
  value: unknown,
  fallback: number,
): number {
  const code = table[asString(value)];
  if (code === undefined) {
    return fallback;
  }
  return code;
}

function ellipsizeOf(value: unknown): Pango.EllipsizeMode {
  const mode = ELLIPSIZE[asString(value)];
  if (mode === undefined) {
    return Pango.EllipsizeMode.NONE;
  }
  return mode;
}

// GTK CSS has no font-variant-numeric, so fixed-width digits are a Pango
// attribute set on the label itself.
function setTabularNumbers(label: Gtk.Label, enabled: boolean): void {
  if (!enabled) {
    label.set_attributes(null);
    return;
  }
  const attributes = new Pango.AttrList();
  attributes.insert(Pango.attr_font_features_new("tnum=1"));
  label.set_attributes(attributes);
}

const layerInitialized = new WeakSet<object>();

function windowAttr(node: SElement, name: string, value: unknown): boolean {
  const window = node.widget as Gtk.Window;

  switch (name) {
    case "title":
      window.set_title(asString(value));
      return true;
    case "decorated":
      window.set_decorated(asBool(value));
      return true;
    // Setting a default size at all makes a layer surface fall back to its
    // natural size, overriding what its anchors would have taken from the
    // compositor — so these are only ever touched when asked for.
    case "default-width":
      window.set_default_size(asNumber(value, -1), window.default_height);
      return true;
    case "default-height":
      window.set_default_size(window.default_width, asNumber(value, -1));
      return true;
    case "layer":
      ensureLayerShell(window);
      LayerShell.set_layer(window, codeOf(LAYERS, value, LAYERS.top));
      return true;
    case "namespace":
      ensureLayerShell(window);
      LayerShell.set_namespace(window, asString(value));
      return true;
    case "anchor":
      ensureLayerShell(window);
      applyAnchors(window, asString(value));
      return true;
    case "exclusive-zone":
      ensureLayerShell(window);
      LayerShell.set_exclusive_zone(window, asNumber(value, 0));
      return true;
    case "keyboard-mode":
      ensureLayerShell(window);
      LayerShell.set_keyboard_mode(
        window,
        codeOf(KEYBOARD_MODES, value, KEYBOARD_MODES.none),
      );
      return true;
    default:
      return false;
  }
}

// gtk4-layer-shell has to be initialized before the window is realized, and
// exactly once.
function ensureLayerShell(window: Gtk.Window): void {
  if (layerInitialized.has(window)) {
    return;
  }
  LayerShell.init_for_window(window);
  layerInitialized.add(window);
}

function applyAnchors(window: Gtk.Window, edges: string): void {
  const wanted = edges.split(/[ ,]+/).filter((edge) => edge.length > 0);
  for (const [name, edge] of Object.entries(EDGES)) {
    LayerShell.set_anchor(window, edge, wanted.includes(name));
  }
}
