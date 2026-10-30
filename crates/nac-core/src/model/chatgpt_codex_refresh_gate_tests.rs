//! Runtime-liveness regressions for the Codex credential refresh gate.
//!
//! A refresh holds the auth lock across its token request. Callers queued
//! behind it must wait on the async gate, never inside flock(2): once blocked
//! flock waiters occupy every Tokio worker, the holder is never polled again,
//! its finished token request is never observed and the runtime wedges for
//! good. Each scenario runs in a re-executed test process so `NAC_HOME` stays
//! isolated and a wedged runtime is discarded with the process.

use super::*;
use fs2::FileExt;
use std::io::{BufRead, BufReader};
use std::net::{Shutdown, SocketAddr, TcpListener as StdTcpListener, TcpStream as StdTcpStream};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};

const HELPER_ENV: &str = "NAC_CODEX_REFRESH_GATE_HELPER";
const HELPER_TEST: &str =
    "model::chatgpt_codex::refresh_gate_tests::codex_refresh_gate_process_helper";

/// Stands in for auth.openai.com: accepts the TLS client and never answers
/// until released; afterwards held and new connections are closed at once.
struct StalledTokenEndpoint {
    addr: SocketAddr,
    accepted: mpsc::Receiver<()>,
    state: Arc<Mutex<(bool, Vec<StdTcpStream>)>>,
}

impl StalledTokenEndpoint {
    fn start() -> Self {
        let listener = StdTcpListener::bind("127.0.0.1:0").unwrap();
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

    fn release(&self) {
        let mut state = self.state.lock().unwrap();
        state.0 = true;
        for stream in state.1.drain(..) {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }
}

fn lock_is_held_elsewhere(path: &Path) -> bool {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .unwrap();
    match FileExt::try_lock_exclusive(&file) {
        Ok(()) => {
            FileExt::unlock(&file).unwrap();
            false
        }
        Err(_) => true,
    }
}

fn write_expired_auth(home: &Path) {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(home.join("auth.json"))
        .unwrap();
    file.write_all(
        br#"{"type":"chatgpt-codex","access":"gate-access","refresh":"gate-refresh","expires_at_ms":1,"account_id":"gate-account"}"#,
    )
    .unwrap();
}

#[derive(Clone, Copy)]
enum Contender {
    Refresh,
    Logout,
    Login,
}

impl Contender {
    fn parse(value: &str) -> Self {
        match value {
            "refresh" => Self::Refresh,
            "logout" => Self::Logout,
            "login" => Self::Login,
            other => panic!("unknown contender {other}"),
        }
    }

    async fn run(self, client: &Client) {
        match self {
            Self::Refresh => drop(fresh_auth(client).await),
            Self::Logout => drop(codex_auth_remove().await),
            Self::Login => {
                let claims = base64_url_encode(br#"{"chatgpt_account_id":"login-account"}"#);
                let tokens = TokenResponse {
                    id_token: Some(format!("e30.{claims}.signature")),
                    access_token: "login-access".to_string(),
                    refresh_token: "login-refresh".to_string(),
                    expires_in: Some(3600),
                };
                drop(store_tokens(tokens).await);
            }
        }
    }
}

/// Child-process body. `NAC_CODEX_REFRESH_GATE_HELPER=<contender>:<workers>:<count>`.
#[test]
fn codex_refresh_gate_process_helper() {
    let Ok(mode) = std::env::var(HELPER_ENV) else {
        return;
    };
    let fields = mode.split(':').collect::<Vec<_>>();
    let contender = Contender::parse(fields[0]);
    let workers: usize = fields[1].parse().unwrap();
    let contenders: usize = fields[2].parse().unwrap();
    let home = crate::paths::nac_home_dir().unwrap();
    write_expired_auth(&home);

    let endpoint = StalledTokenEndpoint::start();
    let client = Client::builder()
        .resolve("auth.openai.com", endpoint.addr)
        .build()
        .unwrap();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()
        .unwrap();
    let (done_tx, done_rx) = mpsc::channel::<()>();

    // 1. A model request finds the token near expiry and holds the auth lock
    //    across its (stalled) refresh request.
    let holder_client = client.clone();
    let holder_done = done_tx.clone();
    runtime.spawn(async move {
        let _ = fresh_auth(&holder_client).await;
        let _ = holder_done.send(());
    });
    endpoint
        .accepted
        .recv_timeout(Duration::from_secs(10))
        .expect("holder never reached the token endpoint");
    assert!(
        lock_is_held_elsewhere(&auth_lock_path().unwrap()),
        "holder must own the auth lock while its refresh is pending"
    );
    println!("GATE holder_refreshing");

    // 2. Concurrent callers on the same runtime need the same credential.
    let entered = Arc::new(AtomicUsize::new(0));
    for _ in 0..contenders {
        let client = client.clone();
        let done = done_tx.clone();
        let entered = Arc::clone(&entered);
        runtime.spawn(async move {
            entered.fetch_add(1, Ordering::SeqCst);
            contender.run(&client).await;
            let _ = done.send(());
        });
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while entered.load(Ordering::SeqCst) < contenders.min(workers) {
        assert!(
            std::time::Instant::now() < deadline,
            "contenders never started"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    std::thread::sleep(Duration::from_millis(300));

    // 3. While the refresh is stalled, unrelated work keeps running and no
    //    queued caller starts a second token request.
    let (tick_tx, tick_rx) = mpsc::channel();
    runtime.spawn(async move {
        for _ in 0..5 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let _ = tick_tx.send(());
    });
    let progressed = tick_rx.recv_timeout(Duration::from_secs(2)).is_ok();
    println!("GATE unrelated_progress={progressed}");
    println!(
        "GATE extra_token_requests={}",
        endpoint.accepted.try_iter().count()
    );

    // 4. Complete the holder's refresh I/O (connection closed -> fast error).
    endpoint.release();
    let expected = contenders + 1;
    let mut finished = 0;
    let started = std::time::Instant::now();
    let deadline = started + Duration::from_secs(5);
    while finished < expected {
        match done_rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
            Ok(()) => finished += 1,
            Err(_) => break,
        }
    }
    println!(
        "GATE finished={finished}/{expected} after_ms={}",
        started.elapsed().as_millis()
    );
    let stored = read_auth_file_optional().ok().flatten();
    println!(
        "GATE stored_access={}",
        stored.map_or_else(|| "none".to_string(), |auth| auth.access)
    );
    std::io::stdout().flush().unwrap();
    // A regressed runtime may have workers parked inside flock(2); never drop it.
    std::process::exit(0);
}

fn run_helper(mode: &str) -> String {
    let home = std::env::temp_dir().join(format!("nac-codex-refresh-gate-{}", Uuid::new_v4()));
    fs::create_dir_all(&home).unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", HELPER_TEST, "--nocapture", "--test-threads=1"])
        .env(HELPER_ENV, mode)
        .env("NAC_HOME", &home)
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
    let deadline = std::time::Instant::now() + Duration::from_secs(40);
    let mut output = String::new();
    loop {
        while let Ok(line) = line_rx.try_recv() {
            output.push_str(&line);
            output.push('\n');
        }
        if child.try_wait().unwrap().is_some() {
            break;
        }
        if std::time::Instant::now() >= deadline {
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
    let _ = fs::remove_dir_all(&home);
    eprintln!("{output}");
    output
}

fn assert_runtime_stayed_live(output: &str, expected_finished: usize) {
    assert!(output.contains("GATE holder_refreshing"), "{output}");
    assert!(output.contains("GATE unrelated_progress=true"), "{output}");
    assert!(output.contains("GATE extra_token_requests=0"), "{output}");
    assert!(
        output.contains(&format!(
            "GATE finished={expected_finished}/{expected_finished}"
        )),
        "{output}"
    );
}

/// Two workers, two queued model requests: before the gate both workers parked
/// in flock(2), the holder's finished refresh was never polled and 0/3 ended.
#[test]
fn queued_codex_refreshes_do_not_wedge_a_two_worker_runtime() {
    let output = run_helper("refresh:2:2");
    assert_runtime_stayed_live(&output, 3);
}

/// Production shape: default `#[tokio::main]` worker count, one queued model
/// request per worker.
#[test]
fn queued_codex_refreshes_do_not_wedge_a_default_sized_runtime() {
    let workers = std::thread::available_parallelism().unwrap().get();
    let output = run_helper(&format!("refresh:{workers}:{workers}"));
    assert_runtime_stayed_live(&output, workers + 1);
}

/// Logout waits for the in-flight refresh on the gate, then removes the
/// credential the refresh failed to replace.
#[test]
fn codex_logout_queued_behind_a_stalled_refresh_keeps_workers_free() {
    let output = run_helper("logout:2:2");
    assert_runtime_stayed_live(&output, 3);
    assert!(output.contains("GATE stored_access=none"), "{output}");
}

/// A completed sign-in is stored after the in-flight refresh settles instead
/// of parking a worker until it does.
#[test]
fn codex_login_queued_behind_a_stalled_refresh_keeps_workers_free() {
    let output = run_helper("login:2:2");
    assert_runtime_stayed_live(&output, 3);
    assert!(
        output.contains("GATE stored_access=login-access"),
        "{output}"
    );
}
