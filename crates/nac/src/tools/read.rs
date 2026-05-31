use std::path::PathBuf;

use serde_json::Value;

use crate::tools::{require_str, ToolResult, ToolRuntime};

const SANDBOX_READ_SCRIPT: &str = r#"
from pathlib import Path
import sys

orig = sys.argv[1]
path = Path(sys.argv[2])
offset = int(sys.argv[3])
limit = int(sys.argv[4])

if not path.exists():
    print(f"File not found: {orig}")
    sys.exit(2)

raw = path.read_bytes()
check_len = min(len(raw), 8192)
if b'\0' in raw[:check_len]:
    print(f"Binary file, cannot read as text: {orig}")
    sys.exit(2)

text = raw.decode('utf-8', errors='replace')
lines = text.splitlines()
total_lines = len(lines)
selected = lines[offset:offset + limit]

output = ''.join(f"{offset + idx + 1:4}| {line}\n" for idx, line in enumerate(selected))
if len(output) > 30000:
    output = output[:30000] + f"\n... (truncated, {total_lines} total lines)"
elif offset + len(selected) < total_lines:
    output += f"\n... (showing lines {offset + 1}-{offset + len(selected)} of {total_lines})"

sys.stdout.write(output)
"#;

pub async fn execute(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let path = match require_str(&args, "path") {
        Ok(value) => value,
        Err(error) => return error,
    };
    let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(2000) as usize;

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
            SANDBOX_READ_SCRIPT.to_string(),
            path.clone(),
            guest_path.display().to_string(),
            offset.to_string(),
            limit.to_string(),
        ];

        return match sandbox.exec("python3", &args, None).await {
            Ok(output) => sandbox_output(output),
            Err(error) => ToolResult {
                content: format!("Error reading {} in sandbox: {}", path, error),
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

    let raw = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => {
            return ToolResult {
                content: format!("Error reading {}: {}", path.display(), e),
                is_error: true,
            };
        }
    };

    let check_len = raw.len().min(8192);
    if raw[..check_len].contains(&0u8) {
        return ToolResult {
            content: format!("Binary file, cannot read as text: {}", path.display()),
            is_error: true,
        };
    }

    let text = String::from_utf8_lossy(&raw).into_owned();
    let lines: Vec<&str> = text.lines().collect();
    let total_lines = lines.len();
    let selected: Vec<&str> = lines.iter().skip(offset).take(limit).copied().collect();

    let mut output = String::new();
    for (idx, line) in selected.iter().enumerate() {
        output.push_str(&format!("{:4}| {}\n", offset + idx + 1, line));
    }

    if output.len() > 30_000 {
        output.truncate(30_000);
        output.push_str(&format!("\n... (truncated, {} total lines)", total_lines));
    } else if offset + selected.len() < total_lines {
        output.push_str(&format!(
            "\n... (showing lines {}-{} of {})",
            offset + 1,
            offset + selected.len(),
            total_lines
        ));
    }

    ToolResult {
        content: output,
        is_error: false,
    }
}

fn sandbox_output(output: std::process::Output) -> ToolResult {
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if output.status.success() {
        ToolResult {
            content: stdout,
            is_error: false,
        }
    } else {
        let content = if !stdout.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        ToolResult {
            content: content.trim().to_string(),
            is_error: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use std::collections::HashSet;
    use std::sync::Arc;

    use tokio::sync::Mutex;

    use super::*;
    use crate::events::EventSink;

    fn local_runtime() -> ToolRuntime {
        ToolRuntime {
            store_path: PathBuf::new(),
            session_id: None,
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
    async fn test_read_missing_file() {
        let result = execute(
            json!({ "path": "/nonexistent/file_xyz_12345.txt" }),
            &local_runtime(),
        )
        .await;
        assert!(result.is_error);
        assert!(
            result.content.contains("not found") || result.content.contains("not exist"),
            "Got: {}",
            result.content
        );
    }

    #[tokio::test]
    async fn test_read_existing_file() {
        let result = execute(json!({ "path": "Cargo.toml" }), &local_runtime()).await;
        assert!(!result.is_error, "Got error: {}", result.content);
        assert!(
            result.content.contains("[workspace]") || result.content.contains("[package]"),
            "Got: {}",
            result.content
        );
    }
}
