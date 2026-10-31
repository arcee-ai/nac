//! Local lifecycle bridge for structured questions. The weak registry finds an
//! existing owner; it never attaches, recovers or starts a second agent loop.
use super::*;
use crate::store::{QuestionAnswer, QuestionAnswerReceipt, QuestionRecord, QuestionRequest};
use std::collections::HashMap;
use std::sync::{LazyLock, Weak};

type OwnerKey = (PathBuf, String);
static OWNERS: LazyLock<StdMutex<HashMap<OwnerKey, Weak<QuestionOwner>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

/// Prepared after native policy and caller binding. Composition may resolve
/// the target owner but cannot turn this into a human answer.
pub struct AuthorizedQuestionInformation {
    target_session_id: String,
    scope: crate::store::QuestionAgentScope,
    answer: QuestionAnswer,
    argument_digest: String,
}
impl AuthorizedQuestionInformation {
    pub fn target_session_id(&self) -> &str {
        &self.target_session_id
    }
}
/// Action-specific owner-resolution port; no model loop or MCP loopback.
pub trait TaskQuestionAnswerPort: Send + Sync {
    fn answer(
        &self,
        request: AuthorizedQuestionInformation,
    ) -> futures_util::future::BoxFuture<'_, Result<QuestionAnswerReceipt>>;
}

/// Private, service-issued authority for one human response. Model inputs
/// cannot manufacture this capability or select its policy action.
pub(crate) struct SubmittedQuestionResponse {
    resource: crate::tools::kernel::PermissionResource,
}
impl SubmittedQuestionResponse {
    pub(crate) fn resource(&self) -> &crate::tools::kernel::PermissionResource {
        &self.resource
    }
}

pub(crate) fn response_resource(
    action: &str,
    session: &str,
    request: &str,
) -> crate::tools::kernel::PermissionResource {
    crate::tools::kernel::PermissionResource::new(
        action,
        format!(
            "session:{}/question:{}",
            crate::tools::url_component(session),
            crate::tools::url_component(request),
        ),
    )
}

pub(super) struct QuestionOwner {
    // Captured before its registration handle is installed on the outer
    // service. This clone has no registration handle, so there is no cycle.
    service: SessionService,
}

pub(super) fn bind(service: &mut SessionService) {
    if service.metadata.behavior != sessions::SessionBehavior::Direct {
        return;
    }
    let Some(session_id) = service.metadata.session_id.clone() else {
        return;
    };
    let owner = Arc::new(QuestionOwner {
        service: service.clone(),
    });
    let mut owners = OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    owners.retain(|_, owner| owner.strong_count() > 0);
    owners.insert(
        (service.metadata.store_path.clone(), session_id),
        Arc::downgrade(&owner),
    );
    service.question_owner = Some(owner);
}

fn owner(path: &Path, session: &str) -> Result<Arc<QuestionOwner>> {
    OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&(path.to_path_buf(), session.to_owned()))
        .and_then(Weak::upgrade)
        .ok_or_else(|| crate::store::QuestionError::Unavailable.into())
}

pub(crate) async fn create_native(
    path: &Path,
    session: &str,
    request: QuestionRequest,
    argument_digest: String,
) -> Result<crate::store::task_questions::QuestionCreationReceipt> {
    let owner = owner(path, session)?;
    owner.service.require_question_session().await?;
    owner.service.coordinate_local(move |service| {
        let active = service.lock_active_operation();
        anyhow::ensure!(matches!(active.as_ref(),Some(ActiveSessionOperation::Run(run)) if !run.finishing && run.snapshot.run_id.as_str()==request.run_id), crate::store::QuestionError::Conflict);
        crate::store::create_task_question_bound(&service.metadata.store_path, &request, service.config_version.unwrap_or(0),&argument_digest).map(|question|question.creation_receipt())
    }).await?
}

pub(crate) async fn answer_native(
    path: &Path,
    session: &str,
    caller: &str,
    explicit_project: Option<String>,
    target_project: Option<String>,
    mut answer: QuestionAnswer,
    port: Option<&Arc<dyn TaskQuestionAnswerPort>>,
) -> Result<QuestionAnswerReceipt> {
    let caller = owner(path, caller)?;
    caller.service.require_question_session().await?;
    let baseline = caller
        .service
        .goal_runtime
        .as_ref()
        .and_then(|runtime| runtime.current_baseline())
        .ok_or(crate::store::QuestionError::Unavailable)?;
    let scope = crate::store::QuestionAgentScope {
        caller_session_id: caller
            .service
            .metadata
            .session_id
            .clone()
            .ok_or(crate::store::QuestionError::Unavailable)?,
        caller_run_id: baseline.run_id,
        caller_config_version: caller.service.config_version.unwrap_or(0),
        explicit_project,
        target_project,
    };
    // Reject human decisions before owner resolution can attach a dormant
    // target. The answer transaction repeats this check under its write lock.
    let read_path = path.to_path_buf();
    let read_session = session.to_owned();
    let request_id = answer.request_id.clone();
    let question = crate::store::spawn_blocking_store_caller(move || {
        crate::store::load_task_question(&read_path, &read_session, &request_id)
    })
    .await??
    .ok_or(crate::store::QuestionError::NotFound)?;
    anyhow::ensure!(
        question.request.responder_class == crate::store::QuestionResponder::Information,
        crate::store::QuestionError::HumanRequired
    );
    anyhow::ensure!(
        question.request.run_id == answer.run_id
            && question.request.generation == answer.generation,
        crate::store::QuestionError::Conflict
    );
    let argument_digest = crate::store::task_questions::canonical_digest(&answer)?;
    caller.service.mask_question_answer(&mut answer).await?;
    let request = AuthorizedQuestionInformation {
        target_session_id: session.to_owned(),
        scope,
        answer,
        argument_digest,
    };
    if let Some(port) = port {
        return port.answer(request).await;
    }
    let target = owner(path, session)?;
    target
        .service
        .answer_authorized_question_information(request)
        .await
}

impl SessionService {
    pub async fn answer_authorized_question_information(
        &self,
        request: AuthorizedQuestionInformation,
    ) -> Result<QuestionAnswerReceipt> {
        anyhow::ensure!(
            self.metadata.session_id.as_deref() == Some(request.target_session_id.as_str()),
            crate::store::QuestionError::Conflict
        );
        self.answer_question_inner(
            request.answer,
            Some(request.scope),
            Some(request.argument_digest),
        )
        .await
    }

    async fn mask_question_answer(&self, answer: &mut QuestionAnswer) -> Result<()> {
        let runtime = self
            .shell_runtime
            .as_ref()
            .ok_or(crate::store::QuestionError::Unavailable)?;
        let environment = runtime.command_environment_snapshot().await?;
        answer.answer = crate::model::redact_credentials(&environment.redact(&answer.answer), &[]);
        Ok(())
    }

    async fn require_question_session(&self) -> Result<()> {
        self.require_direct_primary_behavior_async().await?;
        anyhow::ensure!(
            self.metadata.behavior == sessions::SessionBehavior::Direct
                && self.shell_runtime.as_ref().is_some_and(|runtime| matches!(
                    runtime.backend.as_ref(),
                    crate::sandbox::ExecutionBackend::Local { .. }
                )),
            crate::store::QuestionError::Unavailable
        );
        Ok(())
    }

    /// Authenticated human delivery calls this service operation. No serialized
    /// caller field can select this route from an agent tool.
    pub async fn answer_task_question(
        &self,
        answer: QuestionAnswer,
    ) -> Result<QuestionAnswerReceipt> {
        self.authorize_human_question_response("task_question_answer", &answer.request_id)?;
        self.answer_question_inner(answer, None, None).await
    }

    fn authorize_human_question_response(&self, action: &str, request: &str) -> Result<()> {
        let session = self
            .metadata
            .session_id
            .as_deref()
            .ok_or(crate::store::QuestionError::Unavailable)?;
        let submission = SubmittedQuestionResponse {
            resource: response_resource(action, session, request),
        };
        self.permission_broker
            .as_ref()
            .ok_or(crate::store::QuestionError::Unavailable)?
            .authorize_submitted_question_response(&submission)
    }

    async fn answer_question_inner(
        &self,
        mut answer: QuestionAnswer,
        agent: Option<crate::store::QuestionAgentScope>,
        argument_digest: Option<String>,
    ) -> Result<QuestionAnswerReceipt> {
        self.require_question_session().await?;
        let argument_digest = match argument_digest {
            Some(digest) => digest,
            None => crate::store::task_questions::canonical_digest(&answer)?,
        };
        self.mask_question_answer(&mut answer).await?;
        // An uncertain/dropped caller cannot detach accepted answer admission
        // from its wake. The durable inbox still owns exactly-once delivery.
        let service = self.clone();
        tokio::spawn(async move {
            service
                .answer_question_owned(answer, agent, argument_digest)
                .await
        })
        .await
        .map_err(|error| anyhow::anyhow!("question answer task failed: {error}"))?
    }

    async fn answer_question_owned(
        &self,
        answer: QuestionAnswer,
        agent: Option<crate::store::QuestionAgentScope>,
        argument_digest: String,
    ) -> Result<QuestionAnswerReceipt> {
        let (admission, lease) = self
            .coordinate_local(move |service| -> Result<_> {
                let active = service.lock_active_operation();
                anyhow::ensure!(
                    !service
                        .stopping_admission
                        .load(std::sync::atomic::Ordering::Acquire),
                    crate::store::QuestionError::Unavailable
                );
                let session = service
                    .metadata
                    .session_id
                    .as_deref()
                    .ok_or(crate::store::QuestionError::Unavailable)?;
                let lease = if active.is_none() {
                    Some(
                        sessions::SessionOperationLease::try_acquire(
                            &service.metadata.store_path,
                            session,
                        )
                        .map_err(|_| crate::store::QuestionError::Conflict)?,
                    )
                } else {
                    None
                };
                let admission = crate::store::answer_task_question_bound(
                    &service.metadata.store_path,
                    session,
                    &answer,
                    agent.as_ref(),
                    service.config_version.unwrap_or(0),
                    &argument_digest,
                )?;
                Ok((admission, lease))
            })
            .await??;
        // Replaying an accepted receipt can retry a failed wake. The owning
        // inbox transaction and reserved run identity prevent another delivery.
        if !admission.should_wake {
            return Ok(admission.receipt);
        }
        let wake = match lease {
            Some(lease) => {
                self.start_next_direct_inbox_item_with_lease_async(lease)
                    .await
            }
            None => self.start_next_direct_inbox_item().await,
        };
        if wake.is_err() {
            eprintln!("nac: accepted question answer remains pending after wake failure");
        }
        Ok(admission.receipt)
    }

    pub async fn cancel_task_question(
        &self,
        request_id: String,
        expected_revision: i64,
    ) -> Result<QuestionRecord> {
        self.require_question_session().await?;
        self.authorize_human_question_response("task_question_cancel", &request_id)?;
        self.coordinate_local(move |service| {
            let _active = service.lock_active_operation();
            let session = service
                .metadata
                .session_id
                .as_deref()
                .ok_or(crate::store::QuestionError::Unavailable)?;
            let _lease = if _active.is_none() {
                Some(
                    sessions::SessionOperationLease::try_acquire(
                        &service.metadata.store_path,
                        session,
                    )
                    .map_err(|_| crate::store::QuestionError::Conflict)?,
                )
            } else {
                None
            };
            crate::store::cancel_task_question(
                &service.metadata.store_path,
                session,
                &request_id,
                expected_revision,
            )
        })
        .await?
    }
}

#[cfg(test)]
#[path = "questions_tests.rs"]
mod tests;
