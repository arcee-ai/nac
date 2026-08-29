//! Clone a conversation prefix into a new, independent session.
//!
//! The fork copies the transcript through the named assistant turn (and any
//! trailing tool results) and keeps the same workspace, model, and project.
//! Inherited messages after the system head go into the transcript log
//! (never-fold), so revert and resend work on the copied conversation. It
//! does not clone a sandbox worktree — that is a git checkout, not a chat.
//! Billed usage stays with the source: copying it would double-count the same
//! spend in the project rollup. The fork starts at zero cost and keeps only
//! the last context-window gauge so the inherited transcript still reads as
//! full.

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use nac_core::{sessions, store, types::Message};
use serde::{Deserialize, Serialize};

use crate::{ApiErrorBody, SessionManager};

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ForkSessionRequest {
    /// Transcript index of the assistant message to fork from. Trailing tool
    /// results that belong to that turn are copied with it.
    pub message_idx: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct ForkSessionResponse {
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForkSessionError {
    NotFound,
    Busy,
    Rejected(String),
    Failed,
}

impl std::fmt::Display for ForkSessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("session not found"),
            Self::Busy => formatter.write_str("session is busy"),
            Self::Rejected(message) => formatter.write_str(message),
            Self::Failed => formatter.write_str("fork failed"),
        }
    }
}

impl std::error::Error for ForkSessionError {}

impl IntoResponse for ForkSessionError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::NotFound => axum::http::StatusCode::NOT_FOUND,
            Self::Busy => axum::http::StatusCode::CONFLICT,
            Self::Rejected(_) => axum::http::StatusCode::BAD_REQUEST,
            Self::Failed => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ApiErrorBody {
                error: self.to_string(),
            }),
        )
            .into_response()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DismissForkError {
    NotFound,
    Failed,
}

impl std::fmt::Display for DismissForkError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("fork marker not found"),
            Self::Failed => formatter.write_str("dismiss fork failed"),
        }
    }
}

impl std::error::Error for DismissForkError {}

impl IntoResponse for DismissForkError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::NotFound => axum::http::StatusCode::NOT_FOUND,
            Self::Failed => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ApiErrorBody {
                error: self.to_string(),
            }),
        )
            .into_response()
    }
}

impl SessionManager {
    pub async fn fork_session(
        &self,
        session_id: &str,
        message_idx: usize,
    ) -> Result<ForkSessionResponse, ForkSessionError> {
        if !self
            .persisted_operation_session_exists(session_id)
            .map_err(|error| report_failure(session_id, "verify persisted session", &error))?
        {
            return Err(ForkSessionError::NotFound);
        }
        if self
            .assignment_is_open(session_id)
            .map_err(|error| report_failure(session_id, "verify primary ownership", &error))?
        {
            // Running assignments stay parent-owned at public generic-work
            // boundaries so they remain indistinguishable from an unknown id.
            return Err(ForkSessionError::NotFound);
        }

        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)
                .map_err(|error| match error {
                    sessions::SessionOperationLeaseError::Busy(_) => ForkSessionError::Busy,
                    sessions::SessionOperationLeaseError::Store(error) => {
                        report_failure(session_id, "acquire operation lease", &error)
                    }
                })?;

        if !self
            .persisted_operation_session_exists(session_id)
            .map_err(|error| report_failure(session_id, "recheck persisted session", &error))?
        {
            return Err(ForkSessionError::NotFound);
        }
        if self
            .assignment_is_open(session_id)
            .map_err(|error| report_failure(session_id, "recheck primary ownership", &error))?
        {
            return Err(ForkSessionError::NotFound);
        }

        let service = self
            .attach_current_operation_service_locked(session_id, &operation_lease)
            .await
            .map_err(|error| report_failure(session_id, "attach current session", &error))?;

        if service.has_active_operation() {
            return Err(ForkSessionError::Busy);
        }

        let messages = service
            .messages_snapshot()
            .await
            .map_err(|error| report_failure(session_id, "read the transcript", &error))?;
        let end = fork_end_index(&messages, message_idx)?;
        let prefix = messages[..=end].to_vec();
        // Live merged length, not `messages_json`: the source blob is
        // write-once and the log tail is what `prefix` was sliced from.
        let source_transcript_len = messages.len();

        let store_path = self.inner.store_path.clone();
        let source_id = session_id.to_string();
        let fork_id = uuid::Uuid::new_v4().to_string();
        let persist_fork_id = fork_id.clone();
        tokio::task::spawn_blocking(move || {
            persist_fork(
                &store_path,
                &source_id,
                &persist_fork_id,
                prefix,
                source_transcript_len,
                message_idx,
            )
        })
        .await
        .map_err(|error| report_failure(session_id, "persist the fork", &error))??;

        drop(operation_lease);

        Ok(ForkSessionResponse {
            session_id: fork_id,
        })
    }

    pub fn dismiss_session_fork(
        &self,
        session_id: &str,
        fork_id: &str,
    ) -> Result<(), DismissForkError> {
        let removed = store::dismiss_session_fork(&self.inner.store_path, session_id, fork_id)
            .map_err(|error| {
                eprintln!(
                    "nac: dismiss fork {fork_id:?} on session {session_id:?} failed: {error}"
                );
                DismissForkError::Failed
            })?;
        if removed {
            Ok(())
        } else {
            Err(DismissForkError::NotFound)
        }
    }
}

fn persist_fork(
    store_path: &std::path::Path,
    source_id: &str,
    fork_id: &str,
    prefix: Vec<Message>,
    source_transcript_len: usize,
    message_idx: usize,
) -> Result<(), ForkSessionError> {
    let source = sessions::load_session(store_path, source_id)
        .map_err(|error| report_failure(source_id, "load the source session", &error))?;
    let source_name = sessions::list_sessions(store_path)
        .map_err(|error| report_failure(source_id, "read the source title", &error))?
        .into_iter()
        .find(|summary| summary.session_id == source_id)
        .map(|summary| source_display_name(&summary))
        .unwrap_or_else(|| "New Session".to_string());
    let visible = prefix
        .iter()
        .filter(|message| is_visible_response(message))
        .count();
    let source_behavior = source.behavior;
    // Never-fold: the blob is the system head; the copied conversation is
    // this session's transcript log, so revert/resend can target it.
    let blob_len = leading_system_len(&prefix);
    let mut fork = sessions::new_snapshot(
        fork_id.to_string(),
        source.cwd,
        source.model,
        source.base_url,
        source.backend,
        source.reasoning_effort,
        source.sandbox_spec,
        source.ssh,
        prefix[..blob_len].to_vec(),
        source.api_key_env,
        source.extra_headers,
    );
    fork.project_id = source.project_id;
    // Session behavior is immutable identity. A conversation fork starts a
    // new independent lifecycle, but it remains the same kind of top-level
    // agent rather than silently reverting direct sessions to orchestrator.
    fork.behavior = source_behavior;
    fork.light_model = source.light_model;
    fork.orchestrator_compaction_threshold = source.orchestrator_compaction_threshold;
    if let Some(spec) = fork.sandbox_spec.as_mut() {
        spec.worktree = None;
    }
    // Inherited transcript is context, not this session's spend. Copying
    // billed usage would double-count the source in the project rollup.
    fork.token_usages = {
        let mut usages = vec![None; visible];
        let context = source
            .token_usages
            .iter()
            .take(visible)
            .rev()
            .flatten()
            .find(|usage| usage.orchestrator_context_tokens > 0)
            .cloned()
            .map(|mut usage| {
                usage.input_tokens = 0;
                usage.output_tokens = 0;
                usage.cache_read_tokens = 0;
                usage.cache_write_tokens = 0;
                usage.reasoning_tokens = 0;
                usage.cost = Default::default();
                usage
            });
        if let (Some(usage), Some(last)) = (context, usages.last_mut()) {
            *last = Some(usage);
        }
        usages
    };
    if let Some(durations) = source.response_durations_ms {
        let truncated: Vec<_> = durations.into_iter().take(visible).collect();
        fork.last_response_duration_ms = truncated.last().copied().flatten();
        fork.previous_response_duration_ms = truncated
            .len()
            .checked_sub(2)
            .and_then(|index| truncated.get(index).copied())
            .flatten();
        fork.response_durations_ms = Some(truncated);
    }

    sessions::create_session(store_path, &fork)
        .map_err(|error| report_failure(source_id, "create the forked session", &error))?;
    if let Err(error) = finish_persisted_fork(
        store_path,
        source_id,
        fork_id,
        &prefix,
        source_transcript_len,
        message_idx,
        &source_name,
    ) {
        if let Err(cleanup) = sessions::delete_session(store_path, fork_id) {
            eprintln!(
                "nac: fork for session {source_id:?} failed after create; cleanup of {fork_id:?} also failed: {cleanup}"
            );
        }
        if let Err(cleanup) = store::dismiss_session_fork(store_path, source_id, fork_id) {
            eprintln!(
                "nac: fork for session {source_id:?} failed after create; fork-link cleanup of {fork_id:?} also failed: {cleanup}"
            );
        }
        return Err(error);
    }
    Ok(())
}

fn finish_persisted_fork(
    store_path: &std::path::Path,
    source_id: &str,
    fork_id: &str,
    prefix: &[Message],
    source_transcript_len: usize,
    message_idx: usize,
    source_name: &str,
) -> Result<(), ForkSessionError> {
    let blob_len = leading_system_len(prefix);
    let start_idx = u64::try_from(blob_len)
        .map_err(|error| report_failure(source_id, "write the forked transcript log", &error))?;
    store::TranscriptLogWriter::new(store_path)
        .and_then(|writer| writer.append_batch(fork_id, start_idx, &prefix[blob_len..]))
        .map_err(|error| report_failure(source_id, "write the forked transcript log", &error))?;
    store::clone_session_conversation_artifacts(
        store_path,
        source_id,
        fork_id,
        prefix,
        source_transcript_len,
    )
    .map_err(|error| report_failure(source_id, "clone conversation artifacts", &error))?;
    sessions::update_session_presentation(
        store_path,
        fork_id,
        &fork_presentation_title(source_name),
        false,
        0,
    )
    .map_err(|error| report_failure(source_id, "name the forked session", &error))?;
    // Last: a failed create must not leave a `session_forks` tombstone after
    // `delete_session` cleanup. That table is not foreign-keyed on purpose.
    store::insert_session_fork(store_path, source_id, fork_id, message_idx, source_name)
        .map_err(|error| report_failure(source_id, "record the fork link", &error))?;
    Ok(())
}

fn leading_system_len(messages: &[Message]) -> usize {
    messages
        .iter()
        .take_while(|message| matches!(message, Message::System { .. }))
        .count()
}

fn fork_end_index(messages: &[Message], message_idx: usize) -> Result<usize, ForkSessionError> {
    match messages.get(message_idx) {
        Some(Message::Assistant { .. }) => {}
        Some(_) => {
            return Err(ForkSessionError::Rejected(
                "fork target is not an assistant message".to_string(),
            ));
        }
        None => {
            return Err(ForkSessionError::Rejected(
                "fork target is past the transcript".to_string(),
            ));
        }
    }
    let mut end = message_idx;
    while end + 1 < messages.len() {
        if matches!(messages[end + 1], Message::Tool { .. }) {
            end += 1;
        } else {
            break;
        }
    }
    Ok(end)
}

fn is_visible_response(message: &Message) -> bool {
    matches!(
        message,
        Message::Assistant { tool_calls, .. }
            if tool_calls.as_ref().is_none_or(Vec::is_empty)
    )
}

fn source_display_name(summary: &sessions::SessionSummary) -> String {
    if let Some(title) = summary
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
    {
        return title.to_string();
    }
    if let Some(prompt) = summary
        .last_user_prompt
        .as_deref()
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
    {
        return prompt.to_string();
    }
    "New Session".to_string()
}

fn fork_presentation_title(source_name: &str) -> String {
    const PREFIX: &str = "Fork: ";
    const MAX_CHARS: usize = 120;
    let title = format!("{PREFIX}{source_name}");
    if title.chars().count() <= MAX_CHARS {
        title
    } else {
        title.chars().take(MAX_CHARS).collect()
    }
}

fn report_failure(
    session_id: &str,
    operation: &str,
    error: &(impl std::fmt::Display + ?Sized),
) -> ForkSessionError {
    eprintln!("nac: fork for session {session_id:?} failed to {operation}: {error}");
    ForkSessionError::Failed
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/fork",
    operation_id = "post_sessions_session_id_fork",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = ForkSessionRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ForkSessionResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((crate::ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 413, description = "Request body too large", body = String, content_type = "text/plain"), (status = 415, description = "Unsupported media type", body = String, content_type = "text/plain"), (status = 422, description = "JSON body validation failed", body = String, content_type = "text/plain"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<ForkSessionRequest>,
) -> Result<Json<ForkSessionResponse>, ForkSessionError> {
    Ok(Json(
        manager
            .fork_session(&session_id, request.message_idx)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}/forks/{fork_id}",
    operation_id = "delete_sessions_session_id_forks_fork_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("fork_id" = String, Path)),
    responses((status = 204, description = "Success"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((crate::ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn dismiss_handler(
    State(manager): State<SessionManager>,
    AxumPath((session_id, fork_id)): AxumPath<(String, String)>,
) -> Result<StatusCode, DismissForkError> {
    manager.dismiss_session_fork(&session_id, &fork_id)?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use nac_core::model::BackendKind;

    use super::*;

    fn assistant(content: &str) -> Message {
        Message::Assistant {
            content: Some(content.to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        }
    }

    #[test]
    fn persisted_fork_preserves_behavior_but_not_source_spend() {
        let root = std::env::temp_dir().join(format!("nac-fork-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let store_path = root.join("store.db");
        store::initialize(&store_path).unwrap();
        let messages = vec![
            Message::System {
                content: "direct policy".to_string(),
            },
            Message::User {
                content: "change the code".to_string(),
            },
            assistant("done"),
        ];
        let mut source = sessions::new_snapshot(
            "source".to_string(),
            root.clone(),
            "model".to_string(),
            "https://example.invalid/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            messages.clone(),
            None,
            BTreeMap::new(),
        );
        source.behavior = sessions::SessionBehavior::Direct;
        source.token_usages = vec![Some(Default::default())];
        let usage = source.token_usages[0].as_mut().unwrap();
        usage.input_tokens = 100;
        usage.output_tokens = 25;
        usage.orchestrator_context_tokens = 42;
        usage.cost.total = 777;
        let mut unattributed = usage.clone();
        unattributed.input_tokens = 9;
        unattributed.output_tokens = 0;
        unattributed.orchestrator_context_tokens = 0;
        unattributed.cost = Default::default();
        source.unattributed_token_usage = Some(unattributed);
        sessions::create_session(&store_path, &source).unwrap();

        persist_fork(
            &store_path,
            "source",
            "fork",
            messages.clone(),
            messages.len(),
            2,
        )
        .unwrap();

        let fork = sessions::load_session(&store_path, "fork").unwrap();
        assert_eq!(fork.behavior, sessions::SessionBehavior::Direct);
        assert_eq!(fork.messages.len(), 1);
        assert!(matches!(
            fork.messages.as_slice(),
            [Message::System { content }] if content == "direct policy"
        ));
        let inherited_tail = store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .read_tail_from("fork", 1)
            .unwrap();
        assert_eq!(
            inherited_tail
                .iter()
                .map(|(idx, _)| *idx)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert!(matches!(
            inherited_tail.as_slice(),
            [
                (_, Message::User { content: prompt }),
                (_, Message::Assistant { content: Some(response), .. })
            ] if prompt == "change the code" && response == "done"
        ));
        assert!(fork.unattributed_token_usage.is_none());
        let inherited_context = fork.token_usages.last().unwrap().as_ref().unwrap();
        assert_eq!(inherited_context.orchestrator_context_tokens, 42);
        assert_eq!(inherited_context.billable_tokens(), 0);
        assert_eq!(inherited_context.cost.total, 0);

        let links = store::list_session_forks(&store_path, "source").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].session_id, "fork");
        let summary = sessions::list_sessions(&store_path)
            .unwrap()
            .into_iter()
            .find(|summary| summary.session_id == "fork")
            .unwrap();
        assert_eq!(
            summary.forked_from.unwrap().session_id,
            "source".to_string()
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn fork_target_must_be_an_assistant_turn() {
        let messages = vec![
            Message::User {
                content: "question".to_string(),
            },
            assistant("answer"),
            Message::Tool {
                tool_call_id: "tool".to_string(),
                content: "result".into(),
            },
        ];
        assert!(matches!(
            fork_end_index(&messages, 0),
            Err(ForkSessionError::Rejected(_))
        ));
        assert_eq!(fork_end_index(&messages, 1).unwrap(), 2);
    }
}
