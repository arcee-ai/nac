use super::*;

#[test]
fn store_hard_denial_covers_the_session_lease_directory_beside_it() {
    let backend = ExecutionBackend::Local {
        workspace_cwd: PathBuf::from("/workspace"),
    };
    let store = Path::new("/state/store.db");
    for (path, denied) in [
        ("/state/store.db.run-locks", true),
        ("/state/store.db.run-locks/00.lock", true),
        ("/state/store.db.run-locks-notes", false),
    ] {
        let resources = file_resources("edit", PathBuf::from(path), &backend, store, true);
        assert_eq!(resources[0].hard_denial.is_some(), denied, "{path}");
    }
}

#[test]
fn git_operands_and_safe_settings_do_not_look_like_destructive_operations() {
    let cwd = Path::new("/workspace");
    let backends = [
        ExecutionBackend::Local {
            workspace_cwd: cwd.into(),
        },
        ExecutionBackend::Sandbox(crate::sandbox::SandboxSession::new_for_test(
            crate::sandbox::SandboxSpec {
                workdir: cwd.into(),
                ..Default::default()
            },
        )),
        ExecutionBackend::Ssh(crate::sandbox::SshBackend::new(
            "nobody@invalid".into(),
            cwd.into(),
        )),
    ];
    for backend in &backends {
        for command in [
            "git add checkout",
            "git add -- reset restore clean checkout",
            "git log --grep reset",
            "git log --grep=clean",
            "git show checkout",
            "git -C repo add -- restore",
            "git -C repo add -f -- checkout",
            "git add -A -- reset",
            "git --version",
            "env git -C repo log --grep checkout",
            "git checkout -b topic",
            "env git -C repo checkout -b topic",
            "git -C --work-tree checkout -b topic",
            "printf 'GIT_WORK_TREE=not-an-assignment'",
            "git checkout -b reset",
            "git branch reset",
            "git -c core.quotepath=false status",
        ] {
            let resources = shell_resources(command, cwd, backend);
            assert!(
                resources.iter().all(|r| r.hard_denial.is_none()),
                "{command}: {resources:?}"
            );
        }
        let command = "env git -C repo checkout -b topic";
        let resources = shell_resources(command, cwd, backend);
        let bound = bind_authorized_shell_command(command, cwd, &resources).unwrap();
        assert!(bound.starts_with("env /usr/bin/env -u GIT_DIR "), "{bound}");
        assert!(
            bound.ends_with("git -C /workspace/repo checkout -b topic"),
            "{bound}"
        );
        for command in [
            "git reset --hard",
            "git -C repo clean -fd",
            "git restore -- reset",
            "git checkout -- reset",
            "git checkout -B topic",
            "git checkout -b topic HEAD~1",
            "git --git-dir=/other/repo --work-tree=/other/tree checkout -b topic",
            "git -C repo --work-tree /other/tree checkout -b topic",
            "GIT_WORK_TREE=/other/tree git checkout -b topic",
            "env GIT_DIR=/other/repo GIT_INDEX_FILE=/other/index git checkout -b topic",
            "export GIT_WORK_TREE=/other/tree; git checkout -b topic",
            "cd repo; git checkout -b topic",
            "source settings; git checkout -b topic",
            "cd repo; git add -- checkout",
            "env -C repo git checkout -b topic",
            "env --chdir=repo git checkout -b topic",
            "env -iCrepo git checkout -b topic",
            "command -p git checkout -b topic",
            "env -P/usr/bin git checkout -b topic",
            "exec -a git-status git checkout -b topic",
            "cd repo; git -c core.quotepath=false status -- file",
            "source settings; git -c core.quotepath=false status",
            "GIT_DIR=/other/repo; export GIT_DIR; git checkout -b topic",
            "git bisect reset",
            "git submodule foreach git reset --hard",
            "git branch -D reset",
            "env git -C repo reset --hard",
            "git -c alias.pwn='!touch marker' pwn",
            "git -c core.hooksPath=hooks status",
            "git -c credential.helper=foo status",
            "git -c core.quotepath=false -c core.hooksPath=hooks status",
            "git -c credential.helper=foo -c core.quotepath=false status",
            "git --config-env=core.quotepath=VALUE status",
            "GIT_CONFIG_COUNT=1 git status",
        ] {
            let resources = shell_resources(command, cwd, backend);
            assert!(
                resources.iter().any(|r| r.hard_denial.is_some()),
                "{command}: {resources:?}"
            );
        }
        for command in [
            "git --unknown reset",
            "git -C",
            "git -c",
            "git custom-alias reset",
        ] {
            let resources = shell_resources(command, cwd, backend);
            let reason = resources
                .iter()
                .find_map(|r| r.hard_denial.as_deref())
                .unwrap();
            assert!(reason.contains("ambiguous"), "{command}: {reason}");
            assert!(!reason.contains("destructive Git"), "{command}: {reason}");
        }
        for command in [
            "git add --pathspec-from-file=paths",
            "git add --chmod=+x -- checkout",
            "git add -- ':(glob)*'",
            "git add -- '*.rs'",
        ] {
            let resources = shell_resources(command, cwd, backend);
            let reason = resources
                .iter()
                .find_map(|r| r.hard_denial.as_deref())
                .unwrap();
            assert!(
                reason.contains(
                    "Git add options or pathspecs are unsupported for safe resource binding"
                ),
                "{command}: {reason}"
            );
        }
    }
    let backend = &backends[0];
    let resources = shell_resources("git -c core.quotepath=false status", cwd, backend);
    let policy = PermissionPolicy::for_backend(
        PermissionBackend::Local,
        [PermissionRule::new("execute*", "*", PermissionEffect::Deny)],
    );
    let decision = policy.evaluate(&resources, &[]);
    assert_eq!(decision.effect, PermissionEffect::Deny);
    assert!(decision.hard_denial.is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn git_dash_c_and_separator_preserve_canonical_operand_binding() {
    use std::os::unix::fs::symlink;
    let root = std::env::temp_dir().join(format!("nac-git-binding-{}", uuid::Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    std::fs::write(repo.join("target"), "content").unwrap();
    symlink("target", repo.join("checkout")).unwrap();
    std::fs::write(repo.join("--output=checkout"), "literal").unwrap();
    symlink(&repo, root.join("alias")).unwrap();
    let backend = ExecutionBackend::Local {
        workspace_cwd: root.clone(),
    };
    let command = "git -C alias add -- checkout";
    let resources = shell_resources(command, &root, &backend);
    assert!(resources.iter().all(|r| r.hard_denial.is_none()));
    let canonical = canonicalize_authorization_resources(&resources, &backend, Path::new(""))
        .await
        .unwrap();
    let canonical_repo = repo.canonicalize().unwrap();
    let bound =
        bind_authorized_shell_command(command, &root.canonicalize().unwrap(), &canonical).unwrap();
    assert!(bound.starts_with("/usr/bin/env -u GIT_DIR "), "{bound}");
    assert!(
        bound.ends_with(&format!(
            "git -C {} add -- {}",
            canonical_repo.display(),
            canonical_repo.join("checkout").display()
        )),
        "{bound}"
    );
    let command = "git -C alias add -- --output=checkout";
    let resources = shell_resources(command, &root, &backend);
    assert!(resources.iter().all(|r| r.hard_denial.is_none()));
    let canonical = canonicalize_authorization_resources(&resources, &backend, Path::new(""))
        .await
        .unwrap();
    assert_eq!(
        bind_authorized_shell_command(command, &root.canonicalize().unwrap(), &canonical).unwrap(),
        format!(
            "git -C {} add -- {}",
            canonical_repo.display(),
            canonical_repo.join("--output=checkout").display()
        )
    );
    std::fs::remove_dir_all(root).unwrap();
}
