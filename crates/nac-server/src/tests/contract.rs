use super::*;

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
    ("DELETE", "/sessions/{session_id}/forks/{fork_id}"),
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
    ("GET", "/sessions/{session_id}/spawns"),
    ("GET", "/sessions/{session_id}/spawns/{child_session_id}"),
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
    ("POST", "/sessions/{session_id}/spawns"),
    (
        "POST",
        "/sessions/{session_id}/spawns/{child_session_id}/cancel",
    ),
    ("POST", "/sessions/{session_id}/permissions/{request_id}"),
    ("POST", "/sessions/{session_id}/continue"),
    ("POST", "/sessions/{session_id}/fork"),
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
    assert!(delivery::session_runs::event_cursor(&EventsQuery {
        after_epoch_id: None,
        after_sequence_id: None,
        limit: None,
    })
    .unwrap()
    .is_none());
    assert!(delivery::session_runs::event_cursor(&EventsQuery {
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
        let error = delivery::session_runs::event_cursor(&query).unwrap_err();
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
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
    )
    .unwrap();
    assert_eq!(inherited.reasoning_effort, OptionalModelOption::Inherit);
    assert_eq!(inherited.api_key_env, OptionalModelOption::Inherit);
    assert_eq!(inherited.extra_headers, None);

    let explicit = model_options(
        Field::Set(" model-a ".to_string()),
        Field::Set(" https://example.com/v1 ".to_string()),
        Field::Set("openai-responses".to_string()),
        Field::Set("xhigh".to_string()),
        Field::Clear,
        Field::Clear,
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
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Unchanged,
        Field::Set(raw_selector.to_string()),
        Field::Unchanged,
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
        let request = request.into_application();
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
    const HTML: &str = include_str!("../../assets/dist/index.html");

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
