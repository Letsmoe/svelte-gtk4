<script lang="ts">
  import { subscribeTo } from '../../lib/bus'
  import type { ViewProps } from '../../host/plugins/views'
  import { widgetBoxOf } from '../../lib/widget'
  import WeatherSummary from './WeatherSummary.svelte'
  import WeatherSettings from './WeatherSettings.svelte'
  import HourlyStrip from './HourlyStrip.svelte'
  import DailyList from './DailyList.svelte'
  import { currentOf } from './lib'
  import type { DayEntry, WeatherCurrent } from './lib'

  // The desktop weather card in the three widget sizes:
  //
  //   small (2x2)   place, temperature, condition
  //   medium (4x2)  the same laid out wide, plus the next hours
  //   large (4x4)   the same, plus the coming days
  //
  // The webview build measured its own box with a ResizeObserver, because the
  // widget canvas was plain DOM outside the card's reactivity and the pixel
  // size was the only signal that reached it. The slot renders the card itself
  // here and the store already holds the size, so it arrives as a prop — which
  // is also how a change from the widget's context menu gets here.

  const CALL_TIMEOUT_MS = 10000
  // What the day rows have left for their range bar once the card's padding,
  // the weekday, the icon and the two readings have taken their share.
  const DAY_ROW_FURNITURE_PX = 168

  let { bus, args, id }: ViewProps = $props()

  let current = $state<WeatherCurrent | null>(null)
  let editing = $state(false)

  const box = $derived(widgetBoxOf(args))
  const comingDays = $derived(comingDaysOf(current))
  const trackWidth = $derived(Math.max(40, box.width - DAY_ROW_FURNITURE_PX))

  // One topic per card: the backend keeps a card per instance so two weather
  // widgets can show two places, and learns this one exists from the watch
  // below. The id is read here rather than inside the handler, so a card that
  // is given a new id resubscribes.
  $effect(() => {
    const cardId = id
    void bus.call('weather:watch', { id: cardId }, CALL_TIMEOUT_MS)
    return subscribeTo(bus, `weather.current/${cardId}`, (message) => {
      current = currentOf(message.data)
    })
  })

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
</script>

<gtkoverlay class="card" hexpand vexpand>
  <gtkbox orientation="vertical" spacing={10} hexpand vexpand>
    {#if editing}
      <WeatherSettings
        place={editedPlace(current)}
        imperial={editedImperial(current)}
        onsave={save}
        oncancel={() => (editing = false)}
      />
    {:else if current === null}
      <gtkbox orientation="vertical" spacing={4}>
        <gtklabel class="card-title" halign="start">Weather</gtklabel>
        <gtklabel class="card-hint" halign="start" wrap xalign={0}>
          No location set. Use the gear to pick one.
        </gtklabel>
      </gtkbox>
    {:else if box.size === 'small'}
      <WeatherSummary {current} stacked={true} />
    {:else if box.size === 'medium'}
      <WeatherSummary {current} stacked={false} />
      <gtkbox vexpand></gtkbox>
      <HourlyStrip hours={current.hours} />
    {:else}
      <WeatherSummary {current} stacked={false} />
      <HourlyStrip hours={current.hours} />
      <DailyList days={comingDays} {trackWidth} />
    {/if}
  </gtkbox>

  <!-- The gear is always drawn rather than revealed on hover: GTK has no
       :hover on an ancestor to key a child's opacity off, and a control that
       only exists while the pointer is over it cannot be found by touch. -->
  {#if !editing}
    <gtkbutton
      overlay
      class="card-gear"
      frame={false}
      icon="emblem-system-symbolic"
      halign="end"
      valign="start"
      tooltip="Edit Weather"
      onclicked={() => (editing = true)}
    ></gtkbutton>
  {/if}
</gtkoverlay>
