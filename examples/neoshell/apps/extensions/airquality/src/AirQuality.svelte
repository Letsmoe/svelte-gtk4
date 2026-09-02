<script lang="ts">
  import AirQualitySummary from './AirQualitySummary.svelte'
  import IndexStrip from './IndexStrip.svelte'
  import PollutantList from './PollutantList.svelte'
  import {
    hourEntriesOf,
    pollutantEntriesOf,
    positiveOf,
    recordOf,
    stringOf,
  } from './lib'
  import type { AirQualityCurrent, BusLike } from './lib'

  // The desktop air quality card in the three widget sizes:
  //
  //   small (2x2)   the index, its band and the position on the scale
  //   medium (4x2)  the same laid out wide, plus the next hours
  //   large (4x4)   the same, plus the pollutants behind the index
  //
  // The card measures its own box rather than being told which size it is. The
  // size lives in the desktop store, and the widget canvas — plain DOM outside
  // this component's reactivity — only ever sets the slot's pixel dimensions,
  // so the box is the one signal that reaches here, including when the size is
  // changed from the widget's context menu.

  // Every wide size spans four cells, so width alone separates small from the
  // rest and height separates medium from large. Halfway between a two-cell
  // (200px) and a four-cell (392px) run clears both by a wide margin.
  const WIDE_MIN_PX = 300

  let { bus }: { bus: BusLike } = $props()

  let card: HTMLElement | undefined = $state()
  let width = $state(0)
  let height = $state(0)
  let current = $state<AirQualityCurrent | null>(null)

  const size = $derived(sizeOf(width, height))

  $effect(() => {
    return bus.subscribe('airquality.current', (message) => {
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
    if (typeof data.index !== 'number') {
      return
    }
    current = {
      index: data.index,
      category: stringOf(data.category),
      max: positiveOf(data.max, 100),
      place: stringOf(data.place),
      updatedAt: positiveOf(data.updatedAt, Date.now()),
      hours: hourEntriesOf(data.hours),
      pollutants: pollutantEntriesOf(data.pollutants),
    }
  }
</script>

<div
  bind:this={card}
  class="flex h-full w-full flex-col gap-3 rounded-3xl bg-base-300/65 p-4 text-base-content
    shadow-lg ring-1 ring-base-content/10 backdrop-blur-xl select-none"
>
  {#if current === null}
    <div class="text-sm font-medium">Air Quality</div>
    <div class="text-xs leading-snug text-base-content/60">
      Set <span class="font-mono">airquality.place</span> in the neoshell config.
    </div>
  {:else if size === 'small'}
    <AirQualitySummary {current} stacked={true} />
  {:else if size === 'medium'}
    <AirQualitySummary {current} stacked={false} />
    <IndexStrip hours={current.hours} max={current.max} class="mt-auto" />
  {:else}
    <AirQualitySummary {current} stacked={false} />
    <IndexStrip hours={current.hours} max={current.max} />
    <PollutantList pollutants={current.pollutants} class="flex-1" />
  {/if}
</div>
