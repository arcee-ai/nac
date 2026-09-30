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
