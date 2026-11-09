// The client half: Svelte runs against `dom/` as it always does, and instead
// of a GTK mirror every change to the tree is queued as an operation and sent
// to the host in one batch once the runtime has finished. The client never
// holds a widget; `event.target.widget` is a stand-in that answers from the
// state the host sent with the event.
//
// A node is announced, given an id and described to the host, the moment it
// is inserted under a node the host already knows. A subtree built while
// detached is announced whole when it attaches, so changes made to it before
// then need no operations of their own.

import "../dom/globals";
import { flushSync, mount, unmount } from "svelte";
import { setMirror } from "../dom/hooks";
import {
  COMMENT_NODE,
  type EventHandler,
  SElement,
  SNode,
  SText,
  setElementBackend,
} from "../dom/nodes";
import {
  type HostMessage,
  OP_CALL,
  OP_CREATE_ELEMENT,
  OP_CREATE_TEXT,
  OP_DROP,
  OP_INSERT,
  OP_LISTEN,
  OP_REMOVE,
  OP_ROOT,
  OP_SET_ATTRIBUTE,
  OP_SET_TEXT,
  type Operation,
  type WidgetState,
} from "./protocol";

export interface ClientOptions {
  /** Props every instance gets besides the host's, like a bus. */
  props?: (instance: number) => Record<string, unknown>;
  /** Messages the app layer above this sends itself through the host. */
  onApp?: (data: unknown) => void;
}

interface Instance {
  component: Record<string, unknown>;
  props: Record<string, unknown>;
  root: SElement;
}

interface Transport {
  send(text: string): void;
}

const ids = new Map<SNode, number>();
const nodes = new Map<number, SNode>();
const listeners = new WeakMap<SElement, Map<string, EventHandler[]>>();
const states = new WeakMap<SElement, WidgetState>();
const instances = new Map<number, Instance>();
let detached = new Set<SNode>();
let pending: Operation[] = [];
let flushScheduled = false;
let nextId = 1;
let views: Record<string, unknown> = {};
let options: ClientOptions = {};
let transport: Transport = { send() {} };

/**
 * Starts a client in a runner: `globalThis.__runner.send` is the way out,
 * and the runner calls `globalThis.__receive` with every message in.
 */
export function startClient(
  viewsByName: Record<string, unknown>,
  clientOptions: ClientOptions = {},
): void {
  views = viewsByName;
  options = clientOptions;
  transport = (globalThis as any).__runner;
  setElementBackend({ created, attributeChanged, listenerAdded });
  setMirror({ inserted, removed, textChanged });
  (globalThis as any).__receive = receive;
  send({ t: "ready" });
}

/** Sends a message to the app layer on the host side. */
export function sendApp(data: unknown): void {
  send({ t: "app", data });
}

function send(message: unknown): void {
  transport.send(JSON.stringify(message));
}

function receive(text: string): void {
  const message = JSON.parse(text) as HostMessage;
  try {
    handle(message);
  } catch (error) {
    rethrowIfFatal(error);
    console.error("svelte-gtk4 client:", errorText(error));
  }
  flushSync();
  flushNow();
}

function handle(message: HostMessage): void {
  switch (message.t) {
    case "mount":
      mountInstance(message.instance, message.view, message.props);
      return;
    case "props":
      updateProps(message.instance, message.props);
      return;
    case "unmount":
      unmountInstance(message.instance);
      return;
    case "event":
      dispatch(message.id, message.type, message.detail, message.state);
      return;
    case "app":
      if (options.onApp !== undefined) {
        options.onApp(message.data);
      }
      return;
    case "ping":
      send({ t: "pong", seq: message.seq });
      return;
  }
}

function mountInstance(
  instance: number,
  view: string,
  hostProps: Record<string, unknown>,
): void {
  const View = views[view];
  if (View === undefined) {
    send({ t: "error", instance, message: `no view named "${view}"` });
    return;
  }
  const root = new SElement("#root");
  queue([OP_ROOT, instance, register(root)]);
  const props = $state({ ...hostProps, ...extraProps(instance) });
  try {
    const component = mount(View as any, { target: root as any, props });
    instances.set(instance, { component, props, root });
  } catch (error) {
    send({ t: "error", instance, message: errorText(error) });
  }
}

function extraProps(instance: number): Record<string, unknown> {
  if (options.props === undefined) {
    return {};
  }
  return options.props(instance);
}

function updateProps(instance: number, hostProps: Record<string, unknown>): void {
  const found = instances.get(instance);
  if (found === undefined) {
    return;
  }
  Object.assign(found.props, hostProps);
}

function unmountInstance(instance: number): void {
  const found = instances.get(instance);
  if (found === undefined) {
    return;
  }
  instances.delete(instance);
  unmount(found.component);
  forget(found.root);
}

function dispatch(id: number, type: string, detail: unknown, state: WidgetState): void {
  const node = nodes.get(id);
  if (!(node instanceof SElement)) {
    return;
  }
  states.set(node, state);
  const byType = listeners.get(node);
  if (byType === undefined) {
    return;
  }
  const handlers = byType.get(type);
  if (handlers === undefined) {
    return;
  }
  for (const handler of handlers) {
    handler.call(node, eventFor(node, type, detail));
  }
}

// The same shape gtk/events.ts fires, so a handler cannot tell the two apart.
function eventFor(node: SElement, type: string, detail: unknown): unknown {
  return {
    type,
    target: node,
    currentTarget: node,
    detail,
    cancelBubble: false,
    defaultPrevented: false,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
}

// ── the element backend ────────────────────────────────────────────────

function created(node: SElement): void {
  node.impl = { widget: widgetStandIn(node) };
}

function attributeChanged(node: SElement, name: string, value: unknown): void {
  const id = ids.get(node);
  if (id === undefined) {
    return;
  }
  queue([OP_SET_ATTRIBUTE, id, name, wireValue(value)]);
}

function listenerAdded(node: SElement, type: string, handler: EventHandler): void {
  let byType = listeners.get(node);
  if (byType === undefined) {
    byType = new Map();
    listeners.set(node, byType);
  }
  const handlers = byType.get(type);
  if (handlers !== undefined) {
    handlers.push(handler);
    return;
  }
  byType.set(type, [handler]);
  const id = ids.get(node);
  if (id !== undefined) {
    queue([OP_LISTEN, id, type]);
  }
}

// What a view reads off a widget, answered from the last event's state, and
// the few widget methods a view calls, sent on as operations. get_root and
// compute_bounds answer the shapes GTK's do, from where the host said the
// widget sits in its window.
function widgetStandIn(node: SElement): Record<string, (...args: unknown[]) => unknown> {
  return {
    get_width: () => orDefault(stateOf(node).width, 0),
    get_height: () => orDefault(stateOf(node).height, 0),
    get_text: () => orDefault(stateOf(node).text, ""),
    get_value: () => orDefault(stateOf(node).value, 0),
    get_active: () => orDefault(stateOf(node).active, false),
    get_selected: () => orDefault(stateOf(node).selected, 0),
    get_root: () => rootStandIn(stateOf(node)),
    compute_bounds: () => [stateOf(node).x !== undefined, boundsStandIn(stateOf(node))],
    grab_focus: () => callMethod(node, "grab_focus"),
  };
}

function rootStandIn(state: WidgetState): Record<string, () => number> {
  return {
    get_width: () => orDefault(state.rootWidth, 0),
    get_height: () => orDefault(state.rootHeight, 0),
  };
}

function boundsStandIn(state: WidgetState): Record<string, () => number> {
  return {
    get_x: () => orDefault(state.x, 0),
    get_y: () => orDefault(state.y, 0),
    get_width: () => orDefault(state.width, 0),
    get_height: () => orDefault(state.height, 0),
  };
}

function stateOf(node: SElement): WidgetState {
  const state = states.get(node);
  if (state === undefined) {
    return {};
  }
  return state;
}

function orDefault<T>(value: T | undefined, fallback: T): T {
  if (value === undefined) {
    return fallback;
  }
  return value;
}

function callMethod(node: SElement, method: string): boolean {
  const id = ids.get(node);
  if (id === undefined) {
    return false;
  }
  queue([OP_CALL, id, method]);
  return true;
}

// ── the mirror hooks ───────────────────────────────────────────────────

function inserted(child: SNode): void {
  const parent = child.parentNode;
  if (parent === null) {
    return;
  }
  const parentId = ids.get(parent);
  if (parentId === undefined) {
    return;
  }
  const childId = announce(child);
  if (childId === 0) {
    return;
  }
  detached.delete(child);
  queue([OP_INSERT, parentId, childId, announcedAfter(child)]);
}

function removed(child: SNode, formerParent: SNode): void {
  const id = ids.get(child);
  if (id === undefined || !ids.has(formerParent)) {
    return;
  }
  queue([OP_REMOVE, id]);
  detached.add(child);
}

function textChanged(node: SText): void {
  const id = ids.get(node);
  if (id === undefined) {
    return;
  }
  queue([OP_SET_TEXT, id, node.data]);
}

// ── announcing and forgetting ──────────────────────────────────────────

function register(node: SNode): number {
  const id = nextId++;
  ids.set(node, id);
  nodes.set(id, node);
  return id;
}

/** The node's id, describing it and its subtree first if it has none; 0 for a comment. */
function announce(node: SNode): number {
  if (node.nodeType === COMMENT_NODE) {
    return 0;
  }
  const known = ids.get(node);
  if (known !== undefined) {
    return known;
  }
  const id = register(node);
  if (node instanceof SText) {
    queue([OP_CREATE_TEXT, id, node.data]);
    return id;
  }
  if (node instanceof SElement) {
    describeElement(node, id);
  }
  return id;
}

function describeElement(node: SElement, id: number): void {
  queue([OP_CREATE_ELEMENT, id, node.tagName]);
  for (const [name, value] of node.attributes) {
    queue([OP_SET_ATTRIBUTE, id, name, wireValue(value)]);
  }
  const byType = listeners.get(node);
  if (byType !== undefined) {
    for (const type of byType.keys()) {
      queue([OP_LISTEN, id, type]);
    }
  }
  let child = node.firstChildNode;
  while (child !== null) {
    const childId = announce(child);
    if (childId !== 0) {
      queue([OP_INSERT, id, childId, 0]);
    }
    child = child.nextSiblingNode;
  }
}

/** The id of the next sibling the host knows, which the child goes before; 0 for the end. */
function announcedAfter(node: SNode): number {
  let sibling = node.nextSiblingNode;
  while (sibling !== null) {
    const id = ids.get(sibling);
    if (id !== undefined) {
      return id;
    }
    sibling = sibling.nextSiblingNode;
  }
  return 0;
}

function forget(node: SNode): void {
  const id = ids.get(node);
  if (id !== undefined) {
    ids.delete(node);
    nodes.delete(id);
  }
  let child = node.firstChildNode;
  while (child !== null) {
    forget(child);
    child = child.nextSiblingNode;
  }
}

// ── sending ────────────────────────────────────────────────────────────

function queue(operation: Operation): void {
  pending.push(operation);
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  queueMicrotask(flushNow);
}

// A node taken out and not put back by the end of the batch is gone.
function flushNow(): void {
  flushScheduled = false;
  for (const node of detached) {
    dropIfGone(node);
  }
  detached = new Set();
  if (pending.length === 0) {
    return;
  }
  const ops = pending;
  pending = [];
  send({ t: "batch", ops });
}

function dropIfGone(node: SNode): void {
  const id = ids.get(node);
  if (id === undefined) {
    return;
  }
  const parent = node.parentNode;
  if (parent !== null && ids.has(parent)) {
    return;
  }
  pending.push([OP_DROP, id]);
  forget(node);
}

// Attribute values cross as JSON; anything that does not survive the trip,
// like a function or a GObject the client could not have anyway, arrives as null.
function wireValue(value: unknown): unknown {
  if (value === undefined || typeof value === "function") {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

// QuickJS reports running out of memory as an InternalError; the runner has
// to see it to stop the client rather than let it carry on half-allocated.
function rethrowIfFatal(error: unknown): void {
  const internal = (globalThis as any).InternalError;
  if (internal !== undefined && error instanceof internal) {
    throw error;
  }
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (error.stack === undefined) {
    return error.message;
  }
  return `${error.message}\n${error.stack}`;
}
