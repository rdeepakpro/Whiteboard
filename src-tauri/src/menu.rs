//! Native macOS menu bar. Custom items emit a `menu` event carrying the item
//! id; the frontend's command registry performs the action. Clipboard items
//! use predefined (native) items so text fields and Excalidraw's own
//! copy/cut/paste DOM handlers keep working.

use serde::Deserialize;
use tauri::menu::{
    AboutMetadataBuilder, CheckMenuItemBuilder, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu,
    SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MenuState {
    #[serde(default)]
    pub recents: Vec<RecentItem>,
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub has_board: bool,
}

#[derive(Deserialize, Clone)]
pub struct RecentItem {
    pub path: String,
    pub name: String,
}

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    label: &str,
    accel: Option<&str>,
    enabled: bool,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let mut b = MenuItemBuilder::with_id(id, label).enabled(enabled);
    if let Some(a) = accel {
        b = b.accelerator(a);
    }
    b.build(app)
}

pub fn build<R: Runtime>(app: &AppHandle<R>, state: &MenuState) -> tauri::Result<Menu<R>> {
    let pkg = app.package_info();
    let about = AboutMetadataBuilder::new()
        .name(Some("Whiteboard"))
        .version(Some(pkg.version.to_string()))
        .credits(Some(
            "Drawing editor powered by Excalidraw (MIT License, © Excalidraw).\nSee Settings → About for all licenses.",
        ))
        .build();
    let b = state.has_board;

    let app_menu = SubmenuBuilder::new(app, "Whiteboard")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Whiteboard"),
            Some(about),
        )?)
        .separator()
        .item(&item(
            app,
            "settings",
            "Settings…",
            Some("CmdOrCtrl+,"),
            true,
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Whiteboard"))?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&item(
            app,
            "quit",
            "Quit Whiteboard",
            Some("CmdOrCtrl+Q"),
            true,
        )?)
        .build()?;

    let mut recent = SubmenuBuilder::new(app, "Open Recent");
    if state.recents.is_empty() {
        recent = recent.item(&item(app, "noop", "No Recent Boards", None, false)?);
    } else {
        for r in state.recents.iter().take(15) {
            recent = recent.item(&item(
                app,
                &format!("recent:{}", r.path),
                &r.name,
                None,
                true,
            )?);
        }
        recent = recent
            .separator()
            .item(&item(app, "clear-recents", "Clear Menu", None, true)?);
    }
    let recent = recent.build()?;

    let export = SubmenuBuilder::new(app, "Export")
        .item(&item(app, "export-png", "PNG Image…", None, b)?)
        .item(&item(app, "export-svg", "SVG Image…", None, b)?)
        .item(&item(app, "copy-png", "Copy as PNG", None, b)?)
        .separator()
        .item(&item(
            app,
            "export-dialog",
            "Export Image Options…",
            Some("CmdOrCtrl+Shift+E"),
            b,
        )?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item(
            app,
            "new-board",
            "New Board",
            Some("CmdOrCtrl+N"),
            true,
        )?)
        .item(&item(
            app,
            "new-from-template",
            "New from Template…",
            Some("CmdOrCtrl+Alt+N"),
            true,
        )?)
        .item(&item(
            app,
            "new-folder",
            "New Folder",
            Some("CmdOrCtrl+Shift+N"),
            true,
        )?)
        .separator()
        .item(&item(app, "open", "Open…", Some("CmdOrCtrl+O"), true)?)
        .item(&recent)
        .separator()
        .item(&item(
            app,
            "close-tab",
            "Close Board",
            Some("CmdOrCtrl+W"),
            b,
        )?)
        .item(&item(
            app,
            "reopen-closed",
            "Reopen Closed Board",
            Some("CmdOrCtrl+Shift+T"),
            true,
        )?)
        .item(&item(app, "save", "Save", Some("CmdOrCtrl+S"), b)?)
        .item(&item(
            app,
            "save-as",
            "Save As…",
            Some("CmdOrCtrl+Shift+S"),
            b,
        )?)
        .item(&item(
            app,
            "save-as-template",
            "Save as Template…",
            None,
            b,
        )?)
        .separator()
        .item(&export)
        .item(&item(app, "import-library", "Import Library…", None, true)?)
        .separator()
        .item(&item(
            app,
            "history",
            "Version History…",
            Some("CmdOrCtrl+Y"),
            b,
        )?)
        .item(&item(app, "reveal", "Show in Finder", None, b)?)
        .build()?;

    // Undo/redo are custom items: the native undo: selector would act on the
    // web view, not on Excalidraw's own history.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item(app, "undo", "Undo", Some("CmdOrCtrl+Z"), true)?)
        .item(&item(app, "redo", "Redo", Some("CmdOrCtrl+Shift+Z"), true)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&item(
            app,
            "select-all",
            "Select All",
            Some("CmdOrCtrl+A"),
            true,
        )?)
        .separator()
        .item(&item(
            app,
            "find-on-canvas",
            "Find on Canvas",
            Some("CmdOrCtrl+F"),
            b,
        )?)
        .item(&item(
            app,
            "palette",
            "Search Boards & Commands…",
            Some("CmdOrCtrl+K"),
            true,
        )?)
        .separator()
        .item(&item(
            app,
            "send-to-action",
            "Send Selection to Action…",
            Some("CmdOrCtrl+Alt+A"),
            b,
        )?)
        .build()?;

    let insert = SubmenuBuilder::new(app, "Insert")
        .item(&item(app, "insert-web-ref", "Web Reference…", None, b)?)
        .separator()
        .item(&item(
            app,
            "capture-region",
            "Screenshot of Region",
            Some("CmdOrCtrl+Shift+2"),
            true,
        )?)
        .item(&item(
            app,
            "capture-window",
            "Screenshot of Window",
            None,
            true,
        )?)
        .item(&item(
            app,
            "capture-screen",
            "Screenshot of Full Screen",
            None,
            true,
        )?)
        .separator()
        .item(&item(app, "paste-image", "Image from Clipboard", None, b)?)
        .build()?;

    let theme_item = |id: &str, label: &str| {
        CheckMenuItemBuilder::with_id(id, label)
            .checked(state.theme == id.trim_start_matches("theme-"))
            .build(app)
    };
    let view = SubmenuBuilder::new(app, "View")
        .item(&item(app, "mode-brainstorm", "Brainstorm", None, true)?)
        .item(&item(app, "mode-action", "Action", None, true)?)
        .item(&item(
            app,
            "toggle-mode",
            "Switch Brainstorm / Action",
            Some("CmdOrCtrl+Shift+A"),
            true,
        )?)
        .separator()
        .item(&item(
            app,
            "toggle-sidebar",
            "Toggle Sidebar",
            Some("CmdOrCtrl+\\"),
            true,
        )?)
        .item(&item(
            app,
            "focus-mode",
            "Focus Mode",
            Some("CmdOrCtrl+Shift+F"),
            true,
        )?)
        .separator()
        .item(&item(app, "zoom-in", "Zoom In", Some("CmdOrCtrl+="), b)?)
        .item(&item(app, "zoom-out", "Zoom Out", Some("CmdOrCtrl+-"), b)?)
        .item(&item(
            app,
            "zoom-reset",
            "Actual Size",
            Some("CmdOrCtrl+0"),
            b,
        )?)
        .item(&item(app, "zoom-fit", "Zoom to Fit", None, b)?)
        .separator()
        .item(&theme_item("theme-light", "Light")?)
        .item(&theme_item("theme-dark", "Dark")?)
        .item(&theme_item("theme-system", "System")?)
        .separator()
        .item(&item(
            app,
            "shortcuts",
            "Keyboard Shortcuts",
            Some("CmdOrCtrl+/"),
            true,
        )?)
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let mut window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .item(&item(
            app,
            "next-tab",
            "Show Next Tab",
            Some("Ctrl+Tab"),
            b,
        )?)
        .item(&item(
            app,
            "prev-tab",
            "Show Previous Tab",
            Some("Ctrl+Shift+Tab"),
            b,
        )?)
        .separator();
    for n in 1..=9 {
        window = window.item(&item(
            app,
            &format!("tab:{n}"),
            &format!("Tab {n}"),
            Some(&format!("CmdOrCtrl+{n}")),
            b,
        )?);
    }
    let window: Submenu<R> = window.build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&item(app, "shortcuts", "Keyboard Shortcuts", None, true)?)
        .item(&item(
            app,
            "licenses",
            "Licenses & Acknowledgements",
            None,
            true,
        )?)
        .build()?;

    Menu::with_items(
        app,
        &[&app_menu, &file, &edit, &insert, &view, &window, &help],
    )
}

pub fn install<R: Runtime>(app: &AppHandle<R>, state: &MenuState) -> tauri::Result<()> {
    let menu = build(app, state)?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn forward_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id.to_string());
}

#[tauri::command]
pub fn update_menu(app: AppHandle, state: MenuState) -> Result<(), String> {
    install(&app, &state).map_err(|e| e.to_string())
}
