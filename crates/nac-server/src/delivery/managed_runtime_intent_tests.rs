use super::*;
use axum::http::{HeaderValue, Request};

const VECTORS: &[u8] = include_bytes!("fixtures/runtime_intent/vectors.json");
fn vectors() -> Value {
    serde_json::from_slice(VECTORS).unwrap()
}
fn first() -> Value {
    vectors()["cases"][0].clone()
}
fn intent(case: &Value) -> RuntimeHttpIntent {
    RuntimeHttpIntent::decode(&serde_json::to_vec(&case["input"]).unwrap()).unwrap()
}
fn parts(intent: &RuntimeHttpIntent) -> Parts {
    Request::builder()
        .method(text(&intent.0, "method").unwrap())
        .uri(format!(
            "{}?{}",
            text(&intent.0, "normalized_path").unwrap(),
            text(&intent.0, "normalized_query").unwrap()
        ))
        .header("content-type", text(&intent.0, "content_type").unwrap())
        .header(
            "x-arcee-managed-operation-id",
            text(&intent.0, "operation_id").unwrap(),
        )
        .header("x-arcee-managed-intent-sha256", intent.sha256().unwrap())
        .body(())
        .unwrap()
        .into_parts()
        .0
}

#[test]
fn frozen_http237_vectors_match_original_canonical_bytes_digests_and_retained_comparison() {
    assert_eq!(
        digest(VECTORS),
        "9385e1b9bcbca46bdc98d29281b716ac3c01c03159d61e8ae307c9b95457037f"
    );
    let fixture = vectors();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 14);
    for case in cases {
        let intent = intent(case);
        let accepted = case["accepted"].as_bool().unwrap();
        let compared = intent.compare_retained(
            &RuntimeIntentReceiver {
                environment: case["scope"]["environment"].as_str().unwrap(),
                instance: case["scope"]["provider_instance_id"].as_str().unwrap(),
                receiver: case["receiving_machine_id"].as_str().unwrap(),
                scope: case["receiving_scope"].as_str().unwrap(),
            },
            case["full_input_sha256"].as_str().unwrap(),
            case["body_utf8"].as_str().unwrap().as_bytes(),
            case["now_epoch_ms"].as_i64().unwrap(),
        );
        assert_eq!(compared.is_ok(), accepted, "vector {}", case["name"]);
        if let Some(canonical) = case.get("canonical_utf8") {
            assert_eq!(
                intent.canonical().unwrap(),
                canonical.as_str().unwrap().as_bytes(),
                "vector {}",
                case["name"]
            );
            assert_eq!(
                intent.sha256().unwrap(),
                case["full_input_sha256"].as_str().unwrap()
            );
        }
    }
}

#[test]
fn actual_http_comparison_uses_exact_original_parts_and_bytes_and_single_carriage() {
    let case = first();
    let intent = intent(&case);
    let body = case["body_utf8"].as_str().unwrap().as_bytes();
    let now = case["now_epoch_ms"].as_i64().unwrap();
    assert!(intent.compare_actual(&parts(&intent), body, now).is_ok());
    for variant in 0..15 {
        let mut parts = parts(&intent);
        let mut actual_body = body.to_vec();
        let mut now = now;
        match variant {
            0 => parts.method = axum::http::Method::GET,
            1 => {
                parts.uri = "/api/sessions/other/runs?model=fixture&stream=true"
                    .parse()
                    .unwrap()
            }
            2 => {
                parts.uri = "/api/sessions/fixture/runs?stream=true&model=fixture"
                    .parse()
                    .unwrap()
            }
            3 => {
                parts.uri = "/api/sessions/fixture/%72uns?model=fixture&stream=true"
                    .parse()
                    .unwrap()
            }
            4 => {
                parts.uri =
                    "https://other.invalid/api/sessions/fixture/runs?model=fixture&stream=true"
                        .parse()
                        .unwrap()
            }
            5 => {
                parts.headers.insert(
                    "content-type",
                    HeaderValue::from_static("application/json; charset=utf-8"),
                );
            }
            6 => {
                parts.headers.remove("content-type");
            }
            7 => {
                parts
                    .headers
                    .append("content-type", HeaderValue::from_static("application/json"));
            }
            8 => {
                let value = parts.headers["x-arcee-managed-operation-id"].clone();
                parts.headers.append("x-arcee-managed-operation-id", value);
            }
            9 => {
                let value = parts.headers["x-arcee-managed-intent-sha256"].clone();
                parts.headers.append("x-arcee-managed-intent-sha256", value);
            }
            10 => {
                parts.headers.remove("x-arcee-managed-operation-id");
            }
            11 => {
                parts.headers.insert(
                    "x-arcee-managed-intent-sha256",
                    HeaderValue::from_static(
                        "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
                    ),
                );
            }
            12 => actual_body.push(b' '),
            13 => now = intent.original_expires_ms().unwrap(),
            _ => now -= 1,
        }
        assert!(
            intent.compare_actual(&parts, &actual_body, now).is_err(),
            "actual request substitution {variant}"
        );
    }
    let mut mutated_body: Value = serde_json::from_slice(body).unwrap();
    mutated_body["stream"] = Value::Bool(false);
    assert!(intent
        .compare_actual(
            &parts(&intent),
            &serde_json::to_vec(&mutated_body).unwrap(),
            now
        )
        .is_err());
    // Proxy headers and a lease-looking body do not replace the original bytes.
    let mut actual = parts(&intent);
    actual.headers.insert(
        "x-forwarded-uri",
        HeaderValue::from_static("/api/sessions/fixture/runs"),
    );
    assert!(intent
        .compare_actual(&actual, b"{\"lease_sequence\":1}", now)
        .is_err());
}

#[test]
fn strict_intent_decode_rejects_duplicate_schema_and_lexical_substitutions() {
    let case = first();
    let fields: Fields = serde_json::from_value(case["input"].clone()).unwrap();
    for variant in 0..12 {
        let mut fields = fields.clone();
        match variant {
            0 => {
                fields.remove("content_type");
            }
            1 => {
                fields.insert("unknown".into(), Value::from(1));
            }
            2 => {
                fields.insert("owner_epoch".into(), Value::Bool(true));
            }
            3 => {
                fields.insert("owner_epoch".into(), Value::from(-1));
            }
            4 => {
                fields.insert("owner_epoch".into(), Value::from(1.5));
            }
            5 => {
                fields.insert("owner_epoch".into(), Value::from(u64::MAX));
            }
            6 => {
                fields.insert(
                    "operation_id".into(),
                    Value::from("00000000-0000-4000-8000-00000000000A"),
                );
            }
            7 => {
                fields.insert("pvc_uid".into(), Value::Null);
            }
            8 => {
                fields.insert("actor_profile_generation".into(), Value::from(999));
            }
            9 => {
                fields.insert("method".into(), Value::from("post"));
            }
            10 => {
                fields.insert("normalized_path".into(), Value::from("/path?query"));
            }
            _ => {
                fields.insert("pvc_uid".into(), Value::from("control\ncharacter"));
            }
        }
        assert!(
            RuntimeHttpIntent::decode(&serde_json::to_vec(&fields).unwrap()).is_err(),
            "invalid intent {variant}"
        );
    }
    for raw in [
        b"{\"pvc_uid\":\"a\",\"pvc_uid\":\"b\"}".as_slice(),
        b"{\"pvc_uid\":\"\xff\"}",
        br#"{"pvc_uid":"\ud800"}"#,
        br#"{} {}"#,
    ] {
        assert!(RuntimeHttpIntent::decode(raw).is_err());
    }
    assert!(RuntimeHttpIntent::decode(&vec![b' '; 32769]).is_err());
}

#[test]
fn assignment_binding_compares_all_original_facts_without_inventing_missing_generations() {
    let case = first();
    let intent = intent(&case);
    let mut assignment = intent.0.clone();
    assignment.insert(
        "full_input_sha256".into(),
        Value::from(intent.sha256().unwrap()),
    );
    assert!(intent.compare_assignment(&assignment).is_ok());
    for name in [
        "environment",
        "provider_instance_id",
        "receiving_machine_id",
        "receiving_scope",
        "host_incarnation_id",
        "pvc_uid",
        "runtime_release",
        "policy_revision",
        "operation_id",
        "managed_host_id",
        "organization_id",
        "beneficiary_user_id",
        "beneficiary_profile_id",
        "runtime_release_sha256",
        "beneficiary_profile_generation",
        "owner_epoch",
        "key_generation",
        "full_input_sha256",
    ] {
        let mut changed = assignment.clone();
        changed.insert(name.into(), Value::Null);
        assert!(
            intent.compare_assignment(&changed).is_err(),
            "assignment field {name}"
        );
    }
    assert!(!intent.0.contains_key("organization_generation"));
    assert!(!intent.0.contains_key("beneficiary_user_generation"));
}
