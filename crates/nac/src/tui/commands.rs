use super::*;

pub(super) fn composer_prefix_width() -> usize {
    PROMPT_SEPARATOR.chars().count()
}

pub(super) fn composer_is_slash_mode(lines: &[String]) -> bool {
    lines.first().is_some_and(|line| line.starts_with('/'))
}

pub(super) fn parse_slash_command(prompt: &str) -> Option<Result<SlashCommand, String>> {
    let trimmed = prompt.trim();
    if !trimmed.starts_with('/') {
        return None;
    }

    let body = trimmed.trim_start_matches('/');
    let name_end = body.find(char::is_whitespace).unwrap_or(body.len());
    let name = &body[..name_end];
    let args = body[name_end..].trim();

    Some(match name {
        "exit" if args.is_empty() => Ok(SlashCommand::Exit),
        "sessions" if args.is_empty() => Ok(SlashCommand::Sessions),
        "plan" => parse_workset_slash_command("plan", "instruction", args, |instruction| {
            SlashCommand::Plan { instruction }
        }),
        "run" => parse_run_slash_command(args),
        _ => Err(format!("unknown slash command: /{}", name)),
    })
}

pub(super) fn parse_workset_slash_command<F>(
    name: &str,
    arg_name: &str,
    args: &str,
    constructor: F,
) -> Result<SlashCommand, String>
where
    F: FnOnce(String) -> SlashCommand,
{
    if args.is_empty() {
        Err(format!("usage: /{} <{}>", name, arg_name))
    } else {
        Ok(constructor(args.to_string()))
    }
}

pub(super) fn parse_run_slash_command(args: &str) -> Result<SlashCommand, String> {
    if args.is_empty() || args.split_whitespace().count() != 1 {
        Err("usage: /run <workset>".to_string())
    } else {
        Ok(SlashCommand::Run {
            workset_id: args.to_string(),
        })
    }
}

pub(super) fn expand_user_prompt(prompt: &str) -> String {
    match parse_slash_command(prompt) {
        Some(Ok(SlashCommand::Plan { instruction })) => build_plan_command_prompt(&instruction),
        Some(Ok(SlashCommand::Run { workset_id })) => build_run_command_prompt(&workset_id),
        _ => prompt.to_string(),
    }
}

pub(super) fn build_plan_command_prompt(instruction: &str) -> String {
    format!(
        "# /plan: Workset Planning\n\n\
         User instruction:\n\
         {instruction}\n\n\
         Create exactly one durable high-level workset with `workset_define`.\n\n\
         Steps:\n\
         1. Research the affected files, patterns, and conventions. Use general research `thread` calls at first, followed by bounded focused `thread` calls for additional detailed research when helpful.\n\
         2. Decompose the work into self-contained units. Prefer per-module or per-directory slices, keep scopes explicit, and record dependencies only when a unit really needs another first.\n\
         3. Define the verification recipe. Include the exact test command, manual flow, or reason that unit tests are sufficient.\n\
         4. Save the workset. Use `id` as the short handle for `/run <workset>`; `goal`, `status`, and `summary` for the overall plan; and ordered `items` with `title`, `scope`, `description`, `role`, `depends_on`, `acceptance`, and optional `notes`.\n\n\
         Constraints:\n\
         - Do not do mutating implementation work in this step.\n\
         - Final response: give the workset id, compact plan summary, verification recipe, and next command: `/run <workset>`.\n"
    )
}

pub(super) fn build_run_command_prompt(workset_id: &str) -> String {
    format!(
        "# /run: Workset Execution\n\n\
         Workset id:\n\
         {workset_id}\n\n\
         Execute an existing workset.\n\n\
         Steps:\n\
         1. Call `workset_read` with this exact id. If it is missing or unusable, stop and tell the user to run `/plan <instruction>` first.\n\
         2. Execute ready items according to the stored dependencies, scopes, roles, acceptance criteria, and verification recipe.\n\
         3. Use `thread` for implementation and verification work. Each worker prompt must include owned scope and say the worker is not alone in the codebase and must not overwrite unrelated edits.\n\
         4. Run the workset verification recipe when the implementation is complete, or explain why it could not be run.\n\
         5. If the plan materially changes, replace the same workset id with `workset_define` and updated status, summary, items, and notes.\n\n\
         Final response: summarize completed items, verification result, and current workset status.\n"
    )
}

pub(super) fn display_prompt_from_message(content: &str) -> String {
    workset_command_display_prompt(content).unwrap_or_else(|| content.to_string())
}

pub(super) fn workset_command_display_prompt(content: &str) -> Option<String> {
    let header = content.lines().next()?;
    let (kind, _) = header.strip_prefix("# /")?.split_once(':')?;
    let kind = kind.trim();
    if !matches!(kind, "plan" | "run") {
        return None;
    }
    let marker = if kind == "run" {
        "Workset id:\n"
    } else {
        "User instruction:\n"
    };
    let value = content.split_once(marker)?.1.split_once("\n\n")?.0.trim();
    (!value.is_empty()).then(|| format!("/{kind} {value}"))
}

pub(super) fn prompt_line(is_first: bool, content: &str, slash_mode: bool) -> Line<'static> {
    let mut spans = Vec::new();
    if is_first {
        let (prefix, color) = if slash_mode {
            (COMMAND_SEPARATOR, Color::Yellow)
        } else {
            (PROMPT_SEPARATOR, Color::Cyan)
        };
        spans.push(Span::styled(
            prefix,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ));
    } else {
        spans.push(Span::styled(
            CONTINUATION_PREFIX.to_string(),
            Style::default().fg(Color::DarkGray),
        ));
    }
    spans.push(Span::styled(
        content.to_string(),
        Style::default().fg(if slash_mode {
            Color::Yellow
        } else {
            Color::White
        }),
    ));
    Line::from(spans)
}

pub(super) fn normalize_paste(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

pub(super) fn truncate_episode_preview(content: &str) -> String {
    let mut lines = Vec::new();
    let mut char_count = 0usize;
    let mut truncated = false;

    for (index, line) in content.split('\n').enumerate() {
        if index >= 8 {
            truncated = true;
            break;
        }

        let line_chars = line.chars().count();
        let remaining_chars = 700usize.saturating_sub(char_count);
        if line_chars > remaining_chars {
            lines.push(take_chars(line, remaining_chars));
            truncated = true;
            break;
        }

        lines.push(line.to_string());
        char_count = char_count.saturating_add(line_chars);
        if char_count >= 700 {
            truncated = true;
            break;
        }
    }

    if lines.is_empty() && !content.is_empty() {
        lines.push(take_chars(content, 700));
        truncated = content.chars().count() > 700;
    }

    if truncated {
        lines.push("… [truncated retained episode preview]".to_string());
    }

    lines.join("\n")
}

pub(super) fn take_chars(text: &str, count: usize) -> String {
    text.chars().take(count).collect()
}
