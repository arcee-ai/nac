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
    let target = match tokio::task::spawn_blocking(move || resolve_target_path(&path)).await {
        Ok(Ok(path)) => path,
        Ok(Err(error)) => return error_tool_result(MutationError::io(&path_display, error)),
        Err(error) => {
            return error_tool_result(MutationError::precondition(
                "io_error",
                format!("path resolution task failed for {path_display}: {error}"),
            ))
        }
    };
    let lock = match acquire_path_lock(&target).await {
        Ok(lock) => lock,
        Err(error) => return error_tool_result(MutationError::io(&path_display, error)),
    };
    match tokio::task::spawn_blocking(move || mutate_locked(target, path_display, request, lock))
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
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn open_target_at(directory: &File, name: &CString) -> io::Result<Option<File>> {
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
            unsafe {
                libc::unlinkat(self.directory.as_raw_fd(), self.name.as_ptr(), 0);
            }
        }
    }
}

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
#[allow(clippy::unnecessary_cast)]
const SET_USER_ID_MODE_BIT: u32 = libc::S_ISUID as u32;

#[cfg(unix)]
#[allow(clippy::unnecessary_cast)]
const SET_GROUP_ID_MODE_BIT: u32 = libc::S_ISGID as u32;

#[cfg(unix)]
fn preserve_metadata(file: &File, metadata: &fs::Metadata) -> io::Result<()> {
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

struct TempCleanup {
    path: Option<PathBuf>,
}

impl TempCleanup {
    fn new(path: PathBuf) -> Self {
        Self { path: Some(path) }
    }

    fn disarm(&mut self) {
        self.path = None;
    }
}

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

pub(crate) const REMOTE_MUTATION_SCRIPT: &str = r#"
import posix
import sys

# Python 3.10 and earlier do not guarantee that isolated mode removes the
# working directory from sys.path. Remove every common spelling before any
# non-builtin import so workspace modules cannot shadow the standard library.
_nac_cwd = posix.getcwd()
sys.path = [entry for entry in sys.path if entry not in ("", ".", _nac_cwd)]
del _nac_cwd

import base64
import difflib
import fcntl
import hashlib
import json
import os
import stat
from pathlib import Path
import tempfile
import uuid

BUSY = "NAC_FILE_LOCK_BUSY"

def rev(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()

def emit(value, code=0):
    print(json.dumps(value, ensure_ascii=False, indent=2))
    raise SystemExit(code)

def fail(kind, message, **extra):
    value = {"error": kind, "message": message, "committed": False}
    value.update(extra)
    emit(value, 2)
def uncaught_error(error_type, error, traceback):
    if isinstance(error, PermissionError):
        kind = "permission_denied"
    elif isinstance(error, FileNotFoundError):
        kind = "not_found"
    else:
        kind = "io_error"
    print(json.dumps({
        "error": kind,
        "message": str(error),
        "committed": False,
    }, ensure_ascii=False, indent=2))

sys.excepthook = uncaught_error


def normalize(text):
    return text.replace("\r\n", "\n")

def lf_lines(text):
    if not text:
        return []
    parts = text.split("\n")
    lines = [part + "\n" for part in parts[:-1]]
    if parts[-1]:
        lines.append(parts[-1])
    return lines

def decode(data, path):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        fail("io_error", f"file is not valid UTF-8 and cannot be edited: {path}: {exc}")
    bom = text.startswith("\ufeff")
    if bom:
        text = text[1:]
    newline = "\r\n" if "\r\n" in text and text.find("\r\n") <= text.find("\n") else "\n"
    return bom, newline, text, normalize(text)

def original_offset(original, normalized_offset):
    original_index = 0
    normalized_index = 0
    while normalized_index < normalized_offset:
        if original.startswith("\r\n", original_index):
            original_index += 2
        else:
            original_index += 1
        normalized_index += 1
    return original_index

def changed_ranges(old, new):
    matcher = difflib.SequenceMatcher(
        a=lf_lines(old),
        b=lf_lines(new),
        autojunk=False,
    )
    ranges = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        ranges.append({
            "old_start": i1 + 1,
            "old_end": i2 if i2 > i1 else i1,
            "new_start": j1 + 1,
            "new_end": j2 if j2 > j1 else j1,
        })
    return ranges

def unified_diff(old, new, path):
    records = difflib.unified_diff(
        lf_lines(old),
        lf_lines(new),
        fromfile="a/" + path,
        tofile="b/" + path,
        n=3,
    )
    output = []
    for record in records:
        output.append(record)
        if not record.endswith(("\n", "\r")):
            output.append("\n\\ No newline at end of file\n")
    return "".join(output)

def result(path, old, new, old_revision):
    old_text = old.decode("utf-8", errors="replace")
    new_text = new.decode("utf-8", errors="replace")
    return {
        "path": path,
        "old_revision": old_revision,
        "new_revision": rev(new),
        "changed_ranges": changed_ranges(old_text, new_text),
        "diff": unified_diff(old_text, new_text, path),
    }

def lock_target(path):
    resolved = Path(path).expanduser().resolve(strict=False)
    lock_dir = Path(tempfile.gettempdir()) / f"nac-file-locks-{os.geteuid()}"
    lock_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_dir_stat = os.lstat(lock_dir)
    if not stat.S_ISDIR(lock_dir_stat.st_mode) or lock_dir_stat.st_uid != os.geteuid() or lock_dir_stat.st_mode & 0o077:
        fail("permission_denied", f"NAC file-lock directory has unsafe ownership or mode: {lock_dir}")
    key = hashlib.sha256(os.fsencode(str(resolved))).hexdigest()
    lock_path = lock_dir / (key + ".lock")
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    lock_file = os.fdopen(descriptor, "r+b", buffering=0)
    lock_stat = os.fstat(lock_file.fileno())
    if lock_stat.st_uid != os.geteuid() or lock_stat.st_nlink != 1 or lock_stat.st_mode & 0o077:
        fail("permission_denied", f"NAC file lock has unsafe ownership, mode, or link count: {lock_path}")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(BUSY)
        raise SystemExit(75)
    return resolved, lock_file

def default_creation_mode():
    mask = os.umask(0)
    os.umask(mask)
    return 0o666 & ~mask

def publish(
    path,
    old_exists,
    new,
    old_stat,
    output,
    fail_before_publish=False,
    fail_after_publish=False,
):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=".nac-mutation-", suffix=".tmp", dir=path.parent)
    temp_path = Path(temp_name)
    published = False
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as target:
            if old_stat is not None:
                try:
                    os.fchown(target.fileno(), old_stat.st_uid, old_stat.st_gid)
                except PermissionError:
                    current_stat = os.fstat(target.fileno())
                    # A replaceable file can have an owner the caller cannot assign.
                    # Preserve its group when possible and clear affected special bits.
                    if current_stat.st_gid != old_stat.st_gid:
                        try:
                            os.fchown(target.fileno(), -1, old_stat.st_gid)
                        except PermissionError:
                            pass
                current_stat = os.fstat(target.fileno())
                mode = stat.S_IMODE(old_stat.st_mode)
                if current_stat.st_uid != old_stat.st_uid:
                    mode &= ~stat.S_ISUID
                if current_stat.st_gid != old_stat.st_gid:
                    mode &= ~stat.S_ISGID
                os.fchmod(target.fileno(), mode)
            else:
                os.fchmod(target.fileno(), default_creation_mode())
            target.write(new)
            target.flush()
            os.fsync(target.fileno())
        if fail_before_publish:
            raise OSError("injected failure before publication")
        if old_exists:
            os.replace(temp_path, path)
        else:
            try:
                os.link(temp_path, path)
            except FileExistsError:
                fail("already_exists", f"file already exists: {path}; expected_revision null only creates a missing file — read the file and retry write with its revision")
        published = True
        try:
            if fail_after_publish:
                raise OSError("injected failure after publication")
            if not old_exists:
                temp_path.unlink()
            directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        except OSError as exc:
            emit({
                "error": "io_error",
                "message": f"mutation committed for {path}, but durability could not be confirmed: {exc}",
                "committed": True,
                "new_revision": output["new_revision"],
                "durability": "uncertain",
            }, 2)
    finally:
        if not published:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass

payload = json.load(sys.stdin)
original_path = payload["path"]
operation = payload["operation"]
if operation == "read":
    path = Path(payload["resolved_path"]).expanduser()
    try:
        with path.open("rb") as source:
            header = source.read(32)
            extension = path.suffix.lower()
            supported_extension = extension in (".png", ".jpg", ".jpeg", ".jpe", ".jfif", ".gif", ".webp")
            # Transport-only parity with image::guess_format; Rust validates the returned bytes.
            image_signature = (
                header.startswith(b"\x89PNG\r\n\x1a\n")
                or header.startswith(b"\xff\xd8\xff")
                or header.startswith(b"GIF87a")
                or header.startswith(b"GIF89a")
                or (len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP")
                or header.startswith((b"MM\x00*", b"II*\x00", b"DDS ", b"BM", b"\x00\x00\x01\x00"))
                or header.startswith((b"\x23?RADIANCE", b"\x76\x2f\x31\x01", b"qoif", b"farbfeld"))
                or header.startswith((b"P1", b"P2", b"P3", b"P4", b"P5", b"P6", b"P7"))
                or (len(header) >= 12 and header[:2] == b"\x00\x00" and header[4:12] == b"ftypavif")
            )
            if supported_extension or image_signature:
                if not payload.get("image_read", False):
                    fail("unsupported_image", f"the selected model cannot view image files: {original_path}")
                image_limit = 20 * 1024 * 1024
                if path.stat().st_size > image_limit:
                    fail("image_limit_exceeded", f"image exceeds the {image_limit} byte limit: {original_path}")
                source.seek(0)
                data = source.read(image_limit + 1)
                if len(data) > image_limit:
                    fail("image_limit_exceeded", f"image exceeds the {image_limit} byte limit: {original_path}")
                emit({"image_data": base64.b64encode(data).decode("ascii")})
            source.seek(0)
            data = source.read()
    except FileNotFoundError:
        fail("not_found", f"file not found: {original_path}")
    if b"\0" in data[:8192]:
        fail("io_error", f"binary file cannot be read as text: {original_path}")
    text = data.decode("utf-8", errors="replace")
    if text.startswith("\ufeff"):
        text = text[1:]
    text = normalize(text)
    lines = lf_lines(text)
    offset = min(payload["offset"], len(lines))
    selected_end = min(offset + payload["limit"], len(lines))
    content_parts = []
    content_bytes = 0
    end = offset
    truncated = False
    for line in lines[offset:selected_end]:
        encoded_line = line.encode("utf-8")
        if content_bytes + len(encoded_line) <= 30000:
            content_parts.append(line)
            content_bytes += len(encoded_line)
            end += 1
            continue
        if end == offset:
            content_parts.append(encoded_line[:30000].decode("utf-8", errors="ignore"))
            end += 1
            truncated = True
        break
    emit({
        "path": original_path,
        "revision": rev(data),
        "start_line": offset + 1,
        "end_line": end if end > offset else offset,
        "content": "".join(content_parts),
        "next_offset": end if end < len(lines) else None,
        "truncated": truncated,
    })

path, lock_file = lock_target(payload["resolved_path"])
try:
    try:
        old = path.read_bytes()
        old_stat = path.stat()
    except FileNotFoundError:
        old = None
        old_stat = None
    expected = payload.get("expected_revision")
    if operation == "edit":
        if old is None:
            fail("not_found", f"file not found: {original_path}")
        current = rev(old)
        if expected != current:
            fail("stale_revision", f"stale revision for {original_path}; read again", current_revision=current)
        bom, newline, original, normalized = decode(old, original_path)
        spans = []
        edits = payload["edits"]
        if not edits:
            fail("old_text_not_found", "edit requires at least one replacement")
        for edit in edits:
            needle = normalize(edit["old_text"])
            if not needle:
                fail("old_text_not_found", "old_text must not be empty")
            count = normalized.count(needle)
            if count == 0:
                fail("old_text_not_found", f"old_text not found in {original_path}")
            if count > 1:
                fail("old_text_not_unique", f"old_text appears {count} times in {original_path}")
            start = normalized.index(needle)
            spans.append((start, start + len(needle), normalize(edit["new_text"])))
        spans.sort(key=lambda item: item[0])
        for left, right in zip(spans, spans[1:]):
            if left[1] > right[0]:
                fail("overlapping_edits", f"edit ranges overlap in {original_path}")
        for start, end, replacement in reversed(spans):
            start = original_offset(original, start)
            end = original_offset(original, end)
            original = original[:start] + replacement.replace("\n", newline) + original[end:]
        if bom:
            original = "\ufeff" + original
        new = original.encode("utf-8")
    elif operation == "write":
        if expected is None:
            if old is not None:
                fail(
                    "already_exists",
                    f"file already exists: {original_path}; expected_revision null only creates a missing file — read the file and retry write with its revision",
                    current_revision=rev(old),
                )
        else:
            if old is None:
                fail("not_found", f"file not found: {original_path}")
            current = rev(old)
            if expected != current:
                fail("stale_revision", f"stale revision for {original_path}; read again", current_revision=current)
        new = payload["content"].encode("utf-8")
    else:
        fail("io_error", f"unknown mutation operation: {operation}")
    output = result(original_path, old or b"", new, rev(old) if old is not None else None)
    publish(
        path,
        old is not None,
        new,
        old_stat,
        output,
        payload.get("_test_fail_before_publish", False),
        payload.get("_test_fail_after_publish", False),
    )
    emit(output)
finally:
    lock_file.close()
"#;

pub(crate) async fn execute_remote(payload: Value, runtime: &ToolRuntime) -> ToolResult {
    let args = vec![
        "-I".to_string(),
        "-c".to_string(),
        REMOTE_MUTATION_SCRIPT.to_string(),
    ];
    let input = match serde_json::to_vec(&payload) {
        Ok(input) => input,
        Err(error) => {
            return error_tool_result(MutationError::precondition(
                "io_error",
                format!("failed to serialize remote file operation: {error}"),
            ))
        }
    };
    let path_display = payload
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    loop {
        match runtime.backend.exec("python3", &args, Some(&input)).await {
            Ok(output) if remote_file_lock_busy(&output) => {
                tokio::time::sleep(REMOTE_FILE_LOCK_RETRY_INTERVAL).await;
            }
            Ok(output) => {
                let content = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if content.is_empty() {
                    return error_tool_result(MutationError::precondition(
                        "io_error",
                        format!(
                            "remote file operation produced no result: {}",
                            String::from_utf8_lossy(&output.stderr).trim()
                        ),
                    ));
                }
                if output.status.success() {
                    if let Ok(value) = serde_json::from_str::<Value>(&content) {
                        if let Some(encoded) = value.get("image_data").and_then(Value::as_str) {
                            let reservation =
                                match reserve_image_memory(encoded.len().div_ceil(4) * 3) {
                                    Ok(reservation) => reservation,
                                    Err(error) => {
                                        return error_tool_result(MutationError::precondition(
                                            error.code(),
                                            error.message(),
                                        ))
                                    }
                                };
                            let bytes = match BASE64.decode(encoded.as_bytes()) {
                                Ok(bytes) => bytes,
                                Err(_) => {
                                    return error_tool_result(MutationError::precondition(
                                        "invalid_image",
                                        "remote image result is not valid base64",
                                    ))
                                }
                            };
                            let image_path = path_display.clone();
                            let image = match tokio::task::spawn_blocking(move || {
                                ToolImage::validate_reserved(
                                    bytes,
                                    Some(Path::new(&image_path)),
                                    None,
                                    reservation,
                                )
                            })
                            .await
                            {
                                Ok(Ok(image)) => image,
                                Ok(Err(error)) => {
                                    return error_tool_result(MutationError::precondition(
                                        error.code(),
                                        error.message(),
                                    ))
                                }
                                Err(error) => {
                                    return error_tool_result(MutationError::precondition(
                                        "invalid_image",
                                        format!("remote image validation task failed: {error}"),
                                    ))
                                }
                            };
                            let content =
                                ToolContent::from_parts(vec![ToolContentPart::Image(image)])
                                    .expect("one validated image is within result limits");
                            return ToolResult {
                                content,
                                is_error: false,
                            };
                        }
                    }
                }
                return ToolResult {
                    content: content.into(),
                    is_error: !output.status.success(),
                };
            }
            Err(error) => {
                return error_tool_result(MutationError::precondition(
                    "io_error",
                    format!("remote file operation failed: {error}"),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_png() -> Vec<u8> {
        use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
        use std::io::Cursor;

        let source = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
        let mut encoded = Cursor::new(Vec::new());
        source.write_to(&mut encoded, ImageFormat::Png).unwrap();
        encoded.into_inner()
    }

    struct RestorePath(Option<std::ffi::OsString>);

    impl Drop for RestorePath {
        fn drop(&mut self) {
            unsafe {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mounted_reads_preserve_validated_image_content() {
        let root = std::env::temp_dir().join(format!("nac-mounted-image-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("fixture.png"), test_png()).unwrap();

        let result = read_mounted(
            root.clone(),
            PathBuf::from("fixture.png"),
            "fixture.png".to_string(),
            0,
            10,
            true,
        )
        .await;
        assert!(!result.is_error, "{}", result.content);
        assert!(matches!(
            result.content.parts().unwrap(),
            [ToolContentPart::Image(image)] if image.mime_type().as_str() == "image/png"
        ));

        let rejected = read_mounted(
            root.clone(),
            PathBuf::from("fixture.png"),
            "fixture.png".to_string(),
            0,
            10,
            false,
        )
        .await;
        assert!(rejected.is_error);
        assert!(rejected.content.contains("unsupported_image"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn revision_hashes_complete_bytes() {
        assert_eq!(
            revision(b"\xef\xbb\xbfline\r\n"),
            "sha256:54a87ac536597128c9da6728f82567e5c08ed5f33c69366eec7136066cdab44b"
        );
    }

    #[test]
    fn oversized_line_is_explicitly_truncated_without_quadratic_rebuilds() {
        let mut bytes = vec![b'a'; MAX_READ_OUTPUT_BYTES + 100];
        bytes.extend_from_slice(b"\nnext\n");
        let result = read_result("fixture.txt".into(), &bytes, 0, 20).unwrap();
        assert_eq!(result.content.len(), MAX_READ_OUTPUT_BYTES);
        assert!(result.truncated);
        assert_eq!(result.end_line, 1);
        assert_eq!(result.next_offset, Some(1));
    }

    #[cfg(unix)]
    #[test]
    fn metadata_preservation_does_not_require_recreating_a_foreign_owner() {
        let dir = std::env::temp_dir().join(format!("nac-metadata-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        let file = File::create(&path).unwrap();
        let foreign_metadata = fs::metadata("/dev/null").unwrap();

        preserve_metadata(&file, &foreign_metadata).unwrap();

        let published_metadata = file.metadata().unwrap();
        assert_eq!(
            published_metadata.mode() & 0o7777,
            foreign_metadata.mode() & 0o7777
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn batched_edits_match_one_original_and_preserve_crlf_bom() {
        let old = b"\xef\xbb\xbffirst = 1\r\nsecond = 1\r\n";
        let new = apply_edits(
            "fixture.txt",
            old,
            &[
                EditSpec {
                    old_text: "first = 1".into(),
                    new_text: "first = 2".into(),
                },
                EditSpec {
                    old_text: "second = 1".into(),
                    new_text: "second = 2\nthird = 3".into(),
                },
            ],
        )
        .unwrap();
        assert_eq!(new, b"\xef\xbb\xbffirst = 2\r\nsecond = 2\r\nthird = 3\r\n");
    }

    #[test]
    fn edit_preserves_untouched_mixed_line_endings() {
        let old = b"alpha\r\nbeta\ngamma\r\n";
        let new = apply_edits(
            "fixture.txt",
            old,
            &[EditSpec {
                old_text: "beta".into(),
                new_text: "changed".into(),
            }],
        )
        .unwrap();
        assert_eq!(new, b"alpha\r\nchanged\ngamma\r\n");
    }

    #[test]
    fn overlapping_edits_are_rejected() {
        let error = apply_edits(
            "fixture.txt",
            b"abcdef",
            &[
                EditSpec {
                    old_text: "abcd".into(),
                    new_text: "x".into(),
                },
                EditSpec {
                    old_text: "cdef".into(),
                    new_text: "y".into(),
                },
            ],
        )
        .unwrap_err();
        assert_eq!(error.error, "overlapping_edits");
    }

    #[tokio::test]
    async fn stale_edit_preserves_original() {
        let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        fs::write(&path, "before").unwrap();
        let result = edit_local(
            path.clone(),
            "file.txt".into(),
            revision(b"different"),
            vec![EditSpec {
                old_text: "before".into(),
                new_text: "after".into(),
            }],
        )
        .await;
        assert!(result.is_error);
        assert!(
            result.content.contains("stale_revision"),
            "{}",
            result.content
        );
        assert_eq!(fs::read(&path).unwrap(), b"before");
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn create_only_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        let first = write_local(path.clone(), "file.txt".into(), "first".into(), None).await;
        let second = write_local(path.clone(), "file.txt".into(), "second".into(), None).await;
        assert!(!first.is_error);
        assert!(second.is_error);
        assert!(second.content.contains("already_exists"));
        assert_eq!(fs::read(&path).unwrap(), b"first");
        let _ = fs::remove_dir_all(dir);
    }
    #[tokio::test]
    async fn concurrent_create_only_calls_have_one_winner() {
        let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        let first = write_local(path.clone(), "file.txt".into(), "first".into(), None);
        let second = write_local(path.clone(), "file.txt".into(), "second".into(), None);
        let (first, second) = tokio::join!(first, second);
        assert_ne!(first.is_error, second.is_error);
        let loser = if first.is_error { &first } else { &second };
        assert!(
            loser.content.contains("already_exists"),
            "{}",
            loser.content
        );
        let content = fs::read_to_string(&path).unwrap();
        assert!(content == "first" || content == "second");
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn failure_after_temp_sync_preserves_original_and_cleans_temp() {
        let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        fs::write(&path, "before").unwrap();
        fail_once_before_publish(&path.canonicalize().unwrap());
        let result = write_local(
            path.clone(),
            "file.txt".into(),
            "after".into(),
            Some(revision(b"before")),
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("injected failure"));
        assert_eq!(fs::read(&path).unwrap(), b"before");
        let temp_count = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".nac-mutation-")
            })
            .count();
        assert_eq!(temp_count, 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mounted_mutation_never_follows_a_swapped_parent_symlink() {
        use std::os::unix::fs::symlink;

        let dir = std::env::temp_dir().join(format!("nac-mounted-mutation-{}", Uuid::new_v4()));
        let root = dir.join("mount");
        let outside = dir.join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        let result = write_mounted(
            root,
            PathBuf::from("escape/file.txt"),
            "escape/file.txt".into(),
            "forbidden".into(),
            None,
        )
        .await;
        assert!(result.is_error);
        assert!(!outside.join("file.txt").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mounted_revisioned_write_does_not_create_parents_for_a_missing_target() {
        let root = std::env::temp_dir().join(format!("nac-mounted-mutation-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let result = write_mounted(
            root.clone(),
            PathBuf::from("missing/nested/file.txt"),
            "missing/nested/file.txt".into(),
            "replacement".into(),
            Some(revision(b"before")),
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("not_found"), "{}", result.content);
        assert!(!root.join("missing").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn concurrent_same_revision_edits_serialize_and_one_goes_stale() {
        let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        fs::write(&path, "value = 1\n").unwrap();
        let expected = revision(b"value = 1\n");
        let first = edit_local(
            path.clone(),
            "file.txt".into(),
            expected.clone(),
            vec![EditSpec {
                old_text: "value = 1".into(),
                new_text: "value = 2".into(),
            }],
        );
        let second = edit_local(
            path.clone(),
            "file.txt".into(),
            expected,
            vec![EditSpec {
                old_text: "value = 1".into(),
                new_text: "value = 3".into(),
            }],
        );
        let (first, second) = tokio::join!(first, second);
        assert_ne!(first.is_error, second.is_error);
        let stale = if first.is_error { &first } else { &second };
        assert!(
            stale.content.contains("stale_revision"),
            "{}",
            stale.content
        );
        let content = fs::read_to_string(&path).unwrap();
        assert!(content == "value = 2\n" || content == "value = 3\n");
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn aborting_awaiter_does_not_release_inflight_mutation_lock() {
        let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        fs::write(&path, "before").unwrap();
        let target = path.canonicalize().unwrap();
        let (entered, release) = gate_before_publish(target);
        let first_path = path.clone();
        let first = tokio::spawn(async move {
            write_local(
                first_path,
                "file.txt".into(),
                "first".into(),
                Some(revision(b"before")),
            )
            .await
        });
        tokio::task::spawn_blocking(move || entered.recv().unwrap())
            .await
            .unwrap();
        first.abort();
        let second_path = path.clone();
        let mut second = tokio::spawn(async move {
            write_local(
                second_path,
                "file.txt".into(),
                "second".into(),
                Some(revision(b"before")),
            )
            .await
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut second)
                .await
                .is_err(),
            "contender acquired the lock while the cancelled awaiter's I/O was live"
        );
        release.send(()).unwrap();
        let second = second.await.unwrap();
        assert!(second.is_error);
        assert!(
            second.content.contains("stale_revision"),
            "{}",
            second.content
        );
        assert_eq!(fs::read(&path).unwrap(), b"first");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn mutation_process_helper() {
        let Some(target) = std::env::var_os("NAC_TEST_MUTATION_TARGET") else {
            return;
        };
        let ready = PathBuf::from(std::env::var_os("NAC_TEST_MUTATION_READY").unwrap());
        let target = PathBuf::from(target);
        let resolved = target.canonicalize().unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let lock = runtime.block_on(acquire_path_lock(&resolved)).unwrap();
        fs::write(&ready, b"ready").unwrap();
        std::thread::sleep(Duration::from_millis(100));
        mutate_locked(
            resolved,
            "file.txt".into(),
            MutationRequest::Write {
                expected_revision: Some(revision(b"before")),
                content: "child".into(),
            },
            lock,
        )
        .unwrap();
    }

    #[tokio::test]
    async fn cross_process_mutations_serialize_and_stale_loser_cannot_continue() {
        use std::process::{Command, Stdio};

        let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        let ready = dir.join("ready");
        fs::write(&path, "before").unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tools::mutation::tests::mutation_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_MUTATION_TARGET", &path)
            .env("NAC_TEST_MUTATION_READY", &ready)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        for _ in 0..200 {
            if ready.exists() {
                break;
            }
            assert!(
                child.try_wait().unwrap().is_none(),
                "mutation helper exited early"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(
            ready.exists(),
            "mutation helper never acquired its sidecar lock"
        );
        let loser = write_local(
            path.clone(),
            "file.txt".into(),
            "parent".into(),
            Some(revision(b"before")),
        )
        .await;
        assert!(child.wait().unwrap().success());
        assert!(loser.is_error);
        assert!(
            loser.content.contains("stale_revision"),
            "{}",
            loser.content
        );
        assert_eq!(fs::read(&path).unwrap(), b"child");
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn non_mounted_podman_backend_runs_revisioned_create_and_edit() {
        use std::os::unix::fs::PermissionsExt;

        let _environment = crate::TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original_path = std::env::var_os("PATH");
        let _restore = RestorePath(original_path.clone());
        let dir = std::env::temp_dir().join(format!("nac-fake-podman-{}", Uuid::new_v4()));
        let bin = dir.join("bin");
        let workspace = dir.join("workspace");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        let fake_podman = bin.join("podman");
        fs::write(
            &fake_podman,
            "#!/bin/sh\nshift\ncwd='.'\nwhile [ \"$#\" -gt 0 ]; do\n  case \"$1\" in\n    --workdir) cwd=$2; shift 2 ;;\n    --env) export \"$2\"; shift 2 ;;\n    -i|-t) shift ;;\n    *) shift; break ;;\n  esac\ndone\ncd \"$cwd\" || exit 125\nexec \"$@\"\n",
        )
        .unwrap();
        fs::set_permissions(&fake_podman, fs::Permissions::from_mode(0o755)).unwrap();
        let mut paths = vec![bin.clone()];
        if let Some(path) = original_path.as_ref() {
            paths.extend(std::env::split_paths(path));
        }
        unsafe {
            std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
        }
        let sandbox = crate::sandbox::SandboxSession::new_for_test(crate::sandbox::SandboxSpec {
            workdir: workspace.clone(),
            shm_size: Some("0".to_string()),
            ..Default::default()
        });
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = workspace.clone();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(Some(sandbox), &workspace);
        let create = crate::tools::write::execute(
            json!({
                "path":"file.txt",
                "content":"alpha = 1\nbeta = 1\n",
                "expected_revision":null
            }),
            &runtime,
        )
        .await;
        assert!(!create.is_error, "{}", create.content);
        let read = crate::tools::read::execute(json!({"path":"file.txt"}), &runtime, false).await;
        assert!(!read.is_error, "{}", read.content);
        let read_value: Value =
            serde_json::from_str(read.content.as_text().expect("text tool result")).unwrap();
        let edit = crate::tools::edit::execute(
            json!({
                "path":"file.txt",
                "expected_revision":read_value["revision"],
                "edits":[
                    {"old_text":"alpha = 1", "new_text":"alpha = 2"},
                    {"old_text":"beta = 1", "new_text":"beta = 2"}
                ]
            }),
            &runtime,
        )
        .await;
        assert!(!edit.is_error, "{}", edit.content);
        assert_eq!(
            fs::read_to_string(workspace.join("file.txt")).unwrap(),
            "alpha = 2\nbeta = 2\n"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "current_thread")]
    #[allow(clippy::await_holding_lock)]
    async fn ssh_execution_backend_discovers_revision_and_runs_batched_edit() {
        use std::os::unix::fs::PermissionsExt;

        let _environment = crate::TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original_path = std::env::var_os("PATH");
        let _restore = RestorePath(original_path.clone());
        let dir = std::env::temp_dir().join(format!("nac-fake-ssh-{}", Uuid::new_v4()));
        let bin = dir.join("bin");
        let workspace = dir.join("workspace");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        let fake_ssh = bin.join("ssh");
        fs::write(
            &fake_ssh,
            "#!/bin/sh\ncommand=''\nfor argument in \"$@\"; do command=$argument; done\nexec /bin/sh -c \"$command\"\n",
        )
        .unwrap();
        fs::set_permissions(&fake_ssh, fs::Permissions::from_mode(0o755)).unwrap();
        let mut paths = vec![bin.clone()];
        if let Some(path) = original_path.as_ref() {
            paths.extend(std::env::split_paths(path));
        }
        unsafe {
            std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
        }
        fs::write(workspace.join("file.txt"), "alpha = 1\nbeta = 1\n").unwrap();
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = workspace.clone();
        runtime.backend = crate::sandbox::ExecutionBackend::Ssh(crate::sandbox::SshBackend::new(
            "fake-host".into(),
            workspace.clone(),
        ))
        .into();
        fs::write(workspace.join("fixture.png"), test_png()).unwrap();
        let image =
            crate::tools::read::execute(json!({"path":"fixture.png"}), &runtime, true).await;
        assert!(!image.is_error, "{}", image.content);
        assert!(matches!(
            image.content.parts().unwrap(),
            [ToolContentPart::Image(image)] if image.mime_type().as_str() == "image/png"
        ));
        fs::write(workspace.join("unsupported.bmp"), b"BMunsupported").unwrap();
        let unsupported =
            crate::tools::read::execute(json!({"path":"unsupported.bmp"}), &runtime, true).await;
        assert!(unsupported.is_error);
        assert!(unsupported.content.contains("invalid_image"));
        fs::write(
            workspace.join("difflib.py"),
            "raise RuntimeError('workspace module imported')\n",
        )
        .unwrap();
        let read = crate::tools::read::execute(json!({"path":"file.txt"}), &runtime, false).await;
        assert!(!read.is_error, "{}", read.content);
        let read_value: Value =
            serde_json::from_str(read.content.as_text().expect("text tool result")).unwrap();
        let edit = crate::tools::edit::execute(
            json!({
                "path":"file.txt",
                "expected_revision":read_value["revision"],
                "edits":[
                    {"old_text":"alpha = 1", "new_text":"alpha = 2"},
                    {"old_text":"beta = 1", "new_text":"beta = 2"}
                ]
            }),
            &runtime,
        )
        .await;
        assert!(!edit.is_error, "{}", edit.content);
        assert_eq!(
            fs::read_to_string(workspace.join("file.txt")).unwrap(),
            "alpha = 2\nbeta = 2\n"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn remote_read_matches_local_lf_only_pagination() {
        use std::process::{Command, Stdio};

        let dir = std::env::temp_dir().join(format!("nac-remote-read-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        let bytes = "first\ronly\u{2028}same\nsecond\r\nthird".as_bytes();
        fs::write(&path, bytes).unwrap();
        let local = read_result("file.txt".into(), bytes, 1, 2).unwrap();
        let payload = json!({
            "operation": "read",
            "path": "file.txt",
            "resolved_path": path,
            "offset": 1,
            "limit": 2
        });

        let remote = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
        assert!(
            remote.status.success(),
            "{}",
            String::from_utf8_lossy(&remote.stderr)
        );
        let remote: Value = serde_json::from_slice(&remote.stdout).unwrap();
        assert_eq!(remote["content"], local.content);
        assert_eq!(remote["start_line"], local.start_line);
        assert_eq!(remote["end_line"], local.end_line);
        assert_eq!(remote["next_offset"], json!(local.next_offset));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn remote_protocol_removes_workspace_from_import_path_without_safe_path_support() {
        use std::process::{Command, Stdio};

        let workspace =
            std::env::temp_dir().join(format!("nac-remote-import-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        let path = workspace.join("file.txt");
        fs::write(&path, b"safe\n").unwrap();
        for module in [
            "difflib.py",
            "fcntl.py",
            "hashlib.py",
            "json.py",
            "os.py",
            "pathlib.py",
            "stat.py",
            "tempfile.py",
            "uuid.py",
        ] {
            fs::write(
                workspace.join(module),
                "raise RuntimeError('workspace module imported')\n",
            )
            .unwrap();
        }
        let payload = json!({
            "operation": "read",
            "path": "file.txt",
            "resolved_path": path,
            "offset": 0,
            "limit": 20
        });
        let mut child = Command::new("python3")
            .args(["-c", REMOTE_MUTATION_SCRIPT])
            .current_dir(&workspace)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(&payload).unwrap())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "stdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["content"], "safe\n");
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn remote_protocol_reads_and_applies_a_batched_edit() {
        use std::process::{Command, Stdio};

        let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        fs::write(&path, b"\xef\xbb\xbfalpha = 1\r\nbeta = 1\r\n").unwrap();
        let read_payload = json!({
            "operation": "read",
            "path": "file.txt",
            "resolved_path": path,
            "offset": 0,
            "limit": 20
        });
        let read = run_python_protocol(&read_payload, &mut Command::new("python3"), Stdio::piped());
        assert!(
            read.status.success(),
            "{}",
            String::from_utf8_lossy(&read.stderr)
        );
        let read_value: Value = serde_json::from_slice(&read.stdout).unwrap();
        let edit_payload = json!({
            "operation": "edit",
            "path": "file.txt",
            "resolved_path": path,
            "expected_revision": read_value["revision"],
            "edits": [
                {"old_text": "alpha = 1", "new_text": "alpha = 2"},
                {"old_text": "beta = 1", "new_text": "beta = 2\nthird = 3"}
            ]
        });
        let edit = run_python_protocol(&edit_payload, &mut Command::new("python3"), Stdio::piped());
        assert!(
            edit.status.success(),
            "{}",
            String::from_utf8_lossy(&edit.stderr)
        );
        let edit_value: Value = serde_json::from_slice(&edit.stdout).unwrap();
        assert_eq!(
            edit_value["new_revision"],
            revision(b"\xef\xbb\xbfalpha = 2\r\nbeta = 2\r\nthird = 3\r\n")
        );
        assert_eq!(
            fs::read(&path).unwrap(),
            b"\xef\xbb\xbfalpha = 2\r\nbeta = 2\r\nthird = 3\r\n"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn remote_edit_preserves_untouched_mixed_line_endings() {
        use std::process::{Command, Stdio};

        let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        let old = b"alpha\r\nbeta\ngamma\r\n";
        fs::write(&path, old).unwrap();
        let payload = json!({
            "operation": "edit",
            "path": "file.txt",
            "resolved_path": path,
            "expected_revision": revision(old),
            "edits": [{"old_text": "beta", "new_text": "changed"}]
        });
        let output = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(fs::read(&path).unwrap(), b"alpha\r\nchanged\ngamma\r\n");
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn remote_metadata_preservation_does_not_require_recreating_a_foreign_owner() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        use std::process::Command;

        let foreign_metadata = fs::metadata("/dev/null").unwrap();
        if foreign_metadata.uid() == unsafe { libc::geteuid() } {
            return;
        }
        let dir = std::env::temp_dir().join(format!("nac-remote-metadata-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        fs::write(&path, b"before").unwrap();
        let definitions = REMOTE_MUTATION_SCRIPT
            .split_once("payload = json.load(sys.stdin)")
            .unwrap()
            .0;
        let script = format!(
            "{definitions}\npath = Path(sys.argv[1])\nold_stat = os.stat('/dev/null')\n\
             publish(path, True, b'after', old_stat, {{'new_revision': rev(b'after')}})\n"
        );

        let output = Command::new("python3")
            .args(["-I", "-c", &script])
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "stdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(fs::read(&path).unwrap(), b"after");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o7777,
            foreign_metadata.mode() & 0o7777
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn remote_create_uses_normal_umask_filtered_permissions() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::{Command, Stdio};

        let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let probe = dir.join("probe.txt");
        fs::write(&probe, b"").unwrap();
        let expected_mode = fs::metadata(&probe).unwrap().permissions().mode() & 0o777;
        let path = dir.join("created.txt");
        let payload = json!({
            "operation": "write",
            "path": "created.txt",
            "resolved_path": path,
            "expected_revision": null,
            "content": "created\n"
        });
        let output = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            expected_mode
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn remote_result_reports_final_newline_only_changes() {
        use std::process::{Command, Stdio};

        let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        fs::write(&path, b"line").unwrap();
        let payload = json!({
            "operation": "write",
            "path": "file.txt",
            "resolved_path": path,
            "expected_revision": revision(b"line"),
            "content": "line\n"
        });
        let output = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(!value["changed_ranges"].as_array().unwrap().is_empty());
        assert!(value["diff"]
            .as_str()
            .unwrap()
            .contains("\\ No newline at end of file"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn remote_post_publication_failure_reports_committed_revision() {
        use std::process::{Command, Stdio};

        let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        let payload = json!({
            "operation": "write",
            "path": "file.txt",
            "resolved_path": path,
            "expected_revision": null,
            "content": "created",
            "_test_fail_after_publish": true
        });
        let output = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
        assert!(!output.status.success());
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["committed"], true);
        assert_eq!(value["new_revision"], revision(b"created"));
        assert_eq!(fs::read(&path).unwrap(), b"created");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn remote_failure_before_publish_preserves_original_and_cleans_temp() {
        let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        fs::write(&path, b"before").unwrap();
        let payload = json!({
            "operation": "write",
            "path": "file.txt",
            "resolved_path": path,
            "expected_revision": revision(b"before"),
            "content": "after",
            "_test_fail_before_publish": true
        });
        let output = run_python_protocol(
            &payload,
            &mut std::process::Command::new("python3"),
            std::process::Stdio::piped(),
        );
        assert!(!output.status.success());
        let value: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["error"], "io_error");
        assert_eq!(fs::read(&path).unwrap(), b"before");
        let temp_count = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".nac-mutation-")
            })
            .count();
        assert_eq!(temp_count, 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn worker_definitions_advertise_revisioned_batched_contract() {
        let definitions = crate::tools::worker_tool_definitions(false);
        let edit = definitions
            .iter()
            .find(|definition| definition.function.name == "edit")
            .unwrap();
        assert_eq!(
            edit.function.parameters["required"],
            json!(["path", "expected_revision", "edits"])
        );
        assert_eq!(
            edit.function.parameters["properties"]["edits"]["type"],
            "array"
        );
        let write = definitions
            .iter()
            .find(|definition| definition.function.name == "write")
            .unwrap();
        assert_eq!(
            write.function.parameters["required"],
            json!(["path", "content", "expected_revision"])
        );
        assert_eq!(
            write.function.parameters["properties"]["expected_revision"]["type"],
            json!(["string", "null"])
        );
    }

    fn run_python_protocol(
        payload: &Value,
        command: &mut std::process::Command,
        stdin: std::process::Stdio,
    ) -> std::process::Output {
        command
            .arg("-I")
            .arg("-c")
            .arg(REMOTE_MUTATION_SCRIPT)
            .stdin(stdin)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = command.spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(payload).unwrap())
            .unwrap();
        child.wait_with_output().unwrap()
    }
}
