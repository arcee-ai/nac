//! Optional-argument contracts exercised through the ordinary prepared kernel.
use super::*;

fn nullable_find() -> Value {
    json!({"session_id":null,"reference":null,"text":null,"project_id":null,"after":null,"limit":null})
}

fn without_receipt(mut value: Value) -> Value {
    value.as_object_mut().unwrap().remove("as_of");
    value
}

#[test]
fn discovery_schemas_allow_omission_and_null_without_requiring_placeholders() {
    let definitions = crate::tools::direct_tool_definitions(false);
    let parameters = |name| {
        &definitions
            .iter()
            .find(|tool| tool.function.name == name)
            .unwrap()
            .function
            .parameters
    };
    let find = parameters("find_tasks");
    assert!(find.get("required").is_none());
    for field in ["session_id", "reference", "text", "project_id", "after"] {
        assert_eq!(find["properties"][field]["type"], json!(["string", "null"]));
    }
    assert_eq!(
        find["properties"]["limit"]["type"],
        json!(["integer", "null"])
    );
    assert_eq!(find["properties"]["limit"]["default"], DEFAULT_LIMIT);
    assert_eq!(find["properties"]["limit"]["minimum"], 1);
    assert_eq!(
        find["properties"]["limit"]["maximum"],
        store::MAX_TASK_SEARCH_LIMIT
    );
    let read = parameters("read_task");
    assert_eq!(read["required"], json!(["session_id"]));
    assert_eq!(read["properties"]["session_id"]["type"], "string");
    assert_eq!(
        read["properties"]["project_id"]["type"],
        json!(["string", "null"])
    );
    for schema in [find, read] {
        assert_eq!(schema["additionalProperties"], false);
        assert!(schema["properties"]["_nac"].is_object());
    }
}

#[tokio::test]
async fn sparse_and_fully_nullable_searches_and_reads_are_equivalent() {
    let runtime = runtime(Vec::new());
    for selector in [None, Some("reference"), Some("text"), Some("session_id")] {
        let mut sparse = json!({});
        let mut nullable = nullable_find();
        if let Some(field) = selector {
            let value = match field {
                "reference" => "ALL-469",
                "text" => "attempt one",
                _ => "peer-a",
            };
            sparse[field] = json!(value);
            nullable[field] = json!(value);
        }
        let expected = without_receipt(value(&runtime, "find_tasks", sparse).await);
        assert_eq!(
            expected["status"],
            if selector == Some("session_id") {
                "found"
            } else {
                "ok"
            }
        );
        for control in [None, Some(Value::Null)] {
            let mut input = nullable.clone();
            if let Some(control) = control {
                input["_nac"] = control;
            }
            assert_eq!(
                without_receipt(value(&runtime, "find_tasks", input).await),
                expected
            );
        }
    }
    let expected =
        without_receipt(value(&runtime, "read_task", json!({"session_id":"peer-a"})).await);
    let actual = value(
        &runtime,
        "read_task",
        json!({"session_id":"peer-a","project_id":null,"_nac":null}),
    )
    .await;
    assert_eq!(without_receipt(actual), expected);

    // Null limit really selects the existing default, not an empty page or all rows.
    for index in 0..DEFAULT_LIMIT {
        session(
            &runtime.store_path,
            &format!("extra-{index}"),
            Some("p1"),
            "another attempt",
        );
    }
    let recent = value(&runtime, "find_tasks", nullable_find()).await;
    assert_eq!(
        recent["candidates"].as_array().unwrap().len(),
        DEFAULT_LIMIT
    );
    assert!(recent["next_after"].is_string());
    cleanup(&runtime);
}

#[tokio::test]
async fn nullable_searches_keep_cross_project_and_pagination_bindings() {
    let runtime = runtime(Vec::new());
    let mut input = nullable_find();
    input["project_id"] = json!("p2");
    let found = value(&runtime, "find_tasks", input.clone()).await;
    assert_eq!(found["scope"], json!({"project_id":"p2","explicit":true}));
    assert_eq!(found["candidates"][0]["session_id"], "foreign");
    assert_eq!(
        value(
            &runtime,
            "read_task",
            json!({"session_id":"foreign","project_id":"p2","_nac":null})
        )
        .await["status"],
        "found"
    );

    input["project_id"] = Value::Null;
    input["reference"] = json!("ALL-469");
    input["limit"] = json!(1);
    let first = value(&runtime, "find_tasks", input.clone()).await;
    input["after"] = first["next_after"].clone();
    let second = value(&runtime, "find_tasks", input.clone()).await;
    assert_eq!(second["candidates"].as_array().unwrap().len(), 1);
    assert_ne!(
        first["candidates"][0]["session_id"],
        second["candidates"][0]["session_id"]
    );
    input["project_id"] = json!("p2");
    assert!(call(&runtime, "find_tasks", input).await.is_error);
    cleanup(&runtime);
}

#[tokio::test]
async fn nullable_contract_does_not_convert_blanks_or_relax_invalid_arguments() {
    let runtime = runtime(Vec::new());
    for field in ["session_id", "reference", "text", "project_id", "after"] {
        for invalid in [json!(""), json!(" \t"), json!(false), json!(17)] {
            let mut input = nullable_find();
            input[field] = invalid;
            assert!(
                call(&runtime, "find_tasks", input.clone()).await.is_error,
                "{input}"
            );
        }
    }
    for invalid in [
        json!(-1),
        json!(0),
        json!(store::MAX_TASK_SEARCH_LIMIT + 1),
        json!(1.5),
        json!("10"),
    ] {
        let mut input = nullable_find();
        input["limit"] = invalid;
        assert!(
            call(&runtime, "find_tasks", input.clone()).await.is_error,
            "{input}"
        );
    }
    for input in [
        json!({"reference":"ALL-469","text":"attempt"}),
        json!({"session_id":"peer-a","reference":""}),
        json!({"session_id":"peer-a","after":"not-a-cursor"}),
        json!({"after":"not-a-cursor"}),
        json!({"session_id":"x".repeat(MAX_ID_BYTES + 1)}),
        json!({"project_id":"x".repeat(MAX_ID_BYTES + 1)}),
        json!({"text":"x".repeat(store::MAX_TASK_TEXT_BYTES + 1)}),
        json!({"after":"x".repeat(513)}),
        json!({"unknown":null}),
    ] {
        assert!(
            call(&runtime, "find_tasks", input.clone()).await.is_error,
            "{input}"
        );
    }
    for input in [
        json!({"session_id":null}),
        json!({"session_id":""}),
        json!({"session_id":"peer-a","project_id":""}),
        json!({"session_id":"peer-a","unknown":null}),
    ] {
        assert!(
            call(&runtime, "read_task", input.clone()).await.is_error,
            "{input}"
        );
    }
    cleanup(&runtime);
}

#[tokio::test]
async fn nullable_calls_remain_passive_and_respect_project_and_session_denials() {
    let runtime = runtime(vec![PermissionRule::new(
        "task_read",
        "session:peer-b",
        PermissionEffect::Deny,
    )]);
    let goal =
        crate::store::create_session_goal(&runtime.store_path, "peer-a", "finish", None, None)
            .unwrap();
    let inbox = crate::store::create_session_inbox_item(
        &runtime.store_path,
        "peer-a",
        InboxDelivery::Queue,
        "next",
        None,
        None,
    )
    .unwrap();
    let found = value(&runtime, "find_tasks", nullable_find()).await;
    assert_eq!(found["candidates"].as_array().unwrap().len(), 1);
    assert_eq!(found["candidates"][0]["session_id"], "peer-a");
    let read = value(
        &runtime,
        "read_task",
        json!({"session_id":"peer-a","project_id":null}),
    )
    .await;
    assert_eq!(read["task"]["ephemeral"]["approvals"], "unknown");
    assert!(
        call(
            &runtime,
            "read_task",
            json!({"session_id":"peer-b","project_id":null})
        )
        .await
        .is_error
    );
    assert_eq!(
        crate::store::load_session_goal(&runtime.store_path, "peer-a").unwrap(),
        Some(goal)
    );
    assert_eq!(
        crate::store::list_session_inbox(&runtime.store_path, "peer-a").unwrap()[0].id,
        inbox.id
    );
    assert!(
        crate::store::load_run_recovery(&runtime.store_path, "peer-a")
            .unwrap()
            .is_none()
    );
    cleanup(&runtime);

    let denied = super::runtime(vec![PermissionRule::new(
        "task_read",
        "project:p1",
        PermissionEffect::Deny,
    )]);
    for (name, input) in [
        ("find_tasks", nullable_find()),
        (
            "read_task",
            json!({"session_id":"peer-a","project_id":null}),
        ),
    ] {
        let result = call(&denied, name, input).await;
        assert!(result.is_error);
        assert!(!result.content.as_text().unwrap().contains("attempt one"));
    }
    cleanup(&denied);
}

#[tokio::test]
async fn responses_generated_arguments_enter_the_prepared_decoder_and_permission_path() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    let runtime = runtime(vec![PermissionRule::new(
        "task_read",
        "session:peer-b",
        PermissionEffect::Deny,
    )]);
    for (name, input, denied) in [
        ("find_tasks", nullable_find(), false),
        (
            "read_task",
            json!({"session_id":"peer-a","project_id":null,"_nac":null}),
            false,
        ),
        (
            "read_task",
            json!({"session_id":"peer-b","project_id":null}),
            true,
        ),
    ] {
        // Deterministic provider fixture, not a claim of live model qualification.
        let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", json!({
            "status":"completed", "output":[{"type":"function_call","call_id":"call-1","name":name,"arguments":input.to_string()}]
        }).to_string())]);
        let client = crate::model::ModelClient::new_for_test_server(server.base_url.clone());
        let response = client
            .send_turn(
                vec![crate::types::Message::User {
                    content: "Inspect existing tasks".into(),
                }],
                crate::tools::direct_tool_definitions(false),
            )
            .await
            .unwrap();
        let generated = &response.assistant.tool_calls.unwrap()[0];
        let result = call(
            &runtime,
            &generated.function.name,
            serde_json::from_str(&generated.function.arguments).unwrap(),
        )
        .await;
        assert_eq!(result.is_error, denied, "{}", result.content);
        assert_eq!(server.finish().len(), 1);
    }
    cleanup(&runtime);
}
