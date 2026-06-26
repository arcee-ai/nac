use std::ffi::{OsStr, OsString};
use std::io::{self, IsTerminal};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{CommandFactory, Parser, Subcommand};

use nac_core::model::{run_codex_auth_action, BackendKind, CodexAuthAction, ReasoningEffort};
use nac_core::runtime::{
    self, run_managed_worker, ManagedWorkerOptions, ModelOptions, ResumeOptions, RunOptions,
    RunState, SandboxOptions, StoreOptions, WorkerDispatchOptions,
};
use nac_core::session_service::SessionService;
use nac_core::upgrade::{run_upgrade, UpgradeRequest};
use nac_tui::TuiOutcome;

mod args;

use args::*;

pub async fn run() -> Result<()> {
    let cli = parse_cli();

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

    let launch_cwd = std::env::current_dir()?;
    let effective_cwd = effective_cli_cwd(&cli, &launch_cwd)?;
    let config_cwd = effective_cli_config_cwd(&cli, &launch_cwd, &effective_cwd)?;
    let app_config = runtime::NacConfig::load_from_cwd(&config_cwd)?;
    let worker_executable = current_worker_executable()?;
    let mut run_state = build_run_state(
        cli,
        &app_config,
        effective_cwd,
        config_cwd,
        worker_executable.clone(),
    )
    .await?;

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
                let resume_base_cwd = run_config.resume_base_cwd().to_path_buf();
                let session_service = SessionService::from_orchestrator_run_config(run_config);
                let store_path = session_service.init.metadata.store_path.clone();

                match nac_tui::run(
                    session_service.service,
                    session_service.init,
                    session_service.events,
                    start_in_session_picker,
                )
                .await?
                {
                    TuiOutcome::Exit => return Ok(()),
                    TuiOutcome::ResumeSession(session_id) => {
                        run_state = RunState::Orchestrator {
                            run_config: runtime::build_resume_config_for_session(
                                store_path,
                                &session_id,
                                &app_config,
                                resume_base_cwd,
                                Some(worker_executable.clone()),
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

async fn build_run_state(
    cli: ParsedCli,
    config: &runtime::NacConfig,
    effective_cwd: PathBuf,
    config_cwd: PathBuf,
    worker_executable: PathBuf,
) -> Result<RunState> {
    match cli {
        ParsedCli::Run(cli) => Ok(RunState::Orchestrator {
            run_config: runtime::build_run_config(
                run_options(cli, effective_cwd, config_cwd, worker_executable),
                config,
            )
            .await?,
            start_in_session_picker: false,
        }),
        ParsedCli::ManagedWorker(cli) => Ok(RunState::ManagedWorker(
            runtime::build_managed_worker_config(
                managed_worker_options(cli, effective_cwd, config_cwd),
                config,
            )
            .await?,
        )),
        ParsedCli::Resume(cli) if cli.session_id.is_none() && !cli.last => {
            Ok(RunState::Orchestrator {
                run_config: runtime::build_resume_picker_config(
                    resume_options(cli, effective_cwd, worker_executable),
                    config,
                )
                .await?,
                start_in_session_picker: true,
            })
        }
        ParsedCli::Resume(cli) => Ok(RunState::Orchestrator {
            run_config: runtime::build_resume_config(
                resume_options(cli, effective_cwd, worker_executable),
                config,
            )
            .await?,
            start_in_session_picker: false,
        }),
        ParsedCli::CodexAuth(_) => unreachable!("codex-auth is handled before loading config"),
        ParsedCli::Upgrade(_) => unreachable!("upgrade is handled before loading config"),
    }
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

async fn run_upgrade_cli(cli: UpgradeCli) -> Result<()> {
    run_upgrade(UpgradeRequest {
        install_dir: cli.install_dir,
        executable_path: Some(current_worker_executable()?),
        package_version: env!("CARGO_PKG_VERSION").to_string(),
    })
    .await
}

fn current_worker_executable() -> Result<PathBuf> {
    std::env::current_exe().context("failed to determine nac worker executable path")
}

fn effective_cli_cwd(cli: &ParsedCli, launch_cwd: &Path) -> Result<PathBuf> {
    match cli {
        ParsedCli::Run(cli) => resolve_cli_cwd(launch_cwd, cli.directory.as_deref()),
        ParsedCli::Resume(cli) => resolve_cli_cwd(launch_cwd, cli.directory.as_deref()),
        ParsedCli::ManagedWorker(cli) => match (&cli.ssh_host, &cli.workspace_cwd) {
            (Some(_), Some(remote_cwd)) => Ok(remote_cwd.clone()),
            _ => resolve_cli_cwd(launch_cwd, cli.workspace_cwd.as_deref()),
        },
        ParsedCli::CodexAuth(_) | ParsedCli::Upgrade(_) => Ok(launch_cwd.to_path_buf()),
    }
}

fn effective_cli_config_cwd(
    cli: &ParsedCli,
    launch_cwd: &Path,
    effective_cwd: &Path,
) -> Result<PathBuf> {
    match cli {
        ParsedCli::ManagedWorker(worker) => match worker.config_cwd.as_deref() {
            Some(config_cwd) => resolve_cli_cwd(launch_cwd, Some(config_cwd)),
            None if worker.ssh_host.is_some() => Ok(launch_cwd.to_path_buf()),
            None => Ok(effective_cwd.to_path_buf()),
        },
        ParsedCli::Run(_) | ParsedCli::Resume(_) => Ok(effective_cwd.to_path_buf()),
        ParsedCli::CodexAuth(_) | ParsedCli::Upgrade(_) => Ok(launch_cwd.to_path_buf()),
    }
}

fn resolve_cli_cwd(launch_cwd: &Path, directory: Option<&Path>) -> Result<PathBuf> {
    let target = match directory {
        Some(path) if path.is_absolute() => path.to_path_buf(),
        Some(path) => launch_cwd.join(path),
        None => launch_cwd.to_path_buf(),
    };
    target
        .canonicalize()
        .with_context(|| format!("failed to resolve working directory {}", target.display()))
}

fn store_options(cli: StoreArgs) -> StoreOptions {
    StoreOptions {
        store_path: cli.store_path,
    }
}

fn model_options(cli: ModelArgs) -> ModelOptions {
    let extra_headers = cli
        .extra_headers
        .as_deref()
        .and_then(runtime::parse_extra_headers_json);
    ModelOptions {
        backend: cli.backend.map(Into::into),
        reasoning_effort: cli.reasoning_effort.map(Into::into),
        api_base_url: cli.api_base_url,
        api_model: cli.api_model,
        api_key_env: cli.api_key_env,
        extra_headers,
    }
}

fn sandbox_options(cli: SandboxArgs) -> SandboxOptions {
    SandboxOptions {
        sandbox: cli.sandbox,
        no_mount_cwd: cli.no_mount_cwd,
        mounts: cli.mounts,
        mounts_ro: cli.mounts_ro,
        sandbox_image: cli.sandbox_image,
        sandbox_gpus: cli.sandbox_gpus,
        sandbox_shm_size: cli.sandbox_shm_size,
        sandbox_session_key: cli.sandbox_session_key,
        sandbox_workdir: cli.sandbox_workdir,
        sandbox_backend: cli.sandbox_backend,
    }
}

fn worker_dispatch_options(cli: WorkerDispatchArgs) -> WorkerDispatchOptions {
    WorkerDispatchOptions {
        session_id: cli.session_id,
        thread_name: cli.thread_name,
        action: cli.action,
        source_threads: cli.source_threads,
        skills: cli.skills,
    }
}

fn run_options(
    cli: RunCli,
    workspace_cwd: PathBuf,
    config_cwd: PathBuf,
    worker_executable: PathBuf,
) -> RunOptions {
    RunOptions {
        workspace_cwd,
        config_cwd: Some(config_cwd),
        worker_executable: Some(worker_executable),
        store: store_options(cli.store),
        model: model_options(cli.model),
        sandbox: sandbox_options(cli.sandbox),
        ssh_host: None,
    }
}

fn managed_worker_options(
    cli: ManagedWorkerCli,
    workspace_cwd: PathBuf,
    config_cwd: PathBuf,
) -> ManagedWorkerOptions {
    ManagedWorkerOptions {
        workspace_cwd,
        config_cwd: Some(config_cwd),
        dispatch: worker_dispatch_options(cli.dispatch),
        store: store_options(cli.store),
        model: model_options(cli.model),
        sandbox: sandbox_options(cli.sandbox),
        ssh_host: cli.ssh_host,
    }
}

fn resume_options(
    cli: ResumeCli,
    lookup_cwd: PathBuf,
    worker_executable: PathBuf,
) -> ResumeOptions {
    ResumeOptions {
        lookup_cwd,
        worker_executable: Some(worker_executable),
        session_id: cli.session_id,
        last: cli.last,
        store: store_options(cli.store),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

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
            OsString::from("--workspace-cwd"),
            OsString::from("/tmp/worker-workspace"),
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
                assert_eq!(
                    worker.workspace_cwd.as_deref(),
                    Some(Path::new("/tmp/worker-workspace"))
                );
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
    fn parse_hidden_worker_ssh_host_uses_remote_workspace_cwd_verbatim() {
        let parsed = parse_cli_from(vec![
            OsString::from("nac"),
            OsString::from("__worker"),
            OsString::from("--session-id"),
            OsString::from("session-123"),
            OsString::from("--thread-name"),
            OsString::from("impl"),
            OsString::from("--action"),
            OsString::from("do work"),
            OsString::from("--workspace-cwd"),
            OsString::from("/remote/workspace/does-not-exist-locally"),
            OsString::from("--ssh-host"),
            OsString::from("build-box"),
        ]);
        match &parsed {
            ParsedCli::ManagedWorker(worker) => {
                assert_eq!(worker.ssh_host.as_deref(), Some("build-box"));
            }
            ParsedCli::Run(_)
            | ParsedCli::Resume(_)
            | ParsedCli::CodexAuth(_)
            | ParsedCli::Upgrade(_) => {
                panic!("expected managed worker cli")
            }
        }

        let effective = effective_cli_cwd(&parsed, Path::new("/launch")).unwrap();
        assert_eq!(
            effective,
            PathBuf::from("/remote/workspace/does-not-exist-locally")
        );
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
}
