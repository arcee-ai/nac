//! Environment mutation is confined to one exact, owned fixture process.
use super::*;
use std::{ffi::OsString, sync::mpsc};

const CAPTURE_ROOT: &str = "NAC_TEST_ATTACHMENT_CAPTURE_ROOT";
const PROBE_ROOT: &str = "NAC_TEST_ATTACHMENT_CAPTURE_PROBE_ROOT";
const CAPTURE_CHILD: &str =
    "tests::fresh_interval_tasks::recovery::attachment::command_tests::capture_child";
const PROBE_CHILD: &str =
    "tests::fresh_interval_tasks::recovery::attachment::command_tests::source_probe_child";

struct RemoveRoot(PathBuf);

impl Drop for RemoveRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct RestorePath(Option<OsString>);

impl Drop for RestorePath {
    fn drop(&mut self) {
        // Only the isolated capture child mutates PATH, under the fixture lock.
        unsafe {
            match self.0.take() {
                Some(value) => std::env::set_var("PATH", value),
                None => std::env::remove_var("PATH"),
            }
        }
    }
}

#[tokio::test]
async fn attachment_command_captures_stable_environment_before_owned_source_checks() {
    let root = RemoveRoot(std::fs::canonicalize(temp_root("attachment_capture")).unwrap());
    let mut child = OwnedChild(
        command(&root.0, CAPTURE_CHILD, "capture.log")
            .env(CAPTURE_ROOT, &root.0)
            .spawn()
            .unwrap(),
    );
    let status = wait(&mut child, 25).await;
    let log = std::fs::read_to_string(root.0.join("capture.log")).unwrap();
    assert!(
        status.success(),
        "isolated capture child failed: {status}\n{log}"
    );
}

#[tokio::test]
async fn capture_child() {
    let Some(root) = std::env::var_os(CAPTURE_ROOT) else {
        return;
    };
    let root = PathBuf::from(root);
    let stable_path = std::env::var_os("PATH").expect("fixture Git requires PATH");
    let git_executable = std::env::split_paths(&stable_path)
        .map(|directory| directory.join("git"))
        .find(|candidate| candidate.is_file())
        .unwrap()
        .canonicalize()
        .unwrap();
    let repo = root.join("repo");
    std::fs::create_dir_all(repo.join("nested")).unwrap();
    git(&repo, &["init", "-q"]);
    git(&repo, &["config", "user.name", "NAC fixture"]);
    git(&repo, &["config", "user.email", "fixture@example.invalid"]);
    std::fs::write(repo.join("nested/file"), "committed").unwrap();
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-qm", "fixture"]);
    std::fs::write(repo.join("nested/file"), "staged").unwrap();
    git(&repo, &["add", "."]);
    std::fs::write(repo.join("nested/file"), "dirty").unwrap();
    std::fs::write(repo.join("nested/untracked"), "untracked").unwrap();
    let before = source(&root);
    std::fs::write(
        root.join("expected.json"),
        serde_json::to_vec(&before).unwrap(),
    )
    .unwrap();

    let bin = root.join("temporary-git-bin");
    std::fs::create_dir(&bin).unwrap();
    std::os::unix::fs::symlink(git_executable, bin.join("git")).unwrap();
    let (reader, mut stale) = {
        let lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let restore = RestorePath(Some(stable_path.clone()));
        unsafe { std::env::set_var("PATH", &bin) };
        // Negative control: freeze the same transient PATH without the reader lock.
        let mut stale = Command::new("git");
        stale
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap());
        stale.arg("-C").arg(&repo).args(["rev-parse", "HEAD"]);
        assert_eq!(source(&root), before, "temporary Git works before removal");

        let (restored, release_capture) = mpsc::channel();
        let reader_root = root.clone();
        let reader = std::thread::spawn(move || {
            command_with_environment(&reader_root, PROBE_CHILD, "probe.log", |name| {
                if name == "PATH" {
                    release_capture
                        .recv_timeout(Duration::from_secs(5))
                        .unwrap();
                    // Deterministic negative: removing or shortening the reader
                    // guard makes this succeed after the writer has released it.
                    assert!(matches!(
                        SERVER_MODEL_ENV_LOCK.try_lock(),
                        Err(std::sync::TryLockError::WouldBlock)
                    ));
                }
                std::env::var_os(name)
            })
        });
        drop(restore);
        std::fs::remove_dir_all(&bin).unwrap();
        drop(lock);
        restored.send(()).unwrap();
        (reader, stale)
    };
    let mut probe = reader.join().unwrap();
    assert_eq!(
        stale.output().unwrap_err().kind(),
        std::io::ErrorKind::NotFound,
        "the unprotected frozen PATH must lose its executable"
    );
    let captured_path = probe
        .get_envs()
        .find(|(name, _)| *name == "PATH")
        .unwrap()
        .1;
    assert_eq!(captured_path, Some(stable_path.as_os_str()));
    assert!(
        SERVER_MODEL_ENV_LOCK.try_lock().is_ok(),
        "capture released the lock before spawn"
    );
    let mut child = OwnedChild(probe.env(PROBE_ROOT, &root).spawn().unwrap());
    // Keep probe ownership here and reap it on assertion/timeout as well.
    let status = wait(&mut child, 5).await;
    let log = std::fs::read_to_string(root.join("probe.log")).unwrap();
    assert!(status.success(), "source probe failed: {status}\n{log}");
    assert_eq!(source(&root), before);
}

#[test]
fn source_probe_child() {
    let Some(root) = std::env::var_os(PROBE_ROOT) else {
        return;
    };
    let root = PathBuf::from(root);
    assert!(std::env::var_os("OPENAI_API_KEY").is_none());
    assert!(std::env::var_os(CAPTURE_ROOT).is_none());
    let expected: (String, Vec<u8>, String, Vec<u8>, Vec<u8>) =
        serde_json::from_slice(&std::fs::read(root.join("expected.json")).unwrap()).unwrap();
    assert_eq!(source(&root), expected);
}
