// Thin typed client over the nac-server REST API.
//
// Requests are always same-origin: in production nac-web serves this bundle
// itself, and in development the Vite proxy forwards the API routes to it.

import type {
  BranchList,
  BrowseListing,
  CommitOutcome,
  CommitWorkspaceRequest,
  CompactSessionResponse,
  CreateModelConfigurationRequest,
  CreateSessionRequest,
  DeviceLoginStarted,
  DeviceLoginState,
  LaunchModelDefaults,
  LaunchModelDefaultsRequest,
  ManagedAuthList,
  ManagedAuthProvider,
  ManagedAuthStatus,
  ManagedSessionSummary,
  MessagesPageResponse,
  ModelCatalog,
  ModelConfigurationList,
  ModelConfigurationRecord,
  OrchestratorSteeringResponse,
  ProviderModelList,
  ProviderModelsRequest,
  RawSessionConfig,
  RecentEventsResponse,
  ReorderSessionsRequest,
  ReorderSessionsResponse,
  ResolvedModelConfiguration,
  RevertSessionResponse,
  SessionSnapshotResponse,
  SessionSummarySnapshot,
  SlashCommandDefinition,
  SshBrowseRequest,
  SshConfigurationList,
  SshConfigurationRecord,
  CreateSshConfigurationRequest,
  UpdateSshConfigurationRequest,
  SshTarget,
  StoreInfo,
  SubmitPromptResponse,
  SwitchBranchRequest,
  ThreadEventPage,
  ThreadSteeringResponse,
  UpdateConfigRequest,
  UpdateModelConfigurationRequest,
  UpdateSessionPresentationRequest,
  WorkspaceDiffStage,
  WorkspaceFileContent,
  WorkspaceFileDiff,
  WorkspaceFileList,
  OpenWorkspacePathResult,
  WorkspaceRevision,
  WorkspaceRevisionChanges,
} from "@/app/types/api";

export class ApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(status: number, method: string, path: string, detail: string) {
    super(detail ? `${detail} (HTTP ${status})` : `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
}

/** Every handler that fails answers with `{ "error": string }`. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return res.statusText;
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as { error?: unknown }).error === "string"
      ) {
        return (parsed as { error: string }).error;
      }
    } catch {
      // Not JSON; the raw body is the best detail available.
    }
    return text;
  } catch {
    return res.statusText;
  }
}

async function request<T>(
  method: Method,
  path: string,
  { body, signal }: RequestOptions = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new ApiError(res.status, method, path, await errorDetail(res));
  }

  // Several mutations answer 200/202 with an empty body.
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    return (text ? text : undefined) as T;
  }
  return (await res.json()) as T;
}

const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}`;

export interface WorkspaceDiffOptions {
  stage?: WorkspaceDiffStage | "all";
  context?: number;
  /** Diff a captured revision instead of the working tree. */
  revision?: number | null;
  signal?: AbortSignal;
}
export interface SessionSnapshotOptions {
  messageLimit?: number;
  threadEventLimit?: number;
  includeSessions?: boolean;
  includeSystem?: boolean;
  signal?: AbortSignal;
}


export interface MessagesPageOptions {
  before?: number;
  limit?: number;
  includeSystem?: boolean;
  signal?: AbortSignal;
}

export interface ThreadEventsOptions {
  beforeId?: number;
  limit?: number;
  signal?: AbortSignal;
}

export const api = {
  health: (signal?: AbortSignal) =>
    request<{ status: string }>("GET", "/health", { signal }),

  getStore: (signal?: AbortSignal) =>
    request<StoreInfo>("GET", "/store", { signal }),

  // Managed providers sign in with a device login: the server hands back a
  // code to show, waits for the browser approval on its own, and the outcome
  // is collected by polling.
  listManagedAuth: (signal?: AbortSignal) =>
    request<ManagedAuthList>("GET", "/auth", { signal }),

  startManagedLogin: (provider: ManagedAuthProvider) =>
    request<DeviceLoginStarted>(
      "POST",
      `/auth/${encodeURIComponent(provider)}/login`,
    ),

  pollManagedLogin: (
    provider: ManagedAuthProvider,
    loginId: string,
    signal?: AbortSignal,
  ) =>
    request<DeviceLoginState>(
      "GET",
      `/auth/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}`,
      { signal },
    ),

  cancelManagedLogin: (provider: ManagedAuthProvider, loginId: string) =>
    request<void>(
      "DELETE",
      `/auth/${encodeURIComponent(provider)}/login/${encodeURIComponent(loginId)}`,
    ),

  managedLogout: (provider: ManagedAuthProvider) =>
    request<ManagedAuthStatus>(
      "DELETE",
      `/auth/${encodeURIComponent(provider)}`,
    ),

  // Browsers withhold absolute paths from every file-picking API, so a local
  // path is chosen against the filesystem the server sees.
  browsePath: (
    path: string | null,
    kind: "directory" | "toml" | "file" = "directory",
    hidden = false,
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({ kind });
    if (path) query.set("path", path);
    if (hidden) query.set("hidden", "true");
    return request<BrowseListing>("GET", `/fs/browse?${query.toString()}`, { signal });
  },

  /**
   * The same listing for a directory on an SSH host. Also the connection test
   * the launch form runs first: only a working connection can answer.
   */
  browseSshPath: (
    target: SshTarget,
    path: string | null,
    hidden = false,
    signal?: AbortSignal,
  ) =>
    request<BrowseListing>("POST", "/ssh/browse", {
      body: { ...target, path, hidden } satisfies SshBrowseRequest,
      signal,
    }),

  /** Validates the key as a side effect: a bad key cannot list models. */
  listProviderModels: (payload: ProviderModelsRequest) =>
    request<ProviderModelList>("POST", "/providers/models", { body: payload }),

  /**
   * The server's own catalog: limits, prices and effort support for the models
   * it knows about. Local and credential-free, so it answers for every provider
   * at once — unlike `listProviderModels`, which asks one provider.
   */
  getModelCatalog: (signal?: AbortSignal) =>
    request<ModelCatalog>("GET", "/models", { signal }),

  listCommands: (signal?: AbortSignal) =>
    request<SlashCommandDefinition[]>("GET", "/commands", { signal }),

  listModelConfigs: (signal?: AbortSignal) =>
    request<ModelConfigurationList>("GET", "/model-configs", { signal }),

  createModelConfig: (payload: CreateModelConfigurationRequest) =>
    request<ModelConfigurationRecord>("POST", "/model-configs", { body: payload }),

  updateModelConfig: (
    configId: string,
    payload: UpdateModelConfigurationRequest,
  ) =>
    request<ModelConfigurationRecord>(
      "PATCH",
      `/model-configs/${encodeURIComponent(configId)}`,
      { body: payload },
    ),

  deleteModelConfig: (configId: string) =>
    request<void>("DELETE", `/model-configs/${encodeURIComponent(configId)}`),

  listSshConfigs: (signal?: AbortSignal) =>
    request<SshConfigurationList>("GET", "/ssh-configs", { signal }),

  createSshConfig: (payload: CreateSshConfigurationRequest) =>
    request<SshConfigurationRecord>("POST", "/ssh-configs", { body: payload }),

  updateSshConfig: (configId: string, payload: UpdateSshConfigurationRequest) =>
    request<SshConfigurationRecord>(
      "PATCH",
      `/ssh-configs/${encodeURIComponent(configId)}`,
      { body: payload },
    ),

  deleteSshConfig: (configId: string) =>
    request<void>("DELETE", `/ssh-configs/${encodeURIComponent(configId)}`),

  /** Resolves a saved configuration's credential and lists its models. */
  resolveModelConfig: (configId: string) =>
    request<ResolvedModelConfiguration>(
      "POST",
      `/model-configs/${encodeURIComponent(configId)}/models`,
    ),

  resolveConfigFile: (path: string) =>
    request<ResolvedModelConfiguration>("POST", "/model-configs/from-file", {
      body: { path },
    }),

  listSessions: (workspaceStats = false, signal?: AbortSignal) =>
    request<ManagedSessionSummary[]>(
      "GET",
      workspaceStats ? "/sessions?workspace_stats=true" : "/sessions",
      { signal },
    ),

  getSession: (id: string, options: SessionSnapshotOptions = {}) => {
    const params = new URLSearchParams();
    if (options.messageLimit !== undefined) {
      params.set("message_limit", String(options.messageLimit));
    }
    if (options.threadEventLimit !== undefined) {
      params.set("thread_event_limit", String(options.threadEventLimit));
    }
    if (options.includeSessions !== undefined) {
      params.set("include_sessions", String(options.includeSessions));
    }
    if (options.includeSystem) params.set("include_system", "true");
    const query = params.toString();
    return request<SessionSnapshotResponse>(
      "GET",
      `${sessionPath(id)}${query ? `?${query}` : ""}`,
      { signal: options.signal },
    );
  },

  createSession: (payload: CreateSessionRequest) =>
    request<SessionSnapshotResponse>("POST", "/sessions", { body: payload }),

  deleteSession: (id: string) => request<void>("DELETE", sessionPath(id)),

  launchDefaults: (payload: LaunchModelDefaultsRequest, signal?: AbortSignal) =>
    request<LaunchModelDefaults>("POST", "/sessions/launch-defaults", {
      body: payload,
      signal,
    }),

  updatePresentation: (id: string, payload: UpdateSessionPresentationRequest) =>
    request<SessionSummarySnapshot>("PUT", `${sessionPath(id)}/presentation`, {
      body: payload,
    }),

  reorderSessions: (payload: ReorderSessionsRequest) =>
    request<ReorderSessionsResponse>("PUT", "/sessions/order", {
      body: payload,
    }),

  getConfig: (id: string, signal?: AbortSignal) =>
    request<RawSessionConfig>("GET", `${sessionPath(id)}/config`, { signal }),

  updateConfig: (id: string, payload: UpdateConfigRequest) =>
    request<void>("PATCH", `${sessionPath(id)}/config`, { body: payload }),

  getMessages: (id: string, options: MessagesPageOptions = {}) => {
    const params = new URLSearchParams();
    if (options.before !== undefined) params.set("before", String(options.before));
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.includeSystem) params.set("include_system", "true");
    const query = params.toString();
    return request<MessagesPageResponse>(
      "GET",
      `${sessionPath(id)}/messages${query ? `?${query}` : ""}`,
      { signal: options.signal },
    );
  },

  getThreadEvents: (
    id: string,
    threadName: string,
    options: ThreadEventsOptions = {},
  ) => {
    const params = new URLSearchParams();
    if (options.beforeId !== undefined) {
      params.set("before_id", String(options.beforeId));
    }
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString();
    return request<ThreadEventPage>(
      "GET",
      `${sessionPath(id)}/threads/${encodeURIComponent(threadName)}/events${
        query ? `?${query}` : ""
      }`,
      { signal: options.signal },
    );
  },

  getWorkspaceDiff: (
    id: string,
    path: string,
    { stage = "all", context = 3, revision, signal }: WorkspaceDiffOptions = {},
  ) => {
    const params = new URLSearchParams({
      path,
      stage,
      context: String(context),
    });
    if (revision != null) params.set("revision", String(revision));
    return request<WorkspaceFileDiff>(
      "GET",
      `${sessionPath(id)}/workspace/diff?${params.toString()}`,
      { signal },
    );
  },

  getWorkspaceFiles: (
    id: string,
    revision: number | null,
    signal?: AbortSignal,
  ) => {
    const query = revision == null ? "" : `?revision=${revision}`;
    return request<WorkspaceFileList>(
      "GET",
      `${sessionPath(id)}/workspace/files${query}`,
      { signal },
    );
  },

  getWorkspaceFile: (
    id: string,
    path: string,
    revision: number | null,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ path });
    if (revision != null) params.set("revision", String(revision));
    return request<WorkspaceFileContent>(
      "GET",
      `${sessionPath(id)}/workspace/file?${params.toString()}`,
      { signal },
    );
  },

  /** Ask nac-web to open a local workspace path with the OS default handler. */
  openWorkspacePath: (id: string, path: string) =>
    request<OpenWorkspacePathResult>(
      "POST",
      `${sessionPath(id)}/workspace/open`,
      { body: { path } },
    ),

  getWorkspaceRevisions: (id: string, signal?: AbortSignal) =>
    request<WorkspaceRevision[]>(
      "GET",
      `${sessionPath(id)}/workspace/revisions`,
      { signal },
    ),

  getWorkspaceRevisionChanges: (
    id: string,
    revision: number,
    signal?: AbortSignal,
  ) =>
    request<WorkspaceRevisionChanges>(
      "GET",
      `${sessionPath(id)}/workspace/revisions/${revision}/changes`,
      { signal },
    ),

  getBranches: (id: string, signal?: AbortSignal) =>
    request<BranchList>("GET", `${sessionPath(id)}/workspace/branches`, {
      signal,
    }),

  switchBranch: (id: string, body: SwitchBranchRequest) =>
    request<BranchList>("POST", `${sessionPath(id)}/workspace/branches`, {
      body,
    }),

  commitWorkspace: (id: string, body: CommitWorkspaceRequest) =>
    request<CommitOutcome>("POST", `${sessionPath(id)}/workspace/commit`, {
      body,
    }),

  generateOverview: (id: string) =>
    request<{ session_id: string; summary: string }>(
      "POST",
      `${sessionPath(id)}/overview`,
    ),

  submitRun: (id: string, prompt: string) =>
    request<SubmitPromptResponse>("POST", `${sessionPath(id)}/runs`, {
      body: { prompt },
    }),

  cancelActiveRun: (id: string) =>
    request<void>("POST", `${sessionPath(id)}/cancel-active-run`),

  compactSession: (id: string) =>
    request<CompactSessionResponse>("POST", `${sessionPath(id)}/compact`),

  revertSession: (id: string, messageIdx: number) =>
    request<RevertSessionResponse>("POST", `${sessionPath(id)}/revert`, {
      body: { message_idx: messageIdx },
    }),

  regenerateRun: (id: string, messageIdx: number) =>
    request<SubmitPromptResponse>("POST", `${sessionPath(id)}/regenerate`, {
      body: { message_idx: messageIdx },
    }),

  steerOrchestrator: (id: string, instruction: string) =>
    request<OrchestratorSteeringResponse>("POST", `${sessionPath(id)}/steering`, {
      body: { instruction },
    }),

  steerThread: (id: string, threadName: string, instruction: string) =>
    request<ThreadSteeringResponse>(
      "POST",
      `${sessionPath(id)}/threads/${encodeURIComponent(threadName)}/steering`,
      { body: { instruction } },
    ),

  getRecentEvents: (
    id: string,
    options: { afterSequenceId?: number; limit?: number; signal?: AbortSignal } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.afterSequenceId !== undefined) {
      params.set("after_sequence_id", String(options.afterSequenceId));
    }
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString();
    return request<RecentEventsResponse>(
      "GET",
      `${sessionPath(id)}/events${query ? `?${query}` : ""}`,
      { signal: options.signal },
    );
  },

  eventStreamUrl: (id: string) => `${sessionPath(id)}/events/stream`,
};
