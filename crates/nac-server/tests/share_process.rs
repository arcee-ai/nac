#![cfg(unix)]

use std::{
    fs,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const FAKE_NGROK: &str = r#"#!/bin/sh
set -u
if [ "${NAC_FAKE_MODE:-exit}" = signal_parent_int ] || [ "${NAC_FAKE_MODE:-exit}" = signal_parent_term ]; then
  descendant=
  trap 'printf term > "$NAC_FAKE_TERM"; if [ -n "$descendant" ]; then wait "$descendant" 2>/dev/null || true; fi; exit 0' TERM INT
  printf started > "$NAC_FAKE_STARTED"
  printf 1 > "$NAC_FAKE_COUNT"
  printf '%s' "$$" > "$NAC_FAKE_PID"
  for argument in "$@"; do
    case "$argument" in
      --traffic-policy-file=*) policy=${argument#--traffic-policy-file=}; [ -f "$policy" ] || exit 96; printf '%s' "$policy" > "$NAC_FAKE_POLICY_PATH" ;;
    esac
  done
  if [ "$NAC_FAKE_MODE" = signal_parent_term ]; then
    sleep 30 & descendant=$!
    printf '%s' "$descendant" > "$NAC_FAKE_DESCENDANT"
    kill -TERM "$PPID"
  else
    kill -INT "$PPID"
  fi
  ticks=0
  while [ "$ticks" -lt 100 ]; do sleep 0.05; ticks=$((ticks + 1)); done
  exit 97
fi
printf started > "$NAC_FAKE_STARTED"
count=0
if [ -f "$NAC_FAKE_COUNT" ]; then count=$(cat "$NAC_FAKE_COUNT"); fi
count=$((count + 1))
printf '%s' "$count" > "$NAC_FAKE_COUNT"
printf '%s\n' "$@" > "$NAC_FAKE_ARGS"
if IFS= read -r ignored; then printf data > "$NAC_FAKE_STDIN"; else printf eof > "$NAC_FAKE_STDIN"; fi
printf 'arbitrary non-JSON output {not-json}\n'
printf 'fake ngrok diagnostic [not-json]\n' >&2
policy=
for argument in "$@"; do
  case "$argument" in
    --traffic-policy-file=*) policy=${argument#--traffic-policy-file=} ;;
  esac
done
if [ -n "$policy" ]; then
  printf '%s' "$policy" > "$NAC_FAKE_POLICY_PATH"
  cat "$policy" > "$NAC_FAKE_POLICY_COPY"
fi
printf '%s' "$$" > "$NAC_FAKE_PID"
printf ready > "$NAC_FAKE_READY"
case "${NAC_FAKE_MODE:-exit}" in
  hold)
    while [ ! -f "$NAC_FAKE_RELEASE" ]; do sleep 0.05; done
    ;;
  term)
    trap 'printf term > "$NAC_FAKE_TERM"; exit 0' TERM INT
    while :; do sleep 0.05; done
    ;;
esac
exit "${NAC_FAKE_EXIT:-0}"
"#;

struct Fixture {
    root: PathBuf,
    bin: PathBuf,
    tmp: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nac_share_process_{label}_{}_{}",
            std::process::id(),
            unique
        ));
        let bin = root.join("bin");
        let tmp = root.join("tmp");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&tmp).unwrap();
        fs::create_dir_all(root.join("nac-home")).unwrap();
        let ngrok = bin.join("ngrok");
        fs::write(&ngrok, FAKE_NGROK).unwrap();
        fs::set_permissions(&ngrok, fs::Permissions::from_mode(0o700)).unwrap();
        Self { root, bin, tmp }
    }

    fn file(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_nac-web"));
        command
            .arg("share")
            .arg("-C")
            .arg(&self.root)
            .arg("--store-path")
            .arg(self.file("store.db"))
            .env("PATH", format!("{}:/usr/bin:/bin", self.bin.display()))
            .env("TMPDIR", &self.tmp)
            .env("NAC_HOME", self.file("nac-home"))
            .env("NAC_FAKE_STARTED", self.file("started"))
            .env("NAC_FAKE_COUNT", self.file("count"))
            .env("NAC_FAKE_ARGS", self.file("args"))
            .env("NAC_FAKE_STDIN", self.file("stdin"))
            .env("NAC_FAKE_POLICY_PATH", self.file("policy-path"))
            .env("NAC_FAKE_POLICY_COPY", self.file("policy-copy"))
            .env("NAC_FAKE_PID", self.file("pid"))
            .env("NAC_FAKE_DESCENDANT", self.file("descendant"))
            .env("NAC_FAKE_READY", self.file("ready"))
            .env("NAC_FAKE_RELEASE", self.file("release"))
            .env("NAC_FAKE_TERM", self.file("term"));
        command
    }

    fn args(&self) -> Vec<String> {
        fs::read_to_string(self.file("args"))
            .unwrap()
            .lines()
            .map(str::to_string)
            .collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn wait_for(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !path.exists() {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {}",
            path.display()
        );
        thread::sleep(Duration::from_millis(20));
    }
}

fn output_text(output: &Output) -> (String, String) {
    (
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

fn assert_target(argument: &str, expected_port: Option<u16>) {
    let port = argument
        .strip_prefix("http://127.0.0.1:")
        .expect("loopback target")
        .parse::<u16>()
        .expect("numeric port");
    assert_ne!(port, 0);
    if let Some(expected) = expected_port {
        assert_eq!(port, expected);
    }
}

fn unused_port() -> u16 {
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[test]
fn authenticated_generated_argv_policy_is_private_live_and_cleaned() {
    let fixture = Fixture::new("authenticated");
    let mut command = fixture.command();
    command
        .args(["--allow-email", " Admin@Example.com "])
        .args(["--allow-domain", "@Example.org"])
        .env("NAC_FAKE_MODE", "hold")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command.spawn().unwrap();
    wait_for(&fixture.file("ready"));

    let args = fixture.args();
    assert_eq!(args[0], "http");
    assert_target(&args[1], None);
    assert!(args[2].starts_with("--traffic-policy-file="));
    assert_eq!(args[3], "--inspect=false");
    assert_eq!(args.len(), 4);
    let policy_path = PathBuf::from(fs::read_to_string(fixture.file("policy-path")).unwrap());
    assert!(policy_path.exists());
    assert_eq!(fs::metadata(&policy_path).unwrap().mode() & 0o777, 0o600);
    let policy = fs::read_to_string(fixture.file("policy-copy")).unwrap();
    assert!(policy.contains("\"provider\":\"google\""));
    assert!(policy.contains("admin@example.com"));
    assert!(policy.contains("endsWith('@example.org')"));

    fs::write(fixture.file("release"), "release").unwrap();
    let output = child.wait_with_output().unwrap();
    let (stdout, stderr) = output_text(&output);
    assert!(output.status.success(), "{stderr}");
    assert!(stdout.contains("arbitrary non-JSON output"));
    assert!(stderr.contains("fake ngrok diagnostic"));
    assert_eq!(fs::read_to_string(fixture.file("stdin")).unwrap(), "eof");
    assert!(!policy_path.exists());
}

#[test]
fn custom_url_argv_nonzero_is_terminal_and_releases_server() {
    let fixture = Fixture::new("custom_nonzero");
    let port = unused_port();
    let output = fixture
        .command()
        .args(["--port", &port.to_string()])
        .args(["--allow-email", "user@example.com"])
        .arg("--worker-executable")
        .arg(env!("CARGO_BIN_EXE_nac-web"))
        .args(["--url", "https://nac.example.com"])
        .env("NAC_FAKE_EXIT", "23")
        .output()
        .unwrap();

    assert!(!output.status.success());
    let args = fixture.args();
    assert_eq!(args[0], "http");
    assert_target(&args[1], Some(port));
    assert_eq!(args[2], "--url=https://nac.example.com");
    assert!(args[3].starts_with("--traffic-policy-file="));
    assert_eq!(args[4], "--inspect=false");
    assert_eq!(args.len(), 5);
    assert_eq!(fs::read_to_string(fixture.file("count")).unwrap(), "1");
    let (_, stderr) = output_text(&output);
    assert!(stderr.contains("ngrok exited with status"));
    let policy_path = fs::read_to_string(fixture.file("policy-path")).unwrap();
    assert!(!Path::new(&policy_path).exists());
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).unwrap();
}

#[test]
fn public_argv_has_no_policy_and_prints_warning() {
    let fixture = Fixture::new("public");
    let output = fixture.command().arg("--public").output().unwrap();

    let (_, stderr) = output_text(&output);
    assert!(output.status.success(), "{stderr}");
    let args = fixture.args();
    assert_eq!(args[0], "http");
    assert_target(&args[1], None);
    assert_eq!(&args[2..], ["--inspect=false"]);
    assert!(stderr.contains("WARNING: --public disables ngrok OAuth"));
    assert!(!fixture.file("policy-path").exists());
    assert!(fs::read_dir(&fixture.tmp).unwrap().next().is_none());
}

#[test]
fn missing_ngrok_has_install_guidance_and_cleans_policy() {
    let fixture = Fixture::new("missing");
    let empty_path = fixture.file("empty-path");
    fs::create_dir(&empty_path).unwrap();
    let output = fixture
        .command()
        .args(["--allow-email", "user@example.com"])
        .env("PATH", &empty_path)
        .output()
        .unwrap();

    let (_, stderr) = output_text(&output);
    assert!(!output.status.success());
    assert!(stderr.contains("install the ngrok CLI from https://ngrok.com/download"));
    assert!(fs::read_dir(&fixture.tmp).unwrap().next().is_none());
}

#[test]
fn occupied_port_and_invalid_allowlist_never_spawn_ngrok() {
    let occupied = Fixture::new("occupied");
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let output = occupied
        .command()
        .args(["--port", &port.to_string()])
        .args(["--allow-email", "user@example.com"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!occupied.file("started").exists());

    let invalid = Fixture::new("invalid_allowlist");
    let output = invalid
        .command()
        .args(["--allow-email", "bad'user@example.com"])
        .output()
        .unwrap();
    let (_, stderr) = output_text(&output);
    assert!(!output.status.success());
    assert!(stderr.contains("invalid allowed email"));
    assert!(!invalid.file("started").exists());
}

#[test]
fn immediate_child_ctrl_c_is_caught_and_cleans_up_successfully() {
    let fixture = Fixture::new("immediate_ctrl_c");
    let port = unused_port();
    let output = fixture
        .command()
        .args(["--port", &port.to_string()])
        .args(["--allow-domain", "example.com"])
        .env("NAC_FAKE_MODE", "signal_parent_int")
        .output()
        .unwrap();

    let (_, stderr) = output_text(&output);
    assert!(output.status.success(), "{stderr}");
    assert_eq!(fs::read_to_string(fixture.file("count")).unwrap(), "1");
    assert_eq!(fs::read_to_string(fixture.file("term")).unwrap(), "term");
    assert!(fs::read_dir(&fixture.tmp).unwrap().next().is_none());
    let fake_pid = fs::read_to_string(fixture.file("pid"))
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    assert_ne!(unsafe { libc::kill(fake_pid, 0) }, 0);
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).unwrap();
}

#[test]
fn immediate_child_sigterm_is_caught_and_cleans_process_group() {
    let fixture = Fixture::new("immediate_sigterm");
    let port = unused_port();
    let output = fixture
        .command()
        .args(["--port", &port.to_string()])
        .args(["--allow-domain", "example.com"])
        .env("NAC_FAKE_MODE", "signal_parent_term")
        .output()
        .unwrap();

    let (_, stderr) = output_text(&output);
    assert!(output.status.success(), "{stderr}");
    assert_eq!(fs::read_to_string(fixture.file("term")).unwrap(), "term");
    let policy_path = fs::read_to_string(fixture.file("policy-path")).unwrap();
    assert!(!Path::new(&policy_path).exists());
    assert!(fs::read_dir(&fixture.tmp).unwrap().next().is_none());
    let fake_pid = fs::read_to_string(fixture.file("pid"))
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    let descendant = fs::read_to_string(fixture.file("descendant"))
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    assert_ne!(unsafe { libc::kill(fake_pid, 0) }, 0);
    assert_ne!(unsafe { libc::kill(descendant, 0) }, 0);
    assert_ne!(unsafe { libc::killpg(fake_pid, 0) }, 0);
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).unwrap();
}

#[test]
fn ctrl_c_terminates_child_cleans_policy_and_releases_server() {
    let fixture = Fixture::new("ctrl_c");
    let port = unused_port();
    let mut command = fixture.command();
    command
        .args(["--port", &port.to_string()])
        .args(["--allow-domain", "example.com"])
        .env("NAC_FAKE_MODE", "term")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command.spawn().unwrap();
    wait_for(&fixture.file("ready"));
    let policy_path = fs::read_to_string(fixture.file("policy-path")).unwrap();
    let fake_pid = fs::read_to_string(fixture.file("pid"))
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();

    assert_eq!(
        unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT) },
        0
    );
    let output = child.wait_with_output().unwrap();
    let (_, stderr) = output_text(&output);
    assert!(output.status.success(), "{stderr}");
    wait_for(&fixture.file("term"));
    assert_eq!(fs::read_to_string(fixture.file("count")).unwrap(), "1");
    assert!(!Path::new(&policy_path).exists());
    assert_ne!(unsafe { libc::kill(fake_pid, 0) }, 0);
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).unwrap();
}

#[test]
fn rejects_non_origin_urls_and_public_allowlist_conflict_without_spawn() {
    let invalid_urls = [
        "http://nac.example.com",
        "https://user@nac.example.com",
        "https://nac.example.com:8443",
        "https://nac.example.com/",
        "https://nac.example.com/path",
        "https://nac.example.com?query=yes",
        "https://nac.example.com#fragment",
        "https://bad_host.example",
        "https://-bad.example",
        "https://bad-.example",
        "https://bad..example",
        "https://.bad.example",
        "https://bad.example.",
    ];
    for (index, url) in invalid_urls.into_iter().enumerate() {
        let fixture = Fixture::new(&format!("invalid_url_{index}"));
        let output = fixture
            .command()
            .args(["--public", "--url", url])
            .output()
            .unwrap();
        assert!(!output.status.success(), "accepted {url}");
        assert!(!fixture.file("started").exists());
    }

    let fixture = Fixture::new("public_conflict");
    let output = fixture
        .command()
        .args(["--public", "--allow-email", "user@example.com"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!fixture.file("started").exists());
}
