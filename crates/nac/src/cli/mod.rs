use std::ffi::{OsStr, OsString};
use std::io::{self, IsTerminal, Write};
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
use crate::tui::{self, TuiMetadata, TuiOutcome};
use crate::types::Message;

mod args;
mod config;
mod repl;
mod resume;
mod sandbox;

use args::*;
use config::*;
use repl::*;
use resume::*;
use sandbox::*;

pub async fn run() -> Result<()> {
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
