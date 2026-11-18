//! Read-only lookup of one main-session tool call. It reads the store-backed
//! transcript and never waits on the agent lock, which a running turn holds.
use super::*;
use crate::types::{ToolContent, ToolContentPart};
use sha2::{Digest, Sha256};

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
        self.tool_call_content_at(call_id, None).await
    }

    /// An occurrence binds a read to one retained assistant row; the legacy
    /// ID-only lookup remains fail-closed for reused provider IDs.
    pub async fn tool_call_content_at(
        &self,
        call_id: &str,
        occurrence: Option<&str>,
    ) -> Result<Option<ToolCallContent>> {
        let found = if let Some(occurrence) = occurrence {
            self.occurrence_tool_call(call_id, occurrence).await?
        } else {
            match self.indexed_tool_call(call_id).await? {
                IndexedToolCall::Found(found) => Some(found),
                IndexedToolCall::Absent => None,
                IndexedToolCall::Unindexed => {
                    let messages = self.store_backed_transcript().await?;
                    let call_id = call_id.to_owned();
                    tokio::task::spawn_blocking(move || {
                        find_tool_call(&messages, &call_id).map(|(arguments, output)| {
                            FoundToolCall {
                                arguments: arguments.to_owned(),
                                output: output.cloned(),
                            }
                        })
                    })
                    .await?
                }
            }
        };
        let Some(FoundToolCall { arguments, output }) = found else {
            return Ok(None);
        };
        let provider = self
            .shell_runtime
            .as_ref()
            .and_then(|runtime| runtime.command_environment.clone());
        let call_id = call_id.to_owned();
        tokio::task::spawn_blocking(move || {
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
            let (arguments, arguments_truncated) = bounded(redact(&arguments));
            let (output, output_truncated) =
                match output.map(|content| bounded(redact(&result_text(&content)))) {
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

    async fn occurrence_tool_call(
        &self,
        call_id: &str,
        occurrence: &str,
    ) -> Result<Option<FoundToolCall>> {
        if let Some(blob) = occurrence.strip_prefix("blob:") {
            let Some((owner_digest, index)) = blob.rsplit_once(':') else {
                return Ok(None);
            };
            let Some((owner, digest)) = owner_digest.rsplit_once(':') else {
                return Ok(None);
            };
            let (Some(session_id), Ok(index)) =
                (self.metadata.session_id.as_deref(), index.parse::<usize>())
            else {
                return Ok(None);
            };
            if owner != session_id {
                return Ok(None);
            }
            let snapshot = self.session_snapshot.lock().await;
            let Some(snapshot) = snapshot.as_ref() else {
                return Ok(None);
            };
            if blob_fingerprint(session_id, &snapshot.messages)? != digest {
                return Ok(None);
            }
            let Some(tail) = snapshot.messages.get(index..) else {
                return Ok(None);
            };
            let end = tail
                .iter()
                .skip(1)
                .position(|message| {
                    matches!(message, Message::Assistant { .. } | Message::User { .. })
                })
                .map_or(tail.len(), |offset| offset + 1);
            return Ok(
                find_occurrence_call(&tail[..end], call_id).map(|(arguments, output)| {
                    FoundToolCall {
                        arguments: arguments.to_owned(),
                        output: output.cloned(),
                    }
                }),
            );
        }
        let Some((owner_row, end)) = occurrence
            .strip_prefix("log:")
            .and_then(|value| value.rsplit_once(':'))
        else {
            return Ok(None);
        };
        let Some((owner_row, digest)) = owner_row.rsplit_once(':') else {
            return Ok(None);
        };
        let Some((owner_store, row)) = owner_row.rsplit_once(':') else {
            return Ok(None);
        };
        let Some((owner, expected_store)) = owner_store.rsplit_once(':') else {
            return Ok(None);
        };
        let (Some(row_id), Some(batch_end)) = (
            row.parse::<i64>().ok().filter(|id| *id > 0),
            end.parse::<i64>().ok().filter(|id| *id > 0),
        ) else {
            return Ok(None);
        };
        let (Some(writer), Some(session_id)) = (
            self.transcript_log.as_ref().map(Arc::clone),
            self.metadata.session_id.clone(),
        ) else {
            return Ok(None);
        };
        if owner != session_id {
            return Ok(None);
        }
        let blob_len = self
            .session_snapshot
            .lock()
            .await
            .as_ref()
            .map_or(0, |snapshot| snapshot.messages.len());
        let batch = crate::store::spawn_blocking_store_caller(move || {
            writer.read_assistant_batch_by_row(&session_id, row_id)
        })
        .await
        .map_err(|error| anyhow::anyhow!("tool occurrence read task failed: {error}"))??;
        let current_blob_len = self
            .session_snapshot
            .lock()
            .await
            .as_ref()
            .map_or(0, |snapshot| snapshot.messages.len());
        let Some((store_id, batch_digest, batch)) = batch else {
            return Ok(None);
        };
        if store_id != expected_store
            || batch_digest != digest
            || blob_len != current_blob_len
            || batch_end < row_id
            // A pending batch can later grow. Require a fresh projection in
            // that case: retaining only an earlier prefix cannot prove that a
            // subsequently removed result was not replaced after a revert.
            || batch.last().is_none_or(|(id, _, _)| *id != batch_end)
            || batch
                .first()
                .is_none_or(|(_, idx, _)| *idx < blob_len as u64)
        {
            return Ok(None);
        }
        let messages: Vec<Message> = batch.into_iter().map(|(_, _, message)| message).collect();
        Ok(
            find_occurrence_call(&messages, call_id).map(|(arguments, output)| FoundToolCall {
                arguments: arguments.to_owned(),
                output: output.cloned(),
            }),
        )
    }

    /// Find a call through the index instead of decoding the whole transcript.
    /// `Unindexed` sends the caller to the full scan: no log, tool calls in the
    /// snapshot blob (forks and legacy sessions), or a log that changed under
    /// the index while it was being read.
    async fn indexed_tool_call(&self, call_id: &str) -> Result<IndexedToolCall> {
        let (Some(writer), Some(session_id)) = (
            self.transcript_log.as_ref().map(Arc::clone),
            self.metadata.session_id.clone(),
        ) else {
            return Ok(IndexedToolCall::Unindexed);
        };
        let blob_has_calls = self
            .session_snapshot
            .lock()
            .await
            .as_ref()
            .is_some_and(|snapshot| snapshot.messages.iter().any(has_tool_calls));
        if blob_has_calls {
            return Ok(IndexedToolCall::Unindexed);
        }

        let row_id = {
            let mut index = self.tool_call_index.lock().await;
            let mut restarts = 0;
            loop {
                let (retained, rows) = read_rows_after(
                    &writer,
                    &session_id,
                    index.last_row_id,
                    TOOL_CALL_INDEX_PAGE,
                )
                .await?;
                if retained != index.rows {
                    // Rows the index holds were deleted (a trim or revert).
                    restarts += 1;
                    if restarts > 2 {
                        return Ok(IndexedToolCall::Unindexed);
                    }
                    *index = ToolCallIndex::default();
                    continue;
                }
                let complete = rows.len() < TOOL_CALL_INDEX_PAGE;
                for (row_id, _, message) in &rows {
                    index.record(*row_id, message);
                }
                if complete {
                    break;
                }
            }
            match index.calls.get(call_id).map(Vec::as_slice) {
                Some([row_id]) => *row_id,
                // Absent, or held twice: either way it names no call.
                _ => return Ok(IndexedToolCall::Absent),
            }
        };

        // The call's row, then the results that follow it up to the next
        // assistant or user message.
        let mut after = row_id - 1;
        let mut arguments = None;
        let mut output = None;
        'rows: loop {
            let (_, rows) =
                read_rows_after(&writer, &session_id, after, TOOL_CALL_RESULT_PAGE).await?;
            let complete = rows.len() < TOOL_CALL_RESULT_PAGE;
            for (id, _, message) in rows {
                after = id;
                if arguments.is_none() {
                    let Some(found) = (id == row_id)
                        .then(|| call_arguments(&message, call_id))
                        .flatten()
                    else {
                        return Ok(IndexedToolCall::Unindexed);
                    };
                    arguments = Some(found);
                    continue;
                }
                match message {
                    Message::Assistant { .. } | Message::User { .. } => break 'rows,
                    Message::Tool {
                        tool_call_id,
                        content,
                    } if tool_call_id == call_id => output = Some(content),
                    _ => {}
                }
            }
            if complete {
                break;
            }
        }
        Ok(match arguments {
            Some(arguments) => IndexedToolCall::Found(FoundToolCall { arguments, output }),
            None => IndexedToolCall::Unindexed,
        })
    }
}

/// Rows decoded per store command while the index catches up.
const TOOL_CALL_INDEX_PAGE: usize = 1024;
/// Rows decoded per store command while reading one call's results, which
/// usually end within a few rows.
const TOOL_CALL_RESULT_PAGE: usize = 32;

/// Where each tool call sits in the session's transcript log, by row id. Row
/// ids are never reused, so the index catches up by reading only rows newer
/// than the last one it holds, and fewer rows at or below that one prove some
/// were deleted; the index then starts over.
#[derive(Default)]
pub(super) struct ToolCallIndex {
    last_row_id: i64,
    rows: u64,
    calls: HashMap<String, Vec<i64>>,
}

impl ToolCallIndex {
    fn record(&mut self, row_id: i64, message: &Message) {
        if let Message::Assistant {
            tool_calls: Some(calls),
            ..
        } = message
        {
            for call in calls {
                self.calls.entry(call.id.clone()).or_default().push(row_id);
            }
        }
        self.last_row_id = row_id;
        self.rows += 1;
    }
}

struct FoundToolCall {
    arguments: String,
    output: Option<ToolContent>,
}

enum IndexedToolCall {
    Found(FoundToolCall),
    Absent,
    Unindexed,
}

async fn read_rows_after(
    writer: &Arc<crate::store::TranscriptLogWriter>,
    session_id: &str,
    after_row_id: i64,
    limit: usize,
) -> Result<(u64, Vec<crate::store::TranscriptLogRow>)> {
    let writer = Arc::clone(writer);
    let session_id = session_id.to_owned();
    crate::store::spawn_blocking_store_caller(move || {
        writer.read_rows_after(&session_id, after_row_id, limit)
    })
    .await
    .map_err(|error| anyhow::anyhow!("transcript log row read task failed: {error}"))?
}

fn has_tool_calls(message: &Message) -> bool {
    matches!(
        message,
        Message::Assistant {
            tool_calls: Some(calls),
            ..
        } if !calls.is_empty()
    )
}

fn call_arguments(message: &Message, call_id: &str) -> Option<String> {
    let Message::Assistant {
        tool_calls: Some(calls),
        ..
    } = message
    else {
        return None;
    };
    calls
        .iter()
        .find(|call| call.id == call_id)
        .map(|call| call.function.arguments.clone())
}

/// A JSON object or array is redacted through its decoded strings, so it still
/// parses: a pattern run over the encoded text can swallow the backslash of an
/// escaped quote, or run past `\n` escapes into the lines after it. Within a
/// decoded string the patterns run one line at a time, so they cannot take a
/// line break either and merge the rows of a diff; the exact secrets are still
/// matched across the whole string. Numbers retain their original tokens, so
/// exact secrets match even beyond numeric precision limits. A document with
/// nothing to redact comes back as written; otherwise its members keep their
/// order and the document its compact or pretty layout. A member under a
/// credential key, such as `password` or `token`, is masked whole at any depth,
/// whatever it holds.
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
    Number(Box<serde_json::value::RawValue>),
    String(String),
    Array(Vec<Document>),
    Object(Vec<(String, Document)>),
}

impl Document {
    fn redacted(self, redaction: &Redaction<'_>) -> Self {
        match self {
            Self::String(text) => Self::String(redaction.text(&text)),
            Self::Number(number) => {
                let text = number.get();
                if redaction.text(text) == text {
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
        // RawValue is already enabled for this crate. Decode only containers
        // and strings: converting a number through f64 would lose its written
        // spelling before exact-secret redaction could inspect it.
        let raw = Box::<serde_json::value::RawValue>::deserialize(deserializer)?;
        Self::from_raw(raw, 0).map_err(serde::de::Error::custom)
    }
}

impl Document {
    fn from_raw(raw: Box<serde_json::value::RawValue>, depth: usize) -> serde_json::Result<Self> {
        // Each RawValue starts a new parser, so retain serde_json's ordinary
        // nesting bound rather than allowing unbounded recursive documents.
        if depth >= 128 {
            return Err(serde::de::Error::custom("JSON nesting limit exceeded"));
        }
        let mut parser = serde_json::Deserializer::from_str(raw.get());
        match raw.get().as_bytes().first() {
            Some(b'{') => serde::Deserializer::deserialize_map(&mut parser, DocumentVisitor(depth)),
            Some(b'[') => serde::Deserializer::deserialize_seq(&mut parser, DocumentVisitor(depth)),
            Some(b'"') => serde_json::from_str(raw.get()).map(Document::String),
            Some(b'n') => Ok(Document::Null),
            Some(b't') => Ok(Document::Bool(true)),
            Some(b'f') => Ok(Document::Bool(false)),
            _ => Ok(Document::Number(raw)),
        }
    }
}

struct DocumentVisitor(usize);

impl<'de> serde::de::Visitor<'de> for DocumentVisitor {
    type Value = Document;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON object or array")
    }

    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Document, A::Error> {
        let mut items = Vec::new();
        while let Some(raw) = seq.next_element()? {
            items.push(Document::from_raw(raw, self.0 + 1).map_err(serde::de::Error::custom)?);
        }
        Ok(Document::Array(items))
    }

    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Document, A::Error> {
        let mut members = Vec::new();
        while let Some((key, raw)) = map.next_entry()? {
            let value = Document::from_raw(raw, self.0 + 1).map_err(serde::de::Error::custom)?;
            members.push((key, value));
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
    secrets
        .extend_redactions(crate::managed_native_credentials::captured_managed_native_redactions());
    Ok(secrets)
}

/// A legacy blob has no row identities. Bind its token to the entire exact
/// snapshot and owning session so rewrites and cross-session use fail closed.
pub(super) fn blob_fingerprint(session_id: &str, messages: &[Message]) -> Result<String> {
    let mut hash = Sha256::new();
    hash.update((session_id.len() as u64).to_be_bytes());
    hash.update(session_id.as_bytes());
    hash.update(serde_json::to_vec(messages)?);
    Ok(format!("{:x}", hash.finalize()))
}

/// Match only one call and at most one result within the bound assistant batch.
fn find_occurrence_call<'a>(
    messages: &'a [Message],
    call_id: &str,
) -> Option<(&'a str, Option<&'a ToolContent>)> {
    let Message::Assistant {
        tool_calls: Some(calls),
        ..
    } = messages.first()?
    else {
        return None;
    };
    let mut calls = calls.iter().filter(|call| call.id == call_id);
    let call = calls.next()?;
    if calls.next().is_some() {
        return None;
    }
    let mut results = messages.iter().skip(1).filter_map(|message| match message {
        Message::Tool {
            tool_call_id,
            content,
        } if tool_call_id == call_id => Some(content),
        _ => None,
    });
    let output = results.next();
    if results.next().is_some() {
        return None;
    }
    Some((call.function.arguments.as_str(), output))
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
