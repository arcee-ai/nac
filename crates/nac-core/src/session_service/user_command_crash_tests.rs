//! Kill a real command owner at admission, spawn, and atomic result/transcript seams.
use super::tests::{direct_service, records, request, Fixture, COUNTED, SESSION};
use super::*;
use std::process::{Child, Command, Stdio};

const STORE_ENV: &str = "NAC_TEST_ALL140_CRASH_STORE";
const PHASE_ENV: &str = "NAC_TEST_ALL140_CRASH_PHASE";
const CHILD_TEST: &str = "session_service::user_command::crash_tests::user_command_crash_child";

pub(super) fn pause_at_command_phase(path: &Path, phase: &str) {
    if std::env::var(PHASE_ENV).as_deref() == Ok(phase) {
        std::fs::write(path.with_extension("reached"), phase).unwrap();
        loop {
            std::thread::park();
        }
    }
}

#[test]
fn user_command_crash_child() {
    let Some(path) = std::env::var_os(STORE_ENV) else {
        return;
    };
    let path = PathBuf::from(path);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let workspace = path.with_file_name("workspace");
        let service =
            direct_service(&path, &workspace, ModelClient::new_for_test(), Vec::new()).service;
        let lease = sessions::SessionOperationLease::try_acquire(&path, SESSION).unwrap();
        service
            .submit_user_command_with_lease(request("crashed", COUNTED, None), lease)
            .unwrap();
        std::future::pending::<()>().await;
    });
}

struct CrashChild(Child);
impl Drop for CrashChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[cfg(unix)]
#[tokio::test]
async fn killed_command_owner_never_repeats_effects_across_spawn_and_commit_windows() {
    for (phase, effects, expected) in [
        ("admitted", 0, UserCommandState::Interrupted),
        ("executing", 0, UserCommandState::OutcomeUnknown),
        ("before_commit", 1, UserCommandState::OutcomeUnknown),
        ("after_commit", 1, UserCommandState::Completed),
    ] {
        let fixture = Fixture::new(phase, ModelClient::new_for_test(), Vec::new());
        let log = std::fs::File::create(fixture.store_path.with_extension("child.log")).unwrap();
        let mut child = CrashChild(
            Command::new(std::env::current_exe().unwrap())
                .args(["--exact", CHILD_TEST, "--nocapture", "--test-threads=1"])
                .env(STORE_ENV, &fixture.store_path)
                .env(PHASE_ENV, phase)
                .stdout(Stdio::from(log.try_clone().unwrap()))
                .stderr(Stdio::from(log))
                .spawn()
                .unwrap(),
        );
        let deadline = Instant::now() + Duration::from_secs(20);
        while !fixture.store_path.with_extension("reached").is_file() {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "child exited before {phase}"
            );
            assert!(Instant::now() < deadline, "child did not reach {phase}");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        child.0.kill().unwrap();
        assert!(!child.0.wait().unwrap().success());
        let reopened = fixture.reopen();
        let lease = fixture.lease();
        reopened
            .reconcile_durable_run_recovery(&lease)
            .await
            .unwrap();
        reopened
            .reconcile_durable_run_recovery(&lease)
            .await
            .unwrap();
        drop(lease);
        let recovered = reopened.user_command("crashed").await.unwrap().unwrap();
        assert_eq!(recovered.state, expected, "{phase}: {recovered:?}");
        assert_eq!(fixture.executions(), effects, "{phase}");
        assert_eq!(records(&reopened).await.len(), 1, "{phase}");
        let replay = reopened
            .submit_user_command_with_lease(request("crashed", COUNTED, None), fixture.lease())
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.command, recovered);
        assert_eq!(
            fixture.executions(),
            effects,
            "replay repeated effects at {phase}"
        );
        assert!(!reopened.has_active_operation());
    }
}
