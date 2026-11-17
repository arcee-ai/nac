use super::dag::ParsedThreadDispatch;
use super::*;
use crate::tools::thread;
use futures_util::FutureExt;
use std::panic::AssertUnwindSafe;
use tokio::task::JoinSet;

/// Partition a batch of tool calls into:
///
/// 1. `Vec<ParsedThreadDispatch>` — successfully parsed `thread` calls
/// 2. `Vec<(usize, String, String, String)>` — non-thread calls as
///    `(original_index, tool_call_id, tool_name, args_str)`
/// 3. `Vec<(usize, String, String, ToolResult)>` — parse errors for malformed
///    thread calls as `(original_index, tool_call_id, args_str, error_result)`
#[expect(
    clippy::type_complexity,
    reason = "the tuple preserves the three semantic partitions without a public wrapper type"
)]
pub(crate) fn partition_tool_calls(
    tool_calls: Vec<ToolCall>,
    runtime: &ToolRuntime,
) -> (
    Vec<ParsedThreadDispatch>,
    Vec<(usize, String, String, String)>,
    Vec<(usize, String, String, ToolResult)>,
) {
    let mut thread_dispatches = Vec::new();
    let mut other_calls = Vec::new();
    let mut parse_errors = Vec::new();

    for (index, tool_call) in tool_calls.into_iter().enumerate() {
        let id = tool_call.id;
        let name = tool_call.function.name;
        let args_str = tool_call.function.arguments;

        if name == "thread" && runtime.allows_tool("thread") {
            let args: serde_json::Value = match serde_json::from_str(&args_str) {
                Ok(value) => value,
                Err(error) => {
                    parse_errors.push((
                        index,
                        id,
                        args_str,
                        ToolResult {
                            content: (format!(
                                "Error: failed to parse tool arguments for '{name}': {error}"
                            ))
                            .into(),
                            is_error: true,
                            execution_duration_ms: None,
                            execution_duration_excludes_authorization: false,
                        },
                    ));
                    continue;
                }
            };

            match thread::parse_dispatch_args(&args, runtime) {
                Ok(params) => {
                    thread_dispatches.push(ParsedThreadDispatch {
                        original_index: index,
                        tool_call_id: id,
                        args_str,
                        params,
                    });
                }
                Err(error_result) => {
                    parse_errors.push((index, id, args_str, error_result));
                }
            }
        } else {
            other_calls.push((index, id, name, args_str));
        }
    }

    (thread_dispatches, other_calls, parse_errors)
}

/// Emit `ToolCallStarted` + `ToolCallFinished` for each parse error and return
/// them as `(original_index, tool_call_id, tool_name, result)` tuples.
pub(crate) async fn collect_parse_errors(
    parse_errors: Vec<(usize, String, String, ToolResult)>,
    event_sink: &EventSink,
    thread_name: &Option<String>,
) -> Vec<(usize, String, String, ToolResult)> {
    let mut results = Vec::new();
    for (index, tool_call_id, args_str, error_result) in parse_errors {
        event_sink
            .emit_async(AgentEvent::ToolCallStarted {
                thread_name: thread_name.clone(),
                call_id: tool_call_id.clone(),
                name: "thread".to_string(),
                args_preview: preview_tool_args("thread", &args_str),
                key_arg_preview: None,
                args_detail: Some(tool_args_detail(&args_str)),
            })
            .await;
        event_sink
            .emit_async(AgentEvent::tool_call_finished(
                thread_name.clone(),
                tool_call_id.clone(),
                "thread".to_string(),
                &error_result,
            ))
            .await;
        results.push((index, tool_call_id, "thread".to_string(), error_result));
    }
    results
}

/// Sort results by original index, strip the index, and return as
/// `Vec<(tool_call_id, tool_name, ToolResult)>`.
pub(crate) fn sort_and_strip_index(
    mut results: Vec<(usize, String, String, ToolResult)>,
) -> Vec<(String, String, ToolResult)> {
    results.sort_by_key(|(index, ..)| *index);
    results
        .into_iter()
        .map(|(_, tool_call_id, tool_name, result)| (tool_call_id, tool_name, result))
        .collect()
}

/// Spawn non-thread tool calls into a `JoinSet`, emitting `ToolCallStarted`
/// for each.  Each spawned task returns
/// `(original_index, None, tool_call_id, tool_name, result)`.
pub(crate) async fn spawn_non_thread_into(
    join_set: &mut JoinSet<(usize, Option<usize>, String, String, ToolResult)>,
    other_calls: Vec<(usize, String, String, String)>,
    runtime: &ToolRuntime,
    client: &ModelClient,
    event_sink: &EventSink,
    thread_name: &Option<String>,
) {
    for (index, tool_call_id, tool_name, args_str) in other_calls {
        let runtime = runtime.clone();
        let client = client.clone();
        event_sink
            .emit_async(AgentEvent::ToolCallStarted {
                thread_name: thread_name.clone(),
                call_id: tool_call_id.clone(),
                name: tool_name.clone(),
                args_preview: preview_tool_args(&tool_name, &args_str),
                key_arg_preview: None,
                args_detail: Some(tool_args_detail(&args_str)),
            })
            .await;
        let call_context = tools::kernel::ToolCallContext {
            call_id: Some(tool_call_id.clone()),
            thread_name: thread_name.clone(),
            ..Default::default()
        };

        join_set.spawn(async move {
            let parsed_args = match serde_json::from_str::<serde_json::Value>(&args_str) {
                Ok(value) => value,
                Err(error) => {
                    return (
                        index,
                        None,
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
            (index, None, tool_call_id, tool_name, result)
        });
    }
}

pub(super) async fn execute_tools_parallel(
    tool_calls: Vec<ToolCall>,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
    thread_name: Option<String>,
    admission_controlled: bool,
) -> Vec<(String, String, ToolResult)> {
    // 1. Partition tool calls into thread dispatches, non-thread calls, and
    //    parse errors.
    let (thread_dispatches, other_calls, parse_errors) = partition_tool_calls(tool_calls, &runtime);

    if admission_controlled && thread_dispatches.is_empty() {
        return execute_admission_controlled(
            other_calls,
            parse_errors,
            runtime,
            client,
            event_sink,
            thread_name,
        )
        .await;
    }

    // 2. If there are no thread dispatches, use the simple path — just spawn
    //    all non-thread calls into a JoinSet, same as the original logic.
    if thread_dispatches.is_empty() {
        return execute_simple(
            other_calls,
            parse_errors,
            runtime,
            client,
            event_sink,
            thread_name,
        )
        .await;
    }

    // 3. Build the DAG from thread dispatches.
    let dag = match dag::build_dag(&thread_dispatches) {
        Ok(d) => d,
        Err(dag_err) => {
            // DAG construction failed (cycle or duplicate names).  Execute
            // non-thread tools normally and return error ToolResults for all
            // thread calls.
            return execute_with_dag_error(
                thread_dispatches,
                other_calls,
                parse_errors,
                dag_err,
                dag::DagExecContext {
                    runtime,
                    client,
                    event_sink,
                    agent_thread_name: thread_name,
                },
            )
            .await;
        }
    };

    // 4. Execute with the DAG coordinator.
    dag::execute_with_dag(
        thread_dispatches,
        other_calls,
        parse_errors,
        dag,
        dag::DagExecContext {
            runtime,
            client,
            event_sink,
            agent_thread_name: thread_name,
        },
    )
    .await
}

pub(super) async fn finalize_tool_results(
    messages: &[Message],
    results: Vec<(String, String, ToolResult)>,
    event_sink: &EventSink,
    thread_name: &Option<String>,
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
                    thread_name.clone(),
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

fn admission_groups(other_calls: Vec<IndexedToolCall>) -> Vec<Vec<IndexedToolCall>> {
    let mut groups = Vec::new();
    let mut parallel = Vec::new();
    for call in other_calls {
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
    other_calls: Vec<IndexedToolCall>,
    parse_errors: Vec<(usize, String, String, ToolResult)>,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
    thread_name: Option<String>,
) -> Vec<(String, String, ToolResult)> {
    let mut all_results = collect_parse_errors(parse_errors, &event_sink, &thread_name).await;
    // Consecutive read/discovery calls may overlap. Every exclusive call is a
    // barrier for all earlier and later calls, preserving model response order
    // while preventing shell and mutation overlap.
    for group in admission_groups(other_calls) {
        all_results.extend(
            spawn_and_collect_non_thread(group, &runtime, &client, &event_sink, &thread_name).await,
        );
    }
    sort_and_strip_index(all_results)
}

/// Execute a batch of non-thread tool calls, emitting start/finish events for
/// each.  Returns `(original_index, tool_call_id, tool_name, ToolResult)` tuples
/// in completion order — the caller is responsible for sorting.
async fn spawn_and_collect_non_thread(
    other_calls: Vec<(usize, String, String, String)>,
    runtime: &ToolRuntime,
    client: &ModelClient,
    event_sink: &EventSink,
    thread_name: &Option<String>,
) -> Vec<(usize, String, String, ToolResult)> {
    let mut join_set: JoinSet<(usize, Option<usize>, String, String, ToolResult)> = JoinSet::new();

    spawn_non_thread_into(
        &mut join_set,
        other_calls,
        runtime,
        client,
        event_sink,
        thread_name,
    )
    .await;

    let mut results = Vec::new();
    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok((index, _, tool_call_id, tool_name, result)) => {
                if !result.content.contains_images() {
                    event_sink
                        .emit_async(AgentEvent::tool_call_finished(
                            thread_name.clone(),
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
                    },
                ));
            }
        }
    }
    results
}

/// Simple execution path: no thread dispatches, just non-thread tools and parse
/// errors.  Preserves the original `execute_tools_parallel` behavior for the
/// common case.
async fn execute_simple(
    other_calls: Vec<(usize, String, String, String)>,
    parse_errors: Vec<(usize, String, String, ToolResult)>,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
    thread_name: Option<String>,
) -> Vec<(String, String, ToolResult)> {
    let mut all_results: Vec<(usize, String, String, ToolResult)> = Vec::new();

    // Collect parse errors immediately (emit start + finish events for each).
    all_results.extend(collect_parse_errors(parse_errors, &event_sink, &thread_name).await);

    // Execute non-thread calls.
    let non_thread_results =
        spawn_and_collect_non_thread(other_calls, &runtime, &client, &event_sink, &thread_name)
            .await;
    all_results.extend(non_thread_results);

    sort_and_strip_index(all_results)
}

/// Fallback when DAG construction fails (cycle or duplicate thread names).
///
/// Non-thread tool calls are executed normally.  All thread dispatches receive
/// an error ToolResult describing the DAG error.  Parse errors are included.
/// Results are sorted by original index.
async fn execute_with_dag_error(
    thread_dispatches: Vec<dag::ParsedThreadDispatch>,
    other_calls: Vec<(usize, String, String, String)>,
    parse_errors: Vec<(usize, String, String, ToolResult)>,
    dag_err: dag::DagError,
    ctx: dag::DagExecContext,
) -> Vec<(String, String, ToolResult)> {
    let dag::DagExecContext {
        runtime,
        client,
        event_sink,
        agent_thread_name: thread_name,
    } = ctx;

    let mut all_results: Vec<(usize, String, String, ToolResult)> = Vec::new();

    // Collect parse errors immediately.
    all_results.extend(collect_parse_errors(parse_errors, &event_sink, &thread_name).await);

    // Produce error ToolResults for all thread dispatches.
    let error_message = match &dag_err {
        dag::DagError::DuplicateName(name) => {
            format!("Duplicate thread name '{name}' in parallel dispatch")
        }
        dag::DagError::Cycle(desc) => {
            format!("Circular dependency in thread dispatch: {desc}")
        }
    };

    for dispatch in &thread_dispatches {
        let result = ToolResult {
            content: (error_message.clone()).into(),
            is_error: true,
            execution_duration_ms: None,
            execution_duration_excludes_authorization: false,
        };
        event_sink
            .emit_async(AgentEvent::ToolCallStarted {
                thread_name: thread_name.clone(),
                call_id: dispatch.tool_call_id.clone(),
                name: "thread".to_string(),
                args_preview: preview_tool_args("thread", &dispatch.args_str),
                key_arg_preview: None,
                args_detail: Some(tool_args_detail(&dispatch.args_str)),
            })
            .await;
        event_sink
            .emit_async(AgentEvent::tool_call_finished(
                thread_name.clone(),
                dispatch.tool_call_id.clone(),
                "thread".to_string(),
                &result,
            ))
            .await;
        all_results.push((
            dispatch.original_index,
            dispatch.tool_call_id.clone(),
            "thread".to_string(),
            result,
        ));
    }

    // Execute non-thread calls normally.
    let non_thread_results =
        spawn_and_collect_non_thread(other_calls, &runtime, &client, &event_sink, &thread_name)
            .await;
    all_results.extend(non_thread_results);

    sort_and_strip_index(all_results)
}

#[cfg(test)]
#[path = "tool_exec_tests.rs"]
mod tests;
