use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{mpsc, Mutex},
    task::JoinHandle,
};

use crate::agent::Agent;
use crate::commands::{self, PreparedPrompt, PreparedUserInput};
use crate::events::{AgentEvent, EventSink, SessionEvent, SessionEventBus};
pub use crate::events::{
    SessionClientId, SessionEventEnvelope, SessionEventReceiver, SessionEventReplaySubscription,
    SessionEventSubscription, SessionRunId, SessionSubscriptionId, SubmittedUserMessageSnapshot,
};
use crate::runtime::{OrchestratorRunConfig, OrchestratorSession};
use crate::sessions::{self, SessionSnapshot};
use crate::types::Message;
use crate::view::{
    self, EpisodeSnapshot, SessionSummarySnapshot, ThreadSnapshot, WorksetSnapshot,
    WorksetSummarySnapshot, WorksetsSnapshot, WorkspaceSnapshot,
};

pub type AgentEventReceiver = mpsc::UnboundedReceiver<AgentEvent>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionMetadata {
    pub cwd: String,
    pub workspace_host_path: Option<PathBuf>,
    pub store_path: PathBuf,
    pub model: String,
    pub backend: String,
    pub session_id: Option<String>,
    pub sandbox_status: String,
    pub agents_md_status: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResponseTimingSnapshot {
    pub last_response_duration_ms: Option<u64>,
    pub previous_response_duration_ms: Option<u64>,
    pub response_durations_ms: Option<Vec<Option<u64>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_usages: Option<Vec<Option<crate::model::TokenUsage>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_token_usage: Option<crate::model::TokenUsage>,
}

impl ResponseTimingSnapshot {
    pub fn from_session_snapshot(snapshot: Option<&SessionSnapshot>) -> Self {
        snapshot.map(Self::from).unwrap_or_default()
    }
}

impl From<&SessionSnapshot> for ResponseTimingSnapshot {
    fn from(snapshot: &SessionSnapshot) -> Self {
        let last_token_usage = snapshot.token_usages.last().cloned().flatten();
        Self {
            last_response_duration_ms: snapshot.last_response_duration_ms,
            previous_response_duration_ms: snapshot.previous_response_duration_ms,
            response_durations_ms: snapshot.response_durations_ms.clone(),
            token_usages: Some(snapshot.token_usages.clone()),
            last_token_usage,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActiveRunSnapshot {
    pub run_id: SessionRunId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<SessionClientId>,
    pub prompt_preview: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_user_message: Option<SubmittedUserMessageSnapshot>,
    pub started_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionServiceInit {
    pub metadata: SessionMetadata,
    pub restored_messages: Vec<Message>,
    pub response_timing: ResponseTimingSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFrontendSnapshot {
    pub metadata: SessionMetadata,
    pub messages: Vec<Message>,
    pub response_timing: ResponseTimingSnapshot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_run: Option<ActiveRunSnapshot>,
    pub sessions: Vec<SessionSummarySnapshot>,
    #[serde(default)]
    pub active_threads: Vec<String>,
    pub threads: Vec<ThreadSnapshot>,
    pub thread_episodes: HashMap<String, Vec<EpisodeSnapshot>>,
    pub worksets: WorksetsSnapshot,
    pub workspace: WorkspaceSnapshot,
}

pub struct SessionServiceParts {
    pub service: SessionService,
    pub init: SessionServiceInit,
    pub events: SessionEventReceiver,
}

pub struct SessionClientAttachment {
    pub client: SessionClientHandle,
    pub events: SessionEventSubscription,
    pub snapshot: SessionFrontendSnapshot,
}

pub struct SessionRunHandle {
    pub run_id: SessionRunId,
    pub client_id: Option<SessionClientId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionSubmitError {
    Busy { active_run: ActiveRunSnapshot },
}

impl std::fmt::Display for SessionSubmitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy { active_run } => write!(
                formatter,
                "session is busy with run {} ({})",
                active_run.run_id, active_run.prompt_preview
            ),
        }
    }
}

impl std::error::Error for SessionSubmitError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionCancelError {
    NotActive { run_id: SessionRunId },
}

impl std::fmt::Display for SessionCancelError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotActive { run_id } => write!(formatter, "run {run_id} is not active"),
        }
    }
}

impl std::error::Error for SessionCancelError {}

#[derive(Clone)]
pub struct SessionClientHandle {
    service: SessionService,
    client_id: SessionClientId,
}

impl SessionClientHandle {
    pub fn client_id(&self) -> &SessionClientId {
        &self.client_id
    }

    pub fn prepare_user_input(&self, input: &str) -> PreparedUserInput {
        self.service.prepare_user_input(input)
    }

    pub fn subscribe_events(&self) -> SessionEventSubscription {
        self.service
            .subscribe_events_for_client(self.client_id.clone())
    }

    pub fn subscribe_events_with_replay(
        &self,
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> SessionEventReplaySubscription {
        self.service.subscribe_events_for_client_with_replay(
            self.client_id.clone(),
            after_sequence_id,
            limit,
        )
    }

    pub async fn attach(&self) -> Result<SessionClientAttachment> {
        let events = self.subscribe_events();
        let snapshot = self.service.frontend_snapshot().await?;
        Ok(SessionClientAttachment {
            client: self.clone(),
            events,
            snapshot,
        })
    }

    pub async fn frontend_snapshot(&self) -> Result<SessionFrontendSnapshot> {
        self.service.frontend_snapshot().await
    }

    pub fn try_submit_prepared_prompt(
        &self,
        prompt: PreparedPrompt,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt(prompt.agent_prompt)
    }

    pub fn try_submit_prompt(
        &self,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.service
            .try_submit_prompt_for_client(self.client_id.clone(), expanded_prompt)
    }

    pub async fn request_cancel(
        &self,
        run_id: &SessionRunId,
    ) -> std::result::Result<(), SessionCancelError> {
        self.service.request_cancel(run_id).await
    }
}

#[derive(Clone)]
pub struct SessionService {
    agent: Arc<Mutex<Agent>>,
    metadata: Arc<SessionMetadata>,
    session_snapshot: Arc<Mutex<Option<SessionSnapshot>>>,
    event_bus: SessionEventBus,
    active_run: Arc<StdMutex<Option<ActiveRunState>>>,
    active_threads: Arc<Mutex<HashSet<String>>>,
}

struct ActiveRunState {
    snapshot: ActiveRunSnapshot,
    started_at: Instant,
    finishing: bool,
    task: Option<JoinHandle<()>>,
}

struct FinishingRun {
    snapshot: ActiveRunSnapshot,
    duration_ms: u64,
}

struct CancellingRun {
    snapshot: ActiveRunSnapshot,
    task: Option<JoinHandle<()>>,
}

enum RunOutcome {
    Completed(String, Option<crate::model::TokenUsage>),
    Failed(String),
}

impl SessionService {
    pub fn from_orchestrator_run_config(
        mut run_config: OrchestratorRunConfig,
    ) -> SessionServiceParts {
        let store_path = run_config.session.store_path();
        let session_id = run_config.session.session_id().map(str::to_string);
        let restored_messages = run_config.agent.messages.clone();
        let response_timing =
            ResponseTimingSnapshot::from_session_snapshot(match &run_config.session {
                OrchestratorSession::Active { snapshot, .. } => Some(snapshot),
                OrchestratorSession::Picker { .. } => None,
            });

        let event_bus = SessionEventBus::new(session_id.clone());
        let events = event_bus.subscribe();
        run_config
            .agent
            .set_event_sink(EventSink::bus(event_bus.clone()));

        let metadata = SessionMetadata {
            cwd: run_config.workspace_display,
            workspace_host_path: run_config.workspace_host_path,
            store_path,
            model: run_config.client.model.clone(),
            backend: run_config.client.backend().as_str().to_string(),
            session_id,
            sandbox_status: run_config.sandbox_status,
            agents_md_status: run_config.agents_md_status,
        };
        let session_snapshot = run_config.session.into_snapshot();
        let active_threads = run_config.agent.active_threads_handle();
        let service = Self {
            agent: Arc::new(Mutex::new(run_config.agent)),
            metadata: Arc::new(metadata.clone()),
            session_snapshot: Arc::new(Mutex::new(session_snapshot)),
            event_bus,
            active_run: Arc::new(StdMutex::new(None)),
            active_threads,
        };
        let init = SessionServiceInit {
            metadata,
            restored_messages,
            response_timing,
        };

        SessionServiceParts {
            service,
            init,
            events,
        }
    }

    pub fn connect_client(&self) -> SessionClientHandle {
        SessionClientHandle {
            service: self.clone(),
            client_id: SessionClientId::new(),
        }
    }

    pub async fn attach_client(&self) -> Result<SessionClientAttachment> {
        self.connect_client().attach().await
    }

    pub fn subscribe_events(&self) -> SessionEventReceiver {
        self.event_bus.subscribe()
    }

    pub fn recent_events(
        &self,
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> Vec<SessionEventEnvelope> {
        self.event_bus.recent_events(after_sequence_id, limit)
    }

    pub fn subscribe_events_for_client(
        &self,
        client_id: SessionClientId,
    ) -> SessionEventSubscription {
        self.event_bus.subscribe_for_client(client_id)
    }

    pub fn subscribe_events_for_client_with_replay(
        &self,
        client_id: SessionClientId,
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> SessionEventReplaySubscription {
        self.event_bus
            .subscribe_for_client_with_replay(client_id, after_sequence_id, limit)
    }

    pub fn subscribe_agent_events(&self) -> AgentEventReceiver {
        let mut events = self.subscribe_events();
        let (tx, rx) = mpsc::unbounded_channel();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                loop {
                    match events.recv().await {
                        Ok(envelope) => {
                            if let SessionEvent::Agent { event } = envelope.event {
                                if tx.send(event).is_err() {
                                    break;
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
        }
        rx
    }

    pub fn metadata(&self) -> SessionMetadata {
        (*self.metadata).clone()
    }

    pub fn active_run(&self) -> Option<ActiveRunSnapshot> {
        self.lock_active_run()
            .as_ref()
            .map(|active_run| active_run.snapshot.clone())
    }

    pub async fn active_thread_names(&self) -> Vec<String> {
        let mut names = self
            .active_threads
            .lock()
            .await
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    pub fn prepare_user_input(&self, input: &str) -> PreparedUserInput {
        commands::prepare_user_input(input)
    }

    pub fn try_submit_prepared_prompt(
        &self,
        prompt: PreparedPrompt,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt(prompt.agent_prompt)
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionSummarySnapshot>> {
        view::list_sessions(&self.metadata.store_path)
    }

    pub fn list_threads(&self) -> Result<Vec<ThreadSnapshot>> {
        view::list_threads(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn thread_episodes(&self, thread_name: &str) -> Result<Vec<EpisodeSnapshot>> {
        view::load_thread_episodes(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
            thread_name,
        )
    }

    pub fn all_thread_episodes(&self) -> Result<HashMap<String, Vec<EpisodeSnapshot>>> {
        view::load_all_thread_episodes(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn list_worksets(&self) -> Result<Vec<WorksetSummarySnapshot>> {
        view::list_worksets(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn read_workset(&self, workset_id: &str) -> Result<Option<WorksetSnapshot>> {
        view::read_workset(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
            workset_id,
        )
    }

    pub fn worksets_snapshot(&self) -> WorksetsSnapshot {
        view::worksets_snapshot(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn workspace_snapshot(&self) -> WorkspaceSnapshot {
        view::workspace_snapshot(
            &self.metadata.cwd,
            self.metadata.workspace_host_path.as_deref(),
        )
    }

    pub async fn frontend_snapshot(&self) -> Result<SessionFrontendSnapshot> {
        let (response_timing, persisted_messages) = {
            let snapshot = self.session_snapshot.lock().await;
            (
                ResponseTimingSnapshot::from_session_snapshot(snapshot.as_ref()),
                snapshot
                    .as_ref()
                    .map(|snapshot| snapshot.messages.clone())
                    .unwrap_or_default(),
            )
        };
        let messages = match self.agent.try_lock() {
            Ok(agent) => agent.messages.clone(),
            Err(_) => persisted_messages,
        };

        Ok(SessionFrontendSnapshot {
            metadata: self.metadata(),
            messages,
            response_timing,
            active_run: self.active_run(),
            sessions: self.list_sessions()?,
            active_threads: self.active_thread_names().await,
            threads: self.list_threads()?,
            thread_episodes: self.all_thread_episodes()?,
            worksets: self.worksets_snapshot(),
            workspace: self.workspace_snapshot(),
        })
    }

    pub fn try_submit_prompt(
        &self,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(None, expanded_prompt)
    }

    pub fn try_submit_prompt_for_client(
        &self,
        client_id: SessionClientId,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(Some(client_id), expanded_prompt)
    }

    pub async fn request_cancel(
        &self,
        run_id: &SessionRunId,
    ) -> std::result::Result<(), SessionCancelError> {
        let Some(cancelling_run) = self.mark_run_cancelling(run_id) else {
            return Err(SessionCancelError::NotActive {
                run_id: run_id.clone(),
            });
        };

        if let Some(task) = cancelling_run.task {
            task.abort();
            let _ = task.await;
        }

        self.append_cancellation_message().await;
        let message = "run cancelled by user".to_string();
        let persistence_error = match self
            .persist_run_snapshot(&cancelling_run.snapshot, None, None)
            .await
        {
            Ok(()) => None,
            Err(error) => {
                eprintln!(
                    "nac: failed to persist cancellation snapshot for run {}: {error:#}",
                    cancelling_run.snapshot.run_id
                );
                Some(format!("{error:#}"))
            }
        };

        let terminal_message = match persistence_error {
            Some(error) => {
                format!("{message}\nAdditionally, failed to persist session snapshot: {error}")
            }
            None => message,
        };
        self.event_bus.emit_with_context(
            SessionEvent::RunFailed {
                message: terminal_message,
            },
            Some(cancelling_run.snapshot.run_id.clone()),
            cancelling_run.snapshot.client_id.clone(),
        );
        self.clear_finished_run(&cancelling_run.snapshot.run_id);
        Ok(())
    }

    fn try_submit_prompt_inner(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        let active_run = self.try_begin_run(client_id, &expanded_prompt)?;
        let run_id = active_run.run_id.clone();
        let task_run_id = run_id.clone();
        let run_client_id = active_run.client_id.clone();
        let event_bus = self.event_bus.clone();
        let service = self.clone();
        let task = tokio::spawn(async move {
            let (result, usage) = {
                let mut agent = service.agent.lock().await;
                agent.set_event_sink(EventSink::bus_with_context(
                    event_bus.clone(),
                    Some(task_run_id.clone()),
                    run_client_id.clone(),
                ));
                let result = agent
                    .send(&expanded_prompt)
                    .await
                    .map_err(|error| error.to_string());
                agent.set_event_sink(EventSink::bus(event_bus));
                let usage = result.as_ref().ok().and_then(|_| agent.last_usage.clone());
                (result, usage)
            };
            match result {
                Ok(response) => {
                    service
                        .finish_run_once(&task_run_id, RunOutcome::Completed(response, usage))
                        .await;
                }
                Err(message) => {
                    service
                        .finish_run_once(&task_run_id, RunOutcome::Failed(message))
                        .await;
                }
            }
        });
        self.set_run_task(&run_id, task);

        Ok(SessionRunHandle {
            run_id: active_run.run_id,
            client_id: active_run.client_id,
        })
    }

    fn try_begin_run(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        let mut guard = self.lock_active_run();
        if let Some(active_run) = guard.as_ref() {
            return Err(SessionSubmitError::Busy {
                active_run: active_run.snapshot.clone(),
            });
        }

        let run_id = SessionRunId::new();
        let submitted_at_epoch_ms = now_epoch_ms();
        let submitted_user_message = SubmittedUserMessageSnapshot {
            run_id: run_id.clone(),
            client_id: client_id.clone(),
            content: expanded_prompt.to_string(),
            baseline_user_message_count: self.current_user_message_count(),
            submitted_at_epoch_ms,
        };
        let active_run = ActiveRunSnapshot {
            run_id,
            client_id,
            prompt_preview: prompt_preview(expanded_prompt, 160),
            submitted_user_message: Some(submitted_user_message),
            started_at_epoch_ms: submitted_at_epoch_ms,
        };
        *guard = Some(ActiveRunState {
            snapshot: active_run.clone(),
            started_at: Instant::now(),
            finishing: false,
            task: None,
        });
        drop(guard);

        self.event_bus.emit_with_context(
            SessionEvent::RunStarted {
                prompt_preview: active_run.prompt_preview.clone(),
                submitted_user_message: active_run.submitted_user_message.clone(),
                started_at_epoch_ms: active_run.started_at_epoch_ms,
            },
            Some(active_run.run_id.clone()),
            active_run.client_id.clone(),
        );

        Ok(active_run)
    }

    async fn finish_run_once(&self, run_id: &SessionRunId, outcome: RunOutcome) -> bool {
        let Some(finishing_run) = self.mark_run_finishing(run_id) else {
            return false;
        };
        let (completed_duration_ms, completed_usage) = match &outcome {
            RunOutcome::Completed(_, usage) => (Some(finishing_run.duration_ms), usage.clone()),
            RunOutcome::Failed(_) => (None, None),
        };
        let persistence_error = match self
            .persist_run_snapshot(
                &finishing_run.snapshot,
                completed_duration_ms,
                completed_usage,
            )
            .await
        {
            Ok(()) => None,
            Err(error) => {
                eprintln!(
                    "nac: failed to persist session snapshot for run {}: {error:#}",
                    finishing_run.snapshot.run_id
                );
                Some(format!("{error:#}"))
            }
        };

        let run_id = finishing_run.snapshot.run_id.clone();
        let client_id = finishing_run.snapshot.client_id.clone();
        let terminal_event = match (outcome, persistence_error) {
            (RunOutcome::Completed(_, _), Some(error)) => SessionEvent::RunFailed {
                message: format!("run completed, but failed to persist session snapshot: {error}"),
            },
            (RunOutcome::Completed(response, _), None) => SessionEvent::RunCompleted {
                response,
                duration_ms: completed_duration_ms,
            },
            (RunOutcome::Failed(message), Some(error)) => SessionEvent::RunFailed {
                message: format!(
                    "{message}\nAdditionally, failed to persist session snapshot: {error}"
                ),
            },
            (RunOutcome::Failed(message), None) => SessionEvent::RunFailed { message },
        };
        self.event_bus
            .emit_with_context(terminal_event, Some(run_id.clone()), client_id);
        self.clear_finished_run(&run_id);
        true
    }

    fn mark_run_finishing(&self, run_id: &SessionRunId) -> Option<FinishingRun> {
        let mut guard = self.lock_active_run();
        let active_run = guard.as_mut()?;
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            return None;
        }
        active_run.finishing = true;
        active_run.snapshot.submitted_user_message = None;
        Some(FinishingRun {
            snapshot: active_run.snapshot.clone(),
            duration_ms: duration_ms(active_run.started_at.elapsed()),
        })
    }

    fn mark_run_cancelling(&self, run_id: &SessionRunId) -> Option<CancellingRun> {
        let mut guard = self.lock_active_run();
        let active_run = guard.as_mut()?;
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            return None;
        }
        active_run.finishing = true;
        active_run.snapshot.submitted_user_message = None;
        Some(CancellingRun {
            snapshot: active_run.snapshot.clone(),
            task: active_run.task.take(),
        })
    }

    fn set_run_task(&self, run_id: &SessionRunId, task: JoinHandle<()>) {
        let mut guard = self.lock_active_run();
        let Some(active_run) = guard.as_mut() else {
            task.abort();
            return;
        };
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            task.abort();
            return;
        }
        active_run.task = Some(task);
    }

    fn clear_finished_run(&self, run_id: &SessionRunId) {
        let mut guard = self.lock_active_run();
        if guard
            .as_ref()
            .is_some_and(|active_run| &active_run.snapshot.run_id == run_id && active_run.finishing)
        {
            *guard = None;
        }
    }

    fn current_user_message_count(&self) -> Option<usize> {
        if let Ok(agent) = self.agent.try_lock() {
            return Some(count_user_messages(&agent.messages));
        }
        if let Ok(snapshot) = self.session_snapshot.try_lock() {
            return Some(
                snapshot
                    .as_ref()
                    .map(|snapshot| count_user_messages(&snapshot.messages))
                    .unwrap_or_default(),
            );
        }
        None
    }

    fn lock_active_run(&self) -> std::sync::MutexGuard<'_, Option<ActiveRunState>> {
        self.active_run
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    async fn persist_run_snapshot(
        &self,
        active_run: &ActiveRunSnapshot,
        completed_duration_ms: Option<u64>,
        completed_usage: Option<crate::model::TokenUsage>,
    ) -> Result<()> {
        let messages = {
            let agent = self.agent.lock().await;
            agent.messages.clone()
        };

        let refreshed = {
            let snapshot = self.session_snapshot.lock().await;
            let Some(snapshot) = snapshot.as_ref() else {
                return Ok(());
            };
            let response_timing =
                response_timing_after_run(snapshot, &messages, completed_duration_ms);
            let token_usages = token_usages_after_run(
                &snapshot.token_usages,
                &snapshot.messages,
                &messages,
                completed_usage,
            );
            sessions::refresh_snapshot(
                snapshot,
                messages,
                response_timing.last_response_duration_ms,
                response_timing.previous_response_duration_ms,
                response_timing.response_durations_ms,
                token_usages,
            )
        };

        let saved_snapshot = refreshed.clone();
        let store_path = self.metadata.store_path.clone();
        tokio::task::spawn_blocking(move || sessions::save_session(&store_path, &saved_snapshot))
            .await??;

        let saved_session_id = refreshed.session_id.clone();
        {
            let mut snapshot = self.session_snapshot.lock().await;
            *snapshot = Some(refreshed);
        }
        self.event_bus.emit_with_context(
            SessionEvent::SnapshotSaved {
                session_id: saved_session_id,
            },
            Some(active_run.run_id.clone()),
            active_run.client_id.clone(),
        );

        Ok(())
    }

    async fn append_cancellation_message(&self) {
        let mut agent = self.agent.lock().await;
        truncate_incomplete_tool_turn(&mut agent.messages);
        agent.messages.push(Message::Assistant {
            content: Some("[run cancelled by user]".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        });
    }
}

fn count_user_messages(messages: &[Message]) -> usize {
    messages
        .iter()
        .filter(|message| matches!(message, Message::User { .. }))
        .count()
}

fn truncate_incomplete_tool_turn(messages: &mut Vec<Message>) {
    let Some(index) = messages.iter().rposition(|message| {
        matches!(
            message,
            Message::Assistant {
                tool_calls: Some(tool_calls),
                ..
            } if !tool_calls.is_empty()
        )
    }) else {
        return;
    };
    let Message::Assistant {
        tool_calls: Some(tool_calls),
        ..
    } = &messages[index]
    else {
        return;
    };
    let expected = tool_calls
        .iter()
        .map(|tool_call| tool_call.id.as_str())
        .collect::<HashSet<_>>();
    let observed = messages[index + 1..]
        .iter()
        .filter_map(|message| match message {
            Message::Tool { tool_call_id, .. } => Some(tool_call_id.as_str()),
            _ => None,
        })
        .collect::<HashSet<_>>();
    if !expected.is_subset(&observed) {
        messages.truncate(index);
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn prompt_preview(value: &str, max_chars: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= max_chars {
        return compact;
    }

    let mut preview = String::new();
    for ch in compact.chars().take(max_chars.saturating_sub(3)) {
        preview.push(ch);
    }
    preview.push_str("...");
    preview
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

fn response_timing_after_run(
    snapshot: &SessionSnapshot,
    messages: &[Message],
    completed_duration_ms: Option<u64>,
) -> ResponseTimingSnapshot {
    let mut durations = response_duration_history_from_snapshot(snapshot);
    let previous_response_count = visible_response_count(&snapshot.messages);
    if durations.len() < previous_response_count {
        durations.resize(previous_response_count, None);
    }

    let current_response_count = visible_response_count(messages);
    if durations.len() < current_response_count {
        durations.resize(current_response_count, None);
    }
    if let (Some(duration_ms), Some(last_index)) =
        (completed_duration_ms, current_response_count.checked_sub(1))
    {
        durations[last_index] = Some(duration_ms);
    }

    let last_response_duration_ms = durations.last().copied().flatten();
    let previous_response_duration_ms = durations
        .len()
        .checked_sub(2)
        .and_then(|index| durations.get(index))
        .copied()
        .flatten();

    ResponseTimingSnapshot {
        last_response_duration_ms,
        previous_response_duration_ms,
        response_durations_ms: Some(durations),
        token_usages: None,
        last_token_usage: None,
    }
}

fn response_duration_history_from_snapshot(snapshot: &SessionSnapshot) -> Vec<Option<u64>> {
    if let Some(durations) = &snapshot.response_durations_ms {
        return durations.clone();
    }

    let response_count = visible_response_count(&snapshot.messages);
    let mut durations = vec![None; response_count];
    if let Some(last_index) = response_count.checked_sub(1) {
        durations[last_index] = snapshot.last_response_duration_ms;
    }
    if response_count >= 2 {
        durations[response_count - 2] = snapshot.previous_response_duration_ms;
    }
    durations
}

fn visible_response_count(messages: &[Message]) -> usize {
    messages
        .iter()
        .filter(|message| {
            matches!(
                message,
                Message::Assistant { tool_calls, .. }
                    if tool_calls.as_ref().is_none_or(|tool_calls| tool_calls.is_empty())
            )
        })
        .count()
}

/// Build the per-response token-usage vector after a run, mirroring the
/// logic in `response_timing_after_run` for durations.  The existing
/// vector is preserved and padded to match the new response count; the
/// most recent response's usage is set from `completed_usage` when the
/// run completed successfully.
fn token_usages_after_run(
    existing: &[Option<crate::model::TokenUsage>],
    old_messages: &[Message],
    new_messages: &[Message],
    completed_usage: Option<crate::model::TokenUsage>,
) -> Vec<Option<crate::model::TokenUsage>> {
    let mut usages = existing.to_vec();
    let previous_response_count = visible_response_count(old_messages);
    if usages.len() < previous_response_count {
        usages.resize(previous_response_count, None);
    }

    let current_response_count = visible_response_count(new_messages);
    if usages.len() < current_response_count {
        usages.resize(current_response_count, None);
    }
    if let (Some(usage), Some(last_index)) =
        (completed_usage, current_response_count.checked_sub(1))
    {
        usages[last_index] = Some(usage);
    }

    usages
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{AgentConfig, AgentMode};
    use crate::model::ModelClient;
    use std::collections::BTreeMap;

    fn test_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_session_service_{label}_{unique}"))
            .join("store.db")
    }

    fn test_agent(client: ModelClient, store_path: PathBuf, session_id: Option<String>) -> Agent {
        Agent::with_config(
            client,
            AgentConfig {
                mode: AgentMode::Orchestrator,
                store_path,
                session_id,
                initial_messages: Vec::new(),
                thread_name: None,
                event_sink: EventSink::none(),
                workspace_cwd: PathBuf::from("/repo"),
                config_cwd: PathBuf::from("/repo"),
                working_directory: "/repo".to_string(),
                worker_executable: None,
                sandbox: None,
                ssh_host: None,
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            },
        )
        .expect("agent config must be valid")
    }

    fn test_picker_service(label: &str) -> SessionServiceParts {
        let store_path = test_store_path(label);
        let client = ModelClient::new_for_test();
        let agent = test_agent(client.clone(), store_path.clone(), None);
        SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Picker { store_path },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        })
    }

    fn assert_run_started_event(
        envelope: SessionEventEnvelope,
        active_run: &ActiveRunSnapshot,
        prompt_preview: &str,
    ) {
        assert_eq!(envelope.client_id.as_ref(), active_run.client_id.as_ref());
        assert_eq!(envelope.run_id.as_ref(), Some(&active_run.run_id));
        match envelope.event {
            SessionEvent::RunStarted {
                prompt_preview: emitted_preview,
                submitted_user_message,
                started_at_epoch_ms,
            } => {
                assert_eq!(emitted_preview, prompt_preview);
                assert_eq!(submitted_user_message, active_run.submitted_user_message);
                assert_eq!(started_at_epoch_ms, active_run.started_at_epoch_ms);
            }
            other => panic!("expected run started, got {other:?}"),
        }
    }

    #[test]
    fn from_orchestrator_run_config_exposes_metadata_and_init_snapshot() {
        let store_path = test_store_path("active_init");
        let client = ModelClient::new_for_test();
        let session_id = "session-1".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let mut snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        snapshot.last_response_duration_ms = Some(200);
        snapshot.previous_response_duration_ms = Some(100);
        snapshot.response_durations_ms = Some(vec![Some(100), Some(200)]);

        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "loaded".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        assert_eq!(parts.init.metadata.store_path, store_path);
        assert_eq!(parts.init.metadata.session_id.as_deref(), Some("session-1"));
        assert_eq!(parts.init.metadata.model, "gpt-5.5");
        assert_eq!(parts.init.metadata.backend, "openai-responses");
        assert_eq!(parts.init.restored_messages.len(), 1);
        assert_eq!(
            parts.init.response_timing.last_response_duration_ms,
            Some(200)
        );
        assert_eq!(
            parts.init.response_timing.response_durations_ms,
            Some(vec![Some(100), Some(200)])
        );
    }

    #[tokio::test]
    async fn finish_run_persists_snapshot_before_completion_event() {
        let store_path = test_store_path("active_finish_persist");
        let client = ModelClient::new_for_test();
        let session_id = "session-finish-persist".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        let mut events = parts.service.subscribe_events();
        let client = parts.service.connect_client();
        let active = parts
            .service
            .try_begin_run(Some(client.client_id().clone()), "prompt")
            .unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "prompt".to_string(),
            });
            agent.messages.push(Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            });
        }

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Completed("done".to_string(), None))
                .await
        );

        let started = events.recv().await.unwrap();
        assert_eq!(started.sequence_id, 1);
        assert_run_started_event(started, &active, "prompt");

        let saved_event = events.recv().await.unwrap();
        assert_eq!(saved_event.session_id.as_deref(), Some(session_id.as_str()));
        assert_eq!(saved_event.sequence_id, 2);
        assert_eq!(saved_event.client_id.as_ref(), active.client_id.as_ref());
        assert_eq!(saved_event.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            saved_event.event,
            SessionEvent::SnapshotSaved {
                session_id: session_id.clone()
            }
        );

        let completion = events.recv().await.unwrap();
        assert_eq!(completion.sequence_id, 3);
        assert_eq!(completion.client_id.as_ref(), active.client_id.as_ref());
        assert_eq!(completion.run_id.as_ref(), Some(&active.run_id));
        let duration_ms = match completion.event {
            SessionEvent::RunCompleted {
                response,
                duration_ms,
            } => {
                assert_eq!(response, "done");
                duration_ms.expect("completed run should include duration")
            }
            other => panic!("expected run completion, got {other:?}"),
        };

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.last_response_duration_ms, Some(duration_ms));
        assert_eq!(loaded.previous_response_duration_ms, None);
        assert_eq!(loaded.response_durations_ms, Some(vec![Some(duration_ms)]));
        assert_eq!(
            loaded.messages.len(),
            parts.init.restored_messages.len() + 2
        );
        assert!(parts.service.active_run().is_none());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn finish_run_persists_token_usage() {
        let store_path = test_store_path("active_finish_token_usage");
        let client = ModelClient::new_for_test();
        let session_id = "session-finish-token-usage".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
            None,
            BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        let active = parts
            .service
            .try_begin_run(None, "prompt")
            .unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "prompt".to_string(),
            });
            agent.messages.push(Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            });
        }

        let test_usage = crate::model::TokenUsage {
            input_tokens: 500,
            output_tokens: 120,
            cache_read_tokens: 80,
            cache_write_tokens: 15,
            total_tokens: 715,
        };
        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), Some(test_usage.clone())),
                )
                .await
        );

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.token_usages.len(), 1);
        let persisted = loaded.token_usages[0]
            .as_ref()
            .expect("token usage should be persisted");
        assert_eq!(persisted.input_tokens, 500);
        assert_eq!(persisted.output_tokens, 120);
        assert_eq!(persisted.cache_read_tokens, 80);
        assert_eq!(persisted.cache_write_tokens, 15);
        assert_eq!(persisted.total_tokens, 715);

        // Frontend snapshot should expose the usage
        let frontend = parts.service.frontend_snapshot().await.unwrap();
        assert_eq!(
            frontend
                .response_timing
                .last_token_usage
                .as_ref()
                .unwrap()
                .total_tokens,
            715
        );
        assert_eq!(
            frontend
                .response_timing
                .token_usages
                .as_ref()
                .unwrap()
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn completed_run_reports_failure_when_snapshot_persistence_fails() {
        let store_path = test_store_path("active_persist_failure");
        let store_parent = store_path.parent().unwrap().to_path_buf();
        std::fs::write(&store_parent, "not a directory").unwrap();
        let client = ModelClient::new_for_test();
        let session_id = "session-persist-failure".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id,
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: snapshot.session_id.clone(),
                store_path,
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        let mut events = parts.service.subscribe_events();
        let active = parts.service.try_begin_run(None, "prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "prompt".to_string(),
            });
            agent.messages.push(Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            });
        }

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Completed("done".to_string(), None))
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "prompt");

        let terminal = events.recv().await.unwrap();
        assert_eq!(terminal.sequence_id, 2);
        assert_eq!(terminal.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(terminal.client_id.as_ref(), active.client_id.as_ref());
        match terminal.event {
            SessionEvent::RunFailed { message } => {
                assert!(message.contains("run completed, but failed to persist session snapshot"));
                assert!(message.contains("failed to create store dir"));
            }
            other => panic!("expected run failure after persistence error, got {other:?}"),
        }
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
        assert!(parts.service.active_run().is_none());

        let _ = std::fs::remove_file(store_parent);
    }

    #[tokio::test]
    async fn subscribe_agent_events_filters_agent_envelopes() {
        let store_path = test_store_path("agent_event_adapter");
        let client = ModelClient::new_for_test();
        let session_id = "session-agent-events".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut agent_events = parts.service.subscribe_agent_events();
        let agent_event = AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "hello".to_string(),
        };

        parts.service.event_bus.emit(SessionEvent::SnapshotSaved {
            session_id: session_id.clone(),
        });
        parts.service.event_bus.emit_agent(agent_event.clone());

        assert_eq!(agent_events.recv().await, Some(agent_event));
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn client_subscribers_receive_same_events_with_unique_identity() {
        let parts = test_picker_service("client_subscribers");
        let first_client = parts.service.connect_client();
        let second_client = parts.service.connect_client();
        let mut first_events = first_client.subscribe_events();
        let mut second_events = second_client.subscribe_events();

        assert_ne!(first_client.client_id(), second_client.client_id());
        assert_eq!(&first_events.client_id, first_client.client_id());
        assert_eq!(&second_events.client_id, second_client.client_id());
        assert_ne!(first_events.subscription_id, second_events.subscription_id);

        let agent_event = AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "hello clients".to_string(),
        };
        parts.service.event_bus.emit_agent(agent_event.clone());

        let first = first_events.receiver.recv().await.unwrap();
        let second = second_events.receiver.recv().await.unwrap();
        assert_eq!(first, second);
        assert_eq!(first.sequence_id, 1);
        assert_eq!(first.event, SessionEvent::Agent { event: agent_event });
    }

    #[tokio::test]
    async fn frontend_snapshot_does_not_wait_for_agent_lock_while_active_run() {
        let parts = test_picker_service("snapshot_nonblocking");
        let agent_guard = parts.service.agent.lock().await;
        let active = parts.service.try_begin_run(None, "blocked prompt").unwrap();

        let snapshot = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            parts.service.frontend_snapshot(),
        )
        .await
        .expect("frontend snapshot should not wait for the held agent mutex")
        .unwrap();

        assert_eq!(snapshot.active_run, Some(active.clone()));
        let submitted = snapshot
            .active_run
            .as_ref()
            .and_then(|active_run| active_run.submitted_user_message.as_ref())
            .expect("active run should expose server-submitted user message");
        assert_eq!(submitted.run_id, active.run_id);
        assert_eq!(submitted.content, "blocked prompt");
        assert_eq!(submitted.baseline_user_message_count, Some(0));
        assert!(snapshot.messages.is_empty());

        drop(agent_guard);
        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Failed("cleanup".to_string()))
                .await
        );
        let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn mark_run_finishing_clears_submitted_user_message_before_persistence() {
        let store_path = test_store_path("active_pending_cleared_on_finish");
        let client = ModelClient::new_for_test();
        let session_id = "session-pending-clear".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut events = parts.service.subscribe_events();
        let active = parts
            .service
            .try_begin_run(None, "persisted prompt")
            .unwrap();
        assert!(active.submitted_user_message.is_some());
        assert_eq!(parts.service.active_run(), Some(active.clone()));
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "persisted prompt".to_string(),
            });
        }

        let finishing = parts
            .service
            .mark_run_finishing(&active.run_id)
            .expect("run should transition to finishing");
        assert_eq!(finishing.snapshot.run_id, active.run_id);
        assert!(finishing.snapshot.submitted_user_message.is_none());
        let active_after_finishing = parts.service.active_run().unwrap();
        assert_eq!(active_after_finishing.run_id, active.run_id);
        assert!(active_after_finishing.submitted_user_message.is_none());

        let frontend_before_persist = parts.service.frontend_snapshot().await.unwrap();
        assert!(frontend_before_persist
            .active_run
            .as_ref()
            .unwrap()
            .submitted_user_message
            .is_none());
        assert!(matches!(
            frontend_before_persist.messages.last(),
            Some(Message::User { content }) if content == "persisted prompt"
        ));

        parts
            .service
            .persist_run_snapshot(&finishing.snapshot, Some(42), None)
            .await
            .unwrap();

        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "persisted prompt");
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let active_after_save = parts.service.active_run().unwrap();
        assert_eq!(active_after_save.run_id, active.run_id);
        assert!(active_after_save.submitted_user_message.is_none());

        let frontend_after_persist = parts.service.frontend_snapshot().await.unwrap();
        assert!(frontend_after_persist
            .active_run
            .as_ref()
            .unwrap()
            .submitted_user_message
            .is_none());
        assert!(matches!(
            frontend_after_persist.messages.last(),
            Some(Message::User { content }) if content == "persisted prompt"
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn mark_run_cancelling_clears_submitted_user_message() {
        let parts = test_picker_service("active_pending_cleared_on_cancel");
        let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
        assert!(active.submitted_user_message.is_some());

        let cancelling = parts
            .service
            .mark_run_cancelling(&active.run_id)
            .expect("run should transition to cancelling");

        assert_eq!(cancelling.snapshot.run_id, active.run_id);
        assert!(cancelling.snapshot.submitted_user_message.is_none());
        let active_after_cancelling = parts.service.active_run().unwrap();
        assert_eq!(active_after_cancelling.run_id, active.run_id);
        assert!(active_after_cancelling.submitted_user_message.is_none());
        let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn busy_run_rejects_concurrent_submission_and_clears_once() {
        let parts = test_picker_service("busy_rejection");
        let client = parts.service.connect_client();
        let mut events = parts.service.subscribe_events();
        let first = parts
            .service
            .try_begin_run(Some(client.client_id().clone()), "first prompt")
            .unwrap();

        assert_eq!(parts.service.active_run(), Some(first.clone()));
        let first_started = events.recv().await.unwrap();
        assert_eq!(first_started.sequence_id, 1);
        assert_run_started_event(first_started, &first, "first prompt");
        assert!(matches!(
            parts.service.try_begin_run(None, "second prompt"),
            Err(SessionSubmitError::Busy { active_run }) if active_run == first
        ));

        assert!(
            parts
                .service
                .finish_run_once(&first.run_id, RunOutcome::Completed("done".to_string(), None))
                .await
        );
        let completion = events.recv().await.unwrap();
        assert_eq!(completion.sequence_id, 2);
        assert_eq!(completion.run_id.as_ref(), Some(&first.run_id));
        assert_eq!(completion.client_id.as_ref(), first.client_id.as_ref());
        assert!(matches!(
            completion.event,
            SessionEvent::RunCompleted {
                response,
                duration_ms: Some(_),
            } if response == "done"
        ));
        assert!(parts.service.active_run().is_none());

        assert!(
            !parts
                .service
                .finish_run_once(
                    &first.run_id,
                    RunOutcome::Completed("duplicate".to_string(), None)
                )
                .await
        );
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));

        let second = parts.service.try_begin_run(None, "second prompt").unwrap();
        let second_started = events.recv().await.unwrap();
        assert_run_started_event(second_started, &second, "second prompt");
        assert!(
            parts
                .service
                .finish_run_once(&second.run_id, RunOutcome::Failed("boom".to_string()))
                .await
        );
        let failed = events.recv().await.unwrap();
        assert_eq!(failed.run_id.as_ref(), Some(&second.run_id));
        assert!(failed.client_id.is_none());
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "boom".to_string()
            }
        );
        assert!(parts.service.active_run().is_none());
    }

    #[tokio::test]
    async fn failed_run_persists_messages_without_recording_new_duration() {
        let store_path = test_store_path("active_failed_persist");
        let client = ModelClient::new_for_test();
        let session_id = "session-failed-persist".to_string();
        let mut agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        agent.messages.push(Message::User {
            content: "old prompt".to_string(),
        });
        agent.messages.push(Message::Assistant {
            content: Some("old response".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        });
        let mut snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        snapshot.last_response_duration_ms = Some(123);
        snapshot.response_durations_ms = Some(vec![Some(123)]);
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut events = parts.service.subscribe_events();
        let active = parts.service.try_begin_run(None, "failed prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "failed prompt".to_string(),
            });
        }

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Failed("boom".to_string()))
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "failed prompt");
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let failed = events.recv().await.unwrap();
        assert_eq!(failed.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "boom".to_string()
            }
        );

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.last_response_duration_ms, Some(123));
        assert_eq!(loaded.previous_response_duration_ms, None);
        assert_eq!(loaded.response_durations_ms, Some(vec![Some(123)]));
        assert_eq!(
            loaded.messages.len(),
            parts.init.restored_messages.len() + 1
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn request_cancel_persists_marker_and_emits_terminal_event() {
        let store_path = test_store_path("active_cancel_persist");
        let client = ModelClient::new_for_test();
        let session_id = "session-cancel-persist".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut events = parts.service.subscribe_events();
        let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "cancel prompt".to_string(),
            });
        }

        parts.service.request_cancel(&active.run_id).await.unwrap();

        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "cancel prompt");
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let failed = events.recv().await.unwrap();
        assert_eq!(failed.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "run cancelled by user".to_string()
            }
        );
        assert!(parts.service.active_run().is_none());

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert!(matches!(
            loaded.messages.last(),
            Some(Message::Assistant {
                content: Some(content),
                ..
            }) if content == "[run cancelled by user]"
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn finish_run_without_active_session_snapshot_emits_completion_without_saving() {
        let store_path = test_store_path("picker_noop");
        let client = ModelClient::new_for_test();
        let agent = test_agent(client.clone(), store_path.clone(), None);
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Picker {
                store_path: store_path.clone(),
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut events = parts.service.subscribe_events();
        let active = parts.service.try_begin_run(None, "prompt").unwrap();

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Completed("done".to_string(), None))
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "prompt");
        let completion = events.recv().await.unwrap();
        assert_eq!(completion.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(
            completion.event,
            SessionEvent::RunCompleted {
                response,
                duration_ms: Some(_),
            } if response == "done"
        ));
        assert!(events.try_recv().is_err());
        assert!(!store_path.exists());
    }
}
