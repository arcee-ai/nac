use super::*;

pub(super) async fn execute_tools_parallel(
    tool_calls: Vec<ToolCall>,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
    thread_name: Option<String>,
) -> Vec<(String, String, ToolResult)> {
    // 1. Partition tool calls into thread dispatches, non-thread calls, and
    //    parse errors.
    let run_id = event_sink
        .run_id()
        .cloned()
        .unwrap_or_else(crate::events::SessionRunId::new);
    let (thread_dispatches, other_calls, parse_errors) =
        dag::partition_tool_calls(tool_calls, &runtime, &run_id);

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

    dag::spawn_non_thread_into(
        &mut join_set,
        other_calls,
        runtime,
        client,
        event_sink,
        thread_name,
    );

    let mut results = Vec::new();
    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok((index, _, tool_call_id, tool_name, result)) => {
                event_sink.emit(AgentEvent::ToolCallFinished {
                    thread_name: thread_name.clone(),
                    call_id: tool_call_id.clone(),
                    name: tool_name.clone(),
                    content_preview: preview_tool_result(&tool_name, &result),
                    is_error: result.is_error,
                    dispatch_thread_name: None,
                    dispatch_id: None,
                    dispatch_status: None,
                });
                results.push((index, tool_call_id, tool_name, result));
            }
            Err(error) => {
                results.push((
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
    all_results.extend(dag::collect_parse_errors(
        parse_errors,
        &event_sink,
        &thread_name,
    ));

    // Execute non-thread calls.
    let non_thread_results =
        spawn_and_collect_non_thread(other_calls, &runtime, &client, &event_sink, &thread_name)
            .await;
    all_results.extend(non_thread_results);

    dag::sort_and_strip_index(all_results)
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
    all_results.extend(dag::collect_parse_errors(
        parse_errors,
        &event_sink,
        &thread_name,
    ));

    // Produce error ToolResults for all thread dispatches.
    let error_message = match &dag_err {
        dag::DagError::DuplicateName(name) => {
            format!("Duplicate thread name '{}' in parallel dispatch", name)
        }
        dag::DagError::Cycle(desc) => {
            format!("Circular dependency in thread dispatch: {}", desc)
        }
    };

    for dispatch in &thread_dispatches {
        let result = ToolResult {
            content: error_message.clone(),
            is_error: true,
        };
        event_sink.emit(AgentEvent::ToolCallStarted {
            thread_name: thread_name.clone(),
            call_id: dispatch.tool_call_id.clone(),
            name: "thread".to_string(),
            args_preview: preview_tool_args("thread", &dispatch.args_str),
            key_arg_preview: None,
            args_detail: Some(tool_args_detail(&dispatch.args_str)),
        });
        event_sink.emit(AgentEvent::ToolCallFinished {
            thread_name: thread_name.clone(),
            call_id: dispatch.tool_call_id.clone(),
            name: "thread".to_string(),
            content_preview: preview_tool_result("thread", &result),
            is_error: true,
            dispatch_thread_name: None,
            dispatch_id: None,
            dispatch_status: None,
        });
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

    dag::sort_and_strip_index(all_results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::test_runtime;
    use crate::types::FunctionCall;
    use serde_json::json;

    // ------------------------------------------------------------------
    // Test helpers
    // ------------------------------------------------------------------

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
    // Integration tests
    // ------------------------------------------------------------------

    /// When there are no thread calls, the simple path executes non-thread
    /// tools and returns results sorted by original index.
    #[tokio::test]
    async fn test_simple_path_no_thread_calls() {
        let tool_calls = vec![
            make_tool_call("call_0", "nonexistent_tool", json!({})),
            make_tool_call("call_1", "nonexistent_tool", json!({})),
        ];

        let runtime = test_runtime();
        let client = ModelClient::new_for_test();
        let event_sink = EventSink::none();

        let results = execute_tools_parallel(tool_calls, runtime, client, event_sink, None).await;

        assert_eq!(results.len(), 2);
        // Results should be sorted by original index.
        assert_eq!(results[0].0, "call_0");
        assert_eq!(results[1].0, "call_1");
        // Unknown tool → error result.
        assert!(results[0].2.is_error);
        assert!(results[1].2.is_error);
    }

    /// Results from a mix of thread and non-thread calls should come back
    /// sorted by original index, even when the DAG fails (cycle path).
    #[tokio::test]
    async fn test_results_sorted_by_original_index() {
        // Thread calls with a cycle at indices 1 and 3, non-thread at 0 and 2.
        let tool_calls = vec![
            make_tool_call("call_0", "nonexistent_tool", json!({})),
            make_tool_call(
                "call_1",
                "thread",
                json!({"name": "A", "action": "work", "threads": ["B"]}),
            ),
            make_tool_call("call_2", "nonexistent_tool", json!({})),
            make_tool_call(
                "call_3",
                "thread",
                json!({"name": "B", "action": "work", "threads": ["A"]}),
            ),
        ];

        let runtime = test_runtime();
        let client = ModelClient::new_for_test();
        let event_sink = EventSink::none();

        let results = execute_tools_parallel(tool_calls, runtime, client, event_sink, None).await;

        assert_eq!(results.len(), 4);
        // Sorted by original index.
        assert_eq!(results[0].0, "call_0");
        assert_eq!(results[1].0, "call_1");
        assert_eq!(results[2].0, "call_2");
        assert_eq!(results[3].0, "call_3");
    }

    /// When DAG construction fails due to a cycle, all thread calls should
    /// receive error results describing the cycle, while non-thread tools
    /// still execute normally.
    #[tokio::test]
    async fn test_dag_error_returns_errors_for_all_thread_calls() {
        // A → B, B → A (cycle)
        let tool_calls = vec![
            make_tool_call(
                "call_0",
                "thread",
                json!({"name": "A", "action": "work", "threads": ["B"]}),
            ),
            make_tool_call(
                "call_1",
                "thread",
                json!({"name": "B", "action": "work", "threads": ["A"]}),
            ),
            make_tool_call("call_2", "nonexistent_tool", json!({})),
        ];

        let runtime = test_runtime();
        let client = ModelClient::new_for_test();
        let event_sink = EventSink::none();

        let results = execute_tools_parallel(tool_calls, runtime, client, event_sink, None).await;

        assert_eq!(results.len(), 3);

        // Thread calls should have error results mentioning circular dependency.
        let a_result = results.iter().find(|(id, _, _)| id == "call_0").unwrap();
        let b_result = results.iter().find(|(id, _, _)| id == "call_1").unwrap();
        assert!(a_result.2.is_error);
        assert!(b_result.2.is_error);
        assert!(
            a_result.2.content.contains("Circular dependency"),
            "expected cycle message, got: {}",
            a_result.2.content
        );
        assert!(
            b_result.2.content.contains("Circular dependency"),
            "expected cycle message, got: {}",
            b_result.2.content
        );

        // Non-thread call should still have a result (error for unknown tool,
        // but it executed).
        let non_thread = results.iter().find(|(id, _, _)| id == "call_2").unwrap();
        assert!(non_thread.2.is_error);
        assert!(
            non_thread.2.content.contains("unknown tool"),
            "non-thread tool should have executed, got: {}",
            non_thread.2.content
        );
    }

    /// When DAG construction fails due to duplicate thread names, all thread
    /// calls should receive error results mentioning the duplicate.
    #[tokio::test]
    async fn test_dag_error_duplicate_name() {
        let tool_calls = vec![
            make_tool_call("call_0", "thread", json!({"name": "X", "action": "work"})),
            make_tool_call("call_1", "thread", json!({"name": "X", "action": "work"})),
        ];

        let runtime = test_runtime();
        let client = ModelClient::new_for_test();
        let event_sink = EventSink::none();

        let results = execute_tools_parallel(tool_calls, runtime, client, event_sink, None).await;

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|(_, _, r)| r.is_error));
        assert!(
            results
                .iter()
                .all(|(_, _, r)| r.content.contains("Duplicate thread name 'X'")),
            "expected duplicate name message"
        );
    }

    /// Non-thread tools should still execute when mixed with thread calls that
    /// trigger the DAG error path.  This verifies the `execute_with_dag_error`
    /// fallback runs non-thread tools concurrently.
    #[tokio::test]
    async fn test_non_thread_tools_work_with_dag_error_path() {
        let tool_calls = vec![
            make_tool_call(
                "call_0",
                "thread",
                json!({"name": "A", "action": "work", "threads": ["B"]}),
            ),
            make_tool_call(
                "call_1",
                "thread",
                json!({"name": "B", "action": "work", "threads": ["A"]}),
            ),
            make_tool_call("call_2", "nonexistent_tool", json!({})),
            make_tool_call("call_3", "nonexistent_tool", json!({})),
        ];

        let runtime = test_runtime();
        let client = ModelClient::new_for_test();
        let event_sink = EventSink::none();

        let results = execute_tools_parallel(tool_calls, runtime, client, event_sink, None).await;

        assert_eq!(results.len(), 4);

        // Thread calls → cycle errors.
        let thread_results: Vec<_> = results
            .iter()
            .filter(|(id, _, _)| id == "call_0" || id == "call_1")
            .collect();
        assert_eq!(thread_results.len(), 2);
        assert!(thread_results.iter().all(|(_, _, r)| r.is_error));

        // Non-thread calls → executed (error for unknown tool, but not a DAG error).
        for id in &["call_2", "call_3"] {
            let result = results.iter().find(|(rid, _, _)| rid == id).unwrap();
            assert!(
                result.2.content.contains("unknown tool"),
                "non-thread tool {} should have executed, got: {}",
                id,
                result.2.content
            );
        }
    }

    /// Parse errors for malformed thread calls should be included in results
    /// alongside non-thread tool results, sorted by original index.
    #[tokio::test]
    async fn test_parse_error_included_in_results() {
        // Thread call missing "name" → parse error at index 0.
        // Non-thread call at index 1.
        let tool_calls = vec![
            make_tool_call("call_0", "thread", json!({"action": "work"})),
            make_tool_call("call_1", "nonexistent_tool", json!({})),
        ];

        let runtime = test_runtime();
        let client = ModelClient::new_for_test();
        let event_sink = EventSink::none();

        let results = execute_tools_parallel(tool_calls, runtime, client, event_sink, None).await;

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0, "call_0");
        assert_eq!(results[1].0, "call_1");

        // Parse error for the malformed thread call.
        assert!(results[0].2.is_error);
        assert!(
            results[0].2.content.contains("'name'"),
            "expected missing 'name' error, got: {}",
            results[0].2.content
        );

        // Non-thread tool executed.
        assert!(results[1].2.is_error);
        assert!(results[1].2.content.contains("unknown tool"));
    }
}
