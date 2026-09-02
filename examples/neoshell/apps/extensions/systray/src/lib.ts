import type { Context } from '@neoworks/extension-system'

// BusLike mirrors the surface runtime's BusClient; views receive it through
// the 'bus' service. Every extension carries its own copy: an extension is a
// self-contained directory, and a views bundle that imports across extensions
// could not be dropped in on its own.

export interface BusMessage {
  type: string
  data: unknown
}

export interface BusLike {
  publish(type: string, data: unknown): void
  subscribe(pattern: string, handler: (message: BusMessage) => void): () => void
  call(type: string, data: unknown, timeoutMs?: number): Promise<unknown>
}

// TrayItem is one systray.items entry. icon is a freedesktop icon name the
// host resolves at /appicon/<name>; iconData is a ready data URL. The daemon
// sets exactly one of them.
export interface TrayItem {
  key: string
  id: string
  title: string
  status: string
  icon: string
  iconData: string
  tooltip: string
  itemIsMenu: boolean
  // Items built on libayatana-appindicator implement no Activate at all — the
  // dbusmenu is their whole interaction, so a left click has to open it.
  hasActivate: boolean
  menuPath: string
}

// MenuEntry is one row of an item's dbusmenu, as the daemon flattened it.
export interface MenuEntry {
  id: number
  label: string
  enabled: boolean
  separator: boolean
  toggleType: string
  toggleState: number
  icon: string
  iconData: string
  children: MenuEntry[]
}

export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return value as Record<string, unknown>
}

function stringOf(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return ''
}

// An entry without a key cannot be clicked — the key is the handle every
// command carries — so it is dropped rather than drawn as a dead icon.
export function trayItemsOf(value: unknown): TrayItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(trayItemOf)
}

function trayItemOf(value: unknown): TrayItem[] {
  const entry = recordOf(value)
  if (typeof entry.key !== 'string' || entry.key === '') {
    return []
  }
  return [
    {
      key: entry.key,
      id: stringOf(entry.id),
      title: stringOf(entry.title),
      status: stringOf(entry.status),
      icon: stringOf(entry.icon),
      iconData: stringOf(entry.iconData),
      tooltip: stringOf(entry.tooltip),
      itemIsMenu: entry.itemIsMenu === true,
      hasActivate: entry.hasActivate === true,
      menuPath: stringOf(entry.menuPath),
    },
  ]
}

// A row without a numeric id cannot be reported back to the application, so it
// is dropped rather than drawn as a dead entry.
export function menuEntriesOf(value: unknown): MenuEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap(menuEntryOf)
}

function menuEntryOf(value: unknown): MenuEntry[] {
  const entry = recordOf(value)
  if (typeof entry.id !== 'number') {
    return []
  }
  return [
    {
      id: entry.id,
      label: stringOf(entry.label),
      enabled: entry.enabled !== false,
      separator: entry.separator === true,
      toggleType: stringOf(entry.toggleType),
      toggleState: numberOf(entry.toggleState, -1),
      icon: stringOf(entry.icon),
      iconData: stringOf(entry.iconData),
      children: menuEntriesOf(entry.children),
    },
  ]
}

function numberOf(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return value
  }
  return fallback
}

// Menu rows carry the same two icon shapes tray items do.
export function menuIconSourceOf(entry: MenuEntry, size: number): string {
  if (entry.iconData !== '') {
    return entry.iconData
  }
  if (entry.icon === '') {
    return ''
  }
  return `/appicon/${encodeURIComponent(entry.icon)}?size=${size}`
}

// The label under an icon that resolved to nothing: the first letter of
// whatever the item calls itself.
export function initialOf(item: TrayItem): string {
  const source = firstNonEmpty(item.title, item.id)
  if (source === '') {
    return '?'
  }
  return source.slice(0, 1).toUpperCase()
}

export function iconSourceOf(item: TrayItem, size: number): string {
  if (item.iconData !== '') {
    return item.iconData
  }
  if (item.icon === '') {
    return ''
  }
  return `/appicon/${encodeURIComponent(item.icon)}?size=${size}`
}

export function tooltipTextOf(item: TrayItem): string {
  return firstNonEmpty(item.tooltip, firstNonEmpty(item.title, item.id))
}

function firstNonEmpty(primary: string, fallback: string): string {
  if (primary !== '') {
    return primary
  }
  return fallback
}

// requireService reads a service the view plugin listed in its inject, where
// the kernel guarantees presence — it throws instead of returning undefined so
// callers skip the null check.
export function requireService<Value>(context: Context, name: string): Value {
  const value = context.get(name) as Value | undefined
  if (value === undefined) {
    throw new Error(`views: service "${name}" is not available`)
  }
  return value
}
