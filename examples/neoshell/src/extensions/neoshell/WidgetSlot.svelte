<script lang="ts">
  import type { BusService } from '../../lib/bus'
  import type { ViewComponent, ViewRegistry } from '../../host/plugins/views'
  import { SIZE_NAMES } from './freeform'
  import type { Point, Rect, Size } from './freeform'
  import type { DesktopStore, MenuItem, WidgetPlacement } from './desktopStore.svelte'
  import { dragOf, pressOf, SECONDARY_BUTTON } from './gestures'
  import { glide } from './glide'
  import type { GlideStop } from './glide'

  // One widget on the desktop: the registered view for its type, placed by the
  // store and draggable unless it or the desktop is locked.
  //
  // A drag lifts the widget and lets it follow the pointer exactly, while a
  // placeholder marks where it would settle; on release it glides into that
  // spot — or back to where it came from when the spot is taken.

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

  // Where the widget is drawn while it is away from its point: under the
  // pointer during a drag, then along the glide back to a point.
  let loosePoint = $state<Point | null>(null)
  let moving = $state(false)
  let dragging = false
  let stopGlide: GlideStop = () => {}

  // Reading `generation` is what re-resolves the type when a widget provider's
  // views register after the desktop is already up.
  const View = $derived(viewFor(placement.type, generation))
  const point = $derived(shownPoint(placement, loosePoint))
  const slotClass = $derived(slotClassOf(moving))

  function viewFor(type: string, _generation: number): ViewComponent | undefined {
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
    settle()
    dragging = true
  }

  // The widget follows the pointer; the placeholder shows where it would
  // land, which is the store's answer — so the outline and the drop agree.
  function moveDrag(event: { detail: unknown }): void {
    if (!dragging) {
      return
    }
    const drag = dragOf(event)
    if (!moving && Math.hypot(drag.dx, drag.dy) < DRAG_THRESHOLD_PX) {
      return
    }
    moving = true
    const loose = { x: placement.point.x + drag.dx, y: placement.point.y + drag.dy }
    loosePoint = loose
    const landing = landingFor(loose)
    onpreview(landing, placement.box, store.widgetDropAllowed(placement.id, landing))
  }

  function endDrag(event: { detail: unknown; target: { widget: unknown } }): void {
    if (!dragging) {
      return
    }
    dragging = false
    const wasMoving = moving
    moving = false
    onpreview(null, placement.box, false)
    if (!wasMoving || loosePoint === null) {
      settle()
      return
    }
    const drag = dragOf(event)
    const loose = { x: placement.point.x + drag.dx, y: placement.point.y + drag.dy }
    const landing = landingFor(loose)
    // A refused drop — the pixels are taken — leaves the store as it was, and
    // the widget glides back to the point it still holds.
    store.moveWidget(placement.id, landing)
    glideFrom(loose, event.target.widget as Parameters<typeof glide>[0])
  }

  function landingFor(loose: Point): Point {
    return store.landingFor(loose, placement.box, [rectOfPlacement()])
  }

  // The store has already decided the point; the widget is carried from where
  // it was released to wherever that turned out to be.
  function glideFrom(from: Point, widget: Parameters<typeof glide>[0]): void {
    stopGlide()
    stopGlide = glide(
      widget,
      from,
      placement.point,
      (at) => {
        loosePoint = at
      },
      settle,
    )
  }

  function settle(): void {
    stopGlide()
    stopGlide = () => {}
    loosePoint = null
  }

  function rectOfPlacement(): Rect {
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
