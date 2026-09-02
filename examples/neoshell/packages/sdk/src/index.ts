import * as hyprland from './hyprland.svelte.js'
import * as system from './system.svelte.js'
import * as shell from './shell.svelte.js'
import * as surface from './surfaces.svelte.js'
export { socket } from './socket.svelte.js'
export { connection, subscribe } from './connection.svelte.js'

export { hyprland, system, shell, surface }

// config helper — identity fn, exists for editor types only
export function defineConfig(config) {
  return config
}