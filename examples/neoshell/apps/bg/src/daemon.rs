//! Wayland state for the wallpaper daemon: one wlr-layer-shell Background
//! surface per output, painted from the current wallpaper. On each repaint the
//! primary output's bar strip is sampled into gradient stops and published to
//! the color hub for subscribers.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use image::RgbaImage;
use smithay_client_toolkit::compositor::{CompositorHandler, CompositorState};
use smithay_client_toolkit::output::{OutputHandler, OutputState};
use smithay_client_toolkit::registry::{ProvidesRegistryState, RegistryState};
use smithay_client_toolkit::shell::wlr_layer::{
    Anchor, Layer as SctkLayer, LayerShell, LayerShellHandler, LayerSurface, LayerSurfaceConfigure,
};
use smithay_client_toolkit::shell::WaylandSurface;
use smithay_client_toolkit::shm::slot::SlotPool;
use smithay_client_toolkit::shm::{Shm, ShmHandler};
use smithay_client_toolkit::{
    delegate_compositor, delegate_layer, delegate_output, delegate_registry, delegate_shm,
    registry_handlers,
};
use wayland_client::globals::GlobalList;
use wayland_client::protocol::{wl_output, wl_shm, wl_surface};
use wayland_client::{Connection, QueueHandle};

use crate::colors::ColorHub;
use crate::wallpaper::{self, Wallpaper};

/// Number of left-to-right gradient stops sampled from the bar strip.
const SEGMENTS: usize = 6;

/// Work handed to the Wayland thread from the socket listener.
pub enum DaemonRequest {
    SetWallpaper(PathBuf),
}

/// One output's background surface.
struct BgSurface {
    output: wl_output::WlOutput,
    output_name: Option<String>,
    layer: LayerSurface,
    width: u32,
    height: u32,
    configured: bool,
    pool: Option<SlotPool>,
    pool_dims: (u32, u32),
}

impl BgSurface {
    /// Paint the scaled wallpaper into a fresh shm buffer and commit.
    fn draw(&mut self, shm: &Shm, rgba: &RgbaImage, width: u32, height: u32) {
        let stride = width * 4;
        if self.pool.is_none() || self.pool_dims != (width, height) {
            match SlotPool::new((stride * height) as usize, shm) {
                Ok(pool) => {
                    self.pool = Some(pool);
                    self.pool_dims = (width, height);
                }
                Err(err) => {
                    log::error!("slot pool: {err}");
                    return;
                }
            }
        }

        let pool = self.pool.as_mut().expect("pool ensured above");
        let buffer_result = pool.create_buffer(
            width as i32,
            height as i32,
            stride as i32,
            wl_shm::Format::Argb8888,
        );
        let (buffer, canvas) = match buffer_result {
            Ok(pair) => pair,
            Err(err) => {
                log::error!("create_buffer: {err}");
                return;
            }
        };

        wallpaper::copy_to_bgra(rgba, canvas);

        let wl_surface = self.layer.wl_surface();
        if let Err(err) = buffer.attach_to(wl_surface) {
            log::error!("attach: {err}");
            return;
        }
        wl_surface.damage_buffer(0, 0, width as i32, height as i32);
        self.layer.commit();
    }
}

pub struct State {
    registry_state: RegistryState,
    output_state: OutputState,
    compositor_state: CompositorState,
    layer_shell: LayerShell,
    shm: Shm,
    qh: QueueHandle<State>,

    surfaces: Vec<BgSurface>,
    wallpaper: Option<Wallpaper>,
    color_hub: Arc<ColorHub>,

    /// Output whose bar strip drives the published colors; empty = first output.
    monitor: String,
    /// Height of the bar strip to sample, in pixels.
    bar_height: u32,
}

impl State {
    pub fn new(
        globals: &GlobalList,
        qh: QueueHandle<State>,
        color_hub: Arc<ColorHub>,
        monitor: String,
        bar_height: u32,
    ) -> Result<Self, String> {
        let registry_state = RegistryState::new(globals);
        let output_state = OutputState::new(globals, &qh);
        let compositor_state =
            CompositorState::bind(globals, &qh).map_err(|err| format!("wl_compositor: {err}"))?;
        let layer_shell =
            LayerShell::bind(globals, &qh).map_err(|err| format!("wlr-layer-shell: {err}"))?;
        let shm = Shm::bind(globals, &qh).map_err(|err| format!("wl_shm: {err}"))?;

        Ok(Self {
            registry_state,
            output_state,
            compositor_state,
            layer_shell,
            shm,
            qh,
            surfaces: Vec::new(),
            wallpaper: None,
            color_hub,
            monitor,
            bar_height,
        })
    }

    pub fn handle_request(&mut self, request: DaemonRequest) {
        match request {
            DaemonRequest::SetWallpaper(path) => self.set_wallpaper(&path),
        }
    }

    fn set_wallpaper(&mut self, path: &Path) {
        match Wallpaper::load(path) {
            Ok(wallpaper) => {
                log::info!("wallpaper: {}", path.display());
                self.wallpaper = Some(wallpaper);
                self.redraw_all();
            }
            Err(err) => log::error!("{err}"),
        }
    }

    fn redraw_all(&mut self) {
        for index in 0..self.surfaces.len() {
            self.draw_one(index);
        }
    }

    /// The surface index whose colors are published: the one matching `monitor`,
    /// else the first output.
    fn primary_index(&self) -> Option<usize> {
        if !self.monitor.is_empty() {
            let matched = self
                .surfaces
                .iter()
                .position(|surface| surface.output_name.as_deref() == Some(self.monitor.as_str()));
            if matched.is_some() {
                return matched;
            }
        }
        if self.surfaces.is_empty() {
            return None;
        }
        Some(0)
    }

    fn draw_one(&mut self, index: usize) {
        let (width, height) = {
            let surface = &self.surfaces[index];
            if !surface.configured || surface.width == 0 || surface.height == 0 {
                return;
            }
            (surface.width, surface.height)
        };

        // Scale the wallpaper for this output; the borrow ends once render returns.
        let rgba = match &self.wallpaper {
            Some(wallpaper) => wallpaper.render(width, height),
            None => return,
        };

        let stops = match self.primary_index() == Some(index) {
            true => Some(wallpaper::sample_strip(&rgba, self.bar_height, SEGMENTS)),
            false => None,
        };

        {
            let shm = &self.shm;
            self.surfaces[index].draw(shm, &rgba, width, height);
        }

        if let Some(stops) = stops {
            log::info!("bar colors: {} stops", stops.len());
            self.color_hub.publish(stops);
        }
    }

    fn create_surface(&mut self, output: wl_output::WlOutput) {
        let output_name = self
            .output_state
            .info(&output)
            .and_then(|info| info.name);
        let wl_surface = self.compositor_state.create_surface(&self.qh);
        let layer = self.layer_shell.create_layer_surface(
            &self.qh,
            wl_surface,
            SctkLayer::Background,
            Some("neoshell.wallpaper".to_string()),
            Some(&output),
        );
        layer.set_anchor(Anchor::TOP | Anchor::BOTTOM | Anchor::LEFT | Anchor::RIGHT);
        // -1: fill the whole output, ignoring other surfaces' exclusive zones, so
        // the wallpaper extends under the bar.
        layer.set_exclusive_zone(-1);
        layer.set_size(0, 0);
        layer.commit();

        self.surfaces.push(BgSurface {
            output,
            output_name,
            layer,
            width: 0,
            height: 0,
            configured: false,
            pool: None,
            pool_dims: (0, 0),
        });
    }

    fn surface_index(&self, layer: &LayerSurface) -> Option<usize> {
        self.surfaces
            .iter()
            .position(|surface| &surface.layer == layer)
    }
}

impl CompositorHandler for State {
    fn scale_factor_changed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _new_factor: i32,
    ) {
    }

    fn transform_changed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _new_transform: wl_output::Transform,
    ) {
    }

    fn frame(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _time: u32,
    ) {
    }

    fn surface_enter(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _output: &wl_output::WlOutput,
    ) {
    }

    fn surface_leave(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _output: &wl_output::WlOutput,
    ) {
    }
}

impl LayerShellHandler for State {
    fn closed(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, layer: &LayerSurface) {
        self.surfaces.retain(|surface| &surface.layer != layer);
    }

    fn configure(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        layer: &LayerSurface,
        configure: LayerSurfaceConfigure,
        _serial: u32,
    ) {
        let Some(index) = self.surface_index(layer) else {
            return;
        };
        let (width, height) = configure.new_size;
        if width != 0 {
            self.surfaces[index].width = width;
        }
        if height != 0 {
            self.surfaces[index].height = height;
        }
        self.surfaces[index].configured = true;
        self.draw_one(index);
    }
}

impl OutputHandler for State {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.output_state
    }

    fn new_output(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        output: wl_output::WlOutput,
    ) {
        self.create_surface(output);
    }

    fn update_output(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _output: wl_output::WlOutput,
    ) {
    }

    fn output_destroyed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        output: wl_output::WlOutput,
    ) {
        self.surfaces.retain(|surface| surface.output != output);
    }
}

impl ShmHandler for State {
    fn shm_state(&mut self) -> &mut Shm {
        &mut self.shm
    }
}

impl ProvidesRegistryState for State {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.registry_state
    }
    registry_handlers![OutputState];
}

delegate_compositor!(State);
delegate_output!(State);
delegate_shm!(State);
delegate_layer!(State);
delegate_registry!(State);
