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
import { applyCommon } from "./attrs";
import { addListener } from "./events";
import { SPECS, type WidgetSpec } from "./widgets";

// The mount target. Its children are windows, which are presented rather than
// parented into anything.
const rootSpec: WidgetSpec = {
  create: () => ({ isRoot: true }),
  insert(_parent: SElement, child: SElement): void {
    child.widget.present();
  },
  remove(_parent: SElement, child: SElement): void {
    child.widget.destroy();
  },
};

export const ROOT_TAG = "gtkroot";

export function install(): void {
  setElementBackend({
    created(node: SElement): void {
      if (!isBuildingWidgets()) {
        return;
      }
      const spec = specFor(node.tagName);
      if (spec === null) {
        return;
      }
      node.widget = spec.create();
    },

    attributeChanged(node: SElement, name: string, value: unknown): void {
      if (node.widget === null) {
        return;
      }
      const spec = specOf(node);
      if (spec.attr !== undefined && spec.attr(node, name, value)) {
        return;
      }
      applyCommon(node, name, value);
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
  const spec = specOf(host);
  let before = widgetAfter(widgets[widgets.length - 1], host);
  for (let at = widgets.length - 1; at >= 0; at--) {
    spec.insert(host, widgets[at], before);
    before = widgets[at].widget;
  }
}

function detach(host: SElement, subtree: SNode): void {
  const widgets: SElement[] = [];
  collectWidgets(subtree, widgets);
  const spec = specOf(host);
  for (const node of widgets) {
    spec.remove(host, node);
  }
}

function syncText(host: SElement): void {
  const spec = specOf(host);
  if (spec.setText === undefined) {
    return;
  }
  spec.setText(host, textOf(host));
}

function hostOf(node: SNode | null): SElement | null {
  let candidate = node;
  while (candidate !== null) {
    if (candidate instanceof SElement && candidate.widget !== null) {
      return candidate;
    }
    candidate = candidate.parentNode;
  }
  return null;
}

function collectWidgets(node: SNode, out: SElement[]): void {
  if (node instanceof SElement && node.widget !== null) {
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
  if (node instanceof SElement && node.widget !== null) {
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
  if (node instanceof SElement && node.widget !== null) {
    return "";
  }
  return textOf(node);
}

function specOf(node: SElement): WidgetSpec {
  const spec = specFor(node.tagName);
  if (spec === null) {
    throw new Error(`svelte-gtk4: no widget registered for <${node.tagName}>`);
  }
  return spec;
}

function specFor(tagName: string): WidgetSpec | null {
  if (tagName === ROOT_TAG) {
    return rootSpec;
  }
  const spec = SPECS[tagName];
  if (spec === undefined) {
    return null;
  }
  return spec;
}
