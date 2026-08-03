use std::{
    ffi::{OsStr, OsString},
    net::SocketAddr,
    path::PathBuf,
    process,
};

use anyhow::{Context, Result};
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
    upgrade::{run_upgrade, UpgradeRequest},
};
use nac_server::{serve, ServerOptions, SessionManager};

#[derive(Parser)]
#[command(name = "nac-web", about = "web dashboard for managing nac sessions")]
struct ServerCli {
    /// Address to bind (default: localhost only).
    #[arg(long, default_value = "127.0.0.1:3210")]
    bind: SocketAddr,

    /// Server root directory for default config and relative store paths.
    #[arg(short = 'C', long)]
    directory: Option<PathBuf>,

    /// Override the server SQLite store path.
    #[arg(long)]
    store_path: Option<PathBuf>,

    /// Worker executable for managed worker dispatch. Defaults to this nac-web binary.
    #[arg(long)]
    worker_executable: Option<PathBuf>,
}

#[derive(Parser)]
#[command(name = "nac-web codex-auth", about = "manage ChatGPT Codex auth")]
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
#[command(name = "nac-web arcee-auth", about = "manage Arcee auth")]
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
#[command(name = "nac-web upgrade", about = "reinstall the latest nac-web release")]
struct UpgradeCli {
    /// Install directory to replace (default: current nac-web executable directory)
    #[arg(long)]
    install_dir: Option<PathBuf>,
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
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = resolve_cli_cwd(&launch_cwd, cli.directory.as_deref())?;
    let manager = SessionManager::new(ServerOptions {
        root_cwd,
        store_path: cli.store_path,
        worker_executable: cli.worker_executable,
    })?;
    // Fire-and-forget models.dev catalog overlay refresh (4h cadence,
    // ETag-revalidated, never on picker/resume/validation paths).
    nac_core::model::spawn_overlay_refresh();
    let info = manager.store_info();
    eprintln!("nac-web listening on http://{}", cli.bind);
    eprintln!("store: {}", info.store_path.display());
    serve(cli.bind, manager).await
}

async fn run_managed_worker(cli: ManagedWorkerCli) -> Result<()> {
    // Fire-and-forget models.dev catalog overlay refresh; cadence-gated via
    // the sidecar, so usually a no-op read. Keeps the overlay fresh for
    // worker-heavy usage even when the server is not running.
    nac_core::model::spawn_overlay_refresh();
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
        ssh_host: cli.ssh_host,
    };
    runtime::run_managed_worker(runtime::build_managed_worker_config(options, &config).await?).await
}

async fn run_codex_auth_cli(cli: CodexAuthCli) -> Result<()> {
    match cli.command {
        Some(command) => run_codex_auth_action(codex_auth_action(command)).await,
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
        Some(command) => run_arcee_auth_action(arcee_auth_action(command)).await,
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
    run_upgrade(UpgradeRequest {
        install_dir: cli.install_dir,
        executable_path: Some(std::env::current_exe().context(
            "failed to determine nac-web executable path",
        )?),
        package_version: env!("CARGO_PKG_VERSION").to_string(),
    })
    .await
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
        assert!(config.model.backend.is_none());
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

        let cli =
            UpgradeCli::try_parse_from(["nac-web upgrade", "--install-dir", "/tmp/test"]).unwrap();
        assert_eq!(
            cli.install_dir.as_deref(),
            Some(std::path::Path::new("/tmp/test"))
        );
    }
}
