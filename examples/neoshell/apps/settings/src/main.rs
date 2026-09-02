//! neoshell settings — a standalone application that hosts the shell's settings UI
//! in its own window. Tauri supplies the native window and the system WebView
//! (WebKitGTK on Linux); the page itself is the existing frontend served by the
//! shell at `?view=settings`, and it talks to the Go core over the same WebSocket
//! bus. This binary holds no shell logic — it is just the window.

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// The URL to load. The shell passes the served frontend (Vite in dev, the Go
/// server in prod) with `?view=settings`; the page resolves the WS bus from its
/// own `?port=` query, exactly as the bar does.
fn settings_url() -> String {
    std::env::var("NEOSHELL_SETTINGS_URL")
        .unwrap_or_else(|_| "http://localhost:9876?view=settings".to_string())
}

/// WebKitGTK's DMABUF renderer triggers "Protocol error dispatching to Wayland
/// display" and a web-process crash on some wlroots/GPU combinations, especially
/// for a transparent window. Force the SHM path; a settings window does not need
/// GPU compositing. An explicit caller-set value still wins.
fn disable_webkit_dmabuf_renderer() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

fn main() {
    disable_webkit_dmabuf_renderer();
    tauri::Builder::default()
        .setup(|app| {
            let parsed = settings_url().parse().expect("valid NEOSHELL_SETTINGS_URL");
            // Borderless + transparent so the page's own rounded card chrome and the
            // shared translucent background show through. Moved via the compositor;
            // closed via the in-page button or the window manager.
            WebviewWindowBuilder::new(app, "settings", WebviewUrl::External(parsed))
                .title("neoshell settings")
                .inner_size(960.0, 640.0)
                .decorations(false)
                .transparent(true)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run neoshell settings");
}
