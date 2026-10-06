//! Whiteboard-specific data that lives outside the `.excalidraw` files, under
//! the app data directory (~/Library/Application Support/com.local.whiteboard):
//!
//! ```text
//! state.json            metadata + session (written by the frontend)
//! library.excalidrawlib personal Excalidraw library
//! thumbs/<key>.png      board thumbnails
//! history/<key>/<ms>.excalidraw   version snapshots
//! trash/<id>/<name>     trashed boards/folders + trash/<id>/.trash.json
//! templates/*.excalidraw          user templates
//! ```
//!
//! `<key>` is a stable FNV-1a hash of the board's absolute path. When a board
//! is renamed or moved in-app, its thumbnail and history move with it.

use crate::files::{atomic_write, err, move_any, mtime_ms, now_ms};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("whiteboard"));
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn path_key(path: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    data_dir: String,
    default_root: String,
    templates_dir: String,
    library_file: String,
    state_file: String,
}

#[tauri::command]
pub fn app_paths(app: AppHandle) -> AppPaths {
    let data = data_dir(&app);
    let docs = app
        .path()
        .document_dir()
        .unwrap_or_else(|_| app.path().home_dir().unwrap_or_default());
    let templates = data.join("templates");
    let _ = fs::create_dir_all(&templates);
    AppPaths {
        default_root: docs.join("Whiteboard").to_string_lossy().to_string(),
        templates_dir: templates.to_string_lossy().to_string(),
        library_file: data
            .join("library.excalidrawlib")
            .to_string_lossy()
            .to_string(),
        state_file: data.join("state.json").to_string_lossy().to_string(),
        data_dir: data.to_string_lossy().to_string(),
    }
}

// ---------------------------------------------------------------- thumbnails

fn thumb_path(app: &AppHandle, board: &str) -> PathBuf {
    data_dir(app)
        .join("thumbs")
        .join(format!("{}.png", path_key(board)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbInfo {
    path: String,
    /// Absolute path of the cached PNG, or null when none exists yet.
    thumb: Option<String>,
    thumb_mtime: u64,
    board_mtime: u64,
    exists: bool,
}

#[tauri::command]
pub fn thumb_info(app: AppHandle, paths: Vec<String>) -> Vec<ThumbInfo> {
    paths
        .into_iter()
        .map(|p| {
            let t = thumb_path(&app, &p);
            let tm = mtime_ms(&t);
            ThumbInfo {
                thumb: tm.map(|_| t.to_string_lossy().to_string()),
                thumb_mtime: tm.unwrap_or(0),
                board_mtime: mtime_ms(Path::new(&p)).unwrap_or(0),
                exists: Path::new(&p).exists(),
                path: p,
            }
        })
        .collect()
}

#[tauri::command]
pub fn thumb_write(app: AppHandle, path: String, data: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("INVALID: {e}"))?;
    let t = thumb_path(&app, &path);
    atomic_write(&t, &bytes)?;
    Ok(t.to_string_lossy().to_string())
}

// ------------------------------------------------------------------ history

fn history_dir(app: &AppHandle, board: &str) -> PathBuf {
    data_dir(app).join("history").join(path_key(board))
}

#[derive(Serialize)]
pub struct Snapshot {
    id: u64,
    size: u64,
}

fn list_snapshots(dir: &Path) -> Vec<Snapshot> {
    let mut out: Vec<Snapshot> = fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let id = name.strip_suffix(".excalidraw")?.parse::<u64>().ok()?;
                    Some(Snapshot {
                        id,
                        size: e.metadata().map(|m| m.len()).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.id.cmp(&a.id));
    out
}

/// Retention: keep everything from the last 2 hours (max 30), then one per
/// hour for the last day, then one per day for 60 days, capped at `max_total`.
fn prune(dir: &Path, max_total: usize) {
    let snaps = list_snapshots(dir);
    let now = now_ms();
    const HOUR: u64 = 3_600_000;
    const DAY: u64 = 24 * HOUR;
    let mut keep_buckets = std::collections::HashSet::new();
    let mut recent = 0;
    let mut kept = 0;
    for s in &snaps {
        let age = now.saturating_sub(s.id);
        let keep = if age < 2 * HOUR {
            recent += 1;
            recent <= 30
        } else if age < DAY {
            keep_buckets.insert(format!("h{}", s.id / HOUR))
        } else if age < 60 * DAY {
            keep_buckets.insert(format!("d{}", s.id / DAY))
        } else {
            false
        };
        if keep && kept < max_total {
            kept += 1;
        } else {
            let _ = fs::remove_file(dir.join(format!("{}.excalidraw", s.id)));
        }
    }
}

/// Records a snapshot unless the newest one is younger than `min_interval_ms`
/// or identical in content. Returns whether a snapshot was written.
#[tauri::command]
pub fn history_snapshot(
    app: AppHandle,
    path: String,
    content: String,
    min_interval_ms: u64,
    max_total: Option<usize>,
) -> Result<bool, String> {
    let dir = history_dir(&app, &path);
    let snaps = list_snapshots(&dir);
    if let Some(latest) = snaps.first() {
        if now_ms().saturating_sub(latest.id) < min_interval_ms {
            return Ok(false);
        }
        let latest_file = dir.join(format!("{}.excalidraw", latest.id));
        if latest.size == content.len() as u64 {
            if let Ok(prev) = fs::read_to_string(&latest_file) {
                if prev == content {
                    return Ok(false);
                }
            }
        }
    }
    let id = now_ms();
    atomic_write(&dir.join(format!("{id}.excalidraw")), content.as_bytes())?;
    prune(&dir, max_total.unwrap_or(80));
    Ok(true)
}

#[tauri::command]
pub fn history_list(app: AppHandle, path: String) -> Vec<Snapshot> {
    list_snapshots(&history_dir(&app, &path))
}

#[tauri::command]
pub fn history_read(app: AppHandle, path: String, id: u64) -> Result<String, String> {
    fs::read_to_string(history_dir(&app, &path).join(format!("{id}.excalidraw")))
        .map_err(|e| err(e, "read snapshot"))
}

/// Re-keys thumbnail + history after an in-app rename/move. For folders,
/// every board below the folder is re-keyed.
#[tauri::command]
pub fn rekey_paths(app: AppHandle, pairs: Vec<(String, String)>) {
    for (from, to) in pairs {
        let (hf, ht) = (history_dir(&app, &from), history_dir(&app, &to));
        if hf.exists() && !ht.exists() {
            let _ = move_any(&hf, &ht);
        }
        let (tf, tt) = (thumb_path(&app, &from), thumb_path(&app, &to));
        if tf.exists() {
            let _ = move_any(&tf, &tt);
        }
    }
}

// -------------------------------------------------------------------- trash

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    id: String,
    name: String,
    original_path: String,
    kind: String,
    deleted_at: u64,
    /// Absolute path of the item inside the trash.
    #[serde(default)]
    trashed_path: String,
}

fn trash_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("trash")
}

/// Moves a board or folder into Whiteboard's trash. Nothing is deleted.
#[tauri::command]
pub fn trash_item(app: AppHandle, path: String) -> Result<TrashEntry, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("NOT_FOUND: {path}"));
    }
    let id = format!("{}", now_ms());
    let file_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".into());
    let slot = trash_dir(&app).join(&id);
    let dest = slot.join(&file_name);
    move_any(&src, &dest)?;
    let entry = TrashEntry {
        id: id.clone(),
        name: file_name.trim_end_matches(".excalidraw").to_string(),
        original_path: path,
        kind: if dest.is_dir() { "folder" } else { "board" }.into(),
        deleted_at: now_ms(),
        trashed_path: dest.to_string_lossy().to_string(),
    };
    let json = serde_json::to_string_pretty(&entry).unwrap_or_default();
    atomic_write(&slot.join(".trash.json"), json.as_bytes())?;
    Ok(entry)
}

#[tauri::command]
pub fn trash_list(app: AppHandle) -> Vec<TrashEntry> {
    let mut out: Vec<TrashEntry> = fs::read_dir(trash_dir(&app))
        .map(|it| {
            it.flatten()
                .filter_map(|e| {
                    let raw = fs::read_to_string(e.path().join(".trash.json")).ok()?;
                    serde_json::from_str::<TrashEntry>(&raw).ok()
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    out
}

/// Restores to the original location (or a non-clashing sibling name).
/// Returns the restored path.
#[tauri::command]
pub fn trash_restore(app: AppHandle, id: String) -> Result<String, String> {
    let slot = trash_dir(&app).join(&id);
    let raw = fs::read_to_string(slot.join(".trash.json")).map_err(|e| err(e, "read trash"))?;
    let entry: TrashEntry = serde_json::from_str(&raw).map_err(|e| format!("INVALID: {e}"))?;
    let original = PathBuf::from(&entry.original_path);
    let mut target = original.clone();
    let mut n = 2;
    while target.exists() {
        let stem = original
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = original
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        target = original.with_file_name(format!("{stem} (restored {n}){ext}"));
        n += 1;
    }
    let item = PathBuf::from(&entry.trashed_path);
    move_any(&item, &target)?;
    let _ = fs::remove_dir_all(&slot);
    Ok(target.to_string_lossy().to_string())
}

/// The only place Whiteboard permanently deletes user content, and only from
/// its own trash after an explicit user action.
#[tauri::command]
pub fn trash_delete(app: AppHandle, id: String) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains("..") {
        return Err("INVALID: bad trash id".into());
    }
    let slot = trash_dir(&app).join(&id);
    if slot.exists() {
        fs::remove_dir_all(&slot).map_err(|e| err(e, "delete"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn trash_empty(app: AppHandle) -> Result<(), String> {
    for e in trash_list(app.clone()) {
        trash_delete(app.clone(), e.id)?;
    }
    Ok(())
}
