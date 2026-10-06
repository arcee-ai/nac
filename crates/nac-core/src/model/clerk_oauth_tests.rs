use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

// Local-only synthetic provider. ORIGIN is replaced after binding, so metadata
// and endpoint trust exercise the real configured discovery path.
struct Fixture {
    origin: String,
    handle: thread::JoinHandle<Vec<String>>,
}

impl Fixture {
    fn start(responses: Vec<(u16, String)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let base = origin.clone();
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            let deadline = Instant::now() + Duration::from_secs(5);
            for (status, body) in responses {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "fixture request missing");
                            thread::sleep(Duration::from_millis(2));
                        }
                        Err(error) => panic!("fixture accept: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = std::str::from_utf8(&bytes[..end]).unwrap();
                        let length = head
                            .lines()
                            .find_map(|line| {
                                let (key, value) = line.split_once(':')?;
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                requests.push(String::from_utf8(bytes).unwrap());
                if status == 0 {
                    // Rotation may have happened remotely before EOF. The
                    // caller must not automatically repeat this request.
                    continue;
                }
                let body = body.replace("ORIGIN", &base);
                let header = if (300..400).contains(&status) {
                    format!("Location: {base}/redirected\r\n")
                } else {
                    String::new()
                };
                let wire = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\n{header}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = stream.write_all(wire.as_bytes());
            }
            // A bounded observation catches automatic retries/redirects.
            let until = Instant::now() + Duration::from_millis(30);
            while Instant::now() < until {
                if listener.accept().is_ok() {
                    panic!("unexpected replay or redirect");
                }
                thread::sleep(Duration::from_millis(2));
            }
            requests
        });
        Self { origin, handle }
    }

    fn config(&self) -> ClerkOAuthConfig {
        ClerkOAuthConfig {
            issuer: self.origin.clone(),
            discovery_url: format!("{}/metadata", self.origin),
            client_id: "synthetic-public-client".into(),
            scopes: vec!["offline_access".into(), "user:org:read".into()],
            endpoint_origins: vec![self.origin.clone()],
            verification_origins: vec![self.origin.clone()],
        }
    }

    fn finish(self) -> Vec<String> {
        self.handle.join().unwrap()
    }
}

fn metadata() -> String {
    serde_json::json!({"issuer":"ORIGIN", "device_authorization_endpoint":"ORIGIN/device",
        "token_endpoint":"ORIGIN/token", "grant_types_supported":[DEVICE_GRANT, "refresh_token"],
        "token_endpoint_auth_methods_supported":["none"]})
    .to_string()
}

fn device() -> String {
    serde_json::json!({"device_code":"private-device-secret", "user_code":"ABCD-EFGH",
        "verification_uri":"ORIGIN/verify", "verification_uri_complete":"ORIGIN/verify?user_code=ABCD-EFGH",
        "expires_in":600, "interval":5}).to_string()
}

fn token() -> String {
    serde_json::json!({"access_token":"resource-access-secret", "refresh_token":"rotated-refresh-secret",
        "token_type":"Bearer", "expires_in":3600, "scope":"user:org:read offline_access",
        "id_token":"never-a-resource-credential"}).to_string()
}

fn changed(body: String, key: &str, value: serde_json::Value) -> String {
    let mut body: serde_json::Value = serde_json::from_str(&body).unwrap();
    body[key] = value;
    body.to_string()
}

async fn fake_poll(login: DeviceLogin<'_>) -> (Result<OAuthTokens>, Vec<Duration>) {
    let elapsed = Arc::new(Mutex::new(Duration::ZERO));
    let waits = Arc::new(Mutex::new(Vec::new()));
    let now = elapsed.clone();
    let observed = waits.clone();
    let result = login
        .poll_with(
            move || *now.lock().unwrap(),
            move |delay| {
                *elapsed.lock().unwrap() += delay;
                observed.lock().unwrap().push(delay);
                std::future::ready(())
            },
        )
        .await;
    let delays = waits.lock().unwrap().clone();
    (result, delays)
}

#[tokio::test]
async fn public_device_flow_waits_and_slowdown_is_cumulative() {
    let fixture = Fixture::start(vec![
        (200, metadata()),
        (200, device()),
        (400, r#"{"error":"authorization_pending"}"#.into()),
        (400, r#"{"error":"slow_down"}"#.into()),
        (400, r#"{"error":"slow_down"}"#.into()),
        (200, token()),
    ]);
    let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
    let login = client.begin().await.unwrap();
    assert_eq!(login.prompt().user_code, "ABCD-EFGH");
    assert_eq!(login.prompt().expires_in_secs, 600);
    assert!(login.prompt().verification_uri.ends_with("/verify"));
    assert!(login.prompt().verification_uri_complete.is_some());
    let (result, waits) = fake_poll(login).await;
    let tokens = result.unwrap();
    assert_eq!(tokens.access_token, "resource-access-secret");
    assert_eq!(
        tokens.refresh_token.as_deref(),
        Some("rotated-refresh-secret")
    );
    assert_eq!(tokens.expires_in_secs, 3600);
    assert_eq!(tokens.scopes.len(), 2);
    assert_eq!(waits, [5, 5, 10, 15].map(Duration::from_secs));
    let requests = fixture.finish();
    assert!(requests[1].contains("scope=offline_access+user%3Aorg%3Aread"));
    for request in &requests[1..] {
        assert!(request.starts_with("POST "));
        assert!(request
            .to_lowercase()
            .contains("application/x-www-form-urlencoded"));
        assert!(request.contains("client_id=synthetic-public-client"));
        assert!(!request.contains("client_secret"));
        assert!(!request.contains("code_verifier"));
        assert!(!request.to_lowercase().contains("authorization:"));
    }
    assert!(
        requests[2].contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code")
    );
}

#[tokio::test]
async fn denial_expiry_invalid_grant_and_unavailable_stop_without_replay() {
    for (status, error, expected) in [
        (400, "access_denied", OAuthError::Denied),
        (400, "expired_token", OAuthError::Expired),
        (400, "invalid_grant", OAuthError::ReauthorizationRequired),
        (400, "invalid_client", OAuthError::Rejected),
        (429, "slow_down", OAuthError::Unavailable),
        (503, "authorization_pending", OAuthError::Unavailable),
    ] {
        let fixture = Fixture::start(vec![(200,metadata()),(200,device()),
            (status,serde_json::json!({"error":error,"error_description":"private-device-secret rotated-refresh-secret"}).to_string())]);
        let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
        let (result, _) = fake_poll(client.begin().await.unwrap()).await;
        assert!(matches!(result, Err(e) if e == expected));
        assert_eq!(fixture.finish().len(), 3);
        assert!(!expected.to_string().contains("secret"));
    }
}

#[tokio::test]
async fn local_expiry_and_cancellation_do_not_exchange_device_code() {
    for cancel in [false, true] {
        let fixture = Fixture::start(vec![
            (200, metadata()),
            (200, changed(device(), "expires_in", 2.into())),
        ]);
        let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
        let login = client.begin().await.unwrap();
        if cancel {
            drop(login);
        } else {
            let (result, waits) = fake_poll(login).await;
            assert!(matches!(result, Err(OAuthError::Expired)));
            assert!(waits.is_empty());
        }
        assert_eq!(fixture.finish().len(), 2);
    }
}

#[tokio::test]
async fn discovery_rejects_unqualified_or_untrusted_capabilities() {
    for (key, value) in [
        ("issuer", "https://wrong.example".into()),
        (
            "device_authorization_endpoint",
            "https://untrusted.example/device".into(),
        ),
        (
            "token_endpoint",
            "https://user:password@untrusted.example/token".into(),
        ),
        (
            "grant_types_supported",
            serde_json::json!(["authorization_code"]),
        ),
        (
            "token_endpoint_auth_methods_supported",
            serde_json::json!(["client_secret_basic"]),
        ),
    ] {
        let fixture = Fixture::start(vec![(200, changed(metadata(), key, value))]);
        assert!(ClerkOAuthClient::discover(fixture.config()).await.is_err());
        assert_eq!(fixture.finish().len(), 1);
    }
}

#[tokio::test]
async fn redirects_are_rejected_at_each_boundary() {
    for boundary in 0..3 {
        let responses = match boundary {
            0 => vec![(302, "private-discovery-body".into())],
            1 => vec![(200, metadata()), (307, "private-device-body".into())],
            _ => vec![
                (200, metadata()),
                (200, device()),
                (308, "private-token-body".into()),
            ],
        };
        let fixture = Fixture::start(responses);
        let discovery = ClerkOAuthClient::discover(fixture.config()).await;
        if boundary == 0 {
            assert!(discovery.is_err());
        } else {
            let client = discovery.unwrap();
            let begin = client.begin().await;
            if boundary == 1 {
                assert!(begin.is_err());
            } else {
                assert!(fake_poll(begin.unwrap()).await.0.is_err());
            }
        }
        assert_eq!(fixture.finish().len(), boundary + 1);
    }
}

#[tokio::test]
async fn refresh_rotates_or_retains_secret_without_replay() {
    for rotated in [true, false] {
        let mut body: serde_json::Value = serde_json::from_str(&token()).unwrap();
        if !rotated {
            body.as_object_mut().unwrap().remove("refresh_token");
        }
        let fixture = Fixture::start(vec![(200, metadata()), (200, body.to_string())]);
        let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
        let tokens = client.refresh("original-refresh-secret").await.unwrap();
        assert_eq!(tokens.refresh_token.is_some(), rotated);
        let requests = fixture.finish();
        assert!(requests[1].contains("grant_type=refresh_token"));
        assert!(requests[1].contains("refresh_token=original-refresh-secret"));
        assert!(!requests[1].lines().next().unwrap().contains("secret"));
    }
    let fixture = Fixture::start(vec![
        (200, metadata()),
        (503, "original-refresh-secret".into()),
    ]);
    let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
    assert!(matches!(
        client.refresh("original-refresh-secret").await,
        Err(OAuthError::Unavailable)
    ));
    assert_eq!(fixture.finish().len(), 2);
    let fixture = Fixture::start(vec![(200, metadata()), (0, String::new())]);
    let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
    assert!(matches!(
        client.refresh("original-refresh-secret").await,
        Err(OAuthError::Unavailable)
    ));
    assert_eq!(fixture.finish().len(), 2);
}

#[tokio::test]
async fn id_token_alone_wrong_type_or_scope_cannot_become_resource_credential() {
    for (key, value) in [
        ("access_token", serde_json::Value::Null),
        ("access_token", "".into()),
        ("token_type", "ID".into()),
        ("expires_in", 0.into()),
        ("refresh_token", serde_json::Value::Null),
        ("scope", "offline_access".into()),
        ("scope", "offline_access user:org:read extra".into()),
    ] {
        let fixture = Fixture::start(vec![
            (200, metadata()),
            (200, device()),
            (200, changed(token(), key, value)),
        ]);
        let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
        assert!(fake_poll(client.begin().await.unwrap()).await.0.is_err());
        assert_eq!(fixture.finish().len(), 3);
    }
}

#[tokio::test]
async fn omitted_scope_and_interval_follow_oauth_defaults() {
    let mut device: serde_json::Value = serde_json::from_str(&device()).unwrap();
    device.as_object_mut().unwrap().remove("interval");
    device
        .as_object_mut()
        .unwrap()
        .remove("verification_uri_complete");
    let mut token: serde_json::Value = serde_json::from_str(&token()).unwrap();
    token.as_object_mut().unwrap().remove("scope");
    let fixture = Fixture::start(vec![
        (200, metadata()),
        (200, device.to_string()),
        (200, token.to_string()),
    ]);
    let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
    let login = client.begin().await.unwrap();
    assert!(login.prompt().verification_uri_complete.is_none());
    let (result, waits) = fake_poll(login).await;
    assert_eq!(result.unwrap().scopes, client.config.scopes);
    assert_eq!(waits, vec![Duration::from_secs(5)]);
    fixture.finish();
}

#[tokio::test]
async fn verification_links_and_invalid_device_parameters_fail_closed() {
    for (key, value) in [
        (
            "verification_uri",
            "https://untrusted.example/verify".into(),
        ),
        (
            "verification_uri_complete",
            "ORIGIN/verify?code=private-device-secret".into(),
        ),
        ("user_code", "private-device-secret".into()),
        ("expires_in", 0.into()),
        ("interval", 0.into()),
    ] {
        let fixture = Fixture::start(vec![
            (200, metadata()),
            (200, changed(device(), key, value)),
        ]);
        let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
        assert!(client.begin().await.is_err());
        assert_eq!(fixture.finish().len(), 2);
    }
}

#[tokio::test]
async fn malformed_and_oversized_provider_bodies_are_not_exposed() {
    for body in [
        "private-secret-not-json".into(),
        "private-secret".repeat(6000),
    ] {
        let fixture = Fixture::start(vec![(200, body)]);
        let result = ClerkOAuthClient::discover(fixture.config()).await;
        assert!(matches!(result, Err(OAuthError::InvalidResponse)));
        assert_eq!(fixture.finish().len(), 1);
    }
}

#[tokio::test]
async fn discovery_outage_is_distinct_from_unqualified_configuration() {
    for status in [429, 503] {
        let fixture = Fixture::start(vec![(status, "private-provider-body".into())]);
        assert!(matches!(
            ClerkOAuthClient::discover(fixture.config()).await,
            Err(OAuthError::Unavailable)
        ));
        fixture.finish();
    }
}

#[test]
fn config_and_url_trust_cannot_be_inferred_from_resource_input() {
    for url in [
        "http://example.com",
        "https://user:secret@example.com",
        "https://example.com/#secret",
        "https://example.com/?secret",
    ] {
        assert!(secure_url(url, false).is_err());
    }
    assert!(trusted_url(
        "https://issuer.example/token",
        &["https://other.example".into()],
        false
    )
    .is_err());
    assert!(scope_set(&["scope with space".into()]).is_err());
    assert!(scope_set(&["a".into(), "a".into()]).is_err());
}

#[tokio::test]
async fn production_poll_and_refresh_share_the_discovered_token_endpoint() {
    let fixture = Fixture::start(vec![
        (200, metadata()),
        (200, changed(device(), "interval", 1.into())),
        (200, token()),
        (200, token()),
    ]);
    let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
    let tokens = client.begin().await.unwrap().finish().await.unwrap();
    client
        .refresh(tokens.refresh_token.as_deref().unwrap())
        .await
        .unwrap();
    let requests = fixture.finish();
    assert!(requests[2].starts_with("POST /token "));
    assert!(requests[3].starts_with("POST /token "));
}

#[tokio::test]
async fn a_late_success_cannot_publish_tokens_after_device_expiry() {
    let fixture = Fixture::start(vec![(200, metadata()), (200, device()), (200, token())]);
    let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
    let now_calls = std::sync::atomic::AtomicUsize::new(0);
    let result = client
        .begin()
        .await
        .unwrap()
        .poll_with(
            || {
                if now_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < 2 {
                    Duration::ZERO
                } else {
                    Duration::from_secs(601)
                }
            },
            |_| std::future::ready(()),
        )
        .await;
    assert!(matches!(result, Err(OAuthError::Expired)));
    assert_eq!(fixture.finish().len(), 3);
}

#[tokio::test]
async fn scope_requests_are_bound_to_each_independent_client() {
    // No org/grant claim is decoded or invented. Distinct opaque tokens must
    // survive the client boundary; org consent/isolation is a resource-verifier
    // acceptance gate and cannot be proved by this synthetic transport fixture.
    for opaque in ["org-a-access-secret", "org-b-access-secret"] {
        let fixture = Fixture::start(vec![
            (200, metadata()),
            (200, device()),
            (200, changed(token(), "access_token", opaque.into())),
        ]);
        let client = ClerkOAuthClient::discover(fixture.config()).await.unwrap();
        let (result, _) = fake_poll(client.begin().await.unwrap()).await;
        assert_eq!(result.unwrap().access_token, opaque);
        assert_eq!(fixture.finish().len(), 3);
    }
}
