use super::*;
use crate::delivery::managed_runtime_tls::tests::client;
use crate::ImportAuthorityTransportOptions;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use tokio_rustls::client::TlsStream;
use uuid::Uuid;

struct Temp(PathBuf);
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

async fn fixture(budget: i64) -> (InitialImportIssueExchange, TlsStream<TcpStream>, Temp) {
    fixture_with_transport(budget, None).await
}

async fn fixture_with_transport(
    budget: i64,
    transport_budget: Option<Duration>,
) -> (InitialImportIssueExchange, TlsStream<TcpStream>, Temp) {
    let root = Temp(std::env::temp_dir().join(format!("nac-live-issue-{}", Uuid::new_v4())));
    fs::create_dir(&root.0).unwrap();
    for (name, bytes) in [
        (
            "host.der",
            include_bytes!("../fixtures/managed_fact_tls/host.der").as_slice(),
        ),
        (
            "key.der",
            include_bytes!("../fixtures/managed_fact_tls/host-key.der").as_slice(),
        ),
        (
            "ca.der",
            include_bytes!("../fixtures/managed_fact_tls/ca.der").as_slice(),
        ),
    ] {
        fs::write(root.0.join(name), bytes).unwrap();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root.0.join("key.der"), fs::Permissions::from_mode(0o600)).unwrap();
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let context = serde_json::json!({
        "version":1,"environment":"test","provider_instance_id":"test-provider",
        "operation_id":Uuid::new_v4(),"original_input_sha256":"11".repeat(32),
        "lifecycle_check_sequence":0,"lifecycle_check_sha256":"22".repeat(32),
        "product_release_id":Uuid::new_v4(),"product_artifact_sha256":"33".repeat(32),
        "source_expires_at_unix_ms":now+30_000,"max_exchange_duration_ms":budget
    });
    fs::write(
        root.0.join("context.json"),
        serde_json::to_vec(&context).unwrap(),
    )
    .unwrap();
    let options = serde_json::json!({
        "version":1, "purpose":crate::IMPORT_AUTHORITY_PURPOSE,
        "authority_bind":"127.0.0.1:0", "imported_bind":"127.0.0.1:3214",
        "serving_chain_der_files":[root.0.join("host.der")], "serving_pkcs8_der_file":root.0.join("key.der"),
        "d_client_ca_der_file":root.0.join("ca.der"),
        "d_service_leaf_sha256":wire::hex(&Sha256::digest(include_bytes!("../fixtures/managed_fact_tls/d-service.der"))),
        "public_issuer_trust_file":root.0.join("unused-trust.json"), "original_context_file":root.0.join("context.json")
    });
    fs::write(
        root.0.join("enrollment.json"),
        serde_json::to_vec(&options).unwrap(),
    )
    .unwrap();
    let options = ImportAuthorityTransportOptions::load(&root.0.join("enrollment.json")).unwrap();
    let startup = options.load_original_context().unwrap();
    let mut listener = if let Some(duration) = transport_budget {
        options
            .bind_before_import(Instant::now() + duration)
            .await
            .unwrap()
    } else {
        options.bind_original(&startup).await.unwrap()
    };
    let (remote, accepted) = tokio::join!(
        client(listener.local_addr().unwrap(), Some("d-service")),
        listener.accept_original()
    );
    (
        InitialImportIssueExchange::start(listener, accepted.unwrap(), startup).unwrap(),
        remote.unwrap(),
        root,
    )
}
async fn read_wire(remote: &mut TlsStream<TcpStream>) -> Vec<u8> {
    let size = remote.read_u32().await.unwrap();
    let mut bytes = vec![0; size as usize];
    remote.read_exact(&mut bytes).await.unwrap();
    bytes
}
async fn write_wire(remote: &mut TlsStream<TcpStream>, bytes: &[u8]) {
    remote.write_u32(bytes.len() as u32).await.unwrap();
    remote.write_all(bytes).await.unwrap();
    remote.flush().await.unwrap();
}
fn request(challenge: &InitialImportChallenge, nonce: &str) -> serde_json::Value {
    serde_json::json!({"protocol_version":1,"kind":"read_outstanding_phase",
        "phase":challenge.phase,"sequence":challenge.sequence,"attempt_id":challenge.attempt_id,
        "authority_channel_lifetime_id":challenge.authority_channel_lifetime_id,
        "nonce_hex":challenge.nonce_hex,"request_nonce_hex":nonce})
}

#[tokio::test]
async fn original_pinned_stream_returns_fresh_witness_of_unchanged_challenge() {
    let (mut exchange, mut remote, _root) = fixture(5_000).await;
    let challenge = exchange.challenge().await.unwrap();
    let original_bytes = read_wire(&mut remote).await;
    let original: serde_json::Value = serde_json::from_slice(&original_bytes).unwrap();
    assert_eq!(original, serde_json::to_value(&challenge).unwrap());
    assert_eq!(original.as_object().unwrap().len(), 12);
    tokio::time::sleep(Duration::from_millis(10)).await;
    let nonce = "aa".repeat(32);
    write_wire(
        &mut remote,
        &serde_json::to_vec(&request(&challenge, &nonce)).unwrap(),
    )
    .await;
    let reply_bytes = read_wire(&mut remote).await;
    assert!(reply_bytes
        .windows(original_bytes.len())
        .any(|window| window == original_bytes));
    let reply: serde_json::Value = serde_json::from_slice(&reply_bytes).unwrap();
    assert_eq!(reply.as_object().unwrap().len(), 5);
    assert_eq!(reply["kind"], "outstanding_phase_witness");
    assert_eq!(reply["request_nonce_hex"], nonce);
    assert_eq!(reply["challenge"], original);
    assert!(
        reply["remaining_deadline_budget_ms"].as_u64().unwrap()
            < challenge.remaining_deadline_budget_ms
    );
    exchange.borrow_live().unwrap().check_live().unwrap();
}

#[tokio::test]
async fn received_proof_is_unverified_data_and_actor_keeps_observing_actual_eof() {
    let (mut exchange, mut remote, _root) = fixture(5_000).await;
    let _ = exchange.challenge().await.unwrap();
    let _ = read_wire(&mut remote).await;
    write_wire(&mut remote, b"unverified.proof.bytes").await;
    let input = exchange.receive_proof().await.unwrap();
    assert_eq!(input.compact_jws, "unverified.proof.bytes");
    let live = exchange.borrow_live().unwrap();
    live.check_live().unwrap();
    remote.shutdown().await.unwrap();
    tokio::time::timeout(Duration::from_secs(1), async {
        while live.check_live().is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(exchange.borrow_live().is_err());
}

#[tokio::test]
async fn v1_original_actor_refuses_the_uninstalled_v2_wrapper() {
    let bundle: serde_json::Value = serde_json::from_str(include_str!(
        "../fixtures/managed_import_digest_v2/vectors.json"
    ))
    .unwrap();
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        bundle["positive_codec_only"][0]["frame_base64url"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let (mut exchange, mut remote, _root) = fixture(5_000).await;
    let _ = exchange.challenge().await.unwrap();
    let _ = read_wire(&mut remote).await;
    write_wire(&mut remote, &bytes).await;
    assert!(
        tokio::time::timeout(Duration::from_secs(1), exchange.receive_proof())
            .await
            .unwrap()
            .is_err()
    );
    assert!(exchange.borrow_live().is_err());
}

#[tokio::test]
async fn canceling_a_proof_observation_closes_the_actual_owner() {
    let (mut exchange, mut remote, _root) = fixture(5_000).await;
    let _ = exchange.challenge().await.unwrap();
    let _ = read_wire(&mut remote).await;
    let mut pending = Box::pin(exchange.receive_proof());
    std::future::poll_fn(|cx| {
        assert!(std::future::Future::poll(pending.as_mut(), cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    drop(pending);
    assert!(exchange.borrow_live().is_err());
    assert!(exchange.receive_proof().await.is_err());
}

#[tokio::test]
async fn replay_mismatch_unknown_and_oversized_frames_deny_without_ack() {
    for kind in ["replay", "mismatch", "unknown", "same_nonce", "oversized"] {
        let (mut exchange, mut remote, _root) = fixture(5_000).await;
        let challenge = exchange.challenge().await.unwrap();
        let _ = read_wire(&mut remote).await;
        let mut read = request(&challenge, &"bb".repeat(32));
        match kind {
            "replay" => {
                let raw = serde_json::to_vec(&read).unwrap();
                write_wire(&mut remote, &raw).await;
                let _ = read_wire(&mut remote).await;
            }
            "mismatch" => read["attempt_id"] = serde_json::json!(Uuid::new_v4()),
            "unknown" => read["extra"] = serde_json::json!(true),
            "same_nonce" => read["request_nonce_hex"] = serde_json::json!(challenge.nonce_hex),
            "oversized" => {}
            _ => unreachable!(),
        }
        if kind == "oversized" {
            remote.write_u32((MAX_FRAME + 1) as u32).await.unwrap();
            remote.flush().await.unwrap();
        } else {
            write_wire(&mut remote, &serde_json::to_vec(&read).unwrap()).await;
        }
        assert!(
            tokio::time::timeout(Duration::from_secs(1), exchange.receive_proof())
                .await
                .unwrap()
                .is_err(),
            "{kind}"
        );
        assert!(exchange.borrow_live().is_err(), "{kind}");
    }
}

#[tokio::test]
async fn original_deadline_ends_quiet_phase_without_a_proof_waiter() {
    let (mut exchange, mut remote, _root) = fixture(300).await;
    let _ = exchange.challenge().await.unwrap();
    let _ = read_wire(&mut remote).await;
    let live = exchange.borrow_live().unwrap();
    tokio::time::timeout(Duration::from_secs(1), async {
        while live.check_live().is_ok() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert!(exchange.receive_proof().await.is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_eof_invalidates_a_borrow_while_the_caller_runs_off_reactor() {
    let (mut exchange, mut remote, _root) = fixture(5_000).await;
    let _ = exchange.challenge().await.unwrap();
    let _ = read_wire(&mut remote).await;
    write_wire(&mut remote, b"unverified.proof.bytes").await;
    let _ = exchange.receive_proof().await.unwrap();
    let live = exchange.borrow_live().unwrap();
    let (entered, wait) = oneshot::channel();
    let closer = tokio::spawn(async move {
        wait.await.unwrap();
        remote.shutdown().await.unwrap();
    });
    std::thread::scope(|scope| {
        scope
            .spawn(move || {
                live.check_live().unwrap();
                entered.send(()).unwrap();
                let cutoff = StdInstant::now() + Duration::from_secs(1);
                while live.check_live().is_ok() {
                    assert!(
                        StdInstant::now() < cutoff,
                        "actual reader must fence an off-reactor borrower"
                    );
                    std::thread::yield_now();
                }
            })
            .join()
            .unwrap();
    });
    closer.await.unwrap();
    assert!(exchange.borrow_live().is_err());
}

#[tokio::test]
async fn dropping_the_exchange_synchronously_closes_its_retained_resource() {
    let (mut exchange, mut remote, _root) = fixture(5_000).await;
    let _ = exchange.challenge().await.unwrap();
    let _ = read_wire(&mut remote).await;
    let observed = Arc::clone(&exchange.gate); // test observation, not an exported constructor
    drop(exchange);
    assert!(observed.check().is_err());
}

#[test]
fn witness_decoder_rejects_duplicates_missing_unknown_kind_and_invalid_nonce() {
    let raw = format!(
        r#"{{"protocol_version":1,"kind":"read_outstanding_phase","phase":"issue","sequence":0,"attempt_id":"{}","authority_channel_lifetime_id":"{}","nonce_hex":"{}","request_nonce_hex":"{}"}}"#,
        Uuid::new_v4(),
        Uuid::new_v4(),
        "11".repeat(32),
        "aa".repeat(32)
    );
    assert!(serde_json::from_str::<WitnessRead>(&raw).is_ok());
    for altered in [
        raw.replacen(
            "\"protocol_version\":1",
            "\"protocol_version\":1,\"protocol_version\":1",
            1,
        ),
        raw.replace("read_outstanding_phase", "sign"),
        raw.replace("\"sequence\":0,", ""),
        raw.replace("\"sequence\":0", "\"sequence\":\"0\""),
    ] {
        assert!(serde_json::from_str::<WitnessRead>(&altered).is_err());
    }
    for nonce in ["00".repeat(32), "AA".repeat(32), "aa".repeat(31)] {
        assert!(wire::validate_nonce(&nonce).is_err());
    }
}

#[tokio::test]
async fn shorter_startup_deadline_bounds_a_quiet_longer_transport() {
    let (mut exchange, mut remote, _root) =
        fixture_with_transport(200, Some(Duration::from_secs(5))).await;
    let _ = exchange.challenge().await.unwrap();
    let _ = read_wire(&mut remote).await;
    let result = tokio::time::timeout(Duration::from_millis(800), exchange.receive_proof()).await;
    assert!(
        result.is_ok(),
        "actor must wake at the original shorter startup cutoff"
    );
    assert!(result.unwrap().is_err());
}

#[tokio::test]
async fn one_unsolicited_byte_after_proof_immediately_denies_the_live_borrow() {
    let (mut exchange, mut remote, _root) = fixture(5_000).await;
    let _ = exchange.challenge().await.unwrap();
    let _ = read_wire(&mut remote).await;
    write_wire(&mut remote, b"unverified.proof.bytes").await;
    let _ = exchange.receive_proof().await.unwrap();
    let live = exchange.borrow_live().unwrap();
    live.check_live().unwrap();
    remote.write_all(&[0]).await.unwrap();
    remote.flush().await.unwrap();
    let result = tokio::time::timeout(Duration::from_millis(800), async {
        while live.check_live().is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await;
    assert!(
        result.is_ok(),
        "a partial unsolicited frame must deny before its remaining bytes arrive"
    );
}

// Synthetic signer over an actual enrolled channel. This proves only the
// ISSUE crypto/transport association, never primary-loan or import authority.
#[tokio::test]
async fn verified_issue_retains_actual_channel_and_denies_after_real_eof() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use nac_managed::ImportProofClaims;
    use ring::signature::{Ed25519KeyPair, KeyPair};
    let (mut exchange, mut remote, root) = fixture(30_000).await;
    let challenge = exchange.challenge().await.unwrap();
    let _ = read_wire(&mut remote).await;
    let vectors: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../nac-managed/src/fixtures/managed_import_v2/root-synthetic-vectors.json"
    ))
    .unwrap();
    let compact = vectors["vectors"][0]["compact_jws"].as_str().unwrap();
    let payload = compact.split('.').nth(1).unwrap();
    let mut claims: ImportProofClaims =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap();
    let context = exchange.startup.context();
    claims.environment = context.environment.clone();
    claims.provider_instance_id = context.provider_instance_id.clone();
    claims.operation_id = context.operation_id.clone();
    claims.original_input_sha256 = context.original_input_sha256.clone();
    claims.lifecycle_check_sequence = context.lifecycle_check_sequence;
    claims.lifecycle_check_sha256 = context.lifecycle_check_sha256.clone();
    claims.product_release_id = context.product_release_id.clone();
    claims.product_artifact_sha256 = context.product_artifact_sha256.clone();
    claims.source_expires_at_unix_ms = context.source_expires_at_unix_ms;
    claims.attempt_id = challenge.attempt_id.to_string();
    claims.authority_channel_lifetime_id = challenge.authority_channel_lifetime_id.to_string();
    claims.native_certificate_sha256 = challenge.native_certificate_sha256;
    claims.d_certificate_sha256 = challenge.d_certificate_sha256;
    claims.authority_channel_binding_sha256 = challenge.authority_channel_binding_sha256;
    claims.nonce_hex = challenge.nonce_hex;
    let nonce: Vec<_> = claims
        .nonce_hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    claims.nonce_sha256 = wire::hex(&Sha256::digest(&nonce));
    claims.remaining_deadline_budget_ms =
        challenge.remaining_deadline_budget_ms.try_into().unwrap();
    let now = exchange.original_utc_ms().unwrap() / 1000;
    claims.iat = now - 1;
    claims.nbf = now - 1;
    claims.exp = now + 10;
    let binding = ImportExpectedBinding {
        bootstrap_id: claims.full11_bootstrap_id.clone(),
        managed_host_id: claims.full11_managed_host_id.clone(),
        host_incarnation_id: claims.full11_host_incarnation_id.clone(),
        pvc_uid: claims.full11_pvc_uid.clone(),
        organization_id: claims.full11_organization_id.clone(),
        owner_epoch: claims.full11_owner_epoch,
        key_generation: claims.full11_key_generation,
        local_key_id: claims.full11_local_key_id.clone(),
        provider_key_id: claims.full11_provider_key_id.clone(),
        clerk_instance_id: claims.full11_clerk_instance_id.clone(),
        inference_origin: claims.full11_inference_origin.clone(),
    };
    let key = Ed25519KeyPair::from_seed_unchecked(&[42; 32]).unwrap();
    let trust = serde_json::json!({
        "version": 1, "issuer": claims.iss, "audience": claims.aud,
        "max_proof_lifetime_seconds": 60,
        "keys": [{"kid": claims.issuer_key_id, "issuer_key_generation": claims.issuer_key_generation,
        "public_key_base64url": URL_SAFE_NO_PAD.encode(key.public_key().as_ref()),
        "not_before_unix_seconds": now - 60, "not_after_unix_seconds": now + 60, "revoked": false}]
    });
    let trust_path = root.0.join("unused-trust.json");
    fs::write(&trust_path, serde_json::to_vec(&trust).unwrap()).unwrap();
    let header = format!(
        r#"{{"typ":"nac-managed-import+jwt","alg":"EdDSA","kid":"{}","v":1}}"#,
        claims.issuer_key_id
    );
    let input = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header),
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
    );
    let signed = format!(
        "{input}.{}",
        URL_SAFE_NO_PAD.encode(key.sign(input.as_bytes()).as_ref())
    );
    write_wire(&mut remote, signed.as_bytes()).await;
    exchange.verify_issued_proof(binding).await.unwrap();
    assert_eq!(
        exchange
            .borrow_verified_issue()
            .unwrap()
            .claims()
            .attempt_id,
        claims.attempt_id
    );
    remote.shutdown().await.unwrap();
    tokio::time::timeout(Duration::from_secs(1), async {
        while exchange.borrow_live().is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(exchange.borrow_verified_issue().is_err());
    exchange.close_and_join().await.unwrap();
    assert!(exchange.actor.is_none() && exchange.proof_work.is_none());
}
