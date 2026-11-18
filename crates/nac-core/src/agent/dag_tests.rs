use super::*;
use crate::agent::preview::{
    key_arg_preview, preview_tool_args, redact_presentation_arguments,
    subagent_presentation_arguments,
};
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
            weight: None,
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

    let (thread_dispatches, other_calls, parse_errors) = partition_tool_calls(tool_calls, &runtime);

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

    let (thread_dispatches, other_calls, parse_errors) = partition_tool_calls(tool_calls, &runtime);

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

    let (thread_dispatches, other_calls, parse_errors) = partition_tool_calls(tool_calls, &runtime);

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

    let (thread_dispatches, other_calls, parse_errors) = partition_tool_calls(tool_calls, &runtime);

    assert!(thread_dispatches.is_empty());
    assert!(other_calls.is_empty());
    assert_eq!(parse_errors.len(), 1);
    assert!(parse_errors[0].3.is_error);
    assert!(parse_errors[0]
        .3
        .content
        .contains("no skills are available"));
}

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

    let (thread_dispatches, other_calls, parse_errors) = partition_tool_calls(tool_calls, &runtime);

    assert_eq!(thread_dispatches.len(), 1);
    assert!(thread_dispatches[0].params.scheduled_skills.is_empty());
    assert!(other_calls.is_empty());
    assert!(parse_errors.is_empty());
}

#[tokio::test]
async fn subagent_preview_provider_failure_and_delay_only_suppress_preview() {
    struct Provider {
        pending: bool,
        active: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        peak: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }
    impl nac_contracts::CommandEnvironmentProvider for Provider {
        fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
            panic!("presentation must not fetch a command environment")
        }
        fn redaction_snapshot(&self) -> anyhow::Result<nac_contracts::CommandEnvironmentSnapshot> {
            if self.pending {
                use std::sync::atomic::Ordering;
                let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
                self.peak.fetch_max(active, Ordering::SeqCst);
                std::thread::sleep(std::time::Duration::from_millis(500));
                self.active.fetch_sub(1, Ordering::SeqCst);
            }
            Err(anyhow::anyhow!("unavailable"))
        }
        fn worker_environment(&self) -> nac_contracts::WorkerEnvironment {
            Default::default()
        }
    }
    let active = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let peak = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let provider = |pending| {
        std::sync::Arc::new(Provider {
            pending,
            active: active.clone(),
            peak: peak.clone(),
        })
    };
    let mut runtime = test_runtime();
    runtime.command_environment = Some(provider(false));
    assert!(
        subagent_presentation_arguments(&runtime, r#"{"description":"secret"}"#)
            .await
            .is_none()
    );
    runtime.command_environment = Some(provider(true));
    let started = std::time::Instant::now();
    assert!(
        subagent_presentation_arguments(&runtime, r#"{"description":"secret"}"#)
            .await
            .is_none()
    );
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
    let attempts =
        (0..20).map(|_| subagent_presentation_arguments(&runtime, r#"{"description":"secret"}"#));
    assert!(futures_util::future::join_all(attempts)
        .await
        .into_iter()
        .all(|result| result.is_none()));
    let peak = peak.load(std::sync::atomic::Ordering::SeqCst);
    assert!((1..=4).contains(&peak));
}

#[test]
fn subagent_summary_survives_a_long_argument_before_the_description() {
    let raw = format!(
        r#"{{"prompt":"{}","description":"Review store"}}"#,
        "x".repeat(12_000)
    );
    let truncated = tool_args_detail(&raw);
    assert!(key_arg_preview("subagent", Some(&truncated), "").is_empty());
    let safe =
        redact_presentation_arguments(&raw, &nac_contracts::CommandEnvironmentSnapshot::empty())
            .unwrap();
    let summary = key_arg_preview("subagent", Some(&safe), &safe);
    assert_eq!(summary, "Review store");
    assert!(tool_args_detail(&safe).len() < safe.len());
}

#[test]
fn subagent_presentation_redacts_exact_values_before_preview_truncation() {
    let exact = "opaque-value-with-quote-\"-and-backslash-\\-123456";
    let mut snapshot = nac_contracts::CommandEnvironmentSnapshot::empty();
    snapshot.extend_redactions([exact.to_string()]);
    let description = format!("{}{}", "x".repeat(110), exact);
    let raw =
        json!({"description": description, "prompt": "Bearer sk-abcdefghijk-secret"}).to_string();
    let safe = redact_presentation_arguments(&raw, &snapshot).unwrap();
    assert!(!safe.contains(exact));
    let event = AgentEvent::ToolCallStarted {
        thread_name: None,
        call_id: "call".into(),
        name: "subagent".into(),
        args_preview: preview_tool_args("subagent", &safe),
        key_arg_preview: None,
        args_detail: Some(tool_args_detail(&safe)),
        delegation_intent: None,
        delegation_summary_verified: false,
    };
    let event = crate::events::sanitize_external_agent_event(event).unwrap();
    let serialized = serde_json::to_string(&event).unwrap();
    assert!(!serialized.contains("opaque-value"));
    assert!(!serialized.contains("sk-abcdefghijk-secret"));
    let generic = json!({"description": "Bearer sk-abcdefghijk-secret"}).to_string();
    let safe_generic = redact_presentation_arguments(&generic, &snapshot).unwrap();
    let event = AgentEvent::ToolCallStarted {
        thread_name: None,
        call_id: "generic".into(),
        name: "subagent".into(),
        args_preview: preview_tool_args("subagent", &safe_generic),
        key_arg_preview: None,
        args_detail: Some(tool_args_detail(&safe_generic)),
        delegation_intent: None,
        delegation_summary_verified: false,
    };
    let encoded =
        serde_json::to_string(&crate::events::sanitize_external_agent_event(event).unwrap())
            .unwrap();
    assert!(!encoded.contains("sk-abcdefghijk-secret"));
    assert!(redact_presentation_arguments("{invalid", &snapshot).is_none());
}

#[tokio::test]
async fn captured_managed_exa_is_redacted_without_web_capability() {
    const MARKER: &str = "NAC_TEST_MANAGED_PREVIEW_CHILD";
    const SECRET: &str = "opaque-managed-exa-secret";
    if std::env::var_os(MARKER).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "agent::dag::tests::captured_managed_exa_is_redacted_without_web_capability",
                "--nocapture",
            ])
            .env(MARKER, "1")
            .env("EXA_API_KEY", SECRET)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "child failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!String::from_utf8_lossy(&output.stdout).contains(SECRET));
        return;
    }
    struct ManagedProvider;
    impl nac_contracts::CommandEnvironmentProvider for ManagedProvider {
        fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
            panic!("presentation must not fetch a command environment")
        }
        fn redaction_snapshot(&self) -> anyhow::Result<nac_contracts::CommandEnvironmentSnapshot> {
            Ok(nac_contracts::CommandEnvironmentSnapshot::empty())
        }
        fn worker_environment(&self) -> nac_contracts::WorkerEnvironment {
            Default::default()
        }
    }
    crate::managed_native_credentials::capture_managed_native_credentials_from_environment()
        .unwrap();
    assert!(std::env::var_os("EXA_API_KEY").is_none());
    let mut runtime = test_runtime();
    runtime.command_environment = Some(std::sync::Arc::new(ManagedProvider));
    assert!(runtime.web_credential.is_none());
    let raw = json!({"description": format!("Review {SECRET}"), "prompt": SECRET}).to_string();
    let safe = subagent_presentation_arguments(&runtime, &raw)
        .await
        .unwrap();
    assert!(!safe.contains(SECRET));
    let summary = key_arg_preview("subagent", Some(&safe), &safe);
    assert!(!summary.contains(SECRET));
}
