//! Concrete local CREATE participant, never a serialized AFM primary owner.
//! Only the real enrolled exchange and original post-import host enter here.
use super::*;
use crate::store::native_source_reservation::{NativeSourceBinding, SourceKind, SourceVersion};
use anyhow::{ensure, Result};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

#[path = "create_participant_command.rs"]
mod command;
use command::Command;

/// The original serving task retains this allocation before calling try_factory.
/// There is no Clone/serde/public constructor or caller-implemented authority.
pub(in crate::runtime) struct CreateParticipant {
    exchange: nac_runtime_auth::CreateExchange,
    serving: nac_runtime_auth::ServingCurrentness,
    host: Arc<PostImportRuntimeHost>,
    options: RunOptions,
    preparation: Mutex<Option<crate::session_service::ProtectedPreparationInput>>,
    attempted: AtomicBool,
    admission_issued: AtomicBool,
    factory: OnceLock<std::sync::Weak<CreateFactoryOwner>>,
    denied: AtomicBool,
    verified: OnceLock<Verified>,
}
struct Verified {
    command: Command,
    global: Arc<CreateGlobalPreparationSource>,
    configuration: CreateConfigurationSource,
    catalog: CreateModelCatalogSource,
    capacity: Arc<protected_execution_resources::capacity_source::RetainedCapacityInput>,
    policy: Arc<nac_capacity_policy::PolicySource>,
    source: NativeSourceBinding,
    resolved: Mutex<Option<ResolvedCreateInputs>>,
    backend: Arc<crate::sandbox::ExecutionBackend>,
    identity: ProtectedExecutionIdentity,
    runtime_cutoff: std::time::Instant,
}
pub(in crate::runtime) struct AdmissionInputs {
    pub binding: NativeSourceBinding,
    pub capacity_source: Arc<nac_capacity_policy::PolicySource>,
    pub claim_sequence: u64,
    pub canonical_intent: Box<[u8]>,
    pub intent_sha256: [u8; 32],
    pub configuration_sha256: [u8; 32],
    pub backend: Arc<crate::sandbox::ExecutionBackend>,
    pub identity: ProtectedExecutionIdentity,
    pub create_cutoff: std::time::Instant,
    pub runtime_cutoff: std::time::Instant,
}
impl CreateParticipant {
    /// Resource custody only, before fallible checks or source/preparation work.
    /// Native's options are comparison DATA. Actual rows/sources are loaded and
    /// independently bound below; a resource adapter supplies no authority.
    pub(in crate::runtime) fn retain(
        exchange: nac_runtime_auth::CreateExchange,
        host: Arc<PostImportRuntimeHost>,
        options: RunOptions,
        preparation: crate::session_service::ProtectedPreparationInput,
    ) -> Arc<Self> {
        Arc::new(Self {
            serving: exchange.serving_currentness(),
            exchange,
            host,
            options,
            preparation: Mutex::new(Some(preparation)),
            attempted: AtomicBool::new(false),
            admission_issued: AtomicBool::new(false),
            factory: OnceLock::new(),
            denied: AtomicBool::new(false),
            verified: OnceLock::new(),
        })
    }
    fn checked(&self) -> Result<&Verified> {
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "CREATE participant denied"
        );
        self.verified
            .get()
            .ok_or_else(|| anyhow::anyhow!("CREATE participant not verified"))
    }
    /// This runs off the reactor, outside SQLite/credential locks. The actual
    /// same serving owner keeps this participant on every error/cancellation.
    pub(in crate::runtime) fn try_factory(self: &Arc<Self>) -> Result<Arc<CreateFactoryOwner>> {
        let result = (|| {
            ensure!(
                !self.attempted.swap(true, Ordering::AcqRel),
                "CREATE participant already consumed"
            );
            let verified = self.verify_originals()?;
            self.verified
                .set(verified)
                .map_err(|_| anyhow::anyhow!("CREATE participant already bound"))?;
            self.check_preparation_current()?;
            let verified = self.checked()?;
            let admission =
                protected_execution::create_owner::LocalCreateAdmission::from_participant(
                    Arc::clone(self),
                )?;
            let resources = self
                .preparation
                .lock()
                .map_err(|_| anyhow::anyhow!("CREATE resources unavailable"))?
                .take()
                .ok_or_else(|| anyhow::anyhow!("CREATE resources already moved"))?;
            // retain is infallible. It moves every original allocation into
            // the factory before the next fallible/reservation effect.
            let factory = CreateFactoryOwner::retain(
                admission,
                verified.source.clone(),
                self.options
                    .store
                    .store_path
                    .clone()
                    .ok_or_else(|| anyhow::anyhow!("CREATE store absent"))?,
                resources,
                Arc::clone(&verified.capacity),
            );
            self.factory
                .set(Arc::downgrade(&factory))
                .map_err(|_| anyhow::anyhow!("CREATE factory already associated"))?;
            Ok(factory)
        })();
        if result.is_err() {
            self.deny();
        }
        result
    }
    fn verify_originals(&self) -> Result<Verified> {
        self.exchange.check_current()?;
        self.host.check_current()?;
        let command = Command::from_exchange(&self.exchange)?;
        let super::post_import_runtime::CreateHostMaterial {
            key,
            completion,
            roots,
            original_store,
        } = self.host.create_material()?;
        completion.check_custody_association(key)?;
        let key_binding = key.binding();
        let capacity = self.host.create_capacity()?;
        let policy = capacity.source_view()?;
        let config = policy.configuration()?;
        // Read actual policy/key owners. No Dev2/Dev3 identity, namespace,
        // profile, generation, release or schema default is synthesized here.
        ensure!(
            command.environment == config.environment
                && command.provider == key_binding.clerk_instance_id
                && command.organization == key_binding.organization_id
                && command.host == key_binding.managed_host_id
                && command.incarnation == key_binding.host_incarnation_id
                && command.owner_epoch == key_binding.owner_epoch
                && command.key_generation == key_binding.key_generation
                && command.host == config.scope.managed_host_id
                && command.incarnation == config.scope.host_incarnation_id
                && command.release == config.scope.release_id
                && u64::try_from(command.schema)? == config.scope.supported_schema_version,
            "CREATE original host/policy binding differs"
        );
        ensure!(
            self.options.store.store_path.as_deref() == Some(original_store)
                && command.target_kind == "project"
                && !command.first_chat
                && !command.first_chat_same_behavior,
            "CREATE original store/fresh registered target unavailable"
        );
        let project = crate::projects::load_project_source(original_store, &command.target)?;
        let selected = command
            .selected_model
            .as_deref()
            .or(project.record.default_model_config_id.as_deref())
            .ok_or_else(|| anyhow::anyhow!("CREATE selected model unavailable"))?;
        ensure!(
            selected == command.model,
            "CREATE selected model source differs"
        );
        let model =
            crate::model_configurations::load_model_configuration_source(original_store, selected)?;
        let revision = project_create_target_revision(&project.record, project.revision)?;
        ensure!(
            revision == command.target_revision
                && project.record.cwd == self.options.workspace_cwd
                && project.record.ssh_host.is_none()
                && self.options.ssh.host().is_none(),
            "CREATE original local target differs"
        );
        let cutoff = self.exchange.original_cutoff();
        let global = Arc::new(roots.for_preparation(cutoff)?);
        let configuration = CreateConfigurationSource::capture_from_global_source(&global)?;
        let (_, home) = roots.original_nac_home_directory()?;
        let catalog = CreateModelCatalogSource::capture(home, cutoff)?;
        let resolved = resolve_create_inputs_with_global_source(
            self.options.clone(),
            &configuration,
            &catalog,
            Arc::clone(&global),
            command.behavior,
        )?;
        let effective = resolved.configuration();
        // The existing private protected Agent supports this Local identity.
        // Other selected backends refuse; they never fall back to Local.
        ensure!(
            !effective.sandbox.sandbox
                && effective.ssh.is_none()
                && effective.store_path == original_store
                && effective.workspace_cwd == project.record.cwd,
            "CREATE selected protected backend unavailable"
        );
        let observed = compute_create_source_digests(
            &CreateSourceModel {
                record: &model.record,
                revision: model.revision,
            },
            &effective,
            &CreateCommandChoices {
                target: CreateSourceTarget::Project {
                    id: &command.target,
                    revision,
                },
                selected_model_id: selected,
                reasoning_effort: &command.effort,
                behavior: command.behavior,
                first_chat: command.first_chat,
                first_chat_same_behavior: command.first_chat_same_behavior,
            },
        )?;
        ensure!(
            observed.model_revision == command.model_revision
                && observed.configuration_sha256 == command.configuration
                && observed.command_digest == command.command_digest,
            "CREATE actual source/configuration fingerprint differs"
        );
        let generation = self.host.next_create_generation()?;
        let (_, runtime, _) = self.host.startup_incarnations();
        let source = NativeSourceBinding {
            operation_id: command.operation,
            // Native-local reservation identity; never AFM's canonical13/14.
            source_id: uuid::Uuid::new_v4(),
            source_generation: i64::try_from(generation)?,
            canonical_effect_sha256: command.intent,
            creation_snapshot_sha256: None,
            session_id: command.session.to_string(),
            project_id: Some(command.target.clone()),
            sources: vec![
                SourceVersion {
                    kind: SourceKind::Project,
                    resource_id: command.target.clone(),
                    revision: project.revision,
                },
                SourceVersion {
                    kind: SourceKind::Model,
                    resource_id: selected.to_owned(),
                    revision: model.revision,
                },
                SourceVersion {
                    kind: SourceKind::Session,
                    resource_id: command.session.to_string(),
                    revision: 0,
                },
            ],
        };
        let identity = ProtectedExecutionIdentity {
            runtime_id: runtime,
            runtime_generation: 1,
            execution_owner_id: uuid::Uuid::new_v4(),
            process_generation: generation,
            trusted_key_owner_id: uuid::Uuid::parse_str(&key_binding.local_key_id)?,
            key_generation: key_binding.key_generation,
        };
        // These are original local allocation fences, not kernel identity or
        // isolation evidence. Native's actual child+peer must still join later.
        let backend = Arc::new(crate::sandbox::ExecutionBackend::Local {
            workspace_cwd: project.record.cwd,
        });
        let runtime_cutoff = policy.cutoff(self.host.original_runtime_deadline()?);
        self.exchange.check_current()?;
        self.host.check_current()?;
        Ok(Verified {
            command,
            global,
            configuration,
            catalog,
            capacity,
            policy,
            source,
            resolved: Mutex::new(Some(resolved)),
            backend,
            identity,
            runtime_cutoff,
        })
    }
    pub(in crate::runtime) fn check_runtime_denial(&self) -> Result<()> {
        let verified = self.checked()?;
        self.host.check_denial()?;
        self.serving.check_current()?;
        verified.policy.check_denial()?;
        ensure!(
            std::time::Instant::now()
                < verified
                    .runtime_cutoff
                    .min(self.host.original_runtime_deadline()?),
            "CREATE original runtime scope ended"
        );
        Ok(())
    }
    pub(in crate::runtime) fn check_preparation_current(&self) -> Result<()> {
        let verified = self.checked()?;
        self.check_runtime_denial()?;
        self.exchange.check_current()?;
        self.host.check_current()?;
        verified.global.check_current()?;
        verified.configuration.check_current()?;
        verified.catalog.check_current()?;
        verified.policy.check_current()?;
        ensure!(
            std::time::Instant::now() < self.exchange.original_cutoff(),
            "CREATE original cutoff ended"
        );
        Ok(())
    }
    /// Compare a fresh opaque cleanup exchange with this original enrollment.
    /// CREATE expiry/retirement is historical here and is never reopened.
    pub(in crate::runtime) fn check_ack_exchange(
        &self,
        ack: &nac_runtime_auth::CreateAckExchange,
    ) -> Result<()> {
        ack.check_current()?;
        let original = self.exchange.issuer();
        let current = ack.issuer();
        // Only historical association is needed. A denied/expired runtime
        // must still permit cleanup of its already-published original source.
        let operation = self
            .verified
            .get()
            .ok_or_else(|| anyhow::anyhow!("original CREATE verification absent"))?
            .command
            .operation;
        ensure!(
            original.client_leaf_sha256 == current.client_leaf_sha256
                && original.client_ca_sha256 == current.client_ca_sha256
                && original.serving_leaf_sha256 == current.serving_leaf_sha256
                && original.serving_incarnation == current.serving_incarnation
                && original.connection_incarnation != current.connection_incarnation
                && ack.request_id() == operation,
            "ACK original enrollment or operation differs"
        );
        Ok(())
    }
    pub(in crate::runtime) fn deny(&self) {
        self.denied.store(true, Ordering::Release);
        self.exchange.deny();
        // Operation denial is not shared host-key revocation or cleanup.
    }
    pub(in crate::runtime) fn admission_parts(&self) -> Result<AdmissionInputs> {
        self.check_preparation_current()?;
        ensure!(
            !self.admission_issued.swap(true, Ordering::AcqRel),
            "CREATE admission already issued"
        );
        let v = self.checked()?;
        Ok(AdmissionInputs {
            binding: v.source.clone(),
            capacity_source: Arc::clone(&v.policy),
            claim_sequence: v.command.claim,
            canonical_intent: v.command.canonical.clone(),
            intent_sha256: v.command.intent,
            configuration_sha256: v.command.configuration,
            backend: Arc::clone(&v.backend),
            identity: v.identity,
            create_cutoff: self.exchange.original_cutoff(),
            runtime_cutoff: v.runtime_cutoff,
        })
    }
    pub(in crate::runtime) fn check_custody(
        &self,
        custody: &CreatePublicationCustody,
    ) -> Result<()> {
        self.check_preparation_current()?;
        let factory = self
            .factory
            .get()
            .and_then(std::sync::Weak::upgrade)
            .ok_or_else(|| anyhow::anyhow!("CREATE original factory absent"))?;
        ensure!(
            custody.belongs_to(&factory),
            "CREATE original custody differs"
        );
        Ok(())
    }
    pub(in crate::runtime) fn check_guidance_context(
        &self,
        context: &Arc<ProtectedExecutionContext>,
    ) -> Result<()> {
        self.check_preparation_current()?;
        let verified = self.checked()?;
        let factory = self
            .factory
            .get()
            .and_then(std::sync::Weak::upgrade)
            .ok_or_else(|| anyhow::anyhow!("CREATE original factory absent"))?;
        let policy = factory.policy_source()?;
        ensure!(
            Arc::ptr_eq(&policy, &verified.policy),
            "CREATE original policy differs"
        );
        ensure!(
            context.identity() == verified.identity
                && Arc::ptr_eq(context.selected_backend(), &verified.backend),
            "CREATE original guidance context differs"
        );
        context.check_stage(ProtectedExecutionStage::Prepare)
    }
    pub(in crate::runtime) fn guidance_material(
        &self,
    ) -> Result<(
        Arc<CreateGlobalPreparationSource>,
        String,
        std::path::PathBuf,
    )> {
        self.check_preparation_current()?;
        let verified = self.checked()?;
        Ok((
            Arc::clone(&verified.global),
            verified
                .configuration
                .captured_preparation_text()?
                .to_owned(),
            self.options.workspace_cwd.clone(),
        ))
    }
    pub(in crate::runtime) fn deny_runtime(&self) {
        self.deny();
    }
    pub(in crate::runtime) fn model_owners(
        &self,
    ) -> Result<(
        Arc<crate::model::InitialHostKeyCustody>,
        Arc<CompletedInitialImport>,
    )> {
        self.check_preparation_current()?;
        let super::post_import_runtime::CreateHostMaterial {
            key, completion, ..
        } = self.host.create_material()?;
        Ok((Arc::clone(key), Arc::clone(completion)))
    }
    pub(in crate::runtime) fn original_store(&self) -> Result<std::path::PathBuf> {
        self.check_preparation_current()?;
        Ok(self.host.create_material()?.original_store.to_owned())
    }
    /// One-way move of the SAME resolution, never a fresh ordinary resolution.
    pub(in crate::runtime) fn take_resolved(&self) -> Result<ResolvedCreateInputs> {
        self.check_preparation_current()?;
        self.checked()?
            .resolved
            .lock()
            .map_err(|_| anyhow::anyhow!("CREATE inputs unavailable"))?
            .take()
            .ok_or_else(|| anyhow::anyhow!("CREATE resolved inputs already consumed"))
    }
}
impl Drop for CreateParticipant {
    fn drop(&mut self) {
        self.deny();
    }
}
