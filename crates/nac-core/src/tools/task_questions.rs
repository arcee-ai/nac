//! Exact structured questions use ordinary prepared policy. Neither answer
//! operation can select human intent, approval replies, grants or a backend.
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::task_discovery::{self as read, check_id, invalid};
use super::ToolResult;
use crate::store::{QuestionAnswer, QuestionRequest};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateInput {
    request_id: String,
    text: String,
    choices: Option<Vec<String>>,
    responder_class: crate::store::QuestionResponder,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReadInput {
    session_id: String,
    request_id: String,
    project_id: Option<String>,
    #[serde(skip)]
    authorized_project: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AnswerInput {
    session_id: String,
    project_id: Option<String>,
    request_id: String,
    run_id: String,
    generation: String,
    expected_revision: i64,
    answer: String,
    #[serde(skip)]
    authorized_project: Option<String>,
}

fn outcome(result: anyhow::Result<impl serde::Serialize>) -> ToolResult {
    match result {
        Ok(receipt) => read::result(json!(receipt)),
        Err(error) => {
            use crate::store::QuestionError;
            let status = match error.downcast_ref::<QuestionError>() {
                Some(QuestionError::Invalid) => "invalid_arguments",
                Some(QuestionError::NotFound) => "not_found",
                Some(QuestionError::HumanRequired) => "human_required",
                Some(QuestionError::Denied) => "permission_denied",
                Some(QuestionError::Conflict) => "conflict",
                _ => "unavailable",
            };
            ToolResult::text(
                json!({"status":status,"detail":format!("{error:#}")}).to_string(),
                true,
            )
        }
    }
}

pub(crate) struct CreateQuestionTool;
impl NativeTool for CreateQuestionTool {
    type Input = CreateInput;
    fn definition(&self) -> crate::types::ToolDefinition {
        read::definition("request_question", "Request one blocking information question or human decision for this direct Local run. Use a stable request_id for retries. The harness yields after this tool batch and keeps an active goal gated until an exact answer. information permits only already-settled information within the responding agent's authorization; human_decision requires the person. Never use this channel for permission/approval responses or to grant authority. Do not mark a goal paused, complete or blocked merely because a question is pending.", json!({
            "type":"object","additionalProperties":false,
            "required":["request_id","text","choices","responder_class"],
            "properties":{
                "request_id":{"type":"string","minLength":1,"maxLength":160},
                "text":{"type":"string","minLength":1,"maxLength":4000},
                "choices":{"type":["array","null"],"maxItems":8,"items":{"type":"string","minLength":1,"maxLength":300}},
                "responder_class":{"type":"string","enum":["information","human_decision"]}
            }
        }))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }
    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: CreateInput = serde_json::from_value(input)
            .map_err(|e| invalid(format!("invalid request_question arguments: {e}")))?;
        check_id("request_id", &input.request_id)?;
        Ok(input)
    }
    fn permission_resources(
        &self,
        _: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let (caller, _) = read::caller(services)?;
        Ok(vec![PermissionResource::new(
            "question_create",
            format!("session:{caller}"),
        )])
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(session) = services.runtime.session_id.as_deref() else {
                return invalid("persisted direct Local session required");
            };
            let Some(baseline) = services
                .runtime
                .goal_runtime
                .as_ref()
                .and_then(|runtime| runtime.current_baseline())
            else {
                return invalid("an active direct run is required");
            };
            let mut request = QuestionRequest {
                request_id: input.request_id,
                session_id: session.to_owned(),
                run_id: baseline.run_id.clone(),
                generation: baseline.run_id,
                text: input.text,
                choices: input.choices.unwrap_or_default(),
                responder_class: input.responder_class,
            };
            let argument_digest = match crate::store::task_questions::canonical_digest(&request) {
                Ok(digest) => digest,
                Err(error) => return read::unavailable(error),
            };
            let redactions = match services.runtime.command_environment_snapshot().await {
                Ok(value) => value,
                Err(error) => return read::unavailable(error),
            };
            if redactions.redact(&request.request_id) != request.request_id {
                return invalid("question request_id cannot contain a private credential value");
            }
            request.text = crate::model::redact_credentials(&redactions.redact(&request.text), &[]);
            request.choices = request
                .choices
                .into_iter()
                .map(|choice| crate::model::redact_credentials(&redactions.redact(&choice), &[]))
                .collect();
            outcome(
                crate::session_service::questions::create_native(
                    &services.runtime.store_path,
                    session,
                    request,
                    argument_digest,
                )
                .await,
            )
        })
    }
}

pub(crate) struct ReadQuestionTool;
impl NativeTool for ReadQuestionTool {
    type Input = ReadInput;
    fn definition(&self) -> crate::types::ToolDefinition {
        read::definition("read_question","Read one exact durable task question and its resolution by request_id. Observation cannot answer it or any approval. Use its exact run_id, generation and revision when answering.",json!({
            "type":"object","additionalProperties":false,"required":["session_id","request_id","project_id"],
            "properties":{
                "session_id":{"type":"string","minLength":1,"maxLength":160},
                "request_id":{"type":"string","minLength":1,"maxLength":160},
                "project_id":{"type":["string","null"],"minLength":1,"maxLength":160}
            }
        }))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: ReadInput = serde_json::from_value(input)
            .map_err(|e| invalid(format!("invalid read_question arguments: {e}")))?;
        check_id("session_id", &input.session_id)?;
        check_id("request_id", &input.request_id)?;
        if let Some(id) = &input.project_id {
            check_id("project_id", id)?;
        }
        Ok(input)
    }
    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let (_, broker) = read::caller(services)?;
        Ok(vec![
            read::task_resource(&input.session_id),
            read::project_resource(input.project_id.as_deref().or(broker.caller_project())),
        ])
    }
    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[PermissionResource],
        _: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        input.authorized_project = read::authorized_project(resources);
        Ok(())
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let caller = match read::caller(services) {
                Ok(c) => c,
                Err(e) => return e,
            };
            let scoped = match read::exact_lookup(
                "read_question",
                services,
                context,
                caller,
                input.session_id.clone(),
                (input.project_id, input.authorized_project),
            )
            .await
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            if scoped["status"] != "found" {
                return read::result(scoped);
            }
            let path = services.runtime.store_path.clone();
            match crate::store::spawn_blocking_store_caller(move || {
                crate::store::load_task_question(&path, &input.session_id, &input.request_id)
            })
            .await
            {
                Ok(value) => outcome(value),
                Err(e) => read::unavailable(e),
            }
        })
    }
}

pub(crate) struct AnswerQuestionTool;
impl NativeTool for AnswerQuestionTool {
    type Input = AnswerInput;
    fn definition(&self) -> crate::types::ToolDefinition {
        read::definition("answer_question","Supply already-settled information within your human-authorized scope to one exact information question. Human decisions reject this route. Bind the returned request_id, run_id, generation and expected_revision; retry identical arguments after uncertain delivery. The receipt reserves one continuation of that request and cannot steer a replacement run. This never answers permission requests, grants authority or changes backend.",json!({
            "type":"object","additionalProperties":false,
            "required":["session_id","project_id","request_id","run_id","generation","expected_revision","answer"],
            "properties":{
                "session_id":{"type":"string","minLength":1,"maxLength":160},
                "project_id":{"type":["string","null"],"minLength":1,"maxLength":160},
                "request_id":{"type":"string","minLength":1,"maxLength":160},
                "run_id":{"type":"string","minLength":1,"maxLength":160},
                "generation":{"type":"string","minLength":1,"maxLength":160},
                "expected_revision":{"type":"integer","minimum":1},
                "answer":{"type":"string","minLength":1,"maxLength":4000}
            }
        }))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }
    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: AnswerInput = serde_json::from_value(input)
            .map_err(|e| invalid(format!("invalid answer_question arguments: {e}")))?;
        check_id("session_id", &input.session_id)?;
        check_id("request_id", &input.request_id)?;
        if let Some(id) = &input.project_id {
            check_id("project_id", id)?;
        }
        Ok(input)
    }
    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let (_, broker) = read::caller(services)?;
        Ok(vec![
            crate::session_service::questions::response_resource(
                "task_question_answer",
                &input.session_id,
                &input.request_id,
            ),
            read::task_resource(&input.session_id),
            read::project_resource(input.project_id.as_deref().or(broker.caller_project())),
        ])
    }
    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[PermissionResource],
        _: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        input.authorized_project = read::authorized_project(resources);
        Ok(())
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let caller = match read::caller(services) {
                Ok(c) => c,
                Err(e) => return e,
            };
            let caller_id = caller.0.clone();
            let explicit_project = input.project_id.clone();
            let scoped = match read::exact_lookup(
                "answer_question",
                services,
                context,
                caller,
                input.session_id.clone(),
                (input.project_id, input.authorized_project),
            )
            .await
            {
                Ok(v) => v,
                Err(e) => return e,
            };
            if scoped["status"] != "found" {
                return read::result(scoped);
            }
            let target_project = scoped["task"]["project_id"].as_str().map(str::to_owned);
            let answer = QuestionAnswer {
                request_id: input.request_id,
                run_id: input.run_id,
                generation: input.generation,
                expected_revision: input.expected_revision,
                answer: input.answer,
            };
            outcome(
                crate::session_service::questions::answer_native(
                    &services.runtime.store_path,
                    &input.session_id,
                    &caller_id,
                    explicit_project,
                    target_project,
                    answer,
                    services.runtime.task_question_answers.as_ref(),
                )
                .await,
            )
        })
    }
}
