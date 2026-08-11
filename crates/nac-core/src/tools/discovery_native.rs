use std::collections::{HashMap, HashSet};
use std::io::Read as _;
use std::path::{Component, Path, PathBuf};
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
const MAX_RECORDS: usize = 20_000;
const MAX_PATTERN_BYTES: usize = 64 * 1024;
const MAX_COLLECTION_BYTES: usize = 64 * 1024;
const MAX_ROOTS: usize = 32;
const MAX_GLOBS: usize = 128;
const MAX_LIMIT: usize = 1000;
const MAX_CURSOR_BYTES: usize = 4096;
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);
const CURSOR_VERSION: u64 = 1;

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

#[derive(Debug)]
struct FsEntry {
    name: String,
    kind: EntryKind,
    size: u64,
}

struct LocalFs {
    root: PathBuf,
    directory: Arc<Dir>,
}

struct RemoteFs {
    root: PathBuf,
    sftp: Option<Sftp>,
    child: Child,
}

enum WorkspaceFs {
    Local(LocalFs),
    Remote(RemoteFs),
}

impl WorkspaceFs {
    async fn open(runtime: &ToolRuntime) -> SearchResult<Self> {
        if runtime.backend.workspace_cwd_is_local() {
            let root = tokio::fs::canonicalize(&runtime.workspace_cwd)
                .await
                .map_err(|error| {
                    SearchError::at(
                        "unreadable_path",
                        error.to_string(),
                        runtime.workspace_cwd.display().to_string(),
                    )
                })?;
            let directory = Dir::open_ambient_dir(&root, ambient_authority()).map_err(|error| {
                SearchError::at(
                    "unreadable_path",
                    error.to_string(),
                    runtime.workspace_cwd.display().to_string(),
                )
            })?;
            return Ok(Self::Local(LocalFs {
                root,
                directory: Arc::new(directory),
            }));
        }

        let ExecutionBackend::Ssh(ssh) = runtime.backend.as_ref() else {
            return Err(SearchError::new(
                "backend_protocol",
                "remote discovery requires an SSH filesystem transport",
            ));
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
        let requested = runtime
            .backend
            .resolve_path("")
            .map_err(|error| SearchError::new("outside_workspace", error.to_string()))?;
        let mut fs = sftp.fs();
        let root = fs.canonicalize(&requested).await.map_err(|error| {
            SearchError::at(
                "unreadable_path",
                error.to_string(),
                requested.display().to_string(),
            )
        })?;
        Ok(Self::Remote(RemoteFs {
            root,
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

    fn absolute(&self, relative: &str) -> PathBuf {
        if relative.is_empty() {
            self.root().to_path_buf()
        } else {
            self.root().join(relative)
        }
    }

    async fn list_dir(&mut self, relative: &str) -> SearchResult<Vec<FsEntry>> {
        let absolute = self.absolute(relative);
        let display = display_path(relative);
        let mut entries = Vec::new();
        match self {
            Self::Local(local) => {
                let root = Arc::clone(&local.directory);
                let relative = relative.to_string();
                let directory = if relative.is_empty() {
                    PathBuf::from(".")
                } else {
                    PathBuf::from(&relative)
                };
                entries = tokio::task::spawn_blocking(move || {
                    let mut entries = Vec::new();
                    let directory_entries = root.read_dir(&directory).map_err(|error| {
                        SearchError::at(
                            "unreadable_path",
                            error.to_string(),
                            display_path(&relative),
                        )
                    })?;
                    for entry in directory_entries {
                        let entry = entry.map_err(|error| {
                            SearchError::at(
                                "unreadable_path",
                                error.to_string(),
                                display_path(&relative),
                            )
                        })?;
                        let name = entry.file_name().into_string().map_err(|_| {
                            SearchError::at(
                                "invalid_utf8_path",
                                "path is not valid UTF-8",
                                display_path(&relative),
                            )
                        })?;
                        let child = directory.join(&name);
                        let metadata = root.symlink_metadata(&child).map_err(|error| {
                            SearchError::at(
                                "unreadable_path",
                                error.to_string(),
                                join_path(&relative, &name),
                            )
                        })?;
                        let file_type = metadata.file_type();
                        let kind = if file_type.is_symlink() {
                            EntryKind::Symlink
                        } else if file_type.is_dir() {
                            EntryKind::Directory
                        } else if file_type.is_file() {
                            EntryKind::File
                        } else {
                            EntryKind::Other
                        };
                        entries.push(FsEntry {
                            name,
                            kind,
                            size: metadata.len(),
                        });
                    }
                    Ok(entries)
                })
                .await
                .map_err(|error| {
                    SearchError::new(
                        "internal_error",
                        format!("local directory task failed: {error}"),
                    )
                })??;
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
                while let Some(entry) = stream.next().await {
                    let entry = entry.map_err(|error| {
                        SearchError::at("unreadable_path", error.to_string(), display.clone())
                    })?;
                    let name = entry
                        .filename()
                        .to_str()
                        .ok_or_else(|| {
                            SearchError::at(
                                "invalid_utf8_path",
                                "path is not valid UTF-8",
                                display.clone(),
                            )
                        })?
                        .to_string();
                    if name == "." || name == ".." {
                        continue;
                    }
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
            }
        }
        entries.sort_by(|left, right| left.name.as_bytes().cmp(right.name.as_bytes()));
        Ok(entries)
    }

    async fn read_file(&mut self, relative: &str, maximum: usize) -> SearchResult<Vec<u8>> {
        if let Self::Local(local) = self {
            let root = Arc::clone(&local.directory);
            let relative = relative.to_string();
            return tokio::task::spawn_blocking(move || {
                let mut options = cap_std::fs::OpenOptions::new();
                options.read(true);
                #[cfg(unix)]
                {
                    use cap_std::fs::OpenOptionsExt;
                    options.custom_flags(libc::O_NOFOLLOW);
                }
                let file = root.open_with(&relative, &options).map_err(|error| {
                    SearchError::at("unreadable_path", error.to_string(), relative.clone())
                })?;
                let mut bytes = Vec::new();
                file.take((maximum + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|error| {
                        SearchError::at("unreadable_path", error.to_string(), relative)
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
        let canonical = match self {
            Self::Local(local) => {
                let root = Arc::clone(&local.directory);
                let relative = absolute.strip_prefix(&local.root).map_err(|_| {
                    SearchError::at("outside_workspace", "path leaves the workspace", display)
                })?;
                let relative = relative.to_path_buf();
                let canonical = tokio::task::spawn_blocking(move || root.canonicalize(relative))
                    .await
                    .map_err(|error| {
                        SearchError::new(
                            "internal_error",
                            format!("local canonicalization task failed: {error}"),
                        )
                    })?
                    .map_err(|error| {
                        SearchError::at("symlink_escape", error.to_string(), display)
                    })?;
                local.root.join(canonical)
            }
            Self::Remote(remote) => {
                let sftp = remote.sftp.as_ref().ok_or_else(|| {
                    SearchError::new("backend_protocol", "SSH SFTP session is closed")
                })?;
                let mut fs = sftp.fs();
                fs.canonicalize(absolute).await.map_err(|error| {
                    SearchError::at("unreadable_path", error.to_string(), display)
                })?
            }
        };
        if canonical != self.root() && !canonical.starts_with(self.root()) {
            return Err(SearchError::at(
                "symlink_escape",
                "symlink target leaves the workspace",
                display,
            ));
        }
        Ok(canonical)
    }

    async fn symlink_diagnostic(&mut self, relative: &str) -> Value {
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
    async fn path_kind(&mut self, relative: &str) -> SearchResult<EntryKind> {
        let absolute = self.absolute(relative);
        match self {
            Self::Local(local) => {
                let root = Arc::clone(&local.directory);
                let relative = relative.to_string();
                let metadata = tokio::task::spawn_blocking(move || {
                    root.symlink_metadata(&relative).map_err(|error| {
                        SearchError::at(
                            "unreadable_path",
                            error.to_string(),
                            display_path(&relative),
                        )
                    })
                })
                .await
                .map_err(|error| {
                    SearchError::new(
                        "internal_error",
                        format!("local metadata task failed: {error}"),
                    )
                })??;
                let file_type = metadata.file_type();
                Ok(if file_type.is_symlink() {
                    EntryKind::Symlink
                } else if file_type.is_dir() {
                    EntryKind::Directory
                } else if file_type.is_file() {
                    EntryKind::File
                } else {
                    EntryKind::Other
                })
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

#[derive(Clone)]
struct IgnoreLayer {
    base: String,
    matcher: Arc<Gitignore>,
}

struct IgnoreCacheEntry {
    matcher: Arc<Gitignore>,
    diagnostics: Vec<Value>,
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
            content: value.to_string(),
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
    let mut fs = WorkspaceFs::open(runtime).await?;
    let result = match tool {
        "glob" => run_glob(&mut fs, &args).await,
        "grep" => run_grep(&mut fs, &args).await,
        _ => Err(SearchError::new(
            "invalid_arguments",
            "unknown discovery tool",
        )),
    };
    fs.close().await;
    result
}

async fn run_glob(fs: &mut WorkspaceFs, args: &Value) -> SearchResult<Value> {
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
    )
    .await?;
    let prefix = if root.is_empty() {
        String::new()
    } else {
        format!("{root}/")
    };
    let mut selected = Vec::new();
    for record in records {
        if is_error(&record) {
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

async fn run_grep(fs: &mut WorkspaceFs, args: &Value) -> SearchResult<Value> {
    let object = args.as_object().expect("validated object");
    let (matcher, multiline, context) = compile_grep(object)?;
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
    let mut minimal_roots = Vec::<String>::new();
    for root in roots {
        if minimal_roots.iter().any(|parent| {
            root == *parent || parent.is_empty() || root.starts_with(&format!("{parent}/"))
        }) {
            continue;
        }
        minimal_roots.push(root);
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
    for root in minimal_roots {
        let records = walk_root(
            fs,
            &root,
            common.hidden,
            common.gitignore,
            &mut walk_budget,
            &mut ignore_state,
        )
        .await?;
        for record in records {
            let identity = (
                record_path(&record).to_string(),
                record
                    .get("record_type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
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

    let mut records: Vec<Value> = inventory
        .iter()
        .filter(|record| is_error(record))
        .cloned()
        .collect();
    let mut total_bytes = 0usize;
    let mut materialized_bytes = 0usize;
    for item in &inventory {
        if is_error(item) || item.get("kind").and_then(Value::as_str) != Some("file") {
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
            &matcher,
            multiline,
            context,
            remaining.saturating_sub(1).max(1),
            &mut materialized_bytes,
        )
        .await;
        total_bytes += read_bytes;
        let stop = found.iter().any(|entry| {
            matches!(
                entry.get("code").and_then(Value::as_str),
                Some("match_limit" | "materialized_limit")
            )
        });
        found.truncate(remaining);
        records.extend(found);
        if stop {
            break;
        }
    }
    sort_records(&mut records);
    paginate("grep", args, records, common.limit)
}

async fn walk_root(
    fs: &mut WorkspaceFs,
    root: &str,
    hidden: bool,
    gitignore: bool,
    walk_budget: &mut WalkBudget,
    ignore_state: &mut IgnoreState,
) -> SearchResult<Vec<Value>> {
    let mut inherited = Vec::new();
    let mut records = Vec::new();
    if !root.is_empty() {
        let mut prefix = String::new();
        for component in root.split('/') {
            prefix = join_path(&prefix, component);
            match fs.path_kind(&prefix).await? {
                EntryKind::Directory => {}
                EntryKind::Symlink => {
                    records.push(fs.symlink_diagnostic(&prefix).await);
                    return Ok(records);
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
        let entries = match fs.list_dir(&directory).await {
            Ok(entries) => entries,
            Err(error) => {
                records.push(diagnostic(
                    error.code,
                    &error.message,
                    error.path.as_deref(),
                ));
                continue;
            }
        };
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
            if entry.kind == EntryKind::Symlink {
                records.push(fs.symlink_diagnostic(&path).await);
                continue;
            }
            let is_dir = entry.kind == EntryKind::Directory;
            if gitignore && ignored(fs.root(), &path, is_dir, &rules) {
                continue;
            }
            match entry.kind {
                EntryKind::Directory => {
                    records.push(json!({
                        "record_type": "entry",
                        "path": path,
                        "kind": "directory",
                    }));
                    child_dirs.push((path, rules.clone()));
                }
                EntryKind::File => records.push(json!({
                    "record_type": "entry",
                    "path": path,
                    "kind": "file",
                    "size": entry.size,
                })),
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
) -> SearchResult<(Option<IgnoreLayer>, Vec<Value>)> {
    if let Some(cached) = state.cache.get(directory) {
        return Ok((
            Some(IgnoreLayer {
                base: directory.to_string(),
                matcher: Arc::clone(&cached.matcher),
            }),
            cached.diagnostics.clone(),
        ));
    }
    let entries = fs.list_dir(directory).await?;
    load_ignore_from_entries(fs, directory, &entries, state).await
}

async fn load_ignore_from_entries(
    fs: &mut WorkspaceFs,
    directory: &str,
    entries: &[FsEntry],
    state: &mut IgnoreState,
) -> SearchResult<(Option<IgnoreLayer>, Vec<Value>)> {
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
        if ignore_line_counts(line) {
            state.rules += 1;
            if state.rules > MAX_IGNORE_RULES {
                return Err(SearchError::at(
                    "ignore_limit",
                    format!("ignore files exceed {MAX_IGNORE_RULES} rules"),
                    ignore_path,
                ));
            }
        }
        let normalized = normalize_ignore_pattern(line);
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
    if path
        .split('/')
        .any(|part| matches!(part, ".git" | "target" | "node_modules"))
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
    matcher: &RegexMatcher,
    multiline: bool,
    context: usize,
    match_budget: usize,
    materialized_bytes: &mut usize,
) -> (Vec<Value>, usize) {
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
    if raw.iter().take(8192).any(|byte| *byte == 0) {
        return (
            vec![diagnostic("binary_file", "binary file skipped", Some(path))],
            raw.len(),
        );
    }
    let text = String::from_utf8_lossy(&raw);
    let bytes = text.as_bytes();
    let line_ranges = line_ranges(bytes);
    let line_starts: Vec<usize> = line_ranges.iter().map(|range| range.0).collect();
    let effective_limit = MAX_MATCHES.min(match_budget.max(1));
    let mut matches = Vec::<(usize, usize, usize, bool)>::new();

    if multiline {
        let result = matcher.find_iter(bytes, |matched| {
            let line_index = line_index_at(&line_starts, matched.start());
            matches.push((matched.start(), matched.end(), line_index, true));
            matches.len() < effective_limit
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
            let line = &bytes[start..content_end];
            let result = matcher.find_iter(line, |matched| {
                matches.push((
                    start + matched.start(),
                    start + matched.end(),
                    line_index,
                    false,
                ));
                matches.len() < effective_limit
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
            if matches.len() >= effective_limit {
                break 'lines;
            }
        }
    }

    let hit_limit = matches.len() >= effective_limit;
    let mut found = Vec::new();
    for (start, end, line_index, is_multiline) in matches {
        let shown = if is_multiline {
            &bytes[start..end]
        } else {
            let (line_start, content_end, _) = line_ranges[line_index];
            &bytes[line_start..content_end]
        };
        let (shown, shown_truncated) = bounded_bytes(shown, MAX_FIELD_BYTES);
        let mut item = Map::new();
        item.insert("record_type".into(), Value::String("entry".into()));
        item.insert("path".into(), Value::String(path.to_string()));
        item.insert("line".into(), json!(line_index + 1));
        item.insert("column".into(), json!(start - line_starts[line_index] + 1));
        item.insert("text".into(), Value::String(shown));
        item.insert("_start".into(), json!(start));
        item.insert("_end".into(), json!(end));
        if shown_truncated {
            item.insert("text_truncated".into(), Value::Bool(true));
        }
        if context > 0 {
            let before_start = line_index.saturating_sub(context);
            let before = line_ranges[before_start..line_index]
                .iter()
                .map(|(start, content_end, _)| {
                    bounded_bytes(&bytes[*start..*content_end], MAX_CONTEXT_LINE_BYTES)
                })
                .collect::<Vec<_>>();
            let end_line = line_index_at(&line_starts, end.saturating_sub(1).max(start)) + 1;
            let after_end = (end_line + context).min(line_ranges.len());
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
        found.push(value);
    }
    if hit_limit {
        found.push(diagnostic(
            "match_limit",
            &format!("search exceeded {effective_limit} matches in this bounded unit"),
            Some(path),
        ));
    }
    (found, raw.len())
}

fn compile_grep(object: &Map<String, Value>) -> SearchResult<(RegexMatcher, bool, usize)> {
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
    if regex {
        validate_regex_subset(pattern)?;
    }
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
        .size_limit(16 * 1024 * 1024)
        .dfa_size_limit(16 * 1024 * 1024);
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
    Ok((matcher, multiline, context))
}

fn compile_glob(pattern: &str) -> SearchResult<GlobMatcher> {
    if pattern.len() > MAX_PATTERN_BYTES {
        return Err(SearchError::new(
            "invalid_glob",
            "glob pattern is too large",
        ));
    }
    let pattern = normalize_caret_class(pattern);
    GlobBuilder::new(&pattern)
        .literal_separator(true)
        .backslash_escape(true)
        .build()
        .map(|glob| glob.compile_matcher())
        .map_err(|error| SearchError::new("invalid_glob", error.to_string()))
}
fn validate_regex_subset(pattern: &str) -> SearchResult<()> {
    let bytes = pattern.as_bytes();
    let mut index = 0;
    let mut escaped = false;
    let mut in_class = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if escaped {
            escaped = false;
            index += 1;
            continue;
        }
        match byte {
            b'\\' => {
                escaped = true;
                index += 1;
                continue;
            }
            b'[' => in_class = true,
            b']' if in_class => in_class = false,
            _ => {}
        }
        if in_class {
            index += 1;
            continue;
        }
        if bytes[index..].starts_with(b"(?>") {
            return Err(SearchError::new(
                "invalid_regex",
                "atomic groups are outside the portable regex subset",
            ));
        }
        if matches!(byte, b'*' | b'+' | b'?') && bytes.get(index + 1) == Some(&b'+') {
            return Err(SearchError::new(
                "invalid_regex",
                "possessive quantifiers are outside the portable regex subset",
            ));
        }
        if byte == b'{' {
            if let Some(closing) = bytes[index + 1..].iter().position(|value| *value == b'}') {
                let closing = index + 1 + closing;
                let body = &bytes[index + 1..closing];
                let valid = if let Some(comma) = body.iter().position(|value| *value == b',') {
                    let minimum = &body[..comma];
                    let maximum = &body[comma + 1..];
                    !maximum.contains(&b',')
                        && (minimum.is_empty() || minimum.iter().all(u8::is_ascii_digit))
                        && (maximum.is_empty() || maximum.iter().all(u8::is_ascii_digit))
                        && !(minimum.is_empty() && maximum.is_empty())
                } else {
                    !body.is_empty() && body.iter().all(u8::is_ascii_digit)
                };
                if valid && bytes.get(closing + 1) == Some(&b'+') {
                    return Err(SearchError::new(
                        "invalid_regex",
                        "possessive quantifiers are outside the portable regex subset",
                    ));
                }
            }
        }
        if index > 0 && bytes[index..].starts_with(b"(?") {
            if let Some(closing) = bytes[index + 2..].iter().position(|value| *value == b')') {
                let flags = &bytes[index + 2..index + 2 + closing];
                if !flags.is_empty()
                    && flags
                        .iter()
                        .all(|value| value.is_ascii_alphabetic() || *value == b'-')
                {
                    return Err(SearchError::new(
                        "invalid_regex",
                        "global inline flags are only portable at the start of a pattern",
                    ));
                }
            }
        }
        index += 1;
    }
    Ok(())
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
    if value.starts_with('~') {
        return Err(SearchError::at(
            "outside_workspace",
            format!("{label} leaves the workspace"),
            value,
        ));
    }
    let requested = Path::new(value);
    if requested.is_absolute() {
        let canonical = match fs {
            WorkspaceFs::Local(_) => tokio::fs::canonicalize(requested).await,
            WorkspaceFs::Remote(remote) => {
                let sftp = remote.sftp.as_ref().ok_or_else(|| {
                    SearchError::new("backend_protocol", "SSH SFTP session is closed")
                })?;
                let mut remote_fs = sftp.fs();
                remote_fs
                    .canonicalize(requested)
                    .await
                    .map_err(std::io::Error::other)
            }
        }
        .map_err(|error| SearchError::at("unreadable_path", error.to_string(), value))?;
        return canonical
            .strip_prefix(fs.root())
            .map(relative_string)
            .map_err(|_| {
                SearchError::at(
                    "outside_workspace",
                    format!("{label} leaves the workspace"),
                    value,
                )
            });
    }
    let mut parts = Vec::new();
    for component in requested.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => parts.push(part.to_str().ok_or_else(|| {
                SearchError::new("invalid_utf8_path", format!("{label} is not valid UTF-8"))
            })?),
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

fn paginate(tool: &str, args: &Value, records: Vec<Value>, limit: usize) -> SearchResult<Value> {
    let fingerprint = canonical_request(tool, args)?;
    let offset = decode_cursor(args.get("cursor"), &fingerprint, records.len())?;
    let mut selected = Vec::new();
    let mut index = offset;
    while index < records.len() && selected.len() < limit {
        let mut candidate = selected.clone();
        candidate.push(records[index].clone());
        let body = page_body(tool, &candidate, index + 1, records.len(), &fingerprint)?;
        if serde_json::to_vec(&body).map_or(usize::MAX, |bytes| bytes.len()) > MAX_OUTPUT_BYTES {
            break;
        }
        selected = candidate;
        index += 1;
    }
    if index == offset && index < records.len() {
        return Err(SearchError::new(
            "output_limit",
            "the next bounded record cannot fit in the output limit",
        ));
    }
    page_body(tool, &selected, index, records.len(), &fingerprint)
}

fn page_body(
    tool: &str,
    selected: &[Value],
    index: usize,
    total: usize,
    fingerprint: &str,
) -> SearchResult<Value> {
    let truncated = index < total;
    let mut entries = Vec::new();
    let mut errors = Vec::new();
    for record in selected {
        let mut public = record.clone();
        if let Some(object) = public.as_object_mut() {
            object.remove("record_type");
            object.remove("_start");
            object.remove("_end");
            if tool == "glob" {
                object.remove("size");
            }
        }
        if is_error(record) {
            errors.push(public);
        } else {
            entries.push(public);
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

fn diagnostic(code: &str, message: &str, path: Option<&str>) -> Value {
    let (message, message_truncated) = bounded_bytes(message.as_bytes(), MAX_FIELD_BYTES);
    let mut item = Map::new();
    item.insert("record_type".into(), Value::String("error".into()));
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
    Value::Object(item)
}

fn error_result(code: &str, message: &str, path: Option<&str>) -> ToolResult {
    ToolResult {
        content: json!({
            "error": {
                "code": code,
                "message": message,
                "path": path,
            }
        })
        .to_string(),
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

fn sort_records(records: &mut [Value]) {
    records.sort_by(|left, right| {
        let left_key = (
            record_path(left).as_bytes(),
            left.get("_start").and_then(Value::as_i64).unwrap_or(-1),
            left.get("_end").and_then(Value::as_i64).unwrap_or(-1),
            left.get("record_type")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            left.get("kind").and_then(Value::as_str).unwrap_or_default(),
            left.get("code").and_then(Value::as_str).unwrap_or_default(),
        );
        let right_key = (
            record_path(right).as_bytes(),
            right.get("_start").and_then(Value::as_i64).unwrap_or(-1),
            right.get("_end").and_then(Value::as_i64).unwrap_or(-1),
            right
                .get("record_type")
                .and_then(Value::as_str)
                .unwrap_or_default(),
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

fn cap_records(records: &mut Vec<Value>, path: &str) {
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

fn is_error(record: &Value) -> bool {
    record.get("record_type").and_then(Value::as_str) == Some("error")
}

fn record_path(record: &Value) -> &str {
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

fn display_path(path: &str) -> String {
    if path.is_empty() {
        ".".to_string()
    } else {
        path.to_string()
    }
}

fn relative_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn is_hidden(path: &str) -> bool {
    path.split('/')
        .any(|part| part.starts_with('.') && part != "." && part != "..")
}

fn ancestors_before(path: &str) -> Vec<String> {
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let mut ancestors = vec![String::new()];
    let mut current = String::new();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        current = join_path(&current, part);
        ancestors.push(current.clone());
    }
    ancestors
}

fn ignore_line_counts(line: &str) -> bool {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    !trimmed.is_empty() && !trimmed.starts_with('#')
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
    normalize_caret_class(&line)
}

fn normalize_caret_class(pattern: &str) -> String {
    let mut output = String::with_capacity(pattern.len());
    let mut characters = pattern.chars().peekable();
    let mut escaped = false;
    while let Some(character) = characters.next() {
        if escaped {
            output.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            output.push(character);
            escaped = true;
            continue;
        }
        if character == '[' && characters.peek() == Some(&'^') {
            characters.next();
            output.push_str("[!");
            continue;
        }
        output.push(character);
    }
    output
}
