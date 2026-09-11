import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import type { Plugin } from '@neoworks/extension-system'
import { requireService } from '../../lib/services.js'
import { registerFunction } from '../../lib/bus.js'
import type { BusService } from '../../lib/bus.js'

// lock: the session lock's state, and its ties to logind.
//
//   lock.state     {locked}                retained
//   lock:lock      {}         → {ok}
//   lock:unlock    {}         → {ok}
//
// The state is the one source of truth: the view that holds the compositor
// lock and draws the lock surfaces follows it, and everything that wants the
// screen locked — the power menu's `loginctl lock-session`, a compositor
// keybind emitting lock:lock, hypridle — ends up setting it. logind's Lock and
// Unlock signals on this session are subscribed to so that all of those work
// without knowing about the bus, and the session's LockedHint is kept in step
// so `loginctl` reports it.

const LOGIND = 'org.freedesktop.login1'
const MANAGER_PATH = '/org/freedesktop/login1'
const MANAGER_IFACE = 'org.freedesktop.login1.Manager'
const SESSION_IFACE = 'org.freedesktop.login1.Session'
const PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties'
// logind resolves this to the caller's own session, or to the user's display
// session when the caller sits outside any session's cgroup (a shell started
// from a systemd user unit, say). Signals are emitted on the real path, so
// this one is only used to learn the session id.
const AUTO_SESSION_PATH = '/org/freedesktop/login1/session/auto'
const CALL_TIMEOUT_MS = 2000

const lockExtension: Plugin.Object = {
  name: 'lock',
  inject: ['bus'],
  apply(context) {
    const bus = requireService<BusService>(context, 'bus')
    const state = new LockState(bus)
    context.effect(() => state.start())
    context.effect(() => watchLogind(state))
    registerFunction(context, bus, 'lock:lock', () => {
      state.set(true)
      return { ok: true }
    })
    registerFunction(context, bus, 'lock:unlock', () => {
      state.set(false)
      return { ok: true }
    })
  },
}

export default lockExtension

class LockState {
  private readonly bus: BusService
  private locked = false
  private withdraw: () => void = () => {}
  private sessionPath: string | null = null

  constructor(bus: BusService) {
    this.bus = bus
  }

  start(): () => void {
    this.publish()
    return () => {
      this.withdraw()
      this.withdraw = () => {}
    }
  }

  set(locked: boolean): void {
    if (locked === this.locked) {
      return
    }
    this.locked = locked
    this.publish()
    this.setLockedHint(locked)
  }

  setSessionPath(path: string): void {
    this.sessionPath = path
  }

  private publish(): void {
    this.withdraw()
    this.withdraw = this.bus.retain('lock.state', { locked: this.locked })
  }

  private setLockedHint(locked: boolean): void {
    if (this.sessionPath === null) {
      return
    }
    Gio.DBus.system.call(
      LOGIND,
      this.sessionPath,
      SESSION_IFACE,
      'SetLockedHint',
      new GLib.Variant('(b)', [locked]),
      null,
      Gio.DBusCallFlags.NONE,
      CALL_TIMEOUT_MS,
      null,
      null,
    )
  }
}

// watchLogind resolves this process's session object and follows its Lock and
// Unlock signals. Without logind (no system bus, no session) the lock still
// works over the bus; only the loginctl path is missing.
function watchLogind(state: LockState): () => void {
  let subscription = 0
  let cancelled = false
  void resolveSessionPath().then((path) => {
    if (cancelled || path === null) {
      return
    }
    state.setSessionPath(path)
    subscription = subscribeToSession(Gio.DBus.system, path, state)
  })
  return () => {
    cancelled = true
    if (subscription !== 0) {
      Gio.DBus.system.signal_unsubscribe(subscription)
    }
  }
}

async function resolveSessionPath(): Promise<string | null> {
  try {
    const [boxedId] = (
      await callLogind(
        AUTO_SESSION_PATH,
        PROPERTIES_IFACE,
        'Get',
        new GLib.Variant('(ss)', [SESSION_IFACE, 'Id']),
        '(v)',
      )
    ).deepUnpack<[GLib.Variant]>()
    const id = boxedId.deepUnpack<string>()
    const [path] = (
      await callLogind(MANAGER_PATH, MANAGER_IFACE, 'GetSession', new GLib.Variant('(s)', [id]), '(o)')
    ).deepUnpack<[string]>()
    return path
  } catch (error) {
    console.warn('lock: no logind session for this process:', error)
    return null
  }
}

function callLogind(
  path: string,
  iface: string,
  method: string,
  args: GLib.Variant,
  replyType: string,
): Promise<GLib.Variant> {
  return new Promise((resolve, reject) => {
    Gio.DBus.system.call(
      LOGIND,
      path,
      iface,
      method,
      args,
      new GLib.VariantType(replyType),
      Gio.DBusCallFlags.NONE,
      CALL_TIMEOUT_MS,
      null,
      (connection, result) => {
        if (connection === null) {
          reject(new Error('no system bus'))
          return
        }
        try {
          resolve(connection.call_finish(result))
        } catch (error) {
          reject(error as Error)
        }
      },
    )
  })
}

function subscribeToSession(
  connection: Gio.DBusConnection,
  path: string,
  state: LockState,
): number {
  return connection.signal_subscribe(
    LOGIND,
    SESSION_IFACE,
    null,
    path,
    null,
    Gio.DBusSignalFlags.NONE,
    (_connection, _sender, _path, _iface, signal) => {
      if (signal === 'Lock') {
        state.set(true)
      } else if (signal === 'Unlock') {
        state.set(false)
      }
    },
  )
}
