import Gtk from "gi://Gtk?version=4.0";
import type { EventHandler, SElement } from "../dom/nodes";

// GTK4 splits input between widget signals and event controllers, so these
// names have no signal to connect to and get a controller instead.
const CONTROLLER_EVENTS = [
  "press",
  "hoverstart",
  "hoverend",
  "hovermove",
  "dragstart",
  "dragmove",
  "dragend",
];

interface Point {
  x: number;
  y: number;
}

interface Controllers {
  click: Gtk.GestureClick | null;
  motion: Gtk.EventControllerMotion | null;
  drag: Gtk.GestureDrag | null;
  // Where the dragged widget sat when the drag began. See `originShift`.
  dragOrigin: Point | null;
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
    addPressListener(node, type, handler);
    return;
  }
  if (type.startsWith("drag")) {
    addDragListener(node, type, handler);
    return;
  }
  addMotionListener(node, type, handler);
}

function addPressListener(
  node: SElement,
  type: string,
  handler: EventHandler,
): void {
  clickGesture(node).connect("released", (gesture, count, x, y) => {
    fire(node, type, handler, {
      x,
      y,
      // Which mouse button, so a view can tell a click from a context menu
      // without a second gesture. 1 primary, 2 middle, 3 secondary.
      button: gesture.get_current_button(),
      // How many clicks this one is part of: 2 is a double click, which a
      // desktop needs to tell "select" from "open".
      count,
      width: node.widget.get_width(),
      height: node.widget.get_height(),
    });
  });
}

function addMotionListener(
  node: SElement,
  type: string,
  handler: EventHandler,
): void {
  const motion = motionController(node);
  if (type === "hoverstart") {
    motion.connect("enter", (_controller, x, y) =>
      fire(node, type, handler, pointDetail(node, x, y)),
    );
    return;
  }
  if (type === "hovermove") {
    motion.connect("motion", (_controller, x, y) =>
      fire(node, type, handler, pointDetail(node, x, y)),
    );
    return;
  }
  motion.connect("leave", () => fire(node, type, handler, null));
}

// A drag reports where it started and how far it has travelled since, both in
// the widget's own coordinates — which is what a rubber band or a dragged icon
// needs, and what a raw motion stream would have to reconstruct.
function addDragListener(
  node: SElement,
  type: string,
  handler: EventHandler,
): void {
  const drag = dragGesture(node);
  if (type === "dragstart") {
    drag.connect("drag-begin", (_gesture, x, y) =>
      fire(node, type, handler, dragDetail(node, x, y, 0, 0)),
    );
    return;
  }
  const signal = type === "dragmove" ? "drag-update" : "drag-end";
  drag.connect(signal, (gesture, dx, dy) => {
    const [ok, x, y] = gesture.get_start_point();
    if (!ok) {
      return;
    }
    const shift = originShift(node);
    fire(node, type, handler, dragDetail(node, x, y, dx + shift.x, dy + shift.y));
  });
}

/**
 * How far the dragged widget has travelled since the drag began.
 *
 * `GtkGestureDrag` measures its offset between two points in the widget's own
 * allocation coordinates: the start point, captured once at `drag-begin`, and
 * the current point, recomputed against the widget's allocation on every
 * event. A widget that a view *moves in response to the drag* therefore shifts
 * the frame the offset is measured in, and the offset comes back short by
 * exactly how far the widget has gone. Feeding that back into the position is
 * an oscillator — `offset = pointer travel - previous offset` — and the widget
 * jitters instead of following the pointer.
 *
 * Adding the widget's own travel back cancels the moving frame out, so the
 * reported delta is the pointer's, whatever the view does with it. A widget
 * that stays put (a rubber band's background) shifts by zero and is unchanged.
 *
 * GTK computes the gesture's point and this origin from the same allocation,
 * so the two never disagree even when the event lands before a relayout.
 */
function originShift(node: SElement): Point {
  const slots = slotsFor(node);
  if (slots.dragOrigin === null) {
    return { x: 0, y: 0 };
  }
  const now = originOf(node.widget);
  if (now === null) {
    return { x: 0, y: 0 };
  }
  return { x: now.x - slots.dragOrigin.x, y: now.y - slots.dragOrigin.y };
}

/** The widget's position in its root's coordinates, or null if unrooted. */
function originOf(widget: Gtk.Widget): Point | null {
  const root = widget.get_root();
  if (root === null) {
    return null;
  }
  const [ok, bounds] = widget.compute_bounds(root as unknown as Gtk.Widget);
  if (!ok) {
    return null;
  }
  return { x: bounds.origin.x, y: bounds.origin.y };
}

function pointDetail(node: SElement, x: number, y: number): unknown {
  return {
    x,
    y,
    width: node.widget.get_width(),
    height: node.widget.get_height(),
  };
}

function dragDetail(
  node: SElement,
  x: number,
  y: number,
  dx: number,
  dy: number,
): unknown {
  return {
    startX: x,
    startY: y,
    dx,
    dy,
    x: x + dx,
    y: y + dy,
    width: node.widget.get_width(),
    height: node.widget.get_height(),
  };
}

function clickGesture(node: SElement): Gtk.GestureClick {
  const existing = slotsFor(node);
  if (existing.click === null) {
    existing.click = new Gtk.GestureClick();
    // 0 is "any button": without it the gesture only ever sees the primary one
    // and a secondary click reaches nothing.
    existing.click.set_button(0);
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

function dragGesture(node: SElement): Gtk.GestureDrag {
  const existing = slotsFor(node);
  if (existing.drag === null) {
    const gesture = new Gtk.GestureDrag();
    existing.drag = gesture;
    // Connected before any listener's own, so the origin is recorded whichever
    // of the three events a view actually subscribes to — and recorded first,
    // since GTK runs handlers in connection order.
    gesture.connect("drag-begin", () => {
      existing.dragOrigin = originOf(node.widget);
    });
    node.widget.add_controller(gesture);
  }
  return existing.drag;
}

function slotsFor(node: SElement): Controllers {
  let slots = controllers.get(node);
  if (slots === undefined) {
    slots = { click: null, motion: null, drag: null, dragOrigin: null };
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
