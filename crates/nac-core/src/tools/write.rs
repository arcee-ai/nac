use std::path::PathBuf;

use serde_json::{json, Value};

use crate::sandbox::{FileIoMode, HostPathResolution};
use crate::tools::mutation::{
    argument_error, execute_remote, permission_error, required_string, write_local,
    write_local_bound, write_mounted,
};
use crate::tools::{resolve_workspace_path, ToolResult, ToolRuntime};
use crate::types::{FunctionDef, ToolDefinition};

pub fn definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "write".to_string(),
            description: "Atomically create or replace a UTF-8 file. Use expected_revision null only to create a missing file; replacing requires the revision from read."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "content": { "type": "string", "description": "Complete content to write" },
                    "expected_revision": {
                        "type": ["string", "null"],
                        "description": "Revision from read to replace an existing file, or null to create only"
                    }
                },
                "required": ["path", "content", "expected_revision"],
                "additionalProperties": false
            }),
        },
    }
}

pub async fn execute(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let path = match required_string(&args, "path") {
        Ok(path) => path,
        Err(error) => return error,
    };
    let content = match required_string(&args, "content") {
        Ok(content) => content,
        Err(error) => return error,
    };
    let expected_revision = match parse_expected_revision(&args) {
        Ok(revision) => revision,
        Err(error) => return error,
    };

    if runtime.backend.file_io() == FileIoMode::RemoteExec {
        let guest_path = match runtime.backend.resolve_path(&path) {
            Ok(path) => path,
            Err(error) => return argument_error(error.to_string()),
        };
        match runtime.backend.host_path_for_remote_file(&guest_path) {
            HostPathResolution::Mapped(host_path) => {
                if host_path.read_only {
                    return permission_error(format!("sandbox mount is read-only: {path}"));
                }
                if host_path.relative.as_os_str().is_empty() {
                    return argument_error(format!(
                        "atomic write is not supported for a single-file sandbox mount: {path}"
                    ));
                }
                return write_mounted(
                    host_path.root,
                    host_path.relative,
                    path,
                    content,
                    expected_revision,
                )
                .await;
            }
            HostPathResolution::UnsafeMounted { read_only } => {
                let reason = if read_only {
                    "sandbox mount is read-only"
                } else {
                    "atomic write is unsafe through a symlinked sandbox mount"
                };
                return permission_error(format!("{reason}: {path}"));
            }
            HostPathResolution::Unmounted => {}
        }
        return execute_remote(
            json!({
                "operation": "write",
                "path": path,
                "resolved_path": guest_path.display().to_string(),
                "expected_revision": expected_revision,
                "content": content,
            }),
            runtime,
        )
        .await;
    }

    if args
        .get("_nac_authorized_path_bound")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        write_local_bound(
            resolve_workspace_path(runtime, PathBuf::from(&path)),
            path,
            content,
            expected_revision,
        )
        .await
    } else {
        write_local(
            resolve_workspace_path(runtime, PathBuf::from(&path)),
            path,
            content,
            expected_revision,
        )
        .await
    }
}

fn parse_expected_revision(args: &Value) -> Result<Option<String>, ToolResult> {
    match args.get("expected_revision") {
        None => Err(argument_error("'expected_revision' argument required")),
        Some(Value::Null) => Ok(None),
        Some(Value::String(revision)) => Ok(Some(revision.clone())),
        Some(_) => Err(argument_error(
            "'expected_revision' must be a revision string or null",
        )),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use uuid::Uuid;

    use super::*;
    use crate::tools::mutation::revision;
    use crate::tools::test_runtime;

    fn fixture() -> (PathBuf, ToolRuntime) {
        let dir = std::env::temp_dir().join(format!("nac-write-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut runtime = test_runtime();
        runtime.workspace_cwd = dir.clone();
        (dir, runtime)
    }

    fn sandbox_runtime_at(host_cwd: PathBuf, read_only: bool) -> ToolRuntime {
        let sandbox = crate::sandbox::SandboxSession::new_for_test(crate::sandbox::SandboxSpec {
            mounts: vec![crate::sandbox::MountSpec {
                host: host_cwd.clone(),
                guest: PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
                read_only,
            }],
            shm_size: Some("0".to_string()),
            ..Default::default()
        });
        let mut runtime = test_runtime();
        runtime.workspace_cwd = host_cwd.clone();
        runtime.config_cwd = host_cwd.clone();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(Some(sandbox), &host_cwd);
        runtime
    }

    #[tokio::test]
    async fn null_revision_creates_nested_file_only() {
        let (dir, runtime) = fixture();
        let result = execute(
            json!({
                "path":"nested/file.txt",
                "content":"created\n",
                "expected_revision":null
            }),
            &runtime,
        )
        .await;
        assert!(!result.is_error, "{}", result.content);
        assert_eq!(
            std::fs::read_to_string(dir.join("nested/file.txt")).unwrap(),
            "created\n"
        );
        let value: Value =
            serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
        assert!(value["old_revision"].is_null());
        assert_eq!(value["new_revision"], revision(b"created\n"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn null_revision_cannot_overwrite() {
        let (dir, runtime) = fixture();
        std::fs::write(dir.join("file.txt"), "before\n").unwrap();
        let result = execute(
            json!({"path":"file.txt", "content":"after\n", "expected_revision":null}),
            &runtime,
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("already_exists"));
        assert_eq!(
            std::fs::read_to_string(dir.join("file.txt")).unwrap(),
            "before\n"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn exact_revision_replaces_and_preserves_mode() {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;

        let (dir, runtime) = fixture();
        let path = dir.join("file.txt");
        std::fs::write(&path, "before\n").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        let result = execute(
            json!({
                "path":"file.txt",
                "content":"after\n",
                "expected_revision":revision(b"before\n")
            }),
            &runtime,
        )
        .await;
        assert!(!result.is_error, "{}", result.content);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "after\n");
        #[cfg(unix)]
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn stale_write_returns_current_revision() {
        let (dir, runtime) = fixture();
        std::fs::write(dir.join("file.txt"), "current\n").unwrap();
        let result = execute(
            json!({
                "path":"file.txt",
                "content":"after\n",
                "expected_revision":revision(b"old\n")
            }),
            &runtime,
        )
        .await;
        assert!(result.is_error);
        let value: Value =
            serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
        assert_eq!(value["error"], "stale_revision");
        assert_eq!(value["current_revision"], revision(b"current\n"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn writable_podman_directory_mount_uses_atomic_host_path() {
        let dir = std::env::temp_dir().join(format!("nac-mounted-write-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let runtime = sandbox_runtime_at(dir.clone(), false);
        let result = execute(
            json!({
                "path":"nested/file.txt",
                "content":"mounted\n",
                "expected_revision":null
            }),
            &runtime,
        )
        .await;
        assert!(!result.is_error, "{}", result.content);
        assert_eq!(
            std::fs::read_to_string(dir.join("nested/file.txt")).unwrap(),
            "mounted\n"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn read_only_podman_mount_rejects_before_mutation() {
        let dir = std::env::temp_dir().join(format!("nac-mounted-write-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let runtime = sandbox_runtime_at(dir.clone(), true);
        let result = execute(
            json!({
                "path":"nested/file.txt",
                "content":"forbidden\n",
                "expected_revision":null
            }),
            &runtime,
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("read-only"));
        assert_eq!(
            serde_json::from_str::<Value>(result.content.as_text().expect("text tool result"),)
                .unwrap()["error"],
            "permission_denied"
        );
        assert!(!dir.join("nested").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_only_mounted_symlink_cannot_bypass_policy() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!("nac-mounted-write-{}", Uuid::new_v4()));
        let outside = std::env::temp_dir().join(format!("nac-mounted-outside-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        let runtime = sandbox_runtime_at(root.clone(), true);
        let result = execute(
            json!({
                "path":"escape/file.txt",
                "content":"forbidden\n",
                "expected_revision":null
            }),
            &runtime,
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("read-only"));
        assert_eq!(
            serde_json::from_str::<Value>(result.content.as_text().expect("text tool result"),)
                .unwrap()["error"],
            "permission_denied"
        );
        assert!(!outside.join("file.txt").exists());
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn writable_mounted_symlink_is_not_routed_to_a_second_lock_domain() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!("nac-mounted-write-{}", Uuid::new_v4()));
        let outside = std::env::temp_dir().join(format!("nac-mounted-outside-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        let runtime = sandbox_runtime_at(root.clone(), false);
        let result = execute(
            json!({
                "path":"escape/file.txt",
                "content":"forbidden\n",
                "expected_revision":null
            }),
            &runtime,
        )
        .await;
        assert!(result.is_error);
        let value: Value =
            serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
        assert_eq!(value["error"], "permission_denied");
        assert!(value["message"].as_str().unwrap().contains("symlinked"));
        assert!(!outside.join("file.txt").exists());
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside);
    }

    #[tokio::test]
    async fn single_file_podman_mount_rejects_atomic_replacement() {
        let dir = std::env::temp_dir().join(format!("nac-single-mount-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let host_file = dir.join("file.txt");
        std::fs::write(&host_file, "before\n").unwrap();
        let sandbox = crate::sandbox::SandboxSession::new_for_test(crate::sandbox::SandboxSpec {
            mounts: vec![crate::sandbox::MountSpec {
                host: host_file.clone(),
                guest: PathBuf::from("/workspace/file.txt"),
                read_only: false,
            }],
            workdir: PathBuf::from("/workspace"),
            shm_size: Some("0".to_string()),
            ..Default::default()
        });
        let mut runtime = test_runtime();
        runtime.workspace_cwd = dir.clone();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(Some(sandbox), &dir);
        let result = execute(
            json!({
                "path":"file.txt",
                "content":"after\n",
                "expected_revision":revision(b"before\n")
            }),
            &runtime,
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("single-file"));
        assert_eq!(std::fs::read_to_string(&host_file).unwrap(), "before\n");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn expected_revision_is_explicit_and_nullable() {
        assert!(parse_expected_revision(&json!({})).is_err());
        assert_eq!(
            parse_expected_revision(&json!({"expected_revision":null})).unwrap(),
            None
        );
        assert_eq!(
            parse_expected_revision(&json!({"expected_revision":"sha256:abc"})).unwrap(),
            Some("sha256:abc".to_string())
        );
    }
}
