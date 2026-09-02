<script lang="ts">
  import { fade } from "svelte/transition";
  import ShuffleIcon from "phosphor-svelte/lib/ShuffleIcon";
  import RewindIcon from "phosphor-svelte/lib/RewindIcon";
  import FastForwardIcon from "phosphor-svelte/lib/FastForwardIcon";
  import PlayIcon from "phosphor-svelte/lib/PlayIcon";
  import PauseIcon from "phosphor-svelte/lib/PauseIcon";
  import { recordOf } from "./lib";
  import type { BusLike } from "./lib";

  // The notch: a black cutout welded to the top edge, centred over the bar. It
  // renders one island entry at a time — the highest-priority member of a
  // stack fed by island:show / island:dismiss plus the built-in producers
  // below (focused window, volume, media).
  //
  //   island:show    {id, priority?, label, detail?, progress?, tone?, ttlMs?}
  //   island:dismiss {id}
  //
  // Hovering only nudges the island a few pixels wider, to say it is clickable;
  // a click is what opens it. Pointer-driven expansion made the whole top edge
  // lurch whenever the cursor crossed the screen's centre.
  //
  // The surface node carries no size, so the wrapper hugs this component and
  // the reported input region shrinks back with it.

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

  // Events move the island sideways only — a bar that changes height as
  // notifications arrive makes the whole top edge twitch. Height changes just
  // once, when the island is deliberately opened.
  const BAR_HEIGHT = 30;

  const SIZES: Record<string, Size> = {
    empty: { width: 128, height: BAR_HEIGHT },
    rest: { width: 272, height: BAR_HEIGHT },
    active: { width: 320, height: BAR_HEIGHT },
    expanded: { width: 380, height: 116 },
    expandedMedia: { width: 380, height: 164 },
  };

  // Enough to read as a response to the cursor, not enough to shove the bar's
  // contents around.
  const HOVER_GROWTH: Size = { width: 12, height: 3 };

  const SEEK_STEPS: Record<string, number> = {
    ArrowLeft: -5,
    ArrowRight: 5,
    ArrowDown: -5,
    ArrowUp: 5,
  };

  const TONE_CLASS: Record<string, string> = {
    neutral: "text-base-content",
    accent: "text-accent",
    success: "text-success",
    warning: "text-warning",
    error: "text-error",
  };

  let { bus }: { bus: BusLike } = $props();

  let entries: IslandEntry[] = $state([]);
  let hovered = $state(false);
  let opened = $state(false);
  let media: MediaState = $state({ status: "", length: 0, shuffle: false });
  let position = $state(0);

  const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let lastVolumeLevel = "";
  let lastTrackTitle = "";
  let openedId = "";

  const current = $derived(topEntry(entries));
  const isMedia = $derived(current !== null && current.id === MEDIA_ID);
  const mode = $derived(modeOf(current, opened, isMedia));
  const size = $derived(grownSize(SIZES[mode], mode, hovered));

  $effect(() => {
    const unsubscribers = [
      bus.subscribe("island:show", (message) => {
        showFromMessage(message.data);
      }),
      bus.subscribe("island:dismiss", (message) => {
        dismiss(stringOf(recordOf(message.data).id));
      }),
      bus.subscribe("hypr.activewindow", (message) => {
        showFocusedWindow(message.data);
      }),
      bus.subscribe("system.volume", (message) => {
        showVolume(message.data);
      }),
      bus.subscribe("media.player", (message) => {
        showTrack(message.data);
      }),
      bus.subscribe("media.position", (message) => {
        position = numberOf(recordOf(message.data).position, 0);
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      clearAllTimers();
    };
  });

  // Opening is a decision about one entry. A transient alert displacing it, or
  // the entry expiring, ends that decision — otherwise the next thing to
  // arrive inherits an expansion nobody asked for.
  $effect(() => {
    const id = idOf(current);
    if (id !== openedId) {
      opened = false;
      openedId = id;
    }
  });

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

  function toggleOpen(): void {
    if (current === null) {
      return;
    }
    opened = !opened;
  }

  function show(entry: IslandEntry, ttlMs: number): void {
    dismiss(entry.id);
    entries = [...entries, entry];
    if (ttlMs <= 0) {
      return;
    }
    dismissTimers.set(
      entry.id,
      setTimeout(() => dismiss(entry.id), ttlMs),
    );
  }

  function dismiss(id: string): void {
    const timer = dismissTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      dismissTimers.delete(id);
    }
    entries = entries.filter((entry) => entry.id !== id);
  }

  function clearAllTimers(): void {
    for (const timer of dismissTimers.values()) {
      clearTimeout(timer);
    }
    dismissTimers.clear();
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

  function showFromMessage(data: unknown): void {
    const record = recordOf(data);
    const id = stringOf(record.id);
    if (id === "") {
      console.error("notch: island:show without an id, ignored");
      return;
    }
    const entry = entryOf({
      id,
      priority: numberOf(record.priority, PRIORITY_ALERT),
      label: stringOf(record.label),
      detail: stringOf(record.detail),
      progress: numberOf(record.progress, NO_PROGRESS),
      tone: toneOf(record.tone),
    });
    show(entry, numberOf(record.ttlMs, 0));
  }

  // The focused window is the island's resting content: persistent, and the
  // lowest priority, so anything else displaces it while it lasts.
  function showFocusedWindow(data: unknown): void {
    const record = recordOf(data);
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
  }

  // The sink watcher republishes on every pipewire event, and starting a new
  // track is one — so only a level that actually moved surfaces the island.
  function showVolume(data: unknown): void {
    const record = recordOf(data);
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
  }

  // A loaded track is the island's standing content: above the focused window
  // it displaces, below anything transient that interrupts it. A paused track
  // stays — the open island's play button has to have something to resume.
  function showTrack(data: unknown): void {
    const record = recordOf(data);
    const title = stringOf(record.title);
    const status = stringOf(record.status);
    if (title === "" || status === "" || status === "Stopped") {
      dismiss(MEDIA_ID);
      return;
    }
    // The playhead is polled, so a new track would otherwise show the previous
    // one's elapsed time until the next tick lands.
    if (title !== lastTrackTitle) {
      position = 0;
      lastTrackTitle = title;
    }
    media = {
      status,
      length: numberOf(record.length, 0),
      shuffle: record.shuffle === true,
    };
    const entry = entryOf({
      id: MEDIA_ID,
      priority: PRIORITY_ACTIVITY,
      label: title,
      detail: stringOf(record.artist),
      art: artSourceOf(stringOf(record.artUrl)),
    });
    show(entry, 0);
  }

  // The surface is served over http and cannot read file:// itself; the host's
  // /file route hands local art back. Remote art loads directly.
  function artSourceOf(artUrl: string): string {
    if (artUrl.startsWith("file://")) {
      const path = decodeURIComponent(artUrl.slice("file://".length));
      return `/file?path=${encodeURIComponent(path)}`;
    }
    if (artUrl.startsWith("http://") || artUrl.startsWith("https://")) {
      return artUrl;
    }
    return "";
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

  function progressWidth(entry: IslandEntry): string {
    const clamped = Math.min(Math.max(entry.progress, 0), 1);
    return `${clamped * 100}%`;
  }

  function playedWidth(): string {
    if (media.length <= 0) {
      return "0%";
    }
    const fraction = Math.min(Math.max(position / media.length, 0), 1);
    return `${fraction * 100}%`;
  }

  function elapsedLabel(): string {
    return clockLabel(position);
  }

  function remainingLabel(): string {
    if (media.length <= 0) {
      return "";
    }
    return `-${clockLabel(media.length - position)}`;
  }

  function clockLabel(seconds: number): string {
    const whole = Math.max(Math.floor(seconds), 0);
    const minutes = Math.floor(whole / 60);
    return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
  }

  function seekTo(event: MouseEvent): void {
    if (media.length <= 0) {
      return;
    }
    const track = event.currentTarget as HTMLElement;
    const bounds = track.getBoundingClientRect();
    const fraction = Math.min(
      Math.max((event.clientX - bounds.left) / bounds.width, 0),
      1,
    );
    void bus.call("media:seek", { seconds: fraction * media.length });
  }

  function seekByKey(event: KeyboardEvent): void {
    const step = SEEK_STEPS[event.key];
    if (step === undefined || media.length <= 0) {
      return;
    }
    event.preventDefault();
    const target = Math.min(Math.max(position + step, 0), media.length);
    void bus.call("media:seek", { seconds: target });
  }

  function command(type: string): void {
    void bus.call(type, {});
  }

  // The notch surface takes keyboard: 'none', so nothing here is ever focused
  // deliberately — the ring only ever appears as a leftover from a click, and
  // the header's spans the full width, reading as a stray line under it.
  const CONTROL_BASE =
    "flex cursor-pointer items-center justify-center rounded-lg p-1 outline-none transition-colors duration-150 hover:bg-base-content/10";

  function controlClass(active: boolean): string {
    if (active) {
      return `${CONTROL_BASE} text-accent`;
    }
    return `${CONTROL_BASE} text-base-content/85`;
  }

  const HEADER_BASE =
    "relative flex w-full shrink-0 cursor-pointer items-center text-left outline-none";

  function headerClass(current: string): string {
    if (current === "expandedMedia") {
      return `${HEADER_BASE} h-16 gap-3 px-4 pt-1`;
    }
    return `${HEADER_BASE} h-7.5 gap-2.5 px-3`;
  }

  const ART_BASE = "shrink-0 overflow-hidden bg-base-content/10 bg-cover bg-center";

  function artClass(large: boolean): string {
    if (large) {
      return `${ART_BASE} size-12 rounded-lg`;
    }
    return `${ART_BASE} size-5 rounded-md`;
  }

  function artStyle(art: string): string {
    if (art === "") {
      return "";
    }
    return `background-image: url('${art}')`;
  }

  function titleClass(large: boolean): string {
    if (large) {
      return "truncate text-[15px] font-semibold";
    }
    return "truncate font-medium";
  }

  const METER_BASE = "flex shrink-0 items-center gap-[2px] text-accent";

  function meterClass(large: boolean): string {
    let sized = `${METER_BASE} h-3`;
    if (large) {
      sized = `${METER_BASE} h-4`;
    }
    if (media.status !== "Playing") {
      return `${sized} paused`;
    }
    return sized;
  }

  function playLabel(): string {
    if (media.status === "Playing") {
      return "Pause";
    }
    return "Play";
  }
</script>

<div class="notch relative">
  <div
    class="relative flex flex-col overflow-hidden rounded-b-[0.625rem] bg-base-100
      text-[12px] leading-none text-base-content
      transition-[width,height] duration-[260ms] ease-[cubic-bezier(0.32,1.24,0.5,1)]"
    role="status"
    style:width="{size.width}px"
    style:height="{size.height}px"
    aria-live="polite"
    onpointerenter={() => (hovered = true)}
    onpointerleave={() => (hovered = false)}
  >
    {#if current !== null && current.art !== "" && !isMedia}
      <!-- Cover art fills the cutout behind the text; the scrim keeps the
           label legible over a bright or busy sleeve. -->
      <div
        class="pointer-events-none absolute inset-0 bg-cover bg-center opacity-25"
        style:background-image="url('{current.art}')"
      ></div>
      <div
        class="pointer-events-none absolute inset-0 bg-gradient-to-r from-base-100
          via-base-100/60 to-base-100/20"
      ></div>
    {/if}
    {#if current !== null}
      <!-- The header is the whole collapsed island and stays the click target
           when open, so the same press closes it again. -->
      <button
        type="button"
        class={headerClass(mode)}
        onclick={toggleOpen}
        aria-expanded={mode.startsWith("expanded")}
        aria-label={current.label}
      >
        {#if isMedia}
          {@render mediaHeader(current)}
        {:else}
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full bg-current {toneClass(
              current,
            )}"
          ></span>
          <span class="min-w-0 flex-1 truncate">{current.label}</span>
          {#if current.detail !== "" && !mode.startsWith("expanded")}
            <span class="shrink-0 tabular-nums text-base-content/50"
              >{current.detail}</span
            >
          {/if}
        {/if}
      </button>
      {#if current.progress >= 0 && !mode.startsWith("expanded")}
        <div
          class="absolute inset-x-4 bottom-1.5 h-[3px] overflow-hidden rounded-full
            bg-base-content/15"
        >
          <div
            class="h-full rounded-full bg-current {toneClass(
              current,
            )} transition-[width] duration-200"
            style:width={progressWidth(current)}
          ></div>
        </div>
      {/if}
      {#if mode === "expandedMedia"}
        <div
          class="relative flex min-h-0 flex-1 flex-col justify-end gap-3 px-4 pb-4"
          transition:fade={{ duration: 120 }}
        >
          {@render scrubber()}
          {@render transport()}
        </div>
      {:else if mode === "expanded"}
        <div
          class="relative flex min-h-0 flex-1 flex-col justify-end gap-1 px-4 pb-4"
          transition:fade={{ duration: 120 }}
        >
          {#if current.detail !== ""}
            <span class="truncate text-[13px] text-base-content/70"
              >{current.detail}</span
            >
          {/if}
          <span class="text-[10px] tracking-wide text-base-content/30 uppercase"
            >{current.id}</span
          >
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Collapsed and open share this row: sleeve on the left, title in the
     middle, level meter on the right. Only the scale changes. -->
{#snippet mediaHeader(entry: IslandEntry)}
  {@const large = mode === "expandedMedia"}
  <span class={artClass(large)} style={artStyle(entry.art)}></span>
  <span class="flex min-w-0 flex-1 flex-col gap-1">
    <span class={titleClass(large)}>{entry.label}</span>
    {#if large && entry.detail !== ""}
      <span class="truncate text-[13px] text-base-content/60"
        >{entry.detail}</span
      >
    {/if}
  </span>
  {@render levelMeter(large)}
{/snippet}

<!-- Four bars bouncing in sequence: the "audio is coming out of here" mark on
     the header's right edge. A paused player freezes them mid-stride. -->
{#snippet levelMeter(large: boolean)}
  <span class={meterClass(large)} aria-hidden="true">
    {#each [0, 1, 2, 3] as bar (bar)}
      <span
        class="level-bar w-[2px] rounded-full bg-current"
        style:animation-delay="{bar * 130}ms"
      ></span>
    {/each}
  </span>
{/snippet}

{#snippet scrubber()}
  <div class="flex items-center gap-2.5">
    <span class="w-8 shrink-0 tabular-nums text-[11px] text-base-content/50"
      >{elapsedLabel()}</span
    >
    <div
      class="h-1.5 flex-1 cursor-pointer overflow-hidden rounded-full bg-base-content/15 outline-none"
      role="slider"
      tabindex="0"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(media.length)}
      aria-valuenow={Math.round(position)}
      onclick={seekTo}
      onkeydown={seekByKey}
    >
      <div
        class="h-full rounded-full bg-base-content/70 transition-[width] duration-500 ease-linear"
        style:width={playedWidth()}
      ></div>
    </div>
    <span
      class="w-9 shrink-0 text-right tabular-nums text-[11px] text-base-content/50"
      >{remainingLabel()}</span
    >
  </div>
{/snippet}

<!-- Three columns so the transport group sits on the island's centre line with
     shuffle pinned left; the mirrored right column stays empty. -->
{#snippet transport()}
  <div class="grid grid-cols-[1fr_auto_1fr] items-center px-1">
    <div class="flex justify-start">
      <button
        type="button"
        class={controlClass(media.shuffle)}
        onclick={() => command("media:shuffle")}
        aria-label="Shuffle"
        aria-pressed={media.shuffle}
      >
        <ShuffleIcon size={20} weight="bold" />
      </button>
    </div>
    <div class="flex items-center gap-6">
      <button
        type="button"
        class={controlClass(false)}
        onclick={() => command("media:previous")}
        aria-label="Previous track"
      >
        <RewindIcon size={22} weight="fill" />
      </button>
      <button
        type="button"
        class={controlClass(false)}
        onclick={() => command("media:playPause")}
        aria-label={playLabel()}
      >
        {#if media.status === "Playing"}
          <PauseIcon size={26} weight="fill" />
        {:else}
          <PlayIcon size={26} weight="fill" />
        {/if}
      </button>
      <button
        type="button"
        class={controlClass(false)}
        onclick={() => command("media:next")}
        aria-label="Next track"
      >
        <FastForwardIcon size={22} weight="fill" />
      </button>
    </div>
    <div></div>
  </div>
{/snippet}

<style>
  /* Inverted fillets flanking the cutout: a quarter disc is masked out of each
     patch so the bar appears to curve into the notch instead of butting it. */
  .notch::before,
  .notch::after {
    content: "";
    position: absolute;
    top: 0;
    width: 10px;
    height: 10px;
    background: var(--color-base-100);
  }

  .notch::before {
    left: -10px;
    mask: radial-gradient(circle 10px at 0 10px, transparent 0 10px, #000 10px);
  }

  .notch::after {
    right: -10px;
    mask: radial-gradient(
      circle 10px at 10px 10px,
      transparent 0 10px,
      #000 10px
    );
  }

  .level-bar {
    height: 100%;
    transform-origin: center;
    animation: level 900ms ease-in-out infinite alternate;
  }

  .paused .level-bar {
    animation-play-state: paused;
  }

  @keyframes level {
    from {
      transform: scaleY(0.3);
    }
    to {
      transform: scaleY(1);
    }
  }
</style>
