use super::*;

#[derive(Debug)]
pub(super) struct SearchError {
    pub(super) code: &'static str,
    pub(super) message: String,
    pub(super) path: Option<String>,
}

impl SearchError {
    pub(super) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
        }
    }

    pub(super) fn at(
        code: &'static str,
        message: impl Into<String>,
        path: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            path: Some(path.into()),
        }
    }
}

pub(super) type SearchResult<T> = Result<T, SearchError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Clone)]
pub(super) enum Record {
    Entry(Value),
    Match(Value),
    Error(Value),
}

impl Record {
    pub(super) fn get(&self, key: &str) -> Option<&Value> {
        self.value().get(key)
    }

    fn value(&self) -> &Value {
        match self {
            Self::Entry(value) | Self::Match(value) | Self::Error(value) => value,
        }
    }

    pub(super) fn into_value(self) -> Value {
        match self {
            Self::Entry(value) | Self::Match(value) | Self::Error(value) => value,
        }
    }

    pub(super) fn is_error(&self) -> bool {
        matches!(self, Self::Error(_))
    }

    pub(super) fn sort_tag(&self) -> &'static str {
        match self {
            Self::Entry(_) | Self::Match(_) => "entry",
            Self::Error(_) => "error",
        }
    }
}

#[derive(Debug)]
pub(super) struct FsEntry {
    pub(super) name: String,
    pub(super) kind: EntryKind,
    pub(super) size: u64,
}

pub(super) struct DirectoryListing {
    pub(super) entries: Vec<FsEntry>,
    pub(super) diagnostics: Vec<Record>,
}

struct LocalOverlay {
    at: String,
    directory: Arc<Dir>,
    path: PathBuf,
    kind: EntryKind,
    size: u64,
}

pub(super) struct LocalFs {
    root: PathBuf,
    absolute_roots: Vec<PathBuf>,
    directory: Arc<Dir>,
    overlays: Vec<LocalOverlay>,
}

pub(super) struct RemoteFs {
    root: PathBuf,
    absolute_roots: Vec<PathBuf>,
    sftp: Option<Sftp>,
    child: Child,
}

pub(super) enum WorkspaceFs {
    Local(LocalFs),
    Remote(RemoteFs),
}

pub(super) struct SearchCancellation(Arc<AtomicBool>);

impl SearchCancellation {
    pub(super) fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub(super) fn flag(&self) -> Arc<AtomicBool> {
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
    pub(super) async fn open(runtime: &ToolRuntime) -> SearchResult<Self> {
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

    pub(super) fn root(&self) -> &Path {
        match self {
            Self::Local(fs) => &fs.root,
            Self::Remote(fs) => &fs.root,
        }
    }

    pub(super) fn relative_absolute(&self, requested: &Path) -> Option<PathBuf> {
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

    pub(super) fn absolute(&self, relative: &str) -> PathBuf {
        if relative.is_empty() {
            self.root().to_path_buf()
        } else {
            self.root().join(relative)
        }
    }

    pub(super) async fn list_dir(
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

    pub(super) async fn read_file(
        &mut self,
        relative: &str,
        maximum: usize,
    ) -> SearchResult<Vec<u8>> {
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

    pub(super) async fn symlink_diagnostic(&mut self, relative: &str) -> Record {
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
    pub(super) async fn optional_path_metadata(
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

    pub(super) async fn path_kind(&mut self, relative: &str) -> SearchResult<EntryKind> {
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

    pub(super) async fn close(mut self) {
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
