use super::*;

fn test_png() -> Vec<u8> {
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;

    let source = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
    let mut encoded = Cursor::new(Vec::new());
    source.write_to(&mut encoded, ImageFormat::Png).unwrap();
    encoded.into_inner()
}

struct RestorePath(Option<std::ffi::OsString>);

impl Drop for RestorePath {
    fn drop(&mut self) {
        unsafe {
            match self.0.take() {
                Some(path) => std::env::set_var("PATH", path),
                None => std::env::remove_var("PATH"),
            }
        }
    }
}

#[cfg(unix)]
#[tokio::test]
async fn mounted_reads_preserve_validated_image_content() {
    let root = std::env::temp_dir().join(format!("nac-mounted-image-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("fixture.png"), test_png()).unwrap();

    let result = read_mounted(
        root.clone(),
        PathBuf::from("fixture.png"),
        "fixture.png".to_string(),
        0,
        10,
        true,
    )
    .await;
    assert!(!result.is_error, "{}", result.content);
    assert!(matches!(
        result.content.parts().unwrap(),
        [ToolContentPart::Image(image)] if image.mime_type().as_str() == "image/png"
    ));

    let rejected = read_mounted(
        root.clone(),
        PathBuf::from("fixture.png"),
        "fixture.png".to_string(),
        0,
        10,
        false,
    )
    .await;
    assert!(rejected.is_error);
    assert!(rejected.content.contains("unsupported_image"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn revision_hashes_complete_bytes() {
    assert_eq!(
        revision(b"\xef\xbb\xbfline\r\n"),
        "sha256:54a87ac536597128c9da6728f82567e5c08ed5f33c69366eec7136066cdab44b"
    );
}

#[test]
fn oversized_line_is_explicitly_truncated_without_quadratic_rebuilds() {
    let mut bytes = vec![b'a'; MAX_READ_OUTPUT_BYTES + 100];
    bytes.extend_from_slice(b"\nnext\n");
    let result = read_result("fixture.txt".into(), &bytes, 0, 20).unwrap();
    assert_eq!(result.content.len(), MAX_READ_OUTPUT_BYTES);
    assert!(result.truncated);
    assert_eq!(result.end_line, 1);
    assert_eq!(result.next_offset, Some(1));
}

#[cfg(unix)]
#[test]
fn metadata_preservation_does_not_require_recreating_a_foreign_owner() {
    let dir = std::env::temp_dir().join(format!("nac-metadata-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    let file = File::create(&path).unwrap();
    let foreign_metadata = fs::metadata("/dev/null").unwrap();

    preserve_metadata(&file, &foreign_metadata).unwrap();

    let published_metadata = file.metadata().unwrap();
    assert_eq!(
        published_metadata.mode() & 0o7777,
        foreign_metadata.mode() & 0o7777
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn batched_edits_match_one_original_and_preserve_crlf_bom() {
    let old = b"\xef\xbb\xbffirst = 1\r\nsecond = 1\r\n";
    let new = apply_edits(
        "fixture.txt",
        old,
        &[
            EditSpec {
                old_text: "first = 1".into(),
                new_text: "first = 2".into(),
            },
            EditSpec {
                old_text: "second = 1".into(),
                new_text: "second = 2\nthird = 3".into(),
            },
        ],
    )
    .unwrap();
    assert_eq!(new, b"\xef\xbb\xbffirst = 2\r\nsecond = 2\r\nthird = 3\r\n");
}

#[test]
fn edit_preserves_untouched_mixed_line_endings() {
    let old = b"alpha\r\nbeta\ngamma\r\n";
    let new = apply_edits(
        "fixture.txt",
        old,
        &[EditSpec {
            old_text: "beta".into(),
            new_text: "changed".into(),
        }],
    )
    .unwrap();
    assert_eq!(new, b"alpha\r\nchanged\ngamma\r\n");
}

#[test]
fn overlapping_edits_are_rejected() {
    let error = apply_edits(
        "fixture.txt",
        b"abcdef",
        &[
            EditSpec {
                old_text: "abcd".into(),
                new_text: "x".into(),
            },
            EditSpec {
                old_text: "cdef".into(),
                new_text: "y".into(),
            },
        ],
    )
    .unwrap_err();
    assert_eq!(error.error, "overlapping_edits");
}

#[tokio::test]
async fn stale_edit_preserves_original() {
    let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    fs::write(&path, "before").unwrap();
    let result = edit_local(
        path.clone(),
        "file.txt".into(),
        revision(b"different"),
        vec![EditSpec {
            old_text: "before".into(),
            new_text: "after".into(),
        }],
    )
    .await;
    assert!(result.is_error);
    assert!(
        result.content.contains("stale_revision"),
        "{}",
        result.content
    );
    assert_eq!(fs::read(&path).unwrap(), b"before");
    let _ = fs::remove_dir_all(dir);
}

#[tokio::test]
async fn create_only_never_overwrites() {
    let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    let first = write_local(path.clone(), "file.txt".into(), "first".into(), None).await;
    let second = write_local(path.clone(), "file.txt".into(), "second".into(), None).await;
    assert!(!first.is_error);
    assert!(second.is_error);
    assert!(second.content.contains("already_exists"));
    assert_eq!(fs::read(&path).unwrap(), b"first");
    let _ = fs::remove_dir_all(dir);
}
#[tokio::test]
async fn concurrent_create_only_calls_have_one_winner() {
    let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    let first = write_local(path.clone(), "file.txt".into(), "first".into(), None);
    let second = write_local(path.clone(), "file.txt".into(), "second".into(), None);
    let (first, second) = tokio::join!(first, second);
    assert_ne!(first.is_error, second.is_error);
    let loser = if first.is_error { &first } else { &second };
    assert!(
        loser.content.contains("already_exists"),
        "{}",
        loser.content
    );
    let content = fs::read_to_string(&path).unwrap();
    assert!(content == "first" || content == "second");
    let _ = fs::remove_dir_all(dir);
}

#[tokio::test]
async fn failure_after_temp_sync_preserves_original_and_cleans_temp() {
    let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    fs::write(&path, "before").unwrap();
    fail_once_before_publish(&path.canonicalize().unwrap());
    let result = write_local(
        path.clone(),
        "file.txt".into(),
        "after".into(),
        Some(revision(b"before")),
    )
    .await;
    assert!(result.is_error);
    assert!(result.content.contains("injected failure"));
    assert_eq!(fs::read(&path).unwrap(), b"before");
    let temp_count = fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".nac-mutation-")
        })
        .count();
    assert_eq!(temp_count, 0);
    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[tokio::test]
async fn mounted_mutation_never_follows_a_swapped_parent_symlink() {
    use std::os::unix::fs::symlink;

    let dir = std::env::temp_dir().join(format!("nac-mounted-mutation-{}", Uuid::new_v4()));
    let root = dir.join("mount");
    let outside = dir.join("outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    symlink(&outside, root.join("escape")).unwrap();
    let result = write_mounted(
        root,
        PathBuf::from("escape/file.txt"),
        "escape/file.txt".into(),
        "forbidden".into(),
        None,
    )
    .await;
    assert!(result.is_error);
    assert!(!outside.join("file.txt").exists());
    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[tokio::test]
async fn mounted_revisioned_write_does_not_create_parents_for_a_missing_target() {
    let root = std::env::temp_dir().join(format!("nac-mounted-mutation-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let result = write_mounted(
        root.clone(),
        PathBuf::from("missing/nested/file.txt"),
        "missing/nested/file.txt".into(),
        "replacement".into(),
        Some(revision(b"before")),
    )
    .await;
    assert!(result.is_error);
    assert!(result.content.contains("not_found"), "{}", result.content);
    assert!(!root.join("missing").exists());
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn concurrent_same_revision_edits_serialize_and_one_goes_stale() {
    let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    fs::write(&path, "value = 1\n").unwrap();
    let expected = revision(b"value = 1\n");
    let first = edit_local(
        path.clone(),
        "file.txt".into(),
        expected.clone(),
        vec![EditSpec {
            old_text: "value = 1".into(),
            new_text: "value = 2".into(),
        }],
    );
    let second = edit_local(
        path.clone(),
        "file.txt".into(),
        expected,
        vec![EditSpec {
            old_text: "value = 1".into(),
            new_text: "value = 3".into(),
        }],
    );
    let (first, second) = tokio::join!(first, second);
    assert_ne!(first.is_error, second.is_error);
    let stale = if first.is_error { &first } else { &second };
    assert!(
        stale.content.contains("stale_revision"),
        "{}",
        stale.content
    );
    let content = fs::read_to_string(&path).unwrap();
    assert!(content == "value = 2\n" || content == "value = 3\n");
    let _ = fs::remove_dir_all(dir);
}

#[tokio::test]
async fn aborting_awaiter_does_not_release_inflight_mutation_lock() {
    let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    fs::write(&path, "before").unwrap();
    let target = path.canonicalize().unwrap();
    let (entered, release) = gate_before_publish(target);
    let first_path = path.clone();
    let first = tokio::spawn(async move {
        write_local(
            first_path,
            "file.txt".into(),
            "first".into(),
            Some(revision(b"before")),
        )
        .await
    });
    tokio::task::spawn_blocking(move || entered.recv().unwrap())
        .await
        .unwrap();
    first.abort();
    let second_path = path.clone();
    let mut second = tokio::spawn(async move {
        write_local(
            second_path,
            "file.txt".into(),
            "second".into(),
            Some(revision(b"before")),
        )
        .await
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(50), &mut second)
            .await
            .is_err(),
        "contender acquired the lock while the cancelled awaiter's I/O was live"
    );
    release.send(()).unwrap();
    let second = second.await.unwrap();
    assert!(second.is_error);
    assert!(
        second.content.contains("stale_revision"),
        "{}",
        second.content
    );
    assert_eq!(fs::read(&path).unwrap(), b"first");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn mutation_process_helper() {
    let Some(target) = std::env::var_os("NAC_TEST_MUTATION_TARGET") else {
        return;
    };
    let ready = PathBuf::from(std::env::var_os("NAC_TEST_MUTATION_READY").unwrap());
    let target = PathBuf::from(target);
    let resolved = target.canonicalize().unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let lock = runtime.block_on(acquire_path_lock(&resolved)).unwrap();
    fs::write(&ready, b"ready").unwrap();
    std::thread::sleep(Duration::from_millis(100));
    mutate_locked(
        resolved,
        "file.txt".into(),
        MutationRequest::Write {
            expected_revision: Some(revision(b"before")),
            content: "child".into(),
        },
        lock,
    )
    .unwrap();
}

#[tokio::test]
async fn cross_process_mutations_serialize_and_stale_loser_cannot_continue() {
    use std::process::{Command, Stdio};

    let dir = std::env::temp_dir().join(format!("nac-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    let ready = dir.join("ready");
    fs::write(&path, "before").unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "tools::mutation::tests::mutation_process_helper",
            "--nocapture",
        ])
        .env("NAC_TEST_MUTATION_TARGET", &path)
        .env("NAC_TEST_MUTATION_READY", &ready)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    for _ in 0..200 {
        if ready.exists() {
            break;
        }
        assert!(
            child.try_wait().unwrap().is_none(),
            "mutation helper exited early"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(
        ready.exists(),
        "mutation helper never acquired its sidecar lock"
    );
    let loser = write_local(
        path.clone(),
        "file.txt".into(),
        "parent".into(),
        Some(revision(b"before")),
    )
    .await;
    assert!(child.wait().unwrap().success());
    assert!(loser.is_error);
    assert!(
        loser.content.contains("stale_revision"),
        "{}",
        loser.content
    );
    assert_eq!(fs::read(&path).unwrap(), b"child");
    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
#[allow(clippy::await_holding_lock)]
async fn non_mounted_podman_backend_runs_revisioned_create_and_edit() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let original_path = std::env::var_os("PATH");
    let _restore = RestorePath(original_path.clone());
    let dir = std::env::temp_dir().join(format!("nac-fake-podman-{}", Uuid::new_v4()));
    let bin = dir.join("bin");
    let workspace = dir.join("workspace");
    fs::create_dir_all(&bin).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    let workspace = fs::canonicalize(workspace).unwrap();
    let fake_podman = bin.join("podman");
    fs::write(
        &fake_podman,
        "#!/bin/sh\nshift\ncwd='.'\nwhile [ \"$#\" -gt 0 ]; do\n  case \"$1\" in\n    --workdir) cwd=$2; shift 2 ;;\n    --env) export \"$2\"; shift 2 ;;\n    -i|-t) shift ;;\n    *) shift; break ;;\n  esac\ndone\ncd \"$cwd\" || exit 125\nexec \"$@\"\n",
    )
    .unwrap();
    fs::set_permissions(&fake_podman, fs::Permissions::from_mode(0o755)).unwrap();
    let mut paths = vec![bin.clone()];
    if let Some(path) = original_path.as_ref() {
        paths.extend(std::env::split_paths(path));
    }
    unsafe {
        std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
    }
    let sandbox = crate::sandbox::SandboxSession::new_for_test(crate::sandbox::SandboxSpec {
        workdir: workspace.clone(),
        shm_size: Some("0".to_string()),
        ..Default::default()
    });
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = workspace.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(Some(sandbox), &workspace);
    let create = crate::tools::write::execute(
        json!({
            "path":"file.txt",
            "content":"alpha = 1\nbeta = 1\n",
            "expected_revision":null
        }),
        &runtime,
    )
    .await;
    assert!(!create.is_error, "{}", create.content);
    let read = crate::tools::read::execute(json!({"path":"file.txt"}), &runtime, false).await;
    assert!(!read.is_error, "{}", read.content);
    let read_value: Value =
        serde_json::from_str(read.content.as_text().expect("text tool result")).unwrap();
    let edit = crate::tools::edit::execute(
        json!({
            "path":"file.txt",
            "expected_revision":read_value["revision"],
            "edits":[
                {"old_text":"alpha = 1", "new_text":"alpha = 2"},
                {"old_text":"beta = 1", "new_text":"beta = 2"}
            ]
        }),
        &runtime,
    )
    .await;
    assert!(!edit.is_error, "{}", edit.content);
    assert_eq!(
        fs::read_to_string(workspace.join("file.txt")).unwrap(),
        "alpha = 2\nbeta = 2\n"
    );
    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
#[allow(clippy::await_holding_lock)]
async fn ssh_execution_backend_discovers_revision_and_runs_batched_edit() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let original_path = std::env::var_os("PATH");
    let _restore = RestorePath(original_path.clone());
    let dir = std::env::temp_dir().join(format!("nac-fake-ssh-{}", Uuid::new_v4()));
    let bin = dir.join("bin");
    let workspace = dir.join("workspace");
    fs::create_dir_all(&bin).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    let workspace = fs::canonicalize(workspace).unwrap();
    let fake_ssh = bin.join("ssh");
    fs::write(
        &fake_ssh,
        "#!/bin/sh\ncommand=''\nfor argument in \"$@\"; do command=$argument; done\nexec /bin/sh -c \"$command\"\n",
    )
    .unwrap();
    fs::set_permissions(&fake_ssh, fs::Permissions::from_mode(0o755)).unwrap();
    let mut paths = vec![bin.clone()];
    if let Some(path) = original_path.as_ref() {
        paths.extend(std::env::split_paths(path));
    }
    unsafe {
        std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
    }
    fs::write(workspace.join("file.txt"), "alpha = 1\nbeta = 1\n").unwrap();
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = workspace.clone();
    runtime.backend = crate::sandbox::ExecutionBackend::Ssh(crate::sandbox::SshBackend::new(
        "fake-host".into(),
        workspace.clone(),
    ))
    .into();
    fs::write(workspace.join("fixture.png"), test_png()).unwrap();
    let image = crate::tools::read::execute(json!({"path":"fixture.png"}), &runtime, true).await;
    assert!(!image.is_error, "{}", image.content);
    assert!(matches!(
        image.content.parts().unwrap(),
        [ToolContentPart::Image(image)] if image.mime_type().as_str() == "image/png"
    ));
    fs::write(workspace.join("unsupported.bmp"), b"BMunsupported").unwrap();
    let unsupported =
        crate::tools::read::execute(json!({"path":"unsupported.bmp"}), &runtime, true).await;
    assert!(unsupported.is_error);
    assert!(unsupported.content.contains("invalid_image"));
    fs::write(
        workspace.join("difflib.py"),
        "raise RuntimeError('workspace module imported')\n",
    )
    .unwrap();
    let read = crate::tools::read::execute(json!({"path":"file.txt"}), &runtime, false).await;
    assert!(!read.is_error, "{}", read.content);
    let read_value: Value =
        serde_json::from_str(read.content.as_text().expect("text tool result")).unwrap();
    let edit = crate::tools::edit::execute(
        json!({
            "path":"file.txt",
            "expected_revision":read_value["revision"],
            "edits":[
                {"old_text":"alpha = 1", "new_text":"alpha = 2"},
                {"old_text":"beta = 1", "new_text":"beta = 2"}
            ]
        }),
        &runtime,
    )
    .await;
    assert!(!edit.is_error, "{}", edit.content);
    assert_eq!(
        fs::read_to_string(workspace.join("file.txt")).unwrap(),
        "alpha = 2\nbeta = 2\n"
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn remote_read_matches_local_lf_only_pagination() {
    use std::process::{Command, Stdio};

    let dir = std::env::temp_dir().join(format!("nac-remote-read-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    let bytes = "first\ronly\u{2028}same\nsecond\r\nthird".as_bytes();
    fs::write(&path, bytes).unwrap();
    let local = read_result("file.txt".into(), bytes, 1, 2).unwrap();
    let payload = json!({
        "operation": "read",
        "path": "file.txt",
        "resolved_path": resolve_target_path(&path).unwrap(),
        "offset": 1,
        "limit": 2
    });

    let remote = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
    assert!(
        remote.status.success(),
        "{}",
        String::from_utf8_lossy(&remote.stderr)
    );
    let remote: Value = serde_json::from_slice(&remote.stdout).unwrap();
    assert_eq!(remote["content"], local.content);
    assert_eq!(remote["start_line"], local.start_line);
    assert_eq!(remote["end_line"], local.end_line);
    assert_eq!(remote["next_offset"], json!(local.next_offset));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn remote_protocol_removes_workspace_from_import_path_without_safe_path_support() {
    use std::process::{Command, Stdio};

    let workspace = std::env::temp_dir().join(format!("nac-remote-import-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&workspace).unwrap();
    let path = workspace.join("file.txt");
    fs::write(&path, b"safe\n").unwrap();
    for module in [
        "difflib.py",
        "fcntl.py",
        "hashlib.py",
        "json.py",
        "os.py",
        "pathlib.py",
        "stat.py",
        "tempfile.py",
        "uuid.py",
    ] {
        fs::write(
            workspace.join(module),
            "raise RuntimeError('workspace module imported')\n",
        )
        .unwrap();
    }
    let payload = json!({
        "operation": "read",
        "path": "file.txt",
        "resolved_path": resolve_target_path(&path).unwrap(),
        "offset": 0,
        "limit": 20
    });
    let mut child = Command::new("python3")
        .args(["-c", REMOTE_MUTATION_SCRIPT])
        .current_dir(&workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(&payload).unwrap())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["content"], "safe\n");
    let _ = fs::remove_dir_all(workspace);
}

#[test]
fn remote_protocol_reads_and_applies_a_batched_edit() {
    use std::process::{Command, Stdio};

    let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    fs::write(&path, b"\xef\xbb\xbfalpha = 1\r\nbeta = 1\r\n").unwrap();
    let read_payload = json!({
        "operation": "read",
        "path": "file.txt",
        "resolved_path": path,
        "offset": 0,
        "limit": 20
    });
    let read = run_python_protocol(&read_payload, &mut Command::new("python3"), Stdio::piped());
    assert!(
        read.status.success(),
        "{}",
        String::from_utf8_lossy(&read.stderr)
    );
    let read_value: Value = serde_json::from_slice(&read.stdout).unwrap();
    let edit_payload = json!({
        "operation": "edit",
        "path": "file.txt",
        "resolved_path": path,
        "expected_revision": read_value["revision"],
        "edits": [
            {"old_text": "alpha = 1", "new_text": "alpha = 2"},
            {"old_text": "beta = 1", "new_text": "beta = 2\nthird = 3"}
        ]
    });
    let edit = run_python_protocol(&edit_payload, &mut Command::new("python3"), Stdio::piped());
    assert!(
        edit.status.success(),
        "{}",
        String::from_utf8_lossy(&edit.stderr)
    );
    let edit_value: Value = serde_json::from_slice(&edit.stdout).unwrap();
    assert_eq!(
        edit_value["new_revision"],
        revision(b"\xef\xbb\xbfalpha = 2\r\nbeta = 2\r\nthird = 3\r\n")
    );
    assert_eq!(
        fs::read(&path).unwrap(),
        b"\xef\xbb\xbfalpha = 2\r\nbeta = 2\r\nthird = 3\r\n"
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn remote_edit_preserves_untouched_mixed_line_endings() {
    use std::process::{Command, Stdio};

    let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    let old = b"alpha\r\nbeta\ngamma\r\n";
    fs::write(&path, old).unwrap();
    let payload = json!({
        "operation": "edit",
        "path": "file.txt",
        "resolved_path": path,
        "expected_revision": revision(old),
        "edits": [{"old_text": "beta", "new_text": "changed"}]
    });
    let output = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fs::read(&path).unwrap(), b"alpha\r\nchanged\ngamma\r\n");
    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[test]
fn remote_metadata_preservation_does_not_require_recreating_a_foreign_owner() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::process::Command;

    let foreign_metadata = fs::metadata("/dev/null").unwrap();
    if foreign_metadata.uid() == unsafe { libc::geteuid() } {
        return;
    }
    let dir = std::env::temp_dir().join(format!("nac-remote-metadata-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    fs::write(&path, b"before").unwrap();
    let definitions = REMOTE_MUTATION_SCRIPT
        .split_once("payload = json.load(sys.stdin)")
        .unwrap()
        .0;
    let script = format!(
        "{definitions}\npath = Path(sys.argv[1])\nold_stat = os.stat('/dev/null')\n\
         publish(path, True, b'after', old_stat, {{'new_revision': rev(b'after')}})\n"
    );

    let output = Command::new("python3")
        .args(["-I", "-c", &script])
        .arg(resolve_target_path(&path).unwrap())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fs::read(&path).unwrap(), b"after");
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o7777,
        foreign_metadata.mode() & 0o7777
    );
    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[test]
fn remote_create_uses_normal_umask_filtered_permissions() {
    use std::os::unix::fs::PermissionsExt;
    use std::process::{Command, Stdio};

    let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let probe = dir.join("probe.txt");
    fs::write(&probe, b"").unwrap();
    let expected_mode = fs::metadata(&probe).unwrap().permissions().mode() & 0o777;
    let path = dir.join("created.txt");
    let payload = json!({
        "operation": "write",
        "path": "created.txt",
        "resolved_path": path,
        "expected_revision": null,
        "content": "created\n"
    });
    let output = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        expected_mode
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn remote_result_reports_final_newline_only_changes() {
    use std::process::{Command, Stdio};

    let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    fs::write(&path, b"line").unwrap();
    let payload = json!({
        "operation": "write",
        "path": "file.txt",
        "resolved_path": path,
        "expected_revision": revision(b"line"),
        "content": "line\n"
    });
    let output = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(!value["changed_ranges"].as_array().unwrap().is_empty());
    assert!(value["diff"]
        .as_str()
        .unwrap()
        .contains("\\ No newline at end of file"));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn remote_post_publication_failure_reports_committed_revision() {
    use std::process::{Command, Stdio};

    let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    let payload = json!({
        "operation": "write",
        "path": "file.txt",
        "resolved_path": path,
        "expected_revision": null,
        "content": "created",
        "_test_fail_after_publish": true
    });
    let output = run_python_protocol(&payload, &mut Command::new("python3"), Stdio::piped());
    assert!(!output.status.success());
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["committed"], true);
    assert_eq!(value["new_revision"], revision(b"created"));
    assert_eq!(fs::read(&path).unwrap(), b"created");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn remote_failure_before_publish_preserves_original_and_cleans_temp() {
    let dir = std::env::temp_dir().join(format!("nac-remote-mutation-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("file.txt");
    fs::write(&path, b"before").unwrap();
    let payload = json!({
        "operation": "write",
        "path": "file.txt",
        "resolved_path": path,
        "expected_revision": revision(b"before"),
        "content": "after",
        "_test_fail_before_publish": true
    });
    let output = run_python_protocol(
        &payload,
        &mut std::process::Command::new("python3"),
        std::process::Stdio::piped(),
    );
    assert!(!output.status.success());
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["error"], "io_error");
    assert_eq!(fs::read(&path).unwrap(), b"before");
    let temp_count = fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".nac-mutation-")
        })
        .count();
    assert_eq!(temp_count, 0);
    let _ = fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[test]
fn remote_native_mutation_rejects_post_authorization_ancestor_symlink_swap() {
    use std::os::unix::fs::symlink;

    let root = std::env::temp_dir().join(format!("nac-remote-binding-test-{}", Uuid::new_v4()));
    let safe = root.join("safe");
    let protected = root.join("protected");
    fs::create_dir_all(&safe).unwrap();
    fs::create_dir_all(&protected).unwrap();
    let authorized = safe.join("new-hook");
    let bound = resolve_target_path(&authorized).unwrap();
    let protected_hook = protected.join("new-hook");
    fs::write(&protected_hook, b"protected").unwrap();

    fs::rename(&safe, root.join("safe-before-swap")).unwrap();
    symlink(&protected, &safe).unwrap();
    let payload = json!({
        "operation": "write",
        "path": "safe/new-hook",
        "resolved_path": bound,
        "expected_revision": null,
        "content": "pwned"
    });
    let output = run_python_protocol_exact(
        &payload,
        &mut std::process::Command::new("python3"),
        std::process::Stdio::piped(),
    );
    assert!(!output.status.success());
    assert_eq!(fs::read(&protected_hook).unwrap(), b"protected");
    assert!(!root.join("safe-before-swap/new-hook").exists());

    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn remote_native_mutation_keeps_the_open_parent_across_a_late_swap() {
    let root =
        std::env::temp_dir().join(format!("nac-remote-late-binding-test-{}", Uuid::new_v4()));
    let safe = root.join("safe");
    let moved = root.join("safe-before-swap");
    let protected = root.join("protected");
    fs::create_dir_all(&safe).unwrap();
    fs::create_dir_all(&protected).unwrap();
    let protected_hook = protected.join("new-hook");
    fs::write(&protected_hook, b"protected").unwrap();
    let authorized = resolve_target_path(&safe.join("new-hook")).unwrap();
    let definitions = REMOTE_MUTATION_SCRIPT
        .split_once("payload = json.load(sys.stdin)")
        .unwrap()
        .0;
    let script = format!(
        "{definitions}\npath = Path(sys.argv[1])\n\
         parent, name = open_parent(path)\n\
         os.rename(sys.argv[2], sys.argv[3])\n\
         os.symlink(sys.argv[4], sys.argv[2])\n\
         publish_bound(parent, name, path, False, b'pwned', None, {{'new_revision': rev(b'pwned')}})\n\
         os.close(parent)\n"
    );
    let output = std::process::Command::new("python3")
        .args(["-I", "-c", &script])
        .arg(&authorized)
        .arg(&safe)
        .arg(&moved)
        .arg(&protected)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fs::read(&protected_hook).unwrap(), b"protected");
    assert_eq!(fs::read(moved.join("new-hook")).unwrap(), b"pwned");

    let _ = fs::remove_dir_all(root);
}

#[test]
fn worker_definitions_advertise_revisioned_batched_contract() {
    let definitions = crate::tools::worker_tool_definitions(false);
    let edit = definitions
        .iter()
        .find(|definition| definition.function.name == "edit")
        .unwrap();
    assert_eq!(
        edit.function.parameters["required"],
        json!(["path", "expected_revision", "edits"])
    );
    assert_eq!(
        edit.function.parameters["properties"]["edits"]["type"],
        "array"
    );
    let write = definitions
        .iter()
        .find(|definition| definition.function.name == "write")
        .unwrap();
    assert_eq!(
        write.function.parameters["required"],
        json!(["path", "content", "expected_revision"])
    );
    assert_eq!(
        write.function.parameters["properties"]["expected_revision"]["type"],
        json!(["string", "null"])
    );
}

fn run_python_protocol(
    payload: &Value,
    command: &mut std::process::Command,
    stdin: std::process::Stdio,
) -> std::process::Output {
    let mut payload = payload.clone();
    if let Some(path) = payload.get("resolved_path").and_then(Value::as_str) {
        payload["resolved_path"] = json!(resolve_target_path(Path::new(path)).unwrap());
    }
    run_python_protocol_exact(&payload, command, stdin)
}

fn run_python_protocol_exact(
    payload: &Value,
    command: &mut std::process::Command,
    stdin: std::process::Stdio,
) -> std::process::Output {
    command
        .arg("-I")
        .arg("-c")
        .arg(REMOTE_MUTATION_SCRIPT)
        .stdin(stdin)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = command.spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(payload).unwrap())
        .unwrap();
    child.wait_with_output().unwrap()
}
