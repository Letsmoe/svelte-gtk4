<script lang="ts">
  import { iconName } from './icons'

  // A quick-settings slider: one rounded pill whose fill is the value, with
  // the icon sitting inside the left end. The value is committed while
  // dragging, so audio and backlight follow the pointer; the backend
  // republishes and the parent feeds the value back in.
  //
  // The webview build collapsed the native thumb to nothing and painted the
  // fill as a track gradient. A Gtk.Scale already has the parts — trough,
  // highlight, slider — so the stylesheet sizes those and the gradient goes.

  const ROW_HEIGHT = 32

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

  // The scale reports a double and the backends take whole percent. Writing
  // the rounded value back through `value` is also what stops the attribute
  // update from fighting the drag.
  function handleValueChanged(event: { target: { widget: { get_value(): number } } }): void {
    const percent = Math.round(event.target.widget.get_value())
    if (percent === value) {
      return
    }
    onInput(percent)
  }

  function handleIconClick(): void {
    if (onIconClick === undefined || disabled) {
      return
    }
    onIconClick()
  }
</script>

<gtkoverlay height={ROW_HEIGHT}>
  <gtkscale
    class="qs-slider"
    orientation="horizontal"
    min={0}
    max={100}
    step={1}
    {value}
    draw-value={false}
    tooltip={label}
    sensitive={!disabled}
    hexpand
    onvalue-changed={handleValueChanged}
  ></gtkscale>

  <!-- The icon sits over the left end of the trough. It is only a button when
       it does something: a mute toggle is clickable, a brightness lamp is not,
       and a button that swallowed the click would leave that end of the
       slider unreachable. -->
  {#if iconInteractive}
    <gtkbutton
      overlay
      class="qs-slider-icon"
      frame={false}
      halign="start"
      valign="center"
      focusable={false}
      onclicked={handleIconClick}
    >
      <gtkicon icon={iconName(icon)} size={17}></gtkicon>
    </gtkbutton>
  {:else}
    <gtkicon
      overlay
      class="qs-slider-lamp"
      icon={iconName(icon)}
      size={17}
      halign="start"
      valign="center"
    ></gtkicon>
  {/if}
</gtkoverlay>
