import Gdk from 'gi://Gdk?version=4.0'
import Gtk from 'gi://Gtk?version=4.0'
import Gst from 'gi://Gst?version=1.0'

// A looping, muted video that renders into a Gdk.Paintable, so a gtkpicture
// can show it the way it shows a file. Two backends:
//
//   gstreamer   playbin driving gtk4paintablesink. Full control — the rate is
//               a seek parameter, audio is never decoded, and the loop is a
//               segment seek, which is gapless.
//   mediafile   Gtk.MediaFile, when gtk4paintablesink (gst-plugin-gtk4) is
//               not installed. Plays, pauses and loops; GtkMediaStream has no
//               rate API, so the speed setting is ignored.

export interface LivePlayer {
  readonly paintable: Gdk.Paintable
  setPlaying(playing: boolean): void
  setRate(rate: number): void
  dispose(): void
}

const MIN_RATE = 0.1
const MAX_RATE = 8

// Playbin flags: VIDEO | DEINTERLACE. Leaving AUDIO out means the audio track
// is never decoded, which is cheaper than decoding it into a muted sink.
const PLAY_FLAGS = 1 | 512

const SINK_ELEMENT = 'gtk4paintablesink'

let warnedAboutSink = false

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) {
    return 1
  }
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate))
}

export function createLivePlayer(path: string): LivePlayer {
  const gst = createGstPlayer(path)
  if (gst !== null) {
    return gst
  }
  return createMediaFilePlayer(path)
}

function createGstPlayer(path: string): LivePlayer | null {
  if (!Gst.is_initialized()) {
    Gst.init(null)
  }
  const sink = Gst.ElementFactory.make(SINK_ELEMENT, null)
  if (sink === null) {
    if (!warnedAboutSink) {
      warnedAboutSink = true
      console.warn(
        `wallpaper: ${SINK_ELEMENT} is not installed (gst-plugin-gtk4); falling back to Gtk.MediaFile, playback speed is unavailable`,
      )
    }
    return null
  }
  const playbin = Gst.ElementFactory.make('playbin', null)
  if (playbin === null) {
    return null
  }
  return new GstPlayer(playbin, sink, path)
}

class GstPlayer implements LivePlayer {
  readonly paintable: Gdk.Paintable
  private readonly playbin: Gst.Element
  private readonly bus: Gst.Bus | null
  private readonly watchId: number
  private rate = 1
  private playing = false
  private prerolled = false
  private disposed = false

  constructor(playbin: Gst.Element, sink: Gst.Element, path: string) {
    this.playbin = playbin
    this.paintable = sink.get_property<Gdk.Paintable>('paintable')
    playbin.set_property('video-sink', sink)
    playbin.set_property('flags', PLAY_FLAGS)
    playbin.set_property('uri', Gst.filename_to_uri(path))
    this.bus = playbin.get_bus()
    this.watchId = this.watchBus()
    // Preroll paused: the first seek, which sets the rate and starts the
    // segment loop, needs a prerolled pipeline. ASYNC_DONE is when that is.
    playbin.set_state(Gst.State.PAUSED)
  }

  setPlaying(playing: boolean): void {
    this.playing = playing
    if (this.disposed || !this.prerolled) {
      return
    }
    this.applyState()
  }

  setRate(rate: number): void {
    const next = clampRate(rate)
    if (next === this.rate) {
      return
    }
    this.rate = next
    if (this.disposed || !this.prerolled) {
      return
    }
    this.seek(this.currentPosition(), Gst.SeekFlags.FLUSH | Gst.SeekFlags.SEGMENT)
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    if (this.bus !== null) {
      this.bus.disconnect(this.watchId)
      this.bus.remove_signal_watch()
    }
    this.playbin.set_state(Gst.State.NULL)
  }

  private watchBus(): number {
    if (this.bus === null) {
      return 0
    }
    this.bus.add_signal_watch()
    return this.bus.connect('message', (_bus, message) => this.handleMessage(message))
  }

  private handleMessage(message: Gst.Message): void {
    if (this.disposed) {
      return
    }
    switch (message.type) {
      case Gst.MessageType.ASYNC_DONE:
        this.handlePrerolled()
        return
      case Gst.MessageType.SEGMENT_DONE:
        // The segment ended without flushing the pipeline, so the next one
        // starts on the frame after the last one — a seamless loop.
        this.seek(0, Gst.SeekFlags.SEGMENT)
        return
      case Gst.MessageType.EOS:
        // Only reached when the segment seek did not take; loop the hard way.
        this.seek(0, Gst.SeekFlags.FLUSH | Gst.SeekFlags.SEGMENT)
        return
      case Gst.MessageType.ERROR:
        this.reportError(message)
        return
      default:
        return
    }
  }

  private handlePrerolled(): void {
    if (this.prerolled) {
      return
    }
    this.prerolled = true
    this.seek(0, Gst.SeekFlags.FLUSH | Gst.SeekFlags.SEGMENT)
    this.applyState()
  }

  private applyState(): void {
    if (this.playing) {
      this.playbin.set_state(Gst.State.PLAYING)
      return
    }
    this.playbin.set_state(Gst.State.PAUSED)
  }

  private seek(position: number, flags: number): void {
    this.playbin.seek(
      this.rate,
      Gst.Format.TIME,
      flags,
      Gst.SeekType.SET,
      position,
      Gst.SeekType.NONE,
      0,
    )
  }

  private currentPosition(): number {
    const [ok, position] = this.playbin.query_position(Gst.Format.TIME)
    if (!ok || position < 0) {
      return 0
    }
    return position
  }

  private reportError(message: Gst.Message): void {
    const [error, debug] = message.parse_error()
    console.error(`wallpaper: playback failed: ${error.message} (${debug})`)
    this.playbin.set_state(Gst.State.NULL)
  }
}

function createMediaFilePlayer(path: string): LivePlayer {
  return new MediaFilePlayer(Gtk.MediaFile.new_for_filename(path))
}

class MediaFilePlayer implements LivePlayer {
  readonly paintable: Gdk.Paintable
  private readonly stream: Gtk.MediaFile

  constructor(stream: Gtk.MediaFile) {
    this.stream = stream
    this.paintable = stream
    stream.set_loop(true)
    stream.set_muted(true)
  }

  setPlaying(playing: boolean): void {
    if (playing) {
      this.stream.play()
      return
    }
    this.stream.pause()
  }

  setRate(): void {
    // GtkMediaStream exposes no playback rate.
  }

  dispose(): void {
    this.stream.pause()
    this.stream.clear()
  }
}
