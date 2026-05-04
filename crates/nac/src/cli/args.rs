use super::*;

#[derive(Parser)]
#[command(
    name = "nac",
    about = "agent",
    after_help = "Use `nac resume [SESSION_ID]` to continue a saved session."
)]
pub(super) struct RunCli {
    pub(super) prompt: Option<String>,

    /// Open the interactive session picker instead of starting a fresh session
    #[arg(long)]
    pub(super) resume: bool,

    /// Working directory (default: current directory)
    #[arg(short = 'C', long)]
    pub(super) directory: Option<PathBuf>,

    /// Run orchestrator prompt and exit (no REPL)
    #[arg(long)]
    pub(super) single: bool,

    /// Run as a worker instead of an orchestrator
    #[arg(long)]
    pub(super) worker: bool,

    /// Session id for an orchestrator session or managed worker dispatch
    #[arg(long)]
    pub(super) session_id: Option<String>,

    /// Thread name for a managed worker dispatch
    #[arg(long)]
    pub(super) thread_name: Option<String>,

    /// Action for a managed worker dispatch
    #[arg(long)]
    pub(super) action: Option<String>,

    /// Source threads whose latest retained episodes should be loaded
    #[arg(long = "source-thread")]
    pub(super) source_threads: Vec<String>,

    /// Override the SQLite store path (default: .nac/store.db)
    #[arg(long)]
    pub(super) store_path: Option<PathBuf>,

    /// Run tool execution inside a session-scoped Podman sandbox
    #[arg(long)]
    pub(super) sandbox: bool,

    /// Backend wire shape to use for model requests
    #[arg(long, value_enum, default_value_t = BackendKind::Auto)]
    pub(super) backend: BackendKind,

    /// Reasoning effort to request when supported by the selected backend
    #[arg(long = "effort", value_enum)]
    pub(super) reasoning_effort: Option<ReasoningEffort>,

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
    #[arg(long, default_value = DEFAULT_SANDBOX_IMAGE)]
    pub(super) sandbox_image: String,

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

    /// Internal API base URL override used by managed workers and resume
    #[arg(long, hide = true)]
    pub(super) api_base_url: Option<String>,

    /// Internal model override used by managed workers and resume
    #[arg(long, hide = true)]
    pub(super) api_model: Option<String>,
}

#[derive(Parser)]
#[command(name = "nac resume", about = "resume a saved nac session")]
pub(super) struct ResumeCli {
    /// Session id to resume (default: most recently updated session)
    pub(super) session_id: Option<String>,

    /// Resume the most recently updated session
    #[arg(long)]
    pub(super) last: bool,
}

pub(super) enum ParsedCli {
    Run(RunCli),
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
        resume_args.push(args[0].clone());
        resume_args.extend(args.into_iter().skip(2));
        ParsedCli::Resume(ResumeCli::parse_from(resume_args))
    } else {
        ParsedCli::Run(RunCli::parse_from(args))
    }
}
