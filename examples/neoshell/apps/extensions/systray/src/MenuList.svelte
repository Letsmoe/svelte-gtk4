<script lang="ts">
  import Self from './MenuList.svelte'
  import { menuIconSourceOf } from './lib'
  import type { MenuEntry } from './lib'

  // One level of a tray item's dbusmenu. A row with children opens the next
  // level as a flyout to its right, which is why this component mounts itself.

  const ICON_SIZE = 32

  let {
    entries,
    onActivate,
  }: { entries: MenuEntry[]; onActivate: (entry: MenuEntry) => void } = $props()

  let openChildId = $state(-1)

  function enter(entry: MenuEntry): void {
    if (entry.children.length === 0) {
      openChildId = -1
      return
    }
    openChildId = entry.id
  }

  // A parent row is a way into its submenu, never an action of its own.
  function click(entry: MenuEntry): void {
    if (!entry.enabled || entry.children.length > 0) {
      return
    }
    onActivate(entry)
  }

  const ROW_BASE =
    'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12.5px] leading-5 '

  function rowClass(entry: MenuEntry): string {
    if (!entry.enabled) {
      return ROW_BASE + 'cursor-default text-base-content/35'
    }
    return ROW_BASE + 'cursor-pointer text-base-content hover:bg-base-content/10'
  }

  // A checkmark column is only reserved when some row in this level toggles,
  // so an ordinary menu is not indented for nothing.
  const hasToggles = $derived(entries.some((entry) => entry.toggleType !== ''))

  function checkmark(entry: MenuEntry): string {
    if (entry.toggleState !== 1) {
      return ''
    }
    if (entry.toggleType === 'radio') {
      return '•'
    }
    return '✓'
  }
</script>

<div
  class="flex min-w-52 flex-col gap-px rounded-xl border border-base-content/10 bg-base-200 p-1
    text-base-content shadow-2xl shadow-black/60"
>
  {#each entries as entry (entry.id)}
    {#if entry.separator}
      <div class="my-1 h-px bg-base-content/10"></div>
    {:else}
      <div class="relative" onmouseenter={() => enter(entry)} role="none">
        <button class={rowClass(entry)} disabled={!entry.enabled} onclick={() => click(entry)}>
          {#if hasToggles}
            <span class="w-3 shrink-0 text-center text-[11px]">{checkmark(entry)}</span>
          {/if}
          {#if menuIconSourceOf(entry, ICON_SIZE) !== ''}
            <img class="h-4 w-4 shrink-0 object-contain" src={menuIconSourceOf(entry, ICON_SIZE)} alt="" />
          {/if}
          <span class="flex-1 truncate">{entry.label}</span>
          {#if entry.children.length > 0}
            <span class="shrink-0 text-[10px] text-base-content/50">›</span>
          {/if}
        </button>
        {#if entry.children.length > 0 && openChildId === entry.id}
          <div class="absolute top-0 left-full pl-1">
            <Self entries={entry.children} {onActivate} />
          </div>
        {/if}
      </div>
    {/if}
  {/each}
</div>
