<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import ClockCountdownIcon from 'phosphor-svelte/lib/ClockCountdownIcon'
  import CircleIcon from 'phosphor-svelte/lib/CircleIcon'
  import RepeatIcon from 'phosphor-svelte/lib/RepeatIcon'
  import { clockOf } from './duration'
  import { remindersOf } from './lib'
  import type { BusLike, Reminder } from './lib'

  // The fullscreen alert a reminder raises when it goes off. It renders
  // nothing at all while nothing is firing, which is what keeps its collapsed
  // wrapper reserving no input and the layer under it click-through.
  //
  // A fired reminder stays in the retained topic until it is dismissed, so
  // this is a view of state rather than a reaction to an event: the shell
  // restarting mid-alert brings the alert back.

  const CALL_TIMEOUT_MS = 10000
  // The scrim fades while its contents rise from the bottom edge, so the alert
  // arrives rather than appearing.
  const SCRIM = { duration: 220 }
  const RISE = { y: 96, duration: 420, easing: cubicOut }

  let { bus }: { bus: BusLike } = $props()

  let reminders: Reminder[] = $state([])

  const firing = $derived(
    reminders
      .filter((reminder) => reminder.firedAt !== 0)
      .sort((left, right) => left.firedAt - right.firedAt),
  )
  const current = $derived(firstOf(firing))

  $effect(() =>
    bus.subscribe('reminders', (message) => {
      reminders = remindersOf(message.data)
    }),
  )

  function firstOf(entries: Reminder[]): Reminder | null {
    if (entries.length === 0) {
      return null
    }
    return entries[0]
  }

  // A reminder armed without text still has to say something; the time it was
  // due for is the only thing left that identifies it.
  function titleOf(reminder: Reminder): string {
    if (reminder.text !== '') {
      return reminder.text
    }
    return clockOf(reminder.dueAt)
  }

  function close(reminder: Reminder): void {
    void bus.call('reminder:dismiss', { id: reminder.id }, CALL_TIMEOUT_MS)
  }

  function snooze(reminder: Reminder): void {
    void bus.call('reminder:snooze', { id: reminder.id }, CALL_TIMEOUT_MS)
  }

  // Repeat runs the same reminder again for as long as it ran the first time;
  // snooze is the fixed short delay.
  function repeat(reminder: Reminder): void {
    void bus.call('reminder:repeat', { id: reminder.id }, CALL_TIMEOUT_MS)
  }

  function handleKey(event: KeyboardEvent): void {
    if (current === null || event.key !== 'Escape') {
      return
    }
    event.preventDefault()
    close(current)
  }

  function autofocus(element: HTMLButtonElement): void {
    element.focus()
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if current !== null}
  {@const reminder = current}
  <div
    class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-black/75 text-base-content backdrop-blur-2xl"
    data-input-region
    transition:fade={SCRIM}
  >
    <div class="flex flex-col items-center gap-4 px-12 text-center" transition:fly={RISE}>
      <span class="text-xs font-medium tracking-[0.3em] opacity-50">REMINDER</span>
      <h1 class="max-w-4xl text-5xl font-bold text-balance">{titleOf(reminder)}</h1>
    </div>

    <div class="flex items-center gap-3" transition:fly={RISE}>
      <button
        class="flex items-center gap-2 rounded-xl bg-white/15 px-5 py-3 text-base font-medium transition hover:bg-white/25"
        type="button"
        onclick={() => close(reminder)}
        use:autofocus
      >
        <CircleIcon class="size-5 opacity-70" />
        Close
      </button>
      <button
        class="flex items-center gap-2 rounded-xl px-5 py-3 text-base font-medium ring-1 ring-white/25 transition hover:bg-white/10"
        type="button"
        onclick={() => snooze(reminder)}
      >
        <ClockCountdownIcon class="size-5 opacity-70" />
        Snooze Reminder
      </button>
      <button
        class="flex items-center gap-2 rounded-xl px-5 py-3 text-base font-medium ring-1 ring-white/25 transition hover:bg-white/10"
        type="button"
        onclick={() => repeat(reminder)}
      >
        <RepeatIcon class="size-5 opacity-70" />
        Repeat
      </button>
    </div>

    {#if firing.length > 1}
      <span class="text-sm opacity-50">{firing.length - 1} more waiting</span>
    {/if}
  </div>
{/if}
