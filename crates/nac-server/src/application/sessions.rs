use std::{collections::HashMap, time::Instant};

use anyhow::{anyhow, Context, Result};
use nac_core::{
    sessions,
    view::{self, SessionSummarySnapshot},
    workspace::GitTarget,
};

use crate::{
    git_target_key, GitTargetKey, ManagedSessionSummary, SessionManager, WorkspaceDiffCacheEntry,
    WORKSPACE_DIFF_MEASURE_BUDGET,
};

/// Session catalog and presentation use cases.
///
/// This owner combines durable summaries with process-local activity and
/// bounded workspace measurements. It does not admit or settle agent runs.
pub(crate) struct SessionCatalogApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionCatalogApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn list(
        &self,
        include_workspace_stats: bool,
    ) -> Result<Vec<ManagedSessionSummary>> {
        self.list_for_project(include_workspace_stats, None).await
    }

    pub(crate) async fn list_for_project(
        &self,
        include_workspace_stats: bool,
        project_id: Option<&str>,
    ) -> Result<Vec<ManagedSessionSummary>> {
        if !self.manager.inner.store_path.exists() {
            return Ok(Vec::new());
        }

        let store_path = self.manager.inner.store_path.clone();
        let summaries = tokio::task::spawn_blocking(move || view::list_sessions(&store_path))
            .await
            .context("session list task failed")??;
        let mut sessions = {
            let active = self.manager.inner.active_sessions.read().await;
            summaries
                .into_iter()
                .filter(|summary| {
                    project_id
                        .is_none_or(|project_id| summary.project_id.as_deref() == Some(project_id))
                })
                .map(|summary| {
                    let active_service = active.get(&summary.session_id);
                    Ok(ManagedSessionSummary {
                        lineage: self.manager.session_lineage(&summary.session_id)?,
                        active: active_service.is_some(),
                        active_run: active_service.and_then(|service| service.active_run()),
                        summary,
                        workspace_diff: None,
                    })
                })
                .collect::<Result<Vec<_>>>()?
        };

        if include_workspace_stats {
            self.populate_workspace_diff(&mut sessions).await?;
        }

        Ok(sessions)
    }

    pub(crate) async fn update_presentation(
        &self,
        session_id: &str,
        title: &str,
        pinned: bool,
        expected_version: i64,
    ) -> std::result::Result<SessionSummarySnapshot, sessions::SessionPresentationError> {
        let store_path = self.manager.inner.store_path.clone();
        let session_id = session_id.to_string();
        let title = title.to_string();
        tokio::task::spawn_blocking(move || {
            sessions::update_session_presentation(
                &store_path,
                &session_id,
                &title,
                pinned,
                expected_version,
            )
            .map(Into::into)
        })
        .await
        .map_err(|error| {
            sessions::SessionPresentationError::Store(anyhow!(
                "session presentation update task failed: {error}"
            ))
        })?
    }

    pub(crate) async fn reorder(
        &self,
        pinned: bool,
        session_ids: &[String],
        expected_versions: &std::collections::BTreeMap<String, i64>,
    ) -> std::result::Result<Vec<SessionSummarySnapshot>, sessions::SessionPresentationError> {
        let store_path = self.manager.inner.store_path.clone();
        let session_ids = session_ids.to_vec();
        let expected_versions = expected_versions.clone();
        tokio::task::spawn_blocking(move || {
            sessions::reorder_sessions(&store_path, pinned, &session_ids, &expected_versions)
                .map(|summaries| summaries.into_iter().map(Into::into).collect())
        })
        .await
        .map_err(|error| {
            sessions::SessionPresentationError::Store(anyhow!(
                "session reorder task failed: {error}"
            ))
        })?
    }

    /// Attach bounded, checkout-deduplicated workspace totals to list rows.
    async fn populate_workspace_diff(&self, sessions: &mut [ManagedSessionSummary]) -> Result<()> {
        let mut targets: HashMap<GitTargetKey, (GitTarget, String)> = HashMap::new();
        let mut key_by_session: HashMap<String, GitTargetKey> = HashMap::new();
        for entry in sessions.iter() {
            let Ok(target) = self.manager.git_target(&entry.summary) else {
                continue;
            };
            let key = git_target_key(&target);
            key_by_session.insert(entry.summary.session_id.clone(), key.clone());
            targets
                .entry(key)
                .or_insert_with(|| (target, entry.summary.cwd.display().to_string()));
        }

        let now = Instant::now();
        let mut totals_by_key: HashMap<GitTargetKey, view::WorkspaceDiffTotals> = HashMap::new();
        let mut pending = Vec::new();
        {
            let cache = self.manager.inner.workspace_diff_cache.read().await;
            for key in targets.keys() {
                match cache.get(key) {
                    Some(entry) if entry.is_fresh(now) => {
                        totals_by_key.insert(key.clone(), entry.totals.clone());
                    }
                    _ => pending.push(key.clone()),
                }
            }
        }

        let mut tasks = Vec::new();
        for key in pending {
            let Some((target, display)) = targets.get(&key).cloned() else {
                continue;
            };
            if let Some(failure) = self.manager.cached_git_failure(&key).await {
                totals_by_key.insert(
                    key.clone(),
                    view::WorkspaceDiffTotals {
                        total_additions: 0,
                        total_deletions: 0,
                        error: Some(failure),
                    },
                );
                continue;
            }
            tasks.push((
                key,
                tokio::task::spawn_blocking(move || {
                    view::workspace_diff_totals(&display, Some(&target))
                }),
            ));
        }

        let mut cache_updates = Vec::new();
        let deadline = tokio::time::Instant::now() + WORKSPACE_DIFF_MEASURE_BUDGET;
        for (key, task) in tasks {
            match tokio::time::timeout_at(deadline, task).await {
                Ok(joined) => {
                    let totals = joined.context("workspace diff task failed")?;
                    totals_by_key.insert(key.clone(), totals.clone());
                    cache_updates.push((key, totals));
                }
                Err(_) => {
                    totals_by_key.insert(
                        key,
                        view::WorkspaceDiffTotals {
                            total_additions: 0,
                            total_deletions: 0,
                            error: Some("workspace diff is still being measured".to_string()),
                        },
                    );
                }
            }
        }

        if !cache_updates.is_empty() {
            let updated_at = Instant::now();
            let mut cache = self.manager.inner.workspace_diff_cache.write().await;
            for (key, totals) in cache_updates {
                cache.insert(key, WorkspaceDiffCacheEntry { updated_at, totals });
            }
        }

        for entry in sessions.iter_mut() {
            entry.workspace_diff = match key_by_session.get(&entry.summary.session_id) {
                Some(key) => totals_by_key.get(key).cloned(),
                None => Some(view::workspace_diff_totals(
                    &entry.summary.cwd.display().to_string(),
                    None,
                )),
            };
        }

        Ok(())
    }
}
