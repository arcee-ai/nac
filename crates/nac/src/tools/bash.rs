use serde_json::Value;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use crate::tools::{require_str, ToolResult};

pub async fn execute(args: Value) -> ToolResult {
    let command = match require_str(&args, "command") {
        Ok(value) => value,
        Err(error) => return error,
    };
    let timeout_secs = args.get("timeout").and_then(|v| v.as_u64()).unwrap_or(120);

    let result = timeout(Duration::from_secs(timeout_secs), run_command(&command)).await;

    match result {
        Err(_) => ToolResult {
            content: format!("Command timed out after {}s", timeout_secs),
            is_error: false,
        },
        Ok(output) => output,
    }
}

async fn run_command(command: &str) -> ToolResult {
    let output = Command::new("bash")
        .arg("-c")
        .arg(command)
        .output()
        .await;

    match output {
        Err(e) => ToolResult {
            content: format!("Failed to spawn command: {}", e),
            is_error: true,
        },
        Ok(out) => {
            let mut combined = String::new();
            combined.push_str(&String::from_utf8_lossy(&out.stdout));
            combined.push_str(&String::from_utf8_lossy(&out.stderr));

            let exit_code = out.status.code().unwrap_or(-1);
            let mut content = if exit_code != 0 {
                format!("Exit code: {}\n{}", exit_code, combined)
            } else {
                combined
            };

            if content.len() > 30_000 {
                let temp_path = std::env::temp_dir().join(format!(
                    "agent_bash_{}.txt",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .subsec_nanos()
                ));
                let _ = std::fs::write(&temp_path, &content);
                content.truncate(30_000);
                content.push_str(&format!(
                    "\n... (truncated, full output at {})",
                    temp_path.display()
                ));
            }

            ToolResult {
                content,
                is_error: false,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_bash_simple() {
        let result = execute(json!({ "command": "echo hello && echo world" })).await;
        assert!(!result.is_error, "Got error: {}", result.content);
        assert!(result.content.contains("hello"), "Got: {}", result.content);
        assert!(result.content.contains("world"), "Got: {}", result.content);
    }

    #[tokio::test]
    async fn test_bash_timeout() {
        let result = execute(json!({ "command": "sleep 300", "timeout": 2 })).await;
        assert!(!result.is_error);
        assert!(
            result.content.contains("timed out") || result.content.contains("timeout"),
            "Got: {}",
            result.content
        );
    }

    #[tokio::test]
    async fn test_bash_nonzero_exit() {
        let result = execute(json!({ "command": "exit 1" })).await;
        assert!(
            !result.is_error,
            "Non-zero exit should not be is_error=true"
        );
        assert!(
            result.content.contains("Exit code:"),
            "Got: {}",
            result.content
        );
    }
}
