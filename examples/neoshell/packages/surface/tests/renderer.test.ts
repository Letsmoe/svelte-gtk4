import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { describe, expect, test } from 'bun:test'
import { renderTree } from '../src/renderer.js'
import type { ViewNode } from '../src/renderer.js'
import { ViewRegistry } from '../src/viewRegistry.js'

// bun runs the suites in one process; another file may already have registered.
if (typeof document === 'undefined') {
  GlobalRegistrator.register()
}

function makeRegistry(events: string[]): ViewRegistry {
  const registry = new ViewRegistry()
  registry.register('demo.box', (element, args) => {
    element.textContent = String(args)
    events.push(`mount ${String(args)}`)
    return {
      dispose() {
        events.push(`dispose ${String(args)}`)
      },
    }
  })
  registry.register('demo.frame', (element) => {
    const inner = element.ownerDocument.createElement('section')
    element.appendChild(inner)
    events.push('mount frame')
    return {
      dispose() {
        events.push('dispose frame')
      },
      childrenHost: inner,
    }
  })
  return registry
}

describe('view registry', () => {
  test('duplicate registration throws, disposer frees the name', () => {
    const registry = new ViewRegistry()
    const unregister = registry.register('x', () => ({ dispose() {} }))
    expect(() => registry.register('x', () => ({ dispose() {} }))).toThrow('already registered')

    unregister()
    expect(() => registry.register('x', () => ({ dispose() {} }))).not.toThrow()
  })
})

describe('view tree renderer', () => {
  // A view that persists anything per instance — a widget's own settings —
  // addresses its config entry and its topic by the node's id.
  test('a view receives its node id, and an empty one when the node has none', () => {
    const seen: string[] = []
    const registry = new ViewRegistry()
    registry.register('demo.identified', (_element, _args, id) => {
      seen.push(id)
      return { dispose() {} }
    })
    const container = document.createElement('div')

    const dispose = renderTree(
      container,
      [{ id: 'weather-2', type: 'demo.identified' }, { type: 'demo.identified' }],
      registry,
    )

    expect(seen).toEqual(['weather-2', ''])
    dispose()
  })

  test('renders nested nodes into the declared children host', () => {
    const events: string[] = []
    const registry = makeRegistry(events)
    const container = document.createElement('div')
    const tree: ViewNode[] = [
      {
        type: 'demo.frame',
        children: [
          { type: 'demo.box', args: 'a' },
          { type: 'demo.box', args: 'b' },
        ],
      },
    ]

    const dispose = renderTree(container, tree, registry)

    const frame = container.querySelector('[data-view="demo.frame"]') as HTMLElement
    const section = frame.querySelector('section') as HTMLElement
    expect(section.querySelectorAll('[data-view="demo.box"]')).toHaveLength(2)
    expect(events).toEqual(['mount frame', 'mount a', 'mount b'])

    dispose()
    expect(container.childNodes).toHaveLength(0)
    expect(events.slice(3)).toEqual(['dispose b', 'dispose a', 'dispose frame'])
  })

  test('a view that places its own children renders them into its slots', () => {
    const events: string[] = []
    const registry = makeRegistry(events)
    const slots: HTMLElement[] = []
    registry.register('demo.canvas', (element) => {
      events.push('mount canvas')
      return {
        dispose() {
          events.push('dispose canvas')
        },
        childSlot(node) {
          const slot = element.ownerDocument.createElement('div')
          slot.dataset.slot = String(node.id)
          element.appendChild(slot)
          slots.push(slot)
          return slot
        },
      }
    })
    const container = document.createElement('div')
    const tree: ViewNode[] = [
      {
        type: 'demo.canvas',
        children: [
          { id: 'left', type: 'demo.box', args: 'a' },
          { id: 'right', type: 'demo.box', args: 'b' },
        ],
      },
    ]

    const dispose = renderTree(container, tree, registry)

    expect(slots.map((slot) => slot.dataset.slot)).toEqual(['left', 'right'])
    expect(slots[0].dataset.view).toBe('demo.box')
    expect(slots[0].dataset.viewId).toBe('left')
    expect(events).toEqual(['mount canvas', 'mount a', 'mount b'])

    dispose()
    expect(container.childNodes).toHaveLength(0)
    expect(slots[0].isConnected).toBe(false)
  })

  test('an unknown view type is skipped without breaking siblings', () => {
    const events: string[] = []
    const registry = makeRegistry(events)
    const container = document.createElement('div')

    const dispose = renderTree(
      container,
      [{ type: 'missing.view' }, { type: 'demo.box', args: 'ok' }],
      registry,
    )

    expect(events).toEqual(['mount ok'])
    expect(container.querySelectorAll('[data-view]')).toHaveLength(1)
    dispose()
  })
})
