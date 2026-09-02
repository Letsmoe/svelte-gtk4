# neoshell

A desktop shell for Hyprland. A small TypeScript host — a pub/sub bus plus a
render pipeline — and everything else as extensions. See `ARCHITECTURE.md`
for the full design.

```
task build     compile the render host, daemons, the D-Bus bridges, and the views
task run       run the host (spawns the render host, mounts extensions)
task dev       run it against the views dev server — see Development
task test      run every test suite
```

## Development

`task dev` runs the shell for real, with the edit loop shortened:

- **views** come from a vite dev server (127.0.0.1:5174) instead of
  `<id>/dist`, so a saved Svelte component is hot replaced in the running
  surface — no rebuild, no remount, state kept
- **extension backends** are watched by the host (`NEOSHELL_HOT=1`) and their
  fibers remount on save, as does the surface runtime in `packages/surface`
- **the host itself** cannot swap its core plugins in a live fiber, so a
  change under `apps/host/src` restarts it — and the render host with it

`task run` is the real thing: built bundles, no watchers.

## Layout

```
Hyprland keybind ──► neoshell-emit <topic> ──► unix socket
                                                    │
neoshell-host (bun, 127.0.0.1:9877) ────────────────┤
  ├─ bus            pub/sub with retained topics; unix socket + WebSocket
  ├─ extensions     mounts apps/extensions/<id> backends as kernel fibers
  ├─ view tree      config-declared UI tree → one webview per top-level node
  └─ render host    C++/WPE layer-shell webviews (apps/render-host)

apps/extensions/<id>/     backend.ts (host-side) and/or dist/views.js (webview)
packages/surface          the webview runtime (bus client, view registry, renderer)
```

The plugin kernel — fibers, services, revertible effects — is
[@neoworks/extension-system](https://github.com/neoworks-dev/extension-system),
linked into the workspace with `bun link @neoworks/extension-system`.

An extension is a directory under `apps/extensions/` with a `manifest.json`.
It contributes **functions** (a backend module mounted in the host, talking
over the bus) and/or **views** (an ES module the webviews import from
`/plugins/<id>/`). Backends that need another language spawn a daemon as an
effect — the notifications and systray extensions each run a Go D-Bus bridge
this way.

The UI is declared in the config as a tree of view nodes; each top-level node
becomes a layer-shell webview. Adding a view is a config edit, not a code
change.

### Configuration

`~/.config/neoshell/config.json`

| Key | Meaning |
|---|---|
| `views` | The view tree: `[{id, type, args, children}]`. Top-level `args` carry the layer-shell spec (layer, anchors, exclusive, keyboard). |
| `extensions` | The mount list: which extension backends run, with per-extension config. |
| `appearance.*` | Wallpaper and the shared background blur. |

## Keybinds

The host does not inject keybinds. Declare them in your own Hyprland config;
each one publishes a message on the host's bus:

```conf
bind = SUPER, S, exec, bun /path/to/neoshell/apps/host/src/emit.ts surface:toggle settings
```
