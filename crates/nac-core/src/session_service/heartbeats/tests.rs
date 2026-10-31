use super::*;
use crate::model::ModelClient;
use crate::permissions::{PermissionBackend, PermissionBroker, PermissionEffect, PermissionRule};
use crate::session_service::tests::test_direct_active_service;
use crate::store::{HeartbeatSpec, HeartbeatState};

fn fixture() -> (SessionServiceParts, PathBuf) {
    let (parts, path) = test_direct_active_service(
        &format!("heartbeat_native_{}", Uuid::new_v4()),
        "session",
        ModelClient::new_for_test(),
    );
    (parts, path)
}
fn create() -> HeartbeatAction {
    HeartbeatAction::Create {
        spec: HeartbeatSpec {
            name: "Job check".into(),
            instructions: "Check the authorized Local result.".into(),
            skills: Vec::new(),
            interval_ms: 60_000,
            end_condition: "Finish when ready.".into(),
            goal_id: None,
            execution_timeout_ms: 300_000,
            max_occurrences: 1_000,
            token_allowance: None,
        },
    }
}
async fn native_control(
    runtime: &crate::tools::ToolRuntime,
    operation: HeartbeatAction,
) -> crate::tools::ToolResult {
    let snapshot = ToolRegistry::builder()
        .register(HeartbeatControlTool::native())
        .finish()
        .unwrap()
        .snapshot([CONTROL_HEARTBEAT])
        .unwrap();
    snapshot
        .invoke(
            CONTROL_HEARTBEAT,
            serde_json::json!({"request_id":Uuid::new_v4().to_string(),"operation":operation}),
            ToolServices {
                runtime,
                client: &ModelClient::new_for_test(),
            },
            &ToolCallContext::default(),
        )
        .await
}

#[tokio::test]
async fn heartbeat_human_control_does_not_wait_for_active_agent_mutex_or_own_run_lease() {
    let (parts, path) = fixture();
    let service = &parts.service;
    let run = service
        .coordinate_local(|service| service.try_begin_run(None, "hold this exact active run"))
        .await
        .unwrap()
        .unwrap();
    let _held_agent = service.agent.lock().await;
    let receipt = tokio::time::timeout(
        Duration::from_secs(10),
        service.control_human_heartbeat(Uuid::new_v4().to_string(), create()),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(receipt.schedule.state, HeartbeatState::Active);
    assert_eq!(service.active_run().unwrap().run_id, run.run_id);
    assert!(crate::store::list_session_inbox(&path, "session")
        .unwrap()
        .is_empty());
    assert!(crate::store::load_session_goal(&path, "session")
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn heartbeat_native_automatic_turn_cannot_create_or_renew_scheduling_authority() {
    let (parts, path) = fixture();
    let mut runtime = parts
        .service
        .heartbeat_context
        .as_ref()
        .unwrap()
        .runtime
        .clone();
    assert!(native_control(&runtime, create()).await.is_error);
    runtime.heartbeat_human_request =
        Some("Check this Local job every minute until the result is ready.".into());
    let created = native_control(&runtime, create()).await;
    assert!(!created.is_error, "{}", created.content);
    let created: HeartbeatReceipt =
        serde_json::from_str(created.content.as_text().unwrap()).unwrap();
    assert_eq!(
        created.schedule.binding.scheduling_request,
        runtime.heartbeat_human_request
    );
    runtime.heartbeat_human_request = None;
    let id = created.schedule.schedule_id;
    assert!(
        native_control(
            &runtime,
            HeartbeatAction::RunNow {
                schedule_id: id.clone(),
                expected_version: 1
            }
        )
        .await
        .is_error
    );
    let paused = native_control(
        &runtime,
        HeartbeatAction::Pause {
            schedule_id: id.clone(),
            expected_version: 1,
        },
    )
    .await;
    assert!(
        paused.is_error,
        "an unbound automatic turn cannot pause another schedule"
    );
    assert!(
        native_control(
            &runtime,
            HeartbeatAction::Resume {
                schedule_id: id.clone(),
                expected_version: 1
            }
        )
        .await
        .is_error
    );
    assert_eq!(
        crate::store::read_heartbeat(&path, "session", &id)
            .unwrap()
            .state,
        HeartbeatState::Active
    );
}

#[tokio::test]
async fn heartbeat_human_submission_skips_ask_but_preserves_configured_deny_and_agent_policy() {
    let (mut parts, path) = fixture();
    let mut runtime = parts
        .service
        .heartbeat_context
        .as_ref()
        .unwrap()
        .runtime
        .clone();
    for effect in [PermissionEffect::Ask, PermissionEffect::Deny] {
        runtime.permission_broker = Some(Arc::new(PermissionBroker::new(
            path.clone(),
            "session".into(),
            PermissionBackend::Local,
            parts.service.config_version.unwrap(),
            vec![PermissionRule::new("heartbeat_manage", "*", effect)],
        )));
        parts.service.heartbeat_context = Some(Arc::new(HeartbeatContext::new(
            runtime.clone(),
            ModelClient::new_for_test(),
        )));
        let human = parts
            .service
            .control_human_heartbeat(Uuid::new_v4().to_string(), create())
            .await;
        assert_eq!(human.is_ok(), effect == PermissionEffect::Ask);
        runtime.heartbeat_human_request = Some("Create a heartbeat every minute.".into());
        assert!(native_control(&runtime, create()).await.is_error);
        let broker = runtime.permission_broker.as_ref().unwrap();
        assert!(broker.pending().is_empty());
        assert!(broker.grants().unwrap().is_empty());
    }
    assert_eq!(
        crate::store::list_heartbeats(&path, Some("session"))
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn heartbeat_controls_reject_stale_configuration_and_shutdown_without_waking_any_work() {
    let (parts, path) = fixture();
    let service = &parts.service;
    let original = service
        .control_human_heartbeat(Uuid::new_v4().to_string(), create())
        .await
        .unwrap();
    crate::store::open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET config_version=config_version+1 WHERE session_id='session'",
            [],
        )
        .unwrap();
    assert!(service
        .control_human_heartbeat(
            Uuid::new_v4().to_string(),
            HeartbeatAction::RunNow {
                schedule_id: original.schedule.schedule_id,
                expected_version: 1
            }
        )
        .await
        .is_err());
    service.stop_run_admission().await.unwrap();
    assert!(service
        .control_human_heartbeat(Uuid::new_v4().to_string(), create())
        .await
        .is_err());
    assert!(!service.has_active_operation());
    assert!(crate::store::list_session_inbox(&path, "session")
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn heartbeat_native_registry_controls_all_actions_inside_an_executing_turn() {
    let (parts, path) = fixture();
    let service = &parts.service;
    let run = service
        .coordinate_local(|service| {
            service.try_begin_run(None, "human asked for scheduling controls")
        })
        .await
        .unwrap()
        .unwrap();
    let _agent = service.agent.lock().await;
    let mut runtime = service.heartbeat_context.as_ref().unwrap().runtime.clone();
    runtime.heartbeat_human_request = Some(
        "Create this job check, run it now, pause, resume, edit the cadence, stop and delete it."
            .into(),
    );
    let first = native_control(&runtime, create()).await;
    assert!(!first.is_error, "{}", first.content);
    let receipt: HeartbeatReceipt = serde_json::from_str(first.content.as_text().unwrap()).unwrap();
    let mut schedule = receipt.schedule;
    for action in ["run_now", "pause", "resume", "edit", "stop", "delete"] {
        let id = schedule.schedule_id.clone();
        let expected = schedule.version;
        let operation = match action {
            "run_now" => HeartbeatAction::RunNow {
                schedule_id: id,
                expected_version: expected,
            },
            "pause" => HeartbeatAction::Pause {
                schedule_id: id,
                expected_version: expected,
            },
            "resume" => HeartbeatAction::Resume {
                schedule_id: id,
                expected_version: expected,
            },
            "edit" => {
                let HeartbeatAction::Create { mut spec } = create() else {
                    unreachable!()
                };
                spec.interval_ms = 120_000;
                HeartbeatAction::Edit {
                    schedule_id: id,
                    expected_version: expected,
                    spec,
                }
            }
            "stop" => HeartbeatAction::Stop {
                schedule_id: id,
                expected_version: expected,
            },
            _ => HeartbeatAction::Delete {
                schedule_id: id,
                expected_version: expected,
            },
        };
        let result =
            tokio::time::timeout(Duration::from_secs(10), native_control(&runtime, operation))
                .await
                .unwrap();
        assert!(!result.is_error, "{action}: {}", result.content);
        let receipt: HeartbeatReceipt =
            serde_json::from_str(result.content.as_text().unwrap()).unwrap();
        schedule = receipt.schedule;
        assert_eq!(service.active_run().unwrap().run_id, run.run_id);
    }
    assert_eq!(schedule.state, HeartbeatState::Deleted);
    assert!(crate::store::list_session_inbox(&path, "session")
        .unwrap()
        .is_empty());
    assert!(crate::store::load_session_goal(&path, "session")
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn heartbeat_automatic_relinquishing_control_is_bound_to_own_occurrence_and_pinned_version() {
    let (parts, path) = fixture();
    let service = &parts.service;
    let first = service
        .control_human_heartbeat(Uuid::new_v4().to_string(), create())
        .await
        .unwrap()
        .schedule;
    let other = service
        .control_human_heartbeat(Uuid::new_v4().to_string(), create())
        .await
        .unwrap()
        .schedule;
    let pending =
        crate::store::materialize_heartbeats(&path, first.next_due_ms.max(other.next_due_ms))
            .unwrap()
            .into_iter()
            .find(|o| o.schedule_id == first.schedule_id)
            .unwrap();
    let run = Uuid::new_v4().to_string();
    let generation = Uuid::new_v4().to_string();
    let cwd = service.heartbeat_context.as_ref().unwrap().execution_cwd();
    crate::store::admit_heartbeat(
        &path,
        "session",
        &pending.occurrence_id,
        pending.revision,
        &run,
        &generation,
        "automatic input",
        &cwd,
        first.next_due_ms.max(other.next_due_ms),
    )
    .unwrap()
    .unwrap();
    let mut runtime = service.heartbeat_context.as_ref().unwrap().runtime.clone();
    runtime.heartbeat_execution = true;
    runtime.heartbeat_human_request = None;
    assert!(runtime.active_threads.begin_run(&run));
    assert!(
        native_control(
            &runtime,
            HeartbeatAction::Pause {
                schedule_id: other.schedule_id.clone(),
                expected_version: other.version
            }
        )
        .await
        .is_error
    );
    let paused = native_control(
        &runtime,
        HeartbeatAction::Pause {
            schedule_id: first.schedule_id.clone(),
            expected_version: first.version,
        },
    )
    .await;
    assert!(!paused.is_error, "{}", paused.content);
    let paused: HeartbeatReceipt = serde_json::from_str(paused.content.as_text().unwrap()).unwrap();
    let resumed = service
        .control_human_heartbeat(
            Uuid::new_v4().to_string(),
            HeartbeatAction::Resume {
                schedule_id: first.schedule_id.clone(),
                expected_version: paused.schedule.version,
            },
        )
        .await
        .unwrap();
    assert!(
        native_control(
            &runtime,
            HeartbeatAction::Pause {
                schedule_id: first.schedule_id.clone(),
                expected_version: resumed.schedule.version
            }
        )
        .await
        .is_error
    );
    assert_eq!(
        crate::store::read_heartbeat(&path, "session", &first.schedule_id)
            .unwrap()
            .state,
        HeartbeatState::Active
    );
    assert_eq!(
        crate::store::read_heartbeat(&path, "session", &other.schedule_id)
            .unwrap()
            .state,
        HeartbeatState::Active
    );
}

#[tokio::test]
async fn heartbeat_deferred_or_invalid_admission_does_not_retain_a_session_operation_lease() {
    for invalidated in [false, true] {
        let (parts, path) = fixture();
        let service = &parts.service;
        let schedule = service
            .control_human_heartbeat(Uuid::new_v4().to_string(), create())
            .await
            .unwrap()
            .schedule;
        let pending = crate::store::materialize_heartbeats(&path, schedule.next_due_ms)
            .unwrap()
            .remove(0);
        if invalidated {
            service
                .control_human_heartbeat(
                    Uuid::new_v4().to_string(),
                    HeartbeatAction::Pause {
                        schedule_id: schedule.schedule_id,
                        expected_version: schedule.version,
                    },
                )
                .await
                .unwrap();
        } else {
            crate::store::create_person_session_inbox_item(
                &path,
                "session",
                crate::store::InboxDelivery::Queue,
                "Queued human input wins",
                None,
                None,
                "Queued human input wins",
            )
            .unwrap();
        }
        let lease = sessions::SessionOperationLease::try_acquire(&path, "session").unwrap();
        let result = service.start_heartbeat_occurrence(pending, lease).await;
        if invalidated {
            assert!(result.is_err());
        } else {
            assert!(result.unwrap().is_none());
        }
        assert!(!service.has_active_operation());
        let lease = sessions::SessionOperationLease::try_acquire(&path, "session")
            .expect("a deferred or invalidated occurrence must release the operation lease");
        let human_service = service.clone();
        let human = crate::store::spawn_blocking_store_caller(move || {
            human_service.try_begin_run_with_lease(
                None,
                "Later explicit human run",
                Some(lease),
                RunAdmissionKind::default(),
            )
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(service.active_run().unwrap().run_id, human.run_id);
    }
}
