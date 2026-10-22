//! Actual local TLS with existing synthetic certificates, never production trust.
use super::*;
use anyhow::Result;
use sha2::{Digest, Sha256};
use std::{
    net::SocketAddr,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use tokio_rustls::{
    rustls::{
        self,
        pki_types::{CertificateDer, PrivateKeyDer, ServerName},
    },
    TlsConnector,
};
use uuid::Uuid;

fn certificate(name: &str) -> CertificateDer<'static> {
    let bytes: &[u8] = match name {
        "ca" => include_bytes!("../tests/fixtures/managed_fact_tls/ca.der"),
        "host" => include_bytes!("../tests/fixtures/managed_fact_tls/host.der"),
        "d-service" => include_bytes!("../tests/fixtures/managed_fact_tls/d-service.der"),
        "wrong-peer" => include_bytes!("../tests/fixtures/managed_fact_tls/wrong-peer.der"),
        _ => panic!("unknown synthetic certificate"),
    };
    CertificateDer::from(bytes.to_vec())
}
fn key(name: &str) -> Result<PrivateKeyDer<'static>> {
    let bytes: &[u8] = match name {
        "host" => include_bytes!("../tests/fixtures/managed_fact_tls/host-key.der"),
        "d-service" => include_bytes!("../tests/fixtures/managed_fact_tls/d-service-key.der"),
        "wrong-peer" => include_bytes!("../tests/fixtures/managed_fact_tls/wrong-peer-key.der"),
        _ => panic!("unknown synthetic key"),
    };
    PrivateKeyDer::try_from(bytes.to_vec()).map_err(anyhow::Error::msg)
}
fn identity() -> Result<RuntimeTlsIdentity> {
    Ok(RuntimeTlsIdentity {
        serving_chain: vec![certificate("host")],
        serving_key: key("host")?,
        client_ca: certificate("ca"),
        d_service_leaf_sha256: Sha256::digest(certificate("d-service").as_ref()).into(),
    })
}
async fn client(
    addr: SocketAddr,
    peer: &str,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(certificate("ca"))?;
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_protocol_versions(&[&rustls::version::TLS13])?
    .with_root_certificates(roots)
    .with_client_auth_cert(vec![certificate(peer)], key(peer)?)?;
    Ok(TlsConnector::from(Arc::new(config))
        .connect(
            ServerName::try_from("localhost")?,
            TcpStream::connect(addr).await?,
        )
        .await?)
}
struct Pair {
    listener: RuntimeTlsAcceptor,
    server: AuthenticatedStream,
    client: tokio_rustls::client::TlsStream<TcpStream>,
}
async fn pair(create: bool) -> Result<Pair> {
    let addr = "127.0.0.1:0".parse()?;
    let mut listener = if create {
        RuntimeTlsAcceptor::bind_create_issuer(addr, identity()?).await?
    } else {
        RuntimeTlsAcceptor::bind(addr, identity()?).await?
    };
    let addr = listener.local_addr()?;
    let (client, (server, _)) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(client(addr, "d-service"), listener.accept())
    })
    .await?;
    Ok(Pair {
        listener,
        server,
        client: client?,
    })
}
fn expiry(after: Duration) -> Result<i64> {
    Ok(i64::try_from(
        (SystemTime::now().duration_since(UNIX_EPOCH)? + after).as_millis(),
    )?)
}
fn body() -> Box<[u8]> {
    b"immutable protocol fixture, not a Core grant"
        .to_vec()
        .into_boxed_slice()
}

#[tokio::test]
async fn ordinary_enrollment_authenticates_without_create_enrollment() -> Result<()> {
    let p = pair(false).await?;
    let peer = p.server.peer();
    peer.check_current()?;
    assert!(!peer.create_enrolled()?);
    assert!(peer
        .begin_create(Uuid::new_v4(), expiry(Duration::from_secs(30))?)
        .is_err());
    assert!(peer
        .begin_create_ack(Uuid::new_v4(), expiry(Duration::from_secs(30))?)
        .is_err());
    assert_eq!(
        peer.issuer()?.client_leaf_sha256,
        Sha256::digest(certificate("d-service").as_ref()).as_slice()
    );
    Ok(())
}

async fn next_connection(
    listener: &mut RuntimeTlsAcceptor,
) -> Result<(
    AuthenticatedStream,
    tokio_rustls::client::TlsStream<TcpStream>,
)> {
    let addr = listener.local_addr()?;
    let (client, (server, _)) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(client(addr, "d-service"), listener.accept())
    })
    .await?;
    Ok((server, client?))
}

#[tokio::test]
async fn ack_keeps_original_bytes_and_denies_independently_of_create_and_serving() -> Result<()> {
    let mut p = pair(true).await?;
    let create_peer = p.server.peer();
    let create = create_peer
        .begin_create(Uuid::new_v4(), expiry(Duration::from_secs(30))?)?
        .bind_body(body())?;
    let original_create_cutoff = create.original_cutoff();
    assert!(create_peer
        .begin_create_ack(Uuid::new_v4(), expiry(Duration::from_secs(30))?)
        .is_err());
    create.check_current()?;
    let (ack_stream, _ack_client) = next_connection(&mut p.listener).await?;
    let ack_peer = ack_stream.peer();
    let operation = Uuid::new_v4();
    let original_expiry = expiry(Duration::from_millis(150))?;
    let start = ack_peer.begin_create_ack(operation, original_expiry)?;
    let original_ack_cutoff = start.original_cutoff();
    let raw = body();
    let pointer = raw.as_ptr();
    let ack = start.bind_body(raw)?;
    assert_eq!(ack.payload().as_ptr(), pointer);
    assert_eq!(ack.request_id(), operation);
    assert_eq!(ack.original_cutoff(), original_ack_cutoff);
    assert_eq!(ack.original_expiry_epoch_ms(), original_expiry);
    assert_eq!(
        ack.issuer().client_leaf_sha256,
        create.issuer().client_leaf_sha256
    );
    assert_ne!(ack.issuer(), create.issuer());
    assert!(ack_peer
        .begin_create(Uuid::new_v4(), expiry(Duration::from_secs(30))?)
        .is_err());
    tokio::time::timeout(Duration::from_secs(2), ack.invalidated()).await?;
    assert!(ack.check_current().is_err());
    create.check_current()?;
    assert_eq!(create.original_cutoff(), original_create_cutoff);
    create.serving_currentness().check_current()?;
    Ok(())
}

#[tokio::test]
async fn fresh_ack_never_renews_an_expired_create_and_actual_stream_loss_denies_ack() -> Result<()>
{
    let mut p = pair(true).await?;
    let create = p
        .server
        .peer()
        .begin_create(Uuid::new_v4(), expiry(Duration::from_millis(100))?)?
        .bind_body(body())?;
    let cutoff = create.original_cutoff();
    tokio::time::timeout(Duration::from_secs(2), create.invalidated()).await?;
    let (ack_stream, _ack_client) = next_connection(&mut p.listener).await?;
    let ack = ack_stream
        .peer()
        .begin_create_ack(Uuid::new_v4(), expiry(Duration::from_secs(30))?)?
        .bind_body(body())?;
    ack.check_current()?;
    assert!(create.check_current().is_err());
    assert_eq!(create.original_cutoff(), cutoff);
    drop(ack_stream);
    tokio::time::timeout(Duration::from_secs(1), ack.invalidated()).await?;
    assert!(ack.check_current().is_err());
    create.serving_currentness().check_current()?;
    Ok(())
}

#[tokio::test]
async fn ack_invalid_budget_and_body_refuse_without_reenrollment_or_second_attempt() -> Result<()> {
    let mut p = pair(true).await?;
    let peer = p.server.peer();
    assert!(peer
        .begin_create_ack(Uuid::nil(), expiry(Duration::from_secs(30))?)
        .is_err());
    assert!(peer
        .begin_create_ack(Uuid::new_v4(), expiry(Duration::from_secs(61))?)
        .is_err());
    assert!(peer.begin_create_ack(Uuid::new_v4(), 1).is_err());
    assert!(peer
        .begin_create_ack(Uuid::new_v4(), expiry(Duration::from_secs(30))?)?
        .bind_body(vec![0; MAX_CREATE_ACK_BODY_BYTES + 1].into_boxed_slice())
        .is_err());
    assert!(peer
        .begin_create_ack(Uuid::new_v4(), expiry(Duration::from_secs(30))?)
        .is_err());
    peer.check_current()?;
    let (ack_stream, _ack_client) = next_connection(&mut p.listener).await?;
    let raw = vec![0; MAX_CREATE_ACK_BODY_BYTES].into_boxed_slice();
    let pointer = raw.as_ptr();
    let ack = ack_stream
        .peer()
        .begin_create_ack(Uuid::new_v4(), expiry(Duration::from_secs(30))?)?
        .bind_body(raw)?;
    assert_eq!(ack.payload().as_ptr(), pointer);
    ack.deny();
    assert!(ack.check_current().is_err());
    // ACK denial does not revoke enrollment or the serving/connection owner.
    ack_stream.peer().check_current()?;
    assert!(ack_stream.peer().create_enrolled()?);
    peer.check_current()?;
    let (empty_stream, _empty_client) = next_connection(&mut p.listener).await?;
    let empty_peer = empty_stream.peer();
    assert!(empty_peer
        .begin_create_ack(Uuid::new_v4(), expiry(Duration::from_secs(30))?)?
        .bind_body(Vec::new().into_boxed_slice())
        .is_err());
    assert!(empty_peer
        .begin_create_ack(Uuid::new_v4(), expiry(Duration::from_secs(30))?)
        .is_err());
    empty_peer.check_current()?;
    Ok(())
}

#[tokio::test]
async fn actual_connection_has_one_control_attempt_across_create_and_ack_types() -> Result<()> {
    let p = pair(true).await?;
    let peer = p.server.peer();
    let start = Arc::new(std::sync::Barrier::new(8));
    let mut threads = Vec::new();
    for index in 0..8 {
        let peer = peer.clone();
        let start = Arc::clone(&start);
        threads.push(std::thread::spawn(move || {
            start.wait();
            let expiry = expiry(Duration::from_secs(30)).unwrap();
            if index % 2 == 0 {
                peer.begin_create(Uuid::new_v4(), expiry).is_ok()
            } else {
                peer.begin_create_ack(Uuid::new_v4(), expiry).is_ok()
            }
        }));
    }
    assert_eq!(
        threads
            .into_iter()
            .map(|thread| usize::from(thread.join().unwrap()))
            .sum::<usize>(),
        1
    );
    Ok(())
}

#[tokio::test]
async fn actual_create_exchange_retains_exact_bytes_and_original_prebody_cutoff() -> Result<()> {
    let p = pair(true).await?;
    let peer = p.server.peer();
    let id = Uuid::new_v4();
    let expiry = expiry(Duration::from_secs(30))?;
    let start = peer.begin_create(id, expiry)?;
    let cutoff = start.original_cutoff();
    tokio::time::sleep(Duration::from_millis(20)).await;
    let raw = body();
    let pointer = raw.as_ptr();
    let exchange = start.bind_body(raw)?;
    exchange.check_current()?;
    assert_eq!(exchange.request_id(), id);
    assert_eq!(exchange.original_cutoff(), cutoff);
    assert_eq!(exchange.original_expiry_epoch_ms(), expiry);
    assert_eq!(exchange.payload().as_ptr(), pointer);
    assert_eq!(exchange.issuer(), peer.issuer()?);
    // A fresh request/deadline or cloned peer observation cannot renew this
    // original connection. Core separately fences operation replay across IO.
    assert!(peer
        .clone()
        .begin_create(Uuid::new_v4(), expiry + 1)
        .is_err());
    Ok(())
}

#[tokio::test]
async fn dropped_stream_invalidates_retained_exchange_without_retiring_host() -> Result<()> {
    let p = pair(true).await?;
    let exchange = p
        .server
        .peer()
        .begin_create(Uuid::new_v4(), expiry(Duration::from_secs(30))?)?
        .bind_body(body())?;
    let serving = exchange.serving_currentness();
    let invalidated = exchange.invalidated();
    tokio::pin!(invalidated);
    tokio::select! {
        _ = &mut invalidated => panic!("live exchange invalidated"),
        _ = tokio::time::sleep(Duration::from_millis(10)) => {},
    }
    drop(p.server);
    tokio::time::timeout(Duration::from_secs(1), &mut invalidated).await?;
    assert!(exchange.check_current().is_err());
    serving.check_current()?;
    drop(p.listener);
    assert!(serving.check_current().is_err());
    Ok(())
}

#[tokio::test]
async fn actual_tls_eof_invalidates_create_but_empty_buffer_read_does_not() -> Result<()> {
    let mut p = pair(true).await?;
    let peer = p.server.peer();
    let exchange = peer
        .begin_create(Uuid::new_v4(), expiry(Duration::from_secs(30))?)?
        .bind_body(body())?;
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), p.server.read(&mut [])).await??,
        0
    );
    peer.check_current()?;
    tokio::time::timeout(Duration::from_secs(2), p.client.shutdown()).await??;
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), p.server.read(&mut [0; 1])).await??,
        0
    );
    assert!(peer.check_current().is_err());
    tokio::time::timeout(Duration::from_secs(1), exchange.invalidated()).await?;
    exchange.serving_currentness().check_current()?;
    Ok(())
}

#[tokio::test]
async fn original_expiry_and_denial_wake_without_renewal_or_runtime_retirement() -> Result<()> {
    let p = pair(true).await?;
    let exchange = p
        .server
        .peer()
        .begin_create(Uuid::new_v4(), expiry(Duration::from_millis(150))?)?
        .bind_body(body())?;
    let cutoff = exchange.original_cutoff();
    tokio::time::timeout(Duration::from_secs(2), exchange.invalidated()).await?;
    assert!(exchange.check_current().is_err());
    assert_eq!(exchange.original_cutoff(), cutoff);
    exchange.serving_currentness().check_current()?;
    Ok(())
}

#[tokio::test]
async fn listener_loss_and_explicit_denial_are_sticky_but_not_settlement() -> Result<()> {
    let p = pair(true).await?;
    let exchange = p
        .server
        .peer()
        .begin_create(Uuid::new_v4(), expiry(Duration::from_secs(30))?)?
        .bind_body(body())?;
    let serving = exchange.serving_currentness();
    exchange.deny();
    exchange.deny();
    assert!(exchange.check_current().is_err());
    serving.check_current()?;
    drop(p.listener);
    tokio::time::timeout(Duration::from_secs(1), serving.invalidated()).await?;
    assert!(serving.check_current().is_err());
    Ok(())
}

#[tokio::test]
async fn invalid_headers_do_not_mint_and_concurrent_real_peer_starts_are_one_use() -> Result<()> {
    let p = pair(true).await?;
    let peer = p.server.peer();
    assert!(peer
        .begin_create(Uuid::nil(), expiry(Duration::from_secs(1))?)
        .is_err());
    assert!(peer
        .begin_create(Uuid::new_v4(), expiry(Duration::from_secs(61))?)
        .is_err());
    assert!(peer.begin_create(Uuid::new_v4(), 0).is_err());
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..2 {
        let peer = peer.clone();
        let barrier = Arc::clone(&barrier);
        tasks.spawn(async move {
            barrier.wait().await;
            peer.begin_create(Uuid::new_v4(), expiry(Duration::from_secs(30))?)
        });
    }
    let mut starts = Vec::new();
    while let Some(result) = tasks.join_next().await {
        starts.push(result?);
    }
    assert_eq!(starts.iter().filter(|value| value.is_ok()).count(), 1);
    assert_eq!(starts.iter().filter(|value| value.is_err()).count(), 1);
    Ok(())
}
