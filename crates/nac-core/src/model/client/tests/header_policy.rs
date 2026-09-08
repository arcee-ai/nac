//! Extra-header policy tests: sensitive-header rejection (central,
//! case-insensitive) and benign-header pass-through with exactly one
//! selected credential.

use super::*;
use crate::model::test_http::ScriptedServer;
use std::net::TcpListener;

#[test]
fn sensitive_extra_header_policy_is_central_case_insensitive_and_allows_benign_headers() {
    for name in [
        "Host",
        "HOST",
        "hOsT",
        "Authorization",
        "aUtHoRiZaTiOn",
        "Proxy-Authorization",
        "pRoXy-AuThOrIzAtIoN",
        "x-api-key",
        "X-API-KEY",
    ] {
        let headers =
            std::collections::BTreeMap::from([(name.to_string(), "hostile-value".to_string())]);
        let error = validate_extra_headers(&headers)
            .expect_err("authority and credential headers must be rejected");
        assert!(
            error.to_string().contains(name),
            "unexpected error for {name}: {error:#}"
        );
    }

    let benign = std::collections::BTreeMap::from([
        (
            "Content-Type".to_string(),
            "application/custom+json".to_string(),
        ),
        ("X-Benign-Trace".to_string(), "trace-value".to_string()),
    ]);
    validate_extra_headers(&benign).expect("benign model headers should remain supported");
}

#[tokio::test]
async fn sensitive_extra_headers_fail_before_any_provider_connection() {
    for (backend, name) in [
        (BackendKind::OpenAiResponses, "Authorization"),
        (BackendKind::OpenAiResponses, "Host"),
        (BackendKind::AnthropicMessages, "x-api-key"),
        (BackendKind::AnthropicMessages, "Proxy-Authorization"),
    ] {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind hostile endpoint");
        listener
            .set_nonblocking(true)
            .expect("make hostile endpoint nonblocking");
        let address = listener.local_addr().expect("hostile endpoint address");
        let client = test_model_client(
            backend,
            format!("http://{address}"),
            std::collections::BTreeMap::from([(
                name.to_string(),
                "must-not-be-appended".to_string(),
            )]),
        );

        let error = send_provider_test_request(&client, &format!("http://{address}/initial"))
            .await
            .expect_err("sensitive extra header must fail before request")
            .to_string();

        assert!(error.contains(name), "unexpected error: {error}");
        let accept_error = listener
            .accept()
            .expect_err("invalid header must not open a provider connection");
        assert_eq!(accept_error.kind(), std::io::ErrorKind::WouldBlock);
    }
}

#[tokio::test]
async fn arcee_sensitive_extra_header_still_fails_before_connection() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind hostile endpoint");
    listener
        .set_nonblocking(true)
        .expect("make hostile endpoint nonblocking");
    let address = listener.local_addr().expect("hostile endpoint address");
    let client = ModelClient {
        client: no_redirect_model_client().unwrap(),
        base_url: format!("http://{address}"),
        api_key: "stored-login-secret-must-not-leak".to_string(),
        model: "test-model".to_string(),
        backend: BackendKind::ArceeApi,
        reasoning_effort: None,
        api_key_env: None,
        trusted_api_key_file: None,
        extra_headers: std::collections::BTreeMap::from([(
            "hOsT".to_string(),
            address.to_string(),
        )]),
        arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
        cache_ttl: None,
        prompt_cache_key: None,
        resolved_model: catalog::resolve(BackendKind::ArceeApi, "test-model"),
    };

    let error = client
        .send_completions_chat(Vec::new(), Vec::new(), None)
        .await
        .expect_err("Host override must fail before the HTTP client runs");

    assert!(
        error.to_string().contains("hOsT"),
        "unexpected error: {error:#}"
    );
    let accept_error = listener
        .accept()
        .expect_err("hostile endpoint must receive no connection");
    assert_eq!(accept_error.kind(), std::io::ErrorKind::WouldBlock);
}

#[tokio::test]
async fn benign_extra_headers_pass_with_exactly_one_selected_provider_credential() {
    for backend in [BackendKind::AnthropicMessages, BackendKind::OpenAiResponses] {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({"ok": true}).to_string(),
        )]);
        let client = test_model_client(
            backend,
            server.base_url.clone(),
            std::collections::BTreeMap::from([(
                "X-Benign-Trace".to_string(),
                "trace-value".to_string(),
            )]),
        );

        let response = send_provider_test_request(&client, &format!("{}/initial", server.base_url))
            .await
            .expect("benign header request should succeed");
        let requests = server.finish();

        assert_eq!(response, json!({"ok": true}));
        assert_eq!(requests.len(), 1);
        assert_provider_request_contract(backend, &requests[0]);
    }
}

#[tokio::test]
async fn arcee_api_builtin_headers_defer_to_configured_extra_headers() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]
        })
        .to_string(),
    )]);
    let extra_headers = std::collections::BTreeMap::from([
        ("User-Agent".to_string(), "custom-agent/9".to_string()),
        ("X-Arcee-Client".to_string(), "custom-client".to_string()),
    ]);
    let client = test_model_client(
        BackendKind::ArceeApi,
        server.base_url.clone(),
        extra_headers,
    );

    client
        .send_completions_chat(Vec::new(), Vec::new(), None)
        .await
        .expect("configured header override should succeed");
    let requests = server.finish();

    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    // Built-in defaults are skipped when overridden — exactly one line each,
    // carrying the user's value rather than a duplicate.
    assert_eq!(request.header_counts.get("user-agent"), Some(&1));
    assert_eq!(request.header_counts.get("x-arcee-client"), Some(&1));
    assert_eq!(
        request.headers.get("user-agent").map(String::as_str),
        Some("custom-agent/9")
    );
    assert_eq!(
        request.headers.get("x-arcee-client").map(String::as_str),
        Some("custom-client")
    );
}
