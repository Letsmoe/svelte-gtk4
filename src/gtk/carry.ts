import GLib from "gi://GLib";
import type Gtk from "gi://Gtk?version=4.0";

// Widgets a drag moves are moved here, on the frame the pointer moved, rather
// than by the view that listens to the drag. A view that runs in another
// process would otherwise move them a round trip late, every frame.
//
// A press with `carry="name"` drags the group `name`: every widget with
// `carried-by="name"` is shown shifted by the pointer's travel once it passes
// `carry-threshold`, on top of the margins its view gave it. The view only
// learns that the drag carries (`detail.carried`) and where it ended.
//
// When the drag ends, the carried widgets stay where they were let go until
// the view has answered the drop — by moving them, or not. Then each slides
// from there to its margins over its `glide` milliseconds, or jumps if it has
// none. Who counts as the answer is the press's AnswerWaiter: the next idle
// for a view in this process, the client's next batch for a remote one.
//
// A widget with `banded-by="name"` is the group's rubber band: shown while
// the drag is on, spanning its start point to the pointer, in the pressed
// widget's coordinates. It suits a press and a band that share an origin.

export interface Point {
  x: number;
  y: number;
}

/** Runs `release` once whatever the view did about a finished drag is on screen. */
export type AnswerWaiter = (release: () => void) => void;

const DEFAULT_THRESHOLD_PX = 4;
const MAX_MARGIN = 32767;
const ORIGIN: Point = { x: 0, y: 0 };

interface Glide {
  from: Point;
  current: Point;
  startedAt: number;
  tickId: number;
}

interface Carried {
  widget: Gtk.Widget;
  group: string;
  // The margins the view set; what is shown is these plus the shift.
  base: Point;
  glideMs: number;
  glide: Glide | null;
  // Where the widget was let go, held until the drop is answered.
  held: Point | null;
}

interface Carrier {
  group: string;
  threshold: number;
  waiter: AnswerWaiter;
}

interface Group {
  members: Set<Carried>;
  bands: Set<Gtk.Widget>;
  held: Set<Carried>;
  start: Point;
  travel: Point;
  dragging: boolean;
  carrying: boolean;
  // Bumped by every drag, so a late answer to an earlier one releases nothing.
  generation: number;
}

const groups = new Map<string, Group>();
const carriedWidgets = new WeakMap<Gtk.Widget, Carried>();
const carriers = new WeakMap<Gtk.Widget, Carrier>();
const bandGroups = new WeakMap<Gtk.Widget, string>();

export function setCarry(widget: Gtk.Widget, group: string): void {
  carrierOf(widget).group = group;
}

export function setCarryThreshold(widget: Gtk.Widget, pixels: number): void {
  carrierOf(widget).threshold = Math.max(0, pixels);
}

export function setAnswerWaiter(widget: Gtk.Widget, waiter: AnswerWaiter): void {
  carrierOf(widget).waiter = waiter;
}

export function setCarriedBy(widget: Gtk.Widget, group: string): void {
  const record = recordOf(widget);
  leaveGroup(record);
  record.group = group;
  joinGroup(record);
  place(record);
}

export function setGlide(widget: Gtk.Widget, milliseconds: number): void {
  recordOf(widget).glideMs = Math.max(0, milliseconds);
}

export function setBandedBy(widget: Gtk.Widget, group: string): void {
  const previous = bandGroups.get(widget);
  if (previous !== undefined) {
    groupOf(previous).bands.delete(widget);
  }
  bandGroups.set(widget, group);
  if (group === "") {
    return;
  }
  const band = groupOf(group);
  band.bands.add(widget);
  drawBand(widget, band);
}

/** A view setting `margin-start` or `margin-top`; a carried widget adds its shift. */
export function setPlacement(widget: Gtk.Widget, edge: "start" | "top", value: number): void {
  const record = carriedWidgets.get(widget);
  if (record === undefined) {
    setMargin(widget, edge, value);
    return;
  }
  if (edge === "start") {
    record.base = { x: value, y: record.base.y };
  } else {
    record.base = { x: record.base.x, y: value };
  }
  place(record);
}

/** Whether the drag on this pressed widget has passed its threshold. */
export function isCarrying(widget: Gtk.Widget): boolean {
  const group = carryingGroupOf(widget);
  return group !== null && group.carrying;
}

export function beginCarry(widget: Gtk.Widget, start: Point): void {
  const group = carryingGroupOf(widget);
  if (group === null) {
    return;
  }
  releaseHeld(group, false);
  pruneUnparented(group);
  for (const record of group.members) {
    stopGlide(record);
    place(record);
  }
  group.generation += 1;
  group.start = start;
  group.travel = ORIGIN;
  group.dragging = true;
  group.carrying = false;
  drawBands(group);
}

export function moveCarry(widget: Gtk.Widget, travel: Point): void {
  const group = carryingGroupOf(widget);
  if (group === null || !group.dragging) {
    return;
  }
  group.travel = travel;
  if (!group.carrying && Math.hypot(travel.x, travel.y) >= thresholdOf(widget)) {
    group.carrying = true;
  }
  drawBands(group);
  if (!group.carrying) {
    return;
  }
  for (const record of group.members) {
    place(record);
  }
}

export function endCarry(widget: Gtk.Widget, travel: Point): void {
  const group = carryingGroupOf(widget);
  if (group === null || !group.dragging) {
    return;
  }
  moveCarry(widget, travel);
  group.dragging = false;
  drawBands(group);
  if (!group.carrying) {
    return;
  }
  holdMembers(group);
  const generation = group.generation;
  carrierOf(widget).waiter(once(() => {
    if (group.generation === generation) {
      releaseHeld(group, true);
    }
  }));
}

function holdMembers(group: Group): void {
  for (const record of group.members) {
    record.held = { x: record.base.x + group.travel.x, y: record.base.y + group.travel.y };
    group.held.add(record);
  }
}

function releaseHeld(group: Group, gliding: boolean): void {
  const held = [...group.held];
  group.held.clear();
  group.carrying = false;
  for (const record of held) {
    releaseOne(record, gliding);
  }
}

function releaseOne(record: Carried, gliding: boolean): void {
  if (record.held === null) {
    return;
  }
  const from = { x: record.held.x - record.base.x, y: record.held.y - record.base.y };
  record.held = null;
  if (!gliding || record.glideMs === 0 || !record.widget.get_mapped()) {
    place(record);
    return;
  }
  startGlide(record, from);
}

function startGlide(record: Carried, from: Point): void {
  stopGlide(record);
  const glide: Glide = { from, current: from, startedAt: -1, tickId: 0 };
  record.glide = glide;
  glide.tickId = record.widget.add_tick_callback((_widget, clock) =>
    stepGlide(record, glide, clock.get_frame_time()),
  );
  place(record);
}

function stepGlide(record: Carried, glide: Glide, now: number): boolean {
  if (record.glide !== glide) {
    return GLib.SOURCE_REMOVE;
  }
  if (glide.startedAt < 0) {
    glide.startedAt = now;
  }
  const progress = Math.min(1, (now - glide.startedAt) / (record.glideMs * 1000));
  const remaining = 1 - easeOut(progress);
  glide.current = { x: glide.from.x * remaining, y: glide.from.y * remaining };
  if (progress >= 1) {
    record.glide = null;
  }
  place(record);
  return progress < 1;
}

function stopGlide(record: Carried): void {
  if (record.glide === null) {
    return;
  }
  record.widget.remove_tick_callback(record.glide.tickId);
  record.glide = null;
}

function place(record: Carried): void {
  if (record.held !== null) {
    return;
  }
  const shift = shiftOf(record);
  setMargin(record.widget, "start", record.base.x + shift.x);
  setMargin(record.widget, "top", record.base.y + shift.y);
}

function shiftOf(record: Carried): Point {
  if (record.glide !== null) {
    return record.glide.current;
  }
  const group = groups.get(record.group);
  if (group === undefined || !group.dragging || !group.carrying || !group.members.has(record)) {
    return ORIGIN;
  }
  return group.travel;
}

function drawBands(group: Group): void {
  for (const band of group.bands) {
    drawBand(band, group);
  }
}

function drawBand(band: Gtk.Widget, group: Group): void {
  band.set_visible(group.dragging);
  if (!group.dragging) {
    return;
  }
  const end = { x: group.start.x + group.travel.x, y: group.start.y + group.travel.y };
  setMargin(band, "start", Math.min(group.start.x, end.x));
  setMargin(band, "top", Math.min(group.start.y, end.y));
  band.set_size_request(Math.round(Math.abs(group.travel.x)), Math.round(Math.abs(group.travel.y)));
}

function setMargin(widget: Gtk.Widget, edge: "start" | "top", value: number): void {
  const margin = Math.max(0, Math.min(MAX_MARGIN, Math.round(value)));
  if (edge === "start") {
    widget.set_margin_start(margin);
    return;
  }
  widget.set_margin_top(margin);
}

function recordOf(widget: Gtk.Widget): Carried {
  const existing = carriedWidgets.get(widget);
  if (existing !== undefined) {
    return existing;
  }
  const record: Carried = {
    widget,
    group: "",
    base: { x: widget.get_margin_start(), y: widget.get_margin_top() },
    glideMs: 0,
    glide: null,
    held: null,
  };
  carriedWidgets.set(widget, record);
  return record;
}

function joinGroup(record: Carried): void {
  if (record.group === "") {
    return;
  }
  groupOf(record.group).members.add(record);
}

// A widget taken out of the tree for good — a ghost from the last drag —
// leaves its group when the next drag starts. Nothing watches for removal:
// a signal on a widget can fire while GJS is collecting it.
function pruneUnparented(group: Group): void {
  for (const record of group.members) {
    if (record.widget.get_parent() === null) {
      stopGlide(record);
      group.members.delete(record);
    }
  }
  for (const band of group.bands) {
    if (band.get_parent() === null) {
      group.bands.delete(band);
    }
  }
}

function leaveGroup(record: Carried): void {
  const group = groups.get(record.group);
  if (group !== undefined) {
    group.members.delete(record);
  }
}

function groupOf(name: string): Group {
  const existing = groups.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const group: Group = {
    members: new Set(),
    bands: new Set(),
    held: new Set(),
    start: ORIGIN,
    travel: ORIGIN,
    dragging: false,
    carrying: false,
    generation: 0,
  };
  groups.set(name, group);
  return group;
}

function carrierOf(widget: Gtk.Widget): Carrier {
  const existing = carriers.get(widget);
  if (existing !== undefined) {
    return existing;
  }
  const carrier: Carrier = { group: "", threshold: DEFAULT_THRESHOLD_PX, waiter: nextIdle };
  carriers.set(widget, carrier);
  return carrier;
}

function carryingGroupOf(widget: Gtk.Widget): Group | null {
  const carrier = carriers.get(widget);
  if (carrier === undefined || carrier.group === "") {
    return null;
  }
  return groupOf(carrier.group);
}

function thresholdOf(widget: Gtk.Widget): number {
  return carrierOf(widget).threshold;
}

// A view in this process answers in its event handler, and Svelte draws the
// answer from a microtask; both have run by the next idle.
function nextIdle(release: () => void): void {
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    release();
    return GLib.SOURCE_REMOVE;
  });
}

function once(action: () => void): () => void {
  let done = false;
  return () => {
    if (done) {
      return;
    }
    done = true;
    action();
  };
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
