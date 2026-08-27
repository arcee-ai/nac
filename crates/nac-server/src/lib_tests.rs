use super::*;
use std::io::Read;

use axum::{
    body::{to_bytes, Body, Bytes},
    http::Request,
};
use flate2::read::GzDecoder;
use nac_core::model_configurations;
use nac_core::projects::ProjectRecord;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tower::ServiceExt;

const EXPECTED_OPENAPI_OPERATIONS: &[(&str, &str)] = &[
    ("DELETE", "/auth/{provider}"),
    ("DELETE", "/auth/{provider}/login/{login_id}"),
    ("DELETE", "/credentials/{name}"),
    ("DELETE", "/managed/github"),
    ("DELETE", "/managed/github/clone-operations/{operation_id}"),
    ("DELETE", "/managed/github/login/{login_id}"),
    ("DELETE", "/managed/secrets/{name}"),
    ("DELETE", "/mcp_library/servers/{server_name}"),
    ("DELETE", "/model-configs/{config_id}"),
    ("DELETE", "/projects/{project_id}"),
    ("DELETE", "/sessions/{session_id}"),
    ("DELETE", "/sessions/{session_id}/goal/{goal_id}"),
    ("DELETE", "/sessions/{session_id}/inbox/{item_id}"),
    (
        "DELETE",
        "/sessions/{session_id}/permissions/grants/{grant_id}",
    ),
    ("DELETE", "/ssh-configs/{config_id}"),
    ("GET", "/auth"),
    ("GET", "/auth/{provider}/login/{login_id}"),
    ("GET", "/commands"),
    ("GET", "/credentials"),
    ("GET", "/fs/browse"),
    ("GET", "/health"),
    ("GET", "/healthz"),
    ("GET", "/managed/github"),
    ("GET", "/managed/github/clone-operations/{operation_id}"),
    ("GET", "/managed/github/git-identity"),
    ("GET", "/managed/github/login/{login_id}"),
    ("GET", "/managed/github/repositories"),
    (
        "GET",
        "/managed/github/repositories/{owner}/{repository}/branches",
    ),
    ("GET", "/managed/secrets"),
    ("GET", "/managed/status"),
    ("GET", "/mcp_library/library"),
    ("GET", "/mcp_library/servers"),
    ("GET", "/model-configs"),
    ("GET", "/projects"),
    ("GET", "/readyz"),
    ("GET", "/models"),
    ("GET", "/sandbox/activity"),
    ("GET", "/sandbox/availability"),
    ("GET", "/sessions"),
    ("GET", "/sessions/{session_id}"),
    ("GET", "/sessions/{session_id}/children"),
    ("GET", "/sessions/{session_id}/children/{child_session_id}"),
    ("GET", "/sessions/{session_id}/config"),
    ("GET", "/sessions/{session_id}/skills"),
    ("GET", "/sessions/{session_id}/events"),
    ("GET", "/sessions/{session_id}/events/stream"),
    ("GET", "/sessions/{session_id}/goal"),
    ("GET", "/sessions/{session_id}/inbox"),
    ("GET", "/sessions/{session_id}/messages"),
    ("GET", "/sessions/{session_id}/orchestrators"),
    (
        "GET",
        "/sessions/{session_id}/orchestrators/{orchestrator_session_id}",
    ),
    ("GET", "/sessions/{session_id}/permissions"),
    ("GET", "/sessions/{session_id}/threads/{thread_name}/events"),
    ("GET", "/sessions/{session_id}/workspace/branches"),
    ("GET", "/sessions/{session_id}/workspace/diff"),
    ("GET", "/sessions/{session_id}/workspace/file"),
    ("GET", "/sessions/{session_id}/workspace/files"),
    ("GET", "/sessions/{session_id}/workspace/revisions"),
    (
        "GET",
        "/sessions/{session_id}/workspace/revisions/{revision_id}/changes",
    ),
    ("GET", "/ssh-configs"),
    ("GET", "/store"),
    ("PATCH", "/mcp_library/servers/{server_name}"),
    ("PATCH", "/model-configs/{config_id}"),
    ("PATCH", "/projects/{project_id}"),
    ("PATCH", "/sessions/{session_id}/config"),
    ("PATCH", "/sessions/{session_id}/goal/{goal_id}"),
    ("PATCH", "/sessions/{session_id}/inbox/{item_id}"),
    ("PATCH", "/ssh-configs/{config_id}"),
    ("POST", "/auth/{provider}/login"),
    ("POST", "/credentials"),
    ("POST", "/managed/github/login"),
    ("POST", "/managed/github/clone-operations"),
    ("POST", "/mcp_library/servers"),
    ("POST", "/mcp_library/servers/test"),
    ("POST", "/model-configs"),
    ("POST", "/model-configs/from-file"),
    ("POST", "/model-configs/{config_id}/models"),
    ("POST", "/projects"),
    ("POST", "/projects/{project_id}/sessions"),
    ("POST", "/providers/models"),
    ("POST", "/sessions"),
    ("POST", "/sessions/launch-defaults"),
    ("POST", "/sessions/{session_id}/cancel-active-run"),
    ("POST", "/sessions/{session_id}/compact"),
    ("POST", "/sessions/{session_id}/children"),
    (
        "POST",
        "/sessions/{session_id}/children/{child_session_id}/cancel",
    ),
    ("POST", "/sessions/{session_id}/goal"),
    ("POST", "/sessions/{session_id}/inbox"),
    ("POST", "/sessions/{session_id}/orchestrators"),
    (
        "POST",
        "/sessions/{session_id}/orchestrators/{orchestrator_session_id}/cancel",
    ),
    ("POST", "/sessions/{session_id}/permissions/{request_id}"),
    ("POST", "/sessions/{session_id}/regenerate"),
    ("POST", "/sessions/{session_id}/revert"),
    ("POST", "/sessions/{session_id}/runs"),
    ("POST", "/sessions/{session_id}/steering"),
    (
        "POST",
        "/sessions/{session_id}/threads/{thread_name}/steering",
    ),
    ("POST", "/sessions/{session_id}/workspace/branches"),
    ("POST", "/sessions/{session_id}/workspace/commit"),
    ("POST", "/sessions/{session_id}/workspace/open"),
    ("POST", "/ssh-configs"),
    ("POST", "/ssh/browse"),
    ("PUT", "/credentials/{name}"),
    ("PUT", "/managed/github/git-identity"),
    ("PUT", "/managed/secrets/{name}"),
    ("PUT", "/projects/order"),
    ("PUT", "/sessions/order"),
    ("PUT", "/sessions/{session_id}/presentation"),
];

#[test]
fn event_cursor_requires_both_epoch_and_sequence() {
    assert!(event_cursor(&EventsQuery {
        after_epoch_id: None,
        after_sequence_id: None,
        limit: None,
    })
    .unwrap()
    .is_none());
    assert!(event_cursor(&EventsQuery {
        after_epoch_id: Some("epoch".to_string()),
        after_sequence_id: Some(7),
        limit: None,
    })
    .unwrap()
    .is_some());
    for query in [
        EventsQuery {
            after_epoch_id: Some("epoch".to_string()),
            after_sequence_id: None,
            limit: None,
        },
        EventsQuery {
            after_epoch_id: None,
            after_sequence_id: Some(7),
            limit: None,
        },
    ] {
        let error = event_cursor(&query).unwrap_err();
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }
}

fn concrete_api_path(path: &str) -> String {
    path.replace("{provider}", "arcee")
        .replace("{login_id}", "missing-login")
        .replace("{owner}", "arcee-ai")
        .replace("{repository}", "missing-repository")
        .replace("{operation_id}", "0123456789abcdef0123456789abcdef")
        .replace("{name}", "MISSING_CREDENTIAL")
        .replace("{server_name}", "missing-server")
        .replace("{config_id}", "missing-config")
        .replace("{session_id}", "missing-session")
        .replace("{goal_id}", "missing-goal")
        .replace("{request_id}", "missing-request")
        .replace("{grant_id}", "missing-grant")
        .replace("{thread_name}", "missing-thread")
        .replace("{revision_id}", "1")
}

fn assert_local_refs_resolve(document: &serde_json::Value, value: &serde_json::Value) {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(reference) = object.get("$ref").and_then(serde_json::Value::as_str) {
                let pointer = reference
                    .strip_prefix('#')
                    .expect("only local OpenAPI references are expected");
                assert!(
                    document.pointer(pointer).is_some(),
                    "unresolved OpenAPI reference {reference}"
                );
            }
            for child in object.values() {
                assert_local_refs_resolve(document, child);
            }
        }
        serde_json::Value::Array(array) => {
            for child in array {
                assert_local_refs_resolve(document, child);
            }
        }
        _ => {}
    }
}

#[tokio::test]
async fn openapi_document_matches_the_running_api_router() {
    let root = temp_root("openapi_contract");
    let app = router(test_manager(&root));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/openapi.json")
                .header(header::HOST, "127.0.0.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CONTENT_TYPE),
        Some(&header::HeaderValue::from_static("application/json"))
    );
    let document: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(document["openapi"], "3.1.0");
    assert!(
        document["components"]["schemas"]["CreateSessionRequest"]["properties"]
            .get("project_id")
            .is_some()
    );
    assert!(
        document["components"]["schemas"]["SessionSummarySnapshot"]["properties"]
            .get("project_id")
            .is_some()
    );
    assert!(
        document["components"]["schemas"]["SessionMetadata"]["properties"]
            .get("project_id")
            .is_some()
    );
    assert!(
        document["components"]["schemas"]["ProjectRecord"]["properties"]
            .get("project_id")
            .is_some()
    );
    assert!(document["paths"]["/sessions"]["get"]["parameters"]
        .as_array()
        .unwrap()
        .iter()
        .any(|parameter| parameter["name"] == "project_id"));

    let mut documented = std::collections::BTreeSet::new();
    for (path, item) in document["paths"].as_object().expect("OpenAPI paths") {
        let item = item.as_object().expect("OpenAPI path item");
        for method in ["get", "post", "put", "patch", "delete"] {
            if item.contains_key(method) {
                documented.insert((method.to_uppercase(), path.clone()));
            }
        }
    }
    let expected: std::collections::BTreeSet<_> = EXPECTED_OPENAPI_OPERATIONS
        .iter()
        .map(|(method, path)| ((*method).to_string(), (*path).to_string()))
        .collect();
    assert_eq!(documented, expected);

    let mut operation_ids = std::collections::BTreeSet::new();
    for (method, path) in EXPECTED_OPENAPI_OPERATIONS {
        let operation = &document["paths"][path][method.to_ascii_lowercase()];
        let operation_id = operation["operationId"].as_str().expect("operation id");
        assert!(
            operation_ids.insert(operation_id),
            "duplicate operation id {operation_id}"
        );
        for parameter_name in path
            .split('{')
            .skip(1)
            .filter_map(|tail| tail.split_once('}').map(|(name, _)| name))
        {
            let matches = operation["parameters"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|parameter| {
                    parameter["name"] == parameter_name
                        && parameter["in"] == "path"
                        && parameter["required"] == true
                })
                .count();
            assert_eq!(
                matches, 1,
                "{method} {path} must document required path parameter {parameter_name}"
            );
        }
    }
    assert_local_refs_resolve(&document, &document);

    for path in expected
        .iter()
        .map(|(_, path)| path)
        .collect::<std::collections::BTreeSet<_>>()
    {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(axum::http::Method::OPTIONS)
                    .uri(concrete_api_path(path))
                    .header(header::HOST, "127.0.0.1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_ne!(
            response.status(),
            StatusCode::NOT_FOUND,
            "documented runtime path {path} is not routed"
        );
        let allow = response
            .headers()
            .get(header::ALLOW)
            .expect("method router must report Allow")
            .to_str()
            .unwrap();
        for (method, expected_path) in &expected {
            if expected_path == path {
                assert!(
                    allow.split(',').any(|allowed| allowed.trim() == method),
                    "{path} runtime Allow={allow:?} is missing {method}"
                );
            }
        }
    }
}

#[tokio::test]
async fn openapi_special_wire_schemas_and_docs_are_live() {
    let root = temp_root("openapi_special_schemas");
    let app = router(test_manager(&root));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/openapi.json")
                .header(header::HOST, "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let document: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();

    let create = &document["components"]["schemas"]["CreateSessionRequest"];
    assert!(!create["required"]
        .as_array()
        .is_some_and(|required| required.iter().any(|field| field == "model")));
    let model = &create["properties"]["model"];
    let model_ref = model["$ref"].as_str().expect("model schema reference");
    let variants = document
        .pointer(
            model_ref
                .strip_prefix('#')
                .expect("local model schema reference"),
        )
        .and_then(|schema| schema["oneOf"].as_array())
        .expect("nullable model oneOf");
    assert!(variants.iter().any(|variant| variant["type"] == "null"));
    assert!(variants.iter().any(|variant| variant["type"] == "string"));
    let headers_ref = create["properties"]["extra_headers"]["$ref"]
        .as_str()
        .expect("tri-state headers reference");
    let headers_variants = document
        .pointer(
            headers_ref
                .strip_prefix('#')
                .expect("local headers schema reference"),
        )
        .and_then(|schema| schema["oneOf"].as_array())
        .expect("nullable headers oneOf");
    assert!(headers_variants
        .iter()
        .any(|variant| variant["type"] == "null"));
    let headers = headers_variants
        .iter()
        .find_map(|variant| variant["oneOf"].as_array())
        .expect("HeadersRequest object/string oneOf");
    assert_eq!(headers.len(), 2);
    assert!(headers.iter().any(|schema| schema["type"] == "object"));
    assert!(headers.iter().any(|schema| schema["type"] == "string"));
    let model_headers_ref = document["components"]["schemas"]["UpdateModelConfigurationRequest"]
        ["properties"]["extra_headers"]["$ref"]
        .as_str()
        .expect("model header map schema reference");
    let mcp_env_ref = document["components"]["schemas"]["UpdateMcpServerRequest"]["properties"]
        ["env"]["$ref"]
        .as_str()
        .expect("MCP environment map schema reference");
    assert_ne!(model_headers_ref, mcp_env_ref);
    let model_headers = document
        .pointer(model_headers_ref.strip_prefix('#').unwrap())
        .and_then(|schema| schema["oneOf"].as_array())
        .and_then(|variants| variants.iter().find(|variant| variant["type"] == "object"))
        .expect("model header map variant");
    assert_eq!(model_headers["additionalProperties"]["type"], "string");
    let mcp_env = document
        .pointer(mcp_env_ref.strip_prefix('#').unwrap())
        .and_then(|schema| schema["oneOf"].as_array())
        .and_then(|variants| variants.iter().find(|variant| variant["type"] == "object"))
        .expect("MCP environment map variant");
    assert!(mcp_env["additionalProperties"]["oneOf"]
        .as_array()
        .is_some_and(|variants| variants.iter().any(|variant| variant["type"] == "null")));

    let assistant_message = document["components"]["schemas"]["Message"]["oneOf"]
        .as_array()
        .and_then(|variants| {
            variants.iter().find(|variant| {
                variant["properties"]["role"]["enum"]
                    .as_array()
                    .is_some_and(|roles| roles.iter().any(|role| role == "assistant"))
            })
        })
        .expect("assistant message variant");
    assert!(assistant_message["required"]
        .as_array()
        .is_some_and(|required| required.iter().any(|field| field == "content")));

    for (schema, field, example) in [
        (
            "PutManagedSecretRequest",
            "value",
            "fake-managed-secret-value",
        ),
        ("StoreCredentialRequest", "value", "fake-credential-value"),
        ("ProviderModelsRequest", "api_key", "fake-provider-key"),
        ("CreateModelConfigurationRequest", "api_key", "fake-api-key"),
    ] {
        let property = &document["components"]["schemas"][schema]["properties"][field];
        assert_eq!(property["writeOnly"], true, "{schema}.{field}");
        assert_eq!(property["example"], example, "{schema}.{field}");
    }

    let stream =
        &document["paths"]["/sessions/{session_id}/events/stream"]["get"]["responses"]["200"];
    assert!(stream["content"]["text/event-stream"].is_object());
    let description = stream["description"].as_str().unwrap();
    for event in [
        "replay_boundary",
        "replay_gap",
        "session_event",
        "assistant_delta",
        "lagged",
    ] {
        assert!(description.contains(event), "missing SSE event {event}");
    }
    for (method, path, status) in [
        ("get", "/sessions", "400"),
        ("post", "/providers/models", "500"),
        ("post", "/sessions/{session_id}/runs", "501"),
        ("delete", "/model-configs/{config_id}", "400"),
        ("delete", "/ssh-configs/{config_id}", "400"),
        ("delete", "/credentials/{name}", "400"),
        ("get", "/sessions/{session_id}/workspace/revisions", "400"),
        ("post", "/sessions/{session_id}/cancel-active-run", "400"),
        ("delete", "/sessions/{session_id}", "400"),
        ("get", "/sessions/{session_id}/config", "400"),
        ("post", "/sessions/{session_id}/compact", "400"),
        ("delete", "/mcp_library/servers/{server_name}", "400"),
        ("get", "/mcp_library/servers", "409"),
        ("delete", "/mcp_library/servers/{server_name}", "409"),
        ("post", "/mcp_library/servers/test", "409"),
    ] {
        assert!(
            document["paths"][path][method]["responses"][status].is_object(),
            "missing {method} {path} response {status}"
        );
    }
    for (method, path) in [
        ("post", "/model-configs"),
        ("patch", "/model-configs/{config_id}"),
        ("post", "/mcp_library/servers"),
        ("patch", "/mcp_library/servers/{server_name}"),
        ("post", "/mcp_library/servers/test"),
        ("post", "/auth/{provider}/login"),
    ] {
        assert!(
            document["paths"][path][method]["responses"]["502"].is_null(),
            "unexpected {method} {path} response 502"
        );
    }

    let invalid_query = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/sessions?workspace_stats=not-a-bool")
                .header(header::HOST, "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid_query.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        invalid_query.headers().get(header::CONTENT_TYPE),
        Some(&header::HeaderValue::from_static(
            "text/plain; charset=utf-8"
        ))
    );

    let redirect = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/docs")
                .header(header::HOST, "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(redirect.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        redirect.headers().get(header::LOCATION),
        Some(&header::HeaderValue::from_static("/docs/"))
    );
    let docs = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/docs/")
                .header(header::HOST, "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(docs.status(), StatusCode::OK);
    assert_eq!(
        docs.headers().get("content-security-policy"),
        Some(&header::HeaderValue::from_static("frame-ancestors 'none'"))
    );
    assert_eq!(
        docs.headers().get("x-frame-options"),
        Some(&header::HeaderValue::from_static("DENY"))
    );
    let html = String::from_utf8(
        to_bytes(docs.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains("swagger-initializer.js"));
    let initializer = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/docs/swagger-initializer.js")
                .header(header::HOST, "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(initializer.status(), StatusCode::OK);
    let initializer = String::from_utf8(
        to_bytes(initializer.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(initializer.contains("/openapi.json"));
    assert!(initializer.contains("\"validatorUrl\": \"none\""));

    for uri in ["/openapi.json", "/docs"] {
        let rejected = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header(header::HOST, "example.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::FORBIDDEN, "{uri}");
        assert_eq!(
            rejected.headers().get(header::CONTENT_TYPE),
            Some(&header::HeaderValue::from_static(
                "text/plain; charset=utf-8"
            ))
        );
    }
}

#[path = "tests/compaction.rs"]
mod compaction;

#[test]
fn model_request_fields_distinguish_omitted_null_and_values() {
    let request: CreateSessionRequest = serde_json::from_str(
        r#"{
                "model":" model-a ",
                "base_url":null,
                "backend":"openai-responses",
                "reasoning_effort":"xhigh",
                "api_key_env":null,
                "extra_headers":{"X-Trace":"launch"},
                "orchestrator_compaction_threshold":0
            }"#,
    )
    .unwrap();

    assert_eq!(request.model, RequestField::Value(" model-a ".to_string()));
    assert_eq!(request.base_url, RequestField::Null);
    assert_eq!(
        request.backend,
        RequestField::Value("openai-responses".to_string())
    );
    assert_eq!(
        request.reasoning_effort,
        RequestField::Value("xhigh".to_string())
    );
    assert_eq!(request.api_key_env, RequestField::Null);
    assert_eq!(
        request.extra_headers,
        RequestField::Value(HeadersRequest(BTreeMap::from([(
            "X-Trace".to_string(),
            "launch".to_string()
        )])))
    );
    assert_eq!(
        request.orchestrator_compaction_threshold,
        RequestField::Value(0)
    );
    assert_eq!(request.cwd, None);
}

#[test]
fn create_resolution_inherits_overrides_and_explicitly_clears_optional_config() {
    let inherited = model_options(
        RequestField::Omitted,
        RequestField::Omitted,
        RequestField::Omitted,
        RequestField::Omitted,
        RequestField::Omitted,
        RequestField::Omitted,
    )
    .unwrap();
    assert_eq!(inherited.reasoning_effort, OptionalModelOption::Inherit);
    assert_eq!(inherited.api_key_env, OptionalModelOption::Inherit);
    assert_eq!(inherited.extra_headers, None);

    let explicit = model_options(
        RequestField::Value(" model-a ".to_string()),
        RequestField::Value(" https://example.com/v1 ".to_string()),
        RequestField::Value("openai-responses".to_string()),
        RequestField::Value("xhigh".to_string()),
        RequestField::Null,
        RequestField::Null,
    )
    .unwrap();
    assert_eq!(explicit.api_model.as_deref(), Some("model-a"));
    assert_eq!(
        explicit.api_base_url.as_deref(),
        Some("https://example.com/v1")
    );
    assert_eq!(explicit.backend, Some(BackendKind::OpenAiResponses));
    assert_eq!(
        explicit.reasoning_effort,
        OptionalModelOption::Value(ReasoningEffort::Xhigh)
    );
    assert_eq!(explicit.api_key_env, OptionalModelOption::Clear);
    assert_eq!(explicit.extra_headers, Some(BTreeMap::new()));

    let raw_selector = " SELECTED_KEY ";
    let selected = model_options(
        RequestField::Omitted,
        RequestField::Omitted,
        RequestField::Omitted,
        RequestField::Omitted,
        RequestField::Value(raw_selector.to_string()),
        RequestField::Omitted,
    )
    .unwrap();
    assert_eq!(
        selected.api_key_env,
        OptionalModelOption::Value(raw_selector.to_string())
    );
}

#[test]
fn null_required_and_blank_concrete_create_fields_are_bad_requests() {
    for field in ["model", "base_url", "backend"] {
        let json = format!(r#"{{"{field}":null}}"#);
        let request: CreateSessionRequest = serde_json::from_str(&json).unwrap();
        let error = model_options(
            request.model,
            request.base_url,
            request.backend,
            request.reasoning_effort,
            request.api_key_env,
            request.extra_headers,
        )
        .unwrap_err();
        assert!(error.downcast_ref::<RequestConfigurationError>().is_some());
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    }
}

#[test]
fn headers_prefer_objects_and_accept_only_valid_legacy_object_strings() {
    let object: CreateSessionRequest =
        serde_json::from_str(r#"{"extra_headers":{"X-Test":"yes"}}"#).unwrap();
    let legacy: CreateSessionRequest =
        serde_json::from_str(r#"{"extra_headers":"{\"X-Test\":\"yes\"}"}"#).unwrap();
    assert_eq!(object.extra_headers, legacy.extra_headers);

    for invalid in [
        r#"{"extra_headers":"   "}"#,
        r#"{"extra_headers":"[1]"}"#,
        r#"{"extra_headers":{"X-Count":3}}"#,
    ] {
        assert!(serde_json::from_str::<CreateSessionRequest>(invalid).is_err());
    }
}

// The committed Vite build is what every release serves, so a stale or
// partial `assets/dist` has to fail here rather than in a browser.
#[test]
fn committed_frontend_build_is_embedded_and_self_consistent() {
    const HTML: &str = include_str!("../assets/dist/index.html");

    let referenced: Vec<&str> = HTML
        .match_indices("/assets/dist/assets/")
        .map(|(start, _)| {
            let tail = &HTML[start + 1..];
            let end = tail
                .find(['"', '\''])
                .expect("asset reference must be quoted");
            &tail[..end]
        })
        .collect();
    assert!(
        referenced.iter().any(|path| path.ends_with(".js")),
        "the entry document must load a bundled script"
    );
    assert!(
        referenced.iter().any(|path| path.ends_with(".css")),
        "the entry document must load a bundled stylesheet"
    );

    for path in referenced {
        let embedded = path
            .strip_prefix("assets/")
            .expect("references are rooted at the asset directory");
        let file = ASSETS
            .get_file(embedded)
            .unwrap_or_else(|| panic!("{path} is referenced but not embedded"));
        assert!(!file.contents().is_empty(), "{path} is empty");
        assert_eq!(
            asset_cache_control(embedded),
            "public, max-age=31536000, immutable",
            "hashed bundles must be cacheable forever"
        );
    }

    assert!(!HTML.to_ascii_lowercase().contains("prototype"));
}

#[tokio::test]
async fn public_proxy_headers_reach_get_json_and_sse_routes() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("public_proxy_headers");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    // The proxy's public name is only served once the operator names it.
    unsafe { std::env::set_var(ALLOWED_HOSTS_ENV, "preview-1234.ngrok-free.app") };
    seed_editable_session(&root, "session");
    let app = router(test_manager(&root));

    for (origin, fetch_site) in [
        (Some("https://preview-1234.ngrok-free.app"), "same-origin"),
        (None, "none"),
        (Some("https://operator.example"), "cross-site"),
    ] {
        let mut request = Request::builder()
            .uri("/health")
            .header(header::HOST, "preview-1234.ngrok-free.app")
            .header("sec-fetch-site", fetch_site);
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{fetch_site}");
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/missing/steering")
                .header(header::HOST, "preview-1234.ngrok-free.app")
                .header(header::ORIGIN, "https://operator.example")
                .header("sec-fetch-site", "cross-site")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"instruction":"do nothing"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/missing/steering")
                .header(header::HOST, "preview-1234.ngrok-free.app")
                .header(header::ORIGIN, "https://preview-1234.ngrok-free.app")
                .header("sec-fetch-site", "same-origin")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"instruction":"do nothing"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/sessions/session/events/stream")
                .header(header::HOST, "preview-1234.ngrok-free.app")
                .header(header::ORIGIN, "https://preview-1234.ngrok-free.app")
                .header("sec-fetch-site", "same-origin")
                .header(header::ACCEPT_ENCODING, "gzip")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CONTENT_TYPE),
        Some(&header::HeaderValue::from_static("text/event-stream"))
    );
    assert!(response.headers().get(header::CONTENT_ENCODING).is_none());

    drop(response);
    drop(app);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn a_foreign_host_is_refused_until_the_operator_names_it() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("foreign_host");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    nac_core::store::initialize(&root.join("store.db")).unwrap();

    let health = |app: Router, host: &'static str| async move {
        app.oneshot(
            Request::builder()
                .uri("/health")
                .header(header::HOST, host)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
    };

    // Rebinding turns an attacker-controlled name into a request for this
    // very server, so the name is what has to be refused.
    let guarded = router(test_manager(&root));
    assert_eq!(
        health(guarded.clone(), "rebound.example").await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        health(guarded.clone(), "127.0.0.1.rebound.example").await,
        StatusCode::FORBIDDEN
    );
    for host in [
        "127.0.0.1:3210",
        "localhost:3210",
        "[::1]:3210",
        "192.168.1.10:3210",
        "[fd00::1]:3210",
        "LOCALHOST",
    ] {
        assert_eq!(
            health(guarded.clone(), host).await,
            StatusCode::OK,
            "{host} names this server"
        );
    }

    unsafe { std::env::set_var(ALLOWED_HOSTS_ENV, "nac.internal, preview.example") };
    let allowlisted = router(test_manager(&root));
    assert_eq!(
        health(allowlisted.clone(), "preview.example").await,
        StatusCode::OK
    );
    assert_eq!(
        health(allowlisted.clone(), "preview.example:8443").await,
        StatusCode::OK
    );
    assert_eq!(
        health(allowlisted.clone(), "other.example").await,
        StatusCode::FORBIDDEN
    );

    unsafe { std::env::set_var(ALLOWED_HOSTS_ENV, "*") };
    let unguarded = router(test_manager(&root));
    assert_eq!(
        health(unguarded.clone(), "anything.example").await,
        StatusCode::OK
    );

    drop((guarded, allowlisted, unguarded));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn a_request_without_a_host_header_is_served() {
    let root = temp_root("hostless_request");
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let app = router(test_manager(&root));

    // HTTP/1.0 clients and probes omit the header; browsers never do.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    drop(app);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cross_origin_browser_mutations_are_refused() {
    let root = temp_root("cross_origin_mutation");
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let app = router(test_manager(&root));
    let request = |fetch_site: Option<&str>, origin: Option<&str>| {
        let mut request = Request::builder()
            .method("POST")
            .uri("/sessions/missing/compact")
            .header(header::HOST, "192.168.1.20:3210");
        if let Some(fetch_site) = fetch_site {
            request = request.header("sec-fetch-site", fetch_site);
        }
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        request.body(Body::empty()).unwrap()
    };

    for fetch_site in ["cross-site", "same-site"] {
        let response = app
            .clone()
            .oneshot(request(Some(fetch_site), None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{fetch_site}");
    }

    let wrong_origin = app
        .clone()
        .oneshot(request(None, Some("http://attacker.example")))
        .await
        .unwrap();
    assert_eq!(wrong_origin.status(), StatusCode::FORBIDDEN);

    let invalid_fetch_metadata = app
        .clone()
        .oneshot(request(Some("unexpected"), Some("http://attacker.example")))
        .await
        .unwrap();
    assert_eq!(invalid_fetch_metadata.status(), StatusCode::FORBIDDEN);

    // Same-origin browsers and non-browser clients reach the handler. The
    // missing session then proves the origin middleware admitted them.
    for admitted in [
        request(Some("same-origin"), None),
        request(None, Some("http://192.168.1.20:3210")),
        request(None, None),
    ] {
        let response = app.clone().oneshot(admitted).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    let cross_site_read = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .header(header::HOST, "192.168.1.20:3210")
                .header("sec-fetch-site", "cross-site")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cross_site_read.status(), StatusCode::OK);

    drop(app);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn host_headers_are_split_from_their_port_before_they_are_judged() {
    assert_eq!(bare_host("example.com:8443"), Some("example.com"));
    assert_eq!(bare_host("[::1]:3210"), Some("::1"));
    assert_eq!(bare_host("  example.com  "), Some("example.com"));
    assert_eq!(bare_host(":3210"), None);
    // An unterminated IPv6 literal is malformed, not a host.
    assert_eq!(bare_host("[::1"), None);

    for host in [
        "127.0.0.1",
        "127.9.9.9:80",
        "[::1]",
        "localhost",
        "LocalHost:1",
    ] {
        assert!(
            is_non_rebindable_host(host),
            "{host} should not be rebindable"
        );
    }
    for host in ["example.com", "127.0.0.1.example.com", "[::1", ""] {
        assert!(
            !is_non_rebindable_host(host),
            "{host} should require an allowlist entry"
        );
    }

    for host in ["10.0.0.1", "192.168.1.10:3210", "[fd00::1]:3210"] {
        assert!(
            is_non_rebindable_host(host),
            "{host} is an IP literal and cannot be rebound"
        );
    }
}

#[test]
fn the_allowlist_is_parsed_leniently_and_matched_exactly() {
    let allowed = vec!["nac.internal".to_string(), "preview.example".to_string()];

    assert!(host_is_allowed("NAC.Internal:8080", &allowed));
    assert!(host_is_allowed("preview.example", &allowed));
    assert!(!host_is_allowed("evil-preview.example", &allowed));
    assert!(!host_is_allowed("preview.example.evil.com", &allowed));
    // Loopback needs no entry at all.
    assert!(host_is_allowed("localhost:3210", &[]));
}

#[tokio::test]
async fn an_explicit_non_loopback_bind_is_accepted() {
    let root = temp_root("non_loopback_bind");
    let manager = test_manager(&root);
    let (listening_tx, listening_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        serve_with_policy(
            "0.0.0.0:0".parse().unwrap(),
            BindPolicy::AllowRemote,
            manager,
            move |bound| {
                let _ = listening_tx.send(bound);
            },
        )
        .await
    });

    let bound = tokio::time::timeout(Duration::from_secs(2), listening_rx)
        .await
        .expect("non-loopback bind timed out")
        .expect("server stopped before listening");
    assert!(bound.ip().is_unspecified());
    assert_ne!(bound.port(), 0);

    server.abort();
    let _ = server.await;
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn complete_shutdown_is_bounded_with_an_open_session_event_stream() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("bounded_shutdown_sse");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("shutdown-test-key"));
    let manager = test_manager(&root);
    nac_core::store::initialize(&root.join("store.db")).unwrap();
    let snapshot = sessions::new_snapshot(
        "shutdown-stream".to_string(),
        root.clone(),
        "gpt-5.2".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let bound = listener.local_addr().unwrap();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let (forced_tx, forced_rx) = std::sync::mpsc::channel();
    let server = tokio::spawn(serve_listener_with_shutdown(
        listener,
        manager,
        async move {
            let _ = shutdown_rx.await;
        },
        Duration::from_millis(100),
        move || {
            let _ = forced_tx.send(());
        },
    ));

    let mut stream = tokio::net::TcpStream::connect(bound).await.unwrap();
    stream
            .write_all(
                b"GET /sessions/shutdown-stream/events/stream HTTP/1.1\r\nHost: localhost\r\nAccept: text/event-stream\r\n\r\n",
            )
            .await
            .unwrap();
    let mut response = Vec::new();
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let mut chunk = [0_u8; 1024];
            let count = stream.read(&mut chunk).await.unwrap();
            assert_ne!(count, 0, "event stream closed before its response");
            response.extend_from_slice(&chunk[..count]);
            if response
                .windows(b"\r\n\r\n".len())
                .any(|window| window == b"\r\n\r\n")
            {
                break;
            }
        }
    })
    .await
    .expect("event stream response timed out");
    let response = String::from_utf8_lossy(&response);
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.contains("content-type: text/event-stream"));

    shutdown_tx.send(()).unwrap();
    tokio::task::block_in_place(|| forced_rx.recv_timeout(Duration::from_secs(1)))
        .expect("forced shutdown outlived the complete shutdown bound");
    drop(stream);
    server.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn non_loopback_bind_is_refused_without_explicit_policy() {
    let error = BindPolicy::LoopbackOnly
        .validate("192.168.1.20:3210".parse().unwrap())
        .unwrap_err();
    assert!(error.to_string().contains("--allow-remote"));
}

/// Path of a bundled script, whose name carries a content hash that changes
/// on every build.
fn bundled_script_path() -> String {
    let file = ASSETS
        .get_dir("dist/assets")
        .expect("the committed build must be embedded")
        .files()
        .find(|file| file.path().extension().is_some_and(|ext| ext == "js"))
        .expect("the build must emit at least one script");
    format!("/assets/{}", file.path().to_string_lossy())
}

#[tokio::test]
async fn finite_static_and_json_routes_gzip_without_changing_identity_bodies() {
    let root = temp_root("route_compression");
    let app = router(test_manager(&root));
    let script = bundled_script_path();

    let identity = get_response(app.clone(), &script, None).await;
    assert_eq!(identity.status(), StatusCode::OK);
    assert!(identity.headers().get(header::CONTENT_ENCODING).is_none());
    let identity_body = response_body(identity).await;
    assert!(!identity_body.is_empty());

    let compressed = get_response(app.clone(), &script, Some("gzip")).await;
    assert_eq!(compressed.status(), StatusCode::OK);
    assert_eq!(
        compressed.headers().get(header::CONTENT_ENCODING),
        Some(&header::HeaderValue::from_static("gzip"))
    );
    assert_eq!(gunzip(&response_body(compressed).await), identity_body);

    let json_identity = get_response(app.clone(), "/store", None).await;
    assert_eq!(json_identity.status(), StatusCode::OK);
    assert!(json_identity
        .headers()
        .get(header::CONTENT_ENCODING)
        .is_none());
    let json_identity_body = response_body(json_identity).await;
    let _: serde_json::Value = serde_json::from_slice(&json_identity_body).unwrap();

    let json_compressed = get_response(app, "/store", Some("gzip")).await;
    assert_eq!(json_compressed.status(), StatusCode::OK);
    assert_eq!(
        json_compressed.headers().get(header::CONTENT_ENCODING),
        Some(&header::HeaderValue::from_static("gzip"))
    );
    assert_eq!(
        gunzip(&response_body(json_compressed).await),
        json_identity_body
    );

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn session_event_envelope_serializes_for_sse_payloads() {
    let envelope = SessionEventEnvelope {
        session_id: Some("session-1".to_string()),
        epoch_id: "test-epoch".to_string(),
        sequence_id: 42,
        client_id: None,
        run_id: None,
        event: nac_core::events::SessionEvent::RunFailed {
            message: "boom".to_string(),
        },
    };

    let payload = serde_json::to_string(&envelope).unwrap();

    assert!(payload.contains("\"sequence_id\":42"));
    assert!(payload.contains("\"message\":\"boom\""));
}

#[test]
fn invalid_workspace_diff_stage_maps_to_bad_request() {
    let error = view::WorkspaceDiffStage::parse("sideways").unwrap_err();
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
}

#[test]
fn config_replacement_preserves_attached_sandbox_ownership() {
    assert_eq!(
            config_replacement_conflict(false, true),
            Some(
                "session owns an active sandbox; config replacement is unavailable while container-local state must be preserved"
            )
        );
    assert!(config_replacement_conflict(false, false).is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn deletion_fails_closed_when_snapshot_decode_cannot_yield_sandbox_metadata() {
    use std::os::unix::fs::PermissionsExt;

    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("delete_invalid_snapshot_preserves_sandbox_authority");
    seed_editable_session(&root, "sandbox-session");
    let store_path = root.join("store.db");
    let mut snapshot = sessions::load_session(&store_path, "sandbox-session").unwrap();
    nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
    sessions::save_session(&store_path, &snapshot).unwrap();

    let mut raw = sessions::load_session_config(&store_path, "sandbox-session").unwrap();
    raw.backend = Some("auto".to_string());
    sessions::update_raw_session_config(&store_path, &raw).unwrap();
    assert!(sessions::load_session(&store_path, "sandbox-session").is_err());

    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    let arguments = root.join("podman-arguments");
    std::fs::write(
        &podman,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$NAC_TEST_PODMAN_ARGUMENTS\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
    unsafe {
        std::env::set_var("PATH", &bin);
        std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
    }

    let manager = test_manager(&root);
    manager
        .delete_session("sandbox-session")
        .await
        .expect_err("invalid snapshot must fail closed before cleanup or row deletion");
    assert!(
        sessions::load_session_config(&store_path, "sandbox-session").is_ok(),
        "durable row and sandbox retry authority must remain"
    );
    assert!(
        !arguments.exists(),
        "container cleanup must not run without decoded ownership metadata"
    );

    unsafe {
        match original_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
        match original_arguments {
            Some(path) => std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", path),
            None => std::env::remove_var("NAC_TEST_PODMAN_ARGUMENTS"),
        }
    }
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn failed_restart_container_cleanup_preserves_durable_delete_authority() {
    use std::os::unix::fs::PermissionsExt;

    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("durable_sandbox_delete");
    seed_editable_session(&root, "sandbox-session");
    let git_executable = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|directory| directory.join("git"))
        .find(|candidate| candidate.is_file())
        .expect("git executable on PATH");
    let git = |args: &[&str]| {
        let output = std::process::Command::new(&git_executable)
            .arg("-C")
            .arg(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init"]);
    git(&["config", "user.name", "NAC Test"]);
    git(&["config", "user.email", "nac@example.invalid"]);
    std::fs::write(root.join("revision.txt"), b"pinned\n").unwrap();
    git(&["add", "revision.txt"]);
    git(&["commit", "-m", "pinned revision"]);
    git(&["update-ref", "refs/nac/revisions/sandbox-session", "HEAD"]);
    let fork_point = String::from_utf8(
        std::process::Command::new(&git_executable)
            .arg("-C")
            .arg(&root)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_string();
    let store_path = root.join("store.db");
    let mut snapshot = sessions::load_session(&store_path, "sandbox-session").unwrap();
    nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
    nac_core::test_support::set_sandbox_worktree(
        &mut snapshot,
        root.clone(),
        root.join("missing-worktree"),
        fork_point,
    );
    sessions::save_session(&store_path, &snapshot).unwrap();

    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::os::unix::fs::symlink(&git_executable, bin.join("git")).unwrap();
    let podman = bin.join("podman");
    let arguments = root.join("podman-arguments");
    std::fs::write(
            &podman,
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$NAC_TEST_PODMAN_ARGUMENTS\"\nexit \"$NAC_TEST_PODMAN_STATUS\"\n",
        )
        .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
    let original_status = std::env::var_os("NAC_TEST_PODMAN_STATUS");
    unsafe {
        std::env::set_var("PATH", &bin);
        std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
        std::env::set_var("NAC_TEST_PODMAN_STATUS", "23");
    }

    let manager = test_manager(&root);
    let error = manager.delete_session("sandbox-session").await.unwrap_err();
    assert!(error
        .to_string()
        .contains("failed to remove sandbox container"));
    assert!(sessions::load_session(&store_path, "sandbox-session").is_ok());
    git(&[
        "rev-parse",
        "--verify",
        "refs/nac/revisions/sandbox-session",
    ]);
    assert_eq!(
        std::fs::read_to_string(&arguments).unwrap(),
        "rm\n--ignore\n-f\nnac-sandbox-session\n"
    );

    unsafe { std::env::set_var("NAC_TEST_PODMAN_STATUS", "0") };
    manager.delete_session("sandbox-session").await.unwrap();
    assert!(sessions::load_session(&store_path, "sandbox-session").is_err());
    let revision_ref = std::process::Command::new(&git_executable)
        .arg("-C")
        .arg(&root)
        .args([
            "rev-parse",
            "--verify",
            "--quiet",
            "refs/nac/revisions/sandbox-session",
        ])
        .status()
        .unwrap();
    assert!(!revision_ref.success());

    unsafe {
        for (name, value) in [
            ("PATH", original_path),
            ("NAC_TEST_PODMAN_ARGUMENTS", original_arguments),
            ("NAC_TEST_PODMAN_STATUS", original_status),
        ] {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn cancelled_delete_request_keeps_authority_until_podman_cleanup_settles() {
    use std::os::unix::fs::PermissionsExt;

    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cancelled_durable_sandbox_delete");
    seed_editable_session(&root, "sandbox-session");
    let store_path = root.join("store.db");
    let mut snapshot = sessions::load_session(&store_path, "sandbox-session").unwrap();
    nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
    sessions::save_session(&store_path, &snapshot).unwrap();

    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    let ready = root.join("podman-ready");
    let release = root.join("podman-release");
    std::fs::write(
            &podman,
            "#!/bin/sh\n: > \"$NAC_TEST_PODMAN_READY\"\nwhile [ ! -f \"$NAC_TEST_PODMAN_RELEASE\" ]; do /bin/sleep 0.01; done\nexit 0\n",
        )
        .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_ready = std::env::var_os("NAC_TEST_PODMAN_READY");
    let original_release = std::env::var_os("NAC_TEST_PODMAN_RELEASE");
    unsafe {
        std::env::set_var("PATH", &bin);
        std::env::set_var("NAC_TEST_PODMAN_READY", &ready);
        std::env::set_var("NAC_TEST_PODMAN_RELEASE", &release);
    }

    let manager = test_manager(&root);
    let delete_manager = manager.clone();
    let request =
        tokio::spawn(async move { delete_manager.delete_session("sandbox-session").await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while !ready.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("Podman cleanup should start");
    request.abort();

    assert!(matches!(
        sessions::SessionResourceMutationLease::try_acquire(&store_path, "sandbox-session"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&store_path, "sandbox-session"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));

    std::fs::write(&release, b"release").unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while sessions::load_session(&store_path, "sandbox-session").is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("owned deletion task should finish after cleanup");
    drop(
        sessions::SessionResourceMutationLease::try_acquire(&store_path, "sandbox-session")
            .unwrap(),
    );

    unsafe {
        for (name, value) in [
            ("PATH", original_path),
            ("NAC_TEST_PODMAN_READY", original_ready),
            ("NAC_TEST_PODMAN_RELEASE", original_release),
        ] {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
    let _ = std::fs::remove_dir_all(root);
}

static SERVER_MODEL_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct ScopedModelEnv {
    original: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl ScopedModelEnv {
    fn isolated(nac_home: &std::path::Path, openai_api_key: Option<&str>) -> Self {
        Self::with_config_home(Some(nac_home), None, None, openai_api_key)
    }

    fn with_config_home(
        nac_home: Option<&std::path::Path>,
        xdg_config_home: Option<&std::path::Path>,
        home: Option<&std::path::Path>,
        openai_api_key: Option<&str>,
    ) -> Self {
        let names = [
            "NAC_HOME",
            "XDG_CONFIG_HOME",
            "HOME",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "DEEPSEEK_API_KEY",
            "FIREWORKS_API_KEY",
            "TOGETHER_API_KEY",
            "ARCEE_API_KEY",
            "OPENAI_BASE_URL",
            "SECOND_API_KEY",
            ALLOWED_HOSTS_ENV,
        ];
        let original = names
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect();
        unsafe {
            for (name, value) in [
                ("NAC_HOME", nac_home),
                ("XDG_CONFIG_HOME", xdg_config_home),
                ("HOME", home),
            ] {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
            match openai_api_key {
                Some(value) => std::env::set_var("OPENAI_API_KEY", value),
                None => std::env::remove_var("OPENAI_API_KEY"),
            }
            std::env::remove_var("ANTHROPIC_API_KEY");
            // The remaining conventional credential vars stay cleared so
            // conventional-var auto-selection never leaks machine state
            // into a test.
            std::env::remove_var("DEEPSEEK_API_KEY");
            std::env::remove_var("FIREWORKS_API_KEY");
            std::env::remove_var("TOGETHER_API_KEY");
            std::env::remove_var("ARCEE_API_KEY");
            std::env::remove_var("OPENAI_BASE_URL");
            std::env::remove_var("SECOND_API_KEY");
            std::env::remove_var(ALLOWED_HOSTS_ENV);
        }
        Self { original }
    }
}

impl Drop for ScopedModelEnv {
    fn drop(&mut self) {
        for (name, value) in self.original.drain(..) {
            unsafe {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
}

fn write_managed_credential(path: &std::path::Path, contents: impl AsRef<[u8]>) {
    std::fs::write(path, contents).expect("write managed credential");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .expect("set managed credential permissions");
    }
}

fn write_codex_auth(nac_home: &std::path::Path) {
    std::fs::create_dir_all(nac_home).expect("create NAC home");
    write_managed_credential(
        &nac_home.join("auth.json"),
        serde_json::json!({
            "type": "chatgpt-codex",
            "access": "codex-server-access",
            "refresh": "codex-server-refresh",
            "expires_at_ms": u64::MAX,
            "account_id": "codex-server-account"
        })
        .to_string(),
    );
}

fn write_arcee_auth(nac_home: &std::path::Path, base_url: &str) {
    std::fs::create_dir_all(nac_home).expect("create NAC home");
    write_managed_credential(
        &nac_home.join("arcee_auth.json"),
        serde_json::json!({
            "type": "arcee_device_token",
            "access_token": "arcee-access-server-test",
            "refresh_token": "arcee-refresh-server-test",
            "token_type": "bearer",
            "expires_at_ms": u64::MAX,
            "base_url": base_url,
            "organization_id": "org-server-test",
            "workspace_name": "server-test"
        })
        .to_string(),
    );
}

fn temp_root(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("nac_server_test_{}_{}", label, unique));
    std::fs::create_dir_all(&root).expect("create temp root");
    root
}

#[test]
fn managed_monitor_peer_lease_process_helper() {
    let Some(store_path) = std::env::var_os("NAC_TEST_MANAGED_PEER_STORE") else {
        return;
    };
    let session_id = std::env::var("NAC_TEST_MANAGED_PEER_SESSION").unwrap();
    let ready_path = PathBuf::from(std::env::var_os("NAC_TEST_MANAGED_PEER_READY").unwrap());
    let _lease = sessions::SessionOperationLease::try_acquire(
        std::path::Path::new(&store_path),
        &session_id,
    )
    .unwrap();
    std::fs::write(ready_path, b"ready").unwrap();
    std::thread::sleep(Duration::from_secs(30));
}

fn test_manager(root: &std::path::Path) -> SessionManager {
    SessionManager::new(ServerOptions {
        root_cwd: root.to_path_buf(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .expect("session manager")
}

fn test_managed_manager(root: &std::path::Path) -> SessionManager {
    let state_root = root.join("managed-state");
    let repository_root = root.join("repositories");
    let home_root = root.join("managed-home");
    for path in [&state_root, &repository_root, &home_root] {
        std::fs::create_dir_all(path).unwrap();
    }
    let managed_host = nac_managed::configuration::ManagedHostConfig {
        version: nac_managed::configuration::MANAGED_CONFIG_VERSION,
        logical_host_id: "test-host".to_string(),
        owner: Some("owner@example.test".to_string()),
        public_hostname: "nac.example.test".to_string(),
        repository_root,
        state_root,
        home_root,
        github_client_id: "Iv1.test".to_string(),
        model_endpoint: "https://models.example.test/v1".to_string(),
        model_credential_file: root.join("model-token"),
        model_credential_environment_names: vec!["ARCEE_API_KEY".to_string()],
    };
    managed_host.validate().unwrap();
    SessionManager::new(ServerOptions {
        root_cwd: root.to_path_buf(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: Some(managed_host),
    })
    .expect("managed session manager")
}

fn poison_operation_lease_directory(root: &std::path::Path) -> PathBuf {
    let lock_dir = root.join("store.db.run-locks");
    std::fs::write(&lock_dir, b"not a directory").expect("poison operation lease directory");
    lock_dir
}

async fn get_response(app: Router, uri: &str, accept_encoding: Option<&str>) -> Response {
    let mut request = Request::builder().uri(uri);
    if let Some(accept_encoding) = accept_encoding {
        request = request.header(header::ACCEPT_ENCODING, accept_encoding);
    }
    app.oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn response_body(response: Response) -> Bytes {
    to_bytes(response.into_body(), usize::MAX).await.unwrap()
}

#[tokio::test]
async fn health_reports_store_readiness_and_recovers_without_path_leakage() {
    let root = temp_root("health_store_readiness");
    let store_path = root.join("store.db");
    nac_core::store::initialize(&store_path).unwrap();
    let app = router(test_manager(&root));

    let healthy = get_response(app.clone(), "/health", None).await;
    assert_eq!(healthy.status(), StatusCode::OK);
    assert_eq!(
        response_body(healthy).await,
        Bytes::from_static(br#"{"status":"ok"}"#)
    );

    std::fs::remove_file(&store_path).unwrap();
    let unavailable = get_response(app.clone(), "/health", None).await;
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = response_body(unavailable).await;
    assert_eq!(body, Bytes::from_static(br#"{"status":"unavailable"}"#));
    assert!(!String::from_utf8_lossy(&body).contains(&store_path.display().to_string()));
    assert!(
        !store_path.exists(),
        "readiness recreated the missing store"
    );

    nac_core::store::initialize(&store_path).unwrap();
    let recovered = get_response(app, "/health", None).await;
    assert_eq!(recovered.status(), StatusCode::OK);
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn open_store_descriptor_count(store_path: &std::path::Path) -> usize {
    let canonical = std::fs::canonicalize(store_path).unwrap();
    let sidecar = |suffix: &str| {
        let mut path = canonical.as_os_str().to_os_string();
        path.push(suffix);
        PathBuf::from(path)
    };
    let targets = [canonical.clone(), sidecar("-wal"), sidecar("-shm")];
    #[cfg(target_os = "linux")]
    {
        return std::fs::read_dir("/proc/self/fd")
            .unwrap()
            .filter_map(|entry| std::fs::read_link(entry.ok()?.path()).ok())
            .filter(|path| targets.contains(path))
            .count();
    }
    #[cfg(target_os = "macos")]
    {
        let mut count = 0;
        let mut limit = std::mem::MaybeUninit::<libc::rlimit>::uninit();
        let result = unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, limit.as_mut_ptr()) };
        assert_eq!(result, 0);
        let limit = unsafe { limit.assume_init() };
        for descriptor in 0..limit.rlim_cur as libc::c_int {
            let mut path = [0_i8; libc::PATH_MAX as usize];
            let result = unsafe { libc::fcntl(descriptor, libc::F_GETPATH, path.as_mut_ptr()) };
            if result == -1 {
                continue;
            }
            use std::os::unix::ffi::OsStrExt;
            let path = unsafe { std::ffi::CStr::from_ptr(path.as_ptr()) };
            let path = PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes()));
            if targets.contains(&path) {
                count += 1;
            }
        }
        count
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn lower_nofile_limit(limit: libc::rlim_t) {
    let mut current = std::mem::MaybeUninit::<libc::rlimit>::uninit();
    let result = unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, current.as_mut_ptr()) };
    assert_eq!(result, 0);
    let mut current = unsafe { current.assume_init() };
    assert!(current.rlim_max >= limit);
    current.rlim_cur = limit;
    let result = unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &current) };
    assert_eq!(result, 0);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[tokio::test]
async fn sqlite_connection_bound_low_nofile_helper() {
    let Some(root) = std::env::var_os("NAC_TEST_LOW_NOFILE_ROOT") else {
        return;
    };
    lower_nofile_limit(256);
    unsafe { std::env::set_var("OPENAI_API_KEY", "low-nofile-test-key") };
    let root = PathBuf::from(root);
    for index in 0..80 {
        seed_editable_session(&root, &format!("session-{index:03}"));
    }

    let manager = test_manager(&root);
    let mut subscriptions = Vec::new();
    for index in 0..56 {
        subscriptions.push(
            manager
                .subscribe_events(&format!("session-{index:03}"), None, 1)
                .await
                .unwrap(),
        );
        assert_eq!(open_store_descriptor_count(&root.join("store.db")), 0);
    }

    let mut attachments = Vec::new();
    for index in 56..72 {
        let manager = manager.clone();
        attachments.push(tokio::spawn(async move {
            manager
                .subscribe_events(&format!("session-{index:03}"), None, 1)
                .await
        }));
    }
    for attachment in attachments {
        subscriptions.push(attachment.await.unwrap().unwrap());
    }

    subscriptions.push(
        manager
            .subscribe_events("session-079", None, 1)
            .await
            .unwrap(),
    );
    let request = CreateSessionRequest {
        cwd: Some(root.clone()),
        model: RequestField::Value("gpt-5.2".to_string()),
        backend: RequestField::Value("openai-responses".to_string()),
        api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
        ..CreateSessionRequest::default()
    };
    let mut creations = Vec::new();
    for _ in 0..8 {
        let manager = manager.clone();
        let request = request.clone();
        creations.push(tokio::spawn(async move {
            manager.create_session(request).await
        }));
    }
    for creation in creations {
        creation.await.unwrap().unwrap();
    }
    manager.create_session(request).await.unwrap();
    assert_eq!(open_store_descriptor_count(&root.join("store.db")), 0);
    nac_core::store::check_readiness(&root.join("store.db")).unwrap();
    assert_eq!(open_store_descriptor_count(&root.join("store.db")), 0);
    assert_eq!(subscriptions.len(), 73);
    println!("low-nofile connection regression completed");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn retained_subscriptions_do_not_exhaust_low_nofile_store_descriptors() {
    let root = temp_root("low_nofile_connections");
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "tests::sqlite_connection_bound_low_nofile_helper",
            "--nocapture",
        ])
        .env("NAC_TEST_LOW_NOFILE_ROOT", &root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "low-NOFILE child failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stdout)
            .contains("low-nofile connection regression completed"),
        "low-NOFILE helper did not execute\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let _ = std::fs::remove_dir_all(root);
}

async fn response_json(response: Response) -> serde_json::Value {
    serde_json::from_slice(&response_body(response).await).unwrap()
}

fn gunzip(body: &[u8]) -> Vec<u8> {
    let mut decoded = Vec::new();
    GzDecoder::new(body).read_to_end(&mut decoded).unwrap();
    decoded
}

#[test]
fn launch_defaults_reload_config_after_manager_boot() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("launch_defaults_reload");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let request = || LaunchModelDefaultsRequest {
        cwd: Some(root.clone()),
        ssh_host: None,
        ssh_port: None,
        ssh_identity_file: None,
    };

    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"trinity-large-thinking\"\n",
    )
    .unwrap();
    let arcee_defaults = manager.launch_model_defaults(request()).unwrap();
    assert_eq!(
        arcee_defaults.configured_model.as_deref(),
        Some("trinity-large-thinking")
    );

    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"gpt-5.6-sol\"\nreasoning_effort = \"high\"\n",
    )
    .unwrap();
    let defaults = manager.launch_model_defaults(request()).unwrap();
    assert_eq!(defaults.configured_model.as_deref(), Some("gpt-5.6-sol"));
    assert_eq!(
        defaults.configured_reasoning_effort,
        Some(ReasoningEffort::High)
    );
    let serialized_defaults = serde_json::to_value(defaults).unwrap();
    assert_eq!(serialized_defaults["configured_model"], "gpt-5.6-sol");
    assert_eq!(serialized_defaults["configured_reasoning_effort"], "high");
    assert!(
        serde_json::to_value(manager.store_info())
            .unwrap()
            .get("configured_model")
            .is_none(),
        "root-only launch metadata must not remain on /store"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn launch_defaults_use_local_cwd_but_server_root_for_ssh_with_relative_config_homes() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();

    for config_home_kind in ["NAC_HOME", "XDG_CONFIG_HOME", "HOME"] {
        let root = temp_root(&format!("launch_defaults_{config_home_kind}"));
        let workspace_a = root.join("workspace-a");
        let workspace_b = root.join("workspace-b");
        std::fs::create_dir_all(&workspace_a).unwrap();
        std::fs::create_dir_all(&workspace_b).unwrap();
        let relative_home = std::path::Path::new("relative-config-home");
        let _env = match config_home_kind {
            "NAC_HOME" => ScopedModelEnv::with_config_home(Some(relative_home), None, None, None),
            "XDG_CONFIG_HOME" => {
                ScopedModelEnv::with_config_home(None, Some(relative_home), None, None)
            }
            "HOME" => ScopedModelEnv::with_config_home(None, None, Some(relative_home), None),
            _ => unreachable!(),
        };
        let config_dir = |cwd: &std::path::Path| match config_home_kind {
            "NAC_HOME" => cwd.join(relative_home),
            "XDG_CONFIG_HOME" => cwd.join(relative_home).join("nac"),
            "HOME" => cwd.join(relative_home).join(".config").join("nac"),
            _ => unreachable!(),
        };
        for (cwd, model) in [
            (&root, "gpt-5.2"),
            (&workspace_a, "trinity-large-thinking"),
            (&workspace_b, "gpt-5.6-sol"),
        ] {
            let dir = config_dir(cwd);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                dir.join("config.toml"),
                format!("[model]\nmodel = \"{model}\"\n"),
            )
            .unwrap();
        }
        let manager = test_manager(&root);

        assert_eq!(
            manager
                .launch_model_defaults(LaunchModelDefaultsRequest {
                    cwd: Some(workspace_a.clone()),
                    ssh_host: None,
                    ssh_port: None,
                    ssh_identity_file: None,
                })
                .unwrap()
                .configured_model
                .as_deref(),
            Some("trinity-large-thinking"),
            "{config_home_kind} local workspace A"
        );
        assert_eq!(
            manager
                .launch_model_defaults(LaunchModelDefaultsRequest {
                    cwd: Some(workspace_b.clone()),
                    ssh_host: None,
                    ssh_port: None,
                    ssh_identity_file: None,
                })
                .unwrap()
                .configured_model
                .as_deref(),
            Some("gpt-5.6-sol"),
            "{config_home_kind} local workspace B"
        );
        assert_eq!(
            manager
                .launch_model_defaults(LaunchModelDefaultsRequest {
                    cwd: Some(std::path::PathBuf::from("remote/project")),
                    ssh_host: Some(" build-box ".to_string()),
                    ssh_port: None,
                    ssh_identity_file: None,
                })
                .unwrap()
                .configured_model
                .as_deref(),
            Some("gpt-5.2"),
            "{config_home_kind} SSH must use the server root"
        );

        let _ = std::fs::remove_dir_all(root);
    }
}

#[test]
fn launch_defaults_carry_the_configured_model_and_effort() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("launch_defaults_model_effort");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let request = || LaunchModelDefaultsRequest {
        cwd: Some(root.clone()),
        ssh_host: None,
        ssh_port: None,
        ssh_identity_file: None,
    };

    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"gpt-5.2\"\nreasoning_effort = \"high\"\n",
    )
    .unwrap();
    let defaults = manager.launch_model_defaults(request()).unwrap();
    assert_eq!(defaults.configured_model.as_deref(), Some("gpt-5.2"));
    assert_eq!(
        defaults.configured_reasoning_effort,
        Some(ReasoningEffort::High)
    );
    let serialized = serde_json::to_value(defaults).unwrap();
    assert_eq!(serialized["configured_model"], "gpt-5.2");
    assert_eq!(serialized["configured_reasoning_effort"], "high");

    // Without a configured model/effort the fields serialize as null
    // (older frontends ignore them either way).
    std::fs::write(nac_home.join("config.toml"), "[model]\n").unwrap();
    let defaults = manager.launch_model_defaults(request()).unwrap();
    assert_eq!(defaults.configured_model, None);
    assert_eq!(defaults.configured_reasoning_effort, None);
    let serialized = serde_json::to_value(defaults).unwrap();
    assert!(serialized["configured_model"].is_null());
    assert!(serialized["configured_reasoning_effort"].is_null());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn commands_route_returns_registry() {
    let root = temp_root("commands_endpoint");
    let app = router(test_manager(&root));
    let response = get_response(app, "/commands", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        serde_json::to_value(slash_command_definitions()).unwrap()
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn session_skills_route_uses_the_attached_session_registry() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("session_skills");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let skills = root.join(".nac/skills");
    for (name, description) in [
        ("zeta", "Last skill alphabetically"),
        ("demo", "Demonstrate the feature"),
    ] {
        let directory = skills.join(name);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
                directory.join("SKILL.md"),
                format!(
                    "---\nname: {name}\ndescription: {description}\ncompatibility: nac\n---\n\n{name} body\n"
                ),
            )
            .unwrap();
    }

    let manager = test_manager(&root);
    let request = CreateSessionRequest {
        cwd: Some(root.clone()),
        model: RequestField::Value("gpt-5.2".to_string()),
        backend: RequestField::Value("openai-responses".to_string()),
        api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
        ..CreateSessionRequest::default()
    };
    let populated = manager.create_session(request.clone()).await.unwrap();
    let populated_id = populated.metadata.session_id.unwrap();

    let app = router(manager.clone());
    let response = get_response(
        app.clone(),
        &format!("/sessions/{populated_id}/skills"),
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        serde_json::json!([
            {
                "name": "demo",
                "description": "Demonstrate the feature",
                "compatibility": "nac"
            },
            {
                "name": "zeta",
                "description": "Last skill alphabetically",
                "compatibility": "nac"
            }
        ])
    );
    std::fs::remove_dir_all(&skills).unwrap();
    let empty = manager.create_session(request).await.unwrap();
    let empty_id = empty.metadata.session_id.unwrap();

    let response = get_response(app.clone(), &format!("/sessions/{empty_id}/skills"), None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_json(response).await, serde_json::json!([]));

    let response = get_response(app, "/sessions/missing/skills", None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn models_endpoint_serves_the_catalog_listing() {
    let root = temp_root("models_endpoint");
    let app = router(test_manager(&root));
    let response = get_response(app, "/models", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;

    assert!(body["catalog_version"].as_u64().unwrap() >= 1);
    let providers = body["providers"].as_array().unwrap();
    assert_eq!(providers.len(), 8);
    let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();

    // Auth requirements and managed base URLs derive from the backend
    // kind, so they are exact regardless of the machine's catalog layers.
    assert_eq!(by_id("anthropic-messages")["auth"], "api_key_env");
    assert!(by_id("anthropic-messages")["managed_base_url"].is_null());
    assert_eq!(by_id("arcee-api")["auth"], "api_key_env");
    assert_eq!(by_id("arcee-auth")["auth"], "managed_arcee");
    assert_eq!(
        by_id("arcee-auth")["managed_base_url"],
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(by_id("chatgpt-codex-responses")["auth"], "codex_oauth");

    // Catalog endpoint defaults: present for the five models.dev
    // providers and the hand-seeded arcee-api (exact values are pinned
    // hermetically in nac-core; a machine overlay could carry a
    // refreshed models.dev `api`), absent for the managed providers.
    for id in [
        "anthropic-messages",
        "deepseek-chat",
        "fireworks-chat",
        "openai-responses",
        "together-chat",
        "arcee-api",
    ] {
        assert!(
            by_id(id)["default_base_url"].is_string(),
            "{id} must serve a catalog default_base_url"
        );
    }
    for id in ["arcee-auth", "chatgpt-codex-responses"] {
        assert!(
            by_id(id)["default_base_url"].is_null(),
            "{id} must not serve a catalog default_base_url"
        );
    }
    assert_eq!(
        by_id("chatgpt-codex-responses")["managed_base_url"],
        nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL
    );
    // Managed providers without a stored credential hint their login
    // command (a code constant, independent of machine catalog layers).
    for (id, command) in [
        ("arcee-auth", "nac-web arcee-auth login"),
        ("chatgpt-codex-responses", "nac-web codex-auth login"),
    ] {
        if by_id(id)["auth_status"] == "no_credential" {
            assert_eq!(by_id(id)["auth_hint"], command, "{id}");
        }
    }

    // Every provider carries `_default` limits and real entries only
    // (never the `_default` id or a synthesis-product source). Values
    // stay unpinned here: the prod nac-core build layers the machine's
    // overlay/models.json, which may patch them — exact values are
    // pinned hermetically by the nac-core catalog tests.
    for provider in providers {
        // Auth status is computed per request from the machine's env
        // and credential files, so only the value domain and the
        // hint/status invariants are machine-independent here.
        let status = provider["auth_status"].as_str().unwrap();
        assert!(
            ["ready", "no_credential"].contains(&status),
            "unexpected auth_status: {status}"
        );
        let hint = &provider["auth_hint"];
        if status == "ready" {
            assert!(hint.is_null(), "ready providers carry no hint: {provider}");
        } else if provider["auth"] == "api_key_env" {
            assert!(
                hint.as_str().is_some_and(|hint| !hint.is_empty()),
                "no_credential API-key providers hint the conventional var: {provider}"
            );
        }
        let limits = &provider["default_limits"];
        assert!(limits["context_window"].as_u64().unwrap() > 0);
        assert!(limits["max_tokens"].as_u64().unwrap() > 0);
        assert!(limits["supported_efforts"].is_array());
        for model in provider["models"].as_array().unwrap() {
            assert_ne!(model["id"], "_default");
            assert!(
                ["baseline", "overlay", "user_override"]
                    .contains(&model["source"].as_str().unwrap()),
                "unexpected model source: {}",
                model["source"]
            );
            assert!(model["context_window"].as_u64().unwrap() > 0);
            assert!(model["max_tokens"].as_u64().unwrap() > 0);
        }
    }

    // Baseline entries are always present: the overlay/user layers patch
    // or add, never remove.
    let anthropic_models = by_id("anthropic-messages")["models"].as_array().unwrap();
    let opus = anthropic_models
        .iter()
        .find(|m| m["id"] == "claude-opus-4-6")
        .expect("the embedded baseline's claude-opus-4-6 entry");
    assert!(opus["supported_efforts"].is_array());
    assert_eq!(opus["reasoning"], true);

    // The hand-seeded providers serve their maintained entries too.
    for (provider, model_id) in [
        ("arcee-auth", "trinity-large-thinking"),
        ("arcee-api", "trinity-large-thinking"),
        ("chatgpt-codex-responses", "gpt-5.6-sol"),
    ] {
        assert!(
            by_id(provider)["models"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["id"] == model_id),
            "the seed's {model_id} entry must reach the {provider} listing"
        );
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn models_endpoint_computes_auth_status_from_the_environment() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("models_endpoint_status");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    // Isolated: no credential files, no config, OPENAI_API_KEY cleared.
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let app = router(test_manager(&root));

    let body = response_json(get_response(app.clone(), "/models", None).await).await;
    let providers = body["providers"].as_array().unwrap();
    let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();

    // Conventional var unset + no configured selector: no_credential
    // with the conventional name as the hint.
    assert_eq!(by_id("openai-responses")["auth_status"], "no_credential");
    assert_eq!(by_id("openai-responses")["auth_hint"], "OPENAI_API_KEY");
    // Managed providers without stored credentials hint the login
    // commands.
    assert_eq!(by_id("arcee-auth")["auth_status"], "no_credential");
    assert_eq!(by_id("arcee-auth")["auth_hint"], "nac-web arcee-auth login");
    assert_eq!(
        by_id("chatgpt-codex-responses")["auth_status"],
        "no_credential"
    );
    assert_eq!(
        by_id("chatgpt-codex-responses")["auth_hint"],
        "nac-web codex-auth login"
    );

    // The conventional variable naming a set value reads ready — the
    // same variable session resolution auto-selects. Unrelated
    // providers still report only their conventional credential hint.
    unsafe { std::env::set_var("OPENAI_API_KEY", "server-test-key") };
    let body = response_json(get_response(app.clone(), "/models", None).await).await;
    let providers = body["providers"].as_array().unwrap();
    let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();
    assert_eq!(by_id("openai-responses")["auth_status"], "ready");
    assert!(by_id("openai-responses")["auth_hint"].is_null());
    assert_eq!(by_id("anthropic-messages")["auth_status"], "no_credential");
    assert_eq!(
        by_id("anthropic-messages")["auth_hint"],
        "ANTHROPIC_API_KEY"
    );

    // A parseable stored credential flips its managed provider.
    std::fs::write(
            nac_home.join("auth.json"),
            r#"{"type":"chatgpt-codex","access":"access-test","refresh":"refresh-test","expires_at_ms":18446744073709551615,"account_id":"account-test"}"#,
        )
        .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            nac_home.join("auth.json"),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
    }
    let body = response_json(get_response(app, "/models", None).await).await;
    let providers = body["providers"].as_array().unwrap();
    let codex = providers
        .iter()
        .find(|p| p["id"] == "chatgpt-codex-responses")
        .unwrap();
    assert_eq!(codex["auth_status"], "ready");
    assert!(codex["auth_hint"].is_null());

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn create_session_request_deserializes_optional_ssh_host() {
    let with_host: CreateSessionRequest = serde_json::from_str(
            r#"{"ssh_host":"build-box","backend":"together-chat","api_key_env":"TOGETHER_CUSTOM_KEY","extra_headers":"{\"X-Launch\":\"yes\"}"}"#,
        )
        .unwrap();
    assert_eq!(with_host.ssh_host.as_deref(), Some("build-box"));
    assert_eq!(with_host.behavior, sessions::SessionBehavior::Orchestrator);
    assert_eq!(
        with_host.backend,
        RequestField::Value("together-chat".to_string())
    );
    assert_eq!(
        with_host.api_key_env,
        RequestField::Value("TOGETHER_CUSTOM_KEY".to_string())
    );
    assert_eq!(
        with_host.extra_headers,
        RequestField::Value(HeadersRequest(BTreeMap::from([(
            "X-Launch".to_string(),
            "yes".to_string()
        )])))
    );

    let alias_host: CreateSessionRequest =
        serde_json::from_str(r#"{"host_id":"legacy-box"}"#).unwrap();
    assert_eq!(alias_host.ssh_host.as_deref(), Some("legacy-box"));
    assert_eq!(with_host.cwd, None);
    assert!(!with_host.sandbox.enabled);

    let without_host: CreateSessionRequest =
        serde_json::from_str(r#"{"cwd":"/tmp/project"}"#).unwrap();
    assert_eq!(without_host.ssh_host, None);
    assert_eq!(without_host.cwd, Some(PathBuf::from("/tmp/project")));

    let direct: CreateSessionRequest = serde_json::from_str(r#"{"behavior":"direct"}"#).unwrap();
    assert_eq!(direct.behavior, sessions::SessionBehavior::Direct);
    assert!(
        serde_json::from_str::<CreateSessionRequest>(r#"{"behavior":"future-behavior"}"#).is_err()
    );
}

#[tokio::test]
async fn create_session_rejects_ssh_host_combined_with_sandbox() {
    let root = temp_root("host_sandbox_conflict");
    let manager = test_manager(&root);

    let request = CreateSessionRequest {
        behavior: sessions::SessionBehavior::Orchestrator,
        first_chat: false,
        project_id: None,
        cwd: None,
        model: RequestField::Omitted,
        base_url: RequestField::Omitted,
        backend: RequestField::Omitted,
        reasoning_effort: RequestField::Omitted,
        api_key_env: RequestField::Omitted,
        extra_headers: RequestField::Omitted,
        orchestrator_compaction_threshold: RequestField::Omitted,
        light_model: RequestField::Omitted,
        ssh_host: Some("build-box".to_string()),
        ssh_port: None,
        ssh_identity_file: None,
        sandbox: SandboxRequest {
            enabled: true,
            ..SandboxRequest::default()
        },
    };
    let error = manager.create_session(request).await.unwrap_err();
    assert!(error.to_string().contains("ssh_host and sandbox"));
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn server_create_rejects_removed_backend_names_as_bad_requests() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("removed_backend_create");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);

    for backend in ["arcee", "auto"] {
        let error = manager
            .create_session(CreateSessionRequest {
                behavior: sessions::SessionBehavior::Orchestrator,
                first_chat: false,
                project_id: None,
                cwd: None,
                model: RequestField::Omitted,
                base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                backend: RequestField::Value(backend.to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Omitted,
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                sandbox: SandboxRequest::default(),
            })
            .await
            .unwrap_err();
        assert!(
            error.to_string().contains("unsupported backend"),
            "{error:#}"
        );
        assert!(
            error.to_string().contains("settings repair required"),
            "{error:#}"
        );
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    }
    assert!(!root.join("store.db").exists());
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn stored_arcee_auth_config_errors_are_400_and_store_failures_are_500() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();

    {
        let root = temp_root("arcee_malformed_auth_status");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        write_managed_credential(&nac_home.join("arcee_auth.json"), "{not-json}");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
        let manager = test_manager(&root);

        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        let response = ApiError::from(error);
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert!(response
            .message
            .contains("failed to parse stored Arcee auth"));
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("arcee_unsafe_auth_permissions");
        let nac_home = root.join("nac-home");
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        std::fs::set_permissions(
            nac_home.join("arcee_auth.json"),
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
        let manager = test_manager(&root);

        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains("unsafe permissions 0644"));
        assert!(!format!("{error:#}").contains("arcee-access-server-test"));
        let response = ApiError::from(error);
        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert!(response.message.contains("mode to 0600"));
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        let _ = std::fs::remove_dir_all(&root);
    }

    {
        let root = temp_root("arcee_auth_store_failure_status");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(nac_home.join("arcee_auth.json")).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
        let manager = test_manager(&root);

        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
        assert!(format!("{error:#}").contains("non-regular credential path"));
        let response = ApiError::from(error);
        assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(response.message, "failed to load stored Arcee credentials");
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        let _ = std::fs::remove_dir_all(&root);
    }
}

fn seed_session(root: &std::path::Path, session_id: &str, created_at: &str) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        None,
        BTreeMap::new(),
    );
    snapshot.created_at = created_at.to_string();
    snapshot.updated_at = created_at.to_string();
    sessions::create_session(&root.join("store.db"), &snapshot).expect("seed session");
}

fn test_transcript() -> Vec<Message> {
    vec![
        Message::System {
            content: "hidden system preface".to_string(),
        },
        Message::User {
            content: "old cycle".to_string(),
        },
        Message::Assistant {
            content: Some("old answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "current cycle".to_string(),
        },
        Message::Assistant {
            content: None,
            reasoning_text: Some("thinking".to_string()),
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::Assistant {
            content: None,
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(vec![nac_core::types::ToolCall {
                id: "call-thread".to_string(),
                call_type: "function".to_string(),
                function: nac_core::types::FunctionCall {
                    name: "thread".to_string(),
                    arguments: r#"{"name":"current/research"}"#.to_string(),
                },
            }]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::System {
            content: "hidden tail".to_string(),
        },
        Message::Assistant {
            content: Some("done".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
    ]
}

fn seed_session_with_messages(
    root: &std::path::Path,
    session_id: &str,
    created_at: &str,
    messages: Vec<Message>,
) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        messages,
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    snapshot.created_at = created_at.to_string();
    snapshot.updated_at = created_at.to_string();
    sessions::create_session(&root.join("store.db"), &snapshot).expect("seed session messages");
}

fn seed_editable_session(root: &std::path::Path, session_id: &str) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        Some(ReasoningEffort::Medium),
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::from([("X-Original".to_string(), "yes".to_string())]),
    );
    snapshot.created_at = "2026-01-01 00:00:00.000000000".to_string();
    snapshot.updated_at = snapshot.created_at.clone();
    sessions::create_session(&root.join("store.db"), &snapshot).expect("seed editable session");
}

fn seed_direct_session(root: &std::path::Path, session_id: &str) {
    seed_direct_session_with_base_url(root, session_id, "https://api.openai.com/v1".to_string());
}

fn seed_direct_session_with_base_url(root: &std::path::Path, session_id: &str, base_url: String) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        base_url,
        BackendKind::OpenAiResponses,
        Some(ReasoningEffort::Medium),
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&root.join("store.db"), &snapshot).expect("seed direct session");
}

fn seed_direct_with_orchestrator_session_with_base_url(
    root: &std::path::Path,
    session_id: &str,
    base_url: String,
) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        base_url,
        BackendKind::OpenAiResponses,
        Some(ReasoningEffort::Medium),
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::DirectWithOrchestrator;
    sessions::create_session(&root.join("store.db"), &snapshot)
        .expect("seed direct-with-orchestrator session");
}

fn scripted_direct_response() -> (String, std::sync::mpsc::Receiver<()>) {
    use std::io::{Read, Write};

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind direct model");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept direct model request");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            match socket.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => request.extend_from_slice(&buffer[..read]),
            }
        }
        let body = serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "resumed"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string();
        let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        socket.write_all(response.as_bytes()).unwrap();
        socket.flush().unwrap();
        sender.send(()).unwrap();
    });
    (base_url, receiver)
}

fn scripted_direct_responses(responses: &[&str]) -> (String, std::sync::mpsc::Receiver<usize>) {
    use std::io::{Read, Write};

    let listener =
        std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind scripted direct model");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let responses = responses
        .iter()
        .map(|response| response.to_string())
        .collect::<Vec<_>>();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for (index, text) in responses.into_iter().enumerate() {
            let (mut socket, _) = listener.accept().expect("accept direct model request");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match socket.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&buffer[..read]),
                }
            }
            let body = serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string();
            let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
            socket.write_all(response.as_bytes()).unwrap();
            socket.flush().unwrap();
            sender.send(index).unwrap();
        }
    });
    (base_url, receiver)
}

fn stalled_then_scripted_direct_response() -> (
    String,
    std::sync::mpsc::Receiver<usize>,
    std::sync::mpsc::Sender<()>,
) {
    use std::io::{Read, Write};

    let listener =
        std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind stalled direct model");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let (request_sender, request_receiver) = std::sync::mpsc::channel();
    let (release_sender, release_receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept direct model request");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            match socket.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => request.extend_from_slice(&buffer[..read]),
            }
        }
        request_sender.send(0).unwrap();
        release_receiver.recv().unwrap();
        let body = serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "cancelled child response"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string();
        let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        let _ = socket.write_all(response.as_bytes());
        let _ = socket.flush();
    });
    (base_url, request_receiver, release_sender)
}

#[tokio::test]
async fn attaching_direct_session_wakes_oldest_persisted_inbox_item() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_inbox_reattach");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-reattach-test-key"));
    let (base_url, request_finished) = scripted_direct_response();
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let store_path = root.join("store.db");
    let pending = nac_core::store::create_session_inbox_item(
        &store_path,
        "direct",
        InboxDelivery::Queue,
        "survive restart",
        None,
        None,
    )
    .unwrap();

    let manager = test_manager(&root);
    let service = manager.attach_session("direct").await.unwrap();
    tokio::task::spawn_blocking(move || {
        request_finished
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while service.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("reattached direct run should finish");

    let delivered =
        nac_core::store::load_session_inbox_item(&store_path, "direct", pending.id).unwrap();
    assert_eq!(delivered.status, nac_core::store::InboxStatus::Delivered);
    assert!(delivered.delivered_run_id.is_some());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn attaching_direct_session_reconciles_one_stale_goal_claim_without_duplicate_start() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_goal_reattach");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-goal-reattach-key"));
    let (base_url, request_finished) = scripted_direct_response();
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let store_path = root.join("store.db");
    nac_core::store::create_session_goal(
        &store_path,
        "direct",
        "resume exactly once",
        Some(15),
        None,
    )
    .unwrap();
    nac_core::store::bind_session_goal_run(
        &store_path,
        "direct",
        &nac_core::store::GoalRunBaseline {
            run_id: "stale-run".to_string(),
            billable_tokens: 0,
            started_at_epoch_ms: 1,
            continuation: true,
        },
    )
    .unwrap();

    let manager = test_manager(&root);
    let service = manager.attach_session("direct").await.unwrap();
    tokio::task::spawn_blocking(move || {
        request_finished
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let goal = service.direct_goal().unwrap().unwrap();
            if !service.has_active_operation() && goal.status == GoalStatus::BudgetLimited {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("one recovered continuation should settle at its budget");
    let goal = service.direct_goal().unwrap().unwrap();
    assert_eq!(goal.tokens_used, 15);
    assert!(goal.continuation_run_id.is_none());
    assert_ne!(goal.accounting_run_id.as_deref(), Some("stale-run"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn direct_inbox_http_api_lists_edits_and_cancels_pending_input() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_inbox_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-inbox-test-key"));
    seed_direct_session(&root, "direct");
    seed_editable_session(&root, "orchestrator");
    let store_path = root.join("store.db");
    let _lease = sessions::SessionOperationLease::try_acquire(&store_path, "direct").unwrap();
    let app = router(test_manager(&root));

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/inbox")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"delivery":"queue","prompt":"do this later"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let create_status = create.status();
    let create_body = response_body(create).await;
    assert_eq!(
        create_status,
        StatusCode::ACCEPTED,
        "{}",
        String::from_utf8_lossy(&create_body)
    );
    let created: InboxItemResponse = serde_json::from_slice(&create_body).unwrap();
    assert_eq!(created.status, nac_core::store::InboxStatus::Pending);
    assert_eq!(created.prompt, "do this later");

    let list = get_response(app.clone(), "/sessions/direct/inbox", None).await;
    assert_eq!(list.status(), StatusCode::OK);
    let listed: Vec<InboxItemResponse> =
        serde_json::from_slice(&response_body(list).await).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);

    let update = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/sessions/direct/inbox/{}", created.id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{},"delivery":"steer"}}"#,
                    created.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(update.status(), StatusCode::OK);
    let updated: InboxItemResponse = serde_json::from_slice(&response_body(update).await).unwrap();
    assert_eq!(updated.delivery, InboxDelivery::Steer);
    assert_eq!(updated.target_run_id, None);

    let stale = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/sessions/direct/inbox/{}", created.id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{},"delivery":"queue"}}"#,
                    created.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);

    let cancel = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/sessions/direct/inbox/{}", created.id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{}}}"#,
                    updated.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cancel.status(), StatusCode::OK);
    let cancelled: InboxItemResponse =
        serde_json::from_slice(&response_body(cancel).await).unwrap();
    assert_eq!(cancelled.status, nac_core::store::InboxStatus::Cancelled);

    let rejected = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/orchestrator/inbox")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"delivery":"queue","prompt":"not here"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn direct_permission_http_api_lists_replies_and_removes_revision_bound_grants() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_permission_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-permission-test-key"));
    seed_direct_session(&root, "direct");
    seed_editable_session(&root, "orchestrator");
    let grant_id = nac_core::store::insert_permission_grants(
        &root.join("store.db"),
        "direct",
        "execute",
        &["command:[cargo][test]*".to_string()],
        "local",
        0,
    )
    .unwrap()[0]
        .id
        .clone();
    let app = router(test_manager(&root));

    let list = get_response(app.clone(), "/sessions/direct/permissions", None).await;
    assert_eq!(list.status(), StatusCode::OK);
    let state: PermissionStateResponse =
        serde_json::from_slice(&response_body(list).await).unwrap();
    assert!(state.requests.is_empty());
    assert_eq!(state.grants.len(), 1);
    assert_eq!(state.grants[0].id, grant_id);

    let missing_reply = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/permissions/missing")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"reply":"once"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_reply.status(), StatusCode::NOT_FOUND);

    let delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/sessions/direct/permissions/grants/{grant_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);
    let list = get_response(app.clone(), "/sessions/direct/permissions", None).await;
    let state: PermissionStateResponse =
        serde_json::from_slice(&response_body(list).await).unwrap();
    assert!(state.grants.is_empty());

    let rejected = get_response(app, "/sessions/orchestrator/permissions", None).await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn direct_goal_http_api_creates_edits_pauses_resumes_and_clears() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("direct_goal_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-goal-test-key"));
    seed_direct_session(&root, "direct");
    seed_editable_session(&root, "orchestrator");
    let endpoint = point_session_at_hanging_endpoint(&root, "direct").await;
    let manager = test_manager(&root);
    manager
        .submit_prompt(
            "direct",
            SubmitPromptRequest {
                prompt: "hold the local run open".to_string(),
            },
        )
        .await
        .unwrap();
    let app = router(manager.clone());

    let empty = get_response(app.clone(), "/sessions/direct/goal", None).await;
    assert_eq!(empty.status(), StatusCode::OK);
    assert_eq!(response_body(empty).await.as_ref(), b"null");

    let create = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/goal")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"objective":"ship the feature","token_budget":500}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create.status(), StatusCode::CREATED);
    let created: SessionGoalRecord = serde_json::from_slice(&response_body(create).await).unwrap();
    assert_eq!(created.status, GoalStatus::Active);
    assert_eq!(created.token_budget, Some(500));

    let pause = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/sessions/direct/goal/{}", created.goal_id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"expected_version":{},"objective":"ship safely","token_budget":null,"status":"paused"}}"#,
                        created.version
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(pause.status(), StatusCode::OK);
    let paused: SessionGoalRecord = serde_json::from_slice(&response_body(pause).await).unwrap();
    assert_eq!(paused.objective, "ship safely");
    assert_eq!(paused.token_budget, None);
    assert_eq!(paused.status, GoalStatus::Paused);

    let resume = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/sessions/direct/goal/{}", paused.goal_id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{},"status":"active"}}"#,
                    paused.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resume.status(), StatusCode::OK);
    let resumed: SessionGoalRecord = serde_json::from_slice(&response_body(resume).await).unwrap();
    assert_eq!(resumed.status, GoalStatus::Active);

    let clear = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/sessions/direct/goal/{}", resumed.goal_id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(
                    r#"{{"expected_version":{}}}"#,
                    resumed.version
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(clear.status(), StatusCode::NO_CONTENT);

    let rejected = get_response(app, "/sessions/orchestrator/goal", None).await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    manager.cancel_active_run("direct").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn traditional_child_goal_http_api_is_bad_request() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_goal_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("child-goal-test-key"));
    seed_direct_session(&root, "direct");
    let manager = test_manager(&root);
    let child_session_id = manager
        .create_traditional_child_session("direct", "general", "child goal ownership")
        .await
        .unwrap();
    let app = router(manager);

    let response = get_response(app, &format!("/sessions/{child_session_id}/goal"), None).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(
        body["error"],
        serde_json::Value::String(
            "traditional child sessions cannot own autonomous goals".to_string()
        )
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_orchestrator_http_api_runs_foreground_then_delivers_background_completion() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_orchestrator_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-orchestrator-test-key"));
    let (base_url, requests) = scripted_direct_responses(&[
        "foreground orchestrator done",
        "background orchestrator done",
        "parent received orchestrator completion",
    ]);
    seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
    seed_direct_session(&root, "ordinary-direct");
    seed_editable_session(&root, "orchestrator");
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let foreground = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/delegating/orchestrators")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"description":"implement durable control","prompt":"complete the first pass","background":false}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(foreground.status(), StatusCode::CREATED);
    let foreground: ManagedOrchestratorRecord =
        serde_json::from_slice(&response_body(foreground).await).unwrap();
    assert_eq!(foreground.status, ManagedOrchestratorStatus::Completed);
    assert_eq!(foreground.generation, 1);
    assert_eq!(
        foreground.report.as_deref(),
        Some("foreground orchestrator done")
    );
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    let child_snapshot =
        sessions::load_session(&root.join("store.db"), &foreground.orchestrator_session_id)
            .unwrap();
    assert_eq!(
        child_snapshot.behavior,
        sessions::SessionBehavior::Orchestrator
    );
    let lineage_response = get_response(
        app.clone(),
        &format!(
            "/sessions/{}?include_sessions=false",
            foreground.orchestrator_session_id
        ),
        None,
    )
    .await;
    assert_eq!(lineage_response.status(), StatusCode::OK);
    let lineage_json = response_json(lineage_response).await;
    assert_eq!(lineage_json["lineage"]["kind"], "managed-orchestrator");
    assert_eq!(lineage_json["lineage"]["parent_session_id"], "delegating");
    assert_eq!(
        lineage_json["lineage"]["description"],
        "implement durable control"
    );

    let background = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/delegating/orchestrators")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"description":"implement durable control","prompt":"complete the second pass","orchestrator_session_id":"{}","background":true}}"#,
                        foreground.orchestrator_session_id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(background.status(), StatusCode::CREATED);
    let background: ManagedOrchestratorRecord =
        serde_json::from_slice(&response_body(background).await).unwrap();
    assert_eq!(background.status, ManagedOrchestratorStatus::Running);
    assert_eq!(background.generation, 2);
    assert_eq!(
        background.execution_mode,
        Some(ManagedOrchestratorExecutionMode::Background)
    );
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
    })
    .await
    .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let orchestrator = manager
                .delegation()
                .managed_orchestrator("delegating", &foreground.orchestrator_session_id)
                .unwrap();
            if orchestrator.status == ManagedOrchestratorStatus::Completed {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("background orchestrator should settle");
    let completed = manager
        .delegation()
        .managed_orchestrator("delegating", &foreground.orchestrator_session_id)
        .unwrap();
    assert_eq!(completed.generation, 2);
    assert_eq!(
        completed.report.as_deref(),
        Some("background orchestrator done")
    );
    assert!(completed.completion_inbox_id.is_some());
    let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "delegating").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
    assert!(inbox[0]
        .content
        .contains(&foreground.orchestrator_session_id));

    assert_eq!(
        get_response(app.clone(), "/sessions/ordinary-direct/orchestrators", None)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        get_response(app, "/sessions/orchestrator/orchestrators", None)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_binding_failure_precedes_run_and_prompt_execution() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_binding_before_execution");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-bind-test-key"));
    seed_editable_session(&root, "orchestrator");
    let manager = test_manager(&root);
    let orchestrator = "orchestrator".to_string();
    let store_path = root.join("store.db");

    let error = manager
        .submit_managed_orchestrator_prompt(
            &orchestrator,
            SubmitPromptRequest {
                prompt: "must never execute".to_string(),
            },
            ManagedOrchestratorExecutionMode::Background,
        )
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "session operation coordination failed");
    let service = manager
        .inner
        .active_sessions
        .read()
        .await
        .get(&orchestrator)
        .cloned()
        .unwrap();
    assert!(service.active_run().is_none());
    assert!(
        nac_core::store::load_run_recovery(&store_path, &orchestrator)
            .unwrap()
            .is_none()
    );
    assert!(sessions::load_session(&store_path, &orchestrator)
        .unwrap()
        .messages
        .is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_orchestrator_cancel_propagates_and_delivers_once() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_orchestrator_cancel");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-orchestrator-cancel-key"));
    let (base_url, requests, release) = stalled_then_scripted_direct_response();
    seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let started = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/delegating/orchestrators")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"description":"cancel flow","prompt":"wait until cancelled","background":true}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(started.status(), StatusCode::CREATED);
    let running: ManagedOrchestratorRecord =
        serde_json::from_slice(&response_body(started).await).unwrap();
    let continued = nac_core::orchestration_control::controller_for(&root.join("store.db"))
        .unwrap()
        .start(
            nac_core::orchestration_control::ManagedOrchestratorStartRequest {
                parent_session_id: "delegating".to_string(),
                orchestrator_session_id: Some(running.orchestrator_session_id.clone()),
                description: "cancel flow".to_string(),
                prompt: "additional foreground steering".to_string(),
                execution_mode: ManagedOrchestratorExecutionMode::Foreground,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        continued.execution_mode,
        Some(ManagedOrchestratorExecutionMode::Background),
        "continuation must not rewrite the admitted generation mode"
    );
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();

    let cancelled = tokio::time::timeout(
        Duration::from_secs(10),
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/sessions/delegating/orchestrators/{}/cancel",
                    running.orchestrator_session_id
                ))
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .expect("managed orchestrator cancellation should not hang")
    .unwrap();
    assert_eq!(cancelled.status(), StatusCode::OK);
    let cancelled: ManagedOrchestratorRecord =
        serde_json::from_slice(&response_body(cancelled).await).unwrap();
    assert_eq!(cancelled.status, ManagedOrchestratorStatus::Cancelled);
    release.send(()).unwrap();

    let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "delegating").unwrap();
    assert_eq!(inbox.len(), 1);
    assert!(inbox[0].content.contains("cancelled"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_attachment_reconciles_abandoned_managed_orchestrator_once() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_orchestrator_restart");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-orchestrator-restart-key"));
    let (base_url, requests) =
        scripted_direct_responses(&["parent acknowledged interrupted orchestrator"]);
    seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
    let store_path = root.join("store.db");

    let first = test_manager(&root);
    let child_session_id = first
        .create_managed_orchestrator_session("delegating", "survive restart")
        .await
        .unwrap();
    nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &child_session_id,
        "abandoned-orchestrator-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            &child_session_id,
            0,
            &Message::User {
                content: "work interrupted by restart".to_string(),
            },
            "abandoned-orchestrator-run",
        )
        .unwrap();
    drop(first);

    let rebuilt = test_manager(&root);
    rebuilt.snapshot("delegating").await.unwrap();
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let relation =
                nac_core::store::load_managed_orchestrator(&store_path, &child_session_id)
                    .unwrap()
                    .unwrap();
            let inbox = nac_core::store::list_session_inbox(&store_path, "delegating").unwrap();
            if relation.status.is_terminal()
                && inbox
                    .first()
                    .is_some_and(|item| item.status == nac_core::store::InboxStatus::Delivered)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("restart reconciliation should interrupt and deliver");
    rebuilt.snapshot("delegating").await.unwrap();
    let relation = nac_core::store::load_managed_orchestrator(&store_path, &child_session_id)
        .unwrap()
        .unwrap();
    let inbox = nac_core::store::list_session_inbox(&store_path, "delegating").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(relation.status, ManagedOrchestratorStatus::Interrupted);
    assert_eq!(relation.completion_inbox_id, Some(inbox[0].id));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_attachment_settles_canonical_managed_terminal_once_after_restart() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_orchestrator_terminal_restart");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-terminal-restart-key"));
    let (base_url, requests) =
        scripted_direct_responses(&["parent acknowledged completed orchestrator"]);
    seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
    let store_path = root.join("store.db");

    let first = test_manager(&root);
    let orchestrator = first
        .create_managed_orchestrator_session("delegating", "finish before restart")
        .await
        .unwrap();
    nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator,
        "terminal-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    let snapshot = sessions::load_session(&store_path, &orchestrator).unwrap();
    let start_idx = snapshot.messages.len() as u64;
    let writer = nac_core::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append_run_prompt(
            &orchestrator,
            start_idx,
            &Message::User {
                content: "complete durably".to_string(),
            },
            "terminal-run",
        )
        .unwrap();
    writer
        .append(
            &orchestrator,
            start_idx + 1,
            &Message::Assistant {
                content: Some("durable orchestrator report".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        )
        .unwrap();
    let mut terminal_snapshot = snapshot;
    let mut update = terminal_snapshot.apply_run_state(sessions::SessionRunState::default());
    update.finished_run_id = Some("terminal-run".to_string());
    update.finished_run_disposition = Some(nac_core::store::RunTerminalDisposition::Completed);
    sessions::save_session_run_state(&store_path, &update).unwrap();
    assert!(
        nac_core::store::load_run_recovery(&store_path, &orchestrator)
            .unwrap()
            .unwrap()
            .terminal_disposition
            .is_some()
    );
    drop(first);

    let rebuilt = test_manager(&root);
    rebuilt.snapshot("delegating").await.unwrap();
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let relation = nac_core::store::load_managed_orchestrator(&store_path, &orchestrator)
                .unwrap()
                .unwrap();
            if relation.status == ManagedOrchestratorStatus::Completed
                && relation.completion_inbox_id.is_some()
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("canonical terminal obligation should settle");
    rebuilt.snapshot("delegating").await.unwrap();
    let relation = nac_core::store::load_managed_orchestrator(&store_path, &orchestrator)
        .unwrap()
        .unwrap();
    assert_eq!(
        relation.report.as_deref(),
        Some("durable orchestrator report")
    );
    assert!(
        nac_core::store::load_run_recovery(&store_path, &orchestrator)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        nac_core::store::list_session_inbox(&store_path, "delegating")
            .unwrap()
            .len(),
        1
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn deleting_parent_removes_managed_orchestrator_sessions() {
    let root = temp_root("managed_orchestrator_delete");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let manager = test_manager(&root);
    let child_session_id = manager
        .create_managed_orchestrator_session("delegating", "delete with parent")
        .await
        .unwrap();
    manager.delete_session("delegating").await.unwrap();
    let store_path = root.join("store.db");
    assert!(sessions::load_session(&store_path, "delegating").is_err());
    assert!(sessions::load_session(&store_path, &child_session_id).is_err());
    assert!(
        nac_core::store::load_managed_orchestrator(&store_path, &child_session_id)
            .unwrap()
            .is_none()
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn deleting_project_skips_descendants_already_removed_by_parent_cascade() {
    let root = temp_root("project_parent_cascade_delete")
        .canonicalize()
        .unwrap();
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let manager = test_manager(&root);
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Cascade delete".to_string()),
            description: None,
            cwd: root.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        })
        .await
        .unwrap();
    manager
        .projects()
        .assign_session(&project.project_id, "delegating")
        .unwrap();
    let child_session_id = manager
        .create_managed_orchestrator_session("delegating", "cascade with project")
        .await
        .unwrap();
    manager
        .update_session_presentation("delegating", "Pinned parent", true, 0)
        .await
        .unwrap();

    let deleted = manager
        .projects()
        .delete(
            &project.project_id,
            application::projects::ProjectSessionDisposition::Delete,
        )
        .await
        .unwrap();
    assert!(deleted
        .deleted_session_ids
        .contains(&"delegating".to_string()));
    assert!(deleted.deleted_session_ids.contains(&child_session_id));
    let store_path = root.join("store.db");
    assert!(sessions::load_session(&store_path, "delegating").is_err());
    assert!(sessions::load_session(&store_path, &child_session_id).is_err());
    assert!(projects::list_projects(&store_path).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn traditional_child_http_api_runs_foreground_then_delivers_background_completion() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-test-key"));
    let (base_url, requests) = scripted_direct_responses(&[
        "foreground child done\n\n## Verification\nfocused test passed",
        "background child done",
        "parent received child completion",
    ]);
    seed_direct_session_with_base_url(&root, "direct", base_url);
    seed_editable_session(&root, "orchestrator");
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let foreground = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/children")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"profile":"general","description":"inspect child flow","prompt":"inspect the flow","background":false}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(foreground.status(), StatusCode::CREATED);
    let foreground: TraditionalChildRecord =
        serde_json::from_slice(&response_body(foreground).await).unwrap();
    assert_eq!(
        foreground.status,
        nac_core::store::TraditionalChildStatus::Completed
    );
    assert_eq!(foreground.generation, 1);
    assert_eq!(
        foreground.report.as_deref(),
        Some("foreground child done\n\n## Verification\nfocused test passed")
    );
    assert_eq!(
        foreground.verification_summary.as_deref(),
        Some("focused test passed")
    );
    assert!(
        nac_core::store::list_session_inbox(&root.join("store.db"), "direct")
            .unwrap()
            .is_empty()
    );
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);

    let background = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/children")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"profile":"general","description":"inspect child flow","prompt":"continue with the second pass","child_session_id":"{}","background":true}}"#,
                        foreground.child_session_id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(background.status(), StatusCode::CREATED);
    let background: TraditionalChildRecord =
        serde_json::from_slice(&response_body(background).await).unwrap();
    assert_eq!(background.child_session_id, foreground.child_session_id);
    assert_eq!(background.generation, 2);
    assert_eq!(
        background.status,
        nac_core::store::TraditionalChildStatus::Running
    );
    assert_eq!(
        background.execution_mode,
        Some(TraditionalChildExecutionMode::Background)
    );
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
    })
    .await
    .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let child = manager
                .delegation()
                .traditional_child("direct", &foreground.child_session_id)
                .unwrap();
            if child.status == nac_core::store::TraditionalChildStatus::Completed {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("background child should settle");
    let status = get_response(
        app.clone(),
        &format!("/sessions/direct/children/{}", foreground.child_session_id),
        None,
    )
    .await;
    assert_eq!(status.status(), StatusCode::OK);
    let completed: TraditionalChildRecord =
        serde_json::from_slice(&response_body(status).await).unwrap();
    assert_eq!(completed.generation, 2);
    assert_eq!(completed.report.as_deref(), Some("background child done"));
    assert!(completed.completion_inbox_id.is_some());
    let parent_inbox =
        nac_core::store::list_session_inbox(&root.join("store.db"), "direct").unwrap();
    assert_eq!(parent_inbox.len(), 1);
    assert_eq!(
        parent_inbox[0].status,
        nac_core::store::InboxStatus::Delivered
    );
    assert!(parent_inbox[0]
        .content
        .contains(&foreground.child_session_id));

    let child_snapshot =
        sessions::load_session(&root.join("store.db"), &foreground.child_session_id).unwrap();
    assert_eq!(child_snapshot.behavior, sessions::SessionBehavior::Direct);
    assert!(matches!(
        child_snapshot.messages.first(),
        Some(Message::System { content }) if content.contains("traditional child coding agent")
    ));
    let lineage_response = get_response(
        app.clone(),
        &format!(
            "/sessions/{}?include_sessions=false",
            foreground.child_session_id
        ),
        None,
    )
    .await;
    assert_eq!(lineage_response.status(), StatusCode::OK);
    let lineage_json = response_json(lineage_response).await;
    assert_eq!(lineage_json["lineage"]["kind"], "traditional-child");
    assert_eq!(lineage_json["lineage"]["parent_session_id"], "direct");
    assert_eq!(lineage_json["lineage"]["description"], "inspect child flow");

    let rejected = get_response(app, "/sessions/orchestrator/children", None).await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn traditional_child_cancel_endpoint_propagates_to_active_generation() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_cancel");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-cancel-key"));
    let (base_url, requests, release) = stalled_then_scripted_direct_response();
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let start = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/children")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"profile":"general","description":"cancel active child","prompt":"wait for cancellation","background":true}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(start.status(), StatusCode::CREATED);
    let running: TraditionalChildRecord =
        serde_json::from_slice(&response_body(start).await).unwrap();
    assert_eq!(
        running.status,
        nac_core::store::TraditionalChildStatus::Running
    );
    let continued = nac_core::traditional_children::controller_for(&root.join("store.db"))
        .unwrap()
        .start(
            nac_core::traditional_children::TraditionalChildStartRequest {
                parent_session_id: "direct".to_string(),
                child_session_id: Some(running.child_session_id.clone()),
                profile: "general".to_string(),
                description: "cancel active child".to_string(),
                prompt: "additional foreground steering".to_string(),
                execution_mode: TraditionalChildExecutionMode::Foreground,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        continued.execution_mode,
        Some(TraditionalChildExecutionMode::Background),
        "continuation must not rewrite the admitted generation mode"
    );
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();

    let cancel = tokio::time::timeout(
        Duration::from_secs(10),
        app.clone().oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/sessions/direct/children/{}/cancel",
                    running.child_session_id
                ))
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .expect("cancel endpoint should not hang")
    .unwrap();
    assert_eq!(cancel.status(), StatusCode::OK);
    let cancelled: TraditionalChildRecord =
        serde_json::from_slice(&response_body(cancel).await).unwrap();
    assert_eq!(
        cancelled.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert_eq!(cancelled.generation, 1);
    assert!(cancelled.completion_inbox_id.is_some());
    release.send(()).unwrap();

    let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "direct").unwrap();
    assert_eq!(inbox.len(), 1);
    assert!(inbox[0].content.contains("cancelled"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_attachment_reconciles_abandoned_background_child_exactly_once() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_restart");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-restart-key"));
    let (base_url, requests) =
        scripted_direct_responses(&["parent acknowledged interrupted child"]);
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let store_path = root.join("store.db");

    let first_manager = test_manager(&root);
    let child_session_id = first_manager
        .create_traditional_child_session("direct", "general", "survive server restart")
        .await
        .unwrap();
    nac_core::store::begin_traditional_child_run(
        &store_path,
        &child_session_id,
        "abandoned-child-run",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            &child_session_id,
            1,
            &Message::User {
                content: "work interrupted by restart".to_string(),
            },
            "abandoned-child-run",
        )
        .unwrap();
    drop(first_manager);

    let rebuilt = test_manager(&root);
    rebuilt.snapshot("direct").await.unwrap();
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let child = nac_core::store::load_traditional_child(&store_path, &child_session_id)
                .unwrap()
                .unwrap();
            let inbox = nac_core::store::list_session_inbox(&store_path, "direct").unwrap();
            if child.status == nac_core::store::TraditionalChildStatus::Interrupted
                && inbox
                    .first()
                    .is_some_and(|item| item.status == nac_core::store::InboxStatus::Delivered)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("restart reconciliation should interrupt the child and wake its parent");

    rebuilt.snapshot("direct").await.unwrap();
    let child = nac_core::store::load_traditional_child(&store_path, &child_session_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        child.status,
        nac_core::store::TraditionalChildStatus::Interrupted
    );
    assert!(child
        .failure
        .as_deref()
        .is_some_and(|failure| { failure.contains("interrupted when the nac process stopped") }));
    let inbox = nac_core::store::list_session_inbox(&store_path, "direct").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(child.completion_inbox_id, Some(inbox[0].id));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_repair_recovers_suppression_after_deletion_owner_disappears() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("completion_suppression_restart_repair");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("suppression-repair-key"));
    seed_direct_session(&root, "direct");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let store_path = root.join("store.db");
    let manager = test_manager(&root);

    let child_session_id = manager
        .create_traditional_child_session("direct", "general", "repair child delivery")
        .await
        .unwrap();
    nac_core::store::begin_traditional_child_run(
        &store_path,
        &child_session_id,
        "child-run",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let child =
        nac_core::store::suppress_traditional_child_completion(&store_path, &child_session_id)
            .unwrap();
    nac_core::store::settle_traditional_child_run(
        &store_path,
        &child_session_id,
        "child-run",
        nac_core::store::TraditionalChildTerminal {
            status: nac_core::store::TraditionalChildStatus::Cancelled,
            report: None,
            failure: Some("deletion interrupted".to_string()),
            change_summary: None,
            verification_summary: None,
        },
    )
    .unwrap();
    assert!(nac_core::store::list_session_inbox(&store_path, "direct")
        .unwrap()
        .is_empty());
    let child_lease =
        sessions::SessionRelationshipLease::try_acquire(&store_path, &child_session_id).unwrap();
    manager
        .repair_orphaned_completion_suppressions("direct")
        .unwrap();
    assert!(nac_core::store::list_session_inbox(&store_path, "direct")
        .unwrap()
        .is_empty());
    let admission_error = nac_core::store::begin_traditional_child_run(
        &store_path,
        &child_session_id,
        "child-run-2",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap_err();
    assert!(admission_error
        .to_string()
        .contains("completion delivery is suppressed"));
    drop(child_lease);
    manager
        .repair_orphaned_completion_suppressions("direct")
        .unwrap();
    manager
        .repair_orphaned_completion_suppressions("direct")
        .unwrap();
    let child_inbox = nac_core::store::list_session_inbox(&store_path, "direct").unwrap();
    assert_eq!(child_inbox.len(), 1);
    assert_eq!(
        nac_core::store::load_traditional_child(&store_path, &child_session_id)
            .unwrap()
            .unwrap()
            .completion_inbox_id,
        Some(child_inbox[0].id)
    );
    assert_eq!(child.generation, 1);
    let child_generation_two = nac_core::store::begin_traditional_child_run(
        &store_path,
        &child_session_id,
        "child-run-2",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    assert_eq!(child_generation_two.generation, 2);

    let orchestrator_session_id = manager
        .create_managed_orchestrator_session("delegating", "repair orchestrator delivery")
        .await
        .unwrap();
    nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator_session_id,
        "orchestrator-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::suppress_managed_orchestrator_completion(
        &store_path,
        &orchestrator_session_id,
    )
    .unwrap();
    nac_core::store::settle_managed_orchestrator_run(
        &store_path,
        &orchestrator_session_id,
        "orchestrator-run",
        nac_core::store::ManagedOrchestratorTerminal {
            status: ManagedOrchestratorStatus::Cancelled,
            report: None,
            failure: Some("deletion interrupted".to_string()),
        },
    )
    .unwrap();
    let orchestrator_lease =
        sessions::SessionRelationshipLease::try_acquire(&store_path, &orchestrator_session_id)
            .unwrap();
    manager
        .repair_orphaned_completion_suppressions("delegating")
        .unwrap();
    assert!(
        nac_core::store::list_session_inbox(&store_path, "delegating")
            .unwrap()
            .is_empty()
    );
    let admission_error = nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator_session_id,
        "orchestrator-run-2",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap_err();
    assert!(admission_error
        .to_string()
        .contains("completion delivery is suppressed"));
    drop(orchestrator_lease);
    manager
        .repair_orphaned_completion_suppressions("delegating")
        .unwrap();
    manager
        .repair_orphaned_completion_suppressions("delegating")
        .unwrap();
    assert_eq!(
        nac_core::store::list_session_inbox(&store_path, "delegating")
            .unwrap()
            .len(),
        1
    );
    let orchestrator_generation_two = nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator_session_id,
        "orchestrator-run-2",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    assert_eq!(orchestrator_generation_two.generation, 2);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn deleting_parent_removes_its_traditional_child_sessions() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_delete");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-delete-key"));
    seed_direct_session(&root, "direct");
    let manager = test_manager(&root);
    let child_session_id = manager
        .create_traditional_child_session("direct", "general", "delete with parent")
        .await
        .unwrap();

    manager.delete_session("direct").await.unwrap();

    let store_path = root.join("store.db");
    assert!(sessions::load_session(&store_path, "direct").is_err());
    assert!(sessions::load_session(&store_path, &child_session_id).is_err());
    assert!(
        nac_core::store::load_traditional_child(&store_path, &child_session_id)
            .unwrap()
            .is_none()
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn wrong_parent_relationship_reads_are_opaque_not_found() {
    let root = temp_root("relationship_ownership_opaque");
    seed_direct_session(&root, "parent-a");
    seed_direct_session(&root, "parent-b");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating-a",
        "https://api.openai.com/v1".to_string(),
    );
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating-b",
        "https://api.openai.com/v1".to_string(),
    );
    let manager = test_manager(&root);
    let store_path = root.join("store.db");
    let child = manager
        .create_traditional_child_session("parent-a", "general", "owned child")
        .await
        .unwrap();
    let orchestrator = manager
        .create_managed_orchestrator_session("delegating-a", "owned orchestrator")
        .await
        .unwrap();

    let summaries = manager.list_sessions(false).await.unwrap();
    assert!(summaries
        .iter()
        .find(|entry| entry.summary.session_id == child)
        .and_then(|entry| entry.lineage.as_ref())
        .is_some_and(|lineage| lineage.kind == SessionLineageKind::TraditionalChild));
    assert!(summaries
        .iter()
        .find(|entry| entry.summary.session_id == orchestrator)
        .and_then(|entry| entry.lineage.as_ref())
        .is_some_and(|lineage| lineage.kind == SessionLineageKind::ManagedOrchestrator));

    let inbox_error = manager.list_direct_inbox(&child).await.unwrap_err();
    assert!(inbox_error
        .to_string()
        .contains("accept input only through their parent"));
    let run_error = manager
        .submit_prompt(
            &child,
            SubmitPromptRequest {
                prompt: "bypass parent ownership".to_string(),
            },
        )
        .await
        .unwrap_err();
    assert!(run_error
        .to_string()
        .contains("accept work only through their parent"));
    let managed_run_error = manager
        .submit_prompt(
            &orchestrator,
            SubmitPromptRequest {
                prompt: "bypass parent ownership".to_string(),
            },
        )
        .await
        .unwrap_err();
    assert!(managed_run_error
        .to_string()
        .contains("accept work only through their parent"));

    for delegated in [&child, &orchestrator] {
        let branch_error = manager
            .workspace()
            .switch_workspace_branch(
                delegated,
                application::workspace::SwitchBranch {
                    name: "delegated-mutation".to_string(),
                    create: true,
                },
            )
            .await
            .unwrap_err();
        assert!(branch_error
            .to_string()
            .contains("accept work only through their parent"));
        let commit_error = manager
            .workspace()
            .commit_workspace(
                delegated,
                application::workspace::CommitWorkspace {
                    message: "delegated mutation".to_string(),
                },
            )
            .await
            .unwrap_err();
        assert!(commit_error
            .to_string()
            .contains("accept work only through their parent"));
        let before = manager.session_config(delegated).unwrap();
        let config_error = manager
            .update_session_config(
                delegated,
                serde_json::from_value(serde_json::json!({"model":"mutated-model"})).unwrap(),
            )
            .await
            .unwrap_err();
        assert!(config_error
            .to_string()
            .contains("accept work only through their parent"));
        assert_eq!(manager.session_config(delegated).unwrap(), before);

        let steering_error = manager
            .queue_orchestrator_steering(
                delegated,
                OrchestratorSteeringRequest {
                    instruction: "bypass parent steering".to_string(),
                },
            )
            .await
            .unwrap_err();
        assert!(steering_error
            .to_string()
            .contains("accept work only through their parent"));
        let cancellation_error = manager.cancel_active_run(delegated).await.unwrap_err();
        assert!(cancellation_error
            .to_string()
            .contains("accept work only through their parent"));
        assert_eq!(
            manager.revert_session(delegated, 0).await.unwrap_err(),
            RevertSessionError::NotFound
        );
        assert_eq!(
            manager
                .regenerate_session_run(delegated, 0)
                .await
                .unwrap_err(),
            RegenerateSessionError::NotFound
        );
        assert_eq!(
            manager.compact_session(delegated).await.unwrap_err(),
            CompactSessionError::NotFound
        );
        let delete_error = manager.delete_session(delegated).await.unwrap_err();
        assert!(delete_error
            .to_string()
            .contains("accept work only through their parent"));
        assert!(sessions::session_exists(&store_path, delegated).unwrap());
    }

    let app = router(manager.clone());
    for delegated in [&child, &orchestrator] {
        for (path, body) in [
            (
                "workspace/branches",
                r#"{"name":"delegated-mutation","create":true}"#,
            ),
            ("workspace/commit", r#"{"message":"delegated mutation"}"#),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/sessions/{delegated}/{path}"))
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::CONFLICT, "{path}");
        }
        let config = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/sessions/{delegated}/config"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"model":"mutated-model"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(config.status(), StatusCode::CONFLICT);
        let steering = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/sessions/{delegated}/steering"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"instruction":"bypass"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(steering.status(), StatusCode::CONFLICT);
        let cancel = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/sessions/{delegated}/cancel-active-run"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cancel.status(), StatusCode::CONFLICT);
        let delete = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/sessions/{delegated}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(delete.status(), StatusCode::CONFLICT);
        assert!(sessions::session_exists(&store_path, delegated).unwrap());
        for action in ["revert", "regenerate"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/sessions/{delegated}/{action}"))
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(r#"{"message_idx":0}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{action}");
        }
        let compact = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/sessions/{delegated}/compact"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(compact.status(), StatusCode::NOT_FOUND);
    }

    let child_error = ApiError::from(
        manager
            .delegation()
            .traditional_child("parent-b", &child)
            .unwrap_err(),
    );
    assert_eq!(child_error.status, StatusCode::NOT_FOUND);
    assert_eq!(child_error.message, "traditional child was not found");
    assert!(!child_error.message.contains(&child));
    let child_cancel_error = ApiError::from(
        manager
            .delegation()
            .cancel_traditional_child("parent-b", &child)
            .await
            .unwrap_err(),
    );
    assert_eq!(child_cancel_error.status, StatusCode::NOT_FOUND);
    assert_eq!(
        child_cancel_error.message,
        "traditional child was not found"
    );
    assert!(!child_cancel_error.message.contains(&child));
    let continuation_error = nac_core::traditional_children::controller_for(&root.join("store.db"))
        .unwrap()
        .start(
            nac_core::traditional_children::TraditionalChildStartRequest {
                parent_session_id: "parent-b".to_string(),
                child_session_id: Some(child.clone()),
                profile: "general".to_string(),
                description: "owned child".to_string(),
                prompt: "must remain opaque".to_string(),
                execution_mode: TraditionalChildExecutionMode::Foreground,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(
        continuation_error.to_string(),
        "traditional child was not found"
    );

    let orchestrator_error = ApiError::from(
        manager
            .delegation()
            .managed_orchestrator("delegating-b", &orchestrator)
            .unwrap_err(),
    );
    assert_eq!(orchestrator_error.status, StatusCode::NOT_FOUND);
    assert_eq!(
        orchestrator_error.message,
        "managed orchestrator was not found"
    );
    assert!(!orchestrator_error.message.contains(&orchestrator));
    let orchestrator_cancel_error = ApiError::from(
        manager
            .delegation()
            .cancel_managed_orchestrator("delegating-b", &orchestrator)
            .await
            .unwrap_err(),
    );
    assert_eq!(orchestrator_cancel_error.status, StatusCode::NOT_FOUND);
    assert_eq!(
        orchestrator_cancel_error.message,
        "managed orchestrator was not found"
    );
    assert!(!orchestrator_cancel_error.message.contains(&orchestrator));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_monitor_treats_peer_lease_as_live() {
    let root = temp_root("managed_peer_lease_live");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let manager = test_manager(&root);
    let orchestrator = manager
        .create_managed_orchestrator_session("delegating", "foreign live run")
        .await
        .unwrap();
    let store_path = root.join("store.db");
    let relation = nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator,
        "peer-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            &orchestrator,
            0,
            &Message::User {
                content: "peer is working".to_string(),
            },
            "peer-run",
        )
        .unwrap();
    let ready_path = root.join("managed-peer-ready");
    let mut peer = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "tests::managed_monitor_peer_lease_process_helper",
            "--nocapture",
        ])
        .env("NAC_TEST_MANAGED_PEER_STORE", &store_path)
        .env("NAC_TEST_MANAGED_PEER_SESSION", &orchestrator)
        .env("NAC_TEST_MANAGED_PEER_READY", &ready_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    for _ in 0..200 {
        if ready_path.exists() {
            break;
        }
        assert!(
            peer.try_wait().unwrap().is_none(),
            "peer helper exited early"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(ready_path.exists(), "peer helper never acquired the lease");

    let steering = manager
        .queue_managed_orchestrator_steering(
            "delegating",
            &orchestrator,
            "steer the peer-owned generation",
        )
        .expect("peer ownership must not block durable steering");
    let claimed =
        nac_core::store::claim_thread_steering(&store_path, &orchestrator, "peer-run").unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, steering.steering_id);

    let peer_observed = manager.inner.managed_monitor_peer_observed.notified();
    let monitor_manager = manager.clone();
    let monitor_orchestrator = orchestrator.clone();
    let monitor = tokio::spawn(async move {
        monitor_manager
            .monitor_managed_orchestrator(&monitor_orchestrator, relation.generation)
            .await
    });

    tokio::time::timeout(Duration::from_secs(5), peer_observed)
        .await
        .expect("monitor must observe the peer-owned operation lease");
    assert!(!monitor.is_finished());
    assert_eq!(
        nac_core::store::load_managed_orchestrator(&store_path, &orchestrator)
            .unwrap()
            .unwrap()
            .status,
        ManagedOrchestratorStatus::Running
    );
    monitor.abort();
    let _ = monitor.await;
    peer.kill().unwrap();
    peer.wait().unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn peer_owned_direct_and_managed_cancellation_fail_fast() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let direct_root = temp_root("direct_peer_cancel_conflict");
    let _env =
        ScopedModelEnv::isolated(&direct_root.join("nac-home"), Some("peer-cancel-test-key"));
    seed_direct_session(&direct_root, "direct");
    let direct_manager = test_manager(&direct_root);
    let direct_lease =
        sessions::SessionOperationLease::try_acquire(&direct_root.join("store.db"), "direct")
            .unwrap();
    let direct_error = tokio::time::timeout(
        Duration::from_secs(1),
        direct_manager.cancel_active_run("direct"),
    )
    .await
    .expect("peer-owned direct cancellation must not hang")
    .unwrap_err();
    assert!(
        direct_error
            .to_string()
            .contains("running in another process"),
        "unexpected direct cancellation error: {direct_error:#}"
    );
    drop(direct_lease);

    let managed_root = temp_root("managed_peer_cancel_conflict");
    seed_direct_with_orchestrator_session_with_base_url(
        &managed_root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let managed_manager = test_manager(&managed_root);
    let orchestrator = managed_manager
        .create_managed_orchestrator_session("delegating", "peer work")
        .await
        .unwrap();
    let store_path = managed_root.join("store.db");
    nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator,
        "peer-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            &orchestrator,
            0,
            &Message::User {
                content: "peer is working".to_string(),
            },
            "peer-run",
        )
        .unwrap();
    let managed_lease =
        sessions::SessionOperationLease::try_acquire(&store_path, &orchestrator).unwrap();
    let managed_error = tokio::time::timeout(
        Duration::from_secs(1),
        managed_manager
            .delegation()
            .cancel_managed_orchestrator("delegating", &orchestrator),
    )
    .await
    .expect("peer-owned managed cancellation must not hang")
    .unwrap_err();
    assert!(
        managed_error
            .to_string()
            .contains("running in another process"),
        "unexpected managed cancellation error: {managed_error:#}"
    );
    drop(managed_lease);

    let _ = std::fs::remove_dir_all(direct_root);
    let _ = std::fs::remove_dir_all(managed_root);
}

#[tokio::test]
async fn workspace_mutation_admission_holds_every_shared_session_lease() {
    let root = temp_root("workspace_mutation_leases");
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init"]);
    git(&["config", "user.name", "NAC Test"]);
    git(&["config", "user.email", "nac@example.invalid"]);
    std::fs::write(root.join("tracked.txt"), b"base\n").unwrap();
    git(&["add", "tracked.txt"]);
    git(&["commit", "-m", "base"]);
    seed_direct_session(&root, "session-a");
    seed_direct_session(&root, "session-b");
    let manager = test_manager(&root);

    let admission = manager
        .workspace()
        .idle_workspace_root("session-a")
        .await
        .unwrap();
    assert_eq!(
        admission.target.root().canonicalize().unwrap(),
        root.canonicalize().unwrap()
    );
    let workspace_identity = admission.target.lease_identity();
    assert!(matches!(
        sessions::WorkspaceActivityLease::try_acquire(&root.join("store.db"), &workspace_identity),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    for session_id in ["session-a", "session-b"] {
        assert!(matches!(
            sessions::SessionOperationLease::try_acquire(&root.join("store.db"), session_id),
            Err(sessions::SessionOperationLeaseError::Busy(_))
        ));
    }
    drop(admission);
    drop(
        sessions::WorkspaceActivityLease::try_acquire(&root.join("store.db"), &workspace_identity)
            .unwrap(),
    );
    for session_id in ["session-a", "session-b"] {
        drop(
            sessions::SessionOperationLease::try_acquire(&root.join("store.db"), session_id)
                .unwrap(),
        );
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cancelled_workspace_request_keeps_leases_until_blocking_git_settles() {
    let root = temp_root("cancelled_workspace_mutation_leases");
    let output = std::process::Command::new("git")
        .args(["-C", root.to_str().unwrap(), "init"])
        .output()
        .unwrap();
    assert!(output.status.success());
    seed_direct_session(&root, "session");
    let manager = test_manager(&root);
    let admission = manager
        .workspace()
        .idle_workspace_root("session")
        .await
        .unwrap();
    let workspace_identity = admission.target.lease_identity();
    let store_path = root.join("store.db");
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);

    let request = tokio::spawn(async move {
        application::workspace::WorkspaceApplication::execute_workspace_mutation(
            admission,
            "test workspace mutation failed",
            move |_| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            },
        )
        .await
    });
    started_rx.await.unwrap();
    request.abort();
    assert!(matches!(
        sessions::WorkspaceActivityLease::try_acquire(&store_path, &workspace_identity),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&store_path, "session"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));

    release_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(workspace) =
                sessions::WorkspaceActivityLease::try_acquire(&store_path, &workspace_identity)
            {
                drop(workspace);
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("blocking mutation should eventually release its leases");
    drop(sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_deletion_excludes_late_child_relationship_commit() {
    let root = temp_root("delete_excludes_child_create");
    seed_direct_session(&root, "parent");
    let manager = test_manager(&root);
    let gate = manager.lifecycle_gate("parent");
    let blocker = gate.lock().await;

    let delete_manager = manager.clone();
    let delete = tokio::spawn(async move { delete_manager.delete_session("parent").await });
    tokio::task::yield_now().await;
    let create_manager = manager.clone();
    let create = tokio::spawn(async move {
        create_manager
            .create_traditional_child_session("parent", "general", "must not be orphaned")
            .await
    });
    tokio::task::yield_now().await;
    assert!(!delete.is_finished());
    assert!(!create.is_finished());

    drop(blocker);
    delete.await.unwrap().unwrap();
    let error = create.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("was not found"), "{error:#}");
    assert!(sessions::list_sessions(&root.join("store.db"))
        .unwrap()
        .into_iter()
        .all(|session| session.session_id != "parent"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn operation_lease_store_failures_are_path_safe_for_submit_patch_and_delete_apis() {
    const CANARY: &str = "operation_lease_private_path_canary";
    let root = temp_root(CANARY);
    seed_editable_session(&root, "session");
    let lock_dir = poison_operation_lease_directory(&root);
    let app = router(test_manager(&root));

    for (method, uri, body) in [
        (
            "POST",
            "/sessions/session/runs",
            Some(r#"{"prompt":"must not run"}"#),
        ),
        (
            "PATCH",
            "/sessions/session/config",
            Some(r#"{"model":"must-not-change"}"#),
        ),
        ("DELETE", "/sessions/session", None),
    ] {
        let mut request = Request::builder().method(method).uri(uri);
        if body.is_some() {
            request = request.header(header::CONTENT_TYPE, "application/json");
        }
        let response = app
            .clone()
            .oneshot(
                request
                    .body(body.map_or_else(Body::empty, Body::from))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::INTERNAL_SERVER_ERROR,
            "{uri}"
        );
        let response = response_json(response).await;
        assert_eq!(
            response,
            serde_json::json!({"error": "session operation lease failed"}),
            "{uri}"
        );
        assert!(!response.to_string().contains(CANARY), "{uri}");
        assert!(
            !response.to_string().contains(&root.display().to_string()),
            "{uri}"
        );
    }

    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.model, "model-a");
    assert!(lock_dir.is_file());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn server_attach_ignores_invalid_ambient_model_but_create_remains_strict() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("persisted_attach_invalid_ambient_model");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    std::fs::write(
        nac_home.join("config.toml"),
        r#"
[model]
backend = "auto"
api_key_env = ["invalid-selector-shape"]
extra_headers = "invalid-header-shape"

[worker]
thread_timeout_secs = 7200
"#,
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-resume-key"));
    seed_editable_session(&root, "persisted");

    // Server startup, listing, and attachment use only non-model ambient
    // settings; the model tuple and selector come from the stored snapshot.
    let manager = test_manager(&root);
    assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);
    let resumed = manager.snapshot("persisted").await.unwrap();
    assert_eq!(resumed.metadata.session_id.as_deref(), Some("persisted"));

    // A new session still parses the complete model table before doing any
    // persistence, so the same obsolete config remains an actionable error.
    let error = manager
        .create_session(CreateSessionRequest {
            cwd: Some(root.clone()),
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("failed to parse config"),
        "{error:#}"
    );
    assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn rebuilt_manager_recovers_interrupted_run_once_and_rotates_event_epoch() {
    let root = temp_root("interrupted_run_restart");
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("restart-test-key"));
    seed_editable_session(&root, "session");
    let store_path = root.join("store.db");
    let writer = nac_core::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append_run_prompt(
            "session",
            0,
            &nac_core::types::Message::User {
                content: "persisted before process death".to_string(),
            },
            "run-before-restart",
        )
        .unwrap();

    let first_manager = test_manager(&root);
    let first = first_manager.snapshot("session").await.unwrap();
    assert_eq!(
            first.transcript_recovery_warning.as_deref(),
            Some(
                "The previous run was interrupted when the nac process stopped. Resubmit the prompt to continue."
            )
        );
    assert_eq!(
        first
            .messages
            .iter()
            .filter(|message| matches!(
                message,
                nac_core::types::Message::User { content }
                    if content == "persisted before process death"
            ))
            .count(),
        1
    );
    let first_recovery_events = first_manager
        .recent_events("session", None, 64)
        .await
        .unwrap()
        .1;
    assert_eq!(
        first_recovery_events
            .iter()
            .filter(|envelope| {
                envelope.run_id.as_ref().map(|run_id| run_id.as_str()) == Some("run-before-restart")
                    && matches!(
                        envelope.event,
                        nac_core::events::SessionEvent::RunFailed { .. }
                    )
            })
            .count(),
        1
    );
    let first_epoch = first.thread_event_boundary.epoch_id;
    drop(first_manager);

    let second_manager = test_manager(&root);
    let second = second_manager.snapshot("session").await.unwrap();
    assert_eq!(
        second.transcript_recovery_warning,
        first.transcript_recovery_warning
    );
    assert_ne!(second.thread_event_boundary.epoch_id, first_epoch);
    assert!(
        second_manager
            .recent_events("session", None, 64)
            .await
            .unwrap()
            .1
            .iter()
            .all(|envelope| !matches!(
                envelope.event,
                nac_core::events::SessionEvent::RunFailed { .. }
            )),
        "idempotent rebuild must not synthesize another terminal event"
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cached_manager_snapshot_reconciles_peer_interruption_once() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cached_peer_snapshot");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("cached-snapshot-key"));
    seed_editable_session(&root, "session");
    let store_path = root.join("store.db");
    let manager = test_manager(&root);
    let cached = manager.attach_session("session").await.unwrap();

    let peer_lease = sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            "session",
            0,
            &nac_core::types::Message::User {
                content: "committed by peer".to_string(),
            },
            "peer-run",
        )
        .unwrap();
    drop(peer_lease);

    let recovered = manager.snapshot("session").await.unwrap();
    assert_eq!(
            recovered.transcript_recovery_warning.as_deref(),
            Some(
                "The previous run was interrupted when the nac process stopped. Resubmit the prompt to continue."
            )
        );
    assert!(matches!(
        recovered.messages.last(),
        Some(nac_core::types::Message::User { content }) if content == "committed by peer"
    ));
    let mapped = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(Arc::ptr_eq(&mapped, &cached));
    assert!(
        !cached
            .has_unreconciled_durable_run_recovery()
            .expect("recovery lookup should succeed"),
        "the cached service must not rehydrate the same recovery row again"
    );

    let recovery_events = manager.recent_events("session", None, 64).await.unwrap().1;
    assert_eq!(
        recovery_events
            .iter()
            .filter(|envelope| {
                envelope.run_id.as_ref().map(|run_id| run_id.as_str()) == Some("peer-run")
                    && matches!(
                        envelope.event,
                        nac_core::events::SessionEvent::RunFailed { .. }
                    )
            })
            .count(),
        1
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cached_manager_reconciles_peer_interruption_before_resubmission() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cached_peer_interruption");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("cached-recovery-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let store_path = root.join("store.db");
    let manager = test_manager(&root);
    let cached = manager.attach_session("session").await.unwrap();

    let peer_lease = sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            "session",
            0,
            &nac_core::types::Message::User {
                content: "committed by peer".to_string(),
            },
            "peer-run",
        )
        .unwrap();
    drop(peer_lease);

    let submitted = manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "continue after peer".to_string(),
            },
        )
        .await
        .unwrap();
    let mut continued = false;
    for _ in 0..100 {
        let messages = cached.messages_snapshot().await.unwrap();
        if messages.iter().any(|message| {
            matches!(
                message,
                nac_core::types::Message::User { content }
                    if content == "continue after peer"
            )
        }) {
            continued = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(continued, "replacement prompt never committed");
    assert_eq!(
        cached.active_run().unwrap().run_id.as_str(),
        submitted.run_id
    );
    let mapped = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(
        Arc::ptr_eq(&mapped, &cached),
        "recovery must preserve the cached service's event bus and subscribers"
    );
    let recovery_events = manager.recent_events("session", None, 64).await.unwrap().1;
    assert_eq!(
        recovery_events
            .iter()
            .filter(|envelope| {
                envelope.run_id.as_ref().map(|run_id| run_id.as_str()) == Some("peer-run")
                    && matches!(
                        envelope.event,
                        nac_core::events::SessionEvent::RunFailed { .. }
                    )
            })
            .count(),
        1
    );
    assert!(
        cached
            .has_unreconciled_durable_run_recovery()
            .expect("recovery lookup should succeed"),
        "the replacement run must own a new durable recovery row"
    );

    manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn incomplete_persisted_settings_are_listed_retrievable_and_transactionally_repairable() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("repair_incomplete_settings");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-repair-key"));
    let store_path = root.join("store.db");

    seed_editable_session(&root, "complete");
    seed_session(&root, "missing-selector", "2026-01-02 00:00:00.000000000");
    // A missing selector stays incomplete only when conventional-var
    // auto-selection cannot repair it: deepseek's conventional variable
    // is cleared in this environment (openai's is set and would
    // auto-select).
    let mut missing_selector = sessions::load_session(&store_path, "missing-selector").unwrap();
    missing_selector.backend = BackendKind::DeepSeekChat;
    missing_selector.base_url = "https://api.deepseek.com".to_string();
    sessions::update_session_config(&store_path, &missing_selector).unwrap();
    seed_session(
        &root,
        "missing-environment-value",
        "2026-01-03 00:00:00.000000000",
    );
    let mut missing_value =
        sessions::load_session(&store_path, "missing-environment-value").unwrap();
    missing_value.api_key_env = Some("MISSING_SERVER_REPAIR_KEY".to_string());
    sessions::update_session_config(&store_path, &missing_value).unwrap();

    seed_session(
        &root,
        "unavailable-managed-auth",
        "2026-01-04 00:00:00.000000000",
    );
    let mut unavailable_auth =
        sessions::load_session(&store_path, "unavailable-managed-auth").unwrap();
    unavailable_auth.backend = BackendKind::ArceeAuth;
    unavailable_auth.base_url = "https://api.arcee.ai".to_string();
    unavailable_auth.api_key_env = None;
    sessions::update_session_config(&store_path, &unavailable_auth).unwrap();

    let manager = test_manager(&root);
    let Json(endpoint_config) = session_config_handler(
        State(manager.clone()),
        AxumPath("missing-selector".to_string()),
    )
    .await
    .unwrap();
    assert_eq!(endpoint_config.session_id, "missing-selector");
    assert!(!serde_json::to_string(&endpoint_config)
        .unwrap()
        .contains("server-repair-key"));

    let listed = manager.list_sessions(false).await.unwrap();
    let listed_ids = listed
        .iter()
        .map(|entry| entry.summary.session_id.as_str())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(listed_ids.len(), 4);
    for expected in [
        "complete",
        "missing-selector",
        "missing-environment-value",
        "unavailable-managed-auth",
    ] {
        assert!(
            listed_ids.contains(expected),
            "missing listed session {expected}"
        );
    }

    let missing_selector = manager.session_config("missing-selector").unwrap();
    assert_eq!(missing_selector.backend.as_deref(), Some("deepseek-chat"));
    assert_eq!(missing_selector.api_key_env, None);
    let missing_environment = manager.session_config("missing-environment-value").unwrap();
    assert_eq!(
        missing_environment.api_key_env.as_deref(),
        Some("MISSING_SERVER_REPAIR_KEY")
    );
    let unavailable_managed = manager.session_config("unavailable-managed-auth").unwrap();
    assert_eq!(unavailable_managed.backend.as_deref(), Some("arcee-auth"));
    assert_eq!(unavailable_managed.api_key_env, None);
    assert!(
        manager.inner.active_sessions.read().await.is_empty(),
        "reading persisted settings must not attach any session"
    );

    for session_id in [
        "missing-selector",
        "missing-environment-value",
        "unavailable-managed-auth",
    ] {
        let error = manager.snapshot(session_id).await.unwrap_err();
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    }
    assert!(manager.inner.active_sessions.read().await.is_empty());

    for session_id in ["missing-selector", "missing-environment-value"] {
        manager
            .update_session_config(
                session_id,
                UpdateConfigRequest {
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("API-key session should be repairable with an available selector");
        assert_eq!(
            manager
                .session_config(session_id)
                .unwrap()
                .api_key_env
                .as_deref(),
            Some("OPENAI_API_KEY")
        );
    }

    manager
        .update_session_config(
            "unavailable-managed-auth",
            UpdateConfigRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai/api".to_string()),
                backend: RequestField::Value("arcee-api".to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("unavailable managed auth should be repairable by switching credential mode");
    let repaired_auth = manager.session_config("unavailable-managed-auth").unwrap();
    assert_eq!(repaired_auth.backend.as_deref(), Some("arcee-api"));
    assert_eq!(repaired_auth.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

    let before_failed_repair = manager.session_config("missing-selector").unwrap();
    let error = manager
        .update_session_config(
            "missing-selector",
            UpdateConfigRequest {
                api_key_env: RequestField::Value("MISSING_SERVER_REPAIR_KEY".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap_err();
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    assert_eq!(
        manager.session_config("missing-selector").unwrap(),
        before_failed_repair,
        "failed repair must leave persisted settings unchanged"
    );

    let listed_after_repairs = manager.list_sessions(false).await.unwrap();
    assert_eq!(listed_after_repairs.len(), 4);
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn structurally_invalid_raw_settings_require_explicit_transactional_repair() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("repair_structurally_invalid_settings");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-repair-key"));
    let store_path = root.join("store.db");
    for id in ["healthy", "auto", "arcee", "missing", "effort", "headers"] {
        seed_editable_session(&root, id);
    }
    for id in ["auto", "arcee", "missing", "effort", "headers"] {
        let mut raw = sessions::load_session_config(&store_path, id).unwrap();
        match id {
            "auto" => raw.backend = Some("auto".to_string()),
            "arcee" => raw.backend = Some("arcee".to_string()),
            "missing" => raw.backend = None,
            "effort" => raw.reasoning_effort = Some("ultra".to_string()),
            "headers" => raw.extra_headers_json = Some("{broken".to_string()),
            _ => unreachable!(),
        }
        sessions::update_raw_session_config(&store_path, &raw).unwrap();
    }

    let manager = test_manager(&root);
    let listed = manager.list_sessions(false).await.unwrap();
    assert_eq!(listed.len(), 6);
    assert_eq!(
        listed
            .iter()
            .find(|entry| entry.summary.session_id == "healthy")
            .unwrap()
            .summary
            .model_config_error,
        None
    );
    for id in ["auto", "arcee", "missing", "effort", "headers"] {
        assert!(
            listed
                .iter()
                .find(|entry| entry.summary.session_id == id)
                .unwrap()
                .summary
                .model_config_error
                .is_some(),
            "{id} should be diagnosed without breaking listing"
        );
    }

    let raw_auto = manager.session_config("auto").unwrap();
    assert_eq!(raw_auto.backend.as_deref(), Some("auto"));
    assert!(!raw_auto.diagnostics.is_empty());
    let raw_missing = manager.session_config("missing").unwrap();
    assert_eq!(raw_missing.backend, None);
    let raw_effort = manager.session_config("effort").unwrap();
    assert_eq!(raw_effort.reasoning_effort.as_deref(), Some("ultra"));
    let raw_headers = manager.session_config("headers").unwrap();
    assert_eq!(raw_headers.extra_headers_json.as_deref(), Some("{broken"));
    let Json(endpoint_headers) =
        session_config_handler(State(manager.clone()), AxumPath("headers".to_string()))
            .await
            .unwrap();
    assert_eq!(endpoint_headers, raw_headers);
    assert!(manager.inner.active_sessions.read().await.is_empty());

    let before_failed = raw_auto.clone();
    let error = manager
        .update_session_config(
            "auto",
            UpdateConfigRequest {
                model: RequestField::Value("replacement-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap_err();
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    assert_eq!(manager.session_config("auto").unwrap(), before_failed);

    for id in ["auto", "arcee", "missing"] {
        manager
            .update_session_config(
                id,
                UpdateConfigRequest {
                    backend: RequestField::Value("openai-responses".to_string()),
                    model: RequestField::Value("replacement-model".to_string()),
                    base_url: RequestField::Value("https://api.openai.com/v1".to_string()),
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap();
    }
    manager
        .update_session_config(
            "effort",
            UpdateConfigRequest {
                reasoning_effort: RequestField::Null,
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap();
    manager
        .update_session_config(
            "headers",
            UpdateConfigRequest {
                extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                    "X-Repaired".to_string(),
                    "yes".to_string(),
                )]))),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap();

    for id in ["auto", "arcee", "missing", "effort", "headers"] {
        let repaired = manager.session_config(id).unwrap();
        assert!(
            repaired.diagnostics.is_empty(),
            "{id}: {:?}",
            repaired.diagnostics
        );
        assert_eq!(repaired.config_version, 2);
        sessions::load_session(&store_path, id).expect("repaired row must strictly load");
    }
    assert_eq!(
        manager
            .session_config("headers")
            .unwrap()
            .extra_headers_json
            .as_deref(),
        Some("{\"X-Repaired\":\"yes\"}")
    );
    let _ = std::fs::remove_dir_all(root);
}

async fn point_session_at_hanging_endpoint(
    root: &std::path::Path,
    session_id: &str,
) -> tokio::task::JoinHandle<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mut snapshot = sessions::load_session(&root.join("store.db"), session_id).unwrap();
    snapshot.base_url = format!("http://{address}/v1");
    sessions::update_session_config(&root.join("store.db"), &snapshot).unwrap();

    tokio::spawn(async move {
        if let Ok((socket, _)) = listener.accept().await {
            let _socket = socket;
            std::future::pending::<()>().await;
        }
    })
}

#[tokio::test]
async fn steering_routes_reject_blank_before_lookup_and_keep_inactive_conflicts() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("steering_validation");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let app = router(test_manager(&root));

    for (uri, instruction, expected) in [
        (
            "/sessions/missing/steering",
            "  \n ",
            StatusCode::BAD_REQUEST,
        ),
        (
            "/sessions/missing/threads/worker/steering",
            "\t",
            StatusCode::BAD_REQUEST,
        ),
        (
            "/sessions/session/steering",
            "redirect",
            StatusCode::CONFLICT,
        ),
        (
            "/sessions/session/threads/worker/steering",
            "redirect",
            StatusCode::CONFLICT,
        ),
    ] {
        let request = Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({ "instruction": instruction }).to_string(),
            ))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), expected, "{uri}: {instruction:?}");
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn active_run_accepts_orchestrator_steering() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("orchestrator_steering");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);

    manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "begin the original task".to_string(),
            },
        )
        .await
        .unwrap();
    let steering = manager
        .queue_orchestrator_steering(
            "session",
            OrchestratorSteeringRequest {
                instruction: "change direction".to_string(),
            },
        )
        .await
        .unwrap();
    assert_eq!(steering.status, "queued");
    let records = manager.snapshot("session").await.unwrap().thread_steering;
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].thread_name, "__orchestrator__");
    assert_eq!(records[0].instruction, "change direction");

    manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cancel_active_run_route_is_idempotent() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cancel_idempotent");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);
    let service = manager.attach_session("session").await.unwrap();
    manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "begin the original task".to_string(),
            },
        )
        .await
        .unwrap();
    let app = router(manager);
    let request = || {
        Request::builder()
            .method("POST")
            .uri("/sessions/session/cancel-active-run")
            .body(Body::empty())
            .unwrap()
    };

    let (first, second) = tokio::join!(
        app.clone().oneshot(request()),
        app.clone().oneshot(request())
    );
    assert_eq!(first.unwrap().status(), StatusCode::ACCEPTED);
    assert_eq!(second.unwrap().status(), StatusCode::ACCEPTED);
    assert_eq!(
        app.clone().oneshot(request()).await.unwrap().status(),
        StatusCode::ACCEPTED
    );

    let terminal_events = service
        .recent_events(None, 64)
        .1
        .into_iter()
        .filter(|envelope| {
            matches!(
                envelope.event,
                nac_core::events::SessionEvent::RunCompleted { .. }
                    | nac_core::events::SessionEvent::RunFailed { .. }
                    | nac_core::events::SessionEvent::RunCancelled
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(terminal_events.len(), 1);
    assert_eq!(
        terminal_events[0].event,
        nac_core::events::SessionEvent::RunCancelled
    );
    assert!(service.active_run().is_none());
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn deletion_winning_lifecycle_gate_prevents_late_submission_recreation() {
    let root = temp_root("delete_before_submit");
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);
    let gate = manager.lifecycle_gate("session");
    let blocker = gate.lock().await;

    let (delete_started_tx, delete_started_rx) = tokio::sync::oneshot::channel();
    let delete_manager = manager.clone();
    let delete = tokio::spawn(async move {
        delete_started_tx.send(()).unwrap();
        delete_manager.delete_session("session").await
    });
    delete_started_rx.await.unwrap();
    tokio::task::yield_now().await;

    let submit_manager = manager.clone();
    let submit = tokio::spawn(async move {
        submit_manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "must not revive deleted state".to_string(),
                },
            )
            .await
    });
    tokio::task::yield_now().await;
    assert!(!delete.is_finished());
    assert!(!submit.is_finished());

    drop(blocker);
    tokio::time::timeout(Duration::from_secs(2), delete)
        .await
        .expect("delete should acquire the lifecycle gate")
        .unwrap()
        .unwrap();
    let error = tokio::time::timeout(Duration::from_secs(2), submit)
        .await
        .expect("submission should observe the deletion")
        .unwrap()
        .unwrap_err();
    assert!(error.to_string().contains("was not found"), "{error:#}");
    assert!(sessions::load_session(&root.join("store.db"), "session").is_err());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn submission_winning_lifecycle_gate_makes_concurrent_patch_reject_busy() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("submit_before_patch");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);
    let original_service = manager.attach_session("session").await.unwrap();

    let gate = manager.lifecycle_gate("session");
    let blocker = gate.lock().await;
    let (submit_started_tx, submit_started_rx) = tokio::sync::oneshot::channel();
    let submit_manager = manager.clone();
    let submit = tokio::spawn(async move {
        submit_started_tx.send(()).unwrap();
        submit_manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "hold this run open".to_string(),
                },
            )
            .await
    });
    submit_started_rx.await.unwrap();
    tokio::task::yield_now().await;

    let (patch_started_tx, patch_started_rx) = tokio::sync::oneshot::channel();
    let patch_manager = manager.clone();
    let patch = tokio::spawn(async move {
        patch_started_tx.send(()).unwrap();
        patch_manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("model-after-update".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
    });
    patch_started_rx.await.unwrap();
    tokio::task::yield_now().await;
    assert!(!submit.is_finished());
    assert!(!patch.is_finished());

    drop(blocker);
    let submitted = tokio::time::timeout(Duration::from_secs(2), submit)
        .await
        .expect("submission should acquire the gate")
        .unwrap()
        .unwrap();
    let patch_error = tokio::time::timeout(Duration::from_secs(2), patch)
        .await
        .expect("patch should run after submission")
        .unwrap()
        .unwrap_err();
    assert!(patch_error
        .to_string()
        .contains("busy with an active operation"));
    assert_eq!(ApiError::from(patch_error).status, StatusCode::CONFLICT);
    assert_eq!(
        sessions::load_session(&root.join("store.db"), "session")
            .unwrap()
            .model,
        "model-a"
    );
    let mapped = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(Arc::ptr_eq(&mapped, &original_service));
    assert_eq!(
        mapped.active_run().unwrap().run_id.as_str(),
        submitted.run_id
    );

    manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn patch_winning_lifecycle_gate_evicts_before_concurrent_submission_attaches() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("patch_before_submit");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);
    let stale_service = manager.attach_session("session").await.unwrap();

    let gate = manager.lifecycle_gate("session");
    let blocker = gate.lock().await;
    let (patch_started_tx, patch_started_rx) = tokio::sync::oneshot::channel();
    let patch_manager = manager.clone();
    let patch = tokio::spawn(async move {
        patch_started_tx.send(()).unwrap();
        patch_manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("model-after-update".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
    });
    patch_started_rx.await.unwrap();
    tokio::task::yield_now().await;

    let (submit_started_tx, submit_started_rx) = tokio::sync::oneshot::channel();
    let submit_manager = manager.clone();
    let submit = tokio::spawn(async move {
        submit_started_tx.send(()).unwrap();
        submit_manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "use committed settings".to_string(),
                },
            )
            .await
    });
    submit_started_rx.await.unwrap();
    tokio::task::yield_now().await;
    assert!(!patch.is_finished());
    assert!(!submit.is_finished());

    drop(blocker);
    tokio::time::timeout(Duration::from_secs(2), patch)
        .await
        .expect("patch should acquire the gate")
        .unwrap()
        .unwrap();
    let submitted = tokio::time::timeout(Duration::from_secs(2), submit)
        .await
        .expect("submission should run after patch")
        .unwrap()
        .unwrap();
    let mapped = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(!Arc::ptr_eq(&mapped, &stale_service));
    assert_eq!(mapped.metadata().model, "model-after-update");
    assert!(stale_service.active_run().is_none());
    assert_eq!(
        mapped.active_run().unwrap().run_id.as_str(),
        submitted.run_id
    );
    assert_eq!(
        sessions::load_session(&root.join("store.db"), "session")
            .unwrap()
            .model,
        "model-after-update"
    );

    manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn external_active_operation_lease_rejects_patch_from_independent_manager() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("external_active_patch");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let running_manager = test_manager(&root);
    let patch_manager = test_manager(&root);

    running_manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "hold cross-process lease".to_string(),
            },
        )
        .await
        .expect("first manager starts run");
    let before = sessions::load_session(&root.join("store.db"), "session").unwrap();

    let error = patch_manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("must-not-commit".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect_err("PATCH cannot commit beneath another process run");
    assert!(error.to_string().contains("busy with an active operation"));
    assert_eq!(ApiError::from(error).status, StatusCode::CONFLICT);
    let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(after.model, before.model);
    assert_eq!(after.config_version, before.config_version);
    assert!(!patch_manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));

    running_manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn stale_manager_rebuilds_all_model_authority_after_external_patch() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("external_patch_rebuild");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe { std::env::set_var("SECOND_API_KEY", "second-server-key") };
    seed_editable_session(&root, "session");
    let stale_manager = test_manager(&root);
    let patch_manager = test_manager(&root);
    let stale_service = stale_manager.attach_session("session").await.unwrap();
    assert_eq!(stale_service.config_version(), Some(0));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let new_base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let endpoint = tokio::spawn(async move {
        if let Ok((socket, _)) = listener.accept().await {
            let _socket = socket;
            std::future::pending::<()>().await;
        }
    });
    let new_headers = BTreeMap::from([
        ("X-Cross-Process".to_string(), "current".to_string()),
        ("X-Revision".to_string(), "1".to_string()),
    ]);
    patch_manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("model-from-other-manager".to_string()),
                base_url: RequestField::Value(new_base_url.clone()),
                backend: RequestField::Value("openai-responses".to_string()),
                reasoning_effort: RequestField::Value("high".to_string()),
                api_key_env: RequestField::Value("SECOND_API_KEY".to_string()),
                extra_headers: RequestField::Value(HeadersRequest(new_headers.clone())),
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
            },
        )
        .await
        .expect("external manager commits complete model settings");
    assert_eq!(stale_service.metadata().model, "model-a");

    let submitted = stale_manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "must use externally committed authority".to_string(),
            },
        )
        .await
        .expect("stale manager converges before starting the next run");
    let current_service = stale_manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(!Arc::ptr_eq(&current_service, &stale_service));
    assert_eq!(current_service.config_version(), Some(1));
    let metadata = current_service.metadata();
    assert_eq!(metadata.model, "model-from-other-manager");
    assert_eq!(metadata.base_url, new_base_url);
    assert_eq!(metadata.backend, "openai-responses");
    assert_eq!(metadata.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(metadata.api_key_env.as_deref(), Some("SECOND_API_KEY"));
    assert_eq!(metadata.extra_headers, new_headers);
    assert_eq!(
        current_service.active_run().unwrap().run_id.as_str(),
        submitted.run_id
    );
    assert!(stale_service.active_run().is_none());

    stale_manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn ordinary_attachment_does_not_open_operation_lease_sidecar() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("attachment_without_effort_migration");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe { std::env::set_var("ANTHROPIC_API_KEY", "server-test-key") };
    let snapshot = sessions::new_snapshot(
        "session".to_string(),
        root.clone(),
        "claude-sonnet-4-6-20251001".to_string(),
        "https://api.anthropic.com/v1".to_string(),
        BackendKind::AnthropicMessages,
        Some(ReasoningEffort::High),
        None,
        None,
        Vec::new(),
        Some("ANTHROPIC_API_KEY".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    std::fs::write(root.join("store.db.run-locks"), b"unavailable").unwrap();
    let manager = test_manager(&root);

    let first = manager.attach_session("session").await.unwrap();
    let second = manager.attach_session("session").await.unwrap();
    assert!(Arc::ptr_eq(&first, &second));
    assert_eq!(first.config_version(), Some(0));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn attachment_takes_resource_lease_before_sandbox_materialization() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("attachment_resource_lease_order");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe { std::env::set_var("ANTHROPIC_API_KEY", "server-test-key") };
    let mut snapshot = sessions::new_snapshot(
        "session".to_string(),
        root.clone(),
        "claude-sonnet-4-6-20251001".to_string(),
        "https://api.anthropic.com/v1".to_string(),
        BackendKind::AnthropicMessages,
        Some(ReasoningEffort::High),
        None,
        None,
        Vec::new(),
        Some("ANTHROPIC_API_KEY".to_string()),
        BTreeMap::new(),
    );
    nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
    snapshot.behavior = sessions::SessionBehavior::Direct;
    let store_path = root.join("store.db");
    sessions::create_session(&store_path, &snapshot).unwrap();
    let mutation =
        sessions::SessionResourceMutationLease::try_acquire(&store_path, "session").unwrap();
    let manager = test_manager(&root);

    let error = match manager.attach_session("session").await {
        Ok(_) => panic!("exclusive deletion authority must precede Podman inspection"),
        Err(error) => error,
    };
    assert!(error.to_string().contains("busy with an active operation"));
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));

    drop(mutation);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn busy_attachment_is_transient_and_next_attach_observes_durable_config() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("busy_transient_effort_recovery");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    unsafe { std::env::set_var("ANTHROPIC_API_KEY", "server-test-key") };
    let snapshot = sessions::new_snapshot(
        "session".to_string(),
        root.clone(),
        "claude-sonnet-4-6-20251001".to_string(),
        "https://api.anthropic.com/v1".to_string(),
        BackendKind::AnthropicMessages,
        Some(ReasoningEffort::Xhigh),
        None,
        None,
        Vec::new(),
        Some("ANTHROPIC_API_KEY".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    let lease =
        sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "session").unwrap();
    let reader = test_manager(&root);
    let writer = test_manager(&root);

    let transient = reader.attach_session("session").await.unwrap();
    assert_eq!(
        transient.metadata().reasoning_effort.as_deref(),
        Some("high")
    );
    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Xhigh));
    assert_eq!(stored.config_version, 0);

    drop(lease);
    writer
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("claude-opus-4-6".to_string()),
                reasoning_effort: RequestField::Value("high".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap();

    let current = reader.attach_session("session").await.unwrap();
    assert_eq!(current.metadata().model, "claude-opus-4-6");
    assert_eq!(current.metadata().reasoning_effort.as_deref(), Some("high"));
    assert_eq!(current.config_version(), Some(1));
    let cached = reader.attach_session("session").await.unwrap();
    assert!(Arc::ptr_eq(&current, &cached));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn independent_manager_patch_rejects_held_shared_lease() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cross_manager_config_lease");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let first_manager = test_manager(&root);
    let second_manager = test_manager(&root);
    let held = sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "session")
        .expect("first process lease");

    let conflict = second_manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("blocked-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect_err("a concurrent shared lease must reject PATCH without waiting");
    assert!(conflict
        .to_string()
        .contains("busy with an active operation"));
    assert_eq!(ApiError::from(conflict).status, StatusCode::CONFLICT);
    assert_eq!(
        sessions::load_session(&root.join("store.db"), "session")
            .unwrap()
            .model,
        "model-a"
    );

    drop(held);
    first_manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("committed-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("dropping the other process lease permits PATCH");
    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.model, "committed-model");
    assert_eq!(stored.config_version, 1);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn independent_manager_patch_rejects_peer_sandbox_resource_lease() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cross_manager_sandbox_resource_lease");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let store_path = root.join("store.db");
    let held = sessions::SessionResourceLease::try_acquire(&store_path, "session")
        .expect("peer attached sandbox lease");
    let manager = test_manager(&root);

    let conflict = manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("blocked-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect_err("peer sandbox ownership must reject config replacement");
    assert_eq!(ApiError::from(conflict).status, StatusCode::CONFLICT);
    assert_eq!(
        sessions::load_session(&store_path, "session")
            .unwrap()
            .model,
        "model-a"
    );

    drop(held);
    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("committed-model".to_string()),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(
        sessions::load_session(&store_path, "session")
            .unwrap()
            .model,
        "committed-model"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn empty_patch_does_not_touch_store_credentials_or_attached_service() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("empty_patch_noop");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);
    let before = manager.attach_session("session").await.unwrap();
    let before_metadata = before.metadata();
    let store_path = root.join("store.db");
    let hidden_store = root.join("store.db.hidden");
    std::fs::rename(&store_path, &hidden_store).unwrap();
    std::fs::create_dir(&store_path).unwrap();
    unsafe { std::env::remove_var("OPENAI_API_KEY") };

    manager
        .update_session_config("session", UpdateConfigRequest::default())
        .await
        .expect("an empty patch must not read the store or credentials");

    let after = manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .expect("empty patch must preserve attached service");
    assert!(Arc::ptr_eq(&before, &after));
    assert_eq!(after.metadata().model, before_metadata.model);
    assert_eq!(after.metadata().base_url, before_metadata.base_url);
    assert_eq!(after.active_run(), None);

    std::fs::remove_dir(&store_path).unwrap();
    std::fs::rename(hidden_store, store_path).unwrap();
    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.model, "model-a");
    assert_eq!(stored.updated_at, "2026-01-01 00:00:00.000000000");
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn create_inherits_overrides_and_null_clears_optional_config() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("create_tristate");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    std::fs::write(
        nac_home.join("config.toml"),
        r#"[model]
model = "gpt-5.2"
reasoning_effort = "medium"
extra_headers = { X-Config = "yes" }

[compaction]
threshold_tokens = 64000
"#,
    )
    .unwrap();
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let manager = test_manager(&root);

    let inherited = manager
        .create_session(CreateSessionRequest::default())
        .await
        .expect("omitted fields should inherit config");
    assert!(inherited.metadata.extra_headers.is_empty());
    let inherited_id = inherited.metadata.session_id.unwrap();
    let stored = sessions::load_session(&root.join("store.db"), &inherited_id).unwrap();
    assert_eq!(stored.behavior, sessions::SessionBehavior::Orchestrator);
    assert_eq!(stored.backend, BackendKind::OpenAiResponses);
    assert_eq!(stored.model, "gpt-5.2");
    assert_eq!(stored.base_url, "https://api.openai.com/v1");
    assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Medium));
    assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    assert_eq!(stored.orchestrator_compaction_threshold, Some(280_000));
    assert_eq!(
        stored.extra_headers,
        BTreeMap::from([("X-Config".to_string(), "yes".to_string())])
    );
    let Json(config) =
        session_config_handler(State(manager.clone()), AxumPath(inherited_id.clone()))
            .await
            .unwrap();
    assert_eq!(
        config.extra_headers_json.as_deref(),
        Some("{\"X-Config\":\"yes\"}")
    );
    assert_eq!(config.orchestrator_compaction_threshold, Some(280_000));
    assert!(manager
        .snapshot(&inherited_id)
        .await
        .unwrap()
        .metadata
        .extra_headers
        .is_empty());

    for behavior in [
        sessions::SessionBehavior::Direct,
        sessions::SessionBehavior::DirectWithOrchestrator,
    ] {
        let direct = manager
            .create_session(CreateSessionRequest {
                behavior,
                ..CreateSessionRequest::default()
            })
            .await
            .expect("an explicitly selected direct behavior should launch");
        assert_eq!(direct.metadata.behavior, behavior);
        let direct_id = direct.metadata.session_id.unwrap();
        assert_eq!(
            sessions::load_session(&root.join("store.db"), &direct_id)
                .unwrap()
                .behavior,
            behavior
        );
        assert_eq!(
            manager
                .attach_session(&direct_id)
                .await
                .unwrap()
                .metadata()
                .behavior,
            behavior
        );
    }

    let cleared = manager
        .create_session(CreateSessionRequest {
            model: RequestField::Value("trinity-large-thinking".to_string()),
            base_url: RequestField::Value("https://api.arcee.ai".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            reasoning_effort: RequestField::Null,
            api_key_env: RequestField::Null,
            extra_headers: RequestField::Null,
            orchestrator_compaction_threshold: RequestField::Null,
            ..CreateSessionRequest::default()
        })
        .await
        .expect("explicit values and null optional fields should override config");
    let cleared_id = cleared.metadata.session_id.unwrap();
    let stored = sessions::load_session(&root.join("store.db"), &cleared_id).unwrap();
    assert_eq!(stored.backend, BackendKind::ArceeAuth);
    assert_eq!(stored.model, "trinity-large-thinking");
    assert_eq!(stored.reasoning_effort, None);
    assert_eq!(stored.api_key_env, None);
    assert!(stored.extra_headers.is_empty());
    assert_eq!(stored.orchestrator_compaction_threshold, None);

    let zero_disabled = manager
        .create_session(CreateSessionRequest {
            model: RequestField::Value("trinity-large-thinking".to_string()),
            base_url: RequestField::Value("https://api.arcee.ai".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            reasoning_effort: RequestField::Null,
            api_key_env: RequestField::Null,
            extra_headers: RequestField::Null,
            orchestrator_compaction_threshold: RequestField::Value(0),
            ..CreateSessionRequest::default()
        })
        .await
        .expect("zero should disable an inherited compaction threshold");
    let zero_disabled_id = zero_disabled.metadata.session_id.unwrap();
    assert_eq!(
        sessions::load_session(&root.join("store.db"), &zero_disabled_id)
            .unwrap()
            .orchestrator_compaction_threshold,
        None
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn openai_config_launch_switch_to_arcee_normalizes_the_managed_tuple() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("openai_to_arcee_launch");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    std::fs::write(
        nac_home.join("config.toml"),
        r#"[model]
model = "gpt-5.2"
"#,
    )
    .unwrap();
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let manager = test_manager(&root);

    let created = manager
        .create_session(CreateSessionRequest {
            model: RequestField::Value("trinity-large-thinking".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            ..CreateSessionRequest::default()
        })
        .await
        .expect("an explicit managed launch materializes its canonical tuple");
    assert_eq!(
        created.metadata.base_url,
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(created.metadata.api_key_env, None);

    let session_id = created.metadata.session_id.unwrap();
    let stored = sessions::load_session(&root.join("store.db"), &session_id).unwrap();
    assert_eq!(stored.backend, BackendKind::ArceeAuth);
    assert_eq!(
        stored.base_url,
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(stored.api_key_env, None);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn inherited_managed_launches_clear_stale_selectors_and_persist_fixed_bases() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_base_materialization");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    write_codex_auth(&nac_home);
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let manager = test_manager(&root);
    let store_path = root.join("store.db");

    // The full auto-resolution chain end-to-end: a bare configured
    // model resolves its provider through the catalog (gpt-5.2 is
    // unique to openai-responses), the base URL materializes from the
    // catalog endpoint default, and the credential auto-selects the
    // conventional env var — persisted into the session.
    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"gpt-5.2\"\n",
    )
    .unwrap();
    let created = manager
        .create_session(CreateSessionRequest {
            cwd: Some(root.clone()),
            ..CreateSessionRequest::default()
        })
        .await
        .expect("a configured catalog-known model auto-resolves the full tuple");
    assert_eq!(created.metadata.backend, "openai-responses");
    assert_eq!(created.metadata.base_url, "https://api.openai.com/v1");
    assert_eq!(
        created.metadata.api_key_env.as_deref(),
        Some("OPENAI_API_KEY")
    );
    let session_id = created.metadata.session_id.unwrap();
    let stored = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(stored.backend, BackendKind::OpenAiResponses);
    assert_eq!(stored.base_url, "https://api.openai.com/v1");
    assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

    // Force a real persisted-snapshot attach instead of returning the
    // service left in memory by create.
    manager
        .inner
        .active_sessions
        .write()
        .await
        .remove(&session_id);
    let resumed = manager.snapshot(&session_id).await.unwrap();
    assert_eq!(resumed.metadata.base_url, "https://api.openai.com/v1");

    // Managed backends are only reachable through an explicit request
    // backend: every managed model id collides with a non-managed
    // provider's entry (the Trinity ids with arcee-api, the codex seed
    // ids with the openai baseline) and the collision rule prefers the
    // non-managed provider.
    for (backend, model, expected_base) in [
        (
            "arcee-auth",
            "trinity-large-thinking",
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
        ),
        (
            "chatgpt-codex-responses",
            "gpt-5.3-codex-spark",
            nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
        ),
    ] {
        let explicit: CreateSessionRequest = serde_json::from_value(serde_json::json!({
            "cwd": root,
            "backend": backend,
            "model": model,
            "api_key_env": null
        }))
        .unwrap();
        let created = manager
            .create_session(explicit)
            .await
            .unwrap_or_else(|error| panic!("explicit {backend} launch failed: {error:#}"));
        assert_eq!(created.metadata.base_url, expected_base);
        assert_eq!(created.metadata.api_key_env, None);
        let session_id = created.metadata.session_id.unwrap();
        let stored = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(stored.base_url, expected_base);
        assert_eq!(stored.api_key_env, None);

        // An explicit canonical managed base URL remains accepted.
        let canonical: CreateSessionRequest = serde_json::from_value(serde_json::json!({
            "cwd": root,
            "backend": backend,
            "model": model,
            "base_url": expected_base,
            "api_key_env": null
        }))
        .unwrap();
        let created = manager
            .create_session(canonical)
            .await
            .expect("an explicit canonical managed base URL must remain accepted");
        assert_eq!(created.metadata.base_url, expected_base);
    }

    let before_controls = sessions::list_sessions(&store_path).unwrap().len();
    for (backend, invalid_base, expected_error) in [
        (
            "chatgpt-codex-responses",
            "https://attacker.example/backend-api",
            "requires the approved ChatGPT origin",
        ),
        (
            "arcee-auth",
            "https://tenant.arcee.ai/api/v1",
            "does not match the stored credential origin",
        ),
    ] {
        let model = if backend == "arcee-auth" {
            "trinity-large-thinking"
        } else {
            "gpt-5.3-codex-spark"
        };
        let invalid: CreateSessionRequest = serde_json::from_value(serde_json::json!({
            "cwd": root,
            "backend": backend,
            "model": model,
            "base_url": invalid_base
        }))
        .unwrap();
        let error = manager
            .create_session(invalid)
            .await
            .expect_err("a present non-managed origin must not be overwritten by the default");
        assert!(error.to_string().contains(expected_error), "{error:#}");
    }

    // An unknown configured model resolves no provider: the guided
    // missing-backend error surfaces (the frontend renders the
    // from-config selection as unrecognized).
    std::fs::write(
        nac_home.join("config.toml"),
        "[model]\nmodel = \"api-model\"\n",
    )
    .unwrap();
    let error = manager
        .create_session(CreateSessionRequest {
            cwd: Some(root.clone()),
            ..CreateSessionRequest::default()
        })
        .await
        .expect_err("an unknown configured model must not resolve a backend");
    assert!(error.to_string().contains("backend"), "{error:#}");
    assert_eq!(
        sessions::list_sessions(&store_path).unwrap().len(),
        before_controls,
        "mismatch and unresolved failures must not persist sessions"
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn empty_patch_never_repairs_or_revisions_uncached_managed_config() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_base_patch_repair");
    let nac_home = root.join("nac-home");
    write_codex_auth(&nac_home);
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let store_path = root.join("store.db");
    let manager = test_manager(&root);

    for (session_id, backend, expected_base, light_api_key_env) in [
        (
            "repair-codex",
            BackendKind::ChatGptCodexResponses,
            nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
            Some("STALE_API_KEY"),
        ),
        (
            "repair-arcee",
            BackendKind::ArceeAuth,
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
            Some("STALE_API_KEY"),
        ),
        (
            "repair-arcee-without-light-selector",
            BackendKind::ArceeAuth,
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
            None,
        ),
    ] {
        seed_session(&root, session_id, "2026-01-01 00:00:00.000000000");
        let mut incomplete = sessions::load_session(&store_path, session_id).unwrap();
        incomplete.backend = backend;
        if backend == BackendKind::ArceeAuth {
            incomplete.model = "trinity-large-thinking".to_string();
        }
        incomplete.base_url.clear();
        incomplete.api_key_env = Some("STALE_API_KEY".to_string());
        incomplete.light_model = Some(LightModelSettings {
            model: match backend {
                BackendKind::ArceeAuth => "trinity-large-thinking",
                BackendKind::ChatGptCodexResponses => "gpt-5.2-codex",
                _ => unreachable!("test only covers managed backends"),
            }
            .to_string(),
            backend: Some(backend),
            base_url: Some(expected_base.to_string()),
            api_key_env: light_api_key_env.map(str::to_string),
            reasoning_effort: None,
        });
        sessions::update_session_config(&store_path, &incomplete).unwrap();
        let before = sessions::load_session(&store_path, session_id).unwrap();

        manager
            .update_session_config(session_id, UpdateConfigRequest::default())
            .await
            .expect("empty PATCH is a no-op even when legacy managed config needs repair");
        let after = sessions::load_session(&store_path, session_id).unwrap();
        assert_eq!(after.base_url, before.base_url);
        assert_eq!(after.api_key_env, before.api_key_env);
        assert_eq!(after.light_model, before.light_model);
        assert_eq!(after.config_version, before.config_version);
        assert_eq!(after.updated_at, before.updated_at);
    }

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn api_key_settings_switch_to_arcee_normalizes_omitted_managed_endpoint_and_credentials() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("api_key_to_arcee_patch");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let store_path = root.join("store.db");
    let mut api_key_session = sessions::load_session(&store_path, "session").unwrap();
    api_key_session.reasoning_effort = None;
    let inherited_selector = api_key_session
        .api_key_env
        .clone()
        .expect("seeded API-key session has a selector");
    sessions::update_session_config(&store_path, &api_key_session).unwrap();
    let manager = test_manager(&root);

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("arcee-auth".to_string()),
                model: RequestField::Value("trinity-large-thinking".to_string()),
                light_model: RequestField::Value(LightModelSettings {
                    model: "trinity-large-thinking".to_string(),
                    backend: Some(BackendKind::ArceeAuth),
                    base_url: None,
                    api_key_env: Some(inherited_selector),
                    reasoning_effort: None,
                }),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("managed PATCH must normalize its omitted endpoint and credential fields");

    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.backend, BackendKind::ArceeAuth);
    assert_eq!(
        stored.base_url,
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(stored.api_key_env, None);
    assert_eq!(
        stored
            .light_model
            .as_ref()
            .and_then(|light| light.api_key_env.as_deref()),
        None
    );
    let rehydrated = manager.session_config("session").unwrap();
    assert_eq!(rehydrated.backend.as_deref(), Some("arcee-auth"));
    assert_eq!(
        rehydrated.base_url,
        nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
    );
    assert_eq!(rehydrated.api_key_env, None);
    assert_eq!(
        rehydrated
            .light_model
            .as_ref()
            .and_then(|light| light.api_key_env.as_deref()),
        None
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn create_reports_the_missing_light_model_credential() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("create_missing_light_credential");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let manager = test_manager(&root);

    let error = manager
        .create_session(CreateSessionRequest {
            model: RequestField::Value("moonshotai/kimi-k3".to_string()),
            base_url: RequestField::Value("https://api.arcee.ai/api/v1".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            api_key_env: RequestField::Null,
            light_model: RequestField::Value(LightModelSettings {
                model: "deepseek/deepseek-v4-flash-latest".to_string(),
                backend: Some(BackendKind::ArceeApi),
                base_url: Some("https://api.arcee.ai/api/v1".to_string()),
                api_key_env: None,
                reasoning_effort: None,
            }),
            ..CreateSessionRequest::default()
        })
        .await
        .expect_err("an API-key light model without a key must fail creation");
    let response = ApiError::from(error);

    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    assert!(
        response.message.contains("invalid light model settings"),
        "{}",
        response.message
    );
    assert!(
        response.message.contains("api_key_env"),
        "{}",
        response.message
    );
    assert!(
        response.message.contains("ARCEE_API_KEY"),
        "{}",
        response.message
    );
    assert!(manager.list_sessions(false).await.unwrap().is_empty());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn update_reports_the_missing_light_model_credential() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("update_missing_light_credential");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);

    let error = manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                light_model: RequestField::Value(LightModelSettings {
                    model: "deepseek/deepseek-v4-flash-latest".to_string(),
                    backend: Some(BackendKind::ArceeApi),
                    base_url: Some("https://api.arcee.ai/api/v1".to_string()),
                    api_key_env: None,
                    reasoning_effort: None,
                }),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect_err("an API-key light model without a key must fail the update");
    let response = ApiError::from(error);

    assert_eq!(response.status, StatusCode::BAD_REQUEST);
    // Assert the rendered boundary output: the resolver keeps the cause
    // chain intact and the boundary renders it once with `{:#}`, so the
    // response pairs the context with the actionable cause.
    assert!(
        response
            .message
            .starts_with("invalid light model settings: "),
        "{}",
        response.message
    );
    assert!(
        response.message.contains("api_key_env"),
        "{}",
        response.message
    );
    assert!(
        response.message.contains("ARCEE_API_KEY"),
        "{}",
        response.message
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn codex_create_preflights_endpoint_and_managed_credentials_before_persistence() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();

    for (label, base_url, auth, expected_status, expected) in [
        (
            "codex-create-missing",
            "https://chatgpt.com/backend-api",
            None,
            StatusCode::BAD_REQUEST,
            "not configured",
        ),
        (
            "codex-create-malformed",
            "https://chatgpt.com/backend-api",
            Some("{not-json}"),
            StatusCode::BAD_REQUEST,
            "failed to parse",
        ),
        (
            "codex-create-blank",
            "https://chatgpt.com/backend-api",
            Some(
                r#"{"type":"chatgpt-codex","access":"secret-must-not-leak","refresh":"","expires_at_ms":1,"account_id":"account"}"#,
            ),
            StatusCode::BAD_REQUEST,
            "nonblank field 'refresh'",
        ),
        (
            "codex-create-endpoint",
            "http://chatgpt.com/backend-api",
            Some(
                r#"{"type":"chatgpt-codex","access":"a","refresh":"r","expires_at_ms":1,"account_id":"account"}"#,
            ),
            StatusCode::BAD_REQUEST,
            "requires HTTPS",
        ),
    ] {
        let root = temp_root(label);
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        if let Some(auth) = auth {
            write_managed_credential(&nac_home.join("auth.json"), auth);
        }
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);
        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("gpt-test".to_string()),
                base_url: RequestField::Value(base_url.to_string()),
                backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                api_key_env: RequestField::Null,
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("invalid Codex setup must fail creation");
        assert!(error.to_string().contains(expected), "{error:#}");
        assert!(!format!("{error:#}").contains("secret-must-not-leak"));
        assert_eq!(ApiError::from(error).status, expected_status);
        assert!(!root.join("store.db").exists());
        drop(_env);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let root = temp_root("codex-create-symlink");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let target = nac_home.join("target.json");
        std::fs::write(&target, "secret-target").unwrap();
        symlink(&target, nac_home.join("auth.json")).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);
        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("gpt-test".to_string()),
                base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                api_key_env: RequestField::Null,
                ..CreateSessionRequest::default()
            })
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
        assert_eq!(
            ApiError::from(error).status,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert!(!root.join("store.db").exists());
        assert_eq!(std::fs::read_to_string(target).unwrap(), "secret-target");
        drop(_env);
        let _ = std::fs::remove_dir_all(root);
    }
}

#[tokio::test]
async fn codex_resume_preflights_missing_credentials() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("codex-resume-missing");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
    let mut stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    stored.backend = BackendKind::ChatGptCodexResponses;
    stored.base_url = "https://chatgpt.com/backend-api".to_string();
    stored.api_key_env = None;
    sessions::update_session_config(&root.join("store.db"), &stored).unwrap();
    let manager = test_manager(&root);

    let error = manager
        .attach_session("session")
        .await
        .err()
        .expect("resume without Codex auth must fail");
    assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
    assert!(error.to_string().contains("not configured"));
    assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn codex_patch_failures_roll_back_database_and_active_service() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("codex-patch-rollback");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);
    manager.attach_session("session").await.unwrap();
    let before = sessions::load_session(&root.join("store.db"), "session").unwrap();

    for (auth, base_url, expected_status) in [
        (
            "{not-json}",
            "https://chatgpt.com/backend-api",
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"type":"chatgpt-codex","access":"a","refresh":"r","expires_at_ms":1,"account_id":"id"}"#,
            "https://attacker.example/backend-api",
            StatusCode::BAD_REQUEST,
        ),
    ] {
        write_managed_credential(&nac_home.join("auth.json"), auth);
        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    base_url: RequestField::Value(base_url.to_string()),
                    api_key_env: RequestField::Null,
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap_err();
        assert_eq!(ApiError::from(error).status, expected_status);
        let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(after.backend, before.backend);
        assert_eq!(after.base_url, before.base_url);
        assert_eq!(after.api_key_env, before.api_key_env);
        assert!(manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        write_codex_auth(&nac_home);
        std::fs::set_permissions(
            nac_home.join("auth.json"),
            std::fs::Permissions::from_mode(0o660),
        )
        .unwrap();
        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                    api_key_env: RequestField::Null,
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains("unsafe permissions 0660"));
        assert!(!format!("{error:#}").contains("codex-server-access"));
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(after.backend, before.backend);
        assert_eq!(after.base_url, before.base_url);
        assert_eq!(after.api_key_env, before.api_key_env);
        assert!(manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        std::fs::remove_file(nac_home.join("auth.json")).unwrap();
        let target = nac_home.join("patch-target.json");
        std::fs::write(&target, "secret-target").unwrap();
        symlink(&target, nac_home.join("auth.json")).unwrap();
        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                    api_key_env: RequestField::Null,
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
        assert_eq!(
            ApiError::from(error).status,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(after.backend, before.backend);
        assert_eq!(after.base_url, before.base_url);
        assert!(manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
        assert_eq!(std::fs::read_to_string(target).unwrap(), "secret-target");
    }

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn create_rejects_raw_invalid_selectors_without_persisting() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("create_invalid_selectors");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let store_path = root.join("store.db");

    for (backend, base_url, selector) in [
        ("openai-responses", "https://api.openai.com/v1", ""),
        ("openai-responses", "https://api.openai.com/v1", "   "),
        (
            "openai-responses",
            "https://api.openai.com/v1",
            " SURROUNDED_KEY ",
        ),
        ("arcee-auth", "https://api.arcee.ai", ""),
        ("arcee-auth", "https://api.arcee.ai", "   "),
    ] {
        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("test-model".to_string()),
                base_url: RequestField::Value(base_url.to_string()),
                backend: RequestField::Value(backend.to_string()),
                api_key_env: RequestField::Value(selector.to_string()),
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("invalid selector must fail creation");
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        assert!(
            !store_path.exists(),
            "invalid selector {selector:?} must fail before persistence"
        );
    }

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn create_rejects_unsupported_backend_and_anthropic_model_efforts_before_persisting() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("create_invalid_reasoning");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    let manager = test_manager(&root);
    let cases = [
        (
            "together-chat",
            "test-model",
            "https://api.together.xyz/v1",
            "minimal",
        ),
        (
            "anthropic-messages",
            "claude-sonnet-4-6",
            "https://api.anthropic.com/v1",
            "xhigh",
        ),
        (
            "anthropic-messages",
            "claude-opus-4-5",
            "https://api.anthropic.com/v1",
            "high",
        ),
        (
            "anthropic-messages",
            "claude-always-on-future",
            "https://api.anthropic.com/v1",
            "low",
        ),
    ];

    for (backend, model, base_url, effort) in cases {
        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value(model.to_string()),
                base_url: RequestField::Value(base_url.to_string()),
                backend: RequestField::Value(backend.to_string()),
                reasoning_effort: RequestField::Value(effort.to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("unsupported effort must fail creation");
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains(effort), "{error:#}");
        assert!(error.to_string().contains(backend), "{error:#}");
        if backend == "anthropic-messages" {
            assert!(error.to_string().contains(model), "{error:#}");
        }
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        assert!(
            !root.join("store.db").exists(),
            "invalid {model}/{effort} must fail before persistence"
        );
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn patch_round_trips_every_state_and_rebuilds_from_persisted_settings() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("patch_tristate");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    write_codex_auth(&nac_home);
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);

    manager.attach_session("session").await.unwrap();
    assert!(manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value(" replacement-model ".to_string()),
                base_url: RequestField::Value(" https://api.openai.com/v1 ".to_string()),
                backend: RequestField::Value("openai-responses".to_string()),
                reasoning_effort: RequestField::Value("high".to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                    "X-Replaced".to_string(),
                    "true".to_string(),
                )]))),
                orchestrator_compaction_threshold: RequestField::Value(64_000),
                light_model: RequestField::Omitted,
            },
        )
        .await
        .unwrap();
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));
    let replaced = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(replaced.model, "replacement-model");
    assert_eq!(replaced.reasoning_effort, Some(ReasoningEffort::High));
    assert_eq!(replaced.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    assert_eq!(replaced.extra_headers.get("X-Replaced").unwrap(), "true");
    assert_eq!(replaced.orchestrator_compaction_threshold, Some(64_000));
    assert_eq!(
        manager
            .session_config("session")
            .unwrap()
            .orchestrator_compaction_threshold,
        Some(64_000)
    );

    manager.attach_session("session").await.unwrap();
    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("arcee-auth".to_string()),
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                reasoning_effort: RequestField::Null,
                api_key_env: RequestField::Null,
                extra_headers: RequestField::Null,
                orchestrator_compaction_threshold: RequestField::Null,
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("switch to stored Arcee auth");
    let arcee_auth = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(arcee_auth.backend, BackendKind::ArceeAuth);
    assert_eq!(arcee_auth.reasoning_effort, None);
    assert_eq!(arcee_auth.api_key_env, None);
    assert!(arcee_auth.extra_headers.is_empty());
    assert_eq!(arcee_auth.orchestrator_compaction_threshold, None);

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("arcee-api".to_string()),
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai/api/v1".to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                orchestrator_compaction_threshold: RequestField::Value(32_000),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("switch to Arcee API key mode");
    let arcee_api = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(arcee_api.backend, BackendKind::ArceeApi);
    assert_eq!(arcee_api.orchestrator_compaction_threshold, Some(32_000));

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                model: RequestField::Value("gpt-5.2-codex".to_string()),
                base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                api_key_env: RequestField::Null,
                orchestrator_compaction_threshold: RequestField::Value(0),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("switch to Codex stored OAuth mode");
    let codex = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(codex.backend, BackendKind::ChatGptCodexResponses);
    assert_eq!(codex.api_key_env, None);
    assert_eq!(codex.orchestrator_compaction_threshold, None);

    manager
        .update_session_config(
            "session",
            UpdateConfigRequest {
                backend: RequestField::Value("openai-responses".to_string()),
                model: RequestField::Value("gpt-5.2".to_string()),
                base_url: RequestField::Value("https://api.openai.com/v1".to_string()),
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                extra_headers: RequestField::Value(HeadersRequest(BTreeMap::new())),
                ..UpdateConfigRequest::default()
            },
        )
        .await
        .expect("switch back to API-key mode");
    let api_key = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(api_key.backend, BackendKind::OpenAiResponses);
    assert_eq!(api_key.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
    assert!(api_key.extra_headers.is_empty());

    let before_omitted = api_key;
    manager
        .update_session_config("session", UpdateConfigRequest::default())
        .await
        .expect("omitted fields preserve snapshot");
    let after_omitted = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(after_omitted.model, before_omitted.model);
    assert_eq!(after_omitted.base_url, before_omitted.base_url);
    assert_eq!(after_omitted.backend, before_omitted.backend);
    assert_eq!(after_omitted.api_key_env, before_omitted.api_key_env);
    assert_eq!(after_omitted.extra_headers, before_omitted.extra_headers);

    manager.attach_session("session").await.unwrap();
    let rebuilt = manager.snapshot("session").await.unwrap();
    assert_eq!(rebuilt.metadata.model, "gpt-5.2");
    assert_eq!(rebuilt.metadata.backend, "openai-responses");

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn invalid_patches_preserve_database_and_active_service() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("patch_rollback");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
    seed_editable_session(&root, "session");
    let manager = test_manager(&root);
    manager.attach_session("session").await.unwrap();

    let invalid = [
        UpdateConfigRequest {
            orchestrator_compaction_threshold: RequestField::Value(
                nac_core::MAX_SUPPORTED_TOKEN_COUNT + 1,
            ),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            model: RequestField::Null,
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            base_url: RequestField::Value("   ".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            backend: RequestField::Null,
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            // Clearing the selector fails only when conventional-var
            // auto-selection cannot repair it: deepseek's conventional
            // variable is cleared in this environment (the session's
            // own openai conventional variable is set and would
            // auto-select, so clearing stays valid there).
            backend: RequestField::Value("deepseek-chat".to_string()),
            api_key_env: RequestField::Null,
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            api_key_env: RequestField::Value("   ".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            api_key_env: RequestField::Value(" SURROUNDED_KEY ".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            backend: RequestField::Value("arcee-auth".to_string()),
            base_url: RequestField::Value("https://api.arcee.ai".to_string()),
            api_key_env: RequestField::Value("   ".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            api_key_env: RequestField::Value("MISSING_SERVER_KEY".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                "bad header".to_string(),
                "value".to_string(),
            )]))),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                "Authorization".to_string(),
                "must-not-append".to_string(),
            )]))),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                "X-API-KEY".to_string(),
                "must-not-append".to_string(),
            )]))),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            backend: RequestField::Value("together-chat".to_string()),
            reasoning_effort: RequestField::Value("xhigh".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            model: RequestField::Value("claude-sonnet-4-6".to_string()),
            base_url: RequestField::Value("https://api.anthropic.com/v1".to_string()),
            backend: RequestField::Value("anthropic-messages".to_string()),
            reasoning_effort: RequestField::Value("xhigh".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            model: RequestField::Value("claude-opus-4-5".to_string()),
            base_url: RequestField::Value("https://api.anthropic.com/v1".to_string()),
            backend: RequestField::Value("anthropic-messages".to_string()),
            reasoning_effort: RequestField::Value("high".to_string()),
            ..UpdateConfigRequest::default()
        },
        UpdateConfigRequest {
            model: RequestField::Value("claude-always-on-future".to_string()),
            base_url: RequestField::Value("https://api.anthropic.com/v1".to_string()),
            backend: RequestField::Value("anthropic-messages".to_string()),
            reasoning_effort: RequestField::Value("low".to_string()),
            ..UpdateConfigRequest::default()
        },
    ];

    for request in invalid {
        let anthropic_model = match (&request.backend, &request.model) {
            (RequestField::Value(backend), RequestField::Value(model))
                if backend == "anthropic-messages" =>
            {
                Some(model.clone())
            }
            _ => None,
        };
        let error = manager
            .update_session_config("session", request)
            .await
            .unwrap_err();
        if let Some(model) = anthropic_model {
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains(&model), "{error:#}");
        }
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.model, "model-a");
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Medium));
        assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert_eq!(stored.extra_headers.get("X-Original").unwrap(), "yes");
        assert!(manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
    }

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn removed_backend_updates_are_bad_requests_and_are_not_persisted() {
    let root = temp_root("removed_backend_update");
    seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
    let manager = test_manager(&root);

    for backend in ["arcee", "auto"] {
        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Omitted,
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    backend: RequestField::Value(backend.to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                },
            )
            .await
            .unwrap_err();
        assert!(
            error.to_string().contains("unsupported backend"),
            "{error:#}"
        );
        assert!(
            error.to_string().contains("settings repair required"),
            "{error:#}"
        );
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);

        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn server_arcee_configuration_status_and_persistence_are_consistent() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("arcee_config_status");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://tenant.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let store_path = root.join("store.db");

    let create_error = manager
        .create_session(CreateSessionRequest {
            behavior: sessions::SessionBehavior::Orchestrator,
            first_chat: false,
            project_id: None,
            cwd: None,
            model: RequestField::Omitted,
            base_url: RequestField::Value("http://api.arcee.ai/insecure".to_string()),
            backend: RequestField::Value("arcee-auth".to_string()),
            reasoning_effort: RequestField::Omitted,
            api_key_env: RequestField::Omitted,
            extra_headers: RequestField::Omitted,
            orchestrator_compaction_threshold: RequestField::Omitted,
            light_model: RequestField::Omitted,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            sandbox: SandboxRequest::default(),
        })
        .await
        .unwrap_err();
    assert!(create_error
        .downcast_ref::<ModelConfigurationError>()
        .is_some());
    assert_eq!(ApiError::from(create_error).status, StatusCode::BAD_REQUEST);
    assert!(
        !store_path.exists(),
        "invalid create must fail before initializing session storage"
    );

    seed_session(&root, "attach-invalid", "2026-01-01 00:00:00.000000000");
    let mut attach_snapshot = sessions::load_session(&store_path, "attach-invalid").unwrap();
    attach_snapshot.backend = BackendKind::ArceeApi;
    attach_snapshot.base_url = "https://api.arcee.ai/api/v1".to_string();
    sessions::update_session_config(&store_path, &attach_snapshot).unwrap();
    let attach_error = match manager.attach_session("attach-invalid").await {
        Ok(_) => panic!("arcee-api attach without api_key_env must fail"),
        Err(error) => error,
    };
    // The guided error names the provider's conventional variable
    // (ScopedModelEnv keeps ARCEE_API_KEY cleared, so auto-selection
    // cannot adopt it).
    assert!(
        attach_error
            .to_string()
            .contains("set the ARCEE_API_KEY environment variable"),
        "{attach_error:#}"
    );
    assert!(attach_error
        .downcast_ref::<ModelConfigurationError>()
        .is_some());
    assert_eq!(ApiError::from(attach_error).status, StatusCode::BAD_REQUEST);

    seed_session(&root, "update", "2026-01-02 00:00:00.000000000");
    for invalid_base_url in ["https://api.arcee.ai/v1", "not a URL"] {
        let update_error = manager
            .update_session_config(
                "update",
                UpdateConfigRequest {
                    model: RequestField::Omitted,
                    base_url: RequestField::Value(invalid_base_url.to_string()),
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                },
            )
            .await
            .unwrap_err();
        assert!(
            update_error
                .downcast_ref::<ModelConfigurationError>()
                .is_some(),
            "unclassified configuration error: {update_error:#}"
        );
        assert_eq!(ApiError::from(update_error).status, StatusCode::BAD_REQUEST);

        let stored = sessions::load_session(&store_path, "update").unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
    }

    manager
        .update_session_config(
            "update",
            UpdateConfigRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://tenant.arcee.ai/api/v1".to_string()),
                backend: RequestField::Value("arcee-auth".to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Omitted,
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
            },
        )
        .await
        .expect("same-origin approved Arcee configuration should persist");
    let approved = sessions::load_session(&store_path, "update").unwrap();
    assert_eq!(approved.backend, BackendKind::ArceeAuth);
    assert_eq!(approved.base_url, "https://tenant.arcee.ai/api/v1");

    unsafe { std::env::set_var("OPENAI_API_KEY", "custom-server-key") };
    manager
        .update_session_config(
            "update",
            UpdateConfigRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai/api".to_string()),
                backend: RequestField::Value("arcee-api".to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
            },
        )
        .await
        .expect("approved arcee-api configuration with an explicit selector should persist");
    let api_mode = sessions::load_session(&store_path, "update").unwrap();
    assert_eq!(api_mode.base_url, "https://api.arcee.ai/api");
    assert_eq!(api_mode.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

    let created = manager
        .create_session(CreateSessionRequest {
            behavior: sessions::SessionBehavior::Orchestrator,
            first_chat: false,
            project_id: None,
            cwd: None,
            model: RequestField::Value("test-model".to_string()),
            base_url: RequestField::Value("https://tenant.arcee.ai/api/v1".to_string()),
            backend: RequestField::Value("arcee-api".to_string()),
            reasoning_effort: RequestField::Omitted,
            api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
            extra_headers: RequestField::Omitted,
            orchestrator_compaction_threshold: RequestField::Omitted,
            light_model: RequestField::Omitted,
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            sandbox: SandboxRequest::default(),
        })
        .await
        .expect("valid approved arcee-api create should succeed");
    assert!(created.metadata.session_id.is_some());

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn null_update_clears_legacy_arcee_api_key_env() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("clear_arcee_api_key_env");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let snapshot = sessions::new_snapshot(
        "legacy-arcee".to_string(),
        root.clone(),
        "model".to_string(),
        "https://api.arcee.ai".to_string(),
        BackendKind::ArceeAuth,
        None,
        None,
        None,
        Vec::new(),
        Some("LEGACY_ARCEE_KEY_ENV".to_string()),
        BTreeMap::new(),
    );
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    let manager = test_manager(&root);

    manager
        .update_session_config(
            "legacy-arcee",
            UpdateConfigRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Omitted,
                backend: RequestField::Omitted,
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Null,
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
            },
        )
        .await
        .expect("null api_key_env should clear the invalid legacy value");

    let stored = sessions::load_session(&root.join("store.db"), "legacy-arcee").unwrap();
    assert_eq!(stored.backend, BackendKind::ArceeAuth);
    assert_eq!(stored.model, "trinity-large-thinking");
    assert_eq!(stored.api_key_env, None);

    let _ = std::fs::remove_dir_all(&root);
}

fn test_event(sequence_id: u64, message: &str) -> SessionEventEnvelope {
    SessionEventEnvelope {
        session_id: Some("session-1".to_string()),
        epoch_id: "test-epoch".to_string(),
        sequence_id,
        client_id: None,
        run_id: None,
        event: nac_core::events::SessionEvent::RunFailed {
            message: message.to_string(),
        },
    }
}

#[test]
fn presentation_requests_require_the_complete_contract() {
    let update: UpdateSessionPresentationRequest =
        serde_json::from_str(r#"{"title":"  Build release  ","pinned":true,"expected_version":3}"#)
            .unwrap();
    assert_eq!(update.title, "  Build release  ");
    assert!(update.pinned);
    assert_eq!(update.expected_version, 3);
    assert!(serde_json::from_str::<UpdateSessionPresentationRequest>(
        r#"{"pinned":true,"expected_version":3}"#
    )
    .is_err());

    let reorder: ReorderSessionsRequest = serde_json::from_str(
        r#"{"pinned":false,"session_ids":["b","a"],"expected_versions":{"a":2,"b":4}}"#,
    )
    .unwrap();
    assert_eq!(reorder.session_ids, ["b", "a"]);
    assert_eq!(reorder.expected_versions["a"], 2);
}

#[test]
fn presentation_errors_map_to_exact_statuses() {
    use sessions::SessionPresentationError;

    let cases = [
        (
            SessionPresentationError::InvalidInput("invalid".to_string()),
            StatusCode::BAD_REQUEST,
        ),
        (
            SessionPresentationError::NotFound("missing".to_string()),
            StatusCode::NOT_FOUND,
        ),
        (
            SessionPresentationError::Conflict("stale".to_string()),
            StatusCode::CONFLICT,
        ),
        (
            SessionPresentationError::Busy("locked".to_string()),
            StatusCode::CONFLICT,
        ),
        (
            SessionPresentationError::Store(anyhow::anyhow!("disk failed")),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ];

    for (error, expected_status) in cases {
        let error = ApiError::from(error);
        assert_eq!(error.status, expected_status);
    }
}

#[tokio::test]
async fn presentation_handlers_preserve_error_shape_and_status() {
    let root = temp_root("presentation_status");
    seed_session(&root, "known", "2026-01-01 00:00:00.000000000");
    let manager = test_manager(&root);

    let invalid = update_session_presentation_handler(
        State(manager.clone()),
        AxumPath("known".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "bad\ttitle".to_string(),
            pinned: false,
            expected_version: 0,
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(invalid.status, StatusCode::BAD_REQUEST);

    let missing = update_session_presentation_handler(
        State(manager.clone()),
        AxumPath("missing".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "title".to_string(),
            pinned: false,
            expected_version: 0,
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(missing.status, StatusCode::NOT_FOUND);

    let _ = update_session_presentation_handler(
        State(manager.clone()),
        AxumPath("known".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "title".to_string(),
            pinned: false,
            expected_version: 0,
        })),
    )
    .await
    .unwrap();
    let stale = update_session_presentation_handler(
        State(manager.clone()),
        AxumPath("known".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "new title".to_string(),
            pinned: false,
            expected_version: 0,
        })),
    )
    .await
    .unwrap_err();
    let response = stale.into_response();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body.as_object().unwrap().len(), 1);
    assert!(body["error"].as_str().unwrap().contains("version changed"));

    let malformed_reorder = reorder_sessions_handler(
        State(manager.clone()),
        Ok(Json(ReorderSessionsRequest {
            pinned: false,
            session_ids: vec!["known".to_string()],
            expected_versions: BTreeMap::new(),
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(malformed_reorder.status, StatusCode::BAD_REQUEST);

    let membership_conflict = reorder_sessions_handler(
        State(manager),
        Ok(Json(ReorderSessionsRequest {
            pinned: false,
            session_ids: Vec::new(),
            expected_versions: BTreeMap::new(),
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(membership_conflict.status, StatusCode::CONFLICT);

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn presentation_routes_serialize_summaries_and_drive_list_order() {
    let root = temp_root("presentation_order");
    seed_session(&root, "a", "2026-01-01 00:00:00.000000000");
    seed_session(&root, "b", "2026-01-02 00:00:00.000000000");
    seed_session(&root, "c", "2026-01-03 00:00:00.000000000");
    let manager = test_manager(&root);

    let Json(a) = update_session_presentation_handler(
        State(manager.clone()),
        AxumPath("a".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "  Alpha  ".to_string(),
            pinned: true,
            expected_version: 0,
        })),
    )
    .await
    .unwrap();
    assert_eq!(a.title.as_deref(), Some("Alpha"));
    assert!(a.pinned);
    assert_eq!(a.presentation_version, 1);
    let serialized = serde_json::to_value(&a).unwrap();
    assert_eq!(serialized["title"], "Alpha");
    assert_eq!(serialized["pinned"], true);
    assert_eq!(serialized["sort_order"], 0);
    assert_eq!(serialized["presentation_version"], 1);

    let _ = update_session_presentation_handler(
        State(manager.clone()),
        AxumPath("b".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: String::new(),
            pinned: true,
            expected_version: 0,
        })),
    )
    .await
    .unwrap();

    let Json(reordered) = reorder_sessions_handler(
        State(manager.clone()),
        Ok(Json(ReorderSessionsRequest {
            pinned: true,
            session_ids: vec!["b".to_string(), "a".to_string()],
            expected_versions: BTreeMap::from([("a".to_string(), 1), ("b".to_string(), 1)]),
        })),
    )
    .await
    .unwrap();
    assert!(reordered.pinned);
    assert_eq!(
        reordered
            .sessions
            .iter()
            .map(|summary| summary.session_id.as_str())
            .collect::<Vec<_>>(),
        ["b", "a"]
    );
    assert_eq!(reordered.sessions[0].sort_order, 0);
    assert_eq!(reordered.sessions[1].sort_order, 1);
    assert!(reordered
        .sessions
        .iter()
        .all(|summary| summary.presentation_version == 2));

    let listed = manager.list_sessions(false).await.unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|entry| entry.summary.session_id.as_str())
            .collect::<Vec<_>>(),
        ["b", "a", "c"]
    );
    assert!(listed.iter().all(|entry| !entry.active));

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn session_snapshot_recovers_non_contiguous_transcript_tail() {
    let _lock = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = temp_root("transcript_gap_recovery");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-route-test-key"));
    let transcript = vec![
        Message::System {
            content: "system".to_string(),
        },
        Message::User {
            content: "first prompt".to_string(),
        },
        Message::Assistant {
            content: Some("first answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "second prompt".to_string(),
        },
        Message::Assistant {
            content: Some("second answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "third prompt".to_string(),
        },
        Message::Assistant {
            content: Some("third answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
    ];
    seed_session_with_messages(
        &root,
        "target",
        "2026-01-02 00:00:00.000000000",
        transcript.clone(),
    );
    let orphan = Message::User {
        content: "must not be exposed".to_string(),
    };
    nac_core::test_support::store::append_thread_event(
        &root.join("store.db"),
        "target",
        nac_core::test_support::store::ORCHESTRATOR_STEERING_TARGET,
        &nac_core::test_support::store::encode_transcript_log_entry(8, &orphan).unwrap(),
    )
    .unwrap();
    let manager = test_manager(&root);
    let gate = manager.lifecycle_gate("target");
    let lifecycle = gate.lock().await;
    let operation_lease =
        sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "target").unwrap();
    manager
        .attach_current_operation_service_locked("target", &operation_lease)
        .await
        .expect("cold prompt attach must reuse its existing operation lease");
    drop(lifecycle);
    drop(operation_lease);
    let app = router(manager);

    let response = get_response(app, "/sessions/target", None).await;
    let status = response.status();
    let body = response_body(response).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let snapshot: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(snapshot["messages"].as_array().unwrap().len(), 7);
    let warning = snapshot["transcript_recovery_warning"].as_str().unwrap();
    assert!(warning.contains("index 7"), "{warning}");
    assert!(
        warning.contains("1 untrusted transcript log row"),
        "{warning}"
    );
    assert!(!warning.contains("must not be exposed"), "{warning}");
    let summary = snapshot["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|summary| summary["session_id"] == "target")
        .unwrap();
    assert_eq!(summary["visible_message_count"], 6);
    assert_eq!(summary["last_user_prompt"], "third prompt");
    assert!(TranscriptLogWriter::new(&root.join("store.db"))
        .unwrap()
        .read_from("target", 7)
        .unwrap()
        .is_empty());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn snapshot_projection_preserves_defaults_and_all_non_session_fields() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("snapshot_projection");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-route-test-key"));
    let transcript = test_transcript();
    seed_session_with_messages(
        &root,
        "target",
        "2026-01-02 00:00:00.000000000",
        transcript.clone(),
    );
    seed_session(&root, "other", "2026-01-01 00:00:00.000000000");
    let app = router(test_manager(&root));
    let query = "message_limit=2&thread_event_limit=24";

    let default_response =
        get_response(app.clone(), &format!("/sessions/target?{query}"), None).await;
    let default_status = default_response.status();
    let default_body = response_body(default_response).await;
    assert_eq!(
        default_status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&default_body)
    );
    let default: serde_json::Value = serde_json::from_slice(&default_body).unwrap();

    let true_response = get_response(
        app.clone(),
        &format!("/sessions/target?{query}&include_sessions=true"),
        None,
    )
    .await;
    assert_eq!(true_response.status(), StatusCode::OK);
    let included: serde_json::Value =
        serde_json::from_slice(&response_body(true_response).await).unwrap();
    assert_eq!(included, default);
    assert_eq!(default["sessions"].as_array().unwrap().len(), 2);

    let false_response = get_response(
        app,
        &format!("/sessions/target?{query}&include_sessions=false"),
        None,
    )
    .await;
    assert_eq!(false_response.status(), StatusCode::OK);
    let projected: serde_json::Value =
        serde_json::from_slice(&response_body(false_response).await).unwrap();
    assert_eq!(projected["sessions"], serde_json::json!([]));
    let mut expected_projected = default.clone();
    expected_projected["sessions"] = serde_json::json!([]);
    assert_eq!(projected, expected_projected);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn paged_routes_preserve_raw_indexes_timestamps_and_projection_caps() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("paged_route_contract");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-route-test-key"));
    let mut transcript = test_transcript();
    transcript.insert(
        6,
        Message::Tool {
            tool_call_id: "call-thread".to_string(),
            content: "thread result".into(),
        },
    );
    seed_session_with_messages(&root, "target", "2026-01-02 00:00:00.000000000", transcript);
    TranscriptLogWriter::new(&root.join("store.db"))
        .unwrap()
        .append(
            "target",
            9,
            &Message::User {
                content: "logged tail".to_string(),
            },
        )
        .unwrap();
    let app = router(test_manager(&root));

    let response = get_response(
        app.clone(),
        "/sessions/target/messages?before=10&limit=4&include_system=true",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let page: serde_json::Value = serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(
        page["page"],
        serde_json::json!({
            "start": 6,
            "end": 10,
            "total": 10,
            "has_older": true,
        })
    );
    assert_eq!(
        page["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|message| message["role"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["tool", "system", "assistant", "user"]
    );
    let created_at = page["created_at"].as_array().unwrap();
    assert_eq!(created_at.len(), 4);
    assert!(created_at[..3].iter().all(serde_json::Value::is_null));
    assert!(created_at[3].is_string());
    assert_eq!(page["messages"][3]["content"], "logged tail");

    let response = get_response(
            app,
            "/sessions/target?message_limit=3&thread_event_limit=1&include_sessions=false&include_system=true",
            None,
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let snapshot: serde_json::Value =
        serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(snapshot["messages"].as_array().unwrap().len(), 3);
    assert_eq!(snapshot["message_created_at"].as_array().unwrap().len(), 3);
    assert_eq!(
        snapshot["message_page"],
        serde_json::json!({
            "start": 7,
            "end": 10,
            "total": 10,
            "has_older": true,
        })
    );
    let message_created_at = snapshot["message_created_at"].as_array().unwrap();
    assert!(message_created_at[..2]
        .iter()
        .all(serde_json::Value::is_null));
    assert!(message_created_at[2].is_string());
    assert_eq!(snapshot["sessions"], serde_json::json!([]));
    assert!(snapshot["thread_events"]
        .as_object()
        .unwrap()
        .values()
        .all(|events| events.as_array().unwrap().len() <= 1));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn paged_message_queries_exclude_system_prompts_by_default() {
    let Query(snapshot_query) = Query::<SessionSnapshotQuery>::try_from_uri(
        &"/sessions/test?message_limit=2".parse().unwrap(),
    )
    .unwrap();
    let Query(messages_query) = Query::<MessagesQuery>::try_from_uri(
        &"/sessions/test/messages?before=3&limit=2".parse().unwrap(),
    )
    .unwrap();
    assert!(!snapshot_query.include_system);
    assert!(!messages_query.include_system);
}

#[test]
fn paged_message_queries_include_system_prompts_when_requested() {
    let Query(snapshot_query) = Query::<SessionSnapshotQuery>::try_from_uri(
        &"/sessions/test?message_limit=3&include_system=true"
            .parse()
            .unwrap(),
    )
    .unwrap();
    let Query(messages_query) = Query::<MessagesQuery>::try_from_uri(
        &"/sessions/test/messages?before=3&limit=3&include_system=true"
            .parse()
            .unwrap(),
    )
    .unwrap();
    assert!(snapshot_query.include_system);
    assert!(messages_query.include_system);
}

#[tokio::test]
async fn sse_route_is_never_compressed_and_preserves_boundary_ordering() {
    async fn finite_sse_route(
    ) -> Sse<impl futures_core::Stream<Item = std::result::Result<Event, Infallible>>> {
        let replayed = vec![test_event(4, "replayed-4"), test_event(5, "replayed-5")];
        let live = test_event(6, "live-6");
        let (sender, receiver) = tokio::sync::broadcast::channel(4);
        sender.send(live).unwrap();
        drop(sender);
        let (delta_sender, assistant_deltas) = tokio::sync::broadcast::channel(4);
        drop(delta_sender);

        Sse::new(session_event_stream(
            "test-epoch".to_string(),
            5,
            Some(SessionReplayGap {
                missing_from_sequence_id: 2,
                missing_to_sequence_id: 3,
            }),
            replayed,
            receiver,
            assistant_deltas,
        ))
    }

    let app = Router::new()
        .route("/events", get(finite_sse_route))
        .layer(response_compression_layer());
    let response = get_response(app, "/events", Some("gzip")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CONTENT_TYPE),
        Some(&header::HeaderValue::from_static("text/event-stream"))
    );
    assert!(response.headers().get(header::CONTENT_ENCODING).is_none());
    let body = response_body(response).await;
    let body = String::from_utf8(body.to_vec()).unwrap();

    let boundary = body.find("event: replay_boundary").unwrap();
    let gap = body.find("event: replay_gap").unwrap();
    let replay_4 = body.find("\"sequence_id\":4").unwrap();
    let replay_5 = body.find("\"sequence_id\":5").unwrap();
    let live_6 = body.find("\"sequence_id\":6").unwrap();
    assert!(boundary < gap && gap < replay_4 && replay_4 < replay_5 && replay_5 < live_6);
    assert!(body.contains("\"replay_boundary_sequence_id\":5"));
    assert!(body.contains("\"epoch_id\":\"test-epoch\""));

    let boundary_frame = body.split("\n\n").next().unwrap();
    assert!(!boundary_frame.lines().any(|line| line.starts_with("id:")));
}

#[tokio::test]
async fn project_http_create_list_patch_and_location_conflict() {
    let root = temp_root("project_http");
    let workspace = root.join("workspace");
    std::fs::create_dir_all(workspace.join("nested")).unwrap();
    let manager = test_manager(&root);
    let app = router(manager);

    let created_response = post_json(
        app.clone(),
        "/projects",
        serde_json::json!({
            "cwd": workspace.join("nested").join(".."),
            "description": "Initial description"
        }),
    )
    .await;
    assert_eq!(created_response.status(), StatusCode::CREATED);
    let created: ProjectRecord =
        serde_json::from_slice(&response_body(created_response).await).unwrap();
    assert_eq!(created.cwd, workspace.canonicalize().unwrap());
    assert_eq!(created.name, "workspace");
    assert_eq!(created.description.as_deref(), Some("Initial description"));

    let listed = get_response(app.clone(), "/projects", None).await;
    assert_eq!(listed.status(), StatusCode::OK);
    let listed: serde_json::Value = serde_json::from_slice(&response_body(listed).await).unwrap();
    assert_eq!(listed["projects"].as_array().unwrap().len(), 1);
    assert_eq!(listed["projects"][0]["project_id"], created.project_id);

    let patched = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/projects/{}", created.project_id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Renamed","description":null}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(patched.status(), StatusCode::OK);
    let patched: ProjectRecord = serde_json::from_slice(&response_body(patched).await).unwrap();
    assert_eq!(patched.name, "Renamed");
    assert_eq!(patched.description, None);

    let null_name = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/projects/{}", created.project_id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":null}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(null_name.status(), StatusCode::BAD_REQUEST);

    let duplicate = post_json(
        app.clone(),
        "/projects",
        serde_json::json!({"cwd": workspace}),
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let missing = post_json(
        app,
        "/projects",
        serde_json::json!({"cwd": root.join("missing")}),
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn project_session_materializes_defaults_and_filters_membership() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("project_session");
    let workspace = root.join("workspace");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("project-test-key"));
    let manager = test_manager(&root);
    let store_path = root.join("store.db");

    model_configurations::insert_model_configuration(
        &store_path,
        "project-default",
        model_configurations::NewModelConfiguration {
            name: "Project default".to_string(),
            backend: "openai-responses".to_string(),
            model: "gpt-5.2".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_env: Some("OPENAI_API_KEY".to_string()),
            reasoning_effort: Some("high".to_string()),
            extra_headers: BTreeMap::from([("X-Project".to_string(), "selected".to_string())]),
            orchestrator_compaction_threshold: Some(64_000),
            initial_prompt: Some("ignored during creation".to_string()),
            light_model: None,
        },
    )
    .unwrap();
    let project = manager
        .projects()
        .create(application::projects::CreateProject {
            name: Some("Backend".to_string()),
            description: None,
            cwd: workspace.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: Some("project-default".to_string()),
        })
        .await
        .unwrap();

    let first_chat = CreateSessionRequest {
        first_chat: true,
        project_id: Some(project.project_id.clone()),
        reasoning_effort: RequestField::Value("low".to_string()),
        ..CreateSessionRequest::default()
    };
    let (created, duplicate) = tokio::join!(
        manager.create_session(first_chat.clone()),
        manager.create_session(first_chat)
    );
    let created = created.unwrap();
    let duplicate = duplicate.unwrap();
    assert_eq!(
        created.metadata.session_id, duplicate.metadata.session_id,
        "concurrent required-first-chat requests must converge on one primary session"
    );
    let session_id = created.metadata.session_id.clone().unwrap();
    assert_eq!(
        created.metadata.project_id.as_deref(),
        Some(project.project_id.as_str())
    );
    let stored = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(stored.project_id, Some(project.project_id.clone()));
    assert_eq!(stored.cwd, workspace.canonicalize().unwrap());
    assert_eq!(stored.model, "gpt-5.2");
    assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Low));
    assert_eq!(
        stored.extra_headers.get("X-Project").map(String::as_str),
        Some("selected")
    );
    assert_eq!(stored.orchestrator_compaction_threshold, Some(64_000));

    let filtered = manager
        .list_sessions_for_project(false, Some(&project.project_id))
        .await
        .unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(
        filtered[0].summary.project_id.as_deref(),
        Some(project.project_id.as_str())
    );

    let conflict = manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id.clone()),
            cwd: Some(workspace),
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap_err();
    assert!(conflict.to_string().contains("cannot be combined"));
    assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);

    let missing = manager
        .create_session(CreateSessionRequest {
            project_id: Some("missing".to_string()),
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap_err();
    assert!(missing.to_string().contains("was not found"));
    assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);

    let required_null = manager
        .create_session(CreateSessionRequest {
            project_id: Some(project.project_id.clone()),
            model: RequestField::Null,
            ..CreateSessionRequest::default()
        })
        .await
        .unwrap_err();
    assert!(required_null.to_string().contains("model"));
    assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);

    let deletion = delivery::model_configurations::delete_handler(
        State(manager.clone()),
        AxumPath("project-default".to_string()),
    )
    .await
    .unwrap_err();
    assert_eq!(deletion.status, StatusCode::CONFLICT);
    assert!(model_configurations::load_model_configuration(&store_path, "project-default").is_ok());
    manager
        .projects()
        .update(
            &project.project_id,
            application::projects::UpdateProject {
                name: application::Field::Unchanged,
                description: application::Field::Unchanged,
                default_model_config_id: application::Field::Clear,
                pinned: application::Field::Unchanged,
            },
        )
        .unwrap();
    assert_eq!(
        delivery::model_configurations::delete_handler(
            State(manager.clone()),
            AxumPath("project-default".to_string()),
        )
        .await
        .unwrap(),
        StatusCode::NO_CONTENT
    );
    let reloaded = sessions::load_session(&store_path, &session_id).unwrap();
    assert_eq!(reloaded.model, "gpt-5.2");
    assert_eq!(reloaded.project_id, Some(project.project_id));

    let _ = std::fs::remove_dir_all(root);
}

async fn post_json(app: Router, uri: &str, body: serde_json::Value) -> Response {
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}

async fn put_json(app: Router, uri: &str, body: serde_json::Value) -> Response {
    app.oneshot(
        Request::builder()
            .method("PUT")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}

/// One-shot stand-in for a provider's model index, answering the first
/// request with `body` and reporting the `Authorization` header it saw — so
/// a test can tell which credential actually went out on the wire.
fn scripted_model_index(body: &'static str) -> (String, std::sync::mpsc::Receiver<String>) {
    use std::io::{Read, Write};

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind model index");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept model index request");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            match socket.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => request.extend_from_slice(&buffer[..read]),
            }
        }
        let authorization = String::from_utf8_lossy(&request)
            .lines()
            .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
            .map(|line| line[line.find(':').unwrap() + 1..].trim().to_string())
            .unwrap_or_default();
        let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        let _ = socket.write_all(response.as_bytes());
        let _ = socket.flush();
        let _ = sender.send(authorization);
    });
    (base_url, receiver)
}

/// A key the UI supplies is filed away under a name the server picks, and
/// from then on that name stands in for the secret: the value never comes
/// back out, and the caller reaches the provider by naming it instead.
#[tokio::test]
async fn a_supplied_key_is_filed_under_a_generated_name_and_answers_by_it() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("generated_credential");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).expect("create NAC home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let app = router(test_manager(&root));

    let stored = post_json(
        app.clone(),
        "/credentials",
        serde_json::json!({ "value": "sk-server-test-key" }),
    )
    .await;
    assert_eq!(stored.status(), StatusCode::OK);
    let name = response_json(stored).await["name"]
        .as_str()
        .expect("generated credential name")
        .to_string();
    assert!(name.starts_with(GENERATED_CREDENTIAL_PREFIX));

    let listed = get_response(app.clone(), "/credentials", None).await;
    let listed = String::from_utf8(response_body(listed).await.to_vec()).unwrap();
    assert!(listed.contains(&name));
    assert!(
        !listed.contains("sk-server-test-key"),
        "a stored key must never be readable back: {listed}"
    );

    let (base_url, authorization) = scripted_model_index(r#"{"data":[{"id":"model-a"}]}"#);
    let models = post_json(
        app,
        "/providers/models",
        serde_json::json!({
            "backend": "openai-responses",
            "api_key_env": name,
            "base_url": base_url,
        }),
    )
    .await;
    assert_eq!(models.status(), StatusCode::OK);
    let models = response_json(models).await;
    assert_eq!(models["models"][0]["id"], "model-a");
    assert_eq!(
        authorization
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the model index was asked"),
        "Bearer sk-server-test-key"
    );

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_host_secret_api_is_write_only_and_unmanaged_hosts_fail_closed() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_secret_api");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);

    let unmanaged = router(test_manager(&root));
    let response = get_response(unmanaged, "/managed/secrets", None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let app = router(test_managed_manager(&root));
    let canary = "managed-canary-value-that-must-not-return";
    let stored = put_json(
        app.clone(),
        "/managed/secrets/DEMO_TOKEN",
        serde_json::json!({ "value": canary }),
    )
    .await;
    assert_eq!(stored.status(), StatusCode::OK);
    let stored_body = String::from_utf8(response_body(stored).await.to_vec()).unwrap();
    assert!(stored_body.contains("DEMO_TOKEN"));
    assert!(!stored_body.contains(canary));

    let listed = get_response(app.clone(), "/managed/secrets", None).await;
    assert_eq!(listed.status(), StatusCode::OK);
    let listed_body = String::from_utf8(response_body(listed).await.to_vec()).unwrap();
    assert!(listed_body.contains("DEMO_TOKEN"));
    assert!(listed_body.contains("\"healthy\":true"));
    assert!(!listed_body.contains(canary));

    let rejected = put_json(
        app.clone(),
        "/managed/secrets/PATH",
        serde_json::json!({ "value": canary }),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert!(!String::from_utf8(response_body(rejected).await.to_vec())
        .unwrap()
        .contains(canary));

    let deleted = app
        .clone()
        .oneshot(
            Request::builder()
                .method(axum::http::Method::DELETE)
                .uri("/managed/secrets/DEMO_TOKEN")
                .header(header::HOST, "127.0.0.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let listed = get_response(app, "/managed/secrets", None).await;
    assert!(!String::from_utf8(response_body(listed).await.to_vec())
        .unwrap()
        .contains("DEMO_TOKEN"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_github_status_is_metadata_only_and_unmanaged_hosts_fail_closed() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("managed_github_status");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);

    let unmanaged = router(test_manager(&root));
    let response = get_response(unmanaged.clone(), "/managed/github", None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let response = get_response(
        unmanaged,
        "/managed/github/clone-operations/0123456789abcdef0123456789abcdef",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let manager = test_managed_manager(&root);
    let app = router(manager.clone());
    let response = get_response(app.clone(), "/managed/github", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = String::from_utf8(response_body(response).await.to_vec()).unwrap();
    assert!(body.contains("\"configured\":true"));
    assert!(body.contains("\"connected\":false"));
    assert!(!body.contains("access_token"));
    assert!(!body.contains("refresh_token"));
    let invalid_operation = get_response(
        app.clone(),
        "/managed/github/clone-operations/not-an-operation",
        None,
    )
    .await;
    assert_eq!(invalid_operation.status(), StatusCode::BAD_REQUEST);
    let missing_operation = get_response(
        app.clone(),
        "/managed/github/clone-operations/0123456789abcdef0123456789abcdef",
        None,
    )
    .await;
    assert_eq!(missing_operation.status(), StatusCode::NOT_FOUND);

    manager
        .managed_github_auth()
        .unwrap()
        .store_test_authorization(
            "server-status-access-canary",
            "server-status-refresh-canary",
            u64::MAX,
        )
        .unwrap();
    let connected = get_response(app.clone(), "/managed/github", None).await;
    assert_eq!(connected.status(), StatusCode::OK);
    let connected = String::from_utf8(response_body(connected).await.to_vec()).unwrap();
    assert!(connected.contains("\"connected\":true"));
    assert!(connected.contains("\"git_configured\":true"));
    assert!(connected.contains("42+test-user@users.noreply.github.com"));
    assert!(!connected.contains("server-status-access-canary"));
    assert!(!connected.contains("server-status-refresh-canary"));

    let disconnected = app
        .oneshot(
            Request::builder()
                .method(axum::http::Method::DELETE)
                .uri("/managed/github")
                .header(header::HOST, "127.0.0.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(disconnected.status(), StatusCode::OK);
    let body = String::from_utf8(response_body(disconnected).await.to_vec()).unwrap();
    assert!(body.contains("\"connected\":false"));
    assert!(!body.contains("token"));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn saved_config_managed_updates_clear_inherited_light_selectors() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("saved_config_managed_light_clear");
    let nac_home = root.join("nac-home");
    write_arcee_auth(&nac_home, "https://api.arcee.ai");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let manager = test_manager(&root);
    let inherited_selector = "NAC_CONFIG_OLD_KEY";
    let managed_light = || LightModelSettings {
        model: "trinity-large-thinking".to_string(),
        backend: Some(BackendKind::ArceeAuth),
        base_url: None,
        api_key_env: Some(inherited_selector.to_string()),
        reasoning_effort: None,
    };

    model_configurations::insert_model_configuration(
        &manager.inner.store_path,
        "repair",
        model_configurations::NewModelConfiguration {
            name: "Managed repair".to_string(),
            backend: BackendKind::ArceeAuth.to_string(),
            model: "trinity-large-thinking".to_string(),
            base_url: nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL.to_string(),
            api_key_env: Some(inherited_selector.to_string()),
            reasoning_effort: None,
            extra_headers: BTreeMap::new(),
            orchestrator_compaction_threshold: None,
            initial_prompt: None,
            light_model: Some(managed_light()),
        },
    )
    .unwrap();
    let Json(repaired) = delivery::model_configurations::update_handler(
        State(manager.clone()),
        AxumPath("repair".to_string()),
        Ok(Json(UpdateModelConfigurationRequest::default())),
    )
    .await
    .expect("managed repair clears inherited selectors");
    assert_eq!(repaired.api_key_env, None);
    assert_eq!(
        repaired
            .light_model
            .as_ref()
            .and_then(|light| light.api_key_env.as_deref()),
        None
    );

    model_configurations::insert_model_configuration(
        &manager.inner.store_path,
        "switch",
        model_configurations::NewModelConfiguration {
            name: "Managed switch".to_string(),
            backend: BackendKind::ArceeApi.to_string(),
            model: "trinity-large-thinking".to_string(),
            base_url: "https://api.arcee.ai/api/v1".to_string(),
            api_key_env: Some(inherited_selector.to_string()),
            reasoning_effort: None,
            extra_headers: BTreeMap::new(),
            orchestrator_compaction_threshold: None,
            initial_prompt: None,
            light_model: None,
        },
    )
    .unwrap();
    let Json(switched) = delivery::model_configurations::update_handler(
        State(manager.clone()),
        AxumPath("switch".to_string()),
        Ok(Json(UpdateModelConfigurationRequest {
            backend: RequestField::Value(BackendKind::ArceeAuth),
            light_model: RequestField::Value(managed_light()),
            ..UpdateModelConfigurationRequest::default()
        })),
    )
    .await
    .expect("managed switch clears inherited selectors");
    assert_eq!(switched.api_key_env, None);
    assert_eq!(
        switched
            .light_model
            .as_ref()
            .and_then(|light| light.api_key_env.as_deref()),
        None
    );

    let _ = std::fs::remove_dir_all(root);
}

/// Naming a credential is not a way to probe for one: a name with nothing
/// behind it is refused before any request goes out, and a provider that
/// signs in through the browser takes no name at all.
#[tokio::test]
async fn the_model_index_refuses_an_unresolvable_name_and_a_login_backend() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("model_index_by_name");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).expect("create NAC home");
    let _env = ScopedModelEnv::isolated(&nac_home, None);
    let app = router(test_manager(&root));

    let unresolvable = post_json(
        app.clone(),
        "/providers/models",
        serde_json::json!({
            "backend": "openai-responses",
            "api_key_env": "NAC_CONFIG_absent",
        }),
    )
    .await;
    assert_eq!(unresolvable.status(), StatusCode::BAD_REQUEST);
    let message = response_json(unresolvable).await["error"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        message.contains("NAC_CONFIG_absent"),
        "the refusal names what could not be resolved: {message}"
    );

    let managed = post_json(
        app,
        "/providers/models",
        serde_json::json!({
            "backend": "chatgpt-codex-responses",
            "api_key_env": "NAC_CONFIG_absent",
        }),
    )
    .await;
    assert_eq!(managed.status(), StatusCode::BAD_REQUEST);
    let message = response_json(managed).await["error"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        message.contains("stored login"),
        "a login backend explains that it takes no key: {message}"
    );

    let _ = std::fs::remove_dir_all(root);
}
