use std::path::PathBuf;

use serde_json::Value;

use crate::tools::{acquire_write_lock, require_str, ToolResult};

pub async fn execute(args: Value) -> ToolResult {
    let path = match require_str(&args, "path") {
        Ok(s) => PathBuf::from(s),
        Err(e) => return e,
    };
    let old_text = match require_str(&args, "old_text") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let new_text = match require_str(&args, "new_text") {
        Ok(s) => s,
        Err(e) => return e,
    };

    if !path.exists() {
        return ToolResult {
            content: format!("File not found: {}", path.display()),
            is_error: true,
        };
    }

    let content = match tokio::fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(e) => {
            return ToolResult {
                content: format!("Error reading {}: {}", path.display(), e),
                is_error: true,
            }
        }
    };

    let count = content.matches(&old_text as &str).count();
    if count == 0 {
        return ToolResult {
            content: format!("old_text not found in {}", path.display()),
            is_error: true,
        };
    }
    if count > 1 {
        return ToolResult {
            content: format!(
                "old_text appears {} times — provide more context to make it unique",
                count
            ),
            is_error: true,
        };
    }

    let new_content = content.replacen(&old_text, &new_text, 1);
    let _guard = acquire_write_lock().await;
    match tokio::fs::write(&path, new_content.as_bytes()).await {
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
    use super::*;
    use serde_json::json;

    async fn write_temp(content: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("agent_edit_test_{}.txt", id));
        tokio::fs::write(&path, content).await.unwrap();
        path
    }

    #[tokio::test]
    async fn test_exact_match() {
        let path = write_temp("hello world\ngoodbye\n").await;
        let result = execute(json!({
            "path": path.to_string_lossy(),
            "old_text": "hello world",
            "new_text": "hi earth"
        }))
        .await;
        assert!(!result.is_error, "Got error: {}", result.content);
        let content = tokio::fs::read_to_string(&path).await.unwrap();
        assert!(content.contains("hi earth"));
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn test_no_match() {
        let path = write_temp("fn foo() {}\n").await;
        let result = execute(json!({
            "path": path.to_string_lossy(),
            "old_text": "nonexistent text xyz",
            "new_text": "replacement"
        }))
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("not found"), "Got: {}", result.content);
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn test_multiple_matches() {
        let path = write_temp("foo\nfoo\nfoo\n").await;
        let result = execute(json!({
            "path": path.to_string_lossy(),
            "old_text": "foo",
            "new_text": "bar"
        }))
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("3 times"), "Got: {}", result.content);
        let _ = tokio::fs::remove_file(&path).await;
    }
}
