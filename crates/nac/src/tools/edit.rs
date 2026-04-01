use std::path::PathBuf;

use serde_json::Value;

use crate::tools::{acquire_write_lock, require_str, ToolResult, ToolRuntime};

const SANDBOX_EDIT_SCRIPT: &str = r#"
from pathlib import Path
import json
import sys

orig = sys.argv[1]
path = Path(sys.argv[2])
payload = json.load(sys.stdin)
old_text = payload["old_text"]
new_text = payload["new_text"]

if not path.exists():
    print(f"File not found: {orig}")
    sys.exit(2)

try:
    content = path.read_text(encoding="utf-8")
except Exception as exc:
    print(f"Error reading {orig}: {exc}")
    sys.exit(2)

count = content.count(old_text)
if count == 0:
    print(f"old_text not found in {orig}")
    sys.exit(2)
if count > 1:
    print(f"old_text appears {count} times — provide more context to make it unique")
    sys.exit(2)

new_content = content.replace(old_text, new_text, 1)
try:
    path.write_text(new_content, encoding="utf-8")
    print("ok")
except Exception as exc:
    print(f"Error writing {orig}: {exc}")
    sys.exit(2)
"#;

pub async fn execute(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let path = match require_str(&args, "path") {
        Ok(s) => s,
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

    if let Some(sandbox) = &runtime.sandbox {
        let guest_path = match sandbox.resolve_path(&path) {
            Ok(path) => path,
            Err(error) => {
                return ToolResult {
                    content: error.to_string(),
                    is_error: true,
                }
            }
        };
        let payload = serde_json::json!({
            "old_text": old_text,
            "new_text": new_text,
        });
        let args = vec![
            "-c".to_string(),
            SANDBOX_EDIT_SCRIPT.to_string(),
            path.clone(),
            guest_path.display().to_string(),
        ];
        return match sandbox
            .exec("python3", &args, Some(payload.to_string().into_bytes()))
            .await
        {
            Ok(output) if output.status.success() => ToolResult {
                content: "ok".to_string(),
                is_error: false,
            },
            Ok(output) => ToolResult {
                content: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                is_error: true,
            },
            Err(error) => ToolResult {
                content: format!("Error editing {} in sandbox: {}", path, error),
                is_error: true,
            },
        };
    }

    let path = PathBuf::from(path);
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
    use std::collections::HashSet;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    use crate::events::EventSink;

    async fn write_temp(content: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("agent_edit_test_{}.txt", id));
        tokio::fs::write(&path, content).await.unwrap();
        path
    }

    fn local_runtime() -> ToolRuntime {
        ToolRuntime {
            store_path: PathBuf::new(),
            session_id: None,
            active_threads: Arc::new(Mutex::new(HashSet::new())),
            event_sink: EventSink::none(),
            sandbox: None,
        }
    }

    #[tokio::test]
    async fn test_exact_match() {
        let path = write_temp("hello world\ngoodbye\n").await;
        let result = execute(
            json!({
                "path": path.to_string_lossy(),
                "old_text": "hello world",
                "new_text": "hi earth"
            }),
            &local_runtime(),
        )
        .await;
        assert!(!result.is_error, "Got error: {}", result.content);
        let content = tokio::fs::read_to_string(&path).await.unwrap();
        assert!(content.contains("hi earth"));
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn test_no_match() {
        let path = write_temp("fn foo() {}\n").await;
        let result = execute(
            json!({
                "path": path.to_string_lossy(),
                "old_text": "nonexistent text xyz",
                "new_text": "replacement"
            }),
            &local_runtime(),
        )
        .await;
        assert!(result.is_error);
        assert!(
            result.content.contains("not found"),
            "Got: {}",
            result.content
        );
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn test_multiple_matches() {
        let path = write_temp("foo\nfoo\nfoo\n").await;
        let result = execute(
            json!({
                "path": path.to_string_lossy(),
                "old_text": "foo",
                "new_text": "bar"
            }),
            &local_runtime(),
        )
        .await;
        assert!(result.is_error);
        assert!(
            result.content.contains("3 times"),
            "Got: {}",
            result.content
        );
        let _ = tokio::fs::remove_file(&path).await;
    }
}
