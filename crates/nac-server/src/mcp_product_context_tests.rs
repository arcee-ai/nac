//! Incoming MCP tool schemas and their provider-shaped request decoders.
use super::*;
use serde_json::json;

#[tokio::test]
async fn current_http_rejects_distinct_unknown_tools_and_keeps_catalog_available() {
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    let root = std::env::temp_dir().join(format!("nac-unknown-tools-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let manager = crate::tests::test_manager(&root);
    let service = streamable_http_service(manager.clone());
    for index in 0..16 {
        let name = format!("unknown-{index}");
        let body = json!({
            "jsonrpc":"2.0", "id":index, "method":"tools/call",
            "params":{"name":name, "arguments":{}, "_meta":{
                "io.modelcontextprotocol/protocolVersion":"2026-07-28",
                "io.modelcontextprotocol/clientCapabilities":{}
            }}
        });
        let response = service
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/mcp")
                    .header("host", "localhost")
                    .header("content-type", "application/json")
                    .header("accept", "application/json, text/event-stream")
                    .header("mcp-protocol-version", "2026-07-28")
                    .header("mcp-method", "tools/call")
                    .header("mcp-name", &name)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        // Unknown tools are in-band JSON-RPC errors over the current SSE transport.
        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = to_bytes(Body::new(response.into_body()), 64 * 1024)
            .await
            .unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();
        let data = body
            .lines()
            .find_map(|line| line.strip_prefix("data:"))
            .unwrap();
        let error: serde_json::Value = serde_json::from_str(data.trim()).unwrap();
        assert_eq!(error["error"]["code"], -32602);
        assert_eq!(error["error"]["message"], "tool not found");
    }
    let response = service
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("host", "localhost")
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .header("mcp-protocol-version", "2026-07-28")
                .header("mcp-method", "tools/list")
                .body(Body::from(
                    json!({"jsonrpc":"2.0", "id":17, "method":"tools/list",
                        "params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
                "io.modelcontextprotocol/clientCapabilities":{}}}
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let body = to_bytes(Body::new(response.into_body()), 256 * 1024)
        .await
        .unwrap();
    assert!(String::from_utf8(body.to_vec())
        .unwrap()
        .contains("get_product_context"));
    manager.drain_persistence().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn product_mcp_schemas_accept_omitted_or_nullable_session_without_operation_variants() {
    let tools = NacMcpService::tool_router().list_all();
    let schema = |name: &str| {
        serde_json::to_value(
            &tools
                .iter()
                .find(|tool| tool.name == name)
                .unwrap()
                .input_schema,
        )
        .unwrap()
    };
    let read = schema("get_product_context");
    assert_eq!(read["properties"].as_object().unwrap().len(), 1);
    assert!(read["required"].as_array().is_none_or(Vec::is_empty));
    for input in [
        json!({}),
        json!({"session_id": null}),
        json!({"session_id": "existing-session"}),
    ] {
        assert!(serde_json::from_value::<ProductContextParams>(input).is_ok());
    }
    let resolve = schema("resolve_product_destination");
    assert_eq!(resolve["properties"].as_object().unwrap().len(), 3);
    assert_eq!(
        resolve["properties"]["destination"]["enum"],
        json!(crate::ProductDestination::ALL)
    );
    assert_eq!(
        resolve["required"],
        json!(["destination", "expected_build_id"])
    );
    assert_eq!(resolve["additionalProperties"], false);
    for destination in crate::ProductDestination::ALL {
        for session in [
            None,
            Some(serde_json::Value::Null),
            Some(json!("existing-session")),
        ] {
            let mut input = json!({"destination": destination, "expected_build_id": "build"});
            if let Some(session) = session {
                input["session_id"] = session;
            }
            assert!(serde_json::from_value::<ProductNavigationParams>(input).is_ok());
        }
    }
    assert!(serde_json::from_value::<ProductNavigationParams>(
        json!({"destination": "mcp-settings", "expected_build_id": null, "session_id": null})
    )
    .is_err());
}
