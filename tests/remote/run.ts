// End-to-end check of remote clients: a real Svelte view runs in the QuickJS
// runner and is drawn here through the mirror, and a row of hostile clients
// each tries one way to take the host down. The host has to come out of all
// of them still responsive.
//
//   gjs -m tests/remote/dist/run.js <runner> <dist>

import '../../src/gtk/clock'
import '../../src/dom/globals'
import Gdk from 'gi://Gdk?version=4.0'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk?version=4.0'
import { SElement, SText } from '../../src/dom/nodes'
import { install } from '../../src/gtk/mirror'
import { defaultPolicy, RemoteClient } from '../../src/remote/index'
import type { ClientStatus, Embedder } from '../../src/remote/index'

const [runner, dist] = ARGV

interface Watched {
  client: RemoteClient
  anchor: SElement
  statuses: ClientStatus[]
  details: string[]
}

function watch(name: string, bundle: string, view: string, props: Record<string, unknown>): Watched {
  const anchor = new SElement('gtkbox')
  const statuses: ClientStatus[] = []
  const details: string[] = []
  const client = new RemoteClient({
    name,
    argv: [runner, `${dist}/${bundle}.js`, '--turn-ms', '300', '--memory-mb', '32'],
    policy: defaultPolicy(name, { paintableOf }),
    embedder: greetingEmbedder,
    onStatus: (status, detail) => {
      statuses.push(status)
      details.push(detail)
    },
  })
  client.mount(view, props, anchor)
  client.start()
  return { client, anchor, statuses, details }
}

// The one handle this host gave out.
const knownPaintable = Gdk.Paintable.new_empty(4, 4)

function paintableOf(handle: string): unknown {
  if (handle === 'known') {
    return knownPaintable
  }
  return null
}

function pictureHas(anchor: SElement, name: string): boolean {
  const [picture] = widgetsWithClass(anchor.widget, name)
  return picture !== undefined && (picture as Gtk.Picture).get_paintable() !== null
}

// The host's side of a <gtkembed view="greeting">: a label the client never sees.
const greetingEmbedder: Embedder = {
  embed(anchor, view, props) {
    if (view !== 'greeting') {
      return null
    }
    const label = new SElement('gtklabel')
    label.setAttribute('class', 'greeting')
    const text = new SText(greetingOf(props))
    label.appendChild(text)
    anchor.appendChild(label)
    return {
      update: (next) => {
        text.nodeValue = greetingOf(next)
      },
      dispose: () => anchor.removeChild(label),
    }
  },
}

function greetingOf(props: unknown): string {
  const name = (props as { name?: unknown } | null)?.name
  return `hello ${String(name)}`
}

function widgetsWithClass(root: Gtk.Widget, name: string): Gtk.Widget[] {
  const found: Gtk.Widget[] = []
  if (root.has_css_class(name)) {
    found.push(root)
  }
  let child = root.get_first_child()
  while (child !== null) {
    found.push(...widgetsWithClass(child, name))
    child = child.get_next_sibling()
  }
  return found
}

function labelText(anchor: SElement, name: string): string | null {
  const [label] = widgetsWithClass(anchor.widget, name)
  if (label === undefined) {
    return null
  }
  return (label as Gtk.Label).get_label()
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
      resolve()
      return GLib.SOURCE_REMOVE
    })
  })
}

async function until(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) {
      return true
    }
    await wait(20)
  }
  return check()
}

const results: [string, boolean, string][] = []

function expect(name: string, passed: boolean, detail = ''): void {
  results.push([name, passed, detail])
}

async function counter(): Promise<void> {
  let calledBack = -1
  const watched = watch('counter', 'counter', 'counter', { start: 0, onmore: (count: number) => (calledBack = count) })
  const anchor = watched.anchor
  expect('counter: first frame', await until(() => labelText(anchor, 'count') === 'count 0', 3000))
  expect('counter: a handle the host gave out shows its paintable', pictureHas(anchor, 'known-picture'))
  expect('counter: a made-up handle shows nothing', !pictureHas(anchor, 'unknown-picture'))
  const [button] = widgetsWithClass(anchor.widget, 'more')
  button.emit('clicked')
  expect('counter: a click reaches the client', await until(() => labelText(anchor, 'count') === 'count 1', 2000))
  expect('counter: a function in props calls back into the host', await until(() => calledBack === 1, 2000))
  const [field] = widgetsWithClass(anchor.widget, 'field')
  ;(field as Gtk.Entry).set_text('hello')
  expect('counter: typed text comes back', await until(() => labelText(anchor, 'typed') === 'hello', 2000))
  expect('counter: an embed shows the host\'s view with the client\'s props', await until(() => labelText(anchor, 'greeting') === 'hello hello', 2000))
  watched.client.update(1, { start: 5 })
  expect('counter: new props redraw', await until(() => labelText(anchor, 'count') === 'count 6', 2000))
  expect('counter: an {#if} branch appears', await until(() => labelText(anchor, 'many') === 'many', 2000))
  watched.client.stop()
}

// The drag is driven by emitting the gesture's own signals: what carry.ts
// and the listeners hear is the same as from a pointer.
async function carry(): Promise<void> {
  const watched = watch('drag', 'drag', 'drag', {})
  const anchor = watched.anchor
  expect('carry: first frame', await until(() => widgetsWithClass(anchor.widget, 'tile').length === 1, 3000))
  const [tile] = widgetsWithClass(anchor.widget, 'tile')
  const [band] = widgetsWithClass(anchor.widget, 'band')
  const gesture = dragGestureOf(tile)
  if (gesture === null || band === undefined) {
    expect('carry: the tile has a drag and the band is drawn', false)
    watched.client.stop()
    return
  }
  await until(() => marginsOf(tile) === '10,10', 2000)
  gesture.emit('drag-begin', 5, 5)
  expect('carry: the band shows from the press', band.get_visible())
  gesture.emit('drag-update', 2, 1)
  expect('carry: short of the threshold nothing moves', marginsOf(tile) === '10,10', marginsOf(tile))
  gesture.emit('drag-update', 50, 30)
  expect('carry: the tile follows the pointer on the same frame', marginsOf(tile) === '60,40', marginsOf(tile))
  expect('carry: the band spans the drag', bandOf(band) === '5,5 50x30', bandOf(band))
  gesture.emit('drag-end', 50, 30)
  expect('carry: the band leaves with the drag', !band.get_visible())
  expect('carry: let go, the tile waits where it was dropped', marginsOf(tile) === '60,40', marginsOf(tile))
  expect('carry: the client hears the drag carried', await until(() => labelText(anchor, 'carried') === 'true', 2000))
  expect('carry: a taken drop lands where the client put it', await until(() => marginsOf(tile) === '200,100', 2000), marginsOf(tile))
  gesture.emit('drag-begin', 5, 5)
  gesture.emit('drag-update', -40, 0)
  gesture.emit('drag-end', -40, 0)
  const endedAt = Date.now()
  expect('carry: a second drop is held too', marginsOf(tile) === '160,100', marginsOf(tile))
  const returned = await until(() => marginsOf(tile) === '200,100', 2000)
  const waitedMs = Date.now() - endedAt
  expect('carry: a refused drop goes back on the client\'s empty answer', returned && waitedMs < 800, `${waitedMs} ms`)
  watched.client.stop()
}

function dragGestureOf(widget: Gtk.Widget): Gtk.GestureDrag | null {
  const controllers = widget.observe_controllers()
  for (let index = 0; index < controllers.get_n_items(); index++) {
    const controller = controllers.get_item(index)
    if (controller instanceof Gtk.GestureDrag) {
      return controller
    }
  }
  return null
}

function marginsOf(widget: Gtk.Widget): string {
  return `${widget.get_margin_start()},${widget.get_margin_top()}`
}

function bandOf(widget: Gtk.Widget): string {
  const [width, height] = widget.get_size_request()
  return `${marginsOf(widget)} ${width}x${height}`
}

// What each hostile client should end up as.
const FAULTS: [string, string, string, ClientStatus][] = [
  ['throw', 'faulty', 'faulty', 'running'],
  ['css', 'faulty', 'faulty', 'running'],
  ['huge', 'faulty', 'faulty', 'running'],
  ['loop', 'faulty', 'faulty', 'restarting'],
  ['memory', 'faulty', 'faulty', 'restarting'],
  ['deep', 'faulty', 'faulty', 'restarting'],
  ['window', 'faulty', 'faulty', 'restarting'],
  ['cycle', 'garbage', 'garbage', 'restarting'],
  ['unknown-id', 'garbage', 'garbage', 'restarting'],
  ['remove-root', 'garbage', 'garbage', 'restarting'],
  ['not-json', 'garbage', 'garbage', 'restarting'],
  ['embed-children', 'garbage', 'garbage', 'restarting'],
  ['silent', 'garbage', 'garbage', 'restarting'],
]

async function faults(): Promise<void> {
  const watched = FAULTS.map(([fault, bundle, view]) => watch(`fault-${fault}`, bundle, view, { fault }))
  const flood = watch('fault-flood', 'faulty', 'faulty', { fault: 'flood' })
  const worstGap = await measureMainLoop(9000)
  for (let index = 0; index < FAULTS.length; index++) {
    const [fault, , , wanted] = FAULTS[index]
    const seen = watched[index].statuses
    const reached = seen.includes(wanted) && (wanted !== 'running' || !seen.includes('restarting'))
    expect(`fault ${fault}: ${wanted}`, reached, watched[index].details.filter((detail) => detail !== '').join('; '))
  }
  const huge = widgetsWithClass(watched[2].anchor.widget, 'alive')
  expect('fault huge: still drawn', huge.length === 1)
  expect('fault flood: the main loop never stalled', worstGap < 250, `worst gap ${worstGap.toFixed(0)} ms`)
  for (const each of [...watched, flood]) {
    each.client.stop()
  }
}

// The longest the main loop went without running a 10 ms timer.
async function measureMainLoop(durationMs: number): Promise<number> {
  let worst = 0
  let last = GLib.get_monotonic_time() / 1000
  const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
    const now = GLib.get_monotonic_time() / 1000
    worst = Math.max(worst, now - last)
    last = now
    return GLib.SOURCE_CONTINUE
  })
  await wait(durationMs)
  GLib.source_remove(timer)
  return worst
}

async function main(): Promise<number> {
  Gtk.init()
  install()
  await counter()
  await carry()
  await faults()
  let failed = 0
  for (const [name, passed, detail] of results) {
    print(`${passed ? 'pass' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
    if (!passed) {
      failed += 1
    }
  }
  print(`${results.length - failed} passed, ${failed} failed`)
  return failed
}

const loop = new GLib.MainLoop(null, false)
let exitCode = 1
main()
  .then((failed) => {
    exitCode = failed === 0 ? 0 : 1
  })
  .catch((error) => print(`the run itself failed: ${error}\n${error.stack}`))
  .finally(() => loop.quit())
loop.run()
imports.system.exit(exitCode)
