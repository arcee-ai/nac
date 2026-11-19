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

fn indexed(index: usize, name: &str) -> IndexedToolCall {
    (
        index,
        format!("call-{index}"),
        name.to_string(),
        "{}".to_string(),
    )
}

#[test]
fn direct_admission_groups_reads_and_barriers_mutations_shell_and_unknowns() {
    let groups = admission_groups(vec![
        indexed(0, "read"),
        indexed(1, "grep"),
        indexed(2, "write"),
        indexed(3, "glob"),
        indexed(4, "exec_command"),
        indexed(5, "future_tool"),
        indexed(6, "read_command_output"),
    ]);
    let names = groups
        .iter()
        .map(|group| group.iter().map(|call| call.2.as_str()).collect::<Vec<_>>())
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        vec![
            vec!["read", "grep"],
            vec!["write"],
            vec!["glob"],
            vec!["exec_command"],
            vec!["future_tool"],
            vec!["read_command_output"],
        ]
    );
}

#[tokio::test]
async fn reads_overlap_and_exclusive_calls_wait_for_prior_groups_in_model_order() {
    use crate::permissions::{
        PermissionBackend, PermissionBroker, PermissionEffect, PermissionReply, PermissionRule,
    };
    let root =
        std::env::temp_dir().join(format!("nac-admission-interleave-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("input.txt"), "input").unwrap();
    let store = root.join("store.db");
    crate::store::initialize(&store).unwrap();
    crate::store::insert_test_session(&store, "session");
    let broker = Arc::new(PermissionBroker::new(
        store.clone(),
        "session".into(),
        PermissionBackend::Local,
        0,
        ["read", "glob", "edit", "execute"]
            .map(|action| PermissionRule::new(action, "*", PermissionEffect::Ask)),
    ));
    let bus = crate::events::SessionEventBus::new(Some("session".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let mut runtime = test_runtime();
    runtime.workspace_cwd = root.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
    runtime.store_path = store;
    runtime.session_id = Some("session".into());
    runtime.permission_broker = Some(broker.clone());
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let task = tokio::spawn(execute_tools_parallel(
        vec![
            make_tool_call("read", "read", json!({"path":"input.txt"})),
            make_tool_call("glob", "glob", json!({"pattern":"*.txt"})),
            make_tool_call(
                "write",
                "write",
                json!({"path":"output.txt","content":"written","expected_revision":null}),
            ),
            make_tool_call("shell", "exec_command", json!({"cmd":"printf shell"})),
        ],
        runtime,
        ModelClient::new_for_test(),
        EventSink::channel(events_tx),
        None,
        true,
    ));
    let stage = std::sync::atomic::AtomicUsize::new(0);
    let outcome = tokio::time::timeout(Duration::from_secs(10), async {
        while broker.pending().len() != 2 {
            tokio::task::yield_now().await;
        }
        stage.store(1, std::sync::atomic::Ordering::Relaxed);
        let pending = broker.pending();
        assert_eq!(
            pending
                .iter()
                .map(|request| request.tool.as_str())
                .collect::<std::collections::HashSet<_>>(),
            std::collections::HashSet::from(["read", "glob"])
        );
        let read = pending
            .iter()
            .find(|request| request.tool == "read")
            .unwrap();
        broker.reply(&read.id, PermissionReply::Once).unwrap();
        loop {
            if let Some(AgentEvent::ToolCallFinished { call_id, .. }) = events_rx.recv().await {
                if call_id == "read" {
                    break;
                }
            }
        }
        stage.store(2, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(broker.pending().len(), 1);
        assert!(!task.is_finished());
        let glob = broker.pending().pop().unwrap();
        assert_eq!(glob.tool, "glob");
        broker.reply(&glob.id, PermissionReply::Once).unwrap();
        loop {
            if let Some(request) = broker
                .pending()
                .into_iter()
                .find(|request| request.tool == "write")
            {
                assert!(!root.join("output.txt").exists());
                broker.reply(&request.id, PermissionReply::Once).unwrap();
                break;
            }
            tokio::task::yield_now().await;
        }
        stage.store(3, std::sync::atomic::Ordering::Relaxed);
        loop {
            if task.is_finished() {
                break;
            }
            if let Some(request) = broker
                .pending()
                .into_iter()
                .find(|request| request.tool == "exec_command")
            {
                broker.reply(&request.id, PermissionReply::Once).unwrap();
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await;
    assert!(
        outcome.is_ok(),
        "admission stalled at stage {}, pending {:?}, task finished {}",
        stage.load(std::sync::atomic::Ordering::Relaxed),
        broker.pending(),
        task.is_finished()
    );
    let results = task.await.unwrap();
    let mut write_finished = false;
    let mut shell_started_after_write = false;
    while let Ok(event) = events_rx.try_recv() {
        match event {
            AgentEvent::ToolCallFinished { call_id, .. } if call_id == "write" => {
                write_finished = true
            }
            AgentEvent::ToolCallStarted { call_id, .. } if call_id == "shell" => {
                shell_started_after_write = write_finished;
            }
            _ => {}
        }
    }
    assert!(
        shell_started_after_write,
        "shell started before the write finished"
    );
    assert_eq!(
        results
            .iter()
            .map(|result| result.0.as_str())
            .collect::<Vec<_>>(),
        vec!["read", "glob", "write", "shell"]
    );
    assert!(
        results.iter().all(|result| !result.2.is_error),
        "{results:?}"
    );
    assert!(results[3].2.content.to_string().contains("shell"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn timed_out_exclusive_call_releases_the_following_admission_group() {
    let root = std::env::temp_dir().join(format!(
        "nac-tool-deadline-admission-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("ready.txt"), "ready").unwrap();
    let mut runtime = test_runtime();
    runtime.workspace_cwd = root.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
    let results = execute_tools_parallel(
        vec![
            make_tool_call(
                "slow",
                "exec_command",
                json!({"cmd":"sleep 30","_nac":{"timeout_ms":10}}),
            ),
            make_tool_call("fast", "read", json!({"path":"ready.txt"})),
        ],
        runtime,
        ModelClient::new_for_test(),
        EventSink::none(),
        None,
        true,
    )
    .await;

    assert_eq!(results.len(), 2);
    assert!(
        results[0].2.content.to_string().contains("timed_out"),
        "{}",
        results[0].2.content
    );
    assert!(!results[1].2.is_error, "{}", results[1].2.content);
    let _ = std::fs::remove_dir_all(root);
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

    let results =
        execute_tools_parallel(tool_calls, runtime, client, event_sink, None, false).await;

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

    let results =
        execute_tools_parallel(tool_calls, runtime, client, event_sink, None, false).await;

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

    let results =
        execute_tools_parallel(tool_calls, runtime, client, event_sink, None, false).await;

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

    let results =
        execute_tools_parallel(tool_calls, runtime, client, event_sink, None, false).await;

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

    let results =
        execute_tools_parallel(tool_calls, runtime, client, event_sink, None, false).await;

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

    let results =
        execute_tools_parallel(tool_calls, runtime, client, event_sink, None, false).await;

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

#[tokio::test]
async fn control_tools_report_duration_only_when_they_ran() {
    let root = std::env::temp_dir().join(format!(
        "nac-control-tool-duration-{}",
        uuid::Uuid::new_v4()
    ));
    let mut runtime = test_runtime();
    runtime.store_path = root.join("store.db");
    crate::store::initialize(&runtime.store_path).unwrap();
    crate::store::insert_test_session(&runtime.store_path, "test-session");
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();

    execute_tools_parallel(
        vec![
            make_tool_call("listed", "workset_list", json!({})),
            make_tool_call("rejected", "workset_read", json!({})),
        ],
        runtime,
        ModelClient::new_for_test(),
        EventSink::channel(events_tx),
        None,
        false,
    )
    .await;

    let mut finished = Vec::new();
    while let Ok(event) = events_rx.try_recv() {
        if let AgentEvent::ToolCallFinished {
            call_id,
            is_error,
            execution_duration_ms,
            ..
        } = event
        {
            finished.push((call_id, is_error, execution_duration_ms.is_some()));
        }
    }
    finished.sort();
    assert_eq!(
        finished,
        vec![
            ("listed".to_string(), false, true),
            ("rejected".to_string(), true, false),
        ]
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn slow_subagent_preview_keeps_mixed_admission_order() {
    struct SlowProvider;
    impl nac_contracts::CommandEnvironmentProvider for SlowProvider {
        fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
            panic!("preview must not refresh command environment")
        }
        fn redaction_snapshot(&self) -> anyhow::Result<nac_contracts::CommandEnvironmentSnapshot> {
            std::thread::sleep(std::time::Duration::from_millis(500));
            Ok(nac_contracts::CommandEnvironmentSnapshot::empty())
        }
    }
    let root = std::env::temp_dir().join(format!("nac-preview-admission-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("input.txt"), "content").unwrap();
    let mut runtime = test_runtime();
    runtime.workspace_cwd = root.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
    runtime.command_environment = Some(Arc::new(SlowProvider));
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    let sink = crate::events::EventSink::channel(sender);
    runtime.event_sink = sink.clone();
    let calls = vec![
        make_tool_call("read-before", "read", json!({"path":"input.txt"})),
        make_tool_call(
            "child",
            "subagent",
            json!({"profile":"general", "description":"RAW_SECRET", "prompt":"work", "child_session_id":null, "background":true}),
        ),
        make_tool_call("read-after", "read", json!({"path":"input.txt"})),
    ];
    let started = std::time::Instant::now();
    let results = execute_tools_parallel(
        calls,
        runtime,
        ModelClient::new_for_test(),
        sink,
        None,
        true,
    )
    .await;
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
    assert_eq!(
        results.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(),
        ["read-before", "child", "read-after"]
    );
    let mut starts = Vec::new();
    while let Ok(event) = receiver.try_recv() {
        if let AgentEvent::ToolCallStarted {
            call_id,
            delegation_intent: None,
            delegation_summary_verified: false,
            ..
        } = &event
        {
            starts.push(call_id.clone());
        }
        assert!(!serde_json::to_string(&event)
            .unwrap()
            .contains("RAW_SECRET"));
    }
    assert_eq!(starts, ["read-before", "child", "read-after"]);
    let _ = std::fs::remove_dir_all(root);
}
