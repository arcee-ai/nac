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
            resolve_reveal_target(&target, &root, &path)
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

// Admission and stale-root binding have already run. This same seam is tested
// before OS handoff, including valid plain Local directories.
fn resolve_reveal_target(
    target: &GitTarget,
    root: &Path,
    path: &str,
) -> Result<workspace::LocalRevealTarget> {
    let path = view::validate_workspace_relpath(path)?;
    let relative = match target.local_repo_root_if_present()? {
        Some(repo) => reveal_relative_path(&repo, root, &path)?,
        None => path,
    };
    // Keep the original selected root, including the resolver's root-link and
    // pinned-identity checks. Never canonicalize a renderer target or widen it.
    workspace::resolve_local_reveal(root, &relative)
}

// Files uses Git's repository-relative identity, even for a selected subfolder.
fn reveal_relative_path(repo: &Path, root: &Path, path: &str) -> Result<String> {
    let path = view::validate_workspace_relpath(path)?;
    let root = root
        .canonicalize()
        .context("workspace reveal root is missing")?;
    let file = repo.join(path);
    let relative = file
        .strip_prefix(&root)
        .context("invalid path: file is outside the selected workspace")?;
    let relative = relative
        .to_str()
        .ok_or_else(|| anyhow!("invalid path: file is not UTF-8"))?;
    view::validate_workspace_relpath(relative)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_identity_maps_to_selected_subdirectory_without_revealing_nested_decoy() {
        let repo = std::env::temp_dir().join(format!("nac-reveal-files-{}", uuid::Uuid::new_v4()));
        let root = repo.join("packages/app");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("packages/app/src")).unwrap();
        std::fs::write(root.join("src/main.ts"), "intended").unwrap();
        std::fs::write(root.join("packages/app/src/main.ts"), "decoy").unwrap();
        let repo = repo.canonicalize().unwrap();
        let root = root.canonicalize().unwrap();
        let relative = reveal_relative_path(&repo, &root, "packages/app/src/main.ts").unwrap();
        assert_eq!(relative, "src/main.ts");
        assert_eq!(
            std::fs::read_to_string(root.join(&relative)).unwrap(),
            "intended"
        );
        assert!(workspace::resolve_local_reveal(&root, &relative).is_ok());
        assert_eq!(
            reveal_relative_path(&repo, &repo, "packages/app/src/main.ts").unwrap(),
            "packages/app/src/main.ts"
        );
        for path in [
            "outside.txt",
            "packages/other/file",
            "packages/application/file",
            "../outside",
            "packages/app/../outside",
            "/tmp/absolute",
            ".",
            "",
            "file:///tmp/a",
        ] {
            assert!(reveal_relative_path(&repo, &root, path).is_err(), "{path}");
        }
        std::fs::remove_dir_all(repo).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn raw_local_nongit_reveal_resolves_valid_targets_and_keeps_denials() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("nac-reveal-plain-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join("directory")).unwrap();
        std::fs::write(root.join("file 日本語"), "owned").unwrap();
        let root = root.canonicalize().unwrap();
        let target = GitTarget::local(root.clone());
        assert_eq!(target.local_repo_root_if_present().unwrap(), None);
        assert!(target.repo_root().is_err()); // Existing strict callers stay strict.
        for path in ["file 日本語", "directory"] {
            assert!(
                resolve_reveal_target(&target, &root, path).is_ok(),
                "{path}"
            );
        }
        symlink("file 日本語", root.join("link")).unwrap();
        for path in ["../outside", "/tmp/absolute", "missing/child", "link"] {
            assert!(
                resolve_reveal_target(&target, &root, path).is_err(),
                "{path}"
            );
        }
        assert!(!root.join("missing").exists());
        // Bad repository metadata is not a plain-directory fallback. Lexical
        // denials must still win before this operational discovery failure.
        std::fs::write(root.join(".git"), "gitdir: missing-gitdir\n").unwrap();
        assert!(resolve_reveal_target(&target, &root, "file 日本語").is_err());
        let error = resolve_reveal_target(&target, &root, "../outside")
            .err()
            .unwrap();
        assert!(error.to_string().contains("invalid path"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn actual_git_discovery_reveal_never_substitutes_nested_decoy() {
        let repo = std::env::temp_dir().join(format!("nac-reveal-git-{}", uuid::Uuid::new_v4()));
        let root = repo.join("packages/app");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("packages/app/src")).unwrap();
        assert!(std::process::Command::new("git")
            .arg("init")
            .arg("--quiet")
            .arg(&repo)
            .status()
            .unwrap()
            .success());
        std::fs::write(root.join("src/main.ts"), "intended").unwrap();
        std::fs::write(root.join("packages/app/src/main.ts"), "decoy").unwrap();
        let root = root.canonicalize().unwrap();
        let target = GitTarget::local(root.clone());
        assert!(resolve_reveal_target(&target, &root, "packages/app/src/main.ts").is_ok());
        for path in [
            "outside.txt",
            "packages/application/src/main.ts",
            "../outside",
        ] {
            assert!(
                resolve_reveal_target(&target, &root, path).is_err(),
                "{path}"
            );
        }
        std::fs::remove_file(root.join("src/main.ts")).unwrap();
        assert!(root.join("packages/app/src/main.ts").exists());
        assert!(
            resolve_reveal_target(&target, &root, "packages/app/src/main.ts").is_err(),
            "a present decoy cannot replace the missing intended target"
        );
        std::fs::remove_dir_all(repo).unwrap();
    }

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
