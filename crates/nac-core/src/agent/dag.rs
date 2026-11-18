use std::collections::{BTreeMap, HashMap, HashSet};
use std::panic::AssertUnwindSafe;

use futures_util::FutureExt;

use tokio::task::JoinSet;

#[cfg(test)]
use super::tool_exec::partition_tool_calls;
use super::tool_exec::{collect_parse_errors, sort_and_strip_index, spawn_non_thread_into};
use super::*;
use crate::tools::thread::{self, ParsedDispatchParams};

/// A successfully parsed `thread` tool call, ready for DAG-ordered execution.
pub(crate) struct ParsedThreadDispatch {
    pub original_index: usize,
    pub tool_call_id: String,
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

// ------------------------------------------------------------------
// DAG execution
// ------------------------------------------------------------------

/// Execute a batch of tool calls using the DAG coordinator.
///
/// Thread dispatches are executed in topological waves.  Non-thread tool calls
/// run concurrently in a separate `JoinSet` alongside all waves, so they
/// neither block wave progression nor affect thread failure tracking.  Parse
/// errors are returned immediately.
///
/// The caller is responsible for calling [`super::tool_exec::partition_tool_calls`] and
/// [`build_dag`] first.  This function manages the `active_threads` lifecycle
/// for all thread dispatches in the batch.
pub(crate) async fn execute_with_dag(
    thread_dispatches: Vec<ParsedThreadDispatch>,
    other_calls: Vec<(usize, String, String, String)>,
    parse_errors: Vec<(usize, String, String, ToolResult)>,
    dag: Dag,
    ctx: DagExecContext,
) -> Vec<(String, String, ToolResult)> {
    let DagExecContext {
        runtime,
        client,
        event_sink,
        agent_thread_name,
    } = ctx;

    // Results: (original_index, tool_call_id, tool_name, ToolResult)
    let mut all_results: Vec<(usize, String, String, ToolResult)> = Vec::new();

    // 1. Collect parse errors immediately.
    all_results.extend(collect_parse_errors(parse_errors, &event_sink, &agent_thread_name).await);

    // 2. Pre-mark ALL thread names in active_threads.
    // Track which threads we successfully marked so we only unmark those
    // at the end — unmarking a thread that was already active from a prior
    // turn would clobber its mutual-exclusion guarantee.
    let mut failed_indices: HashSet<usize> = HashSet::new();
    let mut marked_by_us: BTreeMap<String, (String, String)> = BTreeMap::new();
    for (i, dispatch) in thread_dispatches.iter().enumerate() {
        if thread::mark_thread_active(
            &runtime,
            &dispatch.params.thread_name,
            &dispatch.params.dispatch_id,
        ) {
            marked_by_us.insert(
                dispatch.params.thread_name.clone(),
                (
                    dispatch.params.session_id.clone(),
                    dispatch.params.dispatch_id.clone(),
                ),
            );
        } else {
            let result = ToolResult {
                content: (format!(
                    "Thread '{}' is already running; retry after the current dispatch completes.",
                    dispatch.params.thread_name
                ))
                .into(),
                is_error: true,
                execution_duration_ms: None,
                execution_duration_excludes_authorization: false,
                delegation_outcome: None,
                delegation_summary: None,
            };
            event_sink
                .emit_async(AgentEvent::ToolCallStarted {
                    thread_name: agent_thread_name.clone(),
                    call_id: dispatch.tool_call_id.clone(),
                    name: "thread".to_string(),
                    args_preview: preview_tool_args("thread", &dispatch.args_str),
                    key_arg_preview: None,
                    args_detail: Some(tool_args_detail(&dispatch.args_str)),
                    delegation_intent: None,
                    delegation_summary_verified: false,
                })
                .await;
            event_sink
                .emit_async(AgentEvent::tool_call_finished(
                    agent_thread_name.clone(),
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
            failed_indices.insert(i);
        }
    }

    // 3. Spawn non-thread tools into a separate JoinSet that runs
    //    concurrently with all waves.  This isolates non-thread tool panics
    //    from thread failure tracking and prevents long-running non-thread
    //    tools from blocking wave progression.
    let mut non_thread_join_set: JoinSet<(usize, Option<usize>, String, String, ToolResult)> =
        JoinSet::new();
    spawn_non_thread_into(
        &mut non_thread_join_set,
        other_calls,
        &runtime,
        &client,
        &event_sink,
        &agent_thread_name,
    )
    .await;

    // Track whether the non-thread JoinSet has been fully drained.  Once
    // empty, we skip polling it in the wave loop to avoid a busy-wait spin.
    let mut non_thread_empty = non_thread_join_set.is_empty();

    // 4. Execute waves.
    let Dag {
        waves,
        in_batch_deps,
    } = dag;

    for wave in waves.iter() {
        let mut join_set: JoinSet<(usize, Option<usize>, String, String, ToolResult)> =
            JoinSet::new();
        // Track which thread dispatches are in-flight (spawned but not yet
        // completed).  If a task panics, all remaining in-flight dispatches
        // are marked as failed so their dependents are skipped.
        let mut in_flight: HashSet<usize> = HashSet::new();

        // Spawn thread dispatches for this wave.
        for &dispatch_idx in wave {
            if failed_indices.contains(&dispatch_idx) {
                continue;
            }

            let dispatch = &thread_dispatches[dispatch_idx];

            // Check if any in-batch deps failed in a previous wave.
            let deps = &in_batch_deps[dispatch_idx];
            let any_dep_failed = deps.iter().any(|dep_idx| failed_indices.contains(dep_idx));

            if any_dep_failed {
                let failed_dep_name = deps
                    .iter()
                    .find(|dep_idx| failed_indices.contains(dep_idx))
                    .map(|dep_idx| &thread_dispatches[*dep_idx].params.thread_name)
                    .cloned()
                    .unwrap_or_default();

                let result = ToolResult {
                    content: (format!(
                        "Source thread '{}' failed; dispatch '{}' skipped.",
                        failed_dep_name, dispatch.params.thread_name
                    ))
                    .into(),
                    is_error: true,
                    execution_duration_ms: None,
                    execution_duration_excludes_authorization: false,
                    delegation_outcome: None,
                    delegation_summary: None,
                };

                event_sink
                    .emit_async(AgentEvent::ToolCallStarted {
                        thread_name: agent_thread_name.clone(),
                        call_id: dispatch.tool_call_id.clone(),
                        name: "thread".to_string(),
                        args_preview: preview_tool_args("thread", &dispatch.args_str),
                        key_arg_preview: None,
                        args_detail: Some(tool_args_detail(&dispatch.args_str)),
                        delegation_intent: None,
                        delegation_summary_verified: false,
                    })
                    .await;
                event_sink
                    .emit_async(AgentEvent::tool_call_finished(
                        agent_thread_name.clone(),
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

                failed_indices.insert(dispatch_idx);
                continue;
            }

            // Emit ToolCallStarted for the thread dispatch.
            event_sink
                .emit_async(AgentEvent::ToolCallStarted {
                    thread_name: agent_thread_name.clone(),
                    call_id: dispatch.tool_call_id.clone(),
                    name: "thread".to_string(),
                    args_preview: preview_tool_args("thread", &dispatch.args_str),
                    key_arg_preview: None,
                    args_detail: Some(tool_args_detail(&dispatch.args_str)),
                    delegation_intent: None,
                    delegation_summary_verified: false,
                })
                .await;

            // Spawn execute_parsed_dispatch.
            let runtime = runtime.clone();
            let client = thread::select_dispatch_client(&dispatch.params, &runtime, &client);
            let params = dispatch.params.clone();
            let id = dispatch.tool_call_id.clone();
            let original_index = dispatch.original_index;

            in_flight.insert(dispatch_idx);

            join_set.spawn(async move {
                let result =
                    AssertUnwindSafe(thread::execute_parsed_dispatch(params, &runtime, &client))
                        .catch_unwind()
                        .await
                        .unwrap_or_else(|_| {
                            ToolResult::text("Error: tool 'thread' panicked", true)
                        });
                (
                    original_index,
                    Some(dispatch_idx),
                    id,
                    "thread".to_string(),
                    result,
                )
            });
        }

        // Drain the wave JoinSet, concurrently polling the non-thread
        // JoinSet so `ToolCallFinished` events for non-thread tools are
        // emitted promptly.  Using `select!` (instead of a detached
        // `tokio::spawn`) keeps everything in this async function — when
        // the outer future is dropped via `task.abort()`, both JoinSets
        // are dropped, which aborts all spawned tasks.  A detached spawn
        // would survive the abort and keep running non-thread tools after
        // the user pressed stop.
        //
        // `biased` prioritises the non-thread branch so finish events are
        // emitted as early as possible.  The non-thread branch never
        // breaks the loop — only the wave branch returning `None` (JoinSet
        // drained) advances to the next wave.
        loop {
            let wave_res = if non_thread_empty {
                join_set.join_next().await
            } else {
                tokio::select! {
                    biased;
                    nt_res = non_thread_join_set.join_next() => {
                        match nt_res {
                            Some(Ok((index, _, tool_call_id, tool_name, result))) => {
                                if !result.content.contains_images() {
                                    event_sink.emit_async(AgentEvent::tool_call_finished(
                                        agent_thread_name.clone(),
                                        tool_call_id.clone(),
                                        tool_name.clone(),
                                        &result,
                                    )).await;
                                }
                                all_results.push((index, tool_call_id, tool_name, result));
                            }
                            Some(Err(error)) => {
                                all_results.push((
                                    usize::MAX,
                                    "unknown".to_string(),
                                    "unknown".to_string(),
                                    ToolResult {
                                        content: format!("Tool task panicked: {error}").into(),
                                        is_error: true,
                                        execution_duration_ms: None,
                                        execution_duration_excludes_authorization: false,
                                    delegation_outcome: None,
                                    delegation_summary: None,
                                    },
                                ));
                            }
                            None => {
                                non_thread_empty = true;
                            }
                        }
                        continue;
                    }
                    wave_res = join_set.join_next() => wave_res
                }
            };

            match wave_res {
                Some(Ok((index, dispatch_idx_opt, tool_call_id, tool_name, result))) => {
                    // Remove from in-flight and track failures for thread dispatches.
                    if let Some(dispatch_idx) = dispatch_idx_opt {
                        in_flight.remove(&dispatch_idx);
                        if result.is_error {
                            failed_indices.insert(dispatch_idx);
                        } else if failed_indices.contains(&dispatch_idx) {
                            // Was marked failed by the panic handler but actually
                            // succeeded — un-fail it so dependents in later waves
                            // are not incorrectly skipped.
                            failed_indices.remove(&dispatch_idx);
                        }
                    }

                    event_sink
                        .emit_async(AgentEvent::tool_call_finished(
                            agent_thread_name.clone(),
                            tool_call_id.clone(),
                            tool_name.clone(),
                            &result,
                        ))
                        .await;

                    all_results.push((index, tool_call_id, tool_name, result));
                }
                Some(Err(error)) => {
                    // A task panicked.  Mark all remaining in-flight thread
                    // dispatches as failed so dependents are skipped.
                    failed_indices.extend(in_flight.drain());

                    all_results.push((
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
                None => break,
            }
        }
    }

    // 5. Drain any remaining non-thread tools that did not finish during
    //    wave execution.  `ToolCallFinished` events are emitted as each
    //    completes.
    while let Some(join_result) = non_thread_join_set.join_next().await {
        match join_result {
            Ok((index, _, tool_call_id, tool_name, result)) => {
                if !result.content.contains_images() {
                    event_sink
                        .emit_async(AgentEvent::tool_call_finished(
                            agent_thread_name.clone(),
                            tool_call_id.clone(),
                            tool_name.clone(),
                            &result,
                        ))
                        .await;
                }
                all_results.push((index, tool_call_id, tool_name, result));
            }
            Err(error) => {
                all_results.push((
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

    for (name, (session_id, dispatch_id)) in &marked_by_us {
        thread::close_thread_dispatch_async(&runtime, session_id, name, dispatch_id).await;
    }

    // 7. Sort by original index and return.
    sort_and_strip_index(all_results)
}

#[cfg(test)]
#[path = "dag_tests.rs"]
mod tests;
