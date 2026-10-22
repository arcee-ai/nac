//! Original CREATE request and active runtime resource ownership.
//! Local transfer evidence is not an authenticated operation terminal receipt.
use super::{
    admitted_session_publication_work::{
        AdmittedPublicationAttempt, PublicationReadback, PublicationTaskInput,
    },
    prepared_location_custody::PreparedLocationCustody,
    session_creation::SessionCreationApplication,
};
use crate::{SessionManager, SessionService};
use anyhow::{ensure, Result};
use nac_core::{
    runtime::PreparationResourceCustody,
    session_service::{AdmittedSessionPublication, SessionPublicationRetirement},
};
use std::sync::{Arc, Mutex, Weak};

/// Production transfer always carries the owned managed binding. Only local
/// synthetic controls can exercise the older unbound consumer path.
pub(crate) enum CreateTransferRequest {
    Managed(super::managed_create_request::ValidatedManagedCreateRequest),
    #[cfg(test)]
    SyntheticUnbound,
}

/// The serving root retains every original allocation, including unknown work.
/// No observation, error or local cleanup result removes an entry. The genuine
/// authenticated terminal/finalizer join must supply the later release path.
#[derive(Default)]
pub(crate) struct CreateTransferRegistry(Mutex<Vec<Arc<CreateTransferOwner>>>);
impl CreateTransferRegistry {
    fn retain(&self, owner: Arc<CreateTransferOwner>) {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(owner);
    }
    pub(crate) fn retains_session(&self, id: &str) -> bool {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .any(|owner| owner.session_id == id)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CreateTransferPhase {
    Pending,
    Transferred,
    Unknown,
}
struct TransferState {
    phase: CreateTransferPhase,
    service: Option<Arc<SessionService>>,
    receipt_taken: bool,
    recorded: Option<nac_core::session_service::RecordedCreatePublication>,
    terminal: Option<Arc<super::create_terminal::QualifiedCreateTerminal>>,
}
pub(super) struct CreateTransferOwner {
    location: Arc<PreparedLocationCustody>,
    execution: Box<dyn PreparationResourceCustody>,
    managed_request: CreateTransferRequest,
    pub(super) session_id: String,
    // The SAME opaque Core allocation is moved here before task launch. A
    // completed/error result must not discard its source/admission resources.
    pub(super) original_publication: tokio::sync::Mutex<AdmittedSessionPublication>,
    pub(super) retirement: SessionPublicationRetirement,
    configuration_version: Option<i64>,
    factory: Option<Arc<nac_core::runtime::CreateFactoryOwner>>,
    state: Mutex<TransferState>,
}
impl CreateTransferOwner {
    pub(super) async fn validate(
        &self,
        manager: &SessionManager,
        admitted: &AdmittedSessionPublication,
    ) -> Result<()> {
        ensure!(
            admitted.kind() == nac_core::session_service::SessionPublicationKind::Create,
            "runtime transfer requires CREATE"
        );
        match &self.managed_request {
            CreateTransferRequest::Managed(request) => request
                .check_prepared(manager, admitted)
                .map_err(|_| anyhow::anyhow!("managed CREATE original binding changed"))?,
            #[cfg(test)]
            CreateTransferRequest::SyntheticUnbound => {}
        }
        self.execution.check_outside_store()?;
        self.location.verify_prepared(manager, admitted).await?;
        self.check_denial()
    }
    fn check_denial(&self) -> Result<()> {
        self.location.check_denial()?;
        self.execution.check_denial()
    }
    /// Called inside the actual cache publication lock; bounded vetoes only.
    pub(super) fn install_runtime(&self, service: &Arc<SessionService>) -> Result<()> {
        self.check_denial()?;
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ensure!(
            state.phase == CreateTransferPhase::Pending && state.service.is_none(),
            "original runtime resource transfer already attempted"
        );
        state.service = Some(Arc::clone(service));
        Ok(())
    }
    pub(super) fn finish_transfer(&self, admitted: &mut AdmittedSessionPublication) -> Result<()> {
        self.check_denial()?;
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ensure!(
            state.phase == CreateTransferPhase::Pending && state.service.is_some(),
            "original runtime resource transfer unavailable"
        );
        if let Some(factory) = &self.factory {
            state.recorded = Some(admitted.take_recorded_create_for(factory)?);
            let service = Arc::clone(
                state
                    .service
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("actual runtime absent"))?,
            );
            let request = match &self.managed_request {
                CreateTransferRequest::Managed(request) => request,
                #[cfg(test)]
                CreateTransferRequest::SyntheticUnbound => {
                    anyhow::bail!("genuine Core terminal requires original managed request")
                }
            };
            state.terminal = Some(
                super::create_terminal::QualifiedCreateTerminal::from_published_transfer(
                    &mut state.recorded,
                    request,
                    &service,
                )?,
            );
        }
        state.phase = CreateTransferPhase::Transferred;
        Ok(())
    }
    fn unknown(&self) {
        self.location.deny();
        self.execution.deny();
        // Retain even a service installed before the final check failed. This
        // neither proves rollback nor permits rebuilding the original runtime.
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .phase = CreateTransferPhase::Unknown;
        // Denial is independent of ownership and runs outside the state lock.
        self.retirement.retire();
    }
    async fn take_receipt(
        self: &Arc<Self>,
        manager: &SessionManager,
    ) -> Result<CreateTransferReceipt> {
        // Physical resource checks are outside the cache/state locks.
        self.location.check_outside_store(manager)?;
        self.execution.check_outside_store()?;
        let active = manager.inner.active_sessions.read().await;
        self.check_denial()?;
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ensure!(
            state.phase == CreateTransferPhase::Transferred && !state.receipt_taken,
            "original runtime transfer receipt unavailable or consumed"
        );
        let service = state
            .service
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("runtime owner absent"))?;
        ensure!(
            active
                .get(&self.session_id)
                .is_some_and(|cached| Arc::ptr_eq(cached, service)),
            "active runtime owner changed"
        );
        let version = self
            .configuration_version
            .filter(|version| *version >= 0)
            .ok_or_else(|| anyhow::anyhow!("runtime configuration unavailable"))?;
        state.receipt_taken = true;
        Ok(CreateTransferReceipt {
            owner: Arc::clone(self),
            configuration_version: version,
        })
    }
}

/// Nonclone local evidence, issued once only after the actual same service and
/// resources transfer. No operation/sequence/intent or authentication is invented.
/// The future authenticated producer must join Core's genuine bound consumed
/// owner; these session/config getters alone cannot complete AFM's journal.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "genuine authenticated CREATE terminal producer is not installed"
    )
)]
pub(crate) struct CreateTransferReceipt {
    owner: Arc<CreateTransferOwner>,
    configuration_version: i64,
}
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "genuine authenticated CREATE terminal producer is not installed"
    )
)]
impl CreateTransferReceipt {
    pub(crate) fn into_terminal_body(self) -> Result<Arc<[u8]>> {
        let state = self
            .owner
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ensure!(
            state.phase == CreateTransferPhase::Transferred,
            "original transfer is unknown"
        );
        Ok(state
            .terminal
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("genuine Core terminal absent"))?
            .bytes())
    }
    pub(crate) fn session_id(&self) -> &str {
        &self.owner.session_id
    }
    pub(crate) fn configuration_version(&self) -> i64 {
        self.configuration_version
    }

    pub(crate) fn into_created_identity(
        self,
    ) -> Result<super::public_session_creation::CreatedSessionIdentity> {
        let projected = (|| {
            self.owner.check_denial()?;
            let state = self
                .owner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            ensure!(
                state.phase == CreateTransferPhase::Transferred,
                "runtime transfer changed"
            );
            let metadata = state
                .service
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("runtime owner absent"))?
                .metadata();
            let session_id = metadata
                .session_id
                .ok_or_else(|| anyhow::anyhow!("runtime identity absent"))?;
            ensure!(
                session_id == self.owner.session_id,
                "runtime identity changed"
            );
            Ok(super::public_session_creation::CreatedSessionIdentity {
                session_id,
                behavior: metadata.behavior,
                project_id: metadata.project_id,
            })
        })();
        if projected.is_err() {
            self.owner.unknown();
        }
        projected
    }
}

/// Passive same-allocation observation; no retry, release or receipt constructor.
#[derive(Clone)]
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "authenticated CREATE request readback is not installed"
    )
)]
pub(crate) struct CreateTransferReadback {
    owner: Weak<CreateTransferOwner>,
    pub(crate) publication: PublicationReadback,
}
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "authenticated CREATE request readback is not installed"
    )
)]
impl CreateTransferReadback {
    #[cfg(test)]
    pub(crate) fn retained_binding_address(&self) -> Option<usize> {
        match &self.owner.upgrade()?.managed_request {
            CreateTransferRequest::Managed(request) => Some(request.binding() as *const _ as usize),
            CreateTransferRequest::SyntheticUnbound => None,
        }
    }
    pub(crate) fn observe(&self) -> CreateTransferPhase {
        self.owner
            .upgrade()
            .map(|owner| {
                owner
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .phase
            })
            .unwrap_or(CreateTransferPhase::Unknown)
    }
}

pub(crate) struct CreateTransferAttempt {
    publication: AdmittedPublicationAttempt,
    owner: Arc<CreateTransferOwner>,
    manager: Weak<crate::SessionManagerInner>,
}
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "genuine authenticated CREATE terminal producer is not installed"
    )
)]
impl CreateTransferAttempt {
    pub(crate) fn readback(&self) -> CreateTransferReadback {
        CreateTransferReadback {
            owner: Arc::downgrade(&self.owner),
            publication: self.publication.readback(),
        }
    }
    pub(crate) async fn wait(self) -> Result<CreateTransferReceipt> {
        let snapshot = self.publication.wait().await?;
        ensure!(
            snapshot.is_some(),
            "CREATE transfer did not persist creation"
        );
        let inner = self
            .manager
            .upgrade()
            .ok_or_else(|| anyhow::anyhow!("original serving owner ended"))?;
        let result = self.owner.take_receipt(&SessionManager { inner }).await;
        if result.is_err() {
            self.owner.unknown();
        }
        result
    }
}

/// Construct before spawning, so never-polled/panicked work preserves unknown
/// custody. The serving registry, not the caller/readback, owns the resources.
pub(super) struct CreateTransferTaskGuard(Option<Arc<CreateTransferOwner>>);
impl CreateTransferTaskGuard {
    pub(super) fn new(owner: Arc<CreateTransferOwner>) -> Self {
        Self(Some(owner))
    }
    pub(super) fn complete(mut self) {
        self.0.take();
    }
}
impl Drop for CreateTransferTaskGuard {
    fn drop(&mut self) {
        if let Some(owner) = self.0.take() {
            owner.unknown();
        }
    }
}

impl SessionCreationApplication<'_> {
    /// Local producer portion only. Positive production construction still
    /// requires Core's actual bound publication/runtime/consumed handoff; these
    /// resource boxes are not its substitute. Capture them before preparation.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "genuine bound CREATE factory output is absent")
    )]
    pub(crate) fn start_admitted_create_transfer(
        &self,
        admitted: AdmittedSessionPublication,
        location: PreparedLocationCustody,
        execution: Box<dyn PreparationResourceCustody>,
        managed_request: CreateTransferRequest,
    ) -> CreateTransferAttempt {
        self.start_create_transfer_inner(
            admitted,
            Arc::new(location),
            execution,
            managed_request,
            None,
        )
    }
    pub(crate) fn start_bound_admitted_create_transfer(
        &self,
        admitted: AdmittedSessionPublication,
        factory: Arc<nac_core::runtime::CreateFactoryOwner>,
        location: Arc<PreparedLocationCustody>,
        execution: Box<dyn PreparationResourceCustody>,
        request: super::managed_create_request::ValidatedManagedCreateRequest,
    ) -> CreateTransferAttempt {
        self.start_create_transfer_inner(
            admitted,
            location,
            execution,
            CreateTransferRequest::Managed(request),
            Some(factory),
        )
    }
    fn start_create_transfer_inner(
        &self,
        admitted: AdmittedSessionPublication,
        location: Arc<PreparedLocationCustody>,
        execution: Box<dyn PreparationResourceCustody>,
        managed_request: CreateTransferRequest,
        factory: Option<Arc<nac_core::runtime::CreateFactoryOwner>>,
    ) -> CreateTransferAttempt {
        let owner = Arc::new(CreateTransferOwner {
            location,
            execution,
            managed_request,
            session_id: admitted.session_id().to_owned(),
            retirement: admitted.retirement(),
            configuration_version: admitted.config_version(),
            factory,
            original_publication: tokio::sync::Mutex::new(admitted),
            state: Mutex::new(TransferState {
                phase: CreateTransferPhase::Pending,
                service: None,
                receipt_taken: false,
                recorded: None,
                terminal: None,
            }),
        });
        // Install original serving-root custody before any await or task spawn.
        self.manager
            .inner
            .create_transfers
            .retain(Arc::clone(&owner));
        let publication = self
            .spawn_admitted_publication(PublicationTaskInput::RetainedCreate(Arc::clone(&owner)));
        CreateTransferAttempt {
            publication,
            owner,
            manager: Arc::downgrade(&self.manager.inner),
        }
    }
}

impl SessionCreationApplication<'_> {
    pub(crate) async fn acknowledge_create_terminal(
        &self,
        ack: &super::create_terminal::AckEnvelope,
        if_match: &str,
        exchange: nac_runtime_auth::CreateAckExchange,
    ) -> Result<()> {
        let retained = {
            let owners = self
                .manager
                .inner
                .create_transfers
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let owner = owners
                .iter()
                .find(|owner| match &owner.managed_request {
                    CreateTransferRequest::Managed(request) => {
                        request.binding().operation_id.to_string() == ack.operation_id()
                    }
                    #[cfg(test)]
                    CreateTransferRequest::SyntheticUnbound => false,
                })
                .ok_or_else(|| anyhow::anyhow!("original CREATE terminal owner unavailable"))?;
            let state = owner
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            ensure!(
                state.phase == CreateTransferPhase::Transferred,
                "original CREATE transfer unknown"
            );
            Arc::clone(
                state
                    .terminal
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("original Core terminal unavailable"))?,
            )
        };
        retained
            .acknowledge(
                ack,
                if_match,
                exchange,
                &self.manager.inner.publication_tasks,
            )
            .await
    }
}
