<script lang="ts">
  import { iconName } from './icons'

  // One quick-settings tile. A wide tile shows icon, title and subtitle in a
  // row; a compact tile stacks the icon over a label. Tiles that drill into a
  // detail page carry a chevron that is its own button, so toggling and
  // opening stay separate gestures.
  //
  // The surface and badge colours were Tailwind classes computed inline. GTK
  // CSS has no opacity modifiers, so each combination is a named class the
  // stylesheet spells out.

  const TILE_HEIGHT = 56
  const BADGE_SIZE = 32

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
      return 'qs-tile off'
    }
    if (isActive) {
      return 'qs-tile on'
    }
    return 'qs-tile'
  }

  function badgeClassOf(isActive: boolean, isDisabled: boolean): string {
    if (isDisabled) {
      return 'qs-badge off'
    }
    if (isActive) {
      return 'qs-badge on'
    }
    return 'qs-badge'
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
  <gtkbutton
    class={surfaceClass}
    frame={false}
    height={TILE_HEIGHT}
    hexpand
    sensitive={!disabled}
    tooltip={title}
    onclicked={activate}
  >
    <gtkbox orientation="vertical" spacing={3} halign="center" valign="center">
      <gtkbox
        class={badgeClass}
        width={BADGE_SIZE}
        height={BADGE_SIZE}
        halign="center"
        clip
      >
        <gtkicon icon={iconName(icon)} size={17} halign="center" valign="center" hexpand></gtkicon>
      </gtkbox>
      <gtklabel class="qs-tile-compact-label" ellipsize="end" max-width-chars={9}>
        {title}
      </gtklabel>
    </gtkbox>
  </gtkbutton>
{:else}
  <gtkbox class={surfaceClass} orientation="horizontal" height={TILE_HEIGHT} hexpand clip>
    <gtkbutton
      class="qs-tile-main"
      frame={false}
      hexpand
      sensitive={!disabled}
      onclicked={activate}
    >
      <gtkbox orientation="horizontal" spacing={10} hexpand>
        <gtkbox
          class={badgeClass}
          width={BADGE_SIZE}
          height={BADGE_SIZE}
          valign="center"
          clip
        >
          <gtkicon icon={iconName(icon)} size={17} halign="center" valign="center" hexpand></gtkicon>
        </gtkbox>
        <gtkbox orientation="vertical" hexpand valign="center">
          <gtklabel class="qs-tile-title" halign="start" ellipsize="end">{title}</gtklabel>
          {#if subtitle !== ''}
            <gtklabel class="qs-tile-subtitle" halign="start" ellipsize="end">
              {subtitle}
            </gtklabel>
          {/if}
        </gtkbox>
      </gtkbox>
    </gtkbutton>
    {#if onOpen !== undefined}
      <gtkbutton
        class="qs-tile-open"
        frame={false}
        sensitive={!disabled}
        tooltip="Open {title} settings"
        onclicked={open}
      >
        <gtkicon icon={iconName('chevronRight')} size={15}></gtkicon>
      </gtkbutton>
    {/if}
  </gtkbox>
{/if}
