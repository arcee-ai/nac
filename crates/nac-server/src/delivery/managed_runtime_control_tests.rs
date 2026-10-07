use super::*;

const VECTORS: &[u8] = include_bytes!("fixtures/runtime_control/vectors.compact.json");

fn cases() -> Vec<Value> {
    serde_json::from_slice::<Value>(VECTORS).unwrap()["vectors"]
        .as_array()
        .unwrap()
        .clone()
}
fn fields(value: &Value) -> Result<Fields> {
    Ok(value
        .as_object()
        .ok_or(RuntimeControlDenied)?
        .iter()
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect())
}

#[test]
fn frozen_b_artifact_is_verbatim_and_all_shared_vectors_match_native_bytes_and_comparisons() {
    assert_eq!(
        domain_digest(b"", VECTORS),
        "5137bd79278c446f64f3c119fd9cfa9b807708d57e2dc62a20e3b5a3ec2362dd",
        "only an explicitly accepted B-generated snapshot may change these vectors"
    );
    let vectors = cases();
    assert_eq!(
        vectors.len(),
        44,
        "qualify the entire accepted fixture, including raw invalid JSON"
    );
    for case in vectors {
        let name = case["name"].as_str().unwrap();
        let challenge = fields(&case["challenge"]).and_then(RuntimeChallenge::from_fields);
        let response = fields(&case["response"]).and_then(RuntimeResponse::from_fields);
        for (key, bytes, digest) in [
            (
                "challenge",
                challenge.as_ref().map(|c| c.canonical().unwrap()),
                challenge.as_ref().map(|c| c.sha256().unwrap()),
            ),
            (
                "response",
                response.as_ref().map(|r| r.canonical().unwrap()),
                response.as_ref().map(|r| r.sha256().unwrap()),
            ),
        ] {
            if let Some(expected) = case[format!("{key}_canonical_utf8")].as_str() {
                let actual = bytes.unwrap();
                assert_eq!(actual, expected.as_bytes(), "{name} {key} canonical bytes");
                assert_eq!(
                    digest.unwrap(),
                    case[format!("{key}_sha256")],
                    "{name} {key} domain digest"
                );
                let decoded = if key == "challenge" {
                    RuntimeChallenge::decode(&actual).map(|c| c.fields().clone())
                } else {
                    RuntimeResponse::decode(&actual).map(|r| r.fields().clone())
                };
                assert_eq!(
                    decoded.unwrap(),
                    fields(&case[key]).unwrap(),
                    "{name} {key} roundtrip"
                );
            } else {
                assert!(bytes.is_err(), "{name} {key} invalid schema must deny");
            }
            if let Some(raw) = case[format!("{key}_raw_json")].as_str() {
                let denied = if key == "challenge" {
                    RuntimeChallenge::decode(raw.as_bytes()).is_err()
                } else {
                    RuntimeResponse::decode(raw.as_bytes()).is_err()
                };
                assert!(denied, "{name} {key} raw ambiguous JSON must deny");
            }
        }
        let compared = (|| {
            let context: RuntimeComparisonContext = serde_json::from_value(case["context"].clone())
                .map_err(|_| RuntimeControlDenied)?;
            compare_exchange(&challenge?, &response?, &context)
        })();
        if let Some(expected) = case["remaining_lifetime_ms"].as_i64() {
            assert_eq!(
                compared.unwrap(),
                expected,
                "{name} remaining absolute lifetime"
            );
        } else {
            assert!(
                compared.is_err(),
                "{name} tuple/time substitution must deny"
            );
        }
    }
}

#[test]
fn strict_decoder_refuses_ambiguous_scalar_types_missing_nullable_fields_and_unbounded_input() {
    let base = cases().remove(0);
    for key in ["challenge", "response"] {
        let decode_denies = |raw: &[u8]| {
            if key == "challenge" {
                RuntimeChallenge::decode(raw).is_err()
            } else {
                RuntimeResponse::decode(raw).is_err()
            }
        };
        let raw = serde_json::to_vec(&base[key]).unwrap();
        let mut duplicate = b"{\"organization_generation\":3,".to_vec();
        duplicate.extend_from_slice(&raw[1..]);
        assert!(
            decode_denies(&duplicate),
            "duplicate keys never normalize into a grant"
        );
        let mut trailing = raw.clone();
        trailing.extend_from_slice(b"{}");
        assert!(decode_denies(&trailing), "trailing documents must deny");
        for wrong in [
            serde_json::json!({"nested": 3}),
            serde_json::json!(3.0),
            serde_json::json!(true),
            serde_json::json!(-1),
            serde_json::json!(9223372036854775808_u64),
        ] {
            let mut payload = base[key].clone();
            payload["organization_generation"] = wrong;
            assert!(
                decode_denies(&serde_json::to_vec(&payload).unwrap()),
                "non signed-i64 scalar must deny"
            );
        }
        for name in ["native_session_id", "native_run_id"] {
            let mut payload = base[key].clone();
            payload.as_object_mut().unwrap().remove(name);
            assert!(
                decode_denies(&serde_json::to_vec(&payload).unwrap()),
                "nullable fields must be explicitly present"
            );
        }
        for raw in [
            b"[]".as_slice(),
            b"{}",
            b"null",
            b"",
            b"\xff",
            b"{\"policy_revision\":\"\\ud800\"}",
        ] {
            assert!(
                decode_denies(raw),
                "invalid top-level or Unicode input must deny"
            );
        }
        assert!(
            decode_denies(&vec![b' '; MAX_BYTES + 1]),
            "raw payload length is bounded before JSON work"
        );
    }
}

#[test]
fn every_assignment_field_is_independently_compared_and_receipt_delay_never_resets_lease_lifetime()
{
    let base = cases().remove(0);
    let challenge = RuntimeChallenge::from_fields(fields(&base["challenge"]).unwrap()).unwrap();
    let response = RuntimeResponse::from_fields(fields(&base["response"]).unwrap()).unwrap();
    for (name, _) in ASSIGNMENT {
        let mut context: RuntimeComparisonContext =
            serde_json::from_value(base["context"].clone()).unwrap();
        let value = &mut context.assignment.get_mut(*name).unwrap();
        **value = match value {
            Value::Number(n) => Value::from(n.as_i64().unwrap() + 1),
            Value::String(text) if valid_uuid(&Value::String(text.clone())) => {
                Value::String("00000000-0000-4000-8000-999999999999".into())
            }
            Value::String(text) if text.len() == 64 => Value::String("d".repeat(64)),
            Value::String(text) => Value::String(format!("{text}_changed")),
            _ => panic!("unexpected fixture assignment type"),
        };
        assert!(
            compare_exchange(&challenge, &response, &context).is_err(),
            "consumer-owned {name} cannot be substituted"
        );
    }
    let mut context: RuntimeComparisonContext =
        serde_json::from_value(base["context"].clone()).unwrap();
    let original = compare_exchange(&challenge, &response, &context).unwrap();
    context.now_epoch_ms += 1;
    context.now_monotonic_ms += 1;
    assert_eq!(
        compare_exchange(&challenge, &response, &context).unwrap(),
        original - 1,
        "receipt delay does not start a new sixty-second interval"
    );
    assert_eq!(
        compare_exchange(&challenge, &response, &context).unwrap(),
        original - 1,
        "comparison is repeatable and is deliberately not a nonce/authority journal"
    );
}
