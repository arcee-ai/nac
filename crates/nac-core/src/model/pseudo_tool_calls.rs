//! Recovery of tool calls that arrive as prose instead of as `tool_calls`.
//!
//! Applied on the Arcee chat path only. Arcee serves Trinity behind vLLM, whose
//! reasoning parser splits the model's `<think>` block into `reasoning_content`.
//! When the model writes its tool call inside that block, the whole call travels
//! with the reasoning and the request comes back with no `tool_calls` and no
//! content at all — the turn reads as an empty answer even though the model did
//! decide to act.
//!
//! Other OpenAI-compatible backends keep a plain client and do not run this
//! recovery or the companion wire-format inject in [`arcee_message_to_value`].
//!
//! The block that arrives looks like this, with the opening `<tool_call>` of the
//! first call consumed upstream and later ones intact:
//!
//! ```text
//! <function=thread>
//! <parameter=name>
//! audit
//! </parameter>
//! </function>
//! </tool_call>
//! ```
//!
//! Only a trailing run of such blocks is recovered, and only against the tools
//! the request actually offered, so reasoning that merely talks about a tool is
//! left alone.
//!
//! When recovery cannot run (native `tool_calls` already present, or the provider
//! ate the openers and left only closers), [`sanitize_leaked_tool_markup`] still
//! strips the Hermes/Llama XML family so it neither paints the Thoughts panel
//! nor primes the next iteration to leak again.

use super::*;

/// Tag names from the Hermes / Llama native tool-call XML family that providers
/// sometimes leave in `content` or `reasoning_content` instead of routing through
/// structured `tool_calls`.
const NATIVE_TOOL_TAGS: &[&str] = &[
    "parameter",
    "tool_use",
    "tool_call",
    "tool_name",
    "invoke",
    "arguments",
    "parameters",
    "function",
];

/// Rewrites a turn whose tool calls were left in the reasoning channel.
///
/// Does nothing unless the turn is the exact shape that failure produces: a stop
/// with no tool calls, no visible content, and reasoning that ends in one or
/// more complete call blocks naming tools this request offered. Anything else —
/// including a block whose arguments do not fit the tool's schema — is left
/// untouched rather than guessed at, since inventing a call is worse than
/// reporting an empty turn.
pub(super) fn recover_reasoning_tool_calls(
    response: &mut ModelTurnResponse,
    tools: &[ToolDefinition],
) {
    if tools.is_empty()
        || response
            .assistant
            .tool_calls
            .as_ref()
            .is_some_and(|tool_calls| !tool_calls.is_empty())
    {
        return;
    }
    if response
        .assistant
        .content
        .as_deref()
        .is_some_and(|content| !content.trim().is_empty())
    {
        return;
    }
    // A length or content-filter stop means the block is cut off somewhere, and
    // half a call is not worth acting on.
    if response
        .finish_reason
        .as_deref()
        .is_some_and(|reason| reason != "stop")
    {
        return;
    }
    let Some(reasoning) = response.assistant.reasoning_text.as_deref() else {
        return;
    };

    let Some(recovered) = recover_from_reasoning(reasoning, tools) else {
        return;
    };

    response.assistant.reasoning_text = recovered.reasoning;
    response.assistant.tool_calls = Some(recovered.tool_calls);
    response.finish_reason = Some("tool_calls".to_string());
}

/// Drops leaked native tool-call XML from the assistant turn after recovery.
///
/// Covers the cases recovery cannot fix: structured `tool_calls` already present
/// with a duplicate XML copy in reasoning, and orphan closers
/// (`</parameter></function></tool_call>`) left after the provider ate the
/// openers. Safe to run on every chat-completions response.
pub(super) fn sanitize_leaked_tool_markup(response: &mut ModelTurnResponse) {
    if let Some(reasoning) = response.assistant.reasoning_text.take() {
        let cleaned = strip_native_tool_format_tags(&reasoning);
        let trimmed = cleaned.trim();
        response.assistant.reasoning_text = (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    if let Some(content) = response.assistant.content.as_mut() {
        let cleaned = strip_native_tool_format_tags(content);
        if cleaned != *content {
            *content = cleaned;
        }
    }
}

/// Strips Hermes/Llama tool-call markup from text headed back to the model or UI.
pub(super) fn strip_native_tool_format_tags(text: &str) -> String {
    if !text.contains('<') {
        return text.to_string();
    }

    let mut cleaned = text.to_string();
    loop {
        let before_len = cleaned.len();
        for name in NATIVE_TOOL_TAGS {
            cleaned = remove_paired_tag_blocks(&cleaned, name);
        }
        if cleaned.len() == before_len {
            break;
        }
    }
    for name in NATIVE_TOOL_TAGS {
        cleaned = remove_stray_tags(&cleaned, name);
    }
    cleaned
}

/// Recovery plus markup sanitize — the post-parse step for chat-completions
/// backends that can trap tool calls inside reasoning.
pub(super) fn finalize_chat_tool_recovery(
    response: &mut ModelTurnResponse,
    tools: &[ToolDefinition],
) {
    recover_reasoning_tool_calls(response, tools);
    sanitize_leaked_tool_markup(response);
}

struct Recovered {
    /// The reasoning with the recovered block removed, or `None` once nothing
    /// but the block was there.
    reasoning: Option<String>,
    tool_calls: Vec<ToolCall>,
}

fn recover_from_reasoning(reasoning: &str, tools: &[ToolDefinition]) -> Option<Recovered> {
    let (start, calls) = trailing_call_block(reasoning, tools)?;

    // The parser leaves an unterminated `<think>` behind when it hands the block
    // over, and it would otherwise be the first thing shown of the reasoning.
    let prose = reasoning[..start].trim();
    let prose = prose.strip_prefix("<think>").unwrap_or(prose).trim();

    Some(Recovered {
        reasoning: (!prose.is_empty()).then(|| prose.to_string()),
        // Fresh ids every recovery — a stable `recovered_1` reused across turns
        // collides in the transcript's tool-result map and paints the wrong
        // episode onto a later thread card.
        tool_calls: calls
            .into_iter()
            .map(|call| ToolCall {
                id: format!("recovered_{}", uuid::Uuid::new_v4().simple()),
                call_type: "function".to_string(),
                function: call,
            })
            .collect(),
    })
}

/// Finds the earliest position from which the rest of `text` is nothing but call
/// blocks, together with the calls parsed out of it.
///
/// Starting from the earliest candidate keeps a run of several calls whole; a
/// candidate that turns out to be ordinary prose simply fails to parse and the
/// search moves on to the next one.
fn trailing_call_block(text: &str, tools: &[ToolDefinition]) -> Option<(usize, Vec<FunctionCall>)> {
    for (start, _) in text.char_indices() {
        if !text[start..].starts_with("<tool_call>") && !text[start..].starts_with("<function=") {
            continue;
        }
        if let Some(calls) = parse_call_blocks(&text[start..], tools) {
            return Some((start, calls));
        }
    }
    None
}

/// Parses `text` as one or more call blocks and nothing else.
fn parse_call_blocks(text: &str, tools: &[ToolDefinition]) -> Option<Vec<FunctionCall>> {
    let mut cursor = Cursor::new(text);
    let mut calls = Vec::new();
    while !cursor.at_end() {
        calls.push(parse_call_block(&mut cursor, tools)?);
    }
    (!calls.is_empty()).then_some(calls)
}

fn parse_call_block(cursor: &mut Cursor<'_>, tools: &[ToolDefinition]) -> Option<FunctionCall> {
    // The upstream parser consumes the first call's opener, so it is optional
    // here while every following call still carries one.
    cursor.eat("<tool_call>");
    cursor.expect("<function=")?;
    let name = cursor.take_name('>')?;
    let parameters = tool_parameters(tools, name)?;

    let mut arguments = serde_json::Map::new();
    while cursor.eat("<parameter=") {
        let key = cursor.take_name('>')?;
        let raw = cursor.take_until("</parameter>")?;
        let schema = parameters
            .get("properties")
            .and_then(|properties| properties.get(key));
        let value = coerce_argument(raw.trim(), schema)?;
        if arguments.insert(key.to_string(), value).is_some() {
            return None;
        }
    }

    // Closers are optional in the same way the opener is: the model has been
    // seen to drop them, and a call is fully determined without them.
    cursor.eat("</function>");
    cursor.eat("</tool_call>");

    Some(FunctionCall {
        name: name.to_string(),
        arguments: Value::Object(arguments).to_string(),
    })
}

/// A named tool's parameter schema, or `None` when the request never offered
/// that tool — which is what keeps prose about a tool from becoming a call.
fn tool_parameters<'tools>(tools: &'tools [ToolDefinition], name: &str) -> Option<&'tools Value> {
    tools
        .iter()
        .find(|tool| tool.function.name == name)
        .map(|tool| &tool.function.parameters)
}

/// Reads a parameter's text as the type its schema declares.
///
/// Everything arrives as text, so a declared number or flag has to be read back
/// out of it; a value that will not read that way fails the whole recovery
/// rather than reaching the tool as the wrong type.
fn coerce_argument(raw: &str, schema: Option<&Value>) -> Option<Value> {
    let declared = schema
        .and_then(|schema| schema.get("type"))
        .and_then(Value::as_str);
    match declared {
        Some("integer") => raw.parse::<i64>().ok().map(Value::from),
        Some("number") => raw.parse::<f64>().ok().map(Value::from),
        Some("boolean") => raw.parse::<bool>().ok().map(Value::from),
        Some("array") | Some("object") => serde_json::from_str::<Value>(raw)
            .ok()
            .filter(|value| value.is_array() || value.is_object()),
        _ => Some(Value::String(raw.to_string())),
    }
}

fn remove_paired_tag_blocks(text: &str, name: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some((open_start, open_end)) = find_open_tag(&text[cursor..], name) {
        let absolute_open = cursor + open_start;
        let absolute_after_open = cursor + open_end;
        out.push_str(&text[cursor..absolute_open]);
        match find_close_tag(&text[absolute_after_open..], name) {
            Some((_close_start, close_end)) => {
                // Drop the whole paired block, including its inner payload —
                // that payload is tool args, not prose the next turn should see.
                cursor = absolute_after_open + close_end;
            }
            None => {
                // Unclosed opener: leave it for the stray pass.
                out.push_str(&text[absolute_open..absolute_after_open]);
                cursor = absolute_after_open;
            }
        }
    }
    out.push_str(&text[cursor..]);
    out
}

fn remove_stray_tags(text: &str, name: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some((start, end)) = find_any_tag(&text[cursor..], name) {
        let absolute_start = cursor + start;
        let absolute_end = cursor + end;
        out.push_str(&text[cursor..absolute_start]);
        cursor = absolute_end;
    }
    out.push_str(&text[cursor..]);
    out
}

/// `<name…>` opener spanning `[start, end)` relative to `text`.
fn find_open_tag(text: &str, name: &str) -> Option<(usize, usize)> {
    find_tag(text, name, TagKind::Open)
}

/// `</name…>` closer spanning `[start, end)` relative to `text`.
fn find_close_tag(text: &str, name: &str) -> Option<(usize, usize)> {
    find_tag(text, name, TagKind::Close)
}

fn find_any_tag(text: &str, name: &str) -> Option<(usize, usize)> {
    find_tag(text, name, TagKind::Either)
}

#[derive(Clone, Copy)]
enum TagKind {
    Open,
    Close,
    Either,
}

fn find_tag(text: &str, name: &str, kind: TagKind) -> Option<(usize, usize)> {
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find('<') {
        let start = search_from + rel;
        let mut after = start + 1;
        let is_close = text[after..].starts_with('/');
        if is_close {
            after += 1;
        }
        let matches_kind = match kind {
            TagKind::Open => !is_close,
            TagKind::Close => is_close,
            TagKind::Either => true,
        };
        let name_end = after + name.len();
        if matches_kind
            && name_end <= text.len()
            && text[after..name_end].eq_ignore_ascii_case(name)
            && tag_name_boundary(&text[name_end..])
        {
            if let Some(gt) = text[name_end..].find('>') {
                return Some((start, name_end + gt + 1));
            }
        }
        search_from = start + 1;
    }
    None
}

/// True when the character after a candidate tag name ends the name
/// (`>`, `=`, whitespace, or attributes) rather than extending it
/// (`<functional>` must not match `function`).
fn tag_name_boundary(after_name: &str) -> bool {
    match after_name.chars().next() {
        None => false,
        Some(c) => !c.is_ascii_alphanumeric() && !matches!(c, '_' | '-' | '.' | ':'),
    }
}

/// A forward-only reader over the block, which skips whitespace between tags but
/// accepts nothing else in that position.
struct Cursor<'text> {
    text: &'text str,
    at: usize,
}

impl<'text> Cursor<'text> {
    fn new(text: &'text str) -> Self {
        Self { text, at: 0 }
    }

    fn rest(&mut self) -> &'text str {
        self.at += self.text[self.at..].len() - self.text[self.at..].trim_start().len();
        &self.text[self.at..]
    }

    fn at_end(&mut self) -> bool {
        self.rest().is_empty()
    }

    fn eat(&mut self, tag: &str) -> bool {
        if self.rest().starts_with(tag) {
            self.at += tag.len();
            true
        } else {
            false
        }
    }

    fn expect(&mut self, tag: &str) -> Option<()> {
        self.eat(tag).then_some(())
    }

    /// A tool or parameter name, up to `terminator`.
    fn take_name(&mut self, terminator: char) -> Option<&'text str> {
        let rest = self.rest();
        let end = rest.find(terminator)?;
        let name = &rest[..end];
        let mut characters = name.chars();
        let valid = characters
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
            && characters.all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | ':' | '-')
            });
        valid.then(|| {
            self.at += end + terminator.len_utf8();
            name
        })
    }

    /// Everything up to `tag`, which is consumed with it.
    fn take_until(&mut self, tag: &str) -> Option<&'text str> {
        // Deliberately not whitespace-skipping: this is a value, not a position
        // between tags, and its own trimming belongs to the caller.
        let rest = &self.text[self.at..];
        let end = rest.find(tag)?;
        self.at += end + tag.len();
        Some(&rest[..end])
    }
}
