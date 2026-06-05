use std::path::PathBuf;

use serde_json::Value;

use crate::tools::{require_str, resolve_workspace_path, ToolResult, ToolRuntime};

const SANDBOX_WRITE_SCRIPT: &str = r#"
from pathlib import Path
import sys

orig = sys.argv[1]
path = Path(sys.argv[2])

try:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(sys.stdin.buffer.read())
    print("ok")
except Exception as exc:
    print(f"Error writing {orig}: {exc}")
    sys.exit(2)
"#;

pub async fn execute(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let path = match require_str(&args, "path") {
        Ok(value) => value,
        Err(error) => return error,
    };
    let content = match require_str(&args, "content") {
        Ok(value) => value,
        Err(error) => return error,
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
        let args = vec![
            "-c".to_string(),
            SANDBOX_WRITE_SCRIPT.to_string(),
            path.clone(),
            guest_path.display().to_string(),
        ];
        return match sandbox
            .exec("python3", &args, Some(content.into_bytes()))
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
                content: format!("Error writing {} in sandbox: {}", path, error),
                is_error: true,
            },
        };
    }

    let path = resolve_workspace_path(runtime, PathBuf::from(path));
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
    use std::collections::HashSet;
    use std::sync::Arc;

    use super::*;
    use crate::events::EventSink;
    use tokio::sync::Mutex;

    fn local_runtime() -> ToolRuntime {
        local_runtime_at(std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
    }

    fn local_runtime_at(workspace_cwd: PathBuf) -> ToolRuntime {
        ToolRuntime {
            workspace_cwd,
            store_path: PathBuf::new(),
            session_id: None,
            worker_executable: None,
            active_threads: Arc::new(Mutex::new(HashSet::new())),
            event_sink: EventSink::none(),
            sandbox: None,
            mcp: None,
            skills: None,
            terminal_manager: crate::terminal::TerminalManager::new(),
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
        }
    }

    #[tokio::test]
    async fn relative_path_resolves_from_workspace_cwd() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_write_workspace_{unique}"));
        std::fs::create_dir_all(&dir).unwrap();

        let result = execute(
            json!({ "path": "nested/out.txt", "content": "workspace write" }),
            &local_runtime_at(dir.clone()),
        )
        .await;

        assert!(!result.is_error, "Write failed: {}", result.content);
        assert_eq!(
            std::fs::read_to_string(dir.join("nested/out.txt")).unwrap(),
            "workspace write"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn test_write_creates_dirs() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("agent_test_write_dirs_{}", unique));
        let file_path = dir.join("deep").join("nested").join("test.txt");
        let path_str = file_path.to_string_lossy().to_string();

        let result = execute(
            json!({ "path": path_str, "content": "hello from test" }),
            &local_runtime(),
        )
        .await;
        assert!(!result.is_error, "Write failed: {}", result.content);
        assert_eq!(result.content, "ok");

        let written = std::fs::read_to_string(&file_path).expect("failed to read written file");
        assert_eq!(written, "hello from test");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
