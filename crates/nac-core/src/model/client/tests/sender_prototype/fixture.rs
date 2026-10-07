//! Fixture-only issuer/sender. Its local JSON/HTTP is not a canonical contract.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
use std::net::TcpListener;
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

const KEY_PREFIX: &str = "nac-fixture-key-";

pub(super) fn binding() -> ManagedHostKeyBinding {
    ManagedHostKeyBinding {
        bootstrap_id: "4712bc5e-30d5-421a-b416-8291d9f7d8f9".into(),
        managed_host_id: "21856443-8ed8-40ab-9036-72e837c99f27".into(),
        host_incarnation_id: "fixture-cr-uid".into(),
        pvc_uid: "fixture-pvc-uid".into(),
        organization_id: "11670cb3-ea82-4f66-96ca-d5b6542f8c2a".into(),
        owner_epoch: 1,
        key_generation: 1,
        local_key_id: "00d61e35-4d17-4949-888f-5f153b03a53b".into(),
        key_id: "fixture-provider-key".into(),
        clerk_instance_id: "fixture-instance".into(),
        inference_origin: "https://api.arcee.ai".into(),
    }
}

struct State {
    store: ManagedHostKeyStore,
    current: ManagedHostKeyBinding,
    allowed: Vec<FixtureProof>,
    used_proofs: BTreeSet<String>,
    used_incarnations: BTreeSet<String>,
    grants: BTreeMap<String, (FixtureProof, u32)>,
    saved: Vec<u8>,
    observed_private_record: Vec<u8>,
    revision: [u8; 32],
}

struct Request {
    method: String,
    route: String,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut impl Read) -> Result<Request> {
    let mut bytes = Vec::new();
    let end = loop {
        let mut byte = [0];
        stream.read_exact(&mut byte)?;
        bytes.push(byte[0]);
        anyhow::ensure!(bytes.len() <= 16 * 1024, "fixture headers too large");
        if bytes.ends_with(b"\r\n\r\n") {
            break bytes.len();
        }
    };
    let header = std::str::from_utf8(&bytes[..end])?;
    let mut lines = header.lines();
    let first = lines.next().unwrap().split_whitespace().collect::<Vec<_>>();
    anyhow::ensure!(first.len() == 3, "invalid fixture request");
    let mut headers = BTreeMap::new();
    for line in lines.filter(|s| !s.is_empty()) {
        let (key, value) = line
            .split_once(':')
            .ok_or_else(|| anyhow!("invalid header"))?;
        anyhow::ensure!(
            headers
                .insert(key.to_lowercase(), value.trim().to_owned())
                .is_none(),
            "duplicate fixture header"
        );
    }
    let count = headers
        .get("content-length")
        .map(|s| s.parse::<usize>())
        .transpose()?
        .unwrap_or(0);
    anyhow::ensure!(
        count <= 128 * 1024 && !headers.contains_key("transfer-encoding"),
        "fixture body limit"
    );
    let mut body = vec![0; count];
    stream.read_exact(&mut body)?;
    Ok(Request {
        method: first[0].into(),
        route: first[1].into(),
        headers,
        body,
    })
}

fn respond(stream: &mut impl Write, status: u16, kind: &str, body: &[u8]) -> Result<()> {
    write!(stream,"HTTP/1.1 {status} Fixture\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len())?;
    stream.write_all(body)?;
    stream.flush()?;
    Ok(())
}

fn peer(stream: &UnixStream) -> Result<(u32, u32)> {
    #[cfg(target_os = "linux")]
    {
        let mut credential = libc::ucred {
            pid: 0,
            uid: 0,
            gid: 0,
        };
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        // SAFETY: correctly sized live output storage and owned socket.
        anyhow::ensure!(
            unsafe {
                libc::getsockopt(
                    stream.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_PEERCRED,
                    (&mut credential as *mut libc::ucred).cast(),
                    &mut len,
                )
            } == 0,
            "peer unavailable"
        );
        Ok((credential.uid, u32::try_from(credential.pid)?))
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = stream;
        anyhow::bail!("two-UID proof requires Linux")
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn authorize(state: &State, cap: &str, pid: u32) -> Result<FixtureProof> {
    let (proof, expected_pid) = state.grants.get(cap).ok_or_else(|| anyhow!("unenrolled"))?;
    anyhow::ensure!(
        pid == *expected_pid && proof.expires_at > now() && proof.binding == state.current,
        "stale enrollment"
    );
    state.store.validate_local(&proof.binding)?;
    Ok(proof.clone())
}

fn enrollment(state: &mut State, request: &Request, pid: u32) -> Result<String> {
    let proof: FixtureProof = serde_json::from_slice(&request.body)?;
    let accepted = state.allowed.iter().any(|expected| {
        expected.proof == proof.proof
            && expected.binding == proof.binding
            && expected.serving_lifetime == proof.serving_lifetime
            && expected.native_incarnation == proof.native_incarnation
            && expected.expires_at == proof.expires_at
    });
    anyhow::ensure!(
        accepted
            && proof.expires_at > now()
            && proof.binding == state.current
            && !state.used_proofs.contains(&proof.proof)
            && !state.used_incarnations.contains(&proof.native_incarnation),
        "fixture proof rejected"
    );
    state.store.validate_local(&proof.binding)?;
    state.used_proofs.insert(proof.proof.clone());
    state
        .used_incarnations
        .insert(proof.native_incarnation.clone());
    let cap = uuid::Uuid::new_v4().to_string();
    state.grants.insert(cap.clone(), (proof, pid));
    Ok(cap)
}

fn upstream(listener: TcpListener, count: Arc<AtomicUsize>, root: PathBuf, key: String) {
    for mut stream in listener.incoming().flatten() {
        let request = read_request(&mut stream).unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(request.route, "/api/v1/chat/completions");
        assert!(
            request
                .headers
                .get("authorization")
                .is_some_and(|value| value == &format!("Bearer {key}")),
            "fixture upstream credential mismatch"
        );
        assert!(!request.headers.contains_key("x-nac-fixture-grant"));
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        let number = count.fetch_add(1, Ordering::SeqCst) + 1;
        std::fs::write(root.join("public/provider-count"), number.to_string()).unwrap();
        let content = body["messages"][0]["content"].as_str().unwrap();
        let (status,kind,response)=match content {
            "http-failure"=>(503,"application/json",format!("{{\"error\":\"{key}\"}}")),
            "broken-sse"=>(200,"text/event-stream","data: invalid\n\n".into()),
            _ if body["stream"]==true => (200,"text/event-stream",concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n",
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
                "data: [DONE]\n\n").into()),
            _=>(200,"application/json",json!({"choices":[{"message":{"content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}).to_string())
        };
        respond(&mut stream, status, kind, response.as_bytes()).unwrap();
    }
}

pub(super) fn daemon(root: &Path) {
    assert_eq!(unsafe { libc::geteuid() }, 10002);
    crate::worker_credentials::restrict_same_uid_inspection().unwrap();
    let private = root.join("authority");
    let store = ManagedHostKeyStore::new(&private);
    let current = binding();
    if !private.join("managed_host_key.json").exists() {
        deliver(&private, &current);
        store
            .import(&current, &private.join("bootstrap.json"))
            .unwrap();
    }
    let allowed: Vec<FixtureProof> =
        serde_json::from_slice(&std::fs::read(private.join("fixture-enrollments.json")).unwrap())
            .unwrap();
    let saved = std::fs::read(private.join("managed_host_key.json")).unwrap();
    let state = Arc::new(Mutex::new(State {
        store,
        current,
        allowed,
        used_proofs: Default::default(),
        used_incarnations: Default::default(),
        grants: Default::default(),
        observed_private_record: saved.clone(),
        revision: new_revision(),
        saved,
    }));
    let provider = TcpListener::bind("127.0.0.1:0").unwrap();
    let provider_url = format!(
        "http://{}/api/v1/chat/completions",
        provider.local_addr().unwrap()
    );
    let count = Arc::new(AtomicUsize::new(
        std::fs::read_to_string(root.join("public/provider-count"))
            .unwrap_or_else(|_| "0".into())
            .parse()
            .unwrap(),
    ));
    {
        let count = count.clone();
        let root = root.to_owned();
        let key = std::fs::read_to_string(private.join("fixture-provider-key")).unwrap();
        std::thread::spawn(move || upstream(provider, count, root, key));
    }
    let control = private.join("control.sock");
    let _ = std::fs::remove_file(&control);
    let control = UnixListener::bind(control).unwrap();
    {
        let state = state.clone();
        let root = root.to_owned();
        std::thread::spawn(move || {
            for mut stream in control.incoming().flatten() {
                assert_eq!(peer(&stream).unwrap().0, 10002);
                let request = read_request(&mut stream).unwrap();
                let command = std::str::from_utf8(&request.body).unwrap();
                let result = control_operation(&root, &mut state.lock().unwrap(), command);
                respond(
                    &mut stream,
                    if result.is_ok() { 200 } else { 403 },
                    "text/plain",
                    if result.is_ok() {
                        b"fixture control PASS"
                    } else {
                        b"fixture control denied"
                    },
                )
                .unwrap();
                if command == "stop" {
                    std::process::exit(0);
                }
            }
        });
    }
    let socket = root.join("public/inference.sock");
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).unwrap();
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o666)).unwrap();
    std::fs::write(root.join("public/ready"), "ready").unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let http = runtime.block_on(async {
        Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap()
    });
    for mut stream in listener.incoming().flatten() {
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let result = (|| -> Result<()> {
            let (uid, pid) = peer(&stream)?;
            anyhow::ensure!(uid == 10001, "wrong fixture UID");
            let request = read_request(&mut stream)?;
            anyhow::ensure!(
                !request.headers.contains_key("authorization")
                    && !request.headers.contains_key("x-api-key"),
                "workload must not supply provider credentials"
            );
            if request.method == "POST" && request.route == "/fixture-enroll" {
                let cap = enrollment(&mut state.lock().unwrap(), &request, pid)?;
                return respond(
                    &mut stream,
                    200,
                    "application/json",
                    serde_json::to_string(&cap)?.as_bytes(),
                );
            }
            let cap = request
                .headers
                .get("x-nac-fixture-grant")
                .map(String::as_str)
                .unwrap_or("");
            let mut state = state.lock().unwrap();
            let proof = authorize(&state, cap, pid)?;
            let record = nac_credential_store::read_auth_bytes_from_path_limited(
                &private.join("managed_host_key.json"),
                128 * 1024,
            )?
            .ok_or_else(|| anyhow!("fixture private record unavailable"))?;
            if record != state.observed_private_record {
                state.observed_private_record = record;
                state.revision = new_revision();
            }
            if request.method == "GET" && request.route == "/status" {
                let revision = state.revision;
                let observed = Observation {
                    binding: proof.binding,
                    serving_lifetime: proof.serving_lifetime,
                    native_incarnation: proof.native_incarnation,
                    revision,
                };
                return respond(
                    &mut stream,
                    200,
                    "application/json",
                    &serde_json::to_vec(&observed)?,
                );
            }
            anyhow::ensure!(
                request.method == "POST" && request.route == "/inference",
                "unsupported operation"
            );
            let body: Value = serde_json::from_slice(&request.body)?;
            let key = TrustedManagedHostKey::new(&private, state.current.clone())?.credential()?;
            // Same fixture lifecycle lock covers fresh eligibility and one send.
            let response = runtime.block_on(async {
                http.post(&provider_url)
                    .header("Authorization", format!("Bearer {key}"))
                    .json(&body)
                    .send()
                    .await
            })?;
            let status = response.status();
            let kind = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_owned();
            let bytes = runtime.block_on(response.bytes())?;
            anyhow::ensure!(bytes.len() <= 1024 * 1024, "fixture upstream bound");
            if body["messages"][0]["content"] == "lost-response" {
                return Ok(());
            }
            if !status.is_success() {
                return respond(
                    &mut stream,
                    status.as_u16(),
                    "application/json",
                    b"{\"error\":\"sender unavailable\"}",
                );
            }
            // Fixture buffers a bounded response before exact redaction. It does
            // not establish production incremental-stream redaction semantics.
            let safe = String::from_utf8(bytes.to_vec())?.replace(&key, "[REDACTED]");
            respond(&mut stream, status.as_u16(), &kind, safe.as_bytes())
        })();
        if result.is_err() {
            let _ = respond(
                &mut stream,
                403,
                "application/json",
                b"{\"error\":\"sender denied\"}",
            );
        }
    }
}

fn deliver(private: &Path, binding: &ManagedHostKeyBinding) {
    let mut wire = serde_json::to_value(binding).unwrap();
    wire["version"] = json!(3);
    wire["credential_kind"] = json!("clerk_api_key");
    wire["scopes"] = json!(["managed:inference"]);
    wire["api_key"] = json!(std::fs::read_to_string(private.join("fixture-provider-key")).unwrap());
    nac_credential_store::write_auth_string_to_path(
        &private.join("bootstrap.json"),
        &wire.to_string(),
    )
    .unwrap();
}

fn new_revision() -> [u8; 32] {
    use sha2::Digest;
    // Independent random public marker; never a hash of the private key.
    sha2::Sha256::digest(uuid::Uuid::new_v4().as_bytes()).into()
}

fn control_operation(root: &Path, state: &mut State, command: &str) -> Result<()> {
    let private = root.join("authority");
    match command {
        "active-negative" => {
            let old = state.current.clone();
            let mut next = old.clone();
            next.bootstrap_id = "3712bc5e-30d5-421a-b416-8291d9f7d8f9".into();
            next.key_generation = 2;
            let before = std::fs::read(private.join("managed_host_key.json"))?;
            deliver(&private, &next);
            anyhow::ensure!(state
                .store
                .repair(&old, &next, &private.join("bootstrap.json"))
                .is_err());
            anyhow::ensure!(std::fs::read(private.join("managed_host_key.json"))? == before);
        }
        "revoke" => state.store.record_revocation(&state.current)?,
        "restore" => nac_credential_store::write_auth_string_to_path(
            &private.join("managed_host_key.json"),
            std::str::from_utf8(&state.saved)?,
        )?,
        "repair" => {
            let old = state.current.clone();
            let mut next = old.clone();
            next.bootstrap_id = "3712bc5e-30d5-421a-b416-8291d9f7d8f9".into();
            next.key_generation = 2;
            next.key_id = "fixture-provider-key-2".into();
            next.local_key_id = "10d61e35-4d17-4949-888f-5f153b03a53b".into();
            deliver(&private, &next);
            let empty = std::fs::read(private.join("managed_host_key.json"))?;
            // Restart before this control operation must recover a consumed,
            // unavailable predecessor, rather than import its stale mount.
            anyhow::ensure!(state.store.validate_local(&old).is_err());
            state.store.import(&old, &private.join("bootstrap.json"))?;
            anyhow::ensure!(state.store.validate_local(&old).is_err());
            anyhow::ensure!(std::fs::read(private.join("managed_host_key.json"))? == empty);
            let mut wrong = old.clone();
            wrong.pvc_uid = "spoofed".into();
            anyhow::ensure!(state
                .store
                .repair(&wrong, &next, &private.join("bootstrap.json"))
                .is_err());
            anyhow::ensure!(std::fs::read(private.join("managed_host_key.json"))? == empty);
            state
                .store
                .repair(&old, &next, &private.join("bootstrap.json"))?;
            std::fs::remove_file(private.join("bootstrap.json"))?;
            // Simulated lost acknowledgement: successor is already durable;
            // authorized duplicate after missing delivery retains exact history.
            let successor = std::fs::read(private.join("managed_host_key.json"))?;
            state
                .store
                .repair(&old, &next, &private.join("bootstrap.json"))?;
            anyhow::ensure!(std::fs::read(private.join("managed_host_key.json"))? == successor);
            state.current = next;
        }
        "restart-check" => {
            let receipt: Value = serde_json::from_slice(&std::fs::read(
                private.join("managed_host_key_receipt.json"),
            )?)?;
            anyhow::ensure!(receipt["key_generation"] == 2);
            let expected: ManagedHostKeyBinding = serde_json::from_value({
                let mut v = receipt;
                v.as_object_mut().unwrap().remove("version");
                v.as_object_mut().unwrap().remove("credential_kind");
                v.as_object_mut().unwrap().remove("scopes");
                v.as_object_mut().unwrap().remove("disposition");
                v
            })?;
            state.current = expected;
            state.store.validate_local(&state.current)?;
            anyhow::ensure!(state
                .store
                .import(&binding(), &private.join("bootstrap.json"))
                .is_err());
            anyhow::ensure!(state.grants.is_empty());
        }
        "stop" => {}
        _ => anyhow::bail!("unknown fixture control"),
    }
    Ok(())
}

pub(super) async fn prove_terminal_and_mcp(root: &Path) {
    let unique = uuid::Uuid::new_v4().to_string();
    let db = PathBuf::from(format!("/var/lib/nac/probe-{unique}.sqlite"));
    crate::store::initialize(&db).unwrap();
    crate::store::check_readiness(&db).unwrap();
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = PathBuf::from("/repositories");
    runtime.config_cwd = runtime.workspace_cwd.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &runtime.workspace_cwd);
    runtime.store_path = db;
    let session = format!("probe-{unique}");
    crate::store::insert_test_session(&runtime.store_path, &session);
    runtime.session_id = Some(session);
    let client = ModelClient::new_for_test();
    let file = format!("probe-{unique}.txt");
    let written = crate::tools::execute_tool(
        "write",
        json!({"path":file,"content":"retained ordinary workspace","expected_revision":null}),
        &runtime,
        &client,
    )
    .await;
    assert!(!written.is_error, "{}", written.content);
    let read = crate::tools::execute_tool("read", json!({"path":file}), &runtime, &client).await;
    assert!(!read.is_error && read.content.contains("retained ordinary workspace"));
    let manager = crate::terminal::TerminalManager::for_direct();
    let backend = crate::sandbox::execution_backend_from_sandbox(None, &root.join("nac"));
    let command=format!("test ! -r '{}/authority/managed_host_key.json' && test ! -r '{}/authority/bootstrap.json' && ! rm -f '{}/authority/managed_host_key.json' && ! sh -c 'echo replacement > \"{}/authority/bootstrap.json\"'",root.display(),root.display(),root.display(),root.display());
    let output = manager
        .exec_one_shot(
            &command,
            Some(root.join("nac")),
            80,
            24,
            5000,
            8000,
            &backend,
            None,
        )
        .await;
    assert_eq!(output.exit_code, Some(0));
    let ordinary = manager
        .exec_one_shot(
            "printf retained-home > /home/nac/probe-home; printf retained-output",
            Some(PathBuf::from("/repositories")),
            80,
            24,
            5000,
            8000,
            &backend,
            None,
        )
        .await;
    assert_eq!(ordinary.exit_code, Some(0));
    assert!(ordinary.stdout_preview.contains("retained-output"));
    let output_id = ordinary.output_id.unwrap();
    assert!(manager
        .read_output(&output_id, crate::terminal::OutputStream::Combined, 0, 1024)
        .is_ok());
    let name = manager.next_session_name();
    manager
        .create(
            name,
            "printf native-pty > /repositories/probe-pty",
            Some(PathBuf::from("/repositories")),
            80,
            24,
            &backend,
        )
        .await
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !Path::new("/repositories/probe-pty").exists() {
        assert!(std::time::Instant::now() < deadline, "PTY did not run");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    manager.settle_run().await.unwrap();
    assert_eq!(
        std::fs::read_to_string("/home/nac/probe-home").unwrap(),
        "retained-home"
    );
    let executable = std::env::current_exe().unwrap();
    let mut mcp = crate::mcp::test_support::stdio_command(
        executable.to_str().unwrap(),
        &[
            "--exact".into(),
            "model::client::tests::sender_prototype::sender_prototype_fixture_mcp".into(),
            "--ignored".into(),
            "--nocapture".into(),
        ],
        &Default::default(),
        &root.join("nac"),
    )
    .unwrap();
    mcp.env("NAC_SENDER_PROBE_ROOT", root);
    let output = mcp.output().await.unwrap();
    assert!(output.status.success());
    assert!(!String::from_utf8_lossy(&output.stdout).contains(KEY_PREFIX));
}

pub(super) async fn prove_worker_private_transport(root: &Path, proof: &FixtureProof) {
    use crate::worker_credentials::{
        prepare_worker_credential_channel, ManagedWorkerNativeCredentials,
    };
    let executable = std::env::current_exe().unwrap();
    let mut command = tokio::process::Command::new("/bin/sh");
    command.arg("-c").arg("while [ $# -gt 0 ]; do if [ \"$1\" = --native-credential-socket ]; then export NAC_SENDER_PROBE_CREDENTIAL_SOCKET=$2; break; fi; shift; done; exec \"$NAC_SENDER_PROBE_EXECUTABLE\" --exact model::client::tests::sender_prototype::sender_prototype_fixture_worker --ignored --nocapture").arg("fixture-worker");
    command
        .env("NAC_SENDER_PROBE_EXECUTABLE", executable)
        .env("NAC_SENDER_PROBE_ROOT", root);
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let channel = prepare_worker_credential_channel(&mut command).unwrap();
    let child = command.spawn().unwrap();
    let sender = channel.into_sender(child.id()).unwrap();
    let mut credentials = ManagedWorkerNativeCredentials::default();
    credentials.sender_prototype_grant = Some(serde_json::to_string(proof).unwrap());
    sender.send_after_ready(&credentials).await.unwrap();
    let output = child.wait_with_output().await.unwrap();
    assert!(
        output.status.success(),
        "worker failure: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains(&proof.proof));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(KEY_PREFIX));
}
