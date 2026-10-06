//! Plain local full-text search over the text inside boards. Each board's
//! extracted text is cached in memory keyed by modification time, so repeat
//! searches only re-read files that changed.

use crate::files::{mtime_ms, BOARD_EXT};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Default)]
pub struct SearchIndex(Mutex<HashMap<String, (u64, Digest)>>);

/// What Whiteboard knows about a board's content, for search and the
/// rule-based suggestions (names, folders, next actions, related boards).
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Digest {
    pub path: String,
    pub mtime: u64,
    /// All visible text joined with " · " (capped).
    pub text: String,
    /// Frame names and the largest-font short texts, most prominent first.
    pub headings: Vec<String>,
    /// Lines that look like explicit to-dos ("TODO", "Next:", "[ ]", "☐"…).
    pub todos: Vec<String>,
    pub arrows: u32,
    pub elements: u32,
}

#[derive(Serialize)]
pub struct TextHit {
    path: String,
    snippet: String,
}

fn collect_boards(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let p = e.path();
        if p.is_dir() && depth < 12 {
            collect_boards(&p, out, depth + 1);
        } else if p.extension().and_then(|x| x.to_str()) == Some(BOARD_EXT) {
            out.push(p);
        }
    }
}

fn is_todo(line: &str) -> Option<String> {
    let l = line.trim();
    let lower = l.to_lowercase();
    for prefix in ["todo:", "todo ", "to do:", "next:", "next step:", "next steps:", "action:", "[ ]", "☐", "- [ ]", "* [ ]"] {
        if lower.starts_with(prefix) {
            let rest = l[prefix.len()..].trim().trim_start_matches(['-', ':', ' ']).trim();
            if rest.len() >= 3 {
                return Some(rest.chars().take(120).collect());
            }
        }
    }
    None
}

/// Extracts text, headings, to-dos and counts from a board's JSON.
fn digest(raw: &str) -> Digest {
    let mut d = Digest::default();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return d;
    };
    let mut parts = Vec::new();
    let mut sized: Vec<(f64, String)> = Vec::new();
    let mut frames = Vec::new();
    if let Some(els) = v.get("elements").and_then(|e| e.as_array()) {
        for el in els {
            if el.get("isDeleted").and_then(|d| d.as_bool()) == Some(true) {
                continue;
            }
            d.elements += 1;
            let ty = el.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if ty == "arrow" {
                d.arrows += 1;
            }
            // Web reference cards are links, not the user's own words.
            if el.pointer("/customData/wbRef").is_some() {
                continue;
            }
            if ty == "frame" || ty == "magicframe" {
                if let Some(n) = el.get("name").and_then(|t| t.as_str()).filter(|n| !n.trim().is_empty()) {
                    frames.push(n.trim().to_string());
                }
            }
            if let Some(t) = el
                .get("originalText")
                .or_else(|| el.get("text"))
                .and_then(|t| t.as_str())
                .filter(|t| !t.trim().is_empty())
            {
                for line in t.lines() {
                    if let Some(todo) = is_todo(line) {
                        d.todos.push(todo);
                    }
                }
                let flat = t.split_whitespace().collect::<Vec<_>>().join(" ");
                let size = el.get("fontSize").and_then(|f| f.as_f64()).unwrap_or(20.0);
                if flat.chars().count() <= 60 {
                    sized.push((size, flat.clone()));
                }
                parts.push(flat);
            }
        }
    }
    // Only text that is clearly larger than the board's typical text counts
    // as a heading (a title), not just the first label of many.
    let mut sizes: Vec<f64> = sized.iter().map(|(s, _)| *s).collect();
    sizes.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = sizes.get(sizes.len() / 2).copied().unwrap_or(20.0);
    sized.retain(|(s, _)| *s >= median * 1.4);
    sized.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    d.headings = frames;
    d.headings.extend(sized.into_iter().take(5).map(|(_, t)| t));
    let mut text = parts.join(" · ");
    if text.len() > 4000 {
        let cut = (0..=4000).rev().find(|i| text.is_char_boundary(*i)).unwrap_or(0);
        text.truncate(cut);
    }
    d.text = text;
    d
}

fn cached_digest(cache: &mut HashMap<String, (u64, Digest)>, path: &Path) -> Option<Digest> {
    let key = path.to_string_lossy().to_string();
    let m = mtime_ms(path)?;
    if let Some((cm, d)) = cache.get(&key) {
        if *cm == m {
            return Some(d.clone());
        }
    }
    let mut d = fs::read_to_string(path).map(|raw| digest(&raw)).unwrap_or_default();
    d.path = key.clone();
    d.mtime = m;
    cache.insert(key, (m, d.clone()));
    Some(d)
}

/// Digests of every board under `root` (cached by modification time).
#[tauri::command]
pub fn board_digests(index: tauri::State<'_, SearchIndex>, root: String) -> Vec<Digest> {
    let mut boards = Vec::new();
    collect_boards(Path::new(&root), &mut boards, 0);
    let mut cache = index.0.lock().unwrap();
    boards.iter().filter_map(|b| cached_digest(&mut cache, b)).collect()
}

fn snippet(text: &str, lower: &str, q: &str) -> String {
    let Some(byte_idx) = lower.find(q) else {
        return String::new();
    };
    // Map the byte offset in the lowercase string to a char offset, then cut a
    // window of characters around the match from the original text.
    let char_idx = lower[..byte_idx].chars().count();
    let chars: Vec<char> = text.chars().collect();
    let start = char_idx.saturating_sub(30);
    let end = (char_idx + q.chars().count() + 50).min(chars.len());
    let mut s: String = chars[start.min(chars.len())..end].iter().collect();
    if start > 0 {
        s.insert(0, '…');
    }
    if end < chars.len() {
        s.push('…');
    }
    s
}

#[tauri::command]
pub fn search_text(
    index: tauri::State<'_, SearchIndex>,
    root: String,
    extra: Vec<String>,
    query: String,
    limit: Option<usize>,
) -> Vec<TextHit> {
    let q = query.trim().to_lowercase();
    if q.len() < 2 {
        return Vec::new();
    }
    let mut boards = Vec::new();
    collect_boards(Path::new(&root), &mut boards, 0);
    boards.extend(extra.into_iter().map(PathBuf::from));
    let mut cache = index.0.lock().unwrap();
    let mut hits = Vec::new();
    for b in boards {
        let Some(d) = cached_digest(&mut cache, &b) else { continue };
        let key = d.path.clone();
        let text = d.text;
        let lower = text.to_lowercase();
        if lower.contains(&q) {
            hits.push(TextHit {
                snippet: snippet(&text, &lower, &q),
                path: key,
            });
            if hits.len() >= limit.unwrap_or(30) {
                break;
            }
        }
    }
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_finds_headings_todos_and_skips_cards() {
        let raw = r#"{"type":"excalidraw","elements":[
          {"type":"text","text":"Onboarding","fontSize":36},
          {"type":"text","text":"signup form\nTODO: add email verification","fontSize":16},
          {"type":"text","text":"pricing","fontSize":16},
          {"type":"arrow"},{"type":"arrow"},
          {"type":"text","text":"Deleted","isDeleted":true},
          {"type":"text","text":"YouTube","customData":{"wbRef":{"cardId":"x"}}},
          {"type":"frame","name":"Signup Flow"}
        ]}"#;
        let d = digest(raw);
        assert_eq!(d.arrows, 2);
        assert_eq!(d.headings[0], "Signup Flow");
        assert_eq!(d.headings[1], "Onboarding");
        assert_eq!(d.todos, vec!["add email verification".to_string()]);
        assert!(!d.text.contains("YouTube") && !d.text.contains("Deleted"));
    }
}
