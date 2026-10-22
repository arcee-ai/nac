use super::*;
use crate::delivery::managed_runtime_tls::tests::{client, identity};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn listener(deadline: tokio::time::Instant) -> ImportAuthorityListener {
    ImportAuthorityListener::bind(
        "127.0.0.1:0".parse().unwrap(),
        identity(),
        deadline,
        CertificateTimeAnchor::capture(),
        nac_managed::ImportProofVerifier::new("/unused-test-trust.json"),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn selected_context_snapshot_caps_actual_tls_without_rereading_operator_input() {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };
    let root = std::env::temp_dir().join(format!("nac-enrollment-transport-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    for (name, bytes) in [
        (
            "host.der",
            include_bytes!("fixtures/managed_fact_tls/host.der").as_slice(),
        ),
        (
            "host-key.der",
            include_bytes!("fixtures/managed_fact_tls/host-key.der").as_slice(),
        ),
        (
            "ca.der",
            include_bytes!("fixtures/managed_fact_tls/ca.der").as_slice(),
        ),
    ] {
        fs::write(root.join(name), bytes).unwrap();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root.join("host-key.der"), fs::Permissions::from_mode(0o600)).unwrap();
    }
    let utc = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let context = serde_json::json!({
        "version":1,"environment":"test","provider_instance_id":"provider-one",
        "operation_id":Uuid::new_v4(),"original_input_sha256":"11".repeat(32),
        "lifecycle_check_sequence":0,"lifecycle_check_sha256":"22".repeat(32),
        "product_release_id":Uuid::new_v4(),"product_artifact_sha256":"33".repeat(32),
        "source_expires_at_unix_ms":i64::try_from(utc.as_millis()).unwrap()+10_000,
        "max_exchange_duration_ms":200
    });
    fs::write(
        root.join("context.json"),
        serde_json::to_vec(&context).unwrap(),
    )
    .unwrap();
    let options = ImportAuthorityTransportOptions {
        version: 1,
        purpose: IMPORT_AUTHORITY_PURPOSE.into(),
        authority_bind: "127.0.0.1:0".parse().unwrap(),
        imported_bind: "127.0.0.1:3214".parse().unwrap(),
        serving_chain_der_files: vec![root.join("host.der")],
        serving_pkcs8_der_file: root.join("host-key.der"),
        d_client_ca_der_file: root.join("ca.der"),
        d_service_leaf_sha256: Sha256::digest(include_bytes!(
            "fixtures/managed_fact_tls/d-service.der"
        ))
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect(),
        public_issuer_trust_file: root.join("unused-public-trust.json"),
        original_context_file: root.join("context.json"),
    };
    let startup = options.load_original_context().unwrap();
    let original_deadline = startup.deadline();
    fs::write(root.join("context.json"), b"invalid replacement").unwrap();
    let mut serving = options.bind_original(&startup).await.unwrap();
    let (remote, accepted) = tokio::join!(
        client(serving.local_addr().unwrap(), Some("d-service")),
        serving.accept_original()
    );
    let _remote = remote.unwrap();
    let mut connection = accepted.unwrap();
    assert_eq!(connection.deadline(), original_deadline);
    assert_eq!(startup.context().environment, "test");
    assert!(
        tokio::time::timeout(Duration::from_secs(1), connection.read(&mut [0; 1]))
            .await
            .unwrap()
            .is_err()
    );
    assert!(startup.check_current().is_err());
    assert!(connection.check_live().is_err());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn actual_certificate_bound_closes_a_pending_tls_read_without_renewal() {
    use std::time::{SystemTime, UNIX_EPOCH};
    use x509_parser::{certificate::X509CertificateParser, nom::Parser};
    let tls_identity = identity();
    let d_leaf = include_bytes!("fixtures/managed_fact_tls/d-service.der");
    let earliest = tls_identity
        .serving_chain
        .iter()
        .map(AsRef::as_ref)
        .chain([tls_identity.client_ca.as_ref(), d_leaf.as_slice()])
        .map(|der| {
            X509CertificateParser::new()
                .parse(der)
                .unwrap()
                .1
                .validity()
                .not_after
                .timestamp()
        })
        .min()
        .unwrap();
    let expires: SystemTime = UNIX_EPOCH + Duration::from_secs(earliest.try_into().unwrap());
    let start = tokio::time::Instant::now();
    let anchor = CertificateTimeAnchor::for_test(expires - Duration::from_millis(150), start);
    let original = start + Duration::from_secs(2);
    let mut serving = ImportAuthorityListener::bind(
        "127.0.0.1:0".parse().unwrap(),
        tls_identity,
        original,
        anchor,
        nac_managed::ImportProofVerifier::new("/unused-test-trust.json"),
    )
    .await
    .unwrap();
    let (remote, accepted) = tokio::join!(
        client(serving.local_addr().unwrap(), Some("d-service")),
        serving.accept_original()
    );
    let _remote = remote.unwrap();
    let mut connection = accepted.unwrap();
    assert!(connection.deadline() <= start + Duration::from_millis(150));
    assert!(connection.deadline() < original);
    let result = tokio::time::timeout(Duration::from_secs(1), connection.read(&mut [0; 1]))
        .await
        .expect("actual DER expiry must wake a pending TLS read");
    assert_eq!(
        result.unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
    assert!(connection.check_live().is_err());
}

#[tokio::test]
async fn actual_pre_import_tls_exporter_and_peer_are_bound_to_one_original_channel() {
    let mut listener = listener(tokio::time::Instant::now() + Duration::from_secs(2)).await;
    let (remote, accepted) = tokio::join!(
        client(listener.local_addr().unwrap(), Some("d-service")),
        listener.accept_original(),
    );
    let mut remote = remote.unwrap();
    let mut connection = accepted.unwrap();
    let exporter = remote
        .get_ref()
        .1
        .export_keying_material([0u8; 32], IMPORT_AUTHORITY_EXPORTER_LABEL, Some(&[]))
        .unwrap();
    assert_eq!(
        connection.context().authority_channel_binding_sha256(),
        <[u8; 32]>::from(Sha256::digest(exporter))
    );
    assert_eq!(
        connection.context().peer_leaf_sha256(),
        identity().d_service_leaf_sha256
    );
    assert_eq!(
        connection.context().serving_leaf_sha256(),
        <[u8; 32]>::from(Sha256::digest(identity().serving_chain[0].as_ref()))
    );
    assert!(!connection
        .context()
        .authority_channel_lifetime_id()
        .is_nil());
    assert!(
        listener.accept_original().await.is_err(),
        "no reconnection or replacement owner"
    );
    remote.write_all(b"actual authority channel").await.unwrap();
    let mut body = [0; 24];
    connection.read_exact(&mut body).await.unwrap();
    assert_eq!(&body, b"actual authority channel");
    connection.write_all(b"transport only").await.unwrap();
    let mut reply = [0; 14];
    remote.read_exact(&mut reply).await.unwrap();
    assert_eq!(&reply, b"transport only");
    remote.shutdown().await.unwrap();
    assert_eq!(connection.read(&mut [0; 1]).await.unwrap(), 0);
    assert!(connection.check_live().is_err());
    assert!(connection.write_all(b"late").await.is_err());
}

#[tokio::test]
async fn different_actual_connections_do_not_share_exporter_or_lifetime() {
    let mut observed = Vec::new();
    for _ in 0..2 {
        let mut listener = listener(tokio::time::Instant::now() + Duration::from_secs(2)).await;
        let (remote, accepted) = tokio::join!(
            client(listener.local_addr().unwrap(), Some("d-service")),
            listener.accept_original()
        );
        let _remote = remote.unwrap();
        let connection = accepted.unwrap();
        observed.push((
            connection.context().authority_channel_lifetime_id(),
            connection.context().authority_channel_binding_sha256(),
        ));
    }
    assert_ne!(observed[0].0, observed[1].0);
    assert_ne!(observed[0].1, observed[1].1);
}

#[tokio::test]
async fn listener_drop_and_original_deadline_close_current_transport_observation() {
    let mut serving = listener(tokio::time::Instant::now() + Duration::from_secs(2)).await;
    let (remote, accepted) = tokio::join!(
        client(serving.local_addr().unwrap(), Some("d-service")),
        serving.accept_original()
    );
    let _remote = remote.unwrap();
    let connection = accepted.unwrap();
    drop(serving);
    assert!(connection.check_live().is_err());

    let mut serving = listener(tokio::time::Instant::now() + Duration::from_millis(100)).await;
    let (remote, accepted) = tokio::join!(
        client(serving.local_addr().unwrap(), Some("d-service")),
        serving.accept_original()
    );
    let _remote = remote.unwrap();
    let connection = accepted.unwrap();
    tokio::time::sleep(Duration::from_millis(110)).await;
    assert!(connection.check_live().is_err(), "no reset after accept");
}

#[tokio::test]
async fn borrowed_accept_cancellation_cannot_open_another_original() {
    let mut serving = listener(tokio::time::Instant::now() + Duration::from_secs(2)).await;
    assert!(
        tokio::time::timeout(Duration::from_millis(10), serving.accept_original())
            .await
            .is_err()
    );
    assert!(serving.accept_original().await.is_err());
}

#[tokio::test]
async fn pending_read_is_woken_by_original_expiry_and_listener_drop() {
    for expire in [true, false] {
        let mut serving = listener(tokio::time::Instant::now() + Duration::from_millis(150)).await;
        let (remote, accepted) = tokio::join!(
            client(serving.local_addr().unwrap(), Some("d-service")),
            serving.accept_original()
        );
        let _remote = remote.unwrap();
        let mut connection = accepted.unwrap();
        let pending = tokio::spawn(async move { connection.read(&mut [0; 1]).await });
        if !expire {
            tokio::task::yield_now().await;
            drop(serving);
        }
        let result = tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .expect("denial must wake a pending socket read")
            .unwrap();
        assert_eq!(
            result.unwrap_err().kind(),
            std::io::ErrorKind::PermissionDenied
        );
    }
}

#[tokio::test]
async fn expired_and_backpressured_shutdown_keep_the_original_cutoff() {
    let mut serving = listener(tokio::time::Instant::now() + Duration::from_millis(150)).await;
    let (remote, accepted) = tokio::join!(
        client(serving.local_addr().unwrap(), Some("d-service")),
        serving.accept_original()
    );
    let _remote = remote.unwrap();
    let mut connection = accepted.unwrap();
    tokio::time::sleep_until(connection.lifetime.original_deadline).await;
    assert_eq!(
        connection.shutdown().await.unwrap_err().kind(),
        std::io::ErrorKind::TimedOut
    );

    let mut serving = listener(tokio::time::Instant::now() + Duration::from_millis(500)).await;
    let (remote, accepted) = tokio::join!(
        client(serving.local_addr().unwrap(), Some("d-service")),
        serving.accept_original()
    );
    // Keep the actual peer alive without draining its TCP receive window.
    let _remote = remote.unwrap();
    let mut connection = accepted.unwrap();
    let payload = vec![0; 16 * 1024 * 1024];
    assert!(
        tokio::time::timeout(Duration::from_millis(50), connection.write_all(&payload))
            .await
            .is_err()
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(10), connection.shutdown())
            .await
            .is_err(),
        "the actual TLS close must first encounter backpressure"
    );
    let result = tokio::time::timeout(Duration::from_secs(1), connection.shutdown())
        .await
        .expect("original deadline must wake the pending TLS shutdown");
    assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::TimedOut);
    assert!(connection.check_live().is_err());
}

#[tokio::test]
async fn anonymous_wrong_and_untrusted_peers_cannot_create_authority_context() {
    for peer in [None, Some("wrong-peer"), Some("untrusted")] {
        let mut serving = listener(tokio::time::Instant::now() + Duration::from_millis(100)).await;
        let (remote, accepted) = tokio::join!(
            client(serving.local_addr().unwrap(), peer),
            serving.accept_original()
        );
        drop(remote);
        assert!(accepted.is_err());
    }
}

#[test]
fn transport_configuration_refuses_other_purpose_unknown_fields_and_alias_addresses() {
    let value = serde_json::json!({"version":1,"purpose":IMPORT_AUTHORITY_PURPOSE,"authority_bind":"127.0.0.1:3214","imported_bind":"127.0.0.1:3215","serving_chain_der_files":["/absolute/native.der"],"serving_pkcs8_der_file":"/absolute/key.der","d_client_ca_der_file":"/absolute/d-ca.der","d_service_leaf_sha256":"1".repeat(64),"public_issuer_trust_file":"/etc/nac/import-issuer-trust.json","original_context_file":"/etc/nac/import-original-context.json"});
    let options: ImportAuthorityTransportOptions = serde_json::from_value(value.clone()).unwrap();
    options.validate().unwrap();
    for (key, bad) in [
        ("version", serde_json::json!(2)),
        ("purpose", serde_json::json!("working-location-facts.v1")),
        ("imported_bind", serde_json::json!("127.0.0.1:3214")),
        ("d_service_leaf_sha256", serde_json::json!("0".repeat(64))),
    ] {
        let mut changed = value.clone();
        changed[key] = bad;
        assert!(
            serde_json::from_value::<ImportAuthorityTransportOptions>(changed)
                .unwrap()
                .validate()
                .is_err()
        );
    }
    let mut unknown = value;
    unknown["ready"] = serde_json::json!(true);
    assert!(serde_json::from_value::<ImportAuthorityTransportOptions>(unknown).is_err());
}
