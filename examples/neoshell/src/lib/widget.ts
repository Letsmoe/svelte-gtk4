import { numberOf, recordOf, stringOf } from './record.js'

// What a desktop widget is told about its own slot.
//
// The webview build had each card measure itself with a ResizeObserver: the
// widget canvas was plain DOM outside the card's reactivity and only ever set
// the slot's pixel dimensions, so the box was the one signal that reached it.
// GTK has no resize observer, and it does not need one — the desktop store
// already holds the size and the slot renders the card itself, so the size
// arrives as an ordinary prop and the card never has to infer it.
//
// The pixel box travels with it because GTK CSS has no percentage widths: a
// card drawing a bar as a fraction of its own width has to work out the pixels
// itself, the way the battery indicator on the bar does.

export interface WidgetBox {
  size: string
  width: number
  height: number
}

const SIZES = new Set(['small', 'medium', 'large'])

export function widgetBoxOf(args: unknown): WidgetBox {
  const record = recordOf(args)
  return {
    size: sizeOf(record.size),
    width: numberOf(record.width, 0),
    height: numberOf(record.height, 0),
  }
}

function sizeOf(value: unknown): string {
  const size = stringOf(value)
  if (SIZES.has(size)) {
    return size
  }
  return 'small'
}
