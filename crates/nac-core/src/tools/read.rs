use std::path::PathBuf;

use serde_json::{json, Value};

use crate::sandbox::{FileIoMode, HostPathResolution};
use crate::tools::mutation::{
    argument_error, execute_remote, read_error, read_mounted, read_opened_file, required_string,
};
use crate::tools::{resolve_workspace_path, ToolResult, ToolRuntime};

const DEFAULT_LIMIT: usize = 2_000;

pub async fn execute(args: Value, runtime: &ToolRuntime, image_read: bool) -> ToolResult {
    let path = match required_string(&args, "path") {
        Ok(path) => path,
        Err(error) => return error,
    };
    let offset = match optional_usize(&args, "offset", 0, true) {
        Ok(offset) => offset,
        Err(error) => return error,
    };
    let limit = match optional_usize(&args, "limit", DEFAULT_LIMIT, false) {
        Ok(limit) => limit,
        Err(error) => return error,
    };

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

    read_local(
        resolve_workspace_path(runtime, PathBuf::from(&path)),
        path,
        offset,
        limit,
        image_read,
    )
    .await
}

async fn read_local(
    path: PathBuf,
    path_display: String,
    offset: usize,
    limit: usize,
    image_read: bool,
) -> ToolResult {
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
        Err(error) => argument_error(format!("file read task failed for {path_display}: {error}")),
    }
}

fn optional_usize(
    args: &Value,
    key: &str,
    default: usize,
    allow_zero: bool,
) -> Result<usize, ToolResult> {
    let Some(value) = args.get(key) else {
        return Ok(default);
    };
    let Some(value) = value.as_u64() else {
        return Err(argument_error(format!(
            "'{key}' must be a non-negative integer"
        )));
    };
    let value =
        usize::try_from(value).map_err(|_| argument_error(format!("'{key}' is too large")))?;
    if value == 0 && !allow_zero {
        return Err(argument_error(format!("'{key}' must be greater than zero")));
    }
    Ok(value)
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
        assert!(optional_usize(&json!({"offset":-1}), "offset", 0, true).is_err());
        assert!(optional_usize(&json!({"limit":0}), "limit", DEFAULT_LIMIT, false).is_err());
        assert_eq!(optional_usize(&json!({}), "offset", 0, true).unwrap(), 0);
    }
}
