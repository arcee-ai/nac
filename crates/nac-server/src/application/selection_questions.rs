//! Ask a tool-free question about selected assistant text while the main chat
//! keeps working (ALL-559).
//!
//! This use case never takes the session's lifecycle gate or operation lease,
//! never attaches or wakes the session, and never writes its transcript,
//! inbox, goals or run state. It holds only a per-session question lease
//! (one in-flight question per chat) and, on a managed host, ordinary work
//! admission for the duration of its single provider request.
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use nac_core::selection_question::{
    self, PinnedQuestionModel, SelectionQuestionError, SelectionQuestionRequest,
};
use nac_core::sessions::{
    self, SessionBehavior, SessionOperationLease, SessionOperationLeaseError,
};
use nac_core::store::{
    self, SelectionQuestionAdmission, SelectionQuestionAdmitted, SelectionQuestionRecord,
    SelectionQuestionStoreError,
};
use tokio::sync::Semaphore;

use super::persistence::OperationSessionScope;
use super::session_attachment::SessionAttachmentApplication;
use crate::SessionManager;

/// Process-wide bound on concurrently answered questions (one per chat is
/// enforced durably; this bounds the number of chats).
pub(crate) const MAX_CONCURRENT_QUESTIONS: usize = 8;
static QUESTION_SLOTS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(MAX_CONCURRENT_QUESTIONS)));

/// Abort handles of this process's in-flight provider requests. Cancellation
/// is durable first; aborting only stops a request whose result is now moot.
static IN_FLIGHT: LazyLock<Mutex<HashMap<String, tokio::task::AbortHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn in_flight() -> std::sync::MutexGuard<'static, HashMap<String, tokio::task::AbortHandle>> {
    IN_FLIGHT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[derive(Debug)]
pub(crate) enum SelectionQuestionApplicationError {
    NotFound,
    Unsupported,
    Invalid(String),
    Conflict(String),
    InFlight,
    Busy,
    Maintenance,
    Configuration(String),
    Internal(anyhow::Error),
}

impl std::fmt::Display for SelectionQuestionApplicationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => f.write_str("not found"),
            Self::Unsupported => f.write_str(
                "asking about a selection is available only in primary Local direct chats",
            ),
            Self::Invalid(message) | Self::Conflict(message) | Self::Configuration(message) => {
                f.write_str(message)
            }
            Self::InFlight => f.write_str(
                "a question about this chat is still being answered; cancel it or wait for it",
            ),
            Self::Busy => f.write_str("too many questions are being answered; try again shortly"),
            Self::Maintenance => f.write_str("the host is in maintenance; try again later"),
            Self::Internal(_) => f.write_str("the question could not be recorded"),
        }
    }
}

type Error = SelectionQuestionApplicationError;

fn internal(error: anyhow::Error) -> Error {
    if error
        .downcast_ref::<store::ManagedWorkAdmissionError>()
        .is_some_and(|error| matches!(error, store::ManagedWorkAdmissionError::Maintenance))
    {
        return Error::Maintenance;
    }
    if let Some(SelectionQuestionStoreError::IdentityConflict) = error.downcast_ref() {
        return Error::Conflict(SelectionQuestionStoreError::IdentityConflict.to_string());
    }
    Error::Internal(error)
}

fn binding(error: SelectionQuestionError) -> Error {
    match error {
        SelectionQuestionError::Invalid(message) => Error::Invalid(message),
        SelectionQuestionError::SelectionUnmappable => Error::Invalid(error.to_string()),
        SelectionQuestionError::SourceMissing | SelectionQuestionError::SourceChanged => {
            Error::Conflict(error.to_string())
        }
    }
}

/// Startup reconciliation: questions whose owner disappeared with the previous
/// process become `interrupted`. No provider request is replayed. This is
/// best effort: an unreadable or not-yet-migrated store is reported by
/// readiness, and any orphan left pending is settled by the chat's next
/// admission instead.
pub(crate) fn reconcile_startup(path: &std::path::Path) {
    if !path.exists() {
        return;
    }
    let outcome = std::thread::scope(|scope| {
        scope
            .spawn(|| store::interrupt_orphaned_selection_questions(path))
            .join()
    });
    match outcome {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => {
            eprintln!("nac: selection question startup reconciliation skipped: {error:#}");
        }
        Err(_) => eprintln!("nac: selection question startup reconciliation panicked"),
    }
}

pub(crate) struct SelectionQuestionApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SelectionQuestionApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    async fn store<F, R>(&self, operation: F) -> Result<R, Error>
    where
        F: FnOnce(&std::path::Path) -> anyhow::Result<R> + Send + 'static,
        R: Send + 'static,
    {
        let path = self.manager.inner.store_path.clone();
        self.manager
            .inner
            ._store_ownership
            .call_legacy(move || operation(&path))
            .await
            .map_err(internal)?
            .map_err(internal)
    }

    /// Persisted primary session; delegated sessions stay indistinguishable
    /// from unknown ids, as at every other generic-work boundary.
    async fn require_primary(&self, session_id: &str) -> Result<(), Error> {
        self.manager
            .validate_operation_session(session_id, OperationSessionScope::Direct)
            .await
            .map_err(|_| Error::NotFound)
    }

    async fn eligible_snapshot(
        &self,
        session_id: &str,
    ) -> Result<sessions::SessionSnapshot, Error> {
        self.require_primary(session_id).await?;
        let id = session_id.to_owned();
        let snapshot = self
            .store(move |path| sessions::load_session(path, &id))
            .await?;
        if snapshot.behavior != SessionBehavior::Direct
            || snapshot.ssh.is_some()
            || snapshot.sandbox_spec.is_some()
        {
            return Err(Error::Unsupported);
        }
        Ok(snapshot)
    }

    pub(crate) async fn list(
        &self,
        session_id: &str,
    ) -> Result<Vec<SelectionQuestionRecord>, Error> {
        self.require_primary(session_id).await?;
        let id = session_id.to_owned();
        self.store(move |path| store::list_selection_questions(path, &id))
            .await
    }

    pub(crate) async fn get(
        &self,
        session_id: &str,
        question_id: &str,
    ) -> Result<SelectionQuestionRecord, Error> {
        self.require_primary(session_id).await?;
        let (id, question) = (session_id.to_owned(), question_id.to_owned());
        self.store(move |path| store::load_selection_question(path, &id, &question))
            .await?
            .ok_or(Error::NotFound)
    }

    /// Durably cancel one pending question, then stop its provider request.
    /// Only the question changes; the chat and its run are untouched.
    pub(crate) async fn cancel(
        &self,
        session_id: &str,
        question_id: &str,
    ) -> Result<SelectionQuestionRecord, Error> {
        self.require_primary(session_id).await?;
        let (id, question) = (session_id.to_owned(), question_id.to_owned());
        let record = self
            .store(move |path| store::cancel_selection_question(path, &id, &question))
            .await?
            .ok_or(Error::NotFound)?;
        let handle = in_flight().remove(question_id);
        if let Some(handle) = handle {
            handle.abort();
        }
        Ok(record)
    }

    async fn receipt(
        &self,
        session_id: &str,
        request: &SelectionQuestionRequest,
    ) -> Result<Option<SelectionQuestionRecord>, Error> {
        let (id, key, digest) = (
            session_id.to_owned(),
            request.request_key.clone(),
            request.digest(session_id),
        );
        self.store(move |path| store::find_selection_question_receipt(path, &id, &key, &digest))
            .await
    }

    pub(crate) async fn ask(
        &self,
        session_id: &str,
        request: SelectionQuestionRequest,
    ) -> Result<SelectionQuestionAdmitted, Error> {
        request.validate().map_err(binding)?;
        let snapshot = self.eligible_snapshot(session_id).await?;
        // Receipt first: an identical retry returns the original record even
        // if the source, model settings or concurrency changed since.
        if let Some(record) = self.receipt(session_id, &request).await? {
            return Ok(SelectionQuestionAdmitted {
                record,
                replayed: true,
            });
        }
        let slot = QUESTION_SLOTS
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Busy)?;
        let store_path = self.manager.inner.store_path.clone();
        let lease = match SessionOperationLease::try_acquire(
            &store_path,
            &store::selection_question_lease_name(session_id),
        ) {
            Ok(lease) => lease,
            Err(SessionOperationLeaseError::Busy(_)) => {
                // A concurrent identical request may have just been admitted.
                return match self.receipt(session_id, &request).await? {
                    Some(record) => Ok(SelectionQuestionAdmitted {
                        record,
                        replayed: true,
                    }),
                    None => Err(Error::InFlight),
                };
            }
            Err(error) => return Err(Error::Internal(error.into())),
        };
        let host_admission = self
            .manager
            .managed_work_admission_async()
            .await
            .map_err(internal)?;

        // Pin model, configuration and credential now; later settings
        // changes cannot retarget an admitted question.
        let attachment_manager = self.manager.clone();
        let options_id = session_id.to_owned();
        let options = self
            .manager
            .inner
            ._store_ownership
            .call_legacy(move || {
                SessionAttachmentApplication::new(&attachment_manager)
                    .resume_model_options(&options_id)
            })
            .await
            .map_err(internal)?
            .map_err(|error| Error::Configuration(format!("{error:#}")))?;
        let pinned = PinnedQuestionModel::for_session(&snapshot, &options)
            .map_err(|error| Error::Configuration(format!("{error:#}")))?;

        let (id, index) = (session_id.to_owned(), request.source_message_index);
        let source = self
            .store(move |path| store::read_selection_source(path, &id, index))
            .await?;
        let context = selection_question::freeze_context(&request, source).map_err(binding)?;
        let admission = SelectionQuestionAdmission {
            question_id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_owned(),
            request_key: request.request_key.clone(),
            request_digest: request.digest(session_id),
            context,
            model: pinned.identity().clone(),
        };
        let admitted = self
            .store(move |path| store::admit_selection_question(path, &admission))
            .await?;
        if admitted.replayed {
            return Ok(admitted);
        }

        let question_id = admitted.record.question_id.clone();
        let context = admitted.record.context.clone();
        // Registered under the same guard the supervisor's removal takes, so
        // a fast settlement cannot leave a stale handle behind.
        let mut registry = in_flight();
        let worker = tokio::spawn(async move {
            pinned
                .ask(&context, selection_question::PROVIDER_TIMEOUT)
                .await
        });
        registry.insert(question_id.clone(), worker.abort_handle());
        drop(registry);
        // The supervisor owns the lease, host admission and slot until the
        // single request settles, is canceled, or panics.
        let manager = self.manager.clone();
        let session = session_id.to_owned();
        tokio::spawn(async move {
            let _slot = slot;
            let _lease = lease;
            let _host_admission = host_admission;
            let settlement = match worker.await {
                Ok(settlement) => Some(settlement),
                // Canceled: the durable cancellation already settled it.
                Err(error) if error.is_cancelled() => None,
                Err(_) => Some(selection_question::failure(
                    "The question failed unexpectedly before the model answered.",
                )),
            };
            if let Some(settlement) = settlement {
                let id = question_id.clone();
                let result = SelectionQuestionApplication::new(&manager)
                    .store(move |path| {
                        store::settle_selection_question(path, &session, &id, &settlement)
                    })
                    .await;
                if let Err(error) = result {
                    // Left pending: the next admission or restart interrupts it.
                    eprintln!("nac: failed to record selection question {question_id}: {error}");
                }
            }
            in_flight().remove(&question_id);
        });
        Ok(admitted)
    }
}
