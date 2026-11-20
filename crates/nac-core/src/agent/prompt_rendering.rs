const DIRECT_SYSTEM_PROMPT: &str = include_str!("prompts/nac_direct.md");
const GENERAL_CHILD_SYSTEM_PROMPT: &str = include_str!("prompts/nac_direct_child.md");

#[expect(
    clippy::expect_used,
    reason = "the checked-in direct prompt must retain its working-directory placeholder"
)]
pub(crate) fn render_direct_system_prompt(working_directory: &str) -> String {
    let (prefix, suffix) = DIRECT_SYSTEM_PROMPT
        .split_once("{working_directory}")
        .expect("direct system prompt must contain {working_directory}");
    format!("{prefix}{working_directory}{suffix}")
}

pub(crate) fn render_general_child_system_prompt(
    working_directory: &str,
    description: &str,
) -> String {
    GENERAL_CHILD_SYSTEM_PROMPT
        .replace("{working_directory}", working_directory)
        .replace("{description}", description)
}
