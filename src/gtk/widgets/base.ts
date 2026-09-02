// One class per tag, one instance per element node. The instance owns the GTK
// widget, so anything a widget needs to remember — a provider, an adjustment,
// a resolved reference — is a field rather than an entry in a side table.

import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asAlign, asBool, asNumber, asString } from "../attrs";
import { markInput } from "../inputRegion";
import { register, unregister } from "../registry";
import { applyClasses, applyInlineCss } from "../style";

/** All the mirror needs from whatever a tag maps to. */
export interface Mount {
  readonly widget: any;
  /** Returns true when the attribute was recognised. */
  attr(name: string, value: unknown): boolean;
  insert(child: SElement, before: any): void;
  remove(child: SElement): void;
  /** Present only on widgets whose content is text rather than children. */
  setText?(text: string): void;
}

export interface MountClass {
  new (node: SElement): Mount;
  readonly tag: string;
}

export abstract class Widget<W extends Gtk.Widget = Gtk.Widget>
  implements Mount
{
  static readonly tag: string = "";

  private id = "";

  constructor(
    readonly node: SElement,
    readonly widget: W,
  ) {}

  // Attributes every widget understands. A subclass handles what it owns and
  // falls through to here for the rest.
  attr(name: string, value: unknown): boolean {
    switch (name) {
      case "class":
        applyClasses(this.node, value);
        return true;
      case "css":
        applyInlineCss(this.node, value);
        return true;
      // Both the CSS node name and the name other widgets reference this one by.
      case "id":
        this.setId(asString(value));
        return true;
      case "halign":
        this.widget.set_halign(asAlign(value));
        return true;
      case "valign":
        this.widget.set_valign(asAlign(value));
        return true;
      case "hexpand":
        this.widget.set_hexpand(asBool(value));
        return true;
      case "vexpand":
        this.widget.set_vexpand(asBool(value));
        return true;
      case "width":
        this.widget.set_size_request(
          asNumber(value, -1),
          this.widget.height_request,
        );
        return true;
      case "height":
        this.widget.set_size_request(
          this.widget.width_request,
          asNumber(value, -1),
        );
        return true;
      case "tooltip":
        this.widget.set_tooltip_text(asString(value));
        return true;
      case "visible":
        this.widget.set_visible(value === null ? true : asBool(value));
        return true;
      case "sensitive":
        this.widget.set_sensitive(value === null ? true : asBool(value));
        return true;
      case "focusable":
        this.widget.set_focusable(asBool(value));
        return true;
      case "opacity":
        this.widget.set_opacity(asNumber(value, 1));
        return true;
      case "margin":
        this.setMargin(asNumber(value, 0));
        return true;
      case "margin-top":
        this.widget.set_margin_top(asNumber(value, 0));
        return true;
      case "margin-bottom":
        this.widget.set_margin_bottom(asNumber(value, 0));
        return true;
      case "margin-start":
        this.widget.set_margin_start(asNumber(value, 0));
        return true;
      case "margin-end":
        this.widget.set_margin_end(asNumber(value, 0));
        return true;
      // Cuts children off at this widget's allocation, rounded corners
      // included. GTK4 CSS has no `overflow`, so clipping is a property.
      case "clip":
        this.widget.set_overflow(
          asBool(value) ? Gtk.Overflow.HIDDEN : Gtk.Overflow.VISIBLE,
        );
        return true;
      // Adds this widget's allocation to its layer surface's input region.
      // Once any widget on a surface asks for one, the rest of the surface
      // stops taking clicks.
      case "input":
        markInput(this.widget, asBool(value));
        return true;
      // Which of a parent's named positions this child occupies. Spelt `place`
      // rather than `slot` so Svelte's own slot handling never sees it.
      case "place":
        this.node.slotName = asString(value);
        return true;
      default:
        return false;
    }
  }

  insert(_child: SElement, _before: any): void {
    console.error(`svelte-gtk4: <${this.node.tagName}> takes no children`);
  }

  remove(_child: SElement): void {}

  private setId(id: string): void {
    if (this.id !== "") {
      unregister(this.id);
    }
    this.id = id;
    this.widget.set_name(id);
    register(id, this.widget);
  }

  private setMargin(value: number): void {
    this.widget.set_margin_top(value);
    this.widget.set_margin_bottom(value);
    this.widget.set_margin_start(value);
    this.widget.set_margin_end(value);
  }
}

/** A widget holding one child, set with `set_child()`. */
export abstract class Bin<W extends Gtk.Widget = any> extends Widget<W> {
  override insert(child: SElement): void {
    (this.widget as any).set_child(child.widget);
  }

  override remove(_child: SElement): void {
    (this.widget as any).set_child(null);
  }
}

/**
 * A widget with ordered children following the `Gtk.Box` protocol. Insertion
 * position is given as the widget to land in front of, which is spelled as the
 * one to land behind.
 */
export abstract class Container<W extends Gtk.Widget = any> extends Widget<W> {
  override insert(child: SElement, before: any): void {
    if (before === null) {
      (this.widget as any).append(child.widget);
      return;
    }
    (this.widget as any).insert_child_after(
      child.widget,
      before.get_prev_sibling(),
    );
  }

  override remove(child: SElement): void {
    (this.widget as any).remove(child.widget);
  }
}

/**
 * A widget with ordered children addressed by index rather than by sibling —
 * `Gtk.ListBox` and `Gtk.FlowBox`. Both wrap a plain child in a row of their
 * own, so the child sitting at a position is not always the widget there.
 */
export abstract class IndexedContainer<
  W extends Gtk.Widget = any,
> extends Widget<W> {
  override insert(child: SElement, before: any): void {
    if (before === null) {
      (this.widget as any).append(child.widget);
      return;
    }
    (this.widget as any).insert(child.widget, this.positionOf(before));
  }

  override remove(child: SElement): void {
    (this.widget as any).remove(child.widget);
  }

  private positionOf(widget: any): number {
    const row = wrapperOf(this.widget, widget);
    let at = 0;
    let sibling = this.widget.get_first_child();
    while (sibling !== null) {
      if (sibling === row) {
        return at;
      }
      at += 1;
      sibling = sibling.get_next_sibling();
    }
    return -1;
  }
}

/** The direct child of `parent` that `widget` sits in, or `widget` itself. */
export function wrapperOf(parent: Gtk.Widget, widget: any): any {
  let candidate = widget;
  while (candidate !== null && candidate.get_parent() !== parent) {
    candidate = candidate.get_parent();
  }
  if (candidate === null) {
    return widget;
  }
  return candidate;
}
