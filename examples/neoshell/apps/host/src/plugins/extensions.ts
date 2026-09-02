import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context, Fiber, Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { Bus } from '../bus.js'

// extensionsPlugin is the loader: it reads the mount list from config (the
// "extensions" key — flat, Cordis-shaped) and mounts each enabled extension's
// backend as a child fiber. The list is read from the retained "config" topic,
// so edits apply live: disabling an entry disposes its fiber, enabling mounts
// it, a config change remounts.
//
// An extension is a directory under extensionsDir:
//   <dir>/<name>/manifest.json   {id, inject?, provides?, backend?, views?, widgets?}
//   <dir>/<name>/<backend>       module default-exporting a Plugin
//
// The widgets an extension declares are aggregated into a retained topic:
//
//   widgets.catalog  {widgets: [{type, name, category, description, sizes, defaultSize}]}
//
// That is what the desktop's widget gallery lists. It is read from every
// installed manifest rather than from the mount list, so a widget appears in
// the gallery because its extension is present, not because it is running.

export interface ExtensionsConfig {
  extensionsDir: string
}

export interface WidgetDeclaration {
  type: string
  name: string
  category: string
  description: string
  sizes: string[]
  defaultSize: string
}

interface ExtensionEntry {
  id: string
  name?: string
  config?: unknown
  disabled?: boolean
}

interface ExtensionManifest {
  id: string
  inject?: string[]
  provides?: string[]
  backend?: string
  views?: string
  widgets?: unknown
}

export const extensionsPlugin: Plugin.Object<ExtensionsConfig> = {
  name: 'extensions',
  inject: ['bus', 'config'],
  apply(context, config) {
    const bus = requireService<Bus>(context, 'bus')
    const loader = new ExtensionLoader(context, config.extensionsDir)
    // The retained config snapshot replays on subscribe, so this both loads
    // the initial list and follows every later change.
    context.effect(() =>
      bus.subscribe('config', (message) => {
        loader.applyFromSnapshot(message.data)
      }),
    )
    context.effect(() =>
      bus.subscribe('hot.backend', (message) => {
        loader.reload(idOf(message.data))
      }),
    )
    context.effect(() =>
      bus.retain('widgets.catalog', { widgets: widgetCatalog(config.extensionsDir) }),
    )
  },
}

// widgetCatalog reads every installed manifest once at load. Manifests do not
// change while the host runs — an extension is added by putting a directory in
// place and restarting — so this needs no watch.
export function widgetCatalog(extensionsDir: string): WidgetDeclaration[] {
  return installedEntries(extensionsDir).flatMap((entry) =>
    declarationsOf(readManifestSync(join(extensionsDir, entry.id))),
  )
}

// Which extensions a widget-hosting layer has to load the views of. Widgets
// are placed from config now, not declared in the view tree, so the tree no
// longer names the types a layer will be asked to mount — the desktop and the
// gallery need every widget provider, whether or not one is on screen yet.
export function widgetExtensionIds(extensionsDir: string): string[] {
  return installedEntries(extensionsDir)
    .filter((entry) => declaresWidgets(join(extensionsDir, entry.id)))
    .map((entry) => entry.id)
}

function declaresWidgets(dir: string): boolean {
  return declarationsOf(readManifestSync(dir)).length > 0
}

function readManifestSync(dir: string): ExtensionManifest | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ExtensionManifest
  } catch (error) {
    console.error(`extensions: cannot read manifest in ${dir}:`, error)
    return null
  }
}

function declarationsOf(manifest: ExtensionManifest | null): WidgetDeclaration[] {
  if (manifest === null || !Array.isArray(manifest.widgets)) {
    return []
  }
  return manifest.widgets.flatMap(declarationOf)
}

function declarationOf(value: unknown): WidgetDeclaration[] {
  if (typeof value !== 'object' || value === null) {
    return []
  }
  const raw = value as Record<string, unknown>
  if (typeof raw.type !== 'string' || raw.type === '' || typeof raw.name !== 'string') {
    return []
  }
  const sizes = sizesOf(raw.sizes)
  return [
    {
      type: raw.type,
      name: raw.name,
      category: stringOr(raw.category, 'Other'),
      description: stringOr(raw.description, ''),
      sizes,
      defaultSize: stringOr(raw.defaultSize, sizes[0]),
    },
  ]
}

// A widget that declares no sizes still has one: the gallery needs something
// to add, and every widget supports the smallest.
function sizesOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ['small']
  }
  const sizes = value.filter((entry): entry is string => typeof entry === 'string')
  if (sizes.length === 0) {
    return ['small']
  }
  return sizes
}

function stringOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value === '') {
    return fallback
  }
  return value
}

function idOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) {
    return ''
  }
  const id = (data as { id?: unknown }).id
  if (typeof id === 'string') {
    return id
  }
  return ''
}

class ExtensionLoader {
  private readonly context: Context
  private readonly extensionsDir: string
  private readonly mounted = new Map<
    string,
    { fiber: Fiber; signature: string; entry: ExtensionEntry }
  >()
  private queue: Promise<void> = Promise.resolve()

  constructor(context: Context, extensionsDir: string) {
    this.context = context
    this.extensionsDir = extensionsDir
  }

  // applyFromSnapshot serializes list applications so overlapping config
  // changes never interleave mounts and unmounts.
  applyFromSnapshot(snapshot: unknown): void {
    const entries = this.mountListOf(snapshot)
    this.queue = this.queue.then(() => this.applyList(entries)).catch(logApplyError)
  }

  // reload swaps one extension's backend in place: the fiber is disposed, so
  // its effects release their sockets and child processes, and the module is
  // re-imported under a fresh specifier because the ES module cache never
  // re-reads a path it has already loaded.
  reload(id: string): void {
    this.queue = this.queue.then(() => this.remount(id)).catch(logApplyError)
  }

  private async remount(id: string): Promise<void> {
    const mountedExtension = this.mounted.get(id)
    if (mountedExtension === undefined) {
      return
    }
    await mountedExtension.fiber.dispose()
    this.mounted.delete(id)
    backendGeneration += 1
    await this.mountIfMissing(id, mountedExtension.entry)
  }

  private mountListOf(snapshot: unknown): ExtensionEntry[] {
    const declared = entriesOf(snapshot)
    if (declared !== null) {
      return declared
    }
    return installedEntries(this.extensionsDir)
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
    await this.mountMissing(desired)
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

  private async mountMissing(desired: Map<string, ExtensionEntry>): Promise<void> {
    for (const [id, entry] of desired) {
      await this.mountIfMissing(id, entry)
    }
  }

  private async mountIfMissing(id: string, entry: ExtensionEntry): Promise<void> {
    if (this.mounted.has(id)) {
      return
    }
    const plugin = await this.loadBackend(entry)
    if (plugin === null) {
      return
    }
    const fiber = this.context.plugin(plugin, entry.config)
    this.mounted.set(id, { fiber, signature: signatureOf(entry), entry })
  }

  private async loadBackend(entry: ExtensionEntry): Promise<Plugin.Object | null> {
    const dir = join(this.extensionsDir, nameOf(entry))
    const manifest = await readManifest(dir)
    if (manifest === null) {
      return null
    }
    if (manifest.backend === undefined) {
      // Views-only extension; its view half mounts through the view tree.
      return null
    }
    return importBackend(join(dir, manifest.backend), manifest, entry)
  }
}

// Bumped by a hot reload so the next import misses the module cache.
let backendGeneration = 0

function backendSpecifier(modulePath: string): string {
  if (backendGeneration === 0) {
    return modulePath
  }
  return `${modulePath}?g=${backendGeneration}`
}

async function importBackend(
  modulePath: string,
  manifest: ExtensionManifest,
  entry: ExtensionEntry,
): Promise<Plugin.Object | null> {
  let module: Record<string, unknown>
  try {
    module = (await import(backendSpecifier(modulePath))) as Record<string, unknown>
  } catch (error) {
    console.error(`extensions: failed to load backend ${modulePath}:`, error)
    return null
  }
  const base = pickPlugin(module)
  if (base === null) {
    console.error(`extensions: ${modulePath} exports no plugin`)
    return null
  }
  return wrapPlugin(base, manifest, entry)
}

// wrapPlugin renames the plugin to its entry id and lets the manifest's inject
// override the module's, so the manifest stays the declaration of record.
function wrapPlugin(base: Plugin.Object, manifest: ExtensionManifest, entry: ExtensionEntry): Plugin.Object {
  let inject = base.inject
  if (manifest.inject !== undefined) {
    inject = manifest.inject
  }
  return {
    name: entry.id,
    inject,
    apply(context, config) {
      return base.apply(context, config)
    },
  }
}

async function readManifest(dir: string): Promise<ExtensionManifest | null> {
  const path = join(dir, 'manifest.json')
  try {
    const manifest = (await Bun.file(path).json()) as ExtensionManifest
    if (typeof manifest.id !== 'string' || manifest.id === '') {
      console.error(`extensions: manifest ${path} is missing an id`)
      return null
    }
    return manifest
  } catch (error) {
    console.error(`extensions: cannot read manifest ${path}:`, error)
    return null
  }
}

function pickPlugin(module: Record<string, unknown>): Plugin.Object | null {
  if (isPlugin(module.default)) {
    return module.default
  }
  if (isPlugin(module)) {
    return module
  }
  return null
}

function isPlugin(value: unknown): value is Plugin.Object {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return typeof (value as Plugin.Object).apply === 'function'
}

// entriesOf returns null when the config declares no list at all — an absent
// key means "mount what is installed", the same way an absent "views" key
// means the default view tree. An empty array is a decision and stays empty.
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

// installedEntries is the fallback mount list: every directory under
// extensionsDir that carries a manifest, in directory order.
export function installedEntries(extensionsDir: string): ExtensionEntry[] {
  let names: string[]
  try {
    names = readdirSync(extensionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    console.error(`extensions: cannot read ${extensionsDir}:`, error)
    return []
  }
  return names
    .filter((name) => existsSync(join(extensionsDir, name, 'manifest.json')))
    .map((name) => ({ id: name }))
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
