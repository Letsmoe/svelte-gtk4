<script lang="ts">
  import XIcon from 'phosphor-svelte/lib/XIcon'
  import { clockOf, compactRemaining, remainingFraction } from './duration'
  import type { Reminder } from './lib'

  // Reminders that have been armed but have not gone off yet, as square tiles
  // to the right of the plus. Each carries a ring that empties as its
  // countdown runs and the minutes left as a single figure.
  //
  // Without them a submitted reminder disappears until it fires, and
  // cancelling one would only be reachable over the bus.

  // The ring is drawn on a 44-unit box, inset far enough that the stroke sits
  // inside the tile's own edge.
  const BOX = 44
  const RADIUS = 20
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS
  // The tile takes a flat translucent fill rather than a backdrop filter: the
  // ring and the figure change every tick, and WebKit re-rasterises a
  // backdrop-filtered box on every change to its contents, which reads as a
  // flash once a second.

  let {
    reminders,
    now,
    oncancel,
  }: {
    reminders: Reminder[]
    now: number
    oncancel: (id: string) => void
  } = $props()

  const ordered = $derived([...reminders].sort((left, right) => left.dueAt - right.dueAt))

  function dashOffset(reminder: Reminder): number {
    return CIRCUMFERENCE * (1 - remainingFraction(reminder.armedAt, reminder.dueAt, now))
  }

  // The tooltip names the due time rather than the remaining one, so it is not
  // one more attribute rewritten on every tick.
  function tooltipOf(reminder: Reminder): string {
    if (reminder.text === '') {
      return clockOf(reminder.dueAt)
    }
    return `${reminder.text} — ${clockOf(reminder.dueAt)}`
  }
</script>

{#each ordered as reminder (reminder.id)}
  <button
    class="group/tile relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-base-300/90 shadow-lg ring-1 ring-white/10 hover:bg-base-300"
    type="button"
    title={tooltipOf(reminder)}
    onclick={() => oncancel(reminder.id)}
  >
    <svg class="absolute inset-0 size-full -rotate-90" viewBox="0 0 {BOX} {BOX}" aria-hidden="true">
      <circle
        class="stroke-white/10"
        cx={BOX / 2}
        cy={BOX / 2}
        r={RADIUS}
        fill="none"
        stroke-width="2.5"
      />
      <circle
        class="stroke-primary"
        cx={BOX / 2}
        cy={BOX / 2}
        r={RADIUS}
        fill="none"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-dasharray={CIRCUMFERENCE}
        stroke-dashoffset={dashOffset(reminder)}
      />
    </svg>
    <span class="text-sm font-medium tabular-nums group-hover/tile:opacity-0">
      {compactRemaining(reminder.dueAt, now)}
    </span>
    <XIcon
      class="absolute size-4 opacity-0 transition-opacity group-hover/tile:opacity-100"
    />
  </button>
{/each}
