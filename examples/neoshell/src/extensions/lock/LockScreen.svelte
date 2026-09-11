<script lang="ts">
  import type Gdk from 'gi://Gdk?version=4.0'
  import SessionLock from 'gi://Gtk4SessionLock?version=1.0'
  import { untrack } from 'svelte'
  import { subscribeTo } from '../../lib/bus'
  import { recordOf } from '../../lib/record'
  import type { ViewProps } from '../../host/plugins/views'
  import LockSurface from './LockSurface.svelte'

  // The lock screen's windows. A detached view: it renders no window of its
  // own — while the session is locked it holds the compositor lock and puts
  // one session-lock surface on every monitor the lock reports, and while it
  // is not it renders nothing.
  //
  // The windows follow the lock, not the state. Destroying a lock surface
  // while the lock is held is a protocol error, and the library destroys the
  // surfaces itself when the lock ends, so the state flipping off calls
  // unlock() and the windows leave on the ::unlocked signal — the root's own
  // destroy on removal finds an already destroyed toplevel and does nothing.

  let { bus, registry }: ViewProps = $props()

  let locked = $state(false)
  let instance = $state.raw<SessionLock.Instance | null>(null)
  let monitors = $state.raw<Gdk.Monitor[]>([])

  $effect(() =>
    subscribeTo(bus, 'lock.state', (message) => {
      locked = recordOf(message.data).locked === true
    }),
  )

  $effect(() => {
    if (locked) {
      untrack(acquire)
    } else {
      untrack(release)
    }
  })

  $effect(() => () => release())

  function acquire(): void {
    if (instance !== null) {
      return
    }
    if (!SessionLock.is_supported()) {
      console.error('lock: the compositor does not support ext-session-lock-v1')
      requestUnlock()
      return
    }
    const next = new SessionLock.Instance()
    next.connect('monitor', (_self, monitor) => {
      monitors = [...monitors, monitor]
    })
    next.connect('failed', () => {
      console.error('lock: the compositor refused the lock (is another locker running?)')
      clear()
      requestUnlock()
    })
    // Fires for our own unlock() and for one the compositor does; either way
    // the surfaces are gone and the state has to say so.
    next.connect('unlocked', () => {
      clear()
      requestUnlock()
    })
    instance = next
    next.lock()
  }

  function release(): void {
    if (instance !== null) {
      instance.unlock()
    }
  }

  function clear(): void {
    monitors = []
    instance = null
  }

  function requestUnlock(): void {
    bus.publish('lock:unlock', {})
  }
</script>

{#if instance !== null}
  {#each monitors as monitor (monitor)}
    <gtkwindow lock={{ instance, monitor }} decorated={false}>
      <LockSurface {bus} {registry} onunlock={release} />
    </gtkwindow>
  {/each}
{/if}
