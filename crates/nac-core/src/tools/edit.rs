use std::path::PathBuf;

use serde_json::{json, Value};

use crate::sandbox::{FileIoMode, HostPathResolution};
use crate::tools::mutation::{
    argument_error, edit_local, edit_local_bound, edit_mounted, execute_remote, permission_error,
    required_string, EditSpec,
};
use crate::tools::{
    kernel, resolve_workspace_path, shared_workspace_gate, ToolResult, ToolRuntime,
};
use crate::types::{FunctionDef, ToolDefinition};

pub(crate) struct EditTool;

impl kernel::NativeTool for EditTool {
    type Input = Value;

    fn definition(&self) -> ToolDefinition {
        definition()
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Exclusive
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        validate_input(&input)?;
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        let path = input
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| argument_error("decoded edit input is missing its path"))?;
        let path = services
            .runtime
            .backend
            .resolve_path(path)
            .map_err(|error| argument_error(format!("invalid edit path: {error}")))?;
        Ok(crate::permissions::file_resources(
            "edit",
            path,
            services.runtime.backend.as_ref(),
            &services.runtime.store_path,
            true,
        ))
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[kernel::PermissionResource],
        _services: kernel::ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        let path = resources
            .iter()
            .find(|resource| resource.action == "edit")
            .ok_or_else(|| argument_error("authorized mutation target is missing"))?;
        let object = input
            .as_object_mut()
            .ok_or_else(|| argument_error("decoded edit input is not an object"))?;
        object.insert("path".to_string(), Value::String(path.resource.clone()));
        object.insert("_nac_authorized_path_bound".to_string(), Value::Bool(true));
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let gate = shared_workspace_gate(services.runtime);
            let _write = gate.write().await;
            execute(input, services.runtime).await
        })
    }
}

pub fn definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "edit".to_string(),
            description: "Atomically apply one or more exact, non-overlapping replacements against one file revision. On stale_revision, read again and retry the complete batch."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "expected_revision": { "type": "string", "description": "Complete-file revision from read" },
                    "edits": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "old_text": { "type": "string", "minLength": 1, "description": "Exact text from the original revision" },
                                "new_text": { "type": "string", "description": "Replacement text" }
                            },
                            "required": ["old_text", "new_text"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["path", "expected_revision", "edits"],
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
    let expected_revision = match required_string(&args, "expected_revision") {
        Ok(revision) => revision,
        Err(error) => return error,
    };
    let edits = match parse_edits(&args) {
        Ok(edits) => edits,
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
                        "atomic edit is not supported for a single-file sandbox mount: {path}"
                    ));
                }
                return edit_mounted(
                    host_path.root,
                    host_path.relative,
                    path,
                    expected_revision,
                    edits,
                )
                .await;
            }
            HostPathResolution::UnsafeMounted { read_only } => {
                let reason = if read_only {
                    "sandbox mount is read-only"
                } else {
                    "atomic edit is unsafe through a symlinked sandbox mount"
                };
                return permission_error(format!("{reason}: {path}"));
            }
            HostPathResolution::Unmounted => {}
        }
        return execute_remote(
            json!({
                "operation": "edit",
                "path": path,
                "resolved_path": guest_path.display().to_string(),
                "expected_revision": expected_revision,
                "edits": edits,
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
        edit_local_bound(
            resolve_workspace_path(runtime, PathBuf::from(&path)),
            path,
            expected_revision,
            edits,
        )
        .await
    } else {
        edit_local(
            resolve_workspace_path(runtime, PathBuf::from(&path)),
            path,
            expected_revision,
            edits,
        )
        .await
    }
}

fn validate_input(input: &Value) -> Result<(), ToolResult> {
    let object = input
        .as_object()
        .ok_or_else(|| argument_error("tool arguments must be an object"))?;
    if let Some(key) = object
        .keys()
        .find(|key| !["path", "expected_revision", "edits"].contains(&key.as_str()))
    {
        return Err(argument_error(format!("unknown '{key}' argument")));
    }
    for key in ["path", "expected_revision"] {
        if !object.get(key).is_some_and(Value::is_string) {
            return Err(argument_error(format!("'{key}' argument must be a string")));
        }
    }
    let edits = object
        .get("edits")
        .and_then(Value::as_array)
        .filter(|edits| !edits.is_empty())
        .ok_or_else(|| argument_error("'edits' must contain at least one replacement"))?;
    for edit in edits {
        let edit = edit
            .as_object()
            .ok_or_else(|| argument_error("each edit must be an object"))?;
        if let Some(key) = edit
            .keys()
            .find(|key| !["old_text", "new_text"].contains(&key.as_str()))
        {
            return Err(argument_error(format!("unknown '{key}' argument")));
        }
        if edit
            .get("old_text")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(argument_error("'old_text' must be a non-empty string"));
        }
        if !edit.get("new_text").is_some_and(Value::is_string) {
            return Err(argument_error("'new_text' argument must be a string"));
        }
    }
    Ok(())
}

fn parse_edits(args: &Value) -> Result<Vec<EditSpec>, ToolResult> {
    let Some(value) = args.get("edits") else {
        return Err(argument_error("'edits' argument required"));
    };
    let edits: Vec<EditSpec> = serde_json::from_value(value.clone())
        .map_err(|error| argument_error(format!("invalid 'edits' argument: {error}")))?;
    if edits.is_empty() {
        return Err(argument_error(
            "'edits' must contain at least one replacement",
        ));
    }
    Ok(edits)
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use uuid::Uuid;

    use super::*;
    use crate::tools::mutation::revision;
    use crate::tools::test_runtime;

    fn fixture() -> (PathBuf, ToolRuntime) {
        let dir = std::env::temp_dir().join(format!("nac-edit-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut runtime = test_runtime();
        runtime.workspace_cwd = dir.clone();
        (dir, runtime)
    }

    #[tokio::test]
    async fn applies_disjoint_edits_in_one_call() {
        let (dir, runtime) = fixture();
        std::fs::write(dir.join("file.txt"), "alpha = 1\nbeta = 1\n").unwrap();
        let expected = revision(b"alpha = 1\nbeta = 1\n");
        let result = execute(
            json!({
                "path":"file.txt",
                "expected_revision": expected,
                "edits":[
                    {"old_text":"alpha = 1", "new_text":"alpha = 2"},
                    {"old_text":"beta = 1", "new_text":"beta = 2"}
                ]
            }),
            &runtime,
        )
        .await;
        assert!(!result.is_error, "{}", result.content);
        assert_eq!(
            std::fs::read_to_string(dir.join("file.txt")).unwrap(),
            "alpha = 2\nbeta = 2\n"
        );
        let value: Value =
            serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
        assert_eq!(value["old_revision"], expected);
        assert_eq!(value["new_revision"], revision(b"alpha = 2\nbeta = 2\n"));
        assert!(value["diff"].as_str().unwrap().contains("alpha = 2"));
        assert!(!value["changed_ranges"].as_array().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn ambiguous_batch_is_atomic() {
        let (dir, runtime) = fixture();
        std::fs::write(dir.join("file.txt"), "same\nsame\nunique\n").unwrap();
        let bytes = b"same\nsame\nunique\n";
        let result = execute(
            json!({
                "path":"file.txt",
                "expected_revision": revision(bytes),
                "edits":[
                    {"old_text":"unique", "new_text":"changed"},
                    {"old_text":"same", "new_text":"other"}
                ]
            }),
            &runtime,
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("old_text_not_unique"));
        assert_eq!(std::fs::read(dir.join("file.txt")).unwrap(), bytes);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn stale_batch_returns_current_revision() {
        let (dir, runtime) = fixture();
        std::fs::write(dir.join("file.txt"), "current\n").unwrap();
        let result = execute(
            json!({
                "path":"file.txt",
                "expected_revision": revision(b"old\n"),
                "edits":[{"old_text":"current", "new_text":"changed"}]
            }),
            &runtime,
        )
        .await;
        assert!(result.is_error);
        let value: Value =
            serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
        assert_eq!(value["error"], "stale_revision");
        assert_eq!(value["current_revision"], revision(b"current\n"));
        assert_eq!(
            std::fs::read_to_string(dir.join("file.txt")).unwrap(),
            "current\n"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn old_call_shape_is_rejected() {
        let error = parse_edits(&json!({"old_text":"a", "new_text":"b"})).unwrap_err();
        assert!(error.is_error);
    }
}
