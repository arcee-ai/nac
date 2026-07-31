// Thin typed client over the nac-server REST API.
//
// Requests are always same-origin: in production nac-web serves this bundle
// itself, and in development the Vite proxy forwards the API routes to it.

import type {
  BranchList,
  CompactSessionResponse,
  CreateSessionRequest,
  LaunchModelDefaults,
  LaunchModelDefaultsRequest,
  ManagedSessionSummary,
  MessagesPageResponse,
  OrchestratorSteeringResponse,
  RawSessionConfig,
  RecentEventsResponse,
  ReorderSessionsRequest,
  ReorderSessionsResponse,
  SessionSnapshotResponse,
  SessionSummarySnapshot,
  StoreInfo,
  SubmitPromptResponse,
  SwitchBranchRequest,
  ThreadEventPage,
  ThreadSteeringResponse,
  UpdateConfigRequest,
  UpdateSessionPresentationRequest,
  WorkspaceDiffStage,
  WorkspaceFileContent,
  WorkspaceFileDiff,
  WorkspaceFileList,
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

  listSessions: (workspaceStats = false, signal?: AbortSignal) =>
    request<ManagedSessionSummary[]>(
      "GET",
      workspaceStats ? "/sessions?workspace_stats=true" : "/sessions",
      { signal },
    ),

  getSession: (id: string, signal?: AbortSignal) =>
    request<SessionSnapshotResponse>("GET", sessionPath(id), { signal }),

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
    { stage = "all", context = 3, signal }: WorkspaceDiffOptions = {},
  ) => {
    const params = new URLSearchParams({
      path,
      stage,
      context: String(context),
    });
    return request<WorkspaceFileDiff>(
      "GET",
      `${sessionPath(id)}/workspace/diff?${params.toString()}`,
      { signal },
    );
  },

  getWorkspaceFiles: (id: string, signal?: AbortSignal) =>
    request<WorkspaceFileList>("GET", `${sessionPath(id)}/workspace/files`, {
      signal,
    }),

  getWorkspaceFile: (id: string, path: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ path });
    return request<WorkspaceFileContent>(
      "GET",
      `${sessionPath(id)}/workspace/file?${params.toString()}`,
      { signal },
    );
  },

  getBranches: (id: string, signal?: AbortSignal) =>
    request<BranchList>("GET", `${sessionPath(id)}/workspace/branches`, {
      signal,
    }),

  switchBranch: (id: string, body: SwitchBranchRequest) =>
    request<BranchList>("POST", `${sessionPath(id)}/workspace/branches`, {
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
