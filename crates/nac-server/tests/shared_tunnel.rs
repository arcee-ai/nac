use std::path::PathBuf;

use axum::{
    body::Body,
    http::{header, HeaderValue, Method, Request, StatusCode},
    response::Response,
    Router,
};
use nac_server::{router_with_options, ServeOptions, ServerOptions, SessionManager};
use tower::ServiceExt;

fn test_app(label: &str, options: ServeOptions) -> (PathBuf, Router) {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("nac_shared_{label}_{unique}"));
    std::fs::create_dir_all(&root).unwrap();
    let manager = SessionManager::new(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
    })
    .unwrap();
    (root, router_with_options(manager, options))
}

async fn response(
    app: &Router,
    method: &str,
    hosts: &[&str],
    origins: &[&str],
    body: &'static str,
) -> Response {
    let uri = if body.is_empty() {
        "/health"
    } else {
        "/sessions"
    };
    let mut request = Request::builder()
        .method(Method::from_bytes(method.as_bytes()).unwrap())
        .uri(uri)
        .body(Body::from(body))
        .unwrap();
    for (name, values) in [(header::HOST, hosts), (header::ORIGIN, origins)] {
        for value in values {
            request
                .headers_mut()
                .append(name.clone(), HeaderValue::from_str(value).unwrap());
        }
    }
    if !body.is_empty() {
        request.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
    }
    app.clone().oneshot(request).await.unwrap()
}

#[tokio::test]
async fn exposure_modes_couple_cors_to_local_only() {
    for (label, options, expected_origin) in [
        ("local", ServeOptions::Local, Some("*")),
        ("shared", ServeOptions::SharedTunnel, None),
    ] {
        let (root, app) = test_app(label, options);
        let response = response(
            &app,
            "GET",
            &["nac.example.com"],
            &["https://nac.example.com"],
            "",
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK, "case {label}");
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            expected_origin,
            "case {label}"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}

#[tokio::test]
async fn shared_tunnel_guard_enforces_host_origin_and_safe_methods() {
    const NONE: &[&str] = &[];
    const HOST: &[&str] = &["nac.example.com"];
    const HOST_443: &[&str] = &["nac.example.com:443"];
    const TUNNEL_HOST: &[&str] = &["nac-test.ngrok-free.app"];
    const SCHEME_HOST: &[&str] = &["https://nac.example.com"];
    const BAD_PORT_HOST: &[&str] = &["nac.example.com:"];
    const DUPLICATE_HOST: &[&str] = &["nac.example.com", "nac.example.com"];
    const ORIGIN: &[&str] = &["https://nac.example.com"];
    const TUNNEL_ORIGIN: &[&str] = &["https://nac-test.ngrok-free.app"];
    const HTTP_ORIGIN: &[&str] = &["http://nac.example.com"];
    const PATH_ORIGIN: &[&str] = &["https://nac.example.com/path"];
    const EVIL_ORIGIN: &[&str] = &["https://evil.example"];
    const BAD_ORIGIN: &[&str] = &["https://bad_host.example"];
    const DUPLICATE_ORIGIN: &[&str] = &["https://nac.example.com", "https://nac.example.com"];
    let accepted = [
        ("safe read", "GET", HOST, NONE, "", StatusCode::OK),
        (
            "same-origin mutation",
            "POST",
            TUNNEL_HOST,
            TUNNEL_ORIGIN,
            "{}",
            StatusCode::CREATED,
        ),
        (
            "explicit Host default port",
            "POST",
            HOST_443,
            ORIGIN,
            "{}",
            StatusCode::CREATED,
        ),
    ];
    let denied = [
        ("HTTP origin", "POST", HOST, HTTP_ORIGIN, ""),
        ("origin path", "POST", HOST, PATH_ORIGIN, ""),
        ("cross-origin read", "GET", HOST, EVIL_ORIGIN, ""),
        ("cross-origin mutation", "POST", HOST, EVIL_ORIGIN, "{}"),
        ("POST without origin", "POST", HOST, NONE, ""),
        ("unknown method", "PURGE", HOST, NONE, ""),
        ("missing Host", "GET", NONE, NONE, ""),
        ("Host with scheme", "GET", SCHEME_HOST, NONE, ""),
        ("malformed Host port", "GET", BAD_PORT_HOST, NONE, ""),
        ("duplicate Host", "GET", DUPLICATE_HOST, NONE, ""),
        ("duplicate Origin", "GET", HOST, DUPLICATE_ORIGIN, ""),
        ("malformed Origin host", "GET", HOST, BAD_ORIGIN, ""),
    ];

    let (root, app) = test_app("guard", ServeOptions::SharedTunnel);
    for (label, method, hosts, origins, body, expected) in accepted {
        let actual = response(&app, method, hosts, origins, body).await.status();
        assert_eq!(actual, expected, "case {label}");
    }
    for (label, method, hosts, origins, body) in denied {
        let actual = response(&app, method, hosts, origins, body).await.status();
        assert_eq!(actual, StatusCode::FORBIDDEN, "case {label}");
    }
    let _ = std::fs::remove_dir_all(root);
}
