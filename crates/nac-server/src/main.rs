use std::{
    ffi::{OsStr, OsString},
    net::SocketAddr,
    path::PathBuf,
    process,
};

#[cfg(feature = "share-ngrok")]
use std::io::{self, Write};

use anyhow::{Context, Result};
use clap::Parser;
use nac_core::{
    model::{BackendKind, ReasoningEffort},
    runtime::{
        self, ManagedWorkerOptions, ModelOptions, SandboxOptions, StoreOptions,
        WorkerDispatchOptions,
    },
};
use nac_server::{serve, ServerOptions, SessionManager};

#[cfg(feature = "share-ngrok")]
mod share;

#[derive(Parser)]
#[command(
    name = "nac-web",
    about = "web dashboard for managing nac sessions",
    after_help = "Commands:\n  share             Share nac-web through ngrok (run-only)\n  share configure   Persist ngrok share setup\n  share doctor      Check ngrok share setup\n  share status      Show saved ngrok share config"
)]
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

#[cfg(feature = "share-ngrok")]
#[derive(clap::Args, Clone)]
struct ShareServerArgs {
    /// Address to bind nac-web to. Share mode requires loopback unless --insecure-bind is set.
    #[arg(long, default_value = "127.0.0.1:3210")]
    bind: SocketAddr,

    /// Allow share mode to bind a non-loopback address. Unsafe without another network boundary.
    #[arg(long)]
    insecure_bind: bool,

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

#[cfg(feature = "share-ngrok")]
#[derive(Parser)]
#[command(
    name = "nac-web share",
    about = "Share nac-web through ngrok (run-only; does not persist config or secrets)",
    after_help = "Commands:
  configure   Persist ngrok share setup
  doctor      Check ngrok share setup
  status      Show saved ngrok share config"
)]
struct ShareRunCli {
    #[command(flatten)]
    server: ShareServerArgs,

    /// Reserved ngrok domain for paid/custom-domain accounts. Ephemeral for this run.
    #[arg(long)]
    domain: Option<String>,

    /// Environment variable that contains the ngrok authtoken. Ephemeral for this run.
    #[arg(long)]
    authtoken_env: Option<String>,

    /// Google account email allowed through ngrok OAuth. Can be repeated. Ephemeral for this run.
    #[arg(long = "allow-email")]
    allow_emails: Vec<String>,

    /// Google Workspace/email domain allowed through ngrok OAuth. Can be repeated. Ephemeral for this run.
    #[arg(long = "allow-domain")]
    allow_domains: Vec<String>,

    /// Disable ngrok OAuth protection for this run only.
    #[arg(long)]
    no_auth: bool,
}

#[cfg(feature = "share-ngrok")]
#[derive(Parser)]
#[command(
    name = "nac-web share configure",
    about = "Persist ngrok share configuration and optional local secret"
)]
struct ShareConfigureCli {
    #[command(flatten)]
    server: ShareServerArgs,

    /// Reserved ngrok domain for paid/custom-domain accounts.
    #[arg(long)]
    domain: Option<String>,

    /// Environment variable that contains the ngrok authtoken.
    #[arg(long)]
    authtoken_env: Option<String>,

    /// OAuth provider to request at the ngrok edge.
    #[arg(long)]
    oauth_provider: Option<String>,

    /// Google account email allowed through ngrok OAuth. Can be repeated.
    #[arg(long = "allow-email")]
    allow_emails: Vec<String>,

    /// Google Workspace/email domain allowed through ngrok OAuth. Can be repeated.
    #[arg(long = "allow-domain")]
    allow_domains: Vec<String>,

    /// Persist auth_required = false after explicit confirmation.
    #[arg(long)]
    no_auth: bool,

    /// Do not save a prompted ngrok authtoken to NAC_HOME/secrets.toml.
    #[arg(long)]
    no_save_token: bool,

    /// Accept dangerous confirmations non-interactively.
    #[arg(long)]
    yes: bool,
}

#[cfg(feature = "share-ngrok")]
#[derive(Parser)]
#[command(
    name = "nac-web share doctor",
    about = "Check ngrok share configuration and local health"
)]
struct ShareDoctorCli {
    #[command(flatten)]
    server: ShareServerArgs,

    /// Reserved ngrok domain override.
    #[arg(long)]
    domain: Option<String>,

    /// Environment variable that contains the ngrok authtoken.
    #[arg(long)]
    authtoken_env: Option<String>,

    /// Google account email allowed through ngrok OAuth. Can be repeated.
    #[arg(long = "allow-email")]
    allow_emails: Vec<String>,

    /// Google Workspace/email domain allowed through ngrok OAuth. Can be repeated.
    #[arg(long = "allow-domain")]
    allow_domains: Vec<String>,

    /// Disable ngrok OAuth protection for this doctor invocation.
    #[arg(long)]
    no_auth: bool,

    /// Skip the local /health check.
    #[arg(long)]
    skip_health: bool,
}

#[cfg(feature = "share-ngrok")]
#[derive(Parser)]
#[command(name = "nac-web share status", about = "Show saved ngrok share config")]
struct ShareStatusCli {
    #[command(flatten)]
    server: ShareServerArgs,

    /// Reserved ngrok domain override.
    #[arg(long)]
    domain: Option<String>,

    /// Environment variable that contains the ngrok authtoken.
    #[arg(long)]
    authtoken_env: Option<String>,
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

    /// Internal local cwd used to resolve nac config for managed workers.
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
    #[value(name = "auto")]
    Auto,
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
}

impl From<BackendArg> for BackendKind {
    fn from(value: BackendArg) -> Self {
        match value {
            BackendArg::Auto => Self::Auto,
            BackendArg::DeepSeekChat => Self::DeepSeekChat,
            BackendArg::FireworksChat => Self::FireworksChat,
            BackendArg::TogetherChat => Self::TogetherChat,
            BackendArg::OpenAiResponses => Self::OpenAiResponses,
            BackendArg::ChatGptCodexResponses => Self::ChatGptCodexResponses,
            BackendArg::AnthropicMessages => Self::AnthropicMessages,
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
    /// Backend wire shape to use for model requests.
    #[arg(long, value_enum)]
    backend: Option<BackendArg>,

    /// Reasoning effort to request when supported by the selected backend.
    #[arg(long = "effort", value_enum)]
    reasoning_effort: Option<ReasoningEffortArg>,

    /// Internal API base URL override used by managed workers.
    #[arg(long, hide = true)]
    api_base_url: Option<String>,

    /// Internal model override used by managed workers.
    #[arg(long, hide = true)]
    api_model: Option<String>,

    /// Internal api_key_env override used by managed workers to inherit session config.
    #[arg(long = "api-key-env", hide = true)]
    api_key_env: Option<String>,

    /// Internal extra headers override (JSON object) used by managed workers to inherit session config.
    #[arg(long = "extra-headers", hide = true)]
    extra_headers: Option<String>,
}

#[derive(clap::Args)]
struct WorkerDispatchArgs {
    /// Session id for the managed worker dispatch.
    #[arg(long)]
    session_id: String,

    /// Thread name for the managed worker dispatch.
    #[arg(long)]
    thread_name: String,

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

    /// Sandbox backend to use (podman or smolvm).
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
    #[cfg(feature = "share-ngrok")]
    ShareRun(ShareRunCli),
    #[cfg(feature = "share-ngrok")]
    ShareConfigure(ShareConfigureCli),
    #[cfg(feature = "share-ngrok")]
    ShareDoctor(ShareDoctorCli),
    #[cfg(feature = "share-ngrok")]
    ShareStatus(ShareStatusCli),
    #[cfg(not(feature = "share-ngrok"))]
    ShareUnavailable,
    ManagedWorker(ManagedWorkerCli),
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
        .is_some_and(|value| value == OsStr::new("share"))
    {
        #[cfg(feature = "share-ngrok")]
        {
            match args.get(2).and_then(|value| value.to_str()) {
                Some("configure") => ParsedCli::ShareConfigure(ShareConfigureCli::parse_from(
                    nested_subcommand_args(args, "nac-web share configure", 3),
                )),
                Some("doctor") => ParsedCli::ShareDoctor(ShareDoctorCli::parse_from(
                    nested_subcommand_args(args, "nac-web share doctor", 3),
                )),
                Some("status") => ParsedCli::ShareStatus(ShareStatusCli::parse_from(
                    nested_subcommand_args(args, "nac-web share status", 3),
                )),
                _ => ParsedCli::ShareRun(ShareRunCli::parse_from(subcommand_args(
                    args,
                    "nac-web share",
                ))),
            }
        }
        #[cfg(not(feature = "share-ngrok"))]
        {
            ParsedCli::ShareUnavailable
        }
    } else {
        ParsedCli::Serve(ServerCli::parse_from(args))
    }
}

fn subcommand_args(args: Vec<OsString>, name: &str) -> Vec<OsString> {
    nested_subcommand_args(args, name, 2)
}

fn nested_subcommand_args(args: Vec<OsString>, name: &str, skip: usize) -> Vec<OsString> {
    let mut parsed = Vec::with_capacity(args.len().saturating_sub(1));
    parsed.push(OsString::from(name));
    parsed.extend(args.into_iter().skip(skip));
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
        #[cfg(feature = "share-ngrok")]
        ParsedCli::ShareRun(cli) => run_share(cli).await,
        #[cfg(feature = "share-ngrok")]
        ParsedCli::ShareConfigure(cli) => run_share_configure(cli).await,
        #[cfg(feature = "share-ngrok")]
        ParsedCli::ShareDoctor(cli) => run_share_doctor(cli).await,
        #[cfg(feature = "share-ngrok")]
        ParsedCli::ShareStatus(cli) => run_share_status(cli).await,
        #[cfg(not(feature = "share-ngrok"))]
        ParsedCli::ShareUnavailable => anyhow::bail!(
            "nac-web was built without ngrok share support; rebuild with --features nac-server/share-ngrok"
        ),
        ParsedCli::ManagedWorker(cli) => run_managed_worker(cli).await,
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
    let info = manager.store_info();
    eprintln!("nac-web listening on http://{}", cli.bind);
    eprintln!("store: {}", info.store_path.display());
    serve(cli.bind, manager).await
}

async fn run_managed_worker(cli: ManagedWorkerCli) -> Result<()> {
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
    let config = runtime::NacConfig::load_from_cwd(&config_cwd)?;
    let options = ManagedWorkerOptions {
        workspace_cwd,
        config_cwd: Some(config_cwd),
        dispatch: WorkerDispatchOptions {
            session_id: cli.dispatch.session_id,
            thread_name: cli.dispatch.thread_name,
            action: cli.dispatch.action,
            source_threads: cli.dispatch.source_threads,
            skills: cli.dispatch.skills,
        },
        store: StoreOptions {
            store_path: cli.store.store_path,
        },
        model: ModelOptions {
            backend: cli.model.backend.map(Into::into),
            reasoning_effort: cli.model.reasoning_effort.map(Into::into),
            api_base_url: cli.model.api_base_url,
            api_model: cli.model.api_model,
            api_key_env: cli.model.api_key_env,
            extra_headers: cli
                .model
                .extra_headers
                .as_deref()
                .and_then(runtime::parse_extra_headers_json),
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

#[cfg(feature = "share-ngrok")]
async fn run_share(cli: ShareRunCli) -> Result<()> {
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = resolve_cli_cwd(&launch_cwd, cli.server.directory.as_deref())?;
    share::run_share(share::ShareRunOptions {
        root_cwd,
        bind: cli.server.bind,
        store_path: cli.server.store_path,
        worker_executable: cli.server.worker_executable,
        overrides: share_overrides(
            cli.authtoken_env,
            None,
            cli.domain,
            cli.allow_emails,
            cli.allow_domains,
            cli.no_auth,
        ),
        authtoken: None,
        insecure_bind: cli.server.insecure_bind,
    })
    .await
}

#[cfg(feature = "share-ngrok")]
async fn run_share_configure(cli: ShareConfigureCli) -> Result<()> {
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = resolve_cli_cwd(&launch_cwd, cli.server.directory.as_deref())?;
    share::validate_share_bind(cli.server.bind, cli.server.insecure_bind)?;

    let overrides = share_overrides(
        cli.authtoken_env,
        cli.oauth_provider,
        cli.domain,
        cli.allow_emails,
        cli.allow_domains,
        cli.no_auth,
    );
    let saved = share::load_saved_share_config(&root_cwd)?;
    let mut ngrok = share::effective_share_config(&saved, &overrides);
    if !ngrok.auth_required && !cli.yes {
        eprintln!(
            "WARNING: this will persist auth_required = false. Anyone with the public URL may reach nac-web."
        );
        let confirmation = prompt_required("Type DISABLE to persist disabled ngrok auth", None)?;
        if confirmation != "DISABLE" {
            anyhow::bail!("refusing to persist disabled ngrok auth without confirmation");
        }
    }
    let normalized_for_token = share::normalize_share_config(&ngrok)?;
    let mut prompted_token = None;

    if share::try_resolve_authtoken(&root_cwd, &normalized_for_token, None)?.is_none() {
        println!(
            "Create or copy an ngrok authtoken from https://dashboard.ngrok.com/get-started/your-authtoken"
        );
        let token = prompt_required("ngrok authtoken", None)?;
        if cli.no_save_token {
            prompted_token = Some(token);
        } else {
            let path = share::save_authtoken_secret(&root_cwd, &token)?;
            println!("saved authtoken: {}", path.display());
        }
    }

    if ngrok.auth_required && ngrok.allow_emails.is_empty() && ngrok.allow_domains.is_empty() {
        let value = prompt_required("Allowed Google email or domain", None)?;
        share::add_allowlist_entry(&mut ngrok, &value);
    }

    let ngrok = share::normalize_share_config(&ngrok)?;
    let config_path = share::save_configured_share_config(&root_cwd, &ngrok)?;
    println!("saved config: {}", config_path.display());

    let doctor = share::run_doctor(share::DoctorOptions {
        root_cwd: root_cwd.clone(),
        bind: cli.server.bind,
        overrides: share::ShareConfigOverrides::default(),
        authtoken: prompted_token,
        check_health: false,
        insecure_bind: cli.server.insecure_bind,
    })
    .await;
    print!("{}", share::format_doctor_report(&doctor));
    if !doctor.ok() {
        anyhow::bail!(
            "share configure found {} failing check(s)",
            doctor.failure_count()
        );
    }
    Ok(())
}

#[cfg(feature = "share-ngrok")]
async fn run_share_doctor(cli: ShareDoctorCli) -> Result<()> {
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = resolve_cli_cwd(&launch_cwd, cli.server.directory.as_deref())?;
    let report = share::run_doctor(share::DoctorOptions {
        root_cwd,
        bind: cli.server.bind,
        overrides: share_overrides(
            cli.authtoken_env,
            None,
            cli.domain,
            cli.allow_emails,
            cli.allow_domains,
            cli.no_auth,
        ),
        authtoken: None,
        check_health: !cli.skip_health,
        insecure_bind: cli.server.insecure_bind,
    })
    .await;
    print!("{}", share::format_doctor_report(&report));
    if report.ok() {
        Ok(())
    } else {
        anyhow::bail!(
            "share doctor found {} failing check(s)",
            report.failure_count()
        )
    }
}

#[cfg(feature = "share-ngrok")]
async fn run_share_status(cli: ShareStatusCli) -> Result<()> {
    let launch_cwd = std::env::current_dir()?;
    let root_cwd = resolve_cli_cwd(&launch_cwd, cli.server.directory.as_deref())?;
    let saved = share::load_saved_share_config(&root_cwd)?;
    let ngrok = share::effective_share_config(
        &saved,
        &share::ShareConfigOverrides {
            authtoken_env: cli.authtoken_env,
            domain: cli.domain,
            ..share::ShareConfigOverrides::default()
        },
    );

    println!("public URL: generated by ngrok at launch");
    println!(
        "custom domain: {}",
        ngrok.domain.as_deref().unwrap_or("<none>")
    );
    println!("authtoken env: {}", ngrok.authtoken_env);
    println!(
        "authtoken: {}",
        match share::try_resolve_authtoken(&root_cwd, &ngrok, None)? {
            Some(token) => format!("resolved from {}", token.source),
            None => "missing".to_string(),
        }
    );
    println!("oauth provider: {}", ngrok.oauth_provider);
    println!("allowed emails: {}", display_list(&ngrok.allow_emails));
    println!("allowed domains: {}", display_list(&ngrok.allow_domains));
    println!(
        "auth required: {}",
        if ngrok.auth_required { "yes" } else { "no" }
    );
    println!("local: {}", share::local_service_url(cli.server.bind));
    println!(
        "secrets: {}",
        share::secrets_path_from_cwd(&root_cwd)?.display()
    );
    Ok(())
}

#[cfg(feature = "share-ngrok")]
fn share_overrides(
    authtoken_env: Option<String>,
    oauth_provider: Option<String>,
    domain: Option<String>,
    allow_emails: Vec<String>,
    allow_domains: Vec<String>,
    no_auth: bool,
) -> share::ShareConfigOverrides {
    share::ShareConfigOverrides {
        authtoken_env,
        oauth_provider,
        allow_emails,
        allow_domains,
        domain,
        auth_required: no_auth.then_some(false),
    }
}

#[cfg(feature = "share-ngrok")]
fn display_list(values: &[String]) -> String {
    if values.is_empty() {
        "<none>".to_string()
    } else {
        values.join(", ")
    }
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

#[cfg(feature = "share-ngrok")]
fn prompt_required(label: &str, default: Option<&str>) -> Result<String> {
    loop {
        match default {
            Some(default) => print!("{label} [{default}]: "),
            None => print!("{label}: "),
        }
        io::stdout().flush()?;
        let mut input = String::new();
        if io::stdin().read_line(&mut input)? == 0 {
            anyhow::bail!("no input provided for {label}");
        }
        let value = input.trim();
        if !value.is_empty() {
            return Ok(value.to_string());
        }
        if let Some(default) = default {
            return Ok(default.to_string());
        }
    }
}
