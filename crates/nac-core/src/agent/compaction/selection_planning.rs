//! Typed selection provenance loading, checkpoint validation, and finite budgeting.
use super::*;
impl CompactionState {
    pub async fn refresh_provenance_async(&mut self, messages: &[Message]) -> Result<()> {
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
        self.clear_invalid_checkpoint(messages);
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
        let Some(source) = source.filter(|source| source.count > 0) else {
            return checkpoint_is_valid(checkpoint, messages, self.policy);
        };
        if checkpoint.tail_start_message_index > messages.len() {
            return false;
        }
        let mut legacy = checkpoint.clone();
        legacy.source_prefix_sha256 =
            source_prefix_digest(messages, checkpoint.tail_start_message_index);
        checkpoint.source_prefix_sha256
            == super::super::provenance::source_digest(legacy.source_prefix_sha256, Some(source))
            && checkpoint_is_valid(&legacy, messages, self.policy)
            && super::super::provenance::validates(
                &checkpoint.summary,
                source,
                checkpoint.tail_start_message_index,
            )
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
