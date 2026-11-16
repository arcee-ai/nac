//! Actual native Stop, human Delete, manual scheduler and exact-run cleanup.
use super::*;
use nac_core::permissions::PermissionApprovalMode;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn heartbeat_native_stop_then_delete_before_tick_retains_exact_cancellation() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for native_stop in [false, true] {
        let root =
            std::env::temp_dir().join(format!("nac-heartbeat-stop-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("heartbeat-fixture-key"));
        let path = root.join("store.db");
        let entered = Arc::new(tokio::sync::Notify::new());
        let requests = Arc::new(AtomicUsize::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let model_path = path.clone();
        let arrived = entered.clone();
        let model = tokio::spawn(async move {
            axum::serve(listener, axum::Router::new().route("/v1/responses", axum::routing::post(move || {
                let path = model_path.clone();
                let arrived = arrived.clone();
                let requests = requests.clone();
                async move {
                    if native_stop && requests.fetch_add(1, Ordering::SeqCst) == 0 {
                        let schedule = store::spawn_blocking_store_caller(move || store::list_heartbeats(&path, Some("chat"))).await.unwrap().unwrap().remove(0);
                        let args = serde_json::json!({"request_id":uuid::Uuid::new_v4().to_string(),"operation":{"action":"stop","schedule_id":schedule.schedule_id,"expected_version":schedule.version,"spec":null}});
                        return axum::Json(serde_json::json!({"status":"completed","output":[{"type":"function_call","call_id":"native-stop","name":"heartbeat_control","arguments":args.to_string()}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}));
                    }
                    arrived.notify_one();
                    std::future::pending::<axum::Json<serde_json::Value>>().await
                }
            }))).await.unwrap();
        });
        let mut snapshot = sessions::new_snapshot(
            "chat".into(),
            root.clone(),
            "fixture-model".into(),
            url,
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            Vec::new(),
            Some("OPENAI_API_KEY".into()),
            BTreeMap::new(),
        );
        snapshot.behavior = sessions::SessionBehavior::Direct;
        sessions::create_session(&path, &snapshot).unwrap();
        let manager = SessionManager::new_unowned_fixture(ServerOptions {
            root_cwd: root.clone(),
            store_path: Some(path.clone()),
            worker_executable: None,
            managed_host: None,
        })
        .unwrap();
        let service = manager.attach_session("chat").await.unwrap();
        service
            .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
            .await
            .unwrap();
        let app = HeartbeatApplication::new(&manager);
        let created = app
            .control(
                "chat",
                uuid::Uuid::new_v4().to_string(),
                HeartbeatAction::Create {
                    spec: HeartbeatSpec {
                        name: "Stop check".into(),
                        instructions: "Observe the job, then stop this heartbeat.".into(),
                        skills: Vec::new(),
                        cadence: nac_core::store::HeartbeatCadence::Interval {
                            interval_ms: 60_000,
                        },
                        end_condition: "Stop when checked.".into(),
                        goal_id: None,
                        execution_timeout_ms: 60_000,
                        max_occurrences: 1000,
                        token_allowance: None,
                    },
                },
            )
            .await
            .unwrap();
        app.control(
            "chat",
            uuid::Uuid::new_v4().to_string(),
            HeartbeatAction::RunNow {
                schedule_id: created.schedule.schedule_id.clone(),
                expected_version: 1,
            },
        )
        .await
        .unwrap();
        // No background scheduler: Delete is deterministically before the next tick.
        tick(&manager).await.unwrap();
        tokio::time::timeout(Duration::from_secs(10), entered.notified())
            .await
            .unwrap();
        let read_path = path.clone();
        let id = created.schedule.schedule_id.clone();
        let (current, active) = store::spawn_blocking_store_caller(move || -> anyhow::Result<_> {
            Ok((
                store::read_heartbeat(&read_path, "chat", &id)?,
                store::active_heartbeat_occurrences(&read_path)?.remove(0),
            ))
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            current.state,
            if native_stop {
                HeartbeatState::Stopped
            } else {
                HeartbeatState::Active
            }
        );
        app.control(
            "chat",
            uuid::Uuid::new_v4().to_string(),
            HeartbeatAction::Delete {
                schedule_id: current.schedule_id,
                expected_version: current.version,
            },
        )
        .await
        .unwrap();
        tick(&manager).await.unwrap();
        let observed = if native_stop {
            tokio::time::timeout(Duration::from_secs(2), async {
                while service.has_active_operation() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .is_ok()
        } else {
            tokio::time::sleep(Duration::from_millis(50)).await;
            service.has_active_operation()
        };
        // Cleanup also runs on the old broken head before asserting the result.
        if let Some(run) = service.active_run() {
            service.request_cancel(&run.run_id).await.unwrap();
        }
        if observed {
            let successor_service = service.clone();
            let successor = store::spawn_blocking_store_caller(move || {
                successor_service.try_submit_prompt("Fresh human work after the heartbeat".into())
            })
            .await
            .unwrap()
            .unwrap();
            reconcile_or_stop(&manager, &active).await.unwrap();
            assert_eq!(service.active_run().unwrap().run_id, successor.run_id);
            service.request_cancel(&successor.run_id).await.unwrap();
        }
        manager.stop_local_run_admission().await;
        manager.quiesce_persistence_callers().await;
        manager.drain_persistence().await.unwrap();
        model.abort();
        let _ = model.await;
        drop(manager);
        let _ = std::fs::remove_dir_all(root);
        assert!(observed,"native_stop={native_stop}: accepted Stop must survive Delete; Delete alone must continue");
    }
}
