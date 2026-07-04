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

/// Partition a batch of tool calls into:
///
/// 1. `Vec<ParsedThreadDispatch>` — successfully parsed `thread` calls
/// 2. `Vec<(usize, String, String, String)>` — non-thread calls as
///    `(original_index, tool_call_id, tool_name, args_str)`
/// 3. `Vec<(usize, String, ToolResult)>` — parse errors for malformed thread
///    calls as `(original_index, tool_call_id, error_result)`
#[allow(clippy::type_complexity)]
pub(crate) fn partition_tool_calls(
    tool_calls: Vec<ToolCall>,
    runtime: &ToolRuntime,
) -> (
    Vec<ParsedThreadDispatch>,
    Vec<(usize, String, String, String)>,
    Vec<(usize, String, ToolResult)>,
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
                    parse_errors.push((index, id, error_result));
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
    /// Thread name → dispatch index.  Used during construction; retained for
    /// debugging and potential future lookups.
    #[allow(dead_code)]
    pub name_to_index: HashMap<String, usize>,
    /// Dispatch index → list of source dispatch indices (in-batch deps only).
    pub in_batch_deps: HashMap<usize, Vec<usize>>,
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
            name_to_index: HashMap::new(),
            in_batch_deps: HashMap::new(),
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
    let mut in_batch_deps: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); n]; // adjacency[i] = nodes that depend on i
    let mut in_degree = vec![0usize; n];

    for (i, dispatch) in dispatches.iter().enumerate() {
        let mut deps: Vec<usize> = Vec::new();
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

                if !deps.contains(&dep_idx) {
                    deps.push(dep_idx);
                }
            }
        }

        for &dep_idx in &deps {
            adjacency[dep_idx].push(i);
            in_degree[i] += 1;
        }
        in_batch_deps.insert(i, deps);
    }

    // 3. Kahn's algorithm — collect nodes level-by-level into waves.
    let mut waves: Vec<Vec<usize>> = Vec::new();
    let mut sorted_count = 0;
    let mut current_in_degree = in_degree;

    while sorted_count < n {
        // Collect all nodes with in-degree 0 that haven't been sorted yet.
        let wave: Vec<usize> = (0..n)
            .filter(|&i| current_in_degree[i] == 0)
            .collect();

        if wave.is_empty() {
            // Cycle detected — report the remaining nodes.
            let remaining: Vec<String> = (0..n)
                .filter(|i| current_in_degree[*i] > 0)
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
            current_in_degree[node] = usize::MAX; // sentinel: sorted
        }

        sorted_count += wave.len();
        waves.push(wave);
    }

    Ok(Dag {
        waves,
        name_to_index,
        in_batch_deps,
    })
}

/// Execute a batch of tool calls using the DAG coordinator.
///
/// Thread dispatches are executed in topological waves.  Non-thread tool calls
/// run concurrently with wave 0.  Parse errors are returned immediately.
///
/// The caller is responsible for calling [`partition_tool_calls`] and
/// [`build_dag`] first.  This function manages the `active_threads` lifecycle
/// for all thread dispatches in the batch.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_with_dag(
    thread_dispatches: Vec<ParsedThreadDispatch>,
    mut other_calls: Vec<(usize, String, String, String)>,
    parse_errors: Vec<(usize, String, ToolResult)>,
    dag: Dag,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
    agent_thread_name: Option<String>,
) -> Vec<(String, String, ToolResult)> {
    // Results: (original_index, tool_call_id, tool_name, ToolResult)
    let mut all_results: Vec<(usize, String, String, ToolResult)> = Vec::new();

    // Map tool_call_id → dispatch index for failed-dispatch tracking.
    let call_id_to_dispatch_idx: HashMap<String, usize> = thread_dispatches
        .iter()
        .enumerate()
        .map(|(i, d)| (d.tool_call_id.clone(), i))
        .collect();

    // 1. Collect parse errors immediately.
    for (index, tool_call_id, error_result) in parse_errors {
        event_sink.emit(AgentEvent::ToolCallFinished {
            thread_name: agent_thread_name.clone(),
            call_id: tool_call_id.clone(),
            name: "thread".to_string(),
            content_preview: preview_tool_result("thread", &error_result),
            is_error: error_result.is_error,
        });
        all_results.push((index, tool_call_id, "thread".to_string(), error_result));
    }

    // 2. Pre-mark ALL thread names in active_threads.
    // Track which threads we successfully marked so we only unmark those
    // at the end — unmarking a thread that was already active from a prior
    // turn would clobber its mutual-exclusion guarantee.
    let mut failed_indices: HashSet<usize> = HashSet::new();
    let mut marked_by_us: HashSet<String> = HashSet::new();
    for (i, dispatch) in thread_dispatches.iter().enumerate() {
        if thread::mark_thread_active(&runtime, &dispatch.params.thread_name).await {
            marked_by_us.insert(dispatch.params.thread_name.clone());
        } else {
            let result = ToolResult {
                content: format!(
                    "Thread '{}' is already running; retry after the current dispatch completes.",
                    dispatch.params.thread_name
                ),
                is_error: true,
            };
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

    // 3. Execute waves.
    let Dag {
        waves,
        name_to_index: _,
        in_batch_deps,
    } = dag;

    // Ensure at least one wave exists if there are other_calls but no threads.
    let waves = if waves.is_empty() && !other_calls.is_empty() {
        vec![Vec::new()]
    } else {
        waves
    };

    for (wave_idx, wave) in waves.iter().enumerate() {
        let mut join_set: JoinSet<(usize, String, String, ToolResult)> = JoinSet::new();

        // Wave 0: also spawn all non-thread tool calls.
        if wave_idx == 0 {
            let calls = std::mem::take(&mut other_calls);
            for (index, tool_call_id, tool_name, args_str) in calls {
                let runtime = runtime.clone();
                let client = client.clone();
                let event_sink = event_sink.clone();
                let thread_name = agent_thread_name.clone();

                event_sink.emit(AgentEvent::ToolCallStarted {
                    thread_name: thread_name.clone(),
                    call_id: tool_call_id.clone(),
                    name: tool_name.clone(),
                    args_preview: preview_tool_args(&tool_name, &args_str),
                    args_detail: Some(tool_args_detail(&args_str)),
                });

                join_set.spawn(async move {
                    let parsed_args = match serde_json::from_str::<serde_json::Value>(&args_str) {
                        Ok(value) => value,
                        Err(error) => {
                            return (
                                index,
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
                    let result = tools::execute_tool(&tool_name, parsed_args, &runtime, &client)
                        .await;
                    (index, tool_call_id, tool_name, result)
                });
            }
        }

        // Spawn thread dispatches for this wave.
        for &dispatch_idx in wave {
            if failed_indices.contains(&dispatch_idx) {
                continue;
            }

            let dispatch = &thread_dispatches[dispatch_idx];

            // Check if any in-batch deps failed in a previous wave.
            let deps = in_batch_deps
                .get(&dispatch_idx)
                .cloned()
                .unwrap_or_default();
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
                        failed_dep_name,
                        dispatch.params.thread_name
                    ),
                    is_error: true,
                };

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
                args_detail: Some(tool_args_detail(&dispatch.args_str)),
            });

            // Spawn execute_parsed_dispatch.
            let runtime = runtime.clone();
            let client = client.clone();
            let params = dispatch.params.clone();
            let id = dispatch.tool_call_id.clone();
            let original_index = dispatch.original_index;

            join_set.spawn(async move {
                let result = thread::execute_parsed_dispatch(params, &runtime, &client).await;
                (original_index, id, "thread".to_string(), result)
            });
        }

        // Await all tasks in the JoinSet.
        while let Some(join_result) = join_set.join_next().await {
            match join_result {
                Ok((index, tool_call_id, tool_name, result)) => {
                    event_sink.emit(AgentEvent::ToolCallFinished {
                        thread_name: agent_thread_name.clone(),
                        call_id: tool_call_id.clone(),
                        name: tool_name.clone(),
                        content_preview: preview_tool_result(&tool_name, &result),
                        is_error: result.is_error,
                    });

                    // Track failed thread dispatches for dependency checking.
                    if result.is_error {
                        if let Some(&dispatch_idx) = call_id_to_dispatch_idx.get(&tool_call_id) {
                            failed_indices.insert(dispatch_idx);
                        }
                    }

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
    }

    // 4. Unmark only threads we successfully marked (including skipped ones
    //    that were marked but not spawned).  Threads that were already active
    //    from a prior turn were NOT marked by us, so we must not unmark them.
    for name in &marked_by_us {
        thread::unmark_thread_active(&runtime, name).await;
    }

    // 5. Sort by original index and return.
    all_results.sort_by_key(|(index, ..)| *index);
    all_results
        .into_iter()
        .map(|(_, tool_call_id, tool_name, result)| (tool_call_id, tool_name, result))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::EventSink;
    use crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS;
    use crate::types::{FunctionCall, ToolCall};
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::Arc;

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

    fn test_runtime() -> ToolRuntime {
        let workspace_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace_cwd);
        ToolRuntime {
            config_cwd: workspace_cwd.clone(),
            workspace_cwd,
            store_path: PathBuf::new(),
            session_id: Some("test-session".to_string()),
            worker_executable: None,
            active_threads: Arc::new(Mutex::new(HashSet::new())),
            event_sink: EventSink::none(),
            backend,
            mcp: None,
            skills: None,
            terminal_manager: crate::terminal::TerminalManager::new(),
            thread_timeout_secs: DEFAULT_THREAD_TIMEOUT_SECS,
            worker_usage: Arc::new(Mutex::new(crate::model::TokenUsage::default())),
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
            assert!(dag.in_batch_deps.get(&i).unwrap().is_empty());
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
        assert!(dag.in_batch_deps.get(&0).unwrap().is_empty());
        assert_eq!(dag.in_batch_deps.get(&1).unwrap(), &vec![0usize]);
        assert_eq!(dag.in_batch_deps.get(&2).unwrap(), &vec![1usize]);
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
        let d_deps = dag.in_batch_deps.get(&3).unwrap();
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
        let b_deps = dag.in_batch_deps.get(&1).unwrap();
        assert_eq!(b_deps, &vec![0], "only A should be an in-batch dep");
    }

    #[test]
    fn test_build_dag_detects_cycle() {
        // A → B, B → A
        let dispatches = vec![
            make_dispatch(0, "A", &["B"]),
            make_dispatch(1, "B", &["A"]),
        ];

        let err = build_dag(&dispatches).unwrap_err();
        assert!(matches!(err, DagError::Cycle(_)));
    }

    #[test]
    fn test_build_dag_detects_duplicate_names() {
        let dispatches = vec![
            make_dispatch(0, "X", &[]),
            make_dispatch(1, "X", &[]),
        ];

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
            make_tool_call("call_2", "thread", json!({"name": "B", "action": "work", "threads": ["A"]})),
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
        let tool_calls = vec![
            make_tool_call("call_0", "thread", json!({"action": "work"})), // missing "name"
        ];

        let (thread_dispatches, other_calls, parse_errors) =
            partition_tool_calls(tool_calls, &runtime);

        assert!(thread_dispatches.is_empty());
        assert!(other_calls.is_empty());
        assert_eq!(parse_errors.len(), 1);
        assert_eq!(parse_errors[0].0, 0, "original_index preserved");
        assert_eq!(parse_errors[0].1, "call_0");
        assert!(parse_errors[0].2.is_error);
        assert!(parse_errors[0].2.content.contains("'name'"));
    }
}
