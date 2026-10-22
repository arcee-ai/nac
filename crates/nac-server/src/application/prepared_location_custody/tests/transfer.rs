//! Real Native directory/host ownership; Core and execution controls are
//! explicitly synthetic. No authenticated receipt or process reap is qualified.
use super::*;
use crate::application::{
    admitted_session_publication_work::PublicationObservation,
    create_transfer::{CreateTransferPhase, CreateTransferRequest},
};
use std::{
    os::fd::AsRawFd,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

struct SyntheticExecution {
    dropped: Arc<AtomicBool>,
    denied: Arc<AtomicBool>,
}
impl nac_core::runtime::PreparationResourceCustody for SyntheticExecution {
    fn check_outside_store(&self) -> Result<()> {
        self.check_denial()
    }
    fn check_denial(&self) -> Result<()> {
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "synthetic execution denied"
        );
        Ok(())
    }
    fn deny(&self) {
        self.denied.store(true, Ordering::Release);
    }
}
impl Drop for SyntheticExecution {
    fn drop(&mut self) {
        self.dropped.store(true, Ordering::Release);
    }
}
fn execution() -> (
    Box<dyn nac_core::runtime::PreparationResourceCustody>,
    Arc<AtomicBool>,
    Arc<AtomicBool>,
) {
    let dropped = Arc::new(AtomicBool::new(false));
    let denied = Arc::new(AtomicBool::new(false));
    (
        Box::new(SyntheticExecution {
            dropped: Arc::clone(&dropped),
            denied: Arc::clone(&denied),
        }),
        dropped,
        denied,
    )
}
fn assert_original_descriptor(fd: i32, inode: u64) {
    let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: fstat initializes metadata on success; assert precedes the read.
    assert_eq!(unsafe { libc::fstat(fd, metadata.as_mut_ptr()) }, 0);
    assert_eq!(unsafe { metadata.assume_init() }.st_ino, inode);
}

// Synthetic operation DATA only. Core/execution remain the same explicitly
// synthetic controls; this helper establishes no AFM or CREATE authority.
fn synthetic_managed_request(
    manager: &SessionManager,
    intended: uuid::Uuid,
) -> crate::application::managed_create_request::ValidatedManagedCreateRequest {
    use crate::application::{managed_create_request::*, public_session_creation::*, Field};
    use serde_json::json;
    use sha2::{Digest, Sha256};
    let native = manager.managed_location_binding().unwrap();
    let operation_id = uuid::Uuid::from_u128(21);
    let canonical = json!([
        "native-session-operation-v3",
        "fixture",
        "fixture",
        uuid::Uuid::from_u128(1),
        0,
        uuid::Uuid::from_u128(2),
        0,
        uuid::Uuid::from_u128(3),
        0,
        native.logical_host_id,
        native.host_incarnation_id,
        1,
        0,
        uuid::Uuid::from_u128(12),
        0,
        ["create"],
        ["location", "fixture-root", vec![16; 32]],
        "fixture-model",
        vec![18; 32],
        vec![20; 32],
        vec![19; 32]
    ]);
    let intent_sha256 = Sha256::digest(serde_json::to_vec(&canonical).unwrap()).into();
    let epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    ValidatedManagedCreateRequest::from_checked_envelope(
        PublicSessionCreationCommand {
            context: PublicCreationContext::WorkingLocation("fixture-root".into()),
            model_config_id: None,
            reasoning_effort: Field::Unchanged,
            behavior: nac_core::sessions::SessionBehavior::Direct,
            first_chat: false,
            first_chat_same_behavior: false,
        },
        ManagedCreateBinding {
            operation_id,
            claim_sequence: 1,
            intended_session_id: intended,
            canonical_intent: canonical,
            intent_sha256,
            configuration_sha256: [20; 32],
        },
        ManagedCreateCurrentness {
            request: PublicCreateCurrentness {
                request_id: operation_id.to_string(),
                if_match: Some(format!("\"{}\"", "a".repeat(64))),
            },
            native,
            original_cutoff: Instant::now() + Duration::from_secs(30),
            original_expiry_epoch_ms: epoch + 30_000,
        },
    )
}

#[tokio::test]
async fn managed_create_binding_wrong_result_fails_before_insert_and_retains_both_original_owners()
{
    let mut f = Fixture::new();
    f.config.logical_host_id = uuid::Uuid::from_u128(7).to_string();
    let manager = manager(&f);
    let location = retain_root(&manager).await;
    let fd = location.location.directory_handle().as_raw_fd();
    let inode = location
        .location
        .directory_handle()
        .metadata()
        .unwrap()
        .ino();
    let (admitted, control) = synthetic_prepared(&manager, &f.config.repository_root, None).await;
    let actual_id = admitted.session_id().to_owned();
    let request = synthetic_managed_request(&manager, uuid::Uuid::from_u128(99));
    let binding_address = request.binding() as *const _ as usize;
    let (execution, dropped, _) = execution();
    let attempt = manager.session_creation().start_admitted_create_transfer(
        admitted,
        location,
        execution,
        CreateTransferRequest::Managed(request),
    );
    let readback = attempt.readback();
    assert!(attempt.wait().await.is_err());
    assert_eq!(readback.observe(), CreateTransferPhase::Unknown);
    assert_eq!(readback.retained_binding_address(), Some(binding_address));
    assert!(control.owner_is_retained());
    assert!(manager.inner.create_transfers.retains_session(&actual_id));
    assert!(nac_core::sessions::load_session(&manager.inner.store_path, &actual_id).is_err());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    assert!(!dropped.load(Ordering::Acquire));
    assert_original_descriptor(fd, inode);
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
}

#[tokio::test]
async fn public_create_projection_uses_actual_retained_service_identity() {
    let mut f = Fixture::new();
    f.config.logical_host_id = uuid::Uuid::from_u128(7).to_string();
    let manager = manager(&f);
    let location = retain_root(&manager).await;
    let (admitted, control) = synthetic_prepared(&manager, &f.config.repository_root, None).await;
    let actual_id = admitted.session_id().to_owned();
    let request = synthetic_managed_request(&manager, uuid::Uuid::parse_str(&actual_id).unwrap());
    let (execution, dropped, denied) = execution();
    let actual = manager
        .session_creation()
        .publish_public_prepared(request, admitted, location, execution)
        .await
        .unwrap();
    assert_eq!(actual.session_id, actual_id);
    assert_eq!(actual.behavior, nac_core::sessions::SessionBehavior::Direct);
    assert_eq!(actual.project_id, None);
    assert!(control.owner_is_retained());
    assert!(!dropped.load(Ordering::Acquire));
    assert!(!denied.load(Ordering::Acquire));
    assert!(manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key(&actual_id));
}

#[tokio::test]
async fn native_create_transfer_retains_same_resources_in_active_runtime_after_request_completion()
{
    let f = Fixture::new();
    let manager = manager(&f);
    let location = retain_root(&manager).await;
    let fd = location.location.directory_handle().as_raw_fd();
    let inode = location
        .location
        .directory_handle()
        .metadata()
        .unwrap()
        .ino();
    let (admitted, control) = synthetic_prepared(&manager, &f.config.repository_root, None).await;
    let id = admitted.session_id().to_owned();
    let version = admitted.config_version().unwrap();
    let (execution, dropped, denied) = execution();
    let attempt = manager.session_creation().start_admitted_create_transfer(
        admitted,
        location,
        execution,
        CreateTransferRequest::SyntheticUnbound,
    );
    let readback = attempt.readback();
    let receipt = attempt.wait().await.unwrap();
    assert_eq!(receipt.session_id(), id);
    assert_eq!(receipt.configuration_version(), version);
    assert_eq!(readback.observe(), CreateTransferPhase::Transferred);
    assert!(
        control.is_retired(),
        "one-use publication ends independently from runtime resources"
    );
    assert!(
        control.owner_is_retained(),
        "local completion must retain the original Core allocation"
    );
    drop(receipt);
    drop(readback);
    assert!(
        control.owner_is_retained(),
        "receipt/readback drops do not settle Core custody"
    );
    manager.sweep_idle_sessions(None).await;
    assert!(
        manager.inner.active_sessions.read().await.contains_key(&id),
        "active custody pins exact service against ordinary idle eviction"
    );
    assert_original_descriptor(fd, inode);
    assert!(!dropped.load(Ordering::Acquire));
    assert!(!denied.load(Ordering::Acquire));
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
    let error = manager.delete_session(&id).await.unwrap_err();
    assert!(error.to_string().contains("original CREATE"));
    assert!(nac_core::sessions::load_session(&manager.inner.store_path, &id).is_ok());
}

#[tokio::test]
async fn native_create_transfer_canceled_quiet_request_retains_unknown_resources() {
    let f = Fixture::new();
    let manager = manager(&f);
    let location = retain_root(&manager).await;
    let fd = location.location.directory_handle().as_raw_fd();
    let inode = location
        .location
        .directory_handle()
        .metadata()
        .unwrap()
        .ino();
    let (admitted, control) = synthetic_prepared(&manager, &f.config.repository_root, None).await;
    let id = admitted.session_id().to_owned();
    let gate = manager.lifecycle_gate(&id);
    let held = gate.lock().await;
    let (execution, dropped, denied) = execution();
    let attempt = manager.session_creation().start_admitted_create_transfer(
        admitted,
        location,
        execution,
        CreateTransferRequest::SyntheticUnbound,
    );
    let readback = attempt.readback();
    drop(attempt);
    let PublicationObservation::Finished(result) = readback
        .publication
        .wait_until(Instant::now() + Duration::from_secs(2))
        .await
    else {
        panic!("original task did not report");
    };
    assert!(result.result().is_err());
    assert_eq!(readback.observe(), CreateTransferPhase::Unknown);
    assert!(control.is_retired());
    assert!(
        control.owner_is_retained(),
        "cancelled original admission must remain owned"
    );
    assert!(denied.load(Ordering::Acquire));
    assert!(!dropped.load(Ordering::Acquire));
    drop(held);
    drop(readback);
    assert_original_descriptor(fd, inode);
    assert!(manager.inner.create_transfers.retains_session(&id));
    assert!(nac_core::sessions::load_session(&manager.inner.store_path, &id).is_err());
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
}

#[tokio::test]
async fn native_create_transfer_scope_failure_keeps_original_owner_in_unknown_custody() {
    let f = Fixture::new();
    let manager = manager(&f);
    let location = retain_root(&manager).await;
    let (admitted, control) = synthetic_prepared(&manager, &f.root, None).await;
    let id = admitted.session_id().to_owned();
    let (execution, dropped, denied) = execution();
    let attempt = manager.session_creation().start_admitted_create_transfer(
        admitted,
        location,
        execution,
        CreateTransferRequest::SyntheticUnbound,
    );
    let readback = attempt.readback();
    assert!(attempt.wait().await.is_err());
    assert_eq!(readback.observe(), CreateTransferPhase::Unknown);
    assert!(control.is_retired());
    assert!(
        control.owner_is_retained(),
        "failed start must not drop original Core prep resources"
    );
    assert!(denied.load(Ordering::Acquire));
    assert!(!dropped.load(Ordering::Acquire));
    assert!(manager.inner.create_transfers.retains_session(&id));
    assert!(!manager.inner.active_sessions.read().await.contains_key(&id));
}

#[tokio::test]
async fn native_create_transfer_canceled_after_commit_keeps_row_and_resources_without_success_receipt(
) {
    let f = Fixture::new();
    let manager = manager(&f);
    let location = retain_root(&manager).await;
    let (admitted, control) = synthetic_prepared(&manager, &f.config.repository_root, None).await;
    let id = admitted.session_id().to_owned();
    let (execution, dropped, _) = execution();
    let gate = Arc::new(crate::application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = Some(Arc::clone(&gate));
    let attempt = manager.session_creation().start_admitted_create_transfer(
        admitted,
        location,
        execution,
        CreateTransferRequest::SyntheticUnbound,
    );
    let readback = attempt.readback();
    gate.reached.notified().await;
    assert!(nac_core::sessions::load_session(&manager.inner.store_path, &id).is_ok());
    drop(attempt);
    let PublicationObservation::Finished(result) = readback
        .publication
        .wait_until(Instant::now() + Duration::from_secs(2))
        .await
    else {
        panic!("original task did not report");
    };
    assert!(result.result().is_err());
    assert_eq!(readback.observe(), CreateTransferPhase::Unknown);
    assert!(control.is_retired());
    assert!(
        control.owner_is_retained(),
        "a committed row is not terminal settlement"
    );
    assert!(!dropped.load(Ordering::Acquire));
    assert!(!manager.inner.active_sessions.read().await.contains_key(&id));
    assert!(nac_core::sessions::load_session(&manager.inner.store_path, &id).is_ok());
}

#[tokio::test]
async fn native_create_transfer_refuses_local_receipt_when_cached_service_disappeared() {
    let f = Fixture::new();
    let manager = manager(&f);
    let location = retain_root(&manager).await;
    let (admitted, control) = synthetic_prepared(&manager, &f.config.repository_root, None).await;
    let id = admitted.session_id().to_owned();
    let (execution, dropped, _) = execution();
    let attempt = manager.session_creation().start_admitted_create_transfer(
        admitted,
        location,
        execution,
        CreateTransferRequest::SyntheticUnbound,
    );
    let readback = attempt.readback();
    let PublicationObservation::Finished(result) = readback
        .publication
        .wait_until(Instant::now() + Duration::from_secs(2))
        .await
    else {
        panic!("original task did not report");
    };
    result.result().unwrap();
    manager.inner.active_sessions.write().await.remove(&id);
    assert!(
        attempt.wait().await.is_err(),
        "historical publication cannot issue a current transfer witness"
    );
    assert!(control.owner_is_retained());
    assert!(!dropped.load(Ordering::Acquire));
    assert!(manager.inner.create_transfers.retains_session(&id));
}

#[test]
fn native_create_transfer_unpolled_task_cancellation_preserves_original_core_owner() {
    let f = Fixture::new();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let (manager, attempt, readback, control, dropped, fd, inode) = runtime.block_on(async {
        let manager = manager(&f);
        let location = retain_root(&manager).await;
        let fd = location.location.directory_handle().as_raw_fd();
        let inode = location
            .location
            .directory_handle()
            .metadata()
            .unwrap()
            .ino();
        let (admitted, control) =
            synthetic_prepared(&manager, &f.config.repository_root, None).await;
        let (execution, dropped, _) = execution();
        let attempt = manager.session_creation().start_admitted_create_transfer(
            admitted,
            location,
            execution,
            CreateTransferRequest::SyntheticUnbound,
        );
        let readback = attempt.readback();
        // No await after spawn: the original publication future has not polled.
        (manager, attempt, readback, control, dropped, fd, inode)
    });
    drop(runtime);
    assert_eq!(readback.observe(), CreateTransferPhase::Unknown);
    assert!(matches!(
        readback.publication.observe(),
        PublicationObservation::Unknown
    ));
    assert!(control.is_retired());
    assert!(
        control.owner_is_retained(),
        "runtime task cancellation cannot discard original Core custody"
    );
    drop(attempt);
    drop(readback);
    assert!(control.owner_is_retained());
    assert!(!dropped.load(Ordering::Acquire));
    assert_original_descriptor(fd, inode);
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
}

#[tokio::test]
async fn native_create_transfer_original_manager_ends_without_a_resource_reference_cycle() {
    let f = Fixture::new();
    let manager = manager(&f);
    let location = retain_root(&manager).await;
    let original = Arc::downgrade(&manager.inner);
    let path = manager.inner.store_path.clone();
    drop(manager);
    assert!(original.upgrade().is_none());
    assert!(location.check_denial().is_err());
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&path).is_err(),
        "lost manager is denial, not release"
    );
    drop(location); // Known no-start control, never a runtime settlement.
    assert!(nac_core::sessions::HostMaintenanceLease::try_acquire(&path).is_ok());
}
