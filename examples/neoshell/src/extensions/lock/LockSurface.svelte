<script lang="ts">
  import GLib from 'gi://GLib'
  import { subscribeTo } from '../../lib/bus'
  import type { BusService } from '../../lib/bus'
  import type { ViewRegistry } from '../../host/plugins/views'
  import { numberOf, recordOf, stringOf } from '../../lib/record'
  import { fileExists, joinPath } from '../../gjs/fs'
  import Wallpaper from '../neoshell/Wallpaper.svelte'
  import { checkPassword } from './auth'

  // One monitor's lock surface: the wallpaper, the clock, what is playing,
  // and the user with a password field. The layout is the macOS lock screen's
  // — time at the top, media in the middle, identity at the bottom — and
  // everything on it is a retained bus topic the rest of the shell already
  // publishes.

  interface Media {
    status: string
    title: string
    artist: string
    art: string
  }

  let {
    bus,
    registry,
    onunlock,
  }: { bus: BusService; registry: ViewRegistry; onunlock: () => void } = $props()

  const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  const REAL_NAME = realNameOf()
  const INITIALS = initialsOf(REAL_NAME)

  let now = $state(new Date())
  let batteryPercent = $state(-1)
  let batteryCharging = $state(false)
  let media = $state<Media>({ status: '', title: '', artist: '', art: '' })
  let avatar = $state('')
  let password = $state('')
  let hint = $state('Enter Password')
  let failed = $state(false)
  let checking = $state(false)

  $effect(() => {
    const timer = setInterval(() => {
      now = new Date()
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  })

  $effect(() =>
    subscribeTo(bus, 'system.battery', (message) => {
      const data = recordOf(message.data)
      batteryPercent = Math.round(numberOf(data.percent, -1))
      batteryCharging = data.charging === true
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'media.player', (message) => {
      const data = recordOf(message.data)
      media = {
        status: stringOf(data.status),
        title: stringOf(data.title),
        artist: stringOf(data.artist),
        art: artPathOf(stringOf(data.artUrl)),
      }
    }),
  )

  $effect(() =>
    subscribeTo(bus, 'config', (message) => {
      avatar = avatarOf(message.data)
    }),
  )

  const hintClass = $derived(failed ? 'lock-hint lock-hint-error' : 'lock-hint')
  const showMedia = $derived(media.title !== '' && media.status !== '' && media.status !== 'Stopped')
  const playIcon = $derived(
    media.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
  )

  async function submit(): Promise<void> {
    if (checking || password === '') {
      return
    }
    checking = true
    const result = await checkPassword(password)
    checking = false
    password = ''
    if (result.ok) {
      onunlock()
      return
    }
    failed = true
    hint = 'Wrong password'
  }

  function readPassword(event: { target: { widget: { get_text(): string } } }): void {
    password = event.target.widget.get_text()
    if (failed && password !== '') {
      failed = false
      hint = 'Enter Password'
    }
  }

  // A lock surface is handed keyboard focus by the compositor; the entry has
  // to be the widget inside it that takes it.
  function focus(event: { target: { widget: { grab_focus(): boolean } } }): void {
    event.target.widget.grab_focus()
  }

  function control(command: string): void {
    void bus.call(command, {})
  }

  function realNameOf(): string {
    const name = GLib.get_real_name()
    if (name === '' || name === 'Unknown') {
      return GLib.get_user_name()
    }
    return name
  }

  function initialsOf(name: string): string {
    return name
      .split(/\s+/)
      .filter((part) => part !== '')
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('')
  }

  // lock.avatar in config, else the ~/.face every display manager reads.
  function avatarOf(snapshot: unknown): string {
    const configured = stringOf(recordOf(recordOf(snapshot).lock).avatar)
    if (configured !== '' && fileExists(configured)) {
      return configured
    }
    const face = joinPath(GLib.get_home_dir(), '.face')
    if (fileExists(face)) {
      return face
    }
    return ''
  }

  function artPathOf(artUrl: string): string {
    if (artUrl.startsWith('file://')) {
      return decodeURIComponent(artUrl.slice('file://'.length))
    }
    return ''
  }

  function coverCss(path: string): string {
    if (path === '') {
      return ''
    }
    return `background-image: url("${path}"); background-size: cover; background-position: center;`
  }
</script>

<gtkoverlay hexpand vexpand>
  <Wallpaper {bus} {registry} args={{}} id="lock.wallpaper" />
  <gtkbox overlay class="lock-scrim" hexpand vexpand></gtkbox>
  <gtkbox overlay class="lock-layout" orientation="vertical" hexpand vexpand>
    <gtkbox class="lock-clock" orientation="vertical" halign="center" spacing={2}>
      <gtklabel class="lock-date">{DATE_FORMAT.format(now)}</gtklabel>
      <gtklabel class="lock-time" tabular>{TIME_FORMAT.format(now)}</gtklabel>
      {#if batteryPercent >= 0}
        <gtkbox orientation="horizontal" halign="center" spacing={6}>
          <gtkimage icon={batteryCharging ? 'battery-good-charging-symbolic' : 'battery-good-symbolic'}></gtkimage>
          <gtklabel class="lock-battery">{batteryPercent}%</gtklabel>
        </gtkbox>
      {/if}
    </gtkbox>

    <gtkbox vexpand></gtkbox>

    {#if showMedia}
      <gtkbox class="lock-media" orientation="vertical" halign="center" spacing={12}>
        <gtkbox orientation="horizontal" spacing={12}>
          <gtkbox class="lock-media-art" css={coverCss(media.art)} width={48} height={48} valign="center"></gtkbox>
          <gtkbox orientation="vertical" spacing={2} valign="center" hexpand>
            <gtklabel class="lock-media-title" halign="start" ellipsize="end" max-width-chars={32}>
              {media.title}
            </gtklabel>
            <gtklabel class="lock-media-artist" halign="start" ellipsize="end" max-width-chars={32}>
              {media.artist}
            </gtklabel>
          </gtkbox>
        </gtkbox>
        <gtkbox orientation="horizontal" halign="center" spacing={28}>
          <gtkbutton class="lock-media-button" frame={false} onclicked={() => control('media:previous')}>
            <gtkimage icon="media-skip-backward-symbolic"></gtkimage>
          </gtkbutton>
          <gtkbutton class="lock-media-button" frame={false} onclicked={() => control('media:playPause')}>
            <gtkimage icon={playIcon}></gtkimage>
          </gtkbutton>
          <gtkbutton class="lock-media-button" frame={false} onclicked={() => control('media:next')}>
            <gtkimage icon="media-skip-forward-symbolic"></gtkimage>
          </gtkbutton>
        </gtkbox>
      </gtkbox>
    {/if}

    <gtkbox vexpand></gtkbox>

    <gtkbox class="lock-user" orientation="vertical" halign="center" spacing={8}>
      {#if avatar !== ''}
        <gtkbox class="lock-avatar" css={coverCss(avatar)} width={56} height={56} halign="center"></gtkbox>
      {:else}
        <gtkbox class="lock-avatar lock-avatar-initials" width={56} height={56} halign="center">
          <gtklabel hexpand vexpand>{INITIALS}</gtklabel>
        </gtkbox>
      {/if}
      <gtklabel class="lock-name">{REAL_NAME}</gtklabel>
      <gtkpasswordentry
        class="lock-password"
        placeholder="Enter Password"
        text={password}
        width-chars={16}
        halign="center"
        onchanged={readPassword}
        onactivate={() => void submit()}
        onmap={focus}
      ></gtkpasswordentry>
      <gtklabel class={hintClass}>{hint}</gtklabel>
    </gtkbox>
  </gtkbox>
</gtkoverlay>
