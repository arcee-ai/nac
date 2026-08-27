use super::*;

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
    resolved = os.path.normpath(os.path.abspath(os.path.expanduser(path)))
    lock_dir = Path(tempfile.gettempdir()) / f"nac-file-locks-{os.geteuid()}"
    lock_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_dir_stat = os.lstat(lock_dir)
    if not stat.S_ISDIR(lock_dir_stat.st_mode) or lock_dir_stat.st_uid != os.geteuid() or lock_dir_stat.st_mode & 0o077:
        fail("permission_denied", f"NAC file-lock directory has unsafe ownership or mode: {lock_dir}")
    key = hashlib.sha256(os.fsencode(resolved)).hexdigest()
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

def open_parent(path, create=False):
    path = os.fspath(path)
    if not os.path.isabs(path):
        fail("permission_denied", f"remote native file path is not absolute: {path}")
    components = [component for component in path.split("/") if component]
    if not components:
        fail("permission_denied", "remote native file path has no final component")
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open("/", flags)
    try:
        for component in components[:-1]:
            try:
                child = os.open(component, flags, dir_fd=descriptor)
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(component, mode=0o777, dir_fd=descriptor)
                except FileExistsError:
                    pass
                child = os.open(component, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor, components[-1]
    except BaseException:
        os.close(descriptor)
        raise

def open_bound(path, flags):
    parent, name = open_parent(path)
    try:
        descriptor = os.open(name, flags | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent)
        return descriptor
    finally:
        os.close(parent)

def default_creation_mode():
    mask = os.umask(0)
    os.umask(mask)
    return 0o666 & ~mask

def publish_bound(
    parent,
    name,
    path,
    old_exists,
    new,
    old_stat,
    output,
    fail_before_publish=False,
    fail_after_publish=False,
):
    path = os.fspath(path)
    temp_name = ".nac-mutation-" + uuid.uuid4().hex + ".tmp"
    descriptor = os.open(
        temp_name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
        dir_fd=parent,
    )
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
            os.replace(temp_name, name, src_dir_fd=parent, dst_dir_fd=parent)
        else:
            try:
                os.link(
                    temp_name,
                    name,
                    src_dir_fd=parent,
                    dst_dir_fd=parent,
                    follow_symlinks=False,
                )
            except FileExistsError:
                fail("already_exists", f"file already exists: {path}; expected_revision null only creates a missing file — read the file and retry write with its revision")
        published = True
        try:
            if fail_after_publish:
                raise OSError("injected failure after publication")
            if not old_exists:
                os.unlink(temp_name, dir_fd=parent)
            os.fsync(parent)
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
                os.unlink(temp_name, dir_fd=parent)
            except FileNotFoundError:
                pass

def publish(path, old_exists, new, old_stat, output, fail_before_publish=False, fail_after_publish=False):
    parent, name = open_parent(path, create=True)
    try:
        publish_bound(
            parent,
            name,
            path,
            old_exists,
            new,
            old_stat,
            output,
            fail_before_publish,
            fail_after_publish,
        )
    finally:
        os.close(parent)

payload = json.load(sys.stdin)
original_path = payload["path"]
operation = payload["operation"]
if operation == "read":
    path = os.path.normpath(os.path.abspath(os.path.expanduser(payload["resolved_path"])))
    try:
        descriptor = open_bound(path, os.O_RDONLY)
        with os.fdopen(descriptor, "rb", closefd=True) as source:
            header = source.read(32)
            extension = os.path.splitext(path)[1].lower()
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
                if os.fstat(source.fileno()).st_size > image_limit:
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
parent = None
try:
    parent, name = open_parent(
        path,
        create=operation == "write" and payload.get("expected_revision") is None,
    )
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=parent,
        )
        with os.fdopen(descriptor, "rb", closefd=True) as source:
            old_stat = os.fstat(source.fileno())
            old = source.read()
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
    publish_bound(
        parent,
        name,
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
    if parent is not None:
        os.close(parent)
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
