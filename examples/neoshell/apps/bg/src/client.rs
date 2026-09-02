//! CLI client: connects to a running daemon and issues one request.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;

use crate::ipc::{socket_path, Request, Response};

/// Set the wallpaper to `path` (resolved to an absolute path first).
pub fn set_wallpaper(path: &str) -> Result<(), String> {
    let absolute = std::fs::canonicalize(path)
        .map_err(|err| format!("resolve {path}: {err}"))?;
    let response = send(&Request::Img { path: absolute })?;
    match response {
        Response::Ok => Ok(()),
        Response::Error { message } => Err(message),
        other => Err(format!("unexpected response: {other:?}")),
    }
}

/// Print the current bar-strip gradient stops as JSON.
pub fn print_colors() -> Result<(), String> {
    let response = send(&Request::Colors)?;
    match response {
        Response::Colors { stops } => {
            let json = serde_json::to_string(&stops).map_err(|err| err.to_string())?;
            println!("{json}");
            Ok(())
        }
        Response::Error { message } => Err(message),
        other => Err(format!("unexpected response: {other:?}")),
    }
}

/// Send one request and read exactly one response line.
fn send(request: &Request) -> Result<Response, String> {
    let stream = connect()?;
    write_request(&stream, request)?;
    read_response(&stream)
}

fn connect() -> Result<UnixStream, String> {
    let path = socket_path();
    UnixStream::connect(&path)
        .map_err(|err| format!("connect {}: {err} (is the daemon running?)", path.display()))
}

fn write_request(stream: &UnixStream, request: &Request) -> Result<(), String> {
    let mut line = serde_json::to_string(request).map_err(|err| err.to_string())?;
    line.push('\n');
    let mut writer = stream;
    writer
        .write_all(line.as_bytes())
        .map_err(|err| format!("write request: {err}"))
}

fn read_response(stream: &UnixStream) -> Result<Response, String> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|err| format!("read response: {err}"))?;
    if line.trim().is_empty() {
        return Err("daemon closed the connection without responding".to_string());
    }
    serde_json::from_str(line.trim()).map_err(|err| format!("parse response: {err}"))
}
