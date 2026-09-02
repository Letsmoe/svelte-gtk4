<script lang="ts">
  import type { MenuItem, MenuState } from './desktopStore.svelte'

  // The desktop's right-click menu. Nothing in @neoshell/ui fits — the package
  // ships one component, AttachedPanel, which draws the inner corners that
  // blend a panel into the bar and carries no list, keyboard, or placement
  // behaviour. A pointer-positioned menu is a different thing, so it lives
  // here with the other desktop views.
  //
  // The backdrop is what dismisses the menu: the desktop under it is a live
  // drop target, and a window listener would fire after that target had
  // already reacted to the same click.

  const SUBMENU_OVERLAP_PX = 4

  let { menu, onclose }: { menu: MenuState; onclose: () => void } = $props()

  let panel: HTMLElement | undefined = $state()
  let openSubmenu = $state(-1)

  // Placement flips the menu back over the pointer on whichever axis would
  // otherwise run it off the output, the way every desktop menu behaves near
  // an edge.
  let position = $derived(flipped(menu, panel))

  function flipped(state: MenuState, element: HTMLElement | undefined) {
    if (element === undefined) {
      return { left: state.x, top: state.y }
    }
    return {
      left: axis(state.x, element.offsetWidth, window.innerWidth),
      top: axis(state.y, element.offsetHeight, window.innerHeight),
    }
  }

  function axis(start: number, size: number, limit: number): number {
    if (start + size <= limit) {
      return start
    }
    return Math.max(0, start - size)
  }

  function choose(item: MenuItem): void {
    if (item.disabled === true || item.children !== undefined) {
      return
    }
    onclose()
    if (item.action !== undefined) {
      item.action()
    }
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      onclose()
    }
  }
</script>

<svelte:window on:keydown={handleKey} />

<div
  class="fixed inset-0 z-50"
  role="presentation"
  onpointerdown={onclose}
  oncontextmenu={(event) => {
    event.preventDefault()
    onclose()
  }}
>
  <div
    bind:this={panel}
    class="absolute min-w-52 rounded-xl border border-base-content/10 bg-base-200/95 p-1
      shadow-2xl backdrop-blur-xl"
    style:left={`${position.left}px`}
    style:top={`${position.top}px`}
    role="menu"
    tabindex="-1"
    onpointerdown={(event) => event.stopPropagation()}
  >
    {#each menu.items as item, index (index)}
      {#if item.separator === true}
        <div class="my-1 h-px bg-base-content/10"></div>
      {:else}
        <div
          class="relative"
          role="none"
          onpointerenter={() => {
            openSubmenu = index
          }}
        >
          <button
            class="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px]
              text-base-content disabled:opacity-40 enabled:hover:bg-base-content/10"
            class:text-error={item.danger === true}
            role="menuitem"
            disabled={item.disabled === true}
            onclick={() => choose(item)}
          >
            <span class="w-3 shrink-0 text-center">{item.checked === true ? '✓' : ''}</span>
            <span class="grow truncate">{item.label}</span>
            {#if item.children !== undefined}
              <span class="shrink-0 opacity-60">›</span>
            {/if}
          </button>

          {#if item.children !== undefined && openSubmenu === index}
            <div
              class="absolute top-0 left-full z-10 min-w-52 rounded-xl border border-base-content/10
                bg-base-200/95 p-1 shadow-2xl backdrop-blur-xl"
              style:margin-left={`-${SUBMENU_OVERLAP_PX}px`}
              role="menu"
            >
              {#each item.children as child, childIndex (childIndex)}
                <button
                  class="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px]
                    text-base-content disabled:opacity-40 enabled:hover:bg-base-content/10"
                  role="menuitem"
                  disabled={child.disabled === true}
                  onclick={() => choose(child)}
                >
                  <span class="grow truncate">{child.label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</div>
