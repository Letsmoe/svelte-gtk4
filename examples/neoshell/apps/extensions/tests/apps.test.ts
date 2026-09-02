import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@neoworks/extension-system'
import appsExtension from '../apps/backend.js'
import type { App } from '../apps/backend.js'
import { busProvider, FakeBus, waitFor } from './helpers.js'

const FIREFOX = `[Desktop Entry]
Type=Application
Name=Firefox
Exec=env MOZ_X=1 firefox %u
Icon=firefox
StartupWMClass=firefox
Categories=Network;WebBrowser;
`

const ALACRITTY = `[Desktop Entry]
Type=Application
Name=Alacritty
Exec=env TERM_X=1 alacritty %u
Icon=alacritty
StartupWMClass=alacritty
Categories=System;TerminalEmulator;
`

const HIDDEN = `[Desktop Entry]
Type=Application
Name=Sneaky
Exec=sneaky
NoDisplay=true
`

const SERVICE = `[Desktop Entry]
Type=Service
Name=Not An App
Exec=notanapp
`

const USER_OVERRIDE = `[Desktop Entry]
Type=Application
Name=Firefox (user)
Exec=firefox-dev
`

describe('apps extension', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'neoshell-apps-test-'))
  const userDir = join(tempDir, 'user')
  const systemDir = join(tempDir, 'system')
  const root = new Context()
  const bus = new FakeBus()

  beforeAll(async () => {
    mkdirSync(userDir, { recursive: true })
    mkdirSync(systemDir, { recursive: true })
    writeFileSync(join(userDir, 'firefox.desktop'), USER_OVERRIDE)
    writeFileSync(join(systemDir, 'firefox.desktop'), FIREFOX)
    writeFileSync(join(systemDir, 'alacritty.desktop'), ALACRITTY)
    writeFileSync(join(systemDir, 'sneaky.desktop'), HIDDEN)
    writeFileSync(join(systemDir, 'service.desktop'), SERVICE)

    await root.plugin(busProvider(bus))
    await root.plugin(appsExtension, { searchDirs: [userDir, systemDir] })
  })

  afterAll(async () => {
    await root.fiber.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('lists visible applications, deduped user-first, sorted by name', async () => {
    const apps = (await bus.call('apps:list', {})) as App[]

    expect(apps.map((app) => app.name)).toEqual(['Alacritty', 'Firefox (user)'])
    const firefox = apps[1]
    expect(firefox.id).toBe('firefox')
    expect(firefox.exec).toBe('firefox-dev')
  })

  test('strips field codes from Exec and parses categories', async () => {
    const apps = (await bus.call('apps:list', {})) as App[]
    const alacritty = apps[0]

    expect(alacritty.exec).toBe('env TERM_X=1 alacritty')
    expect(alacritty.categories).toEqual(['System', 'TerminalEmulator'])
    expect(alacritty.wmClass).toBe('alacritty')
  })

  test('launches a command detached and rejects an empty one', async () => {
    const markerPath = join(tempDir, 'launched.marker')
    const ok = (await bus.call('apps:launch', { command: `touch ${markerPath}` })) as {
      ok?: boolean
    }
    expect(ok.ok).toBe(true)
    await waitFor(() => existsSync(markerPath))

    const bad = (await bus.call('apps:launch', { command: '  ' })) as { error?: string }
    expect(bad.error).toContain('required')
  })
})
