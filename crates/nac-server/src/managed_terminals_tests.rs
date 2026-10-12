//! Synthetic controller/host composition with genuine Local PTYs. These
//! fixtures do not establish a deployed gateway or an eligible image upgrade.
#[path = "managed_terminal_pressure_tests.rs"]
mod pressure;

use super::*;
use nac_core::permissions::PermissionApprovalMode;
use serde_json::{json, Value};

fn seed(fixture: &Fixture, id: &str) {
    let mut snapshot = nac_core::sessions::new_snapshot(
        id.into(),
        fixture.root.clone(),
        "trinity-large-thinking".into(),
        "https://api.arcee.ai/api/v1".into(),
        nac_core::model::BackendKind::ArceeApi,
        None,
        None,
        None,
        Vec::new(),
        None,
        BTreeMap::new(),
    );
    snapshot.behavior = nac_core::sessions::SessionBehavior::Direct;
    nac_core::sessions::create_session(&fixture.manager.inner.store_path, &snapshot).unwrap();
}

fn request(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("host", "localhost")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn call_public(
    app: &axum::Router,
    method: &str,
    uri: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(request(method, uri, body))
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn launch(
    fixture: &Fixture,
    id: &str,
) -> (
    std::sync::Arc<nac_core::session_service::SessionService>,
    String,
) {
    seed(fixture, id);
    let service = fixture.manager.attach_session(id).await.unwrap();
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let terminal = fixture
        .manager
        .session_terminals()
        .open_user(id, uuid::Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    (service, terminal.id)
}

async fn finish(service: &nac_core::session_service::SessionService, terminal: &str) {
    service
        .write_user_terminal_input(terminal, b"printf FINAL-MARKER; exit 0\r")
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let status = service.user_terminal_status(terminal).await.unwrap();
            // EOF can precede native cleanup; maintenance requires settled
            // ownership as well as the collector's committed final append.
            if status.output_complete && !status.alive && status.exit_code.is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn managed_terminal_maintenance_retains_cached_completion_and_never_resumes_cache_misses() {
    let fixture = Fixture::new();
    let (service, id) = launch(&fixture, "session").await;
    seed(&fixture, "uncached");
    let blockers = fixture
        .manager
        .managed_upgrade_blockers_async()
        .await
        .unwrap();
    assert!(blockers
        .iter()
        .any(|b| b.kind == nac_core::store::ManagedBlockerKind::TerminalProcess && b.id == id));
    let control = fixture.running_request();
    let assertion = fixture.assertion(ManagedControlAction::Prepare, &control, "live-terminal");
    let (status, blocked) = call(
        super::super::router(fixture.manager.clone()),
        "/v1/upgrade/prepare",
        &control,
        &assertion,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        serde_json::from_str::<Value>(&blocked).unwrap()["result"],
        "blocked"
    );
    finish(&service, &id).await;
    let assertion = fixture.assertion(ManagedControlAction::Retry, &control, "after-eof");
    let (status, ready) = call(
        super::super::router(fixture.manager.clone()),
        "/v1/upgrade/retry",
        &control,
        &assertion,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_str::<Value>(&ready).unwrap()["result"],
        "safe_to_stop"
    );

    let app = crate::router(fixture.manager.clone());
    let base = format!("/sessions/session/user-terminals/{id}");
    for (method, uri, body) in [
        (
            "POST",
            "/sessions/session/user-terminals".to_string(),
            json!({"protocol_version":1,"launch_id":uuid::Uuid::new_v4(),"cols":80,"rows":24}),
        ),
        (
            "POST",
            format!("{base}/input"),
            json!({"protocol_version":1,"bytes":[97]}),
        ),
    ] {
        assert_eq!(
            call_public(&app, method, &uri, body).await.0,
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
    assert_eq!(
        call_public(&app, "GET", &base, Value::Null).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call_public(&app, "GET", "/sessions/session/user-terminals", Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    let (status, attached) = call_public(
        &app,
        "POST",
        &format!("{base}/observers"),
        json!({"protocol_version":1,"page_limit":65536}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let observer = attached["observer_id"].as_str().unwrap();
    let observation = format!("{base}/observers/{observer}");
    assert_eq!(
        call_public(
            &app,
            "POST",
            &format!("{observation}/read"),
            json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":0})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call_public(&app, "DELETE", &observation, Value::Null)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call_public(
            &app,
            "DELETE",
            &format!("/sessions/session/terminals/{id}"),
            Value::Null
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (status, list) = call_public(
        &app,
        "GET",
        "/sessions/uncached/user-terminals",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["terminals"], json!([]));
    assert_eq!(
        call_public(
            &app,
            "GET",
            "/sessions/uncached/user-terminals/user-shell-stale",
            Value::Null
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call_public(&app, "GET", "/sessions/missing/user-terminals", Value::Null)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert!(!fixture
        .manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("uncached"));
    let mut cross_origin = request(
        "POST",
        &format!("{base}/observers"),
        json!({"protocol_version":1,"page_limit":8}),
    );
    cross_origin
        .headers_mut()
        .insert("origin", "https://foreign.example.test".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(cross_origin).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn accepted_host_replacement_fences_cached_pending_frames_and_detach() {
    let fixture = Fixture::new();
    let (service, id) = launch(&fixture, "session").await;
    finish(&service, &id).await;
    let terminals = fixture.manager.session_terminals();
    let (observer, _) = terminals.attach_user("session", &id, 8).await.unwrap();
    let first = terminals
        .pull_user("session", &id, observer, None, 0)
        .await
        .unwrap();
    assert!(!first.page.bytes.is_empty());
    let replacement = fixture.prepare_running_replacement("replacement-prepare");
    assert!(nac_core::store::accept_managed_forward_start(
        &fixture.manager.inner.store_path,
        replacement.managed_identity().unwrap()
    )
    .unwrap());
    assert!(terminals
        .pull_user("session", &id, observer, None, 0)
        .await
        .is_err());
    assert!(terminals
        .detach_user("session", &id, observer)
        .await
        .is_err());
    assert!(terminals.list_users("session").await.is_err());
    assert!(service.read_user_terminal_output(&id, 0, 8).await.is_err());
    assert!(replacement
        .session_terminals()
        .list_users("session")
        .await
        .unwrap()
        .is_empty());
    assert!(replacement
        .session_terminals()
        .user_status("session", &id)
        .await
        .is_err());
    assert!(replacement.inner.active_sessions.read().await.is_empty());
}

#[tokio::test]
async fn replaced_cached_service_cannot_replay_the_previous_owners_pending_frame() {
    let fixture = Fixture::new();
    let (original, id) = launch(&fixture, "session").await;
    finish(&original, &id).await;
    let terminals = fixture.manager.session_terminals();
    let (observer, _) = terminals.attach_user("session", &id, 8).await.unwrap();
    let pending = terminals
        .pull_user("session", &id, observer, None, 0)
        .await
        .unwrap();
    assert!(!pending.page.bytes.is_empty());
    // Replace only the process-local owner, keeping the exact same persisted
    // configuration. A version-only check would incorrectly accept the frame.
    fixture
        .manager
        .inner
        .active_sessions
        .write()
        .await
        .remove("session");
    let current = fixture.manager.attach_session("session").await.unwrap();
    assert!(!std::sync::Arc::ptr_eq(&original, &current));
    assert_eq!(original.config_version(), current.config_version());
    assert!(terminals
        .pull_user("session", &id, observer, None, 0)
        .await
        .is_err());
    assert!(terminals.user_status("session", &id).await.is_err());
    assert!(current.list_user_terminals().await.unwrap().is_empty());
}

#[tokio::test]
async fn waiting_managed_observation_retains_host_admission_until_completion() {
    use crate::application::terminal_observation::RenderAcknowledgement;
    let fixture = Fixture::new();
    let (service, id) = launch(&fixture, "session").await;
    service
        .write_user_terminal_input(&id, b"printf 'READY-%s' MARKER; sleep 2\r")
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let page = service
                .read_user_terminal_output(&id, 0, 65536)
                .await
                .unwrap();
            if String::from_utf8_lossy(&page.bytes).contains("READY-MARKER") {
                break;
            }
            service
                .wait_for_user_terminal_output(&id, page.retained_end, 1000)
                .await
                .unwrap();
        }
    })
    .await
    .unwrap();
    let terminals = fixture.manager.session_terminals();
    let (observer, _) = terminals.attach_user("session", &id, 65536).await.unwrap();
    let mut frame = terminals
        .pull_user("session", &id, observer, None, 0)
        .await
        .unwrap();
    while frame.requires_ack {
        frame = terminals
            .pull_user(
                "session",
                &id,
                observer,
                Some(RenderAcknowledgement {
                    offset: frame.page.next_offset,
                    reset: frame.page.gap,
                }),
                0,
            )
            .await
            .unwrap();
    }
    let waiting = terminals.pull_user("session", &id, observer, None, 1000);
    let prove_admission = async {
        tokio::time::timeout(std::time::Duration::from_millis(500), async {
            loop {
                match nac_core::sessions::HostMaintenanceLease::try_acquire(
                    &fixture.manager.inner.store_path,
                ) {
                    Err(_) => break,
                    Ok(lease) => drop(lease),
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    };
    let (result, ()) = tokio::join!(waiting, prove_admission);
    assert!(result.is_ok());
    let exclusive =
        nac_core::sessions::HostMaintenanceLease::try_acquire(&fixture.manager.inner.store_path)
            .unwrap();
    drop(exclusive);
    service.terminate_user_terminal(&id).await.unwrap();
}

#[tokio::test]
async fn managed_quiesce_settles_shells_despite_observer_and_client_clones() {
    let fixture = Fixture::new();
    let (service, id) = launch(&fixture, "session").await;
    let (_observer, _) = fixture
        .manager
        .session_terminals()
        .attach_user("session", &id, 1024)
        .await
        .unwrap();
    let _client = service.connect_client();
    assert!(!service.live_terminal_names().is_empty());
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        fixture.manager.quiesce_persistence_callers(),
    )
    .await
    .unwrap();
    assert!(service.live_terminal_names().is_empty());
    assert!(service
        .open_user_terminal(uuid::Uuid::new_v4(), 80, 24)
        .await
        .is_err());
    assert!(fixture
        .manager
        .managed_upgrade_blockers_async()
        .await
        .unwrap()
        .iter()
        .all(
            |b| b.kind != nac_core::store::ManagedBlockerKind::TerminalProcess
                && b.kind != nac_core::store::ManagedBlockerKind::ResourceLease
        ));
}

#[tokio::test]
async fn slow_observers_stay_independent_busy_is_immediate_and_close_remains_responsive() {
    use crate::application::terminal_observation::{
        RenderAcknowledgement, TerminalApplicationError,
    };
    let fixture = Fixture::new();
    let (service, id) = launch(&fixture, "session").await;
    service
        .write_user_terminal_input(&id, b"printf 'READY-%s' MARKER; sleep 30\r")
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let page = service
                .read_user_terminal_output(&id, 0, 65536)
                .await
                .unwrap();
            if String::from_utf8_lossy(&page.bytes).contains("READY-MARKER") {
                break;
            }
            service
                .wait_for_user_terminal_output(&id, page.retained_end, 1000)
                .await
                .unwrap();
        }
    })
    .await
    .unwrap();
    let terminals = fixture.manager.session_terminals();
    let mut observers = Vec::new();
    for _ in 0..2 {
        let (observer, _) = terminals.attach_user("session", &id, 65536).await.unwrap();
        let mut frame = terminals
            .pull_user("session", &id, observer, None, 0)
            .await
            .unwrap();
        while frame.requires_ack {
            frame = terminals
                .pull_user(
                    "session",
                    &id,
                    observer,
                    Some(RenderAcknowledgement {
                        offset: frame.page.next_offset,
                        reset: frame.page.gap,
                    }),
                    0,
                )
                .await
                .unwrap();
        }
        observers.push(observer);
    }
    let first = terminals.pull_user("session", &id, observers[0], None, 1000);
    let second = terminals.pull_user("session", &id, observers[1], None, 1000);
    let close = async {
        let busy = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            terminals.pull_user("session", &id, observers[0], None, 1000),
        )
        .await
        .unwrap();
        assert!(matches!(busy, Err(TerminalApplicationError::Busy)));
        tokio::time::timeout(
            std::time::Duration::from_millis(500),
            fixture.manager.terminate_terminal("session", &id),
        )
        .await
        .unwrap()
        .unwrap();
    };
    let (first, second, ()) = tokio::time::timeout(std::time::Duration::from_millis(750), async {
        tokio::join!(first, second, close)
    })
    .await
    .unwrap();
    // Each immutable frame can capture EOF before native ownership settles.
    assert!(first.unwrap().terminal.output_complete);
    assert!(second.unwrap().terminal.output_complete);
    let status = service.user_terminal_status(&id).await.unwrap();
    assert!(!status.alive);
    assert!(status.exit_code.is_some());
}

#[tokio::test]
async fn managed_terminal_secret_rotation_preserves_each_launch_snapshot_and_retained_masking() {
    let fixture = Fixture::new();
    let secrets = fixture.manager.managed_host().unwrap().secret_store();
    let old_secret = "synthetic-terminal-old-value";
    let new_secret = "synthetic-terminal-new-value";
    secrets.put("APP_TERMINAL_SECRET", old_secret).unwrap();
    assert!(secrets.put("EXA_API_KEY", "synthetic-exa-value").is_err());
    let (service, first) = launch(&fixture, "session").await;
    secrets.put("APP_TERMINAL_SECRET", new_secret).unwrap();
    let second = fixture
        .manager
        .session_terminals()
        .open_user("session", uuid::Uuid::new_v4(), 80, 24)
        .await
        .unwrap()
        .id;
    for (id, expected) in [(&first, old_secret), (&second, new_secret)] {
        // The equality marker proves snapshot injection without returning the secret.
        let command = format!("if [ \"$APP_TERMINAL_SECRET\" = '{expected}' ]; then printf 'SNAPSHOT-%s' MATCH; fi; printf '%s' \"$APP_TERMINAL_SECRET\"; exit 0\r");
        service
            .write_user_terminal_input(id, command.as_bytes())
            .await
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while !service
                .user_terminal_status(id)
                .await
                .unwrap()
                .output_complete
            {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let page = service
            .read_user_terminal_output(id, 0, 65536)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&page.bytes);
        assert!(text.contains("SNAPSHOT-MATCH") && text.contains("[REDACTED]"));
        assert!(!text.contains(expected));
    }
}

#[tokio::test]
async fn uncached_human_terminate_fence_is_conflict_without_reattachment() {
    let fixture = Fixture::new();
    seed(&fixture, "uncached");
    assert!(fixture
        .manager
        .inner
        .active_sessions
        .read()
        .await
        .is_empty());
    let app = crate::router(fixture.manager.clone());
    let (status, body) = call_public(
        &app,
        "DELETE",
        "/sessions/uncached/terminals/user-shell-previous-owner",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        body["error"],
        "terminal belongs to another or previous service owner"
    );
    assert!(fixture
        .manager
        .inner
        .active_sessions
        .read()
        .await
        .is_empty());
}

#[tokio::test]
async fn cached_previous_config_terminate_is_conflict_after_actual_revisioned_patch() {
    let fixture = Fixture::new();
    let (original, id) = launch(&fixture, "session").await;
    finish(&original, &id).await;
    let prior_version = original.config_version().unwrap();
    let app = crate::router(fixture.manager.clone());
    let (status, _) = call_public(
        &app,
        "PATCH",
        "/sessions/session/config",
        json!({"orchestrator_compaction_threshold": 1}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let current = fixture
        .manager
        .session_state()
        .config_async("session")
        .await
        .unwrap();
    assert!(current.config_version > prior_version);
    assert!(fixture
        .manager
        .inner
        .active_sessions
        .read()
        .await
        .is_empty());
    // An accepted observer/request can retain an old service after the public
    // revisioned update evicts it. Exercise the stale cached-owner branch.
    fixture
        .manager
        .inner
        .active_sessions
        .write()
        .await
        .insert("session".into(), std::sync::Arc::clone(&original));
    let (status, body) = call_public(
        &app,
        "DELETE",
        &format!("/sessions/session/terminals/{id}"),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        body["error"],
        "terminal belongs to another or previous service owner"
    );
    let active = fixture.manager.inner.active_sessions.read().await;
    assert!(std::sync::Arc::ptr_eq(
        active.get("session").unwrap(),
        &original
    ));
    assert_eq!(original.config_version(), Some(prior_version));
    drop(active);
    assert!(!original.user_terminal_status(&id).await.unwrap().alive);
}
