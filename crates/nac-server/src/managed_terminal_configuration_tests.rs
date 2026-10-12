//! Actual revisioned HTTP replacement must not discard a live PTY owner.
use super::*;

#[tokio::test]
async fn live_observed_managed_terminal_excludes_config_eviction_and_keeps_upgrade_blocker() {
    let fixture = Fixture::new();
    let (service, id) = launch(&fixture, "session").await;
    let original_version = service.config_version();
    let app = crate::router(fixture.manager.clone());
    let base = format!("/sessions/session/user-terminals/{id}");
    let (attach_status, attached) = call_public(
        &app,
        "POST",
        &format!("{base}/observers"),
        json!({"protocol_version":1,"page_limit":65536}),
    )
    .await;
    let observer = attached["observer_id"].as_str().map(str::to_owned);
    let (patch_status, patch_body) = call_public(
        &app,
        "PATCH",
        "/sessions/session/config",
        json!({"orchestrator_compaction_threshold":1}),
    )
    .await;
    let persisted_version = fixture
        .manager
        .session_state()
        .config_async("session")
        .await
        .unwrap()
        .config_version;
    let cached_same_owner = fixture
        .manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .is_some_and(|cached| std::sync::Arc::ptr_eq(cached, &service));
    let (list_status, listed) =
        call_public(&app, "GET", "/sessions/session/user-terminals", Value::Null).await;
    let status_status = call_public(&app, "GET", &base, Value::Null).await.0;
    let input_status = call_public(
        &app,
        "POST",
        &format!("{base}/input"),
        json!({"protocol_version":1,"bytes":b"printf 'OWNER-%s' READY; sleep 30\r".to_vec()}),
    )
    .await
    .0;
    let resize_status = call_public(
        &app,
        "POST",
        &format!("{base}/resize"),
        json!({"protocol_version":1,"cols":91,"rows":31}),
    )
    .await
    .0;
    let observed_marker = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let page = service.read_user_terminal_output(&id, 0, 65536).await?;
            if String::from_utf8_lossy(&page.bytes).contains("OWNER-READY") {
                break anyhow::Ok(());
            }
            service
                .wait_for_user_terminal_output(&id, page.retained_end, 1000)
                .await?;
        }
    })
    .await;
    let read_status = if let Some(observer) = observer.as_ref() {
        call_public(
            &app,
            "POST",
            &format!("{base}/observers/{observer}/read"),
            json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":0}),
        )
        .await
        .0
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    let blockers = fixture
        .manager
        .managed_upgrade_blockers_async()
        .await
        .unwrap();
    let retained_terminal_blocker = blockers
        .iter()
        .any(|b| b.kind == nac_core::store::ManagedBlockerKind::TerminalProcess && b.id == id);
    let control = fixture.running_request();
    let assertion = fixture.assertion(ManagedControlAction::Prepare, &control, "config-live-owner");
    let (prepare_status, prepare_body) = call(
        super::super::super::router(fixture.manager.clone()),
        "/v1/upgrade/prepare",
        &control,
        &assertion,
    )
    .await;
    let close_status = call_public(
        &app,
        "DELETE",
        &format!("/sessions/session/terminals/{id}"),
        Value::Null,
    )
    .await
    .0;
    // Record assertions only after explicit owned cleanup, including the red
    // characterization path if replacement incorrectly made routes ownerless.
    service.destroy_terminals().await.unwrap();
    if let Some(observer) = observer {
        fixture
            .manager
            .session_terminals()
            .detach_user("session", &id, uuid::Uuid::parse_str(&observer).unwrap())
            .await
            .unwrap();
    }
    let settled_blockers = fixture
        .manager
        .managed_upgrade_blockers_async()
        .await
        .unwrap();
    assert_eq!(attach_status, StatusCode::OK);
    assert_eq!(patch_status, StatusCode::CONFLICT, "{patch_body}");
    assert_eq!(Some(persisted_version), original_version);
    assert!(cached_same_owner);
    assert_eq!(list_status, StatusCode::OK);
    assert!(listed["terminals"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["terminal_id"] == id));
    assert_eq!(status_status, StatusCode::OK);
    assert_eq!(input_status, StatusCode::NO_CONTENT);
    assert_eq!(resize_status, StatusCode::NO_CONTENT);
    observed_marker.unwrap().unwrap();
    assert_eq!(read_status, StatusCode::OK);
    assert!(retained_terminal_blocker);
    assert_eq!(prepare_status, StatusCode::CONFLICT);
    assert_eq!(
        serde_json::from_str::<Value>(&prepare_body).unwrap()["result"],
        "blocked"
    );
    assert_eq!(close_status, StatusCode::NO_CONTENT);
    assert!(settled_blockers.iter().all(|b| b.kind
        != nac_core::store::ManagedBlockerKind::TerminalProcess
        && b.kind != nac_core::store::ManagedBlockerKind::ResourceLease));
}
