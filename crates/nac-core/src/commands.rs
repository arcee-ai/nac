use serde::{Deserialize, Serialize};

/// Parsed slash commands shared by frontends.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SlashCommand {
    Exit,
    Sessions,
    Help,
    Plan { instruction: String },
    Run { workset_id: String },
}

/// Slash commands that require frontend-side handling rather than agent submission.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FrontendCommand {
    Exit,
    Sessions,
    Help,
}

/// A prompt ready to send to the agent while preserving frontend display text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreparedPrompt {
    pub raw_prompt: String,
    pub display_prompt: String,
    pub agent_prompt: String,
}

/// Shared interpretation of raw user input.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PreparedUserInput {
    Empty,
    SubmitPrompt(PreparedPrompt),
    FrontendCommand(FrontendCommand),
    InvalidSlashCommand { message: String },
}

pub fn composer_is_slash_mode(lines: &[String]) -> bool {
    lines.first().is_some_and(|line| line.starts_with('/'))
}

pub fn prepare_user_input(input: &str) -> PreparedUserInput {
    if input.trim().is_empty() {
        return PreparedUserInput::Empty;
    }

    match parse_slash_command(input) {
        Some(Ok(SlashCommand::Exit)) => PreparedUserInput::FrontendCommand(FrontendCommand::Exit),
        Some(Ok(SlashCommand::Sessions)) => {
            PreparedUserInput::FrontendCommand(FrontendCommand::Sessions)
        }
        Some(Ok(SlashCommand::Help)) => {
            PreparedUserInput::FrontendCommand(FrontendCommand::Help)
        }
        Some(Ok(SlashCommand::Plan { instruction })) => {
            PreparedUserInput::SubmitPrompt(PreparedPrompt {
                raw_prompt: input.to_string(),
                display_prompt: input.to_string(),
                agent_prompt: build_plan_command_prompt(&instruction),
            })
        }
        Some(Ok(SlashCommand::Run { workset_id })) => {
            PreparedUserInput::SubmitPrompt(PreparedPrompt {
                raw_prompt: input.to_string(),
                display_prompt: input.to_string(),
                agent_prompt: build_run_command_prompt(&workset_id),
            })
        }
        Some(Err(message)) => PreparedUserInput::InvalidSlashCommand { message },
        None => PreparedUserInput::SubmitPrompt(PreparedPrompt {
            raw_prompt: input.to_string(),
            display_prompt: input.to_string(),
            agent_prompt: input.to_string(),
        }),
    }
}

pub fn parse_slash_command(prompt: &str) -> Option<Result<SlashCommand, String>> {
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
        "help" if args.is_empty() => Ok(SlashCommand::Help),
        "help" => Err("usage: /help".to_string()),
        "plan" => parse_required_arg_command("plan", "instruction", args, |instruction| {
            SlashCommand::Plan { instruction }
        }),
        "run" => parse_run_slash_command(args),
        _ => Err(format!("unknown slash command: /{}", name)),
    })
}

fn parse_required_arg_command<F>(
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

fn parse_run_slash_command(args: &str) -> Result<SlashCommand, String> {
    if args.is_empty() || args.split_whitespace().count() != 1 {
        Err("usage: /run <workset>".to_string())
    } else {
        Ok(SlashCommand::Run {
            workset_id: args.to_string(),
        })
    }
}

pub fn expand_user_prompt(prompt: &str) -> String {
    match parse_slash_command(prompt) {
        Some(Ok(SlashCommand::Plan { instruction })) => build_plan_command_prompt(&instruction),
        Some(Ok(SlashCommand::Run { workset_id })) => build_run_command_prompt(&workset_id),
        _ => prompt.to_string(),
    }
}

pub fn build_plan_command_prompt(instruction: &str) -> String {
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

pub fn build_run_command_prompt(workset_id: &str) -> String {
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

pub fn display_prompt_from_message(content: &str) -> String {
    workset_command_display_prompt(content).unwrap_or_else(|| content.to_string())
}

fn workset_command_display_prompt(content: &str) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_frontend_slash_commands() {
        assert_eq!(parse_slash_command("/exit"), Some(Ok(SlashCommand::Exit)));
        assert_eq!(
            parse_slash_command("/sessions"),
            Some(Ok(SlashCommand::Sessions))
        );
    }

    #[test]
    fn invalid_slash_commands_preserve_messages() {
        assert_eq!(
            parse_slash_command("/bogus"),
            Some(Err("unknown slash command: /bogus".to_string()))
        );
        assert_eq!(
            parse_slash_command("/run refresh auth flow"),
            Some(Err("usage: /run <workset>".to_string()))
        );
        assert_eq!(
            parse_slash_command("/plan"),
            Some(Err("usage: /plan <instruction>".to_string()))
        );
    }

    #[test]
    fn plan_command_expands_to_workset_prompt() {
        let expanded = expand_user_prompt("/plan refresh auth flow");

        assert!(expanded.contains("# /plan: Workset Planning"));
        assert!(expanded.contains("workset_define"));
        assert!(expanded.contains("goal"));
        assert!(expanded.contains("role"));
        assert!(expanded.contains("depends_on"));
        assert!(expanded.contains("acceptance"));
        assert!(expanded.contains("refresh auth flow"));
        assert!(expanded.contains("Do not do mutating implementation work in this step."));
        assert!(!expanded.contains("thread_name"));
    }

    #[test]
    fn run_command_expands_to_existing_workset_prompt() {
        let expanded = expand_user_prompt("/run auth-refresh");

        assert!(expanded.contains("# /run: Workset Execution"));
        assert!(expanded.contains("workset_read"));
        assert!(expanded.contains("auth-refresh"));
        assert!(expanded.contains("run `/plan <instruction>` first"));
        assert!(expanded.contains("Use `thread` for implementation and verification work."));
        assert!(!expanded.contains("Create exactly one durable"));
    }

    #[test]
    fn workset_prompt_displays_as_original_slash_command() {
        let expanded = build_plan_command_prompt("split this into reviewable units");
        let expanded_run = build_run_command_prompt("auth-refresh");

        assert_eq!(
            display_prompt_from_message(&expanded),
            "/plan split this into reviewable units"
        );
        assert_eq!(
            display_prompt_from_message(&expanded_run),
            "/run auth-refresh"
        );
    }

    #[test]
    fn test_parse_help_command() {
        assert_eq!(parse_slash_command("/help"), Some(Ok(SlashCommand::Help)));
        assert_eq!(
            parse_slash_command("/help args"),
            Some(Err("usage: /help".to_string()))
        );
    }

    #[test]
    fn prepare_user_input_classifies_frontend_and_submit_actions() {
        assert_eq!(
            prepare_user_input("/sessions"),
            PreparedUserInput::FrontendCommand(FrontendCommand::Sessions)
        );
        assert_eq!(
            prepare_user_input("/exit"),
            PreparedUserInput::FrontendCommand(FrontendCommand::Exit)
        );
        assert_eq!(
            prepare_user_input("/help"),
            PreparedUserInput::FrontendCommand(FrontendCommand::Help)
        );

        let PreparedUserInput::SubmitPrompt(prepared) = prepare_user_input("/run auth-refresh")
        else {
            panic!("expected prepared prompt")
        };
        assert_eq!(prepared.raw_prompt, "/run auth-refresh");
        assert_eq!(prepared.display_prompt, "/run auth-refresh");
        assert!(prepared.agent_prompt.contains("# /run: Workset Execution"));
    }

    #[test]
    fn expand_user_prompt_does_not_expand_help() {
        assert_eq!(expand_user_prompt("/help"), "/help");
    }
}
