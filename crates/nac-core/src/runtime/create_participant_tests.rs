//! NEW comparison-reader controls only. No admission literals, resource mint,
//! TLS enrollment, original source fixture or production success is simulated.
//! Authenticated owner/kernel/cleanup controls need a separate real fixture lane.
use super::*;
use serde_json::json;

fn data() -> Value {
    let id = "10000000-0000-4000-8000-000000000001";
    let mut canonical = json!([
        "native-session-operation-v3",
        "environment",
        "provider",
        id,
        1,
        id,
        2,
        id,
        3,
        id,
        "incarnation",
        4,
        5,
        id,
        6,
        ["create"],
        ["project", "project", ([1_u8; 32])],
        "model",
        ([2_u8; 32]),
        ([3_u8; 32]),
        ([4_u8; 32])
    ]);
    // serde_json's json! macro takes Rust expressions for the fixed arrays.
    canonical[16][2] = serde_json::to_value([1_u8; 32]).unwrap();
    let encoded = serde_json::to_vec(&canonical).unwrap();
    let digest: [u8; 32] = Sha256::digest(encoded).into();
    json!({
        "schema": nac_runtime_auth::CREATE_PURPOSE, "purpose": nac_runtime_auth::CREATE_PURPOSE,
        "request_id": id, "operation": {"id": id, "claim_sequence": 1, "session_id": id},
        "intent": {"canonical": canonical, "sha256": hex(&digest), "configuration_sha256": hex(&[3; 32])},
        "host": {"logical_host_id": id, "host_incarnation_id": "incarnation", "authority_epoch": "4",
            "release_id": "release", "schema_version": 40, "if_match": format!("\"{}\"", "a".repeat(64))},
        "request": {"project_id": "project", "working_location_id": null, "model_config_id": "model",
            "behavior": "direct", "first_chat": false, "first_chat_same_behavior": false}
    })
}
fn read(value: &Value) -> Result<Command> {
    decode(&serde_json::to_vec(value)?)
}

#[test]
fn omitted_null_and_value_reasoning_remain_distinct_data() {
    let mut value = data();
    assert!(matches!(
        read(&value).unwrap().effort,
        OptionalModelOption::Inherit
    ));
    value["request"]["reasoning_effort"] = Value::Null;
    assert!(matches!(
        read(&value).unwrap().effort,
        OptionalModelOption::Clear
    ));
    value["request"]["reasoning_effort"] = json!("high");
    assert!(matches!(
        read(&value).unwrap().effort,
        OptionalModelOption::Value(_)
    ));
    value["request"]["reasoning_effort"] = json!("unsupported");
    assert!(read(&value).is_err());
}
#[test]
fn duplicate_keys_at_any_depth_refuse_before_projection() {
    let bytes = serde_json::to_string(&data()).unwrap();
    let duplicate = bytes.replacen(
        "\"claim_sequence\":1",
        "\"claim_sequence\":1,\"claim_sequence\":1",
        1,
    );
    assert_ne!(bytes, duplicate);
    assert!(decode(duplicate.as_bytes()).is_err());
    let duplicate = bytes.replacen(
        "\"behavior\":\"direct\"",
        "\"behavior\":\"direct\",\"behavior\":\"direct\"",
        1,
    );
    assert_ne!(bytes, duplicate);
    assert!(decode(duplicate.as_bytes()).is_err());
}
#[test]
fn malformed_numbers_fields_and_bindings_refuse() {
    for replacement in [json!(0), json!(-1), json!(1.0), Value::Null, json!("1")] {
        let mut value = data();
        value["operation"]["claim_sequence"] = replacement;
        assert!(read(&value).is_err());
    }
    for (pointer, replacement) in [
        ("/schema", json!("other")),
        ("/purpose", json!("other")),
        ("/request_id", json!("20000000-0000-4000-8000-000000000001")),
        ("/request/project_id", json!("other")),
        ("/request/working_location_id", json!("location")),
        ("/request/model_config_id", json!("other")),
        ("/host/authority_epoch", json!(4)),
        ("/host/if_match", json!("weak")),
        ("/intent/sha256", json!("0".repeat(64))),
        ("/request/first_chat_same_behavior", json!(true)),
    ] {
        let mut value = data();
        *value.pointer_mut(pointer).unwrap() = replacement;
        assert!(read(&value).is_err(), "{pointer}");
    }
    let mut value = data();
    value["request"]["unrecognized"] = json!(true);
    assert!(read(&value).is_err());
}
#[test]
fn hostile_shapes_remain_bounded_comparison_failures() {
    for bytes in [b"".as_slice(), b"null", b"[]", b"{}", b"{\"x\":1,\"x\":2}"] {
        assert!(decode(bytes).is_err());
    }
    let mut value = data();
    value["host"]["if_match"] = json!(format!("\"{}\"", "é".repeat(32)));
    assert!(read(&value).is_err());
    let mut value = data();
    value["operation"]["session_id"] = json!(Uuid::nil().to_string());
    assert!(read(&value).is_err());
    let mut value = data();
    value["request"]["project_id"] = json!("x".repeat(257));
    assert!(read(&value).is_err());
}
