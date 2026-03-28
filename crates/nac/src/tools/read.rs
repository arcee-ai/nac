use std::path::PathBuf;

use serde_json::Value;

use crate::tools::{require_str, ToolResult};

pub async fn execute(args: Value) -> ToolResult {
    let path = PathBuf::from(match require_str(&args, "path") {
        Ok(value) => value,
        Err(error) => return error,
    });
    let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(2000) as usize;

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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn test_read_missing_file() {
        let result = execute(json!({ "path": "/nonexistent/file_xyz_12345.txt" })).await;
        assert!(result.is_error);
        assert!(
            result.content.contains("not found") || result.content.contains("not exist"),
            "Got: {}",
            result.content
        );
    }

    #[tokio::test]
    async fn test_read_existing_file() {
        let result = execute(json!({ "path": "Cargo.toml" })).await;
        assert!(!result.is_error, "Got error: {}", result.content);
        assert!(result.content.contains("[package]"), "Got: {}", result.content);
    }
}
