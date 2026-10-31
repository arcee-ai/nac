use super::*;
use std::path::{Path, PathBuf};

impl WorkspaceApplication<'_> {
    /// An explicit Finder operation. The expected root fences stale UI data;
    /// the current durable session/target, rather than a renderer path, binds
    /// the request. This creates no agent approval or remembered grant.
    pub async fn reveal_workspace_path(
        &self,
        session_id: &str,
        path: String,
        expected_workspace_root: String,
    ) -> Result<view::OpenLocalPathResult> {
        let summary = self
            .manager
            .session_catalog()
            .list(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{session_id}' was not found"))?;
        let target = self.manager.git_target(&summary)?;
        let root = reveal_root(&summary, &target, Path::new(&expected_workspace_root))?;
        let resolved = nac_core::store::spawn_blocking_store_caller(move || {
            workspace::resolve_local_reveal(&root, &path)
        })
        .await
        .context("workspace reveal task failed")??;
        let opened = resolved.reveal().await?;
        Ok(view::OpenLocalPathResult {
            opened: opened.display().to_string(),
            fell_back_to_parent: false,
        })
    }
}

fn reveal_root(
    summary: &view::SessionSummarySnapshot,
    target: &GitTarget,
    expected: &Path,
) -> Result<PathBuf> {
    if summary.ssh_host.is_some() || summary.sandboxed {
        anyhow::bail!("Finder reveal is only available for the Local execution backend");
    }
    let root = target
        .local_path()
        .ok_or_else(|| anyhow!("Finder reveal requires a Local workspace"))?;
    if !expected.is_absolute() || expected != root {
        anyhow::bail!(
            "invalid path: workspace changed; reopen the current file before revealing it"
        );
    }
    Ok(root.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reveal_rejects_stale_root_and_every_non_local_backend_before_os_handoff() {
        let root =
            std::env::temp_dir().join(format!("nac-reveal-binding-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        crate::tests::seed_direct_session(&root, "fixture");
        let manager = crate::tests::test_manager(&root);
        let mut summary = manager
            .session_catalog()
            .list(false)
            .await
            .unwrap()
            .remove(0)
            .summary;
        let target = manager.git_target(&summary).unwrap();
        let expected = target.local_path().unwrap();
        assert!(reveal_root(&summary, &target, expected).is_ok());
        assert!(reveal_root(&summary, &target, &root.join("stale")).is_err());
        assert!(reveal_root(&summary, &target, Path::new("relative")).is_err());
        summary.sandboxed = true;
        assert!(
            reveal_root(&summary, &target, expected).is_err(),
            "mounted Podman paths stay excluded"
        );
        summary.sandboxed = false;
        summary.ssh_host = Some("remote".into());
        assert!(
            reveal_root(&summary, &target, expected).is_err(),
            "an SSH path is never a Mac path"
        );
        drop(manager);
        let _ = std::fs::remove_dir_all(root);
    }
}
