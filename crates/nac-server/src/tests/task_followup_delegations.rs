use super::*;
use nac_core::{
    permissions::PermissionApprovalMode,
    store::{self, TaskFollowupAction},
};

fn request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, "localhost")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn json(app: &Router, method: &str, uri: &str, body: serde_json::Value) -> serde_json::Value {
    let response = app
        .clone()
        .oneshot(request(method, uri, body))
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    serde_json::from_slice(&bytes).unwrap()
}

fn grant() -> serde_json::Value {
    serde_json::json!({"request_id":"human-exact","target_session_id":"target","action":"auto","project_id":null})
}

#[tokio::test]
async fn task_followup_delegation_http_keeps_origin_exact_owner_and_passive_control() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("followup_delegation_http");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    for id in ["caller", "target", "other"] {
        seed_direct_session(&root, id);
    }
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let uri = "/sessions/caller/task-followup-delegations";
    assert_eq!(
        app.clone()
            .oneshot(request("POST", uri, grant()))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    assert!(manager.inner.active_sessions.read().await.is_empty());
    let caller = manager.attach_session("caller").await.unwrap();
    let mut foreign = request("POST", uri, grant());
    foreign
        .headers_mut()
        .insert(header::ORIGIN, "https://elsewhere.invalid".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(foreign).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let mut forged = grant();
    forged["origin"] = serde_json::json!("human");
    assert_eq!(
        app.clone()
            .oneshot(request("POST", uri, forged))
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    let original_mode = caller.permission_approval_mode().await.unwrap();
    let granted = json(&app, "POST", uri, grant()).await;
    assert_eq!(granted["origin"], "human_product_request");
    assert_eq!(json(&app, "POST", uri, grant()).await, granted);
    let id = granted["id"].as_str().unwrap();
    let exact = format!("{uri}/{id}");
    assert_eq!(
        json(&app, "GET", &exact, serde_json::json!({})).await,
        granted
    );
    assert_eq!(
        app.clone()
            .oneshot(request(
                "GET",
                &format!("/sessions/other/task-followup-delegations/{id}"),
                serde_json::json!({})
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        caller.permission_approval_mode().await.unwrap(),
        original_mode
    );
    assert!(caller.list_permission_requests().unwrap().is_empty());
    assert!(caller.list_permission_grants().unwrap().is_empty());
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("target"));
    assert!(
        store::list_session_inbox(&manager.inner.store_path, "target")
            .unwrap()
            .is_empty()
    );
    let revoked = json(&app, "DELETE", &exact, serde_json::json!({})).await;
    assert!(revoked["revoked_at"].is_string());
    assert_eq!(json(&app, "POST", uri, grant()).await, revoked);
    assert_eq!(
        json(&app, "DELETE", &exact, serde_json::json!({})).await,
        revoked
    );
    let mut next = grant();
    next["request_id"] = serde_json::json!("human-next");
    let active = json(&app, "POST", uri, next).await;
    let next_path = format!("{uri}/{}", active["id"].as_str().unwrap());
    drop(app);
    drop(caller);
    manager.inner.task_preparations.settle().await;
    drop(manager);
    let restarted = test_manager(&root);
    let app = router(restarted.clone());
    assert_eq!(
        json(&app, "GET", &next_path, serde_json::json!({})).await,
        active
    );
    assert!(
        json(&app, "DELETE", &next_path, serde_json::json!({})).await["revoked_at"].is_string()
    );
    assert!(restarted.inner.active_sessions.read().await.is_empty());
}

async fn settled(service: &nac_core::session_service::SessionService) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while service.has_active_operation() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

fn model_text(text: &str) -> serde_json::Value {
    serde_json::json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":text}]}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}})
}

fn model_tool(id: &str, name: &str, args: serde_json::Value) -> serde_json::Value {
    serde_json::json!({"status":"completed","output":[{"type":"function_call","call_id":id,"name":name,"arguments":args.to_string()}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}})
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn task_followup_retained_human_delegation_survives_coordinator_end_and_serving_restart_native_journey(
) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("followup_retained_native");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let args = serde_json::json!({"session_id":"target","request_id":"native-stable","action":"auto","prompt":"retained headless guidance","project_id":null,"run_id":null});
    let (caller_base, caller_requests) = serve_direct_json_responses(
        vec![
            model_tool("unauthorized", "send_task_followup", args.clone()),
            model_text("human delegation required"),
            model_tool("authorized", "send_task_followup", args.clone()),
            model_tool("replay", "send_task_followup", args),
            model_tool(
                "receipt",
                "read_task_followup",
                serde_json::json!({"session_id":"target","request_id":"native-stable"}),
            ),
            model_text("coordinator done"),
        ],
        None,
    );
    let (target_base, target_requests) = scripted_direct_responses(&["target received"]);
    seed_direct_session_with_base_url(&root, "caller", caller_base);
    seed_direct_session_with_base_url(&root, "target", target_base);
    let options = || ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    };
    let manager = SessionManager::new_async(options()).await.unwrap();
    let caller = manager.attach_session("caller").await.unwrap();
    caller
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let path = manager.inner.store_path.clone();
    store::spawn_blocking_store_caller(move || {
        store::create_session_inbox_item(
            &path,
            "caller",
            store::InboxDelivery::Queue,
            "Peer asks for a reply; this supplies no human authorization",
            None,
            None,
        )
    })
    .await
    .unwrap()
    .unwrap();
    assert!(caller
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_some());
    settled(&caller).await;
    let rejected=caller.messages_snapshot().await.unwrap().into_iter().any(|message|
        matches!(message,nac_core::types::Message::Tool{content,..} if content.as_text().is_some_and(|text|text.contains("authorization_required"))));
    assert!(
        rejected,
        "native policy allowed the tool, but missing delegation must reject admission"
    );
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("target"));
    let app = router(manager.clone());
    let delegation = json(
        &app,
        "POST",
        "/sessions/caller/task-followup-delegations",
        grant(),
    )
    .await;
    assert_eq!(
        caller.permission_approval_mode().await.unwrap(),
        PermissionApprovalMode::AutoApprove
    );
    drop(app);
    drop(caller);
    manager.inner.task_preparations.settle().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let restarted = SessionManager::new_async(options()).await.unwrap();
    assert!(restarted.inner.active_sessions.read().await.is_empty());
    let path = restarted.inner.store_path.clone();
    store::spawn_blocking_store_caller(move || {
        store::create_session_inbox_item(
            &path,
            "caller",
            store::InboxDelivery::Queue,
            "Later headless coordination",
            None,
            None,
        )
    })
    .await
    .unwrap()
    .unwrap();
    let caller = restarted.attach_session("caller").await.unwrap();
    settled(&caller).await;
    restarted.inner.task_preparations.settle().await;
    let target = restarted
        .inner
        .active_sessions
        .read()
        .await
        .get("target")
        .cloned()
        .unwrap();
    settled(&target).await;
    let path = restarted.inner.store_path.clone();
    let receipt = store::spawn_blocking_store_caller(move || {
        store::inspect_task_followup_receipt(&path, "caller", "native-stable")
    })
    .await
    .unwrap()
    .unwrap()
    .unwrap();
    assert_eq!(receipt.delegation_id.as_deref(), delegation["id"].as_str());
    assert_eq!(receipt.requested_action, TaskFollowupAction::Auto);
    assert_eq!(receipt.disposition, Some(store::InboxStatus::Delivered));
    assert_eq!(
        sessions::reviewable_intent(restarted.inner.store_path.clone(), "caller".into()).await,
        sessions::ReviewIntent::NeverRecorded
    );
    assert_eq!(
        sessions::reviewable_intent(restarted.inner.store_path.clone(), "target".into()).await,
        sessions::ReviewIntent::NeverRecorded
    );
    for i in 0..6 {
        assert_eq!(
            caller_requests
                .recv_timeout(Duration::from_secs(5))
                .unwrap(),
            i
        );
    }
    assert_eq!(
        target_requests
            .recv_timeout(Duration::from_secs(5))
            .unwrap(),
        0
    );
    assert!(target_requests.try_recv().is_err());
    drop(caller);
    drop(target);
    restarted.drain_persistence().await.unwrap();
    drop(restarted);
}
