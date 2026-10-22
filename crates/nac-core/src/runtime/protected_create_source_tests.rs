//! Actual selected values and SQLite source revisions, not admission fixtures.
use super::*;
use crate::{
    model::{BackendKind, CostTier, ModelSource},
    model_configurations::{self, NewModelConfiguration},
    permissions::{PermissionEffect, PermissionRule},
    runtime::{sandboxing::effective_sandbox_options, NacConfig, SandboxOptions},
};
use std::{collections::BTreeMap, path::PathBuf};

fn source_project() -> crate::projects::ProjectRecord {
    crate::projects::ProjectRecord {
        project_id: "project".into(),
        name: "Presentation".into(),
        description: None,
        cwd: PathBuf::from("/lexical/workspace"),
        ssh_host: None,
        ssh_port: None,
        ssh_identity_file: None,
        default_model_config_id: Some("selected-model".into()),
        created_at: "old".into(),
        updated_at: "old".into(),
        pinned: false,
        sort_order: 0,
        presentation_version: 0,
    }
}

#[test]
fn project_revision_uses_the_closed_versioned_preimage() {
    let project = source_project();
    let bytes = br#"["native-create-project-source-v1",7,"project","/lexical/workspace",null,null,null,"selected-model"]"#;
    let expected: [u8; 32] = Sha256::digest(bytes).into();
    assert_eq!(
        project_create_target_revision(&project, 7).unwrap(),
        expected
    );
}

#[test]
fn project_source_selectors_and_actual_revision_each_change_fingerprint() {
    let original = project_create_target_revision(&source_project(), 7).unwrap();
    let changes: &[fn(&mut crate::projects::ProjectRecord)] = &[
        |p| p.project_id.push('x'),
        |p| p.cwd = PathBuf::from("/lexical/workspace/../workspace"),
        |p| p.ssh_host = Some("host".into()),
        |p| p.ssh_port = Some(2222),
        |p| p.ssh_identity_file = Some("~/.ssh/selector".into()),
        |p| p.default_model_config_id = None,
    ];
    for change in changes {
        let mut project = source_project();
        change(&mut project);
        assert_ne!(
            project_create_target_revision(&project, 7).unwrap(),
            original
        );
    }
    assert_ne!(
        project_create_target_revision(&source_project(), 8).unwrap(),
        original
    );
}

#[test]
fn project_presentation_changes_do_not_replace_actual_source_revision() {
    let original = project_create_target_revision(&source_project(), 7).unwrap();
    let mut project = source_project();
    project.name = "Renamed".into();
    project.description = Some("Description".into());
    project.created_at = "new".into();
    project.updated_at = "new".into();
    project.pinned = true;
    project.sort_order = 44;
    project.presentation_version = 88;
    assert_eq!(
        project_create_target_revision(&project, 7).unwrap(),
        original
    );
}

#[test]
fn project_source_refuses_missing_revision_and_unencodable_selectors() {
    for revision in [0, -1, i64::MIN] {
        assert!(project_create_target_revision(&source_project(), revision).is_err());
    }
    let changes: &[fn(&mut crate::projects::ProjectRecord)] = &[
        |p| p.project_id.clear(),
        |p| p.project_id = "x".repeat(257),
        |p| p.project_id.push('\0'),
        |p| p.cwd = PathBuf::from("relative/workspace"),
        |p| p.cwd = PathBuf::from("/workspace\0suffix"),
        |p| p.ssh_host = Some("host\0suffix".into()),
        |p| p.ssh_identity_file = Some("key\0suffix".into()),
        |p| p.default_model_config_id = Some("model\0suffix".into()),
    ];
    for change in changes {
        let mut project = source_project();
        change(&mut project);
        assert!(project_create_target_revision(&project, 7).is_err());
    }
}

#[cfg(unix)]
#[test]
fn project_source_refuses_non_utf8_without_opening_or_normalizing_path() {
    use std::{ffi::OsString, os::unix::ffi::OsStringExt};
    let mut project = source_project();
    project.cwd = PathBuf::from(OsString::from_vec(b"/not-opened/\xff".to_vec()));
    assert!(project_create_target_revision(&project, 7).is_err());
    project.cwd = PathBuf::from("/not-opened/../missing-source-workspace");
    assert!(project_create_target_revision(&project, 7).is_ok());
}

struct Fixture {
    record: ModelConfigurationRecord,
    revision: i64,
    model: EffectiveModelSettings,
    sandbox: EffectiveSandboxOptions,
    effort: OptionalModelOption<ReasoningEffort>,
    store: PathBuf,
    workspace: PathBuf,
    config: PathBuf,
    worker: Option<PathBuf>,
    ssh: Option<SshConnection>,
    threshold: Option<u64>,
    light: Option<LightModelSettings>,
    light_credential: Option<TrustedLightCredential>,
    timeout: u64,
    limits: CommandOutputLimits,
    rules: Vec<PermissionRule>,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join("not-opened-by-create-source-producer");
        Self {
            record: ModelConfigurationRecord {
                config_id: "selected-model".into(),
                name: "Selected".into(),
                backend: "openai-responses".into(),
                model: "source-model".into(),
                base_url: "https://model.example.test/v1".into(),
                allow_insecure_http: false,
                api_key_env: Some("MODEL_KEY_SELECTOR".into()),
                reasoning_effort: None,
                extra_headers: BTreeMap::new(),
                orchestrator_compaction_threshold: Some(4096),
                initial_prompt: None,
                light_model: None,
                created_at: "2026-01-01".into(),
                updated_at: "2026-01-01".into(),
            },
            revision: 7,
            model: EffectiveModelSettings {
                backend: BackendKind::OpenAiResponses,
                model: "source-model".into(),
                base_url: "https://model.example.test/v1".into(),
                allow_insecure_http: false,
                reasoning_effort: None,
                api_key_env: Some("MODEL_KEY_SELECTOR".into()),
                trusted_api_key_file: None,
                extra_headers: BTreeMap::new(),
                resolved: ModelMetadata::sparse(
                    BackendKind::OpenAiResponses,
                    ApiKind::OpenAiResponses,
                    "source-model",
                    ModelSource::Baseline,
                ),
            },
            sandbox: effective_sandbox_options(SandboxOptions::default(), &NacConfig::default()),
            effort: OptionalModelOption::Inherit,
            store: root.join("store.db"),
            workspace: root.join("workspace"),
            config: root.join("config"),
            worker: None,
            ssh: None,
            threshold: Some(4096),
            light: None,
            light_credential: None,
            timeout: 60,
            limits: CommandOutputLimits::default(),
            rules: Vec::new(),
        }
    }
    fn configuration(&self) -> ResolvedCreateConfiguration<'_> {
        ResolvedCreateConfiguration {
            behavior: SessionBehavior::Direct,
            model: &self.model,
            sandbox: &self.sandbox,
            store_path: &self.store,
            workspace_cwd: &self.workspace,
            config_cwd: &self.config,
            worker_executable: self.worker.as_deref(),
            ssh: self.ssh.as_ref(),
            compaction_threshold: self.threshold,
            light_model: self.light.as_ref(),
            trusted_light_credential: self.light_credential.as_ref(),
            worker_thread_timeout_secs: self.timeout,
            command_output_limits: self.limits,
            permission_rules: &self.rules,
        }
    }
    fn choices(&self) -> CreateCommandChoices<'_> {
        CreateCommandChoices {
            target: CreateSourceTarget::Project {
                id: "project",
                revision: [5; 32],
            },
            selected_model_id: &self.record.config_id,
            reasoning_effort: &self.effort,
            behavior: SessionBehavior::Direct,
            first_chat: false,
            first_chat_same_behavior: false,
        }
    }
    fn digests(&self) -> Result<CreateSourceDigests> {
        compute_create_source_digests(
            &CreateSourceModel {
                record: &self.record,
                revision: self.revision,
            },
            &self.configuration(),
            &self.choices(),
        )
    }
}

#[test]
fn selected_model_record_and_actual_source_revision_each_change_the_fingerprint() {
    let original = Fixture::new().digests().unwrap();
    let changes: &[fn(&mut Fixture)] = &[
        |f| f.record.config_id.push('x'),
        |f| f.record.name.push('x'),
        |f| f.record.backend.push('x'),
        |f| f.record.model.push('x'),
        |f| f.record.base_url.push('x'),
        |f| f.record.allow_insecure_http = true,
        |f| f.record.api_key_env = None,
        |f| f.record.reasoning_effort = Some("high".into()),
        |f| {
            f.record
                .extra_headers
                .insert("X-Trace".into(), "changed".into());
        },
        |f| f.record.orchestrator_compaction_threshold = None,
        |f| f.record.initial_prompt = Some("configured source text".into()),
        |f| f.record.light_model = Some(light()),
        |f| f.record.created_at.push('x'),
        |f| f.record.updated_at.push('x'),
        |f| f.revision += 1,
    ];
    for (index, change) in changes.iter().enumerate() {
        let mut f = Fixture::new();
        change(&mut f);
        let changed = f.digests().unwrap();
        assert_ne!(
            changed.model_revision, original.model_revision,
            "source field {index}"
        );
        assert_ne!(
            changed.command_digest, original.command_digest,
            "source field {index}"
        );
        assert_eq!(
            changed.configuration_sha256, original.configuration_sha256,
            "only the source observation changed, field {index}"
        );
    }
}

#[test]
fn model_source_versioned_preimage_matches_independent_utf8_json_vector() {
    let digest = Fixture::new().digests().unwrap().model_revision;
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    // Independently encoded Python UTF-8 compact JSON array + hashlib.sha256.
    assert_eq!(
        hex,
        "b8deb2cee6245f321bd272b43f73e749599dc6aefbdcd59bda749e5d483d59e0"
    );
}

#[test]
fn owned_resolution_uses_existing_helpers_once_and_returns_the_same_builder_values() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let f = Fixture::new();
    let options = super::super::RunOptions {
        workspace_cwd: f.workspace.clone(),
        config_cwd: Some(f.config.clone()),
        store: super::super::StoreOptions {
            store_path: Some(f.store.clone()),
        },
        model: super::super::ModelOptions {
            backend: Some(BackendKind::OpenAiResponses),
            api_model: Some("source-model".into()),
            api_base_url: Some("https://model.example.test/v1".into()),
            api_key_env: OptionalModelOption::Value("MODEL_KEY_SELECTOR".into()),
            ..Default::default()
        },
        ..Default::default()
    };
    let mut config = NacConfig::default();
    config.worker.thread_timeout_secs = Some(3600);
    config.worker.command_output_max_bytes = Some(2048);
    config.worker.command_output_session_max_bytes = Some(4096);
    config
        .permissions
        .rules
        .push(PermissionRule::new("shell", "*", PermissionEffect::Deny));
    let captured = resolve_create_inputs(options, &config, SessionBehavior::Direct).unwrap();
    let source = CreateSourceModel {
        record: &f.record,
        revision: f.revision,
    };
    let before =
        compute_create_source_digests(&source, &captured.configuration(), &f.choices()).unwrap();
    let selected_model = captured.configuration().model.clone();
    let threshold = captured.configuration().compaction_threshold;
    config.worker.thread_timeout_secs = Some(7200);
    config.permissions.rules.clear();
    assert_eq!(
        compute_create_source_digests(&source, &captured.configuration(), &f.choices()).unwrap(),
        before,
        "a later source projection must not re-resolve or retarget captured values"
    );
    assert_eq!(captured.behavior(), SessionBehavior::Direct);
    let parts = captured.into_parts();
    assert_eq!(parts.model, selected_model);
    assert_eq!(parts.compaction_threshold, threshold);
    assert_eq!(parts.worker_thread_timeout_secs, 3600);
    assert_eq!(parts.command_output_limits.per_command_bytes, 2048);
    assert_eq!(parts.command_output_limits.per_session_bytes, 4096);
    assert_eq!(parts.config.permissions.rules.len(), 1);
    assert_eq!(parts.options.workspace_cwd, f.workspace);
    assert_eq!(parts.store_path, f.store);
    assert_eq!(parts.config_cwd, f.config);
    assert!(parts.ssh.is_none());
    assert!(!parts.sandbox.sandbox);
    assert_eq!(parts.behavior, SessionBehavior::Direct);
}

#[test]
fn private_input_types_do_not_gain_debug_or_wire_serialization() {
    macro_rules! assert_not_impl {
        ($target:ty, $bound:path) => {{
            trait Ambiguous<A> {
                fn probe() {}
            }
            impl<T: ?Sized> Ambiguous<()> for T {}
            struct Marker;
            impl<T: ?Sized + $bound> Ambiguous<Marker> for T {}
            let _ = <$target as Ambiguous<_>>::probe;
        }};
    }
    assert_not_impl!(CreateSourceModel<'static>, std::fmt::Debug);
    assert_not_impl!(CreateSourceModel<'static>, serde::Serialize);
    assert_not_impl!(ResolvedCreateConfiguration<'static>, std::fmt::Debug);
    assert_not_impl!(ResolvedCreateConfiguration<'static>, serde::Serialize);
    assert_not_impl!(ResolvedCreateInputs, std::fmt::Debug);
    assert_not_impl!(ResolvedCreateInputs, serde::Serialize);
}

fn light() -> LightModelSettings {
    LightModelSettings {
        model: "light-model".into(),
        backend: Some(BackendKind::OpenAiResponses),
        base_url: Some("https://light.example.test/v1".into()),
        api_key_env: Some("LIGHT_KEY_SELECTOR".into()),
        reasoning_effort: None,
    }
}

#[test]
fn effective_configuration_mutations_change_config_and_command_without_changing_model_source() {
    let original = Fixture::new().digests().unwrap();
    let changes: &[fn(&mut Fixture)] = &[
        |f| f.model.backend = BackendKind::AnthropicMessages,
        |f| f.model.model.push('x'),
        |f| f.model.base_url.push('x'),
        |f| f.model.allow_insecure_http = true,
        |f| f.model.reasoning_effort = Some(ReasoningEffort::High),
        |f| f.model.api_key_env = None,
        |f| f.model.trusted_api_key_file = Some(f.config.join("credential-selector")),
        |f| {
            f.model
                .extra_headers
                .insert("Authorization".into(), "synthetic-inline-value-A".into());
        },
        |f| f.model.resolved.context_window += 1,
        |f| f.model.resolved.max_tokens += 1,
        |f| f.model.resolved.cost.input = 2.0,
        |f| {
            f.model.resolved.cost.tiers = Some(vec![CostTier {
                input_tokens_above: 1024,
                input: 2.0,
                ..Default::default()
            }])
        },
        |f| f.model.resolved.compat.completions_temperature = Some(0.5),
        |f| f.model.resolved.adaptive_thinking = true,
        |f| f.sandbox.sandbox_cpus += 1,
        |f| f.sandbox.sandbox_mem += 1,
        |f| f.sandbox.mounts.push("/host:/guest".into()),
        |f| f.store.push("different"),
        |f| f.workspace.push("different"),
        |f| f.config.push("different"),
        |f| f.worker = Some(f.config.join("worker-selector")),
        |f| f.ssh = Some(SshConnection::new("selected-host")),
        |f| f.threshold = None,
        |f| f.light = Some(light()),
        |f| {
            f.light_credential = Some(TrustedLightCredential {
                backend: BackendKind::OpenAiResponses,
                base_url: "https://light.example.test/v1".into(),
                path: f.config.join("light-credential-selector"),
            })
        },
        |f| f.timeout += 1,
        |f| f.limits.per_command_bytes -= 1,
        |f| f.limits.per_session_bytes += 1,
        |f| {
            f.rules
                .push(PermissionRule::new("shell", "*", PermissionEffect::Deny))
        },
    ];
    for (index, change) in changes.iter().enumerate() {
        let mut f = Fixture::new();
        change(&mut f);
        let changed = f.digests().unwrap();
        assert_eq!(
            changed.model_revision, original.model_revision,
            "configuration field {index}"
        );
        assert_ne!(
            changed.configuration_sha256, original.configuration_sha256,
            "configuration field {index}"
        );
        assert_ne!(
            changed.command_digest, original.command_digest,
            "configuration field {index}"
        );
    }
}

#[test]
fn command_choices_keep_inherit_clear_explicit_and_first_chat_semantics_distinct() {
    let f = Fixture::new();
    let original = f.digests().unwrap();
    let mut seen = std::collections::HashSet::new();
    for effort in [
        OptionalModelOption::Inherit,
        OptionalModelOption::Clear,
        OptionalModelOption::Value(ReasoningEffort::High),
    ] {
        for behavior in [
            SessionBehavior::Direct,
            SessionBehavior::Orchestrator,
            SessionBehavior::DirectWithOrchestrator,
        ] {
            for (first_chat, first_chat_same_behavior) in
                [(false, false), (true, false), (true, true)]
            {
                let mut choices = f.choices();
                choices.reasoning_effort = &effort;
                choices.behavior = behavior;
                choices.first_chat = first_chat;
                choices.first_chat_same_behavior = first_chat_same_behavior;
                let mut configuration = f.configuration();
                configuration.behavior = behavior;
                let changed = compute_create_source_digests(
                    &CreateSourceModel {
                        record: &f.record,
                        revision: f.revision,
                    },
                    &configuration,
                    &choices,
                )
                .unwrap();
                assert_eq!(changed.model_revision, original.model_revision);
                assert_eq!(changed.configuration_sha256, original.configuration_sha256);
                assert!(seen.insert(changed.command_digest));
            }
        }
    }
    assert_eq!(seen.len(), 27);
}

#[test]
fn target_kind_identity_and_revision_are_bound_without_local_authority() {
    let f = Fixture::new();
    let original = f.digests().unwrap();
    for target in [
        CreateSourceTarget::WorkingLocation {
            id: "project",
            revision: [5; 32],
        },
        CreateSourceTarget::Project {
            id: "other",
            revision: [5; 32],
        },
        CreateSourceTarget::Project {
            id: "project",
            revision: [6; 32],
        },
    ] {
        let mut choices = f.choices();
        choices.target = target;
        let changed = compute_create_source_digests(
            &CreateSourceModel {
                record: &f.record,
                revision: f.revision,
            },
            &f.configuration(),
            &choices,
        )
        .unwrap();
        assert_eq!(changed.configuration_sha256, original.configuration_sha256);
        assert_ne!(changed.command_digest, original.command_digest);
    }
}

#[test]
fn unsupported_source_choices_paths_and_nonfinite_values_refuse_with_content_free_errors() {
    let changes: &[fn(&mut Fixture)] = &[
        |f| f.revision = 0,
        |f| f.revision = -1,
        |f| f.record.config_id.clear(),
        |f| f.store = PathBuf::from("relative-private-canary"),
        |f| f.workspace = PathBuf::from("relative-private-canary"),
        |f| f.config = PathBuf::from("relative-private-canary"),
        |f| f.worker = Some(PathBuf::from("relative-private-canary")),
        |f| f.model.trusted_api_key_file = Some(PathBuf::from("relative-private-canary")),
        |f| f.model.resolved.cost.input = f64::NAN,
        |f| f.model.resolved.cache_write_1h = Some(f64::INFINITY),
        |f| f.model.resolved.compat.completions_temperature = Some(f64::NEG_INFINITY),
        |f| f.timeout = 0,
        |f| f.limits.per_command_bytes = 0,
    ];
    for change in changes {
        let mut f = Fixture::new();
        change(&mut f);
        let error = f.digests().unwrap_err().to_string();
        assert!(!error.contains("private-canary"));
    }
    let f = Fixture::new();
    let source = CreateSourceModel {
        record: &f.record,
        revision: f.revision,
    };
    let mut choices = f.choices();
    choices.behavior = SessionBehavior::Orchestrator;
    assert!(compute_create_source_digests(&source, &f.configuration(), &choices).is_err());
    choices = f.choices();
    choices.selected_model_id = "other-model";
    assert!(compute_create_source_digests(&source, &f.configuration(), &choices).is_err());
    choices = f.choices();
    choices.first_chat_same_behavior = true;
    assert!(compute_create_source_digests(&source, &f.configuration(), &choices).is_err());
    choices = f.choices();
    choices.first_chat = true;
    choices.target = CreateSourceTarget::WorkingLocation {
        id: "location",
        revision: [5; 32],
    };
    assert!(compute_create_source_digests(&source, &f.configuration(), &choices).is_err());
}

#[test]
fn exact_private_headers_and_lexical_paths_are_not_sanitized_or_normalized_away() {
    let mut f = Fixture::new();
    f.model
        .extra_headers
        .insert("Authorization".into(), "synthetic-inline-value-A".into());
    let first = f.digests().unwrap();
    f.model
        .extra_headers
        .insert("Authorization".into(), "synthetic-inline-value-B".into());
    let second = f.digests().unwrap();
    assert_ne!(first.configuration_sha256, second.configuration_sha256);
    assert!(!format!("{second:?}").contains("synthetic-inline-value"));
    f.workspace.push(".");
    assert_ne!(
        second.configuration_sha256,
        f.digests().unwrap().configuration_sha256
    );
}

#[test]
fn actual_sqlite_override_update_changes_its_source_fingerprint_without_poisoning_default() {
    let root = std::env::temp_dir().join(format!("create-source-record-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let store = root.join("store.db");
    crate::store::initialize(&store).unwrap();
    let spec = |name: &str| NewModelConfiguration {
        name: name.into(),
        backend: "openai-responses".into(),
        model: "source-model".into(),
        base_url: "https://model.example.test/v1".into(),
        allow_insecure_http: false,
        api_key_env: Some("MODEL_KEY_SELECTOR".into()),
        reasoning_effort: None,
        extra_headers: BTreeMap::new(),
        orchestrator_compaction_threshold: Some(4096),
        initial_prompt: None,
        light_model: None,
    };
    model_configurations::insert_model_configuration(&store, "default", spec("Default")).unwrap();
    model_configurations::insert_model_configuration(&store, "override", spec("Override")).unwrap();
    let observe = |id: &str| {
        let record = model_configurations::load_model_configuration(&store, id).unwrap();
        let c = crate::store::open_connection(&store).unwrap();
        let revision: i64 = c.query_row("SELECT revision FROM native_source_revisions WHERE kind='model' AND resource_id=?1", [id], |row| row.get(0)).unwrap();
        let mut f = Fixture::new();
        f.record = record;
        f.revision = revision;
        f.digests().unwrap()
    };
    let original_default = observe("default");
    let original_override = observe("override");
    model_configurations::update_model_configuration(&store, "override", spec("Updated override"))
        .unwrap();
    assert_ne!(
        observe("override").model_revision,
        original_override.model_revision
    );
    assert_eq!(observe("default"), original_default);
    model_configurations::delete_model_configuration(&store, "override").unwrap();
    assert!(
        model_configurations::load_model_configuration(&store, "override").is_err(),
        "missing actual source cannot supply a new fingerprint; no default substitution"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn create_clear_selector_never_adopts_ambient_credential_but_ordinary_resolution_stays_legacy() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    struct Restore(Option<std::ffi::OsString>);
    impl Drop for Restore {
        fn drop(&mut self) {
            // SAFETY: this private guard drops before the held TEST_ENV_LOCK.
            unsafe {
                match self.0.take() {
                    Some(value) => std::env::set_var("ARCEE_API_KEY", value),
                    None => std::env::remove_var("ARCEE_API_KEY"),
                }
            }
        }
    }
    let _restore = Restore(std::env::var_os("ARCEE_API_KEY"));
    let mut f = Fixture::new();
    f.record.backend = "arcee-api".into();
    f.record.model = "trinity-large-thinking".into();
    f.record.base_url = "https://api.arcee.ai/api/v1".into();
    f.record.api_key_env = None;
    let mut options = crate::runtime::RunOptions {
        workspace_cwd: f.workspace.clone(),
        config_cwd: Some(f.config.clone()),
        store: crate::runtime::StoreOptions {
            store_path: Some(f.store.clone()),
        },
        model: crate::runtime::ModelOptions {
            backend: Some(BackendKind::ArceeApi),
            api_model: Some(f.record.model.clone()),
            api_base_url: Some(f.record.base_url.clone()),
            api_key_env: OptionalModelOption::Clear,
            ..Default::default()
        },
        orchestrator_compaction_threshold: Some(4096),
        ..Default::default()
    };
    let config = NacConfig::default();
    // SAFETY: the process environment is serialized by TEST_ENV_LOCK.
    unsafe {
        std::env::set_var("ARCEE_API_KEY", "synthetic-create-selector-canary");
    }
    let ordinary = crate::runtime::effective_model_settings(&options.model, &config).unwrap();
    assert_eq!(ordinary.api_key_env.as_deref(), Some("ARCEE_API_KEY"));
    let selected =
        resolve_create_inputs(options.clone(), &config, SessionBehavior::Direct).unwrap();
    assert!(selected.configuration().model.api_key_env.is_none());
    assert!(selected
        .configuration()
        .model
        .trusted_api_key_file
        .is_none());
    let digest = |resolved: &ResolvedCreateInputs| {
        compute_create_source_digests(
            &CreateSourceModel {
                record: &f.record,
                revision: f.revision,
            },
            &resolved.configuration(),
            &f.choices(),
        )
        .unwrap()
    };
    let present = digest(&selected);
    // SAFETY: the process environment remains serialized by TEST_ENV_LOCK.
    unsafe {
        std::env::remove_var("ARCEE_API_KEY");
    }
    let absent = resolve_create_inputs(options.clone(), &config, SessionBehavior::Direct).unwrap();
    assert_eq!(
        present.configuration_sha256,
        digest(&absent).configuration_sha256
    );
    assert_eq!(present.command_digest, digest(&absent).command_digest);
    // Inheritance and explicit selector DATA retain their existing meanings.
    // Neither branch constructs a client or reads a private key file.
    // SAFETY: the process environment remains serialized by TEST_ENV_LOCK.
    unsafe {
        std::env::set_var("ARCEE_API_KEY", "other-synthetic-selector-canary");
    }
    options.model.api_key_env = OptionalModelOption::Inherit;
    assert_eq!(
        resolve_create_inputs(options.clone(), &config, SessionBehavior::Direct)
            .unwrap()
            .configuration()
            .model
            .api_key_env
            .as_deref(),
        Some("ARCEE_API_KEY")
    );
    options.model.api_key_env = OptionalModelOption::Value("OPERATOR_SELECTOR".into());
    assert_eq!(
        resolve_create_inputs(options, &config, SessionBehavior::Direct)
            .unwrap()
            .configuration()
            .model
            .api_key_env
            .as_deref(),
        Some("OPERATOR_SELECTOR")
    );
}
