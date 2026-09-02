import type { Context, Plugin } from '@neoworks/extension-system'
import { requireService } from '../lib/services.js'
import { RetainedTopics, registerFunction } from '../lib/bus.js'
import type { BusService } from '../lib/bus.js'
import { output, run } from '../lib/proc.js'

// media: the MPRIS player's current track as a retained bus topic, followed
// through playerctl rather than D-Bus directly — the same shape as the system
// extension shelling out to wpctl.
//
//   media.player    {status, title, artist, album, artUrl, length, shuffle}
//   media.position  {position}
//
//   media:playPause  {}         → {ok} | {error}
//   media:next       {}         → {ok} | {error}
//   media:previous   {}         → {ok} | {error}
//   media:shuffle    {}         → {ok} | {error}
//   media:seek       {seconds}  → {ok} | {error}
//
// artUrl is whatever MPRIS reports: file:// for local art, http(s) for
// streamed art, or empty. Surfaces resolve file:// through the host's /file
// route — a page served over http cannot read file:// itself.
//
// length and position are seconds; MPRIS reports microseconds. Only length
// travels with the track, because --follow emits on metadata change and never
// on the playhead moving — position is polled instead, and only while a player
// is actually playing.

interface TrackState {
  status: string
  title: string
  artist: string
  album: string
  artUrl: string
  length: number
  shuffle: boolean
}

interface FollowState {
  stopped: boolean
  child: ReturnType<typeof Bun.spawn> | null
  playing: boolean
}

// Unit separator: titles and artists contain every printable delimiter.
const FIELD_SEPARATOR = '\u001f'
const TRACK_FORMAT = [
  '{{status}}',
  '{{xesam:title}}',
  '{{xesam:artist}}',
  '{{xesam:album}}',
  '{{mpris:artUrl}}',
  '{{mpris:length}}',
  '{{shuffle}}',
].join(FIELD_SEPARATOR)
const RESTART_DELAY_MS = 2000
const POSITION_POLL_MS = 1000
const MICROSECONDS_PER_SECOND = 1_000_000

const mediaExtension: Plugin.Object<undefined> = {
  name: 'media',
  inject: ['bus'],
  apply(context) {
    const bus = requireService<BusService>(context, 'bus')
    const retained = new RetainedTopics(bus)
    const state: FollowState = { stopped: false, child: null, playing: false }
    context.effect(() => followPlayer(retained, state))
    context.effect(() => pollPosition(retained, state))
    registerCommands(context, bus)
  },
}

export default mediaExtension

function registerCommands(context: Context, bus: BusService): void {
  registerFunction(context, bus, 'media:playPause', () => runPlayerctl(['play-pause']))
  registerFunction(context, bus, 'media:next', () => runPlayerctl(['next']))
  registerFunction(context, bus, 'media:previous', () => runPlayerctl(['previous']))
  registerFunction(context, bus, 'media:shuffle', () => runPlayerctl(['shuffle', 'toggle']))
  registerFunction(context, bus, 'media:seek', (data) => seek(data))
}

async function seek(data: unknown): Promise<unknown> {
  const seconds = (data as Record<string, unknown>).seconds
  if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) {
    return { error: 'seconds must be a non-negative number' }
  }
  return runPlayerctl(['position', String(Math.round(seconds))])
}

async function runPlayerctl(argv: string[]): Promise<unknown> {
  const result = await run(['playerctl', ...argv])
  if (result.ok) {
    return { ok: true }
  }
  if (result.stderr === '') {
    return { error: `playerctl ${argv[0]} failed` }
  }
  return { error: result.stderr }
}

function followPlayer(retained: RetainedTopics, state: FollowState): () => void {
  void runFollowLoop(retained, state)
  return () => {
    state.stopped = true
    killIfRunning(state)
    retained.withdrawAll()
  }
}

function pollPosition(retained: RetainedTopics, state: FollowState): () => void {
  const timer = setInterval(() => void publishPosition(retained, state), POSITION_POLL_MS)
  return () => clearInterval(timer)
}

async function publishPosition(retained: RetainedTopics, state: FollowState): Promise<void> {
  if (!state.playing) {
    return
  }
  const seconds = Number.parseFloat(await output(['playerctl', 'position']))
  if (Number.isNaN(seconds)) {
    return
  }
  retained.set('media.position', { position: seconds })
}

async function runFollowLoop(retained: RetainedTopics, state: FollowState): Promise<void> {
  while (!state.stopped) {
    await followOnce(retained, state)
    if (!state.stopped) {
      await Bun.sleep(RESTART_DELAY_MS)
    }
  }
}

// playerctl exits once the last player goes away; the loop waits it out and
// retries, publishing an empty track so surfaces stop showing one.
async function followOnce(retained: RetainedTopics, state: FollowState): Promise<void> {
  const child = spawnPlayerctl()
  if (child === null) {
    state.stopped = true
    return
  }
  state.child = child
  await readTrackLines(child, retained, state)
  state.child = null
  state.playing = false
  retained.set('media.player', emptyTrack())
}

function spawnPlayerctl(): ReturnType<typeof Bun.spawn> | null {
  try {
    return Bun.spawn(['playerctl', 'metadata', '--follow', '--format', TRACK_FORMAT], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
  } catch (error) {
    console.error('media: playerctl unavailable, no player state:', error)
    return null
  }
}

async function readTrackLines(
  child: ReturnType<typeof Bun.spawn>,
  retained: RetainedTopics,
  state: FollowState,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
    buffer += decoder.decode(chunk)
    buffer = consumeLines(buffer, (line) => publishTrack(retained, state, trackOf(line)))
  }
  await child.exited
}

function publishTrack(retained: RetainedTopics, state: FollowState, track: TrackState): void {
  state.playing = track.status === 'Playing'
  retained.set('media.player', track)
}

function consumeLines(buffer: string, onLine: (line: string) => void): string {
  const parts = buffer.split('\n')
  for (const line of parts.slice(0, -1)) {
    onLine(line)
  }
  return parts[parts.length - 1]
}

export function trackOf(line: string): TrackState {
  const fields = line.split(FIELD_SEPARATOR)
  return {
    status: fieldAt(fields, 0),
    title: fieldAt(fields, 1),
    artist: fieldAt(fields, 2),
    album: fieldAt(fields, 3),
    artUrl: fieldAt(fields, 4),
    length: secondsOf(fieldAt(fields, 5)),
    shuffle: fieldAt(fields, 6) === 'true',
  }
}

function fieldAt(fields: string[], index: number): string {
  if (index >= fields.length) {
    return ''
  }
  return fields[index].trim()
}

// A player with no track, or one streaming something unbounded, reports an
// empty or unparseable length; 0 reads as "no duration" to surfaces.
function secondsOf(microseconds: string): number {
  const parsed = Number.parseInt(microseconds, 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 0
  }
  return parsed / MICROSECONDS_PER_SECOND
}

function emptyTrack(): TrackState {
  return { status: '', title: '', artist: '', album: '', artUrl: '', length: 0, shuffle: false }
}

function killIfRunning(state: FollowState): void {
  if (state.child === null) {
    return
  }
  state.child.kill()
  state.child = null
}
