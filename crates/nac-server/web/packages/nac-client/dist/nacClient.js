export const NAC_HTTP_CLIENT_VERSION = 1;
export class NacClientConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = "NacClientConfigurationError";
    }
}
export class ApiError extends Error {
    status;
    method;
    path;
    requestId;
    constructor(status, method, path, detail, requestId) {
        super(detail ? `${detail} (HTTP ${status})` : `HTTP ${status}`);
        this.name = "ApiError";
        this.status = status;
        this.method = method;
        this.path = path;
        this.requestId = requestId;
    }
}
export class NacVersionMismatchError extends Error {
    expected;
    actual;
    constructor(expected, actual, detail) {
        super(detail);
        this.name = "NacVersionMismatchError";
        this.expected = expected;
        this.actual = actual;
    }
}
export class UncertainCommandAdmissionError extends Error {
    requestId;
    cause;
    constructor(requestId, cause) {
        super(`NAC may have accepted this command, but the response was lost. Do not retry until the session snapshot is refreshed (request ${requestId}).`);
        this.name = "UncertainCommandAdmissionError";
        this.requestId = requestId;
        this.cause = cause;
    }
}
let fallbackRequestSequence = 0;
function defaultRequestId() {
    if (typeof globalThis.crypto?.randomUUID === "function")
        return globalThis.crypto.randomUUID();
    fallbackRequestSequence += 1;
    return `nac-web-${Date.now()}-${fallbackRequestSequence}`;
}
function normalizedEndpoint(endpoint) {
    if (endpoint === undefined || endpoint === "")
        return "";
    const raw = endpoint instanceof URL ? endpoint.toString() : endpoint;
    if (/^https?:\/\//i.test(raw)) {
        const parsed = new URL(raw);
        if (parsed.search || parsed.hash) {
            throw new NacClientConfigurationError("The NAC endpoint cannot contain a query or fragment.");
        }
        return parsed.toString().replace(/\/$/, "");
    }
    if (!raw.startsWith("/")) {
        throw new NacClientConfigurationError("The NAC endpoint must be an HTTP(S) URL or an absolute same-origin path.");
    }
    return raw.replace(/\/$/, "");
}
function isAbsoluteEndpoint(endpoint) {
    return /^https?:\/\//i.test(endpoint);
}
async function errorDetail(response) {
    try {
        const text = await response.text();
        if (!text)
            return response.statusText;
        try {
            const parsed = JSON.parse(text);
            if (Object(parsed) === parsed && !Array.isArray(parsed)) {
                const record = parsed;
                for (const key of ["error", "detail", "title"]) {
                    if (typeof record[key] === "string")
                        return record[key];
                }
            }
        }
        catch {
            // A non-JSON body is still useful error detail.
        }
        return text;
    }
    catch {
        return response.statusText;
    }
}
export class NacTransport {
    endpoint;
    credentials;
    authorization;
    versionPolicy;
    headerSource;
    nextRequestId;
    fetchImplementation;
    constructor(options = {}) {
        this.endpoint = normalizedEndpoint(options.endpoint);
        if (isAbsoluteEndpoint(this.endpoint) && options.credentials === undefined) {
            throw new NacClientConfigurationError("An absolute NAC endpoint requires an explicit credential policy.");
        }
        this.credentials = options.credentials ?? "same-origin";
        this.authorization = options.authorization;
        this.versionPolicy = options.version;
        this.headerSource = options.headers;
        this.nextRequestId = options.requestId ?? defaultRequestId;
        this.fetchImplementation = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    }
    url(path) {
        if (!path.startsWith("/")) {
            throw new NacClientConfigurationError(`NAC API paths must start with '/': ${path}`);
        }
        return this.endpoint ? `${this.endpoint}${path}` : path;
    }
    eventSourceInit() {
        if (this.authorization?.kind === "bearer") {
            throw new NacClientConfigurationError("Native EventSource cannot send bearer authorization; use cookie credentials or an auth-capable stream adapter.");
        }
        if (this.headerSource !== undefined) {
            throw new NacClientConfigurationError("Native EventSource cannot send launch headers; use an auth-capable stream adapter.");
        }
        return { withCredentials: this.credentials === "include" };
    }
    newRequestId() {
        return this.nextRequestId();
    }
    async configuredHeaders(requestId, headers) {
        const baseHeaders = typeof this.headerSource === "function" ? await this.headerSource() : this.headerSource;
        const requestHeaders = new Headers(baseHeaders);
        new Headers(headers).forEach((value, key) => requestHeaders.set(key, value));
        if (this.authorization?.kind === "bearer") {
            requestHeaders.set("Authorization", `Bearer ${this.authorization.token}`);
        }
        requestHeaders.set("X-NAC-Request-ID", requestId);
        return requestHeaders;
    }
    async streamContext() {
        const requestId = this.newRequestId();
        const headers = await this.configuredHeaders(requestId);
        return {
            credentials: this.credentials,
            headers: Object.fromEntries(headers.entries()),
            requestId,
        };
    }
    async request(method, path, { body, headers, signal, acceptStatuses = [], requestId = this.newRequestId(), } = {}) {
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
        if (response.status === 204)
            return undefined;
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
            const text = await response.text();
            return (text ? text : undefined);
        }
        return (await response.json());
    }
    async admit(method, path, options = {}) {
        const requestId = options.requestId ?? this.newRequestId();
        if (options.signal?.aborted)
            return { status: "not-sent", requestId, reason: "aborted" };
        try {
            return {
                status: "accepted",
                requestId,
                response: await this.request(method, path, { ...options, requestId }),
            };
        }
        catch (error) {
            if (error instanceof ApiError)
                throw error;
            return { status: "uncertain", requestId, error };
        }
    }
}
function sessionPath(sessionId) {
    return `/sessions/${encodeURIComponent(sessionId)}`;
}
function compareCursor(left, right) {
    if (left.epoch_id !== right.epoch_id)
        return null;
    return left.sequence_id - right.sequence_id;
}
export class NacClient {
    transport;
    constructor(options = {}) {
        this.transport = new NacTransport(options);
    }
    getUiConfiguration(signal) {
        return this.transport.request("GET", "/ui-config", { signal });
    }
    getReadiness(signal) {
        return this.transport.request("GET", "/readyz", {
            signal,
            acceptStatuses: [503],
        });
    }
    async checkCompatibility(signal) {
        const actual = await this.getReadiness(signal);
        const expected = this.transport.versionPolicy;
        if (!expected)
            return actual;
        if (actual.product_version !== expected.productVersion) {
            throw new NacVersionMismatchError(expected, actual, `NAC ${actual.product_version} is incompatible with client target ${expected.productVersion}.`);
        }
        if (expected.sourceRevision && actual.source_revision !== expected.sourceRevision) {
            throw new NacVersionMismatchError(expected, actual, `NAC revision ${actual.source_revision} does not match tested revision ${expected.sourceRevision}.`);
        }
        return actual;
    }
    getSession(sessionId, options = {}) {
        const params = new URLSearchParams();
        if (options.messageLimit !== undefined)
            params.set("message_limit", String(options.messageLimit));
        if (options.threadEventLimit !== undefined) {
            params.set("thread_event_limit", String(options.threadEventLimit));
        }
        if (options.includeSessions !== undefined) {
            params.set("include_sessions", String(options.includeSessions));
        }
        if (options.includeSystem)
            params.set("include_system", "true");
        const query = params.toString();
        return this.transport.request("GET", `${sessionPath(sessionId)}${query ? `?${query}` : ""}`, { signal: options.signal });
    }
    getRecentEvents(sessionId, options = {}) {
        const params = new URLSearchParams();
        if (options.cursor) {
            params.set("after_epoch_id", options.cursor.epoch_id);
            params.set("after_sequence_id", String(options.cursor.sequence_id));
        }
        if (options.limit !== undefined)
            params.set("limit", String(options.limit));
        const query = params.toString();
        return this.transport.request("GET", `${sessionPath(sessionId)}/events${query ? `?${query}` : ""}`, { signal: options.signal });
    }
    async replaySessionEvents(sessionId, after, options = {}) {
        const pageSize = Math.max(1, options.pageSize ?? 128);
        const maxPages = Math.max(1, options.maxPages ?? 8);
        const maxEvents = Math.max(1, options.maxEvents ?? 1024);
        const events = [];
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
    async captureSessionSnapshot(sessionId, snapshotOptions = {}, replayOptions = {}) {
        const baseline = (await this.getRecentEvents(sessionId, {
            limit: 0,
            signal: snapshotOptions.signal,
        })).boundary;
        const snapshot = await this.getSession(sessionId, snapshotOptions);
        const replay = await this.replaySessionEvents(sessionId, baseline, {
            ...replayOptions,
            signal: replayOptions.signal ?? snapshotOptions.signal,
        });
        return { snapshot, baseline, replay };
    }
    submitPrompt(sessionId, prompt, signal) {
        return this.transport.admit("POST", `${sessionPath(sessionId)}/runs`, {
            body: { prompt },
            signal,
        });
    }
}
export function createNacClient(options = {}) {
    return new NacClient(options);
}
export const nacClient = createNacClient();
