import type { UiConfiguration, ReadinessResponse, RecentEventsResponse, SessionEventBoundary, SessionEventEnvelope, SessionSnapshotResponse } from "./types.js";
export declare const NAC_HTTP_CLIENT_VERSION: 1;
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
    authorization?: {
        kind: "bearer";
        token: string;
    } | {
        kind: "none";
    };
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
export declare class NacClientConfigurationError extends Error {
    constructor(message: string);
}
export declare class ApiError extends Error {
    readonly status: number;
    readonly method: string;
    readonly path: string;
    readonly requestId: string;
    constructor(status: number, method: string, path: string, detail: string, requestId: string);
}
export declare class NacVersionMismatchError extends Error {
    readonly expected: NacVersionPolicy;
    readonly actual: ReadinessResponse;
    constructor(expected: NacVersionPolicy, actual: ReadinessResponse, detail: string);
}
export declare class UncertainCommandAdmissionError extends Error {
    readonly requestId: string;
    readonly cause: unknown;
    constructor(requestId: string, cause: unknown);
}
export type CommandAdmission<T> = {
    status: "accepted";
    requestId: string;
    response: T;
} | {
    status: "not-sent";
    requestId: string;
    reason: "aborted";
} | {
    status: "uncertain";
    requestId: string;
    error: unknown;
};
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
export type SessionReplayResult = {
    status: "complete";
    cursor: SessionEventBoundary;
    events: SessionEventEnvelope[];
    duplicates: number;
} | {
    status: "gap";
    cursor: SessionEventBoundary;
    boundary: SessionEventBoundary;
    events: SessionEventEnvelope[];
    duplicates: number;
    missing: {
        from: number;
        to: number;
    } | "epoch-changed";
} | {
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
export declare class NacTransport {
    readonly endpoint: string;
    readonly credentials: NacCredentialPolicy;
    readonly authorization: NacClientOptions["authorization"];
    readonly versionPolicy: NacVersionPolicy | undefined;
    private readonly headerSource;
    private readonly nextRequestId;
    private readonly fetchImplementation;
    constructor(options?: NacClientOptions);
    url(path: string): string;
    eventSourceInit(): EventSourceInit;
    newRequestId(): string;
    private configuredHeaders;
    streamContext(): Promise<NacStreamContext>;
    request<T>(method: Method, path: string, { body, headers, signal, acceptStatuses, requestId, }?: NacRequestOptions): Promise<T>;
    admit<T>(method: Extract<Method, "POST" | "PUT" | "PATCH" | "DELETE">, path: string, options?: NacRequestOptions): Promise<CommandAdmission<T>>;
}
export declare class NacClient {
    readonly transport: NacTransport;
    constructor(options?: NacClientOptions);
    getUiConfiguration(signal?: AbortSignal): Promise<UiConfiguration>;
    getReadiness(signal?: AbortSignal): Promise<ReadinessResponse>;
    checkCompatibility(signal?: AbortSignal): Promise<ReadinessResponse>;
    getSession(sessionId: string, options?: SessionSnapshotOptions): Promise<SessionSnapshotResponse>;
    getRecentEvents(sessionId: string, options?: {
        cursor?: SessionEventBoundary;
        limit?: number;
        signal?: AbortSignal;
    }): Promise<RecentEventsResponse>;
    replaySessionEvents(sessionId: string, after: SessionEventBoundary, options?: SessionReplayOptions): Promise<SessionReplayResult>;
    captureSessionSnapshot(sessionId: string, snapshotOptions?: SessionSnapshotOptions, replayOptions?: SessionReplayOptions): Promise<CapturedSessionSnapshot>;
    submitPrompt(sessionId: string, prompt: string, signal?: AbortSignal): Promise<CommandAdmission<{
        client_id?: string | null;
        display_prompt: string;
        run_id: string;
    }>>;
}
export declare function createNacClient(options?: NacClientOptions): NacClient;
export declare const nacClient: NacClient;
export {};
