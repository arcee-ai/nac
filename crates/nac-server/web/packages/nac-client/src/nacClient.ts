import type {
  UiConfiguration,
  ReadinessResponse,
  RecentEventsResponse,
  SessionEventBoundary,
  SessionEventEnvelope,
  SessionSnapshotResponse,
  SubmitPromptResponse,
  ShellCommandRequest,
  ShellCommandSnapshot,
  ShellOutputPage,
} from "./types.js";

export const NAC_HTTP_CLIENT_VERSION = 1 as const;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type NacCredentialPolicy = "same-origin" | "include" | "omit";

export interface NacVersionPolicy {
  productVersion: string;
  sourceRevision?: string;
}

export interface NacClientOptions {
  /** Empty means the current document origin. A non-empty value may include a path prefix. */
  endpoint?: string | URL;
  /** Required for an absolute endpoint so cross-origin credential behavior is never implicit. */
  credentials?: NacCredentialPolicy;
  authorization?: { kind: "bearer"; token: string } | { kind: "none" };
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  requestId?: () => string;
  fetch?: typeof globalThis.fetch;
  version?: NacVersionPolicy;
}

export interface NacRequestOptions {
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  acceptStatuses?: readonly number[];
  requestId?: string;
}

export interface NacStreamContext {
  credentials: NacCredentialPolicy;
  headers: Readonly<Record<string, string>>;
  requestId: string;
}

export class NacClientConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NacClientConfigurationError";
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly requestId: string;

  constructor(status: number, method: string, path: string, detail: string, requestId: string) {
    super(detail ? `${detail} (HTTP ${status})` : `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.requestId = requestId;
  }
}

export class NacVersionMismatchError extends Error {
  readonly expected: NacVersionPolicy;
  readonly actual: ReadinessResponse;

  constructor(expected: NacVersionPolicy, actual: ReadinessResponse, detail: string) {
    super(detail);
    this.name = "NacVersionMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class UncertainCommandAdmissionError extends Error {
  readonly requestId: string;
  override readonly cause: unknown;

  constructor(requestId: string, cause: unknown) {
    super(
      `NAC may have accepted this command, but the response was lost. Do not retry until the session snapshot is refreshed (request ${requestId}).`,
    );
    this.name = "UncertainCommandAdmissionError";
    this.requestId = requestId;
    this.cause = cause;
  }
}

export type CommandAdmission<T> =
  | { status: "accepted"; requestId: string; response: T }
  | { status: "not-sent"; requestId: string; reason: "aborted" }
  | { status: "uncertain"; requestId: string; error: unknown };

export interface SessionSnapshotOptions {
  messageLimit?: number;
  threadEventLimit?: number;
  includeSessions?: boolean;
  includeSystem?: boolean;
  signal?: AbortSignal;
}

export interface SessionReplayOptions {
  pageSize?: number;
  maxPages?: number;
  maxEvents?: number;
  signal?: AbortSignal;
}

export type SessionReplayResult =
  | {
      status: "complete";
      cursor: SessionEventBoundary;
      events: SessionEventEnvelope[];
      duplicates: number;
    }
  | {
      status: "gap";
      cursor: SessionEventBoundary;
      boundary: SessionEventBoundary;
      events: SessionEventEnvelope[];
      duplicates: number;
      missing: { from: number; to: number } | "epoch-changed";
    }
  | {
      status: "backpressure";
      cursor: SessionEventBoundary;
      boundary: SessionEventBoundary;
      events: SessionEventEnvelope[];
      duplicates: number;
    };

export interface CapturedSessionSnapshot {
  snapshot: SessionSnapshotResponse;
  baseline: SessionEventBoundary;
  replay: SessionReplayResult;
}

let fallbackRequestSequence = 0;

function defaultRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  fallbackRequestSequence += 1;
  return `nac-web-${Date.now()}-${fallbackRequestSequence}`;
}

function normalizedEndpoint(endpoint: string | URL | undefined): string {
  if (endpoint === undefined || endpoint === "") return "";
  const raw = endpoint instanceof URL ? endpoint.toString() : endpoint;
  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    if (parsed.search || parsed.hash) {
      throw new NacClientConfigurationError("The NAC endpoint cannot contain a query or fragment.");
    }
    return parsed.toString().replace(/\/$/, "");
  }
  if (!raw.startsWith("/")) {
    throw new NacClientConfigurationError(
      "The NAC endpoint must be an HTTP(S) URL or an absolute same-origin path.",
    );
  }
  return raw.replace(/\/$/, "");
}

function isAbsoluteEndpoint(endpoint: string): boolean {
  return /^https?:\/\//i.test(endpoint);
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return response.statusText;
    try {
      const parsed: unknown = JSON.parse(text);
      if (Object(parsed) === parsed && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        for (const key of ["error", "detail", "title"] as const) {
          if (typeof record[key] === "string") return record[key];
        }
      }
    } catch {
      // A non-JSON body is still useful error detail.
    }
    return text;
  } catch {
    return response.statusText;
  }
}

export class NacTransport {
  readonly endpoint: string;
  readonly credentials: NacCredentialPolicy;
  readonly authorization: NacClientOptions["authorization"];
  readonly versionPolicy: NacVersionPolicy | undefined;
  private readonly headerSource: NacClientOptions["headers"];
  private readonly nextRequestId: () => string;
  private readonly fetchImplementation: typeof globalThis.fetch;

  constructor(options: NacClientOptions = {}) {
    this.endpoint = normalizedEndpoint(options.endpoint);
    if (isAbsoluteEndpoint(this.endpoint) && options.credentials === undefined) {
      throw new NacClientConfigurationError(
        "An absolute NAC endpoint requires an explicit credential policy.",
      );
    }
    this.credentials = options.credentials ?? "same-origin";
    this.authorization = options.authorization;
    this.versionPolicy = options.version;
    this.headerSource = options.headers;
    this.nextRequestId = options.requestId ?? defaultRequestId;
    this.fetchImplementation = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  url(path: string): string {
    if (!path.startsWith("/")) {
      throw new NacClientConfigurationError(`NAC API paths must start with '/': ${path}`);
    }
    return this.endpoint ? `${this.endpoint}${path}` : path;
  }

  eventSourceInit(): EventSourceInit {
    if (this.authorization?.kind === "bearer") {
      throw new NacClientConfigurationError(
        "Native EventSource cannot send bearer authorization; use cookie credentials or an auth-capable stream adapter.",
      );
    }
    if (this.headerSource !== undefined) {
      throw new NacClientConfigurationError(
        "Native EventSource cannot send launch headers; use an auth-capable stream adapter.",
      );
    }
    return { withCredentials: this.credentials === "include" };
  }

  newRequestId(): string {
    return this.nextRequestId();
  }

  private async configuredHeaders(requestId: string, headers?: HeadersInit): Promise<Headers> {
    const baseHeaders =
      typeof this.headerSource === "function" ? await this.headerSource() : this.headerSource;
    const requestHeaders = new Headers(baseHeaders);
    new Headers(headers).forEach((value, key) => requestHeaders.set(key, value));
    if (this.authorization?.kind === "bearer") {
      requestHeaders.set("Authorization", `Bearer ${this.authorization.token}`);
    }
    requestHeaders.set("X-NAC-Request-ID", requestId);
    return requestHeaders;
  }

  async streamContext(): Promise<NacStreamContext> {
    const requestId = this.newRequestId();
    const headers = await this.configuredHeaders(requestId);
    return {
      credentials: this.credentials,
      headers: Object.fromEntries(headers.entries()),
      requestId,
    };
  }

  async request<T>(
    method: Method,
    path: string,
    {
      body,
      headers,
      signal,
      acceptStatuses = [],
      requestId = this.newRequestId(),
    }: NacRequestOptions = {},
  ): Promise<T> {
    const requestHeaders = await this.configuredHeaders(requestId, headers);
    if (body !== undefined && !requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }

    const response = await this.fetchImplementation(this.url(path), {
      method,
      headers: Object.fromEntries(requestHeaders.entries()),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: this.credentials,
    });

    if (!response.ok && !acceptStatuses.includes(response.status)) {
      throw new ApiError(response.status, method, path, await errorDetail(response), requestId);
    }
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      return (text ? text : undefined) as T;
    }
    return (await response.json()) as T;
  }

  async admit<T>(
    method: Extract<Method, "POST" | "PUT" | "PATCH" | "DELETE">,
    path: string,
    options: NacRequestOptions = {},
  ): Promise<CommandAdmission<T>> {
    const requestId = options.requestId ?? this.newRequestId();
    if (options.signal?.aborted) return { status: "not-sent", requestId, reason: "aborted" };
    try {
      return {
        status: "accepted",
        requestId,
        response: await this.request<T>(method, path, { ...options, requestId }),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return { status: "uncertain", requestId, error };
    }
  }
}

function sessionPath(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}`;
}

function compareCursor(left: SessionEventBoundary, right: SessionEventBoundary): number | null {
  if (left.epoch_id !== right.epoch_id) return null;
  return left.sequence_id - right.sequence_id;
}

export class NacClient {
  readonly transport: NacTransport;

  constructor(options: NacClientOptions = {}) {
    this.transport = new NacTransport(options);
  }

  getUiConfiguration(signal?: AbortSignal): Promise<UiConfiguration> {
    return this.transport.request<UiConfiguration>("GET", "/ui-config", { signal });
  }

  getReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
    return this.transport.request<ReadinessResponse>("GET", "/readyz", {
      signal,
      acceptStatuses: [503],
    });
  }

  async checkCompatibility(signal?: AbortSignal): Promise<ReadinessResponse> {
    const actual = await this.getReadiness(signal);
    const expected = this.transport.versionPolicy;
    if (!expected) return actual;
    if (actual.product_version !== expected.productVersion) {
      throw new NacVersionMismatchError(
        expected,
        actual,
        `NAC ${actual.product_version} is incompatible with client target ${expected.productVersion}.`,
      );
    }
    if (expected.sourceRevision && actual.source_revision !== expected.sourceRevision) {
      throw new NacVersionMismatchError(
        expected,
        actual,
        `NAC revision ${actual.source_revision} does not match tested revision ${expected.sourceRevision}.`,
      );
    }
    return actual;
  }

  getSession(
    sessionId: string,
    options: SessionSnapshotOptions = {},
  ): Promise<SessionSnapshotResponse> {
    const params = new URLSearchParams();
    if (options.messageLimit !== undefined)
      params.set("message_limit", String(options.messageLimit));
    if (options.threadEventLimit !== undefined) {
      params.set("thread_event_limit", String(options.threadEventLimit));
    }
    if (options.includeSessions !== undefined) {
      params.set("include_sessions", String(options.includeSessions));
    }
    if (options.includeSystem) params.set("include_system", "true");
    const query = params.toString();
    return this.transport.request<SessionSnapshotResponse>(
      "GET",
      `${sessionPath(sessionId)}${query ? `?${query}` : ""}`,
      { signal: options.signal },
    );
  }

  getRecentEvents(
    sessionId: string,
    options: { cursor?: SessionEventBoundary; limit?: number; signal?: AbortSignal } = {},
  ): Promise<RecentEventsResponse> {
    const params = new URLSearchParams();
    if (options.cursor) {
      params.set("after_epoch_id", options.cursor.epoch_id);
      params.set("after_sequence_id", String(options.cursor.sequence_id));
    }
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString();
    return this.transport.request<RecentEventsResponse>(
      "GET",
      `${sessionPath(sessionId)}/events${query ? `?${query}` : ""}`,
      { signal: options.signal },
    );
  }

  async replaySessionEvents(
    sessionId: string,
    after: SessionEventBoundary,
    options: SessionReplayOptions = {},
  ): Promise<SessionReplayResult> {
    const pageSize = Math.max(1, options.pageSize ?? 128);
    const maxPages = Math.max(1, options.maxPages ?? 8);
    const maxEvents = Math.max(1, options.maxEvents ?? 1024);
    const events: SessionEventEnvelope[] = [];
    let duplicates = 0;
    let cursor = after;
    let boundary = after;

    for (let page = 0; page < maxPages && events.length < maxEvents; page += 1) {
      const response = await this.getRecentEvents(sessionId, {
        cursor,
        limit: Math.min(pageSize, maxEvents - events.length),
        signal: options.signal,
      });
      boundary = response.boundary;
      if (boundary.epoch_id !== cursor.epoch_id) {
        return {
          status: "gap",
          cursor,
          boundary,
          events,
          duplicates,
          missing: "epoch-changed",
        };
      }
      for (const event of response.events) {
        const comparison = compareCursor(event, cursor);
        if (comparison === null) {
          return {
            status: "gap",
            cursor,
            boundary,
            events,
            duplicates,
            missing: "epoch-changed",
          };
        }
        if (comparison <= 0) {
          duplicates += 1;
          continue;
        }
        if (event.sequence_id !== cursor.sequence_id + 1) {
          return {
            status: "gap",
            cursor,
            boundary,
            events,
            duplicates,
            missing: { from: cursor.sequence_id + 1, to: event.sequence_id - 1 },
          };
        }
        events.push(event);
        cursor = { epoch_id: event.epoch_id, sequence_id: event.sequence_id };
      }
      if (cursor.sequence_id >= boundary.sequence_id) {
        return { status: "complete", cursor, events, duplicates };
      }
      if (response.events.length === 0) {
        return {
          status: "gap",
          cursor,
          boundary,
          events,
          duplicates,
          missing: { from: cursor.sequence_id + 1, to: boundary.sequence_id },
        };
      }
    }
    return { status: "backpressure", cursor, boundary, events, duplicates };
  }

  async captureSessionSnapshot(
    sessionId: string,
    snapshotOptions: SessionSnapshotOptions = {},
    replayOptions: SessionReplayOptions = {},
  ): Promise<CapturedSessionSnapshot> {
    const baseline = (
      await this.getRecentEvents(sessionId, {
        limit: 0,
        signal: snapshotOptions.signal,
      })
    ).boundary;
    const snapshot = await this.getSession(sessionId, snapshotOptions);
    const replay = await this.replaySessionEvents(sessionId, baseline, {
      ...replayOptions,
      signal: replayOptions.signal ?? snapshotOptions.signal,
    });
    return { snapshot, baseline, replay };
  }

  async submitShellCommand(
    sessionId: string,
    request: ShellCommandRequest,
    signal?: AbortSignal,
  ): Promise<ShellCommandSnapshot> {
    const admission = await this.transport.admit<ShellCommandSnapshot>(
      "POST",
      `${sessionPath(sessionId)}/user-commands`,
      {
        body: request,
        requestId: request.request_id,
        signal,
      },
    );
    if (admission.status === "accepted") return admission.response;
    if (admission.status === "not-sent")
      throw new DOMException("Command was not sent", "AbortError");
    // A lost admission response never triggers another submission. Read the
    // same durable identity once; failure leaves the outcome explicitly unknown.
    try {
      return await this.getShellCommand(sessionId, request.request_id, signal);
    } catch {
      throw new UncertainCommandAdmissionError(request.request_id, admission.error);
    }
  }

  getShellCommand(sessionId: string, requestId: string, signal?: AbortSignal) {
    return this.transport.request<ShellCommandSnapshot>(
      "GET",
      `${sessionPath(sessionId)}/user-commands/${encodeURIComponent(requestId)}`,
      { signal },
    );
  }

  cancelShellCommand(sessionId: string, requestId: string, signal?: AbortSignal) {
    return this.transport.request<ShellCommandSnapshot>(
      "POST",
      `${sessionPath(sessionId)}/user-commands/${encodeURIComponent(requestId)}/cancel`,
      { signal },
    );
  }

  getShellOutput(sessionId: string, requestId: string, offset = 0, signal?: AbortSignal) {
    return this.transport.request<ShellOutputPage>(
      "GET",
      `${sessionPath(sessionId)}/user-commands/${encodeURIComponent(requestId)}/output?offset=${offset}`,
      { signal },
    );
  }

  submitPrompt(sessionId: string, prompt: string, signal?: AbortSignal) {
    return this.transport.admit<SubmitPromptResponse>("POST", `${sessionPath(sessionId)}/runs`, {
      body: { prompt },
      signal,
    });
  }
}

export function createNacClient(options: NacClientOptions = {}): NacClient {
  return new NacClient(options);
}

export const nacClient = createNacClient();
