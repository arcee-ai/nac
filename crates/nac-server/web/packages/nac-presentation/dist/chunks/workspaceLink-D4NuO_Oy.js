import { D as e, O as t, a as n, n as r, z as i } from "./RuntimeContext-zP1WS6Av.js";
import { a, y as o } from "./PresentationBoundary-BAUfAcJZ.js";
import { n as s, t as c } from "./Toast-J9CfluTU.js";
import { Profiler as l, createContext as u, useCallback as d, useContext as f, useEffect as p, useMemo as m, useReducer as ee, useRef as te, useState as ne } from "react";
import { keepPreviousData as re, useMutation as h, useQueries as ie, useQuery as g, useQueryClient as _ } from "@tanstack/react-query";
import { Fragment as ae, jsx as oe, jsxs as se } from "react/jsx-runtime";
import { createPortal as ce } from "react-dom";
// src/app/lib/routes.ts
var le = [
	"sessions",
	"insights",
	"delegated",
	"files",
	"terminal",
	"heartbeats",
	"history"
], ue = {
	sessions: "Sessions",
	insights: "Insights",
	delegated: "Subagents",
	files: "Files",
	terminal: "Terminal",
	heartbeats: "Heartbeats",
	history: "History"
};
le.filter((e) => e !== "history");
var de = "insights";
function fe(e) {
	return le.includes(e ?? "");
}
var pe = [
	"general",
	"appearance",
	"models",
	"mcp",
	"capabilities",
	"ssh",
	"managed",
	"shortcuts",
	"about"
];
function me(e) {
	return pe.includes(e ?? "");
}
var he = {
	list: () => "/",
	newSession: (e) => e ? `/?project=${encodeURIComponent(e)}` : "/",
	settings: (e = "general") => `/settings/${e}`,
	session: (e, t = de) => `/session/${encodeURIComponent(e)}/${t}`,
	project: (e) => `/project/${encodeURIComponent(e)}`,
	taskSchedules: (e) => e ? `/project/${encodeURIComponent(e)}/task-schedules` : "/task-schedules",
	designPreview: () => "/design"
};
function ge(e) {
	let [, t, n] = e.split("/");
	return t !== "session" || !n ? null : decodeURIComponent(n);
}
function _e(e) {
	let [, t, n] = e.split("/");
	return t !== "project" || !n ? null : decodeURIComponent(n);
}
// src/app/services/queries/keys.ts
var ve = 5e3, v = {
	storeInfo: ["store"],
	managedHostStatus: ["managed-host-status"],
	managedGitHub: ["managed-github"],
	managedSecrets: ["managed-secrets"],
	sandboxAvailability: ["sandbox-availability"],
	sandboxActivity: ["sandbox-activity"],
	credentials: ["credentials"],
	managedAuth: ["managed-auth"],
	sshConfigs: ["ssh-configs"],
	sshAliases: ["ssh-aliases"],
	mcpLibrary: ["mcp-library"],
	mcpServers: ["mcp-servers"],
	mcpRuntime: ["mcp-runtime"],
	browse: (e, t, n) => ["fs-browse", {
		path: e,
		kind: t,
		hidden: n
	}],
	sshBrowse: (e, t, n = !1) => ["ssh-browse", {
		host: e.ssh_host,
		port: e.ssh_port ?? null,
		identityFile: e.ssh_identity_file ?? null,
		path: t,
		hidden: n
	}],
	providerModels: (e, t, n) => ["provider-models", {
		backend: e,
		credentialIdentity: t,
		baseUrl: n
	}],
	storedKeyProviderModels: (e, t, n) => ["stored-key-provider-models", {
		backend: e,
		apiKeyEnv: t,
		baseUrl: n
	}],
	managedProviderModels: (e) => ["managed-provider-models", e],
	managedProviderModelsAll: ["managed-provider-models"],
	modelCatalog: ["model-catalog"],
	slashCommands: ["slash-commands"],
	sessionCommands: (e) => [
		"session",
		e,
		"commands"
	],
	projects: ["projects"],
	sessions: (e) => ["sessions", { workspaceStats: e }],
	sessionRoot: (e) => ["session", e],
	sessionSnapshot: (e) => [
		"session",
		e,
		"snapshot"
	],
	sessionSkills: (e) => [
		"session",
		e,
		"skills"
	],
	sessionsAll: ["sessions"],
	fleetAttention: (e) => ["fleet-attention", { projectId: e }],
	toolCallContent: (e, t, n, r) => [
		"session",
		e,
		"tool-call",
		t,
		n,
		r ?? ""
	],
	sessionConfig: (e) => [
		"session",
		e,
		"config"
	],
	sessionPermissions: (e) => [
		"session",
		e,
		"permissions"
	],
	sessionGoal: (e) => [
		"session",
		e,
		"goal"
	],
	sessionInbox: (e) => [
		"session",
		e,
		"inbox"
	],
	traditionalChildren: (e) => [
		"session",
		e,
		"children"
	],
	managedOrchestrators: (e) => [
		"session",
		e,
		"orchestrators"
	],
	workspaceDiff: (e, t, n, r, i) => [
		"session",
		e,
		"workspace-diff",
		{
			path: t,
			stage: n,
			context: r,
			revision: i
		}
	],
	workspaceDiffRoot: (e) => [
		"session",
		e,
		"workspace-diff"
	],
	branches: (e) => [
		"session",
		e,
		"branches"
	],
	workspaceFiles: (e, t) => [
		"session",
		e,
		"workspace-files",
		{ revision: t }
	],
	workspaceFilesRoot: (e) => [
		"session",
		e,
		"workspace-files"
	],
	workspaceFile: (e, t, n) => [
		"session",
		e,
		"workspace-file",
		{
			path: t,
			revision: n
		}
	],
	workspaceFileRoot: (e) => [
		"session",
		e,
		"workspace-file"
	],
	workspaceRevisions: (e) => [
		"session",
		e,
		"revisions"
	],
	workspaceRevisionChanges: (e, t) => [
		"session",
		e,
		"revisions",
		t,
		"changes"
	]
}, ye = (e) => typeof e == "function", y = function(e, t) {
	if (typeof e == "function") return function() {
		return e(arguments) ? t.apply(this, arguments) : (e) => t(e, ...arguments);
	};
	switch (e) {
		case 0:
		case 1: throw RangeError(`Invalid arity ${e}`);
		case 2: return function(e, n) {
			return arguments.length >= 2 ? t(e, n) : function(n) {
				return t(n, e);
			};
		};
		case 3: return function(e, n, r) {
			return arguments.length >= 3 ? t(e, n, r) : function(r) {
				return t(r, e, n);
			};
		};
		case 4: return function(e, n, r, i) {
			return arguments.length >= 4 ? t(e, n, r, i) : function(i) {
				return t(i, e, n, r);
			};
		};
		case 5: return function(e, n, r, i, a) {
			return arguments.length >= 5 ? t(e, n, r, i, a) : function(a) {
				return t(a, e, n, r, i);
			};
		};
		default: return function() {
			if (arguments.length >= e) return t.apply(this, arguments);
			let n = arguments;
			return function(e) {
				return t(e, ...n);
			};
		};
	}
}, b = (e) => e, be = (e) => () => e, xe = /*#__PURE__*/ be(!0), Se = /*#__PURE__*/ be(!1), Ce = /*#__PURE__*/ be(void 0), we = Ce;
function x(e, t, n, r, i, a, o, s, c) {
	switch (arguments.length) {
		case 1: return e;
		case 2: return t(e);
		case 3: return n(t(e));
		case 4: return r(n(t(e)));
		case 5: return i(r(n(t(e))));
		case 6: return a(i(r(n(t(e)))));
		case 7: return o(a(i(r(n(t(e))))));
		case 8: return s(o(a(i(r(n(t(e)))))));
		case 9: return c(s(o(a(i(r(n(t(e))))))));
		default: {
			let e = arguments[0];
			for (let t = 1; t < arguments.length; t++) e = arguments[t](e);
			return e;
		}
	}
}
// node_modules/effect/dist/esm/Equivalence.js
var Te = (e) => (t, n) => t === n || e(t, n), Ee = /*#__PURE__*/ y(2, (e, t) => Te((n, r) => e(t(n), t(r)))), De = (e) => Te((t, n) => {
	if (t.length !== n.length) return !1;
	for (let r = 0; r < t.length; r++) if (!e(t[r], n[r])) return !1;
	return !0;
}), Oe = "effect/GlobalValue", ke, S = (e, t) => (ke ||= (globalThis[Oe] ??= /* @__PURE__ */ new Map(), globalThis[Oe]), ke.has(e) || ke.set(e, t()), ke.get(e)), Ae = (e) => typeof e == "string", je = (e) => typeof e == "number", Me = (e) => typeof e == "bigint", Ne = ye, Pe = (e) => typeof e == "object" && !!e, Fe = (e) => Pe(e) || Ne(e), C = /*#__PURE__*/ y(2, (e, t) => Fe(e) && t in e), Ie = /*#__PURE__*/ y(2, (e, t) => C(e, "_tag") && e._tag === t), Le = (e) => e == null, Re = (e) => typeof e == "string" || C(e, Symbol.iterator), ze = (e) => C(e, "then") && Ne(e.then), Be = (e) => `BUG: ${e} - please report an issue at https://github.com/Effect-TS/effect/issues`, Ve = class e {
	self;
	called = !1;
	constructor(e) {
		this.self = e;
	}
	next(e) {
		return this.called ? {
			value: e,
			done: !0
		} : (this.called = !0, {
			value: this.self,
			done: !1
		});
	}
	return(e) {
		return {
			value: e,
			done: !0
		};
	}
	throw(e) {
		throw e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, He = 335903614, Ue = 4150755663, We = 1481765933, Ge = 1284865837, Ke = 9007199254740992, qe = 134217728, Je = class {
	_state;
	constructor(e, t, n, r) {
		return Le(t) && Le(e) ? (t = Math.random() * 4294967295 >>> 0, e = 0) : Le(t) && (t = e, e = 0), Le(r) && Le(n) ? (r = this._state ? this._state[3] : Ue, n = this._state ? this._state[2] : He) : Le(r) && (r = n, n = 0), this._state = new Int32Array([
			0,
			0,
			n >>> 0,
			((r || 0) | 1) >>> 0
		]), this._next(), Xe(this._state, this._state[0], this._state[1], e >>> 0, t >>> 0), this._next(), this;
	}
	getState() {
		return [
			this._state[0],
			this._state[1],
			this._state[2],
			this._state[3]
		];
	}
	setState(e) {
		this._state[0] = e[0], this._state[1] = e[1], this._state[2] = e[2], this._state[3] = e[3] | 1;
	}
	integer(e) {
		return Math.round(this.number() * (2 ** 53 - 1)) % e;
	}
	number() {
		let e = (this._next() & 67108863) * 1, t = (this._next() & 134217727) * 1;
		return (e * qe + t) / Ke;
	}
	_next() {
		let e = this._state[0] >>> 0, t = this._state[1] >>> 0;
		Ye(this._state, e, t, We, Ge), Xe(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
		let n = e >>> 18, r = (t >>> 18 | e << 14) >>> 0;
		n = (n ^ e) >>> 0, r = (r ^ t) >>> 0;
		let i = (r >>> 27 | n << 5) >>> 0, a = e >>> 27, o = (-a >>> 0 & 31) >>> 0;
		return (i >>> a | i << o) >>> 0;
	}
};
function Ye(e, t, n, r, i) {
	let a = (n >>> 16) * (i & 65535) >>> 0, o = (n & 65535) * (i >>> 16) >>> 0, s = (n & 65535) * (i & 65535) >>> 0, c = (n >>> 16) * (i >>> 16) + ((o >>> 16) + (a >>> 16)) >>> 0;
	o = o << 16 >>> 0, s = s + o >>> 0, s >>> 0 < o >>> 0 && (c = c + 1 >>> 0), a = a << 16 >>> 0, s = s + a >>> 0, s >>> 0 < a >>> 0 && (c = c + 1 >>> 0), c = c + Math.imul(n, r) >>> 0, c = c + Math.imul(t, i) >>> 0, e[0] = c, e[1] = s;
}
function Xe(e, t, n, r, i) {
	let a = t + r >>> 0, o = n + i >>> 0;
	o >>> 0 < n >>> 0 && (a = a + 1 | 0), e[0] = a, e[1] = o;
}
var Ze = /*#__PURE__*/ Symbol.for("effect/Utils/YieldWrap"), Qe = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	[Ze]() {
		return this.#e;
	}
};
function $e(e) {
	if (typeof e == "object" && e && Ze in e) return e[Ze]();
	throw Error(Be("yieldWrapGet"));
}
var et = /*#__PURE__*/ S("effect/Utils/isStructuralRegion", () => ({
	enabled: !1,
	tester: void 0
})), tt = { effect_internal_function: (e) => e() }, w = /*#__PURE__*/ tt.effect_internal_function(() => (/* @__PURE__ */ Error()).stack)?.includes("effect_internal_function") === !0 ? tt.effect_internal_function : { effect_internal_function: (e) => {
	try {
		return e();
	} finally {}
} }.effect_internal_function;
(function* () {}).constructor;
// node_modules/effect/dist/esm/Hash.js
var nt = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Hash/randomHashCache"), () => /* @__PURE__ */ new WeakMap()), T = /*#__PURE__*/ Symbol.for("effect/Hash"), E = (e) => {
	if (et.enabled === !0) return 0;
	switch (typeof e) {
		case "number": return ot(e);
		case "bigint": return O(e.toString(10));
		case "boolean": return O(String(e));
		case "symbol": return O(String(e));
		case "string": return O(e);
		case "undefined": return O("undefined");
		case "function":
		case "object": return e === null ? O("null") : e instanceof Date ? Number.isNaN(e.getTime()) ? O("Invalid Date") : E(e.toISOString()) : e instanceof URL ? E(e.href) : at(e) ? e[T]() : rt(e);
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, rt = (e) => (nt.has(e) || nt.set(e, ot(Math.floor(Math.random() * (2 ** 53 - 1)))), nt.get(e)), D = (e) => (t) => t * 53 ^ e, it = (e) => e & 3221225471 | e >>> 1 & 1073741824, at = (e) => C(e, T), ot = (e) => {
	if (e !== e || e === Infinity) return 0;
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return it(t);
}, O = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return it(t);
}, st = (e, t) => {
	let n = 12289;
	for (let r = 0; r < t.length; r++) n ^= x(O(t[r]), D(E(e[t[r]])));
	return it(n);
}, ct = (e) => st(e, Object.keys(e)), lt = (e) => {
	let t = 6151;
	for (let n = 0; n < e.length; n++) t = x(t, D(E(e[n])));
	return it(t);
}, k = function() {
	if (arguments.length === 1) {
		let e = arguments[0];
		return function(t) {
			return Object.defineProperty(e, T, {
				value() {
					return t;
				},
				enumerable: !1
			}), t;
		};
	}
	let e = arguments[0], t = arguments[1];
	return Object.defineProperty(e, T, {
		value() {
			return t;
		},
		enumerable: !1
	}), t;
}, A = /*#__PURE__*/ Symbol.for("effect/Equal");
function j() {
	return arguments.length === 1 ? (e) => ut(e, arguments[0]) : ut(arguments[0], arguments[1]);
}
function ut(e, t) {
	if (e === t) return !0;
	let n = typeof e;
	if (n !== typeof t) return !1;
	if (n === "object" || n === "function") {
		if (e !== null && t !== null) {
			if (dt(e) && dt(t)) return E(e) === E(t) && e[A](t) ? !0 : et.enabled && et.tester ? et.tester(e, t) : !1;
			if (e instanceof Date && t instanceof Date) {
				let n = e.getTime(), r = t.getTime();
				return n === r || Number.isNaN(n) && Number.isNaN(r);
			}
			if (e instanceof URL && t instanceof URL) return e.href === t.href;
		}
		if (et.enabled) {
			if (e === null || t === null) return !1;
			if (Array.isArray(e) && Array.isArray(t)) return e.length === t.length && e.every((e, n) => ut(e, t[n]));
			if (Object.getPrototypeOf(e) === Object.prototype && Object.getPrototypeOf(t) === Object.prototype) {
				let n = Object.keys(e), r = Object.keys(t);
				if (n.length === r.length) {
					for (let r of n) if (!(r in t && ut(e[r], t[r]))) return et.tester ? et.tester(e, t) : !1;
					return !0;
				}
			}
			return et.tester ? et.tester(e, t) : !1;
		}
	}
	return et.enabled && et.tester ? et.tester(e, t) : !1;
}
var dt = (e) => C(e, A), ft = () => j, M = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), N = (e) => {
	try {
		if (C(e, "toJSON") && Ne(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(N);
	} catch {
		return {};
	}
	return yt(e);
}, P = (e) => JSON.stringify(e, null, 2), pt = (e, t = 2) => {
	if (typeof e == "string") return e;
	try {
		return typeof e == "object" ? mt(e, t) : String(e);
	} catch {
		return String(e);
	}
}, mt = (e, t) => {
	let n = [], r = JSON.stringify(e, (e, t) => typeof t == "object" && t ? n.includes(t) ? void 0 : n.push(t) && (_t.fiberRefs !== void 0 && gt(t) ? t[ht](_t.fiberRefs) : t) : t, t);
	return n = void 0, r;
}, ht = /*#__PURE__*/ Symbol.for("effect/Inspectable/Redactable"), gt = (e) => typeof e == "object" && !!e && ht in e, _t = /*#__PURE__*/ S("effect/Inspectable/redactableState", () => ({ fiberRefs: void 0 })), vt = (e, t) => {
	let n = _t.fiberRefs;
	_t.fiberRefs = e;
	try {
		return t();
	} finally {
		_t.fiberRefs = n;
	}
}, yt = (e) => gt(e) && _t.fiberRefs !== void 0 ? e[ht](_t.fiberRefs) : e, F = (e, t) => {
	switch (t.length) {
		case 0: return e;
		case 1: return t[0](e);
		case 2: return t[1](t[0](e));
		case 3: return t[2](t[1](t[0](e)));
		case 4: return t[3](t[2](t[1](t[0](e))));
		case 5: return t[4](t[3](t[2](t[1](t[0](e)))));
		case 6: return t[5](t[4](t[3](t[2](t[1](t[0](e))))));
		case 7: return t[6](t[5](t[4](t[3](t[2](t[1](t[0](e)))))));
		case 8: return t[7](t[6](t[5](t[4](t[3](t[2](t[1](t[0](e))))))));
		case 9: return t[8](t[7](t[6](t[5](t[4](t[3](t[2](t[1](t[0](e)))))))));
		default: {
			let n = e;
			for (let e = 0, r = t.length; e < r; e++) n = t[e](n);
			return n;
		}
	}
}, bt = "Async", xt = "Commit", St = "Failure", Ct = "OnFailure", wt = "OnSuccess", Tt = "OnSuccessAndFailure", Et = "Success", Dt = "Sync", Ot = "UpdateRuntimeFlags", kt = "While", At = "Iterator", jt = "WithRuntime", Mt = "Yield", Nt = "RevertFlags", Pt = "3.22.2", Ft = () => Pt, It = /*#__PURE__*/ Symbol.for("effect/Effect"), Lt = /*#__PURE__*/ Symbol.for("effect/Stream"), Rt = /*#__PURE__*/ Symbol.for("effect/Sink"), zt = /*#__PURE__*/ Symbol.for("effect/Channel"), Bt = {
	/* c8 ignore next */
	_R: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e,
	_V: /*#__PURE__*/ Ft()
}, Vt = {
	/* c8 ignore next */
	_A: (e) => e,
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_L: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_R: (e) => e
}, Ht = {
	/* c8 ignore next */
	_Env: (e) => e,
	/* c8 ignore next */
	_InErr: (e) => e,
	/* c8 ignore next */
	_InElem: (e) => e,
	/* c8 ignore next */
	_InDone: (e) => e,
	/* c8 ignore next */
	_OutErr: (e) => e,
	/* c8 ignore next */
	_OutElem: (e) => e,
	/* c8 ignore next */
	_OutDone: (e) => e
}, Ut = {
	[It]: Bt,
	[Lt]: Bt,
	[Rt]: Vt,
	[zt]: Ht,
	[A](e) {
		return this === e;
	},
	[T]() {
		return k(this, rt(this));
	},
	[Symbol.iterator]() {
		return new Ve(new Qe(this));
	},
	pipe() {
		return F(this, arguments);
	}
}, Wt = {
	[T]() {
		return k(this, ct(this));
	},
	[A](e) {
		let t = Object.keys(this), n = Object.keys(e);
		if (t.length !== n.length) return !1;
		for (let n of t) if (!(n in e && j(this[n], e[n]))) return !1;
		return !0;
	}
}, Gt = {
	...Ut,
	_op: xt
}, Kt = {
	...Gt,
	...Wt
}, qt = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = Gt, e;
}(), Jt = /*#__PURE__*/ Symbol.for("effect/Option"), Yt = {
	...Ut,
	[Jt]: { _A: (e) => e },
	[M]() {
		return this.toJSON();
	},
	toString() {
		return P(this.toJSON());
	}
}, Xt = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Yt), {
	_tag: "Some",
	_op: "Some",
	[A](e) {
		return $t(e) && tn(e) && j(this.value, e.value);
	},
	[T]() {
		return k(this, D(E(this._tag))(E(this.value)));
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag,
			value: N(this.value)
		};
	}
}), Zt = /*#__PURE__*/ E("None"), Qt = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Yt), {
	_tag: "None",
	_op: "None",
	[A](e) {
		return $t(e) && en(e);
	},
	[T]() {
		return Zt;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), $t = (e) => C(e, Jt), en = (e) => e._tag === "None", tn = (e) => e._tag === "Some", nn = /*#__PURE__*/ Object.create(Qt), rn = (e) => {
	let t = Object.create(Xt);
	return t.value = e, t;
}, an = /*#__PURE__*/ Symbol.for("effect/Either"), on = {
	...Ut,
	[an]: { _R: (e) => e },
	[M]() {
		return this.toJSON();
	},
	toString() {
		return P(this.toJSON());
	}
}, sn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(on), {
	_tag: "Right",
	_op: "Right",
	[A](e) {
		return ln(e) && dn(e) && j(this.right, e.right);
	},
	[T]() {
		return D(E(this._tag))(E(this.right));
	},
	toJSON() {
		return {
			_id: "Either",
			_tag: this._tag,
			right: N(this.right)
		};
	}
}), cn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(on), {
	_tag: "Left",
	_op: "Left",
	[A](e) {
		return ln(e) && un(e) && j(this.left, e.left);
	},
	[T]() {
		return D(E(this._tag))(E(this.left));
	},
	toJSON() {
		return {
			_id: "Either",
			_tag: this._tag,
			left: N(this.left)
		};
	}
}), ln = (e) => C(e, an), un = (e) => e._tag === "Left", dn = (e) => e._tag === "Right", fn = (e) => {
	let t = Object.create(cn);
	return t.left = e, t;
}, pn = (e) => {
	let t = Object.create(sn);
	return t.right = e, t;
}, mn = fn, hn = un, gn = dn, _n = /*#__PURE__*/ (/* @__PURE__ */ y(2, (e, { onLeft: t, onRight: n }) => hn(e) ? t(e.left) : n(e.right)))({
	onLeft: b,
	onRight: b
}), vn = (e) => e.length > 0, yn = (e) => (t, n) => t === n ? 0 : e(t, n), bn = /*#__PURE__*/ yn((e, t) => e < t ? -1 : 1), xn = /*#__PURE__*/ y(2, (e, t) => yn((n, r) => e(t(n), t(r)))), Sn = (e) => y(2, (t, n) => e(t, n) === 1), I = () => nn, L = rn, Cn = en, wn = tn, Tn = /*#__PURE__*/ y(2, (e, { onNone: t, onSome: n }) => Cn(e) ? t() : n(e.value)), En = /*#__PURE__*/ y(2, (e, t) => Cn(e) ? t() : e.value), Dn = /*#__PURE__*/ y(2, (e, t) => Cn(e) ? L(t()) : e), On = (e) => e == null ? I() : L(e), kn = /*#__PURE__*/ En(Ce), An = /*#__PURE__*/ y(2, (e, t) => Cn(e) ? I() : L(t(e.value))), jn = /*#__PURE__*/ y(2, (e, t) => Cn(e) ? I() : t(e.value)), Mn = /*#__PURE__*/ ((e) => y(2, (t, n) => !Cn(t) && e(t.value, n)))(/* @__PURE__ */ ft()), Nn = (...e) => e, Pn = (e) => Array(e), Fn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.max(1, Math.floor(e)), r = Array(n);
	for (let e = 0; e < n; e++) r[e] = t(e);
	return r;
}), R = (e) => Array.isArray(e) ? e : Array.from(e), In = (e) => Array.isArray(e) ? e : [e], Ln = /*#__PURE__*/ y(2, (e, t) => [t, ...e]), Rn = /*#__PURE__*/ y(2, (e, t) => [...e, t]), zn = /*#__PURE__*/ y(2, (e, t) => R(e).concat(R(t)));
Array.isArray;
var Bn = (e) => e.length === 0, Vn = vn, Hn = vn, Un = (e, t) => e < 0 || e >= t.length, Wn = (e, t) => Math.floor(Math.min(Math.max(0, e), t.length)), Gn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.floor(t);
	return Un(n, e) ? I() : L(e[n]);
}), Kn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.floor(t);
	if (Un(n, e)) throw Error(`Index ${n} out of bounds`);
	return e[n];
}), qn = /*#__PURE__*/ Gn(0), Jn = /*#__PURE__*/ Kn(0), Yn = (e) => Hn(e) ? L(Xn(e)) : I(), Xn = (e) => e[e.length - 1], Zn = (e) => e.slice(1), Qn = (e, t) => {
	let n = 0;
	for (let r of e) {
		if (!t(r, n)) break;
		n++;
	}
	return n;
}, $n = /*#__PURE__*/ y(2, (e, t) => or(e, Qn(e, t))), er = /*#__PURE__*/ y(2, (e, t) => {
	let n = R(e);
	return n.slice(Wn(t, n), n.length);
}), tr = (e) => Array.from(e).reverse(), nr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Array.from(e);
	return n.sort(t), n;
}), rr = /*#__PURE__*/ y(2, (e, t) => ir(e, t, Nn)), ir = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = R(e), i = R(t);
	if (Hn(r) && Hn(i)) {
		let e = [n(Jn(r), Jn(i))], t = Math.min(r.length, i.length);
		for (let a = 1; a < t; a++) e[a] = n(r[a], i[a]);
		return e;
	}
	return [];
}), ar = /*#__PURE__*/ ft(), or = /*#__PURE__*/ y(2, (e, t) => {
	let n = Array.from(e), r = Math.floor(t);
	return Hn(n) ? r >= 1 ? sr(n, r) : [[], n] : [n, []];
}), sr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.max(1, Math.floor(t));
	return n >= e.length ? [cr(e), []] : [Ln(e.slice(1, n), Jn(e)), e.slice(n)];
}), cr = (e) => e.slice(), lr = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = R(e), i = R(t);
	return Hn(r) ? Hn(i) ? vr(n)(zn(r, i)) : r : i;
}), ur = /*#__PURE__*/ y(2, (e, t) => lr(e, t, ar)), dr = () => [], fr = (e) => [e], pr = /*#__PURE__*/ y(2, (e, t) => e.map(t)), mr = /*#__PURE__*/ (/* @__PURE__ */ y(2, (e, t) => {
	if (Bn(e)) return [];
	let n = [];
	for (let r = 0; r < e.length; r++) {
		let i = t(e[r], r);
		for (let e = 0; e < i.length; e++) n.push(i[e]);
	}
	return n;
}))(b), hr = /*#__PURE__*/ y(3, (e, t, n) => R(e).reduce((e, t, r) => n(e, t, r), t)), gr = (e, t) => {
	let n = [], r = e, i;
	for (; wn(i = t(r));) {
		let [e, t] = i.value;
		n.push(e), r = t;
	}
	return n;
}, _r = De, vr = /*#__PURE__*/ y(2, (e, t) => {
	let n = R(e);
	if (Hn(n)) {
		let e = [Jn(n)], r = Zn(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), yr = (e) => vr(e, ft()), br = /*#__PURE__*/ y(2, (e, t) => R(e).join(t)), xr = bn, Sr = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"), Cr = /*#__PURE__*/ Symbol.for("effect/Context/Tag"), wr = /*#__PURE__*/ Symbol.for("effect/Context/Reference"), Tr = /*#__PURE__*/ Symbol.for("effect/STM"), Er = {
	...Ut,
	_op: "Tag",
	[Tr]: Bt,
	[Cr]: {
		_Service: (e) => e,
		_Identifier: (e) => e
	},
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Tag",
			key: this.key,
			stack: this.stack
		};
	},
	[M]() {
		return this.toJSON();
	},
	of(e) {
		return e;
	},
	context(e) {
		return Br(this, e);
	}
}, Dr = {
	...Er,
	[wr]: wr
}, Or = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	let r = Object.create(Er);
	return Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r.key = e, r;
}, kr = (e) => () => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	function r() {}
	return Object.setPrototypeOf(r, Er), r.key = e, Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r;
}, Ar = () => (e, t) => {
	let n = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let r = /* @__PURE__ */ Error();
	Error.stackTraceLimit = n;
	function i() {}
	return Object.setPrototypeOf(i, Dr), i.key = e, i.defaultValue = t.defaultValue, Object.defineProperty(i, "stack", { get() {
		return r.stack;
	} }), i;
}, jr = /*#__PURE__*/ Symbol.for("effect/Context"), Mr = {
	[jr]: { _Services: (e) => e },
	[A](e) {
		if (Fr(e) && this.unsafeMap.size === e.unsafeMap.size) {
			for (let t of this.unsafeMap.keys()) if (!e.unsafeMap.has(t) || !j(this.unsafeMap.get(t), e.unsafeMap.get(t))) return !1;
			return !0;
		}
		return !1;
	},
	[T]() {
		return k(this, ot(this.unsafeMap.size));
	},
	pipe() {
		return F(this, arguments);
	},
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Context",
			services: Array.from(this.unsafeMap).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	}
}, Nr = (e) => {
	let t = Object.create(Mr);
	return t.unsafeMap = e, t;
}, Pr = (e) => {
	let t = /* @__PURE__ */ Error(`Service not found${e.key ? `: ${String(e.key)}` : ""}`);
	if (e.stack) {
		let n = e.stack.split("\n");
		if (n.length > 2) {
			let e = n[2].match(/at (.*)/);
			e && (t.message += ` (defined at ${e[1]})`);
		}
	}
	if (t.stack) {
		let e = t.stack.split("\n");
		e.splice(1, 3), t.stack = e.join("\n");
	}
	return t;
}, Fr = (e) => C(e, jr), Ir = (e) => C(e, Cr), Lr = (e) => C(e, wr), Rr = /*#__PURE__*/ Nr(/*#__PURE__*/ new Map()), zr = () => Rr, Br = (e, t) => Nr(/* @__PURE__ */ new Map([[e.key, t]])), Vr = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = new Map(e.unsafeMap);
	return r.set(t.key, n), Nr(r);
}), Hr = /*#__PURE__*/ S("effect/Context/defaultValueCache", () => /* @__PURE__ */ new Map()), Ur = (e) => {
	if (Hr.has(e.key)) return Hr.get(e.key);
	let t = e.defaultValue();
	return Hr.set(e.key, t), t;
}, Wr = (e, t) => e.unsafeMap.has(t.key) ? e.unsafeMap.get(t.key) : Ur(t), Gr = /*#__PURE__*/ y(2, (e, t) => {
	if (!e.unsafeMap.has(t.key)) {
		if (wr in t) return Ur(t);
		throw Pr(t);
	}
	return e.unsafeMap.get(t.key);
}), Kr = Gr, qr = /*#__PURE__*/ y(2, (e, t) => e.unsafeMap.has(t.key) ? rn(e.unsafeMap.get(t.key)) : Lr(t) ? rn(Ur(t)) : nn), Jr = /*#__PURE__*/ y(2, (e, t) => {
	let n = new Map(e.unsafeMap);
	for (let [e, r] of t.unsafeMap) n.set(e, r);
	return Nr(n);
}), Yr = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n = 0; n < e.length; n++) e[n].unsafeMap.forEach((e, n) => {
		t.set(n, e);
	});
	return Nr(t);
}, Xr = Or, Zr = Fr, Qr = Ir, $r = zr, ei = Br, ti = Vr, ni = Kr, ri = Gr, ii = qr, ai = Jr, oi = Yr, si = kr, ci = Ar, li = /*#__PURE__*/ Symbol.for("effect/Chunk");
function ui(e, t, n, r, i) {
	for (let a = t; a < Math.min(e.length, t + i); a++) n[r + a - t] = e[a];
	return n;
}
var di = [], fi = /*#__PURE__*/ ((e) => Te((t, n) => t.length === n.length && xi(t).every((t, r) => e(t, Ei(n, r)))))(j), pi = {
	[li]: { _A: (e) => e },
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Chunk",
			values: xi(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	[A](e) {
		return mi(e) && fi(this, e);
	},
	[T]() {
		return k(this, lt(xi(this)));
	},
	[Symbol.iterator]() {
		switch (this.backing._tag) {
			case "IArray": return this.backing.array[Symbol.iterator]();
			case "IEmpty": return di[Symbol.iterator]();
			default: return xi(this)[Symbol.iterator]();
		}
	},
	pipe() {
		return F(this, arguments);
	}
}, z = (e) => {
	let t = Object.create(pi);
	switch (t.backing = e, e._tag) {
		case "IEmpty":
			t.length = 0, t.depth = 0, t.left = t, t.right = t;
			break;
		case "IConcat":
			t.length = e.left.length + e.right.length, t.depth = 1 + Math.max(e.left.depth, e.right.depth), t.left = e.left, t.right = e.right;
			break;
		case "IArray":
			t.length = e.array.length, t.depth = 0, t.left = hi, t.right = hi;
			break;
		case "ISingleton":
			t.length = 1, t.depth = 0, t.left = hi, t.right = hi;
			break;
		case "ISlice": t.length = e.length, t.depth = e.chunk.depth + 1, t.left = hi, t.right = hi;
	}
	return t;
}, mi = (e) => C(e, li), hi = /*#__PURE__*/ z({ _tag: "IEmpty" }), gi = () => hi, _i = (...e) => Ti(e), vi = (e) => z({
	_tag: "ISingleton",
	a: e
}), yi = (e) => mi(e) ? e : wi(R(e)), bi = (e, t, n) => {
	switch (e.backing._tag) {
		case "IArray":
			ui(e.backing.array, 0, t, n, e.length);
			break;
		case "IConcat":
			bi(e.left, t, n), bi(e.right, t, n + e.left.length);
			break;
		case "ISingleton":
			t[n] = e.backing.a;
			break;
		case "ISlice": {
			let r = 0, i = n;
			for (; r < e.length;) t[i] = Ei(e, r), r += 1, i += 1;
			break;
		}
	}
}, xi = (e) => {
	switch (e.backing._tag) {
		case "IEmpty": return di;
		case "IArray": return e.backing.array;
		default: {
			let t = Array(e.length);
			return bi(e, t, 0), e.backing = {
				_tag: "IArray",
				array: t
			}, e.left = hi, e.right = hi, e.depth = 0, t;
		}
	}
}, Si = (e) => {
	switch (e.backing._tag) {
		case "IEmpty":
		case "ISingleton": return e;
		case "IArray": return z({
			_tag: "IArray",
			array: tr(e.backing.array)
		});
		case "IConcat": return z({
			_tag: "IConcat",
			left: Si(e.backing.right),
			right: Si(e.backing.left)
		});
		case "ISlice": return wi(tr(xi(e)));
	}
}, Ci = /*#__PURE__*/ y(2, (e, t) => t < 0 || t >= e.length ? I() : L(Ei(e, t))), wi = (e) => e.length === 0 ? gi() : e.length === 1 ? vi(e[0]) : z({
	_tag: "IArray",
	array: e
}), Ti = (e) => wi(e), Ei = /*#__PURE__*/ y(2, (e, t) => {
	switch (e.backing._tag) {
		case "IEmpty": throw Error("Index out of bounds");
		case "ISingleton":
			if (t !== 0) throw Error("Index out of bounds");
			return e.backing.a;
		case "IArray":
			if (t >= e.length || t < 0) throw Error("Index out of bounds");
			return e.backing.array[t];
		case "IConcat": return t < e.left.length ? Ei(e.left, t) : Ei(e.right, t - e.left.length);
		case "ISlice": return Ei(e.backing.chunk, t + e.backing.offset);
	}
}), Di = /*#__PURE__*/ y(2, (e, t) => Ai(e, vi(t))), Oi = /*#__PURE__*/ y(2, (e, t) => Ai(vi(t), e)), ki = /*#__PURE__*/ y(2, (e, t) => {
	if (t <= 0) return e;
	if (t >= e.length) return hi;
	switch (e.backing._tag) {
		case "ISlice": return z({
			_tag: "ISlice",
			chunk: e.backing.chunk,
			offset: e.backing.offset + t,
			length: e.backing.length - t
		});
		case "IConcat": return t > e.left.length ? ki(e.right, t - e.left.length) : z({
			_tag: "IConcat",
			left: ki(e.left, t),
			right: e.right
		});
		default: return z({
			_tag: "ISlice",
			chunk: e,
			offset: t,
			length: e.length - t
		});
	}
}), Ai = /*#__PURE__*/ y(2, (e, t) => {
	if (e.backing._tag === "IEmpty") return t;
	if (t.backing._tag === "IEmpty") return e;
	let n = t.depth - e.depth;
	if (Math.abs(n) <= 1) return z({
		_tag: "IConcat",
		left: e,
		right: t
	});
	if (n < -1) {
		if (e.left.depth >= e.right.depth) {
			let n = Ai(e.right, t);
			return z({
				_tag: "IConcat",
				left: e.left,
				right: n
			});
		}
		{
			let n = Ai(e.right.right, t);
			if (n.depth === e.depth - 3) {
				let t = z({
					_tag: "IConcat",
					left: e.right.left,
					right: n
				});
				return z({
					_tag: "IConcat",
					left: e.left,
					right: t
				});
			}
			return z({
				_tag: "IConcat",
				left: z({
					_tag: "IConcat",
					left: e.left,
					right: e.right.left
				}),
				right: n
			});
		}
	}
	if (t.right.depth >= t.left.depth) return z({
		_tag: "IConcat",
		left: Ai(e, t.left),
		right: t.right
	});
	{
		let n = Ai(e, t.left.left);
		return n.depth === t.depth - 3 ? z({
			_tag: "IConcat",
			left: z({
				_tag: "IConcat",
				left: n,
				right: t.left.right
			}),
			right: t.right
		}) : z({
			_tag: "IConcat",
			left: n,
			right: z({
				_tag: "IConcat",
				left: t.left.right,
				right: t.right
			})
		});
	}
}), ji = (e) => e.length === 0, Mi = (e) => e.length > 0, Ni = /*#__PURE__*/ Ci(0), Pi = (e) => Ei(e, 0), Fi = Pi, Ii = (e) => ki(e, 1), Li = /*#__PURE__*/ Symbol.for("effect/Duration"), Ri = /*#__PURE__*/ BigInt(0), zi = /*#__PURE__*/ BigInt(24), Bi = /*#__PURE__*/ BigInt(60), Vi = /*#__PURE__*/ BigInt(1e3), Hi = /*#__PURE__*/ BigInt(1e6), Ui = /*#__PURE__*/ BigInt(1e9), Wi = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Gi = (e) => {
	if (Xi(e)) return e;
	if (je(e)) return na(e);
	if (Me(e)) return ea(e);
	if (Array.isArray(e) && e.length === 2 && e.every(je)) return e[0] === -Infinity || e[1] === -Infinity || Number.isNaN(e[0]) || Number.isNaN(e[1]) ? Qi : e[0] === Infinity || e[1] === Infinity ? $i : ea(BigInt(Math.round(e[0] * 1e9)) + BigInt(Math.round(e[1])));
	if (Ae(e)) {
		let t = Wi.exec(e);
		if (t) {
			let [e, n, r] = t, i = Number(n);
			switch (r) {
				case "nano":
				case "nanos": return ea(BigInt(n));
				case "micro":
				case "micros": return ta(BigInt(n));
				case "milli":
				case "millis": return na(i);
				case "second":
				case "seconds": return ra(i);
				case "minute":
				case "minutes": return ia(i);
				case "hour":
				case "hours": return aa(i);
				case "day":
				case "days": return oa(i);
				case "week":
				case "weeks": return sa(i);
			}
		}
	}
	throw Error("Invalid DurationInput");
}, Ki = {
	_tag: "Millis",
	millis: 0
}, qi = { _tag: "Infinity" }, Ji = {
	[Li]: Li,
	[T]() {
		return k(this, ct(this.value));
	},
	[A](e) {
		return Xi(e) && ga(this, e);
	},
	toString() {
		return `Duration(${va(this)})`;
	},
	toJSON() {
		switch (this.value._tag) {
			case "Millis": return {
				_id: "Duration",
				_tag: "Millis",
				millis: this.value.millis
			};
			case "Nanos": return {
				_id: "Duration",
				_tag: "Nanos",
				hrtime: ua(this)
			};
			case "Infinity": return {
				_id: "Duration",
				_tag: "Infinity"
			};
		}
	},
	[M]() {
		return this.toJSON();
	},
	pipe() {
		return F(this, arguments);
	}
}, Yi = (e) => {
	let t = Object.create(Ji);
	return t.value = je(e) ? isNaN(e) || e <= 0 ? Ki : Number.isFinite(e) ? Number.isInteger(e) ? {
		_tag: "Millis",
		millis: e
	} : {
		_tag: "Nanos",
		nanos: BigInt(Math.round(e * 1e6))
	} : qi : e <= Ri ? Ki : {
		_tag: "Nanos",
		nanos: e
	}, t;
}, Xi = (e) => C(e, Li), Zi = (e) => {
	switch (e.value._tag) {
		case "Millis": return e.value.millis === 0;
		case "Nanos": return e.value.nanos === Ri;
		case "Infinity": return !1;
	}
}, Qi = /*#__PURE__*/ Yi(0), $i = /*#__PURE__*/ Yi(Infinity), ea = (e) => Yi(e), ta = (e) => Yi(e * Vi), na = (e) => Yi(e), ra = (e) => Yi(e * 1e3), ia = (e) => Yi(e * 6e4), aa = (e) => Yi(e * 36e5), oa = (e) => Yi(e * 864e5), sa = (e) => Yi(e * 6048e5), ca = (e) => da(e, {
	onMillis: (e) => e,
	onNanos: (e) => Number(e) / 1e6
}), la = (e) => {
	let t = Gi(e);
	switch (t.value._tag) {
		case "Infinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return BigInt(Math.round(t.value.millis * 1e6));
	}
}, ua = (e) => {
	let t = Gi(e);
	switch (t.value._tag) {
		case "Infinity": return [Infinity, 0];
		case "Nanos": return [Number(t.value.nanos / Ui), Number(t.value.nanos % Ui)];
		case "Millis": return [Math.floor(t.value.millis / 1e3), Math.round(t.value.millis % 1e3 * 1e6)];
	}
}, da = /*#__PURE__*/ y(2, (e, t) => {
	let n = Gi(e);
	switch (n.value._tag) {
		case "Nanos": return t.onNanos(n.value.nanos);
		case "Infinity": return t.onMillis(Infinity);
		case "Millis": return t.onMillis(n.value.millis);
	}
}), fa = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = Gi(e), i = Gi(t);
	if (r.value._tag === "Infinity" || i.value._tag === "Infinity") return n.onMillis(ca(r), ca(i));
	if (r.value._tag === "Nanos" || i.value._tag === "Nanos") {
		let e = r.value._tag === "Nanos" ? r.value.nanos : BigInt(Math.round(r.value.millis * 1e6)), t = i.value._tag === "Nanos" ? i.value.nanos : BigInt(Math.round(i.value.millis * 1e6));
		return n.onNanos(e, t);
	}
	return n.onMillis(r.value.millis, i.value.millis);
}), pa = (e, t) => fa(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t
}), ma = /*#__PURE__*/ y(2, (e, t) => fa(e, t, {
	onMillis: (e, t) => e <= t,
	onNanos: (e, t) => e <= t
})), ha = /*#__PURE__*/ y(2, (e, t) => fa(e, t, {
	onMillis: (e, t) => e >= t,
	onNanos: (e, t) => e >= t
})), ga = /*#__PURE__*/ y(2, (e, t) => pa(Gi(e), Gi(t))), _a = (e) => {
	let t = Gi(e);
	if (t.value._tag === "Infinity") return {
		days: Infinity,
		hours: Infinity,
		minutes: Infinity,
		seconds: Infinity,
		millis: Infinity,
		nanos: Infinity
	};
	let n = la(t), r = n / Hi, i = r / Vi, a = i / Bi, o = a / Bi, s = o / zi;
	return {
		days: Number(s),
		hours: Number(o % zi),
		minutes: Number(a % Bi),
		seconds: Number(i % Bi),
		millis: Number(r % Vi),
		nanos: Number(n % Hi)
	};
}, va = (e) => {
	let t = Gi(e);
	if (t.value._tag === "Infinity") return "Infinity";
	if (Zi(t)) return "0";
	let n = _a(t), r = [];
	return n.days !== 0 && r.push(`${n.days}d`), n.hours !== 0 && r.push(`${n.hours}h`), n.minutes !== 0 && r.push(`${n.minutes}m`), n.seconds !== 0 && r.push(`${n.seconds}s`), n.millis !== 0 && r.push(`${n.millis}ms`), n.nanos !== 0 && r.push(`${n.nanos}ns`), r.join(" ");
}, ya = 32, ba = ya - 1, xa = ya / 2, Sa = ya / 4;
// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function Ca(e) {
	return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), e = e + (e >> 4) & 252645135, e += e >> 8, e += e >> 16, e & 127;
}
function wa(e, t) {
	return t >>> e & ba;
}
function Ta(e) {
	return 1 << e;
}
function Ea(e, t) {
	return Ca(e & t - 1);
}
// node_modules/effect/dist/esm/internal/stack.js
var Da = (e, t) => ({
	value: e,
	previous: t
});
// node_modules/effect/dist/esm/internal/hashMap/array.js
function Oa(e, t, n, r) {
	let i = r;
	if (!e) {
		let e = r.length;
		i = Array(e);
		for (let t = 0; t < e; ++t) i[t] = r[t];
	}
	return i[t] = n, i;
}
function ka(e, t, n) {
	let r = n.length - 1, i = 0, a = 0, o = n;
	if (e) i = a = t;
	else for (o = Array(r); i < t;) o[a++] = n[i++];
	for (++i; i <= r;) o[a++] = n[i++];
	return e && (o.length = r), o;
}
function Aa(e, t, n, r) {
	let i = r.length;
	if (e) {
		let e = i;
		for (; e >= t;) r[e--] = r[e];
		return r[t] = n, r;
	}
	let a = 0, o = 0, s = Array(i + 1);
	for (; a < t;) s[o++] = r[a++];
	for (s[t] = n; a < i;) s[++o] = r[a++];
	return s;
}
// node_modules/effect/dist/esm/internal/hashMap/node.js
var ja = class e {
	_tag = "EmptyNode";
	modify(t, n, r, i, a, o) {
		let s = r(I());
		return Cn(s) ? new e() : (++o.value, new Fa(t, i, a, s));
	}
};
function Ma(e) {
	return Ie(e, "EmptyNode");
}
function Na(e) {
	return Ma(e) || e._tag === "LeafNode" || e._tag === "CollisionNode";
}
function Pa(e, t) {
	return !Ma(e) && t === e.edit;
}
var Fa = class e {
	edit;
	hash;
	key;
	value;
	_tag = "LeafNode";
	constructor(e, t, n, r) {
		this.edit = e, this.hash = t, this.key = n, this.value = r;
	}
	modify(t, n, r, i, a, o) {
		if (j(a, this.key)) {
			let n = r(this.value);
			return n === this.value ? this : Cn(n) ? (--o.value, new ja()) : Pa(this, t) ? (this.value = n, this) : new e(t, i, a, n);
		}
		let s = r(I());
		return Cn(s) ? this : (++o.value, Ha(t, n, this.hash, this, i, new e(t, i, a, s)));
	}
}, Ia = class e {
	edit;
	hash;
	children;
	_tag = "CollisionNode";
	constructor(e, t, n) {
		this.edit = e, this.hash = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		if (i === this.hash) {
			let n = Pa(this, t), i = this.updateCollisionList(n, t, this.hash, this.children, r, a, o);
			return i === this.children ? this : i.length > 1 ? new e(t, this.hash, i) : i[0];
		}
		let s = r(I());
		return Cn(s) ? this : (++o.value, Ha(t, n, this.hash, this, i, new Fa(t, i, a, s)));
	}
	updateCollisionList(e, t, n, r, i, a, o) {
		let s = r.length;
		for (let c = 0; c < s; ++c) {
			let s = r[c];
			if ("key" in s && j(a, s.key)) {
				let l = s.value, u = i(l);
				return u === l ? r : Cn(u) ? (--o.value, ka(e, c, r)) : Oa(e, c, new Fa(t, n, a, u), r);
			}
		}
		let c = i(I());
		return Cn(c) ? r : (++o.value, Oa(e, s, new Fa(t, n, a, c), r));
	}
}, La = class e {
	edit;
	mask;
	children;
	_tag = "IndexedNode";
	constructor(e, t, n) {
		this.edit = e, this.mask = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.mask, c = this.children, l = wa(n, i), u = Ta(l), d = Ea(s, u), f = s & u, p = Pa(this, t);
		if (!f) {
			let f = new ja().modify(t, n + 5, r, i, a, o);
			return f ? c.length >= xa ? Ba(t, l, f, s, c) : new e(t, s | u, Aa(p, d, f, c)) : this;
		}
		let m = c[d], ee = m.modify(t, n + 5, r, i, a, o);
		if (m === ee) return this;
		let te = s, ne;
		if (Ma(ee)) {
			if (te &= ~u, !te) return new ja();
			if (c.length <= 2 && Na(c[d ^ 1])) return c[d ^ 1];
			ne = ka(p, d, c);
		} else ne = Oa(p, d, ee, c);
		return p ? (this.mask = te, this.children = ne, this) : new e(t, te, ne);
	}
}, Ra = class e {
	edit;
	size;
	children;
	_tag = "ArrayNode";
	constructor(e, t, n) {
		this.edit = e, this.size = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.size, c = this.children, l = wa(n, i), u = c[l], d = (u || new ja()).modify(t, n + 5, r, i, a, o);
		if (u === d) return this;
		let f = Pa(this, t), p;
		if (Ma(u) && !Ma(d)) ++s, p = Oa(f, l, d, c);
		else if (!Ma(u) && Ma(d)) {
			if (--s, s <= Sa) return za(t, s, l, c);
			p = Oa(f, l, new ja(), c);
		} else p = Oa(f, l, d, c);
		return f ? (this.size = s, this.children = p, this) : new e(t, s, p);
	}
};
function za(e, t, n, r) {
	let i = Array(t - 1), a = 0, o = 0;
	for (let e = 0, t = r.length; e < t; ++e) if (e !== n) {
		let t = r[e];
		t && !Ma(t) && (i[a++] = t, o |= 1 << e);
	}
	return new La(e, o, i);
}
function Ba(e, t, n, r, i) {
	let a = [], o = r, s = 0;
	for (let e = 0; o; ++e) o & 1 && (a[e] = i[s++]), o >>>= 1;
	return a[t] = n, new Ra(e, s + 1, a);
}
function Va(e, t, n, r, i, a) {
	if (n === i) return new Ia(e, n, [a, r]);
	let o = wa(t, n), s = wa(t, i);
	if (o === s) return (t) => new La(e, Ta(o) | Ta(s), [t]);
	{
		let t = o < s ? [r, a] : [a, r];
		return new La(e, Ta(o) | Ta(s), t);
	}
}
function Ha(e, t, n, r, i, a) {
	let o, s = t;
	for (;;) {
		let t = Va(e, s, n, r, i, a);
		if (typeof t == "function") o = Da(t, o), s += 5;
		else {
			let e = t;
			for (; o != null;) e = o.value(e), o = o.previous;
			return e;
		}
	}
}
// node_modules/effect/dist/esm/internal/hashMap.js
var Ua = "effect/HashMap", Wa = /*#__PURE__*/ Symbol.for(Ua), Ga = {
	[Wa]: Wa,
	[Symbol.iterator]() {
		return new qa(this, (e, t) => [e, t]);
	},
	[T]() {
		let e = E(Ua);
		for (let t of this) e ^= x(E(t[0]), D(E(t[1])));
		return k(this, e);
	},
	[A](e) {
		if (eo(e)) {
			if (e._size !== this._size) return !1;
			for (let t of this) {
				let n = x(e, ro(t[0], E(t[0])));
				if (Cn(n) || !j(t[1], n.value)) return !1;
			}
			return !0;
		}
		return !1;
	},
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "HashMap",
			values: Array.from(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	pipe() {
		return F(this, arguments);
	}
}, Ka = (e, t, n, r) => {
	let i = Object.create(Ga);
	return i._editable = e, i._edit = t, i._root = n, i._size = r, i;
}, qa = class e {
	map;
	f;
	v;
	constructor(e, t) {
		this.map = e, this.f = t, this.v = Ya(this.map._root, this.f, void 0);
	}
	next() {
		if (Cn(this.v)) return {
			done: !0,
			value: void 0
		};
		let e = this.v.value;
		return this.v = Ja(e.cont), {
			done: !1,
			value: e.value
		};
	}
	[Symbol.iterator]() {
		return new e(this.map, this.f);
	}
}, Ja = (e) => e ? Xa(e[0], e[1], e[2], e[3], e[4]) : I(), Ya = (e, t, n = void 0) => {
	switch (e._tag) {
		case "LeafNode": return wn(e.value) ? L({
			value: t(e.key, e.value.value),
			cont: n
		}) : Ja(n);
		case "CollisionNode":
		case "ArrayNode":
		case "IndexedNode": {
			let r = e.children;
			return Xa(r.length, r, 0, t, n);
		}
		default: return Ja(n);
	}
}, Xa = (e, t, n, r, i) => {
	for (; n < e;) {
		let a = t[n++];
		if (a && !Ma(a)) return Ya(a, r, [
			e,
			t,
			n,
			r,
			i
		]);
	}
	return Ja(i);
}, Za = /*#__PURE__*/ Ka(!1, 0, /*#__PURE__*/ new ja(), 0), Qa = () => Za, $a = (e) => {
	let t = lo(Qa());
	for (let n of e) ao(t, n[0], n[1]);
	return uo(t);
}, eo = (e) => C(e, Wa), to = (e) => e && Ma(e._root), no = /*#__PURE__*/ y(2, (e, t) => ro(e, t, E(t))), ro = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = e._root, i = 0;
	for (;;) switch (r._tag) {
		case "LeafNode": return j(t, r.key) ? r.value : I();
		case "CollisionNode":
			if (n === r.hash) {
				let e = r.children;
				for (let n = 0, r = e.length; n < r; ++n) {
					let r = e[n];
					if ("key" in r && j(t, r.key)) return r.value;
				}
			}
			return I();
		case "IndexedNode": {
			let e = Ta(wa(i, n));
			if (r.mask & e) {
				r = r.children[Ea(r.mask, e)], i += 5;
				break;
			}
			return I();
		}
		case "ArrayNode":
			if (r = r.children[wa(i, n)], r) {
				i += 5;
				break;
			}
			return I();
		default: return I();
	}
}), io = /*#__PURE__*/ y(2, (e, t) => wn(ro(e, t, E(t)))), ao = /*#__PURE__*/ y(3, (e, t, n) => fo(e, t, () => L(n))), oo = /*#__PURE__*/ y(3, (e, t, n) => e._editable ? (e._root = t, e._size = n, e) : t === e._root ? e : Ka(e._editable, e._edit, t, n)), so = (e) => new qa(e, (e) => e), co = (e) => e._size, lo = (e) => Ka(!0, e._edit + 1, e._root, e._size), uo = (e) => (e._editable = !1, e), fo = /*#__PURE__*/ y(3, (e, t, n) => po(e, t, E(t), n)), po = /*#__PURE__*/ y(4, (e, t, n, r) => {
	let i = { value: e._size };
	return x(e, oo(e._root.modify(e._editable ? e._edit : NaN, 0, r, n, t, i), i.value));
}), mo = /*#__PURE__*/ y(2, (e, t) => fo(e, t, I)), ho = /*#__PURE__*/ y(2, (e, t) => _o(e, Qa(), (e, n, r) => ao(e, r, t(n, r)))), go = /*#__PURE__*/ y(2, (e, t) => _o(e, void 0, (e, n, r) => t(n, r))), _o = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = e._root;
	if (r._tag === "LeafNode") return wn(r.value) ? n(t, r.value.value, r.key) : t;
	if (r._tag === "EmptyNode") return t;
	let i = [r.children], a;
	for (; a = i.pop();) for (let e = 0, r = a.length; e < r;) {
		let r = a[e++];
		r && !Ma(r) && (r._tag === "LeafNode" ? wn(r.value) && (t = n(t, r.value.value, r.key)) : i.push(r.children));
	}
	return t;
}), vo = "effect/HashSet", yo = /*#__PURE__*/ Symbol.for(vo), bo = {
	[yo]: yo,
	[Symbol.iterator]() {
		return so(this._keyMap);
	},
	[T]() {
		return k(this, D(E(this._keyMap))(E(vo)));
	},
	[A](e) {
		return So(e) ? co(this._keyMap) === co(e._keyMap) && j(this._keyMap, e._keyMap) : !1;
	},
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "HashSet",
			values: Array.from(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	pipe() {
		return F(this, arguments);
	}
}, xo = (e) => {
	let t = Object.create(bo);
	return t._keyMap = e, t;
}, So = (e) => C(e, yo), Co = /*#__PURE__*/ xo(/*#__PURE__*/ Qa()), wo = () => Co, To = (e) => {
	let t = ko(wo());
	for (let n of e) Mo(t, n);
	return Ao(t);
}, Eo = (...e) => {
	let t = ko(wo());
	for (let n of e) Mo(t, n);
	return Ao(t);
}, Do = /*#__PURE__*/ y(2, (e, t) => io(e._keyMap, t)), Oo = (e) => co(e._keyMap), ko = (e) => xo(lo(e._keyMap)), Ao = (e) => (e._keyMap._editable = !1, e), jo = /*#__PURE__*/ y(2, (e, t) => {
	let n = ko(e);
	return t(n), Ao(n);
}), Mo = /*#__PURE__*/ y(2, (e, t) => e._keyMap._editable ? (ao(t, !0)(e._keyMap), e) : xo(ao(t, !0)(e._keyMap))), No = /*#__PURE__*/ y(2, (e, t) => e._keyMap._editable ? (mo(t)(e._keyMap), e) : xo(mo(t)(e._keyMap))), Po = /*#__PURE__*/ y(2, (e, t) => jo(e, (e) => {
	for (let n of t) No(e, n);
})), Fo = /*#__PURE__*/ y(2, (e, t) => jo(wo(), (n) => {
	Io(e, (e) => Mo(n, e));
	for (let e of t) Mo(n, e);
})), Io = /*#__PURE__*/ y(2, (e, t) => go(e._keyMap, (e, n) => t(n))), Lo = /*#__PURE__*/ y(3, (e, t, n) => _o(e._keyMap, t, (e, t, r) => n(e, r))), Ro = wo, zo = To, Bo = Eo, Vo = Do, Ho = Oo, Uo = Mo, Wo = No, Go = Po, Ko = Fo, qo = Lo, Jo = /*#__PURE__*/ Symbol.for("effect/MutableRef"), Yo = {
	[Jo]: Jo,
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "MutableRef",
			current: N(this.current)
		};
	},
	[M]() {
		return this.toJSON();
	},
	pipe() {
		return F(this, arguments);
	}
}, Xo = (e) => {
	let t = Object.create(Yo);
	return t.current = e, t;
}, Zo = (e) => e.current, Qo = /*#__PURE__*/ y(2, (e, t) => (e.current = t, e)), $o = "effect/FiberId", es = /*#__PURE__*/ Symbol.for($o), ts = "None", ns = "Runtime", rs = "Composite", is = /*#__PURE__*/ O(`${$o}-${ts}`), as = class {
	[es] = es;
	_tag = ts;
	id = -1;
	startTimeMillis = -1;
	[T]() {
		return is;
	}
	[A](e) {
		return cs(e) && e._tag === ts;
	}
	toString() {
		return P(this.toJSON());
	}
	toJSON() {
		return {
			_id: "FiberId",
			_tag: this._tag
		};
	}
	[M]() {
		return this.toJSON();
	}
}, os = class {
	id;
	startTimeMillis;
	[es] = es;
	_tag = ns;
	constructor(e, t) {
		this.id = e, this.startTimeMillis = t;
	}
	[T]() {
		return k(this, O(`${$o}-${this._tag}-${this.id}-${this.startTimeMillis}`));
	}
	[A](e) {
		return cs(e) && e._tag === ns && this.id === e.id && this.startTimeMillis === e.startTimeMillis;
	}
	toString() {
		return P(this.toJSON());
	}
	toJSON() {
		return {
			_id: "FiberId",
			_tag: this._tag,
			id: this.id,
			startTimeMillis: this.startTimeMillis
		};
	}
	[M]() {
		return this.toJSON();
	}
}, ss = /*#__PURE__*/ new as(), cs = (e) => C(e, es), ls = (e) => {
	switch (e._tag) {
		case ts: return Ro();
		case ns: return Bo(e.id);
		case rs: return x(ls(e.left), Ko(ls(e.right)));
	}
}, us = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => Xo(0)), ds = (e) => Array.from(ls(e)).map((e) => `#${e}`).join(","), fs = () => {
	let e = Zo(us);
	return x(us, Qo(e + 1)), new os(e, Date.now());
}, ps = ss, ms = ls, hs = ds, gs = fs, _s = Qa, vs = $a, ys = to, bs = no, xs = ao, Ss = so, Cs = fo, ws = ho, Ts = _o, Es = /*#__PURE__*/ Symbol.for("effect/List"), Ds = (e) => R(e), Os = /*#__PURE__*/ ((e) => Ee(_r(e), Ds))(j), ks = {
	[Es]: Es,
	_tag: "Cons",
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Cons",
			values: Ds(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	[A](e) {
		return Ns(e) && this._tag === e._tag && Os(this, e);
	},
	[T]() {
		return k(this, lt(Ds(this)));
	},
	[Symbol.iterator]() {
		let e = !1, t = this;
		return {
			next() {
				if (e) return this.return();
				if (t._tag === "Nil") return e = !0, this.return();
				let n = t.head;
				return t = t.tail, {
					done: e,
					value: n
				};
			},
			return(t) {
				return e ||= !0, {
					done: !0,
					value: t
				};
			}
		};
	},
	pipe() {
		return F(this, arguments);
	}
}, As = (e, t) => {
	let n = Object.create(ks);
	return n.head = e, n.tail = t, n;
}, js = /*#__PURE__*/ O("Nil"), Ms = /*#__PURE__*/ Object.create({
	[Es]: Es,
	_tag: "Nil",
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Nil"
		};
	},
	[M]() {
		return this.toJSON();
	},
	[T]() {
		return js;
	},
	[A](e) {
		return Ns(e) && this._tag === e._tag;
	},
	[Symbol.iterator]() {
		return { next() {
			return {
				done: !0,
				value: void 0
			};
		} };
	},
	pipe() {
		return F(this, arguments);
	}
}), Ns = (e) => C(e, Es), Ps = (e) => e._tag === "Nil", Fs = (e) => e._tag === "Cons", Is = () => Ms, Ls = (e, t) => As(e, t), Rs = Is, zs = (e) => As(e, Ms), Bs = /*#__PURE__*/ y(2, (e, t) => Hs(t, e)), Vs = /*#__PURE__*/ y(2, (e, t) => Ls(t, e)), Hs = /*#__PURE__*/ y(2, (e, t) => {
	if (Ps(e)) return t;
	if (Ps(t)) return e;
	{
		let n = As(t.head, e), r = n, i = t.tail;
		for (; !Ps(i);) {
			let t = As(i.head, e);
			r.tail = t, r = t, i = i.tail;
		}
		return n;
	}
}), Us = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = t, i = e;
	for (; !Ps(i);) r = n(r, i.head), i = i.tail;
	return r;
}), Ws = (e) => {
	let t = Rs(), n = e;
	for (; !Ps(n);) t = Vs(t, n.head), n = n.tail;
	return t;
};
Array.prototype;
var Gs = /*#__PURE__*/ function() {
	function e(e) {
		e && Object.assign(this, e);
	}
	return e.prototype = Wt, e;
}(), Ks = /*#__PURE__*/ Symbol.for("effect/DifferContextPatch");
function qs(e) {
	return e;
}
var Js = {
	...Gs.prototype,
	[Ks]: {
		_Value: qs,
		_Patch: qs
	}
}, Ys = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(Js), { _tag: "Empty" })), Xs = () => Ys, Zs = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Js), { _tag: "AndThen" }), Qs = (e, t) => {
	let n = Object.create(Zs);
	return n.first = e, n.second = t, n;
}, $s = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Js), { _tag: "AddService" }), ec = (e, t) => {
	let n = Object.create($s);
	return n.key = e, n.service = t, n;
}, tc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Js), { _tag: "RemoveService" }), nc = (e) => {
	let t = Object.create(tc);
	return t.key = e, t;
}, rc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Js), { _tag: "UpdateService" }), ic = (e, t) => {
	let n = Object.create(rc);
	return n.key = e, n.update = t, n;
}, ac = (e, t) => {
	let n = new Map(e.unsafeMap), r = Xs();
	for (let [e, i] of t.unsafeMap.entries()) if (n.has(e)) {
		let t = n.get(e);
		n.delete(e), j(t, i) || (r = oc(ic(e, () => i))(r));
	} else n.delete(e), r = oc(ec(e, i))(r);
	for (let [e] of n.entries()) r = oc(nc(e))(r);
	return r;
}, oc = /*#__PURE__*/ y(2, (e, t) => Qs(e, t)), sc = /*#__PURE__*/ y(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = !1, r = vi(e), i = new Map(t.unsafeMap);
	for (; Mi(r);) {
		let e = Fi(r), t = Ii(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AddService":
				i.set(e.key, e.service), r = t;
				break;
			case "AndThen":
				r = Oi(Oi(t, e.second), e.first);
				break;
			case "RemoveService":
				i.delete(e.key), r = t;
				break;
			case "UpdateService": i.set(e.key, e.update(i.get(e.key))), n = !0, r = t;
		}
	}
	if (!n) return Nr(i);
	let a = /* @__PURE__ */ new Map();
	for (let [e] of t.unsafeMap) i.has(e) && (a.set(e, i.get(e)), i.delete(e));
	for (let [e, t] of i) a.set(e, t);
	return Nr(a);
}), cc = /*#__PURE__*/ Symbol.for("effect/DifferHashSetPatch");
function lc(e) {
	return e;
}
var uc = {
	...Gs.prototype,
	[cc]: {
		_Value: lc,
		_Key: lc,
		_Patch: lc
	}
}, dc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(uc), { _tag: "Empty" })), fc = () => dc, pc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(uc), { _tag: "AndThen" }), mc = (e, t) => {
	let n = Object.create(pc);
	return n.first = e, n.second = t, n;
}, hc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(uc), { _tag: "Add" }), gc = (e) => {
	let t = Object.create(hc);
	return t.value = e, t;
}, _c = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(uc), { _tag: "Remove" }), vc = (e) => {
	let t = Object.create(_c);
	return t.value = e, t;
}, yc = (e, t) => {
	let [n, r] = qo([e, fc()], ([e, t], n) => Vo(n)(e) ? [Wo(n)(e), t] : [e, bc(gc(n))(t)])(t);
	return qo(r, (e, t) => bc(vc(t))(e))(n);
}, bc = /*#__PURE__*/ y(2, (e, t) => mc(e, t)), xc = /*#__PURE__*/ y(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = t, r = vi(e);
	for (; Mi(r);) {
		let e = Fi(r), t = Ii(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AndThen":
				r = Oi(e.first)(Oi(e.second)(t));
				break;
			case "Add":
				n = Uo(e.value)(n), r = t;
				break;
			case "Remove": n = Wo(e.value)(n), r = t;
		}
	}
	return n;
}), Sc = /*#__PURE__*/ Symbol.for("effect/DifferReadonlyArrayPatch");
function Cc(e) {
	return e;
}
var wc = {
	...Gs.prototype,
	[Sc]: {
		_Value: Cc,
		_Patch: Cc
	}
}, Tc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(wc), { _tag: "Empty" })), Ec = () => Tc, Dc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(wc), { _tag: "AndThen" }), Oc = (e, t) => {
	let n = Object.create(Dc);
	return n.first = e, n.second = t, n;
}, kc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(wc), { _tag: "Append" }), Ac = (e) => {
	let t = Object.create(kc);
	return t.values = e, t;
}, jc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(wc), { _tag: "Slice" }), Mc = (e, t) => {
	let n = Object.create(jc);
	return n.from = e, n.until = t, n;
}, Nc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(wc), { _tag: "Update" }), Pc = (e, t) => {
	let n = Object.create(Nc);
	return n.index = e, n.patch = t, n;
}, Fc = (e) => {
	let t = 0, n = Ec();
	for (; t < e.oldValue.length && t < e.newValue.length;) {
		let r = e.oldValue[t], i = e.newValue[t], a = e.differ.diff(r, i);
		j(a, e.differ.empty) || (n = Ic(n, Pc(t, a))), t += 1;
	}
	return t < e.oldValue.length && (n = Ic(n, Mc(0, t))), t < e.newValue.length && (n = Ic(n, Ac(er(t)(e.newValue)))), n;
}, Ic = /*#__PURE__*/ y(2, (e, t) => Oc(e, t)), Lc = /*#__PURE__*/ y(3, (e, t, n) => {
	if (e._tag === "Empty") return t;
	let r = t.slice(), i = fr(e);
	for (; Vn(i);) {
		let e = Jn(i), t = Zn(i);
		switch (e._tag) {
			case "Empty":
				i = t;
				break;
			case "AndThen":
				t.unshift(e.first, e.second), i = t;
				break;
			case "Append":
				for (let t of e.values) r.push(t);
				i = t;
				break;
			case "Slice":
				r = r.slice(e.from, e.until), i = t;
				break;
			case "Update": r[e.index] = n.patch(e.patch, r[e.index]), i = t;
		}
	}
	return r;
}), Rc = {
	[/* @__PURE__ */ Symbol.for("effect/Differ")]: {
		_P: b,
		_V: b
	},
	pipe() {
		return F(this, arguments);
	}
}, zc = (e) => {
	let t = Object.create(Rc);
	return t.empty = e.empty, t.diff = e.diff, t.combine = e.combine, t.patch = e.patch, t;
}, Bc = () => zc({
	empty: Xs(),
	combine: (e, t) => oc(t)(e),
	diff: (e, t) => ac(e, t),
	patch: (e, t) => sc(t)(e)
}), Vc = () => zc({
	empty: fc(),
	combine: (e, t) => bc(t)(e),
	diff: (e, t) => yc(e, t),
	patch: (e, t) => xc(t)(e)
}), Hc = (e) => zc({
	empty: Ec(),
	combine: (e, t) => Ic(e, t),
	diff: (t, n) => Fc({
		oldValue: t,
		newValue: n,
		differ: e
	}),
	patch: (t, n) => Lc(t, n, e)
}), Uc = () => Wc((e, t) => t), Wc = (e) => zc({
	empty: b,
	combine: (e, t) => e === b ? t : t === b ? e : (n) => t(e(n)),
	diff: (e, t) => j(e, t) ? b : be(t),
	patch: (t, n) => e(n, t(n))
}), Gc = 255, Kc = 8, qc = (e) => e & Gc, Jc = (e) => e >> Kc & Gc, Yc = (e, t) => (e & Gc) + ((t & e & Gc) << Kc), Xc = /*#__PURE__*/ Yc(0, 0), Zc = (e) => Yc(e, e), Qc = (e) => Yc(e, 0), $c = /*#__PURE__*/ y(2, (e, t) => Yc(qc(e) & ~t, Jc(e))), el = /*#__PURE__*/ y(2, (e, t) => e | t), tl = (e) => ~e >>> 0 & Gc, nl = (e) => sl(e, 32), rl = /*#__PURE__*/ y(2, (e, t) => e & ~t), il = /*#__PURE__*/ y(2, (e, t) => e | t), al = (e) => ol(e) && !dl(e), ol = (e) => sl(e, 1), sl = /*#__PURE__*/ y(2, (e, t) => (e & t) !== 0), cl = (...e) => e.reduce((e, t) => e | t, 0), ll = /*#__PURE__*/ cl(0), ul = (e) => sl(e, 4), dl = (e) => sl(e, 16), fl = /*#__PURE__*/ y(2, (e, t) => Yc(e ^ t, t)), pl = /*#__PURE__*/ y(2, (e, t) => e & (tl(qc(t)) | Jc(t)) | qc(t) & Jc(t)), ml = /*#__PURE__*/ zc({
	empty: Xc,
	diff: (e, t) => fl(e, t),
	combine: (e, t) => el(t)(e),
	patch: (e, t) => pl(t, e)
}), hl = Zc, gl = Qc, _l = $c, vl = (e, t) => ({
	_tag: "Par",
	left: e,
	right: t
}), yl = (e, t) => ({
	_tag: "Seq",
	left: e,
	right: t
}), bl = (e) => {
	let t = zs(e), n = Rs();
	for (;;) {
		let [e, r] = Us(t, [El(), Rs()], ([e, t], n) => {
			let [r, i] = xl(n);
			return [Ol(e, r), Bs(t, i)];
		});
		if (n = Sl(n, e), Ps(r)) return Ws(n);
		t = r;
	}
	throw Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, xl = (e) => {
	let t = e, n = El(), r = Rs(), i = Rs();
	for (;;) switch (t._tag) {
		case "Empty":
			if (Ps(r)) return [n, i];
			t = r.head, r = r.tail;
			break;
		case "Par":
			r = Ls(t.right, r), t = t.left;
			break;
		case "Seq": {
			let e = t.left, n = t.right;
			switch (e._tag) {
				case "Empty":
					t = n;
					break;
				case "Par": {
					let r = e.left, i = e.right;
					t = vl(yl(r, n), yl(i, n));
					break;
				}
				case "Seq": {
					let r = e.left, i = e.right;
					t = yl(r, yl(i, n));
					break;
				}
				case "Single": t = e, i = Ls(n, i);
			}
			break;
		}
		case "Single":
			if (n = Dl(n, t), Ps(r)) return [n, i];
			t = r.head, r = r.tail;
	}
	throw Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, Sl = (e, t) => {
	if (Ps(e)) return zs(jl(t));
	if (kl(t)) return e;
	let n = Ll(e.head), r = Al(t);
	return n.length === 1 && r.length === 1 && j(n[0], r[0]) ? Ls(Il(e.head, jl(t)), e.tail) : Ls(jl(t), e);
}, Cl = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockParallel"), wl = {
/* c8 ignore next */
_R: (e) => e }, Tl = class {
	map;
	[Cl] = wl;
	constructor(e) {
		this.map = e;
	}
}, El = () => new Tl(_s()), Dl = (e, t) => new Tl(Cs(e.map, t.dataSource, (e) => Dn(An(e, Di(t.blockedRequest)), () => vi(t.blockedRequest)))), Ol = (e, t) => new Tl(Ts(e.map, t.map, (e, t, n) => xs(e, n, Tn(bs(e, n), {
	onNone: () => t,
	onSome: (e) => Ai(t, e)
})))), kl = (e) => ys(e.map), Al = (e) => Array.from(Ss(e.map)), jl = (e) => Fl(ws(e.map, (e) => vi(e))), Ml = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockSequential"), Nl = {
/* c8 ignore next */
_R: (e) => e }, Pl = class {
	map;
	[Ml] = Nl;
	constructor(e) {
		this.map = e;
	}
}, Fl = (e) => new Pl(e), Il = (e, t) => new Pl(Ts(t.map, e.map, (e, t, n) => xs(e, n, Tn(bs(e, n), {
	onNone: () => gi(),
	onSome: (e) => Ai(e, t)
})))), Ll = (e) => Array.from(Ss(e.map)), Rl = (e) => Array.from(e.map), zl = "Empty", Bl = "Fail", Vl = "Interrupt", Hl = "Parallel", Ul = "Sequential", Wl = "effect/Cause", Gl = /*#__PURE__*/ Symbol.for(Wl), Kl = {
/* c8 ignore next */
_E: (e) => e }, ql = {
	[Gl]: Kl,
	[T]() {
		return x(E(Wl), D(E(mu(this))), k(this));
	},
	[A](e) {
		return eu(e) && pu(this, e);
	},
	pipe() {
		return F(this, arguments);
	},
	toJSON() {
		switch (this._tag) {
			case "Empty": return {
				_id: "Cause",
				_tag: this._tag
			};
			case "Die": return {
				_id: "Cause",
				_tag: this._tag,
				defect: N(this.defect)
			};
			case "Interrupt": return {
				_id: "Cause",
				_tag: this._tag,
				fiberId: this.fiberId.toJSON()
			};
			case "Fail": return {
				_id: "Cause",
				_tag: this._tag,
				failure: N(this.error)
			};
			case "Sequential":
			case "Parallel": return {
				_id: "Cause",
				_tag: this._tag,
				left: N(this.left),
				right: N(this.right)
			};
		}
	},
	toString() {
		return wu(this);
	},
	[M]() {
		return this.toJSON();
	}
}, Jl = /*#__PURE__*/ (() => {
	let e = /*#__PURE__*/ Object.create(ql);
	return e._tag = zl, e;
})(), Yl = (e) => {
	let t = Object.create(ql);
	return t._tag = Bl, t.error = e, t;
}, Xl = (e) => {
	let t = Object.create(ql);
	return t._tag = "Die", t.defect = e, t;
}, Zl = (e) => {
	let t = Object.create(ql);
	return t._tag = Vl, t.fiberId = e, t;
}, Ql = (e, t) => {
	let n = Object.create(ql);
	return n._tag = Hl, n.left = e, n.right = t, n;
}, $l = (e, t) => {
	let n = Object.create(ql);
	return n._tag = Ul, n.left = e, n.right = t, n;
}, eu = (e) => C(e, Gl), tu = (e) => e._tag === zl, nu = (e) => e._tag === "Empty" || Su(e, !0, (e, t) => {
	switch (t._tag) {
		case zl: return L(e);
		case "Die":
		case Bl:
		case Vl: return L(!1);
		default: return I();
	}
}), ru = (e) => wn(uu(e)), iu = (e) => Cu(void 0, vu)(e), au = (e) => Si(Su(e, gi(), (e, t) => t._tag === "Fail" ? L(x(e, Oi(t.error))) : I())), ou = (e) => Si(Su(e, gi(), (e, t) => t._tag === "Die" ? L(x(e, Oi(t.defect))) : I())), su = (e) => Su(e, Ro(), (e, t) => t._tag === "Interrupt" ? L(x(e, Uo(t.fiberId))) : I()), cu = (e) => gu(e, (e) => e._tag === "Fail" ? L(e.error) : I()), lu = (e) => {
	let t = cu(e);
	switch (t._tag) {
		case "None": return pn(e);
		case "Some": return mn(t.value);
	}
}, uu = (e) => gu(e, (e) => e._tag === "Interrupt" ? L(e.fiberId) : I()), du = (e) => xu(e, {
	onEmpty: Jl,
	onFail: () => Jl,
	onDie: Xl,
	onInterrupt: Zl,
	onSequential: $l,
	onParallel: Ql
}), fu = (e) => xu(e, {
	onEmpty: Jl,
	onFail: Xl,
	onDie: Xl,
	onInterrupt: Zl,
	onSequential: $l,
	onParallel: Ql
}), pu = (e, t) => {
	let n = vi(e), r = vi(t);
	for (; Mi(n) && Mi(r);) {
		let [e, t] = x(Fi(n), Su([Ro(), gi()], ([e, t], n) => {
			let [r, i] = _u(n);
			return L([x(e, Ko(r)), x(t, Ai(i))]);
		})), [i, a] = x(Fi(r), Su([Ro(), gi()], ([e, t], n) => {
			let [r, i] = _u(n);
			return L([x(e, Ko(r)), x(t, Ai(i))]);
		}));
		if (!j(e, i)) return !1;
		n = t, r = a;
	}
	return !0;
}, mu = (e) => hu(vi(e), gi()), hu = (e, t) => {
	for (;;) {
		let [n, r] = x(e, hr([Ro(), gi()], ([e, t], n) => {
			let [r, i] = _u(n);
			return [x(e, Ko(r)), x(t, Ai(i))];
		})), i = Ho(n) > 0 ? x(t, Oi(n)) : t;
		if (ji(r)) return Si(i);
		e = r, t = i;
	}
	throw Error(Be("Cause.flattenCauseLoop"));
}, gu = /*#__PURE__*/ y(2, (e, t) => {
	let n = [e];
	for (; n.length > 0;) {
		let e = n.pop(), r = t(e);
		switch (r._tag) {
			case "None":
				switch (e._tag) {
					case Ul:
					case Hl: n.push(e.right), n.push(e.left);
				}
				break;
			case "Some": return r;
		}
	}
	return I();
}), _u = (e) => {
	let t = e, n = [], r = Ro(), i = gi();
	for (; t !== void 0;) switch (t._tag) {
		case zl:
			if (n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Bl:
			if (r = Uo(r, _i(t._tag, t.error)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case "Die":
			if (r = Uo(r, _i(t._tag, t.defect)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Vl:
			if (r = Uo(r, _i(t._tag, t.fiberId)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Ul:
			switch (t.left._tag) {
				case zl:
					t = t.right;
					break;
				case Ul:
					t = $l(t.left.left, $l(t.left.right, t.right));
					break;
				case Hl:
					t = Ql($l(t.left.left, t.right), $l(t.left.right, t.right));
					break;
				default: i = Oi(i, t.right), t = t.left;
			}
			break;
		case Hl: n.push(t.right), t = t.left;
	}
	throw Error(Be("Cause.evaluateCauseLoop"));
}, vu = {
	emptyCase: xe,
	failCase: Se,
	dieCase: Se,
	interruptCase: xe,
	sequentialCase: (e, t, n) => t && n,
	parallelCase: (e, t, n) => t && n
}, yu = "SequentialCase", bu = "ParallelCase", xu = /*#__PURE__*/ y(2, (e, { onDie: t, onEmpty: n, onFail: r, onInterrupt: i, onParallel: a, onSequential: o }) => Cu(e, void 0, {
	emptyCase: () => n,
	failCase: (e, t) => r(t),
	dieCase: (e, n) => t(n),
	interruptCase: (e, t) => i(t),
	sequentialCase: (e, t, n) => o(t, n),
	parallelCase: (e, t, n) => a(t, n)
})), Su = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = t, i = e, a = [];
	for (; i !== void 0;) {
		let e = n(r, i);
		switch (r = wn(e) ? e.value : r, i._tag) {
			case Ul:
				a.push(i.right), i = i.left;
				break;
			case Hl:
				a.push(i.right), i = i.left;
				break;
			default: i = void 0;
		}
		i === void 0 && a.length > 0 && (i = a.pop());
	}
	return r;
}), Cu = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._tag) {
			case zl:
				i.push(pn(n.emptyCase(t)));
				break;
			case Bl:
				i.push(pn(n.failCase(t, e.error)));
				break;
			case "Die":
				i.push(pn(n.dieCase(t, e.defect)));
				break;
			case Vl:
				i.push(pn(n.interruptCase(t, e.fiberId)));
				break;
			case Ul:
				r.push(e.right), r.push(e.left), i.push(mn({ _tag: yu }));
				break;
			case Hl: r.push(e.right), r.push(e.left), i.push(mn({ _tag: bu }));
		}
	}
	let a = [];
	for (; i.length > 0;) {
		let e = i.pop();
		switch (e._tag) {
			case "Left":
				switch (e.left._tag) {
					case yu: {
						let e = a.pop(), r = a.pop(), i = n.sequentialCase(t, e, r);
						a.push(i);
						break;
					}
					case bu: {
						let e = a.pop(), r = a.pop(), i = n.parallelCase(t, e, r);
						a.push(i);
						break;
					}
				}
				break;
			case "Right": a.push(e.right);
		}
	}
	if (a.length === 0) throw Error("BUG: Cause.reduceWithContext - please report an issue at https://github.com/Effect-TS/effect/issues");
	return a.pop();
}), wu = (e, t) => iu(e) ? "All fibers interrupted without errors." : Mu(e).map(function(e) {
	return t?.renderErrorCause !== !0 || e.cause === void 0 ? e.stack : `${e.stack} {\n${Tu(e.cause, "  ")}\n}`;
}).join("\n"), Tu = (e, t) => {
	let n = e.stack.split("\n"), r = `${t}[cause]: ${n[0]}`;
	for (let e = 1, i = n.length; e < i; e++) r += `\n${t}${n[e]}`;
	return e.cause && (r += ` {\n${Tu(e.cause, `${t}  `)}\n${t}}`), r;
}, Eu = (e) => {
	let t = typeof e == "object" && !!e, n = Error.stackTraceLimit;
	Error.stackTraceLimit = 1;
	let r = Error(Du(e), t && "cause" in e && e.cause !== void 0 ? { cause: Eu(e.cause) } : void 0);
	return Error.stackTraceLimit = n, r.message === "" && (r.message = "An error has occurred"), Error.stackTraceLimit = n, r.name = e instanceof Error ? e.name : "Error", t && (ju in e && (r.span = e[ju]), Object.keys(e).forEach((t) => {
		t in r || (r[t] = e[t]);
	})), r.stack = Au(`${r.name}: ${r.message}`, e instanceof Error && e.stack ? e.stack : "", r.span), r;
}, Du = (e) => {
	if (typeof e == "string") return e;
	if (typeof e == "object" && e && e instanceof Error) return e.message;
	try {
		if (C(e, "toString") && Ne(e.toString) && e.toString !== Object.prototype.toString && e.toString !== globalThis.Array.prototype.toString) return e.toString();
	} catch {}
	return mt(e);
}, Ou = /\((.*)\)/g, ku = /*#__PURE__*/ S("effect/Tracer/spanToTrace", () => /* @__PURE__ */ new WeakMap()), Au = (e, t, n) => {
	let r = [e], i = t.startsWith(e) ? t.slice(e.length).split("\n") : t.split("\n");
	for (let e = 1; e < i.length; e++) if (i[e].includes(" at new BaseEffectError") || i[e].includes(" at new YieldableError")) e++;
	else {
		if (i[e].includes("Generator.next") || i[e].includes("effect_internal_function")) break;
		r.push(i[e].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
	}
	if (n) {
		let e = n, t = 0;
		for (; e && e._tag === "Span" && t < 10;) {
			let n = ku.get(e);
			if (typeof n == "function") {
				let t = n();
				if (typeof t == "string") {
					let n = t.matchAll(Ou), i = !1;
					for (let [, t] of n) i = !0, r.push(`    at ${e.name} (${t})`);
					i || r.push(`    at ${e.name} (${t.replace(/^at /, "")})`);
				} else r.push(`    at ${e.name}`);
			} else r.push(`    at ${e.name}`);
			e = kn(e.parent), t++;
		}
	}
	return r.join("\n");
}, ju = /*#__PURE__*/ Symbol.for("effect/SpanAnnotation"), Mu = (e) => Cu(e, void 0, {
	emptyCase: () => [],
	dieCase: (e, t) => [Eu(t)],
	failCase: (e, t) => [Eu(t)],
	interruptCase: () => [],
	parallelCase: (e, t, n) => [...t, ...n],
	sequentialCase: (e, t, n) => [...t, ...n]
}), Nu = "Pending", Pu = "Done", Fu = /*#__PURE__*/ Symbol.for("effect/Deferred"), Iu = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Lu = (e) => ({
	_tag: Nu,
	joiners: e
}), Ru = (e) => ({
	_tag: Pu,
	effect: e
}), zu = class e {
	self;
	called = !1;
	constructor(e) {
		this.self = e;
	}
	next(e) {
		return this.called ? {
			value: e,
			done: !0
		} : (this.called = !0, {
			value: this.self,
			done: !1
		});
	}
	return(e) {
		return {
			value: e,
			done: !0
		};
	}
	throw(e) {
		throw e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, Bu = (e, t) => {
	let n = new B("Blocked");
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}, Vu = (e) => {
	let t = new B("RunBlocked");
	return t.effect_instruction_i0 = e, t;
}, Hu = /*#__PURE__*/ Symbol.for("effect/Effect"), Uu = class {
	patch;
	op;
	_op = Nt;
	constructor(e, t) {
		this.patch = e, this.op = t;
	}
}, B = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Hu] = Bt;
	constructor(e) {
		this._op = e;
	}
	[A](e) {
		return this === e;
	}
	[T]() {
		return k(this, rt(this));
	}
	pipe() {
		return F(this, arguments);
	}
	toJSON() {
		return {
			_id: "Effect",
			_op: this._op,
			effect_instruction_i0: N(this.effect_instruction_i0),
			effect_instruction_i1: N(this.effect_instruction_i1),
			effect_instruction_i2: N(this.effect_instruction_i2)
		};
	}
	toString() {
		return P(this.toJSON());
	}
	[M]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new zu(new Qe(this));
	}
}, Wu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Hu] = Bt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[A](e) {
		return Uf(e) && e._op === "Failure" && j(this.effect_instruction_i0, e.effect_instruction_i0);
	}
	[T]() {
		return x(O(this._tag), D(E(this.effect_instruction_i0)), k(this));
	}
	get cause() {
		return this.effect_instruction_i0;
	}
	pipe() {
		return F(this, arguments);
	}
	toJSON() {
		return {
			_id: "Exit",
			_tag: this._op,
			cause: this.cause.toJSON()
		};
	}
	toString() {
		return P(this.toJSON());
	}
	[M]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new zu(new Qe(this));
	}
}, Gu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Hu] = Bt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[A](e) {
		return Uf(e) && e._op === "Success" && j(this.effect_instruction_i0, e.effect_instruction_i0);
	}
	[T]() {
		return x(O(this._tag), D(E(this.effect_instruction_i0)), k(this));
	}
	get value() {
		return this.effect_instruction_i0;
	}
	pipe() {
		return F(this, arguments);
	}
	toJSON() {
		return {
			_id: "Exit",
			_tag: this._op,
			value: N(this.value)
		};
	}
	toString() {
		return P(this.toJSON());
	}
	[M]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new zu(new Qe(this));
	}
}, Ku = (e) => C(e, Hu), V = (e) => {
	let t = new B(jt);
	return t.effect_instruction_i0 = e, t;
}, qu = /*#__PURE__*/ y(3, (e, t, n) => Ed((r) => W(e, (e) => W(od(q(() => r(t(e)))), (t) => q(() => n(e, t)).pipe(md({
	onFailure: (e) => {
		switch (t._tag) {
			case St: return U($l(t.effect_instruction_i0, e));
			case Et: return U(e);
		}
	},
	onSuccess: () => t
})))))), Ju = /*#__PURE__*/ y(2, (e, t) => W(e, () => K(t))), Yu = (e) => Ju(e, void 0), Xu = function() {
	let e = new B(xt);
	switch (arguments.length) {
		case 2:
			e.effect_instruction_i0 = arguments[0], e.commit = arguments[1];
			break;
		case 3:
			e.effect_instruction_i0 = arguments[0], e.effect_instruction_i1 = arguments[1], e.commit = arguments[2];
			break;
		case 4:
			e.effect_instruction_i0 = arguments[0], e.effect_instruction_i1 = arguments[1], e.effect_instruction_i2 = arguments[2], e.commit = arguments[3];
			break;
		default: throw Error(Be("you're not supposed to end up here"));
	}
	return e;
}, Zu = (e, t = ps) => {
	let n = new B(bt), r;
	return n.effect_instruction_i0 = (t) => {
		r = e(t);
	}, n.effect_instruction_i1 = t, Sd(n, (e) => Ku(r) ? r : Y);
}, Qu = (e, t = ps) => q(() => Zu(e, t)), $u = (e, t = ps) => Xu(e, function() {
	let e, n;
	function r(t) {
		e ? e(t) : n === void 0 && (n = t);
	}
	let i = new B(bt);
	i.effect_instruction_i0 = (t) => {
		e = t, n && t(n);
	}, i.effect_instruction_i1 = t;
	let a, o;
	return this.effect_instruction_i0.length === 1 ? a = w(() => this.effect_instruction_i0(r)) : (o = new AbortController(), a = w(() => this.effect_instruction_i0(r, o.signal))), a || o ? Sd(i, (e) => (o && o.abort(), a ?? Y)) : i;
}), ed = /*#__PURE__*/ y(2, (e, t) => hd(e, {
	onFailure: t,
	onSuccess: K
})), td = /*#__PURE__*/ Symbol.for("effect/OriginalAnnotation"), nd = (e, t) => wn(t) ? new Proxy(e, {
	has(e, t) {
		return t === ju || t === td || t in e;
	},
	get(n, r) {
		return r === ju ? t.value : r === td ? e : n[r];
	}
}) : e, rd = (e) => Fe(e) && !(ju in e) ? V((t) => U(Xl(nd(e, yp(t))))) : U(Xl(e)), id = (e) => cd(() => Xl(new Ff(e))), ad = (e) => hd(e, {
	onFailure: (e) => K(mn(e)),
	onSuccess: (e) => K(pn(e))
}), od = (e) => pd(e, {
	onFailure: X,
	onSuccess: Z
}), H = (e) => Fe(e) && !(ju in e) ? V((t) => U(Yl(nd(e, yp(t))))) : U(Yl(e)), sd = (e) => W(J(e), H), U = (e) => {
	let t = new Wu(St);
	return t.effect_instruction_i0 = e, t;
}, cd = (e) => W(J(e), U), ld = /*#__PURE__*/ V((e) => K(e.id())), ud = (e) => V((t) => e(t.id())), W = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(wt);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}), dd = (e) => {
	let t = new B("OnStep");
	return t.effect_instruction_i0 = e, t;
}, fd = (e) => W(e, b), pd = /*#__PURE__*/ y(2, (e, t) => md(e, {
	onFailure: (e) => K(t.onFailure(e)),
	onSuccess: (e) => K(t.onSuccess(e))
})), md = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(Tt);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t.onFailure, n.effect_instruction_i2 = t.onSuccess, n;
}), hd = /*#__PURE__*/ y(2, (e, t) => md(e, {
	onFailure: (e) => {
		if (ou(e).length > 0) return U(fu(e));
		let n = au(e);
		return n.length > 0 ? t.onFailure(Pi(n)) : U(e);
	},
	onSuccess: t.onSuccess
})), gd = /*#__PURE__*/ y(2, (e, t) => q(() => {
	let n = R(e), r = Pn(n.length), i = 0;
	return Ju(kd({
		while: () => i < n.length,
		body: () => t(n[i], i),
		step: (e) => {
			r[i++] = e;
		}
	}), r);
})), _d = /*#__PURE__*/ y(2, (e, t) => q(() => {
	let n = R(e), r = 0;
	return kd({
		while: () => r < n.length,
		body: () => t(n[r], r),
		step: () => {
			r++;
		}
	});
})), vd = (e) => {
	let t = new B(Ot);
	return t.effect_instruction_i0 = hl(1), t.effect_instruction_i1 = () => e, t;
}, G = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => J(() => t(e)))), yd = /*#__PURE__*/ y(2, (e, t) => hd(e, {
	onFailure: (e) => sd(() => t.onFailure(e)),
	onSuccess: (e) => J(() => t.onSuccess(e))
})), bd = /*#__PURE__*/ y(2, (e, t) => md(e, {
	onFailure: (e) => {
		let n = lu(e);
		switch (n._tag) {
			case "Left": return sd(() => t(n.left));
			case "Right": return U(n.right);
		}
	},
	onSuccess: K
})), xd = /*#__PURE__*/ y(2, (e, t) => Ed((n) => md(n(e), {
	onFailure: (e) => {
		let n = X(e);
		return md(t(n), {
			onFailure: (t) => X($l(e, t)),
			onSuccess: () => n
		});
	},
	onSuccess: (e) => {
		let n = Z(e);
		return Ld(t(n), n);
	}
}))), Sd = /*#__PURE__*/ y(2, (e, t) => xd(e, $f({
	onFailure: (e) => iu(e) ? Yu(t(su(e))) : Y,
	onSuccess: () => Y
}))), K = (e) => {
	let t = new Gu(Et);
	return t.effect_instruction_i0 = e, t;
}, q = (e) => {
	let t = new B(xt);
	return t.commit = e, t;
}, J = (e) => {
	let t = new B(Dt);
	return t.effect_instruction_i0 = e, t;
}, Cd = /*#__PURE__*/ y((e) => e.length === 3 || e.length === 2 && !(Fe(e[1]) && "onlyEffect" in e[1]), (e, t) => W(e, (e) => {
	let n = typeof t == "function" ? t(e) : t;
	return Ku(n) ? Ju(n, e) : ze(n) ? Zu((t) => {
		n.then((n) => t(K(e)), (e) => t(H(new Hf(e, "An unknown error occurred in Effect.tap"))));
	}) : K(e);
})), wd = (e) => V((t) => e(tf(Sf, L(x(t.getFiberRef(Sf), En(() => t.scope())))))), Td = (e) => {
	let t = new B(Ot);
	return t.effect_instruction_i0 = gl(1), t.effect_instruction_i1 = () => e, t;
}, Ed = (e) => Xu(e, function() {
	let e = new B(Ot);
	return e.effect_instruction_i0 = gl(1), e.effect_instruction_i1 = (e) => ol(e) ? w(() => this.effect_instruction_i0(vd)) : w(() => this.effect_instruction_i0(Td)), e;
}), Y = /*#__PURE__*/ K(void 0), Dd = (e) => {
	let t = new B(Ot);
	return t.effect_instruction_i0 = e, t.effect_instruction_i1 = void 0, t;
}, Od = /*#__PURE__*/ y(2, (e, t) => W(t, (t) => t ? x(e, G(L)) : K(I()))), kd = (e) => {
	let t = new B(kt);
	return t.effect_instruction_i0 = e.while, t.effect_instruction_i1 = e.body, t.effect_instruction_i2 = e.step, t;
}, Ad = (e) => q(() => {
	let t = new B(At);
	return t.effect_instruction_i0 = e(), t;
}), jd = function() {
	let e = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
	return Ad(() => e(x));
}, Md = (e, ...t) => Object.defineProperty(t.length === 0 ? function(...t) {
	return Ad(() => e.apply(this, t));
} : function(...n) {
	let r = Ad(() => e.apply(this, n));
	for (let e of t) r = e(r, ...n);
	return r;
}, "length", {
	value: e.length,
	configurable: !0
}), Nd = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(Ot);
	return n.effect_instruction_i0 = t, n.effect_instruction_i1 = () => e, n;
}), Pd = (e) => {
	let t = new B(Mt);
	return e?.priority === void 0 ? t : gf(t, e.priority);
}, Fd = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => G(t, (t) => [e, t]))), Id = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => Ju(t, e))), Ld = /*#__PURE__*/ y(2, (e, t) => W(e, () => t)), Rd = /*#__PURE__*/ y(3, (e, t, n) => W(e, (e) => G(t, (t) => n(e, t)))), zd = (e) => W(ld, (t) => x(e, Bd(t))), Bd = /*#__PURE__*/ y(2, (e, t) => W(e.interruptAsFork(t), () => e.await)), Vd = {
	_tag: "All",
	syslog: 0,
	label: "ALL",
	ordinal: -(2 ** 53 - 1),
	pipe() {
		return F(this, arguments);
	}
}, Hd = {
	_tag: "Fatal",
	syslog: 2,
	label: "FATAL",
	ordinal: 5e4,
	pipe() {
		return F(this, arguments);
	}
}, Ud = {
	_tag: "Error",
	syslog: 3,
	label: "ERROR",
	ordinal: 4e4,
	pipe() {
		return F(this, arguments);
	}
}, Wd = {
	_tag: "Warning",
	syslog: 4,
	label: "WARN",
	ordinal: 3e4,
	pipe() {
		return F(this, arguments);
	}
}, Gd = {
	_tag: "Info",
	syslog: 6,
	label: "INFO",
	ordinal: 2e4,
	pipe() {
		return F(this, arguments);
	}
}, Kd = {
	_tag: "Debug",
	syslog: 7,
	label: "DEBUG",
	ordinal: 1e4,
	pipe() {
		return F(this, arguments);
	}
}, qd = {
	_tag: "Trace",
	syslog: 7,
	label: "TRACE",
	ordinal: 0,
	pipe() {
		return F(this, arguments);
	}
}, Jd = {
	_tag: "None",
	syslog: 7,
	label: "OFF",
	ordinal: 2 ** 53 - 1,
	pipe() {
		return F(this, arguments);
	}
}, Yd = /*#__PURE__*/ Symbol.for("effect/FiberRef"), Xd = {
/* c8 ignore next */
_A: (e) => e }, Zd = (e) => V((t) => Z(t.getFiberRef(e))), Qd = /*#__PURE__*/ y(2, (e, t) => W(Zd(e), t)), $d = /*#__PURE__*/ y(2, (e, t) => ef(e, () => [void 0, t])), ef = /*#__PURE__*/ y(2, (e, t) => V((n) => {
	let [r, i] = t(n.getFiberRef(e));
	return n.setFiberRef(e, i), K(r);
})), tf = /*#__PURE__*/ y(3, (e, t, n) => qu(Id(Zd(t), $d(t, n)), () => e, (e) => $d(t, e))), nf = /*#__PURE__*/ y(3, (e, t, n) => Qd(t, (r) => tf(e, t, n(r)))), rf = (e, t) => cf(e, {
	differ: Uc(),
	fork: t?.fork ?? b,
	join: t?.join
}), af = (e) => {
	let t = Vc();
	return cf(e, {
		differ: t,
		fork: t.empty
	});
}, of = (e) => {
	let t = Hc(Uc());
	return cf(e, {
		differ: t,
		fork: t.empty
	});
}, sf = (e) => {
	let t = Bc();
	return cf(e, {
		differ: t,
		fork: t.empty
	});
}, cf = (e, t) => ({
	...Gt,
	[Yd]: Xd,
	initial: e,
	commit() {
		return Zd(this);
	},
	diff: (e, n) => t.differ.diff(e, n),
	combine: (e, n) => t.differ.combine(e, n),
	patch: (e) => (n) => t.differ.patch(e, n),
	fork: t.fork,
	join: t.join ?? ((e, t) => t)
}), lf = (e) => cf(e, {
	differ: ml,
	fork: ml.empty
}), uf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentContext"), () => sf($r())), df = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => rf(0)), ff = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => rf(2048)), pf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => rf(_s())), mf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogLevel"), () => rf(Gd)), hf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogSpan"), () => rf(Rs())), gf = /*#__PURE__*/ y(2, (e, t) => tf(e, df, t)), _f = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentConcurrency"), () => rf("unbounded")), vf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestBatching"), () => rf(!0)), yf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => rf(L(Kd))), bf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => rf(L(Wd))), xf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMetricLabels"), () => of(dr())), Sf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => rf(I(), {
	fork: () => I(),
	join: (e, t) => e
})), Cf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => rf(Jl, {
	fork: () => Jl,
	join: (e, t) => e
})), wf = /*#__PURE__*/ Symbol.for("effect/Scope"), Tf = /*#__PURE__*/ Symbol.for("effect/CloseableScope"), Ef = (e, t) => e.addFinalizer(() => Yu(t)), Df = (e, t) => e.addFinalizer(t), Of = (e, t) => e.close(t), kf = (e, t) => e.fork(t), Af = (e) => jf(b)(e), jf = /*#__PURE__*/ y(2, (e, t) => {
	let n = x(e, cu, An(t));
	switch (n._tag) {
		case "None": return x(ou(e), Ni, Tn({
			onNone: () => {
				let t = R(su(e)).flatMap((e) => R(ms(e)).map((e) => `#${e}`));
				return new Lf(t ? `Interrupted by fibers: ${t.join(", ")}` : void 0);
			},
			onSome: b
		}));
		case "Some": return n.value;
	}
}), Mf = /*#__PURE__*/ function() {
	class e extends globalThis.Error {
		commit() {
			return H(this);
		}
		toJSON() {
			let e = { ...this };
			return this.message && (e.message = this.message), this.cause && (e.cause = this.cause), e;
		}
		[M]() {
			return this.toString === globalThis.Error.prototype.toString ? "Bun" in globalThis ? wu(Yl(this), { renderErrorCause: !0 }) : this : this.stack ? `${this.toString()}\n${this.stack.split("\n").slice(1).join("\n")}` : this.toString();
		}
	}
	return Object.assign(e.prototype, Kt), e;
}(), Nf = (e, t) => {
	class n extends Mf {
		_tag = t;
	}
	return Object.assign(n.prototype, e), n.prototype.name = t, n;
}, Pf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/RuntimeException"), Ff = /*#__PURE__*/ Nf({ [Pf]: Pf }, "RuntimeException"), If = /*#__PURE__*/ Symbol.for("effect/Cause/errors/InterruptedException"), Lf = /*#__PURE__*/ Nf({ [If]: If }, "InterruptedException"), Rf = (e) => C(e, If), zf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/NoSuchElement"), Bf = /*#__PURE__*/ Nf({ [zf]: zf }, "NoSuchElementException"), Vf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/UnknownException"), Hf = /*#__PURE__*/ function() {
	class e extends Mf {
		_tag = "UnknownException";
		error;
		constructor(e, t) {
			super(t ?? "An unknown error occurred", { cause: e }), this.error = e;
		}
	}
	return Object.assign(e.prototype, {
		[Vf]: Vf,
		name: "UnknownException"
	}), e;
}(), Uf = (e) => Ku(e) && "_tag" in e && (e._tag === "Success" || e._tag === "Failure"), Wf = (e) => e._tag === "Failure", Gf = (e) => e._tag === "Success", Kf = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._tag) {
		case St: return X(e.effect_instruction_i0);
		case Et: return Z(t);
	}
}), qf = (e) => Kf(e, void 0), Jf = (e, t) => rp(e, t?.parallel ? Ql : $l), Yf = (e) => X(Xl(e)), Xf = (e) => X(Yl(e)), X = (e) => {
	let t = new Wu(St);
	return t.effect_instruction_i0 = e, t;
}, Zf = (e) => X(Zl(e)), Qf = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._tag) {
		case St: return X(e.effect_instruction_i0);
		case Et: return Z(t(e.effect_instruction_i0));
	}
}), $f = /*#__PURE__*/ y(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case St: return t(e.effect_instruction_i0);
		case Et: return n(e.effect_instruction_i0);
	}
}), ep = /*#__PURE__*/ y(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case St: return t(e.effect_instruction_i0);
		case Et: return n(e.effect_instruction_i0);
	}
}), Z = (e) => {
	let t = new Gu(Et);
	return t.effect_instruction_i0 = e, t;
}, tp = /*#__PURE__*/ Z(void 0), np = /*#__PURE__*/ y(3, (e, t, { onFailure: n, onSuccess: r }) => {
	switch (e._tag) {
		case St: switch (t._tag) {
			case Et: return X(e.effect_instruction_i0);
			case St: return X(n(e.effect_instruction_i0, t.effect_instruction_i0));
		}
		case Et: switch (t._tag) {
			case Et: return Z(r(e.effect_instruction_i0, t.effect_instruction_i0));
			case St: return X(t.effect_instruction_i0);
		}
	}
}), rp = (e, t) => {
	let n = yi(e);
	return Mi(n) ? x(Ii(n), hr(x(Fi(n), Qf(vi)), (e, n) => x(e, np(n, {
		onSuccess: (e, t) => x(e, Oi(t)),
		onFailure: t
	}))), Qf(Si), Qf((e) => xi(e)), L) : I();
}, ip = (e) => ({
	...Gt,
	[Fu]: Iu,
	state: Xo(Lu([])),
	commit() {
		return sp(this);
	},
	blockingOn: e
}), ap = () => W(ld, (e) => op(e)), op = (e) => J(() => ip(e)), sp = (e) => Qu((t) => {
	let n = Zo(e.state);
	switch (n._tag) {
		case Pu: return t(n.effect);
		case Nu: return n.joiners.push(t), fp(e, t);
	}
}, e.blockingOn), cp = /*#__PURE__*/ y(2, (e, t) => J(() => {
	let n = Zo(e.state);
	switch (n._tag) {
		case Pu: return !1;
		case Nu:
			Qo(e.state, Ru(t));
			for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
			return !0;
	}
})), lp = /*#__PURE__*/ y(2, (e, t) => cp(e, U(t))), up = /*#__PURE__*/ y(2, (e, t) => cp(e, K(t))), dp = (e, t) => {
	let n = Zo(e.state);
	if (n._tag === "Pending") {
		Qo(e.state, Ru(t));
		for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
	}
}, fp = (e, t) => J(() => {
	let n = Zo(e.state);
	if (n._tag === "Pending") {
		let e = n.joiners.indexOf(t);
		e >= 0 && n.joiners.splice(e, 1);
	}
}), pp = /*#__PURE__*/ V((e) => Z(e.currentContext)), mp = () => pp, hp = (e) => W(mp(), e), gp = /*#__PURE__*/ y(2, (e, t) => tf(uf, t)(e)), _p = /*#__PURE__*/ y(2, (e, t) => nf(uf, (e) => ai(e, t))(e)), vp = /*#__PURE__*/ y(2, (e, t) => hp((n) => gp(e, t(n)))), yp = (e) => {
	let t = e.currentSpan;
	return t !== void 0 && t._tag === "Span" ? L(t) : I();
}, bp = Wf, xp = Gf, Sp = tp, Cp = /*#__PURE__*/ Symbol.for("effect/MutableHashMap"), wp = {
	[Cp]: Cp,
	[Symbol.iterator]() {
		return new Tp(this);
	},
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "MutableHashMap",
			values: Array.from(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	pipe() {
		return F(this, arguments);
	}
}, Tp = class e {
	self;
	referentialIterator;
	bucketIterator;
	constructor(e) {
		this.self = e, this.referentialIterator = e.referential[Symbol.iterator]();
	}
	next() {
		if (this.bucketIterator !== void 0) return this.bucketIterator.next();
		let e = this.referentialIterator.next();
		return e.done ? (this.bucketIterator = new Ep(this.self.buckets.values()), this.next()) : e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, Ep = class {
	backing;
	constructor(e) {
		this.backing = e;
	}
	currentBucket;
	next() {
		if (this.currentBucket === void 0) {
			let e = this.backing.next();
			if (e.done) return e;
			this.currentBucket = e.value[Symbol.iterator]();
		}
		let e = this.currentBucket.next();
		return e.done ? (this.currentBucket = void 0, this.next()) : e;
	}
}, Dp = () => {
	let e = Object.create(wp);
	return e.referential = /* @__PURE__ */ new Map(), e.buckets = /* @__PURE__ */ new Map(), e.bucketsSize = 0, e;
}, Op = /*#__PURE__*/ y(2, (e, t) => {
	if (dt(t) === !1) return e.referential.has(t) ? L(e.referential.get(t)) : I();
	let n = t[T](), r = e.buckets.get(n);
	return r === void 0 ? I() : kp(e, r, t);
}), kp = (e, t, n, r = !1) => {
	for (let i = 0, a = t.length; i < a; i++) if (n[A](t[i][0])) {
		let n = t[i][1];
		return r && (t.splice(i, 1), e.bucketsSize--), L(n);
	}
	return I();
}, Ap = /*#__PURE__*/ y(2, (e, t) => wn(Op(e, t))), jp = /*#__PURE__*/ y(3, (e, t, n) => {
	if (dt(t) === !1) return e.referential.set(t, n), e;
	let r = t[T](), i = e.buckets.get(r);
	return i === void 0 ? (e.buckets.set(r, [[t, n]]), e.bucketsSize++, e) : (Mp(e, i, t), i.push([t, n]), e.bucketsSize++, e);
}), Mp = (e, t, n) => {
	for (let r = 0, i = t.length; r < i; r++) if (n[A](t[r][0])) {
		t.splice(r, 1), e.bucketsSize--;
		return;
	}
}, Np = /*#__PURE__*/ Symbol.for("effect/Clock"), Pp = /*#__PURE__*/ Xr("effect/Clock"), Fp = 2 ** 31 - 1, Ip = { unsafeSchedule(e, t) {
	let n = ca(t);
	if (n > Fp) return Se;
	let r = !1, i = setTimeout(() => {
		r = !0, e();
	}, n);
	return () => (clearTimeout(i), !r);
} }, Lp = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || typeof performance.now != "function") return () => BigInt(Date.now()) * e;
	let t;
	return () => (t === void 0 && (t = BigInt(Date.now()) * e - BigInt(Math.round(performance.now() * 1e6))), t + BigInt(Math.round(performance.now() * 1e6)));
}(), Rp = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return Lp;
	let t = /*#__PURE__*/ Lp() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}(), zp = class {
	[Np] = Np;
	unsafeCurrentTimeMillis() {
		return Date.now();
	}
	unsafeCurrentTimeNanos() {
		return Rp();
	}
	currentTimeMillis = /*#__PURE__*/ J(() => this.unsafeCurrentTimeMillis());
	currentTimeNanos = /*#__PURE__*/ J(() => this.unsafeCurrentTimeNanos());
	scheduler() {
		return K(Ip);
	}
	sleep(e) {
		return $u((t) => Yu(J(Ip.unsafeSchedule(() => t(Y), e))));
	}
}, Bp = () => new zp(), Vp = "InvalidData", Hp = "MissingData", Up = "SourceUnavailable", Wp = "Unsupported", Gp = /*#__PURE__*/ Symbol.for("effect/ConfigError"), Kp = {
	_tag: "ConfigError",
	[Gp]: Gp
}, qp = (e, t) => {
	let n = Object.create(Kp);
	return n._op = "And", n.left = e, n.right = t, Object.defineProperty(n, "toString", {
		enumerable: !1,
		value() {
			return `${this.left} and ${this.right}`;
		}
	}), Object.defineProperty(n, "message", {
		enumerable: !1,
		get() {
			return this.toString();
		}
	}), n;
}, Jp = (e, t) => {
	let n = Object.create(Kp);
	return n._op = "Or", n.left = e, n.right = t, Object.defineProperty(n, "toString", {
		enumerable: !1,
		value() {
			return `${this.left} or ${this.right}`;
		}
	}), Object.defineProperty(n, "message", {
		enumerable: !1,
		get() {
			return this.toString();
		}
	}), n;
}, Yp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Kp);
	return r._op = Vp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Invalid data at ${x(this.path, br(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Xp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Kp);
	return r._op = Hp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Missing data at ${x(this.path, br(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Zp = (e, t, n, r = { pathDelim: "." }) => {
	let i = Object.create(Kp);
	return i._op = Up, i.path = e, i.message = t, i.cause = n, Object.defineProperty(i, "toString", {
		enumerable: !1,
		value() {
			return `(Source unavailable at ${x(this.path, br(r.pathDelim))}: "${this.message}")`;
		}
	}), i;
}, Qp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Kp);
	return r._op = Wp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Unsupported operation at ${x(this.path, br(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, $p = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._op) {
		case "And": return qp($p(e.left, t), $p(e.right, t));
		case "Or": return Jp($p(e.left, t), $p(e.right, t));
		case Vp: return Yp([...t, ...e.path], e.message);
		case Hp: return Xp([...t, ...e.path], e.message);
		case Up: return Zp([...t, ...e.path], e.message, e.cause);
		case Wp: return Qp([...t, ...e.path], e.message);
	}
}), em = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._op) {
			case "And":
				r.push(e.right), r.push(e.left), i.push(mn({ _op: "AndCase" }));
				break;
			case "Or":
				r.push(e.right), r.push(e.left), i.push(mn({ _op: "OrCase" }));
				break;
			case Vp:
				i.push(pn(n.invalidDataCase(t, e.path, e.message)));
				break;
			case Hp:
				i.push(pn(n.missingDataCase(t, e.path, e.message)));
				break;
			case Up:
				i.push(pn(n.sourceUnavailableCase(t, e.path, e.message, e.cause)));
				break;
			case Wp: i.push(pn(n.unsupportedCase(t, e.path, e.message)));
		}
	}
	let a = [];
	for (; i.length > 0;) {
		let e = i.pop();
		switch (e._op) {
			case "Left":
				switch (e.left._op) {
					case "AndCase": {
						let e = a.pop(), r = a.pop(), i = n.andCase(t, e, r);
						a.push(i);
						break;
					}
					case "OrCase": {
						let e = a.pop(), r = a.pop(), i = n.orCase(t, e, r);
						a.push(i);
						break;
					}
				}
				break;
			case "Right": a.push(e.right);
		}
	}
	if (a.length === 0) throw Error("BUG: ConfigError.reduceWithContext - please report an issue at https://github.com/Effect-TS/effect/issues");
	return a.pop();
}), tm = { _tag: "Empty" }, nm = /*#__PURE__*/ y(2, (e, t) => {
	let n = zs(t), r = e;
	for (; Fs(n);) {
		let e = n.head;
		switch (e._tag) {
			case "Empty":
				n = n.tail;
				break;
			case "AndThen":
				n = Ls(e.first, Ls(e.second, n.tail));
				break;
			case "MapName":
				r = pr(r, e.f), n = n.tail;
				break;
			case "Nested":
				r = Ln(r, e.name), n = n.tail;
				break;
			case "Unnested": if (x(qn(r), Mn(e.name))) r = Zn(r), n = n.tail;
			else return mn(Xp(r, `Expected ${e.name} to be in path in ConfigProvider#unnested`));
		}
	}
	return pn(r);
}), rm = "Constant", im = "Fail", am = "Fallback", om = "Described", sm = "Lazy", cm = "MapOrFail", lm = "Nested", um = "Primitive", dm = "Redacted", fm = "Sequence", pm = "HashMap", mm = "ZipWith", hm = (e, t) => [...e, ...t], gm = /*#__PURE__*/ Symbol.for("effect/ConfigProvider"), _m = /*#__PURE__*/ Xr("effect/ConfigProvider"), vm = /*#__PURE__*/ Symbol.for("effect/ConfigProviderFlat"), ym = (e) => ({
	[gm]: gm,
	pipe() {
		return F(this, arguments);
	},
	...e
}), bm = (e) => ({
	[vm]: vm,
	patch: e.patch,
	load: (t, n, r = !0) => e.load(t, n, r),
	enumerateChildren: e.enumerateChildren
}), xm = (e) => ym({
	load: (t) => W(Dm(e, dr(), t, !1), (e) => Tn(qn(e), {
		onNone: () => H(Xp(dr(), `Expected a single value having structure: ${t}`)),
		onSome: K
	})),
	flattened: e
}), Sm = (e) => {
	let { pathDelim: t, seqDelim: n } = Object.assign({}, {
		pathDelim: "_",
		seqDelim: ","
	}, e), r = (e) => x(e, br(t)), i = (e) => e.split(t), a = () => typeof process < "u" && "env" in process && typeof process.env == "object" ? process.env : {};
	return xm(bm({
		load: (e, t, i = !0) => {
			let o = r(e), s = a();
			return x(o in s ? L(s[o]) : I(), bd(() => Xp(e, `Expected ${o} to exist in the process context`)), W((r) => Am(r, e, t, n, i)));
		},
		enumerateChildren: (e) => J(() => {
			let t = a();
			return zo(Object.keys(t).map((e) => i(e.toUpperCase())).filter((t) => {
				for (let n = 0; n < e.length; n++) {
					let r = x(e, Kn(n)), i = t[n];
					if (i === void 0 || r !== i) return !1;
				}
				return !0;
			}).flatMap((t) => t.slice(e.length, e.length + 1)));
		}),
		patch: tm
	}));
}, Cm = (e, t, n, r) => {
	let i = gr(n.length, (t) => t >= r.length ? I() : L([e(t), t + 1])), a = gr(r.length, (e) => e >= n.length ? I() : L([t(e), e + 1]));
	return [hm(n, i), hm(r, a)];
}, wm = (e, t) => {
	let n = t;
	if (n._tag === "Nested") {
		let t = e.slice();
		for (; n._tag === "Nested";) t.push(n.name), n = n.config;
		return t;
	}
	return e;
}, Tm = {
	andCase: (e, t, n) => qp(t, n),
	orCase: (e, t, n) => Jp(t, n),
	invalidDataCase: (e, t) => Yp(t, "<redacted>"),
	missingDataCase: (e, t) => Xp(t, "<redacted>"),
	sourceUnavailableCase: (e, t, n, r) => Zp(t, "<redacted>", r),
	unsupportedCase: (e, t) => Qp(t, "<redacted>")
}, Em = (e) => em(e, void 0, Tm), Dm = (e, t, n, r) => {
	let i = n;
	switch (i._tag) {
		case rm: return K(fr(i.value));
		case om: return q(() => Dm(e, t, i.config, r));
		case im: return H(Xp(t, i.message));
		case am: return x(q(() => Dm(e, t, i.first, r)), ed((n) => i.condition(n) ? x(Dm(e, t, i.second, r), ed((e) => H(Jp(n, e)))) : H(n)));
		case sm: return q(() => Dm(e, t, i.config(), r));
		case cm: return q(() => x(Dm(e, t, i.original, r), W(gd((e) => x(i.mapOrFail(e), bd($p(wm(t, i.original))))))));
		case lm: return q(() => Dm(e, hm(t, fr(i.name)), i.config, r));
		case um: return x(nm(t, e.patch), W((t) => x(e.load(t, i, r), W((e) => {
			if (e.length === 0) {
				let e = x(Yn(t), En(() => "<n/a>"));
				return H(Xp([], `Expected ${i.description} with name ${e}`));
			}
			return K(e);
		}))));
		case dm: return q(() => x(Dm(e, t, i.original, r), bd(Em), G(pr(i.redact))));
		case fm: return x(nm(t, e.patch), W((n) => x(e.enumerateChildren(n), W(Mm), W((n) => n.length === 0 ? q(() => G(Dm(e, t, i.config, !0), fr)) : x(gd(n, (n) => Dm(e, Rn(t, `[${n}]`), i.config, !0)), G((e) => {
			let t = mr(e);
			return t.length === 0 ? fr(dr()) : fr(t);
		}))))));
		case pm: return q(() => x(nm(t, e.patch), W((t) => x(e.enumerateChildren(t), W((n) => x(n, gd((n) => Dm(e, hm(t, fr(n)), i.valueConfig, r)), G((e) => e.length === 0 ? fr(_s()) : x(jm(e), pr((e) => vs(rr(R(n), e)))))))))));
		case mm: return q(() => x(Dm(e, t, i.left, r), ad, W((n) => x(Dm(e, t, i.right, r), ad, W((e) => {
			if (hn(n) && hn(e)) return H(qp(n.left, e.left));
			if (hn(n) && gn(e)) return H(n.left);
			if (gn(n) && hn(e)) return H(e.left);
			if (gn(n) && gn(e)) {
				let r = Om(t, x(t, br("."))), [a, o] = Cm(r, r, x(n.right, pr(pn)), x(e.right, pr(pn)));
				return x(a, rr(o), gd(([e, t]) => x(Fd(e, t), G(([e, t]) => i.zip(e, t)))));
			}
			throw Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
		})))));
	}
}, Om = (e, t) => (n) => mn(Xp(e, `The element at index ${n} in a sequence at path "${t}" was missing`)), km = (e, t) => e.split(RegExp(`\\s*${Sr(t)}\\s*`)), Am = (e, t, n, r, i) => i ? x(km(e, r), gd((e) => n.parse(e.trim())), bd($p(t))) : x(n.parse(e), yd({
	onFailure: $p(t),
	onSuccess: fr
})), jm = (e) => Object.keys(e[0]).map((t) => e.map((e) => e[t])), Mm = (e) => x(gd(e, Pm), yd({
	onFailure: () => dr(),
	onSuccess: nr(xr)
}), ad, G(_n)), Nm = /^(\[(\d+)\])$/, Pm = (e) => {
	let t = e.match(Nm);
	if (t !== null) {
		let e = t[2];
		return x(e !== void 0 && e.length > 0 ? L(e) : I(), jn(Fm));
	}
	return I();
}, Fm = (e) => {
	let t = Number.parseInt(e);
	return Number.isNaN(t) ? I() : L(t);
}, Im = /*#__PURE__*/ Symbol.for("effect/Console"), Lm = /*#__PURE__*/ Xr("effect/Console"), Rm = {
	[Im]: Im,
	assert(e, ...t) {
		return J(() => {
			console.assert(e, ...t);
		});
	},
	clear: /*#__PURE__*/ J(() => {
		console.clear();
	}),
	count(e) {
		return J(() => {
			console.count(e);
		});
	},
	countReset(e) {
		return J(() => {
			console.countReset(e);
		});
	},
	debug(...e) {
		return J(() => {
			console.debug(...e);
		});
	},
	dir(e, t) {
		return J(() => {
			console.dir(e, t);
		});
	},
	dirxml(...e) {
		return J(() => {
			console.dirxml(...e);
		});
	},
	error(...e) {
		return J(() => {
			console.error(...e);
		});
	},
	group(e) {
		return e?.collapsed ? J(() => console.groupCollapsed(e?.label)) : J(() => console.group(e?.label));
	},
	groupEnd: /*#__PURE__*/ J(() => {
		console.groupEnd();
	}),
	info(...e) {
		return J(() => {
			console.info(...e);
		});
	},
	log(...e) {
		return J(() => {
			console.log(...e);
		});
	},
	table(e, t) {
		return J(() => {
			console.table(e, t);
		});
	},
	time(e) {
		return J(() => console.time(e));
	},
	timeEnd(e) {
		return J(() => console.timeEnd(e));
	},
	timeLog(e, ...t) {
		return J(() => {
			console.timeLog(e, ...t);
		});
	},
	trace(...e) {
		return J(() => {
			console.trace(...e);
		});
	},
	warn(...e) {
		return J(() => {
			console.warn(...e);
		});
	},
	unsafe: console
}, zm = /*#__PURE__*/ Symbol.for("effect/Random"), Bm = /*#__PURE__*/ Xr("effect/Random"), Vm = class {
	seed;
	[zm] = zm;
	PRNG;
	constructor(e) {
		this.seed = e, this.PRNG = new Je(e);
	}
	get next() {
		return J(() => this.PRNG.number());
	}
	get nextBoolean() {
		return G(this.next, (e) => e > .5);
	}
	get nextInt() {
		return J(() => this.PRNG.integer(2 ** 53 - 1));
	}
	nextRange(e, t) {
		return G(this.next, (n) => (t - e) * n + e);
	}
	nextIntBetween(e, t) {
		return J(() => this.PRNG.integer(t - e) + e);
	}
	shuffle(e) {
		return Hm(e, (e) => this.nextIntBetween(0, e));
	}
}, Hm = (e, t) => q(() => x(J(() => Array.from(e)), W((e) => {
	let n = [];
	for (let t = e.length; t >= 2; --t) n.push(t);
	return x(n, _d((n) => x(t(n), G((t) => Um(e, n - 1, t)))), Ju(yi(e)));
}))), Um = (e, t, n) => {
	let r = e[t];
	return e[t] = e[n], e[n] = r, e;
}, Wm = (e) => new Vm(E(e)), Gm = /*#__PURE__*/ Symbol.for("effect/Tracer"), Km = (e) => ({
	[Gm]: Gm,
	...e
}), qm = /*#__PURE__*/ Xr("effect/Tracer"), Jm = /*#__PURE__*/ Xr("effect/ParentSpan"), Ym = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), Xm = class {
	name;
	parent;
	context;
	startTime;
	kind;
	_tag = "Span";
	spanId;
	traceId = "native";
	sampled = !0;
	status;
	attributes;
	events = [];
	links;
	constructor(e, t, n, r, i, a) {
		this.name = e, this.parent = t, this.context = n, this.startTime = i, this.kind = a, this.status = {
			_tag: "Started",
			startTime: i
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = t._tag === "Some" ? t.value.traceId : Ym(32), this.spanId = Ym(16), this.links = Array.from(r);
	}
	end(e, t) {
		this.status = {
			_tag: "Ended",
			endTime: e,
			exit: t,
			startTime: this.status.startTime
		};
	}
	attribute(e, t) {
		this.attributes.set(e, t);
	}
	event(e, t, n) {
		this.events.push([
			e,
			t,
			n ?? {}
		]);
	}
	addLinks(e) {
		this.links.push(...e);
	}
}, Zm = /*#__PURE__*/ Km({
	span: (e, t, n, r, i, a) => new Xm(e, t, n, r, i, a),
	context: (e) => e()
}), Qm = /*#__PURE__*/ ci()("effect/Tracer/DisablePropagation", { defaultValue: Se }), $m = /*#__PURE__*/ x(/*#__PURE__*/ $r(), /*#__PURE__*/ ti(Pp, /*#__PURE__*/ Bp()), /*#__PURE__*/ ti(Lm, Rm), /*#__PURE__*/ ti(Bm, /*#__PURE__*/ Wm(/*#__PURE__*/ Math.random())), /*#__PURE__*/ ti(_m, /*#__PURE__*/ Sm()), /*#__PURE__*/ ti(qm, Zm)), eh = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/DefaultServices/currentServices"), () => sf($m));
// node_modules/effect/dist/esm/internal/fiberRefs.js
function th(e) {
	return new ih(e);
}
function nh() {
	return th(/* @__PURE__ */ new Map());
}
var rh = /*#__PURE__*/ Symbol.for("effect/FiberRefs"), ih = class {
	locals;
	[rh] = rh;
	constructor(e) {
		this.locals = e;
	}
	pipe() {
		return F(this, arguments);
	}
}, ah = (e, t, n, r = !1) => {
	let i = e, a = t, o = n, s = r, c;
	for (; c === void 0;) if (Hn(a) && Hn(o)) {
		let e = Jn(a)[0], t = Zn(a), n = Jn(o)[0], r = Jn(o)[1], i = Zn(o);
		e.startTimeMillis < n.startTimeMillis ? (o = i, s = !0) : e.startTimeMillis > n.startTimeMillis ? a = t : e.id < n.id ? (o = i, s = !0) : e.id > n.id ? a = t : c = [r, s];
	} else c = [i.initial, !0];
	return c;
}, oh = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = new Map(e.locals);
	return n.locals.forEach((e, n) => {
		let i = e[0][1];
		if (!e[0][0][A](t)) {
			if (!r.has(n)) {
				if (j(i, n.initial)) return;
				r.set(n, [[t, n.join(n.initial, i)]]);
				return;
			}
			let a = r.get(n), [o, s] = ah(n, a, e);
			if (s) {
				let e = n.diff(o, i), s = a[0][1], c = n.join(s, n.patch(e)(s));
				if (!j(s, c)) {
					let e, i = a[0][0];
					e = i[A](t) ? [[i, c], ...a.slice(1)] : [[t, c], ...a], r.set(n, e);
				}
			}
		}
	}), new ih(r);
}), sh = /*#__PURE__*/ y(2, (e, t) => {
	let n = /* @__PURE__ */ new Map();
	return ch(e, n, t), new ih(n);
}), ch = (e, t, n) => {
	e.locals.forEach((e, r) => {
		let i = e[0][1], a = r.patch(r.fork)(i);
		j(i, a) ? t.set(r, e) : t.set(r, [[n, a], ...e]);
	});
}, lh = /*#__PURE__*/ y(2, (e, t) => {
	let n = new Map(e.locals);
	return n.delete(t), new ih(n);
}), uh = /*#__PURE__*/ y(2, (e, t) => e.locals.has(t) ? L(Jn(e.locals.get(t))[1]) : I()), dh = /*#__PURE__*/ y(2, (e, t) => x(uh(e, t), En(() => t.initial))), fh = /*#__PURE__*/ y(2, (e, { fiberId: t, fiberRef: n, value: r }) => {
	if (e.locals.size === 0) return new ih(/* @__PURE__ */ new Map([[n, [[t, r]]]]));
	let i = new Map(e.locals);
	return ph(i, t, n, r), new ih(i);
}), ph = (e, t, n, r) => {
	let i = e.get(n) ?? [], a;
	if (Hn(i)) {
		let [e, n] = Jn(i);
		if (e[A](t)) {
			if (j(n, r)) return;
			a = [[t, r], ...i.slice(1)];
		} else a = [[t, r], ...i];
	} else a = [[t, r]];
	e.set(n, a);
}, mh = /*#__PURE__*/ y(2, (e, { entries: t, forkAs: n }) => {
	if (e.locals.size === 0) return new ih(new Map(t));
	let r = new Map(e.locals);
	return n !== void 0 && ch(e, r, n), t.forEach(([e, t]) => {
		t.length === 1 ? ph(r, t[0][0], e, t[0][1]) : t.forEach(([t, n]) => {
			ph(r, t, e, n);
		});
	}), new ih(r);
}), hh = dh, gh = mh, _h = nh, vh = Vd, yh = Hd, bh = Ud, xh = Wd, Sh = Gd, Ch = Kd, wh = qd, Th = Jd, Eh = /*#__PURE__*/ Sn(/* @__PURE__ */ x(xr, /*#__PURE__*/ xn((e) => e.ordinal))), Dh = (e) => {
	switch (e) {
		case "All": return vh;
		case "Debug": return Ch;
		case "Error": return bh;
		case "Fatal": return yh;
		case "Info": return Sh;
		case "Trace": return wh;
		case "None": return Th;
		case "Warning": return xh;
	}
}, Oh = (e) => e.replace(/[\s="]/g, "_"), kh = (e) => (t) => `${Oh(t.label)}=${e - t.startTime}ms`, Ah = Ut, jh = qt, Mh = class extends jh {}, Nh = /*#__PURE__*/ Symbol.for("effect/Readable"), Ph = /*#__PURE__*/ Symbol.for("effect/Ref"), Fh = {
/* c8 ignore next */
_A: (e) => e }, Ih = class extends Mh {
	ref;
	commit() {
		return this.get;
	}
	[Ph] = Fh;
	[Nh] = Nh;
	constructor(e) {
		super(), this.ref = e, this.get = J(() => Zo(this.ref));
	}
	get;
	modify(e) {
		return J(() => {
			let t = Zo(this.ref), [n, r] = e(t);
			return t !== r && Qo(r)(this.ref), n;
		});
	}
}, Lh = (e) => new Ih(Xo(e)), Rh = (e) => J(() => Lh(e)), zh = (e) => e.get, Bh = /*#__PURE__*/ y(2, (e, t) => e.modify(() => [void 0, t])), Vh = /*#__PURE__*/ y(2, (e, t) => e.modify(t)), Hh = /*#__PURE__*/ y(2, (e, t) => e.modify((e) => [void 0, t(e)])), Uh = "Empty", Wh = "Remove", Gh = "Update", Kh = "AndThen", qh = { _tag: Uh }, Jh = (e, t) => {
	let n = new Map(e.locals), r = qh;
	for (let [e, i] of t.locals.entries()) {
		let t = Jn(i)[1], a = n.get(e);
		if (a !== void 0) {
			let n = Jn(a)[1];
			j(n, t) || (r = Yh({
				_tag: Gh,
				fiberRef: e,
				patch: e.diff(n, t)
			})(r));
		} else r = Yh({
			_tag: "Add",
			fiberRef: e,
			value: t
		})(r);
		n.delete(e);
	}
	for (let [e] of n.entries()) r = Yh({
		_tag: Wh,
		fiberRef: e
	})(r);
	return r;
}, Yh = /*#__PURE__*/ y(2, (e, t) => ({
	_tag: Kh,
	first: e,
	second: t
})), Xh = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = n, i = fr(e);
	for (; Hn(i);) {
		let e = Jn(i), n = Zn(i);
		switch (e._tag) {
			case Uh:
				i = n;
				break;
			case "Add":
				r = fh(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.value
				}), i = n;
				break;
			case Wh:
				r = lh(r, e.fiberRef), i = n;
				break;
			case Gh: {
				let a = dh(r, e.fiberRef);
				r = fh(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.fiberRef.patch(e.patch)(a)
				}), i = n;
				break;
			}
			case Kh: i = Ln(e.first)(Ln(e.second)(n));
		}
	}
	return r;
}), Zh = "effect/MetricLabel", Qh = /*#__PURE__*/ Symbol.for(Zh), $h = class {
	key;
	value;
	[Qh] = Qh;
	_hash;
	constructor(e, t) {
		this.key = e, this.value = t, this._hash = O(Zh + this.key + this.value);
	}
	[T]() {
		return this._hash;
	}
	[A](e) {
		return tg(e) && this.key === e.key && this.value === e.value;
	}
	pipe() {
		return F(this, arguments);
	}
}, eg = (e, t) => new $h(e, t), tg = (e) => C(e, Qh), ng = (e) => G(e, L), rg = (e) => {
	let t, n;
	return typeof e == "function" ? t = e : (t = e.try, n = e.catch), q(() => {
		try {
			return K(w(t));
		} catch (e) {
			return H(n ? w(() => n(e)) : new Hf(e, "An unknown error occurred in Effect.try"));
		}
	});
}, ig = (e) => fg(e, og, Jh), ag = /*#__PURE__*/ y(2, (e, t) => hd(e, {
	onFailure: (e) => K(t.onFailure(e)),
	onSuccess: (e) => K(t.onSuccess(e))
})), og = /*#__PURE__*/ V((e) => K(e.getFiberRefs())), sg = (e) => ag(e, {
	onFailure: we,
	onSuccess: we
}), cg = (e) => hg((t, n) => x(e, Xh(t, n))), lg = (e) => e.length >= 1 ? $u((t, n) => {
	try {
		e(n).then((e) => t(K(e)), (e) => t(rd(e)));
	} catch (e) {
		t(rd(e));
	}
}) : $u((t) => {
	try {
		e().then((e) => t(K(e)), (e) => t(rd(e)));
	} catch (e) {
		t(rd(e));
	}
}), ug = /*#__PURE__*/ y(3, (e, t, n) => hp((r) => gp(e, ti(r, t, n)))), dg = /*#__PURE__*/ K(/*#__PURE__*/ I()), fg = /*#__PURE__*/ y(3, (e, t, n) => W(t, (r) => W(e, (e) => G(t, (t) => [n(r, t), e])))), pg = /*#__PURE__*/ y(2, (e, t) => md(e, {
	onFailure: (e) => {
		let n = lu(e);
		switch (n._tag) {
			case "Left": return Ld(t(n.left), U(e));
			case "Right": return U(e);
		}
	},
	onSuccess: K
})), mg = (e) => {
	let t, n;
	typeof e == "function" ? t = e : (t = e.try, n = e.catch);
	let r = (e) => n ? sd(() => n(e)) : H(new Hf(e, "An unknown error occurred in Effect.tryPromise"));
	return t.length >= 1 ? $u((e, n) => {
		try {
			t(n).then((t) => e(K(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	}) : $u((e) => {
		try {
			t().then((t) => e(K(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	});
}, hg = (e) => V((t) => (t.setFiberRefs(e(t.id(), t.getFiberRefs())), Y)), gg = /*#__PURE__*/ jn((e) => ni(e.context, Qm) ? e._tag === "Span" ? gg(e.parent) : I() : L(e)), _g = "Sequential", vg = "Parallel", yg = "ParallelN", bg = { _tag: _g }, xg = { _tag: vg }, Sg = (e) => ({
	_tag: yg,
	parallelism: e
}), Cg = (e) => e._tag === _g, wg = (e) => e._tag === vg, Tg = bg, Eg = xg, Dg = Sg, Og = Jh, kg = Xh, Ag = "effect/FiberStatus", jg = /*#__PURE__*/ Symbol.for(Ag), Mg = "Done", Ng = "Running", Pg = "Suspended", Fg = /*#__PURE__*/ O(`${Ag}-${Mg}`), Ig = class {
	[jg] = jg;
	_tag = Mg;
	[T]() {
		return Fg;
	}
	[A](e) {
		return Hg(e) && e._tag === "Done";
	}
}, Lg = class {
	runtimeFlags;
	[jg] = jg;
	_tag = Ng;
	constructor(e) {
		this.runtimeFlags = e;
	}
	[T]() {
		return x(E(Ag), D(E(this._tag)), D(E(this.runtimeFlags)), k(this));
	}
	[A](e) {
		return Hg(e) && e._tag === "Running" && this.runtimeFlags === e.runtimeFlags;
	}
}, Rg = class {
	runtimeFlags;
	blockingOn;
	[jg] = jg;
	_tag = Pg;
	constructor(e, t) {
		this.runtimeFlags = e, this.blockingOn = t;
	}
	[T]() {
		return x(E(Ag), D(E(this._tag)), D(E(this.runtimeFlags)), D(E(this.blockingOn)), k(this));
	}
	[A](e) {
		return Hg(e) && e._tag === "Suspended" && this.runtimeFlags === e.runtimeFlags && j(this.blockingOn, e.blockingOn);
	}
}, zg = /*#__PURE__*/ new Ig(), Bg = (e) => new Lg(e), Vg = (e, t) => new Rg(e, t), Hg = (e) => C(e, jg), Ug = (e) => e._tag === Mg, Wg = zg, Gg = Bg, Kg = Vg, qg = Ug, Jg = /*#__PURE__*/ Symbol.for("effect/Micro"), Yg = /*#__PURE__*/ Symbol.for("effect/Micro/MicroExit"), Xg = /*#__PURE__*/ Symbol.for("effect/Micro/MicroCause"), Zg = { _E: b }, Qg = class extends globalThis.Error {
	_tag;
	traces;
	[Xg];
	constructor(e, t, n) {
		let r = `MicroCause.${e}`, i, a, o;
		if (t instanceof globalThis.Error) {
			i = `(${r}) ${t.name}`, a = t.message;
			let e = a.split("\n").length;
			o = t.stack ? `(${r}) ${t.stack.split("\n").slice(0, e + 3).join("\n")}` : `${i}: ${a}`;
		} else i = r, a = pt(t, 0), o = `${i}: ${a}`;
		n.length > 0 && (o += `\n    ${n.join("\n    ")}`), super(a), this._tag = e, this.traces = n, this[Xg] = Zg, this.name = i, this.stack = o;
	}
	pipe() {
		return F(this, arguments);
	}
	toString() {
		return this.stack;
	}
	[M]() {
		return this.stack;
	}
}, $g = class extends Qg {
	defect;
	constructor(e, t = []) {
		super("Die", e, t), this.defect = e;
	}
}, e_ = (e, t = []) => new $g(e, t), t_ = class extends Qg {
	constructor(e = []) {
		super("Interrupt", "interrupted", e);
	}
}, n_ = (e = []) => new t_(e), r_ = (e) => e._tag === "Interrupt", i_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroFiber"), a_ = {
	_A: b,
	_E: b
}, o_ = class {
	context;
	interruptible;
	[i_];
	_stack = [];
	_observers = [];
	_exit;
	_children;
	currentOpCount = 0;
	constructor(e, t = !0) {
		this.context = e, this.interruptible = t, this[i_] = a_;
	}
	getRef(e) {
		return Wr(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), we) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	_interrupted = !1;
	unsafeInterrupt() {
		this._exit || (this._interrupted = !0, this.interruptible && this.evaluate(A_));
	}
	unsafePoll() {
		return this._exit;
	}
	evaluate(e) {
		if (this._exit) return;
		if (this._yielded !== void 0) {
			let e = this._yielded;
			this._yielded = void 0, e();
		}
		let t = this.runLoop(e);
		if (t === p_) return;
		let n = s_.interruptChildren && s_.interruptChildren(this);
		if (n !== void 0) return this.evaluate(T_(n, () => t));
		this._exit = t;
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = !1, n = e;
		this.currentOpCount = 0;
		try {
			for (;;) {
				if (this.currentOpCount++, !t && this.getRef(R_).shouldYield(this)) {
					t = !0;
					let e = n;
					n = T_(S_, () => e);
				}
				if (n = n[l_](this), n === p_) {
					let e = this._yielded;
					return Yg in e ? (this._yielded = void 0, e) : p_;
				}
			}
		} catch (e) {
			return C(n, l_) ? j_(e) : j_(`MicroFiber.runLoop: Not a valid effect: ${String(n)}`);
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[f_] && t[f_](this);
			if (n) return { [e]: n };
			if (t[e]) return t;
		}
	}
	_yielded = void 0;
	yieldWith(e) {
		return this._yielded = e, p_;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
}, s_ = /*#__PURE__*/ S("effect/Micro/fiberMiddleware", () => ({ interruptChildren: void 0 })), c_ = /*#__PURE__*/ Symbol.for("effect/Micro/identifier"), Q = /*#__PURE__*/ Symbol.for("effect/Micro/args"), l_ = /*#__PURE__*/ Symbol.for("effect/Micro/evaluate"), u_ = /*#__PURE__*/ Symbol.for("effect/Micro/successCont"), d_ = /*#__PURE__*/ Symbol.for("effect/Micro/failureCont"), f_ = /*#__PURE__*/ Symbol.for("effect/Micro/ensureCont"), p_ = /*#__PURE__*/ Symbol.for("effect/Micro/Yield"), m_ = {
	_A: b,
	_E: b,
	_R: b
}, h_ = {
	...Ah,
	_op: "Micro",
	[Jg]: m_,
	pipe() {
		return F(this, arguments);
	},
	[Symbol.iterator]() {
		return new Ve(new Qe(this));
	},
	toJSON() {
		return {
			_id: "Micro",
			op: this[c_],
			...Q in this ? { args: this[Q] } : void 0
		};
	},
	toString() {
		return P(this);
	},
	[M]() {
		return P(this);
	}
};
function g_(e) {
	return j_("Micro.evaluate: Not implemented");
}
var __ = (e) => ({
	...h_,
	[c_]: e.op,
	[l_]: e.eval ?? g_,
	[u_]: e.contA,
	[d_]: e.contE,
	[f_]: e.ensure
}), v_ = (e) => {
	let t = __(e);
	return function() {
		let n = Object.create(t);
		return n[Q] = e.single === !1 ? arguments : arguments[0], n;
	};
}, y_ = (e) => {
	let t = {
		...__(e),
		[Yg]: Yg,
		_tag: e.op,
		get [e.prop]() {
			return this[Q];
		},
		toJSON() {
			return {
				_id: "MicroExit",
				_tag: e.op,
				[e.prop]: this[Q]
			};
		},
		[A](t) {
			return D_(t) && t._tag === e.op && j(this[Q], t[Q]);
		},
		[T]() {
			return k(this, D(O(e.op))(E(this[Q])));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[Q] = e, n[u_] = void 0, n[d_] = void 0, n[f_] = void 0, n;
	};
}, b_ = /*#__PURE__*/ y_({
	op: "Success",
	prop: "value",
	eval(e) {
		let t = e.getCont(u_);
		return t ? t[u_](this[Q], e) : e.yieldWith(this);
	}
}), x_ = /*#__PURE__*/ y_({
	op: "Failure",
	prop: "cause",
	eval(e) {
		let t = e.getCont(d_);
		for (; r_(this[Q]) && t && e.interruptible;) t = e.getCont(d_);
		return t ? t[d_](this[Q], e) : e.yieldWith(this);
	}
}), S_ = /*#__PURE__*/ (/* @__PURE__ */ v_({
	op: "Yield",
	eval(e) {
		let t = !1;
		return e.getRef(R_).scheduleTask(() => {
			t || e.evaluate(M_);
		}, this[Q] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), C_ = /*#__PURE__*/ b_(void 0), w_ = /*#__PURE__*/ v_({
	op: "WithMicroFiber",
	eval(e) {
		return this[Q](e);
	}
}), T_ = /*#__PURE__*/ y(2, (e, t) => {
	let n = Object.create(E_);
	return n[Q] = e, n[u_] = t, n;
}), E_ = /*#__PURE__*/ __({
	op: "OnSuccess",
	eval(e) {
		return e._stack.push(this), this[Q];
	}
}), D_ = (e) => C(e, Yg), O_ = b_, k_ = x_, A_ = /*#__PURE__*/ k_(/*#__PURE__*/ n_()), j_ = (e) => k_(e_(e)), M_ = /*#__PURE__*/ O_(void 0), N_ = "setImmediate" in globalThis ? globalThis.setImmediate : (e) => setTimeout(e, 0), P_ = class {
	tasks = [];
	running = !1;
	scheduleTask(e, t) {
		this.tasks.push(e), this.running || (this.running = !0, N_(this.afterScheduled));
	}
	afterScheduled = () => {
		this.running = !1, this.runTasks();
	};
	runTasks() {
		let e = this.tasks;
		this.tasks = [];
		for (let t = 0, n = e.length; t < n; t++) e[t]();
	}
	shouldYield(e) {
		return e.currentOpCount >= e.getRef(L_);
	}
	flush() {
		for (; this.tasks.length > 0;) this.runTasks();
	}
}, F_ = /*#__PURE__*/ y(2, (e, t) => w_((n) => {
	let r = n.context;
	return n.context = t(r), V_(e, () => (n.context = r, C_));
})), I_ = /*#__PURE__*/ y(2, (e, t) => F_(e, ai(t))), L_ = class extends (/*#__PURE__*/ ci()("effect/Micro/currentMaxOpsBeforeYield", { defaultValue: () => 2048 })) {}, R_ = class extends (/*#__PURE__*/ ci()("effect/Micro/currentScheduler", { defaultValue: () => new P_() })) {}, z_ = /*#__PURE__*/ y(2, (e, t) => {
	let n = Object.create(B_);
	return n[Q] = e, n[u_] = t.onSuccess, n[d_] = t.onFailure, n;
}), B_ = /*#__PURE__*/ __({
	op: "OnSuccessAndFailure",
	eval(e) {
		return e._stack.push(this), this[Q];
	}
}), V_ = /*#__PURE__*/ y(2, (e, t) => W_((n) => z_(n(e), {
	onFailure: (e) => T_(t(k_(e)), () => x_(e)),
	onSuccess: (e) => T_(t(O_(e)), () => b_(e))
}))), H_ = /*#__PURE__*/ v_({
	op: "SetInterruptible",
	ensure(e) {
		if (e.interruptible = this[Q], e._interrupted && e.interruptible) return () => A_;
	}
}), U_ = (e) => w_((t) => t.interruptible ? e : (t.interruptible = !0, t._stack.push(H_(!1)), t._interrupted ? A_ : e)), W_ = (e) => w_((t) => t.interruptible ? (t.interruptible = !1, t._stack.push(H_(!0)), e(U_)) : e(b)), G_ = (e, t) => {
	let n = new o_(R_.context(t?.scheduler ?? new P_()));
	if (n.evaluate(e), t?.signal) {
		if (t.signal.aborted) n.unsafeInterrupt();
		else {
			let e = () => n.unsafeInterrupt();
			t.signal.addEventListener("abort", e, { once: !0 }), n.addObserver(() => t.signal.removeEventListener("abort", e));
		}
	}
	return n;
}, K_ = class e {
	scheduleDrain;
	running = !1;
	tasks = /*#__PURE__*/ new q_();
	constructor(e) {
		this.scheduleDrain = e;
	}
	starveInternal = (e) => {
		let t = this.tasks.buckets;
		this.tasks.buckets = [];
		for (let [e, n] of t) for (let e = 0; e < n.length; e++) n[e]();
		this.tasks.buckets.length === 0 ? this.running = !1 : this.starve(e);
	};
	starve(e = 0) {
		this.scheduleDrain(e, this.starveInternal);
	}
	scheduleTask(e, t) {
		this.tasks.scheduleTask(e, t), this.running || (this.running = !0, this.starve());
	}
	static cached(t) {
		let n = new e(t), r = /* @__PURE__ */ new WeakMap();
		return (i) => {
			if (i === void 0) return n;
			let a = r.get(i);
			return a === void 0 && (a = new e(t), r.set(i, a)), a;
		};
	}
}, q_ = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets.length, r, i = 0;
		for (; i < n && this.buckets[i][0] <= t; i++) r = this.buckets[i];
		r && r[0] === t ? r[1].push(e) : i === n ? this.buckets.push([t, [e]]) : this.buckets.splice(i, 0, [t, [e]]);
	}
}, J_ = class {
	maxNextTickBeforeTimer;
	getRunner = /*#__PURE__*/ K_.cached((e, t) => {
		e >= this.maxNextTickBeforeTimer ? setTimeout(() => t(0), 0) : Promise.resolve(void 0).then(() => t(e + 1));
	});
	constructor(e) {
		this.maxNextTickBeforeTimer = e;
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(ff) && e.getFiberRef(df);
	}
	scheduleTask(e, t, n) {
		this.getRunner(n).scheduleTask(e, t);
	}
}, Y_ = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Scheduler/defaultScheduler"), () => new J_(2048)), X_ = class {
	tasks = /*#__PURE__*/ new q_();
	deferred = !1;
	scheduleTask(e, t, n) {
		this.deferred ? Y_.scheduleTask(e, t, n) : this.tasks.scheduleTask(e, t);
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(ff) && e.getFiberRef(df);
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) {
			let e = this.tasks.buckets;
			this.tasks.buckets = [];
			for (let [t, n] of e) for (let e = 0; e < n.length; e++) n[e]();
		}
		this.deferred = !0;
	}
}, Z_ = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentScheduler"), () => rf(Y_)), Q_ = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestMap"), () => rf(/* @__PURE__ */ new Map())), $_ = (e, t, n, r) => {
	switch (e) {
		case void 0: return t();
		case "unbounded": return n();
		case "inherit": return Qd(_f, (e) => e === "unbounded" ? n() : e > 1 ? r(e) : t());
		default: return e > 1 ? r(e) : t();
	}
}, ev = "InterruptSignal", tv = "Stateful", nv = "Resume", rv = "YieldNow", iv = (e) => ({
	_tag: ev,
	cause: e
}), av = (e) => ({
	_tag: tv,
	onFiber: e
}), ov = (e) => ({
	_tag: nv,
	effect: e
}), sv = () => ({ _tag: rv }), cv = /*#__PURE__*/ Symbol.for("effect/FiberScope"), lv = class {
	[cv] = cv;
	fiberId = ps;
	roots = /*#__PURE__*/ new Set();
	add(e, t) {
		this.roots.add(t), t.addObserver(() => {
			this.roots.delete(t);
		});
	}
}, uv = class {
	fiberId;
	parent;
	[cv] = cv;
	constructor(e, t) {
		this.fiberId = e, this.parent = t;
	}
	add(e, t) {
		this.parent.tell(av((e) => {
			e.addChild(t), t.addObserver(() => {
				e.removeChild(t);
			});
		}));
	}
}, dv = (e) => new uv(e.id(), e), fv = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberScope/Global"), () => new lv()), pv = /*#__PURE__*/ Symbol.for("effect/Fiber"), mv = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, hv = {
	[pv]: mv,
	pipe() {
		return F(this, arguments);
	}
}, gv = /*#__PURE__*/ Symbol.for("effect/Fiber"), _v = (e) => Id(fd(e.await), e.inheritAll);
({ ...Gt }), { ...hv };
var vv = "effect/FiberCurrent", yv = /*#__PURE__*/ Symbol.for("effect/Logger"), bv = {
	/* c8 ignore next */
	_Message: (e) => e,
	/* c8 ignore next */
	_Output: (e) => e
}, xv = (e) => ({
	[yv]: bv,
	log: e,
	pipe() {
		return F(this, arguments);
	}
}), Sv = /^[^\s"=]*$/, Cv = /*#__PURE__*/ xv(/*#__PURE__*/ ((e, t) => ({ annotations: n, cause: r, date: i, fiberId: a, logLevel: o, message: s, spans: c }) => {
	let l = (t) => t.match(Sv) ? t : e(t), u = (e, t) => `${Oh(e)}=${l(t)}`, d = (e, t) => " " + u(e, t), f = u("timestamp", i.toISOString());
	f += d("level", o.label), f += d("fiber", ds(a));
	let p = In(s);
	for (let e = 0; e < p.length; e++) f += d("message", pt(p[e], t));
	tu(r) || (f += d("cause", wu(r, { renderErrorCause: !0 })));
	for (let e of c) f += " " + kh(i.getTime())(e);
	for (let [e, r] of n) f += d(e, pt(r, t));
	return f;
})((e) => `"${e.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`)), wv = {
	bold: "1",
	red: "31",
	green: "32",
	yellow: "33",
	blue: "34",
	cyan: "36",
	white: "37",
	gray: "90",
	black: "30",
	bgBrightRed: "101"
};
wv.gray, wv.blue, wv.green, wv.yellow, wv.red, wv.bgBrightRed, wv.black;
var Tv = typeof process == "object" && process !== null && typeof process.stdout == "object" && process.stdout !== null;
Tv && process.stdout.isTTY, Tv || "Deno" in globalThis;
// node_modules/effect/dist/esm/internal/metric/boundaries.js
var Ev = "effect/MetricBoundaries", Dv = /*#__PURE__*/ Symbol.for(Ev), Ov = class {
	values;
	[Dv] = Dv;
	constructor(e) {
		this.values = e, this._hash = x(O(Ev), D(lt(this.values)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return kv(e) && j(this.values, e.values);
	}
	pipe() {
		return F(this, arguments);
	}
}, kv = (e) => C(e, Dv), Av = (e) => new Ov(x(e, zn(vi(Infinity)), yr)), jv = (e) => x(Fn(e.count - 1, (t) => e.start * e.factor ** +t), wi, Av), Mv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType"), Nv = "effect/MetricKeyType/Counter", Pv = /*#__PURE__*/ Symbol.for(Nv), Fv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Frequency"), Iv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Gauge"), Lv = "effect/MetricKeyType/Histogram", Rv = /*#__PURE__*/ Symbol.for(Lv), zv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Summary"), Bv = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Vv = class {
	incremental;
	bigint;
	[Mv] = Bv;
	[Pv] = Pv;
	constructor(e, t) {
		this.incremental = e, this.bigint = t, this._hash = O(Nv);
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return Gv(e);
	}
	pipe() {
		return F(this, arguments);
	}
}, Hv = class {
	boundaries;
	[Mv] = Bv;
	[Rv] = Rv;
	constructor(e) {
		this.boundaries = e, this._hash = x(O(Lv), D(E(this.boundaries)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return Jv(e) && j(this.boundaries, e.boundaries);
	}
	pipe() {
		return F(this, arguments);
	}
}, Uv = (e) => new Vv(e?.incremental ?? !1, e?.bigint ?? !1), Wv = (e) => new Hv(e), Gv = (e) => C(e, Pv), Kv = (e) => C(e, Fv), qv = (e) => C(e, Iv), Jv = (e) => C(e, Rv), Yv = (e) => C(e, zv), Xv = /*#__PURE__*/ Symbol.for("effect/MetricKey"), Zv = {
/* c8 ignore next */
_Type: (e) => e }, Qv = /*#__PURE__*/ _r(j), $v = class {
	name;
	keyType;
	description;
	tags;
	[Xv] = Zv;
	constructor(e, t, n, r = []) {
		this.name = e, this.keyType = t, this.description = n, this.tags = r, this._hash = x(O(this.name + this.description), D(E(this.keyType)), D(lt(this.tags)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return ey(e) && this.name === e.name && j(this.keyType, e.keyType) && j(this.description, e.description) && Qv(this.tags, e.tags);
	}
	pipe() {
		return F(this, arguments);
	}
}, ey = (e) => C(e, Xv), ty = (e, t) => new $v(e, Uv(t), On(t?.description)), ny = (e, t, n) => new $v(e, Wv(t), On(n)), ry = /*#__PURE__*/ y(2, (e, t) => t.length === 0 ? e : new $v(e.name, e.keyType, e.description, ur(e.tags, t))), iy = /*#__PURE__*/ Symbol.for("effect/MetricState"), ay = "effect/MetricState/Counter", oy = /*#__PURE__*/ Symbol.for(ay), sy = "effect/MetricState/Frequency", cy = /*#__PURE__*/ Symbol.for(sy), ly = "effect/MetricState/Gauge", uy = /*#__PURE__*/ Symbol.for(ly), dy = "effect/MetricState/Histogram", fy = /*#__PURE__*/ Symbol.for(dy), py = "effect/MetricState/Summary", my = /*#__PURE__*/ Symbol.for(py), hy = {
/* c8 ignore next */
_A: (e) => e }, gy = class {
	count;
	[iy] = hy;
	[oy] = oy;
	constructor(e) {
		this.count = e;
	}
	[T]() {
		return x(E(ay), D(E(this.count)), k(this));
	}
	[A](e) {
		return Dy(e) && this.count === e.count;
	}
	pipe() {
		return F(this, arguments);
	}
}, _y = /*#__PURE__*/ _r(j), vy = class {
	occurrences;
	[iy] = hy;
	[cy] = cy;
	constructor(e) {
		this.occurrences = e;
	}
	_hash;
	[T]() {
		return x(O(sy), D(lt(R(this.occurrences.entries()))), k(this));
	}
	[A](e) {
		return Oy(e) && _y(R(this.occurrences.entries()), R(e.occurrences.entries()));
	}
	pipe() {
		return F(this, arguments);
	}
}, yy = class {
	value;
	[iy] = hy;
	[uy] = uy;
	constructor(e) {
		this.value = e;
	}
	[T]() {
		return x(E(ly), D(E(this.value)), k(this));
	}
	[A](e) {
		return ky(e) && this.value === e.value;
	}
	pipe() {
		return F(this, arguments);
	}
}, by = class {
	buckets;
	count;
	min;
	max;
	sum;
	[iy] = hy;
	[fy] = fy;
	constructor(e, t, n, r, i) {
		this.buckets = e, this.count = t, this.min = n, this.max = r, this.sum = i;
	}
	[T]() {
		return x(E(dy), D(E(this.buckets)), D(E(this.count)), D(E(this.min)), D(E(this.max)), D(E(this.sum)), k(this));
	}
	[A](e) {
		return Ay(e) && j(this.buckets, e.buckets) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return F(this, arguments);
	}
}, xy = class {
	error;
	quantiles;
	count;
	min;
	max;
	sum;
	[iy] = hy;
	[my] = my;
	constructor(e, t, n, r, i, a) {
		this.error = e, this.quantiles = t, this.count = n, this.min = r, this.max = i, this.sum = a;
	}
	[T]() {
		return x(E(py), D(E(this.error)), D(E(this.quantiles)), D(E(this.count)), D(E(this.min)), D(E(this.max)), D(E(this.sum)), k(this));
	}
	[A](e) {
		return jy(e) && this.error === e.error && j(this.quantiles, e.quantiles) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return F(this, arguments);
	}
}, Sy = (e) => new gy(e), Cy = (e) => new vy(e), wy = (e) => new yy(e), Ty = (e) => new by(e.buckets, e.count, e.min, e.max, e.sum), Ey = (e) => new xy(e.error, e.quantiles, e.count, e.min, e.max, e.sum), Dy = (e) => C(e, oy), Oy = (e) => C(e, cy), ky = (e) => C(e, uy), Ay = (e) => C(e, fy), jy = (e) => C(e, my), My = /*#__PURE__*/ Symbol.for("effect/MetricHook"), Ny = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Py = (e) => ({
	[My]: Ny,
	pipe() {
		return F(this, arguments);
	},
	...e
}), Fy = /*#__PURE__*/ BigInt(0), Iy = (e) => {
	let t = e.keyType.bigint ? Fy : 0, n = e.keyType.incremental ? e.keyType.bigint ? (e) => e >= Fy : (e) => e >= 0 : (e) => !0, r = (e) => {
		n(e) && (t += e);
	};
	return Py({
		get: () => Sy(t),
		update: r,
		modify: r
	});
}, Ly = (e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.keyType.preregisteredWords) t.set(n, 0);
	let n = (e) => {
		let n = t.get(e) ?? 0;
		t.set(e, n + 1);
	};
	return Py({
		get: () => Cy(t),
		update: n,
		modify: n
	});
}, Ry = (e, t) => {
	let n = t;
	return Py({
		get: () => wy(n),
		update: (e) => {
			n = e;
		},
		modify: (e) => {
			n += e;
		}
	});
}, zy = (e) => {
	let t = e.keyType.boundaries.values, n = t.length, r = new Uint32Array(n + 1), i = new Float64Array(n), a = 0, o = 0, s = Number.MAX_VALUE, c = Number.MIN_VALUE;
	x(t, nr(xr), pr((e, t) => {
		i[t] = e;
	}));
	let l = (e) => {
		let t = 0, l = n;
		for (; t !== l;) {
			let n = Math.floor(t + (l - t) / 2);
			e <= i[n] ? l = n : t = n, l === t + 1 && (e <= i[t] ? l = t : t = l);
		}
		r[t] = r[t] + 1, a += 1, o += e, e < s && (s = e), e > c && (c = e);
	}, u = () => {
		let e = Pn(n), t = 0;
		for (let a = 0; a < n; a++) {
			let n = i[a], o = r[a];
			t += o, e[a] = [n, t];
		}
		return e;
	};
	return Py({
		get: () => Ty({
			buckets: u(),
			count: a,
			min: s,
			max: c,
			sum: o
		}),
		update: l,
		modify: l
	});
}, By = (e) => {
	let { error: t, maxAge: n, maxSize: r, quantiles: i } = e.keyType, a = x(i, nr(xr)), o = Pn(r), s = 0, c = 0, l = 0, u = 0, d = 0, f = (e) => {
		let i = [], s = 0;
		for (; s !== r - 1;) {
			let t = o[s];
			if (t != null) {
				let [r, a] = t, o = na(e - r);
				ha(o, Qi) && ma(o, n) && i.push(a);
			}
			s += 1;
		}
		return Vy(t, a, nr(i, xr));
	}, p = (e, t) => {
		if (r > 0) {
			s += 1;
			let n = s % r;
			o[n] = [t, e];
		}
		u = c === 0 ? e : Math.min(u, e), d = c === 0 ? e : Math.max(d, e), c += 1, l += e;
	};
	return Py({
		get: () => Ey({
			error: t,
			quantiles: f(Date.now()),
			count: c,
			min: u,
			max: d,
			sum: l
		}),
		update: ([e, t]) => p(e, t),
		modify: ([e, t]) => p(e, t)
	});
}, Vy = (e, t, n) => {
	let r = n.length;
	if (!Hn(t)) return dr();
	let i = t[0], a = t.slice(1), o = Hy(e, r, I(), 0, i, n), s = fr(o);
	return a.forEach((t) => {
		s.push(Hy(e, r, o.value, o.consumed, t, o.rest));
	}), pr(s, (e) => [e.quantile, e.value]);
}, Hy = (e, t, n, r, i, a) => {
	let o = e, s = t, c = n, l = r, u = i, d = a, f = e, p = t, m = n, ee = r, te = i, ne = a;
	for (;;) {
		if (!Hn(d)) return {
			quantile: u,
			value: I(),
			consumed: l,
			rest: []
		};
		if (u === 1) return {
			quantile: u,
			value: L(Xn(d)),
			consumed: l + d.length,
			rest: []
		};
		let e = Jn(d), t = $n(d, (t) => t === e), n = u * s, r = o / 2 * n, i = l + t[0].length, a = Math.abs(i - n);
		if (i < n - r) f = o, p = s, m = qn(d), ee = i, te = u, ne = t[1], o = f, s = p, c = m, l = ee, u = te, d = ne;
		else {
			if (i > n + r) {
				let t = Cn(c) ? L(e) : c;
				return {
					quantile: u,
					value: t,
					consumed: l,
					rest: d
				};
			}
			switch (c._tag) {
				case "None":
					f = o, p = s, m = qn(d), ee = i, te = u, ne = t[1], o = f, s = p, c = m, l = ee, u = te, d = ne;
					continue;
				case "Some":
					if (a < Math.abs(n - c.value)) {
						f = o, p = s, m = qn(d), ee = i, te = u, ne = t[1], o = f, s = p, c = m, l = ee, u = te, d = ne;
						continue;
					}
					return {
						quantile: u,
						value: L(c.value),
						consumed: l,
						rest: d
					};
			}
		}
	}
	throw Error("BUG: MetricHook.resolveQuantiles - please report an issue at https://github.com/Effect-TS/effect/issues");
}, Uy = /*#__PURE__*/ Symbol.for("effect/MetricPair"), Wy = {
/* c8 ignore next */
_Type: (e) => e }, Gy = (e, t) => ({
	[Uy]: Wy,
	metricKey: e,
	metricState: t,
	pipe() {
		return F(this, arguments);
	}
}), Ky = /*#__PURE__*/ Symbol.for("effect/MetricRegistry"), qy = class {
	[Ky] = Ky;
	map = /*#__PURE__*/ Dp();
	snapshot() {
		let e = [];
		for (let [t, n] of this.map) e.push(Gy(t, n.get()));
		return e;
	}
	get(e) {
		let t = x(this.map, Op(e), kn);
		if (t == null) {
			if (Gv(e.keyType)) return this.getCounter(e);
			if (qv(e.keyType)) return this.getGauge(e);
			if (Kv(e.keyType)) return this.getFrequency(e);
			if (Jv(e.keyType)) return this.getHistogram(e);
			if (Yv(e.keyType)) return this.getSummary(e);
			throw Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
		}
		return t;
	}
	getCounter(e) {
		let t = x(this.map, Op(e), kn);
		if (t == null) {
			let n = Iy(e);
			x(this.map, Ap(e)) || x(this.map, jp(e, n)), t = n;
		}
		return t;
	}
	getFrequency(e) {
		let t = x(this.map, Op(e), kn);
		if (t == null) {
			let n = Ly(e);
			x(this.map, Ap(e)) || x(this.map, jp(e, n)), t = n;
		}
		return t;
	}
	getGauge(e) {
		let t = x(this.map, Op(e), kn);
		if (t == null) {
			let n = Ry(e, e.keyType.bigint ? BigInt(0) : 0);
			x(this.map, Ap(e)) || x(this.map, jp(e, n)), t = n;
		}
		return t;
	}
	getHistogram(e) {
		let t = x(this.map, Op(e), kn);
		if (t == null) {
			let n = zy(e);
			x(this.map, Ap(e)) || x(this.map, jp(e, n)), t = n;
		}
		return t;
	}
	getSummary(e) {
		let t = x(this.map, Op(e), kn);
		if (t == null) {
			let n = By(e);
			x(this.map, Ap(e)) || x(this.map, jp(e, n)), t = n;
		}
		return t;
	}
}, Jy = () => new qy(), Yy = /*#__PURE__*/ Symbol.for("effect/Metric"), Xy = {
	/* c8 ignore next */
	_Type: (e) => e,
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Zy = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Metric/globalMetricRegistry"), () => Jy()), Qy = function(e, t, n, r) {
	let i = Object.assign((e) => Cd(e, (e) => ib(i, e)), {
		[Yy]: Xy,
		keyType: e,
		unsafeUpdate: t,
		unsafeValue: n,
		unsafeModify: r,
		register() {
			return this.unsafeValue([]), this;
		},
		pipe() {
			return F(this, arguments);
		}
	});
	return i;
}, $y = (e, t) => eb(ty(e, t)), eb = (e) => {
	let t, n = /* @__PURE__ */ new WeakMap(), r = (r) => {
		if (r.length === 0) return t === void 0 && (t = Zy.get(e)), t;
		let i = n.get(r);
		return i === void 0 && (i = Zy.get(ry(e, r)), n.set(r, i)), i;
	};
	return Qy(e.keyType, (e, t) => r(t).update(e), (e) => r(e).get(), (e, t) => r(t).modify(e));
}, tb = (e, t, n) => eb(ny(e, t, n)), nb = /*#__PURE__*/ y(3, (e, t, n) => rb(e, [eg(t, n)])), rb = /*#__PURE__*/ y(2, (e, t) => Qy(e.keyType, (n, r) => e.unsafeUpdate(n, ur(t, r)), (n) => e.unsafeValue(ur(t, n)), (n, r) => e.unsafeModify(n, ur(t, r)))), ib = /*#__PURE__*/ y(2, (e, t) => Qd(xf, (n) => J(() => e.unsafeUpdate(t, n))));
({ ...Wt });
var ab = /*#__PURE__*/ y(2, (e, t) => Qd(Q_, (n) => J(() => {
	if (n.has(e)) {
		let r = n.get(e);
		r.state.completed || (r.state.completed = !0, dp(r.result, t));
	}
}))), ob = /*#__PURE__*/ Symbol.for("effect/Supervisor"), sb = {
/* c8 ignore next */
_T: (e) => e }, cb = class e {
	underlying;
	value0;
	[ob] = sb;
	constructor(e, t) {
		this.underlying = e, this.value0 = t;
	}
	get value() {
		return this.value0;
	}
	onStart(e, t, n, r) {
		this.underlying.onStart(e, t, n, r);
	}
	onEnd(e, t) {
		this.underlying.onEnd(e, t);
	}
	onEffect(e, t) {
		this.underlying.onEffect(e, t);
	}
	onSuspend(e) {
		this.underlying.onSuspend(e);
	}
	onResume(e) {
		this.underlying.onResume(e);
	}
	map(t) {
		return new e(this, x(this.value, G(t)));
	}
	zip(e) {
		return new lb(this, e);
	}
}, lb = class e {
	left;
	right;
	_tag = "Zip";
	[ob] = sb;
	constructor(e, t) {
		this.left = e, this.right = t;
	}
	get value() {
		return Fd(this.left.value, this.right.value);
	}
	onStart(e, t, n, r) {
		this.left.onStart(e, t, n, r), this.right.onStart(e, t, n, r);
	}
	onEnd(e, t) {
		this.left.onEnd(e, t), this.right.onEnd(e, t);
	}
	onEffect(e, t) {
		this.left.onEffect(e, t), this.right.onEffect(e, t);
	}
	onSuspend(e) {
		this.left.onSuspend(e), this.right.onSuspend(e);
	}
	onResume(e) {
		this.left.onResume(e), this.right.onResume(e);
	}
	map(e) {
		return new cb(this, x(this.value, G(e)));
	}
	zip(t) {
		return new e(this, t);
	}
}, ub = (e) => C(e, ob) && Ie(e, "Zip"), db = class {
	effect;
	[ob] = sb;
	constructor(e) {
		this.effect = e;
	}
	get value() {
		return this.effect;
	}
	onStart(e, t, n, r) {}
	onEnd(e, t) {}
	onEffect(e, t) {}
	onSuspend(e) {}
	onResume(e) {}
	map(e) {
		return new cb(this, x(this.value, G(e)));
	}
	zip(e) {
		return new lb(this, e);
	}
	onRun(e, t) {
		return e();
	}
}, fb = (e) => new db(e), pb = /*#__PURE__*/ S("effect/Supervisor/none", () => fb(Y)), mb = zc, hb = "Empty", gb = "AddSupervisor", _b = "RemoveSupervisor", vb = "AndThen", yb = { _tag: hb }, bb = (e, t) => ({
	_tag: vb,
	first: e,
	second: t
}), xb = (e, t) => Sb(t, vi(e)), Sb = (e, t) => {
	let n = e, r = t;
	for (; Mi(r);) {
		let e = Fi(r);
		switch (e._tag) {
			case hb:
				r = Ii(r);
				break;
			case gb:
				n = n.zip(e.supervisor), r = Ii(r);
				break;
			case _b:
				n = Cb(n, e.supervisor), r = Ii(r);
				break;
			case vb: r = Oi(e.first)(Oi(e.second)(Ii(r)));
		}
	}
	return n;
}, Cb = (e, t) => j(e, t) ? pb : ub(e) ? Cb(e.left, t).zip(Cb(e.right, t)) : e, wb = (e) => j(e, pb) ? Ro() : ub(e) ? x(wb(e.left), Ko(wb(e.right))) : Bo(e), Tb = /*#__PURE__*/ mb({
	empty: yb,
	patch: xb,
	combine: bb,
	diff: (e, t) => {
		if (j(e, t)) return yb;
		let n = wb(e), r = wb(t);
		return bb(x(r, Go(n), qo(yb, (e, t) => bb(e, {
			_tag: gb,
			supervisor: t
		}))), x(n, Go(r), qo(yb, (e, t) => bb(e, {
			_tag: _b,
			supervisor: t
		}))));
	}
}), Eb = /*#__PURE__*/ $y("effect_fiber_started", { incremental: !0 }), Db = /*#__PURE__*/ $y("effect_fiber_active"), Ob = /*#__PURE__*/ $y("effect_fiber_successes", { incremental: !0 }), kb = /*#__PURE__*/ $y("effect_fiber_failures", { incremental: !0 }), Ab = /*#__PURE__*/ nb(/*#__PURE__*/ tb("effect_fiber_lifetimes", /*#__PURE__*/ jv({
	start: .5,
	factor: 2,
	count: 35
})), "time_unit", "milliseconds"), jb = "Continue", Mb = "Done", Nb = "Yield", Pb = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Fb = (e) => {
	throw Error(`BUG: FiberRuntime - ${pt(e)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, Ib = /*#__PURE__*/ Symbol.for("effect/internal/fiberRuntime/YieldedOp"), Lb = /*#__PURE__*/ S("effect/internal/fiberRuntime/yieldedOpChannel", () => ({ currentOp: null })), Rb = {
	[wt]: (e, t, n) => w(() => t.effect_instruction_i1(n)),
	OnStep: (e, t, n) => Z(Z(n)),
	[Tt]: (e, t, n) => w(() => t.effect_instruction_i2(n)),
	[Nt]: (e, t, n) => (e.patchRuntimeFlags(e.currentRuntimeFlags, t.patch), al(e.currentRuntimeFlags) && e.isInterrupted() ? X(e.getInterruptedCause()) : Z(n)),
	[kt]: (e, t, n) => (w(() => t.effect_instruction_i2(n)), w(() => t.effect_instruction_i0()) ? (e.pushStack(t), w(() => t.effect_instruction_i1())) : Y),
	[At]: (e, t, n) => {
		for (;;) {
			let r = w(() => t.effect_instruction_i0.next(n));
			if (r.done) return Z(r.value);
			let i = $e(r.value);
			if (!Uf(i)) return e.pushStack(t), i;
			if (i._tag === "Failure") return i;
			n = i.value;
		}
	}
}, zb = {
	[ev]: (e, t, n, r) => (e.processNewInterruptSignal(r.cause), al(t) ? X(r.cause) : n),
	[nv]: (e, t, n, r) => {
		throw Error("It is illegal to have multiple concurrent run loops in a single fiber");
	},
	[tv]: (e, t, n, r) => (r.onFiber(e, Gg(t)), n),
	[rv]: (e, t, n, r) => W(Pd(), () => n)
}, Bb = (e) => _d(bl(e), (e) => nx(Rl(e), ([e, t]) => {
	let n = /* @__PURE__ */ new Map(), r = [];
	for (let e of t) {
		r.push(xi(e));
		for (let t of e) n.set(t.request, t);
	}
	let i = r.flat();
	return tf(kx(e.runAll(r), i, () => i.forEach((e) => {
		e.listeners.interrupted = !0;
	})), Q_, n);
}, !1, !1)), Vb = /*#__PURE__*/ Ft(), Hb = class extends Mh {
	[pv] = mv;
	[gv] = Pb;
	_fiberRefs;
	_fiberId;
	_queue = [];
	_children = null;
	_observers = [];
	_running = !1;
	_stack = [];
	_asyncInterruptor = null;
	_asyncBlockingOn = null;
	_exitValue = null;
	_steps = [];
	_isYielding = !1;
	currentRuntimeFlags;
	currentOpCount = 0;
	currentSupervisor;
	currentScheduler;
	currentTracer;
	currentSpan;
	currentContext;
	currentDefaultServices;
	constructor(e, t, n) {
		if (super(), this.currentRuntimeFlags = n, this._fiberId = e, this._fiberRefs = t, ul(n)) {
			let e = this.getFiberRef(xf);
			Eb.unsafeUpdate(1, e), Db.unsafeUpdate(1, e);
		}
		this.refreshRefCache();
	}
	commit() {
		return _v(this);
	}
	id() {
		return this._fiberId;
	}
	resume(e) {
		this.tell(ov(e));
	}
	get status() {
		return this.ask((e, t) => t);
	}
	get runtimeFlags() {
		return this.ask((e, t) => qg(t) ? e.currentRuntimeFlags : t.runtimeFlags);
	}
	scope() {
		return dv(this);
	}
	get children() {
		return this.ask((e) => Array.from(e.getChildren()));
	}
	getChildren() {
		return this._children === null && (this._children = /* @__PURE__ */ new Set()), this._children;
	}
	getInterruptedCause() {
		return this.getFiberRef(Cf);
	}
	fiberRefs() {
		return this.ask((e) => e.getFiberRefs());
	}
	ask(e) {
		return q(() => {
			let t = ip(this._fiberId);
			return this.tell(av((n, r) => {
				dp(t, J(() => e(n, r)));
			})), sp(t);
		});
	}
	tell(e) {
		this._queue.push(e), this._running || (this._running = !0, this.drainQueueLaterOnExecutor());
	}
	get await() {
		return $u((e) => {
			let t = (t) => e(K(t));
			if (this._exitValue !== null) t(this._exitValue);
			else return this.tell(av((e, n) => {
				e._exitValue === null ? e.addObserver(t) : t(this._exitValue);
			})), J(() => this.tell(av((e, n) => {
				e.removeObserver(t);
			})));
		}, this.id());
	}
	get inheritAll() {
		return V((e, t) => {
			let n = e.id(), r = e.getFiberRefs(), i = t.runtimeFlags, a = oh(r, n, this.getFiberRefs());
			return e.setFiberRefs(a), Dd(x(fl(i, e.getFiberRef(Ex)), _l(1), _l(16)));
		});
	}
	get poll() {
		return J(() => On(this._exitValue));
	}
	unsafePoll() {
		return this._exitValue;
	}
	interruptAsFork(e) {
		return J(() => this.tell(iv(Zl(e))));
	}
	unsafeInterruptAsFork(e) {
		this.tell(iv(Zl(e)));
	}
	addObserver(e) {
		this._exitValue === null ? this._observers.push(e) : e(this._exitValue);
	}
	removeObserver(e) {
		this._observers = this._observers.filter((t) => t !== e);
	}
	getFiberRefs() {
		return this.setFiberRef(Ex, this.currentRuntimeFlags), this._fiberRefs;
	}
	unsafeDeleteFiberRef(e) {
		this._fiberRefs = lh(this._fiberRefs, e);
	}
	getFiberRef(e) {
		return this._fiberRefs.locals.has(e) ? this._fiberRefs.locals.get(e)[0][1] : e.initial;
	}
	setFiberRef(e, t) {
		this._fiberRefs = fh(this._fiberRefs, {
			fiberId: this._fiberId,
			fiberRef: e,
			value: t
		}), this.refreshRefCache();
	}
	refreshRefCache() {
		this.currentDefaultServices = this.getFiberRef(eh), this.currentTracer = this.currentDefaultServices.unsafeMap.get(qm.key), this.currentSupervisor = this.getFiberRef(Dx), this.currentScheduler = this.getFiberRef(Z_), this.currentContext = this.getFiberRef(uf), this.currentSpan = this.currentContext.unsafeMap.get(Jm.key);
	}
	setFiberRefs(e) {
		this._fiberRefs = e, this.refreshRefCache();
	}
	addChild(e) {
		this.getChildren().add(e);
	}
	removeChild(e) {
		this.getChildren().delete(e);
	}
	transferChildren(e) {
		let t = this._children;
		if (this._children = null, t !== null && t.size > 0) for (let n of t) n._exitValue === null && e.add(this.currentRuntimeFlags, n);
	}
	drainQueueOnCurrentThread() {
		let e = !0;
		for (; e;) {
			let t = jb, n = globalThis[vv];
			globalThis[vv] = this;
			try {
				for (; t === jb;) t = this._queue.length === 0 ? Mb : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
			} finally {
				this._running = !1, globalThis[vv] = n;
			}
			this._queue.length > 0 && !this._running ? (this._running = !0, t === Nb ? (this.drainQueueLaterOnExecutor(), e = !1) : e = !0) : e = !1;
		}
	}
	drainQueueLaterOnExecutor() {
		this.currentScheduler.scheduleTask(this.run, this.getFiberRef(df), this);
	}
	drainQueueWhileRunning(e, t) {
		let n = t;
		for (; this._queue.length > 0;) {
			let t = this._queue.splice(0, 1)[0];
			n = zb[t._tag](this, e, n, t);
		}
		return n;
	}
	isInterrupted() {
		return !nu(this.getFiberRef(Cf));
	}
	addInterruptedCause(e) {
		let t = this.getFiberRef(Cf);
		this.setFiberRef(Cf, $l(t, e));
	}
	processNewInterruptSignal(e) {
		this.addInterruptedCause(e), this.sendInterruptSignalToAllChildren();
	}
	sendInterruptSignalToAllChildren() {
		if (this._children === null || this._children.size === 0) return !1;
		let e = !1;
		for (let t of this._children) t.tell(iv(Zl(this.id()))), e = !0;
		return e;
	}
	interruptAllChildren() {
		if (this.sendInterruptSignalToAllChildren()) {
			let e = this._children.values();
			this._children = null;
			let t = !1;
			return kd({
				while: () => !t,
				body: () => {
					let n = e.next();
					return n.done ? J(() => {
						t = !0;
					}) : Yu(n.value.await);
				},
				step: () => {}
			});
		}
		return null;
	}
	reportExitValue(e) {
		if (ul(this.currentRuntimeFlags)) {
			let t = this.getFiberRef(xf), n = this.id().startTimeMillis, r = Date.now();
			switch (Ab.unsafeUpdate(r - n, t), Db.unsafeUpdate(-1, t), e._tag) {
				case Et:
					Ob.unsafeUpdate(1, t);
					break;
				case St: kb.unsafeUpdate(1, t);
			}
		}
		if (e._tag === "Failure") {
			let t = this.getFiberRef(yf);
			!iu(e.cause) && t._tag === "Some" && this.log("Fiber terminated with an unhandled error", e.cause, t);
		}
	}
	setExitValue(e) {
		this._exitValue = e, this.reportExitValue(e);
		for (let t = this._observers.length - 1; t >= 0; t--) this._observers[t](e);
		this._observers = [];
	}
	getLoggers() {
		return this.getFiberRef(qb);
	}
	log(e, t, n) {
		let r = wn(n) ? n.value : this.getFiberRef(mf);
		if (Eh(this.getFiberRef(Ub), r)) return;
		let i = this.getFiberRef(hf), a = this.getFiberRef(pf), o = this.getLoggers(), s = this.getFiberRefs();
		if (Ho(o) > 0) {
			let n = ni(this.getFiberRef(eh), Pp), c = new Date(n.unsafeCurrentTimeMillis());
			vt(s, () => {
				for (let n of o) n.log({
					fiberId: this.id(),
					logLevel: r,
					message: e,
					cause: t,
					context: s,
					spans: i,
					annotations: a,
					date: c
				});
			});
		}
	}
	evaluateMessageWhileSuspended(e) {
		switch (e._tag) {
			case rv: return Nb;
			case ev: return this.processNewInterruptSignal(e.cause), this._asyncInterruptor !== null && (this._asyncInterruptor(X(e.cause)), this._asyncInterruptor = null), jb;
			case nv: return this._asyncInterruptor = null, this._asyncBlockingOn = null, this.evaluateEffect(e.effect), jb;
			case tv: return e.onFiber(this, this._exitValue === null ? Kg(this.currentRuntimeFlags, this._asyncBlockingOn) : Wg), jb;
			default: return Fb(e);
		}
	}
	evaluateEffect(e) {
		this.currentSupervisor.onResume(this);
		try {
			let t = al(this.currentRuntimeFlags) && this.isInterrupted() ? X(this.getInterruptedCause()) : e;
			for (; t !== null;) {
				let e = t, n = this.runLoop(e);
				if (n === Ib) {
					let e = Lb.currentOp;
					Lb.currentOp = null, e._op === "Yield" ? nl(this.currentRuntimeFlags) ? (this.tell(sv()), this.tell(ov(tp)), t = null) : t = tp : e._op === "Async" && (t = null);
				} else {
					this.currentRuntimeFlags = x(this.currentRuntimeFlags, il(16));
					let e = this.interruptAllChildren();
					e === null ? (this._queue.length === 0 ? this.setExitValue(n) : this.tell(ov(n)), t = null) : t = W(e, () => n);
				}
			}
		} finally {
			this.currentSupervisor.onSuspend(this);
		}
	}
	start(e) {
		if (this._running) this.tell(ov(e));
		else {
			this._running = !0;
			let t = globalThis[vv];
			globalThis[vv] = this;
			try {
				this.evaluateEffect(e);
			} finally {
				this._running = !1, globalThis[vv] = t, this._queue.length > 0 && this.drainQueueLaterOnExecutor();
			}
		}
	}
	startFork(e) {
		this.tell(ov(e));
	}
	patchRuntimeFlags(e, t) {
		let n = pl(e, t);
		return globalThis[vv] = this, this.currentRuntimeFlags = n, n;
	}
	initiateAsync(e, t) {
		let n = !1, r = (e) => {
			n || (n = !0, this.tell(ov(e)));
		};
		al(e) && (this._asyncInterruptor = r);
		try {
			t(r);
		} catch (e) {
			r(U(Xl(e)));
		}
	}
	pushStack(e) {
		this._stack.push(e), e._op === "OnStep" && this._steps.push({
			refs: this.getFiberRefs(),
			flags: this.currentRuntimeFlags
		});
	}
	popStack() {
		let e = this._stack.pop();
		if (e) return e._op === "OnStep" && this._steps.pop(), e;
	}
	getNextSuccessCont() {
		let e = this.popStack();
		for (; e;) {
			if (e._op !== "OnFailure") return e;
			e = this.popStack();
		}
	}
	getNextFailCont() {
		let e = this.popStack();
		for (; e;) {
			if (e._op !== "OnSuccess" && e._op !== "While" && e._op !== "Iterator") return e;
			e = this.popStack();
		}
	}
	Tag(e) {
		return J(() => ri(this.currentContext, e));
	}
	Left(e) {
		return H(e.left);
	}
	None(e) {
		return H(new Bf());
	}
	Right(e) {
		return Z(e.right);
	}
	Some(e) {
		return Z(e.value);
	}
	Micro(e) {
		return Zu((t) => {
			let n = t, r = G_(I_(e, this.currentContext));
			return r.addObserver((e) => {
				if (e._tag === "Success") return n(Z(e.value));
				switch (e.cause._tag) {
					case "Interrupt": return n(X(Zl(ps)));
					case "Fail": return n(H(e.cause.error));
					case "Die": return n(rd(e.cause.defect));
				}
			}), Zu((e) => {
				n = (t) => {
					e(Y);
				}, r.unsafeInterrupt();
			});
		});
	}
	[Dt](e) {
		let t = w(() => e.effect_instruction_i0()), n = this.getNextSuccessCont();
		return n === void 0 ? (Lb.currentOp = Z(t), Ib) : (n._op in Rb || Fb(n), Rb[n._op](this, n, t));
	}
	[Et](e) {
		let t = e, n = this.getNextSuccessCont();
		return n === void 0 ? (Lb.currentOp = t, Ib) : (n._op in Rb || Fb(n), Rb[n._op](this, n, t.effect_instruction_i0));
	}
	[St](e) {
		let t = e.effect_instruction_i0, n = this.getNextFailCont();
		if (n !== void 0) switch (n._op) {
			case Ct:
			case Tt: return al(this.currentRuntimeFlags) && this.isInterrupted() ? X(du(t)) : w(() => n.effect_instruction_i1(t));
			case "OnStep": return al(this.currentRuntimeFlags) && this.isInterrupted() ? X(du(t)) : Z(X(t));
			case Nt: return this.patchRuntimeFlags(this.currentRuntimeFlags, n.patch), al(this.currentRuntimeFlags) && this.isInterrupted() ? X($l(t, this.getInterruptedCause())) : X(t);
			default: Fb(n);
		}
		else return Lb.currentOp = X(t), Ib;
	}
	[jt](e) {
		return w(() => e.effect_instruction_i0(this, Gg(this.currentRuntimeFlags)));
	}
	Blocked(e) {
		let t = this.getFiberRefs(), n = this.currentRuntimeFlags;
		if (this._steps.length > 0) {
			let r = [], i = this._steps[this._steps.length - 1], a = this.popStack();
			for (; a && a._op !== "OnStep";) r.push(a), a = this.popStack();
			this.setFiberRefs(i.refs), this.currentRuntimeFlags = i.flags;
			let o = Og(i.refs, t), s = fl(i.flags, n);
			return Z(Bu(e.effect_instruction_i0, V((t) => {
				for (; r.length > 0;) t.pushStack(r.pop());
				return t.setFiberRefs(kg(t.id(), t.getFiberRefs())(o)), t.currentRuntimeFlags = pl(s)(t.currentRuntimeFlags), e.effect_instruction_i1;
			})));
		}
		return Ed((t) => W(ix(Vu(e.effect_instruction_i0)), () => t(e.effect_instruction_i1)));
	}
	RunBlocked(e) {
		return Bb(e.effect_instruction_i0);
	}
	[Ot](e) {
		let t = e.effect_instruction_i0, n = this.currentRuntimeFlags, r = pl(n, t);
		if (al(r) && this.isInterrupted()) return X(this.getInterruptedCause());
		if (this.patchRuntimeFlags(this.currentRuntimeFlags, t), e.effect_instruction_i1) {
			let t = fl(r, n);
			return this.pushStack(new Uu(t, e)), w(() => e.effect_instruction_i1(n));
		}
		return tp;
	}
	[wt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	OnStep(e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[Ct](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[Tt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[bt](e) {
		return this._asyncBlockingOn = e.effect_instruction_i1, this.initiateAsync(this.currentRuntimeFlags, e.effect_instruction_i0), Lb.currentOp = e, Ib;
	}
	[Mt](e) {
		return this._isYielding = !1, Lb.currentOp = e, Ib;
	}
	[kt](e) {
		let t = e.effect_instruction_i0, n = e.effect_instruction_i1;
		return t() ? (this.pushStack(e), n()) : tp;
	}
	[At](e) {
		return Rb[At](this, e, void 0);
	}
	[xt](e) {
		return w(() => e.commit());
	}
	runLoop(e) {
		let t = e;
		for (this.currentOpCount = 0;;) {
			if (this.currentRuntimeFlags & 2 && this.currentSupervisor.onEffect(this, t), this._queue.length > 0 && (t = this.drainQueueWhileRunning(this.currentRuntimeFlags, t)), !this._isYielding) {
				this.currentOpCount += 1;
				let e = this.currentScheduler.shouldYield(this);
				if (e !== !1) {
					this._isYielding = !0, this.currentOpCount = 0;
					let n = t;
					t = W(Pd({ priority: e }), () => n);
				}
			}
			try {
				if (t = this.currentTracer.context(() => {
					if (Vb !== t[Hu]._V) {
						let e = this.getFiberRef(bf);
						if (e._tag === "Some") {
							let n = t[Hu]._V;
							this.log(`Executing an Effect versioned ${n} with a Runtime of version ${Ft()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, Jl, e);
						}
					}
					return this[t._op](t);
				}, this), t === Ib) {
					let e = Lb.currentOp;
					return e._op === "Yield" || e._op === "Async" ? Ib : (Lb.currentOp = null, e._op === "Success" || e._op === "Failure" ? e : X(Xl(e)));
				}
			} catch (e) {
				t = t !== Ib && !C(t, "_op") || !(t._op in this) ? id(`Not a valid effect: ${pt(t)}`) : Rf(e) ? X($l(Xl(e), Zl(ps))) : rd(e);
			}
		}
	}
	run = () => {
		this.drainQueueOnCurrentThread();
	};
}, Ub = /*#__PURE__*/ S("effect/FiberRef/currentMinimumLogLevel", () => rf(Dh("Info"))), Wb = (e) => xv((t) => {
	ni(hh(t.context, eh), Lm).unsafe.log(e.log(t));
}), Gb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Logger/defaultLogger"), () => Wb(Cv)), Kb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Logger/tracerLogger"), () => xv(({ annotations: e, cause: t, context: n, fiberId: r, logLevel: i, message: a }) => {
	let o = gg(ii(dh(n, uf), Jm));
	if (o._tag === "None" || o.value._tag === "ExternalSpan") return;
	let s = ri(dh(n, eh), Pp), c = {};
	for (let [t, n] of e) c[t] = n;
	c["effect.fiberId"] = hs(r), c["effect.logLevel"] = i.label, t !== null && t._tag !== "Empty" && (c["effect.cause"] = wu(t, { renderErrorCause: !0 })), o.value.event(pt(Array.isArray(a) && a.length === 1 ? a[0] : a), s.unsafeCurrentTimeNanos(), c);
})), qb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLoggers"), () => af(Bo(Gb, Kb))), Jb = /*#__PURE__*/ y((e) => Ku(e[0]), (e, t) => Td(Cd(e, (e) => Yb((n) => t(e, n))))), Yb = (e) => V((t) => {
	let n = t.getFiberRefs(), r = rl(t.currentRuntimeFlags, 1);
	return W(vx, (t) => Df(t, (t) => V((i) => {
		let a = i.getFiberRefs(), o = i.currentRuntimeFlags, s = Og(a, n), c = fl(o, r), l = Og(n, a);
		return i.setFiberRefs(kg(s, i.id(), n)), Ox(Nd(e(t), c), J(() => {
			i.setFiberRefs(kg(l, i.id(), i.getFiberRefs()));
		}));
	})));
}), Xb = (e) => {
	if (Array.isArray(e) || Re(e)) return [e, I()];
	let t = Object.keys(e), n = t.length;
	return [t.map((t) => e[t]), L((e) => {
		let r = {};
		for (let i = 0; i < n; i++) r[t[i]] = e[i];
		return r;
	})];
}, Zb = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(ad(t));
	return W(ex(r, b, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => {
		let r = I(), i = e.length, a = Array(i), o = Array(i), s = !1;
		for (let t = 0; t < i; t++) {
			let n = e[t];
			n._tag === "Left" ? (a[t] = L(n.left), s = !0) : (o[t] = n.right, a[t] = r);
		}
		return s ? t._tag === "Some" ? H(t.value(a)) : H(a) : n?.discard ? Y : t._tag === "Some" ? K(t.value(o)) : K(o);
	});
}, Qb = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(ad(t));
	return n?.discard ? ex(r, b, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		discard: !0,
		concurrentFinalizers: n?.concurrentFinalizers
	}) : G(ex(r, b, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => t._tag === "Some" ? t.value(e) : e);
}, $b = (e, t) => {
	let [n, r] = Xb(e);
	return t?.mode === "validate" ? Zb(n, r, t) : t?.mode === "either" ? Qb(n, r, t) : t?.discard !== !0 && r._tag === "Some" ? G(ex(n, b, t), r.value) : ex(n, b, t);
}, ex = /*#__PURE__*/ y((e) => Re(e[0]), (e, t, n) => V((r) => {
	let i = n?.batching === !0 || n?.batching === "inherit" && r.getFiberRef(vf);
	return n?.discard ? $_(n.concurrency, () => dx(Tg, n?.concurrentFinalizers)((n) => i ? nx(e, (e, r) => n(t(e, r)), !0, !1, 1) : _d(e, (e, r) => n(t(e, r)))), () => dx(Eg, n?.concurrentFinalizers)((n) => nx(e, (e, r) => n(t(e, r)), i, !1)), (r) => dx(Dg(r), n?.concurrentFinalizers)((n) => nx(e, (e, r) => n(t(e, r)), i, !1, r))) : $_(n?.concurrency, () => dx(Tg, n?.concurrentFinalizers)((n) => i ? rx(e, 1, (e, r) => n(t(e, r)), !0) : gd(e, (e, r) => n(t(e, r)))), () => dx(Eg, n?.concurrentFinalizers)((n) => tx(e, (e, r) => n(t(e, r)), i)), (r) => dx(Dg(r), n?.concurrentFinalizers)((n) => rx(e, r, (e, r) => n(t(e, r)), i)));
})), tx = (e, t, n) => q(() => {
	let r = R(e), i = Array(r.length);
	return Ld(nx(r, (e, n) => W(t(e, n), (e) => J(() => i[n] = e)), n, !1), K(i));
}), nx = (e, t, n, r, i) => Ed((a) => wd((o) => V((s) => {
	let c = Array.from(e).reverse(), l = c.length;
	if (l === 0) return Y;
	let u = 0, d = !1, f = i ? Math.min(c.length, i) : c.length, p = /* @__PURE__ */ new Set(), m = [], ee = () => p.forEach((e) => {
		e.currentScheduler.scheduleTask(() => {
			e.unsafeInterruptAsFork(s.id());
		}, 0, e);
	}), te = [], ne = [], re = [], h = () => {
		let e = m.filter(({ exit: e }) => e._tag === "Failure").sort((e, t) => e.index < t.index ? -1 : e.index === t.index ? 0 : 1).map(({ exit: e }) => e);
		return e.length === 0 && e.push(tp), e;
	}, ie = (e, t = !1) => {
		let n = Td(o(e)), r = ox(n, s, s.currentRuntimeFlags, fv);
		return s.currentScheduler.scheduleTask(() => {
			t && r.unsafeInterruptAsFork(s.id()), r.resume(n);
		}, 0, r), r;
	}, g = () => {
		r || (l -= c.length, c = []), d = !0, ee();
	}, _ = n ? dd : od, ae = ie($u((e) => {
		let r = (e, t) => {
			e._op === "Blocked" ? re.push(e) : (m.push({
				index: t,
				exit: e
			}), e._op === "Failure" && !d && g());
		}, o = () => {
			if (c.length > 0) {
				let f = c.pop(), ee = u++, g = () => {
					let e = c.pop();
					return ee = u++, W(Pd(), () => W(_(a(t(e, ee))), ae));
				}, ae = (e) => c.length > 0 && (r(e, ee), c.length > 0) ? g() : K(e), oe = W(_(a(t(f, ee))), ae), se = ie(oe);
				te.push(se), p.add(se), d && se.currentScheduler.scheduleTask(() => {
					se.unsafeInterruptAsFork(s.id());
				}, 0, se), se.addObserver((t) => {
					let a;
					if (a = t._op === "Failure" ? t : t.effect_instruction_i0, ne.push(se), p.delete(se), r(a, ee), m.length === l) e(K(En(Jf(h(), { parallel: !0 }), () => tp)));
					else if (re.length + m.length === l) {
						let t = h();
						e(K(Bu(re.map((e) => e.effect_instruction_i0).reduce(vl), nx([En(Jf(t, { parallel: !0 }), () => tp), ...re.map((e) => e.effect_instruction_i1)], (e) => e, n, !0, i))));
					} else o();
				});
			}
		};
		for (let e = 0; e < f; e++) o();
	}));
	return Yu(xd(fd(a(_v(ae))), $f({
		onFailure: (e) => {
			g();
			let t = re.length + 1, n = Math.min(typeof i == "number" ? i : re.length, re.length), r = Array.from(re);
			return $u((i) => {
				let a = [], o = 0, s = 0, c = (n, s) => (c) => {
					a[n] = c, o++, o === t && i(Z(X(e))), r.length > 0 && s && l();
				}, l = () => {
					ie(r.pop(), !0).addObserver(c(s, !0)), s++;
				};
				ae.addObserver(c(s, !1)), s++;
				for (let e = 0; e < n; e++) l();
			});
		},
		onSuccess: () => gd(ne, (e) => e.inheritAll)
	})));
}))), rx = (e, t, n, r) => q(() => {
	let i = R(e), a = Array(i.length);
	return Ld(nx(i, (e, t) => G(n(e, t), (e) => a[t] = e), r, !1, t), K(a));
}), ix = (e) => cx(e, fv), ax = (e, t, n, r = null) => {
	let i = sx(e, t, n, r);
	return i.resume(e), i;
}, ox = (e, t, n, r = null) => sx(e, t, n, r), sx = (e, t, n, r = null) => {
	let i = gs(), a = sh(t.getFiberRefs(), i), o = new Hb(i, a, n), s = dh(a, uf), c = o.currentSupervisor;
	return c.onStart(s, e, L(t), o), o.addObserver((e) => c.onEnd(e, o)), (r === null ? x(t.getFiberRef(Sf), En(() => t.scope())) : r).add(n, o), o;
}, cx = (e, t) => V((n, r) => K(ax(e, n, r.runtimeFlags, t))), lx = (e) => hp((t) => Tn(ii(t, _x), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Parallel": return e;
			case "Sequential":
			case "ParallelN": return W(kf(t, Eg), (t) => Cx(e, t));
		}
	}
})), ux = (e) => (t) => hp((n) => Tn(ii(n, _x), {
	onNone: () => t,
	onSome: (n) => n.strategy._tag === "ParallelN" && n.strategy.parallelism === e ? t : W(kf(n, Dg(e)), (e) => Cx(t, e))
})), dx = (e, t) => (n) => hp((r) => Tn(ii(r, _x), {
	onNone: () => n(b),
	onSome: (r) => {
		if (t === !0) {
			let t = e._tag === "Parallel" ? lx : e._tag === "Sequential" ? hx : ux(e.parallelism);
			switch (r.strategy._tag) {
				case "Parallel": return t(n(lx));
				case "Sequential": return t(n(hx));
				case "ParallelN": return t(n(ux(r.strategy.parallelism)));
			}
		} else return n(b);
	}
})), fx = (e) => W(_x, e), px = (e) => W(Sx(), (t) => xd(e(t), (e) => t.close(e))), mx = (e) => W(Sx(), (t) => wx(e, t)), hx = (e) => hp((t) => Tn(ii(t, _x), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Sequential": return e;
			case "Parallel":
			case "ParallelN": return W(kf(t, Tg), (t) => Cx(e, t));
		}
	}
})), gx = /*#__PURE__*/ y((e) => Ku(e[1]), (e, t, n, r) => G($b([e, t], {
	concurrency: r?.concurrent ? 2 : 1,
	batching: r?.batching,
	concurrentFinalizers: r?.concurrentFinalizers
}), ([e, t]) => n(e, t))), _x = /*#__PURE__*/ Xr("effect/Scope"), vx = _x, yx = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.set({}, t);
}, bx = {
	[wf]: wf,
	[Tf]: Tf,
	pipe() {
		return F(this, arguments);
	},
	fork(e) {
		return J(() => {
			let t = xx(e);
			if (this.state._tag === "Closed") return t.state = this.state, t;
			let n = {};
			return this.state.finalizers.set(n, (e) => t.close(e)), yx(t, (e) => J(() => {
				this.state._tag === "Open" && this.state.finalizers.delete(n);
			})), t;
		});
	},
	close(e) {
		return q(() => {
			if (this.state._tag === "Closed") return Y;
			let t = Array.from(this.state.finalizers.values()).reverse();
			return this.state = {
				_tag: "Closed",
				exit: e
			}, t.length === 0 ? Y : Cg(this.strategy) ? x(gd(t, (t) => od(t(e))), W((e) => x(Jf(e), An(qf), En(() => tp)))) : wg(this.strategy) ? x(tx(t, (t) => od(t(e)), !1), W((e) => x(Jf(e, { parallel: !0 }), An(qf), En(() => tp)))) : x(rx(t, this.strategy.parallelism, (t) => od(t(e)), !1), W((e) => x(Jf(e, { parallel: !0 }), An(qf), En(() => tp))));
		});
	},
	addFinalizer(e) {
		return q(() => this.state._tag === "Closed" ? e(this.state.exit) : (this.state.finalizers.set({}, e), Y));
	}
}, xx = (e = bg) => {
	let t = Object.create(bx);
	return t.strategy = e, t.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map()
	}, t;
}, Sx = (e = bg) => J(() => xx(e)), Cx = /*#__PURE__*/ y(2, (e, t) => vp(e, ai(ei(_x, t)))), wx = /*#__PURE__*/ y(2, (e, t) => x(e, Cx(t), xd((e) => t.close(e)))), Tx = (e) => cf(e, {
	differ: Tb,
	fork: yb
}), Ex = /*#__PURE__*/ lf(ll), Dx = /*#__PURE__*/ Tx(pb), Ox = /*#__PURE__*/ y(2, (e, t) => Ed((n) => md(n(e), {
	onFailure: (e) => md(t, {
		onFailure: (t) => U($l(e, t)),
		onSuccess: () => U(e)
	}),
	onSuccess: (e) => Ju(t, e)
}))), kx = (e, t, n) => ud((r) => Ox(W(ix(vd(e)), (e) => $u((r) => {
	let i = t.map((e) => e.listeners.count), a = () => {
		i.every((e) => e === 0) && t.every((e) => !!(e.result.state.current._tag === "Pending" || e.result.state.current._tag === "Done" && Uf(e.result.state.current.effect) && e.result.state.current.effect._tag === "Failure" && ru(e.result.state.current.effect.cause))) && (o.forEach((e) => e()), n?.(), r(zd(e)));
	};
	e.addObserver((e) => {
		o.forEach((e) => e()), r(e);
	});
	let o = t.map((e, t) => {
		let n = (e) => {
			i[t] = e, a();
		};
		return e.listeners.addObserver(n), () => e.listeners.removeObserver(n);
	});
	return a(), J(() => {
		o.forEach((e) => e());
	});
})), q(() => _d(t.flatMap((e) => e.state.completed ? [] : [e]), (e) => ab(e.request, Zf(r)))))), Ax = cu, jx = Af, Mx = Ef, Nx = Of, Px = Cx, Fx = kf, Ix = Sx, Lx = class {
	permits;
	waiters = /*#__PURE__*/ new Set();
	taken = 0;
	constructor(e) {
		this.permits = e;
	}
	get free() {
		return this.permits - this.taken;
	}
	take = (e) => Qu((t) => {
		if (this.free < e) {
			let n = () => {
				this.free < e || (this.waiters.delete(n), t(q(() => this.free < e ? this.take(e) : (this.taken += e, K(e)))));
			};
			return this.waiters.add(n), J(() => {
				this.waiters.delete(n);
			});
		}
		t(q(() => this.free < e ? this.take(e) : (this.taken += e, K(e))));
	});
	updateTakenUnsafe(e, t) {
		return this.taken = t(this.taken), this.waiters.size > 0 && e.getFiberRef(Z_).scheduleTask(() => {
			let e = this.waiters.values(), t = e.next();
			for (; t.done === !1 && this.free > 0;) t.value(), t = e.next();
		}, e.getFiberRef(df), e), K(this.free);
	}
	updateTaken(e) {
		return V((t) => this.updateTakenUnsafe(t, e));
	}
	resize = (e) => Yu(V((t) => (this.permits = e, this.free < 0 ? Y : this.updateTakenUnsafe(t, (e) => e))));
	release = (e) => this.updateTaken((t) => t - e);
	releaseAll = /*#__PURE__*/ this.updateTaken((e) => 0);
	withPermits = (e) => (t) => Ed((n) => W(n(this.take(e)), (e) => Ox(n(t), this.release(e))));
	withPermitsIfAvailable = (e) => (t) => Ed((n) => q(() => this.free < e ? dg : (this.taken += e, Ox(n(ng(t)), this.release(e)))));
}, Rx = (e) => new Lx(e), zx = /*#__PURE__*/ Symbol.for("effect/Ref/SynchronizedRef"), Bx = {
/* c8 ignore next */
_A: (e) => e }, Vx = class extends Mh {
	ref;
	withLock;
	[zx] = Bx;
	[Ph] = Fh;
	[Nh] = Nh;
	constructor(e, t) {
		super(), this.ref = e, this.withLock = t, this.get = zh(this.ref);
	}
	get;
	commit() {
		return this.get;
	}
	modify(e) {
		return this.modifyEffect((t) => K(e(t)));
	}
	modifyEffect(e) {
		return this.withLock(x(W(zh(this.ref), e), W(([e, t]) => Ju(Bh(this.ref, t), e))));
	}
}, Hx = (e) => J(() => Ux(e)), Ux = (e) => new Vx(Lh(e), Rx(1).withPermits(1)), Wx = /*#__PURE__*/ Symbol.for("effect/ManagedRuntime"), Gx = "Fresh", Kx = "FromEffect", qx = "MergeAll", Jx = (e) => function() {
	if (arguments.length === 1) {
		let t = arguments[0];
		return (n, ...r) => e(t, n, ...r);
	}
	return e.apply(this, arguments);
}, Yx = /*#__PURE__*/ Jx((e, t, n) => {
	let r = gs(), i = [[uf, [[r, e.context]]]];
	n?.scheduler && i.push([Z_, [[r, n.scheduler]]]);
	let a = gh(e.fiberRefs, {
		entries: i,
		forkAs: r
	});
	n?.updateRefs && (a = n.updateRefs(a, r));
	let o = new Hb(r, a, e.runtimeFlags), s = t;
	n?.scope && (s = W(Fx(n.scope, bg), (e) => Ld(Ef(e, ud((e) => j(e, o.id()) ? Y : Bd(o, e))), xd(t, (t) => Nx(e, t)))));
	let c = o.currentSupervisor;
	return c !== pb && (c.onStart(e.context, s, I(), o), o.addObserver((e) => c.onEnd(e, o))), fv.add(e.runtimeFlags, o), n?.immediate === !1 ? o.resume(s) : o.start(s), o;
}), Xx = /*#__PURE__*/ Jx((e, t) => {
	let n = iS(e)(t);
	if (n._tag === "Failure") throw nS(n.effect_instruction_i0);
	return n.effect_instruction_i0;
}), Zx = class extends Error {
	fiber;
	_tag = "AsyncFiberException";
	constructor(e) {
		super(`Fiber #${e.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`), this.fiber = e, this.name = this._tag, this.stack = this.message;
	}
}, Qx = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new Zx(e);
	return Error.stackTraceLimit = t, n;
}, $x = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure"), eS = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure/Cause"), tS = class extends Error {
	[$x];
	[eS];
	constructor(e) {
		let t = Mu(e)[0];
		super(t?.message || "An error has occurred"), this[$x] = $x, this[eS] = e, this.name = t ? `(FiberFailure) ${t.name}` : "FiberFailure", t?.stack && (this.stack = t.stack);
	}
	toJSON() {
		return {
			_id: "FiberFailure",
			cause: this[eS].toJSON()
		};
	}
	toString() {
		return "(FiberFailure) " + wu(this[eS], { renderErrorCause: !0 });
	}
	[M]() {
		return this.toString();
	}
}, nS = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new tS(e);
	return Error.stackTraceLimit = t, n;
}, rS = (e) => {
	let t = e;
	switch (t._op) {
		case "Failure":
		case "Success": return t;
		case "Left": return Xf(t.left);
		case "Right": return Z(t.right);
		case "Some": return Z(t.value);
		case "None": return Xf(new Bf());
	}
}, iS = /*#__PURE__*/ Jx((e, t) => {
	let n = rS(t);
	if (n) return n;
	let r = new X_(), i = Yx(e)(t, { scheduler: r });
	return r.flush(), i.unsafePoll() || Yf(nd(Qx(i), yp(i)));
}), aS = /*#__PURE__*/ Jx((e, t, n) => oS(e, t, n).then((e) => {
	switch (e._tag) {
		case Et: return e.effect_instruction_i0;
		case St: throw nS(e.effect_instruction_i0);
	}
})), oS = /*#__PURE__*/ Jx((e, t, n) => new Promise((r) => {
	let i = rS(t);
	i && r(i);
	let a = Yx(e)(t);
	a.addObserver((e) => {
		r(e);
	}), n?.signal !== void 0 && (n.signal.aborted ? a.unsafeInterruptAsFork(a.id()) : n.signal.addEventListener("abort", () => {
		a.unsafeInterruptAsFork(a.id());
	}, { once: !0 }));
})), sS = class {
	context;
	runtimeFlags;
	fiberRefs;
	constructor(e, t, n) {
		this.context = e, this.runtimeFlags = t, this.fiberRefs = n;
	}
	pipe() {
		return F(this, arguments);
	}
}, cS = /*#__PURE__*/ ((e) => new sS(e.context, e.runtimeFlags, e.fiberRefs))({
	context: /*#__PURE__*/ $r(),
	runtimeFlags: /* @__PURE__ */ cl(1, 32, 4),
	fiberRefs: /*#__PURE__*/ _h()
}), lS = /*#__PURE__*/ aS(cS), uS = /*#__PURE__*/ oS(cS), dS = /*#__PURE__*/ Xx(cS), fS = /*#__PURE__*/ y(2, (e, t) => e.modifyEffect(t)), pS = /*#__PURE__*/ Symbol.for("effect/Layer"), mS = {
	/* c8 ignore next */
	_RIn: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_ROut: (e) => e
}, hS = {
	[pS]: mS,
	pipe() {
		return F(this, arguments);
	}
}, gS = /*#__PURE__*/ Symbol.for("effect/Layer/MemoMap"), _S = /*#__PURE__*/ ci()("effect/Layer/CurrentMemoMap", { defaultValue: () => SS() }), vS = (e) => C(e, pS), yS = (e) => e._op_layer === Gx, bS = class {
	ref;
	[gS];
	constructor(e) {
		this.ref = e, this[gS] = gS;
	}
	getOrElseMemoize(e, t) {
		return x(fS(this.ref, (n) => {
			let r = n.get(e);
			if (r !== void 0) {
				let [e, i] = r;
				return K([x(e, W(([e, t]) => x(cg(e), Ju(t))), xd($f({
					onFailure: () => Y,
					onSuccess: () => Df(t, i)
				}))), n]);
			}
			return x(Rh(0), W((r) => x(ap(), W((i) => x(Rh(() => Y), G((a) => {
				let o = Ed((o) => x(Sx(), W((s) => x(o(W(TS(e, s, !0), (e) => ig(e(this)))), od, W((o) => {
					switch (o._tag) {
						case St: return x(lp(i, o.effect_instruction_i0), Ld(Of(s, o)), Ld(U(o.effect_instruction_i0)));
						case Et: return x(Bh(a, (e) => x(Of(s, e), Od(Vh(r, (e) => [e === 1, e - 1])), Yu)), Ld(Hh(r, (e) => e + 1)), Ld(Df(t, (t) => x(J(() => n.delete(e)), Ld(zh(a)), W((e) => e(t))))), Ld(up(i, o.effect_instruction_i0)), Ju(o.effect_instruction_i0[1]));
					}
				}))))), s = [x(sp(i), xd(ep({
					onFailure: () => Y,
					onSuccess: () => Hh(r, (e) => e + 1)
				}))), (e) => x(zh(a), W((t) => t(e)))];
				return [o, yS(e) ? n : n.set(e, s)];
			}))))));
		}), fd);
	}
}, xS = /*#__PURE__*/ q(() => G(Hx(/* @__PURE__ */ new Map()), (e) => new bS(e))), SS = () => new bS(Ux(/* @__PURE__ */ new Map())), CS = /*#__PURE__*/ y(2, (e, t) => W(xS, (n) => wS(e, n, t))), wS = /*#__PURE__*/ y(3, (e, t, n) => W(TS(e, n), (e) => ug(e(t), _S, t))), TS = (e, t, n = !1) => {
	let r = e;
	switch (r._op_layer) {
		case "Locally": return J(() => (e) => r.f(e.getOrElseMemoize(r.self, t)));
		case "ExtendScope": return J(() => (e) => fx((t) => e.getOrElseMemoize(r.layer, t)));
		case "Fold": return J(() => (e) => x(e.getOrElseMemoize(r.layer, t), md({
			onFailure: (n) => e.getOrElseMemoize(r.failureK(n), t),
			onSuccess: (n) => e.getOrElseMemoize(r.successK(n), t)
		})));
		case "Fresh": return J(() => (e) => x(r.layer, CS(t)));
		case "FromEffect": return J(n ? () => (e) => r.effect : () => (n) => n.getOrElseMemoize(e, t));
		case "Provide": return J(() => (e) => x(e.getOrElseMemoize(r.first, t), W((n) => x(e.getOrElseMemoize(r.second, t), gp(n)))));
		case "Scoped": return J(n ? () => (e) => Cx(r.effect, t) : () => (n) => n.getOrElseMemoize(e, t));
		case "Suspend": return J(() => (e) => e.getOrElseMemoize(r.evaluate(), t));
		case "ProvideMerge": return J(() => (e) => x(e.getOrElseMemoize(r.first, t), Rd(e.getOrElseMemoize(r.second, t), r.zipK)));
		case "ZipWith": return jd(function* () {
			let e = yield* kf(t, xg), n = yield* kf(e, bg), i = yield* kf(e, bg);
			return (e) => x(e.getOrElseMemoize(r.first, n), gx(e.getOrElseMemoize(r.second, i), r.zipK, { concurrent: !0 }));
		});
		case "MergeAll": {
			let e = r.layers;
			return G(kf(t, xg), (t) => (n) => {
				let r = Array(e.length);
				return G(nx(e, Md(function* (e, i) {
					let a = yield* kf(t, bg), o = yield* n.getOrElseMemoize(e, a);
					r[i] = o;
				}), !1, !1), () => oi(...r));
			});
		}
	}
};
function ES(e) {
	let t = Object.create(hS);
	return t._op_layer = Kx, t.effect = e, t;
}
var DS = (...e) => {
	let t = Object.create(hS);
	return t._op_layer = qx, t.layers = e, t;
}, OS = /*#__PURE__*/ y(2, (e, t) => {
	let n = Qr(e);
	return ES(K(ei(n ? e : t, n ? t : e)));
}), kS = /*#__PURE__*/ y(2, (e, t) => px((n) => W(CS(t, n), (t) => _p(e, t)))), AS = /*#__PURE__*/ y(2, (e, t) => {
	let n = Og(cS.fiberRefs, t.fiberRefs), r = fl(cS.runtimeFlags, t.runtimeFlags);
	return Ed((i) => V((a) => {
		let o = a.getFiberRef(uf), s = a.getFiberRefs(), c = kg(a.id(), s)(n), l = a.currentRuntimeFlags, u = pl(r)(l), d = Og(c, s), f = fl(u, l);
		return a.setFiberRefs(c), a.currentRuntimeFlags = u, Ox(_p(i(e), ai(o, t.context)), V((e) => (e.setFiberRefs(kg(e.id(), e.getFiberRefs())(d)), e.currentRuntimeFlags = pl(f)(e.currentRuntimeFlags), Y)));
	}));
}), jS = /*#__PURE__*/ y(2, (e, t) => Array.isArray(t) ? kS(e, DS(...t)) : vS(t) ? kS(e, t) : Zr(t) ? _p(e, t) : Wx in t ? W(t.runtimeEffect, (t) => AS(e, t)) : AS(e, t)), MS = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return { BaseEffectError: class extends Mf {
		constructor(t) {
			super(t?.message, t?.cause ? { cause: t.cause } : void 0), t && (Object.assign(this, t), Object.defineProperty(this, e, {
				value: t,
				enumerable: !1
			}));
		}
		toJSON() {
			return {
				...this[e],
				...this
			};
		}
	} }.BaseEffectError;
}(), NS = (e) => {
	let t = { BaseEffectError: class extends MS {
		_tag = e;
	} };
	return t.BaseEffectError.prototype.name = e, t.BaseEffectError;
}, PS = H, FS = jd, IS = lg, LS = K, RS = q, zS = J, BS = Y, VS = ed, HS = sg, US = rg, WS = mg, GS = Ju, KS = Jb, qS = Ox, JS = mx, YS = jS, XS = Cd, ZS = pg, QS = hd, $S = lS, eC = uS, tC = dS, nC = class extends NS("AuthenticationFailure") {};
function rC(e) {
	return WS({
		try: e.command,
		catch: (e) => new nC({ cause: e })
	}).pipe(qS(IS(() => e.reconcile?.() ?? Promise.resolve())));
}
async function iC(e) {
	let t = await eC(e);
	if (xp(t)) return t.value;
	let n = Ax(t.cause);
	throw wn(n) ? n.value.cause : jx(t.cause);
}
// src/app/services/queries/configuration.ts
function aC(e, t, n, r, i) {
	return t ? {
		queryKey: v.sshBrowse(t, n ?? "", i),
		queryFn: ({ signal: r }) => e.browseSshPath(t, n, i, r)
	} : {
		queryKey: v.browse(n ?? "", r, i),
		queryFn: ({ signal: t }) => e.browsePath(n, r, i, t)
	};
}
function oC(e, t, n, i) {
	let { api: a } = r();
	return g({
		...aC(a, null, e, t, n),
		enabled: i,
		staleTime: 2e3,
		retry: !1
	});
}
function sC(e, t, n, i) {
	let { api: a } = r();
	return g({
		...aC(a, e ?? { ssh_host: "" }, t, "directory", n),
		enabled: i && !!e?.ssh_host,
		staleTime: 2e3,
		retry: !1
	});
}
function cC() {
	let { api: e } = r();
	return d((t, n, r, i) => aC(e, t, n, r, i).queryFn({ signal: new AbortController().signal }), [e]);
}
function lC() {
	let { api: e } = r(), t = _();
	return d(async (n, r, i) => {
		try {
			return await (n ? e.createSshFolder(n, r, i) : e.createFolder(r, i));
		} finally {
			t.invalidateQueries({ queryKey: [n ? "ssh-browse" : "fs-browse"] });
		}
	}, [e, t]);
}
function uC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.browseSshPath(t, null),
		onSuccess: (e, n) => {
			t.setQueryData(v.sshBrowse(n, "", !1), e);
		}
	});
}
function dC() {
	let { api: e } = r();
	return g({
		queryKey: v.sshConfigs,
		queryFn: ({ signal: t }) => e.listSshConfigs(t),
		staleTime: 3e4,
		retry: !1
	});
}
function fC(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: v.sshAliases,
		queryFn: ({ signal: e }) => t.listSshAliases(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function pC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.createSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
function mC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ configId: t, payload: n }) => e.updateSshConfig(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
function hC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
var gC = 3e5;
function _C() {
	let { api: e } = r();
	return g({
		queryKey: v.mcpLibrary,
		queryFn: ({ signal: t }) => e.getMcpLibrary(t),
		staleTime: gC,
		retry: !1
	});
}
function vC() {
	let { api: e } = r();
	return g({
		queryKey: v.mcpServers,
		queryFn: ({ signal: t }) => e.listMcpServers(t),
		staleTime: 3e4,
		retry: !1
	});
}
function yC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.createMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function bC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ serverName: t, payload: n }) => e.updateMcpServer(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function xC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function SC() {
	let { api: e } = r();
	return h({ mutationFn: (t) => e.testMcpServer(t) });
}
function CC() {
	let { api: e } = r();
	return g({
		queryKey: v.mcpRuntime,
		queryFn: ({ signal: t }) => e.listMcpRuntimeStatus(t),
		staleTime: 5e3,
		retry: !1
	});
}
function wC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ serverName: t, action: n }) => n === "connect" ? e.connectMcpServer(t) : n === "disconnect" ? e.disconnectMcpServer(t) : e.reloadMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function TC(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: v.modelCatalog,
		queryFn: ({ signal: e }) => t.getModelCatalog(e),
		enabled: e,
		staleTime: 6e5,
		refetchInterval: 6e4,
		retry: !1
	});
}
async function EC(e) {
	await Promise.all([e.resetQueries({ queryKey: v.managedProviderModelsAll }), e.invalidateQueries({ queryKey: v.modelCatalog })]);
}
async function DC(e) {
	await Promise.all([
		e.invalidateQueries({ queryKey: v.managedAuth }),
		e.invalidateQueries({ queryKey: v.managedHostStatus }),
		EC(e)
	]);
}
function OC(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sessionCommands(e),
		queryFn: ({ signal: n }) => t.listSessionCommands(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function kC(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sessionSkills(e),
		queryFn: ({ signal: n }) => t.listSessionSkills(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
// src/app/services/queries/host.ts
function AC() {
	let { api: e } = r();
	return g({
		queryKey: v.storeInfo,
		queryFn: ({ signal: t }) => e.getStore(t),
		staleTime: Infinity
	});
}
function jC(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sandboxAvailability,
		queryFn: ({ signal: e }) => t.getSandboxAvailability(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function MC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: [...v.sandboxActivity, t],
		queryFn: ({ signal: e }) => n.getSandboxActivity(t, e),
		enabled: e && t !== null,
		staleTime: 0,
		refetchInterval: 1e3,
		retry: !1
	});
}
function NC() {
	let { api: e } = r(), t = _();
	return h({
		retry: !1,
		mutationFn: (n) => iC(rC({
			command: () => e.managedLogout(n),
			reconcile: () => DC(t)
		}))
	});
}
// src/app/services/queries/direct.ts
function PC(e, t, n) {
	let r = e.find((e) => n(e) === n(t));
	return r && (r.generation > t.generation || r.version > t.version) ? e : r ? e.map((e) => n(e) === n(t) ? t : e) : [...e, t];
}
function FC(e, t, n) {
	return t.map((t) => {
		let r = e?.find((e) => n(e) === n(t));
		return r && (r.generation > t.generation || r.version > t.version) ? r : t;
	});
}
function IC(e, t, n = !0) {
	let { api: i } = r();
	return g({
		queryKey: v.sessionPermissions(e),
		queryFn: ({ signal: t }) => i.getPermissions(e, t),
		enabled: t,
		refetchInterval: t && n ? 1e3 : !1,
		staleTime: 0,
		retry: !1
	});
}
function LC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, requestId: n, reply: r }) => e.replyPermission(t, n, r),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) })
	});
}
function RC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, reviewId: n, parentSessionId: r }) => r ? e.authorizeChildPermissionReviewRetry(r, t, n) : e.authorizePermissionReviewRetry(t, n),
		onSuccess: (e, n) => Promise.all([t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) }), ...n.parentSessionId ? [t.invalidateQueries({ queryKey: v.traditionalChildren(n.parentSessionId) })] : []])
	});
}
function zC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, mode: n }) => e.setPermissionApprovalMode(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.sessionPermissions(n.sessionId), (e) => e && {
				...e,
				approval_mode: n.mode,
				requests: n.mode === "auto_approve" ? [] : e.requests
			});
		}
	});
}
function BC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, grantId: n }) => e.deletePermissionGrant(t, n),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) })
	});
}
function VC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.sessionGoal(e),
		queryFn: ({ signal: t }) => n.getGoal(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function HC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, payload: n }) => e.createGoal(t, n),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), e)
	});
}
function UC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, goalId: n, payload: r }) => e.updateGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), e)
	});
}
function WC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, goalId: n, expectedVersion: r }) => e.clearGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), null)
	});
}
function GC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.traditionalChildren(e),
		queryFn: ({ signal: t }) => n.listTraditionalChildren(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => FC(e, t, (e) => e.child_session_id)
	});
}
function KC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, payload: n }) => e.startTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.traditionalChildren(n.sessionId), (t = []) => PC(t, e, (e) => e.child_session_id));
		}
	});
}
function qC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, childId: n }) => e.cancelTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.traditionalChildren(n.sessionId), (t = []) => PC(t, e, (e) => e.child_session_id));
		}
	});
}
function JC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.sessionInbox(e),
		queryFn: ({ signal: t }) => n.listInbox(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function YC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, delivery: n, prompt: r }) => e.createInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => [...t.filter((t) => t.id !== e.id), e]);
		}
	});
}
function XC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r, delivery: i }) => e.updateInboxItem(t, n, r, i),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
function ZC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r }) => e.cancelInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
// src/app/features/direct-session/commandWorkflow.ts
var QC = class extends NS("CommandFailure") {};
function $C(e) {
	return FS(function* () {
		yield* zS(e.optimistic);
		let t = yield* WS({
			try: e.admit,
			catch: (e) => new QC({
				operation: "submit",
				cause: e
			})
		}).pipe(ZS(() => zS(e.rejected)));
		return t.kind === "accepted" ? (yield* zS(() => e.reconcile(!1)), t.value) : (yield* zS(() => {
			t.kind === "uncertain" ? e.reconcile(!0) : e.rejected();
		}), yield* PS(new QC({
			operation: "submit",
			cause: t.error
		})));
	});
}
function ew(e) {
	return FS(function* () {
		yield* zS(e.optimistic), yield* WS({
			try: e.cancel,
			catch: (e) => new QC({
				operation: "stop",
				cause: e
			})
		}).pipe(ZS(() => zS(e.rollback))), yield* zS(e.settled);
	});
}
function tw(e) {
	return WS({
		try: e.create,
		catch: (e) => new QC({
			operation: "create",
			cause: e
		})
	}).pipe(XS((t) => zS(() => e.accept(t))));
}
function nw(e) {
	if (e.mode === "direct-running" || e.delivery) {
		let t = e.delivery ?? "steer";
		return WS({
			try: () => e.inbox(t),
			catch: (e) => new QC({
				operation: t,
				cause: e
			})
		}).pipe(GS(t === "queue" ? "queued" : "steered"));
	}
	return WS({
		try: e.submit,
		catch: (e) => new QC({
			operation: "submit",
			cause: e
		})
	}).pipe(GS("submitted"));
}
async function rw(e) {
	let t = await eC(e);
	if (xp(t)) return t.value;
	let n = Ax(t.cause);
	throw wn(n) ? n.value.cause : jx(t.cause);
}
// src/app/features/direct-session/commandAdapters.ts
function iw(e, t) {
	let { api: r, stores: { runtimeStore: { captureRuntimeActivation: i, finishRunCancel: a, requestRunCancel: o, restoreRunCancel: s, runtimeStore: c } } } = n(e), l = i(t), u = v.sessionSnapshot(t), d, f, p, m = [];
	return {
		optimistic: () => {
			l() && (d = o()), f = e.getQueryData(u), p = f?.active_run ? {
				...f,
				active_run: void 0
			} : f, p &&= e.setQueryData(u, p);
			for (let n of [!1, !0]) {
				let r = e.getQueryData(v.sessions(n))?.find((e) => e.summary.session_id === t), i = e.setQueryData(v.sessions(n), (e) => e?.map((e) => e.summary.session_id !== t || !e.active && e.active_run === void 0 ? e : {
					...e,
					active: !1,
					active_run: void 0
				}))?.find((e) => e.summary.session_id === t);
				r && i && r !== i && m.push({
					stats: n,
					before: r,
					optimistic: i
				});
			}
		},
		cancel: () => r.cancelActiveRun(t),
		rollback: () => {
			d && l() && c.getState().cancelArmed && s(d), e.setQueryData(u, (e) => e === p ? f : e);
			for (let { stats: t, before: n, optimistic: r } of m) e.setQueryData(v.sessions(t), (e) => e?.map((e) => e === r ? n : e));
			e.invalidateQueries({
				queryKey: u,
				exact: !0
			});
		},
		settled: () => {
			l() && c.getState().cancelArmed && a(), e.invalidateQueries({
				queryKey: u,
				exact: !0
			}), e.invalidateQueries({ queryKey: v.sessionsAll });
		}
	};
}
// src/app/lib/messageWindow.ts
function aw(e, t, n) {
	return Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && Number.isSafeInteger(e.total) && e.start >= 0 && e.start <= e.end && e.end <= e.total && e.end - e.start === t && n === t;
}
function ow(e, t) {
	return e?.length === t ? e : Array.from({ length: t }, () => null);
}
function sw(e, t) {
	return e === void 0 || e.length === t && e.every((e) => e === null || typeof e == "string");
}
function cw(e) {
	if (!e.startsWith("log:")) return e;
	let t = e.lastIndexOf(":"), n = e.lastIndexOf(":", t - 1);
	return n > 4 ? e.slice(0, n) : e;
}
function lw(e, t, n) {
	let r = /* @__PURE__ */ new Set();
	return (e ?? []).every(({ message_index: e }) => !Number.isSafeInteger(e) || r.has(e) || t[e - n]?.role !== "user" ? !1 : (r.add(e), !0));
}
function uw(e, t, n) {
	return (e ?? []).filter(({ message_index: e }) => e >= t && e < n);
}
function dw(e) {
	return aw(e.page, e.messages.length, e.created_at.length) && sw(e.tool_call_occurrences, e.messages.length) && lw(e.terminal_selection_attributions, e.messages, e.page.start);
}
function fw(e) {
	let t = e.message_page, n = e.message_created_at ?? [];
	return !!(t && aw(t, e.messages.length, n.length) && sw(e.tool_call_occurrences, e.messages.length) && lw(e.terminal_selection_attributions, e.messages, t.start));
}
function pw(e) {
	return e.message_page ?? {
		start: 0,
		end: e.messages.length,
		total: e.messages.length,
		has_older: !1
	};
}
function mw(e) {
	let t = e.message_created_at ?? [];
	return t.length === e.messages.length ? t : Array.from({ length: e.messages.length }, () => null);
}
function hw(e, t) {
	if (!dw(t)) return { kind: "snapshot-required" };
	let n = pw(e), r = mw(e);
	if (!aw(n, e.messages.length, r.length) || t.page.end !== t.page.total || t.page.total < n.total || t.page.start > n.end) return { kind: "snapshot-required" };
	for (let i = Math.max(n.start, t.page.start); i < Math.min(n.end, t.page.end); i += 1) if (JSON.stringify(e.messages[i - n.start]) !== JSON.stringify(t.messages[i - t.page.start]) || r[i - n.start] !== t.created_at[i - t.page.start] || (() => {
		let r = e.tool_call_occurrences?.[i - n.start], a = t.tool_call_occurrences?.[i - t.page.start];
		return r != null && a != null && cw(r) !== cw(a);
	})()) return { kind: "snapshot-required" };
	if (t.page.start <= n.start) return {
		kind: "accepted",
		snapshot: {
			...e,
			messages: t.messages,
			message_created_at: t.created_at,
			tool_call_occurrences: ow(t.tool_call_occurrences, t.messages.length),
			message_page: t.page,
			terminal_selection_attributions: t.terminal_selection_attributions ?? []
		}
	};
	let i = t.page.start - n.start;
	if (i > e.messages.length) return { kind: "snapshot-required" };
	let a = ow(e.tool_call_occurrences, e.messages.length).slice(0, i);
	if (t.messages[0]?.role === "tool" && t.page.end > n.end) {
		let r = e.messages.slice(0, i), o = r.length - 1;
		for (; o >= 0 && r[o].role !== "assistant" && r[o].role !== "user";) --o;
		let s = t.messages.findIndex((e) => e.role === "assistant" || e.role === "user"), c = s < 0 ? t.page.end : t.page.start + s;
		o >= 0 && r[o].role === "assistant" && e.tool_call_occurrences?.[o] != null && n.end < c && (a[o] = null);
	}
	return {
		kind: "accepted",
		snapshot: {
			...e,
			messages: [...e.messages.slice(0, i), ...t.messages],
			message_created_at: [...r.slice(0, i), ...t.created_at],
			tool_call_occurrences: [...a, ...ow(t.tool_call_occurrences, t.messages.length)],
			terminal_selection_attributions: [...uw(e.terminal_selection_attributions, n.start, t.page.start), ...t.terminal_selection_attributions ?? []],
			message_page: {
				...t.page,
				start: n.start,
				has_older: n.start > 0
			}
		}
	};
}
function gw(e, t, n) {
	if (!dw(t)) return null;
	let r = pw(e), i = mw(e);
	return r.start !== n || t.page.end !== n || t.page.total !== r.total || !aw(r, e.messages.length, i.length) ? null : {
		...e,
		messages: [...t.messages, ...e.messages],
		message_created_at: [...t.created_at, ...i],
		tool_call_occurrences: [...ow(t.tool_call_occurrences, t.messages.length), ...ow(e.tool_call_occurrences, e.messages.length)],
		terminal_selection_attributions: [...t.terminal_selection_attributions ?? [], ...uw(e.terminal_selection_attributions, r.start, r.end)],
		message_page: {
			start: t.page.start,
			end: r.end,
			total: r.total,
			has_older: t.page.start > 0
		}
	};
}
function _w(e, t, n) {
	if (n || !e || !t.message_page) return t;
	if (!fw(t)) return e;
	let r = t.message_created_at ?? [], i = hw(e, {
		messages: t.messages,
		created_at: r,
		page: t.message_page,
		terminal_selection_attributions: t.terminal_selection_attributions,
		tool_call_occurrences: t.tool_call_occurrences
	});
	return i.kind === "accepted" ? {
		...t,
		messages: i.snapshot.messages,
		message_created_at: i.snapshot.message_created_at,
		tool_call_occurrences: i.snapshot.tool_call_occurrences,
		message_page: i.snapshot.message_page,
		terminal_selection_attributions: i.snapshot.terminal_selection_attributions
	} : t;
}
// src/app/lib/sessionOrder.ts
function vw(e, t, n) {
	let r = e.filter((e) => e !== t), i = Math.max(0, Math.min(n, r.length));
	return [
		...r.slice(0, i),
		t,
		...r.slice(i)
	];
}
function yw(e, t) {
	return (e.sort_order ?? 0) - (t.sort_order ?? 0) || o(t.created_at) - o(e.created_at);
}
function bw(e, t) {
	return e.filter((e) => !!e.summary.pinned === t).sort((e, t) => yw(e.summary, t.summary));
}
function xw(e, t, n) {
	let r = new Map(n.map((e) => [e.summary.session_id, e])), i = {};
	for (let e of t) i[e] = r.get(e)?.summary.presentation_version ?? 0;
	return {
		pinned: e,
		session_ids: t,
		expected_versions: i
	};
}
function Sw(e, t) {
	return e.map((e) => e.summary.session_id === t.session_id ? {
		...e,
		summary: t
	} : e);
}
function Cw(e, t, n, r) {
	if (t === r) {
		let t = e.findIndex((e) => e.summary.session_id === r);
		return t < 0 ? e.length : t;
	}
	let i = e.filter((e) => e.summary.session_id !== r), a = i.findIndex((e) => e.summary.session_id === t);
	return a < 0 ? i.length : n === "before" ? a : a + 1;
}
function ww(e, t) {
	return e.length === t.length && e.every((e, n) => e === t[n]);
}
// src/app/services/queries/invalidation.ts
function Tw() {
	let e = _();
	return {
		sessions: () => e.invalidateQueries({ queryKey: v.sessionsAll }),
		projects: () => e.invalidateQueries({ queryKey: v.projects }),
		session: (t) => e.invalidateQueries({
			queryKey: v.sessionSnapshot(t),
			exact: !0
		}),
		sessionRoot: (t) => e.invalidateQueries({ queryKey: v.sessionRoot(t) })
	};
}
// src/app/services/sessionRefresh.ts
var Ew = /* @__PURE__ */ new Map(), Dw = 0, Ow = /* @__PURE__ */ new WeakMap(), kw = 0;
function Aw(e, t) {
	let n = Ow.get(e);
	return n === void 0 && (n = ++kw, Ow.set(e, n)), `${n}:${t}`;
}
function jw(e) {
	let t = Ew.get(e);
	if (t) return t;
	let n = {
		generation: ++Dw,
		replaceNextSnapshot: !1,
		tailController: null,
		historyControllers: /* @__PURE__ */ new Set()
	};
	return Ew.set(e, n), n;
}
function Mw(e, t = !1) {
	let n = jw(e);
	n.generation = ++Dw, n.replaceNextSnapshot ||= t, n.tailController?.abort(), n.tailController = null;
	for (let e of n.historyControllers) e.abort();
	return n.historyControllers.clear(), n.generation;
}
function Nw(e) {
	let t = jw(e);
	return {
		generation: Mw(e),
		replace: t.replaceNextSnapshot
	};
}
function Pw(e, t) {
	let n = Ew.get(e);
	n?.generation === t.generation && t.replace && (n.replaceNextSnapshot = !1);
}
function Fw(e) {
	let t = jw(e);
	t.tailController?.abort();
	let n = new AbortController();
	return t.tailController = n, {
		generation: t.generation,
		controller: n
	};
}
function Iw(e, t) {
	let n = Ew.get(e);
	n?.tailController === t.controller && (n.tailController = null);
}
function Lw(e, t) {
	return Ew.get(e)?.generation === t;
}
function Rw(e) {
	let t = jw(e), n = new AbortController();
	return t.historyControllers.add(n), {
		generation: t.generation,
		controller: n
	};
}
function zw(e, t) {
	Ew.get(e)?.historyControllers.delete(t.controller);
}
function Bw(e) {
	let t = Ew.get(e);
	t?.tailController?.abort();
	for (let e of t?.historyControllers ?? []) e.abort();
	Ew.delete(e);
}
// src/app/services/queries/session.ts
function Vw(e = ve) {
	let { api: t } = r();
	return g({
		queryKey: v.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: e,
		staleTime: 0,
		placeholderData: re
	});
}
function Hw(e) {
	let { api: t } = r(), n = d((t) => t.find((t) => t.summary.session_id === e) ?? null, [e]);
	return g({
		queryKey: v.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: ve,
		staleTime: 0,
		placeholderData: re,
		select: n
	});
}
function Uw(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function Ww(e, t) {
	let { api: n } = r(), i = _();
	return g({
		queryKey: v.sessionSnapshot(e ?? ""),
		queryFn: async ({ signal: t }) => {
			let r = Nw(Aw(i, e)), a = await n.getSession(e, {
				messageLimit: 24,
				threadEventLimit: 50,
				includeSessions: !1,
				includeSystem: !0,
				signal: t
			});
			if (!fw(a)) throw Error("The server returned an invalid snapshot message page.");
			if (t.aborted || !Lw(Aw(i, e), r.generation)) throw new DOMException("Snapshot superseded", "AbortError");
			return Pw(Aw(i, e), r), _w(i.getQueryData(v.sessionSnapshot(e)), a, r.replace);
		},
		enabled: !!e,
		staleTime: 1e3,
		placeholderData: Uw(e ?? ""),
		...t
	});
}
function Gw(e) {
	let { api: t } = r(), n = _();
	return h({ mutationFn: async () => {
		let r = n.getQueryData(v.sessionSnapshot(e))?.message_page?.start;
		if (r === void 0 || r <= 0) throw Error("No older messages are available.");
		let i = Aw(n, e), a = Rw(i);
		try {
			let o = await t.getMessages(e, {
				before: r,
				limit: 24,
				includeSystem: !0,
				signal: a.controller.signal
			});
			if (!dw(o)) throw Error("The server returned an invalid message page.");
			if (!Lw(i, a.generation)) return !1;
			let s = !1;
			return n.setQueryData(v.sessionSnapshot(e), (e) => {
				if (!e) return e;
				let t = gw(e, o, r);
				return t ? (s = !0, t) : e;
			}), s;
		} catch (e) {
			if (a.controller.signal.aborted) return !1;
			throw e;
		} finally {
			zw(i, a);
		}
	} });
}
function Kw(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sessionConfig(e ?? ""),
		queryFn: ({ signal: n }) => t.getConfig(e, n),
		enabled: !!e
	});
}
function qw() {
	let { api: e } = r(), t = Tw(), n = _();
	return h({
		retry: !1,
		mutationFn: (r) => rw(tw({
			create: () => e.createSession(r),
			accept: (e) => {
				let r = e.metadata.session_id;
				if (!r) throw Error("The server returned a chat without an identity.");
				Mw(Aw(n, r), !0), n.setQueryData(v.sessionSnapshot(r), e), t.sessions();
			}
		}))
	});
}
function Jw(e, t) {
	let n = [];
	for (let r of e.getQueryCache().findAll({ queryKey: ["session"] })) {
		let e = r.queryKey;
		if (e[0] !== "session" || e[2] !== "snapshot" || typeof e[1] != "string") continue;
		let i = e[1];
		i !== t && r.state.data?.forks?.some((e) => e.session_id === t) && n.push(i);
	}
	return n;
}
function Yw() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = Tw(), i = _();
	return h({
		mutationFn: (t) => e.deleteSession(t),
		onSuccess: (e, r) => {
			t.purgeSessions([r]), n.sessions(), i.removeQueries({ queryKey: v.sessionRoot(r) });
			for (let e of Jw(i, r)) n.sessionRoot(e);
		}
	});
}
function Xw() {
	let { api: e } = r(), t = Tw();
	return h({
		retry: !1,
		mutationFn: ({ id: t, title: n, pinned: r, expectedVersion: i }) => e.updatePresentation(t, {
			title: n,
			pinned: r,
			expected_version: i
		}),
		onSuccess: () => t.sessions()
	});
}
function Zw() {
	let e = Xw();
	return {
		...e,
		toggle: (t) => e.mutateAsync({
			id: t.session_id,
			title: t.title ?? "",
			pinned: !t.pinned,
			expectedVersion: t.presentation_version ?? 0
		})
	};
}
function Qw() {
	let { api: e } = r(), t = Tw();
	return h({
		mutationFn: async ({ sessions: t, sessionId: n, targetPinned: r, targetIndex: i }) => {
			let a = t, o = a.find((e) => e.summary.session_id === n);
			if (!o) throw Error(`Session '${n}' was not found`);
			if (!!o.summary.pinned !== r) {
				let t = await e.updatePresentation(n, {
					title: o.summary.title ?? "",
					pinned: r,
					expected_version: o.summary.presentation_version ?? 0
				});
				a = Sw(a, t);
			}
			let s = bw(a, r), c = s.map((e) => e.summary.session_id), l = vw(c, n, i);
			return ww(c, l) ? null : e.reorderSessions(xw(r, l, s));
		},
		onSuccess: () => t.sessions()
	});
}
function $w() {
	let { api: e } = r(), t = Tw(), n = _();
	return h({
		retry: !1,
		mutationFn: ({ id: t, patch: n }) => e.updateConfig(t, n),
		onSuccess: (e, { id: r }) => {
			n.invalidateQueries({ queryKey: v.sessionConfig(r) }), t.session(r), t.sessions();
		}
	});
}
function eT() {
	let { api: e } = r(), { captureRuntimeActivation: t, setOptimisticUserPrompt: n } = r().stores.runtimeStore, a = Tw(), o = _();
	return h({
		retry: !1,
		mutationFn: ({ id: r, prompt: s, signal: c }) => {
			let l = t(r);
			return rw($C({
				optimistic: () => {
					l() && n(s);
				},
				admit: async () => {
					let t = await (c ? e.submitRun(r, s, c) : e.submitRun(r, s));
					return t.status === "accepted" ? {
						kind: "accepted",
						value: t.response
					} : t.status === "not-sent" ? {
						kind: "not-sent",
						error: new DOMException("Prompt submission was cancelled before it was sent.", "AbortError")
					} : {
						kind: "uncertain",
						error: new i(t.requestId, t.error)
					};
				},
				rejected: () => {
					l() && n(null);
				},
				reconcile: (e) => {
					e ? (Mw(Aw(o, r), !0), a.sessionRoot(r)) : a.session(r);
				}
			}));
		}
	});
}
function tT() {
	let e = _();
	return h({
		retry: !1,
		mutationFn: (t) => rw(ew(iw(e, t)))
	});
}
function nT() {
	let { api: e } = r(), t = Tw(), n = _();
	return h({
		mutationFn: (t) => e.compactSession(t),
		onSuccess: (e, r) => (Mw(Aw(n, r), !0), t.sessionRoot(r))
	});
}
function rT() {
	let { api: e } = r(), t = Tw(), n = _();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.revertSession(t, n),
		onSuccess: (e, { id: r }) => {
			Mw(Aw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function iT() {
	let { api: e } = r(), t = Tw(), n = _();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.regenerateRun(t, n),
		onSuccess: (e, { id: r }) => {
			Mw(Aw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function aT() {
	let { api: e } = r(), t = Tw();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.forkSession(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n), t.sessions();
		}
	});
}
function oT() {
	let { api: e } = r(), t = Tw();
	return h({
		mutationFn: ({ id: t, forkId: n }) => e.dismissSessionFork(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n);
		}
	});
}
function sT() {
	return Vw();
}
// src/app/services/queries/workspace.ts
function cT(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function lT(e, t, n = "all", i = 3, a = null) {
	let { api: o } = r();
	return g({
		queryKey: v.workspaceDiff(e ?? "", t ?? "", n, i, a),
		queryFn: ({ signal: r }) => o.getWorkspaceDiff(e, t, {
			stage: n,
			context: i,
			revision: a,
			signal: r
		}),
		enabled: !!(e && t),
		placeholderData: cT(e ?? "")
	});
}
function uT(e, t = null) {
	let { api: n } = r();
	return g({
		queryKey: v.workspaceFiles(e ?? "", t),
		queryFn: ({ signal: r }) => n.getWorkspaceFiles(e, t, r),
		enabled: !!e,
		staleTime: t == null ? 1e4 : Infinity,
		placeholderData: cT(e ?? "")
	});
}
function dT(e, t, n = null) {
	let { api: i } = r();
	return g({
		queryKey: v.workspaceFile(e ?? "", t ?? "", n),
		queryFn: ({ signal: r }) => i.getWorkspaceFile(e, t, n, r),
		enabled: !!(e && t),
		staleTime: n == null ? 1e4 : Infinity,
		placeholderData: cT(e ?? "")
	});
}
function fT(e) {
	let { api: t } = r();
	return g({
		queryKey: v.workspaceRevisions(e ?? ""),
		queryFn: ({ signal: n }) => t.getWorkspaceRevisions(e, n),
		enabled: !!e,
		staleTime: 5e3,
		retry: !1
	});
}
function pT(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.workspaceRevisionChanges(e ?? "", t ?? 0),
		queryFn: ({ signal: r }) => n.getWorkspaceRevisionChanges(e, t, r),
		enabled: !!(e && t != null),
		staleTime: Infinity,
		placeholderData: cT(e ?? "")
	});
}
function mT(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.branches(e ?? ""),
		queryFn: ({ signal: t }) => n.getBranches(e, t),
		enabled: !!e && t,
		staleTime: 5e3,
		retry: !1
	});
}
function hT(e) {
	let { api: t } = r(), n = _();
	return h({
		mutationFn: (n) => t.switchBranch(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: v.branches(e) }), n.invalidateQueries({ queryKey: v.sessionRoot(e) }), n.invalidateQueries({ queryKey: v.sessionsAll });
		}
	});
}
function gT(e) {
	let { api: t } = r(), n = _();
	return h({
		mutationFn: (n) => t.commitWorkspace(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: v.sessionRoot(e) }), n.invalidateQueries({ queryKey: v.sessionsAll });
		}
	});
}
// src/app/services/queries/projects.ts
function _T() {
	let { api: e } = r();
	return g({
		queryKey: v.projects,
		queryFn: ({ signal: t }) => e.listProjects(t),
		staleTime: 3e4,
		retry: !1
	});
}
function vT() {
	let { api: e } = r(), t = Tw();
	return h({
		retry: !1,
		mutationFn: (t) => e.createProject(t),
		onSuccess: () => t.projects()
	});
}
function yT() {
	let { api: e } = r(), t = Tw();
	return h({
		retry: !1,
		mutationFn: ({ projectId: t, payload: n }) => e.updateProject(t, n),
		onSuccess: () => t.projects()
	});
}
function bT() {
	let e = yT();
	return {
		...e,
		toggle: (t) => e.mutateAsync({
			projectId: t.project_id,
			payload: { pinned: !t.pinned }
		})
	};
}
function xT() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = Tw();
	return h({
		mutationFn: ({ projectId: t, sessions: n }) => e.deleteProject(t, n),
		onSuccess: (e) => (t.purgeSessions(e.deleted_session_ids), Promise.all([n.projects(), n.sessions()]))
	});
}
function ST() {
	let { api: e } = r(), t = Tw();
	return h({
		mutationFn: ({ projectId: t, sessionId: n }) => e.assignSessionToProject(t, { session_id: n }),
		onSuccess: () => Promise.all([t.projects(), t.sessions()])
	});
}
function CT() {
	let { api: e } = r(), t = Tw();
	return h({
		mutationFn: async ({ projects: t, projectId: n, targetPinned: r, targetIndex: i }) => {
			let a = t.find((e) => e.project_id === n);
			if (!a) return;
			let o = t;
			a.pinned !== r && (await e.updateProject(n, { pinned: r }), o = (await e.listProjects()).projects);
			let s = o.filter((e) => e.pinned === r).sort((e, t) => e.sort_order - t.sort_order), c = vw(s.map((e) => e.project_id), n, i);
			await e.reorderProjects({
				pinned: r,
				project_ids: c,
				expected_versions: Object.fromEntries(s.map((e) => [e.project_id, e.presentation_version]))
			});
		},
		onSuccess: () => t.projects()
	});
}
// src/app/services/queries/fleetAttentionModel.ts
var wT = {
	scope: null,
	epoch: null,
	revision: 0,
	sessions: /* @__PURE__ */ new Map()
};
function TT(e, t) {
	let n = e.scope === t.scope;
	if (t.kind === "snapshot" && !Array.isArray(t.sessions) || t.kind !== "snapshot" && (!Array.isArray(t.upserts) || !Array.isArray(t.removed))) return e;
	if (t.kind === "snapshot") return n && e.epoch === t.epoch && t.revision < e.revision ? e : {
		scope: t.scope,
		epoch: t.epoch,
		revision: t.revision,
		sessions: new Map(t.sessions.map((e) => [e.session_id, e]))
	};
	if (!n || e.epoch !== t.epoch || t.revision <= e.revision) return e;
	let r = new Map(e.sessions);
	for (let e of t.upserts) r.set(e.session_id, e);
	for (let e of t.removed) r.delete(e);
	return {
		scope: t.scope,
		epoch: t.epoch,
		revision: t.revision,
		sessions: r
	};
}
// src/app/services/queries/attention.ts
var ET = 1e3, DT = 3e4;
function OT(e = {}) {
	let t = r(), { api: n, client: i } = t, a = e.projectId, o = e.enabled ?? !0, s = o && (e.stream ?? !0), [c, l] = ee(TT, wT), u = te(0), d = te({
		scope: a ?? null,
		at: 0
	}), [f, re] = ne({
		scope: a ?? null,
		version: 0
	}), [h, ie] = ne(null), _ = `/attention/stream${a ? `?project_id=${encodeURIComponent(a)}` : ""}`, [ae, oe] = ne({
		path: _,
		status: "connecting"
	}), se = s ? ae.path === _ ? ae.status : "connecting" : "down", ce = m(() => e.eventSource ?? t.openStream ?? ((e) => new EventSource(i.transport.url(e), i.transport.eventSourceInit())), [
		e.eventSource,
		t.openStream,
		i
	]), le = g({
		queryKey: v.fleetAttention(a ?? null),
		queryFn: async ({ signal: e }) => {
			let t = ++u.current, r = performance.now(), i = await n.fleetAttention(a, e);
			return e.aborted || re({
				scope: a ?? null,
				version: t
			}), {
				snapshot: i,
				startedAt: r
			};
		},
		enabled: o,
		refetchInterval: se === "live" ? !1 : e.pollMs ?? 5e3,
		staleTime: 0
	}), ue = le.refetch;
	p(() => {
		let e = d.current;
		le.data && (e.scope !== (a ?? null) || le.data.startedAt >= e.at) && l({
			kind: "snapshot",
			...le.data.snapshot,
			scope: a ?? null
		});
	}, [le.data, a]), p(() => {
		if (!s) return;
		let e = _, t = (t) => oe({
			path: e,
			status: t
		}), n = !1, r = null, i = null, o = ET, c = () => {
			r?.close(), r = null, !(n || i !== null) && (t("down"), i = setTimeout(() => {
				i = null, f();
			}, o), o = Math.min(o * 2, DT));
		}, f = async () => {
			let i;
			try {
				i = await ce(e);
			} catch {
				c();
				return;
			}
			n ? i.close() : (r = i, i.addEventListener("fleet_attention", (e) => {
				if (n || r !== i || !(e instanceof MessageEvent)) return;
				let s;
				try {
					s = JSON.parse(String(e.data));
				} catch {
					c();
					return;
				}
				s.kind === "unavailable" ? (ie({
					scope: a ?? null,
					version: u.current
				}), c(), ue()) : (o = ET, s.kind === "snapshot" && (d.current = {
					scope: a ?? null,
					at: performance.now()
				}), l({
					...s,
					scope: a ?? null
				}), ie(null), t("live"));
			}), i.onerror = () => {
				!n && r === i && c();
			});
		};
		return f(), () => {
			n = !0, i !== null && clearTimeout(i), r?.close(), r = null;
		};
	}, [
		s,
		a,
		ce,
		_,
		ue
	]);
	let de = h?.scope === (a ?? null) && (f.scope !== h.scope || f.version <= h.version), fe = se === "live" ? "live" : le.isError || de ? "unavailable" : (se === "connecting" || !s) && !le.data ? "connecting" : "polling";
	return {
		...c.scope === (a ?? null) ? c : wT,
		status: fe
	};
}
// src/app/features/managed/model.ts
var kT = [
	"status",
	"github",
	"secrets"
], AT = /* @__PURE__ */ new Set([
	"PATH",
	"HOME",
	"NAC_HOME",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"EXA_API_KEY"
]);
function jT(e) {
	return e ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(e) ? AT.has(e) ? `${e} is managed by NAC and cannot be replaced here.` : "" : "Use letters, digits, and underscores; the first character cannot be a digit." : "Enter a variable name.";
}
function MT(e) {
	let t = e?.split("/") ?? [];
	return t.length === 2 && t[0] && t[1] ? [t[0], t[1]] : null;
}
function NT(e) {
	return e?.status === "running";
}
function PT(e) {
	return e ? {
		backend: e.model.backend,
		model: e.model.id,
		baseUrl: e.model.endpoint
	} : null;
}
function FT(e, t) {
	return !!(t && e && t.backend === e.model.backend && t.baseUrl === e.model.endpoint);
}
function IT(e, t) {
	return (e?.providers ?? []).flatMap((e) => {
		if (e.auth_status !== "ready") return [];
		if (e.auth !== "api_key_env") return [{ backend: e.id }];
		let n = e.connection;
		return n ? [{
			backend: e.id,
			base_url: n.base_url,
			allow_insecure_http: n.allow_insecure_http,
			...n.api_key_env ? { api_key_env: n.api_key_env } : {}
		}] : !t?.model_ready || e.id !== t.model.backend ? [] : [{
			backend: e.id,
			base_url: t.model.endpoint
		}];
	});
}
// src/app/features/managed/upgrade.ts
function LT(e) {
	return typeof e == "object" && e && "status" in e ? e.status : null;
}
function RT(e) {
	return zT(e) || e instanceof Error && e.name === "ManagedUpgradeContractError";
}
function zT(e) {
	let t = LT(e);
	return t === 401 || t === 403 || t === 409;
}
function BT(e) {
	let t = LT(e);
	return t === 401 || t === 403 ? {
		message: "This managed session is no longer authorized. Reopen this host from the Arcee portal.",
		retryLabel: null
	} : t === 409 ? {
		message: "This host session changed. Refresh status or reopen this host from the Arcee portal.",
		retryLabel: "Refresh status"
	} : {
		message: "The upgrade service is temporarily unavailable. Try again to resume the same request safely.",
		retryLabel: "Try again"
	};
}
var VT = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying"
]);
function HT(e) {
	return VT.has(e);
}
function UT(e) {
	switch (e) {
		case "pending": return "Queued";
		case "preparing": return "Preparing this host";
		case "blocked": return "Waiting for active work";
		case "safe-to-stop": return "Ready to replace";
		case "replacing": return "Replacing NAC";
		case "starting/migrating": return "Starting and migrating";
		case "verifying": return "Verifying the replacement";
		case "succeeded": return "Upgrade complete";
		case "failed": return "Upgrade failed";
	}
}
function WT(e) {
	switch (e) {
		case "cancel_active_run": return "Stop run";
		case "cancel_traditional_child": return "Cancel coding agent";
		case "cancel_managed_orchestrator": return "Cancel NAC orchestrator";
		case "terminate_terminal": return "Stop terminal";
		case "cancel_clone_operation": return "Cancel clone";
		case "wait": return "Wait";
	}
}
function GT(e) {
	return e === null ? "Accepted-release distance unavailable" : e === 0 ? "Current accepted release" : `${e} accepted ${e === 1 ? "release" : "releases"} ahead`;
}
function KT(e, t) {
	return e.release_id === t.release_id && e.source_revision === t.source_revision && e.build_id === t.build_id && e.product_version === t.product_version && e.schema_version === t.schema_version;
}
// src/app/features/managed/upgradeContract.ts
var qT = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying",
	"succeeded",
	"failed"
]), JT = /* @__PURE__ */ new Set([
	"active_run",
	"compaction",
	"traditional_child",
	"managed_orchestrator",
	"terminal_process",
	"clone_operation",
	"workspace_mutation",
	"operation_lease",
	"resource_lease",
	"maintenance_operation",
	"host-release",
	"host-readiness",
	"maintenance"
]), YT = /* @__PURE__ */ new Set([
	"wait",
	"cancel_active_run",
	"cancel_traditional_child",
	"cancel_managed_orchestrator",
	"terminate_terminal",
	"cancel_clone_operation"
]), XT = {
	active_run: ["An active run must finish before maintenance can start"],
	compaction: ["An active compaction must finish before maintenance can start"],
	traditional_child: ["An active child session must finish before maintenance can start"],
	managed_orchestrator: ["An active orchestrator must finish before maintenance can start"],
	terminal_process: ["An active terminal process must finish before maintenance can start"],
	clone_operation: ["An active repository clone must finish before maintenance can start"],
	workspace_mutation: ["An active workspace mutation must finish before maintenance can start"],
	operation_lease: ["An active operation must finish before maintenance can start"],
	resource_lease: ["An active resource lease must clear before maintenance can start"],
	maintenance_operation: ["Another maintenance operation is active"],
	"host-release": ["Suspended release identity is not exactly verified", "Current release identity is not exactly verified"],
	"host-readiness": ["Current NAC runtime is not ready"],
	maintenance: [
		"The failed candidate could not be superseded",
		"The failed candidate supersession acknowledgement is invalid",
		"NAC is not yet safe to stop",
		"NAC reported an unsupported maintenance blocker; wait for it to clear"
	]
}, ZT = class extends Error {
	constructor() {
		super("Managed upgrade status did not match the browser contract."), this.name = "ManagedUpgradeContractError";
	}
};
function QT() {
	throw new ZT();
}
function $T(e, t, n) {
	(typeof e != "object" || !e || Array.isArray(e)) && QT();
	let r = e;
	return Object.keys(r).some((e) => !t.includes(e)) && QT(), n.some((e) => !Object.hasOwn(r, e)) && QT(), r;
}
function eE(e, t, n = !0) {
	return (typeof e != "string" || e.length > t || !n && e.length === 0 || /\p{Cc}/u.test(e)) && QT(), e;
}
function tE(e) {
	return (typeof e != "number" || !Number.isSafeInteger(e) || e < 0) && QT(), e;
}
function nE(e, t) {
	return typeof e == "string" && t.has(e) || QT(), e;
}
function rE(e, t, n) {
	return Object.hasOwn(e, t) ? eE(e[t], n) : void 0;
}
function iE(e) {
	let t = $T(e, [
		"release_id",
		"source_revision",
		"build_id",
		"product_version",
		"schema_version"
	], [
		"release_id",
		"source_revision",
		"build_id",
		"product_version",
		"schema_version"
	]), n = eE(t.source_revision, 40, !1);
	return /^[a-f0-9]{40}$/.test(n) || QT(), {
		release_id: eE(t.release_id, 63, !1),
		source_revision: n,
		build_id: eE(t.build_id, 128, !1),
		product_version: eE(t.product_version, 128, !1),
		schema_version: tE(t.schema_version)
	};
}
function aE(e, t) {
	return Object.hasOwn(e, t) ? iE(e[t]) : void 0;
}
function oE(e) {
	let t = eE(e, 128, !1);
	return /^[A-Za-z0-9_.:@-]+$/.test(t) || QT(), t;
}
function sE(e) {
	let t = [
		"session_id",
		"run_id",
		"child_session_id",
		"orchestrator_session_id",
		"terminal_id",
		"clone_operation_id"
	], n = $T(e, t, []);
	return Object.fromEntries(t.filter((e) => Object.hasOwn(n, e)).map((e) => [e, oE(n[e])]));
}
function cE(e, t) {
	let n = Object.keys(e).sort();
	return n.length === t.length && t.every((t) => n.includes(t) && !!e[t]);
}
function lE(e, t, n) {
	switch (t) {
		case "cancel_active_run": return e === "active_run" && cE(n, ["session_id", "run_id"]);
		case "cancel_traditional_child": return e === "traditional_child" && cE(n, ["session_id", "child_session_id"]);
		case "cancel_managed_orchestrator": return e === "managed_orchestrator" && cE(n, ["session_id", "orchestrator_session_id"]);
		case "terminate_terminal": return e === "terminal_process" && cE(n, ["session_id", "terminal_id"]);
		case "cancel_clone_operation": return e === "clone_operation" && cE(n, ["clone_operation_id"]);
		case "wait": return !1;
	}
}
function uE(e) {
	let t = $T(e, [
		"selection_key",
		"kind",
		"message",
		"actionable",
		"action",
		"target"
	], [
		"selection_key",
		"kind",
		"message",
		"actionable",
		"action",
		"target"
	]), n = eE(t.selection_key, 71, !1);
	/^sha256:[a-f0-9]{64}$/.test(n) || QT();
	let r = nE(t.kind, JT), i = eE(t.message, 512, !1);
	XT[r].includes(i) || QT(), typeof t.actionable != "boolean" && QT();
	let a = nE(t.action, YT);
	if (!t.actionable) return (a !== "wait" || t.target !== null) && QT(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !1,
		action: a,
		target: null
	};
	let o = sE(t.target);
	return lE(r, a, o) || QT(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !0,
		action: a,
		target: o
	};
}
function dE(e) {
	let t = $T(e, [
		"operation_id",
		"managed_host_id",
		"kind",
		"state",
		"reason",
		"message",
		"target_release",
		"desired_release",
		"observed_release",
		"blockers",
		"created_at",
		"updated_at"
	], [
		"operation_id",
		"managed_host_id",
		"kind",
		"state"
	]);
	t.kind !== "upgrade" && QT();
	let n;
	return Object.hasOwn(t, "blockers") && ((!Array.isArray(t.blockers) || t.blockers.length > 100) && QT(), n = t.blockers.map(uE)), {
		operation_id: eE(t.operation_id, 128, !1),
		managed_host_id: eE(t.managed_host_id, 128, !1),
		kind: "upgrade",
		state: nE(t.state, qT),
		reason: rE(t, "reason", 128),
		message: rE(t, "message", 512),
		target_release: aE(t, "target_release"),
		desired_release: aE(t, "desired_release"),
		observed_release: aE(t, "observed_release"),
		blockers: n,
		created_at: rE(t, "created_at", 64),
		updated_at: rE(t, "updated_at", 64)
	};
}
function fE(e) {
	let t = $T(e, ["preview", "operation"], ["preview", "operation"]), n = $T(t.preview, [
		"current",
		"latest_beta",
		"upgrade_available",
		"distance"
	], [
		"current",
		"latest_beta",
		"upgrade_available",
		"distance"
	]);
	typeof n.upgrade_available != "boolean" && QT();
	let r = null;
	return n.distance !== null && (r = { accepted_releases: tE($T(n.distance, ["accepted_releases"], ["accepted_releases"]).accepted_releases) }), {
		preview: {
			current: iE(n.current),
			latest_beta: iE(n.latest_beta),
			upgrade_available: n.upgrade_available,
			distance: r
		},
		operation: t.operation === null ? null : dE(t.operation)
	};
}
// src/app/features/managed/queries.ts
var $ = {
	hostStatus: ["managed-host-status"],
	github: ["managed-github"],
	secrets: ["managed-secrets"],
	auth: ["managed-auth"],
	upgrade: ["managed-upgrade"],
	providerModels: (e, t) => t ? [
		"managed-provider-models",
		e,
		t
	] : ["managed-provider-models", e],
	providerModelsAll: ["managed-provider-models"]
};
function pE() {
	let { api: e } = r();
	return g({
		queryKey: $.hostStatus,
		queryFn: ({ signal: t }) => e.getManagedStatus(t),
		staleTime: 5e3,
		refetchInterval: 15e3,
		retry: !1
	});
}
function mE(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: $.upgrade,
		queryFn: async ({ signal: e }) => fE(await t.getManagedUpgrade(e)),
		enabled: e,
		staleTime: 0,
		refetchInterval: (e) => e.state.data?.operation && HT(e.state.data.operation.state) ? 1e3 : 15e3,
		refetchIntervalInBackground: !0,
		retry: !1
	});
}
function hE() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: async (t) => dE(await e.startManagedUpgrade(t)),
		onSuccess: (e) => (t.setQueryData($.upgrade, (t) => t && {
			...t,
			operation: e
		}), t.invalidateQueries({ queryKey: $.upgrade }))
	});
}
function gE(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: $.github,
		queryFn: ({ signal: e }) => t.getManagedGitHub(e),
		enabled: e,
		retry: !1
	});
}
function _E(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: $.secrets,
		queryFn: ({ signal: e }) => t.listManagedSecrets(e),
		enabled: e,
		retry: !1
	});
}
function vE() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ name: t, value: n }) => e.putManagedSecret(t, n),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: $.secrets }), t.invalidateQueries({ queryKey: $.hostStatus })])
	});
}
function yE() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteManagedSecret(t),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: $.secrets }), t.invalidateQueries({ queryKey: $.hostStatus })])
	});
}
function bE(e = !0, t = !1) {
	let { api: n } = r();
	return g({
		queryKey: $.auth,
		queryFn: ({ signal: e }) => n.listManagedAuth(e),
		enabled: e,
		staleTime: 3e4,
		refetchInterval: t,
		retry: !1
	});
}
function xE(e, t, n) {
	let { api: i } = r(), a = _(), o = TC(e === "chatgpt-codex-responses" && t !== null && n !== null);
	return g({
		queryKey: [
			...$.providerModels(e ?? ""),
			"after-refusal",
			t,
			n,
			...e === "chatgpt-codex-responses" ? [o.data?.catalog_version] : []
		],
		queryFn: async ({ signal: t }) => {
			let n = await i.listProviderModels({ backend: e }, t);
			return e === "chatgpt-codex-responses" && await a.invalidateQueries({ queryKey: v.modelCatalog }), n;
		},
		enabled: e !== null && t !== null && n !== null && (e !== "chatgpt-codex-responses" || o.data !== void 0),
		retry: !1,
		staleTime: Infinity
	});
}
function SE(e, t, n = null) {
	let { api: i } = r(), a = _(), o = TC(t && e === "chatgpt-codex-responses");
	return g({
		queryKey: e === "chatgpt-codex-responses" ? [
			...$.providerModels(e, n),
			"catalog",
			o.data?.catalog_version
		] : $.providerModels(e ?? "", n),
		queryFn: async ({ signal: t }) => {
			let r = await i.listProviderModels(n ? {
				backend: e,
				base_url: n
			} : { backend: e }, t);
			return e === "chatgpt-codex-responses" && await a.invalidateQueries({ queryKey: v.modelCatalog }), r;
		},
		enabled: t && e !== null && (e !== "chatgpt-codex-responses" || o.data !== void 0),
		retry: !1,
		staleTime: 3e5
	});
}
function CE(e) {
	let { api: t } = r(), n = _(), i = pE().data ?? null, a = m(() => IT(e, i), [e, i]), o = ie({ queries: a.map((r) => ({
		queryKey: r.backend === "chatgpt-codex-responses" ? [
			...$.providerModels(r.backend, r.base_url),
			"catalog",
			e?.catalog_version
		] : [
			...$.providerModels(r.backend, r.base_url),
			r.api_key_env ?? null,
			r.allow_insecure_http ?? !1
		],
		queryFn: async ({ signal: e }) => {
			let i = await t.listProviderModels(r, e);
			return r.backend === "chatgpt-codex-responses" && await n.invalidateQueries({ queryKey: v.modelCatalog }), i;
		},
		retry: !1,
		staleTime: 3e5
	})) }), s = /* @__PURE__ */ new Map();
	return a.forEach((e, t) => {
		let n = o[t];
		n?.isPending ? s.set(e.backend, null) : n?.isSuccess && s.set(e.backend, n.data.models);
	}), s;
}
// src/app/providers/ToastProvider.tsx
var wE = u(null), TE = 150, EE = 3, DE = 0, OE = () => `toast-${Date.now()}-${DE++}`;
function kE({ toasts: e, removeToast: t }) {
	let n = a(), r = te(/* @__PURE__ */ new Map());
	return p(() => {
		let n = r.current;
		for (let r of e) r.keep || r.dismissing || n.has(r.id) || n.set(r.id, setTimeout(() => t(r.id), r.life * 1e3));
		let i = new Set(e.map((e) => e.id));
		for (let [e, t] of n) i.has(e) || (clearTimeout(t), n.delete(e));
	}, [e, t]), p(() => {
		let e = r.current;
		return () => e.forEach((e) => clearTimeout(e));
	}, []), ce(/* @__PURE__ */ oe("div", {
		role: "region",
		"aria-label": "Notifications",
		"aria-live": "polite",
		"aria-relevant": "additions",
		className: "fixed inset-x-0 top-[calc(64px+env(safe-area-inset-top))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2 pointer-events-none",
		children: e.map((e) => /* @__PURE__ */ oe("div", {
			className: "pointer-events-none flex w-full justify-center",
			children: /* @__PURE__ */ oe(c, {
				content: e.content,
				variant: e.variant,
				dismissing: e.dismissing,
				onClose: () => t(e.id)
			})
		}, e.id))
	}), n);
}
function AE({ children: e }) {
	let [t, n] = ne([]), r = d((e) => {
		let t = OE();
		return n((n) => [...n, {
			id: t,
			content: e.content,
			variant: e.variant ?? s.Info,
			life: e.life ?? EE,
			keep: e.keep ?? !1,
			dismissing: !1
		}]), t;
	}, []), i = d((e) => {
		n((t) => {
			let r = t.find((t) => t.id === e);
			return !r || r.dismissing ? t : (setTimeout(() => n((t) => t.filter((t) => t.id !== e)), TE), t.map((t) => t.id === e ? {
				...t,
				dismissing: !0
			} : t));
		});
	}, []), a = d(() => {
		n((e) => e.length === 0 ? e : (setTimeout(() => n((e) => e.filter((e) => !e.dismissing)), TE), e.map((e) => ({
			...e,
			dismissing: !0
		}))));
	}, []), o = m(() => ({
		addToast: r,
		removeToast: i,
		clearToasts: a,
		info: (e, t) => r({
			content: e,
			variant: s.Info,
			...t
		}),
		success: (e, t) => r({
			content: e,
			variant: s.Success,
			...t
		}),
		error: (e, t) => r({
			content: e,
			variant: s.Error,
			...t
		}),
		danger: (e, t) => r({
			content: e,
			variant: s.Danger,
			...t
		})
	}), [
		r,
		i,
		a
	]);
	return /* @__PURE__ */ se(wE.Provider, {
		value: o,
		children: [e, /* @__PURE__ */ oe(kE, {
			toasts: t,
			removeToast: i
		})]
	});
}
function jE() {
	let e = f(wE);
	if (!e) throw Error("useToast must be used within a ToastProvider");
	return e;
}
function ME(e) {
	return e instanceof Error ? e.message : String(e);
}
// src/app/lib/PerfProfiler.tsx
var NE = (e, n, r) => {
	t(`commit:${e}`, {
		ms: r,
		fields: { phase: n },
		throttleMs: 1e3,
		slowMs: 16
	});
};
function PE({ id: t, children: n }) {
	return e() ? /* @__PURE__ */ oe(l, {
		id: t,
		onRender: NE,
		children: n
	}) : /* @__PURE__ */ oe(ae, { children: n });
}
// src/app/lib/workspaceLink.ts
var FE = /^(https?|ircs?|mailto|xmpp|file)$/i, IE = /^[a-zA-Z]:[\\/]/, LE = /^(https?|mailto|ircs?|xmpp):/i;
function RE(e) {
	let t = String(e ?? "").trim();
	if (!t) return "";
	if (IE.test(t)) return t;
	let n = t.indexOf(":");
	return n === -1 || FE.test(t.slice(0, n)) ? t : "";
}
function zE(e) {
	return e.replace(/\\/g, "/");
}
function BE(e, t) {
	if (!t) return null;
	let n = zE(t).replace(/\/+$/, "");
	return n ? e === n ? "" : e.startsWith(`${n}/`) ? e.slice(n.length + 1) : null : null;
}
function VE(e, t = []) {
	let n = (e ?? "").trim();
	if (!n || n.startsWith("#")) return { kind: "blocked" };
	if (LE.test(n)) return {
		kind: "external",
		href: n
	};
	if (/^[a-z][a-z0-9+.-]*:/i.test(n) && !/^file:/i.test(n)) return { kind: "blocked" };
	let r = n;
	if (/^file:/i.test(r)) try {
		let e = new URL(r);
		r = decodeURIComponent(e.pathname), /^\/[a-zA-Z]:\//.test(r) && (r = r.slice(1));
	} catch {
		r = r.replace(/^file:\/\//i, "").replace(/^localhost/i, "");
	}
	r = zE(r);
	for (let e of t) {
		let t = BE(r, e);
		if (t != null) {
			r = t;
			break;
		}
	}
	return r.startsWith("/") || IE.test(r) || (r = r.replace(/^\.\//, ""), !r || r === ".") || r.split("/").includes("..") || r.includes("://") ? { kind: "blocked" } : {
		kind: "workspace",
		path: r
	};
}
export { oT as $, me as $n, _C as $t, jT as A, LS as An, HC as At, yT as B, Px as Bn, UC as Bt, UT as C, QS as Cn, hw as Ct, kT as D, eC as Dn, ZC as Dt, KT as E, $S as En, RC as Et, vT as F, US as Fn, JC as Ft, dT as G, xp as Gn, AC as Gt, gT as H, Ax as Hn, NC as Ht, xT as I, NS as In, IC as It, fT as J, wn as Jn, lC as Jt, uT as K, Sp as Kn, DC as Kt, CT as L, OS as Ln, zC as Lt, MT as M, zS as Mn, BC as Mt, OT as N, ZS as Nn, LC as Nt, NT as O, tC as On, qC as Ot, ST as P, WS as Pn, VC as Pt, Yw as Q, fe as Qn, hC as Qt, _T as R, Mx as Rn, KC as Rt, HT as S, HS as Sn, Cw as St, RT as T, YS as Tn, rw as Tt, hT as U, jx as Un, MC as Ut, mT as V, Ix as Vn, XC as Vt, lT as W, bp as Wn, jC as Wt, nT as X, de as Xn, pC as Xt, tT as Y, v as Yn, yC as Yt, qw as Z, ue as Zn, xC as Zt, CE as _, KS as _n, Iw as _t, ME as a, kC as an, Kw as at, zT as b, PS as bn, yw as bt, yE as c, sC as cn, Vw as ct, pE as d, SC as dn, $w as dt, wC as en, _e as er, aT as et, SE as f, bC as fn, Xw as ft, vE as g, BS as gn, Mw as gt, xE as h, iC as hn, Bw as ht, AE as i, cC as in, rT as it, FT as j, RS as jn, YC as jt, PT as k, JS as kn, WC as kt, bE as l, dC as ln, eT as lt, mE as m, rC as mn, Fw as mt, RE as n, vC as nn, ge as nr, Qw as nt, jE as o, OC as on, Ww as ot, _E as p, mC as pn, sT as pt, pT as q, si as qn, oC as qt, PE as r, TC as rn, iT as rt, $ as s, fC as sn, Hw as st, VE as t, CC as tn, he as tr, Gw as tt, gE as u, uC as un, Zw as ut, hE as v, VS as vn, Lw as vt, BT as w, IS as wn, nw as wt, GT as x, FS as xn, bw as xt, WT as y, qS as yn, Aw as yt, bT as z, Nx as zn, GC as zt };
