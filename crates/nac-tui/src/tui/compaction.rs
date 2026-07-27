use super::*;
use nac_core::events::{CompactionFailure, CompactionReason, CompactionSkipReason};
use nac_core::session_service::{
    SessionCompactionAdmissionError, SessionCompactionError, SessionCompactionResult,
};

#[derive(Debug)]
pub(super) struct ManualCompactionCompletion {
    pub(super) compaction_id: String,
    pub(super) result: std::result::Result<SessionCompactionResult, SessionCompactionError>,
}

pub(super) fn start_manual_compaction(
    service: &SessionService,
    app: &mut App,
    completion_tx: mpsc::UnboundedSender<ManualCompactionCompletion>,
) {
    match service.try_compact() {
        Ok(handle) => {
            let compaction_id = handle.compaction_id.to_string();
            app.note_manual_compaction_admitted(compaction_id.clone());
            app.clear_composer();
            tokio::spawn(async move {
                let result = handle.wait().await;
                let _ = completion_tx.send(ManualCompactionCompletion {
                    compaction_id,
                    result,
                });
            });
        }
        Err(error) => {
            let (message, tone) = manual_compaction_admission_notice(&error);
            app.show_composer_notice(message, tone);
        }
    }
}

pub(super) fn finish_manual_compaction(app: &mut App, completion: ManualCompactionCompletion) {
    app.note_manual_compaction_finished(&completion.compaction_id);
    let (message, tone) = manual_compaction_notice(&completion.result);
    app.show_composer_notice(message, tone);
}

fn manual_compaction_admission_notice(
    error: &SessionCompactionAdmissionError,
) -> (&'static str, Tone) {
    match error {
        SessionCompactionAdmissionError::Busy { .. }
        | SessionCompactionAdmissionError::ExternalBusy { .. } => (
            "session is busy; wait for the current operation",
            Tone::Warning,
        ),
        SessionCompactionAdmissionError::Coordination { .. } => {
            ("Context compaction could not start", Tone::Error)
        }
        SessionCompactionAdmissionError::Unavailable => {
            ("Context compaction is unavailable", Tone::Warning)
        }
    }
}

fn manual_compaction_notice(
    result: &std::result::Result<SessionCompactionResult, SessionCompactionError>,
) -> (&'static str, Tone) {
    match result {
        Ok(SessionCompactionResult::Compacted { .. }) => ("Context compacted", Tone::Success),
        Ok(SessionCompactionResult::Unchanged { .. }) => ("Nothing new to compact", Tone::Info),
        Err(SessionCompactionError::Unavailable) => {
            ("Context compaction is unavailable", Tone::Warning)
        }
        Err(SessionCompactionError::Failed { .. }) => ("Context compaction failed", Tone::Error),
    }
}

pub(super) fn apply_compaction_event(app: &mut App, event: AgentEvent) {
    match event {
        AgentEvent::OrchestratorCompactionStarted {
            compaction_id,
            reason,
        } => {
            if reason == CompactionReason::Manual {
                app.note_manual_compaction_started(compaction_id.to_string());
            }
            app.push_timeline(
                "orchestrator",
                format!(
                    "context compaction • started • {}",
                    compaction_reason_label(reason)
                ),
                Tone::Info,
            );
        }
        AgentEvent::OrchestratorCompactionCompleted {
            compaction_id,
            reason,
        } => {
            if reason == CompactionReason::Manual {
                app.note_manual_compaction_terminal(&compaction_id.to_string());
            }
            app.push_timeline(
                "orchestrator",
                format!(
                    "context compaction • completed • {}",
                    compaction_reason_label(reason)
                ),
                Tone::Success,
            );
        }
        AgentEvent::OrchestratorCompactionSkipped {
            compaction_id,
            reason,
            cause,
        } => {
            if reason == CompactionReason::Manual {
                app.note_manual_compaction_terminal(&compaction_id.to_string());
            }
            app.push_timeline(
                "orchestrator",
                format!(
                    "context compaction • unchanged • {} • {}",
                    compaction_reason_label(reason),
                    compaction_skip_label(cause)
                ),
                Tone::Muted,
            );
        }
        AgentEvent::OrchestratorCompactionFailed {
            compaction_id,
            reason,
            failure,
        } => {
            if reason == CompactionReason::Manual {
                app.note_manual_compaction_terminal(&compaction_id.to_string());
            }
            app.push_timeline(
                "orchestrator",
                format!(
                    "context compaction • failed • {} • {}",
                    compaction_reason_label(reason),
                    compaction_failure_label(failure)
                ),
                Tone::Error,
            );
        }
        _ => unreachable!("non-compaction event passed to compaction handler"),
    }
}

fn compaction_reason_label(reason: CompactionReason) -> &'static str {
    match reason {
        CompactionReason::Auto => "automatic",
        CompactionReason::Manual => "manual",
    }
}

fn compaction_skip_label(reason: CompactionSkipReason) -> &'static str {
    match reason {
        CompactionSkipReason::NoEligibleBoundary => "no eligible boundary",
        CompactionSkipReason::AlreadyCompacted => "already compacted",
    }
}

fn compaction_failure_label(failure: CompactionFailure) -> &'static str {
    match failure {
        CompactionFailure::SummaryRequestFailed => "summary request failed",
        CompactionFailure::SummaryRejected => "summary rejected",
        CompactionFailure::CheckpointPersistenceFailed => "checkpoint persistence failed",
        CompactionFailure::Cancelled => "cancelled",
    }
}

impl App {
    pub(super) fn is_manual_compaction_active(&self) -> bool {
        self.active_manual_compaction_id.is_some()
    }

    pub(super) fn is_composer_busy(&self) -> bool {
        self.is_run_active() || self.is_manual_compaction_active()
    }

    pub(super) fn note_manual_compaction_admitted(&mut self, compaction_id: String) {
        self.active_manual_compaction_id = Some(compaction_id);
    }

    pub(super) fn note_manual_compaction_started(&mut self, compaction_id: String) {
        let operation_is_active = self
            .read_service
            .as_ref()
            .map(|service| {
                service
                    .active_compaction()
                    .is_some_and(|active| active.compaction_id.to_string() == compaction_id)
            })
            .unwrap_or(true);
        if operation_is_active {
            self.active_manual_compaction_id = Some(compaction_id);
        }
    }

    pub(super) fn note_manual_compaction_finished(&mut self, compaction_id: &str) {
        if self.active_manual_compaction_id.as_deref() == Some(compaction_id) {
            self.active_manual_compaction_id = None;
        }
    }

    pub(super) fn note_manual_compaction_terminal(&mut self, compaction_id: &str) {
        if self.read_service.is_some() {
            self.reconcile_manual_compaction_state();
        } else {
            self.note_manual_compaction_finished(compaction_id);
        }
    }

    pub(super) fn reconcile_manual_compaction_state(&mut self) {
        let Some(service) = self.read_service.as_ref() else {
            return;
        };
        self.active_manual_compaction_id = service
            .active_compaction()
            .map(|compaction| compaction.compaction_id.to_string());
    }
}

#[cfg(test)]
mod tests;
