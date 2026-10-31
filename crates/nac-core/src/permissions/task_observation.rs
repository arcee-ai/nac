//! Passive access to existing process-local approval owners. No attachment,
//! execution lease, delta subscription or permission-answer capability.
use super::*;
use std::sync::LazyLock;

type RunObservation = Arc<dyn Fn() -> Option<String> + Send + Sync>;
struct Owner {
    broker: Weak<PermissionBroker>,
    run: Option<RunObservation>,
}
type Owners = HashMap<(PathBuf, String), Owner>;
static OWNERS: LazyLock<StdMutex<Owners>> = LazyLock::new(|| StdMutex::new(HashMap::new()));

pub(super) fn register(broker: &Arc<PermissionBroker>) {
    let mut owners = OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    owners.retain(|_, owner| owner.broker.strong_count() > 0);
    owners.insert(
        (broker.store_path.clone(), broker.session_id.clone()),
        Owner {
            broker: Arc::downgrade(broker),
            run: None,
        },
    );
}

/// Weak read-only view of the lifecycle owner's admitted run. An idle cached
/// broker never proves local ownership of a run executing in another process.
pub(crate) fn bind_runs(broker: &Arc<PermissionBroker>, run: RunObservation) {
    if let Some(owner) = OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get_mut(&(broker.store_path.clone(), broker.session_id.clone()))
    {
        if owner.broker.ptr_eq(&Arc::downgrade(broker)) {
            owner.run = Some(run);
        }
    }
}

/// Unknown for an unattached/foreign owner, including after restart. This
/// projection never manufactures a live approval from durable history.
pub(crate) fn pending(
    path: &Path,
    session_id: &str,
    run_id: Option<&str>,
) -> Option<Vec<PermissionRequest>> {
    let (broker, run) = {
        let owners = OWNERS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let owner = owners.get(&(path.to_path_buf(), session_id.to_owned()))?;
        (owner.broker.upgrade()?, owner.run.clone()?)
    };
    let expected = run_id?;
    if run().as_deref() != Some(expected) {
        return None;
    }
    let bus = broker
        .event_bus
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    bus.as_ref()?;
    drop(bus);
    let requests = broker.pending();
    (run().as_deref() == Some(expected)).then_some(requests)
}
