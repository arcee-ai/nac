//! Runs the real scheduler/admission owners against an isolated Local store.
use super::*;
use crate::tests::{ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use crate::ServerOptions;
use nac_core::model::BackendKind;
use nac_core::store::{HeartbeatAction, HeartbeatSpec};
use std::{collections::BTreeMap, path::PathBuf, time::Instant};

#[derive(Debug, serde::Serialize)]
struct Measurement {
    schedules: usize,
    runnable_chats: usize,
    owners: usize,
    admitted: usize,
    pending: usize,
    cold_scan_ms: f64,
    warm_p50_ms: f64,
    warm_p95_ms: f64,
    warm_max_ms: f64,
    maximum_admission_lateness_ms: i64,
    database_bytes: u64,
    resident_before_kib: Option<u64>,
    resident_active_kib: Option<u64>,
}

fn resident_kib() -> Option<u64> {
    let output = std::process::Command::new("ps")
        .args(["-p", &std::process::id().to_string(), "-o", "rss="])
        .output()
        .ok()?;
    String::from_utf8(output.stdout).ok()?.trim().parse().ok()
}

async fn measure_case(n: usize) -> Measurement {
    let root = std::env::temp_dir().join(format!("nac-heartbeat-load-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = std::fs::canonicalize(root).unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("heartbeat-fixture-key"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let model = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().route(
                "/v1/responses",
                axum::routing::post(|| async {
                    std::future::pending::<axum::Json<serde_json::Value>>().await
                }),
            ),
        )
        .await
        .unwrap();
    });
    let path = root.join("store.db");
    let chats = n.min(4);
    for index in 0..chats {
        let mut snapshot = sessions::new_snapshot(
            format!("chat-{index}"),
            root.clone(),
            "fixture-model".into(),
            url.clone(),
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
    }
    let due = epoch_ms();
    for index in 0..n {
        store::control_heartbeat(
            &path,
            &format!("chat-{}", index % chats),
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::Create {
                spec: HeartbeatSpec {
                    name: format!("Check {index}"),
                    instructions: "Observe the authorized Local fixture.".into(),
                    skills: Vec::new(),
                    interval_ms: 60_000,
                    end_condition: "Finish after fixture verification.".into(),
                    goal_id: None,
                    execution_timeout_ms: 60_000,
                    max_occurrences: 1000,
                    token_allowance: None,
                },
            },
            "Check the Local fixture every minute.",
            root.to_str().unwrap(),
            due - 60_000,
        )
        .unwrap();
    }
    let manager = || {
        SessionManager::new_unowned_fixture(ServerOptions {
            root_cwd: root.clone(),
            store_path: Some(path.clone()),
            worker_executable: None,
            managed_host: None,
        })
        .unwrap()
    };
    let resident_before_kib = resident_kib();
    let first = manager();
    let second = manager();
    let cold = Instant::now();
    let (a, b) = tokio::join!(tick(&first), tick(&second));
    a.unwrap();
    b.unwrap();
    let cold_scan_ms = cold.elapsed().as_secs_f64() * 1000.;
    let mut warm = Vec::new();
    for _ in 0..24 {
        let sample = Instant::now();
        let (a, b) = tokio::join!(tick(&first), tick(&second));
        a.unwrap();
        b.unwrap();
        warm.push(sample.elapsed().as_secs_f64() * 1000.);
    }
    warm.sort_by(f64::total_cmp);
    let read_path = path.clone();
    let (active, pending) = store::spawn_blocking_store_caller(move || -> anyhow::Result<_> {
        Ok((
            store::active_heartbeat_occurrences(&read_path)?,
            store::materialize_heartbeats(&read_path, epoch_ms())?,
        ))
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(active.len(), chats);
    assert_eq!(active.len() + pending.len(), n);
    let lateness = active
        .iter()
        .map(|o| o.started_at_ms.unwrap() - o.due_first_ms)
        .max()
        .unwrap_or(0);
    // Both independent owners must see the same bounded durable receipts.
    let active_ids = active
        .iter()
        .map(|o| o.occurrence_id.clone())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(active_ids.len(), active.len());
    let resident_active_kib = resident_kib();
    first.stop_local_run_admission().await;
    second.stop_local_run_admission().await;
    first.quiesce_persistence_callers().await;
    second.quiesce_persistence_callers().await;
    first.drain_persistence().await.unwrap();
    second.drain_persistence().await.unwrap();
    let bytes = [
        path.clone(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ]
    .iter()
    .filter_map(|path| std::fs::metadata(path).ok())
    .map(|m| m.len())
    .sum();
    let measurement = Measurement {
        schedules: n,
        runnable_chats: chats,
        owners: 2,
        admitted: active.len(),
        pending: pending.len(),
        cold_scan_ms,
        warm_p50_ms: warm[12],
        warm_p95_ms: warm[22],
        warm_max_ms: warm[23],
        maximum_admission_lateness_ms: lateness,
        database_bytes: bytes,
        resident_before_kib,
        resident_active_kib,
    };
    model.abort();
    let _ = model.await;
    drop(first);
    drop(second);
    let _ = std::fs::remove_dir_all(root);
    measurement
}

#[tokio::test]
async fn heartbeat_scheduler_two_owners_admit_once_without_clients_and_shutdown_settles() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let measurement = measure_case(2).await;
    assert_eq!(measurement.admitted, 2);
    assert_eq!(measurement.pending, 0);
}

#[tokio::test]
#[ignore = "run with the shared exclusive measurement lease and --nocapture"]
async fn heartbeat_scheduler_measure_1_10_100_with_two_owners_and_bounded_chat_contention() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for n in [1, 10, 100] {
        println!(
            "HEARTBEAT_MEASUREMENT {}",
            serde_json::to_string(&measure_case(n).await).unwrap()
        );
    }
}
