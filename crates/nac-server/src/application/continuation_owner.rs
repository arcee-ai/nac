//! Serving-lifetime ownership of coalesced durable inbox continuations.
//!
//! A wake is only a hint to reread the inbox. The session operation lease and
//! durable row remain the admission authority across peer exit and retries.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Result;
use nac_core::sessions;
use tokio::sync::{watch, OwnedRwLockReadGuard};

use crate::SessionManager;

struct ContinuationState {
    epoch: u64,
    recover: bool,
    waiters: Vec<(u64, nac_core::sessions::WeakChildInputWaitCancellation)>,
}

pub(crate) struct ContinuationOwners {
    entries: Mutex<HashMap<String, ContinuationState>>,
    reservations: Mutex<HashMap<String, usize>>,
    stop: watch::Sender<bool>,
    #[cfg(test)]
    gate_waiting: tokio::sync::Notify,
}

impl Default for ContinuationOwners {
    fn default() -> Self {
        let (stop, _) = watch::channel(false);
        Self {
            entries: Mutex::new(HashMap::new()),
            reservations: Mutex::new(HashMap::new()),
            stop,
            #[cfg(test)]
            gate_waiting: tokio::sync::Notify::new(),
        }
    }
}

pub(crate) struct ContinuationReservation {
    owner: Arc<ContinuationOwners>,
    session: String,
    _guard: OwnedRwLockReadGuard<()>,
}

impl Drop for ContinuationReservation {
    fn drop(&mut self) {
        let mut reservations = self
            .owner
            .reservations
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(count) = reservations.get_mut(&self.session) else {
            eprintln!(
                "nac: continuation reservation disappeared for {}",
                self.session
            );
            return;
        };
        *count -= 1;
        if *count == 0 {
            reservations.remove(&self.session);
        }
    }
}

impl ContinuationOwners {
    fn reserve(
        self: &Arc<Self>,
        session: &str,
        guard: OwnedRwLockReadGuard<()>,
    ) -> Arc<ContinuationReservation> {
        *self
            .reservations
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .entry(session.to_owned())
            .or_default() += 1;
        Arc::new(ContinuationReservation {
            owner: Arc::clone(self),
            session: session.to_owned(),
            _guard: guard,
        })
    }

    pub(crate) fn reservations(&self) -> std::sync::MutexGuard<'_, HashMap<String, usize>> {
        self.reservations
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[cfg(test)]
    pub(crate) async fn wait_for_gate_attempt(&self) {
        self.gate_waiting.notified().await;
    }

    #[cfg(test)]
    pub(crate) fn contains(&self, session: &str) -> bool {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains_key(session)
    }

    pub(crate) fn stop(&self) {
        self.stop.send_replace(true);
    }

    /// Transfer an existing shutdown reservation into one coalesced owner.
    /// A caller that committed before stop may transfer after the stop fence;
    /// the owner then retires promptly, retaining the durable inbox for attach.
    pub(crate) fn schedule(
        &self,
        manager: SessionManager,
        session: String,
        guard: Arc<ContinuationReservation>,
        recover: bool,
        waiter: Option<nac_core::sessions::WeakChildInputWaitCancellation>,
    ) {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(state) = entries.get_mut(&session) {
            state.epoch = state.epoch.saturating_add(1);
            state.recover |= recover;
            state
                .waiters
                .retain(|(_, waiter)| waiter.upgrade().is_some());
            if let Some(waiter) = waiter {
                state.waiters.push((state.epoch, waiter));
            }
            return;
        }
        entries.insert(
            session.clone(),
            ContinuationState {
                epoch: 1,
                recover,
                waiters: waiter.into_iter().map(|waiter| (1, waiter)).collect(),
            },
        );
        let stop = self.stop.subscribe();
        tokio::spawn(async move {
            let _guard = guard;
            manager.run_continuation_owner(session, stop).await;
        });
    }
}

impl SessionManager {
    pub(crate) async fn reserve_continuation(
        &self,
        session: &str,
    ) -> Result<Arc<ContinuationReservation>> {
        let guard = self.inner.task_preparations.admit().await?;
        // Serialize pre-dispatch reservation with idle eviction and config
        // replacement before the request can transfer work to a task.
        let _active = self.inner.active_sessions.write().await;
        Ok(self.inner.continuation_owners.reserve(session, guard))
    }

    pub(crate) fn schedule_continuation(&self, session: &str) -> Result<()> {
        let guard = self
            .inner
            .continuation_owners
            .reserve(session, self.inner.task_preparations.try_admit()?);
        self.inner.continuation_owners.schedule(
            self.clone(),
            session.to_owned(),
            guard,
            false,
            None,
        );
        Ok(())
    }

    pub(crate) fn schedule_recovery(&self, session: &str) -> Result<()> {
        let guard = self
            .inner
            .continuation_owners
            .reserve(session, self.inner.task_preparations.try_admit()?);
        self.inner.continuation_owners.schedule(
            self.clone(),
            session.to_owned(),
            guard,
            true,
            None,
        );
        Ok(())
    }

    async fn run_continuation_owner(&self, session: String, mut stop: watch::Receiver<bool>) {
        let mut delay = Duration::from_millis(25);
        loop {
            if *stop.borrow() {
                break;
            }
            let state = {
                let mut entries = self
                    .inner
                    .continuation_owners
                    .entries
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                match entries.get_mut(&session) {
                    Some(state) => {
                        state
                            .waiters
                            .retain(|(_, waiter)| waiter.upgrade().is_some());
                        (state.epoch, state.recover)
                    }
                    None => return,
                }
            };
            let pending = match self
                .continue_owned_inbox(&session, state.1, &mut stop)
                .await
            {
                Ok(pending) => pending,
                Err(error) => {
                    eprintln!("nac: continuation for {session} remains pending: {error:#}");
                    let overload = matches!(
                        error.downcast_ref::<nac_core::store::PersistenceAdmissionError>(),
                        Some(
                            nac_core::store::PersistenceAdmissionError::Overloaded
                                | nac_core::store::PersistenceAdmissionError::CallerOverloaded
                        )
                    );
                    if !overload {
                        let waiters = self
                            .inner
                            .continuation_owners
                            .entries
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner)
                            .get(&session)
                            .map(|entry| {
                                entry
                                    .waiters
                                    .iter()
                                    .filter(|(epoch, _)| *epoch <= state.0)
                                    .filter_map(|(_, waiter)| waiter.upgrade())
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        for waiter in waiters {
                            waiter.fail(format!("child input wake failed: {error}"));
                        }
                    }
                    true
                }
            };
            if !pending {
                let mut entries = self
                    .inner
                    .continuation_owners
                    .entries
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if entries
                    .get(&session)
                    .is_some_and(|current| current.epoch == state.0)
                {
                    entries.remove(&session);
                    return;
                }
                delay = Duration::from_millis(25);
                continue;
            }
            tokio::select! {
                _ = stop.changed() => {},
                _ = tokio::time::sleep(delay) => {},
            }
            delay = (delay * 2).min(Duration::from_secs(1));
        }
        self.inner
            .continuation_owners
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&session);
    }

    async fn continue_owned_inbox(
        &self,
        session: &str,
        recover: bool,
        stop: &mut watch::Receiver<bool>,
    ) -> Result<bool> {
        let path = self.inner.store_path.clone();
        let id = session.to_owned();
        let pending = self
            .inner
            ._store_ownership
            .call_legacy(move || {
                let pending =
                    nac_core::store::next_pending_session_inbox_item(&path, &id)?.is_some();
                // A lost admission response can leave a bound generation
                // before its prompt exists. Recovery still owns that obligation
                // even when there is no inbox row to wake.
                let running_child = recover
                    && nac_core::store::load_traditional_child(&path, &id)?.is_some_and(|child| {
                        child.status == nac_core::store::TraditionalChildStatus::Running
                    });
                // Interrupted and failed recovery records can be retained
                // for history after their relationship is settled. Only a
                // retained canonical terminal still needs settlement cleanup.
                let terminal_obligation = recover
                    && nac_core::store::load_run_recovery(&path, &id)?
                        .is_some_and(|record| record.terminal_disposition.is_some());
                Ok::<_, anyhow::Error>(pending || running_child || terminal_obligation)
            })
            .await??;
        if !pending {
            return Ok(false);
        }
        // Gate before nonblocking lease acquisition, matching all other session
        // lifecycle operations. Never wait on the gate while holding the lease.
        let gate = self.lifecycle_gate(session);
        #[cfg(test)]
        self.inner.continuation_owners.gate_waiting.notify_one();
        let _gate = tokio::select! {
            _ = stop.changed() => return Ok(false),
            guard = gate.lock() => guard,
        };
        let lease =
            match sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session) {
                Ok(lease) => lease,
                Err(sessions::SessionOperationLeaseError::Busy(_)) => return Ok(true),
                Err(error) => return Err(error.into()),
            };
        let service = self
            .session_attachment()
            .attach_current_operation_service_locked(session, &lease)
            .await?;
        if service.metadata().behavior == sessions::SessionBehavior::Orchestrator {
            return Ok(false);
        }
        service.continue_owned_inbox_with_lease(lease).await?;
        // Admission or an active run is not evidence of consumption. Recheck
        // the durable row on the next iteration, including after settlement.
        Ok(true)
    }
}

struct CancelChildWait {
    wait: nac_core::sessions::ChildInputWaitCancellation,
    armed: bool,
}
impl Drop for CancelChildWait {
    fn drop(&mut self) {
        if self.armed {
            self.wait.cancel();
        }
    }
}

impl SessionManager {
    /// The actor joins accepted blocking calls even if its requester vanishes;
    /// cancellation releases the exact foreground wait lease independently.
    #[expect(
        clippy::too_many_arguments,
        reason = "the owned actor carries the exact request and its lifecycle reservations"
    )]
    pub(crate) async fn submit_owned_child_input(
        &self,
        service: Option<Arc<nac_core::session_service::SessionService>>,
        host_admission: Option<nac_core::store::ManagedWorkAdmission>,
        parent: String,
        child: String,
        prompt: String,
        mode: nac_core::store::TraditionalChildExecutionMode,
        origin: nac_core::store::InputOrigin,
        reservation: Arc<ContinuationReservation>,
    ) -> Result<nac_core::store::TraditionalChildRecord> {
        let wait = nac_core::sessions::ChildInputWaitCancellation::default();
        let mut caller = CancelChildWait {
            wait: wait.clone(),
            armed: true,
        };
        let handoff = Arc::new(Mutex::new(Some(Arc::clone(&reservation))));
        let owner = self.clone();
        let notify_child = child.clone();
        let waiter = (mode == nac_core::store::TraditionalChildExecutionMode::Foreground)
            .then(|| wait.downgrade());
        let notify: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            let reservation = handoff
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take();
            if let Some(guard) = reservation {
                owner.inner.continuation_owners.schedule(
                    owner.clone(),
                    notify_child.clone(),
                    guard,
                    false,
                    waiter.clone(),
                );
            }
        });
        let owner = self.clone();
        let mut stop = self.inner.continuation_owners.stop.subscribe();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let _reservation = reservation;
            // Attachment can start blocking recovery. Keep it in the owned
            // task so requester cancellation cannot release its lease early.
            let mut service = match service {
                Some(service) => service,
                None => match owner.attach_session(&child).await {
                    Ok(service) => service,
                    Err(error) => {
                        drop(host_admission);
                        owner.inner.continuation_owners.schedule(
                            owner.clone(),
                            child.clone(),
                            Arc::clone(&_reservation),
                            true,
                            None,
                        );
                        let _ = sender.send(Err(error));
                        return;
                    }
                },
            };
            drop(host_admission);
            let result = loop {
                if *stop.borrow() {
                    wait.cancel();
                    break Err(anyhow::anyhow!("child admission is stopping"));
                }
                let gate = owner.lifecycle_gate(&child);
                let gate_guard = tokio::select! {
                    _ = stop.changed() => { wait.cancel(); break Err(anyhow::anyhow!("child admission is stopping")); }
                    guard = gate.lock_owned() => guard,
                };
                let admission_gate = Arc::new(Mutex::new(Some(gate_guard)));
                let release = Arc::clone(&admission_gate);
                let release_gate: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
                    release
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .take();
                });
                let canonical = owner
                    .inner
                    .active_sessions
                    .read()
                    .await
                    .get(&child)
                    .is_some_and(|cached| Arc::ptr_eq(cached, &service));
                let outcome = {
                    let operation = service.submit_child_input_with_cancellation(
                        &parent,
                        prompt.clone(),
                        mode,
                        origin,
                        wait.clone(),
                        Arc::clone(&notify),
                        canonical,
                        release_gate,
                    );
                    tokio::pin!(operation);
                    if *stop.borrow() {
                        wait.cancel();
                        operation.await
                    } else {
                        tokio::select! {
                            result = &mut operation => result,
                            _ = stop.changed() => { wait.cancel(); operation.await }
                        }
                    }
                };
                admission_gate
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .take();
                match outcome {
                    Ok(nac_core::session_service::OwnedChildInputResult::Completed(record)) => {
                        break Ok(*record)
                    }
                    Ok(nac_core::session_service::OwnedChildInputResult::NeedsCanonical) => {
                        if *stop.borrow() {
                            break Err(anyhow::anyhow!("child admission is stopping"));
                        }
                        match owner.attach_session(&child).await {
                            Ok(current) => service = current,
                            Err(error) => break Err(error),
                        }
                        let cached = owner
                            .inner
                            .active_sessions
                            .read()
                            .await
                            .get(&child)
                            .is_some_and(|current| Arc::ptr_eq(current, &service));
                        if !cached {
                            // A peer can retain its lease after the relationship
                            // appears terminal. Do not spin on an uncached observer.
                            tokio::select! {
                                _ = stop.changed() => {},
                                _ = tokio::time::sleep(Duration::from_millis(25)) => {},
                            }
                        }
                    }
                    Err(error) => break Err(error),
                }
            };
            // An unsuccessful acknowledgement may follow a committed insert.
            // Reread the inbox without replaying or claiming that exact request.
            if result.is_err() {
                owner.inner.continuation_owners.schedule(
                    owner.clone(),
                    child.clone(),
                    Arc::clone(&_reservation),
                    true,
                    None,
                );
            }
            let _ = sender.send(result);
        });
        let result = receiver
            .await
            .map_err(|error| anyhow::anyhow!("owned child admission ended: {error}"))?;
        caller.armed = false;
        result
    }
}
