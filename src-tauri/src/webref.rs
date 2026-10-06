//! Link previews for web reference cards.
//!
//! Remote requests happen only when the user inserts or refreshes a link:
//! - YouTube: the documented oEmbed endpoint (youtube.com/oembed) plus the
//!   public thumbnail at i.ytimg.com.
//! - Everything else (including Instagram): one GET of the page itself to read
//!   its Open Graph / <title> tags, then its preview image and favicon.
//!
//! Nothing about the user's boards is ever sent. Results are cached in
//! <appData>/link-cache so a link is fetched once (until "Refresh Preview").

use crate::appdata::{data_dir, path_key};
use crate::files::{atomic_write, now_ms};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::time::Duration;
use tauri::AppHandle;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Whiteboard/1.0";
const MAX_HTML: u64 = 1_500_000;
const MAX_IMAGE: u64 = 6_000_000;
const MAX_FAVICON: u64 = 300_000;

#[derive(Serialize, Deserialize, Clone)]
pub struct PreviewImage {
    /// base64-encoded bytes
    pub data: String,
    pub mime: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub url: String,
    pub kind: String, // youtube | instagram | web
    pub title: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image: Option<PreviewImage>,
    pub favicon: Option<PreviewImage>,
    /// ok | partial | unavailable | offline
    pub status: String,
    pub fetched_at: u64,
}

enum FetchErr {
    Offline,
    Status,
    Other,
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .redirects(6)
        .user_agent(UA)
        .build()
}

fn classify_err(e: ureq::Error) -> FetchErr {
    match e {
        ureq::Error::Status(_, _) => FetchErr::Status,
        ureq::Error::Transport(t) => match t.kind() {
            ureq::ErrorKind::Dns | ureq::ErrorKind::ConnectionFailed if !network_up() => {
                FetchErr::Offline
            }
            _ => FetchErr::Other,
        },
    }
}

/// Distinguishes "this site is unreachable" from "the Mac is offline" with a
/// plain DNS lookup (no HTTP request is made).
fn network_up() -> bool {
    use std::net::ToSocketAddrs;
    ("apple.com", 443)
        .to_socket_addrs()
        .map(|mut a| a.next().is_some())
        .unwrap_or(false)
}

/// GET with a size cap. Returns (bytes, content-type, final url).
fn get(agent: &ureq::Agent, url: &str, limit: u64) -> Result<(Vec<u8>, String, String), FetchErr> {
    let resp = agent.get(url).call().map_err(classify_err)?;
    let ctype = resp.content_type().to_string();
    let final_url = resp.get_url().to_string();
    let mut buf = Vec::new();
    resp.into_reader()
        .take(limit)
        .read_to_end(&mut buf)
        .map_err(|_| FetchErr::Other)?;
    Ok((buf, ctype, final_url))
}

fn image_from(agent: &ureq::Agent, url: &str, limit: u64) -> Option<PreviewImage> {
    use base64::Engine;
    let (bytes, ctype, _) = get(agent, url, limit).ok()?;
    if bytes.is_empty() || bytes.len() as u64 >= limit {
        return None; // empty or truncated
    }
    let mime = if ctype.starts_with("image/") {
        ctype
    } else {
        sniff_image(&bytes)?.to_string()
    };
    Some(PreviewImage {
        data: base64::engine::general_purpose::STANDARD.encode(&bytes),
        mime,
    })
}

fn sniff_image(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF8") {
        Some("image/gif")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else if b.starts_with(&[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else {
        None
    }
}

// ------------------------------------------------------------ HTML meta

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest.find(';').filter(|&e| e <= 10);
        let Some(end) = end else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let decoded = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                u32::from_str_radix(&ent[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Parses `name="value"` pairs from the inside of a tag.
fn parse_attrs(tag: &str) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let b = tag.as_bytes();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        let ks = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'>' {
            i += 1;
        }
        let key = tag[ks..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() {
                i += 1;
            }
            let (vs, ve);
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                i += 1;
                vs = i;
                while i < b.len() && b[i] != q {
                    i += 1;
                }
                ve = i;
                i += 1;
            } else {
                vs = i;
                while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' {
                    i += 1;
                }
                ve = i;
            }
            if !key.is_empty() {
                attrs.push((key, decode_entities(&tag[vs..ve.min(tag.len())])));
            }
        } else if !key.is_empty() {
            attrs.push((key, String::new()));
        } else {
            i += 1;
        }
    }
    attrs
}

#[derive(Default)]
struct PageMeta {
    title: Option<String>,
    og_title: Option<String>,
    description: Option<String>,
    site_name: Option<String>,
    image: Option<String>,
    author: Option<String>,
    icons: Vec<(String, String)>, // (rel, href)
}

fn tags<'a>(html: &'a str, lower: &'a str, name: &str) -> Vec<&'a str> {
    let needle = format!("<{name}");
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(p) = lower[from..].find(&needle) {
        let start = from + p + needle.len();
        let Some(end) = lower[start..].find('>') else {
            break;
        };
        out.push(&html[start..start + end]);
        from = start + end;
    }
    out
}

fn clean(s: &str) -> Option<String> {
    let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        None
    } else {
        Some(t.chars().take(300).collect())
    }
}

fn parse_meta(html: &str) -> PageMeta {
    // Metadata lives in <head>; don't scan megabytes of body.
    let head_end = html
        .to_ascii_lowercase()
        .find("</head>")
        .unwrap_or(html.len().min(400_000));
    let html = &html[..head_end.min(html.len())];
    let lower = html.to_ascii_lowercase();
    let mut m = PageMeta::default();
    for tag in tags(html, &lower, "meta") {
        let attrs = parse_attrs(tag);
        let get = |k: &str| attrs.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str());
        let key = get("property")
            .or_else(|| get("name"))
            .unwrap_or("")
            .to_ascii_lowercase();
        let Some(content) = get("content") else {
            continue;
        };
        let set = |slot: &mut Option<String>| {
            if slot.is_none() {
                *slot = clean(content);
            }
        };
        match key.as_str() {
            "og:title" | "twitter:title" => set(&mut m.og_title),
            "og:description" | "twitter:description" | "description" => set(&mut m.description),
            "og:site_name" | "application-name" => set(&mut m.site_name),
            "og:image"
            | "og:image:url"
            | "og:image:secure_url"
            | "twitter:image"
            | "twitter:image:src" => set(&mut m.image),
            "author" | "article:author" => set(&mut m.author),
            _ => {}
        }
    }
    if let Some(s) = lower.find("<title") {
        if let Some(gt) = lower[s..].find('>') {
            let start = s + gt + 1;
            if let Some(e) = lower[start..].find("</title") {
                m.title = clean(&decode_entities(&html[start..start + e]));
            }
        }
    }
    for tag in tags(html, &lower, "link") {
        let attrs = parse_attrs(tag);
        let get = |k: &str| attrs.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
        if let (Some(rel), Some(href)) = (get("rel"), get("href")) {
            if rel.to_ascii_lowercase().contains("icon") {
                m.icons.push((rel.to_ascii_lowercase(), href));
            }
        }
    }
    m
}

// ------------------------------------------------------------- fetchers

fn youtube_id(url: &url::Url) -> Option<String> {
    let host = url
        .host_str()?
        .trim_start_matches("www.")
        .trim_start_matches("m.");
    let id = match host {
        "youtu.be" => url.path_segments()?.next().map(|s| s.to_string()),
        "youtube.com" | "music.youtube.com" | "youtube-nocookie.com" => {
            let mut segs = url.path_segments()?;
            match segs.next() {
                Some("watch") => url
                    .query_pairs()
                    .find(|(k, _)| k == "v")
                    .map(|(_, v)| v.to_string()),
                Some("shorts") | Some("embed") | Some("live") | Some("v") => {
                    segs.next().map(|s| s.to_string())
                }
                _ => None,
            }
        }
        _ => None,
    }?;
    let ok = id.len() >= 6
        && id.len() <= 20
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then_some(id)
}

fn fetch_youtube(agent: &ureq::Agent, url: &str, id: &str) -> Preview {
    let mut p = Preview {
        url: url.into(),
        kind: "youtube".into(),
        site_name: Some("YouTube".into()),
        ..Default::default()
    };
    let canonical = format!("https://www.youtube.com/watch?v={id}");
    let oembed = format!(
        "https://www.youtube.com/oembed?format=json&url={}",
        url::form_urlencoded::byte_serialize(canonical.as_bytes()).collect::<String>()
    );
    match get(agent, &oembed, 100_000) {
        Ok((body, _, _)) => {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&body) {
                p.title = v["title"].as_str().and_then(clean);
                p.author = v["author_name"].as_str().and_then(clean);
            }
        }
        Err(FetchErr::Offline) => {
            p.status = "offline".into();
            return p;
        }
        Err(FetchErr::Status) => {
            // 401/403/404: private, deleted or embedding disabled.
            p.description = Some("Video unavailable".into());
        }
        Err(FetchErr::Other) => {}
    }
    // mqdefault is 16:9 without letterboxing and exists for every video.
    p.image = image_from(
        agent,
        &format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"),
        MAX_IMAGE,
    );
    p.status = if p.title.is_some() && p.image.is_some() {
        "ok"
    } else if p.title.is_some() || p.image.is_some() {
        "partial"
    } else {
        "unavailable"
    }
    .into();
    p
}

fn fetch_page(agent: &ureq::Agent, url: &str, kind: &str) -> Preview {
    let mut p = Preview {
        url: url.into(),
        kind: kind.into(),
        ..Default::default()
    };
    let (body, ctype, final_url) = match get(agent, url, MAX_HTML) {
        Ok(r) => r,
        Err(FetchErr::Offline) => {
            p.status = "offline".into();
            return p;
        }
        Err(_) => {
            p.status = "unavailable".into();
            return p;
        }
    };
    let base = url::Url::parse(&final_url).ok();
    let resolve = |href: &str| -> Option<String> {
        base.as_ref()?
            .join(href)
            .ok()
            .map(|u| u.to_string())
            .filter(|u| u.starts_with("http"))
    };
    if ctype.starts_with("image/") {
        // A direct image link: the image is the preview.
        use base64::Engine;
        if (body.len() as u64) < MAX_HTML {
            p.image = Some(PreviewImage {
                data: base64::engine::general_purpose::STANDARD.encode(&body),
                mime: ctype,
            });
            p.status = "ok".into();
        } else {
            p.image = image_from(agent, url, MAX_IMAGE);
            p.status = if p.image.is_some() {
                "ok"
            } else {
                "unavailable"
            }
            .into();
        }
        return p;
    }
    let html = String::from_utf8_lossy(&body);
    let m = parse_meta(&html);
    p.title = m.og_title.or(m.title);
    p.description = m.description;
    p.site_name = m.site_name;
    p.author = m.author;
    if let Some(img) = m.image.as_deref().and_then(resolve) {
        p.image = image_from(agent, &img, MAX_IMAGE);
    }
    // Favicon: prefer PNG/apple-touch icons, fall back to /favicon.ico.
    let mut icons = m.icons.clone();
    icons.sort_by_key(|(rel, href)| {
        let svg = href.ends_with(".svg") as u8;
        let apple = rel.contains("apple") as u8;
        (svg, 1 - apple)
    });
    let mut candidates: Vec<String> = icons.iter().filter_map(|(_, h)| resolve(h)).collect();
    if let Some(fav) = resolve("/favicon.ico") {
        candidates.push(fav);
    }
    for c in candidates.iter().take(3) {
        if let Some(img) = image_from(agent, c, MAX_FAVICON) {
            if img.mime != "image/svg+xml" {
                p.favicon = Some(img);
                break;
            }
        }
    }
    // Instagram (and some others) serve a generic shell without metadata.
    let generic = kind == "instagram"
        && p.image.is_none()
        && p.title.as_deref().is_none_or(|t| t == "Instagram");
    if generic {
        p.title = None;
        p.description = None;
    }
    p.status = if generic || (p.title.is_none() && p.image.is_none()) {
        "unavailable"
    } else if p.image.is_some() {
        "ok"
    } else {
        "partial"
    }
    .into();
    p
}

fn cache_path(app: &AppHandle, url: &str) -> std::path::PathBuf {
    data_dir(app)
        .join("link-cache")
        .join(format!("{}.json", path_key(url)))
}

/// Returns a preview for `url`, from cache unless `refresh` is set. Never
/// fails: problems are reported through `status`.
#[tauri::command]
pub async fn link_preview(app: AppHandle, url: String, refresh: bool) -> Preview {
    let cache = cache_path(&app, &url);
    if !refresh {
        if let Ok(raw) = fs::read_to_string(&cache) {
            if let Ok(p) = serde_json::from_str::<Preview>(&raw) {
                return p;
            }
        }
    }
    let u = url.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let agent = agent();
        let parsed = url::Url::parse(&u);
        let Ok(parsed) = parsed else {
            return Preview {
                url: u,
                kind: "web".into(),
                status: "unavailable".into(),
                ..Default::default()
            };
        };
        let host = parsed
            .host_str()
            .unwrap_or("")
            .trim_start_matches("www.")
            .to_string();
        if let Some(id) = youtube_id(&parsed) {
            fetch_youtube(&agent, &u, &id)
        } else if host == "instagram.com" || host.ends_with(".instagram.com") {
            fetch_page(&agent, &u, "instagram")
        } else {
            fetch_page(&agent, &u, "web")
        }
    })
    .await;
    let mut p = result.unwrap_or_else(|_| Preview {
        url: url.clone(),
        kind: "web".into(),
        status: "unavailable".into(),
        ..Default::default()
    });
    // Pages that only render with JavaScript (Instagram, many modern sites)
    // expose nothing to a plain fetch. Render them in a hidden web view, the
    // way a browser would, and read the preview from the rendered page.
    let js_only = p.status == "unavailable" || (p.kind == "instagram" && p.image.is_none());
    if js_only && p.status != "offline" {
        if let Some(r) = render_meta(&app, &url).await {
            apply_rendered(&mut p, r).await;
        }
    }
    p.fetched_at = now_ms();
    // Cache successes only, so offline/unavailable links are retried later.
    if p.status == "ok" || p.status == "partial" {
        if let Ok(json) = serde_json::to_string(&p) {
            let _ = atomic_write(&cache, json.as_bytes());
        }
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn youtube_ids() {
        let id = |s: &str| youtube_id(&url::Url::parse(s).unwrap());
        assert_eq!(
            id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            id("https://youtu.be/dQw4w9WgXcQ?si=abc").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            id("https://youtube.com/shorts/abcDEF12345").as_deref(),
            Some("abcDEF12345")
        );
        assert_eq!(
            id("https://m.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(id("https://www.youtube.com/@channel"), None);
        assert_eq!(id("https://example.com/watch?v=dQw4w9WgXcQ"), None);
    }

    #[test]
    fn meta_parsing() {
        let html = r#"<html><head><title> Fallback &amp; Title </title>
        <meta property="og:title" content="Product &quot;Hunt&quot;">
        <meta name='description' content='Find &#39;new&#x27; things'>
        <meta content="https://x.com/a.png" property="og:image" />
        <link rel="shortcut icon" href="/fav.png"></head><body><meta property="og:title" content="nope"></body>"#;
        let m = parse_meta(html);
        assert_eq!(m.og_title.as_deref(), Some("Product \"Hunt\""));
        assert_eq!(m.title.as_deref(), Some("Fallback & Title"));
        assert_eq!(m.description.as_deref(), Some("Find 'new' things"));
        assert_eq!(m.image.as_deref(), Some("https://x.com/a.png"));
        assert_eq!(m.icons[0].1, "/fav.png");
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;

    /// Live network check: `cargo test --lib live_previews -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_previews() {
        let a = agent();
        let show =
            |p: &Preview| {
                println!(
                "{:<9} {:<11} title={:?} author={:?} site={:?} desc={:?} image={:?} favicon={:?}",
                p.kind,
                p.status,
                p.title.as_deref().map(|t| t.chars().take(50).collect::<String>()),
                p.author,
                p.site_name,
                p.description.as_deref().map(|t| t.chars().take(40).collect::<String>()),
                p.image.as_ref().map(|i| (i.mime.clone(), i.data.len())),
                p.favicon.as_ref().map(|i| (i.mime.clone(), i.data.len())),
            )
            };
        show(&fetch_youtube(
            &a,
            "https://youtu.be/dQw4w9WgXcQ",
            "dQw4w9WgXcQ",
        ));
        show(&fetch_youtube(
            &a,
            "https://www.youtube.com/watch?v=AAAAAAAAAAA",
            "AAAAAAAAAAA",
        ));
        show(&fetch_page(
            &a,
            "https://www.instagram.com/p/CwHNC2gu8ZP/",
            "instagram",
        ));
        show(&fetch_page(&a, "https://www.producthunt.com/", "web"));
        show(&fetch_page(
            &a,
            "https://github.com/excalidraw/excalidraw",
            "web",
        ));
        show(&fetch_page(&a, "https://example.com/", "web"));
        show(&fetch_page(
            &a,
            "https://this-domain-does-not-exist-wb.invalid/",
            "web",
        ));
    }
}

// ---------------------------------------------------- optional local AI

/// Optional, off by default: asks a model served by Ollama on this Mac
/// (127.0.0.1 only — nothing leaves the machine). Returns None if Ollama
/// isn't running or the request fails, so callers fall back to rules.
#[tauri::command]
pub async fn local_ai(model: String, prompt: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(2))
            .timeout(Duration::from_secs(90))
            .build();
        let body = serde_json::json!({ "model": model, "prompt": prompt, "stream": false,
            "options": { "temperature": 0.2 } });
        let resp = agent
            .post("http://127.0.0.1:11434/api/generate")
            .set("Content-Type", "application/json")
            .send_string(&body.to_string())
            .ok()?;
        let v: serde_json::Value = serde_json::from_str(&resp.into_string().ok()?).ok()?;
        v.get("response")
            .and_then(|r| r.as_str())
            .map(|s| s.trim().to_string())
    })
    .await
    .ok()
    .flatten()
}

/// Installed local models, or None if Ollama isn't running.
#[tauri::command]
pub async fn local_ai_models() -> Option<Vec<String>> {
    tauri::async_runtime::spawn_blocking(|| {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(2))
            .build();
        let raw = agent
            .get("http://127.0.0.1:11434/api/tags")
            .call()
            .ok()?
            .into_string()
            .ok()?;
        let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
        Some(
            v.get("models")?
                .as_array()?
                .iter()
                .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect(),
        )
    })
    .await
    .ok()
    .flatten()
}

// ------------------------------------------- rendering JS-only pages

#[derive(Deserialize, Default)]
struct Rendered {
    image: Option<String>,
    title: Option<String>,
    desc: Option<String>,
}

/// Runs in the hidden page: waits until an Open Graph image or a large image
/// is present (or ~9s pass), then reports back by navigating to a private
/// scheme, which Rust intercepts. The page gets no access to the app.
const RENDER_SCRIPT: &str = r#"
(function () {
  if (window.__wbmeta || location.protocol === "wbmeta:") return;
  window.__wbmeta = 1;
  var start = Date.now();
  function meta(p) {
    var el = document.querySelector('meta[property="' + p + '"],meta[name="' + p + '"]');
    return el && el.content ? el.content : null;
  }
  function pick() {
    var image = meta("og:image") || meta("twitter:image");
    if (!image) {
      var best = null, area = 0;
      for (var i = 0; i < document.images.length; i++) {
        var img = document.images[i], w = img.naturalWidth, h = img.naturalHeight, src = img.currentSrc || img.src;
        if (w >= 240 && h >= 240 && w * h > area && /^https?:/.test(src)) { area = w * h; best = src; }
      }
      image = best;
    }
    return { image: image, title: meta("og:title") || document.title || null, desc: meta("og:description") || meta("description") };
  }
  function tick() {
    var r = pick();
    if (r.image || Date.now() - start > 9000) {
      location.href = "wbmeta://done?d=" + encodeURIComponent(JSON.stringify(r));
    } else {
      setTimeout(tick, 400);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(tick, 600); });
  else setTimeout(tick, 600);
})();
"#;

async fn render_meta(app: &AppHandle, url: &str) -> Option<Rendered> {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    static N: AtomicU64 = AtomicU64::new(0);
    let parsed: url::Url = url.parse().ok()?;
    let label = format!("wbmeta-{}", N.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = mpsc::channel::<Rendered>();
    let window = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(parsed))
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .inner_size(1100.0, 900.0)
        .initialization_script(RENDER_SCRIPT)
        .on_navigation(move |nav| {
            if nav.scheme() != "wbmeta" {
                return true;
            }
            let data = nav
                .query_pairs()
                .find(|(k, _)| k == "d")
                .map(|(_, v)| v.to_string())
                .unwrap_or_default();
            let _ = tx.send(serde_json::from_str(&data).unwrap_or_default());
            false
        })
        .build()
        .ok()?;
    let result =
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(14)).ok())
            .await
            .ok()
            .flatten();
    let _ = window.destroy();
    result
}

async fn apply_rendered(p: &mut Preview, r: Rendered) {
    let generic = |t: &str| t.trim().is_empty() || t.trim() == "Instagram" || t.contains("Login");
    if let Some(t) = r.title.as_deref().filter(|t| !generic(t)) {
        // Instagram titles look like: `Name on Instagram: "caption…"`.
        if let Some((who, rest)) = t.split_once(" on Instagram") {
            p.author = clean(who);
            let caption = rest.trim_start_matches(':').trim().trim_matches('"');
            p.description = clean(caption).or(p.description.take());
        } else {
            p.title = clean(t);
        }
    }
    if p.description.is_none() {
        p.description = r.desc.as_deref().and_then(clean);
    }
    if let Some(img) = r.image {
        p.image =
            tauri::async_runtime::spawn_blocking(move || image_from(&agent(), &img, MAX_IMAGE))
                .await
                .ok()
                .flatten();
    }
    if p.image.is_some() || p.title.is_some() || p.author.is_some() {
        p.status = if p.image.is_some() { "ok" } else { "partial" }.into();
    }
}
