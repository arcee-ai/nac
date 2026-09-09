use super::*;

fn write_imported_managed_arcee_state(
    nac_home: &std::path::Path,
    inference_base_url: &str,
    auth_issuer: &str,
) {
    write_managed_credential(
        &nac_home.join("arcee_auth.json"),
        serde_json::json!({
            "type": "arcee_device_token",
            "access_token": "managed-access-server-test",
            "refresh_token": "managed-refresh-server-test",
            "token_type": "bearer",
            "expires_at_ms": u64::MAX,
            "base_url": inference_base_url,
            "organization_id": "org-managed-server-test",
            "workspace_name": "managed-server-test",
            "auth_issuer": auth_issuer,
            "client_id": "managed-nac",
            "managed_bootstrap": {
                "bootstrap_id": "4712bc5e-30d5-421a-b416-8291d9f7d8f9",
                "managed_host_id": "21856443-8ed8-40ab-9036-72e837c99f27"
            }
        })
        .to_string(),
    );
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
    write_managed_credential(
        &nac_home.join("arcee_managed_repair.json"),
        serde_json::json!({
            "version": 1,
            "bootstrap_id": "4712bc5e-30d5-421a-b416-8291d9f7d8f9",
            "managed_host_id": "21856443-8ed8-40ab-9036-72e837c99f27",
            "repair_intent": "managed-server-repair-intent-canary-0123456789"
        })
        .to_string(),
    );
}

fn scripted_managed_arcee_login(inference_base_url: &str) -> (String, std::thread::JoinHandle<()>) {
    use std::io::{Read, Write};

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let inference_base_url = inference_base_url.to_string();
    let handle = std::thread::spawn(move || {
        let responses = [
            serde_json::json!({
                "device_code": "managed-device-server-test",
                "user_code": "MANAGED-SERVER",
                "verification_uri_complete": "https://accounts.arcee.ai/device?code=MANAGED-SERVER",
                "interval": 1,
                "expires_in": 60
            })
            .to_string(),
            serde_json::json!({
                "access_token": "repaired-access-server-test",
                "refresh_token": "repaired-refresh-server-test",
                "token_type": "bearer",
                "expires_in": 3600,
                "base_url": inference_base_url,
                "organization_id": "org-repaired-server-test",
                "workspace_name": "repaired-server-test",
                "managed_binding": {
                    "managed_host_id": "21856443-8ed8-40ab-9036-72e837c99f27",
                    "bootstrap_id": "4712bc5e-30d5-421a-b416-8291d9f7d8f9",
                    "host_incarnation_id": "managed-server-incarnation-canary",
                    "auth_issuer": nac_core::model::ARCEE_AUTH_DEV2_ISSUER,
                    "inference_base_url": inference_base_url
                }
            })
            .to_string(),
        ];
        for body in responses {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let count = socket.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..count]);
            }
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).unwrap();
        }
    });
    (base_url, handle)
}

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

async fn live_get_json(address: std::net::SocketAddr, path: &str) -> (u16, serde_json::Value) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("connect to live test server");
    stream
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .expect("write live test request");
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .await
        .expect("read live test response");
    let response = String::from_utf8(response).expect("UTF-8 live test response");
    let (head, body) = response
        .split_once("\r\n\r\n")
        .expect("HTTP response separator");
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .expect("HTTP response status");
    let body = serde_json::from_str(body).unwrap_or_else(|_| serde_json::json!({ "body": body }));
    (status, body)
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
    assert_eq!(
        status["version"],
        include_str!("../../../../version.txt").trim()
    );
    assert_eq!(status["product_version"], status["version"]);
    assert_eq!(status["build_track"], env!("NAC_BUILD_TRACK"));
    assert_eq!(status["build_id"], env!("NAC_BUILD_ID"));
    assert_eq!(status["source_revision"], env!("NAC_SOURCE_REVISION"));
    assert_eq!(
        status["supported_schema_version"],
        nac_core::store::schema_version()
    );
    assert_eq!(
        status["minimum_migratable_schema_version"],
        nac_core::store::MINIMUM_MIGRATABLE_SCHEMA_VERSION
    );
    assert_eq!(
        status["opened_schema_version"],
        nac_core::store::schema_version()
    );
    assert_eq!(status["migration_state"], "current");
    assert_eq!(status["migration_failure"], serde_json::Value::Null);
    assert_eq!(status["maintenance_state"], "serving");
    assert!(!status.to_string().contains("host-model-key"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn readiness_and_managed_status_sanitize_future_schema_failure() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_future_schema_status");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_managed_credential(&root.join("model-token"), "future-schema-secret-canary\n");
    let store_path = root.join("store.db");
    nac_core::store::initialize(&store_path).unwrap();
    let future = nac_core::store::schema_version() + 1;
    nac_core::test_support::store::set_test_schema_version(&store_path, future).unwrap();
    let app = router(test_managed_manager(&root));

    let ready = get_response(app.clone(), "/readyz", None).await;
    assert_eq!(ready.status(), StatusCode::SERVICE_UNAVAILABLE);
    let ready = response_json(ready).await;
    assert_eq!(
        ready["supported_schema_version"],
        nac_core::store::schema_version()
    );
    assert_eq!(
        ready["minimum_migratable_schema_version"],
        nac_core::store::MINIMUM_MIGRATABLE_SCHEMA_VERSION
    );
    assert_eq!(ready["opened_schema_version"], future);
    assert_eq!(ready["migration_state"], "failed");
    assert_eq!(ready["migration_failure"], "future-schema");
    assert_eq!(ready["maintenance_state"], "unavailable");

    let status = response_json(get_response(app, "/managed/status", None).await).await;
    assert_eq!(status["ready"], false);
    assert_eq!(
        status["minimum_migratable_schema_version"],
        nac_core::store::MINIMUM_MIGRATABLE_SCHEMA_VERSION
    );
    assert_eq!(status["opened_schema_version"], future);
    assert_eq!(status["migration_state"], "failed");
    assert_eq!(status["migration_failure"], "future-schema");
    let encoded = status.to_string();
    assert!(!encoded.contains("future-schema-secret-canary"));
    assert!(!encoded.contains(&store_path.display().to_string()));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_recovery_listener_stays_unready_after_external_store_repair() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_startup_migration_recovery");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_managed_credential(&root.join("model-token"), "startup-secret-canary\n");
    let store_path = root.join("store.db");
    nac_core::store::initialize(&store_path).unwrap();
    let future = nac_core::store::schema_version() + 1;
    nac_core::test_support::store::set_test_schema_version(&store_path, future).unwrap();
    let manager = test_managed_manager(&root);
    let (listening_tx, listening_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        serve_with_policy(
            "127.0.0.1:0".parse().unwrap(),
            BindPolicy::LoopbackOnly,
            manager,
            move |address| {
                let _ = listening_tx.send(address);
            },
        )
        .await
    });
    let address = tokio::time::timeout(std::time::Duration::from_secs(2), listening_rx)
        .await
        .expect("managed recovery server bind timed out")
        .expect("managed recovery server stopped before binding");

    let (status, ready) = live_get_json(address, "/readyz").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE.as_u16());
    assert_eq!(ready["migration_failure"], "future-schema");
    assert_eq!(ready["maintenance_state"], "recovery-only");

    let (status, managed) = live_get_json(address, "/managed/status").await;
    assert_eq!(status, StatusCode::OK.as_u16());
    assert_eq!(managed["opened_schema_version"], future);
    assert_eq!(managed["migration_failure"], "future-schema");
    assert_eq!(managed["maintenance_state"], "recovery-only");
    let encoded = managed.to_string();
    assert!(!encoded.contains("startup-secret-canary"));
    assert!(!encoded.contains(&store_path.display().to_string()));

    let (status, _) = live_get_json(address, "/sessions").await;
    assert_eq!(status, StatusCode::NOT_FOUND.as_u16());

    // Model a peer completing the shared-store repair after this process has
    // permanently selected its recovery-only router. It must not advertise
    // readiness or serving until a restart constructs the full router.
    nac_core::test_support::store::set_test_schema_version(
        &store_path,
        nac_core::store::schema_version(),
    )
    .unwrap();
    nac_core::store::check_readiness(&store_path).unwrap();

    let (status, ready) = live_get_json(address, "/readyz").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE.as_u16());
    assert_eq!(ready["migration_state"], "current");
    assert_eq!(ready["migration_failure"], serde_json::Value::Null);
    assert_eq!(ready["maintenance_state"], "recovery-only");

    let (status, managed) = live_get_json(address, "/managed/status").await;
    assert_eq!(status, StatusCode::OK.as_u16());
    assert_eq!(managed["ready"], false);
    assert_eq!(managed["migration_state"], "current");
    assert_eq!(managed["maintenance_state"], "recovery-only");

    let (status, _) = live_get_json(address, "/sessions").await;
    assert_eq!(status, StatusCode::NOT_FOUND.as_u16());

    server.abort();
    let _ = server.await;
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn mounted_key_discovers_every_entitled_model_only_at_its_configured_destination() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("mounted_model_discovery");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_managed_credential(&root.join("model-token"), "mounted-model-index-key\n");
    let (base_url, authorization) = scripted_model_index(
        r#"{"data":[{"id":"trinity-large-thinking"},{"id":"moonshotai/kimi-k3"}]}"#,
    );
    // The scripted provider is loopback HTTP; production managed configuration
    // validation requires HTTPS.
    let mut config = test_managed_manager(&root).managed_host().unwrap().clone();
    config.model_endpoint = base_url.clone();
    let manager = SessionManager::new(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: Some(config),
    })
    .unwrap();
    let app = router(manager);

    for request in [
        serde_json::json!({"backend": "openai-responses", "base_url": base_url}),
        serde_json::json!({"backend": "arcee-api", "base_url": "https://other.example.test"}),
        serde_json::json!({"backend": "arcee-api", "base_url": format!("{base_url}/other")}),
        serde_json::json!({"backend": "arcee-api", "api_key_env": "NAC_CONFIG_absent"}),
    ] {
        let response = post_json(app.clone(), "/providers/models", request).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(!response_json(response)
            .await
            .to_string()
            .contains("mounted-model-index-key"));
        assert!(
            authorization.try_recv().is_err(),
            "a refused destination must not contact the provider"
        );
    }

    let response = post_json(
        app.clone(),
        "/providers/models",
        serde_json::json!({"backend": "arcee-api"}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let listing = response_json(response).await;
    assert_eq!(listing["base_url"], base_url);
    let models = listing["models"].as_array().unwrap();
    assert_eq!(models.len(), 2);
    assert!(models
        .iter()
        .any(|model| model["id"] == "moonshotai/kimi-k3"));
    assert!(!listing.to_string().contains("mounted-model-index-key"));
    assert_eq!(
        authorization.recv_timeout(Duration::from_secs(5)).unwrap(),
        "Bearer mounted-model-index-key"
    );

    std::fs::remove_file(root.join("model-token")).unwrap();
    let response = post_json(
        app,
        "/providers/models",
        serde_json::json!({"backend": "arcee-api"}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(
        response_json(response).await["error"],
        "managed provider model discovery failed"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_session_settings_override_read_only_defaults_and_resume_with_the_mount() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_settings_override");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let config_path = nac_home.join("config.toml");
    let mounted_default = "[model]\nmodel = \"trinity-large-thinking\"\n";
    std::fs::write(&config_path, mounted_default).unwrap();
    let credential_path = root.join("model-token");
    let credential = b"settings-key-canary\n";
    write_managed_credential(&credential_path, credential);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o400)).unwrap();
        std::fs::set_permissions(&credential_path, std::fs::Permissions::from_mode(0o400)).unwrap();
    }
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_managed_manager(&root);
    let created = manager
        .create_session(CreateSessionRequest::default())
        .await
        .expect("the read-only deployment default should launch");
    let id = created.metadata.session_id.unwrap();
    manager.inner.active_sessions.write().await.remove(&id);

    manager
        .update_session_config(
            &id,
            UpdateConfigRequest {
                model: RequestField::Value("moonshotai/kimi-k3".into()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("the application-owned session row should accept an entitled model override");
    let accepted = manager.session_config(&id).unwrap();
    assert_eq!(accepted.model, "moonshotai/kimi-k3");
    assert_eq!(accepted.backend.as_deref(), Some("arcee-api"));
    assert_eq!(accepted.api_key_env, None);
    assert_eq!(
        std::fs::read_to_string(&config_path).unwrap(),
        mounted_default
    );
    assert_eq!(std::fs::read(&credential_path).unwrap(), credential);

    for patch in [
        UpdateConfigRequest {
            base_url: RequestField::Value("https://api.arcee.ai/other".into()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            backend: RequestField::Value("openai-responses".into()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            api_key_env: RequestField::Value("MISSING_EXPLICIT_KEY".into()),
            ..UpdateConfigRequest::default()
        },
    ] {
        let error = manager.update_session_config(&id, patch).await.unwrap_err();
        assert!(!error.to_string().contains("settings-key-canary"));
        let unchanged = manager.session_config(&id).unwrap();
        assert_eq!(unchanged.model, accepted.model);
        assert_eq!(unchanged.base_url, accepted.base_url);
        assert_eq!(unchanged.backend, accepted.backend);
        assert_eq!(unchanged.api_key_env, accepted.api_key_env);
    }

    manager
        .attach_session(&id)
        .await
        .expect("the persisted model override must outrank the mounted default on resume");
    assert_eq!(
        manager.snapshot(&id).await.unwrap().metadata.model,
        accepted.model
    );
    assert_eq!(
        std::fs::read_to_string(&config_path).unwrap(),
        mounted_default
    );
    assert_eq!(std::fs::read(&credential_path).unwrap(), credential);

    manager.inner.active_sessions.write().await.remove(&id);
    std::fs::remove_file(&credential_path).unwrap();
    assert!(manager
        .update_session_config(
            &id,
            UpdateConfigRequest {
                model: RequestField::Value("trinity-large-thinking".into()),
                ..UpdateConfigRequest::default()
            }
        )
        .await
        .is_err());
    assert_eq!(manager.session_config(&id).unwrap().model, accepted.model);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_interactive_repair_completes_into_readiness_create_and_resume() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_interactive_repair");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_imported_managed_arcee_state(
        &nac_home,
        nac_core::model::ARCEE_AUTH_DEV2_ISSUER,
        nac_core::model::ARCEE_AUTH_DEV2_ISSUER,
    );
    let manager = test_managed_bootstrap_manager_with_auth(
        &root,
        nac_core::model::ARCEE_AUTH_DEV2_ISSUER,
        Some(nac_core::model::ARCEE_AUTH_DEV2_ISSUER),
    );

    std::fs::remove_file(nac_home.join("arcee_auth.json")).unwrap();
    let (auth_service, auth_server) =
        scripted_managed_arcee_login(nac_core::model::ARCEE_AUTH_DEV2_ISSUER);
    let started = manager
        .start_managed_arcee_repair_with_auth_service_for_test(&auth_service)
        .await
        .expect("repair should begin from trusted receipt state");
    let completed = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            match manager
                .poll_managed_login(
                    nac_core::model::ManagedAuthProvider::Arcee,
                    &started.login_id,
                )
                .unwrap()
            {
                crate::DeviceLoginStateResponse::Pending => tokio::task::yield_now().await,
                outcome => break outcome,
            }
        }
    })
    .await
    .expect("managed repair completion timed out");
    match completed {
        crate::DeviceLoginStateResponse::Complete { auth } => assert!(auth.signed_in),
        crate::DeviceLoginStateResponse::Failed { error } => {
            panic!("managed repair unexpectedly failed: {error}")
        }
        crate::DeviceLoginStateResponse::Pending => unreachable!(),
    }
    auth_server.join().unwrap();

    manager
        .managed_model()
        .unwrap()
        .credential_ready(manager.managed_host().unwrap())
        .expect("completed repair must pass managed readiness");
    let repaired: serde_json::Value =
        serde_json::from_slice(&std::fs::read(nac_home.join("arcee_auth.json")).unwrap()).unwrap();
    assert_eq!(repaired["client_id"], "managed-nac");
    assert_eq!(
        repaired["auth_issuer"],
        nac_core::model::ARCEE_AUTH_DEV2_ISSUER
    );
    assert_eq!(
        repaired["managed_bootstrap"]["bootstrap_id"],
        "4712bc5e-30d5-421a-b416-8291d9f7d8f9"
    );

    let created = manager
        .create_session(CreateSessionRequest::default())
        .await
        .expect("repaired authorization must admit session creation");
    let session_id = created.metadata.session_id.unwrap();
    manager
        .inner
        .active_sessions
        .write()
        .await
        .remove(&session_id);
    drop(manager);
    let restarted = test_managed_bootstrap_manager_with_auth(
        &root,
        nac_core::model::ARCEE_AUTH_DEV2_ISSUER,
        Some(nac_core::model::ARCEE_AUTH_DEV2_ISSUER),
    );
    restarted
        .attach_session(&session_id)
        .await
        .expect("repaired authorization must admit session resume after restart");

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn version_two_managed_repair_holds_upgrade_admission_until_completion() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_v2_repair_admission");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_imported_managed_arcee_state(
        &nac_home,
        nac_core::model::ARCEE_AUTH_DEV2_ISSUER,
        nac_core::model::ARCEE_AUTH_DEV2_ISSUER,
    );
    let manager = test_managed_bootstrap_control_manager_with_auth(
        &root,
        nac_core::model::ARCEE_AUTH_DEV2_ISSUER,
        Some(nac_core::model::ARCEE_AUTH_DEV2_ISSUER),
    );

    std::fs::remove_file(nac_home.join("arcee_auth.json")).unwrap();
    let (auth_service, auth_server) =
        scripted_managed_arcee_login(nac_core::model::ARCEE_AUTH_DEV2_ISSUER);
    let started = manager
        .start_managed_arcee_repair_with_auth_service_for_test(&auth_service)
        .await
        .expect("v2 repair should begin from trusted receipt state");

    assert!(matches!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path),
        Err(nac_core::sessions::SessionOperationLeaseError::Busy(_))
    ));

    let completed = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            match manager
                .poll_managed_login(
                    nac_core::model::ManagedAuthProvider::Arcee,
                    &started.login_id,
                )
                .unwrap()
            {
                crate::DeviceLoginStateResponse::Pending => tokio::task::yield_now().await,
                outcome => break outcome,
            }
        }
    })
    .await
    .expect("v2 repair completion timed out");
    assert!(matches!(
        completed,
        crate::DeviceLoginStateResponse::Complete { .. }
    ));
    auth_server.join().unwrap();

    let maintenance = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            match nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path) {
                Ok(lease) => break lease,
                Err(nac_core::sessions::SessionOperationLeaseError::Busy(_)) => {
                    tokio::task::yield_now().await;
                }
                Err(error) => panic!("unexpected maintenance admission error: {error}"),
            }
        }
    })
    .await
    .expect("completed v2 repair must release upgrade admission");
    drop(maintenance);
    manager
        .managed_model()
        .unwrap()
        .credential_ready(manager.managed_host().unwrap())
        .expect("v2 repair must preserve the authoritative managed binding");

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_interactive_repair_preserves_existing_auth_and_requires_matching_receipt() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_repair_preserves_healthy");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_imported_managed_arcee_state(
        &nac_home,
        nac_core::model::ARCEE_AUTH_PRODUCTION_ISSUER,
        nac_core::model::ARCEE_AUTH_PRODUCTION_ISSUER,
    );
    let manager = test_managed_bootstrap_manager(&root);
    let auth_path = nac_home.join("arcee_auth.json");
    let before = std::fs::read(&auth_path).unwrap();
    let error = manager
        .start_managed_login(
            nac_core::model::ManagedAuthProvider::Arcee,
            nac_core::model::LoginStyle::DeviceCode,
        )
        .await
        .expect_err("healthy managed auth must not be replaced")
        .message;
    assert!(error.contains("will not replace an existing credential"));
    assert_eq!(std::fs::read(&auth_path).unwrap(), before);

    assert!(
        nac_core::model::managed_auth_logout(nac_core::model::ManagedAuthProvider::Arcee).unwrap()
    );
    assert!(nac_home.join("arcee_managed_repair.json").exists());
    std::fs::remove_file(nac_home.join("arcee_managed_bootstrap_receipt.json")).unwrap();
    let error = manager
        .start_managed_login(
            nac_core::model::ManagedAuthProvider::Arcee,
            nac_core::model::LoginStyle::DeviceCode,
        )
        .await
        .expect_err("missing receipt must fail before provider contact")
        .message;
    assert!(error.contains("requires its durable bootstrap receipt"));
    assert!(!auth_path.exists());

    write_imported_managed_arcee_state(
        &nac_home,
        nac_core::model::ARCEE_AUTH_PRODUCTION_ISSUER,
        nac_core::model::ARCEE_AUTH_PRODUCTION_ISSUER,
    );
    std::fs::remove_file(&auth_path).unwrap();
    let receipt_path = nac_home.join("arcee_managed_bootstrap_receipt.json");
    let mut receipt: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&receipt_path).unwrap()).unwrap();
    receipt["managed_host_id"] = serde_json::json!("27062ca7-2fca-49ad-b6c4-fe1e5d9ae6fa");
    write_managed_credential(&receipt_path, receipt.to_string());
    let error = manager
        .start_managed_login(
            nac_core::model::ManagedAuthProvider::Arcee,
            nac_core::model::LoginStyle::DeviceCode,
        )
        .await
        .expect_err("mismatched receipt must fail before provider contact")
        .message;
    assert!(error.contains("different logical host"));
    assert!(!auth_path.exists());

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
