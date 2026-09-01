// A node tree with exactly the surface Svelte's client runtime touches, and
// nothing else. Svelte only ever asks for comment anchors, text nodes and
// element nodes; the elements here are the ones that carry a GTK widget.
//
// `firstChild` and `nextSibling` have to be accessors on the prototype:
// `init_operations()` pulls their getters off `Node.prototype` once and calls
// them unbound for the rest of the program's life.

import { mirror } from "./hooks";

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const COMMENT_NODE = 8;
export const DOCUMENT_FRAGMENT_NODE = 11;

// Widgets are built when a node is created, but a template is parsed once and
// only ever cloned, so the parse itself must not build anything.
let building = true;

export function setBuildingWidgets(value: boolean): boolean {
  const previous = building;
  building = value;
  return previous;
}

export function isBuildingWidgets(): boolean {
  return building;
}

export class SNode {
  nodeType = 0;
  nodeName = "#node";
  parentNode: SNode | null = null;
  ownerDocument: unknown = null;

  firstChildNode: SNode | null = null;
  lastChildNode: SNode | null = null;
  nextSiblingNode: SNode | null = null;
  prevSiblingNode: SNode | null = null;

  get firstChild(): SNode | null {
    return this.firstChildNode;
  }

  get lastChild(): SNode | null {
    return this.lastChildNode;
  }

  get nextSibling(): SNode | null {
    return this.nextSiblingNode;
  }

  get previousSibling(): SNode | null {
    return this.prevSiblingNode;
  }

  get childNodes(): SNode[] {
    const out: SNode[] = [];
    let child = this.firstChildNode;
    while (child !== null) {
      out.push(child);
      child = child.nextSiblingNode;
    }
    return out;
  }

  get isConnected(): boolean {
    let node: SNode | null = this;
    while (node.parentNode !== null) {
      node = node.parentNode;
    }
    return node !== this;
  }

  appendChild<T extends SNode>(node: T): T {
    return this.insertBefore(node, null);
  }

  insertBefore<T extends SNode>(node: T, ref: SNode | null): T {
    if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
      this.insertFragment(node, ref);
      return node;
    }
    if (node.parentNode !== null) {
      node.parentNode.removeChild(node);
    }
    this.link(node, ref);
    mirror.inserted(node);
    return node;
  }

  removeChild<T extends SNode>(node: T): T {
    if (node.parentNode !== this) {
      return node;
    }
    this.unlink(node);
    mirror.removed(node, this);
    return node;
  }

  remove(): void {
    if (this.parentNode !== null) {
      this.parentNode.removeChild(this);
    }
  }

  before(...nodes: SNode[]): void {
    const parent = this.parentNode;
    if (parent === null) {
      return;
    }
    for (const node of nodes) {
      parent.insertBefore(node, this);
    }
  }

  after(...nodes: SNode[]): void {
    const parent = this.parentNode;
    if (parent === null) {
      return;
    }
    let ref = this.nextSiblingNode;
    for (const node of nodes) {
      parent.insertBefore(node, ref);
      ref = node.nextSiblingNode;
    }
  }

  replaceWith(...nodes: SNode[]): void {
    this.before(...nodes);
    this.remove();
  }

  contains(node: SNode | null): boolean {
    let candidate = node;
    while (candidate !== null) {
      if (candidate === this) {
        return true;
      }
      candidate = candidate.parentNode;
    }
    return false;
  }

  cloneNode(_deep?: boolean): SNode {
    throw new Error(`cloneNode is not implemented for ${this.nodeName}`);
  }

  get textContent(): string {
    let out = "";
    let child = this.firstChildNode;
    while (child !== null) {
      out += child.textContent;
      child = child.nextSiblingNode;
    }
    return out;
  }

  set textContent(value: string) {
    while (this.firstChildNode !== null) {
      this.removeChild(this.firstChildNode);
    }
    if (value !== "") {
      this.appendChild(new SText(value));
    }
  }

  // Cheap no-ops so the runtime can treat any node as an event target; only
  // SElement overrides them into something that reaches GTK.
  addEventListener(..._args: unknown[]): void {}
  removeEventListener(..._args: unknown[]): void {}
  dispatchEvent(_event: unknown): boolean {
    return true;
  }

  protected insertFragment(fragment: SNode, ref: SNode | null): void {
    let child = fragment.firstChildNode;
    while (child !== null) {
      const next = child.nextSiblingNode;
      this.insertBefore(child, ref);
      child = next;
    }
  }

  protected link(node: SNode, ref: SNode | null): void {
    node.parentNode = this;
    node.nextSiblingNode = ref;
    if (ref === null) {
      node.prevSiblingNode = this.lastChildNode;
      this.lastChildNode = node;
    } else {
      node.prevSiblingNode = ref.prevSiblingNode;
      ref.prevSiblingNode = node;
    }
    if (node.prevSiblingNode === null) {
      this.firstChildNode = node;
    } else {
      node.prevSiblingNode.nextSiblingNode = node;
    }
  }

  protected unlink(node: SNode): void {
    if (node.prevSiblingNode === null) {
      this.firstChildNode = node.nextSiblingNode;
    } else {
      node.prevSiblingNode.nextSiblingNode = node.nextSiblingNode;
    }
    if (node.nextSiblingNode === null) {
      this.lastChildNode = node.prevSiblingNode;
    } else {
      node.nextSiblingNode.prevSiblingNode = node.prevSiblingNode;
    }
    node.parentNode = null;
    node.nextSiblingNode = null;
    node.prevSiblingNode = null;
  }
}

export class SText extends SNode {
  override nodeType = TEXT_NODE;
  override nodeName = "#text";
  data: string;

  constructor(data = "") {
    super();
    this.data = data;
  }

  get nodeValue(): string {
    return this.data;
  }

  set nodeValue(value: string) {
    if (value === this.data) {
      return;
    }
    this.data = value;
    mirror.textChanged(this);
  }

  override get textContent(): string {
    return this.data;
  }

  override set textContent(value: string) {
    this.nodeValue = value;
  }

  override cloneNode(): SText {
    return new SText(this.data);
  }
}

export class SComment extends SNode {
  override nodeType = COMMENT_NODE;
  override nodeName = "#comment";
  data: string;

  constructor(data = "") {
    super();
    this.data = data;
  }

  get nodeValue(): string {
    return this.data;
  }

  set nodeValue(value: string) {
    this.data = value;
  }

  override cloneNode(): SComment {
    return new SComment(this.data);
  }
}

export class SFragment extends SNode {
  override nodeType = DOCUMENT_FRAGMENT_NODE;
  override nodeName = "#document-fragment";

  override cloneNode(deep?: boolean): SFragment {
    const copy = new SFragment();
    if (deep !== true) {
      return copy;
    }
    let child = this.firstChildNode;
    while (child !== null) {
      copy.appendChild(child.cloneNode(true));
      child = child.nextSiblingNode;
    }
    return copy;
  }
}

// The element's own hooks into GTK. They live on the class rather than a side
// table because every structural operation consults them.
export interface ElementBackend {
  created(node: SElement): void;
  attributeChanged(node: SElement, name: string, value: unknown): void;
  listenerAdded(node: SElement, type: string, handler: EventHandler): void;
}

export type EventHandler = (event: unknown) => void;

const noBackend: ElementBackend = {
  created() {},
  attributeChanged() {},
  listenerAdded() {},
};

let backend = noBackend;

export function setElementBackend(next: ElementBackend): void {
  backend = next;
}

export class SElement extends SNode {
  override nodeType = ELEMENT_NODE;
  readonly tagName: string;
  readonly attributes = new Map<string, unknown>();

  // Filled in by the GTK backend. `widget` stays null for nodes parsed into a
  // template, which are only ever cloned.
  widget: any = null;
  slotName = "";
  cssClass = "";
  cssProvider: any = null;
  content: SFragment | null = null;

  constructor(tagName: string) {
    super();
    this.tagName = tagName;
    this.nodeName = tagName.toUpperCase();
    if (tagName === "template") {
      this.content = new SFragment();
    }
    backend.created(this);
  }

  getAttribute(name: string): unknown {
    const value = this.attributes.get(name);
    if (value === undefined) {
      return null;
    }
    return value;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, value);
    backend.attributeChanged(this, name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    backend.attributeChanged(this, name, null);
  }

  get className(): string {
    const value = this.attributes.get("class");
    if (typeof value !== "string") {
      return "";
    }
    return value;
  }

  set className(value: string) {
    this.setAttribute("class", value);
  }

  get classList() {
    return {
      toggle: (name: string, force?: boolean) => {
        const present = this.className.split(" ").filter((n) => n.length > 0);
        const has = present.includes(name);
        const wanted = force === undefined ? !has : force;
        if (wanted === has) {
          return;
        }
        if (wanted) {
          present.push(name);
        } else {
          present.splice(present.indexOf(name), 1);
        }
        this.className = present.join(" ");
      },
      add: (name: string) => this.classList.toggle(name, true),
      remove: (name: string) => this.classList.toggle(name, false),
      contains: (name: string) => this.className.split(" ").includes(name),
    };
  }

  set innerHTML(html: string) {
    const target = this.content === null ? this : this.content;
    while (target.firstChild !== null) {
      target.removeChild(target.firstChild);
    }
    parseInto(target, html);
  }

  override addEventListener(type: string, handler: EventHandler): void {
    backend.listenerAdded(this, type, handler);
  }

  override cloneNode(deep?: boolean): SElement {
    const copy = new SElement(this.tagName);
    for (const [name, value] of this.attributes) {
      copy.setAttribute(name, value);
    }
    if (deep !== true) {
      return copy;
    }
    let child = this.firstChildNode;
    while (child !== null) {
      copy.appendChild(child.cloneNode(true));
      child = child.nextSiblingNode;
    }
    return copy;
  }
}

// Assigned by parse.ts to keep the parser out of this module's imports.
export let parseInto: (target: SNode, html: string) => void = () => {};

export function setParser(fn: (target: SNode, html: string) => void): void {
  parseInto = fn;
}
