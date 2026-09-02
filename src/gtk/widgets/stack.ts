import Gtk from "gi://Gtk?version=4.0";
import type { SElement } from "../../dom/nodes";
import { asBool, asEnum, asNumber, asString } from "../attrs";
import { Widget } from "./base";
import { STACK_TRANSITION } from "./enums";

/**
 * One child visible at a time, chosen by `page`. Each child names itself with
 * `name`, and optionally titles itself with `title` for a switcher to show.
 * Both are read at insertion, so they have to be literals.
 *
 * Stack pages have no ordering API, so children always land at the end
 * whatever order the node tree puts them in.
 */
export class GtkStack extends Widget<Gtk.Stack> {
  static override readonly tag = "gtkstack";

  private nextName = 0;

  constructor(node: SElement) {
    super(node, new Gtk.Stack());
  }

  override attr(name: string, value: unknown): boolean {
    switch (name) {
      case "page":
        this.widget.set_visible_child_name(asString(value));
        return true;
      case "transition":
        this.widget.set_transition_type(
          asEnum(STACK_TRANSITION, value, Gtk.StackTransitionType.NONE),
        );
        return true;
      case "duration":
        this.widget.set_transition_duration(asNumber(value, 200));
        return true;
      case "hhomogeneous":
        this.widget.set_hhomogeneous(asBool(value));
        return true;
      case "vhomogeneous":
        this.widget.set_vhomogeneous(asBool(value));
        return true;
      case "homogeneous":
        this.widget.set_hhomogeneous(asBool(value));
        this.widget.set_vhomogeneous(asBool(value));
        return true;
      // Grows and shrinks between page sizes rather than jumping.
      case "interpolate-size":
        this.widget.set_interpolate_size(asBool(value));
        return true;
      default:
        return super.attr(name, value);
    }
  }

  override insert(child: SElement): void {
    const name = asString(child.getAttribute("name"));
    const title = child.getAttribute("title");
    const key = name === "" ? `page-${this.nextName++}` : name;

    if (title === null) {
      this.widget.add_named(child.widget, key);
      return;
    }
    this.widget.add_titled(child.widget, key, asString(title));
  }

  override remove(child: SElement): void {
    this.widget.remove(child.widget);
  }
}
