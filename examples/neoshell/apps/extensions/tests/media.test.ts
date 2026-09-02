import { describe, expect, test } from 'bun:test'
import { trackOf } from '../media/backend.js'

const SEPARATOR = '\u001f'

describe('playerctl track parsing', () => {
  test('a full metadata line becomes a track', () => {
    const line = [
      'Playing',
      'Tokyo',
      'The Wombats',
      'This Modern Glitch',
      'file:///art.png',
      '213000000',
      'true',
    ].join(SEPARATOR)

    expect(trackOf(line)).toEqual({
      status: 'Playing',
      title: 'Tokyo',
      artist: 'The Wombats',
      album: 'This Modern Glitch',
      artUrl: 'file:///art.png',
      length: 213,
      shuffle: true,
    })
  })

  test('a stream with no duration reports zero length', () => {
    const line = ['Playing', 'Some Radio', 'Station', '', '', '', 'false'].join(SEPARATOR)
    const track = trackOf(line)

    expect(track.length).toBe(0)
    expect(track.shuffle).toBe(false)
  })

  test('a title carrying the usual delimiters survives', () => {
    const line = ['Playing', 'a | b - c, d', 'X', '', '', '0', 'false'].join(SEPARATOR)

    expect(trackOf(line).title).toBe('a | b - c, d')
  })

  test('a player reporting no art leaves the field empty', () => {
    const line = ['Paused', 'Tokyo', 'The Wombats'].join(SEPARATOR)
    const track = trackOf(line)

    expect(track.status).toBe('Paused')
    expect(track.album).toBe('')
    expect(track.artUrl).toBe('')
  })
})
