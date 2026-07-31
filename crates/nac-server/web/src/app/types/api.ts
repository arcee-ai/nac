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
  | "arcee-api";

/** `nac_core::model::types::ReasoningEffort`, serialized lowercase. */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface StoreInfo {
  root_cwd: string;
  store_path: string;
  worker_executable: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens?: number;
  total_tokens: number;
}

export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

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
    }
  | { role: "tool"; tool_call_id: string; content: string };

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
  title?: string | null;
  pinned?: boolean;
  sort_order?: number;
  presentation_version?: number;
  created_at: string;
  updated_at: string;
  total_tokens?: number;
}

export interface SubmittedUserMessageSnapshot {
  run_id: string;
  client_id?: string;
  content: string;
  baseline_user_message_count?: number;
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

export interface EpisodeSnapshot {
  id: number;
  thread_name: string;
  session_id: string;
  action: string;
  content: string;
  created_at: string;
}

export interface WorksetItemSnapshot {
  position: number;
  title: string;
  scope: string | null;
  description: string | null;
  role: string | null;
  depends_on: string | null;
  acceptance: string | null;
  notes: string | null;
  updated_at: string;
}

export interface WorksetSnapshot {
  id: string;
  status: string;
  summary: string | null;
  item_count: number;
  updated_at: string;
  goal: string | null;
  verification_recipe: string | null;
  items: WorksetItemSnapshot[];
}

export interface WorksetsSnapshot {
  items: WorksetSnapshot[];
  error: string | null;
}

/** Git status letter as produced by nac-core: `?` `R` `A` `D` `M`. */
export type ChangedFileStatus = "?" | "R" | "A" | "D" | "M";

export interface ChangedFileStat {
  status: ChangedFileStatus;
  path: string;
  additions?: number;
  deletions?: number;
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

export interface WorkspaceDiffTotals {
  total_additions: number;
  total_deletions: number;
  error: string | null;
}

export type WorkspaceDiffStage = "staged" | "unstaged" | "untracked";
export type WorkspaceDiffStatus =
  | "added"
  | "deleted"
  | "modified"
  | "untracked";
/** Beware: the backend says insert/delete, not addition/deletion. */
export type WorkspaceDiffLineKind = "context" | "delete" | "insert";

export interface WorkspaceDiffLine {
  kind: WorkspaceDiffLineKind;
  old_lineno?: number;
  new_lineno?: number;
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
  stage: WorkspaceDiffStage;
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
      args_detail?: string | null;
    }
  | {
      type: "tool_call_finished";
      thread_name?: string;
      call_id: string;
      name: string;
      content_preview: string;
      is_error: boolean;
    }
  | {
      type: "thread_started";
      name: string;
      action: string;
      source_threads: string[];
    }
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
  | { type: "snapshot_saved"; session_id: string };

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
  page: MessagePageMetadata;
}

export interface SessionFrontendSnapshot {
  metadata: SessionMetadata;
  messages: Message[];
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
  ssh_host?: string | null;
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
  events: SessionEventEnvelope[];
}
