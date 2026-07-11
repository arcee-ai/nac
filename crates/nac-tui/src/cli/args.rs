use super::*;

#[derive(Parser)]
#[command(
    name = "nac",
    about = "agent",
    after_help = "Commands:\n  nac resume [SESSION_ID]    Continue a saved session\n  nac codex-auth [COMMAND]   Manage ChatGPT Codex auth\n  nac arcee-auth [COMMAND]   Manage Arcee auth\n  nac upgrade                Reinstall the latest nac release",
    after_long_help = "Commands:\n  nac resume [SESSION_ID]    Continue a saved session\n  nac codex-auth [COMMAND]   Manage ChatGPT Codex auth\n  nac arcee-auth [COMMAND]   Manage Arcee auth\n  nac upgrade                Reinstall the latest nac release\n\nModel configuration:\n  New sessions require backend, model, and base URL, supplied here or in config.toml.\n  API-key backends use exactly the environment variable named by --api-key-env;\n  no provider key variable is selected implicitly. arcee-auth uses the stored Arcee\n  login and accepts no key selector. arcee-api requires --api-key-env.\n  chatgpt-codex-responses uses stored Codex OAuth and accepts no key selector."
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

    /// Internal OpenSSH target for remote workers.
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
    /// Override the SQLite store path
    #[arg(long)]
    pub(super) store_path: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
pub(super) enum BackendArg {
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
    #[value(name = "arcee-auth")]
    ArceeAuth,
    #[value(name = "arcee-api")]
    ArceeApi,
}

impl From<BackendArg> for BackendKind {
    fn from(value: BackendArg) -> Self {
        match value {
            BackendArg::DeepSeekChat => Self::DeepSeekChat,
            BackendArg::FireworksChat => Self::FireworksChat,
            BackendArg::TogetherChat => Self::TogetherChat,
            BackendArg::OpenAiResponses => Self::OpenAiResponses,
            BackendArg::ChatGptCodexResponses => Self::ChatGptCodexResponses,
            BackendArg::AnthropicMessages => Self::AnthropicMessages,
            BackendArg::ArceeAuth => Self::ArceeAuth,
            BackendArg::ArceeApi => Self::ArceeApi,
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
    /// Backend wire shape (required here or in config.toml)
    ///
    /// arcee-auth uses the stored Arcee login and rejects --api-key-env;
    /// arcee-api requires a selected environment key; chatgpt-codex-responses
    /// uses stored Codex OAuth and rejects --api-key-env.
    #[arg(long, value_enum)]
    pub(super) backend: Option<BackendArg>,

    /// Model identifier (required here or in config.toml)
    #[arg(
        long = "model",
        alias = "api-model",
        value_name = "MODEL",
        value_parser = nonblank_model_value
    )]
    pub(super) api_model: Option<String>,

    /// Model API base URL (required here or in config.toml)
    #[arg(
        long = "base-url",
        alias = "api-base-url",
        value_name = "BASE_URL",
        value_parser = nonblank_base_url_value
    )]
    pub(super) api_base_url: Option<String>,

    /// Exact environment variable containing the API key
    ///
    /// No provider variable is chosen implicitly. Required by API-key backends,
    /// including arcee-api; rejected by arcee-auth and
    /// chatgpt-codex-responses, which use stored credentials. Omit both selector
    /// flags to inherit config.toml, or use --clear-api-key-env to select none.
    #[arg(
        long = "api-key-env",
        value_name = "ENV_VAR",
        value_parser = nonblank_api_key_env_value,
        conflicts_with = "clear_api_key_env"
    )]
    pub(super) api_key_env: Option<String>,

    /// Clear a configured API-key environment selector instead of inheriting it
    #[arg(long, conflicts_with = "api_key_env")]
    pub(super) clear_api_key_env: bool,

    /// Reasoning effort to request when supported by the selected backend
    ///
    /// Omit both effort flags to inherit config.toml. --effort none is a
    /// concrete protocol value; use --clear-effort to select no effort setting.
    #[arg(long = "effort", value_enum, conflicts_with = "clear_effort")]
    pub(super) reasoning_effort: Option<ReasoningEffortArg>,

    /// Clear configured reasoning effort instead of inheriting it
    #[arg(long, conflicts_with = "reasoning_effort")]
    pub(super) clear_effort: bool,

    /// Extra request headers as a JSON object with string values
    ///
    /// Omit to inherit config.toml. Pass `{}` to explicitly select no headers.
    #[arg(
        long = "extra-headers",
        value_name = "JSON",
        value_parser = runtime::parse_extra_headers_json
    )]
    pub(super) extra_headers: Option<std::collections::BTreeMap<String, String>>,
}

fn nonblank_model_value(value: &str) -> std::result::Result<String, String> {
    nonblank_model_setting(value, "model")
}

fn nonblank_base_url_value(value: &str) -> std::result::Result<String, String> {
    nonblank_model_setting(value, "base URL")
}

fn nonblank_api_key_env_value(value: &str) -> std::result::Result<String, String> {
    nonblank_model_setting(value, "api_key_env")
}

fn nonblank_model_setting(value: &str, name: &str) -> std::result::Result<String, String> {
    if value.trim().is_empty() {
        Err(format!("{name} must not be blank"))
    } else {
        Ok(value.to_string())
    }
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
    /// Run tool execution inside a session-scoped sandbox
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

    /// Sandbox backend to use (podman or smolvm)
    #[arg(long = "sandbox-backend")]
    pub(super) sandbox_backend: Option<String>,

    /// Number of CPUs to allocate for the sandbox (default: 2)
    #[arg(long = "sandbox-cpus")]
    pub(super) sandbox_cpus: Option<u8>,

    /// Memory in MiB to allocate for the sandbox (default: 2048)
    #[arg(long = "sandbox-mem")]
    pub(super) sandbox_mem: Option<u32>,

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
#[command(name = "nac arcee-auth", about = "manage Arcee auth")]
pub(super) struct ArceeAuthCli {
    #[command(subcommand)]
    pub(super) command: Option<ArceeAuthCommand>,
}

#[derive(Subcommand)]
pub(super) enum ArceeAuthCommand {
    /// Sign in with Arcee using device code authorization
    Login,
    /// Show stored Arcee auth status
    Status,
    /// Remove stored Arcee auth
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
    ArceeAuth(ArceeAuthCli),
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
        .is_some_and(|value| value == OsStr::new("arcee-auth"))
    {
        ParsedCli::ArceeAuth(ArceeAuthCli::parse_from(subcommand_args(
            args,
            "nac arcee-auth",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_model_options_parse_and_override_config_as_a_complete_tuple() {
        let cli = RunCli::try_parse_from([
            "nac",
            "--backend",
            "together-chat",
            "--model",
            "cli-model",
            "--base-url",
            "https://cli.example/v1",
            "--api-key-env",
            "CLI_API_KEY",
            "--effort",
            "high",
            "--extra-headers",
            r#"{"X-CLI":"selected"}"#,
        ])
        .unwrap();
        let options = model_options(cli.model);

        let mut config = runtime::NacConfig::default();
        config.model.backend = Some(BackendKind::OpenAiResponses);
        config.model.model = Some("config-model".to_string());
        config.model.base_url = Some("https://config.example/v1".to_string());
        config.model.api_key_env = Some("CONFIG_API_KEY".to_string());
        config.model.reasoning_effort = Some(ReasoningEffort::Low);
        config
            .model
            .extra_headers
            .insert("X-Config".to_string(), "ignored".to_string());

        let actual = runtime::effective_model_settings(&options, &config).unwrap();
        let expected = nac_core::model::EffectiveModelSettings::new(
            BackendKind::TogetherChat,
            "cli-model".to_string(),
            "https://cli.example/v1".to_string(),
            Some(ReasoningEffort::High),
            Some("CLI_API_KEY".to_string()),
            std::collections::BTreeMap::from([("X-CLI".to_string(), "selected".to_string())]),
        )
        .unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn omitted_public_model_options_inherit_config() {
        let cli = RunCli::try_parse_from(["nac"]).unwrap();
        let mut config = runtime::NacConfig::default();
        config.model.backend = Some(BackendKind::AnthropicMessages);
        config.model.model = Some("claude-sonnet-4-6".to_string());
        config.model.base_url = Some("https://config.example/v1".to_string());
        config.model.api_key_env = Some("CONFIG_API_KEY".to_string());
        config.model.reasoning_effort = Some(ReasoningEffort::Medium);
        config
            .model
            .extra_headers
            .insert("X-Config".to_string(), "inherited".to_string());

        let actual = runtime::effective_model_settings(&model_options(cli.model), &config).unwrap();
        let expected = nac_core::model::EffectiveModelSettings::new(
            BackendKind::AnthropicMessages,
            "claude-sonnet-4-6".to_string(),
            "https://config.example/v1".to_string(),
            Some(ReasoningEffort::Medium),
            Some("CONFIG_API_KEY".to_string()),
            config.model.extra_headers.clone(),
        )
        .unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn public_optional_model_options_support_inherit_value_and_clear() {
        let mut config = runtime::NacConfig::default();
        config.model.backend = Some(BackendKind::OpenAiResponses);
        config.model.model = Some("config-model".to_string());
        config.model.base_url = Some("https://config.example/v1".to_string());
        config.model.api_key_env = Some("CONFIG_API_KEY".to_string());
        config.model.reasoning_effort = Some(ReasoningEffort::High);

        let inherited = RunCli::try_parse_from(["nac"]).unwrap();
        let inherited =
            runtime::effective_model_settings(&model_options(inherited.model), &config).unwrap();
        let expected_inherited = nac_core::model::EffectiveModelSettings::new(
            BackendKind::OpenAiResponses,
            "config-model".to_string(),
            "https://config.example/v1".to_string(),
            Some(ReasoningEffort::High),
            Some("CONFIG_API_KEY".to_string()),
            std::collections::BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(inherited, expected_inherited);

        let valued =
            RunCli::try_parse_from(["nac", "--api-key-env", "CLI_API_KEY", "--effort", "none"])
                .unwrap();
        let valued =
            runtime::effective_model_settings(&model_options(valued.model), &config).unwrap();
        let expected_valued = nac_core::model::EffectiveModelSettings::new(
            BackendKind::OpenAiResponses,
            "config-model".to_string(),
            "https://config.example/v1".to_string(),
            Some(ReasoningEffort::None),
            Some("CLI_API_KEY".to_string()),
            std::collections::BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            valued, expected_valued,
            "--effort none is a concrete protocol value, not a clear operation"
        );

        let cleared =
            RunCli::try_parse_from(["nac", "--clear-api-key-env", "--clear-effort"]).unwrap();
        let cleared =
            runtime::effective_model_settings(&model_options(cleared.model), &config).unwrap();
        let expected_cleared = nac_core::model::EffectiveModelSettings::new(
            BackendKind::OpenAiResponses,
            "config-model".to_string(),
            "https://config.example/v1".to_string(),
            None,
            None,
            std::collections::BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(cleared, expected_cleared);
    }

    #[test]
    fn clear_flags_conflict_with_concrete_value_flags() {
        for args in [
            vec!["nac", "--api-key-env", "CLI_API_KEY", "--clear-api-key-env"],
            vec!["nac", "--effort", "none", "--clear-effort"],
        ] {
            let error = RunCli::try_parse_from(args)
                .err()
                .expect("value and clear forms must conflict")
                .to_string();
            assert!(error.contains("cannot be used with"), "{error}");
        }
    }

    #[test]
    fn clear_flags_allow_switching_configured_api_backend_to_managed_backends() {
        let mut config = runtime::NacConfig::default();
        config.model.backend = Some(BackendKind::OpenAiResponses);
        config.model.model = Some("config-model".to_string());
        config.model.base_url = Some("https://config.example/v1".to_string());
        config.model.api_key_env = Some("CONFIG_API_KEY".to_string());
        config.model.reasoning_effort = Some(ReasoningEffort::High);

        for (backend, expected_backend) in [
            ("arcee-auth", BackendKind::ArceeAuth),
            (
                "chatgpt-codex-responses",
                BackendKind::ChatGptCodexResponses,
            ),
        ] {
            let cli = RunCli::try_parse_from([
                "nac",
                "--backend",
                backend,
                "--clear-api-key-env",
                "--clear-effort",
            ])
            .unwrap();
            let settings =
                runtime::effective_model_settings(&model_options(cli.model), &config).unwrap();
            let expected = nac_core::model::EffectiveModelSettings::new(
                expected_backend,
                "config-model".to_string(),
                "https://config.example/v1".to_string(),
                None,
                None,
                std::collections::BTreeMap::new(),
            )
            .unwrap();
            assert_eq!(settings, expected, "backend {backend}");
            nac_core::model::validate_backend_api_key_env(
                expected_backend,
                Some("https://config.example/v1"),
                None,
            )
            .unwrap();
        }
    }

    #[test]
    fn public_model_options_resolve_each_credential_mode() {
        for (backend, selector) in [
            ("openai-responses", Some("OPENAI_SELECTED_KEY")),
            ("arcee-api", Some("ARCEE_SELECTED_KEY")),
            ("arcee-auth", None),
            ("chatgpt-codex-responses", None),
        ] {
            let mut args = vec![
                "nac",
                "--backend",
                backend,
                "--model",
                "selected-model",
                "--base-url",
                "https://api.example/v1",
            ];
            if let Some(selector) = selector {
                args.extend(["--api-key-env", selector]);
            }
            let cli = RunCli::try_parse_from(args).unwrap();
            let options = model_options(cli.model);
            let expected_backend = options.backend.unwrap();

            let settings =
                runtime::effective_model_settings(&options, &runtime::NacConfig::default())
                    .unwrap();
            let expected = nac_core::model::EffectiveModelSettings::new(
                expected_backend,
                "selected-model".to_string(),
                "https://api.example/v1".to_string(),
                None,
                selector.map(str::to_string),
                std::collections::BTreeMap::new(),
            )
            .unwrap();
            assert_eq!(settings, expected, "backend {backend}");
            nac_core::model::validate_backend_api_key_env(
                expected_backend,
                Some("https://api.example/v1"),
                selector,
            )
            .unwrap();
        }
    }

    #[test]
    fn public_model_options_report_missing_and_blank_required_settings() {
        for (config, expected) in [
            (runtime::NacConfig::default(), "backend"),
            (
                {
                    let mut config = runtime::NacConfig::default();
                    config.model.backend = Some(BackendKind::OpenAiResponses);
                    config
                },
                "model",
            ),
            (
                {
                    let mut config = runtime::NacConfig::default();
                    config.model.backend = Some(BackendKind::OpenAiResponses);
                    config.model.model = Some("configured-model".to_string());
                    config
                },
                "base_url",
            ),
        ] {
            let cli = RunCli::try_parse_from(["nac"]).unwrap();
            let error =
                runtime::effective_model_settings(&model_options(cli.model), &config).unwrap_err();
            assert!(error.to_string().contains(expected), "{error:#}");
        }

        let backend_error = RunCli::try_parse_from(["nac", "--backend", ""])
            .err()
            .expect("blank explicit backend must be rejected")
            .to_string();
        assert!(
            backend_error.contains("a value is required"),
            "{backend_error}"
        );
        assert!(backend_error.contains("--backend"), "{backend_error}");

        for (flag, label) in [
            ("--model", "model"),
            ("--base-url", "base URL"),
            ("--api-key-env", "api_key_env"),
        ] {
            let error = RunCli::try_parse_from(["nac", flag, "   "])
                .err()
                .expect("blank explicit value must be rejected")
                .to_string();
            assert!(error.contains(label), "{error}");
            assert!(error.contains("must not be blank"), "{error}");
        }
    }

    #[test]
    fn public_api_key_selector_preserves_raw_input_and_rejects_surrounding_whitespace() {
        let raw_selector = " SURROUNDED_KEY ";
        let cli = RunCli::try_parse_from([
            "nac",
            "--backend",
            "openai-responses",
            "--model",
            "test-model",
            "--base-url",
            "https://api.openai.com/v1",
            "--api-key-env",
            raw_selector,
        ])
        .unwrap();
        assert_eq!(cli.model.api_key_env.as_deref(), Some(raw_selector));

        let options = model_options(cli.model);
        let actual =
            runtime::effective_model_settings(&options, &runtime::NacConfig::default()).unwrap();
        let expected = nac_core::model::EffectiveModelSettings::new(
            BackendKind::OpenAiResponses,
            "test-model".to_string(),
            "https://api.openai.com/v1".to_string(),
            None,
            Some(raw_selector.to_string()),
            std::collections::BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(actual, expected);

        let error = nac_core::model::validate_backend_api_key_env(
            BackendKind::OpenAiResponses,
            Some("https://api.openai.com/v1"),
            Some(raw_selector),
        )
        .expect_err("surrounding whitespace must be rejected rather than trimmed");
        assert!(error.to_string().contains(raw_selector));
        assert!(error.to_string().contains("[A-Za-z_][A-Za-z0-9_]*"));
    }

    #[test]
    fn public_extra_headers_reject_malformed_json_and_accept_empty_object() {
        let error = RunCli::try_parse_from(["nac", "--extra-headers", "not-json"])
            .err()
            .expect("malformed public headers must be rejected")
            .to_string();
        assert!(error.contains("expected a JSON object"), "{error}");

        let cli = RunCli::try_parse_from(["nac", "--extra-headers", "{}"]).unwrap();
        assert_eq!(
            cli.model.extra_headers,
            Some(std::collections::BTreeMap::new())
        );
    }

    #[test]
    fn long_help_documents_strict_model_and_credential_contract() {
        let help = RunCli::command().render_long_help().to_string();
        for expected in [
            "--backend",
            "--model",
            "--base-url",
            "--api-key-env",
            "--clear-api-key-env",
            "--effort",
            "--clear-effort",
            "--extra-headers",
            "required here or in config.toml",
            "exactly the environment variable",
            "arcee-auth uses the stored Arcee login",
            "arcee-api requires --api-key-env",
            "stored Codex OAuth",
            "concrete protocol value",
            "instead of inheriting",
        ] {
            assert!(help.contains(expected), "missing {expected:?} in:\n{help}");
        }
    }

    #[test]
    fn hidden_worker_accepts_snapshot_transport_aliases() {
        let cli = ManagedWorkerCli::try_parse_from([
            "nac __worker",
            "--session-id",
            "session",
            "--thread-name",
            "thread",
            "--action",
            "work",
            "--backend",
            "together-chat",
            "--api-model",
            "snapshot-model",
            "--api-base-url",
            "https://snapshot.example/v1",
            "--api-key-env",
            "SNAPSHOT_API_KEY",
            "--extra-headers",
            "{}",
        ])
        .unwrap();
        assert_eq!(cli.model.api_model.as_deref(), Some("snapshot-model"));
        assert_eq!(
            cli.model.api_base_url.as_deref(),
            Some("https://snapshot.example/v1")
        );
        assert_eq!(cli.model.api_key_env.as_deref(), Some("SNAPSHOT_API_KEY"));
        assert!(!cli.model.clear_api_key_env);
        assert!(!cli.model.clear_effort);
        assert_eq!(
            cli.model.extra_headers,
            Some(std::collections::BTreeMap::new())
        );
    }

    #[test]
    fn hidden_worker_rejects_malformed_header_json() {
        let error = ManagedWorkerCli::try_parse_from([
            "nac __worker",
            "--session-id",
            "session",
            "--thread-name",
            "thread",
            "--action",
            "work",
            "--extra-headers",
            "not-json",
        ])
        .err()
        .expect("malformed worker headers must be rejected")
        .to_string();
        assert!(error.contains("expected a JSON object"), "{error}");
    }

    #[test]
    fn run_cli_accepts_explicit_arcee_modes_and_rejects_removed_names() {
        for (raw, expected) in [
            ("arcee-auth", BackendKind::ArceeAuth),
            ("arcee-api", BackendKind::ArceeApi),
        ] {
            let cli = RunCli::try_parse_from(["nac", "--backend", raw]).unwrap();
            assert_eq!(cli.model.backend.map(BackendKind::from), Some(expected));
        }

        for raw in ["arcee", "auto"] {
            let error = RunCli::try_parse_from(["nac", "--backend", raw])
                .err()
                .expect("removed backend must be rejected")
                .to_string();
            assert!(error.contains("invalid value"), "{error}");
            assert!(error.contains("arcee-auth"), "{error}");
            assert!(error.contains("arcee-api"), "{error}");
        }
    }
}
