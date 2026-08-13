use serde::{Deserialize, Serialize};

/// Slash commands understood by NAC.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SlashCommand {
    Compact,
}

/// User-facing metadata shared by command parsing and frontend discovery.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub struct SlashCommandDefinition {
    pub command: SlashCommand,
    pub name: &'static str,
    pub description: &'static str,
    pub accepts_arguments: bool,
}

const SLASH_COMMANDS: &[SlashCommandDefinition] = &[SlashCommandDefinition {
    command: SlashCommand::Compact,
    name: "compact",
    description: "Compact the current session context",
    accepts_arguments: false,
}];

pub fn slash_command_definitions() -> &'static [SlashCommandDefinition] {
    SLASH_COMMANDS
}

impl SlashCommand {
    pub fn definition(self) -> &'static SlashCommandDefinition {
        SLASH_COMMANDS
            .iter()
            .find(|definition| definition.command == self)
            .expect("every slash command must have a definition")
    }
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
    FrontendCommand(SlashCommand),
    InvalidSlashCommand { message: String },
}

pub fn prepare_user_input(input: &str) -> PreparedUserInput {
    if input.trim().is_empty() {
        return PreparedUserInput::Empty;
    }

    match parse_slash_command(input) {
        Some(Ok(command)) => PreparedUserInput::FrontendCommand(command),
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
    let Some(definition) = SLASH_COMMANDS
        .iter()
        .find(|definition| definition.name == name)
    else {
        return Some(Err(format!("unknown slash command: /{}", name)));
    };

    Some(if definition.accepts_arguments || args.is_empty() {
        Ok(definition.command)
    } else {
        Err(format!("usage: /{}", definition.name))
    })
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
    fn compact_is_exact_and_frontend_handled() {
        assert_eq!(
            parse_slash_command("/compact now"),
            Some(Err("usage: /compact".to_string()))
        );
        assert_eq!(
            prepare_user_input("/compact"),
            PreparedUserInput::FrontendCommand(SlashCommand::Compact)
        );
        assert_eq!(
            prepare_user_input("/compact now"),
            PreparedUserInput::InvalidSlashCommand {
                message: "usage: /compact".to_string(),
            }
        );
    }

    #[test]
    fn invalid_slash_commands_preserve_messages() {
        assert_eq!(
            parse_slash_command("/bogus"),
            Some(Err("unknown slash command: /bogus".to_string()))
        );
    }

    #[test]
    fn workset_prompt_displays_as_original_slash_command() {
        // These are the expanded prompt formats that /plan and /run used to
        // generate.  display_prompt_from_message must still collapse them back
        // to the short slash-command form so old stored sessions display and
        // regenerate correctly.
        let expanded_plan =
            "# /plan: Workset Planning\n\nUser instruction:\nsplit this into reviewable units\n\n\
             Create exactly one durable high-level workset with `workset_define`.";
        let expanded_run =
            "# /run: Workset Execution\n\nWorkset id:\nauth-refresh\n\n\
             Execute an existing workset.";

        assert_eq!(
            display_prompt_from_message(expanded_plan),
            "/plan split this into reviewable units"
        );
        assert_eq!(
            display_prompt_from_message(expanded_run),
            "/run auth-refresh"
        );
    }
}
