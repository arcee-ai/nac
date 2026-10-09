//! Disposable installer with TWO actual kernel UIDs. Synthetic enrollment and
//! local response sink only; no Clerk, model, session/run or product acceptance.
use super::*;
use std::{
    io::{BufRead, Write},
    os::unix::{fs::PermissionsExt, net::UnixListener, process::CommandExt},
    process::{Command, Stdio},
};

const TEST: &str =
    "delivery::managed_runtime_tls::issuer::carrier::tests::linux::two_uid_component_fixture";
const HELPER_UID: u32 = 21001;
const RUNTIME_UID: u32 = 21002;

fn role_command(
    executable: &std::path::Path,
    root: &std::path::Path,
    role: &str,
    uid: u32,
) -> Command {
    let mut command = Command::new(executable);
    command
        .args([
            TEST,
            "--ignored",
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ])
        .env_clear()
        .env("NAC_CARRIER_FIXTURE_ROLE", role)
        .env("NAC_CARRIER_FIXTURE_ROOT", root)
        .env("TMPDIR", root.join("runtime"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // SAFETY: disposable root installer; only async-signal-safe syscalls in
    // pre_exec. Drop supplementary groups and all UID/GID privileges BEFORE exec.
    unsafe {
        command.pre_exec(move || {
            if libc::setgroups(0, std::ptr::null()) != 0
                || libc::setgid(uid) != 0
                || libc::setuid(uid) != 0
                || libc::prctl(libc::PR_SET_DUMPABLE, 0) != 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command
}

#[test]
#[ignore = "requires disposable Linux root fixture; never runs on installed hosts"]
fn two_uid_component_fixture() {
    match std::env::var("NAC_CARRIER_FIXTURE_ROLE").ok().as_deref() {
        Some("helper") => helper(),
        Some("runtime") => runtime_child(),
        None => installer(),
        _ => panic!("unknown fixture role"),
    }
}

fn installer() {
    // SAFETY: get effective UID only; require an explicitly disposable root run.
    assert_eq!(unsafe { libc::geteuid() }, 0);
    let root = PathBuf::from(format!("/tmp/nac-two-uid-carrier-{}", Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o755)).unwrap();
    for (name, uid) in [("helper", HELPER_UID), ("runtime", RUNTIME_UID)] {
        let path = root.join(name);
        std::fs::create_dir(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(Command::new("chown")
            .arg(format!("{uid}:{uid}"))
            .arg(&path)
            .status()
            .unwrap()
            .success());
    }
    let key = root.join("helper/canary.key");
    std::fs::write(
        &key,
        format!("disposable-canary-{}-{}", Uuid::new_v4(), Uuid::new_v4()),
    )
    .unwrap();
    std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(Command::new("chown")
        .arg(format!("{HELPER_UID}:{HELPER_UID}"))
        .arg(&key)
        .status()
        .unwrap()
        .success());
    let executable = root.join("selected-test-executable");
    std::fs::copy(std::env::current_exe().unwrap(), &executable).unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    let artifact = hex(Sha256::digest(std::fs::read(&executable).unwrap()).into());
    let endpoint = root.join("installer.sock");
    let selected = UnixListener::bind(&endpoint).unwrap();
    std::fs::set_permissions(&endpoint, std::fs::Permissions::from_mode(0o666)).unwrap();
    let runtime = role_command(&executable, &root, "runtime", RUNTIME_UID)
        .spawn()
        .unwrap();
    let (mut endpoint, _) = selected.accept().unwrap();
    let mut reader = std::io::BufReader::new(endpoint.try_clone().unwrap());
    let mut address = String::new();
    reader.read_line(&mut address).unwrap();
    let mut helper = role_command(&executable, &root, "helper", HELPER_UID)
        .spawn()
        .unwrap();
    helper
        .stdin
        .take()
        .unwrap()
        .write_all(address.as_bytes())
        .unwrap();
    writeln!(endpoint, "{}", helper.id()).unwrap();
    let runtime_output = runtime.wait_with_output().unwrap();
    let helper_output = helper.wait_with_output().unwrap();
    assert!(
        runtime_output.status.success(),
        "runtime: {} {}",
        String::from_utf8_lossy(&runtime_output.stdout),
        String::from_utf8_lossy(&runtime_output.stderr)
    );
    assert!(
        helper_output.status.success(),
        "helper: {} {}",
        String::from_utf8_lossy(&helper_output.stdout),
        String::from_utf8_lossy(&helper_output.stderr)
    );
    let canary = std::fs::read(&key).unwrap();
    for output in [
        &runtime_output.stdout,
        &runtime_output.stderr,
        &helper_output.stdout,
        &helper_output.stderr,
    ] {
        assert!(
            !output.windows(canary.len()).any(|window| window == canary),
            "canary absent from output"
        );
    }
    assert!(String::from_utf8_lossy(&runtime_output.stdout)
        .contains("reservation=1 challenge=1 response=1 consume=1 guard=1 sink_ack=1"));
    assert!(String::from_utf8_lossy(&helper_output.stdout)
        .contains("helper retained_key=true response=1 sink_ack=1"));
    drop(selected);
    std::fs::remove_dir_all(&root).unwrap();
    assert!(!root.exists());
    println!("two_uid_component: helper_euid={HELPER_UID} runtime_euid={RUNTIME_UID} artifact_sha256={artifact} cleanup_absent=true synthetic_provenance=true native_activation=false");
}

fn fixture_root() -> PathBuf {
    PathBuf::from(std::env::var_os("NAC_CARRIER_FIXTURE_ROOT").unwrap())
}
fn helper() {
    // SAFETY: read effective UID; the root installer independently selected exec.
    assert_eq!(unsafe { libc::geteuid() }, HELPER_UID);
    let root = fixture_root();
    let key = std::fs::read(root.join("helper/canary.key")).unwrap();
    assert!(key.len() > 32);
    // SAFETY: disable proc-memory inspection for the disposable custody process.
    assert_eq!(unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0) }, 0);
    let mut address = String::new();
    std::io::stdin().lock().read_line(&mut address).unwrap();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let address = address.trim().parse().unwrap();
        let mut socket =
            crate::delivery::managed_runtime_tls::tests::client(address, Some("wrong-peer"))
                .await
                .unwrap();
        assert_eq!(
            socket.get_ref().1.protocol_version(),
            Some(tokio_rustls::rustls::ProtocolVersion::TLSv1_3)
        );
        let hello = read_frame(&mut socket).await;
        let hello = super::super::RuntimeChannelHello::decode(&hello).unwrap();
        let raw = read_frame(&mut socket).await;
        let challenge = RuntimeChallenge::decode(&raw).unwrap();
        let hello_fields: Value = serde_json::from_slice(&hello.canonical().unwrap()).unwrap();
        assert_eq!(
            challenge.fields()["control_channel_id"],
            hello_fields["control_channel_id"]
        );
        let response = response(&challenge);
        assert!(!response.windows(key.len()).any(|window| window == key));
        write_frame(&mut socket, &response).await;
        assert_eq!(read_frame(&mut socket).await, b"local-nonbillable-ack");
        socket.shutdown().await.unwrap();
        println!("helper retained_key=true response=1 sink_ack=1");
    });
}

fn runtime_child() {
    // SAFETY: read UID; this is a fixture check, never an authority constructor.
    assert_eq!(unsafe { libc::geteuid() }, RUNTIME_UID);
    let root = fixture_root();
    let mut installer =
        std::os::unix::net::UnixStream::connect(root.join("installer.sock")).unwrap();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let mut listener = super::super::super::IssuerControlTlsListener::bind("127.0.0.1:0".parse().unwrap(),
            super::super::super::tests::issuer_identity()).await.unwrap();
        writeln!(installer, "{}", listener.local_addr().unwrap()).unwrap();
        let mut pid = String::new();
        std::io::BufReader::new(installer.try_clone().unwrap()).read_line(&mut pid).unwrap();
        let pid: u32 = pid.trim().parse().unwrap();
        for path in [root.join("helper/canary.key"), PathBuf::from(format!("/proc/{pid}/mem")),
            PathBuf::from(format!("/proc/{pid}/environ")), PathBuf::from(format!("/proc/{pid}/fd"))] {
            assert!(std::fs::File::open(&path).is_err(), "runtime cannot inspect {}", path.display());
        }
        assert!(std::fs::read_dir(root.join("helper")).is_err());
        let stream = axum::serve::Listener::accept(&mut listener).await.0;
        let mut fixture = Fixture::from_stream(stream, None, true).await;
        let hello = fixture.carrier().hello().unwrap();
        write_frame(fixture.transport.as_mut().unwrap(), &hello).await;
        fixture.carrier().reserve().await.unwrap();
        let challenge = fixture.carrier().challenge().await.unwrap();
        fixture.carrier().claim_submission().await.unwrap();
        write_frame(fixture.transport.as_mut().unwrap(), &challenge).await;
        let response = read_frame(fixture.transport.as_mut().unwrap()).await;
        fixture.carrier().consume(&response).await.unwrap();
        assert_eq!(fixture.rows(), (1, Some("active".into())));
        let Stage::Active(active) = std::mem::replace(&mut fixture.carrier().stage, Stage::Denied) else { panic!("delivered Active") };
        let guard = ManagedRuntimeLeaseGuard::new(Arc::clone(&fixture.store), active).await.unwrap();
        guard.check_now().unwrap();
        write_frame(fixture.transport.as_mut().unwrap(), b"local-nonbillable-ack").await;
        fixture.poll_stream();
        tokio::time::timeout(Duration::from_secs(2), fixture.peer.wait_for_close()).await.unwrap();
        guard.deny_now();
        fixture.finish().await;
        println!("runtime reservation=1 challenge=1 response=1 consume=1 guard=1 sink_ack=1 native_session_run_ack=0");
    });
}

// Test-only length framing for this local sink, NEVER a product WSS/wire codec.
async fn write_frame<S: tokio::io::AsyncWrite + Unpin>(stream: &mut S, bytes: &[u8]) {
    stream
        .write_u32(u32::try_from(bytes.len()).unwrap())
        .await
        .unwrap();
    stream.write_all(bytes).await.unwrap();
    stream.flush().await.unwrap();
}
async fn read_frame<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> Vec<u8> {
    let size = stream.read_u32().await.unwrap();
    assert!(size <= 32768);
    let mut bytes = vec![0; size as usize];
    stream.read_exact(&mut bytes).await.unwrap();
    bytes
}
