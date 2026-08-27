use super::*;
use crate::sandbox::ExecutionBackend;

fn local(root: &Path) -> ExecutionBackend {
    ExecutionBackend::Local {
        workspace_cwd: root.to_path_buf(),
    }
}

fn broker_fixture() -> (PathBuf, Arc<PermissionBroker>) {
    let path = std::env::temp_dir()
        .join(format!("nac-permission-broker-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");
    let broker = Arc::new(PermissionBroker::new(
        path.clone(),
        "session-a".to_string(),
        PermissionBackend::Local,
        0,
        [],
    ));
    (path, broker)
}

#[test]
fn wildcard_matching_and_last_rule_win() {
    assert!(wildcard_match("*.env.*", "/repo/.env.local"));
    assert!(wildcard_match(
        "command:[git][status]*",
        "command:[git][status][--short]"
    ));
    assert!(!wildcard_match("read", "edit"));

    let policy = PermissionPolicy::for_backend(
        PermissionBackend::Podman,
        [
            PermissionRule::new("read", "*", PermissionEffect::Deny),
            PermissionRule::new("read", "*/public/*", PermissionEffect::Allow),
        ],
    );
    assert_eq!(
        policy
            .evaluate(&[PermissionResource::new("read", "/repo/private/a")], &[])
            .effect,
        PermissionEffect::Deny
    );
    assert_eq!(
        policy
            .evaluate(&[PermissionResource::new("read", "/repo/public/a")], &[])
            .effect,
        PermissionEffect::Allow
    );
}

#[test]
fn remembered_allow_satisfies_ask_but_not_configured_deny_or_hard_rule() {
    let policy = PermissionPolicy::for_backend(
        PermissionBackend::Local,
        [PermissionRule::new(
            "edit",
            "*/locked/*",
            PermissionEffect::Deny,
        )],
    );
    let grant = PermissionRule::new("edit", "*", PermissionEffect::Allow);
    assert_eq!(
        policy
            .evaluate(
                &[PermissionResource::new("edit", "/repo/locked/a")],
                std::slice::from_ref(&grant)
            )
            .effect,
        PermissionEffect::Deny
    );
    let hard = PermissionResource::new("edit", "/repo/a").with_hard_denial("protected target");
    let decision = policy.evaluate(&[hard], &[grant]);
    assert_eq!(decision.effect, PermissionEffect::Deny);
    assert_eq!(decision.hard_denial.as_deref(), Some("protected target"));
}

#[test]
fn backend_defaults_are_pragmatic_without_changing_authority() {
    let safe = PermissionResource::new("execute", "command:[rg][needle][src]");
    let arbitrary = PermissionResource::new("execute", "command:[curl][example.com]");
    assert_eq!(
        PermissionPolicy::for_backend(PermissionBackend::Local, [])
            .evaluate(std::slice::from_ref(&safe), &[])
            .effect,
        PermissionEffect::Allow
    );
    assert_eq!(
        PermissionPolicy::for_backend(PermissionBackend::Ssh, [])
            .evaluate(std::slice::from_ref(&arbitrary), &[])
            .effect,
        PermissionEffect::Ask
    );
    assert_eq!(
        PermissionPolicy::for_backend(PermissionBackend::Podman, [])
            .evaluate(&[arbitrary], &[])
            .effect,
        PermissionEffect::Allow
    );
    for action in ["execute_opaque", "execute_broad"] {
        assert_eq!(
            PermissionPolicy::for_backend(PermissionBackend::Podman, [])
                .evaluate(&[PermissionResource::new(action, "command")], &[])
                .effect,
            PermissionEffect::Ask,
            "Podman confinement must not silently authorize {action}"
        );
    }
}

#[test]
fn file_projection_adds_external_guard_and_hard_protects_metadata_and_store() {
    let root = PathBuf::from("/workspace");
    let backend = local(&root);
    let outside_path = PathBuf::from("/else/file");
    let outside = file_resources(
        "read",
        outside_path.clone(),
        &backend,
        Path::new("/state/store.db"),
        false,
    );
    assert_eq!(outside[1].action, "external_directory");
    assert_eq!(outside[1].save_resource.as_deref(), outside_path.to_str());

    let git = file_resources(
        "edit",
        root.join(".git/config"),
        &backend,
        Path::new("/state/store.db"),
        true,
    );
    assert!(git[0].hard_denial.is_some());
    let store = file_resources(
        "edit",
        PathBuf::from("/state/store.db-wal"),
        &backend,
        Path::new("/state/store.db"),
        true,
    );
    assert!(store[0].hard_denial.is_some());
}

#[cfg(unix)]
#[test]
fn local_file_projection_resolves_symlinks_and_nonexistent_final_targets() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!("nac-permission-links-{}", uuid::Uuid::new_v4()));
    let workspace = base.join("workspace");
    let external = base.join("external");
    std::fs::create_dir_all(workspace.join(".git")).unwrap();
    std::fs::create_dir_all(&external).unwrap();
    std::fs::write(external.join("secret"), "secret").unwrap();
    let store = external.join("store.db");
    std::fs::write(&store, "store").unwrap();
    symlink(&external, workspace.join("outside-link")).unwrap();
    symlink(workspace.join(".git"), workspace.join("git-link")).unwrap();
    symlink(&store, workspace.join("store-link")).unwrap();
    let backend = local(&workspace);
    let canonical_external = external.canonicalize().unwrap();

    let outside = file_resources(
        "read",
        workspace.join("outside-link/secret"),
        &backend,
        &store,
        false,
    );
    assert!(outside.iter().any(|resource| {
        resource.action == "external_directory"
            && resource.resource == canonical_external.join("secret").display().to_string()
    }));

    let nonexistent = file_resources(
        "edit",
        workspace.join("outside-link/new-file"),
        &backend,
        &store,
        true,
    );
    assert!(nonexistent.iter().any(|resource| {
        resource.action == "external_directory"
            && resource.resource == canonical_external.join("new-file").display().to_string()
    }));

    let git = file_resources(
        "edit",
        workspace.join("git-link/config"),
        &backend,
        &store,
        true,
    );
    assert!(git[0].hard_denial.is_some());
    let rm_git_alias = shell_resources("rm -f git-link/config", &workspace, &backend);
    assert!(rm_git_alias
        .iter()
        .any(|resource| { resource.action == "edit" && resource.hard_denial.is_some() }));
    let active_store = file_resources("edit", workspace.join("store-link"), &backend, &store, true);
    assert!(active_store[0].hard_denial.is_some());

    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn shell_projection_tokenizes_segments_and_never_generalizes_opaque_or_banned_commands() {
    let backend = local(Path::new("/workspace"));
    let resources = shell_resources(
        "git status --short && cargo test -p nac-core",
        Path::new("/workspace"),
        &backend,
    );
    assert_eq!(resources.len(), 5);
    assert_eq!(resources[0].resource, "command:[git][status][--short]");
    assert!(
        resources
            .iter()
            .filter(|resource| resource.action == "execute_broad")
            .count()
            == 2
    );
    assert!(resources
        .iter()
        .all(|resource| resource.save_resource.is_none()));
    assert_eq!(resources[4].action, "execute_cwd");

    let opaque = shell_resources("bash -c '$(dynamic)'", Path::new("/workspace"), &backend);
    assert!(opaque[0].resource.starts_with("opaque:sha256:"));
    assert!(opaque[0].save_resource.is_none());
    assert_eq!(opaque[1].action, "execute_opaque");
    let removal = shell_resources("rm -rf target", Path::new("/workspace"), &backend);
    assert_eq!(
        removal[0].save_resource.as_deref(),
        Some("command:[rm][-rf][target]")
    );
    assert!(
        shell_resources("/usr/bin/python -c pass", Path::new("/workspace"), &backend)
            .iter()
            .all(|resource| resource.save_resource.is_none())
    );
    for command in ["echo $HOME", "cargo test > /tmp/result", "cat < input"] {
        let opaque = shell_resources(command, Path::new("/workspace"), &backend);
        assert!(opaque[0].resource.starts_with("opaque:sha256:"));
        assert!(opaque[0].save_resource.is_none());
    }
}

#[test]
fn hard_shell_policy_blocks_authority_amplification_and_broad_deletion_only() {
    let backend = local(Path::new("/workspace"));
    assert!(
        shell_resources("sudo make install", Path::new("/workspace"), &backend)[0]
            .hard_denial
            .is_some()
    );
    assert!(
        shell_resources("rm -rf .", Path::new("/workspace"), &backend)[0]
            .hard_denial
            .is_some()
    );
    assert!(
        shell_resources("rm -rf target", Path::new("/workspace"), &backend)[0]
            .hard_denial
            .is_none()
    );
    assert!(
        shell_resources("git reset --hard", Path::new("/workspace"), &backend)[0]
            .hard_denial
            .is_some()
    );
    assert!(shell_resources(
        "git -C /workspace reset --hard",
        Path::new("/workspace"),
        &backend
    )[0]
    .hard_denial
    .is_some());
    for command in [
            "command sudo make install",
            "command -- sudo make install",
            "env MODE=test sudo make install",
            "env -u SAFE sudo make install",
            "env -a nac-rm rm -rf .",
            "env --argv0=nac-rm rm -rf .",
            "exec -a installer sudo make install",
            "nice -n 1 sudo make install",
            "nice --adjustment 0 rm -rf .",
            "timeout 30 rm -rf .",
            "timeout --kill-after 1 30 rm -rf .",
            "setsid rm -rf .",
            "stdbuf -oL rm -rf .",
            "busybox rm -rf /workspace",
            "sudo make install > /tmp/result",
            "git checkout .",
            "git -c alias.pwn='!git reset --hard' pwn",
            "git -calias.pwn='!sudo id' pwn",
            "git -c include.path=.nac-alias pwn",
            "git -cincludeIf.onbranch:main.path=.nac-alias pwn",
            "git --config-env=alias.pwn=ALIAS pwn",
            "git --config-env alias.pwn=ALIAS pwn",
            "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.pwn GIT_CONFIG_VALUE_0='!git reset --hard' git pwn",
            "env GIT_CONFIG_GLOBAL=.nac-alias git pwn",
            "sh -c 'git reset --hard'",
            "bash -lc 'sudo make install'",
            "bash --rcfile /dev/null -c 'sudo make install'",
            "env -S 'sudo make install'",
            "env -S'sudo make install'",
            "env -Sgit reset --hard",
            "env --split-string='sudo make install'",
            "env --split-string='sudo\\_id'",
            "env \"-Sgit\\_reset\\_--hard\"",
            "env --split-string='${PROTECTED_COMMAND} id'",
            "env -S 'unlink .git/config'",
            "env -S 'rmdir .git/empty'",
            "xargs -n1 sudo true",
            "xargs sh -c",
            "xargs --unknown-option value",
            "find . -exec sudo true \\;",
            "rg --pre sudo needle .",
            "rg --pre=sudo needle .",
            "script -q /dev/null rm -rf .",
            "script -q -c 'rm -rf .' /dev/null",
            "flock Cargo.lock unlink .git/config",
            "prlimit -- bash",
            "prlimit -- rm -rf .",
            "git re\\\nset --hard",
            "sh -c 'git reset --hard' > /tmp/result",
            "sh -c 'unlink .git/config'",
            "bash -lc 'sudo make install' > /tmp/result",
            "! git status",
            "! git reset --hard",
            "{ git reset --hard; }",
            "if true; then git reset --hard; fi",
            "! rm -rf $PWD",
            "{ rm -rf $PWD; }",
            "true; ! rm -rf $PWD",
            "true\n! rm -rf $PWD",
            "# harmless\n! rm -rf $PWD",
            ": && ! rm -rf $PWD",
            "time ! rm -rf $PWD",
            "time -p ! rm -rf $PWD",
            "/usr/bin/time -o /tmp/nac-time rm -rf \"$PWD\"",
            "time --format=%e --output /tmp/nac-time rm -rf \"$PWD\"",
            "coproc rm -rf /workspace",
            "rm -rf \"$PWD\"",
            "env MODE=test rm -rf \"$PWD\"",
            "sh -c 'rm -rf \"$PWD\"'",
            "\\\n! rm -rf $PWD",
            "true; { rm -rf $PWD; }",
            "( ! rm -rf $PWD )",
            ": > /tmp/nac-map; ! rm -rf $PWD",
            "printf x | { rm -rf $PWD; }",
            "echo $( ! rm -rf $PWD )",
            "find . -delete",
            "xargs rm -rf .git",
            "sh -c 'rm -rf .git'",
            "eval 'rm -rf .'",
            "{rm,-rf} .",
            "[r]m -rf .",
            "rm -rf .g*",
            "unlink .g*/config",
            "rmdir .g*/empty",
            "x=; c=r${x}m; \"$c\" -rf .",
        ] {
            assert!(
                shell_resources(command, Path::new("/workspace"), &backend)[0]
                    .hard_denial
                    .is_some(),
                "wrapper or opaque syntax must not bypass hard denial: {command}"
            );
        }

    let negated_status = shell_resources("! git status", Path::new("/workspace"), &backend);
    assert_eq!(
        negated_status[0].save_resource.as_deref(),
        Some("command:[%21][git][status]")
    );

    for command in [
        "ifx true",
        "functionality --help",
        "printf '! rm -rf $PWD'",
        "echo '{ rm -rf $PWD; }'",
        "printf '%s' '!'",
        "true && printf '!'",
        "[[x --help",
        "casefold --help",
        "!foo rm -rf $PWD",
        "printf '%s' 'rm -rf $PWD'",
        "/usr/bin/time -o /tmp/nac-time printf '%s' 'rm -rf $PWD'",
        "timeout 30 printf '%s' 'rm -rf $PWD'",
        "env -a harmless printf '%s' 'rm -rf $PWD'",
        "nice --adjustment 0 printf '%s' 'rm -rf $PWD'",
        "[ -f file ]",
        "printf '%s\\n' {rm,-rf} .",
        "printf '%s\\n' .g*",
    ] {
        assert!(
            shell_resources(command, Path::new("/workspace"), &backend)[0]
                .hard_denial
                .is_none(),
            "data or a keyword prefix must not be mistaken for shell control: {command}"
        );
    }

    for command in [
        "GIT_CONFIG_COUNT=1 Git status",
        "RG --pre=sudo needle .",
        "Cargo build --config=build.rustc-wrapper=wrapper",
    ] {
        let resources = shell_resources(command, Path::new("/workspace"), &backend);
        assert!(
            resources
                .iter()
                .any(|resource| resource.hard_denial.is_some())
                || resources
                    .iter()
                    .any(|resource| resource.action == "execute_broad"),
            "specialized authority recognition must be case-insensitive: {command}"
        );
    }

    let harmless = shell_resources(
        "env '-Sgit_reset_--hard'",
        Path::new("/workspace"),
        &backend,
    );
    let escaped = shell_resources(
        "env \"-Sgit\\_reset\\_--hard\"",
        Path::new("/workspace"),
        &backend,
    );
    assert_ne!(harmless[0].resource, escaped[0].resource);
    assert!(harmless[0].hard_denial.is_some());
    assert!(escaped[0].hard_denial.is_some());

    assert!(shell_resources(
        "env --split-string='printf\\qok'",
        Path::new("/workspace"),
        &backend,
    )[0]
    .hard_denial
    .is_some());
    let mut nested = "true".to_string();
    for _ in 0..9 {
        nested = format!("env -S {}", shell_quote(&nested));
    }
    assert!(
        shell_resources(&nested, Path::new("/workspace"), &backend)[0]
            .hard_denial
            .is_some()
    );

    let preprocessor = shell_resources(
        "rg --pre sh needle input.txt",
        Path::new("/workspace"),
        &backend,
    );
    assert!(preprocessor
        .iter()
        .any(|resource| resource.action == "execute_broad"));
    assert!(preprocessor
        .iter()
        .any(|resource| resource.hard_denial.is_some()));
    for command in [
        "env -S 'sh -c id'".to_string(),
        format!("env -S {}", shell_quote("env -S 'sh -c id'")),
    ] {
        assert!(
            shell_resources(&command, Path::new("/workspace"), &backend)
                .iter()
                .any(|resource| resource.action == "execute_broad"),
            "split-string interpreter must retain broad authority: {command}"
        );
    }
    assert!(shell_resources(
        "printf x | xargs -n1 sudo true",
        Path::new("/workspace"),
        &backend,
    )
    .iter()
    .any(|resource| resource.hard_denial.is_some()));
}

#[test]
fn executor_wrappers_cannot_conceal_commands_on_any_execution_backend() {
    let sandbox = ExecutionBackend::Sandbox(crate::sandbox::SandboxSession::new_for_test(
        crate::sandbox::SandboxSpec {
            workdir: PathBuf::from("/workspace"),
            ..crate::sandbox::SandboxSpec::default()
        },
    ));
    let ssh = ExecutionBackend::Ssh(crate::sandbox::SshBackend::new(
        "nobody@invalid".to_string(),
        PathBuf::from("/workspace"),
    ));
    for (name, backend) in [
        ("local", local(Path::new("/workspace"))),
        ("podman", sandbox),
        ("ssh", ssh),
    ] {
        for command in [
            "prlimit -- bash",
            "prlimit -- rm -rf .",
            "setpriv --no-new-privs sh -c 'rm -f .git/config'",
            "unshare --map-root-user sh -c 'rm -f .git/config'",
            "nsenter --target 1 --mount sh -c 'rm -f .git/config'",
            "chroot . sh -c 'rm -f .git/config'",
            "rsync --daemon --config=rsyncd.conf",
            "rsync -e sh source destination",
            "rsync --rsync-path=sh source host:destination",
            "RSYNC_RSH=sh rsync source host:destination",
            "RSYNC_CONNECT_PROG=sh rsync source host::module",
            "RSYNC_RSH+=sh rsync source host:destination",
            "RSYNC_CONNECT_PROG+=sh rsync source host::module",
            "LD_PRELOAD=./payload.so ls",
            "env LD_PRELOAD=./payload.so ls",
            "LD_AUDIT=./payload.so ls",
            "LD_LIBRARY_PATH=./payload ls",
            "LD_LIBRARY_PATH+=:./payload ls",
            "DYLD_INSERT_LIBRARIES=./payload.dylib ls",
            "export LD_PRELOAD=./payload.so",
            "export LD_PRELOAD=./payload.so; /bin/true",
            "command export LD_AUDIT=./payload.so",
            "builtin readonly LD_LIBRARY_PATH=./payload",
            "declare -x LD_PRELOAD+=:./payload.so",
            "typeset -x LD_AUDIT=./payload.so",
            "export LD_PRELOAD; printf -v LD_PRELOAD %b '\\x2fworkspace\\x2fpayload.so'; ls",
            "command printf -vLD_AUDIT %s ./payload.so; /bin/true",
            "declare -n p=LD_LIBRARY_PATH; p=./payload; export LD_LIBRARY_PATH; /bin/true",
            "builtin typeset -xn p=LD_PRELOAD; p=./payload.so; /bin/true",
            "set -a; let LD_LIBRARY_PATH=1; ls",
            "set -o allexport; read LD_PRELOAD; ls",
            "shopt -s lastpipe; set -a; printf %s 1 | read LD_LIBRARY_PATH; ls",
            "read -r LD_PRELOAD; ls",
            "let 'LD_LIBRARY_PATH=1'; ls",
        ] {
            assert!(
                shell_resources(command, Path::new("/workspace"), &backend)
                    .iter()
                    .any(|resource| resource.hard_denial.is_some()),
                "{name} backend admitted concealed command: {command}"
            );
        }
        for command in [
            "printf '%s\\n' RSYNC_RSH=literal",
            "printf '%s\\n' RSYNC_CONNECT_PROG=literal",
            "printf '%s\\n' LD_PRELOAD=literal",
            "set +a; printf '%s\\n' LD_PRELOAD=literal",
            "printf '%s\\n' 'set -a; let LD_LIBRARY_PATH=1; ls'",
        ] {
            assert!(
                shell_resources(command, Path::new("/workspace"), &backend)[0]
                    .hard_denial
                    .is_none(),
                "{name} backend rejected harmless assignment-shaped data: {command}"
            );
        }
    }
}

#[test]
fn opaque_redirection_fails_closed_on_every_execution_backend() {
    let sandbox = ExecutionBackend::Sandbox(crate::sandbox::SandboxSession::new_for_test(
        crate::sandbox::SandboxSpec {
            workdir: PathBuf::from("/workspace"),
            ..crate::sandbox::SandboxSpec::default()
        },
    ));
    let ssh = ExecutionBackend::Ssh(crate::sandbox::SshBackend::new(
        "nobody@invalid".to_string(),
        PathBuf::from("/workspace"),
    ));
    for (name, backend) in [
        ("local", local(Path::new("/workspace"))),
        ("podman", sandbox),
        ("ssh", ssh),
    ] {
        for command in [
            "printf pwned > config-link",
            "printf pwned 2>> store-link",
            "cat < input-link",
        ] {
            let resources = shell_resources(command, Path::new("/workspace"), &backend);
            assert!(
                resources.iter().any(|resource| {
                    resource
                        .hard_denial
                        .as_deref()
                        .is_some_and(|reason| reason.contains("redirection"))
                }),
                "{name} did not reject opaque redirection: {command}"
            );
        }
    }

    let quoted = shell_resources(
        "printf '%s' 'literal>a<value'",
        Path::new("/workspace"),
        &local(Path::new("/workspace")),
    );
    assert!(quoted.iter().all(|resource| resource.hard_denial.is_none()));
}

#[cfg(unix)]
#[tokio::test]
async fn command_workdir_is_canonicalized_before_policy() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!(
        "nac-command-workdir-permission-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = base.join("workspace");
    let outside = base.join("outside");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    symlink(&outside, workspace.join("link")).unwrap();
    let backend = local(&workspace);
    let projected = shell_resources("rg needle", &workspace.join("link"), &backend);
    let canonical = canonicalize_authorization_resources(&projected, &backend, Path::new(""))
        .await
        .unwrap();
    assert!(canonical.iter().any(|resource| {
        resource.action == "execute_cwd"
            && resource.resource == outside.canonicalize().unwrap().display().to_string()
    }));
    assert!(canonical.iter().any(|resource| {
        resource.action == "external_directory"
            && resource.resource == outside.canonicalize().unwrap().display().to_string()
    }));
    let _ = std::fs::remove_dir_all(base);
}

#[cfg(unix)]
#[tokio::test]
async fn rm_binding_preserves_a_final_symlink_instead_of_deleting_its_target() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!("nac-rm-final-link-{}", uuid::Uuid::new_v4()));
    let workspace = base.join("workspace");
    let external = base.join("external");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&external).unwrap();
    symlink(&external, workspace.join("link")).unwrap();
    let backend = local(&workspace);
    let command = "rm -rf link";
    let projected = shell_resources(command, &workspace, &backend);
    let authorized = canonicalize_authorization_resources(
        &projected,
        &backend,
        Path::new("/unrelated/store.db"),
    )
    .await
    .unwrap();
    assert!(authorized.iter().any(|resource| {
        resource.action == "edit"
            && resource.resource
                == workspace
                    .canonicalize()
                    .unwrap()
                    .join("link")
                    .display()
                    .to_string()
    }));
    let bound =
        bind_authorized_shell_command(command, &workspace.canonicalize().unwrap(), &authorized)
            .unwrap();
    assert_eq!(
        bound,
        format!(
            "rm -rf {}",
            workspace.canonicalize().unwrap().join("link").display()
        )
    );
    assert!(!bound.ends_with(external.canonicalize().unwrap().to_str().unwrap()));

    let _ = std::fs::remove_dir_all(base);
}

#[cfg(unix)]
#[tokio::test]
async fn rm_final_symlink_keeps_requested_git_path_hard_denial() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!("nac-rm-git-final-link-{}", uuid::Uuid::new_v4()));
    let workspace = base.join("workspace");
    let external = base.join("external-file");
    std::fs::create_dir_all(workspace.join(".git")).unwrap();
    std::fs::write(&external, "outside").unwrap();
    symlink(&external, workspace.join(".git/escape")).unwrap();
    let backend = local(&workspace);
    let command = "rm -f .git/escape";
    let projected = shell_resources(command, &workspace, &backend);
    let authorized = canonicalize_authorization_resources(
        &projected,
        &backend,
        Path::new("/unrelated/store.db"),
    )
    .await
    .unwrap();
    let requested = workspace.canonicalize().unwrap().join(".git/escape");
    let deletion = authorized
        .iter()
        .find(|resource| resource.action == "edit")
        .expect("rm deletion resource");
    assert_eq!(deletion.resource, requested.display().to_string());
    assert!(deletion.hard_denial.is_some());
    assert_eq!(
        deletion.shell_binding.as_deref(),
        Some(requested.to_str().unwrap())
    );
    let bound =
        bind_authorized_shell_command(command, &workspace.canonicalize().unwrap(), &authorized)
            .unwrap();
    assert_eq!(bound, format!("rm -f {}", requested.display()));
    assert!(!bound.contains(external.canonicalize().unwrap().to_str().unwrap()));

    let _ = std::fs::remove_dir_all(base);
}

#[cfg(unix)]
#[tokio::test]
async fn unlink_and_rmdir_preserve_named_entries_and_git_mutation_policy() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!(
        "nac-delete-entry-permission-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = base.join("workspace");
    let external = base.join("external");
    std::fs::create_dir_all(workspace.join(".git")).unwrap();
    std::fs::create_dir_all(&external).unwrap();
    std::fs::write(external.join("config"), "outside").unwrap();
    symlink(&external, workspace.join(".git/link")).unwrap();
    let backend = local(&workspace);

    for command in ["unlink .git/link", "rmdir .git/link"] {
        let projected = shell_resources(command, &workspace, &backend);
        let authorized = canonicalize_authorization_resources(
            &projected,
            &backend,
            Path::new("/unrelated/store.db"),
        )
        .await
        .unwrap();
        let requested = workspace.canonicalize().unwrap().join(".git/link");
        let deletion = authorized
            .iter()
            .find(|resource| resource.action == "edit")
            .expect("deletion resource");
        assert_eq!(deletion.resource, requested.display().to_string());
        assert!(deletion.hard_denial.is_some());
        assert_eq!(
            deletion.shell_binding.as_deref(),
            Some(requested.to_str().unwrap())
        );
        let bound =
            bind_authorized_shell_command(command, &workspace.canonicalize().unwrap(), &authorized)
                .unwrap();
        assert_eq!(
            bound,
            format!(
                "{} {}",
                command.split_whitespace().next().unwrap(),
                requested.display()
            )
        );
        assert!(!bound.contains(external.canonicalize().unwrap().to_str().unwrap()));
    }

    let _ = std::fs::remove_dir_all(base);
}

#[cfg(unix)]
#[tokio::test]
async fn bare_relative_command_paths_are_canonicalized_and_bound_into_the_command() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!(
        "nac-command-path-permission-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = base.join("workspace");
    let outside = base.join("outside");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret"), "needle").unwrap();
    std::fs::write(outside.join("tool"), "#!/bin/sh\n").unwrap();
    std::fs::write(workspace.join("local"), "needle").unwrap();
    symlink(&outside, workspace.join("outside-link")).unwrap();
    let backend = local(&workspace);
    let projected = shell_resources("rg needle outside-link/secret", &workspace, &backend);
    let canonical = canonicalize_authorization_resources(&projected, &backend, Path::new(""))
        .await
        .unwrap();
    let canonical_secret = outside.canonicalize().unwrap().join("secret");
    assert!(canonical.iter().any(|resource| {
        resource.action == "execute_path"
            && resource.resource == canonical_secret.display().to_string()
    }));
    assert!(canonical.iter().any(|resource| {
        resource.action == "external_directory"
            && resource.resource == canonical_secret.display().to_string()
    }));

    let bound = bind_authorized_shell_command(
        "rg needle outside-link/secret",
        &workspace.canonicalize().unwrap(),
        &canonical,
    )
    .unwrap();
    assert_eq!(bound, format!("rg needle {}", canonical_secret.display()));
    assert!(!bound.contains("outside-link"));

    let empty_pattern_projected =
        shell_resources("rg '' outside-link/secret", &workspace, &backend);
    let empty_pattern_canonical =
        canonicalize_authorization_resources(&empty_pattern_projected, &backend, Path::new(""))
            .await
            .unwrap();
    assert!(empty_pattern_canonical.iter().any(|resource| {
        resource.action == "execute_path"
            && resource.resource == canonical_secret.display().to_string()
    }));
    assert_eq!(
        bind_authorized_shell_command(
            "rg '' outside-link/secret",
            &workspace.canonicalize().unwrap(),
            &empty_pattern_canonical,
        )
        .unwrap(),
        format!("rg '' {}", canonical_secret.display())
    );

    let directory_projected = shell_resources("rg -L needle outside-link", &workspace, &backend);
    let directory_canonical =
        canonicalize_authorization_resources(&directory_projected, &backend, Path::new(""))
            .await
            .unwrap();
    let canonical_outside = outside.canonicalize().unwrap();
    assert!(directory_canonical.iter().any(|resource| {
        resource.action == "execute_path"
            && resource.resource == canonical_outside.display().to_string()
    }));
    assert_eq!(
        bind_authorized_shell_command(
            "rg -L needle outside-link",
            &workspace.canonicalize().unwrap(),
            &directory_canonical,
        )
        .unwrap(),
        format!("rg -L needle {}", canonical_outside.display())
    );

    let cargo_manifest = outside.join("Cargo.toml");
    std::fs::write(
        &cargo_manifest,
        "[package]\nname='outside'\nversion='0.1.0'\n",
    )
    .unwrap();
    let cargo_command = "cargo build --manifest-path=outside-link/Cargo.toml";
    let cargo_projected = shell_resources(cargo_command, &workspace, &backend);
    let cargo_canonical =
        canonicalize_authorization_resources(&cargo_projected, &backend, Path::new(""))
            .await
            .unwrap();
    assert!(cargo_canonical.iter().any(|resource| {
        resource.action == "external_directory"
            && resource
                .resource
                .starts_with(canonical_outside.to_str().unwrap())
    }));
    assert_eq!(
        bind_authorized_shell_command(
            cargo_command,
            &workspace.canonicalize().unwrap(),
            &cargo_canonical,
        )
        .unwrap(),
        format!(
            "cargo build --manifest-path={}",
            cargo_manifest.canonicalize().unwrap().display()
        )
    );

    let git_projected = shell_resources(
        "git diff --no-index local outside-link/secret",
        &workspace,
        &backend,
    );
    let git_canonical =
        canonicalize_authorization_resources(&git_projected, &backend, Path::new(""))
            .await
            .unwrap();
    let canonical_local = workspace.canonicalize().unwrap().join("local");
    assert_eq!(
        bind_authorized_shell_command(
            "git diff --no-index local outside-link/secret",
            &workspace.canonicalize().unwrap(),
            &git_canonical,
        )
        .unwrap(),
        format!(
            "git diff --no-index {} {}",
            canonical_local.display(),
            canonical_secret.display()
        )
    );

    let executable_projected = shell_resources("./outside-link/tool", &workspace, &backend);
    let executable_canonical =
        canonicalize_authorization_resources(&executable_projected, &backend, Path::new(""))
            .await
            .unwrap();
    let canonical_tool = canonical_outside.join("tool");
    assert_eq!(
        bind_authorized_shell_command(
            "./outside-link/tool",
            &workspace.canonicalize().unwrap(),
            &executable_canonical,
        )
        .unwrap(),
        canonical_tool.display().to_string()
    );

    let slash_executable_projected = shell_resources("outside-link/tool", &workspace, &backend);
    let slash_executable_canonical =
        canonicalize_authorization_resources(&slash_executable_projected, &backend, Path::new(""))
            .await
            .unwrap();
    assert_eq!(
        bind_authorized_shell_command(
            "outside-link/tool",
            &workspace.canonicalize().unwrap(),
            &slash_executable_canonical,
        )
        .unwrap(),
        canonical_tool.display().to_string()
    );

    let repo = workspace.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    std::fs::write(repo.join("local"), "needle").unwrap();
    symlink(&outside, repo.join("outside-link")).unwrap();
    let git_global_projected = shell_resources(
        "git -C repo diff --no-index local outside-link/secret",
        &workspace,
        &backend,
    );
    let git_global_canonical =
        canonicalize_authorization_resources(&git_global_projected, &backend, Path::new(""))
            .await
            .unwrap();
    let canonical_repo = repo.canonicalize().unwrap();
    assert_eq!(
        bind_authorized_shell_command(
            "git -C repo diff --no-index local outside-link/secret",
            &workspace.canonicalize().unwrap(),
            &git_global_canonical,
        )
        .unwrap(),
        format!(
            "git -C {} diff --no-index {} {}",
            canonical_repo.display(),
            canonical_repo.join("local").display(),
            canonical_secret.display()
        )
    );

    let nested = repo.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    let repeated_c = shell_resources("git -C repo -C nested status", &workspace, &backend);
    let repeated_c = canonicalize_authorization_resources(&repeated_c, &backend, Path::new(""))
        .await
        .unwrap();
    assert_eq!(
        bind_authorized_shell_command(
            "git -C repo -C nested status",
            &workspace.canonicalize().unwrap(),
            &repeated_c,
        )
        .unwrap(),
        format!(
            "git -C {} -C {} status",
            canonical_repo.display(),
            nested.canonicalize().unwrap().display()
        )
    );

    let attached_c_command = "git -Coutside-link status";
    let attached_c = shell_resources(attached_c_command, &workspace, &backend);
    let attached_c = canonicalize_authorization_resources(&attached_c, &backend, Path::new(""))
        .await
        .unwrap();
    assert!(attached_c.iter().any(|resource| {
        resource.action == "external_directory"
            && resource.resource == canonical_outside.display().to_string()
    }));
    assert_eq!(
        bind_authorized_shell_command(
            attached_c_command,
            &workspace.canonicalize().unwrap(),
            &attached_c,
        )
        .unwrap(),
        format!("git -C{} status", canonical_outside.display())
    );

    let git_dir_command = "git --git-dir=outside-link/repo/.git status";
    let git_dir = shell_resources(git_dir_command, &workspace, &backend);
    let git_dir = canonicalize_authorization_resources(&git_dir, &backend, Path::new(""))
        .await
        .unwrap();
    assert!(git_dir.iter().any(|resource| {
        resource.action == "external_directory"
            && resource
                .resource
                .starts_with(canonical_outside.to_str().unwrap())
    }));
    assert_eq!(
        bind_authorized_shell_command(
            git_dir_command,
            &workspace.canonicalize().unwrap(),
            &git_dir,
        )
        .unwrap(),
        format!(
            "git --git-dir={} status",
            canonical_outside.join("repo/.git").display()
        )
    );

    let work_tree_command = "git -C repo --work-tree outside-link status";
    let work_tree = shell_resources(work_tree_command, &workspace, &backend);
    let work_tree = canonicalize_authorization_resources(&work_tree, &backend, Path::new(""))
        .await
        .unwrap();
    assert_eq!(
        bind_authorized_shell_command(
            work_tree_command,
            &workspace.canonicalize().unwrap(),
            &work_tree,
        )
        .unwrap(),
        format!(
            "git -C {} --work-tree {} status",
            canonical_repo.display(),
            canonical_outside.display()
        )
    );

    for command in [
        "git grep -C2 needle",
        "git diff -C50%",
        "git grep -C 2 needle",
    ] {
        let resources = shell_resources(command, &workspace, &backend);
        let bound = bind_authorized_shell_command(command, &workspace, &resources).unwrap();
        assert_eq!(bound, command, "subcommand -C value must remain data");
    }
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn broad_commands_and_shell_path_arguments_project_independent_guards() {
    let backend = local(Path::new("/workspace"));
    let broad = shell_resources(
        "env MODE=test bash -c true",
        Path::new("/workspace"),
        &backend,
    );
    assert!(broad
        .iter()
        .any(|resource| resource.action == "execute_broad"));
    assert!(broad.iter().any(|resource| {
        resource.action == "execute_broad"
            && resource
                .display
                .contains("trusted arbitrary code execution")
            && resource
                .display
                .contains("parser protected-path rules cannot constrain code inside it")
    }));
    assert!(broad
        .iter()
        .all(|resource| resource.save_resource.is_none()));

    for command in [
        "rg needle /outside/.env",
        "cargo test --manifest-path /outside/Cargo.toml",
        "cargo build --config /outside/cargo-config.toml",
        "make -f /outside/Makefile",
        "git diff --no-index /workspace/a /outside/b",
        "git diff --output=/outside/diff.txt",
    ] {
        let resources = shell_resources(command, Path::new("/workspace"), &backend);
        assert!(resources
            .iter()
            .any(|resource| { matches!(resource.action.as_str(), "execute_path" | "edit") }));
        assert!(
            resources.iter().any(|resource| {
                resource.action == "external_directory" && resource.resource.starts_with("/outside")
            }),
            "external command path must be independently authorized: {command}"
        );
    }

    let protected_output = shell_resources(
        "git diff --no-index --output=.git/config README.md Cargo.toml",
        Path::new("/workspace"),
        &backend,
    );
    assert!(protected_output
        .iter()
        .any(|resource| resource.action == "edit" && resource.hard_denial.is_some()));

    let cargo_key_value = "cargo build --config net.git-fetch-with-cli=true";
    let cargo_key_value_resources =
        shell_resources(cargo_key_value, Path::new("/workspace"), &backend);
    assert!(!cargo_key_value_resources
        .iter()
        .any(|resource| matches!(resource.action.as_str(), "execute_path" | "edit")));
    assert_eq!(
        bind_authorized_shell_command(
            cargo_key_value,
            Path::new("/workspace"),
            &cargo_key_value_resources,
        )
        .unwrap(),
        cargo_key_value
    );
    assert!(cargo_key_value_resources
        .iter()
        .any(|resource| resource.action == "execute_broad"));

    let attached_cargo_key_value = "cargo build --config=net.git-fetch-with-cli=true";
    let attached_cargo_key_value_resources =
        shell_resources(attached_cargo_key_value, Path::new("/workspace"), &backend);
    assert!(!attached_cargo_key_value_resources
        .iter()
        .any(|resource| matches!(resource.action.as_str(), "execute_path" | "edit")));
    assert!(attached_cargo_key_value_resources
        .iter()
        .any(|resource| resource.action == "execute_broad"));
    assert_eq!(
        bind_authorized_shell_command(
            attached_cargo_key_value,
            Path::new("/workspace"),
            &attached_cargo_key_value_resources,
        )
        .unwrap(),
        attached_cargo_key_value
    );

    let executable_config = shell_resources(
        "cargo build --config 'build.rustc-wrapper=\"/outside/wrapper\"'",
        Path::new("/workspace"),
        &backend,
    );
    assert!(executable_config
        .iter()
        .any(|resource| resource.action == "execute_broad"));

    for command in [
        "cargo build --config .cargo/authority.toml",
        "cargo build --config=.cargo/authority.toml",
        "Cargo build --config=.cargo/authority.toml",
    ] {
        let resources = shell_resources(command, Path::new("/workspace"), &backend);
        assert!(
            resources
                .iter()
                .any(|resource| resource.action == "execute_broad"),
            "Cargo configuration files can carry executable settings: {command}"
        );
    }

    for command in [
        "cargo build --target-dir=.git/nac-target",
        "cargo test --target-dir .git/nac-target",
        "cargo build --lockfile-path=.git/nac-lock",
        "Cargo build --target-dir=.git/nac-target",
    ] {
        let resources = shell_resources(command, Path::new("/workspace"), &backend);
        assert!(
            resources
                .iter()
                .any(|resource| { resource.action == "edit" && resource.hard_denial.is_some() }),
            "Cargo output paths beneath Git metadata must be blocked: {command}"
        );
    }

    for command in [
        "tee .git/nac-owned",
        "touch .git/nac-owned",
        "dd if=/dev/null of=.git/nac-owned",
        "sed -i s/a/b/ .git/config",
        "rm -f .git/config",
        "unzip archive.zip -d .git/hooks",
        "wget https://example.invalid/config -O .git/config",
    ] {
        let resources = shell_resources(command, Path::new("/workspace"), &backend);
        assert!(resources
            .iter()
            .any(|resource| { resource.action == "edit" && resource.hard_denial.is_some() }));
    }
    for command in [
        "rm -f Cargo.toml",
        "rm -f src/lib.rs",
        "rm -f -- Cargo.lock",
        "rm README.md Cargo.toml",
        "rm -f .gitconfig",
    ] {
        let resources = shell_resources(command, Path::new("/workspace"), &backend);
        assert!(
            resources.iter().any(|resource| resource.action == "edit"),
            "every rm operand must project as a mutation: {command}"
        );
    }
    assert!(shell_resources(
        "printf pwned > .git/nac-owned",
        Path::new("/workspace"),
        &backend,
    )[0]
    .hard_denial
    .is_some());

    let git_status = shell_resources("git -C repo status", Path::new("/workspace"), &backend);
    assert!(git_status
        .iter()
        .any(|resource| resource.action == "execute_broad"));
    assert!(git_status
        .iter()
        .all(|resource| resource.save_resource.is_none()));
    let incomplete_git = shell_resources("git -C repo", Path::new("/workspace"), &backend);
    assert!(incomplete_git
        .iter()
        .all(|resource| resource.save_resource.is_none()));

    let formatting = "rg -n --field-match-separator=a/b needle .";
    let formatting_resources = shell_resources(formatting, Path::new("/workspace"), &backend);
    assert!(!formatting_resources.iter().any(|resource| {
        resource.action == "execute_path" && resource.resource.ends_with("/a/b")
    }));
    let formatting_bound =
        bind_authorized_shell_command(formatting, Path::new("/workspace"), &formatting_resources)
            .unwrap();
    assert!(formatting_bound.contains("--field-match-separator=a/b"));
    assert!(!formatting_bound.contains("--field-match-separator=/workspace/a/b"));

    let separated_formatting = "rg needle --field-match-separator a/b .";
    let separated_resources =
        shell_resources(separated_formatting, Path::new("/workspace"), &backend);
    let separated_bound = bind_authorized_shell_command(
        separated_formatting,
        Path::new("/workspace"),
        &separated_resources,
    )
    .unwrap();
    assert!(separated_bound.contains("--field-match-separator a/b"));
    assert!(!separated_bound.contains("--field-match-separator /workspace/a/b"));

    let env_split = shell_resources("env -S 'printf ok'", Path::new("/workspace"), &backend);
    assert!(!env_split[0]
        .save_resource
        .as_deref()
        .expect("env split-string should have an exact save resource")
        .ends_with('*'));
}

#[test]
fn direct_shell_path_arguments_fail_closed_against_ancestor_replacement() {
    let backend = local(Path::new("/workspace"));
    for command in [
        "rm safe/config",
        "rg needle ./safe",
        "cp ./safe/source ./safe/config",
    ] {
        let resources = shell_resources(command, Path::new("/workspace"), &backend);
        let path = resources
            .iter()
            .find(|resource| resource.shell_binding.is_some())
            .unwrap_or_else(|| panic!("{command} did not project a shell path"));
        assert!(path.hard_denial.as_deref().is_some_and(|reason| {
            reason.contains("cannot remain bound across concurrent ancestor replacement")
        }));
        assert!(path.save_resource.is_none());
    }

    let broad = shell_resources(
        "python3 ./safe/script.py",
        Path::new("/workspace"),
        &backend,
    );
    assert!(broad
        .iter()
        .filter(|resource| resource.shell_binding.is_some())
        .all(|resource| resource.hard_denial.is_none()));
    assert!(broad.iter().any(|resource| {
        resource.action == "execute_broad"
            && resource
                .display
                .contains("trusted arbitrary code execution")
    }));
}

#[cfg(unix)]
#[tokio::test]
async fn bare_relative_mutation_operands_cannot_hide_protected_symlinks() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!("nac_bare_shell_path_{}", uuid::Uuid::new_v4()));
    let workspace = base.join("workspace");
    std::fs::create_dir_all(workspace.join(".git")).unwrap();
    std::fs::write(workspace.join(".git/config"), "protected").unwrap();
    std::fs::write(workspace.join("payload"), "payload").unwrap();
    symlink(".git/config", workspace.join("config-link")).unwrap();
    symlink(".git", workspace.join("git-link")).unwrap();
    let backend = local(&workspace);
    let protected = std::fs::canonicalize(workspace.join(".git/config")).unwrap();

    for command in [
        "cp payload config-link",
        "chmod 0644 config-link",
        "rsync payload git-link/config",
    ] {
        let projected = shell_resources(command, &workspace, &backend);
        let resources =
            canonicalize_authorization_resources(&projected, &backend, &base.join("store.db"))
                .await
                .unwrap();
        assert!(
            resources.iter().any(|resource| {
                resource.action == "edit"
                    && resource.resource == protected.display().to_string()
                    && resource.hard_denial.is_some()
            }),
            "bare mutation operand did not retain protected authority: {command}: {resources:?}"
        );
    }

    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn project_code_commands_are_broad_and_leave_no_reusable_fragments() {
    let backend = local(Path::new("/workspace"));
    for command in [
        "cargo check",
        "make test",
        "GIT_EXTERNAL_DIFF=./payload git diff --ext-diff",
        "git status --short",
    ] {
        let resources = shell_resources(command, Path::new("/workspace"), &backend);
        assert!(
            resources
                .iter()
                .any(|resource| resource.action == "execute_broad"),
            "project-code command was not disclosed as broad: {command}"
        );
        assert!(
            resources
                .iter()
                .all(|resource| resource.save_resource.is_none()),
            "broad invocation exposed a reusable partial grant: {command}"
        );
    }
}

#[tokio::test]
async fn headless_ask_fails_closed_without_creating_a_waiter() {
    let (path, broker) = broker_fixture();
    let outcome = broker
        .authorize(
            "exec_command",
            &[PermissionResource::new(
                "execute",
                "command:[curl][example.com]",
            )],
            &crate::tools::kernel::ToolCallContext::default(),
            &crate::tools::ThreadCancellation::default(),
        )
        .await;
    assert!(
        matches!(outcome, AuthorizationOutcome::Denied(reason) if reason.contains("no interactive"))
    );
    assert!(broker.pending().is_empty());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn delegated_child_allows_its_parent_ui_time_to_connect_and_reply() {
    let (path, broker) = broker_fixture();
    crate::store::insert_test_session(&path, "parent");
    crate::store::open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id IN ('parent', 'session-a')",
            [],
        )
        .unwrap();
    crate::store::create_traditional_child_relationship(
        &path,
        "parent",
        "session-a",
        crate::store::GENERAL_CHILD_PROFILE,
        "approval bridge",
    )
    .unwrap();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    broker.attach_event_bus(bus.clone());
    let authorize = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[PermissionResource::new(
                        "execute",
                        "command:[curl][example.com]",
                    )],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    let request = broker.pending().pop().expect("deferred child approval");
    let _parent_ui = bus.subscribe_assistant_deltas();
    broker.reply(&request.id, PermissionReply::Once).unwrap();
    assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn interactive_once_releases_exact_waiting_call_without_saving() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let authorize = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[PermissionResource::new(
                        "execute",
                        "command:[curl][example.com]",
                    )],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    let request = broker.pending().pop().expect("pending approval");
    broker.reply(&request.id, PermissionReply::Once).unwrap();
    assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
    assert!(broker.grants().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn cancellation_dismisses_the_live_prompt_and_waiting_call() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let mut events = bus.subscribe();
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let cancellation = crate::tools::ThreadCancellation::default();
    let authorize = {
        let broker = Arc::clone(&broker);
        let cancellation = cancellation.clone();
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[PermissionResource::new(
                        "execute",
                        "command:[curl][example.com]",
                    )],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &cancellation,
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    cancellation.cancel();
    assert!(matches!(
        authorize.await.unwrap(),
        AuthorizationOutcome::Denied(reason) if reason.contains("cancelled")
    ));
    assert!(broker.pending().is_empty());
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionAsked { .. }
    ));
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionDismissed { reason, .. }
            if reason.contains("cancelled")
    ));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn aborting_authorization_dismisses_prompt_before_any_stale_grant_reply() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let authorize = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[
                        PermissionResource::new("execute", "command:[curl][example.com]")
                            .with_save_resource("command:[curl]*"),
                    ],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    let request = broker.pending().pop().expect("pending approval");
    authorize.abort();
    let _ = authorize.await;
    assert!(broker.pending().is_empty());
    assert!(broker.reply(&request.id, PermissionReply::Always).is_err());
    assert!(broker.grants().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn losing_the_sole_interactive_subscriber_dismisses_approval_prompt() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let mut events = bus.subscribe();
    let interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let authorize = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[PermissionResource::new(
                        "execute",
                        "command:[curl][example.com]",
                    )],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    assert_eq!(broker.pending().len(), 1);
    drop(interactive);
    let outcome = tokio::time::timeout(Duration::from_secs(1), authorize)
        .await
        .expect("disconnect must not leave a ten-minute waiter")
        .unwrap();
    assert!(matches!(
        outcome,
        AuthorizationOutcome::Denied(reason) if reason.contains("disconnected")
    ));
    assert!(broker.pending().is_empty());
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionAsked { .. }
    ));
    assert!(matches!(
        events.recv().await.unwrap().event,
        crate::events::SessionEvent::PermissionDismissed { reason, .. }
            if reason.contains("disconnected")
    ));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn claimed_always_reply_wins_over_later_cancellation() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let cancellation = crate::tools::ThreadCancellation::default();
    let resources = vec![
        PermissionResource::new("execute", "command:[curl][example.com]")
            .with_save_resource("command:[curl][example.com]*"),
        PermissionResource::new("read", "/outside/Cargo.toml")
            .with_save_resource("/outside/Cargo.toml"),
    ];
    let authorize = {
        let broker = Arc::clone(&broker);
        let cancellation = cancellation.clone();
        let resources = resources.clone();
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &resources,
                    &crate::tools::kernel::ToolCallContext::default(),
                    &cancellation,
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    let request = broker.pending().pop().expect("pending approval");

    let lock = rusqlite::Connection::open(&path).unwrap();
    lock.busy_timeout(Duration::from_secs(5)).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    let reply = {
        let broker = Arc::clone(&broker);
        tokio::task::spawn_blocking(move || broker.reply(&request.id, PermissionReply::Always))
    };
    tokio::time::timeout(Duration::from_secs(1), async {
        while !broker.pending().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("reply must claim the pending request before persistence");
    cancellation.cancel();
    lock.execute_batch("ROLLBACK").unwrap();
    reply.await.unwrap().unwrap();

    assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
    let grants = broker.grants().unwrap();
    assert_eq!(grants.len(), 2);
    assert!(grants.iter().any(|grant| grant.action == "execute"));
    assert!(grants.iter().any(|grant| grant.action == "read"));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn abort_after_reply_claim_rolls_back_blocked_always_grant() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let authorize = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[
                        PermissionResource::new("execute", "command:[curl][example.com]")
                            .with_save_resource("command:[curl]*"),
                    ],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    let request = broker.pending().pop().expect("pending approval");
    let lock = rusqlite::Connection::open(&path).unwrap();
    lock.busy_timeout(Duration::from_secs(5)).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();

    broker.reply(&request.id, PermissionReply::Always).unwrap();
    tokio::time::sleep(Duration::from_millis(25)).await;
    authorize.abort();
    let _ = authorize.await;
    lock.execute_batch("ROLLBACK").unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(broker.grants().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn always_saves_harness_candidate_and_authorizes_headless_retry() {
    let (path, broker) = broker_fixture();
    let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
    let interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let resource = PermissionResource::new("execute", "command:[curl][example.com][status]")
        .with_save_resource("command:[curl][example.com]*");
    let authorize = {
        let broker = Arc::clone(&broker);
        let resource = resource.clone();
        tokio::spawn(async move {
            broker
                .authorize(
                    "exec_command",
                    &[resource],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    let request = broker.pending().pop().expect("pending approval");
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
    assert_eq!(broker.grants().unwrap().len(), 1);
    drop(interactive);
    assert_eq!(
        broker
            .authorize(
                "exec_command",
                &[resource],
                &crate::tools::kernel::ToolCallContext::default(),
                &crate::tools::ThreadCancellation::default(),
            )
            .await,
        AuthorizationOutcome::Allowed
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
