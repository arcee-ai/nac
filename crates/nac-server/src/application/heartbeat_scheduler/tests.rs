//! Runs the real scheduler/admission owners against an isolated Local store.
use super::*;
use crate::tests::{ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use crate::ServerOptions;
use nac_core::model::BackendKind;
use nac_core::store::{HeartbeatAction, HeartbeatSpec, HeartbeatState};
use std::{collections::BTreeMap, path::PathBuf, time::Instant};

mod cancellation;
mod question_delivery;
mod question_yield;
mod shutdown;
mod submission_shutdown;
pub(super) use shutdown::hold_store_call;
pub(super) use submission_shutdown::{hold_submission, observe_submission_stop};

// Manual tick fixtures retain their complete future; serving scans use the
// shared lifetime that can close while an already-admitted phase is pending.
async fn tick(manager: &SessionManager) -> Result<()> {
    super::tick(manager, &SchedulerLifetime::default()).await
}

async fn reconcile_or_stop(
    manager: &SessionManager,
    occurrence: &HeartbeatOccurrence,
) -> Result<()> {
    super::reconcile_or_stop(manager, occurrence, &SchedulerLifetime::default()).await
}

#[derive(Debug, serde::Serialize)]
struct Measurement {
    cadence: &'static str,
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
    calculation_ms: f64,
    catchup_points_per_schedule: i64,
    retained_occurrence_rows: usize,
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

async fn measure_case(n: usize, calendar: bool) -> Measurement {
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
    let now = epoch_ms();
    // A whole-minute daily UTC rule gives an exact canonical seven-day
    // downtime range, independent of the wall-clock second of this fixture.
    let minute_boundary = now / 60_000 * 60_000;
    let first_due = if calendar {
        minute_boundary - 7 * 86_400_000
    } else {
        now
    };
    let creation_time = if calendar {
        first_due - 1
    } else {
        now - 60_000
    };
    let mut calculation_ms = 0.;
    for index in 0..n {
        let mut binding =
            store::heartbeat_binding(&path, &format!("chat-{}", index % chats)).unwrap();
        binding.execution_cwd = Some(root.to_string_lossy().into_owned());
        let cadence = if calendar {
            let rule = store::HeartbeatCalendarRule {
                zone: "Etc/UTC".into(),
                data_version: "2026f".into(),
                hour: ((minute_boundary / 3_600_000) % 24) as u8,
                minute: ((minute_boundary / 60_000) % 60) as u8,
                days: store::HeartbeatCalendarDays::Daily,
            };
            let calculation = Instant::now();
            let preview = rule.preview(creation_time, None, 3).unwrap();
            calculation_ms += calculation.elapsed().as_secs_f64() * 1000.;
            assert_eq!(preview.occurrences.len(), 3);
            assert_eq!(preview.occurrences[0].due_ms, first_due);
            store::HeartbeatCadence::Calendar(rule)
        } else {
            store::HeartbeatCadence::Interval {
                interval_ms: 60_000,
            }
        };
        let created = store::control_heartbeat(
            &path,
            &format!("chat-{}", index % chats),
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::Create {
                spec: HeartbeatSpec {
                    name: format!("Check {index}"),
                    instructions: "Observe the authorized Local fixture.".into(),
                    skills: Vec::new(),
                    cadence,
                    end_condition: "Finish after fixture verification.".into(),
                    goal_id: None,
                    execution_timeout_ms: 60_000,
                    max_occurrences: 1000,
                    token_allowance: None,
                },
            },
            "Check the Local fixture every minute.",
            &binding,
            creation_time,
        )
        .unwrap();
        assert_eq!(created.schedule.next_due_ms, first_due);
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
    let catchup_points = if calendar { 8 } else { 1 };
    for occurrence in active.iter().chain(pending.iter()) {
        assert_eq!(occurrence.coalesced_count, catchup_points);
        assert_eq!(occurrence.due_first_ms, first_due);
        assert_eq!(
            occurrence.due_last_ms,
            if calendar { minute_boundary } else { now }
        );
    }
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
    let retained_occurrence_rows = (0..chats)
        .flat_map(|chat| store::list_heartbeats(&path, Some(&format!("chat-{chat}"))).unwrap())
        .map(|schedule| {
            store::heartbeat_history(
                &path,
                schedule
                    .session_id
                    .as_deref()
                    .expect("same-chat fixture owner"),
                &schedule.schedule_id,
            )
            .unwrap()
            .len()
        })
        .sum::<usize>();
    assert_eq!(
        retained_occurrence_rows, n,
        "downtime must not create one row per missed point"
    );
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
        cadence: if calendar {
            "calendar_daily_utc"
        } else {
            "interval"
        },
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
        calculation_ms,
        catchup_points_per_schedule: catchup_points,
        retained_occurrence_rows,
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
    let measurement = measure_case(2, false).await;
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
            serde_json::to_string(&measure_case(n, false).await).unwrap()
        );
    }
}

#[tokio::test]
async fn heartbeat_calendar_scheduler_two_owners_bound_missed_range_and_admit_once() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let measurement = measure_case(2, true).await;
    assert_eq!(measurement.admitted, 2);
    assert_eq!(measurement.pending, 0);
    assert_eq!(measurement.catchup_points_per_schedule, 8);
}

#[tokio::test]
#[ignore = "run with the shared exclusive measurement lease and --nocapture"]
async fn heartbeat_calendar_measure_1_10_100_with_two_owners_and_seven_day_downtime() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for n in [1, 10, 100] {
        println!(
            "HEARTBEAT_CALENDAR_MEASUREMENT {}",
            serde_json::to_string(&measure_case(n, true).await).unwrap()
        );
    }
}
