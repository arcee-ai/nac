//! Incoming MCP tool schemas and their provider-shaped request decoders.
use super::*;
use serde_json::json;

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
