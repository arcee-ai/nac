use std::time::Duration;

use serde_json::json;

use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::permissions::{PermissionBackend, PermissionEffect, PermissionPolicy, PermissionRule};
use crate::tools::kernel::NativeTool;

fn endpoint(server: &ScriptedServer, path: &str) -> Url {
    Url::parse(&format!("{}/{path}", server.base_url)).unwrap()
}

fn credential() -> ExaCredential {
    ExaCredential::new("exa-test-canary-secret".to_string())
}

#[test]
fn every_web_result_and_error_path_masks_an_exact_short_credential() {
    let credential = ExaCredential::new("abc".to_string());

    let result = serialized_result(&json!({ "text": "provider result abc" }), &credential);
    let result = result.content.as_text().expect("text web result");
    assert!(!result.contains("abc"), "unredacted web result: {result}");

    let status = provider_status_error(
        StatusCode::UNAUTHORIZED,
        br#"{"message":"provider error abc"}"#,
        &credential,
    )
    .to_string();
    assert!(!status.contains("abc"), "unredacted status error: {status}");

    let error = web_error("web_search", anyhow!("transport error abc"), &credential);
    let error = error.content.as_text().expect("text web error");
    assert!(!error.contains("abc"), "unredacted web error: {error}");
}

#[test]
fn target_validation_rejects_credential_local_private_and_reserved_urls() {
    for target in [
        "file:///etc/passwd",
        "https://user:pass@www.rust-lang.org/",
        "http://localhost/admin",
        "http://service.internal/admin",
        "http://127.0.0.1/",
        "http://10.2.3.4/",
        "http://169.254.169.254/latest/meta-data/",
        "http://192.168.1.1/",
        "http://[::1]/",
        "https://example.com/",
        "https://single-label/",
    ] {
        assert!(validate_public_url(target).is_err(), "accepted {target}");
    }
    assert!(validate_public_url("http://www.rust-lang.org/path").is_ok());
    assert!(validate_public_url("https://8.8.8.8/path").is_ok());
    assert!(validate_public_url("https://[2606:4700:4700::1111]/path").is_ok());
}

#[test]
fn permission_projection_is_query_safe_and_defaults_allow_with_ask_deny_overrides() {
    let input = decode_fetch(json!({
        "url": "https://www.rust-lang.org/learn?token=permission-canary&topic=rust"
    }))
    .unwrap();
    let runtime = crate::tools::test_runtime();
    let client = crate::model::ModelClient::new_for_test();
    let resources = WebFetchTool
        .permission_resources(
            &input,
            ToolServices {
                runtime: &runtime,
                client: &client,
            },
        )
        .unwrap();
    assert_eq!(resources.len(), 1);
    assert!(!resources[0].resource.contains("permission-canary"));
    assert!(!resources[0].display.contains("permission-canary"));
    assert!(resources[0]
        .display
        .contains("Allow `web_fetch` to fetch this URL?"));

    let default = PermissionPolicy::for_backend(PermissionBackend::Local, []);
    assert_eq!(
        default.evaluate(&resources, &[]).effect,
        PermissionEffect::Allow
    );
    let ask = PermissionPolicy::for_backend(
        PermissionBackend::Local,
        [PermissionRule::new("web_fetch", "*", PermissionEffect::Ask)],
    );
    assert_eq!(ask.evaluate(&resources, &[]).effect, PermissionEffect::Ask);
    let deny = PermissionPolicy::for_backend(
        PermissionBackend::Local,
        [PermissionRule::new(
            "web_fetch",
            "*",
            PermissionEffect::Deny,
        )],
    );
    assert_eq!(
        deny.evaluate(&resources, &[]).effect,
        PermissionEffect::Deny
    );
}

#[tokio::test]
async fn search_uses_exa_shape_bounds_results_and_never_returns_the_key() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "autopromptString": "orientation",
            "results": [{
                "url": "https://www.rust-lang.org/learn?tracking=provider-value",
                "title": "Rust exa-test-canary-secret",
                "publishedDate": "2026-01-02",
                "author": "Rust Project",
                "score": 0.91,
                "highlights": ["A concise highlight"],
                "text": "ignored full text"
            }]
        })
        .to_string(),
    )]);
    let key = credential();
    let output = execute_search(
        WebSearchInput {
            query: "How does Rust ownership work?".to_string(),
            num_results: 3,
        },
        &key,
        endpoint(&server, "search"),
        &ThreadCancellation::default(),
    )
    .await
    .unwrap();
    let rendered = serde_json::to_string(&output).unwrap();
    assert!(rendered.contains("A concise highlight"));
    assert!(!rendered.contains("tracking=provider-value"));
    assert!(rendered.contains(key.secret()));
    let model_result = serialized_result(&output, &key);
    let model_text = model_result.content.as_text().unwrap();
    assert!(model_text.contains("[REDACTED]"));
    assert!(!model_text.contains(key.secret()));
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "POST");
    assert_eq!(requests[0].path, "/search");
    assert_eq!(
        requests[0].headers.get("x-api-key").map(String::as_str),
        Some(key.secret())
    );
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body["type"], "neural");
    assert_eq!(body["numResults"], 3);
    assert_eq!(body["contents"]["text"]["maxCharacters"], 500);
}

#[tokio::test]
async fn fetch_uses_exa_contents_and_bounds_decoded_content() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "results": [{
                "url": "https://www.rust-lang.org/learn?redirect-secret=gone",
                "title": "Learn Rust",
                "text": "one two three four five"
            }]
        })
        .to_string(),
    )]);
    let target =
        validate_public_url("https://www.rust-lang.org/learn?request-secret=provider-only")
            .unwrap();
    let output = execute_fetch(
        WebFetchInput {
            target,
            max_chars: 13,
        },
        &credential(),
        endpoint(&server, "contents"),
        &ThreadCancellation::default(),
    )
    .await
    .unwrap();
    assert!(output.truncated);
    assert_eq!(output.content, "one two three");
    assert!(!output.requested_url.contains("request-secret"));
    assert!(!output.final_url.contains("redirect-secret"));
    let requests = server.finish();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(
        body["urls"][0],
        "https://www.rust-lang.org/learn?request-secret=provider-only"
    );
    assert_eq!(body["contents"]["text"]["maxCharacters"], 13);
}

#[tokio::test]
async fn retry_backoff_is_cancellable_and_does_not_start_another_request() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "500 Internal Server Error",
        r#"{"message":"retry"}"#,
    )]);
    let cancellation = ThreadCancellation::default();
    let cancel = cancellation.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(40)).await;
        cancel.cancel();
    });
    let error = request_json::<Value>(
        endpoint(&server, "search"),
        json!({"query":"cancel"}),
        &credential(),
        &cancellation,
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("cancelled"));
    assert_eq!(server.finish().len(), 1);
}

#[tokio::test]
async fn cross_origin_provider_redirect_never_receives_the_credential() {
    let unexpected = ScriptedServer::start_unexpected_request_server(Duration::from_millis(300));
    let redirect = ScriptedServer::start(vec![ScriptedResponse::redirect(
        "302 Found",
        format!("{}/stolen", unexpected.base_url),
        "redirect",
    )]);
    let error = request_json::<Value>(
        endpoint(&redirect, "search"),
        json!({"query":"redirect"}),
        &credential(),
        &ThreadCancellation::default(),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("302"));
    assert_eq!(redirect.finish().len(), 1);
    assert!(unexpected.finish().is_empty());
}

#[tokio::test]
async fn provider_errors_and_oversized_bodies_are_bounded_and_redacted() {
    let key = credential();
    let auth_error = ScriptedServer::start(vec![ScriptedResponse::json(
        "401 Unauthorized",
        json!({"message": format!("bad credential {}", key.secret())}).to_string(),
    )]);
    let error = request_json::<Value>(
        endpoint(&auth_error, "search"),
        json!({"query":"error"}),
        &key,
        &ThreadCancellation::default(),
    )
    .await
    .unwrap_err();
    let diagnostic = error.to_string();
    assert!(diagnostic.contains("[REDACTED]"));
    assert!(!diagnostic.contains(key.secret()));
    auth_error.finish();

    let oversized = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        "x".repeat(MAX_PROVIDER_BYTES + 1),
    )]);
    let error = request_json::<Value>(
        endpoint(&oversized, "search"),
        json!({"query":"large"}),
        &key,
        &ThreadCancellation::default(),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("byte limit"));
    oversized.finish();
}
