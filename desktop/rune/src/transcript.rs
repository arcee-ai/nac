//! The stored transcript as the session page draws it: the snapshot's `messages` (OpenAI-style
//! `system`, `user`, `assistant` with `tool_calls`, and `tool` results) become user bubbles,
//! Markdown text, reasoning and tool rows.

use serde_json::Value;

/// Tool arguments and output are cut to this many characters on screen.
const DETAIL_LIMIT: usize = 6_000;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ToolStatus {
    Running,
    Done,
    Failed,
}

#[derive(Clone, Debug)]
pub struct Tool {
    pub call_id: String,
    pub name: String,
    /// What the call acted on: a path, a command or a name.
    pub target: String,
    pub args: String,
    pub output: Option<String>,
    pub status: ToolStatus,
}

#[derive(Clone, Debug)]
pub enum Item {
    User(String),
    Text(String),
    Reasoning(String),
    Tool(Tool),
}

fn clip(text: &str) -> String {
    match text.char_indices().nth(DETAIL_LIMIT) {
        Some((at, _)) => format!("{}\n… ({} more characters)", &text[..at], text[at..].chars().count()),
        None => text.to_owned(),
    }
}

/// A tool result's content: a string, or content parts with `text`.
fn content_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str().or(p.as_str())).collect::<Vec<_>>().join("\n"),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// What a call acted on, from its JSON arguments: the first of the usual argument names, else
/// the first string in it.
pub fn target(args: &str) -> String {
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(args) else { return String::new() };
    const KEYS: [&str; 12] = ["command", "cmd", "path", "file_path", "pattern", "query", "url", "name", "thread", "action", "prompt", "instruction"];
    let found = KEYS.iter().find_map(|k| map.get(*k).and_then(Value::as_str)).or_else(|| map.values().find_map(Value::as_str));
    found.map(|s| s.lines().next().unwrap_or_default().chars().take(160).collect()).unwrap_or_default()
}

/// Pretty-prints JSON arguments; anything else is shown as it is.
fn pretty(args: &str) -> String {
    serde_json::from_str::<Value>(args).ok().and_then(|v| serde_json::to_string_pretty(&v).ok()).unwrap_or_else(|| args.to_owned())
}

pub fn items(messages: &[Value]) -> Vec<Item> {
    let mut out: Vec<Item> = Vec::new();
    for message in messages {
        match message["role"].as_str().unwrap_or_default() {
            "user" => {
                let text = content_text(&message["content"]);
                if !text.trim().is_empty() {
                    out.push(Item::User(text.trim().to_owned()));
                }
            }
            "assistant" => {
                if let Some(reasoning) = message["reasoning_text"].as_str().filter(|r| !r.trim().is_empty()) {
                    out.push(Item::Reasoning(reasoning.trim().to_owned()));
                }
                if let Some(text) = message["content"].as_str().filter(|t| !t.trim().is_empty()) {
                    out.push(Item::Text(text.to_owned()));
                }
                for call in message["tool_calls"].as_array().into_iter().flatten() {
                    let args = call["function"]["arguments"].as_str().unwrap_or_default();
                    out.push(Item::Tool(Tool {
                        call_id: call["id"].as_str().unwrap_or_default().to_owned(),
                        name: call["function"]["name"].as_str().unwrap_or("tool").to_owned(),
                        target: target(args),
                        args: clip(&pretty(args)),
                        output: None,
                        status: ToolStatus::Done,
                    }));
                }
            }
            "tool" => {
                let id = message["tool_call_id"].as_str().unwrap_or_default();
                if let Some(tool) = out.iter_mut().rev().find_map(|i| if let Item::Tool(t) = i { Some(t).filter(|t| t.call_id == id) } else { None }) {
                    tool.output = Some(clip(content_text(&message["content"]).trim_end()));
                }
            }
            // The system prompt is long and not part of the conversation.
            _ => {}
        }
    }
    out
}
