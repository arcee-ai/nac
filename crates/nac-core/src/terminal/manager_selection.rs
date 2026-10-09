//! Finite user-supplied rendered selections, never authenticated process-log ranges.
//! No selection/draft state is retained: only launch policies share the existing
//! live/completed terminal lifetime. The complete normalized text is masked once.

use super::TerminalManager;
use nac_contracts::CommandOutputRedactor;

pub const MAX_TERMINAL_SELECTION_UTF8_BYTES: usize = 32 * 1024;
pub const MAX_TERMINAL_SELECTION_SCALARS: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalSelectionError {
    Invalid(&'static str),
    Unavailable,
}
impl std::fmt::Display for TerminalSelectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => f.write_str(message),
            Self::Unavailable => f.write_str("terminal selection source is unavailable"),
        }
    }
}
impl std::error::Error for TerminalSelectionError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserTerminalSelectionPreview {
    pub terminal_id: String,
    pub owner_instance_id: String,
    pub text: String,
    pub input_utf8_bytes: usize,
    pub input_scalars: usize,
    pub text_utf8_bytes: usize,
    pub text_scalars: usize,
    pub controls_removed: usize,
    pub line_endings_normalized: usize,
}

impl TerminalManager {
    pub(crate) async fn preview_user_selection(
        &self,
        id: &str,
        text: &str,
    ) -> Result<UserTerminalSelectionPreview, TerminalSelectionError> {
        if !self.owns_user_terminal_name(id) {
            return Err(TerminalSelectionError::Unavailable);
        }
        let policy = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(id)
                .and_then(|terminal| terminal.selection_redactor.clone())
        };
        let policy = match policy {
            Some(policy) => policy,
            None => self
                .completed_sessions
                .lock()
                .await
                .iter()
                .find(|(name, terminal)| name == id && terminal.user_owned)
                .and_then(|(_, terminal)| terminal.selection_redactor.clone())
                .ok_or(TerminalSelectionError::Unavailable)?,
        };
        let mut preview = normalize(text, &policy)?;
        preview.terminal_id = id.to_owned();
        preview.owner_instance_id = self.instance_id.to_string();
        Ok(preview)
    }
}

fn bounds(text: &str) -> Result<usize, TerminalSelectionError> {
    if text.len() > MAX_TERMINAL_SELECTION_UTF8_BYTES {
        return Err(TerminalSelectionError::Invalid(
            "terminal selection exceeds the UTF-8 byte limit",
        ));
    }
    let count = text.chars().count();
    if count > MAX_TERMINAL_SELECTION_SCALARS {
        return Err(TerminalSelectionError::Invalid(
            "terminal selection exceeds the Unicode scalar limit",
        ));
    }
    Ok(count)
}

fn normalize(
    text: &str,
    policy: &CommandOutputRedactor,
) -> Result<UserTerminalSelectionPreview, TerminalSelectionError> {
    let input_scalars = bounds(text)?;
    let projected = policy
        .redact_plain_text(text)
        .map_err(|_| TerminalSelectionError::Invalid("terminal selection normalization failed"))?;
    let canonical = projected.text;
    if canonical.trim().is_empty() {
        return Err(TerminalSelectionError::Invalid(
            "terminal selection is empty",
        ));
    }
    let text_scalars = bounds(&canonical)?;
    Ok(UserTerminalSelectionPreview {
        terminal_id: String::new(),
        owner_instance_id: String::new(),
        input_utf8_bytes: text.len(),
        input_scalars,
        text_utf8_bytes: canonical.len(),
        text_scalars,
        text: canonical,
        controls_removed: projected.controls_removed,
        line_endings_normalized: projected.line_endings_normalized,
    })
}

#[cfg(test)]
#[path = "selection_tests.rs"]
mod tests;
