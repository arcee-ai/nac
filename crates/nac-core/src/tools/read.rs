use std::fmt::Write as _;
use std::path::PathBuf;

use serde_json::Value;

use crate::sandbox::FileIoMode;
use crate::tools::{require_str, resolve_workspace_path, ToolResult, ToolRuntime};

const MAX_OUTPUT_BYTES: usize = 30_000;

const REMOTE_READ_SCRIPT: &str = r#"
from pathlib import Path
import sys

orig = sys.argv[1]
path = Path(sys.argv[2]).expanduser()
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

    if runtime.backend.file_io() == FileIoMode::RemoteExec {
        let guest_path = match runtime.backend.resolve_path(&path) {
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
            REMOTE_READ_SCRIPT.to_string(),
            path.clone(),
            guest_path.display().to_string(),
            offset.to_string(),
            limit.to_string(),
        ];

        return match runtime.backend.exec("python3", &args, None).await {
            Ok(output) => remote_output(output),
            Err(error) => ToolResult {
                content: format!(
                    "Error reading {} in {}: {}",
                    path,
                    runtime.backend.remote_io_label(),
                    error
                ),
                is_error: true,
            },
        };
    }

    let path = resolve_workspace_path(runtime, PathBuf::from(path));
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
    let total_lines = text.lines().count();
    let mut selected_len = 0;
    let mut output = String::new();
    for (idx, line) in text.lines().skip(offset).take(limit).enumerate() {
        writeln!(output, "{:4}| {}", offset + idx + 1, line)
            .expect("writing to String cannot fail");
        selected_len += 1;
    }

    if output.len() > MAX_OUTPUT_BYTES {
        let mut end = MAX_OUTPUT_BYTES;
        while !output.is_char_boundary(end) {
            end -= 1;
        }
        output.truncate(end);
        write!(output, "\n... (truncated, {} total lines)", total_lines)
            .expect("writing to String cannot fail");
    } else if offset + selected_len < total_lines {
        write!(
            output,
            "\n... (showing lines {}-{} of {})",
            offset + 1,
            offset + selected_len,
            total_lines
        )
        .expect("writing to String cannot fail");
    }

    ToolResult {
        content: output,
        is_error: false,
    }
}

fn remote_output(output: std::process::Output) -> ToolResult {
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

    use super::*;

    fn local_runtime() -> ToolRuntime {
        crate::tools::test_runtime_at(
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            None,
        )
    }

    fn local_runtime_at(workspace_cwd: PathBuf) -> ToolRuntime {

        crate::tools::test_runtime_at(workspace_cwd, None)

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
    async fn relative_path_resolves_from_workspace_cwd() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_read_workspace_{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("note.txt"), "from workspace\n").unwrap();

        let result = execute(
            json!({ "path": "note.txt" }),
            &local_runtime_at(dir.clone()),
        )
        .await;

        assert!(!result.is_error, "Got error: {}", result.content);
        assert!(
            result.content.contains("from workspace"),
            "Got: {}",
            result.content
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn oversized_utf8_output_truncates_at_a_character_boundary() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_read_utf8_{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("unicode.txt"),
            format!("{}€\n", "a".repeat(29_993)),
        )
        .unwrap();

        let result = execute(
            json!({ "path": "unicode.txt" }),
            &local_runtime_at(dir.clone()),
        )
        .await;

        assert!(!result.is_error, "Got error: {}", result.content);
        assert_eq!(
            result.content,
            format!(
                "   1| {}\n... (truncated, 1 total lines)",
                "a".repeat(29_993)
            )
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn pagination_preserves_exact_line_numbers_and_continuation() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_read_pagination_{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("lines.txt"), "alpha\nbeta\ngamma\n").unwrap();

        let result = execute(
            json!({ "path": "lines.txt", "offset": 1, "limit": 1 }),
            &local_runtime_at(dir.clone()),
        )
        .await;

        assert!(!result.is_error, "Got error: {}", result.content);
        assert_eq!(result.content, "   2| beta\n\n... (showing lines 2-2 of 3)");
        let _ = std::fs::remove_dir_all(dir);
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
