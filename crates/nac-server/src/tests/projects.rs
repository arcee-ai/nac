use super::*;

#[tokio::test]
async fn explicit_session_speed_is_route_bound_and_never_inherited_from_project() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("project_speed_reconciliation");
    let workspace = root.join("workspace");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("project-test-key"));
    let manager = test_manager(&root);
    let store_path = root.join("store.db");
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Project".into()),
            description: None,
            cwd: workspace,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        })
        .await
        .unwrap();
    let app = router(manager);
    let base = serde_json::json!({
        "project_id": project.project_id,
        "backend": "openai-responses", "model": "gpt-5.2",
        "base_url": "https://api.openai.com/v1", "api_key_env": "OPENAI_API_KEY"
    });
    for tier in [None, Some(serde_json::json!("fast"))] {
        let mut request = base.clone();
        if let Some(tier) = &tier {
            request["service_tier"] = tier.clone();
        }
        let response = post_json(app.clone(), "/sessions", request).await;
        assert_eq!(response.status(), StatusCode::CREATED);
        let created: serde_json::Value =
            serde_json::from_slice(&response_body(response).await).unwrap();
        let id = created["metadata"]["session_id"].as_str().unwrap();
        assert_eq!(
            sessions::load_session(&store_path, id)
                .unwrap()
                .service_tier,
            if tier.is_some() {
                Some(nac_core::model::ServiceTier::Fast)
            } else {
                None
            }
        );
    }
    let mut unsupported = base;
    unsupported["base_url"] = serde_json::json!("https://example.com/v1");
    let mut unsupported_fast = unsupported.clone();
    unsupported_fast["service_tier"] = serde_json::json!("fast");
    let response = post_json(app.clone(), "/sessions", unsupported_fast).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = String::from_utf8(response_body(response).await.to_vec()).unwrap();
    assert!(body.contains("clear the speed preference"), "{body}");
    let response = post_json(app.clone(), "/sessions", unsupported.clone()).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let created: serde_json::Value =
        serde_json::from_slice(&response_body(response).await).unwrap();
    let id = created["metadata"]["session_id"].as_str().unwrap();
    assert_eq!(
        sessions::load_session(&store_path, id)
            .unwrap()
            .service_tier,
        None
    );
    assert_eq!(sessions::list_sessions(&store_path).unwrap().len(), 3);
    let mut repaired = unsupported;
    repaired["service_tier"] = serde_json::Value::Null;
    let response = post_json(app, "/sessions", repaired).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let created: serde_json::Value =
        serde_json::from_slice(&response_body(response).await).unwrap();
    let id = created["metadata"]["session_id"].as_str().unwrap();
    let saved = sessions::load_session(&store_path, id).unwrap();
    assert_eq!(saved.service_tier, None);
    assert_eq!(saved.backend, BackendKind::OpenAiResponses);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn project_http_create_list_patch_and_location_conflict() {
    let root = temp_root("project_http");
    let workspace = root.join("workspace");
    std::fs::create_dir_all(workspace.join("nested")).unwrap();
    let manager = test_manager(&root);
    let app = router(manager);

    let created_response = post_json(
        app.clone(),
        "/projects",
        serde_json::json!({
            "cwd": workspace.join("nested").join(".."),
            "description": "Initial description"
        }),
    )
    .await;
    assert_eq!(created_response.status(), StatusCode::CREATED);
    let created: ProjectRecord =
        serde_json::from_slice(&response_body(created_response).await).unwrap();
    assert_eq!(created.cwd, workspace.canonicalize().unwrap());
    assert_eq!(created.name, "workspace");
    assert_eq!(created.description.as_deref(), Some("Initial description"));

    let listed = get_response(app.clone(), "/projects", None).await;
    assert_eq!(listed.status(), StatusCode::OK);
    let listed: serde_json::Value = serde_json::from_slice(&response_body(listed).await).unwrap();
    assert_eq!(listed["projects"].as_array().unwrap().len(), 1);
    assert_eq!(listed["projects"][0]["project_id"], created.project_id);

    let patched = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/projects/{}", created.project_id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Renamed","description":null}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patched.status(), StatusCode::OK);
    let patched: ProjectRecord = serde_json::from_slice(&response_body(patched).await).unwrap();
    assert_eq!(patched.name, "Renamed");
    assert_eq!(patched.description, None);

    let null_name = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/projects/{}", created.project_id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":null}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(null_name.status(), StatusCode::BAD_REQUEST);

    let duplicate = post_json(
        app.clone(),
        "/projects",
        serde_json::json!({"cwd": workspace}),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let missing = post_json(
        app,
        "/projects",
        serde_json::json!({"cwd": root.join("missing")}),
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    let _ = std::fs::remove_dir_all(root);
}

// These are real HTTP/storage/session paths: creating a first chat does not
// start a run or contact the configured model endpoint.
#[cfg(unix)]
#[tokio::test]
async fn literal_local_path_project_and_first_chat_keep_the_selected_inode() {
    use std::os::unix::fs::MetadataExt;

    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("literal_local_path_session");
    let selected = root.join("Project 日本語 ");
    let sibling = root.join("Project 日本語");
    for (path, marker) in [(&selected, "selected"), (&sibling, "sibling")] {
        std::fs::create_dir(path).unwrap();
        std::fs::write(path.join("identity.txt"), marker).unwrap();
    }
    let selected = selected.canonicalize().unwrap();
    let sibling = sibling.canonicalize().unwrap();
    let identity = |path: &std::path::Path| {
        let stat = std::fs::metadata(path).unwrap();
        (stat.dev(), stat.ino())
    };
    assert_ne!(identity(&selected), identity(&sibling));
    println!(
        "selected={selected:?} {:?}; sibling={sibling:?} {:?}",
        identity(&selected),
        identity(&sibling)
    );
    let nac_home = root.join("nac-home");
    std::fs::create_dir(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("literal-path-test-key"));
    let manager = test_manager(&root);
    let store_path = root.join("store.db");
    let endpoint = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    endpoint.set_nonblocking(true).unwrap();
    let base_url = format!("http://{}/v1", endpoint.local_addr().unwrap());
    let app = router(manager.clone());
    // Registering the unspaced sibling first must not steal the selected path.
    let sibling_response = post_json(
        app.clone(),
        "/projects",
        serde_json::json!({"cwd": sibling}),
    )
    .await;
    assert_eq!(sibling_response.status(), StatusCode::CREATED);
    let response = post_json(
        app.clone(),
        "/projects",
        serde_json::json!({
            "cwd": selected
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let project: ProjectRecord = serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(project.cwd, selected);
    assert_eq!(identity(&project.cwd), identity(&selected));
    assert_eq!(
        std::fs::read_to_string(project.cwd.join("identity.txt")).unwrap(),
        "selected"
    );
    let stored_project = manager
        .projects()
        .list()
        .unwrap()
        .into_iter()
        .find(|item| item.project_id == project.project_id)
        .unwrap();
    assert_eq!(stored_project.cwd, selected);
    assert_eq!(manager.projects().list().unwrap().len(), 2);

    let response = post_json(
        app,
        "/sessions",
        serde_json::json!({
            "first_chat": true, "project_id": project.project_id,
            "model": "gpt-5.2", "backend": "openai-responses",
            "base_url": base_url, "allow_insecure_http": true, "api_key_env": "OPENAI_API_KEY"
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let created: serde_json::Value =
        serde_json::from_slice(&response_body(response).await).unwrap();
    let session_id = created["metadata"]["session_id"].as_str().unwrap();
    let stored = sessions::load_session(&store_path, session_id).unwrap();
    assert_eq!(
        stored.project_id.as_deref(),
        Some(project.project_id.as_str())
    );
    assert_eq!(stored.cwd, selected);
    assert_eq!(identity(&stored.cwd), identity(&selected));
    assert!(stored.ssh.is_none());
    assert!(stored.sandbox_spec.is_none());
    assert_eq!(created["metadata"]["cwd"], selected.to_str().unwrap());
    assert_eq!(
        created["metadata"]["workspace_host_path"],
        selected.to_str().unwrap()
    );
    assert_eq!(created["metadata"]["sandbox_status"], "off");
    assert_eq!(stored.model, "gpt-5.2");
    assert_eq!(stored.base_url, base_url);
    assert!(stored.token_usages.is_empty());
    assert!(stored.last_response_duration_ms.is_none());
    assert_eq!(
        endpoint.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock,
        "first-chat admission must not contact the configured model endpoint"
    );
    manager.cancel_local_active_runs_for_shutdown().await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn literal_local_path_browse_and_project_never_fall_back_to_a_sibling() {
    let root = temp_root("literal_local_path_browse");
    let root = root.canonicalize().unwrap();
    let selected = root.join("Project 日本語 ");
    let sibling = root.join("Project 日本語");
    std::fs::create_dir(&sibling).unwrap();
    std::fs::create_dir(sibling.join("decoy-only")).unwrap();
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let browse_url = |path: Option<&std::path::Path>| {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        if let Some(path) = path {
            query.append_pair("path", path.to_str().unwrap());
        }
        format!("/fs/browse?{}", query.finish())
    };
    // A missing literal path must fail even though its trimmed sibling exists.
    let missing = get_response(app.clone(), &browse_url(Some(&selected)), None).await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let missing = post_json(
        app.clone(),
        "/projects",
        serde_json::json!({"cwd": selected}),
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    assert!(manager.projects().list().unwrap().is_empty());
    assert!(manager
        .session_catalog()
        .list(false)
        .await
        .unwrap()
        .is_empty());
    std::fs::create_dir(&selected).unwrap();
    std::fs::create_dir(selected.join("selected-only")).unwrap();
    for path in [&selected, &sibling] {
        let response = get_response(app.clone(), &browse_url(Some(path)), None).await;
        assert_eq!(response.status(), StatusCode::OK);
        let listing: serde_json::Value =
            serde_json::from_slice(&response_body(response).await).unwrap();
        assert_eq!(listing["path"], path.to_str().unwrap());
        let marker = if path == &selected {
            "selected-only"
        } else {
            "decoy-only"
        };
        assert_eq!(listing["entries"][0]["name"], marker);
    }
    // The spaced path also works without any unspaced sibling present.
    std::fs::remove_dir_all(&sibling).unwrap();
    let response = post_json(
        app.clone(),
        "/projects",
        serde_json::json!({"cwd": selected}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    for name in ["ordinary", "manual interior space 日本語", " leading"] {
        let path = root.join(name);
        std::fs::create_dir(&path).unwrap();
        let response = post_json(app.clone(), "/projects", serde_json::json!({"cwd": path})).await;
        assert_eq!(response.status(), StatusCode::CREATED);
        let project: ProjectRecord =
            serde_json::from_slice(&response_body(response).await).unwrap();
        assert_eq!(project.cwd, path);
        let response = get_response(app.clone(), &browse_url(Some(&path)), None).await;
        assert_eq!(response.status(), StatusCode::OK);
    }
    for blank in ["", "   ", "\t\n"] {
        let response = get_response(
            app.clone(),
            &browse_url(Some(std::path::Path::new(blank))),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let listing: serde_json::Value =
            serde_json::from_slice(&response_body(response).await).unwrap();
        assert_eq!(listing["path"], root.to_str().unwrap());
        let response = post_json(app.clone(), "/projects", serde_json::json!({"cwd": blank})).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let response = get_response(app, &browse_url(None), None).await;
    assert_eq!(response.status(), StatusCode::OK);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn project_session_uses_explicit_model_and_filters_membership() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("project_session");
    let workspace = root.join("workspace");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("project-test-key"));
    let manager = test_manager(&root);
    let store_path = root.join("store.db");

    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Backend".to_string()),
            description: None,
            cwd: workspace.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        })
        .await
        .unwrap();

    let first_chat = CreateSessionRequest {
        first_chat: true,
        project_id: Some(project.project_id.clone()),
        model: RequestField::Value("gpt-5.3".to_string()),
        backend: RequestField::Value("openai-responses".to_string()),
        base_url: RequestField::Value("https://session-gateway.example/v1".to_string()),
        reasoning_effort: RequestField::Value("low".to_string()),
        orchestrator_compaction_threshold: RequestField::Value(32_000),
        ..CreateSessionRequest::default()
    };
    let (created, duplicate) = tokio::join!(
        manager.create_session(first_chat.clone()),
        manager.create_session(first_chat)
    );
    let created = created.unwrap();
    let duplicate = duplicate.unwrap();
    assert_eq!(
        created.metadata.session_id, duplicate.metadata.session_id,
        "concurrent required-first-chat requests must converge on one primary session"
    );
    let session_id = created.metadata.session_id.clone().unwrap();
    assert_eq!(
        created.metadata.project_id.as_deref(),
        Some(project.project_id.as_str())
    );
    let stored = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(stored.project_id, Some(project.project_id.clone()));
    assert_eq!(stored.cwd, workspace.canonicalize().unwrap());
    assert_eq!(stored.model, "gpt-5.3");
    assert_eq!(stored.base_url, "https://session-gateway.example/v1");
    assert!(!stored.allow_insecure_http);
    assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Low));
    assert!(!stored.extra_headers.contains_key("X-Project"));
    assert_eq!(stored.orchestrator_compaction_threshold, Some(32_000));

    let filtered = manager
        .session_catalog()
        .list_for_project(false, Some(&project.project_id))
        .await
        .unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(
        filtered[0].summary.project_id.as_deref(),
        Some(project.project_id.as_str())
    );

    let conflict = manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id.clone()),
            cwd: Some(workspace),
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap_err();
    assert!(conflict.to_string().contains("cannot be combined"));
    assert_eq!(
        manager.session_catalog().list(false).await.unwrap().len(),
        1
    );

    let missing = manager
        .create_session(CreateSessionRequest {
            project_id: Some("missing".to_string()),
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap_err();
    assert!(missing.to_string().contains("was not found"));
    assert_eq!(
        manager.session_catalog().list(false).await.unwrap().len(),
        1
    );

    let required_null = manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id.clone()),
            model: RequestField::Null,
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap_err();
    assert!(required_null.to_string().contains("model"));
    assert_eq!(
        manager.session_catalog().list(false).await.unwrap().len(),
        1
    );

    let reloaded = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(reloaded.model, "gpt-5.3");
    assert_eq!(reloaded.project_id, Some(project.project_id));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn project_sibling_requires_its_own_model_and_http_opt_in() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("project_sibling_http_policy");
    let workspace = root.join("workspace");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("project-test-key"));
    let manager = test_manager(&root);
    let store_path = root.join("store.db");
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Sibling policy".to_string()),
            description: None,
            cwd: workspace,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        })
        .await
        .unwrap();

    manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id.clone()),
            model: RequestField::Value("custom-model".to_string()),
            backend: RequestField::Value("openai-responses".to_string()),
            base_url: RequestField::Value("http://sibling-gateway.example/v1".to_string()),
            allow_insecure_http: RequestField::Value(true),
            api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap();
    let missing = manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id.clone()),
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap_err();
    assert!(missing.to_string().contains("backend"), "{missing:#}");
    let request = CreateSessionRequest {
        project_id: Some(project.project_id),
        model: RequestField::Value("custom-model".into()),
        backend: RequestField::Value("openai-responses".into()),
        base_url: RequestField::Value("http://sibling-gateway.example/v1".into()),
        api_key_env: RequestField::Value("OPENAI_API_KEY".into()),
        ..CreateSessionRequest::default()
    };
    assert!(manager
        .create_session(request.clone())
        .await
        .unwrap_err()
        .to_string()
        .contains("requires HTTPS"));
    let selected = manager
        .create_session(CreateSessionRequest {
            allow_insecure_http: RequestField::Value(true),
            ..request
        })
        .await
        .unwrap();
    let stored =
        sessions::load_session(&store_path, &selected.metadata.session_id.unwrap()).unwrap();
    assert_eq!(stored.base_url, "http://sibling-gateway.example/v1");
    assert!(stored.allow_insecure_http);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn concurrent_direct_first_chat_admission_is_unique() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("first_chat_behavior");
    let workspace = root.join("workspace");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("project-test-key"));
    let manager = test_manager(&root);
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: None,
            description: None,
            cwd: workspace,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        })
        .await
        .unwrap();
    let request = CreateSessionRequest {
        project_id: Some(project.project_id.clone()),
        behavior: sessions::SessionBehavior::Direct,
        first_chat: true,
        first_chat_same_behavior: true,
        model: RequestField::Value("gpt-5.2".into()),
        backend: RequestField::Value("openai-responses".into()),
        ..Default::default()
    };
    let (left, right) = tokio::join!(
        manager.create_session(request.clone()),
        manager.create_session(request)
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert_eq!(left.metadata.session_id, right.metadata.session_id);
    assert_eq!(left.metadata.behavior, sessions::SessionBehavior::Direct);
    // A repeated first-chat request reuses the committed direct session.
    let repeated = manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id),
            first_chat: true,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(repeated.metadata.session_id, left.metadata.session_id);
    manager.cancel_local_active_runs_for_shutdown().await;
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn first_chat_matching_selection_is_opt_in_and_refuses_changed_routes() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("first_chat_matching_selection");
    let workspace = root.join("workspace");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("project-test-key"));
    let manager = test_manager(&root);
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: None,
            description: None,
            cwd: workspace,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        })
        .await
        .unwrap();
    let app = router(manager.clone());
    let request = serde_json::json!({
        "project_id": project.project_id, "behavior": "direct", "first_chat": true,
        "first_chat_same_behavior": true, "first_chat_require_matching_model": true,
        "backend": "openai-responses", "model": "gpt-6.1-sol",
        "base_url": "https://api.openai.com/v1", "allow_insecure_http": false,
        "api_key_env": null, "reasoning_effort": null, "service_tier": null,
        "extra_headers": null,
    });
    let (first, same) = tokio::join!(
        post_json(app.clone(), "/sessions", request.clone()),
        post_json(app.clone(), "/sessions", request.clone()),
    );
    assert_eq!(first.status(), StatusCode::CREATED);
    let first: serde_json::Value = serde_json::from_slice(&response_body(first).await).unwrap();
    let id = first["metadata"]["session_id"].as_str().unwrap().to_owned();
    let before = sessions::load_session(&manager.inner.store_path, &id).unwrap();
    assert_eq!(before.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    assert_eq!(same.status(), StatusCode::CREATED);
    let same: serde_json::Value = serde_json::from_slice(&response_body(same).await).unwrap();
    assert_eq!(same["metadata"]["session_id"], id);
    for (field, value) in [
        ("model", serde_json::json!("gpt-5.2")),
        ("service_tier", serde_json::json!("fast")),
        ("base_url", serde_json::json!("https://other.example/v1")),
        ("allow_insecure_http", serde_json::json!(true)),
        ("api_key_env", serde_json::json!("DIFFERENT_KEY")),
        ("extra_headers", serde_json::json!({"x-test": "other"})),
        ("orchestrator_compaction_threshold", serde_json::json!(0)),
        ("orchestrator_compaction_threshold", serde_json::Value::Null),
    ] {
        let mut different = request.clone();
        different[field] = value;
        let response = post_json(app.clone(), "/sessions", different).await;
        assert_eq!(response.status(), StatusCode::CONFLICT, "field {field}");
    }
    let after = sessions::load_session(&manager.inner.store_path, &id).unwrap();
    assert_eq!(before.config_version, after.config_version);
    assert_eq!(
        serde_json::to_value(&before.messages).unwrap(),
        serde_json::to_value(&after.messages).unwrap()
    );
    assert_eq!(
        sessions::list_sessions(&manager.inner.store_path)
            .unwrap()
            .len(),
        1
    );
    let mut legacy = request.clone();
    legacy["first_chat_require_matching_model"] = serde_json::json!(false);
    legacy["model"] = serde_json::json!("gpt-5.2");
    let response = post_json(app.clone(), "/sessions", legacy).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let legacy: serde_json::Value = serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(legacy["metadata"]["session_id"], id);

    let second_workspace = root.join("second-workspace");
    std::fs::create_dir_all(&second_workspace).unwrap();
    let second_project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: None,
            description: None,
            cwd: second_workspace,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        })
        .await
        .unwrap();
    let mut competing_a = request.clone();
    competing_a["project_id"] = serde_json::json!(second_project.project_id);
    competing_a["first_chat_require_matching_model"] = serde_json::json!(true);
    let mut competing_b = competing_a.clone();
    competing_b["model"] = serde_json::json!("gpt-5.2");
    let (a, b) = tokio::join!(
        post_json(app.clone(), "/sessions", competing_a),
        post_json(app.clone(), "/sessions", competing_b),
    );
    let mut statuses = [a.status().as_u16(), b.status().as_u16()];
    statuses.sort();
    assert_eq!(
        statuses,
        [StatusCode::CREATED.as_u16(), StatusCode::CONFLICT.as_u16()]
    );
    assert_eq!(
        sessions::list_sessions(&manager.inner.store_path)
            .unwrap()
            .len(),
        2
    );
    drop(app);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn project_model_source_is_passive_and_bound_to_current_durable_owner() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("project_model_source");
    let workspace = root.join("workspace");
    let other_workspace = root.join("other");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&other_workspace).unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("source-secret-canary"));
    let manager = owned_test_manager(&root).unwrap();
    let make_project = |cwd| application::projects::CreateProject {
        name: None,
        description: None,
        cwd,
        ssh_host: None,
        ssh_port: None,
        ssh_identity_file: None,
    };
    let project = manager
        .projects()
        .create(make_project(workspace.clone()))
        .await
        .unwrap();
    let other = manager
        .projects()
        .create(make_project(other_workspace))
        .await
        .unwrap();
    let app = router(manager.clone());
    let response = post_json(
        app.clone(),
        "/sessions",
        serde_json::json!({
            "project_id": project.project_id, "behavior": "direct", "backend": "openai-responses",
            "model": "gpt-5.2", "base_url": "https://api.openai.com/v1", "api_key_env": null,
            "extra_headers": {"X-Private": "private-header-canary"},
        }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let created: serde_json::Value =
        serde_json::from_slice(&response_body(response).await).unwrap();
    let id = created["metadata"]["session_id"]
        .as_str()
        .unwrap()
        .to_owned();
    manager.inner.active_sessions.write().await.remove(&id);
    let url = format!(
        "/projects/{}/session-model-sources/{id}",
        project.project_id
    );
    let response = get_response(app.clone(), &url, None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let text = String::from_utf8(response_body(response).await.to_vec()).unwrap();
    assert!(!text.contains("source-secret-canary"));
    assert!(!text.contains("private-header-canary"));
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["session_id"], id);
    assert_eq!(value["api_key_env"], "OPENAI_API_KEY");
    assert!(value.get("extra_headers_json").is_none());
    let copied = post_json(app.clone(), "/sessions", serde_json::json!({
        "project_id": project.project_id, "backend": "openai-responses",
        "model": "gpt-5.2", "base_url": "https://api.openai.com/v1",
        "allow_insecure_http": false,
        "api_key_env": "OPENAI_API_KEY",
        "model_source": {"project_id": project.project_id, "session_id": id, "config_version": value["config_version"]}
    })).await;
    assert_eq!(copied.status(), StatusCode::CREATED);
    let copied: serde_json::Value = serde_json::from_slice(&response_body(copied).await).unwrap();
    let copied_id = copied["metadata"]["session_id"].as_str().unwrap();
    let stored = sessions::load_session_config(&manager.inner.store_path, copied_id).unwrap();
    assert!(stored
        .extra_headers_json
        .unwrap()
        .contains("private-header-canary"));
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    struct ReleaseGate(Arc<application::session_creation::CreationProjectionGate>);
    impl Drop for ReleaseGate {
        fn drop(&mut self) {
            self.0.resume.notify_one();
        }
    }
    let _release_gate = ReleaseGate(gate.clone());
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = Some(gate.clone());
    let racing_app = app.clone();
    let racing_project = project.project_id.clone();
    let racing_id = id.clone();
    let revision = value["config_version"].as_i64().unwrap();
    let racing = tokio::spawn(async move {
        post_json(racing_app, "/sessions", serde_json::json!({
            "project_id": racing_project, "backend": "openai-responses", "model": "gpt-5.2",
            "base_url": "https://api.openai.com/v1", "allow_insecure_http": false,
            "api_key_env": "OPENAI_API_KEY", "model_source": {
                "project_id": racing_project, "session_id": racing_id, "config_version": revision
            }
        })).await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), gate.reached.notified())
        .await
        .unwrap();
    let race_db = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    let before: i64 = race_db
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    race_db
        .execute(
            "UPDATE sessions SET config_version=config_version+1 WHERE session_id=?1",
            [&id],
        )
        .unwrap();
    gate.resume.notify_one();
    let racing_response = racing.await.unwrap();
    assert!(!racing_response.status().is_success());
    assert!(
        !String::from_utf8_lossy(&response_body(racing_response).await)
            .contains("private-header-canary")
    );
    let after: i64 = race_db
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(before, after);
    race_db
        .execute(
            "UPDATE sessions SET config_version=?1 WHERE session_id=?2",
            rusqlite::params![revision, id],
        )
        .unwrap();
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = None;
    for (target_project, route, version) in [
        (
            project.project_id.as_str(),
            "https://other.example/v1",
            value["config_version"].as_i64().unwrap(),
        ),
        (
            project.project_id.as_str(),
            "https://api.openai.com/v1",
            value["config_version"].as_i64().unwrap() + 1,
        ),
        (
            other.project_id.as_str(),
            "https://api.openai.com/v1",
            value["config_version"].as_i64().unwrap(),
        ),
    ] {
        let rejected = post_json(app.clone(), "/sessions", serde_json::json!({
            "project_id": target_project, "backend": "openai-responses",
            "model": "gpt-5.2", "base_url": route, "allow_insecure_http": false, "api_key_env": "OPENAI_API_KEY",
            "model_source": {"project_id": target_project, "session_id": id, "config_version": version}
        })).await;
        assert!(!rejected.status().is_success());
        assert!(!String::from_utf8_lossy(&response_body(rejected).await)
            .contains("private-header-canary"));
    }
    assert!(!manager.inner.active_sessions.read().await.contains_key(&id));
    let path = manager.inner.store_path.clone();
    let db = rusqlite::Connection::open(&path).unwrap();
    let stored_cwd: String = db
        .query_row(
            "SELECT cwd FROM projects WHERE project_id=?1",
            [&project.project_id],
            |row| row.get(0),
        )
        .unwrap();
    for (mutation, restore) in [
        (
            "UPDATE sessions SET cwd='/different' WHERE session_id=?1",
            "UPDATE sessions SET cwd=?2 WHERE session_id=?1",
        ),
        (
            "UPDATE sessions SET sandbox_json='{}' WHERE session_id=?1",
            "UPDATE sessions SET sandbox_json=NULL WHERE session_id=?1",
        ),
        (
            "UPDATE sessions SET host_id='other' WHERE session_id=?1",
            "UPDATE sessions SET host_id=NULL WHERE session_id=?1",
        ),
        (
            "UPDATE sessions SET ssh_port=2222 WHERE session_id=?1",
            "UPDATE sessions SET ssh_port=NULL WHERE session_id=?1",
        ),
        (
            "UPDATE sessions SET ssh_identity_file='/other' WHERE session_id=?1",
            "UPDATE sessions SET ssh_identity_file=NULL WHERE session_id=?1",
        ),
    ] {
        db.execute(mutation, rusqlite::params![id]).unwrap();
        assert_eq!(
            get_response(app.clone(), &url, None).await.status(),
            StatusCode::NOT_FOUND,
            "{mutation}"
        );
        if restore.contains("?2") {
            db.execute(restore, rusqlite::params![id, stored_cwd])
                .unwrap();
        } else {
            db.execute(restore, rusqlite::params![id]).unwrap();
        }
        assert_eq!(
            get_response(app.clone(), &url, None).await.status(),
            StatusCode::OK,
            "restore {restore}"
        );
    }
    // An uncommitted move is invisible; the committed move immediately revokes the source.
    db.execute_batch("BEGIN IMMEDIATE").unwrap();
    db.execute(
        "UPDATE session_projects SET project_id=?1 WHERE session_id=?2",
        rusqlite::params![other.project_id, id],
    )
    .unwrap();
    assert_eq!(
        get_response(app.clone(), &url, None).await.status(),
        StatusCode::OK
    );
    db.execute_batch("COMMIT").unwrap();
    assert_eq!(
        get_response(app.clone(), &url, None).await.status(),
        StatusCode::NOT_FOUND
    );
    db.execute(
        "UPDATE session_projects SET project_id=?1 WHERE session_id=?2",
        rusqlite::params![project.project_id, id],
    )
    .unwrap();
    let parent_response = post_json(
        app.clone(),
        "/sessions",
        serde_json::json!({
            "project_id": project.project_id, "behavior": "direct", "backend": "openai-responses",
            "model": "gpt-5.2", "base_url": "https://api.openai.com/v1", "api_key_env": null,
        }),
    )
    .await;
    assert_eq!(parent_response.status(), StatusCode::CREATED);
    let parent: serde_json::Value =
        serde_json::from_slice(&response_body(parent_response).await).unwrap();
    let parent_id = parent["metadata"]["session_id"].as_str().unwrap();
    db.execute("INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,created_at,updated_at) VALUES(?1,?2,?2,'general','fixture',1,'2026-01-01','2026-01-01')", rusqlite::params![id, parent_id]).unwrap();
    assert_eq!(
        get_response(app.clone(), &url, None).await.status(),
        StatusCode::NOT_FOUND
    );
    db.execute(
        "DELETE FROM traditional_children WHERE child_session_id=?1",
        rusqlite::params![id],
    )
    .unwrap();
    let foreign_host = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(&url)
                .header(header::HOST, "attacker.invalid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_ne!(foreign_host.status(), StatusCode::OK);
    db.execute(
        "DELETE FROM sessions WHERE session_id=?1",
        rusqlite::params![id],
    )
    .unwrap();
    assert_eq!(
        get_response(app.clone(), &url, None).await.status(),
        StatusCode::NOT_FOUND
    );
    drop(db);
    drop(app);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
