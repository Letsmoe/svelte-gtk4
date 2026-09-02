# gtk4-topbar spike

`Topbar.svelte` + `Clock.svelte` rewritten against GTK4 via GJS, to see what the
port would actually cost. TypeScript, bundled with esbuild, run by `gjs`.

Not wired into the build. Delete the directory to remove it.

## Run

```sh
sudo pacman -S gjs        # not installed yet
bun install
bun start
```

Falls back to demo workspaces when `$XDG_RUNTIME_DIR/neoshell-host.sock` is
absent, so it runs without the host.

## What it shows

**Logic ported unchanged.** `src/hypr.ts` is a verbatim copy of the parsing
helpers from `Topbar.svelte`. `Intl.DateTimeFormat` from `Clock.svelte` works
as-is — SpiderMonkey ships full ICU.

**Transport swapped, protocol identical.** GJS has no `WebSocket`, so
`src/bus.ts` speaks the same NDJSON over the unix socket the host already
exposes for daemons. Subscribe / publish / call are unchanged on the wire.

**Layout moved out of CSS.** `grid-cols-[1fr_auto_1fr]` became a
`Gtk.CenterBox` with a fixed-width centre child; `flex items-center gap-1`
became `Gtk.Box(spacing: 4, valign: CENTER)`. Sizing is `set_size_request`,
not `height:`.

**Markup became widget construction.** The `{#each}` block is a manual rebuild
loop — GTK has no keyed diff.

**CSS mostly survived.** `style.css` is real GTK4 CSS using custom properties
and `var()` (needs GTK ≥ 4.16; this machine has 4.22). The Tailwind classes it
replaces are named in comments above each rule.

## What it can't show

- **No `backdrop-filter`.** The bar's translucency here is a flat
  `color-mix()` background. Per-element glass is not expressible; you would be
  back to the compositor-wide `layerrule blur` you already use.
- **No `tabular-nums`.** It's a Pango attribute, not CSS — set on the label in
  code if the clock digits jitter.
- **No Svelte.** Reactivity is hand-rolled. Svelte 5 on GJS needs either a
  bigger DOM shim than the Svelte 4 demos used, or the unfinished custom
  renderer API.

## Status

Typechecks and bundles clean. **Never executed** — `gjs` is not installed on
this machine, so the runtime behaviour is unverified.
