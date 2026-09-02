import { describe, expect, test } from 'bun:test'
import {
  MARGIN_PX,
  TOP_PX,
  overlaps,
  sizePx,
  spanOf,
  unitOf,
} from '../neoshell/src/freeform.js'
import {
  entriesOf,
  instancesOf,
  nextWidgetId,
  occupiedRects,
  pointOf,
  resolveLayout,
  seedsOf,
  sorted,
  storedPointsOf,
} from '../neoshell/src/desktopLayout.js'
import type { LayoutInput, WidgetInstance } from '../neoshell/src/desktopLayout.js'

const VIEWPORT = { width: 1920, height: 1080 }
const UNIT = unitOf(VIEWPORT.width)
const SMALL = sizePx(UNIT, spanOf('small'))

const SEED = [
  { id: 'weather', type: 'weather.card', size: 'small' },
  { id: 'airquality', type: 'airquality.card', size: 'small' },
]

function entry(name: string, directory = false) {
  return { name, path: `/desktop/${name}`, directory, icon: 'text-x-generic', image: false }
}

function layoutOf(overrides: Partial<LayoutInput> = {}) {
  return resolveLayout({
    entries: [],
    storedIcons: {},
    instances: [],
    viewport: VIEWPORT,
    ...overrides,
  })
}

function instance(id: string, over: Partial<WidgetInstance> = {}): WidgetInstance {
  return { id, type: 'weather.card', size: 'small', locked: false, ...over }
}

describe('widget placement', () => {
  test('a widget with no stored point is placed against the right edge', () => {
    const layout = layoutOf({ instances: [instance('weather')] })
    const placement = layout.widgets.get('weather')

    expect(placement?.point.x).toBe(VIEWPORT.width - MARGIN_PX - SMALL.width)
    expect(placement?.point.y).toBe(TOP_PX)
  })

  test('a stored point is kept when nothing covers it', () => {
    const layout = layoutOf({ instances: [instance('weather', { point: { x: 700, y: 300 } })] })

    expect(layout.widgets.get('weather')?.point).toEqual({ x: 700, y: 300 })
  })

  test('a point off the desktop is brought back rather than dropped', () => {
    const layout = layoutOf({ instances: [instance('weather', { point: { x: 9000, y: 9000 } })] })
    const point = layout.widgets.get('weather')?.point

    expect(point?.x).toBeLessThan(VIEWPORT.width)
    expect(point?.y).toBeLessThan(VIEWPORT.height)
  })

  test('two widgets on the same point do not end up sharing it', () => {
    const layout = layoutOf({
      instances: [
        instance('weather', { point: { x: 700, y: 300 } }),
        instance('airquality', { point: { x: 700, y: 300 } }),
      ],
    })
    const first = layout.widgets.get('weather')
    const second = layout.widgets.get('airquality')

    expect(second?.point).not.toEqual(first?.point)
    expect(overlaps({ ...first!.point, ...first!.box }, { ...second!.point, ...second!.box })).toBe(
      false,
    )
  })

  test('a widget carries the type its config entry names', () => {
    const layout = layoutOf({ instances: [instance('weather-2', { type: 'airquality.card' })] })

    expect(layout.widgets.get('weather-2')?.type).toBe('airquality.card')
  })
})

describe('icon placement', () => {
  test('unplaced icons flow from the left, clear of the topbar', () => {
    const layout = layoutOf({ entries: [entry('a.txt')] })

    expect(layout.icons.get('/desktop/a.txt')).toEqual({ x: MARGIN_PX, y: TOP_PX })
  })

  test('icons never land on a widget', () => {
    const layout = layoutOf({
      entries: [entry('a.txt')],
      instances: [instance('weather', { point: { x: MARGIN_PX, y: TOP_PX } })],
    })
    const icon = layout.icons.get('/desktop/a.txt')

    expect(overlaps({ ...icon!, ...layout.iconSize }, { x: MARGIN_PX, y: TOP_PX, ...SMALL })).toBe(
      false,
    )
  })

  test('an icon whose stored point is now covered flows instead of overlapping', () => {
    const layout = layoutOf({
      entries: [entry('a.txt')],
      storedIcons: { '/desktop/a.txt': { x: 700, y: 300 } },
      instances: [instance('weather', { point: { x: 700, y: 300 } })],
    })

    expect(layout.icons.get('/desktop/a.txt')).not.toEqual({ x: 700, y: 300 })
  })

  test('two icons never take the same point', () => {
    const layout = layoutOf({ entries: [entry('a.txt'), entry('b.txt')] })

    expect(layout.icons.get('/desktop/a.txt')).not.toEqual(layout.icons.get('/desktop/b.txt'))
  })

  test('a drag excludes what it is moving from the collision map', () => {
    const layout = layoutOf({ entries: [entry('a.txt')], instances: [instance('weather')] })

    expect(occupiedRects(layout, new Set(), new Set())).toHaveLength(2)
    expect(occupiedRects(layout, new Set(['/desktop/a.txt']), new Set(['weather']))).toHaveLength(0)
  })
})

// Config is the record of which widgets exist; the view tree only seeds a
// desktop nobody has arranged yet.
describe('which widgets exist', () => {
  test('an absent config takes the view tree seed', () => {
    const instances = instancesOf(null, seedsOf(SEED), UNIT)

    expect(instances.map((entry) => entry.id)).toEqual(['weather', 'airquality'])
  })

  test('an emptied desktop stays empty rather than reseeding', () => {
    expect(instancesOf({}, seedsOf(SEED), UNIT)).toEqual([])
  })

  test('config wins over the seed once it exists', () => {
    const stored = { 'weather-2': { type: 'weather.card', size: 'large', x: 10, y: 20 } }
    const instances = instancesOf(stored, seedsOf(SEED), UNIT)

    expect(instances).toEqual([
      { id: 'weather-2', type: 'weather.card', size: 'large', point: { x: 10, y: 20 }, locked: false },
    ])
  })

  test('an entry with no type and no seed to name it is not a widget', () => {
    expect(instancesOf({ broken: { size: 'small' } }, [], UNIT)).toEqual([])
  })

  // Entries written before config carried the type hold only a placement. The
  // seed still knows what its own ids are, so an existing desktop keeps its
  // widgets instead of losing them the first time it is read.
  test('a typeless entry takes the type its seeded id names', () => {
    const stored = { weather: { column: 14, row: 0, size: 'large', locked: true } }
    const instances = instancesOf(stored, seedsOf(SEED), UNIT)

    expect(instances).toHaveLength(1)
    expect(instances[0].type).toBe('weather.card')
    expect(instances[0].size).toBe('large')
    expect(instances[0].locked).toBe(true)
    expect(instances[0].point).toEqual({
      x: MARGIN_PX + 14 * (UNIT + 8),
      y: TOP_PX,
    })
  })

  test('a seed entry missing an id or type is ignored', () => {
    expect(seedsOf([{ id: 'a' }, { type: 'b.card' }, 7])).toEqual([])
  })

  test('ids are named after the type, then numbered', () => {
    expect(nextWidgetId('weather.card', new Set())).toBe('weather')
    expect(nextWidgetId('weather.card', new Set(['weather']))).toBe('weather-2')
    expect(nextWidgetId('weather.card', new Set(['weather', 'weather-2']))).toBe('weather-3')
  })
})

// A desktop arranged before placement went free-form stored cells; reading one
// as its pixel origin is what carries that arrangement across.
describe('migrating a cell-based desktop', () => {
  test('a stored cell becomes the pixel origin it used to draw at', () => {
    expect(pointOf({ column: 0, row: 0 }, 96)).toEqual({ x: MARGIN_PX, y: TOP_PX })
    expect(pointOf({ column: 2, row: 1 }, 96)).toEqual({
      x: MARGIN_PX + 2 * 104,
      y: TOP_PX + 104,
    })
  })

  test('a pixel point is taken as it is', () => {
    expect(pointOf({ x: 12, y: 34, column: 9, row: 9 }, 96)).toEqual({ x: 12, y: 34 })
  })

  test('a record with neither is no placement at all', () => {
    expect(pointOf({}, 96)).toBeUndefined()
  })

  test('stored icons migrate as a map', () => {
    const points = storedPointsOf({ '/a': { column: 1, row: 0 }, '/b': { x: 5, y: 6 } }, 96)

    expect(points['/a']).toEqual({ x: MARGIN_PX + 104, y: TOP_PX })
    expect(points['/b']).toEqual({ x: 5, y: 6 })
  })
})

describe('desktop entries', () => {
  test('folders sort ahead of files either way', () => {
    const entries = [entry('b.txt'), entry('a', true), entry('a.txt')]

    expect(sorted(entries, 'name').map((item) => item.name)).toEqual(['a', 'a.txt', 'b.txt'])
  })

  test('sorting by type groups extensions but keeps folders first', () => {
    const entries = [entry('b.md'), entry('a.txt'), entry('z', true), entry('c.md')]

    expect(sorted(entries, 'type').map((item) => item.name)).toEqual([
      'z',
      'b.md',
      'c.md',
      'a.txt',
    ])
  })

  test('an entry without a name or path is not an entry', () => {
    expect(entriesOf([{ name: 'a' }, { path: '/a' }, 'nonsense'])).toEqual([])
  })
})
