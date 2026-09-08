use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::sandbox::{FileIoMode, HostPathResolution};
#[cfg(not(unix))]
use crate::tools::mutation::read_opened_file;
use crate::tools::mutation::{argument_error, execute_remote, read_error, read_mounted};
use crate::tools::{resolve_workspace_path, ToolResult, ToolRuntime};
use crate::types::{FunctionDef, ToolDefinition};

const DEFAULT_LIMIT: usize = 2_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadInput {
    path: String,
    offset: usize,
    limit: usize,
    authorized_path_bound: bool,
}

impl ReadInput {
    #[allow(dead_code, reason = "native callers use this without model JSON")]
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            offset: 0,
            limit: DEFAULT_LIMIT,
            authorized_path_bound: false,
        }
    }

    pub fn with_range(
        path: impl Into<String>,
        offset: usize,
        limit: usize,
    ) -> Result<Self, ToolResult> {
        if limit == 0 {
            return Err(argument_error("'limit' must be greater than zero"));
        }
        Ok(Self {
            path: path.into(),
            offset,
            limit,
            authorized_path_bound: false,
        })
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub(crate) fn bind_authorized_path(&mut self, path: &str) {
        self.path = path.to_string();
        self.authorized_path_bound = true;
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadWireInput {
    path: String,
    #[serde(default)]
    offset: usize,
    limit: Option<usize>,
}

pub fn definition(image_read: bool) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "read".to_string(),
            description: if image_read {
                "Read and view UTF-8 text or supported PNG, JPEG, WebP, and static GIF image files. Text results include complete-file revision metadata; pass next_offset to continue text files."
            } else {
                "Read UTF-8 file content and return JSON metadata including the complete-file revision. Pass next_offset to continue."
            }
            .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "offset": { "type": "integer", "minimum": 0, "description": "Zero-based line offset (optional; text files only)" },
                    "limit": { "type": "integer", "minimum": 1, "description": "Maximum lines to read (optional, default 2000; text files only)" }
                },
                "required": ["path"],
                "additionalProperties": false
            }),
        },
    }
}

pub(crate) fn decode(input: Value) -> Result<ReadInput, ToolResult> {
    let wire: ReadWireInput = serde_json::from_value(input)
        .map_err(|error| argument_error(format!("invalid read arguments: {error}")))?;
    ReadInput::with_range(wire.path, wire.offset, wire.limit.unwrap_or(DEFAULT_LIMIT))
}

#[cfg(test)]
pub async fn execute(args: Value, runtime: &ToolRuntime, image_read: bool) -> ToolResult {
    let input = match decode(args) {
        Ok(input) => input,
        Err(error) => return error,
    };
    execute_native(input, runtime, image_read).await
}

pub async fn execute_native(
    input: ReadInput,
    runtime: &ToolRuntime,
    image_read: bool,
) -> ToolResult {
    let ReadInput {
        path,
        offset,
        limit,
        authorized_path_bound,
    } = input;

    if runtime.backend.file_io() == FileIoMode::RemoteExec {
        let guest_path = match runtime.backend.resolve_path(&path) {
            Ok(path) => path,
            Err(error) => return argument_error(error.to_string()),
        };
        if let HostPathResolution::Mapped(host_path) =
            runtime.backend.host_path_for_remote_file(&guest_path)
        {
            if host_path.relative.as_os_str().is_empty() {
                return read_local(host_path.root, path, offset, limit, image_read).await;
            }
            return read_mounted(
                host_path.root,
                host_path.relative,
                path,
                offset,
                limit,
                image_read,
            )
            .await;
        }
        return execute_remote(
            json!({
                "operation": "read",
                "path": path,
                "resolved_path": guest_path.display().to_string(),
                "offset": offset,
                "limit": limit,
                "image_read": image_read,
            }),
            runtime,
        )
        .await;
    }

    let local_path = resolve_workspace_path(runtime, PathBuf::from(&path));
    if authorized_path_bound {
        read_local_bound(local_path, path, offset, limit, image_read).await
    } else {
        read_local(local_path, path, offset, limit, image_read).await
    }
}

async fn read_local(
    path: PathBuf,
    path_display: String,
    offset: usize,
    limit: usize,
    image_read: bool,
) -> ToolResult {
    let bound = match tokio::task::spawn_blocking(move || {
        crate::tools::mutation::resolve_target_path(&path)
    })
    .await
    {
        Ok(Ok(path)) => path,
        Ok(Err(error)) => return read_error(&path_display, error),
        Err(error) => return argument_error(format!("file path resolution failed: {error}")),
    };
    read_local_bound(bound, path_display, offset, limit, image_read).await
}

async fn read_local_bound(
    path: PathBuf,
    path_display: String,
    offset: usize,
    limit: usize,
    image_read: bool,
) -> ToolResult {
    #[cfg(unix)]
    {
        let relative = match path.strip_prefix(std::path::Path::new("/")) {
            Ok(relative) if !relative.as_os_str().is_empty() => relative.to_path_buf(),
            _ => {
                return argument_error(format!(
                    "safe local file reads require an absolute file path: {path_display}"
                ))
            }
        };
        read_mounted(
            PathBuf::from("/"),
            relative,
            path_display,
            offset,
            limit,
            image_read,
        )
        .await
    }
    #[cfg(not(unix))]
    {
        let display_for_task = path_display.clone();
        match tokio::task::spawn_blocking(move || {
            let file = std::fs::File::open(path)?;
            Ok::<_, std::io::Error>(read_opened_file(
                file,
                display_for_task,
                offset,
                limit,
                image_read,
            ))
        })
        .await
        {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => read_error(&path_display, error),
            Err(error) => {
                argument_error(format!("file read task failed for {path_display}: {error}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {

    use serde_json::{json, Value};
    use uuid::Uuid;

    use super::*;
    use crate::tools::test_runtime;
    use crate::types::ToolContentPart;
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;

    fn image_bytes(format: ImageFormat) -> Vec<u8> {
        let image = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, format).unwrap();
        bytes.into_inner()
    }

    #[tokio::test]
    async fn read_returns_complete_file_revision_and_range_metadata() {
        let dir = std::env::temp_dir().join(format!("nac-read-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fixture.txt");
        std::fs::write(&path, b"one\r\ntwo\r\nthree\r\n").unwrap();
        let mut runtime = test_runtime();
        runtime.workspace_cwd = dir.clone();
        let result = execute(
            json!({"path":"fixture.txt", "offset":1, "limit":1}),
            &runtime,
            false,
        )
        .await;
        assert!(!result.is_error, "{}", result.content);
        let value: Value =
            serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
        assert_eq!(value["path"], "fixture.txt");
        assert_eq!(value["content"], "two\n");
        assert_eq!(value["start_line"], 2);
        assert_eq!(value["end_line"], 2);
        assert_eq!(value["next_offset"], 2);
        assert_eq!(
            value["revision"],
            crate::tools::mutation::revision(b"one\r\ntwo\r\nthree\r\n")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn missing_file_is_categorized() {
        let result = execute(
            json!({"path": format!("missing-{}", Uuid::new_v4())}),
            &test_runtime(),
            false,
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("not_found"));
    }
    #[tokio::test]
    async fn image_read_is_capability_gated_for_png_and_jpeg() {
        for (extension, format, expected_mime) in [
            ("png", ImageFormat::Png, "image/png"),
            ("jpg", ImageFormat::Jpeg, "image/jpeg"),
        ] {
            let dir = std::env::temp_dir().join(format!("nac-read-image-{}", Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let name = format!("fixture.{extension}");
            std::fs::write(dir.join(&name), image_bytes(format)).unwrap();
            let mut runtime = test_runtime();
            runtime.workspace_cwd = dir.clone();

            let capable = execute(json!({"path": name}), &runtime, true).await;
            assert!(!capable.is_error, "{}", capable.content);
            let parts = capable.content.parts().expect("typed image result");
            assert_eq!(parts.len(), 1);
            let ToolContentPart::Image(image) = &parts[0] else {
                panic!("expected image content");
            };
            assert_eq!(image.mime_type().as_str(), expected_mime);

            let text_only = execute(json!({"path": name}), &runtime, false).await;
            assert!(text_only.is_error);
            assert!(text_only.content.contains("unsupported_image"));
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[tokio::test]
    async fn malformed_and_unsupported_images_return_deterministic_errors() {
        let dir = std::env::temp_dir().join(format!("nac-read-invalid-image-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("broken.png"), b"\x89PNG\r\n\x1a\nbroken").unwrap();
        std::fs::write(dir.join("unsupported.bmp"), b"BMunsupported").unwrap();
        let mut runtime = test_runtime();
        runtime.workspace_cwd = dir.clone();

        for name in ["broken.png", "unsupported.bmp"] {
            let result = execute(json!({"path": name}), &runtime, true).await;
            assert!(result.is_error);
            assert!(
                result.content.contains("invalid_image"),
                "{}",
                result.content
            );
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn offset_and_limit_validation_is_strict() {
        assert!(decode(json!({"path":"file", "offset":-1})).is_err());
        assert!(decode(json!({"path":"file", "limit":0})).is_err());
        let defaults = decode(json!({"path":"file"})).unwrap();
        assert_eq!(defaults.offset, 0);
        assert_eq!(defaults.limit, DEFAULT_LIMIT);
    }
}
