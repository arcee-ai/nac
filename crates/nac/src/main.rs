use std::collections::HashSet;
use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::process;
use std::sync::Arc;

use anyhow::Result;
use clap::Parser;
use tokio::sync::Mutex;
use uuid::Uuid;

use nac::agent::{Agent, AgentConfig, AgentMode};
use nac::api::OpenAiClient;
use nac::events::EventSink;
use nac::sandbox::{
    build_sandbox_spec, parse_mount_spec, SandboxSession, DEFAULT_SANDBOX_IMAGE,
    DEFAULT_SANDBOX_WORKDIR,
};
use nac::store::{self, WorkerContext};
use nac::tools::{thread, ToolRuntime};
use nac::tui::{self, TuiMetadata};
use nac::types::Message;

#[derive(Parser)]
#[command(name = "nac", about = "agent")]
struct Cli {
    prompt: Option<String>,

    /// Working directory (default: current directory)
    #[arg(short = 'C', long)]
    directory: Option<PathBuf>,

    /// Run orchestrator prompt and exit (no REPL)
    #[arg(long)]
    single: bool,

    /// Run as a worker instead of an orchestrator
    #[arg(long)]
    worker: bool,

    /// Session id for a managed worker dispatch
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

    /// Internal sandbox session key used to attach worker subprocesses
    #[arg(long, hide = true)]
    sandbox_session_key: Option<String>,

    /// Internal sandbox workdir used for worker subprocesses
    #[arg(long, hide = true)]
    sandbox_workdir: Option<String>,
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
    client: OpenAiClient,
    session_id: Option<String>,
    sandbox_status: String,
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("Error: {}", e);
        process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();

    if let Some(dir) = cli.directory.as_ref() {
        std::env::set_current_dir(&dir)?;
    }

    let run_config = build_run_config(cli).await?;
    let use_tui = run_config.mode == AgentMode::Orchestrator
        && run_config.continue_repl
        && run_config.managed_worker.is_none()
        && io::stdin().is_terminal()
        && io::stdout().is_terminal()
        && io::stderr().is_terminal();

    if use_tui {
        let metadata = TuiMetadata {
            cwd: std::env::current_dir()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|_| ".".to_string()),
            model: run_config.client.model.clone(),
            base_url: run_config.client.base_url().to_string(),
            session_id: run_config.session_id.clone(),
            sandbox_status: run_config.sandbox_status.clone(),
        };
        return tui::run(run_config.agent, run_config.initial_prompt, metadata).await;
    }

    let mut agent = run_config.agent;
    let client = run_config.client;

    if let Some(prompt) = run_config.initial_prompt {
        let response = agent.send(&prompt).await?;
        if let Some(worker) = &run_config.managed_worker {
            let completion_tokens = agent.last_completion_tokens().ok_or_else(|| {
                anyhow::anyhow!("worker response did not include completion_tokens")
            })?;
            commit_managed_worker(worker, &client, &response, completion_tokens).await?;
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

        match agent.send(input).await {
            Ok(response) => println!("{}", response),
            Err(error) => eprintln!("Error: {}", error),
        }
    }

    Ok(())
}

async fn build_run_config(cli: Cli) -> Result<RunConfig> {
    let client = OpenAiClient::from_env()?;
    let sandbox = build_sandbox_session(&cli).await?;
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(current_directory_display);
    let sandbox_status = sandbox
        .as_ref()
        .map(|session| session.status_text())
        .unwrap_or_else(|| "off".to_string());

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
            let store_path = cli.store_path.unwrap_or_else(store::default_store_path);

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
                sandbox_status,
            });
        }

        let standalone_prompt = cli.prompt.clone();
        let agent = Agent::with_config(
            client.clone(),
            AgentConfig {
                mode: AgentMode::Worker,
                store_path: cli.store_path.unwrap_or_else(store::default_store_path),
                session_id: None,
                initial_messages: Vec::new(),
                thread_name: None,
                event_sink: EventSink::none(),
                working_directory: working_directory.clone(),
                sandbox: sandbox.clone(),
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
            sandbox_status,
        });
    }

    if cli.session_id.is_some()
        || cli.thread_name.is_some()
        || cli.action.is_some()
        || !cli.source_threads.is_empty()
    {
        anyhow::bail!("worker dispatch flags are only valid with --worker");
    }

    if cli.single && cli.prompt.is_none() {
        anyhow::bail!("--single requires a prompt");
    }

    let store_path = cli.store_path.unwrap_or_else(store::default_store_path);
    store::initialize(&store_path)?;
    let session_id = Uuid::new_v4().to_string();
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Orchestrator,
            store_path,
            session_id: Some(session_id.clone()),
            initial_messages: Vec::new(),
            thread_name: None,
            event_sink: EventSink::none(),
            working_directory,
            sandbox,
        },
    );

    Ok(RunConfig {
        mode: AgentMode::Orchestrator,
        agent,
        initial_prompt: cli.prompt,
        continue_repl: !cli.single,
        managed_worker: None,
        client,
        session_id: Some(session_id),
        sandbox_status,
    })
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

async fn commit_managed_worker(
    worker: &ManagedWorkerConfig,
    client: &OpenAiClient,
    response: &str,
    completion_tokens: u32,
) -> Result<()> {
    store::append_episode(
        &worker.store_path,
        &worker.session_id,
        &worker.thread_name,
        &worker.action,
        response,
        completion_tokens as i64,
    )?;

    let runtime = ToolRuntime {
        store_path: worker.store_path.clone(),
        session_id: Some(worker.session_id.clone()),
        active_threads: Arc::new(Mutex::new(HashSet::new())),
        event_sink: EventSink::none(),
        sandbox: None,
    };
    thread::auto_compact_if_needed(&runtime, client, &worker.session_id, &worker.thread_name)
        .await?;
    Ok(())
}

async fn build_sandbox_session(cli: &Cli) -> Result<Option<SandboxSession>> {
    let sandbox_flags_present = cli.no_mount_cwd
        || !cli.mounts.is_empty()
        || !cli.mounts_ro.is_empty()
        || cli.sandbox_session_key.is_some()
        || cli.sandbox_workdir.is_some()
        || cli.sandbox_image != DEFAULT_SANDBOX_IMAGE;

    if !cli.sandbox {
        if sandbox_flags_present {
            anyhow::bail!("sandbox configuration flags require --sandbox");
        }
        return Ok(None);
    }

    let cwd = std::env::current_dir()?;
    let mut mounts = Vec::new();
    if !cli.no_mount_cwd {
        mounts.push(parse_mount_spec(
            &format!("{}:{}", cwd.display(), DEFAULT_SANDBOX_WORKDIR),
            false,
            &cwd,
        )?);
    }
    for mount in &cli.mounts {
        mounts.push(parse_mount_spec(mount, false, &cwd)?);
    }
    for mount in &cli.mounts_ro {
        mounts.push(parse_mount_spec(mount, true, &cwd)?);
    }

    let spec = build_sandbox_spec(
        cli.sandbox_image.clone(),
        cli.sandbox_workdir
            .clone()
            .unwrap_or_else(|| DEFAULT_SANDBOX_WORKDIR.to_string()),
        mounts,
    )?;
    let owner = cli.sandbox_session_key.is_none();
    let session_key = cli
        .sandbox_session_key
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let session = SandboxSession::create(spec, session_key, owner).await?;
    Ok(Some(session))
}

fn current_directory_display() -> String {
    std::env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| ".".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    static ENV_LOCK: StdMutex<()> = StdMutex::new(());

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_main_test_{}_{}", label, unique))
            .join("store.db")
    }

    #[tokio::test]
    async fn managed_worker_builds_user_messages_from_self_and_source_threads() {
        let _guard = ENV_LOCK.lock().unwrap();

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
            14,
        )
        .unwrap();
        store::append_episode(
            &store_path,
            session_id,
            "auth",
            "inspect",
            "auth latest episode",
            11,
        )
        .unwrap();
        store::append_episode(
            &store_path,
            session_id,
            "tests",
            "inspect",
            "tests latest episode",
            12,
        )
        .unwrap();

        let cli = Cli {
            prompt: None,
            directory: None,
            single: false,
            worker: true,
            session_id: Some(session_id.to_string()),
            thread_name: Some("impl".to_string()),
            action: Some("implement the next step".to_string()),
            source_threads: vec!["auth".to_string(), "tests".to_string()],
            store_path: Some(store_path.clone()),
            sandbox: false,
            no_mount_cwd: false,
            mounts: Vec::new(),
            mounts_ro: Vec::new(),
            sandbox_image: DEFAULT_SANDBOX_IMAGE.to_string(),
            sandbox_session_key: None,
            sandbox_workdir: None,
        };

        let run_config = build_run_config(cli).await.unwrap();

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
}
