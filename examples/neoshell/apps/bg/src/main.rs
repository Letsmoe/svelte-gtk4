//! neoshell-bg — a small Wayland wallpaper daemon (swww-like) that also publishes
//! the averaged colors of the strip behind the bar, so the bar can tint itself
//! to the wallpaper.
//!
//! Usage:
//!   neoshell-bg [daemon] [IMAGE]   run the daemon (optionally setting a wallpaper)
//!   neoshell-bg img <IMAGE>        set the wallpaper on a running daemon
//!   neoshell-bg colors             print the current bar gradient stops as JSON

mod client;
mod colors;
mod daemon;
mod ipc;
mod wallpaper;

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use calloop::channel::{channel, Event as ChannelEvent, Sender};
use calloop::EventLoop;
use calloop_wayland_source::WaylandSource;
use wayland_client::globals::registry_queue_init;
use wayland_client::Connection;

use colors::ColorHub;
use daemon::{DaemonRequest, State};
use ipc::{socket_path, Request, Response};

const DEFAULT_BAR_HEIGHT: u32 = 36;

fn main() {
    env_logger::init();

    let mut args = std::env::args().skip(1);
    let result = match args.next().as_deref() {
        Some("img") => match args.next() {
            Some(path) => client::set_wallpaper(&path),
            None => Err("img needs an image path".to_string()),
        },
        Some("colors") => client::print_colors(),
        Some("--help") | Some("-h") => {
            print_usage();
            return;
        }
        Some("daemon") => run_daemon(args.next().map(PathBuf::from)),
        None => run_daemon(None),
        Some(other) => Err(format!("unknown command {other:?} (try --help)")),
    };

    if let Err(message) = result {
        eprintln!("neoshell-bg: {message}");
        std::process::exit(1);
    }
}

fn print_usage() {
    println!(
        "neoshell-bg - Wayland wallpaper daemon for neoshell\n\n\
         Usage:\n  \
         neoshell-bg [daemon] [IMAGE]   run the daemon (optionally setting a wallpaper)\n  \
         neoshell-bg img <IMAGE>        set the wallpaper on a running daemon\n  \
         neoshell-bg colors             print the current bar gradient stops as JSON\n\n\
         Environment:\n  \
         NEOSHELL_MONITOR       output whose strip drives the bar colors (default: first)\n  \
         NEOSHELL_BAR_HEIGHT    bar strip height in px to sample (default: {DEFAULT_BAR_HEIGHT})"
    );
}

fn run_daemon(initial_wallpaper: Option<PathBuf>) -> Result<(), String> {
    let monitor = std::env::var("NEOSHELL_MONITOR").unwrap_or_default();
    let bar_height = std::env::var("NEOSHELL_BAR_HEIGHT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_BAR_HEIGHT);

    let color_hub = ColorHub::new();

    let conn = Connection::connect_to_env().map_err(|err| format!("connect wayland: {err}"))?;
    let (globals, event_queue) =
        registry_queue_init(&conn).map_err(|err| format!("registry init: {err}"))?;
    let qh = event_queue.handle();
    let mut state = State::new(&globals, qh.clone(), color_hub.clone(), monitor, bar_height)?;

    let mut event_loop: EventLoop<State> =
        EventLoop::try_new().map_err(|err| format!("event loop: {err}"))?;
    let loop_handle = event_loop.handle();

    WaylandSource::new(conn, event_queue)
        .insert(loop_handle.clone())
        .map_err(|err| format!("insert wayland source: {err}"))?;

    let (sender, channel) = channel::<DaemonRequest>();
    loop_handle
        .insert_source(channel, |event, _, state: &mut State| {
            if let ChannelEvent::Msg(request) = event {
                state.handle_request(request);
            }
        })
        .map_err(|err| format!("insert request channel: {err}"))?;

    spawn_listener(sender.clone(), color_hub)?;

    if let Some(path) = initial_wallpaper {
        match std::fs::canonicalize(&path) {
            Ok(absolute) => {
                let _ = sender.send(DaemonRequest::SetWallpaper(absolute));
            }
            Err(err) => log::error!("resolve {}: {err}", path.display()),
        }
    }

    log::info!("neoshell-bg daemon running");
    loop {
        if let Err(err) = event_loop.dispatch(None, &mut state) {
            return Err(format!("dispatch: {err}"));
        }
    }
}

/// Bind the control socket and accept clients, one handler thread each.
fn spawn_listener(sender: Sender<DaemonRequest>, color_hub: Arc<ColorHub>) -> Result<(), String> {
    let path = socket_path();
    let _ = std::fs::remove_file(&path);
    let listener =
        UnixListener::bind(&path).map_err(|err| format!("bind {}: {err}", path.display()))?;
    log::info!("control socket: {}", path.display());

    thread::spawn(move || {
        for stream in listener.incoming() {
            let stream = match stream {
                Ok(stream) => stream,
                Err(err) => {
                    log::warn!("accept: {err}");
                    continue;
                }
            };
            let sender = sender.clone();
            let color_hub = color_hub.clone();
            thread::spawn(move || handle_connection(stream, sender, color_hub));
        }
    });
    Ok(())
}

fn handle_connection(stream: UnixStream, sender: Sender<DaemonRequest>, color_hub: Arc<ColorHub>) {
    let read_half = match stream.try_clone() {
        Ok(clone) => clone,
        Err(err) => {
            log::warn!("clone stream: {err}");
            return;
        }
    };
    let reader = BufReader::new(read_half);
    let mut writer = stream;

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => return,
        };
        if line.trim().is_empty() {
            continue;
        }
        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(err) => {
                let _ = write_response(&mut writer, &Response::Error { message: format!("parse: {err}") });
                continue;
            }
        };
        match request {
            Request::Img { path } => {
                if sender.send(DaemonRequest::SetWallpaper(path)).is_err() {
                    return;
                }
                let _ = write_response(&mut writer, &Response::Ok);
            }
            Request::Colors => {
                let stops = color_hub.current().unwrap_or_default();
                let _ = write_response(&mut writer, &Response::Colors { stops });
            }
            Request::Subscribe => {
                stream_colors(&mut writer, &color_hub);
                return;
            }
        }
    }
}

/// Stream gradient stops to a subscriber until the connection drops.
fn stream_colors(writer: &mut UnixStream, color_hub: &Arc<ColorHub>) {
    let receiver = color_hub.subscribe();
    while let Ok(stops) = receiver.recv() {
        if write_response(writer, &Response::Colors { stops }).is_err() {
            return;
        }
    }
}

fn write_response(writer: &mut UnixStream, response: &Response) -> std::io::Result<()> {
    let mut line = serde_json::to_string(response).unwrap_or_else(|_| "{}".to_string());
    line.push('\n');
    writer.write_all(line.as_bytes())?;
    writer.flush()
}
