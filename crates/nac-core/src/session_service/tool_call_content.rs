//! Read-only lookup of one main-session tool call. It reads the store-backed
//! transcript and never waits on the agent lock, which a running turn holds.
use super::*;
use crate::types::{ToolContent, ToolContentPart};

const MAX_TOOL_CALL_CONTENT_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCallContent {
    pub call_id: String,
    pub arguments: String,
    pub arguments_truncated: bool,
    /// `None` while the call has no recorded result.
    pub output: Option<String>,
    pub output_truncated: bool,
}

impl SessionService {
    /// Each field is redacted in full before it is bounded, so a cut never
    /// leaves part of a secret behind.
    pub async fn tool_call_content(&self, call_id: &str) -> Result<Option<ToolCallContent>> {
        let messages = self.store_backed_transcript().await?;
        let provider = self
            .shell_runtime
            .as_ref()
            .and_then(|runtime| runtime.command_environment.clone());
        let call_id = call_id.to_owned();
        tokio::task::spawn_blocking(move || {
            let Some((arguments, output)) = find_tool_call(&messages, &call_id) else {
                return Ok(None);
            };
            let secrets = exact_secrets(provider.as_deref())?;
            let redact = |text: &str| crate::model::redact_credentials(&secrets.redact(text), &[]);
            let (arguments, arguments_truncated) = bounded(redact(arguments));
            let (output, output_truncated) =
                match output.map(|content| bounded(redact(&result_text(content)))) {
                    Some((output, truncated)) => (Some(output), truncated),
                    None => (None, false),
                };
            Ok(Some(ToolCallContent {
                call_id,
                arguments,
                arguments_truncated,
                output,
                output_truncated,
            }))
        })
        .await?
    }
}

fn exact_secrets(
    provider: Option<&dyn nac_contracts::CommandEnvironmentProvider>,
) -> Result<nac_contracts::CommandEnvironmentSnapshot> {
    let mut secrets = match provider {
        // Provider errors can name private paths or values; never surface them.
        Some(provider) => provider
            .redaction_snapshot()
            .map_err(|_| anyhow::anyhow!("tool call content could not be redacted safely"))?,
        None => nac_contracts::CommandEnvironmentSnapshot::empty(),
    };
    secrets.extend_redactions(crate::worker_credentials::captured_managed_native_redactions());
    Ok(secrets)
}

/// Provider call ids are not guaranteed unique across turns: the newest call
/// wins, and only the tool rows contiguous with its assistant turn hold its result.
fn find_tool_call<'a>(
    messages: &'a [Message],
    call_id: &str,
) -> Option<(&'a str, Option<&'a ToolContent>)> {
    let (index, call) = messages
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, message)| {
            let Message::Assistant {
                tool_calls: Some(calls),
                ..
            } = message
            else {
                return None;
            };
            let call = calls.iter().find(|call| call.id == call_id)?;
            Some((index, call))
        })?;
    let output = messages[index + 1..]
        .iter()
        .take_while(|message| !matches!(message, Message::Assistant { .. } | Message::User { .. }))
        .filter_map(|message| match message {
            Message::Tool {
                tool_call_id,
                content,
            } if tool_call_id == call_id => Some(content),
            _ => None,
        })
        .last();
    Some((call.function.arguments.as_str(), output))
}

/// Must match the web transcript's text for a tool result so both views agree.
fn result_text(content: &ToolContent) -> String {
    let Some(parts) = content.parts() else {
        return content.as_text().unwrap_or_default().to_owned();
    };
    parts
        .iter()
        .map(|part| match part {
            ToolContentPart::Text(text) => text.clone(),
            ToolContentPart::Image(image) => format!("[Image: {}]", image.mime_type().as_str()),
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn bounded(mut text: String) -> (String, bool) {
    if text.len() <= MAX_TOOL_CALL_CONTENT_BYTES {
        return (text, false);
    }
    let mut end = MAX_TOOL_CALL_CONTENT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    (text, true)
}

#[cfg(test)]
#[path = "tool_call_content_tests.rs"]
mod tests;
