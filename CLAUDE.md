# svelte-gtk4 — working notes

Svelte 5 components compiled to GTK4 widgets under GJS. No webview, no DOM.

## Layout

| Path | Role |
| --- | --- |
| `src/dom/nodes.ts` | The node tree Svelte's client runtime mutates. `firstChild`/`nextSibling` must be prototype accessors — `init_operations()` pulls the getters off `Node.prototype` once and calls them unbound forever. |
| `src/dom/parse.ts` | Parses the template HTML the compiler emits. Not a general HTML parser. |
| `src/dom/globals.ts` | Installs `document`, `window`, node constructors. Must be imported before anything pulling in `svelte/internal/client`. |
| `src/dom/hooks.ts` | Slot indirection so `nodes.ts` can call the mirror without importing it. |
| `src/gtk/mirror.ts` | Keeps the widget tree in step with the node tree. |
| `src/gtk/widgets/` | One file per widget class. `index.ts` is the tag registry, `base.ts` the shared attributes, `enums.ts` every enum spelling. |
| `src/gtk/attrs.ts` | Attribute value coercion only (`asString`, `asNumber`, `asEnum`, …). |
| `src/gtk/style.ts` | `class` and inline `css`. |
| `src/gtk/events.ts` | Signal names and the three gesture-backed pseudo-events. |
| `src/gtk/inputRegion.ts` | Layer-surface input regions for `input`. |
| `src/gtk/registry.ts` | `id` → widget, for attributes that reference another widget (`stack=`). |

## Architecture

Widgets are **classes, one instance per element node**, not static spec objects.
`SElement.impl` holds the instance; `SElement.widget` is a getter onto
`impl.widget`, so nothing outside `widgets/` needs to know the class exists.

```
Widget            common attributes, errors on children
├─ Bin            one child via set_child()
├─ Container      ordered children, Gtk.Box protocol
└─ (per widget)   overrides insert/remove for slots, pages, cells
```

Attribute dispatch is a normal override chain: a subclass handles what it owns
and falls through to `super.attr(name, value)`. That replaces the old
"spec.attr returns true, else applyCommon" two-step.

`setText` is an **optional** method — only widgets whose content is text rather
than children declare it. The mirror checks for its presence.

## Constraints discovered

- **Static-only child attributes.** Slot/page/cell attributes (`place`, `overlay`,
  `name`, `title`, `row`, `col`, `x`, `y`) are read at insertion time. Svelte
  applies *dynamic* attributes from an effect that runs after the node is
  already inserted, so those must be literals in the template.
- **Event names are GTK signal names.** `onclicked`, not `onclick`. Svelte
  delegates the standard DOM event names through a document-level listener that
  nothing here dispatches to; anything else reaches `addEventListener`.
- **`press`/`hoverstart`/`hoverend`** have no signal — `events.ts` attaches a
  `GestureClick` / `EventControllerMotion` for them.
- **GTK CSS is not CSS.** No `width`/`height` (only `min-*`), no `overflow`
  (that is the `clip` attribute), no pseudo-elements, no `mask`,
  no `mix-blend-mode`. `filter`, `transform`, `calc()`, `var()`, `@keyframes`
  and `radial-gradient` do work.
- **Two Svelte copies break effects.** `build.mjs` forces every `svelte` import
  through one directory; two copies means two `active_effect` variables and
  every `$effect` looks orphaned.

## GTK4 widget survey

`Gtk-4.0.gir` lists **104** classes descending from `Gtk.Widget`; 26 are
deprecated. Read it directly rather than guessing at an API:

```
python3 -c "import xml.etree.ElementTree as ET; ..."  # /usr/share/gir-1.0/Gtk-4.0.gir
```

Deliberately **not** wrapped:

| Widget | Why |
| --- | --- |
| `ListView`, `GridView`, `ColumnView`, `TreeExpander` | Driven by a `GListModel` + factory, not by child widgets. A declarative child list has nothing to map onto them. |
| `PopoverMenu`, `PopoverMenuBar` | Built from a `GMenuModel`, not children. |
| `Dialog`, `MessageDialog`, `AboutDialog`, the `*ChooserDialog`s | Presented imperatively, never mounted into a tree. Most are deprecated in 4.10+. |
| `ApplicationWindow` | Needs a `Gtk.Application`; `start()` runs a bare main loop. |
| `TreeView`, `IconView`, `ComboBox`, `ColorButton`, `FontButton`, `InfoBar`, `Statusbar`, `Assistant`, `LockButton`, `CellView`, `ShortcutsWindow` | Deprecated in GTK4. `ColorDialogButton` / `FontDialogButton` are wrapped instead. |
| `ListBoxRow`, `FlowBoxChild` | GTK creates them implicitly when a plain child is appended. |
| `DragIcon`, `PopoverBin`, `Range`, `ListBase`, `Widget` | Abstract or internal. |
| `MediaControls` | Useless without a `GtkMediaStream` there is no way to hand it. `gtkvideo` has its own controls. |

## Gotchas found in the GIR

- `Gtk.Box.insert_child_after(child, sibling)` — to insert *before* a widget you
  pass that widget's `get_prev_sibling()`.
- `Gtk.ListBox` / `Gtk.FlowBox` take `insert(child, position)`, not a sibling.
  A plain child gets wrapped in a `ListBoxRow`/`FlowBoxChild`, so the position
  of an existing widget is found by walking from `get_first_child()` and
  comparing against the child *or its wrapper*.
- `Gtk.Notebook.remove_page` takes an index — `page_num(child)` first.
- `Gtk.Calendar`'s `day`/`month`/`year` properties are deprecated; `set_date`
  takes a `GLib.DateTime`.
- `Gtk.ColorDialogButton` and `Gtk.FontDialogButton` render nothing until they
  are given a `Gtk.ColorDialog` / `Gtk.FontDialog`.
- `Gtk.Scale` / `Gtk.SpinButton` need `set_range` before `set_value`, or the
  value is clamped to the default 0..0 adjustment.
- **`gjs-esm-types` runs behind the installed GTK.** These exist at runtime and
  had to be reached through `as any`: `CssProvider.load_from_string` (4.12),
  `CenterBox.set_shrink_center_last` (4.12), `Calendar.set_date` (4.14),
  `ScaleButton.set_has_frame` (4.14), and `GraphicsOffload` in its entirety
  (4.14). A few others are properties in the typings but methods in the docs —
  `Image.use_fallback`, `Entry.show_emoji_icon`. `task smoke` is what catches a
  cast that was wrong.
- `LayerShell.init_for_window` must run before the window is realized, exactly
  once.

## Commands

```
task build      # bundle examples/topbar
task bar        # build and run it
task smoke      # build every widget once and exit
task typecheck  # tsc --noEmit
```

`task smoke` is the one that matters when touching `src/gtk/widgets/`.
`examples/gallery` mounts one of every tag in the registry, so a setter that
does not exist at runtime — the typings run behind GTK, and several setters had
to be reached through `as any` — crashes there. `tsc` cannot see any of that.
The gallery resolves svelte and esbuild from the repository root rather than
installing its own copies.

`LD_PRELOAD=/usr/lib/libgtk4-layer-shell.so` is required and set by the
Taskfile — bindings cannot otherwise guarantee it loads before
libwayland-client.
