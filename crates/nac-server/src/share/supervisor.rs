use std::{net::SocketAddr, path::PathBuf, time::Duration};

use anyhow::{anyhow, bail, Context, Result};
use nac_server::{
    serve_listener, CorsPolicy, ExposureMode, ServeOptions, ServerOptions, SessionManager,
};
use ngrok::{
    forwarder::Forwarder,
    prelude::{EndpointInfo, ForwarderBuilder, TunnelCloser},
    tunnel::HttpTunnel,
};
use tokio::{net::TcpListener, sync::oneshot, task::JoinHandle, time::timeout};
use url::Url;

use super::{
    config::{
        effective_share_config, load_saved_share_config, normalize_allowlist,
        normalize_share_config, ShareConfigOverrides,
    },
    health::{local_service_url, wait_for_local_health},
    policy::build_ngrok_traffic_policy,
    secrets::resolve_authtoken,
    security::validate_share_bind,
};

const SERVER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct ShareRunOptions {
    pub root_cwd: PathBuf,
    pub bind: SocketAddr,
    pub store_path: Option<PathBuf>,
    pub worker_executable: Option<PathBuf>,
    pub overrides: ShareConfigOverrides,
    pub authtoken: Option<String>,
    pub insecure_bind: bool,
}

pub async fn run_share(options: ShareRunOptions) -> Result<()> {
    validate_share_bind(options.bind, options.insecure_bind)?;

    let saved = load_saved_share_config(&options.root_cwd)?;
    let ngrok = normalize_share_config(&effective_share_config(&saved, &options.overrides))?;
    let token = resolve_authtoken(&options.root_cwd, &ngrok, options.authtoken.as_deref())?;
    let token_source = token.source.clone();
    let traffic_policy = build_ngrok_traffic_policy(&ngrok).with_context(|| {
        format!(
            "share auth configuration is incomplete; run `nac-web share configure -C {}`",
            options.root_cwd.display()
        )
    })?;

    let listener = TcpListener::bind(options.bind)
        .await
        .with_context(|| format!("failed to bind {}", options.bind))?;
    let bind = listener
        .local_addr()
        .context("failed to read bound local address")?;
    let local_url = local_service_url(bind);

    let manager = SessionManager::new(ServerOptions {
        root_cwd: options.root_cwd.clone(),
        store_path: options.store_path,
        worker_executable: options.worker_executable,
    })?;
    let store = manager.store_info();
    let mut server = ServerHandle::spawn(listener, manager);

    if let Err(error) = server.wait_until_healthy(bind).await {
        server.shutdown().await;
        return Err(error);
    }

    let mut forwarder =
        match start_ngrok_forwarder(token.token, &ngrok, traffic_policy, &local_url).await {
            Ok(forwarder) => forwarder,
            Err(error) => {
                server.shutdown().await;
                return Err(error);
            }
        };

    eprintln!("nac-web local: {local_url}");
    eprintln!("nac-web public: {}", forwarder.url());
    eprintln!(
        "ngrok auth: {}",
        if ngrok.auth_required {
            format!(
                "{} OAuth allowlist ({})",
                ngrok.oauth_provider,
                normalize_allowlist(&ngrok.allow_emails, &ngrok.allow_domains)?.summary()
            )
        } else {
            "disabled".to_string()
        }
    );
    eprintln!("ngrok token: {token_source}");
    eprintln!("store: {}", store.store_path.display());

    let mut forwarder_join = forwarder.join();
    tokio::select! {
        server_result = &mut server.task => {
            server.joined = true;
            let _ = forwarder_join;
            let _ = forwarder.close().await;
            server_finished_error(server_result, "nac-web server stopped before ngrok exited")
        }
        forwarder_result = &mut forwarder_join => {
            server.shutdown().await;
            match forwarder_result {
                Ok(Ok(())) => Ok(()),
                Ok(Err(error)) => bail!("ngrok forwarder stopped: {error}"),
                Err(error) => Err(error).context("ngrok forwarder task failed"),
            }
        }
        signal = tokio::signal::ctrl_c() => {
            signal.context("failed to listen for Ctrl-C")?;
            let _ = forwarder_join;
            let _ = forwarder.close().await;
            server.shutdown().await;
            Ok(())
        }
    }
}

async fn start_ngrok_forwarder(
    authtoken: String,
    config: &super::config::NgrokConfig,
    traffic_policy: Option<String>,
    local_url: &str,
) -> Result<Forwarder<HttpTunnel>> {
    let mut session_builder = ngrok::Session::builder();
    session_builder.authtoken(authtoken);
    let session = session_builder
        .connect()
        .await
        .context("failed to connect to ngrok")?;
    let mut endpoint = session.http_endpoint();
    if let Some(domain) = config.domain.as_deref() {
        endpoint.domain(domain.to_string());
    }
    if let Some(policy) = traffic_policy {
        endpoint.traffic_policy(policy);
    }
    endpoint
        .listen_and_forward(Url::parse(local_url)?)
        .await
        .context("failed to start ngrok endpoint")
}

struct ServerHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    task: JoinHandle<Result<()>>,
    joined: bool,
}

impl ServerHandle {
    fn spawn(listener: TcpListener, manager: SessionManager) -> Self {
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let task = tokio::spawn(async move {
            serve_listener(
                listener,
                manager,
                ServeOptions {
                    cors: CorsPolicy::Disabled,
                    exposure: ExposureMode::SharedTunnel,
                },
                async move {
                    let _ = shutdown_rx.await;
                },
            )
            .await
        });
        Self {
            shutdown_tx: Some(shutdown_tx),
            task,
            joined: false,
        }
    }

    async fn wait_until_healthy(&mut self, bind: SocketAddr) -> Result<()> {
        let health = wait_for_local_health(bind);
        tokio::pin!(health);
        tokio::select! {
            server_result = &mut self.task => {
                self.joined = true;
                server_finished_error(server_result, "nac-web server stopped before becoming healthy")
            }
            health_result = &mut health => health_result,
        }
    }

    async fn shutdown(&mut self) {
        if self.joined {
            return;
        }
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }
        match timeout(SERVER_SHUTDOWN_TIMEOUT, &mut self.task).await {
            Ok(_) => {
                self.joined = true;
            }
            Err(_) => {
                self.task.abort();
                self.joined = true;
            }
        }
    }
}

fn server_finished_error(
    result: std::result::Result<Result<()>, tokio::task::JoinError>,
    stopped_message: &str,
) -> Result<()> {
    match result {
        Ok(Ok(())) => Err(anyhow!(stopped_message.to_string())),
        Ok(Err(error)) => Err(error).context("nac-web server failed"),
        Err(error) => Err(error).context("nac-web server task failed"),
    }
}
