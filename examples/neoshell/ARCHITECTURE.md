# neoshell architecture

Target design, decided 2026-08-20. Not what the tree currently contains — see
*Migration* for the distance between the two.

## What neoshell is

An easily extensible Linux desktop shell. Everything a user sees is contributed
by an extension. The runtime distributes data and manages lifecycles; it has no
opinion about bars, docks, notifications, or anything else on screen.

Neoworks ships a default configuration that is Apple-inspired. That default is a
config profile made of ordinary extensions, holding no privilege over anything a
third party writes.

## Principles

1. **The runtime knows nothing about features.** No timers, no app launcher, no
   notification logic, no compositor specifics compiled in.
2. **Data is opaque.** The router forwards `{type, data}`. It never parses
   `data`, never validates it, never knows what type names mean.
3. **Extensions declare dependencies, never load order.** A plugin names the
   services it needs and waits for them.
4. **Every registration is reversible.** When a plugin stops, everything it
   registered is undone by the runtime, not by the plugin.
5. **Composition lives in config.** Changing what runs, or what is on screen, is
   never a code change.
6. **Don't wrap primitives.** If `.desktop` files, `gio launch`, or portals
   already do it, an extension calls them. The runtime does not re-expose them.

## The kernel

[@neoworks/extension-system](https://github.com/neoworks-dev/extension-system),
a Cordis-derived plugin kernel with zero runtime dependencies. One TypeScript
package, imported by both the host and every webview — one fiber state machine,
one effect tracker, tested once, never mirrored across languages. It is a local
package linked in with `bun link @neoworks/extension-system`.

What neoshell builds on:

- flat mount list with per-entry `disabled` and `config`
- `inject` dependency resolution: a plugin mounts when its needs are available,
  unloads transitively when a provider goes away, reloads when it returns.
  Resolution is by provider identity, so an unrelated context change is not a
  reload
- reversible effects: everything registered through `ctx` carries a disposer the
  kernel runs on unload
- child fibers (`ctx.plugin`), disposed with their parent
- ordered async disposal: children before parents, effects in reverse
  registration order, `await fiber.dispose()` means finished
- inactive-context guard: `ctx.effect` on a disposed fiber throws instead of
  silently leaking a registration past teardown

The kernel offers more than neoshell uses — isolation scopes, per-consumer
service interception, five event dispatch modes, Standard Schema config
validation. Reach for those only when something needs them.

The known-hard parts are the async races — an effect registered while disposal
is already running, transitive unload ordering, use-after-dispose. The kernel
carries its own tests for these; they are the entire reason hot-reload and
crash-recovery can be trusted, which is the product claim "easily extensible"
rests on.

## Processes

```
neoshell-host  (TypeScript/Bun — kernel root)
├─ mounts extensions, resolves inject, tracks and reverts registrations
├─ routes the bus (unix socket + WebSocket, retained topics)
├─ serves /plugins/<id>/ over HTTP; owns the config file
├─ spawns extension daemons (any language) as effects
└─ drives ──► neoshell-render (C++/WPE)
                └─ one webview per layer ──► kernel child contexts
```

- **host** — exactly one. The only lifecycle authority.
- **render** — the existing standalone `neoshell-render`, driven over its
  control socket.
- **daemons** — zero or more, any language, each owned by the extension that
  spawned it.

The Go core is removed entirely. Its surviving responsibilities — routing,
config, static serving, driving the render host — move into the host. Costs
accepted with eyes open: Bun becomes a system dependency in the PKGBUILD, and
the host idles heavier than a Go binary would.

## Extensions

An extension contributes **functions** (callable by anything) and **views**
(UI). Either, neither, or both.

```json
{
  "id": "vpn",
  "provides": ["vpn"],
  "inject": ["config", "hypr"],
  "backend": "./backend.js",
  "views": "./views.js"
}
```

`provides` and `inject` drive startup. The host does not mount an extension
until everything in `inject` is available. No boot ordering exists anywhere in
the system.

The manifest declares only what the extension *offers*. It never declares
windows — that is the view tree's job.

### Backend half — hybrid execution

Default: a TypeScript module mounted in the host. A shell accumulates small
system readers — battery, brightness, network, media — and webviews cannot read
`/sys` or speak D-Bus, so every one of them needs backend code somewhere. In
process, each is ~30 lines instead of a supervised binary.

```typescript
export const inject = ['config']

export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(publishBatteryLevel, 10_000)
    return () => clearInterval(timer)
  })

  ctx.fn('vpn:connect', async ({ profile }) => { /* … */ })
}
```

Escape hatch: work that is heavy, native, or not TypeScript runs as a daemon
the backend spawns as an effect — so it dies with the plugin:

```typescript
ctx.effect(() => {
  const proc = spawn('neoshell-whisperd')
  return () => proc.kill()
})
```

Daemons speak the bus protocol over the unix socket, in any language.

`ctx.fn` registrations are announced on the bus, not compiled in. Calling one is
request/reply; the host routes and owns no feature code.

In-process extensions trade some crash isolation for cheapness: the kernel
contains JS errors, but native-module crashes take the host down. Heavy or
untrusted work belongs in a daemon.

### View half

A JS module fetched over HTTP from `/plugins/<id>/` — code never travels
through the bus — and mounted in a webview as a **child fiber of the host-side
plugin**:

```typescript
export const inject = ['ui', 'bus']

export function apply(ctx: Context) {
  ctx.ui.register('vpn.indicator', VpnIndicator)
  ctx.effect(() => ctx.bus.on('vpn.state', update))
  ctx.plugin(VpnDetailPanel)
}
```

Mount protocol between host and surface:

```
host → surface   {"mount": {"fiber": "f7", "url": "/plugins/vpn/views.js",
                            "config": {…}}}
surface          const mod = await import(url); mod.apply(childCtx)
surface → host   {"fiber": "f7", "state": "active"}

host → surface   {"dispose": "f7"}
surface          runs f7's disposers; components leave the DOM
surface → host   {"fiber": "f7", "state": "disposed"}
```

One extension, one lifecycle, two execution sites. The host resolves
dependencies before sending mount commands and drives remounts, so the daemon
crashing disposes the whole plugin and the indicator leaves the bar through the
same path — no separate UI teardown exists.

The remote-fiber bridge (a fiber whose execution site is another process that
can crash independently) is the one piece no upstream kernel models. It is ours
either way; sharing one kernel codebase across the socket keeps it smallest.

## The bus

```json
{"type": "vpn.state", "data": {"connected": true}, "retain": true}
{"subscribe": ["vpn.*", "hypr.windows"]}
{"type": "vpn:connect", "data": {…}, "replyTo": "r-42"}
{"type": "r-42", "data": {…}}
```

Subscribe, publish (optionally retained), request/reply. One protocol whether
the peer is a daemon on the unix socket, a webview on the WebSocket, or
`neoshell emit` from a keybind.

**Retained topics:** a publish marked `retain: true` has its last raw bytes
cached per topic and replayed to every later subscriber. This is how a view
mounted now sees the battery level published a minute ago, without a
fetch-then-subscribe race. The router caches opaque bytes; it still parses
nothing. Retained values owned by a plugin are dropped when it unloads —
registration rule 4, applied to data.

A malformed payload is the receiver's problem: ignore, report on an error
topic. A router with opinions about payloads becomes a schema registry.

Broadcast and request/reply only. Waterfall interception (do-not-disturb
swallowing notifications before others see them) is deferred until something
needs it.

## Surfaces

Two compositor constraints set the floor:

- **Layer.** The desktop sits behind application windows (`background`); the
  bar sits in front (`top`/`overlay`). One `wl_surface`, one layer.
- **Exclusive zone.** A layer surface reserves space on one edge.

So: **one webview per layer**, never one per plugin. A VPN indicator must not
cost a WebKit instance. Exclusive zones are reserved by contentless layer
surfaces; the `top` webview is a single fullscreen surface with a carved input
region (the region/keyboard plumbing already exists in the render-host
protocol). Bar, dock, and notch share one webview. Each webview runs one kernel
context, parented to the host's.

## Configuration

Two documents with different semantics. Installing an extension must not put
something on screen; rearranging the screen must not start or stop processes.

**Mount list — what runs.** Flat. Order meaningless; `inject` decides.

```jsonc
[ { "id": "hypr", "name": "@neoshell/hypr" },
  { "id": "vpn",  "name": "vpn-indicator", "config": { "profile": "work" } },
  { "id": "old",  "name": "@neoshell/legacy", "disabled": true } ]
```

**View tree — what is on screen.** Nested. **A top-level entry is a webview**;
its `args` carry layer/anchors; children share it. The tree makes the WebKit
cost visible instead of hiding it.

```jsonc
[ { "type": "neoshell.overlay", "args": { "layer": "top" },
    "children": [ { "type": "neoshell.topbar", "args": { "exclusive": 32 },
                    "children": [ { "type": "vpn.indicator" } ] },
                  { "type": "neoshell.dock", "args": { "exclusive": 80 } } ] },

  { "type": "neoshell.background", "args": { "layer": "background" },
    "children": [ { "type": "neoshell.wallpaper" },
                  { "type": "neoshell.icons" } ] } ]
```

`type` resolves to a view registered in that webview's kernel context. The host
never sees a type name — that is why a new view type needs no runtime change.
`args` is static; live data comes from the view subscribing to the bus.

Layering: a neoworks base profile, overlaid by user patches targeting entries
by id, with a `dump-config` equivalent printing what actually resolved. That is
what keeps the Apple-inspired default a *default* rather than baked-in
behavior.

## What is deleted

Every feature compiled into the Go core becomes an extension or goes away:
`timers`, `widgets`, `overlay`, `applauncher`, `apps`, `notifications`,
`wallpaper`, `windows`, `system`, `hyprland`, `iconresolve`, `capability` — and
then the core itself.

`applauncher`/`apps` wrap primitives that already exist (`.desktop` spec,
`gio launch`, `systemd-run`); an extension calls them directly.

`hyprland` becoming an extension is the load-bearing removal: window and
workspace state is what the bar, dock, and desktop all consume. Get the topic
shape right (`hypr.windows`, `hypr.workspaces`, retained) and the compositor
becomes swappable; get it wrong and the dependency merely moved.

## Migration

1. **Kernel package.** Fibers, inject, effects, disposal — with the race tests.
2. **Stand up the host.** Bus with retained topics, `/plugins/<id>/` serving,
   config, render-host socket. Go core still running alongside.
3. **Webview context.** Mount/dispose protocol, `ui` and `bus` services, view
   tree renderer.
4. **Evict features to extensions**, one per commit. Each is evidence the bus
   and kernel are sufficient. `hyprland` last.
5. **Delete the Go core.**
6. **Collapse surfaces to one webview per layer**, contentless reservation
   surfaces for exclusive zones.
7. **Rebuild bar, dock, and desktop against the public SDK only.**

Step 7 is the acceptance test. If the shipped defaults still need anything
private to the host, the extension contract is not finished.

## Open

- **Icons.** Webviews need `/appicon/<name>` over HTTP. Either the host keeps
  one icon endpoint (small, honest wart) or extensions register HTTP routes
  (general, but a second extension mechanism competing with the bus).
- **Settings app.** Currently a separate process; likely becomes an ordinary
  surface in the view tree.
