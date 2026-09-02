// Keeps the GTK widget tree in step with the node tree Svelte mutates.
//
// The two trees are not the same shape: Svelte works against comment anchors
// and text nodes that have no widget at all, so a widget's parent is the
// nearest ancestor that has one, and its position is decided by the next
// widget after it in document order.

import {
  type EventHandler,
  SElement,
  SNode,
  SText,
  isBuildingWidgets,
  setElementBackend,
} from "../dom/nodes";
import { setMirror } from "../dom/hooks";
import { addListener } from "./events";
import { type Mount, mountFor } from "./widgets";

export { ROOT_TAG } from "./widgets";

export function install(): void {
  setElementBackend({
    created(node: SElement): void {
      if (!isBuildingWidgets()) {
        return;
      }
      node.impl = mountFor(node);
    },

    attributeChanged(node: SElement, name: string, value: unknown): void {
      if (node.impl === null) {
        return;
      }
      node.impl.attr(name, value);
    },

    listenerAdded(node: SElement, type: string, handler: EventHandler): void {
      addListener(node, type, handler);
    },
  });

  setMirror({ inserted, removed, textChanged });
}

function inserted(child: SNode): void {
  const host = hostOf(child.parentNode);
  if (host === null) {
    return;
  }
  attach(host, child);
  syncText(host);
}

function removed(child: SNode, formerParent: SNode): void {
  const host = hostOf(formerParent);
  if (host === null) {
    return;
  }
  detach(host, child);
  syncText(host);
}

function textChanged(node: SText): void {
  const host = hostOf(node.parentNode);
  if (host === null) {
    return;
  }
  syncText(host);
}

// Inserting back to front means each widget already has its successor in place
// to be positioned against.
function attach(host: SElement, subtree: SNode): void {
  const widgets: SElement[] = [];
  collectWidgets(subtree, widgets);
  if (widgets.length === 0) {
    return;
  }
  const mount = mountOf(host);
  let before = widgetAfter(widgets[widgets.length - 1], host);
  for (let at = widgets.length - 1; at >= 0; at--) {
    mount.insert(widgets[at], before);
    before = widgets[at].widget;
  }
}

function detach(host: SElement, subtree: SNode): void {
  const widgets: SElement[] = [];
  collectWidgets(subtree, widgets);
  const mount = mountOf(host);
  for (const node of widgets) {
    mount.remove(node);
  }
}

function syncText(host: SElement): void {
  const mount = mountOf(host);
  if (mount.setText === undefined) {
    return;
  }
  mount.setText(textOf(host));
}

function hostOf(node: SNode | null): SElement | null {
  let candidate = node;
  while (candidate !== null) {
    if (candidate instanceof SElement && candidate.impl !== null) {
      return candidate;
    }
    candidate = candidate.parentNode;
  }
  return null;
}

function collectWidgets(node: SNode, out: SElement[]): void {
  if (node instanceof SElement && node.impl !== null) {
    out.push(node);
    return;
  }
  let child = node.firstChild;
  while (child !== null) {
    collectWidgets(child, out);
    child = child.nextSibling;
  }
}

function widgetAfter(node: SNode, host: SElement): any {
  let branch: SNode | null = node;
  while (branch !== null && branch !== host) {
    let sibling = branch.nextSibling;
    while (sibling !== null) {
      const found = firstWidget(sibling);
      if (found !== null) {
        return found;
      }
      sibling = sibling.nextSibling;
    }
    branch = branch.parentNode;
  }
  return null;
}

function firstWidget(node: SNode): any {
  if (node instanceof SElement && node.impl !== null) {
    return node.widget;
  }
  let child = node.firstChild;
  while (child !== null) {
    const found = firstWidget(child);
    if (found !== null) {
      return found;
    }
    child = child.nextSibling;
  }
  return null;
}

// The text belonging to a widget is everything under it that no other widget
// has claimed first.
function textOf(host: SNode): string {
  let out = "";
  let child = host.firstChild;
  while (child !== null) {
    out += textUnder(child);
    child = child.nextSibling;
  }
  return out;
}

function textUnder(node: SNode): string {
  if (node instanceof SText) {
    return node.data;
  }
  if (node instanceof SElement && node.impl !== null) {
    return "";
  }
  return textOf(node);
}

function mountOf(node: SElement): Mount {
  if (node.impl === null) {
    throw new Error(`svelte-gtk4: no widget registered for <${node.tagName}>`);
  }
  return node.impl;
}
