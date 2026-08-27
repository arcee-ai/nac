use super::*;
use serde_json::json;
use std::process::Command;
use std::sync::Arc;

#[cfg(unix)]
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
#[cfg(unix)]
use std::io::{Read, Write};
#[cfg(unix)]
use std::net::TcpListener;
#[cfg(unix)]
use std::time::{Duration, Instant};

fn test_runtime() -> ToolRuntime {
    crate::tools::test_runtime()
}

fn unique_temp_dir(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nac_exec_{label}_{unique}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

const PROMPT_POLICY_COMMAND: &str =
    "printf '%s|%s|%s\n' \"$GIT_TERMINAL_PROMPT\" \"$GCM_INTERACTIVE\" \"$GH_PROMPT_DISABLED\"";

const NATIVE_CREDENTIAL_COMMAND: &str = "printf '%s' \"${EXA_API_KEY-unset}\"";

#[tokio::test]
async fn prompt_policy_process_helper() {
    let Some(result_path) = std::env::var_os("NAC_PROMPT_POLICY_RESULT") else {
        return;
    };

    let runtime = test_runtime();
    let one_shot = execute_exec_command(
        &json!({
            "cmd": PROMPT_POLICY_COMMAND,
            "tty": false,
            "yield_time_ms": 2000
        }),
        &runtime,
    )
    .await;
    assert!(!one_shot.is_error, "{}", one_shot.content);
    let pty = execute_exec_command(
        &json!({
            "cmd": PROMPT_POLICY_COMMAND,
            "tty": true,
            "yield_time_ms": 2000
        }),
        &runtime,
    )
    .await;
    assert!(!pty.is_error, "{}", pty.content);

    let one_shot: Value =
        serde_json::from_str(one_shot.content.as_text().expect("text tool result")).unwrap();
    let pty: Value =
        serde_json::from_str(pty.content.as_text().expect("text tool result")).unwrap();
    runtime.terminal_manager.remove_all().await.unwrap();
    std::fs::write(
        result_path,
        serde_json::to_vec(&json!({ "one_shot": one_shot, "pty": pty })).unwrap(),
    )
    .unwrap();
}

fn run_prompt_policy_process_helper() -> Value {
    let dir = unique_temp_dir("prompt_policy");
    let result_path = dir.join("result.json");
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "tools::exec_command::tests::prompt_policy_process_helper",
            "--nocapture",
        ])
        .env("NAC_PROMPT_POLICY_RESULT", &result_path)
        .env("GIT_TERMINAL_PROMPT", "sentinel-git")
        .env("GCM_INTERACTIVE", "sentinel-gcm")
        .env("GH_PROMPT_DISABLED", "sentinel-gh")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "prompt-policy helper failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let result = serde_json::from_slice(&std::fs::read(&result_path).unwrap()).unwrap();
    let _ = std::fs::remove_dir_all(dir);
    result
}

#[tokio::test]
async fn native_credential_process_helper() {
    let Some(result_path) = std::env::var_os("NAC_NATIVE_CREDENTIAL_RESULT") else {
        return;
    };

    let runtime = test_runtime();
    let one_shot = execute_exec_command(
        &json!({
            "cmd": NATIVE_CREDENTIAL_COMMAND,
            "tty": false,
            "yield_time_ms": 2000
        }),
        &runtime,
    )
    .await;
    assert!(!one_shot.is_error, "{}", one_shot.content);
    let pty = execute_exec_command(
        &json!({
            "cmd": NATIVE_CREDENTIAL_COMMAND,
            "tty": true,
            "yield_time_ms": 2000
        }),
        &runtime,
    )
    .await;
    assert!(!pty.is_error, "{}", pty.content);

    let one_shot: Value =
        serde_json::from_str(one_shot.content.as_text().expect("text tool result")).unwrap();
    let pty: Value =
        serde_json::from_str(pty.content.as_text().expect("text tool result")).unwrap();
    runtime.terminal_manager.remove_all().await.unwrap();
    std::fs::write(
        result_path,
        serde_json::to_vec(&json!({ "one_shot": one_shot, "pty": pty })).unwrap(),
    )
    .unwrap();
}

fn run_native_credential_process_helper() -> Value {
    let dir = unique_temp_dir("native_credential");
    let result_path = dir.join("result.json");
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "tools::exec_command::tests::native_credential_process_helper",
            "--nocapture",
        ])
        .env("NAC_NATIVE_CREDENTIAL_RESULT", &result_path)
        .env("EXA_API_KEY", "exa-command-environment-canary")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "native-credential helper failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let result = serde_json::from_slice(&std::fs::read(&result_path).unwrap()).unwrap();
    let _ = std::fs::remove_dir_all(dir);
    result
}

#[cfg(unix)]
#[tokio::test]
async fn git_prompt_process_helper() {
    let Some(result_path) = std::env::var_os("NAC_GIT_PROMPT_RESULT") else {
        return;
    };
    let prompt_override = if std::env::var_os("NAC_GIT_PROMPT_ENABLE").is_some() {
        "GIT_TERMINAL_PROMPT=1 "
    } else {
        ""
    };
    let cmd = format!(
        "unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy GIT_PROXY_COMMAND; \
         export NO_PROXY='*' no_proxy='*' GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
         GIT_CONFIG_COUNT=0 GIT_ASKPASS='' SSH_ASKPASS='' LANG=C LC_ALL=C LANGUAGE=''; \
         {prompt_override}git -c credential.helper= -c core.askPass= -c http.proxy= \
         ls-remote \"$NAC_GIT_PROMPT_URL\""
    );
    let result = execute_exec_command(
        &json!({ "cmd": cmd, "tty": false, "yield_time_ms": 1000 }),
        &test_runtime(),
    )
    .await;
    std::fs::write(
        result_path,
        result.content.as_text().expect("text tool result"),
    )
    .unwrap();
}

#[cfg(unix)]
fn run_git_prompt_case(enable_prompt: bool) -> (Value, String) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/repo", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream
                        .set_read_timeout(Some(Duration::from_secs(1)))
                        .unwrap();
                    let mut request = [0u8; 4096];
                    let _ = stream.read(&mut request);
                    stream
                        .write_all(
                            b"HTTP/1.1 401 Unauthorized\r\n\
                              WWW-Authenticate: Basic realm=\"nac-test\"\r\n\
                              Content-Length: 0\r\n\
                              Connection: close\r\n\r\n",
                        )
                        .unwrap();
                    return true;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return false;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(_) => return false,
            }
        }
    });

    let dir = unique_temp_dir(if enable_prompt {
        "git_prompt_enabled"
    } else {
        "git_prompt_disabled"
    });
    let result_path = dir.join("result.json");
    let pty_pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: 24,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut reader = pty_pair.master.try_clone_reader().unwrap();
    let capture = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => bytes.extend_from_slice(&buffer[..read]),
                Err(error) if error.raw_os_error() == Some(libc::EIO) => break,
                Err(error) => panic!("failed to read helper PTY: {error}"),
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    });

    let mut command = CommandBuilder::new(std::env::current_exe().unwrap());
    command.args([
        "--exact",
        "tools::exec_command::tests::git_prompt_process_helper",
        "--nocapture",
    ]);
    command.env("NAC_GIT_PROMPT_RESULT", &result_path);
    command.env("NAC_GIT_PROMPT_URL", &url);
    if enable_prompt {
        command.env("NAC_GIT_PROMPT_ENABLE", "1");
    }
    let mut child = pty_pair.slave.spawn_command(command).unwrap();
    drop(pty_pair.slave);

    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break Some(status);
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    drop(pty_pair.master);
    let terminal_output = capture.join().unwrap();
    assert!(server.join().unwrap(), "Git never reached the HTTP fixture");
    let status =
        status.unwrap_or_else(|| panic!("Git prompt helper hung; PTY output={terminal_output}"));
    assert!(
        status.success(),
        "Git prompt helper failed with {}; PTY output={terminal_output}",
        status.exit_code()
    );

    let result = serde_json::from_slice(&std::fs::read(&result_path).unwrap()).unwrap();
    let _ = std::fs::remove_dir_all(dir);
    (result, terminal_output)
}

fn command_preview(value: &Value) -> String {
    format!(
        "{}{}",
        value["stdout_preview"].as_str().unwrap_or_default(),
        value["stderr_preview"].as_str().unwrap_or_default()
    )
}

#[test]
fn worker_definitions_explain_recovery() {
    assert!(exec_command_definition()
        .function
        .description
        .contains("read_command_output"));
    assert!(exec_command_definition()
        .function
        .description
        .contains("non-interactively"));
    assert!(exec_command_definition()
        .function
        .description
        .contains("terminal prompts are disabled"));
    assert_eq!(
        read_command_output_definition().function.name,
        "read_command_output"
    );
    let write_stdin = write_stdin_definition();
    let chars = &write_stdin.function.parameters["properties"]["chars"]["description"];
    assert!(chars.as_str().unwrap().contains("Nonempty input"));
    assert!(!chars.as_str().unwrap().contains("Must be empty"));
}

#[test]
fn one_shot_overrides_inherited_prompt_policy() {
    let result = run_prompt_policy_process_helper();
    assert_eq!(result["one_shot"]["stdout_preview"], "0|0|1\n");
}

#[test]
fn pty_preserves_inherited_prompt_policy() {
    let result = run_prompt_policy_process_helper();
    let output = result["pty"]["content_preview"].as_str().unwrap();
    assert!(
        output.contains("sentinel-git|sentinel-gcm|sentinel-gh"),
        "got: {output}"
    );
    assert!(result["pty"]["session_name"].is_null());
}

#[test]
fn model_controlled_local_commands_and_terminals_do_not_inherit_exa_api_key() {
    let result = run_native_credential_process_helper();
    assert_eq!(result["one_shot"]["stdout_preview"], "unset");
    let output = result["pty"]["content_preview"].as_str().unwrap();
    assert!(output.contains("unset"), "got: {output}");
    assert!(!output.contains("exa-command-environment-canary"));
}

#[cfg(unix)]
#[test]
fn git_http_auth_prompt_fails_fast_off_server_tty() {
    let (prompted, prompted_terminal) = run_git_prompt_case(true);
    assert!(
        prompted_terminal.contains("Username for"),
        "negative control did not prompt on the controlling terminal: {prompted_terminal}"
    );
    assert_eq!(prompted["status"], "timed_out");
    assert!(prompted["exit_code"].is_null());

    let (blocked, blocked_terminal) = run_git_prompt_case(false);
    assert!(
        !blocked_terminal.contains("Username for"),
        "prompt leaked to the controlling terminal: {blocked_terminal}"
    );
    let output = command_preview(&blocked);
    assert!(
        output.contains("terminal prompts disabled"),
        "Git did not report prompt suppression: {blocked}"
    );
    assert_eq!(blocked["status"], "completed");
    assert!(blocked["exit_code"].as_i64().is_some_and(|code| code != 0));
}

#[tokio::test]
async fn short_command_is_complete_without_followup() {
    let result = execute_exec_command(&json!({"cmd": "printf hello"}), &test_runtime()).await;
    assert!(!result.is_error, "{}", result.content);
    let value: Value =
        serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
    assert_eq!(value["status"], "completed");
    assert_eq!(value["stdout_preview"], "hello");
    assert_eq!(value["truncated"], false);
    assert!(value["output_id"].as_str().is_some());
}

#[tokio::test]
async fn short_pty_command_exits_without_leaving_a_general_shell() {
    let runtime = test_runtime();
    let result = execute_exec_command(
        &json!({"cmd": "printf exact-pty", "tty": true, "yield_time_ms": 2_000}),
        &runtime,
    )
    .await;
    assert!(!result.is_error, "{}", result.content);
    let value: Value =
        serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
    assert_eq!(value["content_preview"], "exact-pty");
    assert!(
        value["session_name"].is_null(),
        "the exact authorized process exited, so no unrestricted shell handle may remain: {value}"
    );
    assert_eq!(value["exit_code"], 0);
    assert!(runtime
        .terminal_manager
        .get("shell-unknown")
        .await
        .is_none());
}

#[tokio::test]
async fn pre_cancelled_pty_never_spawns_the_requested_process() {
    let mut runtime = test_runtime();
    let root = std::env::temp_dir().join(format!("nac-pre-cancelled-pty-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    runtime.workspace_cwd = root.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &root);
    runtime.command_cancellation.cancel();
    let marker = root.join("must-not-exist");
    let result = execute_exec_command(
        &json!({
            "cmd": "touch must-not-exist",
            "tty": true,
            "yield_time_ms": 100
        }),
        &runtime,
    )
    .await;
    assert!(result.is_error);
    assert!(
        !marker.exists(),
        "cancelled PTY command performed a side effect"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn pty_input_continues_only_the_exact_running_command() {
    let runtime = test_runtime();
    let started = execute_exec_command(
        &json!({
            "cmd": "IFS= read -r line; printf 'received:%s' \"$line\"",
            "tty": true,
            "yield_time_ms": 50
        }),
        &runtime,
    )
    .await;
    assert!(!started.is_error, "{}", started.content);
    let started: Value =
        serde_json::from_str(started.content.as_text().expect("text tool result")).unwrap();
    let session_id = started["session_name"]
        .as_str()
        .expect("the authorized command is still waiting for input");

    let completed = execute_write_stdin(
        &json!({"session_id": session_id, "chars": "hello<RET>", "yield_time_ms": 2_000}),
        &runtime,
    )
    .await;
    assert!(!completed.is_error, "{}", completed.content);
    let completed: Value =
        serde_json::from_str(completed.content.as_text().expect("text tool result")).unwrap();
    assert!(
        completed["content_preview"]
            .as_str()
            .is_some_and(|output| output.contains("received:hello")),
        "got: {completed}"
    );
    assert!(completed["session_name"].is_null());
    assert_eq!(completed["exit_code"], 0);
}

#[tokio::test]
async fn nonzero_exit_is_completed_not_tool_error() {
    let result =
        execute_exec_command(&json!({"cmd": "printf fail >&2; exit 7"}), &test_runtime()).await;
    assert!(!result.is_error);
    let value: Value =
        serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
    assert_eq!(value["status"], "completed");
    assert_eq!(value["exit_code"], 7);
    assert_eq!(value["stderr_preview"], "fail");
}

#[tokio::test]
async fn retained_output_is_pageable() {
    let runtime = test_runtime();
    let result = execute_exec_command(
        &json!({"cmd": "python3 -c 'print(\"x\"*20000)'", "max_output_chars": 100}),
        &runtime,
    )
    .await;
    let value: Value =
        serde_json::from_str(result.content.as_text().expect("text tool result")).unwrap();
    assert_eq!(value["truncated"], true);
    let output_id = value["output_id"].as_str().unwrap();
    let page = execute_read_command_output(
        &json!({"output_id": output_id, "stream": "stdout", "offset": 10_000, "limit": 64}),
        &runtime,
    );
    assert!(!page.is_error, "{}", page.content);
    let page_value: Value =
        serde_json::from_str(page.content.as_text().expect("text tool result")).unwrap();
    assert_eq!(page_value["content"].as_str().unwrap().len(), 64);
}

#[tokio::test]
async fn managed_secrets_are_snapshotted_per_spawn_and_redacted_from_all_output_views() {
    let root = unique_temp_dir("managed_environment");
    let store = nac_managed::configuration::HostSecretStore::new(&root);
    let old_secret = "managed-old-canary-never-visible";
    let new_secret = "managed-new-canary-never-visible";
    store.put("DEMO_TOKEN", old_secret).unwrap();

    let mut runtime = test_runtime();
    runtime.command_environment = Some(Arc::new(
        nac_managed::configuration::ManagedCommandEnvironmentProvider::new(
            Some(store.clone()),
            None,
            None,
        ),
    ));

    let one_shot = execute_exec_command(
        &json!({
            "cmd": "case \"$DEMO_TOKEN\" in managed-old-*) printf 'matched-old|' ;; *) printf 'missing|' ;; esac; printf '%s' \"$DEMO_TOKEN\""
        }),
        &runtime,
    )
    .await;
    assert!(!one_shot.is_error, "{}", one_shot.content);
    let one_shot_text = one_shot.content.as_text().expect("text tool result");
    assert!(one_shot_text.contains("matched-old|[REDACTED]"));
    assert!(!one_shot_text.contains(old_secret));
    let one_shot_value: Value = serde_json::from_str(one_shot_text).unwrap();
    let one_shot_output_id = one_shot_value["output_id"].as_str().unwrap();

    let live = execute_exec_command(
        &json!({
            "cmd": "sleep 0.2; case \"$DEMO_TOKEN\" in managed-old-*) printf 'retained-old|' ;; *) printf 'changed|' ;; esac; printf '%s' \"$DEMO_TOKEN\"",
            "tty": true,
            "yield_time_ms": 10
        }),
        &runtime,
    )
    .await;
    assert!(!live.is_error, "{}", live.content);
    let live_value: Value =
        serde_json::from_str(live.content.as_text().expect("text tool result")).unwrap();
    let session_id = live_value["session_name"].as_str().unwrap();

    store.put("DEMO_TOKEN", new_secret).unwrap();

    let completed = execute_write_stdin(
        &json!({ "session_id": session_id, "yield_time_ms": 2_000 }),
        &runtime,
    )
    .await;
    assert!(!completed.is_error, "{}", completed.content);
    let completed_text = completed.content.as_text().expect("text tool result");
    assert!(completed_text.contains("retained-old|[REDACTED]"));
    assert!(!completed_text.contains(old_secret));
    assert!(!completed_text.contains(new_secret));

    let retained = execute_read_command_output(
        &json!({ "output_id": one_shot_output_id, "stream": "stdout" }),
        &runtime,
    );
    assert!(!retained.is_error, "{}", retained.content);
    let retained_text = retained.content.as_text().expect("text tool result");
    assert!(retained_text.contains("matched-old|[REDACTED]"));
    assert!(!retained_text.contains(old_secret));
    assert!(!retained_text.contains(new_secret));

    let rotated = execute_exec_command(
        &json!({
            "cmd": "case \"$DEMO_TOKEN\" in managed-new-*) printf 'matched-new|' ;; *) printf 'stale|' ;; esac; printf '%s' \"$DEMO_TOKEN\""
        }),
        &runtime,
    )
    .await;
    assert!(!rotated.is_error, "{}", rotated.content);
    let rotated_text = rotated.content.as_text().expect("text tool result");
    assert!(rotated_text.contains("matched-new|[REDACTED]"));
    assert!(!rotated_text.contains(old_secret));
    assert!(!rotated_text.contains(new_secret));

    store.delete("DEMO_TOKEN").unwrap();
    let absent = execute_exec_command(
        &json!({
            "cmd": "if [ -z \"${DEMO_TOKEN+x}\" ]; then printf absent; else printf present; fi"
        }),
        &runtime,
    )
    .await;
    assert!(!absent.is_error, "{}", absent.content);
    assert!(absent.content.contains("absent"));

    runtime.terminal_manager.remove_all().await.unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_github_token_and_home_are_command_scoped_and_only_the_token_is_redacted() {
    let root = unique_temp_dir("managed_github_environment");
    let state_root = root.join("state");
    let home_root = root.join("home");
    std::fs::create_dir_all(&state_root).unwrap();
    std::fs::create_dir_all(&home_root).unwrap();
    let auth = nac_managed::github::ManagedGitHubAuth::new(&state_root, "Iv1.test").unwrap();
    let token = "github-access-canary-never-visible";
    auth.store_test_authorization(token, "refresh-canary", u64::MAX)
        .unwrap();
    let inherited = std::env::var_os("GH_TOKEN");

    let mut runtime = test_runtime();
    runtime.command_environment = Some(Arc::new(
        nac_managed::configuration::ManagedCommandEnvironmentProvider::new(
            None,
            Some(auth),
            Some(home_root.clone()),
        ),
    ));
    let result = execute_exec_command(
        &json!({
            "cmd": "case \"$GH_TOKEN\" in github-access-*) printf 'matched|' ;; *) printf 'missing|' ;; esac; printf '%s|%s' \"$GH_TOKEN\" \"$HOME\""
        }),
        &runtime,
    )
    .await;
    assert!(!result.is_error, "{}", result.content);
    let rendered = result.content.as_text().expect("text tool result");
    assert!(rendered.contains("matched|[REDACTED]|"));
    assert!(rendered.contains(&home_root.display().to_string()));
    assert!(!rendered.contains(token));
    assert_eq!(std::env::var_os("GH_TOKEN"), inherited);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn write_stdin_explicitly_transitions_a_live_terminal_to_retained() {
    let runtime = test_runtime();
    let started = execute_exec_command(
        &json!({"cmd": "sleep 5", "tty": true, "yield_time_ms": 10}),
        &runtime,
    )
    .await;
    let started: Value =
        serde_json::from_str(started.content.as_text().expect("text tool result")).unwrap();
    assert_eq!(started["retained"], false);
    let session_id = started["session_name"].as_str().unwrap();
    let retained = execute_write_stdin(
        &json!({"session_id": session_id, "retain": true, "yield_time_ms": 10}),
        &runtime,
    )
    .await;
    assert!(!retained.is_error, "{}", retained.content);
    let retained: Value =
        serde_json::from_str(retained.content.as_text().expect("text tool result")).unwrap();
    assert_eq!(retained["retained"], true);
    runtime.terminal_manager.remove_all().await.unwrap();
}

#[test]
fn invalid_stream_is_a_tool_error() {
    let result = execute_read_command_output(
        &json!({"output_id": "missing", "stream": "wat"}),
        &test_runtime(),
    );
    assert!(result.is_error);
    assert!(result.content.contains("invalid stream"));
}
