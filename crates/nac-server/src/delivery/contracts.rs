use std::{collections::BTreeMap, path::PathBuf};

use nac_core::{
    events::{SessionEventBoundary, SessionEventEnvelope, SessionReplayGap},
    light_model::LightModelSettings,
    model::{BackendKind, ProviderModel, ReasoningEffort},
    permissions::{PermissionReply, PermissionRequest},
    session_service::{ActiveRunSnapshot, MessagesPageSnapshot, SessionFrontendSnapshot},
    sessions,
    store::{GoalStatus, InboxDelivery, PermissionGrantRecord, SessionInboxRecord},
    types::Message,
    view::{self, SessionSummarySnapshot},
};
use serde::{Deserialize, Serialize};

use crate::application;

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ApiErrorBody {
    pub error: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct StoreInfo {
    #[schema(value_type = String)]
    pub root_cwd: PathBuf,
    #[schema(value_type = String)]
    pub store_path: PathBuf,
    #[schema(value_type = String)]
    pub worker_executable: PathBuf,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct LaunchModelDefaultsRequest {
    #[schema(value_type = Option<String>)]
    pub cwd: Option<PathBuf>,
    /// OpenSSH target for remote sessions; remote paths never select local config.
    #[serde(default, alias = "host_id")]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
}

/// Where to look on an SSH host, for the remote half of the path picker.
///
/// The connection is described in the request rather than taken from a session,
/// because this is what the launch form asks *before* there is a session.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct SshBrowseRequest {
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
    /// Absent or empty opens on the login home, which is where a fresh remote
    /// session would start anyway.
    #[serde(default)]
    pub path: Option<String>,
    /// Dot-prefixed names are hidden unless explicitly requested, as locally.
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct LaunchModelDefaults {
    /// Configured model id; lets the launch dialog render the inherited
    /// "from config" selection resolved against the model catalog (the
    /// frontend resolves the provider from the model id, exactly like
    /// session creation does).
    pub configured_model: Option<String>,
    /// Configured reasoning effort, if any.
    pub configured_reasoning_effort: Option<ReasoningEffort>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ManagedSessionSummary {
    pub summary: SessionSummarySnapshot,
    /// Delegated sessions remain addressable by id, but clients use lineage
    /// to keep them out of primary chat navigation and enforce ownership UI.
    pub lineage: Option<SessionLineageSnapshot>,
    pub active: bool,
    pub active_run: Option<ActiveRunSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_diff: Option<view::WorkspaceDiffTotals>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum RequestField<T> {
    #[default]
    Omitted,
    Null,
    Value(T),
}

impl<'de, T> Deserialize<'de> for RequestField<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Option::<T>::deserialize(deserializer).map(|value| match value {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

pub(crate) fn request_field_patch<T>(field: RequestField<T>) -> Option<Option<T>> {
    match field {
        RequestField::Omitted => None,
        RequestField::Null => Some(None),
        RequestField::Value(value) => Some(Some(value)),
    }
}

fn application_field<T>(field: RequestField<T>) -> application::Field<T> {
    match field {
        RequestField::Omitted => application::Field::Unchanged,
        RequestField::Null => application::Field::Clear,
        RequestField::Value(value) => application::Field::Set(value),
    }
}

impl<T> utoipa::__dev::ComposeSchema for RequestField<T>
where
    T: utoipa::__dev::ComposeSchema,
{
    fn compose(
        schemas: Vec<utoipa::openapi::RefOr<utoipa::openapi::schema::Schema>>,
    ) -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        let value = schemas
            .into_iter()
            .next()
            .unwrap_or_else(|| T::compose(Vec::new()));
        utoipa::openapi::schema::OneOfBuilder::new()
            .item(
                utoipa::openapi::schema::ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::Null),
            )
            .item(value)
            .into()
    }
}

impl<T> utoipa::ToSchema for RequestField<T>
where
    T: utoipa::ToSchema + utoipa::__dev::ComposeSchema,
{
    fn name() -> std::borrow::Cow<'static, str> {
        format!("RequestField_{}", T::name()).into()
    }

    fn schemas(
        schemas: &mut Vec<(
            String,
            utoipa::openapi::RefOr<utoipa::openapi::schema::Schema>,
        )>,
    ) {
        T::schemas(schemas);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadersRequest(pub BTreeMap<String, String>);

impl<'de> Deserialize<'de> for HeadersRequest {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Representation {
            Object(BTreeMap<String, String>),
            LegacyJson(String),
        }

        match Representation::deserialize(deserializer)? {
            Representation::Object(headers) => Ok(Self(headers)),
            Representation::LegacyJson(json) => {
                if json.trim().is_empty() {
                    return Err(serde::de::Error::custom(
                        "extra_headers compatibility string must not be blank",
                    ));
                }
                serde_json::from_str::<BTreeMap<String, String>>(&json)
                    .map(Self)
                    .map_err(|error| {
                        serde::de::Error::custom(format!(
                            "extra_headers compatibility string must contain a JSON object with string values: {error}"
                        ))
                    })
            }
        }
    }
}

impl utoipa::__dev::ComposeSchema for HeadersRequest {
    fn compose(
        _: Vec<utoipa::openapi::RefOr<utoipa::openapi::schema::Schema>>,
    ) -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{ObjectBuilder, OneOfBuilder};

        OneOfBuilder::new()
            .item(
                ObjectBuilder::new()
                    .additional_properties(Some(<String as utoipa::PartialSchema>::schema())),
            )
            .item(
                ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::String)
                    .pattern(Some(r".*\S.*"))
                    .description(Some(
                        "Compatibility form: a nonblank string containing a JSON object with string values.",
                    )),
            )
            .description(Some(
                "Prefer an object of header names to values. The JSON-encoded string form is accepted for compatibility.",
            ))
            .into()
    }
}

impl utoipa::ToSchema for HeadersRequest {
    fn name() -> std::borrow::Cow<'static, str> {
        "HeadersRequest".into()
    }
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct CreateSessionRequest {
    /// Immutable execution behavior. Omission preserves the established
    /// orchestrator default.
    #[serde(default)]
    pub behavior: sessions::SessionBehavior,
    /// Marks the required first chat for an empty project. The server
    /// serializes this admission and returns the already-created primary chat
    /// to concurrent callers instead of creating a duplicate. Ordinary New
    /// Chat requests leave this false.
    #[serde(default)]
    pub first_chat: bool,
    /// Explicit project selection. Projects are never inferred from `cwd`.
    pub project_id: Option<String>,
    #[schema(value_type = Option<String>)]
    pub cwd: Option<PathBuf>,
    #[serde(default)]
    pub model: RequestField<String>,
    #[serde(default)]
    pub base_url: RequestField<String>,
    #[serde(default)]
    pub backend: RequestField<String>,
    #[serde(default)]
    pub reasoning_effort: RequestField<String>,
    #[serde(default)]
    pub api_key_env: RequestField<String>,
    /// Prefer a JSON object. A JSON-encoded object string remains accepted for compatibility.
    #[serde(default)]
    pub extra_headers: RequestField<HeadersRequest>,
    /// Omitted defaults to 70% of the model's context window; null or zero disables.
    #[serde(default)]
    pub orchestrator_compaction_threshold: RequestField<u64>,
    /// Light worker model; omitted or null launches single-model.
    #[serde(default)]
    pub light_model: RequestField<LightModelSettings>,
    /// OpenSSH target for remote sessions; `cwd` is remote and defaults to `~`.
    #[serde(default, alias = "host_id")]
    pub ssh_host: Option<String>,
    /// Port and private key for the ssh target. Both are optional: omitted
    /// leaves the choice to ssh, which is what a host configured in
    /// `~/.ssh/config` wants. Supplying them is what lets a session reach a box
    /// nac has no config for at all.
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
    #[serde(default)]
    pub sandbox: SandboxRequest,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct SandboxRequest {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub no_mount_cwd: bool,
    #[serde(default)]
    pub mounts: Vec<String>,
    #[serde(default)]
    pub mounts_ro: Vec<String>,
    pub image: Option<String>,
    #[serde(default)]
    pub gpus: Vec<String>,
    pub shm_size: Option<String>,
    pub session_key: Option<String>,
    pub workdir: Option<String>,
    pub backend: Option<String>,
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
    /// Client-generated launch id used to key sandbox setup activity, so the
    /// launching UI polls its own launch's progress. Deliberately not part of
    /// `sandbox_requested`: it correlates progress reporting, nothing else.
    #[serde(default)]
    pub activity_key: Option<String>,
}

impl CreateSessionRequest {
    pub(crate) fn into_application(self) -> application::session_creation::SessionCreationCommand {
        application::session_creation::SessionCreationCommand {
            behavior: self.behavior,
            first_chat: self.first_chat,
            project_id: self.project_id,
            cwd: self.cwd,
            model: application_field(self.model),
            base_url: application_field(self.base_url),
            backend: application_field(self.backend),
            reasoning_effort: application_field(self.reasoning_effort),
            api_key_env: application_field(self.api_key_env),
            extra_headers: match application_field(self.extra_headers) {
                application::Field::Unchanged => application::Field::Unchanged,
                application::Field::Clear => application::Field::Clear,
                application::Field::Set(HeadersRequest(headers)) => {
                    application::Field::Set(headers)
                }
            },
            orchestrator_compaction_threshold: application_field(
                self.orchestrator_compaction_threshold,
            ),
            light_model: application_field(self.light_model),
            ssh_host: self.ssh_host,
            ssh_port: self.ssh_port,
            ssh_identity_file: self.ssh_identity_file,
            sandbox: self.sandbox.into_application(),
        }
    }
}

impl SandboxRequest {
    fn into_application(self) -> application::session_creation::SessionSandboxCommand {
        application::session_creation::SessionSandboxCommand {
            enabled: self.enabled,
            no_mount_cwd: self.no_mount_cwd,
            mounts: self.mounts,
            mounts_ro: self.mounts_ro,
            image: self.image,
            gpus: self.gpus,
            shm_size: self.shm_size,
            session_key: self.session_key,
            workdir: self.workdir,
            backend: self.backend,
            cpus: self.cpus,
            memory_mib: self.memory_mib,
            activity_key: self.activity_key,
        }
    }
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ProviderModelsRequest {
    pub backend: BackendKind,
    #[schema(write_only, example = "fake-provider-key")]
    pub api_key: Option<String>,
    /// Names a key already held in the environment or in NAC home, for a caller
    /// that has one on file and no copy of the secret to send.
    pub api_key_env: Option<String>,
    /// Overrides the provider's canonical URL, for a proxy or a custom gateway.
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ProviderModelList {
    /// The URL the models were actually read from, so the caller can persist
    /// the same destination it validated against.
    pub base_url: String,
    pub models: Vec<ProviderModel>,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateConfigRequest {
    #[serde(default)]
    pub model: RequestField<String>,
    #[serde(default)]
    pub base_url: RequestField<String>,
    #[serde(default)]
    pub backend: RequestField<String>,
    #[serde(default)]
    pub reasoning_effort: RequestField<String>,
    #[serde(default)]
    pub api_key_env: RequestField<String>,
    /// Prefer a JSON object. Null or an empty object clears the persisted map.
    #[serde(default)]
    pub extra_headers: RequestField<HeadersRequest>,
    /// Omitted preserves; null or zero disables.
    #[serde(default)]
    pub orchestrator_compaction_threshold: RequestField<u64>,
    /// Omitted preserves; null returns the session to single-model mode.
    #[serde(default)]
    pub light_model: RequestField<LightModelSettings>,
}

impl UpdateConfigRequest {
    pub(crate) fn into_application(self) -> application::session_configuration::SessionConfigPatch {
        application::session_configuration::SessionConfigPatch {
            model: application_field(self.model),
            base_url: application_field(self.base_url),
            backend: application_field(self.backend),
            reasoning_effort: application_field(self.reasoning_effort),
            api_key_env: application_field(self.api_key_env),
            extra_headers: match application_field(self.extra_headers) {
                application::Field::Unchanged => application::Field::Unchanged,
                application::Field::Clear => application::Field::Clear,
                application::Field::Set(HeadersRequest(headers)) => {
                    application::Field::Set(headers)
                }
            },
            orchestrator_compaction_threshold: application_field(
                self.orchestrator_compaction_threshold,
            ),
            light_model: application_field(self.light_model),
        }
    }
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct SubmitPromptRequest {
    pub prompt: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateInboxItemRequest {
    pub delivery: InboxDelivery,
    pub prompt: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct UpdateInboxItemRequest {
    pub expected_version: i64,
    pub delivery: InboxDelivery,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CancelInboxItemRequest {
    pub expected_version: i64,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateGoalRequest {
    pub objective: String,
    pub token_budget: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct UpdateGoalRequest {
    pub expected_version: i64,
    pub objective: Option<String>,
    #[serde(default)]
    pub token_budget: RequestField<u64>,
    pub status: Option<GoalStatus>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ClearGoalRequest {
    pub expected_version: i64,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ReplyPermissionRequest {
    pub reply: PermissionReply,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct PermissionStateResponse {
    pub requests: Vec<PermissionRequest>,
    pub grants: Vec<PermissionGrantRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct InboxItemResponse {
    pub id: i64,
    pub session_id: String,
    pub delivery: InboxDelivery,
    pub status: nac_core::store::InboxStatus,
    pub prompt: String,
    pub target_run_id: Option<String>,
    pub client_id: Option<String>,
    pub delivered_run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub delivered_at: Option<String>,
    pub cancelled_at: Option<String>,
    pub version: i64,
}

impl From<SessionInboxRecord> for InboxItemResponse {
    fn from(record: SessionInboxRecord) -> Self {
        Self {
            id: record.id,
            session_id: record.session_id,
            delivery: record.delivery,
            status: record.status,
            prompt: nac_core::commands::display_prompt_from_message(&record.content),
            target_run_id: record.target_run_id,
            client_id: record.client_id,
            delivered_run_id: record.delivered_run_id,
            created_at: record.created_at,
            updated_at: record.updated_at,
            delivered_at: record.delivered_at,
            cancelled_at: record.cancelled_at,
            version: record.version,
        }
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct SubmitPromptResponse {
    pub run_id: String,
    pub client_id: Option<String>,
    pub display_prompt: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct OrchestratorSteeringRequest {
    pub instruction: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct OrchestratorSteeringResponse {
    pub steering_id: i64,
    pub status: String,
    pub instruction_preview: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ThreadSteeringRequest {
    pub instruction: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ThreadSteeringResponse {
    pub steering_id: i64,
    pub thread_name: String,
    pub status: String,
    pub instruction_preview: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct EventsQuery {
    pub after_epoch_id: Option<String>,
    pub after_sequence_id: Option<u64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SessionSnapshotQuery {
    pub message_limit: Option<usize>,
    pub thread_event_limit: Option<usize>,
    pub include_sessions: Option<bool>,
    #[serde(default)]
    pub include_system: bool,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct MessagesQuery {
    pub before: Option<usize>,
    pub limit: Option<usize>,
    #[serde(default)]
    pub include_system: bool,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ThreadEventsQuery {
    pub before_id: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct MessagePageMetadata {
    pub start: usize,
    pub end: usize,
    pub total: usize,
    pub has_older: bool,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct MessagesPageResponse {
    pub messages: Vec<Message>,
    pub created_at: Vec<Option<String>>,
    pub page: MessagePageMetadata,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct MessageCycleMetadata {
    pub marker: String,
    pub thread_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct SessionSnapshotResponse {
    #[serde(flatten)]
    pub snapshot: SessionFrontendSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lineage: Option<SessionLineageSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_page: Option<MessagePageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_cycle: Option<MessageCycleMetadata>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SessionLineageKind {
    TraditionalChild,
    ManagedOrchestrator,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct SessionLineageSnapshot {
    pub kind: SessionLineageKind,
    pub parent_session_id: String,
    pub root_session_id: String,
    pub description: String,
}

impl From<nac_core::session_service::MessagePageMetadata> for MessagePageMetadata {
    fn from(page: nac_core::session_service::MessagePageMetadata) -> Self {
        Self {
            start: page.start,
            end: page.end,
            total: page.total,
            has_older: page.has_older,
        }
    }
}

impl From<nac_core::session_service::MessageCycleMetadata> for MessageCycleMetadata {
    fn from(cycle: nac_core::session_service::MessageCycleMetadata) -> Self {
        Self {
            marker: cycle.marker,
            thread_names: cycle.thread_names,
        }
    }
}

impl From<MessagesPageSnapshot> for MessagesPageResponse {
    fn from(page: MessagesPageSnapshot) -> Self {
        Self {
            messages: page.messages,
            created_at: page.created_at,
            page: page.page.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct RecentEventsResponse {
    pub boundary: SessionEventBoundary,
    pub events: Vec<SessionEventEnvelope>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ReplayBoundaryEvent {
    pub epoch_id: String,
    pub replay_boundary_sequence_id: u64,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ReplayGapEvent {
    pub replay_gap: SessionReplayGap,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct LaggedEvent {
    pub missed: u64,
}
