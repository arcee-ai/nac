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
        format!("{}...", &sanitized[..end])
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
        return truncate_string(args_preview, 120);
    };
    let get_str = |key: &str| obj.get(key).and_then(|v| v.as_str()).map(|s| s.to_string());

    match tool_name {
        "read" | "write" | "edit" => {
            get_str("path").unwrap_or_else(|| truncate_string(args_preview, 120))
        }
        "exec_command" => get_str("cmd")
            .or_else(|| get_str("command"))
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
                let chars = get_str("chars")
                    .map(|c| truncate_string(&c, 60))
                    .unwrap_or_default();
                if chars.is_empty() {
                    format!("→ {}", truncate_string(&session_id, 40))
                } else {
                    format!("→ {chars}")
                }
            } else {
                truncate_string(args_preview, 120)
            }
        }
        "thread" => {
            let name = get_str("name").unwrap_or_default();
            let action = get_str("action").unwrap_or_default();
            if !name.is_empty() && !action.is_empty() {
                truncate_string(&format!("{name}: {action}"), 120)
            } else if !name.is_empty() {
                truncate_string(&name, 120)
            } else {
                truncate_string(args_preview, 120)
            }
        }
        "thread_read" | "thread_delete" => {
            get_str("name").unwrap_or_else(|| truncate_string(args_preview, 120))
        }
        "threads" => "list".to_string(),
        "workset_define" => {
            let id = get_str("id").unwrap_or_default();
            let goal = get_str("goal").unwrap_or_default();
            if !id.is_empty() && !goal.is_empty() {
                truncate_string(&format!("{id}: {goal}"), 120)
            } else if !id.is_empty() {
                truncate_string(&id, 120)
            } else {
                truncate_string(args_preview, 120)
            }
        }
        "workset_read" => get_str("id").unwrap_or_else(|| truncate_string(args_preview, 120)),
        "workset_list" => "list".to_string(),
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
            truncate_string(args_preview, 120)
        }
        _ => truncate_string(args_preview, 120),
    }
}

pub(super) fn preview_tool_result(name: &str, result: &ToolResult) -> String {
    let trimmed = result.content.trim();
    if trimmed.is_empty() && !result.is_error {
        return "ok".to_string();
    }

    if name == "exec_command" {
        if let Some(summary) = preview_exec_command_result(trimmed) {
            return preview(&summary, 160);
        }
    }

    let lines: Vec<&str> = result
        .content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        return preview(trimmed, 160);
    }

    if let Some(summary) = select_summary_line(name, &lines) {
        return preview(summary, 160);
    }

    preview(lines[0], 160)
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
    let output = parsed
        .get("output")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    let output_lines: Vec<&str> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let summary = select_summary_line("exec_command_output", &output_lines)
        .or_else(|| output_lines.last().copied());
    let exit_code = parsed.get("exit_code").and_then(|value| value.as_i64());

    match (exit_code, summary) {
        (Some(0), Some(summary)) => Some(summary.to_string()),
        (Some(code), Some(summary)) => Some(format!("exit {code}: {summary}")),
        (Some(code), None) => Some(format!("exit {code}")),
        (None, Some(summary)) => Some(summary.to_string()),
        (None, None) => parsed
            .get("session_name")
            .and_then(|value| value.as_str())
            .map(|session| format!("session {session}")),
    }
}
