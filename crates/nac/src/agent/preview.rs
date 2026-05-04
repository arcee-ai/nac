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
        "activate_skill" => {
            if let Some(skill) = parsed
                .as_ref()
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str())
            {
                return preview(skill, 120);
            }
        }
        _ => {}
    }

    preview(args_str, 120)
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
