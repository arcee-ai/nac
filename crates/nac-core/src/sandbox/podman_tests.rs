use super::*;
use crate::sandbox::DEFAULT_SANDBOX_WORKDIR;
use std::path::PathBuf;

fn sample_session() -> PodmanSession {
    PodmanSession::new(
        SandboxSpec {
            mounts: vec![MountSpec {
                host: PathBuf::from("/tmp/project"),
                guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                read_only: false,
            }],
            shm_size: Some("0".to_string()),
            ..Default::default()
        },
        "abc123".to_string(),
        false,
        "abc123".to_string(),
    )
}

#[test]
fn image_exists_exit_codes_are_classified() {
    assert!(matches!(
        classify_image_exists(Some(0), b""),
        ImageCheck::Present
    ));
    assert!(matches!(
        classify_image_exists(Some(1), b""),
        ImageCheck::Missing
    ));
    // Engine-down style failure (podman exits 125) surfaces its stderr.
    match classify_image_exists(Some(125), b"Error: unable to connect to Podman socket\n") {
        ImageCheck::Failed(detail) => {
            assert!(detail.contains("unable to connect to Podman socket"));
        }
        _ => panic!("exit 125 must be a check failure, not a missing image"),
    }
    // Signal termination (no exit code) is also a failure, and empty
    // stderr still yields a usable message.
    match classify_image_exists(None, b"") {
        ImageCheck::Failed(detail) => assert_eq!(detail, "no details reported"),
        _ => panic!("signal termination must be a check failure"),
    }
}

#[cfg(unix)]
#[tokio::test]
async fn observer_does_not_recreate_a_missing_parent_container() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-podman-observer-missing-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let podman = root.join("podman");
    let arguments = root.join("arguments");
    std::fs::write(
        &podman,
        r#"#!/bin/sh
printf '%s\n' "$*" >> "$NAC_TEST_PODMAN_ARGUMENTS"
if [ "$1" = container ] && [ "$2" = exists ]; then
  exit 1
fi
exit 99
"#,
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_program = std::env::var_os("NAC_TEST_PODMAN_PROGRAM");
    let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
    unsafe {
        std::env::set_var("NAC_TEST_PODMAN_PROGRAM", &podman);
        std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
    }
    let session = PodmanSession::new(
        SandboxSpec::default(),
        "parent-session".to_string(),
        false,
        "observer".to_string(),
    );
    let error = session.ensure_ready().await.unwrap_err();
    unsafe {
        match original_program {
            Some(program) => std::env::set_var("NAC_TEST_PODMAN_PROGRAM", program),
            None => std::env::remove_var("NAC_TEST_PODMAN_PROGRAM"),
        }
        match original_arguments {
            Some(path) => std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", path),
            None => std::env::remove_var("NAC_TEST_PODMAN_ARGUMENTS"),
        }
    }
    assert!(error
        .to_string()
        .contains("start the parent nac process first"));
    assert_eq!(
        std::fs::read_to_string(&arguments).unwrap(),
        "container exists nac-parent-session\n"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn durable_resume_recreates_a_missing_container_without_drop_cleanup() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-podman-durable-resume-missing-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let podman = root.join("podman");
    let arguments = root.join("arguments");
    std::fs::write(
        &podman,
        r#"#!/bin/sh
printf '%s\n' "$*" >> "$NAC_TEST_PODMAN_ARGUMENTS"
if [ "$1" = container ] && [ "$2" = exists ]; then
  exit 1
fi
if [ "$1" = image ] && [ "$2" = exists ]; then
  exit 0
fi
if [ "$1" = run ]; then
  while [ "$#" -gt 0 ]; do
if [ "$1" = --cidfile ]; then
  printf '%064d\n' 0 > "$2"
  exit 0
fi
shift
  done
fi
exit 99
"#,
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_program = std::env::var_os("NAC_TEST_PODMAN_PROGRAM");
    let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
    unsafe {
        std::env::set_var("NAC_TEST_PODMAN_PROGRAM", &podman);
        std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
    }
    let session = PodmanSession::new_for_durable_resume(
        SandboxSpec::default(),
        "durable-session".to_string(),
        "resume".to_string(),
    );
    session.ensure_ready().await.unwrap();
    drop(session);
    unsafe {
        match original_program {
            Some(program) => std::env::set_var("NAC_TEST_PODMAN_PROGRAM", program),
            None => std::env::remove_var("NAC_TEST_PODMAN_PROGRAM"),
        }
        match original_arguments {
            Some(path) => std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", path),
            None => std::env::remove_var("NAC_TEST_PODMAN_ARGUMENTS"),
        }
    }
    let arguments = std::fs::read_to_string(&arguments).unwrap();
    assert!(arguments.contains("container exists nac-durable-session\n"));
    assert!(arguments.contains("image exists python:3.13-bookworm\n"));
    assert!(arguments.contains("run "));
    assert!(!arguments.contains("rm --ignore -f nac-durable-session"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn pull_error_detail_prefers_the_error_line_over_progress() {
    // Pull progress precedes the real failure on stderr; the first line
    // is a status, not the reason.
    let stderr = b"Trying to pull registry.example.com/img:latest...\nCopying blob sha256:abc\nError: initializing source: unauthorized\n";
    assert_eq!(
        pull_error_detail(stderr),
        "Error: initializing source: unauthorized"
    );
    // Without an `Error:` line, the last non-empty line is the reason.
    let stderr = b"Trying to pull registry.example.com/img:latest...\nmanifest unknown\n";
    assert_eq!(pull_error_detail(stderr), "manifest unknown");
    // Empty stderr still yields a usable message.
    assert_eq!(pull_error_detail(b""), "no details reported");
    assert_eq!(pull_error_detail(b"\n  \n"), "no details reported");
}

#[test]
fn worker_cli_args_are_explicit() {
    let args = sample_session().worker_cli_args();
    let rendered: Vec<String> = args
        .into_iter()
        .map(|value| value.to_string_lossy().to_string())
        .collect();
    assert!(rendered.contains(&"--sandbox".to_string()));
    assert!(rendered.contains(&"--no-mount-cwd".to_string()));
    assert!(rendered.contains(&"--sandbox-session-key".to_string()));
    assert!(rendered.contains(&"--sandbox-mount".to_string()));
    assert!(rendered.contains(&"/tmp/project".to_string()));
    assert!(rendered.contains(&"/workspace".to_string()));
    assert!(!rendered.contains(&"/tmp/project:/workspace".to_string()));
    assert!(rendered.contains(&"--sandbox-shm-size".to_string()));
    assert!(rendered.contains(&"0".to_string()));
}

#[test]
fn create_container_args_include_mounts_and_command() {
    let args = sample_session().create_container_args().unwrap();
    let rendered: Vec<String> = args
        .into_iter()
        .map(|value| value.to_string_lossy().to_string())
        .collect();
    assert!(rendered.starts_with(&["run".to_string(), "-d".to_string(), "--rm".to_string(),]));
    assert!(rendered.contains(&"--mount".to_string()));
    assert!(rendered.contains(&"type=bind,src=/tmp/project,dst=/workspace".to_string()));
    assert!(rendered.contains(&"--shm-size".to_string()));
    assert!(rendered.contains(&"0".to_string()));
    assert_eq!(
        rendered.contains(&"--userns".to_string()),
        should_keep_id_userns()
    );
    assert_eq!(
        rendered.contains(&"keep-id".to_string()),
        should_keep_id_userns()
    );
    assert!(rendered
        .iter()
        .any(|value| value.contains("sleep infinity")));
}

#[test]
fn create_container_args_preserve_colons_in_typed_mount_paths() {
    let mut session = sample_session();
    session.spec.mounts[0].host = PathBuf::from("/tmp/nac:home/worktree");
    let rendered: Vec<String> = session
        .create_container_args()
        .unwrap()
        .into_iter()
        .map(|value| value.to_string_lossy().to_string())
        .collect();
    assert!(rendered.contains(&"type=bind,src=/tmp/nac:home/worktree,dst=/workspace".to_string()));
    let worker_args = session.worker_cli_args();
    assert!(worker_args.windows(3).any(|args| {
        args == [
            OsString::from("--sandbox-mount"),
            OsString::from("/tmp/nac:home/worktree"),
            OsString::from("/workspace"),
        ]
    }));
}

#[cfg(unix)]
#[test]
fn worker_cli_args_preserve_non_utf_mount_paths() {
    use std::os::unix::ffi::OsStringExt;

    let host = PathBuf::from(OsString::from_vec(b"/tmp/nac-\xff-worktree".to_vec()));
    let mut session = sample_session();
    session.spec.mounts[0].host = host.clone();

    let args = session.worker_cli_args();
    assert!(args.windows(3).any(|args| {
        args[0] == OsString::from("--sandbox-mount")
            && args[1] == host.as_os_str()
            && args[2] == OsString::from("/workspace")
    }));
}

#[test]
fn create_container_args_skip_user_without_rw_mounts() {
    let session = PodmanSession::new(
        SandboxSpec {
            shm_size: Some("0".to_string()),
            ..Default::default()
        },
        "empty".to_string(),
        false,
        "empty".to_string(),
    );
    let rendered: Vec<String> = session
        .create_container_args()
        .unwrap()
        .into_iter()
        .map(|value| value.to_string_lossy().to_string())
        .collect();
    assert!(!rendered.contains(&"--userns".to_string()));
}

#[test]
fn create_container_args_include_gpu_devices() {
    let session = PodmanSession::new(
        SandboxSpec {
            gpu_devices: vec![
                "nvidia.com/gpu=all".to_string(),
                "nvidia.com/gpu=mig1:0".to_string(),
            ],
            shm_size: Some("8g".to_string()),
            ..Default::default()
        },
        "gpu".to_string(),
        false,
        "gpu".to_string(),
    );
    let rendered: Vec<String> = session
        .create_container_args()
        .unwrap()
        .into_iter()
        .map(|value| value.to_string_lossy().to_string())
        .collect();
    assert!(rendered.contains(&"--device".to_string()));
    assert!(rendered.contains(&"nvidia.com/gpu=all".to_string()));
    assert!(rendered.contains(&"nvidia.com/gpu=mig1:0".to_string()));
    assert!(rendered.contains(&"--shm-size".to_string()));
    assert!(rendered.contains(&"8g".to_string()));
    assert_eq!(
        rendered.contains(&"label=disable".to_string()),
        should_enable_gpu_access_options()
    );
    assert_eq!(
        rendered.contains(&"keep-groups".to_string()),
        should_enable_gpu_access_options()
    );
}

#[test]
fn exec_args_enable_interactive_mode_when_stdin_is_present() {
    let args = sample_session().exec_args(
        "python3",
        &["-c".to_string(), "print('hi')".to_string()],
        true,
        false,
        None,
        &[],
    );
    let rendered: Vec<String> = args
        .into_iter()
        .map(|value| value.to_string_lossy().to_string())
        .collect();
    assert_eq!(rendered.first().map(String::as_str), Some("exec"));
    assert!(rendered.contains(&"-i".to_string()));
    assert!(!rendered.contains(&"-t".to_string()));
}

#[test]
fn exec_args_skip_interactive_mode_without_stdin() {
    let args = sample_session().exec_args(
        "bash",
        &["-lc".to_string(), "pwd".to_string()],
        false,
        false,
        None,
        &[],
    );
    let rendered: Vec<String> = args
        .into_iter()
        .map(|value| value.to_string_lossy().to_string())
        .collect();
    assert!(!rendered.contains(&"-i".to_string()));
    assert!(!rendered.contains(&"-t".to_string()));
}

#[test]
fn exec_args_includes_it_flags_when_interactive_and_tty() {
    let args = sample_session().exec_args("bash", &[], true, true, None, &[]);
    let rendered: Vec<String> = args
        .into_iter()
        .map(|value| value.to_string_lossy().to_string())
        .collect();
    assert!(rendered.contains(&"-i".to_string()));
    assert!(rendered.contains(&"-t".to_string()));
}

#[test]
fn terminal_pipe_command_includes_env_vars() {
    let session = sample_session();
    let (command, _pidfile) = session.terminal_pipe_command(
        "echo hello",
        None,
        &[
            ("TERM".to_string(), "dumb".to_string()),
            ("PAGER".to_string(), "cat".to_string()),
        ],
    );
    // Render the command as a debug string to inspect arguments
    let debug = format!("{command:?}");
    assert!(debug.contains("--env"), "expected --env flag: {debug}");
    assert!(debug.contains("TERM=dumb"), "expected TERM=dumb: {debug}");
    assert!(debug.contains("PAGER=cat"), "expected PAGER=cat: {debug}");
}

#[cfg(unix)]
#[tokio::test]
async fn crash_recovery_addresses_the_durable_session_container() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-podman-durable-cleanup-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let podman = root.join("podman");
    let arguments = root.join("arguments");
    std::fs::write(
        &podman,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$NAC_TEST_PODMAN_ARGUMENTS\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
    unsafe {
        std::env::set_var("PATH", &root);
        std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
    }
    destroy_owned_container("durable-session-id").await.unwrap();
    unsafe {
        match original_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
        match original_arguments {
            Some(path) => std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", path),
            None => std::env::remove_var("NAC_TEST_PODMAN_ARGUMENTS"),
        }
    }
    assert_eq!(
        std::fs::read_to_string(&arguments).unwrap(),
        "rm\n--ignore\n-f\nnac-durable-session-id\n"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn durable_session_drop_never_removes_its_container() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root =
        std::env::temp_dir().join(format!("nac-podman-observer-drop-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let podman = root.join("podman");
    let arguments = root.join("arguments");
    std::fs::write(
        &podman,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$NAC_TEST_PODMAN_ARGUMENTS\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
    unsafe {
        std::env::set_var("PATH", &root);
        std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
    }
    let session = PodmanSession::new(
        SandboxSpec::default(),
        "durable-session-id".to_string(),
        true,
        "owner".to_string(),
    );
    session.retain_for_durable_session();
    drop(session);
    std::thread::sleep(std::time::Duration::from_millis(50));
    unsafe {
        match original_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
        match original_arguments {
            Some(path) => std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", path),
            None => std::env::remove_var("NAC_TEST_PODMAN_ARGUMENTS"),
        }
    }
    assert!(!arguments.exists());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn explicit_lifecycle_cleanup_removes_an_observer_container() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-podman-observer-destroy-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let podman = root.join("podman");
    let arguments = root.join("arguments");
    std::fs::write(
        &podman,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$NAC_TEST_PODMAN_ARGUMENTS\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
    unsafe {
        std::env::set_var("PATH", &root);
        std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
    }
    let session = PodmanSession::new(
        SandboxSpec::default(),
        "durable-session-id".to_string(),
        false,
        "observer".to_string(),
    );
    session.destroy().await.unwrap();
    unsafe {
        match original_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
        match original_arguments {
            Some(path) => std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", path),
            None => std::env::remove_var("NAC_TEST_PODMAN_ARGUMENTS"),
        }
    }
    assert_eq!(
        std::fs::read_to_string(&arguments).unwrap(),
        "rm\n--ignore\n-f\nnac-durable-session-id\n"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn cancelled_creation_waits_for_run_before_removing_the_container() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-podman-cancelled-create-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let podman = root.join("podman");
    let started = root.join("started");
    let release = root.join("release");
    let container = root.join("container");
    let removed = root.join("removed");
    let ownership_token = root.join("ownership-token");
    std::fs::write(
        &podman,
        r#"#!/bin/sh
if [ "$1" = run ]; then
  shift
  cidfile=
  ownership_token=
  while [ "$#" -gt 0 ]; do
if [ "$1" = --cidfile ]; then
  cidfile=$2
  shift 2
elif [ "$1" = --label ]; then
  ownership_token=${2#*=}
  shift 2
else
  shift
fi
  done
  : > "$NAC_TEST_CREATE_STARTED"
  while [ ! -e "$NAC_TEST_CREATE_RELEASE" ]; do /bin/sleep 0.01; done
  : > "$NAC_TEST_CONTAINER"
  printf '%064d\n' 0 > "$cidfile"
  printf '%s\n' "$ownership_token" > "$NAC_TEST_OWNERSHIP_TOKEN"
  exit 0
fi
if [ "$1" = inspect ]; then
  /bin/cat "$NAC_TEST_OWNERSHIP_TOKEN"
  exit 0
fi
if [ "$1" = rm ]; then
  : > "$NAC_TEST_REMOVE_STARTED"
  /bin/rm -f "$NAC_TEST_CONTAINER"
  exit 0
fi
exit 0
"#,
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    unsafe {
        std::env::set_var("PATH", &root);
        std::env::set_var("NAC_TEST_CREATE_STARTED", &started);
        std::env::set_var("NAC_TEST_CREATE_RELEASE", &release);
        std::env::set_var("NAC_TEST_CONTAINER", &container);
        std::env::set_var("NAC_TEST_REMOVE_STARTED", &removed);
        std::env::set_var("NAC_TEST_OWNERSHIP_TOKEN", &ownership_token);
    }

    let session = std::sync::Arc::new(PodmanSession::new(
        SandboxSpec::default(),
        "cancelled-create".to_string(),
        false,
        "cancelled-create".to_string(),
    ));
    let launch = tokio::spawn({
        let session = std::sync::Arc::clone(&session);
        async move { session.create_container().await }
    });
    for _ in 0..200 {
        if started.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(started.exists(), "fake podman run did not start");
    launch.abort();
    let _ = launch.await;
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(
        !removed.exists(),
        "cleanup ran before the in-flight podman run settled"
    );

    std::fs::write(&release, b"").unwrap();
    for _ in 0..200 {
        if removed.exists() && !container.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(removed.exists(), "ordered cancellation cleanup did not run");
    assert!(!container.exists(), "cancelled creation left a container");

    unsafe {
        match original_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
        std::env::remove_var("NAC_TEST_CREATE_STARTED");
        std::env::remove_var("NAC_TEST_CREATE_RELEASE");
        std::env::remove_var("NAC_TEST_CONTAINER");
        std::env::remove_var("NAC_TEST_REMOVE_STARTED");
        std::env::remove_var("NAC_TEST_OWNERSHIP_TOKEN");
    }
    drop(session);
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn creation_rollback_validates_ownership_and_preserves_failed_cleanup_authority() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-podman-creation-rollback-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let podman = root.join("podman");
    let cidfile = root.join("container.cid");
    let arguments = root.join("rm-arguments");
    std::fs::write(
        &podman,
        r#"#!/bin/sh
if [ "$1" = inspect ]; then
  printf '%s\n' "$NAC_TEST_INSPECT_TOKEN"
  exit 0
fi
if [ "$1" = rm ]; then
  printf '%s\n' "$@" > "$NAC_TEST_RM_ARGUMENTS"
  exit "$NAC_TEST_RM_STATUS"
fi
exit 99
"#,
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let original_token = std::env::var_os("NAC_TEST_INSPECT_TOKEN");
    let original_status = std::env::var_os("NAC_TEST_RM_STATUS");
    let original_arguments = std::env::var_os("NAC_TEST_RM_ARGUMENTS");
    unsafe {
        std::env::set_var("PATH", &root);
        std::env::set_var("NAC_TEST_RM_ARGUMENTS", &arguments);
        std::env::set_var("NAC_TEST_RM_STATUS", "23");
    }
    std::fs::write(creation_token_path(&cidfile), "owned-token\n").unwrap();

    std::fs::write(&cidfile, "--all\n").unwrap();
    let error = destroy_created_container(&cidfile).await.unwrap_err();
    assert!(error.to_string().contains("full container ID"));
    assert!(cidfile.exists());
    assert!(!arguments.exists(), "invalid ID reached podman rm");

    let container_id = "a".repeat(64);
    std::fs::write(&cidfile, format!("{container_id}\n")).unwrap();
    unsafe { std::env::set_var("NAC_TEST_INSPECT_TOKEN", "peer-token") };
    let error = destroy_created_container(&cidfile).await.unwrap_err();
    assert!(error.to_string().contains("refusing removal"));
    assert!(cidfile.exists());
    assert!(!arguments.exists(), "peer-owned ID reached podman rm");

    unsafe { std::env::set_var("NAC_TEST_INSPECT_TOKEN", "owned-token") };
    let error = destroy_created_container(&cidfile).await.unwrap_err();
    assert!(error
        .to_string()
        .contains("cleanup authority was preserved"));
    assert!(cidfile.exists());
    assert_eq!(
        std::fs::read_to_string(&arguments).unwrap(),
        format!("rm\n--ignore\n-f\n--\n{container_id}\n")
    );

    unsafe { std::env::set_var("NAC_TEST_RM_STATUS", "0") };
    destroy_created_container(&cidfile).await.unwrap();
    assert!(!cidfile.exists());
    assert!(!creation_token_path(&cidfile).exists());

    unsafe {
        for (name, value) in [
            ("PATH", original_path),
            ("NAC_TEST_INSPECT_TOKEN", original_token),
            ("NAC_TEST_RM_STATUS", original_status),
            ("NAC_TEST_RM_ARGUMENTS", original_arguments),
        ] {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn durable_creation_record_spans_run_success_until_session_commit() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-podman-durable-creation-barrier-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("sessions.db");
    crate::store::initialize(&store_path).unwrap();
    let podman = root.join("podman");
    std::fs::write(
        &podman,
        r#"#!/bin/sh
if [ "$1" = run ]; then
  shift
  while [ "$#" -gt 0 ]; do
if [ "$1" = --cidfile ]; then
  printf '%064d\n' 0 > "$2"
  exit 0
fi
shift
  done
fi
exit 99
"#,
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_program = std::env::var_os("NAC_TEST_PODMAN_PROGRAM");
    unsafe { std::env::set_var("NAC_TEST_PODMAN_PROGRAM", &podman) };

    let session = PodmanSession::new_for_durable_launch(
        SandboxSpec::default(),
        uuid::Uuid::new_v4().to_string(),
        true,
        "durable-barrier".to_string(),
        store_path,
    );
    session.create_container().await.unwrap();
    let cidfile = session
        .creation_record
        .lock()
        .unwrap()
        .as_ref()
        .expect("successful durable creation must retain cleanup authority")
        .cidfile
        .clone();
    assert!(cidfile.exists());
    assert!(creation_token_path(&cidfile).exists());
    assert!(creation_session_path(&cidfile).exists());
    assert!(creation_store_path(&cidfile).exists());
    session.retain_for_durable_session();
    assert!(session.creation_record.lock().unwrap().is_none());
    assert!(!cidfile.exists());

    unsafe {
        match original_program {
            Some(program) => std::env::set_var("NAC_TEST_PODMAN_PROGRAM", program),
            None => std::env::remove_var("NAC_TEST_PODMAN_PROGRAM"),
        }
    }
    drop(session);
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn startup_reconciliation_skips_live_launches_preserves_rows_and_retries_cleanup() {
    use std::collections::BTreeMap;
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-podman-startup-reconcile-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let store_path = root.join("sessions.db");
    crate::store::initialize(&store_path).unwrap();
    let podman = root.join("podman");
    let arguments = root.join("rm-arguments");
    std::fs::write(
        &podman,
        r#"#!/bin/sh
if [ "$1" = inspect ]; then
  printf '%s\n' "$NAC_TEST_INSPECT_TOKEN"
  exit 0
fi
if [ "$1" = rm ]; then
  printf '%s\n' "$@" > "$NAC_TEST_RM_ARGUMENTS"
  exit "$NAC_TEST_RM_STATUS"
fi
exit 99
"#,
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let originals = [
        (
            "NAC_TEST_PODMAN_PROGRAM",
            std::env::var_os("NAC_TEST_PODMAN_PROGRAM"),
        ),
        (
            "NAC_TEST_INSPECT_TOKEN",
            std::env::var_os("NAC_TEST_INSPECT_TOKEN"),
        ),
        ("NAC_TEST_RM_STATUS", std::env::var_os("NAC_TEST_RM_STATUS")),
        (
            "NAC_TEST_RM_ARGUMENTS",
            std::env::var_os("NAC_TEST_RM_ARGUMENTS"),
        ),
    ];
    unsafe {
        std::env::set_var("NAC_TEST_PODMAN_PROGRAM", &podman);
        std::env::set_var("NAC_TEST_INSPECT_TOKEN", "owned-token");
        std::env::set_var("NAC_TEST_RM_STATUS", "23");
        std::env::set_var("NAC_TEST_RM_ARGUMENTS", &arguments);
    }
    let container_id = "a".repeat(64);

    // A killed parent can release its lock before the surviving `podman
    // run` child writes the cidfile. That uncertainty remains retryable.
    let settling_session = uuid::Uuid::new_v4().to_string();
    let settling =
        create_creation_record(&settling_session, Some(&store_path), "owned-token").unwrap();
    let settling_cidfile = settling.cidfile.clone();
    drop(settling);
    reconcile_creation_records(&store_path).await.unwrap();
    assert!(settling_cidfile.parent().unwrap().exists());
    assert!(!arguments.exists());
    std::fs::write(&settling_cidfile, format!("{container_id}\n")).unwrap();
    unsafe { std::env::set_var("NAC_TEST_RM_STATUS", "0") };
    reconcile_creation_records(&store_path).await.unwrap();
    assert!(!settling_cidfile.exists());
    std::fs::remove_file(&arguments).unwrap();
    unsafe { std::env::set_var("NAC_TEST_RM_STATUS", "23") };

    // A held exclusive lock proves that the creating process is still in
    // the pre-commit window, so startup must not inspect or remove it.
    let active_session = uuid::Uuid::new_v4().to_string();
    let active = create_creation_record(&active_session, Some(&store_path), "owned-token").unwrap();
    std::fs::write(&active.cidfile, format!("{container_id}\n")).unwrap();
    reconcile_creation_records(&store_path).await.unwrap();
    assert!(active.cidfile.exists());
    assert!(!arguments.exists());
    active.remove();

    // Simulated process loss releases the lock but leaves authority on
    // disk. Failed removal is retained and the next startup retries it.
    let abandoned_session = uuid::Uuid::new_v4().to_string();
    let abandoned =
        create_creation_record(&abandoned_session, Some(&store_path), "owned-token").unwrap();
    let abandoned_cidfile = abandoned.cidfile.clone();
    std::fs::write(&abandoned_cidfile, format!("{container_id}\n")).unwrap();
    drop(abandoned);
    reconcile_creation_records(&store_path).await.unwrap();
    assert!(abandoned_cidfile.exists());
    assert!(arguments.exists());
    unsafe { std::env::set_var("NAC_TEST_RM_STATUS", "0") };
    reconcile_creation_records(&store_path).await.unwrap();
    assert!(!abandoned_cidfile.exists());
    std::fs::remove_file(&arguments).unwrap();

    // If the row committed before process loss, durable lifecycle
    // ownership wins: startup drops only the transfer record.
    let committed_session = uuid::Uuid::new_v4().to_string();
    crate::sessions::create_session(
        &store_path,
        &crate::sessions::new_snapshot(
            committed_session.clone(),
            root.clone(),
            "test-model".to_string(),
            "https://example.invalid/v1".to_string(),
            crate::model::BackendKind::TogetherChat,
            None,
            None,
            None,
            Vec::new(),
            None,
            BTreeMap::new(),
        ),
    )
    .unwrap();
    let committed =
        create_creation_record(&committed_session, Some(&store_path), "owned-token").unwrap();
    let committed_cidfile = committed.cidfile.clone();
    std::fs::write(&committed_cidfile, format!("{container_id}\n")).unwrap();
    drop(committed);
    reconcile_creation_records(&store_path).await.unwrap();
    assert!(!committed_cidfile.exists());
    assert!(!arguments.exists());

    unsafe {
        for (name, value) in originals {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn cancelled_failed_creator_does_not_remove_peer_container() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-podman-cancelled-peer-create-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let podman = root.join("podman");
    let started = root.join("started");
    let release = root.join("release");
    let peer_container = root.join("peer-container");
    let removed = root.join("removed");
    std::fs::write(
        &podman,
        r#"#!/bin/sh
if [ "$1" = run ]; then
  : > "$NAC_TEST_CREATE_STARTED"
  while [ ! -e "$NAC_TEST_CREATE_RELEASE" ]; do /bin/sleep 0.01; done
  # Simulate losing the deterministic name to a peer. A failed run does not
  # write its --cidfile.
  exit 125
fi
if [ "$1" = rm ]; then
  : > "$NAC_TEST_REMOVE_STARTED"
  /bin/rm -f "$NAC_TEST_PEER_CONTAINER"
  exit 0
fi
exit 0
"#,
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    unsafe {
        std::env::set_var("PATH", &root);
        std::env::set_var("NAC_TEST_CREATE_STARTED", &started);
        std::env::set_var("NAC_TEST_CREATE_RELEASE", &release);
        std::env::set_var("NAC_TEST_PEER_CONTAINER", &peer_container);
        std::env::set_var("NAC_TEST_REMOVE_STARTED", &removed);
    }

    let session = std::sync::Arc::new(PodmanSession::new(
        SandboxSpec::default(),
        "cancelled-peer-create".to_string(),
        false,
        "cancelled-peer-create".to_string(),
    ));
    let launch = tokio::spawn({
        let session = std::sync::Arc::clone(&session);
        async move { session.create_container().await }
    });
    for _ in 0..200 {
        if started.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(started.exists(), "fake Podman run did not start");
    launch.abort();
    let _ = launch.await;

    std::fs::write(&peer_container, b"peer-owned").unwrap();
    std::fs::write(&release, b"").unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        !removed.exists(),
        "failed creator cleanup targeted a peer container without an owned ID"
    );
    assert!(peer_container.exists(), "peer container was removed");

    unsafe {
        match original_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
        std::env::remove_var("NAC_TEST_CREATE_STARTED");
        std::env::remove_var("NAC_TEST_CREATE_RELEASE");
        std::env::remove_var("NAC_TEST_PEER_CONTAINER");
        std::env::remove_var("NAC_TEST_REMOVE_STARTED");
    }
    drop(session);
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[tokio::test]
async fn terminal_pipe_kill_reports_nonzero_podman_status() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root =
        std::env::temp_dir().join(format!("nac-podman-kill-status-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let podman = root.join("podman");
    std::fs::write(&podman, "#!/bin/sh\nexit 23\n").unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    unsafe { std::env::set_var("PATH", &root) };
    let result = sample_session().terminal_pipe_kill("/tmp/unused.pid").await;
    unsafe {
        match original_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
    }
    let error = result.unwrap_err().to_string();
    assert!(
        error.contains("status"),
        "unexpected cleanup error: {error}"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn sandbox_pidfile_path_is_container_tmp_path_and_restart_unique() {
    let path = make_sandbox_pidfile();
    assert!(path.starts_with("/tmp/nac-exec-"));
    assert!(path.ends_with(".pid"));
    assert_ne!(path, make_sandbox_pidfile());
}

#[test]
fn sandbox_wrappers_track_and_kill_process_group() {
    assert!(SANDBOX_EXEC_WRAPPER.contains("setsid -w true"));
    assert!(SANDBOX_EXEC_WRAPPER.contains("exec setsid -w bash -c"));
    assert!(
        SANDBOX_EXEC_WRAPPER.contains("nac-supervisor"),
        "exec wrapper: {SANDBOX_EXEC_WRAPPER}"
    );
    assert!(SANDBOX_EXEC_WRAPPER.contains("group_members()"));
    assert!(SANDBOX_EXEC_WRAPPER.contains("/proc/$target/stat"));
    assert!(SANDBOX_EXEC_WRAPPER.contains("${20:-}"));
    assert!(SANDBOX_EXEC_WRAPPER.contains("ps -ww -o command="));
    assert!(SANDBOX_EXEC_WRAPPER.contains("cksum"));
    assert!(SANDBOX_EXEC_WRAPPER.contains("%s\\t%s\\n"));
    assert!(SANDBOX_EXEC_WRAPPER.contains("kill -KILL \"$child\""));
    assert_eq!(SANDBOX_PTY_WRAPPER, SANDBOX_EXEC_WRAPPER);
    assert!(SANDBOX_PTY_WRAPPER.contains("bash -c \"$requested\""));
    assert!(!SANDBOX_PTY_WRAPPER.contains("bash -i"));
    assert!(SANDBOX_KILL_WRAPPER.contains("descendants()"));
    assert!(SANDBOX_KILL_WRAPPER.contains("expected_identity"));
    assert!(SANDBOX_KILL_WRAPPER.contains("identity_state()"));
    assert!(SANDBOX_KILL_WRAPPER.contains("gone|mismatch"));
    assert!(SANDBOX_KILL_WRAPPER.contains("exit 1"));
    assert!(SANDBOX_KILL_WRAPPER.contains("/proc/$target/stat"));
    assert!(SANDBOX_KILL_WRAPPER.contains("ps -eo pid=,ppid="));
    assert!(SANDBOX_KILL_WRAPPER.contains("$2 == parent"));
    assert!(SANDBOX_KILL_WRAPPER.contains("verified_descendants"));
    assert!(SANDBOX_KILL_WRAPPER.contains("child_actual_identity"));
    assert!(SANDBOX_KILL_WRAPPER.contains("uncertain=1"));
    assert!(!SANDBOX_KILL_WRAPPER.contains("kill -TERM"));
    assert!(SANDBOX_KILL_WRAPPER.contains("kill -KILL \"$child\""));
    assert!(SANDBOX_KILL_WRAPPER.contains("kill -KILL \"-$pid\""));
}

#[cfg(unix)]
#[test]
fn portable_descendant_helper() {
    let Some(pid_path) = std::env::var_os("NAC_PORTABLE_DESCENDANT_PID_PATH") else {
        return;
    };
    let session = unsafe { libc::setsid() };
    assert!(session > 0, "failed to create escaped descendant session");
    std::fs::write(pid_path, unsafe { libc::getpid() }.to_string()).unwrap();
    std::thread::sleep(Duration::from_secs(30));
}

#[cfg(unix)]
fn portable_ps_identity(pid: u32) -> String {
    use std::io::Write as _;

    let started = std::process::Command::new("ps")
        .args(["-ww", "-o", "lstart=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    assert!(started.status.success());
    let started = String::from_utf8(started.stdout).unwrap();
    let started = started.trim();
    assert!(!started.is_empty());
    let command_line = std::process::Command::new("ps")
        .args(["-ww", "-o", "command=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    assert!(command_line.status.success());
    let mut cksum = std::process::Command::new("cksum")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let command_line = String::from_utf8(command_line.stdout).unwrap();
    let command_line = command_line.trim_end_matches(['\r', '\n']);
    cksum
        .stdin
        .as_mut()
        .unwrap()
        .write_all(command_line.as_bytes())
        .unwrap();
    let checksum = cksum.wait_with_output().unwrap();
    assert!(checksum.status.success());
    let checksum = String::from_utf8(checksum.stdout).unwrap();
    let checksum = checksum.split_whitespace().next().unwrap();
    format!("ps:{started}:{checksum}")
}

#[cfg(unix)]
#[test]
fn cancellation_wrapper_uses_ps_to_kill_session_escaped_descendants_without_proc() {
    use std::os::unix::process::CommandExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-wrapper-portable-descendants-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let descendant_pid_path = root.join("descendant.pid");
    let wrapper_pidfile = root.join("wrapper.pid");
    let executable = std::env::current_exe().unwrap();
    let executable = format!(
        "'{}'",
        executable.display().to_string().replace('\'', "'\"'\"'")
    );
    let command = format!(
        "{executable} --exact sandbox::podman::tests::portable_descendant_helper --nocapture & wait"
    );
    let mut supervisor = std::process::Command::new("bash");
    supervisor
        .env("NAC_PORTABLE_DESCENDANT_PID_PATH", &descendant_pid_path)
        .arg("-c")
        .arg(command)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .process_group(0);
    let mut supervisor = supervisor.spawn().unwrap();

    for _ in 0..200 {
        if descendant_pid_path.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(descendant_pid_path.exists(), "escaped helper did not start");
    let descendant_pid = std::fs::read_to_string(&descendant_pid_path)
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    let supervisor_pid = supervisor.id();
    std::fs::write(
        &wrapper_pidfile,
        format!(
            "{supervisor_pid}\t{}\n",
            portable_ps_identity(supervisor_pid)
        ),
    )
    .unwrap();

    // Make both identity and descendant discovery take their production
    // non-/proc branches while keeping the rest of the wrapper identical.
    let no_proc_wrapper = SANDBOX_KILL_WRAPPER.replace("/proc/", "/nac-no-proc/");
    let cleanup_started = std::time::Instant::now();
    let output = std::process::Command::new("bash")
        .arg("-c")
        .arg(no_proc_wrapper)
        .arg("nac-kill")
        .arg(&wrapper_pidfile)
        .output()
        .unwrap();
    assert!(
        cleanup_started.elapsed() < Duration::from_secs(5),
        "portable cleanup waited for the descendant to exit naturally"
    );
    assert!(
        output.status.success(),
        "kill wrapper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let _ = supervisor.wait();
    for _ in 0..100 {
        if unsafe { libc::kill(descendant_pid, 0) } != 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if unsafe { libc::kill(descendant_pid, 0) } == 0 {
        unsafe { libc::kill(descendant_pid, libc::SIGKILL) };
        panic!("session-escaped descendant survived portable cleanup");
    }
    assert!(!wrapper_pidfile.exists());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn portable_cleanup_keeps_child_authority_when_root_disappears_after_discovery() {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::process::CommandExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-wrapper-root-loss-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let descendant_pid_path = root.join("descendant.pid");
    let wrapper_pidfile = root.join("wrapper.pid");
    let ps_counter = root.join("root-identity-count");
    let fake_ps = root.join("ps");
    std::fs::write(
        &fake_ps,
        b"#!/bin/sh\nif [ \"$*\" = \"-ww -o stat= -p $NAC_TEST_ROOT_PID\" ]; then\n  printf 'S\\n'\n  exit 0\nfi\nif [ \"$*\" = \"-ww -o lstart= -p $NAC_TEST_ROOT_PID\" ]; then\n  count=$(cat \"$NAC_TEST_PS_COUNTER\" 2>/dev/null || printf 0)\n  count=$((count + 1))\n  printf '%s' \"$count\" > \"$NAC_TEST_PS_COUNTER\"\n  if [ \"$count\" -ge 2 ]; then\n    kill -KILL \"$NAC_TEST_ROOT_PID\" 2>/dev/null || true\n    exit 1\n  fi\nfi\nexec /bin/ps \"$@\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&fake_ps, std::fs::Permissions::from_mode(0o755)).unwrap();

    let executable = std::env::current_exe().unwrap();
    let executable = format!(
        "'{}'",
        executable.display().to_string().replace('\'', "'\"'\"'")
    );
    let command = format!(
        "{executable} --exact sandbox::podman::tests::portable_descendant_helper --nocapture & wait"
    );
    let mut supervisor = std::process::Command::new("bash");
    supervisor
        .env("NAC_PORTABLE_DESCENDANT_PID_PATH", &descendant_pid_path)
        .arg("-c")
        .arg(command)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .process_group(0);
    let mut supervisor = supervisor.spawn().unwrap();
    for _ in 0..200 {
        if descendant_pid_path.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(descendant_pid_path.exists(), "escaped helper did not start");
    let descendant_pid = std::fs::read_to_string(&descendant_pid_path)
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    let supervisor_pid = supervisor.id();
    std::fs::write(
        &wrapper_pidfile,
        format!(
            "{supervisor_pid}\t{}\n",
            portable_ps_identity(supervisor_pid)
        ),
    )
    .unwrap();

    let no_proc_wrapper = SANDBOX_KILL_WRAPPER.replace("/proc/", "/nac-no-proc/");
    let output = std::process::Command::new("bash")
        .env("PATH", format!("{}:/usr/bin:/bin", root.display()))
        .env("NAC_TEST_ROOT_PID", supervisor_pid.to_string())
        .env("NAC_TEST_PS_COUNTER", &ps_counter)
        .arg("-c")
        .arg(no_proc_wrapper)
        .arg("nac-kill")
        .arg(&wrapper_pidfile)
        .output()
        .unwrap();
    assert!(!output.status.success(), "root-loss uncertainty was hidden");
    let _ = supervisor.wait();
    for _ in 0..100 {
        if unsafe { libc::kill(descendant_pid, 0) } != 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if unsafe { libc::kill(descendant_pid, 0) } == 0 {
        unsafe { libc::kill(descendant_pid, libc::SIGKILL) };
        panic!("captured descendant survived supervisor identity loss");
    }
    assert!(
        wrapper_pidfile.exists(),
        "uncertainty discarded retry authority"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn cancellation_wrapper_does_not_kill_a_reused_pid_with_a_different_identity() {
    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root =
        std::env::temp_dir().join(format!("nac-wrapper-pid-identity-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let pidfile = root.join("wrapper.pid");
    let mut child = std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .unwrap();
    std::fs::write(&pidfile, format!("{}\tproc:not-this-process\n", child.id())).unwrap();

    let output = std::process::Command::new("bash")
        .arg("-c")
        .arg(SANDBOX_KILL_WRAPPER)
        .arg("nac-kill")
        .arg(&pidfile)
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "kill wrapper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        child.try_wait().unwrap().is_none(),
        "identity mismatch killed the process"
    );
    assert!(!pidfile.exists());
    child.kill().unwrap();
    child.wait().unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn portable_identity_rejects_same_start_time_with_a_different_command_signature() {
    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-wrapper-portable-identity-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let pidfile = root.join("wrapper.pid");
    let mut child = std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .unwrap();
    let actual = portable_ps_identity(child.id());
    let started = actual.rsplit_once(':').unwrap().0;
    std::fs::write(&pidfile, format!("{}\t{started}:0\n", child.id())).unwrap();

    let no_proc_wrapper = SANDBOX_KILL_WRAPPER.replace("/proc/", "/nac-no-proc/");
    let output = std::process::Command::new("bash")
        .arg("-c")
        .arg(no_proc_wrapper)
        .arg("nac-kill")
        .arg(&pidfile)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "kill wrapper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        child.try_wait().unwrap().is_none(),
        "same-second portable identity collision killed the unrelated process"
    );
    child.kill().unwrap();
    child.wait().unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn portable_identity_inspection_failure_retains_retry_authority() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-wrapper-portable-uncertain-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let pidfile = root.join("wrapper.pid");
    let fake_ps = root.join("ps");
    std::fs::write(
        &fake_ps,
        b"#!/bin/sh\ncase \"$*\" in\n  *stat=*) printf 'S\\n'; exit 0 ;;\n  *lstart=*) exit 1 ;;\n  *) exec /bin/ps \"$@\" ;;\nesac\n",
    )
    .unwrap();
    let mut permissions = std::fs::metadata(&fake_ps).unwrap().permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&fake_ps, permissions).unwrap();

    let mut child = std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .unwrap();
    std::fs::write(
        &pidfile,
        format!("{}\tps:recorded-start:12345\n", child.id()),
    )
    .unwrap();
    let no_proc_wrapper = SANDBOX_KILL_WRAPPER.replace("/proc/", "/nac-no-proc/");
    let path = format!("{}:/usr/bin:/bin", root.display());
    let output = std::process::Command::new("bash")
        .env("PATH", path)
        .arg("-c")
        .arg(no_proc_wrapper)
        .arg("nac-kill")
        .arg(&pidfile)
        .output()
        .unwrap();

    assert!(
        !output.status.success(),
        "uncertain cleanup reported success"
    );
    assert!(
        child.try_wait().unwrap().is_none(),
        "identity inspection failure killed the live process"
    );
    assert!(
        pidfile.exists(),
        "uncertain cleanup discarded retry authority"
    );
    child.kill().unwrap();
    child.wait().unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn total_portable_identity_inspection_failure_retains_retry_authority() {
    use std::os::unix::fs::PermissionsExt;

    let root = std::env::temp_dir().join(format!(
        "nac-wrapper-portable-total-uncertainty-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let pidfile = root.join("wrapper.pid");
    let fake_ps = root.join("ps");
    std::fs::write(&fake_ps, b"#!/bin/sh\nexit 1\n").unwrap();
    let mut permissions = std::fs::metadata(&fake_ps).unwrap().permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&fake_ps, permissions).unwrap();

    let mut child = std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .unwrap();
    std::fs::write(
        &pidfile,
        format!("{}\tps:recorded-start:12345\n", child.id()),
    )
    .unwrap();
    let no_proc_wrapper = SANDBOX_KILL_WRAPPER.replace("/proc/", "/nac-no-proc/");
    let path = format!("{}:/usr/bin:/bin", root.display());
    let output = std::process::Command::new("bash")
        .env("PATH", path)
        .arg("-c")
        .arg(no_proc_wrapper)
        .arg("nac-kill")
        .arg(&pidfile)
        .output()
        .unwrap();

    assert!(
        !output.status.success(),
        "total inspection uncertainty reported successful cleanup"
    );
    assert!(
        child.try_wait().unwrap().is_none(),
        "total inspection uncertainty killed the live process"
    );
    assert!(
        pidfile.exists(),
        "total inspection uncertainty discarded retry authority"
    );
    child.kill().unwrap();
    child.wait().unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn successful_wrapper_completion_kills_background_group_members() {
    use std::os::unix::process::ExitStatusExt;

    let root =
        std::env::temp_dir().join(format!("nac-wrapper-descendant-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let pid_path = root.join("pid");
    let wrapper_pidfile = root.join("wrapper.pid");
    let requested = format!(
        "sh -c 'trap \"\" HUP TERM; printf %s $$ > {}; exec sleep 30' </dev/null >/dev/null 2>&1 & while [ ! -s {} ]; do sleep 0.01; done",
        pid_path.display(),
        pid_path.display(),
    );
    let output = std::process::Command::new("bash")
        .arg("-c")
        .arg(SANDBOX_EXEC_WRAPPER)
        .arg("nac-exec")
        .arg(requested)
        .arg(&wrapper_pidfile)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "wrapper failed with signal {:?}: {}",
        output.status.signal(),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "wrapper added stderr noise: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let pid = std::fs::read_to_string(&pid_path)
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    for _ in 0..100 {
        if unsafe { libc::kill(pid, 0) } != 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "descendant survived");
    assert!(!wrapper_pidfile.exists());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn pty_wrapper_fallback_keeps_requested_stdio_and_status() {
    use std::io::Write;

    let root =
        std::env::temp_dir().join(format!("nac-wrapper-pty-fallback-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let wrapper_pidfile = root.join("wrapper.pid");
    let mut child = std::process::Command::new("bash")
        .env("PATH", "/usr/bin:/bin")
        .arg("-c")
        .arg(SANDBOX_PTY_WRAPPER)
        .arg("nac-pty")
        .arg("read value; printf 'exact-pty:%s' \"$value\"")
        .arg(&wrapper_pidfile)
        .arg("pty")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"input\n").unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stdout), "exact-pty:input");
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!wrapper_pidfile.exists());
    let _ = std::fs::remove_dir_all(root);
}
