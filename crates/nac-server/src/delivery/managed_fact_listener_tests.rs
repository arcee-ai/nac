use super::*;
use crate::application::managed_locations::tests::Fixture;
use crate::delivery::{
    managed_runtime_tls::tests::{client, exchange, identity},
    server::{serve_router_listener_with_shutdown, AdditionalListeners},
};
use serde_json::{json, Value};
use std::{
    os::unix::fs::{symlink, MetadataExt, PermissionsExt},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
};

fn options() -> ManagedFactListenerOptions {
    ManagedFactListenerOptions::new("127.0.0.1:0".parse().unwrap(), identity())
}
fn policy(f: &Fixture, failure: Option<&'static str>) -> managed::ManagedReadinessPolicy {
    let m = std::fs::metadata(&f.root).unwrap();
    managed::ManagedReadinessPolicy::for_test(m.uid(), m.gid(), &[], failure)
}
fn credential(f: &Fixture) {
    nac_core::store::initialize(&f.manager.inner.store_path).unwrap();
    std::fs::write(&f.config.model_credential_file, "synthetic-test-only").unwrap();
    std::fs::set_permissions(
        &f.config.model_credential_file,
        std::fs::Permissions::from_mode(0o600),
    )
    .unwrap();
}
fn operator_file(f: &Fixture) -> (std::path::PathBuf, Value) {
    let fixtures =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/delivery/fixtures/managed_fact_tls");
    let key = f.root.join("host-key.der");
    std::fs::copy(fixtures.join("host-key.der"), &key).unwrap();
    std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).unwrap();
    let value = json!({
        "version":1,"mode":"mediated","bind":"127.0.0.1:0",
        "serving_chain_der_files":[fixtures.join("host.der")],
        "serving_pkcs8_der_file":key,"d_client_ca_der_file":fixtures.join("ca.der"),
        "d_service_leaf_sha256":identity().d_service_leaf_sha256.iter().map(|b|format!("{b:02x}")).collect::<String>()
    });
    let path = f.root.join("fact-listener.json");
    std::fs::write(&path, value.to_string()).unwrap();
    (path, value)
}

#[tokio::test]
async fn explicit_operator_der_config_constructs_only_a_pinned_listener() {
    let f = Fixture::new();
    credential(&f);
    let (path, original) = operator_file(&f);
    let listener = ManagedFactListenerOptions::load(&path)
        .unwrap()
        .bind(
            &f.manager,
            "127.0.0.1:3210".parse().unwrap(),
            None,
            policy(&f, None),
        )
        .await
        .unwrap()
        .unwrap();
    assert!(listener.local_addr().unwrap().ip().is_loopback());
    drop(listener);
    for (field, bad) in [
        ("version", json!(2)),
        ("mode", json!("standalone")),
        ("d_service_leaf_sha256", json!("0".repeat(64))),
        ("d_service_leaf_sha256", json!("F".repeat(64))),
        ("serving_chain_der_files", json!([])),
        ("serving_pkcs8_der_file", json!("relative-key.der")),
        ("unrecognized", json!(true)),
    ] {
        let mut bad_config = original.clone();
        bad_config[field] = bad;
        std::fs::write(&path, bad_config.to_string()).unwrap();
        assert!(ManagedFactListenerOptions::load(&path).is_err(), "{field}");
    }
    std::fs::write(&path, original.to_string()).unwrap();
    let key = Path::new(original["serving_pkcs8_der_file"].as_str().unwrap());
    std::fs::set_permissions(key, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(ManagedFactListenerOptions::load(&path).is_err());
    std::fs::set_permissions(key, std::fs::Permissions::from_mode(0o600)).unwrap();
    let saved = f.root.join("saved-key.der");
    std::fs::rename(key, &saved).unwrap();
    symlink(&saved, key).unwrap();
    assert!(ManagedFactListenerOptions::load(&path).is_err());
}

#[tokio::test]
async fn readiness_separate_addresses_invalid_trust_and_recovery_fail_closed() {
    let f = Fixture::new();
    credential(&f);
    for failure in [
        "store",
        "repository-root",
        "model-credential",
        "runtime-tools",
    ] {
        let error = options()
            .bind(
                &f.manager,
                "127.0.0.1:3210".parse().unwrap(),
                None,
                policy(&f, Some(failure)),
            )
            .await
            .err()
            .unwrap();
        assert!(error.to_string().contains(failure));
    }
    let address = "127.0.0.1:4321".parse().unwrap();
    for (public, control) in [
        (address, None),
        ("127.0.0.1:3210".parse().unwrap(), Some(address)),
    ] {
        assert!(ManagedFactListenerOptions::new(address, identity())
            .bind(&f.manager, public, control, policy(&f, None))
            .await
            .is_err());
    }
    let mut invalid = identity();
    invalid.d_service_leaf_sha256 = [0; 32];
    assert!(ManagedFactListenerOptions::new(address, invalid)
        .bind(
            &f.manager,
            "127.0.0.1:3210".parse().unwrap(),
            None,
            policy(&f, None)
        )
        .await
        .is_err());
    // Failure did not leave a listening socket behind.
    let reserved = TcpListener::bind(address).await.unwrap();
    drop(reserved);
    f.manager.enter_recovery_only();
    assert!(options()
        .bind(
            &f.manager,
            "127.0.0.1:3210".parse().unwrap(),
            None,
            policy(&f, None)
        )
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn configured_startup_requires_managed_host_and_rejects_occupied_fact_bind() {
    let f = Fixture::new();
    credential(&f);
    let ordinary = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("ordinary.db")),
        worker_executable: None,
        managed_host: None,
    })
    .unwrap();
    let result = crate::delivery::server::serve_with_fact_readiness(
        "127.0.0.1:0".parse().unwrap(),
        crate::BindPolicy::LoopbackOnly,
        ordinary,
        Some(options()),
        |_| panic!("must not serve"),
        policy(&f, None),
    )
    .await;
    assert!(result.is_err());
    let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let result = crate::delivery::server::serve_with_fact_readiness(
        "127.0.0.1:0".parse().unwrap(),
        crate::BindPolicy::LoopbackOnly,
        f.manager.clone(),
        Some(ManagedFactListenerOptions::new(
            occupied.local_addr().unwrap(),
            identity(),
        )),
        |_| panic!("must not serve"),
        policy(&f, None),
    )
    .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn private_request_drains_before_owned_persistence_and_all_listeners_close() {
    let f = Fixture::new();
    credential(&f);
    let manager = SessionManager::new_async(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("store.db")),
        worker_executable: None,
        managed_host: Some(f.config.clone()),
    })
    .await
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let public = listener.local_addr().unwrap();
    let facts = options()
        .bind(&manager, public, None, policy(&f, None))
        .await
        .unwrap()
        .unwrap();
    let private = facts.local_addr().unwrap();
    let app = crate::mediated_only_plaintext_router(crate::router(manager.clone()));
    let (stop, done) = oneshot::channel();
    let task = tokio::spawn(serve_router_listener_with_shutdown(
        listener,
        AdditionalListeners {
            control: None,
            facts: Some(facts),
        },
        app,
        manager.clone(),
        async {
            let _ = done.await;
        },
        Duration::from_secs(3),
        || panic!("graceful drain must complete"),
    ));
    let body=json!({"schema":crate::MANAGED_LOCATION_FACT_PURPOSE,"purpose":crate::MANAGED_LOCATION_FACT_PURPOSE,"request_id":"draining","action":"observe","target":manager.managed_location_binding().unwrap(),"selector":{"kind":"repository_root"}}).to_string();
    let expiry = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
        + 2000;
    let mut stream = client(private, Some("d-service")).await.unwrap();
    // Force the actual handler to own a partially read body before shutdown.
    stream.write_all(format!("POST {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\nContent-Type: application/json\r\nAccept: application/json\r\nX-NAC-Request-ID: draining\r\nX-NAC-Expires-At-Epoch-Ms: {expiry}\r\nExpect: 100-continue\r\n\r\n",crate::MANAGED_LOCATION_FACT_PATH,body.len()).as_bytes()).await.unwrap();
    let mut interim = [0; 25];
    stream.read_exact(&mut interim).await.unwrap();
    assert_eq!(&interim, b"HTTP/1.1 100 Continue\r\n\r\n");
    stop.send(()).unwrap();
    tokio::task::yield_now().await;
    assert!(
        !task.is_finished(),
        "partial private request must remain owned by shutdown"
    );
    stream.write_all(body.as_bytes()).await.unwrap();
    let mut reply = Vec::new();
    let _ = stream.read_to_end(&mut reply).await;
    assert!(
        String::from_utf8_lossy(&reply).starts_with("HTTP/1.1 200"),
        "{}",
        String::from_utf8_lossy(&reply)
    );
    tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(tokio::net::TcpStream::connect(public).await.is_err());
    assert!(tokio::net::TcpStream::connect(private).await.is_err());
    // The actual process lease is released only after the shared executor drains.
    let reopened = nac_core::store::StoreCoordinator::acquire(&manager.inner.store_path).unwrap();
    reopened.shutdown().await.unwrap();
    assert!(exchange(
        private,
        Some("d-service"),
        "POST",
        crate::MANAGED_LOCATION_FACT_PATH,
        b"{}",
        &[]
    )
    .await
    .is_err());
}
