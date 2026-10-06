//! Filesystem primitives for boards: atomic writes, the folder tree, moves and
//! renames. Boards are ordinary `.excalidraw` files inside ordinary folders.
//!
//! Errors are returned as strings prefixed with a stable code (`CONFLICT:`,
//! `NOT_FOUND:`, `PERMISSION:`, `NO_SPACE:`, `EXISTS:`, `INVALID:`, `IO:`) so
//! the frontend can show calm, specific messages.

use serde::Serialize;
use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const BOARD_EXT: &str = "excalidraw";

pub fn err(e: std::io::Error, ctx: &str) -> String {
    let code = match e.kind() {
        ErrorKind::NotFound => "NOT_FOUND",
        ErrorKind::PermissionDenied => "PERMISSION",
        ErrorKind::AlreadyExists => "EXISTS",
        ErrorKind::StorageFull => "NO_SPACE",
        _ => {
            // ENOSPC is not always mapped to StorageFull.
            if e.raw_os_error() == Some(28) {
                "NO_SPACE"
            } else {
                "IO"
            }
        }
    };
    format!("{code}: {ctx}: {e}")
}

/// Modification time in milliseconds since the epoch.
pub fn mtime_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

/// Writes `bytes` to `path` atomically: write a sibling temp file, fsync it,
/// then rename over the destination. A crash mid-write never leaves a
/// half-written board behind.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "INVALID: path has no parent".to_string())?;
    fs::create_dir_all(dir).map_err(|e| err(e, "create folder"))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("board");
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = dir.join(format!(".{file_name}.wb-tmp-{}-{n}", std::process::id()));
    let result = (|| {
        let mut f = File::create(&tmp).map_err(|e| err(e, "write"))?;
        f.write_all(bytes).map_err(|e| err(e, "write"))?;
        f.sync_all().map_err(|e| err(e, "flush"))?;
        drop(f);
        fs::rename(&tmp, path).map_err(|e| err(e, "replace"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Rejects content that is not a structurally valid Excalidraw scene so a bug
/// elsewhere can never replace a good board with garbage.
fn validate_scene(content: &str) -> Result<(), String> {
    let v: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("INVALID: not JSON: {e}"))?;
    let ok = v.get("type").and_then(|t| t.as_str()) == Some("excalidraw")
        && v.get("elements").map(|e| e.is_array()).unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err("INVALID: not an Excalidraw scene".into())
    }
}

#[derive(Serialize)]
pub struct ReadResult {
    pub content: String,
    pub mtime: u64,
}

#[tauri::command]
pub fn read_text(path: String) -> Result<ReadResult, String> {
    let p = PathBuf::from(&path);
    let content = fs::read_to_string(&p).map_err(|e| err(e, "read"))?;
    Ok(ReadResult {
        content,
        mtime: mtime_ms(&p).unwrap_or(0),
    })
}

/// Saves a board. When `expected_mtime` is given and the file on disk has a
/// different modification time, the write is refused with `CONFLICT` so an
/// external change is never silently overwritten.
#[tauri::command]
pub fn write_board(
    path: String,
    content: String,
    expected_mtime: Option<u64>,
) -> Result<u64, String> {
    validate_scene(&content)?;
    let p = PathBuf::from(&path);
    if let Some(expected) = expected_mtime {
        match mtime_ms(&p) {
            Some(actual) if actual != expected => {
                return Err(format!("CONFLICT: {path} changed on disk"))
            }
            None if p.exists() => {}
            None => return Err(format!("NOT_FOUND: {path} no longer exists")),
            _ => {}
        }
    }
    atomic_write(&p, content.as_bytes())?;
    Ok(mtime_ms(&p).unwrap_or(0))
}

/// Writes arbitrary text atomically (app metadata, libraries, exports).
#[tauri::command]
pub fn write_text(path: String, content: String) -> Result<u64, String> {
    let p = PathBuf::from(&path);
    atomic_write(&p, content.as_bytes())?;
    Ok(mtime_ms(&p).unwrap_or(0))
}

/// Writes binary data given as base64 (image exports, thumbnails).
#[tauri::command]
pub fn write_base64(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("INVALID: {e}"))?;
    atomic_write(&PathBuf::from(path), &bytes)
}

#[tauri::command]
pub fn read_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = fs::read(&path).map_err(|e| err(e, "read"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[derive(Serialize)]
pub struct Stat {
    pub exists: bool,
    pub mtime: u64,
    pub size: u64,
    pub is_dir: bool,
}

#[tauri::command]
pub fn stat_path(path: String) -> Stat {
    match fs::metadata(&path) {
        Ok(m) => Stat {
            exists: true,
            mtime: mtime_ms(Path::new(&path)).unwrap_or(0),
            size: m.len(),
            is_dir: m.is_dir(),
        },
        Err(_) => Stat {
            exists: false,
            mtime: 0,
            size: 0,
            is_dir: false,
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: &'static str, // "folder" | "board"
    pub mtime: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn scan_dir(dir: &Path, depth: usize) -> Vec<TreeNode> {
    let mut folders = Vec::new();
    let mut boards = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_hidden(&name) {
            continue;
        }
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if depth >= 12 {
                continue;
            }
            folders.push(TreeNode {
                children: Some(scan_dir(&path, depth + 1)),
                mtime: mtime_ms(&path).unwrap_or(0),
                path: path.to_string_lossy().to_string(),
                name,
                kind: "folder",
            });
        } else if path.extension().and_then(|e| e.to_str()) == Some(BOARD_EXT) {
            boards.push(TreeNode {
                name: name.trim_end_matches(".excalidraw").to_string(),
                mtime: mtime_ms(&path).unwrap_or(0),
                path: path.to_string_lossy().to_string(),
                kind: "board",
                children: None,
            });
        }
    }
    let key = |n: &TreeNode| n.name.to_lowercase();
    folders.sort_by_key(key);
    boards.sort_by_key(key);
    folders.extend(boards);
    folders
}

/// Returns the folder/board tree under the library root, creating the root
/// if needed.
#[tauri::command]
pub fn scan_tree(root: String) -> Result<Vec<TreeNode>, String> {
    let p = PathBuf::from(&root);
    fs::create_dir_all(&p).map_err(|e| err(e, "create library folder"))?;
    Ok(scan_dir(&p, 0))
}

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err(format!("EXISTS: {path}"));
    }
    fs::create_dir_all(&p).map_err(|e| err(e, "create folder"))
}

/// Writes a brand-new file, refusing to overwrite an existing one.
#[tauri::command]
pub fn create_board(path: String, content: String) -> Result<u64, String> {
    validate_scene(&content)?;
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err(format!("EXISTS: {path}"));
    }
    atomic_write(&p, content.as_bytes())?;
    Ok(mtime_ms(&p).unwrap_or(0))
}

/// Moves a file or folder across directories, falling back to copy + delete
/// when a rename crosses volumes.
pub fn move_any(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| err(e, "create folder"))?;
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(18) => {
            // EXDEV: cross-device link
            copy_recursive(from, to)?;
            if from.is_dir() {
                fs::remove_dir_all(from).map_err(|e| err(e, "remove original"))
            } else {
                fs::remove_file(from).map_err(|e| err(e, "remove original"))
            }
        }
        Err(e) => Err(err(e, "move")),
    }
}

fn copy_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if from.is_dir() {
        fs::create_dir_all(to).map_err(|e| err(e, "copy"))?;
        for entry in fs::read_dir(from).map_err(|e| err(e, "copy"))?.flatten() {
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(from, to).map(|_| ()).map_err(|e| err(e, "copy"))
    }
}

/// Renames or moves a board/folder. Refuses to clobber an existing target.
#[tauri::command]
pub fn move_path(from: String, to: String) -> Result<(), String> {
    let (f, t) = (PathBuf::from(&from), PathBuf::from(&to));
    if !f.exists() {
        return Err(format!("NOT_FOUND: {from}"));
    }
    // Case-only renames on case-insensitive volumes are fine.
    if t.exists() && from.to_lowercase() != to.to_lowercase() {
        return Err(format!("EXISTS: {to}"));
    }
    if t.starts_with(&f) && f != t {
        return Err("INVALID: cannot move a folder into itself".into());
    }
    move_any(&f, &t)
}

#[tauri::command]
pub fn copy_file(from: String, to: String) -> Result<(), String> {
    let t = PathBuf::from(&to);
    if t.exists() {
        return Err(format!("EXISTS: {to}"));
    }
    copy_recursive(Path::new(&from), &t)
}

/// Returns `dir/base.ext`, or `dir/base 2.ext`, `dir/base 3.ext`… so that the
/// result never collides with an existing entry.
#[tauri::command]
pub fn unique_path(dir: String, base: String, ext: Option<String>) -> String {
    let d = PathBuf::from(dir);
    let suffix = ext.map(|e| format!(".{e}")).unwrap_or_default();
    let mut candidate = d.join(format!("{base}{suffix}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = d.join(format!("{base} {n}{suffix}"));
        n += 1;
    }
    candidate.to_string_lossy().to_string()
}

/// Finds the on-disk path of a file dropped into the web view (which only
/// exposes name, size and modification time). Checks the usual places first,
/// then asks Spotlight. Returns None when no unambiguous match exists.
#[tauri::command]
pub fn locate_file(
    name: String,
    size: u64,
    mtime: u64,
    hints: Vec<String>,
) -> Option<String> {
    let matches = |p: &Path| -> bool {
        fs::metadata(p)
            .map(|m| m.is_file() && m.len() == size)
            .unwrap_or(false)
            && mtime_ms(p)
                .map(|t| t.abs_diff(mtime) < 2000)
                .unwrap_or(false)
    };
    let mut dirs: Vec<PathBuf> = hints.into_iter().map(PathBuf::from).collect();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for d in ["Desktop", "Downloads", "Documents"] {
            dirs.push(home.join(d));
        }
    }
    for d in &dirs {
        let candidate = d.join(&name);
        if matches(&candidate) {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    let escaped = name.replace('\\', "\\\\").replace('"', "\\\"");
    let out = std::process::Command::new("/usr/bin/mdfind")
        .arg(format!("kMDItemFSName == \"{escaped}\""))
        .output()
        .ok()?;
    let found: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| matches(Path::new(l)))
        .map(|l| l.to_string())
        .collect();
    if found.len() == 1 {
        found.into_iter().next()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("wb-test-{name}-{}", now_ms()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    const SCENE: &str = r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#;

    #[test]
    fn atomic_write_replaces_without_leftovers() {
        let d = tmpdir("atomic");
        let p = d.join("a.excalidraw");
        atomic_write(&p, b"one").unwrap();
        atomic_write(&p, b"two").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        let names: Vec<_> = fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(names.len(), 1, "temp files must not be left behind: {names:?}");
    }

    #[test]
    fn write_board_refuses_invalid_content() {
        let d = tmpdir("invalid");
        let p = d.join("b.excalidraw");
        fs::write(&p, SCENE).unwrap();
        let err = write_board(p.to_string_lossy().into(), "{not json".into(), None).unwrap_err();
        assert!(err.starts_with("INVALID"));
        let err = write_board(p.to_string_lossy().into(), r#"{"type":"other"}"#.into(), None).unwrap_err();
        assert!(err.starts_with("INVALID"));
        assert_eq!(fs::read_to_string(&p).unwrap(), SCENE, "good file must be untouched");
    }

    #[test]
    fn write_board_detects_external_change() {
        let d = tmpdir("conflict");
        let p = d.join("c.excalidraw");
        let path = p.to_string_lossy().to_string();
        let m1 = write_board(path.clone(), SCENE.into(), None).unwrap();
        // Same mtime: allowed.
        let m2 = write_board(path.clone(), SCENE.into(), Some(m1)).unwrap();
        // Stale mtime: refused, file untouched.
        std::thread::sleep(std::time::Duration::from_millis(5));
        fs::write(&p, SCENE.replace("[]", "[ ]")).unwrap();
        let err = write_board(path.clone(), SCENE.into(), Some(m2)).unwrap_err();
        assert!(err.starts_with("CONFLICT"), "{err}");
        assert!(fs::read_to_string(&p).unwrap().contains("[ ]"));
        // Deleted file with an expected mtime: refused as NOT_FOUND.
        fs::remove_file(&p).unwrap();
        let err = write_board(path, SCENE.into(), Some(m2)).unwrap_err();
        assert!(err.starts_with("NOT_FOUND"), "{err}");
    }

    #[test]
    fn create_and_move_never_clobber() {
        let d = tmpdir("clobber");
        let a = d.join("a.excalidraw").to_string_lossy().to_string();
        let b = d.join("b.excalidraw").to_string_lossy().to_string();
        create_board(a.clone(), SCENE.into()).unwrap();
        assert!(create_board(a.clone(), SCENE.into()).unwrap_err().starts_with("EXISTS"));
        create_board(b.clone(), SCENE.into()).unwrap();
        assert!(move_path(a.clone(), b.clone()).unwrap_err().starts_with("EXISTS"));
        let sub = d.join("sub");
        fs::create_dir(&sub).unwrap();
        assert!(move_path(d.to_string_lossy().into(), sub.join("x").to_string_lossy().into())
            .unwrap_err()
            .starts_with("INVALID"));
    }

    #[test]
    fn unique_path_increments() {
        let d = tmpdir("unique");
        let dir = d.to_string_lossy().to_string();
        let p1 = unique_path(dir.clone(), "Untitled Whiteboard".into(), Some("excalidraw".into()));
        assert!(p1.ends_with("/Untitled Whiteboard.excalidraw"));
        fs::write(&p1, SCENE).unwrap();
        let p2 = unique_path(dir, "Untitled Whiteboard".into(), Some("excalidraw".into()));
        assert!(p2.ends_with("/Untitled Whiteboard 2.excalidraw"));
    }

    #[test]
    fn scan_tree_lists_boards_and_skips_hidden() {
        let d = tmpdir("scan");
        fs::create_dir_all(d.join("Startup/Product")).unwrap();
        fs::create_dir_all(d.join(".hidden")).unwrap();
        fs::write(d.join("Startup/Product/Onboarding.excalidraw"), SCENE).unwrap();
        fs::write(d.join("notes.txt"), "x").unwrap();
        let tree = scan_tree(d.to_string_lossy().into()).unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "Startup");
        let product = &tree[0].children.as_ref().unwrap()[0];
        assert_eq!(product.children.as_ref().unwrap()[0].name, "Onboarding");
    }
}
