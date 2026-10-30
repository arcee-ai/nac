use super::*;
use crate::mcp::oauth;
use crate::mcp::recording_server::TestHome;
use crate::TEST_ENV_LOCK;
use rmcp::transport::auth::ScopeUpgradeConfig;
use rmcp::transport::streamable_http_client::InsufficientScopeError;

fn challenge() -> std::result::Result<(), StreamableHttpError<reqwest::Error>> {
    Err(StreamableHttpError::InsufficientScope(
        InsufficientScopeError::new(
            "Bearer error=\"insufficient_scope\", scope=\"mcp:write\"".into(),
            Some("mcp:write".into()),
        ),
    ))
}

fn pending_url(cwd: &Path, endpoint: &str) -> Option<String> {
    oauth::mcp_oauth_pending_authorization_url(cwd, "oauth", endpoint).unwrap()
}

fn discard_pending(cwd: &Path, endpoint: &str) {
    let url = pending_url(cwd, endpoint).expect("scope-upgrade URL was published");
    assert!(oauth::fail_mcp_oauth_authorization(cwd, "oauth", endpoint, Some(&url)).unwrap());
}

#[tokio::test(flavor = "current_thread")]
async fn remote_scope_upgrade_recovers_after_logout_without_resetting_each_attempt() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let endpoint = "https://mcp.example.test/mcp";
    let home = TestHome::new("nac-mcp-step-up-reauthorization", "oauth", endpoint);
    let cwd = &home.path;
    let seed = |token| {
        oauth::test_support::seed_authorization(
            cwd,
            "oauth",
            endpoint,
            "TEST_MCP_CLIENT_ID",
            token,
            None,
        )
        .unwrap();
    };
    seed("first-access-canary");
    let redirect_uri = "https://nac.example.test/mcp_library/servers/oauth/oauth/callback";
    oauth::set_mcp_oauth_redirect_uri(cwd, "oauth", endpoint, redirect_uri).unwrap();
    let client = NacOAuthClient {
        inner: AuthClient::new(
            reqwest::Client::new(),
            oauth::authorized_manager(cwd, "oauth", endpoint)
                .await
                .unwrap(),
        ),
        step_up_manager: Arc::new(tokio::sync::Mutex::new(None)),
        cwd: cwd.clone(),
        server_name: "oauth".into(),
        endpoint: endpoint.into(),
    };

    assert!(client.capture_scope_step_up(challenge()).await.is_err());
    discard_pending(cwd, endpoint);
    let stale_step_up =
        oauth::prepare_mcp_oauth_scope_step_up(cwd, "oauth", endpoint, "mcp:write").unwrap();
    oauth::clear_mcp_oauth(cwd, "oauth").unwrap();
    seed("reauthorized-access-canary");
    assert_eq!(
        client.access_token(None).await.unwrap().as_deref(),
        Some("reauthorized-access-canary")
    );
    // A new token must not let work prepared before logout publish a fresh callback state.
    assert!(client.scope_upgrade_url(&stale_step_up).await.is_err());
    assert!(pending_url(cwd, endpoint).is_none());

    let maximum = ScopeUpgradeConfig::default().max_upgrade_attempts;
    for _ in 0..maximum {
        assert!(client.capture_scope_step_up(challenge()).await.is_err());
        let url = pending_url(cwd, endpoint)
            .expect("a mounted client's scope upgrade recovers after reauthorization");
        let url = url::Url::parse(&url).unwrap();
        assert!(url.query_pairs().any(|(name, value)| name == "scope"
            && value.split_whitespace().any(|scope| scope == "mcp:write")));
        assert!(url
            .query_pairs()
            .any(|(name, value)| name == "redirect_uri" && value == redirect_uri));
        discard_pending(cwd, endpoint);
    }
    // Reusing the manager within this generation preserves the SDK's upgrade throttle.
    assert!(client.capture_scope_step_up(challenge()).await.is_err());
    assert!(pending_url(cwd, endpoint).is_none());
}
