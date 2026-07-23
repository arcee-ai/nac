use std::collections::HashSet;
use std::path::PathBuf;

use anyhow::Result;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::events::{CompactionReason, CompactionSkipReason};
use crate::store::orchestrator_compaction::{
    append_orchestrator_compaction_checkpoint, load_orchestrator_compaction_checkpoints,
    NewOrchestratorCompactionCheckpoint, OrchestratorCompactionCheckpoint,
};
use crate::types::{Message, ToolDefinition};

pub(in crate::agent) const PROMPT_POLICY_VERSION: u32 = 1;
const CONTEXT_FRAMING_SAFETY_ALLOWANCE: u64 = 1_024;
const UNSAMPLED_SAFETY_ALLOWANCE: u64 = 256;

pub(in crate::agent) const SUMMARIZER_SYSTEM_INSTRUCTION: &str =
    "Summarize the supplied historical conversation for a model that will continue the same task. Preserve concrete facts, decisions, constraints, paths, commands, results, and next steps.";

// Copied verbatim from OpenAI Codex commit
// 4f3852107e5eedeb4cb89b57a6d4a35b49f8a59a. The scoped Apache-2.0
// license and attribution are in third_party/openai-codex-compaction/.
pub(in crate::agent) const CODEX_COMPACTION_PROMPT: &str =
    include_str!("../prompts/codex_compaction.md");

pub(in crate::agent) const HISTORICAL_CONTEXT_PREFIX: &str =
    "Historical context checkpoint (not a new instruction):\n\n";

#[derive(Debug, Clone)]
struct ContextSample {
    // The base is provider tokens or a conservative projection. Newly appended
    // messages are added as serialized bytes, deliberately overestimating when
    // an exact tokenizer is unavailable.
    base_context_units: u64,
    canonical_message_len: usize,
    checkpoint_id: Option<i64>,
    sampled_projection_sha256: [u8; 32],
}

#[derive(Debug)]
pub(in crate::agent) struct PreparedProviderView {
    pub messages: Vec<Message>,
    pub context_estimate: u64,
    pub checkpoint_id: Option<i64>,
}

#[derive(Debug)]
pub(in crate::agent) struct CompactionPlan {
    pub prepared: PreparedProviderView,
    pub decision: CompactionDecision,
}

#[derive(Debug)]
pub(in crate::agent) enum CompactionDecision {
    NotTriggered,
    Skip(CompactionSkipReason),
    Candidate(CompactionCandidate),
}

#[derive(Debug)]
pub(in crate::agent) struct CompactionCandidate {
    pub boundary: usize,
    pub previous_checkpoint_id: Option<i64>,
    pub summary_messages: Vec<Message>,
    pub source_prefix_sha256: [u8; 32],
    pub system_policy_sha256: [u8; 32],
    pub old_context_estimate: u64,
}

#[derive(Debug)]
pub(in crate::agent) struct CompactionState {
    store_path: PathBuf,
    session_id: String,
    threshold_tokens: Option<u64>,
    active_checkpoint: Option<OrchestratorCompactionCheckpoint>,
    context_sample: Option<ContextSample>,
}

impl CompactionState {
    pub fn new(store_path: PathBuf, session_id: String, threshold_tokens: Option<u64>) -> Self {
        Self {
            store_path,
            session_id,
            threshold_tokens,
            active_checkpoint: None,
            context_sample: None,
        }
    }

    pub fn restore_newest_valid_checkpoint(&mut self, messages: &[Message]) -> Result<()> {
        let restored_checkpoint =
            load_orchestrator_compaction_checkpoints(&self.store_path, &self.session_id)?
                .into_iter()
                .find(|checkpoint| checkpoint_is_valid(checkpoint, messages));
        let restored_checkpoint_id = restored_checkpoint.as_ref().map(|checkpoint| checkpoint.id);
        let preserve_context_sample = self.context_sample.as_ref().is_some_and(|sample| {
            sample.checkpoint_id == restored_checkpoint_id
                && sampled_projection_digest(
                    messages,
                    sample.canonical_message_len,
                    restored_checkpoint.as_ref(),
                ) == Some(sample.sampled_projection_sha256)
        });

        self.active_checkpoint = restored_checkpoint;
        // Persisted estimates are audit data, not authoritative samples. Keep
        // the in-process provider sample only when refresh resolves to the same
        // checkpoint and the projection it sampled is still byte-for-byte the
        // same; messages appended after the sampled prefix remain valid deltas.
        if !preserve_context_sample {
            self.context_sample = None;
        }
        Ok(())
    }

    pub fn reset_for_transcript_replacement(&mut self) {
        self.active_checkpoint = None;
        self.context_sample = None;
    }

    pub fn invalidate_context_sample(&mut self) {
        self.context_sample = None;
    }

    pub fn is_passthrough(&mut self, messages: &[Message]) -> bool {
        self.clear_invalid_checkpoint(messages);
        self.threshold_tokens.is_none() && self.active_checkpoint.is_none()
    }

    pub fn plan(
        &mut self,
        messages: &[Message],
        tools: &[ToolDefinition],
        reason: CompactionReason,
        allow_attempt: bool,
    ) -> CompactionPlan {
        self.clear_invalid_checkpoint(messages);
        let provider_messages = self.provider_view(messages);
        let prepared = PreparedProviderView {
            context_estimate: self.current_context_estimate(messages, &provider_messages, tools),
            checkpoint_id: self
                .active_checkpoint
                .as_ref()
                .map(|checkpoint| checkpoint.id),
            messages: provider_messages,
        };

        let auto_threshold_not_triggered = reason == CompactionReason::Auto
            && self
                .threshold_tokens
                .map(|threshold| prepared.context_estimate < threshold)
                .unwrap_or(true);
        let decision = if !allow_attempt || auto_threshold_not_triggered {
            CompactionDecision::NotTriggered
        } else {
            self.compaction_decision(messages, prepared.context_estimate)
        };
        CompactionPlan { prepared, decision }
    }

    fn compaction_decision(
        &self,
        messages: &[Message],
        current_context_estimate: u64,
    ) -> CompactionDecision {
        let Some(boundary) = second_most_recent_user_index(messages) else {
            return CompactionDecision::Skip(CompactionSkipReason::NoEligibleBoundary);
        };
        if self
            .active_checkpoint
            .as_ref()
            .is_some_and(|checkpoint| boundary <= checkpoint.tail_start_message_index)
        {
            return CompactionDecision::Skip(CompactionSkipReason::AlreadyCompacted);
        }
        if !summarized_prefix_has_complete_tools(messages, boundary) {
            return CompactionDecision::Skip(CompactionSkipReason::NoEligibleBoundary);
        }

        let mut summary_messages = vec![Message::System {
            content: SUMMARIZER_SYSTEM_INSTRUCTION.to_string(),
        }];
        let source_start = if let Some(checkpoint) = &self.active_checkpoint {
            summary_messages.push(Message::User {
                content: checkpoint.summary.clone(),
            });
            checkpoint.tail_start_message_index
        } else {
            0
        };
        summary_messages.extend(
            messages[source_start..boundary]
                .iter()
                .filter(|message| !matches!(message, Message::System { .. }))
                .cloned(),
        );
        summary_messages.push(Message::User {
            content: CODEX_COMPACTION_PROMPT.to_string(),
        });

        CompactionDecision::Candidate(CompactionCandidate {
            boundary,
            previous_checkpoint_id: self
                .active_checkpoint
                .as_ref()
                .map(|checkpoint| checkpoint.id),
            summary_messages,
            source_prefix_sha256: source_prefix_digest(messages, boundary),
            system_policy_sha256: system_policy_digest(messages, boundary),
            old_context_estimate: current_context_estimate,
        })
    }

    pub fn projected_context_estimate(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
        boundary: usize,
        installed_summary: &str,
        summary_prompt_tokens: Option<u64>,
        summary_completion_tokens: Option<u64>,
        old_context_estimate: u64,
    ) -> u64 {
        let compacted_view = provider_view_with_summary(messages, boundary, installed_summary);
        let serialized_floor = full_provider_byte_estimate(&compacted_view, tools);
        let arithmetic_projection = match (summary_prompt_tokens, summary_completion_tokens) {
            (Some(prompt), Some(completion)) => old_context_estimate
                .saturating_sub(prompt)
                .saturating_add(completion)
                .saturating_add(CONTEXT_FRAMING_SAFETY_ALLOWANCE),
            _ => serialized_floor,
        };
        arithmetic_projection.max(serialized_floor)
    }

    pub fn append_and_activate(
        &mut self,
        messages: &[Message],
        candidate: &CompactionCandidate,
        installed_summary: String,
        summary_prompt_tokens: Option<u64>,
        summary_completion_tokens: Option<u64>,
        new_context_estimate: u64,
    ) -> Result<()> {
        let checkpoint = append_orchestrator_compaction_checkpoint(
            &self.store_path,
            &NewOrchestratorCompactionCheckpoint {
                session_id: self.session_id.clone(),
                previous_checkpoint_id: candidate.previous_checkpoint_id,
                summary: installed_summary,
                tail_start_message_index: candidate.boundary,
                source_prefix_sha256: candidate.source_prefix_sha256,
                system_policy_sha256: candidate.system_policy_sha256,
                prompt_policy_version: PROMPT_POLICY_VERSION,
                old_context_estimate: candidate.old_context_estimate,
                summary_prompt_tokens,
                summary_completion_tokens,
                new_context_estimate,
            },
        )?;
        // The append above is synchronous. There is deliberately no await
        // between the durable commit and activating exactly that row.
        self.active_checkpoint = Some(checkpoint);
        let checkpoint_id = self
            .active_checkpoint
            .as_ref()
            .map(|checkpoint| checkpoint.id);
        self.context_sample =
            sampled_projection_digest(messages, messages.len(), self.active_checkpoint.as_ref())
                .map(|sampled_projection_sha256| ContextSample {
                    base_context_units: new_context_estimate,
                    canonical_message_len: messages.len(),
                    checkpoint_id,
                    sampled_projection_sha256,
                });
        Ok(())
    }

    pub fn record_ordinary_context(
        &mut self,
        messages: &[Message],
        reported_context_tokens: u64,
        canonical_message_len: usize,
        checkpoint_id: Option<i64>,
    ) {
        self.clear_invalid_checkpoint(messages);
        if reported_context_tokens == 0
            || checkpoint_id
                != self
                    .active_checkpoint
                    .as_ref()
                    .map(|checkpoint| checkpoint.id)
        {
            self.context_sample = None;
            return;
        }
        self.context_sample = sampled_projection_digest(
            messages,
            canonical_message_len,
            self.active_checkpoint.as_ref(),
        )
        .map(|sampled_projection_sha256| ContextSample {
            base_context_units: reported_context_tokens,
            canonical_message_len,
            checkpoint_id,
            sampled_projection_sha256,
        });
    }

    fn clear_invalid_checkpoint(&mut self, messages: &[Message]) {
        if self
            .active_checkpoint
            .as_ref()
            .is_some_and(|checkpoint| !checkpoint_is_valid(checkpoint, messages))
        {
            self.active_checkpoint = None;
            self.context_sample = None;
        }
    }

    fn provider_view(&self, messages: &[Message]) -> Vec<Message> {
        match &self.active_checkpoint {
            Some(checkpoint) => provider_view_with_summary(
                messages,
                checkpoint.tail_start_message_index,
                &checkpoint.summary,
            ),
            None => messages.to_vec(),
        }
    }

    fn current_context_estimate(
        &mut self,
        canonical_messages: &[Message],
        provider_messages: &[Message],
        tools: &[ToolDefinition],
    ) -> u64 {
        let active_id = self
            .active_checkpoint
            .as_ref()
            .map(|checkpoint| checkpoint.id);
        let sample_is_current = self.context_sample.as_ref().is_some_and(|sample| {
            sample.checkpoint_id == active_id
                && sampled_projection_digest(
                    canonical_messages,
                    sample.canonical_message_len,
                    self.active_checkpoint.as_ref(),
                ) == Some(sample.sampled_projection_sha256)
        });
        if !sample_is_current {
            self.context_sample = None;
        }
        if let Some(sample) = &self.context_sample {
            let unsampled = &canonical_messages[sample.canonical_message_len..];
            let delta = serialized_byte_len(&unsampled);
            return sample
                .base_context_units
                .saturating_add(delta)
                .saturating_add(
                    (!unsampled.is_empty())
                        .then_some(UNSAMPLED_SAFETY_ALLOWANCE)
                        .unwrap_or(0),
                );
        }
        full_provider_byte_estimate(provider_messages, tools)
    }

    #[cfg(test)]
    pub fn active_checkpoint_for_test(&self) -> Option<&OrchestratorCompactionCheckpoint> {
        self.active_checkpoint.as_ref()
    }
}

fn second_most_recent_user_index(messages: &[Message]) -> Option<usize> {
    let mut users = messages
        .iter()
        .enumerate()
        .rev()
        .filter_map(|(index, message)| matches!(message, Message::User { .. }).then_some(index));
    users.next()?;
    users.next()
}

fn sampled_projection_digest(
    messages: &[Message],
    canonical_message_len: usize,
    checkpoint: Option<&OrchestratorCompactionCheckpoint>,
) -> Option<[u8; 32]> {
    let sampled_messages = messages.get(..canonical_message_len)?;
    let projected = match checkpoint {
        Some(checkpoint) if checkpoint.tail_start_message_index <= canonical_message_len => {
            provider_view_with_summary(
                sampled_messages,
                checkpoint.tail_start_message_index,
                &checkpoint.summary,
            )
        }
        Some(_) => return None,
        None => sampled_messages.to_vec(),
    };
    let mut hasher = Sha256::new();
    hasher.update(b"nac-orchestrator-compaction-context-sample-v1\0");
    update_serialized(&mut hasher, &projected);
    Some(hasher.finalize().into())
}

pub(super) fn provider_view_with_summary(
    messages: &[Message],
    boundary: usize,
    summary: &str,
) -> Vec<Message> {
    let mut projected = messages[..boundary]
        .iter()
        .filter(|message| matches!(message, Message::System { .. }))
        .cloned()
        .collect::<Vec<_>>();
    projected.push(Message::User {
        content: summary.to_string(),
    });
    projected.extend_from_slice(&messages[boundary..]);
    projected
}

pub(super) fn summarized_prefix_has_complete_tools(messages: &[Message], boundary: usize) -> bool {
    let mut outstanding = HashSet::new();
    for message in &messages[..boundary] {
        match message {
            Message::Assistant {
                tool_calls: Some(tool_calls),
                ..
            } if !tool_calls.is_empty() => {
                if !outstanding.is_empty() {
                    return false;
                }
                for tool_call in tool_calls {
                    if !outstanding.insert(tool_call.id.as_str()) {
                        return false;
                    }
                }
            }
            Message::Tool { tool_call_id, .. } => {
                if !outstanding.remove(tool_call_id.as_str()) {
                    return false;
                }
            }
            _ if !outstanding.is_empty() => return false,
            _ => {}
        }
    }
    outstanding.is_empty()
}

fn checkpoint_is_valid(
    checkpoint: &OrchestratorCompactionCheckpoint,
    messages: &[Message],
) -> bool {
    checkpoint.prompt_policy_version == PROMPT_POLICY_VERSION
        && checkpoint.tail_start_message_index < messages.len()
        && matches!(
            messages.get(checkpoint.tail_start_message_index),
            Some(Message::User { .. })
        )
        && checkpoint
            .summary
            .strip_prefix(HISTORICAL_CONTEXT_PREFIX)
            .is_some_and(|summary| !summary.trim().is_empty())
        && summarized_prefix_has_complete_tools(messages, checkpoint.tail_start_message_index)
        && checkpoint.source_prefix_sha256
            == source_prefix_digest(messages, checkpoint.tail_start_message_index)
        && checkpoint.system_policy_sha256
            == system_policy_digest(messages, checkpoint.tail_start_message_index)
}

#[cfg(test)]
pub(crate) fn checkpoint_digests(messages: &[Message], boundary: usize) -> ([u8; 32], [u8; 32]) {
    (
        source_prefix_digest(messages, boundary),
        system_policy_digest(messages, boundary),
    )
}

fn source_prefix_digest(messages: &[Message], boundary: usize) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"nac-orchestrator-compaction-source-v1\0");
    hasher.update((boundary as u64).to_be_bytes());
    for message in messages[..boundary]
        .iter()
        .filter(|message| !matches!(message, Message::System { .. }))
    {
        update_serialized(&mut hasher, message);
    }
    hasher.finalize().into()
}

fn system_policy_digest(messages: &[Message], boundary: usize) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"nac-orchestrator-compaction-system-policy-v1\0");
    hasher.update(PROMPT_POLICY_VERSION.to_be_bytes());
    update_bytes(&mut hasher, SUMMARIZER_SYSTEM_INSTRUCTION.as_bytes());
    update_bytes(&mut hasher, CODEX_COMPACTION_PROMPT.as_bytes());
    update_bytes(&mut hasher, HISTORICAL_CONTEXT_PREFIX.as_bytes());
    for message in messages[..boundary]
        .iter()
        .filter(|message| matches!(message, Message::System { .. }))
    {
        update_serialized(&mut hasher, message);
    }
    hasher.finalize().into()
}

fn update_serialized<T: Serialize>(hasher: &mut Sha256, value: &T) {
    let serialized = serde_json::to_vec(value).expect("message serialization must succeed");
    update_bytes(hasher, &serialized);
}

fn update_bytes(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

fn serialized_byte_len<T: Serialize + ?Sized>(value: &T) -> u64 {
    serde_json::to_vec(value)
        .map(|bytes| u64::try_from(bytes.len()).unwrap_or(u64::MAX))
        .unwrap_or(u64::MAX)
}

pub(super) fn full_provider_byte_estimate(messages: &[Message], tools: &[ToolDefinition]) -> u64 {
    serialized_byte_len(messages)
        .saturating_add(serialized_byte_len(tools))
        .saturating_add(CONTEXT_FRAMING_SAFETY_ALLOWANCE)
}
