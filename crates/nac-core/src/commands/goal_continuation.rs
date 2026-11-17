//! Wire format of the durable goal continuation prompt.
//!
//! A continuation run is admitted with an internal control message that wraps
//! the stored objective in instructions for the model. The transcript keeps
//! that message verbatim because the model must read it again on replay, so
//! display surfaces recover only the goal identity and the user's objective
//! from it and never show the surrounding instructions. The web client mirrors
//! `parse_goal_continuation` byte-for-byte; the shared vectors in
//! `fixtures/goal-continuation-format.json` pin both sides.

const OPEN: &str = "<nac_goal_continuation goal_id=\"";
const HEADER: &str = "\">\nContinue autonomously pursuing this durable goal:\n";
const INSTRUCTIONS: &str = "\nUse get_goal when you need current accounting. Mark it complete only when the objective is genuinely achieved with no required work remaining. Mark it blocked only at a genuine impasse; otherwise finish this turn with a concise progress update and NAC will continue it.\n</nac_goal_continuation>";
const CLOSE: &str = "\n</nac_goal_continuation>";
const NO_BUDGET: &str = "No token budget was set.";

/// What a continuation message may show a person: which goal it advanced
/// and the objective the user wrote, without the control instructions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GoalContinuation<'a> {
    pub goal_id: &'a str,
    pub objective: &'a str,
}

/// The control message that admits one continuation run of a durable goal.
pub fn goal_continuation_prompt(
    goal_id: &str,
    objective: &str,
    token_budget: Option<u64>,
    tokens_used: u64,
) -> String {
    let budget = token_budget.map_or_else(
        || NO_BUDGET.to_string(),
        |budget| {
            format!(
                "Token budget: {budget}; used: {tokens_used}; remaining: {}.",
                budget.saturating_sub(tokens_used)
            )
        },
    );
    format!("{OPEN}{goal_id}{HEADER}{objective}\n{budget}{INSTRUCTIONS}")
}

/// Recovers the goal identity and objective from a well-formed continuation
/// message. Anything that is not exactly what `goal_continuation_prompt`
/// writes yields `None`.
pub fn parse_goal_continuation(content: &str) -> Option<GoalContinuation<'_>> {
    let (goal_id, rest) = content.strip_prefix(OPEN)?.split_once(HEADER)?;
    if goal_id.is_empty() || goal_id.contains(['"', '\n']) {
        return None;
    }
    let (objective, budget) = rest.strip_suffix(INSTRUCTIONS)?.rsplit_once('\n')?;
    if objective.trim().is_empty() || !is_budget_line(budget) {
        return None;
    }
    Some(GoalContinuation { goal_id, objective })
}

/// Whether a message is shaped like any continuation envelope, including one
/// whose body `parse_goal_continuation` does not recognize. Such a message is
/// still internal control text and must not be shown or resent as user input.
pub fn is_goal_continuation_envelope(content: &str) -> bool {
    content.starts_with(OPEN) && content.ends_with(CLOSE)
}

fn is_budget_line(line: &str) -> bool {
    if line == NO_BUDGET {
        return true;
    }
    let digits = |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    let Some(fields) = line
        .strip_prefix("Token budget: ")
        .and_then(|rest| rest.strip_suffix('.'))
    else {
        return false;
    };
    let Some((budget, rest)) = fields.split_once("; used: ") else {
        return false;
    };
    let Some((used, remaining)) = rest.split_once("; remaining: ") else {
        return false;
    };
    digits(budget) && digits(used) && digits(remaining)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_keeps_the_established_model_wire_format() {
        assert_eq!(
            goal_continuation_prompt("goal-1", "ship it", None, 0),
            "<nac_goal_continuation goal_id=\"goal-1\">\nContinue autonomously pursuing this durable goal:\nship it\nNo token budget was set.\nUse get_goal when you need current accounting. Mark it complete only when the objective is genuinely achieved with no required work remaining. Mark it blocked only at a genuine impasse; otherwise finish this turn with a concise progress update and NAC will continue it.\n</nac_goal_continuation>"
        );
        assert!(
            goal_continuation_prompt("goal-1", "ship it", Some(5_000_000), 7_000_000)
                .contains("\nToken budget: 5000000; used: 7000000; remaining: 0.\n")
        );
    }

    #[test]
    fn parse_recovers_only_identity_and_objective() {
        let objective = "line one\nNo token budget was set.\nline three";
        for budget in [None, Some(2_500_000)] {
            let prompt = goal_continuation_prompt("goal-7", objective, budget, 12);
            assert_eq!(
                parse_goal_continuation(&prompt),
                Some(GoalContinuation {
                    goal_id: "goal-7",
                    objective,
                })
            );
        }
    }

    #[test]
    fn parse_rejects_anything_the_prompt_builder_does_not_write() {
        let prompt = goal_continuation_prompt("goal-1", "ship it", None, 0);
        assert!(parse_goal_continuation(&format!("{prompt}\n")).is_none());
        assert!(parse_goal_continuation(&format!("note {prompt}")).is_none());
        assert!(parse_goal_continuation(&prompt.replace("No token budget", "Some")).is_none());
        assert!(
            parse_goal_continuation(&goal_continuation_prompt("", "ship it", None, 0)).is_none()
        );
        assert!(parse_goal_continuation(&goal_continuation_prompt("g", "  ", None, 0)).is_none());
        assert!(is_goal_continuation_envelope(
            "<nac_goal_continuation goal_id=\"goal-1\">\nContinue work\n</nac_goal_continuation>"
        ));
    }

    #[test]
    fn wire_format_matches_the_shared_fixture() {
        #[derive(serde::Deserialize)]
        struct Prompt {
            goal_id: String,
            objective: String,
            token_budget: Option<u64>,
            tokens_used: u64,
        }
        #[derive(serde::Deserialize)]
        struct Vector {
            name: String,
            prompt: Option<Prompt>,
            message: String,
            goal_id: Option<String>,
            objective: Option<String>,
            display: String,
        }
        #[derive(serde::Deserialize)]
        struct Fixture {
            vectors: Vec<Vector>,
        }

        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/goal-continuation-format.json");
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()));
        let fixture: Fixture = serde_json::from_str(&raw).unwrap();
        assert!(fixture.vectors.iter().any(|vector| vector.prompt.is_some()));
        for vector in &fixture.vectors {
            if let Some(prompt) = &vector.prompt {
                assert_eq!(
                    goal_continuation_prompt(
                        &prompt.goal_id,
                        &prompt.objective,
                        prompt.token_budget,
                        prompt.tokens_used
                    ),
                    vector.message,
                    "builder vector {:?}",
                    vector.name
                );
            }
            let parsed = parse_goal_continuation(&vector.message);
            assert_eq!(
                parsed.map(|parsed| parsed.goal_id),
                vector.goal_id.as_deref(),
                "goal id vector {:?}",
                vector.name
            );
            assert_eq!(
                parsed.map(|parsed| parsed.objective),
                vector.objective.as_deref(),
                "objective vector {:?}",
                vector.name
            );
            assert_eq!(
                super::super::display_prompt_from_message(&vector.message),
                vector.display,
                "display vector {:?}",
                vector.name
            );
        }
    }
}
