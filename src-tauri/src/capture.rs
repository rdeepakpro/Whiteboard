//! Screenshot capture using macOS's own `screencapture` tool, so region and
//! window selection look and behave exactly like ⌘⇧4. The image is written to
//! a temp file in the app's cache, read back, and deleted — nothing is left
//! on the Desktop.
//!
//! macOS requires the Screen Recording permission for an app to capture other
//! apps' windows. Whiteboard checks it with CGPreflightScreenCaptureAccess and
//! asks once with CGRequestScreenCaptureAccess.

use crate::files::now_ms;
use std::fs;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Whether Whiteboard may capture the screen. With `request`, macOS shows its
/// one-time permission prompt (and lists Whiteboard in System Settings).
#[tauri::command]
pub fn screen_capture_access(request: bool) -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        if CGPreflightScreenCaptureAccess() {
            return true;
        }
        if request {
            return CGRequestScreenCaptureAccess();
        }
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request;
        true
    }
}

#[tauri::command]
pub fn open_screen_recording_settings() {
    let _ = Command::new("/usr/bin/open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn();
}

static CAPTURING: AtomicBool = AtomicBool::new(false);

/// Runs the capture. `mode`: "region" | "window" | "screen". Returns the PNG
/// as base64, or None when the user cancelled (Esc).
#[tauri::command]
pub async fn capture_screen(
    app: AppHandle,
    mode: String,
    hide_app: bool,
) -> Result<Option<String>, String> {
    if CAPTURING.swap(true, Ordering::SeqCst) {
        return Ok(None); // a capture is already in progress
    }
    let dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("captures");
    let _ = fs::create_dir_all(&dir);
    let file = dir.join(format!("capture-{}.png", now_ms()));

    if hide_app {
        let _ = app.hide();
        // Let the hide animation finish so Whiteboard isn't in the shot.
        std::thread::sleep(std::time::Duration::from_millis(220));
    }

    let path = file.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("/usr/sbin/screencapture");
        // -x: no sound. -o: no window shadow.
        match mode.as_str() {
            "window" => cmd.args(["-x", "-o", "-i", "-W"]),
            "screen" => cmd.args(["-x", "-m"]),
            _ => cmd.args(["-x", "-i"]),
        };
        cmd.arg(&path).status()
    })
    .await;

    if hide_app {
        let _ = app.show();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    CAPTURING.store(false, Ordering::SeqCst);

    match status {
        Ok(Ok(_)) => {}
        _ => return Err("IO: couldn't run the macOS screenshot tool".into()),
    }
    // No file means the user pressed Esc.
    let Ok(bytes) = fs::read(&file) else {
        return Ok(None);
    };
    let _ = fs::remove_file(&file);
    if bytes.is_empty() {
        return Ok(None);
    }
    use base64::Engine;
    Ok(Some(
        base64::engine::general_purpose::STANDARD.encode(bytes),
    ))
}

pub const CAPTURE_SHORTCUT: &str = "CmdOrCtrl+Shift+2";

/// Enables/disables the system-wide ⌘⇧2 capture shortcut. Returns an error
/// string if another app already owns the shortcut.
#[tauri::command]
pub fn set_global_capture_shortcut(app: AppHandle, enabled: bool) -> Result<(), String> {
    let gs = app.global_shortcut();
    let shortcut: Shortcut = CAPTURE_SHORTCUT.parse().map_err(|e| format!("{e:?}"))?;
    let registered = gs.is_registered(shortcut);
    if enabled && !registered {
        gs.on_shortcut(shortcut, |app, _sc, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit("menu", "capture-region".to_string());
            }
        })
        .map_err(|e| format!("EXISTS: {e}"))?;
    } else if !enabled && registered {
        gs.unregister(shortcut).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reads an image from the system clipboard (screenshots, images copied in
/// Preview or a browser) and returns it as base64 PNG, or None.
#[tauri::command]
pub fn clipboard_image_png(app: AppHandle) -> Option<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let img = app.clipboard().read_image().ok()?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return None;
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(img.rgba()).ok()?;
    }
    use base64::Engine;
    Some(base64::engine::general_purpose::STANDARD.encode(out))
}
