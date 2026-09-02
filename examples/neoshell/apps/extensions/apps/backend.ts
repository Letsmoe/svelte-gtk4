import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { registerFunction } from '../lib/bus.js'
import type { BusService } from '../lib/bus.js'

// apps: freedesktop .desktop entries and detached launching, moved out of the
// Go core (internal/apps). Two functions, deliberately primitive — no
// name-resolution wrapper, callers match against the returned list themselves:
//
//   apps:list    → App[] (visible applications, deduped by id, sorted by name)
//   apps:launch  {command} → {ok} | {error}   detached via sh -c + setsid

export interface App {
  id: string
  name: string
  exec: string
  icon: string
  wmClass: string
  categories: string[]
  mimeTypes: string[]
}

interface AppsConfig {
  searchDirs?: string[]
}

const appsExtension: Plugin.Object<AppsConfig | undefined> = {
  name: 'apps',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<BusService>(context, 'bus')
    const searchDirs = resolveSearchDirs(config)
    registerFunction(context, bus, 'apps:list', () => listApps(searchDirs))
    registerFunction(context, bus, 'apps:launch', (data) => launchApp(data))
  },
}

export default appsExtension

// resolveSearchDirs mirrors the XDG order, user first so a user override wins
// over a system entry of the same id.
function resolveSearchDirs(config: AppsConfig | undefined): string[] {
  if (config !== undefined && config.searchDirs !== undefined) {
    return config.searchDirs
  }
  const dirs = [
    join(homeDir(), '.local', 'share', 'applications'),
    '/usr/local/share/applications',
    '/usr/share/applications',
  ]
  const xdgDataDirs = process.env.XDG_DATA_DIRS
  if (xdgDataDirs === undefined || xdgDataDirs === '') {
    return dirs
  }
  for (const base of xdgDataDirs.split(':')) {
    if (base !== '') {
      dirs.push(join(base, 'applications'))
    }
  }
  return dirs
}

function homeDir(): string {
  const home = process.env.HOME
  if (home === undefined || home === '') {
    return '/root'
  }
  return home
}

export function listApps(searchDirs: string[]): App[] {
  const seen = new Set<string>()
  const result: App[] = []
  for (const dir of searchDirs) {
    collectApps(dir, seen, result)
  }
  result.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return result
}

function collectApps(dir: string, seen: Set<string>, result: App[]): void {
  for (const fileName of desktopFilesIn(dir)) {
    const id = fileName.slice(0, -'.desktop'.length)
    if (seen.has(id)) {
      continue
    }
    const app = parseDesktopFile(join(dir, fileName), id)
    if (app === null) {
      continue
    }
    seen.add(id)
    result.push(app)
  }
}

function desktopFilesIn(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.filter((entry) => entry.endsWith('.desktop'))
}

// parseDesktopFile reads the [Desktop Entry] group; null for entries that
// should not be shown or launched (non-applications, NoDisplay, Hidden).
function parseDesktopFile(path: string, id: string): App | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const app: App = {
    id,
    name: '',
    exec: '',
    icon: '',
    wmClass: '',
    categories: [],
    mimeTypes: [],
  }
  let inEntry = false
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]'
      continue
    }
    if (!inEntry) {
      continue
    }
    if (!applyDesktopLine(app, line)) {
      return null
    }
  }
  return app
}

// applyDesktopLine folds one key=value line into app; false means the whole
// entry is not a launchable application.
function applyDesktopLine(app: App, line: string): boolean {
  const separatorIndex = line.indexOf('=')
  if (separatorIndex < 0) {
    return true
  }
  const key = line.slice(0, separatorIndex)
  const value = line.slice(separatorIndex + 1)
  if (key === 'Type' && value !== 'Application') {
    return false
  }
  if ((key === 'NoDisplay' || key === 'Hidden') && value.toLowerCase() === 'true') {
    return false
  }
  if (key === 'Name' && app.name === '') {
    app.name = value
  }
  if (key === 'Exec') {
    app.exec = cleanExec(value)
  }
  if (key === 'Icon') {
    app.icon = value
  }
  if (key === 'StartupWMClass') {
    app.wmClass = value
  }
  if (key === 'Categories') {
    app.categories = value.split(';').filter((category) => category !== '')
  }
  if (key === 'MimeType') {
    app.mimeTypes = value.split(';').filter((mimeType) => mimeType !== '')
  }
  return true
}

// cleanExec strips .desktop field codes (%U, %f, …) the shell cannot expand.
function cleanExec(exec: string): string {
  return exec.replace(/%[fFuUdDnNickvm]/g, '').replace(/\s+/g, ' ').trim()
}

// launchApp starts a command detached, in its own session, so the compositor
// maps the window and the app outlives the shell. sh -c keeps .desktop Exec
// lines with env prefixes working.
function launchApp(data: unknown): unknown {
  const args = data as { command?: string }
  if (typeof args.command !== 'string' || args.command.trim() === '') {
    return { error: 'command is required' }
  }
  try {
    const child = spawn('sh', ['-c', args.command], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return { ok: true }
  } catch (error) {
    return { error: String(error) }
  }
}
