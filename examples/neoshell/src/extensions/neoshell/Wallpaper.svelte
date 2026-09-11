<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { recordOf } from '../../lib/record'
  import { createLivePlayer } from './livePlayer'
  import type { LivePlayer } from './livePlayer'
  import {
    DEFAULT_LIVE_OPTIONS,
    fullscreenShowing,
    isVideoPath,
    liveOptionsOf,
    onBatteryPower,
    shouldPlay,
  } from './liveWallpaper'

  // The desktop background: the configured wallpaper, a flat dark fill when
  // none is set.
  //
  // The webview build fetched this through a host route, because a page served
  // over http cannot read file://. GTK loads the file directly, so the
  // /wallpaper route and the neoshell-bg daemon it stood in front of are both
  // gone — the path from config is the path GdkPixbuf opens.
  //
  // A video path is a live wallpaper: a looping, muted player rendered into a
  // paintable the same picture shows. It holds still while a fullscreen window
  // is on screen and, if configured, while the machine is on battery — there
  // is nothing to look at in the first case and every frame costs in the
  // second. Both rules and the playback speed live under
  // appearance.liveWallpaper.

  let { bus }: ViewProps = $props()

  let wallpaperPath = $state('')
  let options = $state(DEFAULT_LIVE_OPTIONS)
  let workspaces = $state.raw<unknown>(null)
  let monitors = $state.raw<unknown>(null)
  let battery = $state.raw<unknown>(null)
  let player = $state.raw<LivePlayer | null>(null)

  $effect(() =>
    subscribeTo(bus, 'config', (message) => {
      wallpaperPath = pathOf(message.data)
      options = liveOptionsOf(message.data)
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'hypr.workspaces', (message) => {
      workspaces = message.data
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'hypr.monitors', (message) => {
      monitors = message.data
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'system.battery', (message) => {
      battery = message.data
    }),
  )

  const isLive = $derived(isVideoPath(wallpaperPath))
  const playing = $derived(
    shouldPlay(options, fullscreenShowing(workspaces, monitors), onBatteryPower(battery)),
  )

  // One player per path. It is created when the path turns into a video and
  // torn down when it changes or the view goes, so a wallpaper switch never
  // leaves a pipeline decoding into nothing.
  $effect(() => {
    if (!isLive) {
      player = null
      return
    }
    const next = createLivePlayer(wallpaperPath)
    player = next
    return () => {
      next.dispose()
    }
  })

  $effect(() => {
    if (player !== null) {
      player.setPlaying(playing)
    }
  })

  $effect(() => {
    if (player !== null) {
      player.setRate(options.speed)
    }
  })

  function pathOf(snapshot: unknown): string {
    const appearance = recordOf(recordOf(snapshot).appearance)
    if (typeof appearance.wallpaper === 'string') {
      return appearance.wallpaper
    }
    return ''
  }
</script>

<gtkbox class="wallpaper" hexpand vexpand>
  {#if player !== null}
    <gtkpicture paintable={player.paintable} fit="cover" hexpand vexpand></gtkpicture>
  {:else if wallpaperPath !== '' && !isLive}
    <gtkpicture file={wallpaperPath} fit="cover" hexpand vexpand></gtkpicture>
  {/if}
</gtkbox>
