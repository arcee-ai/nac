import type { ApiSchema } from "./openapi.generated";

// Stable frontend names for the generated Rust/OpenAPI contract. Keep only
// frontend-only refinements and intentional compatibility aliases in this file;
// wire DTO shapes belong in openapi.generated.ts.

/** `nac_core::model::types::BackendKind`, serialized kebab-case. */
export type BackendKind = ApiSchema<"BackendKind">;

/** `nac_core::model::types::ReasoningEffort`, serialized lowercase. */
export type ReasoningEffort = ApiSchema<"ReasoningEffort">;

/** Dispatch weight class when a light model is configured, serialized lowercase. */
export type DispatchWeight = "light" | "heavy";

/** Immutable execution topology selected when a session is created. */
export type SessionBehavior = ApiSchema<"SessionBehavior">;

/**
 * The optional light worker model. Same shape on records and requests: the
 * credential is always a selector name, never a key value.
 */
export type LightModelSettings = ApiSchema<"LightModelSettings">;

export type StoreInfo = ApiSchema<"StoreInfo">;

export type ManagedReadinessCheck = ApiSchema<"ReadinessCheck">;
export type ManagedHostStatus = ApiSchema<"ManagedHostStatusResponse">;
export type ManagedGitHubStatus = ApiSchema<"GitHubStatusResponse">;
export type ManagedGitHubLoginStarted = ApiSchema<"GitHubLoginStartedResponse">;
export type ManagedGitHubLoginState = ApiSchema<"GitHubLoginStateResponse">;
export type ManagedGitHubRepository = ApiSchema<"GitHubRepositoryResponse">;
export type ManagedGitHubRepositoryList = ApiSchema<"GitHubRepositoryListResponse">;
export type ManagedGitHubBranchList = ApiSchema<"GitHubBranchListResponse">;

export type ManagedSecretSummary = ApiSchema<"ManagedSecretSummary">;

export type ManagedSecretList = ApiSchema<"ManagedSecretList">;

export type ManagedCloneStatus = ApiSchema<"ManagedCloneStatus">;

export type ManagedCloneOperation = ApiSchema<"ManagedCloneOperation">;

export type StartManagedCloneRequest = ApiSchema<"StartManagedCloneRequest">;

export type SandboxAvailabilityStatus = ApiSchema<"SandboxAvailabilityStatus">;

export type SandboxAvailability = ApiSchema<"SandboxAvailability">;

export type SandboxActivity = ApiSchema<"SandboxActivity">;

/**
 * Cost in micro-USD (1e-6 USD), priced from the model catalog when the
 * response was parsed. All-zero means the catalog has no rates for the model,
 * never that the call was free.
 */
export type TokenCostMicros = ApiSchema<"TokenCostMicros">;

export type TokenUsage = ApiSchema<"TokenUsage">;

export type ToolCall = ApiSchema<"ToolCall">;

export type ToolContent = ApiSchema<"ToolContentSchema">;

/** `nac_core::types::Message`, internally tagged on `role`. */
export type Message = ApiSchema<"Message">;

export type MessageRole = Message["role"];

export type SessionSummarySnapshot = ApiSchema<"SessionSummarySnapshot">;

export type SubmittedUserMessageSnapshot = ApiSchema<"SubmittedUserMessageSnapshot">;

export type ActiveRunSnapshot = ApiSchema<"ActiveRunSnapshot">;

export type ActiveCompactionSnapshot = ApiSchema<"ActiveCompactionSnapshot">;

export type ResponseTimingSnapshot = ApiSchema<"ResponseTimingSnapshot">;

export type SessionMetadata = ApiSchema<"SessionMetadata">;

export type ThreadSnapshot = ApiSchema<"ThreadSnapshot">;

/** How a dispatch ended; only `ok` is retained context for later dispatches. */
export type EpisodeStatus = ApiSchema<"EpisodeStatus">;

export type EpisodeSnapshot = ApiSchema<"EpisodeSnapshot">;

export type WorksetItemSnapshot = ApiSchema<"WorksetItemSnapshot">;

export type WorksetSnapshot = ApiSchema<"WorksetSnapshot">;

export type WorksetsSnapshot = ApiSchema<"WorksetsSnapshot">;

export type ChangedFileStat = ApiSchema<"ChangedFileStat">;

export type WorkspaceSnapshot = ApiSchema<"WorkspaceSnapshot">;

export type WorkspaceFileList = ApiSchema<"WorkspaceFileList">;

export type WorkspaceFileContent = ApiSchema<"WorkspaceFileContent">;

export type OpenWorkspacePathResult = ApiSchema<"OpenLocalPathResult">;

export type Branch = ApiSchema<"Branch">;

export type BranchList = ApiSchema<"BranchList">;

export type SwitchBranchRequest = ApiSchema<"SwitchBranchRequest">;

export type CommitWorkspaceRequest = ApiSchema<"CommitWorkspaceRequest">;

/** What the commit the user just made turned out to contain. */
export type CommitOutcome = ApiSchema<"CommitOutcome">;

/** The checkout as it stood when one run finished. */
export type WorkspaceRevision = ApiSchema<"WorkspaceRevisionRecord">;

export type WorkspaceRevisionChanges = ApiSchema<"WorkspaceRevisionChanges">;

export type WorkspaceDiffTotals = ApiSchema<"WorkspaceDiffTotals">;

export type WorkspaceDiffStage = "staged" | "unstaged" | "untracked";

// The backend serialises these as plain strings; the unions document the known
// values without rejecting anything new the server may start sending.
export type WorkspaceDiffStatus = "added" | "deleted" | "modified" | "untracked" | (string & {});
/** Beware: the backend says insert/delete, not addition/deletion. */
export type WorkspaceDiffLineKind = "context" | "delete" | "insert" | (string & {});

export type WorkspaceDiffLine = ApiSchema<"WorkspaceDiffLine">;

export type WorkspaceDiffHunk = ApiSchema<"WorkspaceDiffHunk">;

export type WorkspaceDiffSection = ApiSchema<"WorkspaceDiffSection">;

export type WorkspaceFileDiff = ApiSchema<"WorkspaceFileDiff">;

export type SteeringStatus = "queued" | "claimed" | "delivered" | "expired";

export type ThreadSteeringRecord = ApiSchema<"ThreadSteeringRecord">;

export interface SessionOverviewRecord {
  session_id: string;
  summary: string;
  model: string;
  generated_at: string;
  source_updated_at: string;
}

export interface ThreadEventBoundary {
  epoch_id: string;
  sequence_id: number;
}

export type ThreadEventDecodeDiagnostic = ApiSchema<"ThreadEventDecodeDiagnostic">;

export type CompactionReason = ApiSchema<"CompactionReason">;
export type CompactionSkipReason = ApiSchema<"CompactionSkipReason">;
export type CompactionFailure = ApiSchema<"CompactionFailure">;

/** `nac_core::events::AgentEvent`, internally tagged on `type` (snake_case). */
export type AgentEvent = ApiSchema<"AgentEvent">;

export type AgentEventType = AgentEvent["type"];

/** `nac_core::events::SessionEvent`, internally tagged on `type`. */
export type SessionEvent = ApiSchema<"SessionEvent">;

export type PermissionReply = ApiSchema<"PermissionReply">;

export type PermissionRequestResource = ApiSchema<"PermissionRequestResource">;

export type PermissionRequest = ApiSchema<"PermissionRequest">;

export type PermissionGrantRecord = ApiSchema<"PermissionGrantRecord">;

export type PermissionStateResponse = ApiSchema<"PermissionStateResponse">;

export type GoalStatus = ApiSchema<"GoalStatus">;

export type SessionGoalRecord = ApiSchema<"SessionGoalRecord">;

export type CreateGoalRequest = ApiSchema<"CreateGoalRequest">;

export type UpdateGoalRequest = ApiSchema<"UpdateGoalRequest">;

export type InboxDelivery = ApiSchema<"InboxDelivery">;
export type InboxStatus = ApiSchema<"InboxStatus">;

export type InboxItem = ApiSchema<"InboxItemResponse">;

export type TraditionalChildStatus = ApiSchema<"TraditionalChildStatus">;

export type TraditionalChildExecutionMode = ApiSchema<"TraditionalChildExecutionMode">;

export type TraditionalChildRecord = ApiSchema<"TraditionalChildRecord">;

export type StartTraditionalChildRequest = ApiSchema<"StartTraditionalChildRequest">;

export type ManagedOrchestratorStatus = TraditionalChildStatus;
export type ManagedOrchestratorExecutionMode = TraditionalChildExecutionMode;

export type ManagedOrchestratorRecord = ApiSchema<"ManagedOrchestratorRecord">;

export type StartManagedOrchestratorRequest = ApiSchema<"StartManagedOrchestratorRequest">;

export type SessionEventBoundary = ApiSchema<"SessionEventBoundary">;

export type SessionEventEnvelope = ApiSchema<"SessionEventEnvelope">;

export type ReplayBoundaryEvent = ApiSchema<"ReplayBoundaryEvent">;

export type ReplayGapEvent = ApiSchema<"ReplayGapEvent">;

export type LaggedEvent = ApiSchema<"LaggedEvent">;

/**
 * `nac_core::events::AssistantStreamDelta`, delivered on the `assistant_delta`
 * SSE event. Unsequenced and never replayed: the assistant message that follows
 * is the authoritative copy of the same text.
 */
export type AssistantStreamDelta = ApiSchema<"AssistantStreamDelta">;

export type ThreadEventRecord = ApiSchema<"ThreadEventPageItem">;

export type ThreadEventPage = ApiSchema<"ThreadEventPage">;

export type MessagePageMetadata = ApiSchema<"MessagePageMetadata">;

export type MessageCycleMetadata = ApiSchema<"MessageCycleMetadata">;

export type MessagesPageResponse = ApiSchema<"MessagesPageResponse">;

export type SessionFrontendSnapshot = ApiSchema<"SessionFrontendSnapshot">;

/** `GET /sessions/{id}` flattens the snapshot and adds paging metadata. */
export type SessionSnapshotResponse = ApiSchema<"SessionSnapshotResponse">;

export type SessionForkOrigin = ApiSchema<"SessionForkOrigin">;

export type SessionForkLink = ApiSchema<"SessionForkLink">;

export type SessionLineage = ApiSchema<"SessionLineageSnapshot">;

export type ManagedSessionSummary = ApiSchema<"ManagedSessionSummary">;

/** `GET /sessions/{id}/config` — the raw persisted row, not the effective config. */
export type RawSessionConfig = ApiSchema<"RawSessionConfig">;

export type LaunchModelDefaults = ApiSchema<"LaunchModelDefaults">;

export type LaunchModelDefaultsRequest = ApiSchema<"LaunchModelDefaultsRequest">;

/**
 * An API key kept in NAC home. The value itself never leaves the server, so
 * only the selector name and a short suffix are available to the UI.
 */
export type StoredCredentialSummary = ApiSchema<"StoredCredentialSummary">;

export type StoredCredentialList = ApiSchema<"StoredCredentialList">;

/** The name the server filed a key under when the caller supplied none. */
export type GeneratedCredential = ApiSchema<"GeneratedCredential">;

/** Providers that sign in through a browser instead of taking an API key. */
export type ManagedAuthProvider = ApiSchema<"ManagedAuthProvider">;

/** What a managed provider currently has stored, signed in or not. */
export type ManagedAuthStatus = ApiSchema<"ManagedAuthStatusResponse">;
export type ManagedAuthList = ApiSchema<"ManagedAuthListResponse">;

/** A device login the provider has issued a code for. */
export type DeviceLoginStarted = ApiSchema<"DeviceLoginStartedResponse">;
export type DeviceLoginState = ApiSchema<"DeviceLoginStateResponse">;

/** One entry of `GET /fs/browse`, listed from the machine running the server. */
export type BrowseEntry = ApiSchema<"BrowseEntry">;

export type BrowseListing = ApiSchema<"BrowseListing">;

/**
 * How to reach an SSH host, as the launch form has it before a session exists.
 *
 * `POST /ssh/browse` takes it with a path and answers with a `BrowseListing`, so
 * a remote directory is navigated exactly like a local one — and succeeding is
 * what proves the connection works.
 */
export interface SshTarget {
  ssh_host: string;
  ssh_port?: number | null;
  ssh_identity_file?: string | null;
}

export type SshBrowseRequest = ApiSchema<"SshBrowseRequest">;

/** A named, reusable SSH connection offered by the launch and settings forms. */
export type SshConfigurationRecord = ApiSchema<"SshConfigurationRecord">;

export type SshConfigurationList = ApiSchema<"SshConfigurationList">;

export type CreateSshConfigurationRequest = ApiSchema<"CreateSshConfigurationRequest">;

/** Tri-state fields: omit to keep, null to clear, value to replace. */
export type UpdateSshConfigurationRequest = ApiSchema<"UpdateSshConfigurationRequest">;

export type McpTransport = ApiSchema<"McpTransportSchema">;

export type McpLibraryAuth = ApiSchema<"McpLibraryAuth">;

/** One entry of the curated MCP library the add-server form offers. */
export type McpLibraryEntry = ApiSchema<"McpLibraryEntry">;

export type McpLibraryResponse = ApiSchema<"McpLibraryResponse">;

/**
 * A saved MCP server from `config.toml`, keyed by name. `env` and `headers`
 * values are redacted previews: a `${ENV_VAR}` reference echoes back verbatim,
 * a literal comes back masked.
 */
export type McpServerView = ApiSchema<"McpServerView">;

export type McpServerList = ApiSchema<"McpServerList">;

export type CreateMcpServerRequest = ApiSchema<"CreateMcpServerRequest">;

/**
 * Tri-state fields: omit to keep, null to clear, value to replace. A sent
 * `env`/`headers` map replaces the whole map; a null value under a key keeps
 * the stored secret for that key.
 */
export type UpdateMcpServerRequest = ApiSchema<"UpdateMcpServerRequest">;

/** Probe a draft or saved server; null map values borrow stored secrets. */
export type TestMcpServerRequest = ApiSchema<"TestMcpServerRequest">;

export type McpProbedTool = ApiSchema<"McpProbedTool">;

export type TestMcpServerResponse = ApiSchema<"TestMcpServerResponse">;

export type ProviderModel = ApiSchema<"ProviderModel">;

export type ProviderModelsRequest = ApiSchema<"ProviderModelsRequest">;

export type ProviderModelList = ApiSchema<"ProviderModelList">;

/** `nac_core::model::catalog::ModelSource`, serialized snake_case. */
export type ModelSource = ApiSchema<"ModelSource">;

/** `nac_core::model::catalog::ProviderAuth`: how a provider authenticates. */
export type ProviderAuth = ApiSchema<"ProviderAuth">;

/** Whether the server can currently authenticate as this provider. */
export type AuthStatus = ApiSchema<"AuthStatus">;

/** Per-million-token rates in micro-USD, as the catalog records them. */
export type ModelCostRates = ApiSchema<"ModelCostRates">;

/** One context-priced rate step; buckets are complete (base-filled). */
export type CostTier = ApiSchema<"CostTier">;

/** The provider `_default` entry an unrecognized model falls back to. */
export type CatalogDefaultLimits = ApiSchema<"DefaultLimits">;

/** One real catalog entry, never a synthesized fallback. */
export type CatalogModel = ApiSchema<"ModelEntry">;
export type CatalogProvider = ApiSchema<"ProviderListing">;

/** `GET /models`: the server's local model catalog, no credentials involved. */
export type ModelCatalog = ApiSchema<"ModelListing">;

/**
 * A saved provider setup. The key itself is not here: `api_key_env` names the
 * credential the server files it under.
 */
export type ModelConfigurationRecord = ApiSchema<"ModelConfigurationRecord">;

export type ModelConfigurationList = ApiSchema<"ModelConfigurationList">;

export type CreateModelConfigurationRequest = ApiSchema<"CreateModelConfigurationRequest">;

/**
 * Every field is tri-state: omit it to keep what is stored, send null to clear
 * it, send a value to replace it. `api_key` cannot be read back, so omitting it
 * keeps the credential the configuration already points at.
 */
export type UpdateModelConfigurationRequest = ApiSchema<"UpdateModelConfigurationRequest">;

/** A configuration the server checked end to end, with the models it allows. */
export type ResolvedModelConfiguration = ApiSchema<"ResolvedModelConfiguration">;

/**
 * Tri-state field of the create/patch config endpoints: omit the key to keep
 * the current value, send null to clear it, send a value to set it.
 */
export type RequestField<T> = T | null | undefined;

export type SandboxRequest = ApiSchema<"SandboxRequest">;

export type CreateSessionRequest = ApiSchema<"CreateSessionRequest">;

/**
 * A durable location plus the defaults and grouping applied to the sessions
 * started inside it. Mirrors `ProjectRecord` in `crates/nac-core`.
 */
export type ProjectRecord = ApiSchema<"ProjectRecord">;

export type ProjectList = ApiSchema<"ProjectList">;

export type CreateProjectRequest = ApiSchema<"CreateProjectRequest">;

export type UpdateProjectRequest = ApiSchema<"UpdateProjectRequest">;

/** Membership is write-once, so this only ever links an unassigned session. */
export type AssignSessionRequest = ApiSchema<"AssignSessionRequest">;

/** What a project delete does with the chats inside it. */
export type DeleteProjectSessions = ApiSchema<"DeleteProjectSessions">;

export type DeleteProjectResponse = ApiSchema<"DeleteProjectResponse">;

export type ReorderProjectsRequest = ApiSchema<"ReorderProjectsRequest">;

export type ReorderProjectsResponse = ApiSchema<"ReorderProjectsResponse">;

export type UpdateConfigRequest = ApiSchema<"UpdateConfigRequest">;

export type UpdateSessionPresentationRequest = ApiSchema<"UpdateSessionPresentationRequest">;

export type ReorderSessionsRequest = ApiSchema<"ReorderSessionsRequest">;

export type ReorderSessionsResponse = ApiSchema<"ReorderSessionsResponse">;

export type SkillCatalogEntry = ApiSchema<"SkillCatalogEntry">;

export type SlashCommandDefinition = ApiSchema<"SlashCommandDefinition">;

export type SubmitPromptRequest = ApiSchema<"SubmitPromptRequest">;

export type SubmitPromptResponse = ApiSchema<"SubmitPromptResponse">;

export type CompactSessionResponse = ApiSchema<"CompactSessionResponse">;

export type RevertSessionRequest = ApiSchema<"RevertSessionRequest">;

export type RevertSessionResponse = ApiSchema<"RevertSessionResponse">;

export type RegenerateSessionRequest = ApiSchema<"RegenerateSessionRequest">;

export type ForkSessionRequest = ApiSchema<"ForkSessionRequest">;

export type ForkSessionResponse = ApiSchema<"ForkSessionResponse">;

export type OrchestratorSteeringResponse = ApiSchema<"OrchestratorSteeringResponse">;

export type ThreadSteeringResponse = ApiSchema<"ThreadSteeringResponse">;

export type RecentEventsResponse = ApiSchema<"RecentEventsResponse">;
