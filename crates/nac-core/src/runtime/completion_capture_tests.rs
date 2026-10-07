//! Actual original completion/cancellation and owned Git filter processes.
use super::run_admission_tests::{build, count, ended, renew_original, response};
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::sessions::SessionBehavior;
use crate::types::Message;
use std::fs;
use std::path::Path;
use std::process::Command;

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().into()
}

pub(super) async fn snapshot(
    fixture: &Fixture,
    base_url: &str,
) -> crate::sessions::SessionSnapshot {
    let root = fixture.path.parent().unwrap().join("checkout");
    fs::create_dir(&root).unwrap();
    git(&root, &["init", "--initial-branch=main"]);
    git(&root, &["config", "user.name", "fixture"]);
    git(&root, &["config", "user.email", "fixture@localhost"]);
    fs::write(root.join("file.txt"), "before\n").unwrap();
    git(&root, &["add", "file.txt"]);
    git(&root, &["commit", "-m", "before"]);
    let mut snapshot = construction_snapshot();
    snapshot.cwd = root;
    snapshot.behavior = SessionBehavior::Direct;
    snapshot.base_url = base_url.into();
    snapshot.allow_insecure_http = true;
    snapshot.reasoning_effort = None;
    snapshot.messages = vec![Message::User {
        content: "retained input".into(),
    }];
    fixture
        .store
        .create_session(snapshot.clone())
        .await
        .unwrap();
    snapshot
}

fn install_filter(root: &Path, control: &Path, background: bool) {
    let script = control.join("filter.py");
    let escaped = format!("import os,time,pathlib; p=pathlib.Path({}); (p/'escaped-pid').write_text(str(os.getpid())); time.sleep(60)", serde_json::to_string(control).unwrap());
    fs::write(
        &script,
        format!(
            r#"import os,sys,time,pathlib,subprocess
p=pathlib.Path({control})
if {background}:
    subprocess.Popen([sys.executable,'-c',{escaped}], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    while not (p/'escaped-pid').exists(): time.sleep(.01)
# Give the supervised descendant census time to observe the escaped process.
time.sleep(.3)
(p/'filter-pid').write_text(str(os.getpid()))
(p/'entered').write_text('ready')
while not (p/'release').exists(): time.sleep(.01)
sys.stdout.buffer.write(sys.stdin.buffer.read())
"#,
            control = serde_json::to_string(control).unwrap(),
            background = if background { "True" } else { "False" },
            escaped = serde_json::to_string(&escaped).unwrap()
        ),
    )
    .unwrap();
    let clean = format!(
        "/usr/bin/python3 {}",
        crate::sandbox::ssh_command::shell_quote(script.to_str().unwrap())
    );
    git(root, &["config", "filter.capture.clean", &clean]);
    git(root, &["config", "filter.capture.required", "true"]);
    fs::write(root.join(".gitattributes"), "file.txt filter=capture\n").unwrap();
    fs::write(root.join("file.txt"), "after\n").unwrap();
}

async fn entered(control: &Path) {
    tokio::time::timeout(Duration::from_secs(6), async {
        while !control.join("entered").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("actual completion must reach Git filter");
}

async fn exited(control: &Path, name: &str) {
    let pid: i32 = fs::read_to_string(control.join(name))
        .unwrap()
        .parse()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if unsafe { libc::kill(pid, 0) } == -1 {
                assert_eq!(
                    std::io::Error::last_os_error().raw_os_error(),
                    Some(libc::ESRCH)
                );
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned filter/escaped descendant must exit");
}

async fn revisions(fixture: &Fixture, session: &str) -> Vec<crate::store::WorkspaceRevisionRecord> {
    let path = fixture.path.clone();
    let session = session.to_owned();
    crate::store::spawn_blocking_store_caller(move || {
        crate::store::list_workspace_revisions(&path, &session)
    })
    .await
    .unwrap()
    .unwrap()
}

#[tokio::test]
async fn runtime_completion_capture_renews_same_original_after_initial_expiry_and_reaps_escaped_child(
) {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    eprintln!("owned completion fixture: {}", fixture.path.display());
    let _home = ConstructionHome::new(&fixture);
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", response())]);
    let snapshot = snapshot(&fixture, &server.base_url).await;
    let guard = ManagedRuntimeLeaseGuard::new(
        fixture.store.clone(),
        fixture.active_with_original_lifetime(20_000, 5_000).await,
    )
    .await
    .unwrap();
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    let before_head = git(&snapshot.cwd, &["rev-parse", "HEAD"]);
    let before_index = fs::read(snapshot.cwd.join(".git/index")).unwrap();
    let control = fixture.path.parent().unwrap();
    install_filter(&snapshot.cwd, control, true);
    let run = parts
        .service
        .submit_runtime_original(original, "capture input".into())
        .await
        .unwrap();
    let native = parts
        .service
        .observe_runtime_original_run(&run.run_id, &guard)
        .unwrap();
    // Renew promptly: a challenge must itself fit under the current accepted
    // lease, including time spent reaching the real completion filter.
    assert_eq!(renew_original(&guard, &native, [61; 32]).await.sequence, 2);
    entered(control).await;
    let remaining =
        guard.binding().unwrap().original_expires_ms - native_clock().unwrap().wall_ms();
    if remaining > 0 {
        tokio::time::sleep(Duration::from_millis(remaining as u64 + 20)).await;
    }
    assert!(guard.check_initial_admission_now().is_err());
    assert!(guard.check_now().is_ok());
    assert_eq!(renew_original(&guard, &native, [62; 32]).await.sequence, 3);
    fs::write(control.join("release"), "continue").unwrap();
    tokio::time::timeout(Duration::from_secs(15), async {
        while parts.service.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned completion settlement");
    exited(control, "filter-pid").await;
    exited(control, "escaped-pid").await;
    let rows = revisions(&fixture, &snapshot.session_id).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].run_id, run.run_id.to_string());
    assert_eq!(rows[0].base_sha.as_deref(), Some(before_head.as_str()));
    assert_eq!(
        rows[0].transcript_len,
        Some(parts.service.messages_snapshot().await.unwrap().len() as u64)
    );
    assert!(rows[0].changed_files >= 2);
    assert_eq!(
        git(
            &snapshot.cwd,
            &["show", &format!("{}:file.txt", rows[0].commit_sha)]
        ),
        "after"
    );
    assert_eq!(git(&snapshot.cwd, &["rev-parse", "HEAD"]), before_head);
    assert_eq!(
        fs::read(snapshot.cwd.join(".git/index")).unwrap(),
        before_index
    );
    assert!(guard.check_now().is_err());
    assert_eq!(
        parts
            .service
            .recent_events(None, 64)
            .1
            .iter()
            .filter(|event| matches!(
                event.event,
                crate::events::SessionEvent::RunCompleted { .. }
                    | crate::events::SessionEvent::RunCancelled
                    | crate::events::SessionEvent::RunFailed { .. }
            ))
            .count(),
        1,
        "one actual protected terminal owner"
    );
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    assert_eq!(server.finish().len(), 1);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

async fn denied_capture(cancel: bool) {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    eprintln!("owned completion fixture: {}", fixture.path.display());
    let _home = ConstructionHome::new(&fixture);
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", response())]);
    let snapshot = snapshot(&fixture, &server.base_url).await;
    let guard = fixture.guard(if cancel { 20_000 } else { 5_000 }).await;
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    let target = crate::workspace::GitTarget::local(&snapshot.cwd);
    let old = crate::workspace::capture(&target, &snapshot.session_id, None).unwrap();
    let path = fixture.path.clone();
    let session = snapshot.session_id.clone();
    let old_row = crate::store::spawn_blocking_store_caller(move || {
        crate::store::append_workspace_revision(
            &path,
            &session,
            crate::store::NewWorkspaceRevision {
                run_id: Uuid::new_v4().to_string(),
                commit_sha: old.commit,
                base_sha: old.base,
                branch: old.branch,
                label: "prior real checkout".into(),
                additions: old.additions,
                deletions: old.deletions,
                changed_files: old.changed_files,
                transcript_len: Some(1),
            },
        )
    })
    .await
    .unwrap()
    .unwrap();
    let control = fixture.path.parent().unwrap();
    install_filter(&snapshot.cwd, control, true);
    let run = parts
        .service
        .submit_runtime_original(original, "capture input".into())
        .await
        .unwrap();
    entered(control).await;
    if cancel {
        tokio::time::timeout(
            Duration::from_secs(5),
            parts.service.request_cancel(&run.run_id),
        )
        .await
        .unwrap()
        .unwrap();
    } else {
        guard.wait_for_denial().await;
    }
    ended(&parts.service).await;
    exited(control, "filter-pid").await;
    exited(control, "escaped-pid").await;
    assert_eq!(
        revisions(&fixture, &snapshot.session_id).await,
        vec![old_row.clone()]
    );
    assert_eq!(
        git(
            &snapshot.cwd,
            &[
                "rev-parse",
                &format!("refs/nac/revisions/{}", snapshot.session_id)
            ]
        ),
        old_row.commit_sha
    );
    assert_eq!(
        fs::read_to_string(snapshot.cwd.join("file.txt")).unwrap(),
        "after\n"
    );
    assert!(!control.join("release").exists());
    assert!(guard.check_now().is_err());
    assert_eq!(
        parts
            .service
            .recent_events(None, 64)
            .1
            .iter()
            .filter(|event| matches!(
                event.event,
                crate::events::SessionEvent::RunCompleted { .. }
                    | crate::events::SessionEvent::RunCancelled
                    | crate::events::SessionEvent::RunFailed { .. }
            ))
            .count(),
        1,
        "one actual protected terminal owner"
    );
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    assert_eq!(server.finish().len(), 1);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_completion_capture_expiry_withholds_revision_and_retains_prior_history() {
    denied_capture(false).await;
}
#[tokio::test]
async fn runtime_completion_capture_cancellation_wins_without_waiting_for_capture_owner() {
    denied_capture(true).await;
}

#[tokio::test]
async fn runtime_completion_capture_denial_after_ref_publication_does_no_compensating_git() {
    use std::os::unix::fs::PermissionsExt;
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    eprintln!("owned completion fixture: {}", fixture.path.display());
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", response())]);
    let snapshot = snapshot(&fixture, &server.base_url).await;
    let guard = fixture.guard(20_000).await;
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    let control = fixture.path.parent().unwrap();
    let hooks = control.join("hooks");
    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("reference-transaction");
    fs::write(&hook, format!(r#"#!/bin/sh
[ "$1" = committed ] || exit 0
/usr/bin/python3 -c 'import os,time,pathlib; p=pathlib.Path({}); (p/"filter-pid").write_text(str(os.getpid())); (p/"entered").write_text("ready"); time.sleep(60)'
"#, serde_json::to_string(control).unwrap())).unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o700)).unwrap();
    git(
        &snapshot.cwd,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
    );
    fs::write(snapshot.cwd.join("file.txt"), "after\n").unwrap();
    let run = parts
        .service
        .submit_runtime_original(original, "capture input".into())
        .await
        .unwrap();
    entered(control).await;
    // A committed hook is after publication, while the selected owned command
    // has not returned. Denial withholds its result and never rolls the ref back.
    let ref_path = snapshot
        .cwd
        .join(".git/refs/nac/revisions")
        .join(&snapshot.session_id);
    let partial_ref = fs::read(&ref_path).unwrap();
    guard.deny_now();
    ended(&parts.service).await;
    exited(control, "filter-pid").await;
    assert_eq!(fs::read(&ref_path).unwrap(), partial_ref);
    assert!(parts
        .service
        .observe_runtime_original_run(&run.run_id, &guard)
        .is_err());
    assert!(revisions(&fixture, &snapshot.session_id).await.is_empty());
    assert_eq!(
        fs::read_to_string(snapshot.cwd.join("file.txt")).unwrap(),
        "after\n"
    );
    assert_eq!(
        parts
            .service
            .recent_events(None, 64)
            .1
            .iter()
            .filter(|event| matches!(
                event.event,
                crate::events::SessionEvent::RunCompleted { .. }
                    | crate::events::SessionEvent::RunCancelled
                    | crate::events::SessionEvent::RunFailed { .. }
            ))
            .count(),
        1,
        "one actual protected terminal owner"
    );
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    assert_eq!(server.finish().len(), 1);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_completion_capture_denied_before_model_return_starts_no_git() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    eprintln!("owned completion fixture: {}", fixture.path.display());
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let server = ScriptedServer::start_observed(
        vec![ScriptedResponse::json("200 OK", response())],
        move |_, _| {
            entered_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(6)).unwrap();
        },
    );
    let snapshot = snapshot(&fixture, &server.base_url).await;
    let guard = fixture.guard(20_000).await;
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    fs::write(snapshot.cwd.join("file.txt"), "after\n").unwrap();
    let run = parts
        .service
        .submit_runtime_original(original, "capture input".into())
        .await
        .unwrap();
    tokio::task::spawn_blocking(move || entered_rx.recv_timeout(Duration::from_secs(3)).unwrap())
        .await
        .unwrap();
    guard.deny_now();
    release_tx.send(()).unwrap();
    ended(&parts.service).await;
    assert!(!snapshot.cwd.join(".git/nac-revisions").exists());
    assert!(!snapshot.cwd.join(".git/refs/nac").exists());
    assert!(revisions(&fixture, &snapshot.session_id).await.is_empty());
    assert_eq!(
        fs::read_to_string(snapshot.cwd.join("file.txt")).unwrap(),
        "after\n"
    );
    assert!(parts
        .service
        .observe_runtime_original_run(&run.run_id, &guard)
        .is_err());
    assert_eq!(
        parts
            .service
            .recent_events(None, 64)
            .1
            .iter()
            .filter(|event| matches!(
                event.event,
                crate::events::SessionEvent::RunCompleted { .. }
                    | crate::events::SessionEvent::RunCancelled
                    | crate::events::SessionEvent::RunFailed { .. }
            ))
            .count(),
        1,
        "one actual protected terminal owner"
    );
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    assert_eq!(server.finish().len(), 1);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}
