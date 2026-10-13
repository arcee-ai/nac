//! On-demand model observation over the shared execution resolver. No lifecycle
//! operation, source-policy fallback, or browser/model cursor is acquired here.
use serde_json::{json, Value};

use super::{kernel, ToolResult, ToolRuntime};
use crate::terminal::{ExecutionStatus, InputController, OutputBytePage, OutputStream};
use crate::types::{FunctionDef, ToolDefinition};

const MAX_CATALOG_ENTRIES: usize = 32;
const MAX_QUERY_BYTES: usize = 256;
const MAX_MATCHES: usize = 16;
const MATCH_CONTEXT_BYTES: usize = 64;

pub(super) struct ListExecutionsTool;

impl kernel::NativeTool for ListExecutionsTool {
    type Input = Value;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            def_type: "function".into(),
            function: FunctionDef {
                name: "list_executions".into(),
                description: "List a compact bounded inventory of this direct chat's existing human terminals, agent executions and exact human commands. Empty inventory is valid. IDs expire with their process-local owner/output capability. Read/search output on demand with read_command_output execution_id. Discovery contains no scrollback, grants no input/stop/retention authority and never launches, recovers or wakes anything.".into(),
                parameters: json!({
                    "type":"object", "additionalProperties":false,
                    "properties": {
                        "after":{"type":"string","maxLength":160,"description":"Exclusive execution ID cursor returned as next_after; inventory is a current view, not a frozen history"},
                        "limit":{"type":"integer","minimum":1,"maximum":MAX_CATALOG_ENTRIES,"default":16}
                    }
                }),
            },
        }
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Value, ToolResult> {
        let object = input
            .as_object()
            .ok_or_else(|| invalid("arguments must be an object"))?;
        if object
            .keys()
            .any(|key| !matches!(key.as_str(), "after" | "limit"))
        {
            return Err(invalid("unknown inventory argument"));
        }
        if object
            .get("after")
            .is_some_and(|value| value.as_str().is_none_or(|s| s.len() > 160))
        {
            return Err(invalid(
                "after must be an execution ID of at most 160 bytes",
            ));
        }
        if object.get("limit").is_some_and(|value| {
            value
                .as_u64()
                .is_none_or(|n| n == 0 || n > MAX_CATALOG_ENTRIES as u64)
        }) {
            return Err(invalid("inventory limit must be between 1 and 32"));
        }
        Ok(input)
    }

    fn permission_resources(
        &self,
        _input: &Value,
        services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        Ok(vec![kernel::PermissionResource::new(
            "command_output",
            authorize_owner(services.runtime)?,
        )])
    }

    fn bind_authorized_resources(
        &self,
        _input: &mut Value,
        resources: &[kernel::PermissionResource],
        services: kernel::ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        let expected =
            kernel::PermissionResource::new("command_output", authorize_owner(services.runtime)?);
        if resources != [expected] {
            return Err(invalid("execution authorization changed"));
        }
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Value,
        services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            if let Err(error) = validate_current_owner(services.runtime).await {
                return error;
            }
            let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(16) as usize;
            let after = input.get("after").and_then(Value::as_str);
            let mut entries = services
                .runtime
                .terminal_manager
                .execution_catalog()
                .await
                .into_iter()
                .filter(|entry| after.is_none_or(|after| entry.id.as_str() > after))
                .take(limit + 1)
                .collect::<Vec<_>>();
            let more = entries.len() > limit;
            entries.truncate(limit);
            let next_after = more
                .then(|| entries.last().map(|entry| entry.id.clone()))
                .flatten();
            let executions = entries
                .iter()
                .map(|entry| {
                    let input = services
                        .runtime
                        .terminal_manager
                        .execution_model_input_state(&entry.id)
                        .is_some_and(|state| {
                            state.controller == InputController::Agent && !state.frozen
                        });
                    inventory_entry(entry, input)
                })
                .collect::<Vec<_>>();
            result(json!({"executions":executions,"next_after":next_after}))
        })
    }
}

/// The attached direct primary's broker supplies ordinary Deny/Ask/config
/// fencing. The manager additionally binds the exact store/session and instance;
/// neither copied provenance nor a shared project/cwd supplies that authority.
pub(super) fn authorize_owner(runtime: &ToolRuntime) -> Result<String, ToolResult> {
    if runtime.permission_broker.is_none() {
        return Err(unavailable());
    }
    runtime
        .terminal_manager
        .model_observation_resource(&runtime.store_path, runtime.session_id.as_deref())
        .map_err(|_| unavailable())
}

async fn validate_current_owner(runtime: &ToolRuntime) -> Result<(), ToolResult> {
    authorize_owner(runtime)?;
    runtime
        .permission_broker
        .as_ref()
        .ok_or_else(unavailable)?
        .validate_execution_observation_binding(
            &runtime.store_path,
            runtime.session_id.as_deref(),
            runtime.backend.as_ref(),
        )
        .await
        .map_err(|_| unavailable())
}

fn inventory_entry(entry: &ExecutionStatus, input: bool) -> Value {
    json!({
        "id":entry.id,"origin":entry.origin,"representation":entry.representation,
        "cwd":entry.cwd,"backend":entry.backend,"process_state":entry.process_state,
        "exit_code":entry.exit_code,"output_complete":entry.output_complete,"output_error":entry.output_error,
        "retained":entry.retained,"read":true,
        "input":input
    })
}

pub(super) fn offset(input: &Value) -> Result<u64, ToolResult> {
    match input.get("offset") {
        None => Ok(0),
        Some(value) if value.is_u64() => value.as_u64().ok_or_else(|| invalid("invalid offset")),
        Some(Value::String(value))
            if !value.is_empty()
                && (value == "0" || !value.starts_with('0'))
                && value.bytes().all(|b| b.is_ascii_digit()) =>
        {
            value
                .parse()
                .map_err(|_| invalid("offset exceeds the unsigned 64-bit range"))
        }
        _ => Err(invalid(
            "offset must be an unsigned integer or canonical decimal string",
        )),
    }
}

pub(super) fn validate_query(input: &Value) -> Result<(), ToolResult> {
    if let Some(value) = input.get("query") {
        let query = value
            .as_str()
            .filter(|q| !q.is_empty() && q.len() <= MAX_QUERY_BYTES)
            .ok_or_else(|| invalid("query must contain 1 to 256 UTF-8 bytes"))?;
        let limit = input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(crate::terminal::DEFAULT_OUTPUT_PAGE_BYTES as u64);
        if limit <= query.len() as u64 {
            return Err(invalid("search limit must exceed query byte length"));
        }
    }
    Ok(())
}

pub(super) async fn read(input: &Value, runtime: &ToolRuntime) -> ToolResult {
    if let Err(error) = validate_current_owner(runtime).await {
        return error;
    }
    let id = input["execution_id"].as_str().unwrap_or_default();
    let stream = match OutputStream::parse(input.get("stream").and_then(Value::as_str)) {
        Ok(stream) => stream,
        Err(_) => return invalid("invalid output stream"),
    };
    let offset = match offset(input) {
        Ok(offset) => offset,
        Err(error) => return error,
    };
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(crate::terminal::DEFAULT_OUTPUT_PAGE_BYTES as u64) as usize;
    // Sample completion before paging so EOF includes the collector's final
    // committed append. No status lookup reconciles or archives uncertain work.
    let status = match runtime.terminal_manager.execution_status(id).await {
        Ok(status) => status,
        Err(_) => return unavailable(),
    };
    let page = match runtime
        .terminal_manager
        .read_execution_stream_output(id, stream, offset, limit)
        .await
    {
        Ok(page) => page,
        Err(_) => return unavailable(),
    };
    let mut response = page_metadata(&status, stream, &page);
    if let Some(query) = input.get("query").and_then(Value::as_str) {
        let (matches, continuation) = search_page(&page, query.as_bytes());
        response["matches"] = matches.into();
        response["next_offset"] = continuation.to_string().into();
        response["search_complete"] = (page.caught_up && continuation == page.next_offset).into();
        response["caught_up"] = (page.caught_up && continuation == page.next_offset).into();
        response["eof"] =
            (status.output_complete && page.caught_up && continuation == page.next_offset).into();
    } else {
        response["content"] = text(&page.bytes).into();
    }
    result(response)
}

fn page_metadata(status: &ExecutionStatus, stream: OutputStream, page: &OutputBytePage) -> Value {
    json!({
        "execution_id":status.id,"stream":stream,"offset":page.offset.to_string(),
        "next_offset":page.next_offset.to_string(),"retained_start":page.retained_start.to_string(),
        "retained_end":page.retained_end.to_string(),"gap":page.gap,"caught_up":page.caught_up,
        "process_state":status.process_state,"exit_code":status.exit_code,
        "output_complete":status.output_complete,"output_error":status.output_error,
        "eof":status.output_complete && page.caught_up,
        "representation":"sanitized_text_controls_escaped"
    })
}

fn search_page(page: &OutputBytePage, query: &[u8]) -> (Vec<Value>, u64) {
    let mut matches = Vec::new();
    if page.gap {
        return (matches, page.next_offset);
    }
    for (index, window) in page.bytes.windows(query.len()).enumerate() {
        if window != query {
            continue;
        }
        if matches.len() == MAX_MATCHES {
            // Resume exactly at the first unreturned match; no omitted match
            // is discarded because the bounded result reached its capacity.
            return (matches, page.offset + index as u64);
        }
        let start = index.saturating_sub(MATCH_CONTEXT_BYTES);
        let end = (index + query.len() + MATCH_CONTEXT_BYTES).min(page.bytes.len());
        matches.push(json!({"offset":(page.offset + index as u64).to_string(),"context":text(&page.bytes[start..end])}));
    }
    let continuation = if !page.caught_up && page.bytes.len() >= query.len() {
        // Overlap only the possible unfinished match suffix. Every complete
        // match in this page starts before the next page's cursor.
        page.next_offset - (query.len() - 1) as u64
    } else {
        page.next_offset
    };
    (matches, continuation)
}

/// Canonical bytes are already source-masked. Decode lossily and escape
/// controls without deleting/joining them or applying another masking policy.
fn text(bytes: &[u8]) -> String {
    let mut output = String::new();
    for character in String::from_utf8_lossy(bytes).chars() {
        if character.is_control() && !matches!(character, '\n' | '\t') {
            use std::fmt::Write;
            let _ = write!(output, "\\u{{{:04x}}}", character as u32);
        } else {
            output.push(character);
        }
    }
    output
}

fn invalid(message: &str) -> ToolResult {
    ToolResult::text(format!("Error: {message}"), true)
}
fn unavailable() -> ToolResult {
    invalid("execution unavailable")
}
fn result(value: Value) -> ToolResult {
    ToolResult::text(value.to_string(), false)
}

#[cfg(test)]
#[path = "execution_observation_tests.rs"]
mod tests;
