import { subscribe } from './connection.svelte.js'

export function volume() {
  let state = $state({ volume: 0, muted: false })

  const unsub = subscribe('system:volume', (data) => {
    state.volume = data.volume
    state.muted   = data.muted
  })

  $effect(() => () => unsub())

  return state
}

export function battery() {
  // present stays false until the core broadcasts: it only emits system:battery
  // when /sys reports a BAT* supply, so no broadcast == no battery.
  let state = $state({ percent: 0, charging: false, status: '', present: false })

  const unsub = subscribe('system:battery', (data) => {
    state.percent  = data.percent
    state.charging = data.charging
    state.status   = data.status
    state.present  = true
  })

  $effect(() => () => unsub())

  return state
}