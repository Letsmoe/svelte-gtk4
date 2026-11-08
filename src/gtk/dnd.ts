// File drag and drop. Drops arrive as events on the element that listens for
// them; dragging out is an attribute naming the files to hand over.
//
//   ondropenter / ondropleave   a drag carrying files is over the widget / left
//   ondrop                      detail {paths, uris, x, y}
//   drag-files={paths}          the widget can be dragged out as those files
//
// paths are the local files; uris are the URIs without a local path (what a
// browser offers for a dragged image or link), left for the app to fetch.
//
// Both directions speak text/uri-list directly. GJS turns a GdkFileList that
// travels in a GValue into an opaque object with no methods, so neither a
// Gtk.DropTarget typed for it nor a provider built from one carries files.

import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import type { EventHandler, SElement } from "../dom/nodes";

export const DROP_EVENTS = ["drop", "dropenter", "dropleave"];

const URI_LIST = "text/uri-list";

type Fire = (node: SElement, type: string, handler: EventHandler, detail: unknown) => void;

interface DropState {
  target: Gtk.DropTargetAsync;
  handlers: Map<string, EventHandler[]>;
}

interface DragSourceState {
  source: Gtk.DragSource;
  paths: string[];
}

const dropStates = new WeakMap<SElement, DropState>();
const dragSources = new WeakMap<Gtk.Widget, DragSourceState>();

export function addDropListener(
  node: SElement,
  type: string,
  handler: EventHandler,
  fire: Fire,
): void {
  const state = dropStateFor(node, fire);
  const handlers = state.handlers.get(type);
  if (handlers === undefined) {
    state.handlers.set(type, [handler]);
    return;
  }
  handlers.push(handler);
}

function dropStateFor(node: SElement, fire: Fire): DropState {
  const existing = dropStates.get(node);
  if (existing !== undefined) {
    return existing;
  }
  const target = Gtk.DropTargetAsync.new(
    Gdk.ContentFormats.new([URI_LIST]),
    Gdk.DragAction.COPY,
  );
  const state: DropState = { target, handlers: new Map() };
  const fireAll = (type: string, detail: unknown) => fireHandlers(node, state, fire, type, detail);
  // The returned action is what the source is told this widget accepts.
  target.connect("drag-enter", () => {
    fireAll("dropenter", null);
    return Gdk.DragAction.COPY;
  });
  target.connect("drag-leave", () => fireAll("dropleave", null));
  target.connect("drop", (_target, drop, x, y) => {
    readUris(drop, (dropped) => fireAll("drop", { ...dropped, x, y }));
    return true;
  });
  node.widget.add_controller(target);
  dropStates.set(node, state);
  return state;
}

function fireHandlers(
  node: SElement,
  state: DropState,
  fire: Fire,
  type: string,
  detail: unknown,
): void {
  const handlers = state.handlers.get(type);
  if (handlers === undefined) {
    return;
  }
  for (const handler of handlers) {
    fire(node, type, handler, detail);
  }
}

interface DroppedUris {
  paths: string[];
  uris: string[];
}

// Every accepted drop must be finished, whatever happens: an unfinished one
// leaves the compositor holding the drag, and with it all pointer input.
function readUris(drop: Gdk.Drop, deliver: (dropped: DroppedUris) => void): void {
  drop.read_async([URI_LIST], GLib.PRIORITY_DEFAULT, null, (_source, result) => {
    try {
      const [stream] = drop.read_finish(result);
      if (stream === null) {
        finishDrop(drop, parseUriList(""), deliver);
        return;
      }
      readText(stream, (text) => finishDrop(drop, parseUriList(text), deliver));
    } catch (error) {
      console.error("svelte-gtk4: reading a drop failed:", error);
      finishDrop(drop, parseUriList(""), deliver);
    }
  });
}

function readText(stream: Gio.InputStream, deliver: (text: string) => void): void {
  const output = Gio.MemoryOutputStream.new_resizable();
  const flags = Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET;
  output.splice_async(stream, flags, GLib.PRIORITY_DEFAULT, null, (_source, result) => {
    try {
      output.splice_finish(result);
      deliver(new TextDecoder().decode(output.steal_as_bytes().toArray()));
    } catch (error) {
      console.error("svelte-gtk4: reading a drop failed:", error);
      deliver("");
    }
  });
}

function finishDrop(drop: Gdk.Drop, dropped: DroppedUris, deliver: (dropped: DroppedUris) => void): void {
  if (dropped.paths.length === 0 && dropped.uris.length === 0) {
    console.warn(`svelte-gtk4: a drop carried no URIs; offered ${drop.get_formats().to_string()}`);
    drop.finish(0);
  } else {
    drop.finish(Gdk.DragAction.COPY);
  }
  deliver(dropped);
}

// text/uri-list: one URI per CRLF-terminated line, # starts a comment.
function parseUriList(text: string): DroppedUris {
  const dropped: DroppedUris = { paths: [], uris: [] };
  for (const line of text.split(/\r?\n/)) {
    addUri(dropped, line.trim());
  }
  return dropped;
}

function addUri(dropped: DroppedUris, uri: string): void {
  if (uri === "" || uri.startsWith("#")) {
    return;
  }
  const path = Gio.File.new_for_uri(uri).get_path();
  if (path === null) {
    dropped.uris.push(uri);
    return;
  }
  dropped.paths.push(path);
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

// Offered as text/uri-list bytes, which every receiver understands; GTK ones
// turn it back into a Gdk.FileList themselves.
function contentFor(paths: string[]): Gdk.ContentProvider | null {
  if (paths.length === 0) {
    return null;
  }
  const uris = paths.map((path) => Gio.File.new_for_path(path).get_uri());
  const text = `${uris.join("\r\n")}\r\n`;
  return Gdk.ContentProvider.new_for_bytes(URI_LIST, new GLib.Bytes(new TextEncoder().encode(text)));
}

function pathListOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string" && entry !== "");
}
