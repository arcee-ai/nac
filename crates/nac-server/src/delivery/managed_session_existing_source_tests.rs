//! Actual cached/store/strict receiver controls for the new typed source only.
use super::*;

fn source_input(f: &Fixture, manager: &SessionManager) -> Value {
    let mut body = host_input(f, "project_existing_session_source");
    body["observation"]["project_id"] = json!("reuse-project");
    body["observation"]["expected_binding"] =
        serde_json::to_value(manager.managed_location_binding().unwrap()).unwrap();
    body["observation"]["selection"] = json!({"behavior":"direct","same_behavior":false});
    body["observation"]["check"] = json!({"mode":"observe"});
    body
}

fn matching(mut request: Value, observed: &Value) -> Value {
    request["observation"]["check"] = json!({
        "mode":"match", "session_id":observed["session_id"],
        "project_revision":observed["project_revision"],
        "behavior":observed["behavior"], "config_version":observed["config_version"]
    });
    request
}

async fn cached_project(
    f: &Fixture,
    manager: &SessionManager,
) -> std::sync::Arc<nac_core::session_service::SessionService> {
    f.register("reuse-project", f.root.clone(), None);
    cache_session_with_messages(f, manager, Vec::new(), Some("reuse-project".into())).await
}

#[tokio::test]
async fn existing_source_observes_and_matches_actual_identity_without_starting_work() {
    let f = Fixture::new();
    let manager = manager(&f);
    let service = cached_project(&f, &manager).await;
    let queued = nac_core::store::create_session_inbox_item(
        &manager.inner.store_path,
        "session",
        nac_core::store::InboxDelivery::Queue,
        "remain queued",
        None,
        None,
    )
    .unwrap();
    let event_boundary = service.recent_events(None, 0).0;
    let serving = Serving::new(manager.clone()).await;
    let request = source_input(&f, &manager);
    let (status, observed) = serving.send(&request).await;
    assert_eq!(status, 200, "{observed}");
    assert_eq!(observed["schema"], "native-existing-session-source.v1");
    assert_eq!(observed["outcome"], "observed");
    assert_eq!(observed["session_id"], "session");
    assert_eq!(observed["project_id"], "reuse-project");
    assert_eq!(observed["behavior"], "direct");
    let actual = nac_core::store::observe_existing_session_source(
        &manager.inner.store_path,
        "session",
        "reuse-project",
    )
    .unwrap();
    assert_eq!(observed["project_revision"], actual.project_revision);
    assert_eq!(observed["config_version"], actual.config_version);
    assert_eq!(observed["host"], request["observation"]["expected_binding"]);
    assert!(serde_json::to_vec(&observed).unwrap().len() <= 8192);
    for forbidden in [
        "configuration",
        "messages",
        "cwd",
        "model",
        "target_revision",
        "session_revision",
    ] {
        assert!(
            observed.get(forbidden).is_none(),
            "unexpected field {forbidden}"
        );
    }
    let (status, matched) = serving.send(&matching(request, &observed)).await;
    assert_eq!(status, 200, "{matched}");
    let mut expected = observed;
    expected["outcome"] = json!("matched");
    assert_eq!(matched, expected);
    assert_eq!(service.recent_events(None, 0).0, event_boundary);
    assert!(!service.has_active_operation());
    assert!(std::sync::Arc::ptr_eq(
        manager
            .inner
            .active_sessions
            .read()
            .await
            .get("session")
            .unwrap(),
        &service,
    ));
    assert!(
        nac_core::store::list_session_inbox(&manager.inner.store_path, "session")
            .unwrap()
            .iter()
            .any(
                |item| item.id == queued.id && item.status == nac_core::store::InboxStatus::Pending
            )
    );
    let c = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM sessions", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        c.query_row("SELECT count(*) FROM native_source_reservations", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    serving.close().await;
}

#[tokio::test]
async fn existing_source_rejects_real_project_revision_and_store_config_or_behavior_change() {
    for changed in ["project", "config", "behavior"] {
        let f = Fixture::new();
        let manager = manager(&f);
        let service = cached_project(&f, &manager).await;
        let serving = Serving::new(manager.clone()).await;
        let request = source_input(&f, &manager);
        let (status, observed) = serving.send(&request).await;
        assert_eq!(status, 200, "{observed}");
        let c = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
        let sql = match changed {
            "project" => {
                "UPDATE projects SET cwd='/tmp/new-project-source' WHERE project_id='reuse-project'"
            }
            "config" => {
                "UPDATE sessions SET config_version=config_version+1 WHERE session_id='session'"
            }
            _ => "UPDATE sessions SET behavior='orchestrator' WHERE session_id='session'",
        };
        c.execute(sql, []).unwrap();
        assert_eq!(
            serving.send(&matching(request.clone(), &observed)).await.0,
            503,
            "{changed}"
        );
        if changed != "project" {
            assert_eq!(
                serving.send(&request).await.0,
                503,
                "stale cached owner {changed}"
            );
        } else {
            let (status, fresh) = serving.send(&request).await;
            assert_eq!(status, 200, "{fresh}");
            assert!(
                fresh["project_revision"].as_i64().unwrap()
                    > observed["project_revision"].as_i64().unwrap()
            );
        }
        assert!(!service.has_active_operation());
        serving.close().await;
    }
}

#[tokio::test]
async fn existing_source_requires_full_binding_and_strict_typed_version_shape() {
    let f = Fixture::new();
    let manager = manager(&f);
    let _service = cached_project(&f, &manager).await;
    let serving = Serving::new(manager.clone()).await;
    let request = source_input(&f, &manager);
    let (status, observed) = serving.send(&request).await;
    assert_eq!(status, 200, "{observed}");
    let good = matching(request.clone(), &observed);
    for field in [
        "logical_host_id",
        "host_incarnation_id",
        "configured_owner",
        "release_id",
        "product_version",
        "build_id",
        "source_revision",
        "build_track",
        "supported_schema_version",
    ] {
        let mut wrong = good.clone();
        wrong["observation"]["expected_binding"][field] = if field == "supported_schema_version" {
            json!(999)
        } else {
            json!("different")
        };
        assert_eq!(serving.send(&wrong).await.0, 409, "{field}");
    }
    for (field, value, status) in [
        ("project_revision", json!(0), 403),
        ("project_revision", json!(-1), 403),
        (
            "project_revision",
            json!(observed["project_revision"].as_i64().unwrap() + 1),
            503,
        ),
        ("config_version", json!(-1), 403),
        (
            "config_version",
            json!(observed["config_version"].as_i64().unwrap() + 1),
            503,
        ),
        ("behavior", json!("orchestrator"), 503),
        ("target_revision", json!(vec![3; 32]), 403),
    ] {
        let mut wrong = good.clone();
        wrong["observation"]["check"][field] = value;
        assert_eq!(serving.send(&wrong).await.0, status, "{field}");
    }
    let mut extra_observe = request.clone();
    extra_observe["observation"]["check"]["project_revision"] = json!(1);
    assert_eq!(serving.send(&extra_observe).await.0, 403);
    let mut oversized = good;
    oversized["observation"]["expected_binding"]["configured_owner"] = json!("x".repeat(4096));
    assert_eq!(serving.send(&oversized).await.0, 403);
    let mut unknown = request;
    unknown["observation"]["check"]["mode"] = json!("create");
    assert_eq!(serving.send(&unknown).await.0, 403);
    serving.close().await;
}

#[tokio::test]
async fn existing_source_missing_cached_service_or_project_refuses_without_attachment() {
    let f = Fixture::new();
    let manager = manager(&f);
    let service = cached_project(&f, &manager).await;
    let retained = SessionObservation::resolve(manager.clone(), "session")
        .await
        .unwrap();
    let serving = Serving::new(manager.clone()).await;
    let request = source_input(&f, &manager);
    let (status, observed) = serving.send(&request).await;
    assert_eq!(status, 200, "{observed}");
    let mut wrong_project = request.clone();
    wrong_project["observation"]["project_id"] = json!("another-project");
    assert_eq!(serving.send(&wrong_project).await.0, 503);
    manager.inner.active_sessions.write().await.clear();
    assert_eq!(serving.send(&request).await.0, 503);
    assert_eq!(serving.send(&matching(request, &observed)).await.0, 503);
    let (_sender, stopping) = tokio::sync::watch::channel(false);
    assert!(retained
        .existing_session_source(
            "reuse-project",
            &manager.managed_location_binding().unwrap(),
            &ExistingSessionCheck::Observe,
            std::time::Instant::now() + std::time::Duration::from_secs(1),
            &stopping,
        )
        .await
        .is_err());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    assert!(!service.has_active_operation());
    serving.close().await;
}

#[tokio::test]
async fn project_source_preserves_canonical_behavior_filter_and_never_falls_back_from_cold_selection(
) {
    let f = Fixture::new();
    let manager = manager(&f);
    let cached = cached_project(&f, &manager).await;
    let mut snapshot = nac_core::sessions::new_snapshot(
        "canonical-cold".into(),
        f.root.clone(),
        "model".into(),
        "https://model.invalid/v1".into(),
        nac_core::model::BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        None,
        Default::default(),
    );
    snapshot.project_id = Some("reuse-project".into());
    snapshot.behavior = nac_core::sessions::SessionBehavior::Orchestrator;
    nac_core::sessions::create_session(&manager.inner.store_path, &snapshot).unwrap();
    let c = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    c.execute(
        "UPDATE sessions SET created_at='9999' WHERE session_id='canonical-cold'",
        [],
    )
    .unwrap();
    let serving = Serving::new(manager.clone()).await;
    let mut request = source_input(&f, &manager);
    // Original canonical selector chooses newest primary, which is cold. The
    // passive source must refuse rather than silently reusing the older cache.
    assert_eq!(serving.send(&request).await.0, 503);
    request["observation"]["selection"]["same_behavior"] = json!(true);
    let (status, observed) = serving.send(&request).await;
    assert_eq!(status, 200, "{observed}");
    assert_eq!(observed["session_id"], "session");
    assert_eq!(observed["behavior"], "direct");
    assert_eq!(manager.inner.active_sessions.read().await.len(), 1);
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("canonical-cold"));
    assert!(!cached.has_active_operation());
    serving.close().await;
}

#[tokio::test]
async fn project_source_stopped_or_expired_original_work_refuses_before_reads() {
    let f = Fixture::new();
    let manager = manager(&f);
    let _cached = cached_project(&f, &manager).await;
    let binding = manager.managed_location_binding().unwrap();
    let (sender, stopping) = tokio::sync::watch::channel(false);
    assert!(SessionObservation::project_existing_session_source(
        manager.clone(),
        "reuse-project",
        &binding,
        None,
        &ExistingSessionCheck::Observe,
        std::time::Instant::now(),
        &stopping,
    )
    .await
    .is_err());
    sender.send(true).unwrap();
    assert!(SessionObservation::project_existing_session_source(
        manager.clone(),
        "reuse-project",
        &binding,
        None,
        &ExistingSessionCheck::Observe,
        std::time::Instant::now() + std::time::Duration::from_secs(1),
        &stopping,
    )
    .await
    .is_err());
    drop(sender);
    assert!(SessionObservation::project_existing_session_source(
        manager,
        "reuse-project",
        &binding,
        None,
        &ExistingSessionCheck::Observe,
        std::time::Instant::now() + std::time::Duration::from_secs(1),
        &stopping,
    )
    .await
    .is_err());
}
