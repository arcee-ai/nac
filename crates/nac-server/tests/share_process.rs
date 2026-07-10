#![cfg(unix)]

use std::{
    fs,
    net::{Ipv4Addr as Ip, TcpListener},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const FAKE_NGROK: &str = r#"#!/bin/sh
set -eu
state=$NAC_FAKE_STATE
printf started > "$state/started"
printf '%s\n' "$@" > "$state/args"
stdin=eof
IFS= read -r ignored && stdin=data
printf '%s' "$stdin" > "$state/stdin"
printf 'fake ngrok stdout\n'
printf 'fake ngrok stderr\n' >&2
policy=
for argument in "$@"; do
  case "$argument" in
    --traffic-policy-file=*) policy=${argument#*=} ;;
  esac
done
if [ -n "$policy" ]; then
  [ -f "$policy" ] || exit 96
  printf '%s' "$policy" > "$state/policy"
fi
printf '%s' "$$" > "$state/pid"
IFS= read -r mode < "$state/mode"
trap '' TERM
case "$mode" in
  exit) exit 0 ;;
  hold) while [ ! -f "$state/release" ]; do /bin/sleep 0.05; done; exit 23 ;;
  signal-int) kill -INT "$PPID" ;;
  signal-term) /bin/sleep 30 & printf '%s' "$!" > "$state/descendant"; kill -TERM "$PPID" ;;
esac
while :; do /bin/sleep 1; done
"#;

struct Fixture(PathBuf);

impl Fixture {
    fn new(label: &str, mode: &str) -> Self {
        let root = std::env::temp_dir().join(format!("nac share {label} {}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::create_dir_all(root.join("tmp")).unwrap();
        let ngrok = root.join("bin/ngrok");
        fs::write(&ngrok, FAKE_NGROK).unwrap();
        fs::set_permissions(&ngrok, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(root.join("mode"), format!("{mode}\n")).unwrap();
        Self(root)
    }
    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    fn command(&self, port: u16) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_nac-web"));
        command
            .args(["share", "-C"])
            .arg(&self.0)
            .arg("--port")
            .arg(port.to_string())
            .env("PATH", self.file("bin"))
            .env("TMPDIR", self.file("tmp"))
            .env("NAC_HOME", &self.0)
            .env("NAC_FAKE_STATE", &self.0);
        command
    }
    fn text(&self, name: &str) -> String {
        fs::read_to_string(self.file(name)).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn wait_until(condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn unused_port() -> u16 {
    let listener = TcpListener::bind((Ip::LOCALHOST, 0)).unwrap();
    listener.local_addr().unwrap().port()
}

#[test]
fn authenticated_lifecycle() {
    let fixture = Fixture::new("authenticated lifecycle", "hold");
    let port = unused_port();
    let mut command = fixture.command(port);
    command
        .args(["--allow-email", "user@example.com"])
        .args(["--url", "https://nac.example.com"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command.spawn().unwrap();
    wait_until(|| fixture.file("policy").exists());
    let policy = PathBuf::from(fixture.text("policy"));
    let expected = format!(
        "http\nhttp://127.0.0.1:{port}\n--url=https://nac.example.com\n--traffic-policy-file={}\n--inspect=false\n",
        policy.display()
    );
    assert_eq!(fixture.text("args"), expected);
    assert!(policy.starts_with(fixture.file("tmp")) && policy.exists());
    assert_eq!(fs::metadata(&policy).unwrap().mode() & 0o777, 0o600);
    fs::write(fixture.file("release"), "").unwrap();
    let output = child.wait_with_output().unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("fake ngrok stdout"));
    assert!(stderr.contains("fake ngrok stderr") && stderr.contains("exit status: 23"));
    assert_eq!(fixture.text("stdin"), "eof");
    assert!(!policy.exists());
    TcpListener::bind((Ip::LOCALHOST, port)).unwrap();
}

#[test]
fn public_launch() {
    let fixture = Fixture::new("public", "exit");
    let port = unused_port();
    let output = fixture.command(port).arg("--public").output().unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{stderr}");
    let expected = format!("http\nhttp://127.0.0.1:{port}\n--inspect=false\n");
    assert_eq!(fixture.text("args"), expected);
    assert!(stderr.contains("WARNING: --public disables ngrok OAuth"));
    assert!(!fixture.file("policy").exists());
    assert_eq!(fs::read_dir(fixture.file("tmp")).unwrap().count(), 0);
}

#[test]
fn startup_failures() {
    for (label, missing, expected) in [
        ("occupied", false, "failed to bind"),
        ("missing executable", true, "https://ngrok.com/download"),
    ] {
        let fixture = Fixture::new(label, "exit");
        let listener = TcpListener::bind((Ip::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut command = fixture.command(port);
        command.args(["--allow-email", "user@example.com"]);
        if missing {
            drop(listener);
            fs::create_dir(fixture.file("empty-bin")).unwrap();
            command.env("PATH", fixture.file("empty-bin"));
        }
        let output = command.output().unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(!output.status.success(), "{label} unexpectedly succeeded");
        assert!(!fixture.file("started").exists());
        assert_eq!(fs::read_dir(fixture.file("tmp")).unwrap().count(), 0);
        assert!(stderr.contains(expected), "{label}: {stderr}");
    }
}

#[test]
fn immediate_signals() {
    for (signal, mode) in [("SIGINT", "signal-int"), ("SIGTERM", "signal-term")] {
        let fixture = Fixture::new(signal, mode);
        let port = unused_port();
        let mut command = fixture.command(port);
        command.args(["--allow-domain", "example.com"]);
        let output = command.output().unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "{signal}: {stderr}");
        assert!(!Path::new(&fixture.text("policy")).exists());
        let child = fixture.text("pid").parse().unwrap();
        wait_until(|| unsafe { libc::kill(child, 0) != 0 });
        wait_until(|| unsafe { libc::killpg(child, 0) != 0 });
        if signal == "SIGTERM" {
            let descendant = fixture.text("descendant").parse().unwrap();
            wait_until(|| unsafe { libc::kill(descendant, 0) != 0 });
        }
        TcpListener::bind((Ip::LOCALHOST, port)).unwrap();
    }
}
