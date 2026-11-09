// The host half: a client's operations are checked against a policy and
// replayed into ordinary `SElement`/`SText` nodes under an anchor the host
// owns. From there `gtk/mirror.ts` draws them exactly as if Svelte had built
// them in this process.
//
// Everything a client sends is untrusted. An operation that breaks the
// protocol or a limit throws a ProtocolError, and the caller is expected to
// stop that client; an attribute GTK rejects is only logged.

import { SElement, SNode, SText } from "../dom/nodes";
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
  type WidgetState,
} from "./protocol";
import { type Policy, REFUSED, Rewrite } from "./policy";
import { EMBED_TAG, EmbedTable, type Embedder } from "./embed";

export class ProtocolError extends Error {}

export class RemoteTree {
  private readonly policy: Policy;
  private readonly send: (message: HostMessage) => void;
  private readonly embeds: EmbedTable;
  private readonly nodes = new Map<number, SNode>();
  private readonly idsByNode = new Map<SNode, number>();
  private readonly anchors = new Map<number, SElement>();
  // The root id each mounted instance's view hangs under.
  private readonly roots = new Map<number, number>();
  private readonly rootIds = new Set<number>();
  private readonly listenerCounts = new Map<number, number>();

  constructor(policy: Policy, send: (message: HostMessage) => void, embedder: Embedder | null = null) {
    this.policy = policy;
    this.send = send;
    this.embeds = new EmbedTable(embedder);
  }

  /** Where an instance's view goes; call before sending its mount. */
  attach(instance: number, anchor: SElement): void {
    this.anchors.set(instance, anchor);
  }

  /** Takes an instance's view off screen. Operations still in flight for it land nowhere. */
  detach(instance: number): void {
    const anchor = this.anchors.get(instance);
    this.anchors.delete(instance);
    const rootId = this.roots.get(instance);
    this.roots.delete(instance);
    if (rootId !== undefined) {
      this.bind(rootId, new SNode());
    }
    if (anchor !== undefined) {
      emptyNode(anchor);
    }
  }

  /** The client is gone: every view it drew comes off screen. The anchors stay for its successor. */
  reset(): void {
    this.embeds.disposeAll();
    for (const anchor of this.anchors.values()) {
      emptyNode(anchor);
    }
    this.nodes.clear();
    this.idsByNode.clear();
    this.roots.clear();
    this.rootIds.clear();
    this.listenerCounts.clear();
  }

  apply(ops: unknown): void {
    if (!Array.isArray(ops)) {
      throw new ProtocolError("a batch is not a list");
    }
    if (ops.length > this.policy.limits.opsPerBatch) {
      throw new ProtocolError(`a batch of ${ops.length} operations`);
    }
    for (const op of ops) {
      this.applyOne(op);
    }
  }

  private applyOne(op: unknown): void {
    if (!Array.isArray(op)) {
      throw new ProtocolError("an operation is not a list");
    }
    switch (op[0]) {
      case OP_CREATE_ELEMENT:
        this.createElement(idAt(op, 1), stringAt(op, 2));
        return;
      case OP_CREATE_TEXT:
        this.createText(idAt(op, 1), stringAt(op, 2));
        return;
      case OP_SET_TEXT:
        this.textNode(idAt(op, 1)).nodeValue = this.clampText(stringAt(op, 2));
        return;
      case OP_SET_ATTRIBUTE:
        this.setAttribute(idAt(op, 1), stringAt(op, 2), op[3]);
        return;
      case OP_INSERT:
        this.insert(idAt(op, 1), idAt(op, 2), numberAt(op, 3));
        return;
      case OP_REMOVE:
        this.remove(idAt(op, 1));
        return;
      case OP_LISTEN:
        this.listen(idAt(op, 1), stringAt(op, 2));
        return;
      case OP_DROP:
        this.drop(idAt(op, 1));
        return;
      case OP_CALL:
        this.call(idAt(op, 1), stringAt(op, 2));
        return;
      case OP_ROOT:
        this.root(numberAt(op, 1), idAt(op, 2));
        return;
      default:
        throw new ProtocolError(`unknown operation ${String(op[0])}`);
    }
  }

  private createElement(id: number, tag: string): void {
    this.claim(id);
    if (!this.policy.allowsTag(tag)) {
      throw new ProtocolError(`<${tag}> is not allowed`);
    }
    if (tag === EMBED_TAG) {
      this.bind(id, this.embeds.create());
      return;
    }
    try {
      this.bind(id, new SElement(tag));
    } catch (error) {
      throw new ProtocolError(`<${tag}> could not be built: ${String(error)}`);
    }
  }

  private createText(id: number, data: string): void {
    this.claim(id);
    this.bind(id, new SText(this.clampText(data)));
  }

  private bind(id: number, node: SNode): void {
    const previous = this.nodes.get(id);
    if (previous !== undefined) {
      this.idsByNode.delete(previous);
    }
    this.nodes.set(id, node);
    this.idsByNode.set(node, id);
  }

  private claim(id: number): void {
    if (this.nodes.has(id)) {
      throw new ProtocolError(`id ${id} is already in use`);
    }
    if (this.nodes.size >= this.policy.limits.nodes) {
      throw new ProtocolError(`more than ${this.policy.limits.nodes} nodes`);
    }
  }

  private setAttribute(id: number, name: string, value: unknown): void {
    const node = this.element(id);
    const checked = this.policy.attribute(node.tagName, name, value);
    if (checked === REFUSED) {
      console.warn(`svelte-gtk4 host: refused ${name} on <${node.tagName}>`);
      return;
    }
    if (this.embeds.setAttribute(node, name, checked)) {
      return;
    }
    if (checked instanceof Rewrite) {
      applyAttribute(node, checked.name, checked.value);
      return;
    }
    applyAttribute(node, name, checked);
  }

  private insert(parentId: number, childId: number, beforeId: number): void {
    const parent = this.node(parentId);
    const child = this.node(childId);
    if (this.rootIds.has(childId)) {
      throw new ProtocolError("a root cannot be inserted");
    }
    if (this.embeds.isEmbed(parent)) {
      throw new ProtocolError("an embed takes no children");
    }
    if (child.contains(parent)) {
      throw new ProtocolError("a node cannot go inside itself");
    }
    const before = this.beforeNode(parent, beforeId);
    if (this.depthOf(parent) + heightOf(child) > this.policy.limits.depth) {
      throw new ProtocolError(`deeper than ${this.policy.limits.depth}`);
    }
    parent.insertBefore(child, before);
  }

  // Counted from the client's root: the host's own tree above the anchor is
  // not the client's to spend.
  private depthOf(node: SNode): number {
    let depth = 0;
    let candidate: SNode | null = node;
    while (candidate !== null && !this.isRoot(candidate)) {
      depth += 1;
      candidate = candidate.parentNode;
    }
    return depth;
  }

  private isRoot(node: SNode): boolean {
    const id = this.idsByNode.get(node);
    return id !== undefined && this.rootIds.has(id);
  }

  private beforeNode(parent: SNode, beforeId: number): SNode | null {
    if (beforeId === 0) {
      return null;
    }
    const before = this.node(beforeId);
    if (before.parentNode !== parent) {
      throw new ProtocolError(`node ${beforeId} is not a child of the parent`);
    }
    return before;
  }

  private remove(id: number): void {
    if (this.rootIds.has(id)) {
      throw new ProtocolError("a root cannot be removed");
    }
    this.node(id).remove();
  }

  private drop(id: number): void {
    if (this.rootIds.has(id)) {
      throw new ProtocolError("a root cannot be dropped");
    }
    const node = this.node(id);
    node.remove();
    this.forget(node);
  }

  // What an embed holds is the host's, not the client's, so it is disposed
  // whole rather than walked.
  private forget(node: SNode): void {
    const id = this.idsByNode.get(node);
    if (id !== undefined) {
      this.idsByNode.delete(node);
      this.nodes.delete(id);
      this.listenerCounts.delete(id);
    }
    if (node instanceof SElement && this.embeds.isEmbed(node)) {
      this.embeds.dispose(node);
      return;
    }
    let child = node.firstChildNode;
    while (child !== null) {
      this.forget(child);
      child = child.nextSiblingNode;
    }
  }

  private listen(id: number, type: string): void {
    const node = this.element(id);
    if (!this.policy.allowsEvent(node.tagName, type)) {
      throw new ProtocolError(`${type} is not allowed on <${node.tagName}>`);
    }
    const count = this.listenerCountOf(id) + 1;
    if (count > this.policy.limits.listenersPerNode) {
      throw new ProtocolError(`more than ${this.policy.limits.listenersPerNode} listeners on one node`);
    }
    this.listenerCounts.set(id, count);
    node.addEventListener(type, (event: unknown) => {
      this.send({ t: "event", id, type, detail: plainDetail(event), state: stateOf(node.widget) });
    });
  }

  private listenerCountOf(id: number): number {
    const count = this.listenerCounts.get(id);
    if (count === undefined) {
      return 0;
    }
    return count;
  }

  private call(id: number, method: string): void {
    const node = this.element(id);
    if (!this.policy.allowsCall(node.tagName, method) || node.widget === null) {
      throw new ProtocolError(`${method} is not allowed on <${node.tagName}>`);
    }
    try {
      node.widget[method]();
    } catch (error) {
      console.warn(`svelte-gtk4 host: ${method} on <${node.tagName}>:`, error);
    }
  }

  // An instance the host already detached still gets a root, one that is
  // never drawn, so the operations that follow it stay valid.
  private root(instance: number, id: number): void {
    this.claim(id);
    this.rootIds.add(id);
    const anchor = this.anchors.get(instance);
    if (anchor === undefined || this.roots.has(instance)) {
      this.bind(id, new SNode());
      return;
    }
    this.roots.set(instance, id);
    this.bind(id, anchor);
  }

  private node(id: number): SNode {
    const node = this.nodes.get(id);
    if (node === undefined) {
      throw new ProtocolError(`no node ${id}`);
    }
    return node;
  }

  private element(id: number): SElement {
    const node = this.node(id);
    if (!(node instanceof SElement)) {
      throw new ProtocolError(`node ${id} is not an element`);
    }
    return node;
  }

  private textNode(id: number): SText {
    const node = this.node(id);
    if (!(node instanceof SText)) {
      throw new ProtocolError(`node ${id} is not text`);
    }
    return node;
  }

  private clampText(data: string): string {
    if (data.length <= this.policy.limits.textLength) {
      return data;
    }
    return data.slice(0, this.policy.limits.textLength);
  }
}

function applyAttribute(node: SElement, name: string, value: unknown): void {
  try {
    node.setAttribute(name, value);
  } catch (error) {
    console.warn(`svelte-gtk4 host: ${name} on <${node.tagName}>:`, error);
  }
}

function idAt(op: unknown[], index: number): number {
  const value = op[index];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ProtocolError(`operation ${String(op[0])}: item ${index} is not an id`);
  }
  return value;
}

function numberAt(op: unknown[], index: number): number {
  const value = op[index];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ProtocolError(`operation ${String(op[0])}: item ${index} is not a number`);
  }
  return value;
}

function stringAt(op: unknown[], index: number): string {
  const value = op[index];
  if (typeof value !== "string") {
    throw new ProtocolError(`operation ${String(op[0])}: item ${index} is not a string`);
  }
  return value;
}

function emptyNode(node: SNode): void {
  while (node.firstChildNode !== null) {
    node.removeChild(node.firstChildNode);
  }
}

function heightOf(node: SNode): number {
  let tallest = 0;
  let child = node.firstChildNode;
  while (child !== null) {
    tallest = Math.max(tallest, heightOf(child));
    child = child.nextSiblingNode;
  }
  return tallest + 1;
}

// Event details carry plain numbers today; anything else, like a GObject a
// drop delivers, does not cross.
function plainDetail(event: unknown): unknown {
  if (typeof event !== "object" || event === null) {
    return null;
  }
  const detail = (event as Record<string, unknown>).detail;
  if (detail === undefined || detail === null) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(detail));
  } catch {
    return null;
  }
}

// What a handler would have read off the widget, read here instead.
function stateOf(widget: any): WidgetState {
  const state: WidgetState = {};
  if (widget === null) {
    return state;
  }
  state.width = widget.get_width();
  state.height = widget.get_height();
  placeInRoot(state, widget);
  readInto(state, "text", widget, "get_text");
  readInto(state, "value", widget, "get_value");
  readInto(state, "active", widget, "get_active");
  readInto(state, "selected", widget, "get_selected");
  return state;
}

// Where the widget sits in its window, which a view needs to place something
// beside it, like a menu under a bar button.
function placeInRoot(state: WidgetState, widget: any): void {
  const root = widget.get_root();
  if (root === null) {
    return;
  }
  const [found, bounds] = widget.compute_bounds(root);
  if (!found) {
    return;
  }
  state.x = bounds.get_x();
  state.y = bounds.get_y();
  state.rootWidth = root.get_width();
  state.rootHeight = root.get_height();
}

function readInto(state: WidgetState, key: keyof WidgetState, widget: any, getter: string): void {
  if (typeof widget[getter] !== "function") {
    return;
  }
  try {
    (state as Record<string, unknown>)[key] = widget[getter]();
  } catch {
    // A getter that needs arguments on this class is not the one meant.
  }
}
