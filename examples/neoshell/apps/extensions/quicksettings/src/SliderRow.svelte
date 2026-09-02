<script lang="ts">
  import Icon from './Icon.svelte'

  // A quick-settings slider: one rounded pill whose fill is the value, with
  // the icon sitting inside the left end. The native thumb is collapsed to
  // nothing — the fill edge is the handle, the way the reference design reads.
  // The value is committed while dragging, so audio and backlight follow the
  // pointer; the backend republishes and the parent feeds the value back in.

  let {
    icon,
    label,
    value,
    disabled = false,
    onInput,
    onIconClick,
  }: {
    icon: string
    label: string
    value: number
    disabled?: boolean
    onInput: (percent: number) => void
    onIconClick?: () => void
  } = $props()

  const iconInteractive = $derived(onIconClick !== undefined && !disabled)

  function handleInput(event: Event): void {
    const target = event.currentTarget as HTMLInputElement
    onInput(Number(target.value))
  }

  function handleIconClick(): void {
    if (onIconClick === undefined || disabled) {
      return
    }
    onIconClick()
  }

  function iconClass(interactive: boolean): string {
    if (interactive) {
      return 'pointer-events-auto cursor-pointer'
    }
    return 'pointer-events-none'
  }
</script>

<div class="relative h-8">
  <input
    type="range"
    min="0"
    max="100"
    step="1"
    class="slider h-8 w-full"
    style:--fill="{value}%"
    aria-label={label}
    {value}
    {disabled}
    oninput={handleInput}
  />
  <button
    type="button"
    class="absolute inset-y-0 left-0 flex w-9 items-center justify-center
      text-base-content/80 disabled:opacity-40 {iconClass(iconInteractive)}"
    tabindex={-1}
    aria-hidden={!iconInteractive}
    {disabled}
    onclick={handleIconClick}
  >
    <Icon name={icon} size={17} />
  </button>
</div>

<style>
  .slider {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  .slider:disabled {
    cursor: default;
    opacity: 0.4;
  }

  /* The track carries the fill, so a value change repaints without a second
     element to keep in sync. */
  .slider::-webkit-slider-runnable-track {
    height: 2rem;
    border-radius: 9999px;
    background: linear-gradient(
      to right,
      var(--color-info) var(--fill),
      rgb(255 255 255 / 0.1) var(--fill)
    );
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 1px;
    height: 2rem;
    background: transparent;
  }

  .slider::-moz-range-track {
    height: 2rem;
    border-radius: 9999px;
    background: linear-gradient(
      to right,
      var(--color-info) var(--fill),
      rgb(255 255 255 / 0.1) var(--fill)
    );
  }

  .slider::-moz-range-thumb {
    width: 1px;
    height: 2rem;
    border: 0;
    background: transparent;
  }
</style>
