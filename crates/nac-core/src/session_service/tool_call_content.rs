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
            let redact_text =
                |text: &str| crate::model::redact_credentials(&secrets.redact(text), &[]);
            let redact_string = |text: &str| {
                secrets
                    .redact(text)
                    .split('\n')
                    .map(|line| crate::model::redact_credentials(line, &[]))
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            let redact = |text: &str| redact_document(text, &redact_text, &redact_string);
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

/// A JSON object or array is redacted through its decoded strings, so it still
/// parses: a pattern run over the encoded text can swallow the backslash of an
/// escaped quote, or run past `\n` escapes into the lines after it. Within a
/// decoded string the patterns run one line at a time, so they cannot take a
/// line break either and merge the rows of a diff; the exact secrets are still
/// matched across the whole string. Encoding again respells numbers (1e5 as
/// 100000.0, and past 64 bits as a float), so a document with nothing to redact
/// comes back as written; otherwise its members keep their order and the
/// document its compact or pretty layout. A member under a credential key, such
/// as `password` or `token`, is masked whole at any depth, whatever it holds.
/// Any other text is redacted as it stands.
fn redact_document(
    text: &str,
    redact: &dyn Fn(&str) -> String,
    redact_string: &dyn Fn(&str) -> String,
) -> String {
    let document = match serde_json::from_str::<Document>(text) {
        Ok(document @ (Document::Object(_) | Document::Array(_))) => document,
        _ => return redact(text),
    };
    let redaction = Redaction {
        redact: redact_string,
        changed: std::cell::Cell::new(false),
    };
    let document = document.redacted(&redaction);
    if !redaction.changed.get() {
        return text.to_owned();
    }
    let encoded = if text.contains('\n') {
        serde_json::to_string_pretty(&document)
    } else {
        serde_json::to_string(&document)
    };
    encoded.unwrap_or_else(|_| redact(text))
}

/// Redacts a document's parts and records whether it changed any of them.
struct Redaction<'a> {
    redact: &'a dyn Fn(&str) -> String,
    changed: std::cell::Cell<bool>,
}

impl Redaction<'_> {
    fn text(&self, text: &str) -> String {
        let redacted = (self.redact)(text);
        if redacted != text {
            self.changed.set(true);
        }
        redacted
    }

    fn masked(&self) -> Document {
        self.changed.set(true);
        Document::String(crate::model::REDACTED.to_owned())
    }
}

/// A JSON value whose object members stay in their written order, which
/// `serde_json::Value` sorts.
enum Document {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    String(String),
    Array(Vec<Document>),
    Object(Vec<(String, Document)>),
}

impl Document {
    fn redacted(self, redaction: &Redaction<'_>) -> Self {
        match self {
            Self::String(text) => Self::String(redaction.text(&text)),
            Self::Number(number) => {
                let text = number.to_string();
                if redaction.text(&text) == text {
                    Self::Number(number)
                } else {
                    redaction.masked()
                }
            }
            Self::Array(items) => Self::Array(
                items
                    .into_iter()
                    .map(|item| item.redacted(redaction))
                    .collect(),
            ),
            Self::Object(members) => Self::Object(
                members
                    .into_iter()
                    .map(|(key, value)| {
                        let value = match value {
                            _ if crate::model::is_sensitive_json_key(&key) => redaction.masked(),
                            Self::String(text) => {
                                Self::String(redact_member(&key, &text, redaction))
                            }
                            value => value.redacted(redaction),
                        };
                        (redaction.text(&key), value)
                    })
                    .collect(),
            ),
            value @ (Self::Null | Self::Bool(_)) => value,
        }
    }
}

/// The encoded `"key": "value"` text let a pattern read the key as a credential
/// cue, such as a header name. A value that reads as a credential only after
/// its key is masked whole.
fn redact_member(key: &str, text: &str, redaction: &Redaction<'_>) -> String {
    let alone = redaction.text(text);
    if redaction.text(&format!("{key}: {text}")) == format!("{key}: {alone}") {
        alone
    } else {
        crate::model::REDACTED.to_owned()
    }
}

impl<'de> serde::Deserialize<'de> for Document {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(DocumentVisitor)
    }
}

struct DocumentVisitor;

impl<'de> serde::de::Visitor<'de> for DocumentVisitor {
    type Value = Document;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_unit<E>(self) -> Result<Document, E> {
        Ok(Document::Null)
    }

    fn visit_bool<E>(self, value: bool) -> Result<Document, E> {
        Ok(Document::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Document, E> {
        Ok(Document::Number(value.into()))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Document, E> {
        Ok(Document::Number(value.into()))
    }

    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Document, E> {
        serde_json::Number::from_f64(value)
            .map(Document::Number)
            .ok_or_else(|| E::custom("a JSON number is finite"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Document, E> {
        Ok(Document::String(value.to_owned()))
    }

    fn visit_string<E>(self, value: String) -> Result<Document, E> {
        Ok(Document::String(value))
    }

    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Document, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(Document::Array(items))
    }

    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Document, A::Error> {
        let mut members = Vec::new();
        while let Some(member) = map.next_entry()? {
            members.push(member);
        }
        Ok(Document::Object(members))
    }
}

impl serde::Serialize for Document {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::{SerializeMap, SerializeSeq};
        match self {
            Self::Null => serializer.serialize_unit(),
            Self::Bool(value) => serializer.serialize_bool(*value),
            Self::Number(value) => serde::Serialize::serialize(value, serializer),
            Self::String(value) => serializer.serialize_str(value),
            Self::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
            Self::Object(members) => {
                let mut map = serializer.serialize_map(Some(members.len()))?;
                for (key, value) in members {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
        }
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

/// Provider call ids are not guaranteed unique across turns, and an id the
/// session holds more than once names no single call, so it finds none rather
/// than another call's content. Only the tool rows contiguous with its
/// assistant turn hold its result.
fn find_tool_call<'a>(
    messages: &'a [Message],
    call_id: &str,
) -> Option<(&'a str, Option<&'a ToolContent>)> {
    let mut found = messages
        .iter()
        .enumerate()
        .filter_map(|(index, message)| match message {
            Message::Assistant {
                tool_calls: Some(calls),
                ..
            } => Some((index, calls)),
            _ => None,
        })
        .flat_map(|(index, calls)| {
            calls
                .iter()
                .filter(move |call| call.id == call_id)
                .map(move |call| (index, call))
        });
    let (index, call) = found.next()?;
    if found.next().is_some() {
        return None;
    }
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
