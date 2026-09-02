//! Control protocol between the `neoshell-bg` daemon, its CLI client, and the Go
//! core. Newline-delimited JSON over a unix socket.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// A request sent by a client to the daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
pub enum Request {
    /// Set the wallpaper to the image at `path`.
    Img { path: PathBuf },
    /// Read the current bar-strip gradient stops once, then disconnect.
    Colors,
    /// Stream gradient stops: the current set immediately, then again on every
    /// wallpaper change, until the connection closes. Used by the Go core.
    Subscribe,
}

/// A response sent by the daemon to a client.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Response {
    /// Acknowledge a command that has no data to return.
    Ok,
    /// Report a failed command.
    Error { message: String },
    /// The averaged colors of the strip directly behind the bar, left to right.
    /// Each stop is `[r, g, b]`; the frontend interpolates them into a gradient.
    Colors { stops: Vec<[u8; 3]> },
}

/// Default control-socket path, under `$XDG_RUNTIME_DIR`.
pub fn socket_path() -> PathBuf {
    let runtime = std::env::var("XDG_RUNTIME_DIR")
        .unwrap_or_else(|_| format!("/run/user/{}", unsafe { getuid() }));
    PathBuf::from(runtime).join("neoshell-bg.sock")
}

extern "C" {
    fn getuid() -> u32;
}
