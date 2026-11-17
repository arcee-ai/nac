use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

fn adapter(path: &Path) -> OAuthProfileStore {
    OAuthProfileStore {
        path: path.to_owned(),
        server_name: "slack".into(),
        endpoint: "https://mcp.example.test/mcp".into(),
        expected_client_id: Some("public-test-client".into()),
        save_mode: CredentialSaveMode::Independent,
        logout_generation: test_support::logout_generation(path, "slack"),
        completion: CompletionOwnership::default(),
    }
}

async fn pending(adapter: &OAuthProfileStore) {
    let state = serde_json::from_value(serde_json::json!({
        "pkce_verifier":"completion-test-verifier", "csrf_token":"completion-state",
        "created_at":SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        "requested_scopes":["channels:history"]
    }))
    .unwrap();
    StateStore::save(adapter, "completion-state", state)
        .await
        .unwrap();
    record_mcp_oauth_pending_authorization_url(
        Path::new("/workspace"),
        "slack",
        &adapter.endpoint,
        "https://auth.example.test/authorize?state=completion-state".into(),
    )
    .unwrap();
}

struct BothLoaded {
    inner: OAuthProfileStore,
    barrier: Arc<tokio::sync::Barrier>,
}

#[tokio::test(flavor = "current_thread")]
async fn old_retirement_and_idle_expiry_preserve_prepared_replacement() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    for claimed in [false, true] {
        for idle_expiry in [false, true] {
            let (_home, _restore) =
                test_environment(&format!("prepared-retirement-{claimed}-{idle_expiry}"));
            let cwd = Path::new("/workspace");
            let endpoint = "https://mcp.example.test/mcp";
            configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
            let path = oauth_store_path(cwd).unwrap();
            let old = adapter(&path);
            pending(&old).await;
            if claimed {
                StateStore::delete(&old, "completion-state").await.unwrap();
            }
            let candidate = adapter(&path);
            let created = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();
            StateStore::save(
                &candidate,
                "prepared-state",
                serde_json::from_value(serde_json::json!({
                    "pkce_verifier":"prepared-verifier", "csrf_token":"prepared-state",
                    "created_at":created, "requested_scopes":["mcp:replacement"]
                }))
                .unwrap(),
            )
            .await
            .unwrap();
            // B was saved while A was live; a later challenge/expiry must not
            // erase B or scope requirements added after begin's snapshot.
            prepare_mcp_oauth_scope_step_up(cwd, "slack", endpoint, "mcp:concurrent").unwrap();
            edit_store(&path, |store| {
                let profile = store.profiles.get_mut("slack").unwrap();
                let expired = created - MCP_OAUTH_STATE_TTL.as_secs() - 1;
                if claimed {
                    let mut value = serde_json::to_value(&*profile)?;
                    value["completing_authorization"]["created_at"] = expired.into();
                    *profile = serde_json::from_value(value)?;
                } else {
                    profile
                        .states
                        .get_mut("completion-state")
                        .unwrap()
                        .created_at = expired;
                }
                Ok(())
            })
            .unwrap();
            if idle_expiry {
                let step =
                    prepare_mcp_oauth_scope_step_up(cwd, "slack", endpoint, "mcp:late").unwrap();
                assert!(!step.authorization_in_progress);
            } else {
                assert!(fail_mcp_oauth_authorization(
                    cwd,
                    "slack",
                    endpoint,
                    Some("https://auth.example.test/authorize?state=completion-state")
                )
                .unwrap());
            }
            // Reload the durable profile, then use the same publication helper
            // as real begin; no in-memory snapshot is restored.
            let retired = read_store(&path).unwrap().profiles.remove("slack").unwrap();
            let published = edit_store(&path, |store| {
                publish_pending_authorization(
                    store.profiles.get_mut("slack").unwrap(),
                    "https://auth.example.test/authorize?state=prepared-state".into(),
                )
            });
            assert!(
                published.is_ok(),
                "old retirement erased prepared state: {published:?}"
            );
            assert!(retired.pending_scopes.iter().any(|s| s == "mcp:concurrent"));
            assert_eq!(retired.states["prepared-state"].created_at, created);
            assert!(!retired.states.contains_key("completion-state"));
            assert!(retired.completing_authorization.is_none());
            assert!(!fail_mcp_oauth_authorization(
                cwd,
                "slack",
                endpoint,
                Some("https://auth.example.test/authorize?state=completion-state")
            )
            .unwrap());
            if claimed {
                assert!(
                    CredentialStore::save(&old, credentials("old-after-retirement"))
                        .await
                        .is_err()
                );
            } else {
                assert!(StateStore::delete(&old, "completion-state").await.is_err());
            }
            StateStore::delete(&candidate, "prepared-state")
                .await
                .unwrap();
            CredentialStore::save(&candidate, credentials("prepared-completion"))
                .await
                .unwrap();
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn unscoped_failure_and_logout_still_clear_prepared_candidates() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    for logout in [false, true] {
        let (_home, _restore) = test_environment(&format!("prepared-global-clear-{logout}"));
        let cwd = Path::new("/workspace");
        let endpoint = "https://mcp.example.test/mcp";
        configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
        let path = oauth_store_path(cwd).unwrap();
        let current = adapter(&path);
        pending(&current).await;
        let mut candidate =
            read_store(&path).unwrap().profiles["slack"].states["completion-state"].clone();
        candidate.csrf_token = "prepared-state".into();
        StateStore::save(&current, "prepared-state", candidate)
            .await
            .unwrap();
        if logout {
            clear_mcp_oauth(cwd, "slack").unwrap();
        } else {
            assert!(fail_mcp_oauth_authorization(cwd, "slack", endpoint, None).unwrap());
        }
        let profile = read_store(&path).unwrap().profiles.remove("slack").unwrap();
        assert!(profile.states.is_empty());
        assert!(profile.pending_scopes.is_empty());
        assert!(profile.completing_authorization.is_none());
        assert!(profile.pending_authorization_url.is_none());
        assert!(profile.preparing_states.is_empty());
    }
}

#[tokio::test(flavor = "current_thread")]
async fn failed_prepared_replacement_preserves_the_claimed_exchange() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("completion-failed-replacement");
    let cwd = Path::new("/workspace");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(cwd).unwrap();
    let winner = adapter(&path);
    pending(&winner).await;
    StateStore::delete(&winner, "completion-state")
        .await
        .unwrap();
    prepare_mcp_oauth_scope_step_up(cwd, "slack", endpoint, "mcp:concurrent").unwrap();
    let candidate = adapter(&path);
    let state = serde_json::from_value(serde_json::json!({
        "pkce_verifier":"candidate-verifier", "csrf_token":"candidate-state",
        "created_at":SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        "requested_scopes":["mcp:concurrent"]
    }))
    .unwrap();
    StateStore::save(&candidate, "candidate-state", state)
        .await
        .unwrap();
    let prepared = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    let failure = failed_authorization_start(
        cwd,
        "slack",
        endpoint,
        "https://auth.example.test/authorize?state=candidate-state",
        anyhow!("candidate credential read failed"),
    );
    let failed = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    let saved = CredentialStore::save(&winner, credentials("winner-after-failed-start")).await;
    let settled = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    assert_eq!(failure.to_string(), "candidate credential read failed");
    assert_eq!(
        prepared.pending_authorization_url.as_deref(),
        Some("https://auth.example.test/authorize?state=completion-state")
    );
    assert_eq!(
        failed.pending_authorization_url,
        prepared.pending_authorization_url
    );
    assert!(failed.completing_authorization.is_some());
    assert!(!failed.states.contains_key("candidate-state"));
    assert!(
        saved.is_ok(),
        "the original claimed completion must still save: {saved:?}"
    );
    assert!(settled
        .pending_scopes
        .iter()
        .any(|scope| scope == "mcp:concurrent"));
    assert!(settled.completing_authorization.is_none());
}
#[async_trait]
impl StateStore for BothLoaded {
    async fn save(
        &self,
        key: &str,
        state: StoredAuthorizationState,
    ) -> std::result::Result<(), AuthError> {
        StateStore::save(&self.inner, key, state).await
    }
    async fn load(
        &self,
        key: &str,
    ) -> std::result::Result<Option<StoredAuthorizationState>, AuthError> {
        let state = StateStore::load(&self.inner, key).await?;
        self.barrier.wait().await;
        Ok(state)
    }
    async fn delete(&self, key: &str) -> std::result::Result<(), AuthError> {
        StateStore::delete(&self.inner, key).await
    }
}

#[tokio::test(flavor = "current_thread")]
async fn concurrent_callback_claims_allow_one_token_request_and_no_late_save() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("completion-claim-race");
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(AtomicBool::new(false));
    let responses = (0..2).map(|_| ScriptedResponse::json("200 OK",
        r#"{"access_token":"completion-canary","token_type":"Bearer","scope":"channels:history"}"#)).collect();
    let server = ScriptedServer::start_observed(responses, {
        let entered = entered.clone();
        let release = release.clone();
        move |_, _| {
            entered.notify_one();
            let end = std::time::Instant::now() + Duration::from_secs(5);
            while !release.load(Ordering::Acquire) && std::time::Instant::now() < end {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    });
    // The resource and token peer are both local; the safe SDK rejects public-to-loopback requests.
    let endpoint = format!("{}/mcp", server.base_url);
    let mut config = configuration();
    config.authorization_metadata = Some(McpOAuthAuthorizationMetadata {
        authorization_endpoint: "https://auth.example.test/authorize".into(),
        token_endpoint: format!("{}/token", server.base_url),
        registration_endpoint: None,
        issuer: None,
        jwks_uri: None,
        scopes_supported: None,
        response_types_supported: None,
        code_challenge_methods_supported: None,
        additional_fields: BTreeMap::new(),
    });
    configure_mcp_oauth(Path::new("/workspace"), "slack", &endpoint, config).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    let mut local_adapter = adapter(&path);
    local_adapter.endpoint = normalize_endpoint(&endpoint).unwrap();
    pending(&local_adapter).await;
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let mut tasks = Vec::new();
    for code in ["first-code", "second-code"] {
        let (mut manager, _, _, _) = manager_and_profile(
            Path::new("/workspace"),
            "slack",
            &endpoint,
            CredentialSaveMode::Independent,
        )
        .await
        .unwrap();
        let store = local_adapter.clone();
        manager.set_credential_store(store.clone());
        manager.set_state_store(BothLoaded {
            inner: store,
            barrier: barrier.clone(),
        });
        manager
            .configure_client(OAuthClientConfig::new(
                "public-test-client",
                MCP_OAUTH_REDIRECT_URI,
            ))
            .unwrap();
        tasks.push(tokio::spawn(async move {
            manager
                .exchange_code_for_token(code, "completion-state")
                .await
        }));
    }
    let reached = tokio::time::timeout(Duration::from_secs(5), entered.notified()).await;
    let retired = fail_mcp_oauth_authorization(
        Path::new("/workspace"),
        "slack",
        &endpoint,
        Some("https://auth.example.test/authorize?state=completion-state"),
    );
    release.store(true, Ordering::Release);
    let mut results = Vec::new();
    for mut task in tasks {
        match tokio::time::timeout(Duration::from_secs(5), &mut task).await {
            Ok(value) => results.push(value.unwrap()),
            Err(_) => {
                task.abort();
                let _ = task.await;
                panic!("callback did not settle");
            }
        }
    }
    let requests = server.stop_and_finish();
    assert!(reached.is_ok());
    assert!(retired.unwrap());
    assert_eq!(
        requests.len(),
        1,
        "exactly one callback may request a token"
    );
    assert!(
        results.iter().all(|result| result.is_err()),
        "retirement rejects even the winning late response"
    );
    assert_eq!(
        mcp_oauth_status(Path::new("/workspace"), "slack", &endpoint).unwrap(),
        McpOAuthStatus::NeedsAuthorization
    );
}

#[tokio::test(flavor = "current_thread")]
async fn another_scope_challenge_preserves_a_consumed_completion_binding() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("completion-step-up");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(Path::new("/workspace")).unwrap();
    let store = adapter(&path);
    pending(&store).await;
    StateStore::delete(&store, "completion-state")
        .await
        .unwrap();
    let step = prepare_mcp_oauth_scope_step_up(
        Path::new("/workspace"),
        "slack",
        endpoint,
        "mcp:additional",
    )
    .unwrap();
    assert!(
        step.authorization_in_progress,
        "a consumed live completion still owns its request"
    );
    assert!(mcp_oauth_authorization_is_current(
        Path::new("/workspace"),
        "slack",
        endpoint,
        "https://auth.example.test/authorize?state=completion-state"
    )
    .unwrap());
    assert!(step
        .authorization_scopes
        .iter()
        .any(|scope| scope == "mcp:additional"));
    CredentialStore::save(&store, credentials("accepted-completion-canary"))
        .await
        .unwrap();
    let profile = read_store(&path).unwrap().profiles.remove("slack").unwrap();
    assert!(profile
        .pending_scopes
        .iter()
        .any(|scope| scope == "mcp:additional"));
    assert!(!mcp_oauth_completion_is_pending(Path::new("/workspace"), "slack", endpoint).unwrap());
}

fn credentials(value: &str) -> StoredCredentials {
    serde_json::from_value(serde_json::json!({
        "client_id":"public-test-client", "token_response":{"access_token":value,"token_type":"Bearer"},
        "granted_scopes":["channels:history"], "token_received_at":1, "issuer":null
    })).unwrap()
}

#[tokio::test(flavor = "current_thread")]
async fn completion_keeps_original_expiry_across_store_reads_and_rejects_late_save() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("completion-original-expiry");
    let cwd = Path::new("/workspace");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(cwd).unwrap();
    let store = adapter(&path);
    // Old v2 profiles omit this optional field and retain their original meaning.
    let legacy: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert!(legacy["profiles"]["slack"]
        .get("completing_authorization")
        .is_none());
    assert!(!mcp_oauth_completion_is_pending(cwd, "slack", endpoint).unwrap());
    pending(&store).await;
    let original = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        - 60;
    edit_store(&path, |file| {
        file.profiles
            .get_mut("slack")
            .unwrap()
            .states
            .get_mut("completion-state")
            .unwrap()
            .created_at = original;
        Ok(())
    })
    .unwrap();
    StateStore::delete(&store, "completion-state")
        .await
        .unwrap();
    let consumed: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(
        consumed["profiles"]["slack"]["completing_authorization"]["created_at"],
        original
    );
    assert!(mcp_oauth_completion_is_pending(cwd, "slack", endpoint).unwrap());
    assert!(StateStore::load(&store, "completion-state")
        .await
        .unwrap()
        .is_none());
    assert!(mcp_oauth_pending_authorization_url(cwd, "slack", endpoint)
        .unwrap()
        .is_none());
    // Age the persisted receipt, not the host clock or a renewed timer.
    edit_store(&path, |file| {
        let profile = file.profiles.get_mut("slack").unwrap();
        let mut value = serde_json::to_value(&*profile)?;
        value["completing_authorization"]["created_at"] = 0.into();
        *profile = serde_json::from_value(value)?;
        Ok(())
    })
    .unwrap();
    assert!(!mcp_oauth_completion_is_pending(cwd, "slack", endpoint).unwrap());
    assert!(CredentialStore::save(&store, credentials("expired-canary"))
        .await
        .is_err());
    assert!(read_store(&path).unwrap().profiles["slack"]
        .credentials
        .is_none());
    let step = prepare_mcp_oauth_scope_step_up(cwd, "slack", endpoint, "mcp:new").unwrap();
    assert!(!step.authorization_in_progress);
    assert!(step
        .authorization_scopes
        .iter()
        .any(|scope| scope == "mcp:new"));
}

#[tokio::test(flavor = "current_thread")]
async fn completed_callback_releases_its_fence_before_a_later_guarded_refresh() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("completion-then-refresh");
    let cwd = Path::new("/workspace");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(cwd).unwrap();
    let mut store = adapter(&path);
    pending(&store).await;
    StateStore::delete(&store, "completion-state")
        .await
        .unwrap();
    CredentialStore::save(&store, credentials("callback-canary"))
        .await
        .unwrap();
    assert!(!mcp_oauth_completion_is_pending(cwd, "slack", endpoint).unwrap());
    store.save_mode = CredentialSaveMode::RefreshGuarded;
    let guard = CredentialStore::acquire_refresh_guard(&store)
        .await
        .unwrap()
        .unwrap();
    CredentialStore::save(&store, credentials("refresh-canary"))
        .await
        .unwrap();
    drop(guard);
    let file = read_store(&path).unwrap();
    let saved = serde_json::to_value(file.profiles["slack"].credentials.as_ref().unwrap()).unwrap();
    assert_eq!(saved["token_response"]["access_token"], "refresh-canary");
}

#[tokio::test(flavor = "current_thread")]
async fn prepared_provenance_is_private_and_retires_with_its_own_state() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("prepared-provenance");
    let cwd = Path::new("/workspace");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(cwd).unwrap();
    let current = adapter(&path);
    pending(&current).await;
    let profile = current.profile().unwrap();
    assert!(profile.preparing_states.is_empty());
    let mut legacy = serde_json::to_value(&profile).unwrap();
    assert!(legacy.get("preparing_states").is_none());
    legacy.as_object_mut().unwrap().remove("preparing_states");
    let legacy: OAuthProfile = serde_json::from_value(legacy).unwrap();
    assert!(legacy.preparing_states.is_empty());
    for publish in [false, true] {
        let mut state = profile.states["completion-state"].clone();
        state.csrf_token = "prepared-state".into();
        StateStore::save(&current, "prepared-state", state)
            .await
            .unwrap();
        let prepared = current.profile().unwrap();
        assert!(prepared.preparing_states.contains("prepared-state"));
        if publish {
            edit_store(&path, |store| {
                publish_pending_authorization(
                    store.profiles.get_mut("slack").unwrap(),
                    "https://auth.example.test/authorize?state=prepared-state".into(),
                )
            })
            .unwrap();
        } else {
            let _ = failed_authorization_start(
                cwd,
                "slack",
                endpoint,
                "https://auth.example.test/authorize?state=prepared-state",
                anyhow!("fixture preparation failed"),
            );
        }
        let settled = current.profile().unwrap();
        assert!(settled.preparing_states.is_empty());
        assert_eq!(settled.states.contains_key("prepared-state"), publish);
    }
}

#[tokio::test(flavor = "current_thread")]
async fn prepared_provenance_prunes_expired_dangling_and_unmarked_orphans() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("prepared-provenance-expiry");
    let cwd = Path::new("/workspace");
    let endpoint = "https://mcp.example.test/mcp";
    configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
    let path = oauth_store_path(cwd).unwrap();
    let current = adapter(&path);
    pending(&current).await;
    let mut candidate = current.profile().unwrap().states["completion-state"].clone();
    candidate.csrf_token = "prepared-state".into();
    StateStore::save(&current, "prepared-state", candidate)
        .await
        .unwrap();
    edit_store(&path, |store| {
        let profile = store.profiles.get_mut("slack").unwrap();
        let mut orphan = profile.states["prepared-state"].clone();
        orphan.csrf_token = "unmarked-orphan".into();
        profile.states.insert("unmarked-orphan".into(), orphan);
        profile
            .states
            .get_mut("completion-state")
            .unwrap()
            .created_at = 0;
        profile.states.get_mut("prepared-state").unwrap().created_at = 0;
        profile.preparing_states.insert("dangling-state".into());
        Ok(())
    })
    .unwrap();
    let step = prepare_mcp_oauth_scope_step_up(cwd, "slack", endpoint, "mcp:new").unwrap();
    assert!(!step.authorization_in_progress);
    let retired = current.profile().unwrap();
    assert!(retired.states.is_empty());
    assert!(retired.preparing_states.is_empty());
    assert!(retired.pending_authorization_url.is_none());
    assert!(step
        .authorization_scopes
        .iter()
        .any(|scope| scope == "mcp:new"));
}

#[tokio::test(flavor = "current_thread")]
async fn prepared_provenance_follows_each_profile_invalidation_owner() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    for operation in ["configure", "redirect", "rename", "credentials", "delete"] {
        let (_home, _restore) = test_environment(&format!("prepared-invalidate-{operation}"));
        let cwd = Path::new("/workspace");
        let endpoint = "https://mcp.example.test/mcp";
        configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
        let path = oauth_store_path(cwd).unwrap();
        let current = adapter(&path);
        pending(&current).await;
        let mut candidate = current.profile().unwrap().states["completion-state"].clone();
        candidate.csrf_token = "prepared-state".into();
        StateStore::save(&current, "prepared-state", candidate)
            .await
            .unwrap();
        assert!(current
            .profile()
            .unwrap()
            .preparing_states
            .contains("prepared-state"));
        match operation {
            "configure" => {
                configure_mcp_oauth(cwd, "slack", endpoint, configuration()).unwrap();
            }
            "redirect" => {
                assert!(set_mcp_oauth_redirect_uri(
                    cwd,
                    "slack",
                    endpoint,
                    "https://nac.example.test/callback"
                )
                .unwrap());
            }
            "rename" => rename_mcp_oauth_profile(
                cwd,
                "slack",
                "renamed",
                "https://nac.example.test/renamed",
            )
            .unwrap(),
            "credentials" => CredentialStore::clear(&current).await.unwrap(),
            "delete" => delete_mcp_oauth_profile(cwd, "slack").unwrap(),
            _ => unreachable!(),
        }
        let file = read_store(&path).unwrap();
        if operation == "delete" {
            assert!(!file.profiles.contains_key("slack"));
        } else {
            let name = if operation == "rename" {
                "renamed"
            } else {
                "slack"
            };
            assert!(file.profiles[name].states.is_empty(), "{operation}");
            assert!(
                file.profiles[name].preparing_states.is_empty(),
                "{operation}"
            );
            assert!(
                file.profiles[name].pending_authorization_url.is_none(),
                "{operation}"
            );
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn safe_oauth_constructor_denies_remote_to_loopback_before_token_request() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let (_home, _restore) = test_environment("address-policy");
    for local_resource in [false, true] {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            r#"{"access_token":"local-token","token_type":"Bearer"}"#,
        )]);
        let endpoint = if local_resource {
            format!("{}/mcp", server.base_url)
        } else {
            "https://mcp.example.test/mcp".into()
        };
        let mut config = configuration();
        config.authorization_metadata = Some(McpOAuthAuthorizationMetadata {
            authorization_endpoint: "https://auth.example.test/authorize".into(),
            token_endpoint: format!("{}/token", server.base_url),
            registration_endpoint: None,
            issuer: None,
            jwks_uri: None,
            scopes_supported: None,
            response_types_supported: None,
            code_challenge_methods_supported: None,
            additional_fields: BTreeMap::new(),
        });
        let cwd = Path::new("/workspace");
        configure_mcp_oauth(cwd, "policy", &endpoint, config).unwrap();
        let redirect = "http://localhost:1456/callback";
        let session = begin_mcp_oauth_authorization(cwd, "policy", &endpoint, redirect, &[])
            .await
            .unwrap();
        let state = authorization_state(session.authorization_url()).unwrap();
        let result = complete_mcp_oauth_authorization(
            cwd,
            "policy",
            &endpoint,
            &format!("{redirect}?code=test-code&state={state}"),
        )
        .await;
        let requests = server.stop_and_finish();
        if local_resource {
            result.unwrap();
            assert_eq!(requests.len(), 1);
            assert_eq!(requests[0].path, "/token");
            assert_eq!(
                mcp_oauth_status(cwd, "policy", &endpoint).unwrap(),
                McpOAuthStatus::Connected
            );
        } else {
            let error = format!("{:#}", result.unwrap_err());
            // The SDK intentionally exposes the token stage without the internal HTTP error.
            assert!(
                error.contains("OAuth token exchange failed: Request failed"),
                "{error}"
            );
            assert!(
                requests.is_empty(),
                "denied token destination must receive no request"
            );
            assert_ne!(
                mcp_oauth_status(cwd, "policy", &endpoint).unwrap(),
                McpOAuthStatus::Connected
            );
        }
        clear_mcp_oauth(cwd, "policy").unwrap();
    }
}
