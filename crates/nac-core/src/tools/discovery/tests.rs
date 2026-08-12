use std::fs;
use std::sync::Arc;

use serde_json::{json, Value};

use super::execute;
fn fixture_runtime() -> (crate::tools::ToolRuntime, std::path::PathBuf) {
    let root = std::env::temp_dir().join(format!("nac-discovery-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("src")).expect("create src fixture");
    fs::create_dir_all(root.join("target")).expect("create target fixture");
    fs::create_dir_all(root.join(".git")).expect("create .git fixture");
    fs::create_dir_all(root.join("node_modules")).expect("create node_modules fixture");
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
    fs::write(root.join(".git/meta.rs"), "ExecutionBackend\n")
        .expect("write .git generated fixture");
    fs::write(root.join("node_modules/package.rs"), "ExecutionBackend\n")
        .expect("write node_modules generated fixture");
    fs::write(root.join(".hidden/secret.rs"), "ExecutionBackend\n").expect("write hidden fixture");
    fs::write(root.join("nested/drop.txt"), "ExecutionBackend\n")
        .expect("write nested ignored fixture");
    fs::write(root.join("nested/keep.txt"), "before\nneedle\nafter\n")
        .expect("write nested re-included fixture");
    fs::write(root.join("nested/.gitignore"), "*.txt\n!keep.txt\n")
        .expect("write nested ignore fixture");
    fs::write(root.join("binary.dat"), b"ExecutionBackend\0binary").expect("write binary fixture");
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
async fn grep_accepts_file_roots() {
    let (runtime, root) = fixture_runtime();
    let output = parsed(
        execute(
            "grep",
            json!({
                "pattern": "ExecutionBackend",
                "regex": false,
                "roots": ["src/a.rs"]
            }),
            &runtime,
        )
        .await,
    );
    assert_eq!(output["matches"].as_array().expect("matches").len(), 1);
    assert_eq!(output["matches"][0]["path"], "src/a.rs");
    assert_eq!(output["matches"][0]["line"], 1);

    fs::create_dir(root.join("blocked")).expect("create ignored file-root fixture");
    fs::write(root.join("blocked/item.rs"), "ExecutionBackend\n")
        .expect("write ignored file-root fixture");
    fs::write(root.join(".gitignore"), "ignored.rs\nblocked/\n").expect("ignore file-root parent");
    fs::write(root.join("blocked/.gitignore"), "[unterminated\n")
        .expect("write invalid nested ignore fixture");
    let ignored = parsed(
        execute(
            "grep",
            json!({
                "pattern": "ExecutionBackend",
                "regex": false,
                "roots": ["blocked/item.rs"]
            }),
            &runtime,
        )
        .await,
    );
    assert!(ignored["matches"].as_array().expect("matches").is_empty());
    assert!(ignored["errors"].as_array().expect("errors").is_empty());

    fs::write(root.join(".hidden/.gitignore"), "[unterminated\n")
        .expect("write hidden invalid ignore fixture");
    let hidden = parsed(
        execute(
            "grep",
            json!({
                "pattern": "ExecutionBackend",
                "regex": false,
                "roots": [".hidden/secret.rs"]
            }),
            &runtime,
        )
        .await,
    );
    assert!(hidden["matches"].as_array().expect("matches").is_empty());
    assert!(hidden["errors"].as_array().expect("errors").is_empty());

    let invalid_descendant = execute(
        "grep",
        json!({
            "pattern": "ExecutionBackend",
            "regex": false,
            "roots": ["src/a.rs", "src/a.rs/child"]
        }),
        &runtime,
    )
    .await;
    assert!(invalid_descendant.is_error);
    assert_eq!(
        serde_json::from_str::<Value>(&invalid_descendant.content).expect("error JSON")["error"]
            ["code"],
        "not_directory"
    );
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

    let empty = execute("glob", json!({"pattern": ""}), &runtime).await;
    assert!(empty.is_error);
    assert_eq!(
        serde_json::from_str::<Value>(&empty.content).expect("error JSON")["error"]["code"],
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

    let unreadable = execute(
        "glob",
        json!({"pattern": "**", "root": "missing-directory"}),
        &runtime,
    )
    .await;
    assert!(unreadable.is_error);
    assert_eq!(
        serde_json::from_str::<Value>(&unreadable.content).expect("error JSON")["error"]["code"],
        "unreadable_path"
    );
    fs::remove_dir_all(root).expect("remove fixture");
}

#[tokio::test]
async fn tilde_prefixed_relative_roots_are_not_shell_expanded() {
    let (runtime, root) = fixture_runtime();
    fs::create_dir(root.join("~cache")).expect("create tilde fixture");
    fs::write(root.join("~cache/item.rs"), "needle\n").expect("write tilde fixture");
    let output = parsed(
        execute(
            "glob",
            json!({"pattern": "*.rs", "root": "~cache"}),
            &runtime,
        )
        .await,
    );
    assert_eq!(output["entries"][0]["path"], "~cache/item.rs");
    fs::remove_dir_all(root).expect("remove fixture");
}

#[cfg(unix)]
#[tokio::test]
async fn unreadable_directories_are_reported_without_hiding_readable_results() {
    use std::os::unix::fs::PermissionsExt;

    let (runtime, root) = fixture_runtime();
    let locked = root.join("locked");
    fs::create_dir(&locked).expect("create unreadable fixture");
    fs::write(locked.join("secret.rs"), "ExecutionBackend\n").expect("write unreadable fixture");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o0)).expect("make fixture unreadable");
    let output = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o700))
        .expect("restore fixture permissions");
    assert!(output["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .any(|entry| entry["path"] == "src/a.rs"));
    assert!(output["errors"]
        .as_array()
        .expect("errors")
        .iter()
        .any(|error| error["code"] == "unreadable_path" && error["path"] == "locked"));
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
            ".git/meta.rs",
            ".hidden/secret.rs",
            "ignored.rs",
            "node_modules/package.rs",
            "src/a.rs",
            "src/b.rs",
            "target/generated.rs",
        ]
    );
    fs::remove_dir_all(root).expect("remove fixture");
}

#[tokio::test]
async fn generated_tree_names_only_exclude_directories() {
    let (runtime, root) = fixture_runtime();
    fs::create_dir(root.join("names")).expect("create generated-name fixture");
    fs::write(root.join("names/target"), "file\n").expect("write target file");
    fs::write(root.join("names/.git"), "file\n").expect("write .git file");
    fs::write(root.join("names/node_modules"), "file\n").expect("write node_modules file");
    let output = parsed(execute("glob", json!({"pattern": "**", "hidden": true}), &runtime).await);
    let paths: Vec<&str> = output["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .map(|entry| entry["path"].as_str().expect("path"))
        .collect();
    assert!(paths.contains(&"names/.git"));
    assert!(paths.contains(&"names/node_modules"));
    assert!(paths.contains(&"names/target"));
    assert!(!paths.contains(&".git"));
    assert!(!paths.contains(&"node_modules"));
    assert!(!paths.contains(&"target"));
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
async fn scoped_search_does_not_enumerate_ancestor_siblings_for_gitignore() {
    let (runtime, root) = fixture_runtime();
    for index in 0..=super::MAX_ENTRIES {
        fs::write(root.join(format!("sibling-{index}")), b"").expect("write sibling fixture");
    }
    let output = parsed(execute("glob", json!({"pattern": "*.rs", "root": "src"}), &runtime).await);
    assert_eq!(output["entries"].as_array().expect("entries").len(), 2);
    assert!(output["errors"]
        .as_array()
        .expect("errors")
        .iter()
        .all(|error| error["code"] != "entry_limit"));
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
    let insensitive = parsed(
        execute(
            "grep",
            json!({
                "pattern": "EXECUTIONBACKEND",
                "regex": false,
                "globs": ["src/*.rs"],
                "case": "insensitive"
            }),
            &runtime,
        )
        .await,
    );
    assert_eq!(insensitive["matches"].as_array().expect("matches").len(), 2);
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
        serde_json::from_str::<Value>(&invalid_regex.content).expect("error JSON")["error"]["code"],
        "invalid_regex"
    );
    let invalid_limit = execute("glob", json!({"pattern": "**", "limit": 0}), &runtime).await;
    assert!(invalid_limit.is_error);
    assert_eq!(
        serde_json::from_str::<Value>(&invalid_limit.content).expect("error JSON")["error"]["code"],
        "invalid_arguments"
    );
    let first = parsed(execute("glob", json!({"pattern": "**/*.rs", "limit": 1}), &runtime).await);
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
        serde_json::from_str::<Value>(&mismatched.content).expect("error JSON")["error"]["code"],
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
    struct PauseGuard;
    impl Drop for PauseGuard {
        fn drop(&mut self) {
            super::PAUSE_SEARCH_TASKS.store(false, std::sync::atomic::Ordering::Release);
        }
    }

    let (runtime, root) = fixture_runtime();
    fs::write(
        root.join(super::CANCELLATION_FIXTURE_PATH),
        vec![b'a'; 8 * 1024 * 1024],
    )
    .expect("write cancellation fixture");
    super::PAUSE_SEARCH_TASKS.store(true, std::sync::atomic::Ordering::Release);
    let _pause_guard = PauseGuard;
    let task = tokio::spawn(async move {
        execute(
            "grep",
            json!({
                "pattern": "not-present",
                "globs": [super::CANCELLATION_FIXTURE_PATH],
                "case": "sensitive"
            }),
            &runtime,
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while super::ACTIVE_SEARCH_TASKS.load(std::sync::atomic::Ordering::Acquire) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("content search worker must start");
    task.abort();
    let joined = tokio::time::timeout(std::time::Duration::from_secs(1), task)
        .await
        .expect("cancelled search must stop promptly");
    assert!(joined
        .expect_err("aborted task must not complete")
        .is_cancelled());
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while super::ACTIVE_SEARCH_TASKS.load(std::sync::atomic::Ordering::Acquire) != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cancelled content search worker must stop");
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
    let absolute = parsed(
        execute(
            "glob",
            json!({"pattern": "**", "root": root.join("escape")}),
            &runtime,
        )
        .await,
    );
    assert!(absolute["errors"]
        .as_array()
        .expect("errors")
        .iter()
        .any(|error| error["code"] == "symlink_escape" && error["path"] == "escape"));

    fs::write(root.join(".gitignore"), "ignored.rs\nescape\n").expect("ignore symlink fixture");
    let ignored = parsed(execute("glob", json!({"pattern": "**"}), &runtime).await);
    assert!(ignored["errors"]
        .as_array()
        .expect("errors")
        .iter()
        .all(|error| error["path"] != "escape"));
    fs::remove_dir_all(root).expect("remove fixture");
    fs::remove_dir_all(outside).expect("remove outside fixture");
}

#[cfg(unix)]
#[tokio::test]
async fn special_files_are_rejected_without_blocking_native_reads() {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let (runtime, root) = fixture_runtime();
    let fifo = root.join("changed-after-enumeration.rs");
    let fifo_path = CString::new(fifo.as_os_str().as_bytes()).expect("FIFO path");
    assert_eq!(
        unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) },
        0,
        "create FIFO fixture"
    );
    let mut workspace = super::WorkspaceFs::open(&runtime)
        .await
        .expect("open workspace");
    let error = tokio::time::timeout(
        std::time::Duration::from_millis(250),
        workspace.read_file("changed-after-enumeration.rs", 1024),
    )
    .await
    .expect("special-file read must not block")
    .expect_err("special file must be rejected");
    assert_eq!(error.code, "unreadable_path");
    fs::remove_dir_all(root).expect("remove fixture");
}

#[tokio::test]
async fn sandbox_discovery_composes_nested_workspace_mounts() {
    let base = std::env::temp_dir().join(format!("nac-discovery-base-{}", uuid::Uuid::new_v4()));
    let vendor =
        std::env::temp_dir().join(format!("nac-discovery-vendor-{}", uuid::Uuid::new_v4()));
    let package =
        std::env::temp_dir().join(format!("nac-discovery-package-{}", uuid::Uuid::new_v4()));
    let config =
        std::env::temp_dir().join(format!("nac-discovery-config-{}.rs", uuid::Uuid::new_v4()));
    fs::create_dir_all(base.join("vendor")).expect("create shadowed base directory");
    fs::create_dir_all(&vendor).expect("create vendor mount");
    fs::create_dir_all(&package).expect("create package mount");
    fs::write(base.join("vendor/old.rs"), "shadowed\n").expect("write shadowed base file");
    fs::write(vendor.join("new.rs"), "mounted\n").expect("write vendor file");
    fs::write(package.join("lib.rs"), "nested\n").expect("write package file");
    fs::write(&config, "single-file mount\n").expect("write single-file mount");

    let session = crate::sandbox::SandboxSession::new_for_test(crate::sandbox::SandboxSpec {
        backend: crate::sandbox::SandboxBackendType::Podman,
        image: crate::sandbox::DEFAULT_SANDBOX_IMAGE.to_string(),
        mounts: vec![
            crate::sandbox::MountSpec {
                host: base.clone(),
                guest: std::path::PathBuf::from("/workspace"),
                read_only: false,
            },
            crate::sandbox::MountSpec {
                host: vendor.clone(),
                guest: std::path::PathBuf::from("/workspace/vendor"),
                read_only: true,
            },
            crate::sandbox::MountSpec {
                host: package.clone(),
                guest: std::path::PathBuf::from("/workspace/deps/pkg"),
                read_only: true,
            },
            crate::sandbox::MountSpec {
                host: config.clone(),
                guest: std::path::PathBuf::from("/workspace/config.rs"),
                read_only: true,
            },
        ],
        workdir: std::path::PathBuf::from("/workspace"),
        gpu_devices: Vec::new(),
        shm_size: Some("0".to_string()),
        cpus: 2,
        memory_mib: 2048,
    });
    let mut runtime = crate::tools::test_runtime();
    runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Sandbox(session));

    let output = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
    let paths: Vec<&str> = output["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .map(|entry| entry["path"].as_str().expect("path"))
        .collect();
    assert_eq!(paths, vec!["config.rs", "deps/pkg/lib.rs", "vendor/new.rs"]);
    let grep = parsed(
        execute(
            "grep",
            json!({"pattern": "single-file", "globs": ["config.rs"]}),
            &runtime,
        )
        .await,
    );
    assert_eq!(grep["matches"][0]["path"], "config.rs");

    fs::remove_dir_all(base).expect("remove base fixture");
    fs::remove_dir_all(vendor).expect("remove vendor fixture");
    fs::remove_dir_all(package).expect("remove package fixture");
    fs::remove_file(config).expect("remove single-file fixture");
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn invalid_utf8_entries_do_not_hide_valid_siblings() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let (runtime, root) = fixture_runtime();
    let invalid = root.join(OsString::from_vec(vec![b'b', b'a', b'd', 0xff]));
    fs::write(invalid, "ignored").expect("write invalid UTF-8 fixture");
    let output = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
    let paths: Vec<&str> = output["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .map(|entry| entry["path"].as_str().expect("path"))
        .collect();
    assert_eq!(paths, vec!["src/a.rs", "src/b.rs"]);
    assert!(output["errors"]
        .as_array()
        .expect("errors")
        .iter()
        .any(|error| error["code"] == "invalid_utf8_path"));
    fs::remove_dir_all(root).expect("remove fixture");
}

#[tokio::test]
#[ignore = "requires Podman"]
async fn podman_and_local_backends_return_identical_discovery_pages() {
    let (local, root) = fixture_runtime();
    let mut podman = podman_runtime(&root).await;
    let decoy = std::env::temp_dir().join(format!("nac-discovery-decoy-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&decoy).expect("create launch-directory decoy");
    fs::write(decoy.join("host-only-secret.rs"), "must not be visible")
        .expect("write launch-directory decoy");
    podman.workspace_cwd = decoy.clone();
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
    let unmounted = crate::sandbox::SandboxSession::create(
        crate::sandbox::SandboxSpec {
            backend: crate::sandbox::SandboxBackendType::Podman,
            image: crate::sandbox::DEFAULT_SANDBOX_IMAGE.to_string(),
            mounts: Vec::new(),
            workdir: std::path::PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
            gpu_devices: Vec::new(),
            shm_size: Some("0".to_string()),
            cpus: 2,
            memory_mib: 512,
        },
        format!("discovery-unmounted-test-{}", uuid::Uuid::new_v4()),
        true,
    )
    .await
    .expect("create unmounted Podman fixture");
    let mut unmounted_runtime = crate::tools::test_runtime();
    unmounted_runtime.workspace_cwd = root.clone();
    unmounted_runtime.backend =
        crate::sandbox::execution_backend_from_sandbox(Some(unmounted), &root);
    let rejected = execute("glob", json!({"pattern": "**"}), &unmounted_runtime).await;
    assert!(rejected.is_error);
    assert_eq!(
        serde_json::from_str::<Value>(&rejected.content).expect("error JSON")["error"]["code"],
        "backend_protocol"
    );
    fs::remove_dir_all(root).expect("remove fixture");
    fs::remove_dir_all(decoy).expect("remove launch-directory decoy");
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "mutates process PATH; run filtered with one test thread"]
async fn ssh_and_local_backends_return_identical_discovery_pages() {
    use std::os::unix::fs::PermissionsExt;

    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    let (local, root) = fixture_runtime();
    let original_path = std::env::var_os("PATH");
    let fake_bin = std::env::temp_dir().join(format!("nac-fake-ssh-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&fake_bin).expect("create fake ssh bin");
    let ssh = fake_bin.join("ssh");
    fs::write(
            &ssh,
            format!(
                "#!/bin/sh\ncd '{}' || exit 126\nfor server in /usr/libexec/sftp-server /usr/lib/openssh/sftp-server; do\n    [ -x \"$server\" ] && exec \"$server\"\ndone\nexit 127\n",
                root.display()
            ),
        )
        .expect("write fake ssh");
    fs::set_permissions(&ssh, fs::Permissions::from_mode(0o755)).expect("make fake ssh executable");
    let combined_path = std::env::join_paths(
        std::iter::once(fake_bin.clone()).chain(
            original_path
                .as_deref()
                .into_iter()
                .flat_map(std::env::split_paths),
        ),
    )
    .expect("compose fake ssh PATH");
    let _path_guard = crate::test_utils::EnvVarGuard::set("PATH", combined_path);

    let mut ssh_runtime = crate::tools::test_runtime();
    ssh_runtime.workspace_cwd = std::path::PathBuf::from(".");
    ssh_runtime.config_cwd = root.clone();
    ssh_runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Ssh(
        crate::sandbox::SshBackend::new("fixture-host".to_string(), std::path::PathBuf::from(".")),
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
    let request = json!({"pattern": "**/*.rs"});
    let expected = execute("glob", request.clone(), &local).await;
    for remote_cwd in [root.clone(), std::path::PathBuf::from("~")] {
        ssh_runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Ssh(
            crate::sandbox::SshBackend::new("fixture-host".to_string(), remote_cwd.clone()),
        ));
        let actual = execute("glob", request.clone(), &ssh_runtime).await;
        assert_eq!(
            serde_json::from_str::<Value>(&actual.content).expect("SSH root JSON"),
            serde_json::from_str::<Value>(&expected.content).expect("local root JSON"),
            "remote cwd {}",
            remote_cwd.display()
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

    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    let isolated_path =
        std::env::temp_dir().join(format!("nac-discovery-path-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&isolated_path).expect("create isolated PATH");
    for command in ["rg", "grep", "find", "fd"] {
        let shim = isolated_path.join(command);
        fs::write(&shim, "#!/bin/sh\nexit 97\n").expect("write failing search shim");
        fs::set_permissions(&shim, fs::Permissions::from_mode(0o755))
            .expect("make search shim executable");
    }
    let _path_guard = crate::test_utils::EnvVarGuard::set("PATH", &isolated_path);

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

    let unsupported = execute("grep", json!({"pattern": "(?>x)", "regex": true}), &runtime).await;
    assert!(unsupported.is_error);
    assert_eq!(
        serde_json::from_str::<Value>(&unsupported.content).expect("error JSON")["error"]["code"],
        "invalid_regex"
    );
    fs::remove_dir_all(root).expect("remove fixture");
}

#[tokio::test]
async fn rust_pattern_engines_handle_unicode_and_supported_syntax() {
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
    fs::write(root.join("src/café.rs"), "naïve xY matcher\n").expect("write Unicode fixture");
    let unicode_glob = parsed(execute("glob", json!({"pattern": "**/café.rs"}), &runtime).await);
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
    let inline_flags = parsed(
        execute(
            "grep",
            json!({"pattern": "x(?i)y", "globs": ["src/café.rs"]}),
            &runtime,
        )
        .await,
    );
    assert_eq!(inline_flags["matches"][0]["path"], "src/café.rs");
    let invalid = execute("grep", json!({"pattern": "(", "regex": true}), &runtime).await;
    assert!(invalid.is_error);
    assert_eq!(
        serde_json::from_str::<Value>(&invalid.content).expect("error JSON")["error"]["code"],
        "invalid_regex"
    );
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
async fn newline_heavy_files_stop_at_the_line_index_budget() {
    let (runtime, root) = fixture_runtime();
    fs::write(root.join("src/many-lines.txt"), "\n".repeat(200_000))
        .expect("write exact line-budget fixture");
    let exact = parsed(
        execute(
            "grep",
            json!({"pattern": "missing", "globs": ["src/many-lines.txt"]}),
            &runtime,
        )
        .await,
    );
    assert!(exact["errors"]
        .as_array()
        .expect("errors")
        .iter()
        .all(|error| error["code"] != "line_limit"));

    fs::write(root.join("src/many-lines.txt"), "\n".repeat(200_001))
        .expect("write over line-budget fixture");
    let output = parsed(
        execute(
            "grep",
            json!({"pattern": "missing", "globs": ["src/many-lines.txt"]}),
            &runtime,
        )
        .await,
    );
    assert!(output["errors"]
        .as_array()
        .expect("errors")
        .iter()
        .any(|error| error["code"] == "line_limit"));
    fs::remove_dir_all(root).expect("remove fixture");
}

#[tokio::test]
async fn directory_enumeration_stops_at_its_input_budget() {
    let (runtime, root) = fixture_runtime();
    let mut filesystem = super::WorkspaceFs::open(&runtime)
        .await
        .expect("open fixture filesystem");
    let cancellation = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let error = match filesystem.list_dir("src", 1, &cancellation).await {
        Ok(_) => panic!("directory must exceed one entry"),
        Err(error) => error,
    };
    assert_eq!(error.code, "entry_limit");
    filesystem.close().await;
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
    assert_eq!(
        rust["errors"]
            .as_array()
            .expect("errors")
            .iter()
            .filter(|error| error["code"] == "invalid_ignore")
            .count(),
        1
    );

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
    let shared = parsed(execute("grep", json!({"pattern": "x", "roots": roots}), &runtime).await);
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

#[tokio::test]
async fn normalized_noop_ignore_lines_do_not_consume_rule_budget() {
    let (runtime, root) = fixture_runtime();
    fs::write(root.join(".gitignore"), "   \n".repeat(4097)).expect("write no-op ignore fixture");
    let output = parsed(execute("glob", json!({"pattern": "**/*.rs"}), &runtime).await);
    assert!(output["errors"]
        .as_array()
        .expect("errors")
        .iter()
        .all(|error| error["code"] != "ignore_limit"));
    fs::remove_dir_all(root).expect("remove fixture");
}

#[tokio::test]
async fn exact_match_cap_does_not_hide_later_files() {
    let (runtime, root) = fixture_runtime();
    fs::write(root.join("src/cap-a.txt"), "needle\n".repeat(10_000))
        .expect("write exact match-cap fixture");
    fs::write(root.join("src/cap-z.txt"), "needle\n").expect("write later match fixture");
    let mut cursor = None;
    let mut paths = Vec::new();
    let mut errors = Vec::new();
    loop {
        let mut request = json!({
            "pattern": "needle",
            "regex": false,
            "globs": ["src/cap-*.txt"],
            "limit": 1000
        });
        if let Some(value) = cursor.take() {
            request["cursor"] = Value::String(value);
        }
        let output = parsed(execute("grep", request, &runtime).await);
        paths.extend(
            output["matches"]
                .as_array()
                .expect("matches")
                .iter()
                .map(|entry| entry["path"].as_str().expect("path").to_string()),
        );
        errors.extend(output["errors"].as_array().expect("errors").iter().cloned());
        cursor = output["next_cursor"].as_str().map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(paths.len(), 10_001);
    assert_eq!(paths.last().map(String::as_str), Some("src/cap-z.txt"));
    assert!(errors.iter().all(|error| error["code"] != "match_limit"));
    fs::remove_dir_all(root).expect("remove fixture");
}

#[tokio::test]
async fn per_file_match_cap_does_not_hide_later_files() {
    let (runtime, root) = fixture_runtime();
    fs::write(root.join("src/cap-a.txt"), "needle\n".repeat(10_001))
        .expect("write over-cap match fixture");
    fs::write(root.join("src/cap-z.txt"), "needle\n").expect("write later match fixture");
    let mut cursor = None;
    let mut paths = Vec::new();
    let mut errors = Vec::new();
    loop {
        let mut request = json!({
            "pattern": "needle",
            "regex": false,
            "globs": ["src/cap-*.txt"],
            "limit": 1000
        });
        if let Some(value) = cursor.take() {
            request["cursor"] = Value::String(value);
        }
        let output = parsed(execute("grep", request, &runtime).await);
        paths.extend(
            output["matches"]
                .as_array()
                .expect("matches")
                .iter()
                .map(|entry| entry["path"].as_str().expect("path").to_string()),
        );
        errors.extend(output["errors"].as_array().expect("errors").iter().cloned());
        cursor = output["next_cursor"].as_str().map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(paths.len(), 10_001);
    assert_eq!(paths.last().map(String::as_str), Some("src/cap-z.txt"));
    assert_eq!(
        errors
            .iter()
            .filter(|error| { error["code"] == "match_limit" && error["path"] == "src/cap-a.txt" })
            .count(),
        1
    );
    fs::remove_dir_all(root).expect("remove fixture");
}

#[tokio::test]
async fn aggregate_record_cap_stays_bounded_after_per_file_caps() {
    let (runtime, root) = fixture_runtime();
    fs::write(root.join("src/cap-a.txt"), "needle\n".repeat(10_001))
        .expect("write first dense fixture");
    fs::write(root.join("src/cap-b.txt"), "needle\n".repeat(10_000))
        .expect("write second dense fixture");
    fs::write(root.join("src/cap-z.txt"), "needle\n").expect("write later match fixture");
    let mut cursor = None;
    let mut paths = Vec::new();
    let mut errors = Vec::new();
    loop {
        let mut request = json!({
            "pattern": "needle",
            "regex": false,
            "globs": ["src/cap-*.txt"],
            "limit": 1000
        });
        if let Some(value) = cursor.take() {
            request["cursor"] = Value::String(value);
        }
        let output = parsed(execute("grep", request, &runtime).await);
        paths.extend(
            output["matches"]
                .as_array()
                .expect("matches")
                .iter()
                .map(|entry| entry["path"].as_str().expect("path").to_string()),
        );
        errors.extend(output["errors"].as_array().expect("errors").iter().cloned());
        cursor = output["next_cursor"].as_str().map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(paths.len() + errors.len(), 20_000);
    assert_eq!(paths.len(), 19_998);
    assert!(paths.iter().all(|path| path != "src/cap-z.txt"));
    assert_eq!(
        errors
            .iter()
            .filter(|error| { error["code"] == "match_limit" && error["path"] == "src/cap-a.txt" })
            .count(),
        1
    );
    assert_eq!(
        errors
            .iter()
            .filter(|error| { error["code"] == "record_limit" && error["path"] == "src/cap-b.txt" })
            .count(),
        1
    );
    fs::remove_dir_all(root).expect("remove fixture");
}
