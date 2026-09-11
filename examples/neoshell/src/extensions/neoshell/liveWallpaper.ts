import { isVideo } from '../files/backend.js'
import { recordOf } from '../../lib/record.js'
import { clampRate } from './livePlayer.js'

// What the wallpaper view decides about a live wallpaper, kept free of GTK and
// Svelte so each rule reads on its own.
//
// Config, under appearance.liveWallpaper:
//
//   speed              playback rate, 1 is real time
//   pauseOnFullscreen  hold the video while a fullscreen window is showing
//   pauseOnBattery     hold the video while the machine is on battery power

export interface LiveOptions {
  speed: number
  pauseOnFullscreen: boolean
  pauseOnBattery: boolean
}

export const DEFAULT_LIVE_OPTIONS: LiveOptions = {
  speed: 1,
  pauseOnFullscreen: true,
  pauseOnBattery: false,
}

export function isVideoPath(path: string): boolean {
  return path !== '' && isVideo(path)
}

export function liveOptionsOf(snapshot: unknown): LiveOptions {
  const section = recordOf(recordOf(recordOf(snapshot).appearance).liveWallpaper)
  return {
    speed: speedOf(section.speed),
    pauseOnFullscreen: boolOr(section.pauseOnFullscreen, DEFAULT_LIVE_OPTIONS.pauseOnFullscreen),
    pauseOnBattery: boolOr(section.pauseOnBattery, DEFAULT_LIVE_OPTIONS.pauseOnBattery),
  }
}

export function shouldPlay(
  options: LiveOptions,
  fullscreenShowing: boolean,
  onBattery: boolean,
): boolean {
  if (options.pauseOnFullscreen && fullscreenShowing) {
    return false
  }
  if (options.pauseOnBattery && onBattery) {
    return false
  }
  return true
}

// A fullscreen window pauses the wallpaper only while it is on screen: on the
// active workspace of some monitor, or on the special workspace shown over
// it. A fullscreen window on a workspace nobody is looking at does not count.
// The wallpaper window is not tied to a monitor, so every monitor counts.
export function fullscreenShowing(workspaces: unknown, monitors: unknown): boolean {
  const visible = visibleWorkspaceIds(monitors)
  if (!Array.isArray(workspaces)) {
    return false
  }
  return workspaces.some((workspace) => {
    const record = recordOf(workspace)
    return record.hasfullscreen === true && visible.has(idOf(record.id))
  })
}

function visibleWorkspaceIds(monitors: unknown): Set<number> {
  const ids = new Set<number>()
  if (!Array.isArray(monitors)) {
    return ids
  }
  for (const monitor of monitors) {
    const record = recordOf(monitor)
    ids.add(idOf(recordOf(record.activeWorkspace).id))
    const special = idOf(recordOf(record.specialWorkspace).id)
    if (special !== 0) {
      ids.add(special)
    }
  }
  return ids
}

// "Discharging" is the one state that means the machine is running down its
// battery: "Charging", "Full" and "Not charging" are all on mains power, and a
// desktop never publishes the topic at all.
export function onBatteryPower(battery: unknown): boolean {
  return recordOf(battery).status === 'Discharging'
}

function speedOf(value: unknown): number {
  if (typeof value !== 'number') {
    return DEFAULT_LIVE_OPTIONS.speed
  }
  return clampRate(value)
}

function boolOr(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return fallback
}

function idOf(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  return Number.NaN
}
