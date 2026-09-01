import Gtk from "gi://Gtk?version=4.0";
import type { EventHandler, SElement } from "../dom/nodes";

// GTK4 splits input between widget signals and event controllers, so these
// three names have no signal to connect to and get a controller instead.
const CONTROLLER_EVENTS = ["press", "hoverstart", "hoverend"];

interface Controllers {
  click: Gtk.GestureClick | null;
  motion: Gtk.EventControllerMotion | null;
}

const controllers = new WeakMap<SElement, Controllers>();

export function addListener(
  node: SElement,
  type: string,
  handler: EventHandler,
): void {
  if (node.widget === null) {
    return;
  }
  if (CONTROLLER_EVENTS.includes(type)) {
    addControllerListener(node, type, handler);
    return;
  }
  try {
    node.widget.connect(type, () => fire(node, type, handler, null));
  } catch {
    console.error(`svelte-gtk4: ${node.tagName} has no "${type}" signal`);
  }
}

function addControllerListener(
  node: SElement,
  type: string,
  handler: EventHandler,
): void {
  if (type === "press") {
    clickGesture(node).connect("released", (_gesture, _count, x, y) => {
      fire(node, type, handler, {
        x,
        y,
        width: node.widget.get_width(),
        height: node.widget.get_height(),
      });
    });
    return;
  }
  const motion = motionController(node);
  if (type === "hoverstart") {
    motion.connect("enter", () => fire(node, type, handler, null));
    return;
  }
  motion.connect("leave", () => fire(node, type, handler, null));
}

function clickGesture(node: SElement): Gtk.GestureClick {
  const existing = slotsFor(node);
  if (existing.click === null) {
    existing.click = new Gtk.GestureClick();
    node.widget.add_controller(existing.click);
  }
  return existing.click;
}

function motionController(node: SElement): Gtk.EventControllerMotion {
  const existing = slotsFor(node);
  if (existing.motion === null) {
    existing.motion = new Gtk.EventControllerMotion();
    node.widget.add_controller(existing.motion);
  }
  return existing.motion;
}

function slotsFor(node: SElement): Controllers {
  let slots = controllers.get(node);
  if (slots === undefined) {
    slots = { click: null, motion: null };
    controllers.set(node, slots);
  }
  return slots;
}

// Svelte wraps every handler in its delegation walker, which bails out as soon
// as it sees the event already sitting on the element it was bound to. Setting
// `target` to that element is what makes it bail.
function fire(
  node: SElement,
  type: string,
  handler: EventHandler,
  detail: unknown,
): void {
  handler.call(node, {
    type,
    target: node,
    currentTarget: node,
    detail,
    cancelBubble: false,
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  });
}
