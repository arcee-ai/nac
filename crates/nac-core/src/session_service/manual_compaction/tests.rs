use super::super::tests::{
    compaction_response, test_active_service, test_agent, test_agent_with_compaction_threshold,
    test_compaction_service, test_store_path,
};
use super::*;
use crate::events::CompactionSkipReason;
use crate::model::ModelClient;

fn persisted_response_state(
    store_path: &std::path::Path,
    session_id: &str,
) -> (
    String,
    Option<i64>,
    Option<i64>,
    Option<String>,
    Option<String>,
) {
    crate::store::open_runtime_connection(store_path)
            .unwrap()
            .query_row(
                "SELECT messages_json, last_response_duration_ms, previous_response_duration_ms, response_durations_ms_json, token_usages_json FROM sessions WHERE session_id = ?1",
                [session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .unwrap()
}

#[tokio::test]
async fn manual_compaction_and_run_admission_are_mutually_exclusive() {
    let (parts, store_path) = test_active_service("compaction_conflicts", "conflict-session");
    let run = parts.service.try_begin_run(None, "ordinary run").unwrap();
    let error = match parts.service.try_compact() {
        Ok(_) => panic!("run should block manual compaction"),
        Err(error) => error,
    };
    assert!(matches!(
        error,
        SessionCompactionAdmissionError::Busy {
            active_operation: ActiveSessionOperationSnapshot::Run { run: active }
        } if active == run
    ));
    let finishing = parts.service.mark_run_finishing(&run.run_id).unwrap();
    assert_eq!(finishing.snapshot.run_id, run.run_id);
    assert!(finishing.snapshot.submitted_user_message.is_none());
    parts.service.clear_finished_run(&run.run_id);

    let mut events = parts.service.subscribe_events();
    let client = parts.service.connect_client();
    let handle = client.try_compact().unwrap();
    let active = parts.service.active_compaction().unwrap();
    assert_eq!(active.compaction_id, handle.compaction_id);
    assert_eq!(active.client_id.as_ref(), Some(client.client_id()));
    assert!(matches!(
        parts.service.active_operation(),
        Some(ActiveSessionOperationSnapshot::ManualCompaction { compaction })
            if compaction == active
    ));
    assert!(parts.service.has_active_operation());
    assert!(matches!(
        parts
            .service
            .try_submit_prompt("blocked prompt".to_string()),
        Err(SessionSubmitError::ExternalBusy {
            session_id: SessionOperationBusy::Local {
                active_operation:
                    ActiveSessionOperationSnapshot::ManualCompaction { compaction },
                ..
            },
        }) if compaction.compaction_id == active.compaction_id
    ));
    assert!(matches!(
        parts.service.try_compact(),
        Err(SessionCompactionAdmissionError::Busy {
            active_operation: ActiveSessionOperationSnapshot::ManualCompaction { .. }
        })
    ));

    assert!(matches!(
        handle.wait().await.unwrap(),
        SessionCompactionResult::Unchanged {
            reason: CompactionSkipReason::NoEligibleBoundary,
            ..
        }
    ));
    assert!(!parts.service.has_active_operation());
    assert!(parts.service.active_run().is_none());
    assert!(parts.service.active_compaction().is_none());
    let published = std::iter::from_fn(|| events.try_recv().ok()).collect::<Vec<_>>();
    assert_eq!(published.len(), 2);
    assert!(published.iter().all(|envelope| {
        envelope.client_id.as_ref() == Some(client.client_id()) && envelope.run_id.is_none()
    }));
    assert!(matches!(
        published[0].event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorCompactionStarted { .. }
        }
    ));
    assert!(matches!(
        published[1].event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorCompactionSkipped {
                cause: CompactionSkipReason::NoEligibleBoundary,
                ..
            }
        }
    ));
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn manual_compaction_admission_coordinates_lease_and_config_revision() {
    let (parts, store_path) = test_active_service("compaction_lease", "lease-session");
    let external =
        sessions::SessionOperationLease::try_acquire(&store_path, "lease-session").unwrap();
    assert!(matches!(
        parts.service.try_compact(),
        Err(SessionCompactionAdmissionError::ExternalBusy { session_id })
            if session_id == "lease-session"
    ));
    assert!(!parts.service.has_active_operation());
    drop(external);

    let supplied =
        sessions::SessionOperationLease::try_acquire(&store_path, "lease-session").unwrap();
    let client = parts.service.connect_client();
    let handle = client.try_compact_with_lease(supplied).unwrap();
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&store_path, "lease-session"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert!(matches!(
        handle.wait().await.unwrap(),
        SessionCompactionResult::Unchanged { .. }
    ));
    let released =
        sessions::SessionOperationLease::try_acquire(&store_path, "lease-session").unwrap();
    drop(released);

    let mut persisted = sessions::load_session(&store_path, "lease-session").unwrap();
    persisted.model = "externally-updated".to_string();
    sessions::update_session_config(&store_path, &persisted).unwrap();
    let supplied =
        sessions::SessionOperationLease::try_acquire(&store_path, "lease-session").unwrap();
    assert!(matches!(
        parts.service.try_compact_with_lease(supplied),
        Err(SessionCompactionAdmissionError::Coordination {
            message: SessionCoordinationError::StaleConfiguration { .. },
        })
    ));
    assert!(!parts.service.has_active_operation());
    let released =
        sessions::SessionOperationLease::try_acquire(&store_path, "lease-session").unwrap();
    drop(released);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn checkpoint_refresh_contention_does_not_establish_operation_or_retain_lease() {
    let (parts, store_path) = test_active_service("checkpoint_refresh_busy", "refresh-busy");
    let agent = parts.service.agent.lock().await;

    assert!(matches!(
        parts
            .service
            .try_submit_prompt("must not start".to_string()),
        Err(SessionSubmitError::Coordination {
            message: SessionCoordinationError::LocalAgentBusy,
        })
    ));
    assert!(!parts.service.has_active_operation());
    let released =
        sessions::SessionOperationLease::try_acquire(&store_path, "refresh-busy").unwrap();
    drop(released);

    assert!(matches!(
        parts.service.try_compact(),
        Err(SessionCompactionAdmissionError::Coordination {
            message: SessionCoordinationError::LocalAgentBusy,
        })
    ));
    assert!(!parts.service.has_active_operation());
    let released =
        sessions::SessionOperationLease::try_acquire(&store_path, "refresh-busy").unwrap();
    drop(released);

    drop(agent);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[test]
fn supplied_leases_are_rejected_for_the_wrong_session_or_store() {
    let (parts, store_path) = test_active_service("lease_identity", "target-session");

    let wrong_session =
        sessions::SessionOperationLease::try_acquire(&store_path, "other-session").unwrap();
    assert!(matches!(
        parts.service.try_compact_with_lease(wrong_session),
        Err(SessionCompactionAdmissionError::Coordination {
            message: SessionCoordinationError::InvalidLease,
        })
    ));
    assert!(!parts.service.has_active_operation());

    let wrong_run_session =
        sessions::SessionOperationLease::try_acquire(&store_path, "other-run-session").unwrap();
    let client = parts.service.connect_client();
    assert!(matches!(
        parts.service.try_submit_prompt_for_client_with_lease(
            client.client_id().clone(),
            "must not start".to_string(),
            wrong_run_session,
        ),
        Err(SessionSubmitError::Coordination {
            message: SessionCoordinationError::InvalidLease,
        })
    ));
    assert!(!parts.service.has_active_operation());

    let other_store = test_store_path("lease_identity_other_store");
    crate::store::initialize(&other_store).unwrap();
    let wrong_store_lease =
        sessions::SessionOperationLease::try_acquire(&other_store, "target-session").unwrap();
    assert!(matches!(
        parts.service.try_compact_with_lease(wrong_store_lease),
        Err(SessionCompactionAdmissionError::Coordination {
            message: SessionCoordinationError::InvalidLease,
        })
    ));
    assert!(!parts.service.has_active_operation());

    let target =
        sessions::SessionOperationLease::try_acquire(&store_path, "target-session").unwrap();
    drop(target);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    let _ = std::fs::remove_dir_all(other_store.parent().unwrap());
}

#[test]
fn coordination_display_does_not_expose_store_details() {
    let canary = "/private/canary/session-store.db";
    let error =
        SessionCoordinationError::store(format!("failed to open {canary}: permission denied"));
    assert!(matches!(error, SessionCoordinationError::Store { .. }));
    assert_eq!(error.to_string(), "session operation coordination failed");
    assert!(!String::from(&error).contains(canary));
}

async fn assert_two_service_admissions_refresh_external_checkpoint(
    label: &str,
    supplied_leases: bool,
) {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let server = ScriptedServer::start(vec![
        ScriptedResponse::json(
            "200 OK",
            compaction_response("durable cross-process summary"),
        ),
        ScriptedResponse::json("200 OK", compaction_response("ordinary response")),
        ScriptedResponse::json(
            "200 OK",
            compaction_response("continued cross-process summary"),
        ),
    ]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = format!("{label}-session");
    let (parts_a, store_path) = test_compaction_service(label, &session_id, client.clone());

    // Construct B before A commits so its in-memory Agent has no checkpoint.
    let snapshot_b = sessions::load_session(&store_path, &session_id).unwrap();
    let mut agent_b = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    agent_b.messages = snapshot_b.messages.clone();
    let parts_b = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent: agent_b,
        client,
        session: OrchestratorSession {
            session_id: session_id.clone(),
            store_path: store_path.clone(),
            snapshot: snapshot_b,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(crate::workspace::GitTarget::local("/repo")),
        resume_base_cwd: std::path::PathBuf::from("/repo"),
    });

    assert!(matches!(
        parts_a.service.try_compact().unwrap().wait().await.unwrap(),
        SessionCompactionResult::Compacted { .. }
    ));
    let first_checkpoint =
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            &session_id,
        )
        .unwrap()
        .into_iter()
        .next()
        .unwrap();

    let mut events = parts_b.service.subscribe_events();
    let run = if supplied_leases {
        let lease = sessions::SessionOperationLease::try_acquire(&store_path, &session_id).unwrap();
        parts_b
            .service
            .try_submit_prompt_for_client_with_lease(
                SessionClientId::new(),
                "continue after external compaction".to_string(),
                lease,
            )
            .unwrap()
    } else {
        parts_b
            .service
            .try_submit_prompt("continue after external compaction".to_string())
            .unwrap()
    };
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let envelope = events.recv().await.unwrap();
            match envelope.event {
                SessionEvent::RunCompleted { .. }
                    if envelope.run_id.as_ref() == Some(&run.run_id) =>
                {
                    break;
                }
                SessionEvent::RunFailed { message }
                    if envelope.run_id.as_ref() == Some(&run.run_id) =>
                {
                    panic!("ordinary run failed: {message}");
                }
                _ => {}
            }
        }
    })
    .await
    .expect("ordinary run should complete");
    while parts_b.service.has_active_operation() {
        tokio::task::yield_now().await;
    }

    let manual = if supplied_leases {
        let lease = sessions::SessionOperationLease::try_acquire(&store_path, &session_id).unwrap();
        parts_b.service.try_compact_with_lease(lease).unwrap()
    } else {
        parts_b.service.try_compact().unwrap()
    };
    assert!(matches!(
        manual.wait().await.unwrap(),
        SessionCompactionResult::Compacted { .. }
    ));

    let requests = server.finish();
    assert_eq!(requests.len(), 3);
    let ordinary_request = String::from_utf8_lossy(&requests[1].body);
    assert!(ordinary_request.contains("durable cross-process summary"));
    assert!(ordinary_request.contains("continue after external compaction"));
    assert!(!ordinary_request.contains("old request"));
    assert!(!ordinary_request.contains("old answer"));
    let manual_request = String::from_utf8_lossy(&requests[2].body);
    assert!(manual_request.contains("durable cross-process summary"));
    assert!(!manual_request.contains("old request"));
    assert!(!manual_request.contains("old answer"));

    let checkpoints =
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            &session_id,
        )
        .unwrap();
    assert_eq!(checkpoints.len(), 2);
    assert_eq!(
        checkpoints[0].previous_checkpoint_id,
        Some(first_checkpoint.id)
    );
    assert_eq!(checkpoints[1].id, first_checkpoint.id);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn stale_two_service_checkpoint_is_refreshed_for_direct_and_supplied_admissions() {
    assert_two_service_admissions_refresh_external_checkpoint("checkpoint_admission_direct", false)
        .await;
    assert_two_service_admissions_refresh_external_checkpoint(
        "checkpoint_admission_supplied",
        true,
    )
    .await;
}

#[tokio::test]
async fn sequential_run_admission_preserves_provider_context_sample_for_threshold() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let large_first_response = "large response ".repeat(10_000);
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", compaction_response(&large_first_response)),
        ScriptedResponse::json("200 OK", compaction_response("second response")),
    ]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "sequential-context-sample";
    let store_path = test_store_path("sequential_context_sample");
    let mut agent = test_agent_with_compaction_threshold(
        client.clone(),
        store_path.clone(),
        Some(session_id.to_string()),
        Some(50_000),
    );
    agent.messages = vec![Message::System {
        content: "policy".to_string(),
    }];
    let snapshot = sessions::new_snapshot(
        session_id.to_string(),
        std::path::PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        std::collections::BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession {
            session_id: session_id.to_string(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(crate::workspace::GitTarget::local("/repo")),
        resume_base_cwd: std::path::PathBuf::from("/repo"),
    });
    let mut events = parts.service.subscribe_events();

    for prompt in ["first prompt", "second prompt"] {
        let run = parts.service.try_submit_prompt(prompt.to_string()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let envelope = events.recv().await.unwrap();
                match envelope.event {
                    SessionEvent::RunCompleted { .. }
                        if envelope.run_id.as_ref() == Some(&run.run_id) =>
                    {
                        break;
                    }
                    SessionEvent::RunFailed { message }
                        if envelope.run_id.as_ref() == Some(&run.run_id) =>
                    {
                        panic!("sequential run failed: {message}");
                    }
                    _ => {}
                }
            }
        })
        .await
        .expect("sequential run should complete");
        while parts.service.has_active_operation() {
            tokio::task::yield_now().await;
        }
    }

    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    assert!(requests.iter().all(|request| {
        serde_json::from_slice::<serde_json::Value>(&request.body).unwrap()["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
    }));
    let published = parts.service.recent_events(None, 100);
    // The first request is below threshold, then returns a response large enough
    // to push a fresh serialized estimate over it. Keeping the provider's sampled
    // total (39) across admission means the second request also stays below.
    assert_eq!(
        published
            .iter()
            .filter(|envelope| matches!(
                envelope.event,
                SessionEvent::Agent {
                    event: AgentEvent::OrchestratorCompactionStarted {
                        reason: CompactionReason::Auto,
                        ..
                    },
                }
            ))
            .count(),
        0
    );
    assert!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            session_id,
        )
        .unwrap()
        .is_empty()
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn manual_compaction_success_preserves_snapshot_and_emits_context_before_resolution() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    use std::sync::mpsc as std_mpsc;

    let (observed_tx, observed_rx) = std_mpsc::channel();
    let (release_tx, release_rx) = std_mpsc::channel();
    let server = ScriptedServer::start_observed(
        vec![ScriptedResponse::json(
            "200 OK",
            compaction_response("durable summary"),
        )],
        move |_index, _request| {
            observed_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        },
    );
    let (parts, store_path) = test_compaction_service(
        "compaction_success",
        "success-session",
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let persisted_before = sessions::load_session(&store_path, "success-session").unwrap();
    let persisted_before_state = persisted_response_state(&store_path, "success-session");
    let messages_before = {
        let agent = parts.service.agent.lock().await;
        serde_json::to_vec(&agent.messages).unwrap()
    };
    let usage_before = parts.service.agent.lock().await.last_usage.clone();
    let steering = crate::store::queue_thread_steering(
        &store_path,
        "success-session",
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        "stale-dispatch",
        "leave this untouched",
    )
    .unwrap();
    let mut events = parts.service.subscribe_events();
    let client = parts.service.connect_client();
    let handle = client.try_compact().unwrap();
    let id = handle.compaction_id;

    tokio::task::spawn_blocking(move || observed_rx.recv().unwrap())
        .await
        .unwrap();
    let frontend = parts.service.frontend_snapshot().await.unwrap();
    assert_eq!(frontend.active_run, None);
    assert_eq!(
        frontend
            .active_compaction
            .as_ref()
            .map(|active| active.compaction_id),
        Some(id)
    );
    assert_eq!(
        serde_json::to_vec(&frontend.messages).unwrap(),
        serde_json::to_vec(&persisted_before.messages).unwrap()
    );
    assert_eq!(
        frontend.response_timing,
        ResponseTimingSnapshot::from(&persisted_before)
    );
    release_tx.send(()).unwrap();

    let result = handle.wait().await.unwrap();
    assert!(matches!(
        result,
        SessionCompactionResult::Compacted { compaction_id: cmp_id, .. } if cmp_id == id
    ));
    assert!(!parts.service.has_active_operation());
    let lease =
        sessions::SessionOperationLease::try_acquire(&store_path, "success-session").unwrap();
    drop(lease);

    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    let request: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(request.get("tools").is_none());
    // Messages and timing are preserved — compaction doesn't touch the
    // write-once blob or response durations.
    let persisted_after = persisted_response_state(&store_path, "success-session");
    assert_eq!(persisted_after.0, persisted_before_state.0); // messages_json
    assert_eq!(persisted_after.1, persisted_before_state.1); // last_response_duration_ms
    assert_eq!(persisted_after.2, persisted_before_state.2); // previous_response_duration_ms
    assert_eq!(persisted_after.3, persisted_before_state.3); // response_durations_ms_json
                                                             // token_usages_json now includes the compaction's projected context
                                                             // as unattributed_usage (the context gauge override).
    assert_ne!(persisted_after.4, persisted_before_state.4);
    assert!(persisted_after
        .4
        .as_ref()
        .unwrap()
        .contains("unattributed_usage"));
    // The in-memory snapshot's unattributed_token_usage is now set with
    // the projected context. Messages and other fields are preserved.
    let snapshot_after = parts
        .service
        .session_snapshot
        .lock()
        .await
        .as_ref()
        .unwrap()
        .clone();
    assert_eq!(
        serde_json::to_vec(&snapshot_after.messages).unwrap(),
        serde_json::to_vec(&persisted_before.messages).unwrap()
    );
    assert_eq!(
        snapshot_after.last_response_duration_ms,
        persisted_before.last_response_duration_ms
    );
    let unattributed = snapshot_after.unattributed_token_usage.as_ref().unwrap();
    assert!(unattributed.orchestrator_context_tokens > 0);
    let agent = parts.service.agent.lock().await;
    assert_eq!(
        serde_json::to_vec(&agent.messages).unwrap(),
        messages_before
    );
    assert_eq!(agent.last_usage, usage_before);
    drop(agent);
    assert_eq!(
        crate::store::list_thread_steering(&store_path, "success-session").unwrap(),
        vec![steering]
    );
    assert_eq!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &store_path,
            "success-session"
        )
        .unwrap()
        .len(),
        1
    );

    let published = std::iter::from_fn(|| events.try_recv().ok()).collect::<Vec<_>>();
    assert_eq!(published.len(), 3);
    assert!(published.iter().all(|envelope| {
        envelope.client_id.as_ref() == Some(client.client_id()) && envelope.run_id.is_none()
    }));
    assert!(matches!(
        published[0].event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorCompactionStarted {
                compaction_id,
                reason: CompactionReason::Manual,
            }
        } if compaction_id == id
    ));
    assert!(matches!(
        published[1].event,
        SessionEvent::Agent {
            event: AgentEvent::TokenUsageUpdated { .. }
        }
    ));
    assert!(matches!(
        published[2].event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorCompactionCompleted {
                compaction_id,
                reason: CompactionReason::Manual,
            }
        } if compaction_id == id
    ));
    assert!(!published.iter().any(|envelope| matches!(
        envelope.event,
        SessionEvent::RunStarted { .. }
            | SessionEvent::RunCompleted { .. }
            | SessionEvent::RunFailed { .. }
            | SessionEvent::SnapshotSaved { .. }
    )));
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn manual_compaction_failure_and_cancellation_emit_terminal_and_clear_operation() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    use std::sync::mpsc as std_mpsc;

    let failed_server = ScriptedServer::start(vec![ScriptedResponse::json(
        "500 Internal Server Error",
        "{}",
    )]);
    let (failed_parts, failed_store) = test_compaction_service(
        "compaction_failure",
        "failure-session",
        ModelClient::new_for_test_server(failed_server.base_url.clone()),
    );
    let mut failed_events = failed_parts.service.subscribe_events();
    let failed_handle = failed_parts.service.try_compact().unwrap();
    let failed_id = failed_handle.compaction_id;
    assert!(matches!(
        failed_handle.wait().await,
        Err(SessionCompactionError::Failed {
            compaction_id,
            failure: CompactionFailure::SummaryRequestFailed,
            ..
        }) if compaction_id == failed_id
    ));
    assert!(!failed_parts.service.has_active_operation());
    assert_eq!(failed_server.finish().len(), 1);
    let failed_published = std::iter::from_fn(|| failed_events.try_recv().ok()).collect::<Vec<_>>();
    assert_eq!(failed_published.len(), 2);
    assert!(matches!(
        failed_published[1].event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorCompactionFailed {
                compaction_id,
                failure: CompactionFailure::SummaryRequestFailed,
                ..
            }
        } if compaction_id == failed_id
    ));

    let (observed_tx, observed_rx) = std_mpsc::channel();
    let (release_tx, release_rx) = std_mpsc::channel();
    let cancel_server = ScriptedServer::start_observed(
        vec![ScriptedResponse::json(
            "200 OK",
            compaction_response("must not commit"),
        )],
        move |_index, _request| {
            observed_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        },
    );
    let (cancel_parts, cancel_store) = test_compaction_service(
        "compaction_cancel",
        "cancel-session",
        ModelClient::new_for_test_server(cancel_server.base_url.clone()),
    );
    let persisted_before = sessions::load_session(&cancel_store, "cancel-session").unwrap();
    let mut cancel_events = cancel_parts.service.subscribe_events();
    let cancel_handle = cancel_parts.service.try_compact().unwrap();
    let cancel_id = cancel_handle.compaction_id;
    tokio::task::spawn_blocking(move || observed_rx.recv().unwrap())
        .await
        .unwrap();
    cancel_handle.abort();
    assert!(matches!(
        cancel_handle.wait().await,
        Err(SessionCompactionError::Failed {
            compaction_id,
            failure: CompactionFailure::Cancelled,
            ..
        }) if compaction_id == cancel_id
    ));
    assert!(!cancel_parts.service.has_active_operation());
    let lease =
        sessions::SessionOperationLease::try_acquire(&cancel_store, "cancel-session").unwrap();
    drop(lease);
    release_tx.send(()).unwrap();
    assert_eq!(cancel_server.finish().len(), 1);
    assert!(
        crate::store::orchestrator_compaction::load_orchestrator_compaction_checkpoints(
            &cancel_store,
            "cancel-session"
        )
        .unwrap()
        .is_empty()
    );
    assert_eq!(
        format!(
            "{:?}",
            sessions::load_session(&cancel_store, "cancel-session").unwrap()
        ),
        format!("{persisted_before:?}")
    );
    let cancelled = std::iter::from_fn(|| cancel_events.try_recv().ok()).collect::<Vec<_>>();
    assert_eq!(cancelled.len(), 2);
    assert!(matches!(
        cancelled[1].event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorCompactionFailed {
                compaction_id,
                failure: CompactionFailure::Cancelled,
                ..
            }
        } if compaction_id == cancel_id
    ));
    assert!(!cancelled.iter().any(|envelope| matches!(
        envelope.event,
        SessionEvent::RunFailed { .. } | SessionEvent::SnapshotSaved { .. }
    )));

    let _ = std::fs::remove_dir_all(failed_store.parent().unwrap());
    let _ = std::fs::remove_dir_all(cancel_store.parent().unwrap());
}

#[tokio::test]
async fn abort_after_manual_compaction_commit_cannot_supersede_completion() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        compaction_response("committed summary"),
    )]);
    let (parts, store_path) = test_compaction_service(
        "compaction_post_commit_abort",
        "post-commit-session",
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let mut events = parts.service.subscribe_events();
    let handle = parts.service.try_compact().unwrap();
    let id = handle.compaction_id;
    loop {
        let envelope = events.recv().await.unwrap();
        if matches!(
            envelope.event,
            SessionEvent::Agent {
                event: AgentEvent::OrchestratorCompactionCompleted { compaction_id, .. }
            } if compaction_id == id
        ) {
            break;
        }
    }
    handle.abort();
    let result = handle.wait().await.unwrap();
    assert!(matches!(
        result,
        SessionCompactionResult::Compacted { compaction_id: cmp_id, .. } if cmp_id == id
    ));
    assert!(!parts.service.has_active_operation());
    assert_eq!(server.finish().len(), 1);
    let lifecycle = parts
        .service
        .recent_events(None, 16)
        .into_iter()
        .filter(|envelope| {
            matches!(
                envelope.event,
                SessionEvent::Agent {
                    event: AgentEvent::OrchestratorCompactionStarted { compaction_id, .. }
                        | AgentEvent::OrchestratorCompactionCompleted { compaction_id, .. }
                        | AgentEvent::OrchestratorCompactionSkipped { compaction_id, .. }
                        | AgentEvent::OrchestratorCompactionFailed { compaction_id, .. }
                } if compaction_id == id
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(lifecycle.len(), 2);
    assert!(matches!(
        lifecycle[1].event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorCompactionCompleted { .. }
        }
    ));
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
