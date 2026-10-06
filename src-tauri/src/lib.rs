//! Whiteboard's native shell. The Excalidraw editor and all UI live in the web
//! frontend; Rust provides safe file I/O, app data storage, native menus, and
//! macOS document integration (Finder "Open With", dock drops).

mod appdata;
mod capture;
mod files;
mod menu;
mod search;
mod webref;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_window_state::StateFlags;

/// Files the OS asked us to open before the frontend was ready to receive them.
#[derive(Default)]
struct PendingOpens(Mutex<Vec<String>>);

/// Set once the frontend has flushed all saves and allows the app to exit.
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);
static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn take_pending_opens(state: tauri::State<'_, PendingOpens>) -> Vec<String> {
    FRONTEND_READY.store(true, Ordering::SeqCst);
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Called by the frontend after every open board has been saved.
#[tauri::command]
fn quit_app(app: AppHandle) {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    use tauri_plugin_window_state::AppHandleExt;
    let _ = app.save_window_state(window_flags());
    app.exit(0);
}

fn window_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

fn request_quit(app: &AppHandle) {
    if FRONTEND_READY.load(Ordering::SeqCst) {
        let _ = app.emit("quit-requested", ());
    } else {
        ALLOW_EXIT.store(true, Ordering::SeqCst);
        app.exit(0);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_flags())
                .build(),
        )
        .manage(PendingOpens::default())
        .manage(search::SearchIndex::default())
        .invoke_handler(tauri::generate_handler![
            take_pending_opens,
            quit_app,
            files::read_text,
            files::write_board,
            files::write_text,
            files::write_base64,
            files::read_base64,
            files::stat_path,
            files::scan_tree,
            files::create_folder,
            files::create_board,
            files::move_path,
            files::copy_file,
            files::unique_path,
            files::locate_file,
            appdata::app_paths,
            appdata::thumb_info,
            appdata::thumb_write,
            appdata::history_snapshot,
            appdata::history_list,
            appdata::history_read,
            appdata::rekey_paths,
            appdata::trash_item,
            appdata::trash_list,
            appdata::trash_restore,
            appdata::trash_delete,
            appdata::trash_empty,
            search::search_text,
            search::board_digests,
            webref::local_ai,
            webref::local_ai_models,
            webref::link_preview,
            capture::screen_capture_access,
            capture::open_screen_recording_settings,
            capture::capture_screen,
            capture::set_global_capture_shortcut,
            capture::clipboard_image_png,
            menu::update_menu,
        ])
        .setup(|app| {
            menu::install(app.handle(), &menu::MenuState::default())?;
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                if id == "quit" {
                    request_quit(app);
                } else {
                    menu::forward_event(app, id);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !ALLOW_EXIT.load(Ordering::SeqCst) {
                    api.prevent_close();
                    request_quit(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Whiteboard");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            if !ALLOW_EXIT.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_quit(app);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let paths: Vec<String> = urls
                .into_iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            if FRONTEND_READY.load(Ordering::SeqCst) {
                let _ = app.emit("open-files", paths);
            } else {
                app.state::<PendingOpens>().0.lock().unwrap().extend(paths);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        _ => {}
    });
}
