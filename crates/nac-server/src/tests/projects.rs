use super::*;

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
    model_configurations::insert_model_configuration(
        &store_path,
        "literal-path-default",
        model_configurations::NewModelConfiguration {
            name: "Literal path default".into(),
            backend: "openai-responses".into(),
            model: "gpt-5.2".into(),
            base_url: base_url.clone(),
            allow_insecure_http: true,
            api_key_env: Some("OPENAI_API_KEY".into()),
            reasoning_effort: None,
            extra_headers: BTreeMap::new(),
            orchestrator_compaction_threshold: None,
            initial_prompt: None,
            light_model: None,
        },
    )
    .unwrap();
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
            "cwd": selected, "default_model_config_id": "literal-path-default"
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
            "first_chat": true, "project_id": project.project_id
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
async fn project_session_materializes_defaults_and_filters_membership() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("project_session");
    let workspace = root.join("workspace");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("project-test-key"));
    let manager = test_manager(&root);
    let store_path = root.join("store.db");

    model_configurations::insert_model_configuration(
        &store_path,
        "project-default",
        model_configurations::NewModelConfiguration {
            name: "Project default".to_string(),
            backend: "openai-responses".to_string(),
            model: "gpt-5.2".to_string(),
            base_url: "http://project-gateway.example/v1".to_string(),
            allow_insecure_http: true,
            api_key_env: Some("OPENAI_API_KEY".to_string()),
            reasoning_effort: Some("high".to_string()),
            extra_headers: BTreeMap::from([("X-Project".to_string(), "selected".to_string())]),
            orchestrator_compaction_threshold: Some(64_000),
            initial_prompt: Some("ignored during creation".to_string()),
            light_model: None,
        },
    )
    .unwrap();
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Backend".to_string()),
            description: None,
            cwd: workspace.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: Some("project-default".to_string()),
        })
        .await
        .unwrap();

    let first_chat = CreateSessionRequest {
        first_chat: true,
        project_id: Some(project.project_id.clone()),
        reasoning_effort: RequestField::Value("low".to_string()),
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
    assert_eq!(stored.model, "gpt-5.2");
    assert_eq!(stored.base_url, "http://project-gateway.example/v1");
    assert!(stored.allow_insecure_http);
    assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Low));
    assert_eq!(
        stored.extra_headers.get("X-Project").map(String::as_str),
        Some("selected")
    );
    assert_eq!(stored.orchestrator_compaction_threshold, Some(64_000));

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

    let deletion = delivery::model_configurations::delete_handler(
        State(manager.clone()),
        AxumPath("project-default".to_string()),
    )
    .await
    .unwrap_err();
    assert_eq!(deletion.status, StatusCode::CONFLICT);
    assert!(model_configurations::load_model_configuration(&store_path, "project-default").is_ok());
    manager
        .projects()
        .update(
            &project.project_id,
            application::projects::UpdateProject {
                name: application::Field::Unchanged,
                description: application::Field::Unchanged,
                default_model_config_id: application::Field::Clear,
                pinned: application::Field::Unchanged,
            },
        )
        .unwrap();
    assert_eq!(
        delivery::model_configurations::delete_handler(
            State(manager.clone()),
            AxumPath("project-default".to_string()),
        )
        .await
        .unwrap(),
        StatusCode::NO_CONTENT
    );
    let reloaded = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(reloaded.model, "gpt-5.2");
    assert_eq!(reloaded.project_id, Some(project.project_id));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn project_sibling_inherits_public_http_opt_in() {
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
            default_model_config_id: None,
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
    let inherited = manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id),
            ..CreateSessionRequest::default()
        })
        .await
        .expect("a later project chat should inherit its sibling's HTTP policy");
    let stored =
        sessions::load_session(&store_path, &inherited.metadata.session_id.unwrap()).unwrap();
    assert_eq!(stored.base_url, "http://sibling-gateway.example/v1");
    assert!(stored.allow_insecure_http);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn first_chat_same_behavior_is_additive_and_concurrent_direct_admission_is_unique() {
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
            default_model_config_id: None,
        })
        .await
        .unwrap();
    let legacy = manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id.clone()),
            model: RequestField::Value("gpt-5.2".into()),
            backend: RequestField::Value("openai-responses".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    let request = CreateSessionRequest {
        project_id: Some(project.project_id.clone()),
        behavior: sessions::SessionBehavior::Direct,
        first_chat: true,
        first_chat_same_behavior: true,
        ..Default::default()
    };
    let (left, right) = tokio::join!(
        manager.create_session(request.clone()),
        manager.create_session(request)
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert_eq!(left.metadata.session_id, right.metadata.session_id);
    assert_ne!(left.metadata.session_id, legacy.metadata.session_id);
    assert_eq!(left.metadata.behavior, sessions::SessionBehavior::Direct);
    assert_eq!(
        legacy.metadata.behavior,
        sessions::SessionBehavior::Orchestrator
    );
    // Legacy callers still receive the newest primary regardless of requested behavior.
    let legacy_caller = manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id),
            first_chat: true,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(legacy_caller.metadata.session_id, left.metadata.session_id);
    manager.cancel_local_active_runs_for_shutdown().await;
    let _ = std::fs::remove_dir_all(root);
}
