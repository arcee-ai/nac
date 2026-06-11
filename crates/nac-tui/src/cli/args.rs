use super::*;

#[derive(Parser)]
#[command(
    name = "nac",
    about = "agent",
    after_help = "Commands:\n  nac resume [SESSION_ID]    Continue a saved session\n  nac codex-auth [COMMAND]   Manage ChatGPT Codex auth\n  nac upgrade                Reinstall the latest nac release"
)]
pub(super) struct RunCli {
    /// Working directory (default: current directory)
    #[arg(short = 'C', long)]
    pub(super) directory: Option<PathBuf>,

    #[command(flatten)]
    pub(super) store: StoreArgs,

    #[command(flatten)]
    pub(super) model: ModelArgs,

    #[command(flatten)]
    pub(super) sandbox: SandboxArgs,
}

#[derive(Parser)]
#[command(
    name = "nac __worker",
    about = "internal managed worker dispatch",
    hide = true
)]
pub(super) struct ManagedWorkerCli {
    /// Internal workspace cwd used for managed worker path resolution
    #[arg(long, hide = true)]
    pub(super) workspace_cwd: Option<PathBuf>,

    /// Internal local cwd used to resolve nac config for managed workers.
    #[arg(long, hide = true)]
    pub(super) config_cwd: Option<PathBuf>,

    /// Internal OpenSSH target used to re-attach worker subprocesses to a
    /// remote session; workspace-cwd is then a remote path used verbatim.
    #[arg(long = "ssh-host", alias = "host-id", hide = true)]
    pub(super) ssh_host: Option<String>,

    #[command(flatten)]
    pub(super) dispatch: WorkerDispatchArgs,

    #[command(flatten)]
    pub(super) store: StoreArgs,

    #[command(flatten)]
    pub(super) model: ModelArgs,

    #[command(flatten)]
    pub(super) sandbox: SandboxArgs,
}

#[derive(clap::Args)]
pub(super) struct StoreArgs {
    /// Override the SQLite store path (default: the global store at $NAC_HOME/store.db, typically ~/.config/nac/store.db)
    #[arg(long)]
    pub(super) store_path: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
pub(super) enum BackendArg {
    #[value(name = "auto")]
    Auto,
    #[value(name = "deepseek-chat")]
    DeepSeekChat,
    #[value(name = "fireworks-chat")]
    FireworksChat,
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
            BackendArg::OpenAiResponses => Self::OpenAiResponses,
            BackendArg::ChatGptCodexResponses => Self::ChatGptCodexResponses,
            BackendArg::AnthropicMessages => Self::AnthropicMessages,
        }
    }
}

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
pub(super) enum ReasoningEffortArg {
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
pub(super) struct ModelArgs {
    /// Backend wire shape to use for model requests
    #[arg(long, value_enum)]
    pub(super) backend: Option<BackendArg>,

    /// Reasoning effort to request when supported by the selected backend
    #[arg(long = "effort", value_enum)]
    pub(super) reasoning_effort: Option<ReasoningEffortArg>,

    /// Internal API base URL override used by managed workers and resume
    #[arg(long, hide = true)]
    pub(super) api_base_url: Option<String>,

    /// Internal model override used by managed workers and resume
    #[arg(long, hide = true)]
    pub(super) api_model: Option<String>,
}

#[derive(clap::Args)]
pub(super) struct WorkerDispatchArgs {
    /// Session id for the managed worker dispatch
    #[arg(long)]
    pub(super) session_id: String,

    /// Thread name for the managed worker dispatch
    #[arg(long)]
    pub(super) thread_name: String,

    /// Action for the managed worker dispatch
    #[arg(long)]
    pub(super) action: String,

    /// Source threads whose latest retained episodes should be loaded
    #[arg(long = "source-thread")]
    pub(super) source_threads: Vec<String>,

    /// Skill names to preload for this managed worker dispatch
    #[arg(long = "skill")]
    pub(super) skills: Vec<String>,
}

#[derive(clap::Args)]
pub(super) struct SandboxArgs {
    /// Run tool execution inside a session-scoped Podman sandbox
    #[arg(long)]
    pub(super) sandbox: bool,

    /// Disable the implicit current-directory mount into /workspace
    #[arg(long)]
    pub(super) no_mount_cwd: bool,

    /// Additional read-write mount in the form HOST:GUEST
    #[arg(long = "mount")]
    pub(super) mounts: Vec<String>,

    /// Additional read-only mount in the form HOST:GUEST
    #[arg(long = "mount-ro")]
    pub(super) mounts_ro: Vec<String>,

    /// Sandbox image to use when --sandbox is enabled
    #[arg(long)]
    pub(super) sandbox_image: Option<String>,

    /// GPU CDI device to expose to the sandbox (repeatable; use 'all' for all NVIDIA GPUs)
    #[arg(long = "sandbox-gpu")]
    pub(super) sandbox_gpus: Vec<String>,

    /// Sandbox /dev/shm size (default: 0, meaning uncapped by Podman)
    #[arg(long = "sandbox-shm-size")]
    pub(super) sandbox_shm_size: Option<String>,

    /// Internal sandbox session key used to attach worker subprocesses
    #[arg(long, hide = true)]
    pub(super) sandbox_session_key: Option<String>,

    /// Internal sandbox workdir used for worker subprocesses
    #[arg(long, hide = true)]
    pub(super) sandbox_workdir: Option<String>,
}

#[derive(Parser)]
#[command(name = "nac resume", about = "resume saved nac sessions")]
pub(super) struct ResumeCli {
    /// Session id to resume
    pub(super) session_id: Option<String>,

    /// Resume the most recently updated session
    #[arg(long)]
    pub(super) last: bool,

    /// Working directory whose store should be inspected (default: current directory)
    #[arg(short = 'C', long)]
    pub(super) directory: Option<PathBuf>,

    #[command(flatten)]
    pub(super) store: StoreArgs,
}

#[derive(Parser)]
#[command(name = "nac codex-auth", about = "manage ChatGPT Codex auth")]
pub(super) struct CodexAuthCli {
    #[command(subcommand)]
    pub(super) command: Option<CodexAuthCommand>,
}

#[derive(Subcommand)]
pub(super) enum CodexAuthCommand {
    /// Sign in with ChatGPT using device code authorization
    Login,
    /// Show stored Codex auth status
    Status,
    /// Remove stored Codex auth
    Logout,
}

#[derive(Parser)]
#[command(name = "nac upgrade", about = "reinstall the latest nac release")]
pub(super) struct UpgradeCli {
    /// Install directory to replace (default: current nac executable directory)
    #[arg(long)]
    pub(super) install_dir: Option<PathBuf>,
}

pub(super) enum ParsedCli {
    Run(RunCli),
    ManagedWorker(ManagedWorkerCli),
    Resume(ResumeCli),
    CodexAuth(CodexAuthCli),
    Upgrade(UpgradeCli),
}

pub(super) fn parse_cli() -> ParsedCli {
    let args: Vec<OsString> = std::env::args_os().collect();
    parse_cli_from(args)
}

pub(super) fn parse_cli_from(args: Vec<OsString>) -> ParsedCli {
    if args
        .get(1)
        .is_some_and(|value| value == OsStr::new("resume"))
    {
        ParsedCli::Resume(ResumeCli::parse_from(subcommand_args(args, "nac resume")))
    } else if args
        .get(1)
        .is_some_and(|value| value == OsStr::new("__worker"))
    {
        ParsedCli::ManagedWorker(ManagedWorkerCli::parse_from(subcommand_args(
            args,
            "nac __worker",
        )))
    } else if args
        .get(1)
        .is_some_and(|value| value == OsStr::new("codex-auth"))
    {
        ParsedCli::CodexAuth(CodexAuthCli::parse_from(subcommand_args(
            args,
            "nac codex-auth",
        )))
    } else if args
        .get(1)
        .is_some_and(|value| value == OsStr::new("upgrade"))
    {
        ParsedCli::Upgrade(UpgradeCli::parse_from(subcommand_args(args, "nac upgrade")))
    } else {
        ParsedCli::Run(RunCli::parse_from(args))
    }
}

fn subcommand_args(args: Vec<OsString>, name: &str) -> Vec<OsString> {
    let mut parsed = Vec::with_capacity(args.len().saturating_sub(1));
    parsed.push(OsString::from(name));
    parsed.extend(args.into_iter().skip(2));
    parsed
}
