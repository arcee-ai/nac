use std::ffi::{OsStr, OsString};
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process;

use anyhow::Result;
use clap::Parser;
use uuid::Uuid;

use nac::agent::{Agent, AgentConfig, AgentMode};
use nac::agents_md::AgentsMdBundle;
use nac::api::{BackendKind, ClientOverrides, ModelClient, ReasoningEffort};
use nac::events::EventSink;
use nac::mcp::McpRegistry;
use nac::sandbox::{
    build_sandbox_spec, parse_mount_spec, SandboxSession, DEFAULT_SANDBOX_IMAGE,
    DEFAULT_SANDBOX_WORKDIR,
};
use nac::sessions::{self, SessionSnapshot};
use nac::skills::{self, SkillRegistry};
use nac::store::{self, WorkerContext};
use nac::tui::{self, TuiMetadata, TuiOutcome};
use nac::types::Message;

#[derive(Parser)]
#[command(
    name = "nac",
    about = "agent",
    after_help = "Use `nac resume [SESSION_ID]` to continue a saved session."
)]
struct RunCli {
    prompt: Option<String>,

    /// Open the interactive session picker instead of starting a fresh session
    #[arg(long)]
    resume: bool,

    /// Working directory (default: current directory)
    #[arg(short = 'C', long)]
    directory: Option<PathBuf>,

    /// Run orchestrator prompt and exit (no REPL)
    #[arg(long)]
    single: bool,

    /// Run as a worker instead of an orchestrator
    #[arg(long)]
    worker: bool,

    /// Session id for an orchestrator session or managed worker dispatch
    #[arg(long)]
    session_id: Option<String>,

    /// Thread name for a managed worker dispatch
    #[arg(long)]
    thread_name: Option<String>,

    /// Action for a managed worker dispatch
    #[arg(long)]
    action: Option<String>,

    /// Source threads whose latest retained episodes should be loaded
    #[arg(long = "source-thread")]
    source_threads: Vec<String>,

    /// Override the SQLite store path (default: .nac/store.db)
    #[arg(long)]
    store_path: Option<PathBuf>,

    /// Run tool execution inside a session-scoped Podman sandbox
    #[arg(long)]
    sandbox: bool,

    /// Backend wire shape to use for model requests
    #[arg(long, value_enum, default_value_t = BackendKind::Auto)]
    backend: BackendKind,

    /// Reasoning effort to request when supported by the selected backend
    #[arg(long = "effort", value_enum)]
    reasoning_effort: Option<ReasoningEffort>,

    /// Disable the implicit current-directory mount into /workspace
    #[arg(long)]
    no_mount_cwd: bool,

    /// Additional read-write mount in the form HOST:GUEST
    #[arg(long = "mount")]
    mounts: Vec<String>,

    /// Additional read-only mount in the form HOST:GUEST
    #[arg(long = "mount-ro")]
    mounts_ro: Vec<String>,

    /// Sandbox image to use when --sandbox is enabled
    #[arg(long, default_value = DEFAULT_SANDBOX_IMAGE)]
    sandbox_image: String,

    /// GPU CDI device to expose to the sandbox (repeatable; use 'all' for all NVIDIA GPUs)
    #[arg(long = "sandbox-gpu")]
    sandbox_gpus: Vec<String>,

    /// Sandbox /dev/shm size (default: 0, meaning uncapped by Podman)
    #[arg(long = "sandbox-shm-size")]
    sandbox_shm_size: Option<String>,

    /// Internal sandbox session key used to attach worker subprocesses
    #[arg(long, hide = true)]
    sandbox_session_key: Option<String>,

    /// Internal sandbox workdir used for worker subprocesses
    #[arg(long, hide = true)]
    sandbox_workdir: Option<String>,

    /// Internal API base URL override used by managed workers and resume
    #[arg(long, hide = true)]
    api_base_url: Option<String>,

    /// Internal model override used by managed workers and resume
    #[arg(long, hide = true)]
    api_model: Option<String>,
}

#[derive(Parser)]
#[command(name = "nac resume", about = "resume a saved nac session")]
struct ResumeCli {
    /// Session id to resume (default: most recently updated session)
    session_id: Option<String>,

    /// Resume the most recently updated session
    #[arg(long)]
    last: bool,
}

enum ParsedCli {
    Run(RunCli),
    Resume(ResumeCli),
}

struct ManagedWorkerConfig {
    store_path: PathBuf,
    session_id: String,
    thread_name: String,
    action: String,
}

struct RunConfig {
    mode: AgentMode,
    agent: Agent,
    initial_prompt: Option<String>,
    continue_repl: bool,
    managed_worker: Option<ManagedWorkerConfig>,
    client: ModelClient,
    session_id: Option<String>,
    session_snapshot: Option<SessionSnapshot>,
    sandbox_status: String,
    agents_md_status: String,
    workspace_display: String,
    workspace_host_path: Option<PathBuf>,
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("Error: {}", e);
        process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = parse_cli();

    if let ParsedCli::Run(run_cli) = &cli {
        if let Some(dir) = run_cli.directory.as_ref() {
            std::env::set_current_dir(dir)?;
        }
    }

    let mut run_state = build_run_state(cli).await?;

    loop {
        let use_tui = run_state.run_config.mode == AgentMode::Orchestrator
            && run_state.run_config.continue_repl
            && run_state.run_config.managed_worker.is_none()
            && io::stdin().is_terminal()
            && io::stdout().is_terminal()
            && io::stderr().is_terminal();

        if use_tui {
            let session_snapshot = run_state.run_config.session_snapshot.clone();
            let restored_messages = run_state.run_config.agent.messages.clone();
            let initial_prompt = run_state.run_config.initial_prompt.clone();
            let metadata = TuiMetadata {
                cwd: run_state.run_config.workspace_display.clone(),
                workspace_host_path: run_state.run_config.workspace_host_path.clone(),
                store_path: session_snapshot
                    .as_ref()
                    .map(|snapshot| snapshot.store_path.clone())
                    .unwrap_or_else(store::default_store_path),
                model: run_state.run_config.client.model.clone(),
                base_url: run_state.run_config.client.base_url().to_string(),
                backend: run_state.run_config.client.backend().as_str().to_string(),
                reasoning_effort: if run_state.run_config.client.backend()
                    == BackendKind::OpenAiResponses
                {
                    run_state
                        .run_config
                        .client
                        .reasoning_effort()
                        .map(|effort| effort.as_str().to_string())
                } else {
                    None
                },
                session_id: run_state.run_config.session_id.clone(),
                sandbox_status: run_state.run_config.sandbox_status.clone(),
                agents_md_status: run_state.run_config.agents_md_status.clone(),
            };

            match tui::run(
                run_state.run_config.agent,
                initial_prompt,
                metadata,
                restored_messages,
                session_snapshot,
                run_state.start_in_session_picker,
            )
            .await?
            {
                TuiOutcome::Exit => return Ok(()),
                TuiOutcome::ResumeSession(session_id) => {
                    run_state = RunState {
                        run_config: build_resume_config_for_session(&session_id).await?,
                        start_in_session_picker: false,
                    };
                    continue;
                }
            }
        }

        if run_state.start_in_session_picker {
            anyhow::bail!("--resume requires an interactive terminal");
        }

        run_non_tui(run_state.run_config).await?;
        return Ok(());
    }
}

fn parse_cli() -> ParsedCli {
    let args: Vec<OsString> = std::env::args_os().collect();
    parse_cli_from(args)
}

fn parse_cli_from(args: Vec<OsString>) -> ParsedCli {
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

struct RunState {
    run_config: RunConfig,
    start_in_session_picker: bool,
}

async fn build_run_state(cli: ParsedCli) -> Result<RunState> {
    match cli {
        ParsedCli::Run(cli) if cli.resume => {
            if cli.prompt.is_some() || cli.single || cli.worker || cli.session_id.is_some() {
                anyhow::bail!("--resume cannot be combined with prompts, workers, or session ids");
            }
            Ok(RunState {
                run_config: build_resume_picker_config(cli).await?,
                start_in_session_picker: true,
            })
        }
        ParsedCli::Run(cli) => Ok(RunState {
            run_config: build_run_cli_config(cli).await?,
            start_in_session_picker: false,
        }),
        ParsedCli::Resume(cli) => Ok(RunState {
            run_config: build_resume_config(cli).await?,
            start_in_session_picker: false,
        }),
    }
}

async fn build_run_cli_config(cli: RunCli) -> Result<RunConfig> {
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: cli.api_base_url.clone(),
        model: cli.api_model.clone(),
        backend: Some(cli.backend),
        reasoning_effort: cli.reasoning_effort,
    })?;
    let current_dir = std::env::current_dir()?;
    let sandbox = build_sandbox_session(&cli, &current_dir).await?;
    let agents_md_workspace_dir = effective_agents_md_workspace_dir(&current_dir, sandbox.as_ref());
    let agents_md = AgentsMdBundle::load(agents_md_workspace_dir.as_deref())?;
    let skills_workspace_dir = effective_skills_workspace_dir(&current_dir, sandbox.as_ref());
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(current_directory_display);
    let workspace_host_path = if let Some(session) = sandbox.as_ref() {
        session.host_workdir()
    } else {
        Some(current_dir.clone())
    };
    let sandbox_status = sandbox
        .as_ref()
        .map(|session| session.status_text())
        .unwrap_or_else(|| "off".to_string());
    let agents_md_message = agents_md.system_message();
    let agents_md_status = agents_md.status_text();

    if cli.worker {
        if cli.single {
            anyhow::bail!("--single is not valid with --worker");
        }

        let managed = cli.session_id.is_some()
            || cli.thread_name.is_some()
            || cli.action.is_some()
            || !cli.source_threads.is_empty();

        if managed {
            if cli.prompt.is_some() {
                anyhow::bail!(
                    "managed worker dispatches use --action instead of the positional prompt"
                );
            }

            let session_id = cli
                .session_id
                .ok_or_else(|| anyhow::anyhow!("managed worker dispatches require --session-id"))?;
            let thread_name = cli.thread_name.ok_or_else(|| {
                anyhow::anyhow!("managed worker dispatches require --thread-name")
            })?;
            let action = cli
                .action
                .ok_or_else(|| anyhow::anyhow!("managed worker dispatches require --action"))?;
            let store_path = absolute_store_path(
                &current_dir,
                cli.store_path.unwrap_or_else(store::default_store_path),
            );
            let mcp = McpRegistry::load(&current_dir, sandbox.as_ref()).await?;
            let skills = SkillRegistry::load(skills_workspace_dir.as_deref(), sandbox.as_ref())?;
            let extra_tool_defs = mcp
                .as_ref()
                .map(|registry| registry.tool_definitions())
                .unwrap_or_default();

            store::initialize(&store_path)?;
            let worker_context = store::load_worker_context(
                &store_path,
                &session_id,
                &thread_name,
                &cli.source_threads,
            )?;
            let agent = Agent::with_config(
                client.clone(),
                AgentConfig {
                    mode: AgentMode::Worker,
                    store_path: store_path.clone(),
                    session_id: Some(session_id.clone()),
                    initial_messages: build_worker_context_messages(&thread_name, &worker_context),
                    thread_name: Some(thread_name.clone()),
                    event_sink: EventSink::stderr_prefixed(),
                    working_directory: working_directory.clone(),
                    sandbox: sandbox.clone(),
                    mcp,
                    skills,
                    extra_tool_defs,
                    agents_md_message: agents_md_message.clone(),
                },
            );

            return Ok(RunConfig {
                mode: AgentMode::Worker,
                agent,
                initial_prompt: Some(action.clone()),
                continue_repl: false,
                managed_worker: Some(ManagedWorkerConfig {
                    store_path,
                    session_id,
                    thread_name,
                    action,
                }),
                client,
                session_id: None,
                session_snapshot: None,
                sandbox_status,
                agents_md_status,
                workspace_display: working_directory.clone(),
                workspace_host_path: workspace_host_path.clone(),
            });
        }

        let standalone_prompt = cli.prompt.clone();
        let mcp = McpRegistry::load(&current_dir, sandbox.as_ref()).await?;
        let skills = SkillRegistry::load(skills_workspace_dir.as_deref(), sandbox.as_ref())?;
        let extra_tool_defs = mcp
            .as_ref()
            .map(|registry| registry.tool_definitions())
            .unwrap_or_default();
        let agent = Agent::with_config(
            client.clone(),
            AgentConfig {
                mode: AgentMode::Worker,
                store_path: absolute_store_path(
                    &current_dir,
                    cli.store_path.unwrap_or_else(store::default_store_path),
                ),
                session_id: None,
                initial_messages: Vec::new(),
                thread_name: None,
                event_sink: EventSink::none(),
                working_directory: working_directory.clone(),
                sandbox: sandbox.clone(),
                mcp,
                skills,
                extra_tool_defs,
                agents_md_message: agents_md_message.clone(),
            },
        );

        return Ok(RunConfig {
            mode: AgentMode::Worker,
            agent,
            initial_prompt: standalone_prompt.clone(),
            continue_repl: standalone_prompt.is_none(),
            managed_worker: None,
            client,
            session_id: None,
            session_snapshot: None,
            sandbox_status,
            agents_md_status,
            workspace_display: working_directory.clone(),
            workspace_host_path: workspace_host_path.clone(),
        });
    }

    if cli.thread_name.is_some() || cli.action.is_some() || !cli.source_threads.is_empty() {
        anyhow::bail!("worker dispatch flags are only valid with --worker");
    }

    if cli.single && cli.prompt.is_none() {
        anyhow::bail!("--single requires a prompt");
    }

    let store_path = absolute_store_path(
        &current_dir,
        cli.store_path.unwrap_or_else(store::default_store_path),
    );
    store::initialize(&store_path)?;
    let session_id = cli.session_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path: store_path.clone(),
            session_id: Some(session_id.clone()),
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            working_directory: working_directory.clone(),
            sandbox: sandbox.clone(),
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message,
        },
    );
    let session_snapshot = sessions::new_snapshot(
        session_id.clone(),
        current_dir,
        store_path,
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        sandbox.as_ref().map(|session| session.spec().clone()),
        agent.messages.clone(),
    );
    sessions::create_session(&session_snapshot)?;

    Ok(RunConfig {
        mode: AgentMode::Orchestrator,
        agent,
        initial_prompt: cli.prompt,
        continue_repl: !cli.single,
        managed_worker: None,
        client,
        session_id: Some(session_id),
        session_snapshot: Some(session_snapshot),
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_host_path,
    })
}

async fn build_resume_picker_config(cli: RunCli) -> Result<RunConfig> {
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: cli.api_base_url,
        model: cli.api_model,
        backend: Some(cli.backend),
        reasoning_effort: cli.reasoning_effort,
    })?;
    let current_dir = std::env::current_dir()?;
    let agents_md = AgentsMdBundle::load(Some(&current_dir))?;
    let working_directory = current_directory_display();
    let workspace_host_path = Some(current_dir.clone());
    let sandbox_status = "off".to_string();
    let agents_md_status = agents_md.status_text();
    let store_path = absolute_store_path(
        &current_dir,
        cli.store_path.unwrap_or_else(store::default_store_path),
    );
    store::initialize(&store_path)?;
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path,
            session_id: None,
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            working_directory: working_directory.clone(),
            sandbox: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: agents_md.system_message(),
        },
    );

    Ok(RunConfig {
        mode: AgentMode::Orchestrator,
        agent,
        initial_prompt: None,
        continue_repl: true,
        managed_worker: None,
        client,
        session_id: None,
        session_snapshot: None,
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_host_path,
    })
}

async fn build_resume_config(cli: ResumeCli) -> Result<RunConfig> {
    if cli.last && cli.session_id.is_some() {
        anyhow::bail!("resume accepts either a session id or --last, not both");
    }

    let snapshot = match (cli.session_id.as_deref(), cli.last) {
        (Some(session_id), false) => sessions::load_session(session_id)?,
        (Some(_), true) => unreachable!(),
        (None, _) => sessions::load_last_session()?,
    };

    std::env::set_current_dir(&snapshot.cwd)?;
    let current_dir = std::env::current_dir()?;
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: Some(snapshot.base_url.clone()),
        model: Some(snapshot.model.clone()),
        backend: Some(snapshot.backend),
        reasoning_effort: snapshot.reasoning_effort,
    })?;
    let sandbox = match snapshot.sandbox_spec.clone() {
        Some(spec) => Some(SandboxSession::create(spec, Uuid::new_v4().to_string(), true).await?),
        None => None,
    };
    let agents_md_workspace_dir = effective_agents_md_workspace_dir(&current_dir, sandbox.as_ref());
    let agents_md = AgentsMdBundle::load(agents_md_workspace_dir.as_deref())?;
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(current_directory_display);
    let workspace_host_path = if let Some(session) = sandbox.as_ref() {
        session.host_workdir()
    } else {
        Some(current_dir.clone())
    };
    let sandbox_status = sandbox
        .as_ref()
        .map(|session| session.status_text())
        .unwrap_or_else(|| "off".to_string());
    let agents_md_status = agents_md.status_text();

    store::initialize(&snapshot.store_path)?;
    let mut agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path: snapshot.store_path.clone(),
            session_id: Some(snapshot.session_id.clone()),
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            working_directory: working_directory.clone(),
            sandbox,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
        },
    );
    agent.restore_messages(snapshot.messages.clone());

    Ok(RunConfig {
        mode: AgentMode::Orchestrator,
        agent,
        initial_prompt: None,
        continue_repl: true,
        managed_worker: None,
        client,
        session_id: Some(snapshot.session_id.clone()),
        session_snapshot: Some(snapshot),
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_host_path,
    })
}

async fn build_resume_config_for_session(session_id: &str) -> Result<RunConfig> {
    build_resume_config(ResumeCli {
        session_id: Some(session_id.to_string()),
        last: false,
    })
    .await
}

fn effective_agents_md_workspace_dir(
    current_dir: &Path,
    sandbox: Option<&SandboxSession>,
) -> Option<PathBuf> {
    if let Some(sandbox) = sandbox {
        return sandbox.host_workdir();
    }
    Some(current_dir.to_path_buf())
}

fn effective_skills_workspace_dir(
    current_dir: &Path,
    sandbox: Option<&SandboxSession>,
) -> Option<PathBuf> {
    if let Some(sandbox) = sandbox {
        return sandbox.host_workdir();
    }
    Some(current_dir.to_path_buf())
}

fn build_worker_context_messages(
    thread_name: &str,
    worker_context: &WorkerContext,
) -> Vec<Message> {
    let mut messages = Vec::new();
    if let Some(self_context) =
        store::render_self_context(thread_name, &worker_context.self_episodes)
    {
        messages.push(Message::User {
            content: self_context,
        });
    }
    for source_episode in &worker_context.source_episodes {
        messages.push(Message::User {
            content: store::render_source_context(source_episode),
        });
    }
    messages
}

async fn commit_managed_worker(worker: &ManagedWorkerConfig, response: &str) -> Result<()> {
    store::append_episode(
        &worker.store_path,
        &worker.session_id,
        &worker.thread_name,
        &worker.action,
        response,
    )?;
    Ok(())
}

fn persist_session_snapshot(snapshot: &mut SessionSnapshot, agent: &Agent) -> Result<()> {
    let refreshed = sessions::refresh_snapshot(snapshot, agent.messages.clone());
    sessions::save_session(&refreshed)?;
    *snapshot = refreshed;
    Ok(())
}

async fn run_non_tui(run_config: RunConfig) -> Result<()> {
    let mut session_snapshot = run_config.session_snapshot.clone();
    let mut agent = run_config.agent;

    if let Some(prompt) = run_config.initial_prompt {
        let send_result = agent.send(&prompt).await;
        if let Some(snapshot) = session_snapshot.as_mut() {
            persist_session_snapshot(snapshot, &agent)?;
        }
        let response = send_result?;
        if let Some(worker) = &run_config.managed_worker {
            commit_managed_worker(worker, &response).await?;
        }
        println!("{}", response);
        if !run_config.continue_repl {
            return Ok(());
        }
    }

    let stdin = io::stdin();
    loop {
        eprint!("\n> ");
        io::stderr().flush()?;

        let mut line = String::new();
        let bytes = stdin.read_line(&mut line)?;
        if bytes == 0 {
            break;
        }

        let input = line.trim();
        if input.is_empty() {
            continue;
        }
        if input == "/exit" {
            break;
        }

        let send_result = agent.send(input).await;
        if let Some(snapshot) = session_snapshot.as_mut() {
            persist_session_snapshot(snapshot, &agent)?;
        }

        match send_result {
            Ok(response) => println!("{}", response),
            Err(error) => eprintln!("Error: {}", error),
        }
    }

    Ok(())
}

async fn build_sandbox_session(cli: &RunCli, cwd: &Path) -> Result<Option<SandboxSession>> {
    let sandbox_flags_present = cli.no_mount_cwd
        || !cli.mounts.is_empty()
        || !cli.mounts_ro.is_empty()
        || cli.sandbox_session_key.is_some()
        || cli.sandbox_workdir.is_some()
        || cli.sandbox_image != DEFAULT_SANDBOX_IMAGE
        || !cli.sandbox_gpus.is_empty()
        || cli.sandbox_shm_size.is_some();

    if !cli.sandbox {
        if sandbox_flags_present {
            anyhow::bail!("sandbox configuration flags require --sandbox");
        }
        return Ok(None);
    }

    let mut mounts = Vec::new();
    if !cli.no_mount_cwd {
        mounts.push(parse_mount_spec(
            &format!("{}:{}", cwd.display(), DEFAULT_SANDBOX_WORKDIR),
            false,
            cwd,
        )?);
    }
    for mount in &cli.mounts {
        mounts.push(parse_mount_spec(mount, false, cwd)?);
    }
    for mount in &cli.mounts_ro {
        mounts.push(parse_mount_spec(mount, true, cwd)?);
    }

    let workdir = cli
        .sandbox_workdir
        .clone()
        .unwrap_or_else(|| DEFAULT_SANDBOX_WORKDIR.to_string());
    let skills_workspace_dir = workspace_dir_from_mounts(&mounts, PathBuf::from(&workdir))
        .unwrap_or_else(|| cwd.to_path_buf());
    mounts.extend(skills::auto_mounts(&skills_workspace_dir, &mounts)?);

    let spec = build_sandbox_spec(
        cli.sandbox_image.clone(),
        workdir,
        mounts,
        cli.sandbox_gpus
            .iter()
            .map(|device| normalize_gpu_device(device))
            .collect(),
        Some(
            cli.sandbox_shm_size
                .clone()
                .unwrap_or_else(|| "0".to_string()),
        ),
    )?;
    let owner = cli.sandbox_session_key.is_none();
    let session_key = cli
        .sandbox_session_key
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let session = SandboxSession::create(spec, session_key, owner).await?;
    Ok(Some(session))
}

fn normalize_gpu_device(device: &str) -> String {
    if device == "all" {
        "nvidia.com/gpu=all".to_string()
    } else {
        device.to_string()
    }
}

fn current_directory_display() -> String {
    std::env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| ".".to_string())
}

fn absolute_store_path(cwd: &Path, store_path: PathBuf) -> PathBuf {
    if store_path.is_absolute() {
        store_path
    } else {
        cwd.join(store_path)
    }
}

fn workspace_dir_from_mounts(
    mounts: &[nac::sandbox::MountSpec],
    workdir: PathBuf,
) -> Option<PathBuf> {
    for mount in mounts {
        if workdir.starts_with(&mount.guest) {
            let suffix = workdir
                .strip_prefix(&mount.guest)
                .unwrap_or_else(|_| Path::new(""));
            let mut host = mount.host.clone();
            for component in suffix.components() {
                if let std::path::Component::Normal(part) = component {
                    host.push(part);
                }
            }
            return Some(host);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use nac::TEST_ENV_LOCK;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_main_test_{}_{}", label, unique))
            .join("store.db")
    }

    #[test]
    fn workspace_dir_from_explicit_mount_uses_workspace_guest_mapping() {
        let root = std::env::temp_dir().join(format!(
            "nac_main_test_workspace_mount_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join(".git")).unwrap();

        let mounts = vec![nac::sandbox::MountSpec {
            host: root.clone(),
            guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
            read_only: false,
        }];

        let resolved = workspace_dir_from_mounts(&mounts, PathBuf::from(DEFAULT_SANDBOX_WORKDIR));
        assert_eq!(resolved.as_deref(), Some(root.as_path()));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn parse_resume_command_uses_resume_cli() {
        let parsed = parse_cli_from(vec![
            OsString::from("nac"),
            OsString::from("resume"),
            OsString::from("session-123"),
        ]);
        match parsed {
            ParsedCli::Resume(resume) => {
                assert_eq!(resume.session_id.as_deref(), Some("session-123"))
            }
            ParsedCli::Run(_) => panic!("expected resume cli"),
        }
    }

    #[test]
    fn parse_resume_flag_uses_run_cli() {
        let parsed = parse_cli_from(vec![OsString::from("nac"), OsString::from("--resume")]);
        match parsed {
            ParsedCli::Run(run) => assert!(run.resume),
            ParsedCli::Resume(_) => panic!("expected run cli"),
        }
    }

    #[tokio::test]
    async fn managed_worker_builds_user_messages_from_self_and_source_threads() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var("OPENAI_API_KEY").ok();
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }

        let store_path = temp_store_path("managed_worker_messages");
        store::initialize(&store_path).unwrap();

        let session_id = "session-msg-order";
        store::append_episode(
            &store_path,
            session_id,
            "impl",
            "step-1",
            "impl retained episode",
        )
        .unwrap();
        store::append_episode(
            &store_path,
            session_id,
            "auth",
            "inspect",
            "auth latest episode",
        )
        .unwrap();
        store::append_episode(
            &store_path,
            session_id,
            "tests",
            "inspect",
            "tests latest episode",
        )
        .unwrap();

        let cli = RunCli {
            prompt: None,
            resume: false,
            directory: None,
            single: false,
            worker: true,
            session_id: Some(session_id.to_string()),
            thread_name: Some("impl".to_string()),
            action: Some("implement the next step".to_string()),
            source_threads: vec!["auth".to_string(), "tests".to_string()],
            store_path: Some(store_path.clone()),
            sandbox: false,
            backend: BackendKind::Auto,
            reasoning_effort: None,
            no_mount_cwd: false,
            mounts: Vec::new(),
            mounts_ro: Vec::new(),
            sandbox_image: DEFAULT_SANDBOX_IMAGE.to_string(),
            sandbox_gpus: Vec::new(),
            sandbox_shm_size: None,
            sandbox_session_key: None,
            sandbox_workdir: None,
            api_base_url: None,
            api_model: None,
        };

        let run_config = build_run_cli_config(cli).await.unwrap();

        assert_eq!(
            run_config.initial_prompt.as_deref(),
            Some("implement the next step")
        );
        assert!(run_config.managed_worker.is_some());
        assert_eq!(run_config.agent.messages.len(), 4);

        match &run_config.agent.messages[1] {
            Message::User { content } => assert!(content.contains("impl retained episode")),
            other => panic!("expected self-history user message, got {:?}", other),
        }
        match &run_config.agent.messages[2] {
            Message::User { content } => {
                assert!(content.contains("auth latest episode"));
                assert!(content.contains("thread \"auth\""));
            }
            other => panic!("expected first source-thread user message, got {:?}", other),
        }
        match &run_config.agent.messages[3] {
            Message::User { content } => {
                assert!(content.contains("tests latest episode"));
                assert!(content.contains("thread \"tests\""));
            }
            other => panic!(
                "expected second source-thread user message, got {:?}",
                other
            ),
        }

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());

        if let Some(key) = original_api_key {
            unsafe {
                std::env::set_var("OPENAI_API_KEY", key);
            }
        } else {
            unsafe {
                std::env::remove_var("OPENAI_API_KEY");
            }
        }
    }

    #[test]
    fn sandbox_gpu_all_maps_to_nvidia_cdi_device() {
        assert_eq!(normalize_gpu_device("all"), "nvidia.com/gpu=all");
        assert_eq!(
            normalize_gpu_device("nvidia.com/gpu=mig1:0"),
            "nvidia.com/gpu=mig1:0"
        );
    }

    #[tokio::test]
    async fn orchestrator_allows_explicit_session_id() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var("OPENAI_API_KEY").ok();
        let original_nac_home = std::env::var_os("NAC_HOME");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }
        let nac_home = std::env::temp_dir().join(format!(
            "nac_resume_home_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        std::fs::create_dir_all(&nac_home).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
        }

        let store_path = temp_store_path("orchestrator_session_id");
        let cli = RunCli {
            prompt: None,
            resume: false,
            directory: None,
            single: false,
            worker: false,
            session_id: Some("server-owned-session".to_string()),
            thread_name: None,
            action: None,
            source_threads: Vec::new(),
            store_path: Some(store_path.clone()),
            sandbox: false,
            backend: BackendKind::Auto,
            reasoning_effort: None,
            no_mount_cwd: false,
            mounts: Vec::new(),
            mounts_ro: Vec::new(),
            sandbox_image: DEFAULT_SANDBOX_IMAGE.to_string(),
            sandbox_gpus: Vec::new(),
            sandbox_shm_size: None,
            sandbox_session_key: None,
            sandbox_workdir: None,
            api_base_url: None,
            api_model: None,
        };

        let run_config = build_run_cli_config(cli).await.unwrap();
        assert_eq!(
            run_config.session_id.as_deref(),
            Some("server-owned-session")
        );
        assert!(run_config.session_snapshot.is_some());

        let loaded = sessions::load_session("server-owned-session").unwrap();
        assert_eq!(loaded.session_id, "server-owned-session");

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
        let _ = std::fs::remove_dir_all(nac_home);

        if let Some(key) = original_api_key {
            unsafe {
                std::env::set_var("OPENAI_API_KEY", key);
            }
        } else {
            unsafe {
                std::env::remove_var("OPENAI_API_KEY");
            }
        }
        match original_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
    }

    #[tokio::test]
    async fn resume_config_restores_messages_and_cwd() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var("OPENAI_API_KEY").ok();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_cwd = std::env::current_dir().unwrap();
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }
        let nac_home = std::env::temp_dir().join(format!(
            "nac_resume_restore_home_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        let session_cwd = nac_home.join("repo");
        std::fs::create_dir_all(&session_cwd).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
        }

        let snapshot = sessions::new_snapshot(
            "resume-session".to_string(),
            session_cwd.clone(),
            session_cwd.join(".nac/store.db"),
            "resume-model".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Xhigh),
            None,
            vec![
                Message::System {
                    content: "system".to_string(),
                },
                Message::User {
                    content: "hello".to_string(),
                },
                Message::Assistant {
                    content: Some("world".to_string()),
                    reasoning_text: Some("hidden thinking".to_string()),
                    reasoning_details: None,
                    tool_calls: None,
                },
            ],
        );
        sessions::create_session(&snapshot).unwrap();

        std::env::set_current_dir(std::env::temp_dir()).unwrap();
        let run_config = build_resume_config(ResumeCli {
            session_id: Some("resume-session".to_string()),
            last: false,
        })
        .await
        .unwrap();

        assert_eq!(
            std::env::current_dir().unwrap().canonicalize().unwrap(),
            session_cwd.canonicalize().unwrap(),
            "resume should restore the stored cwd"
        );
        assert_eq!(run_config.session_id.as_deref(), Some("resume-session"));
        assert_eq!(run_config.agent.messages.len(), 3);
        match &run_config.agent.messages[1] {
            Message::User { content } => assert_eq!(content, "hello"),
            other => panic!("expected restored user message, got {:?}", other),
        }
        match &run_config.agent.messages[2] {
            Message::Assistant {
                content: Some(content),
                reasoning_text: Some(reasoning),
                ..
            } => {
                assert_eq!(content, "world");
                assert_eq!(reasoning, "hidden thinking");
            }
            other => panic!("expected restored assistant message, got {:?}", other),
        }

        std::env::set_current_dir(original_cwd).unwrap();
        let _ = std::fs::remove_dir_all(nac_home);

        if let Some(key) = original_api_key {
            unsafe {
                std::env::set_var("OPENAI_API_KEY", key);
            }
        } else {
            unsafe {
                std::env::remove_var("OPENAI_API_KEY");
            }
        }
        match original_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
    }
}
