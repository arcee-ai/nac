use super::super::effect_lease_test_support::ControlledLease;
use super::super::test_http::{ScriptedResponse, ScriptedServer};
use super::*;

fn auth() -> StoredCodexAuth {
    StoredCodexAuth {
        auth_type: AUTH_TYPE.into(),
        access: "fixture-access".into(),
        refresh: "fixture-refresh".into(),
        expires_at_ms: u64::MAX,
        account_id: "fixture-account".into(),
    }
}

#[tokio::test]
async fn leased_codex_transport_capacity_and_stream_errors_cannot_reset_or_replay() {
    for response in [
        ScriptedResponse::json("503 Service Unavailable", "busy").with_header("Retry-After", "0"),
        ScriptedResponse::json("200 OK", "").drop_connection(),
        ScriptedResponse::json("200 OK", "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"type\":\"overloaded_error\",\"message\":\"retry\"}}}\n\n")
            .with_header("Retry-After", "0"),
    ] {
        let server = ScriptedServer::start(vec![response]);
        let scope = CallEffectScope::new(true, Some(ControlledLease::new(0))).unwrap();
        let sink = |_delta| panic!("leased failure cannot emit retry reset");
        let error = tokio::time::timeout(Duration::from_secs(1), post_codex_json_with_retry_delay_effects(
            &Client::new(), &server.base_url, &json!({"stream":true}), &auth(), None, Some(&sink),
            |_| Duration::ZERO, &scope)).await.unwrap().unwrap_err();
        assert_eq!(error.attempt_count, 1);
        assert_eq!(server.finish().len(), 1);
    }
}

#[tokio::test]
async fn codex_current_denial_prevents_credential_file_access() {
    let scope = CallEffectScope::new(true, Some(ControlledLease::new(1))).unwrap();
    let error = fresh_auth_with_effects(&Client::new(), &scope, false)
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "managed runtime effect lease denied");
    assert!(!error.to_string().contains("fixture-access"));
}

#[tokio::test]
async fn codex_denial_before_send_is_permanent_and_sanitized() {
    let server = ScriptedServer::start_unexpected_request_server(Duration::from_millis(80));
    let scope = CallEffectScope::new(true, Some(ControlledLease::new(1))).unwrap();
    let error = post_codex_json_with_retry_delay_effects(
        &Client::new(),
        &server.base_url,
        &json!({}),
        &auth(),
        None,
        None,
        |_| Duration::ZERO,
        &scope,
    )
    .await
    .unwrap_err();
    assert_eq!(error.message, "managed runtime effect lease denied");
    assert!(!error.can_retry_stream());
    assert_eq!(server.finish().len(), 0);
}

#[tokio::test]
async fn lease_cancels_contended_codex_lock_without_background_lock_worker() {
    let directory = std::env::temp_dir().join(format!("nac-codex-effect-{}", Uuid::new_v4()));
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("auth.lock");
    let held = FileLock::acquire(&path).unwrap();
    let lease = ControlledLease::new(0);
    let scope = CallEffectScope::new(true, Some(lease.clone())).unwrap();
    let denial = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(35)).await;
        lease.deny();
    });
    let error = tokio::time::timeout(
        Duration::from_secs(1),
        scope.run(acquire_effect_auth_lock(&path, &scope)),
    )
    .await
    .unwrap()
    .err()
    .unwrap();
    assert_eq!(error.to_string(), "managed runtime effect lease denied");
    denial.await.unwrap();
    drop(held);
    let acquired = FileLock::acquire(&path).unwrap();
    drop(acquired);
    fs::remove_dir_all(directory).unwrap();
}
