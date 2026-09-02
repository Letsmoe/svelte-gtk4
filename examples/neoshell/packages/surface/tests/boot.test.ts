import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { describe, expect, test } from 'bun:test'
import { inputRectsOf, positionWrapper } from '../src/boot.js'

// bun runs the suites in one process; another file may already have registered.
if (typeof document === 'undefined') {
  GlobalRegistrator.register()
}

const DOCK_ARGS = {
  anchors: ['bottom', 'left', 'right'],
  height: 76,
  reveal: 'hover',
  revealSize: 4,
}

describe('wrapper positioning', () => {
  test('anchors and size become fixed positioning', () => {
    const element = document.createElement('div')
    positionWrapper(element, { anchors: ['top', 'left', 'right'], height: 36 })

    expect(element.style.position).toBe('fixed')
    expect(element.style.top).toBe('0px')
    expect(element.style.bottom).toBe('')
    expect(element.style.height).toBe('36px')
  })

  test('a hover-reveal node collapses to its hot strip until the pointer enters', () => {
    const element = document.createElement('div')
    positionWrapper(element, DOCK_ARGS)
    expect(element.style.height).toBe('4px')

    element.dispatchEvent(new Event('pointerenter'))
    expect(element.style.height).toBe('76px')

    element.dispatchEvent(new Event('pointerleave'))
    expect(element.style.height).toBe('4px')
  })

  test('a centred node is shifted onto the axis it does not span', () => {
    const element = document.createElement('div')
    positionWrapper(element, { anchors: ['top'], align: 'center' })

    expect(element.style.top).toBe('0px')
    expect(element.style.left).toBe('50%')
    expect(element.style.transform).toBe('translateX(-50%)')
    expect(element.style.width).toBe('max-content')
    expect(element.style.height).toBe('')
  })

  test('centring keeps a size the node declared itself', () => {
    const element = document.createElement('div')
    positionWrapper(element, { anchors: ['top'], width: 240, align: 'center' })

    expect(element.style.width).toBe('240px')
  })

  test('centring leaves a node that spans both axes alone', () => {
    const element = document.createElement('div')
    positionWrapper(element, { anchors: ['top', 'left', 'right'], height: 36, align: 'center' })

    expect(element.style.left).toBe('0px')
    expect(element.style.transform).toBe('')
  })

  // A wrapper anchored to every edge is a full-screen transparent box, and it
  // is stacked over the nodes listed before it — a popover node that reached
  // for edge-to-edge to place a scrim would swallow the bar's clicks. Nodes
  // that draw their own fixed overlay must anchor on one edge instead.
  test('a single-anchor node does not stretch across the output', () => {
    const element = document.createElement('div')
    positionWrapper(element, { anchors: ['top'] })

    expect(element.style.top).toBe('0px')
    expect(element.style.bottom).toBe('')
    expect(element.style.left).toBe('')
    expect(element.style.right).toBe('')
    expect(element.style.width).toBe('')
    expect(element.style.height).toBe('')
  })

  test('an unmarked wrapper reserves its whole box', () => {
    const wrapper = document.createElement('div')
    wrapper.appendChild(document.createElement('div'))

    expect(inputRectsOf(wrapper)).toHaveLength(1)
  })

  test('a wrapper reserves only the parts the view marked', () => {
    const wrapper = document.createElement('div')
    for (const marked of [true, false, true]) {
      const child = document.createElement('div')
      if (marked) {
        child.setAttribute('data-input-region', '')
      }
      wrapper.appendChild(child)
    }

    expect(inputRectsOf(wrapper)).toHaveLength(2)
  })

  test('a side-anchored hover-reveal node collapses along its width', () => {
    const element = document.createElement('div')
    positionWrapper(element, { anchors: ['left', 'top', 'bottom'], width: 200, reveal: 'hover' })

    expect(element.style.width).toBe('4px')
    element.dispatchEvent(new Event('pointerenter'))
    expect(element.style.width).toBe('200px')
  })
})
