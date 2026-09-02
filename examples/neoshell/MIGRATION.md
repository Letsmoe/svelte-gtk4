# Migration: WebKitGTK → Ultralight → CEF

## Why

WebKitGTK (2.52, Skia backend) caps at ~30 fps on this setup even with Vulkan/no-blur.
A desktop shell has to feel smooth, so the renderer moved out of the in-process gotk4 webview
into a separate Rust **render host** process driving a wlr-layer-shell surface.

The host first used **Ultralight**. It rendered the Svelte UI correctly, but the *official free*
Ultralight binary throttles off-screen rendering to ~60 fps (measured ~45 uploads/s on an
animation vs ~122 on the dev-channel SDK that `ul-next-sys` auto-downloads and that we are not
entitled to rely on). The throttle is in the binary, not the license text; uncapped requires
Ultralight Pro ($3,000/yr). On a 144Hz panel the difference is visible ("says 144, looks like
60"), which defeats the entire reason for leaving WebKitGTK.

The host now uses **CEF** (Chromium Embedded Framework): BSD-licensed, free, no performance cap,
full Chromium web platform. Cost: ~250–400 MB RAM and a multi-process model. Verified hitting
full refresh (present loop runs uncapped at 120–290 fps; the panel caps display at 144) with the
real UI. Because it is full Chromium, **every web-compat shim the Ultralight host needed is gone**
(no `HTMLMediaElement` stubs, no `hover:hover` CSS rewrite, no `accent-color` workaround).

## Architecture (unchanged across engines)

The frontend (`neoshell-ui`, Svelte) and the Go core's WebSocket IPC are **unchanged**. The
frontend loads `http://localhost:<port>/` and opens `/ws` for all shell logic (system state,
hyprland dispatch, run/watch, etc.). Only the render/engine layer was swapped.

```
  ┌─────────────────────────┐         ┌──────────────────────────────┐
  │ neoshell-core (Go)         │         │ neoshell-render (Rust)         │
  │                          │ control │                              │
  │  WS hub  ── frontend IPC │ socket  │  CEF off-screen view / role  │
  │  hyprland IPC            │◄───────►│  owns wlr-layer-shell surface│
  │  system poll            │ (JSON   │  OnPaint BGRA → wl_shm       │
  │  surface controller ────┼─ lines) │  wl_seat input → CEF host    │
  │  HTTP: serves frontend  │         │                              │
  └─────────────────────────┘         └──────────────────────────────┘
        ▲  WebSocket /ws (UNCHANGED)            │ loads localhost:<port>/<role>
        └──────────────────────────────────────┘  in each CEF browser view
```

- **Go core** speaks the control protocol to the Rust process (`internal/renderhost`) and serves
  the frontend over plain HTTP (`internal/server`). No engine-specific logic remains in Go.
- **Render host** is a dumb pixel pump: "create surface X with this layer-shell spec, load this
  URL, give me frames, forward me input." No shell logic lives here.

## CEF engine specifics

- **Subprocess model.** The same binary is re-executed for the render/gpu/utility processes.
  `main()` first registers the API version (`cef::api_hash(CEF_API_VERSION_LAST, 0)` — required,
  else handlers fail with "called with invalid version -1"), then calls `cef::execute_process`.
  A child returns `>= 0` and exits before touching Wayland; the browser process returns `-1` and
  proceeds.
- **Off-screen rendering.** `windowless_rendering_enabled` + a windowless `WindowInfo`. CEF calls
  `RenderHandler::on_paint(type, dirty_rects, buffer, w, h)` with a CPU **BGRA** buffer on the
  main thread during `do_message_loop_work`. BGRA matches `wl_shm` `Argb8888` (little-endian), so
  the buffer copies straight into the shm canvas. `OnAcceleratedPaint` (GPU/dmabuf) is
  Windows-centric and immature on Linux — not used.
- **Frame rate.** CEF's windowless default is 30; `host.set_windowless_frame_rate(144)` lifts the
  cap. `external_message_pump = true` + a calloop ~4 ms timer calling `do_message_loop_work()`
  drives paints without a CEF-owned thread.
- **Present path.** `on_paint` writes a shared `Rc<RefCell<FrameState>>` and bumps a generation
  counter; the Wayland frame callback presents the latest frame through a double-buffered
  `SlotPool`. Idle frames (no new generation) skip the upload and only re-commit a frame request.
- **Damage / coherence.** Each present full-copies the frame into the shm slot (keeps every slot
  coherent) but damages only `current_dirty ∪ prev_dirty`. The union with the previous frame's
  dirty region is required because the two alternating slots are two frames stale; damaging only
  the current region ghosts.
- **Sandbox.** `no_sandbox` (self-contained personal shell, avoids the setuid helper).
- **Binaries.** The `cef` crate's build script downloads ~200 MB of CEF binaries to the
  `cef-dll-sys` build output. `internal/renderhost/host.go` resolves that dir (or `NEOSHELL_CEF_PATH`)
  and sets `LD_LIBRARY_PATH` so the host and its subprocesses find `libcef.so` + resources.

## Control protocol (Go core → render host)

Newline-delimited JSON over a unix socket (`$XDG_RUNTIME_DIR/neoshell-render.sock`). The Go type is
`internal/renderhost.Command`; the Rust type is `protocol::Command`. Keep them in sync. Unchanged
from the Ultralight host — the protocol is engine-agnostic.

| Command          | Fields                                                              | Effect |
|------------------|--------------------------------------------------------------------|--------|
| `surface.create` | `role, url, monitor, layer, anchors[], keyboard, exclusiveEdge, exclusiveSize` | create a layer-shell surface running a CEF view |
| `surface.exclusive` | `role, edge, size`                                              | reserve `size` px along `edge` (0 clears) |
| `surface.region` | `role, rects[]`                                                    | set the input region (empty = whole surface) |
| `surface.show` / `surface.hide` | `role`                                              | map / unmap without destroying |
| `surface.destroy`| `role`                                                             | tear down |

## CEF migration stages (branch `migrate/cef`)

- [x] **C1. CEF builds & initializes** — `cef` crate swapped in for `ul-next`, binaries
      downloaded, `execute_process` + `initialize` + message pump, headless browser loads a test
      URL, `on_paint` fires with a sane buffer.
- [x] **C2. One surface** — `on_paint` buffers feed the `wl_shm` present for one layer surface; a
      test page renders on a real layer-shell surface at 144.
- [x] **C3. Real UI + fps gate** — the real neoshell-ui renders correctly; present loop runs
      uncapped well above 144 (panel caps display). The whole point: CEF is not throttled.
- [x] **C4. Input** — wl_pointer/keyboard → CEF `send_mouse_*` / `send_key_event`; click-through
      via input regions. Native hover works (no CSS shim).
- [x] **C5. Go controller + cutover** — `host.go` points at the CEF binary + runtime dir;
      `controller.go` unchanged (same protocol). Removed the Ultralight compat machinery from
      `internal/server` (`serveCSSWithHoverFix`, `ulCompatShim`, `injectShim`, the `/ul-compat.js`
      route). Full shell verified: notch renders centered with backend data, click-through and
      input work, hover is native.
- [x] **C6. Cleanup** — removed `render-host/src/ultralight.rs`, this doc rewritten, debug present
      logging removed. The `--test-url <url|fps>` standalone probe is kept.

## Web compatibility

Full Chromium — no shims. The Ultralight host needed an `HTMLMediaElement`/`MediaStream` stub
(Svelte 5 event delegation did `instanceof HTMLMediaElement`), a server-side `@media (hover: hover)`
rewrite, and `accent-color` workarounds. None apply under CEF; `oklch`, `:has()`, container
queries, `accent-color`, native form controls, hover variants, and `backdrop-filter` all work
natively. Glass blur is still done compositor-side (`layerrule = blur, neoshell.*`).

## Standalone probe

`render-host/target/debug/neoshell-render --test-url <URL>` opens a centered overlay loading the
URL with no Go core; the special value `fps` loads a built-in RAF counter + moving box to eyeball
smoothness against the host's present-rate log.

## Out of scope (future)

- GPU/dmabuf zero-copy via `OnAcceleratedPaint` (revisit if/when Linux support matures).
- Multi-surface roles (dock, OSD, launcher, notifications daemon, settings toplevel).

## WPE WebKit evaluation (spike, 2026-06-28)

Evaluated WPE WebKit 2.52.4 as an alternative to CEF — motive: zero-copy dmabuf + lower memory
than Chromium, without losing 144fps. Spike in `experiments/wpe-spike/` (throwaway). Outcome:
**viable and architecturally better than CEF on the copy path, but requires writing a custom
WPEPlatform backend in Rust.** Not migrating now; recorded so it is not re-litigated.

Measured on this box (Hyprland, eDP-2 144Hz integrated + DP-1 144Hz external):

| Config | rAF fps | Note |
| --- | --- | --- |
| WebKitGTK 6.0 (Wayland client) | 60 | `PreferPageRenderingUpdatesNear60FPS` flag inert — the DRM vblank monitor can't map a CRTC as a Wayland client, so it uses the hardcoded 60 timer fallback |
| WPE headless (true off-screen) | 60 | 0 screens → timer fallback |
| WPE Wayland, external DP-1 | 60 | screen exposes no `sync_observer` |
| WPE Wayland, integrated eDP-2, flag on | 72 | 144 snapped to nearest 60-harmonic |
| WPE Wayland, integrated eDP-2, flag **off** | **144** | real vblank via the screen's `WPEScreenSyncObserver` |

Key facts established (all via GObject-introspection probes, no C written):

- The 60Hz "cap" is two knobs, both controllable: (1) the `PreferPageRenderingUpdatesNear60FPS`
  feature (default on, snaps to a 60-harmonic; disable via `webkit_settings_set_feature_enabled`),
  and (2) a vblank source that actually reports the real rate. WebKit content fps == the rate of
  the `WPEScreenSyncObserver` driving `RenderingUpdateScheduler`.
- `WPEScreenSyncObserver` is a *derivable* type (`start`/`stop`/`sync` vfuncs + `add_callback`).
  A custom subclass **can fire WebKit's registered vblank callback at any rate we choose** —
  proven (drove ~144 callbacks/s from our own `GLib` timer). `WPEScreen.get_sync_observer` and
  `WPEDisplay.get_n_screens`/`get_screen` are overridable too.
- `WPEBufferDMABuf` exposes `fd`/`format`/`modifier`/`n_planes`/`stride`/`offset` +
  `rendering_fence`/`release_fence`; `WPEView.render_buffer`/`do_render_buffer`/`buffer_released`
  is the per-frame backend contract. This is the zero-copy path CEF lacks on Linux (CEF does a
  full BGRA `memcpy` into `wl_shm`).

The intended design (if pursued): a thin custom WPEPlatform backend whose single screen's sync
observer is ticked by the render-host's own wlr-layer-shell `wl_surface.frame` callbacks. That
renders WPE off-screen, at the true refresh of whatever monitor the layer surface is on (fixes
the off-screen-vblank tension AND the external-monitor `sync_observer=None` gap in one move), and
reconstructs CEF's external-begin-frame through WPE's native interface. Frames arrive as
`WPEBufferDMABuf` → import via `zwp_linux_dmabuf` → attach to the layer surface, zero-copy.

Costs / open work: a custom WPEPlatform backend + Rust↔WPE FFI (no mature Rust bindings for the
new WPEPlatform-2.0 API — hand-written/bindgen against the C GObject API); `surface.rs` present
loop becomes a buffer-subscription instead of external-begin-frame; dmabuf format/modifier
negotiation with the compositor; input plumbing through WPEPlatform events. The Python spike
could not assemble the full backend end-to-end only because `WPEDisplayHeadless` is a `final`
GType (a binding limitation, not architectural) — Rust implements the backend directly.

### C++ prototype (`experiments/wpe-cpp/`)

Built the full custom backend in **C++** (the intended migration language — the team reads
C++/Go, not Rust). It subclasses `WPEDisplay`/`WPEScreen`/`WPEScreenSyncObserver`/`WPEView`/
`WPEToplevel` as plain GObject, ticks the sync observer from our own clock, and renders
off-screen to dmabuf shown on a wlr-layer-shell surface. Confirms end-to-end:

- WPE renders at **141 render_buffer/s** when our timer drives the observer at 144Hz (71 with
  the flag on) — the engine is not 60-capped; the rate follows whatever drives the observer.
- Frames arrive as `WPEBufferDMABuf` and import zero-copy via `zwp_linux_dmabuf` onto a layer
  surface; the surface's frame callback drives the observer (real-vblank present loop).

Two lessons for the real port, both already handled by the existing Rust host's patterns:
- **Multi-GPU: render on the compositor's GPU.** This box composites the panel on the AMD
  iGPU; a buffer rendered on the NVIDIA dGPU is a cross-GPU tiled import the compositor
  rejects. Render on the AMD node → LINEAR buffer imports fine. Select the render node from
  the dmabuf-feedback `main_device`.
- **Present holds a solid 144fps** on the layer surface (panel idle). A one-off ~50–70fps
  reading was GPU contention from another running app, not a loop limit; the naive
  synchronous single-buffer loop reaches native refresh. Pipelining (render-ahead + buffer
  pool) is still worth it for headroom under load but is not required for 144.
- **GPU cost is workload-bound, not an engine win.** Idle/static page ≈ 0% GPU (the loop
  renders nothing when nothing animates). Continuous 144fps animation ≈ 70% of the iGPU with
  either LINEAR or AMD-tiled buffers — roughly engine-independent (CEF pays the same). WPE's
  efficiency edge over CEF is CPU (no per-frame BGRA memcpy) and RSS, **not** GPU. Render on
  the GPU that drives the panel (AMD iGPU here); the NVIDIA dGPU's tiled buffers are rejected
  by the compositor for this output.
