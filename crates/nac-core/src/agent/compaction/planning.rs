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

pub(in crate::agent) const PROMPT_POLICY_VERSION: u32 = 2;
const CONTEXT_FRAMING_SAFETY_ALLOWANCE: u64 = 1_024;
const UNSAMPLED_SAFETY_ALLOWANCE: u64 = 256;

pub(in crate::agent) const NAC_COMPACTION_PROMPT: &str =
    include_str!("../prompts/nac_compaction.md");

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
    ) -> CompactionPlan {
        let prepared = self.prepare(messages, tools);
        let triggered = reason == CompactionReason::Manual
            || self
                .threshold_tokens
                .is_some_and(|threshold| prepared.context_estimate >= threshold);
        let decision = if triggered {
            self.compaction_decision(messages, prepared.context_estimate)
        } else {
            CompactionDecision::NotTriggered
        };
        CompactionPlan { prepared, decision }
    }

    pub fn prepare(
        &mut self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> PreparedProviderView {
        self.clear_invalid_checkpoint(messages);
        let provider_messages = self.provider_view(messages);
        PreparedProviderView {
            context_estimate: self.current_context_estimate(messages, &provider_messages, tools),
            checkpoint_id: self
                .active_checkpoint
                .as_ref()
                .map(|checkpoint| checkpoint.id),
            messages: provider_messages,
        }
    }

    fn compaction_decision(
        &self,
        messages: &[Message],
        current_context_estimate: u64,
    ) -> CompactionDecision {
        let source_start = self
            .active_checkpoint
            .as_ref()
            .map_or(0, |checkpoint| checkpoint.tail_start_message_index);
        let active_summary = self
            .active_checkpoint
            .as_ref()
            .map(|checkpoint| checkpoint.summary.as_str());

        match weighted_safe_boundary(messages, source_start, active_summary) {
            Ok(Some(boundary)) => self.candidate(messages, boundary, current_context_estimate),
            Ok(None) if self.active_checkpoint.is_some() => {
                CompactionDecision::Skip(CompactionSkipReason::AlreadyCompacted)
            }
            Ok(None) | Err(()) => {
                CompactionDecision::Skip(CompactionSkipReason::NoEligibleBoundary)
            }
        }
    }

    fn candidate(
        &self,
        messages: &[Message],
        boundary: usize,
        current_context_estimate: u64,
    ) -> CompactionDecision {
        let mut summary_messages = messages
            .iter()
            .filter(|message| matches!(message, Message::System { .. }))
            .cloned()
            .collect::<Vec<_>>();
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
            content: NAC_COMPACTION_PROMPT.to_string(),
        });

        CompactionDecision::Candidate(CompactionCandidate {
            boundary,
            previous_checkpoint_id: self
                .active_checkpoint
                .as_ref()
                .map(|checkpoint| checkpoint.id),
            summary_messages,
            source_prefix_sha256: source_prefix_digest(messages, boundary),
            system_policy_sha256: system_policy_digest(messages),
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
            (Some(prompt), Some(completion)) => {
                let non_source_allowance = summary_non_source_allowance(messages);
                let removable_source = prompt.saturating_sub(non_source_allowance);
                old_context_estimate
                    .saturating_sub(removable_source)
                    .saturating_add(completion)
                    .saturating_add(installed_summary_wrapper_allowance())
            }
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

pub(super) fn weighted_safe_boundary(
    messages: &[Message],
    source_start: usize,
    active_summary: Option<&str>,
) -> Result<Option<usize>, ()> {
    if source_start > messages.len() {
        return Err(());
    }

    let summary_weight = active_summary
        .map(|summary| {
            serialized_byte_len(&Message::User {
                content: summary.to_string(),
            })
        })
        .unwrap_or(0);
    let total_weight = messages[source_start..]
        .iter()
        .filter(|message| !matches!(message, Message::System { .. }))
        .fold(summary_weight, |weight, message| {
            weight.saturating_add(serialized_byte_len(message))
        });
    let target_weight = total_weight / 2 + total_weight % 2;

    let mut outstanding = HashSet::new();
    let mut reclaimed_weight = summary_weight;
    let mut includes_new_message = false;
    let mut selected = None;

    for (index, message) in messages.iter().enumerate() {
        if selected.is_none()
            && index > source_start
            && outstanding.is_empty()
            && includes_new_message
            && reclaimed_weight >= target_weight
            && matches!(message, Message::User { .. } | Message::Assistant { .. })
        {
            selected = Some(index);
        }

        match message {
            Message::User { .. } | Message::System { .. } => {
                if !outstanding.is_empty() {
                    return Err(());
                }
            }
            Message::Assistant { tool_calls, .. } => {
                if !outstanding.is_empty() {
                    return Err(());
                }
                if let Some(tool_calls) = tool_calls.as_ref().filter(|calls| !calls.is_empty()) {
                    outstanding.reserve(tool_calls.len());
                    for call in tool_calls {
                        if !outstanding.insert(call.id.as_str()) {
                            return Err(());
                        }
                    }
                }
            }
            Message::Tool { tool_call_id, .. } => {
                if !outstanding.remove(tool_call_id.as_str()) {
                    return Err(());
                }
            }
        }

        if index >= source_start && !matches!(message, Message::System { .. }) {
            reclaimed_weight = reclaimed_weight.saturating_add(serialized_byte_len(message));
            includes_new_message = true;
        }
    }

    if !outstanding.is_empty() {
        return Err(());
    }
    if selected.is_none()
        && messages.len() > source_start
        && includes_new_message
        && reclaimed_weight >= target_weight
    {
        selected = Some(messages.len());
    }
    Ok(selected)
}

fn transcript_has_complete_tools(messages: &[Message]) -> bool {
    weighted_safe_boundary(messages, messages.len(), None).is_ok()
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
    messages
        .get(..boundary)
        .is_some_and(transcript_has_complete_tools)
}

pub(super) fn checkpoint_boundary_is_valid(messages: &[Message], boundary: usize) -> bool {
    boundary == messages.len()
        || matches!(
            messages.get(boundary),
            Some(Message::User { .. } | Message::Assistant { .. })
        )
}

fn checkpoint_is_valid(
    checkpoint: &OrchestratorCompactionCheckpoint,
    messages: &[Message],
) -> bool {
    checkpoint.prompt_policy_version == PROMPT_POLICY_VERSION
        && checkpoint_boundary_is_valid(messages, checkpoint.tail_start_message_index)
        && checkpoint
            .summary
            .strip_prefix(HISTORICAL_CONTEXT_PREFIX)
            .is_some_and(|summary| !summary.trim().is_empty())
        && summarized_prefix_has_complete_tools(messages, checkpoint.tail_start_message_index)
        && checkpoint.source_prefix_sha256
            == source_prefix_digest(messages, checkpoint.tail_start_message_index)
        && checkpoint.system_policy_sha256 == system_policy_digest(messages)
}

#[cfg(test)]
pub(crate) fn checkpoint_digests(messages: &[Message], boundary: usize) -> ([u8; 32], [u8; 32]) {
    (
        source_prefix_digest(messages, boundary),
        system_policy_digest(messages),
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

fn system_policy_digest(messages: &[Message]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"nac-orchestrator-compaction-system-policy-v2\0");
    hasher.update(PROMPT_POLICY_VERSION.to_be_bytes());
    update_bytes(&mut hasher, NAC_COMPACTION_PROMPT.as_bytes());
    update_bytes(&mut hasher, HISTORICAL_CONTEXT_PREFIX.as_bytes());
    for message in messages
        .iter()
        .filter(|message| matches!(message, Message::System { .. }))
    {
        update_serialized(&mut hasher, message);
    }
    hasher.finalize().into()
}

pub(super) fn summary_non_source_allowance(messages: &[Message]) -> u64 {
    messages
        .iter()
        .filter(|message| matches!(message, Message::System { .. }))
        .map(serialized_byte_len)
        .fold(
            serialized_byte_len(&Message::User {
                content: NAC_COMPACTION_PROMPT.to_string(),
            })
            .saturating_add(CONTEXT_FRAMING_SAFETY_ALLOWANCE),
            u64::saturating_add,
        )
}

pub(super) fn installed_summary_wrapper_allowance() -> u64 {
    serialized_byte_len(&Message::User {
        content: HISTORICAL_CONTEXT_PREFIX.to_string(),
    })
}

fn update_serialized<T: Serialize>(hasher: &mut Sha256, value: &T) {
    let serialized = serde_json::to_vec(value).expect("message serialization must succeed");
    update_bytes(hasher, &serialized);
}

fn update_bytes(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

pub(super) fn serialized_byte_len<T: Serialize + ?Sized>(value: &T) -> u64 {
    serde_json::to_vec(value)
        .map(|bytes| u64::try_from(bytes.len()).unwrap_or(u64::MAX))
        .unwrap_or(u64::MAX)
}

pub(super) fn full_provider_byte_estimate(messages: &[Message], tools: &[ToolDefinition]) -> u64 {
    serialized_byte_len(messages)
        .saturating_add(serialized_byte_len(tools))
        .saturating_add(CONTEXT_FRAMING_SAFETY_ALLOWANCE)
}
