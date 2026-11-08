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
        expected_path_root: String,
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
            resolve_reveal_target(&root, &path, Path::new(&expected_path_root))
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
    root: &Path,
    path: &str,
    expected_path_root: &Path,
) -> Result<workspace::LocalRevealTarget> {
    let path = view::validate_workspace_relpath(path)?;
    if !expected_path_root.is_absolute() {
        anyhow::bail!("invalid path: missing absolute originating file coordinates");
    }
    let relative = reveal_relative_path(expected_path_root, root, &path)?;
    // Keep the original selected root, including the resolver's root-link and
    // pinned-identity checks. Never canonicalize a renderer target or widen it.
    workspace::resolve_local_reveal(root, &relative)
}

// Files uses Git's repository-relative identity, even for a selected subfolder.
fn reveal_relative_path(repo: &Path, root: &Path, path: &str) -> Result<String> {
    let path = view::validate_workspace_relpath(path)?;
    let repo = repo
        .canonicalize()
        .context("workspace reveal repository is missing")?;
    let root = root
        .canonicalize()
        .context("workspace reveal root is missing")?;
    let depth = root
        .strip_prefix(&repo)
        .context("invalid path: workspace is outside the repository")?
        .components()
        .count();
    let mut components = Path::new(&path).components();
    let prefix: PathBuf = components.by_ref().take(depth).collect();
    if prefix.components().count() != depth {
        anyhow::bail!("invalid path: file is outside the selected workspace");
    }
    if depth > 0 {
        // Git can precompose Unicode while macOS canonical paths retain the
        // stored spelling. Compare only the selected directory's identity.
        // The existing no-follow resolver rejects links in that prefix; the
        // renderer's remaining target is never canonicalized or widened.
        let prefix_text = prefix
            .to_str()
            .ok_or_else(|| anyhow!("invalid path: file is not UTF-8"))?;
        let pinned_prefix = workspace::resolve_local_reveal(&repo, prefix_text)?;
        if !pinned_prefix.matches_directory(&root)? {
            anyhow::bail!("invalid path: file is outside the selected workspace");
        }
    }
    let relative: PathBuf = components.collect();
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
    fn selected_directory_prefix_rejects_symlink_aliases_and_sibling_decoys() {
        use std::os::unix::fs::symlink;

        let repo = std::env::temp_dir().join(format!("nac-reveal-prefix-{}", uuid::Uuid::new_v4()));
        let root = repo.join("packages/app");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(repo.join("packages/other")).unwrap();
        std::fs::write(root.join("file"), "intended").unwrap();
        std::fs::write(repo.join("packages/other/file"), "sibling decoy").unwrap();
        symlink("app", repo.join("packages/alias")).unwrap();
        symlink("packages", repo.join("alias-parent")).unwrap();
        let repo = repo.canonicalize().unwrap();
        let root = root.canonicalize().unwrap();
        assert_eq!(
            reveal_relative_path(&repo, &root, "packages/app/file").unwrap(),
            "file"
        );
        for path in [
            "packages/alias/file",
            "alias-parent/app/file",
            "packages/other/file",
            "packages/app",
            "packages",
        ] {
            assert!(reveal_relative_path(&repo, &root, path).is_err(), "{path}");
        }
        std::fs::remove_dir_all(repo).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn actual_git_reveal_maps_precomposed_paths_to_decomposed_subdirectories() {
        use std::os::unix::fs::symlink;

        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let fixture = Fixture(
            std::env::temp_dir().join(format!("nac-reveal-unicode-{}", uuid::Uuid::new_v4())),
        );
        let root = fixture.0.join("packages/cafe\u{301}");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("packages/cafe\u{301}/src")).unwrap();
        std::fs::write(root.join("src/file"), "intended").unwrap();
        std::fs::write(root.join("packages/cafe\u{301}/src/file"), "nested decoy").unwrap();
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .args(["-c", "core.precomposeunicode=true", "-C"])
                .arg(&fixture.0)
                .args(args)
                .output()
                .unwrap();
            assert!(output.status.success(), "{:?}", output.stderr);
            output.stdout
        };
        git(&["init", "--quiet"]);
        git(&["add", "--all"]);
        let listed = String::from_utf8(git(&["ls-files", "-z"])).unwrap();
        let path = listed
            .split('\0')
            .find(|path| *path == "packages/caf\u{e9}/src/file")
            .expect("Git precomposes the tracked Files identity");
        let root = root.canonicalize().unwrap();
        let target = GitTarget::local(root.clone());
        let repo = target.local_repo_root_if_present().unwrap().unwrap();
        assert!(repo.join(path).strip_prefix(&root).is_err());
        assert_eq!(
            reveal_relative_path(&repo, &root, path).unwrap(),
            "src/file"
        );
        assert!(resolve_reveal_target(&root, path, &repo).is_ok());
        symlink("file", root.join("src/link")).unwrap();
        assert!(resolve_reveal_target(&root, "packages/caf\u{e9}/src/link", &repo).is_err());
        std::fs::remove_file(root.join("src/file")).unwrap();
        assert!(root.join("packages/cafe\u{301}/src/file").exists());
        assert!(resolve_reveal_target(&root, path, &repo).is_err());
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
            assert!(resolve_reveal_target(&root, path, &root).is_ok(), "{path}");
        }
        symlink("file 日本語", root.join("link")).unwrap();
        for path in ["../outside", "/tmp/absolute", "missing/child", "link"] {
            assert!(resolve_reveal_target(&root, path, &root).is_err(), "{path}");
        }
        assert!(!root.join("missing").exists());
        // Originating plain-directory coordinates do not depend on later Git metadata.
        // Lexical denials and the selected-root resolver still apply.
        std::fs::write(root.join(".git"), "gitdir: missing-gitdir\n").unwrap();
        assert!(resolve_reveal_target(&root, "file 日本語", &root).is_ok());
        let error = resolve_reveal_target(&root, "../outside", &root)
            .err()
            .unwrap();
        assert!(error.to_string().contains("invalid path"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn cached_listing_keeps_its_coordinates_after_git_removal_or_nested_repository() {
        for nested in [false, true] {
            let repo =
                std::env::temp_dir().join(format!("nac-reveal-origin-{}", uuid::Uuid::new_v4()));
            let root = repo.join("packages/app");
            std::fs::create_dir_all(root.join("src")).unwrap();
            std::fs::create_dir_all(root.join("packages/app/src")).unwrap();
            std::fs::write(root.join("src/main.ts"), "intended").unwrap();
            std::fs::write(root.join("packages/app/src/main.ts"), "decoy").unwrap();
            let git = |cwd: &Path| {
                assert!(std::process::Command::new("git")
                    .args(["init", "--quiet"])
                    .arg(cwd)
                    .status()
                    .unwrap()
                    .success())
            };
            git(&repo);
            let root = root.canonicalize().unwrap();
            let target = GitTarget::local(root.clone());
            let listing = view::list_files(&target).unwrap();
            let basis = listing.path_root.unwrap();
            let path = listing
                .files
                .iter()
                .find(|p| *p == "packages/app/src/main.ts")
                .unwrap();
            if nested {
                git(&root);
            } else {
                std::fs::remove_dir_all(repo.join(".git")).unwrap();
            }
            assert_eq!(
                reveal_relative_path(&basis, &root, path).unwrap(),
                "src/main.ts"
            );
            assert!(resolve_reveal_target(&root, path, &basis).is_ok());
            std::fs::remove_file(root.join("src/main.ts")).unwrap();
            assert!(root.join("packages/app/src/main.ts").exists());
            assert!(
                resolve_reveal_target(&root, path, &basis).is_err(),
                "Git changes cannot reinterpret the cached identity as the nested decoy"
            );
            for missing in ["", ".", "relative"] {
                assert!(resolve_reveal_target(&root, path, Path::new(missing)).is_err());
            }
            std::fs::remove_dir_all(repo).unwrap();
        }
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
        let repo = repo.canonicalize().unwrap();
        assert!(resolve_reveal_target(&root, "packages/app/src/main.ts", &repo).is_ok());
        for path in [
            "outside.txt",
            "packages/application/src/main.ts",
            "../outside",
        ] {
            assert!(resolve_reveal_target(&root, path, &repo).is_err(), "{path}");
        }
        std::fs::remove_file(root.join("src/main.ts")).unwrap();
        assert!(root.join("packages/app/src/main.ts").exists());
        assert!(
            resolve_reveal_target(&root, "packages/app/src/main.ts", &repo).is_err(),
            "a present decoy cannot replace the missing intended target"
        );
        std::fs::remove_dir_all(repo).unwrap();
    }

    #[cfg(unix)]
    fn assert_literal_git_root_reveal(suffix: &str) {
        use std::os::unix::fs::symlink;

        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let fixture = Fixture(
            std::env::temp_dir().join(format!("nac-reveal-git-record-{}", uuid::Uuid::new_v4())),
        );
        let sibling = fixture.0.join("repo 日本語");
        let repo = fixture.0.join(format!("repo 日本語{suffix}"));
        let root = repo.join("packages/app");
        std::fs::create_dir_all(sibling.join("packages/app/src")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("packages/app/src")).unwrap();
        std::fs::write(sibling.join("packages/app/src/file"), "sibling decoy").unwrap();
        std::fs::write(root.join("src/file"), "intended").unwrap();
        std::fs::write(root.join("packages/app/src/file"), "nested decoy").unwrap();
        assert!(std::process::Command::new("git")
            .args(["init", "--quiet"])
            .arg(&repo)
            .status()
            .unwrap()
            .success());
        let sibling = sibling.canonicalize().unwrap();
        let root = root.canonicalize().unwrap();
        let target = GitTarget::local(root.clone());
        let repo = target.local_repo_root_if_present().unwrap().unwrap();
        let relative = reveal_relative_path(&repo, &root, "packages/app/src/file").unwrap();
        assert_eq!(relative, "src/file");
        assert_eq!(
            std::fs::read_to_string(root.join(&relative)).unwrap(),
            "intended"
        );
        assert!(resolve_reveal_target(&root, "packages/app/src/file", &repo).is_ok());
        // A wrong discovery root must remain fenced, never select its sibling.
        assert!(reveal_relative_path(&sibling, &root, "packages/app/src/file").is_err());
        symlink("file", root.join("src/link")).unwrap();
        for path in ["../outside", "outside.txt", "packages/app/src/link"] {
            assert!(resolve_reveal_target(&root, path, &repo).is_err());
        }
        std::fs::remove_file(root.join("src/file")).unwrap();
        assert!(root.join("packages/app/src/file").exists());
        assert!(sibling.join("packages/app/src/file").exists());
        assert!(resolve_reveal_target(&root, "packages/app/src/file", &repo).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn actual_git_reveal_preserves_trailing_space_root() {
        assert_literal_git_root_reveal(" ");
    }

    #[cfg(unix)]
    #[test]
    fn actual_git_reveal_preserves_trailing_tab_root() {
        assert_literal_git_root_reveal("\t");
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
