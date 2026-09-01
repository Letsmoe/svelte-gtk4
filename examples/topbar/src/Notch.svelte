<script lang="ts">
  import type { BusClient } from "./bus";
  import { recordOf } from "./hypr";

  // The notch: a black cutout welded to the top edge, centred over the bar. It
  // renders one island entry at a time — the highest-priority member of a
  // stack fed by island:show / island:dismiss plus the built-in producers
  // below (focused window, volume, media).
  //
  //   island:show    {id, priority?, label, detail?, progress?, tone?, ttlMs?}
  //   island:dismiss {id}
  //
  // Hovering only nudges the island a few pixels wider, to say it is
  // clickable; a click is what opens it.

  interface IslandEntry {
    id: string;
    priority: number;
    label: string;
    detail: string;
    progress: number;
    tone: string;
    art: string;
  }

  interface MediaState {
    status: string;
    length: number;
    shuffle: boolean;
  }

  interface Size {
    width: number;
    height: number;
  }

  const PRIORITY_IDLE = 0;
  const PRIORITY_ACTIVITY = 10;
  const PRIORITY_TRANSIENT = 20;
  const PRIORITY_ALERT = 30;

  const TRANSIENT_TTL_MS = 1600;
  const NO_PROGRESS = -1;
  const MEDIA_ID = "media";

  const BAR_HEIGHT = 30;

  const SIZES: Record<string, Size> = {
    empty: { width: 128, height: BAR_HEIGHT },
    rest: { width: 272, height: BAR_HEIGHT },
    active: { width: 320, height: BAR_HEIGHT },
    expanded: { width: 380, height: 116 },
    expandedMedia: { width: 380, height: 164 },
  };

  const HOVER_GROWTH: Size = { width: 12, height: 3 };

  const TONE_CLASS: Record<string, string> = {
    neutral: "tone-neutral",
    accent: "tone-accent",
    success: "tone-success",
    warning: "tone-warning",
    error: "tone-error",
  };

  // Phosphor has no GTK equivalent; these are the closest symbolic icons the
  // theme ships.
  const ICONS = {
    shuffle: "media-playlist-shuffle-symbolic",
    previous: "media-skip-backward-symbolic",
    next: "media-skip-forward-symbolic",
    play: "media-playback-start-symbolic",
    pause: "media-playback-pause-symbolic",
  };

  // GTK has no percentage widths, so fills are sized against the island's
  // known content width rather than their parent.
  const PROGRESS_TRACK_WIDTH = 380 - 32;
  const SCRUB_TRACK_WIDTH = 380 - 32 - 2 * 38 - 20;

  // Without a host there are no producers, so the island would sit empty. This
  // mirrors the demo workspaces the bar falls back to.
  const DEMO_ENTRIES: IslandEntry[] = [
    entryOf({
      id: MEDIA_ID,
      priority: PRIORITY_ACTIVITY,
      label: "Windowlicker",
      detail: "Aphex Twin",
    }),
  ];

  const DEMO_MEDIA: MediaState = {
    status: "Playing",
    length: 366,
    shuffle: false,
  };

  let { bus }: { bus: BusClient } = $props();

  let entries = $state<IslandEntry[]>(bus.connected ? [] : DEMO_ENTRIES);
  let hovered = $state(false);
  let opened = $state(false);
  let media = $state<MediaState>(
    bus.connected ? { status: "", length: 0, shuffle: false } : DEMO_MEDIA,
  );
  let position = $state(0);

  const dismissTimers = new Map<string, number>();
  let lastVolumeLevel = "";
  let lastTrackTitle = "";
  let openedId = "";

  const current = $derived(topEntry(entries));
  const isMedia = $derived(current !== null && current.id === MEDIA_ID);
  const mode = $derived(modeOf(current, opened, isMedia));
  const size = $derived(grownSize(SIZES[mode], mode, hovered));

  $effect(() =>
    bus.subscribe("island:show", (message) => {
      const shown = entryFromMessage(message.data);
      if (shown === null) {
        return;
      }
      show(shown.entry, shown.ttlMs);
    })
  );

  $effect(() =>
    bus.subscribe("island:dismiss", (message) => {
      dismiss(stringOf(recordOf(message.data).id));
    })
  );

  // The focused window is the island's resting content: persistent, and the
  // lowest priority, so anything else displaces it while it lasts.
  $effect(() =>
    bus.subscribe("hypr.activewindow", (message) => {
      const record = recordOf(message.data);
      const title = stringOf(record.title);
      if (title === "") {
        dismiss("window");
        return;
      }
      show(
        entryOf({
          id: "window",
          priority: PRIORITY_IDLE,
          label: title,
          detail: appNameOf(record),
        }),
        0,
      );
    })
  );

  // The sink watcher republishes on every pipewire event, and starting a new
  // track is one — so only a level that actually moved surfaces the island.
  $effect(() =>
    bus.subscribe("system.volume", (message) => {
      const record = recordOf(message.data);
      const percent = record.volume;
      if (typeof percent !== "number") {
        return;
      }
      const level = `${percent}:${record.muted === true}`;
      if (level === lastVolumeLevel) {
        return;
      }
      const isFirst = lastVolumeLevel === "";
      lastVolumeLevel = level;
      if (isFirst) {
        return;
      }
      show(volumeEntry(percent, record.muted === true), TRANSIENT_TTL_MS);
    })
  );

  // A loaded track is the island's standing content: above the focused window
  // it displaces, below anything transient that interrupts it.
  $effect(() =>
    bus.subscribe("media.player", (message) => {
      const record = recordOf(message.data);
      const title = stringOf(record.title);
      const status = stringOf(record.status);
      if (title === "" || status === "" || status === "Stopped") {
        dismiss(MEDIA_ID);
        return;
      }
      // The playhead is polled, so a new track would otherwise show the
      // previous one's elapsed time until the next tick lands.
      if (title !== lastTrackTitle) {
        position = 0;
        lastTrackTitle = title;
      }
      media = {
        status,
        length: numberOf(record.length, 0),
        shuffle: record.shuffle === true,
      };
      show(
        entryOf({
          id: MEDIA_ID,
          priority: PRIORITY_ACTIVITY,
          label: title,
          detail: stringOf(record.artist),
          art: artSourceOf(stringOf(record.artUrl)),
        }),
        0,
      );
    })
  );

  $effect(() =>
    bus.subscribe("media.position", (message) => {
      position = numberOf(recordOf(message.data).position, 0);
    })
  );

  $effect(() => () => {
    for (const timer of dismissTimers.values()) {
      clearTimeout(timer);
    }
    dismissTimers.clear();
  });

  // Opening is a decision about one entry. A transient alert displacing it, or
  // the entry expiring, ends that decision.
  $effect(() => {
    const id = idOf(current);
    if (id === openedId) {
      return;
    }
    openedId = id;
    opened = false;
  });

  function dismiss(id: string): void {
    const timer = dismissTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      dismissTimers.delete(id);
    }
    entries = entries.filter((entry) => entry.id !== id);
  }

  function show(entry: IslandEntry, ttlMs: number): void {
    dismiss(entry.id);
    entries = [...entries.filter((e) => e.id !== entry.id), entry];
    if (ttlMs <= 0) {
      return;
    }
    dismissTimers.set(entry.id, setTimeout(() => dismiss(entry.id), ttlMs));
  }

  function seekTo(press: { x: number; width: number }): void {
    if (media.length <= 0 || press.width <= 0) {
      return;
    }
    const fraction = Math.min(Math.max(press.x / press.width, 0), 1);
    bus.call("media:seek", { seconds: fraction * media.length });
  }

  // The stack's winner is the highest priority, ties going to whatever arrived
  // last — a second notification supersedes the one before it.
  function topEntry(stack: IslandEntry[]): IslandEntry | null {
    let best: IslandEntry | null = null;
    for (const entry of stack) {
      if (best === null || entry.priority >= best.priority) {
        best = entry;
      }
    }
    return best;
  }

  function modeOf(
    entry: IslandEntry | null,
    isOpened: boolean,
    mediaShowing: boolean,
  ): string {
    if (entry === null) {
      return "empty";
    }
    if (isOpened && mediaShowing) {
      return "expandedMedia";
    }
    if (isOpened) {
      return "expanded";
    }
    if (entry.priority > PRIORITY_IDLE) {
      return "active";
    }
    return "rest";
  }

  // The open island is already at its full size; growing it further on hover
  // would read as a second, accidental expansion.
  function grownSize(base: Size, current: string, isHovered: boolean): Size {
    if (!isHovered || current.startsWith("expanded")) {
      return base;
    }
    return {
      width: base.width + HOVER_GROWTH.width,
      height: base.height + HOVER_GROWTH.height,
    };
  }

  function entryOf(fields: Partial<IslandEntry> & { id: string }): IslandEntry {
    return {
      priority: PRIORITY_ACTIVITY,
      label: "",
      detail: "",
      progress: NO_PROGRESS,
      tone: "neutral",
      art: "",
      ...fields,
    };
  }

  function entryFromMessage(
    data: unknown,
  ): { entry: IslandEntry; ttlMs: number } | null {
    const record = recordOf(data);
    const id = stringOf(record.id);
    if (id === "") {
      console.error("notch: island:show without an id, ignored");
      return null;
    }
    return {
      entry: entryOf({
        id,
        priority: numberOf(record.priority, PRIORITY_ALERT),
        label: stringOf(record.label),
        detail: stringOf(record.detail),
        progress: numberOf(record.progress, NO_PROGRESS),
        tone: toneOf(record.tone),
      }),
      ttlMs: numberOf(record.ttlMs, 0),
    };
  }

  function volumeEntry(percent: number, muted: boolean): IslandEntry {
    if (muted) {
      return entryOf({
        id: "volume",
        priority: PRIORITY_TRANSIENT,
        label: "Muted",
        tone: "accent",
      });
    }
    return entryOf({
      id: "volume",
      priority: PRIORITY_TRANSIENT,
      label: "Volume",
      detail: `${percent}%`,
      progress: percent / 100,
      tone: "accent",
    });
  }

  // GTK loads CSS urls from disk directly, so local art needs no host route.
  // Remote art would have to be downloaded first and is skipped.
  function artSourceOf(artUrl: string): string {
    if (artUrl.startsWith("file://")) {
      return decodeURIComponent(artUrl.slice("file://".length));
    }
    return "";
  }

  function islandCss(entry: IslandEntry | null, showingMedia: boolean): string {
    if (entry === null || entry.art === "" || showingMedia) {
      return "";
    }
    // Cover art fills the cutout behind the text; the scrim keeps the label
    // legible over a bright or busy sleeve.
    return [
      `background-image: linear-gradient(to right, var(--base-100),`,
      `color-mix(in srgb, var(--base-100) 60%, transparent),`,
      `color-mix(in srgb, var(--base-100) 20%, transparent)),`,
      `url("${entry.art}");`,
      "background-size: cover; background-position: center;",
    ].join(" ");
  }

  function artCss(art: string): string {
    if (art === "") {
      return "";
    }
    return `background-image: url("${art}"); background-size: cover; background-position: center;`;
  }

  function playPauseIcon(state: MediaState): string {
    if (state.status === "Playing") {
      return ICONS.pause;
    }
    return ICONS.play;
  }

  function headerClass(current: string): string {
    if (current === "expandedMedia") {
      return "island-header-large";
    }
    return "island-header-small";
  }

  function appNameOf(record: Record<string, unknown>): string {
    const initialClass = stringOf(record.initialClass);
    if (initialClass !== "") {
      return initialClass;
    }
    return stringOf(record.class);
  }

  function idOf(entry: IslandEntry | null): string {
    if (entry === null) {
      return "";
    }
    return entry.id;
  }

  function stringOf(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    return "";
  }

  function numberOf(value: unknown, fallback: number): number {
    if (typeof value === "number") {
      return value;
    }
    return fallback;
  }

  function toneOf(value: unknown): string {
    if (typeof value === "string" && TONE_CLASS[value] !== undefined) {
      return value;
    }
    return "neutral";
  }

  function toneClass(entry: IslandEntry | null): string {
    if (entry === null) {
      return TONE_CLASS.neutral;
    }
    return TONE_CLASS[entry.tone];
  }

  function progressWidth(entry: IslandEntry): number {
    const clamped = Math.min(Math.max(entry.progress, 0), 1);
    return Math.round(clamped * PROGRESS_TRACK_WIDTH);
  }

  function playedWidth(state: MediaState, seconds: number): number {
    if (state.length <= 0) {
      return 0;
    }
    const fraction = Math.min(Math.max(seconds / state.length, 0), 1);
    return Math.round(fraction * SCRUB_TRACK_WIDTH);
  }

  function remainingLabel(state: MediaState, seconds: number): string {
    if (state.length <= 0) {
      return "";
    }
    return `-${clockLabel(state.length - seconds)}`;
  }

  function clockLabel(seconds: number): string {
    const whole = Math.max(Math.floor(seconds), 0);
    const minutes = Math.floor(whole / 60);
    return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
  }
</script>

<!-- The fillets are 10x10 patches pinned to the top edge; letting them fill
     the island's height would spill the gradient's solid half down the
     sides. -->
<gtkbox overlay orientation="horizontal" valign="start" halign="center">
  <gtkbox class="notch-fillet-left" valign="start" />

  <gtkoverlay
    class="island"
    input
    css="min-width: {size.width}px; min-height: {size.height}px;"
  >
    <gtkpressable
      orientation="vertical"
      onhoverstart={() => (hovered = true)}
      onhoverend={() => (hovered = false)}
      css={islandCss(current, isMedia)}
    >
      {#if current !== null}
        <gtkbutton
          class="island-header {headerClass(mode)}"
          frame={false}
          tooltip={current.label}
          onclicked={() => (opened = !opened)}
        >
          {#if isMedia}
            {@render mediaHeader(current, mode === "expandedMedia")}
          {:else}
            {@render plainHeader(current)}
          {/if}
        </gtkbutton>
      {/if}

      <!-- Mounted only while open. A crossfading Revealer would keep measuring
           its child while hidden and the island could never collapse back to
           bar height. -->
      {#if mode === "expandedMedia"}
        {@render scrubber()}
      {/if}
      {#if mode === "expanded" && current !== null}
        {@render expandedDetail(current)}
      {/if}
    </gtkpressable>

    {#if current !== null && current.progress >= 0 && !mode.startsWith("expanded")}
      <gtkbox overlay class="progress-track" valign="end">
        <gtkbox
          class="progress-fill {toneClass(current)}"
          css="min-width: {progressWidth(current)}px;"
        />
      </gtkbox>
    {/if}
  </gtkoverlay>

  <gtkbox class="notch-fillet-right" valign="start" />
</gtkbox>

{#snippet plainHeader(entry: IslandEntry)}
  <gtkbox orientation="horizontal" spacing={10} hexpand>
    <gtkbox class="tone-dot {toneClass(entry)}" valign="center" />
    <gtklabel class="island-label" hexpand halign="start">{entry.label}</gtklabel>
    {#if entry.detail !== "" && !mode.startsWith("expanded")}
      <gtklabel class="island-detail" tabular>{entry.detail}</gtklabel>
    {/if}
  </gtkbox>
{/snippet}

<!-- Collapsed and open share this row: sleeve on the left, title in the
     middle, level meter on the right. Only the scale changes. -->
{#snippet mediaHeader(entry: IslandEntry, large: boolean)}
  <gtkbox orientation="horizontal" spacing={12} hexpand>
    <gtkbox
      class={large ? "island-art-large" : "island-art-small"}
      css={artCss(entry.art)}
      valign="center"
    />
    <gtkbox orientation="vertical" spacing={4} hexpand valign="center">
      <gtklabel
        class={large ? "island-title-large" : "island-title"}
        halign="start"
      >
        {entry.label}
      </gtklabel>
      {#if large && entry.detail !== ""}
        <gtklabel class="island-subtitle" halign="start">
          {entry.detail}
        </gtklabel>
      {/if}
    </gtkbox>
    {@render levelMeter(large, media.status === "Playing")}
  </gtkbox>
{/snippet}

<!-- Four bars bouncing in sequence: the "audio is coming out of here" mark on
     the header's right edge. A paused player freezes them mid-stride. -->
{#snippet levelMeter(large: boolean, playing: boolean)}
  <gtkbox
    class="level-meter {large ? 'level-meter-large' : 'level-meter-small'} {playing
      ? ''
      : 'paused'}"
    orientation="horizontal"
    spacing={2}
    valign="center"
  >
    {#each [0, 1, 2, 3] as bar (bar)}
      <gtkbox class="level-bar level-bar-{bar}" />
    {/each}
  </gtkbox>
{/snippet}

{#snippet expandedDetail(entry: IslandEntry)}
  <gtkbox
    orientation="vertical"
    spacing={4}
    class="island-expanded"
    vexpand
    valign="end"
  >
    {#if entry.detail !== ""}
      <gtklabel class="island-expanded-detail" halign="start">
        {entry.detail}
      </gtklabel>
    {/if}
    <gtklabel class="island-expanded-id" halign="start">
      {entry.id.toUpperCase()}
    </gtklabel>
  </gtkbox>
{/snippet}

{#snippet scrubber()}
  <gtkbox orientation="vertical" spacing={12} class="island-expanded">
    <gtkbox orientation="horizontal" spacing={10}>
      <gtklabel class="scrub-time" tabular>{clockLabel(position)}</gtklabel>
      <gtkpressable
        class="scrub-track"
        hexpand
        valign="center"
        onpress={(event) => seekTo(event.detail)}
      >
        <gtkbox
          class="scrub-played"
          css="min-width: {playedWidth(media, position)}px;"
        />
      </gtkpressable>
      <gtklabel class="scrub-time" tabular>
        {remainingLabel(media, position)}
      </gtklabel>
    </gtkbox>
    {@render transport()}
  </gtkbox>
{/snippet}

<!-- Three columns so the transport group sits on the island's centre line with
     shuffle pinned left; the mirrored right column stays empty. -->
{#snippet transport()}
  <gtkbox orientation="horizontal" hexpand>
    <gtkbox orientation="horizontal" hexpand halign="start">
      {@render control(ICONS.shuffle, 20, media.shuffle, "media:shuffle")}
    </gtkbox>
    <gtkbox orientation="horizontal" spacing={24}>
      {@render control(ICONS.previous, 22, false, "media:previous")}
      {@render control(playPauseIcon(media), 26, false, "media:playPause")}
      {@render control(ICONS.next, 22, false, "media:next")}
    </gtkbox>
    <gtkbox hexpand />
  </gtkbox>
{/snippet}

{#snippet control(icon: string, pixels: number, active: boolean, action: string)}
  <gtkbutton
    class="control {active ? 'control-active' : 'control-idle'}"
    frame={false}
    onclicked={() => bus.call(action, {})}
  >
    <gtkicon {icon} size={pixels} />
  </gtkbutton>
{/snippet}
