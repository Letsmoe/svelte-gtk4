<script lang="ts">
  import type { MenuItem, MenuState } from './desktopStore.svelte'
  import { pressOf } from './gestures'

  // The desktop's right-click menu, drawn as overlay children of the desktop
  // rather than as a Gtk.Popover: a popover has to be parented to a widget with
  // `set_parent`, which markup cannot express, and the one popover the markup
  // can place is a menu button's. A Gtk.PopoverMenu is built from a GMenuModel
  // and has nothing for items carrying closures to map onto.
  //
  // The backdrop is what dismisses the menu: the desktop under it is a live
  // drop target, and a surface-wide listener would fire after that target had
  // already reacted to the same click.
  //
  // Row geometry is declared rather than measured, because the submenu has to
  // be positioned against its parent row and GTK reports an allocation only
  // after the frame it is wanted in.

  const MENU_WIDTH = 208
  const ROW_HEIGHT = 28
  const SEPARATOR_HEIGHT = 9
  const MENU_PADDING = 5
  const SUBMENU_OVERLAP_PX = 4

  let {
    menu,
    viewportWidth,
    viewportHeight,
    onclose,
  }: {
    menu: MenuState
    viewportWidth: number
    viewportHeight: number
    onclose: () => void
  } = $props()

  let openSubmenu = $state(-1)

  const origin = $derived(flipped(menu))

  // Placement flips the menu back over the pointer on whichever axis would
  // otherwise run it off the output, the way every desktop menu behaves near an
  // edge.
  function flipped(state: MenuState) {
    return {
      x: axis(state.x, MENU_WIDTH, viewportWidth),
      y: axis(state.y, heightOf(state.items), viewportHeight),
    }
  }

  function axis(start: number, size: number, limit: number): number {
    if (start + size <= limit) {
      return start
    }
    return Math.max(0, start - size)
  }

  function heightOf(items: MenuItem[]): number {
    let total = 2 * MENU_PADDING
    for (const item of items) {
      total += rowHeight(item)
    }
    return total
  }

  function rowHeight(item: MenuItem): number {
    if (item.separator === true) {
      return SEPARATOR_HEIGHT
    }
    return ROW_HEIGHT
  }

  // Where a submenu's own panel starts: level with its row, just inside the
  // parent's right edge.
  function submenuOrigin(index: number) {
    let offset = MENU_PADDING
    for (const item of menu.items.slice(0, index)) {
      offset += rowHeight(item)
    }
    return {
      x: origin.x + MENU_WIDTH - SUBMENU_OVERLAP_PX,
      y: origin.y + offset,
    }
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

  function rowClass(item: MenuItem): string {
    if (item.danger === true) {
      return 'menu-row danger'
    }
    return 'menu-row'
  }

  function checkMark(item: MenuItem): string {
    if (item.checked === true) {
      return '✓'
    }
    return ''
  }

  function dismiss(event: { detail: unknown }): void {
    // Any button: a second right-click closes the menu rather than opening a
    // second one on top of it.
    pressOf(event)
    onclose()
  }
</script>

<gtkpressable
  overlay
  class="menu-backdrop"
  hexpand
  vexpand
  input
  onpress={dismiss}
></gtkpressable>

<gtkbox
  overlay
  class="menu"
  orientation="vertical"
  halign="start"
  valign="start"
  margin-start={origin.x}
  margin-top={origin.y}
  width={MENU_WIDTH}
  input
>
  {#each menu.items as item, index (index)}
    {#if item.separator === true}
      <gtkseparator class="menu-separator" orientation="horizontal"></gtkseparator>
    {:else}
      <gtkpressable
        class={rowClass(item)}
        orientation="horizontal"
        spacing={8}
        height={ROW_HEIGHT}
        sensitive={item.disabled !== true}
        onhoverstart={() => (openSubmenu = index)}
        onpress={() => choose(item)}
      >
        <gtklabel class="menu-check" width={12}>{checkMark(item)}</gtklabel>
        <gtklabel hexpand halign="start" ellipsize="end">{item.label}</gtklabel>
        {#if item.children !== undefined}
          <gtklabel class="menu-arrow">›</gtklabel>
        {/if}
      </gtkpressable>
    {/if}
  {/each}
</gtkbox>

{#each menu.items as item, index (index)}
  {#if item.children !== undefined && openSubmenu === index}
    {@const at = submenuOrigin(index)}
    <gtkbox
      overlay
      class="menu"
      orientation="vertical"
      halign="start"
      valign="start"
      margin-start={at.x}
      margin-top={at.y}
      width={MENU_WIDTH}
      input
    >
      {#each item.children as child, childIndex (childIndex)}
        <gtkpressable
          class={rowClass(child)}
          orientation="horizontal"
          spacing={8}
          height={ROW_HEIGHT}
          sensitive={child.disabled !== true}
          onpress={() => choose(child)}
        >
          <gtklabel class="menu-check" width={12}>{checkMark(child)}</gtklabel>
          <gtklabel hexpand halign="start" ellipsize="end">{child.label}</gtklabel>
        </gtkpressable>
      {/each}
    </gtkbox>
  {/if}
{/each}
