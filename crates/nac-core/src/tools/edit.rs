use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use serde_json::Value;

use crate::sandbox::FileIoMode;
use crate::tools::{
    open_locked_file, open_locked_file_beneath, remote_file_lock_busy, require_str,
    resolve_workspace_path, FileLockAccess, ToolResult, ToolRuntime,
    REMOTE_FILE_LOCK_RETRY_INTERVAL,
};

const REMOTE_EDIT_SCRIPT: &str = r#"
import fcntl
from pathlib import Path
import json
import sys

orig = sys.argv[1]
path = Path(sys.argv[2]).expanduser()
payload = json.load(sys.stdin)
old_text = payload["old_text"]
new_text = payload["new_text"]

try:
    with path.open("r+", encoding="utf-8") as target:
        try:
            fcntl.flock(target.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("NAC_FILE_LOCK_BUSY")
            sys.exit(75)
        content = target.read()

        count = content.count(old_text)
        if count == 0:
            print(f"old_text not found in {orig}")
            sys.exit(2)
        if count > 1:
            print(f"old_text appears {count} times — provide more context to make it unique")
            sys.exit(2)

        new_content = content.replace(old_text, new_text, 1)
        target.seek(0)
        target.truncate()
        target.write(new_content)
    print("ok")
except FileNotFoundError:
    print(f"File not found: {orig}")
    sys.exit(2)
except Exception as exc:
    print(f"Error editing {orig}: {exc}")
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
        if let Some(host_path) = runtime.backend.host_path_for_remote_file(&guest_path) {
            if host_path.read_only {
                return ToolResult {
                    content: format!("Error editing {path}: sandbox mount is read-only"),
                    is_error: true,
                };
            }
            match open_locked_file_beneath(
                host_path.root,
                host_path.relative,
                false,
                false,
                FileLockAccess::ReadWrite,
            )
            .await
            {
                Ok(Some(file)) => {
                    return edit_locked_file(file, path.clone(), old_text, new_text).await;
                }
                Ok(None) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return ToolResult {
                        content: format!("Error opening or locking {path}: {error}"),
                        is_error: true,
                    };
                }
            }
        }
        let payload = serde_json::json!({
            "old_text": old_text,
            "new_text": new_text,
        });
        let args = vec![
            "-c".to_string(),
            REMOTE_EDIT_SCRIPT.to_string(),
            path.clone(),
            guest_path.display().to_string(),
        ];
        let payload = payload.to_string().into_bytes();
        loop {
            match runtime
                .backend
                .exec("python3", &args, Some(payload.as_slice()))
                .await
            {
                Ok(output) if remote_file_lock_busy(&output) => {
                    tokio::time::sleep(REMOTE_FILE_LOCK_RETRY_INTERVAL).await;
                }
                Ok(output) if output.status.success() => {
                    return ToolResult {
                        content: "ok".to_string(),
                        is_error: false,
                    };
                }
                Ok(output) => {
                    return ToolResult {
                        content: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                        is_error: true,
                    };
                }
                Err(error) => {
                    return ToolResult {
                        content: format!(
                            "Error editing {} in {}: {}",
                            path,
                            runtime.backend.remote_io_label(),
                            error
                        ),
                        is_error: true,
                    };
                }
            }
        }
    }

    let path = resolve_workspace_path(runtime, PathBuf::from(path));
    execute_local(path, old_text, new_text).await
}

async fn execute_local(path: PathBuf, old_text: String, new_text: String) -> ToolResult {
    let path_display = path.display().to_string();
    let file = match open_locked_file(path, false, FileLockAccess::ReadWrite).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return ToolResult {
                content: format!("File not found: {path_display}"),
                is_error: true,
            };
        }
        Err(error) => {
            return ToolResult {
                content: format!("Error opening or locking {path_display}: {error}"),
                is_error: true,
            };
        }
    };
    edit_locked_file(file, path_display, old_text, new_text).await
}

async fn edit_locked_file(
    mut file: File,
    path_display: String,
    old_text: String,
    new_text: String,
) -> ToolResult {
    match tokio::task::spawn_blocking(move || {
        let mut content = String::new();
        if let Err(error) = file.read_to_string(&mut content) {
            return ToolResult {
                content: format!("Error reading {path_display}: {error}"),
                is_error: true,
            };
        }

        let count = content.matches(old_text.as_str()).count();
        if count == 0 {
            return ToolResult {
                content: format!("old_text not found in {path_display}"),
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
        if let Err(error) = file
            .seek(SeekFrom::Start(0))
            .and_then(|_| file.set_len(0))
            .and_then(|_| file.write_all(new_content.as_bytes()))
        {
            return ToolResult {
                content: format!("Error writing {path_display}: {error}"),
                is_error: true,
            };
        }

        ToolResult {
            content: "ok".to_string(),
            is_error: false,
        }
    })
    .await
    {
        Ok(result) => result,
        Err(error) => ToolResult {
            content: format!("Error editing file: blocking task failed: {error}"),
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
        let path =
            std::env::temp_dir().join(format!("agent_edit_test_{}_{}.txt", std::process::id(), id));
        tokio::fs::write(&path, content).await.unwrap();
        path
    }

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
    async fn relative_path_resolves_from_workspace_cwd() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_edit_workspace_{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("note.txt"), "before\n").unwrap();

        let result = execute(
            json!({
                "path": "note.txt",
                "old_text": "before",
                "new_text": "after"
            }),
            &local_runtime_at(dir.clone()),
        )
        .await;

        assert!(!result.is_error, "Got error: {}", result.content);
        assert_eq!(
            std::fs::read_to_string(dir.join("note.txt")).unwrap(),
            "after\n"
        );
        let _ = std::fs::remove_dir_all(dir);
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

    #[tokio::test]
    async fn concurrent_edits_to_one_file_preserve_both_changes() {
        let path = write_temp("alpha beta\n").await;
        let runtime = local_runtime();
        let path_arg = path.to_string_lossy().to_string();

        let first = execute(
            json!({
                "path": path_arg,
                "old_text": "alpha",
                "new_text": "ALPHA"
            }),
            &runtime,
        );
        let second = execute(
            json!({
                "path": path.to_string_lossy(),
                "old_text": "beta",
                "new_text": "BETA"
            }),
            &runtime,
        );
        let (first_result, second_result) = tokio::join!(first, second);

        assert!(
            !first_result.is_error,
            "first edit failed: {}",
            first_result.content
        );
        assert!(
            !second_result.is_error,
            "second edit failed: {}",
            second_result.content
        );
        assert_eq!(
            tokio::fs::read_to_string(&path).await.unwrap(),
            "ALPHA BETA\n"
        );
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn cancelled_blocked_edit_never_mutates_and_unrelated_write_progresses() {
        let path = write_temp("before\n").await;
        let held = crate::tools::open_locked_file(
            path.clone(),
            false,
            crate::tools::FileLockAccess::ReadWrite,
        )
        .await
        .unwrap();

        let edit_path = path.clone();
        let edit_runtime = local_runtime();
        let blocked_edit = tokio::spawn(async move {
            execute(
                json!({
                    "path": edit_path.to_string_lossy(),
                    "old_text": "before",
                    "new_text": "after"
                }),
                &edit_runtime,
            )
            .await
        });
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert!(!blocked_edit.is_finished());

        let unrelated = path.with_extension("unrelated");
        let unrelated_runtime = local_runtime();
        let write_result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            crate::tools::write::execute(
                json!({
                    "path": unrelated.to_string_lossy(),
                    "content": "independent"
                }),
                &unrelated_runtime,
            ),
        )
        .await
        .expect("an unrelated write must not wait behind a blocked edit");
        assert!(
            !write_result.is_error,
            "unrelated write failed: {}",
            write_result.content
        );

        blocked_edit.abort();
        assert!(blocked_edit.await.unwrap_err().is_cancelled());
        drop(held);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), "before\n");

        let _ = tokio::fs::remove_file(path).await;
        let _ = tokio::fs::remove_file(unrelated).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn remote_script_reports_contention_without_waiting() {
        use fs2::FileExt;
        use std::fs::OpenOptions;

        let path = write_temp("before\n").await;
        let held = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        FileExt::lock_exclusive(&held).unwrap();

        let args = vec![
            "-c".to_string(),
            REMOTE_EDIT_SCRIPT.to_string(),
            path.display().to_string(),
            path.display().to_string(),
        ];
        let payload = serde_json::json!({
            "old_text": "before",
            "new_text": "after",
        });
        let payload = payload.to_string().into_bytes();
        let runtime = local_runtime();
        let output = runtime
            .backend
            .exec("python3", &args, Some(payload.as_slice()))
            .await
            .unwrap();

        assert!(remote_file_lock_busy(&output));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "before\n");
        drop(held);
        let _ = std::fs::remove_file(path);
    }
}
