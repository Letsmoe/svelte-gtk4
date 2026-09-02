import type { Context, Fiber, Plugin } from '@neoworks/extension-system'
import { SIZE_NAMES } from './freeform'
import type { Point, Rect, Size } from './freeform'
import type { DesktopStore, MenuItem, WidgetPlacement } from './desktopStore.svelte'

// WidgetCanvas is the desktop's widget layer. Which widgets exist is config's
// answer, so the canvas mounts them itself rather than receiving them as view
// tree children: one child fiber per instance, whose effect owns the slot
// element and the mounted view. Removing a widget disposes its fiber and the
// kernel unwinds both — the canvas keeps no teardown of its own.
//
// Placement is free-form and lives in the store, which shares the desktop with
// the icons, so a widget can never be dropped on something already there.

export interface ViewInstance {
  dispose(): void
}

export interface ViewRegistryLike {
  resolve(type: string): ((element: HTMLElement, args: unknown, id: string) => ViewInstance) | undefined
  onChange(listener: () => void): () => void
}

interface Slot {
  id: string
  type: string
  fiber: Fiber
  element: HTMLElement | null
}

// A drag is armed by the press and only becomes one once the pointer has
// travelled: until then the press still belongs to the widget, so a click on a
// control inside it does what the control says.
//
// Only the press is heard through the widget. Everything after it is tracked on
// the window, because a slot that has to receive its own moves depends on the
// pointer staying inside it and on nothing in the widget swallowing the event —
// neither of which the canvas controls.
interface Drag {
  slot: Slot
  pointerId: number
  offsetX: number
  offsetY: number
  startX: number
  startY: number
  point: Point
  moving: boolean
  untrack: () => void
}

const DRAG_THRESHOLD_PX = 4
// The lift is the drag's own feedback: a widget sitting still casts nothing,
// and the shadow arrives fast enough to read as a response to the grab rather
// than as an animation of its own.
const SLOT_CLASS =
  'absolute touch-none select-none pointer-events-auto rounded-3xl' +
  ' transition-shadow duration-100 ease-out'
const DRAGGING_CLASSES = ['z-10', 'cursor-grabbing', 'shadow-2xl']
const PREVIEW_CLASS = 'pointer-events-none absolute rounded-3xl border-2'
// Faint where the drop would be refused, since the widget will spring back.
const PREVIEW_FREE_CLASS = 'border-white/80'
const PREVIEW_TAKEN_CLASS = 'border-white/20'

// Long enough for an extension's views bundle to finish loading into this
// surface, short enough that a genuinely missing type is reported while the
// cause is still obvious.
const MISSING_TYPE_GRACE_MS = 3000

export class WidgetCanvas {
  private readonly host: HTMLElement
  private readonly store: DesktopStore
  private readonly context: Context
  private readonly ui: ViewRegistryLike
  private readonly slots = new Map<string, Slot>()
  private readonly reported = new Set<string>()
  private drag: Drag | null = null
  private preview: HTMLElement | null = null

  constructor(host: HTMLElement, store: DesktopStore, context: Context, ui: ViewRegistryLike) {
    this.host = host
    this.store = store
    this.context = context
    this.ui = ui
  }

  // reconcile brings the mounted set in line with the store, then repositions
  // what survived. The store calls it whenever config or the resolved layout
  // changes, since this layer is plain DOM and sees none of Svelte's
  // reactivity; the view registry calls it too, because a widget whose type
  // had not loaded yet becomes mountable the moment it registers.
  reconcile(): void {
    const placements = this.store.widgetPlacements()
    this.withdrawMissing(new Set(placements.map((placement) => placement.id)))
    for (const placement of placements) {
      this.sync(placement)
    }
  }

  private withdrawMissing(live: ReadonlySet<string>): void {
    for (const [id, slot] of [...this.slots]) {
      if (!live.has(id)) {
        this.slots.delete(id)
        void slot.fiber.dispose()
      }
    }
  }

  // A widget that changed type is a different widget: its fiber goes and a new
  // one takes its place. Size and position are styling, and never remount.
  private sync(placement: WidgetPlacement): void {
    const existing = this.slots.get(placement.id)
    if (existing !== undefined && existing.type !== placement.type) {
      this.slots.delete(placement.id)
      void existing.fiber.dispose()
    }
    if (!this.slots.has(placement.id)) {
      this.mount(placement)
    }
    this.place(placement)
  }

  // An unresolvable type is not necessarily an error yet: the extension's views
  // bundle may still be loading, and the registry's change notification brings
  // the widget in when it arrives. It is reported once the wait has clearly
  // stopped being a wait.
  private mount(placement: WidgetPlacement): void {
    const factory = this.ui.resolve(placement.type)
    if (factory === undefined) {
      this.reportMissing(placement.type)
      return
    }
    const slot: Slot = { id: placement.id, type: placement.type, fiber: null as never, element: null }
    slot.fiber = this.context.plugin(
      widgetPlugin({
        id: placement.id,
        host: this.host,
        factory,
        onElement: (element) => this.adopt(slot, element),
      }),
    )
    this.slots.set(placement.id, slot)
  }

  private reportMissing(type: string): void {
    if (this.reported.has(type)) {
      return
    }
    this.reported.add(type)
    setTimeout(() => {
      if (this.ui.resolve(type) === undefined) {
        console.error(`neoshell: no view registered for widget type "${type}"`)
      }
    }, MISSING_TYPE_GRACE_MS)
  }

  private adopt(slot: Slot, element: HTMLElement | null): void {
    slot.element = element
    if (element === null) {
      return
    }
    this.listen(slot, element)
    const placement = this.store.widgetPlacement(slot.id)
    if (placement !== undefined) {
      this.place(placement)
    }
  }

  private listen(slot: Slot, element: HTMLElement): void {
    element.addEventListener('pointerdown', (event) => this.startDrag(slot, event))
    element.addEventListener('contextmenu', (event) => this.openMenu(slot, event))
    // The press is left alone so clicks survive, which also leaves the native
    // image and text drags armed.
    element.addEventListener('dragstart', (event) => event.preventDefault())
  }

  private place(placement: WidgetPlacement): void {
    const element = this.slots.get(placement.id)?.element
    if (element === undefined || element === null) {
      return
    }
    element.style.left = `${placement.point.x}px`
    element.style.top = `${placement.point.y}px`
    element.style.width = `${placement.box.width}px`
    element.style.height = `${placement.box.height}px`
  }

  private startDrag(slot: Slot, event: PointerEvent): void {
    // Always swallowed: a press that reaches the desktop under a widget would
    // start a rubber band across it.
    event.stopPropagation()
    if (event.button !== 0 || !this.store.widgetDraggable(slot.id)) {
      return
    }
    const placement = this.store.widgetPlacement(slot.id)
    if (placement === undefined || slot.element === null) {
      return
    }
    if (this.drag !== null) {
      this.abandon(this.drag)
    }
    this.drag = {
      slot,
      pointerId: event.pointerId,
      offsetX: event.clientX - placement.point.x,
      offsetY: event.clientY - placement.point.y,
      startX: event.clientX,
      startY: event.clientY,
      point: placement.point,
      moving: false,
      untrack: this.trackPointer(),
    }
  }

  private trackPointer(): () => void {
    const onMove = (event: PointerEvent) => this.moveDrag(event)
    const onEnd = (event: PointerEvent) => this.endDrag(event)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }

  // The widget follows the pointer; the preview shows where it would land,
  // which is the store's answer — so the guides, the outline and the drop all
  // agree.
  private moveDrag(event: PointerEvent): void {
    const drag = this.dragFor(event)
    if (drag === null) {
      return
    }
    const placement = this.store.widgetPlacement(drag.slot.id)
    // The widget went away under the drag — removed, or its type reloaded.
    if (drag.slot.element === null || placement === undefined) {
      this.abandon(drag)
      return
    }
    if (!drag.moving && !this.beginMoving(drag, event)) {
      return
    }
    const loose = { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY }
    drag.point = this.store.snapWithoutGuides(loose, placement.box, [rectFor(placement)])
    drag.slot.element.style.left = `${loose.x}px`
    drag.slot.element.style.top = `${loose.y}px`
    const allowed = this.store.widgetDropAllowed(drag.slot.id, drag.point)
    this.showPreview(drag.point, placement.box, allowed)
  }

  private abandon(drag: Drag): void {
    drag.untrack()
    this.drag = null
    this.hidePreview()
  }

  private beginMoving(drag: Drag, event: PointerEvent): boolean {
    if (!travelled(drag, event)) {
      return false
    }
    drag.moving = true
    drag.slot.element?.classList.add(...DRAGGING_CLASSES)
    return true
  }

  private endDrag(event: PointerEvent): void {
    const drag = this.dragFor(event)
    if (drag === null) {
      return
    }
    drag.untrack()
    this.drag = null
    if (!drag.moving) {
      return
    }
    this.finishMove(drag)
  }

  private finishMove(drag: Drag): void {
    this.hidePreview()
    drag.slot.element?.classList.remove(...DRAGGING_CLASSES)
    suppressNextClick(drag.slot.element)
    // A rejected drop — the pixels are taken — falls back to place(), which
    // puts the widget back where the store still says it lives.
    this.store.moveWidget(drag.slot.id, drag.point)
    const placement = this.store.widgetPlacement(drag.slot.id)
    if (placement !== undefined) {
      this.place(placement)
    }
  }

  // The outline is inserted before the slots so it sits under the widget being
  // carried over it.
  private showPreview(point: Point, box: Size, allowed: boolean): void {
    if (this.preview === null) {
      this.preview = document.createElement('div')
      this.host.insertBefore(this.preview, this.host.firstChild)
    }
    this.preview.className = `${PREVIEW_CLASS} ${outlineClass(allowed)}`
    this.preview.style.left = `${point.x}px`
    this.preview.style.top = `${point.y}px`
    this.preview.style.width = `${box.width}px`
    this.preview.style.height = `${box.height}px`
  }

  private hidePreview(): void {
    this.preview?.remove()
    this.preview = null
  }

  private dragFor(event: PointerEvent): Drag | null {
    if (this.drag === null || this.drag.pointerId !== event.pointerId) {
      return null
    }
    return this.drag
  }

  private openMenu(slot: Slot, event: MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
    this.store.openMenu(event.clientX, event.clientY, this.menuItems(slot.id))
  }

  private menuItems(id: string): MenuItem[] {
    const placement = this.store.widgetPlacement(id)
    if (placement === undefined) {
      return []
    }
    return [
      { label: 'Edit Widgets', action: () => this.store.openGallery() },
      { separator: true },
      {
        label: 'Locked',
        checked: placement.locked,
        disabled: this.store.desktopLocked,
        action: () => this.store.setWidgetLocked(id, !placement.locked),
      },
      { label: 'Size', children: this.sizeItems(id, placement.size) },
      { separator: true },
      { label: 'Remove Widget', danger: true, action: () => this.store.removeWidget(id) },
    ]
  }

  private sizeItems(id: string, current: string): MenuItem[] {
    return SIZE_NAMES.map((size) => ({
      label: capitalized(size),
      checked: size === current,
      action: () => this.store.setWidgetSize(id, size),
    }))
  }
}

interface WidgetOptions {
  id: string
  host: HTMLElement
  factory: (element: HTMLElement, args: unknown, id: string) => ViewInstance
  onElement: (element: HTMLElement | null) => void
}

// One fiber per widget instance. The effect owns the slot element and the view
// mounted into it, so disposing the fiber is the whole of removing a widget —
// there is no teardown path that can drift from the setup one.
function widgetPlugin(options: WidgetOptions): Plugin.Object {
  return {
    name: `widget:${options.id}`,
    apply(context) {
      context.effect(() => mountWidget(options), `widget ${options.id}`)
    },
  }
}

function mountWidget(options: WidgetOptions): () => void {
  const element = document.createElement('div')
  element.className = SLOT_CLASS
  element.dataset.widgetId = options.id
  options.host.appendChild(element)
  options.onElement(element)
  const instance = options.factory(element, {}, options.id)
  return () => {
    instance.dispose()
    element.remove()
    options.onElement(null)
  }
}

function rectFor(placement: WidgetPlacement): Rect {
  return {
    x: placement.point.x,
    y: placement.point.y,
    width: placement.box.width,
    height: placement.box.height,
  }
}

function outlineClass(allowed: boolean): string {
  if (allowed) {
    return PREVIEW_FREE_CLASS
  }
  return PREVIEW_TAKEN_CLASS
}

function travelled(drag: Drag, event: PointerEvent): boolean {
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX
}

// The press was never swallowed, so releasing over a control would activate it.
// The click follows the release before any timer runs, so the listener that
// eats it is gone again by the next task either way.
function suppressNextClick(element: HTMLElement | null): void {
  if (element === null) {
    return
  }
  const swallow = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  element.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => element.removeEventListener('click', swallow, { capture: true }), 0)
}

function capitalized(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}
