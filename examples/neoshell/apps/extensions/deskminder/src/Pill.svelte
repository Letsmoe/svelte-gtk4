<script lang="ts">
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon'
  import DotsSixIcon from 'phosphor-svelte/lib/DotsSixIcon'
  import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVerticalIcon'
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon'
  import XIcon from 'phosphor-svelte/lib/XIcon'
  import DurationChip from './DurationChip.svelte'
  import PendingList from './PendingList.svelte'
  import {
    MAX_DRAG_MINUTES,
    clampMinutes,
    displayedMinutes,
    minutesFromDrag,
    resolvedDueAt,
  } from './duration'
  import type { Duration } from './duration'
  import { BAR_HEIGHT_PX, MAX_BOW_PX, bowedStadiumPath } from './barShape'
  import { DEFAULT_POINT, clampPoint, pointOf } from './placement'
  import type { Point } from './placement'
  import { autofocus, recordOf, remindersOf } from './lib'
  import type { BusLike, Reminder } from './lib'

  // The desktop reminder pill: a plus button that stretches into a duration
  // setter, settles into a pill you type the reminder into, and lists what is
  // still pending underneath.
  //
  // It lives on the background layer so it sits behind application windows,
  // and its node carries no size — the wrapper collapses to nothing and this
  // component positions itself, so the layer reserves only the pill's own
  // rectangle as its input region and stays click-through everywhere else.
  //
  // Where it sits is config's answer, under deskminder.pill; what it arms is
  // the deskminder backend's, over reminder:create.
  //
  // Both gestures run off window listeners rather than pointer capture: the
  // press that starts the stretch also swaps the plus button out for the bar,
  // and a captured pointer dies with the element it was captured on.

  const CALL_TIMEOUT_MS = 10000
  const DEFAULT_MINUTES = 15
  // Past this the press stopped being a click and became a drag.
  const CLICK_SLOP_PX = 4
  const BASE_WIDTH_PX = 200
  const STRETCH_PX = 260
  const TICK_MS = 1000

  type Mode = 'idle' | 'setting' | 'composing'

  interface Stretch {
    pointerId: number
    startX: number
    baseMinutes: number
    fromIdle: boolean
  }

  interface Move {
    pointerId: number
    offsetX: number
    offsetY: number
  }

  let { bus }: { bus: BusLike } = $props()

  let mode: Mode = $state('idle')
  let duration: Duration = $state({ kind: 'minutes', minutes: DEFAULT_MINUTES })
  let text = $state('')
  let editingClock = $state(false)
  let reminders: Reminder[] = $state([])
  let now = $state(Date.now())
  let storedPoint: Point = $state(DEFAULT_POINT)
  let dragPoint: Point | null = $state(null)
  let stretch: Stretch | null = $state(null)
  let move: Move | null = $state(null)
  let clusterWidth = $state(0)
  let clusterHeight = $state(0)
  let viewportWidth = $state(1920)
  let viewportHeight = $state(1080)

  // Whether the gesture has left the slop radius yet. Plain, not $state: it is
  // read inside the handlers only, and mutating it must not disturb the effect
  // that owns the window listeners.
  let stretchMoved = false

  const pending = $derived(reminders.filter((reminder) => reminder.firedAt === 0))
  const point = $derived(
    clampPoint(
      looseCurrentPoint(),
      { width: clusterWidth, height: clusterHeight },
      { width: viewportWidth, height: viewportHeight },
    ),
  )
  const stretchAmount = $derived(displayedMinutes(duration, now) / MAX_DRAG_MINUTES)
  const dragging = $derived(stretch !== null)
  const barWidthPx = $derived(BASE_WIDTH_PX + stretchAmount * STRETCH_PX)
  const barWidth = $derived(widthFor(mode, barWidthPx))
  const barClip = $derived(clipFor(dragging, barWidthPx, stretchAmount))

  $effect(() => {
    const unsubscribeReminders = bus.subscribe('reminders', (message) => {
      reminders = remindersOf(message.data)
    })
    const unsubscribeConfig = bus.subscribe('config', (message) => {
      applyConfig(message.data)
    })
    return () => {
      unsubscribeReminders()
      unsubscribeConfig()
    }
  })

  $effect(() => {
    const ticker = setInterval(() => {
      now = Date.now()
    }, TICK_MS)
    return () => clearInterval(ticker)
  })

  $effect(() => {
    const onResize = (): void => {
      viewportWidth = window.innerWidth
      viewportHeight = window.innerHeight
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })

  $effect(() => {
    if (stretch === null) {
      return
    }
    return windowGesture(moveStretch, endStretch)
  })

  $effect(() => {
    if (move === null) {
      return
    }
    return windowGesture(moveMove, endMove)
  })

  // A gesture lives on the window for as long as it runs, so it survives the
  // element it started on being swapped out mid-drag.
  function windowGesture(
    onMove: (event: PointerEvent) => void,
    onEnd: (event: PointerEvent) => void,
  ): () => void {
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }

  function looseCurrentPoint(): Point {
    if (dragPoint !== null) {
      return dragPoint
    }
    return storedPoint
  }

  // Only the setter is stretched; the composing pill is sized by its text
  // field, and an empty value lets the style directive drop the property.
  function widthFor(current: Mode, width: number): string {
    if (current !== 'setting') {
      return ''
    }
    return `${width}px`
  }

  // The waist pulls in as the bar is pulled out. An empty value leaves the
  // rounded-full class in charge, which is the shape it plops back into.
  function clipFor(active: boolean, width: number, amount: number): string {
    if (!active) {
      return ''
    }
    return bowedStadiumPath(width, BAR_HEIGHT_PX, amount * MAX_BOW_PX)
  }

  // A duration typed into the chip is settled the moment it parses, so it
  // moves straight on to the text the way releasing the drag does.
  function acceptTypedDuration(next: Duration): void {
    duration = next
    mode = 'composing'
  }

  // A config echo arriving mid-drag would yank the pill back to where it stood
  // before the drag started.
  function applyConfig(snapshot: unknown): void {
    if (move !== null) {
      return
    }
    storedPoint = pointOf(recordOf(recordOf(snapshot).deskminder).pill)
  }

  function startStretch(event: PointerEvent, baseMinutes: number, fromIdle: boolean): void {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    stretchMoved = false
    stretch = { pointerId: event.pointerId, startX: event.clientX, baseMinutes, fromIdle }
    mode = 'setting'
    editingClock = false
  }

  function moveStretch(event: PointerEvent): void {
    if (stretch === null || stretch.pointerId !== event.pointerId) {
      return
    }
    const deltaX = event.clientX - stretch.startX
    if (Math.abs(deltaX) > CLICK_SLOP_PX) {
      stretchMoved = true
    }
    const minutes = clampMinutes(stretch.baseMinutes + minutesFromDrag(deltaX))
    duration = { kind: 'minutes', minutes }
  }

  function endStretch(event: PointerEvent): void {
    if (stretch === null || stretch.pointerId !== event.pointerId) {
      return
    }
    const gesture = stretch
    stretch = null
    settleStretch(gesture)
  }

  // A press on the plus that never moved is a click: it opens the setter at a
  // usable default rather than arming a zero-minute reminder. A drag that came
  // back to zero is a cancellation. Anything else has a duration, so the text
  // is what comes next.
  function settleStretch(gesture: Stretch): void {
    if (gesture.fromIdle && !stretchMoved) {
      duration = { kind: 'minutes', minutes: DEFAULT_MINUTES }
      return
    }
    if (displayedMinutes(duration, Date.now()) === 0) {
      reset()
      return
    }
    mode = 'composing'
  }

  function startMove(event: PointerEvent): void {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    move = {
      pointerId: event.pointerId,
      offsetX: event.clientX - point.x,
      offsetY: event.clientY - point.y,
    }
    dragPoint = point
  }

  function moveMove(event: PointerEvent): void {
    if (move === null || move.pointerId !== event.pointerId) {
      return
    }
    dragPoint = { x: event.clientX - move.offsetX, y: event.clientY - move.offsetY }
  }

  function endMove(event: PointerEvent): void {
    if (move === null || move.pointerId !== event.pointerId) {
      return
    }
    move = null
    const dropped = { x: Math.round(point.x), y: Math.round(point.y) }
    storedPoint = dropped
    dragPoint = null
    void bus.call('config:set', { key: 'deskminder.pill', value: dropped }, CALL_TIMEOUT_MS)
  }

  async function submit(): Promise<void> {
    const dueAt = resolvedDueAt(duration, Date.now())
    if (dueAt <= Date.now()) {
      return
    }
    reset()
    await bus.call('reminder:create', { dueAt, text: text.trim() }, CALL_TIMEOUT_MS)
  }

  function reset(): void {
    mode = 'idle'
    duration = { kind: 'minutes', minutes: DEFAULT_MINUTES }
    text = ''
    editingClock = false
  }

  function handleComposeKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
    if (event.key === 'Escape') {
      reset()
    }
  }

  function cancel(id: string): void {
    void bus.call('reminder:cancel', { id }, CALL_TIMEOUT_MS)
  }
</script>

<div
  class="group fixed z-10 flex w-max items-center gap-2 text-base-content select-none"
  style:left={`${point.x}px`}
  style:top={`${point.y}px`}
  data-input-region
  bind:clientWidth={clusterWidth}
  bind:clientHeight={clusterHeight}
>
  {#if mode === 'idle'}
    <button
      class="flex size-9 cursor-grab items-center justify-center rounded-2xl bg-base-300/60 opacity-0 shadow-lg ring-1 ring-white/10 backdrop-blur-xl transition-opacity group-hover:opacity-100"
      type="button"
      title="Drag to move"
      onpointerdown={startMove}
    >
      <DotsSixIcon class="size-4" />
    </button>
    <button
      class="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-base-300/70 shadow-lg ring-1 ring-white/10 backdrop-blur-xl transition hover:bg-base-300/90 active:scale-95"
      type="button"
      title="New reminder"
      onpointerdown={(event) => startStretch(event, 0, true)}
    >
      <PlusIcon class="size-5" />
    </button>
  {:else}
    <button
      class="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-base-300/70 shadow-lg ring-1 ring-white/10 backdrop-blur-xl transition hover:bg-base-300/90"
      type="button"
      title="Discard"
      onclick={reset}
    >
      <XIcon class="size-5" />
    </button>
    <div
      class="flex h-11 items-center gap-2 rounded-full bg-base-300/70 px-3 ring-white/10 backdrop-blur-xl"
      class:shadow-lg={!dragging}
      class:ring-1={!dragging}
      class:drop-shadow-lg={dragging}
      class:min-w-72={mode === 'composing'}
      style:width={barWidth}
      style:clip-path={barClip}
    >
      <DurationChip
        {duration}
        {now}
        editing={editingClock}
        onduration={acceptTypedDuration}
        onedit={(editing) => (editingClock = editing)}
      />
      {#if mode === 'composing'}
        <input
          class="min-w-0 grow bg-transparent text-sm outline-none placeholder:opacity-40"
          type="text"
          placeholder="Reminder"
          bind:value={text}
          onkeydown={handleComposeKey}
          use:autofocus
        />
        <button
          class="flex size-7 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10"
          type="button"
          title="Set reminder"
          onclick={() => void submit()}
        >
          <ArrowUpIcon class="size-4" />
        </button>
      {:else}
        <button
          class="ml-auto flex h-full w-6 shrink-0 cursor-ew-resize items-center justify-center opacity-50 transition-opacity hover:opacity-100"
          type="button"
          title="Drag to set the duration"
          onpointerdown={(event) =>
            startStretch(event, displayedMinutes(duration, Date.now()), false)}
        >
          <DotsSixVerticalIcon class="size-4" />
        </button>
      {/if}
    </div>
  {/if}

  <PendingList reminders={pending} {now} oncancel={cancel} />
</div>
