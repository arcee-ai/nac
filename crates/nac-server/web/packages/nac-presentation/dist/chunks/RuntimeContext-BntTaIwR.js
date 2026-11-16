import { n as e } from "./rolldown-runtime-QGRDbDUS.js";
import { S as t, T as n, _ as r, c as i, g as a, s as o, v as s, x as c, y as l } from "./PresentationBoundary-DgJz1GXw.js";
import { createContext as u, useCallback as d, useContext as f, useMemo as p, useSyncExternalStore as m } from "react";
import { QueryClient as h, hashKey as g } from "@tanstack/react-query";
// src/app/features/product-context/navigation.ts
var _ = class {
	resolve;
	closed;
	inspect;
	adapter;
	version = 0;
	constructor(e, t, n) {
		this.resolve = e, this.closed = t, this.inspect = n;
	}
	connect(e) {
		return this.adapter = e, this.version++, () => {
			this.adapter === e && (this.adapter = void 0, this.version++);
		};
	}
	close() {
		this.adapter = void 0, this.version++;
	}
	async openNotificationSessionTarget(e, t, n) {
		let r = this.adapter;
		if (this.closed() || t.aborted || !r?.openNotificationSessionTarget || !this.inspect) return "stale";
		if (!n()) return "deferred";
		let i = ++this.version, a = r.currentSession(), o = await this.inspect(e.session_id, t);
		return this.closed() || t.aborted || this.version !== i || this.adapter !== r || r.currentSession() !== a ? "stale" : o.session?.session_id === e.session_id ? n() ? (r.openNotificationSessionTarget(e.session_id), "opened") : "deferred" : "unavailable";
	}
	async open(e) {
		if (this.closed()) throw Error("Product runtime is closed.");
		let t = this.adapter, n = ++this.version, r = t?.currentSession(), i = e.session_id ?? null;
		if (t && i !== r) throw Error("Product destination belongs to another session.");
		let a = await this.resolve(e), o = () => {
			if (this.closed() || this.version !== n || this.adapter !== t || t && t.currentSession() !== r) throw Error("Product view changed; inspect capabilities again.");
		};
		if (o(), a.build.build_id !== e.expected_build_id || (a.session_id ?? null) !== i || a.target.destination !== e.destination) throw Error("Product destination binding changed.");
		if (!t || a.target.availability !== "available" || !this.inspect) return {
			...a,
			opened: !1
		};
		let s = await this.inspect(i);
		if (o(), s.build.build_id !== e.expected_build_id || (s.session?.session_id ?? null) !== i || !s.destinations.some((t) => t.destination === e.destination && t.availability === "available")) throw Error("Product destination binding changed.");
		let c = t.open(a);
		return {
			...a,
			opened: c
		};
	}
}, v = class extends Error {
	constructor(e) {
		super(e), this.name = "NacClientConfigurationError";
	}
}, y = class extends Error {
	status;
	method;
	path;
	requestId;
	constructor(e, t, n, r, i) {
		super(r ? `${r} (HTTP ${e})` : `HTTP ${e}`), this.name = "ApiError", this.status = e, this.method = t, this.path = n, this.requestId = i;
	}
}, b = class extends Error {
	expected;
	actual;
	constructor(e, t, n) {
		super(n), this.name = "NacVersionMismatchError", this.expected = e, this.actual = t;
	}
}, x = class extends Error {
	requestId;
	cause;
	constructor(e, t) {
		super(`NAC may have accepted this command, but the response was lost. Do not retry until the session snapshot is refreshed (request ${e}).`), this.name = "UncertainCommandAdmissionError", this.requestId = e, this.cause = t;
	}
}, S = 0;
function C() {
	return typeof globalThis.crypto?.randomUUID == "function" ? globalThis.crypto.randomUUID() : (S += 1, `nac-web-${Date.now()}-${S}`);
}
function w(e) {
	if (e === void 0 || e === "") return "";
	let t = e instanceof URL ? e.toString() : e;
	if (/^https?:\/\//i.test(t)) {
		let e = new URL(t);
		if (e.search || e.hash) throw new v("The NAC endpoint cannot contain a query or fragment.");
		return e.toString().replace(/\/$/, "");
	}
	if (!t.startsWith("/")) throw new v("The NAC endpoint must be an HTTP(S) URL or an absolute same-origin path.");
	return t.replace(/\/$/, "");
}
function T(e) {
	return /^https?:\/\//i.test(e);
}
async function E(e) {
	try {
		let t = await e.text();
		if (!t) return e.statusText;
		try {
			let e = JSON.parse(t);
			if (Object(e) === e && !Array.isArray(e)) {
				let t = e;
				for (let e of [
					"error",
					"detail",
					"title"
				]) if (typeof t[e] == "string") return t[e];
			}
		} catch {}
		return t;
	} catch {
		return e.statusText;
	}
}
var D = class {
	endpoint;
	credentials;
	authorization;
	versionPolicy;
	headerSource;
	nextRequestId;
	fetchImplementation;
	constructor(e = {}) {
		if (this.endpoint = w(e.endpoint), T(this.endpoint) && e.credentials === void 0) throw new v("An absolute NAC endpoint requires an explicit credential policy.");
		this.credentials = e.credentials ?? "same-origin", this.authorization = e.authorization, this.versionPolicy = e.version, this.headerSource = e.headers, this.nextRequestId = e.requestId ?? C, this.fetchImplementation = e.fetch ?? ((e, t) => globalThis.fetch(e, t));
	}
	url(e) {
		if (!e.startsWith("/")) throw new v(`NAC API paths must start with '/': ${e}`);
		return this.endpoint ? `${this.endpoint}${e}` : e;
	}
	eventSourceInit() {
		if (this.authorization?.kind === "bearer") throw new v("Native EventSource cannot send bearer authorization; use cookie credentials or an auth-capable stream adapter.");
		if (this.headerSource !== void 0) throw new v("Native EventSource cannot send launch headers; use an auth-capable stream adapter.");
		return { withCredentials: this.credentials === "include" };
	}
	newRequestId() {
		return this.nextRequestId();
	}
	async configuredHeaders(e, t) {
		let n = typeof this.headerSource == "function" ? await this.headerSource() : this.headerSource, r = new Headers(n);
		return new Headers(t).forEach((e, t) => r.set(t, e)), this.authorization?.kind === "bearer" && r.set("Authorization", `Bearer ${this.authorization.token}`), r.set("X-NAC-Request-ID", e), r;
	}
	async streamContext() {
		let e = this.newRequestId(), t = await this.configuredHeaders(e);
		return {
			credentials: this.credentials,
			headers: Object.fromEntries(t.entries()),
			requestId: e
		};
	}
	async request(e, t, { body: n, headers: r, signal: i, acceptStatuses: a = [], requestId: o = this.newRequestId() } = {}) {
		i?.throwIfAborted();
		let s = await this.configuredHeaders(o, r);
		i?.throwIfAborted(), n !== void 0 && !s.has("Content-Type") && s.set("Content-Type", "application/json");
		let c = await this.fetchImplementation(this.url(t), {
			method: e,
			headers: Object.fromEntries(s.entries()),
			body: n === void 0 ? void 0 : JSON.stringify(n),
			signal: i,
			credentials: this.credentials
		});
		if (!c.ok && !a.includes(c.status)) throw new y(c.status, e, t, await E(c), o);
		if (c.status !== 204) return (c.headers.get("content-type") ?? "").includes("application/json") ? await c.json() : await c.text() || void 0;
	}
	async admit(e, t, n = {}) {
		let r = n.requestId ?? this.newRequestId();
		if (n.signal?.aborted) return {
			status: "not-sent",
			requestId: r,
			reason: "aborted"
		};
		try {
			return {
				status: "accepted",
				requestId: r,
				response: await this.request(e, t, {
					...n,
					requestId: r
				})
			};
		} catch (e) {
			if (e instanceof y) throw e;
			return {
				status: "uncertain",
				requestId: r,
				error: e
			};
		}
	}
};
function O(e) {
	return `/sessions/${encodeURIComponent(e)}`;
}
function k(e, t) {
	return e.epoch_id === t.epoch_id ? e.sequence_id - t.sequence_id : null;
}
var A = class {
	transport;
	constructor(e = {}) {
		this.transport = "request" in e ? e : new D(e);
	}
	getUiConfiguration(e) {
		return this.transport.request("GET", "/ui-config", { signal: e });
	}
	getReadiness(e) {
		return this.transport.request("GET", "/readyz", {
			signal: e,
			acceptStatuses: [503]
		});
	}
	async checkCompatibility(e) {
		let t = await this.getReadiness(e), n = this.transport.versionPolicy;
		if (!n) return t;
		if (t.product_version !== n.productVersion) throw new b(n, t, `NAC ${t.product_version} is incompatible with client target ${n.productVersion}.`);
		if (n.sourceRevision && t.source_revision !== n.sourceRevision) throw new b(n, t, `NAC revision ${t.source_revision} does not match tested revision ${n.sourceRevision}.`);
		return t;
	}
	getSession(e, t = {}) {
		let n = new URLSearchParams();
		t.messageLimit !== void 0 && n.set("message_limit", String(t.messageLimit)), t.threadEventLimit !== void 0 && n.set("thread_event_limit", String(t.threadEventLimit)), t.includeSessions !== void 0 && n.set("include_sessions", String(t.includeSessions)), t.includeSystem && n.set("include_system", "true");
		let r = n.toString();
		return this.transport.request("GET", `${O(e)}${r ? `?${r}` : ""}`, { signal: t.signal });
	}
	getRecentEvents(e, t = {}) {
		let n = new URLSearchParams();
		t.cursor && (n.set("after_epoch_id", t.cursor.epoch_id), n.set("after_sequence_id", String(t.cursor.sequence_id))), t.limit !== void 0 && n.set("limit", String(t.limit));
		let r = n.toString();
		return this.transport.request("GET", `${O(e)}/events${r ? `?${r}` : ""}`, { signal: t.signal });
	}
	async replaySessionEvents(e, t, n = {}) {
		let r = Math.max(1, n.pageSize ?? 128), i = Math.max(1, n.maxPages ?? 8), a = Math.max(1, n.maxEvents ?? 1024), o = [], s = 0, c = t, l = t;
		for (let t = 0; t < i && o.length < a; t += 1) {
			let t = await this.getRecentEvents(e, {
				cursor: c,
				limit: Math.min(r, a - o.length),
				signal: n.signal
			});
			if (l = t.boundary, l.epoch_id !== c.epoch_id) return {
				status: "gap",
				cursor: c,
				boundary: l,
				events: o,
				duplicates: s,
				missing: "epoch-changed"
			};
			for (let e of t.events) {
				let t = k(e, c);
				if (t === null) return {
					status: "gap",
					cursor: c,
					boundary: l,
					events: o,
					duplicates: s,
					missing: "epoch-changed"
				};
				if (t <= 0) s += 1;
				else {
					if (e.sequence_id !== c.sequence_id + 1) return {
						status: "gap",
						cursor: c,
						boundary: l,
						events: o,
						duplicates: s,
						missing: {
							from: c.sequence_id + 1,
							to: e.sequence_id - 1
						}
					};
					o.push(e), c = {
						epoch_id: e.epoch_id,
						sequence_id: e.sequence_id
					};
				}
			}
			if (c.sequence_id >= l.sequence_id) return {
				status: "complete",
				cursor: c,
				events: o,
				duplicates: s
			};
			if (t.events.length === 0) return {
				status: "gap",
				cursor: c,
				boundary: l,
				events: o,
				duplicates: s,
				missing: {
					from: c.sequence_id + 1,
					to: l.sequence_id
				}
			};
		}
		return {
			status: "backpressure",
			cursor: c,
			boundary: l,
			events: o,
			duplicates: s
		};
	}
	async captureSessionSnapshot(e, t = {}, n = {}) {
		let r = (await this.getRecentEvents(e, {
			limit: 0,
			signal: t.signal
		})).boundary;
		return {
			snapshot: await this.getSession(e, t),
			baseline: r,
			replay: await this.replaySessionEvents(e, r, {
				...n,
				signal: n.signal ?? t.signal
			})
		};
	}
	async submitShellCommand(e, t, n) {
		let r = Object.freeze({ ...t }), i = await this.transport.admit("POST", `${O(e)}/user-commands`, {
			body: r,
			requestId: r.request_id,
			signal: n
		}).catch((e) => {
			if (e instanceof y && e.status >= 500 && e.status < 600) return {
				status: "uncertain",
				requestId: r.request_id,
				error: e
			};
			throw e;
		});
		if (i.status === "accepted" && i.response.request_id === r.request_id) return i.response;
		if (i.status === "not-sent") throw new DOMException("Command was not sent", "AbortError");
		let a = i.status === "uncertain" ? i.error : /* @__PURE__ */ Error("Human command response changed request identity");
		try {
			return await this.getShellCommand(e, r.request_id, n);
		} catch {
			throw new x(r.request_id, a);
		}
	}
	async getShellCommand(e, t, n) {
		let r = await this.transport.request("GET", `${O(e)}/user-commands/${encodeURIComponent(t)}`, { signal: n });
		if (r.request_id !== t) throw Error("Human command lookup changed request identity");
		return r;
	}
	cancelShellCommand(e, t, n) {
		return this.transport.request("POST", `${O(e)}/user-commands/${encodeURIComponent(t)}/cancel`, { signal: n });
	}
	getShellOutput(e, t, n = 0, r) {
		return this.transport.request("GET", `${O(e)}/user-commands/${encodeURIComponent(t)}/output?offset=${n}`, { signal: r });
	}
	submitPrompt(e, t, n) {
		return this.transport.admit("POST", `${O(e)}/runs`, {
			body: { prompt: t },
			signal: n
		});
	}
};
function j(e = {}) {
	return new A(e);
}
var M = j(), N = 65536, P = 16384, F = 18446744073709551615n, I = class extends Error {
	constructor(e) {
		super(e), this.name = "TerminalProtocolError";
	}
}, L = class extends Error {
	cause;
	constructor(e, t) {
		super(e), this.name = "TerminalInputRejectedError", this.cause = t;
	}
}, R = class extends Error {
	cause;
	constructor(e) {
		super("Terminal input delivery is unconfirmed. These bytes must not be retried automatically."), this.name = "TerminalInputUncertainError", this.cause = e;
	}
};
function ee(e) {
	if (e !== 1) throw new I("Unsupported terminal protocol version");
}
function z(e) {
	if (e.length > 20 || !/^(0|[1-9][0-9]*)$/.test(e)) throw new I("Invalid terminal cursor");
	let t = BigInt(e);
	if (t > F) throw new I("Terminal cursor exceeds u64");
	return t;
}
function B(e, t, n, r) {
	if (!Number.isInteger(e) || e < t || e > n) throw new I(`Invalid ${r}`);
}
function V(e) {
	e.throwIfAborted();
}
async function te(e, t) {
	V(t);
	let n = () => {};
	try {
		await Promise.race([e, new Promise((e, r) => {
			n = () => r(t.reason), t.addEventListener("abort", n, { once: !0 }), t.aborted && n();
		})]), V(t);
	} finally {
		t.removeEventListener("abort", n);
	}
}
var ne = class {
	api;
	sessionId;
	terminalId;
	renderer;
	pageLimit;
	waitMs;
	lifetime = new AbortController();
	observer;
	cleanupReceipts = /* @__PURE__ */ new Set();
	acknowledgement;
	expectedOffset = "0";
	reading = !1;
	attaching = !1;
	needsReset = !1;
	sendingInput = !1;
	inputUncertain = !1;
	inputSender;
	constructor(e, t, n, r, i = {}) {
		this.api = e, this.sessionId = t, this.terminalId = n, this.renderer = r, this.inputSender = e.inputUserTerminal, this.pageLimit = i.pageLimit ?? N, this.waitMs = i.waitMs ?? 1e3, B(this.pageLimit, 1, N, "terminal page limit"), B(this.waitMs, 0, 1e3, "terminal wait");
	}
	get observerId() {
		return this.observer;
	}
	get isInputUncertain() {
		return this.inputUncertain;
	}
	signal(e) {
		return e ? AbortSignal.any([this.lifetime.signal, e]) : this.lifetime.signal;
	}
	status(e) {
		if (ee(e.protocol_version), e.terminal_id !== this.terminalId) throw new I("Terminal identity changed");
	}
	async attach(e, t = "attach") {
		if (this.observer || this.attaching || this.reading) throw new I("Observer already active");
		this.attaching = !0, this.lifetime.signal.aborted && (this.lifetime = new AbortController());
		let n = this.signal(e);
		try {
			V(n), await this.cleanupObservers(), await te(this.renderer.reset(t, n), n);
			let e = await this.api.attachUserTerminal(this.sessionId, this.terminalId, {
				protocol_version: 1,
				page_limit: this.pageLimit
			}, n);
			if (typeof e.observer_id == "string" && e.observer_id && (this.observer = e.observer_id), V(n), ee(e.protocol_version), this.status(e.terminal), typeof e.observer_id != "string" || !e.observer_id) throw new I("Missing terminal observer identity");
			return this.observer = e.observer_id, this.acknowledgement = void 0, this.expectedOffset = "0", this.needsReset = !1, e.terminal;
		} catch (e) {
			throw await this.detach().catch(() => {}), e;
		} finally {
			this.attaching = !1;
		}
	}
	async reconnect(e) {
		return await this.detach(e), this.attach(e, "reconnect");
	}
	validate(e, t) {
		if (ee(e.protocol_version), this.status(e.terminal), e.observer_id !== t) throw new I("Observer identity changed");
		let n = z(e.offset), r = z(e.next_offset), i = z(e.retained_start), a = z(e.retained_end), o = z(this.expectedOffset);
		if (i > a || r > a || e.bytes.length > this.pageLimit || e.bytes.some((e) => !Number.isInteger(e) || e < 0 || e > 255)) throw new I("Invalid terminal frame bounds or continuity");
		if (e.gap) {
			if (e.bytes.length !== 0 || !e.requires_ack || r !== i || n !== i || o >= i) throw new I("Invalid terminal gap frame");
		} else if (n !== o || n < i || r !== n + BigInt(e.bytes.length) || e.requires_ack !== e.bytes.length > 0) throw new I("Invalid terminal byte frame");
		if (e.caught_up !== (r === a)) throw new I("Invalid terminal completion cursor");
	}
	async readNext(e) {
		let t = this.observer;
		if (!t || this.reading || this.needsReset) throw new I("Observer unavailable; reconnect before replay");
		this.reading = !0;
		let n = this.signal(e);
		try {
			V(n);
			let e = await this.api.pullUserTerminal(this.sessionId, this.terminalId, t, {
				protocol_version: 1,
				acknowledge_offset: this.acknowledgement?.offset,
				acknowledge_reset: this.acknowledgement?.reset ?? !1,
				wait_ms: this.waitMs
			}, n);
			V(n), this.validate(e, t);
			try {
				e.gap ? await te(this.renderer.reset("gap", n), n) : e.bytes.length && await te(this.renderer.write(Uint8Array.from(e.bytes), n), n);
			} catch (e) {
				throw this.needsReset = !0, e;
			}
			return V(n), e.requires_ack && (this.acknowledgement = {
				offset: e.next_offset,
				reset: e.gap
			}, this.expectedOffset = e.next_offset), e;
		} finally {
			this.reading = !1;
		}
	}
	async run(e, t) {
		for (;;) {
			let n = await this.readNext(e);
			if (t?.(n), n.terminal.output_complete && n.caught_up && !n.requires_ack) return n.terminal;
		}
	}
	async detach(e) {
		this.observer && this.cleanupReceipts.add(this.observer), this.observer = void 0, this.lifetime.abort(new DOMException("Terminal observation detached", "AbortError")), await this.cleanupObservers(e);
	}
	async cleanupObservers(e) {
		for (let t of this.cleanupReceipts) await this.api.detachUserTerminal(this.sessionId, this.terminalId, t, e), this.cleanupReceipts.delete(t);
	}
	replaceInputTransport(e) {
		this.inputSender = e;
	}
	async input(e, t) {
		if (B(e.length, 1, P, "terminal input length"), this.inputUncertain) throw new R(void 0);
		if (this.sendingInput) throw new I("Terminal input already in flight; input was not queued");
		let n = this.signal(t);
		V(n), this.sendingInput = !0;
		try {
			await this.inputSender(this.sessionId, this.terminalId, {
				protocol_version: 1,
				bytes: Array.from(e)
			}, n);
		} catch (e) {
			throw e instanceof L ? e : (this.inputUncertain = !0, new R(e));
		} finally {
			this.sendingInput = !1;
		}
	}
	acknowledgeInputUncertainty() {
		if (this.sendingInput) throw new I("Wait for the active input receipt before acknowledging");
		this.inputUncertain = !1;
	}
	async resize(e, t, n) {
		B(e, 2, 500, "terminal columns"), B(t, 1, 300, "terminal rows");
		let r = this.signal(n);
		V(r), await this.api.resizeUserTerminal(this.sessionId, this.terminalId, {
			protocol_version: 1,
			cols: e,
			rows: t
		}, r);
	}
};
// packages/nac-client/src/terminalControlApi.ts
function re(e) {
	let t = e.transport.request.bind(e.transport), n = (e, t) => `/sessions/${encodeURIComponent(e)}/executions/${encodeURIComponent(t)}`;
	return {
		getTerminalInputControl: (e, r, i) => t("GET", `${n(e, r)}/input-control`, { signal: i }),
		transferTerminalInputControl: (e, r, i, a) => t("POST", `${n(e, r)}/input-control`, {
			body: i,
			signal: a
		}),
		inputControlledTerminal: (e, r, i, a) => t("POST", `${n(e, r)}/input`, {
			body: i,
			signal: a
		})
	};
}
function ie(e, t) {
	if (!/^[1-9][0-9]*$/.test(t) || BigInt(t) > 18446744073709551615n) throw new I("Invalid terminal controller revision");
	return async (n, r, i, a) => {
		try {
			let o = await e.inputControlledTerminal(n, r, {
				...i,
				expected_revision: t
			}, a);
			if (o.outcome === "written") return;
			throw o.outcome === "rejected" ? new L(o.error ?? "Terminal input was not written") : new R(o.error);
		} catch (e) {
			throw e instanceof y && [
				400,
				401,
				403,
				404,
				409,
				413
			].includes(e.status) ? new L("Terminal input was rejected before admission", e) : e;
		}
	};
}
// packages/nac-client/src/executionApi.ts
function ae(e) {
	let t = e.transport.request.bind(e.transport), n = (e, t) => `/sessions/${encodeURIComponent(e)}/executions${t ? `/${encodeURIComponent(t)}` : ""}`, r = (e, t, r) => `${n(e, t)}/observers/${encodeURIComponent(r)}`;
	return {
		listExecutions: (e, r) => t("GET", n(e), { signal: r }),
		listExecutionHistory: (e, r) => t("GET", `${n(e)}/history`, { signal: r }),
		attachExecution: (e, r, i, a) => t("POST", `${n(e, r)}/observers`, {
			body: i,
			signal: a
		}),
		pullExecution: (e, n, i, a, o) => t("POST", `${r(e, n, i)}/read`, {
			body: a,
			signal: o
		}),
		detachExecution: (e, n, i, a) => t("DELETE", r(e, n, i), { signal: a }),
		stopExecution: (e, r) => t("POST", `${n(e, r)}/stop`)
	};
}
function oe(e, t, n, r, i = {}, a) {
	let o = () => Promise.reject(new L("This execution is read-only")), s = se(e, n, a, i.readonly);
	return new ne({
		attachUserTerminal: e.attachExecution,
		pullUserTerminal: e.pullExecution,
		detachUserTerminal: e.detachExecution,
		inputUserTerminal: s,
		resizeUserTerminal: !i.readonly && n.origin === "human" && n.resize ? e.resizeUserTerminal : o
	}, t, n.id, r, i);
}
function se(e, t, n, r = !1) {
	let i = () => Promise.reject(new L("This execution is read-only")), a = !r && t.origin === "human" && t.input ? e.inputUserTerminal : i;
	return n !== void 0 && !r && (a = i, t.representation === "pty" && t.backend === "local" && (t.origin === "human" || t.origin === "agent" && t.retained) && n && n.controller === "human" && !n.frozen && e.inputControlledTerminal && (a = ie({ inputControlledTerminal: e.inputControlledTerminal }, n.revision))), a;
}
// packages/nac-client/src/userTerminalApi.ts
var H = (e, t) => `/sessions/${encodeURIComponent(e)}/user-terminals${t === void 0 ? "" : `/${encodeURIComponent(t)}`}`, ce = (e, t, n) => `${H(e, t)}/observers/${encodeURIComponent(n)}`;
function le(e) {
	let t = e.transport.request.bind(e.transport);
	return {
		submitUserTerminalSelection: async (e, n, r, i) => {
			let a = await t("POST", `${H(e, n)}/selection-submissions`, {
				body: r,
				signal: i
			});
			if (a.protocol_version !== 1 || a.admission_id !== r.admission_id.toLowerCase() || a.accepted_intent.protocol_version !== 1 || a.accepted_intent.source_kind !== "user_supplied_rendered_selection" || a.accepted_intent.admission_id !== r.admission_id.toLowerCase() || a.accepted_intent.owner_instance_id !== r.expected_owner_instance_id.toLowerCase() || a.accepted_intent.source_session_id !== e || a.accepted_intent.terminal_id !== n || a.accepted_intent.capture_id !== r.capture_id.toLowerCase() || a.accepted_intent.client_capture_time_ms !== (r.client_capture_time_ms?.replace(/^0+(?=\d)/, "") ?? null) || a.accepted_intent.text !== r.expected_selection_text || a.accepted_intent.user_text !== (r.expected_user_text ?? null) || a.accepted_intent.initial_delivery !== r.delivery || a.accepted_intent.initial_expected_run_id !== (r.expected_run_id?.toLowerCase() ?? null)) throw new I("Terminal selection admission identity/intent changed");
			return a;
		},
		previewUserTerminalSelection: async (e, n, r, i) => {
			let a = await t("POST", `${H(e, n)}/selection-preview`, {
				body: r,
				signal: i
			});
			if (a.protocol_version !== 1 || a.source_kind !== "user_supplied_rendered_selection" || a.source_session_id !== e || a.terminal_id !== n || a.capture_id !== r.capture_id.toLowerCase() || a.truncated !== !1) throw new I("Terminal selection preview identity/version changed");
			return a;
		},
		openUserTerminal: (e, n, r) => t("POST", H(e), {
			body: n,
			signal: r
		}),
		listUserTerminals: (e, n) => t("GET", H(e), { signal: n }),
		getUserTerminal: (e, n, r) => t("GET", H(e, n), { signal: r }),
		attachUserTerminal: (e, n, r, i) => t("POST", `${H(e, n)}/observers`, {
			body: r,
			signal: i
		}),
		pullUserTerminal: (e, n, r, i, a) => t("POST", `${ce(e, n, r)}/read`, {
			body: i,
			signal: a
		}),
		detachUserTerminal: (e, n, r, i) => t("DELETE", ce(e, n, r), { signal: i }),
		inputUserTerminal: (e, n, r, i) => t("POST", `${H(e, n)}/input`, {
			body: r,
			signal: i
		}),
		resizeUserTerminal: (e, n, r, i) => t("POST", `${H(e, n)}/resize`, {
			body: r,
			signal: i
		})
	};
}
// packages/nac-client/src/api.ts
var U = (e) => `/sessions/${encodeURIComponent(e)}`;
function ue(e, t = {}) {
	let n = t.productContextBinding == null ? void 0 : { "X-NAC-Presentation-Incarnation": t.productContextBinding };
	async function r(t, n, { body: r, headers: i, signal: a } = {}) {
		return e.transport.request(t, n, {
			body: r,
			headers: i,
			signal: a
		});
	}
	return {
		getProductContext: (e = null, t) => r("GET", `/product-context${e == null ? "" : `?session_id=${encodeURIComponent(e)}`}`, {
			signal: t,
			headers: n
		}),
		resolveProductDestination: (e, t) => r("POST", "/product-destinations/resolve", {
			body: e,
			signal: t,
			headers: n
		}),
		...le(e),
		...ae(e),
		...re(e),
		submitShellCommand: (t, n, r) => e.submitShellCommand(t, n, r),
		getShellCommand: (t, n, r) => e.getShellCommand(t, n, r),
		cancelShellCommand: (t, n, r) => e.cancelShellCommand(t, n, r),
		getShellOutput: (t, n, r = 0, i) => e.getShellOutput(t, n, r, i),
		health: (e) => r("GET", "/health", { signal: e }),
		getStore: (e) => r("GET", "/store", { signal: e }),
		getManagedStatus: (e) => r("GET", "/managed/status", { signal: e }),
		getManagedGitIdentity: (e) => r("GET", "/managed/github/git-identity", { signal: e }),
		updateManagedGitIdentity: (e) => r("PUT", "/managed/github/git-identity", { body: e }),
		getManagedGitHub: (e) => r("GET", "/managed/github", { signal: e }),
		startManagedGitHubLogin: () => r("POST", "/managed/github/login"),
		pollManagedGitHubLogin: (e, t) => r("GET", `/managed/github/login/${encodeURIComponent(e)}`, { signal: t }),
		cancelManagedGitHubLogin: (e) => r("DELETE", `/managed/github/login/${encodeURIComponent(e)}`),
		disconnectManagedGitHub: () => r("DELETE", "/managed/github"),
		listManagedGitHubRepositories: (e) => r("GET", "/managed/github/repositories", { signal: e }),
		listManagedGitHubBranches: (e, t, n) => r("GET", `/managed/github/repositories/${encodeURIComponent(e)}/${encodeURIComponent(t)}/branches`, { signal: n }),
		startManagedClone: (e) => r("POST", "/managed/github/clone-operations", { body: e }),
		getManagedClone: (e, t) => r("GET", `/managed/github/clone-operations/${encodeURIComponent(e)}`, { signal: t }),
		cancelManagedClone: (e) => r("DELETE", `/managed/github/clone-operations/${encodeURIComponent(e)}`),
		terminateTerminal: (e, t) => r("DELETE", `${U(e)}/terminals/${encodeURIComponent(t)}`),
		listManagedSecrets: (e) => r("GET", "/managed/secrets", { signal: e }),
		putManagedSecret: (e, t) => r("PUT", `/managed/secrets/${encodeURIComponent(e)}`, { body: { value: t } }),
		deleteManagedSecret: (e) => r("DELETE", `/managed/secrets/${encodeURIComponent(e)}`),
		getSandboxAvailability: (e) => r("GET", "/sandbox/availability", { signal: e }),
		getSandboxActivity: (e, t) => r("GET", `/sandbox/activity?${new URLSearchParams({ key: e })}`, { signal: t }),
		listCredentials: (e) => r("GET", "/credentials", { signal: e }),
		storeCredential: (e, t) => r("PUT", `/credentials/${encodeURIComponent(e)}`, { body: { value: t } }),
		storeGeneratedCredential: (e) => r("POST", "/credentials", { body: { value: e } }),
		deleteCredential: (e) => r("DELETE", `/credentials/${encodeURIComponent(e)}`),
		listManagedAuth: (e) => r("GET", "/auth", { signal: e }),
		startManagedLogin: (e) => r("POST", `/auth/${encodeURIComponent(e)}/login`),
		pollManagedLogin: (e, t, n) => r("GET", `/auth/${encodeURIComponent(e)}/login/${encodeURIComponent(t)}`, { signal: n }),
		cancelManagedLogin: (e, t) => r("DELETE", `/auth/${encodeURIComponent(e)}/login/${encodeURIComponent(t)}`),
		managedLogout: (e) => r("DELETE", `/auth/${encodeURIComponent(e)}`),
		browsePath: (e, t = "directory", n = !1, i) => {
			let a = new URLSearchParams({ kind: t });
			return e && a.set("path", e), n && a.set("hidden", "true"), r("GET", `/fs/browse?${a.toString()}`, { signal: i });
		},
		browseSshPath: (e, t, n = !1, i) => r("POST", "/ssh/browse", {
			body: {
				...e,
				path: t,
				hidden: n
			},
			signal: i
		}),
		listProviderModels: (e, t) => r("POST", "/providers/models", {
			body: e,
			signal: t
		}),
		getModelCatalog: (e) => r("GET", "/models", { signal: e }),
		listCommands: (e) => r("GET", "/commands", { signal: e }),
		listSessionCommands: (e, t) => r("GET", `/sessions/${encodeURIComponent(e)}/commands`, { signal: t }),
		listSessionSkills: (e, t) => r("GET", `/sessions/${encodeURIComponent(e)}/skills`, { signal: t }),
		listModelConfigs: (e) => r("GET", "/model-configs", { signal: e }),
		createModelConfig: (e) => r("POST", "/model-configs", { body: e }),
		updateModelConfig: (e, t) => r("PATCH", `/model-configs/${encodeURIComponent(e)}`, { body: t }),
		deleteModelConfig: (e) => r("DELETE", `/model-configs/${encodeURIComponent(e)}`),
		listSshConfigs: (e) => r("GET", "/ssh-configs", { signal: e }),
		createSshConfig: (e) => r("POST", "/ssh-configs", { body: e }),
		updateSshConfig: (e, t) => r("PATCH", `/ssh-configs/${encodeURIComponent(e)}`, { body: t }),
		deleteSshConfig: (e) => r("DELETE", `/ssh-configs/${encodeURIComponent(e)}`),
		getMcpLibrary: (e) => r("GET", "/mcp_library/library", { signal: e }),
		listMcpServers: (e) => r("GET", "/mcp_library/servers", { signal: e }),
		createMcpServer: (e) => r("POST", "/mcp_library/servers", { body: e }),
		updateMcpServer: (e, t) => r("PATCH", `/mcp_library/servers/${encodeURIComponent(e)}`, { body: t }),
		deleteMcpServer: (e) => r("DELETE", `/mcp_library/servers/${encodeURIComponent(e)}`),
		testMcpServer: (e) => r("POST", "/mcp_library/servers/test", { body: e }),
		getMcpOAuthStatus: (e, t) => r("GET", `/mcp_library/servers/${encodeURIComponent(e)}/oauth/status`, { signal: t }),
		configureMcpOAuth: (e, t) => r("POST", `/mcp_library/servers/${encodeURIComponent(e)}/oauth/configure`, { body: t }),
		authenticateMcpOAuth: (e, t = {}) => r("POST", `/mcp_library/servers/${encodeURIComponent(e)}/oauth/authenticate`, { body: t }),
		logoutMcpOAuth: (e) => r("POST", `/mcp_library/servers/${encodeURIComponent(e)}/oauth/logout`),
		listMcpRuntimeStatus: (e) => r("GET", "/mcp_library/servers/status", { signal: e }),
		connectMcpServer: (e) => r("POST", `/mcp_library/servers/${encodeURIComponent(e)}/connect`),
		disconnectMcpServer: (e) => r("POST", `/mcp_library/servers/${encodeURIComponent(e)}/disconnect`),
		reloadMcpServer: (e) => r("POST", `/mcp_library/servers/${encodeURIComponent(e)}/reload`),
		resolveModelConfig: (e, t) => r("POST", `/model-configs/${encodeURIComponent(e)}/models`, { signal: t }),
		resolveConfigFile: (e, t) => r("POST", "/model-configs/from-file", {
			body: { path: e },
			signal: t
		}),
		listProjects: (e) => r("GET", "/projects", { signal: e }),
		createProject: (e) => r("POST", "/projects", { body: e }),
		updateProject: (e, t) => r("PATCH", `/projects/${encodeURIComponent(e)}`, { body: t }),
		deleteProject: (e, t = "keep") => r("DELETE", `/projects/${encodeURIComponent(e)}?sessions=${t}`),
		assignSessionToProject: (e, t) => r("POST", `/projects/${encodeURIComponent(e)}/sessions`, { body: t }),
		reorderProjects: (e) => r("PUT", "/projects/order", { body: e }),
		listSessions: (e = {}, t) => {
			let n = new URLSearchParams();
			return e.workspaceStats && n.set("workspace_stats", "true"), e.projectId && n.set("project_id", e.projectId), r("GET", `/sessions${n.size > 0 ? `?${n.toString()}` : ""}`, { signal: t });
		},
		getSession: (t, n = {}) => e.getSession(t, n),
		createSession: (e) => r("POST", "/sessions", { body: e }),
		deleteSession: (e) => r("DELETE", U(e)),
		launchDefaults: (e, t) => r("POST", "/sessions/launch-defaults", {
			body: e,
			signal: t
		}),
		updatePresentation: (e, t) => r("PUT", `${U(e)}/presentation`, { body: t }),
		reorderSessions: (e) => r("PUT", "/sessions/order", { body: e }),
		getConfig: (e, t) => r("GET", `${U(e)}/config`, { signal: t }),
		getPermissions: (e, t) => r("GET", `${U(e)}/permissions`, { signal: t }),
		replyPermission: (e, t, n) => r("POST", `${U(e)}/permissions/${encodeURIComponent(t)}`, { body: { reply: n } }),
		authorizePermissionReviewRetry: (e, t) => r("POST", `${U(e)}/permissions/reviews/${encodeURIComponent(t)}/authorize-retry`),
		authorizeChildPermissionReviewRetry: (e, t, n) => r("POST", `${U(e)}/children/${encodeURIComponent(t)}/permissions/reviews/${encodeURIComponent(n)}/authorize-retry`),
		setPermissionApprovalMode: (e, t) => r("PUT", `${U(e)}/permissions/mode`, { body: { mode: t } }),
		deletePermissionGrant: (e, t) => r("DELETE", `${U(e)}/permissions/grants/${encodeURIComponent(t)}`),
		getGoal: (e, t) => r("GET", `${U(e)}/goal`, { signal: t }),
		createGoal: (e, t) => r("POST", `${U(e)}/goal`, { body: t }),
		updateGoal: (e, t, n) => r("PATCH", `${U(e)}/goal/${encodeURIComponent(t)}`, { body: n }),
		clearGoal: (e, t, n) => r("DELETE", `${U(e)}/goal/${encodeURIComponent(t)}`, { body: { expected_version: n } }),
		listInbox: (e, t) => r("GET", `${U(e)}/inbox`, { signal: t }),
		createInboxItem: (e, t, n) => r("POST", `${U(e)}/inbox`, { body: {
			delivery: t,
			prompt: n
		} }),
		updateInboxItem: (e, t, n, i) => r("PATCH", `${U(e)}/inbox/${t}`, { body: {
			expected_version: n,
			delivery: i
		} }),
		cancelInboxItem: (e, t, n) => r("DELETE", `${U(e)}/inbox/${t}`, { body: { expected_version: n } }),
		listTraditionalChildren: (e, t) => r("GET", `${U(e)}/children`, { signal: t }),
		startTraditionalChild: (e, t) => r("POST", `${U(e)}/children`, { body: t }),
		getTraditionalChild: (e, t, n) => r("GET", `${U(e)}/children/${encodeURIComponent(t)}`, { signal: n }),
		cancelTraditionalChild: (e, t) => r("POST", `${U(e)}/children/${encodeURIComponent(t)}/cancel`),
		listManagedOrchestrators: (e, t) => r("GET", `${U(e)}/orchestrators`, { signal: t }),
		startManagedOrchestrator: (e, t) => r("POST", `${U(e)}/orchestrators`, { body: t }),
		getManagedOrchestrator: (e, t, n) => r("GET", `${U(e)}/orchestrators/${encodeURIComponent(t)}`, { signal: n }),
		cancelManagedOrchestrator: (e, t) => r("POST", `${U(e)}/orchestrators/${encodeURIComponent(t)}/cancel`),
		updateConfig: (e, t) => r("PATCH", `${U(e)}/config`, { body: t }),
		getMessages: (e, t = {}) => {
			let n = new URLSearchParams();
			t.before !== void 0 && n.set("before", String(t.before)), t.limit !== void 0 && n.set("limit", String(t.limit)), t.includeSystem && n.set("include_system", "true");
			let i = n.toString();
			return r("GET", `${U(e)}/messages${i ? `?${i}` : ""}`, { signal: t.signal });
		},
		getThreadEvents: (e, t, n = {}) => {
			let i = new URLSearchParams();
			n.beforeId !== void 0 && i.set("before_id", String(n.beforeId)), n.limit !== void 0 && i.set("limit", String(n.limit));
			let a = i.toString();
			return r("GET", `${U(e)}/threads/${encodeURIComponent(t)}/events${a ? `?${a}` : ""}`, { signal: n.signal });
		},
		getToolCallContent: (e, t, n) => r("GET", `${U(e)}/tool-calls/${encodeURIComponent(t)}`, { signal: n }),
		getWorkspaceDiff: (e, t, { stage: n = "all", context: i = 3, revision: a, signal: o } = {}) => {
			let s = new URLSearchParams({
				path: t,
				stage: n,
				context: String(i)
			});
			return a != null && s.set("revision", String(a)), r("GET", `${U(e)}/workspace/diff?${s.toString()}`, { signal: o });
		},
		getWorkspaceFiles: (e, t, n) => {
			let i = t == null ? "" : `?revision=${t}`;
			return r("GET", `${U(e)}/workspace/files${i}`, { signal: n });
		},
		getWorkspaceFile: (e, t, n, i) => {
			let a = new URLSearchParams({ path: t });
			return n != null && a.set("revision", String(n)), r("GET", `${U(e)}/workspace/file?${a.toString()}`, { signal: i });
		},
		openWorkspacePath: (e, t) => r("POST", `${U(e)}/workspace/open`, { body: { path: t } }),
		revealWorkspacePath: (e, t, n, i, a) => r("POST", `${U(e)}/workspace/reveal`, {
			body: {
				path: t,
				expected_workspace_root: n,
				expected_path_root: i
			},
			signal: a
		}),
		getWorkspaceRevisions: (e, t) => r("GET", `${U(e)}/workspace/revisions`, { signal: t }),
		getWorkspaceRevisionChanges: (e, t, n) => r("GET", `${U(e)}/workspace/revisions/${t}/changes`, { signal: n }),
		getBranches: (e, t) => r("GET", `${U(e)}/workspace/branches`, { signal: t }),
		switchBranch: (e, t) => r("POST", `${U(e)}/workspace/branches`, { body: t }),
		commitWorkspace: (e, t) => r("POST", `${U(e)}/workspace/commit`, { body: t }),
		submitRun: (t, n, r) => e.submitPrompt(t, n, r),
		cancelActiveRun: (e) => r("POST", `${U(e)}/cancel-active-run`),
		cancelExactRun: (e, t) => r("POST", `${U(e)}/runs/${encodeURIComponent(t)}/cancel`),
		compactSession: (e) => r("POST", `${U(e)}/compact`),
		revertSession: (e, t) => r("POST", `${U(e)}/revert`, { body: { message_idx: t } }),
		regenerateRun: (e, t) => r("POST", `${U(e)}/regenerate`, { body: { message_idx: t } }),
		forkSession: (e, t) => r("POST", `${U(e)}/fork`, { body: { message_idx: t } }),
		dismissSessionFork: (e, t) => r("DELETE", `${U(e)}/forks/${encodeURIComponent(t)}`),
		steerOrchestrator: (e, t) => r("POST", `${U(e)}/steering`, { body: { instruction: t } }),
		steerThread: (e, t, n) => r("POST", `${U(e)}/threads/${encodeURIComponent(t)}/steering`, { body: { instruction: n } }),
		getRecentEvents: (t, n = {}) => e.getRecentEvents(t, n)
	};
}
// src/app/services/api.ts
function de(e, t) {
	let n = e.transport.request.bind(e.transport);
	return {
		...ue(e, { productContextBinding: t }),
		taskQuestions: (e, t) => n("GET", `/sessions/${encodeURIComponent(e)}/questions`, { signal: t }),
		answerTaskQuestion: (e, t) => n("POST", `/sessions/${encodeURIComponent(e)}/questions/${encodeURIComponent(t.request_id)}/answer`, { body: t }),
		cancelTaskQuestion: (e, t, r) => n("POST", `/sessions/${encodeURIComponent(e)}/questions/${encodeURIComponent(t)}/cancel`, { body: { expected_revision: r } }),
		changeFreshTaskRetainedAllowance: (e, t) => n("POST", `/projects/${encodeURIComponent(e)}/task-schedules/retained-allowance`, { body: t }),
		freshTaskScheduleInventory: (e, t) => n("GET", `/projects/${encodeURIComponent(e)}/task-schedules`, { signal: t }),
		freshTaskScheduleInspection: (e, t, r) => n("GET", `/projects/${encodeURIComponent(e)}/task-schedules/${encodeURIComponent(t)}`, { signal: r }),
		controlFreshTaskSchedule: (e, t) => n("POST", `/projects/${encodeURIComponent(e)}/task-schedules/control`, { body: t }),
		sessionIntegrations: (e, t) => n("GET", `/sessions/${encodeURIComponent(e)}/integrations`, { signal: t }),
		refreshSessionIntegrations: (e, t) => n("POST", `/sessions/${encodeURIComponent(e)}/integrations/refresh`, { body: { expected_revision: t } }),
		heartbeatInventory: (e, t) => n("GET", `/heartbeats${e ? `?session_id=${encodeURIComponent(e)}` : ""}`, { signal: t }),
		heartbeatInspection: (e, t, r) => n("GET", `/sessions/${encodeURIComponent(e)}/heartbeats/${encodeURIComponent(t)}`, { signal: r }),
		controlHeartbeat: (e, t) => n("POST", `/sessions/${encodeURIComponent(e)}/heartbeats/control`, { body: t }),
		previewHeartbeat: (e, t, r) => n("POST", `/sessions/${encodeURIComponent(e)}/heartbeats/preview`, {
			body: t,
			signal: r
		}),
		acknowledgeHeartbeats: (e, t) => n("POST", `/sessions/${encodeURIComponent(e)}/heartbeats/attention`, { body: { through_sequence: t } }),
		startTaskLaunch: (e) => n("POST", "/task-launches", { body: e }),
		taskLaunchStatus: (e, t) => n("GET", `/task-launches/${encodeURIComponent(e)}`, { signal: t }),
		taskLaunchInventory: (e, t) => n("GET", `/projects/${encodeURIComponent(e)}/task-launches`, { signal: t }),
		taskLaunchSource: (e, t) => n("GET", `/projects/${encodeURIComponent(e)}/task-launch-source`, { signal: t }),
		cancelTaskLaunch: (e) => n("POST", `/task-launches/${encodeURIComponent(e)}/cancel`),
		getManagedUpgrade: (e) => n("GET", "/__managed/control/v0/upgrade", { signal: e }),
		startManagedUpgrade: (e) => n("POST", "/__managed/control/v0/upgrade", {
			body: {},
			headers: { "Idempotency-Key": e }
		}),
		generateOverview: (e) => n("POST", `/sessions/${encodeURIComponent(e)}/overview`)
	};
}
var fe = de(M);
// src/app/lib/primitive.ts
function pe(e) {
	return e != null && Object(e) !== e && e.constructor === String;
}
function me(e) {
	return e != null && Object(e) !== e && e.constructor === Number;
}
// src/app/lib/perfDebug.ts
var he = !1;
function ge() {
	return he;
}
function _e(e, t = {}) {}
function ve(e, t = 1e3) {
	`${e}`;
}
function ye(e, t, n = 4) {
	return t();
}
// packages/nac-client/src/eventStream.ts
var be = 500, xe = 1e4, Se = 4, Ce = 256;
function W(e) {
	try {
		return JSON.parse(e.data);
	} catch {
		return null;
	}
}
function we(e) {
	return {
		epoch_id: e.epoch_id,
		sequence_id: e.sequence_id
	};
}
function Te(e, t) {
	return t !== null && e.epoch_id === t.epoch_id && e.sequence_id <= t.sequence_id;
}
function Ee(e, t, n = {}) {
	let r = n.client ?? M, i = n.eventSource, a = i ? null : r.transport.eventSourceInit(), o = Math.max(1, n.maxPendingEvents ?? Ce), s = null, c = null, l = null, u = be, d = null, f = null, p = null, m = !1, h = !1, g = 0, _ = !1, v = 0, y = [], b = (e) => {
		m || t.onStatus?.(e);
	}, x = () => y.length > 0 ? we(y[y.length - 1]) : f, S = () => {
		c && clearTimeout(c), c = null, s?.close(), s = null;
	}, C = () => {
		m || l !== null || (b("reconnecting"), S(), l = setTimeout(() => {
			l = null, O();
		}, u), u = Math.min(u * 2, xe));
	}, w = (e) => {
		m || (e !== void 0 && t.onTransportError?.(e), g += 1, !h && g >= Se ? (b("error"), S()) : C());
	}, T = (e) => {
		t.onBackpressure?.(e), v += 1, y.length = 0, d = f ?? p, C();
	}, E = async () => {
		if (_ || m) return;
		_ = !0;
		let e = v;
		try {
			for (; !m && y.length > 0;) {
				let n = y[0];
				try {
					await t.onEnvelope(n);
				} catch (e) {
					T({
						reason: "handler-error",
						maxPendingEvents: o,
						error: e
					});
					return;
				}
				if (e !== v) return;
				y.shift(), f = we(n), d = f;
			}
		} finally {
			_ = !1, !m && y.length > 0 && E();
		}
	}, D = async () => {
		if (m) return;
		b(d === null ? "connecting" : "reconnecting");
		let l = r.transport.url(`/sessions/${encodeURIComponent(e)}/events/stream`), _ = new URLSearchParams();
		d !== null && (_.set("after_epoch_id", d.epoch_id), _.set("after_sequence_id", String(d.sequence_id)));
		let S = _.size === 0 ? l : `${l}?${_.toString()}`;
		if (i) {
			let e = await r.transport.streamContext();
			if (m) return;
			s = i(S, { withCredentials: e.credentials === "include" }, e);
		} else s = new EventSource(S, a ?? void 0);
		n.maxConnectionMs !== void 0 && (c = setTimeout(C, Math.max(1, n.maxConnectionMs)));
		let D = s, O = () => !m && s === D;
		s.onopen = () => {
			O() && (h = !0, g = 0, u = be, b("live"));
		}, s.addEventListener("session_event", (e) => {
			if (!O() || !(e instanceof MessageEvent)) return;
			let r = W(e);
			if (!r) return;
			let i = we(r), a = x();
			Te(i, a) ? t.onDuplicate?.(r) : a !== null && i.epoch_id === a.epoch_id && i.sequence_id !== a.sequence_id + 1 ? (t.onSequenceGap?.({
				epochId: i.epoch_id,
				expectedSequenceId: a.sequence_id + 1,
				receivedSequenceId: i.sequence_id
			}), v += 1, y.length = 0, d = f ?? p, C()) : y.length >= o ? T({
				reason: "queue-overflow",
				maxPendingEvents: o
			}) : (y.push(r), n.instrumentation?.onSessionEvent?.(r), E());
		}), s.addEventListener("assistant_delta", (e) => {
			if (!O() || !(e instanceof MessageEvent)) return;
			let r = W(e);
			r && (n.instrumentation?.onAssistantDelta?.(r), t.onAssistantDelta?.(r));
		}), s.addEventListener("replay_boundary", (e) => {
			if (!O() || !(e instanceof MessageEvent)) return;
			let n = W(e);
			n && (p = {
				epoch_id: n.epoch_id,
				sequence_id: n.replay_boundary_sequence_id
			}, d !== null && d.epoch_id !== n.epoch_id && (d = p, f = null, v += 1, y.length = 0), t.onReplayBoundary?.(n));
		}), s.addEventListener("replay_gap", (e) => {
			if (!O() || !(e instanceof MessageEvent)) return;
			let n = W(e);
			n && t.onReplayGap?.(n);
		}), s.addEventListener("lagged", (e) => {
			if (!O() || !(e instanceof MessageEvent)) return;
			let n = W(e);
			n && t.onLagged?.(n);
		}), s.onerror = () => {
			O() && w();
		};
	};
	function O() {
		D().catch((e) => {
			m || (S(), w(e));
		});
	}
	return O(), () => {
		m = !0, v += 1, y.length = 0, l && clearTimeout(l), l = null, S();
	};
}
// src/app/services/eventStream.ts
function De(e, t, n = {}) {
	let r = n.instrumentation;
	return Ee(e, t, {
		...n,
		instrumentation: {
			onSessionEvent: (e) => {
				e.event.type, r?.onSessionEvent?.(e);
			},
			onAssistantDelta: (e) => {
				(e.text?.length ?? 0) + (e.reasoning?.length ?? 0), e.thread_name, r?.onAssistantDelta?.(e);
			}
		}
	});
}
// src/app/lib/store.ts
function G(e, t = "store") {
	let n = e, r = /* @__PURE__ */ new Set(), i = () => n, a = (e) => {
		let i = e instanceof Function ? e(n) : e;
		i && i !== n && (n = {
			...n,
			...i
		}, `${t}`, Object.keys(i).join("+"), r.size, r.forEach((e) => e()));
	}, o = (e) => (r.add(e), () => {
		r.delete(e);
	}), s = (e) => e;
	return {
		getState: i,
		setState: a,
		subscribe: o,
		useStore: (e) => {
			let t = e ?? s, r = () => t(n);
			return m(o, r, r);
		}
	};
}
var K = {
	getItem: (e) => globalThis.localStorage.getItem(e),
	setItem: (e, t) => globalThis.localStorage.setItem(e, t)
}, Oe = /* @__PURE__ */ e({
	PANEL_LIST_DEFAULT_RATIO: () => Ae,
	PANEL_LIST_DEFAULT_WIDTH: () => 208,
	PANEL_LIST_MAX_RATIO: () => je,
	PANEL_LIST_MIN_WIDTH: () => 180,
	clampPanelListWidth: () => Fe,
	createPanelWidth: () => Ne,
	defaultPanelListWidth: () => Me,
	release: () => Pe,
	setPanelListWidth: () => Ie,
	usePanelListWidth: () => Le
}), ke = "nac-panel-list-width", Ae = 1 / 3, je = .75;
function Me(e) {
	return Math.max(208, Math.round(e * Ae));
}
function Ne(e) {
	function t() {
		try {
			let t = e?.getItem(ke), n = t == null ? NaN : Number(t);
			return Number.isFinite(n) ? Math.max(180, Math.round(n)) : null;
		} catch {
			return null;
		}
	}
	let n = t(), r = /* @__PURE__ */ new Set();
	function i(e) {
		return r.add(e), () => {
			r.delete(e);
		};
	}
	function a() {
		return n;
	}
	function o() {
		return null;
	}
	function s(e, t) {
		return Math.min(Math.max(180, Math.round(e)), Math.max(180, Math.round(t)));
	}
	function c(t) {
		let i = Math.max(180, Math.round(t));
		if (i !== n) {
			n = i;
			try {
				e?.setItem(ke, String(i));
			} catch {}
			r.forEach((e) => e());
		}
	}
	function l() {
		return m(i, a, o);
	}
	return {
		release: () => {
			n = null, r.forEach((e) => e());
		},
		clampPanelListWidth: s,
		setPanelListWidth: c,
		usePanelListWidth: l
	};
}
var { release: Pe, clampPanelListWidth: Fe, setPanelListWidth: Ie, usePanelListWidth: Le } = Ne(K), Re = /* @__PURE__ */ e({
	THREAD_LOG_DEFAULT_RATIO: () => q,
	THREAD_LOG_MAX_RATIO: () => Ve,
	THREAD_LOG_MIN_RATIO: () => Be,
	clampThreadLogRatio: () => We,
	createThreadLogHeight: () => He,
	release: () => Ue,
	setThreadLogHeightRatio: () => Ge,
	useThreadLogHeightRatio: () => Ke
}), ze = "nac-thread-log-height-ratio", Be = .2, Ve = .8, q = .4;
function He(e) {
	function t() {
		try {
			let t = e?.getItem(ze), n = t == null ? NaN : Number(t);
			return Number.isFinite(n) ? s(n) : q;
		} catch {
			return q;
		}
	}
	let n = t(), r = /* @__PURE__ */ new Set();
	function i(e) {
		return r.add(e), () => {
			r.delete(e);
		};
	}
	function a() {
		return n;
	}
	function o() {
		return q;
	}
	function s(e) {
		return Math.min(Ve, Math.max(Be, Math.round(e * 1e3) / 1e3));
	}
	function c(t) {
		let i = s(t);
		if (i !== n) {
			n = i;
			try {
				e?.setItem(ze, String(i));
			} catch {}
			r.forEach((e) => e());
		}
	}
	function l() {
		return m(i, a, o);
	}
	return {
		release: () => {
			n = q, r.forEach((e) => e());
		},
		clampThreadLogRatio: s,
		setThreadLogHeightRatio: c,
		useThreadLogHeightRatio: l
	};
}
var { release: Ue, clampThreadLogRatio: We, setThreadLogHeightRatio: Ge, useThreadLogHeightRatio: Ke } = He(K), qe = /* @__PURE__ */ e({
	createLastLight: () => Ye,
	loadLastLight: () => Ze,
	release: () => Xe,
	storeLastLight: () => Qe
}), Je = "nac.last-light-model";
function Ye(e) {
	let t = null;
	function n() {
		try {
			let n = e?.getItem(Je);
			if (!n) return t;
			let r = JSON.parse(n);
			if (Object(r) !== r || Array.isArray(r)) return null;
			let i = r;
			return !pe(i.model) || !pe(i.backend) ? null : r;
		} catch {
			return null;
		}
	}
	function r(n) {
		t = n;
		try {
			n ? e?.setItem(Je, JSON.stringify(n)) : e?.setItem(Je, "");
		} catch {}
	}
	return {
		release: () => {
			t = null;
		},
		loadLastLight: n,
		storeLastLight: r
	};
}
var { release: Xe, loadLastLight: Ze, storeLastLight: Qe } = Ye(K), $e = /* @__PURE__ */ e({
	acknowledgeSucceeded: () => ct,
	attentionStore: () => nt,
	clearAttention: () => it,
	clearAttentionAll: () => st,
	createAttentionStore: () => et,
	release: () => tt,
	trackAttention: () => rt,
	useAnyAttention: () => ot,
	useAttention: () => at
});
function et(e) {
	let t = G({
		flagged: {},
		acknowledgements: {}
	}), { getState: n, setState: r, useStore: i } = t, o = {}, s = {}, c = {};
	function l(e) {
		let t = { ...n().flagged }, i = { ...n().acknowledgements };
		for (let n of e) {
			delete t[n];
			let e = s[n] ?? 0;
			e > (c[n] ?? 0) && (c[n] = e, i[n] = Math.max(e, i[n] ?? 0));
		}
		r({
			flagged: t,
			acknowledgements: i
		});
	}
	function u(e, t) {
		t !== void 0 && (s[e] = Math.max(s[e] ?? 0, t)), l([e]);
	}
	function d(e, t) {
		let i = {}, l = { ...n().flagged }, d = {};
		for (let t of e) {
			let e = t.summary.session_id, n = t.heartbeat_results ?? [];
			d[e] = n.reduce((e, t) => Math.max(e, t.sequence), 0);
			let r = t.attention_revision ?? 0;
			if (n.some((t) => !t.seen && t.sequence > (c[e] ?? 0) && t.outcome !== "unchanged") && (l[e] = !0), a(t.active_run) && t.active_run) i[e] = {
				runId: t.active_run.run_id,
				revision: r,
				waits: 0
			};
			else if (o[e]) {
				let a = o[e], s = n.find((e) => e.run_id === a.runId);
				!s && r <= a.revision && a.waits === 0 && t.attention_revision !== void 0 ? i[e] = {
					...a,
					waits: 1
				} : s && s.outcome === "unchanged" || (l[e] = !0);
			}
		}
		o = i, s = d, r({ flagged: l }), t && u(t);
	}
	function f(e, t) {
		let i = { ...n().acknowledgements };
		(i[e] ?? 0) <= t && delete i[e], r({ acknowledgements: i });
	}
	return {
		release: () => {
			o = {}, s = {}, c = {}, r({
				flagged: {},
				acknowledgements: {}
			});
		},
		attentionStore: t,
		trackAttention: d,
		clearAttention: u,
		useAttention: (e) => i((t) => !!t.flagged[e]),
		useAnyAttention: (e) => i((t) => e.some((e) => !!t.flagged[e])),
		clearAttentionAll: l,
		acknowledgeSucceeded: f
	};
}
var { release: tt, attentionStore: nt, trackAttention: rt, clearAttention: it, useAttention: at, useAnyAttention: ot, clearAttentionAll: st, acknowledgeSucceeded: ct } = et(K), lt = /* @__PURE__ */ e({
	chatTabsStore: () => ft,
	createChatTabsStore: () => ut,
	dismissChatTab: () => pt,
	pruneChatTabs: () => gt,
	release: () => dt,
	restoreChatTab: () => mt,
	setChatTabOrder: () => ht,
	useChatTabOrder: () => vt,
	useDismissedChatTabs: () => _t
});
function ut(e) {
	let t = "nac.chatTabs", n = () => ({
		dismissed: /* @__PURE__ */ new Set(),
		order: {}
	}), r = (e) => Array.isArray(e) ? e.filter((e) => typeof e == "string") : [];
	function i() {
		try {
			let i = e?.getItem(t);
			if (!i) return n();
			let a = JSON.parse(i);
			if (!a || typeof a != "object") return n();
			let { dismissed: o, order: s } = a;
			return {
				dismissed: new Set(r(o)),
				order: Object.fromEntries(Object.entries(s && typeof s == "object" ? s : {}).map(([e, t]) => [e, r(t)]))
			};
		} catch {
			return n();
		}
	}
	let a = G(i(), "chatTabs"), o = a.getState(), { getState: s, setState: c, subscribe: l, useStore: u } = a, d = l(() => {
		let { dismissed: n, order: r } = s();
		try {
			e?.setItem(t, JSON.stringify({
				dismissed: [...n],
				order: r
			}));
		} catch {}
	});
	function f(e) {
		c((t) => {
			if (t.dismissed.has(e)) return null;
			let n = new Set(t.dismissed);
			return n.add(e), { dismissed: n };
		});
	}
	function p(e) {
		c((t) => {
			if (!t.dismissed.has(e)) return null;
			let n = new Set(t.dismissed);
			return n.delete(e), { dismissed: n };
		});
	}
	function m(e, t) {
		c((n) => ({ order: {
			...n.order,
			[e]: t
		} }));
	}
	function h(e, t) {
		let n = new Set(e), r = new Set(t);
		c((e) => {
			let t = new Set([...e.dismissed].filter((e) => n.has(e))), i = {};
			for (let [t, a] of Object.entries(e.order)) r.has(t) && (i[t] = a.filter((e) => n.has(e)));
			return t.size === e.dismissed.size && Object.keys(i).length === Object.keys(e.order).length && Object.entries(i).every(([t, n]) => n.length === e.order[t]?.length) ? null : {
				dismissed: t,
				order: i
			};
		});
	}
	let g = () => u((e) => e.dismissed), _ = [];
	return {
		release: () => {
			d(), a.setState(o);
		},
		chatTabsStore: a,
		dismissChatTab: f,
		restoreChatTab: p,
		setChatTabOrder: m,
		pruneChatTabs: h,
		useDismissedChatTabs: g,
		useChatTabOrder: (e) => u((t) => e ? t.order[e] ?? _ : _)
	};
}
var { release: dt, chatTabsStore: ft, dismissChatTab: pt, restoreChatTab: mt, setChatTabOrder: ht, pruneChatTabs: gt, useDismissedChatTabs: _t, useChatTabOrder: vt } = ut(K), yt = /* @__PURE__ */ e({
	acknowledge: () => Zt,
	claimCancellation: () => Jt,
	claimSubmission: () => Xt,
	createPromptDraftStore: () => Et,
	dismissRecovery: () => Wt,
	dismissUnretainedSubmission: () => zt,
	get: () => Dt,
	getRecoveries: () => Bt,
	getUnretainedSubmission: () => It,
	getUnreviewed: () => jt,
	hasSubmission: () => Ft,
	isRetentionLimited: () => Nt,
	isSubmitting: () => Kt,
	noteUnretainedSubmission: () => Rt,
	purgeAll: () => $t,
	purgeSessions: () => Qt,
	release: () => en,
	restoreRecovery: () => Gt,
	retainSubmission: () => Ht,
	settleSubmission: () => Ut,
	subscribe: () => kt,
	update: () => Ot,
	useCancelling: () => qt,
	useDraft: () => At,
	useRecoveries: () => Vt,
	useRetentionLimited: () => Pt,
	useSubmitting: () => Yt,
	useUnretainedSubmission: () => Lt,
	useUnreviewed: () => Mt
}), J = Object.freeze([]), bt = Object.freeze({
	text: "",
	revision: 0
}), Y = 100, X = 1e6, xt = [
	"owner",
	"profile",
	"organization",
	"host",
	"incarnation",
	"endpoint",
	"release"
], St = [
	"owner",
	"profile",
	"organization",
	"host",
	"store",
	"track"
], Ct = 4096, wt = 4194304, Z = (e) => typeof e == "string" && e.length > 0 && e.length <= Ct;
function Tt(e, t) {
	if (t !== void 0 && !Array.isArray(t)) return !1;
	let n = t ?? [];
	if (e.length > Y || n.length > Y) return !1;
	let r = 0, i = /* @__PURE__ */ new Set(), a = /* @__PURE__ */ new Set();
	for (let t of e) {
		if (!Array.isArray(t) || t.length !== 2 && (t.length !== 3 || t[2] !== "unreviewed") || !Z(t[0]) || typeof t[1] != "string" || t.length === 2 && i.has(t[0])) return !1;
		t.length === 2 && i.add(t[0]), r += t[1].length;
	}
	for (let e of n) {
		if (!Array.isArray(e) || e.length !== 3 || !Z(e[0]) || !Z(e[1]) || typeof e[2] != "string" || a.has(e[1])) return !1;
		a.add(e[1]), r += e[2].length;
	}
	return r <= X;
}
function Et(e, t, n) {
	let r = e && xt.every((t) => typeof e[t] == "string") ? xt.map((t) => e[t]) : null, i = n !== void 0, a = i ? 2 : 1, o = i && t?.coldImports === !0, s = i ? r && r.every(Z) && n && St.every((e) => Z(n[e])) ? St.map((e) => n[e]) : null : r, c = s ? `nac:prompt-drafts:v${a}:${JSON.stringify(s)}` : null, l = /* @__PURE__ */ new Map(), u = /* @__PURE__ */ new Map(), d = /* @__PURE__ */ new Set(), f = /* @__PURE__ */ new Map(), p = /* @__PURE__ */ new Map(), h = 0, g = 0, _ = !1, v = !1, y = c ? t : void 0;
	try {
		let e = c ? y?.getItem(c) : null;
		if (e && (!i || e.length <= wt && new TextEncoder().encode(e).length <= wt)) {
			let t = JSON.parse(e);
			if (t?.version === a && JSON.stringify(t.binding) === JSON.stringify(s) && Array.isArray(t.drafts) && t.drafts.length <= Y && t.drafts.every((e) => Array.isArray(e) && (e.length === 2 || i && e.length === 3 && e[2] === "unreviewed") && typeof e[0] == "string" && typeof e[1] == "string") && (!i || Tt(t.drafts, t.recoveries))) {
				for (let [e, n, r] of t.drafts) {
					if (!n) continue;
					let t = l.get(e);
					if (o || r === "unreviewed") {
						let r = Object.freeze({
							id: `checkpoint-${++g}`,
							text: n,
							status: "uncertain",
							source: "checkpoint"
						});
						l.set(e, {
							value: t?.value ?? Object.freeze({
								text: "",
								revision: ++h
							}),
							unreviewed: Object.freeze([...t?.unreviewed ?? [], r])
						});
					} else l.set(e, {
						value: Object.freeze({
							text: n,
							revision: ++h
						}),
						unreviewed: t?.unreviewed ?? J
					});
				}
				if (Array.isArray(t.recoveries)) {
					let e = 0, n = 0;
					for (let r of t.recoveries) {
						if (!Array.isArray(r) || r.length !== 3 || !r.every((e) => typeof e == "string")) continue;
						let [t, i, a] = r;
						if (!a || ++e > Y || (n += a.length) > X) break;
						u.set(t, Object.freeze([...u.get(t) ?? [], Object.freeze({
							id: i,
							text: a,
							status: "uncertain"
						})]));
					}
				}
			}
		}
	} catch {}
	let b = () => d.forEach((e) => e()), x = () => {
		if (y && c) {
			v = !1;
			try {
				if (!l.size && !u.size) y.removeItem(c);
				else {
					let e = {
						version: a,
						binding: s,
						drafts: [...l].flatMap(([e, t]) => [...t.value.text || !o && !t.unreviewed.length ? [[e, t.value.text]] : [], ...(t.unreviewed ?? []).map((t) => [
							e,
							t.text,
							"unreviewed"
						])]),
						...u.size ? { recoveries: [...u].flatMap(([e, t]) => t.map(({ id: t, text: n }) => [
							e,
							t,
							n
						])) } : {}
					}, t = JSON.stringify(e);
					if (i && (!Tt(e.drafts, e.recoveries) || new TextEncoder().encode(t).length > wt)) {
						if (o || [...l.values()].some((e) => e.unreviewed?.length)) {
							v = !0;
							return;
						}
						throw Error("Draft checkpoint exceeds its recovery retention bound.");
					}
					y.setItem(c, t);
				}
			} catch {
				v = !0;
				try {
					y.removeItem(c);
				} catch {}
			}
		}
	}, S = (e) => l.get(e)?.value ?? bt, C = (e) => l.get(e)?.unreviewed ?? J, w = (e, t, n) => {
		if (_) return bt;
		let r = l.get(e), i = r?.unreviewed.filter((e) => e !== n), a = Object.freeze({
			text: t,
			revision: ++h
		});
		l.delete(e), l.set(e, {
			...r,
			value: a,
			unreviewed: i?.length ? Object.freeze(i) : J
		});
		let o = [...l.values()].reduce((e, t) => e + t.value.text.length + (t.unreviewed ?? []).reduce((e, t) => e + t.text.length, 0), 0) + [...u.values()].flat().reduce((e, t) => e + t.text.length, 0);
		for (let [t, r] of l) {
			if (n || l.size <= Y && o <= X) break;
			t === e || r.unreviewed.length || f.has(t) || (l.delete(t), o -= r.value.text.length);
		}
		return x(), b(), a;
	}, T = (e) => (d.add(e), () => {
		d.delete(e);
	}), E = (e) => u.get(e) ?? J, D = (e, t) => {
		if (_ || e.has(t)) return null;
		let n = {};
		return e.set(t, n), b(), () => {
			_ || e.get(t) !== n || (e.delete(t), b());
		};
	}, O = (e) => l.get(e)?.unretainedSubmission, k = (e, t) => !_ && [...f.get(e)?.values() ?? []].includes(t), A = (e, t) => {
		if (_ || t && S(e) !== t) return null;
		let n = f.get(e);
		if (n && (!t || [...n.values()].some((e) => !e || e === t))) return null;
		let r = n ?? /* @__PURE__ */ new Map(), i = {};
		return r.set(i, t), f.set(e, r), b(), () => {
			!_ && f.get(e) === r && r.delete(i) && (r.size || f.delete(e), b());
		};
	}, j = (e, t) => {
		if (_) return;
		let n = S(e);
		if (C(e).includes(t)) {
			l.set(e, {
				...l.get(e),
				value: n,
				unreviewed: Object.freeze(C(e).filter((e) => e !== t))
			}), x(), b();
			return;
		}
		let r = E(e);
		if (!r.includes(t)) return;
		let i = r.filter((e) => e !== t);
		i.length ? u.set(e, Object.freeze(i)) : u.delete(e), x(), b();
	};
	return {
		get: S,
		update: (e, t) => w(e, t),
		subscribe: T,
		isRetentionLimited: () => v,
		useRetentionLimited: () => m(T, () => v, () => v),
		useDraft: (e) => m(T, () => S(e), () => S(e)),
		getUnreviewed: C,
		useUnreviewed: (e) => m(T, () => C(e), () => C(e)),
		hasSubmission: k,
		getUnretainedSubmission: O,
		useUnretainedSubmission: (e) => m(T, () => O(e), () => O(e)),
		noteUnretainedSubmission: (e, t) => {
			let n = l.get(e);
			n && k(e, t) && (l.set(e, {
				...n,
				unretainedSubmission: Object.freeze({})
			}), b());
		},
		dismissUnretainedSubmission: (e, t) => {
			let n = l.get(e);
			!_ && n && n.unretainedSubmission === t && (l.set(e, {
				...n,
				unretainedSubmission: void 0
			}), b());
		},
		getRecoveries: E,
		useRecoveries: (e) => m(T, () => E(e), () => E(e)),
		retainSubmission: (e, t) => {
			if (_ || S(e) !== t) return null;
			let n = [...u.values()].flat(), r = [...l].reduce((t, [n, r]) => t + (n === e ? 0 : r.value.text.length) + (r.unreviewed ?? []).reduce((e, t) => e + t.text.length, 0), 0);
			if (n.length >= Y || n.reduce((e, t) => e + t.text.length, r) + t.text.length > X) throw Error("Unconfirmed message storage is full. Resolve earlier messages before sending more.");
			let i;
			do
				i = `message-${++g}`;
			while (n.some((e) => e.id === i));
			let a = Object.freeze({
				id: i,
				text: t.text,
				status: "pending"
			});
			return u.set(e, Object.freeze([...E(e), a])), x(), b(), a;
		},
		settleSubmission: (e, t, n) => {
			if (!_ && E(e).includes(t)) {
				if (n === "confirmed") return j(e, t);
				u.set(e, Object.freeze(E(e).map((e) => e === t ? Object.freeze({
					...e,
					status: n
				}) : e))), x(), b();
			}
		},
		dismissRecovery: (e, t) => {
			t.status !== "pending" && j(e, t);
		},
		restoreRecovery: (e, t) => _ || t.status === "pending" || S(e).text || !E(e).includes(t) && !C(e).includes(t) ? !1 : (C(e).includes(t) ? w(e, t.text, t) : (w(e, t.text), j(e, t)), !0),
		isSubmitting: (e) => f.has(e),
		useCancelling: (e) => m(T, () => p.has(e), () => p.has(e)),
		claimCancellation: (e) => D(p, e),
		useSubmitting: (e) => m(T, () => f.has(e), () => f.has(e)),
		claimSubmission: A,
		acknowledge: (e, t) => _ || S(e) !== t ? !1 : (w(e, ""), !0),
		purgeSessions: (e) => {
			if (!_) {
				for (let t of e) l.delete(t), f.delete(t), p.delete(t), u.delete(t);
				x(), b();
			}
		},
		purgeAll: () => {
			_ || (l.clear(), f.clear(), p.clear(), u.clear(), x(), b());
		},
		release: () => {
			_ = !0, l.clear(), f.clear(), p.clear(), u.clear(), b(), d.clear();
		}
	};
}
var { get: Dt, update: Ot, subscribe: kt, useDraft: At, getUnreviewed: jt, useUnreviewed: Mt, isRetentionLimited: Nt, useRetentionLimited: Pt, hasSubmission: Ft, getUnretainedSubmission: It, useUnretainedSubmission: Lt, noteUnretainedSubmission: Rt, dismissUnretainedSubmission: zt, getRecoveries: Bt, useRecoveries: Vt, retainSubmission: Ht, settleSubmission: Ut, dismissRecovery: Wt, restoreRecovery: Gt, isSubmitting: Kt, useCancelling: qt, claimCancellation: Jt, useSubmitting: Yt, claimSubmission: Xt, acknowledge: Zt, purgeSessions: Qt, purgeAll: $t, release: en } = Et();
// src/app/features/human-shell/intents.ts
function tn() {
	let e = /* @__PURE__ */ new Map(), t = !1, n = (e) => new TextEncoder().encode(e).byteLength;
	return {
		get: (t) => e.get(t),
		claim(r, i) {
			if (t) throw Error("This command's runtime has been closed.");
			let a = e.get(r);
			if (a?.phase === "dispatching") throw Error("A command admission is in progress.");
			if (a) {
				let t = Object.freeze({
					...a,
					phase: "dispatching"
				});
				return e.set(r, t), t;
			}
			let o = [...e.values()].reduce((e, t) => e + n(t.request.command), 0);
			if (e.size >= 32 || o + n(i) > 1048576) throw Error("Unconfirmed command storage is full. Reconcile prior commands or shorten this command before sending.");
			let s = Object.freeze({
				request: Object.freeze({
					request_id: crypto.randomUUID(),
					command: i
				}),
				phase: "dispatching"
			});
			return e.set(r, s), s;
		},
		confirmed(t, n) {
			e.get(t)?.request === n.request && e.delete(t);
		},
		uncertain(t, n) {
			e.get(t)?.request === n.request && e.set(t, Object.freeze({
				...n,
				phase: "uncertain"
			}));
		},
		release() {
			t = !0, e.clear();
		}
	};
}
// src/app/store/composerStore.ts
var nn = /* @__PURE__ */ e({
	consumeDraftRequests: () => ln,
	consumePromptRequests: () => sn,
	createComposerStore: () => rn,
	draftPrompt: () => cn,
	release: () => an,
	sendPrompt: () => on,
	shellIntents: () => un
});
function rn(e) {
	let t = G({
		pending: null,
		draft: null
	}, "composer"), n = t.getState(), r = tn();
	function i(e) {
		t.setState({ pending: e });
	}
	function a(e) {
		return t.subscribe(() => {
			let { pending: n } = t.getState();
			n !== null && (t.setState({ pending: null }), e(n));
		});
	}
	function o(e, n) {
		t.setState({ draft: {
			sessionId: e,
			text: n
		} });
	}
	function s(e, n) {
		let r = () => {
			let { draft: r } = t.getState();
			r && r.sessionId === e && (t.setState({ draft: null }), n(r.text));
		}, i = t.subscribe(r);
		return r(), i;
	}
	return {
		release: () => {
			r.release(), t.setState(n);
		},
		shellIntents: r,
		sendPrompt: i,
		consumePromptRequests: a,
		draftPrompt: o,
		consumeDraftRequests: s
	};
}
var { release: an, sendPrompt: on, consumePromptRequests: sn, draftPrompt: cn, consumeDraftRequests: ln, shellIntents: un } = rn(K), dn = "Command timed out after";
function fn(e) {
	return e.completion_status == null ? e.command_status == null ? e.is_error || e.content_preview.startsWith(dn) : e.is_error || e.command_status !== "completed" : e.completion_status !== "success";
}
function pn(e, t) {
	switch (e.type) {
		case "tool_call_started": {
			let t = e.key_arg_preview || e.args_preview;
			return {
				key: `call-${e.call_id}`,
				text: `▸ ${e.name}: ${t}`,
				bare: `▸ ${t}`,
				mark: "▸",
				name: e.name,
				body: t,
				isError: !1
			};
		}
		case "tool_call_finished": {
			let t = fn(e), n = e.completion_status === "timed_out" ? "◷" : e.completion_status === "cancelled" ? "■" : t ? "✕" : "✓";
			return {
				key: `result-${e.call_id}`,
				text: `${n} ${e.name}: ${e.content_preview}`,
				bare: `${n} ${e.content_preview}`,
				mark: n,
				name: e.name,
				body: e.content_preview,
				isError: t
			};
		}
		case "thread_log": return {
			key: `log-${t}`,
			text: e.line,
			bare: e.line,
			mark: null,
			name: null,
			body: e.line,
			isError: !1
		};
		case "mcp_server_skipped": {
			let n = `⚠ MCP server "${e.server_name}" skipped: ${e.reason}`;
			return {
				key: `log-${t}`,
				text: n,
				bare: n,
				mark: null,
				name: null,
				body: n,
				isError: !1
			};
		}
		case "mcp_notification": {
			let n = e.kind === "catalog_refresh_failed", r = n ? "✕" : "↻", i = `${r} MCP ${e.server_name}: ${e.message}`;
			return {
				key: `log-${t}`,
				text: i,
				bare: i,
				mark: r,
				name: e.server_name,
				body: e.message,
				isError: n
			};
		}
		default: return null;
	}
}
function mn(e) {
	let t = [];
	return (e ?? []).forEach((e, n) => {
		let r = pn(e, n);
		r && t.push(r);
	}), t;
}
function hn(e, t) {
	if (!t.length) return e;
	if (!e.length) return t;
	let n = new Set(e.map((e) => e.key)), r = -1, i = -1;
	return t.forEach((e, t) => {
		n.has(e.key) && (r < 0 && (r = t), i = t);
	}), r < 0 ? [...e, ...t] : [
		...t.slice(0, r),
		...e,
		...t.slice(i + 1)
	];
}
function gn(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) for (let e of n.events) t.set(e.id, e.event);
	return [...t.entries()].sort(([e], [t]) => e - t).map(([, e]) => e);
}
function _n(e) {
	let t = [], n = /* @__PURE__ */ new Map();
	for (let r of e) if (r.key.startsWith("call-")) {
		let e = r.key.slice(5), i = {
			kind: "tool_call",
			callId: e,
			toolName: r.name ?? "",
			keyArg: r.body,
			status: "pending",
			resultPreview: null,
			isError: !1
		};
		n.set(e, i), t.push(i);
	} else if (r.key.startsWith("result-")) {
		let e = r.key.slice(7), i = n.get(e);
		i ? (i.status = r.isError ? "error" : "success", i.resultPreview = r.body, i.isError = r.isError) : t.push({
			kind: "log",
			key: r.key,
			mark: r.mark,
			name: r.name,
			body: r.body,
			isError: r.isError
		});
	} else t.push({
		kind: "log",
		key: r.key,
		mark: r.mark,
		name: r.name,
		body: r.body,
		isError: r.isError
	});
	return t;
}
function vn(e, t) {
	if (!e) return !1;
	let n = /* @__PURE__ */ new Set();
	for (let e of t) e.key.startsWith("result-") && n.add(e.key.slice(7));
	for (let e of t) if (e.key.startsWith("call-") && !n.has(e.key.slice(5))) return !1;
	return !0;
}
// src/app/store/runtimeStore.ts
var yn = /* @__PURE__ */ e({
	applyAssistantDelta: () => On,
	applyEnvelope: () => Fn,
	captureRuntimeActivation: () => Cn,
	clearRuntimeThreads: () => Tn,
	createRuntimeStore: () => bn,
	finishRunCancel: () => Pn,
	getRuntimeState: () => tr,
	liftSessionSpend: () => En,
	pushLocalEvent: () => jn,
	release: () => xn,
	requestRunCancel: () => Mn,
	resetRuntime: () => wn,
	restoreRunCancel: () => Nn,
	runtimeStore: () => Sn,
	setOptimisticUserPrompt: () => Dn,
	setStreamStatus: () => kn,
	syncRunFromSnapshot: () => An,
	useActivity: () => Rn,
	useCancelArmed: () => Ln,
	useFinishedToolCalls: () => Gn,
	useLastElapsedMs: () => Xn,
	useLiveEvents: () => Hn,
	useLiveThreads: () => Wn,
	useModelRetryAttempt: () => Vn,
	useOptimisticUserPrompt: () => er,
	usePrimaryToolEvents: () => Kn,
	useRunError: () => zn,
	useRunFailure: () => Bn,
	useRunStartedAt: () => Yn,
	useRunUsage: () => qn,
	useRunning: () => In,
	useSessionSpend: () => Jn,
	useStreamReasoning: () => $n,
	useStreamStatus: () => Un,
	useStreamText: () => Qn,
	useWorkspaceEpoch: () => Zn
});
function bn(e) {
	let t = G({
		sessionId: null,
		running: !1,
		activity: "",
		error: null,
		modelError: null,
		runFailure: null,
		modelRetryAttempt: null,
		streamStatus: "idle",
		events: [],
		threads: {},
		finishedToolCalls: {},
		primaryToolEvents: [],
		streamText: "",
		streamReasoning: "",
		streamSettled: !1,
		streamPredatesPrompt: !1,
		optimisticUserPrompt: null,
		runUsage: null,
		sessionSpend: null,
		runStartedAt: null,
		lastElapsedMs: null,
		workspaceEpoch: 0,
		cancelArmed: !1
	}, "runtime"), o = t.getState(), { setState: s, getState: c, useStore: l } = t, u = {};
	function d(e) {
		let t = u;
		return () => t === u && c().sessionId === e;
	}
	function f(e) {
		u = {}, s({
			sessionId: e,
			running: !1,
			activity: "",
			error: null,
			modelError: null,
			runFailure: null,
			modelRetryAttempt: null,
			streamStatus: e ? "connecting" : "idle",
			events: [],
			threads: {},
			finishedToolCalls: {},
			primaryToolEvents: [],
			streamText: "",
			streamReasoning: "",
			streamSettled: !1,
			streamPredatesPrompt: !1,
			optimisticUserPrompt: null,
			runUsage: null,
			sessionSpend: null,
			runStartedAt: null,
			lastElapsedMs: null,
			workspaceEpoch: 0,
			cancelArmed: !1
		});
	}
	function p() {
		s({ threads: {} });
	}
	function m(e) {
		n(e) && e && s((t) => {
			let n = r(t.sessionSpend, e);
			return n?.input_tokens === t.sessionSpend?.input_tokens && n?.output_tokens === t.sessionSpend?.output_tokens && n?.cache_read_tokens === t.sessionSpend?.cache_read_tokens && n?.cache_write_tokens === t.sessionSpend?.cache_write_tokens && (n?.cost?.total ?? 0) === (t.sessionSpend?.cost?.total ?? 0) ? {} : { sessionSpend: n };
		});
	}
	function h(e, t = "rejected") {
		s(e === null ? (e) => ({
			optimisticUserPrompt: null,
			streamPredatesPrompt: t === "committed" && e.streamPredatesPrompt
		}) : {
			optimisticUserPrompt: e,
			streamPredatesPrompt: !0
		});
	}
	function g(e) {
		e.thread_name || (e.reset ? s({
			streamSettled: !1,
			streamPredatesPrompt: !1,
			streamText: "",
			streamReasoning: "",
			modelRetryAttempt: e.retry_attempt ?? null
		}) : s((t) => {
			let n = t.streamSettled ? {
				streamText: "",
				streamReasoning: ""
			} : {
				streamText: t.streamText,
				streamReasoning: t.streamReasoning
			};
			return {
				streamSettled: !1,
				streamPredatesPrompt: !1,
				streamText: n.streamText + (e.text ?? ""),
				streamReasoning: n.streamReasoning + (e.reasoning ?? "")
			};
		}));
	}
	function _(e) {
		s({ streamStatus: e });
	}
	function v(e) {
		let t = a(e), n = c();
		if (n.cancelArmed) return;
		let r = t && e ? e.started_at_epoch_ms : n.runStartedAt;
		(n.running !== t || n.runStartedAt !== r) && s({
			running: t,
			activity: t ? n.activity : "",
			runStartedAt: t ? r : null,
			lastElapsedMs: t ? null : T(n)
		});
	}
	function y(e, t, n = !1) {
		b({
			seq: null,
			kind: e,
			text: t,
			isError: n,
			local: !0
		});
	}
	function b(e) {
		s((t) => {
			let n = t.events.length >= 300 ? t.events.slice(1) : t.events.slice();
			return n.push({
				ts: Date.now(),
				local: !1,
				...e
			}), { events: n };
		});
	}
	let x = (e) => ({
		name: e,
		status: "running",
		cancelled: !1,
		exitCode: null,
		isError: !1,
		log: []
	});
	function S(e, t) {
		e && s((n) => ({ threads: {
			...n.threads,
			[e]: {
				...n.threads[e] ?? x(e),
				...t
			}
		} }));
	}
	function C(e) {
		return Object.fromEntries(Object.entries(e).map(([e, t]) => [e, t.status === "running" ? {
			...t,
			cancelled: !0
		} : t]));
	}
	function w(e) {
		return e == null || e <= 0 ? null : Math.max(0, Date.now() - e);
	}
	function T(e, t) {
		let n = [
			w(e.runStartedAt),
			e.lastElapsedMs,
			t
		].filter((e) => e != null);
		return n.length ? Math.max(...n) : null;
	}
	function E() {
		let e = c();
		return e.running && s((e) => ({
			running: !1,
			activity: "",
			error: null,
			modelError: null,
			runFailure: null,
			modelRetryAttempt: null,
			streamSettled: !0,
			cancelArmed: !0,
			lastElapsedMs: T(e),
			runStartedAt: null,
			threads: j(C(e.threads))
		})), e;
	}
	function D(e) {
		s({
			running: e.running,
			activity: e.activity,
			error: e.error,
			modelError: e.modelError,
			runFailure: e.runFailure,
			modelRetryAttempt: e.modelRetryAttempt,
			streamSettled: e.streamSettled,
			threads: e.threads,
			cancelArmed: e.cancelArmed,
			lastElapsedMs: e.lastElapsedMs,
			runStartedAt: e.runStartedAt
		});
	}
	function O() {
		s((e) => ({
			cancelArmed: !1,
			running: !1,
			activity: "",
			lastElapsedMs: T(e),
			runStartedAt: null
		}));
	}
	let k = 0;
	function A(e, t) {
		if (!e) return;
		k += 1;
		let n = pn(t, k);
		n && s((t) => {
			let r = t.threads[e] ?? x(e), i = [...r.log, n].slice(-200);
			return { threads: {
				...t.threads,
				[e]: {
					...r,
					log: i
				}
			} };
		});
	}
	function j(e) {
		return Object.fromEntries(Object.entries(e).map(([e, t]) => [e, t.status === "running" ? {
			...t,
			status: "finished",
			exitCode: null,
			isError: !1
		} : t]));
	}
	function M(e) {
		let t = e.sequence_id, n = e.event;
		switch (n.type) {
			case "run_started": return s({
				running: !0,
				activity: "",
				error: null,
				modelError: null,
				runFailure: null,
				modelRetryAttempt: null,
				streamText: "",
				streamReasoning: "",
				streamSettled: !1,
				streamPredatesPrompt: !1,
				runUsage: null,
				finishedToolCalls: {},
				runStartedAt: n.started_at_epoch_ms,
				lastElapsedMs: null,
				cancelArmed: !1,
				threads: {}
			}), b({
				seq: t,
				kind: "run",
				text: `Run started: ${n.prompt_preview}`,
				isError: !1
			}), "snapshot";
			case "run_completed": return s((e) => ({
				running: !1,
				activity: "",
				streamText: n.response,
				streamSettled: !0,
				runFailure: null,
				modelRetryAttempt: null,
				cancelArmed: !1,
				lastElapsedMs: T(e, n.duration_ms ?? null),
				runStartedAt: null,
				threads: j(e.threads)
			})), b({
				seq: t,
				kind: "run",
				text: "Run completed",
				isError: !1
			}), "snapshot";
			case "run_failed": {
				let e = c().modelError ?? n.message;
				return s((t) => ({
					running: !1,
					activity: "",
					error: e,
					runFailure: n.failure ?? null,
					modelRetryAttempt: null,
					streamSettled: !0,
					cancelArmed: !1,
					lastElapsedMs: T(t),
					runStartedAt: null,
					threads: j(t.threads)
				})), b({
					seq: t,
					kind: "error",
					text: e,
					isError: !0
				}), "snapshot";
			}
			case "run_cancelled": return s((e) => ({
				running: !1,
				activity: "",
				error: null,
				modelError: null,
				runFailure: null,
				modelRetryAttempt: null,
				streamSettled: !0,
				cancelArmed: !1,
				lastElapsedMs: T(e),
				runStartedAt: null,
				threads: j(C(e.threads))
			})), b({
				seq: t,
				kind: "run",
				text: "Run cancelled",
				isError: !1
			}), "snapshot";
			case "snapshot_saved": return "snapshot";
			case "transcript_appended": return s({ streamSettled: !0 }), "messages";
			case "transcript_reverted": return s({
				streamSettled: !0,
				streamText: "",
				streamReasoning: "",
				threads: {},
				finishedToolCalls: {},
				primaryToolEvents: []
			}), "replace-snapshot";
			case "agent": return N(t, n.event);
			default: return "none";
		}
	}
	function N(e, t) {
		switch (t.type) {
			case "tool_call_started": return s({ activity: `Tool: ${t.name}` }), A(t.thread_name, t), t.thread_name || P(t), b({
				seq: e,
				kind: "tool",
				text: `▶ ${t.name}(${t.args_preview})`,
				isError: !1
			}), "none";
			case "thread_log": return A(t.name, t), "none";
			case "mcp_server_skipped": return A(t.thread_name, t), "none";
			case "mcp_notification": {
				let n = t.kind === "catalog_refresh_failed";
				return A(t.thread_name, t), b({
					seq: e,
					kind: "mcp",
					text: `MCP ${t.server_name}: ${t.message}`,
					isError: n
				}), "none";
			}
			case "tool_call_finished": {
				let n = fn(t);
				A(t.thread_name, t), t.thread_name || P(t), b({
					seq: e,
					kind: "tool",
					text: `${n ? "✕" : "✓"} ${t.name}: ${t.content_preview}`,
					isError: n
				});
				let r = !t.thread_name;
				return s((e) => ({
					workspaceEpoch: e.workspaceEpoch + 1,
					...r ? { finishedToolCalls: {
						...e.finishedToolCalls,
						[t.call_id]: !0
					} } : {}
				})), t.name === "workset_define" ? "snapshot" : "none";
			}
			case "token_usage_updated": return s((e) => ({
				runUsage: i(e.runUsage, t.usage, t.thread_name ? e.runUsage?.total_tokens ?? 0 : t.usage.total_tokens),
				sessionSpend: i(e.sessionSpend, t.usage, t.thread_name ? e.sessionSpend?.total_tokens ?? 0 : t.usage.total_tokens || (e.sessionSpend?.total_tokens ?? 0))
			})), "none";
			case "thread_started": return s({ activity: `Thread ${t.name} dispatched` }), b({
				seq: e,
				kind: "thread",
				text: `⌥ thread "${t.name}" dispatched`,
				isError: !1
			}), S(t.name, {
				status: "running",
				cancelled: !1,
				exitCode: null,
				isError: !1,
				log: []
			}), "snapshot";
			case "thread_finished": return b({
				seq: e,
				kind: "thread",
				text: `⌦ thread "${t.name}" (exit ${t.exit_code ?? "?"})`,
				isError: !!t.exit_code
			}), S(t.name, {
				status: "finished",
				exitCode: t.exit_code,
				isError: !!t.exit_code
			}), "snapshot";
			case "assistant_message": return s({ activity: "" }), b({
				seq: e,
				kind: "assistant",
				text: "New assistant message",
				isError: !1
			}), "none";
			case "thread_steering_queued":
			case "thread_steering_delivered":
			case "thread_steering_expired": return b({
				seq: e,
				kind: "steering",
				text: `${F(t.type)} → ${t.name}: ${t.instruction_preview}`,
				isError: t.type === "thread_steering_expired"
			}), "none";
			case "orchestrator_steering_queued":
			case "orchestrator_steering_delivered":
			case "orchestrator_steering_expired": return b({
				seq: e,
				kind: "steering",
				text: `${F(t.type)} → orchestrator: ${t.instruction_preview}`,
				isError: t.type === "orchestrator_steering_expired"
			}), "none";
			case "orchestrator_compaction_started": return s({ activity: "Compacting context…" }), b({
				seq: e,
				kind: "compaction",
				text: `Compaction started (${t.reason})`,
				isError: !1
			}), "none";
			case "orchestrator_compaction_completed": return s({ activity: "" }), b({
				seq: e,
				kind: "compaction",
				text: "Compaction completed",
				isError: !1
			}), "replace-snapshot";
			case "orchestrator_compaction_skipped": return s({ activity: "" }), b({
				seq: e,
				kind: "compaction",
				text: `Compaction skipped: ${t.cause}`,
				isError: !1
			}), "none";
			case "orchestrator_compaction_failed": return s({ activity: "" }), b({
				seq: e,
				kind: "compaction",
				text: `Compaction failed: ${t.failure}`,
				isError: !0
			}), "none";
			case "error": return s({ error: t.message }), b({
				seq: e,
				kind: "error",
				text: t.message,
				isError: !0
			}), "none";
			case "model_error": return s({
				error: t.message,
				modelError: t.message
			}), b({
				seq: e,
				kind: "error",
				text: t.message,
				isError: !0
			}), "none";
			default: return "none";
		}
	}
	function P(e) {
		(e.type === "tool_call_started" || e.type === "tool_call_finished") && s((t) => {
			let n = `${e.type}:${e.call_id}`;
			return { primaryToolEvents: [...t.primaryToolEvents.filter((t) => t.type !== e.type || !("call_id" in t) || `${t.type}:${t.call_id}` !== n), e].slice(-400) };
		});
	}
	function F(e) {
		return e.endsWith("queued") ? "Steering queued" : e.endsWith("delivered") ? "Steering delivered" : "Steering expired";
	}
	return {
		release: () => {
			t.setState(o);
		},
		runtimeStore: t,
		captureRuntimeActivation: d,
		resetRuntime: f,
		clearRuntimeThreads: p,
		liftSessionSpend: m,
		setOptimisticUserPrompt: h,
		applyAssistantDelta: g,
		setStreamStatus: _,
		syncRunFromSnapshot: v,
		pushLocalEvent: y,
		requestRunCancel: E,
		restoreRunCancel: D,
		finishRunCancel: O,
		applyEnvelope: M,
		useRunning: (e) => l((t) => t.sessionId === e && t.running),
		useCancelArmed: (e) => l((t) => t.sessionId === e && t.cancelArmed),
		useActivity: () => l((e) => e.activity),
		useRunError: () => l((e) => e.error),
		useRunFailure: () => l((e) => e.runFailure),
		useModelRetryAttempt: () => l((e) => e.modelRetryAttempt),
		useLiveEvents: () => l((e) => e.events),
		useStreamStatus: () => l((e) => e.streamStatus),
		useLiveThreads: () => l((e) => e.threads),
		useFinishedToolCalls: () => l((e) => e.finishedToolCalls),
		usePrimaryToolEvents: () => l((e) => e.primaryToolEvents),
		useRunUsage: () => l((e) => e.runUsage),
		useSessionSpend: () => l((e) => e.sessionSpend),
		useRunStartedAt: () => l((e) => e.runStartedAt),
		useLastElapsedMs: () => l((e) => e.lastElapsedMs),
		useWorkspaceEpoch: () => l((e) => e.workspaceEpoch),
		useStreamText: () => l((e) => e.streamText),
		useStreamReasoning: () => l((e) => e.streamReasoning),
		useOptimisticUserPrompt: () => l((e) => e.optimisticUserPrompt),
		getRuntimeState: c
	};
}
var { release: xn, runtimeStore: Sn, captureRuntimeActivation: Cn, resetRuntime: wn, clearRuntimeThreads: Tn, liftSessionSpend: En, setOptimisticUserPrompt: Dn, applyAssistantDelta: On, setStreamStatus: kn, syncRunFromSnapshot: An, pushLocalEvent: jn, requestRunCancel: Mn, restoreRunCancel: Nn, finishRunCancel: Pn, applyEnvelope: Fn, useRunning: In, useCancelArmed: Ln, useActivity: Rn, useRunError: zn, useRunFailure: Bn, useModelRetryAttempt: Vn, useLiveEvents: Hn, useStreamStatus: Un, useLiveThreads: Wn, useFinishedToolCalls: Gn, usePrimaryToolEvents: Kn, useRunUsage: qn, useSessionSpend: Jn, useRunStartedAt: Yn, useLastElapsedMs: Xn, useWorkspaceEpoch: Zn, useStreamText: Qn, useStreamReasoning: $n, useOptimisticUserPrompt: er, getRuntimeState: tr } = bn(K), nr = /* @__PURE__ */ new Map();
function rr(e) {
	let t = nr.get(e);
	return t || (t = {
		now: Date.now(),
		listeners: /* @__PURE__ */ new Set(),
		timer: null
	}, nr.set(e, t)), t;
}
function ir(e, t) {
	let n = rr(e);
	return n.listeners.add(t), n.timer ??= setInterval(() => {
		n.now = Date.now(), n.listeners.forEach((e) => e());
	}, e), () => {
		n.listeners.delete(t), n.listeners.size === 0 && n.timer && (clearInterval(n.timer), n.timer = null);
	};
}
function ar(e) {
	return rr(e).now;
}
// src/app/hooks/useNow.ts
var or = () => () => {}, sr = () => 0;
function cr(e = 1e3, t = !0) {
	let n = d((n) => t ? ir(e, n) : or(), [e, t]), r = d(() => t ? ar(e) : 0, [e, t]);
	return m(n, r, t ? r : sr);
}
// src/app/lib/providers.ts
var lr = {
	"openai-responses": "OpenAI Responses",
	"openai-chat-completions": "OpenAI Chat Completions",
	"chatgpt-codex-responses": "ChatGPT Codex Responses",
	"anthropic-messages": "Anthropic Messages",
	"deepseek-chat": "DeepSeek Chat",
	"fireworks-chat": "Fireworks Chat",
	"together-chat": "Together Chat",
	"arcee-auth": "Arcee API (Sign in)",
	"arcee-api": "Arcee API (Key)"
}, Q = [
	"arcee-api",
	"arcee-auth",
	"openai-responses",
	"openai-chat-completions",
	"chatgpt-codex-responses",
	"anthropic-messages",
	"deepseek-chat",
	"fireworks-chat",
	"together-chat"
];
function ur(e) {
	let t = Q.indexOf(e);
	return t === -1 ? Q.length : t;
}
var dr = /* @__PURE__ */ new Set([
	"openai-responses",
	"openai-chat-completions",
	"anthropic-messages",
	"deepseek-chat",
	"fireworks-chat",
	"together-chat",
	"arcee-api"
]);
function fr(e) {
	return dr.has(e);
}
var pr = {
	"arcee-auth": "arcee",
	"chatgpt-codex-responses": "codex"
};
function mr(e) {
	return pr[e] ?? null;
}
var hr = {
	arcee: "Arcee",
	codex: "ChatGPT"
};
function gr(e) {
	return hr[e];
}
function _r(e) {
	return e in lr;
}
function vr(e) {
	let t = (e ?? "").trim();
	return t ? _r(t) ? lr[t] : t : "";
}
function yr(e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) {
		let e = (n ?? "").trim();
		e && t.add(e);
	}
	let n = Q.filter((e) => t.has(e)), r = Array.from(t).filter((e) => !_r(e)).sort();
	return [...n, ...r];
}
// src/app/store/sessionFiltersStore.ts
var br = /* @__PURE__ */ e({
	RANGE_ANY: () => "any",
	RANGE_ITEMS: () => wr,
	SORT_DEFAULT: () => $,
	SORT_ITEMS: () => Cr,
	createSessionFiltersStore: () => xr,
	hasActiveFilters: () => Nr,
	pruneUnavailableFacets: () => Rr,
	release: () => Sr,
	resetFilters: () => Mr,
	sessionFiltersStore: () => Tr,
	setCreatedRange: () => Or,
	setModifiedRange: () => kr,
	setQuery: () => Er,
	setSort: () => Dr,
	toggleEnv: () => Ar,
	toggleProvider: () => jr,
	useCreatedRange: () => Vr,
	useFilterQuery: () => zr,
	useIsDefaultSort: () => Gr,
	useModifiedRange: () => Hr,
	useSelectedEnvs: () => Ur,
	useSelectedProviders: () => Wr,
	useSessionEnvs: () => Lr,
	useSessionProviders: () => Ir,
	useSort: () => Br,
	useVisibleProjectItems: () => Fr,
	useVisibleSessions: () => Pr
}), $ = "default";
function xr(e) {
	let n = [
		{
			id: $,
			label: "Default"
		},
		{
			id: "created_desc",
			label: "Newest first"
		},
		{
			id: "created_asc",
			label: "Oldest first"
		},
		{
			id: "updated_desc",
			label: "Recently updated"
		},
		{
			id: "title_asc",
			label: "Title A–Z"
		}
	], r = [
		{
			id: "any",
			label: "Any time"
		},
		{
			id: "24h",
			label: "Last 24 hours"
		},
		{
			id: "7d",
			label: "Last 7 days"
		},
		{
			id: "30d",
			label: "Last 30 days"
		}
	], i = 6e4, a = {
		"24h": 864e5,
		"7d": 6048e5,
		"30d": 2592e6
	}, u = G({
		query: "",
		sort: $,
		createdRange: "any",
		modifiedRange: "any",
		envs: [],
		providers: []
	}), d = u.getState(), { getState: f, setState: m, useStore: h } = u, g = (e, t) => e.includes(t) ? e.filter((e) => e !== t) : e.concat(t), _ = (e) => m({ query: e }), v = (e) => m({ sort: e }), y = (e) => m({ createdRange: e }), b = (e) => m({ modifiedRange: e }), x = (e) => m((t) => ({ envs: g(t.envs, e) })), S = (e) => m((t) => ({ providers: g(t.providers, e) }));
	function C() {
		m({
			query: "",
			createdRange: "any",
			modifiedRange: "any",
			envs: [],
			providers: []
		});
	}
	function w() {
		let e = f();
		return e.query.trim() !== "" || e.createdRange !== "any" || e.modifiedRange !== "any" || e.envs.length > 0 || e.providers.length > 0;
	}
	function T(e, t, n) {
		let r = a[t];
		if (!r) return !0;
		let i = l(e);
		return !Number.isFinite(i) || n - i <= r;
	}
	function E(e, n, r) {
		return !n || [
			t(e, r),
			e.cwd,
			e.model,
			e.backend,
			e.ssh_host,
			e.last_user_prompt,
			e.session_id
		].some((e) => e && String(e).toLowerCase().includes(n));
	}
	let D = {
		[$]: (e, t) => (e.sort_order ?? 0) - (t.sort_order ?? 0) || l(t.created_at) - l(e.created_at),
		created_desc: (e, t) => l(t.created_at) - l(e.created_at),
		created_asc: (e, t) => l(e.created_at) - l(t.created_at),
		updated_desc: (e, t) => l(t.updated_at) - l(e.updated_at)
	};
	function O(e) {
		let n = h(), r = cr(i);
		return p(() => {
			let i = s(e), a = n.query.trim().toLowerCase(), o = e.filter(({ summary: e }) => !(!E(e, a, i) || !T(e.created_at, n.createdRange, r) || !T(e.updated_at, n.modifiedRange, r) || n.envs.length > 0 && !n.envs.includes(c(e)) || n.providers.length > 0 && !n.providers.includes(e.backend)));
			if (n.sort === "title_asc") o.sort((e, n) => t(e.summary, i).localeCompare(t(n.summary, i), void 0, { sensitivity: "base" }));
			else {
				let e = D[n.sort];
				e && o.sort((t, n) => e(t.summary, n.summary));
			}
			return o;
		}, [
			e,
			n,
			r
		]);
	}
	function k(e, t) {
		return !t || [
			e.name,
			e.description,
			e.cwd,
			e.ssh_host
		].some((e) => e && String(e).toLowerCase().includes(t));
	}
	function A(e) {
		return e.flatMap((e) => e.kind === "project" ? e.entry.sessions : [e.session]);
	}
	function j(e, n) {
		return e.kind === "project" ? e.entry.project.name : t(e.session.summary, n);
	}
	function M(e) {
		return e.kind === "project" ? {
			createdAt: e.entry.project.created_at,
			updatedAt: e.entry.updatedAt
		} : {
			createdAt: e.session.summary.created_at,
			updatedAt: e.session.summary.updated_at
		};
	}
	function N(e) {
		let t = h(), n = cr(i);
		return p(() => {
			let r = s(A(e)), i = t.query.trim().toLowerCase(), a = (e) => t.envs.length > 0 && !t.envs.includes(c(e)) ? !1 : t.providers.length === 0 || t.providers.includes(e.backend), o = t.envs.length > 0 || t.providers.length > 0, u = e.filter((e) => {
				let { createdAt: s, updatedAt: c } = M(e);
				if (!T(s, t.createdRange, n) || !T(c, t.modifiedRange, n)) return !1;
				if (e.kind === "orphan") {
					let { summary: t } = e.session;
					return a(t) && E(t, i, r);
				}
				let { project: l, sessions: u } = e.entry;
				return o && !u.some((e) => a(e.summary)) ? !1 : k(l, i) || u.some((e) => E(e.summary, i, r));
			});
			if (t.sort === "title_asc") u.sort((e, t) => j(e, r).localeCompare(j(t, r), void 0, { sensitivity: "base" }));
			else if (t.sort !== "default") {
				let e = t.sort === "updated_desc" ? "updatedAt" : "createdAt", n = t.sort === "created_asc";
				u.sort((t, r) => {
					let i = l(M(r)[e]) - l(M(t)[e]);
					return n ? -i : i;
				});
			}
			return u;
		}, [
			e,
			t,
			n
		]);
	}
	function P(e) {
		return p(() => yr(e.map(({ summary: e }) => e.backend)), [e]);
	}
	function F(e) {
		return p(() => {
			let t = new Set(e.map(({ summary: e }) => c(e)));
			return o.filter((e) => t.has(e));
		}, [e]);
	}
	function I(e, t) {
		m((n) => {
			let r = n.envs.filter((t) => e.includes(t)), i = n.providers.filter((e) => t.includes(e));
			return r.length === n.envs.length && i.length === n.providers.length ? null : {
				envs: r,
				providers: i
			};
		});
	}
	return {
		release: () => {
			u.setState(d);
		},
		SORT_DEFAULT: $,
		SORT_ITEMS: n,
		RANGE_ITEMS: r,
		sessionFiltersStore: u,
		setQuery: _,
		setSort: v,
		setCreatedRange: y,
		setModifiedRange: b,
		toggleEnv: x,
		toggleProvider: S,
		resetFilters: C,
		hasActiveFilters: w,
		useVisibleSessions: O,
		useVisibleProjectItems: N,
		useSessionProviders: P,
		useSessionEnvs: F,
		pruneUnavailableFacets: I,
		useFilterQuery: () => h((e) => e.query),
		useSort: () => h((e) => e.sort),
		useCreatedRange: () => h((e) => e.createdRange),
		useModifiedRange: () => h((e) => e.modifiedRange),
		useSelectedEnvs: () => h((e) => e.envs),
		useSelectedProviders: () => h((e) => e.providers),
		useIsDefaultSort: () => h((e) => e.sort === $)
	};
}
var { release: Sr, SORT_ITEMS: Cr, RANGE_ITEMS: wr, sessionFiltersStore: Tr, setQuery: Er, setSort: Dr, setCreatedRange: Or, setModifiedRange: kr, toggleEnv: Ar, toggleProvider: jr, resetFilters: Mr, hasActiveFilters: Nr, useVisibleSessions: Pr, useVisibleProjectItems: Fr, useSessionProviders: Ir, useSessionEnvs: Lr, pruneUnavailableFacets: Rr, useFilterQuery: zr, useSort: Br, useCreatedRange: Vr, useModifiedRange: Hr, useSelectedEnvs: Ur, useSelectedProviders: Wr, useIsDefaultSort: Gr } = xr(K), Kr = /* @__PURE__ */ e({
	activateSessionSelection: () => gi,
	bindSidePanelProject: () => Xr,
	createSessionLayoutStore: () => qr,
	openSidePanelList: () => $r,
	release: () => Jr,
	rememberInsightListPosition: () => yi,
	rememberInsightsReturn: () => _i,
	rememberSubagentPage: () => bi,
	resetSessionSelection: () => hi,
	restoreInsightsReturn: () => vi,
	revealSidePanel: () => ri,
	selectFile: () => di,
	selectFileListing: () => pi,
	selectInsight: () => ai,
	selectInsightsFilter: () => si,
	selectRevision: () => ui,
	selectSubagent: () => li,
	selectThread: () => ii,
	selectWorkset: () => ci,
	sessionLayoutStore: () => Yr,
	setSidePanelAnimate: () => mi,
	showSidePanelList: () => ti,
	toggleFolder: () => fi,
	toggleInsightGroup: () => oi,
	toggleSidePanelCollapsed: () => ei,
	toggleSidePanelExpanded: () => Qr,
	toggleSidePanelList: () => ni,
	unbindSidePanelProject: () => Zr,
	useExpandedInsightGroups: () => Ai,
	useFileListing: () => Li,
	useInsightFocusNonce: () => ki,
	useInsightsFilter: () => ji,
	useInsightsReturn: () => xi,
	useSelectedFile: () => Fi,
	useSelectedInsight: () => Oi,
	useSelectedRevision: () => Pi,
	useSelectedSubagent: () => Ni,
	useSelectedThread: () => Ei,
	useSelectedThreadEpisode: () => Di,
	useSelectedWorkset: () => Mi,
	useSidePanelAnimate: () => Ci,
	useSidePanelCollapsed: () => Si,
	useSidePanelExpanded: () => wi,
	useSidePanelList: () => Ti,
	useToggledFolders: () => Ii
});
function qr(e) {
	let t = G({
		insightSelectionEpoch: 0,
		activeSessionId: null,
		insightsReturns: /* @__PURE__ */ new Map(),
		subagentPageReturns: /* @__PURE__ */ new Map(),
		insightListPositions: /* @__PURE__ */ new Map(),
		collapsed: !0,
		sidePanelAnimate: !0,
		sidePanelProjectId: null,
		expanded: !1,
		panelList: !1,
		selectedThread: null,
		selectedThreadEpisode: null,
		selectedInsight: null,
		insightFocusNonce: 0,
		expandedInsightGroups: /* @__PURE__ */ new Set(),
		insightsFilter: "all",
		selectedWorkset: null,
		selectedSubagents: /* @__PURE__ */ new Map(),
		selectedRevision: null,
		selectedFile: null,
		toggledFolders: /* @__PURE__ */ new Set(),
		fileListing: "tree"
	}), n = t.getState(), r = 0, { getState: i, setState: a, useStore: o } = t;
	function s(e) {
		return `nac.rightSidebar.collapsed.${e || "none"}`;
	}
	function c(t) {
		try {
			let n = e?.getItem(s(t));
			if (n === "0") return !1;
			if (n === "1") return !0;
		} catch {}
		return !0;
	}
	function l(t, n) {
		try {
			e?.setItem(s(t), n ? "1" : "0");
		} catch {}
	}
	function u(e) {
		let t = i().sidePanelProjectId;
		t != null && l(t, e);
	}
	function d(e) {
		i().collapsed !== e && a({ collapsed: e }), u(e);
	}
	function f(e) {
		let t = i().sidePanelProjectId;
		if (t === e) return;
		let n = t == null && !i().collapsed, r = !n && c(e), o = i().collapsed !== r;
		a({
			sidePanelProjectId: e,
			collapsed: r,
			sidePanelAnimate: !o && i().sidePanelAnimate
		}), n && l(e, !1);
	}
	function p() {
		i().sidePanelProjectId != null && a({
			sidePanelProjectId: null,
			collapsed: !0,
			sidePanelAnimate: !1
		});
	}
	function m() {
		let e = !i().expanded;
		a(e ? {
			expanded: e,
			panelList: !1
		} : { expanded: e });
	}
	function h() {
		a({
			expanded: !0,
			panelList: !0
		});
	}
	function g() {
		d(!i().collapsed);
	}
	function _(e) {
		i().panelList !== e && a({ panelList: e });
	}
	function v() {
		a({ panelList: !i().panelList });
	}
	function y(e = !1) {
		a({ panelList: !1 }), e ? i().expanded || a({ expanded: !0 }) : d(!1);
	}
	function b(e, t = null) {
		a({
			selectedThread: e,
			selectedThreadEpisode: t
		}), e && _(!1);
	}
	function x(e) {
		a((t) => e == null ? { selectedInsight: e } : {
			selectedInsight: e,
			insightFocusNonce: t.insightFocusNonce + 1
		});
	}
	function S(e, t) {
		a((n) => {
			let r = n.expandedInsightGroups.has(e);
			if (t === r) return null;
			let i = new Set(n.expandedInsightGroups);
			return r ? i.delete(e) : i.add(e), { expandedInsightGroups: i };
		});
	}
	function C(e) {
		i().insightsFilter !== e && a({ insightsFilter: e });
	}
	function w() {
		let e = i();
		return {
			insightSelectionEpoch: e.insightSelectionEpoch,
			insightFocusNonce: e.insightFocusNonce,
			selectedInsight: e.selectedInsight,
			selectedThread: e.selectedThread,
			selectedThreadEpisode: e.selectedThreadEpisode,
			expandedInsightGroups: e.expandedInsightGroups,
			insightsFilter: e.insightsFilter,
			panelList: e.panelList
		};
	}
	function T(e, t, n) {
		let r = {
			...w(),
			selectedInsight: t,
			...n ? {
				selectedThread: n.name,
				selectedThreadEpisode: n.episode
			} : {}
		};
		a((t) => ({ insightsReturns: new Map(t.insightsReturns).set(e, r) }));
	}
	function E(e) {
		let t = i().insightsReturns.get(e);
		if (!t) return !1;
		let n = new Map(i().insightsReturns);
		return n.delete(e), a({
			...t,
			insightsReturns: n
		}), !0;
	}
	function D(e, t, n = null, r) {
		a((i) => ({ insightListPositions: new Map(i.insightListPositions).set(e, {
			top: t,
			focusNonce: r?.focusNonce ?? i.insightFocusNonce,
			sourceEpoch: r?.sourceEpoch ?? i.insightSelectionEpoch,
			anchor: n
		}) }));
	}
	function O(e, t) {
		let { expanded: n, collapsed: r } = i();
		a((i) => ({ subagentPageReturns: new Map(i.subagentPageReturns).set(t, {
			parentSessionId: e,
			context: w(),
			expanded: n,
			collapsed: r
		}) }));
	}
	function k(e) {
		let t = i();
		if (t.activeSessionId === e) return;
		let n = t.activeSessionId ? t.subagentPageReturns.get(t.activeSessionId) : null;
		L(), a({ activeSessionId: e }), n && n.parentSessionId === e && a({
			...n.context,
			expanded: n.expanded,
			collapsed: n.collapsed
		});
	}
	function A(e) {
		a({ selectedWorkset: e }), e && _(!1);
	}
	function j(e, t) {
		i().selectedSubagents.get(e) !== t && a((n) => ({ selectedSubagents: new Map(n.selectedSubagents).set(e, t) }));
	}
	function M(e) {
		a({ selectedRevision: e });
	}
	function N(e) {
		a({ selectedFile: e }), e && _(!1);
	}
	function P(e) {
		a((t) => {
			let n = new Set(t.toggledFolders);
			return n.delete(e) || n.add(e), { toggledFolders: n };
		});
	}
	function F(e) {
		a({ fileListing: e });
	}
	function I(e) {
		i().sidePanelAnimate !== e && a({ sidePanelAnimate: e });
	}
	function L() {
		a({
			insightSelectionEpoch: ++r,
			selectedThread: null,
			selectedThreadEpisode: null,
			selectedInsight: null,
			insightFocusNonce: 0,
			expandedInsightGroups: /* @__PURE__ */ new Set(),
			insightsFilter: "all",
			selectedWorkset: null,
			selectedRevision: null,
			selectedFile: null,
			toggledFolders: /* @__PURE__ */ new Set(),
			panelList: !1
		});
	}
	return {
		release: () => {
			t.setState(n);
		},
		sessionLayoutStore: t,
		bindSidePanelProject: f,
		unbindSidePanelProject: p,
		toggleSidePanelExpanded: m,
		openSidePanelList: h,
		toggleSidePanelCollapsed: g,
		showSidePanelList: _,
		toggleSidePanelList: v,
		revealSidePanel: y,
		selectThread: b,
		selectInsight: x,
		toggleInsightGroup: S,
		selectInsightsFilter: C,
		selectWorkset: A,
		selectSubagent: j,
		selectRevision: M,
		selectFile: N,
		toggleFolder: P,
		selectFileListing: F,
		setSidePanelAnimate: I,
		resetSessionSelection: L,
		activateSessionSelection: k,
		rememberInsightsReturn: T,
		restoreInsightsReturn: E,
		rememberInsightListPosition: D,
		rememberSubagentPage: O,
		useInsightsReturn: (e) => o((t) => t.insightsReturns.has(e)),
		useSidePanelCollapsed: () => o((e) => e.collapsed),
		useSidePanelAnimate: () => o((e) => e.sidePanelAnimate),
		useSidePanelExpanded: () => o((e) => e.expanded),
		useSidePanelList: () => o((e) => e.panelList),
		useSelectedThread: () => o((e) => e.selectedThread),
		useSelectedThreadEpisode: () => o((e) => e.selectedThreadEpisode),
		useSelectedInsight: () => o((e) => e.selectedInsight),
		useInsightFocusNonce: () => o((e) => e.insightFocusNonce),
		useExpandedInsightGroups: () => o((e) => e.expandedInsightGroups),
		useInsightsFilter: () => o((e) => e.insightsFilter),
		useSelectedWorkset: () => o((e) => e.selectedWorkset),
		useSelectedSubagent: (e) => o((t) => t.selectedSubagents.get(e) ?? null),
		useSelectedRevision: () => o((e) => e.selectedRevision),
		useSelectedFile: () => o((e) => e.selectedFile),
		useToggledFolders: () => o((e) => e.toggledFolders),
		useFileListing: () => o((e) => e.fileListing)
	};
}
var { release: Jr, sessionLayoutStore: Yr, bindSidePanelProject: Xr, unbindSidePanelProject: Zr, toggleSidePanelExpanded: Qr, openSidePanelList: $r, toggleSidePanelCollapsed: ei, showSidePanelList: ti, toggleSidePanelList: ni, revealSidePanel: ri, selectThread: ii, selectInsight: ai, toggleInsightGroup: oi, selectInsightsFilter: si, selectWorkset: ci, selectSubagent: li, selectRevision: ui, selectFile: di, toggleFolder: fi, selectFileListing: pi, setSidePanelAnimate: mi, resetSessionSelection: hi, activateSessionSelection: gi, rememberInsightsReturn: _i, restoreInsightsReturn: vi, rememberInsightListPosition: yi, rememberSubagentPage: bi, useInsightsReturn: xi, useSidePanelCollapsed: Si, useSidePanelAnimate: Ci, useSidePanelExpanded: wi, useSidePanelList: Ti, useSelectedThread: Ei, useSelectedThreadEpisode: Di, useSelectedInsight: Oi, useInsightFocusNonce: ki, useExpandedInsightGroups: Ai, useInsightsFilter: ji, useSelectedWorkset: Mi, useSelectedSubagent: Ni, useSelectedRevision: Pi, useSelectedFile: Fi, useToggledFolders: Ii, useFileListing: Li } = qr(K), Ri = /* @__PURE__ */ e({
	createSessionNavigationStore: () => zi,
	markSessionViewed: () => Gi,
	pruneSessionNavigation: () => Ki,
	release: () => Bi,
	restoreSessionNavigation: () => Vi,
	serializeSessionNavigation: () => Hi,
	sessionNavigationStore: () => Ui,
	toggleSessionNavigationPin: () => Wi,
	useSessionNavigationPins: () => qi,
	useSessionViewedAt: () => Ji
});
function zi(e) {
	let t = "nac.sessionNavigation", n = () => ({
		pinned: /* @__PURE__ */ new Set(),
		lastViewedAt: {}
	}), r = (e) => Array.isArray(e) ? e.filter((e) => typeof e == "string") : [];
	function i(e) {
		if (!e) return n();
		try {
			let t = JSON.parse(e);
			if (!t || typeof t != "object") return n();
			let i = t, a = i.lastViewedAt && typeof i.lastViewedAt == "object" ? Object.fromEntries(Object.entries(i.lastViewedAt).filter((e) => typeof e[1] == "string")) : {};
			return {
				pinned: new Set(r(i.pinned)),
				lastViewedAt: a
			};
		} catch {
			return n();
		}
	}
	function a(e) {
		let t = {
			pinned: [...e.pinned],
			lastViewedAt: { ...e.lastViewedAt }
		};
		return JSON.stringify(t);
	}
	function o() {
		try {
			return i(e?.getItem(t) ?? null);
		} catch {
			return n();
		}
	}
	let s = G(o(), "sessionNavigation"), c = s.getState(), { getState: u, setState: d, subscribe: f, useStore: p } = s, m = f(() => {
		try {
			e?.setItem(t, a(u()));
		} catch {}
	});
	function h(e) {
		d((t) => {
			let n = new Set(t.pinned);
			return n.delete(e) || n.add(e), { pinned: n };
		});
	}
	function g(e, t) {
		let n = l(t);
		Number.isFinite(n) && d((r) => {
			let i = r.lastViewedAt[e];
			return i && l(i) >= n ? null : { lastViewedAt: {
				...r.lastViewedAt,
				[e]: t
			} };
		});
	}
	function _(e) {
		let t = new Set(e);
		d((e) => {
			let n = new Set([...e.pinned].filter((e) => t.has(e))), r = Object.fromEntries(Object.entries(e.lastViewedAt).filter(([e]) => t.has(e)));
			return n.size === e.pinned.size && Object.keys(r).length === Object.keys(e.lastViewedAt).length ? null : {
				pinned: n,
				lastViewedAt: r
			};
		});
	}
	return {
		release: () => {
			m(), s.setState(c);
		},
		restoreSessionNavigation: i,
		serializeSessionNavigation: a,
		sessionNavigationStore: s,
		toggleSessionNavigationPin: h,
		markSessionViewed: g,
		pruneSessionNavigation: _,
		useSessionNavigationPins: () => p((e) => e.pinned),
		useSessionViewedAt: (e) => p((t) => t.lastViewedAt[e])
	};
}
var { release: Bi, restoreSessionNavigation: Vi, serializeSessionNavigation: Hi, sessionNavigationStore: Ui, toggleSessionNavigationPin: Wi, markSessionViewed: Gi, pruneSessionNavigation: Ki, useSessionNavigationPins: qi, useSessionViewedAt: Ji } = zi(K), Yi = /* @__PURE__ */ e({
	createSidebarLayoutStore: () => Xi,
	release: () => Zi,
	setSidebarOffset: () => ea,
	storeOpen: () => $i,
	storedOpen: () => Qi,
	useSidebarOffset: () => ta
});
function Xi(e) {
	let t = G({ offset: 0 }, "sidebar-layout"), n = t.getState();
	function r(e) {
		t.setState({ offset: e });
	}
	function i() {
		return t.useStore((e) => e.offset);
	}
	let a = null;
	function o() {
		try {
			let t = e?.getItem("nac.sidebar.open");
			if (t === "0") return !1;
			if (t === "1") return !0;
		} catch {}
		return a;
	}
	function s(t) {
		a = t;
		try {
			e?.setItem("nac.sidebar.open", t ? "1" : "0");
		} catch {}
	}
	return {
		release: () => {
			t.setState(n), a = null;
		},
		storedOpen: o,
		storeOpen: s,
		setSidebarOffset: r,
		useSidebarOffset: i
	};
}
var { release: Zi, storedOpen: Qi, storeOpen: $i, setSidebarOffset: ea, useSidebarOffset: ta } = Xi(K), na = /* @__PURE__ */ e({
	createSshConnectionStore: () => ra,
	markSshConnected: () => oa,
	markSshDisconnected: () => sa,
	release: () => ia,
	sshTargetFromSummary: () => la,
	sshTargetKey: () => aa,
	useSshConnectionStatus: () => ca
});
function ra(e) {
	function t(e) {
		return [
			e.ssh_host.trim(),
			e.ssh_port ?? "",
			(e.ssh_identity_file ?? "").trim()
		].join("\0");
	}
	let n = G({ byKey: {} }, "sshConnection"), r = n.getState();
	function i(e) {
		let r = t(e);
		n.setState((e) => ({ byKey: {
			...e.byKey,
			[r]: "connected"
		} }));
	}
	function a(e) {
		let r = t(e);
		n.setState((e) => ({ byKey: {
			...e.byKey,
			[r]: "disconnected"
		} }));
	}
	function o(e) {
		return n.useStore((n) => e?.ssh_host.trim() ? n.byKey[t(e)] ?? "unknown" : "unknown");
	}
	function s(e) {
		return e?.ssh_host ? {
			ssh_host: e.ssh_host,
			ssh_port: e.ssh_port ?? null,
			ssh_identity_file: e.ssh_identity_file ?? null
		} : null;
	}
	return {
		release: () => {
			n.setState(r);
		},
		sshTargetKey: t,
		markSshConnected: i,
		markSshDisconnected: a,
		useSshConnectionStatus: o,
		sshTargetFromSummary: s
	};
}
var { release: ia, sshTargetKey: aa, markSshConnected: oa, markSshDisconnected: sa, useSshConnectionStatus: ca, sshTargetFromSummary: la } = ra(K);
// src/app/runtime/presentationStores.ts
function ua(e, t, n, r) {
	return {
		promptDraftStore: Et(t, n, r),
		panelWidth: Ne(e),
		threadLogHeight: He(e),
		lastLight: Ye(e),
		attentionStore: et(e),
		chatTabsStore: ut(e),
		composerStore: rn(e),
		runtimeStore: bn(e),
		sessionFiltersStore: xr(e),
		sessionLayoutStore: qr(e),
		sessionNavigationStore: zi(e),
		sidebarLayoutStore: Xi(e),
		sshConnectionStore: ra(e)
	};
}
var da = {
	promptDraftStore: yt,
	panelWidth: Oe,
	threadLogHeight: Re,
	lastLight: qe,
	attentionStore: $e,
	chatTabsStore: lt,
	composerStore: nn,
	runtimeStore: yn,
	sessionFiltersStore: br,
	sessionLayoutStore: Kr,
	sessionNavigationStore: Ri,
	sidebarLayoutStore: Yi,
	sshConnectionStore: na
};
function fa(e) {
	e.runtimeStore.resetRuntime(null);
	for (let t of Object.values(e)) t.release();
}
// src/app/runtime/requestLifetime.ts
function pa(e, t) {
	return e.throwIfAborted(), new Promise((n, r) => {
		let i = () => r(e.reason);
		e.addEventListener("abort", i, { once: !0 }), Promise.resolve().then(() => (e.throwIfAborted(), t())).then((t) => {
			e.removeEventListener("abort", i), e.aborted ? r(e.reason) : n(t);
		}, (t) => {
			e.removeEventListener("abort", i), r(t);
		});
	});
}
function ma(e) {
	if (e instanceof y) return e;
	if (e instanceof Error && e.name === "ApiError" && "status" in e && typeof e.status == "number" && "method" in e && typeof e.method == "string" && "path" in e && typeof e.path == "string" && "requestId" in e && typeof e.requestId == "string") {
		let t = new y(e.status, e.method, e.path, "", e.requestId);
		return t.message = e.message, t.cause = e, t;
	}
	return e;
}
var ha = class extends D {
	source;
	lifetime;
	constructor(e, t) {
		super({
			endpoint: e.endpoint,
			credentials: e.credentials,
			version: e.versionPolicy,
			authorization: e.authorization
		}), this.source = e, this.lifetime = t;
	}
	url(e) {
		return this.source.url(e);
	}
	eventSourceInit() {
		return this.lifetime.throwIfAborted(), this.source.eventSourceInit();
	}
	newRequestId() {
		return this.source.newRequestId();
	}
	streamContext() {
		return pa(this.lifetime, () => this.source.streamContext());
	}
	async admit(e, t, n = {}) {
		let r = n.signal ? AbortSignal.any([this.lifetime, n.signal]) : this.lifetime, i = n.requestId ?? this.source.newRequestId();
		if (r.aborted) return {
			status: "not-sent",
			requestId: i,
			reason: "aborted"
		};
		try {
			return await pa(r, () => this.source.admit(e, t, {
				...n,
				requestId: i,
				signal: r
			}));
		} catch (e) {
			if (r.aborted) return {
				status: "uncertain",
				requestId: i,
				error: e
			};
			throw ma(e);
		}
	}
	request(e, t, n = {}) {
		let r = n.signal ? AbortSignal.any([this.lifetime, n.signal]) : this.lifetime;
		return pa(r, () => this.source.request(e, t, {
			...n,
			signal: r
		})).catch((e) => {
			throw ma(e);
		});
	}
}, ga = class {
	limit;
	requireAcknowledgement;
	entries = /* @__PURE__ */ new Map();
	closed = !1;
	constructor(e = 128, t = !1) {
		this.limit = e, this.requireAcknowledgement = t;
	}
	acquire(e, t, n = !1) {
		let r = JSON.stringify([e, t]), i = !this.requireAcknowledgement || !n, a = i ? this.entries.get(r) : void 0;
		if (i && !this.closed && !a && this.requireAcknowledgement && this.entries.size >= this.limit) {
			for (let [e, t] of this.entries) if (!t.failed && !t.readers) {
				this.entries.delete(e);
				break;
			}
		}
		i && !this.closed && !a && this.entries.size < this.limit && (a = {
			failed: this.requireAcknowledgement,
			readers: 0,
			listeners: /* @__PURE__ */ new Set()
		}, this.entries.set(r, a)), a && a.readers++;
		let o = !1, s = /* @__PURE__ */ new Set(), c = () => !this.closed && !o && !!a && this.entries.get(r) === a, l = {
			observationOnly: !i,
			get available() {
				return c();
			},
			get current() {
				return c() && !!a?.failed;
			},
			set current(e) {
				if (!c() || !a || a.failed === e) return;
				a.failed = e;
				let t = Array.from(a.listeners);
				for (let e of t) e();
			},
			subscribe(e) {
				return c() && (s.add(e), a?.listeners.add(e)), () => {
					s.delete(e), a?.listeners.delete(e);
				};
			},
			acknowledge() {
				return c() ? (l.current = !1, !0) : !1;
			},
			release: () => {
				if (!o) {
					if (a) {
						for (let e of s) a.listeners.delete(e);
						a.readers--, this.requireAcknowledgement || a.failed || a.readers || this.entries.delete(r);
					}
					s.clear(), o = !0, a = void 0;
				}
			}
		};
		return l;
	}
	close() {
		if (this.closed) return;
		this.closed = !0;
		let e = [...this.entries.values()];
		this.entries.clear();
		for (let t of e) {
			let e = Array.from(t.listeners);
			for (let t of e) t();
			t.listeners.clear();
		}
	}
}, _a = /* @__PURE__ */ new WeakMap();
function va(e) {
	if (e.terminalInputRecovery) return e.terminalInputRecovery;
	let t = _a.get(e);
	return t || (t = new ga(), _a.set(e, t)), t;
}
// src/app/features/setup/localFolder.ts
function ya(e, t) {
	if (e) return { async chooseDirectory(n, r) {
		let i = new AbortController(), a = () => i.abort();
		(r.aborted || t.aborted) && a(), r.addEventListener("abort", a, { once: !0 }), t.addEventListener("abort", a, { once: !0 });
		try {
			i.signal.throwIfAborted();
			let t = await e.chooseDirectory(n, i.signal);
			return i.signal.throwIfAborted(), t;
		} finally {
			r.removeEventListener("abort", a), t.removeEventListener("abort", a);
		}
	} };
}
function ba(e, t, n, r) {
	return t && n === "directory" && !r ? e : void 0;
}
function xa(e, t, n) {
	let r = new AbortController();
	return {
		cancel: () => r.abort(),
		settled: Promise.resolve().then(() => r.signal.aborted ? null : e.chooseDirectory(t, r.signal)).then((e) => {
			r.signal.aborted || (e === null ? n.cancelled() : typeof e != "string" || !e.startsWith("/") || e.includes("\0") || new TextEncoder().encode(e).length > 16384 ? n.failed(/* @__PURE__ */ Error("The folder picker returned an invalid local path.")) : n.selected(e));
		}, (e) => {
			r.signal.aborted || n.failed(e);
		})
	};
}
// src/app/runtime/nativeRuntime.ts
var Sa = /* @__PURE__ */ new WeakMap(), Ca = 0, wa = class {
	id = ++Ca;
	scope;
	client;
	assets;
	api;
	productNavigation;
	stores;
	queryClient;
	terminalInputRecovery;
	nativeDirectory;
	controller = new AbortController();
	disposers = /* @__PURE__ */ new Set();
	listeners = /* @__PURE__ */ new Set();
	attachments = 0;
	detachVersion = 0;
	eventSource;
	constructor(e) {
		if (e.scope.endpoint !== e.client.transport.endpoint) throw Error("Runtime scope must name the supplied client's endpoint.");
		if (this.terminalInputRecovery = new ga(128, e.requireTerminalAcknowledgement ?? !1), this.queryClient = new h({ defaultOptions: {
			queries: {
				queryKeyHashFn: (e) => g([this.id, ...e]),
				staleTime: 3e4,
				gcTime: 3e5,
				retry: e.queryRetry ?? !1,
				refetchOnWindowFocus: !1
			},
			mutations: { retry: !1 }
		} }), this.assets = e.assets ? Object.freeze({ ...e.assets }) : void 0, this.nativeDirectory = ya(e.nativeDirectory, this.controller.signal), this.stores = ua(e.storage, e.scope, e.draftStorage, e.draftPersistenceBinding), this.scope = Object.freeze({ ...e.scope }), this.client = new A(new ha(e.client.transport, this.controller.signal)), e.standaloneServingIncarnation !== void 0 && (this.scope.profile !== "standalone" || e.standaloneServingIncarnation !== this.scope.incarnation)) throw Error("Product serving binding must match the standalone runtime scope.");
		this.api = de(this.client, e.standaloneServingIncarnation), this.productNavigation = new _(this.api.resolveProductDestination, this.isClosed, this.api.getProductContext), this.eventSource = e.eventSource, Sa.set(this.queryClient, this);
	}
	isClosed = () => this.controller.signal.aborted;
	subscribe = (e) => (this.listeners.add(e), () => {
		this.listeners.delete(e);
	});
	events = (e, t) => {
		this.controller.signal.throwIfAborted();
		let n = De(e, t, {
			client: this.client,
			eventSource: this.eventSource,
			maxConnectionMs: 299e3
		}), r = () => {
			n(), this.disposers.delete(r);
		};
		return this.disposers.add(r), r;
	};
	retain = () => (this.attachments += 1, this.detachVersion += 1, () => {
		--this.attachments;
		let e = ++this.detachVersion;
		queueMicrotask(() => {
			!this.attachments && this.detachVersion === e && this.close();
		});
	});
	close() {
		if (!this.isClosed()) {
			this.controller.abort(new DOMException("Native runtime was closed.", "AbortError")), this.terminalInputRecovery.close(), this.productNavigation.close();
			for (let e of this.disposers) e();
			this.disposers.clear(), this.queryClient.cancelQueries(), this.queryClient.clear(), fa(this.stores);
			for (let e of this.listeners) e();
		}
	}
};
function Ta(e) {
	return new wa(e);
}
var Ea = {
	api: fe,
	client: M,
	stores: da,
	events: (e, t) => De(e, t)
};
function Da(e) {
	return Sa.get(e) ?? Ea;
}
// src/app/runtime/RuntimeContext.ts
var Oa = u(null);
function ka() {
	return f(Oa) ?? Ea;
}
export { pe as A, Fe as C, ve as D, _e as E, ne as F, y as I, x as L, oe as M, L as N, ye as O, R as P, je as S, ge as T, _n as _, Da as a, mn as b, va as c, gr as d, mr as f, cr as g, fr as h, Ta as i, se as j, me as k, Q as l, ur as m, ka as n, ba as o, vr as p, wa as r, xa as s, Oa as t, _r as u, gn as v, Me as w, vn as x, hn as y };
