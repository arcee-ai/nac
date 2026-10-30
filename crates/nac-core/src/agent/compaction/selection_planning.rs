//! Typed selection provenance loading, checkpoint validation, and finite budgeting.
use super::*;

/// The prefix checks the active checkpoint passed, and the transcript
/// generation they ran against. Appending keeps the generation and cannot
/// change `messages[..boundary]`, so the result holds until the transcript is
/// edited or replaced, or the checkpoint or its selection source changes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct VerifiedPrefix {
    checkpoint_id: i64,
    boundary: usize,
    generation: u64,
    source: Option<crate::store::TerminalSelectionProvenance>,
}

impl CompactionState {
    pub fn record_committed_assistant_context(
        &mut self,
        transcript: &TranscriptMessages,
        reported_context_tokens: u64,
        checkpoint_id: Option<i64>,
    ) {
        let messages: &[Message] = transcript;
        // The caller just committed this typed Assistant through the canonical
        // append owner. Only identified User delivery can add attribution, so
        // its verified predecessor metadata remains exact without another scan.
        let boundary = messages.len();
        if matches!(messages.last(), Some(Message::Assistant { .. })) {
            if let Some(source) = boundary
                .checked_sub(1)
                .and_then(|previous| self.selection_sources.get(&previous))
                .cloned()
            {
                self.selection_sources.insert(boundary, source);
            }
        }
        self.record_ordinary_context(transcript, reported_context_tokens, boundary, checkpoint_id);
    }

    pub(super) async fn ensure_selection_source_async(&mut self, boundary: usize) -> Result<()> {
        if self.selection_sources.contains_key(&boundary) {
            return Ok(());
        }
        let path = self.store_path.clone();
        let session = self.session_id.clone();
        let values = vec![boundary as u64];
        let mut sources = if let Some(owner) = crate::store::coordinator::owner_for(&path)? {
            owner
                .load_terminal_selection_provenance(session, values)
                .await?
        } else {
            crate::store::spawn_blocking_store_caller(move || {
                crate::store::load_terminal_selection_provenance(&path, &session, &values)
            })
            .await??
        };
        self.selection_sources.insert(boundary, sources.remove(0));
        Ok(())
    }
    pub async fn refresh_provenance_async(
        &mut self,
        transcript: &TranscriptMessages,
    ) -> Result<()> {
        // Stage only existing bounded metadata and checkpoint state. Canonical
        // message bodies are borrowed; no second transcript collection is made.
        // A later read failure cannot partially invalidate the prior checkpoint.
        let mut verified = self.clone();
        verified.refresh_selection_sources_async(transcript).await?;
        *self = verified;
        Ok(())
    }
    async fn refresh_selection_sources_async(
        &mut self,
        transcript: &TranscriptMessages,
    ) -> Result<()> {
        let messages: &[Message] = transcript;
        let source_start = self
            .active_checkpoint
            .as_ref()
            .map_or(0, |checkpoint| checkpoint.tail_start_message_index);
        let summary = self
            .active_checkpoint
            .as_ref()
            .map(|checkpoint| checkpoint.summary.as_str());
        let boundary = weighted_safe_boundary(messages, source_start, summary)
            .ok()
            .flatten();
        let mut boundaries = vec![source_start];
        for boundary in std::iter::once(messages.len()).chain(
            self.context_sample
                .as_ref()
                .map(|sample| sample.canonical_message_len),
        ) {
            if !boundaries.contains(&boundary) {
                boundaries.push(boundary);
            }
        }
        if let Some(boundary) = boundary {
            if !boundaries.contains(&boundary) {
                boundaries.push(boundary);
            }
        }
        let path = self.store_path.clone();
        let session = self.session_id.clone();
        let values = boundaries
            .iter()
            .map(|boundary| *boundary as u64)
            .collect::<Vec<_>>();
        let sources = if let Some(owner) = crate::store::coordinator::owner_for(&path)? {
            owner
                .load_terminal_selection_provenance(session, values)
                .await?
        } else {
            crate::store::spawn_blocking_store_caller(move || {
                crate::store::load_terminal_selection_provenance(&path, &session, &values)
            })
            .await??
        };
        self.selection_sources = boundaries.into_iter().zip(sources).collect();
        // Validation can discard the active checkpoint and change the prefix
        // selected for the next compaction. Refresh that new prefix too.
        let boundary_before_validation = boundary;
        self.clear_invalid_checkpoint(messages, transcript.generation());
        let current_start = self
            .active_checkpoint
            .as_ref()
            .map_or(0, |checkpoint| checkpoint.tail_start_message_index);
        let current_summary = self
            .active_checkpoint
            .as_ref()
            .map(|checkpoint| checkpoint.summary.as_str());
        if let Some(boundary) = weighted_safe_boundary(messages, current_start, current_summary)
            .ok()
            .flatten()
            .filter(|boundary| !self.selection_sources.contains_key(boundary))
        {
            let path = self.store_path.clone();
            let session = self.session_id.clone();
            let values = vec![boundary as u64];
            let mut sources = if let Some(owner) = crate::store::coordinator::owner_for(&path)? {
                owner
                    .load_terminal_selection_provenance(session, values)
                    .await?
            } else {
                crate::store::spawn_blocking_store_caller(move || {
                    crate::store::load_terminal_selection_provenance(&path, &session, &values)
                })
                .await??
            };
            if let Some(old_boundary) = boundary_before_validation {
                if old_boundary != current_start
                    && old_boundary != messages.len()
                    && self
                        .context_sample
                        .as_ref()
                        .is_none_or(|sample| sample.canonical_message_len != old_boundary)
                {
                    self.selection_sources.remove(&old_boundary);
                }
            }
            self.selection_sources.insert(boundary, sources.remove(0));
        }
        Ok(())
    }
    pub(super) fn selection_checkpoint_valid(
        &self,
        checkpoint: &OrchestratorCompactionCheckpoint,
        messages: &[Message],
        source: Option<&crate::store::TerminalSelectionProvenance>,
    ) -> bool {
        let source = source.filter(|source| source.count > 0);
        checkpoint_frame_is_valid(checkpoint, messages, self.policy, source)
            && checkpoint_prefix_matches(checkpoint, messages, source)
    }

    /// `selection_checkpoint_valid` for the active checkpoint, reusing the
    /// prefix checks it already passed against this transcript generation.
    /// The frame checks, which also read messages appended after the prefix,
    /// run every time.
    pub(super) fn active_checkpoint_still_valid(
        &mut self,
        messages: &[Message],
        generation: u64,
    ) -> bool {
        let Some(checkpoint) = &self.active_checkpoint else {
            return true;
        };
        let source = self
            .selection_sources
            .get(&checkpoint.tail_start_message_index)
            .filter(|source| source.count > 0);
        if !checkpoint_frame_is_valid(checkpoint, messages, self.policy, source) {
            return false;
        }
        let verified = VerifiedPrefix {
            checkpoint_id: checkpoint.id,
            boundary: checkpoint.tail_start_message_index,
            generation,
            source: source.cloned(),
        };
        if self.verified_prefix.as_ref() == Some(&verified) {
            return true;
        }
        let matches = checkpoint_prefix_matches(checkpoint, messages, source);
        self.verified_prefix = matches.then_some(verified);
        matches
    }
    pub fn install_selection_summary(
        &self,
        candidate: &CompactionCandidate,
        summary: &str,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Option<String> {
        let source = self.selection_sources.get(&candidate.boundary);
        let budget = self.selection_replacement_budget(candidate, messages, tools);
        super::super::provenance::installed(source, candidate.boundary, summary, budget)
    }
    fn selection_replacement_budget(
        &self,
        candidate: &CompactionCandidate,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> usize {
        let remaining = provider_view_with_summary(messages, candidate.boundary, "");
        let remaining_tokens =
            estimate_message_tokens(&remaining).saturating_add(estimate_tool_tokens(tools));
        usize::try_from(
            candidate
                .old_context_estimate
                .saturating_sub(remaining_tokens)
                .saturating_mul(4),
        )
        .unwrap_or(usize::MAX)
    }
    pub fn selection_summary_budget(
        &self,
        candidate: &CompactionCandidate,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<Option<usize>, ()> {
        let Some(source) = self
            .selection_sources
            .get(&candidate.boundary)
            .filter(|source| source.count > 0)
        else {
            return Ok(None);
        };
        let minimum = crate::store::TerminalSelectionProvenance {
            recent: Vec::new(),
            ..source.clone()
        };
        let framing =
            super::super::provenance::framed(&minimum, candidate.boundary, 4096).ok_or(())?;
        let budget = self
            .selection_replacement_budget(candidate, messages, tools)
            .checked_sub(HISTORICAL_CONTEXT_PREFIX.len() + framing.len())
            .filter(|budget| *budget > 0)
            .ok_or(())?;
        Ok(Some(budget))
    }
}

/// The checks on the checkpoint record, the policy, the message right after the
/// summarized prefix and the transcript's system messages.
fn checkpoint_frame_is_valid(
    checkpoint: &OrchestratorCompactionCheckpoint,
    messages: &[Message],
    policy: CompactionPolicy,
    source: Option<&crate::store::TerminalSelectionProvenance>,
) -> bool {
    checkpoint.prompt_policy_version == policy.version()
        && checkpoint_boundary_is_valid(messages, checkpoint.tail_start_message_index)
        && checkpoint
            .summary
            .strip_prefix(HISTORICAL_CONTEXT_PREFIX)
            .is_some_and(|summary| !summary.trim().is_empty())
        && checkpoint.system_policy_sha256 == system_policy_digest(messages, policy)
        && source.is_none_or(|source| {
            super::super::provenance::validates(
                &checkpoint.summary,
                source,
                checkpoint.tail_start_message_index,
            )
        })
}

/// The checks that read only the summarized prefix `messages[..boundary]` —
/// re-serializing and hashing it is the expensive part of validation.
fn checkpoint_prefix_matches(
    checkpoint: &OrchestratorCompactionCheckpoint,
    messages: &[Message],
    source: Option<&crate::store::TerminalSelectionProvenance>,
) -> bool {
    let boundary = checkpoint.tail_start_message_index;
    if boundary > messages.len() {
        return false;
    }
    let canonical = source_prefix_digest(messages, boundary);
    let expected = match source {
        Some(source) => super::super::provenance::source_digest(canonical, Some(source)),
        None => canonical,
    };
    checkpoint.source_prefix_sha256 == expected
        && summarized_prefix_has_complete_tools(messages, boundary)
}
