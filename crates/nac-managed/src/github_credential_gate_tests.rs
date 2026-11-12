//! Runtime-liveness regressions for the managed GitHub credential gate.
//!
//! A token refresh holds the credential lock across its HTTP request. The 401
//! paths and DELETE /managed/github must queue behind it on the async gate,
//! never inside flock(2): once blocked flock waiters occupy every Tokio worker,
//! the refresh holder is never polled again and the process wedges for good.
//! Each scenario runs in a re-executed test process so a wedged runtime is
//! discarded with the process instead of hanging the suite.

use super::*;
use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Instant;

const HELPER_ENV: &str = "NAC_GITHUB_CREDENTIAL_GATE_HELPER";
const HELPER_TEST: &str = "github::credential_gate_tests::github_credential_gate_process_helper";

/// Stands in for the GitHub token endpoint: accepts the refresh request and
/// never answers until released; afterwards held and new connections close.
struct StalledTokenEndpoint {
    addr: SocketAddr,
    accepted: mpsc::Receiver<()>,
    state: Arc<Mutex<(bool, Vec<TcpStream>)>>,
}

impl StalledTokenEndpoint {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (accepted_tx, accepted) = mpsc::channel();
        let state = Arc::new(Mutex::new((false, Vec::new())));
        let accept_state = Arc::clone(&state);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let mut state = accept_state.lock().unwrap();
                if state.0 {
                    let _ = stream.shutdown(Shutdown::Both);
                } else {
                    state.1.push(stream);
                    let _ = accepted_tx.send(());
                }
            }
        });
        Self {
            addr,
            accepted,
            state,
        }
    }

    fn endpoints(&self) -> GitHubEndpoints {
        let base = Url::parse(&format!("http://{}/", self.addr)).unwrap();
        GitHubEndpoints {
            device_code_url: base.join("login/device/code").unwrap(),
            token_url: base.join("login/oauth/access_token").unwrap(),
            api_base_url: base,
        }
    }

    fn release(&self) {
        let mut state = self.state.lock().unwrap();
        state.0 = true;
        for stream in state.1.drain(..) {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }
}

#[derive(Clone, Copy)]
enum Contender {
    Disconnect,
    ForceExpiry,
}

impl Contender {
    fn parse(value: &str) -> Self {
        match value {
            "disconnect" => Self::Disconnect,
            "expiry" => Self::ForceExpiry,
            other => panic!("unknown contender {other}"),
        }
    }

    async fn run(self, auth: &ManagedGitHubAuth) {
        match self {
            Self::Disconnect => drop(auth.disconnect().await),
            Self::ForceExpiry => drop(auth.force_access_expiry().await),
        }
    }
}

/// Child-process body. `NAC_GITHUB_CREDENTIAL_GATE_HELPER=<contender>:<workers>:<count>`.
#[test]
fn github_credential_gate_process_helper() {
    let Ok(mode) = std::env::var(HELPER_ENV) else {
        return;
    };
    let fields = mode.split(':').collect::<Vec<_>>();
    let contender = Contender::parse(fields[0]);
    let workers: usize = fields[1].parse().unwrap();
    let contenders: usize = fields[2].parse().unwrap();
    let root = std::env::temp_dir().join(format!(
        "nac-github-credential-gate-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let endpoint = StalledTokenEndpoint::start();
    let auth = Arc::new(
        ManagedGitHubAuth::with_endpoints(&root, "Iv1.gate", endpoint.endpoints()).unwrap(),
    );
    // Expired access token, valid refresh token: the next request refreshes.
    auth.store_test_authorization("expired-access", "gate-refresh", 0)
        .unwrap();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()
        .unwrap();
    let (done_tx, done_rx) = mpsc::channel::<()>();

    // 1. A GitHub API call refreshes and holds the credential lock across its
    //    (stalled) token request.
    let holder = Arc::clone(&auth);
    let holder_done = done_tx.clone();
    runtime.spawn(async move {
        let _ = holder.current_token().await;
        let _ = holder_done.send(());
    });
    endpoint
        .accepted
        .recv_timeout(Duration::from_secs(10))
        .expect("refresh never reached the token endpoint");
    println!("GATE holder_refreshing");

    // 2. Concurrent 401 handling / DELETE /managed/github on the same runtime.
    let entered = Arc::new(AtomicUsize::new(0));
    for _ in 0..contenders {
        let auth = Arc::clone(&auth);
        let done = done_tx.clone();
        let entered = Arc::clone(&entered);
        runtime.spawn(async move {
            entered.fetch_add(1, Ordering::SeqCst);
            contender.run(&auth).await;
            let _ = done.send(());
        });
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    while entered.load(Ordering::SeqCst) < contenders.min(workers) {
        assert!(Instant::now() < deadline, "contenders never started");
        std::thread::sleep(Duration::from_millis(5));
    }
    std::thread::sleep(Duration::from_millis(300));

    // 3. While the refresh is stalled, unrelated work keeps running.
    let (tick_tx, tick_rx) = mpsc::channel();
    runtime.spawn(async move {
        for _ in 0..5 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let _ = tick_tx.send(());
    });
    let progressed = tick_rx.recv_timeout(Duration::from_secs(2)).is_ok();
    println!("GATE unrelated_progress={progressed}");

    // 4. Complete the refresh I/O (connection closed -> fast error).
    endpoint.release();
    let expected = contenders + 1;
    let mut finished = 0;
    let started = Instant::now();
    let bound = started + Duration::from_secs(5);
    while finished < expected {
        match done_rx.recv_timeout(bound.saturating_duration_since(Instant::now())) {
            Ok(()) => finished += 1,
            Err(_) => break,
        }
    }
    println!(
        "GATE finished={finished}/{expected} after_ms={}",
        started.elapsed().as_millis()
    );
    let stored = auth.store.load(ORGANIZATION).ok().flatten();
    println!(
        "GATE stored_access_expires_at_ms={}",
        stored.map_or_else(
            || "none".to_string(),
            |stored| stored.access_expires_at_ms.to_string()
        )
    );
    std::io::stdout().flush().unwrap();
    let _ = std::fs::remove_dir_all(&root);
    // A regressed runtime may have workers parked inside flock(2); never drop it.
    std::process::exit(0);
}

fn run_helper(mode: &str) -> String {
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", HELPER_TEST, "--nocapture", "--test-threads=1"])
        .env(HELPER_ENV, mode)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let (line_tx, line_rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = line_tx.send(line);
        }
    });
    let deadline = Instant::now() + Duration::from_secs(40);
    let mut output = String::new();
    loop {
        while let Ok(line) = line_rx.try_recv() {
            output.push_str(&line);
            output.push('\n');
        }
        if child.try_wait().unwrap().is_some() {
            break;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            let _ = child.wait();
            output.push_str("GATE helper_killed_after_bound\n");
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    std::thread::sleep(Duration::from_millis(50));
    while let Ok(line) = line_rx.try_recv() {
        output.push_str(&line);
        output.push('\n');
    }
    eprintln!("{output}");
    output
}

fn assert_runtime_stayed_live(output: &str, expected_finished: usize) {
    assert!(output.contains("GATE holder_refreshing"), "{output}");
    assert!(output.contains("GATE unrelated_progress=true"), "{output}");
    assert!(
        output.contains(&format!(
            "GATE finished={expected_finished}/{expected_finished}"
        )),
        "{output}"
    );
}

/// Two workers, two DELETE /managed/github requests during a stalled refresh:
/// before the gate both workers parked in flock(2) and 0/3 ever finished.
#[test]
fn disconnect_during_a_stalled_refresh_keeps_a_two_worker_runtime_live() {
    let output = run_helper("disconnect:2:2");
    assert_runtime_stayed_live(&output, 3);
    assert!(
        output.contains("GATE stored_access_expires_at_ms=none"),
        "{output}"
    );
}

/// The first-401 path forces access expiry behind the same stalled refresh.
#[test]
fn forced_expiry_during_a_stalled_refresh_keeps_a_two_worker_runtime_live() {
    let output = run_helper("expiry:2:2");
    assert_runtime_stayed_live(&output, 3);
    assert!(
        output.contains("GATE stored_access_expires_at_ms=0"),
        "{output}"
    );
}

/// Another process holding the credential lock fails a waiter at the deadline
/// instead of stalling it forever; the async waits never park the runtime.
#[tokio::test]
async fn credential_lock_waits_end_at_the_deadline_while_another_process_holds_it() {
    let root = std::env::temp_dir().join(format!(
        "nac-github-credential-deadline-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let mut auth = ManagedGitHubAuth::new(&root, "Iv1.deadline").unwrap();
    auth.lock_timeout = Duration::from_millis(200);
    auth.store_test_authorization("fresh-access", "fresh-refresh", u64::MAX)
        .unwrap();
    // A distinct open file description stands in for another nac process.
    let held = nac_credential_store::try_acquire_credential_lock(
        &root.join("managed_github_auth.json.lock"),
    )
    .unwrap()
    .expect("uncontended credential lock");

    for (label, result) in [
        (
            "current_token",
            tokio::time::timeout(Duration::from_secs(5), auth.current_token())
                .await
                .map(|result| result.map(|_| ())),
        ),
        (
            "disconnect",
            tokio::time::timeout(Duration::from_secs(5), auth.disconnect())
                .await
                .map(|result| result.map(|_| ())),
        ),
    ] {
        let error = result
            .unwrap_or_else(|_| panic!("{label} never gave up on the held lock"))
            .expect_err("credential lock acquired while held elsewhere");
        assert!(
            error
                .to_string()
                .contains("timed out waiting for the managed GitHub credential lock"),
            "{label}: {error:#}"
        );
    }
    assert!(
        auth.status().unwrap().connected,
        "nothing may change without the lock"
    );

    drop(held);
    assert_eq!(
        auth.current_token().await.unwrap().unwrap().secret(),
        "fresh-access"
    );
    assert!(auth.disconnect().await.unwrap());
    let _ = std::fs::remove_dir_all(root);
}
