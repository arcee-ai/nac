use std::path::PathBuf;

use serde_json::{json, Value};

use crate::sandbox::{FileIoMode, HostPathResolution};
use crate::tools::mutation::{
    argument_error, execute_remote, read_error, read_mounted, read_result, required_string,
    success_tool_result,
};
use crate::tools::{resolve_workspace_path, ToolResult, ToolRuntime};

const DEFAULT_LIMIT: usize = 2_000;

pub async fn execute(args: Value, runtime: &ToolRuntime) -> ToolResult {
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
                return read_local(host_path.root, path, offset, limit).await;
            }
            return read_mounted(host_path.root, host_path.relative, path, offset, limit).await;
        }
        return execute_remote(
            json!({
                "operation": "read",
                "path": path,
                "resolved_path": guest_path.display().to_string(),
                "offset": offset,
                "limit": limit,
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
    )
    .await
}

async fn read_local(
    path: PathBuf,
    path_display: String,
    offset: usize,
    limit: usize,
) -> ToolResult {
    let bytes = match tokio::task::spawn_blocking(move || std::fs::read(path)).await {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(error)) => return read_error(&path_display, error),
        Err(error) => {
            return argument_error(format!("file read task failed for {path_display}: {error}"))
        }
    };
    match read_result(path_display, &bytes, offset, limit) {
        Ok(result) => success_tool_result(&result),
        Err(error) => error,
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
        )
        .await;
        assert!(!result.is_error, "{}", result.content);
        let value: Value = serde_json::from_str(&result.content).unwrap();
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
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("not_found"));
    }

    #[test]
    fn offset_and_limit_validation_is_strict() {
        assert!(optional_usize(&json!({"offset":-1}), "offset", 0, true).is_err());
        assert!(optional_usize(&json!({"limit":0}), "limit", DEFAULT_LIMIT, false).is_err());
        assert_eq!(optional_usize(&json!({}), "offset", 0, true).unwrap(), 0);
    }
}
