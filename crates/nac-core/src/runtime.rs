use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use uuid::Uuid;

use crate::agent::{Agent, AgentConfig, AgentMode};
use crate::agents_md::AgentsMdBundle;
use crate::events::{AgentEvent, EventSink};
use crate::light_model::{
    resolve_light_client_with_http_policy, LightModelError, LightModelSettings,
    TrustedLightCredential,
};
use crate::mcp::{McpRegistry, McpRootPolicy, McpTransportPolicy};
use crate::model::{
    managed_backend_base_url, resolve_model_metadata, BackendKind, EffectiveModelSettings,
    ModelClient, ModelConfigurationError, ModelMetadata, ReasoningEffort,
};
use crate::paths::PathContext;
pub use crate::sandbox::session_worktree::cleanup_session_worktree;
/// Public because callers outside this crate build the connections that sessions
/// and git targets are created from.
pub use crate::sandbox::SshConnection;
use crate::sandbox::{
    browse_remote_directory, build_sandbox_spec, parse_mount_spec, session_worktree, MountSpec,
    SandboxBackendType, SandboxSession, SandboxSpec, DEFAULT_SANDBOX_IMAGE,
    DEFAULT_SANDBOX_WORKDIR,
};
pub use crate::sandbox::{
    current_activity, probe_availability, RemoteBrowseError, RemoteEntry, RemoteListing,
    SandboxActivity, SandboxAvailability,
};
use crate::sessions::{self, SessionSnapshot};
use crate::skills::{self, SkillPathVisibility, SkillRegistry};
use crate::store;
use crate::worker::{build_preloaded_skill_messages, build_worker_context_messages};
pub use crate::worker::{run_managed_worker, ManagedWorkerRunConfig};
pub use crate::worker_credentials::{
    capture_managed_native_credentials_from_environment, restrict_same_uid_inspection,
    ManagedWorkerCredentialReceiver,
};
use crate::workspace::GitTarget;

mod builders;
mod configuration;
#[cfg(unix)]
mod create_configuration_source;
#[cfg(unix)]
pub use crate::model::CreateModelCatalogSource;
#[cfg(unix)]
pub use create_configuration_source::CreateConfigurationSource;
#[cfg(unix)]
mod create_global_source;
#[cfg(unix)]
pub use create_global_source::{CreateGlobalPreparationSource, CreateGlobalSourceRoots};
#[cfg(unix)]
mod create_guidance_source;
#[cfg(unix)]
mod create_participant;
#[cfg(unix)]
mod managed_create_attempt;
#[cfg(unix)]
mod protected_create_builder;
#[cfg(unix)]
pub use managed_create_attempt::{ManagedCreateRegistry, RegisteredManagedCreate};
mod contracts;
mod initial_import_admission;
#[cfg(unix)]
mod post_import_runtime;
#[cfg(unix)]
pub use post_import_runtime::{PostImportRuntimeDenial, PostImportRuntimeHost};
mod model_resolution;
mod preparation_resources;
mod prepared_session;
mod protected_create_source;
mod protected_execution;
mod protected_execution_io;
mod protected_execution_resources;
mod remote;
mod resume;
mod sandboxing;

#[cfg(unix)]
pub use protected_create_source::{
    resolve_create_inputs_from_sources, resolve_create_inputs_with_global_source,
};

pub use protected_create_source::{
    compute_create_source_digests, project_create_target_revision, resolve_create_inputs,
    CreateCommandChoices, CreateSourceDigests, CreateSourceModel, CreateSourceTarget,
    ResolvedCreateConfiguration, ResolvedCreateInputs,
};

pub use builders::{
    build_managed_worker_config, build_run_config, build_run_config_for_project,
    build_run_config_for_project_with_behavior, prepare_run_config_for_project_with_behavior,
};
#[cfg(test)]
use configuration::NonModelNacConfig;
pub use configuration::{
    CompactionConfig, ConfiguredModelIdentity, ModelConfig, NacConfig, PermissionConfig,
    SandboxConfig, StorageConfig, WorkerConfig,
};
pub(crate) use contracts::OrchestratorSession;
pub use contracts::{
    EffectiveSandboxOptions, ManagedWorkerOptions, ModelOptions, OptionalModelOption,
    OrchestratorRunConfig, ResumeModelOptions, ResumeOptions, ResumePickerRunConfig, RunOptions,
    RunState, SandboxOptions, SshOptions, StoreOptions, WorkerDispatchOptions,
};
#[cfg(test)]
pub(crate) use initial_import_admission::tests::ModelImportFixture;
pub use initial_import_admission::{
    CompletedInitialImport, ImportedInitialCustody, InitialImportAttempt, InitialImportAuthority,
    InitialImportAuthoritySnapshot, InitialImportCancelGuard, InitialImportCancellation,
    InitialImportIoOutcome, InitialImportIoTerminal, InitialImportStartObservation,
    InitialImportWork, InitialImportWorkBinding, InitialImportWorkResult,
};
use model_resolution::{
    default_config_cwd, managed_worker_effective_model_settings, worker_command_output_limits,
    worker_thread_timeout_secs,
};
pub use model_resolution::{
    effective_model_settings, effective_orchestrator_compaction_threshold,
    parse_extra_headers_json, resolve_store_path, resolve_store_path_for_track,
};
pub use preparation_resources::PreparationResourceCustody;
pub use prepared_session::{PreparedSessionResources, PreparedSessionRunConfig};
#[cfg(all(test, unix))]
pub(crate) use protected_execution::create_owner::tests as create_owner_test_helpers;
#[cfg(unix)]
pub use protected_execution::create_owner::{
    CreateFactoryOwner, CreatePublicationCustody, NativeCreateBinding, NativeCreateConstruction,
    NativeCreateCurrentness,
};
pub use protected_execution::{
    ProtectedExecutionBoundary, ProtectedExecutionCancellation, ProtectedExecutionContext,
    ProtectedExecutionIdentity, ProtectedExecutionPermit, ProtectedExecutionStage,
};
pub use protected_execution_io::{
    CompartmentCommand, CompartmentExit, CompartmentFileIoCommand, CompartmentFuture,
    CompartmentOutput, CompartmentPipe, CompartmentProcess, CompartmentPty, CompartmentPtyProcess,
    CompartmentPtySize, CompartmentReader, CompartmentWriter, ExecutionCompartmentTransport,
};
#[cfg(feature = "test-support")]
pub use protected_execution_resources::fixtures as compartment_resource_fixtures;
pub use protected_execution_resources::{
    CompartmentResourceDeclaration, CompartmentStorageHold, ProtectedExecutionOutput,
};
pub use remote::browse_ssh_directory;
use remote::{canonical_remote_session_cwd, remote_cwd_or_home, trim_ssh_host};
pub use resume::{
    build_resume_config, build_resume_config_for_session,
    build_resume_config_for_session_attachment, build_resume_config_for_session_with_lease,
    build_resume_picker_config,
};
#[cfg(test)]
use resume::{build_resume_config_from_snapshot, normalize_snapshot_paths};
pub use sandboxing::build_sandbox_session;
use sandboxing::{build_sandbox_session_inner, validate_target_sandbox_options};
pub(crate) use sandboxing::{effective_sandbox_options, effective_workspace_dir};
#[cfg(test)]
use sandboxing::{normalize_gpu_device, workspace_dir_from_mounts};

pub(crate) fn directory_display(cwd: &Path) -> String {
    cwd.display().to_string()
}

pub(crate) fn absolute_store_path(cwd: &Path, store_path: PathBuf) -> PathBuf {
    if store_path.is_absolute() {
        store_path
    } else {
        cwd.join(store_path)
    }
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
