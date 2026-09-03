//! Terminal-backed command execution and retained output pagination tools.

use anyhow::{anyhow, Result};
use serde_json::Value;
use std::path::PathBuf;

use crate::terminal::{
    CommandStatus, OutputStream, DEFAULT_OUTPUT_PAGE_BYTES, MAX_OUTPUT_PAGE_BYTES,
};
use crate::tools::{ToolResult, ToolRuntime};
use crate::types::{FunctionDef, ToolDefinition};

pub fn exec_command_definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "exec_command".to_string(),
            description: "Execute a shell command. One-shot commands run non-interactively and return structured status, separate concise stdout/stderr previews, and an output_id. Git, Git Credential Manager, and GitHub CLI terminal prompts are disabled in this mode, so configure credentials in advance. A completed command may have a non-zero exit_code. If truncated=true or overflowed=true, call read_command_output with the output_id instead of rerunning or filtering the command. Use tty=true only for a foreground program that needs a PTY. Opaque commands and broad shells/interpreters require explicit direct-session approval. An accepted PTY can be polled, receive separately approved input on its exact handle, or be explicitly retained with write_stdin."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "cmd": { "type": "string", "description": "Shell command to execute" },
                    "workdir": { "type": "string", "description": "Working directory (default: project root)" },
                    "tty": { "type": "boolean", "description": "Use a persistent PTY session (default: false)" },
                    "yield_time_ms": { "type": "number", "description": "One-shot timeout or PTY poll duration in milliseconds (max: 3600000)" },
                    "max_output_chars": { "type": "number", "description": "Shared concise preview budget (default: 8000); omitted bytes remain pageable" }
                },
                "required": ["cmd"]
            }),
        },
    }
}

pub fn write_stdin_definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "write_stdin".to_string(),
            description: "Continue a foreground terminal from exec_command tty=true. Empty chars only observe; nonempty chars are a separately approved mutation of the exact process-local terminal handle and may be interpreted by that process as commands. Such approval is once-only and cannot create a reusable grant. Set retain=true with empty chars to transition a live terminal into a session-owned background handle that survives the end of a direct run. The returned preview cursor advances without deleting retained output; call read_command_output with its output_id and an older cursor to recover omitted text."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Session ID returned by exec_command" },
                    "chars": { "type": "string", "description": "Empty polls output without mutation. Nonempty input is sent only after a separate once-only approval bound to this exact terminal handle; key tokens such as <RET> are supported." },
                    "retain": { "type": "boolean", "description": "Explicitly retain this live terminal across direct run boundaries (default: false)" },
                    "yield_time_ms": { "type": "number", "description": "Maximum poll duration in milliseconds (default: 500, max: 3600000)" },
                    "max_output_chars": { "type": "number", "description": "Concise preview budget (default: 8000)" }
                },
                "required": ["session_id"]
            }),
        },
    }
}

pub fn read_command_output_definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "read_command_output".to_string(),
            description: "Read retained command or PTY output without rerunning the command. Offsets and limits are raw bytes. Page combined (observed emission order), stdout, or stderr; PTYs support combined only. Continue with next_offset until eof. If overflowed=true, offset may advance to the earliest retained byte. Output remains available for the producing worker dispatch."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "output_id": { "type": "string", "description": "Output ID returned by exec_command or write_stdin" },
                    "stream": { "type": "string", "enum": ["combined", "stdout", "stderr"], "default": "combined" },
                    "offset": { "type": "integer", "minimum": 0, "default": 0, "description": "Absolute byte offset" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_OUTPUT_PAGE_BYTES, "default": DEFAULT_OUTPUT_PAGE_BYTES }
                },
                "required": ["output_id"]
            }),
        },
    }
}

pub async fn execute_exec_command(args: &Value, runtime: &ToolRuntime) -> ToolResult {
    match execute_exec_command_inner(args, runtime).await {
        Ok((content, is_error)) => ToolResult {
            content: content.into(),
            is_error,
        },
        Err(error) => ToolResult {
            content: (format!("Error: {error:#}")).into(),
            is_error: true,
        },
    }
}

async fn execute_exec_command_inner(args: &Value, runtime: &ToolRuntime) -> Result<(String, bool)> {
    if runtime.command_cancellation.is_cancelled() {
        return Err(anyhow!(
            "run was cancelled before the command process could start"
        ));
    }
    let manager = &runtime.terminal_manager;
    let cmd = require_str(args, "cmd")?;
    let tty = args.get("tty").and_then(Value::as_bool).unwrap_or(false);
    let default_yield_ms = if tty { 500 } else { 30_000 };
    let yield_ms = clamp_yield(
        args.get("yield_time_ms")
            .and_then(Value::as_u64)
            .unwrap_or(default_yield_ms),
    );
    let max_output = args
        .get("max_output_chars")
        .and_then(Value::as_u64)
        .unwrap_or(8_000) as usize;
    let cwd = resolve_command_cwd(args, runtime)?;
    let command_environment = runtime.command_environment_snapshot().await?;
    let extra_envs = command_environment
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect::<Vec<_>>();

    if !tty {
        let output = manager
            .exec_one_shot_with_environment(
                &cmd,
                cwd,
                120,
                40,
                yield_ms,
                max_output,
                &runtime.backend,
                Some(&runtime.command_cancellation),
                &extra_envs,
            )
            .await;
        if let Some(output_id) = output.output_id.as_deref() {
            runtime.remember_output_environment(output_id, command_environment.clone());
        }
        let is_error = output.status == CommandStatus::SpawnError;
        return Ok((
            command_environment.redact(&serde_json::to_string_pretty(&output)?),
            is_error,
        ));
    }

    let session_name = manager.next_session_name();
    manager
        .create_with_environment(
            session_name.clone(),
            &cmd,
            cwd,
            120,
            40,
            &runtime.backend,
            Some(&runtime.command_cancellation),
            &extra_envs,
        )
        .await?;
    let output = manager
        .write_stdin(
            &session_name,
            "",
            yield_ms,
            max_output,
            Some(&runtime.command_cancellation),
        )
        .await?;
    runtime.remember_output_environment(&output.output_id, command_environment.clone());
    Ok((
        command_environment.redact(&serde_json::to_string_pretty(&output)?),
        false,
    ))
}

pub async fn execute_write_stdin(args: &Value, runtime: &ToolRuntime) -> ToolResult {
    let result: Result<_> = async {
        let session_id = require_str(args, "session_id")?;
        let chars = args.get("chars").and_then(Value::as_str).unwrap_or("");
        let retain = args.get("retain").and_then(Value::as_bool).unwrap_or(false);
        let yield_ms = clamp_yield(
            args.get("yield_time_ms")
                .and_then(Value::as_u64)
                .unwrap_or(500),
        );
        let max_output = args
            .get("max_output_chars")
            .and_then(Value::as_u64)
            .unwrap_or(8_000) as usize;
        let mut output = runtime
            .terminal_manager
            .write_stdin(
                &session_id,
                chars,
                yield_ms,
                max_output,
                Some(&runtime.command_cancellation),
            )
            .await?;
        if retain && output.session_name.is_some() {
            runtime
                .terminal_manager
                .retain_with_cancellation(&session_id, Some(&runtime.command_cancellation))
                .await?;
            output.retained = true;
        }
        let rendered = serde_json::to_string_pretty(&output)?;
        let redacted = runtime.redact_output(&output.output_id, &rendered)?;
        Ok(redacted)
    }
    .await;

    match result {
        Ok(redacted) => ToolResult {
            content: redacted.into(),
            is_error: false,
        },
        Err(error) => ToolResult {
            content: (format!("Error: {error:#}")).into(),
            is_error: true,
        },
    }
}

pub fn execute_read_command_output(args: &Value, runtime: &ToolRuntime) -> ToolResult {
    let result = (|| -> Result<String> {
        let output_id = require_str(args, "output_id")?;
        let stream = OutputStream::parse(args.get("stream").and_then(Value::as_str))?;
        let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0);
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_OUTPUT_PAGE_BYTES as u64) as usize;
        let page = runtime
            .terminal_manager
            .read_output(&output_id, stream, offset, limit)?;
        let rendered = serde_json::to_string_pretty(&page)?;
        runtime.redact_output(&output_id, &rendered)
    })();

    match result {
        Ok(content) => ToolResult {
            content: content.into(),
            is_error: false,
        },
        Err(error) => ToolResult {
            content: (format!("Error: {error:#}")).into(),
            is_error: true,
        },
    }
}

fn resolve_command_cwd(args: &Value, runtime: &ToolRuntime) -> Result<Option<PathBuf>> {
    let requested = args.get("workdir").and_then(Value::as_str);
    runtime.backend.resolve_terminal_cwd(requested)
}

fn require_str(args: &Value, key: &str) -> Result<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("missing required argument '{key}'"))
}

const MAX_YIELD_MS: u64 = 3_600_000;

fn clamp_yield(ms: u64) -> u64 {
    ms.min(MAX_YIELD_MS)
}

#[cfg(test)]
#[path = "exec_command_tests.rs"]
mod tests;
