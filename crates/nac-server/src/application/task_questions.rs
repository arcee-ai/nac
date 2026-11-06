//! Structured question delivery is separate from permission/approval delivery.
use crate::SessionManager;
use anyhow::Result;
use nac_core::store::{self, QuestionAnswer, QuestionAnswerReceipt, QuestionRecord};

pub(crate) struct TaskQuestionApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> TaskQuestionApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn list(&self, session: String) -> Result<Vec<QuestionRecord>> {
        self.manager
            .validate_operation_session(&session, super::persistence::OperationSessionScope::Direct)
            .await?;
        let path = self.manager.inner.store_path.clone();
        store::spawn_blocking_store_caller(move || store::list_task_questions(&path, &session))
            .await?
    }

    pub(crate) async fn read(
        &self,
        session: String,
        request: String,
    ) -> Result<Option<QuestionRecord>> {
        self.manager
            .validate_operation_session(&session, super::persistence::OperationSessionScope::Direct)
            .await?;
        let path = self.manager.inner.store_path.clone();
        store::spawn_blocking_store_caller(move || {
            store::load_task_question(&path, &session, &request)
        })
        .await?
    }

    pub(crate) async fn answer(
        &self,
        session: String,
        answer: QuestionAnswer,
    ) -> Result<QuestionAnswerReceipt> {
        self.manager
            .validate_operation_session(&session, super::persistence::OperationSessionScope::Direct)
            .await?;
        super::session_attachment::SessionAttachmentApplication::new(self.manager)
            .attach_question_target(&session)
            .await?
            .answer_task_question(answer)
            .await
    }

    pub(crate) async fn cancel(
        &self,
        session: String,
        request: String,
        revision: i64,
    ) -> Result<QuestionRecord> {
        self.manager
            .validate_operation_session(&session, super::persistence::OperationSessionScope::Direct)
            .await?;
        super::session_attachment::SessionAttachmentApplication::new(self.manager)
            .attach_question_target(&session)
            .await?
            .cancel_task_question(request, revision)
            .await
    }
}

struct NativeQuestionAnswers {
    manager: std::sync::Weak<crate::SessionManagerInner>,
}
impl nac_core::session_service::TaskQuestionAnswerPort for NativeQuestionAnswers {
    fn answer(
        &self,
        request: nac_core::session_service::AuthorizedQuestionInformation,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<QuestionAnswerReceipt>> + Send + '_>,
    > {
        Box::pin(async move {
            let manager = SessionManager {
                inner: self
                    .manager
                    .upgrade()
                    .ok_or(store::QuestionError::Unavailable)?,
            };
            let target = request.target_session_id().to_owned();
            manager
                .validate_operation_session(
                    &target,
                    super::persistence::OperationSessionScope::Direct,
                )
                .await?;
            super::session_attachment::SessionAttachmentApplication::new(&manager)
                .attach_question_target(&target)
                .await?
                .answer_authorized_question_information(request)
                .await
        })
    }
}
pub(crate) fn bind_native(
    manager: &SessionManager,
    config: &mut nac_core::runtime::OrchestratorRunConfig,
) {
    config.set_task_question_answer_port(std::sync::Arc::new(NativeQuestionAnswers {
        manager: std::sync::Arc::downgrade(&manager.inner),
    }));
}
