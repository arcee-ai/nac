use std::collections::{HashMap, HashSet};

use tokio::task::JoinSet;

use super::*;
use crate::tools::ThreadDispatchKey;
use crate::tools::thread::{self, ParsedDispatchParams};

/// A successfully parsed `thread` tool call, ready for DAG-ordered execution.
pub(crate) struct ParsedThreadDispatch {
    pub original_index: usize,
    pub tool_call_id: String,
    pub key: ThreadDispatchKey,
    /// Original JSON arguments string — preserved for `ToolCallStarted` event
    /// previews.
    pub args_str: String,
    pub params: ParsedDispatchParams,
}

/// Shared execution context for DAG-based tool dispatch.
pub(crate) struct DagExecContext {
    pub runtime: ToolRuntime,
    pub client: ModelClient,
    pub event_sink: EventSink,
    pub agent_thread_name: Option<String>,
}

/// Partition a batch of tool calls into:
///
/// 1. `Vec<ParsedThreadDispatch>` — successfully parsed `thread` calls
/// 2. `Vec<(usize, String, String, String)>` — non-thread calls as
///    `(original_index, tool_call_id, tool_name, args_str)`
/// 3. `Vec<(usize, String, String, ToolResult)>` — parse errors for malformed
///    thread calls as `(original_index, tool_call_id, args_str, error_result)`
#[allow(clippy::type_complexity)]
pub(crate) fn partition_tool_calls(
    tool_calls: Vec<ToolCall>,
    runtime: &ToolRuntime,
    run_id: &crate::events::SessionRunId,
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

        if name == "thread" {
            let args: serde_json::Value = match serde_json::from_str(&args_str) {
                Ok(value) => value,
                Err(error) => {
                    parse_errors.push((
                        index,
                        id,
                        args_str,
                        ToolResult {
                            content: format!(
                                "Error: failed to parse tool arguments for '{}': {}",
                                name, error
                            ),
                            is_error: true,
                        },
                    ));
                    continue;
                }
            };

            match thread::parse_dispatch_args(&args, runtime) {
                Ok(params) => {
                    let key = ThreadDispatchKey::new(
                        run_id.clone(),
                        params.thread_name.clone(),
                        params.dispatch_id.clone(),
                        id.clone(),
                    );
                    thread_dispatches.push(ParsedThreadDispatch {
                        original_index: index,
                        tool_call_id: id,
                        key,
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

/// Dependency DAG for a batch of thread dispatches.
#[derive(Debug)]
pub(crate) struct Dag {
    /// Topologically ordered waves.  Each wave is a list of indices into the
    /// dispatches `Vec`.  All dispatches in a wave have zero in-batch
    /// dependencies and can run concurrently.
    pub waves: Vec<Vec<usize>>,
    /// Dispatch index → list of source dispatch indices (in-batch deps only).
    pub in_batch_deps: Vec<Vec<usize>>,
}

/// Error returned by [`build_dag`].
#[derive(Debug)]
pub(crate) enum DagError {
    DuplicateName(String),
    Cycle(String),
}

/// Build a [`Dag`] from a slice of parsed thread dispatches.
///
/// Only `source_threads` that name *other threads in the same batch* become
/// edges.  Sources that refer to pre-existing threads from prior turns are
/// ignored — those are loaded normally by the worker, not ordered by the DAG.
pub(crate) fn build_dag(dispatches: &[ParsedThreadDispatch]) -> Result<Dag, DagError> {
    let n = dispatches.len();
    if n == 0 {
        return Ok(Dag {
            waves: Vec::new(),
            in_batch_deps: Vec::new(),
        });
    }

    // 1. Build name→index map and check for duplicate names.
    let mut name_to_index: HashMap<String, usize> = HashMap::new();
    for (i, dispatch) in dispatches.iter().enumerate() {
        let name = &dispatch.params.thread_name;
        if name_to_index.contains_key(name) {
            return Err(DagError::DuplicateName(name.clone()));
        }
        name_to_index.insert(name.clone(), i);
    }

    let batch_thread_names: HashSet<String> = name_to_index.keys().cloned().collect();

    // 2. Build in-batch deps and adjacency list for Kahn's algorithm.
    let mut in_batch_deps: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); n]; // adjacency[i] = nodes that depend on i
    let mut in_degree = vec![0usize; n];

    for (i, dispatch) in dispatches.iter().enumerate() {
        let mut deps: Vec<usize> = Vec::new();
        let mut seen: HashSet<usize> = HashSet::new();
        for source in &dispatch.params.source_threads {
            // Only sources that are in this batch become edges.
            if batch_thread_names.contains(source) {
                let dep_idx = name_to_index[source];

                // Self-dependency is a cycle.
                if dep_idx == i {
                    return Err(DagError::Cycle(format!(
                        "Thread '{}' depends on itself",
                        dispatch.params.thread_name
                    )));
                }

                if seen.insert(dep_idx) {
                    deps.push(dep_idx);
                }
            }
        }

        for &dep_idx in &deps {
            adjacency[dep_idx].push(i);
            in_degree[i] += 1;
        }
        in_batch_deps[i] = deps;
    }

    // 3. Kahn's algorithm — collect nodes level-by-level into waves.
    let mut waves: Vec<Vec<usize>> = Vec::new();
    let mut sorted_count = 0;
    let mut current_in_degree = in_degree;
    let mut sorted = vec![false; n];

    while sorted_count < n {
        // Collect all nodes with in-degree 0 that haven't been sorted yet.
        let wave: Vec<usize> = (0..n)
            .filter(|&i| !sorted[i] && current_in_degree[i] == 0)
            .collect();

        if wave.is_empty() {
            // Cycle detected — report the remaining nodes.
            let remaining: Vec<String> = (0..n)
                .filter(|i| !sorted[*i] && current_in_degree[*i] > 0)
                .map(|i| dispatches[i].params.thread_name.clone())
                .collect();
            return Err(DagError::Cycle(format!(
                "Circular dependency detected among threads: {}",
                remaining.join(", ")
            )));
        }

        // Decrement in-degree for neighbors and mark wave nodes as sorted.
        for &node in &wave {
            for &neighbor in &adjacency[node] {
                current_in_degree[neighbor] -= 1;
            }
            sorted[node] = true;
        }

        sorted_count += wave.len();
        waves.push(wave);
    }

    Ok(Dag {
        waves,
        in_batch_deps,
    })
}

// ------------------------------------------------------------------
// Shared helpers (used by execute_with_dag and tool_exec.rs)
// ------------------------------------------------------------------

/// Emit `ToolCallStarted` + `ToolCallFinished` for each parse error and return
/// them as `(original_index, tool_call_id, tool_name, result)` tuples.
pub(crate) fn collect_parse_errors(
    parse_errors: Vec<(usize, String, String, ToolResult)>,
    event_sink: &EventSink,
    thread_name: &Option<String>,
) -> Vec<(usize, String, String, ToolResult)> {
    let mut results = Vec::new();
    for (index, tool_call_id, args_str, error_result) in parse_errors {
        event_sink.emit(AgentEvent::ToolCallStarted {
            thread_name: thread_name.clone(),
            call_id: tool_call_id.clone(),
            name: "thread".to_string(),
            args_preview: preview_tool_args("thread", &args_str),
            key_arg_preview: None,
            args_detail: Some(tool_args_detail(&args_str)),
        });
        event_sink.emit(AgentEvent::ToolCallFinished {
            thread_name: thread_name.clone(),
            call_id: tool_call_id.clone(),
            name: "thread".to_string(),
            content_preview: preview_tool_result("thread", &error_result),
            is_error: error_result.is_error,
            dispatch_thread_name: None,
            dispatch_id: None,
            dispatch_status: None,
        });
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
pub(crate) fn spawn_non_thread_into(
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
        event_sink.emit(AgentEvent::ToolCallStarted {
            thread_name: thread_name.clone(),
            call_id: tool_call_id.clone(),
            name: tool_name.clone(),
            args_preview: preview_tool_args(&tool_name, &args_str),
            key_arg_preview: None,
            args_detail: Some(tool_args_detail(&args_str)),
        });

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
                            content: format!(
                                "Error: failed to parse tool arguments for '{}': {}",
                                tool_name, error
                            ),
                            is_error: true,
                        },
                    );
                }
            };
            let result = tools::execute_tool(&tool_name, parsed_args, &runtime, &client).await;
            (index, None, tool_call_id, tool_name, result)
        });
    }
}

// ------------------------------------------------------------------
// Background DAG execution
// ------------------------------------------------------------------

struct CoordinatorCleanup {
    runtime: ToolRuntime,
    session_id: String,
    keys: Vec<ThreadDispatchKey>,
}

impl Drop for CoordinatorCleanup {
    fn drop(&mut self) {
        // Covers coordinator cancellation and panic. Normal completions have
        // already removed their exact keys, so these closes become no-ops.
        for key in &self.keys {
            let cancelling =
                self.runtime
                    .active_threads
                    .active_dispatches()
                    .iter()
                    .any(|dispatch| {
                        dispatch.key == *key
                            && dispatch.state == crate::tools::ThreadDispatchState::Cancelling
                    });
            let result = ToolResult {
                content: if cancelling {
                    format!("Thread '{}' was cancelled.", key.thread_name)
                } else {
                    format!(
                        "Thread '{}' ended because its coordinator stopped.",
                        key.thread_name
                    )
                },
                is_error: true,
            };
            thread::finalize_thread_dispatch(
                &self.runtime,
                &self.session_id,
                key.clone(),
                &result,
                if cancelling {
                    crate::events::ThreadDispatchStatus::Cancelled
                } else {
                    crate::events::ThreadDispatchStatus::Failed
                },
                -1,
                false,
                None,
                None,
            );
        }
    }
}

/// Atomically reserve the parsed dispatches, publish immediate acceptance
/// results, and launch one registry-owned coordinator for the accepted DAG.
fn accept_and_launch_background(
    thread_dispatches: Vec<ParsedThreadDispatch>,
    dag: Dag,
    ctx: DagExecContext,
) -> Vec<(usize, String, String, ToolResult)> {
    let keys = thread_dispatches
        .iter()
        .map(|dispatch| dispatch.key.clone())
        .collect::<Vec<_>>();
    let accepted = ctx.runtime.active_threads.try_accept_batch(keys);
    let mut failed_indices = HashSet::new();
    let mut immediate = Vec::with_capacity(thread_dispatches.len());

    for (index, dispatch) in thread_dispatches.iter().enumerate() {
        ctx.event_sink.emit(AgentEvent::ToolCallStarted {
            thread_name: ctx.agent_thread_name.clone(),
            call_id: dispatch.tool_call_id.clone(),
            name: "thread".to_string(),
            args_preview: preview_tool_args("thread", &dispatch.args_str),
            key_arg_preview: None,
            args_detail: Some(tool_args_detail(&dispatch.args_str)),
        });
        let result = if accepted[index] {
            ToolResult {
                content: format!(
                    "Thread '{}' accepted for background execution.",
                    dispatch.params.thread_name
                ),
                is_error: false,
            }
        } else {
            failed_indices.insert(index);
            ToolResult {
                content: format!(
                    "Thread '{}' is already running; retry after the current dispatch completes.",
                    dispatch.params.thread_name
                ),
                is_error: true,
            }
        };
        ctx.event_sink.emit(AgentEvent::ToolCallFinished {
            thread_name: ctx.agent_thread_name.clone(),
            call_id: dispatch.tool_call_id.clone(),
            name: "thread".to_string(),
            content_preview: preview_tool_result("thread", &result),
            is_error: result.is_error,
            dispatch_thread_name: accepted[index].then(|| dispatch.params.thread_name.clone()),
            dispatch_id: accepted[index].then(|| dispatch.key.dispatch_id.clone()),
            dispatch_status: accepted[index]
                .then_some(crate::events::ThreadDispatchStatus::Accepted),
        });
        immediate.push((
            dispatch.original_index,
            dispatch.tool_call_id.clone(),
            "thread".to_string(),
            result,
        ));
    }

    if accepted.iter().any(|accepted| *accepted) {
        let accepted_keys = thread_dispatches
            .iter()
            .enumerate()
            .filter(|(index, _)| accepted[*index])
            .map(|(_, dispatch)| dispatch.key.clone())
            .collect::<Vec<_>>();
        let registry = ctx.runtime.active_threads.clone();
        let run_id = accepted_keys[0].run_id.clone();
        let coordinator_keys = accepted_keys.clone();
        let task_guard = registry.register_task(run_id);
        let task = tokio::spawn(async move {
            let _task_guard = task_guard;
            run_background_dag(
                thread_dispatches,
                dag,
                ctx,
                failed_indices,
                coordinator_keys,
            )
            .await;
        });
        let abort = task.abort_handle();
        // Every accepted member owns the same coordinator. Cancelling any
        // exact member through run/session cleanup therefore cannot detach the
        // rest of its DAG.
        for key in accepted_keys {
            registry.attach_coordinator(&key, abort.clone());
        }
        // Ownership is exclusively in the registry; dropping JoinHandle does
        // not detach an unowned task because every accepted key has its abort.
        drop(task);
    }

    immediate
}

fn finalize_pending_cancellations(
    thread_dispatches: &[ParsedThreadDispatch],
    ctx: &DagExecContext,
    in_flight: &HashSet<usize>,
    failed_indices: &mut HashSet<usize>,
) {
    let cancelling = ctx
        .runtime
        .active_threads
        .active_dispatches()
        .into_iter()
        .filter(|dispatch| dispatch.state == crate::tools::ThreadDispatchState::Cancelling)
        .map(|dispatch| dispatch.key)
        .collect::<HashSet<_>>();
    for (index, dispatch) in thread_dispatches.iter().enumerate() {
        if failed_indices.contains(&index)
            || in_flight.contains(&index)
            || !cancelling.contains(&dispatch.key)
        {
            continue;
        }
        let result = ToolResult {
            content: format!("Thread '{}' was cancelled.", dispatch.params.thread_name),
            is_error: true,
        };
        thread::finalize_thread_dispatch(
            &ctx.runtime,
            &dispatch.params.session_id,
            dispatch.key.clone(),
            &result,
            crate::events::ThreadDispatchStatus::Cancelled,
            -1,
            false,
            None,
            None,
        );
        failed_indices.insert(index);
    }
}

async fn run_background_dag(
    thread_dispatches: Vec<ParsedThreadDispatch>,
    dag: Dag,
    ctx: DagExecContext,
    mut failed_indices: HashSet<usize>,
    accepted_keys: Vec<ThreadDispatchKey>,
) {
    let session_id = thread_dispatches
        .first()
        .map(|dispatch| dispatch.params.session_id.clone())
        .unwrap_or_default();
    let _cleanup = CoordinatorCleanup {
        runtime: ctx.runtime.clone(),
        session_id,
        keys: accepted_keys,
    };
    let Dag {
        waves,
        in_batch_deps,
    } = dag;

    for wave in waves {
        let mut workers: JoinSet<(usize, ToolResult)> = JoinSet::new();
        let mut task_dispatches = HashMap::new();
        let mut in_flight = HashSet::new();
        finalize_pending_cancellations(&thread_dispatches, &ctx, &in_flight, &mut failed_indices);

        for dispatch_idx in wave {
            if failed_indices.contains(&dispatch_idx) {
                continue;
            }
            let dispatch = &thread_dispatches[dispatch_idx];
            if let Some(dependency) = in_batch_deps[dispatch_idx]
                .iter()
                .find(|dependency| failed_indices.contains(dependency))
                .copied()
            {
                let result = ToolResult {
                    content: format!(
                        "Source thread '{}' failed; dispatch '{}' skipped.",
                        thread_dispatches[dependency].params.thread_name,
                        dispatch.params.thread_name
                    ),
                    is_error: true,
                };
                ctx.event_sink.emit(AgentEvent::Error {
                    thread_name: Some(dispatch.params.thread_name.clone()),
                    message: result.content.clone(),
                });
                thread::complete_thread_dispatch(
                    &ctx.runtime,
                    &dispatch.params.session_id,
                    dispatch.key.clone(),
                    &result,
                );
                failed_indices.insert(dispatch_idx);
                continue;
            }

            if !ctx.runtime.active_threads.mark_running(&dispatch.key) {
                finalize_pending_cancellations(
                    &thread_dispatches,
                    &ctx,
                    &in_flight,
                    &mut failed_indices,
                );
                failed_indices.insert(dispatch_idx);
                continue;
            }
            let runtime = ctx.runtime.clone();
            let client = ctx.client.clone();
            let params = dispatch.params.clone();
            let dispatch_key = dispatch.key.clone();
            let task_guard = ctx
                .runtime
                .active_threads
                .register_dispatch_task(dispatch.key.clone());
            let abort = workers.spawn(async move {
                let _task_guard = task_guard;
                let result =
                    thread::execute_parsed_dispatch(params, Some(&dispatch_key), &runtime, &client)
                        .await;
                (dispatch_idx, result)
            });
            let task_id = abort.id();
            if ctx
                .runtime
                .active_threads
                .attach_worker(&dispatch.key, abort.clone())
            {
                task_dispatches.insert(task_id, dispatch_idx);
                in_flight.insert(dispatch_idx);
            } else {
                abort.abort();
                failed_indices.insert(dispatch_idx);
            }
        }

        while !workers.is_empty() {
            let observed = ctx.runtime.active_threads.activity_epoch();
            tokio::select! {
                join_result = workers.join_next_with_id() => {
                    let Some(join_result) = join_result else { break; };
                match join_result {
                    Ok((task_id, (dispatch_idx, result))) => {
                        task_dispatches.remove(&task_id);
                        in_flight.remove(&dispatch_idx);
                        let dispatch = &thread_dispatches[dispatch_idx];
                        if result.is_error {
                            failed_indices.insert(dispatch_idx);
                        }
                        thread::complete_thread_dispatch(
                            &ctx.runtime,
                            &dispatch.params.session_id,
                            dispatch.key.clone(),
                            &result,
                        );
                    }
                    Err(error) if error.is_cancelled() => {
                        // JoinError carries the exact task id, allowing a forced
                        // worker abort to become a dependency failure without
                        // aborting independent members in the same wave.
                        if let Some(dispatch_idx) = task_dispatches.remove(&error.id()) {
                            in_flight.remove(&dispatch_idx);
                            failed_indices.insert(dispatch_idx);
                            let dispatch = &thread_dispatches[dispatch_idx];
                            let result = ToolResult {
                                content: format!(
                                    "Thread '{}' was cancelled.",
                                    dispatch.params.thread_name
                                ),
                                is_error: true,
                            };
                            thread::finalize_thread_dispatch(
                                &ctx.runtime,
                                &dispatch.params.session_id,
                                dispatch.key.clone(),
                                &result,
                                crate::events::ThreadDispatchStatus::Cancelled,
                                -1,
                                false,
                                None,
                                None,
                            );
                        }
                    }
                    Err(error) => {
                        workers.abort_all();
                        let message = format!("Background thread task failed: {error}");
                        for dispatch_idx in in_flight.drain() {
                            let dispatch = &thread_dispatches[dispatch_idx];
                            let result = ToolResult {
                                content: message.clone(),
                                is_error: true,
                            };
                            ctx.event_sink.emit(AgentEvent::Error {
                                thread_name: Some(dispatch.params.thread_name.clone()),
                                message: message.clone(),
                            });
                            thread::complete_thread_dispatch(
                                &ctx.runtime,
                                &dispatch.params.session_id,
                                dispatch.key.clone(),
                                &result,
                            );
                            failed_indices.insert(dispatch_idx);
                        }
                        task_dispatches.clear();
                    }
                }
                }
                _ = ctx.runtime.active_threads.wait_for_activity_since(observed) => {
                    finalize_pending_cancellations(
                        &thread_dispatches,
                        &ctx,
                        &in_flight,
                        &mut failed_indices,
                    );
                }
            }
        }
    }
}

/// Execute non-thread calls normally, but return thread acceptance results as
/// soon as those calls finish rather than waiting for worker terminal output.
pub(crate) async fn execute_with_dag(
    thread_dispatches: Vec<ParsedThreadDispatch>,
    other_calls: Vec<(usize, String, String, String)>,
    parse_errors: Vec<(usize, String, String, ToolResult)>,
    dag: Dag,
    ctx: DagExecContext,
) -> Vec<(String, String, ToolResult)> {
    let mut all_results =
        collect_parse_errors(parse_errors, &ctx.event_sink, &ctx.agent_thread_name);
    let mut non_threads = JoinSet::new();
    spawn_non_thread_into(
        &mut non_threads,
        other_calls,
        &ctx.runtime,
        &ctx.client,
        &ctx.event_sink,
        &ctx.agent_thread_name,
    );
    let event_sink = ctx.event_sink.clone();
    let agent_thread_name = ctx.agent_thread_name.clone();
    all_results.extend(accept_and_launch_background(thread_dispatches, dag, ctx));

    while let Some(join_result) = non_threads.join_next().await {
        match join_result {
            Ok((index, _, tool_call_id, tool_name, result)) => {
                event_sink.emit(AgentEvent::ToolCallFinished {
                    thread_name: agent_thread_name.clone(),
                    call_id: tool_call_id.clone(),
                    name: tool_name.clone(),
                    content_preview: preview_tool_result(&tool_name, &result),
                    is_error: result.is_error,
                    dispatch_thread_name: None,
                    dispatch_id: None,
                    dispatch_status: None,
                });
                all_results.push((index, tool_call_id, tool_name, result));
            }
            Err(error) => all_results.push((
                usize::MAX,
                "unknown".to_string(),
                "unknown".to_string(),
                ToolResult {
                    content: format!("Tool task panicked: {error}"),
                    is_error: true,
                },
            )),
        }
    }
    sort_and_strip_index(all_results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::test_runtime;
    use crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS;
    use crate::types::{FunctionCall, ToolCall};
    use serde_json::json;

    // ------------------------------------------------------------------
    // Test helpers
    // ------------------------------------------------------------------

    fn make_dispatch(index: usize, name: &str, source_threads: &[&str]) -> ParsedThreadDispatch {
        let args = json!({
            "name": name,
            "action": "test action",
            "threads": source_threads,
        });
        let args_str = serde_json::to_string(&args).unwrap();
        let tool_call_id = format!("call_{}", index);
        let dispatch_id = format!("dispatch-{index}");
        ParsedThreadDispatch {
            original_index: index,
            tool_call_id: tool_call_id.clone(),
            key: ThreadDispatchKey::new(
                crate::events::SessionRunId::new(),
                name,
                dispatch_id.clone(),
                tool_call_id,
            ),
            args_str,
            params: ParsedDispatchParams {
                thread_name: name.to_string(),
                dispatch_id,
                action: "test action".to_string(),
                source_threads: source_threads.iter().map(|s| s.to_string()).collect(),
                scheduled_skills: Vec::new(),
                session_id: "test-session".to_string(),
                timeout_secs: DEFAULT_THREAD_TIMEOUT_SECS,
            },
        }
    }

    fn make_tool_call(id: &str, name: &str, args: serde_json::Value) -> ToolCall {
        ToolCall {
            id: id.to_string(),
            call_type: "function".to_string(),
            function: FunctionCall {
                name: name.to_string(),
                arguments: serde_json::to_string(&args).unwrap(),
            },
        }
    }

    // ------------------------------------------------------------------
    // build_dag tests
    // ------------------------------------------------------------------

    #[test]
    fn test_build_dag_no_deps() {
        let dispatches = vec![
            make_dispatch(0, "A", &[]),
            make_dispatch(1, "B", &[]),
            make_dispatch(2, "C", &[]),
        ];

        let dag = build_dag(&dispatches).unwrap();
        assert_eq!(dag.waves.len(), 1, "3 independent threads → 1 wave");
        assert_eq!(dag.waves[0].len(), 3);

        // All three should be in the single wave.
        let wave0: HashSet<usize> = dag.waves[0].iter().copied().collect();
        assert!(wave0.contains(&0));
        assert!(wave0.contains(&1));
        assert!(wave0.contains(&2));

        // No in-batch deps for any dispatch.
        for i in 0..3 {
            assert!(dag.in_batch_deps[i].is_empty());
        }
    }

    #[test]
    fn test_build_dag_linear_chain() {
        // A → B → C
        let dispatches = vec![
            make_dispatch(0, "A", &[]),
            make_dispatch(1, "B", &["A"]),
            make_dispatch(2, "C", &["B"]),
        ];

        let dag = build_dag(&dispatches).unwrap();
        assert_eq!(dag.waves.len(), 3, "linear chain → 3 waves");
        assert_eq!(dag.waves[0], vec![0], "wave 0: A");
        assert_eq!(dag.waves[1], vec![1], "wave 1: B");
        assert_eq!(dag.waves[2], vec![2], "wave 2: C");

        // B depends on A, C depends on B.
        assert!(dag.in_batch_deps[0].is_empty());
        assert_eq!(dag.in_batch_deps[1], vec![0usize]);
        assert_eq!(dag.in_batch_deps[2], vec![1usize]);
    }

    #[test]
    fn test_build_dag_diamond() {
        // A → {B, C}, {B, C} → D
        let dispatches = vec![
            make_dispatch(0, "A", &[]),
            make_dispatch(1, "B", &["A"]),
            make_dispatch(2, "C", &["A"]),
            make_dispatch(3, "D", &["B", "C"]),
        ];

        let dag = build_dag(&dispatches).unwrap();
        assert_eq!(dag.waves.len(), 3, "diamond → 3 waves");
        assert_eq!(dag.waves[0], vec![0], "wave 0: A");

        // Wave 1 should contain both B and C (order may vary, but both present).
        let wave1: HashSet<usize> = dag.waves[1].iter().copied().collect();
        assert_eq!(wave1.len(), 2);
        assert!(wave1.contains(&1));
        assert!(wave1.contains(&2));

        assert_eq!(dag.waves[2], vec![3], "wave 2: D");

        // D depends on both B and C.
        let d_deps = &dag.in_batch_deps[3];
        assert!(d_deps.contains(&1));
        assert!(d_deps.contains(&2));
    }

    #[test]
    fn test_build_dag_filters_out_of_batch_sources() {
        // B has source_threads=["A", "preexisting"], only A is in the batch.
        let dispatches = vec![
            make_dispatch(0, "A", &[]),
            make_dispatch(1, "B", &["A", "preexisting"]),
        ];

        let dag = build_dag(&dispatches).unwrap();
        assert_eq!(dag.waves.len(), 2);
        assert_eq!(dag.waves[0], vec![0], "wave 0: A");
        assert_eq!(dag.waves[1], vec![1], "wave 1: B");

        // B's only in-batch dep is A (index 0). "preexisting" is ignored.
        assert_eq!(
            dag.in_batch_deps[1],
            vec![0],
            "only A should be an in-batch dep"
        );
    }

    #[test]
    fn test_build_dag_detects_cycle() {
        // A → B, B → A
        let dispatches = vec![make_dispatch(0, "A", &["B"]), make_dispatch(1, "B", &["A"])];

        let err = build_dag(&dispatches).unwrap_err();
        assert!(matches!(err, DagError::Cycle(_)));
    }

    #[test]
    fn test_build_dag_detects_duplicate_names() {
        let dispatches = vec![make_dispatch(0, "X", &[]), make_dispatch(1, "X", &[])];

        let err = build_dag(&dispatches).unwrap_err();
        match err {
            DagError::DuplicateName(name) => assert_eq!(name, "X"),
            other => panic!("expected DuplicateName, got {:?}", other),
        }
    }

    #[test]
    fn test_build_dag_self_dependency() {
        // A lists itself as a source thread.
        let dispatches = vec![make_dispatch(0, "A", &["A"])];

        let err = build_dag(&dispatches).unwrap_err();
        assert!(matches!(err, DagError::Cycle(_)));
    }

    // ------------------------------------------------------------------
    // partition_tool_calls tests
    // ------------------------------------------------------------------

    #[test]
    fn test_partition_separates_thread_and_non_thread() {
        let runtime = test_runtime();
        let tool_calls = vec![
            make_tool_call("call_0", "thread", json!({"name": "A", "action": "work"})),
            make_tool_call("call_1", "read", json!({"path": "src/main.rs"})),
            make_tool_call(
                "call_2",
                "thread",
                json!({"name": "B", "action": "work", "threads": ["A"]}),
            ),
        ];

        let (thread_dispatches, other_calls, parse_errors) =
            partition_tool_calls(tool_calls, &runtime, &crate::events::SessionRunId::new());

        assert_eq!(thread_dispatches.len(), 2);
        assert_eq!(thread_dispatches[0].params.thread_name, "A");
        assert_eq!(thread_dispatches[1].params.thread_name, "B");
        assert_eq!(thread_dispatches[1].params.source_threads, vec!["A"]);

        assert_eq!(other_calls.len(), 1);
        assert_eq!(other_calls[0].0, 1, "original_index preserved");
        assert_eq!(other_calls[0].1, "call_1");
        assert_eq!(other_calls[0].2, "read");

        assert!(parse_errors.is_empty());
    }

    #[test]
    fn test_partition_returns_error_for_missing_name() {
        let runtime = test_runtime();
        let tool_calls = vec![make_tool_call(
            "call_0",
            "thread",
            json!({"action": "work"}),
        )];

        let (thread_dispatches, other_calls, parse_errors) =
            partition_tool_calls(tool_calls, &runtime, &crate::events::SessionRunId::new());

        assert!(thread_dispatches.is_empty());
        assert!(other_calls.is_empty());
        assert_eq!(parse_errors.len(), 1);
        assert_eq!(parse_errors[0].0, 0, "original_index preserved");
        assert_eq!(parse_errors[0].1, "call_0");
        assert!(parse_errors[0].3.is_error);
        assert!(parse_errors[0].3.content.contains("'name'"));
    }

    // ------------------------------------------------------------------
    // Transitive failure propagation tests
    // ------------------------------------------------------------------

    /// When A fails → B (depends on A) is skipped → C (depends on B) is also
    /// skipped.  This simulates the wave-by-wave skip logic from
    /// `execute_with_dag` using the DAG structure.
    #[test]
    fn test_transitive_failure_propagation_chain() {
        // Chain: A → B → C
        let dispatches = vec![
            make_dispatch(0, "A", &[]),
            make_dispatch(1, "B", &["A"]),
            make_dispatch(2, "C", &["B"]),
        ];

        let dag = build_dag(&dispatches).unwrap();
        assert_eq!(dag.waves.len(), 3, "chain → 3 waves");

        // Simulate the wave-by-wave skip logic from execute_with_dag.
        let mut failed_indices: HashSet<usize> = HashSet::new();

        // Wave 0: A fails.
        failed_indices.insert(0);

        // Wave 1: B checks its deps. A (dep of B) is in failed_indices → B skipped.
        for &dispatch_idx in &dag.waves[1] {
            let deps = &dag.in_batch_deps[dispatch_idx];
            let any_dep_failed = deps.iter().any(|dep| failed_indices.contains(dep));
            assert!(
                any_dep_failed,
                "dispatch {} in wave 1 should have a failed dep",
                dispatch_idx
            );
            if any_dep_failed {
                failed_indices.insert(dispatch_idx);
            }
        }

        // Wave 2: C checks its deps. B (dep of C) is now in failed_indices → C skipped.
        for &dispatch_idx in &dag.waves[2] {
            let deps = &dag.in_batch_deps[dispatch_idx];
            let any_dep_failed = deps.iter().any(|dep| failed_indices.contains(dep));
            assert!(
                any_dep_failed,
                "dispatch {} in wave 2 should have a failed dep (transitive)",
                dispatch_idx
            );
            if any_dep_failed {
                failed_indices.insert(dispatch_idx);
            }
        }

        // All three should be in failed_indices.
        assert!(failed_indices.contains(&0), "A failed");
        assert!(failed_indices.contains(&1), "B skipped due to A");
        assert!(
            failed_indices.contains(&2),
            "C skipped due to B (transitive)"
        );
    }

    /// When A fails in a diamond A→{B,C}→D, both B and C are skipped, and
    /// then D is skipped because all its deps failed.
    #[test]
    fn test_transitive_failure_propagation_diamond() {
        // Diamond: A → {B, C} → D
        let dispatches = vec![
            make_dispatch(0, "A", &[]),
            make_dispatch(1, "B", &["A"]),
            make_dispatch(2, "C", &["A"]),
            make_dispatch(3, "D", &["B", "C"]),
        ];

        let dag = build_dag(&dispatches).unwrap();
        assert_eq!(dag.waves.len(), 3, "diamond → 3 waves");

        let mut failed_indices: HashSet<usize> = HashSet::new();

        // Wave 0: A fails.
        failed_indices.insert(0);

        // Wave 1: B and C both depend on A → both skipped.
        for &dispatch_idx in &dag.waves[1] {
            let deps = &dag.in_batch_deps[dispatch_idx];
            let any_dep_failed = deps.iter().any(|dep| failed_indices.contains(dep));
            assert!(any_dep_failed, "wave 1 dispatch should have failed dep A");
            if any_dep_failed {
                failed_indices.insert(dispatch_idx);
            }
        }

        // Wave 2: D depends on B and C, both now failed → D skipped.
        for &dispatch_idx in &dag.waves[2] {
            let deps = &dag.in_batch_deps[dispatch_idx];
            let any_dep_failed = deps.iter().any(|dep| failed_indices.contains(dep));
            assert!(any_dep_failed, "D should have a failed dep (B or C)");
            if any_dep_failed {
                failed_indices.insert(dispatch_idx);
            }
        }

        assert_eq!(
            failed_indices.len(),
            4,
            "all four dispatches should be failed/skipped"
        );
    }

    // ------------------------------------------------------------------
    // Wave ordering tests
    // ------------------------------------------------------------------

    /// Verify that every dispatch in wave N > 0 has at least one in-batch dep
    /// in an earlier wave, and that wave 0 dispatches have no in-batch deps.
    /// This is the structural guarantee behind wave concurrency: wave 1
    /// threads don't start until wave 0 completes.
    #[test]
    fn test_wave_ordering_respects_dependencies() {
        // Diamond: A → {B, C} → D
        let dispatches = vec![
            make_dispatch(0, "A", &[]),
            make_dispatch(1, "B", &["A"]),
            make_dispatch(2, "C", &["A"]),
            make_dispatch(3, "D", &["B", "C"]),
        ];

        let dag = build_dag(&dispatches).unwrap();

        let mut earlier_waves: HashSet<usize> = HashSet::new();

        for (wave_idx, wave) in dag.waves.iter().enumerate() {
            for &dispatch_idx in wave {
                if wave_idx > 0 {
                    let deps = &dag.in_batch_deps[dispatch_idx];
                    let has_earlier_dep = deps.iter().any(|dep| earlier_waves.contains(dep));
                    assert!(
                        has_earlier_dep,
                        "dispatch {} in wave {} must have a dep in an earlier wave",
                        dispatch_idx, wave_idx
                    );
                } else {
                    assert!(
                        dag.in_batch_deps[dispatch_idx].is_empty(),
                        "dispatch {} in wave 0 must have no in-batch deps",
                        dispatch_idx
                    );
                }
            }

            for &dispatch_idx in wave {
                earlier_waves.insert(dispatch_idx);
            }
        }
    }

    // ------------------------------------------------------------------
    // Additional partition tests
    // ------------------------------------------------------------------

    /// Partition should handle a mix of thread calls with and without source
    /// threads, plus non-thread calls.
    #[test]
    fn test_partition_mixed_source_and_no_source_threads() {
        let runtime = test_runtime();
        let tool_calls = vec![
            make_tool_call("call_0", "thread", json!({"name": "A", "action": "work"})),
            make_tool_call(
                "call_1",
                "thread",
                json!({"name": "B", "action": "work", "threads": ["A"]}),
            ),
            make_tool_call(
                "call_2",
                "thread",
                json!({"name": "C", "action": "work", "threads": ["A", "preexisting"]}),
            ),
            make_tool_call("call_3", "read", json!({"path": "src/main.rs"})),
        ];

        let (thread_dispatches, other_calls, parse_errors) =
            partition_tool_calls(tool_calls, &runtime, &crate::events::SessionRunId::new());

        assert_eq!(thread_dispatches.len(), 3);
        assert_eq!(thread_dispatches[0].params.thread_name, "A");
        assert!(thread_dispatches[0].params.source_threads.is_empty());

        assert_eq!(thread_dispatches[1].params.thread_name, "B");
        assert_eq!(thread_dispatches[1].params.source_threads, vec!["A"]);

        assert_eq!(thread_dispatches[2].params.thread_name, "C");
        assert_eq!(
            thread_dispatches[2].params.source_threads,
            vec!["A", "preexisting"]
        );

        assert_eq!(other_calls.len(), 1);
        assert_eq!(other_calls[0].2, "read");

        assert!(parse_errors.is_empty());
    }

    /// Partition should produce a parse error when a thread call specifies
    /// skills but no skill registry is available.
    #[test]
    fn test_partition_skills_error_without_registry() {
        let runtime = test_runtime();
        let tool_calls = vec![make_tool_call(
            "call_0",
            "thread",
            json!({
                "name": "A",
                "action": "work",
                "skills": ["lint"]
            }),
        )];

        let (thread_dispatches, other_calls, parse_errors) =
            partition_tool_calls(tool_calls, &runtime, &crate::events::SessionRunId::new());

        assert!(thread_dispatches.is_empty());
        assert!(other_calls.is_empty());
        assert_eq!(parse_errors.len(), 1);
        assert!(parse_errors[0].3.is_error);
        assert!(
            parse_errors[0]
                .3
                .content
                .contains("no skills are available")
        );
    }

    /// Partition should succeed when a thread call has an empty skills array.
    #[test]
    fn test_partition_empty_skills_succeeds() {
        let runtime = test_runtime();
        let tool_calls = vec![make_tool_call(
            "call_0",
            "thread",
            json!({
                "name": "A",
                "action": "work",
                "skills": []
            }),
        )];

        let (thread_dispatches, other_calls, parse_errors) =
            partition_tool_calls(tool_calls, &runtime, &crate::events::SessionRunId::new());

        assert_eq!(thread_dispatches.len(), 1);
        assert!(thread_dispatches[0].params.scheduled_skills.is_empty());
        assert!(other_calls.is_empty());
        assert!(parse_errors.is_empty());
    }

    #[cfg(unix)]
    fn background_runtime(script_body: &str) -> (ToolRuntime, std::path::PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::Arc;
        use std::time::{SystemTime, UNIX_EPOCH};

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nac_background_dag_{}_{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&root).unwrap();
        let store = root.join("store.db");
        crate::store::initialize(&store).unwrap();
        crate::store::insert_test_session(&store, "test-session");
        let worker = root.join("worker.sh");
        std::fs::write(&worker, format!("#!/bin/sh\nset -eu\n{script_body}\n")).unwrap();
        std::fs::set_permissions(&worker, std::fs::Permissions::from_mode(0o700)).unwrap();

        let mut runtime = test_runtime();
        runtime.store_path = store;
        runtime.worker_executable = Some(worker);
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
        runtime.active_threads = Arc::new(crate::tools::ActiveThreadRegistry::default());
        (runtime, root)
    }

    #[cfg(unix)]
    async fn launch_calls(
        runtime: ToolRuntime,
        calls: Vec<ToolCall>,
        run_id: crate::events::SessionRunId,
    ) -> Vec<(String, String, ToolResult)> {
        let (dispatches, others, errors) = partition_tool_calls(calls, &runtime, &run_id);
        let dag = build_dag(&dispatches).unwrap();
        execute_with_dag(
            dispatches,
            others,
            errors,
            dag,
            DagExecContext {
                client: ModelClient::new_for_test(),
                event_sink: runtime.event_sink.clone(),
                agent_thread_name: None,
                runtime,
            },
        )
        .await
    }

    #[cfg(unix)]
    async fn wait_for_completions(
        runtime: &ToolRuntime,
        _run_id: &crate::events::SessionRunId,
        count: usize,
    ) -> Vec<crate::tools::ThreadCompletion> {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut completions = Vec::new();
        while completions.len() < count && tokio::time::Instant::now() < deadline {
            completions.extend(
                runtime
                    .active_threads
                    .take_completions(&HashSet::new(), &HashSet::new()),
            );
            if completions.len() < count {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }
        completions
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn background_acceptance_is_immediate_and_completion_is_terminal() {
        let (runtime, root) = background_runtime("sleep 1\necho terminal-result");
        let run_id = crate::events::SessionRunId::new();
        let started = tokio::time::Instant::now();
        let results = launch_calls(
            runtime.clone(),
            vec![make_tool_call(
                "call-a",
                "thread",
                json!({"name": "A", "action": "slow"}),
            )],
            run_id.clone(),
        )
        .await;
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
        assert!(!results[0].2.is_error);
        assert!(results[0].2.content.contains("accepted"));
        assert!(!results[0].2.content.contains("terminal-result"));
        let initial_state = runtime
            .active_threads
            .active_for_run(&run_id, &HashSet::new())[0]
            .state;
        assert!(matches!(
            initial_state,
            crate::tools::ThreadDispatchState::PendingDependency
                | crate::tools::ThreadDispatchState::Running
        ));
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(
            runtime
                .active_threads
                .active_for_run(&run_id, &HashSet::new())[0]
                .state,
            crate::tools::ThreadDispatchState::Running
        );

        let completions = wait_for_completions(&runtime, &run_id, 1).await;
        assert_eq!(completions.len(), 1);
        assert_eq!(completions[0].key.tool_call_id, "call-a");
        assert!(completions[0].content.contains("terminal-result"));
        assert!(!completions[0].is_error);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn same_name_is_rejected_while_first_background_dispatch_runs() {
        let (runtime, root) = background_runtime("sleep 1\necho done");
        let run_id = crate::events::SessionRunId::new();
        let first = launch_calls(
            runtime.clone(),
            vec![make_tool_call(
                "first",
                "thread",
                json!({"name": "A", "action": "one"}),
            )],
            run_id.clone(),
        )
        .await;
        let second = launch_calls(
            runtime.clone(),
            vec![make_tool_call(
                "second",
                "thread",
                json!({"name": "A", "action": "two"}),
            )],
            run_id.clone(),
        )
        .await;
        assert!(!first[0].2.is_error);
        assert!(second[0].2.is_error);
        assert!(second[0].2.content.contains("already running"));
        assert_eq!(wait_for_completions(&runtime, &run_id, 1).await.len(), 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn independent_wave_workers_start_in_parallel() {
        let (runtime, root) = background_runtime(
            r#"echo started >> starts
for i in $(seq 1 100); do
  [ "$(wc -l < starts | tr -d ' ')" -ge 2 ] && { echo parallel; exit 0; }
  sleep 0.02
done
exit 23"#,
        );
        let run_id = crate::events::SessionRunId::new();
        let results = launch_calls(
            runtime.clone(),
            vec![
                make_tool_call("a", "thread", json!({"name": "A", "action": "one"})),
                make_tool_call("b", "thread", json!({"name": "B", "action": "two"})),
            ],
            run_id.clone(),
        )
        .await;
        assert!(results.iter().all(|(_, _, result)| !result.is_error));
        let completions = wait_for_completions(&runtime, &run_id, 2).await;
        assert_eq!(completions.len(), 2);
        assert!(completions.iter().all(|completion| !completion.is_error));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_predecessor_queues_skip_without_starting_descendant() {
        let (runtime, root) = background_runtime(
            r#"action=""
previous=""
for argument in "$@"; do
  [ "$previous" = "--action" ] && action="$argument"
  previous="$argument"
done
echo "$action" >> actions
[ "$action" = "fail" ] && exit 7
echo should-not-run"#,
        );
        let run_id = crate::events::SessionRunId::new();
        let results = launch_calls(
            runtime.clone(),
            vec![
                make_tool_call("a", "thread", json!({"name": "A", "action": "fail"})),
                make_tool_call(
                    "b",
                    "thread",
                    json!({"name": "B", "action": "dependent", "threads": ["A"]}),
                ),
            ],
            run_id.clone(),
        )
        .await;
        assert!(results.iter().all(|(_, _, result)| !result.is_error));
        let completions = wait_for_completions(&runtime, &run_id, 2).await;
        assert_eq!(completions.len(), 2);
        let skipped = completions
            .iter()
            .find(|completion| completion.key.thread_name == "B")
            .unwrap();
        assert!(skipped.is_error);
        assert!(skipped.content.contains("Source thread 'A' failed"));
        assert_eq!(
            std::fs::read_to_string(root.join("actions")).unwrap(),
            "fail\n"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn registry_cancellation_aborts_owned_coordinator_and_worker() {
        let (runtime, root) = background_runtime("sleep 30\necho survived > survived");
        let run_id = crate::events::SessionRunId::new();
        launch_calls(
            runtime.clone(),
            vec![make_tool_call(
                "a",
                "thread",
                json!({"name": "A", "action": "slow"}),
            )],
            run_id.clone(),
        )
        .await;
        runtime
            .active_threads
            .abort_run(&runtime.store_path, "test-session", &run_id)
            .unwrap();
        let completions = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            wait_for_completions(&runtime, &run_id, 1),
        )
        .await
        .expect("cooperative cancellation did not terminalize");
        assert_eq!(completions.len(), 1);
        assert!(completions[0].is_error);
        assert!(completions[0].content.contains("cancelled"));
        assert!(
            runtime
                .active_threads
                .active_for_run(&run_id, &HashSet::new())
                .is_empty()
        );
        assert!(!root.join("survived").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_between_worker_return_and_finalize_fails_dependents() {
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let (mut runtime, root) = background_runtime(
                r#"action=""
previous=""
for argument in "$@"; do
  [ "$previous" = "--action" ] && action="$argument"
  previous="$argument"
done
echo "$action" >> actions
echo "natural success""#,
            );
            let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
            runtime.event_sink = EventSink::channel(sender);
            let registry = runtime.active_threads.clone();
            let cancel_registry = registry.clone();
            registry.set_before_finalize_hook(Arc::new(move |key| {
                if key.thread_name == "A" {
                    assert_eq!(
                        cancel_registry.request_cancel(key).unwrap(),
                        crate::tools::ThreadCancelOutcome::CancelRequested
                    );
                }
            }));
            let run_id = crate::events::SessionRunId::new();
            launch_calls(
                runtime.clone(),
                vec![
                    make_tool_call("a", "thread", json!({"name": "A", "action": "source"})),
                    make_tool_call(
                        "b",
                        "thread",
                        json!({"name": "B", "action": "dependent", "threads": ["A"]}),
                    ),
                ],
                run_id.clone(),
            )
            .await;

            let completions = wait_for_completions(&runtime, &run_id, 2).await;
            let by_name = completions
                .iter()
                .map(|completion| (completion.key.thread_name.as_str(), completion))
                .collect::<HashMap<_, _>>();
            assert!(by_name["A"].is_error);
            assert!(by_name["A"].content.contains("was cancelled"));
            assert!(by_name["B"].is_error);
            assert!(by_name["B"].content.contains("Source thread 'A' failed"));
            assert_eq!(
                std::fs::read_to_string(root.join("actions")).unwrap(),
                "source\n"
            );
            let events = std::iter::from_fn(|| receiver.try_recv().ok()).collect::<Vec<_>>();
            assert!(
                events.iter().any(|event| matches!(
                    event,
                    AgentEvent::ThreadFinished {
                        name,
                        timed_out: false,
                        timeout_reason: None,
                        status: Some(crate::events::ThreadDispatchStatus::Cancelled),
                        ..
                    } if name == "A"
                )),
                "events: {events:?}"
            );
            let _ = std::fs::remove_dir_all(root);
        })
        .await
        .expect("finalization race test timed out");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn forced_running_cancel_fails_dependents_and_preserves_independent_sibling() {
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let (mut runtime, root) = background_runtime(
                r#"action=""
previous=""
for argument in "$@"; do
  [ "$previous" = "--action" ] && action="$argument"
  previous="$argument"
done
echo "$action" >> actions
[ "$action" = "slow" ] && { echo $$ > leader; while :; do echo output; echo error >&2; sleep 0.02; done; }
echo "$action""#,
            );
            let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
            runtime.event_sink = EventSink::channel(sender);
            let run_id = crate::events::SessionRunId::new();
            launch_calls(
                runtime.clone(),
                vec![
                    make_tool_call("a", "thread", json!({"name": "A", "action": "slow"})),
                    make_tool_call(
                        "b",
                        "thread",
                        json!({"name": "B", "action": "dependent", "threads": ["A"]}),
                    ),
                    make_tool_call("c", "thread", json!({"name": "C", "action": "sibling"})),
                ],
                run_id.clone(),
            )
            .await;

            let key = loop {
                let active = runtime
                    .active_threads
                    .active_for_run(&run_id, &HashSet::new());
                if let Some(dispatch) = active.into_iter().find(|dispatch| {
                    dispatch.key.thread_name == "A"
                        && dispatch.state == crate::tools::ThreadDispatchState::Running
                }) {
                    break dispatch.key;
                }
                tokio::task::yield_now().await;
            };
            let leader = tokio::time::timeout(std::time::Duration::from_secs(1), async {
                loop {
                    if let Ok(pid) = std::fs::read_to_string(root.join("leader")) {
                        break pid.trim().parse::<u32>().unwrap();
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("worker process did not start");
            assert_eq!(
                runtime.active_threads.request_cancel(&key).unwrap(),
                crate::tools::ThreadCancelOutcome::CancelRequested
            );
            assert!(runtime.active_threads.force_abort_worker_for_test(&key));

            let completions = wait_for_completions(&runtime, &run_id, 3).await;
            assert_eq!(completions.len(), 3);
            tokio::time::timeout(
                std::time::Duration::from_secs(1),
                runtime.active_threads.drain_dispatch(&key),
            )
            .await
            .expect("forced dispatch did not drain owned reader tasks");
            tokio::time::timeout(std::time::Duration::from_secs(2), async {
                while std::path::Path::new(&format!("/proc/{leader}")).exists() {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("forced worker child was killed but not reaped");
            let by_name = completions
                .iter()
                .map(|completion| (completion.key.thread_name.as_str(), completion))
                .collect::<HashMap<_, _>>();
            assert!(by_name["A"].content.contains("cancelled"));
            assert!(by_name["B"].content.contains("Source thread 'A' failed"));
            assert!(!by_name["C"].is_error);
            let actions = std::fs::read_to_string(root.join("actions")).unwrap();
            assert!(actions.lines().any(|action| action == "sibling"));
            assert!(!actions.lines().any(|action| action == "dependent"));
            assert!(matches!(
                runtime.active_threads.request_cancel(&key).unwrap(),
                crate::tools::ThreadCancelOutcome::AlreadyTerminal(
                    crate::events::ThreadDispatchStatus::Cancelled
                )
            ));
            let events = std::iter::from_fn(|| receiver.try_recv().ok()).collect::<Vec<_>>();
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(
                        event,
                        AgentEvent::ThreadFinished { name, .. } if name == "A"
                    ))
                    .count(),
                1,
                "events: {events:?}"
            );
            let _ = std::fs::remove_dir_all(root);
        })
        .await
        .expect("forced running cancellation timed out");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn scheduled_skills_reach_background_worker_arguments() {
        use std::sync::Arc;
        let (mut runtime, root) =
            background_runtime("printf '%s\\n' \"$@\" > arguments\necho done");
        runtime.skills = Some(Arc::new(crate::skills::SkillRegistry::load_for_test(vec![
            crate::skills::SkillRecord {
                name: "lint".to_string(),
                description: "lint".to_string(),
                compatibility: None,
                skill_root_visible: root.join("lint"),
                body: "lint body".to_string(),
                resources: Vec::new(),
            },
        ])));
        let run_id = crate::events::SessionRunId::new();
        launch_calls(
            runtime.clone(),
            vec![make_tool_call(
                "a",
                "thread",
                json!({"name": "A", "action": "work", "skills": ["lint"]}),
            )],
            run_id.clone(),
        )
        .await;
        assert_eq!(wait_for_completions(&runtime, &run_id, 1).await.len(), 1);
        let arguments = std::fs::read_to_string(root.join("arguments")).unwrap();
        assert!(
            arguments
                .lines()
                .collect::<Vec<_>>()
                .windows(2)
                .any(|pair| pair == ["--skill", "lint"])
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn pending_cancellation_finalizer_emits_once_and_preserves_sibling() {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            let mut runtime = test_runtime();
            let root = std::env::temp_dir()
                .join(format!("nac_pending_cancel_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            runtime.store_path = root.join("store.db");
            crate::store::initialize(&runtime.store_path).unwrap();
            crate::store::insert_test_session(&runtime.store_path, "test-session");
            let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
            runtime.event_sink = EventSink::channel(sender);
            let run_id = crate::events::SessionRunId::new();
            let (dispatches, _, errors) = partition_tool_calls(
                vec![
                    make_tool_call("a", "thread", json!({"name": "A", "action": "one"})),
                    make_tool_call("b", "thread", json!({"name": "B", "action": "two"})),
                ],
                &runtime,
                &run_id,
            );
            assert!(errors.is_empty());
            assert!(runtime
                .active_threads
                .try_accept_batch(dispatches.iter().map(|dispatch| dispatch.key.clone()).collect())
                .into_iter()
                .all(|accepted| accepted));
            runtime
                .active_threads
                .request_cancel(&dispatches[1].key)
                .unwrap();
            let ctx = DagExecContext {
                client: ModelClient::new_for_test(),
                event_sink: runtime.event_sink.clone(),
                agent_thread_name: None,
                runtime: runtime.clone(),
            };
            let mut failed = HashSet::new();
            finalize_pending_cancellations(&dispatches, &ctx, &HashSet::new(), &mut failed);
            assert!(failed.contains(&1));
            assert!(runtime.active_threads.matches(&dispatches[0].key));
            assert!(!runtime.active_threads.matches(&dispatches[1].key));
            let cancelled_name = dispatches[1].key.thread_name.clone();
            let events = std::iter::from_fn(|| receiver.try_recv().ok()).collect::<Vec<_>>();
            let finished = events
                .iter()
                .filter(|event| matches!(event, AgentEvent::ThreadFinished { name, .. } if name == &cancelled_name))
                .count();
            assert_eq!(finished, 1, "events: {events:?}");
            let _ = std::fs::remove_dir_all(root);
        })
        .await
        .expect("pending cancellation finalizer timed out");
    }

    #[test]
    fn coordinator_cleanup_drop_removes_pending_entries_after_panic_or_cancel() {
        let mut runtime = test_runtime();
        let root =
            std::env::temp_dir().join(format!("nac_coordinator_cleanup_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        runtime.store_path = root.join("store.db");
        crate::store::initialize(&runtime.store_path).unwrap();
        crate::store::insert_test_session(&runtime.store_path, "test-session");
        let key =
            ThreadDispatchKey::new(crate::events::SessionRunId::new(), "A", "dispatch", "call");
        assert!(runtime.active_threads.try_accept(key.clone()));
        drop(CoordinatorCleanup {
            runtime: runtime.clone(),
            session_id: "test-session".to_string(),
            keys: vec![key],
        });
        assert!(!runtime.active_threads.is_active("A"));
        let _ = std::fs::remove_dir_all(root);
    }
}
