//! Existing first-chat policy shared by ordinary CREATE and passive source.
//! Input order is the canonical persisted summary order; sorting is stable.
use anyhow::Result;
use nac_core::sessions::{SessionBehavior, SessionSummary};

pub(crate) fn select_primary_project_session_id(
    summaries: Vec<SessionSummary>,
    project_id: &str,
    behavior: Option<SessionBehavior>,
    mut has_lineage: impl FnMut(&str) -> Result<bool>,
) -> Result<Option<String>> {
    let mut candidates = summaries
        .into_iter()
        .filter(|summary| {
            summary.project_id.as_deref() == Some(project_id)
                && behavior.is_none_or(|behavior| summary.behavior == behavior)
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    for candidate in candidates {
        if !has_lineage(&candidate.session_id)? {
            return Ok(Some(candidate.session_id));
        }
    }
    Ok(None)
}
