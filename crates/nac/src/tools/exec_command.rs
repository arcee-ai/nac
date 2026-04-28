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
Use tty=false (default) for one-shot commands like `cargo build`, `npm test`, `git status`, `ls`, etc. \
The command runs to completion and returns output + exit code.\n\n\
Use tty=true for:\n\
- Interactive REPLs (python, node, etc.)\n\
- Long-running multi-step workflows where you need shell state to persist across calls \
(cd into a directory, set env vars, then run commands)\n\
- When you need more than one command in the same shell session\n\n\
When tty=true, you get a session_name back. Use write_stdin to continue interacting with that session."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "cmd": { "type": "string", "description": "Shell command to execute" },
                    "workdir": { "type": "string", "description": "Working directory for the command (default: project root)" },
                    "tty": { "type": "boolean", "description": "Allocate a PTY for interactive/persistent use (default: false)" },
                    "yield_time_ms": { "type": "number", "description": "Maximum time to wait for output in milliseconds (default: 500, max: 30000)" },
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
    let yield_ms = clamp_yield(args.get("yield_time_ms").and_then(|v| v.as_u64()).unwrap_or(500));
    let max_output = args.get("max_output_chars").and_then(|v| v.as_u64()).unwrap_or(8000) as usize;
    let cwd = args.get("workdir").and_then(|v| v.as_str()).map(PathBuf::from);

    if !tty {
        let output = manager.exec_one_shot(&cmd, cwd, 120, 40, yield_ms, max_output, runtime.sandbox.as_ref()).await?;
        return Ok(serde_json::to_string_pretty(&output)?);
    }

    let session_name = make_session_name();
    let _info = manager.create(session_name.clone(), cwd, 120, 40, runtime.sandbox.as_ref()).await?;

    if cmd.trim().is_empty() {
        let output = manager.write_stdin(&session_name, "", 200, max_output).await?;
        let alive = manager.get(&session_name).await.map(|i| i.alive).unwrap_or(false);
        if !alive {
            let _ = manager.remove(&session_name).await;
            return Ok(serde_json::to_string_pretty(&serde_json::json!({
                "output": output.output,
                "exit_code": output.exit_code,
                "session_name": null,
                "wall_time_ms": output.wall_time_ms,
                "output_truncated": output.output_truncated,
            }))?);
        }
        return Ok(serde_json::to_string_pretty(&output)?);
    }

    let output = manager.write_stdin(&session_name, &format!("{}\r", cmd), yield_ms, max_output).await?;
    let alive = manager.get(&session_name).await.map(|i| i.alive).unwrap_or(false);
    if !alive {
        let _ = manager.remove(&session_name).await;
        return Ok(serde_json::to_string_pretty(&serde_json::json!({
            "output": output.output,
            "exit_code": output.exit_code,
            "session_name": null,
            "wall_time_ms": output.wall_time_ms,
            "output_truncated": output.output_truncated,
        }))?);
    }
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
    let yield_ms = clamp_yield(args.get("yield_time_ms").and_then(|v| v.as_u64()).unwrap_or(500));
    let max_output = args.get("max_output_chars").and_then(|v| v.as_u64()).unwrap_or(8000) as usize;

    // Require a line terminator on non-empty input that contains raw text.
    // Bash (and most shells) in canonical mode buffer input until they see
    // CR/LF.  Pure key sequences (<C-c>, <UP>, <TAB>, etc.) take effect
    // immediately and don't need a terminator.
    if !chars.is_empty() {
        let raw_text = strip_key_notation(chars);
        let has_raw_text = !raw_text.trim().is_empty();

        if has_raw_text {
            let lower = chars.to_lowercase();
            let has_terminator = lower.ends_with('\n')
                || lower.ends_with('\r')
                || lower.ends_with("<ret>")
                || lower.ends_with("<enter>")
                || lower.ends_with("<return>")
                || lower.ends_with("<c-m>")
                || lower.ends_with("<ctrl-m>")
                || lower.ends_with("<ctrl+m>")
                || lower.ends_with("<c-d>")
                || lower.ends_with("<ctrl-d>")
                || lower.ends_with("<ctrl+d>");
            if !has_terminator {
                return Err(anyhow!(
                    "chars must end with <RET> or <C-d> to execute the command; got: {:?}",
                    chars
                ));
            }
        }
    }

    if manager.get(&session_id).await.is_none() {
        return Err(anyhow!(
            "terminal session '{}' not found — it may have been closed or expired",
            session_id
        ));
    }

    let output = manager.write_stdin(&session_id, chars, yield_ms, max_output).await?;
    let alive = manager.get(&session_id).await.map(|i| i.alive).unwrap_or(false);
    if !alive {
        let _ = manager.remove(&session_id).await;
        return Ok(serde_json::to_string_pretty(&serde_json::json!({
            "output": output.output,
            "exit_code": output.exit_code,
            "session_name": null,
            "wall_time_ms": output.wall_time_ms,
            "output_truncated": output.output_truncated,
            "note": "session ended; session_name cleared",
        }))?);
    }
    Ok(serde_json::to_string_pretty(&output)?)
}

// ============================================================================
// Helpers
// ============================================================================

fn require_str(args: &Value, key: &str) -> Result<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("missing required argument '{}'", key))
}

fn clamp_yield(ms: u64) -> u64 {
    if ms > 30_000 { 30_000 } else { ms }
}

/// Strip all `<KEY>` bracket notation from a string, leaving only raw
/// text that would be buffered by a shell in canonical mode.  Used by
/// the terminator validator so pure key sequences (<C-c>, <UP>, etc.)
/// are not incorrectly rejected.
fn strip_key_notation(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '<' {
            // Consume until '>' or end-of-string
            for inner in chars.by_ref() {
                if inner == '>' {
                    break;
                }
            }
        } else {
            result.push(c);
        }
    }
    result
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
        ToolRuntime {
            store_path: PathBuf::new(),
            session_id: None,
            active_threads: Arc::new(Mutex::new(HashSet::new())),
            event_sink: EventSink::none(),
            sandbox: None,
            mcp: None,
            skills: None,
            activated_skills: Arc::new(Mutex::new(HashSet::new())),
            terminal_manager: crate::terminal::TerminalManager::new(),
        }
    }

    // ------------------------------------------------------------------
    // exec_command
    // ------------------------------------------------------------------

    #[tokio::test]
    async fn exec_command_definition_shape() {
        let def = exec_command_definition();
        assert_eq!(def.function.name, "exec_command");
        assert!(def.function.description.contains("tty=true"));
        assert!(def.function.parameters.get("required").and_then(|v| v.as_array()).is_some());
    }

    #[tokio::test]
    async fn exec_command_missing_cmd_fails() {
        let result = execute_exec_command(&json!({}), &test_runtime()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("missing required argument"));
    }

    #[tokio::test]
    async fn exec_command_one_shot_echo() {
        let result = execute_exec_command(
            &json!({ "cmd": "echo hello-world", "tty": false, "yield_time_ms": 2000 }),
            &test_runtime(),
        ).await;
        assert!(result.is_ok(), "error: {:?}", result.err());
        let output = result.unwrap();
        assert!(output.contains("hello-world"), "got: {}", output);
        let parsed: Value = serde_json::from_str(&output).unwrap();
        assert!(parsed["session_name"].is_null());
    }

    #[tokio::test]
    async fn exec_command_one_shot_multiline() {
        let result = execute_exec_command(
            &json!({ "cmd": "echo line1 && echo line2", "tty": false, "yield_time_ms": 2000 }),
            &test_runtime(),
        ).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("line1") && output.contains("line2"), "got: {}", output);
    }

    #[tokio::test]
    async fn exec_command_persistent_creates_session() {
        let result = execute_exec_command(
            &json!({ "cmd": "echo persistent-test", "tty": true, "yield_time_ms": 2000 }),
            &test_runtime(),
        ).await;
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
        ).await;
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
        let required = def.function.parameters.get("required").and_then(|v| v.as_array()).unwrap();
        assert!(required.iter().any(|v| v.as_str() == Some("session_id")));
    }

    #[tokio::test]
    async fn write_stdin_missing_session_id_fails() {
        assert!(execute_write_stdin(&json!({}), &test_runtime()).await.is_err());
    }

    #[tokio::test]
    async fn write_stdin_session_not_found() {
        let result = execute_write_stdin(
            &json!({ "session_id": "nonexistent", "chars": "echo hi<RET>" }),
            &test_runtime(),
        ).await;
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[tokio::test]
    async fn write_stdin_poll_output() {
        let runtime = test_runtime();
        runtime.terminal_manager.create("test-poll".to_string(), None, 120, 40, None).await.unwrap();
        runtime.terminal_manager.write_stdin("test-poll", "echo poll-me\n", 2000, 8000).await.unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-poll", "chars": "", "yield_time_ms": 500 }),
            &runtime,
        ).await;
        assert!(result.is_ok(), "error: {:?}", result.err());
        runtime.terminal_manager.remove("test-poll").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_send_input() {
        let runtime = test_runtime();
        runtime.terminal_manager.create("test-input".to_string(), None, 120, 40, None).await.unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-input", "chars": "echo from-stdin<RET>", "yield_time_ms": 2000 }),
            &runtime,
        ).await;
        assert!(result.is_ok(), "error: {:?}", result.err());
        assert!(result.unwrap().contains("from-stdin"));
        runtime.terminal_manager.remove("test-input").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_rejects_raw_text_without_terminator() {
        // "echo hello" without <RET> — bash would buffer it forever
        let result = execute_write_stdin(
            &json!({ "session_id": "any", "chars": "echo hello" }),
            &test_runtime(),
        ).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must end with"));
    }

    #[tokio::test]
    async fn write_stdin_allows_pure_control_key_c_c() {
        // <C-c> is a signal, not buffered — must pass without terminator
        let runtime = test_runtime();
        runtime.terminal_manager.create("test-ctrl".to_string(), None, 120, 40, None).await.unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-ctrl", "chars": "<C-c>", "yield_time_ms": 1000 }),
            &runtime,
        ).await;
        // <C-c> may kill the process, so output may vary; we just care that
        // validation didn't reject it.
        assert!(result.is_ok(), "validation error: {:?}", result.err());
        runtime.terminal_manager.remove("test-ctrl").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_allows_pure_control_key_c_z() {
        let runtime = test_runtime();
        runtime.terminal_manager.create("test-ctrz".to_string(), None, 120, 40, None).await.unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-ctrz", "chars": "<C-z>", "yield_time_ms": 1000 }),
            &runtime,
        ).await;
        assert!(result.is_ok(), "validation error: {:?}", result.err());
        runtime.terminal_manager.remove("test-ctrz").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_allows_arrow_key_without_terminator() {
        let runtime = test_runtime();
        runtime.terminal_manager.create("test-arrow".to_string(), None, 120, 40, None).await.unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-arrow", "chars": "<UP>", "yield_time_ms": 1000 }),
            &runtime,
        ).await;
        assert!(result.is_ok(), "validation error: {:?}", result.err());
        runtime.terminal_manager.remove("test-arrow").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_allows_tab_without_terminator() {
        let runtime = test_runtime();
        runtime.terminal_manager.create("test-tab".to_string(), None, 120, 40, None).await.unwrap();
        let result = execute_write_stdin(
            &json!({ "session_id": "test-tab", "chars": "<TAB>", "yield_time_ms": 1000 }),
            &runtime,
        ).await;
        assert!(result.is_ok(), "validation error: {:?}", result.err());
        runtime.terminal_manager.remove("test-tab").await.ok();
    }

    #[tokio::test]
    async fn write_stdin_mixed_raw_text_and_control_still_needs_terminator() {
        // "echo hi<C-c>" has raw text that needs execution but no terminator
        let result = execute_write_stdin(
            &json!({ "session_id": "any", "chars": "echo hi<C-c>" }),
            &test_runtime(),
        ).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must end with"));
    }

    #[tokio::test]
    async fn strip_key_notation_removes_all_brackets() {
        assert_eq!(strip_key_notation("<C-c>"), "");
        assert_eq!(strip_key_notation("<UP><DOWN>"), "");
        assert_eq!(strip_key_notation("echo hello<RET>"), "echo hello");
        assert_eq!(strip_key_notation("<C-c>echo<RET>"), "echo");
        assert_eq!(strip_key_notation("no brackets here"), "no brackets here");
        assert_eq!(strip_key_notation("<UNKNOWN>text"), "text");
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
