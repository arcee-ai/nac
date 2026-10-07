//! Bounded experiment only. This is not the accepted enrollment/lifecycle wire.
//! Normal builds have no forwarding adapter or enrollment factory.
use super::*;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;

mod fixture;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FixtureProof {
    proof: String,
    binding: ManagedHostKeyBinding,
    serving_lifetime: String,
    native_incarnation: String,
    expires_at: u64,
}

#[derive(Clone)]
pub(in crate::model::client) struct EnrolledSender {
    socket: PathBuf,
    pub(in crate::model::client) capability: String,
    identity: FixtureProof,
}

impl std::fmt::Debug for EnrolledSender {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FixtureEnrolledSender")
            .field("binding", &self.identity.binding)
            .finish_non_exhaustive()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Observation {
    binding: ManagedHostKeyBinding,
    serving_lifetime: String,
    native_incarnation: String,
    revision: [u8; 32],
}

impl ManagedHostExecutionObserver for EnrolledSender {
    fn observe(&self, expected: &ManagedHostKeyBinding) -> Result<[u8; 32]> {
        let response = exchange(&self.socket, "GET", "/status", &self.capability, b"")?;
        anyhow::ensure!(response.status == 200, "sender unavailable");
        let observed: Observation = serde_json::from_slice(&response.body)?;
        anyhow::ensure!(
            &observed.binding == expected
                && observed.serving_lifetime == self.identity.serving_lifetime
                && observed.native_incarnation == self.identity.native_incarnation,
            "sender identity changed"
        );
        Ok(observed.revision)
    }
}

impl EnrolledSender {
    fn enroll(socket: &Path, proof: FixtureProof) -> Result<Self> {
        let response = exchange(
            socket,
            "POST",
            "/fixture-enroll",
            "",
            &serde_json::to_vec(&proof)?,
        )?;
        anyhow::ensure!(response.status == 200, "fixture enrollment denied");
        let capability: String = serde_json::from_slice(&response.body)?;
        anyhow::ensure!(uuid::Uuid::parse_str(&capability).is_ok(), "invalid grant");
        Ok(Self {
            socket: socket.to_owned(),
            capability,
            identity: proof,
        })
    }

    fn native_client(&self) -> ModelClient {
        let mut client = test_model_client(
            BackendKind::ArceeApi,
            self.identity.binding.inference_origin.clone(),
            Default::default(),
        );
        client.model = "trinity-large-thinking".into();
        client.resolved_model = catalog::resolve(client.backend, &client.model);
        client.api_key.clear();
        client.client = Client::builder()
            .unix_socket(self.socket.as_path())
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        client.host_execution_authority = Some(
            ManagedHostExecutionAuthority::from_sender_observer(
                self.identity.binding.clone(),
                Arc::new(self.clone()),
            )
            .unwrap(),
        );
        client.sender_prototype = Some(self.clone());
        client
    }
}

struct HttpResponse {
    status: u16,
    body: Vec<u8>,
}

fn exchange(
    socket: &Path,
    method: &str,
    route: &str,
    cap: &str,
    body: &[u8],
) -> Result<HttpResponse> {
    let mut stream = UnixStream::connect(socket)?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;
    write!(stream, "{method} {route} HTTP/1.1\r\nHost: fixture\r\nX-Nac-Fixture-Grant: {cap}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())?;
    stream.write_all(body)?;
    let mut bytes = Vec::new();
    stream.take(1024 * 1024 + 1).read_to_end(&mut bytes)?;
    anyhow::ensure!(bytes.len() <= 1024 * 1024, "oversize fixture response");
    let end = bytes
        .windows(4)
        .position(|v| v == b"\r\n\r\n")
        .ok_or_else(|| anyhow!("invalid fixture response"))?;
    let header = std::str::from_utf8(&bytes[..end])?;
    let status = header
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| anyhow!("missing status"))?
        .parse()?;
    Ok(HttpResponse {
        status,
        body: bytes[end + 4..].to_vec(),
    })
}

fn root() -> PathBuf {
    PathBuf::from(
        std::env::var_os("NAC_SENDER_PROBE_ROOT").expect("explicit fixture root required"),
    )
}

fn stage(root: &Path, value: &str) {
    std::fs::write(root.join("nac/stage"), value).unwrap();
}

fn wait_stage(root: &Path, value: &str) {
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while std::fs::read_to_string(root.join("nac/continue"))
        .ok()
        .as_deref()
        != Some(value)
    {
        assert!(
            std::time::Instant::now() < deadline,
            "fixture coordination timeout at {value}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

async fn native_send(
    client: &ModelClient,
    content: &str,
    stream: bool,
) -> Result<ModelTurnResponse> {
    let sink = |_: ModelStreamDelta| {};
    client
        .send_turn_streaming(
            vec![Message::User {
                content: content.into(),
            }],
            vec![],
            if stream { Some(&sink) } else { None },
        )
        .await
}

#[test]
fn sender_observation_defaults_deny_and_latches_revision_change() {
    let binding = fixture::binding();
    let denied = ManagedHostExecutionAuthority::from_sender_observer(
        binding.clone(),
        Arc::new(UnconfiguredManagedHostExecutionObserver),
    )
    .unwrap();
    assert!(denied.check_available().is_err());
    struct Observer(std::sync::atomic::AtomicU8);
    impl ManagedHostExecutionObserver for Observer {
        fn observe(&self, _: &ManagedHostKeyBinding) -> Result<[u8; 32]> {
            Ok([self.0.load(std::sync::atomic::Ordering::SeqCst); 32])
        }
    }
    let observer = Arc::new(Observer(std::sync::atomic::AtomicU8::new(1)));
    let authority =
        ManagedHostExecutionAuthority::from_sender_observer(binding, observer.clone()).unwrap();
    authority.check_available().unwrap();
    observer.0.store(2, std::sync::atomic::Ordering::SeqCst);
    assert!(authority.check_available().is_err());
    observer.0.store(1, std::sync::atomic::Ordering::SeqCst);
    assert!(authority.clone().check_available().is_err());
}

// Explicitly ignored helpers execute only in the two-UID, no-network fixture.
#[test]
#[ignore = "explicit two-UID Docker sender experiment only"]
fn sender_prototype_fixture_daemon() {
    fixture::daemon(&root());
}

#[test]
#[ignore = "explicit two-UID Docker sender experiment only"]
fn sender_prototype_fixture_control() {
    let command = std::env::var("NAC_SENDER_PROBE_CONTROL").unwrap();
    let response = exchange(
        &root().join("authority/control.sock"),
        "POST",
        "/fixture-control",
        "",
        command.as_bytes(),
    )
    .unwrap();
    assert_eq!(response.status, 200);
    println!("{}", String::from_utf8(response.body).unwrap());
}

#[tokio::test]
#[ignore = "explicit two-UID Docker sender experiment only"]
async fn sender_prototype_fixture_client() {
    crate::worker_credentials::restrict_same_uid_inspection().unwrap();
    let root = root();
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    let proofs: Vec<FixtureProof> = serde_json::from_str(&input).unwrap();
    input.clear();
    let socket = root.join("public/inference.sock");
    assert!(exchange(&socket, "GET", "/status", "", b"").unwrap().status == 403);
    let mut spoof = proofs[0].clone();
    spoof.native_incarnation = uuid::Uuid::new_v4().to_string();
    assert!(EnrolledSender::enroll(&socket, spoof).is_err());
    let grant = EnrolledSender::enroll(&socket, proofs[0].clone()).unwrap();
    assert!(EnrolledSender::enroll(&socket, proofs[0].clone()).is_err());
    // Fresh issuer proof cannot reuse this native process incarnation.
    assert!(EnrolledSender::enroll(&socket, proofs[2].clone()).is_err());
    let client = grant.native_client();
    assert!(client.api_key.is_empty());
    assert!(client.trusted_managed_host_key.is_none());
    assert!(client.trusted_api_key_file.is_none());
    assert!(!format!("{client:?}").contains(&grant.capability));
    let args = crate::tools::thread::worker_model_arguments_for_test(&client);
    assert!(!args.join(" ").contains(&grant.capability));
    assert!(!args.join(" ").contains("authority"));
    assert!(native_send(&client, "buffered", false).await.is_ok());
    assert!(native_send(&client, "streamed", true).await.is_ok());
    fixture::prove_terminal_and_mcp(&root).await;
    fixture::prove_worker_private_transport(&root, &proofs[1]).await;
    for (content, stream) in [
        ("http-failure", false),
        ("lost-response", false),
        ("broken-sse", true),
    ] {
        let error = native_send(&client, content, stream)
            .await
            .unwrap_err()
            .to_string();
        assert!(!error.contains("nac-fixture-key-") && !error.contains(&grant.capability));
    }
    assert_eq!(
        std::fs::read_to_string(root.join("public/provider-count")).unwrap(),
        "6"
    );
    stage(&root, "cutoff");
    wait_stage(&root, "cutoff");
    assert!(client
        .host_execution_authority
        .as_ref()
        .unwrap()
        .check_available()
        .is_err());
    assert!(native_send(&client, "must-not-dispatch", false)
        .await
        .is_err());
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = root.join("nac");
    runtime.config_cwd = runtime.workspace_cwd.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &runtime.workspace_cwd);
    runtime.host_execution_authority = client.host_execution_authority.clone();
    runtime.command_cancellation =
        crate::tools::ThreadCancellation::for_host(runtime.host_execution_authority.clone());
    let denied = crate::tools::execute_tool(
        "exec_command",
        json!({"cmd":"touch must-not-spawn"}),
        &runtime,
        &client,
    )
    .await;
    assert!(denied.is_error);
    assert!(!root.join("nac/must-not-spawn").exists());
    stage(&root, "restore");
    wait_stage(&root, "restore");
    // Synthetic restoration makes the sender slot available, never this guard.
    assert_eq!(
        exchange(&socket, "GET", "/status", &grant.capability, b"")
            .unwrap()
            .status,
        200
    );
    assert!(client
        .host_execution_authority
        .as_ref()
        .unwrap()
        .check_available()
        .is_err());
    stage(&root, "restart-repair");
    wait_stage(&root, "restart-repair");
    assert_eq!(
        exchange(&socket, "GET", "/status", &grant.capability, b"")
            .unwrap()
            .status,
        403
    );
    assert!(EnrolledSender::enroll(&socket, proofs[2].clone()).is_err());
    assert!(native_send(&client, "old-lifetime", false).await.is_err());
    assert_eq!(
        std::fs::read_to_string(root.join("public/provider-count")).unwrap(),
        "6"
    );
    stage(&root, "done");
    println!("two-UID native forwarding, private worker IPC, protected files, sticky cutoff and no replay PASS");
}

#[tokio::test]
#[ignore = "explicit two-UID Docker sender experiment only"]
async fn sender_prototype_fixture_worker() {
    let socket = PathBuf::from(std::env::var_os("NAC_SENDER_PROBE_CREDENTIAL_SOCKET").unwrap());
    let receiver =
        crate::worker_credentials::ManagedWorkerCredentialReceiver::from_private_channel(
            None,
            Some(socket),
        )
        .unwrap();
    let fd = receiver.raw_fd_for_test().unwrap();
    // SAFETY: read-only checks on the owned descriptor/process.
    assert_ne!(
        unsafe { libc::fcntl(fd, libc::F_GETFD) } & libc::FD_CLOEXEC,
        0
    );
    #[cfg(target_os = "linux")]
    assert_eq!(unsafe { libc::prctl(libc::PR_GET_DUMPABLE) }, 0);
    fixture::prove_terminal_and_mcp(&root()).await;
    let credentials = receiver.receive_after_mcp().await.unwrap();
    let proof: FixtureProof =
        serde_json::from_str(credentials.sender_prototype_grant.as_deref().unwrap()).unwrap();
    let grant = EnrolledSender::enroll(&root().join("public/inference.sock"), proof).unwrap();
    let client = grant.native_client();
    assert!(client.api_key.is_empty());
    assert!(native_send(&client, "worker", false).await.is_ok());
}

#[test]
#[ignore = "explicit two-UID Docker sender experiment only"]
fn sender_prototype_fixture_mcp() {
    let root = root();
    assert!(std::fs::read(root.join("authority/managed_host_key.json")).is_err());
    assert!(std::fs::write(root.join("authority/bootstrap.json"), b"replace").is_err());
    assert!(std::fs::remove_file(root.join("authority/managed_host_key.json")).is_err());
    for (name, _) in std::env::vars() {
        assert!(!name.contains("GRANT") && !name.contains("PROOF"));
    }
    println!("MCP child cannot read or replace private authority/bootstrap");
}
