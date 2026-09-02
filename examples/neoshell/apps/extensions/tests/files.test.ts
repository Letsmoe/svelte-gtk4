import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  compareEntries,
  freePath,
  handles,
  iconNameOf,
  isImage,
  isSafeName,
  trashInfo,
} from '../files/backend.js'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'neoshell-files-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('desktop entry naming', () => {
  test('folders and known extensions map to freedesktop icon names', () => {
    expect(iconNameOf('Projects', true)).toBe('folder')
    expect(iconNameOf('notes.pdf', false)).toBe('application-pdf')
    expect(iconNameOf('shot.png', false)).toBe('image-x-generic')
    expect(iconNameOf('notes.unknown', false)).toBe('text-x-generic')
  })

  test('only decodable extensions are previewed as themselves', () => {
    expect(isImage('shot.PNG')).toBe(true)
    expect(isImage('notes.pdf')).toBe(false)
  })

  test('folders sort ahead of files, then names case-insensitively', () => {
    const folder = { name: 'zzz', path: '', directory: true, icon: '', image: false }
    const file = { name: 'aaa', path: '', directory: false, icon: '', image: false }

    expect(compareEntries(folder, file)).toBeLessThan(0)
    expect(compareEntries(file, folder)).toBeGreaterThan(0)
  })
})

describe('free paths', () => {
  test('an unused name is taken as it is', () => {
    expect(freePath(dir, 'New Folder')).toBe(join(dir, 'New Folder'))
  })

  test('a taken name is numbered from 2, keeping the extension last', () => {
    writeFileSync(join(dir, 'shot.png'), '')
    writeFileSync(join(dir, 'shot 2.png'), '')

    expect(basename(freePath(dir, 'shot.png'))).toBe('shot 3.png')
  })

  test('a taken directory name is numbered without inventing an extension', () => {
    mkdirSync(join(dir, 'New Folder'))

    expect(basename(freePath(dir, 'New Folder'))).toBe('New Folder 2')
  })
})

describe('rename safety', () => {
  test('a plain file name is accepted', () => {
    expect(isSafeName('notes.txt')).toBe(true)
  })

  test('names that would escape the folder are refused', () => {
    expect(isSafeName('../etc/passwd')).toBe(false)
    expect(isSafeName('a/b')).toBe(false)
    expect(isSafeName('..')).toBe(false)
    expect(isSafeName('')).toBe(false)
  })
})

describe('trash info files', () => {
  test('the original path is recorded percent-encoded, separators intact', () => {
    const info = trashInfo('/home/moritz/Desktop/my notes.txt', new Date(2026, 7, 30, 14, 3, 9))

    expect(info).toBe(
      '[Trash Info]\nPath=/home/moritz/Desktop/my%20notes.txt\nDeletionDate=2026-08-30T14:03:09\n',
    )
  })
})

describe('open-with matching', () => {
  const viewer = { id: 'viewer', name: 'Viewer', exec: 'viewer', mimeTypes: ['image/png'] }
  const gallery = { id: 'gallery', name: 'Gallery', exec: 'gallery', mimeTypes: ['image/*'] }

  test('an exact mime type claim matches', () => {
    expect(handles(viewer, 'image/png')).toBe(true)
    expect(handles(viewer, 'image/jpeg')).toBe(false)
  })

  test('a group wildcard claim matches any type in the group', () => {
    expect(handles(gallery, 'image/jpeg')).toBe(true)
    expect(handles(gallery, 'text/plain')).toBe(false)
  })

  test('an unknown mime type matches nothing rather than everything', () => {
    expect(handles(gallery, '')).toBe(false)
  })
})
