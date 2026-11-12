//! Where the server comes from: `--server URL` attaches to a running `nac-web`; otherwise the
//! app starts its own `nac-web` child and stops it on quit.
//!
//! The child is launched the way the Swift app does (`desktop/macos/PreviewEngine.swift`,
//! `crates/nac-server/src/desktop_launch.rs`):
//!
//! 1. `nac-web __desktop-identity` prints the build identity.
//! 2. `nac-web __desktop-configuration --directory DIR [--store-path P]`, run with DIR as its
//!    working directory, prints the selected working directory and store.
//! 3. `nac-web --bind 127.0.0.1:0 --directory DIR --store-path STORE --worker-executable EXE
//!    --no-open` starts with one end of a Unix socket pair, named by `NAC_DESKTOP_CHANNEL_FD`.
//! 4. The app writes a `hello` record (identity, a fresh UUID, the store); the server answers
//!    `ready` with its endpoint once it listens. A `stop` record, or the socket closing because
//!    the app died, shuts the server down.
//!
//! When `nac-web` has no `__desktop-identity` (an older build) or the platform has no Unix
//! sockets, the fallback picks a free loopback port, passes `--bind 127.0.0.1:PORT --no-open`,
//! and polls `GET /readyz`.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::api::Client;

#[derive(Clone, Debug, Default)]
pub struct Options {
    pub server: Option<String>,
    pub nac_web: Option<PathBuf>,
    pub directory: Option<PathBuf>,
    pub store_path: Option<PathBuf>,
}

struct Running {
    child: Child,
    #[cfg(unix)]
    channel: Option<(std::os::unix::net::UnixStream, String)>,
}

static CHILD: Mutex<Option<Running>> = Mutex::new(None);

/// The server's base URL. Blocks until the server is ready; call it off the UI thread.
pub fn start(options: &Options) -> Result<String, String> {
    if let Some(url) = &options.server {
        let url = url.trim_end_matches('/').to_owned();
        Client::new(&url).ready().map_err(|e| format!("{url} did not answer /readyz: {e}"))?;
        return Ok(url);
    }
    let exe = locate(options)?;
    let directory = match &options.directory {
        Some(d) => d.clone(),
        // As the Swift app: the home directory unless `--directory` names another.
        None => std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_absolute()).ok_or("HOME is not an absolute directory. Pass --directory.")?,
    };
    let directory = directory.canonicalize().map_err(|e| format!("{}: {e}", directory.display()))?;
    #[cfg(unix)]
    match channel::launch(&exe, &directory, options.store_path.as_deref()) {
        Ok(url) => return Ok(url),
        Err(channel::Failure::Unsupported) => {}
        Err(channel::Failure::Failed(e)) => return Err(e),
    }
    polled(&exe, &directory, options.store_path.as_deref())
}

/// Stops the child this process started, if any: a `stop` record over the channel (or SIGTERM
/// without one), then a kill if it has not exited within five seconds.
pub fn stop() {
    let Some(mut running) = CHILD.lock().ok().and_then(|mut c| c.take()) else { return };
    #[cfg(unix)]
    {
        use std::io::Write;
        match running.channel.take() {
            Some((mut stream, incarnation)) => {
                let record = serde_json::json!({ "kind": "stop", "version": 1, "incarnation": incarnation });
                let _ = stream.write_all(format!("{record}\n").as_bytes());
            }
            // SAFETY: signals the child this process spawned and still owns.
            None => unsafe {
                libc::kill(running.child.id() as libc::pid_t, libc::SIGTERM);
            },
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if matches!(running.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    let _ = running.child.kill();
    let _ = running.child.wait();
}

fn locate(options: &Options) -> Result<PathBuf, String> {
    if let Some(p) = options.nac_web.clone().or_else(|| std::env::var_os("NAC_WEB").map(PathBuf::from)) {
        return if p.is_file() { Ok(p) } else { Err(format!("{} is not a file", p.display())) };
    }
    let name = if cfg!(windows) { "nac-web.exe" } else { "nac-web" };
    // Beside this executable: `Contents/MacOS/` in a bundle, `target/…/` in a checkout.
    if let Some(beside) = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(name))).filter(|p| p.is_file()) {
        return Ok(beside);
    }
    std::env::var_os("PATH")
        .and_then(|paths| std::env::split_paths(&paths).map(|d| d.join(name)).find(|p| p.is_file()))
        .ok_or_else(|| "nac-web was not found beside nac-desktop or on PATH. Pass --nac-web PATH, or --server URL to attach to a running one.".to_owned())
}

fn command(exe: &Path, directory: &Path) -> Command {
    let mut c = Command::new(exe);
    c.current_dir(directory).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::inherit());
    c
}

/// The fallback: a free loopback port and `GET /readyz`.
fn polled(exe: &Path, directory: &Path, store: Option<&Path>) -> Result<String, String> {
    let port = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map_err(|e| e.to_string())?.port();
    let mut c = command(exe, directory);
    c.arg("--bind").arg(format!("127.0.0.1:{port}")).arg("--directory").arg(directory).arg("--no-open");
    if let Some(store) = store {
        c.arg("--store-path").arg(store);
    }
    let child = c.spawn().map_err(|e| format!("{}: {e}", exe.display()))?;
    *CHILD.lock().map_err(|e| e.to_string())? = Some(Running {
        child,
        #[cfg(unix)]
        channel: None,
    });
    let url = format!("http://127.0.0.1:{port}");
    let client = Client::new(&url);
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if client.ready().is_ok_and(|r| r.status == "ok") {
            return Ok(url);
        }
        if let Ok(mut guard) = CHILD.lock()
            && let Some(r) = guard.as_mut()
            && let Ok(Some(status)) = r.child.try_wait()
        {
            *guard = None;
            return Err(format!("nac-web exited before it was ready ({status})"));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    stop();
    Err("nac-web did not become ready within 60 seconds".into())
}

#[cfg(unix)]
mod channel {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::fd::AsRawFd;
    use std::os::unix::net::UnixStream;
    use std::os::unix::process::CommandExt;
    use std::path::Path;
    use std::time::Duration;

    use serde_json::{Value, json};

    use super::{CHILD, Running, command};

    pub enum Failure {
        /// This `nac-web` has no desktop launch contract.
        Unsupported,
        Failed(String),
    }

    fn fail(message: impl Into<String>) -> Failure {
        Failure::Failed(message.into())
    }

    fn uuid_v4() -> String {
        let mut b = [0u8; 16];
        if std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b)).is_err() {
            let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
            b.copy_from_slice(&(seed ^ (u128::from(std::process::id()) << 64)).to_le_bytes());
        }
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
        format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
    }

    fn json_output(c: &mut std::process::Command) -> Option<Value> {
        let out = c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).output().ok()?;
        serde_json::from_slice(&out.stdout).ok()
    }

    pub fn launch(exe: &Path, directory: &Path, store: Option<&Path>) -> Result<String, Failure> {
        let identity = json_output(command(exe, directory).arg("__desktop-identity")).filter(|v| v.get("build_id").is_some()).ok_or(Failure::Unsupported)?;
        let mut configure = command(exe, directory);
        configure.arg("__desktop-configuration").arg("--directory").arg(directory);
        if let Some(store) = store {
            configure.arg("--store-path").arg(store);
        }
        let configuration = json_output(&mut configure).ok_or_else(|| fail("nac-web configuration discovery failed"))?;
        if configuration["status"] != "selected" {
            return Err(fail(format!("nac-web could not select a configuration ({})", configuration["code"].as_str().unwrap_or("unknown"))));
        }
        let (Some(cwd), Some(store)) = (configuration["root_cwd"].as_str(), configuration["store"].as_str()) else {
            return Err(fail("nac-web configuration discovery returned no directory or store"));
        };

        let (ours, theirs) = UnixStream::pair().map_err(|e| fail(e.to_string()))?;
        let fd = theirs.as_raw_fd();
        let mut c = command(exe, Path::new(cwd));
        c.args(["--bind", "127.0.0.1:0", "--directory", cwd, "--store-path", store, "--worker-executable"]).arg(exe).arg("--no-open");
        c.env("NAC_DESKTOP_CHANNEL_FD", fd.to_string()).process_group(0);
        // SAFETY: `fcntl` is async-signal-safe; it clears close-on-exec on the child's end only
        // in the forked child, so the server inherits exactly that descriptor.
        unsafe {
            c.pre_exec(move || if libc::fcntl(fd, libc::F_SETFD, 0) < 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) });
        }
        let child = c.spawn().map_err(|e| fail(format!("{}: {e}", exe.display())))?;
        drop(theirs);
        let incarnation = uuid_v4();
        let channel = ours.try_clone().map_err(|e| fail(e.to_string()))?;
        *CHILD.lock().map_err(|e| fail(e.to_string()))? = Some(Running { child, channel: Some((channel, incarnation.clone())) });

        let ready = (|| -> Result<String, String> {
            let hello = json!({ "kind": "hello", "version": 1, "incarnation": incarnation, "identity": identity, "store": store });
            (&ours).write_all(format!("{hello}\n").as_bytes()).map_err(|e| e.to_string())?;
            // Migrating a large store can take a while; the server itself bounds its side.
            ours.set_read_timeout(Some(Duration::from_secs(120))).map_err(|e| e.to_string())?;
            let mut line = String::new();
            BufReader::new(&ours).read_line(&mut line).map_err(|e| e.to_string())?;
            let record: Value = serde_json::from_str(&line).map_err(|_| "nac-web closed the launch channel before it was ready".to_owned())?;
            match (record["kind"].as_str(), record["endpoint"].as_str()) {
                (Some("ready"), Some(endpoint)) if record["incarnation"] == incarnation.as_str() => Ok(endpoint.to_owned()),
                _ => Err(format!("nac-web failed to start ({})", record["code"].as_str().unwrap_or("no ready record"))),
            }
        })();
        ready.map_err(|e| {
            super::stop();
            fail(e)
        })
    }
}
