import type { Context, Fiber, Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus } from '../bus.js'
import { EXTENSIONS } from '../../extensions/index.js'
import type { ExtensionModule, WidgetDeclaration } from '../../extensions/index.js'

// extensionsPlugin is the loader: it reads the mount list from config (the
// "extensions" key — flat, Cordis-shaped) and mounts each enabled extension as
// a child fiber. The list is read from the retained "config" topic, so edits
// apply live: disabling an entry disposes its fiber, enabling mounts it, a
// config change remounts.
//
// Everything runs in one GJS process, so an extension is a compiled-in module
// rather than a directory the host imports at runtime — the registry in
// extensions/index.ts is what the manifest scan used to produce. The backend
// and the view half mount as one fiber, since there is no second execution
// site to bridge to any more.
//
// The widgets extensions declare are aggregated into a retained topic:
//
//   widgets.catalog  {widgets: [{type, name, category, description, sizes, defaultSize}]}
//
// That is what the desktop's widget gallery lists. It is read from every
// installed manifest rather than from the mount list, so a widget appears in
// the gallery because its extension is present, not because it is running.

interface ExtensionEntry {
  id: string
  name?: string
  config?: unknown
  disabled?: boolean
}

export const extensionsPlugin: Plugin.Object = {
  name: 'extensions',
  inject: ['bus', 'config'],
  apply(context) {
    const bus = requireService<Bus>(context, 'bus')
    const loader = new ExtensionLoader(context)
    // The retained config snapshot replays on subscribe, so this both loads
    // the initial list and follows every later change.
    context.effect(() =>
      bus.subscribe('config', (message) => {
        loader.applyFromSnapshot(message.data)
      }),
    )
    context.effect(() => bus.retain('widgets.catalog', { widgets: widgetCatalog() }))
  },
}

export function widgetCatalog(): WidgetDeclaration[] {
  const widgets: WidgetDeclaration[] = []
  for (const extension of Object.values(EXTENSIONS)) {
    widgets.push(...declarationsOf(extension))
  }
  return widgets
}

function declarationsOf(extension: ExtensionModule): WidgetDeclaration[] {
  if (extension.manifest.widgets === undefined) {
    return []
  }
  return extension.manifest.widgets
}

class ExtensionLoader {
  private readonly context: Context
  private readonly mounted = new Map<string, { fiber: Fiber; signature: string }>()
  private queue: Promise<void> = Promise.resolve()

  constructor(context: Context) {
    this.context = context
  }

  // applyFromSnapshot serializes list applications so overlapping config
  // changes never interleave mounts and unmounts.
  applyFromSnapshot(snapshot: unknown): void {
    const entries = mountListOf(snapshot)
    this.queue = this.queue.then(() => this.applyList(entries)).catch(logApplyError)
  }

  settle(): Promise<void> {
    return this.queue
  }

  private async applyList(entries: ExtensionEntry[]): Promise<void> {
    const desired = new Map<string, ExtensionEntry>()
    for (const entry of entries) {
      addIfEnabled(desired, entry)
    }
    await this.unmountStale(desired)
    this.mountMissing(desired)
  }

  private async unmountStale(desired: Map<string, ExtensionEntry>): Promise<void> {
    for (const [id, mountedExtension] of [...this.mounted]) {
      await this.unmountIfStale(id, mountedExtension.signature, desired)
    }
  }

  private async unmountIfStale(
    id: string,
    signature: string,
    desired: Map<string, ExtensionEntry>,
  ): Promise<void> {
    const entry = desired.get(id)
    if (entry !== undefined && signatureOf(entry) === signature) {
      return
    }
    const mountedExtension = this.mounted.get(id)
    if (mountedExtension === undefined) {
      return
    }
    await mountedExtension.fiber.dispose()
    this.mounted.delete(id)
  }

  private mountMissing(desired: Map<string, ExtensionEntry>): void {
    for (const [id, entry] of desired) {
      this.mountIfMissing(id, entry)
    }
  }

  private mountIfMissing(id: string, entry: ExtensionEntry): void {
    if (this.mounted.has(id)) {
      return
    }
    const plugin = pluginFor(entry)
    if (plugin === null) {
      return
    }
    const fiber = this.context.plugin(plugin, entry.config)
    // A fiber is thenable and rejects when its plugin's apply throws. Nothing
    // awaits it — an extension that fails to mount must not stop the rest —
    // so the rejection is reported here rather than escaping as a bare
    // unhandled-promise warning with no name attached to it.
    void Promise.resolve(fiber).catch((error: unknown) => {
      console.error(`extensions: "${id}" failed to mount:`, error)
    })
    this.mounted.set(id, { fiber, signature: signatureOf(entry) })
  }
}

// pluginFor builds the one fiber an extension gets: its backend and its view
// half as sibling child plugins, so both halves die together the way the
// remote-fiber bridge used to guarantee across the socket.
function pluginFor(entry: ExtensionEntry): Plugin.Object | null {
  const extension = EXTENSIONS[nameOf(entry)]
  if (extension === undefined) {
    console.error(`extensions: no extension named "${nameOf(entry)}"`)
    return null
  }
  if (extension.backend === undefined && extension.views === undefined) {
    return null
  }
  return {
    name: entry.id,
    inject: extension.manifest.inject,
    apply(context, config) {
      mountHalf(context, extension.backend, config)
      mountHalf(context, extension.views, config)
    },
  }
}

function mountHalf(context: Context, half: Plugin.Object | undefined, config: unknown): void {
  if (half === undefined) {
    return
  }
  context.plugin(half, config)
}

// mountListOf returns the installed set when the config declares no list at
// all — an absent key means "mount what is installed". An empty array is a
// decision and stays empty.
function mountListOf(snapshot: unknown): ExtensionEntry[] {
  const declared = entriesOf(snapshot)
  if (declared !== null) {
    return declared
  }
  return Object.keys(EXTENSIONS).map((id) => ({ id }))
}

function entriesOf(snapshot: unknown): ExtensionEntry[] | null {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return null
  }
  const list = (snapshot as Record<string, unknown>).extensions
  if (!Array.isArray(list)) {
    return null
  }
  return list.filter(isExtensionEntry)
}

function isExtensionEntry(value: unknown): value is ExtensionEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const id = (value as ExtensionEntry).id
  return typeof id === 'string' && id !== ''
}

function addIfEnabled(desired: Map<string, ExtensionEntry>, entry: ExtensionEntry): void {
  if (entry.disabled === true) {
    return
  }
  desired.set(entry.id, entry)
}

function nameOf(entry: ExtensionEntry): string {
  if (entry.name !== undefined && entry.name !== '') {
    return entry.name
  }
  return entry.id
}

function signatureOf(entry: ExtensionEntry): string {
  return JSON.stringify({ name: nameOf(entry), config: entry.config })
}

function logApplyError(error: unknown): void {
  console.error('extensions: apply failed:', error)
}
