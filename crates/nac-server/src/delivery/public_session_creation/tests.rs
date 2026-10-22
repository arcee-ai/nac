use super::*;
use crate::{
    application::{managed_locations::tests::Fixture, Field},
    delivery::server::openapi_document,
};
use axum::{
    body::{to_bytes, Body},
    http::Request as HttpRequest,
};
use serde_json::{json, Value};
use tower::ServiceExt;

fn valid() -> Value {
    json!({"project_id":"project","working_location_id":null,"model_config_id":null,
        "behavior":"direct","first_chat":false,"first_chat_same_behavior":false})
}
fn decode(
    value: Value,
) -> Result<crate::application::public_session_creation::PublicSessionCreationCommand, ()> {
    serde_json::from_value::<PublicNacCreateSession>(value)
        .map_err(|_| ())?
        .into_command()
        .map_err(|_| ())
}
#[test]
fn public_create_decoder_matches_required_null_context_and_effort_contract() {
    assert!(decode(valid()).is_ok());
    for key in [
        "project_id",
        "working_location_id",
        "model_config_id",
        "behavior",
        "first_chat",
        "first_chat_same_behavior",
    ] {
        let mut value = valid();
        value.as_object_mut().unwrap().remove(key);
        assert!(decode(value).is_err(), "accepted missing {key}");
    }
    for patch in [
        json!({"project_id":null}),
        json!({"working_location_id":"loc"}),
        json!({"project_id":""}),
        json!({"model_config_id":""}),
        json!({"first_chat_same_behavior":true}),
        json!({"project_id":null,"working_location_id":"loc","first_chat":true}),
    ] {
        let mut value = valid();
        value
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        assert!(decode(value).is_err());
    }
    for behavior in ["direct", "direct-with-orchestrator", "orchestrator"] {
        let mut value = valid();
        value["behavior"] = json!(behavior);
        assert!(decode(value).is_ok());
    }
    assert!(matches!(
        decode(valid()).unwrap().reasoning_effort,
        Field::Unchanged
    ));
    let mut value = valid();
    value["reasoning_effort"] = Value::Null;
    assert!(matches!(
        decode(value.clone()).unwrap().reasoning_effort,
        Field::Clear
    ));
    for effort in ["", "high", "model-specific-effort"] {
        value["reasoning_effort"] = json!(effort);
        assert!(
            matches!(decode(value.clone()).unwrap().reasoning_effort, Field::Set(v) if v==effort)
        );
    }
}
#[test]
fn public_create_decoder_rejects_private_unknown_and_duplicate_fields() {
    for key in [
        "cwd",
        "workspace_id",
        "host_id",
        "ssh_host",
        "ssh_port",
        "ssh_identity_file",
        "model",
        "backend",
        "base_url",
        "api_key",
        "api_key_env",
        "extra_headers",
        "allow_insecure_http",
        "light_model",
        "sandbox",
        "expected_version",
        "config_version",
        "operation_id",
        "user_id",
        "organization_id",
    ] {
        let mut value = valid();
        value[key] = json!("private-canary");
        assert!(decode(value).is_err(), "accepted {key}");
    }
    let raw = valid().to_string();
    let duplicate = format!("{{\"project_id\":\"other\",{}", &raw[1..]);
    assert!(serde_json::from_str::<PublicNacCreateSession>(&duplicate).is_err());
}

async fn request(
    f: &Fixture,
    raw: String,
    extra: &[(&str, &str)],
    uri: &str,
) -> (StatusCode, Value) {
    let mut builder = HttpRequest::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .header("x-nac-request-id", "public-create-test");
    for (key, value) in extra {
        builder = builder.header(*key, *value);
    }
    let response = crate::router(f.manager.clone())
        .oneshot(builder.body(Body::from(raw)).unwrap())
        .await
        .unwrap();
    let status = response.status();
    assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
    let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("private-canary"));
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[tokio::test]
async fn public_create_route_is_mounted_and_refuses_missing_real_authority_without_effects() {
    let f = Fixture::new();
    nac_core::store::initialize(&f.root.join("store.db")).unwrap();
    for extra in [
        vec![],
        vec![("if-match", "\"captured\"")],
        vec![
            ("x-nac-operation-id", "private-canary"),
            ("x-user-id", "private-canary"),
            ("x-org-id", "private-canary"),
        ],
    ] {
        let (status, body) = request(&f, valid().to_string(), &extra, "/public/sessions").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body, json!({"error":"public session creation unavailable"}));
    }
    assert!(nac_core::sessions::list_sessions(&f.root.join("store.db"))
        .unwrap()
        .is_empty());
    assert!(f.manager.inner.active_sessions.read().await.is_empty());
}
#[tokio::test]
async fn public_create_route_rejects_ambiguous_context_headers_and_never_echoes_private_values() {
    let f = Fixture::new();
    nac_core::store::initialize(&f.root.join("store.db")).unwrap();
    let mut private = valid();
    private["cwd"] = json!("private-canary");
    assert_eq!(
        request(&f, private.to_string(), &[], "/public/sessions")
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    for headers in [
        vec![("if-match", "*")],
        vec![("if-match", "W/\"weak\"")],
        vec![("if-match", "\"a\""), ("if-match", "\"a\"")],
        vec![("x-nac-request-id", "duplicate")],
    ] {
        assert_eq!(
            request(&f, valid().to_string(), &headers, "/public/sessions")
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        request(
            &f,
            valid().to_string(),
            &[],
            "/public/sessions?cwd=private-canary"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(&f, "{\"private-canary\":".into(), &[], "/public/sessions")
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert!(nac_core::sessions::list_sessions(&f.root.join("store.db"))
        .unwrap()
        .is_empty());
}
#[test]
fn public_create_openapi_and_response_expose_only_restricted_shapes() {
    let document = serde_json::to_value(openapi_document()).unwrap();
    let schema = &document["components"]["schemas"]["PublicNacCreateSession"];
    assert_eq!(schema["properties"].as_object().unwrap().len(), 7);
    let required = schema["required"].as_array().unwrap();
    for key in [
        "project_id",
        "working_location_id",
        "model_config_id",
        "behavior",
        "first_chat",
        "first_chat_same_behavior",
    ] {
        assert!(required.contains(&json!(key)), "missing required {key}");
    }
    assert!(!required.contains(&json!("reasoning_effort")));
    assert!(document["paths"]["/public/sessions"]["post"].is_object());
    let response = PublicNacCreatedSession {
        session_id: "actual".into(),
        behavior: nac_core::sessions::SessionBehavior::Direct,
        project_id: None,
    };
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({"session_id":"actual","behavior":"direct","project_id":null})
    );
    assert!(serde_json::from_value::<PublicNacCreatedSession>(
        json!({"session_id":"actual","behavior":"direct"})
    )
    .is_err());
}
