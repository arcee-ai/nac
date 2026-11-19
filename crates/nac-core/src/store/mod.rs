use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

mod blocking_caller;
pub(crate) mod coordinator;
pub(crate) mod goal_changes;
pub(crate) use blocking_caller::call_legacy_store;
pub use blocking_caller::{spawn_blocking_store_caller, BlockingStoreCaller};
#[macro_use]
pub(crate) mod coordinated_commands;
mod heartbeats;
pub use heartbeats::*;
mod attention;
mod completion_occurrences;
pub use attention::{
    read_attention_census, read_attention_metadata, read_attention_topology, AttentionLineage,
    AttentionLineageKind, AttentionStoreCensus, AttentionStoreObservation, AttentionStoredGoal,
    AttentionStoredRun, AttentionStoredSession, AttentionTopology, ATTENTION_METADATA_BYTES,
    ATTENTION_SOURCE_LIMIT,
};
pub use completion_occurrences::{
    read_completion_page, CompletionCursor, CompletionKind, CompletionOccurrence, CompletionPage,
    COMPLETION_PAGE_BYTES, COMPLETION_PAGE_ROWS,
};
mod managed_maintenance;
mod managed_probe;
pub(crate) mod orchestrator_compaction;
pub(crate) mod peer_goals;
mod permission_grants;
mod projects;
mod provider_connections;
pub use provider_connections::{
    insert_provider_connection, list_provider_connections, ProviderConnectionRecord,
};
mod review_intent;
mod run_recovery;
mod schema;
mod session_forks;
mod session_goals;
pub use peer_goals::{PeerGoalStart, PeerGoalStartReceipt};
mod session_inbox;
mod session_mcp_refresh;
mod shell_commands;
pub use shell_commands::recent_shell_commands;
pub(crate) use shell_commands::{
    accept_shell_command, list_shell_commands, lookup_shell_command, start_shell_command,
};
pub(crate) mod native_task_launches;
mod ssh_configurations;
mod task_discovery;
mod task_evidence;
mod task_followup_delegations;
pub(crate) mod task_followups;
pub(crate) use task_followup_delegations::issue_task_followup_delegation;
#[cfg(test)]
pub(crate) use task_followup_delegations::issue_test_task_followup_delegation;
pub use task_followup_delegations::{
    load_task_followup_delegation, revoke_task_followup_delegation, TaskFollowupDelegation,
    TaskFollowupDelegationRequest,
};
pub(crate) mod task_questions;
#[cfg(test)]
pub(crate) use task_questions::create_task_question;
pub(crate) use task_questions::{
    answer_task_question_bound, cancel_task_question, create_task_question_bound,
    pending_task_question, question_continuation_run, QuestionAgentScope,
};
pub use task_questions::{
    list_task_questions, load_task_question, QuestionAnswer, QuestionAnswerReceipt, QuestionError,
    QuestionRecord, QuestionRequest, QuestionResponder,
};
pub(crate) mod task_launches;
pub use native_task_launches::{
    load_native_task_launch, reconcile_native_task_launches, reserve_native_task_launch,
    update_native_task_admission_error, update_native_task_launch,
};
mod terminal_cleanups;
mod terminal_selection;
mod thread_events;
mod time;
mod traditional_children;
mod transcript;
mod transcript_append;
use transcript_append::AppendPurpose;
mod workspace_revisions;

/// Historical storage target for the canonical primary-session transcript.
/// The following migration renames this without rewriting user content.
pub const ORCHESTRATOR_STEERING_TARGET: &str = "__orchestrator__";

pub use coordinator::{PersistenceAdmissionError, PersistenceStats, StoreCoordinator};
pub use managed_maintenance::*;
pub use managed_probe::{
    observe_managed_probe_store, observe_managed_probe_store_for_identity,
    retain_managed_probe_identity,
};
pub use permission_grants::*;
pub use projects::*;
pub use review_intent::InputOrigin;
pub(crate) use review_intent::{decode_review_intent, record_review_intent, StoredReviewIntent};
pub(crate) use run_recovery::{
    clear_active_run, load_run_recovery_with_connection, mark_active_run_failed,
    replace_with_active_run, stage_active_run_failure,
};
pub use run_recovery::{
    clear_settled_run_recovery, load_run_recovery, reconcile_active_run, ActiveRunReconciliation,
    RunRecoveryRecord, RunRecoveryStatus, RunTerminalDisposition,
};
pub use schema::{
    check_readiness, default_store_path, default_store_path_for_track, initialize,
    migration_status, observe_probe_migration_status, schema_version, StoreFutureSchemaError,
    StoreMigrationFailure, StoreMigrationState, StoreMigrationStatus, StoreTrack,
    MINIMUM_MIGRATABLE_SCHEMA_VERSION,
};
pub use session_forks::{
    clone_session_conversation_artifacts, dismiss_session_fork, insert_session_fork,
    list_session_forks, SessionForkLink, SessionForkOrigin,
};
pub(crate) use session_forks::{fork_origin_from_parts, list_session_forks_with_connection};
pub use session_goals::*;
pub use session_inbox::*;
pub use session_mcp_refresh::*;
pub use ssh_configurations::*;
pub use task_discovery::*;
pub(crate) use task_evidence::record_run_outcome_with_connection;
pub use task_evidence::{
    GoalOutcomeRecord, GoalRetirement, RunOutcomeDisposition, RunOutcomeRecord,
    RETAINED_GOAL_OUTCOMES, RETAINED_RUN_OUTCOMES, RUN_RESULT_EXCERPT_CHARS,
};
pub use task_followups::{
    admit_task_followup, inspect_task_followup_receipt, load_task_followup_receipt,
    TaskFollowupAction, TaskFollowupError, TaskFollowupReceipt, TaskFollowupRequest,
};
pub use task_launches::{
    list_task_launches, load_project_git_source, load_task_launch, reconcile_task_launches,
    reserve_task_launch, update_task_launch, TaskLaunchPhase, TaskLaunchRecord, TaskLaunchRequest,
    TaskLaunchSource, TaskModelSelection,
};
pub use terminal_cleanups::*;
pub use terminal_selection::*;
pub use thread_events::*;
pub use traditional_children::*;
pub use transcript::*;
pub use transcript_append::{TranscriptAppendError, TranscriptAppendReceipt};
pub use workspace_revisions::*;

#[cfg(test)]
pub(crate) use schema::{
    initialize_synthetic_predecessor, track_connection_opens, tracked_connection_opens,
};
pub(crate) use schema::{
    open_connection, open_initialized_read_connection, open_probe_read_connection,
    open_runtime_connection, StoreConnection,
};
pub(crate) use thread_events::load_all_thread_events_with_connection;
pub(crate) use time::now_utc;

#[cfg(test)]
pub(crate) fn insert_test_session(path: &Path, session_id: &str) {
    let conn = open_runtime_connection(path).unwrap();
    conn.execute(
        "INSERT INTO sessions
             (session_id, behavior, cwd, store_path, model, base_url, messages_json,
              created_at, updated_at)
         VALUES (?1, 'direct', '/tmp/project', '/tmp/store.db', 'test-model',
                 'https://example.invalid', '[]', ?2, ?2)",
        params![session_id, now_utc()],
    )
    .unwrap();
}

pub fn is_sqlite_busy(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        matches!(
            cause.downcast_ref::<rusqlite::Error>(),
            Some(rusqlite::Error::SqliteFailure(code, _))
                if matches!(
                    code.code,
                    rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
                )
        )
    })
}

#[cfg(any(test, feature = "test-support"))]
pub fn set_test_schema_version(path: &Path, version: i64) -> Result<()> {
    let connection = Connection::open(path)?;
    connection.pragma_update(None, "user_version", version)?;
    Ok(())
}

/// Retry a store write that hit SQLITE_BUSY / SQLITE_LOCKED. `busy_timeout`
/// already waits on BUSY; LOCKED (and a BUSY that outlived the timeout)
/// still needs a short outer retry, which session create and steering share.
pub fn retry_busy<T>(operation: impl FnMut() -> Result<T>) -> Result<T> {
    retry_busy_correlated(crate::telemetry::Correlation::default(), operation)
}

pub fn retry_busy_correlated<T>(
    correlation: crate::telemetry::Correlation,
    mut operation: impl FnMut() -> Result<T>,
) -> Result<T> {
    const RETRY_DELAYS: [std::time::Duration; 4] = [
        std::time::Duration::from_millis(20),
        std::time::Duration::from_millis(50),
        std::time::Duration::from_millis(100),
        std::time::Duration::from_millis(200),
    ];
    let started = std::time::Instant::now();
    let mut attempts = 0_u64;
    for delay in RETRY_DELAYS {
        match operation() {
            Err(error) if is_sqlite_busy(&error) => {
                attempts = attempts.saturating_add(1);
                crate::telemetry::emit_store_duration(
                    crate::telemetry::StoreOperation::Retry,
                    correlation.clone(),
                    started.elapsed(),
                    crate::telemetry::TelemetryOutcome::Conflict,
                    crate::telemetry::store_error_identity(error.as_ref()),
                );
                std::thread::sleep(delay);
            }
            result => {
                if attempts > 0 {
                    crate::telemetry::emit_store_duration(
                        crate::telemetry::StoreOperation::Retry,
                        correlation,
                        started.elapsed(),
                        if result.is_ok() {
                            crate::telemetry::TelemetryOutcome::Ok
                        } else {
                            crate::telemetry::TelemetryOutcome::Error
                        },
                        result.as_ref().err().and_then(|error| {
                            crate::telemetry::store_error_identity(error.as_ref())
                        }),
                    );
                }
                return result;
            }
        }
    }
    let result = operation();
    crate::telemetry::emit_store_duration(
        crate::telemetry::StoreOperation::Retry,
        correlation,
        started.elapsed(),
        if result.is_ok() {
            crate::telemetry::TelemetryOutcome::Ok
        } else {
            crate::telemetry::TelemetryOutcome::Error
        },
        result
            .as_ref()
            .err()
            .and_then(|error| crate::telemetry::store_error_identity(error.as_ref())),
    );
    result
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadRecord {
    pub name: String,
    pub session_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub episode_count: i64,
    pub latest_action: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadEventRecord {
    pub id: i64,
    pub thread_name: String,
    pub session_id: String,
    pub event_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetItemRecord {
    pub position: i64,
    pub title: String,
    pub scope: String,
    pub description: String,
    pub role: String,
    pub depends_on: Vec<String>,
    pub acceptance: String,
    pub notes: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetRecord {
    pub id: String,
    pub session_id: String,
    pub goal: String,
    pub status: String,
    pub summary: String,
    pub verification_recipe: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub items: Vec<WorksetItemRecord>,
}

#[cfg(test)]
pub(crate) use blocking_caller::reject_callers_for_test;

mod transcript_selection;
pub use transcript_selection::{
    copy_terminal_selection_attributions, load_terminal_selection_references,
    TerminalSelectionAttribution, TerminalSelectionEvidence, TerminalSelectionReference,
};
pub(crate) use transcript_selection::{
    load_terminal_selection_history_metadata, load_terminal_selection_provenance,
    TerminalSelectionProvenance,
};

#[cfg(test)]
pub(crate) use transcript_selection::seed_selection_provenance_history_for_test;

#[cfg(test)]
mod completion_occurrences_tests;
