import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, FiberState } from '@neoworks/extension-system'
import systrayExtension from '../systray/backend.js'
import { iconSourceOf, menuEntriesOf, trayItemsOf } from '../systray/src/lib.js'
import { busProvider, FakeBus, waitFor } from './helpers.js'

// The daemon itself is D-Bus-bound and runs against a live session; here we
// verify the extension's supervision contract with a stand-in binary, and the
// item parsing the bar draws from.

const FAKE_DAEMON = `#!/bin/sh
trap 'rm -f "$TRAY_MARKER"; exit 0' TERM INT
touch "$TRAY_MARKER"
while true; do sleep 0.1; done
`

describe('systray extension', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-systray-test-'))
  const daemonPath = join(tempDir, 'fake-trayd')
  const markerPath = join(tempDir, 'running.marker')
  const root = new Context()
  const bus = new FakeBus()

  beforeAll(async () => {
    writeFileSync(daemonPath, FAKE_DAEMON)
    chmodSync(daemonPath, 0o755)
    process.env.TRAY_MARKER = markerPath
    await root.plugin(busProvider(bus))
  })

  afterAll(async () => {
    delete process.env.TRAY_MARKER
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('mount spawns the daemon, dispose kills its process group', async () => {
    const fiber = await root.plugin(systrayExtension, { daemonPath })
    expect(fiber.state).toBe(FiberState.ACTIVE)
    await waitFor(() => existsSync(markerPath))

    await fiber.dispose()
    await waitFor(() => !existsSync(markerPath))
  })

  test('a missing daemon binary fails the fiber instead of half-loading', async () => {
    const fiber = root.plugin(systrayExtension, {
      daemonPath: join(tempDir, 'does-not-exist'),
    })
    await fiber.then(undefined, () => {})

    expect(fiber.state).toBe(FiberState.FAILED)
  })
})

describe('systray items', () => {
  test('an entry without a key is dropped, since nothing could click it', () => {
    const items = trayItemsOf([{ key: 'org.kde.item/StatusNotifierItem' }, { id: 'orphan' }])

    expect(items).toHaveLength(1)
    expect(items[0].key).toBe('org.kde.item/StatusNotifierItem')
  })

  test('missing fields become empty rather than undefined', () => {
    const items = trayItemsOf([{ key: 'k', title: 'Vesktop', itemIsMenu: true }])

    expect(items[0].icon).toBe('')
    expect(items[0].iconData).toBe('')
    expect(items[0].itemIsMenu).toBe(true)
  })

  test('an item that implements no Activate is marked as menu-only', () => {
    const [ayatana, activatable] = trayItemsOf([
      { key: 'a', menuPath: '/Menu' },
      { key: 'b', hasActivate: true },
    ])

    expect(ayatana.hasActivate).toBe(false)
    expect(ayatana.menuPath).toBe('/Menu')
    expect(activatable.hasActivate).toBe(true)
  })

  test('an icon name resolves through the host, a data URL is used as is', () => {
    const [named, inlined] = trayItemsOf([
      { key: 'a', icon: 'discord' },
      { key: 'b', iconData: 'data:image/png;base64,AAA' },
    ])

    expect(iconSourceOf(named, 32)).toBe('/appicon/discord?size=32')
    expect(iconSourceOf(inlined, 32)).toBe('data:image/png;base64,AAA')
  })
})

describe('systray menus', () => {
  const LAYOUT = [
    { id: 1, label: 'Disconnect', enabled: true },
    { id: 2, separator: true },
    {
      id: 3,
      label: 'All connections',
      children: [{ id: 4, label: 'Germany', toggleType: 'radio', toggleState: 1 }],
    },
    { label: 'no id' },
  ]

  test('a row without an id is dropped, since nothing could be reported back', () => {
    expect(menuEntriesOf(LAYOUT)).toHaveLength(3)
  })

  test('submenus keep their nesting', () => {
    const submenu = menuEntriesOf(LAYOUT)[2]

    expect(submenu.children).toHaveLength(1)
    expect(submenu.children[0].label).toBe('Germany')
    expect(submenu.children[0].toggleState).toBe(1)
  })

  test('an absent enabled flag reads as enabled, an absent toggle as unset', () => {
    const [, , submenu] = menuEntriesOf(LAYOUT)

    expect(submenu.enabled).toBe(true)
    expect(submenu.toggleState).toBe(-1)
  })

  test('a separator survives as one', () => {
    expect(menuEntriesOf(LAYOUT)[1].separator).toBe(true)
  })
})
