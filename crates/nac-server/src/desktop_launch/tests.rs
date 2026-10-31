use super::*;

#[test]
fn records_are_bounded_and_require_a_complete_line() {
    for bytes in [
        vec![b'x'; LIMIT + 1],
        b"{\"kind\":\"hello\"}".to_vec(),
        vec![],
    ] {
        assert!(read_record(&mut std::io::Cursor::new(bytes)).is_err());
    }
    let mut reader = std::io::Cursor::new(b"one\ntwo\n");
    assert_eq!(read_record(&mut reader).unwrap(), b"one\n");
    assert_eq!(read_record(&mut reader).unwrap(), b"two\n");
    let mut boundary = vec![b'x'; LIMIT - 1];
    boundary.push(b'\n');
    assert_eq!(
        read_record(&mut std::io::Cursor::new(boundary))
            .unwrap()
            .len(),
        LIMIT
    );
}

#[test]
fn control_cannot_name_a_pid_or_store() {
    assert!(serde_json::from_str::<Stop>(
        r#"{"kind":"stop","version":1,"incarnation":"x","pid":123}"#
    )
    .is_err());
    assert!(serde_json::from_str::<Stop>(
        r#"{"kind":"stop","version":1,"incarnation":"x","store":"/other"}"#
    )
    .is_err());
    assert_eq!(
        Identity::current().source_revision,
        build_identity::current().source_revision
    );
}

fn channel() -> (UnixStream, DesktopLaunch) {
    channel_for_store(Path::new("/tmp/desktop-channel-fixture.db"))
}

fn channel_for_store(store: &Path) -> (UnixStream, DesktopLaunch) {
    let (mut parent, child) = UnixStream::pair().unwrap();
    let hello = serde_json::json!({"kind":"hello", "version":VERSION,
        "incarnation":uuid::Uuid::new_v4().to_string(), "identity":Identity::current(),
        "store":store});
    writeln!(parent, "{hello}").unwrap();
    (parent, DesktopLaunch::adopt(child).unwrap())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fresh_store_is_identified_only_after_the_shared_listener_initializes_it() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-desktop-fresh-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let _env = crate::tests::ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let store = root.join("store.db");
    assert!(!store.exists());
    let (mut parent, launch) = channel_for_store(&store);
    let manager = SessionManager::new_async(crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(store.clone()),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    let server =
        tokio::spawn(async move { launch.serve("127.0.0.1:0".parse().unwrap(), manager).await });
    let (peer, receipt) = tokio::task::spawn_blocking(move || {
        parent
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let bytes = read_record(&mut BufReader::new(parent.try_clone().unwrap())).unwrap();
        (
            parent,
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
        )
    })
    .await
    .unwrap();
    parent = peer;
    assert_eq!(receipt["kind"], "ready");
    assert_eq!(receipt["store"], store.to_str().unwrap());
    assert_eq!(receipt["schema"], nac_core::store::schema_version());
    nac_core::store::check_readiness(&store).unwrap();
    writeln!(
        parent,
        "{}",
        serde_json::json!({"kind":"stop", "version":VERSION,
        "incarnation":receipt["incarnation"]})
    )
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn parent_eof_is_latched_before_manager_or_listener_construction() {
    let (parent, mut launch) = channel();
    drop(parent);
    tokio::time::timeout(Duration::from_secs(1), launch.stopped.changed())
        .await
        .unwrap()
        .unwrap();
    assert!(*launch.stopped.borrow());
    // A subscriber created after EOF must observe the same stop, not miss it.
    assert!(*launch.stopped.clone().borrow());
}

#[tokio::test]
async fn malformed_control_and_wrong_incarnation_stop_only_the_owned_launch() {
    let (other_parent, other) = channel();
    for record in [
        "{broken}",
        r#"{"kind":"stop","version":1,"incarnation":"another-launch"}"#,
    ] {
        let (mut parent, mut launch) = channel();
        writeln!(parent, "{record}").unwrap();
        tokio::time::timeout(Duration::from_secs(1), launch.stopped.changed())
            .await
            .unwrap()
            .unwrap();
        assert!(*launch.stopped.borrow());
        assert!(
            !*other.stopped.borrow(),
            "control crossed a private channel"
        );
    }
    drop(other_parent);
}

#[test]
fn adopted_descriptor_and_clones_are_closed_by_exec() {
    use std::os::fd::AsRawFd;
    let (mut parent, child) = UnixStream::pair().unwrap();
    // Reserve a high descriptor so the child test harness cannot incidentally
    // reuse its number for ordinary startup I/O after close-on-exec.
    // SAFETY: duplicate a live owned endpoint, transferring only the new FD.
    let raw = unsafe { libc::fcntl(child.as_raw_fd(), libc::F_DUPFD, 100) };
    assert!(raw >= 100);
    // SAFETY: raw is the new descriptor returned by successful fcntl above.
    let inherited = unsafe { UnixStream::from_raw_fd(raw) };
    let hello = serde_json::json!({"kind":"hello", "version":VERSION,
        "incarnation":uuid::Uuid::new_v4().to_string(), "identity":Identity::current(),
        "store":"/tmp/desktop-descriptor-fixture.db"});
    writeln!(parent, "{hello}").unwrap();
    let launch = DesktopLaunch::adopt(inherited).unwrap();
    let clone = launch.stream.try_clone().unwrap();
    for fd in [raw, clone.as_raw_fd()] {
        // SAFETY: query flags without modifying either owned descriptor.
        assert_ne!(
            unsafe { libc::fcntl(fd, libc::F_GETFD) } & libc::FD_CLOEXEC,
            0
        );
    }
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "desktop_launch::tests::descriptor_probe",
            "--nocapture",
        ])
        .env("NAC_TEST_CLOSED_DESKTOP_FD", raw.to_string())
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
fn descriptor_probe() {
    if let Ok(raw) = std::env::var("NAC_TEST_CLOSED_DESKTOP_FD") {
        let fd: i32 = raw.parse().unwrap();
        // SAFETY: a read-only query of the exact exec probe descriptor.
        assert_eq!(unsafe { libc::fcntl(fd, libc::F_GETFD) }, -1);
    }
}
