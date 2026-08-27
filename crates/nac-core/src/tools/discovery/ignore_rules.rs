use super::*;

#[derive(Clone)]
pub(super) struct IgnoreLayer {
    base: String,
    matcher: Arc<Gitignore>,
}

struct IgnoreCacheEntry {
    matcher: Arc<Gitignore>,
    diagnostics: Vec<Record>,
}

pub(super) struct IgnoreState {
    cache: HashMap<String, IgnoreCacheEntry>,
    bytes: usize,
    rules: usize,
}

impl IgnoreState {
    pub(super) fn new() -> Self {
        Self {
            cache: HashMap::new(),
            bytes: 0,
            rules: 0,
        }
    }
}

pub(super) async fn load_ignore(
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

pub(super) async fn load_ignore_from_entries(
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

pub(super) fn ignored(root: &Path, path: &str, is_dir: bool, layers: &[IgnoreLayer]) -> bool {
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

pub(super) fn has_ignored_ancestor(root: &Path, path: &str, layers: &[IgnoreLayer]) -> bool {
    let mut prefix = String::new();
    for component in path.split('/') {
        prefix = join_path(&prefix, component);
        if ignored(root, &prefix, true, layers) {
            return true;
        }
    }
    false
}
