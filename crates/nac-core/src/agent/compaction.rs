use crate::events::{
    AgentEvent, CompactionFailure, CompactionReason, CompactionSkipReason, EventSink,
};
use crate::model::TokenUsage;
use uuid::Uuid;

mod planning;

use planning::*;
#[cfg(test)]
pub(crate) use planning::{checkpoint_digests, checkpoint_digests_for_policy};
pub(super) use planning::{
    CompactionPolicy, CompactionState, PreparedProviderView, HISTORICAL_CONTEXT_PREFIX,
};
#[cfg(test)]
pub(super) use planning::{
    DIRECT_PROMPT_POLICY_VERSION, NAC_COMPACTION_PROMPT, NAC_DIRECT_COMPACTION_PROMPT,
    PROMPT_POLICY_VERSION,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompactionResult {
    Compacted {
        compaction_id: Uuid,
        projected_context: u64,
    },
    Unchanged {
        compaction_id: Uuid,
        reason: CompactionSkipReason,
    },
}

#[derive(Debug)]
pub enum CompactionError {
    Unavailable,
    Failed {
        compaction_id: Uuid,
        failure: CompactionFailure,
        source: Option<anyhow::Error>,
    },
}

impl CompactionError {
    pub fn compaction_id(&self) -> Option<Uuid> {
        match self {
            Self::Unavailable => None,
            Self::Failed { compaction_id, .. } => Some(*compaction_id),
        }
    }

    pub fn failure(&self) -> Option<CompactionFailure> {
        match self {
            Self::Unavailable => None,
            Self::Failed { failure, .. } => Some(*failure),
        }
    }

    fn failed(
        compaction_id: Uuid,
        failure: CompactionFailure,
        source: Option<anyhow::Error>,
    ) -> Self {
        Self::Failed {
            compaction_id,
            failure,
            source,
        }
    }
}

impl std::fmt::Display for CompactionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable => formatter.write_str("compaction is unavailable for this agent"),
            Self::Failed {
                compaction_id,
                failure,
                source,
            } => {
                write!(formatter, "compaction {compaction_id} failed: {failure:?}")?;
                if let Some(source) = source {
                    write!(formatter, ": {source:#}")?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for CompactionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Failed {
                source: Some(source),
                ..
            } => Some(source.as_ref()),
            _ => None,
        }
    }
}

pub(crate) type CompactionCompletion = std::result::Result<CompactionResult, CompactionError>;

pub(crate) struct CompactionLifecycle {
    event_sink: EventSink,
    compaction_id: Uuid,
    reason: CompactionReason,
    terminal_emitted: bool,
}

impl CompactionLifecycle {
    pub(crate) fn start(
        event_sink: EventSink,
        compaction_id: Uuid,
        reason: CompactionReason,
    ) -> Self {
        event_sink.emit(AgentEvent::OrchestratorCompactionStarted {
            compaction_id,
            reason,
        });
        Self {
            event_sink,
            compaction_id,
            reason,
            terminal_emitted: false,
        }
    }

    pub(crate) fn finish(&mut self, result: &CompactionCompletion) {
        let event = match result {
            Ok(CompactionResult::Compacted { .. }) => AgentEvent::OrchestratorCompactionCompleted {
                compaction_id: self.compaction_id,
                reason: self.reason,
            },
            Ok(CompactionResult::Unchanged { reason: cause, .. }) => {
                AgentEvent::OrchestratorCompactionSkipped {
                    compaction_id: self.compaction_id,
                    reason: self.reason,
                    cause: *cause,
                }
            }
            Err(error) => {
                debug_assert!(
                    error
                        .compaction_id()
                        .map(|compaction_id| compaction_id == self.compaction_id)
                        .unwrap_or(true),
                    "compaction lifecycle and result IDs differ"
                );
                AgentEvent::OrchestratorCompactionFailed {
                    compaction_id: self.compaction_id,
                    reason: self.reason,
                    failure: error.failure().unwrap_or(CompactionFailure::Cancelled),
                }
            }
        };
        self.terminal_emitted = true;
        self.event_sink.emit(event);
    }
}

impl Drop for CompactionLifecycle {
    fn drop(&mut self) {
        if !self.terminal_emitted {
            self.terminal_emitted = true;
            self.event_sink
                .emit(AgentEvent::OrchestratorCompactionFailed {
                    compaction_id: self.compaction_id,
                    reason: self.reason,
                    failure: CompactionFailure::Cancelled,
                });
        }
    }
}

impl super::Agent {
    /// Force one standalone compaction attempt without entering the ordinary
    /// send, tool, backend-readiness, or steering paths.
    #[cfg(test)]
    pub async fn compact(&mut self) -> CompactionCompletion {
        if self.compaction.is_none() {
            return Err(CompactionError::Unavailable);
        }
        let compaction_id = Uuid::new_v4();
        let event_sink = self.event_sink.clone();
        let mut lifecycle =
            CompactionLifecycle::start(event_sink.clone(), compaction_id, CompactionReason::Manual);
        let result = self.compact_inner(compaction_id, event_sink).await;
        lifecycle.finish(&result);
        result
    }

    pub(crate) async fn compact_for_session(
        &mut self,
        compaction_id: Uuid,
        event_sink: EventSink,
    ) -> CompactionCompletion {
        self.compact_inner(compaction_id, event_sink).await
    }

    async fn compact_inner(
        &mut self,
        compaction_id: Uuid,
        event_sink: EventSink,
    ) -> CompactionCompletion {
        let Some(compaction) = self.compaction.as_mut() else {
            return Err(CompactionError::Unavailable);
        };
        let plan = compaction.plan(&self.messages, &self.tool_defs, CompactionReason::Manual);
        let CompactionPlan { prepared, decision } = plan;
        let (_, result) = self
            .execute_triggered_compaction(compaction_id, prepared, decision, None, event_sink)
            .await;
        result
    }

    #[expect(
        clippy::expect_used,
        reason = "this path is selected only when the agent owns compaction state"
    )]
    pub(super) async fn prepare_provider_view(
        &mut self,
        accumulated_usage: &mut TokenUsage,
        tool_defs: &[crate::types::ToolDefinition],
    ) -> PreparedProviderView {
        let plan = self
            .compaction
            .as_mut()
            .expect("compaction state exists")
            .plan(&self.messages, tool_defs, CompactionReason::Auto);
        let CompactionPlan { prepared, decision } = plan;
        if matches!(decision, CompactionDecision::NotTriggered) {
            return prepared;
        }

        let compaction_id = Uuid::new_v4();
        let event_sink = self.event_sink.clone();
        let mut lifecycle =
            CompactionLifecycle::start(event_sink.clone(), compaction_id, CompactionReason::Auto);
        let (prepared, result) = self
            .execute_triggered_compaction(
                compaction_id,
                prepared,
                decision,
                Some(accumulated_usage),
                event_sink,
            )
            .await;
        lifecycle.finish(&result);
        if let Err(error) = result {
            eprintln!("nac: orchestrator compaction failed softly: {error}");
        }
        prepared
    }

    #[expect(
        clippy::expect_used,
        reason = "a triggered compaction retains the state that produced its candidate through activation"
    )]
    async fn execute_triggered_compaction(
        &mut self,
        compaction_id: Uuid,
        prepared: PreparedProviderView,
        decision: CompactionDecision,
        accumulated_usage: Option<&mut TokenUsage>,
        event_sink: EventSink,
    ) -> (PreparedProviderView, CompactionCompletion) {
        let mut candidate = match decision {
            CompactionDecision::Skip(cause) => {
                return (
                    prepared,
                    Ok(CompactionResult::Unchanged {
                        compaction_id,
                        reason: cause,
                    }),
                );
            }
            CompactionDecision::Candidate(candidate) => candidate,
            CompactionDecision::NotTriggered => {
                unreachable!("not-triggered decisions are handled before lifecycle start")
            }
        };

        let summary_messages = std::mem::take(&mut candidate.summary_messages);
        let response = match self.client.send_turn(summary_messages, Vec::new()).await {
            Ok(response) => response,
            Err(error) => {
                return (
                    prepared,
                    Err(CompactionError::failed(
                        compaction_id,
                        CompactionFailure::SummaryRequestFailed,
                        Some(error),
                    )),
                );
            }
        };
        let summary_usage = response.usage.clone();
        let Some(content) = accepted_summary_content(&response) else {
            self.account_summary_usage(
                &event_sink,
                accumulated_usage,
                summary_usage.as_ref(),
                summary_usage
                    .as_ref()
                    .map(|_| candidate.old_context_estimate),
            );
            return (
                prepared,
                Err(CompactionError::failed(
                    compaction_id,
                    CompactionFailure::SummaryRejected,
                    None,
                )),
            );
        };

        let installed = installed_summary(content);
        let summary_prompt_tokens = summary_usage.as_ref().and_then(full_summary_prompt_tokens);
        let summary_completion_tokens = summary_usage.as_ref().map(|usage| usage.output_tokens);
        let projected = self
            .compaction
            .as_ref()
            .expect("compaction state exists for a triggered attempt")
            .projected_context_estimate(
                &self.messages,
                summary_prompt_tokens.unwrap_or(0),
                summary_completion_tokens.unwrap_or(0),
                candidate.old_context_estimate,
            );

        if let Err(error) = self
            .compaction
            .as_mut()
            .expect("compaction state exists for a triggered attempt")
            .append_and_activate(
                &self.messages,
                &candidate,
                installed,
                summary_prompt_tokens,
                summary_completion_tokens,
                projected,
            )
        {
            self.account_summary_usage(
                &event_sink,
                accumulated_usage,
                summary_usage.as_ref(),
                summary_usage
                    .as_ref()
                    .map(|_| candidate.old_context_estimate),
            );
            return (
                prepared,
                Err(CompactionError::failed(
                    compaction_id,
                    CompactionFailure::CheckpointPersistenceFailed,
                    Some(error),
                )),
            );
        }

        // Checkpoint commit, exact activation, and usage accounting are
        // synchronous. The caller publishes completion before releasing its
        // operation lease.
        self.account_summary_usage(
            &event_sink,
            accumulated_usage,
            summary_usage.as_ref(),
            Some(projected),
        );
        let prepared = self
            .compaction
            .as_mut()
            .expect("compaction state exists after activation")
            .prepare(&self.messages, &self.tool_defs);
        (
            prepared,
            Ok(CompactionResult::Compacted {
                compaction_id,
                projected_context: projected,
            }),
        )
    }

    fn account_summary_usage(
        &mut self,
        event_sink: &EventSink,
        mut accumulated_usage: Option<&mut TokenUsage>,
        usage: Option<&TokenUsage>,
        installed_context: Option<u64>,
    ) {
        if let Some(usage) = usage {
            if let Some(accumulated_usage) = accumulated_usage.as_mut() {
                accumulated_usage.add_cost_saturating(usage);
            }

            let mut delta = usage.clone();
            delta.replace_context(installed_context.unwrap_or_default());
            event_sink.emit(AgentEvent::TokenUsageUpdated {
                thread_name: self.thread_name.clone(),
                usage: delta,
            });
        }
        if let (Some(context), Some(accumulated_usage)) = (installed_context, accumulated_usage) {
            accumulated_usage.replace_context(context);
            self.last_usage = Some(accumulated_usage.clone());
        }
    }
}

pub(super) fn accepted_summary_content(response: &crate::model::ModelTurnResponse) -> Option<&str> {
    response.assistant.content.as_deref().filter(|content| {
        !content.trim().is_empty()
            && response
                .assistant
                .tool_calls
                .as_ref()
                .map(Vec::is_empty)
                .unwrap_or(true)
            && response.finish_reason.as_deref() != Some("length")
    })
}

pub(super) fn installed_summary(summary: &str) -> String {
    format!("{HISTORICAL_CONTEXT_PREFIX}{summary}")
}

pub(super) fn full_summary_prompt_tokens(usage: &crate::model::TokenUsage) -> Option<u64> {
    usage
        .input_tokens
        .checked_add(usage.cache_read_tokens)?
        .checked_add(usage.cache_write_tokens)
}

#[cfg(test)]
mod tests;
