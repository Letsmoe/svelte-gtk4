# svelte-gtk4

Svelte 5 components rendering to GTK4 widgets under GJS. No webview, no DOM.

```
task bar                # examples/topbar — a Hyprland bar on a layer surface
task bar EXAMPLE=gallery # one of every widget, in a normal window
task smoke              # build every widget once and exit
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
- `src/gtk/widgets/` — one class per tag, one instance per element node.
  `index.ts` is the registry; `base.ts` has the attributes every widget shares.

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

Shared attributes: `class`, `css`, `id`, `halign`, `valign`, `hexpand`,
`vexpand`, `width`, `height`, `margin`, `margin-top` / `-bottom` / `-start` /
`-end`, `tooltip`, `visible`, `sensitive`, `focusable`, `opacity`, `place`,
`input`, `clip`.

`css` takes a declaration list and becomes a display-wide provider scoped to a
class only that node carries — GTK4 has no per-widget style context to write
into. `id` names the widget for both CSS and the attributes that reference
another widget by name (`stack`, `group`, `capture`).

### Windows and chrome

| Tag | Widget | Children | Own attributes |
| --- | --- | --- | --- |
| `gtkwindow` | `Gtk.Window` | one, plus `place="titlebar"` | `title`, `decorated`, `resizable`, `modal`, `icon`, `fullscreen`, `maximized`, `default-width`, `default-height`, and the layer-shell set: `layer`, `namespace`, `anchor`, `exclusive-zone`, `gap`, `keyboard-mode` |
| `gtkheaderbar` | `Gtk.HeaderBar` | `place="start\|end\|title"` | `controls`, `decoration` |
| `gtkactionbar` | `Gtk.ActionBar` | `place="start\|center\|end"` | `revealed` |
| `gtkwindowcontrols` | `Gtk.WindowControls` | none | `side`, `decoration` |
| `gtkwindowhandle` | `Gtk.WindowHandle` | one | — |
| `gtkpopover` | `Gtk.Popover` | one | `open`, `autohide`, `arrow`, `position`, `offset-x`, `offset-y`, `cascade-popdown` |

### Layout

| Tag | Widget | Children | Own attributes |
| --- | --- | --- | --- |
| `gtkbox` | `Gtk.Box` | ordered | `orientation`, `spacing`, `homogeneous`, `baseline` |
| `gtkpressable` | `Gtk.Box` | ordered | as `gtkbox`; reports `onpress` / `onhoverstart` / `onhoverend` |
| `gtkcenterbox` | `Gtk.CenterBox` | `place="start\|center\|end"` | `orientation`, `baseline`, `shrink-center-last` |
| `gtkgrid` | `Gtk.Grid` | by `col` / `row` / `colspan` / `rowspan` | `spacing`, `row-spacing`, `column-spacing`, `homogeneous`, `row-homogeneous`, `column-homogeneous` |
| `gtkoverlay` | `Gtk.Overlay` | main child, plus any marked `overlay` | overlay children take `measure`, `clip-overlay` |
| `gtkpaned` | `Gtk.Paned` | `place="start\|end"` | `orientation`, `position`, `wide-handle`, `resize-start` / `-end`, `shrink-start` / `-end` |
| `gtkfixed` | `Gtk.Fixed` | by `x` / `y` | — |
| `gtkframe` | `Gtk.Frame` | one | `label`, `label-align` |
| `gtkaspectframe` | `Gtk.AspectFrame` | one | `ratio`, `obey-child`, `xalign`, `yalign` |
| `gtkexpander` | `Gtk.Expander` | one | `label`, `expanded`, `markup`, `resize-toplevel` |
| `gtkrevealer` | `Gtk.Revealer` | one | `reveal`, `transition`, `duration` |
| `gtkscrolledwindow` | `Gtk.ScrolledWindow` | one | `hscroll`, `vscroll`, `frame`, `kinetic`, `overlay-scrolling`, `min-` / `max-content-width` / `-height`, `propagate-width` / `-height` |
| `gtkviewport` | `Gtk.Viewport` | one | `scroll-to-focus` |
| `gtkstack` | `Gtk.Stack` | pages, by `name` / `title` | `page`, `transition`, `duration`, `homogeneous`, `hhomogeneous`, `vhomogeneous`, `interpolate-size` |
| `gtkstackswitcher` | `Gtk.StackSwitcher` | none | `stack` |
| `gtkstacksidebar` | `Gtk.StackSidebar` | none | `stack` |
| `gtknotebook` | `Gtk.Notebook` | pages, by `title` | `page`, `tabs`, `tab-position`, `border`, `scrollable` |
| `gtklistbox` | `Gtk.ListBox` | ordered rows | `selection`, `separators`, `single-click` |
| `gtkflowbox` | `Gtk.FlowBox` | ordered | `orientation`, `selection`, `spacing`, `row-spacing`, `column-spacing`, `min-per-line`, `max-per-line`, `homogeneous`, `single-click` |
| `gtkgraphicsoffload` | `Gtk.GraphicsOffload` | one | `enabled`, `black-background` |

### Display

| Tag | Widget | Children | Own attributes |
| --- | --- | --- | --- |
| `gtklabel` | `Gtk.Label` | text | `xalign`, `yalign`, `wrap`, `wrap-mode`, `lines`, `ellipsize`, `justify`, `markup`, `selectable`, `single-line`, `width-chars`, `max-width-chars`, `tabular` |
| `gtkinscription` | `Gtk.Inscription` | text | `xalign`, `yalign`, `min-chars`, `nat-chars`, `min-lines`, `nat-lines`, `overflow-text` |
| `gtkimage` / `gtkicon` | `Gtk.Image` | none | `icon`, `file`, `resource`, `size`, `icon-size`, `fallback` |
| `gtkpicture` | `Gtk.Picture` | none | `file`, `resource`, `fit`, `shrink`, `alt` |
| `gtkspinner` | `Gtk.Spinner` | none | `spinning` |
| `gtkprogressbar` | `Gtk.ProgressBar` | none | `value`, `orientation`, `text`, `show-text`, `inverted`, `pulse-step`, `ellipsize` |
| `gtklevelbar` | `Gtk.LevelBar` | none | `value`, `min`, `max`, `mode`, `orientation`, `inverted` |
| `gtkseparator` | `Gtk.Separator` | none | `orientation` |
| `gtkcalendar` | `Gtk.Calendar` | none | `date` (`YYYY-MM-DD`), `heading`, `day-names`, `week-numbers` |
| `gtkdrawingarea` | `Gtk.DrawingArea` | none | `draw`, `content-width`, `content-height` |
| `gtkvideo` | `Gtk.Video` | none | `file`, `resource`, `autoplay`, `loop` |

### Controls

| Tag | Widget | Children | Own attributes |
| --- | --- | --- | --- |
| `gtkbutton` | `Gtk.Button` | one, or text | `label`, `underline`, `frame`, `icon`, `shrink` |
| `gtktogglebutton` | `Gtk.ToggleButton` | one, or text | as `gtkbutton`, plus `active`, `group` |
| `gtkcheckbutton` | `Gtk.CheckButton` | one, or text | `label`, `underline`, `active`, `group`, `inconsistent` |
| `gtklinkbutton` | `Gtk.LinkButton` | one, or text | as `gtkbutton`, plus `uri`, `visited` |
| `gtkmenubutton` | `Gtk.MenuButton` | one, plus `place="popover"` | as `gtkbutton`, plus `active`, `direction`, `arrow`, `primary` |
| `gtkswitch` | `Gtk.Switch` | none | `active`, `state` |
| `gtkscale` | `Gtk.Scale` | none | `min`, `max`, `step`, `value`, `orientation`, `digits`, `draw-value`, `value-position`, `origin`, `inverted` |
| `gtkspinbutton` | `Gtk.SpinButton` | none | `min`, `max`, `step`, `value`, `digits`, `numeric`, `wrap`, `snap`, `climb-rate` |
| `gtkscalebutton` | `Gtk.ScaleButton` | none | `min`, `max`, `step`, `value`, `icons`, `frame` |
| `gtkcolorbutton` | `Gtk.ColorDialogButton` | none | `color`, `alpha`, `title` |
| `gtkfontbutton` | `Gtk.FontDialogButton` | none | `font`, `title`, `preview` |

### Text entry

Everything here also takes `text`, `editable`, `width-chars`,
`max-width-chars`, `xalign` and `undo`, and fires `changed`.

| Tag | Widget | Own attributes |
| --- | --- | --- |
| `gtkentry` | `Gtk.Entry` | `placeholder`, `frame`, `max-length`, `visibility`, `icon`, `icon-end`, `progress`, `emoji`, `activates-default` |
| `gtktext` | `Gtk.Text` | `placeholder`, `max-length`, `visibility`, `activates-default`, `propagate-width` |
| `gtksearchentry` | `Gtk.SearchEntry` | `placeholder`, `delay` |
| `gtkpasswordentry` | `Gtk.PasswordEntry` | `placeholder`, `peek`, `activates-default` |
| `gtkeditablelabel` | `Gtk.EditableLabel` | `editing` |
| `gtktextview` | `Gtk.TextView` | text content; `editable`, `monospace`, `wrap`, `cursor`, `justify`, `accepts-tab`, `padding`, `indent`, `line-spacing` |
| `gtksearchbar` | `Gtk.SearchBar` | one child; `search`, `close-button`, `capture` |
| `gtkdropdown` | `Gtk.DropDown` | `items`, `selected`, `search`, `arrow` |

### Not wrapped

`ListView`, `GridView` and `ColumnView` are driven by a `GListModel` and a
factory rather than by child widgets, and `PopoverMenu` by a `GMenuModel` —
none of them has anything for a child list to map onto. Dialogs are presented
imperatively rather than mounted, and `ApplicationWindow` needs a
`Gtk.Application` that `start()` does not create. Everything deprecated in GTK4
is left out; `gtkcolorbutton` and `gtkfontbutton` are the 4.10 dialog-based
widgets, not the old ones.

## Things that do not carry over

- **Event names are GTK signal names.** `onclicked`, not `onclick`. Svelte
  delegates the standard DOM event names through a document-level listener that
  nothing here dispatches to; anything else goes straight to `addEventListener`,
  which is what connects the signal.
- **Child-position attributes must be static.** Dynamic attributes are applied
  by an effect that runs after the node is already inserted, and the parent
  reads these at insertion: `place`, `overlay`, `measure`, `clip-overlay`,
  `name`, `title`, `col`, `row`, `colspan`, `rowspan`, `x`, `y`.
- **Widget references go by `id`.** Markup cannot pass a widget, so `stack`,
  `group` and `capture` name one. The reference resolves late, so the target
  does not have to exist yet.
- **CSS is GTK CSS.** No `width`/`height` (only `min-*`), no `mask`, no
  `mix-blend-mode`, no pseudo-elements, no `overflow` — clipping is the `clip`
  attribute, not a declaration. `filter`, `transform`, `calc()`,
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
