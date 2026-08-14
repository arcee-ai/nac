use std::{
    ffi::{OsStr, OsString},
    io::{self, IsTerminal, Write},
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    process,
};

use anyhow::{anyhow, Context, Result};
use clap::{CommandFactory, Parser, Subcommand};
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
#[command(name = "nac-web", about = "web dashboard for managing nac sessions", version = RELEASE_VERSION, long_version = BUILD_VERSION)]
struct ServerCli {
    /// Address to bind (default: localhost only).
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

    /// Project directory (skips the interactive confirmation).
    ///
    /// Without this flag an interactive terminal confirms the current working
    /// directory, or asks for another path. Non-interactive runs use cwd.
    #[arg(short = 'C', long)]
    directory: Option<PathBuf>,

    /// Accept the current working directory without prompting.
    #[arg(short = 'y', long, action = clap::ArgAction::SetTrue)]
    yes: bool,

    /// Override the server SQLite store path.
    #[arg(long)]
    store_path: Option<PathBuf>,

    /// Worker executable for managed worker dispatch. Defaults to this nac-web binary.
    #[arg(long)]
    worker_executable: Option<PathBuf>,

    /// Open the dashboard in the default browser after listening.
    ///
    /// Interactive terminals open by default; pass `--no-open` to skip, or set
    /// `BROWSER=none`. `--open` forces a window even when stdin is not a TTY.
    #[arg(long, action = clap::ArgAction::SetTrue)]
    open: bool,

    /// Do not open a browser window.
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

#[derive(Parser)]
#[command(name = "nac-web codex-auth", about = "manage ChatGPT Codex auth", version = RELEASE_VERSION, long_version = BUILD_VERSION)]
struct CodexAuthCli {
    #[command(subcommand)]
    command: Option<CodexAuthCommand>,
}

#[derive(Subcommand)]
enum CodexAuthCommand {
    /// Sign in with ChatGPT using device code authorization
    Login,
    /// Show stored Codex auth status
    Status,
    /// Remove stored Codex auth
    Logout,
}

#[derive(Parser)]
#[command(name = "nac-web arcee-auth", about = "manage Arcee auth", version = RELEASE_VERSION, long_version = BUILD_VERSION)]
struct ArceeAuthCli {
    #[command(subcommand)]
    command: Option<ArceeAuthCommand>,
}

#[derive(Subcommand)]
enum ArceeAuthCommand {
    /// Sign in with Arcee using device code authorization
    Login,
    /// Show stored Arcee auth status
    Status,
    /// Remove stored Arcee auth
    Logout,
}

#[derive(Parser)]
#[command(
    name = "nac-web upgrade",
    about = "reinstall the latest nac-web release",
    version = RELEASE_VERSION,
    long_version = BUILD_VERSION
)]
struct UpgradeCli {
    /// Install directory to replace (default: current nac-web executable directory)
    #[arg(long)]
    install_dir: Option<PathBuf>,

    /// Explicitly test the newest active candidate once without joining a prerelease channel
    #[arg(long)]
    pre_release: bool,

    /// Proceed without an interactive prompt (requires --pre-release)
    #[arg(short = 'y', long, requires = "pre_release")]
    yes: bool,
}

#[derive(Parser)]
#[command(
    name = "nac-web __worker",
    about = "internal managed worker dispatch",
    hide = true
)]
struct ManagedWorkerCli {
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

enum ParsedCli {
    Serve(ServerCli),
    ManagedWorker(ManagedWorkerCli),
    CodexAuth(CodexAuthCli),
    ArceeAuth(ArceeAuthCli),
    Upgrade(UpgradeCli),
}

fn parse_cli() -> ParsedCli {
    let args: Vec<OsString> = std::env::args_os().collect();
    if args
        .get(1)
        .is_some_and(|value| value == OsStr::new("__worker"))
    {
        ParsedCli::ManagedWorker(ManagedWorkerCli::parse_from(subcommand_args(
            args,
            "nac-web __worker",
        )))
    } else if args
        .get(1)
        .is_some_and(|value| value == OsStr::new("codex-auth"))
    {
        ParsedCli::CodexAuth(CodexAuthCli::parse_from(subcommand_args(
            args,
            "nac-web codex-auth",
        )))
    } else if args
        .get(1)
        .is_some_and(|value| value == OsStr::new("arcee-auth"))
    {
        ParsedCli::ArceeAuth(ArceeAuthCli::parse_from(subcommand_args(
            args,
            "nac-web arcee-auth",
        )))
    } else if args
        .get(1)
        .is_some_and(|value| value == OsStr::new("upgrade"))
    {
        ParsedCli::Upgrade(UpgradeCli::parse_from(subcommand_args(
            args,
            "nac-web upgrade",
        )))
    } else {
        ParsedCli::Serve(ServerCli::parse_from(args))
    }
}

fn subcommand_args(args: Vec<OsString>, name: &str) -> Vec<OsString> {
    let mut parsed = Vec::with_capacity(args.len().saturating_sub(1));
    parsed.push(OsString::from(name));
    parsed.extend(args.into_iter().skip(2));
    parsed
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("Error: {error:#}");
        process::exit(1);
    }
}

async fn run() -> Result<()> {
    match parse_cli() {
        ParsedCli::Serve(cli) => run_server(cli).await,
        ParsedCli::ManagedWorker(cli) => run_managed_worker(cli).await,
        ParsedCli::CodexAuth(cli) => run_codex_auth_cli(cli).await,
        ParsedCli::ArceeAuth(cli) => run_arcee_auth_cli(cli).await,
        ParsedCli::Upgrade(cli) => run_upgrade_cli(cli).await,
    }
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
    let manager = SessionManager::new(ServerOptions {
        root_cwd,
        store_path: cli.store_path,
        worker_executable: cli.worker_executable,
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
            sandbox_image: cli.sandbox.sandbox_image,
            sandbox_gpus: cli.sandbox.sandbox_gpus,
            sandbox_shm_size: cli.sandbox.sandbox_shm_size,
            sandbox_session_key: cli.sandbox.sandbox_session_key,
            sandbox_workdir: cli.sandbox.sandbox_workdir,
            sandbox_backend: cli.sandbox.sandbox_backend,
            sandbox_cpus: cli.sandbox.sandbox_cpus,
            sandbox_mem: cli.sandbox.sandbox_mem,
        },
        ssh: runtime::SshOptions {
            host: cli.ssh_host,
            port: cli.ssh_port,
            identity_file: cli.ssh_identity_file,
        },
    };
    runtime::run_managed_worker(runtime::build_managed_worker_config(options, &config).await?).await
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
            let mut command = CodexAuthCli::command();
            command.print_help()?;
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
            let mut command = ArceeAuthCli::command();
            command.print_help()?;
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

    #[test]
    fn worker_cli_rejects_malformed_header_json() {
        let error = ManagedWorkerCli::try_parse_from([
            "nac-web __worker",
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
            let mut args = vec!["nac-web __worker", "--backend", raw];
            args.extend(required);
            let cli = ManagedWorkerCli::try_parse_from(args).unwrap();
            assert_eq!(cli.dispatch.dispatch_id, "dispatch-123");
            assert_eq!(cli.model.backend.map(BackendKind::from), Some(expected));
        }

        for raw in ["arcee", "auto"] {
            let mut args = vec!["nac-web __worker", "--backend", raw];
            args.extend(required);
            let error = ManagedWorkerCli::try_parse_from(args)
                .err()
                .expect("removed backend must be rejected")
                .to_string();
            assert!(error.contains("invalid value"), "{error}");
            assert!(error.contains("arcee-auth"), "{error}");
            assert!(error.contains("arcee-api"), "{error}");
        }
    }

    #[test]
    fn codex_auth_command_parses_subcommands() {
        let cli = CodexAuthCli::try_parse_from(["nac-web codex-auth"]).unwrap();
        assert!(cli.command.is_none());

        let cli = CodexAuthCli::try_parse_from(["nac-web codex-auth", "status"]).unwrap();
        assert!(matches!(cli.command, Some(CodexAuthCommand::Status)));
    }

    #[test]
    fn arcee_auth_command_parses_subcommands() {
        let cli = ArceeAuthCli::try_parse_from(["nac-web arcee-auth"]).unwrap();
        assert!(cli.command.is_none());

        let cli = ArceeAuthCli::try_parse_from(["nac-web arcee-auth", "login"]).unwrap();
        assert!(matches!(cli.command, Some(ArceeAuthCommand::Login)));
    }

    #[test]
    fn upgrade_command_parses_arguments() {
        let cli = UpgradeCli::try_parse_from(["nac-web upgrade"]).unwrap();
        assert!(cli.install_dir.is_none());
        assert!(!cli.pre_release);
        assert!(!cli.yes);

        let cli = UpgradeCli::try_parse_from([
            "nac-web upgrade",
            "--install-dir",
            "/tmp/test",
            "--pre-release",
            "-y",
        ])
        .unwrap();
        assert_eq!(
            cli.install_dir.as_deref(),
            Some(std::path::Path::new("/tmp/test"))
        );
        assert!(cli.pre_release);
        assert!(cli.yes);

        let error = UpgradeCli::try_parse_from(["nac-web upgrade", "--yes"])
            .err()
            .expect("--yes without --pre-release must fail");
        assert_eq!(
            error.kind(),
            clap::error::ErrorKind::MissingRequiredArgument
        );
    }

    #[test]
    fn upgrade_help_describes_one_shot_prerelease_testing() {
        let help = UpgradeCli::command().render_long_help().to_string();
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
        let cli =
            UpgradeCli::try_parse_from(["nac-web upgrade", "--pre-release", "--yes"]).unwrap();
        assert!(cli.yes);
    }

    #[test]
    fn server_cli_resolves_bind_address() {
        let cases: &[(&[&str], &str)] = &[
            (&["nac-web"], "127.0.0.1:3210"),
            (&["nac-web", "--port", "4321"], "127.0.0.1:4321"),
            (&["nac-web", "--bind", "[::1]:4322"], "[::1]:4322"),
        ];

        for (args, expected) in cases {
            let cli = ServerCli::try_parse_from(*args).unwrap();
            assert_eq!(cli.bind_addr(), expected.parse().unwrap());
        }
    }

    #[test]
    fn remote_binding_requires_explicit_acknowledgement() {
        let guarded = ServerCli::try_parse_from(["nac-web", "--bind", "0.0.0.0:3210"]).unwrap();
        assert_eq!(guarded.bind_policy(), BindPolicy::LoopbackOnly);

        let allowed =
            ServerCli::try_parse_from(["nac-web", "--bind", "192.168.1.20:3210", "--allow-remote"])
                .unwrap();
        assert_eq!(allowed.bind_policy(), BindPolicy::AllowRemote);
    }

    #[test]
    fn server_cli_rejects_bind_with_port() {
        let error =
            ServerCli::try_parse_from(["nac-web", "--bind", "127.0.0.1:4321", "--port", "4322"])
                .err()
                .expect("explicit --bind and --port must conflict");
        assert_eq!(error.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn server_cli_rejects_ports_outside_supported_range() {
        for port in ["0", "65536"] {
            let error = ServerCli::try_parse_from(["nac-web", "--port", port])
                .err()
                .expect("out-of-range port must be rejected");
            assert_eq!(error.kind(), clap::error::ErrorKind::ValueValidation);
        }
    }

    #[test]
    fn server_cli_version_reports_build_identity() {
        let error = ServerCli::try_parse_from(["nac-web", "--version"])
            .err()
            .expect("--version must short-circuit parsing");
        assert_eq!(error.kind(), clap::error::ErrorKind::DisplayVersion);
        let rendered = error.to_string();
        assert_eq!(
            rendered,
            format!(
                "nac-web {} ({})\n",
                RELEASE_VERSION,
                env!("NAC_BUILD_REVISION")
            )
        );

        // Rust CLI convention: the short flag prints the bare package version.
        let short = ServerCli::try_parse_from(["nac-web", "-V"])
            .err()
            .expect("-V must short-circuit parsing");
        assert_eq!(short.kind(), clap::error::ErrorKind::DisplayVersion);
        let short_rendered = short.to_string();
        assert_eq!(short_rendered, format!("nac-web {RELEASE_VERSION}\n"));
    }

    #[test]
    fn server_cli_help_documents_port_contract() {
        let help = ServerCli::command().render_long_help().to_string();
        assert!(help.contains("-p, --port <PORT>"), "{help}");
        assert!(help.contains("127.0.0.1"), "{help}");
        assert!(help.contains("1-65535"), "{help}");
        assert!(help.contains("default: 3210"), "{help}");
        assert!(help.contains("Cannot be used with --bind"), "{help}");
        assert!(help.contains("--allow-remote"), "{help}");
        assert!(help.contains("equivalent to the local user"), "{help}");
    }
}
