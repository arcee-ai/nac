//! Actual passive source capture/match on the same original cached service.
//! Observe creates DATA for an explicitly versioned source carriage; Match
//! verifies those actual versions. Neither path attaches or starts a session.
use anyhow::{ensure, Result};
use nac_core::{sessions::SessionBehavior, store::ExistingSessionSource};

use super::SessionObservation;
use crate::ManagedLocationBinding;

pub(crate) enum ExistingSessionCheck {
    Observe,
    Match {
        session_id: String,
        project_revision: i64,
        config_version: i64,
        behavior: SessionBehavior,
    },
}

impl ExistingSessionCheck {
    pub(crate) fn valid(&self) -> bool {
        match self {
            Self::Observe => true,
            Self::Match {
                session_id,
                project_revision,
                config_version,
                ..
            } => {
                !session_id.is_empty()
                    && session_id.len() <= 128
                    && *project_revision > 0
                    && *config_version >= 0
            }
        }
    }

    fn require_matches(&self, actual: &ExistingSessionSource) -> Result<()> {
        ensure!(self.valid(), "invalid passive expected version");
        if let Self::Match {
            session_id,
            project_revision,
            config_version,
            behavior,
        } = self
        {
            ensure!(
                actual.session_id == *session_id
                    && actual.project_revision == *project_revision
                    && actual.config_version == *config_version
                    && actual.behavior == *behavior,
                "passive source changed"
            );
        }
        Ok(())
    }
}

impl SessionObservation {
    async fn existing_source_read(&self, project_id: &str) -> Result<ExistingSessionSource> {
        let path = self.manager.inner.store_path.clone();
        let session_id = self.session_id.clone();
        let project_id = project_id.to_owned();
        self.manager
            .inner
            ._store_ownership
            .call_legacy(move || {
                nac_core::store::observe_existing_session_source(&path, &session_id, &project_id)
            })
            .await?
    }

    fn require_source_metadata(&self, actual: &ExistingSessionSource) -> Result<()> {
        let metadata = self.service.metadata();
        ensure!(
            metadata.session_id.as_deref() == Some(actual.session_id.as_str())
                && metadata.project_id.as_deref() == Some(actual.project_id.as_str())
                && metadata.behavior == actual.behavior
                && self.service.config_version() == Some(actual.config_version),
            "cached service differs from committed passive source"
        );
        Ok(())
    }

    /// Delivery retains the original host/replacement guard through this read
    /// AND serialization. Each read is on the original store executor. Equality
    /// includes the actual private durable session counter, not only display
    /// identity/config, so between-read changes are never echoed as a match.
    pub(crate) async fn existing_session_source(
        &self,
        project_id: &str,
        expected_binding: &ManagedLocationBinding,
        check: &ExistingSessionCheck,
        cutoff: std::time::Instant,
        stopping: &tokio::sync::watch::Receiver<bool>,
    ) -> Result<ExistingSessionSource> {
        require_live(cutoff, stopping)?;
        ensure!(check.valid(), "invalid passive expected version");
        self.require_current().await?;
        require_live(cutoff, stopping)?;
        ensure!(
            self.manager.managed_location_binding()? == *expected_binding,
            "passive host binding changed"
        );
        let before = self.existing_source_read(project_id).await?;
        require_live(cutoff, stopping)?;
        self.require_source_metadata(&before)?;
        check.require_matches(&before)?;
        self.require_current().await?;
        require_live(cutoff, stopping)?;
        let after = self.existing_source_read(project_id).await?;
        require_live(cutoff, stopping)?;
        self.require_source_metadata(&after)?;
        check.require_matches(&after)?;
        ensure!(before == after, "passive source changed during read");
        self.require_current().await?;
        require_live(cutoff, stopping)?;
        ensure!(
            self.manager.managed_location_binding()? == *expected_binding,
            "passive host binding changed"
        );
        Ok(after)
    }
}

fn require_live(
    cutoff: std::time::Instant,
    stopping: &tokio::sync::watch::Receiver<bool>,
) -> Result<()> {
    ensure!(
        std::time::Instant::now() < cutoff && !*stopping.borrow() && stopping.has_changed().is_ok(),
        "passive source owner stopped or expired"
    );
    Ok(())
}

async fn selected_project_source(
    manager: &crate::SessionManager,
    project_id: &str,
    behavior: Option<SessionBehavior>,
    cutoff: std::time::Instant,
) -> Result<(String, i64)> {
    let path = manager.inner.store_path.clone();
    let id = project_id.to_owned();
    let candidates = manager
        .inner
        ._store_ownership
        .call_legacy(move || {
            nac_core::store::observe_project_first_chat_candidates(&path, &id, cutoff)
        })
        .await??;
    let selected = super::super::session_creation::select_primary_project_session_id(
        candidates.summaries,
        project_id,
        behavior,
        |id| Ok(candidates.lineage_sessions.contains(id)),
    )?
    .ok_or_else(|| anyhow::anyhow!("no existing primary project session"))?;
    Ok((selected, candidates.project_revision))
}

impl SessionObservation {
    pub(crate) async fn project_existing_session_source(
        manager: crate::SessionManager,
        project_id: &str,
        expected_binding: &ManagedLocationBinding,
        behavior: Option<SessionBehavior>,
        check: &ExistingSessionCheck,
        cutoff: std::time::Instant,
        stopping: &tokio::sync::watch::Receiver<bool>,
    ) -> Result<ExistingSessionSource> {
        require_live(cutoff, stopping)?;
        ensure!(
            manager.managed_location_binding()? == *expected_binding,
            "passive host binding changed"
        );
        let before = selected_project_source(&manager, project_id, behavior, cutoff).await?;
        require_live(cutoff, stopping)?;
        // Resolve only canonical selected cached service. Never attach it, and
        // never fall back to a different cached candidate when this one is cold.
        let observation = Self::resolve(manager.clone(), &before.0).await?;
        require_live(cutoff, stopping)?;
        let actual = observation
            .existing_session_source(project_id, expected_binding, check, cutoff, stopping)
            .await?;
        require_live(cutoff, stopping)?;
        let after = selected_project_source(&manager, project_id, behavior, cutoff).await?;
        require_live(cutoff, stopping)?;
        ensure!(
            before == after && actual.session_id == after.0 && actual.project_revision == after.1,
            "canonical first-chat selection changed during passive read"
        );
        observation.require_current().await?;
        require_live(cutoff, stopping)?;
        ensure!(
            manager.managed_location_binding()? == *expected_binding,
            "passive host binding changed"
        );
        Ok(actual)
    }
}
