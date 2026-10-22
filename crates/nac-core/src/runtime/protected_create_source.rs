//! Private-value fingerprints of actual resolved CREATE inputs, never admission.
//! Callers retain the SAME source/resource owners and resolved values through
//! verification and construction. This module performs no host/credential IO,
//! default resolution, wire parsing, prompt preparation or resource acquisition.
use super::{EffectiveSandboxOptions, OptionalModelOption, SshConnection};
use crate::{
    light_model::{LightModelSettings, TrustedLightCredential},
    model::{
        ApiKind, CompletionsThinkingFormat, CompletionsTokenLimit, EffectiveModelSettings,
        ModelMetadata, ReasoningEffort,
    },
    model_configurations::ModelConfigurationRecord,
    permissions::PermissionRule,
    sessions::SessionBehavior,
    terminal::CommandOutputLimits,
};
use anyhow::{ensure, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Actual selected row and its same-store source revision. Observation DATA
/// does not freeze a writer; the genuine verifier must retain its reservation.
pub struct CreateSourceModel<'a> {
    pub record: &'a ModelConfigurationRecord,
    pub revision: i64,
}

pub enum CreateSourceTarget<'a> {
    Project { id: &'a str, revision: [u8; 32] },
    WorkingLocation { id: &'a str, revision: [u8; 32] },
}

/// Fingerprint an actual project row and its coherent durable source revision.
/// This is observation DATA, not physical workspace custody or a source lease.
/// UI presentation fields and timestamps are deliberately excluded; association
/// changes are represented by the caller's actual durable source revision.
pub fn project_create_target_revision(
    project: &crate::projects::ProjectRecord,
    source_revision: i64,
) -> Result<[u8; 32]> {
    ensure!(
        source_revision > 0,
        "CREATE project source revision unavailable"
    );
    ensure!(
        bounded_id(&project.project_id),
        "CREATE project identity invalid"
    );
    let cwd = absolute_path(&project.cwd)?;
    ensure!(
        [
            project.ssh_host.as_deref(),
            project.ssh_identity_file.as_deref(),
            project.default_model_config_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        .all(|value| !value.contains('\0')),
        "CREATE project selector invalid"
    );
    digest(&json!([
        "native-create-project-source-v1",
        source_revision,
        project.project_id,
        cwd,
        project.ssh_host,
        project.ssh_port,
        project.ssh_identity_file,
        project.default_model_config_id
    ]))
}

pub struct CreateCommandChoices<'a> {
    pub target: CreateSourceTarget<'a>,
    pub selected_model_id: &'a str,
    pub reasoning_effort: &'a OptionalModelOption<ReasoningEffort>,
    pub behavior: SessionBehavior,
    pub first_chat: bool,
    pub first_chat_same_behavior: bool,
}

/// Resolved once using the existing runtime helpers. The builder must use these
/// SAME values, rather than independently resolving another NacConfig/RunOptions.
/// Deliberately neither Debug nor Serialize: headers and selectors stay private.
pub struct ResolvedCreateConfiguration<'a> {
    pub behavior: SessionBehavior,
    pub model: &'a EffectiveModelSettings,
    pub sandbox: &'a EffectiveSandboxOptions,
    pub store_path: &'a Path,
    pub workspace_cwd: &'a Path,
    pub config_cwd: &'a Path,
    pub worker_executable: Option<&'a Path>,
    pub ssh: Option<&'a SshConnection>,
    pub compaction_threshold: Option<u64>,
    pub light_model: Option<&'a LightModelSettings>,
    pub trusted_light_credential: Option<&'a TrustedLightCredential>,
    pub worker_thread_timeout_secs: u64,
    pub command_output_limits: CommandOutputLimits,
    pub permission_rules: &'a [PermissionRule],
}

/// Owned resolution DATA only, retained unchanged for facts, verification and
/// protected construction. No client/agent/resource is prepared by this value.
pub struct ResolvedCreateInputs {
    #[cfg(unix)]
    global_source: Option<std::sync::Arc<super::CreateGlobalPreparationSource>>,
    options: super::RunOptions,
    config: super::NacConfig,
    model: EffectiveModelSettings,
    sandbox: EffectiveSandboxOptions,
    store_path: std::path::PathBuf,
    config_cwd: std::path::PathBuf,
    ssh: Option<SshConnection>,
    threshold: Option<u64>,
    timeout: u64,
    output_limits: CommandOutputLimits,
    behavior: SessionBehavior,
}
impl ResolvedCreateInputs {
    pub fn configuration(&self) -> ResolvedCreateConfiguration<'_> {
        ResolvedCreateConfiguration {
            behavior: self.behavior,
            model: &self.model,
            sandbox: &self.sandbox,
            store_path: &self.store_path,
            workspace_cwd: &self.options.workspace_cwd,
            config_cwd: &self.config_cwd,
            worker_executable: self.options.worker_executable.as_deref(),
            ssh: self.ssh.as_ref(),
            compaction_threshold: self.threshold,
            light_model: self.options.model.light_model.as_ref(),
            trusted_light_credential: self.options.model.trusted_light_credential.as_ref(),
            worker_thread_timeout_secs: self.timeout,
            command_output_limits: self.output_limits,
            permission_rules: &self.config.permissions.rules,
        }
    }
    pub fn behavior(&self) -> SessionBehavior {
        self.behavior
    }

    /// Core's protected builder consumes these SAME effective values. This
    /// crate-private move contains no admission or resource custody.
    pub(crate) fn into_parts(self) -> ResolvedCreateParts {
        ResolvedCreateParts {
            #[cfg(unix)]
            global_source: self.global_source,
            options: self.options,
            config: self.config,
            model: self.model,
            sandbox: self.sandbox,
            store_path: self.store_path,
            config_cwd: self.config_cwd,
            ssh: self.ssh,
            compaction_threshold: self.threshold,
            worker_thread_timeout_secs: self.timeout,
            command_output_limits: self.output_limits,
            behavior: self.behavior,
        }
    }
}

/// Only construction DATA, not a second runtime/factory capability.
pub(crate) struct ResolvedCreateParts {
    #[cfg(unix)]
    pub(crate) global_source: Option<std::sync::Arc<super::CreateGlobalPreparationSource>>,
    pub(crate) options: super::RunOptions,
    pub(crate) config: super::NacConfig,
    pub(crate) model: EffectiveModelSettings,
    pub(crate) sandbox: EffectiveSandboxOptions,
    pub(crate) store_path: std::path::PathBuf,
    pub(crate) config_cwd: std::path::PathBuf,
    pub(crate) ssh: Option<SshConnection>,
    pub(crate) compaction_threshold: Option<u64>,
    pub(crate) worker_thread_timeout_secs: u64,
    pub(crate) command_output_limits: CommandOutputLimits,
    pub(crate) behavior: SessionBehavior,
}

/// Capture actual effective inputs ONCE through the existing resolution helpers.
/// Catalog resolution retains its existing local source-reading behavior and
/// must run under the caller's original source/resource owner. This adds no
/// direct host/credential reads, persistence, agent/client or backend setup.
/// It does not exclude catalog writers: the caller must qualify that source;
/// this value retains the exact selected metadata snapshot, not a catalog lease.
pub fn resolve_create_inputs(
    options: super::RunOptions,
    config: &super::NacConfig,
    behavior: SessionBehavior,
) -> Result<ResolvedCreateInputs> {
    let failure = || anyhow::anyhow!("CREATE effective input resolution failed");
    let model = super::model_resolution::effective_create_model_settings(&options.model, config)
        .map_err(|_| failure())?;
    resolve_create_inputs_with_model(options, config, behavior, model)
}

/// Resolve from the SAME actual configuration/catalog home and original cutoff.
/// Performs physical checks; call outside SQL/credential locks. This is DATA,
/// never CREATE admission, and performs no ambient credential lookup.
#[cfg(unix)]
pub fn resolve_create_inputs_from_sources(
    options: super::RunOptions,
    configuration: &super::CreateConfigurationSource,
    catalog: &super::CreateModelCatalogSource,
    behavior: SessionBehavior,
) -> Result<ResolvedCreateInputs> {
    configuration.check_current()?;
    catalog.check_current()?;
    ensure!(
        configuration.home_identity()? == catalog.home_identity()?
            && configuration.original_cutoff() == catalog.original_cutoff(),
        "CREATE source owners differ"
    );
    let config = configuration.configuration()?;
    let model = super::model_resolution::effective_create_model_settings_from_catalog(
        &options.model,
        config,
        catalog.catalog()?,
    )
    .map_err(|_| anyhow::anyhow!("CREATE effective input resolution failed"))?;
    let resolved = resolve_create_inputs_with_model(options, config, behavior, model)?;
    configuration.check_current()?;
    catalog.check_current()?;
    Ok(resolved)
}

/// Resource-retaining source resolution for the genuine preparation consumer.
/// Global resources remain THIS same allocation through later preparation;
/// their presence supplies no file-read, CREATE or runtime permission.
#[cfg(unix)]
pub fn resolve_create_inputs_with_global_source(
    options: super::RunOptions,
    configuration: &super::CreateConfigurationSource,
    catalog: &super::CreateModelCatalogSource,
    global: std::sync::Arc<super::CreateGlobalPreparationSource>,
    behavior: SessionBehavior,
) -> Result<ResolvedCreateInputs> {
    global.check_current()?;
    ensure!(
        global.original_cutoff() == configuration.original_cutoff()
            && global.nac_home_identity()? == Some(configuration.home_identity()?),
        "CREATE global configuration source differs"
    );
    let mut resolved =
        resolve_create_inputs_from_sources(options, configuration, catalog, behavior)?;
    global.check_current()?;
    resolved.global_source = Some(global);
    Ok(resolved)
}

fn resolve_create_inputs_with_model(
    options: super::RunOptions,
    config: &super::NacConfig,
    behavior: SessionBehavior,
    model: EffectiveModelSettings,
) -> Result<ResolvedCreateInputs> {
    let failure = || anyhow::anyhow!("CREATE effective input resolution failed");
    let threshold = super::effective_orchestrator_compaction_threshold(
        options.orchestrator_compaction_threshold,
        model.resolved.context_window,
    )
    .map_err(|_| failure())?;
    let sandbox = super::sandboxing::effective_sandbox_options(options.sandbox.clone(), config);
    let config_cwd = options.config_cwd.clone().unwrap_or_else(|| {
        super::model_resolution::default_config_cwd(
            &options.workspace_cwd,
            options.ssh.host().as_deref(),
        )
    });
    let ssh = options.ssh.resolved_connection(&config_cwd);
    let store_base = if ssh.is_some() {
        &config_cwd
    } else {
        &options.workspace_cwd
    };
    let store_path = super::resolve_store_path(store_base, options.store.clone(), config);
    let timeout = super::model_resolution::worker_thread_timeout_secs(config);
    let output_limits =
        super::model_resolution::worker_command_output_limits(config).map_err(|_| failure())?;
    let captured = ResolvedCreateInputs {
        #[cfg(unix)]
        global_source: None,
        options,
        config: config.clone(),
        model,
        sandbox,
        store_path,
        config_cwd,
        ssh,
        threshold,
        timeout,
        output_limits,
        behavior,
    };
    // Encoding eligibility is checked without reading/reopening these paths.
    let view = captured.configuration();
    absolute_path(view.store_path)?;
    absolute_path(view.workspace_cwd)?;
    absolute_path(view.config_cwd)?;
    if let Some(path) = view.worker_executable {
        absolute_path(path)?;
    }
    Ok(captured)
}

/// Existing canonical21 members 18/19/20. These are observations, not a grant,
/// claim, source lease, complete intent SHA or final creation-snapshot seal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CreateSourceDigests {
    pub model_revision: [u8; 32],
    pub configuration_sha256: [u8; 32],
    pub command_digest: [u8; 32],
}

/// One canonical implementation for Native facts and Core verification. No raw
/// preimage is returned/exported/logged. Actual header strings are bound privately;
/// credential file contents and environment values are never consulted.
pub fn compute_create_source_digests(
    source: &CreateSourceModel<'_>,
    configuration: &ResolvedCreateConfiguration<'_>,
    choices: &CreateCommandChoices<'_>,
) -> Result<CreateSourceDigests> {
    ensure!(
        configuration.behavior == choices.behavior,
        "CREATE resolved behavior mismatch"
    );
    ensure!(
        source.revision > 0,
        "CREATE model source revision unavailable"
    );
    ensure!(
        bounded_id(&source.record.config_id)
            && choices.selected_model_id == source.record.config_id,
        "CREATE selected model source mismatch"
    );
    let (target_kind, target_id, target_revision) = match &choices.target {
        CreateSourceTarget::Project { id, revision } => ("project", *id, revision),
        CreateSourceTarget::WorkingLocation { id, revision } => ("location", *id, revision),
    };
    ensure!(
        bounded_id(target_id) && *target_revision != [0; 32],
        "CREATE target source unavailable"
    );
    ensure!(
        (!choices.first_chat || target_kind == "project")
            && (!choices.first_chat_same_behavior || choices.first_chat),
        "CREATE command choices invalid"
    );
    configuration
        .command_output_limits
        .validate()
        .map_err(|_| anyhow::anyhow!("CREATE output limits invalid"))?;
    ensure!(
        configuration.worker_thread_timeout_secs > 0,
        "CREATE worker timeout invalid"
    );

    // Exhaustive record projection: new source fields require an explicit
    // preimage decision rather than inheriting a DTO's changing serde shape.
    let ModelConfigurationRecord {
        config_id,
        name,
        backend,
        model,
        base_url,
        allow_insecure_http,
        api_key_env,
        reasoning_effort,
        extra_headers,
        orchestrator_compaction_threshold,
        initial_prompt,
        light_model,
        created_at,
        updated_at,
    } = source.record;
    let model_revision = digest(&json!([
        "native-create-model-source-v1",
        source.revision,
        config_id,
        name,
        backend,
        model,
        base_url,
        allow_insecure_http,
        api_key_env,
        reasoning_effort,
        extra_headers,
        orchestrator_compaction_threshold,
        initial_prompt,
        light_model,
        created_at,
        updated_at
    ]))?;

    let EffectiveModelSettings {
        backend,
        model,
        base_url,
        allow_insecure_http,
        reasoning_effort,
        api_key_env,
        trusted_api_key_file,
        extra_headers,
        resolved,
    } = configuration.model;
    let trusted = trusted_api_key_file
        .as_deref()
        .map(absolute_path)
        .transpose()?;
    let worker = configuration
        .worker_executable
        .map(absolute_path)
        .transpose()?;
    let ssh = configuration
        .ssh
        .map(|value| -> Result<Value> {
            let SshConnection {
                host,
                port,
                identity_file,
            } = value;
            ensure!(
                !host.is_empty() && !host.contains('\0') && *port != Some(0),
                "CREATE SSH selector invalid"
            );
            Ok(json!([
                host,
                port,
                identity_file.as_deref().map(absolute_path).transpose()?
            ]))
        })
        .transpose()?;
    let light_credential = configuration
        .trusted_light_credential
        .map(|value| -> Result<Value> {
            let TrustedLightCredential {
                backend,
                base_url,
                path,
            } = value;
            Ok(json!([backend.as_str(), base_url, absolute_path(path)?]))
        })
        .transpose()?;
    let configuration_sha256 = digest(&json!([
        "native-create-effective-configuration-v1",
        [
            backend.as_str(),
            model,
            base_url,
            allow_insecure_http,
            reasoning_effort,
            api_key_env,
            trusted,
            extra_headers,
            metadata(resolved)?
        ],
        sandbox(configuration.sandbox)?,
        [
            absolute_path(configuration.store_path)?,
            absolute_path(configuration.workspace_cwd)?,
            absolute_path(configuration.config_cwd)?,
            worker,
            ssh
        ],
        configuration.compaction_threshold,
        configuration.light_model,
        light_credential,
        configuration.worker_thread_timeout_secs,
        [
            configuration.command_output_limits.per_command_bytes,
            configuration.command_output_limits.per_session_bytes
        ],
        configuration.permission_rules
    ]))?;
    let effort = match choices.reasoning_effort {
        OptionalModelOption::Inherit => json!(["inherit"]),
        OptionalModelOption::Clear => json!(["clear"]),
        OptionalModelOption::Value(value) => json!(["value", value]),
    };
    let command_digest = digest(&json!([
        "native-create-resolved-command-v1",
        [target_kind, target_id, target_revision],
        choices.selected_model_id,
        model_revision,
        configuration_sha256,
        effort,
        choices.behavior.as_str(),
        choices.first_chat,
        choices.first_chat_same_behavior
    ]))?;
    Ok(CreateSourceDigests {
        model_revision,
        configuration_sha256,
        command_digest,
    })
}

fn bounded_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.contains('\0')
}
fn absolute_path(path: &Path) -> Result<&str> {
    ensure!(path.is_absolute(), "CREATE path selector is not resolved");
    let text = path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("CREATE path selector cannot be encoded"))?;
    ensure!(!text.contains('\0'), "CREATE path selector invalid");
    // Keep lexical bytes. Do not normalize separators/components or reopen it.
    Ok(text)
}
fn digest(value: &Value) -> Result<[u8; 32]> {
    serde_json::to_vec(value)
        .map(|bytes| Sha256::digest(bytes).into())
        .map_err(|_| anyhow::anyhow!("CREATE source preimage encoding failed"))
}

fn sandbox(options: &EffectiveSandboxOptions) -> Result<Value> {
    let EffectiveSandboxOptions {
        sandbox,
        no_mount_cwd,
        mounts,
        mounts_ro,
        internal_mounts,
        sandbox_image,
        sandbox_gpus,
        sandbox_shm_size,
        sandbox_session_key,
        sandbox_workdir,
        sandbox_backend,
        sandbox_cpus,
        sandbox_mem,
        sandbox_activity_key,
        explicit_sandbox_config_flags_present,
    } = options;
    let internal = internal_mounts
        .iter()
        .map(|mount| -> Result<Value> {
            let crate::sandbox::MountSpec {
                host,
                guest,
                read_only,
            } = mount;
            Ok(json!([
                absolute_path(host)?,
                absolute_path(guest)?,
                read_only
            ]))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(json!([
        sandbox,
        no_mount_cwd,
        mounts,
        mounts_ro,
        internal,
        sandbox_image,
        sandbox_gpus,
        sandbox_shm_size,
        sandbox_session_key,
        sandbox_workdir,
        sandbox_backend.as_str(),
        sandbox_cpus,
        sandbox_mem,
        sandbox_activity_key,
        explicit_sandbox_config_flags_present
    ]))
}

fn metadata(value: &ModelMetadata) -> Result<Value> {
    let ModelMetadata {
        id,
        provider,
        api,
        display_name,
        context_window,
        max_tokens,
        cost,
        cache_write_1h,
        reasoning,
        image_input,
        thinking_level_map,
        compat,
        source,
        adaptive_thinking,
        enabled_thinking,
        context_management,
        clear_thinking,
    } = value;
    let finite_rates = |rates: [f64; 4]| rates.iter().all(|value| value.is_finite());
    ensure!(
        finite_rates([cost.input, cost.output, cost.cache_read, cost.cache_write])
            && cost
                .tiers
                .as_ref()
                .is_none_or(|tiers| tiers.iter().all(|tier| finite_rates([
                    tier.input,
                    tier.output,
                    tier.cache_read,
                    tier.cache_write
                ])))
            && cache_write_1h.is_none_or(f64::is_finite)
            && compat.completions_temperature.is_none_or(f64::is_finite),
        "CREATE effective model metadata invalid"
    );
    let api = match api {
        ApiKind::OpenAiCompletions => "openai-completions",
        ApiKind::OpenAiResponses => "openai-responses",
        ApiKind::ChatGptCodexResponses => "chatgpt-codex-responses",
        ApiKind::AnthropicMessages => "anthropic-messages",
    };
    let crate::model::Compat {
        completions_thinking_format,
        completions_reasoning_field,
        completions_temperature,
        completions_include_stream_usage,
        completions_parallel_tool_calls,
        completions_token_limit,
    } = compat;
    let format = completions_thinking_format.map(|value| match value {
        CompletionsThinkingFormat::OpenAi => "openai",
        CompletionsThinkingFormat::Deepseek => "deepseek",
        CompletionsThinkingFormat::Fireworks => "fireworks",
        CompletionsThinkingFormat::Together => "together",
        CompletionsThinkingFormat::Arcee => "arcee",
    });
    let limit = completions_token_limit.map(|value| match value {
        CompletionsTokenLimit::Modern(value) => json!(["modern", value]),
        CompletionsTokenLimit::Legacy(value) => json!(["legacy", value]),
    });
    Ok(json!([
        id,
        provider.as_str(),
        api,
        display_name,
        context_window,
        max_tokens,
        cost,
        cache_write_1h,
        reasoning,
        image_input,
        thinking_level_map,
        [
            format,
            completions_reasoning_field,
            completions_temperature,
            completions_include_stream_usage,
            completions_parallel_tool_calls,
            limit
        ],
        source,
        adaptive_thinking,
        enabled_thinking,
        context_management,
        clear_thinking
    ]))
}

#[cfg(test)]
#[path = "protected_create_source_tests.rs"]
mod tests;

#[cfg(all(test, unix))]
#[path = "create_model_catalog_source_tests.rs"]
mod catalog_source_tests;
