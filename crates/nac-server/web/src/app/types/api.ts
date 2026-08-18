// Hand-written mirror of the JSON that crates/nac-server exposes. The Rust
// source is authoritative: when a handler or a nac-core view type changes, this
// file has to be updated by hand.
//
// Fields are optional here whenever serde may omit them (`skip_serializing_if`)
// and nullable whenever the Rust type is an `Option` that is always emitted.

/** `nac_core::model::types::BackendKind`, serialized kebab-case. */
export type BackendKind =
  | "deepseek-chat"
  | "fireworks-chat"
  | "together-chat"
  | "openai-responses"
  | "chatgpt-codex-responses"
  | "anthropic-messages"
  | "arcee-auth"
  | "arcee-api"
  | "xai-auth";

/** `nac_core::model::types::ReasoningEffort`, serialized lowercase. */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Dispatch weight class when a light model is configured, serialized lowercase. */
export type DispatchWeight = "light" | "heavy";

/**
 * The optional light worker model. Same shape on records and requests: the
 * credential is always a selector name, never a key value.
 */
export interface LightModelSettings {
  model: string;
  backend?: BackendKind | null;
  base_url?: string | null;
  api_key_env?: string | null;
  reasoning_effort?: ReasoningEffort | null;
}

export interface StoreInfo {
  root_cwd: string;
  store_path: string;
  worker_executable: string;
}

export type SandboxAvailabilityStatus = "ready" | "missing" | "unavailable";

export interface SandboxAvailability {
  status: SandboxAvailabilityStatus;
  detail: string | null;
  guidance: string | null;
}

export interface SandboxActivity {
  phase: string;
  since_epoch_ms: number;
}

/**
 * Cost in micro-USD (1e-6 USD), priced from the model catalog when the
 * response was parsed. All-zero means the catalog has no rates for the model,
 * never that the call was free.
 */
export interface TokenCostMicros {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  total: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens?: number;
  total_tokens: number;
  /** Absent on usage recorded before the catalog started pricing responses. */
  cost?: TokenCostMicros;
}

export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export type ToolContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          image: { mime_type: string; data: string };
        }
    >;

/** `nac_core::types::Message`, internally tagged on `role`. */
export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      reasoning_text?: string;
      reasoning_details?: unknown;
      tool_calls?: ToolCall[];
      /** How long the model call behind this message took. */
      duration_ms?: number;
    }
  | { role: "tool"; tool_call_id: string; content: ToolContent };

export type MessageRole = Message["role"];

export interface SessionSummarySnapshot {
  session_id: string;
  cwd: string;
  model: string;
  backend: string;
  model_config_error?: string;
  visible_message_count: number;
  last_user_prompt: string | null;
  sandboxed: boolean;
  ssh_host: string | null;
  /** Omitted when the session leaves the choice to ssh. */
  ssh_port?: number;
  ssh_identity_file?: string;
  title?: string | null;
  pinned?: boolean;
  sort_order?: number;
  presentation_version?: number;
  created_at: string;
  updated_at: string;
  total_tokens?: number;
  /** Micro-USD spend for the session; zero means unknown catalog rates. */
  total_cost_micros?: number;
  run_count: number;
}

export interface SubmittedUserMessageSnapshot {
  run_id: string;
  client_id?: string;
  content: string;
  submitted_at_epoch_ms: number;
}

export interface ActiveRunSnapshot {
  run_id: string;
  client_id?: string;
  prompt_preview: string;
  submitted_user_message?: SubmittedUserMessageSnapshot;
  started_at_epoch_ms: number;
}

export interface ActiveCompactionSnapshot {
  compaction_id: string;
  client_id?: string;
  started_at_epoch_ms: number;
}

export interface ResponseTimingSnapshot {
  last_response_duration_ms: number | null;
  previous_response_duration_ms: number | null;
  response_durations_ms: (number | null)[] | null;
  token_usages?: (TokenUsage | null)[];
  last_token_usage?: TokenUsage;
  cumulative_token_usage?: TokenUsage;
}

export interface SessionMetadata {
  cwd: string;
  workspace_host_path: string | null;
  store_path: string;
  model: string;
  backend: string;
  session_id: string | null;
  sandbox_status: string;
  agents_md_status: string;
  base_url?: string;
  reasoning_effort?: string;
  api_key_env?: string;
  extra_headers?: Record<string, string>;
}

export interface ThreadSnapshot {
  name: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  episode_count: number;
  latest_action: string | null;
}

/** How a dispatch ended; only `ok` is retained context for later dispatches. */
export type EpisodeStatus = "ok" | "error" | "timed_out" | "cancelled";

export interface EpisodeSnapshot {
  id: number;
  thread_name: string;
  session_id: string;
  action: string;
  content: string;
  status: EpisodeStatus;
  created_at: string;
}

export interface WorksetItemSnapshot {
  position: number;
  title: string;
  scope: string;
  description: string;
  role: string;
  depends_on: string[];
  acceptance: string;
  notes: string | null;
  updated_at: string;
}

export interface WorksetSnapshot {
  id: string;
  session_id: string;
  goal: string;
  status: string;
  summary: string;
  verification_recipe: string | null;
  created_at: string;
  updated_at: string;
  items: WorksetItemSnapshot[];
}

export interface WorksetsSnapshot {
  items: WorksetSnapshot[];
  error: string | null;
}

export interface ChangedFileStat {
  /** Raw git status code, e.g. `M`, `??`, `A `, `R100`. */
  status: string;
  path: string;
  additions: number | null;
  deletions: number | null;
}

export interface WorkspaceSnapshot {
  host_root: string | null;
  workspace_display: string;
  repo_label: string | null;
  branch: string | null;
  changed_files: ChangedFileStat[];
  total_additions: number;
  total_deletions: number;
  error: string | null;
}

export interface WorkspaceFileList {
  files: string[];
  truncated: boolean;
}

export interface WorkspaceFileContent {
  path: string;
  /** Null when the file is binary or too large to show. */
  content: string | null;
  size: number;
  binary: boolean;
  too_large: boolean;
}

export interface OpenWorkspacePathResult {
  /** Absolute path handed to the OS opener. */
  opened: string;
  /** True when the requested file was missing and its parent was opened. */
  fell_back_to_parent: boolean;
}

export interface Branch {
  name: string;
  is_current: boolean;
}

export interface BranchList {
  current: string | null;
  branches: Branch[];
  /** Tracked files differ from HEAD, so switching away is refused. */
  dirty: boolean;
}

export interface SwitchBranchRequest {
  name: string;
  create?: boolean;
}

export interface CommitWorkspaceRequest {
  message: string;
}

/** What the commit the user just made turned out to contain. */
export interface CommitOutcome {
  sha: string;
  /** Null on a detached HEAD. */
  branch: string | null;
  files_changed: number;
  additions: number;
  deletions: number;
}

/** The checkout as it stood when one run finished. */
export interface WorkspaceRevision {
  id: number;
  session_id: string;
  run_id: string;
  commit_sha: string;
  /** What this revision is shown as a change against. */
  base_sha: string | null;
  branch: string | null;
  /** Prompt that started the run, for telling revisions apart. */
  label: string;
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
  /**
   * How long the transcript was when the run finished, which is what places the
   * revision against the messages. Null on rows captured before it was kept.
   */
  transcript_len: number | null;
}

export interface WorkspaceRevisionChanges {
  changed_files: ChangedFileStat[];
  total_additions: number;
  total_deletions: number;
  error: string | null;
}

export interface WorkspaceDiffTotals {
  total_additions: number;
  total_deletions: number;
  error: string | null;
}

export type WorkspaceDiffStage = "staged" | "unstaged" | "untracked";

// The backend serialises these as plain strings; the unions document the known
// values without rejecting anything new the server may start sending.
export type WorkspaceDiffStatus = "added" | "deleted" | "modified" | "untracked" | (string & {});
/** Beware: the backend says insert/delete, not addition/deletion. */
export type WorkspaceDiffLineKind = "context" | "delete" | "insert" | (string & {});

export interface WorkspaceDiffLine {
  kind: WorkspaceDiffLineKind;
  old_lineno: number | null;
  new_lineno: number | null;
  content: string;
  has_trailing_newline: boolean;
}

export interface WorkspaceDiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  function_context: string | null;
  lines: WorkspaceDiffLine[];
}

export interface WorkspaceDiffSection {
  stage: WorkspaceDiffStage | (string & {});
  status: WorkspaceDiffStatus;
  binary: boolean;
  too_large: boolean;
  truncated: boolean;
  additions: number;
  deletions: number;
  hunks: WorkspaceDiffHunk[];
  error: string | null;
}

export interface WorkspaceFileDiff {
  path: string;
  old_path: string | null;
  sections: WorkspaceDiffSection[];
  error: string | null;
}

export type SteeringStatus = "queued" | "claimed" | "delivered" | "expired";

export interface ThreadSteeringRecord {
  id: number;
  session_id: string;
  thread_name: string;
  dispatch_id: string | null;
  instruction: string;
  status: SteeringStatus;
  created_at: string;
  claimed_at: string | null;
  delivered_at: string | null;
  expired_at: string | null;
}

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

export interface ThreadEventDecodeDiagnostic {
  id: number;
  thread_name: string;
  created_at: string;
  error: string;
}

export type CompactionReason = "auto" | "manual";
export type CompactionSkipReason = "no_eligible_boundary" | "already_compacted";
export type CompactionFailure =
  | "summary_request_failed"
  | "summary_rejected"
  | "checkpoint_persistence_failed"
  | "cancelled";

/** `nac_core::events::AgentEvent`, internally tagged on `type` (snake_case). */
export type AgentEvent =
  | { type: "run_started"; thread_name?: string; prompt_preview: string }
  | { type: "token_usage_updated"; thread_name?: string; usage: TokenUsage }
  | {
      type: "tool_call_started";
      thread_name?: string;
      call_id: string;
      name: string;
      args_preview: string;
      /**
       * The one argument worth reading in a list: the path for a file tool, the
       * command for `exec_command`. Absent on an event the server had no reason
       * to reduce, and empty when the tool has no such argument.
       */
      key_arg_preview?: string | null;
      args_detail?: string | null;
    }
  | {
      type: "tool_call_finished";
      thread_name?: string;
      call_id: string;
      name: string;
      content_preview: string;
      is_error: boolean;
      command_status?: "completed" | "timed_out" | "cancelled" | "spawn_error";
      exit_code?: number;
    }
  | {
      type: "thread_started";
      name: string;
      action: string;
      source_threads: string[];
    }
  /**
   * A line the thread's worker printed that was not itself an event — its plain
   * log output. Streamed but never persisted, so it is only ever available for
   * a run this client watched.
   */
  | { type: "thread_log"; name: string; line: string }
  | {
      type: "thread_steering_queued";
      name: string;
      steering_id: number;
      instruction_preview: string;
    }
  | {
      type: "thread_steering_delivered";
      name: string;
      steering_id: number;
      instruction_preview: string;
    }
  | {
      type: "thread_steering_expired";
      name: string;
      steering_id: number;
      instruction_preview: string;
    }
  | {
      type: "orchestrator_steering_queued";
      steering_id: number;
      instruction_preview: string;
    }
  | {
      type: "orchestrator_steering_delivered";
      steering_id: number;
      instruction_preview: string;
    }
  | {
      type: "orchestrator_steering_expired";
      steering_id: number;
      instruction_preview: string;
    }
  | {
      type: "orchestrator_compaction_started";
      compaction_id: string;
      reason: CompactionReason;
    }
  | {
      type: "orchestrator_compaction_completed";
      compaction_id: string;
      reason: CompactionReason;
    }
  | {
      type: "orchestrator_compaction_skipped";
      compaction_id: string;
      reason: CompactionReason;
      cause: CompactionSkipReason;
    }
  | {
      type: "orchestrator_compaction_failed";
      compaction_id: string;
      reason: CompactionReason;
      failure: CompactionFailure;
    }
  | {
      type: "thread_finished";
      name: string;
      exit_code: number | null;
      timed_out: boolean;
      timeout_reason?: string;
      usage?: TokenUsage;
    }
  | {
      type: "assistant_message";
      thread_name?: string;
      content: string;
      usage?: TokenUsage;
    }
  | { type: "error"; thread_name?: string; message: string }
  /** A refusal from the provider, reported verbatim rather than reduced. */
  | { type: "model_error"; thread_name?: string; message: string }
  /** A configured MCP server the worker could not load, with a bounded reason. */
  | {
      type: "mcp_server_skipped";
      thread_name?: string;
      server_name: string;
      reason: string;
    }
  | { type: "run_finished"; thread_name?: string };

export type AgentEventType = AgentEvent["type"];

/** `nac_core::events::SessionEvent`, internally tagged on `type`. */
export type SessionEvent =
  | { type: "agent"; event: AgentEvent }
  | {
      type: "run_started";
      prompt_preview: string;
      submitted_user_message?: SubmittedUserMessageSnapshot;
      started_at_epoch_ms: number;
    }
  | { type: "run_completed"; response: string; duration_ms?: number }
  | { type: "run_failed"; message: string }
  /** The user stopped the run, which is an outcome rather than a fault. */
  | { type: "run_cancelled" }
  | { type: "snapshot_saved"; session_id: string }
  /** The orchestrator transcript grew: a message was committed to the log. */
  | { type: "transcript_appended"; transcript_len: number }
  /** A revert cut the transcript back; everything past this length is gone. */
  | { type: "transcript_reverted"; transcript_len: number };

export interface SessionEventBoundary {
  epoch_id: string;
  sequence_id: number;
}

export interface SessionEventEnvelope {
  session_id: string | null;
  epoch_id: string;
  sequence_id: number;
  client_id?: string;
  run_id?: string;
  event: SessionEvent;
}

export interface ReplayBoundaryEvent {
  epoch_id: string;
  replay_boundary_sequence_id: number;
}

export interface ReplayGapEvent {
  replay_gap: {
    missing_from_sequence_id: number;
    missing_to_sequence_id: number;
  };
}

export interface LaggedEvent {
  missed: number;
}

/**
 * `nac_core::events::AssistantStreamDelta`, delivered on the `assistant_delta`
 * SSE event. Unsequenced and never replayed: the assistant message that follows
 * is the authoritative copy of the same text.
 */
export interface AssistantStreamDelta {
  thread_name: string | null;
  text?: string;
  reasoning?: string;
}

export interface ThreadEventRecord {
  id: number;
  created_at: string;
  event: AgentEvent;
}

export interface ThreadEventPage {
  events: ThreadEventRecord[];
  has_older: boolean;
  next_before_id: number | null;
  thread_event_boundary?: ThreadEventBoundary;
  diagnostics?: ThreadEventDecodeDiagnostic[];
}

export interface MessagePageMetadata {
  start: number;
  end: number;
  total: number;
  has_older: boolean;
}

export interface MessageCycleMetadata {
  marker: string;
  thread_names: string[];
}

export interface MessagesPageResponse {
  messages: Message[];
  created_at: (string | null)[];
  page: MessagePageMetadata;
}

export interface SessionFrontendSnapshot {
  metadata: SessionMetadata;
  messages: Message[];
  /** Present for the lifetime of a service that repaired a transcript gap. */
  transcript_recovery_warning?: string;
  /**
   * One entry per message, or absent entirely on a snapshot that has no
   * transcript log. `null` where the message predates the log.
   */
  message_created_at?: (string | null)[];
  response_timing: ResponseTimingSnapshot;
  active_run?: ActiveRunSnapshot;
  active_compaction?: ActiveCompactionSnapshot;
  sessions: SessionSummarySnapshot[];
  active_threads: string[];
  threads: ThreadSnapshot[];
  thread_episodes: Record<string, EpisodeSnapshot[]>;
  thread_events: Record<string, AgentEvent[]>;
  thread_event_boundary: ThreadEventBoundary;
  thread_event_diagnostics?: ThreadEventDecodeDiagnostic[];
  thread_steering: ThreadSteeringRecord[];
  overview?: SessionOverviewRecord;
  worksets: WorksetsSnapshot;
  workspace: WorkspaceSnapshot;
}

/** `GET /sessions/{id}` flattens the snapshot and adds paging metadata. */
export interface SessionSnapshotResponse extends SessionFrontendSnapshot {
  message_page?: MessagePageMetadata;
  message_cycle?: MessageCycleMetadata;
}

export interface ManagedSessionSummary {
  summary: SessionSummarySnapshot;
  active: boolean;
  active_run?: ActiveRunSnapshot;
  /** Present only when the list was requested with `workspace_stats=true`. */
  workspace_diff?: WorkspaceDiffTotals;
}

/** `GET /sessions/{id}/config` — the raw persisted row, not the effective config. */
export interface RawSessionConfig {
  session_id: string;
  model: string;
  base_url: string;
  backend: string | null;
  reasoning_effort: string | null;
  api_key_env: string | null;
  /** A JSON-encoded object, not an object. */
  extra_headers_json: string | null;
  orchestrator_compaction_threshold: number | null;
  config_version: number;
  /** Present when the session runs with a light worker model. */
  light_model?: LightModelSettings;
  /** Non-empty when the row needs a repair PATCH. */
  diagnostics?: string[];
}

export interface LaunchModelDefaults {
  configured_model_backend: BackendKind | null;
  configured_model_base_url: string | null;
}

export interface LaunchModelDefaultsRequest {
  cwd?: string | null;
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_identity_file?: string | null;
}

/**
 * An API key kept in NAC home. The value itself never leaves the server, so
 * only the selector name and a short suffix are available to the UI.
 */
export interface StoredCredentialSummary {
  name: string;
  /** Empty when the secret is too short for a suffix to be safe to show. */
  last_four: string;
}

export interface StoredCredentialList {
  credentials: StoredCredentialSummary[];
}

/** The name the server filed a key under when the caller supplied none. */
export interface GeneratedCredential {
  name: string;
}

/** Providers that sign in through a browser instead of taking an API key. */
export type ManagedAuthProvider = "arcee" | "codex" | "xai";

/** What a managed provider currently has stored, signed in or not. */
export interface ManagedAuthStatus {
  provider: ManagedAuthProvider;
  /** The backend a session picks to use this login. */
  backend: BackendKind;
  signed_in: boolean;
  /** Workspace name for Arcee, ChatGPT account id for Codex. */
  account: string | null;
  organization: string | null;
  base_url: string | null;
  expires_at_ms: number | null;
  path: string;
}

export interface ManagedAuthList {
  providers: ManagedAuthStatus[];
}

/** A device login the provider has issued a code for. */
export interface DeviceLoginStarted {
  login_id: string;
  provider: ManagedAuthProvider;
  verification_uri: string;
  /**
   * Null when the login is settled by a redirect back to this machine, which
   * leaves nothing for the user to read out.
   */
  user_code: string | null;
  expires_in_secs: number;
}

export type DeviceLoginState =
  | { state: "pending" }
  | { state: "complete"; auth: ManagedAuthStatus }
  | { state: "failed"; error: string };

/** One entry of `GET /fs/browse`, listed from the machine running the server. */
export interface BrowseEntry {
  name: string;
  path: string;
  is_directory: boolean;
}

export interface BrowseListing {
  path: string;
  /** Absent at a filesystem root, where upward navigation stops. */
  parent: string | null;
  home: string | null;
  entries: BrowseEntry[];
  /** Set when the directory had more entries than the server will serialize. */
  truncated: boolean;
}

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

export interface SshBrowseRequest extends SshTarget {
  /** Absent or empty opens on the login home on the remote host. */
  path?: string | null;
  /** Dot-prefixed names are left out unless this asks for them. */
  hidden?: boolean;
}

/** A named, reusable SSH connection offered by the launch and settings forms. */
export interface SshConfigurationRecord {
  config_id: string;
  name: string;
  ssh_host: string;
  ssh_port: number | null;
  ssh_identity_file: string | null;
  created_at: string;
  updated_at: string;
}

export interface SshConfigurationList {
  configurations: SshConfigurationRecord[];
}

export interface CreateSshConfigurationRequest {
  name: string;
  ssh_host: string;
  ssh_port?: number | null;
  ssh_identity_file?: string | null;
}

/** Tri-state fields: omit to keep, null to clear, value to replace. */
export interface UpdateSshConfigurationRequest {
  name?: RequestField<string>;
  ssh_host?: RequestField<string>;
  ssh_port?: RequestField<number>;
  ssh_identity_file?: RequestField<string>;
}

export type McpTransport = "stdio" | "streamable_http";

export type McpLibraryAuth = "none" | "optional_header" | "required_header";

/** One entry of the curated MCP library the add-server form offers. */
export interface McpLibraryEntry {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  url: string;
  auth: McpLibraryAuth;
  auth_header: string | null;
  auth_hint: string | null;
  docs_url: string;
  icon_url: string | null;
  category: string;
  tags: string[];
}

export interface McpLibraryResponse {
  entries: McpLibraryEntry[];
}

/**
 * A saved MCP server from `config.toml`, keyed by name. `env` and `headers`
 * values are redacted previews: a `${ENV_VAR}` reference echoes back verbatim,
 * a literal comes back masked.
 */
export interface McpServerView {
  name: string;
  enabled: boolean;
  transport: McpTransport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  url: string | null;
  headers: Record<string, string>;
  library_id: string | null;
}

export interface McpServerList {
  servers: McpServerView[];
}

export interface CreateMcpServerRequest {
  name: string;
  enabled?: boolean;
  transport: McpTransport;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  library_id?: string | null;
}

/**
 * Tri-state fields: omit to keep, null to clear, value to replace. A sent
 * `env`/`headers` map replaces the whole map; a null value under a key keeps
 * the stored secret for that key.
 */
export interface UpdateMcpServerRequest {
  name?: RequestField<string>;
  enabled?: RequestField<boolean>;
  transport?: RequestField<McpTransport>;
  command?: RequestField<string>;
  args?: RequestField<string[]>;
  env?: RequestField<Record<string, string | null>>;
  url?: RequestField<string>;
  headers?: RequestField<Record<string, string | null>>;
  library_id?: RequestField<string>;
}

/** Probe a draft or saved server; null map values borrow stored secrets. */
export interface TestMcpServerRequest {
  stored_name?: string | null;
  name?: string | null;
  transport?: McpTransport | null;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string | null> | null;
  url?: string | null;
  headers?: Record<string, string | null> | null;
}

export interface McpProbedTool {
  name: string;
  description: string | null;
}

export interface TestMcpServerResponse {
  tools: McpProbedTool[];
}

export interface ProviderModel {
  id: string;
  display_name: string | null;
}

export interface ProviderModelsRequest {
  backend: BackendKind;
  api_key?: string | null;
  /** Names a key already on file, for a caller that holds no copy of it. */
  api_key_env?: string | null;
  /** Overrides the provider's canonical URL. */
  base_url?: string | null;
}

export interface ProviderModelList {
  base_url: string;
  models: ProviderModel[];
}

/** `nac_core::model::catalog::ModelSource`, serialized snake_case. */
export type ModelSource =
  | "baseline"
  | "overlay"
  | "user_override"
  | "provider_default"
  | "fallback";

/** `nac_core::model::catalog::ProviderAuth`: how a provider authenticates. */
export type ProviderAuth = "api_key_env" | "managed_arcee" | "codex_oauth" | "xai_oauth";

/** Whether the server can currently authenticate as this provider. */
export type AuthStatus = "ready" | "no_credential";

/** Per-million-token rates in micro-USD, as the catalog records them. */
export interface ModelCostRates {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  /**
   * Context-priced rate steps (models.dev `cost.tiers`): when a response's
   * prompt tokens exceed `input_tokens_above`, the tier's rates replace the
   * base rates for that response. Absent = flat pricing.
   */
  tiers?: CostTier[];
}

/** One context-priced rate step; buckets are complete (base-filled). */
export interface CostTier {
  input_tokens_above: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

/** The provider `_default` entry an unrecognized model falls back to. */
export interface CatalogDefaultLimits {
  context_window: number;
  max_tokens: number;
  supported_efforts: ReasoningEffort[];
}

/** One real catalog entry, never a synthesized fallback. */
export interface CatalogModel {
  id: string;
  display_name: string | null;
  context_window: number;
  max_tokens: number;
  cost: ModelCostRates;
  reasoning: boolean;
  supported_efforts: ReasoningEffort[];
  source: ModelSource;
}

export interface CatalogProvider {
  id: BackendKind;
  auth: ProviderAuth;
  auth_status: AuthStatus;
  /** The env var name or login command to fix a missing credential. */
  auth_hint: string | null;
  managed_base_url: string | null;
  default_base_url: string | null;
  default_limits: CatalogDefaultLimits;
  models: CatalogModel[];
}

/** `GET /models`: the server's local model catalog, no credentials involved. */
export interface ModelCatalog {
  catalog_version: number;
  providers: CatalogProvider[];
}

/**
 * A saved provider setup. The key itself is not here: `api_key_env` names the
 * credential the server files it under.
 */
export interface ModelConfigurationRecord {
  config_id: string;
  name: string;
  backend: string;
  model: string;
  base_url: string;
  api_key_env: string | null;
  reasoning_effort: string | null;
  extra_headers: Record<string, string>;
  orchestrator_compaction_threshold: number | null;
  initial_prompt: string | null;
  /** Present when the setup saves a light worker model. */
  light_model?: LightModelSettings;
  created_at: string;
  updated_at: string;
}

export interface ModelConfigurationList {
  configurations: ModelConfigurationRecord[];
}

export interface CreateModelConfigurationRequest {
  name: string;
  backend: BackendKind;
  model: string;
  base_url?: string | null;
  api_key?: string | null;
  reasoning_effort?: string | null;
  extra_headers?: Record<string, string>;
  orchestrator_compaction_threshold?: number | null;
  initial_prompt?: string | null;
  light_model?: LightModelSettings | null;
}

/**
 * Every field is tri-state: omit it to keep what is stored, send null to clear
 * it, send a value to replace it. `api_key` cannot be read back, so omitting it
 * keeps the credential the configuration already points at.
 */
export interface UpdateModelConfigurationRequest {
  name?: RequestField<string>;
  backend?: RequestField<BackendKind>;
  model?: RequestField<string>;
  base_url?: RequestField<string>;
  api_key?: RequestField<string>;
  reasoning_effort?: RequestField<string>;
  extra_headers?: RequestField<Record<string, string>>;
  orchestrator_compaction_threshold?: RequestField<number>;
  initial_prompt?: RequestField<string>;
  light_model?: RequestField<LightModelSettings>;
}

/** A configuration the server checked end to end, with the models it allows. */
export interface ResolvedModelConfiguration {
  backend: BackendKind;
  model: string | null;
  base_url: string;
  api_key_env: string | null;
  reasoning_effort: string | null;
  models: ProviderModel[];
  /** Set when a stored login could not be asked, so an empty list has a reason. */
  models_error: string | null;
}

/**
 * Tri-state field of the create/patch config endpoints: omit the key to keep
 * the current value, send null to clear it, send a value to set it.
 */
export type RequestField<T> = T | null | undefined;

export interface SandboxRequest {
  enabled?: boolean;
  no_mount_cwd?: boolean;
  mounts?: string[];
  mounts_ro?: string[];
  image?: string | null;
  gpus?: string[];
  shm_size?: string | null;
  session_key?: string | null;
  /** Client-generated launch id correlating sandbox activity polling. */
  activity_key?: string | null;
  workdir?: string | null;
  backend?: string | null;
  cpus?: number | null;
  memory_mib?: number | null;
}

export interface CreateSessionRequest {
  cwd?: string | null;
  model?: RequestField<string>;
  base_url?: RequestField<string>;
  backend?: RequestField<string>;
  reasoning_effort?: RequestField<string>;
  api_key_env?: RequestField<string>;
  extra_headers?: RequestField<Record<string, string>>;
  orchestrator_compaction_threshold?: RequestField<number>;
  /** Omit or null for single-model; a value launches with a light worker model. */
  light_model?: RequestField<LightModelSettings>;
  ssh_host?: string | null;
  /** Null leaves the port and the key to ssh and to `~/.ssh/config`. */
  ssh_port?: number | null;
  ssh_identity_file?: string | null;
  sandbox?: SandboxRequest;
}

export interface UpdateConfigRequest {
  model?: RequestField<string>;
  base_url?: RequestField<string>;
  backend?: RequestField<string>;
  reasoning_effort?: RequestField<string>;
  api_key_env?: RequestField<string>;
  extra_headers?: RequestField<Record<string, string>>;
  orchestrator_compaction_threshold?: RequestField<number>;
  /** Omit to keep; null returns the session to single-model mode. */
  light_model?: RequestField<LightModelSettings>;
}

export interface UpdateSessionPresentationRequest {
  /** Empty string restores the automatic title; the backend rejects null. */
  title: string;
  pinned: boolean;
  expected_version: number;
}

export interface ReorderSessionsRequest {
  pinned: boolean;
  session_ids: string[];
  expected_versions: Record<string, number>;
}

export interface ReorderSessionsResponse {
  pinned: boolean;
  sessions: SessionSummarySnapshot[];
}

export interface SlashCommandDefinition {
  command: string;
  name: string;
  description: string;
  accepts_arguments: boolean;
}

export interface SubmitPromptRequest {
  prompt: string;
}

export interface SubmitPromptResponse {
  run_id: string;
  client_id: string | null;
  display_prompt: string;
}

export type CompactSessionResponse =
  | { status: "compacted"; compaction_id: string }
  | {
      status: "unchanged";
      compaction_id: string;
      reason: CompactionSkipReason;
    };

export interface RevertSessionRequest {
  /** Snapshot index of the user message to go back to; it is dropped too. */
  message_idx: number;
}

export interface RevertSessionResponse {
  transcript_len: number;
  messages_removed: number;
  /** False when the session has no captured revision covering that point. */
  workspace_restored: boolean;
  revisions_removed: number;
  /** Threads the discarded messages dispatched and nothing else refers to. */
  threads_removed: number;
}

export interface RegenerateSessionRequest {
  /** Snapshot index of the user message to answer again. */
  message_idx: number;
}

export interface SteeringRequest {
  instruction: string;
}

export interface OrchestratorSteeringResponse {
  steering_id: number;
  status: string;
  instruction_preview: string;
}

export interface ThreadSteeringResponse {
  steering_id: number;
  thread_name: string;
  status: string;
  instruction_preview: string;
}

export interface RecentEventsResponse {
  boundary: SessionEventBoundary;
  events: SessionEventEnvelope[];
}
