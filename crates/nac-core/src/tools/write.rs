use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;

use serde_json::Value;

use crate::sandbox::FileIoMode;
use crate::tools::{
    open_locked_file, open_locked_file_beneath, remote_file_lock_busy, require_str,
    resolve_workspace_path, FileLockAccess, ToolResult, ToolRuntime,
    REMOTE_FILE_LOCK_RETRY_INTERVAL,
};

const REMOTE_WRITE_SCRIPT: &str = r#"
import fcntl
from pathlib import Path
import sys

orig = sys.argv[1]
path = Path(sys.argv[2]).expanduser()
content = sys.stdin.buffer.read()

try:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Opening in append mode avoids truncating before the per-file lock is held.
    with path.open("ab") as target:
        try:
            fcntl.flock(target.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("NAC_FILE_LOCK_BUSY")
            sys.exit(75)
        target.seek(0)
        target.truncate()
        target.write(content)
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
                    content: format!("Error writing {path}: sandbox mount is read-only"),
                    is_error: true,
                };
            }
            match open_locked_file_beneath(
                host_path.root,
                host_path.relative,
                true,
                true,
                FileLockAccess::Write,
            )
            .await
            {
                Ok(Some(file)) => {
                    return write_locked_file(file, path.clone(), content).await;
                }
                Ok(None) => {}
                Err(error) => {
                    return ToolResult {
                        content: format!("Error opening or locking {path}: {error}"),
                        is_error: true,
                    };
                }
            }
        }
        let args = vec![
            "-c".to_string(),
            REMOTE_WRITE_SCRIPT.to_string(),
            path.clone(),
            guest_path.display().to_string(),
        ];
        let content = content.into_bytes();
        loop {
            match runtime
                .backend
                .exec("python3", &args, Some(content.as_slice()))
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
                            "Error writing {} in {}: {}",
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
    execute_local(path, content).await
}

async fn execute_local(path: PathBuf, content: String) -> ToolResult {
    if let Some(parent) = path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return ToolResult {
                content: format!("Error creating directories: {}", e),
                is_error: true,
            };
        }
    }

    let path_display = path.display().to_string();
    let file = match open_locked_file(path, true, FileLockAccess::Write).await {
        Ok(file) => file,
        Err(error) => {
            return ToolResult {
                content: format!("Error opening or locking {path_display}: {error}"),
                is_error: true,
            };
        }
    };
    write_locked_file(file, path_display, content).await
}

async fn write_locked_file(mut file: File, path_display: String, content: String) -> ToolResult {
    match tokio::task::spawn_blocking(move || {
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        file.write_all(content.as_bytes())
    })
    .await
    {
        Ok(Ok(())) => ToolResult {
            content: "ok".to_string(),
            is_error: false,
        },
        Ok(Err(error)) => ToolResult {
            content: format!("Error writing {path_display}: {error}"),
            is_error: true,
        },
        Err(error) => ToolResult {
            content: format!("Error writing {path_display}: blocking task failed: {error}"),
            is_error: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use std::sync::Arc;

    use super::*;
    use crate::events::EventSink;
    use tokio::sync::Mutex;

    fn local_runtime() -> ToolRuntime {
        local_runtime_at(std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
    }

    fn local_runtime_at(workspace_cwd: PathBuf) -> ToolRuntime {
        let backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace_cwd);
        ToolRuntime {
            config_cwd: workspace_cwd.clone(),
            workspace_cwd,
            store_path: PathBuf::new(),
            session_id: None,
            session_history_enabled: true,
            worker_executable: None,
            active_threads: Arc::new(crate::tools::ActiveThreadRegistry::default()),
            event_sink: EventSink::none(),
            backend,
            mcp: None,
            skills: None,
            terminal_manager: crate::terminal::TerminalManager::new(),
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            worker_usage: Arc::new(Mutex::new(crate::model::TokenUsage::default())),
        }
    }

    fn sandbox_runtime_at(host_cwd: PathBuf, read_only: bool) -> ToolRuntime {
        let sandbox = crate::sandbox::SandboxSession::new_for_test(crate::sandbox::SandboxSpec {
            backend: crate::sandbox::SandboxBackendType::Podman,
            image: crate::sandbox::DEFAULT_SANDBOX_IMAGE.to_string(),
            mounts: vec![crate::sandbox::MountSpec {
                host: host_cwd.clone(),
                guest: PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
                read_only,
            }],
            workdir: PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
            gpu_devices: Vec::new(),
            shm_size: Some("0".to_string()),
            cpus: 2,
            memory_mib: 2048,
        });
        let backend = crate::sandbox::execution_backend_from_sandbox(Some(sandbox), &host_cwd);
        ToolRuntime {
            config_cwd: host_cwd.clone(),
            workspace_cwd: host_cwd,
            store_path: PathBuf::new(),
            session_id: None,
            session_history_enabled: true,
            worker_executable: None,
            active_threads: Arc::new(crate::tools::ActiveThreadRegistry::default()),
            event_sink: EventSink::none(),
            backend,
            mcp: None,
            skills: None,
            terminal_manager: crate::terminal::TerminalManager::new(),
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            worker_usage: Arc::new(Mutex::new(crate::model::TokenUsage::default())),
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

    #[tokio::test]
    async fn writable_sandbox_mount_mutates_the_host_path_directly() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_sandbox_host_write_{unique}"));
        std::fs::create_dir_all(&dir).unwrap();

        let result = execute(
            json!({ "path": "nested/out.txt", "content": "host write" }),
            &sandbox_runtime_at(dir.clone(), false),
        )
        .await;

        assert!(!result.is_error, "Write failed: {}", result.content);
        assert_eq!(
            std::fs::read_to_string(dir.join("nested/out.txt")).unwrap(),
            "host write"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn read_only_sandbox_mount_never_mutates_the_host() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_sandbox_read_only_{unique}"));
        std::fs::create_dir_all(&dir).unwrap();

        let result = execute(
            json!({ "path": "nested/out.txt", "content": "must not exist" }),
            &sandbox_runtime_at(dir.clone(), true),
        )
        .await;

        assert!(result.is_error);
        assert!(result.content.contains("read-only"));
        assert!(!dir.join("nested").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn write_does_not_require_read_permission() {
        use std::os::unix::fs::PermissionsExt;

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nac_write_only_{}_{unique}.txt",
            std::process::id()
        ));
        std::fs::write(&path, "before").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o200)).unwrap();

        let result = execute(
            json!({ "path": path.to_string_lossy(), "content": "after" }),
            &local_runtime(),
        )
        .await;

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(!result.is_error, "Write failed: {}", result.content);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "after");
        let _ = std::fs::remove_file(path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn remote_script_reports_contention_without_waiting() {
        use fs2::FileExt;
        use std::fs::OpenOptions;

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nac_remote_write_lock_{}_{unique}.txt",
            std::process::id()
        ));
        std::fs::write(&path, "before").unwrap();
        let held = OpenOptions::new().write(true).open(&path).unwrap();
        FileExt::lock_exclusive(&held).unwrap();

        let args = vec![
            "-c".to_string(),
            REMOTE_WRITE_SCRIPT.to_string(),
            path.display().to_string(),
            path.display().to_string(),
        ];
        let runtime = local_runtime();
        let output = runtime
            .backend
            .exec("python3", &args, Some(b"after"))
            .await
            .unwrap();

        assert!(remote_file_lock_busy(&output));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "before");
        drop(held);
        let _ = std::fs::remove_file(path);
    }
}
