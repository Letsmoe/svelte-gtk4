<script lang="ts">
  import Icon from './Icon.svelte'

  // One quick-settings tile. A wide tile shows icon, title and subtitle in a
  // row; a compact tile stacks the icon over a two-line label in a square.
  // Tiles that drill into a detail page carry a chevron that is its own
  // button, so toggling and opening stay separate gestures.

  let {
    icon,
    title,
    subtitle = '',
    active = false,
    disabled = false,
    compact = false,
    onActivate,
    onOpen,
  }: {
    icon: string
    title: string
    subtitle?: string
    active?: boolean
    disabled?: boolean
    compact?: boolean
    onActivate?: () => void
    onOpen?: () => void
  } = $props()

  const surfaceClass = $derived(surfaceClassOf(active, disabled))
  const badgeClass = $derived(badgeClassOf(active, disabled))

  function surfaceClassOf(isActive: boolean, isDisabled: boolean): string {
    if (isDisabled) {
      return 'bg-base-300/50 opacity-45'
    }
    if (isActive) {
      return 'bg-info/20 hover:bg-info/25'
    }
    return 'bg-base-300/80 hover:bg-base-300'
  }

  function badgeClassOf(isActive: boolean, isDisabled: boolean): string {
    if (isDisabled) {
      return 'bg-base-content/10 text-base-content/60'
    }
    if (isActive) {
      return 'bg-info text-info-content'
    }
    return 'bg-base-content/10 text-base-content/70'
  }

  function activate(): void {
    if (disabled || onActivate === undefined) {
      return
    }
    onActivate()
  }

  function open(): void {
    if (disabled || onOpen === undefined) {
      return
    }
    onOpen()
  }
</script>

{#if compact}
  <button
    type="button"
    class="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl px-1
      text-center transition-colors {surfaceClass}"
    {disabled}
    onclick={activate}
  >
    <span class="flex h-8 w-8 items-center justify-center rounded-full {badgeClass}">
      <Icon name={icon} size={17} />
    </span>
    <span class="text-[9.5px] leading-[1.15]">{title}</span>
  </button>
{:else}
  <div class="flex h-14 items-center rounded-2xl transition-colors {surfaceClass}">
    <button
      type="button"
      class="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-2.5 text-left"
      {disabled}
      onclick={activate}
    >
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full {badgeClass}">
        <Icon name={icon} size={17} />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[12px] leading-tight font-medium">{title}</span>
        {#if subtitle !== ''}
          <span class="block truncate text-[10px] leading-tight opacity-55">{subtitle}</span>
        {/if}
      </span>
    </button>
    {#if onOpen !== undefined}
      <button
        type="button"
        class="flex h-full items-center pr-2 pl-1 opacity-45 transition-opacity
          hover:opacity-100"
        {disabled}
        aria-label="Open {title} settings"
        onclick={open}
      >
        <Icon name="chevronRight" size={15} />
      </button>
    {:else}
      <span class="w-2.5"></span>
    {/if}
  </div>
{/if}
