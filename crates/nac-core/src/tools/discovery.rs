use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Read as _;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use bytes::BytesMut;
use cap_std::ambient_authority;
use cap_std::fs::Dir;
use futures_util::StreamExt;
use globset::{GlobBuilder, GlobMatcher};
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::Match;
use openssh_sftp_client::{Sftp, SftpOptions};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tokio::process::Child;

use crate::sandbox::ExecutionBackend;

#[cfg(test)]
mod tests;
use crate::tools::{ToolResult, ToolRuntime};

const MAX_ENTRIES: usize = 20_000;
const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_IGNORE_FILE_BYTES: usize = 256 * 1024;
const MAX_TOTAL_IGNORE_BYTES: usize = 1024 * 1024;
const MAX_IGNORE_RULES: usize = 4096;
const MAX_TOTAL_FILE_BYTES: usize = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_MATERIALIZED_BYTES: usize = 8 * 1024 * 1024;
const MAX_FIELD_BYTES: usize = 1024;
const MAX_CONTEXT_LINE_BYTES: usize = 256;
const MAX_MATCHES: usize = 10_000;
const MAX_LINES_PER_FILE: usize = 200_000;
const MAX_RECORDS: usize = 20_000;
const MAX_PATTERN_BYTES: usize = 64 * 1024;
const MAX_REGEX_AUTOMATON_BYTES: usize = 16 * 1024 * 1024;
const MAX_REGEX_NESTING: u32 = 64;
const MAX_COLLECTION_BYTES: usize = 64 * 1024;
const MAX_ROOTS: usize = 32;
const MAX_GLOBS: usize = 128;
const MAX_LIMIT: usize = 1000;
const MAX_CURSOR_BYTES: usize = 4096;
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const CURSOR_VERSION: u64 = 1;

#[cfg(test)]
static ACTIVE_SEARCH_TASKS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[cfg(test)]
static PAUSE_SEARCH_TASKS: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
struct ActiveSearchTask;

#[cfg(test)]
impl ActiveSearchTask {
    fn begin() -> Self {
        ACTIVE_SEARCH_TASKS.fetch_add(1, Ordering::AcqRel);
        Self
    }
}

#[cfg(test)]
impl Drop for ActiveSearchTask {
    fn drop(&mut self) {
        ACTIVE_SEARCH_TASKS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Debug)]
struct SearchError {
    code: &'static str,
    message: String,
    path: Option<String>,
}

impl SearchError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
        }
    }

    fn at(code: &'static str, message: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: Some(path.into()),
        }
    }
}

type SearchResult<T> = Result<T, SearchError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Clone)]
enum Record {
    Entry(Value),
    Match(Value),
    Error(Value),
}

impl Record {
    fn get(&self, key: &str) -> Option<&Value> {
        self.value().get(key)
    }

    fn value(&self) -> &Value {
        match self {
            Self::Entry(value) | Self::Match(value) | Self::Error(value) => value,
        }
    }

    fn into_value(self) -> Value {
        match self {
            Self::Entry(value) | Self::Match(value) | Self::Error(value) => value,
        }
    }

    fn is_error(&self) -> bool {
        matches!(self, Self::Error(_))
    }

    fn sort_tag(&self) -> &'static str {
        match self {
            Self::Entry(_) | Self::Match(_) => "entry",
            Self::Error(_) => "error",
        }
    }
}

#[derive(Debug)]
struct FsEntry {
    name: String,
    kind: EntryKind,
    size: u64,
}

struct DirectoryListing {
    entries: Vec<FsEntry>,
    diagnostics: Vec<Record>,
}

struct LocalOverlay {
    at: String,
    directory: Arc<Dir>,
    path: PathBuf,
    kind: EntryKind,
    size: u64,
}

struct LocalFs {
    root: PathBuf,
    absolute_roots: Vec<PathBuf>,
    directory: Arc<Dir>,
    overlays: Vec<LocalOverlay>,
}

struct RemoteFs {
    root: PathBuf,
    absolute_roots: Vec<PathBuf>,
    sftp: Option<Sftp>,
    child: Child,
}

enum WorkspaceFs {
    Local(LocalFs),
    Remote(RemoteFs),
}

struct SearchCancellation(Arc<AtomicBool>);

impl SearchCancellation {
    fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    fn flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.0)
    }
}

impl Drop for SearchCancellation {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

impl LocalFs {
    fn resolve(&self, relative: &str) -> (Arc<Dir>, PathBuf) {
        let overlay = self
            .overlays
            .iter()
            .filter(|overlay| {
                relative == overlay.at
                    || overlay.kind == EntryKind::Directory
                        && relative.starts_with(&format!("{}/", overlay.at))
            })
            .max_by_key(|overlay| overlay.at.len());
        match overlay {
            Some(overlay) => {
                let remainder = relative
                    .strip_prefix(&overlay.at)
                    .unwrap_or(relative)
                    .trim_start_matches('/');
                let mut mapped = overlay.path.clone();
                if !remainder.is_empty() {
                    mapped.push(remainder);
                }
                (Arc::clone(&overlay.directory), mapped)
            }
            None => (Arc::clone(&self.directory), PathBuf::from(relative)),
        }
    }

    fn injected_children(&self, relative: &str) -> Vec<FsEntry> {
        let prefix = if relative.is_empty() {
            String::new()
        } else {
            format!("{relative}/")
        };
        let mut children = BTreeMap::new();
        for overlay in &self.overlays {
            let Some(remainder) = overlay.at.strip_prefix(&prefix) else {
                continue;
            };
            if remainder.is_empty() {
                continue;
            }
            let (name, nested) = remainder
                .split_once('/')
                .map_or((remainder, false), |(name, _)| (name, true));
            children.insert(
                name.to_string(),
                FsEntry {
                    name: name.to_string(),
                    kind: if nested {
                        EntryKind::Directory
                    } else {
                        overlay.kind
                    },
                    size: if nested { 0 } else { overlay.size },
                },
            );
        }
        children.into_values().collect()
    }

    fn is_virtual_directory(&self, relative: &str) -> bool {
        let prefix = if relative.is_empty() {
            String::new()
        } else {
            format!("{relative}/")
        };
        self.overlays
            .iter()
            .any(|overlay| overlay.at.starts_with(&prefix) && overlay.at != relative)
    }
}

impl WorkspaceFs {
    async fn open(runtime: &ToolRuntime) -> SearchResult<Self> {
        match runtime.backend.as_ref() {
            ExecutionBackend::Local { workspace_cwd } => {
                let root = tokio::fs::canonicalize(workspace_cwd)
                    .await
                    .map_err(|error| {
                        SearchError::at(
                            "unreadable_path",
                            error.to_string(),
                            workspace_cwd.display().to_string(),
                        )
                    })?;
                let directory =
                    Dir::open_ambient_dir(&root, ambient_authority()).map_err(|error| {
                        SearchError::at(
                            "unreadable_path",
                            error.to_string(),
                            workspace_cwd.display().to_string(),
                        )
                    })?;
                return Ok(Self::Local(LocalFs {
                    root: root.clone(),
                    absolute_roots: vec![workspace_cwd.clone(), root.clone()],
                    directory: Arc::new(directory),
                    overlays: Vec::new(),
                }));
            }
            ExecutionBackend::Sandbox(session) => {
                let mounts = session.host_workspace_mounts().ok_or_else(|| {
                    SearchError::new(
                        "backend_protocol",
                        "sandbox discovery requires a host-backed workspace mount",
                    )
                })?;
                let mut opened = Vec::with_capacity(mounts.len());
                for mount in mounts {
                    let at = relative_path_string(&mount.relative).ok_or_else(|| {
                        SearchError::new(
                            "backend_protocol",
                            "sandbox mount target is not valid UTF-8",
                        )
                    })?;
                    let source_relative = mount.source.relative.clone();
                    let source_root =
                        tokio::fs::canonicalize(&mount.source.root)
                            .await
                            .map_err(|error| {
                                SearchError::at(
                                    "unreadable_path",
                                    error.to_string(),
                                    mount.source.root.display().to_string(),
                                )
                            })?;
                    let display = source_root.join(&source_relative);
                    let (directory, path, kind, size) = tokio::task::spawn_blocking(move || {
                        open_local_mount(&source_root, &source_relative)
                    })
                    .await
                    .map_err(|error| {
                        SearchError::new(
                            "internal_error",
                            format!("sandbox workspace task failed: {error}"),
                        )
                    })?
                    .map_err(|error| {
                        SearchError::at(
                            "unreadable_path",
                            error.to_string(),
                            display.to_string_lossy(),
                        )
                    })?;
                    opened.push((
                        LocalOverlay {
                            at,
                            directory: Arc::new(directory),
                            path,
                            kind,
                            size,
                        },
                        display,
                    ));
                }
                let mut opened = opened.into_iter();
                let (base, base_display) = opened.next().ok_or_else(|| {
                    SearchError::new(
                        "backend_protocol",
                        "sandbox discovery has no workspace mount",
                    )
                })?;
                if !base.at.is_empty() || base.kind != EntryKind::Directory {
                    return Err(SearchError::new(
                        "backend_protocol",
                        "sandbox workdir must resolve to a mounted directory",
                    ));
                }
                let overlays = opened.map(|(overlay, _)| overlay).collect();
                return Ok(Self::Local(LocalFs {
                    root: session.spec().workdir.clone(),
                    absolute_roots: vec![session.spec().workdir.clone(), base_display],
                    directory: base.directory,
                    overlays,
                }));
            }
            ExecutionBackend::Ssh(_) => {}
        }

        let ExecutionBackend::Ssh(ssh) = runtime.backend.as_ref() else {
            unreachable!("all execution backends handled above");
        };
        let mut command = ssh
            .sftp_command()
            .map_err(|error| SearchError::new("backend_protocol", error.to_string()))?;
        let mut child = command.spawn().map_err(|error| {
            SearchError::new(
                "backend_protocol",
                format!("failed to start SSH SFTP subsystem: {error}"),
            )
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            SearchError::new("backend_protocol", "SSH SFTP stdin was unavailable")
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            SearchError::new("backend_protocol", "SSH SFTP stdout was unavailable")
        })?;
        if let Some(mut stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut sink = tokio::io::sink();
                let _ = tokio::io::copy(&mut stderr, &mut sink).await;
            });
        }
        let sftp = Sftp::new(stdin, stdout, SftpOptions::default())
            .await
            .map_err(|error| {
                SearchError::new(
                    "backend_protocol",
                    format!("SSH SFTP handshake failed: {error}"),
                )
            })?;
        let requested = ssh.sftp_workspace_path();
        let mut fs = sftp.fs();
        let root = fs.canonicalize(&requested).await.map_err(|error| {
            SearchError::at(
                "unreadable_path",
                error.to_string(),
                requested.display().to_string(),
            )
        })?;
        Ok(Self::Remote(RemoteFs {
            root: root.clone(),
            absolute_roots: vec![requested, root.clone()],
            sftp: Some(sftp),
            child,
        }))
    }

    fn root(&self) -> &Path {
        match self {
            Self::Local(fs) => &fs.root,
            Self::Remote(fs) => &fs.root,
        }
    }

    fn relative_absolute(&self, requested: &Path) -> Option<PathBuf> {
        let roots = match self {
            Self::Local(fs) => &fs.absolute_roots,
            Self::Remote(fs) => &fs.absolute_roots,
        };
        roots
            .iter()
            .filter_map(|root| requested.strip_prefix(root).ok())
            .min_by_key(|relative| relative.components().count())
            .map(Path::to_path_buf)
    }

    fn absolute(&self, relative: &str) -> PathBuf {
        if relative.is_empty() {
            self.root().to_path_buf()
        } else {
            self.root().join(relative)
        }
    }

    async fn list_dir(
        &mut self,
        relative: &str,
        maximum: usize,
        cancellation: &Arc<AtomicBool>,
    ) -> SearchResult<DirectoryListing> {
        let requested = self.absolute(relative);
        let absolute = if matches!(self, Self::Remote(_)) {
            self.confined_path(&requested, relative).await?
        } else {
            requested
        };
        let display = display_path(relative);
        let (mut entries, diagnostics) = match self {
            Self::Local(local) => {
                let (root, mapped) = local.resolve(relative);
                let injected = local.injected_children(relative);
                let relative = relative.to_string();
                let cancellation = Arc::clone(cancellation);
                let directory = if mapped.as_os_str().is_empty() {
                    PathBuf::from(".")
                } else {
                    PathBuf::from(&mapped)
                };
                tokio::task::spawn_blocking(move || {
                    let mut entries = Vec::new();
                    let mut diagnostics = Vec::new();
                    let directory_entries = match root.read_dir(&directory) {
                        Ok(entries) => Some(entries),
                        Err(error)
                            if error.kind() == std::io::ErrorKind::NotFound
                                && !injected.is_empty() =>
                        {
                            None
                        }
                        Err(error) => {
                            return Err(SearchError::at(
                                "unreadable_path",
                                error.to_string(),
                                display_path(&relative),
                            ));
                        }
                    };
                    let mut seen = 0usize;
                    if let Some(directory_entries) = directory_entries {
                        for entry in directory_entries {
                            if cancellation.load(Ordering::Acquire) {
                                return Err(SearchError::new("cancelled", "search was cancelled"));
                            }
                            seen += 1;
                            if seen > maximum {
                                return Err(SearchError::at(
                                    "entry_limit",
                                    format!(
                                        "directory exceeds the remaining {maximum}-entry budget"
                                    ),
                                    display_path(&relative),
                                ));
                            }
                            let entry = match entry {
                                Ok(entry) => entry,
                                Err(error) => {
                                    diagnostics.push(diagnostic(
                                        "unreadable_path",
                                        &error.to_string(),
                                        Some(&display_path(&relative)),
                                    ));
                                    continue;
                                }
                            };
                            let name = match entry.file_name().into_string() {
                                Ok(name) => name,
                                Err(_) => {
                                    diagnostics.push(diagnostic(
                                        "invalid_utf8_path",
                                        "path is not valid UTF-8",
                                        Some(&display_path(&relative)),
                                    ));
                                    continue;
                                }
                            };
                            let child = directory.join(&name);
                            let metadata = match root.symlink_metadata(&child) {
                                Ok(metadata) => metadata,
                                Err(error) => {
                                    diagnostics.push(diagnostic(
                                        "unreadable_path",
                                        &error.to_string(),
                                        Some(&join_path(&relative, &name)),
                                    ));
                                    continue;
                                }
                            };
                            entries.push(FsEntry {
                                name,
                                kind: entry_kind_from_file_type(metadata.file_type()),
                                size: metadata.len(),
                            });
                        }
                    }
                    for injected_entry in injected {
                        if let Some(existing) = entries
                            .iter_mut()
                            .find(|entry| entry.name == injected_entry.name)
                        {
                            *existing = injected_entry;
                            continue;
                        }
                        seen += 1;
                        if seen > maximum {
                            return Err(SearchError::at(
                                "entry_limit",
                                format!("directory exceeds the remaining {maximum}-entry budget"),
                                display_path(&relative),
                            ));
                        }
                        entries.push(injected_entry);
                    }
                    Ok((entries, diagnostics))
                })
                .await
                .map_err(|error| {
                    SearchError::new(
                        "internal_error",
                        format!("local directory task failed: {error}"),
                    )
                })??
            }
            Self::Remote(remote) => {
                let sftp = remote.sftp.as_ref().ok_or_else(|| {
                    SearchError::new("backend_protocol", "SSH SFTP session is closed")
                })?;
                let mut fs = sftp.fs();
                let directory = fs.open_dir(&absolute).await.map_err(|error| {
                    SearchError::at("unreadable_path", error.to_string(), display.clone())
                })?;
                let stream = directory.read_dir();
                tokio::pin!(stream);
                let mut entries = Vec::new();
                let mut diagnostics = Vec::new();
                let mut seen = 0usize;
                while let Some(entry) = stream.next().await {
                    if cancellation.load(Ordering::Acquire) {
                        return Err(SearchError::new("cancelled", "search was cancelled"));
                    }
                    let entry = match entry {
                        Ok(entry) => entry,
                        Err(error) => {
                            charge_directory_entry(&mut seen, maximum, &display)?;
                            diagnostics.push(diagnostic(
                                "unreadable_path",
                                &error.to_string(),
                                Some(&display),
                            ));
                            continue;
                        }
                    };
                    let name = match entry.filename().to_str() {
                        Some(name) => name.to_string(),
                        None => {
                            charge_directory_entry(&mut seen, maximum, &display)?;
                            diagnostics.push(diagnostic(
                                "invalid_utf8_path",
                                "path is not valid UTF-8",
                                Some(&display),
                            ));
                            continue;
                        }
                    };
                    if name == "." || name == ".." {
                        continue;
                    }
                    charge_directory_entry(&mut seen, maximum, &display)?;
                    let metadata = entry.metadata();
                    let kind = match metadata.file_type() {
                        Some(file_type) if file_type.is_symlink() => EntryKind::Symlink,
                        Some(file_type) if file_type.is_dir() => EntryKind::Directory,
                        Some(file_type) if file_type.is_file() => EntryKind::File,
                        _ => EntryKind::Other,
                    };
                    entries.push(FsEntry {
                        name,
                        kind,
                        size: metadata.len().unwrap_or(0),
                    });
                }
                (entries, diagnostics)
            }
        };
        entries.sort_by(|left, right| left.name.as_bytes().cmp(right.name.as_bytes()));
        Ok(DirectoryListing {
            entries,
            diagnostics,
        })
    }

    async fn read_file(&mut self, relative: &str, maximum: usize) -> SearchResult<Vec<u8>> {
        if let Self::Local(local) = self {
            let (root, mapped) = local.resolve(relative);
            let display = relative.to_string();
            return tokio::task::spawn_blocking(move || {
                let mut options = cap_std::fs::OpenOptions::new();
                options.read(true);
                #[cfg(unix)]
                {
                    use cap_std::fs::OpenOptionsExt;
                    options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
                }
                let file = root.open_with(&mapped, &options).map_err(|error| {
                    SearchError::at("unreadable_path", error.to_string(), display.clone())
                })?;
                let metadata = file.metadata().map_err(|error| {
                    SearchError::at("unreadable_path", error.to_string(), display.clone())
                })?;
                if !metadata.is_file() {
                    return Err(SearchError::at(
                        "unreadable_path",
                        "path is not a regular file",
                        display,
                    ));
                }
                let mut bytes = Vec::new();
                file.take((maximum + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|error| {
                        SearchError::at("unreadable_path", error.to_string(), display)
                    })?;
                Ok(bytes)
            })
            .await
            .map_err(|error| {
                SearchError::new("internal_error", format!("local file task failed: {error}"))
            })?;
        }

        let requested = self.absolute(relative);
        let absolute = self.confined_path(&requested, relative).await?;
        let bytes = match self {
            Self::Remote(remote) => {
                let sftp = remote.sftp.as_ref().ok_or_else(|| {
                    SearchError::new("backend_protocol", "SSH SFTP session is closed")
                })?;
                let mut file = sftp.open(&absolute).await.map_err(|error| {
                    SearchError::at("unreadable_path", error.to_string(), relative)
                })?;
                let length = file
                    .metadata()
                    .await
                    .map_err(|error| {
                        SearchError::at("unreadable_path", error.to_string(), relative)
                    })?
                    .len()
                    .ok_or_else(|| {
                        SearchError::at(
                            "backend_protocol",
                            "SSH SFTP server omitted the file length",
                            relative,
                        )
                    })? as usize;
                let bytes = file
                    .read_all(length.min(maximum + 1), BytesMut::new())
                    .await
                    .map_err(|error| {
                        SearchError::at("unreadable_path", error.to_string(), relative)
                    })?;
                let _ = file.close().await;
                bytes.to_vec()
            }
            Self::Local(_) => unreachable!("local reads return before remote dispatch"),
        };
        Ok(bytes)
    }

    async fn confined_path(&mut self, absolute: &Path, display: &str) -> SearchResult<PathBuf> {
        if let Self::Local(local) = self {
            let (root, mapped) = local.resolve(display);
            tokio::task::spawn_blocking(move || root.canonicalize(mapped))
                .await
                .map_err(|error| {
                    SearchError::new(
                        "internal_error",
                        format!("local canonicalization task failed: {error}"),
                    )
                })?
                .map_err(|error| SearchError::at("symlink_escape", error.to_string(), display))?;
            return Ok(self.absolute(display));
        }
        let Self::Remote(remote) = self else {
            unreachable!("local confinement returns before remote dispatch");
        };
        let sftp = remote
            .sftp
            .as_ref()
            .ok_or_else(|| SearchError::new("backend_protocol", "SSH SFTP session is closed"))?;
        let mut fs = sftp.fs();
        let canonical = fs
            .canonicalize(absolute)
            .await
            .map_err(|error| SearchError::at("unreadable_path", error.to_string(), display))?;
        if canonical != remote.root && !canonical.starts_with(&remote.root) {
            return Err(SearchError::at(
                "symlink_escape",
                "symlink target leaves the workspace",
                display,
            ));
        }
        Ok(canonical)
    }

    async fn symlink_diagnostic(&mut self, relative: &str) -> Record {
        let absolute = self.absolute(relative);
        match self.confined_path(&absolute, relative).await {
            Ok(_) => diagnostic(
                "symlink_unsupported",
                "symlinks are not followed",
                Some(relative),
            ),
            Err(error) if error.code == "symlink_escape" => diagnostic(
                "symlink_escape",
                "symlink target leaves the workspace",
                Some(relative),
            ),
            Err(_) => diagnostic(
                "symlink_escape",
                "symlink target leaves the workspace",
                Some(relative),
            ),
        }
    }
    async fn optional_path_metadata(
        &mut self,
        relative: &str,
    ) -> SearchResult<Option<(EntryKind, u64)>> {
        let absolute = self.absolute(relative);
        match self {
            Self::Local(local) => {
                let virtual_directory = local.is_virtual_directory(relative);
                let (root, mapped) = local.resolve(relative);
                let display = relative.to_string();
                let metadata = tokio::task::spawn_blocking(move || root.symlink_metadata(&mapped))
                    .await
                    .map_err(|error| {
                        SearchError::new(
                            "internal_error",
                            format!("local metadata task failed: {error}"),
                        )
                    })?;
                match metadata {
                    Ok(metadata) => Ok(Some((
                        entry_kind_from_file_type(metadata.file_type()),
                        metadata.len(),
                    ))),
                    Err(error)
                        if error.kind() == std::io::ErrorKind::NotFound && virtual_directory =>
                    {
                        Ok(Some((EntryKind::Directory, 0)))
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                    Err(error) => Err(SearchError::at(
                        "unreadable_path",
                        error.to_string(),
                        display,
                    )),
                }
            }
            Self::Remote(remote) => {
                let sftp = remote.sftp.as_ref().ok_or_else(|| {
                    SearchError::new("backend_protocol", "SSH SFTP session is closed")
                })?;
                let mut fs = sftp.fs();
                match fs.symlink_metadata(&absolute).await {
                    Ok(metadata) => Ok(Some((
                        match metadata.file_type() {
                            Some(file_type) if file_type.is_symlink() => EntryKind::Symlink,
                            Some(file_type) if file_type.is_dir() => EntryKind::Directory,
                            Some(file_type) if file_type.is_file() => EntryKind::File,
                            _ => EntryKind::Other,
                        },
                        metadata.len().unwrap_or(0),
                    ))),
                    Err(openssh_sftp_client::Error::SftpError(
                        openssh_sftp_client::error::SftpErrorKind::NoSuchFile,
                        _,
                    )) => Ok(None),
                    Err(error) => Err(SearchError::at(
                        "unreadable_path",
                        error.to_string(),
                        display_path(relative),
                    )),
                }
            }
        }
    }

    async fn path_kind(&mut self, relative: &str) -> SearchResult<EntryKind> {
        let absolute = self.absolute(relative);
        match self {
            Self::Local(local) => {
                let virtual_directory = local.is_virtual_directory(relative);
                let (root, mapped) = local.resolve(relative);
                let display = relative.to_string();
                let metadata = tokio::task::spawn_blocking(move || root.symlink_metadata(&mapped))
                    .await
                    .map_err(|error| {
                        SearchError::new(
                            "internal_error",
                            format!("local metadata task failed: {error}"),
                        )
                    })?;
                match metadata {
                    Ok(metadata) => Ok(entry_kind_from_file_type(metadata.file_type())),
                    Err(error)
                        if error.kind() == std::io::ErrorKind::NotFound && virtual_directory =>
                    {
                        Ok(EntryKind::Directory)
                    }
                    Err(error) => Err(SearchError::at(
                        "unreadable_path",
                        error.to_string(),
                        display_path(&display),
                    )),
                }
            }
            Self::Remote(remote) => {
                let sftp = remote.sftp.as_ref().ok_or_else(|| {
                    SearchError::new("backend_protocol", "SSH SFTP session is closed")
                })?;
                let mut fs = sftp.fs();
                let metadata = fs.symlink_metadata(&absolute).await.map_err(|error| {
                    SearchError::at("unreadable_path", error.to_string(), display_path(relative))
                })?;
                Ok(match metadata.file_type() {
                    Some(file_type) if file_type.is_symlink() => EntryKind::Symlink,
                    Some(file_type) if file_type.is_dir() => EntryKind::Directory,
                    Some(file_type) if file_type.is_file() => EntryKind::File,
                    _ => EntryKind::Other,
                })
            }
        }
    }

    async fn close(mut self) {
        if let Self::Remote(remote) = &mut self {
            if let Some(sftp) = remote.sftp.take() {
                let _ = sftp.close().await;
            }
            let _ = remote.child.wait().await;
        }
    }
}
fn charge_directory_entry(seen: &mut usize, maximum: usize, display: &str) -> SearchResult<()> {
    *seen += 1;
    if *seen > maximum {
        return Err(SearchError::at(
            "entry_limit",
            format!("directory exceeds the remaining {maximum}-entry budget"),
            display,
        ));
    }
    Ok(())
}

fn open_local_mount(
    source_root: &Path,
    source_relative: &Path,
) -> std::io::Result<(Dir, PathBuf, EntryKind, u64)> {
    let root_metadata = std::fs::metadata(source_root)?;
    let (directory, path) = if root_metadata.is_dir() {
        (
            Dir::open_ambient_dir(source_root, ambient_authority())?,
            source_relative.to_path_buf(),
        )
    } else if source_relative.as_os_str().is_empty() {
        let parent = source_root.parent().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "mounted file has no parent directory",
            )
        })?;
        let name = source_root.file_name().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "mounted file has no file name",
            )
        })?;
        (
            Dir::open_ambient_dir(parent, ambient_authority())?,
            PathBuf::from(name),
        )
    } else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotADirectory,
            "sandbox mount source root is not a directory",
        ));
    };
    let metadata_path = if path.as_os_str().is_empty() {
        Path::new(".")
    } else {
        path.as_path()
    };
    let metadata = directory.symlink_metadata(metadata_path)?;
    let kind = entry_kind_from_file_type(metadata.file_type());
    match kind {
        EntryKind::Directory => {
            let mounted = if path.as_os_str().is_empty() {
                directory
            } else {
                open_dir_nofollow(directory, &path)?
            };
            Ok((mounted, PathBuf::new(), EntryKind::Directory, 0))
        }
        EntryKind::File => Ok((directory, path, EntryKind::File, metadata.len())),
        EntryKind::Symlink | EntryKind::Other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "sandbox mount source is not a regular file or directory",
        )),
    }
}

fn open_dir_nofollow(mut directory: Dir, relative: &Path) -> std::io::Result<Dir> {
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "workspace mount path is not relative",
            ));
        };
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            let mut options = cap_std::fs::OpenOptions::new();
            options
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW);
            let file = directory.open_with(name, &options)?;
            directory = Dir::from_std_file(file.into_std());
        }
        #[cfg(not(unix))]
        {
            let metadata = directory.symlink_metadata(name)?;
            if metadata.file_type().is_symlink() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "workspace mount path contains a symlink",
                ));
            }
            directory = directory.open_dir(name)?;
        }
    }
    Ok(directory)
}

fn entry_kind_from_file_type(file_type: cap_std::fs::FileType) -> EntryKind {
    if file_type.is_symlink() {
        EntryKind::Symlink
    } else if file_type.is_dir() {
        EntryKind::Directory
    } else if file_type.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    }
}

#[derive(Clone)]
struct IgnoreLayer {
    base: String,
    matcher: Arc<Gitignore>,
}

struct IgnoreCacheEntry {
    matcher: Arc<Gitignore>,
    diagnostics: Vec<Record>,
}

struct IgnoreState {
    cache: HashMap<String, IgnoreCacheEntry>,
    bytes: usize,
    rules: usize,
}

impl IgnoreState {
    fn new() -> Self {
        Self {
            cache: HashMap::new(),
            bytes: 0,
            rules: 0,
        }
    }
}

struct WalkBudget {
    entries: usize,
}

struct CommonArgs {
    gitignore: bool,
    hidden: bool,
    limit: usize,
}

#[derive(Clone)]
struct GrepPlan {
    matcher: RegexMatcher,
    multiline: bool,
    context: usize,
}

enum GrepRoot {
    Directory,
    File(u64),
    Diagnostic(Record),
}

impl GrepRoot {
    fn contains_descendants(&self) -> bool {
        matches!(self, Self::Directory)
    }
}

pub(crate) async fn execute(tool: &'static str, args: Value, runtime: &ToolRuntime) -> ToolResult {
    if !args.is_object() {
        return error_result(
            "invalid_arguments",
            "tool arguments must be an object",
            None,
        );
    }
    let result = tokio::time::timeout(QUERY_TIMEOUT, execute_inner(tool, args, runtime)).await;
    match result {
        Ok(Ok(value)) => ToolResult {
            content: (value.to_string()).into(),
            is_error: false,
        },
        Ok(Err(error)) => error_result(error.code, &error.message, error.path.as_deref()),
        Err(_) => error_result(
            "search_timeout",
            "search exceeded the query time limit",
            None,
        ),
    }
}

async fn execute_inner(
    tool: &'static str,
    args: Value,
    runtime: &ToolRuntime,
) -> SearchResult<Value> {
    let cancellation = SearchCancellation::new();
    let cancellation_flag = cancellation.flag();
    let mut fs = WorkspaceFs::open(runtime).await?;
    let result = match tool {
        "glob" => run_glob(&mut fs, &args, &cancellation_flag).await,
        "grep" => run_grep(&mut fs, &args, &cancellation_flag).await,
        _ => Err(SearchError::new(
            "invalid_arguments",
            "unknown discovery tool",
        )),
    };
    fs.close().await;
    result
}

async fn run_glob(
    fs: &mut WorkspaceFs,
    args: &Value,
    cancellation: &Arc<AtomicBool>,
) -> SearchResult<Value> {
    let object = args.as_object().expect("validated object");
    let pattern = required_string(
        object,
        "pattern",
        "invalid_glob",
        "glob pattern must be a string",
    )?;
    let matcher = compile_glob(pattern)?;
    let root = normalize_path(fs, object.get("root"), "root").await?;
    let common = parse_common(object)?;
    let mut walk_budget = WalkBudget { entries: 0 };
    let mut ignore_state = IgnoreState::new();
    let records = walk_root(
        fs,
        &root,
        common.hidden,
        common.gitignore,
        &mut walk_budget,
        &mut ignore_state,
        cancellation,
    )
    .await?;
    let prefix = if root.is_empty() {
        String::new()
    } else {
        format!("{root}/")
    };
    let mut selected = Vec::new();
    for record in records {
        if record.is_error() {
            selected.push(record);
            continue;
        }
        let path = record_path(&record);
        let relative = path.strip_prefix(&prefix).unwrap_or(path);
        if matcher.is_match(relative) {
            selected.push(record);
        }
    }
    sort_records(&mut selected);
    paginate("glob", args, selected, common.limit)
}

async fn run_grep(
    fs: &mut WorkspaceFs,
    args: &Value,
    cancellation: &Arc<AtomicBool>,
) -> SearchResult<Value> {
    let object = args.as_object().expect("validated object");
    let plan = compile_grep(object)?;
    let common = parse_common(object)?;
    let roots_value = object.get("roots").cloned().unwrap_or_else(|| json!(["."]));
    let roots_array = roots_value.as_array().ok_or_else(|| {
        SearchError::new(
            "invalid_arguments",
            "roots must be a non-empty array of strings",
        )
    })?;
    if roots_array.is_empty() || roots_array.iter().any(|root| !root.is_string()) {
        return Err(SearchError::new(
            "invalid_arguments",
            "roots must be a non-empty array of strings",
        ));
    }
    validate_collection(roots_array, "roots", MAX_ROOTS)?;
    let mut roots = Vec::new();
    for root in roots_array {
        roots.push(normalize_path(fs, Some(root), "root").await?);
    }
    roots.sort();
    roots.dedup();
    let mut grep_roots = Vec::<(String, GrepRoot)>::new();
    for root in roots {
        if grep_roots.iter().any(|(parent, kind)| {
            kind.contains_descendants()
                && (root == *parent || parent.is_empty() || root.starts_with(&format!("{parent}/")))
        }) {
            continue;
        }
        let kind = classify_grep_root(fs, &root).await?;
        grep_roots.push((root, kind));
    }

    let globs_value = object.get("globs").cloned().unwrap_or_else(|| json!([]));
    let globs_array = if globs_value.is_null() {
        &[][..]
    } else {
        globs_value.as_array().ok_or_else(|| {
            SearchError::new("invalid_arguments", "globs must be an array of strings")
        })?
    };
    if globs_array.iter().any(|glob| !glob.is_string()) {
        return Err(SearchError::new(
            "invalid_arguments",
            "globs must be an array of strings",
        ));
    }
    validate_collection(globs_array, "globs", MAX_GLOBS)?;
    let glob_matchers = globs_array
        .iter()
        .map(|value| compile_glob(value.as_str().expect("validated string")))
        .collect::<SearchResult<Vec<_>>>()?;

    let mut inventory = Vec::new();
    let mut seen = HashSet::new();
    let mut walk_budget = WalkBudget { entries: 0 };
    let mut ignore_state = IgnoreState::new();
    for (root, kind) in grep_roots {
        let records = collect_grep_root(
            fs,
            &root,
            kind,
            common.hidden,
            common.gitignore,
            &mut walk_budget,
            &mut ignore_state,
            cancellation,
        )
        .await?;
        for record in records {
            let identity = (
                record_path(&record).to_string(),
                record.sort_tag().to_string(),
                record
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            );
            if seen.insert(identity) {
                inventory.push(record);
            }
        }
    }

    let mut records: Vec<Record> = inventory
        .iter()
        .filter(|record| record.is_error())
        .cloned()
        .collect();
    let mut total_bytes = 0usize;
    let mut materialized_bytes = 0usize;
    for item in &inventory {
        if item.is_error() || item.get("kind").and_then(Value::as_str) != Some("file") {
            continue;
        }
        let path = record_path(item);
        if !glob_matchers.is_empty() && !glob_matchers.iter().any(|glob| glob.is_match(path)) {
            continue;
        }
        if records.len() >= MAX_RECORDS - 1 {
            records.push(diagnostic(
                "record_limit",
                &format!("search exceeded {MAX_RECORDS} structured records"),
                Some(path),
            ));
            break;
        }
        let size = item.get("size").and_then(Value::as_u64).unwrap_or(0) as usize;
        if size > MAX_TOTAL_FILE_BYTES.saturating_sub(total_bytes) {
            records.push(diagnostic(
                "total_read_limit",
                &format!("search exceeded {MAX_TOTAL_FILE_BYTES} input bytes"),
                Some(path),
            ));
            break;
        }
        let remaining = MAX_RECORDS - records.len();
        let (mut found, read_bytes) = search_file(
            fs,
            path,
            size,
            &plan,
            remaining.saturating_sub(1).max(1),
            &mut materialized_bytes,
            cancellation,
        )
        .await;
        total_bytes += read_bytes;
        let query_limit_hit = found.iter().any(|entry| {
            matches!(
                entry.get("code").and_then(Value::as_str),
                Some("record_limit" | "materialized_limit")
            )
        });
        found.truncate(remaining);
        records.extend(found);
        if query_limit_hit {
            break;
        }
    }
    sort_records(&mut records);
    paginate("grep", args, records, common.limit)
}

async fn classify_grep_root(fs: &mut WorkspaceFs, root: &str) -> SearchResult<GrepRoot> {
    if root.is_empty() {
        return Ok(GrepRoot::Directory);
    }

    if let Some((parent_path, _)) = root.rsplit_once('/') {
        let mut parent = String::new();
        for component in parent_path.split('/') {
            parent = join_path(&parent, component);
            match fs.path_kind(&parent).await? {
                EntryKind::Directory => {}
                EntryKind::Symlink => {
                    return Ok(GrepRoot::Diagnostic(fs.symlink_diagnostic(&parent).await));
                }
                EntryKind::File | EntryKind::Other => {
                    return Err(SearchError::at(
                        "not_directory",
                        "search root ancestor is not a directory",
                        parent,
                    ));
                }
            }
        }
    }

    let Some((kind, size)) = fs.optional_path_metadata(root).await? else {
        return Err(SearchError::at(
            "unreadable_path",
            "search root does not exist",
            root,
        ));
    };
    match kind {
        EntryKind::Directory => Ok(GrepRoot::Directory),
        EntryKind::File => Ok(GrepRoot::File(size)),
        EntryKind::Symlink => Ok(GrepRoot::Diagnostic(fs.symlink_diagnostic(root).await)),
        EntryKind::Other => Err(SearchError::at(
            "not_directory",
            "search root is not a directory or regular file",
            root,
        )),
    }
}

async fn collect_grep_root(
    fs: &mut WorkspaceFs,
    root: &str,
    kind: GrepRoot,
    hidden: bool,
    gitignore: bool,
    walk_budget: &mut WalkBudget,
    ignore_state: &mut IgnoreState,
    cancellation: &Arc<AtomicBool>,
) -> SearchResult<Vec<Record>> {
    match kind {
        GrepRoot::Directory => {
            walk_directory_root(
                fs,
                root,
                hidden,
                gitignore,
                walk_budget,
                ignore_state,
                cancellation,
            )
            .await
        }
        GrepRoot::Diagnostic(record) => Ok(vec![record]),
        GrepRoot::File(size) => {
            if !hidden && is_hidden(root) {
                return Ok(Vec::new());
            }

            let mut inherited = Vec::new();
            let mut records = Vec::new();
            if gitignore {
                for ancestor in ancestors_before(root) {
                    if !ancestor.is_empty() && ignored(fs.root(), &ancestor, true, &inherited) {
                        return Ok(records);
                    }
                    let (layer, diagnostics) = load_ignore(fs, &ancestor, ignore_state).await?;
                    records.extend(diagnostics);
                    if let Some(layer) = layer {
                        inherited.push(layer);
                    }
                }
                if ignored(fs.root(), root, false, &inherited) {
                    return Ok(records);
                }
            }
            records.push(Record::Entry(json!({
                "path": root,
                "kind": "file",
                "size": size,
            })));
            Ok(records)
        }
    }
}

async fn walk_root(
    fs: &mut WorkspaceFs,
    root: &str,
    hidden: bool,
    gitignore: bool,
    walk_budget: &mut WalkBudget,
    ignore_state: &mut IgnoreState,
    cancellation: &Arc<AtomicBool>,
) -> SearchResult<Vec<Record>> {
    if !root.is_empty() {
        let mut prefix = String::new();
        for component in root.split('/') {
            prefix = join_path(&prefix, component);
            match fs.path_kind(&prefix).await? {
                EntryKind::Directory => {}
                EntryKind::Symlink => {
                    return Ok(vec![fs.symlink_diagnostic(&prefix).await]);
                }
                EntryKind::File | EntryKind::Other => {
                    return Err(SearchError::at(
                        "not_directory",
                        "search root is not a directory",
                        prefix,
                    ));
                }
            }
        }
    }
    walk_directory_root(
        fs,
        root,
        hidden,
        gitignore,
        walk_budget,
        ignore_state,
        cancellation,
    )
    .await
}

async fn walk_directory_root(
    fs: &mut WorkspaceFs,
    root: &str,
    hidden: bool,
    gitignore: bool,
    walk_budget: &mut WalkBudget,
    ignore_state: &mut IgnoreState,
    cancellation: &Arc<AtomicBool>,
) -> SearchResult<Vec<Record>> {
    let mut inherited = Vec::new();
    let mut records = Vec::new();
    if gitignore {
        for ancestor in ancestors_before(root) {
            let (layer, diagnostics) = load_ignore(fs, &ancestor, ignore_state).await?;
            records.extend(diagnostics);
            if let Some(layer) = layer {
                inherited.push(layer);
            }
        }
    }
    if !root.is_empty() && !hidden && is_hidden(root) {
        return Ok(records);
    }
    if !root.is_empty() && gitignore && has_ignored_ancestor(fs.root(), root, &inherited) {
        return Ok(records);
    }

    let mut stack = vec![(root.to_string(), inherited)];
    while let Some((directory, inherited)) = stack.pop() {
        let remaining_entries = MAX_ENTRIES.saturating_sub(walk_budget.entries);
        if remaining_entries == 0 {
            records.push(diagnostic(
                "entry_limit",
                &format!("traversal exceeded {MAX_ENTRIES} entries"),
                Some(&directory),
            ));
            return Ok(records);
        }
        let listing = match fs
            .list_dir(&directory, remaining_entries, cancellation)
            .await
        {
            Ok(listing) => listing,
            Err(error) if error.code == "cancelled" => return Err(error),
            Err(error) => {
                records.push(diagnostic(
                    error.code,
                    &error.message,
                    error.path.as_deref(),
                ));
                if error.code == "entry_limit" {
                    return Ok(records);
                }
                continue;
            }
        };
        records.extend(listing.diagnostics);
        let entries = listing.entries;
        let mut rules = inherited;
        if gitignore {
            let (layer, diagnostics) =
                load_ignore_from_entries(fs, &directory, &entries, ignore_state).await?;
            records.extend(diagnostics);
            if let Some(layer) = layer {
                rules.push(layer);
            }
        }
        let mut child_dirs = Vec::new();
        for entry in entries {
            let path = join_path(&directory, &entry.name);
            if !hidden && is_hidden(&path) {
                continue;
            }
            walk_budget.entries += 1;
            if walk_budget.entries > MAX_ENTRIES {
                records.push(diagnostic(
                    "entry_limit",
                    &format!("traversal exceeded {MAX_ENTRIES} entries"),
                    Some(&path),
                ));
                cap_records(&mut records, &path);
                return Ok(records);
            }
            let is_dir = entry.kind == EntryKind::Directory;
            if gitignore && ignored(fs.root(), &path, is_dir, &rules) {
                continue;
            }
            if entry.kind == EntryKind::Symlink {
                records.push(fs.symlink_diagnostic(&path).await);
                continue;
            }
            match entry.kind {
                EntryKind::Directory => {
                    records.push(Record::Entry(json!({
                        "path": path,
                        "kind": "directory",
                    })));
                    child_dirs.push((path, rules.clone()));
                }
                EntryKind::File => records.push(Record::Entry(json!({
                    "path": path,
                    "kind": "file",
                    "size": entry.size,
                }))),
                EntryKind::Symlink | EntryKind::Other => {}
            }
        }
        for child in child_dirs.into_iter().rev() {
            stack.push(child);
        }
    }
    cap_records(&mut records, display_path(root).as_str());
    Ok(records)
}

async fn load_ignore(
    fs: &mut WorkspaceFs,
    directory: &str,
    state: &mut IgnoreState,
) -> SearchResult<(Option<IgnoreLayer>, Vec<Record>)> {
    if let Some(cached) = state.cache.get(directory) {
        return Ok((
            Some(IgnoreLayer {
                base: directory.to_string(),
                matcher: Arc::clone(&cached.matcher),
            }),
            cached.diagnostics.clone(),
        ));
    }
    let ignore_path = join_path(directory, ".gitignore");
    let entries = match fs.optional_path_metadata(&ignore_path).await? {
        Some((kind, size)) => vec![FsEntry {
            name: ".gitignore".to_string(),
            kind,
            size,
        }],
        None => Vec::new(),
    };
    load_ignore_from_entries(fs, directory, &entries, state).await
}

async fn load_ignore_from_entries(
    fs: &mut WorkspaceFs,
    directory: &str,
    entries: &[FsEntry],
    state: &mut IgnoreState,
) -> SearchResult<(Option<IgnoreLayer>, Vec<Record>)> {
    if let Some(cached) = state.cache.get(directory) {
        return Ok((
            Some(IgnoreLayer {
                base: directory.to_string(),
                matcher: Arc::clone(&cached.matcher),
            }),
            cached.diagnostics.clone(),
        ));
    }
    let ignore_entry = entries.iter().find(|entry| entry.name == ".gitignore");
    let Some(ignore_entry) = ignore_entry else {
        let matcher = Arc::new(Gitignore::empty());
        state.cache.insert(
            directory.to_string(),
            IgnoreCacheEntry {
                matcher,
                diagnostics: Vec::new(),
            },
        );
        return Ok((None, Vec::new()));
    };
    let ignore_path = join_path(directory, ".gitignore");
    if ignore_entry.kind != EntryKind::File {
        let diagnostics = vec![diagnostic(
            "unreadable_path",
            ".gitignore is not a regular file",
            Some(&ignore_path),
        )];
        let matcher = Arc::new(Gitignore::empty());
        state.cache.insert(
            directory.to_string(),
            IgnoreCacheEntry {
                matcher,
                diagnostics: diagnostics.clone(),
            },
        );
        return Ok((None, diagnostics));
    }
    if ignore_entry.size as usize > MAX_IGNORE_FILE_BYTES {
        return Err(SearchError::at(
            "ignore_limit",
            format!(".gitignore exceeds {MAX_IGNORE_FILE_BYTES} bytes"),
            ignore_path,
        ));
    }
    let raw = fs.read_file(&ignore_path, MAX_IGNORE_FILE_BYTES).await?;
    if raw.len() > MAX_IGNORE_FILE_BYTES {
        return Err(SearchError::at(
            "ignore_limit",
            format!(".gitignore exceeds {MAX_IGNORE_FILE_BYTES} bytes"),
            ignore_path,
        ));
    }
    state.bytes += raw.len();
    if state.bytes > MAX_TOTAL_IGNORE_BYTES {
        return Err(SearchError::at(
            "ignore_limit",
            format!("ignore files exceed {MAX_TOTAL_IGNORE_BYTES} aggregate bytes"),
            ignore_path,
        ));
    }
    let text = String::from_utf8_lossy(&raw);
    let builder_root = fs.absolute(directory);
    let mut builder = GitignoreBuilder::new(builder_root);
    builder.allow_unclosed_class(false);
    let mut diagnostics = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let normalized = normalize_ignore_pattern(line);
        if !normalized.is_empty() && !normalized.starts_with('#') {
            state.rules += 1;
            if state.rules > MAX_IGNORE_RULES {
                return Err(SearchError::at(
                    "ignore_limit",
                    format!("ignore files exceed {MAX_IGNORE_RULES} rules"),
                    ignore_path,
                ));
            }
        }
        if let Err(error) = builder.add_line(Some(fs.absolute(&ignore_path)), &normalized) {
            diagnostics.push(diagnostic(
                "invalid_ignore",
                &format!("line {}: {error}", index + 1),
                Some(&ignore_path),
            ));
        }
    }
    let matcher = Arc::new(builder.build().map_err(|error| {
        SearchError::at("invalid_ignore", error.to_string(), ignore_path.clone())
    })?);
    state.cache.insert(
        directory.to_string(),
        IgnoreCacheEntry {
            matcher: Arc::clone(&matcher),
            diagnostics: diagnostics.clone(),
        },
    );
    Ok((
        Some(IgnoreLayer {
            base: directory.to_string(),
            matcher,
        }),
        diagnostics,
    ))
}

fn ignored(root: &Path, path: &str, is_dir: bool, layers: &[IgnoreLayer]) -> bool {
    if is_dir
        && path
            .rsplit('/')
            .next()
            .is_some_and(|part| matches!(part, ".git" | "target" | "node_modules"))
    {
        return true;
    }
    let absolute = root.join(path);
    for layer in layers.iter().rev() {
        if !layer.base.is_empty()
            && path != layer.base
            && !path.starts_with(&format!("{}/", layer.base))
        {
            continue;
        }
        match layer.matcher.matched(&absolute, is_dir) {
            Match::Ignore(_) => return true,
            Match::Whitelist(_) => return false,
            Match::None => {}
        }
    }
    false
}

fn has_ignored_ancestor(root: &Path, path: &str, layers: &[IgnoreLayer]) -> bool {
    let mut prefix = String::new();
    for component in path.split('/') {
        prefix = join_path(&prefix, component);
        if ignored(root, &prefix, true, layers) {
            return true;
        }
    }
    false
}

async fn search_file(
    fs: &mut WorkspaceFs,
    path: &str,
    size: usize,
    plan: &GrepPlan,
    match_budget: usize,
    materialized_bytes: &mut usize,
    cancellation: &Arc<AtomicBool>,
) -> (Vec<Record>, usize) {
    if size > MAX_FILE_BYTES {
        return (
            vec![diagnostic(
                "oversized_file",
                &format!("file exceeds {MAX_FILE_BYTES} bytes"),
                Some(path),
            )],
            0,
        );
    }
    let raw = match fs.read_file(path, MAX_FILE_BYTES).await {
        Ok(raw) => raw,
        Err(error) => {
            return (
                vec![diagnostic(
                    error.code,
                    &error.message,
                    error.path.as_deref(),
                )],
                0,
            )
        }
    };
    if raw.len() > MAX_FILE_BYTES {
        return (
            vec![diagnostic(
                "oversized_file",
                &format!("file exceeds {MAX_FILE_BYTES} bytes"),
                Some(path),
            )],
            raw.len(),
        );
    }
    let path = path.to_string();
    let path_for_error = path.clone();
    let plan = plan.clone();
    let cancellation = Arc::clone(cancellation);
    let initial_materialized_bytes = *materialized_bytes;
    match tokio::task::spawn_blocking(move || {
        #[cfg(test)]
        let _active_search = ActiveSearchTask::begin();
        #[cfg(test)]
        while PAUSE_SEARCH_TASKS.load(Ordering::Acquire) && !cancellation.load(Ordering::Acquire) {
            std::thread::yield_now();
        }
        let mut materialized_bytes = initial_materialized_bytes;
        let result = search_bytes(
            raw,
            &path,
            &plan,
            match_budget,
            &mut materialized_bytes,
            &cancellation,
        );
        (result, materialized_bytes)
    })
    .await
    {
        Ok((result, final_materialized_bytes)) => {
            *materialized_bytes = final_materialized_bytes;
            result
        }
        Err(error) => (
            vec![diagnostic(
                "internal_error",
                &format!("content search task failed: {error}"),
                Some(&path_for_error),
            )],
            0,
        ),
    }
}

fn search_bytes(
    raw: Vec<u8>,
    path: &str,
    plan: &GrepPlan,
    match_budget: usize,
    materialized_bytes: &mut usize,
    cancellation: &AtomicBool,
) -> (Vec<Record>, usize) {
    if raw.iter().take(8192).any(|byte| *byte == 0) {
        return (
            vec![diagnostic("binary_file", "binary file skipped", Some(path))],
            raw.len(),
        );
    }
    let text = String::from_utf8_lossy(&raw);
    let bytes = text.as_bytes();
    let mut line_count = usize::from(bytes.is_empty() || !bytes.ends_with(b"\n"));
    for chunk in bytes.chunks(64 * 1024) {
        if cancellation.load(Ordering::Acquire) {
            return (
                vec![diagnostic("cancelled", "search was cancelled", Some(path))],
                raw.len(),
            );
        }
        line_count += chunk.iter().filter(|byte| **byte == b'\n').count();
        if line_count > MAX_LINES_PER_FILE {
            return (
                vec![diagnostic(
                    "line_limit",
                    &format!("file exceeds {MAX_LINES_PER_FILE} lines"),
                    Some(path),
                )],
                raw.len(),
            );
        }
    }
    let line_ranges = line_ranges(bytes);
    let line_starts: Vec<usize> = line_ranges.iter().map(|range| range.0).collect();
    let effective_limit = MAX_MATCHES.min(match_budget.max(1));
    let record_limited = match_budget <= MAX_MATCHES;
    let probe_limit = effective_limit.saturating_add(1);
    let mut matches = Vec::<(usize, usize, usize, bool)>::new();

    if plan.multiline {
        let result = plan.matcher.find_iter(bytes, |matched| {
            let line_index = line_index_at(&line_starts, matched.start());
            matches.push((matched.start(), matched.end(), line_index, true));
            !cancellation.load(Ordering::Acquire) && matches.len() < probe_limit
        });
        if result.is_err() {
            return (
                vec![diagnostic(
                    "invalid_regex",
                    "regex search failed",
                    Some(path),
                )],
                raw.len(),
            );
        }
    } else {
        'lines: for (line_index, (start, content_end, _end)) in
            line_ranges.iter().copied().enumerate()
        {
            if cancellation.load(Ordering::Acquire) {
                return (
                    vec![diagnostic("cancelled", "search was cancelled", Some(path))],
                    raw.len(),
                );
            }
            let line = &bytes[start..content_end];
            let result = plan.matcher.find_iter(line, |matched| {
                matches.push((
                    start + matched.start(),
                    start + matched.end(),
                    line_index,
                    false,
                ));
                matches.len() < probe_limit
            });
            if result.is_err() {
                return (
                    vec![diagnostic(
                        "invalid_regex",
                        "regex search failed",
                        Some(path),
                    )],
                    raw.len(),
                );
            }
            if matches.len() >= probe_limit {
                break 'lines;
            }
        }
    }

    let hit_limit = matches.len() > effective_limit;
    matches.truncate(effective_limit);
    let mut found = Vec::new();
    for (start, end, line_index, is_multiline) in matches {
        if cancellation.load(Ordering::Acquire) {
            return (
                vec![diagnostic("cancelled", "search was cancelled", Some(path))],
                raw.len(),
            );
        }
        let shown = if is_multiline {
            &bytes[start..end]
        } else {
            let (line_start, content_end, _) = line_ranges[line_index];
            &bytes[line_start..content_end]
        };
        let (shown, shown_truncated) = bounded_bytes(shown, MAX_FIELD_BYTES);
        let mut item = Map::new();
        item.insert("path".into(), Value::String(path.to_string()));
        item.insert("line".into(), json!(line_index + 1));
        item.insert("column".into(), json!(start - line_starts[line_index] + 1));
        item.insert("text".into(), Value::String(shown));
        item.insert("_start".into(), json!(start));
        item.insert("_end".into(), json!(end));
        if shown_truncated {
            item.insert("text_truncated".into(), Value::Bool(true));
        }
        if plan.context > 0 {
            let before_start = line_index.saturating_sub(plan.context);
            let before = line_ranges[before_start..line_index]
                .iter()
                .map(|(start, content_end, _)| {
                    bounded_bytes(&bytes[*start..*content_end], MAX_CONTEXT_LINE_BYTES)
                })
                .collect::<Vec<_>>();
            let end_line = line_index_at(&line_starts, end.saturating_sub(1).max(start)) + 1;
            let after_end = (end_line + plan.context).min(line_ranges.len());
            let after = line_ranges[end_line..after_end]
                .iter()
                .map(|(start, content_end, _)| {
                    bounded_bytes(&bytes[*start..*content_end], MAX_CONTEXT_LINE_BYTES)
                })
                .collect::<Vec<_>>();
            let context_truncated = before.iter().chain(&after).any(|(_, truncated)| *truncated);
            item.insert(
                "before".into(),
                Value::Array(
                    before
                        .into_iter()
                        .map(|(line, _)| Value::String(line))
                        .collect(),
                ),
            );
            item.insert(
                "after".into(),
                Value::Array(
                    after
                        .into_iter()
                        .map(|(line, _)| Value::String(line))
                        .collect(),
                ),
            );
            if context_truncated {
                item.insert("context_truncated".into(), Value::Bool(true));
            }
        }
        let value = Value::Object(item);
        let encoded = serde_json::to_vec(&value).map_or(usize::MAX, |bytes| bytes.len());
        if encoded > MAX_MATERIALIZED_BYTES.saturating_sub(*materialized_bytes) {
            found.push(diagnostic(
                "materialized_limit",
                &format!("search exceeded {MAX_MATERIALIZED_BYTES} materialized bytes"),
                Some(path),
            ));
            return (found, raw.len());
        }
        *materialized_bytes += encoded;
        found.push(Record::Match(value));
    }
    if hit_limit {
        let (code, message) = if record_limited {
            (
                "record_limit",
                format!("search exceeded {MAX_RECORDS} structured records"),
            )
        } else {
            (
                "match_limit",
                format!("search exceeded {effective_limit} matches in this bounded unit"),
            )
        };
        found.push(diagnostic(code, &message, Some(path)));
    }
    (found, raw.len())
}

fn compile_grep(object: &Map<String, Value>) -> SearchResult<GrepPlan> {
    let pattern = required_string(
        object,
        "pattern",
        "invalid_regex",
        "pattern must be a non-empty string",
    )?;
    if pattern.is_empty() {
        return Err(SearchError::new(
            "invalid_regex",
            "pattern must be a non-empty string",
        ));
    }
    if pattern.len() > MAX_PATTERN_BYTES {
        return Err(SearchError::new("invalid_regex", "pattern is too large"));
    }
    let regex = optional_bool(object, "regex", true)?;
    let multiline = optional_bool(object, "multiline", false)?;
    let case = object
        .get("case")
        .and_then(Value::as_str)
        .unwrap_or("smart");
    if !matches!(case, "smart" | "sensitive" | "insensitive") {
        return Err(SearchError::new(
            "invalid_arguments",
            "case must be smart, sensitive, or insensitive",
        ));
    }
    if object.get("case").is_some_and(|value| !value.is_string()) {
        return Err(SearchError::new(
            "invalid_arguments",
            "case must be smart, sensitive, or insensitive",
        ));
    }
    let context = optional_usize(object, "context", 0, 0, 100)?;
    let mut builder = RegexMatcherBuilder::new();
    builder
        .fixed_strings(!regex)
        .multi_line(true)
        .dot_matches_new_line(multiline)
        .size_limit(MAX_REGEX_AUTOMATON_BYTES)
        .dfa_size_limit(MAX_REGEX_AUTOMATON_BYTES)
        .nest_limit(MAX_REGEX_NESTING);
    match case {
        "smart" => {
            builder.case_smart(true);
        }
        "insensitive" => {
            builder.case_insensitive(true);
        }
        "sensitive" => {}
        _ => unreachable!(),
    }
    let matcher = builder
        .build(pattern)
        .map_err(|error| SearchError::new("invalid_regex", error.to_string()))?;
    Ok(GrepPlan {
        matcher,
        multiline,
        context,
    })
}

fn compile_glob(pattern: &str) -> SearchResult<GlobMatcher> {
    if pattern.is_empty() {
        return Err(SearchError::new(
            "invalid_glob",
            "glob pattern must be a non-empty string",
        ));
    }
    if pattern.len() > MAX_PATTERN_BYTES {
        return Err(SearchError::new(
            "invalid_glob",
            "glob pattern is too large",
        ));
    }
    GlobBuilder::new(pattern)
        .literal_separator(true)
        .backslash_escape(true)
        .build()
        .map(|glob| glob.compile_matcher())
        .map_err(|error| SearchError::new("invalid_glob", error.to_string()))
}

fn parse_common(object: &Map<String, Value>) -> SearchResult<CommonArgs> {
    Ok(CommonArgs {
        gitignore: optional_bool(object, "gitignore", true)?,
        hidden: optional_bool(object, "hidden", false)?,
        limit: optional_usize(object, "limit", 200, 1, MAX_LIMIT)?,
    })
}

async fn normalize_path(
    fs: &mut WorkspaceFs,
    value: Option<&Value>,
    label: &'static str,
) -> SearchResult<String> {
    let default_value = Value::String(".".to_string());
    let value = value.unwrap_or(&default_value).as_str().ok_or_else(|| {
        SearchError::new("invalid_arguments", format!("{label} must be a string"))
    })?;
    let requested = Path::new(value);
    let relative = if requested.is_absolute() {
        fs.relative_absolute(requested).ok_or_else(|| {
            SearchError::at(
                "outside_workspace",
                format!("{label} leaves the workspace"),
                value,
            )
        })?
    } else {
        requested.to_path_buf()
    };
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => parts.push(
                part.to_str()
                    .ok_or_else(|| {
                        SearchError::new("invalid_utf8_path", format!("{label} is not valid UTF-8"))
                    })?
                    .to_string(),
            ),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(SearchError::at(
                    "outside_workspace",
                    format!("{label} leaves the workspace"),
                    value,
                ));
            }
        }
    }
    Ok(parts.join("/"))
}

struct PublicRecord {
    value: Value,
    is_error: bool,
    encoded_len: usize,
}

fn paginate(tool: &str, args: &Value, records: Vec<Record>, limit: usize) -> SearchResult<Value> {
    let fingerprint = canonical_request(tool, args)?;
    let total = records.len();
    let offset = decode_cursor(args.get("cursor"), &fingerprint, total)?;
    let mut selected = Vec::new();
    let mut entry_count = 0usize;
    let mut entry_bytes = 0usize;
    let mut error_count = 0usize;
    let mut error_bytes = 0usize;
    let mut index = offset;
    for record in records.into_iter().skip(offset).take(limit) {
        let public = public_record(tool, record)?;
        let candidate_index = index + 1;
        let envelope = page_body(tool, &[], candidate_index, total, &fingerprint)?;
        let envelope_len = serde_json::to_vec(&envelope)
            .map_err(|error| SearchError::new("internal_error", error.to_string()))?
            .len();
        let candidate_entry_count = entry_count + usize::from(!public.is_error);
        let candidate_entry_bytes = entry_bytes
            + if public.is_error {
                0
            } else {
                public.encoded_len
            };
        let candidate_error_count = error_count + usize::from(public.is_error);
        let candidate_error_bytes = error_bytes
            + if public.is_error {
                public.encoded_len
            } else {
                0
            };
        let extra = candidate_entry_bytes
            + candidate_entry_count.saturating_sub(1)
            + candidate_error_bytes
            + candidate_error_count.saturating_sub(1);
        if envelope_len.saturating_add(extra) > MAX_OUTPUT_BYTES {
            break;
        }
        if public.is_error {
            error_count += 1;
            error_bytes += public.encoded_len;
        } else {
            entry_count += 1;
            entry_bytes += public.encoded_len;
        }
        selected.push(public);
        index = candidate_index;
    }
    if index == offset && index < total {
        return Err(SearchError::new(
            "output_limit",
            "the next bounded record cannot fit in the output limit",
        ));
    }
    page_body(tool, &selected, index, total, &fingerprint)
}

fn public_record(tool: &str, record: Record) -> SearchResult<PublicRecord> {
    let is_error = record.is_error();
    let mut record = record.into_value();
    if let Some(object) = record.as_object_mut() {
        object.remove("_start");
        object.remove("_end");
        if tool == "glob" {
            object.remove("size");
        }
    }
    let encoded_len = serde_json::to_vec(&record)
        .map_err(|error| SearchError::new("internal_error", error.to_string()))?
        .len();
    Ok(PublicRecord {
        value: record,
        is_error,
        encoded_len,
    })
}

fn page_body(
    tool: &str,
    selected: &[PublicRecord],
    index: usize,
    total: usize,
    fingerprint: &str,
) -> SearchResult<Value> {
    let truncated = index < total;
    let mut entries = Vec::new();
    let mut errors = Vec::new();
    for record in selected {
        if record.is_error {
            errors.push(record.value.clone());
        } else {
            entries.push(record.value.clone());
        }
    }
    Ok(json!({
        if tool == "glob" { "entries" } else { "matches" }: entries,
        "truncated": truncated,
        "next_cursor": if truncated { Some(encode_cursor(fingerprint, index)?) } else { None },
        "errors": errors,
    }))
}

fn canonical_request(tool: &str, args: &Value) -> SearchResult<String> {
    let mut args = args.clone();
    if let Some(object) = args.as_object_mut() {
        object.remove("cursor");
    }
    let raw = serde_json::to_vec(&json!({ "tool": tool, "args": args }))
        .map_err(|error| SearchError::new("internal_error", error.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(raw)))
}

fn encode_cursor(fingerprint: &str, offset: usize) -> SearchResult<String> {
    let raw = serde_json::to_vec(&json!({
        "v": CURSOR_VERSION,
        "q": fingerprint,
        "o": offset,
    }))
    .map_err(|error| SearchError::new("internal_error", error.to_string()))?;
    Ok(URL_SAFE_NO_PAD.encode(raw))
}

fn decode_cursor(value: Option<&Value>, fingerprint: &str, total: usize) -> SearchResult<usize> {
    let Some(value) = value else {
        return Ok(0);
    };
    if value.is_null()
        || value.as_str().is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "" | "none" | "null"
            )
        })
    {
        return Ok(0);
    }
    let value = value
        .as_str()
        .ok_or_else(|| SearchError::new("invalid_cursor", "cursor must be a string"))?;
    if value.len() > MAX_CURSOR_BYTES {
        return Err(SearchError::new("invalid_cursor", "cursor is too large"));
    }
    let raw = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| SearchError::new("invalid_cursor", "cursor is malformed"))?;
    let payload: Value = serde_json::from_slice(&raw)
        .map_err(|_| SearchError::new("invalid_cursor", "cursor is malformed"))?;
    if payload.get("v").and_then(Value::as_u64) != Some(CURSOR_VERSION) {
        return Err(SearchError::new(
            "invalid_cursor",
            "cursor version is unsupported",
        ));
    }
    if payload.get("q").and_then(Value::as_str) != Some(fingerprint) {
        return Err(SearchError::new(
            "invalid_cursor",
            "cursor does not match this request",
        ));
    }
    let offset = payload
        .get("o")
        .and_then(Value::as_u64)
        .and_then(|offset| usize::try_from(offset).ok())
        .filter(|offset| *offset <= total)
        .ok_or_else(|| SearchError::new("invalid_cursor", "cursor offset is out of range"))?;
    Ok(offset)
}

fn validate_collection(values: &[Value], name: &str, maximum: usize) -> SearchResult<()> {
    if values.len() > maximum {
        return Err(SearchError::new(
            "invalid_arguments",
            format!("{name} may contain at most {maximum} values"),
        ));
    }
    let bytes = values
        .iter()
        .filter_map(Value::as_str)
        .map(str::len)
        .sum::<usize>();
    if bytes > MAX_COLLECTION_BYTES {
        return Err(SearchError::new(
            "invalid_arguments",
            format!("{name} exceeds the aggregate byte limit"),
        ));
    }
    Ok(())
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    code: &'static str,
    message: &'static str,
) -> SearchResult<&'a str> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| SearchError::new(code, message))
}

fn optional_bool(object: &Map<String, Value>, key: &str, default: bool) -> SearchResult<bool> {
    match object.get(key) {
        None => Ok(default),
        Some(value) => value.as_bool().ok_or_else(|| {
            SearchError::new("invalid_arguments", format!("{key} must be a boolean"))
        }),
    }
}

fn optional_usize(
    object: &Map<String, Value>,
    key: &str,
    default: usize,
    minimum: usize,
    maximum: usize,
) -> SearchResult<usize> {
    let Some(value) = object.get(key) else {
        return Ok(default);
    };
    let value = value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value >= minimum && *value <= maximum)
        .ok_or_else(|| {
            SearchError::new(
                "invalid_arguments",
                format!("{key} must be between {minimum} and {maximum}"),
            )
        })?;
    Ok(value)
}

fn diagnostic(code: &str, message: &str, path: Option<&str>) -> Record {
    let (message, message_truncated) = bounded_bytes(message.as_bytes(), MAX_FIELD_BYTES);
    let mut item = Map::new();
    item.insert("code".into(), Value::String(code.to_string()));
    item.insert("message".into(), Value::String(message));
    let mut truncated = message_truncated;
    if let Some(path) = path {
        let (path, path_truncated) = bounded_bytes(path.as_bytes(), MAX_FIELD_BYTES);
        item.insert("path".into(), Value::String(path));
        truncated |= path_truncated;
    }
    if truncated {
        item.insert("message_truncated".into(), Value::Bool(true));
    }
    Record::Error(Value::Object(item))
}

fn error_result(code: &str, message: &str, path: Option<&str>) -> ToolResult {
    ToolResult {
        content: (json!({
            "error": {
                "code": code,
                "message": message,
                "path": path,
            }
        })
        .to_string())
        .into(),
        is_error: true,
    }
}

fn bounded_bytes(bytes: &[u8], maximum: usize) -> (String, bool) {
    let text = String::from_utf8_lossy(bytes);
    if text.len() <= maximum {
        return (text.into_owned(), false);
    }
    let mut end = maximum;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (format!("{}…", &text[..end]), true)
}

fn line_ranges(bytes: &[u8]) -> Vec<(usize, usize, usize)> {
    if bytes.is_empty() {
        return vec![(0, 0, 0)];
    }
    let mut ranges = Vec::new();
    let mut start = 0;
    for (index, byte) in bytes.iter().copied().enumerate() {
        if byte == b'\n' {
            let content_end = if index > start && bytes[index - 1] == b'\r' {
                index - 1
            } else {
                index
            };
            ranges.push((start, content_end, index + 1));
            start = index + 1;
        }
    }
    if start < bytes.len() {
        let content_end = if bytes.last() == Some(&b'\r') {
            bytes.len() - 1
        } else {
            bytes.len()
        };
        ranges.push((start, content_end, bytes.len()));
    }
    ranges
}

fn line_index_at(starts: &[usize], position: usize) -> usize {
    starts
        .partition_point(|start| *start <= position)
        .saturating_sub(1)
}

fn sort_records(records: &mut [Record]) {
    records.sort_by(|left, right| {
        let left_key = (
            record_path(left).as_bytes(),
            left.get("_start").and_then(Value::as_i64).unwrap_or(-1),
            left.get("_end").and_then(Value::as_i64).unwrap_or(-1),
            left.sort_tag(),
            left.get("kind").and_then(Value::as_str).unwrap_or_default(),
            left.get("code").and_then(Value::as_str).unwrap_or_default(),
        );
        let right_key = (
            record_path(right).as_bytes(),
            right.get("_start").and_then(Value::as_i64).unwrap_or(-1),
            right.get("_end").and_then(Value::as_i64).unwrap_or(-1),
            right.sort_tag(),
            right
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            right
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        left_key.cmp(&right_key)
    });
}

fn cap_records(records: &mut Vec<Record>, path: &str) {
    if records.len() <= MAX_RECORDS {
        return;
    }
    records.truncate(MAX_RECORDS - 1);
    records.push(diagnostic(
        "record_limit",
        &format!("search exceeded {MAX_RECORDS} structured records"),
        Some(path),
    ));
}

fn record_path(record: &Record) -> &str {
    record
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn join_path(base: &str, name: &str) -> String {
    if base.is_empty() {
        name.to_string()
    } else {
        format!("{base}/{name}")
    }
}

fn relative_path_string(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => parts.push(part.to_str()?),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(parts.join("/"))
}

fn display_path(path: &str) -> String {
    if path.is_empty() {
        ".".to_string()
    } else {
        path.to_string()
    }
}

fn is_hidden(path: &str) -> bool {
    path.split('/')
        .any(|part| part.starts_with('.') && part != "." && part != "..")
}

fn ancestors_before(path: &str) -> Vec<String> {
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() {
        return Vec::new();
    }
    let mut ancestors = vec![String::new()];
    let mut current = String::new();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        current = join_path(&current, part);
        ancestors.push(current.clone());
    }
    ancestors
}

fn normalize_ignore_pattern(line: &str) -> String {
    let mut line = line.trim_end_matches('\r').to_string();
    while line.ends_with(' ') {
        let slash_count = line[..line.len() - 1]
            .bytes()
            .rev()
            .take_while(|byte| *byte == b'\\')
            .count();
        if slash_count % 2 == 1 {
            break;
        }
        line.pop();
    }
    line
}
