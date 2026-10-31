//! Opt-in native observation lifetime and normalized per-session source owner.
//! The store bus is only a dirty hint; all question state is read canonically.
use super::attention::*;
use crate::SessionManager;
use nac_core::{
    events::*,
    session_service::SessionService,
    store::{
        AttentionStoreObservation, AttentionStoredSession, ATTENTION_METADATA_BYTES,
        ATTENTION_SOURCE_LIMIT,
    },
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex, Weak},
    time::Duration,
};
use tokio::{sync::Notify, task::JoinHandle};
use uuid::Uuid;

mod projection;
use projection::{emit, normalized, publish};

type Result<T> = std::result::Result<T, AttentionSubscribeError>;

#[derive(Default)]
pub(crate) struct AttentionRuntime(Arc<Mutex<RuntimeState>>);
#[derive(Default)]
struct RuntimeState {
    native: Option<(Uuid, String)>,
    seat: Option<Uuid>,
    live: Weak<Live>,
    stopped: bool,
    #[cfg(test)]
    bootstrap_gate: Option<Arc<BootstrapGate>>,
    #[cfg(test)]
    read_gate: Option<Arc<ReadGate>>,
}
#[cfg(test)]
#[derive(Default)]
struct BootstrapGate {
    reached: Notify,
    resume: Notify,
}
#[cfg(test)]
struct ReadGate {
    reached: Notify,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}
struct Permit {
    runtime: Arc<Mutex<RuntimeState>>,
    token: Uuid,
}
impl Drop for Permit {
    fn drop(&mut self) {
        let mut state = self
            .runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.seat == Some(self.token) {
            state.seat = None;
        }
    }
}
struct Binding {
    service: Weak<SessionService>,
    token: Uuid,
    registration: Option<Uuid>,
}
struct Source {
    epoch: Uuid,
    generation: u64,
    stored: Option<AttentionStoredSession>,
    service: Option<AttentionServiceSnapshot>,
    binding: Option<Binding>,
    published: Option<AttentionSourceSnapshot>,
    retired: bool,
}
impl Source {
    fn new() -> Self {
        Self {
            epoch: Uuid::new_v4(),
            generation: 0,
            stored: None,
            service: None,
            binding: None,
            published: None,
            retired: false,
        }
    }
}
struct Projection {
    sources: BTreeMap<String, Source>,
    dirty: BTreeSet<String>,
    generation: u64,
    closed: bool,
}
struct Live {
    hub: AttentionHub,
    state: Mutex<Projection>,
    wake: Notify,
    task: Mutex<Option<JoinHandle<()>>>,
    // The task also holds this permit, until its actual receiver is dropped.
    _permit: Arc<Permit>,
}
struct Sink {
    live: Weak<Live>,
    token: Uuid,
}
impl AttentionServiceObserver for Sink {
    fn service_changed(&self, id: &str, snapshot: AttentionServiceSnapshot) {
        let Some(live) = self.live.upgrade() else {
            return;
        };
        let mut state = live
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.closed {
            return;
        }
        let Some(source) = state.sources.get_mut(id) else {
            return;
        };
        if !source
            .binding
            .as_ref()
            .is_some_and(|binding| binding.token == self.token)
        {
            return;
        }
        if source
            .service
            .as_ref()
            .is_some_and(|old| old.epoch == snapshot.epoch && old.revision >= snapshot.revision)
        {
            return;
        }
        if source.retired {
            return;
        }
        if source
            .service
            .as_ref()
            .is_some_and(|old| old.epoch != snapshot.epoch)
        {
            source.epoch = Uuid::new_v4();
        }
        source.service = Some(snapshot);
        live.dirty(&mut state, id);
    }
}

pub(crate) struct NativeAttentionSubscription {
    subscription: AttentionSubscription,
    _lease: ObservationLease,
}
impl NativeAttentionSubscription {
    /// Borrow the owner as a whole so stream closure capture retains the
    /// lease as well as the receiver, including before its first poll.
    pub fn subscription(&mut self) -> &mut AttentionSubscription {
        &mut self.subscription
    }
}
struct ObservationLease(Arc<Live>);
impl Drop for ObservationLease {
    fn drop(&mut self) {
        self.0.close();
    }
}

impl AttentionRuntime {
    /// Called only after the native launch owner validates its selected store
    /// and the actual loopback listener. Ordinary construction remains inert.
    pub fn configure_native(&self, engine: Uuid, authority: String) {
        let mut state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !state.stopped && state.native.is_none() {
            state.native = Some((engine, authority));
        }
    }
    pub fn authority(&self) -> Option<String> {
        let state = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.stopped {
            None
        } else {
            state
                .native
                .as_ref()
                .map(|(_, authority)| authority.clone())
        }
    }
    pub fn stop(&self) {
        let live = {
            let mut state = self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.stopped = true;
            state.live.upgrade()
        };
        if let Some(live) = live {
            live.close();
        }
    }
    pub fn bind(&self, service: &Arc<SessionService>) {
        let live = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .live
            .upgrade();
        if let Some(live) = live {
            live.bind(service);
        }
    }
    pub fn deleted(&self, id: &str) {
        let live = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .live
            .upgrade();
        if let Some(live) = live {
            let mut state = live
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            live.dirty(&mut state, id);
        }
    }
    pub async fn open(
        &self,
        manager: SessionManager,
        cursor: Option<AttentionBoundary>,
    ) -> Result<NativeAttentionSubscription> {
        let (engine, permit) = {
            let mut state = self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.stopped {
                return Err(AttentionSubscribeError::Unavailable(
                    AttentionUnavailable::Reset,
                ));
            }
            let engine = state.native.as_ref().map(|(engine, _)| *engine).ok_or(
                AttentionSubscribeError::Unavailable(AttentionUnavailable::Initial),
            )?;
            if state.seat.is_some() {
                return Err(AttentionSubscribeError::Busy);
            }
            let token = Uuid::new_v4();
            state.seat = Some(token);
            (
                engine,
                Arc::new(Permit {
                    runtime: Arc::clone(&self.0),
                    token,
                }),
            )
        };
        let live = Arc::new(Live {
            hub: AttentionHub::new(engine, AttentionLimits::default())
                .map_err(AttentionSubscribeError::Unavailable)?,
            state: Mutex::new(Projection {
                sources: BTreeMap::new(),
                dirty: BTreeSet::new(),
                generation: 0,
                closed: false,
            }),
            wake: Notify::new(),
            task: Mutex::new(None),
            _permit: Arc::clone(&permit),
        });
        let lease = ObservationLease(Arc::clone(&live));
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .live = Arc::downgrade(&live);
        // Acquisition precedes every canonical read and cached-owner snapshot.
        let mut observation = AttentionStoreObservation::subscribe(&manager.inner.store_path);
        {
            let cached = manager.inner.active_sessions.read().await;
            if cached.len() > ATTENTION_SOURCE_LIMIT {
                return Err(AttentionSubscribeError::Unavailable(
                    AttentionUnavailable::Capacity,
                ));
            }
            let ordered: BTreeMap<_, _> = cached.iter().collect();
            for service in ordered.values() {
                live.bind(service);
            }
        }
        let bootstrap = async {
            #[cfg(test)]
            {
                let gate = self
                    .0
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .bootstrap_gate
                    .clone();
                if let Some(gate) = gate {
                    gate.reached.notify_one();
                    gate.resume.notified().await;
                }
            }
            for _ in 0..16 {
                let generation = live
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .generation;
                let rows = read(&manager, None, Arc::clone(&live._permit)).await?;
                live.drain(&mut observation)?;
                let mut state = live
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if state.closed {
                    return Err(AttentionSubscribeError::Unavailable(
                        AttentionUnavailable::Reset,
                    ));
                }
                if generation != state.generation {
                    continue;
                }
                for row in rows {
                    let source = live.source(&mut state, &row.id)?;
                    source.stored = Some(row);
                }
                live.check_bytes(&state)?;
                let snapshots = state
                    .sources
                    .iter_mut()
                    .filter_map(|(id, source)| {
                        let snapshot = normalized(id, source)?;
                        source.published = Some(snapshot.clone());
                        Some(snapshot)
                    })
                    .collect();
                let boundary = live.hub.boundary();
                if live.hub.rebaseline(boundary, snapshots) != AttentionApply::Applied {
                    return Err(AttentionSubscribeError::Unavailable(
                        AttentionUnavailable::Capacity,
                    ));
                }
                state.dirty.clear();
                return Ok(());
            }
            Err(AttentionSubscribeError::Unavailable(
                AttentionUnavailable::SourceGap,
            ))
        };
        tokio::time::timeout(Duration::from_secs(10), bootstrap)
            .await
            .map_err(|_| AttentionSubscribeError::Unavailable(AttentionUnavailable::SourceGap))??;
        let subscription = live.hub.subscribe(cursor)?;
        let weak = Arc::downgrade(&live);
        // Drop receiver before the physical permit, including task abortion.
        let task = tokio::spawn(async move {
            let reader = Reader {
                observation,
                _permit: permit,
            };
            run(weak, manager, reader).await;
        });
        *live
            .task
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(task);
        Ok(NativeAttentionSubscription {
            subscription,
            _lease: lease,
        })
    }
}
struct Reader {
    observation: AttentionStoreObservation,
    _permit: Arc<Permit>,
}

async fn read(
    manager: &SessionManager,
    id: Option<&str>,
    permit: Arc<Permit>,
) -> Result<Vec<AttentionStoredSession>> {
    let path = manager.inner.store_path.clone();
    let id = id.map(str::to_owned);
    #[cfg(test)]
    let read_gate = permit
        .runtime
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .read_gate
        .clone();
    manager
        .inner
        ._store_ownership
        .call_legacy(move || {
            // An accepted store caller can outlive cancellation of its waiter.
            // Retain the physical seat until that read actually returns.
            let _permit = permit;
            #[cfg(test)]
            if let Some(gate) = read_gate {
                gate.reached.notify_one();
                let _ = gate
                    .release
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .recv();
            }
            nac_core::store::read_attention_metadata(&path, id.as_deref())
        })
        .await
        .and_then(|result| result)
        .map_err(|_| AttentionSubscribeError::Unavailable(AttentionUnavailable::InvalidMetadata))
}

impl Live {
    fn source<'a>(&self, state: &'a mut Projection, id: &str) -> Result<&'a mut Source> {
        if id.trim().is_empty()
            || id.len() > 512
            || (!state.sources.contains_key(id) && state.sources.len() >= ATTENTION_SOURCE_LIMIT)
        {
            return Err(AttentionSubscribeError::Unavailable(
                AttentionUnavailable::Capacity,
            ));
        }
        Ok(state
            .sources
            .entry(id.to_owned())
            .or_insert_with(Source::new))
    }
    fn dirty(&self, state: &mut Projection, id: &str) {
        let Some(generation) = state.generation.checked_add(1) else {
            self.fail(state);
            return;
        };
        state.generation = generation;
        match self.source(state, id) {
            Ok(source) => source.generation = generation,
            Err(_) => {
                self.fail(state);
                return;
            }
        }
        state.dirty.insert(id.to_owned());
        if self.check_bytes(state).is_err() {
            self.fail(state);
        }
        self.wake.notify_one();
    }
    fn check_bytes(&self, state: &Projection) -> Result<()> {
        let bytes: usize = state
            .sources
            .iter()
            .map(|(id, source)| {
                id.len() * 3
                    + 128
                    + source
                        .stored
                        .as_ref()
                        .map_or(0, AttentionStoredSession::metadata_bytes)
                    + source
                        .published
                        .as_ref()
                        .map_or(0, super::attention::snapshot_bytes)
                    + source.service.as_ref().map_or(0, |snapshot| {
                        let operation = match &snapshot.operation {
                            AttentionOperation::Run(id)
                            | AttentionOperation::Manual(id)
                            | AttentionOperation::Compaction(id) => id.len(),
                            _ => 0,
                        };
                        operation
                            + 64
                            + snapshot.settled.as_ref().map_or(0, |work| {
                                work.run_id.len()
                                    + 32
                                    + work.goal.as_ref().map_or(0, |goal| goal.id.len() + 8)
                            })
                    })
            })
            .sum();
        if bytes > ATTENTION_METADATA_BYTES {
            Err(AttentionSubscribeError::Unavailable(
                AttentionUnavailable::Capacity,
            ))
        } else {
            Ok(())
        }
    }
    fn fail(&self, state: &mut Projection) {
        state.closed = true;
        self.hub.reset();
        self.wake.notify_one();
    }
    fn drain(&self, observation: &mut AttentionStoreObservation) -> Result<()> {
        // The supplier ring is bounded; processing more than one ring without
        // quiescence is explicitly unavailable, never an unbounded bootstrap.
        for _ in 0..256 {
            let Some(id) = observation.try_changed().map_err(|_| {
                AttentionSubscribeError::Unavailable(AttentionUnavailable::SourceGap)
            })?
            else {
                return Ok(());
            };
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            self.dirty(&mut state, &id);
        }
        Err(AttentionSubscribeError::Unavailable(
            AttentionUnavailable::SourceGap,
        ))
    }
    fn bind(self: &Arc<Self>, service: &Arc<SessionService>) {
        let metadata = service.metadata();
        let Some(id) = metadata.session_id.as_deref() else {
            return;
        };
        let token = Uuid::new_v4();
        let previous = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.closed {
                return;
            }
            let source = match self.source(&mut state, id) {
                Ok(source) => source,
                Err(_) => {
                    self.fail(&mut state);
                    return;
                }
            };
            if source
                .binding
                .as_ref()
                .is_some_and(|binding| binding.service.ptr_eq(&Arc::downgrade(service)))
            {
                return;
            }
            source.epoch = Uuid::new_v4();
            source.service = None;
            let previous = source.binding.replace(Binding {
                service: Arc::downgrade(service),
                token,
                registration: None,
            });
            self.dirty(&mut state, id);
            previous
        };
        detach(previous);
        // No application/hub lock while invoking a service (the callback takes it).
        let registration = service.install_attention_observer(Arc::new(Sink {
            live: Arc::downgrade(self),
            token,
        }));
        let accepted = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.closed {
                false
            } else if let Some(binding) = state
                .sources
                .get_mut(id)
                .and_then(|source| source.binding.as_mut())
                .filter(|binding| binding.token == token)
            {
                binding.registration = registration;
                true
            } else {
                false
            }
        };
        if !accepted {
            if let Some(registration) = registration {
                service.remove_attention_observer(registration);
            }
        }
    }
    fn close(&self) {
        let bindings = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.closed = true;
            state
                .sources
                .values_mut()
                .filter_map(|source| source.binding.take())
                .collect::<Vec<_>>()
        };
        self.hub.reset();
        self.wake.notify_one();
        let task = self
            .task
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(task) = task {
            task.abort();
        }
        for binding in bindings {
            detach(Some(binding));
        }
    }
    fn apply(&self, id: &str, generation: u64, rows: Vec<AttentionStoredSession>) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.closed {
            return Err(AttentionSubscribeError::Unavailable(
                AttentionUnavailable::Reset,
            ));
        }
        let Some(source) = state
            .sources
            .get_mut(id)
            .filter(|source| source.generation == generation)
        else {
            return Ok(());
        };
        source.stored = rows.into_iter().next();
        if source.retired && source.stored.is_some() {
            return Err(AttentionSubscribeError::Unavailable(
                AttentionUnavailable::SourceGap,
            ));
        }
        let mut retired_binding = None;
        let next = normalized(id, source);
        if let Some(next) = next {
            publish(&self.hub, source, next)?;
        } else if !source.retired {
            if source.published.is_some() {
                emit(&self.hub, source, AttentionChange::SessionDeleted)?;
            }
            source.retired = true;
            retired_binding = source.binding.take();
        }
        state.dirty.remove(id);
        let result = self.check_bytes(&state);
        drop(state);
        detach(retired_binding);
        result
    }
}
fn detach(binding: Option<Binding>) {
    if let Some(binding) = binding {
        if let (Some(service), Some(registration)) =
            (binding.service.upgrade(), binding.registration)
        {
            service.remove_attention_observer(registration);
        }
    }
}

async fn run(weak: Weak<Live>, manager: SessionManager, mut reader: Reader) {
    loop {
        let Some(live) = weak.upgrade() else {
            return;
        };
        if live.drain(&mut reader.observation).is_err() {
            live.close();
            return;
        }
        let (closed, pending) = {
            let state = live
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            (
                state.closed,
                state.dirty.first().and_then(|id| {
                    state
                        .sources
                        .get(id)
                        .map(|source| (id.clone(), source.generation))
                }),
            )
        };
        if closed {
            live.close();
            return;
        }
        if let Some((id, generation)) = pending {
            let rows = tokio::time::timeout(
                Duration::from_secs(10),
                read(&manager, Some(&id), Arc::clone(&live._permit)),
            )
            .await;
            if live.drain(&mut reader.observation).is_err() {
                live.close();
                return;
            }
            let result = match rows {
                Ok(Ok(rows)) => live.apply(&id, generation, rows),
                _ => Err(AttentionSubscribeError::Unavailable(
                    AttentionUnavailable::SourceGap,
                )),
            };
            if result.is_err() {
                live.close();
                return;
            }
            continue;
        }
        tokio::select! {
            change = reader.observation.changed() => match change {
                Ok(id) => {let mut state=live.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);live.dirty(&mut state,&id);},
                Err(_) => {live.close();return;}
            },
            () = live.wake.notified() => {},
        }
    }
}

#[cfg(test)]
#[path = "attention_runtime_tests.rs"]
mod tests;
