// The library must be imported before anything that pulls in Svelte's client
// runtime: it installs the DOM globals that runtime reads at module scope.
import { start } from '@neoworks/svelte-gtk4'
import GLib from 'gi://GLib'
import { Context } from '@neoworks/extension-system'
import type { Plugin } from '@neoworks/extension-system'
import { Bus } from './host/bus.js'
import { ViewRegistry } from './host/plugins/views.js'
import { runtimePlugin } from './host/plugins/runtime.js'
import { configPlugin } from './host/plugins/config.js'
import { unixSocketPlugin } from './host/plugins/unixSocket.js'
import { extensionsPlugin } from './host/plugins/extensions.js'
import { viewTreePlugin } from './host/plugins/viewTree.js'
import { joinPath, runtimeDirectory } from './gjs/fs.js'
import Shell from './Shell.svelte'

// neoshell: one GJS process holding the kernel, the bus, every extension
// backend and every view. The bun host, the C++/WPE render host and the
// per-layer webviews are all gone — a view is a Svelte component compiled to
// GTK4 widgets, and a surface is a gtk4-layer-shell window.
//
// The kernel is started before GTK's main loop rather than inside it: its
// mounts are promises, which GJS runs on that loop, so everything the
// extensions publish arrives while the shell is already on screen and the
// windows fill in as their view types register.

const bus = new Bus()
const registry = new ViewRegistry()

const root = new Context()
mount(runtimePlugin, { bus, registry })
mount(configPlugin, { path: configPath() })
mount(unixSocketPlugin, { socketPath: joinPath(runtimeDirectory(), 'neoshell-host.sock') })
mount(extensionsPlugin)
mount(viewTreePlugin)

start(Shell, { bus, registry }, { stylesheet: stylesheetPath() })

// A fiber is thenable and rejects when its plugin's apply throws. Nothing here
// awaits one — a runtime plugin that fails must not stop the rest — so the
// rejection is named rather than left to surface as a bare unhandled-promise
// warning with only the main loop in its stack.
function mount(plugin: Plugin.Object<any>, config?: unknown): void {
  const fiber = root.plugin(plugin as Plugin.Object, config)
  void Promise.resolve(fiber).catch((error: unknown) => {
    console.error(`neoshell: plugin "${plugin.name}" failed to mount:`, error)
  })
}

function configPath(): string {
  return joinPath(GLib.get_home_dir(), '.config', 'neoshell', 'config.json')
}

// The stylesheet ships next to the bundle rather than inside it: GTK loads CSS
// through its own provider, and keeping it a file means it can be reloaded
// without a rebuild.
function stylesheetPath(): string {
  return joinPath(GLib.get_current_dir(), 'style.css')
}
