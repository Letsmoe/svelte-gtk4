import Gtk from 'gi://Gtk?version=4.0'
import Gdk from 'gi://Gdk?version=4.0'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import LayerShell from 'gi://Gtk4LayerShell?version=1.0'
import { BusClient, busSocketPath } from './bus.js'
import type { BusMessage } from './bus.js'
import {
  activeIdOf,
  urgentAddressOf,
  windowWorkspacesOf,
  workspacesOf,
} from './hypr.js'
import type { WorkspaceEntry } from './hypr.js'

// GTK4 port of Topbar.svelte + Clock.svelte. Same bar: workspaces left, a
// reserved centre gap for the notch, clock right.

const BAR_HEIGHT = 30
const CENTER_GAP = 320

// WorkspaceStrip replaces the {#each} block. GTK has no keyed diff, so the
// strip rebuilds its buttons whenever the workspace list changes — cheap at
// this size, and the state classes carry all the styling.
class WorkspaceStrip {
  readonly widget = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 4,
    valign: Gtk.Align.CENTER,
  })
  #bus: BusClient
  #workspaces: WorkspaceEntry[] = []
  #activeId = -1
  #urgentIds = new Set<number>()
  #workspaceByWindowAddress = new Map<string, number>()

  constructor(bus: BusClient) {
    this.#bus = bus
    bus.subscribe('hypr.workspaces', (message) => this.#setWorkspaces(message))
    bus.subscribe('hypr.activeworkspace', (message) => this.#setActive(message))
    bus.subscribe('hypr.windows', (message) => this.#setWindows(message))
    bus.subscribe('hypr.event', (message) => this.#markUrgent(message))
  }

  setWorkspaces(workspaces: WorkspaceEntry[], activeId: number): void {
    this.#workspaces = workspaces
    this.#activeId = activeId
    this.#rebuild()
  }

  #setWorkspaces(message: BusMessage): void {
    this.#workspaces = workspacesOf(message.data)
    this.#rebuild()
  }

  #setActive(message: BusMessage): void {
    this.#activeId = activeIdOf(message.data)
    this.#urgentIds.delete(this.#activeId)
    this.#rebuild()
  }

  #setWindows(message: BusMessage): void {
    this.#workspaceByWindowAddress = windowWorkspacesOf(message.data)
  }

  #markUrgent(message: BusMessage): void {
    const address = urgentAddressOf(message.data)
    if (address === null) {
      return
    }
    const workspaceId = this.#workspaceByWindowAddress.get(address)
    if (workspaceId === undefined || workspaceId === this.#activeId) {
      return
    }
    this.#urgentIds.add(workspaceId)
    this.#rebuild()
  }

  #rebuild(): void {
    removeChildren(this.widget)
    for (const workspace of this.#workspaces) {
      this.widget.append(this.#buttonFor(workspace))
    }
  }

  #buttonFor(workspace: WorkspaceEntry): Gtk.Button {
    const button = new Gtk.Button({ label: workspace.name, has_frame: false })
    button.add_css_class('workspace')
    button.add_css_class(this.#stateOf(workspace))
    button.connect('clicked', () => {
      this.#bus.call('hypr:dispatch', { dispatcher: 'workspace', arg: String(workspace.id) })
    })
    return button
  }

  #stateOf(workspace: WorkspaceEntry): string {
    if (this.#urgentIds.has(workspace.id)) {
      return 'urgent'
    }
    if (workspace.id === this.#activeId) {
      return 'active'
    }
    if (workspace.occupied) {
      return 'occupied'
    }
    return 'empty'
  }
}

// ClockButton replaces Clock.svelte. The Intl formatters port verbatim —
// SpiderMonkey ships full ICU, so GJS has Intl.
class ClockButton {
  readonly widget: Gtk.Button
  #dateLabel = new Gtk.Label({ label: '' })
  #timeLabel = new Gtk.Label({ label: '' })

  static #DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  static #TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  constructor(bus: BusClient) {
    const content = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
    this.#dateLabel.add_css_class('clock-date')
    content.append(this.#dateLabel)
    content.append(this.#timeLabel)

    this.widget = new Gtk.Button({ child: content, has_frame: false, valign: Gtk.Align.CENTER })
    this.widget.add_css_class('clock')
    this.widget.set_tooltip_text('Quick settings')
    this.widget.connect('clicked', () => bus.publish('quicksettings:toggle', {}))

    this.#tick()
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
      this.#tick()
      return GLib.SOURCE_CONTINUE
    })
  }

  #tick(): void {
    const now = new Date()
    this.#dateLabel.set_label(ClockButton.#DATE_FORMAT.format(now))
    this.#timeLabel.set_label(ClockButton.#TIME_FORMAT.format(now))
  }
}

function buildBar(bus: BusClient): Gtk.Widget {
  const strip = new WorkspaceStrip(bus)
  if (!bus.connected) {
    strip.setWorkspaces(demoWorkspaces(), 2)
  }

  // The notch gap is a fixed-width centre child: CenterBox keeps it centred
  // regardless of how wide the two sides grow. The Svelte version needed a
  // grid-cols-[1fr_auto_1fr] to get the same result.
  const gap = new Gtk.Box()
  gap.set_size_request(CENTER_GAP, -1)

  const end = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, halign: Gtk.Align.END })
  end.append(new ClockButton(bus).widget)

  const bar = new Gtk.CenterBox()
  bar.add_css_class('topbar')
  bar.set_start_widget(strip.widget)
  bar.set_center_widget(gap)
  bar.set_end_widget(end)
  return bar
}

function buildWindow(app: Gtk.Application, bus: BusClient): Gtk.ApplicationWindow {
  const window = new Gtk.ApplicationWindow({ application: app })
  window.set_default_size(-1, BAR_HEIGHT)

  LayerShell.init_for_window(window)
  LayerShell.set_namespace(window, 'neoshell.spike-bar')
  LayerShell.set_layer(window, LayerShell.Layer.TOP)
  LayerShell.set_anchor(window, LayerShell.Edge.TOP, true)
  LayerShell.set_anchor(window, LayerShell.Edge.LEFT, true)
  LayerShell.set_anchor(window, LayerShell.Edge.RIGHT, true)
  LayerShell.set_exclusive_zone(window, BAR_HEIGHT)
  LayerShell.set_keyboard_mode(window, LayerShell.KeyboardMode.ON_DEMAND)

  window.set_child(buildBar(bus))
  return window
}

function loadStyle(): void {
  const provider = new Gtk.CssProvider()
  provider.load_from_path(stylePath())
  Gtk.StyleContext.add_provider_for_display(
    Gdk.Display.get_default()!,
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  )
}

// run.sh cds into the spike directory before launching gjs.
function stylePath(): string {
  return GLib.build_filenamev([GLib.get_current_dir(), 'style.css'])
}

function removeChildren(box: Gtk.Box): void {
  let child = box.get_first_child()
  while (child !== null) {
    const next = child.get_next_sibling()
    box.remove(child)
    child = next
  }
}

function demoWorkspaces(): WorkspaceEntry[] {
  return [
    { id: 1, name: '1', occupied: true },
    { id: 2, name: '2', occupied: true },
    { id: 3, name: '3', occupied: false },
    { id: 4, name: '4', occupied: false },
  ]
}

function main(): void {
  const bus = new BusClient()
  const connected = bus.open(busSocketPath())
  if (!connected) {
    print('topbar: host socket not found, showing demo workspaces')
  }

  const app = new Gtk.Application({
    application_id: 'dev.neoworks.neoshell.SpikeTopbar',
    flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
  })
  app.connect('activate', () => {
    loadStyle()
    buildWindow(app, bus).present()
  })
  app.run([])
}

main()
