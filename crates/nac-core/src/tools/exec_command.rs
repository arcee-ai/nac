//! Terminal-backed command execution tools: `exec_command` and `write_stdin`.

use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::PathBuf;

use crate::tools::ToolRuntime;
use crate::types::{FunctionDef, ToolDefinition};

// ============================================================================
// exec_command
// ============================================================================

pub fn exec_command_definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "exec_command".to_string(),
            description: "Execute a shell command.\n\n\
Use tty=false (default) as the bash tool for one-shot shell commands like `cargo build`, `npm test`, `git status`, `ls`, etc. \
The command runs to completion, returns output + exit code, and treats yield_time_ms as a timeout.\n\n\
Use tty=true for:\n\
- Interactive REPLs (python, node, etc.)\n\
- Long-running multi-step workflows where you need shell state to persist across calls \
(cd into a directory, set env vars, then run commands)\n\
- When you need more than one command in the same shell session\n\n\
When tty=true, yield_time_ms only controls how long to wait for output before returning; it does not kill the session.\n\n\
When tty=true, you get a session_name back. Use write_stdin to continue interacting with that session."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "cmd": { "type": "string", "description": "Shell command to execute" },
                    "workdir": { "type": "string", "description": "Working directory for the command (default: project root)" },
                    "tty": { "type": "boolean", "description": "Use false as the bash tool for one-shot shell commands; use true for an interactive/persistent PTY session (default: false)" },
                    "yield_time_ms": { "type": "number", "description": "For tty=false, command timeout in milliseconds (default: 30000, max: 30000). For tty=true, maximum time to wait for terminal output without killing the session (default: 500, max: 30000)." },
                    "max_output_chars": { "type": "number", "description": "Maximum characters of output to return (default: 8000, head-tail truncated if exceeded)" }
                },
                "required": ["cmd"]
            }),
        },
    }
}

pub async fn execute_exec_command(args: &Value, runtime: &ToolRuntime) -> Result<String> {
    let manager = &runtime.terminal_manager;
    let cmd = require_str(args, "cmd")?;
    let tty = args.get("tty").and_then(|v| v.as_bool()).unwrap_or(false);
    let default_yield_ms = if tty { 500 } else { 30_000 };
    let yield_ms = clamp_yield(
        args.get("yield_time_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(default_yield_ms),
    );
    let max_output = args
        .get("max_output_chars")
        .and_then(|v| v.as_u64())
        .unwrap_or(8000) as usize;
    let cwd = resolve_command_cwd(args, runtime)?;

    if !tty {
        let output = manager
            .exec_one_shot(
                &cmd,
                cwd,
                120,
                40,
                yield_ms,
                max_output,
                runtime.backend.as_ref(),
            )
            .await?;
        return Ok(serde_json::to_string_pretty(&output)?);
    }

    let session_name = make_session_name();
    let _info = manager
        .create(session_name.clone(), cwd, 120, 40, &runtime.backend)
        .await?;

    if cmd.trim().is_empty() {
        let output = manager
            .write_stdin(&session_name, "", 200, max_output)
            .await?;
        return Ok(serde_json::to_string_pretty(&output)?);
    }

    let output = manager
        .write_stdin(&session_name, &format!("{}\r", cmd), yield_ms, max_output)
        .await?;
    Ok(serde_json::to_string_pretty(&output)?)
}

// ============================================================================
// write_stdin
// ============================================================================

pub fn write_stdin_definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "write_stdin".to_string(),
            description: "Send input to a persistent terminal session created by exec_command with tty=true. \
Also use this to poll for output by sending empty input.\n\n\
Supports key notation: <RET> (Enter), <C-c> (Ctrl+C), <C-d> (Ctrl+D), <TAB>, <BSPC> (Backspace), \
<UP>/<DOWN>/<LEFT>/<RIGHT>."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Session ID returned by exec_command" },
                    "chars": { "type": "string", "description": "Input to send to the terminal. Supports key notation: <RET>, <C-c>, <C-d>, <TAB>, <BSPC>, <UP>/<DOWN>/<LEFT>/<RIGHT>. Leave empty to just poll for output." },
                    "yield_time_ms": { "type": "number", "description": "Maximum time to wait for output in milliseconds (default: 500)" },
                    "max_output_chars": { "type": "number", "description": "Maximum characters of output to return (default: 8000)" }
                },
                "required": ["session_id"]
            }),
        },
    }
}

pub async fn execute_write_stdin(args: &Value, runtime: &ToolRuntime) -> Result<String> {
    let manager = &runtime.terminal_manager;
    let session_id = require_str(args, "session_id")?;
    let chars = args.get("chars").and_then(|v| v.as_str()).unwrap_or("");
    let yield_ms = clamp_yield(
        args.get("yield_time_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(500),
    );
    let max_output = args
        .get("max_output_chars")
        .and_then(|v| v.as_u64())
        .unwrap_or(8000) as usize;

    if manager.get(&session_id).await.is_none() {
        return Err(anyhow!(
            "terminal session '{}' not found - it may have been closed or expired",
            session_id
        ));
    }

    let output = manager
        .write_stdin(&session_id, chars, yield_ms, max_output)
        .await?;
    Ok(serde_json::to_string_pretty(&output)?)
}

// ============================================================================
// Helpers
// ============================================================================

fn resolve_command_cwd(args: &Value, runtime: &ToolRuntime) -> Result<Option<PathBuf>> {
    let requested = args.get("workdir").and_then(|v| v.as_str());
    runtime.backend.resolve_terminal_cwd(requested)
}

fn require_str(args: &Value, key: &str) -> Result<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("missing required argument '{}'", key))
}

fn clamp_yield(ms: u64) -> u64 {
    if ms > 30_000 {
        30_000
    } else {
        ms
    }
}

fn make_session_name() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("shell-{}", n)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::EventSink;
    use serde_json::json;
    use std::collections::HashSet;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    fn test_runtime() -> ToolRuntime {
        test_runtime_at(std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
    }

    fn test_runtime_at(workspace_cwd: PathBuf) -> ToolRuntime {
        let backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace_cwd);
        ToolRuntime {
            config_cwd: workspace_cwd.clone(),
            workspace_cwd,
            store_path: PathBuf::new(),
            session_id: None,
            worker_executable: None,
            active_threads: Arc::new(Mutex::new(HashSet::new())),
            event_sink: EventSink::none(),
            backend,
            mcp: None,
            skills: None,
            terminal_manager: crate::terminal::TerminalManager::new(),
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
        }
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_exec_{label}_{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ------------------------------------------------------------------
    // exec_command
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn exec_command_definition_shape() {
        let def = exec_command_definition();
        assert_eq!(def.function.name, "exec_command");
        assert!(def.function.description.contains("tty=true"));
        assert!(def
            .function
            .parameters
            .get("required")
            .and_then(|v| v.as_array())
            .is_some());
    }

    #[tokio::test]
    async fn exec_command_missing_cmd_fails() {
        let result = execute_exec_command(&json!({}), &test_runtime()).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("missing required argument"));
    }

    #[tokio::test]
    async fn exec_command_defaults_to_workspace_cwd() {
        let dir = unique_temp_dir("default_cwd");
        let output = execute_exec_command(
            &json!({ "cmd": "pwd", "tty": false, "yield_time_ms": 2000 }),
            &test_runtime_at(dir.clone()),
        )
        .await
        .unwrap();

        let parsed: Value = serde_json::from_str(&output).unwrap();
        let actual = PathBuf::from(parsed["output"].as_str().unwrap().trim())
            .canonicalize()
            .unwrap();
        assert_eq!(actual, dir.canonicalize().unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn exec_command_relative_workdir_resolves_under_workspace_cwd() {
        let dir = unique_temp_dir("relative_workdir");
        std::fs::create_dir_all(dir.join("subdir")).unwrap();
        let output = execute_exec_command(
            &json!({ "cmd": "pwd", "workdir": "subdir", "tty": false, "yield_time_ms": 2000 }),
            &test_runtime_at(dir.clone()),
        )
        .await
        .unwrap();

        let parsed: Value = serde_json::from_str(&output).unwrap();
        let actual = PathBuf::from(parsed["output"].as_str().unwrap().trim())
            .canonicalize()
            .unwrap();
        assert_eq!(actual, dir.join("subdir").canonicalize().unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn exec_command_one_shot_echo() {
        let result = execute_exec_command(
            &json!({ "cmd": "echo hello-world", "tty": false, "yield_time_ms": 2000 }),
            &test_runtime(),
        )
        .await;
        assert!(result.is_ok(), "error: {:?}", result.err());
        let output = result.unwrap();
        assert!(output.contains("hello-world"), "got: {}", output);
        let parsed: Value = serde_json::from_str(&output).unwrap();
        assert!(parsed["session_name"].is_null());
        assert_eq!(parsed["exit_code"].as_i64(), Some(0));
    }

    #[tokio::test]
    async fn exec_command_one_shot_multiline() {
        let result = execute_exec_command(
            &json!({ "cmd": "echo line1 && echo line2", "tty": false, "yield_time_ms": 2000 }),
            &test_runtime(),
        )
        .await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(
            output.contains("line1") && output.contains("line2"),
            "got: {}",
            output
        );
    }

    #[tokio::test]
    async fn exec_command_one_shot_nonzero_exit_code() {
        let output = execute_exec_command(
            &json!({ "cmd": "echo failure >&2; exit 7", "tty": false }),
            &test_runtime(),
        )
        .await
        .unwrap();
        let parsed: Value = serde_json::from_str(&output).unwrap();
        assert!(parsed["output"].as_str().unwrap().contains("failure"));
        assert_eq!(parsed["exit_code"].as_i64(), Some(7));
        assert!(parsed["session_name"].is_null());
    }

    #[tokio::test]
    async fn exec_command_one_shot_returns_on_early_exit() {
        let start = std::time::Instant::now();
        let output = execute_exec_command(
            &json!({ "cmd": "sleep 0.05; echo done", "tty": false, "yield_time_ms": 30000 }),
            &test_runtime(),
        )
        .await
        .unwrap();
        assert!(
            start.elapsed() < std::time::Duration::from_secs(2),
            "one-shot command waited for yield_time_ms"
        );
        let parsed: Value = serde_json::from_str(&output).unwrap();
        assert_eq!(parsed["exit_code"].as_i64(), Some(0));
        assert!(parsed["output"].as_str().unwrap().contains("done"));
    }

    #[tokio::test]
    async fn exec_command_one_shot_yield_time_is_timeout() {
        let start = std::time::Instant::now();
        let output = execute_exec_command(
            &json!({ "cmd": "echo before; sleep 5; echo SHOULD_NOT_PRINT", "tty": false, "yield_time_ms": 100 }),
            &test_runtime(),
        )
        .await
        .unwrap();
        assert!(
            start.elapsed() < std::time::Duration::from_secs(2),
            "one-shot command did not time out promptly"
        );
        let parsed: Value = serde_json::from_str(&output).unwrap();
        let text = parsed["output"].as_str().unwrap();
        assert!(text.contains("timed out after 100ms"), "got: {}", text);
        assert!(text.contains("before"), "got: {}", text);
        assert!(!text.contains("SHOULD_NOT_PRINT"), "got: {}", text);
        assert!(parsed["exit_code"].is_null(), "got: {}", output);
        assert!(parsed["session_name"].is_null());
    }

    #[tokio::test]
    async fn exec_command_one_shot_timeout_kills_child_processes() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let marker = std::env::temp_dir().join(format!("nac_exec_timeout_leak_{}", unique));
        let cmd = format!("(sleep 1; touch {}) & wait", marker.display());

        let output = execute_exec_command(
            &json!({ "cmd": cmd, "tty": false, "yield_time_ms": 100 }),
            &test_runtime(),
        )
        .await
        .unwrap();
        let parsed: Value = serde_json::from_str(&output).unwrap();
        assert!(parsed["exit_code"].is_null(), "got: {}", output);

        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        assert!(
            !marker.exists(),
            "timed-out command left a child process running"
        );
    }

    #[tokio::test]
    async fn exec_command_one_shot_large_output_keeps_tail() {
        let output = execute_exec_command(
            &json!({
                "cmd": "for i in $(seq 1 120); do echo line$i; done",
                "tty": false,
                "max_output_chars": 200
            }),
            &test_runtime(),
        )
        .await
        .unwrap();
        let parsed: Value = serde_json::from_str(&output).unwrap();
        let text = parsed["output"].as_str().unwrap();
        assert!(text.contains("line1"), "got: {}", text);
        assert!(text.contains("line120"), "got: {}", text);
        assert_eq!(parsed["output_truncated"].as_bool(), Some(true));
    }

    #[tokio::test]
    async fn exec_command_persistent_creates_session() {
        let result = execute_exec_command(
            &json!({ "cmd": "echo persistent-test", "tty": true, "yield_time_ms": 2000 }),
            &test_runtime(),
        )
        .await;
        assert!(result.is_ok(), "error: {:?}", result.err());
        let output = result.unwrap();
        let parsed: Value = serde_json::from_str(&output).unwrap();
        let session_name = parsed["session_name"].as_str().unwrap();
        assert!(session_name.starts_with("shell-"), "got: {}", session_name);
        assert!(output.contains("persistent-test"), "got: {}", output);
    }

    #[tokio::test]
    async fn exec_command_persistent_empty_cmd() {
        let result = execute_exec_command(
            &json!({ "cmd": "", "tty": true, "yield_time_ms": 2000 }),
            &test_runtime(),
        )
        .await;
        assert!(result.is_ok(), "error: {:?}", result.err());
        let parsed: Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert!(parsed["session_name"].is_string());
    }

    // ------------------------------------------------------------------
    // write_stdin
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn write_stdin_definition_shape() {
        let def = write_stdin_definition();
        assert_eq!(def.function.name, "write_stdin");
        let required = def
            .function
            .parameters
            .get("required")
            .and_then(|v| v.as_array())
            .unwrap();
        assert!(required.iter().any(|v| v.as_str() == Some("session_id")));
    }

    #[tokio::test]
    async fn write_stdin_missing_session_id_fails() {
        assert!(execute_write_stdin(&json!({}), &test_runtime())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn write_stdin_session_not_found() {
        let result = execute_write_stdin(
            &json!({ "session_id": "nonexistent", "chars": "echo hi<RET>" }),
            &test_runtime(),
        )
        .await;
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[tokio::test]
    async fn write_stdin_poll_output() {
        let runtime = test_runtime();
        runtime
            .terminal_manager
            .create("test-poll".to_string(), None, 120, 40, &runtime.backend)
            .await
            .unwrap();
        runtime
            .terminal_manager
            .write_stdin("test-poll", "echo poll-me\n", 2000, 8000)
            .await
            .unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-poll", "chars": "", "yield_time_ms": 500 }),
            &runtime,
        )
        .await;
        assert!(result.is_ok(), "error: {:?}", result.err());
        runtime.terminal_manager.remove("test-poll").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_send_input() {
        let runtime = test_runtime();
        runtime
            .terminal_manager
            .create("test-input".to_string(), None, 120, 40, &runtime.backend)
            .await
            .unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-input", "chars": "echo from-stdin<RET>", "yield_time_ms": 2000 }),
            &runtime,
        ).await;
        assert!(result.is_ok(), "error: {:?}", result.err());
        assert!(result.unwrap().contains("from-stdin"));
        runtime.terminal_manager.remove("test-input").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_allows_raw_text_without_terminator() {
        let runtime = test_runtime();
        runtime
            .terminal_manager
            .create("test-raw".to_string(), None, 120, 40, &runtime.backend)
            .await
            .unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-raw", "chars": "echo buffered", "yield_time_ms": 100 }),
            &runtime,
        )
        .await;
        assert!(result.is_ok(), "raw text was rejected: {:?}", result.err());
        runtime.terminal_manager.remove("test-raw").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_allows_pure_control_key_c_c() {
        // <C-c> is a signal, not buffered — must pass without terminator
        let runtime = test_runtime();
        runtime
            .terminal_manager
            .create("test-ctrl".to_string(), None, 120, 40, &runtime.backend)
            .await
            .unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-ctrl", "chars": "<C-c>", "yield_time_ms": 1000 }),
            &runtime,
        )
        .await;
        // <C-c> may kill the process, so output may vary; we just care that
        // validation didn't reject it.
        assert!(result.is_ok(), "validation error: {:?}", result.err());
        runtime.terminal_manager.remove("test-ctrl").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_allows_pure_control_key_c_z() {
        let runtime = test_runtime();
        runtime
            .terminal_manager
            .create("test-ctrz".to_string(), None, 120, 40, &runtime.backend)
            .await
            .unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-ctrz", "chars": "<C-z>", "yield_time_ms": 1000 }),
            &runtime,
        )
        .await;
        assert!(result.is_ok(), "validation error: {:?}", result.err());
        runtime.terminal_manager.remove("test-ctrz").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_allows_arrow_key_without_terminator() {
        let runtime = test_runtime();
        runtime
            .terminal_manager
            .create("test-arrow".to_string(), None, 120, 40, &runtime.backend)
            .await
            .unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-arrow", "chars": "<UP>", "yield_time_ms": 1000 }),
            &runtime,
        )
        .await;
        assert!(result.is_ok(), "validation error: {:?}", result.err());
        runtime.terminal_manager.remove("test-arrow").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_allows_tab_without_terminator() {
        let runtime = test_runtime();
        runtime
            .terminal_manager
            .create("test-tab".to_string(), None, 120, 40, &runtime.backend)
            .await
            .unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-tab", "chars": "<TAB>", "yield_time_ms": 1000 }),
            &runtime,
        )
        .await;
        assert!(result.is_ok(), "validation error: {:?}", result.err());
        runtime.terminal_manager.remove("test-tab").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_returns_exit_metadata_and_clears_session() {
        let runtime = test_runtime();
        runtime
            .terminal_manager
            .create("test-exit".to_string(), None, 120, 40, &runtime.backend)
            .await
            .unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-exit", "chars": "exit<RET>", "yield_time_ms": 2000 }),
            &runtime,
        )
        .await
        .unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        assert!(parsed["session_name"].is_null(), "got: {}", result);
        assert_eq!(parsed["exit_code"].as_i64(), Some(0));
        assert!(runtime.terminal_manager.get("test-exit").await.is_none());
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn clamp_yield_edge() {
        assert_eq!(clamp_yield(0), 0);
        assert_eq!(clamp_yield(15_000), 15_000);
        assert_eq!(clamp_yield(60_000), 30_000);
    }

    #[tokio::test]
    async fn make_session_name_increments() {
        let a = make_session_name();
        let b = make_session_name();
        assert_ne!(a, b);
        assert!(a.starts_with("shell-"));
        assert!(b.starts_with("shell-"));
    }
}
