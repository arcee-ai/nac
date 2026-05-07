use super::*;

#[derive(Parser)]
#[command(
    name = "nac",
    about = "agent",
    after_help = "Use `nac resume` to continue a saved session."
)]
pub(super) struct RunCli {
    /// Working directory (default: current directory)
    #[arg(short = 'C', long)]
    pub(super) directory: Option<PathBuf>,

    #[command(flatten)]
    pub(super) store: StoreArgs,

    #[command(flatten)]
    pub(super) ui: UiArgs,

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
    /// Override the SQLite store path (default: .nac/store.db)
    #[arg(long)]
    pub(super) store_path: Option<PathBuf>,
}

#[derive(clap::Args)]
pub(super) struct UiArgs {
    /// Use the compact single-column TUI layout
    #[arg(long, conflicts_with = "full")]
    pub(super) compact: bool,

    /// Use the full dashboard TUI layout
    #[arg(long, conflicts_with = "compact")]
    pub(super) full: bool,
}

#[derive(clap::Args, Default)]
pub(super) struct ModelArgs {
    /// Backend wire shape to use for model requests
    #[arg(long, value_enum)]
    pub(super) backend: Option<BackendKind>,

    /// Reasoning effort to request when supported by the selected backend
    #[arg(long = "effort", value_enum)]
    pub(super) reasoning_effort: Option<ReasoningEffort>,

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

    #[command(flatten)]
    pub(super) ui: UiArgs,
}

pub(super) enum ParsedCli {
    Run(RunCli),
    ManagedWorker(ManagedWorkerCli),
    Resume(ResumeCli),
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
        let mut resume_args = Vec::with_capacity(args.len().saturating_sub(1));
        resume_args.push(OsString::from("nac resume"));
        resume_args.extend(args.into_iter().skip(2));
        ParsedCli::Resume(ResumeCli::parse_from(resume_args))
    } else if args
        .get(1)
        .is_some_and(|value| value == OsStr::new("__worker"))
    {
        let mut worker_args = Vec::with_capacity(args.len().saturating_sub(1));
        worker_args.push(OsString::from("nac __worker"));
        worker_args.extend(args.into_iter().skip(2));
        ParsedCli::ManagedWorker(ManagedWorkerCli::parse_from(worker_args))
    } else {
        ParsedCli::Run(RunCli::parse_from(args))
    }
}
