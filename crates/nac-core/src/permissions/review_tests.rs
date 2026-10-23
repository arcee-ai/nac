use super::*;

fn resource(action: &str, value: &str) -> PermissionResource {
    PermissionResource::new(action, value).with_display(value)
}

#[test]
fn eligibility_covers_the_initial_scope_only() {
    use PermissionBackend::{Local, Podman, Ssh};
    let eligible = [
        (vec![resource("execute", "command:[cargo][test]")], Local),
        (
            vec![
                resource("execute", "command:[ls]"),
                resource("execute_cwd", "/work"),
            ],
            Ssh,
        ),
        (
            vec![
                resource("read", "/opt/include/x.h"),
                resource("external_directory", "/opt/include/x.h"),
            ],
            Local,
        ),
        (
            vec![
                resource("execute", "command:[make]"),
                resource("execute_broad", "command:[make]"),
            ],
            Podman,
        ),
    ];
    for (resources, backend) in eligible {
        assert_eq!(
            review_eligibility(&resources, backend),
            Ok(()),
            "{resources:?}"
        );
    }
    let ineligible = [
        (vec![resource("execute_broad", "command:[python3]")], Local),
        (vec![resource("execute_broad", "command:[bash]")], Ssh),
        (vec![resource("execute_opaque", "a | b")], Podman),
        (vec![resource("terminal_input", "terminal:1")], Podman),
        (vec![resource("read", "/work/.env.local")], Local),
        (vec![resource("read", "/home/u/.ssh/id_ed25519")], Local),
        (
            vec![resource("external_directory", "/home/u/.aws/credentials")],
            Local,
        ),
        (
            vec![
                resource("edit", "/tmp/x"),
                resource("external_directory", "/tmp/x"),
            ],
            Local,
        ),
        (
            vec![
                resource("execute", "command:[ls]"),
                resource("mcp_call", "server.tool"),
            ],
            Local,
        ),
        (vec![resource("web_fetch", "https://example.com")], Local),
    ];
    for (resources, backend) in ineligible {
        assert!(
            review_eligibility(&resources, backend).is_err(),
            "{resources:?}"
        );
    }
    assert_eq!(
        review_eligibility(&[resource("read", "/work/.env.example")], Local),
        Ok(())
    );
}

#[test]
fn secret_bearing_text_is_redacted() {
    for (input, secret) in [
        (
            "curl -H Authorization: Bearer abcdefghijkl https://x",
            "abcdefghijkl",
        ),
        ("curl https://user:hunter22@example.com/x", "hunter22"),
        ("API_TOKEN=s3cr3tvalue make deploy", "s3cr3tvalue"),
        ("tool --password hunter22 --verbose", "hunter22"),
        ("tool --api-key=k_123456", "k_123456"),
        (
            "echo sk-abcdefghijklmnopqrstuv",
            "sk-abcdefghijklmnopqrstuv",
        ),
        (
            "git push https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r",
            "ghp_abcdefghijklmnopqrstuvwxyz0123",
        ),
        ("aws s3 ls AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"),
    ] {
        let (redacted, changed) = redact_text(input);
        assert!(changed, "{input}");
        assert!(!redacted.contains(secret), "{input} -> {redacted}");
        assert!(redacted.contains(REDACTED), "{redacted}");
    }
    for ordinary in [
        "cargo test --workspace",
        "git log --oneline -5",
        "RUST_LOG=debug cargo run",
        "git checkout 4f6890b8c3d2a1e0f9b8c7d6e5f4a3b2c1d0e9f8",
    ] {
        assert_eq!(
            redact_text(ordinary),
            (ordinary.to_string(), false),
            "{ordinary}"
        );
    }
}

fn intent(messages: &[&str]) -> Vec<String> {
    messages
        .iter()
        .map(|message| (*message).to_owned())
        .collect()
}

#[test]
fn secret_bearing_operations_and_intent_are_ineligible() {
    let error = review_request(
        "exec_command",
        &[resource("execute", "command:[env][TOKEN=abcdef][make]")],
        PermissionBackend::Local,
        &intent(&["build it"]),
        false,
        &ExactSecrets::default(),
    )
    .unwrap_err();
    assert!(error.0.contains("secret-bearing"));

    // Dropping a secret-bearing message could hide a restriction, so the
    // request keeps the manual path rather than going without it.
    let error = review_request(
        "exec_command",
        &[resource("execute", "command:[make]")],
        PermissionBackend::Local,
        &intent(&[
            "build it",
            "deploy with GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 please",
        ]),
        false,
        &ExactSecrets::default(),
    )
    .unwrap_err();
    assert!(error.0.contains("secret-bearing"), "{}", error.0);
    let error = review_request(
        "exec_command",
        &[resource("execute", "command:[make]")],
        PermissionBackend::Local,
        &intent(&["use hunter2-long-secret for it"]),
        false,
        &ExactSecrets::from_values(["hunter2-long-secret".to_string()]),
    )
    .unwrap_err();
    assert!(error.0.contains("secret-bearing"), "{}", error.0);
}

#[test]
fn long_operations_and_intent_are_ineligible_and_empty_intent_is_too() {
    let long = format!("command:[echo][{}]", "a".repeat(MAX_DISPLAY_CHARS + 1));
    assert!(review_request(
        "exec_command",
        &[resource("execute", &long)],
        PermissionBackend::Local,
        &intent(&["echo"]),
        false,
        &ExactSecrets::default(),
    )
    .is_err());
    // Intent is never cut: a trailing restriction must not disappear.
    let half = "é".repeat(MAX_INTENT_CHARS / 2);
    let error = review_request(
        "exec_command",
        &[resource("execute", "command:[make]")],
        PermissionBackend::Local,
        &intent(&[&half, &half, "but do not push"]),
        false,
        &ExactSecrets::default(),
    )
    .unwrap_err();
    assert!(error.0.contains("too long"), "{}", error.0);
    let request = review_request(
        "exec_command",
        &[resource("execute", "command:[make]")],
        PermissionBackend::Local,
        &intent(&[&half, &half]),
        false,
        &ExactSecrets::default(),
    )
    .unwrap();
    assert_eq!(request.user_intent, intent(&[&half, &half]));
    for empty in [intent(&[]), intent(&["  ", "\n"])] {
        let error = review_request(
            "exec_command",
            &[resource("execute", "command:[make]")],
            PermissionBackend::Local,
            &empty,
            false,
            &ExactSecrets::default(),
        )
        .unwrap_err();
        assert!(error.0.contains("empty"), "{}", error.0);
    }
}

#[test]
fn fingerprints_ignore_call_identity_but_bind_resources() {
    let a = invocation_fingerprint(
        "exec_command",
        &[resource("execute", "command:[git][push]")],
    );
    let b = invocation_fingerprint(
        "exec_command",
        &[resource("execute", "command:[git][push]")],
    );
    let c = invocation_fingerprint(
        "exec_command",
        &[resource("execute", "command:[git][push][--force]")],
    );
    let d = invocation_fingerprint("write_stdin", &[resource("execute", "command:[git][push]")]);
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert_ne!(a, d);
}

#[test]
fn window_limit_stops_after_ten_of_fifty_blocks() {
    let mut run = ReviewRunState::default();
    for index in 0..30 {
        let outcome = if index % 3 == 0 {
            PermissionReviewOutcome::Rejected
        } else {
            PermissionReviewOutcome::Approved
        };
        run.record(outcome);
    }
    let stop = run
        .take_stop()
        .expect("ten blocks in the window stop the run");
    assert!(stop.contains("10 of the last 50"), "{stop}");
}

#[test]
fn approvals_reset_consecutive_counts_but_unavailable_does_not_count_as_block() {
    let mut run = ReviewRunState::default();
    run.record(PermissionReviewOutcome::Rejected);
    run.record(PermissionReviewOutcome::Rejected);
    run.record(PermissionReviewOutcome::Approved);
    run.record(PermissionReviewOutcome::Rejected);
    run.record(PermissionReviewOutcome::Unavailable);
    run.record(PermissionReviewOutcome::Uncertain);
    assert!(!run.stopped());
    run.record(PermissionReviewOutcome::Rejected);
    assert!(run.stopped());
}

#[test]
fn blocked_messages_carry_codes_not_reviewer_text() {
    let message = blocked_message(
        PermissionReviewCode::ReviewRejected,
        Some(ReviewCategory::Exfiltration),
    );
    assert!(message.contains("code=review_rejected"));
    assert!(message.contains("category: exfiltration"));
    assert!(message.contains("operation_executed=false"));
    assert!(message.contains("workaround"));
}

#[test]
fn exact_stored_values_and_short_quoted_tokens_are_redacted() {
    let canary = "nac-stored-canary-5e1f";
    let secrets = ExactSecrets::from_values([canary.to_string(), "ab1".to_string()]);
    let (redacted, changed) = redact_text_with(&format!("deploy {canary} now"), &secrets);
    assert!(changed);
    assert!(!redacted.contains(canary), "{redacted}");
    let error = review_request(
        "exec_command",
        &[resource("execute", &format!("command:[deploy][{canary}]"))],
        PermissionBackend::Local,
        &intent(&["run it"]),
        false,
        &secrets,
    )
    .unwrap_err();
    assert!(error.0.contains("secret-bearing"));
    for short in ["--token \"ab\"", "PASSWORD='x1'", "--password=\"q\""] {
        let (redacted, changed) = redact_text(short);
        assert!(changed, "{short}");
        assert!(redacted.contains(REDACTED), "{short} -> {redacted}");
    }
}

#[test]
fn nac_broad_authority_displays_are_not_mistaken_for_secrets() {
    for display in [
        "broad executable authority: npm test; arbitrary code execution for this invocation within the selected Podman confinement boundary",
        "broad executable authority: cargo build; trusted arbitrary code execution on the unsandboxed Local backend for this invocation; parser protected-path rules cannot constrain code inside it",
        "git commit --author=Dev",
        "the session token: expires tomorrow",
    ] {
        assert_eq!(redact_text(display), (display.to_string(), false), "{display}");
    }
    for secret in [
        "{\"password\": \"hunter22\"}",
        "'api_key': 'k_123'",
        "token: abc123def",
        "  client_secret: s3cr3t",
    ] {
        assert!(redact_text(secret).1, "{secret}");
    }
    let resources = [
        resource("execute", "command:[npm][test]"),
        resource(
            "execute_broad",
            "broad executable authority: npm test; arbitrary code execution for this invocation within the selected Podman confinement boundary",
        ),
    ];
    assert!(
        review_request(
            "exec_command",
            &resources,
            PermissionBackend::Podman,
            &intent(&["run it"]),
            false,
            &ExactSecrets::default()
        )
        .is_ok(),
        "Podman broad execution must reach the reviewer"
    );
}

#[test]
fn secret_names_match_whole_names_only() {
    for name in [
        "GITHUB_TOKEN",
        "OPENAI_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "DB_PASS",
        "PGPASSWORD",
        "AUTH_COOKIE",
        "TOKENIZERS_PARALLELISM",
    ] {
        assert!(is_secret_name(name), "{name}");
    }
    for name in ["GIT_AUTHOR_NAME", "SSH_AUTH_SOCK", "AUTHOR", "PATH", "HOME"] {
        assert!(!is_secret_name(name), "{name}");
    }
}

#[test]
fn podman_with_extra_host_mounts_or_git_metadata_is_not_a_workspace_only_sandbox() {
    use crate::sandbox::{MountSpec, SandboxSpec, DEFAULT_SANDBOX_WORKDIR};
    let root = std::env::temp_dir().join(format!("nac_review_mounts_{}", uuid::Uuid::new_v4()));
    let plain = root.join("plain");
    let checkout = root.join("checkout");
    let fork = root.join("fork");
    std::fs::create_dir_all(&plain).unwrap();
    std::fs::create_dir_all(checkout.join(".git/refs")).unwrap();
    std::fs::create_dir_all(&fork).unwrap();
    std::fs::write(
        fork.join(".git"),
        "gitdir: /home/dev/repo/.git/worktrees/abc\n",
    )
    .unwrap();
    let mount = |host: &std::path::Path, guest: &str, read_only| MountSpec {
        host: host.to_path_buf(),
        guest: guest.into(),
        read_only,
    };
    let spec = |mounts: Vec<MountSpec>| SandboxSpec {
        mounts,
        ..SandboxSpec::default()
    };
    let workspace = mount(&plain, DEFAULT_SANDBOX_WORKDIR, false);

    let confined = [
        spec(vec![]),
        spec(vec![workspace.clone()]),
        // Read-only mounts, including Git metadata, cannot change host data.
        spec(vec![workspace.clone(), mount(&plain, "/skills", true)]),
        spec(vec![mount(&checkout, DEFAULT_SANDBOX_WORKDIR, true)]),
    ];
    for spec in confined {
        assert!(
            !spec.mounts_host_data_beyond_workspace(),
            "{:?}",
            spec.mounts
        );
    }
    let git_overlay = |path: &str| mount(std::path::Path::new(path), path, false);
    let mounted = [
        spec(vec![
            workspace.clone(),
            mount(std::path::Path::new("/home/dev/data"), "/data", false),
        ]),
        // A writable mount nested inside the workspace is still other host data.
        spec(vec![
            workspace.clone(),
            mount(
                std::path::Path::new("/home/dev/secrets"),
                "/workspace/secrets",
                false,
            ),
        ]),
        // A live checkout: its .git holds every branch's refs and its hooks.
        spec(vec![mount(&checkout, DEFAULT_SANDBOX_WORKDIR, false)]),
        // A forked worktree writes the host repository's objects and refs.
        spec(vec![
            mount(&fork, DEFAULT_SANDBOX_WORKDIR, false),
            mount(
                std::path::Path::new("/home/dev/repo/.git"),
                "/home/dev/repo/.git",
                true,
            ),
            git_overlay("/home/dev/repo/.git/objects"),
            git_overlay("/home/dev/repo/.git/refs"),
            git_overlay("/home/dev/repo/.git/logs/refs"),
            git_overlay("/home/dev/repo/.git/worktrees/abc"),
        ]),
    ];
    for spec in mounted {
        assert!(
            spec.mounts_host_data_beyond_workspace(),
            "{:?}",
            spec.mounts
        );
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_sandbox_is_classified_again_as_git_metadata_appears() {
    use crate::sandbox::{MountSpec, SandboxSpec, DEFAULT_SANDBOX_WORKDIR};
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("nac_review_reclassify_{}", uuid::Uuid::new_v4()));
    let source = |workspace: &std::path::Path| {
        ReviewBackendSource::Sandbox(Box::new(SandboxSpec {
            mounts: vec![MountSpec {
                host: workspace.to_path_buf(),
                guest: DEFAULT_SANDBOX_WORKDIR.into(),
                read_only: false,
            }],
            ..SandboxSpec::default()
        }))
    };

    // A plain workspace is confined until Git metadata is created in it.
    let plain = root.join("plain");
    std::fs::create_dir_all(&plain).unwrap();
    let plain_source = source(&plain);
    assert_eq!(plain_source.current(), ReviewBackend::Podman);
    std::fs::create_dir_all(plain.join(".git/hooks")).unwrap();
    assert_eq!(plain_source.current(), ReviewBackend::PodmanWithHostMounts);

    // A bare repository holds refs and hooks at its top level.
    let bare = root.join("bare");
    std::fs::create_dir_all(bare.join("objects")).unwrap();
    std::fs::create_dir_all(bare.join("refs")).unwrap();
    let bare_source = source(&bare);
    assert_eq!(
        bare_source.current(),
        ReviewBackend::Podman,
        "not yet a repository"
    );
    std::fs::write(bare.join("HEAD"), "ref: refs/heads/main\n").unwrap();
    assert_eq!(bare_source.current(), ReviewBackend::PodmanWithHostMounts);

    // So is a repository nested anywhere in the workspace.
    let nested = root.join("nested");
    std::fs::create_dir_all(nested.join("src/vendor/lib")).unwrap();
    let nested_source = source(&nested);
    assert_eq!(nested_source.current(), ReviewBackend::Podman);
    std::fs::create_dir_all(nested.join("src/vendor/lib/.git")).unwrap();
    assert_eq!(nested_source.current(), ReviewBackend::PodmanWithHostMounts);
    let nested_bare = root.join("nested-bare");
    for dir in ["deps/repo.git/objects", "deps/repo.git/refs"] {
        std::fs::create_dir_all(nested_bare.join(dir)).unwrap();
    }
    std::fs::write(
        nested_bare.join("deps/repo.git/HEAD"),
        "ref: refs/heads/main\n",
    )
    .unwrap();
    assert_eq!(
        source(&nested_bare).current(),
        ReviewBackend::PodmanWithHostMounts
    );

    // A workspace that cannot be checked, or is gone, is not confined.
    let sealed = root.join("sealed");
    std::fs::create_dir_all(&sealed).unwrap();
    std::fs::set_permissions(&sealed, std::fs::Permissions::from_mode(0o000)).unwrap();
    let sealed_result = source(&sealed).current();
    std::fs::set_permissions(&sealed, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(sealed_result, ReviewBackend::PodmanWithHostMounts);
    assert_eq!(
        source(&root.join("missing")).current(),
        ReviewBackend::PodmanWithHostMounts
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_workspace_too_large_to_scan_counts_as_holding_git_metadata() {
    use crate::sandbox::{MountSpec, SandboxSpec, DEFAULT_SANDBOX_WORKDIR};
    let workspace = std::env::temp_dir().join(format!("nac_review_large_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace).unwrap();
    for index in 0..20_001 {
        std::fs::write(workspace.join(format!("f{index}")), "").unwrap();
    }
    let source = ReviewBackendSource::Sandbox(Box::new(SandboxSpec {
        mounts: vec![MountSpec {
            host: workspace.clone(),
            guest: DEFAULT_SANDBOX_WORKDIR.into(),
            read_only: false,
        }],
        ..SandboxSpec::default()
    }));
    assert_eq!(source.current(), ReviewBackend::PodmanWithHostMounts);
    std::fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn a_mounted_podman_sandbox_is_reviewed_like_a_real_machine() {
    let broad = [resource("execute_broad", "command:[make][test]")];
    assert!(review_eligibility(&broad, ReviewBackend::Podman).is_ok());
    assert!(review_eligibility(&broad, ReviewBackend::PodmanWithHostMounts).is_err());
    let narrow = [resource("execute", "command:[ls]")];
    let request = review_request(
        "exec_command",
        &narrow,
        ReviewBackend::PodmanWithHostMounts,
        &intent(&["run it"]),
        false,
        &ExactSecrets::default(),
    )
    .unwrap();
    assert_eq!(request.backend, "podman_with_host_mounts");
}

#[test]
fn a_blocked_review_stays_listed_after_newer_reviews_fill_recent() {
    let review = |id: &str, at: u64, outcome| PermissionReview {
        id: id.to_string(),
        session_id: "session".to_string(),
        call_id: None,
        tool: "exec_command".to_string(),
        backend: "local".to_string(),
        resources: Vec::new(),
        user_authorized_retry: false,
        outcome: Some(outcome),
        code: None,
        category: None,
        failure_reason: None,
        duration_ms: None,
        reviewer: "fake".to_string(),
        created_at_epoch_ms: at,
    };
    let mut memory = ReviewMemory::default();
    let blocked = review("blocked", 0, PermissionReviewOutcome::Rejected);
    memory.record(&blocked);
    memory.remember_blocked(BlockedReview {
        review: blocked,
        fingerprint: "fingerprint".to_string(),
    });
    for at in 1..=(RECENT_REVIEW_LIMIT as u64 + 5) {
        memory.record(&review(
            &format!("ok-{at}"),
            at,
            PermissionReviewOutcome::Approved,
        ));
    }
    let listed = memory.recent();
    assert_eq!(listed.len(), RECENT_REVIEW_LIMIT + 1);
    assert_eq!(listed.last().unwrap().id, "blocked");
    assert!(listed
        .windows(2)
        .all(|pair| pair[0].created_at_epoch_ms >= pair[1].created_at_epoch_ms));

    // Once authorized it leaves the blocked list and ages out normally.
    memory.authorize_retry("blocked").unwrap();
    assert!(memory.recent().iter().all(|review| review.id != "blocked"));
}

#[test]
fn known_credential_locations_and_process_environments_are_never_reviewed() {
    for path in [
        "/home/u/.cargo/credentials.toml",
        "/home/u/.cargo/credentials",
        "/home/u/.pgpass",
        "/home/u/.vault-token",
        "/home/u/.azure",
        "/home/u/.azure/accessTokens.json",
        "/home/u/.terraform.d/credentials.tfrc.json",
        "/home/u/.terraformrc",
        "/home/u/.config/hub",
        "/home/u/.config/hub/credentials.yml",
        "/home/u/.bash_history",
        "/home/u/.zsh_history",
        "/home/u/.python_history",
        "/home/u/.mysql_history",
        "/home/u/.psql_history",
        "/home/u/.password-store/service.gpg",
        "/home/u/.authinfo.gpg",
        "/proc/self/environ",
        "/proc/thread-self/environ",
        "/proc/123/task/456/environ",
        "/run/secrets/service-token",
        "/var/run/secrets/kubernetes.io/serviceaccount/token",
        "/etc/shadow",
        r"C:\Users\u\.azure\accessTokens.json",
    ] {
        for backend in [
            PermissionBackend::Local,
            PermissionBackend::Ssh,
            PermissionBackend::Podman,
        ] {
            for action in ["read", "external_directory", "execute_path"] {
                assert!(
                    review_eligibility(&[resource(action, path)], backend).is_err(),
                    "{action} {path}"
                );
            }
            let command = format!("command:[cat][{path}]");
            assert!(
                review_eligibility(&[resource("execute", &command)], backend).is_err(),
                "{command}"
            );
        }
    }
    for path in [
        "/home/u/.editorconfig",
        "/home/u/.prettierrc",
        "/home/u/.config/my-editor/settings.json",
        "/work/project/.github/workflows/test.yml",
        "/usr/include/ordinary.h",
    ] {
        assert!(
            review_eligibility(
                &[resource("read", path), resource("external_directory", path)],
                PermissionBackend::Local
            )
            .is_ok(),
            "{path}"
        );
    }
}

#[test]
fn basic_auth_credentials_keep_shell_resources_and_human_intent_manual() {
    let backend = crate::sandbox::ExecutionBackend::Local {
        workspace_cwd: "/workspace".into(),
    };
    for command in [
        "curl -u alice:canary8d1e https://example.com/health",
        "curl -ualice:canary8d1e https://example.com/health",
        "curl -u'alice:canary8d1e' https://example.com/health",
        "curl -su alice:canary8d1e https://example.com/health",
        "curl -4u alice:canary8d1e https://example.com/health",
        "curl -0ualice:canary8d1e https://example.com/health",
        "curl -6u alice:canary8d1e https://example.com/health",
        "curl -#u alice:canary8d1e https://example.com/health",
        "curl -:ualice:canary8d1e https://example.com/health",
        "curl -sualice:canary8d1e https://example.com/health",
        "curl --user alice:canary8d1e https://example.com/health",
        "curl --user=alice:canary8d1e https://example.com/health",
        "curl --user 'alice:canary with spaces' https://example.com/health",
        "curl -u 'alice with spaces:canary8d1e' https://example.com/health",
        "curl -U alice:canary8d1e https://example.com/health",
        "curl -Ualice:canary8d1e https://example.com/health",
        "curl --proxy-user alice:canary8d1e https://example.com/health",
        "curl --proxy-user=alice:canary8d1e https://example.com/health",
    ] {
        let resources =
            crate::permissions::shell_resources(command, Path::new("/workspace"), &backend);
        assert!(review_eligibility(&resources, PermissionBackend::Local).is_ok());
        assert!(redact_text(command).1, "readable auth command: {command}");
        let canonical = &resources
            .iter()
            .find(|resource| resource.action == "execute")
            .unwrap()
            .resource;
        assert!(
            redact_text(canonical).1,
            "canonical auth command: {command}"
        );
        assert!(
            review_request(
                "exec_command",
                &resources,
                PermissionBackend::Local,
                &intent(&["Check the health endpoint"]),
                false,
                &ExactSecrets::default()
            )
            .is_err(),
            "credential-bearing command must stay manual: {command}"
        );
        assert!(
            review_request(
                "exec_command",
                &[resource("execute", "command:[ls]")],
                PermissionBackend::Local,
                &intent(&[command]),
                false,
                &ExactSecrets::default()
            )
            .is_err(),
            "credential-bearing human intent must stay manual: {command}"
        );
    }
    for command in ["id -u", "id -un", "curl -s https://example.com/health"] {
        let resources =
            crate::permissions::shell_resources(command, Path::new("/workspace"), &backend);
        assert!(
            review_request(
                "exec_command",
                &resources,
                PermissionBackend::Local,
                &intent(&["Check the service"]),
                false,
                &ExactSecrets::default()
            )
            .is_ok(),
            "{command}"
        );
    }
}

#[cfg(unix)]
#[test]
fn sockets_in_readonly_mounts_or_the_workspace_are_not_confined() {
    use crate::sandbox::{MountSpec, SandboxSpec, DEFAULT_SANDBOX_WORKDIR};
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let root = std::env::temp_dir().join(format!("nac-sock-{}", &suffix[..8]));
    let workspace = root.join("w");
    let readonly = root.join("r");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&readonly).unwrap();
    let source = |host: &Path, guest: &str, read_only| {
        ReviewBackendSource::Sandbox(Box::new(SandboxSpec {
            mounts: vec![MountSpec {
                host: host.into(),
                guest: guest.into(),
                read_only,
            }],
            ..SandboxSpec::default()
        }))
    };
    let readonly_source = source(&readonly, "/readonly", true);
    assert_eq!(readonly_source.current(), ReviewBackend::Podman);
    std::fs::write(readonly.join("settings"), "ordinary config").unwrap();
    assert_eq!(
        source(&readonly.join("settings"), "/settings", true).current(),
        ReviewBackend::Podman
    );
    let socket = readonly.join("d.sock");
    let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    let parsed = crate::sandbox::parse_mount_spec(
        &format!("{}:/run/daemon.sock", socket.display()),
        true,
        &root,
    )
    .unwrap();
    let direct = ReviewBackendSource::Sandbox(Box::new(SandboxSpec {
        mounts: vec![parsed],
        ..SandboxSpec::default()
    }));
    for candidate in [direct, readonly_source] {
        let backend = candidate.current();
        assert_eq!(backend, ReviewBackend::PodmanWithHostMounts);
        assert!(review_eligibility(
            &[resource("execute_broad", "command:[make][test]")],
            backend
        )
        .is_err());
    }
    let workspace_listener =
        std::os::unix::net::UnixListener::bind(workspace.join("d.sock")).unwrap();
    assert_eq!(
        source(&workspace, DEFAULT_SANDBOX_WORKDIR, false).current(),
        ReviewBackend::PodmanWithHostMounts
    );
    assert_eq!(
        source(&root.join("missing"), "/readonly", true).current(),
        ReviewBackend::PodmanWithHostMounts
    );
    drop((listener, workspace_listener));
    std::fs::remove_dir_all(root).unwrap();
}
