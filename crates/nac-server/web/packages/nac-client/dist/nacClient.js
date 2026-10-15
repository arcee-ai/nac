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
/** Trusted transport adapter assertion that no request was dispatched. Never infer from a name or network error. */
export class NacRequestNotSentError extends Error {
    constructor(cause) {
        super("The native request was not dispatched.", { cause });
        this.name = "NacRequestNotSentError";
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
    get jsonResponseDecodingVersion() {
        return 1;
    }
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
    async request(method, path, { body, headers, signal, acceptStatuses = [], requestId = this.newRequestId(), decodeJson, } = {}) {
        signal?.throwIfAborted();
        const requestHeaders = await this.configuredHeaders(requestId, headers);
        signal?.throwIfAborted();
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
        try {
            if (!response.ok && !acceptStatuses.includes(response.status)) {
                throw new ApiError(response.status, method, path, await errorDetail(response), requestId);
            }
            if (response.status === 204) {
                if (decodeJson)
                    throw new Error("Expected a JSON response for the selected codec.");
                return undefined;
            }
            const contentType = response.headers.get("content-type") ?? "";
            if (!contentType.includes("application/json")) {
                if (decodeJson)
                    throw new Error("Expected a JSON response for the selected codec.");
                const text = await response.text();
                return (text ? text : undefined);
            }
            if (decodeJson)
                return decodeJson(await response.text());
            return (await response.json());
        }
        catch (error) {
            // Once a response exists, even a mistakenly thrown before-send marker
            // cannot turn decoding/body failures into a retryable command fate.
            if (error instanceof NacRequestNotSentError) {
                throw new Error("NAC response processing failed after dispatch.", { cause: error });
            }
            throw error;
        }
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
            if (error instanceof NacRequestNotSentError) {
                return { status: "not-sent", requestId, reason: "adapter-not-sent", error };
            }
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
        this.transport = "request" in options ? options : new NacTransport(options);
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
    async submitShellCommand(sessionId, request, signal) {
        const frozen = Object.freeze({ ...request });
        const admission = await this.transport
            .admit("POST", `${sessionPath(sessionId)}/user-commands`, {
            body: frozen,
            requestId: frozen.request_id,
            signal,
        })
            .catch((error) => {
            // Human admission can return 5xx after committing its immutable intent.
            // Treat that response as unconfirmed and use the same one-shot readback
            // as a lost response. Definite 4xx rejection remains unchanged.
            if (error instanceof ApiError && error.status >= 500 && error.status < 600)
                return { status: "uncertain", requestId: frozen.request_id, error };
            throw error;
        });
        if (admission.status === "accepted" && admission.response.request_id === frozen.request_id)
            return admission.response;
        if (admission.status === "not-sent")
            throw admission.reason === "adapter-not-sent"
                ? admission.error
                : new DOMException("Command was not sent", "AbortError");
        const cause = admission.status === "uncertain"
            ? admission.error
            : new Error("Human command response changed request identity");
        // Canonical command text may be redacted. Request identity, never masked
        // display text, binds readback to the immutable submitted intent.
        // A lost admission response triggers one lookup, never another submission.
        try {
            return await this.getShellCommand(sessionId, frozen.request_id, signal);
        }
        catch {
            throw new UncertainCommandAdmissionError(frozen.request_id, cause);
        }
    }
    async getShellCommand(sessionId, requestId, signal) {
        const snapshot = await this.transport.request("GET", `${sessionPath(sessionId)}/user-commands/${encodeURIComponent(requestId)}`, { signal });
        if (snapshot.request_id !== requestId)
            throw new Error("Human command lookup changed request identity");
        return snapshot;
    }
    cancelShellCommand(sessionId, requestId, signal) {
        return this.transport.request("POST", `${sessionPath(sessionId)}/user-commands/${encodeURIComponent(requestId)}/cancel`, { signal });
    }
    getShellOutput(sessionId, requestId, offset = 0, signal) {
        return this.transport.request("GET", `${sessionPath(sessionId)}/user-commands/${encodeURIComponent(requestId)}/output?offset=${offset}`, { signal });
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
