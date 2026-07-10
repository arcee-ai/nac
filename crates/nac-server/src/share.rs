use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    future::Future,
    io::{self, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    process::Stdio,
    time::Duration,
};

use anyhow::{anyhow, bail, Context, Result};
use axum::http::Uri;
use clap::ArgGroup;
use nac_core::{isolate_process_group, terminate_child_tree};
use nac_server::{is_valid_dns_host, serve_shared_listener, ServerOptions, SessionManager};
use tokio::{net::TcpListener, process::Command, sync::oneshot, time::timeout};
use uuid::Uuid;

mod policy;

const SERVER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(clap::Args, Debug)]
#[command(group(
    ArgGroup::new("access")
        .required(true)
        .multiple(true)
        .args(["allow_emails", "allow_domains", "public"])
))]
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
        eprintln!("WARNING: --public disables ngrok OAuth; anyone can access nac-web.");
    }
    let root_cwd = crate::resolve_cli_cwd(&std::env::current_dir()?, Some(&cli.directory))?;
    let policy = (!cli.public)
        .then(|| policy::build_ngrok_traffic_policy(&cli.allow_emails, &cli.allow_domains))
        .transpose()?;
    let manager = SessionManager::new(ServerOptions {
        root_cwd,
        store_path: cli.store_path,
        worker_executable: cli.worker_executable,
    })?;
    let store = manager.store_info();
    let requested_addr = SocketAddr::from((Ipv4Addr::LOCALHOST, cli.port));
    let listener = TcpListener::bind(requested_addr)
        .await
        .with_context(|| format!("failed to bind {requested_addr}"))?;
    let actual_addr = listener
        .local_addr()
        .context("failed to read bound loopback address")?;

    let signal = shutdown_signal().context("failed to register process shutdown signals")?;
    let policy_file = policy
        .as_deref()
        .map(PrivatePolicyFile::create)
        .transpose()?;
    let mut child = spawn_ngrok(actual_addr.port(), cli.url.as_deref(), policy_file.as_ref())?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let server = serve_shared_listener(listener, manager, async move {
        let _ = shutdown_rx.await;
    });
    tokio::pin!(server, signal);
    eprintln!("nac-web local: http://{actual_addr}");
    eprintln!("store: {}", store.store_path.display());
    let stop_result = tokio::select! {
        result = child.wait() => match result {
            Ok(status) if status.success() => Ok(()),
            Ok(status) => Err(anyhow!("ngrok exited with status {status}")),
            Err(error) => {
                terminate_child_tree(&mut child).await;
                Err(error).context("failed while waiting for ngrok")
            }
        },
        result = &mut server => {
            terminate_child_tree(&mut child).await;
            return match result {
                Ok(()) => bail!("nac-web server stopped before ngrok exited"),
                Err(error) => Err(error).context("nac-web server failed"),
            };
        },
        result = &mut signal => {
            terminate_child_tree(&mut child).await;
            result.context("failed while listening for a process shutdown signal")
        },
    };

    let _ = shutdown_tx.send(());
    let server_result = timeout(SERVER_SHUTDOWN_TIMEOUT, &mut server)
        .await
        .map_err(|_| anyhow!("timed out waiting for nac-web server shutdown"))?;
    stop_result?;
    server_result.context("nac-web server failed")
}

fn validate_public_url(value: &str) -> std::result::Result<String, String> {
    let help = "must be an exact HTTPS host origin such as https://nac.example.com";
    let uri = value.parse::<Uri>().map_err(|_| help.to_string())?;
    let authority = uri.authority().ok_or_else(|| help.to_string())?;
    let exact = "must be an HTTPS origin without userinfo, port, path, query, or fragment";
    if uri.scheme_str() != Some("https")
        || authority.as_str().contains('@')
        || authority.port().is_some()
        || value != format!("https://{authority}")
    {
        return Err(exact.into());
    }
    let host = authority.host();
    let ip = host.strip_prefix('[').and_then(|h| h.strip_suffix(']'));
    if ip.unwrap_or(host).parse::<IpAddr>().is_err() && !is_valid_dns_host(host) {
        return Err("must contain a valid hostname or IP address".into());
    }
    Ok(value.to_string())
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
        argument.push(&policy_file.0);
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
        if error.kind() == io::ErrorKind::NotFound {
            anyhow!("ngrok executable was not found; install the ngrok CLI from https://ngrok.com/download and ensure `ngrok` is on PATH")
        } else {
            anyhow!(error).context("failed to start ngrok CLI")
        }
    })
}

struct PrivatePolicyFile(PathBuf);

impl PrivatePolicyFile {
    fn create(contents: &str) -> Result<Self> {
        let path = std::env::temp_dir().join(format!(".nac-ngrok-policy-{}.json", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&path)
            .with_context(|| format!("failed to create ngrok policy {}", path.display()))?;
        if let Err(error) = file.write_all(contents.as_bytes()) {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(error).context("failed to write temporary ngrok traffic policy");
        }
        drop(file);
        Ok(Self(path))
    }
}

impl Drop for PrivatePolicyFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(unix)]
fn shutdown_signal() -> io::Result<impl Future<Output = io::Result<()>>> {
    use tokio::signal::unix::{signal, SignalKind};
    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut terminate = signal(SignalKind::terminate())?;
    Ok(async move {
        tokio::select! {
            received = interrupt.recv() => received,
            received = terminate.recv() => received,
        }
        .ok_or_else(|| io::Error::other("process signal listener unexpectedly closed"))
    })
}

#[cfg(windows)]
fn shutdown_signal() -> io::Result<impl Future<Output = io::Result<()>>> {
    let mut ctrl_c = tokio::signal::windows::ctrl_c()?;
    Ok(async move {
        ctrl_c
            .recv()
            .await
            .ok_or_else(|| io::Error::other("Ctrl-C listener unexpectedly closed"))
    })
}
