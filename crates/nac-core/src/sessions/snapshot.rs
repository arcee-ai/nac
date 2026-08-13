use super::*;

use crate::time::now_utc_nanoseconds as now_utc;

pub fn new_snapshot(
    session_id: String,
    cwd: PathBuf,
    model: String,
    base_url: String,
    backend: BackendKind,
    reasoning_effort: Option<ReasoningEffort>,
    sandbox_spec: Option<SandboxSpec>,
    ssh: Option<SshConnection>,
    messages: Vec<Message>,
    api_key_env: Option<String>,
    extra_headers: BTreeMap<String, String>,
) -> SessionSnapshot {
    let now = now_utc();
    SessionSnapshot {
        session_id,
        cwd,
        model,
        base_url,
        backend,
        reasoning_effort,
        sandbox_spec,
        ssh,
        api_key_env,
        extra_headers,
        orchestrator_compaction_threshold: None,
        config_version: 0,
        messages,
        last_response_duration_ms: None,
        previous_response_duration_ms: None,
        response_durations_ms: None,
        token_usages: Vec::new(),
        unattributed_token_usage: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub fn refresh_snapshot(
    snapshot: &SessionSnapshot,
    messages: Vec<Message>,
    last_response_duration_ms: Option<u64>,
    previous_response_duration_ms: Option<u64>,
    response_durations_ms: Option<Vec<Option<u64>>>,
    token_usages: Vec<Option<crate::model::TokenUsage>>,
) -> SessionSnapshot {
    SessionSnapshot {
        session_id: snapshot.session_id.clone(),
        cwd: snapshot.cwd.clone(),
        model: snapshot.model.clone(),
        base_url: snapshot.base_url.clone(),
        backend: snapshot.backend,
        reasoning_effort: snapshot.reasoning_effort,
        sandbox_spec: snapshot.sandbox_spec.clone(),
        ssh: snapshot.ssh.clone(),
        api_key_env: snapshot.api_key_env.clone(),
        extra_headers: snapshot.extra_headers.clone(),
        orchestrator_compaction_threshold: snapshot.orchestrator_compaction_threshold,
        config_version: snapshot.config_version,
        messages,
        last_response_duration_ms,
        previous_response_duration_ms,
        response_durations_ms,
        token_usages,
        unattributed_token_usage: snapshot.unattributed_token_usage.clone(),
        created_at: snapshot.created_at.clone(),
        updated_at: now_utc(),
    }
}

/// Run-state fields refreshed at run end: the token/timing bookkeeping
/// persisted by
/// [`crate::sessions::save_session_run_state`]. Everything else about a
/// session row — above all `messages_json` — is deliberately untouched at
/// run end.
#[derive(Debug, Clone, Default)]
pub struct SessionRunState {
    pub last_response_duration_ms: Option<u64>,
    pub previous_response_duration_ms: Option<u64>,
    pub response_durations_ms: Option<Vec<Option<u64>>>,
    pub token_usages: Vec<Option<crate::model::TokenUsage>>,
    pub unattributed_token_usage: Option<crate::model::TokenUsage>,
}

/// The sparing run-end persistence update consumed by
/// [`crate::sessions::save_session_run_state`]: run state plus the
/// row-identity/context columns the run-end UPDATE writes. Owned and small
/// — deliberately no transcript messages, so the run-end path never clones
/// the (write-once) blob.
#[derive(Debug, Clone)]
pub struct SessionRunStateUpdate {
    pub session_id: String,
    pub ssh: Option<SshConnection>,
    pub sandbox_spec: Option<SandboxSpec>,
    pub run_state: SessionRunState,
    pub updated_at: String,
}

impl SessionSnapshot {
    /// Apply run-end state to the in-memory snapshot in place without
    /// touching `messages` (the blob is write-once), and capture the
    /// sparing persistence update for `save_session_run_state`. `updated_at`
    /// is stamped once and shared by the in-memory copy and the store write.
    pub fn apply_run_state(&mut self, run_state: SessionRunState) -> SessionRunStateUpdate {
        self.last_response_duration_ms = run_state.last_response_duration_ms;
        self.previous_response_duration_ms = run_state.previous_response_duration_ms;
        self.response_durations_ms = run_state.response_durations_ms.clone();
        self.token_usages = run_state.token_usages.clone();
        self.unattributed_token_usage = run_state.unattributed_token_usage.clone();
        self.updated_at = now_utc();
        SessionRunStateUpdate {
            session_id: self.session_id.clone(),
            ssh: self.ssh.clone(),
            sandbox_spec: self.sandbox_spec.clone(),
            run_state,
            updated_at: self.updated_at.clone(),
        }
    }
}
