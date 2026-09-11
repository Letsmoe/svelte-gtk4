import type Gtk from 'gi://Gtk?version=4.0'
import type { Point } from './freeform'

// A dropped item does not teleport to where it settles: it slides there over a
// few frames, the way a desktop icon glides into its grid cell. The animation
// runs on the widget's own frame clock, so every step lands on a real frame.

const DURATION_US = 180_000

export type GlideStop = () => void

export function glide(
  widget: Gtk.Widget,
  from: Point,
  to: Point,
  onFrame: (point: Point) => void,
  onDone: () => void,
): GlideStop {
  if (!widget.get_mapped()) {
    onFrame(to)
    onDone()
    return () => {}
  }
  let stopped = false
  let startedAt = -1
  const id = widget.add_tick_callback((_widget, clock) => {
    if (stopped) {
      return false
    }
    const now = clock.get_frame_time()
    if (startedAt < 0) {
      startedAt = now
    }
    const progress = Math.min(1, (now - startedAt) / DURATION_US)
    onFrame(between(from, to, easeOut(progress)))
    if (progress < 1) {
      return true
    }
    stopped = true
    onDone()
    return false
  })
  return () => {
    if (stopped) {
      return
    }
    stopped = true
    widget.remove_tick_callback(id)
  }
}

function between(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
