use super::*;

#[test]
fn expired_pending_authorization_is_not_advertised_or_connected() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("expired-pending-authorization");
    let endpoint = "https://mcp.slack.com/mcp";
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.credentials = Some(
            serde_json::from_value(serde_json::json!({
                "client_id": "public-test-client",
                "token_response": {
                    "access_token": "existing-access-token",
                    "token_type": "bearer"
                },
                "granted_scopes": ["channels:history"],
                "token_received_at": 1,
                "issuer": null
            }))
            .unwrap(),
        );
        profile.pending_authorization_url =
            Some("https://auth.example.test/authorize?state=expired-state".into());
        profile.pending_scopes = vec!["channels:write".into()];
        profile.states.insert(
            "expired-state".into(),
            serde_json::from_value(serde_json::json!({
                "pkce_verifier": "expired-verifier",
                "csrf_token": "expired-state",
                "created_at": 0,
                "requested_scopes": ["channels:write"]
            }))
            .unwrap(),
        );
        Ok(())
    })
    .unwrap();

    assert!(
        mcp_oauth_pending_authorization_url(Path::new("/workspace"), "slack", endpoint)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
        McpOAuthStatus::NeedsAuthorization
    );
}

#[tokio::test(flavor = "current_thread")]
async fn connected_manager_reads_a_completed_step_up_token_from_the_durable_store() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("live-step-up-token");
    let endpoint = "https://mcp.example.test/mcp";
    let mut config = configuration();
    config.authorization_metadata = Some(McpOAuthAuthorizationMetadata {
        authorization_endpoint: "https://auth.example.test/authorize".into(),
        token_endpoint: "https://auth.example.test/token".into(),
        registration_endpoint: None,
        issuer: None,
        jwks_uri: None,
        scopes_supported: None,
        response_types_supported: None,
        code_challenge_methods_supported: None,
        additional_fields: BTreeMap::new(),
    });
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, config).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    let set_token = |access_token: &str| {
        edit_store(&path, |store| {
            store.profiles.get_mut("slack").unwrap().credentials = Some(
                serde_json::from_value(serde_json::json!({
                    "client_id": "public-test-client",
                    "token_response": {
                        "access_token": access_token,
                        "token_type": "bearer"
                    },
                    "granted_scopes": ["channels:history", "chat:write"],
                    "token_received_at": 1,
                    "issuer": null
                }))
                .unwrap(),
            );
            Ok(())
        })
        .unwrap();
    };
    set_token("old-access-token");

    let manager = authorized_manager(Path::new("/workspace"), "slack", endpoint)
        .await
        .unwrap();
    assert_eq!(
        manager.get_access_token().await.unwrap(),
        "old-access-token"
    );

    set_token("step-up-access-token");
    assert_eq!(
        manager.get_access_token().await.unwrap(),
        "step-up-access-token"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn issuer_bound_logout_can_start_reauthorization() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("issuer-bound-reauthorization");
    let endpoint = "https://mcp.example.test/mcp";
    let issuer = "https://auth.example.test/";
    let mut config = configuration();
    config.authorization_metadata = Some(McpOAuthAuthorizationMetadata {
        authorization_endpoint: format!("{issuer}authorize"),
        token_endpoint: format!("{issuer}token"),
        registration_endpoint: None,
        issuer: Some(issuer.into()),
        jwks_uri: None,
        scopes_supported: None,
        response_types_supported: None,
        code_challenge_methods_supported: None,
        additional_fields: BTreeMap::new(),
    });
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, config).unwrap();
    edit_store(
        &oauth_store_path(Path::new("/workspace")).unwrap(),
        |store| {
            let profile = store.profiles.get_mut("slack").unwrap();
            profile.binding.issuer = Some(issuer.into());
            profile.credentials = Some(
                StoredCredentials::new("public-test-client".into(), None, Vec::new(), None)
                    .with_issuer(Some(issuer.into())),
            );
            Ok(())
        },
    )
    .unwrap();
    clear_mcp_oauth(Path::new("/workspace"), "slack").unwrap();

    begin_mcp_oauth_authorization(
        Path::new("/workspace"),
        "slack",
        endpoint,
        "https://nac.example.test/oauth/callback",
        &[],
    )
    .await
    .unwrap();
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
        McpOAuthStatus::NeedsAuthorization
    );
}

#[tokio::test(flavor = "current_thread")]
async fn step_up_tracks_only_missing_scopes_and_accepts_an_omitted_token_scope() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("step-up-omitted-token-scope");
    let endpoint = "https://mcp.example.test/mcp";
    let mut config = configuration();
    config.authorization_metadata = Some(McpOAuthAuthorizationMetadata {
        authorization_endpoint: "https://auth.example.test/authorize".into(),
        token_endpoint: "https://auth.example.test/token".into(),
        registration_endpoint: None,
        issuer: None,
        jwks_uri: None,
        scopes_supported: None,
        response_types_supported: None,
        code_challenge_methods_supported: None,
        additional_fields: BTreeMap::new(),
    });
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, config).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    edit_store(&path, |store| {
        store.profiles.get_mut("slack").unwrap().credentials = Some(
            serde_json::from_value(serde_json::json!({
                "client_id": "public-test-client",
                "token_response": {
                    "access_token": "existing-access-token",
                    "token_type": "bearer"
                },
                "granted_scopes": ["channels:history"],
                "token_received_at": 1,
                "issuer": null
            }))
            .unwrap(),
        );
        Ok(())
    })
    .unwrap();
    prepare_mcp_oauth_scope_step_up(Path::new("/workspace"), "slack", endpoint, "mcp:write")
        .unwrap();

    let session = begin_mcp_oauth_authorization(
        Path::new("/workspace"),
        "slack",
        endpoint,
        MCP_OAUTH_REDIRECT_URI,
        &["mcp:admin".into()],
    )
    .await
    .unwrap();
    let profile = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    assert_eq!(profile.pending_scopes, vec!["mcp:write", "mcp:admin"]);

    let adapter = OAuthProfileStore {
        path,
        server_name: "slack".into(),
        endpoint: normalize_endpoint(endpoint).unwrap(),
        expected_client_id: Some("public-test-client".into()),
        save_mode: CredentialSaveMode::Independent,
    };
    let credentials: StoredCredentials = serde_json::from_value(serde_json::json!({
        "client_id": "public-test-client",
        "token_response": {
            "access_token": "step-up-access-token",
            "token_type": "bearer"
        },
        "granted_scopes": [],
        "token_received_at": 2,
        "issuer": null
    }))
    .unwrap();
    CredentialStore::save(&adapter, credentials).await.unwrap();
    assert!(adapter.profile().unwrap().pending_scopes.is_empty());
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
        McpOAuthStatus::Connected
    );
    drop(session);
}

#[test]
fn failed_step_up_preserves_the_existing_token_and_clears_pending_state() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("failed-step-up");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.credentials = Some(
            serde_json::from_value(serde_json::json!({
                "client_id": "public-test-client",
                "token_response": {
                    "access_token": "existing-access-token",
                    "token_type": "bearer"
                },
                "granted_scopes": ["channels:history"],
                "token_received_at": 1,
                "issuer": null
            }))
            .unwrap(),
        );
        profile.pending_authorization_url =
            Some("https://auth.example.test/authorize?state=pending-state".into());
        profile.pending_scopes = vec!["channels:write".into()];
        Ok(())
    })
    .unwrap();

    assert!(
        fail_mcp_oauth_authorization(Path::new("/workspace"), "slack", endpoint, None).unwrap()
    );

    let profile = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    let credentials = serde_json::to_value(profile.credentials.unwrap()).unwrap();
    assert_eq!(
        credentials["token_response"]["access_token"],
        "existing-access-token"
    );
    assert!(profile.pending_authorization_url.is_none());
    assert!(profile.pending_scopes.is_empty());
    assert!(profile.states.is_empty());
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
        McpOAuthStatus::Connected
    );
}

#[tokio::test(flavor = "current_thread")]
async fn credential_clear_removes_pending_and_dynamic_registration_state() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("credential-clear");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(
        Path::new("/workspace"),
        "dynamic",
        endpoint,
        McpOAuthConfiguration {
            registration: McpOAuthRegistration::Dynamic {
                client_name: Some("NAC Test".into()),
            },
            scopes: vec!["mcp:read".into()],
            authorization_metadata: None,
        },
    )
    .unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("dynamic").unwrap();
        profile.pending_authorization_url = Some("https://auth.example.test/authorize".into());
        profile.pending_scopes = vec!["mcp:write".into()];
        profile.registered_client_secret = Some("registered-secret".into());
        Ok(())
    })
    .unwrap();
    let adapter = OAuthProfileStore {
        path,
        server_name: "dynamic".into(),
        endpoint: normalize_endpoint(endpoint).unwrap(),
        expected_client_id: None,
        save_mode: CredentialSaveMode::Independent,
    };
    CredentialStore::clear(&adapter).await.unwrap();
    let profile = adapter.profile().unwrap();
    assert!(profile.pending_authorization_url.is_none());
    assert!(profile.pending_scopes.is_empty());
    assert!(profile.registered_client_secret.is_none());
}

#[tokio::test(flavor = "current_thread")]
async fn credential_save_respects_independent_and_refresh_guarded_locking() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("credential-save-lock");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    let adapter = OAuthProfileStore {
        path: path.clone(),
        server_name: "slack".into(),
        endpoint: normalize_endpoint(endpoint).unwrap(),
        expected_client_id: Some("public-test-client".into()),
        save_mode: CredentialSaveMode::Independent,
    };
    let credentials: StoredCredentials = serde_json::from_value(serde_json::json!({
        "client_id": "public-test-client",
        "token_response": {
            "access_token": "saved-access-token",
            "token_type": "bearer"
        },
        "granted_scopes": ["mcp:read"],
        "token_received_at": 1,
        "issuer": null
    }))
    .unwrap();
    let store_guard = try_acquire_credential_lock(&lock_path(&path))
        .unwrap()
        .expect("test owns the credential lock");
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(0);
    let (done_tx, done_rx) = std::sync::mpsc::sync_channel(0);
    let saver = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime
            .block_on(CredentialStore::save(&adapter, credentials))
            .map_err(|error| error.to_string());
        done_tx.send(result).unwrap();
    });
    started_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("credential save thread started");
    assert!(matches!(
        done_rx.recv_timeout(Duration::from_millis(100)),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout)
    ));

    let mut store = read_store(&path).unwrap();
    store.profiles.get_mut("slack").unwrap().states.insert(
        "newer-state".into(),
        serde_json::from_value(serde_json::json!({
            "pkce_verifier": "newer-verifier",
            "csrf_token": "newer-state",
            "created_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
            "requested_scopes": ["mcp:write"]
        }))
        .unwrap(),
    );
    write_store(&path, &store).unwrap();
    drop(store_guard);
    done_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("credential save completed after lock release")
        .unwrap();
    saver.join().unwrap();

    let profile = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    assert!(profile.states.contains_key("newer-state"));
    assert_eq!(
        serde_json::to_value(profile.credentials.unwrap()).unwrap()["token_response"]
            ["access_token"],
        "saved-access-token"
    );

    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.pending_authorization_url =
            Some("https://auth.example.test/authorize?state=step-up".into());
        profile.pending_scopes = vec!["mcp:write".into()];
        Ok(())
    })
    .unwrap();
    let guarded_adapter = OAuthProfileStore {
        path,
        server_name: "slack".into(),
        endpoint: normalize_endpoint(endpoint).unwrap(),
        expected_client_id: Some("public-test-client".into()),
        save_mode: CredentialSaveMode::RefreshGuarded,
    };
    let refresh_guard = CredentialStore::acquire_refresh_guard(&guarded_adapter)
        .await
        .unwrap()
        .expect("refresh-capable stores coordinate refresh saves");
    let refreshed: StoredCredentials = serde_json::from_value(serde_json::json!({
        "client_id": "public-test-client",
        "token_response": {
            "access_token": "refreshed-access-token",
            "token_type": "bearer"
        },
        "granted_scopes": ["mcp:read"],
        "token_received_at": 2,
        "issuer": null
    }))
    .unwrap();
    tokio::time::timeout(
        Duration::from_secs(1),
        CredentialStore::save(&guarded_adapter, refreshed),
    )
    .await
    .expect("refresh save must not reacquire its held guard")
    .unwrap();
    drop(refresh_guard);
    assert_eq!(
        serde_json::to_value(
            guarded_adapter
                .profile()
                .unwrap()
                .credentials
                .as_ref()
                .unwrap()
        )
        .unwrap()["token_response"]["access_token"],
        "refreshed-access-token"
    );
    let profile = guarded_adapter.profile().unwrap();
    assert_eq!(profile.pending_scopes, vec!["mcp:write"]);
    assert_eq!(
        profile.pending_authorization_url.as_deref(),
        Some("https://auth.example.test/authorize?state=step-up")
    );
}

#[test]
fn rename_rebinds_redirect_and_clears_only_obsolete_authorization_state() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("oauth-rename");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.redirect_uri =
            Some("https://nac.example.test/mcp_library/servers/slack/oauth/callback".into());
        profile.pending_authorization_url =
            Some("https://auth.example.test/authorize?state=old-state".into());
        profile.pending_scopes = vec!["mcp:write".into()];
        profile.states.insert(
            "old-state".into(),
            serde_json::from_value(serde_json::json!({
                "pkce_verifier": "old-verifier",
                "csrf_token": "old-state",
                "created_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                "requested_scopes": ["mcp:write"]
            }))
            .unwrap(),
        );
        profile.credentials = Some(
            serde_json::from_value(serde_json::json!({
                "client_id": "public-test-client",
                "token_response": {
                    "access_token": "preserved-access-token",
                    "token_type": "bearer"
                },
                "granted_scopes": ["mcp:read"],
                "token_received_at": 1,
                "issuer": null
            }))
            .unwrap(),
        );
        Ok(())
    })
    .unwrap();
    let renamed_redirect = "https://nac.example.test/mcp_library/servers/teams/oauth/callback";

    rename_mcp_oauth_profile(Path::new("/workspace"), "slack", "teams", renamed_redirect).unwrap();

    let mut store = read_store(&path).unwrap();
    assert!(!store.profiles.contains_key("slack"));
    let profile = store.profiles.remove("teams").unwrap();
    assert_eq!(profile.redirect_uri.as_deref(), Some(renamed_redirect));
    assert!(profile.pending_authorization_url.is_none());
    assert!(profile.pending_scopes.is_empty());
    assert!(profile.states.is_empty());
    assert_eq!(
        serde_json::to_value(profile.credentials.unwrap()).unwrap()["token_response"]
            ["access_token"],
        "preserved-access-token"
    );
}

#[test]
fn rename_invalidates_a_dynamic_client_registered_for_the_old_redirect() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("dynamic-oauth-rename");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(
        Path::new("/workspace"),
        "slack",
        endpoint,
        McpOAuthConfiguration {
            registration: McpOAuthRegistration::Dynamic { client_name: None },
            scopes: vec!["mcp:read".into()],
            authorization_metadata: None,
        },
    )
    .unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.redirect_uri = Some("https://nac.example.test/servers/slack/callback".into());
        profile.registered_client_secret = Some("old-secret".into());
        profile.credentials = Some(StoredCredentials::new(
            "old-dynamic-client".into(),
            None,
            vec!["mcp:read".into()],
            None,
        ));
        Ok(())
    })
    .unwrap();

    rename_mcp_oauth_profile(
        Path::new("/workspace"),
        "slack",
        "teams",
        "https://nac.example.test/servers/teams/callback",
    )
    .unwrap();

    let profile = read_store(&path).unwrap().profiles.remove("teams").unwrap();
    assert!(profile.credentials.is_none());
    assert!(profile.registered_client_secret.is_none());
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "teams", endpoint).unwrap(),
        McpOAuthStatus::NeedsAuthorization
    );
}

#[test]
fn redirect_rebinding_changes_a_matching_dynamic_profile_from_connected_to_needs_authorization() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("dynamic-redirect-rebind");
    let cwd = Path::new("/workspace");
    let endpoint = "https://mcp.example.test/mcp";
    let config = || McpOAuthConfiguration {
        registration: McpOAuthRegistration::Dynamic { client_name: None },
        scopes: vec!["mcp:read".into()],
        authorization_metadata: None,
    };
    configure_mcp_oauth(cwd, "slack", endpoint, config()).unwrap();
    let path = oauth_store_path(cwd).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.redirect_uri = Some("https://nac.example.test/old-callback".into());
        profile.registered_client_secret = Some("old-secret".into());
        profile.credentials = Some(
            serde_json::from_value(serde_json::json!({
                "client_id": "old-dynamic-client",
                "token_response": {
                    "access_token": "old-access-token",
                    "token_type": "bearer"
                },
                "granted_scopes": ["mcp:read"],
                "token_received_at": 1,
                "issuer": null
            }))
            .unwrap(),
        );
        Ok(())
    })
    .unwrap();

    assert_eq!(
        configure_mcp_oauth(cwd, "slack", endpoint, config()).unwrap(),
        McpOAuthStatus::Connected
    );
    assert!(set_mcp_oauth_redirect_uri(
        cwd,
        "slack",
        endpoint,
        "https://nac.example.test/new-callback"
    )
    .unwrap());
    assert_eq!(
        mcp_oauth_status(cwd, "slack", endpoint).unwrap(),
        McpOAuthStatus::NeedsAuthorization
    );
}

#[test]
fn begin_requires_fresh_dynamic_registration_for_a_changed_redirect() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("dynamic-begin-redirect-rebind");
    let cwd = Path::new("/workspace");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(
        cwd,
        "slack",
        endpoint,
        McpOAuthConfiguration {
            registration: McpOAuthRegistration::Dynamic { client_name: None },
            scopes: vec!["mcp:read".into()],
            authorization_metadata: None,
        },
    )
    .unwrap();
    let path = oauth_store_path(cwd).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.redirect_uri = Some("https://nac.example.test/old-callback".into());
        profile.credentials = Some(StoredCredentials::new(
            "old-dynamic-client".into(),
            None,
            vec!["mcp:read".into()],
            None,
        ));
        Ok(())
    })
    .unwrap();

    let profile = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    let registration = resolve_registration(&profile.registration).unwrap();
    assert!(!requires_dynamic_registration(
        &profile,
        &registration,
        "https://nac.example.test/old-callback"
    ));
    assert!(requires_dynamic_registration(
        &profile,
        &registration,
        "https://nac.example.test/new-callback"
    ));
}

#[test]
fn step_up_publish_and_stale_failure_cannot_replace_a_live_authorization() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("step-up-publish-race");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        for state in ["authenticate", "step-up"] {
            profile.states.insert(
                state.into(),
                serde_json::from_value(serde_json::json!({
                    "pkce_verifier": format!("{state}-verifier"),
                    "csrf_token": state,
                    "created_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                    "requested_scopes": []
                }))
                .unwrap(),
            );
        }
        profile.pending_authorization_url =
            Some("https://auth.example.test/authorize?state=authenticate".into());
        Ok(())
    })
    .unwrap();

    record_mcp_oauth_pending_authorization_url(
        Path::new("/workspace"),
        "slack",
        endpoint,
        "https://auth.example.test/authorize?state=step-up".into(),
    )
    .unwrap();
    let profile = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    assert_eq!(
        profile.pending_authorization_url.as_deref(),
        Some("https://auth.example.test/authorize?state=authenticate")
    );
    assert!(!profile.states.contains_key("step-up"));

    assert!(!fail_mcp_oauth_authorization(
        Path::new("/workspace"),
        "slack",
        endpoint,
        Some("https://auth.example.test/authorize?state=step-up"),
    )
    .unwrap());
    assert!(
        mcp_oauth_pending_authorization_url(Path::new("/workspace"), "slack", endpoint)
            .unwrap()
            .is_some()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn scope_step_up_preserves_an_unpublished_live_authorization_state() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("step-up-prepublication-race");
    let cwd = Path::new("/workspace");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(cwd).unwrap();
    let adapter = OAuthProfileStore {
        path: path.clone(),
        server_name: "slack".into(),
        endpoint: normalize_endpoint(endpoint).unwrap(),
        expected_client_id: Some("public-test-client".into()),
        save_mode: CredentialSaveMode::Independent,
    };
    let state = serde_json::from_value(serde_json::json!({
        "pkce_verifier": "prepublication-verifier",
        "csrf_token": "prepublication",
        "created_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        "requested_scopes": ["mcp:write"]
    }))
    .unwrap();
    StateStore::save(&adapter, "prepublication", state)
        .await
        .unwrap();
    assert!(mcp_oauth_pending_authorization_url(cwd, "slack", endpoint)
        .unwrap()
        .is_none());

    let step_up = prepare_mcp_oauth_scope_step_up(cwd, "slack", endpoint, "mcp:admin").unwrap();
    assert!(step_up.authorization_in_progress);
    let profile = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    assert!(profile
        .pending_authorization_url
        .as_deref()
        .is_some_and(|url| url.starts_with("urn:nac:oauth:pending")));
    assert!(profile.states.contains_key("prepublication"));
    let authorization_url = "https://auth.example.test/authorize?state=prepublication".to_string();
    record_mcp_oauth_pending_authorization_url(cwd, "slack", endpoint, authorization_url.clone())
        .unwrap();
    assert_eq!(
        mcp_oauth_pending_authorization_url(cwd, "slack", endpoint).unwrap(),
        Some(authorization_url)
    );
}

#[tokio::test(flavor = "current_thread")]
async fn failed_authorization_start_discards_its_unpublished_state() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("step-up-publication-failure");
    let cwd = Path::new("/workspace");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(cwd).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.pending_scopes = vec!["mcp:write".into()];
        profile.credentials = Some(
            serde_json::from_value(serde_json::json!({
                "client_id": "public-test-client",
                "token_response": {
                    "access_token": "existing-access-token",
                    "token_type": "bearer"
                },
                "granted_scopes": ["mcp:read"],
                "token_received_at": 1,
                "issuer": null
            }))
            .unwrap(),
        );
        Ok(())
    })
    .unwrap();
    let adapter = OAuthProfileStore {
        path: path.clone(),
        server_name: "slack".into(),
        endpoint: normalize_endpoint(endpoint).unwrap(),
        expected_client_id: Some("public-test-client".into()),
        save_mode: CredentialSaveMode::Independent,
    };
    let state = serde_json::from_value(serde_json::json!({
        "pkce_verifier": "unpublished-verifier",
        "csrf_token": "unpublished",
        "created_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        "requested_scopes": ["mcp:write"]
    }))
    .unwrap();
    StateStore::save(&adapter, "unpublished", state)
        .await
        .unwrap();

    let error = failed_authorization_start(
        cwd,
        "slack",
        endpoint,
        "https://auth.example.test/authorize?state=unpublished",
        anyhow!("client registration persistence failed"),
    );
    assert_eq!(error.to_string(), "client registration persistence failed");
    let profile = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    assert!(profile.pending_authorization_url.is_none());
    assert_eq!(profile.pending_scopes, ["mcp:write"]);
    assert!(!profile.states.contains_key("unpublished"));
    assert_eq!(
        mcp_oauth_status(cwd, "slack", endpoint).unwrap(),
        McpOAuthStatus::NeedsAuthorization
    );

    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.states.insert(
            "replacement".into(),
            serde_json::from_value(serde_json::json!({
                "pkce_verifier": "replacement-verifier",
                "csrf_token": "replacement",
                "created_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                "requested_scopes": ["mcp:write"]
            }))
            .unwrap(),
        );
        profile.pending_authorization_url =
            Some("https://auth.example.test/authorize?state=replacement".into());
        Ok(())
    })
    .unwrap();
    assert!(!discard_mcp_oauth_pending_authorization(
        cwd,
        "slack",
        endpoint,
        "https://auth.example.test/authorize?state=unpublished",
    )
    .unwrap());
    assert_eq!(
        mcp_oauth_pending_authorization_url(cwd, "slack", endpoint).unwrap(),
        Some("https://auth.example.test/authorize?state=replacement".into())
    );
}

#[test]
fn scope_step_up_defers_default_loopback_until_authentication_starts() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("loopback-step-up");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration()).unwrap();
    edit_store(
        &oauth_store_path(Path::new("/workspace")).unwrap(),
        |store| {
            store.profiles.get_mut("slack").unwrap().credentials = Some(
                serde_json::from_value(serde_json::json!({
                    "client_id": "public-test-client",
                    "token_response": {
                        "access_token": "access-token-canary",
                        "token_type": "bearer"
                    },
                    "granted_scopes": ["mcp:read"],
                    "token_received_at": 1,
                    "issuer": null
                }))
                .unwrap(),
            );
            Ok(())
        },
    )
    .unwrap();

    let step_up = prepare_mcp_oauth_scope_step_up(
        Path::new("/workspace"),
        "slack",
        endpoint,
        "mcp:write mcp:admin",
    )
    .unwrap();
    assert!(step_up.uses_loopback);
    assert_eq!(
        step_up.authorization_scopes,
        vec![
            "channels:history",
            "chat:write",
            "mcp:write",
            "mcp:admin",
            "mcp:read"
        ]
    );
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
        McpOAuthStatus::NeedsAuthorization
    );
    assert_eq!(
        mcp_oauth_pending_authorization_url(Path::new("/workspace"), "slack", endpoint).unwrap(),
        None
    );
}

#[tokio::test(flavor = "current_thread")]
async fn remote_scope_step_up_defers_without_invalidating_an_active_authorization() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("remote-step-up");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration()).unwrap();
    edit_store(
        &oauth_store_path(Path::new("/workspace")).unwrap(),
        |store| {
            let profile = store.profiles.get_mut("slack").unwrap();
            profile.redirect_uri =
                Some("https://nac.example.test/mcp_library/servers/slack/oauth/callback".into());
            profile.credentials = Some(
                serde_json::from_value(serde_json::json!({
                    "client_id": "public-test-client",
                    "token_response": {
                        "access_token": "access-token-canary",
                        "token_type": "bearer"
                    },
                    "granted_scopes": ["mcp:read"],
                    "token_received_at": 1,
                    "issuer": null
                }))
                .unwrap(),
            );
            profile.pending_authorization_url =
                Some("https://auth.example.test/authorize?state=active".into());
            profile.states.insert(
                "active".into(),
                serde_json::from_value(serde_json::json!({
                    "pkce_verifier": "active-verifier",
                    "csrf_token": "active",
                    "created_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                    "requested_scopes": ["mcp:read"],
                }))
                .unwrap(),
            );
            Ok(())
        },
    )
    .unwrap();

    let step_up =
        prepare_mcp_oauth_scope_step_up(Path::new("/workspace"), "slack", endpoint, "mcp:write")
            .unwrap();
    assert!(!step_up.uses_loopback);
    assert!(step_up.authorization_in_progress);
    assert_eq!(
        step_up.authorization_scopes,
        vec!["channels:history", "chat:write", "mcp:write", "mcp:read"]
    );
    let prepared = read_store(&oauth_store_path(Path::new("/workspace")).unwrap())
        .unwrap()
        .profiles
        .remove("slack")
        .unwrap();
    assert_eq!(
        prepared.pending_authorization_url.as_deref(),
        Some("https://auth.example.test/authorize?state=active")
    );
    assert!(prepared.states.contains_key("active"));
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
        McpOAuthStatus::Connected
    );

    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.pending_authorization_url = None;
        profile.states.clear();
        profile.states.insert(
            "replacement".into(),
            serde_json::from_value(serde_json::json!({
                "pkce_verifier": "replacement-verifier",
                "csrf_token": "replacement",
                "created_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                "requested_scopes": ["mcp:write"]
            }))
            .unwrap(),
        );
        Ok(())
    })
    .unwrap();
    record_mcp_oauth_pending_authorization_url(
        Path::new("/workspace"),
        "slack",
        endpoint,
        "https://auth.example.test/authorize?state=replacement".into(),
    )
    .unwrap();
    let published = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    assert_eq!(published.states.len(), 1);
    assert!(published.states.contains_key("replacement"));

    let adapter = OAuthProfileStore {
        path,
        server_name: "slack".into(),
        endpoint: normalize_endpoint(endpoint).unwrap(),
        expected_client_id: Some("public-test-client".into()),
        save_mode: CredentialSaveMode::Independent,
    };
    let credentials = prepared.credentials.unwrap();
    CredentialStore::save(&adapter, credentials).await.unwrap();
    let completed = adapter.profile().unwrap();
    assert_eq!(
        completed.pending_authorization_url.as_deref(),
        Some("https://auth.example.test/authorize?state=replacement")
    );
    assert!(completed.states.contains_key("replacement"));
    assert_eq!(completed.pending_scopes, vec!["mcp:write"]);
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
        McpOAuthStatus::Connected
    );

    edit_store(&adapter.path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.pending_authorization_url =
            Some("https://auth.example.test/authorize?state=expired".into());
        profile.states.insert(
            "expired".into(),
            serde_json::from_value(serde_json::json!({
                "pkce_verifier": "expired-verifier",
                "csrf_token": "expired",
                "created_at": 0,
                "requested_scopes": ["mcp:write"]
            }))
            .unwrap(),
        );
        Ok(())
    })
    .unwrap();
    let replacement =
        prepare_mcp_oauth_scope_step_up(Path::new("/workspace"), "slack", endpoint, "mcp:admin")
            .unwrap();
    assert!(!replacement.authorization_in_progress);
    let replacement = adapter.profile().unwrap();
    assert!(replacement.pending_authorization_url.is_none());
    assert!(replacement.states.is_empty());
}

#[tokio::test(flavor = "current_thread")]
async fn remote_redirect_rebinding_uses_an_independent_step_up_manager() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("remote-step-up-rebinding");
    let endpoint = "https://mcp.example.test/mcp";
    let redirect_uri = "https://nac.example.test/mcp_library/servers/slack/oauth/callback";
    let mut config = configuration();
    config.authorization_metadata = Some(McpOAuthAuthorizationMetadata {
        authorization_endpoint: "https://auth.example.test/authorize".into(),
        token_endpoint: "https://auth.example.test/token".into(),
        registration_endpoint: None,
        issuer: None,
        jwks_uri: None,
        scopes_supported: None,
        response_types_supported: None,
        code_challenge_methods_supported: None,
        additional_fields: BTreeMap::new(),
    });
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, config).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        profile.redirect_uri = Some(MCP_OAUTH_REDIRECT_URI.into());
        profile.pending_authorization_url =
            Some("https://auth.example.test/authorize?state=stale-local".into());
        profile.pending_scopes = vec!["stale:scope".into()];
        profile.credentials = Some(
            serde_json::from_value(serde_json::json!({
                "client_id": "public-test-client",
                "token_response": {
                    "access_token": "existing-access-token",
                    "token_type": "bearer"
                },
                "granted_scopes": ["mcp:read"],
                "token_received_at": 1,
                "issuer": null
            }))
            .unwrap(),
        );
        Ok(())
    })
    .unwrap();

    assert!(
        set_mcp_oauth_redirect_uri(Path::new("/workspace"), "slack", endpoint, redirect_uri)
            .unwrap()
    );
    assert!(
        !set_mcp_oauth_redirect_uri(Path::new("/workspace"), "slack", endpoint, redirect_uri)
            .unwrap()
    );
    assert!(
        mcp_oauth_pending_authorization_url(Path::new("/workspace"), "slack", endpoint)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
        McpOAuthStatus::Connected
    );

    let live_manager = authorized_manager(Path::new("/workspace"), "slack", endpoint)
        .await
        .unwrap();
    let step_up =
        prepare_mcp_oauth_scope_step_up(Path::new("/workspace"), "slack", endpoint, "mcp:write")
            .unwrap();
    let step_up_manager = authorized_manager(Path::new("/workspace"), "slack", endpoint)
        .await
        .unwrap();
    let authorization_url = step_up_manager
        .request_scope_upgrade(&step_up.authorization_scopes.join(" "))
        .await
        .unwrap();
    record_mcp_oauth_pending_authorization_url(
        Path::new("/workspace"),
        "slack",
        endpoint,
        authorization_url,
    )
    .unwrap();
    let authorization_url =
        mcp_oauth_pending_authorization_url(Path::new("/workspace"), "slack", endpoint)
            .unwrap()
            .unwrap();
    let authorization_url = url::Url::parse(&authorization_url).unwrap();
    assert_eq!(
        authorization_url
            .query_pairs()
            .find_map(|(name, value)| (name == "redirect_uri").then(|| value.into_owned()))
            .as_deref(),
        Some(redirect_uri)
    );
    assert_eq!(
        live_manager.get_access_token().await.unwrap(),
        "existing-access-token"
    );
}

#[test]
fn restored_cimd_client_uses_the_bound_metadata_url_and_redirect_application_type() {
    let profile: OAuthProfile = serde_json::from_value(serde_json::json!({
        "binding": {
            "endpoint": "https://mcp.example.test/mcp",
            "configuration_fingerprint": "fingerprint",
            "owner": "owner",
            "host": "host"
        },
        "registration": {
            "type": "client_metadata",
            "url": "https://client.example.test/client-metadata.json"
        },
        "scopes": ["mcp:read"],
        "credentials": {
            "client_id": "https://client.example.test/client-metadata.json",
            "token_response": null,
            "granted_scopes": [],
            "token_received_at": null,
            "issuer": null
        },
        "states": {}
    }))
    .unwrap();
    let registration = resolve_registration(&profile.registration).unwrap();

    let client = restored_client_config(
        &profile,
        &registration,
        "https://nac.example.test/oauth/callback",
        vec!["mcp:read".into()],
    )
    .unwrap();
    assert_eq!(
        client.client_id,
        "https://client.example.test/client-metadata.json"
    );
    assert_eq!(client.application_type.as_deref(), Some("web"));

    let mut mismatched = profile;
    mismatched.credentials.as_mut().unwrap().client_id = "different-client".into();
    assert!(restored_client_config(
        &mismatched,
        &registration,
        MCP_OAUTH_REDIRECT_URI,
        Vec::new(),
    )
    .is_err());
}
