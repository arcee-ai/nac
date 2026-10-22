//! Explicit synthetic operation owner; never a production admission issuer.
use super::*;

#[derive(Clone)]
pub struct PublicationFixtureControl {
    retired: Arc<AtomicBool>,
    publication: SessionPublicationRetirement,
}
impl PublicationFixtureControl {
    pub fn retire(&self) {
        self.publication.retire();
    }
    pub fn is_retired(&self) -> bool {
        self.retired.load(Ordering::Acquire)
    }
    /// Passive synthetic-fixture observation; never retains or authorizes work.
    pub fn owner_is_retained(&self) -> bool {
        self.publication.0.strong_count() > 0
    }
}
struct FixtureOwner {
    retired: Arc<AtomicBool>,
    deadline: Instant,
}
impl VerifiedPublicationResources for FixtureOwner {
    fn check_current(&self) -> Result<()> {
        anyhow::ensure!(
            !self.retired.load(Ordering::Acquire),
            "synthetic publication retired"
        );
        Ok(())
    }
    fn original_deadline(&self) -> Instant {
        self.deadline
    }
    fn retire(&self) {
        self.retired.store(true, Ordering::Release);
    }
}

/// Supplies only the consumer's synthetic allowed/denied controls. It cannot
/// install a protected boundary, grant Ready or qualify production creation.
pub fn synthetic_publication(
    service: SessionService,
    resources: Option<crate::runtime::PreparedSessionResources>,
    kind: SessionPublicationKind,
    deadline: Instant,
) -> Result<(AdmittedSessionPublication, PublicationFixtureControl)> {
    let retired = Arc::new(AtomicBool::new(false));
    let publication = AdmittedSessionPublication::from_verified_runtime(
        service,
        resources,
        kind,
        Box::new(FixtureOwner {
            retired: Arc::clone(&retired),
            deadline,
        }),
        PublicationSource::Synthetic,
    )?;
    let control = PublicationFixtureControl {
        retired,
        publication: publication.retirement(),
    };
    Ok((publication, control))
}
