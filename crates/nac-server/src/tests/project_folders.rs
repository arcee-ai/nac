use super::*;

fn listed(root: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

async fn error_message(response: Response) -> String {
    let body: serde_json::Value = serde_json::from_slice(&response_body(response).await).unwrap();
    body["error"].as_str().unwrap_or_default().to_string()
}

#[tokio::test]
async fn local_folder_route_creates_one_folder_and_reports_every_refusal() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("project_folders").canonicalize().unwrap();
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let parent = root.join("projects");
    std::fs::create_dir_all(&parent).unwrap();
    let app = router(test_manager(&root));
    let create = |name: &str, parent: &std::path::Path| {
        post_json(
            app.clone(),
            "/fs/folders",
            serde_json::json!({"parent": parent, "name": name}),
        )
    };

    let created = create("café ü 项目", &parent).await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let body: serde_json::Value = serde_json::from_slice(&response_body(created).await).unwrap();
    assert_eq!(
        body["path"],
        parent.join("café ü 项目").display().to_string()
    );
    assert_eq!(listed(&parent), vec!["café ü 项目"]);
    assert!(parent.join("café ü 项目").is_dir());

    // The same request again is a truthful conflict, not a second success.
    let again = create("café ü 项目", &parent).await;
    assert_eq!(again.status(), StatusCode::CONFLICT);
    assert!(error_message(again).await.ends_with("already exists"));

    for name in ["", "..", "a/b", " padded "] {
        let invalid = create(name, &parent).await;
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST, "{name:?}");
    }
    let relative = post_json(
        app.clone(),
        "/fs/folders",
        serde_json::json!({"parent": "projects", "name": "x"}),
    )
    .await;
    assert_eq!(relative.status(), StatusCode::BAD_REQUEST);

    let missing = create("x", &root.join("missing")).await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&parent, root.join("link")).unwrap();
        let through_link = create("via link", &root.join("link")).await;
        assert_eq!(through_link.status(), StatusCode::CONFLICT);
        assert!(error_message(through_link)
            .await
            .contains("moved or been replaced"));
    }

    // Configured Deny is read per request and refuses; configured Ask does not
    // ask anyone, because the request itself is the person's intent.
    std::fs::write(
        nac_home.join("config.toml"),
        format!(
            "[[permissions.rules]]\naction = \"edit\"\nresource = \"*\"\neffect = \"ask\"\n\n\
             [[permissions.rules]]\naction = \"edit\"\nresource = \"{}/private*\"\neffect = \"deny\"\n",
            parent.display()
        ),
    )
    .unwrap();
    let denied = create("private notes", &parent).await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert!(error_message(denied)
        .await
        .contains("configured permission rules deny"));
    let asked = create("public", &parent).await;
    assert_eq!(asked.status(), StatusCode::CREATED);
    let hard = create(".git", &parent).await;
    assert_eq!(hard.status(), StatusCode::FORBIDDEN);

    assert_eq!(listed(&parent), vec!["café ü 项目", "public"]);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn ssh_folder_route_never_creates_on_this_machine() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("ssh_project_folders").canonicalize().unwrap();
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::with_config_home(Some(&nac_home), None, Some(&root), None);
    let parent = root.join("projects");
    std::fs::create_dir_all(&parent).unwrap();
    let app = router(test_manager(&root));

    // No host is a refusal, not a fallback to the local filesystem.
    let no_host = post_json(
        app.clone(),
        "/ssh/folders",
        serde_json::json!({"ssh_host": "  ", "parent": parent, "name": "remote"}),
    )
    .await;
    assert_eq!(no_host.status(), StatusCode::BAD_REQUEST);

    // An unreachable host leaves the outcome unknown, and the parent path that
    // happens to exist locally is untouched.
    let unreachable = post_json(
        app.clone(),
        "/ssh/folders",
        serde_json::json!({
            "ssh_host": "127.0.0.1",
            "ssh_port": 1,
            "parent": parent,
            "name": "remote"
        }),
    )
    .await;
    assert_eq!(unreachable.status(), StatusCode::BAD_GATEWAY);

    let invalid = post_json(
        app,
        "/ssh/folders",
        serde_json::json!({"ssh_host": "127.0.0.1", "parent": parent, "name": "../up"}),
    )
    .await;
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

    assert!(listed(&parent).is_empty());
    let _ = std::fs::remove_dir_all(root);
}
