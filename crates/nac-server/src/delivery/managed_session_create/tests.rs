//! Synthetic AFM command data; actual Native router/TLS/host resources. These
//! controls deliberately qualify no Core preparation or AFM primary authority.
use super::*;
use crate::{
    application::managed_locations::tests::Fixture,
    delivery::managed_runtime_tls::{
        tests::{exchange, identity},
        RuntimeTlsListener,
    },
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn fixture() -> Fixture {
    let mut f = Fixture::new();
    f.config.logical_host_id = Uuid::from_u128(7).to_string();
    f.manager = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("store.db")),
        worker_executable: None,
        managed_host: Some(f.config.clone()),
    })
    .unwrap();
    nac_core::store::initialize(&f.manager.inner.store_path).unwrap();
    f
}
fn lower_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn rehash(value: &mut Value) {
    value["intent"]["sha256"] = json!(lower_hex(&Sha256::digest(
        serde_json::to_vec(&value["intent"]["canonical"]).unwrap()
    )));
}
fn envelope(f: &Fixture) -> Value {
    let binding = f.manager.managed_location_binding().unwrap();
    let canonical = json!([
        "native-session-operation-v3",
        "dev3",
        "provider",
        Uuid::from_u128(1),
        4,
        Uuid::from_u128(2),
        5,
        Uuid::from_u128(3),
        6,
        Uuid::from_u128(7),
        binding.host_incarnation_id,
        9,
        10,
        Uuid::from_u128(12),
        13,
        ["create"],
        ["project", "project", vec![16; 32]],
        "model",
        vec![18; 32],
        vec![20; 32],
        vec![19; 32]
    ]);
    let mut value = json!({
        "schema":PURPOSE,"purpose":PURPOSE,"request_id":Uuid::from_u128(21),
        "operation":{"id":Uuid::from_u128(21),"claim_sequence":1,"session_id":Uuid::from_u128(22)},
        "intent":{"canonical":canonical,"sha256":"", "configuration_sha256":lower_hex(&[20;32])},
        "host":{"logical_host_id":Uuid::from_u128(7),"host_incarnation_id":binding.host_incarnation_id,
            "authority_epoch":"9","release_id":binding.release_id,"schema_version":binding.supported_schema_version,
            "if_match":format!("\"{}\"","a".repeat(64))},
        "request":{"project_id":"project","working_location_id":null,"model_config_id":null,
            "behavior":"direct","first_chat":false,"first_chat_same_behavior":false}
    });
    rehash(&mut value);
    value
}
fn decode(
    value: Value,
    f: &Fixture,
) -> Result<crate::application::managed_create_request::ValidatedManagedCreateRequest, StatusCode> {
    let request_id = Uuid::from_u128(21).to_string();
    serde_json::from_value::<contracts::EnvelopeV1>(value)
        .map_err(|_| StatusCode::BAD_REQUEST)?
        .validate(
            &request_id,
            &format!("\"{}\"", "a".repeat(64)),
            &f.manager,
            std::time::Instant::now() + std::time::Duration::from_secs(30),
            super::super::utc_epoch_ms().unwrap() + 30_000,
        )
}
fn headers() -> Vec<(&'static str, String)> {
    vec![
        ("accept", "application/json".into()),
        ("content-type", "application/json".into()),
        ("x-nac-request-id", Uuid::from_u128(21).to_string()),
        ("if-match", format!("\"{}\"", "a".repeat(64))),
        (
            "x-nac-expires-at-epoch-ms",
            (super::super::utc_epoch_ms().unwrap() + 30_000).to_string(),
        ),
    ]
}

#[test]
fn internal_create_decoder_matches_actual_afm_shape_and_preserves_effort() {
    let f = fixture();
    assert!(decode(envelope(&f), &f).is_ok());
    for effort in [Value::Null, json!(""), json!("high")] {
        let mut value = envelope(&f);
        value["request"]["reasoning_effort"] = effort;
        assert!(decode(value, &f).is_ok());
    }
    let mut location = envelope(&f);
    location["request"]["project_id"] = Value::Null;
    location["request"]["working_location_id"] = json!("approved-opaque-id");
    location["intent"]["canonical"][16] = json!(["location", "approved-opaque-id", vec![16; 32]]);
    rehash(&mut location);
    assert!(
        decode(location, &f).is_ok(),
        "DATA validation grants no location mapping/approval"
    );
}
#[test]
fn internal_create_decoder_rejects_unknown_duplicate_missing_and_private_fields() {
    let f = fixture();
    for parent in ["operation", "intent", "host", "request"] {
        let mut value = envelope(&f);
        value[parent]["grant"] = json!("private-canary");
        assert!(decode(value, &f).is_err(), "accepted {parent} unknown");
    }
    for key in [
        "schema",
        "purpose",
        "request_id",
        "operation",
        "intent",
        "host",
        "request",
    ] {
        let mut value = envelope(&f);
        value.as_object_mut().unwrap().remove(key);
        assert!(decode(value, &f).is_err(), "accepted missing {key}");
    }
    for key in [
        "expires_at_epoch_ms",
        "grant",
        "principal",
        "native_runtime",
        "verified",
    ] {
        let mut value = envelope(&f);
        value[key] = json!("private-canary");
        assert!(decode(value, &f).is_err());
    }
    let raw = envelope(&f).to_string();
    let duplicate = format!("{{\"purpose\":\"{}\",{}", PURPOSE, &raw[1..]);
    assert!(serde_json::from_str::<contracts::EnvelopeV1>(&duplicate).is_err());
}
#[test]
fn internal_create_decoder_checks_every_canonical_member_before_digest_acceptance() {
    let f = fixture();
    // Recompute the digest for every malformed intent: a matching wire hash
    // must never make a malformed or substituted canonical member acceptable.
    for index in 0..21 {
        let mut value = envelope(&f);
        value["intent"]["canonical"][index] = json!({"private-canary":true});
        rehash(&mut value);
        assert!(
            decode(value, &f).is_err(),
            "accepted canonical member {index}"
        );
    }
    for (index, replacement) in [
        (11, json!(0)),
        (12, json!(-1)),
        (16, json!(["project", "other", vec![16; 32]])),
        (15, json!(["cold_activate", Uuid::from_u128(22), 1])),
        (19, json!(vec![20; 31])),
        (3, json!(Uuid::nil())),
        (10, json!("other-incarnation")),
    ] {
        let mut value = envelope(&f);
        value["intent"]["canonical"][index] = replacement;
        rehash(&mut value);
        assert!(
            decode(value, &f).is_err(),
            "accepted substituted member {index}"
        );
    }
}
#[test]
fn internal_create_decoder_requires_exact_claim_digest_host_and_context_pairing() {
    let f = fixture();
    for (parent, key, replacement) in [
        ("operation", "claim_sequence", json!(0)),
        ("operation", "id", json!(Uuid::nil())),
        ("operation", "session_id", json!(Uuid::nil())),
        ("intent", "sha256", json!("0".repeat(64))),
        ("intent", "configuration_sha256", json!("0".repeat(64))),
        ("host", "authority_epoch", json!("09")),
        ("host", "release_id", json!("other")),
        ("host", "schema_version", json!(1)),
        ("host", "if_match", json!(format!("\"{}\"", "b".repeat(64)))),
        ("request", "model_config_id", json!("other-model")),
    ] {
        let mut value = envelope(&f);
        value[parent][key] = replacement;
        assert!(decode(value, &f).is_err(), "accepted {parent}.{key}");
    }
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn internal_create_decoder_preserves_same_binding_allocation_through_closed_application_entry() {
    use crate::application::public_session_creation::PublicCreationError;
    let f = fixture();
    let value = envelope(&f);
    let validated = decode(value.clone(), &f).ok().unwrap();
    let address = validated.binding() as *const _ as usize;
    let cutoff = validated.currentness().original_cutoff;
    let expiry = validated.currentness().original_expiry_epoch_ms;
    let refusal = f
        .manager
        .session_creation()
        .create_managed_session(validated);
    assert_eq!(
        refusal.error(),
        PublicCreationError::RequiredAuthorityUnavailable
    );
    let original = refusal.request();
    assert_eq!(original.binding() as *const _ as usize, address);
    assert_eq!(original.binding().operation_id, Uuid::from_u128(21));
    assert_eq!(original.binding().claim_sequence, 1);
    assert_eq!(original.binding().intended_session_id, Uuid::from_u128(22));
    assert_eq!(
        original.binding().canonical_intent,
        value["intent"]["canonical"]
    );
    assert_eq!(original.binding().configuration_sha256, [20; 32]);
    let expected_hash: [u8; 32] =
        Sha256::digest(serde_json::to_vec(&value["intent"]["canonical"]).unwrap()).into();
    assert_eq!(original.binding().intent_sha256, expected_hash);
    assert_eq!(
        original.currentness().native,
        f.manager.managed_location_binding().unwrap()
    );
    assert_eq!(original.currentness().original_cutoff, cutoff);
    assert_eq!(original.currentness().original_expiry_epoch_ms, expiry);
    assert_eq!(
        original.currentness().request.if_match.as_deref(),
        value["host"]["if_match"].as_str()
    );
    assert!(
        matches!(original.command().context,crate::application::public_session_creation::PublicCreationContext::Project(ref id) if id=="project")
    );
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
    assert!(f
        .manager
        .inner
        .active_sessions
        .try_read()
        .unwrap()
        .is_empty());
}

#[test]
fn internal_create_decoder_dropped_or_incoherent_operation_fields_never_reach_application_entry() {
    let f = fixture();
    for key in ["id", "claim_sequence", "session_id"] {
        let mut value = envelope(&f);
        value["operation"].as_object_mut().unwrap().remove(key);
        assert!(matches!(decode(value, &f), Err(StatusCode::BAD_REQUEST)));
    }
    let mut value = envelope(&f);
    value["operation"]["id"] = json!(Uuid::from_u128(99));
    assert!(matches!(decode(value, &f), Err(StatusCode::BAD_REQUEST)));
    let mut value = envelope(&f);
    value["operation"]["claim_sequence"] = json!(0);
    assert!(matches!(decode(value, &f), Err(StatusCode::BAD_REQUEST)));
}

#[test]
fn internal_create_decoder_currentness_or_original_cutoff_change_refuses_before_core() {
    use crate::application::public_session_creation::PublicCreationError;
    let f = fixture();
    let validated = decode(envelope(&f), &f).ok().unwrap();
    let mut other = f.config.clone();
    other.host_incarnation_id = Some("replaced-incarnation".into());
    let replacement = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.manager.inner.store_path.clone()),
        worker_executable: None,
        managed_host: Some(other),
    })
    .unwrap();
    let refusal = replacement
        .session_creation()
        .create_managed_session(validated);
    assert_eq!(refusal.error(), PublicCreationError::SourceChanged);
    assert_eq!(
        refusal.request().binding().intended_session_id,
        Uuid::from_u128(22)
    );
    let expired = serde_json::from_value::<contracts::EnvelopeV1>(envelope(&f))
        .ok()
        .unwrap()
        .validate(
            &Uuid::from_u128(21).to_string(),
            &format!("\"{}\"", "a".repeat(64)),
            &f.manager,
            std::time::Instant::now() - std::time::Duration::from_secs(1),
            super::super::utc_epoch_ms().unwrap() + 30_000,
        )
        .ok()
        .unwrap();
    let refusal = f.manager.session_creation().create_managed_session(expired);
    assert_eq!(refusal.error(), PublicCreationError::SourceChanged);
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn internal_create_decoder_owned_request_is_neither_clone_nor_wire_material() {
    use crate::application::managed_create_request::{
        ManagedCreateBinding, ManagedCreateCurrentness, ManagedCreateRefusal,
        ValidatedManagedCreateRequest,
    };
    // Resolving the inferred trait argument is ambiguous if the target ever
    // gains the forbidden trait. This is a compile-time negative assertion.
    macro_rules! assert_not_impl {
        ($target:ty,$bound:path) => {{
            trait Ambiguous<A> {
                fn probe() {}
            }
            impl<T: ?Sized> Ambiguous<()> for T {}
            struct Marker;
            impl<T: ?Sized + $bound> Ambiguous<Marker> for T {}
            let _ = <$target as Ambiguous<_>>::probe;
        }};
    }
    assert_not_impl!(ValidatedManagedCreateRequest, Clone);
    assert_not_impl!(ValidatedManagedCreateRequest, serde::Serialize);
    assert_not_impl!(ValidatedManagedCreateRequest, serde::de::DeserializeOwned);
    assert_not_impl!(ManagedCreateBinding, Clone);
    assert_not_impl!(ManagedCreateBinding, serde::Serialize);
    assert_not_impl!(ManagedCreateCurrentness, serde::Serialize);
    assert_not_impl!(ManagedCreateRefusal, Clone);
    assert_not_impl!(ManagedCreateRefusal, serde::Serialize);
}

#[tokio::test]
async fn internal_create_decoder_forwarded_peer_headers_cannot_create_transport_marker() {
    use tower::ServiceExt;
    let f = fixture();
    let mut request = axum::http::Request::builder().method("POST").uri(PATH);
    for (key, value) in headers() {
        request = request.header(key, value);
    }
    let response = super::super::router(f.manager.clone())
        .oneshot(
            request
                .header("x-forwarded-client-cert", "private-canary")
                .body(axum::body::Body::from(
                    serde_json::to_vec(&envelope(&f)).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert!(!String::from_utf8_lossy(&body).contains("private-canary"));
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn internal_create_tls_enrolled_peer_valid_data_still_refuses_effects() {
    let f = fixture();
    let listener =
        RuntimeTlsListener::bind_create_issuer("127.0.0.1:0".parse().unwrap(), identity())
            .await
            .unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, done) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(super::super::serve_managed_location_facts(
        listener,
        f.manager.clone(),
        async {
            let _ = done.await;
        },
    ));
    let original = envelope(&f);
    let response = exchange(
        address,
        Some("d-service"),
        "POST",
        PATH,
        &serde_json::to_vec(&original).unwrap(),
        &headers(),
    )
    .await
    .unwrap();
    assert_eq!(response.0, 503);
    assert_eq!(
        response.1,
        json!({"error":"managed session creation unavailable"})
    );
    for (field, replacement, expected) in [
        ("purpose", json!("working-location-facts.v1"), 400),
        ("schema", json!("managed-session-create.v2"), 400),
    ] {
        let mut value = original.clone();
        value[field] = replacement;
        assert_eq!(
            exchange(
                address,
                Some("d-service"),
                "POST",
                PATH,
                &serde_json::to_vec(&value).unwrap(),
                &headers()
            )
            .await
            .unwrap()
            .0,
            expected
        );
    }
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
    assert!(f.manager.inner.active_sessions.read().await.is_empty());
    stop.send(()).unwrap();
    task.await.unwrap().unwrap();
}
#[tokio::test]
async fn internal_create_tls_wrong_peers_headers_and_public_listener_cannot_supply_authority() {
    use tower::ServiceExt;
    let f = fixture();
    let listener =
        RuntimeTlsListener::bind_create_issuer("127.0.0.1:0".parse().unwrap(), identity())
            .await
            .unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, done) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(super::super::serve_managed_location_facts(
        listener,
        f.manager.clone(),
        async {
            let _ = done.await;
        },
    ));
    let body = serde_json::to_vec(&envelope(&f)).unwrap();
    for peer in [None, Some("wrong-peer"), Some("untrusted")] {
        assert!(exchange(address, peer, "POST", PATH, &body, &headers())
            .await
            .is_err());
    }
    for (key, value, expected) in [
        ("if-match", "duplicate", 400),
        ("x-nac-request-id", "duplicate", 400),
        ("x-nac-expires-at-epoch-ms", "duplicate", 403),
        ("authorization", "Bearer private-canary", 400),
    ] {
        let mut h = headers();
        h.push((key, value.into()));
        let response = exchange(address, Some("d-service"), "POST", PATH, &body, &h)
            .await
            .unwrap();
        assert_eq!(response.0, expected);
        assert!(!response.1.to_string().contains("private-canary"));
    }
    let mut h = headers();
    h.retain(|(key, _)| *key != "if-match");
    assert_eq!(
        exchange(address, Some("d-service"), "POST", PATH, &body, &h)
            .await
            .unwrap()
            .0,
        428
    );
    let response = crate::router(f.manager.clone())
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri(PATH)
                .body(axum::body::Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    stop.send(()).unwrap();
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn internal_create_tls_body_wait_keeps_the_original_cutoff_without_renewal() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let f = fixture();
    let listener =
        RuntimeTlsListener::bind_create_issuer("127.0.0.1:0".parse().unwrap(), identity())
            .await
            .unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, done) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(super::super::serve_managed_location_facts(
        listener,
        f.manager.clone(),
        async {
            let _ = done.await;
        },
    ));
    let mut stream =
        crate::delivery::managed_runtime_tls::tests::client(address, Some("d-service"))
            .await
            .unwrap();
    let mut h = headers();
    let cutoff = super::super::utc_epoch_ms().unwrap() + 250;
    h.iter_mut()
        .find(|(key, _)| *key == "x-nac-expires-at-epoch-ms")
        .unwrap()
        .1 = cutoff.to_string();
    let fields = h
        .iter()
        .map(|(key, value)| format!("{key}: {value}\r\n"))
        .collect::<String>();
    let raw = format!("POST {PATH} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 100\r\n{fields}\r\n");
    stream.write_all(raw.as_bytes()).await.unwrap();
    // The authenticated caller sends no body. The receiver must stop under
    // its captured cutoff rather than wait for a complete envelope or restart
    // a 60-second budget after the first byte/JSON decode.
    let mut response = Vec::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        stream.read_to_end(&mut response),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(String::from_utf8(response)
        .unwrap()
        .starts_with("HTTP/1.1 503"));
    assert!(super::super::utc_epoch_ms().unwrap() >= cutoff);
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
    stop.send(()).unwrap();
    task.await.unwrap().unwrap();
}

#[path = "ack_tests.rs"]
mod ack_tests;
