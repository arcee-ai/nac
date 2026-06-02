use std::ffi::{OsStr, OsString};
use std::io::{self, IsTerminal};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{CommandFactory, Parser, Subcommand};
use uuid::Uuid;

use crate::agent::{Agent, AgentConfig, AgentMode};
use crate::agents_md::AgentsMdBundle;
use crate::events::EventSink;
use crate::mcp::McpRegistry;
use crate::model::{
    codex_auth_login, codex_auth_logout, codex_auth_status, BackendKind, ClientOverrides,
    ModelClient, ReasoningEffort,
};
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
mod managed_worker;
mod resume;
mod sandbox;
mod upgrade;

use args::*;
use config::*;
use managed_worker::*;
use resume::*;
use sandbox::*;
use upgrade::*;

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
        ParsedCli::CodexAuth(_) => {}
        ParsedCli::Upgrade(_) => {}
        ParsedCli::ManagedWorker(_) => {}
    }

    let terminal_available =
        io::stdin().is_terminal() && io::stdout().is_terminal() && io::stderr().is_terminal();
    if !matches!(
        cli,
        ParsedCli::ManagedWorker(_) | ParsedCli::CodexAuth(_) | ParsedCli::Upgrade(_)
    ) && !terminal_available
    {
        if matches!(&cli, ParsedCli::Resume(resume_cli) if resume_cli.session_id.is_none() && !resume_cli.last)
        {
            anyhow::bail!("resume requires an interactive terminal");
        }
        anyhow::bail!("interactive mode requires the TUI; run nac from a terminal");
    }

    if let ParsedCli::CodexAuth(cli) = cli {
        run_codex_auth_cli(cli).await?;
        return Ok(());
    }

    if let ParsedCli::Upgrade(cli) = cli {
        run_upgrade_cli(cli).await?;
        return Ok(());
    }

    let app_config = NacConfig::load()?;
    let mut run_state = build_run_state(cli, &app_config).await?;

    loop {
        match run_state {
            RunState::ManagedWorker(run_config) => {
                run_managed_worker(run_config).await?;
                return Ok(());
            }
            RunState::Orchestrator {
                run_config,
                start_in_session_picker,
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
                    backend: client.backend().as_str().to_string(),
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
                )
                .await?
                {
                    TuiOutcome::Exit => return Ok(()),
                    TuiOutcome::ResumeSession(session_id) => {
                        run_state = RunState::Orchestrator {
                            run_config: build_resume_config_for_session(
                                store_path,
                                &session_id,
                                &app_config,
                            )
                            .await?,
                            start_in_session_picker: false,
                        };
                        continue;
                    }
                }
            }
        }
    }
}

async fn build_run_state(cli: ParsedCli, config: &NacConfig) -> Result<RunState> {
    match cli {
        ParsedCli::Run(cli) => Ok(RunState::Orchestrator {
            run_config: build_run_cli_config(cli, config).await?,
            start_in_session_picker: false,
        }),
        ParsedCli::ManagedWorker(cli) => Ok(RunState::ManagedWorker(
            build_managed_worker_config(cli, config).await?,
        )),
        ParsedCli::Resume(cli) if cli.session_id.is_none() && !cli.last => {
            Ok(RunState::Orchestrator {
                run_config: build_resume_picker_config(cli, config).await?,
                start_in_session_picker: true,
            })
        }
        ParsedCli::Resume(cli) => Ok(RunState::Orchestrator {
            run_config: build_resume_config(cli, config).await?,
            start_in_session_picker: false,
        }),
        ParsedCli::CodexAuth(_) => unreachable!("codex-auth is handled before loading config"),
        ParsedCli::Upgrade(_) => unreachable!("upgrade is handled before loading config"),
    }
}

async fn run_codex_auth_cli(cli: CodexAuthCli) -> Result<()> {
    match cli.command {
        Some(CodexAuthCommand::Login) => codex_auth_login().await,
        Some(CodexAuthCommand::Status) => codex_auth_status(),
        Some(CodexAuthCommand::Logout) => codex_auth_logout(),
        None => {
            let mut command = CodexAuthCli::command();
            command.print_help()?;
            println!();
            Ok(())
        }
    }
}

struct EffectiveSandboxArgs {
    sandbox: bool,
    no_mount_cwd: bool,
    mounts: Vec<String>,
    mounts_ro: Vec<String>,
    sandbox_image: Option<String>,
    sandbox_gpus: Vec<String>,
    sandbox_shm_size: Option<String>,
    sandbox_session_key: Option<String>,
    sandbox_workdir: Option<String>,
    explicit_sandbox_config_flags_present: bool,
}

impl SandboxCliArgs for EffectiveSandboxArgs {
    fn sandbox_enabled(&self) -> bool {
        self.sandbox
    }

    fn no_mount_cwd(&self) -> bool {
        self.no_mount_cwd
    }

    fn mounts(&self) -> &[String] {
        &self.mounts
    }

    fn mounts_ro(&self) -> &[String] {
        &self.mounts_ro
    }

    fn sandbox_image(&self) -> Option<&str> {
        self.sandbox_image.as_deref()
    }

    fn sandbox_gpus(&self) -> &[String] {
        &self.sandbox_gpus
    }

    fn sandbox_shm_size(&self) -> Option<&String> {
        self.sandbox_shm_size.as_ref()
    }

    fn sandbox_session_key(&self) -> Option<&String> {
        self.sandbox_session_key.as_ref()
    }

    fn sandbox_workdir(&self) -> Option<&String> {
        self.sandbox_workdir.as_ref()
    }

    fn explicit_sandbox_config_flags_present(&self) -> bool {
        self.explicit_sandbox_config_flags_present
    }
}

fn effective_sandbox_args(cli: SandboxArgs, config: &NacConfig) -> EffectiveSandboxArgs {
    let explicit_sandbox_config_flags_present = cli.explicit_sandbox_config_flags_present();
    EffectiveSandboxArgs {
        sandbox: cli.sandbox,
        no_mount_cwd: cli.no_mount_cwd,
        mounts: cli.mounts,
        mounts_ro: cli.mounts_ro,
        sandbox_image: cli.sandbox_image.or_else(|| config.sandbox.image.clone()),
        sandbox_gpus: cli.sandbox_gpus,
        sandbox_shm_size: cli.sandbox_shm_size,
        sandbox_session_key: cli.sandbox_session_key,
        sandbox_workdir: cli.sandbox_workdir,
        explicit_sandbox_config_flags_present,
    }
}

fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

fn configured_api_key_env(config: &NacConfig) -> Option<String> {
    config
        .model
        .api_key_env
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
}

fn model_overrides(model: &ModelArgs, config: &NacConfig) -> Result<ClientOverrides> {
    Ok(ClientOverrides {
        base_url: model
            .api_base_url
            .clone()
            .or_else(|| env_var("OPENAI_BASE_URL"))
            .or_else(|| config.model.base_url.clone()),
        model: model
            .api_model
            .clone()
            .or_else(|| env_var("OPENAI_MODEL"))
            .or_else(|| config.model.model.clone()),
        backend: model.backend.or(config.model.backend),
        reasoning_effort: model.reasoning_effort.or(config.model.reasoning_effort),
        api_key_env: configured_api_key_env(config),
    })
}

fn worker_thread_timeout_secs(config: &NacConfig) -> u64 {
    config
        .worker
        .thread_timeout_secs
        .unwrap_or(crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS)
        .max(crate::tools::thread::MIN_THREAD_TIMEOUT_SECS)
}

async fn build_run_cli_config(cli: RunCli, config: &NacConfig) -> Result<OrchestratorRunConfig> {
    let client = ModelClient::from_env_with_overrides(model_overrides(&cli.model, config)?)?;
    let current_dir = std::env::current_dir()?;
    let sandbox_args = effective_sandbox_args(cli.sandbox, config);
    let sandbox = build_sandbox_session(&sandbox_args, &current_dir).await?;
    let workspace_dir = effective_workspace_dir(&current_dir, sandbox.as_ref());
    let agents_md = AgentsMdBundle::load(workspace_dir.as_deref())?;
    let skills = SkillRegistry::load(workspace_dir.as_deref(), sandbox.as_ref())?;
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
            .or_else(|| config.storage.store_path.clone())
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
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
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

async fn build_managed_worker_config(
    cli: ManagedWorkerCli,
    config: &NacConfig,
) -> Result<ManagedWorkerRunConfig> {
    let client = ModelClient::from_env_with_overrides(model_overrides(&cli.model, config)?)?;
    let current_dir = std::env::current_dir()?;
    let sandbox_args = effective_sandbox_args(cli.sandbox, config);
    let sandbox = build_sandbox_session(&sandbox_args, &current_dir).await?;
    let workspace_dir = effective_workspace_dir(&current_dir, sandbox.as_ref());
    let agents_md = AgentsMdBundle::load(workspace_dir.as_deref())?;
    let working_directory = sandbox
        .as_ref()
        .map(|session| session.workdir_display())
        .unwrap_or_else(current_directory_display);
    let agents_md_message = agents_md.system_message();
    let store_path = absolute_store_path(
        &current_dir,
        cli.store
            .store_path
            .or_else(|| config.storage.store_path.clone())
            .unwrap_or_else(store::default_store_path),
    );
    let mcp = McpRegistry::load(&current_dir, sandbox.as_ref()).await?;
    let skills = SkillRegistry::load(workspace_dir.as_deref(), sandbox.as_ref())?;
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
    let mut initial_messages =
        build_preloaded_skill_messages(skills.as_deref(), &cli.dispatch.skills)?;
    initial_messages.extend(build_worker_context_messages(
        &cli.dispatch.thread_name,
        &worker_context,
    ));
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            mode: AgentMode::Worker,
            store_path: store_path.clone(),
            session_id: Some(cli.dispatch.session_id.clone()),
            initial_messages,
            thread_name: Some(cli.dispatch.thread_name.clone()),
            event_sink: EventSink::stderr_prefixed(),
            working_directory,
            sandbox,
            mcp,
            skills: None,
            extra_tool_defs,
            agents_md_message,
            thread_timeout_secs: worker_thread_timeout_secs(config),
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

fn effective_workspace_dir(
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
            backend: None,
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
            sandbox_image: None,
            sandbox_gpus: Vec::new(),
            sandbox_shm_size: None,
            sandbox_session_key: None,
            sandbox_workdir: None,
        }
    }

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    #[test]
    fn model_overrides_prefer_cli_then_env_then_config() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_base_url = std::env::var_os("OPENAI_BASE_URL");
        let original_model = std::env::var_os("OPENAI_MODEL");
        unsafe {
            std::env::set_var("OPENAI_BASE_URL", "https://env.example/v1");
            std::env::set_var("OPENAI_MODEL", "env-model");
        }

        let mut config = NacConfig::default();
        config.model.base_url = Some("https://config.example/v1".to_string());
        config.model.model = Some("config-model".to_string());
        config.model.backend = Some(BackendKind::OpenAiResponses);
        config.model.reasoning_effort = Some(ReasoningEffort::High);
        config.model.api_key_env = Some("NAC_TEST_API_KEY".to_string());

        let env_overrides = model_overrides(&default_model_args(), &config).unwrap();
        assert_eq!(
            env_overrides.base_url.as_deref(),
            Some("https://env.example/v1")
        );
        assert_eq!(env_overrides.model.as_deref(), Some("env-model"));
        assert_eq!(env_overrides.backend, Some(BackendKind::OpenAiResponses));
        assert_eq!(env_overrides.reasoning_effort, Some(ReasoningEffort::High));
        assert_eq!(
            env_overrides.api_key_env.as_deref(),
            Some("NAC_TEST_API_KEY")
        );

        let cli_overrides = model_overrides(
            &ModelArgs {
                backend: Some(BackendKind::DeepSeekChat),
                reasoning_effort: Some(ReasoningEffort::Low),
                api_base_url: Some("https://cli.example/v1".to_string()),
                api_model: Some("cli-model".to_string()),
            },
            &config,
        )
        .unwrap();
        assert_eq!(
            cli_overrides.base_url.as_deref(),
            Some("https://cli.example/v1")
        );
        assert_eq!(cli_overrides.model.as_deref(), Some("cli-model"));
        assert_eq!(cli_overrides.backend, Some(BackendKind::DeepSeekChat));
        assert_eq!(cli_overrides.reasoning_effort, Some(ReasoningEffort::Low));

        restore_env("OPENAI_BASE_URL", original_base_url);
        restore_env("OPENAI_MODEL", original_model);
    }

    #[test]
    fn sandbox_image_config_is_default_not_enablement() {
        let mut config = NacConfig::default();
        config.sandbox.image = Some("custom-image".to_string());

        let disabled = effective_sandbox_args(default_sandbox_args(), &config);
        assert!(!disabled.sandbox_enabled());
        assert!(!disabled.explicit_sandbox_config_flags_present());
        assert_eq!(disabled.sandbox_image(), Some("custom-image"));

        let mut cli = default_sandbox_args();
        cli.sandbox = true;
        let enabled = effective_sandbox_args(cli, &config);
        assert!(enabled.sandbox_enabled());
        assert_eq!(enabled.sandbox_image(), Some("custom-image"));

        let mut cli = default_sandbox_args();
        cli.sandbox = true;
        cli.sandbox_image = Some("cli-image".to_string());
        let overridden = effective_sandbox_args(cli, &config);
        assert_eq!(overridden.sandbox_image(), Some("cli-image"));
        assert!(overridden.explicit_sandbox_config_flags_present());
    }

    #[test]
    fn worker_timeout_reads_config_default() {
        let mut config = NacConfig::default();
        config.worker.thread_timeout_secs = Some(7_200);
        assert_eq!(worker_thread_timeout_secs(&config), 7_200);

        config.worker.thread_timeout_secs = Some(10);
        assert_eq!(
            worker_thread_timeout_secs(&config),
            crate::tools::thread::MIN_THREAD_TIMEOUT_SECS
        );
    }

    #[test]
    fn nac_config_loads_new_sections_alongside_existing_mcp() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let root = std::env::temp_dir().join(format!(
            "nac_config_load_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("config.toml"),
            r#"
[storage]
store_path = "custom/store.db"

[model]
backend = "openai-responses"
model = "config-model"
base_url = "https://config.example/v1"
reasoning_effort = "high"
api_key_env = "NAC_TEST_API_KEY"

[sandbox]
image = "config-image"

[worker]
thread_timeout_secs = 7200

[mcp_servers.context7]
enabled = true
transport = "streamable_http"
url = "https://mcp.context7.com/mcp"
"#,
        )
        .unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &root);
        }

        let config = NacConfig::load().unwrap();
        assert_eq!(
            config.storage.store_path.as_deref(),
            Some(Path::new("custom/store.db"))
        );
        assert_eq!(config.model.backend, Some(BackendKind::OpenAiResponses));
        assert_eq!(config.model.model.as_deref(), Some("config-model"));
        assert_eq!(
            config.model.base_url.as_deref(),
            Some("https://config.example/v1")
        );
        assert_eq!(config.model.reasoning_effort, Some(ReasoningEffort::High));
        assert_eq!(
            config.model.api_key_env.as_deref(),
            Some("NAC_TEST_API_KEY")
        );
        assert_eq!(config.sandbox.image.as_deref(), Some("config-image"));
        assert_eq!(config.worker.thread_timeout_secs, Some(7_200));

        restore_env("NAC_HOME", original_nac_home);
        let _ = std::fs::remove_dir_all(root);
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
            ParsedCli::Run(_)
            | ParsedCli::ManagedWorker(_)
            | ParsedCli::CodexAuth(_)
            | ParsedCli::Upgrade(_) => {
                panic!("expected resume cli")
            }
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
            ParsedCli::Run(_)
            | ParsedCli::ManagedWorker(_)
            | ParsedCli::CodexAuth(_)
            | ParsedCli::Upgrade(_) => {
                panic!("expected resume cli")
            }
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
            OsString::from("--skill"),
            OsString::from("lint"),
            OsString::from("--skill"),
            OsString::from("review"),
        ]);
        match parsed {
            ParsedCli::ManagedWorker(worker) => {
                assert_eq!(worker.dispatch.session_id, "session-123");
                assert_eq!(worker.dispatch.thread_name, "impl");
                assert_eq!(worker.dispatch.action, "do work");
                assert_eq!(worker.dispatch.source_threads, vec!["research"]);
                assert_eq!(worker.dispatch.skills, vec!["lint", "review"]);
            }
            ParsedCli::Run(_)
            | ParsedCli::Resume(_)
            | ParsedCli::CodexAuth(_)
            | ParsedCli::Upgrade(_) => {
                panic!("expected managed worker cli")
            }
        }
    }

    #[test]
    fn parse_codex_auth_command_uses_codex_auth_cli() {
        let parsed = parse_cli_from(vec![OsString::from("nac"), OsString::from("codex-auth")]);
        match parsed {
            ParsedCli::CodexAuth(cli) => assert!(cli.command.is_none()),
            ParsedCli::Run(_)
            | ParsedCli::Resume(_)
            | ParsedCli::ManagedWorker(_)
            | ParsedCli::Upgrade(_) => {
                panic!("expected codex-auth cli")
            }
        }

        let parsed = parse_cli_from(vec![
            OsString::from("nac"),
            OsString::from("codex-auth"),
            OsString::from("status"),
        ]);
        match parsed {
            ParsedCli::CodexAuth(cli) => {
                assert!(matches!(cli.command, Some(CodexAuthCommand::Status)))
            }
            ParsedCli::Run(_)
            | ParsedCli::Resume(_)
            | ParsedCli::ManagedWorker(_)
            | ParsedCli::Upgrade(_) => {
                panic!("expected codex-auth cli")
            }
        }
    }

    #[test]
    fn parse_upgrade_command_uses_upgrade_cli() {
        let parsed = parse_cli_from(vec![OsString::from("nac"), OsString::from("upgrade")]);
        match parsed {
            ParsedCli::Upgrade(cli) => assert!(cli.install_dir.is_none()),
            ParsedCli::Run(_)
            | ParsedCli::Resume(_)
            | ParsedCli::ManagedWorker(_)
            | ParsedCli::CodexAuth(_) => panic!("expected upgrade cli"),
        }

        let parsed = parse_cli_from(vec![
            OsString::from("nac"),
            OsString::from("upgrade"),
            OsString::from("--install-dir"),
            OsString::from("/tmp/nac-bin"),
        ]);
        match parsed {
            ParsedCli::Upgrade(cli) => {
                assert_eq!(cli.install_dir.as_deref(), Some(Path::new("/tmp/nac-bin")));
            }
            ParsedCli::Run(_)
            | ParsedCli::Resume(_)
            | ParsedCli::ManagedWorker(_)
            | ParsedCli::CodexAuth(_) => panic!("expected upgrade cli"),
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
                skills: Vec::new(),
            },
            store: StoreArgs {
                store_path: Some(store_path.clone()),
            },
            model: default_model_args(),
            sandbox: default_sandbox_args(),
        };

        let run_config = build_managed_worker_config(cli, &NacConfig::default())
            .await
            .unwrap();

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
        let run_config = build_resume_config(
            ResumeCli {
                session_id: Some("resume-session".to_string()),
                last: false,
                directory: Some(session_cwd.clone()),
                store: StoreArgs { store_path: None },
            },
            &NacConfig::default(),
        )
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
