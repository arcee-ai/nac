//! Original publication task custody and readback of that exact task.
//!
//! The only positive input remains Core's private-constructor prepared runtime.
//! A readback is historical data, never Ready, a consumed lease or permission to
//! prepare again. This does not add a durable operation journal or source binding;
//! those require the genuine producer/factory join before a route is installed.
use super::session_creation::SessionCreationApplication;
use anyhow::{anyhow, ensure, Result};
use nac_core::session_service::{
    AdmittedSessionPublication, SessionFrontendSnapshot, SessionPublicationRetirement,
};
use std::{sync::Arc, time::Instant};
use tokio::sync::watch;

/// Only the original task can mutate the retained Core publication. For CREATE
/// the serving custodian owns it before spawn and after every local outcome.
pub(super) enum PublicationTaskInput {
    Prepared(AdmittedSessionPublication),
    RetainedCreate(Arc<super::create_transfer::CreateTransferOwner>),
}

/// Terminal result of the Native publication task only. An error can follow a
/// durable commit and does not prove rollback or settlement of remote effects.
pub(crate) struct PublicationResult {
    result: Result<Option<SessionFrontendSnapshot>, Arc<anyhow::Error>>,
}
impl PublicationResult {
    pub(crate) fn result(&self) -> Result<Option<SessionFrontendSnapshot>> {
        self.result
            .clone()
            .map_err(|error| anyhow::Error::new(SharedPublicationError(error)))
    }
}

#[derive(Debug)]
struct SharedPublicationError(Arc<anyhow::Error>);
impl std::fmt::Display for SharedPublicationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.0)
    }
}
impl std::error::Error for SharedPublicationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.0.as_ref().as_ref())
    }
}

pub(crate) enum PublicationObservation {
    Pending,
    Finished(Arc<PublicationResult>),
    /// The task disappeared without returning a result. Never retry preparation.
    Unknown,
}

/// Cloneable read-only observer of one original allocation. Dropping or timing
/// out an observer does not retire work, release custody or renew its deadline.
#[derive(Clone)]
pub(crate) struct PublicationReadback {
    session_id: Arc<str>,
    receiver: watch::Receiver<Option<Arc<PublicationResult>>>,
}
impl PublicationReadback {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "source-bound readback route is not installed")
    )]
    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }

    pub(crate) fn observe(&self) -> PublicationObservation {
        // Check closure before borrowing the final value: a sender may publish
        // and close between these reads, but that must not hide its result.
        let closed = self.receiver.has_changed().is_err();
        if let Some(result) = self.receiver.borrow().as_ref() {
            return PublicationObservation::Finished(Arc::clone(result));
        }
        if closed {
            PublicationObservation::Unknown
        } else {
            PublicationObservation::Pending
        }
    }

    /// This is the read request's captured cutoff, not a new work deadline.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "source-bound readback route is not installed")
    )]
    pub(crate) async fn wait_until(&self, cutoff: Instant) -> PublicationObservation {
        let mut observer = self.clone();
        loop {
            match observer.observe() {
                PublicationObservation::Pending => {}
                terminal => return terminal,
            }
            tokio::select! {
                biased;
                _ = observer.receiver.changed() => {},
                _ = tokio::time::sleep_until(cutoff.into()) => return observer.observe(),
            }
        }
    }
}

/// Unique caller owner. Caller cancellation denies the original publication;
/// accepted SQL remains owned by the independent task until its actual return.
pub(crate) struct AdmittedPublicationAttempt {
    retirement: SessionPublicationRetirement,
    readback: PublicationReadback,
}
impl Drop for AdmittedPublicationAttempt {
    fn drop(&mut self) {
        self.retirement.retire();
    }
}
impl AdmittedPublicationAttempt {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "source-bound readback route is not installed")
    )]
    pub(crate) fn readback(&self) -> PublicationReadback {
        self.readback.clone()
    }

    pub(crate) async fn wait(self) -> Result<Option<SessionFrontendSnapshot>> {
        let mut observer = self.readback.clone();
        loop {
            match observer.observe() {
                PublicationObservation::Finished(result) => return result.result(),
                PublicationObservation::Unknown => anyhow::bail!("publication outcome unknown"),
                PublicationObservation::Pending => {}
            }
            tokio::select! {
                biased;
                _ = observer.receiver.changed() => {},
                _ = self.retirement.retired() => {
                    // A completed result remains historical even if the one-use
                    // owner retired immediately after publishing it.
                    return match observer.observe() {
                        PublicationObservation::Finished(result) => result.result(),
                        _ => Err(anyhow!("publication retired; reconcile the original attempt")),
                    };
                },
            }
        }
    }
}

impl SessionCreationApplication<'_> {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "actual admitted runtime producer is not installed"
        )
    )]
    pub(crate) fn start_admitted_session_publication(
        &self,
        admitted: AdmittedSessionPublication,
    ) -> Result<AdmittedPublicationAttempt> {
        admitted.check_current()?;
        ensure!(
            admitted.store_path() == self.manager.inner.store_path,
            "admitted runtime belongs to another store"
        );
        Ok(self.spawn_admitted_publication(PublicationTaskInput::Prepared(admitted)))
    }

    pub(super) fn spawn_admitted_publication(
        &self,
        mut input: PublicationTaskInput,
    ) -> AdmittedPublicationAttempt {
        let (session_id, retirement, supervision) = match &input {
            PublicationTaskInput::Prepared(admitted) => (
                Arc::from(admitted.session_id()),
                admitted.retirement(),
                None,
            ),
            PublicationTaskInput::RetainedCreate(owner) => (
                Arc::from(owner.session_id.as_str()),
                owner.retirement.clone(),
                Some(super::create_transfer::CreateTransferTaskGuard::new(
                    Arc::clone(owner),
                )),
            ),
        };
        let task_retirement = retirement.clone();
        let (sender, receiver) = watch::channel(None);
        let manager = self.manager.clone();
        // The original serving registry owns this task through actual return.
        // Readback cancellation never aborts or loses accepted work.
        let _spawned = self.manager.inner.publication_tasks.spawn(async move {
            let result = async {
                match &mut input {
                    PublicationTaskInput::Prepared(admitted) => {
                        manager
                            .session_creation()
                            .publish_admitted_inner(admitted, None)
                            .await
                    }
                    PublicationTaskInput::RetainedCreate(owner) => {
                        let mut admitted = owner.original_publication.lock().await;
                        owner.validate(&manager, &admitted).await?;
                        manager
                            .session_creation()
                            .publish_admitted_inner(&mut admitted, Some(owner))
                            .await
                    }
                }
            }
            .await
            .map_err(Arc::new);
            if result.is_ok() {
                if let Some(supervision) = supervision {
                    supervision.complete();
                }
            } else {
                drop(supervision); // Deny and retain before exposing the error.
            }
            sender.send_replace(Some(Arc::new(PublicationResult { result })));
            // End the one-use scope only after its result is visible. Retained
            // CREATE keeps the SAME Core owner, including denied authority and
            // remaining preparation resources, beyond this task/result. A
            // panic/cancel guard also denies without dropping that allocation.
            task_retirement.retire();
        });
        AdmittedPublicationAttempt {
            retirement,
            readback: PublicationReadback {
                session_id,
                receiver,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn closed_original_task_is_unknown_without_a_result() {
        let (sender, receiver) = watch::channel(None);
        let readback = PublicationReadback {
            session_id: Arc::from("original"),
            receiver,
        };
        drop(sender);
        assert!(matches!(
            readback.wait_until(Instant::now()).await,
            PublicationObservation::Unknown
        ));
    }
}
