import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../services.js'
import type { ConfigService } from './config.js'

// assetsPlugin is the host's one honest wart (see ARCHITECTURE.md "Open"):
// webviews cannot read the filesystem, so the host serves the few local assets
// views need over HTTP instead of extensions registering routes.
//
//   /appicon/<name>?size=64   freedesktop icon name → themed image
//   /wallpaper                the configured wallpaper image
//   /file?path=<abs>          an absolute-path regular file (previews)
//
// Routes register on the default ServeMux-equivalent: Bun.serve is owned by
// the http plugin, so this plugin provides a resolver service and the http
// plugin routes to it.

export interface AssetsService {
  handle(url: URL): Promise<Response> | Response | null
}

export const assetsPlugin: Plugin.Object = {
  name: 'assets',
  inject: ['config'],
  apply(context) {
    const config = requireService<ConfigService>(context, 'config')
    const resolver = new IconResolver()
    context.provide('assets', new Assets(config, resolver))
  },
}

class Assets implements AssetsService {
  private readonly config: ConfigService
  private readonly icons: IconResolver

  constructor(config: ConfigService, icons: IconResolver) {
    this.config = config
    this.icons = icons
  }

  handle(url: URL): Promise<Response> | Response | null {
    if (url.pathname.startsWith('/appicon/')) {
      return this.serveIcon(url)
    }
    if (url.pathname === '/wallpaper') {
      return this.serveWallpaper()
    }
    if (url.pathname === '/file') {
      return serveLocalFile(url.searchParams.get('path'))
    }
    return null
  }

  private serveIcon(url: URL): Response {
    const name = decodeURIComponent(url.pathname.slice('/appicon/'.length))
    const size = sizeParam(url)
    const path = this.icons.resolve(name, size)
    if (path === '') {
      return new Response('not found', { status: 404 })
    }
    return fileResponse(path)
  }

  private serveWallpaper(): Response {
    const value = this.config.get('appearance.wallpaper')
    if (typeof value !== 'string' || value === '') {
      return new Response('not found', { status: 404 })
    }
    return fileResponse(value)
  }
}

function serveLocalFile(path: string | null): Response {
  if (path === null || !isAbsolute(path)) {
    return new Response('absolute path required', { status: 400 })
  }
  if (!existsSync(path)) {
    return new Response('not found', { status: 404 })
  }
  return fileResponse(path)
}

// fileResponse serves a file CORS-open — in dev the page origin differs from
// the host, and a tainted canvas breaks wallpaper sampling.
function fileResponse(path: string): Response {
  return new Response(Bun.file(path), {
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}

function sizeParam(url: URL): number {
  const raw = url.searchParams.get('size')
  if (raw === null) {
    return 64
  }
  const size = Number.parseInt(raw, 10)
  if (Number.isNaN(size) || size <= 0) {
    return 64
  }
  return size
}

const ICON_EXTENSIONS = ['.svg', '.png', '.xpm']

// IconResolver maps a freedesktop icon name to a file, walking theme trees in
// a fixed fallback order and caching — desktop icon names repeat constantly
// and are stable for a session. Simplified from the Go resolver: no theme
// index parsing, both size-first and category-first tree layouts probed.
export class IconResolver {
  private readonly cache = new Map<string, string>()
  private readonly baseDirs: string[]

  constructor(baseDirs?: string[]) {
    if (baseDirs !== undefined) {
      this.baseDirs = baseDirs
    } else {
      this.baseDirs = [
        join(homedir(), '.local', 'share', 'icons'),
        join(homedir(), '.icons'),
        '/usr/local/share/icons',
        '/usr/share/icons',
      ]
    }
  }

  resolve(rawName: string, size: number): string {
    if (rawName === '') {
      return ''
    }
    if (isAbsolute(rawName)) {
      return existingOrEmpty(rawName)
    }
    const name = stripImageExtension(rawName)
    const cacheKey = `${name}@${size}`
    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
    const resolved = this.resolveUncached(name, size)
    this.cache.set(cacheKey, resolved)
    return resolved
  }

  private resolveUncached(name: string, size: number): string {
    for (const base of this.baseDirs) {
      for (const theme of ['hicolor', 'Adwaita', 'breeze', 'Papirus']) {
        const found = scanTheme(join(base, theme), name, size)
        if (found !== '') {
          return found
        }
      }
    }
    return scanPixmaps(name)
  }
}

interface Candidate {
  path: string
  score: number
}

// scanTheme probes both freedesktop layouts (theme/<size>/<category>/name and
// theme/<category>/<size>/name), scoring by distance from the requested size;
// scalable beats any raster mismatch.
function scanTheme(themeDir: string, name: string, size: number): string {
  const candidates: Candidate[] = []
  for (const level1 of subdirectoriesOf(themeDir)) {
    collectCandidates(join(themeDir, level1), level1, name, size, candidates)
  }
  candidates.sort((a, b) => a.score - b.score)
  if (candidates.length === 0) {
    return ''
  }
  return candidates[0].path
}

function collectCandidates(
  level1Path: string,
  level1Name: string,
  name: string,
  size: number,
  candidates: Candidate[],
): void {
  addFileCandidate(level1Path, level1Name, name, size, candidates)
  for (const level2 of subdirectoriesOf(level1Path)) {
    const bucket = pickSizeBucket(level1Name, level2)
    addFileCandidate(join(level1Path, level2), bucket, name, size, candidates)
  }
}

// pickSizeBucket chooses whichever path segment looks like a size ("48x48",
// "scalable"), covering both tree layouts.
function pickSizeBucket(level1: string, level2: string): string {
  if (bucketSize(level2) !== null || level2 === 'scalable') {
    return level2
  }
  return level1
}

function addFileCandidate(
  dir: string,
  bucket: string,
  name: string,
  size: number,
  candidates: Candidate[],
): void {
  for (const extension of ICON_EXTENSIONS) {
    const path = join(dir, name + extension)
    if (!existsSync(path)) {
      continue
    }
    candidates.push({ path, score: bucketScore(bucket, size, extension) })
    return
  }
}

// bucketScore: 0 = exact raster size, 1 = scalable SVG, otherwise the size
// distance (+2 so scalable wins over any mismatch).
function bucketScore(bucket: string, size: number, extension: string): number {
  if (bucket === 'scalable' || extension === '.svg') {
    return 1
  }
  const bucketPixels = bucketSize(bucket)
  if (bucketPixels === null) {
    return 1000
  }
  if (bucketPixels === size) {
    return 0
  }
  return Math.abs(bucketPixels - size) + 2
}

function bucketSize(bucket: string): number | null {
  const match = /^(\d+)x\d+$/.exec(bucket)
  if (match === null) {
    return null
  }
  return Number.parseInt(match[1], 10)
}

function scanPixmaps(name: string): string {
  for (const extension of ICON_EXTENSIONS) {
    const path = join('/usr/share/pixmaps', name + extension)
    if (existsSync(path)) {
      return path
    }
  }
  return ''
}

function subdirectoriesOf(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function stripImageExtension(name: string): string {
  for (const extension of ICON_EXTENSIONS) {
    if (name.endsWith(extension)) {
      return name.slice(0, -extension.length)
    }
  }
  return name
}

function existingOrEmpty(path: string): string {
  if (existsSync(path)) {
    return path
  }
  return ''
}
