<script lang="ts">
  import { untrack } from 'svelte'

  // The card's own settings, per widget instance. Two weather widgets on one
  // desktop are two places, so this writes weather.cards.<id> rather than the
  // shared section — a card that has never been edited keeps following the
  // section's defaults.
  //
  // Every control here is a real form control, which is also what keeps the
  // widget canvas from reading a press on it as the start of a drag.

  let {
    place,
    imperial,
    onsave,
    oncancel,
  }: {
    place: string
    imperial: boolean
    onsave: (place: string, imperial: boolean) => void
    oncancel: () => void
  } = $props()

  // Seeded once, on purpose: the form is mounted when the card flips to its
  // settings face, and a poll landing mid-edit must not overwrite what is being
  // typed.
  let draftPlace = $state(untrack(() => place))
  let draftImperial = $state(untrack(() => imperial))

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    onsave(draftPlace.trim(), draftImperial)
  }
</script>

<form class="flex h-full flex-col justify-between gap-2" onsubmit={submit}>
  <label class="flex flex-col gap-1">
    <span class="text-xs text-base-content/60">Location</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="w-full min-w-0 rounded-lg bg-base-100/60 px-2 py-1 text-sm ring-1
        ring-base-content/15 outline-none focus:ring-base-content/40"
      type="text"
      autofocus
      placeholder="City"
      bind:value={draftPlace}
    />
  </label>

  <div class="flex items-center justify-between gap-2">
    <span class="text-xs text-base-content/60">Units</span>
    <button
      class="rounded-lg bg-base-100/60 px-2 py-1 text-xs tabular-nums ring-1 ring-base-content/15"
      type="button"
      onclick={() => (draftImperial = !draftImperial)}
    >
      {#if draftImperial}°F{:else}°C{/if}
    </button>
  </div>

  <div class="flex gap-2">
    <button
      class="flex-1 rounded-lg px-2 py-1 text-xs ring-1 ring-base-content/15"
      type="button"
      onclick={oncancel}
    >
      Cancel
    </button>
    <button class="flex-1 rounded-lg bg-primary px-2 py-1 text-xs text-primary-content" type="submit">
      Done
    </button>
  </div>
</form>
