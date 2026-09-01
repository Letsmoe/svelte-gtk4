// A layer surface takes pointer input across its whole area, painted or not.
// A bar that reserves 30px but keeps a 180px surface for an expanding island
// therefore swallows every click in the top 180px of the screen, all the way
// across.
//
// The compositor only knows what a surface's input region says, so widgets
// marked `input` publish their allocation as that region and everything else
// on the surface becomes click-through.

import cairo from "gi://cairo";
import type Gtk from "gi://Gtk?version=4.0";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const marked = new WeakSet<Gtk.Widget>();
const watched = new WeakSet<Gtk.Window>();

export function markInput(widget: Gtk.Widget, enabled: boolean): void {
  if (enabled) {
    marked.add(widget);
    return;
  }
  marked.delete(widget);
}

// Allocations are only known after layout, and layout only settles by the time
// a frame has been painted — so the region is recomputed off the frame clock
// and written out whenever it actually moved.
export function watchInputRegion(window: Gtk.Window): void {
  if (watched.has(window)) {
    return;
  }
  watched.add(window);

  let published = "";
  window.connect("map", () => {
    const clock = window.get_frame_clock();
    if (clock === null) {
      return;
    }
    clock.connect("after-paint", () => {
      published = publish(window, published);
    });
  });
}

function publish(window: Gtk.Window, published: string): string {
  const rects: Rect[] = [];
  collect(window, window, rects);

  // No widget on this surface asked for a region, so GTK's default — the whole
  // surface — is what was wanted.
  if (rects.length === 0) {
    return published;
  }
  const key = JSON.stringify(rects);
  if (key === published) {
    return published;
  }
  const surface = window.get_surface();
  if (surface === null) {
    return published;
  }

  const region = new cairo.Region();
  for (const rect of rects) {
    region.unionRectangle(rect);
  }
  surface.set_input_region(region);
  return key;
}

function collect(widget: Gtk.Widget, window: Gtk.Window, out: Rect[]): void {
  if (!widget.get_mapped()) {
    return;
  }
  if (marked.has(widget)) {
    pushBounds(widget, window, out);
    return;
  }
  let child = widget.get_first_child();
  while (child !== null) {
    collect(child, window, out);
    child = child.get_next_sibling();
  }
}

function pushBounds(widget: Gtk.Widget, window: Gtk.Window, out: Rect[]): void {
  const [ok, bounds] = widget.compute_bounds(window);
  if (!ok) {
    return;
  }
  out.push({
    x: Math.floor(bounds.origin.x),
    y: Math.floor(bounds.origin.y),
    width: Math.ceil(bounds.size.width),
    height: Math.ceil(bounds.size.height),
  });
}
