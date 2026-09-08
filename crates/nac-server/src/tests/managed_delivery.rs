use super::*;

/// One-shot stand-in for a provider's model index, answering the first
/// request with `body` and reporting the `Authorization` header it saw — so
/// a test can tell which credential actually went out on the wire.
fn scripted_model_index(body: &'static str) -> (String, std::sync::mpsc::Receiver<String>) {
    use std::io::{Read, Write};

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind model index");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept model index request");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            match socket.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => request.extend_from_slice(&buffer[..read]),
            }
        }
        let authorization = String::from_utf8_lossy(&request)
            .lines()
            .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
            .map(|line| line[line.find(':').unwrap() + 1..].trim().to_string())
            .unwrap_or_default();
        let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        let _ = socket.write_all(response.as_bytes());
        let _ = socket.flush();
        let _ = sender.send(authorization);
    });
    (base_url, receiver)
}

/// A key the UI supplies is filed away under a name the server picks, and
/// from then on that name stands in for the secret: the value never comes
/// back out, and the caller reaches the provider by naming it instead.
#[tokio::test]
async fn a_supplied_key_is_filed_under_a_generated_name_and_answers_by_it() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("generated_credential");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).expect("create NAC home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let app = router(test_manager(&root));

    let stored = post_json(
        app.clone(),
        "/credentials",
        serde_json::json!({ "value": "sk-server-test-key" }),
    )
    .await;
    assert_eq!(stored.status(), StatusCode::OK);
    let name = response_json(stored).await["name"]
        .as_str()
        .expect("generated credential name")
        .to_string();
    assert!(name.starts_with(GENERATED_CREDENTIAL_PREFIX));

    let listed = get_response(app.clone(), "/credentials", None).await;
    let listed = String::from_utf8(response_body(listed).await.to_vec()).unwrap();
    assert!(listed.contains(&name));
    assert!(
        !listed.contains("sk-server-test-key"),
        "a stored key must never be readable back: {listed}"
    );

    let (base_url, authorization) = scripted_model_index(r#"{"data":[{"id":"model-a"}]}"#);
    let models = post_json(
        app,
        "/providers/models",
        serde_json::json!({
            "backend": "openai-responses",
            "api_key_env": name,
            "base_url": base_url,
        }),
    )
    .await;
    assert_eq!(models.status(), StatusCode::OK);
    let models = response_json(models).await;
    assert_eq!(models["models"][0]["id"], "model-a");
    assert_eq!(
        authorization
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the model index was asked"),
        "Bearer sk-server-test-key"
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_host_secret_api_is_write_only_and_unmanaged_hosts_fail_closed() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_secret_api");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);

    let unmanaged = router(test_manager(&root));
    let response = get_response(unmanaged, "/managed/secrets", None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let app = router(test_managed_manager(&root));
    let canary = "managed-canary-value-that-must-not-return";
    let stored = put_json(
        app.clone(),
        "/managed/secrets/DEMO_TOKEN",
        serde_json::json!({ "value": canary }),
    )
    .await;
    assert_eq!(stored.status(), StatusCode::OK);
    let stored_body = String::from_utf8(response_body(stored).await.to_vec()).unwrap();
    assert!(stored_body.contains("DEMO_TOKEN"));
    assert!(!stored_body.contains(canary));

    let listed = get_response(app.clone(), "/managed/secrets", None).await;
    assert_eq!(listed.status(), StatusCode::OK);
    let listed_body = String::from_utf8(response_body(listed).await.to_vec()).unwrap();
    assert!(listed_body.contains("DEMO_TOKEN"));
    assert!(listed_body.contains("\"healthy\":true"));
    assert!(!listed_body.contains(canary));

    let rejected = put_json(
        app.clone(),
        "/managed/secrets/PATH",
        serde_json::json!({ "value": canary }),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert!(!String::from_utf8(response_body(rejected).await.to_vec())
        .unwrap()
        .contains(canary));

    let deleted = app
        .clone()
        .oneshot(
            Request::builder()
                .method(axum::http::Method::DELETE)
                .uri("/managed/secrets/DEMO_TOKEN")
                .header(header::HOST, "127.0.0.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let listed = get_response(app, "/managed/secrets", None).await;
    assert!(!String::from_utf8(response_body(listed).await.to_vec())
        .unwrap()
        .contains("DEMO_TOKEN"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_host_supplies_default_model_and_mounted_credential() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_model_default");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_managed_credential(&root.join("model-token"), "host-model-key\n");
    let manager = test_managed_manager(&root);

    let created = manager
        .create_session(CreateSessionRequest::default())
        .await
        .expect("managed host profile should launch without user model settings");
    let session_id = created
        .metadata
        .session_id
        .clone()
        .expect("created session id");
    let stored = sessions::load_session(&root.join("store.db"), &session_id).unwrap();
    assert_eq!(stored.backend, BackendKind::ArceeApi);
    assert_eq!(stored.model, "trinity-large-thinking");
    assert_eq!(stored.base_url, "https://api.arcee.ai/api/v1");
    assert_eq!(stored.api_key_env, None);

    manager
        .inner
        .active_sessions
        .write()
        .await
        .remove(&session_id);
    manager
        .attach_session(&session_id)
        .await
        .expect("mounted credential source should survive session resume");

    let app = router(manager);
    let listing = response_json(get_response(app.clone(), "/models", None).await).await;
    let arcee = listing["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|provider| provider["id"] == "arcee-api")
        .unwrap();
    assert_eq!(arcee["auth_status"], "ready");
    assert_eq!(arcee["auth_hint"], serde_json::Value::Null);
    assert_eq!(arcee["default_base_url"], "https://api.arcee.ai/api/v1");

    let status = response_json(get_response(app, "/managed/status", None).await).await;
    assert_eq!(status["model"]["backend"], "arcee-api");
    assert_eq!(status["model"]["id"], "trinity-large-thinking");
    assert!(status["model_ready"].is_boolean());
    assert!(!status.to_string().contains("host-model-key"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_preserved_legacy_auth_is_tombstoned_but_never_authorized() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_preserved_legacy_auth");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let auth_path = nac_home.join("arcee_auth.json");
    let original_auth = std::fs::read(&auth_path).unwrap();
    write_managed_credential(
        &nac_home.join("arcee_managed_bootstrap_receipt.json"),
        serde_json::json!({
            "version": 1,
            "bootstrap_id": "4712bc5e-30d5-421a-b416-8291d9f7d8f9",
            "managed_host_id": "21856443-8ed8-40ab-9036-72e837c99f27",
            "client_id": "managed-nac",
            "disposition": "preserved_existing"
        })
        .to_string(),
    );
    let manager = test_managed_bootstrap_manager(&root);

    let create_error = manager
        .create_session(CreateSessionRequest::default())
        .await
        .expect_err("a preserved nac-cli credential must not authorize managed creation");
    let create_error = format!("{create_error:#}");
    assert!(
        create_error.contains("did not import a usable managed credential"),
        "{create_error}"
    );
    assert!(!create_error.contains("arcee-access-server-test"));
    assert!(sessions::list_sessions(&root.join("store.db"))
        .unwrap()
        .is_empty());

    let snapshot = sessions::new_snapshot(
        "preserved-legacy-resume".to_string(),
        root.clone(),
        "another-entitled-arcee-model".to_string(),
        "https://api.arcee.ai".to_string(),
        BackendKind::ArceeAuth,
        None,
        None,
        None,
        Vec::new(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    let resume_error = match manager.attach_session("preserved-legacy-resume").await {
        Ok(_) => panic!("a preserved nac-cli credential must not authorize managed resume"),
        Err(error) => format!("{error:#}"),
    };
    assert!(resume_error.contains("did not import a usable managed credential"));
    assert!(!resume_error.contains("arcee-refresh-server-test"));

    let app = router(manager);
    let listing = response_json(get_response(app.clone(), "/models", None).await).await;
    let arcee = listing["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|provider| provider["id"] == "arcee-auth")
        .unwrap();
    assert_eq!(arcee["auth_status"], "no_credential");
    assert_eq!(arcee["auth_hint"], serde_json::Value::Null);

    let status = response_json(get_response(app, "/managed/status", None).await).await;
    assert_eq!(status["model_ready"], false);
    assert!(!status.to_string().contains("arcee-access-server-test"));
    assert_eq!(std::fs::read(&auth_path).unwrap(), original_auth);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_bootstrap_corruption_blocks_create_and_resume_without_secret_echo() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_bootstrap_fail_closed");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let receipt_canary = "receipt-secret-canary";
    write_managed_credential(
        &nac_home.join("arcee_managed_bootstrap_receipt.json"),
        format!(r#"{{"refresh_token":"{receipt_canary}""#),
    );
    let manager = test_managed_bootstrap_manager(&root);

    let create_error = manager
        .create_session(CreateSessionRequest {
            cwd: Some(root.clone()),
            model: RequestField::Value("another-entitled-arcee-model".to_string()),
            base_url: RequestField::Value("https://api.arcee.ai".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            api_key_env: RequestField::Null,
            ..CreateSessionRequest::default()
        })
        .await
        .expect_err("an invalid receipt must block managed session creation");
    let create_error = format!("{create_error:#}");
    assert!(
        create_error.contains("receipt is invalid"),
        "{create_error}"
    );
    assert!(!create_error.contains(receipt_canary));
    assert!(sessions::list_sessions(&root.join("store.db"))
        .unwrap()
        .is_empty());

    let snapshot = sessions::new_snapshot(
        "managed-resume".to_string(),
        root.clone(),
        "another-entitled-arcee-model".to_string(),
        "https://api.arcee.ai".to_string(),
        BackendKind::ArceeAuth,
        None,
        None,
        None,
        Vec::new(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    let resume_error = match manager.attach_session("managed-resume").await {
        Ok(_) => panic!("an invalid receipt must block managed session resume"),
        Err(error) => error,
    };
    let resume_error = format!("{resume_error:#}");
    assert!(
        resume_error.contains("receipt is invalid"),
        "{resume_error}"
    );
    assert!(!resume_error.contains(receipt_canary));

    write_managed_credential(
        &nac_home.join("arcee_managed_bootstrap_receipt.json"),
        serde_json::json!({
            "version": 1,
            "bootstrap_id": "4712bc5e-30d5-421a-b416-8291d9f7d8f9",
            "managed_host_id": "21856443-8ed8-40ab-9036-72e837c99f27",
            "client_id": "managed-nac",
            "disposition": "imported"
        })
        .to_string(),
    );
    let auth_canary = "auth-schema-secret-canary";
    write_managed_credential(
        &nac_home.join("arcee_auth.json"),
        serde_json::json!({
            "type": "arcee_device_token",
            "access_token": "access-secret-canary",
            "refresh_token": "refresh-secret-canary",
            "token_type": "bearer",
            "expires_at_ms": auth_canary,
            "base_url": "https://api.arcee.ai",
            "organization_id": "org-server-test",
            "workspace_name": "server-test"
        })
        .to_string(),
    );
    let auth_error = manager
        .create_session(CreateSessionRequest::default())
        .await
        .expect_err("a malformed durable credential must block managed creation");
    let auth_error = format!("{auth_error:#}");
    assert!(auth_error.contains("failed to parse stored Arcee auth schema"));
    for canary in [auth_canary, "access-secret-canary", "refresh-secret-canary"] {
        assert!(!auth_error.contains(canary));
    }

    let status = response_json(get_response(router(manager), "/managed/status", None).await).await;
    assert_eq!(status["model_ready"], false);
    let status = status.to_string();
    for canary in [
        receipt_canary,
        auth_canary,
        "access-secret-canary",
        "refresh-secret-canary",
    ] {
        assert!(!status.contains(canary));
    }

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_github_status_is_metadata_only_and_unmanaged_hosts_fail_closed() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_github_status");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);

    let unmanaged = router(test_manager(&root));
    let response = get_response(unmanaged.clone(), "/managed/github", None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let response = get_response(
        unmanaged,
        "/managed/github/clone-operations/0123456789abcdef0123456789abcdef",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let manager = test_managed_manager(&root);
    let app = router(manager.clone());
    let response = get_response(app.clone(), "/managed/github", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(response_body(response).await.to_vec()).unwrap();
    assert!(body.contains("\"configured\":true"));
    assert!(body.contains("\"connected\":false"));
    assert!(!body.contains("access_token"));
    assert!(!body.contains("refresh_token"));
    let invalid_operation = get_response(
        app.clone(),
        "/managed/github/clone-operations/not-an-operation",
        None,
    )
    .await;
    assert_eq!(invalid_operation.status(), StatusCode::BAD_REQUEST);
    let missing_operation = get_response(
        app.clone(),
        "/managed/github/clone-operations/0123456789abcdef0123456789abcdef",
        None,
    )
    .await;
    assert_eq!(missing_operation.status(), StatusCode::NOT_FOUND);

    manager
        .managed_github_auth()
        .unwrap()
        .store_test_authorization(
            "server-status-access-canary",
            "server-status-refresh-canary",
            u64::MAX,
        )
        .unwrap();
    let connected = get_response(app.clone(), "/managed/github", None).await;
    assert_eq!(connected.status(), StatusCode::OK);
    let connected = String::from_utf8(response_body(connected).await.to_vec()).unwrap();
    assert!(connected.contains("\"connected\":true"));
    assert!(connected.contains("\"git_configured\":true"));
    assert!(connected.contains("42+test-user@users.noreply.github.com"));
    assert!(!connected.contains("server-status-access-canary"));
    assert!(!connected.contains("server-status-refresh-canary"));

    let disconnected = app
        .oneshot(
            Request::builder()
                .method(axum::http::Method::DELETE)
                .uri("/managed/github")
                .header(header::HOST, "127.0.0.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(disconnected.status(), StatusCode::OK);
    let body = String::from_utf8(response_body(disconnected).await.to_vec()).unwrap();
    assert!(body.contains("\"connected\":false"));
    assert!(!body.contains("token"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn saved_config_managed_updates_clear_inherited_light_selectors() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("saved_config_managed_light_clear");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let inherited_selector = "NAC_CONFIG_OLD_KEY";
    let managed_light = || LightModelSettings {
        model: "trinity-large-thinking".to_string(),
        backend: Some(BackendKind::ArceeAuth),
        base_url: None,
        api_key_env: Some(inherited_selector.to_string()),
        reasoning_effort: None,
    };

    model_configurations::insert_model_configuration(
        &manager.inner.store_path,
        "repair",
        model_configurations::NewModelConfiguration {
            name: "Managed repair".to_string(),
            backend: BackendKind::ArceeAuth.to_string(),
            model: "trinity-large-thinking".to_string(),
            base_url: nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL.to_string(),
            api_key_env: Some(inherited_selector.to_string()),
            reasoning_effort: None,
            extra_headers: BTreeMap::new(),
            orchestrator_compaction_threshold: None,
            initial_prompt: None,
            light_model: Some(managed_light()),
        },
    )
    .unwrap();
    let Json(repaired) = delivery::model_configurations::update_handler(
        State(manager.clone()),
        AxumPath("repair".to_string()),
        Ok(Json(UpdateModelConfigurationRequest::default())),
    )
    .await
    .expect("managed repair clears inherited selectors");
    assert_eq!(repaired.api_key_env, None);
    assert_eq!(
        repaired
            .light_model
            .as_ref()
            .and_then(|light| light.api_key_env.as_deref()),
        None
    );

    model_configurations::insert_model_configuration(
        &manager.inner.store_path,
        "switch",
        model_configurations::NewModelConfiguration {
            name: "Managed switch".to_string(),
            backend: BackendKind::ArceeApi.to_string(),
            model: "trinity-large-thinking".to_string(),
            base_url: "https://api.arcee.ai/api/v1".to_string(),
            api_key_env: Some(inherited_selector.to_string()),
            reasoning_effort: None,
            extra_headers: BTreeMap::new(),
            orchestrator_compaction_threshold: None,
            initial_prompt: None,
            light_model: None,
        },
    )
    .unwrap();
    let Json(switched) = delivery::model_configurations::update_handler(
        State(manager.clone()),
        AxumPath("switch".to_string()),
        Ok(Json(UpdateModelConfigurationRequest {
            backend: RequestField::Value(BackendKind::ArceeAuth),
            light_model: RequestField::Value(managed_light()),
            ..UpdateModelConfigurationRequest::default()
        })),
    )
    .await
    .expect("managed switch clears inherited selectors");
    assert_eq!(switched.api_key_env, None);
    assert_eq!(
        switched
            .light_model
            .as_ref()
            .and_then(|light| light.api_key_env.as_deref()),
        None
    );

    let _ = std::fs::remove_dir_all(root);
}

/// Naming a credential is not a way to probe for one: a name with nothing
/// behind it is refused before any request goes out, and a provider that
/// signs in through the browser takes no name at all.
#[tokio::test]
async fn the_model_index_refuses_an_unresolvable_name_and_a_login_backend() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("model_index_by_name");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).expect("create NAC home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let app = router(test_manager(&root));

    let unresolvable = post_json(
        app.clone(),
        "/providers/models",
        serde_json::json!({
            "backend": "openai-responses",
            "api_key_env": "NAC_CONFIG_absent",
        }),
    )
    .await;
    assert_eq!(unresolvable.status(), StatusCode::BAD_REQUEST);
    let message = response_json(unresolvable).await["error"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        message.contains("NAC_CONFIG_absent"),
        "the refusal names what could not be resolved: {message}"
    );

    let managed = post_json(
        app,
        "/providers/models",
        serde_json::json!({
            "backend": "chatgpt-codex-responses",
            "api_key_env": "NAC_CONFIG_absent",
        }),
    )
    .await;
    assert_eq!(managed.status(), StatusCode::BAD_REQUEST);
    let message = response_json(managed).await["error"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        message.contains("stored login"),
        "a login backend explains that it takes no key: {message}"
    );

    let _ = std::fs::remove_dir_all(root);
}
