//! Browser fleet attention: a passive, multi-subscriber current-state read for
//! every session, built from the same `classify` the native observer uses.
//!
//! It never installs the single service attention observer, never reserves the
//! native seat, never subscribes to a session event bus (so it is never an
//! interactive client), and never attaches, wakes, recovers, answers or cancels
//! work. One shared refresher serves every stream; it exists only while at
//! least one stream is open. A slow stream only coalesces newer views.
use super::attention_runtime::classify;
use crate::{SessionManager, SessionManagerInner};
use nac_core::{
    events::{AttentionOperation, AttentionServiceSnapshot, AttentionSourceSnapshot},
    store::{
        AttentionLineage, AttentionStoreObservation, AttentionStoredRun, AttentionStoredSession,
        AttentionTopology,
    },
};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, Weak,
    },
    time::{Duration, Instant},
};
use tokio::{sync::watch, task::JoinHandle};
use uuid::Uuid;

/// Concurrent browser streams. Further streams fall back to polling.
pub(crate) const FLEET_ATTENTION_MAX_STREAMS: usize = 64;
/// In-memory broker/operation sampling; no store work at this cadence.
const LIVE_TICK: Duration = Duration::from_millis(250);
/// Lossy store hints are complemented by a bounded periodic census.
const STORE_RESYNC: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FleetAttentionUnavailable {
    /// More sessions than the shared attention census admits.
    Capacity,
    /// The canonical census could not be read.
    Store,
}

/// Identity-only metadata. No tool arguments, message text or configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FleetAttentionFacts {
    pub project_id: Option<String>,
    pub lineage: Option<AttentionLineage>,
    /// Shared classification: exact pending decisions and per-facet availability.
    pub attention: AttentionSourceSnapshot,
    /// `None` when no owner is cached in this process: activity is unknown.
    pub operation: Option<AttentionOperation>,
    pub last_outcome: Option<AttentionStoredRun>,
    pub inbox_pending: bool,
    pub recovery_pending: bool,
}

#[derive(Debug)]
pub(crate) struct FleetAttentionEntry {
    /// Fleet revision at which these facts last changed.
    pub revision: u64,
    pub facts: FleetAttentionFacts,
}

#[derive(Debug)]
pub(crate) struct FleetAttentionView {
    pub epoch: Uuid,
    pub revision: u64,
    pub entries: BTreeMap<String, Arc<FleetAttentionEntry>>,
    pub unavailable: Option<FleetAttentionUnavailable>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FleetAttentionSubscribeError {
    Busy,
    Unavailable(FleetAttentionUnavailable),
}

struct StoreCensus {
    metadata: Vec<AttentionStoredSession>,
    topology: HashMap<String, AttentionTopology>,
}

#[derive(Default)]
struct StoreCache {
    ticket: u64,
    census: Option<Arc<StoreCensus>>,
}

struct Inner {
    sender: watch::Sender<Arc<FleetAttentionView>>,
    store: Mutex<StoreCache>,
    tickets: AtomicU64,
    // Stream admission and refresher lifetime share this lock.
    refresher: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Clone)]
pub(crate) struct FleetAttentionHub(Arc<Inner>);

impl Default for FleetAttentionHub {
    fn default() -> Self {
        let (sender, _) = watch::channel(Arc::new(FleetAttentionView {
            epoch: Uuid::new_v4(),
            revision: 0,
            entries: BTreeMap::new(),
            unavailable: None,
        }));
        Self(Arc::new(Inner {
            sender,
            store: Mutex::new(StoreCache::default()),
            tickets: AtomicU64::new(0),
            refresher: Mutex::new(None),
        }))
    }
}

pub(crate) struct FleetAttentionStream {
    pub receiver: watch::Receiver<Arc<FleetAttentionView>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl FleetAttentionHub {
    /// Fresh canonical census plus current in-memory owners, then the view.
    pub async fn snapshot(
        &self,
        manager: &SessionManager,
    ) -> Result<Arc<FleetAttentionView>, FleetAttentionUnavailable> {
        let census = self.read_store(manager).await;
        if let Err(reason) = census {
            self.mark_unavailable(reason);
            return Err(reason);
        }
        let live = live(manager).await;
        self.publish(&live);
        let view = Arc::clone(&self.0.sender.borrow());
        match view.unavailable {
            Some(reason) => Err(reason),
            None => Ok(view),
        }
    }

    /// Receiver first, then a fresh snapshot, so no later change is missed.
    pub async fn subscribe(
        &self,
        manager: &SessionManager,
    ) -> Result<FleetAttentionStream, FleetAttentionSubscribeError> {
        let receiver = {
            let mut refresher = lock(&self.0.refresher);
            if self.0.sender.receiver_count() >= FLEET_ATTENTION_MAX_STREAMS {
                return Err(FleetAttentionSubscribeError::Busy);
            }
            let receiver = self.0.sender.subscribe();
            if refresher.as_ref().is_none_or(JoinHandle::is_finished) {
                let hub = self.clone();
                let manager = Arc::downgrade(&manager.inner);
                *refresher = Some(tokio::spawn(run(hub, manager)));
            }
            receiver
        };
        self.snapshot(manager)
            .await
            .map_err(FleetAttentionSubscribeError::Unavailable)?;
        Ok(FleetAttentionStream { receiver })
    }

    #[cfg(test)]
    pub fn stream_count(&self) -> usize {
        self.0.sender.receiver_count()
    }

    #[cfg(test)]
    pub fn refresher_running(&self) -> bool {
        lock(&self.0.refresher)
            .as_ref()
            .is_some_and(|task| !task.is_finished())
    }

    async fn read_store(&self, manager: &SessionManager) -> Result<(), FleetAttentionUnavailable> {
        let ticket = self.0.tickets.fetch_add(1, Ordering::SeqCst) + 1;
        let path = manager.inner.store_path.clone();
        let census = nac_core::store::spawn_blocking_store_caller(move || {
            if !path.exists() {
                return Ok(StoreCensus {
                    metadata: Vec::new(),
                    topology: HashMap::new(),
                });
            }
            let metadata =
                nac_core::store::read_attention_metadata(&path, None).map_err(|error| {
                    if error.to_string().contains("capacity") {
                        FleetAttentionUnavailable::Capacity
                    } else {
                        FleetAttentionUnavailable::Store
                    }
                })?;
            let topology = nac_core::store::read_attention_topology(&path)
                .map_err(|_| FleetAttentionUnavailable::Store)?
                .into_iter()
                .map(|row| (row.session_id.clone(), row))
                .collect();
            Ok(StoreCensus { metadata, topology })
        })
        .await
        .map_err(|_| FleetAttentionUnavailable::Store)??;
        let mut cache = lock(&self.0.store);
        // A slower older census never replaces a newer accepted one.
        if ticket > cache.ticket {
            cache.ticket = ticket;
            cache.census = Some(Arc::new(census));
        }
        Ok(())
    }

    fn mark_unavailable(&self, reason: FleetAttentionUnavailable) {
        self.0.sender.send_if_modified(|current| {
            if current.unavailable == Some(reason) {
                return false;
            }
            *current = Arc::new(FleetAttentionView {
                epoch: current.epoch,
                revision: current.revision + 1,
                entries: current.entries.clone(),
                unavailable: Some(reason),
            });
            true
        });
    }

    /// Merge the latest accepted census with current owners. Unchanged entries
    /// keep their `Arc` and revision; any change advances the fleet revision.
    fn publish(&self, live: &HashMap<String, Option<AttentionServiceSnapshot>>) {
        let Some(census) = lock(&self.0.store).census.clone() else {
            return;
        };
        self.0.sender.send_if_modified(|current| {
            let revision = current.revision + 1;
            let mut changed = current.unavailable.is_some();
            let mut entries = BTreeMap::new();
            for stored in &census.metadata {
                let service = live.get(&stored.id).and_then(Option::as_ref);
                let topology = census.topology.get(&stored.id);
                let facts = FleetAttentionFacts {
                    project_id: topology.and_then(|row| row.project_id.clone()),
                    lineage: topology.and_then(|row| row.lineage.clone()),
                    attention: classify(&stored.id, current.epoch, stored, service, None),
                    operation: service.map(|service| service.operation.clone()),
                    last_outcome: stored.last_outcome.clone(),
                    inbox_pending: stored.inbox_pending,
                    recovery_pending: stored.recovery_pending,
                };
                let entry = match current.entries.get(&stored.id) {
                    Some(previous) if previous.facts == facts => Arc::clone(previous),
                    _ => {
                        changed = true;
                        Arc::new(FleetAttentionEntry { revision, facts })
                    }
                };
                entries.insert(stored.id.clone(), entry);
            }
            changed |= current.entries.keys().any(|id| !entries.contains_key(id));
            if changed {
                *current = Arc::new(FleetAttentionView {
                    epoch: current.epoch,
                    revision,
                    entries,
                    unavailable: None,
                });
            }
            changed
        });
    }

    /// Exit only when no stream remains, under the admission lock.
    fn retire_if_idle(&self) -> bool {
        let mut refresher = lock(&self.0.refresher);
        if self.0.sender.receiver_count() == 0 {
            *refresher = None;
            true
        } else {
            false
        }
    }
}

/// Cached owners only: no attachment, wake or recovery.
async fn live(manager: &SessionManager) -> HashMap<String, Option<AttentionServiceSnapshot>> {
    manager
        .inner
        .active_sessions
        .read()
        .await
        .iter()
        .map(|(id, service)| (id.clone(), service.passive_attention_snapshot()))
        .collect()
}

async fn run(hub: FleetAttentionHub, manager: Weak<SessionManagerInner>) {
    let Some(path) = manager.upgrade().map(|inner| inner.store_path.clone()) else {
        hub.retire_if_idle();
        return;
    };
    let mut hints = AttentionStoreObservation::subscribe(&path);
    let mut last_census = Instant::now();
    let mut operations = None;
    // A run settling records its outcome around the operation change; read
    // the census on that tick and the next one.
    let mut rereads = 0u8;
    loop {
        if hub.retire_if_idle() {
            return;
        }
        let Some(inner) = manager.upgrade() else {
            hub.retire_if_idle();
            return;
        };
        let manager = SessionManager { inner };
        let current = live(&manager).await;
        let current_operations: BTreeMap<_, _> = current
            .iter()
            .map(|(id, snapshot)| (id.clone(), snapshot.as_ref().map(|s| s.operation.clone())))
            .collect();
        if operations.as_ref() != Some(&current_operations) {
            operations = Some(current_operations);
            rereads = 2;
        }
        if rereads > 0 || last_census.elapsed() >= STORE_RESYNC {
            rereads = rereads.saturating_sub(1);
            last_census = Instant::now();
            if let Err(reason) = hub.read_store(&manager).await {
                hub.mark_unavailable(reason);
            }
        }
        hub.publish(&current);
        drop(manager);
        tokio::select! {
            hint = hints.changed() => {
                if hint.is_err() {
                    hints = AttentionStoreObservation::subscribe(&path);
                }
                rereads = rereads.max(1);
            }
            () = tokio::time::sleep(LIVE_TICK) => {}
            () = hub.0.sender.closed() => {}
        }
        while let Ok(Some(_)) = hints.try_changed() {
            rereads = rereads.max(1);
        }
    }
}

/// Upserts and removals between two views for one optional project filter.
pub(crate) struct FleetAttentionDelta {
    pub upserts: Vec<(String, Arc<FleetAttentionEntry>)>,
    pub removed: Vec<String>,
}

pub(crate) fn visible(entry: &FleetAttentionEntry, project: Option<&str>) -> bool {
    project.is_none_or(|project| entry.facts.project_id.as_deref() == Some(project))
}

pub(crate) fn delta(
    previous: &FleetAttentionView,
    next: &FleetAttentionView,
    project: Option<&str>,
) -> FleetAttentionDelta {
    let upserts = next
        .entries
        .iter()
        .filter(|(_, entry)| visible(entry, project))
        .filter(|(id, entry)| {
            previous
                .entries
                .get(*id)
                .is_none_or(|old| !visible(old, project) || old.revision != entry.revision)
        })
        .map(|(id, entry)| (id.clone(), Arc::clone(entry)))
        .collect();
    let removed = previous
        .entries
        .iter()
        .filter(|(_, entry)| visible(entry, project))
        .filter(|(id, _)| {
            next.entries
                .get(*id)
                .is_none_or(|entry| !visible(entry, project))
        })
        .map(|(id, _)| id.clone())
        .collect();
    FleetAttentionDelta { upserts, removed }
}

#[cfg(test)]
#[path = "fleet_attention_tests.rs"]
mod tests;
