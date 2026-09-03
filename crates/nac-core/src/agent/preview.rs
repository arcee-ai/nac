use std::borrow::Cow;

use super::*;

pub(super) fn preview(value: &str, max_len: usize) -> String {
    let sanitized = value.replace('\n', "\\n");
    if sanitized.len() <= max_len {
        sanitized
    } else {
        let mut end = max_len;
        while !sanitized.is_char_boundary(end) {
            end -= 1;
        }
        // The cut can land on trailing dots — its own, or the marker a caller
        // already appended to stand for the lines it left out — and stacking
        // three more onto those reads as four or five.
        let head = sanitized[..end].trim_end_matches(|c: char| c == '.' || c.is_whitespace());
        format!("{head}...")
    }
}

pub(super) fn tool_args_detail(args: &str) -> String {
    preview(args, TOOL_ARGS_DETAIL_LIMIT)
}

pub(super) fn preview_tool_args(name: &str, args_str: &str) -> String {
    let parsed = serde_json::from_str::<serde_json::Value>(args_str).ok();
    match name {
        "read" | "write" | "edit" => {
            if let Some(path) = parsed
                .as_ref()
                .and_then(|value| value.get("path"))
                .and_then(|value| value.as_str())
            {
                return preview(path, 120);
            }
        }
        "exec_command" => {
            if let Some(command) = parsed
                .as_ref()
                .and_then(|value| value.get("cmd"))
                .and_then(|value| value.as_str())
            {
                return preview(command, 120);
            }
        }
        "thread" => {
            if let Some(value) = parsed.as_ref() {
                let thread_name = value
                    .get("name")
                    .and_then(|item| item.as_str())
                    .unwrap_or("?");
                let action = value
                    .get("action")
                    .and_then(|item| item.as_str())
                    .unwrap_or("dispatch");
                return preview(&format!("{thread_name}: {action}"), 120);
            }
        }
        _ => {}
    }

    preview(args_str, 120)
}

fn truncate_string(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max).collect();
        format!("{truncated}…")
    }
}

/// Extract a short human-readable preview of the key argument for a tool call.
/// This survives sanitization and is used by the UI for compact display.
pub(crate) fn key_arg_preview(
    tool_name: &str,
    args_detail: Option<&str>,
    args_preview: &str,
) -> String {
    let args_json = args_detail.unwrap_or(args_preview);
    let Ok(obj) = serde_json::from_str::<serde_json::Value>(args_json) else {
        return String::new();
    };
    let get_str = |key: &str| {
        obj.get(key)
            .and_then(|v| v.as_str())
            .map(std::string::ToString::to_string)
    };

    match tool_name {
        "read" | "write" | "edit" => get_str("path")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "exec_command" => get_str("cmd")
            .or_else(|| get_str("command"))
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_else(|| {
                let workdir = get_str("workdir").unwrap_or_default();
                if !workdir.is_empty() {
                    format!("(in {})", truncate_string(&workdir, 80))
                } else {
                    String::new()
                }
            }),
        "write_stdin" => {
            if let Some(session_id) = get_str("session_id") {
                let input_chars = get_str("chars").map_or(0, |chars| chars.chars().count());
                if input_chars == 0 {
                    format!("→ {}", truncate_string(&session_id, 40))
                } else {
                    format!(
                        "→ {} ({input_chars} input chars)",
                        truncate_string(&session_id, 40)
                    )
                }
            } else {
                String::new()
            }
        }
        "read_command_output" => get_str("output_id")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "glob" => get_str("pattern")
            .or_else(|| get_str("root"))
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "grep" => get_str("pattern")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "web_search" => get_str("query")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "web_fetch" => get_str("url")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "create_goal" => get_str("objective")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "get_goal" => "current goal".to_string(),
        "update_goal" => get_str("status")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "session_spawn" | "subagent" | "orchestrator_launch" => get_str("description")
            .or_else(|| get_str("child_session_id"))
            .or_else(|| get_str("orchestrator_session_id"))
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "session_status" | "session_read" | "session_wait" | "session_cancel" | "session_steer"
        | "subagent_status" | "subagent_cancel" => get_str("child_session_id")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "orchestrator_status"
        | "orchestrator_read"
        | "orchestrator_wait"
        | "orchestrator_cancel"
        | "orchestrator_steer" => get_str("orchestrator_session_id")
            .or_else(|| get_str("child_session_id"))
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "thread" => {
            let name = get_str("name").unwrap_or_default();
            let action = get_str("action").unwrap_or_default();
            if !name.is_empty() && !action.is_empty() {
                truncate_string(&format!("{name}: {action}"), 120)
            } else if !name.is_empty() {
                truncate_string(&name, 120)
            } else {
                String::new()
            }
        }
        "thread_read" | "thread_delete" => get_str("name")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        "threads" | "workset_list" => "list".to_string(),
        "workset_define" => {
            let id = get_str("id").unwrap_or_default();
            let goal = get_str("goal").unwrap_or_default();
            if !id.is_empty() && !goal.is_empty() {
                truncate_string(&format!("{id}: {goal}"), 120)
            } else if !id.is_empty() {
                truncate_string(&id, 120)
            } else {
                String::new()
            }
        }
        "workset_read" => get_str("id")
            .map(|value| truncate_string(&value, 120))
            .unwrap_or_default(),
        _ if tool_name.starts_with("mcp__") => {
            for key in &[
                "query",
                "path",
                "url",
                "command",
                "pattern",
                "libraryName",
                "name",
                "input",
            ] {
                if let Some(val) = get_str(key) {
                    return truncate_string(&val, 120);
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

pub(crate) fn preview_tool_result(name: &str, result: &ToolResult) -> String {
    let rendered = match result.content.as_text() {
        Some(text) => Cow::Borrowed(text),
        None => Cow::Owned(result.content.preview()),
    };
    let trimmed = rendered.trim();
    if trimmed.is_empty() && !result.is_error {
        return "ok".to_string();
    }

    if result.is_error {
        if let Some(message) = json_string_field(trimmed, "message") {
            return preview(&message, 160);
        }
    }

    if name == "exec_command" {
        if let Some(summary) = preview_exec_command_result(trimmed) {
            return preview(&summary, 160);
        }
    }
    if matches!(name, "read" | "write" | "edit") {
        if let Some(summary) = preview_json_tool_result(trimmed) {
            return preview(&summary, 160);
        }
    }

    let lines: Vec<&str> = rendered
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        return preview(trimmed, 160);
    }

    let more = ellipsis(lines.len());
    if let Some(summary) = select_summary_line(name, &lines) {
        return preview(&format!("{summary}{more}"), 160);
    }

    preview(&format!("{}{more}", lines[0]), 160)
}

fn json_string_field(content: &str, key: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(content)
        .ok()?
        .get(key)?
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn preview_json_tool_result(content: &str) -> Option<String> {
    let parsed = serde_json::from_str::<serde_json::Value>(content).ok()?;
    if parsed.get("error").is_some() {
        if let Some(message) = parsed
            .get("message")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
        {
            return Some(message.to_string());
        }
        if let Some(error) = parsed.get("error").and_then(|value| value.as_str()) {
            return Some(error.to_string());
        }
        return None;
    }
    parsed
        .get("path")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

/// Marks a preview that stands in for more than the one line it shows.
///
/// A log line has room for a single line of what a tool printed, and without
/// this the line it picked reads as everything there was — a grep that found
/// eight matches looks like it found the one under the command.
fn ellipsis(line_count: usize) -> &'static str {
    if line_count > 1 {
        "..."
    } else {
        ""
    }
}

pub(super) fn select_summary_line<'a>(_name: &str, lines: &'a [&'a str]) -> Option<&'a str> {
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.starts_with("Exit code:"))
    {
        return Some(line);
    }
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.starts_with("Command timed out after"))
    {
        return Some(line);
    }
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.contains("test result:"))
    {
        return Some(line);
    }
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.starts_with("Finished `"))
    {
        return Some(line);
    }
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.starts_with("error:"))
    {
        return Some(line);
    }
    None
}

pub(super) fn preview_exec_command_result(content: &str) -> Option<String> {
    let parsed = serde_json::from_str::<serde_json::Value>(content).ok()?;
    if let Some(preview) = parsed
        .get("content_preview")
        .and_then(|value| value.as_str())
    {
        let preview = preview.trim();
        if !preview.is_empty() {
            let summary = preview.lines().last().unwrap_or(preview).trim();
            return Some(
                match parsed.get("exit_code").and_then(serde_json::Value::as_i64) {
                    Some(code) if code != 0 => format!("exit {code}: {summary}"),
                    _ => summary.to_string(),
                },
            );
        }
        if let Some(session) = parsed.get("session_name").and_then(|value| value.as_str()) {
            return Some(format!("session {session}"));
        }
    }

    let stdout = parsed
        .get("stdout_preview")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let stderr = parsed
        .get("stderr_preview")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let lines: Vec<&str> = stderr
        .lines()
        .chain(stdout.lines())
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let summary =
        select_summary_line("exec_command_output", &lines).or_else(|| lines.last().copied());
    let status = parsed
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("completed");
    let exit_code = parsed.get("exit_code").and_then(serde_json::Value::as_i64);
    let more = ellipsis(lines.len());

    match (status, exit_code, summary) {
        ("completed", Some(0), Some(summary)) => Some(format!("{summary}{more}")),
        ("completed", Some(code), Some(summary)) => Some(format!("exit {code}: {summary}{more}")),
        ("completed", Some(code), None) => Some(format!("exit {code}")),
        ("timed_out", _, Some(summary)) => Some(format!("timed out: {summary}{more}")),
        ("timed_out", _, None) => Some("timed out".to_string()),
        ("cancelled", _, Some(summary)) => Some(format!("cancelled: {summary}{more}")),
        ("cancelled", _, None) => Some("cancelled".to_string()),
        ("spawn_error", _, Some(summary)) => Some(format!("spawn error: {summary}{more}")),
        ("spawn_error", _, None) => Some("spawn error".to_string()),
        (_, _, Some(summary)) => Some(format!("{summary}{more}")),
        (_, _, None) => parsed
            .get("session_name")
            .and_then(|value| value.as_str())
            .map(|session| format!("session {session}")),
    }
}
