// File drag and drop. Drops arrive as events on the element that listens for
// them; dragging out is an attribute naming the files to hand over.
//
//   ondropenter / ondropleave   a drag carrying files is over the widget / left
//   ondrop                      detail {paths, x, y}
//   drag-files={paths}          the widget can be dragged out as those files
//
// Both go through Gdk.FileList, which GDK converts to and from text/uri-list,
// so file managers, browsers and editors all understand it.

import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";
import type { EventHandler, SElement } from "../dom/nodes";

export const DROP_EVENTS = ["drop", "dropenter", "dropleave"];

type Fire = (node: SElement, type: string, handler: EventHandler, detail: unknown) => void;

interface DragSourceState {
  source: Gtk.DragSource;
  paths: string[];
}

const dropTargets = new WeakMap<SElement, Gtk.DropTarget>();
const dragSources = new WeakMap<Gtk.Widget, DragSourceState>();

export function addDropListener(
  node: SElement,
  type: string,
  handler: EventHandler,
  fire: Fire,
): void {
  const target = dropTargetFor(node);
  if (type === "dropenter") {
    // The returned action is what the source is told this widget accepts.
    target.connect("enter", () => {
      fire(node, type, handler, null);
      return Gdk.DragAction.COPY;
    });
    return;
  }
  if (type === "dropleave") {
    target.connect("leave", () => fire(node, type, handler, null));
    return;
  }
  target.connect("drop", (_target, value, x, y) => {
    fire(node, type, handler, { paths: pathsOf(value), x, y });
    return true;
  });
}

/** Makes `widget` draggable as `paths`; an empty list stops it being one. */
export function setDragFiles(widget: Gtk.Widget, value: unknown): void {
  const paths = pathListOf(value);
  const existing = dragSources.get(widget);
  if (existing !== undefined) {
    existing.paths = paths;
    return;
  }
  const state: DragSourceState = { source: new Gtk.DragSource(), paths };
  state.source.set_actions(Gdk.DragAction.COPY);
  state.source.connect("prepare", () => contentFor(state.paths));
  // The widget itself, as it looks now, follows the pointer.
  state.source.connect("drag-begin", (source, _drag) => {
    const icon = Gtk.WidgetPaintable.new(widget);
    source.set_icon(icon, widget.get_width() / 2, widget.get_height() / 2);
  });
  widget.add_controller(state.source);
  dragSources.set(widget, state);
}

function dropTargetFor(node: SElement): Gtk.DropTarget {
  const existing = dropTargets.get(node);
  if (existing !== undefined) {
    return existing;
  }
  const target = Gtk.DropTarget.new(fileListType(), Gdk.DragAction.COPY);
  node.widget.add_controller(target);
  dropTargets.set(node, target);
  return target;
}

// The typings omit Gdk.FileList's $gtype; the type registers with Gdk.
function fileListType(): GObject.GType {
  return GObject.type_from_name("GdkFileList");
}

function contentFor(paths: string[]): Gdk.ContentProvider | null {
  if (paths.length === 0) {
    return null;
  }
  const files = paths.map((path) => Gio.File.new_for_path(path));
  const value = new GObject.Value();
  value.init(fileListType());
  value.set_boxed(Gdk.FileList.new_from_array(files));
  return Gdk.ContentProvider.new_for_value(value);
}

// Files without a local path (a remote URI a browser offers) are skipped:
// everything downstream works on paths.
function pathsOf(value: unknown): string[] {
  const list = value as Gdk.FileList | null;
  if (list === null || typeof list.get_files !== "function") {
    return [];
  }
  const paths: string[] = [];
  for (const file of list.get_files()) {
    const path = file.get_path();
    if (path !== null) {
      paths.push(path);
    }
  }
  return paths;
}

function pathListOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string" && entry !== "");
}
