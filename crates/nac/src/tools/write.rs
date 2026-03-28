use std::path::PathBuf;

use serde_json::Value;

use crate::tools::{require_str, ToolResult};

pub async fn execute(args: Value) -> ToolResult {
    let path = PathBuf::from(match require_str(&args, "path") {
        Ok(value) => value,
        Err(error) => return error,
    });
    let content = match require_str(&args, "content") {
        Ok(value) => value,
        Err(error) => return error,
    };

    if let Some(parent) = path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return ToolResult {
                content: format!("Error creating directories: {}", e),
                is_error: true,
            };
        }
    }

    let _guard = crate::tools::acquire_write_lock().await;

    match tokio::fs::write(&path, content.as_bytes()).await {
        Ok(_) => ToolResult {
            content: "ok".to_string(),
            is_error: false,
        },
        Err(e) => ToolResult {
            content: format!("Error writing {}: {}", path.display(), e),
            is_error: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn test_write_creates_dirs() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("agent_test_write_dirs_{}", unique));
        let file_path = dir.join("deep").join("nested").join("test.txt");
        let path_str = file_path.to_string_lossy().to_string();

        let result = execute(json!({ "path": path_str, "content": "hello from test" })).await;
        assert!(!result.is_error, "Write failed: {}", result.content);
        assert_eq!(result.content, "ok");

        let written = std::fs::read_to_string(&file_path).expect("failed to read written file");
        assert_eq!(written, "hello from test");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
