# svelte-gtk4

Svelte 5 components rendering to GTK4 widgets under GJS. No webview, no DOM.

```
examples/topbar $ node build.mjs && ./run.sh
```

## How it works

Svelte has no renderer API — the compiler emits direct DOM calls. But look at
what those calls actually are for a template made of components and custom
tags:

```js
var root = $.from_html(`<gtkbox css="min-width: 4px;"><!> <gtklabel> </gtklabel></gtkbox>`);

var gtkbox = root();
var node = $.child(gtkbox);
$.snippet(node, () => $$props.children ?? $.noop);
var gtklabel = $.sibling(node, 2);
$.reset(gtkbox);
$.template_effect(() => {
  $.set_attribute(gtkbox, 'orientation', orientation());
  $.set_text(text_1, `${text() ?? ''} more`);
});
$.event('clicked', gtkbox, ...);
$.append($$anchor, gtkbox);
```

Elements, comment anchors, text nodes, attributes, listeners, and a linked
list to walk between them. That is the whole contract, and it is small enough
to implement directly:

- `src/dom/nodes.ts` — the node tree. `firstChild` and `nextSibling` have to be
  accessors on the prototype, because `init_operations()` pulls their getters
  off `Node.prototype` once and calls them unbound forever after.
- `src/dom/parse.ts` — the only HTML this ever sees is what the compiler emits
  for a template, so it is parsed directly rather than through a DOM.
- `src/dom/globals.ts` — installs `document`, `window` and the node
  constructors. Must be imported before anything that pulls in
  `svelte/internal/client`, which reads them at module scope.
- `src/gtk/mirror.ts` — keeps the widget tree in step with the node tree.
- `src/gtk/widgets.ts` — the tag registry.

The two trees are not the same shape. Svelte works against comment anchors and
text nodes that have no widget at all, so a widget's parent is the nearest
ancestor that has one, and its position is decided by the next widget after it
in document order.

## Writing components

Markup is GTK tags, never HTML. A `<div>` would reach `from_html` as real HTML
with no widget to map it to.

```svelte
<gtkbox orientation="horizontal" spacing={8} valign="center">
  <gtkbutton class="workspace" frame={false} onclicked={activate}>1</gtkbutton>
  <gtklabel class="clock" tabular>{time}</gtklabel>
</gtkbox>
```

| Tag | Widget | Children |
| --- | --- | --- |
| `gtkwindow` | `Gtk.Window` | one |
| `gtkbox` | `Gtk.Box` | ordered |
| `gtkpressable` | `Gtk.Box` | ordered, reports `onpress` / `onhoverstart` / `onhoverend` |
| `gtkcenterbox` | `Gtk.CenterBox` | by `place="start\|center\|end"` |
| `gtkoverlay` | `Gtk.Overlay` | main child, plus any marked `overlay` |
| `gtkbutton` | `Gtk.Button` | one, or text |
| `gtklabel` | `Gtk.Label` | text |
| `gtkicon` | `Gtk.Image` | none |

Shared attributes: `class`, `css`, `halign`, `valign`, `hexpand`, `vexpand`,
`width`, `height`, `margin`, `tooltip`, `visible`, `opacity`, `place`, `input`.

`css` takes a declaration list and becomes a display-wide provider scoped to a
class only that node carries — GTK4 has no per-widget style context to write
into.

## Things that do not carry over

- **Event names are GTK signal names.** `onclicked`, not `onclick`. Svelte
  delegates the standard DOM event names through a document-level listener that
  nothing here dispatches to; anything else goes straight to `addEventListener`,
  which is what connects the signal.
- **`place` must be static.** Dynamic attributes are applied by an effect that
  runs after the node is already inserted, and slot assignment happens at
  insertion.
- **CSS is GTK CSS.** No `width`/`height` (only `min-*`), no `mask`, no
  `mix-blend-mode`, no pseudo-elements. `filter`, `transform`, `calc()`,
  `var()`, `@keyframes`, `radial-gradient` and (since 4.22) `backdrop-filter`
  all work.

## Input regions

A layer surface takes pointer input across its whole area, painted or not. The
topbar keeps a 180px surface so the island has room to expand, but reserves
only 30px — without an input region it would swallow every click in the top
180px of the screen, all the way across.

Widgets marked `input` publish their allocation as the surface's input region,
recomputed off the frame clock so it follows the island as it grows. Once any
widget on a surface asks for one, the rest of the surface becomes
click-through.

## Build

`build.mjs` wires up what a browser build takes for granted: an esbuild plugin
that runs the Svelte compiler, a preprocessor that strips TypeScript
(`verbatimModuleSyntax`, or components imported only by markup get dropped),
an `esm-env` alias, and a resolver that forces every `svelte` import through
one directory. Two copies of the runtime means two `active_effect` variables,
and every `$effect` then looks orphaned.
