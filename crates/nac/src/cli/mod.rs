use std::ffi::{OsStr, OsString};
use std::io::{self, IsTerminal};
use std::path::{Path, PathBuf};

use anyhow::Result;
use clap::Parser;
use uuid::Uuid;

use crate::agent::{Agent, AgentConfig, AgentMode};
use crate::agents_md::AgentsMdBundle;
use crate::events::EventSink;
use crate::mcp::McpRegistry;
use crate::model::{BackendKind, ClientOverrides, ModelClient, ReasoningEffort};
use crate::sandbox::{
    build_sandbox_spec, parse_mount_spec, SandboxSession, DEFAULT_SANDBOX_IMAGE,
    DEFAULT_SANDBOX_WORKDIR,
};
use crate::sessions::{self, SessionSnapshot};
use crate::skills::{self, SkillRegistry};
use crate::store::{self, WorkerContext};
use crate::tui::{self, TuiMetadata, TuiOutcome, UiMode};
use crate::types::Message;

mod args;
mod config;
mod managed_worker;
mod resume;
mod sandbox;

use args::*;
use config::*;
use managed_worker::*;
use resume::*;
use sandbox::*;

pub async fn run() -> Result<()> {
    let cli = parse_cli();

    match &cli {
        ParsedCli::Run(run_cli) => {
            if let Some(dir) = run_cli.directory.as_ref() {
                std::env::set_current_dir(dir)?;
            }
        }
        ParsedCli::Resume(resume_cli) => {
            if let Some(dir) = resume_cli.directory.as_ref() {
                std::env::set_current_dir(dir)?;
            }
        }
        ParsedCli::ManagedWorker(_) => {}
    }

    let terminal_available =
        io::stdin().is_terminal() && io::stdout().is_terminal() && io::stderr().is_terminal();
    if !matches!(cli, ParsedCli::ManagedWorker(_)) && !terminal_available {
        if matches!(&cli, ParsedCli::Resume(resume_cli) if resume_cli.session_id.is_none() && !resume_cli.last)
        {
            anyhow::bail!("resume requires an interactive terminal");
        }
        anyhow::bail!("interactive mode requires the TUI; run nac from a terminal");
    }

    let mut run_state = build_run_state(cli).await?;

    loop {
        match run_state {
            RunState::ManagedWorker(run_config) => {
                run_managed_worker(run_config).await?;
                return Ok(());
            }
            RunState::Orchestrator {
                run_config,
                start_in_session_picker,
                ui_mode,
            } => {
                let store_path = run_config.session.store_path();
                let session_id = run_config.session.session_id().map(str::to_string);
                let restored_messages = run_config.agent.messages.clone();
                let session_snapshot = run_config.session.into_snapshot();
                let agent = run_config.agent;
                let client = run_config.client;
                let metadata = TuiMetadata {
                    cwd: run_config.workspace_display,
                    workspace_host_path: run_config.workspace_host_path,
                    store_path: store_path.clone(),
                    model: client.model.clone(),
                    base_url: client.base_url().to_string(),
                    backend: client.backend().as_str().to_string(),
                    reasoning_effort: if client.backend() == BackendKind::OpenAiResponses {
                        client
                            .reasoning_effort()
                            .map(|effort| effort.as_str().to_string())
                    } else {
                        None
                    },
                    session_id,
                    sandbox_status: run_config.sandbox_status,
                    agents_md_status: run_config.agents_md_status,
                };

                match tui::run(
                    agent,
                    metadata,
                    restored_messages,
                    session_snapshot,
                    start_in_session_picker,
                    ui_mode,
                )
                .await?
                {
                    TuiOutcome::Exit => return Ok(()),
                    TuiOutcome::ResumeSession(session_id) => {
                        run_state = RunState::Orchestrator {
                            run_config: build_resume_config_for_session(store_path, &session_id)
                                .await?,
                            start_in_session_picker: false,
                            ui_mode,
                        };
                        continue;
                    }
                }
            }
        }
    }
}

async fn build_run_state(cli: ParsedCli) -> Result<RunState> {
    match cli {
        ParsedCli::Run(cli) => {
            let ui_mode = ui_mode_from_args(&cli.ui);
            Ok(RunState::Orchestrator {
                run_config: build_run_cli_config(cli).await?,
                start_in_session_picker: false,
                ui_mode,
            })
        }
        ParsedCli::ManagedWorker(cli) => Ok(RunState::ManagedWorker(
            build_managed_worker_config(cli).await?,
        )),
        ParsedCli::Resume(cli) if cli.session_id.is_none() && !cli.last => {
            let ui_mode = ui_mode_from_args(&cli.ui);
            Ok(RunState::Orchestrator {
                run_config: build_resume_picker_config(cli).await?,
                start_in_session_picker: true,
                ui_mode,
            })
        }
        ParsedCli::Resume(cli) => {
            let ui_mode = ui_mode_from_args(&cli.ui);
            Ok(RunState::Orchestrator {
                run_config: build_resume_config(cli).await?,
                start_in_session_picker: false,
                ui_mode,
            })
        }
    }
}

fn ui_mode_from_args(ui: &UiArgs) -> UiMode {
    if ui.compact {
        UiMode::Compact
    } else {
        UiMode::Full
    }
}

async fn build_run_cli_config(cli: RunCli) -> Result<OrchestratorRunConfig> {
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: cli.model.api_base_url.clone(),
        model: cli.model.api_model.clone(),
        backend: Some(cli.model.backend),
        reasoning_effort: cli.model.reasoning_effort,
    })?;
    let current_dir = std::env::current_dir()?;
    let sandbox = build_sandbox_session(&cli.sandbox, &current_dir).await?;
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
    let agents_md_message = agents_md.system_message();
    let agents_md_status = agents_md.status_text();

    let store_path = absolute_store_path(
        &current_dir,
        cli.store
            .store_path
            .unwrap_or_else(store::default_store_path),
    );
    store::initialize(&store_path)?;
    let session_id = Uuid::new_v4().to_string();
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

    Ok(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id,
            snapshot: session_snapshot,
        },
        sandbox_status,
        agents_md_status,
        workspace_display: working_directory,
        workspace_host_path,
    })
}

async fn build_managed_worker_config(cli: ManagedWorkerCli) -> Result<ManagedWorkerRunConfig> {
    let client = ModelClient::from_env_with_overrides(ClientOverrides {
        base_url: cli.model.api_base_url.clone(),
        model: cli.model.api_model.clone(),
        backend: Some(cli.model.backend),
        reasoning_effort: cli.model.reasoning_effort,
    })?;
    let current_dir = std::env::current_dir()?;
    let sandbox = build_sandbox_session(&cli.sandbox, &current_dir).await?;
    let agents_md_workspace_dir = effective_agents_md_workspace_dir(&current_dir, sandbox.as_ref());
    let agents_md = AgentsMdBundle::load(agents_md_workspace_dir.as_deref())?;
    let skills_workspace_dir = effective_skills_workspace_dir(&current_dir, sandbox.as_ref());
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(current_directory_display);
    let agents_md_message = agents_md.system_message();
    let store_path = absolute_store_path(
        &current_dir,
        cli.store
            .store_path
            .unwrap_or_else(store::default_store_path),
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
        &cli.dispatch.session_id,
        &cli.dispatch.thread_name,
        &cli.dispatch.source_threads,
    )?;
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Worker,
            store_path: store_path.clone(),
            session_id: Some(cli.dispatch.session_id.clone()),
            initial_messages: build_worker_context_messages(
                &cli.dispatch.thread_name,
                &worker_context,
            ),
            thread_name: Some(cli.dispatch.thread_name.clone()),
            event_sink: EventSink::stderr_prefixed(),
            working_directory,
            sandbox,
            mcp,
            skills,
            extra_tool_defs,
            agents_md_message,
        },
    );

    Ok(ManagedWorkerRunConfig {
        agent,
        store_path,
        session_id: cli.dispatch.session_id,
        thread_name: cli.dispatch.thread_name,
        action: cli.dispatch.action,
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TEST_ENV_LOCK;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_main_test_{}_{}", label, unique))
            .join("store.db")
    }

    fn default_model_args() -> ModelArgs {
        ModelArgs {
            backend: BackendKind::Auto,
            reasoning_effort: None,
            api_base_url: None,
            api_model: None,
        }
    }

    fn default_sandbox_args() -> SandboxArgs {
        SandboxArgs {
            sandbox: false,
            no_mount_cwd: false,
            mounts: Vec::new(),
            mounts_ro: Vec::new(),
            sandbox_image: DEFAULT_SANDBOX_IMAGE.to_string(),
            sandbox_gpus: Vec::new(),
            sandbox_shm_size: None,
            sandbox_session_key: None,
            sandbox_workdir: None,
        }
    }

    fn default_ui_args() -> UiArgs {
        UiArgs { compact: false }
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

        let mounts = vec![crate::sandbox::MountSpec {
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
            ParsedCli::ManagedWorker(_) => panic!("expected resume cli"),
        }
    }

    #[test]
    fn parse_resume_command_without_id_uses_resume_picker_cli() {
        let parsed = parse_cli_from(vec![OsString::from("nac"), OsString::from("resume")]);
        match parsed {
            ParsedCli::Resume(resume) => {
                assert!(resume.session_id.is_none());
                assert!(!resume.last);
            }
            ParsedCli::Run(_) => panic!("expected resume cli"),
            ParsedCli::ManagedWorker(_) => panic!("expected resume cli"),
        }
    }

    #[test]
    fn parse_compact_flag_uses_run_ui_args() {
        let parsed = parse_cli_from(vec![OsString::from("nac"), OsString::from("--compact")]);
        match parsed {
            ParsedCli::Run(run) => assert!(run.ui.compact),
            ParsedCli::Resume(_) | ParsedCli::ManagedWorker(_) => panic!("expected run cli"),
        }
    }

    #[test]
    fn parse_resume_compact_flag_uses_resume_ui_args() {
        let parsed = parse_cli_from(vec![
            OsString::from("nac"),
            OsString::from("resume"),
            OsString::from("--compact"),
            OsString::from("--last"),
        ]);
        match parsed {
            ParsedCli::Resume(resume) => {
                assert!(resume.ui.compact);
                assert!(resume.last);
            }
            ParsedCli::Run(_) | ParsedCli::ManagedWorker(_) => panic!("expected resume cli"),
        }
    }

    #[test]
    fn parse_hidden_worker_command_uses_managed_worker_cli() {
        let parsed = parse_cli_from(vec![
            OsString::from("nac"),
            OsString::from("__worker"),
            OsString::from("--session-id"),
            OsString::from("session-123"),
            OsString::from("--thread-name"),
            OsString::from("impl"),
            OsString::from("--action"),
            OsString::from("do work"),
            OsString::from("--source-thread"),
            OsString::from("research"),
        ]);
        match parsed {
            ParsedCli::ManagedWorker(worker) => {
                assert_eq!(worker.dispatch.session_id, "session-123");
                assert_eq!(worker.dispatch.thread_name, "impl");
                assert_eq!(worker.dispatch.action, "do work");
                assert_eq!(worker.dispatch.source_threads, vec!["research"]);
            }
            ParsedCli::Run(_) | ParsedCli::Resume(_) => panic!("expected managed worker cli"),
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

        let cli = ManagedWorkerCli {
            dispatch: WorkerDispatchArgs {
                session_id: session_id.to_string(),
                thread_name: "impl".to_string(),
                action: "implement the next step".to_string(),
                source_threads: vec!["auth".to_string(), "tests".to_string()],
            },
            store: StoreArgs {
                store_path: Some(store_path.clone()),
            },
            model: default_model_args(),
            sandbox: default_sandbox_args(),
        };

        let run_config = build_managed_worker_config(cli).await.unwrap();

        assert_eq!(run_config.action, "implement the next step");
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
    async fn resume_config_restores_messages_and_cwd() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_api_key = std::env::var("OPENAI_API_KEY").ok();
        let original_cwd = std::env::current_dir().unwrap();
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
        }
        let session_root = std::env::temp_dir().join(format!(
            "nac_resume_restore_store_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        let session_cwd = session_root.join("repo");
        std::fs::create_dir_all(&session_cwd).unwrap();
        let store_path = session_cwd.join(".nac/store.db");

        let snapshot = sessions::new_snapshot(
            "resume-session".to_string(),
            session_cwd.clone(),
            store_path,
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
            directory: Some(session_cwd.clone()),
            store: StoreArgs { store_path: None },
            ui: default_ui_args(),
        })
        .await
        .unwrap();

        assert_eq!(
            std::env::current_dir().unwrap().canonicalize().unwrap(),
            session_cwd.canonicalize().unwrap(),
            "resume should restore the stored cwd"
        );
        assert_eq!(run_config.session.session_id(), Some("resume-session"));
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
        let _ = std::fs::remove_dir_all(session_root);

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
