//! Complete assembled API document, route inventory and wire-schema contract.
use super::*;

#[test]
fn openapi_31_responses_keep_required_descriptions_after_dependency_upgrades() {
    let document = serde_json::to_value(openapi_document()).unwrap();
    assert_eq!(document["openapi"], "3.1.0");
    for (path, item) in document["paths"].as_object().unwrap() {
        for (method, operation) in item.as_object().unwrap() {
            let Some(responses) = operation
                .get("responses")
                .and_then(serde_json::Value::as_object)
            else {
                continue;
            };
            for (status, response) in responses {
                if response.get("$ref").is_none() {
                    assert!(
                        response["description"].is_string(),
                        "{method} {path} {status}"
                    );
                }
            }
        }
    }
}

const EXPECTED_OPENAPI_OPERATIONS: &[(&str, &str)] = &[
    ("GET", "/heartbeats"),
    ("GET", "/sessions/{session_id}/heartbeats/{schedule_id}"),
    ("POST", "/sessions/{session_id}/heartbeats/control"),
    ("POST", "/sessions/{session_id}/heartbeats/attention"),
    ("GET", "/sessions/{session_id}/integrations"),
    ("POST", "/sessions/{session_id}/integrations/refresh"),
    ("POST", "/task-launches"),
    ("GET", "/task-launches/{request_id}"),
    ("POST", "/task-launches/{request_id}/cancel"),
    ("GET", "/projects/{project_id}/task-launches"),
    ("GET", "/projects/{project_id}/task-launch-source"),
    (
        "GET",
        "/sessions/{session_id}/executions/{execution_id}/input-control",
    ),
    (
        "POST",
        "/sessions/{session_id}/executions/{execution_id}/input-control",
    ),
    (
        "POST",
        "/sessions/{session_id}/executions/{execution_id}/input",
    ),
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
    ("DELETE", "/sessions/{session_id}/terminals/{terminal_id}"),
    ("GET", "/sessions/{session_id}/executions/history"),
    ("POST", "/sessions/{session_id}/user-terminals"),
    ("GET", "/sessions/{session_id}/user-terminals"),
    ("GET", "/sessions/{session_id}/user-terminals/{terminal_id}"),
    (
        "POST",
        "/sessions/{session_id}/user-terminals/{terminal_id}/selection-preview",
    ),
    (
        "POST",
        "/sessions/{session_id}/user-terminals/{terminal_id}/selection-submissions",
    ),
    (
        "POST",
        "/sessions/{session_id}/user-terminals/{terminal_id}/observers",
    ),
    (
        "POST",
        "/sessions/{session_id}/user-terminals/{terminal_id}/observers/{observer_id}/read",
    ),
    (
        "DELETE",
        "/sessions/{session_id}/user-terminals/{terminal_id}/observers/{observer_id}",
    ),
    (
        "POST",
        "/sessions/{session_id}/user-terminals/{terminal_id}/input",
    ),
    (
        "POST",
        "/sessions/{session_id}/user-terminals/{terminal_id}/resize",
    ),
    ("POST", "/sessions/{session_id}/runs/{run_id}/cancel"),
    (
        "DELETE",
        "/sessions/{session_id}/permissions/grants/{grant_id}",
    ),
    ("DELETE", "/sessions/{session_id}/forks/{fork_id}"),
    ("DELETE", "/ssh-configs/{config_id}"),
    ("GET", "/auth"),
    ("GET", "/auth/{provider}/login/{login_id}"),
    ("GET", "/commands"),
    ("GET", "/credentials"),
    ("GET", "/fs/browse"),
    ("GET", "/health"),
    ("GET", "/ui-config"),
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
    ("GET", "/mcp_library/servers/status"),
    ("GET", "/mcp_library/servers/{server_name}/oauth/callback"),
    ("GET", "/mcp_library/servers/{server_name}/oauth/status"),
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
    ("GET", "/sessions/{session_id}/commands"),
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
    ("GET", "/sessions/{session_id}/tool-calls/{call_id}"),
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
    ("POST", "/mcp_library/servers/{server_name}/connect"),
    ("POST", "/mcp_library/servers/{server_name}/disconnect"),
    (
        "POST",
        "/mcp_library/servers/{server_name}/oauth/authenticate",
    ),
    ("POST", "/mcp_library/servers/{server_name}/oauth/configure"),
    ("POST", "/mcp_library/servers/{server_name}/oauth/logout"),
    ("POST", "/mcp_library/servers/{server_name}/reload"),
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
    (
        "POST",
        "/sessions/{session_id}/permissions/reviews/{review_id}/authorize-retry",
    ),
    (
        "POST",
        "/sessions/{session_id}/children/{child_session_id}/permissions/reviews/{review_id}/authorize-retry",
    ),
    ("POST", "/sessions/{session_id}/permissions/{request_id}"),
    ("POST", "/sessions/{session_id}/fork"),
    ("POST", "/sessions/{session_id}/regenerate"),
    ("POST", "/sessions/{session_id}/revert"),
    ("POST", "/sessions/{session_id}/user-commands"),
    ("GET", "/sessions/{session_id}/user-commands/{request_id}"),
    (
        "POST",
        "/sessions/{session_id}/user-commands/{request_id}/cancel",
    ),
    (
        "GET",
        "/sessions/{session_id}/user-commands/{request_id}/output",
    ),
    ("GET", "/sessions/{session_id}/executions"),
    (
        "POST",
        "/sessions/{session_id}/executions/{execution_id}/observers",
    ),
    (
        "POST",
        "/sessions/{session_id}/executions/{execution_id}/observers/{observer_id}/read",
    ),
    (
        "DELETE",
        "/sessions/{session_id}/executions/{execution_id}/observers/{observer_id}",
    ),
    (
        "POST",
        "/sessions/{session_id}/executions/{execution_id}/stop",
    ),
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
    ("PUT", "/sessions/{session_id}/permissions/mode"),
    ("PUT", "/managed/secrets/{name}"),
    ("PUT", "/projects/order"),
    ("PUT", "/sessions/order"),
    ("PUT", "/sessions/{session_id}/presentation"),
];

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
        .replace("{project_id}", "missing-project")
        .replace("{request_id}", "missing-request")
        .replace("{grant_id}", "missing-grant")
        .replace("{thread_name}", "missing-thread")
        .replace("{revision_id}", "1")
        .replace("{terminal_id}", "missing-terminal")
        .replace("{execution_id}", "missing-execution")
        .replace("{observer_id}", "00000000-0000-4000-8000-000000000000")
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
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
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
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("openapi_special_schemas");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, None);
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
    for schema in [
        "CreateSessionRequest",
        "UpdateConfigRequest",
        "CreateModelConfigurationRequest",
        "UpdateModelConfigurationRequest",
        "ProviderModelsRequest",
        "ModelConfigurationRecord",
        "ResolvedModelConfiguration",
    ] {
        assert!(
            document["components"]["schemas"][schema]["properties"]
                .get("allow_insecure_http")
                .is_some(),
            "{schema} must expose allow_insecure_http"
        );
    }
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
        ("post", "/sessions/{session_id}/runs/{run_id}/cancel", "400"),
        ("delete", "/sessions/{session_id}", "400"),
        (
            "delete",
            "/sessions/{session_id}/terminals/{terminal_id}",
            "400",
        ),
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
        ("post", "/sessions/{session_id}/runs/{run_id}/cancel"),
        ("delete", "/sessions/{session_id}/terminals/{terminal_id}"),
    ] {
        let content = &document["paths"][path][method]["responses"]["400"]["content"];
        assert!(
            content["application/json"].is_object(),
            "missing JSON validation error for {method} {path}"
        );
        assert!(
            content["text/plain"].is_object(),
            "missing extraction error for {method} {path}"
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
