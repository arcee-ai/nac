#[cfg(unix)]
use std::ffi::CString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use crate::tool_content::{is_image_candidate, reserve_image_memory, ToolImage, MAX_IMAGE_BYTES};
use crate::types::{ToolContent, ToolContentPart};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use diffy::DiffOptions;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::tools::{
    remote_file_lock_busy, ToolResult, ToolRuntime, REMOTE_FILE_LOCK_RETRY_INTERVAL,
};

#[path = "mutation_remote.rs"]
mod remote;
pub(crate) use remote::execute_remote;
#[cfg(test)]
use remote::REMOTE_MUTATION_SCRIPT;

const FILE_LOCK_POLL_INTERVAL: Duration = Duration::from_millis(1);
pub(crate) const MAX_READ_OUTPUT_BYTES: usize = 30_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct EditSpec {
    pub old_text: String,
    pub new_text: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReadResult {
    path: String,
    revision: String,
    start_line: usize,
    end_line: usize,
    content: String,
    next_offset: Option<usize>,
    truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ChangedRange {
    old_start: usize,
    old_end: usize,
    new_start: usize,
    new_end: usize,
}

#[derive(Debug, Serialize)]
struct MutationResult {
    path: String,
    old_revision: Option<String>,
    new_revision: String,
    changed_ranges: Vec<ChangedRange>,
    diff: String,
}

#[derive(Debug, Serialize)]
struct MutationError {
    error: &'static str,
    message: String,
    committed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    new_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    durability: Option<&'static str>,
}

impl MutationError {
    fn precondition(error: &'static str, message: impl Into<String>) -> Self {
        Self {
            error,
            message: message.into(),
            committed: false,
            current_revision: None,
            new_revision: None,
            durability: None,
        }
    }

    fn already_exists(path: &str, current_revision: Option<String>) -> Self {
        Self {
            error: "already_exists",
            message: format!(
                "file already exists: {path}; expected_revision null only creates a missing file — read the file and retry write with its revision"
            ),
            committed: false,
            current_revision,
            new_revision: None,
            durability: None,
        }
    }

    fn stale(path: &str, current_revision: String) -> Self {
        Self {
            error: "stale_revision",
            message: format!(
                "stale revision for {path}; read the file again and retry the complete operation"
            ),
            committed: false,
            current_revision: Some(current_revision),
            new_revision: None,
            durability: None,
        }
    }

    fn io(path: &str, error: io::Error) -> Self {
        let category = match error.kind() {
            io::ErrorKind::NotFound => "not_found",
            io::ErrorKind::AlreadyExists => "already_exists",
            io::ErrorKind::PermissionDenied => "permission_denied",
            io::ErrorKind::Interrupted => "cancelled",
            _ => "io_error",
        };
        Self::precondition(
            category,
            format!("file mutation failed for {path}: {error}"),
        )
    }

    fn committed(path: &str, new_revision: String, error: io::Error) -> Self {
        Self {
            error: "io_error",
            message: format!(
                "mutation committed for {path}, but durability could not be confirmed: {error}"
            ),
            committed: true,
            current_revision: None,
            new_revision: Some(new_revision),
            durability: Some("uncertain"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NewlineStyle {
    Lf,
    CrLf,
}

impl NewlineStyle {
    fn detect(text: &str) -> Self {
        match (text.find("\r\n"), text.find('\n')) {
            (Some(crlf), Some(lf)) if crlf == lf.saturating_sub(1) => Self::CrLf,
            (Some(crlf), Some(lf)) if crlf < lf => Self::CrLf,
            (Some(_), None) => Self::CrLf,
            _ => Self::Lf,
        }
    }

    fn restore(self, text: &str) -> String {
        match self {
            Self::Lf => text.to_string(),
            Self::CrLf => text.replace('\n', "\r\n"),
        }
    }
}

struct TextSnapshot<'a> {
    bom: bool,
    newline: NewlineStyle,
    original: &'a str,
    normalized: String,
    crlf_offsets: Vec<usize>,
}

impl<'a> TextSnapshot<'a> {
    fn decode(bytes: &'a [u8], path: &str) -> Result<Self, MutationError> {
        let text = std::str::from_utf8(bytes).map_err(|error| {
            MutationError::precondition(
                "io_error",
                format!("file is not valid UTF-8 and cannot be edited: {path}: {error}"),
            )
        })?;
        let (bom, original) = match text.strip_prefix('\u{feff}') {
            Some(text) => (true, text),
            None => (false, text),
        };
        let mut removed = 0;
        let crlf_offsets = original
            .match_indices("\r\n")
            .map(|(index, _)| {
                let normalized = index - removed;
                removed += 1;
                normalized
            })
            .collect();
        Ok(Self {
            bom,
            newline: NewlineStyle::detect(original),
            original,
            normalized: normalize_newlines(original),
            crlf_offsets,
        })
    }

    fn original_offset(&self, normalized_offset: usize) -> usize {
        normalized_offset
            + self
                .crlf_offsets
                .partition_point(|offset| *offset < normalized_offset)
    }

    fn apply_spans(&self, spans: Vec<(usize, usize, String)>) -> Vec<u8> {
        let mut edited = self.original.to_string();
        for (start, end, replacement) in spans.into_iter().rev() {
            let start = self.original_offset(start);
            let end = self.original_offset(end);
            let replacement = self.newline.restore(&replacement);
            edited.replace_range(start..end, &replacement);
        }
        let mut bytes = Vec::with_capacity(edited.len() + usize::from(self.bom) * 3);
        if self.bom {
            bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
        }
        bytes.extend_from_slice(edited.as_bytes());
        bytes
    }
}

fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n")
}

pub(crate) fn revision(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

pub(crate) fn read_result(
    path: String,
    bytes: &[u8],
    offset: usize,
    limit: usize,
) -> Result<ReadResult, ToolResult> {
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err(error_tool_result(MutationError::precondition(
            "io_error",
            format!("binary file cannot be read as text: {path}"),
        )));
    }
    let text = String::from_utf8_lossy(bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let normalized = normalize_newlines(text);
    let lines: Vec<&str> = if normalized.is_empty() {
        Vec::new()
    } else {
        normalized.split_inclusive('\n').collect()
    };
    let start = offset.min(lines.len());
    let selected_end = start.saturating_add(limit).min(lines.len());
    let mut content = String::new();
    let mut end = start;
    let mut truncated = false;
    for line in &lines[start..selected_end] {
        if content.len().saturating_add(line.len()) <= MAX_READ_OUTPUT_BYTES {
            content.push_str(line);
            end += 1;
            continue;
        }
        if end == start {
            content.push_str(truncate_utf8(line, MAX_READ_OUTPUT_BYTES));
            end += 1;
            truncated = true;
        }
        break;
    }
    let start_line = start.saturating_add(1);
    let end_line = if end == start { start } else { end };
    Ok(ReadResult {
        path,
        revision: revision(bytes),
        start_line,
        end_line,
        content,
        next_offset: (end < lines.len()).then_some(end),
        truncated,
    })
}

fn truncate_utf8(value: &str, max: usize) -> &str {
    let mut end = max.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

pub(crate) fn success_tool_result<T: Serialize>(result: &T) -> ToolResult {
    ToolResult {
        content: serde_json::to_string_pretty(result)
            .unwrap_or_else(|error| format!("{{\"error\":\"io_error\",\"message\":\"{error}\"}}"))
            .into(),
        is_error: false,
    }
}

fn error_tool_result(error: MutationError) -> ToolResult {
    ToolResult {
        content: serde_json::to_string_pretty(&error)
            .unwrap_or_else(|serialization| {
                format!("Error serializing mutation result: {serialization}")
            })
            .into(),
        is_error: true,
    }
}
pub(crate) fn argument_error(message: impl Into<String>) -> ToolResult {
    error_tool_result(MutationError::precondition("io_error", message))
}
pub(crate) fn permission_error(message: impl Into<String>) -> ToolResult {
    error_tool_result(MutationError::precondition("permission_denied", message))
}
pub(crate) fn required_string(args: &Value, key: &str) -> Result<String, ToolResult> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| argument_error(format!("'{key}' argument required and must be a string")))
}

pub(crate) fn read_error(path: &str, error: io::Error) -> ToolResult {
    error_tool_result(MutationError::io(path, error))
}

pub(crate) async fn edit_local(
    path: PathBuf,
    path_display: String,
    expected_revision: String,
    edits: Vec<EditSpec>,
) -> ToolResult {
    mutate_local(
        path,
        path_display,
        MutationRequest::Edit {
            expected_revision,
            edits,
        },
    )
    .await
}

pub(crate) async fn edit_local_bound(
    path: PathBuf,
    path_display: String,
    expected_revision: String,
    edits: Vec<EditSpec>,
) -> ToolResult {
    mutate_local_bound(
        path,
        path_display,
        MutationRequest::Edit {
            expected_revision,
            edits,
        },
    )
    .await
}

pub(crate) async fn write_local(
    path: PathBuf,
    path_display: String,
    content: String,
    expected_revision: Option<String>,
) -> ToolResult {
    mutate_local(
        path,
        path_display,
        MutationRequest::Write {
            expected_revision,
            content,
        },
    )
    .await
}

pub(crate) async fn write_local_bound(
    path: PathBuf,
    path_display: String,
    content: String,
    expected_revision: Option<String>,
) -> ToolResult {
    mutate_local_bound(
        path,
        path_display,
        MutationRequest::Write {
            expected_revision,
            content,
        },
    )
    .await
}
pub(crate) async fn edit_mounted(
    root: PathBuf,
    relative: PathBuf,
    path_display: String,
    expected_revision: String,
    edits: Vec<EditSpec>,
) -> ToolResult {
    mutate_mounted(
        root,
        relative,
        path_display,
        MutationRequest::Edit {
            expected_revision,
            edits,
        },
    )
    .await
}

pub(crate) async fn write_mounted(
    root: PathBuf,
    relative: PathBuf,
    path_display: String,
    content: String,
    expected_revision: Option<String>,
) -> ToolResult {
    mutate_mounted(
        root,
        relative,
        path_display,
        MutationRequest::Write {
            expected_revision,
            content,
        },
    )
    .await
}

#[expect(
    clippy::expect_used,
    reason = "one reserved and validated image part remains within ToolContent limits"
)]
pub(crate) fn read_opened_file(
    mut file: File,
    path_display: String,
    offset: usize,
    limit: usize,
    image_read: bool,
) -> ToolResult {
    let mut header = [0u8; 32];
    let header_len = match file.read(&mut header) {
        Ok(length) => length,
        Err(error) => return read_error(&path_display, error),
    };
    if let Err(error) = file.seek(SeekFrom::Start(0)) {
        return read_error(&path_display, error);
    }
    if is_image_candidate(Path::new(&path_display), &header[..header_len]) {
        if !image_read {
            return error_tool_result(MutationError::precondition(
                "unsupported_image",
                format!("the selected model cannot view image files: {path_display}"),
            ));
        }
        let file_len = match file.metadata() {
            Ok(metadata) => metadata.len(),
            Err(error) => return read_error(&path_display, error),
        };
        if file_len > MAX_IMAGE_BYTES as u64 {
            return error_tool_result(MutationError::precondition(
                "image_limit_exceeded",
                format!("image exceeds the {MAX_IMAGE_BYTES} byte limit: {path_display}"),
            ));
        }
        let reservation = match reserve_image_memory(file_len as usize) {
            Ok(reservation) => reservation,
            Err(error) => {
                return error_tool_result(MutationError::precondition(
                    error.code(),
                    error.message(),
                ))
            }
        };
        let mut bytes = Vec::with_capacity(file_len as usize);
        if let Err(error) = file
            .take((MAX_IMAGE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
        {
            return read_error(&path_display, error);
        }
        if bytes.len() > MAX_IMAGE_BYTES {
            return error_tool_result(MutationError::precondition(
                "image_limit_exceeded",
                format!("image exceeds the {MAX_IMAGE_BYTES} byte limit: {path_display}"),
            ));
        }
        let image = match ToolImage::validate_reserved(
            bytes,
            Some(Path::new(&path_display)),
            None,
            reservation,
        ) {
            Ok(image) => image,
            Err(error) => {
                return error_tool_result(MutationError::precondition(
                    error.code(),
                    format!("{}: {path_display}", error.message()),
                ))
            }
        };
        let content = ToolContent::from_parts(vec![ToolContentPart::Image(image)])
            .expect("one validated image is within result limits");
        return ToolResult {
            content,
            is_error: false,
        };
    }
    let mut bytes = Vec::new();
    if let Err(error) = file.read_to_end(&mut bytes) {
        return read_error(&path_display, error);
    }
    match read_result(path_display, &bytes, offset, limit) {
        Ok(result) => success_tool_result(&result),
        Err(error) => error,
    }
}

pub(crate) async fn read_mounted(
    root: PathBuf,
    relative: PathBuf,
    path_display: String,
    offset: usize,
    limit: usize,
    image_read: bool,
) -> ToolResult {
    #[cfg(unix)]
    {
        let display_for_task = path_display.clone();
        let result = tokio::task::spawn_blocking(move || {
            let (directory, name) = open_parent_beneath(&root, &relative, false)?;
            let file = open_target_at(&directory, &name)?
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "mounted file not found"))?;
            Ok::<_, io::Error>(read_opened_file(
                file,
                display_for_task,
                offset,
                limit,
                image_read,
            ))
        })
        .await;
        match result {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => read_error(&path_display, error),
            Err(error) => argument_error(format!(
                "mounted file read task failed for {path_display}: {error}"
            )),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (root, relative, offset, limit, image_read);
        argument_error(format!(
            "safe mounted file reads are unsupported on this platform: {path_display}"
        ))
    }
}

enum MutationRequest {
    Edit {
        expected_revision: String,
        edits: Vec<EditSpec>,
    },
    Write {
        expected_revision: Option<String>,
        content: String,
    },
}

async fn mutate_local(path: PathBuf, path_display: String, request: MutationRequest) -> ToolResult {
    let bound = match tokio::task::spawn_blocking(move || resolve_target_path(&path)).await {
        Ok(Ok(path)) => path,
        Ok(Err(error)) => return error_tool_result(MutationError::io(&path_display, error)),
        Err(error) => {
            return error_tool_result(MutationError::precondition(
                "io_error",
                format!("path resolution task failed for {path_display}: {error}"),
            ))
        }
    };
    mutate_local_bound(bound, path_display, request).await
}

async fn mutate_local_bound(
    path: PathBuf,
    path_display: String,
    request: MutationRequest,
) -> ToolResult {
    #[cfg(test)]
    wait_at_bound_local_open_gate(&path);
    #[cfg(unix)]
    {
        let relative = match path.strip_prefix(Path::new("/")) {
            Ok(relative) if !relative.as_os_str().is_empty() => relative.to_path_buf(),
            _ => {
                return argument_error(format!(
                    "safe local file mutations require an absolute file path: {path_display}"
                ))
            }
        };
        mutate_mounted(PathBuf::from("/"), relative, path_display, request).await
    }
    #[cfg(not(unix))]
    {
        let target = path;
        let lock = match acquire_path_lock(&target).await {
            Ok(lock) => lock,
            Err(error) => return error_tool_result(MutationError::io(&path_display, error)),
        };
        match tokio::task::spawn_blocking(move || {
            mutate_locked(target, path_display, request, lock)
        })
        .await
        {
            Ok(Ok(result)) => success_tool_result(&result),
            Ok(Err(error)) => error_tool_result(error),
            Err(error) => error_tool_result(MutationError::precondition(
                "io_error",
                format!("file mutation task failed: {error}"),
            )),
        }
    }
}

async fn mutate_mounted(
    root: PathBuf,
    relative: PathBuf,
    path_display: String,
    request: MutationRequest,
) -> ToolResult {
    #[cfg(unix)]
    {
        let create_parents = matches!(
            &request,
            MutationRequest::Write {
                expected_revision: None,
                ..
            }
        );
        let identity = match root.canonicalize() {
            Ok(root) => lexical_normalize(&root.join(&relative)),
            Err(error) => return error_tool_result(MutationError::io(&path_display, error)),
        };
        let lock = match acquire_path_lock(&identity).await {
            Ok(lock) => lock,
            Err(error) => return error_tool_result(MutationError::io(&path_display, error)),
        };
        match tokio::task::spawn_blocking(move || {
            mutate_mounted_locked(
                root,
                relative,
                identity,
                path_display,
                request,
                create_parents,
                lock,
            )
        })
        .await
        {
            Ok(Ok(result)) => success_tool_result(&result),
            Ok(Err(error)) => error_tool_result(error),
            Err(error) => error_tool_result(MutationError::precondition(
                "io_error",
                format!("mounted file mutation task failed: {error}"),
            )),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (root, relative, request);
        argument_error(format!(
            "safe mounted file mutations are unsupported on this platform: {path_display}"
        ))
    }
}

#[cfg(unix)]
fn mutate_mounted_locked(
    root: PathBuf,
    relative: PathBuf,
    identity: PathBuf,
    path_display: String,
    request: MutationRequest,
    create_parents: bool,
    _lock: File,
) -> Result<MutationResult, MutationError> {
    let (directory, name) = open_parent_beneath(&root, &relative, create_parents)
        .map_err(|error| MutationError::io(&path_display, error))?;
    let mut old_file = open_target_at(&directory, &name)
        .map_err(|error| MutationError::io(&path_display, error))?;
    let mut old_bytes = None;
    let mut metadata = None;
    if let Some(file) = old_file.as_mut() {
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| MutationError::io(&path_display, error))?;
        metadata = Some(
            file.metadata()
                .map_err(|error| MutationError::io(&path_display, error))?,
        );
        old_bytes = Some(bytes);
    }
    let old_revision = old_bytes.as_deref().map(revision);
    let new_bytes = prepare_new_bytes(&path_display, request, old_bytes.as_deref())?;
    let result = build_result(
        &path_display,
        old_bytes.as_deref().unwrap_or_default(),
        &new_bytes,
        old_revision,
    );
    publish_at(
        &directory,
        &name,
        &identity,
        metadata.as_ref(),
        &new_bytes,
        &path_display,
        &result.new_revision,
    )?;
    Ok(result)
}

#[cfg(unix)]
fn open_parent_beneath(
    root: &Path,
    relative: &Path,
    create_parents: bool,
) -> io::Result<(File, CString)> {
    let components: Vec<_> = relative.components().collect();
    if components.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "single-file mount roots cannot be atomically replaced",
        ));
    }
    if components
        .iter()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "mounted file path must be relative and normalized",
        ));
    }
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let mut directory = options.open(root)?;
    for component in &components[..components.len() - 1] {
        let Component::Normal(part) = component else {
            unreachable!();
        };
        let name = c_string(part.as_bytes())?;
        match open_directory_at(&directory, &name) {
            Ok(next) => directory = next,
            Err(error) if error.kind() == io::ErrorKind::NotFound && create_parents => {
                // SAFETY: `directory` is a live directory descriptor and
                // `name` is a NUL-terminated relative component without `/`.
                let created = unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o777) };
                if created == -1 {
                    let error = io::Error::last_os_error();
                    if error.kind() != io::ErrorKind::AlreadyExists {
                        return Err(error);
                    }
                }
                directory = open_directory_at(&directory, &name)?;
            }
            Err(error) => return Err(error),
        }
    }
    let Component::Normal(name) = components[components.len() - 1] else {
        unreachable!();
    };
    Ok((directory, c_string(name.as_bytes())?))
}

#[cfg(unix)]
fn c_string(bytes: &[u8]) -> io::Result<CString> {
    CString::new(bytes).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "mounted file path contains a NUL byte",
        )
    })
}

#[cfg(unix)]
fn open_directory_at(directory: &File, name: &CString) -> io::Result<File> {
    // SAFETY: `directory` is a live descriptor and `name` is a NUL-terminated
    // relative component; the flags request a no-follow directory descriptor.
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor == -1 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the successful `openat` result is a new owned descriptor that
    // has not been wrapped or closed elsewhere.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn open_target_at(directory: &File, name: &CString) -> io::Result<Option<File>> {
    // SAFETY: `directory` is a live descriptor and `name` is a NUL-terminated
    // relative component; `O_NOFOLLOW` prevents a final symlink traversal.
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor == -1 {
        let error = io::Error::last_os_error();
        return if error.kind() == io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(error)
        };
    }
    // SAFETY: the successful `openat` result is a new owned descriptor that
    // has not been wrapped or closed elsewhere.
    Ok(Some(unsafe { File::from_raw_fd(descriptor) }))
}

#[cfg(unix)]
fn publish_at(
    directory: &File,
    name: &CString,
    _identity: &Path,
    metadata: Option<&fs::Metadata>,
    new_bytes: &[u8],
    path_display: &str,
    new_revision: &str,
) -> Result<(), MutationError> {
    let temp_name = c_string(format!(".nac-mutation-{}.tmp", Uuid::new_v4()).as_bytes())
        .map_err(|error| MutationError::io(path_display, error))?;
    // SAFETY: `directory` is a live descriptor and `temp_name` is a
    // NUL-terminated relative component; exclusive creation yields a new fd.
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            temp_name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o666,
        )
    };
    if descriptor == -1 {
        return Err(MutationError::io(path_display, io::Error::last_os_error()));
    }
    // SAFETY: the successful exclusive `openat` result is a new owned
    // descriptor that has not been wrapped or closed elsewhere.
    let mut temp = unsafe { File::from_raw_fd(descriptor) };
    let mut cleanup = AtTempCleanup::new(
        directory
            .try_clone()
            .map_err(|error| MutationError::io(path_display, error))?,
        temp_name.clone(),
    );
    if let Some(metadata) = metadata {
        preserve_metadata(&temp, metadata)
            .map_err(|error| MutationError::io(path_display, error))?;
    }
    temp.write_all(new_bytes)
        .and_then(|_| temp.sync_all())
        .map_err(|error| MutationError::io(path_display, error))?;
    drop(temp);
    #[cfg(test)]
    if take_fail_before_publish(_identity) {
        return Err(MutationError::precondition(
            "io_error",
            format!("injected failure before publication: {path_display}"),
        ));
    }
    #[cfg(test)]
    wait_at_publish_gate(_identity);

    if metadata.is_some() {
        // SAFETY: both names are live NUL-terminated relative components and
        // both directory arguments are the same live directory descriptor.
        let result = unsafe {
            libc::renameat(
                directory.as_raw_fd(),
                temp_name.as_ptr(),
                directory.as_raw_fd(),
                name.as_ptr(),
            )
        };
        if result == -1 {
            return Err(MutationError::io(path_display, io::Error::last_os_error()));
        }
        cleanup.disarm();
    } else {
        // SAFETY: both names are live NUL-terminated relative components and
        // both directory arguments are the same live directory descriptor.
        let result = unsafe {
            libc::linkat(
                directory.as_raw_fd(),
                temp_name.as_ptr(),
                directory.as_raw_fd(),
                name.as_ptr(),
                0,
            )
        };
        if result == -1 {
            let error = io::Error::last_os_error();
            return if error.kind() == io::ErrorKind::AlreadyExists {
                Err(MutationError::already_exists(path_display, None))
            } else {
                Err(MutationError::io(path_display, error))
            };
        }
        // SAFETY: `directory` remains live and `temp_name` is the
        // NUL-terminated temporary entry just linked into its final location.
        let removed = unsafe { libc::unlinkat(directory.as_raw_fd(), temp_name.as_ptr(), 0) };
        if removed == -1 {
            return Err(MutationError::committed(
                path_display,
                new_revision.to_string(),
                io::Error::last_os_error(),
            ));
        }
        cleanup.disarm();
    }
    directory
        .sync_all()
        .map_err(|error| MutationError::committed(path_display, new_revision.to_string(), error))
}

#[cfg(unix)]
struct AtTempCleanup {
    directory: File,
    name: CString,
    armed: bool,
}

#[cfg(unix)]
impl AtTempCleanup {
    fn new(directory: File, name: CString) -> Self {
        Self {
            directory,
            name,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

#[cfg(unix)]
impl Drop for AtTempCleanup {
    fn drop(&mut self) {
        if self.armed {
            // SAFETY: the cleanup object owns a live directory descriptor and
            // a NUL-terminated relative name; unlink failure is best-effort.
            unsafe {
                libc::unlinkat(self.directory.as_raw_fd(), self.name.as_ptr(), 0);
            }
        }
    }
}

#[cfg(any(test, not(unix)))]
fn mutate_locked(
    target: PathBuf,
    path_display: String,
    request: MutationRequest,
    _lock: File,
) -> Result<MutationResult, MutationError> {
    let old_bytes = match fs::read(&target) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(MutationError::io(&path_display, error)),
    };
    let old_revision = old_bytes.as_deref().map(revision);
    let new_bytes = prepare_new_bytes(&path_display, request, old_bytes.as_deref())?;
    let old_for_diff = old_bytes.as_deref().unwrap_or_default();
    let result = build_result(&path_display, old_for_diff, &new_bytes, old_revision);
    publish(
        &target,
        old_bytes.as_deref(),
        &new_bytes,
        &path_display,
        &result.new_revision,
    )?;
    Ok(result)
}

fn prepare_new_bytes(
    path_display: &str,
    request: MutationRequest,
    old_bytes: Option<&[u8]>,
) -> Result<Vec<u8>, MutationError> {
    match request {
        MutationRequest::Edit {
            expected_revision,
            edits,
        } => {
            let Some(old_bytes) = old_bytes else {
                return Err(MutationError::precondition(
                    "not_found",
                    format!("file not found: {path_display}"),
                ));
            };
            verify_revision(path_display, &expected_revision, old_bytes)?;
            apply_edits(path_display, old_bytes, &edits)
        }
        MutationRequest::Write {
            expected_revision,
            content,
        } => match (expected_revision, old_bytes) {
            (None, Some(old_bytes)) => Err(MutationError::already_exists(
                path_display,
                Some(revision(old_bytes)),
            )),
            (None, None) => Ok(content.into_bytes()),
            (Some(_), None) => Err(MutationError::precondition(
                "not_found",
                format!("file not found: {path_display}"),
            )),
            (Some(expected), Some(old_bytes)) => {
                verify_revision(path_display, &expected, old_bytes)?;
                Ok(content.into_bytes())
            }
        },
    }
}

fn verify_revision(path: &str, expected: &str, bytes: &[u8]) -> Result<(), MutationError> {
    let current = revision(bytes);
    if expected == current {
        Ok(())
    } else {
        Err(MutationError::stale(path, current))
    }
}

fn apply_edits(path: &str, old_bytes: &[u8], edits: &[EditSpec]) -> Result<Vec<u8>, MutationError> {
    if edits.is_empty() {
        return Err(MutationError::precondition(
            "old_text_not_found",
            "edit requires at least one replacement",
        ));
    }
    let snapshot = TextSnapshot::decode(old_bytes, path)?;
    let mut matches = Vec::with_capacity(edits.len());
    for edit in edits {
        let old_text = normalize_newlines(&edit.old_text);
        if old_text.is_empty() {
            return Err(MutationError::precondition(
                "old_text_not_found",
                "old_text must not be empty",
            ));
        }
        let positions: Vec<usize> = snapshot
            .normalized
            .match_indices(&old_text)
            .map(|(index, _)| index)
            .collect();
        match positions.as_slice() {
            [] => {
                return Err(MutationError::precondition(
                    "old_text_not_found",
                    format!("old_text not found in {path}"),
                ))
            }
            [start] => matches.push((
                *start,
                start + old_text.len(),
                normalize_newlines(&edit.new_text),
            )),
            _ => {
                return Err(MutationError::precondition(
                    "old_text_not_unique",
                    format!("old_text appears {} times in {path}", positions.len()),
                ))
            }
        }
    }
    let mut spans: Vec<(usize, usize, String)> = matches;
    spans.sort_by_key(|(start, _, _)| *start);
    for pair in spans.windows(2) {
        if pair[0].1 > pair[1].0 {
            return Err(MutationError::precondition(
                "overlapping_edits",
                format!("edit ranges overlap in {path}"),
            ));
        }
    }
    Ok(snapshot.apply_spans(spans))
}

fn build_result(
    path: &str,
    old_bytes: &[u8],
    new_bytes: &[u8],
    old_revision: Option<String>,
) -> MutationResult {
    let old_text = String::from_utf8_lossy(old_bytes);
    let new_text = String::from_utf8_lossy(new_bytes);
    let mut diff_options = DiffOptions::new();
    diff_options
        .set_context_len(3)
        .set_original_filename(format!("a/{path}"))
        .set_modified_filename(format!("b/{path}"));
    let patch = diff_options.create_patch(&old_text, &new_text);
    let diff = patch.to_string();
    let mut range_options = DiffOptions::new();
    range_options.set_context_len(0);
    let range_patch = range_options.create_patch(&old_text, &new_text);
    let changed_ranges = range_patch
        .hunks()
        .iter()
        .map(|hunk| {
            let old = hunk.old_range();
            let new = hunk.new_range();
            ChangedRange {
                old_start: old.start(),
                old_end: old.start().saturating_add(old.len()).saturating_sub(1),
                new_start: new.start(),
                new_end: new.start().saturating_add(new.len()).saturating_sub(1),
            }
        })
        .collect();
    MutationResult {
        path: path.to_string(),
        old_revision,
        new_revision: revision(new_bytes),
        changed_ranges,
        diff,
    }
}

#[cfg(test)]
static FAIL_BEFORE_PUBLISH_PATHS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashSet<PathBuf>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashSet::new()));

#[cfg(test)]
fn fail_once_before_publish(path: &Path) {
    FAIL_BEFORE_PUBLISH_PATHS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(path.to_path_buf());
}

#[cfg(test)]
fn take_fail_before_publish(path: &Path) -> bool {
    FAIL_BEFORE_PUBLISH_PATHS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(path)
}
#[cfg(test)]
struct PublishGate {
    entered: std::sync::mpsc::SyncSender<()>,
    release: std::sync::mpsc::Receiver<()>,
}

#[cfg(test)]
static BOUND_LOCAL_OPEN_GATES: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<PathBuf, PublishGate>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

#[cfg(test)]
pub(crate) fn gate_before_bound_local_open(
    path: PathBuf,
) -> (
    std::sync::mpsc::Receiver<()>,
    std::sync::mpsc::SyncSender<()>,
) {
    let (entered_sender, entered_receiver) = std::sync::mpsc::sync_channel(1);
    let (release_sender, release_receiver) = std::sync::mpsc::sync_channel(1);
    BOUND_LOCAL_OPEN_GATES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(
            path,
            PublishGate {
                entered: entered_sender,
                release: release_receiver,
            },
        );
    (entered_receiver, release_sender)
}

#[cfg(test)]
fn wait_at_bound_local_open_gate(path: &Path) {
    let gate = BOUND_LOCAL_OPEN_GATES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(path);
    if let Some(gate) = gate {
        let _ = gate.entered.send(());
        let _ = gate.release.recv();
    }
}

#[cfg(test)]
static PUBLISH_GATES: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<PathBuf, PublishGate>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

#[cfg(test)]
fn gate_before_publish(
    path: PathBuf,
) -> (
    std::sync::mpsc::Receiver<()>,
    std::sync::mpsc::SyncSender<()>,
) {
    let (entered_sender, entered_receiver) = std::sync::mpsc::sync_channel(1);
    let (release_sender, release_receiver) = std::sync::mpsc::sync_channel(1);
    PUBLISH_GATES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(
            path,
            PublishGate {
                entered: entered_sender,
                release: release_receiver,
            },
        );
    (entered_receiver, release_sender)
}

#[cfg(test)]
fn wait_at_publish_gate(path: &Path) {
    let gate = PUBLISH_GATES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(path);
    if let Some(gate) = gate {
        let _ = gate.entered.send(());
        let _ = gate.release.recv();
    }
}

#[cfg(any(test, not(unix)))]
fn publish(
    target: &Path,
    old_bytes: Option<&[u8]>,
    new_bytes: &[u8],
    path_display: &str,
    new_revision: &str,
) -> Result<(), MutationError> {
    let parent = target.parent().ok_or_else(|| {
        MutationError::precondition("io_error", format!("file has no parent: {path_display}"))
    })?;
    fs::create_dir_all(parent).map_err(|error| MutationError::io(path_display, error))?;
    let metadata = match fs::metadata(target) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound && old_bytes.is_none() => None,
        Err(error) => return Err(MutationError::io(path_display, error)),
    };
    let temp_path = parent.join(format!(".nac-mutation-{}.tmp", Uuid::new_v4()));
    let mut cleanup = TempCleanup::new(temp_path.clone());
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options
        .mode(0o666)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    let mut temp = options
        .open(&temp_path)
        .map_err(|error| MutationError::io(path_display, error))?;
    if let Some(metadata) = metadata.as_ref() {
        preserve_metadata(&temp, metadata)
            .map_err(|error| MutationError::io(path_display, error))?;
    }
    temp.write_all(new_bytes)
        .and_then(|_| temp.sync_all())
        .map_err(|error| MutationError::io(path_display, error))?;
    drop(temp);
    #[cfg(test)]
    if take_fail_before_publish(target) {
        return Err(MutationError::precondition(
            "io_error",
            format!("injected failure before publication: {path_display}"),
        ));
    }
    #[cfg(test)]
    wait_at_publish_gate(target);

    if old_bytes.is_some() {
        fs::rename(&temp_path, target).map_err(|error| MutationError::io(path_display, error))?;
        cleanup.disarm();
    } else {
        match fs::hard_link(&temp_path, target) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                return Err(MutationError::already_exists(path_display, None))
            }
            Err(error) => return Err(MutationError::io(path_display, error)),
        }
        if let Err(error) = fs::remove_file(&temp_path) {
            return Err(MutationError::committed(
                path_display,
                new_revision.to_string(),
                error,
            ));
        }
        cleanup.disarm();
    }
    let directory = File::open(parent)
        .map_err(|error| MutationError::committed(path_display, new_revision.to_string(), error))?;
    directory
        .sync_all()
        .map_err(|error| MutationError::committed(path_display, new_revision.to_string(), error))?;
    Ok(())
}

// `mode_t` is `u16` on macOS and `u32` on Linux; the explicit casts keep
// `MetadataExt::mode()` arithmetic portable across both CI targets.
#[cfg(unix)]
#[allow(
    clippy::unnecessary_cast,
    reason = "libc mode-bit types vary by Unix target and the contract requires u32"
)]
const SET_USER_ID_MODE_BIT: u32 = libc::S_ISUID as u32;

#[cfg(unix)]
#[allow(
    clippy::unnecessary_cast,
    reason = "libc mode-bit types vary by Unix target and the contract requires u32"
)]
const SET_GROUP_ID_MODE_BIT: u32 = libc::S_ISGID as u32;

#[cfg(unix)]
fn preserve_metadata(file: &File, metadata: &fs::Metadata) -> io::Result<()> {
    // SAFETY: `file` is a live descriptor and the uid/gid values came directly
    // from filesystem metadata; `fchown` takes no pointers.
    let result = unsafe { libc::fchown(file.as_raw_fd(), metadata.uid(), metadata.gid()) };
    if result == -1 {
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::PermissionDenied {
            return Err(error);
        }

        // Replacement may be permitted even when restoring a foreign owner is not.
        // Keep the original group when possible; special bits are cleared below if
        // either principal necessarily changes with the inode.
        let current = file.metadata()?;
        if current.gid() != metadata.gid() {
            // SAFETY: `file` is live, uid::MAX means preserve the current uid,
            // and the requested gid came from filesystem metadata.
            let result =
                unsafe { libc::fchown(file.as_raw_fd(), libc::uid_t::MAX, metadata.gid()) };
            if result == -1 {
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::PermissionDenied {
                    return Err(error);
                }
            }
        }
    }

    let current = file.metadata()?;
    let mut mode = metadata.mode() & 0o7777;
    if current.uid() != metadata.uid() {
        mode &= !SET_USER_ID_MODE_BIT;
    }
    if current.gid() != metadata.gid() {
        mode &= !SET_GROUP_ID_MODE_BIT;
    }
    file.set_permissions(fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn preserve_metadata(file: &File, metadata: &fs::Metadata) -> io::Result<()> {
    file.set_permissions(metadata.permissions())
}

#[cfg(any(test, not(unix)))]
struct TempCleanup {
    path: Option<PathBuf>,
}

#[cfg(any(test, not(unix)))]
impl TempCleanup {
    fn new(path: PathBuf) -> Self {
        Self { path: Some(path) }
    }

    fn disarm(&mut self) {
        self.path = None;
    }
}

#[cfg(any(test, not(unix)))]
impl Drop for TempCleanup {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = fs::remove_file(path);
        }
    }
}

async fn acquire_path_lock(target: &Path) -> io::Result<File> {
    let target = target.to_path_buf();
    let file = tokio::task::spawn_blocking(move || {
        let lock_path = lock_path(&target)?;
        secure_open_lock(&lock_path)
    })
    .await
    .map_err(|error| io::Error::other(format!("file-lock task failed: {error}")))??;
    loop {
        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => return Ok(file),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                tokio::time::sleep(FILE_LOCK_POLL_INTERVAL).await;
            }
            Err(error) => return Err(error),
        }
    }
}

fn lock_path(target: &Path) -> io::Result<PathBuf> {
    #[cfg(unix)]
    // SAFETY: `geteuid` has no arguments or memory preconditions.
    let suffix = unsafe { libc::geteuid() }.to_string();
    #[cfg(not(unix))]
    let suffix = "user".to_string();
    let directory = std::env::temp_dir().join(format!("nac-file-locks-{suffix}"));
    secure_lock_directory(&directory)?;
    #[cfg(unix)]
    let identity = target.as_os_str().as_bytes();
    #[cfg(not(unix))]
    let identity = target.to_string_lossy().as_bytes();
    Ok(directory.join(format!("{:x}.lock", Sha256::digest(identity))))
}

fn secure_lock_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    let create_result = fs::DirBuilder::new().mode(0o700).create(path);
    #[cfg(not(unix))]
    let create_result = fs::create_dir(path);
    match create_result {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() {
        return Err(io::Error::other("NAC file-lock path is not a directory"));
    }
    #[cfg(unix)]
    {
        // SAFETY: `geteuid` has no arguments or memory preconditions.
        if metadata.uid() != unsafe { libc::geteuid() } {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "NAC file-lock directory has the wrong owner",
            ));
        }
        if metadata.mode() & 0o077 != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "NAC file-lock directory must not be accessible by group or other users",
            ));
        }
    }
    Ok(())
}

fn secure_open_lock(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    options
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(io::Error::other("NAC file lock is not a regular file"));
    }
    #[cfg(unix)]
    {
        // SAFETY: `geteuid` has no arguments or memory preconditions.
        if metadata.uid() != unsafe { libc::geteuid() }
            || metadata.nlink() != 1
            || metadata.mode() & 0o077 != 0
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "NAC file lock has unsafe ownership, mode, or link count",
            ));
        }
    }
    Ok(file)
}

pub(crate) fn resolve_target_path(path: &Path) -> io::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        lexical_normalize(path)
    } else {
        lexical_normalize(&std::env::current_dir()?.join(path))
    };
    if absolute.exists() {
        return absolute.canonicalize();
    }
    let mut cursor = absolute.as_path();
    let mut suffix = Vec::new();
    while !cursor.exists() {
        let Some(name) = cursor.file_name() else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "no existing ancestor for file path",
            ));
        };
        suffix.push(name.to_os_string());
        cursor = cursor.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "no existing ancestor for file path",
            )
        })?;
    }
    let mut resolved = cursor.canonicalize()?;
    for component in suffix.into_iter().rev() {
        resolved.push(component);
    }
    Ok(resolved)
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

#[cfg(test)]
#[path = "mutation_tests.rs"]
mod tests;
