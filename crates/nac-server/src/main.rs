use std::{
    ffi::OsString,
    io::{self, IsTerminal, Read, Write},
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    process,
};

use anyhow::{anyhow, Context, Result};
use clap::{Args, CommandFactory, Parser, Subcommand};
use nac_core::{
    model::{
        run_arcee_auth_action, run_codex_auth_action, ArceeAuthAction, BackendKind,
        CodexAuthAction, ReasoningEffort,
    },
    runtime::{
        self, ManagedWorkerOptions, ModelOptions, OptionalModelOption, SandboxOptions,
        StoreOptions, WorkerDispatchOptions,
    },
    upgrade::{
        execute_prerelease_upgrade, resolve_prerelease_upgrade, run_upgrade, UpgradeRequest,
        UpgradeTarget,
    },
};
use nac_server::{serve_with_policy, BindPolicy, ServerOptions, SessionManager};

/// Version reported by the binary. Release builds may override the package
/// version so a prerelease binary exactly matches its immutable RC tag.
const RELEASE_VERSION: &str = env!("NAC_RELEASE_VERSION");
const BUILD_VERSION: &str = concat!(
    env!("NAC_RELEASE_VERSION"),
    " (",
    env!("NAC_BUILD_REVISION"),
    ")"
);

#[derive(Parser)]
#[command(
    name = "nac-web",
    about = "Run the NAC web dashboard and manage credentials and updates",
    long_about = "Run the NAC web dashboard for a project, or use a command to manage credentials or upgrade nac-web.\n\nWith no command, nac-web serves the selected project and opens the dashboard in the default browser when run interactively.",
    version = RELEASE_VERSION,
    long_version = BUILD_VERSION,
    args_conflicts_with_subcommands = true,
)]
struct Cli {
    #[command(flatten)]
    server: ServerCli,

    #[command(subcommand)]
    command: Option<RootCommand>,
}

#[derive(Subcommand)]
#[allow(clippy::large_enum_variant)]
enum RootCommand {
    /// Manage ChatGPT credentials used by Codex models
    #[command(version = RELEASE_VERSION, long_version = BUILD_VERSION)]
    CodexAuth(CodexAuthCli),

    /// Manage Arcee account credentials
    #[command(version = RELEASE_VERSION, long_version = BUILD_VERSION)]
    ArceeAuth(ArceeAuthCli),

    /// Download and reinstall the latest nac-web release
    #[command(version = RELEASE_VERSION, long_version = BUILD_VERSION)]
    Upgrade(UpgradeCli),

    #[command(name = "__worker", hide = true)]
    ManagedWorker(ManagedWorkerCli),

    #[command(name = "__github-credential", hide = true)]
    GitHubCredential(GitHubCredentialCli),
}

#[derive(Args)]
struct ServerCli {
    /// Socket address to listen on (default: loopback only).
    #[arg(long, default_value = "127.0.0.1:3210")]
    bind: SocketAddr,

    /// Permit a non-loopback bind after network access has been restricted.
    ///
    /// Every client that can connect receives control equivalent to the local
    /// user. Use only behind an authenticated, encrypted network boundary.
    #[arg(long, action = clap::ArgAction::SetTrue)]
    allow_remote: bool,

    /// Port to listen on at 127.0.0.1 (1-65535; default: 3210).
    ///
    /// Cannot be used with --bind.
    #[arg(
        short,
        long,
        value_name = "PORT",
        value_parser = clap::value_parser!(u16).range(1..),
        conflicts_with = "bind"
    )]
    port: Option<u16>,

    /// Project directory to manage (skips the interactive confirmation).
    ///
    /// Without this flag an interactive terminal confirms the current working
    /// directory or asks for another path. Non-interactive runs use cwd.
    #[arg(short = 'C', long)]
    directory: Option<PathBuf>,

    /// Accept the current working directory without prompting.
    #[arg(short = 'y', long, action = clap::ArgAction::SetTrue)]
    yes: bool,

    /// Override the server SQLite store path.
    #[arg(long)]
    store_path: Option<PathBuf>,

    /// Executable to launch for managed worker dispatch.
    ///
    /// Defaults to the running nac-web executable.
    #[arg(long)]
    worker_executable: Option<PathBuf>,

    /// Explicit versioned Managed NAC host configuration document.
    ///
    /// Omit this for ordinary NAC. `NAC_MANAGED_CONFIG` is consulted only when
    /// the flag is absent so managed containers can mount the document without
    /// changing local defaults.
    #[arg(long)]
    managed_config: Option<PathBuf>,

    /// Open the dashboard in the default browser after listening.
    ///
    /// Interactive terminals open by default; pass `--no-open` to skip, or set
    /// `BROWSER=none`. `--open` forces a window even when stdin is not a TTY.
    #[arg(long, action = clap::ArgAction::SetTrue)]
    open: bool,

    /// Do not open the dashboard in a browser.
    #[arg(long = "no-open", action = clap::ArgAction::SetTrue)]
    no_open: bool,
}

impl ServerCli {
    fn bind_addr(&self) -> SocketAddr {
        let mut bind = self.bind;
        if let Some(port) = self.port {
            bind.set_port(port);
        }
        bind
    }

    fn bind_policy(&self) -> BindPolicy {
        if self.allow_remote {
            BindPolicy::AllowRemote
        } else {
            BindPolicy::LoopbackOnly
        }
    }
}

#[derive(Args)]
struct CodexAuthCli {
    #[command(subcommand)]
    command: Option<CodexAuthCommand>,
}

#[derive(Subcommand)]
enum CodexAuthCommand {
    /// Sign in to ChatGPT using device code authorization
    Login,
    /// Show stored ChatGPT credential status
    Status,
    /// Remove stored ChatGPT credentials
    Logout,
}

#[derive(Args)]
struct ArceeAuthCli {
    #[command(subcommand)]
    command: Option<ArceeAuthCommand>,
}

#[derive(Subcommand)]
enum ArceeAuthCommand {
    /// Sign in to Arcee using device code authorization
    Login,
    /// Show stored Arcee credential status
    Status,
    /// Remove stored Arcee credentials
    Logout,
}

#[derive(Args)]
struct UpgradeCli {
    /// Directory containing the nac-web executable to replace.
    ///
    /// Defaults to $INSTALL_DIR when set, otherwise the current nac-web
    /// executable directory.
    #[arg(long)]
    install_dir: Option<PathBuf>,

    /// Explicitly test the newest active candidate once without joining a prerelease channel
    #[arg(long)]
    pre_release: bool,

    /// Proceed without an interactive prompt (requires --pre-release)
    #[arg(short = 'y', long, requires = "pre_release")]
    yes: bool,
}

#[derive(Args)]
struct ManagedWorkerCli {
    /// Internal Managed NAC host-secret root used for per-command snapshots.
    #[arg(long, hide = true)]
    managed_secret_root: Option<PathBuf>,

    /// Internal Managed NAC GitHub App client ID for worker command auth.
    #[arg(long, hide = true, requires = "managed_secret_root")]
    managed_github_client_id: Option<String>,

    /// Internal persistent owner home used by worker commands.
    #[arg(long, hide = true, requires = "managed_secret_root")]
    managed_home_root: Option<PathBuf>,

    /// Internal workspace cwd used for managed worker path resolution.
    #[arg(long, hide = true)]
    workspace_cwd: Option<PathBuf>,

    /// Internal local cwd used to resolve non-model runtime config for managed workers.
    #[arg(long, hide = true)]
    config_cwd: Option<PathBuf>,

    /// Internal OpenSSH target for remote workers.
    #[arg(long = "ssh-host", alias = "host-id", hide = true)]
    ssh_host: Option<String>,

    /// Internal ssh port for remote workers, when the session set one.
    #[arg(long = "ssh-port", hide = true)]
    ssh_port: Option<u16>,

    /// Internal ssh private key for remote workers, when the session set one.
    #[arg(long = "ssh-identity-file", hide = true)]
    ssh_identity_file: Option<PathBuf>,

    #[command(flatten)]
    dispatch: WorkerDispatchArgs,

    #[command(flatten)]
    store: StoreArgs,

    #[command(flatten)]
    model: ModelArgs,

    #[command(flatten)]
    sandbox: SandboxArgs,
}

#[derive(Args)]
struct GitHubCredentialCli {
    #[arg(long, hide = true)]
    state_root: PathBuf,

    #[arg(long, hide = true)]
    client_id: String,

    #[arg(hide = true)]
    operation: String,
}

#[derive(clap::Args)]
struct StoreArgs {
    /// Override the SQLite store path.
    #[arg(long)]
    store_path: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
enum BackendArg {
    #[value(name = "deepseek-chat")]
    DeepSeekChat,
    #[value(name = "fireworks-chat")]
    FireworksChat,
    #[value(name = "together-chat")]
    TogetherChat,
    #[value(name = "openai-responses")]
    OpenAiResponses,
    #[value(name = "chatgpt-codex-responses")]
    ChatGptCodexResponses,
    #[value(name = "anthropic-messages")]
    AnthropicMessages,
    #[value(name = "arcee-auth")]
    ArceeAuth,
    #[value(name = "arcee-api")]
    ArceeApi,
}

impl From<BackendArg> for BackendKind {
    fn from(value: BackendArg) -> Self {
        match value {
            BackendArg::DeepSeekChat => Self::DeepSeekChat,
            BackendArg::FireworksChat => Self::FireworksChat,
            BackendArg::TogetherChat => Self::TogetherChat,
            BackendArg::OpenAiResponses => Self::OpenAiResponses,
            BackendArg::ChatGptCodexResponses => Self::ChatGptCodexResponses,
            BackendArg::AnthropicMessages => Self::AnthropicMessages,
            BackendArg::ArceeAuth => Self::ArceeAuth,
            BackendArg::ArceeApi => Self::ArceeApi,
        }
    }
}

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
enum ReasoningEffortArg {
    #[value(name = "none")]
    None,
    #[value(name = "minimal")]
    Minimal,
    #[value(name = "low")]
    Low,
    #[value(name = "medium")]
    Medium,
    #[value(name = "high")]
    High,
    #[value(name = "xhigh")]
    Xhigh,
    #[value(name = "max")]
    Max,
}

impl From<ReasoningEffortArg> for ReasoningEffort {
    fn from(value: ReasoningEffortArg) -> Self {
        match value {
            ReasoningEffortArg::None => Self::None,
            ReasoningEffortArg::Minimal => Self::Minimal,
            ReasoningEffortArg::Low => Self::Low,
            ReasoningEffortArg::Medium => Self::Medium,
            ReasoningEffortArg::High => Self::High,
            ReasoningEffortArg::Xhigh => Self::Xhigh,
            ReasoningEffortArg::Max => Self::Max,
        }
    }
}

#[derive(clap::Args, Default)]
struct ModelArgs {
    /// Persisted backend snapshot transported to a managed worker.
    #[arg(long, value_enum)]
    backend: Option<BackendArg>,

    /// Persisted reasoning-effort snapshot transported to a managed worker.
    #[arg(long = "effort", value_enum)]
    reasoning_effort: Option<ReasoningEffortArg>,

    /// Persisted API base URL snapshot transported to a managed worker.
    #[arg(long, hide = true)]
    api_base_url: Option<String>,

    /// Persisted model identifier snapshot transported to a managed worker.
    #[arg(long, hide = true)]
    api_model: Option<String>,

    /// Persisted api_key_env selector snapshot transported to a managed worker.
    #[arg(long = "api-key-env", hide = true)]
    api_key_env: Option<String>,

    /// Internal extra headers snapshot transport (JSON object) used by managed workers.
    #[arg(
        long = "extra-headers",
        hide = true,
        value_parser = runtime::parse_extra_headers_json
    )]
    extra_headers: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(clap::Args)]
struct WorkerDispatchArgs {
    /// Session id for the managed worker dispatch.
    #[arg(long)]
    session_id: String,

    /// Thread name for the managed worker dispatch.
    #[arg(long)]
    thread_name: String,

    /// Exact identity for this managed worker dispatch.
    #[arg(long, hide = true)]
    dispatch_id: String,

    /// Action for the managed worker dispatch.
    #[arg(long)]
    action: String,

    /// Source threads whose latest retained episodes should be loaded.
    #[arg(long = "source-thread")]
    source_threads: Vec<String>,

    /// Skill names to preload for this managed worker dispatch.
    #[arg(long = "skill")]
    skills: Vec<String>,
}

#[derive(clap::Args)]
struct SandboxArgs {
    /// Run tool execution inside a session-scoped sandbox.
    #[arg(long)]
    sandbox: bool,

    /// Disable the implicit current-directory mount into /workspace.
    #[arg(long)]
    no_mount_cwd: bool,

    /// Additional read-write mount in the form HOST:GUEST.
    #[arg(long = "mount")]
    mounts: Vec<String>,

    /// Additional read-only mount in the form HOST:GUEST.
    #[arg(long = "mount-ro")]
    mounts_ro: Vec<String>,

    /// Lossless internal read-write mount pair used by worker subprocesses.
    #[arg(long = "sandbox-mount", hide = true, num_args = 2)]
    sandbox_mounts: Vec<OsString>,

    /// Lossless internal read-only mount pair used by worker subprocesses.
    #[arg(long = "sandbox-mount-ro", hide = true, num_args = 2)]
    sandbox_mounts_ro: Vec<OsString>,

    /// Sandbox image to use when --sandbox is enabled.
    #[arg(long)]
    sandbox_image: Option<String>,

    /// GPU CDI device to expose to the sandbox.
    #[arg(long = "sandbox-gpu")]
    sandbox_gpus: Vec<String>,

    /// Sandbox /dev/shm size.
    #[arg(long = "sandbox-shm-size")]
    sandbox_shm_size: Option<String>,

    /// Sandbox backend to use (podman).
    #[arg(long = "sandbox-backend")]
    sandbox_backend: Option<String>,

    /// Number of CPUs to allocate for the sandbox (default: 2).
    #[arg(long = "sandbox-cpus")]
    sandbox_cpus: Option<u8>,

    /// Memory in MiB to allocate for the sandbox (default: 2048).
    #[arg(long = "sandbox-mem")]
    sandbox_mem: Option<u32>,

    /// Internal sandbox session key used to attach worker subprocesses.
    #[arg(long, hide = true)]
    sandbox_session_key: Option<String>,

    /// Internal sandbox workdir used for worker subprocesses.
    #[arg(long, hide = true)]
    sandbox_workdir: Option<String>,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("Error: {error:#}");
        process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        None => run_server(cli.server).await,
        Some(RootCommand::ManagedWorker(worker)) => run_managed_worker(worker).await,
        Some(RootCommand::GitHubCredential(helper)) => run_github_credential(helper).await,
        Some(RootCommand::CodexAuth(auth)) => run_codex_auth_cli(auth).await,
        Some(RootCommand::ArceeAuth(auth)) => run_arcee_auth_cli(auth).await,
        Some(RootCommand::Upgrade(upgrade)) => run_upgrade_cli(upgrade).await,
    }
}

async fn run_github_credential(cli: GitHubCredentialCli) -> Result<()> {
    if cli.operation != "get" {
        return Ok(());
    }
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .context("failed to read Git credential request")?;
    if let Some(token) = resolve_github_credential(&cli, &input).await? {
        println!("username=x-access-token");
        println!("password={}", token.secret());
    }
    Ok(())
}

async fn resolve_github_credential(
    cli: &GitHubCredentialCli,
    input: &str,
) -> Result<Option<nac_core::managed_github::GitHubAccessToken>> {
    let mut protocol = None;
    let mut host = None;
    for line in input.lines() {
        if let Some((name, value)) = line.split_once('=') {
            match name {
                "protocol" => protocol = Some(value),
                "host" => host = Some(value),
                _ => {}
            }
        }
    }
    let github_host = host
        .and_then(|host| host.split(':').next())
        .is_some_and(|host| host.eq_ignore_ascii_case("github.com"));
    if protocol != Some("https") || !github_host {
        return Ok(None);
    }
    let auth =
        nac_core::managed_github::ManagedGitHubAuth::new(&cli.state_root, cli.client_id.clone())?;
    let token = auth.current_token().await?.ok_or_else(|| {
        anyhow!("GitHub is not connected; reconnect GitHub before using HTTPS Git")
    })?;
    Ok(Some(token))
}

async fn run_server(cli: ServerCli) -> Result<()> {
    let bind = cli.bind_addr();
    let bind_policy = cli.bind_policy();
    bind_policy.validate(bind)?;
    if !bind.ip().is_loopback() {
        eprintln!("warning: every client that can reach {bind} receives full control of nac-web");
    }
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = resolve_project_directory(&launch_cwd, cli.directory.as_deref(), cli.yes)?;
    eprintln!("project: {}", root_cwd.display());
    let managed_config_path = cli
        .managed_config
        .or_else(|| std::env::var_os("NAC_MANAGED_CONFIG").map(PathBuf::from));
    let managed_host =
        nac_core::managed::ManagedHostConfig::load_optional(managed_config_path.as_deref())?;
    let manager = SessionManager::new(ServerOptions {
        root_cwd,
        store_path: cli.store_path,
        worker_executable: cli.worker_executable,
        managed_host,
    })?;
    // Fire-and-forget models.dev catalog overlay refresh (4h cadence,
    // ETag-revalidated, never on picker/resume/validation paths).
    nac_core::model::spawn_overlay_refresh();
    // Fire-and-forget arcee model refresh (4h cadence, same pattern as the
    // models.dev overlay; fetches the live model list from the arcee API and
    // merges it into the catalog, falling back to seed models on failure).
    nac_core::model::spawn_arcee_model_refresh();
    // Fire-and-forget anthropic model refresh (4h cadence, same pattern as
    // the models.dev and arcee overlays; fetches model capabilities from the
    // Anthropic API and merges effort tiers, context window, max tokens,
    // thinking types and context_management support into the catalog).
    nac_core::model::spawn_anthropic_model_refresh();
    let info = manager.store_info();
    let store_path = info.store_path.display().to_string();
    let open = should_open_dashboard(cli.open, cli.no_open);
    // Open the browser only after bind succeeds — otherwise the first load can
    // hit connection-refused while the socket is still closed. Post-login
    // dashboard launch goes through this same path.
    serve_with_policy(bind, bind_policy, manager, |bound| {
        let url = dashboard_url(bound);
        eprintln!("nac-web listening on {url}");
        eprintln!("store: {store_path}");
        if open {
            eprintln!("opening the dashboard in your browser…");
            nac_core::browser::open_url(&url);
        }
    })
    .await
}

/// Picks the project root: explicit `-C`, else confirm cwd (or type another path).
fn resolve_project_directory(
    launch_cwd: &Path,
    directory: Option<&Path>,
    assume_yes: bool,
) -> Result<PathBuf> {
    if let Some(path) = directory {
        return resolve_cli_cwd(launch_cwd, Some(path));
    }

    let default = resolve_cli_cwd(launch_cwd, None)?;
    if assume_yes || !io::stdin().is_terminal() {
        return Ok(default);
    }

    eprintln!("Project directory: {}", default.display());
    eprint!("Confirm this project folder? [Y/n] ");
    io::stderr().flush()?;

    let mut answer = String::new();
    io::stdin()
        .read_line(&mut answer)
        .context("failed to read project folder confirmation")?;
    let answer = answer.trim();
    if answer.is_empty() || answer.eq_ignore_ascii_case("y") || answer.eq_ignore_ascii_case("yes") {
        return Ok(default);
    }
    if !(answer.eq_ignore_ascii_case("n") || answer.eq_ignore_ascii_case("no")) {
        anyhow::bail!("expected y or n");
    }

    eprint!("Enter project directory: ");
    io::stderr().flush()?;
    let mut entered = String::new();
    io::stdin()
        .read_line(&mut entered)
        .context("failed to read project directory")?;
    let entered = entered.trim();
    if entered.is_empty() {
        anyhow::bail!("project directory is required");
    }
    resolve_cli_cwd(launch_cwd, Some(Path::new(&expand_user_path(entered))))
}

fn expand_user_path(value: &str) -> PathBuf {
    if value == "~" {
        return std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}

/// URL shown to humans and handed to the browser. Wildcard binds (`0.0.0.0`,
/// `::`) are rewritten to loopback so the link is actually reachable.
fn dashboard_url(bind: SocketAddr) -> String {
    let host = match bind.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => "127.0.0.1".to_string(),
        IpAddr::V6(ip) if ip.is_unspecified() => "[::1]".to_string(),
        IpAddr::V6(ip) => format!("[{ip}]"),
        ip => ip.to_string(),
    };
    format!("http://{host}:{}", bind.port())
}

fn should_open_dashboard(force_open: bool, no_open: bool) -> bool {
    if no_open {
        return false;
    }
    force_open || nac_core::browser::should_open_browser()
}

async fn run_managed_worker(cli: ManagedWorkerCli) -> Result<()> {
    // Fire-and-forget models.dev catalog overlay refresh; cadence-gated via
    // the sidecar, so usually a no-op read. Keeps the overlay fresh for
    // worker-heavy usage even when the server is not running.
    nac_core::model::spawn_overlay_refresh();
    // Fire-and-forget arcee model refresh; same cadence-gated pattern.
    nac_core::model::spawn_arcee_model_refresh();
    // Fire-and-forget anthropic model refresh; same cadence-gated pattern.
    nac_core::model::spawn_anthropic_model_refresh();
    let launch_cwd = std::env::current_dir()?;
    let workspace_cwd = match (&cli.ssh_host, &cli.workspace_cwd) {
        (Some(_), Some(remote_cwd)) => remote_cwd.clone(),
        _ => resolve_cli_cwd(&launch_cwd, cli.workspace_cwd.as_deref())?,
    };
    let config_cwd = match cli.config_cwd.as_deref() {
        Some(config_cwd) => resolve_cli_cwd(&launch_cwd, Some(config_cwd))?,
        None if cli.ssh_host.is_some() => launch_cwd.clone(),
        None => workspace_cwd.clone(),
    };
    let internal_mounts = internal_sandbox_mounts(&cli.sandbox)?;
    let config = load_managed_worker_runtime_config(&config_cwd)?;
    let options = ManagedWorkerOptions {
        workspace_cwd,
        config_cwd: Some(config_cwd),
        dispatch: WorkerDispatchOptions {
            session_id: cli.dispatch.session_id,
            thread_name: cli.dispatch.thread_name,
            dispatch_id: cli.dispatch.dispatch_id,
            action: cli.dispatch.action,
            source_threads: cli.dispatch.source_threads,
            skills: cli.dispatch.skills,
        },
        store: StoreOptions {
            store_path: cli.store.store_path,
        },
        model: ModelOptions {
            backend: cli.model.backend.map(Into::into),
            reasoning_effort: cli
                .model
                .reasoning_effort
                .map(Into::into)
                .map(OptionalModelOption::Value)
                .unwrap_or_default(),
            api_base_url: cli.model.api_base_url,
            api_model: cli.model.api_model,
            api_key_env: cli
                .model
                .api_key_env
                .map(OptionalModelOption::Value)
                .unwrap_or_default(),
            extra_headers: cli.model.extra_headers,
            light_model: None,
        },
        sandbox: SandboxOptions {
            sandbox: cli.sandbox.sandbox,
            no_mount_cwd: cli.sandbox.no_mount_cwd,
            mounts: cli.sandbox.mounts,
            mounts_ro: cli.sandbox.mounts_ro,
            internal_mounts,
            sandbox_image: cli.sandbox.sandbox_image,
            sandbox_gpus: cli.sandbox.sandbox_gpus,
            sandbox_shm_size: cli.sandbox.sandbox_shm_size,
            sandbox_session_key: cli.sandbox.sandbox_session_key,
            sandbox_workdir: cli.sandbox.sandbox_workdir,
            sandbox_backend: cli.sandbox.sandbox_backend,
            sandbox_cpus: cli.sandbox.sandbox_cpus,
            sandbox_mem: cli.sandbox.sandbox_mem,
            sandbox_activity_key: None,
        },
        ssh: runtime::SshOptions {
            host: cli.ssh_host,
            port: cli.ssh_port,
            identity_file: cli.ssh_identity_file,
        },
    };
    let mut run_config = runtime::build_managed_worker_config(options, &config).await?;
    let secret_store = cli
        .managed_secret_root
        .as_ref()
        .map(nac_core::managed::HostSecretStore::new);
    let github = match (
        cli.managed_secret_root.as_ref(),
        cli.managed_github_client_id,
    ) {
        (Some(root), Some(client_id)) => Some(nac_core::managed_github::ManagedGitHubAuth::new(
            root, client_id,
        )?),
        (_, None) => None,
        (None, Some(_)) => unreachable!("clap requires a managed secret root"),
    };
    run_config.set_managed_host_context(secret_store, github, cli.managed_home_root);
    runtime::run_managed_worker(run_config).await
}
fn internal_sandbox_mounts(args: &SandboxArgs) -> Result<Vec<(PathBuf, PathBuf, bool)>> {
    let mut mounts = Vec::new();
    for (values, read_only) in [
        (&args.sandbox_mounts, false),
        (&args.sandbox_mounts_ro, true),
    ] {
        for pair in values.as_chunks::<2>().0 {
            let host = PathBuf::from(pair[0].clone());
            let guest = PathBuf::from(pair[1].clone());
            if !host.exists() {
                return Err(anyhow!("mount source '{}' does not exist", host.display()));
            }
            if !guest.is_absolute() {
                return Err(anyhow!(
                    "mount target '{}' must be an absolute path inside the sandbox",
                    guest.display()
                ));
            }
            mounts.push((host, guest, read_only));
        }
    }
    Ok(mounts)
}

async fn run_codex_auth_cli(cli: CodexAuthCli) -> Result<()> {
    match cli.command {
        Some(command) => {
            let is_login = matches!(command, CodexAuthCommand::Login);
            run_codex_auth_action(codex_auth_action(command)).await?;
            if is_login {
                println!("Login complete. Run `nac-web` to start the dashboard.");
            }
            Ok(())
        }
        None => {
            let mut root = Cli::command();
            root.find_subcommand_mut("codex-auth")
                .expect("codex-auth command must exist")
                .print_help()?;
            println!();
            Ok(())
        }
    }
}

fn codex_auth_action(command: CodexAuthCommand) -> CodexAuthAction {
    match command {
        CodexAuthCommand::Login => CodexAuthAction::Login,
        CodexAuthCommand::Status => CodexAuthAction::Status,
        CodexAuthCommand::Logout => CodexAuthAction::Logout,
    }
}

async fn run_arcee_auth_cli(cli: ArceeAuthCli) -> Result<()> {
    match cli.command {
        Some(command) => {
            let is_login = matches!(command, ArceeAuthCommand::Login);
            run_arcee_auth_action(arcee_auth_action(command)).await?;
            if is_login {
                println!("Login complete. Run `nac-web` to start the dashboard.");
            }
            Ok(())
        }
        None => {
            let mut root = Cli::command();
            root.find_subcommand_mut("arcee-auth")
                .expect("arcee-auth command must exist")
                .print_help()?;
            println!();
            Ok(())
        }
    }
}

fn arcee_auth_action(command: ArceeAuthCommand) -> ArceeAuthAction {
    match command {
        ArceeAuthCommand::Login => ArceeAuthAction::Login,
        ArceeAuthCommand::Status => ArceeAuthAction::Status,
        ArceeAuthCommand::Logout => ArceeAuthAction::Logout,
    }
}

async fn run_upgrade_cli(cli: UpgradeCli) -> Result<()> {
    let request = UpgradeRequest {
        install_dir: cli.install_dir,
        executable_path: Some(
            std::env::current_exe().context("failed to determine nac-web executable path")?,
        ),
        package_version: RELEASE_VERSION.to_string(),
    };
    if !cli.pre_release {
        return run_upgrade(request).await;
    }

    let target = resolve_prerelease_upgrade(request).await?;
    eprintln!("{}", prerelease_warning(&target));
    let proceed = if cli.yes {
        true
    } else {
        if !io::stdin().is_terminal() {
            return Err(anyhow!(
                "prerelease upgrade requires interactive confirmation; automation must pass --yes"
            ));
        }
        eprint!("Continue with prerelease upgrade? [y/N] ");
        io::stderr()
            .flush()
            .context("failed to flush upgrade prompt")?;
        let mut input = String::new();
        let read = io::stdin()
            .read_line(&mut input)
            .context("failed to read prerelease upgrade confirmation")?;
        affirmative_prerelease_consent((read != 0).then_some(input.as_str()))
    };
    if !proceed {
        eprintln!("Prerelease upgrade cancelled.");
        return Ok(());
    }
    execute_prerelease_upgrade(target).await
}

fn prerelease_warning(target: &UpgradeTarget) -> String {
    let short_sha = target
        .commit_sha
        .get(..7)
        .unwrap_or(target.commit_sha.as_str());
    format!(
        "WARNING: prerelease upgrade requested\n\
         Current version: {}\n\
         Target: {} ({})\n\
         Source: {} ({})\n\
         Install directory: {}\n\
         Prerelease builds are unstable and may change local state in ways a stable build cannot roll back.\n\
         Restart nac-web after the upgrade completes.",
        target.current_version,
        target.tag,
        target.version,
        target.commit_sha,
        short_sha,
        target.install_dir.display()
    )
}

fn affirmative_prerelease_consent(input: Option<&str>) -> bool {
    let Some(input) = input else {
        return false;
    };
    let input = input.trim();
    input.eq_ignore_ascii_case("y") || input.eq_ignore_ascii_case("yes")
}

fn load_managed_worker_runtime_config(config_cwd: &std::path::Path) -> Result<runtime::NacConfig> {
    runtime::NacConfig::load_without_model_from_cwd(config_cwd)
}

fn resolve_cli_cwd(
    launch_cwd: &std::path::Path,
    directory: Option<&std::path::Path>,
) -> Result<PathBuf> {
    let target = match directory {
        Some(path) if path.is_absolute() => path.to_path_buf(),
        Some(path) => launch_cwd.join(path),
        None => launch_cwd.to_path_buf(),
    };
    target
        .canonicalize()
        .with_context(|| format!("failed to resolve working directory {}", target.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    static CONFIG_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn managed_worker_ignores_invalid_ambient_model_config() {
        let _guard = CONFIG_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let root = std::env::temp_dir().join(format!(
            "nac_web_worker_config_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("config.toml"),
            r#"
model = ["invalid-table-shape"]

[storage]
store_path = "worker-store.db"

[worker]
thread_timeout_secs = 7200
"#,
        )
        .unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &root);
        }

        let config = load_managed_worker_runtime_config(&root).unwrap();
        assert_eq!(
            config.storage.store_path.as_deref(),
            Some(std::path::Path::new("worker-store.db"))
        );
        assert_eq!(config.worker.thread_timeout_secs, Some(7_200));
        assert!(runtime::NacConfig::load_from_cwd(&root).is_err());

        unsafe {
            match original_nac_home {
                Some(value) => std::env::set_var("NAC_HOME", value),
                None => std::env::remove_var("NAC_HOME"),
            }
        }
        let _ = std::fs::remove_dir_all(root);
    }

    fn parse_server(args: &[&str]) -> ServerCli {
        let cli = Cli::try_parse_from(args.iter().copied()).unwrap();
        assert!(cli.command.is_none());
        cli.server
    }

    fn rendered_help(args: &[&str]) -> String {
        let error = Cli::try_parse_from(args.iter().copied())
            .err()
            .expect("--help must short-circuit parsing");
        assert_eq!(error.kind(), clap::error::ErrorKind::DisplayHelp);
        error.to_string()
    }

    #[test]
    fn worker_cli_rejects_malformed_header_json() {
        let error = Cli::try_parse_from([
            "nac-web",
            "__worker",
            "--session-id",
            "session",
            "--thread-name",
            "thread",
            "--dispatch-id",
            "dispatch-123",
            "--action",
            "work",
            "--extra-headers",
            "not-json",
        ])
        .err()
        .expect("malformed worker headers must be rejected")
        .to_string();
        assert!(error.contains("expected a JSON object"), "{error}");
    }

    #[test]
    fn worker_cli_parses_lossless_internal_mount_pairs() {
        let host = std::env::temp_dir().join(format!("nac:worker-mount-{}", std::process::id()));
        std::fs::create_dir_all(&host).unwrap();
        let args = vec![
            OsString::from("nac-web"),
            OsString::from("__worker"),
            OsString::from("--session-id"),
            OsString::from("session"),
            OsString::from("--thread-name"),
            OsString::from("thread"),
            OsString::from("--dispatch-id"),
            OsString::from("dispatch-123"),
            OsString::from("--action"),
            OsString::from("work"),
            OsString::from("--sandbox-mount"),
            host.as_os_str().to_owned(),
            OsString::from("/workspace"),
        ];
        let cli = Cli::try_parse_from(args).unwrap();
        let Some(RootCommand::ManagedWorker(worker)) = cli.command else {
            panic!("expected managed worker command");
        };
        assert_eq!(
            internal_sandbox_mounts(&worker.sandbox).unwrap(),
            vec![(host.clone(), PathBuf::from("/workspace"), false)]
        );
        std::fs::remove_dir_all(host).unwrap();
    }

    #[test]
    fn worker_cli_accepts_explicit_arcee_modes_and_rejects_removed_names() {
        let required = [
            "--session-id",
            "session",
            "--thread-name",
            "thread",
            "--dispatch-id",
            "dispatch-123",
            "--action",
            "work",
        ];
        for (raw, expected) in [
            ("arcee-auth", BackendKind::ArceeAuth),
            ("arcee-api", BackendKind::ArceeApi),
        ] {
            let mut args = vec!["nac-web", "__worker", "--backend", raw];
            args.extend(required);
            let cli = Cli::try_parse_from(args).unwrap();
            let Some(RootCommand::ManagedWorker(worker)) = cli.command else {
                panic!("expected managed worker command");
            };
            assert_eq!(worker.dispatch.dispatch_id, "dispatch-123");
            assert_eq!(worker.model.backend.map(BackendKind::from), Some(expected));
        }

        for raw in ["arcee", "auto"] {
            let mut args = vec!["nac-web", "__worker", "--backend", raw];
            args.extend(required);
            let error = Cli::try_parse_from(args)
                .err()
                .expect("removed backend must be rejected")
                .to_string();
            assert!(error.contains("invalid value"), "{error}");
            assert!(error.contains("arcee-auth"), "{error}");
            assert!(error.contains("arcee-api"), "{error}");
        }
    }

    #[test]
    fn auth_commands_parse_optional_actions() {
        let cli = Cli::try_parse_from(["nac-web", "codex-auth"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(RootCommand::CodexAuth(CodexAuthCli { command: None }))
        ));

        let cli = Cli::try_parse_from(["nac-web", "codex-auth", "status"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(RootCommand::CodexAuth(CodexAuthCli {
                command: Some(CodexAuthCommand::Status)
            }))
        ));

        let cli = Cli::try_parse_from(["nac-web", "arcee-auth"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(RootCommand::ArceeAuth(ArceeAuthCli { command: None }))
        ));

        let cli = Cli::try_parse_from(["nac-web", "arcee-auth", "login"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(RootCommand::ArceeAuth(ArceeAuthCli {
                command: Some(ArceeAuthCommand::Login)
            }))
        ));
    }

    #[test]
    fn upgrade_command_parses_arguments() {
        let cli = Cli::try_parse_from(["nac-web", "upgrade"]).unwrap();
        let Some(RootCommand::Upgrade(upgrade)) = cli.command else {
            panic!("expected upgrade command");
        };
        assert!(upgrade.install_dir.is_none());
        assert!(!upgrade.pre_release);
        assert!(!upgrade.yes);

        let cli = Cli::try_parse_from([
            "nac-web",
            "upgrade",
            "--install-dir",
            "/tmp/test",
            "--pre-release",
            "-y",
        ])
        .unwrap();
        let Some(RootCommand::Upgrade(upgrade)) = cli.command else {
            panic!("expected upgrade command");
        };
        assert_eq!(
            upgrade.install_dir.as_deref(),
            Some(std::path::Path::new("/tmp/test"))
        );
        assert!(upgrade.pre_release);
        assert!(upgrade.yes);

        let error = Cli::try_parse_from(["nac-web", "upgrade", "--yes"])
            .err()
            .expect("--yes without --pre-release must fail");
        assert_eq!(
            error.kind(),
            clap::error::ErrorKind::MissingRequiredArgument
        );
    }

    #[test]
    fn upgrade_help_describes_one_shot_prerelease_testing() {
        let help = rendered_help(&["nac-web", "upgrade", "--help"]);
        assert!(help.contains("Explicitly test"), "{help}");
        assert!(help.contains("once"), "{help}");
        assert!(
            help.contains("without joining a prerelease channel"),
            "{help}"
        );
    }

    #[test]
    fn prerelease_consent_is_fail_closed() {
        assert!(affirmative_prerelease_consent(Some("y\n")));
        assert!(affirmative_prerelease_consent(Some("YES\n")));
        for input in [Some("\n"), None, Some("n"), Some("no"), Some("later")] {
            assert!(!affirmative_prerelease_consent(input));
        }
    }

    #[test]
    fn prerelease_warning_identifies_exact_target_even_with_yes() {
        let target = UpgradeTarget {
            current_version: "0.1.1".to_string(),
            tag: "v0.1.2-rc.10".to_string(),
            version: "0.1.2-rc.10".to_string(),
            commit_sha: "0123456789abcdef0123456789abcdef01234567".to_string(),
            install_dir: PathBuf::from("/tmp/nac"),
            asset_name: "nac-aarch64-apple-darwin.tar.gz".to_string(),
            uninstall_url: "https://example.test/uninstall.sh".to_string(),
            install_url: "https://example.test/install.sh".to_string(),
            asset_base_url: "https://example.test/release".to_string(),
        };
        let warning = prerelease_warning(&target);
        for expected in [
            "0.1.1",
            "v0.1.2-rc.10",
            "0123456789abcdef0123456789abcdef01234567",
            "0123456",
            "/tmp/nac",
            "unstable",
            "local state",
            "Restart",
        ] {
            assert!(warning.contains(expected), "missing {expected}: {warning}");
        }
        let cli = Cli::try_parse_from(["nac-web", "upgrade", "--pre-release", "--yes"]).unwrap();
        let Some(RootCommand::Upgrade(upgrade)) = cli.command else {
            panic!("expected upgrade command");
        };
        assert!(upgrade.yes);
    }

    #[test]
    fn server_cli_resolves_bind_address() {
        let cases: &[(&[&str], &str)] = &[
            (&["nac-web"], "127.0.0.1:3210"),
            (&["nac-web", "--port", "4321"], "127.0.0.1:4321"),
            (&["nac-web", "--bind", "[::1]:4322"], "[::1]:4322"),
        ];

        for (args, expected) in cases {
            assert_eq!(parse_server(args).bind_addr(), expected.parse().unwrap());
        }
    }

    #[test]
    fn managed_configuration_is_explicit_and_ordinary_server_cli_remains_unmanaged() {
        let ordinary = parse_server(&["nac-web"]);
        assert!(ordinary.managed_config.is_none());

        let managed = parse_server(&["nac-web", "--managed-config", "/etc/nac/managed.toml"]);
        assert_eq!(
            managed.managed_config.as_deref(),
            Some(std::path::Path::new("/etc/nac/managed.toml"))
        );
    }

    #[tokio::test]
    async fn github_credential_helper_is_https_github_scoped_and_returns_the_current_token() {
        let root = std::env::temp_dir().join(format!(
            "nac-github-helper-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let auth = nac_core::managed_github::ManagedGitHubAuth::new(&root, "Iv1.test").unwrap();
        auth.store_test_authorization("helper-access-canary", "helper-refresh-canary", u64::MAX)
            .unwrap();
        let cli = GitHubCredentialCli {
            state_root: root.clone(),
            client_id: "Iv1.test".to_string(),
            operation: "get".to_string(),
        };

        let token = resolve_github_credential(
            &cli,
            "protocol=https\nhost=github.com\npath=arcee-ai/repo.git\n\n",
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(token.secret(), "helper-access-canary");
        assert!(resolve_github_credential(
            &cli,
            "protocol=https\nhost=example.com\npath=arcee-ai/repo.git\n\n"
        )
        .await
        .unwrap()
        .is_none());
        assert!(
            resolve_github_credential(&cli, "protocol=http\nhost=github.com\n\n")
                .await
                .unwrap()
                .is_none()
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn remote_binding_requires_explicit_acknowledgement() {
        let guarded = parse_server(&["nac-web", "--bind", "0.0.0.0:3210"]);
        assert_eq!(guarded.bind_policy(), BindPolicy::LoopbackOnly);

        let allowed = parse_server(&["nac-web", "--bind", "192.168.1.20:3210", "--allow-remote"]);
        assert_eq!(allowed.bind_policy(), BindPolicy::AllowRemote);
    }

    #[test]
    fn server_cli_rejects_bind_with_port() {
        let error = Cli::try_parse_from(["nac-web", "--bind", "127.0.0.1:4321", "--port", "4322"])
            .err()
            .expect("explicit --bind and --port must conflict");
        assert_eq!(error.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn server_cli_rejects_ports_outside_supported_range() {
        for port in ["0", "65536"] {
            let error = Cli::try_parse_from(["nac-web", "--port", port])
                .err()
                .expect("out-of-range port must be rejected");
            assert_eq!(error.kind(), clap::error::ErrorKind::ValueValidation);
        }
    }

    #[test]
    fn server_options_cannot_be_mixed_with_commands() {
        for args in [
            &["nac-web", "--no-open", "codex-auth"][..],
            &["nac-web", "codex-auth", "--no-open"],
            &["nac-web", "--no-open", "arcee-auth"],
            &["nac-web", "arcee-auth", "--no-open"],
            &["nac-web", "--no-open", "upgrade"],
            &["nac-web", "upgrade", "--no-open"],
            &["nac-web", "--no-open", "__worker"],
            &["nac-web", "__worker", "--no-open"],
        ] {
            assert!(
                Cli::try_parse_from(args.iter().copied()).is_err(),
                "{args:?}"
            );
        }
    }

    #[test]
    fn root_help_and_version_take_precedence_over_following_commands() {
        let help = Cli::try_parse_from(["nac-web", "--help", "upgrade"])
            .err()
            .expect("--help must short-circuit parsing");
        assert_eq!(help.kind(), clap::error::ErrorKind::DisplayHelp);

        let version = Cli::try_parse_from(["nac-web", "--version", "upgrade"])
            .err()
            .expect("--version must short-circuit parsing");
        assert_eq!(version.kind(), clap::error::ErrorKind::DisplayVersion);
    }

    #[test]
    fn public_version_flags_preserve_build_identity() {
        for prefix in [
            &["nac-web"][..],
            &["nac-web", "codex-auth"],
            &["nac-web", "arcee-auth"],
            &["nac-web", "upgrade"],
        ] {
            let mut long_args = prefix.to_vec();
            long_args.push("--version");
            let error = Cli::try_parse_from(long_args)
                .err()
                .expect("--version must short-circuit parsing");
            assert_eq!(error.kind(), clap::error::ErrorKind::DisplayVersion);
            let rendered = error.to_string();
            assert!(rendered.contains(RELEASE_VERSION), "{rendered}");
            assert!(rendered.contains(env!("NAC_BUILD_REVISION")), "{rendered}");

            let mut short_args = prefix.to_vec();
            short_args.push("-V");
            let short = Cli::try_parse_from(short_args)
                .err()
                .expect("-V must short-circuit parsing");
            assert_eq!(short.kind(), clap::error::ErrorKind::DisplayVersion);
            let short_rendered = short.to_string();
            assert!(short_rendered.contains(RELEASE_VERSION), "{short_rendered}");
            assert!(!short_rendered.contains('('), "{short_rendered}");
        }
    }

    #[test]
    fn version_flags_are_not_added_to_actions_or_internal_worker() {
        for args in [
            &["nac-web", "codex-auth", "login", "--version"][..],
            &["nac-web", "arcee-auth", "status", "--version"],
            &["nac-web", "__worker", "--version"],
        ] {
            let error = Cli::try_parse_from(args.iter().copied())
                .err()
                .expect("version must remain unsupported");
            assert_ne!(error.kind(), clap::error::ErrorKind::DisplayVersion);
        }
    }

    #[test]
    fn root_help_documents_public_command_and_server_contracts() {
        let help = rendered_help(&["nac-web", "--help"]);
        for expected in [
            "With no command, nac-web serves the selected project",
            "codex-auth",
            "Manage ChatGPT credentials used by Codex models",
            "arcee-auth",
            "Manage Arcee account credentials",
            "upgrade",
            "Download and reinstall the latest nac-web release",
            "-p, --port <PORT>",
            "127.0.0.1",
            "1-65535",
            "default: 3210",
            "Cannot be used with --bind",
            "--allow-remote",
            "equivalent to the local user",
        ] {
            assert!(help.contains(expected), "missing {expected:?}:\n{help}");
        }
        for hidden in ["__worker", "--session-id"] {
            assert!(!help.contains(hidden), "unexpected {hidden:?}:\n{help}");
        }
        assert!(help.contains("\n  help "));

        for args in [&["nac-web", "help"][..], &["nac-web", "help", "upgrade"]] {
            let generated_help = Cli::try_parse_from(args.iter().copied())
                .err()
                .expect("generated root help command must be available");
            assert_eq!(generated_help.kind(), clap::error::ErrorKind::DisplayHelp);
        }
    }

    #[test]
    fn auth_group_help_lists_every_action() {
        for (group, credential) in [
            ("codex-auth", "ChatGPT credentials"),
            ("arcee-auth", "Arcee account credentials"),
        ] {
            let help = rendered_help(&["nac-web", group, "--help"]);
            for expected in ["login", "status", "logout", "help", credential] {
                assert!(help.contains(expected), "missing {expected:?}:\n{help}");
            }

            for args in [
                &["nac-web", group, "help"][..],
                &["nac-web", group, "help", "login"],
            ] {
                let generated_help = Cli::try_parse_from(args.iter().copied())
                    .err()
                    .expect("generated auth help command must be available");
                assert_eq!(generated_help.kind(), clap::error::ErrorKind::DisplayHelp);
            }
        }
    }

    #[test]
    fn auth_action_help_explains_all_six_actions() {
        for (group, action, summary) in [
            (
                "codex-auth",
                "login",
                "Sign in to ChatGPT using device code authorization",
            ),
            (
                "codex-auth",
                "status",
                "Show stored ChatGPT credential status",
            ),
            ("codex-auth", "logout", "Remove stored ChatGPT credentials"),
            (
                "arcee-auth",
                "login",
                "Sign in to Arcee using device code authorization",
            ),
            (
                "arcee-auth",
                "status",
                "Show stored Arcee credential status",
            ),
            ("arcee-auth", "logout", "Remove stored Arcee credentials"),
        ] {
            let help = rendered_help(&["nac-web", group, action, "--help"]);
            let usage = format!("Usage: nac-web {group} {action}");
            assert!(help.contains(&usage), "missing {usage:?}:\n{help}");
            assert!(help.contains(summary), "missing {summary:?}:\n{help}");
        }
    }

    #[test]
    fn upgrade_help_documents_reinstall_and_install_directory() {
        let help = rendered_help(&["nac-web", "upgrade", "--help"]);
        for expected in [
            "Download and reinstall the latest nac-web release",
            "--install-dir <INSTALL_DIR>",
            "$INSTALL_DIR",
            "current nac-web executable directory",
        ] {
            assert!(help.contains(expected), "missing {expected:?}:\n{help}");
        }
    }
}
