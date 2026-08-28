use crate::tools::ToolResult;
use crate::types::ToolCall;

use super::{preview, preview_tool_args};

fn canonical_tool_arguments(raw: &str) -> String {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|value| serde_json::to_string(&value).ok())
        .unwrap_or_else(|| raw.to_string())
}

fn tool_call_arguments<'a>(calls: &'a [ToolCall], call_id: &str) -> &'a str {
    calls
        .iter()
        .find(|call| call.id == call_id)
        .map(|call| call.function.arguments.as_str())
        .unwrap_or("")
}

fn tool_result_error_identity(result: &ToolResult) -> String {
    let Some(text) = result.content.as_text() else {
        return "error".to_string();
    };
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(value) => match value.get("error") {
            Some(error) => serde_json::to_string(error).unwrap_or_else(|_| error.to_string()),
            None => serde_json::to_string(&value).unwrap_or_else(|_| text.to_string()),
        },
        Err(_) => text.to_string(),
    }
}

pub(super) struct FailedToolRound {
    pub(super) signature: String,
    pub(super) detail: String,
}

pub(super) fn failed_tool_round(
    calls: &[ToolCall],
    results: &[(String, String, ToolResult)],
) -> Option<FailedToolRound> {
    let mut signature_parts = Vec::new();
    let mut detail_parts = Vec::new();
    for (id, name, result) in results {
        if !result.is_error {
            continue;
        }
        let arguments = tool_call_arguments(calls, id);
        let error = tool_result_error_identity(result);
        signature_parts.push(format!(
            "{name}\t{}\t{error}",
            canonical_tool_arguments(arguments)
        ));
        detail_parts.push(format!(
            "{name} {} {error}",
            preview_tool_args(name, arguments)
        ));
    }
    if signature_parts.is_empty() {
        return None;
    }
    signature_parts.sort();
    detail_parts.sort();
    Some(FailedToolRound {
        signature: signature_parts.join("\n"),
        detail: preview(&detail_parts.join("; "), 400),
    })
}
