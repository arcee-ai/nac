use super::*;
use nac_core::model::{ManagedHostExecutionAuthority, TrustedManagedHostKey};
use nac_managed::{ManagedHostKeyConfig, ManagedModelCredentialSource};
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    sync::{atomic::AtomicBool, atomic::Ordering, mpsc, Mutex},
    thread,
};
use uuid::Uuid;

const CANARY: &str = "synthetic-application-repair-canary";

fn binding() -> ManagedHostKeyBinding {
    ManagedHostKeyBinding {
        bootstrap_id: "4712bc5e-30d5-421a-b416-8291d9f7d8f9".into(),
        managed_host_id: "21856443-8ed8-40ab-9036-72e837c99f27".into(),
        host_incarnation_id: "cr-application-repair".into(),
        pvc_uid: "pvc-application-repair".into(),
        organization_id: "11670cb3-ea82-4f66-96ca-d5b6542f8c2a".into(),
        owner_epoch: 1,
        key_generation: 1,
        local_key_id: "00d61e35-4d17-4949-888f-5f153b03a53b".into(),
        key_id: "provider-key-1".into(),
        clerk_instance_id: "instance-test".into(),
        inference_origin: "https://api.arcee.ai".into(),
    }
}

fn successor(previous: &ManagedHostKeyBinding) -> ManagedHostKeyBinding {
    ManagedHostKeyBinding {
        bootstrap_id: "b6a73906-20aa-449d-9723-8b9c9a3e5e98".into(),
        key_generation: 2,
        local_key_id: "a4a4c594-4684-465e-8bdd-3951f87ae0c0".into(),
        key_id: "provider-key-2".into(),
        ..previous.clone()
    }
}

fn config(root: &Path, b: &ManagedHostKeyBinding) -> ManagedHostConfig {
    ManagedHostConfig {
        version: 3,
        logical_host_id: b.managed_host_id.clone(),
        host_incarnation_id: Some(b.host_incarnation_id.clone()),
        owner: None,
        public_hostname: "managed-repair.test".into(),
        repository_root: root.join("repositories"),
        state_root: root.join("state"),
        home_root: root.join("home"),
        github_client_id: "Iv1.repair-test".into(),
        model_backend: "arcee-api".into(),
        model_id: "trinity-large-thinking".into(),
        model_endpoint: b.inference_origin.clone(),
        model_auth_issuer: None,
        model_credential_file: PathBuf::from(nac_core::model::MANAGED_ARCEE_BOOTSTRAP_PATH),
        model_credential_source: ManagedModelCredentialSource::ManagedHostKey,
        model_credential_environment_names: Vec::new(),
        managed_control_bind: Some("0.0.0.0:3211".into()),
        managed_control_issuer: Some("https://nac-api.managed-repair.test".into()),
        managed_control_jwks_file: Some(root.join("control-jwks.json")),
        managed_upgrade_expectation: None,
        managed_host_key: Some(ManagedHostKeyConfig {
            bootstrap_id: b.bootstrap_id.clone(),
            managed_host_id: b.managed_host_id.clone(),
            host_incarnation_id: b.host_incarnation_id.clone(),
            pvc_uid: b.pvc_uid.clone(),
            organization_id: b.organization_id.clone(),
            owner_epoch: b.owner_epoch,
            key_generation: b.key_generation,
            local_key_id: b.local_key_id.clone(),
            key_id: b.key_id.clone(),
            clerk_instance_id: b.clerk_instance_id.clone(),
            inference_origin: b.inference_origin.clone(),
        }),
    }
}

struct Fixture {
    root: PathBuf,
    delivery: PathBuf,
    store: ManagedHostKeyStore,
    previous: ManagedHostKeyBinding,
    next: ManagedHostKeyBinding,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-server-repair-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("state")).unwrap();
        let f = Self {
            delivery: root.join("bootstrap.json"),
            store: ManagedHostKeyStore::new(&root.join("state")),
            previous: binding(),
            next: successor(&binding()),
            root,
        };
        f.deliver(&f.previous);
        f.store.import(&f.previous, &f.delivery).unwrap();
        f
    }

    fn deliver(&self, b: &ManagedHostKeyBinding) {
        let mut wire = serde_json::to_value(b).unwrap();
        wire["version"] = json!(3);
        wire["credential_kind"] = json!("clerk_api_key");
        wire["scopes"] = json!(["managed:inference"]);
        wire["api_key"] = json!(CANARY);
        fs::write(&self.delivery, serde_json::to_vec(&wire).unwrap()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.delivery, fs::Permissions::from_mode(0o600)).unwrap();
        }
    }

    fn service(
        &self,
        b: &ManagedHostKeyBinding,
        authority: Arc<dyn ManagedHostKeyLifecycleAuthority>,
    ) -> ManagedHostKeyRepairService {
        let mut service =
            ManagedHostKeyRepairService::with_authority(&config(&self.root, b), authority).unwrap();
        // Only the in-process fixture substitutes its owned synthetic mount.
        // Production construction accepts the fixed controller path only.
        service.delivery = self.delivery.clone();
        service
    }

    fn snapshot(&self) -> (Vec<u8>, Vec<u8>) {
        (
            fs::read(self.root.join("state/managed_host_key.json")).unwrap(),
            fs::read(self.root.join("state/managed_host_key_receipt.json")).unwrap(),
        )
    }

    fn record(&self) -> Value {
        serde_json::from_slice(&self.snapshot().0).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct Lifecycle {
    eligible: bool,
    current: ManagedHostKeyBinding,
}

type Pause = (mpsc::Sender<()>, mpsc::Receiver<()>);

// Test-only privileged sender. It models current readback and a common
// departure/repair gate; no Clerk authentication or canonical wire is claimed.
struct SyntheticSender {
    state: Mutex<Lifecycle>,
    lose_response: AtomicBool,
    pause_after_apply: Mutex<Option<Pause>>,
}

impl SyntheticSender {
    fn new(current: ManagedHostKeyBinding) -> Self {
        Self {
            state: Mutex::new(Lifecycle {
                eligible: true,
                current,
            }),
            lose_response: AtomicBool::new(false),
            pause_after_apply: Mutex::new(None),
        }
    }
}

impl ManagedHostKeyLifecycleAuthority for SyntheticSender {
    fn with_current_authority(
        &self,
        mutation: ManagedHostKeyMutation<'_>,
        apply: &mut ManagedHostKeyApply<'_>,
    ) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        {
            let mut check_current = || {
                match mutation {
                    ManagedHostKeyMutation::RecordRevocation { current } => {
                        anyhow::ensure!(*current == state.current);
                    }
                    ManagedHostKeyMutation::Repair {
                        predecessor,
                        successor,
                    } => {
                        anyhow::ensure!(state.eligible);
                        anyhow::ensure!(
                            *predecessor == state.current || *successor == state.current
                        );
                    }
                }
                Ok(())
            };
            check_current()?;
            apply(&mut check_current)?;
        }
        if let ManagedHostKeyMutation::Repair { successor, .. } = mutation {
            state.current = successor.clone();
        }
        if let Some((reached, resume)) = self.pause_after_apply.lock().unwrap().take() {
            reached.send(()).unwrap();
            resume
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap();
        }
        anyhow::ensure!(!self.lose_response.swap(false, Ordering::SeqCst));
        Ok(())
    }
}

#[test]
fn managed_host_key_repair_default_denies_without_private_mutation_or_legacy_fallback() {
    let f = Fixture::new();
    let before = f.snapshot();
    let service = ManagedHostKeyRepairService::from_config(&config(&f.root, &f.previous)).unwrap();
    assert!(service.record_revocation().is_err());
    assert!(service.repair(&f.previous).is_err());
    assert_eq!(f.snapshot(), before);
    let mut legacy = config(&f.root, &f.previous);
    legacy.version = 2;
    assert!(ManagedHostKeyRepairService::from_config(&legacy).is_err());
    let mut arbitrary_mount = config(&f.root, &f.previous);
    arbitrary_mount.model_credential_file = f.delivery.clone();
    assert!(ManagedHostKeyRepairService::from_config(&arbitrary_mount).is_err());
}

#[cfg(unix)]
#[test]
fn managed_host_key_repair_authority_expiry_during_credential_lock_wait_denies_publication() {
    use std::os::fd::AsRawFd;

    struct ExpiringSender {
        current: Arc<AtomicBool>,
        entered: mpsc::Sender<()>,
    }
    impl ManagedHostKeyLifecycleAuthority for ExpiringSender {
        fn with_current_authority(
            &self,
            _: ManagedHostKeyMutation<'_>,
            apply: &mut ManagedHostKeyApply<'_>,
        ) -> Result<()> {
            let mut check = || {
                anyhow::ensure!(self.current.load(Ordering::SeqCst));
                Ok(())
            };
            check()?;
            self.entered.send(()).unwrap();
            apply(&mut check)
        }
    }
    let f = Fixture::new();
    f.store.record_revocation(&f.previous).unwrap();
    f.deliver(&f.next);
    let empty = f.snapshot();
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(f.root.join("state/arcee_auth.json.lock"))
        .unwrap();
    // Hold only this fixture's existing credential lock. No sleeping or shared
    // state mutation: admission is observed before authority expires/unlocks.
    assert_eq!(
        unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
        0
    );
    let current = Arc::new(AtomicBool::new(true));
    let (entered, admitted) = mpsc::channel();
    let service = f.service(
        &f.next,
        Arc::new(ExpiringSender {
            current: current.clone(),
            entered,
        }),
    );
    let previous = f.previous.clone();
    let worker = thread::spawn(move || service.repair(&previous));
    admitted
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    current.store(false, Ordering::SeqCst);
    assert_eq!(unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_UN) }, 0);
    assert!(worker.join().unwrap().is_err());
    assert_eq!(f.snapshot(), empty);
}

#[test]
fn managed_host_key_repair_composition_revoke_repair_receipt_restart_lost_response_duplicate() {
    let _env_guard = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let f = Fixture::new();
    let sender = Arc::new(SyntheticSender::new(f.previous.clone()));
    let old = ManagedHostExecutionAuthority::new(
        TrustedManagedHostKey::new(&f.root.join("state"), f.previous.clone()).unwrap(),
    );
    old.check_available().unwrap();
    f.service(&f.previous, sender.clone())
        .record_revocation()
        .unwrap();
    assert_eq!(f.record()["api_key"], Value::Null);
    assert!(old.check_available().is_err());
    f.deliver(&f.next);
    let repair = f.service(&f.next, sender.clone());
    sender.lose_response.store(true, Ordering::SeqCst);
    assert!(repair.repair(&f.previous).is_err());
    // The lost response must not roll back a durable generation-2 commit.
    assert_eq!(f.record()["binding"]["key_generation"], 2);
    let committed = f.snapshot();
    fs::remove_file(&f.delivery).unwrap();
    repair.repair(&f.previous).unwrap();
    assert_eq!(f.snapshot(), committed);
    assert_eq!(
        f.record()["consumed_bootstrap_ids"],
        json!([f.previous.bootstrap_id, f.next.bootstrap_id])
    );
    let receipt: Value = serde_json::from_slice(&committed.1).unwrap();
    assert_eq!(receipt["version"], 3);
    assert_eq!(receipt["disposition"], "imported");
    assert_eq!(receipt["key_generation"], 2);
    assert_eq!(receipt.as_object().unwrap().len(), 15);
    assert!(!String::from_utf8_lossy(&committed.1).contains(CANARY));
    assert!(old.check_available().is_err());
    // Execute the actual ordinary startup importer with successor config. It
    // sees the repaired authority, never the now-absent bootstrap fixture.
    let next_config = config(&f.root, &f.next);
    let _env = crate::tests::ScopedModelEnv::isolated(&next_config.state_root, None);
    let profile = ManagedModelProfile::from_config(&next_config).unwrap();
    profile.initialize(&next_config).unwrap();
    profile.credential_ready(&next_config).unwrap();
    profile
        .host_execution_authority()
        .unwrap()
        .check_available()
        .unwrap();
    assert_eq!(f.snapshot(), committed);
    assert!(f.store.import(&f.previous, &f.delivery).is_err());
}

struct ApplyOnly;
impl ManagedHostKeyLifecycleAuthority for ApplyOnly {
    fn with_current_authority(
        &self,
        _: ManagedHostKeyMutation<'_>,
        apply: &mut ManagedHostKeyApply<'_>,
    ) -> Result<()> {
        apply(&mut || Ok(()))
    }
}

#[test]
fn managed_host_key_repair_duplicate_after_cutoff_cannot_refill_or_claim_availability() {
    let f = Fixture::new();
    f.store.record_revocation(&f.previous).unwrap();
    f.deliver(&f.next);
    let service = f.service(&f.next, Arc::new(ApplyOnly));
    service.repair(&f.previous).unwrap();
    f.store.record_revocation(&f.next).unwrap();
    let cut_off = f.snapshot();
    assert!(service.repair(&f.previous).is_err());
    assert_eq!(f.snapshot(), cut_off);
    assert_eq!(f.record()["api_key"], Value::Null);
}

struct BrokenSender;
impl ManagedHostKeyLifecycleAuthority for BrokenSender {
    fn with_current_authority(
        &self,
        _: ManagedHostKeyMutation<'_>,
        _: &mut ManagedHostKeyApply<'_>,
    ) -> Result<()> {
        Ok(())
    }
}

struct PrivateSenderError;
impl ManagedHostKeyLifecycleAuthority for PrivateSenderError {
    fn with_current_authority(
        &self,
        _: ManagedHostKeyMutation<'_>,
        _: &mut ManagedHostKeyApply<'_>,
    ) -> Result<()> {
        bail!(CANARY)
    }
}

struct RepeatedSender;
impl ManagedHostKeyLifecycleAuthority for RepeatedSender {
    fn with_current_authority(
        &self,
        _: ManagedHostKeyMutation<'_>,
        apply: &mut ManagedHostKeyApply<'_>,
    ) -> Result<()> {
        let mut check_current = || Ok(());
        apply(&mut check_current)?;
        let _ = apply(&mut check_current);
        Ok(())
    }
}

#[test]
fn managed_host_key_repair_repeated_callback_has_one_effect_and_no_success_response() {
    let f = Fixture::new();
    assert!(f
        .service(&f.previous, Arc::new(RepeatedSender))
        .record_revocation()
        .is_err());
    assert_eq!(f.record()["api_key"], Value::Null);
    assert_eq!(
        f.record()["consumed_bootstrap_ids"],
        json!([f.previous.bootstrap_id])
    );
}

#[test]
fn managed_host_key_repair_missing_callback_and_private_sender_error_fail_closed() {
    let f = Fixture::new();
    let before = f.snapshot();
    for sender in [
        Arc::new(BrokenSender) as Arc<dyn ManagedHostKeyLifecycleAuthority>,
        Arc::new(PrivateSenderError),
    ] {
        let error = f
            .service(&f.previous, sender)
            .record_revocation()
            .unwrap_err();
        assert!(!format!("{error:?}").contains(CANARY));
        assert_eq!(f.snapshot(), before);
    }
}

#[test]
fn managed_host_key_repair_composition_keeps_native_cas_active_slot_and_owner_constraints() {
    let f = Fixture::new();
    f.deliver(&f.next);
    let service = f.service(&f.next, Arc::new(ApplyOnly));
    let before = f.snapshot();
    assert!(service.repair(&f.previous).is_err());
    assert_eq!(f.snapshot(), before);
    f.store.record_revocation(&f.previous).unwrap();
    let empty = f.snapshot();
    let mut wrong = f.previous.clone();
    wrong.local_key_id = Uuid::new_v4().to_string();
    assert!(service.repair(&wrong).is_err());
    assert_eq!(f.snapshot(), empty);
    for field in [
        "pvc_uid",
        "owner_epoch",
        "organization_id",
        "host_incarnation_id",
        "key_generation",
        "bootstrap_id",
    ] {
        let mut next = f.next.clone();
        match field {
            "pvc_uid" => next.pvc_uid = "different-pvc".into(),
            "owner_epoch" => next.owner_epoch = 2,
            "organization_id" => next.organization_id = Uuid::new_v4().to_string(),
            "host_incarnation_id" => next.host_incarnation_id = "different-cr".into(),
            "key_generation" => next.key_generation = 1,
            "bootstrap_id" => next.bootstrap_id = f.previous.bootstrap_id.clone(),
            _ => unreachable!(),
        }
        f.deliver(&next);
        assert!(
            f.service(&next, Arc::new(ApplyOnly))
                .repair(&f.previous)
                .is_err(),
            "{field}"
        );
        assert_eq!(f.snapshot(), empty, "{field}");
    }
}

#[test]
fn managed_host_key_repair_departure_before_admission_denies_waiting_repair() {
    let f = Fixture::new();
    f.deliver(&f.next);
    let sender = Arc::new(SyntheticSender::new(f.previous.clone()));
    let service = f.service(&f.next, sender.clone());
    let mut lifecycle = sender.state.lock().unwrap();
    let previous = f.previous.clone();
    let (started, waiting) = mpsc::channel();
    let worker = thread::spawn(move || {
        started.send(()).unwrap();
        service.repair(&previous)
    });
    waiting
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    lifecycle.eligible = false;
    f.store.record_revocation(&lifecycle.current).unwrap();
    let empty = f.snapshot();
    drop(lifecycle);
    assert!(worker.join().unwrap().is_err());
    assert_eq!(f.snapshot(), empty);
    assert_eq!(f.record()["binding"]["key_generation"], 1);
    assert_eq!(f.record()["api_key"], Value::Null);
}

#[test]
fn managed_host_key_repair_departure_after_commit_cuts_off_successor_under_same_barrier() {
    let f = Fixture::new();
    f.store.record_revocation(&f.previous).unwrap();
    f.deliver(&f.next);
    let sender = Arc::new(SyntheticSender::new(f.previous.clone()));
    let service = f.service(&f.next, sender.clone());
    let previous = f.previous.clone();
    let (reached, observed) = mpsc::channel();
    let (resume, paused) = mpsc::channel();
    *sender.pause_after_apply.lock().unwrap() = Some((reached, paused));
    let repair = thread::spawn(move || service.repair(&previous));
    observed
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    let departure_sender = sender.clone();
    let store = f.store.clone();
    let (started, waiting) = mpsc::channel();
    let departure = thread::spawn(move || {
        started.send(()).unwrap();
        let mut lifecycle = departure_sender.state.lock().unwrap();
        lifecycle.eligible = false;
        store.record_revocation(&lifecycle.current).unwrap();
    });
    waiting
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    resume.send(()).unwrap();
    repair.join().unwrap().unwrap();
    departure.join().unwrap();
    assert_eq!(f.record()["binding"]["key_generation"], 2);
    assert_eq!(f.record()["api_key"], Value::Null);
    assert!(f.service(&f.next, sender).repair(&f.previous).is_err());
    assert!(
        TrustedManagedHostKey::new(&f.root.join("state"), f.next.clone())
            .unwrap()
            .check_available()
            .is_err()
    );
}
