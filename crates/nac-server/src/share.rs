use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    io::{self, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, bail, Context, Result};
use axum::http::Uri;
use clap::ArgGroup;
use nac_core::{isolate_process_group, terminate_child_tree};
use nac_server::{is_valid_dns_host, serve_listener, ServeOptions, ServerOptions, SessionManager};
use tokio::{net::TcpListener, process::Command, sync::oneshot, task::JoinHandle, time::timeout};

mod policy;

const SERVER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
static POLICY_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(clap::Args, Debug)]
#[command(
    group(
        ArgGroup::new("access")
            .required(true)
            .multiple(true)
            .args(["allow_emails", "allow_domains", "public"])
    )
)]
pub(crate) struct ShareCli {
    /// Server root directory for default config and relative store paths.
    #[arg(short = 'C', long = "directory")]
    directory: PathBuf,

    /// Local loopback port. Use 0 to select an available port.
    #[arg(long, default_value_t = 0)]
    port: u16,

    /// Override the server SQLite store path.
    #[arg(long)]
    store_path: Option<PathBuf>,

    /// Worker executable for managed worker dispatch. Defaults to this nac-web binary.
    #[arg(long)]
    worker_executable: Option<PathBuf>,

    /// Google account email allowed through ngrok OAuth. May be repeated.
    #[arg(long = "allow-email", conflicts_with = "public")]
    allow_emails: Vec<String>,

    /// Google Workspace/email domain allowed through ngrok OAuth. May be repeated.
    #[arg(long = "allow-domain", conflicts_with = "public")]
    allow_domains: Vec<String>,

    /// Disable edge authentication. Anyone with the URL can access nac-web.
    #[arg(long, conflicts_with_all = ["allow_emails", "allow_domains"])]
    public: bool,

    /// Exact custom HTTPS origin, for example https://nac.example.com.
    #[arg(long, value_parser = validate_public_url)]
    url: Option<String>,
}

pub(crate) async fn run(cli: ShareCli) -> Result<()> {
    if cli.public {
        eprintln!(
            "WARNING: --public disables ngrok OAuth; anyone with the public URL can access nac-web."
        );
    }

    let launch_cwd = std::env::current_dir()?;
    let root_cwd = crate::resolve_cli_cwd(&launch_cwd, Some(&cli.directory))?;
    let traffic_policy = build_traffic_policy(&cli)?;
    let manager = SessionManager::new(ServerOptions {
        root_cwd,
        store_path: cli.store_path,
        worker_executable: cli.worker_executable,
    })?;
    let store = manager.store_info();

    let requested_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), cli.port);
    let listener = TcpListener::bind(requested_addr)
        .await
        .with_context(|| format!("failed to bind {requested_addr}"))?;
    let actual_addr = listener
        .local_addr()
        .context("failed to read bound loopback address")?;

    let mut shutdown_signals =
        shutdown_signal_listeners().context("failed to register process shutdown signals")?;
    let policy_file = traffic_policy
        .as_deref()
        .map(PrivatePolicyFile::create)
        .transpose()?;
    let mut child = spawn_ngrok(actual_addr.port(), cli.url.as_deref(), policy_file.as_ref())?;
    let mut server = ServerHandle::spawn(listener, manager);

    eprintln!("nac-web local: http://{actual_addr}");
    eprintln!("store: {}", store.store_path.display());

    enum Stop {
        Ngrok(std::io::Result<std::process::ExitStatus>),
        Server(std::result::Result<Result<()>, tokio::task::JoinError>),
        Signal(std::io::Result<()>),
    }

    let stop = tokio::select! {
        result = child.wait() => Stop::Ngrok(result),
        result = &mut server.task => {
            server.joined = true;
            Stop::Server(result)
        },
        result = receive_shutdown_signal(&mut shutdown_signals) => Stop::Signal(result),
    };

    // Keep the private policy alive until ngrok has exited or has been terminated.
    let result = match stop {
        Stop::Ngrok(status) => {
            if status.is_err() {
                terminate_child_tree(&mut child).await;
            }
            let shutdown_result = server.shutdown().await;
            let status = status.context("failed while waiting for ngrok")?;
            shutdown_result?;
            if status.success() {
                Ok(())
            } else {
                bail!("ngrok exited with status {status}")
            }
        }
        Stop::Server(server_result) => {
            terminate_child_tree(&mut child).await;
            server.shutdown().await?;
            server_finished_error(server_result)
        }
        Stop::Signal(signal_result) => {
            terminate_child_tree(&mut child).await;
            let shutdown_result = server.shutdown().await;
            signal_result.context("failed while listening for a process shutdown signal")?;
            shutdown_result
        }
    };
    drop(policy_file);
    result
}

fn build_traffic_policy(cli: &ShareCli) -> Result<Option<String>> {
    if cli.public {
        Ok(None)
    } else {
        policy::build_ngrok_traffic_policy(&cli.allow_emails, &cli.allow_domains).map(Some)
    }
}

fn validate_public_url(value: &str) -> std::result::Result<String, String> {
    let parsed = value.parse::<Uri>().map_err(|_| {
        "must be an exact HTTPS host origin such as https://nac.example.com".to_string()
    })?;
    let authority = parsed.authority().ok_or_else(|| {
        "must be an exact HTTPS host origin such as https://nac.example.com".to_string()
    })?;
    if parsed.scheme_str() != Some("https")
        || authority.as_str().contains('@')
        || authority.port().is_some()
        || value != format!("https://{authority}")
    {
        return Err(
            "must be an exact HTTPS host origin with no userinfo, port, path, query, or fragment"
                .to_string(),
        );
    }
    if !is_valid_public_host(authority.host()) {
        return Err("must contain a valid hostname or IP address".to_string());
    }
    Ok(value.to_string())
}

fn is_valid_public_host(host: &str) -> bool {
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    unbracketed.parse::<IpAddr>().is_ok() || is_valid_dns_host(host)
}

fn spawn_ngrok(
    port: u16,
    public_url: Option<&str>,
    policy_file: Option<&PrivatePolicyFile>,
) -> Result<tokio::process::Child> {
    let mut command = Command::new("ngrok");
    command.arg("http").arg(format!("http://127.0.0.1:{port}"));
    if let Some(public_url) = public_url {
        command.arg(format!("--url={public_url}"));
    }
    if let Some(policy_file) = policy_file {
        let mut argument = OsString::from("--traffic-policy-file=");
        argument.push(policy_file.path().as_os_str());
        command.arg(argument);
    }
    command
        .arg("--inspect=false")
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    isolate_process_group(&mut command);

    command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            anyhow!(
                "ngrok executable was not found; install the ngrok CLI from https://ngrok.com/download and ensure `ngrok` is on PATH"
            )
        } else {
            anyhow!(error).context("failed to start ngrok CLI")
        }
    })
}

struct PrivatePolicyFile {
    path: PathBuf,
}

impl PrivatePolicyFile {
    fn create(contents: &str) -> Result<Self> {
        let directory = std::env::temp_dir();
        for _ in 0..128 {
            let path = directory.join(unique_policy_file_name());
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = match options.open(&path) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(error).with_context(|| {
                        format!("failed to create policy file in {}", directory.display())
                    })
                }
            };

            let write_result = (|| -> Result<()> {
                file.write_all(contents.as_bytes())
                    .context("failed to write temporary ngrok traffic policy")?;
                file.sync_all()
                    .context("failed to sync temporary ngrok traffic policy")?;
                #[cfg(unix)]
                fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o600))
                    .context("failed to secure temporary ngrok traffic policy")?;
                Ok(())
            })();
            if let Err(error) = write_result {
                let _ = fs::remove_file(&path);
                return Err(error);
            }
            return Ok(Self { path });
        }
        bail!(
            "failed to create a collision-free ngrok traffic policy file in {}",
            directory.display()
        )
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for PrivatePolicyFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn unique_policy_file_name() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = POLICY_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        ".nac-ngrok-policy-{}-{timestamp}-{sequence}.json",
        std::process::id()
    )
}

struct ServerHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    task: JoinHandle<Result<()>>,
    joined: bool,
}

impl ServerHandle {
    fn spawn(listener: TcpListener, manager: SessionManager) -> Self {
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            serve_listener(listener, manager, ServeOptions::SharedTunnel, async move {
                let _ = shutdown_rx.await;
            })
            .await
        });
        Self {
            shutdown_tx: Some(shutdown_tx),
            task,
            joined: false,
        }
    }

    async fn shutdown(&mut self) -> Result<()> {
        if self.joined {
            return Ok(());
        }
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }
        match timeout(SERVER_SHUTDOWN_TIMEOUT, &mut self.task).await {
            Ok(result) => {
                self.joined = true;
                result.context("nac-web server task failed")?
            }
            Err(_) => {
                self.task.abort();
                let _ = (&mut self.task).await;
                self.joined = true;
                bail!("timed out waiting for nac-web server shutdown")
            }
        }
    }
}

fn server_finished_error(
    result: std::result::Result<Result<()>, tokio::task::JoinError>,
) -> Result<()> {
    match result {
        Ok(Ok(())) => bail!("nac-web server stopped before ngrok exited"),
        Ok(Err(error)) => Err(error).context("nac-web server failed"),
        Err(error) => Err(error).context("nac-web server task failed"),
    }
}

#[cfg(unix)]
struct ShutdownSignals {
    interrupt: tokio::signal::unix::Signal,
    terminate: tokio::signal::unix::Signal,
}

#[cfg(unix)]
fn shutdown_signal_listeners() -> io::Result<ShutdownSignals> {
    use tokio::signal::unix::{signal, SignalKind};

    Ok(ShutdownSignals {
        interrupt: signal(SignalKind::interrupt())?,
        terminate: signal(SignalKind::terminate())?,
    })
}

#[cfg(unix)]
async fn receive_shutdown_signal(listeners: &mut ShutdownSignals) -> io::Result<()> {
    let received = tokio::select! {
        received = listeners.interrupt.recv() => received,
        received = listeners.terminate.recv() => received,
    };
    received.ok_or_else(|| io::Error::other("process signal listener unexpectedly closed"))
}

#[cfg(windows)]
type ShutdownSignals = tokio::signal::windows::CtrlC;

#[cfg(windows)]
fn shutdown_signal_listeners() -> io::Result<ShutdownSignals> {
    tokio::signal::windows::ctrl_c()
}

#[cfg(windows)]
async fn receive_shutdown_signal(listener: &mut ShutdownSignals) -> io::Result<()> {
    listener
        .recv()
        .await
        .ok_or_else(|| io::Error::other("Ctrl-C listener unexpectedly closed"))
}
