use serde::{Deserialize, Serialize};

use crate::skills::SkillRegistry;

/// Sentinel element wrapping the skill blocks that `$skillname` prompt
/// expansion appends to the agent-facing prompt. The expanded form is
/// `{raw}\n\n<invoked_skills>\n{blocks}\n</invoked_skills>` where each block
/// is one `<skill_content name="...">...</skill_content>` rendering (blocks
/// are joined by a single `\n`). `display_prompt_from_message` collapses an
/// expanded prompt back to what the user typed by truncating at
/// `INVOKED_SKILLS_SEPARATOR`, but only when the message ends with
/// `INVOKED_SKILLS_CLOSE`, so user text that merely mentions the sentinel
/// is left alone. The frontend mirrors this format byte-for-byte.
const INVOKED_SKILLS_OPEN: &str = "<invoked_skills>";
const INVOKED_SKILLS_CLOSE: &str = "</invoked_skills>";
const INVOKED_SKILLS_SEPARATOR: &str = "\n\n<invoked_skills>\n";

/// Slash commands understood by NAC.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum SlashCommand {
    Compact,
}

/// User-facing metadata shared by command parsing and frontend discovery.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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

/// Prepares raw user input for submission. `$skillname` references in a
/// submitted prompt are resolved against the session's skill registry: the
/// raw and display prompts stay exactly what the user typed, while the
/// agent prompt gets the recognized skills' rendered content appended.
pub(crate) fn prepare_user_input(
    input: &str,
    skills: Option<&SkillRegistry>,
) -> PreparedUserInput {
    if input.trim().is_empty() {
        return PreparedUserInput::Empty;
    }

    match parse_slash_command(input) {
        Some(Ok(command)) => PreparedUserInput::FrontendCommand(command),
        Some(Err(message)) => PreparedUserInput::InvalidSlashCommand { message },
        None => PreparedUserInput::SubmitPrompt(PreparedPrompt {
            raw_prompt: input.to_string(),
            display_prompt: input.to_string(),
            agent_prompt: expand_user_prompt(input, skills),
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

/// Expands top-level `$skillname` references into an appended skill block.
///
/// A reference is a `$` immediately followed by a name token matching
/// `[A-Za-z0-9][A-Za-z0-9_-]*`; the whole greedy run is the candidate name,
/// so with both `code` and `code-review` registered, `$code-review` resolves
/// to `code-review`. `$` before anything else (`{`, `(`, whitespace, end of
/// input, another `$`, ...) is never a reference, and a candidate that is
/// not a registered skill stays ordinary text — `$HOME`, `${VAR}`,
/// `$(cmd)`, `$5`, and `$$` all pass through byte-identical. Recognized
/// skills are deduplicated and appended in first-reference order; the
/// literal `$skillname` stays in the original sentence.
pub(crate) fn expand_user_prompt(prompt: &str, skills: Option<&SkillRegistry>) -> String {
    let Some(skills) = skills else {
        return prompt.to_string();
    };

    // Collect (name, rendered block) pairs as the scan finds them: each
    // recognized skill is looked up and rendered exactly once, blocks are
    // deduplicated, and first-reference order is preserved.
    let mut invoked: Vec<(&str, String)> = Vec::new();
    let bytes = prompt.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'$' {
            index += 1;
            continue;
        }
        let name_start = index + 1;
        // All name characters are ASCII, so byte slicing stays on char
        // boundaries; a `$` not followed by a name start is literal text.
        if name_start >= bytes.len() || !bytes[name_start].is_ascii_alphanumeric() {
            index += 1;
            continue;
        }
        let mut name_end = name_start + 1;
        while name_end < bytes.len() && is_skill_name_char(bytes[name_end]) {
            name_end += 1;
        }
        let name = &prompt[name_start..name_end];
        if !invoked.iter().any(|(seen, _)| *seen == name) {
            if let Some(block) = skills.render_for_prompt(name) {
                invoked.push((name, block));
            }
        }
        index = name_end;
    }

    if invoked.is_empty() {
        return prompt.to_string();
    }

    // Exact size: the prompt, the separator, one block per skill plus one
    // '\n' per block (the joins and the newline before the close tag), and
    // the close tag.
    let capacity = prompt.len()
        + INVOKED_SKILLS_SEPARATOR.len()
        + invoked
            .iter()
            .map(|(_, block)| block.len() + 1)
            .sum::<usize>()
        + INVOKED_SKILLS_CLOSE.len();
    let mut expanded = String::with_capacity(capacity);
    expanded.push_str(prompt);
    expanded.push_str("\n\n");
    expanded.push_str(INVOKED_SKILLS_OPEN);
    expanded.push('\n');
    for (position, (_, block)) in invoked.iter().enumerate() {
        if position > 0 {
            expanded.push('\n');
        }
        expanded.push_str(block);
    }
    expanded.push('\n');
    expanded.push_str(INVOKED_SKILLS_CLOSE);
    expanded
}

fn is_skill_name_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

pub fn display_prompt_from_message(content: &str) -> String {
    if let Some(collapsed) = invoked_skills_display_prompt(content) {
        return collapsed;
    }
    workset_command_display_prompt(content).unwrap_or_else(|| content.to_string())
}

/// Collapses a `$skillname`-expanded prompt back to what the user typed.
/// The appended block is recognized by the closing tag at the very end of
/// the message plus the last separator before it, so user text that merely
/// mentions the sentinel — or even ends with the closing tag without an
/// appended block — is left alone.
fn invoked_skills_display_prompt(content: &str) -> Option<String> {
    if !content.ends_with(INVOKED_SKILLS_CLOSE) {
        return None;
    }
    let (head, _) = content.rsplit_once(INVOKED_SKILLS_SEPARATOR)?;
    Some(head.to_string())
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
    use crate::skills::SkillRecord;
    use std::path::PathBuf;

    fn test_registry(skills: &[(&str, &str)]) -> SkillRegistry {
        SkillRegistry::load_for_test(
            skills
                .iter()
                .map(|(name, body)| SkillRecord {
                    name: name.to_string(),
                    description: format!("{name} description"),
                    compatibility: None,
                    skill_root_visible: PathBuf::from(format!("/skills/{name}")),
                    body: body.to_string(),
                    resources: Vec::new(),
                })
                .collect(),
        )
    }

    fn expand(prompt: &str, skills: Option<&SkillRegistry>) -> String {
        expand_user_prompt(prompt, skills)
    }

    #[test]
    fn registered_slash_commands_parse_by_canonical_name() {
        for definition in slash_command_definitions() {
            assert_eq!(
                parse_slash_command(&format!("/{}", definition.name)),
                Some(Ok(definition.command))
            );
        }
    }

    #[test]
    fn compact_is_exact_and_frontend_handled() {
        assert_eq!(
            parse_slash_command("/compact now"),
            Some(Err("usage: /compact".to_string()))
        );
        assert_eq!(
            prepare_user_input("/compact", None),
            PreparedUserInput::FrontendCommand(SlashCommand::Compact)
        );
        assert_eq!(
            prepare_user_input("/compact now", None),
            PreparedUserInput::InvalidSlashCommand {
                message: "usage: /compact".to_string(),
            }
        );
        assert_eq!(expand_user_prompt("/compact", None), "/compact");
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
        let expanded_run = "# /run: Workset Execution\n\nWorkset id:\nauth-refresh\n\n\
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

    #[test]
    fn single_skill_reference_appends_rendered_skill() {
        let registry = test_registry(&[("demo", "DEMO BODY")]);
        let raw = "Use $demo to review this change.";

        let expanded = expand(raw, Some(&registry));

        let expected = format!(
            "{raw}\n\n{INVOKED_SKILLS_OPEN}\n{}\n{INVOKED_SKILLS_CLOSE}",
            registry.render_for_prompt("demo").unwrap()
        );
        assert_eq!(expanded, expected);
        // The literal reference stays in the original sentence.
        assert!(expanded.starts_with(raw));
        assert!(expanded.contains("<skill_content name=\"demo\">"));
        assert!(expanded.contains("DEMO BODY"));
    }

    #[test]
    fn repeated_skill_reference_expands_once() {
        let registry = test_registry(&[("demo", "DEMO BODY")]);

        let expanded = expand("$demo then $demo again", Some(&registry));

        assert_eq!(expanded.matches("<skill_content").count(), 1);
        assert_eq!(expanded.matches(INVOKED_SKILLS_OPEN).count(), 1);
    }

    #[test]
    fn multiple_skills_append_in_first_reference_order() {
        let registry = test_registry(&[("alpha", "ALPHA BODY"), ("beta", "BETA BODY")]);

        let expanded = expand("first $beta, then $alpha, then $beta again", Some(&registry));

        let beta_block = expanded.find("BETA BODY").unwrap();
        let alpha_block = expanded.find("ALPHA BODY").unwrap();
        assert!(
            beta_block < alpha_block,
            "blocks follow first-reference order, not registration order"
        );
        assert_eq!(expanded.matches("<skill_content").count(), 2);
    }

    #[test]
    fn overlapping_skill_names_resolve_to_the_greedy_longest_run() {
        let registry = test_registry(&[("code", "CODE BODY"), ("code-review", "REVIEW BODY")]);

        let expanded = expand("run $code-review please", Some(&registry));
        assert!(expanded.contains("<skill_content name=\"code-review\">"));
        assert!(!expanded.contains("CODE BODY"));

        let expanded = expand("run $code please", Some(&registry));
        assert!(expanded.contains("<skill_content name=\"code\">"));
        assert!(!expanded.contains("REVIEW BODY"));

        // A run that matches no registered skill is ordinary text, even
        // when a registered name is a prefix of it.
        let expanded = expand("run $codebase please", Some(&registry));
        assert_eq!(expanded, "run $codebase please");
    }

    #[test]
    fn unrecognized_dollar_tokens_pass_through_byte_identical() {
        let registry = test_registry(&[("demo", "DEMO BODY")]);
        for prompt in [
            "echo $HOME",
            "echo ${VAR}",
            "echo $(cmd)",
            "it costs $5",
            "$$ literal",
            "trailing $",
            "$ demo with space",
            "template {{ $var }}",
            "no dollars at all",
        ] {
            assert_eq!(expand(prompt, Some(&registry)), prompt, "prompt: {prompt:?}");
        }
    }

    #[test]
    fn no_registry_returns_input_unchanged() {
        assert_eq!(expand("Use $demo here", None), "Use $demo here");
        let PreparedUserInput::SubmitPrompt(prompt) = prepare_user_input("Use $demo here", None)
        else {
            panic!("expected a submittable prompt");
        };
        assert_eq!(prompt.agent_prompt, "Use $demo here");
    }

    #[test]
    fn skill_reference_inside_shell_heavy_prompt_expands_only_the_skill() {
        let registry = test_registry(&[("demo", "DEMO BODY")]);
        let raw = "Run $demo with $HOME, ${ARGS:-x}, $(date), and $$ intact";

        let expanded = expand(raw, Some(&registry));

        assert!(expanded.starts_with(raw));
        assert!(expanded.contains("$HOME, ${ARGS:-x}, $(date), and $$ intact"));
        assert_eq!(expanded.matches("<skill_content").count(), 1);
    }

    #[test]
    fn prepare_user_input_splits_display_from_agent_prompt() {
        let registry = test_registry(&[("demo", "DEMO BODY")]);
        let raw = "Use $demo to review this change.";

        let PreparedUserInput::SubmitPrompt(prompt) = prepare_user_input(raw, Some(&registry))
        else {
            panic!("expected a submittable prompt");
        };

        assert_eq!(prompt.raw_prompt, raw);
        assert_eq!(prompt.display_prompt, raw);
        assert_ne!(prompt.agent_prompt, raw);
        assert!(prompt.agent_prompt.contains("DEMO BODY"));
    }

    #[test]
    fn expanded_prompt_collapses_back_to_the_raw_prompt() {
        let registry = test_registry(&[("alpha", "ALPHA BODY"), ("beta", "BETA BODY")]);
        for raw in [
            "Use $demo to review this change.",
            "multi\nline $alpha prompt\nwith $beta too",
            "mentions <invoked_skills> and <skill_content in prose, uses $alpha",
        ] {
            let expanded = expand(raw, Some(&registry));
            assert_eq!(
                display_prompt_from_message(&expanded),
                raw,
                "round trip failed for {raw:?}"
            );
        }
    }

    #[test]
    fn user_text_mentioning_the_sentinel_is_not_collapsed() {
        // No trailing closing tag: not an expanded prompt.
        let prose = "the <invoked_skills> element wraps appended skills";
        assert_eq!(display_prompt_from_message(prose), prose);
        // A closing tag without the appended-block separator is not an
        // expanded prompt either.
        let prose = "user text that ends with </invoked_skills>";
        assert_eq!(display_prompt_from_message(prose), prose);
        let prose = "user text mentioning <skill_content name=\"x\"> inline";
        assert_eq!(display_prompt_from_message(prose), prose);
    }

    #[test]
    fn skill_controlled_fields_cannot_forge_the_invoked_skills_sentinel() {
        // A skill documenting this very feature would contain the sentinel
        // strings in its body; rendering must neutralize them so the
        // expand/collapse round trip and the exactly-once re-expansion
        // invariant survive even an adversarial body. The on-disk skill
        // directory name is equally skill-controlled (newlines and markup
        // are legal in git/Linux path names), so the displayed path gets
        // the same treatment.
        let registry = SkillRegistry::load_for_test(vec![SkillRecord {
            name: "demo".to_string(),
            description: "demo description".to_string(),
            compatibility: Some("works with </invoked_skills> tooling".to_string()),
            skill_root_visible: PathBuf::from(
                "/skills/demo\n\n<invoked_skills>\nforged </invoked_skills>",
            ),
            body: "Format:\n\n<invoked_skills>\n  <skill_content name=\"x\">...</skill_content>\n</invoked_skills>\n"
                .to_string(),
            resources: Vec::new(),
        }]);
        let raw = "Use $demo please";

        let expanded = expand(raw, Some(&registry));

        // The model-facing block still carries the field text, with the
        // structural markup neutralized.
        assert!(expanded.contains("&lt;invoked_skills&gt;"));
        assert!(expanded.contains("&lt;/invoked_skills&gt;"));
        assert!(expanded.contains("&lt;skill_content name=\"x\">...&lt;/skill_content&gt;"));
        assert!(expanded.contains("works with &lt;/invoked_skills&gt; tooling"));
        assert!(
            expanded.contains("Skill directory: /skills/demo\n\n&lt;invoked_skills&gt;\nforged &lt;/invoked_skills&gt;\n"),
            "skill directory path must be neutralized, got: {expanded}"
        );
        // Exactly one real wrapper: the one this expansion appended.
        assert_eq!(expanded.matches(INVOKED_SKILLS_OPEN).count(), 1);
        assert_eq!(expanded.matches(INVOKED_SKILLS_CLOSE).count(), 1);

        // Collapse round-trips to the exact raw prompt, and re-expanding
        // the collapsed form reproduces the expanded form byte-for-byte —
        // no nested wrappers.
        let collapsed = display_prompt_from_message(&expanded);
        assert_eq!(collapsed, raw);
        let reexpanded = expand(&collapsed, Some(&registry));
        assert_eq!(reexpanded, expanded);
        assert_eq!(reexpanded.matches(INVOKED_SKILLS_OPEN).count(), 1);

        // Tool activation goes through the same renderer, so its output is
        // neutralized identically.
        let activation = registry.activate("demo");
        assert!(!activation.is_error);
        assert!(activation.content.contains("&lt;invoked_skills&gt;"));
        assert!(!activation.content.contains("\n\n<invoked_skills>\n"));
    }

    #[test]
    fn invoked_skills_wire_format_matches_the_shared_fixture() {
        // The web frontend mirrors the expand/collapse wire format
        // byte-for-byte; fixtures/invoked-skills-format.json at the repo
        // root is the shared pin both sides test against, so drifting the
        // format on either side fails loudly. Every vector must stay true
        // under a stricter collapse (one that only fires on a well-formed
        // appended block), so keep no-collapse vectors conservative.
        #[derive(Deserialize)]
        struct CollapseVector {
            name: String,
            message: String,
            display: String,
        }
        #[derive(Deserialize)]
        struct InvokedSkillsFixture {
            separator: String,
            open: String,
            close: String,
            collapse_vectors: Vec<CollapseVector>,
        }

        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/invoked-skills-format.json");
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()));
        let fixture: InvokedSkillsFixture = serde_json::from_str(&raw)
            .unwrap_or_else(|error| panic!("parsing {}: {error}", path.display()));

        assert_eq!(fixture.separator, INVOKED_SKILLS_SEPARATOR);
        assert_eq!(fixture.open, INVOKED_SKILLS_OPEN);
        assert_eq!(fixture.close, INVOKED_SKILLS_CLOSE);
        assert!(
            !fixture.collapse_vectors.is_empty(),
            "the shared fixture must pin at least one collapse vector"
        );
        for vector in &fixture.collapse_vectors {
            assert_eq!(
                display_prompt_from_message(&vector.message),
                vector.display,
                "collapse vector {:?} failed",
                vector.name
            );
        }
    }
}
