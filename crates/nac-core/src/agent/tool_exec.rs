use super::*;
use futures_util::FutureExt;
use std::panic::AssertUnwindSafe;
use tokio::task::JoinSet;

/// Sort results by original index, strip the index, and return as
/// `Vec<(tool_call_id, tool_name, ToolResult)>`.
fn sort_and_strip_index(
    mut results: Vec<(usize, String, String, ToolResult)>,
) -> Vec<(String, String, ToolResult)> {
    results.sort_by_key(|(index, ..)| *index);
    results
        .into_iter()
        .map(|(_, tool_call_id, tool_name, result)| (tool_call_id, tool_name, result))
        .collect()
}

/// Spawn tool calls into a `JoinSet`, emitting `ToolCallStarted`
/// for each.  Each spawned task returns
/// `(original_index, tool_call_id, tool_name, result)`.
async fn spawn_tools_into(
    join_set: &mut JoinSet<(usize, String, String, ToolResult)>,
    calls: Vec<(usize, String, String, String)>,
    runtime: &ToolRuntime,
    client: &ModelClient,
    event_sink: &EventSink,
) {
    for (index, tool_call_id, tool_name, args_str) in calls {
        let runtime = runtime.clone();
        let client = client.clone();
        let presentation_args = if tool_name == "subagent" {
            subagent_presentation_arguments(&runtime, &args_str).await
        } else {
            Some(args_str.clone())
        };
        let raw_started = AgentEvent::ToolCallStarted {
            call_id: tool_call_id.clone(),
            name: tool_name.clone(),
            args_preview: presentation_args
                .as_deref()
                .map(|args| preview_tool_args(&tool_name, args))
                .unwrap_or_default(),
            key_arg_preview: if tool_name == "subagent" {
                presentation_args
                    .as_deref()
                    .map(|args| key_arg_preview(&tool_name, Some(args), args))
                    .filter(|summary| !summary.is_empty())
            } else {
                None
            },
            args_detail: presentation_args.as_deref().map(tool_args_detail),
            delegation_intent: None,
            delegation_summary_verified: false,
        };
        let (started, presentation_key_arg) = if tool_name == "subagent" {
            // EventSink sanitizes each publication, and a bus sink sanitizes it
            // again. Capture that same idempotent, bounded event's summary.
            let sanitized = crate::events::sanitize_external_agent_event(raw_started);
            let stable = sanitized
                .clone()
                .and_then(crate::events::sanitize_external_agent_event);
            let key = match stable {
                Some(AgentEvent::ToolCallStarted {
                    key_arg_preview, ..
                }) => key_arg_preview,
                _ => None,
            };
            (sanitized, key)
        } else {
            // Preserve the preexisting EventSink path for all other tools.
            (Some(raw_started), None)
        };
        if let Some(started) = started {
            event_sink.emit_async(started).await;
        }
        let call_context = tools::kernel::ToolCallContext {
            call_id: Some(tool_call_id.clone()),
            presentation_key_arg,
            ..Default::default()
        };

        join_set.spawn(async move {
            let parsed_args = match serde_json::from_str::<serde_json::Value>(&args_str) {
                Ok(value) => value,
                Err(error) => {
                    return (
                        index,
                        tool_call_id,
                        tool_name.clone(),
                        ToolResult {
                            content: (format!(
                                "Error: failed to parse tool arguments for '{tool_name}': {error}"
                            ))
                            .into(),
                            is_error: true,
                            execution_duration_ms: None,
                            execution_duration_excludes_authorization: false,
                            delegation_outcome: None,
                            delegation_summary: None,
                        },
                    );
                }
            };
            let result = AssertUnwindSafe(tools::execute_tool_with_context(
                &tool_name,
                parsed_args,
                &runtime,
                &client,
                &call_context,
            ))
            .catch_unwind()
            .await
            .unwrap_or_else(|_| {
                ToolResult::text(format!("Error: tool '{tool_name}' panicked"), true)
            });
            (index, tool_call_id, tool_name, result)
        });
    }
}

pub(super) async fn execute_tools_parallel(
    tool_calls: Vec<ToolCall>,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
    admission_controlled: bool,
) -> Vec<(String, String, ToolResult)> {
    let calls = tool_calls
        .into_iter()
        .enumerate()
        .map(|(index, call)| (index, call.id, call.function.name, call.function.arguments))
        .collect();
    if admission_controlled {
        execute_admission_controlled(calls, runtime, client, event_sink).await
    } else {
        execute_simple(calls, runtime, client, event_sink).await
    }
}

pub(super) async fn finalize_tool_results(
    messages: &[Message],
    results: Vec<(String, String, ToolResult)>,
    event_sink: &EventSink,
) -> Vec<Message> {
    let mut transcript_image_stats = Ok(crate::tool_content::ImageStats::default());
    for message in messages {
        if let Message::Tool { content, .. } = message {
            transcript_image_stats =
                transcript_image_stats.and_then(|stats| stats.checked_add(content.image_stats()));
        }
    }
    let mut finalized = Vec::with_capacity(results.len());
    for (tool_call_id, tool_name, mut result) in results {
        let was_image_result = result.content.contains_images();
        if was_image_result {
            let next_stats = transcript_image_stats
                .as_ref()
                .map_err(Clone::clone)
                .and_then(|stats| stats.checked_add(result.content.image_stats()));
            match next_stats {
                Ok(stats) => transcript_image_stats = Ok(stats),
                Err(_) => {
                    // Keep all private timing provenance when replacing the body.
                    result.content =
                        "Error: image_limit_exceeded: image history limit reached".into();
                    result.is_error = true;
                }
            }
            event_sink
                .emit_async(AgentEvent::tool_call_finished(
                    tool_call_id.clone(),
                    tool_name,
                    &result,
                ))
                .await;
        }
        finalized.push(Message::Tool {
            tool_call_id,
            content: result.content,
        });
    }
    finalized
}

type IndexedToolCall = (usize, String, String, String);

fn admission_groups(calls: Vec<IndexedToolCall>) -> Vec<Vec<IndexedToolCall>> {
    let mut groups = Vec::new();
    let mut parallel = Vec::new();
    for call in calls {
        let admission = crate::tools::direct_tool_admission(&call.2)
            .unwrap_or(crate::tools::kernel::ToolAdmission::Exclusive);
        match admission {
            crate::tools::kernel::ToolAdmission::Parallel => parallel.push(call),
            crate::tools::kernel::ToolAdmission::Exclusive => {
                if !parallel.is_empty() {
                    groups.push(std::mem::take(&mut parallel));
                }
                groups.push(vec![call]);
            }
        }
    }
    if !parallel.is_empty() {
        groups.push(parallel);
    }
    groups
}

async fn execute_admission_controlled(
    calls: Vec<IndexedToolCall>,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
) -> Vec<(String, String, ToolResult)> {
    let mut all_results = Vec::new();
    // Consecutive read/discovery calls may overlap. Every exclusive call is a
    // barrier for all earlier and later calls, preserving model response order
    // while preventing shell and mutation overlap.
    for group in admission_groups(calls) {
        all_results.extend(spawn_and_collect_tools(group, &runtime, &client, &event_sink).await);
    }
    sort_and_strip_index(all_results)
}

/// Execute a batch of tool calls, emitting start/finish events for
/// each.  Returns `(original_index, tool_call_id, tool_name, ToolResult)` tuples
/// in completion order — the caller is responsible for sorting.
async fn spawn_and_collect_tools(
    calls: Vec<(usize, String, String, String)>,
    runtime: &ToolRuntime,
    client: &ModelClient,
    event_sink: &EventSink,
) -> Vec<(usize, String, String, ToolResult)> {
    let mut join_set: JoinSet<(usize, String, String, ToolResult)> = JoinSet::new();

    spawn_tools_into(&mut join_set, calls, runtime, client, event_sink).await;

    let mut results = Vec::new();
    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok((index, tool_call_id, tool_name, result)) => {
                if !result.content.contains_images() {
                    event_sink
                        .emit_async(AgentEvent::tool_call_finished(
                            tool_call_id.clone(),
                            tool_name.clone(),
                            &result,
                        ))
                        .await;
                }
                results.push((index, tool_call_id, tool_name, result));
            }
            Err(error) => {
                results.push((
                    usize::MAX,
                    "unknown".to_string(),
                    "unknown".to_string(),
                    ToolResult {
                        content: (format!("Tool task panicked: {error}")).into(),
                        is_error: true,
                        execution_duration_ms: None,
                        execution_duration_excludes_authorization: false,
                        delegation_outcome: None,
                        delegation_summary: None,
                    },
                ));
            }
        }
    }
    results
}

/// Execute a batch without admission barriers for internal callers.
async fn execute_simple(
    calls: Vec<(usize, String, String, String)>,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
) -> Vec<(String, String, ToolResult)> {
    let mut all_results: Vec<(usize, String, String, ToolResult)> = Vec::new();

    // Execute the calls.
    let batch_results = spawn_and_collect_tools(calls, &runtime, &client, &event_sink).await;
    all_results.extend(batch_results);

    sort_and_strip_index(all_results)
}

#[cfg(test)]
#[path = "tool_exec_tests.rs"]
mod tests;
