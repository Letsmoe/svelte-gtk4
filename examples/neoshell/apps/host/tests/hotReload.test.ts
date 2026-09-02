import { describe, expect, test } from 'bun:test'
import { classifyChange } from '../src/plugins/hotReload.js'

describe('classifying a watched change', () => {
  test('a backend module reloads the extension fiber', () => {
    expect(classifyChange('media/backend.ts')).toEqual({ topic: 'hot.backend', id: 'media' })
  })

  test('a manifest reloads the extension fiber', () => {
    expect(classifyChange('media/manifest.json')).toEqual({ topic: 'hot.backend', id: 'media' })
  })

  test('a built bundle reloads the views', () => {
    expect(classifyChange('neoshell/dist/views.js')).toEqual({
      topic: 'hot.views',
      id: 'neoshell',
    })
  })

  // Sources compile into dist, so reacting to both would reload once against a
  // bundle that has not been rebuilt yet.
  test('a view source is ignored in favour of the bundle it builds into', () => {
    expect(classifyChange('neoshell/src/Notch.svelte')).toBeNull()
  })

  test('dependencies are ignored', () => {
    expect(classifyChange('neoshell/node_modules/svelte/index.js')).toBeNull()
  })

  test('a file loose in the extensions dir belongs to no extension', () => {
    expect(classifyChange('README.md')).toBeNull()
  })

  test('a non-source file is ignored', () => {
    expect(classifyChange('neoshell/notes.txt')).toBeNull()
  })
})
