<script lang="ts">
  import ClockIcon from 'phosphor-svelte/lib/ClockIcon'
  import {
    clockOf,
    displayedMinutes,
    dueAtFromClock,
    formatDuration,
    parseClock,
    resolvedDueAt,
  } from './duration'
  import type { Duration } from './duration'
  import { autofocus } from './lib'

  // The chip on the left of the pill: how long the reminder has to run, and
  // the wall-clock time that lands on. Clicking it swaps the reading for an
  // HH:mm field — the way to reach a time the 100-minute drag cannot.

  let {
    duration,
    now,
    editing = false,
    onduration,
    onedit,
  }: {
    duration: Duration
    now: number
    editing?: boolean
    onduration: (next: Duration) => void
    onedit: (editing: boolean) => void
  } = $props()

  let draft = $state('')
  let invalid = $state(false)

  const minutes = $derived(displayedMinutes(duration, now))
  const clock = $derived(clockOf(resolvedDueAt(duration, now)))

  function startEditing(): void {
    draft = clock
    invalid = false
    onedit(true)
  }

  // A field left holding something unparseable keeps the duration it had; the
  // red draft is the only report, since there is nowhere to put an error.
  function commit(): void {
    const parsed = parseClock(draft)
    if (parsed === null) {
      invalid = true
      return
    }
    onduration({ kind: 'clock', dueAt: dueAtFromClock(parsed, Date.now()) })
    onedit(false)
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      commit()
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      onedit(false)
    }
  }

</script>

<div class="flex shrink-0 items-center gap-2 pl-1 text-sm">
  <ClockIcon class="size-4 opacity-60" />
  {#if editing}
    <input
      class="w-16 bg-transparent text-center font-medium tabular-nums outline-none"
      class:text-error={invalid}
      type="text"
      placeholder="HH:mm"
      bind:value={draft}
      onkeydown={handleKey}
      onblur={commit}
      use:autofocus
    />
  {:else}
    <button
      class="flex cursor-text items-center gap-2 font-medium whitespace-nowrap tabular-nums"
      type="button"
      onclick={startEditing}
    >
      <span>{formatDuration(minutes)}</span>
      <span class="opacity-40">·</span>
      <span class="opacity-60">{clock}</span>
    </button>
  {/if}
</div>
