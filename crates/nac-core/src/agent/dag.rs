use std::collections::{HashMap, HashSet};

use tokio::task::JoinSet;

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
// DAG execution
// ------------------------------------------------------------------

/// Execute a batch of tool calls using the DAG coordinator.
///
/// Thread dispatches are executed in topological waves.  Non-thread tool calls
/// run concurrently in a separate `JoinSet` alongside all waves, so they
/// neither block wave progression nor affect thread failure tracking.  Parse
/// errors are returned immediately.
///
/// The caller is responsible for calling [`partition_tool_calls`] and
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
    all_results.extend(collect_parse_errors(
        parse_errors,
        &event_sink,
        &agent_thread_name,
    ));

    // 2. Pre-mark ALL thread names in active_threads.
    // Track which threads we successfully marked so we only unmark those
    // at the end — unmarking a thread that was already active from a prior
    // turn would clobber its mutual-exclusion guarantee.
    let mut failed_indices: HashSet<usize> = HashSet::new();
    let mut marked_by_us: HashMap<String, (String, String)> = HashMap::new();
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
                content: format!(
                    "Thread '{}' is already running; retry after the current dispatch completes.",
                    dispatch.params.thread_name
                ),
                is_error: true,
            };
            event_sink.emit(AgentEvent::ToolCallStarted {
                thread_name: agent_thread_name.clone(),
                call_id: dispatch.tool_call_id.clone(),
                name: "thread".to_string(),
                args_preview: preview_tool_args("thread", &dispatch.args_str),
                key_arg_preview: None,
                args_detail: Some(tool_args_detail(&dispatch.args_str)),
            });
            event_sink.emit(AgentEvent::ToolCallFinished {
                thread_name: agent_thread_name.clone(),
                call_id: dispatch.tool_call_id.clone(),
                name: "thread".to_string(),
                content_preview: preview_tool_result("thread", &result),
                is_error: true,
            });
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
    );

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
                    content: format!(
                        "Source thread '{}' failed; dispatch '{}' skipped.",
                        failed_dep_name, dispatch.params.thread_name
                    ),
                    is_error: true,
                };

                event_sink.emit(AgentEvent::ToolCallStarted {
                    thread_name: agent_thread_name.clone(),
                    call_id: dispatch.tool_call_id.clone(),
                    name: "thread".to_string(),
                    args_preview: preview_tool_args("thread", &dispatch.args_str),
                    key_arg_preview: None,
                    args_detail: Some(tool_args_detail(&dispatch.args_str)),
                });
                event_sink.emit(AgentEvent::ToolCallFinished {
                    thread_name: agent_thread_name.clone(),
                    call_id: dispatch.tool_call_id.clone(),
                    name: "thread".to_string(),
                    content_preview: preview_tool_result("thread", &result),
                    is_error: true,
                });

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
            event_sink.emit(AgentEvent::ToolCallStarted {
                thread_name: agent_thread_name.clone(),
                call_id: dispatch.tool_call_id.clone(),
                name: "thread".to_string(),
                args_preview: preview_tool_args("thread", &dispatch.args_str),
                key_arg_preview: None,
                args_detail: Some(tool_args_detail(&dispatch.args_str)),
            });

            // Spawn execute_parsed_dispatch.
            let runtime = runtime.clone();
            let client = thread::select_dispatch_client(&dispatch.params, &runtime, &client);
            let params = dispatch.params.clone();
            let id = dispatch.tool_call_id.clone();
            let original_index = dispatch.original_index;

            in_flight.insert(dispatch_idx);

            join_set.spawn(async move {
                let result = thread::execute_parsed_dispatch(params, &runtime, &client).await;
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
                                event_sink.emit(AgentEvent::ToolCallFinished {
                                    thread_name: agent_thread_name.clone(),
                                    call_id: tool_call_id.clone(),
                                    name: tool_name.clone(),
                                    content_preview: preview_tool_result(&tool_name, &result),
                                    is_error: result.is_error,
                                });
                                all_results.push((index, tool_call_id, tool_name, result));
                            }
                            Some(Err(error)) => {
                                all_results.push((
                                    usize::MAX,
                                    "unknown".to_string(),
                                    "unknown".to_string(),
                                    ToolResult {
                                        content: format!("Tool task panicked: {}", error),
                                        is_error: true,
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

                    event_sink.emit(AgentEvent::ToolCallFinished {
                        thread_name: agent_thread_name.clone(),
                        call_id: tool_call_id.clone(),
                        name: tool_name.clone(),
                        content_preview: preview_tool_result(&tool_name, &result),
                        is_error: result.is_error,
                    });

                    all_results.push((index, tool_call_id, tool_name, result));
                }
                Some(Err(error)) => {
                    // A task panicked.  Mark all remaining in-flight thread
                    // dispatches as failed so dependents are skipped.
                    for &dispatch_idx in in_flight.iter() {
                        failed_indices.insert(dispatch_idx);
                    }
                    in_flight.clear();

                    all_results.push((
                        usize::MAX,
                        "unknown".to_string(),
                        "unknown".to_string(),
                        ToolResult {
                            content: format!("Tool task panicked: {}", error),
                            is_error: true,
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
                event_sink.emit(AgentEvent::ToolCallFinished {
                    thread_name: agent_thread_name.clone(),
                    call_id: tool_call_id.clone(),
                    name: tool_name.clone(),
                    content_preview: preview_tool_result(&tool_name, &result),
                    is_error: result.is_error,
                });
                all_results.push((index, tool_call_id, tool_name, result));
            }
            Err(error) => {
                all_results.push((
                    usize::MAX,
                    "unknown".to_string(),
                    "unknown".to_string(),
                    ToolResult {
                        content: format!("Tool task panicked: {}", error),
                        is_error: true,
                    },
                ));
            }
        }
    }

    for (name, (session_id, dispatch_id)) in &marked_by_us {
        thread::close_thread_dispatch(&runtime, session_id, name, dispatch_id);
    }

    // 7. Sort by original index and return.
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
        ParsedThreadDispatch {
            original_index: index,
            tool_call_id: format!("call_{}", index),
            args_str,
            params: ParsedDispatchParams {
                thread_name: name.to_string(),
                dispatch_id: format!("dispatch-{index}"),
                action: "test action".to_string(),
                source_threads: source_threads.iter().map(|s| s.to_string()).collect(),
                scheduled_skills: Vec::new(),
                session_id: "test-session".to_string(),
                timeout_secs: DEFAULT_THREAD_TIMEOUT_SECS,
                complexity: None,
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
            partition_tool_calls(tool_calls, &runtime);

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
            partition_tool_calls(tool_calls, &runtime);

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
            partition_tool_calls(tool_calls, &runtime);

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
            partition_tool_calls(tool_calls, &runtime);

        assert!(thread_dispatches.is_empty());
        assert!(other_calls.is_empty());
        assert_eq!(parse_errors.len(), 1);
        assert!(parse_errors[0].3.is_error);
        assert!(parse_errors[0]
            .3
            .content
            .contains("no skills are available"));
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
            partition_tool_calls(tool_calls, &runtime);

        assert_eq!(thread_dispatches.len(), 1);
        assert!(thread_dispatches[0].params.scheduled_skills.is_empty());
        assert!(other_calls.is_empty());
        assert!(parse_errors.is_empty());
    }
}
