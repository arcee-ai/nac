//! Synthetic enrollment only; actual TLS1.3, native clocks and SQLite delivery.
use super::*;
use axum::http::Request;
use nac_core::{runtime::ManagedRuntimeLeaseGuard, store};
use rusqlite::Connection;
use std::{future::Future, path::PathBuf, sync::Mutex};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    task::JoinHandle,
};

pub(super) struct SyntheticEnrollment {
    selected_store: Arc<StoreCoordinator>,
    selected_peer: super::super::AuthenticatedIssuerControlPeer,
    current: Arc<Mutex<Facts>>,
}
struct Facts {
    assignment: Fields,
    serving_lifetime: Uuid,
    retained_secret_clearance: bool,
    key_revocation_watermark: i64,
}
impl SyntheticEnrollment {
    pub(super) fn check(&self, owner: &RetainedRuntimeCarrier) -> Result<i64> {
        let facts = self
            .current
            .lock()
            .map_err(|_| anyhow::anyhow!("poisoned fixture"))?;
        if !Arc::ptr_eq(&self.selected_store, &owner.store)
            || !Arc::ptr_eq(&self.selected_peer.channel, &owner.dialog.peer().channel)
            || facts.assignment != owner.assignment
            || facts.serving_lifetime != owner.binding.serving_lifetime_id
            || !facts.retained_secret_clearance
            || integer(&facts.assignment, "key_generation")? <= facts.key_revocation_watermark
        {
            bail!("synthetic selected source changed");
        }
        self.selected_peer.check_live()?;
        Ok(facts.key_revocation_watermark)
    }
}

struct Fixture {
    root: PathBuf,
    path: PathBuf,
    store: Arc<StoreCoordinator>,
    carrier: Option<RetainedRuntimeCarrier>,
    facts: Arc<Mutex<Facts>>,
    peer: super::super::AuthenticatedIssuerControlPeer,
    socket: Option<tokio_rustls::client::TlsStream<super::super::TcpStream>>,
    io: Option<JoinHandle<std::io::Result<usize>>>,
    transport: Option<super::super::channel::IssuerControlStream>,
}
impl Fixture {
    async fn new(enrolled: bool) -> Self {
        let (stream, socket) = super::super::channel_tests::connected_stream().await;
        assert_eq!(
            socket.get_ref().1.protocol_version(),
            Some(tokio_rustls::rustls::ProtocolVersion::TLSv1_3)
        );
        let mut fixture = Self::from_stream(stream, Some(socket), enrolled).await;
        fixture.poll_stream();
        fixture
    }
    async fn from_stream(
        stream: super::super::channel::IssuerControlStream,
        socket: Option<tokio_rustls::client::TlsStream<super::super::TcpStream>>,
        enrolled: bool,
    ) -> Self {
        let peer = stream.peer();
        let dialog = peer.claim_dialog().unwrap();
        let root = std::env::temp_dir().join(format!("nac-carrier-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("store.db");
        store::initialize(&path).unwrap();
        let store = StoreCoordinator::acquire(&path).unwrap();
        let clock = RuntimeLeaseClock::capture().unwrap();
        let input: Value =
            serde_json::from_slice(include_bytes!("fixtures/runtime_intent/vectors.json")).unwrap();
        let mut fields: Fields =
            serde_json::from_value(input["cases"][0]["input"].clone()).unwrap();
        fields.insert(
            "operation_id".into(),
            Value::from(Uuid::new_v4().to_string()),
        );
        fields.insert("key_generation".into(), Value::from(2));
        fields.insert("created_at_epoch_ms".into(), Value::from(clock.wall_ms()));
        fields.insert(
            "expires_at_epoch_ms".into(),
            Value::from(clock.wall_ms() + 60_000),
        );
        let intent_bytes = canonical(&fields).unwrap();
        let intent = RuntimeHttpIntent::decode(&intent_bytes).unwrap();
        let body = input["cases"][0]["body_utf8"]
            .as_str()
            .unwrap()
            .as_bytes()
            .to_vec();
        let request = Request::builder()
            .method("POST")
            .uri("/api/sessions/fixture/runs?model=fixture&stream=true")
            .header("content-type", "application/json")
            .header(
                "x-arcee-managed-operation-id",
                fields["operation_id"].as_str().unwrap(),
            )
            .header("x-arcee-managed-intent-sha256", intent.sha256().unwrap())
            .body(())
            .unwrap()
            .into_parts()
            .0;
        let control: Value = serde_json::from_slice(include_bytes!(
            "fixtures/runtime_control/vectors.compact.json"
        ))
        .unwrap();
        let control_fields: Fields =
            serde_json::from_value(control["vectors"][0]["challenge"].clone()).unwrap();
        let mut assignment = assignment_fields(&control_fields).unwrap();
        for name in assignment.clone().keys() {
            if let Some(value) = fields.get(name) {
                assignment.insert(name.clone(), value.clone());
            }
        }
        assignment.insert(
            "full_input_sha256".into(),
            Value::from(intent.sha256().unwrap()),
        );
        let lifetime = Uuid::new_v4();
        let facts = Arc::new(Mutex::new(Facts {
            assignment: assignment.clone(),
            serving_lifetime: lifetime,
            retained_secret_clearance: true,
            key_revocation_watermark: 1,
        }));
        let mut carrier = RetainedRuntimeCarrier::unconfigured(
            dialog,
            Arc::clone(&store),
            OriginalRequest {
                parts: request,
                body,
                intent_bytes,
            },
            assignment,
            lifetime,
        )
        .unwrap();
        if enrolled {
            carrier.source = Source::Synthetic(SyntheticEnrollment {
                selected_store: Arc::clone(&store),
                selected_peer: peer.clone(),
                current: Arc::clone(&facts),
            });
        }
        Self {
            root,
            path,
            store,
            carrier: Some(carrier),
            facts,
            peer,
            socket,
            io: None,
            transport: Some(stream),
        }
    }
    fn carrier(&mut self) -> &mut RetainedRuntimeCarrier {
        self.carrier.as_mut().unwrap()
    }
    fn poll_stream(&mut self) {
        let mut stream = self.transport.take().unwrap();
        self.io = Some(tokio::spawn(async move { stream.read(&mut [0]).await }));
    }
    fn rows(&self) -> (i64, Option<String>) {
        let db = Connection::open(&self.path).unwrap();
        (
            db.query_row(
                "SELECT COUNT(*) FROM managed_runtime_operations",
                [],
                |row| row.get(0),
            )
            .unwrap(),
            db.query_row(
                "SELECT phase FROM managed_runtime_leases LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok(),
        )
    }
    fn response(&self) -> Vec<u8> {
        let carrier = self.carrier.as_ref().unwrap();
        let Stage::Pending(_, challenge) = &carrier.stage else {
            panic!("Pending fixture")
        };
        response(challenge)
    }
    async fn finish(mut self) {
        self.carrier().settle_denial().await.unwrap();
        drop(self.carrier.take());
        if let Some(mut socket) = self.socket.take() {
            socket.shutdown().await.unwrap();
        }
        if let Some(io) = self.io.take() {
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(2), io)
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap(),
                0
            );
        }
        self.store.shutdown().await.unwrap();
        std::fs::remove_dir_all(&self.root).unwrap();
        assert!(
            !self.root.exists(),
            "disposable store absent after independent removal"
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(io) = self.io.take() {
            io.abort();
        }
    }
}
fn response(challenge: &RuntimeChallenge) -> Vec<u8> {
    let mut fields = assignment_fields(challenge.fields()).unwrap();
    for name in [
        "control_channel_id",
        "challenge_id",
        "lease_phase",
        "native_session_id",
        "native_run_id",
    ] {
        fields.insert(name.into(), challenge.fields()[name].clone());
    }
    fields.extend([
        ("response_version".into(), Value::from(1)),
        ("lease_version".into(), Value::from(1)),
        ("lease_sequence".into(), Value::from(1)),
        ("lease_id".into(), Value::from(Uuid::new_v4().to_string())),
        (
            "observed_at_epoch_ms".into(),
            Value::from(RuntimeLeaseClock::capture().unwrap().wall_ms()),
        ),
        (
            "expires_at_epoch_ms".into(),
            challenge.fields()["native_deadline_epoch_ms"].clone(),
        ),
        (
            "challenge_sha256".into(),
            Value::from(challenge.sha256().unwrap()),
        ),
    ]);
    RuntimeResponse::from_fields(fields)
        .unwrap()
        .canonical()
        .unwrap()
}

#[tokio::test]
async fn missing_producers_deny_before_reservation_despite_real_tls_and_exact_request() {
    let mut f = Fixture::new(false).await;
    let hello = f.carrier().hello().unwrap();
    let value: Value = serde_json::from_slice(&hello).unwrap();
    assert_eq!(value["control_channel_id"], f.peer.channel_id().to_string());
    assert!(f.carrier().reserve().await.is_err());
    assert_eq!(f.rows(), (0, None));
    assert!(f.peer.check_live().is_err());
    assert!(f.carrier().hello().is_err());
    f.finish().await;
}

#[tokio::test]
async fn synthetic_enrolled_component_delivers_original_active_once_without_dispatch() {
    let mut f = Fixture::new(true).await;
    let original = f.carrier().original.intent_bytes.clone();
    f.carrier().reserve().await.unwrap();
    assert!(matches!(f.carrier().stage, Stage::Fresh(_)));
    let raw = f.carrier().challenge().await.unwrap();
    RuntimeChallenge::decode(&raw).unwrap();
    assert_eq!(f.rows(), (1, Some("challenged".into())));
    f.carrier().claim_submission().await.unwrap();
    let response = f.response();
    f.carrier().consume(&response).await.unwrap();
    assert_eq!(f.rows(), (1, Some("active".into())));
    assert_eq!(f.carrier().original.intent_bytes, original);
    let Stage::Active(active) = std::mem::replace(&mut f.carrier().stage, Stage::Denied) else {
        panic!("delivered Active")
    };
    let guard = ManagedRuntimeLeaseGuard::new(Arc::clone(&f.store), active)
        .await
        .unwrap();
    guard.check_now().unwrap();
    guard.deny_now();
    // No native session/run/NotAdmitted is invented by this component.
    let observed: Option<String> = Connection::open(&f.path)
        .unwrap()
        .query_row(
            "SELECT observation_kind FROM managed_runtime_operations",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(observed.is_none());
    f.finish().await;
}

#[tokio::test]
async fn shared_submission_claim_is_spent_across_adapters_and_unknown_receipt() {
    let mut f = Fixture::new(true).await;
    f.carrier().reserve().await.unwrap();
    f.carrier().challenge().await.unwrap();
    f.carrier().claim_submission().await.unwrap();
    let response = f.response();
    assert!(f.carrier().claim_submission().await.is_err());
    assert!(f.carrier().submission_spent);
    assert!(f.carrier().consume(&response).await.is_err());
    f.carrier().settle_denial().await.unwrap();
    assert_eq!(f.rows(), (1, Some("terminal".into())));
    f.finish().await;

    let mut f = Fixture::new(true).await;
    f.carrier().reserve().await.unwrap();
    f.carrier().challenge().await.unwrap();
    f.carrier().claim_submission().await.unwrap();
    f.carrier().settle_denial().await.unwrap(); // ambiguous external Create result
    assert!(f.carrier().submission_spent);
    assert!(f.carrier().claim_submission().await.is_err());
    f.finish().await;
}

#[tokio::test]
async fn every_current_assignment_field_and_clearance_is_independent_and_sticky() {
    let seed = Fixture::new(true).await;
    let names: Vec<_> = seed
        .facts
        .lock()
        .unwrap()
        .assignment
        .keys()
        .cloned()
        .collect();
    assert_eq!(names.len(), 21);
    seed.finish().await;
    for name in names {
        let mut f = Fixture::new(true).await;
        f.carrier().reserve().await.unwrap();
        let old = f.facts.lock().unwrap().assignment[&name].clone();
        f.facts
            .lock()
            .unwrap()
            .assignment
            .insert(name.clone(), Value::Null);
        assert!(f.carrier().challenge().await.is_err(), "changed {name}");
        f.facts.lock().unwrap().assignment.insert(name, old);
        assert!(
            f.carrier().challenge().await.is_err(),
            "restore cannot reopen"
        );
        f.finish().await;
    }
    for variant in 0..2 {
        let mut f = Fixture::new(true).await;
        if variant == 0 {
            f.facts.lock().unwrap().serving_lifetime = Uuid::new_v4();
        } else {
            f.facts.lock().unwrap().retained_secret_clearance = false;
        }
        assert!(f.carrier().reserve().await.is_err());
        assert_eq!(f.rows(), (0, None));
        f.finish().await;
    }
}

#[cfg(test)]
#[path = "managed_runtime_carrier_lifecycle_tests.rs"]
mod lifecycle;

#[cfg(target_os = "linux")]
#[path = "managed_runtime_carrier_linux_tests.rs"]
mod linux;
