<script lang="ts">
  import WeatherSummary from './WeatherSummary.svelte'
  import WeatherSettings from './WeatherSettings.svelte'
  import HourlyStrip from './HourlyStrip.svelte'
  import DailyList from './DailyList.svelte'
  import { NO_TEMPERATURE, dayEntriesOf, hourEntriesOf, numberOf, recordOf, stringOf } from './lib'
  import type { BusLike, DayEntry, WeatherCurrent } from './lib'

  // The desktop weather card in the three widget sizes:
  //
  //   small (2x2)   place, temperature, condition
  //   medium (4x2)  the same laid out wide, plus the next hours
  //   large (4x4)   the same, plus the coming days
  //
  // The card measures its own box rather than being told which size it is. The
  // size lives in the desktop store, and the widget canvas — plain DOM outside
  // this component's reactivity — only ever sets the slot's pixel dimensions,
  // so the box is the one signal that reaches here, including when the size is
  // changed from the widget's context menu.

  // Every wide size spans four cells, so width alone separates small from the
  // rest and height separates medium from large. The threshold sits between a
  // two-cell and a four-cell run at any cell size the grid resolves to.
  const WIDE_MIN_PX = 300
  const CALL_TIMEOUT_MS = 10000

  let { bus, id }: { bus: BusLike; id: string } = $props()

  let card: HTMLElement | undefined = $state()
  let width = $state(0)
  let height = $state(0)
  let current = $state<WeatherCurrent | null>(null)
  let editing = $state(false)

  const size = $derived(sizeOf(width, height))
  const comingDays = $derived(comingDaysOf(current))

  // One topic per card: the backend keeps a card per instance so two weather
  // widgets can show two places, and learns this one exists from the watch
  // below.
  $effect(() => {
    void bus.call('weather:watch', { id }, CALL_TIMEOUT_MS)
    return bus.subscribe(`weather.current/${id}`, (message) => {
      apply(recordOf(message.data))
    })
  })

  $effect(() => {
    const element = card
    if (element === undefined) {
      return
    }
    const observer = new ResizeObserver(() => measure(element))
    observer.observe(element)
    measure(element)
    return () => observer.disconnect()
  })

  function measure(element: HTMLElement): void {
    width = element.clientWidth
    height = element.clientHeight
  }

  // The whole card entry is written at once so the backend reconfigures on one
  // republish rather than on one per field. Place and units are all a card
  // owns; everything else about it stays with the shared section.
  //
  // A cleared field writes no place at all rather than an empty one, so the
  // card goes back to following the shared location instead of losing it.
  function save(place: string, imperial: boolean): void {
    editing = false
    void bus.call(
      'config:set',
      { key: `weather.cards.${id}`, value: { ...placeEntry(place), units: unitsOf(imperial) } },
      CALL_TIMEOUT_MS,
    )
  }

  function placeEntry(place: string): Record<string, string> {
    if (place === '') {
      return {}
    }
    return { place }
  }

  function unitsOf(imperial: boolean): string {
    if (imperial) {
      return 'imperial'
    }
    return 'metric'
  }

  function editedPlace(state: WeatherCurrent | null): string {
    if (state === null) {
      return ''
    }
    return state.place
  }

  function editedImperial(state: WeatherCurrent | null): boolean {
    if (state === null) {
      return false
    }
    return state.unit === '°F'
  }

  // The day list starts tomorrow: today's high and low are already on the
  // summary above it.
  function comingDaysOf(state: WeatherCurrent | null): DayEntry[] {
    if (state === null) {
      return []
    }
    return state.days.slice(1)
  }

  function sizeOf(cardWidth: number, cardHeight: number): string {
    if (cardWidth < WIDE_MIN_PX) {
      return 'small'
    }
    if (cardHeight < WIDE_MIN_PX) {
      return 'medium'
    }
    return 'large'
  }

  // The backend publishes nothing until it has a location, so an unconfigured
  // card stays null and says so rather than sitting blank.
  function apply(data: Record<string, unknown>): void {
    if (typeof data.temperature !== 'number') {
      return
    }
    current = {
      place: stringOf(data.place),
      temperature: data.temperature,
      unit: stringOf(data.unit),
      code: numberOf(data.code, 0),
      description: stringOf(data.description),
      isDay: data.isDay !== false,
      high: numberOf(data.high, NO_TEMPERATURE),
      low: numberOf(data.low, NO_TEMPERATURE),
      hours: hourEntriesOf(data.hours),
      days: dayEntriesOf(data.days),
    }
  }
</script>

<div
  bind:this={card}
  class="group relative flex h-full w-full flex-col gap-3 rounded-3xl bg-base-300/65 p-4
    text-base-content shadow-lg ring-1 ring-base-content/10 backdrop-blur-xl select-none"
>
  {#if !editing}
    <button
      class="absolute top-2 right-2 rounded-full p-1.5 text-base-content/70 opacity-0
        transition group-hover:opacity-100 hover:bg-base-content/10 hover:text-base-content"
      type="button"
      title="Edit Weather"
      aria-label="Edit Weather"
      onclick={() => (editing = true)}
    >
      <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path
          d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm6.4 2.5c0 .4 0 .8-.1 1.1l1.3 1a.3.3 0
            0 1 .1.4l-1.2 2.1a.3.3 0 0 1-.4.1l-1.5-.6c-.3.2-.7.5-1.1.6l-.2 1.6a.3.3 0 0 1-.3.2H8.4
            l-.5.6h-.9a.3.3 0 0 1-.3-.2l-.2-1.6c-.4-.1-.8-.4-1.1-.6l-1.5.6a.3.3 0 0 1-.4-.1L2.3
            10.5a.3.3 0 0 1 .1-.4l1.3-1A6 6 0 0 1 3.6 8c0-.4 0-.8.1-1.1l-1.3-1a.3.3 0 0 1-.1-.4
            l1.2-2.1a.3.3 0 0 1 .4-.1l1.5.6c.3-.2.7-.5 1.1-.6l.2-1.6a.3.3 0 0 1 .3-.2h2.4a.3.3 0
            0 1 .3.2l.2 1.6c.4.1.8.4 1.1.6l1.5-.6a.3.3 0 0 1 .4.1l1.2 2.1a.3.3 0 0 1-.1.4l-1.3 1
            c.1.3.1.7.1 1.1z"
        />
      </svg>
    </button>
  {/if}

  {#if editing}
    <WeatherSettings
      place={editedPlace(current)}
      imperial={editedImperial(current)}
      onsave={save}
      oncancel={() => (editing = false)}
    />
  {:else if current === null}
    <div class="text-sm font-medium">Weather</div>
    <div class="text-xs leading-snug text-base-content/60">
      No location set. Use the gear to pick one.
    </div>
  {:else if size === 'small'}
    <WeatherSummary {current} stacked={true} />
  {:else if size === 'medium'}
    <WeatherSummary {current} stacked={false} />
    <HourlyStrip hours={current.hours} class="mt-auto" />
  {:else}
    <WeatherSummary {current} stacked={false} />
    <HourlyStrip hours={current.hours} />
    <DailyList days={comingDays} class="flex-1" />
  {/if}
</div>
