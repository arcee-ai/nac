use super::super::test_http::{ScriptedResponse, ScriptedServer};
use super::*;
use std::cell::{Cell, RefCell};
use std::future::ready;
use std::net::TcpListener;
use std::path::PathBuf;
use std::rc::Rc;

#[cfg(unix)]
use std::os::unix::fs::symlink;

struct TestDir(PathBuf);

impl TestDir {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nac-arcee-auth-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn paths(&self) -> (PathBuf, PathBuf) {
        (self.0.join("auth.json"), self.0.join("arcee_auth.json"))
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn stored_auth(access_token: &str) -> StoredArceeAuth {
    StoredArceeAuth {
        auth_type: AUTH_TYPE.to_string(),
        access_token: access_token.to_string(),
        refresh_token: "refresh-1".to_string(),
        token_type: "bearer".to_string(),
        expires_at_ms: u64::MAX,
        base_url: "https://api.arcee.ai".to_string(),
        organization_id: "org-1".to_string(),
        workspace_name: "acme".to_string(),
        client_id: LEGACY_CLIENT_ID.to_string(),
        managed_bootstrap: None,
    }
}

fn write_credential(path: &Path, contents: impl AsRef<[u8]>) {
    fs::write(path, contents).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    }
}

fn write_json(path: &Path, auth: &StoredArceeAuth) {
    write_credential(path, serde_json::to_string_pretty(auth).unwrap());
}

fn assert_device_request(request: &super::super::test_http::CapturedRequest, path: &str) {
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, path);
    assert_eq!(
        request.headers.get("content-type").map(String::as_str),
        Some("application/json")
    );
    assert_eq!(
        request.headers.get("user-agent").map(String::as_str),
        Some(user_agent().as_str())
    );
}

#[tokio::test]
async fn device_code_request_uses_expected_contract_and_parses_complete_uri() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "device_code": "device-123",
            "user_code": "ABCD-EFGH",
            "verification_uri_complete": "https://accounts.arcee.ai/device?code=ABCD-EFGH",
            "interval": 3,
            "expires_in": 120
        })
        .to_string(),
    )]);

    let device = request_device_code(
        &no_redirect_client().unwrap(),
        &ArceeAuthService::for_test(&server.base_url),
    )
    .await
    .expect("device-code response should parse");
    let requests = server.finish();

    assert_eq!(device.device_code, "device-123");
    assert_eq!(device.user_code, "ABCD-EFGH");
    assert_eq!(
        device.verification_uri_complete,
        "https://accounts.arcee.ai/device?code=ABCD-EFGH"
    );
    assert_eq!(device.interval_secs, 3);
    assert_eq!(device.expires_in_secs, 120);
    assert_eq!(requests.len(), 1);
    assert_device_request(&requests[0], "/app/v1/device/code");
    assert_eq!(
        serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
        json!({"client_id": LEGACY_CLIENT_ID})
    );
}

#[tokio::test]
async fn device_code_request_supports_fallback_uri_and_default_timing() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "device_code": "device-fallback",
            "user_code": "FALL-BACK",
            "verification_uri": "https://accounts.arcee.ai/device"
        })
        .to_string(),
    )]);

    let device = request_device_code(
        &no_redirect_client().unwrap(),
        &ArceeAuthService::for_test(&server.base_url),
    )
    .await
    .expect("fallback verification URI should parse");
    server.finish();

    assert_eq!(
        device.verification_uri_complete,
        "https://accounts.arcee.ai/device"
    );
    assert_eq!(device.interval_secs, DEFAULT_INTERVAL_SECS);
    assert_eq!(device.expires_in_secs, DEFAULT_DEVICE_EXPIRES_IN_SECS);
}

#[tokio::test]
async fn device_code_request_reports_malformed_and_non_success_responses() {
    let cases = [
        (
            "200 OK",
            r#"{"device_code":"only-one-field"}"#,
            "did not include user_code",
        ),
        (
            "401 Unauthorized",
            r#"{"error":"invalid_client"}"#,
            "failed with HTTP 401",
        ),
    ];

    for (status, body, expected) in cases {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(status, body)]);
        let error = request_device_code(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&server.base_url),
        )
        .await
        .expect_err("invalid device-code response should fail");
        let requests = server.finish();

        assert!(
            error.to_string().contains(expected),
            "expected {expected:?} in {error:#}"
        );
        assert_device_request(&requests[0], "/app/v1/device/code");
    }
}

#[tokio::test]
async fn device_code_same_origin_redirect_is_reported_without_replay() {
    let server = ScriptedServer::start_same_origin_redirect(
        "308 Permanent Redirect",
        "/redirected-device-code",
        format!("{}not-in-error", "x".repeat(500)),
    );

    let error = request_device_code(
        &no_redirect_client().unwrap(),
        &ArceeAuthService::for_test(&server.base_url),
    )
    .await
    .expect_err("Arcee device-code redirects must not be followed")
    .to_string();
    let requests = server.finish();

    assert!(
        error.contains("HTTP 308 redirect"),
        "unexpected error: {error}"
    );
    assert!(
        error.contains("automatic redirects are disabled"),
        "unexpected error: {error}"
    );
    assert!(
        !error.contains("not-in-error"),
        "error body was not bounded"
    );
    assert_eq!(requests.len(), 1, "same-origin redirect was replayed");
    assert_device_request(&requests[0], "/app/v1/device/code");
    assert_eq!(
        serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
        json!({"client_id": LEGACY_CLIENT_ID})
    );
}

#[tokio::test]
async fn device_token_redirect_to_http_destination_does_not_replay_code() {
    let destination = TcpListener::bind(("127.0.0.1", 0)).expect("bind redirect destination");
    destination
        .set_nonblocking(true)
        .expect("make redirect destination nonblocking");
    let destination_url = format!(
        "http://{}/stolen-device-code",
        destination.local_addr().unwrap()
    );
    let source = ScriptedServer::start(vec![ScriptedResponse::redirect(
        "307 Temporary Redirect",
        destination_url,
        "redirect blocked",
    )]);
    let device = DeviceCode {
        device_code: "sensitive-device-code".to_string(),
        user_code: "SENSITIVE".to_string(),
        verification_uri_complete: "https://accounts.arcee.ai/device".to_string(),
        interval_secs: 1,
        expires_in_secs: 60,
    };

    let error = poll_device_code_with(
        &no_redirect_client().unwrap(),
        &ArceeAuthService::for_test(&source.base_url),
        &device,
        || 0,
        |_| ready(()),
    )
    .await
    .expect_err("Arcee token redirects must not be followed")
    .to_string();
    let requests = source.finish();

    assert!(
        error.contains("HTTP 307 redirect"),
        "unexpected error: {error}"
    );
    assert!(
        error.contains("was not replayed"),
        "unexpected error: {error}"
    );
    assert_eq!(requests.len(), 1);
    assert_eq!(
        serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
        json!({"device_code": "sensitive-device-code", "client_id": LEGACY_CLIENT_ID})
    );
    let accept_error = destination
        .accept()
        .expect_err("HTTP redirect destination must receive no request");
    assert_eq!(accept_error.kind(), io::ErrorKind::WouldBlock);
}

#[tokio::test]
async fn token_poll_handles_pending_and_slow_down_then_parses_success_without_waiting() {
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("400 Bad Request", r#"{"error":"authorization_pending"}"#),
        ScriptedResponse::json("400 Bad Request", r#"{"error":"slow_down"}"#),
        ScriptedResponse::json(
            "200 OK",
            json!({
                "access_token": "jwt-access-token",
                "refresh_token": "opaque-refresh-token",
                "token_type": "bearer",
                "expires_in": 3600,
                "base_url": "https://api.arcee.ai",
                "organization_id": "org-device",
                "workspace_name": "device-workspace"
            })
            .to_string(),
        ),
    ]);
    let device = DeviceCode {
        device_code: "device-poll".to_string(),
        user_code: "POLL-CODE".to_string(),
        verification_uri_complete: "https://accounts.arcee.ai/device".to_string(),
        interval_secs: 2,
        expires_in_secs: 60,
    };
    let clock = Rc::new(Cell::new(0u64));
    let sleeps = Rc::new(RefCell::new(Vec::new()));
    let now_clock = Rc::clone(&clock);
    let sleep_clock = Rc::clone(&clock);
    let recorded_sleeps = Rc::clone(&sleeps);

    let success = poll_device_code_with(
        &no_redirect_client().unwrap(),
        &ArceeAuthService::for_test(&server.base_url),
        &device,
        move || now_clock.get(),
        move |duration| {
            recorded_sleeps.borrow_mut().push(duration);
            sleep_clock.set(
                sleep_clock
                    .get()
                    .saturating_add(duration.as_millis() as u64),
            );
            ready(())
        },
    )
    .await
    .expect("pending poll should eventually succeed");
    let requests = server.finish();

    assert_eq!(success.access_token, "jwt-access-token");
    assert_eq!(success.refresh_token, "opaque-refresh-token");
    assert_eq!(success.token_type.as_deref(), Some("bearer"));
    assert_eq!(success.expires_in, Some(3600));
    assert_eq!(success.base_url, "https://api.arcee.ai");
    assert_eq!(success.organization_id, "org-device");
    assert_eq!(success.workspace_name, "device-workspace");
    assert_eq!(
        sleeps.borrow().as_slice(),
        [Duration::from_secs(2), Duration::from_secs(7)]
    );
    assert_eq!(requests.len(), 3);
    for request in &requests {
        assert_device_request(request, "/app/v1/device/token");
        assert_eq!(
            serde_json::from_slice::<Value>(&request.body).unwrap(),
            json!({"device_code": "device-poll", "client_id": LEGACY_CLIENT_ID})
        );
    }
}

#[tokio::test]
async fn token_poll_reports_denied_expired_malformed_and_unstructured_errors() {
    let cases = [
        (
            "400 Bad Request",
            r#"{"error":"access_denied"}"#,
            "authorization was denied",
        ),
        (
            "400 Bad Request",
            r#"{"error":"expired_token"}"#,
            "device code expired",
        ),
        (
            "200 OK",
            r#"{"access_token":"missing-other-success-fields"}"#,
            "failed to parse Arcee device authorization response",
        ),
        (
            "503 Service Unavailable",
            "upstream unavailable",
            "failed with HTTP 503",
        ),
    ];

    for (status, body, expected) in cases {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(status, body)]);
        let device = DeviceCode {
            device_code: "device-error".to_string(),
            user_code: "ERROR".to_string(),
            verification_uri_complete: "https://accounts.arcee.ai/device".to_string(),
            interval_secs: 1,
            expires_in_secs: 60,
        };
        let error = poll_device_code_with(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&server.base_url),
            &device,
            || 0,
            |_| ready(()),
        )
        .await
        .expect_err("terminal poll response should fail");
        let requests = server.finish();

        assert!(
            error.to_string().contains(expected),
            "expected {expected:?} in {error:#}"
        );
        assert_eq!(requests.len(), 1);
        assert_device_request(&requests[0], "/app/v1/device/token");
    }
}

#[tokio::test]
async fn token_poll_redacts_device_code_from_structured_error() {
    let secret = "sensitive-device-code";
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "400 Bad Request",
        format!(r#"{{"error":"{secret}"}}"#),
    )]);
    let device = DeviceCode {
        device_code: secret.to_string(),
        user_code: "ERROR".to_string(),
        verification_uri_complete: "https://accounts.arcee.ai/device".to_string(),
        interval_secs: 1,
        expires_in_secs: 60,
    };

    let error = poll_device_code_with(
        &no_redirect_client().unwrap(),
        &ArceeAuthService::for_test(&server.base_url),
        &device,
        || 0,
        |_| ready(()),
    )
    .await
    .expect_err("terminal poll response should fail")
    .to_string();
    server.finish();

    assert!(
        !error.contains(secret),
        "error leaked the echoed device credential: {error}"
    );
    assert!(error.contains(crate::model::redact::REDACTED), "{error}");
}

#[test]
fn canonical_auth_service_uses_the_fixed_approved_origin() {
    let service = ArceeAuthService::canonical().unwrap();
    assert_eq!(service.base_url, CANONICAL_AUTH_SERVICE_BASE_URL);
    assert_eq!(
        service.device_code_url(),
        "https://api.arcee.ai/app/v1/device/code"
    );
    assert_eq!(
        service.device_token_url(),
        "https://api.arcee.ai/app/v1/device/token"
    );
    assert_eq!(
        service.device_refresh_url(),
        "https://api.arcee.ai/app/v1/device/refresh"
    );
}

#[test]
fn noncanonical_auth_service_origins_are_rejected_before_connection() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let local_origin = format!("http://{}", listener.local_addr().unwrap());
    let cases = [
        local_origin.as_str(),
        "https://arcee.ai",
        "https://accounts.arcee.ai",
        "http://api.arcee.ai",
        "https://api.arcee.ai:8443",
        "https://user@api.arcee.ai",
        "https://api.arcee.ai/custom-path",
        "not a URL",
    ];

    for base_url in cases {
        let error = ArceeAuthService::approved(base_url).unwrap_err();
        assert!(
            error.to_string().contains("Arcee auth service")
                || error.to_string().contains("canonical origin"),
            "unexpected error for {base_url}: {error:#}"
        );
    }

    let accept_error = listener
        .accept()
        .expect_err("rejected auth-service origin must not receive a connection");
    assert_eq!(accept_error.kind(), io::ErrorKind::WouldBlock);
}

#[test]
fn arcee_url_policy_approves_only_secure_arcee_origins() {
    for base_url in [
        "https://arcee.ai",
        "https://api.arcee.ai",
        "https://api.internal.arcee.ai/v1/custom/",
        "https://api.arcee.ai:443/path",
    ] {
        let (kind, parsed) = validate_arcee_base_url(base_url).unwrap();
        assert_eq!(kind, ArceeEndpointKind::Approved, "{base_url}");
        assert_eq!(parsed.port_or_known_default(), Some(443), "{base_url}");
    }
}

#[test]
fn arcee_url_policy_classifies_non_arcee_origins_as_unapproved() {
    for base_url in [
        "http://127.0.0.1:8080/dev/path",
        "http://localhost:3000",
        "https://models.example.com/arcee",
        "https://arcee.ai.attacker.example/v1",
    ] {
        let (kind, _) = validate_arcee_base_url(base_url).unwrap();
        assert_eq!(kind, ArceeEndpointKind::Unapproved, "{base_url}");
    }
}

#[test]
fn approved_arcee_chat_completions_url_matrix_is_canonical() {
    let cases = [
        (
            "https://api.arcee.ai",
            "https://api.arcee.ai/api/v1/chat/completions",
        ),
        (
            "https://api.arcee.ai/",
            "https://api.arcee.ai/api/v1/chat/completions",
        ),
        (
            "https://api.arcee.ai///",
            "https://api.arcee.ai/api/v1/chat/completions",
        ),
        (
            "https://api.arcee.ai/api",
            "https://api.arcee.ai/api/v1/chat/completions",
        ),
        (
            "https://api.arcee.ai/api/",
            "https://api.arcee.ai/api/v1/chat/completions",
        ),
        (
            "https://api.arcee.ai/api/v1",
            "https://api.arcee.ai/api/v1/chat/completions",
        ),
        (
            "https://api.arcee.ai/api/v1/",
            "https://api.arcee.ai/api/v1/chat/completions",
        ),
        (
            "https://api.arcee.ai/api/v1/chat/completions",
            "https://api.arcee.ai/api/v1/chat/completions",
        ),
        (
            "https://api.arcee.ai/api/v1/chat/completions/",
            "https://api.arcee.ai/api/v1/chat/completions",
        ),
        (
            "https://tenant.arcee.ai/api/v1/",
            "https://tenant.arcee.ai/api/v1/chat/completions",
        ),
    ];

    for (base_url, expected) in cases {
        assert_eq!(
            chat_completions_url(base_url).unwrap().as_str(),
            expected,
            "{base_url}"
        );
    }
}

#[test]
fn approved_arcee_chat_completions_url_rejects_noncanonical_paths() {
    for base_url in [
        "https://api.arcee.ai/v1",
        "https://api.arcee.ai/v1/",
        "https://api.arcee.ai/other",
        "https://api.arcee.ai/other/api",
        "https://api.arcee.ai/other/api/v1",
        "https://api.arcee.ai/other/chat/completions",
        "https://api.arcee.ai/v1/chat/completions",
        "https://tenant.arcee.ai/prefix/api/v1",
    ] {
        let error = chat_completions_url(base_url)
            .expect_err("approved noncanonical path must be rejected")
            .to_string();
        assert!(
            error.contains("invalid approved Arcee inference path"),
            "{base_url}: {error}"
        );
    }
}

#[test]
fn unapproved_url_normalization_matrix_preserves_prefixes() {
    let cases = [
        (
            "http://localhost:8080",
            "http://localhost:8080/v1/chat/completions",
        ),
        (
            "http://localhost:8080/",
            "http://localhost:8080/v1/chat/completions",
        ),
        (
            "https://gateway.example.com/prefix",
            "https://gateway.example.com/prefix/v1/chat/completions",
        ),
        (
            "https://gateway.example.com/prefix/v1",
            "https://gateway.example.com/prefix/v1/chat/completions",
        ),
        (
            "https://gateway.example.com/prefix/v1/",
            "https://gateway.example.com/prefix/v1/chat/completions",
        ),
        (
            "https://gateway.example.com/prefix/v1/chat/completions",
            "https://gateway.example.com/prefix/v1/chat/completions",
        ),
        (
            "https://gateway.example.com/prefix/v1/chat/completions/",
            "https://gateway.example.com/prefix/v1/chat/completions",
        ),
        (
            "https://gateway.example.com/tenant%20one",
            "https://gateway.example.com/tenant%20one/v1/chat/completions",
        ),
    ];

    for (base_url, expected) in cases {
        assert_eq!(
            chat_completions_url(base_url).unwrap().as_str(),
            expected,
            "{base_url}"
        );
    }
}

#[test]
fn chat_completions_url_rejects_literal_and_encoded_dot_segments() {
    for base_url in [
        "https://gateway.example.com/prefix/../tenant",
        "https://gateway.example.com/prefix/./tenant",
        "https://gateway.example.com/prefix/%2e%2e/tenant",
        "https://gateway.example.com/prefix/%2E/tenant",
        "https://gateway.example.com/prefix/.%2e/tenant",
        "https://api.arcee.ai/api/%2e%2e/api/v1",
    ] {
        let error = chat_completions_url(base_url)
            .expect_err("ambiguous dot path must be rejected")
            .to_string();
        assert!(error.contains("dot path segments"), "{base_url}: {error}");
    }
}

#[test]
fn chat_completions_url_rejects_encoded_route_controls_and_delimiters() {
    let cases = [
        ("https://gateway.example.com/%76%31", "route-control"),
        (
            "https://gateway.example.com/%63hat/completions",
            "route-control",
        ),
        (
            "https://gateway.example.com/v1/%63ompletions",
            "route-control",
        ),
        ("https://api.arcee.ai/%61pi/v1", "route-control"),
        (
            "https://gateway.example.com/prefix%2Ftenant",
            "path delimiters",
        ),
        (
            "https://gateway.example.com/prefix%5ctenant",
            "path delimiters",
        ),
        (
            "https://gateway.example.com/prefix%",
            "malformed percent encoding",
        ),
    ];

    for (base_url, expected) in cases {
        let error = chat_completions_url(base_url)
            .expect_err("encoded path control must be rejected")
            .to_string();
        assert!(error.contains(expected), "{base_url}: {error}");
    }
}

#[test]
fn chat_completions_url_preserves_origin_policy_rejections() {
    for base_url in [
        "https://api.arcee.ai?tenant=one",
        "https://gateway.example.com/v1#fragment",
    ] {
        assert!(chat_completions_url(base_url).is_err(), "{base_url}");
    }
}

#[test]
fn arcee_url_policy_rejects_malformed_and_unsafe_urls() {
    let cases = [
        ("relative/path", "invalid Arcee base URL"),
        ("ftp://api.arcee.ai/models", "scheme must be http or https"),
        ("https://", "invalid Arcee base URL"),
        ("https://user@api.arcee.ai", "userinfo is not allowed"),
        (
            "https://api.arcee.ai?tenant=evil",
            "query parameters are not allowed",
        ),
        ("https://api.arcee.ai#fragment", "fragments are not allowed"),
        ("http://api.arcee.ai", "require HTTPS"),
        ("https://api.arcee.ai:8443", "effective port 443"),
    ];

    for (base_url, expected) in cases {
        let error = validate_arcee_base_url(base_url).unwrap_err().to_string();
        assert!(
            error.contains(expected),
            "{base_url}: expected {expected:?} in {error:?}"
        );
    }
}

#[test]
fn login_token_base_url_must_be_an_approved_arcee_origin() {
    let success = TokenSuccess {
        access_token: "jwt-hostile".to_string(),
        refresh_token: "opaque-hostile".to_string(),
        token_type: Some("bearer".to_string()),
        expires_in: Some(3600),
        base_url: "https://capture.attacker.example/v1".to_string(),
        organization_id: "org-1".to_string(),
        workspace_name: "acme".to_string(),
    };

    let error = stored_auth_from_token_success(success).unwrap_err();
    assert!(
        error.to_string().contains("invalid credential base URL"),
        "unexpected error: {error:#}"
    );
}

#[test]
fn tampered_stored_base_url_is_rejected() {
    let dir = TestDir::new("tampered-url");
    let (_, canonical) = dir.paths();
    let mut auth = stored_auth("rcai-stored");
    auth.base_url = "http://api.arcee.ai:8080/steal".to_string();
    let raw = serde_json::to_string(&auth).unwrap();

    let error = parse_stored_auth(&raw, &canonical).unwrap_err();
    assert!(
        error.to_string().contains("invalid base_url"),
        "unexpected error: {error:#}"
    );
}

#[test]
fn stored_auth_round_trips() {
    let auth = stored_auth("jwt-abc");
    let raw = serde_json::to_string(&auth).unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(value["type"], "arcee_device_token");
    assert_eq!(value["access_token"], "jwt-abc");
    assert_eq!(value["refresh_token"], "refresh-1");
    assert_eq!(value["base_url"], "https://api.arcee.ai");
    assert_eq!(value["client_id"], LEGACY_CLIENT_ID);
}

#[test]
fn legacy_stored_auth_without_client_identity_defaults_to_nac_cli() {
    let dir = TestDir::new("legacy-client-default");
    let (_, canonical) = dir.paths();
    let raw = r#"{
        "type":"arcee_device_token",
        "access_token":"legacy-access",
        "refresh_token":"legacy-refresh",
        "token_type":"bearer",
        "expires_at_ms":1893553445000,
        "base_url":"https://api.arcee.ai",
        "organization_id":"legacy-org",
        "workspace_name":"legacy-workspace"
    }"#;
    let auth = parse_stored_auth(raw, &canonical).unwrap().unwrap();
    assert_eq!(auth.client_id, LEGACY_CLIENT_ID);
    assert!(auth.managed_bootstrap.is_none());
}

#[test]
fn stored_auth_from_token_success_computes_absolute_expiry() {
    let success = TokenSuccess {
        access_token: "jwt-access".to_string(),
        refresh_token: "opaque-refresh".to_string(),
        token_type: None,
        expires_in: Some(3600),
        base_url: "https://api.arcee.ai".to_string(),
        organization_id: "org-1".to_string(),
        workspace_name: "acme".to_string(),
    };

    let auth = stored_auth_from_token_success(success).unwrap();

    assert_eq!(auth.access_token, "jwt-access");
    assert_eq!(auth.refresh_token, "opaque-refresh");
    assert_eq!(auth.token_type, "bearer");
    assert!(
        auth.expires_at_ms > now_ms(),
        "expiry should be in the future"
    );
}

#[tokio::test]
async fn token_refresh_rotates_and_persists_new_refresh_token() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "access_token": "jwt-access-2",
            "refresh_token": "rotated-refresh-token",
            "token_type": "bearer",
            "expires_in": 3600
        })
        .to_string(),
    )]);

    let outcome = request_token_refresh(
        &no_redirect_client().unwrap(),
        &ArceeAuthService::for_test(&server.base_url),
        "opaque-refresh",
        LEGACY_CLIENT_ID,
    )
    .await
    .expect("refresh should succeed");
    let requests = server.finish();

    let refreshed = match outcome {
        RefreshOutcome::Success(refreshed) => refreshed,
        RefreshOutcome::Revoked => panic!("unexpected revoked outcome"),
    };
    assert_eq!(refreshed.access_token, "jwt-access-2");
    assert_eq!(
        refreshed.refresh_token.as_deref(),
        Some("rotated-refresh-token")
    );
    assert_eq!(refreshed.expires_in, Some(3600));

    // The rotated refresh token replaces the one we sent — persisting the old
    // one would lock the user out on the next refresh.
    let current = stored_auth("jwt-access-1");
    let updated = stored_auth_from_refresh(current, refreshed);
    assert_eq!(updated.access_token, "jwt-access-2");
    assert_eq!(updated.refresh_token, "rotated-refresh-token");

    assert_eq!(requests.len(), 1);
    assert_device_request(&requests[0], "/app/v1/device/refresh");
    assert_eq!(
        serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
        json!({"refresh_token": "opaque-refresh", "client_id": LEGACY_CLIENT_ID})
    );
}

#[tokio::test]
async fn concurrent_refreshes_single_flight_and_reopen_the_rotated_record() {
    let dir = TestDir::new("refresh-single-flight");
    let (_, auth_path) = dir.paths();
    let lock_path = dir.0.join("arcee_auth.json.lock");
    write_json(&auth_path, &stored_auth("stale-access"));
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "access_token": "fresh-access",
            "refresh_token": "fresh-refresh",
            "token_type": "bearer",
            "expires_in": 3600
        })
        .to_string(),
    )]);
    let service = ArceeAuthService::for_test(&server.base_url);
    let client = no_redirect_client().unwrap();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(3));
    let first_barrier = std::sync::Arc::clone(&barrier);
    let second_barrier = std::sync::Arc::clone(&barrier);

    let first = async {
        first_barrier.wait().await;
        refresh_locked_with(
            &client,
            "https://api.arcee.ai",
            |auth| auth.access_token == "stale-access",
            &service,
            &auth_path,
            &lock_path,
        )
        .await
    };
    let second = async {
        second_barrier.wait().await;
        refresh_locked_with(
            &client,
            "https://api.arcee.ai",
            |auth| auth.access_token == "stale-access",
            &service,
            &auth_path,
            &lock_path,
        )
        .await
    };
    let release = async {
        barrier.wait().await;
    };
    let (first, second, ()) = tokio::join!(first, second, release);
    assert_eq!(first.unwrap(), "fresh-access");
    assert_eq!(second.unwrap(), "fresh-access");

    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
        json!({"refresh_token": "refresh-1", "client_id": LEGACY_CLIENT_ID})
    );
    let reopened = read_stored_auth_optional_at(&auth_path).unwrap().unwrap();
    assert_eq!(reopened.access_token, "fresh-access");
    assert_eq!(reopened.refresh_token, "fresh-refresh");
}

#[test]
fn refresh_without_rotated_token_keeps_current_refresh_token() {
    let refreshed = RefreshSuccess {
        access_token: "jwt-access-2".to_string(),
        refresh_token: None,
        token_type: None,
        expires_in: Some(3600),
    };

    let updated = stored_auth_from_refresh(stored_auth("jwt-access-1"), refreshed);

    assert_eq!(updated.access_token, "jwt-access-2");
    assert_eq!(updated.refresh_token, "refresh-1");
}

#[tokio::test]
async fn token_refresh_reports_revoked_for_invalid_grant_and_invalid_client() {
    for error in ["invalid_grant", "invalid_client"] {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "400 Bad Request",
            json!({ "error": error }).to_string(),
        )]);

        let outcome = request_token_refresh(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&server.base_url),
            "opaque-refresh",
            LEGACY_CLIENT_ID,
        )
        .await
        .expect("revoked refresh should not be an error");
        server.finish();

        assert!(
            matches!(outcome, RefreshOutcome::Revoked),
            "{error} should map to revoked"
        );
    }
}

#[tokio::test]
async fn token_refresh_propagates_other_http_errors() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "503 Service Unavailable",
        "upstream unavailable",
    )]);

    let error = request_token_refresh(
        &no_redirect_client().unwrap(),
        &ArceeAuthService::for_test(&server.base_url),
        "opaque-refresh",
        LEGACY_CLIENT_ID,
    )
    .await
    .expect_err("server error should propagate");
    server.finish();

    assert!(
        error.to_string().contains("HTTP 503"),
        "unexpected error: {error:#}"
    );
}

#[test]
fn arcee_logout_removes_malformed_canonical_and_preserves_auth_json() {
    let dir = TestDir::new("logout-malformed");
    let (auth_path, arcee_path) = dir.paths();
    let auth_json = r#"{"type":"chatgpt-codex","access":"a","refresh":"r"}"#;
    fs::write(&auth_path, auth_json).unwrap();
    write_credential(&arcee_path, "{ malformed");

    assert!(remove_arcee_auth_file_for_logout(&arcee_path).unwrap());

    assert!(!arcee_path.exists());
    assert_eq!(fs::read_to_string(auth_path).unwrap(), auth_json);
}

#[test]
fn arcee_logout_removes_canonical_and_preserves_auth_json() {
    let dir = TestDir::new("logout-coexistence");
    let (auth_path, arcee_path) = dir.paths();
    let auth_json = r#"{"type":"chatgpt-codex","access":"a","refresh":"r"}"#;
    fs::write(&auth_path, auth_json).unwrap();
    write_json(&arcee_path, &stored_auth("rcai-canonical"));

    assert!(remove_arcee_auth_file_for_logout(&arcee_path).unwrap());

    assert!(!arcee_path.exists());
    assert_eq!(fs::read_to_string(auth_path).unwrap(), auth_json);
}

#[test]
fn arcee_logout_is_idempotent_when_canonical_file_is_missing() {
    let dir = TestDir::new("logout-missing");
    let (_, canonical) = dir.paths();

    assert!(!remove_arcee_auth_file_for_logout(&canonical).unwrap());
    assert!(!remove_arcee_auth_file_for_logout(&canonical).unwrap());
}

#[test]
fn arcee_logout_preserves_valid_unknown_canonical_record() {
    let dir = TestDir::new("logout-unknown");
    let (auth_path, canonical) = dir.paths();
    let legacy_shaped = serde_json::to_string(&stored_auth("rcai-legacy")).unwrap();
    let unknown = r#"{"type":"future-provider","token":"canonical"}"#;
    fs::write(&auth_path, &legacy_shaped).unwrap();
    write_credential(&canonical, unknown);

    assert!(!remove_arcee_auth_file_for_logout(&canonical).unwrap());
    assert_eq!(fs::read_to_string(auth_path).unwrap(), legacy_shaped);
    assert_eq!(fs::read_to_string(canonical).unwrap(), unknown);
}

#[cfg(unix)]
#[test]
fn arcee_logout_unlinks_canonical_symlink_without_touching_target() {
    let dir = TestDir::new("logout-symlink");
    let (_, canonical) = dir.paths();
    let target = dir.0.join("target.json");
    fs::write(&target, "target-credentials").unwrap();
    symlink(&target, &canonical).unwrap();

    assert!(remove_arcee_auth_file_for_logout(&canonical).unwrap());

    assert!(fs::symlink_metadata(&canonical).is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), "target-credentials");
}
