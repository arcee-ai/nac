//! Closed handoff from the Core admission/runtime factory to Native publication.
//! This consumer does not issue authority or prepare a backend. Production
//! construction stays unavailable until the genuine factory is composed.
use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(unix)]
#[path = "create_factory.rs"]
mod create_factory;
#[cfg(unix)]
pub(crate) use create_factory::PreparedCreatePublication;
#[cfg(unix)]
#[path = "protected_construction.rs"]
mod protected_construction;
#[cfg(unix)]
#[path = "recorded_create_publication.rs"]
mod recorded_create_publication;
#[cfg(unix)]
pub use recorded_create_publication::{RecordedCreatePublication, RecordedCreateTerminal};

/// Describes the already-admitted lifecycle operation; it grants nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionPublicationKind {
    Create,
    Activate,
}

// Only the Core factory may implement this owner. It must retain the actual
// consumed operation scope, original currentness/deadline and protected runtime
// preparation, not a configured callback or a transport/identity projection.
// Runtime lifetime is separate from this one-use publication lifetime.
trait VerifiedPublicationResources: Send + Sync {
    fn check_current(&self) -> Result<()>;
    fn original_deadline(&self) -> Instant;
    fn retire(&self);
    #[cfg(unix)]
    fn belongs_to_create_factory(&self, _owner: &Arc<crate::runtime::CreateFactoryOwner>) -> bool {
        false
    }
}

enum PublicationSource {
    Create(Arc<crate::store::native_source_reservation::NativeSourceReservation>),
    #[cfg(any(test, feature = "test-support"))]
    Synthetic,
}

pub(super) struct PublicationAuthority {
    resources: Box<dyn VerifiedPublicationResources>,
    source: PublicationSource,
    deadline: Instant,
    retired: AtomicBool,
    changed: tokio::sync::Notify,
}
impl PublicationAuthority {
    pub(super) fn check_current(&self) -> Result<()> {
        let result = (|| {
            anyhow::ensure!(
                !self.retired.load(Ordering::Acquire),
                "session publication retired"
            );
            anyhow::ensure!(
                Instant::now() < self.deadline,
                "session publication expired"
            );
            match &self.source {
                PublicationSource::Create(source) => source.check_denial()?,
                #[cfg(any(test, feature = "test-support"))]
                PublicationSource::Synthetic => {}
            }
            self.resources.check_current()?;
            anyhow::ensure!(
                !self.retired.load(Ordering::Acquire),
                "session publication retired"
            );
            Ok(())
        })();
        if result.is_err() {
            self.retire();
        }
        result
    }
    pub(super) fn insert_creation(
        &self,
        tx: &rusqlite::Transaction<'_>,
        path: &Path,
        snapshot: &sessions::SessionSnapshot,
    ) -> Result<()> {
        self.check_current()?;
        match &self.source {
            PublicationSource::Create(source) => source.insert_creation(tx, path, snapshot),
            #[cfg(any(test, feature = "test-support"))]
            PublicationSource::Synthetic => {
                sessions::insert_new_session_in_transaction(tx, path, snapshot)
            }
        }
    }
    fn retire(&self) {
        if !self.retired.swap(true, Ordering::AcqRel) {
            match &self.source {
                PublicationSource::Create(source) => source.deny(),
                #[cfg(any(test, feature = "test-support"))]
                PublicationSource::Synthetic => {}
            }
            self.resources.retire();
            self.changed.notify_waiters();
        }
    }
}

impl Drop for PublicationAuthority {
    fn drop(&mut self) {
        self.retire();
    }
}

#[cfg(unix)]
impl VerifiedPublicationResources for crate::runtime::CreatePublicationCustody {
    fn belongs_to_create_factory(&self, owner: &Arc<crate::runtime::CreateFactoryOwner>) -> bool {
        self.belongs_to(owner)
    }
    fn check_current(&self) -> Result<()> {
        self.check_current()
    }
    fn original_deadline(&self) -> Instant {
        self.original_deadline()
    }
    fn retire(&self) {
        self.retire();
    }
}

/// Denial only, bound to this original publication allocation. Retiring the
/// wait does not establish that an accepted store command or work retired.
#[derive(Clone)]
pub struct SessionPublicationRetirement(std::sync::Weak<PublicationAuthority>);
impl SessionPublicationRetirement {
    pub fn retire(&self) {
        if let Some(owner) = self.0.upgrade() {
            owner.retire();
        }
    }
    pub async fn retired(&self) {
        let Some(owner) = self.0.upgrade() else {
            return;
        };
        let changed = owner.changed.notified();
        tokio::pin!(changed);
        changed.as_mut().enable();
        if owner.check_current().is_err() {
            return;
        }
        tokio::select! {
            _ = &mut changed => {},
            _ = tokio::time::sleep_until(owner.deadline.into()) => owner.retire(),
        }
    }
}

/// Noncloneable, nonserializable, operation-bound actual runtime handoff.
/// There is deliberately no public positive constructor. The genuine Core
/// factory must prepare every runtime effect through its protected boundary
/// before supplying this owner; Native must not wrap its ordinary builder.
///
/// ```compile_fail
/// use nac_core::session_service::AdmittedSessionPublication;
/// fn cloneable<T: Clone>() {}
/// cloneable::<AdmittedSessionPublication>();
/// ```
/// ```compile_fail
/// use nac_core::session_service::AdmittedSessionPublication;
/// let _: AdmittedSessionPublication = serde_json::from_str("{}").unwrap();
/// ```
pub struct AdmittedSessionPublication {
    service: Arc<SessionService>,
    resources: Option<crate::runtime::PreparedSessionResources>,
    authority: Arc<PublicationAuthority>,
    kind: SessionPublicationKind,
    persisted: bool,
    publication_consumed: bool,
    publication_succeeded: bool,
    #[cfg(unix)]
    recorded_transfer_issued: bool,
}
impl Drop for AdmittedSessionPublication {
    fn drop(&mut self) {
        // Denial is immediate. Actual in-flight store work still retains this
        // original authority and resource owner until commit/rollback finishes.
        self.authority.retire();
    }
}
impl AdmittedSessionPublication {
    #[cfg_attr(
        not(any(test, feature = "test-support")),
        expect(
            dead_code,
            reason = "synthetic fixture constructor has no production caller"
        )
    )]
    fn from_verified_runtime(
        service: SessionService,
        resources: Option<crate::runtime::PreparedSessionResources>,
        kind: SessionPublicationKind,
        owner: Box<dyn VerifiedPublicationResources>,
        source: PublicationSource,
    ) -> Result<Self> {
        match &source {
            PublicationSource::Create(source) => {
                anyhow::ensure!(
                    kind == SessionPublicationKind::Create
                        && service.metadata.session_id.as_deref()
                            == Some(source.binding().session_id.as_str())
                        && service.metadata.project_id == source.binding().project_id
                        && owner.original_deadline() <= source.original_cutoff(),
                    "publication source binding mismatch"
                );
                source.check_current()?;
            }
            #[cfg(any(test, feature = "test-support"))]
            PublicationSource::Synthetic => {}
        }
        let authority = Arc::new(PublicationAuthority {
            deadline: owner.original_deadline(),
            resources: owner,
            source,
            retired: AtomicBool::new(false),
            changed: tokio::sync::Notify::new(),
        });
        anyhow::ensure!(
            (kind == SessionPublicationKind::Create) == resources.is_some(),
            "session publication resource kind mismatch"
        );
        anyhow::ensure!(
            service
                .metadata
                .session_id
                .as_deref()
                .is_some_and(|id| !id.is_empty()),
            "session identity unavailable"
        );
        anyhow::ensure!(
            service.config_version.is_some(),
            "session configuration unavailable"
        );
        authority.check_current()?;
        Ok(Self {
            service: Arc::new(service),
            resources,
            authority,
            kind,
            persisted: kind == SessionPublicationKind::Activate,
            publication_consumed: false,
            publication_succeeded: false,
            #[cfg(unix)]
            recorded_transfer_issued: false,
        })
    }
    pub fn kind(&self) -> SessionPublicationKind {
        self.kind
    }
    pub fn session_id(&self) -> &str {
        self.service
            .metadata
            .session_id
            .as_deref()
            .unwrap_or_default()
    }
    /// Read-only prepared location, never a new location/source capability.
    /// Native retains and revalidates its real directory owner outside locks.
    pub async fn local_working_directory(&self) -> Result<PathBuf> {
        let guard = self.service.session_snapshot.lock().await;
        let snapshot = guard
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("prepared session snapshot unavailable"))?;
        anyhow::ensure!(
            snapshot.ssh.is_none()
                && snapshot.sandbox_spec.is_none()
                && snapshot.cwd.to_str() == Some(self.service.metadata.cwd.as_str()),
            "prepared local working directory unavailable"
        );
        Ok(snapshot.cwd.clone())
    }
    pub fn project_id(&self) -> Option<&str> {
        self.service.metadata.project_id.as_deref()
    }
    pub fn store_path(&self) -> &Path {
        &self.service.metadata.store_path
    }
    pub fn config_version(&self) -> Option<i64> {
        self.service.config_version
    }
    pub fn retirement(&self) -> SessionPublicationRetirement {
        SessionPublicationRetirement(Arc::downgrade(&self.authority))
    }
    pub fn check_current(&self) -> Result<()> {
        self.authority.check_current()
    }
    /// Veto a mismatched or unfinished publication before Native's terminal
    /// issuer additionally checks its actual cache/lifecycle/resource transfer.
    /// This unit check is not a terminal witness or preparation-release proof.
    #[cfg(unix)]
    pub fn check_published_create_for(
        &self,
        owner: &Arc<crate::runtime::CreateFactoryOwner>,
    ) -> Result<()> {
        self.check_current()?;
        self.check_recorded_create_for(owner)?;
        self.check_current()
    }
    /// Check only the SAME original process/factory and immutable recorded
    /// checked-commit/publication history, including after one-use retirement.
    /// This is a veto for authenticated cleanup, not current CREATE eligibility,
    /// Native terminal qualification, permission to execute, or release proof.
    /// ACK consumers still require the actual fresh authenticated ACK and the
    /// same retained Native qualified terminal before preparation retirement.
    #[cfg(unix)]
    pub fn check_recorded_create_for(
        &self,
        owner: &Arc<crate::runtime::CreateFactoryOwner>,
    ) -> Result<()> {
        anyhow::ensure!(
            self.kind == SessionPublicationKind::Create
                && self.persisted
                && self.publication_succeeded,
            "CREATE publication is not complete"
        );
        match &self.authority.source {
            PublicationSource::Create(source) => anyhow::ensure!(
                owner.owns_source(source)
                    && self.authority.resources.belongs_to_create_factory(owner)
                    && self.service.metadata.store_path == source.bound_store_path()
                    && self.service.metadata.session_id.as_deref()
                        == Some(source.binding().session_id.as_str())
                    && self.service.metadata.project_id == source.binding().project_id
                    && self
                        .service
                        .config_version
                        .is_some_and(|version| version >= 0),
                "CREATE publication original owner differs"
            ),
            #[cfg(any(test, feature = "test-support"))]
            PublicationSource::Synthetic => anyhow::bail!("CREATE publication source unavailable"),
        }
        Ok(())
    }
    /// Reuses the original durable transaction and rollback owner. Checks run
    /// inside that actual transaction as well as before/after its awaited result.
    pub async fn persist_creation(&mut self) -> Result<SessionFrontendSnapshot> {
        self.check_current()?;
        anyhow::ensure!(
            self.kind == SessionPublicationKind::Create,
            "not a creation operation"
        );
        let resources = self
            .resources
            .take()
            .ok_or_else(|| anyhow::anyhow!("creation already consumed"))?;
        let snapshot = self
            .service
            .persist_new_session_with_snapshot_checked(resources, Some(Arc::clone(&self.authority)))
            .await?;
        self.check_current()?;
        self.persisted = true;
        Ok(snapshot)
    }
    /// The caller holds its actual cache/lifecycle lock. A failed final check
    /// requires it to remove only the exact service it just inserted. This does
    /// not undo a committed row or establish remote work settlement.
    pub fn publish(
        &mut self,
        publish: impl FnOnce(Arc<SessionService>) -> Result<()>,
    ) -> Result<()> {
        self.check_current()?;
        anyhow::ensure!(
            self.persisted,
            "creation must commit before cache publication"
        );
        anyhow::ensure!(
            !self.publication_consumed,
            "session publication already consumed"
        );
        self.publication_consumed = true;
        let result = publish(Arc::clone(&self.service)).and_then(|()| self.check_current());
        if result.is_err() {
            self.authority.retire();
        } else {
            // Record success only after both the actual callback and final
            // currentness check returned. A consumed/panicked attempt is not
            // successful publication and cannot pass the Native terminal veto.
            self.publication_succeeded = true;
        }
        result
    }
}

#[cfg(feature = "test-support")]
#[path = "admitted_publication_fixtures.rs"]
pub mod fixtures;

#[cfg(test)]
pub(super) fn transaction_retirement_control() -> Arc<PublicationAuthority> {
    // The actual transaction checks once before opening/inserting and again
    // before commit. Retire between those boundaries, not after SQL returns.
    struct RetiringOwner(std::sync::atomic::AtomicUsize);
    impl VerifiedPublicationResources for RetiringOwner {
        fn check_current(&self) -> Result<()> {
            anyhow::ensure!(
                self.0.fetch_add(1, Ordering::AcqRel) == 0,
                "retired before commit"
            );
            Ok(())
        }
        fn original_deadline(&self) -> Instant {
            Instant::now() + Duration::from_secs(10)
        }
        fn retire(&self) {}
    }
    Arc::new(PublicationAuthority {
        resources: Box::new(RetiringOwner(std::sync::atomic::AtomicUsize::new(0))),
        source: PublicationSource::Synthetic,
        deadline: Instant::now() + Duration::from_secs(10),
        retired: AtomicBool::new(false),
        changed: tokio::sync::Notify::new(),
    })
}

#[cfg(test)]
pub(super) fn source_transaction_control(
    source: Arc<crate::store::native_source_reservation::NativeSourceReservation>,
) -> Arc<PublicationAuthority> {
    struct SyntheticCurrent(Instant);
    impl VerifiedPublicationResources for SyntheticCurrent {
        fn check_current(&self) -> Result<()> {
            anyhow::ensure!(Instant::now() < self.0, "synthetic owner expired");
            Ok(())
        }
        fn original_deadline(&self) -> Instant {
            self.0
        }
        fn retire(&self) {}
    }
    Arc::new(PublicationAuthority {
        deadline: source.original_cutoff(),
        resources: Box::new(SyntheticCurrent(source.original_cutoff())),
        source: PublicationSource::Create(source),
        retired: AtomicBool::new(false),
        changed: tokio::sync::Notify::new(),
    })
}

#[cfg(all(test, unix))]
#[path = "published_create_tests.rs"]
mod published_create_tests;
