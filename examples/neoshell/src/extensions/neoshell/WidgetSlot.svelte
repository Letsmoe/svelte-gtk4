<script lang="ts">
  import type { BusService } from '../../lib/bus'
  import type { ViewRegistry } from '../../host/plugins/views'
  import { SIZE_NAMES } from './freeform'
  import type { Point, Size } from './freeform'
  import type { DesktopStore, MenuItem, WidgetPlacement } from './desktopStore.svelte'
  import { dragOf, pressOf, SECONDARY_BUTTON } from './gestures'

  // One widget on the desktop: the registered view for its type, placed by the
  // store and draggable unless it or the desktop is locked.
  //
  // The webview build ran this layer as plain DOM outside Svelte's reactivity,
  // because mounting a widget meant handing a factory an element it owned. The
  // registry holds components now, so a widget is an ordinary child in an each
  // block — the canvas, its slot bookkeeping, its per-instance fibers and its
  // manual reconcile all go with it.

  const DRAG_THRESHOLD_PX = 4

  let {
    placement,
    bus,
    registry,
    generation,
    store,
    onpreview,
  }: {
    placement: WidgetPlacement
    bus: BusService
    registry: ViewRegistry
    generation: number
    store: DesktopStore
    onpreview: (point: Point | null, box: Size, allowed: boolean) => void
  } = $props()

  let dragPoint = $state<Point | null>(null)
  let moving = $state(false)

  // Reading `generation` is what re-resolves the type when a widget provider's
  // views register after the desktop is already up.
  const View = $derived(viewFor(placement.type, generation))
  const point = $derived(shownPoint(placement, dragPoint))
  const slotClass = $derived(slotClassOf(moving))

  function viewFor(type: string, _generation: number) {
    return registry.resolve(type)
  }

  function shownPoint(current: WidgetPlacement, loose: Point | null): Point {
    if (loose === null) {
      return current.point
    }
    return loose
  }

  function slotClassOf(isMoving: boolean): string {
    if (isMoving) {
      return 'widget-slot dragging'
    }
    return 'widget-slot'
  }

  function handlePress(event: { detail: unknown }): void {
    const press = pressOf(event)
    if (press.button !== SECONDARY_BUTTON) {
      return
    }
    store.openMenu(placement.point.x + press.x, placement.point.y + press.y, menuItems())
  }

  function startDrag(): void {
    if (!store.widgetDraggable(placement.id)) {
      return
    }
    moving = false
    dragPoint = placement.point
  }

  // The widget follows the pointer; the preview shows where it would land,
  // which is the store's answer — so the guides, the outline and the drop all
  // agree.
  function moveDrag(event: { detail: unknown }): void {
    if (dragPoint === null) {
      return
    }
    const drag = dragOf(event)
    if (!moving && Math.hypot(drag.dx, drag.dy) < DRAG_THRESHOLD_PX) {
      return
    }
    moving = true
    const loose = { x: placement.point.x + drag.dx, y: placement.point.y + drag.dy }
    dragPoint = loose
    const landing = store.snapWithoutGuides(loose, placement.box, [rectOfPlacement()])
    onpreview(landing, placement.box, store.widgetDropAllowed(placement.id, landing))
  }

  function endDrag(event: { detail: unknown }): void {
    if (dragPoint === null) {
      return
    }
    const drag = dragOf(event)
    const wasMoving = moving
    dragPoint = null
    moving = false
    onpreview(null, placement.box, false)
    if (!wasMoving) {
      return
    }
    const loose = { x: placement.point.x + drag.dx, y: placement.point.y + drag.dy }
    // A rejected drop — the pixels are taken — leaves the store as it was, and
    // the widget snaps back to the point it still holds.
    store.moveWidget(
      placement.id,
      store.snapWithoutGuides(loose, placement.box, [rectOfPlacement()]),
    )
  }

  function rectOfPlacement() {
    return {
      x: placement.point.x,
      y: placement.point.y,
      width: placement.box.width,
      height: placement.box.height,
    }
  }

  function menuItems(): MenuItem[] {
    return [
      { label: 'Edit Widgets', action: () => store.openGallery() },
      { separator: true },
      {
        label: 'Locked',
        checked: placement.locked,
        disabled: store.desktopLocked,
        action: () => store.setWidgetLocked(placement.id, !placement.locked),
      },
      { label: 'Size', children: sizeItems() },
      { separator: true },
      { label: 'Remove Widget', danger: true, action: () => store.removeWidget(placement.id) },
    ]
  }

  function sizeItems(): MenuItem[] {
    return SIZE_NAMES.map((size) => ({
      label: capitalized(size),
      checked: size === placement.size,
      action: () => store.setWidgetSize(placement.id, size),
    }))
  }

  function capitalized(value: string): string {
    return value.slice(0, 1).toUpperCase() + value.slice(1)
  }
</script>

{#if View !== undefined}
  <gtkpressable
    overlay
    class={slotClass}
    halign="start"
    valign="start"
    margin-start={point.x}
    margin-top={point.y}
    width={placement.box.width}
    height={placement.box.height}
    input
    onpress={handlePress}
    ondragstart={startDrag}
    ondragmove={moveDrag}
    ondragend={endDrag}
  >
    <!-- The card is told its own size rather than measuring it: the store
         already holds it, and a change from the widget's context menu reaches
         the card as a prop instead of as a resize it has to observe. -->
    <View
      {bus}
      {registry}
      args={{
        size: placement.size,
        width: placement.box.width,
        height: placement.box.height,
      }}
      id={placement.id}
    />
  </gtkpressable>
{/if}
