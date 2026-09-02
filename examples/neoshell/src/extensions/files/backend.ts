import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import type { Context, Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import { registerFunction, RetainedTopics } from '../../lib/bus.js'
import type { BusService } from '../../lib/bus.js'
import {
  fileExists,
  joinPath,
  makeDirectory,
  moveToTrash,
  readDirectoryEntries,
  renameTo,
  watchDirectory,
} from '../../gjs/fs.js'

// files: the desktop folder as a retained bus topic, plus the operations the
// desktop's icons and context menu need. The desktop view draws the icons;
// this side only knows the filesystem.
//
//   files.desktop    {path, entries: [{name, path, directory, icon, image}]}
//   files:open       {path} → {ok} | {error}
//   files:openwith   {path, command} → {ok} | {error}
//   files:handlers   {path} → {mime, handlers: [{id, name, command}]}
//   files:newfolder  {dir?, name?} → {path} | {error}
//   files:rename     {path, name} → {path} | {error}
//   files:trash      {paths} → {trashed, errors}
//   files:images     {dir?} → {path, entries: [{name, path}]}
//
// Three parts of the node build are gone rather than ported, because GIO does
// them: the freedesktop trash layout (Gio.File.trash), the xdg-mime probe and
// .desktop scan behind "Open With" (Gio.AppInfo.get_all_for_type), and the
// xdg-open spawn (Gio.AppInfo.launch_default_for_uri).
//
// icon is a freedesktop icon name the view hands straight to the icon theme;
// image marks entries the view shows as their own preview.

interface FilesConfig {
  desktopDir?: string
  wallpaperDir?: string
}

const NEW_FOLDER_NAME = 'New Folder'
const WATCH_DEBOUNCE_MS = 120

export interface DesktopEntry {
  name: string
  path: string
  directory: boolean
  icon: string
  image: boolean
}

const filesExtension: Plugin.Object<FilesConfig | undefined> = {
  name: 'files',
  inject: ['bus'],
  apply(context, config) {
    const bus = requireService<BusService>(context, 'bus')
    const topics = new RetainedTopics(bus)
    const desktopDir = desktopDirOf(config)
    const wallpaperDir = wallpaperDirOf(config)
    context.effect(() => () => topics.withdrawAll())
    watchDesktop(context, topics, desktopDir)
    registerFunction(context, bus, 'files:open', (data) => openEntry(data))
    registerFunction(context, bus, 'files:openwith', (data) => openWith(data))
    registerFunction(context, bus, 'files:handlers', (data) => listHandlers(data))
    registerFunction(context, bus, 'files:newfolder', (data) => newFolder(desktopDir, data))
    registerFunction(context, bus, 'files:rename', (data) => renameEntry(data))
    registerFunction(context, bus, 'files:trash', (data) => trashEntries(data))
    registerFunction(context, bus, 'files:images', (data) => listImages(wallpaperDir, data))
  },
}

export default filesExtension

function desktopDirOf(config: FilesConfig | undefined): string {
  if (config !== undefined && config.desktopDir !== undefined && config.desktopDir !== '') {
    return config.desktopDir
  }
  const desktop = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP)
  if (desktop !== null) {
    return desktop
  }
  return joinPath(GLib.get_home_dir(), 'Desktop')
}

function wallpaperDirOf(config: FilesConfig | undefined): string {
  if (config !== undefined && config.wallpaperDir !== undefined && config.wallpaperDir !== '') {
    return config.wallpaperDir
  }
  return joinPath(GLib.get_home_dir(), 'Pictures', 'Wallpapers')
}

function watchDesktop(context: Context, topics: RetainedTopics, dir: string): void {
  const refresh = () => {
    topics.set('files.desktop', { path: dir, entries: readEntries(dir) })
  }
  context.effect(() => {
    refresh()
    return watchDebounced(dir, refresh)
  })
}

// A directory that does not exist is the common case (no ~/Desktop at all):
// the topic stays an empty list and the view shows nothing, rather than the
// extension failing to mount.
function watchDebounced(dir: string, refresh: () => void): () => void {
  let timer: number | null = null
  const stop = watchDirectory(dir, () => {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(refresh, WATCH_DEBOUNCE_MS)
  })
  return () => {
    if (timer !== null) {
      clearTimeout(timer)
    }
    stop()
  }
}

function readEntries(dir: string): DesktopEntry[] {
  const entries = readDirectoryEntries(dir)
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => entryOf(dir, entry.name, entry.directory))
  entries.sort(compareEntries)
  return entries
}

function entryOf(dir: string, name: string, directory: boolean): DesktopEntry {
  return {
    name,
    path: joinPath(dir, name),
    directory,
    icon: iconNameOf(name, directory),
    image: isImage(name),
  }
}

// Folders first, then names case-insensitively — the ordering every file
// manager uses, and the one an icon grid reads as sorted.
export function compareEntries(left: DesktopEntry, right: DesktopEntry): number {
  if (left.directory !== right.directory) {
    if (left.directory) {
      return -1
    }
    return 1
  }
  return left.name.toLowerCase().localeCompare(right.name.toLowerCase())
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp'])

const ICON_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application-pdf',
  '.zip': 'application-x-archive',
  '.tar': 'application-x-archive',
  '.gz': 'application-x-archive',
  '.xz': 'application-x-archive',
  '.7z': 'application-x-archive',
  '.mp3': 'audio-x-generic',
  '.flac': 'audio-x-generic',
  '.wav': 'audio-x-generic',
  '.opus': 'audio-x-generic',
  '.mp4': 'video-x-generic',
  '.mkv': 'video-x-generic',
  '.webm': 'video-x-generic',
  '.sh': 'text-x-script',
  '.desktop': 'application-x-executable',
}

export function iconNameOf(name: string, directory: boolean): string {
  if (directory) {
    return 'folder'
  }
  const extension = extensionOf(name)
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image-x-generic'
  }
  const icon = ICON_BY_EXTENSION[extension]
  if (icon === undefined) {
    return 'text-x-generic'
  }
  return icon
}

export function isImage(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name))
}

// openEntry hands the path to the desktop's own handler. GIO launches it
// through the portal or a fresh process group, so the opened application
// outlives the shell without a detach of our own.
function openEntry(data: unknown): unknown {
  const request = data as { path?: string }
  if (typeof request.path !== 'string' || request.path === '') {
    return { error: 'path is required' }
  }
  try {
    Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(request.path).get_uri(), null)
    return { ok: true }
  } catch (error) {
    return { error: String(error) }
  }
}

// openWith runs one application's Exec line against the path. The command
// comes from files:handlers, which has already stripped the .desktop field
// codes, so the path is appended as a single quoted argument.
function openWith(data: unknown): unknown {
  const request = data as { path?: string; command?: string }
  if (typeof request.path !== 'string' || request.path === '') {
    return { error: 'path is required' }
  }
  if (typeof request.command !== 'string' || request.command.trim() === '') {
    return { error: 'command is required' }
  }
  const line = `${request.command} ${shellQuote(request.path)}`
  try {
    Gio.Subprocess.new(['setsid', '--fork', 'sh', '-c', line], Gio.SubprocessFlags.NONE)
    return { ok: true }
  } catch (error) {
    return { error: String(error) }
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

// listHandlers answers "Open With": the installed applications that claim the
// path's content type. With no claimants the whole list is returned — a menu of
// everything still beats a menu of nothing.
function listHandlers(data: unknown): unknown {
  const request = data as { path?: string }
  if (typeof request.path !== 'string' || request.path === '') {
    return { error: 'path is required' }
  }
  const mime = contentTypeOf(request.path)
  return { mime, handlers: handlersOf(appsFor(mime)) }
}

function appsFor(mime: string): Gio.AppInfo[] {
  const matching = Gio.AppInfo.get_all_for_type(mime)
  if (matching.length > 0) {
    return matching
  }
  return Gio.AppInfo.get_all()
}

function handlersOf(apps: Gio.AppInfo[]): Array<{ id: string; name: string; command: string }> {
  const handlers: Array<{ id: string; name: string; command: string }> = []
  for (const app of apps) {
    addHandler(handlers, app)
  }
  return handlers
}

function addHandler(
  handlers: Array<{ id: string; name: string; command: string }>,
  app: Gio.AppInfo,
): void {
  const command = app.get_commandline()
  if (command === null || command === '') {
    return
  }
  handlers.push({ id: idOf(app), name: nameOf(app), command: cleanExec(command) })
}

function idOf(app: Gio.AppInfo): string {
  const id = app.get_id()
  if (id === null) {
    return nameOf(app)
  }
  return id
}

function nameOf(app: Gio.AppInfo): string {
  const name = app.get_display_name()
  if (name === null) {
    return ''
  }
  return name
}

// The command line still carries the .desktop field codes GIO would have
// substituted; the path is appended by openWith instead.
function cleanExec(command: string): string {
  return command.replace(/%[fFuUdDnNickvm]/g, '').replace(/\s+/g, ' ').trim()
}

function contentTypeOf(path: string): string {
  try {
    const info = Gio.File.new_for_path(path).query_info(
      'standard::content-type',
      Gio.FileQueryInfoFlags.NONE,
      null,
    )
    const type = info.get_content_type()
    if (type === null) {
      return ''
    }
    return type
  } catch {
    return ''
  }
}

// newFolder picks the first free "New Folder", "New Folder 2", … so repeated
// invocations never collide and never overwrite.
function newFolder(desktopDir: string, data: unknown): unknown {
  const request = data as { dir?: string; name?: string }
  const dir = stringOr(request.dir, desktopDir)
  const name = stringOr(request.name, NEW_FOLDER_NAME)
  if (!isSafeName(name)) {
    return { error: 'name must not contain a path separator' }
  }
  const path = freePath(dir, name)
  makeDirectory(path)
  if (!fileExists(path)) {
    return { error: `cannot create ${path}` }
  }
  return { path }
}

function renameEntry(data: unknown): unknown {
  const request = data as { path?: string; name?: string }
  if (typeof request.path !== 'string' || request.path === '') {
    return { error: 'path is required' }
  }
  if (typeof request.name !== 'string' || !isSafeName(request.name)) {
    return { error: 'name must be a plain file name' }
  }
  const target = joinPath(directoryOf(request.path), request.name)
  if (fileExists(target)) {
    return { error: `${request.name} already exists` }
  }
  const error = renameTo(request.path, target)
  if (error !== '') {
    return { error }
  }
  return { path: target }
}

function trashEntries(data: unknown): unknown {
  const request = data as { paths?: unknown }
  const paths = stringsOf(request.paths)
  if (paths.length === 0) {
    return { error: 'paths is required' }
  }
  const trashed: string[] = []
  const errors: string[] = []
  for (const path of paths) {
    collectTrashResult(path, trashed, errors)
  }
  return { trashed, errors }
}

function collectTrashResult(path: string, trashed: string[], errors: string[]): void {
  const error = moveToTrash(path)
  if (error === '') {
    trashed.push(path)
    return
  }
  errors.push(`${path}: ${error}`)
}

// listImages backs the wallpaper picker.
function listImages(wallpaperDir: string, data: unknown): unknown {
  const request = data as { dir?: string }
  const dir = stringOr(request.dir, wallpaperDir)
  const entries = readDirectoryEntries(dir)
    .filter((entry) => !entry.directory && !entry.name.startsWith('.') && isImage(entry.name))
    .map((entry) => ({ name: entry.name, path: joinPath(dir, entry.name) }))
  entries.sort((left, right) => left.name.localeCompare(right.name))
  return { path: dir, entries }
}

// freePath appends " 2", " 3", … before the extension until nothing is in the
// way, the numbering a file manager uses for both copies and trashed names.
export function freePath(dir: string, name: string): string {
  const direct = joinPath(dir, name)
  if (!fileExists(direct)) {
    return direct
  }
  const extension = extensionOf(name)
  const stem = name.slice(0, name.length - extension.length)
  for (let index = 2; ; index += 1) {
    const candidate = joinPath(dir, `${stem} ${index}${extension}`)
    if (!fileExists(candidate)) {
      return candidate
    }
  }
}

export function isSafeName(name: string): boolean {
  if (name === '' || name === '.' || name === '..') {
    return false
  }
  return !name.includes('/')
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) {
    return ''
  }
  return name.slice(dot).toLowerCase()
}

function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/')
  if (cut <= 0) {
    return '/'
  }
  return path.slice(0, cut)
}

function stringOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value === '') {
    return fallback
  }
  return value
}

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
}
