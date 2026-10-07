use super::*;

const VECTORS: &[u8] = include_bytes!("fixtures/runtime_preparation/vectors.compact.json");
fn vectors() -> Vec<Value> {
    serde_json::from_slice::<Value>(VECTORS).unwrap()["vectors"]
        .as_array()
        .unwrap()
        .clone()
}
fn unhex(text: &str) -> Vec<u8> {
    assert_eq!(text.len() % 2, 0);
    text.as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).unwrap();
            u8::from_str_radix(pair, 16).unwrap()
        })
        .collect()
}
fn fields(value: &Value) -> Result<Fields> {
    Ok(value
        .as_object()
        .ok_or(RuntimeControlDenied)?
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect())
}
fn compare_case(
    hello: &RuntimeChannelHello,
    preparation: &RuntimePreparation,
    value: &Value,
) -> Result<i64> {
    let context = fields(value)?;
    let assignment = fields(&context["assignment"])?;
    let body = unhex(text(&context, "request_body_hex")?);
    compare_preparation(
        hello,
        preparation,
        &RuntimePreparationContext {
            assignment: &assignment,
            control_channel_id: text(&context, "control_channel_id")?,
            native_deadline_epoch_ms: integer(&context, "native_deadline_epoch_ms")?,
            native_deadline_monotonic_ms: integer(&context, "native_deadline_monotonic_ms")?,
            preparation_deadline_monotonic_ms: integer(
                &context,
                "preparation_deadline_monotonic_ms",
            )?,
            now_epoch_ms: integer(&context, "now_epoch_ms")?,
            now_monotonic_ms: integer(&context, "now_monotonic_ms")?,
            last_wall_clock_epoch_ms: integer(&context, "last_wall_clock_epoch_ms")?,
            current_key_revocation_watermark: integer(
                &context,
                "current_key_revocation_watermark",
            )?,
            request: RuntimeActualRequest {
                operation_id: text(&context, "request_operation_id")?,
                full_input_sha256: text(&context, "request_full_input_sha256")?,
                method: text(&context, "request_method")?,
                path: text(&context, "request_normalized_path")?,
                query: text(&context, "request_normalized_query")?,
                content_type: text(&context, "request_content_type")?,
                body: &body,
            },
        },
    )
}

#[test]
fn all_88_frozen_b_preparation_vectors_match_strict_bytes_digests_and_comparisons() {
    assert_eq!(
        domain_digest(b"", VECTORS),
        "00b1f67e11494409c5e238cd4eecdfcbab4b4e8bba9775be8703ade0cd9cbe70",
        "B is the sole fixture writer"
    );
    let cases = vectors();
    assert_eq!(cases.len(), 88);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let hello = RuntimeChannelHello::decode(&unhex(case["hello_raw_hex"].as_str().unwrap()));
        let prep =
            RuntimePreparation::decode(&unhex(case["preparation_raw_hex"].as_str().unwrap()));
        for (kind, result) in [
            (
                "hello",
                hello
                    .as_ref()
                    .map(|h| (h.canonical().unwrap(), h.sha256().unwrap())),
            ),
            (
                "preparation",
                prep.as_ref()
                    .map(|p| (p.canonical().unwrap(), p.sha256().unwrap())),
            ),
        ] {
            if let Some(expected) = case[format!("{kind}_canonical_utf8")].as_str() {
                let (canonical, digest) =
                    result.unwrap_or_else(|_| panic!("{name} {kind} unexpectedly denied"));
                assert_eq!(canonical, expected.as_bytes(), "{name} {kind} bytes");
                assert_eq!(
                    digest,
                    case[format!("{kind}_sha256")],
                    "{name} {kind} digest"
                );
            } else {
                assert!(result.is_err(), "{name} {kind} ambiguous schema must deny");
            }
        }
        let result = (|| compare_case(&hello?, &prep?, &case["context"]))();
        if let Some(expected) = case["remaining_lifetime_ms"].as_i64() {
            assert_eq!(
                result.unwrap_or_else(|_| panic!("{name} comparison unexpectedly denied")),
                expected,
                "{name} lifetime"
            );
        } else {
            assert!(result.is_err(), "{name} comparison must deny");
        }
    }
}

#[test]
fn comparison_never_restarts_monotonic_deadlines_and_establishes_no_consumption() {
    let case = vectors().remove(0);
    let hello =
        RuntimeChannelHello::decode(&unhex(case["hello_raw_hex"].as_str().unwrap())).unwrap();
    let prep =
        RuntimePreparation::decode(&unhex(case["preparation_raw_hex"].as_str().unwrap())).unwrap();
    let mut context = case["context"].clone();
    let remaining = compare_case(&hello, &prep, &context).unwrap();
    context["now_monotonic_ms"] = Value::from(context["now_monotonic_ms"].as_i64().unwrap() + 1);
    assert_eq!(
        compare_case(&hello, &prep, &context).unwrap(),
        remaining - 1,
        "frozen wall clock cannot extend anchored monotonic deadline"
    );
    assert_eq!(
        compare_case(&hello, &prep, &context).unwrap(),
        remaining - 1,
        "repeatable comparison consumes no nonce or authority"
    );
    context["now_monotonic_ms"] = context["preparation_deadline_monotonic_ms"].clone();
    assert!(
        compare_case(&hello, &prep, &context).is_err(),
        "exact monotonic expiry denies"
    );
}
