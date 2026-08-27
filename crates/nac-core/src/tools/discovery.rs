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

mod filesystem;
mod ignore_rules;
mod matching;
mod pagination;
#[cfg(test)]
mod tests;
use crate::tools::{ToolResult, ToolRuntime};
use filesystem::*;
use ignore_rules::*;
use matching::*;
use pagination::*;

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
    let object = args
        .as_object()
        .ok_or_else(|| SearchError::new("invalid_arguments", "arguments must be an object"))?;
    let pattern = required_string(
        object,
        "pattern",
        "invalid_glob",
        "glob pattern must be a string",
    )?;
    let matcher = compile_glob(pattern)?;
    let root = normalize_path(fs, object.get("root"), "root")?;
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
    let object = args
        .as_object()
        .ok_or_else(|| SearchError::new("invalid_arguments", "arguments must be an object"))?;
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
        roots.push(normalize_path(fs, Some(root), "root")?);
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
        .map(|value| {
            let value = value.as_str().ok_or_else(|| {
                SearchError::new("invalid_arguments", "globs must be an array of strings")
            })?;
            compile_glob(value)
        })
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

#[allow(clippy::too_many_arguments)]
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

fn normalize_path(
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
