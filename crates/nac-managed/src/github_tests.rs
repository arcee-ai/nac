use super::*;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

struct ScriptedResponse {
    status: &'static str,
    headers: Vec<(&'static str, String)>,
    body: String,
}

fn json_response(value: serde_json::Value) -> ScriptedResponse {
    ScriptedResponse {
        status: "200 OK",
        headers: Vec::new(),
        body: value.to_string(),
    }
}

fn scripted_server(
    responses: Vec<ScriptedResponse>,
) -> (
    GitHubEndpoints,
    Arc<Mutex<Vec<String>>>,
    std::thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&requests);
    let server = std::thread::spawn(move || {
        let mut responses = VecDeque::from(responses);
        while let Some(response) = responses.pop_front() {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let request = read_http_request(&mut stream);
            captured.lock().unwrap().push(request);
            let headers = response
                .headers
                .iter()
                .map(|(name, value)| format!("{name}: {value}\r\n"))
                .collect::<String>();
            write!(
                stream,
                "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{}",
                response.status,
                response.body.len(),
                headers,
                response.body
            )
            .unwrap();
        }
    });
    let base = Url::parse(&format!("http://{address}/")).unwrap();
    (
        GitHubEndpoints {
            device_code_url: base.join("login/device/code").unwrap(),
            token_url: base.join("login/oauth/access_token").unwrap(),
            api_base_url: base,
        },
        requests,
        server,
    )
}

fn read_http_request(stream: &mut std::net::TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let read = stream.read(&mut buffer).unwrap();
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..header_end]);
            let content_length = headers.lines().find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            });
            let expected = header_end + 4 + content_length.unwrap_or(0);
            if bytes.len() >= expected {
                break;
            }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn temp_root(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "nac-managed-github-{label}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn identity() -> IdentityResponse {
    IdentityResponse {
        id: 42,
        login: "octocat".to_string(),
        name: Some("Octo Cat".to_string()),
        avatar_url: Some("https://avatars.example/octocat".to_string()),
    }
}

fn stored_auth(access_token: &str, refresh_token: &str, access_expiry: u64) -> StoredGitHubAuth {
    StoredGitHubAuth {
        version: AUTH_STORE_VERSION,
        access_token: access_token.to_string(),
        refresh_token: refresh_token.to_string(),
        access_expires_at_ms: access_expiry,
        refresh_expires_at_ms: now_ms().unwrap() + 60 * 60 * 1_000,
        identity: GitHubIdentity::from(identity()),
        organization: ORGANIZATION.to_string(),
    }
}

fn installation_json() -> serde_json::Value {
    serde_json::json!({
        "installations": [{ "id": 7, "account": { "login": "arcee-ai" } }]
    })
}

fn repository_json(id: u64, name: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": name,
        "full_name": format!("arcee-ai/{name}"),
        "private": true,
        "permissions": { "pull": true, "push": true, "admin": false },
        "default_branch": "main",
        "clone_url": format!("https://github.com/arcee-ai/{name}.git"),
        "html_url": format!("https://github.com/arcee-ai/{name}")
    })
}

#[tokio::test]
async fn device_login_persists_metadata_and_discovers_paginated_repositories_and_branches() {
    let mut first_page = Vec::new();
    for id in 0..100 {
        first_page.push(repository_json(id, &format!("repo-{id:03}")));
    }
    let responses = vec![
        json_response(serde_json::json!({
            "device_code": "device-canary",
            "user_code": "ABCD-EFGH",
            "verification_uri": "https://github.com/login/device",
            "expires_in": 600,
            "interval": 0
        })),
        json_response(serde_json::json!({ "error": "authorization_pending" })),
        json_response(serde_json::json!({
            "access_token": "access-canary",
            "expires_in": 28_800,
            "refresh_token": "refresh-canary",
            "refresh_token_expires_in": 15_552_000
        })),
        json_response(serde_json::to_value(identity()).unwrap()),
        json_response(installation_json()),
        json_response(installation_json()),
        json_response(serde_json::json!({ "repositories": first_page })),
        json_response(serde_json::json!({
            "repositories": [repository_json(100, "z-last")]
        })),
        json_response(serde_json::json!([{ "name": "main" }, { "name": "release" }])),
    ];
    let (endpoints, requests, server) = scripted_server(responses);
    let root = temp_root("device");
    let auth = ManagedGitHubAuth::with_endpoints(&root, "Iv1.test", endpoints).unwrap();

    let pending = auth.begin_device_login().await.unwrap();
    assert_eq!(pending.prompt().user_code, "ABCD-EFGH");
    let status = pending.complete().await.unwrap();
    assert_eq!(status.login.as_deref(), Some("octocat"));
    assert_eq!(status.organization.as_deref(), Some("arcee-ai"));
    let repositories = auth.repositories().await.unwrap();
    assert_eq!(repositories.len(), 101);
    assert_eq!(repositories.first().unwrap().full_name, "arcee-ai/repo-000");
    assert_eq!(repositories.last().unwrap().full_name, "arcee-ai/z-last");
    assert_eq!(
        auth.branches("arcee-ai", "repo-000").await.unwrap(),
        ["main", "release"]
    );

    server.join().unwrap();
    let requests = requests.lock().unwrap();
    assert!(requests[0].starts_with("POST /login/device/code "));
    assert!(requests[1].contains("device_code=device-canary"));
    assert!(requests[5]
        .to_ascii_lowercase()
        .contains("authorization: bearer access-canary"));
    assert!(requests[8].starts_with("GET /repos/arcee-ai/repo-000/branches"));
    #[cfg(unix)]
    assert_eq!(
        std::fs::metadata(root.join("managed_github_auth.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    let public = serde_json::to_string(&auth.status().unwrap()).unwrap();
    assert!(!public.contains("access-canary"));
    assert!(!public.contains("refresh-canary"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn concurrent_refresh_rotates_once_and_revocation_removes_local_auth() {
    let (endpoints, requests, server) = scripted_server(vec![json_response(serde_json::json!({
        "access_token": "rotated-access",
        "expires_in": 28_800,
        "refresh_token": "rotated-refresh",
        "refresh_token_expires_in": 15_552_000
    }))]);
    let root = temp_root("refresh");
    let auth = ManagedGitHubAuth::with_endpoints(&root, "Iv1.test", endpoints).unwrap();
    auth.store
        .save(&stored_auth("stale-access", "old-refresh", 0))
        .unwrap();
    let (left, right) = tokio::join!(auth.current_token(), auth.current_token());
    assert_eq!(left.unwrap().unwrap().secret(), "rotated-access");
    assert_eq!(right.unwrap().unwrap().secret(), "rotated-access");
    server.join().unwrap();
    assert_eq!(requests.lock().unwrap().len(), 1);
    let stored = auth.store.load(ORGANIZATION).unwrap().unwrap();
    assert_eq!(stored.refresh_token, "rotated-refresh");

    let (revoked_endpoints, revoked_requests, revoked_server) = scripted_server(vec![
        ScriptedResponse {
            status: "401 Unauthorized",
            headers: Vec::new(),
            body: serde_json::json!({ "message": "Bad credentials" }).to_string(),
        },
        json_response(serde_json::json!({ "error": "bad_refresh_token" })),
    ]);
    let revoked = ManagedGitHubAuth::with_endpoints(&root, "Iv1.test", revoked_endpoints).unwrap();
    let error = revoked.repositories().await.unwrap_err();
    assert_eq!(
        error.downcast_ref::<GitHubAuthError>().unwrap().kind(),
        GitHubAuthFailureKind::Reconnect
    );
    revoked_server.join().unwrap();
    assert_eq!(revoked_requests.lock().unwrap().len(), 2);
    assert!(!revoked.status().unwrap().connected);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn saml_challenge_is_targeted_and_preserves_authorization() {
    let (endpoints, _requests, server) = scripted_server(vec![ScriptedResponse {
        status: "403 Forbidden",
        headers: vec![(
            "X-GitHub-SSO",
            "required; url=https://github.com/orgs/arcee-ai/sso".to_string(),
        )],
        body: serde_json::json!({ "message": "Resource protected by SAML" }).to_string(),
    }]);
    let root = temp_root("saml");
    let auth = ManagedGitHubAuth::with_endpoints(&root, "Iv1.test", endpoints).unwrap();
    auth.store
        .save(&stored_auth(
            "access-canary",
            "refresh-canary",
            now_ms().unwrap() + 60 * 60 * 1_000,
        ))
        .unwrap();

    let error = auth.repositories().await.unwrap_err();
    let error = error.downcast_ref::<GitHubAuthError>().unwrap();
    assert_eq!(error.kind(), GitHubAuthFailureKind::SamlRequired);
    assert_eq!(
        error.authorization_url(),
        Some("https://github.com/orgs/arcee-ai/sso")
    );
    server.join().unwrap();
    assert!(auth.status().unwrap().connected);
    let _ = std::fs::remove_dir_all(root);
}
