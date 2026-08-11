use serde_json::Value;

use crate::tools::{ToolResult, ToolRuntime};

pub(crate) async fn execute(tool: &'static str, args: Value, runtime: &ToolRuntime) -> ToolResult {
    super::discovery_native::execute(tool, args, runtime).await
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;

    use serde_json::{json, Value};

    use super::execute;
    fn fixture_runtime() -> (crate::tools::ToolRuntime, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("nac-discovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).expect("create src fixture");
        fs::create_dir_all(root.join("target")).expect("create target fixture");
        fs::create_dir_all(root.join(".hidden")).expect("create hidden fixture");
        fs::create_dir_all(root.join("nested")).expect("create nested fixture");
        fs::write(
            root.join("src/a.rs"),
            "pub enum ExecutionBackend {}\nsecond line\n",
        )
        .expect("write a.rs");
        fs::write(root.join("src/b.rs"), "ExecutionBackend appears again\n").expect("write b.rs");
        fs::write(root.join("target/generated.rs"), "ExecutionBackend\n")
            .expect("write generated fixture");
        fs::write(root.join(".hidden/secret.rs"), "ExecutionBackend\n")
            .expect("write hidden fixture");
        fs::write(root.join("nested/drop.txt"), "ExecutionBackend\n")
            .expect("write nested ignored fixture");
        fs::write(root.join("nested/keep.txt"), "before\nneedle\nafter\n")
            .expect("write nested re-included fixture");
        fs::write(root.join("nested/.gitignore"), "*.txt\n!keep.txt\n")
            .expect("write nested ignore fixture");
        fs::write(root.join("binary.dat"), b"ExecutionBackend\0binary")
            .expect("write binary fixture");
        fs::write(root.join("ignored.rs"), "ExecutionBackend\n").expect("write ignored fixture");
        fs::write(root.join(".gitignore"), "ignored.rs\n").expect("write ignore fixture");

        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Local {
            workspace_cwd: root.clone(),
        });
        (runtime, root)
    }

    async fn podman_runtime(root: &std::path::Path) -> crate::tools::ToolRuntime {
        let sandbox = crate::sandbox::SandboxSession::create(
            crate::sandbox::SandboxSpec {
                backend: crate::sandbox::SandboxBackendType::Podman,
                image: crate::sandbox::DEFAULT_SANDBOX_IMAGE.to_string(),
                mounts: vec![crate::sandbox::MountSpec {
                    host: root.to_path_buf(),
                    guest: std::path::PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
                    read_only: true,
                }],
                workdir: std::path::PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
                gpu_devices: Vec::new(),
                shm_size: Some("0".to_string()),
                cpus: 2,
                memory_mib: 512,
            },
            format!("discovery-test-{}", uuid::Uuid::new_v4()),
            true,
        )
        .await
        .expect("create Podman discovery fixture");
        let mut runtime = crate::tools::test_runtime();
        runtime.workspace_cwd = root.to_path_buf();
        runtime.config_cwd = root.to_path_buf();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(Some(sandbox), root);
        runtime
    }

    fn parsed(result: crate::tools::ToolResult) -> Value {
        assert!(
            !result.is_error,
            "unexpected tool error: {}",
            result.content
        );
        serde_json::from_str(&result.content).expect("tool output must be JSON")
    }

    #[tokio::test]
    async fn glob_respects_defaults_and_returns_stable_paths() {
        let (runtime, root) = fixture_runtime();
        let output = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
        let paths: Vec<&str> = output["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .map(|entry| entry["path"].as_str().expect("path"))
            .collect();
        assert_eq!(paths, vec!["src/a.rs", "src/b.rs"]);
        assert_eq!(output["truncated"], false);
        assert!(output["next_cursor"].is_null());
        let model_shaped = parsed(
            execute(
                "glob",
                json!({
                    "pattern": "**/*.rs",
                    "root": root,
                    "cursor": ""
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(model_shaped["entries"], output["entries"]);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn grep_paginates_every_match_once() {
        let (runtime, root) = fixture_runtime();
        let first = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "globs": ["**/*.rs"],
                    "limit": 1
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(first["matches"][0]["path"], "src/a.rs");
        assert_eq!(first["matches"][0]["line"], 1);
        assert_eq!(first["matches"][0]["column"], 10);
        assert_eq!(first["truncated"], true);
        let cursor = first["next_cursor"].as_str().expect("cursor");

        let second = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "globs": ["**/*.rs"],
                    "limit": 1,
                    "cursor": cursor
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(second["matches"][0]["path"], "src/b.rs");
        assert_eq!(second["truncated"], false);
        assert!(second["next_cursor"].is_null());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn invalid_patterns_and_outside_roots_are_explicit_errors() {
        let (runtime, root) = fixture_runtime();
        let invalid = execute("glob", json!({"pattern": "["}), &runtime).await;
        assert!(invalid.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&invalid.content).expect("error JSON")["error"]["code"],
            "invalid_glob"
        );

        let outside = execute(
            "grep",
            json!({"pattern": "x", "roots": ["../outside"]}),
            &runtime,
        )
        .await;
        assert!(outside.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&outside.content).expect("error JSON")["error"]["code"],
            "outside_workspace"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn explicit_options_include_hidden_ignored_and_generated_paths() {
        let (runtime, root) = fixture_runtime();
        let output = parsed(
            execute(
                "glob",
                json!({
                    "pattern": "**/*.rs",
                    "hidden": true,
                    "gitignore": false
                }),
                &runtime,
            )
            .await,
        );
        let paths: Vec<&str> = output["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .map(|entry| entry["path"].as_str().expect("path"))
            .collect();
        assert_eq!(
            paths,
            vec![
                ".hidden/secret.rs",
                "ignored.rs",
                "src/a.rs",
                "src/b.rs",
                "target/generated.rs"
            ]
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn nested_gitignore_negation_is_applied_before_matching() {
        let (runtime, root) = fixture_runtime();
        let output = parsed(
            execute(
                "glob",
                json!({"pattern": "**/*.txt", "root": "nested"}),
                &runtime,
            )
            .await,
        );
        assert_eq!(output["entries"].as_array().expect("entries").len(), 1);
        assert_eq!(output["entries"][0]["path"], "nested/keep.txt");
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn grep_supports_context_case_modes_and_path_globs() {
        let (runtime, root) = fixture_runtime();
        let context = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "needle",
                    "regex": false,
                    "roots": ["nested"],
                    "globs": ["nested/*.txt"],
                    "context": 1
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(context["matches"].as_array().expect("matches").len(), 1);
        assert_eq!(context["matches"][0]["path"], "nested/keep.txt");
        assert_eq!(context["matches"][0]["line"], 2);
        assert_eq!(context["matches"][0]["before"], json!(["before"]));
        assert_eq!(context["matches"][0]["after"], json!(["after"]));

        let smart = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "executionbackend",
                    "regex": false,
                    "globs": ["src/*.rs"],
                    "case": "smart"
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(smart["matches"].as_array().expect("matches").len(), 2);
        let sensitive = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "executionbackend",
                    "regex": false,
                    "globs": ["src/*.rs"],
                    "case": "sensitive"
                }),
                &runtime,
            )
            .await,
        );
        assert!(sensitive["matches"].as_array().expect("matches").is_empty());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn grep_multiline_controls_cross_line_matches() {
        let (runtime, root) = fixture_runtime();
        let single_line = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "before.*after",
                    "roots": ["nested"],
                    "globs": ["nested/keep.txt"]
                }),
                &runtime,
            )
            .await,
        );
        assert!(single_line["matches"]
            .as_array()
            .expect("matches")
            .is_empty());
        let multiline = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "before.*after",
                    "roots": ["nested"],
                    "globs": ["nested/keep.txt"],
                    "multiline": true
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(multiline["matches"].as_array().expect("matches").len(), 1);
        assert_eq!(multiline["matches"][0]["line"], 1);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn grep_deduplicates_overlapping_roots_and_reports_binary_files() {
        let (runtime, root) = fixture_runtime();
        let matches = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "roots": [".", "src", "src"]
                }),
                &runtime,
            )
            .await,
        );
        let paths: Vec<&str> = matches["matches"]
            .as_array()
            .expect("matches")
            .iter()
            .map(|entry| entry["path"].as_str().expect("path"))
            .collect();
        assert_eq!(paths, vec!["src/a.rs", "src/b.rs"]);
        assert!(matches["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "binary_file" && error["path"] == "binary.dat"));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn invalid_regex_limits_and_mismatched_cursors_are_errors() {
        let (runtime, root) = fixture_runtime();
        let invalid_regex = execute("grep", json!({"pattern": "("}), &runtime).await;
        assert!(invalid_regex.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&invalid_regex.content).expect("error JSON")["error"]
                ["code"],
            "invalid_regex"
        );
        let invalid_limit = execute("glob", json!({"pattern": "**", "limit": 0}), &runtime).await;
        assert!(invalid_limit.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&invalid_limit.content).expect("error JSON")["error"]
                ["code"],
            "invalid_arguments"
        );
        let first =
            parsed(execute("glob", json!({"pattern": "**/*.rs", "limit": 1}), &runtime).await);
        let mismatched = execute(
            "glob",
            json!({
                "pattern": "**/*.txt",
                "limit": 1,
                "cursor": first["next_cursor"]
            }),
            &runtime,
        )
        .await;
        assert!(mismatched.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&mismatched.content).expect("error JSON")["error"]
                ["code"],
            "invalid_cursor"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn dispatch_path_bounds_long_match_text() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join("src/long.rs"),
            format!("needle {}\n", "x".repeat(10_000)),
        )
        .expect("write long fixture");
        let result = crate::tools::execute_tool(
            "grep",
            json!({
                "pattern": "needle",
                "regex": false,
                "globs": ["src/long.rs"]
            }),
            &runtime,
            &crate::model::ModelClient::new_for_test(),
        )
        .await;
        assert!(
            !result.is_error,
            "unexpected dispatch error: {}",
            result.content
        );
        assert!(result.content.len() < 70_000);
        let output: Value = serde_json::from_str(&result.content).expect("result JSON");
        assert_eq!(output["matches"].as_array().expect("matches").len(), 1);
        assert_eq!(output["matches"][0]["text_truncated"], true);

        let malformed = execute(
            "glob",
            json!({"pattern": "**", "cursor": "not-a-cursor"}),
            &runtime,
        )
        .await;
        assert!(malformed.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&malformed.content).expect("error JSON")["error"]["code"],
            "invalid_cursor"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn rust_regex_engine_handles_pathological_patterns_in_linear_time() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join("src/pathological.txt"),
            format!("{}!\n", "a".repeat(20_000)),
        )
        .expect("write pathological fixture");
        let started = std::time::Instant::now();
        let output = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "(a+)+$",
                    "globs": ["src/pathological.txt"],
                    "case": "sensitive"
                }),
                &runtime,
            )
            .await,
        );
        assert!(output["matches"].as_array().expect("matches").is_empty());
        assert!(output["errors"].as_array().expect("errors").is_empty());
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "linear-time regex search exceeded two seconds"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn aborting_native_search_stops_promptly() {
        let (runtime, root) = fixture_runtime();
        fs::write(root.join("src/large.txt"), vec![b'a'; 8 * 1024 * 1024])
            .expect("write cancellation fixture");
        let task = tokio::spawn(async move {
            execute(
                "grep",
                json!({
                    "pattern": "not-present",
                    "globs": ["src/large.txt"],
                    "case": "sensitive"
                }),
                &runtime,
            )
            .await
        });
        tokio::task::yield_now().await;
        task.abort();
        let joined = tokio::time::timeout(std::time::Duration::from_secs(1), task)
            .await
            .expect("cancelled search must stop promptly");
        assert!(joined
            .expect_err("aborted task must not complete")
            .is_cancelled());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_escapes_are_structured_and_never_followed() {
        use std::os::unix::fs::symlink;

        let (runtime, root) = fixture_runtime();
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).expect("create outside fixture");
        fs::write(outside.join("secret.rs"), "ExecutionBackend\n").expect("write outside file");
        symlink(&outside, root.join("escape")).expect("create escaping symlink");
        let output = parsed(execute("glob", json!({"pattern": "**"}), &runtime).await);
        assert!(output["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "symlink_escape" && error["path"] == "escape"));
        assert!(output["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .all(|entry| !entry["path"].as_str().expect("path").starts_with("escape/")));
        let scoped =
            parsed(execute("glob", json!({"pattern": "**", "root": "escape"}), &runtime).await);
        assert!(scoped["entries"].as_array().expect("entries").is_empty());
        assert!(scoped["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "symlink_escape" && error["path"] == "escape"));
        fs::remove_dir_all(root).expect("remove fixture");
        fs::remove_dir_all(outside).expect("remove outside fixture");
    }

    #[tokio::test]
    #[ignore = "requires Podman"]
    async fn podman_and_local_backends_return_identical_discovery_pages() {
        let (local, root) = fixture_runtime();
        let podman = podman_runtime(&root).await;
        let requests = [
            (
                "glob",
                json!({
                    "pattern": "**/*",
                    "limit": 5
                }),
            ),
            (
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "limit": 5
                }),
            ),
        ];
        for (tool, request) in requests {
            let local_output = execute(tool, request.clone(), &local).await;
            let podman_output = execute(tool, request, &podman).await;
            assert_eq!(
                podman_output.is_error, local_output.is_error,
                "{tool}: Podman={}, local={}",
                podman_output.content, local_output.content
            );
            assert_eq!(
                serde_json::from_str::<Value>(&podman_output.content).expect("Podman JSON"),
                serde_json::from_str::<Value>(&local_output.content).expect("local JSON"),
                "{tool}"
            );
        }
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    #[ignore = "mutates process PATH; run filtered with one test thread"]
    async fn ssh_and_local_backends_return_identical_discovery_pages() {
        use std::os::unix::fs::PermissionsExt;

        struct PathGuard(Option<std::ffi::OsString>);
        impl Drop for PathGuard {
            fn drop(&mut self) {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }

        let original_path = std::env::var_os("PATH");
        let fake_bin = std::env::temp_dir().join(format!("nac-fake-ssh-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&fake_bin).expect("create fake ssh bin");
        let ssh = fake_bin.join("ssh");
        fs::write(
            &ssh,
            "#!/bin/sh\nfor server in /usr/libexec/sftp-server /usr/lib/openssh/sftp-server; do\n    [ -x \"$server\" ] && exec \"$server\"\ndone\nexit 127\n",
        )
        .expect("write fake ssh");
        fs::set_permissions(&ssh, fs::Permissions::from_mode(0o755))
            .expect("make fake ssh executable");
        let combined_path = std::env::join_paths(
            std::iter::once(fake_bin.clone()).chain(
                original_path
                    .as_deref()
                    .into_iter()
                    .flat_map(std::env::split_paths),
            ),
        )
        .expect("compose fake ssh PATH");
        let _path_guard = PathGuard(original_path);
        std::env::set_var("PATH", combined_path);

        let (local, root) = fixture_runtime();
        let mut ssh_runtime = crate::tools::test_runtime();
        ssh_runtime.workspace_cwd = root.clone();
        ssh_runtime.config_cwd = root.clone();
        ssh_runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Ssh(
            crate::sandbox::SshBackend::new("fixture-host".to_string(), root.clone()),
        ));
        for (tool, request) in [
            ("glob", json!({"pattern": "**/*.rs"})),
            (
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                }),
            ),
        ] {
            let local_output = execute(tool, request.clone(), &local).await;
            let ssh_output = execute(tool, request, &ssh_runtime).await;
            assert_eq!(
                ssh_output.is_error, local_output.is_error,
                "{tool}: SSH={}, local={}",
                ssh_output.content, local_output.content
            );
            assert_eq!(
                serde_json::from_str::<Value>(&ssh_output.content).expect("SSH JSON"),
                serde_json::from_str::<Value>(&local_output.content).expect("local JSON"),
                "{tool}"
            );
        }
        fs::remove_dir_all(root).expect("remove fixture");
        fs::remove_dir_all(fake_bin).expect("remove fake ssh bin");
    }

    #[cfg(unix)]
    #[tokio::test]
    #[ignore = "mutates process PATH; run filtered with one test thread"]
    async fn tools_work_without_external_search_binaries_on_path() {
        use std::os::unix::fs::PermissionsExt;

        struct PathGuard(Option<std::ffi::OsString>);
        impl Drop for PathGuard {
            fn drop(&mut self) {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }

        let original_path = std::env::var_os("PATH");
        let isolated_path =
            std::env::temp_dir().join(format!("nac-discovery-path-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&isolated_path).expect("create isolated PATH");
        for command in ["rg", "grep", "find", "fd"] {
            let shim = isolated_path.join(command);
            fs::write(&shim, "#!/bin/sh\nexit 97\n").expect("write failing search shim");
            fs::set_permissions(&shim, fs::Permissions::from_mode(0o755))
                .expect("make search shim executable");
        }
        let _path_guard = PathGuard(original_path);
        std::env::set_var("PATH", &isolated_path);

        let (runtime, root) = fixture_runtime();
        let glob = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
        assert_eq!(glob["entries"].as_array().expect("entries").len(), 2);
        let grep = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "globs": ["src/*.rs"]
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(grep["matches"].as_array().expect("matches").len(), 2);
        fs::remove_dir_all(root).expect("remove fixture");
        fs::remove_dir_all(isolated_path).expect("remove isolated PATH");
    }

    #[tokio::test]
    async fn scoped_roots_inherit_workspace_ignore_rules() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join(".gitignore"),
            "ignored.rs\n*.generated.rs\n/dist\n",
        )
        .expect("extend workspace ignore fixture");
        fs::write(
            root.join("nested/skipped.generated.rs"),
            "ExecutionBackend\n",
        )
        .expect("write ancestor-ignored fixture");
        fs::create_dir_all(root.join("dist/assets")).expect("create anchored ignore fixture");
        fs::write(root.join("dist/assets/skipped.rs"), "ExecutionBackend\n")
            .expect("write anchored ignored fixture");

        let glob = parsed(
            execute(
                "glob",
                json!({"pattern": "**/*.rs", "root": "nested"}),
                &runtime,
            )
            .await,
        );
        assert!(glob["entries"].as_array().expect("entries").is_empty());
        let grep = parsed(
            execute(
                "grep",
                json!({"pattern": "ExecutionBackend", "regex": false, "roots": ["nested"]}),
                &runtime,
            )
            .await,
        );
        assert!(grep["matches"].as_array().expect("matches").is_empty());
        let anchored_glob = parsed(
            execute(
                "glob",
                json!({"pattern": "**/*.rs", "root": "dist/assets"}),
                &runtime,
            )
            .await,
        );
        assert!(anchored_glob["entries"]
            .as_array()
            .expect("entries")
            .is_empty());
        let anchored_grep = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "ExecutionBackend",
                    "regex": false,
                    "roots": ["dist/assets"]
                }),
                &runtime,
            )
            .await,
        );
        assert!(anchored_grep["matches"]
            .as_array()
            .expect("matches")
            .is_empty());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn multiline_context_starts_after_the_match_end() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join("src/context.rs"),
            "before\nBEGIN\nmiddle\nafter\n",
        )
        .expect("write multiline context fixture");
        let output = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "BEGIN\n",
                    "roots": ["src"],
                    "globs": ["src/context.rs"],
                    "multiline": true,
                    "context": 1
                }),
                &runtime,
            )
            .await,
        );
        assert_eq!(output["matches"][0]["before"], json!(["before"]));
        assert_eq!(output["matches"][0]["after"], json!(["middle"]));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn byte_limited_pages_have_exact_continuation_cursors() {
        let (runtime, root) = fixture_runtime();
        for index in 0..400 {
            let directory = root.join(format!("src/{index:04}-{}", "x".repeat(180)));
            fs::create_dir(&directory).expect("create long path fixture");
            fs::write(directory.join("match.rs"), "x\n").expect("write long path fixture");
        }

        let mut cursor: Option<String> = None;
        let mut paths = Vec::new();
        loop {
            let output = parsed(
                execute(
                    "glob",
                    json!({
                        "pattern": "0*/match.rs",
                        "root": "src",
                        "limit": 1000,
                        "cursor": cursor
                    }),
                    &runtime,
                )
                .await,
            );
            assert!(output.to_string().len() <= 64 * 1024);
            paths.extend(
                output["entries"]
                    .as_array()
                    .expect("entries")
                    .iter()
                    .map(|entry| entry["path"].as_str().expect("path").to_string()),
            );
            cursor = output["next_cursor"].as_str().map(ToString::to_string);
            if cursor.is_none() {
                break;
            }
        }
        let expected: Vec<String> = (0..400)
            .map(|index| format!("src/{index:04}-{}/match.rs", "x".repeat(180)))
            .collect();
        assert_eq!(paths, expected);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn aggregate_arrays_and_version_specific_regexes_are_rejected() {
        let (runtime, root) = fixture_runtime();
        let roots: Vec<String> = (0..33).map(|index| format!("root-{index}")).collect();
        let excessive = execute("grep", json!({"pattern": "x", "roots": roots}), &runtime).await;
        assert!(excessive.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&excessive.content).expect("error JSON")["error"]["code"],
            "invalid_arguments"
        );

        let unsupported =
            execute("grep", json!({"pattern": "(?>x)", "regex": true}), &runtime).await;
        assert!(unsupported.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&unsupported.content).expect("error JSON")["error"]
                ["code"],
            "invalid_regex"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn native_engine_does_not_import_workspace_modules() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join("base64.py"),
            "from pathlib import Path\nPath('workspace-imported').write_text('bad')\n",
        )
        .expect("write import-shadow fixture");
        let output = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
        assert_eq!(output["entries"].as_array().expect("entries").len(), 2);
        assert!(!root.join("workspace-imported").exists());
        assert!(output["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .all(|entry| entry.get("size").is_none()));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn portable_regex_validation_keeps_ordinary_escapes() {
        let (runtime, root) = fixture_runtime();
        let escaped = parsed(
            execute(
                "grep",
                json!({"pattern": "\\bExecutionBackend\\b", "globs": ["src/*.rs"]}),
                &runtime,
            )
            .await,
        );
        assert_eq!(escaped["matches"].as_array().expect("matches").len(), 2);
        fs::write(root.join("src/café.rs"), "naïve matcher\n").expect("write Unicode fixture");
        let unicode_glob =
            parsed(execute("glob", json!({"pattern": "**/café.rs"}), &runtime).await);
        assert_eq!(unicode_glob["entries"][0]["path"], "src/café.rs");
        let unicode_grep = parsed(
            execute(
                "grep",
                json!({"pattern": "naïve", "regex": false, "globs": ["src/café.rs"]}),
                &runtime,
            )
            .await,
        );
        assert_eq!(unicode_grep["matches"][0]["path"], "src/café.rs");
        let literal_closing_brace =
            parsed(execute("grep", json!({"pattern": "}+", "regex": true}), &runtime).await);
        assert!(literal_closing_brace["matches"].is_array());

        for pattern in ["x(?i)y", "a{,3}+"] {
            let nonportable =
                execute("grep", json!({"pattern": pattern, "regex": true}), &runtime).await;
            assert!(nonportable.is_error, "{pattern}");
            assert_eq!(
                serde_json::from_str::<Value>(&nonportable.content).expect("error JSON")["error"]
                    ["code"],
                "invalid_regex"
            );
        }
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn context_materialization_has_a_cumulative_byte_limit() {
        let (runtime, root) = fixture_runtime();
        let line = format!("{}\n", "x".repeat(300));
        fs::write(root.join("src/memory.rs"), line.repeat(10_000))
            .expect("write materialization fixture");
        let output = parsed(
            execute(
                "grep",
                json!({
                    "pattern": "^",
                    "roots": ["src"],
                    "globs": ["src/memory.rs"],
                    "context": 100,
                    "limit": 1000
                }),
                &runtime,
            )
            .await,
        );
        assert!(output["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "materialized_limit"));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn gitignore_literals_invalid_rules_and_caret_classes_match_git() {
        let (runtime, root) = fixture_runtime();
        fs::write(
            root.join(".gitignore"),
            "\\!literal.rs\n[^a].txt\n[unterminated\n",
        )
        .expect("write gitignore semantics fixture");
        fs::write(root.join("!literal.rs"), "x").expect("write escaped-bang fixture");
        fs::write(root.join("a.txt"), "x").expect("write retained class fixture");
        fs::write(root.join("b.txt"), "x").expect("write ignored class fixture");

        let rust = parsed(execute("glob", json!({"pattern": "*literal.rs"}), &runtime).await);
        assert!(rust["entries"].as_array().expect("entries").is_empty());
        assert!(rust["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .any(|error| error["code"] == "invalid_ignore"));

        let text = parsed(execute("glob", json!({"pattern": "*.txt"}), &runtime).await);
        let text_paths: Vec<&str> = text["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .map(|entry| entry["path"].as_str().expect("path"))
            .collect();
        assert_eq!(text_paths, vec!["a.txt"]);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[tokio::test]
    async fn ignore_rules_have_cumulative_count_and_byte_limits() {
        let (runtime, root) = fixture_runtime();
        let roots: Vec<String> = (0..32).map(|index| format!("root-{index}")).collect();
        for directory in &roots {
            fs::create_dir(root.join(directory)).expect("create sibling root");
        }
        let shared_rules: String = (0..129).map(|index| format!("shared-{index}\n")).collect();
        fs::write(root.join(".gitignore"), shared_rules).expect("write shared ignore fixture");
        let shared =
            parsed(execute("grep", json!({"pattern": "x", "roots": roots}), &runtime).await);
        assert!(shared["matches"].as_array().expect("matches").is_empty());

        let rules: String = (0..4097)
            .map(|index| format!("ignored-{index}\n"))
            .collect();
        fs::write(root.join(".gitignore"), rules).expect("write excessive ignore fixture");
        let result = execute("glob", json!({"pattern": "**/*"}), &runtime).await;
        assert!(result.is_error);
        assert_eq!(
            serde_json::from_str::<Value>(&result.content).expect("error JSON")["error"]["code"],
            "ignore_limit"
        );

        fs::write(root.join(".gitignore"), "literal\\\\ \n")
            .expect("write trailing-space parity fixture");
        fs::write(root.join("literal\\"), "x").expect("write backslash filename fixture");
        let parity = parsed(execute("glob", json!({"pattern": "literal*"}), &runtime).await);
        assert!(parity["entries"].as_array().expect("entries").is_empty());
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
