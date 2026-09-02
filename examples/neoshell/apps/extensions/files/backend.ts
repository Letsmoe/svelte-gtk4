import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, watch, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { Context, Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { registerFunction, RetainedTopics } from '../lib/bus.js'
import type { BusService } from '../lib/bus.js'

// files: the desktop folder as a retained bus topic, plus the operations the
// desktop's icons and context menu need. The desktop view draws the icons;
// this side only knows the filesystem.
//
//   files.desktop    {path, entries: [{name, path, directory, icon, image}]}
//   files:open       {path} → {ok} | {error}          detached via xdg-open
//   files:openwith   {path, command} → {ok} | {error}  detached via sh -c
//   files:handlers   {path} → {mime, handlers: [{id, name, command}]}
//   files:newfolder  {dir?, name?} → {path} | {error}
//   files:rename     {path, name} → {path} | {error}
//   files:trash      {paths} → {trashed, errors}
//   files:images     {dir?} → {path, entries: [{name, path}]}
//
// icon is a freedesktop icon name the view resolves through the host's
// /appicon route; image marks entries the view can show as their own preview.

interface FilesConfig {
  desktopDir?: string
  wallpaperDir?: string
}

interface App {
  id: string
  name: string
  exec: string
  mimeTypes: string[]
}

const APPS_TIMEOUT_MS = 10000
const NEW_FOLDER_NAME = 'New Folder'

export interface DesktopEntry {
  name: string
  path: string
  directory: boolean
  icon: string
  image: boolean
}

const WATCH_DEBOUNCE_MS = 120

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
    registerFunction(context, bus, 'files:handlers', (data) => listHandlers(bus, data))
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
  return join(homeDir(), 'Desktop')
}

function wallpaperDirOf(config: FilesConfig | undefined): string {
  if (config !== undefined && config.wallpaperDir !== undefined && config.wallpaperDir !== '') {
    return config.wallpaperDir
  }
  return join(homeDir(), 'Pictures', 'Wallpapers')
}

function homeDir(): string {
  const home = process.env.HOME
  if (home === undefined || home === '') {
    return '/root'
  }
  return home
}

function watchDesktop(context: Context, topics: RetainedTopics, dir: string): void {
  const refresh = async () => {
    topics.set('files.desktop', { path: dir, entries: await readEntries(dir) })
  }
  context.effect(() => {
    void refresh()
    return watchDirectory(dir, refresh)
  })
}

// A directory that does not exist is the common case (no ~/Desktop at all):
// the topic stays an empty list and the view shows nothing, rather than the
// extension failing to mount.
function watchDirectory(dir: string, refresh: () => Promise<void>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => void refresh(), WATCH_DEBOUNCE_MS)
  }
  try {
    const watcher = watch(dir, schedule)
    return () => watcher.close()
  } catch {
    return () => {}
  }
}

async function readEntries(dir: string): Promise<DesktopEntry[]> {
  let dirents: Dirent[]
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const entries = dirents.filter(isVisible).map((dirent) => entryOf(dir, dirent))
  entries.sort(compareEntries)
  return entries
}

function isVisible(dirent: Dirent): boolean {
  return !dirent.name.startsWith('.')
}

function entryOf(dir: string, dirent: Dirent): DesktopEntry {
  const directory = dirent.isDirectory()
  return {
    name: dirent.name,
    path: join(dir, dirent.name),
    directory,
    icon: iconNameOf(dirent.name, directory),
    image: isImage(dirent.name),
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
  const extension = extname(name).toLowerCase()
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
  return IMAGE_EXTENSIONS.has(extname(name).toLowerCase())
}

// openEntry hands the path to the desktop's own handler, detached so the
// opened application outlives the shell.
function openEntry(data: unknown): unknown {
  const request = data as { path?: string }
  if (typeof request.path !== 'string' || request.path === '') {
    return { error: 'path is required' }
  }
  return detach('xdg-open', [request.path])
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
  return detach('sh', ['-c', `${request.command} ${shellQuote(request.path)}`])
}

function detach(command: string, args: string[]): unknown {
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true }
  } catch (error) {
    return { error: String(error) }
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

// listHandlers answers "Open With": the installed applications that claim the
// path's mime type. With no claimants the whole list is returned — a menu of
// everything still beats a menu of nothing.
async function listHandlers(bus: BusService, data: unknown): Promise<unknown> {
  const request = data as { path?: string }
  if (typeof request.path !== 'string' || request.path === '') {
    return { error: 'path is required' }
  }
  const mime = await mimeTypeOf(request.path)
  const apps = await installedApps(bus)
  const matching = apps.filter((app) => handles(app, mime))
  return { mime, handlers: handlersOf(pickHandlers(matching, apps)) }
}

function pickHandlers(matching: App[], all: App[]): App[] {
  if (matching.length > 0) {
    return matching
  }
  return all
}

function handlersOf(apps: App[]): Array<{ id: string; name: string; command: string }> {
  return apps
    .filter((app) => app.exec !== '')
    .map((app) => ({ id: app.id, name: app.name, command: app.exec }))
}

// A .desktop MimeType entry is normally an exact type, but "image/*" is common
// enough in the wild to be worth matching.
export function handles(app: App, mime: string): boolean {
  if (mime === '') {
    return false
  }
  const group = `${mime.split('/')[0]}/*`
  return app.mimeTypes.includes(mime) || app.mimeTypes.includes(group)
}

async function installedApps(bus: BusService): Promise<App[]> {
  const reply = await bus.call('apps:list', {}, APPS_TIMEOUT_MS)
  if (!Array.isArray(reply)) {
    return []
  }
  return reply as App[]
}

async function mimeTypeOf(path: string): Promise<string> {
  const output = await capture('xdg-mime', ['query', 'filetype', path])
  return output.trim()
}

function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(output))
  })
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
  try {
    mkdirSync(path, { recursive: false })
    return { path }
  } catch (error) {
    return { error: String(error) }
  }
}

function renameEntry(data: unknown): unknown {
  const request = data as { path?: string; name?: string }
  if (typeof request.path !== 'string' || request.path === '') {
    return { error: 'path is required' }
  }
  if (typeof request.name !== 'string' || !isSafeName(request.name)) {
    return { error: 'name must be a plain file name' }
  }
  const target = join(dirname(request.path), request.name)
  if (existsSync(target)) {
    return { error: `${request.name} already exists` }
  }
  try {
    renameSync(request.path, target)
    return { path: target }
  } catch (error) {
    return { error: String(error) }
  }
}

// trashEntries implements the freedesktop trash spec rather than unlinking:
// the desktop's delete has to be recoverable, and every file manager reads
// the same ~/.local/share/Trash layout.
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
  const error = trashOne(path)
  if (error === '') {
    trashed.push(path)
    return
  }
  errors.push(`${path}: ${error}`)
}

// The info file is written before the move, so a failed move never leaves a
// trashed file the desktop cannot attribute to an original path.
function trashOne(path: string): string {
  const trash = trashDir()
  try {
    mkdirSync(join(trash, 'files'), { recursive: true })
    mkdirSync(join(trash, 'info'), { recursive: true })
    const target = freePath(join(trash, 'files'), basename(path))
    writeFileSync(join(trash, 'info', `${basename(target)}.trashinfo`), trashInfo(path))
    renameSync(path, target)
    return ''
  } catch (error) {
    return String(error)
  }
}

export function trashInfo(path: string, now = new Date()): string {
  return `[Trash Info]\nPath=${encodeURI(path)}\nDeletionDate=${localTimestamp(now)}\n`
}

function localTimestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function trashDir(): string {
  const dataHome = process.env.XDG_DATA_HOME
  if (dataHome !== undefined && dataHome !== '') {
    return join(dataHome, 'Trash')
  }
  return join(homeDir(), '.local', 'share', 'Trash')
}

// listImages backs the wallpaper picker: the webview cannot read the
// filesystem and /wallpaper serves whatever path config names, so the choices
// have to come over the bus.
async function listImages(wallpaperDir: string, data: unknown): Promise<unknown> {
  const request = data as { dir?: string }
  const dir = stringOr(request.dir, wallpaperDir)
  let dirents: Dirent[]
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return { path: dir, entries: [] }
  }
  const entries = dirents
    .filter((dirent) => dirent.isFile() && isVisible(dirent) && isImage(dirent.name))
    .map((dirent) => ({ name: dirent.name, path: join(dir, dirent.name) }))
  entries.sort((left, right) => left.name.localeCompare(right.name))
  return { path: dir, entries }
}

// freePath appends " 2", " 3", … before the extension until nothing is in the
// way, the numbering a file manager uses for both copies and trashed names.
export function freePath(dir: string, name: string): string {
  const direct = join(dir, name)
  if (!existsSync(direct)) {
    return direct
  }
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  for (let index = 2; ; index += 1) {
    const candidate = join(dir, `${stem} ${index}${extension}`)
    if (!existsSync(candidate)) {
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
