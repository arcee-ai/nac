//! Dev-mode frontend serving.
//!
//! In a normal run the frontend comes from the copy embedded by `include_dir!`,
//! so an edit under `assets/` only shows up after rebuilding the binary. Dev mode
//! serves the same tree from disk with caching disabled and adds the `/__dev/*`
//! endpoints the browser dev client uses for live reload and the locator overlay.
//! `scripts/dev-server.py` speaks the same protocol without a Rust toolchain.

use std::{
    collections::BTreeMap,
    convert::Infallible,
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime},
};

use anyhow::{Context, Result};
use async_stream::stream;
use axum::{
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
use serde::Serialize;

use crate::asset_content_type;

const POLL_INTERVAL: Duration = Duration::from_millis(250);
const DEV_CLIENT_TAG: &str =
    "<script type=\"module\" src=\"/assets/app/dev/dev-client.js\"></script>";
// Vendored runtime and binary assets never change while iterating on the UI, and
// walking them would dominate every poll tick.
const SKIP_DIRS: [&str; 3] = ["vendor", "fonts", "node_modules"];

/// The on-disk asset root served in dev mode.
#[derive(Clone, Debug)]
pub struct DevMode {
    root: PathBuf,
    source_prefix: String,
}

impl DevMode {
    /// `root` must be this crate's `assets/` directory (or a copy of it).
    pub fn new(root: PathBuf) -> Result<Self> {
        let root = root
            .canonicalize()
            .with_context(|| format!("failed to resolve dev asset root {}", root.display()))?;
        if !root.join("next.html").is_file() {
            anyhow::bail!(
                "{} is not the nac-web asset root (next.html is missing)",
                root.display()
            );
        }
        let source_prefix = workspace_relative_prefix(&root);
        Ok(Self {
            root,
            source_prefix,
        })
    }

    /// Resolution order: explicit path, `NAC_WEB_DEV_ASSETS`, the asset directory
    /// this binary was compiled from, then `crates/nac-server/assets` below the
    /// current directory.
    pub fn resolve(explicit: Option<PathBuf>) -> Result<Self> {
        if let Some(path) = explicit {
            return Self::new(path);
        }
        if let Some(path) = std::env::var_os("NAC_WEB_DEV_ASSETS") {
            return Self::new(PathBuf::from(path));
        }
        for candidate in [
            PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/assets")),
            PathBuf::from("crates/nac-server/assets"),
            PathBuf::from("assets"),
        ] {
            if candidate.join("next.html").is_file() {
                return Self::new(candidate);
            }
        }
        anyhow::bail!("could not locate the frontend asset directory; pass --dev-assets <PATH>")
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Asset root expressed relative to the repository, so the locator can emit
    /// paths that paste straight into an editor.
    pub fn source_prefix(&self) -> &str {
        &self.source_prefix
    }
}

pub fn ui_router(mode: DevMode) -> Router {
    Router::new()
        .route("/", get(index_html))
        .route("/app", get(index_html))
        .route("/legacy", get(legacy_index_html))
        .route("/assets/app.css", get(app_css_alias))
        .route("/assets/{*path}", get(serve_asset))
        .route("/__dev/status", get(status))
        .route("/__dev/components", get(components))
        .route("/__dev/events", get(watch_events))
        .with_state(mode)
}

async fn index_html(State(mode): State<DevMode>) -> Response {
    html_page(&mode, "next.html")
}

async fn legacy_index_html(State(mode): State<DevMode>) -> Response {
    html_page(&mode, "index.html")
}

async fn app_css_alias(State(mode): State<DevMode>) -> Response {
    asset_response(&mode, "redesign.css")
}

async fn serve_asset(State(mode): State<DevMode>, AxumPath(path): AxumPath<String>) -> Response {
    asset_response(&mode, &path)
}

fn html_page(mode: &DevMode, name: &str) -> Response {
    let Some(path) = resolve_within(mode.root(), name) else {
        return (StatusCode::BAD_REQUEST, "invalid asset path").into_response();
    };
    match std::fs::read_to_string(&path) {
        Ok(source) => (
            no_store_headers("text/html; charset=utf-8"),
            inject_dev_client(&source),
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "asset not found").into_response(),
    }
}

fn asset_response(mode: &DevMode, relative: &str) -> Response {
    let Some(path) = resolve_within(mode.root(), relative) else {
        return (StatusCode::BAD_REQUEST, "invalid asset path").into_response();
    };
    match std::fs::read(&path) {
        Ok(bytes) => (no_store_headers(asset_content_type(relative)), bytes).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "asset not found").into_response(),
    }
}

fn no_store_headers(content_type: &'static str) -> [(header::HeaderName, &'static str); 2] {
    [
        (header::CONTENT_TYPE, content_type),
        (header::CACHE_CONTROL, "no-store, max-age=0"),
    ]
}

// The dev client is injected rather than referenced from `next.html` so the
// shipped page stays free of dev-only code.
fn inject_dev_client(source: &str) -> String {
    match source.rfind("</body>") {
        Some(index) => {
            let mut page = String::with_capacity(source.len() + DEV_CLIENT_TAG.len() + 8);
            page.push_str(&source[..index]);
            page.push_str("  ");
            page.push_str(DEV_CLIENT_TAG);
            page.push_str("\n  ");
            page.push_str(&source[index..]);
            page
        }
        None => format!("{source}\n{DEV_CLIENT_TAG}\n"),
    }
}

// Rejects `..`, absolute paths and Windows prefixes so a request cannot escape
// the asset root.
fn resolve_within(root: &Path, relative: &str) -> Option<PathBuf> {
    let mut resolved = root.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(resolved)
}

fn workspace_relative_prefix(root: &Path) -> String {
    for ancestor in root.ancestors().skip(1) {
        if !ancestor.join(".git").exists() {
            continue;
        }
        if let Ok(relative) = root.strip_prefix(ancestor) {
            return relative.to_string_lossy().replace('\\', "/");
        }
    }
    root.to_string_lossy().replace('\\', "/")
}

#[derive(Serialize)]
struct DevStatus {
    server: &'static str,
    root: String,
    source_prefix: String,
}

async fn status(State(mode): State<DevMode>) -> Json<DevStatus> {
    Json(DevStatus {
        server: "nac-web --dev",
        root: mode.root().to_string_lossy().into_owned(),
        source_prefix: mode.source_prefix().to_owned(),
    })
}

#[derive(Serialize)]
struct ComponentSource {
    file: String,
    line: usize,
}

#[derive(Serialize)]
struct ComponentIndex {
    components: BTreeMap<String, Vec<ComponentSource>>,
}

async fn components(State(mode): State<DevMode>) -> Json<ComponentIndex> {
    let root = mode.root().to_path_buf();
    let components = tokio::task::spawn_blocking(move || scan_components(&root))
        .await
        .unwrap_or_default();
    Json(ComponentIndex { components })
}

async fn watch_events(
    State(mode): State<DevMode>,
) -> Sse<impl futures_core::Stream<Item = std::result::Result<Event, Infallible>>> {
    Sse::new(asset_change_stream(mode.root().to_path_buf())).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// Polling beats a filesystem-watch dependency here: the tree is small and dev
// mode already trades efficiency for immediacy.
fn asset_change_stream(
    root: PathBuf,
) -> impl futures_core::Stream<Item = std::result::Result<Event, Infallible>> {
    stream! {
        let mut previous = fingerprints(&root).await;
        // Tells the client the server is up; seeing it twice means a restart.
        yield Ok(Event::default().event("ready").data("{}"));
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            let current = fingerprints(&root).await;
            let changed = changed_paths(&previous, &current);
            if changed.is_empty() {
                continue;
            }
            previous = current;
            let payload = serde_json::json!({ "paths": changed });
            yield Ok(Event::default().event("change").data(payload.to_string()));
        }
    }
}

type Fingerprints = BTreeMap<String, (SystemTime, u64)>;

async fn fingerprints(root: &Path) -> Fingerprints {
    let root = root.to_path_buf();
    tokio::task::spawn_blocking(move || scan_fingerprints(&root))
        .await
        .unwrap_or_default()
}

fn scan_fingerprints(root: &Path) -> Fingerprints {
    let mut files = Vec::new();
    collect_files(root, root, &mut files);
    let mut fingerprints = Fingerprints::new();
    for relative in files {
        let Ok(metadata) = std::fs::metadata(root.join(&relative)) else {
            continue;
        };
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        fingerprints.insert(relative, (modified, metadata.len()));
    }
    fingerprints
}

fn changed_paths(previous: &Fingerprints, current: &Fingerprints) -> Vec<String> {
    let mut changed = Vec::new();
    for (path, fingerprint) in current {
        if previous.get(path) != Some(fingerprint) {
            changed.push(path.clone());
        }
    }
    for path in previous.keys() {
        if !current.contains_key(path) {
            changed.push(path.clone());
        }
    }
    changed.sort();
    changed.dedup();
    changed
}

fn collect_files(dir: &Path, root: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            if SKIP_DIRS.contains(&name.as_ref()) {
                continue;
            }
            collect_files(&path, root, out);
        } else if let Ok(relative) = path.strip_prefix(root) {
            out.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
}

// Maps component names to their declaration site. The locator reads React fiber
// names in the browser, which is all the buildless setup can offer — there is no
// transform to inject source locations.
fn scan_components(root: &Path) -> BTreeMap<String, Vec<ComponentSource>> {
    let mut index: BTreeMap<String, Vec<ComponentSource>> = BTreeMap::new();
    let mut files = Vec::new();
    collect_files(&root.join("app"), root, &mut files);
    for relative in files {
        if !relative.ends_with(".js") {
            continue;
        }
        let Ok(source) = std::fs::read_to_string(root.join(&relative)) else {
            continue;
        };
        for (offset, line) in source.lines().enumerate() {
            let Some(name) = declared_name(line) else {
                continue;
            };
            index.entry(name).or_default().push(ComponentSource {
                file: relative.clone(),
                line: offset + 1,
            });
        }
    }
    index
}

// Capitalised top-level declarations. Constants such as `TooltipPosition` match
// too, which is harmless: lookups only ever use names React actually rendered.
fn declared_name(line: &str) -> Option<String> {
    let declaration = line
        .strip_prefix("export default function ")
        .or_else(|| line.strip_prefix("export function "))
        .or_else(|| line.strip_prefix("export const "))
        .or_else(|| line.strip_prefix("function "))
        .or_else(|| line.strip_prefix("const "))?;
    let name: String = declaration
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$')
        .collect();
    if !name.chars().next()?.is_ascii_uppercase() {
        return None;
    }
    Some(name)
}
