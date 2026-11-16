import { D as e, O as t, a as n, n as r, z as i } from "./RuntimeContext-BytQzJ1Z.js";
import { a, y as o } from "./PresentationBoundary-DgJz1GXw.js";
import { n as s, t as c } from "./Toast-BMeEGYEb.js";
import { Profiler as l, createContext as u, useCallback as d, useContext as f, useEffect as p, useMemo as m, useRef as h, useState as ee } from "react";
import { keepPreviousData as te, useInfiniteQuery as ne, useMutation as g, useQueries as re, useQuery as _, useQueryClient as v } from "@tanstack/react-query";
import { Fragment as ie, jsx as ae, jsxs as oe } from "react/jsx-runtime";
import { createPortal as se } from "react-dom";
// src/app/lib/routes.ts
var ce = [
	"sessions",
	"insights",
	"threads",
	"delegated",
	"files",
	"terminal",
	"heartbeats",
	"worksets",
	"history"
], le = {
	sessions: "Sessions",
	insights: "Insights",
	threads: "Threads",
	delegated: "Subagents",
	files: "Files",
	terminal: "Terminal",
	heartbeats: "Heartbeats",
	worksets: "Worksets",
	history: "History"
};
ce.filter((e) => e !== "history");
var ue = "insights";
function de(e) {
	return ce.includes(e ?? "");
}
var fe = [
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
function pe(e) {
	return fe.includes(e ?? "");
}
var me = {
	list: () => "/",
	newSession: (e) => e ? `/?project=${encodeURIComponent(e)}` : "/",
	settings: (e = "general") => `/settings/${e}`,
	session: (e, t = ue) => `/session/${encodeURIComponent(e)}/${t}`,
	project: (e) => `/project/${encodeURIComponent(e)}`,
	taskSchedules: (e) => e ? `/project/${encodeURIComponent(e)}/task-schedules` : "/task-schedules",
	designPreview: () => "/design"
};
function he(e) {
	let [, t, n] = e.split("/");
	return t !== "session" || !n ? null : decodeURIComponent(n);
}
function ge(e) {
	let [, t, n] = e.split("/");
	return t !== "project" || !n ? null : decodeURIComponent(n);
}
// src/app/services/queries/keys.ts
var _e = 5e3, y = {
	storeInfo: ["store"],
	managedHostStatus: ["managed-host-status"],
	managedGitHub: ["managed-github"],
	managedSecrets: ["managed-secrets"],
	sandboxAvailability: ["sandbox-availability"],
	sandboxActivity: ["sandbox-activity"],
	credentials: ["credentials"],
	managedAuth: ["managed-auth"],
	modelConfigs: ["model-configs"],
	sshConfigs: ["ssh-configs"],
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
	resolvedModelConfig: (e) => ["model-config-resolved", e],
	resolvedModelConfigsAll: ["model-config-resolved"],
	resolvedConfigFile: (e) => ["config-file-resolved", e],
	resolvedConfigFilesAll: ["config-file-resolved"],
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
	threadEventsRoot: (e) => [
		"session",
		e,
		"thread-events"
	],
	threadEvents: (e, t) => [
		"session",
		e,
		"thread-events",
		t
	],
	toolCallContent: (e, t, n) => [
		"session",
		e,
		"tool-call",
		t,
		n
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
}, ve = (e) => typeof e == "function", b = function(e, t) {
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
}, x = (e) => e, ye = (e) => () => e, be = /*#__PURE__*/ ye(!0), xe = /*#__PURE__*/ ye(!1), Se = /*#__PURE__*/ ye(void 0), Ce = Se;
function S(e, t, n, r, i, a, o, s, c) {
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
var we = (e) => (t, n) => t === n || e(t, n), Te = /*#__PURE__*/ b(2, (e, t) => we((n, r) => e(t(n), t(r)))), Ee = (e) => we((t, n) => {
	if (t.length !== n.length) return !1;
	for (let r = 0; r < t.length; r++) if (!e(t[r], n[r])) return !1;
	return !0;
}), De = "effect/GlobalValue", Oe, C = (e, t) => (Oe ||= (globalThis[De] ??= /* @__PURE__ */ new Map(), globalThis[De]), Oe.has(e) || Oe.set(e, t()), Oe.get(e)), ke = (e) => typeof e == "string", Ae = (e) => typeof e == "number", je = (e) => typeof e == "bigint", Me = ve, Ne = (e) => typeof e == "object" && !!e, Pe = (e) => Ne(e) || Me(e), w = /*#__PURE__*/ b(2, (e, t) => Pe(e) && t in e), Fe = /*#__PURE__*/ b(2, (e, t) => w(e, "_tag") && e._tag === t), Ie = (e) => e == null, Le = (e) => typeof e == "string" || w(e, Symbol.iterator), Re = (e) => w(e, "then") && Me(e.then), ze = (e) => `BUG: ${e} - please report an issue at https://github.com/Effect-TS/effect/issues`, Be = class e {
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
}, Ve = 335903614, He = 4150755663, Ue = 1481765933, We = 1284865837, Ge = 9007199254740992, Ke = 134217728, qe = class {
	_state;
	constructor(e, t, n, r) {
		return Ie(t) && Ie(e) ? (t = Math.random() * 4294967295 >>> 0, e = 0) : Ie(t) && (t = e, e = 0), Ie(r) && Ie(n) ? (r = this._state ? this._state[3] : He, n = this._state ? this._state[2] : Ve) : Ie(r) && (r = n, n = 0), this._state = new Int32Array([
			0,
			0,
			n >>> 0,
			((r || 0) | 1) >>> 0
		]), this._next(), Ye(this._state, this._state[0], this._state[1], e >>> 0, t >>> 0), this._next(), this;
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
		return (e * Ke + t) / Ge;
	}
	_next() {
		let e = this._state[0] >>> 0, t = this._state[1] >>> 0;
		Je(this._state, e, t, Ue, We), Ye(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
		let n = e >>> 18, r = (t >>> 18 | e << 14) >>> 0;
		n = (n ^ e) >>> 0, r = (r ^ t) >>> 0;
		let i = (r >>> 27 | n << 5) >>> 0, a = e >>> 27, o = (-a >>> 0 & 31) >>> 0;
		return (i >>> a | i << o) >>> 0;
	}
};
function Je(e, t, n, r, i) {
	let a = (n >>> 16) * (i & 65535) >>> 0, o = (n & 65535) * (i >>> 16) >>> 0, s = (n & 65535) * (i & 65535) >>> 0, c = (n >>> 16) * (i >>> 16) + ((o >>> 16) + (a >>> 16)) >>> 0;
	o = o << 16 >>> 0, s = s + o >>> 0, s >>> 0 < o >>> 0 && (c = c + 1 >>> 0), a = a << 16 >>> 0, s = s + a >>> 0, s >>> 0 < a >>> 0 && (c = c + 1 >>> 0), c = c + Math.imul(n, r) >>> 0, c = c + Math.imul(t, i) >>> 0, e[0] = c, e[1] = s;
}
function Ye(e, t, n, r, i) {
	let a = t + r >>> 0, o = n + i >>> 0;
	o >>> 0 < n >>> 0 && (a = a + 1 | 0), e[0] = a, e[1] = o;
}
var Xe = /*#__PURE__*/ Symbol.for("effect/Utils/YieldWrap"), Ze = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	[Xe]() {
		return this.#e;
	}
};
function Qe(e) {
	if (typeof e == "object" && e && Xe in e) return e[Xe]();
	throw Error(ze("yieldWrapGet"));
}
var $e = /*#__PURE__*/ C("effect/Utils/isStructuralRegion", () => ({
	enabled: !1,
	tester: void 0
})), et = { effect_internal_function: (e) => e() }, T = /*#__PURE__*/ et.effect_internal_function(() => (/* @__PURE__ */ Error()).stack)?.includes("effect_internal_function") === !0 ? et.effect_internal_function : { effect_internal_function: (e) => {
	try {
		return e();
	} finally {}
} }.effect_internal_function;
(function* () {}).constructor;
// node_modules/effect/dist/esm/Hash.js
var tt = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Hash/randomHashCache"), () => /* @__PURE__ */ new WeakMap()), E = /*#__PURE__*/ Symbol.for("effect/Hash"), D = (e) => {
	if ($e.enabled === !0) return 0;
	switch (typeof e) {
		case "number": return at(e);
		case "bigint": return k(e.toString(10));
		case "boolean": return k(String(e));
		case "symbol": return k(String(e));
		case "string": return k(e);
		case "undefined": return k("undefined");
		case "function":
		case "object": return e === null ? k("null") : e instanceof Date ? Number.isNaN(e.getTime()) ? k("Invalid Date") : D(e.toISOString()) : e instanceof URL ? D(e.href) : it(e) ? e[E]() : nt(e);
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, nt = (e) => (tt.has(e) || tt.set(e, at(Math.floor(Math.random() * (2 ** 53 - 1)))), tt.get(e)), O = (e) => (t) => t * 53 ^ e, rt = (e) => e & 3221225471 | e >>> 1 & 1073741824, it = (e) => w(e, E), at = (e) => {
	if (e !== e || e === Infinity) return 0;
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return rt(t);
}, k = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return rt(t);
}, ot = (e, t) => {
	let n = 12289;
	for (let r = 0; r < t.length; r++) n ^= S(k(t[r]), O(D(e[t[r]])));
	return rt(n);
}, st = (e) => ot(e, Object.keys(e)), ct = (e) => {
	let t = 6151;
	for (let n = 0; n < e.length; n++) t = S(t, O(D(e[n])));
	return rt(t);
}, A = function() {
	if (arguments.length === 1) {
		let e = arguments[0];
		return function(t) {
			return Object.defineProperty(e, E, {
				value() {
					return t;
				},
				enumerable: !1
			}), t;
		};
	}
	let e = arguments[0], t = arguments[1];
	return Object.defineProperty(e, E, {
		value() {
			return t;
		},
		enumerable: !1
	}), t;
}, j = /*#__PURE__*/ Symbol.for("effect/Equal");
function M() {
	return arguments.length === 1 ? (e) => lt(e, arguments[0]) : lt(arguments[0], arguments[1]);
}
function lt(e, t) {
	if (e === t) return !0;
	let n = typeof e;
	if (n !== typeof t) return !1;
	if (n === "object" || n === "function") {
		if (e !== null && t !== null) {
			if (ut(e) && ut(t)) return D(e) === D(t) && e[j](t) ? !0 : $e.enabled && $e.tester ? $e.tester(e, t) : !1;
			if (e instanceof Date && t instanceof Date) {
				let n = e.getTime(), r = t.getTime();
				return n === r || Number.isNaN(n) && Number.isNaN(r);
			}
			if (e instanceof URL && t instanceof URL) return e.href === t.href;
		}
		if ($e.enabled) {
			if (e === null || t === null) return !1;
			if (Array.isArray(e) && Array.isArray(t)) return e.length === t.length && e.every((e, n) => lt(e, t[n]));
			if (Object.getPrototypeOf(e) === Object.prototype && Object.getPrototypeOf(t) === Object.prototype) {
				let n = Object.keys(e), r = Object.keys(t);
				if (n.length === r.length) {
					for (let r of n) if (!(r in t && lt(e[r], t[r]))) return $e.tester ? $e.tester(e, t) : !1;
					return !0;
				}
			}
			return $e.tester ? $e.tester(e, t) : !1;
		}
	}
	return $e.enabled && $e.tester ? $e.tester(e, t) : !1;
}
var ut = (e) => w(e, j), dt = () => M, N = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), P = (e) => {
	try {
		if (w(e, "toJSON") && Me(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(P);
	} catch {
		return {};
	}
	return vt(e);
}, F = (e) => JSON.stringify(e, null, 2), ft = (e, t = 2) => {
	if (typeof e == "string") return e;
	try {
		return typeof e == "object" ? pt(e, t) : String(e);
	} catch {
		return String(e);
	}
}, pt = (e, t) => {
	let n = [], r = JSON.stringify(e, (e, t) => typeof t == "object" && t ? n.includes(t) ? void 0 : n.push(t) && (gt.fiberRefs !== void 0 && ht(t) ? t[mt](gt.fiberRefs) : t) : t, t);
	return n = void 0, r;
}, mt = /*#__PURE__*/ Symbol.for("effect/Inspectable/Redactable"), ht = (e) => typeof e == "object" && !!e && mt in e, gt = /*#__PURE__*/ C("effect/Inspectable/redactableState", () => ({ fiberRefs: void 0 })), _t = (e, t) => {
	let n = gt.fiberRefs;
	gt.fiberRefs = e;
	try {
		return t();
	} finally {
		gt.fiberRefs = n;
	}
}, vt = (e) => ht(e) && gt.fiberRefs !== void 0 ? e[mt](gt.fiberRefs) : e, I = (e, t) => {
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
}, yt = "Async", bt = "Commit", xt = "Failure", St = "OnFailure", Ct = "OnSuccess", wt = "OnSuccessAndFailure", Tt = "Success", Et = "Sync", Dt = "UpdateRuntimeFlags", Ot = "While", kt = "Iterator", At = "WithRuntime", jt = "Yield", Mt = "RevertFlags", Nt = "3.22.2", Pt = () => Nt, Ft = /*#__PURE__*/ Symbol.for("effect/Effect"), It = /*#__PURE__*/ Symbol.for("effect/Stream"), Lt = /*#__PURE__*/ Symbol.for("effect/Sink"), Rt = /*#__PURE__*/ Symbol.for("effect/Channel"), zt = {
	/* c8 ignore next */
	_R: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e,
	_V: /*#__PURE__*/ Pt()
}, Bt = {
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
}, Vt = {
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
}, Ht = {
	[Ft]: zt,
	[It]: zt,
	[Lt]: Bt,
	[Rt]: Vt,
	[j](e) {
		return this === e;
	},
	[E]() {
		return A(this, nt(this));
	},
	[Symbol.iterator]() {
		return new Be(new Ze(this));
	},
	pipe() {
		return I(this, arguments);
	}
}, Ut = {
	[E]() {
		return A(this, st(this));
	},
	[j](e) {
		let t = Object.keys(this), n = Object.keys(e);
		if (t.length !== n.length) return !1;
		for (let n of t) if (!(n in e && M(this[n], e[n]))) return !1;
		return !0;
	}
}, Wt = {
	...Ht,
	_op: bt
}, Gt = {
	...Wt,
	...Ut
}, Kt = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = Wt, e;
}(), qt = /*#__PURE__*/ Symbol.for("effect/Option"), Jt = {
	...Ht,
	[qt]: { _A: (e) => e },
	[N]() {
		return this.toJSON();
	},
	toString() {
		return F(this.toJSON());
	}
}, Yt = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Jt), {
	_tag: "Some",
	_op: "Some",
	[j](e) {
		return Qt(e) && en(e) && M(this.value, e.value);
	},
	[E]() {
		return A(this, O(D(this._tag))(D(this.value)));
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag,
			value: P(this.value)
		};
	}
}), Xt = /*#__PURE__*/ D("None"), Zt = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Jt), {
	_tag: "None",
	_op: "None",
	[j](e) {
		return Qt(e) && $t(e);
	},
	[E]() {
		return Xt;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), Qt = (e) => w(e, qt), $t = (e) => e._tag === "None", en = (e) => e._tag === "Some", tn = /*#__PURE__*/ Object.create(Zt), nn = (e) => {
	let t = Object.create(Yt);
	return t.value = e, t;
}, rn = /*#__PURE__*/ Symbol.for("effect/Either"), an = {
	...Ht,
	[rn]: { _R: (e) => e },
	[N]() {
		return this.toJSON();
	},
	toString() {
		return F(this.toJSON());
	}
}, on = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(an), {
	_tag: "Right",
	_op: "Right",
	[j](e) {
		return cn(e) && un(e) && M(this.right, e.right);
	},
	[E]() {
		return O(D(this._tag))(D(this.right));
	},
	toJSON() {
		return {
			_id: "Either",
			_tag: this._tag,
			right: P(this.right)
		};
	}
}), sn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(an), {
	_tag: "Left",
	_op: "Left",
	[j](e) {
		return cn(e) && ln(e) && M(this.left, e.left);
	},
	[E]() {
		return O(D(this._tag))(D(this.left));
	},
	toJSON() {
		return {
			_id: "Either",
			_tag: this._tag,
			left: P(this.left)
		};
	}
}), cn = (e) => w(e, rn), ln = (e) => e._tag === "Left", un = (e) => e._tag === "Right", dn = (e) => {
	let t = Object.create(sn);
	return t.left = e, t;
}, fn = (e) => {
	let t = Object.create(on);
	return t.right = e, t;
}, pn = dn, mn = ln, hn = un, gn = /*#__PURE__*/ (/* @__PURE__ */ b(2, (e, { onLeft: t, onRight: n }) => mn(e) ? t(e.left) : n(e.right)))({
	onLeft: x,
	onRight: x
}), _n = (e) => e.length > 0, vn = (e) => (t, n) => t === n ? 0 : e(t, n), yn = /*#__PURE__*/ vn((e, t) => e < t ? -1 : 1), bn = /*#__PURE__*/ b(2, (e, t) => vn((n, r) => e(t(n), t(r)))), xn = (e) => b(2, (t, n) => e(t, n) === 1), L = () => tn, R = nn, Sn = $t, Cn = en, wn = /*#__PURE__*/ b(2, (e, { onNone: t, onSome: n }) => Sn(e) ? t() : n(e.value)), Tn = /*#__PURE__*/ b(2, (e, t) => Sn(e) ? t() : e.value), En = /*#__PURE__*/ b(2, (e, t) => Sn(e) ? R(t()) : e), Dn = (e) => e == null ? L() : R(e), On = /*#__PURE__*/ Tn(Se), kn = /*#__PURE__*/ b(2, (e, t) => Sn(e) ? L() : R(t(e.value))), An = /*#__PURE__*/ b(2, (e, t) => Sn(e) ? L() : t(e.value)), jn = /*#__PURE__*/ ((e) => b(2, (t, n) => !Sn(t) && e(t.value, n)))(/* @__PURE__ */ dt()), Mn = (...e) => e, Nn = (e) => Array(e), Pn = /*#__PURE__*/ b(2, (e, t) => {
	let n = Math.max(1, Math.floor(e)), r = Array(n);
	for (let e = 0; e < n; e++) r[e] = t(e);
	return r;
}), z = (e) => Array.isArray(e) ? e : Array.from(e), Fn = (e) => Array.isArray(e) ? e : [e], In = /*#__PURE__*/ b(2, (e, t) => [t, ...e]), Ln = /*#__PURE__*/ b(2, (e, t) => [...e, t]), Rn = /*#__PURE__*/ b(2, (e, t) => z(e).concat(z(t)));
Array.isArray;
var zn = (e) => e.length === 0, Bn = _n, Vn = _n, Hn = (e, t) => e < 0 || e >= t.length, Un = (e, t) => Math.floor(Math.min(Math.max(0, e), t.length)), Wn = /*#__PURE__*/ b(2, (e, t) => {
	let n = Math.floor(t);
	return Hn(n, e) ? L() : R(e[n]);
}), Gn = /*#__PURE__*/ b(2, (e, t) => {
	let n = Math.floor(t);
	if (Hn(n, e)) throw Error(`Index ${n} out of bounds`);
	return e[n];
}), Kn = /*#__PURE__*/ Wn(0), qn = /*#__PURE__*/ Gn(0), Jn = (e) => Vn(e) ? R(Yn(e)) : L(), Yn = (e) => e[e.length - 1], Xn = (e) => e.slice(1), Zn = (e, t) => {
	let n = 0;
	for (let r of e) {
		if (!t(r, n)) break;
		n++;
	}
	return n;
}, Qn = /*#__PURE__*/ b(2, (e, t) => ar(e, Zn(e, t))), $n = /*#__PURE__*/ b(2, (e, t) => {
	let n = z(e);
	return n.slice(Un(t, n), n.length);
}), er = (e) => Array.from(e).reverse(), tr = /*#__PURE__*/ b(2, (e, t) => {
	let n = Array.from(e);
	return n.sort(t), n;
}), nr = /*#__PURE__*/ b(2, (e, t) => rr(e, t, Mn)), rr = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = z(e), i = z(t);
	if (Vn(r) && Vn(i)) {
		let e = [n(qn(r), qn(i))], t = Math.min(r.length, i.length);
		for (let a = 1; a < t; a++) e[a] = n(r[a], i[a]);
		return e;
	}
	return [];
}), ir = /*#__PURE__*/ dt(), ar = /*#__PURE__*/ b(2, (e, t) => {
	let n = Array.from(e), r = Math.floor(t);
	return Vn(n) ? r >= 1 ? or(n, r) : [[], n] : [n, []];
}), or = /*#__PURE__*/ b(2, (e, t) => {
	let n = Math.max(1, Math.floor(t));
	return n >= e.length ? [sr(e), []] : [In(e.slice(1, n), qn(e)), e.slice(n)];
}), sr = (e) => e.slice(), cr = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = z(e), i = z(t);
	return Vn(r) ? Vn(i) ? _r(n)(Rn(r, i)) : r : i;
}), lr = /*#__PURE__*/ b(2, (e, t) => cr(e, t, ir)), ur = () => [], dr = (e) => [e], fr = /*#__PURE__*/ b(2, (e, t) => e.map(t)), pr = /*#__PURE__*/ (/* @__PURE__ */ b(2, (e, t) => {
	if (zn(e)) return [];
	let n = [];
	for (let r = 0; r < e.length; r++) {
		let i = t(e[r], r);
		for (let e = 0; e < i.length; e++) n.push(i[e]);
	}
	return n;
}))(x), mr = /*#__PURE__*/ b(3, (e, t, n) => z(e).reduce((e, t, r) => n(e, t, r), t)), hr = (e, t) => {
	let n = [], r = e, i;
	for (; Cn(i = t(r));) {
		let [e, t] = i.value;
		n.push(e), r = t;
	}
	return n;
}, gr = Ee, _r = /*#__PURE__*/ b(2, (e, t) => {
	let n = z(e);
	if (Vn(n)) {
		let e = [qn(n)], r = Xn(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), vr = (e) => _r(e, dt()), yr = /*#__PURE__*/ b(2, (e, t) => z(e).join(t)), br = yn, xr = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"), Sr = /*#__PURE__*/ Symbol.for("effect/Context/Tag"), Cr = /*#__PURE__*/ Symbol.for("effect/Context/Reference"), wr = /*#__PURE__*/ Symbol.for("effect/STM"), Tr = {
	...Ht,
	_op: "Tag",
	[wr]: zt,
	[Sr]: {
		_Service: (e) => e,
		_Identifier: (e) => e
	},
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Tag",
			key: this.key,
			stack: this.stack
		};
	},
	[N]() {
		return this.toJSON();
	},
	of(e) {
		return e;
	},
	context(e) {
		return zr(this, e);
	}
}, Er = {
	...Tr,
	[Cr]: Cr
}, Dr = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	let r = Object.create(Tr);
	return Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r.key = e, r;
}, Or = (e) => () => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	function r() {}
	return Object.setPrototypeOf(r, Tr), r.key = e, Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r;
}, kr = () => (e, t) => {
	let n = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let r = /* @__PURE__ */ Error();
	Error.stackTraceLimit = n;
	function i() {}
	return Object.setPrototypeOf(i, Er), i.key = e, i.defaultValue = t.defaultValue, Object.defineProperty(i, "stack", { get() {
		return r.stack;
	} }), i;
}, Ar = /*#__PURE__*/ Symbol.for("effect/Context"), jr = {
	[Ar]: { _Services: (e) => e },
	[j](e) {
		if (Pr(e) && this.unsafeMap.size === e.unsafeMap.size) {
			for (let t of this.unsafeMap.keys()) if (!e.unsafeMap.has(t) || !M(this.unsafeMap.get(t), e.unsafeMap.get(t))) return !1;
			return !0;
		}
		return !1;
	},
	[E]() {
		return A(this, at(this.unsafeMap.size));
	},
	pipe() {
		return I(this, arguments);
	},
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Context",
			services: Array.from(this.unsafeMap).map(P)
		};
	},
	[N]() {
		return this.toJSON();
	}
}, Mr = (e) => {
	let t = Object.create(jr);
	return t.unsafeMap = e, t;
}, Nr = (e) => {
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
}, Pr = (e) => w(e, Ar), Fr = (e) => w(e, Sr), Ir = (e) => w(e, Cr), Lr = /*#__PURE__*/ Mr(/*#__PURE__*/ new Map()), Rr = () => Lr, zr = (e, t) => Mr(/* @__PURE__ */ new Map([[e.key, t]])), Br = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = new Map(e.unsafeMap);
	return r.set(t.key, n), Mr(r);
}), Vr = /*#__PURE__*/ C("effect/Context/defaultValueCache", () => /* @__PURE__ */ new Map()), Hr = (e) => {
	if (Vr.has(e.key)) return Vr.get(e.key);
	let t = e.defaultValue();
	return Vr.set(e.key, t), t;
}, Ur = (e, t) => e.unsafeMap.has(t.key) ? e.unsafeMap.get(t.key) : Hr(t), Wr = /*#__PURE__*/ b(2, (e, t) => {
	if (!e.unsafeMap.has(t.key)) {
		if (Cr in t) return Hr(t);
		throw Nr(t);
	}
	return e.unsafeMap.get(t.key);
}), Gr = Wr, Kr = /*#__PURE__*/ b(2, (e, t) => e.unsafeMap.has(t.key) ? nn(e.unsafeMap.get(t.key)) : Ir(t) ? nn(Hr(t)) : tn), qr = /*#__PURE__*/ b(2, (e, t) => {
	let n = new Map(e.unsafeMap);
	for (let [e, r] of t.unsafeMap) n.set(e, r);
	return Mr(n);
}), Jr = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n = 0; n < e.length; n++) e[n].unsafeMap.forEach((e, n) => {
		t.set(n, e);
	});
	return Mr(t);
}, Yr = Dr, Xr = Pr, Zr = Fr, Qr = Rr, $r = zr, ei = Br, ti = Gr, ni = Wr, ri = Kr, ii = qr, ai = Jr, oi = Or, si = kr, ci = /*#__PURE__*/ Symbol.for("effect/Chunk");
function li(e, t, n, r, i) {
	for (let a = t; a < Math.min(e.length, t + i); a++) n[r + a - t] = e[a];
	return n;
}
var ui = [], di = /*#__PURE__*/ ((e) => we((t, n) => t.length === n.length && bi(t).every((t, r) => e(t, Ti(n, r)))))(M), fi = {
	[ci]: { _A: (e) => e },
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Chunk",
			values: bi(this).map(P)
		};
	},
	[N]() {
		return this.toJSON();
	},
	[j](e) {
		return pi(e) && di(this, e);
	},
	[E]() {
		return A(this, ct(bi(this)));
	},
	[Symbol.iterator]() {
		switch (this.backing._tag) {
			case "IArray": return this.backing.array[Symbol.iterator]();
			case "IEmpty": return ui[Symbol.iterator]();
			default: return bi(this)[Symbol.iterator]();
		}
	},
	pipe() {
		return I(this, arguments);
	}
}, B = (e) => {
	let t = Object.create(fi);
	switch (t.backing = e, e._tag) {
		case "IEmpty":
			t.length = 0, t.depth = 0, t.left = t, t.right = t;
			break;
		case "IConcat":
			t.length = e.left.length + e.right.length, t.depth = 1 + Math.max(e.left.depth, e.right.depth), t.left = e.left, t.right = e.right;
			break;
		case "IArray":
			t.length = e.array.length, t.depth = 0, t.left = mi, t.right = mi;
			break;
		case "ISingleton":
			t.length = 1, t.depth = 0, t.left = mi, t.right = mi;
			break;
		case "ISlice": t.length = e.length, t.depth = e.chunk.depth + 1, t.left = mi, t.right = mi;
	}
	return t;
}, pi = (e) => w(e, ci), mi = /*#__PURE__*/ B({ _tag: "IEmpty" }), hi = () => mi, gi = (...e) => wi(e), _i = (e) => B({
	_tag: "ISingleton",
	a: e
}), vi = (e) => pi(e) ? e : Ci(z(e)), yi = (e, t, n) => {
	switch (e.backing._tag) {
		case "IArray":
			li(e.backing.array, 0, t, n, e.length);
			break;
		case "IConcat":
			yi(e.left, t, n), yi(e.right, t, n + e.left.length);
			break;
		case "ISingleton":
			t[n] = e.backing.a;
			break;
		case "ISlice": {
			let r = 0, i = n;
			for (; r < e.length;) t[i] = Ti(e, r), r += 1, i += 1;
			break;
		}
	}
}, bi = (e) => {
	switch (e.backing._tag) {
		case "IEmpty": return ui;
		case "IArray": return e.backing.array;
		default: {
			let t = Array(e.length);
			return yi(e, t, 0), e.backing = {
				_tag: "IArray",
				array: t
			}, e.left = mi, e.right = mi, e.depth = 0, t;
		}
	}
}, xi = (e) => {
	switch (e.backing._tag) {
		case "IEmpty":
		case "ISingleton": return e;
		case "IArray": return B({
			_tag: "IArray",
			array: er(e.backing.array)
		});
		case "IConcat": return B({
			_tag: "IConcat",
			left: xi(e.backing.right),
			right: xi(e.backing.left)
		});
		case "ISlice": return Ci(er(bi(e)));
	}
}, Si = /*#__PURE__*/ b(2, (e, t) => t < 0 || t >= e.length ? L() : R(Ti(e, t))), Ci = (e) => e.length === 0 ? hi() : e.length === 1 ? _i(e[0]) : B({
	_tag: "IArray",
	array: e
}), wi = (e) => Ci(e), Ti = /*#__PURE__*/ b(2, (e, t) => {
	switch (e.backing._tag) {
		case "IEmpty": throw Error("Index out of bounds");
		case "ISingleton":
			if (t !== 0) throw Error("Index out of bounds");
			return e.backing.a;
		case "IArray":
			if (t >= e.length || t < 0) throw Error("Index out of bounds");
			return e.backing.array[t];
		case "IConcat": return t < e.left.length ? Ti(e.left, t) : Ti(e.right, t - e.left.length);
		case "ISlice": return Ti(e.backing.chunk, t + e.backing.offset);
	}
}), Ei = /*#__PURE__*/ b(2, (e, t) => ki(e, _i(t))), Di = /*#__PURE__*/ b(2, (e, t) => ki(_i(t), e)), Oi = /*#__PURE__*/ b(2, (e, t) => {
	if (t <= 0) return e;
	if (t >= e.length) return mi;
	switch (e.backing._tag) {
		case "ISlice": return B({
			_tag: "ISlice",
			chunk: e.backing.chunk,
			offset: e.backing.offset + t,
			length: e.backing.length - t
		});
		case "IConcat": return t > e.left.length ? Oi(e.right, t - e.left.length) : B({
			_tag: "IConcat",
			left: Oi(e.left, t),
			right: e.right
		});
		default: return B({
			_tag: "ISlice",
			chunk: e,
			offset: t,
			length: e.length - t
		});
	}
}), ki = /*#__PURE__*/ b(2, (e, t) => {
	if (e.backing._tag === "IEmpty") return t;
	if (t.backing._tag === "IEmpty") return e;
	let n = t.depth - e.depth;
	if (Math.abs(n) <= 1) return B({
		_tag: "IConcat",
		left: e,
		right: t
	});
	if (n < -1) {
		if (e.left.depth >= e.right.depth) {
			let n = ki(e.right, t);
			return B({
				_tag: "IConcat",
				left: e.left,
				right: n
			});
		}
		{
			let n = ki(e.right.right, t);
			if (n.depth === e.depth - 3) {
				let t = B({
					_tag: "IConcat",
					left: e.right.left,
					right: n
				});
				return B({
					_tag: "IConcat",
					left: e.left,
					right: t
				});
			}
			return B({
				_tag: "IConcat",
				left: B({
					_tag: "IConcat",
					left: e.left,
					right: e.right.left
				}),
				right: n
			});
		}
	}
	if (t.right.depth >= t.left.depth) return B({
		_tag: "IConcat",
		left: ki(e, t.left),
		right: t.right
	});
	{
		let n = ki(e, t.left.left);
		return n.depth === t.depth - 3 ? B({
			_tag: "IConcat",
			left: B({
				_tag: "IConcat",
				left: n,
				right: t.left.right
			}),
			right: t.right
		}) : B({
			_tag: "IConcat",
			left: n,
			right: B({
				_tag: "IConcat",
				left: t.left.right,
				right: t.right
			})
		});
	}
}), Ai = (e) => e.length === 0, ji = (e) => e.length > 0, Mi = /*#__PURE__*/ Si(0), Ni = (e) => Ti(e, 0), Pi = Ni, Fi = (e) => Oi(e, 1), Ii = /*#__PURE__*/ Symbol.for("effect/Duration"), Li = /*#__PURE__*/ BigInt(0), Ri = /*#__PURE__*/ BigInt(24), zi = /*#__PURE__*/ BigInt(60), Bi = /*#__PURE__*/ BigInt(1e3), Vi = /*#__PURE__*/ BigInt(1e6), Hi = /*#__PURE__*/ BigInt(1e9), Ui = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Wi = (e) => {
	if (Yi(e)) return e;
	if (Ae(e)) return ta(e);
	if (je(e)) return $i(e);
	if (Array.isArray(e) && e.length === 2 && e.every(Ae)) return e[0] === -Infinity || e[1] === -Infinity || Number.isNaN(e[0]) || Number.isNaN(e[1]) ? Zi : e[0] === Infinity || e[1] === Infinity ? Qi : $i(BigInt(Math.round(e[0] * 1e9)) + BigInt(Math.round(e[1])));
	if (ke(e)) {
		let t = Ui.exec(e);
		if (t) {
			let [e, n, r] = t, i = Number(n);
			switch (r) {
				case "nano":
				case "nanos": return $i(BigInt(n));
				case "micro":
				case "micros": return ea(BigInt(n));
				case "milli":
				case "millis": return ta(i);
				case "second":
				case "seconds": return na(i);
				case "minute":
				case "minutes": return ra(i);
				case "hour":
				case "hours": return ia(i);
				case "day":
				case "days": return aa(i);
				case "week":
				case "weeks": return oa(i);
			}
		}
	}
	throw Error("Invalid DurationInput");
}, Gi = {
	_tag: "Millis",
	millis: 0
}, Ki = { _tag: "Infinity" }, qi = {
	[Ii]: Ii,
	[E]() {
		return A(this, st(this.value));
	},
	[j](e) {
		return Yi(e) && ha(this, e);
	},
	toString() {
		return `Duration(${_a(this)})`;
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
				hrtime: la(this)
			};
			case "Infinity": return {
				_id: "Duration",
				_tag: "Infinity"
			};
		}
	},
	[N]() {
		return this.toJSON();
	},
	pipe() {
		return I(this, arguments);
	}
}, Ji = (e) => {
	let t = Object.create(qi);
	return t.value = Ae(e) ? isNaN(e) || e <= 0 ? Gi : Number.isFinite(e) ? Number.isInteger(e) ? {
		_tag: "Millis",
		millis: e
	} : {
		_tag: "Nanos",
		nanos: BigInt(Math.round(e * 1e6))
	} : Ki : e <= Li ? Gi : {
		_tag: "Nanos",
		nanos: e
	}, t;
}, Yi = (e) => w(e, Ii), Xi = (e) => {
	switch (e.value._tag) {
		case "Millis": return e.value.millis === 0;
		case "Nanos": return e.value.nanos === Li;
		case "Infinity": return !1;
	}
}, Zi = /*#__PURE__*/ Ji(0), Qi = /*#__PURE__*/ Ji(Infinity), $i = (e) => Ji(e), ea = (e) => Ji(e * Bi), ta = (e) => Ji(e), na = (e) => Ji(e * 1e3), ra = (e) => Ji(e * 6e4), ia = (e) => Ji(e * 36e5), aa = (e) => Ji(e * 864e5), oa = (e) => Ji(e * 6048e5), sa = (e) => ua(e, {
	onMillis: (e) => e,
	onNanos: (e) => Number(e) / 1e6
}), ca = (e) => {
	let t = Wi(e);
	switch (t.value._tag) {
		case "Infinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return BigInt(Math.round(t.value.millis * 1e6));
	}
}, la = (e) => {
	let t = Wi(e);
	switch (t.value._tag) {
		case "Infinity": return [Infinity, 0];
		case "Nanos": return [Number(t.value.nanos / Hi), Number(t.value.nanos % Hi)];
		case "Millis": return [Math.floor(t.value.millis / 1e3), Math.round(t.value.millis % 1e3 * 1e6)];
	}
}, ua = /*#__PURE__*/ b(2, (e, t) => {
	let n = Wi(e);
	switch (n.value._tag) {
		case "Nanos": return t.onNanos(n.value.nanos);
		case "Infinity": return t.onMillis(Infinity);
		case "Millis": return t.onMillis(n.value.millis);
	}
}), da = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = Wi(e), i = Wi(t);
	if (r.value._tag === "Infinity" || i.value._tag === "Infinity") return n.onMillis(sa(r), sa(i));
	if (r.value._tag === "Nanos" || i.value._tag === "Nanos") {
		let e = r.value._tag === "Nanos" ? r.value.nanos : BigInt(Math.round(r.value.millis * 1e6)), t = i.value._tag === "Nanos" ? i.value.nanos : BigInt(Math.round(i.value.millis * 1e6));
		return n.onNanos(e, t);
	}
	return n.onMillis(r.value.millis, i.value.millis);
}), fa = (e, t) => da(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t
}), pa = /*#__PURE__*/ b(2, (e, t) => da(e, t, {
	onMillis: (e, t) => e <= t,
	onNanos: (e, t) => e <= t
})), ma = /*#__PURE__*/ b(2, (e, t) => da(e, t, {
	onMillis: (e, t) => e >= t,
	onNanos: (e, t) => e >= t
})), ha = /*#__PURE__*/ b(2, (e, t) => fa(Wi(e), Wi(t))), ga = (e) => {
	let t = Wi(e);
	if (t.value._tag === "Infinity") return {
		days: Infinity,
		hours: Infinity,
		minutes: Infinity,
		seconds: Infinity,
		millis: Infinity,
		nanos: Infinity
	};
	let n = ca(t), r = n / Vi, i = r / Bi, a = i / zi, o = a / zi, s = o / Ri;
	return {
		days: Number(s),
		hours: Number(o % Ri),
		minutes: Number(a % zi),
		seconds: Number(i % zi),
		millis: Number(r % Bi),
		nanos: Number(n % Vi)
	};
}, _a = (e) => {
	let t = Wi(e);
	if (t.value._tag === "Infinity") return "Infinity";
	if (Xi(t)) return "0";
	let n = ga(t), r = [];
	return n.days !== 0 && r.push(`${n.days}d`), n.hours !== 0 && r.push(`${n.hours}h`), n.minutes !== 0 && r.push(`${n.minutes}m`), n.seconds !== 0 && r.push(`${n.seconds}s`), n.millis !== 0 && r.push(`${n.millis}ms`), n.nanos !== 0 && r.push(`${n.nanos}ns`), r.join(" ");
}, va = 32, ya = va - 1, ba = va / 2, xa = va / 4;
// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function Sa(e) {
	return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), e = e + (e >> 4) & 252645135, e += e >> 8, e += e >> 16, e & 127;
}
function Ca(e, t) {
	return t >>> e & ya;
}
function wa(e) {
	return 1 << e;
}
function Ta(e, t) {
	return Sa(e & t - 1);
}
// node_modules/effect/dist/esm/internal/stack.js
var Ea = (e, t) => ({
	value: e,
	previous: t
});
// node_modules/effect/dist/esm/internal/hashMap/array.js
function Da(e, t, n, r) {
	let i = r;
	if (!e) {
		let e = r.length;
		i = Array(e);
		for (let t = 0; t < e; ++t) i[t] = r[t];
	}
	return i[t] = n, i;
}
function Oa(e, t, n) {
	let r = n.length - 1, i = 0, a = 0, o = n;
	if (e) i = a = t;
	else for (o = Array(r); i < t;) o[a++] = n[i++];
	for (++i; i <= r;) o[a++] = n[i++];
	return e && (o.length = r), o;
}
function ka(e, t, n, r) {
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
var Aa = class e {
	_tag = "EmptyNode";
	modify(t, n, r, i, a, o) {
		let s = r(L());
		return Sn(s) ? new e() : (++o.value, new Pa(t, i, a, s));
	}
};
function ja(e) {
	return Fe(e, "EmptyNode");
}
function Ma(e) {
	return ja(e) || e._tag === "LeafNode" || e._tag === "CollisionNode";
}
function Na(e, t) {
	return !ja(e) && t === e.edit;
}
var Pa = class e {
	edit;
	hash;
	key;
	value;
	_tag = "LeafNode";
	constructor(e, t, n, r) {
		this.edit = e, this.hash = t, this.key = n, this.value = r;
	}
	modify(t, n, r, i, a, o) {
		if (M(a, this.key)) {
			let n = r(this.value);
			return n === this.value ? this : Sn(n) ? (--o.value, new Aa()) : Na(this, t) ? (this.value = n, this) : new e(t, i, a, n);
		}
		let s = r(L());
		return Sn(s) ? this : (++o.value, Va(t, n, this.hash, this, i, new e(t, i, a, s)));
	}
}, Fa = class e {
	edit;
	hash;
	children;
	_tag = "CollisionNode";
	constructor(e, t, n) {
		this.edit = e, this.hash = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		if (i === this.hash) {
			let n = Na(this, t), i = this.updateCollisionList(n, t, this.hash, this.children, r, a, o);
			return i === this.children ? this : i.length > 1 ? new e(t, this.hash, i) : i[0];
		}
		let s = r(L());
		return Sn(s) ? this : (++o.value, Va(t, n, this.hash, this, i, new Pa(t, i, a, s)));
	}
	updateCollisionList(e, t, n, r, i, a, o) {
		let s = r.length;
		for (let c = 0; c < s; ++c) {
			let s = r[c];
			if ("key" in s && M(a, s.key)) {
				let l = s.value, u = i(l);
				return u === l ? r : Sn(u) ? (--o.value, Oa(e, c, r)) : Da(e, c, new Pa(t, n, a, u), r);
			}
		}
		let c = i(L());
		return Sn(c) ? r : (++o.value, Da(e, s, new Pa(t, n, a, c), r));
	}
}, Ia = class e {
	edit;
	mask;
	children;
	_tag = "IndexedNode";
	constructor(e, t, n) {
		this.edit = e, this.mask = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.mask, c = this.children, l = Ca(n, i), u = wa(l), d = Ta(s, u), f = s & u, p = Na(this, t);
		if (!f) {
			let f = new Aa().modify(t, n + 5, r, i, a, o);
			return f ? c.length >= ba ? za(t, l, f, s, c) : new e(t, s | u, ka(p, d, f, c)) : this;
		}
		let m = c[d], h = m.modify(t, n + 5, r, i, a, o);
		if (m === h) return this;
		let ee = s, te;
		if (ja(h)) {
			if (ee &= ~u, !ee) return new Aa();
			if (c.length <= 2 && Ma(c[d ^ 1])) return c[d ^ 1];
			te = Oa(p, d, c);
		} else te = Da(p, d, h, c);
		return p ? (this.mask = ee, this.children = te, this) : new e(t, ee, te);
	}
}, La = class e {
	edit;
	size;
	children;
	_tag = "ArrayNode";
	constructor(e, t, n) {
		this.edit = e, this.size = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.size, c = this.children, l = Ca(n, i), u = c[l], d = (u || new Aa()).modify(t, n + 5, r, i, a, o);
		if (u === d) return this;
		let f = Na(this, t), p;
		if (ja(u) && !ja(d)) ++s, p = Da(f, l, d, c);
		else if (!ja(u) && ja(d)) {
			if (--s, s <= xa) return Ra(t, s, l, c);
			p = Da(f, l, new Aa(), c);
		} else p = Da(f, l, d, c);
		return f ? (this.size = s, this.children = p, this) : new e(t, s, p);
	}
};
function Ra(e, t, n, r) {
	let i = Array(t - 1), a = 0, o = 0;
	for (let e = 0, t = r.length; e < t; ++e) if (e !== n) {
		let t = r[e];
		t && !ja(t) && (i[a++] = t, o |= 1 << e);
	}
	return new Ia(e, o, i);
}
function za(e, t, n, r, i) {
	let a = [], o = r, s = 0;
	for (let e = 0; o; ++e) o & 1 && (a[e] = i[s++]), o >>>= 1;
	return a[t] = n, new La(e, s + 1, a);
}
function Ba(e, t, n, r, i, a) {
	if (n === i) return new Fa(e, n, [a, r]);
	let o = Ca(t, n), s = Ca(t, i);
	if (o === s) return (t) => new Ia(e, wa(o) | wa(s), [t]);
	{
		let t = o < s ? [r, a] : [a, r];
		return new Ia(e, wa(o) | wa(s), t);
	}
}
function Va(e, t, n, r, i, a) {
	let o, s = t;
	for (;;) {
		let t = Ba(e, s, n, r, i, a);
		if (typeof t == "function") o = Ea(t, o), s += 5;
		else {
			let e = t;
			for (; o != null;) e = o.value(e), o = o.previous;
			return e;
		}
	}
}
// node_modules/effect/dist/esm/internal/hashMap.js
var Ha = "effect/HashMap", Ua = /*#__PURE__*/ Symbol.for(Ha), Wa = {
	[Ua]: Ua,
	[Symbol.iterator]() {
		return new Ka(this, (e, t) => [e, t]);
	},
	[E]() {
		let e = D(Ha);
		for (let t of this) e ^= S(D(t[0]), O(D(t[1])));
		return A(this, e);
	},
	[j](e) {
		if ($a(e)) {
			if (e._size !== this._size) return !1;
			for (let t of this) {
				let n = S(e, no(t[0], D(t[0])));
				if (Sn(n) || !M(t[1], n.value)) return !1;
			}
			return !0;
		}
		return !1;
	},
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "HashMap",
			values: Array.from(this).map(P)
		};
	},
	[N]() {
		return this.toJSON();
	},
	pipe() {
		return I(this, arguments);
	}
}, Ga = (e, t, n, r) => {
	let i = Object.create(Wa);
	return i._editable = e, i._edit = t, i._root = n, i._size = r, i;
}, Ka = class e {
	map;
	f;
	v;
	constructor(e, t) {
		this.map = e, this.f = t, this.v = Ja(this.map._root, this.f, void 0);
	}
	next() {
		if (Sn(this.v)) return {
			done: !0,
			value: void 0
		};
		let e = this.v.value;
		return this.v = qa(e.cont), {
			done: !1,
			value: e.value
		};
	}
	[Symbol.iterator]() {
		return new e(this.map, this.f);
	}
}, qa = (e) => e ? Ya(e[0], e[1], e[2], e[3], e[4]) : L(), Ja = (e, t, n = void 0) => {
	switch (e._tag) {
		case "LeafNode": return Cn(e.value) ? R({
			value: t(e.key, e.value.value),
			cont: n
		}) : qa(n);
		case "CollisionNode":
		case "ArrayNode":
		case "IndexedNode": {
			let r = e.children;
			return Ya(r.length, r, 0, t, n);
		}
		default: return qa(n);
	}
}, Ya = (e, t, n, r, i) => {
	for (; n < e;) {
		let a = t[n++];
		if (a && !ja(a)) return Ja(a, r, [
			e,
			t,
			n,
			r,
			i
		]);
	}
	return qa(i);
}, Xa = /*#__PURE__*/ Ga(!1, 0, /*#__PURE__*/ new Aa(), 0), Za = () => Xa, Qa = (e) => {
	let t = co(Za());
	for (let n of e) io(t, n[0], n[1]);
	return lo(t);
}, $a = (e) => w(e, Ua), eo = (e) => e && ja(e._root), to = /*#__PURE__*/ b(2, (e, t) => no(e, t, D(t))), no = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = e._root, i = 0;
	for (;;) switch (r._tag) {
		case "LeafNode": return M(t, r.key) ? r.value : L();
		case "CollisionNode":
			if (n === r.hash) {
				let e = r.children;
				for (let n = 0, r = e.length; n < r; ++n) {
					let r = e[n];
					if ("key" in r && M(t, r.key)) return r.value;
				}
			}
			return L();
		case "IndexedNode": {
			let e = wa(Ca(i, n));
			if (r.mask & e) {
				r = r.children[Ta(r.mask, e)], i += 5;
				break;
			}
			return L();
		}
		case "ArrayNode":
			if (r = r.children[Ca(i, n)], r) {
				i += 5;
				break;
			}
			return L();
		default: return L();
	}
}), ro = /*#__PURE__*/ b(2, (e, t) => Cn(no(e, t, D(t)))), io = /*#__PURE__*/ b(3, (e, t, n) => uo(e, t, () => R(n))), ao = /*#__PURE__*/ b(3, (e, t, n) => e._editable ? (e._root = t, e._size = n, e) : t === e._root ? e : Ga(e._editable, e._edit, t, n)), oo = (e) => new Ka(e, (e) => e), so = (e) => e._size, co = (e) => Ga(!0, e._edit + 1, e._root, e._size), lo = (e) => (e._editable = !1, e), uo = /*#__PURE__*/ b(3, (e, t, n) => fo(e, t, D(t), n)), fo = /*#__PURE__*/ b(4, (e, t, n, r) => {
	let i = { value: e._size };
	return S(e, ao(e._root.modify(e._editable ? e._edit : NaN, 0, r, n, t, i), i.value));
}), po = /*#__PURE__*/ b(2, (e, t) => uo(e, t, L)), mo = /*#__PURE__*/ b(2, (e, t) => go(e, Za(), (e, n, r) => io(e, r, t(n, r)))), ho = /*#__PURE__*/ b(2, (e, t) => go(e, void 0, (e, n, r) => t(n, r))), go = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = e._root;
	if (r._tag === "LeafNode") return Cn(r.value) ? n(t, r.value.value, r.key) : t;
	if (r._tag === "EmptyNode") return t;
	let i = [r.children], a;
	for (; a = i.pop();) for (let e = 0, r = a.length; e < r;) {
		let r = a[e++];
		r && !ja(r) && (r._tag === "LeafNode" ? Cn(r.value) && (t = n(t, r.value.value, r.key)) : i.push(r.children));
	}
	return t;
}), _o = "effect/HashSet", vo = /*#__PURE__*/ Symbol.for(_o), yo = {
	[vo]: vo,
	[Symbol.iterator]() {
		return oo(this._keyMap);
	},
	[E]() {
		return A(this, O(D(this._keyMap))(D(_o)));
	},
	[j](e) {
		return xo(e) ? so(this._keyMap) === so(e._keyMap) && M(this._keyMap, e._keyMap) : !1;
	},
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "HashSet",
			values: Array.from(this).map(P)
		};
	},
	[N]() {
		return this.toJSON();
	},
	pipe() {
		return I(this, arguments);
	}
}, bo = (e) => {
	let t = Object.create(yo);
	return t._keyMap = e, t;
}, xo = (e) => w(e, vo), So = /*#__PURE__*/ bo(/*#__PURE__*/ Za()), Co = () => So, wo = (e) => {
	let t = Oo(Co());
	for (let n of e) jo(t, n);
	return ko(t);
}, To = (...e) => {
	let t = Oo(Co());
	for (let n of e) jo(t, n);
	return ko(t);
}, Eo = /*#__PURE__*/ b(2, (e, t) => ro(e._keyMap, t)), Do = (e) => so(e._keyMap), Oo = (e) => bo(co(e._keyMap)), ko = (e) => (e._keyMap._editable = !1, e), Ao = /*#__PURE__*/ b(2, (e, t) => {
	let n = Oo(e);
	return t(n), ko(n);
}), jo = /*#__PURE__*/ b(2, (e, t) => e._keyMap._editable ? (io(t, !0)(e._keyMap), e) : bo(io(t, !0)(e._keyMap))), Mo = /*#__PURE__*/ b(2, (e, t) => e._keyMap._editable ? (po(t)(e._keyMap), e) : bo(po(t)(e._keyMap))), No = /*#__PURE__*/ b(2, (e, t) => Ao(e, (e) => {
	for (let n of t) Mo(e, n);
})), Po = /*#__PURE__*/ b(2, (e, t) => Ao(Co(), (n) => {
	Fo(e, (e) => jo(n, e));
	for (let e of t) jo(n, e);
})), Fo = /*#__PURE__*/ b(2, (e, t) => ho(e._keyMap, (e, n) => t(n))), Io = /*#__PURE__*/ b(3, (e, t, n) => go(e._keyMap, t, (e, t, r) => n(e, r))), Lo = Co, Ro = wo, zo = To, Bo = Eo, Vo = Do, Ho = jo, Uo = Mo, Wo = No, Go = Po, Ko = Io, qo = /*#__PURE__*/ Symbol.for("effect/MutableRef"), Jo = {
	[qo]: qo,
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "MutableRef",
			current: P(this.current)
		};
	},
	[N]() {
		return this.toJSON();
	},
	pipe() {
		return I(this, arguments);
	}
}, Yo = (e) => {
	let t = Object.create(Jo);
	return t.current = e, t;
}, Xo = (e) => e.current, Zo = /*#__PURE__*/ b(2, (e, t) => (e.current = t, e)), Qo = "effect/FiberId", $o = /*#__PURE__*/ Symbol.for(Qo), es = "None", ts = "Runtime", ns = "Composite", rs = /*#__PURE__*/ k(`${Qo}-${es}`), is = class {
	[$o] = $o;
	_tag = es;
	id = -1;
	startTimeMillis = -1;
	[E]() {
		return rs;
	}
	[j](e) {
		return ss(e) && e._tag === es;
	}
	toString() {
		return F(this.toJSON());
	}
	toJSON() {
		return {
			_id: "FiberId",
			_tag: this._tag
		};
	}
	[N]() {
		return this.toJSON();
	}
}, as = class {
	id;
	startTimeMillis;
	[$o] = $o;
	_tag = ts;
	constructor(e, t) {
		this.id = e, this.startTimeMillis = t;
	}
	[E]() {
		return A(this, k(`${Qo}-${this._tag}-${this.id}-${this.startTimeMillis}`));
	}
	[j](e) {
		return ss(e) && e._tag === ts && this.id === e.id && this.startTimeMillis === e.startTimeMillis;
	}
	toString() {
		return F(this.toJSON());
	}
	toJSON() {
		return {
			_id: "FiberId",
			_tag: this._tag,
			id: this.id,
			startTimeMillis: this.startTimeMillis
		};
	}
	[N]() {
		return this.toJSON();
	}
}, os = /*#__PURE__*/ new is(), ss = (e) => w(e, $o), cs = (e) => {
	switch (e._tag) {
		case es: return Lo();
		case ts: return zo(e.id);
		case ns: return S(cs(e.left), Go(cs(e.right)));
	}
}, ls = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => Yo(0)), us = (e) => Array.from(cs(e)).map((e) => `#${e}`).join(","), ds = () => {
	let e = Xo(ls);
	return S(ls, Zo(e + 1)), new as(e, Date.now());
}, fs = os, ps = cs, ms = us, hs = ds, gs = Za, _s = Qa, vs = eo, ys = to, bs = io, xs = oo, Ss = uo, Cs = mo, ws = go, Ts = /*#__PURE__*/ Symbol.for("effect/List"), Es = (e) => z(e), Ds = /*#__PURE__*/ ((e) => Te(gr(e), Es))(M), Os = {
	[Ts]: Ts,
	_tag: "Cons",
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Cons",
			values: Es(this).map(P)
		};
	},
	[N]() {
		return this.toJSON();
	},
	[j](e) {
		return Ms(e) && this._tag === e._tag && Ds(this, e);
	},
	[E]() {
		return A(this, ct(Es(this)));
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
		return I(this, arguments);
	}
}, ks = (e, t) => {
	let n = Object.create(Os);
	return n.head = e, n.tail = t, n;
}, As = /*#__PURE__*/ k("Nil"), js = /*#__PURE__*/ Object.create({
	[Ts]: Ts,
	_tag: "Nil",
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Nil"
		};
	},
	[N]() {
		return this.toJSON();
	},
	[E]() {
		return As;
	},
	[j](e) {
		return Ms(e) && this._tag === e._tag;
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
		return I(this, arguments);
	}
}), Ms = (e) => w(e, Ts), Ns = (e) => e._tag === "Nil", Ps = (e) => e._tag === "Cons", Fs = () => js, Is = (e, t) => ks(e, t), Ls = Fs, Rs = (e) => ks(e, js), zs = /*#__PURE__*/ b(2, (e, t) => Vs(t, e)), Bs = /*#__PURE__*/ b(2, (e, t) => Is(t, e)), Vs = /*#__PURE__*/ b(2, (e, t) => {
	if (Ns(e)) return t;
	if (Ns(t)) return e;
	{
		let n = ks(t.head, e), r = n, i = t.tail;
		for (; !Ns(i);) {
			let t = ks(i.head, e);
			r.tail = t, r = t, i = i.tail;
		}
		return n;
	}
}), Hs = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = t, i = e;
	for (; !Ns(i);) r = n(r, i.head), i = i.tail;
	return r;
}), Us = (e) => {
	let t = Ls(), n = e;
	for (; !Ns(n);) t = Bs(t, n.head), n = n.tail;
	return t;
};
Array.prototype;
var Ws = /*#__PURE__*/ function() {
	function e(e) {
		e && Object.assign(this, e);
	}
	return e.prototype = Ut, e;
}(), Gs = /*#__PURE__*/ Symbol.for("effect/DifferContextPatch");
function Ks(e) {
	return e;
}
var qs = {
	...Ws.prototype,
	[Gs]: {
		_Value: Ks,
		_Patch: Ks
	}
}, Js = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(qs), { _tag: "Empty" })), Ys = () => Js, Xs = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(qs), { _tag: "AndThen" }), Zs = (e, t) => {
	let n = Object.create(Xs);
	return n.first = e, n.second = t, n;
}, Qs = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(qs), { _tag: "AddService" }), $s = (e, t) => {
	let n = Object.create(Qs);
	return n.key = e, n.service = t, n;
}, ec = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(qs), { _tag: "RemoveService" }), tc = (e) => {
	let t = Object.create(ec);
	return t.key = e, t;
}, nc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(qs), { _tag: "UpdateService" }), rc = (e, t) => {
	let n = Object.create(nc);
	return n.key = e, n.update = t, n;
}, ic = (e, t) => {
	let n = new Map(e.unsafeMap), r = Ys();
	for (let [e, i] of t.unsafeMap.entries()) if (n.has(e)) {
		let t = n.get(e);
		n.delete(e), M(t, i) || (r = ac(rc(e, () => i))(r));
	} else n.delete(e), r = ac($s(e, i))(r);
	for (let [e] of n.entries()) r = ac(tc(e))(r);
	return r;
}, ac = /*#__PURE__*/ b(2, (e, t) => Zs(e, t)), oc = /*#__PURE__*/ b(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = !1, r = _i(e), i = new Map(t.unsafeMap);
	for (; ji(r);) {
		let e = Pi(r), t = Fi(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AddService":
				i.set(e.key, e.service), r = t;
				break;
			case "AndThen":
				r = Di(Di(t, e.second), e.first);
				break;
			case "RemoveService":
				i.delete(e.key), r = t;
				break;
			case "UpdateService": i.set(e.key, e.update(i.get(e.key))), n = !0, r = t;
		}
	}
	if (!n) return Mr(i);
	let a = /* @__PURE__ */ new Map();
	for (let [e] of t.unsafeMap) i.has(e) && (a.set(e, i.get(e)), i.delete(e));
	for (let [e, t] of i) a.set(e, t);
	return Mr(a);
}), sc = /*#__PURE__*/ Symbol.for("effect/DifferHashSetPatch");
function cc(e) {
	return e;
}
var lc = {
	...Ws.prototype,
	[sc]: {
		_Value: cc,
		_Key: cc,
		_Patch: cc
	}
}, uc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(lc), { _tag: "Empty" })), dc = () => uc, fc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(lc), { _tag: "AndThen" }), pc = (e, t) => {
	let n = Object.create(fc);
	return n.first = e, n.second = t, n;
}, mc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(lc), { _tag: "Add" }), hc = (e) => {
	let t = Object.create(mc);
	return t.value = e, t;
}, gc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(lc), { _tag: "Remove" }), _c = (e) => {
	let t = Object.create(gc);
	return t.value = e, t;
}, vc = (e, t) => {
	let [n, r] = Ko([e, dc()], ([e, t], n) => Bo(n)(e) ? [Uo(n)(e), t] : [e, yc(hc(n))(t)])(t);
	return Ko(r, (e, t) => yc(_c(t))(e))(n);
}, yc = /*#__PURE__*/ b(2, (e, t) => pc(e, t)), bc = /*#__PURE__*/ b(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = t, r = _i(e);
	for (; ji(r);) {
		let e = Pi(r), t = Fi(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AndThen":
				r = Di(e.first)(Di(e.second)(t));
				break;
			case "Add":
				n = Ho(e.value)(n), r = t;
				break;
			case "Remove": n = Uo(e.value)(n), r = t;
		}
	}
	return n;
}), xc = /*#__PURE__*/ Symbol.for("effect/DifferReadonlyArrayPatch");
function Sc(e) {
	return e;
}
var Cc = {
	...Ws.prototype,
	[xc]: {
		_Value: Sc,
		_Patch: Sc
	}
}, wc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(Cc), { _tag: "Empty" })), Tc = () => wc, Ec = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Cc), { _tag: "AndThen" }), Dc = (e, t) => {
	let n = Object.create(Ec);
	return n.first = e, n.second = t, n;
}, Oc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Cc), { _tag: "Append" }), kc = (e) => {
	let t = Object.create(Oc);
	return t.values = e, t;
}, Ac = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Cc), { _tag: "Slice" }), jc = (e, t) => {
	let n = Object.create(Ac);
	return n.from = e, n.until = t, n;
}, Mc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Cc), { _tag: "Update" }), Nc = (e, t) => {
	let n = Object.create(Mc);
	return n.index = e, n.patch = t, n;
}, Pc = (e) => {
	let t = 0, n = Tc();
	for (; t < e.oldValue.length && t < e.newValue.length;) {
		let r = e.oldValue[t], i = e.newValue[t], a = e.differ.diff(r, i);
		M(a, e.differ.empty) || (n = Fc(n, Nc(t, a))), t += 1;
	}
	return t < e.oldValue.length && (n = Fc(n, jc(0, t))), t < e.newValue.length && (n = Fc(n, kc($n(t)(e.newValue)))), n;
}, Fc = /*#__PURE__*/ b(2, (e, t) => Dc(e, t)), Ic = /*#__PURE__*/ b(3, (e, t, n) => {
	if (e._tag === "Empty") return t;
	let r = t.slice(), i = dr(e);
	for (; Bn(i);) {
		let e = qn(i), t = Xn(i);
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
}), Lc = {
	[/* @__PURE__ */ Symbol.for("effect/Differ")]: {
		_P: x,
		_V: x
	},
	pipe() {
		return I(this, arguments);
	}
}, Rc = (e) => {
	let t = Object.create(Lc);
	return t.empty = e.empty, t.diff = e.diff, t.combine = e.combine, t.patch = e.patch, t;
}, zc = () => Rc({
	empty: Ys(),
	combine: (e, t) => ac(t)(e),
	diff: (e, t) => ic(e, t),
	patch: (e, t) => oc(t)(e)
}), Bc = () => Rc({
	empty: dc(),
	combine: (e, t) => yc(t)(e),
	diff: (e, t) => vc(e, t),
	patch: (e, t) => bc(t)(e)
}), Vc = (e) => Rc({
	empty: Tc(),
	combine: (e, t) => Fc(e, t),
	diff: (t, n) => Pc({
		oldValue: t,
		newValue: n,
		differ: e
	}),
	patch: (t, n) => Ic(t, n, e)
}), Hc = () => Uc((e, t) => t), Uc = (e) => Rc({
	empty: x,
	combine: (e, t) => e === x ? t : t === x ? e : (n) => t(e(n)),
	diff: (e, t) => M(e, t) ? x : ye(t),
	patch: (t, n) => e(n, t(n))
}), Wc = 255, Gc = 8, Kc = (e) => e & Wc, qc = (e) => e >> Gc & Wc, Jc = (e, t) => (e & Wc) + ((t & e & Wc) << Gc), Yc = /*#__PURE__*/ Jc(0, 0), Xc = (e) => Jc(e, e), Zc = (e) => Jc(e, 0), Qc = /*#__PURE__*/ b(2, (e, t) => Jc(Kc(e) & ~t, qc(e))), $c = /*#__PURE__*/ b(2, (e, t) => e | t), el = (e) => ~e >>> 0 & Wc, tl = (e) => ol(e, 32), nl = /*#__PURE__*/ b(2, (e, t) => e & ~t), rl = /*#__PURE__*/ b(2, (e, t) => e | t), il = (e) => al(e) && !ul(e), al = (e) => ol(e, 1), ol = /*#__PURE__*/ b(2, (e, t) => (e & t) !== 0), sl = (...e) => e.reduce((e, t) => e | t, 0), cl = /*#__PURE__*/ sl(0), ll = (e) => ol(e, 4), ul = (e) => ol(e, 16), dl = /*#__PURE__*/ b(2, (e, t) => Jc(e ^ t, t)), fl = /*#__PURE__*/ b(2, (e, t) => e & (el(Kc(t)) | qc(t)) | Kc(t) & qc(t)), pl = /*#__PURE__*/ Rc({
	empty: Yc,
	diff: (e, t) => dl(e, t),
	combine: (e, t) => $c(t)(e),
	patch: (e, t) => fl(t, e)
}), ml = Xc, hl = Zc, gl = Qc, _l = (e, t) => ({
	_tag: "Par",
	left: e,
	right: t
}), vl = (e, t) => ({
	_tag: "Seq",
	left: e,
	right: t
}), yl = (e) => {
	let t = Rs(e), n = Ls();
	for (;;) {
		let [e, r] = Hs(t, [Tl(), Ls()], ([e, t], n) => {
			let [r, i] = bl(n);
			return [Dl(e, r), zs(t, i)];
		});
		if (n = xl(n, e), Ns(r)) return Us(n);
		t = r;
	}
	throw Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, bl = (e) => {
	let t = e, n = Tl(), r = Ls(), i = Ls();
	for (;;) switch (t._tag) {
		case "Empty":
			if (Ns(r)) return [n, i];
			t = r.head, r = r.tail;
			break;
		case "Par":
			r = Is(t.right, r), t = t.left;
			break;
		case "Seq": {
			let e = t.left, n = t.right;
			switch (e._tag) {
				case "Empty":
					t = n;
					break;
				case "Par": {
					let r = e.left, i = e.right;
					t = _l(vl(r, n), vl(i, n));
					break;
				}
				case "Seq": {
					let r = e.left, i = e.right;
					t = vl(r, vl(i, n));
					break;
				}
				case "Single": t = e, i = Is(n, i);
			}
			break;
		}
		case "Single":
			if (n = El(n, t), Ns(r)) return [n, i];
			t = r.head, r = r.tail;
	}
	throw Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, xl = (e, t) => {
	if (Ns(e)) return Rs(Al(t));
	if (Ol(t)) return e;
	let n = Il(e.head), r = kl(t);
	return n.length === 1 && r.length === 1 && M(n[0], r[0]) ? Is(Fl(e.head, Al(t)), e.tail) : Is(Al(t), e);
}, Sl = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockParallel"), Cl = {
/* c8 ignore next */
_R: (e) => e }, wl = class {
	map;
	[Sl] = Cl;
	constructor(e) {
		this.map = e;
	}
}, Tl = () => new wl(gs()), El = (e, t) => new wl(Ss(e.map, t.dataSource, (e) => En(kn(e, Ei(t.blockedRequest)), () => _i(t.blockedRequest)))), Dl = (e, t) => new wl(ws(e.map, t.map, (e, t, n) => bs(e, n, wn(ys(e, n), {
	onNone: () => t,
	onSome: (e) => ki(t, e)
})))), Ol = (e) => vs(e.map), kl = (e) => Array.from(xs(e.map)), Al = (e) => Pl(Cs(e.map, (e) => _i(e))), jl = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockSequential"), Ml = {
/* c8 ignore next */
_R: (e) => e }, Nl = class {
	map;
	[jl] = Ml;
	constructor(e) {
		this.map = e;
	}
}, Pl = (e) => new Nl(e), Fl = (e, t) => new Nl(ws(t.map, e.map, (e, t, n) => bs(e, n, wn(ys(e, n), {
	onNone: () => hi(),
	onSome: (e) => ki(e, t)
})))), Il = (e) => Array.from(xs(e.map)), Ll = (e) => Array.from(e.map), Rl = "Empty", zl = "Fail", Bl = "Interrupt", Vl = "Parallel", Hl = "Sequential", Ul = "effect/Cause", Wl = /*#__PURE__*/ Symbol.for(Ul), Gl = {
/* c8 ignore next */
_E: (e) => e }, Kl = {
	[Wl]: Gl,
	[E]() {
		return S(D(Ul), O(D(pu(this))), A(this));
	},
	[j](e) {
		return $l(e) && fu(this, e);
	},
	pipe() {
		return I(this, arguments);
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
				defect: P(this.defect)
			};
			case "Interrupt": return {
				_id: "Cause",
				_tag: this._tag,
				fiberId: this.fiberId.toJSON()
			};
			case "Fail": return {
				_id: "Cause",
				_tag: this._tag,
				failure: P(this.error)
			};
			case "Sequential":
			case "Parallel": return {
				_id: "Cause",
				_tag: this._tag,
				left: P(this.left),
				right: P(this.right)
			};
		}
	},
	toString() {
		return Cu(this);
	},
	[N]() {
		return this.toJSON();
	}
}, ql = /*#__PURE__*/ (() => {
	let e = /*#__PURE__*/ Object.create(Kl);
	return e._tag = Rl, e;
})(), Jl = (e) => {
	let t = Object.create(Kl);
	return t._tag = zl, t.error = e, t;
}, Yl = (e) => {
	let t = Object.create(Kl);
	return t._tag = "Die", t.defect = e, t;
}, Xl = (e) => {
	let t = Object.create(Kl);
	return t._tag = Bl, t.fiberId = e, t;
}, Zl = (e, t) => {
	let n = Object.create(Kl);
	return n._tag = Vl, n.left = e, n.right = t, n;
}, Ql = (e, t) => {
	let n = Object.create(Kl);
	return n._tag = Hl, n.left = e, n.right = t, n;
}, $l = (e) => w(e, Wl), eu = (e) => e._tag === Rl, tu = (e) => e._tag === "Empty" || xu(e, !0, (e, t) => {
	switch (t._tag) {
		case Rl: return R(e);
		case "Die":
		case zl:
		case Bl: return R(!1);
		default: return L();
	}
}), nu = (e) => Cn(lu(e)), ru = (e) => Su(void 0, _u)(e), iu = (e) => xi(xu(e, hi(), (e, t) => t._tag === "Fail" ? R(S(e, Di(t.error))) : L())), au = (e) => xi(xu(e, hi(), (e, t) => t._tag === "Die" ? R(S(e, Di(t.defect))) : L())), ou = (e) => xu(e, Lo(), (e, t) => t._tag === "Interrupt" ? R(S(e, Ho(t.fiberId))) : L()), su = (e) => hu(e, (e) => e._tag === "Fail" ? R(e.error) : L()), cu = (e) => {
	let t = su(e);
	switch (t._tag) {
		case "None": return fn(e);
		case "Some": return pn(t.value);
	}
}, lu = (e) => hu(e, (e) => e._tag === "Interrupt" ? R(e.fiberId) : L()), uu = (e) => bu(e, {
	onEmpty: ql,
	onFail: () => ql,
	onDie: Yl,
	onInterrupt: Xl,
	onSequential: Ql,
	onParallel: Zl
}), du = (e) => bu(e, {
	onEmpty: ql,
	onFail: Yl,
	onDie: Yl,
	onInterrupt: Xl,
	onSequential: Ql,
	onParallel: Zl
}), fu = (e, t) => {
	let n = _i(e), r = _i(t);
	for (; ji(n) && ji(r);) {
		let [e, t] = S(Pi(n), xu([Lo(), hi()], ([e, t], n) => {
			let [r, i] = gu(n);
			return R([S(e, Go(r)), S(t, ki(i))]);
		})), [i, a] = S(Pi(r), xu([Lo(), hi()], ([e, t], n) => {
			let [r, i] = gu(n);
			return R([S(e, Go(r)), S(t, ki(i))]);
		}));
		if (!M(e, i)) return !1;
		n = t, r = a;
	}
	return !0;
}, pu = (e) => mu(_i(e), hi()), mu = (e, t) => {
	for (;;) {
		let [n, r] = S(e, mr([Lo(), hi()], ([e, t], n) => {
			let [r, i] = gu(n);
			return [S(e, Go(r)), S(t, ki(i))];
		})), i = Vo(n) > 0 ? S(t, Di(n)) : t;
		if (Ai(r)) return xi(i);
		e = r, t = i;
	}
	throw Error(ze("Cause.flattenCauseLoop"));
}, hu = /*#__PURE__*/ b(2, (e, t) => {
	let n = [e];
	for (; n.length > 0;) {
		let e = n.pop(), r = t(e);
		switch (r._tag) {
			case "None":
				switch (e._tag) {
					case Hl:
					case Vl: n.push(e.right), n.push(e.left);
				}
				break;
			case "Some": return r;
		}
	}
	return L();
}), gu = (e) => {
	let t = e, n = [], r = Lo(), i = hi();
	for (; t !== void 0;) switch (t._tag) {
		case Rl:
			if (n.length === 0) return [r, i];
			t = n.pop();
			break;
		case zl:
			if (r = Ho(r, gi(t._tag, t.error)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case "Die":
			if (r = Ho(r, gi(t._tag, t.defect)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Bl:
			if (r = Ho(r, gi(t._tag, t.fiberId)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Hl:
			switch (t.left._tag) {
				case Rl:
					t = t.right;
					break;
				case Hl:
					t = Ql(t.left.left, Ql(t.left.right, t.right));
					break;
				case Vl:
					t = Zl(Ql(t.left.left, t.right), Ql(t.left.right, t.right));
					break;
				default: i = Di(i, t.right), t = t.left;
			}
			break;
		case Vl: n.push(t.right), t = t.left;
	}
	throw Error(ze("Cause.evaluateCauseLoop"));
}, _u = {
	emptyCase: be,
	failCase: xe,
	dieCase: xe,
	interruptCase: be,
	sequentialCase: (e, t, n) => t && n,
	parallelCase: (e, t, n) => t && n
}, vu = "SequentialCase", yu = "ParallelCase", bu = /*#__PURE__*/ b(2, (e, { onDie: t, onEmpty: n, onFail: r, onInterrupt: i, onParallel: a, onSequential: o }) => Su(e, void 0, {
	emptyCase: () => n,
	failCase: (e, t) => r(t),
	dieCase: (e, n) => t(n),
	interruptCase: (e, t) => i(t),
	sequentialCase: (e, t, n) => o(t, n),
	parallelCase: (e, t, n) => a(t, n)
})), xu = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = t, i = e, a = [];
	for (; i !== void 0;) {
		let e = n(r, i);
		switch (r = Cn(e) ? e.value : r, i._tag) {
			case Hl:
				a.push(i.right), i = i.left;
				break;
			case Vl:
				a.push(i.right), i = i.left;
				break;
			default: i = void 0;
		}
		i === void 0 && a.length > 0 && (i = a.pop());
	}
	return r;
}), Su = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._tag) {
			case Rl:
				i.push(fn(n.emptyCase(t)));
				break;
			case zl:
				i.push(fn(n.failCase(t, e.error)));
				break;
			case "Die":
				i.push(fn(n.dieCase(t, e.defect)));
				break;
			case Bl:
				i.push(fn(n.interruptCase(t, e.fiberId)));
				break;
			case Hl:
				r.push(e.right), r.push(e.left), i.push(pn({ _tag: vu }));
				break;
			case Vl: r.push(e.right), r.push(e.left), i.push(pn({ _tag: yu }));
		}
	}
	let a = [];
	for (; i.length > 0;) {
		let e = i.pop();
		switch (e._tag) {
			case "Left":
				switch (e.left._tag) {
					case vu: {
						let e = a.pop(), r = a.pop(), i = n.sequentialCase(t, e, r);
						a.push(i);
						break;
					}
					case yu: {
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
}), Cu = (e, t) => ru(e) ? "All fibers interrupted without errors." : ju(e).map(function(e) {
	return t?.renderErrorCause !== !0 || e.cause === void 0 ? e.stack : `${e.stack} {\n${wu(e.cause, "  ")}\n}`;
}).join("\n"), wu = (e, t) => {
	let n = e.stack.split("\n"), r = `${t}[cause]: ${n[0]}`;
	for (let e = 1, i = n.length; e < i; e++) r += `\n${t}${n[e]}`;
	return e.cause && (r += ` {\n${wu(e.cause, `${t}  `)}\n${t}}`), r;
}, Tu = (e) => {
	let t = typeof e == "object" && !!e, n = Error.stackTraceLimit;
	Error.stackTraceLimit = 1;
	let r = Error(Eu(e), t && "cause" in e && e.cause !== void 0 ? { cause: Tu(e.cause) } : void 0);
	return Error.stackTraceLimit = n, r.message === "" && (r.message = "An error has occurred"), Error.stackTraceLimit = n, r.name = e instanceof Error ? e.name : "Error", t && (Au in e && (r.span = e[Au]), Object.keys(e).forEach((t) => {
		t in r || (r[t] = e[t]);
	})), r.stack = ku(`${r.name}: ${r.message}`, e instanceof Error && e.stack ? e.stack : "", r.span), r;
}, Eu = (e) => {
	if (typeof e == "string") return e;
	if (typeof e == "object" && e && e instanceof Error) return e.message;
	try {
		if (w(e, "toString") && Me(e.toString) && e.toString !== Object.prototype.toString && e.toString !== globalThis.Array.prototype.toString) return e.toString();
	} catch {}
	return pt(e);
}, Du = /\((.*)\)/g, Ou = /*#__PURE__*/ C("effect/Tracer/spanToTrace", () => /* @__PURE__ */ new WeakMap()), ku = (e, t, n) => {
	let r = [e], i = t.startsWith(e) ? t.slice(e.length).split("\n") : t.split("\n");
	for (let e = 1; e < i.length; e++) if (i[e].includes(" at new BaseEffectError") || i[e].includes(" at new YieldableError")) e++;
	else {
		if (i[e].includes("Generator.next") || i[e].includes("effect_internal_function")) break;
		r.push(i[e].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
	}
	if (n) {
		let e = n, t = 0;
		for (; e && e._tag === "Span" && t < 10;) {
			let n = Ou.get(e);
			if (typeof n == "function") {
				let t = n();
				if (typeof t == "string") {
					let n = t.matchAll(Du), i = !1;
					for (let [, t] of n) i = !0, r.push(`    at ${e.name} (${t})`);
					i || r.push(`    at ${e.name} (${t.replace(/^at /, "")})`);
				} else r.push(`    at ${e.name}`);
			} else r.push(`    at ${e.name}`);
			e = On(e.parent), t++;
		}
	}
	return r.join("\n");
}, Au = /*#__PURE__*/ Symbol.for("effect/SpanAnnotation"), ju = (e) => Su(e, void 0, {
	emptyCase: () => [],
	dieCase: (e, t) => [Tu(t)],
	failCase: (e, t) => [Tu(t)],
	interruptCase: () => [],
	parallelCase: (e, t, n) => [...t, ...n],
	sequentialCase: (e, t, n) => [...t, ...n]
}), Mu = "Pending", Nu = "Done", Pu = /*#__PURE__*/ Symbol.for("effect/Deferred"), Fu = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Iu = (e) => ({
	_tag: Mu,
	joiners: e
}), Lu = (e) => ({
	_tag: Nu,
	effect: e
}), Ru = class e {
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
}, zu = (e, t) => {
	let n = new V("Blocked");
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}, Bu = (e) => {
	let t = new V("RunBlocked");
	return t.effect_instruction_i0 = e, t;
}, Vu = /*#__PURE__*/ Symbol.for("effect/Effect"), Hu = class {
	patch;
	op;
	_op = Mt;
	constructor(e, t) {
		this.patch = e, this.op = t;
	}
}, V = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Vu] = zt;
	constructor(e) {
		this._op = e;
	}
	[j](e) {
		return this === e;
	}
	[E]() {
		return A(this, nt(this));
	}
	pipe() {
		return I(this, arguments);
	}
	toJSON() {
		return {
			_id: "Effect",
			_op: this._op,
			effect_instruction_i0: P(this.effect_instruction_i0),
			effect_instruction_i1: P(this.effect_instruction_i1),
			effect_instruction_i2: P(this.effect_instruction_i2)
		};
	}
	toString() {
		return F(this.toJSON());
	}
	[N]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new Ru(new Ze(this));
	}
}, Uu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Vu] = zt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[j](e) {
		return Hf(e) && e._op === "Failure" && M(this.effect_instruction_i0, e.effect_instruction_i0);
	}
	[E]() {
		return S(k(this._tag), O(D(this.effect_instruction_i0)), A(this));
	}
	get cause() {
		return this.effect_instruction_i0;
	}
	pipe() {
		return I(this, arguments);
	}
	toJSON() {
		return {
			_id: "Exit",
			_tag: this._op,
			cause: this.cause.toJSON()
		};
	}
	toString() {
		return F(this.toJSON());
	}
	[N]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new Ru(new Ze(this));
	}
}, Wu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Vu] = zt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[j](e) {
		return Hf(e) && e._op === "Success" && M(this.effect_instruction_i0, e.effect_instruction_i0);
	}
	[E]() {
		return S(k(this._tag), O(D(this.effect_instruction_i0)), A(this));
	}
	get value() {
		return this.effect_instruction_i0;
	}
	pipe() {
		return I(this, arguments);
	}
	toJSON() {
		return {
			_id: "Exit",
			_tag: this._op,
			value: P(this.value)
		};
	}
	toString() {
		return F(this.toJSON());
	}
	[N]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new Ru(new Ze(this));
	}
}, Gu = (e) => w(e, Vu), H = (e) => {
	let t = new V(At);
	return t.effect_instruction_i0 = e, t;
}, Ku = /*#__PURE__*/ b(3, (e, t, n) => Td((r) => G(e, (e) => G(ad(J(() => r(t(e)))), (t) => J(() => n(e, t)).pipe(pd({
	onFailure: (e) => {
		switch (t._tag) {
			case xt: return W(Ql(t.effect_instruction_i0, e));
			case Tt: return W(e);
		}
	},
	onSuccess: () => t
})))))), qu = /*#__PURE__*/ b(2, (e, t) => G(e, () => q(t))), Ju = (e) => qu(e, void 0), Yu = function() {
	let e = new V(bt);
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
		default: throw Error(ze("you're not supposed to end up here"));
	}
	return e;
}, Xu = (e, t = fs) => {
	let n = new V(yt), r;
	return n.effect_instruction_i0 = (t) => {
		r = e(t);
	}, n.effect_instruction_i1 = t, xd(n, (e) => Gu(r) ? r : X);
}, Zu = (e, t = fs) => J(() => Xu(e, t)), Qu = (e, t = fs) => Yu(e, function() {
	let e, n;
	function r(t) {
		e ? e(t) : n === void 0 && (n = t);
	}
	let i = new V(yt);
	i.effect_instruction_i0 = (t) => {
		e = t, n && t(n);
	}, i.effect_instruction_i1 = t;
	let a, o;
	return this.effect_instruction_i0.length === 1 ? a = T(() => this.effect_instruction_i0(r)) : (o = new AbortController(), a = T(() => this.effect_instruction_i0(r, o.signal))), a || o ? xd(i, (e) => (o && o.abort(), a ?? X)) : i;
}), $u = /*#__PURE__*/ b(2, (e, t) => md(e, {
	onFailure: t,
	onSuccess: q
})), ed = /*#__PURE__*/ Symbol.for("effect/OriginalAnnotation"), td = (e, t) => Cn(t) ? new Proxy(e, {
	has(e, t) {
		return t === Au || t === ed || t in e;
	},
	get(n, r) {
		return r === Au ? t.value : r === ed ? e : n[r];
	}
}) : e, nd = (e) => Pe(e) && !(Au in e) ? H((t) => W(Yl(td(e, vp(t))))) : W(Yl(e)), rd = (e) => sd(() => Yl(new Pf(e))), id = (e) => md(e, {
	onFailure: (e) => q(pn(e)),
	onSuccess: (e) => q(fn(e))
}), ad = (e) => fd(e, {
	onFailure: Z,
	onSuccess: Q
}), U = (e) => Pe(e) && !(Au in e) ? H((t) => W(Jl(td(e, vp(t))))) : W(Jl(e)), od = (e) => G(Y(e), U), W = (e) => {
	let t = new Uu(xt);
	return t.effect_instruction_i0 = e, t;
}, sd = (e) => G(Y(e), W), cd = /*#__PURE__*/ H((e) => q(e.id())), ld = (e) => H((t) => e(t.id())), G = /*#__PURE__*/ b(2, (e, t) => {
	let n = new V(Ct);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}), ud = (e) => {
	let t = new V("OnStep");
	return t.effect_instruction_i0 = e, t;
}, dd = (e) => G(e, x), fd = /*#__PURE__*/ b(2, (e, t) => pd(e, {
	onFailure: (e) => q(t.onFailure(e)),
	onSuccess: (e) => q(t.onSuccess(e))
})), pd = /*#__PURE__*/ b(2, (e, t) => {
	let n = new V(wt);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t.onFailure, n.effect_instruction_i2 = t.onSuccess, n;
}), md = /*#__PURE__*/ b(2, (e, t) => pd(e, {
	onFailure: (e) => {
		if (au(e).length > 0) return W(du(e));
		let n = iu(e);
		return n.length > 0 ? t.onFailure(Ni(n)) : W(e);
	},
	onSuccess: t.onSuccess
})), hd = /*#__PURE__*/ b(2, (e, t) => J(() => {
	let n = z(e), r = Nn(n.length), i = 0;
	return qu(Od({
		while: () => i < n.length,
		body: () => t(n[i], i),
		step: (e) => {
			r[i++] = e;
		}
	}), r);
})), gd = /*#__PURE__*/ b(2, (e, t) => J(() => {
	let n = z(e), r = 0;
	return Od({
		while: () => r < n.length,
		body: () => t(n[r], r),
		step: () => {
			r++;
		}
	});
})), _d = (e) => {
	let t = new V(Dt);
	return t.effect_instruction_i0 = ml(1), t.effect_instruction_i1 = () => e, t;
}, K = /*#__PURE__*/ b(2, (e, t) => G(e, (e) => Y(() => t(e)))), vd = /*#__PURE__*/ b(2, (e, t) => md(e, {
	onFailure: (e) => od(() => t.onFailure(e)),
	onSuccess: (e) => Y(() => t.onSuccess(e))
})), yd = /*#__PURE__*/ b(2, (e, t) => pd(e, {
	onFailure: (e) => {
		let n = cu(e);
		switch (n._tag) {
			case "Left": return od(() => t(n.left));
			case "Right": return W(n.right);
		}
	},
	onSuccess: q
})), bd = /*#__PURE__*/ b(2, (e, t) => Td((n) => pd(n(e), {
	onFailure: (e) => {
		let n = Z(e);
		return pd(t(n), {
			onFailure: (t) => Z(Ql(e, t)),
			onSuccess: () => n
		});
	},
	onSuccess: (e) => {
		let n = Q(e);
		return Id(t(n), n);
	}
}))), xd = /*#__PURE__*/ b(2, (e, t) => bd(e, Qf({
	onFailure: (e) => ru(e) ? Ju(t(ou(e))) : X,
	onSuccess: () => X
}))), q = (e) => {
	let t = new Wu(Tt);
	return t.effect_instruction_i0 = e, t;
}, J = (e) => {
	let t = new V(bt);
	return t.commit = e, t;
}, Y = (e) => {
	let t = new V(Et);
	return t.effect_instruction_i0 = e, t;
}, Sd = /*#__PURE__*/ b((e) => e.length === 3 || e.length === 2 && !(Pe(e[1]) && "onlyEffect" in e[1]), (e, t) => G(e, (e) => {
	let n = typeof t == "function" ? t(e) : t;
	return Gu(n) ? qu(n, e) : Re(n) ? Xu((t) => {
		n.then((n) => t(q(e)), (e) => t(U(new Vf(e, "An unknown error occurred in Effect.tap"))));
	}) : q(e);
})), Cd = (e) => H((t) => e(ef(xf, R(S(t.getFiberRef(xf), Tn(() => t.scope())))))), wd = (e) => {
	let t = new V(Dt);
	return t.effect_instruction_i0 = hl(1), t.effect_instruction_i1 = () => e, t;
}, Td = (e) => Yu(e, function() {
	let e = new V(Dt);
	return e.effect_instruction_i0 = hl(1), e.effect_instruction_i1 = (e) => al(e) ? T(() => this.effect_instruction_i0(_d)) : T(() => this.effect_instruction_i0(wd)), e;
}), X = /*#__PURE__*/ q(void 0), Ed = (e) => {
	let t = new V(Dt);
	return t.effect_instruction_i0 = e, t.effect_instruction_i1 = void 0, t;
}, Dd = /*#__PURE__*/ b(2, (e, t) => G(t, (t) => t ? S(e, K(R)) : q(L()))), Od = (e) => {
	let t = new V(Ot);
	return t.effect_instruction_i0 = e.while, t.effect_instruction_i1 = e.body, t.effect_instruction_i2 = e.step, t;
}, kd = (e) => J(() => {
	let t = new V(kt);
	return t.effect_instruction_i0 = e(), t;
}), Ad = function() {
	let e = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
	return kd(() => e(S));
}, jd = (e, ...t) => Object.defineProperty(t.length === 0 ? function(...t) {
	return kd(() => e.apply(this, t));
} : function(...n) {
	let r = kd(() => e.apply(this, n));
	for (let e of t) r = e(r, ...n);
	return r;
}, "length", {
	value: e.length,
	configurable: !0
}), Md = /*#__PURE__*/ b(2, (e, t) => {
	let n = new V(Dt);
	return n.effect_instruction_i0 = t, n.effect_instruction_i1 = () => e, n;
}), Nd = (e) => {
	let t = new V(jt);
	return e?.priority === void 0 ? t : hf(t, e.priority);
}, Pd = /*#__PURE__*/ b(2, (e, t) => G(e, (e) => K(t, (t) => [e, t]))), Fd = /*#__PURE__*/ b(2, (e, t) => G(e, (e) => qu(t, e))), Id = /*#__PURE__*/ b(2, (e, t) => G(e, () => t)), Ld = /*#__PURE__*/ b(3, (e, t, n) => G(e, (e) => K(t, (t) => n(e, t)))), Rd = (e) => G(cd, (t) => S(e, zd(t))), zd = /*#__PURE__*/ b(2, (e, t) => G(e.interruptAsFork(t), () => e.await)), Bd = {
	_tag: "All",
	syslog: 0,
	label: "ALL",
	ordinal: -(2 ** 53 - 1),
	pipe() {
		return I(this, arguments);
	}
}, Vd = {
	_tag: "Fatal",
	syslog: 2,
	label: "FATAL",
	ordinal: 5e4,
	pipe() {
		return I(this, arguments);
	}
}, Hd = {
	_tag: "Error",
	syslog: 3,
	label: "ERROR",
	ordinal: 4e4,
	pipe() {
		return I(this, arguments);
	}
}, Ud = {
	_tag: "Warning",
	syslog: 4,
	label: "WARN",
	ordinal: 3e4,
	pipe() {
		return I(this, arguments);
	}
}, Wd = {
	_tag: "Info",
	syslog: 6,
	label: "INFO",
	ordinal: 2e4,
	pipe() {
		return I(this, arguments);
	}
}, Gd = {
	_tag: "Debug",
	syslog: 7,
	label: "DEBUG",
	ordinal: 1e4,
	pipe() {
		return I(this, arguments);
	}
}, Kd = {
	_tag: "Trace",
	syslog: 7,
	label: "TRACE",
	ordinal: 0,
	pipe() {
		return I(this, arguments);
	}
}, qd = {
	_tag: "None",
	syslog: 7,
	label: "OFF",
	ordinal: 2 ** 53 - 1,
	pipe() {
		return I(this, arguments);
	}
}, Jd = /*#__PURE__*/ Symbol.for("effect/FiberRef"), Yd = {
/* c8 ignore next */
_A: (e) => e }, Xd = (e) => H((t) => Q(t.getFiberRef(e))), Zd = /*#__PURE__*/ b(2, (e, t) => G(Xd(e), t)), Qd = /*#__PURE__*/ b(2, (e, t) => $d(e, () => [void 0, t])), $d = /*#__PURE__*/ b(2, (e, t) => H((n) => {
	let [r, i] = t(n.getFiberRef(e));
	return n.setFiberRef(e, i), q(r);
})), ef = /*#__PURE__*/ b(3, (e, t, n) => Ku(Fd(Xd(t), Qd(t, n)), () => e, (e) => Qd(t, e))), tf = /*#__PURE__*/ b(3, (e, t, n) => Zd(t, (r) => ef(e, t, n(r)))), nf = (e, t) => sf(e, {
	differ: Hc(),
	fork: t?.fork ?? x,
	join: t?.join
}), rf = (e) => {
	let t = Bc();
	return sf(e, {
		differ: t,
		fork: t.empty
	});
}, af = (e) => {
	let t = Vc(Hc());
	return sf(e, {
		differ: t,
		fork: t.empty
	});
}, of = (e) => {
	let t = zc();
	return sf(e, {
		differ: t,
		fork: t.empty
	});
}, sf = (e, t) => ({
	...Wt,
	[Jd]: Yd,
	initial: e,
	commit() {
		return Xd(this);
	},
	diff: (e, n) => t.differ.diff(e, n),
	combine: (e, n) => t.differ.combine(e, n),
	patch: (e) => (n) => t.differ.patch(e, n),
	fork: t.fork,
	join: t.join ?? ((e, t) => t)
}), cf = (e) => sf(e, {
	differ: pl,
	fork: pl.empty
}), lf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentContext"), () => of(Qr())), uf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => nf(0)), df = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => nf(2048)), ff = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => nf(gs())), pf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogLevel"), () => nf(Wd)), mf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogSpan"), () => nf(Ls())), hf = /*#__PURE__*/ b(2, (e, t) => ef(e, uf, t)), gf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentConcurrency"), () => nf("unbounded")), _f = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestBatching"), () => nf(!0)), vf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => nf(R(Gd))), yf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => nf(R(Ud))), bf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMetricLabels"), () => af(ur())), xf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => nf(L(), {
	fork: () => L(),
	join: (e, t) => e
})), Sf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => nf(ql, {
	fork: () => ql,
	join: (e, t) => e
})), Cf = /*#__PURE__*/ Symbol.for("effect/Scope"), wf = /*#__PURE__*/ Symbol.for("effect/CloseableScope"), Tf = (e, t) => e.addFinalizer(() => Ju(t)), Ef = (e, t) => e.addFinalizer(t), Df = (e, t) => e.close(t), Of = (e, t) => e.fork(t), kf = (e) => Af(x)(e), Af = /*#__PURE__*/ b(2, (e, t) => {
	let n = S(e, su, kn(t));
	switch (n._tag) {
		case "None": return S(au(e), Mi, wn({
			onNone: () => {
				let t = z(ou(e)).flatMap((e) => z(ps(e)).map((e) => `#${e}`));
				return new If(t ? `Interrupted by fibers: ${t.join(", ")}` : void 0);
			},
			onSome: x
		}));
		case "Some": return n.value;
	}
}), jf = /*#__PURE__*/ function() {
	class e extends globalThis.Error {
		commit() {
			return U(this);
		}
		toJSON() {
			let e = { ...this };
			return this.message && (e.message = this.message), this.cause && (e.cause = this.cause), e;
		}
		[N]() {
			return this.toString === globalThis.Error.prototype.toString ? "Bun" in globalThis ? Cu(Jl(this), { renderErrorCause: !0 }) : this : this.stack ? `${this.toString()}\n${this.stack.split("\n").slice(1).join("\n")}` : this.toString();
		}
	}
	return Object.assign(e.prototype, Gt), e;
}(), Mf = (e, t) => {
	class n extends jf {
		_tag = t;
	}
	return Object.assign(n.prototype, e), n.prototype.name = t, n;
}, Nf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/RuntimeException"), Pf = /*#__PURE__*/ Mf({ [Nf]: Nf }, "RuntimeException"), Ff = /*#__PURE__*/ Symbol.for("effect/Cause/errors/InterruptedException"), If = /*#__PURE__*/ Mf({ [Ff]: Ff }, "InterruptedException"), Lf = (e) => w(e, Ff), Rf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/NoSuchElement"), zf = /*#__PURE__*/ Mf({ [Rf]: Rf }, "NoSuchElementException"), Bf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/UnknownException"), Vf = /*#__PURE__*/ function() {
	class e extends jf {
		_tag = "UnknownException";
		error;
		constructor(e, t) {
			super(t ?? "An unknown error occurred", { cause: e }), this.error = e;
		}
	}
	return Object.assign(e.prototype, {
		[Bf]: Bf,
		name: "UnknownException"
	}), e;
}(), Hf = (e) => Gu(e) && "_tag" in e && (e._tag === "Success" || e._tag === "Failure"), Uf = (e) => e._tag === "Failure", Wf = (e) => e._tag === "Success", Gf = /*#__PURE__*/ b(2, (e, t) => {
	switch (e._tag) {
		case xt: return Z(e.effect_instruction_i0);
		case Tt: return Q(t);
	}
}), Kf = (e) => Gf(e, void 0), qf = (e, t) => np(e, t?.parallel ? Zl : Ql), Jf = (e) => Z(Yl(e)), Yf = (e) => Z(Jl(e)), Z = (e) => {
	let t = new Uu(xt);
	return t.effect_instruction_i0 = e, t;
}, Xf = (e) => Z(Xl(e)), Zf = /*#__PURE__*/ b(2, (e, t) => {
	switch (e._tag) {
		case xt: return Z(e.effect_instruction_i0);
		case Tt: return Q(t(e.effect_instruction_i0));
	}
}), Qf = /*#__PURE__*/ b(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case xt: return t(e.effect_instruction_i0);
		case Tt: return n(e.effect_instruction_i0);
	}
}), $f = /*#__PURE__*/ b(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case xt: return t(e.effect_instruction_i0);
		case Tt: return n(e.effect_instruction_i0);
	}
}), Q = (e) => {
	let t = new Wu(Tt);
	return t.effect_instruction_i0 = e, t;
}, ep = /*#__PURE__*/ Q(void 0), tp = /*#__PURE__*/ b(3, (e, t, { onFailure: n, onSuccess: r }) => {
	switch (e._tag) {
		case xt: switch (t._tag) {
			case Tt: return Z(e.effect_instruction_i0);
			case xt: return Z(n(e.effect_instruction_i0, t.effect_instruction_i0));
		}
		case Tt: switch (t._tag) {
			case Tt: return Q(r(e.effect_instruction_i0, t.effect_instruction_i0));
			case xt: return Z(t.effect_instruction_i0);
		}
	}
}), np = (e, t) => {
	let n = vi(e);
	return ji(n) ? S(Fi(n), mr(S(Pi(n), Zf(_i)), (e, n) => S(e, tp(n, {
		onSuccess: (e, t) => S(e, Di(t)),
		onFailure: t
	}))), Zf(xi), Zf((e) => bi(e)), R) : L();
}, rp = (e) => ({
	...Wt,
	[Pu]: Fu,
	state: Yo(Iu([])),
	commit() {
		return op(this);
	},
	blockingOn: e
}), ip = () => G(cd, (e) => ap(e)), ap = (e) => Y(() => rp(e)), op = (e) => Zu((t) => {
	let n = Xo(e.state);
	switch (n._tag) {
		case Nu: return t(n.effect);
		case Mu: return n.joiners.push(t), dp(e, t);
	}
}, e.blockingOn), sp = /*#__PURE__*/ b(2, (e, t) => Y(() => {
	let n = Xo(e.state);
	switch (n._tag) {
		case Nu: return !1;
		case Mu:
			Zo(e.state, Lu(t));
			for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
			return !0;
	}
})), cp = /*#__PURE__*/ b(2, (e, t) => sp(e, W(t))), lp = /*#__PURE__*/ b(2, (e, t) => sp(e, q(t))), up = (e, t) => {
	let n = Xo(e.state);
	if (n._tag === "Pending") {
		Zo(e.state, Lu(t));
		for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
	}
}, dp = (e, t) => Y(() => {
	let n = Xo(e.state);
	if (n._tag === "Pending") {
		let e = n.joiners.indexOf(t);
		e >= 0 && n.joiners.splice(e, 1);
	}
}), fp = /*#__PURE__*/ H((e) => Q(e.currentContext)), pp = () => fp, mp = (e) => G(pp(), e), hp = /*#__PURE__*/ b(2, (e, t) => ef(lf, t)(e)), gp = /*#__PURE__*/ b(2, (e, t) => tf(lf, (e) => ii(e, t))(e)), _p = /*#__PURE__*/ b(2, (e, t) => mp((n) => hp(e, t(n)))), vp = (e) => {
	let t = e.currentSpan;
	return t !== void 0 && t._tag === "Span" ? R(t) : L();
}, yp = Uf, bp = Wf, xp = ep, Sp = /*#__PURE__*/ Symbol.for("effect/MutableHashMap"), Cp = {
	[Sp]: Sp,
	[Symbol.iterator]() {
		return new wp(this);
	},
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "MutableHashMap",
			values: Array.from(this).map(P)
		};
	},
	[N]() {
		return this.toJSON();
	},
	pipe() {
		return I(this, arguments);
	}
}, wp = class e {
	self;
	referentialIterator;
	bucketIterator;
	constructor(e) {
		this.self = e, this.referentialIterator = e.referential[Symbol.iterator]();
	}
	next() {
		if (this.bucketIterator !== void 0) return this.bucketIterator.next();
		let e = this.referentialIterator.next();
		return e.done ? (this.bucketIterator = new Tp(this.self.buckets.values()), this.next()) : e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, Tp = class {
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
}, Ep = () => {
	let e = Object.create(Cp);
	return e.referential = /* @__PURE__ */ new Map(), e.buckets = /* @__PURE__ */ new Map(), e.bucketsSize = 0, e;
}, Dp = /*#__PURE__*/ b(2, (e, t) => {
	if (ut(t) === !1) return e.referential.has(t) ? R(e.referential.get(t)) : L();
	let n = t[E](), r = e.buckets.get(n);
	return r === void 0 ? L() : Op(e, r, t);
}), Op = (e, t, n, r = !1) => {
	for (let i = 0, a = t.length; i < a; i++) if (n[j](t[i][0])) {
		let n = t[i][1];
		return r && (t.splice(i, 1), e.bucketsSize--), R(n);
	}
	return L();
}, kp = /*#__PURE__*/ b(2, (e, t) => Cn(Dp(e, t))), Ap = /*#__PURE__*/ b(3, (e, t, n) => {
	if (ut(t) === !1) return e.referential.set(t, n), e;
	let r = t[E](), i = e.buckets.get(r);
	return i === void 0 ? (e.buckets.set(r, [[t, n]]), e.bucketsSize++, e) : (jp(e, i, t), i.push([t, n]), e.bucketsSize++, e);
}), jp = (e, t, n) => {
	for (let r = 0, i = t.length; r < i; r++) if (n[j](t[r][0])) {
		t.splice(r, 1), e.bucketsSize--;
		return;
	}
}, Mp = /*#__PURE__*/ Symbol.for("effect/Clock"), Np = /*#__PURE__*/ Yr("effect/Clock"), Pp = 2 ** 31 - 1, Fp = { unsafeSchedule(e, t) {
	let n = sa(t);
	if (n > Pp) return xe;
	let r = !1, i = setTimeout(() => {
		r = !0, e();
	}, n);
	return () => (clearTimeout(i), !r);
} }, Ip = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || typeof performance.now != "function") return () => BigInt(Date.now()) * e;
	let t;
	return () => (t === void 0 && (t = BigInt(Date.now()) * e - BigInt(Math.round(performance.now() * 1e6))), t + BigInt(Math.round(performance.now() * 1e6)));
}(), Lp = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return Ip;
	let t = /*#__PURE__*/ Ip() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}(), Rp = class {
	[Mp] = Mp;
	unsafeCurrentTimeMillis() {
		return Date.now();
	}
	unsafeCurrentTimeNanos() {
		return Lp();
	}
	currentTimeMillis = /*#__PURE__*/ Y(() => this.unsafeCurrentTimeMillis());
	currentTimeNanos = /*#__PURE__*/ Y(() => this.unsafeCurrentTimeNanos());
	scheduler() {
		return q(Fp);
	}
	sleep(e) {
		return Qu((t) => Ju(Y(Fp.unsafeSchedule(() => t(X), e))));
	}
}, zp = () => new Rp(), Bp = "InvalidData", Vp = "MissingData", Hp = "SourceUnavailable", Up = "Unsupported", Wp = /*#__PURE__*/ Symbol.for("effect/ConfigError"), Gp = {
	_tag: "ConfigError",
	[Wp]: Wp
}, Kp = (e, t) => {
	let n = Object.create(Gp);
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
}, qp = (e, t) => {
	let n = Object.create(Gp);
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
}, Jp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Gp);
	return r._op = Bp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Invalid data at ${S(this.path, yr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Yp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Gp);
	return r._op = Vp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Missing data at ${S(this.path, yr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Xp = (e, t, n, r = { pathDelim: "." }) => {
	let i = Object.create(Gp);
	return i._op = Hp, i.path = e, i.message = t, i.cause = n, Object.defineProperty(i, "toString", {
		enumerable: !1,
		value() {
			return `(Source unavailable at ${S(this.path, yr(r.pathDelim))}: "${this.message}")`;
		}
	}), i;
}, Zp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Gp);
	return r._op = Up, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Unsupported operation at ${S(this.path, yr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Qp = /*#__PURE__*/ b(2, (e, t) => {
	switch (e._op) {
		case "And": return Kp(Qp(e.left, t), Qp(e.right, t));
		case "Or": return qp(Qp(e.left, t), Qp(e.right, t));
		case Bp: return Jp([...t, ...e.path], e.message);
		case Vp: return Yp([...t, ...e.path], e.message);
		case Hp: return Xp([...t, ...e.path], e.message, e.cause);
		case Up: return Zp([...t, ...e.path], e.message);
	}
}), $p = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._op) {
			case "And":
				r.push(e.right), r.push(e.left), i.push(pn({ _op: "AndCase" }));
				break;
			case "Or":
				r.push(e.right), r.push(e.left), i.push(pn({ _op: "OrCase" }));
				break;
			case Bp:
				i.push(fn(n.invalidDataCase(t, e.path, e.message)));
				break;
			case Vp:
				i.push(fn(n.missingDataCase(t, e.path, e.message)));
				break;
			case Hp:
				i.push(fn(n.sourceUnavailableCase(t, e.path, e.message, e.cause)));
				break;
			case Up: i.push(fn(n.unsupportedCase(t, e.path, e.message)));
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
}), em = { _tag: "Empty" }, tm = /*#__PURE__*/ b(2, (e, t) => {
	let n = Rs(t), r = e;
	for (; Ps(n);) {
		let e = n.head;
		switch (e._tag) {
			case "Empty":
				n = n.tail;
				break;
			case "AndThen":
				n = Is(e.first, Is(e.second, n.tail));
				break;
			case "MapName":
				r = fr(r, e.f), n = n.tail;
				break;
			case "Nested":
				r = In(r, e.name), n = n.tail;
				break;
			case "Unnested": if (S(Kn(r), jn(e.name))) r = Xn(r), n = n.tail;
			else return pn(Yp(r, `Expected ${e.name} to be in path in ConfigProvider#unnested`));
		}
	}
	return fn(r);
}), nm = "Constant", rm = "Fail", im = "Fallback", am = "Described", om = "Lazy", sm = "MapOrFail", cm = "Nested", lm = "Primitive", um = "Redacted", dm = "Sequence", fm = "HashMap", pm = "ZipWith", mm = (e, t) => [...e, ...t], hm = /*#__PURE__*/ Symbol.for("effect/ConfigProvider"), gm = /*#__PURE__*/ Yr("effect/ConfigProvider"), _m = /*#__PURE__*/ Symbol.for("effect/ConfigProviderFlat"), vm = (e) => ({
	[hm]: hm,
	pipe() {
		return I(this, arguments);
	},
	...e
}), ym = (e) => ({
	[_m]: _m,
	patch: e.patch,
	load: (t, n, r = !0) => e.load(t, n, r),
	enumerateChildren: e.enumerateChildren
}), bm = (e) => vm({
	load: (t) => G(Em(e, ur(), t, !1), (e) => wn(Kn(e), {
		onNone: () => U(Yp(ur(), `Expected a single value having structure: ${t}`)),
		onSome: q
	})),
	flattened: e
}), xm = (e) => {
	let { pathDelim: t, seqDelim: n } = Object.assign({}, {
		pathDelim: "_",
		seqDelim: ","
	}, e), r = (e) => S(e, yr(t)), i = (e) => e.split(t), a = () => typeof process < "u" && "env" in process && typeof process.env == "object" ? process.env : {};
	return bm(ym({
		load: (e, t, i = !0) => {
			let o = r(e), s = a();
			return S(o in s ? R(s[o]) : L(), yd(() => Yp(e, `Expected ${o} to exist in the process context`)), G((r) => km(r, e, t, n, i)));
		},
		enumerateChildren: (e) => Y(() => {
			let t = a();
			return Ro(Object.keys(t).map((e) => i(e.toUpperCase())).filter((t) => {
				for (let n = 0; n < e.length; n++) {
					let r = S(e, Gn(n)), i = t[n];
					if (i === void 0 || r !== i) return !1;
				}
				return !0;
			}).flatMap((t) => t.slice(e.length, e.length + 1)));
		}),
		patch: em
	}));
}, Sm = (e, t, n, r) => {
	let i = hr(n.length, (t) => t >= r.length ? L() : R([e(t), t + 1])), a = hr(r.length, (e) => e >= n.length ? L() : R([t(e), e + 1]));
	return [mm(n, i), mm(r, a)];
}, Cm = (e, t) => {
	let n = t;
	if (n._tag === "Nested") {
		let t = e.slice();
		for (; n._tag === "Nested";) t.push(n.name), n = n.config;
		return t;
	}
	return e;
}, wm = {
	andCase: (e, t, n) => Kp(t, n),
	orCase: (e, t, n) => qp(t, n),
	invalidDataCase: (e, t) => Jp(t, "<redacted>"),
	missingDataCase: (e, t) => Yp(t, "<redacted>"),
	sourceUnavailableCase: (e, t, n, r) => Xp(t, "<redacted>", r),
	unsupportedCase: (e, t) => Zp(t, "<redacted>")
}, Tm = (e) => $p(e, void 0, wm), Em = (e, t, n, r) => {
	let i = n;
	switch (i._tag) {
		case nm: return q(dr(i.value));
		case am: return J(() => Em(e, t, i.config, r));
		case rm: return U(Yp(t, i.message));
		case im: return S(J(() => Em(e, t, i.first, r)), $u((n) => i.condition(n) ? S(Em(e, t, i.second, r), $u((e) => U(qp(n, e)))) : U(n)));
		case om: return J(() => Em(e, t, i.config(), r));
		case sm: return J(() => S(Em(e, t, i.original, r), G(hd((e) => S(i.mapOrFail(e), yd(Qp(Cm(t, i.original))))))));
		case cm: return J(() => Em(e, mm(t, dr(i.name)), i.config, r));
		case lm: return S(tm(t, e.patch), G((t) => S(e.load(t, i, r), G((e) => {
			if (e.length === 0) {
				let e = S(Jn(t), Tn(() => "<n/a>"));
				return U(Yp([], `Expected ${i.description} with name ${e}`));
			}
			return q(e);
		}))));
		case um: return J(() => S(Em(e, t, i.original, r), yd(Tm), K(fr(i.redact))));
		case dm: return S(tm(t, e.patch), G((n) => S(e.enumerateChildren(n), G(jm), G((n) => n.length === 0 ? J(() => K(Em(e, t, i.config, !0), dr)) : S(hd(n, (n) => Em(e, Ln(t, `[${n}]`), i.config, !0)), K((e) => {
			let t = pr(e);
			return t.length === 0 ? dr(ur()) : dr(t);
		}))))));
		case fm: return J(() => S(tm(t, e.patch), G((t) => S(e.enumerateChildren(t), G((n) => S(n, hd((n) => Em(e, mm(t, dr(n)), i.valueConfig, r)), K((e) => e.length === 0 ? dr(gs()) : S(Am(e), fr((e) => _s(nr(z(n), e)))))))))));
		case pm: return J(() => S(Em(e, t, i.left, r), id, G((n) => S(Em(e, t, i.right, r), id, G((e) => {
			if (mn(n) && mn(e)) return U(Kp(n.left, e.left));
			if (mn(n) && hn(e)) return U(n.left);
			if (hn(n) && mn(e)) return U(e.left);
			if (hn(n) && hn(e)) {
				let r = Dm(t, S(t, yr("."))), [a, o] = Sm(r, r, S(n.right, fr(fn)), S(e.right, fr(fn)));
				return S(a, nr(o), hd(([e, t]) => S(Pd(e, t), K(([e, t]) => i.zip(e, t)))));
			}
			throw Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
		})))));
	}
}, Dm = (e, t) => (n) => pn(Yp(e, `The element at index ${n} in a sequence at path "${t}" was missing`)), Om = (e, t) => e.split(RegExp(`\\s*${xr(t)}\\s*`)), km = (e, t, n, r, i) => i ? S(Om(e, r), hd((e) => n.parse(e.trim())), yd(Qp(t))) : S(n.parse(e), vd({
	onFailure: Qp(t),
	onSuccess: dr
})), Am = (e) => Object.keys(e[0]).map((t) => e.map((e) => e[t])), jm = (e) => S(hd(e, Nm), vd({
	onFailure: () => ur(),
	onSuccess: tr(br)
}), id, K(gn)), Mm = /^(\[(\d+)\])$/, Nm = (e) => {
	let t = e.match(Mm);
	if (t !== null) {
		let e = t[2];
		return S(e !== void 0 && e.length > 0 ? R(e) : L(), An(Pm));
	}
	return L();
}, Pm = (e) => {
	let t = Number.parseInt(e);
	return Number.isNaN(t) ? L() : R(t);
}, Fm = /*#__PURE__*/ Symbol.for("effect/Console"), Im = /*#__PURE__*/ Yr("effect/Console"), Lm = {
	[Fm]: Fm,
	assert(e, ...t) {
		return Y(() => {
			console.assert(e, ...t);
		});
	},
	clear: /*#__PURE__*/ Y(() => {
		console.clear();
	}),
	count(e) {
		return Y(() => {
			console.count(e);
		});
	},
	countReset(e) {
		return Y(() => {
			console.countReset(e);
		});
	},
	debug(...e) {
		return Y(() => {
			console.debug(...e);
		});
	},
	dir(e, t) {
		return Y(() => {
			console.dir(e, t);
		});
	},
	dirxml(...e) {
		return Y(() => {
			console.dirxml(...e);
		});
	},
	error(...e) {
		return Y(() => {
			console.error(...e);
		});
	},
	group(e) {
		return e?.collapsed ? Y(() => console.groupCollapsed(e?.label)) : Y(() => console.group(e?.label));
	},
	groupEnd: /*#__PURE__*/ Y(() => {
		console.groupEnd();
	}),
	info(...e) {
		return Y(() => {
			console.info(...e);
		});
	},
	log(...e) {
		return Y(() => {
			console.log(...e);
		});
	},
	table(e, t) {
		return Y(() => {
			console.table(e, t);
		});
	},
	time(e) {
		return Y(() => console.time(e));
	},
	timeEnd(e) {
		return Y(() => console.timeEnd(e));
	},
	timeLog(e, ...t) {
		return Y(() => {
			console.timeLog(e, ...t);
		});
	},
	trace(...e) {
		return Y(() => {
			console.trace(...e);
		});
	},
	warn(...e) {
		return Y(() => {
			console.warn(...e);
		});
	},
	unsafe: console
}, Rm = /*#__PURE__*/ Symbol.for("effect/Random"), zm = /*#__PURE__*/ Yr("effect/Random"), Bm = class {
	seed;
	[Rm] = Rm;
	PRNG;
	constructor(e) {
		this.seed = e, this.PRNG = new qe(e);
	}
	get next() {
		return Y(() => this.PRNG.number());
	}
	get nextBoolean() {
		return K(this.next, (e) => e > .5);
	}
	get nextInt() {
		return Y(() => this.PRNG.integer(2 ** 53 - 1));
	}
	nextRange(e, t) {
		return K(this.next, (n) => (t - e) * n + e);
	}
	nextIntBetween(e, t) {
		return Y(() => this.PRNG.integer(t - e) + e);
	}
	shuffle(e) {
		return Vm(e, (e) => this.nextIntBetween(0, e));
	}
}, Vm = (e, t) => J(() => S(Y(() => Array.from(e)), G((e) => {
	let n = [];
	for (let t = e.length; t >= 2; --t) n.push(t);
	return S(n, gd((n) => S(t(n), K((t) => Hm(e, n - 1, t)))), qu(vi(e)));
}))), Hm = (e, t, n) => {
	let r = e[t];
	return e[t] = e[n], e[n] = r, e;
}, Um = (e) => new Bm(D(e)), Wm = /*#__PURE__*/ Symbol.for("effect/Tracer"), Gm = (e) => ({
	[Wm]: Wm,
	...e
}), Km = /*#__PURE__*/ Yr("effect/Tracer"), qm = /*#__PURE__*/ Yr("effect/ParentSpan"), Jm = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), Ym = class {
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
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = t._tag === "Some" ? t.value.traceId : Jm(32), this.spanId = Jm(16), this.links = Array.from(r);
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
}, Xm = /*#__PURE__*/ Gm({
	span: (e, t, n, r, i, a) => new Ym(e, t, n, r, i, a),
	context: (e) => e()
}), Zm = /*#__PURE__*/ si()("effect/Tracer/DisablePropagation", { defaultValue: xe }), Qm = /*#__PURE__*/ S(/*#__PURE__*/ Qr(), /*#__PURE__*/ ei(Np, /*#__PURE__*/ zp()), /*#__PURE__*/ ei(Im, Lm), /*#__PURE__*/ ei(zm, /*#__PURE__*/ Um(/*#__PURE__*/ Math.random())), /*#__PURE__*/ ei(gm, /*#__PURE__*/ xm()), /*#__PURE__*/ ei(Km, Xm)), $m = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/DefaultServices/currentServices"), () => of(Qm));
// node_modules/effect/dist/esm/internal/fiberRefs.js
function eh(e) {
	return new rh(e);
}
function th() {
	return eh(/* @__PURE__ */ new Map());
}
var nh = /*#__PURE__*/ Symbol.for("effect/FiberRefs"), rh = class {
	locals;
	[nh] = nh;
	constructor(e) {
		this.locals = e;
	}
	pipe() {
		return I(this, arguments);
	}
}, ih = (e, t, n, r = !1) => {
	let i = e, a = t, o = n, s = r, c;
	for (; c === void 0;) if (Vn(a) && Vn(o)) {
		let e = qn(a)[0], t = Xn(a), n = qn(o)[0], r = qn(o)[1], i = Xn(o);
		e.startTimeMillis < n.startTimeMillis ? (o = i, s = !0) : e.startTimeMillis > n.startTimeMillis ? a = t : e.id < n.id ? (o = i, s = !0) : e.id > n.id ? a = t : c = [r, s];
	} else c = [i.initial, !0];
	return c;
}, ah = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = new Map(e.locals);
	return n.locals.forEach((e, n) => {
		let i = e[0][1];
		if (!e[0][0][j](t)) {
			if (!r.has(n)) {
				if (M(i, n.initial)) return;
				r.set(n, [[t, n.join(n.initial, i)]]);
				return;
			}
			let a = r.get(n), [o, s] = ih(n, a, e);
			if (s) {
				let e = n.diff(o, i), s = a[0][1], c = n.join(s, n.patch(e)(s));
				if (!M(s, c)) {
					let e, i = a[0][0];
					e = i[j](t) ? [[i, c], ...a.slice(1)] : [[t, c], ...a], r.set(n, e);
				}
			}
		}
	}), new rh(r);
}), oh = /*#__PURE__*/ b(2, (e, t) => {
	let n = /* @__PURE__ */ new Map();
	return sh(e, n, t), new rh(n);
}), sh = (e, t, n) => {
	e.locals.forEach((e, r) => {
		let i = e[0][1], a = r.patch(r.fork)(i);
		M(i, a) ? t.set(r, e) : t.set(r, [[n, a], ...e]);
	});
}, ch = /*#__PURE__*/ b(2, (e, t) => {
	let n = new Map(e.locals);
	return n.delete(t), new rh(n);
}), lh = /*#__PURE__*/ b(2, (e, t) => e.locals.has(t) ? R(qn(e.locals.get(t))[1]) : L()), uh = /*#__PURE__*/ b(2, (e, t) => S(lh(e, t), Tn(() => t.initial))), dh = /*#__PURE__*/ b(2, (e, { fiberId: t, fiberRef: n, value: r }) => {
	if (e.locals.size === 0) return new rh(/* @__PURE__ */ new Map([[n, [[t, r]]]]));
	let i = new Map(e.locals);
	return fh(i, t, n, r), new rh(i);
}), fh = (e, t, n, r) => {
	let i = e.get(n) ?? [], a;
	if (Vn(i)) {
		let [e, n] = qn(i);
		if (e[j](t)) {
			if (M(n, r)) return;
			a = [[t, r], ...i.slice(1)];
		} else a = [[t, r], ...i];
	} else a = [[t, r]];
	e.set(n, a);
}, ph = /*#__PURE__*/ b(2, (e, { entries: t, forkAs: n }) => {
	if (e.locals.size === 0) return new rh(new Map(t));
	let r = new Map(e.locals);
	return n !== void 0 && sh(e, r, n), t.forEach(([e, t]) => {
		t.length === 1 ? fh(r, t[0][0], e, t[0][1]) : t.forEach(([t, n]) => {
			fh(r, t, e, n);
		});
	}), new rh(r);
}), mh = uh, hh = ph, gh = th, _h = Bd, vh = Vd, yh = Hd, bh = Ud, xh = Wd, Sh = Gd, Ch = Kd, wh = qd, Th = /*#__PURE__*/ xn(/* @__PURE__ */ S(br, /*#__PURE__*/ bn((e) => e.ordinal))), Eh = (e) => {
	switch (e) {
		case "All": return _h;
		case "Debug": return Sh;
		case "Error": return yh;
		case "Fatal": return vh;
		case "Info": return xh;
		case "Trace": return Ch;
		case "None": return wh;
		case "Warning": return bh;
	}
}, Dh = (e) => e.replace(/[\s="]/g, "_"), Oh = (e) => (t) => `${Dh(t.label)}=${e - t.startTime}ms`, kh = Ht, Ah = Kt, jh = class extends Ah {}, Mh = /*#__PURE__*/ Symbol.for("effect/Readable"), Nh = /*#__PURE__*/ Symbol.for("effect/Ref"), Ph = {
/* c8 ignore next */
_A: (e) => e }, Fh = class extends jh {
	ref;
	commit() {
		return this.get;
	}
	[Nh] = Ph;
	[Mh] = Mh;
	constructor(e) {
		super(), this.ref = e, this.get = Y(() => Xo(this.ref));
	}
	get;
	modify(e) {
		return Y(() => {
			let t = Xo(this.ref), [n, r] = e(t);
			return t !== r && Zo(r)(this.ref), n;
		});
	}
}, Ih = (e) => new Fh(Yo(e)), Lh = (e) => Y(() => Ih(e)), Rh = (e) => e.get, zh = /*#__PURE__*/ b(2, (e, t) => e.modify(() => [void 0, t])), Bh = /*#__PURE__*/ b(2, (e, t) => e.modify(t)), Vh = /*#__PURE__*/ b(2, (e, t) => e.modify((e) => [void 0, t(e)])), Hh = "Empty", Uh = "Remove", Wh = "Update", Gh = "AndThen", Kh = { _tag: Hh }, qh = (e, t) => {
	let n = new Map(e.locals), r = Kh;
	for (let [e, i] of t.locals.entries()) {
		let t = qn(i)[1], a = n.get(e);
		if (a !== void 0) {
			let n = qn(a)[1];
			M(n, t) || (r = Jh({
				_tag: Wh,
				fiberRef: e,
				patch: e.diff(n, t)
			})(r));
		} else r = Jh({
			_tag: "Add",
			fiberRef: e,
			value: t
		})(r);
		n.delete(e);
	}
	for (let [e] of n.entries()) r = Jh({
		_tag: Uh,
		fiberRef: e
	})(r);
	return r;
}, Jh = /*#__PURE__*/ b(2, (e, t) => ({
	_tag: Gh,
	first: e,
	second: t
})), Yh = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = n, i = dr(e);
	for (; Vn(i);) {
		let e = qn(i), n = Xn(i);
		switch (e._tag) {
			case Hh:
				i = n;
				break;
			case "Add":
				r = dh(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.value
				}), i = n;
				break;
			case Uh:
				r = ch(r, e.fiberRef), i = n;
				break;
			case Wh: {
				let a = uh(r, e.fiberRef);
				r = dh(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.fiberRef.patch(e.patch)(a)
				}), i = n;
				break;
			}
			case Gh: i = In(e.first)(In(e.second)(n));
		}
	}
	return r;
}), Xh = "effect/MetricLabel", Zh = /*#__PURE__*/ Symbol.for(Xh), Qh = class {
	key;
	value;
	[Zh] = Zh;
	_hash;
	constructor(e, t) {
		this.key = e, this.value = t, this._hash = k(Xh + this.key + this.value);
	}
	[E]() {
		return this._hash;
	}
	[j](e) {
		return eg(e) && this.key === e.key && this.value === e.value;
	}
	pipe() {
		return I(this, arguments);
	}
}, $h = (e, t) => new Qh(e, t), eg = (e) => w(e, Zh), tg = (e) => K(e, R), ng = (e) => {
	let t, n;
	return typeof e == "function" ? t = e : (t = e.try, n = e.catch), J(() => {
		try {
			return q(T(t));
		} catch (e) {
			return U(n ? T(() => n(e)) : new Vf(e, "An unknown error occurred in Effect.try"));
		}
	});
}, rg = (e) => dg(e, ag, qh), ig = /*#__PURE__*/ b(2, (e, t) => md(e, {
	onFailure: (e) => q(t.onFailure(e)),
	onSuccess: (e) => q(t.onSuccess(e))
})), ag = /*#__PURE__*/ H((e) => q(e.getFiberRefs())), og = (e) => ig(e, {
	onFailure: Ce,
	onSuccess: Ce
}), sg = (e) => mg((t, n) => S(e, Yh(t, n))), cg = (e) => e.length >= 1 ? Qu((t, n) => {
	try {
		e(n).then((e) => t(q(e)), (e) => t(nd(e)));
	} catch (e) {
		t(nd(e));
	}
}) : Qu((t) => {
	try {
		e().then((e) => t(q(e)), (e) => t(nd(e)));
	} catch (e) {
		t(nd(e));
	}
}), lg = /*#__PURE__*/ b(3, (e, t, n) => mp((r) => hp(e, ei(r, t, n)))), ug = /*#__PURE__*/ q(/*#__PURE__*/ L()), dg = /*#__PURE__*/ b(3, (e, t, n) => G(t, (r) => G(e, (e) => K(t, (t) => [n(r, t), e])))), fg = /*#__PURE__*/ b(2, (e, t) => pd(e, {
	onFailure: (e) => {
		let n = cu(e);
		switch (n._tag) {
			case "Left": return Id(t(n.left), W(e));
			case "Right": return W(e);
		}
	},
	onSuccess: q
})), pg = (e) => {
	let t, n;
	typeof e == "function" ? t = e : (t = e.try, n = e.catch);
	let r = (e) => n ? od(() => n(e)) : U(new Vf(e, "An unknown error occurred in Effect.tryPromise"));
	return t.length >= 1 ? Qu((e, n) => {
		try {
			t(n).then((t) => e(q(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	}) : Qu((e) => {
		try {
			t().then((t) => e(q(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	});
}, mg = (e) => H((t) => (t.setFiberRefs(e(t.id(), t.getFiberRefs())), X)), hg = /*#__PURE__*/ An((e) => ti(e.context, Zm) ? e._tag === "Span" ? hg(e.parent) : L() : R(e)), gg = "Sequential", _g = "Parallel", vg = "ParallelN", yg = { _tag: gg }, bg = { _tag: _g }, xg = (e) => ({
	_tag: vg,
	parallelism: e
}), Sg = (e) => e._tag === gg, Cg = (e) => e._tag === _g, wg = yg, Tg = bg, Eg = xg, Dg = qh, Og = Yh, kg = "effect/FiberStatus", Ag = /*#__PURE__*/ Symbol.for(kg), jg = "Done", Mg = "Running", Ng = "Suspended", Pg = /*#__PURE__*/ k(`${kg}-${jg}`), Fg = class {
	[Ag] = Ag;
	_tag = jg;
	[E]() {
		return Pg;
	}
	[j](e) {
		return Vg(e) && e._tag === "Done";
	}
}, Ig = class {
	runtimeFlags;
	[Ag] = Ag;
	_tag = Mg;
	constructor(e) {
		this.runtimeFlags = e;
	}
	[E]() {
		return S(D(kg), O(D(this._tag)), O(D(this.runtimeFlags)), A(this));
	}
	[j](e) {
		return Vg(e) && e._tag === "Running" && this.runtimeFlags === e.runtimeFlags;
	}
}, Lg = class {
	runtimeFlags;
	blockingOn;
	[Ag] = Ag;
	_tag = Ng;
	constructor(e, t) {
		this.runtimeFlags = e, this.blockingOn = t;
	}
	[E]() {
		return S(D(kg), O(D(this._tag)), O(D(this.runtimeFlags)), O(D(this.blockingOn)), A(this));
	}
	[j](e) {
		return Vg(e) && e._tag === "Suspended" && this.runtimeFlags === e.runtimeFlags && M(this.blockingOn, e.blockingOn);
	}
}, Rg = /*#__PURE__*/ new Fg(), zg = (e) => new Ig(e), Bg = (e, t) => new Lg(e, t), Vg = (e) => w(e, Ag), Hg = (e) => e._tag === jg, Ug = Rg, Wg = zg, Gg = Bg, Kg = Hg, qg = /*#__PURE__*/ Symbol.for("effect/Micro"), Jg = /*#__PURE__*/ Symbol.for("effect/Micro/MicroExit"), Yg = /*#__PURE__*/ Symbol.for("effect/Micro/MicroCause"), Xg = { _E: x }, Zg = class extends globalThis.Error {
	_tag;
	traces;
	[Yg];
	constructor(e, t, n) {
		let r = `MicroCause.${e}`, i, a, o;
		if (t instanceof globalThis.Error) {
			i = `(${r}) ${t.name}`, a = t.message;
			let e = a.split("\n").length;
			o = t.stack ? `(${r}) ${t.stack.split("\n").slice(0, e + 3).join("\n")}` : `${i}: ${a}`;
		} else i = r, a = ft(t, 0), o = `${i}: ${a}`;
		n.length > 0 && (o += `\n    ${n.join("\n    ")}`), super(a), this._tag = e, this.traces = n, this[Yg] = Xg, this.name = i, this.stack = o;
	}
	pipe() {
		return I(this, arguments);
	}
	toString() {
		return this.stack;
	}
	[N]() {
		return this.stack;
	}
}, Qg = class extends Zg {
	defect;
	constructor(e, t = []) {
		super("Die", e, t), this.defect = e;
	}
}, $g = (e, t = []) => new Qg(e, t), e_ = class extends Zg {
	constructor(e = []) {
		super("Interrupt", "interrupted", e);
	}
}, t_ = (e = []) => new e_(e), n_ = (e) => e._tag === "Interrupt", r_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroFiber"), i_ = {
	_A: x,
	_E: x
}, a_ = class {
	context;
	interruptible;
	[r_];
	_stack = [];
	_observers = [];
	_exit;
	_children;
	currentOpCount = 0;
	constructor(e, t = !0) {
		this.context = e, this.interruptible = t, this[r_] = i_;
	}
	getRef(e) {
		return Ur(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), Ce) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	_interrupted = !1;
	unsafeInterrupt() {
		this._exit || (this._interrupted = !0, this.interruptible && this.evaluate(k_));
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
		if (t === f_) return;
		let n = o_.interruptChildren && o_.interruptChildren(this);
		if (n !== void 0) return this.evaluate(w_(n, () => t));
		this._exit = t;
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = !1, n = e;
		this.currentOpCount = 0;
		try {
			for (;;) {
				if (this.currentOpCount++, !t && this.getRef(L_).shouldYield(this)) {
					t = !0;
					let e = n;
					n = w_(x_, () => e);
				}
				if (n = n[c_](this), n === f_) {
					let e = this._yielded;
					return Jg in e ? (this._yielded = void 0, e) : f_;
				}
			}
		} catch (e) {
			return w(n, c_) ? A_(e) : A_(`MicroFiber.runLoop: Not a valid effect: ${String(n)}`);
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[d_] && t[d_](this);
			if (n) return { [e]: n };
			if (t[e]) return t;
		}
	}
	_yielded = void 0;
	yieldWith(e) {
		return this._yielded = e, f_;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
}, o_ = /*#__PURE__*/ C("effect/Micro/fiberMiddleware", () => ({ interruptChildren: void 0 })), s_ = /*#__PURE__*/ Symbol.for("effect/Micro/identifier"), $ = /*#__PURE__*/ Symbol.for("effect/Micro/args"), c_ = /*#__PURE__*/ Symbol.for("effect/Micro/evaluate"), l_ = /*#__PURE__*/ Symbol.for("effect/Micro/successCont"), u_ = /*#__PURE__*/ Symbol.for("effect/Micro/failureCont"), d_ = /*#__PURE__*/ Symbol.for("effect/Micro/ensureCont"), f_ = /*#__PURE__*/ Symbol.for("effect/Micro/Yield"), p_ = {
	_A: x,
	_E: x,
	_R: x
}, m_ = {
	...kh,
	_op: "Micro",
	[qg]: p_,
	pipe() {
		return I(this, arguments);
	},
	[Symbol.iterator]() {
		return new Be(new Ze(this));
	},
	toJSON() {
		return {
			_id: "Micro",
			op: this[s_],
			...$ in this ? { args: this[$] } : void 0
		};
	},
	toString() {
		return F(this);
	},
	[N]() {
		return F(this);
	}
};
function h_(e) {
	return A_("Micro.evaluate: Not implemented");
}
var g_ = (e) => ({
	...m_,
	[s_]: e.op,
	[c_]: e.eval ?? h_,
	[l_]: e.contA,
	[u_]: e.contE,
	[d_]: e.ensure
}), __ = (e) => {
	let t = g_(e);
	return function() {
		let n = Object.create(t);
		return n[$] = e.single === !1 ? arguments : arguments[0], n;
	};
}, v_ = (e) => {
	let t = {
		...g_(e),
		[Jg]: Jg,
		_tag: e.op,
		get [e.prop]() {
			return this[$];
		},
		toJSON() {
			return {
				_id: "MicroExit",
				_tag: e.op,
				[e.prop]: this[$]
			};
		},
		[j](t) {
			return E_(t) && t._tag === e.op && M(this[$], t[$]);
		},
		[E]() {
			return A(this, O(k(e.op))(D(this[$])));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[$] = e, n[l_] = void 0, n[u_] = void 0, n[d_] = void 0, n;
	};
}, y_ = /*#__PURE__*/ v_({
	op: "Success",
	prop: "value",
	eval(e) {
		let t = e.getCont(l_);
		return t ? t[l_](this[$], e) : e.yieldWith(this);
	}
}), b_ = /*#__PURE__*/ v_({
	op: "Failure",
	prop: "cause",
	eval(e) {
		let t = e.getCont(u_);
		for (; n_(this[$]) && t && e.interruptible;) t = e.getCont(u_);
		return t ? t[u_](this[$], e) : e.yieldWith(this);
	}
}), x_ = /*#__PURE__*/ (/* @__PURE__ */ __({
	op: "Yield",
	eval(e) {
		let t = !1;
		return e.getRef(L_).scheduleTask(() => {
			t || e.evaluate(j_);
		}, this[$] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), S_ = /*#__PURE__*/ y_(void 0), C_ = /*#__PURE__*/ __({
	op: "WithMicroFiber",
	eval(e) {
		return this[$](e);
	}
}), w_ = /*#__PURE__*/ b(2, (e, t) => {
	let n = Object.create(T_);
	return n[$] = e, n[l_] = t, n;
}), T_ = /*#__PURE__*/ g_({
	op: "OnSuccess",
	eval(e) {
		return e._stack.push(this), this[$];
	}
}), E_ = (e) => w(e, Jg), D_ = y_, O_ = b_, k_ = /*#__PURE__*/ O_(/*#__PURE__*/ t_()), A_ = (e) => O_($g(e)), j_ = /*#__PURE__*/ D_(void 0), M_ = "setImmediate" in globalThis ? globalThis.setImmediate : (e) => setTimeout(e, 0), N_ = class {
	tasks = [];
	running = !1;
	scheduleTask(e, t) {
		this.tasks.push(e), this.running || (this.running = !0, M_(this.afterScheduled));
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
		return e.currentOpCount >= e.getRef(I_);
	}
	flush() {
		for (; this.tasks.length > 0;) this.runTasks();
	}
}, P_ = /*#__PURE__*/ b(2, (e, t) => C_((n) => {
	let r = n.context;
	return n.context = t(r), B_(e, () => (n.context = r, S_));
})), F_ = /*#__PURE__*/ b(2, (e, t) => P_(e, ii(t))), I_ = class extends (/*#__PURE__*/ si()("effect/Micro/currentMaxOpsBeforeYield", { defaultValue: () => 2048 })) {}, L_ = class extends (/*#__PURE__*/ si()("effect/Micro/currentScheduler", { defaultValue: () => new N_() })) {}, R_ = /*#__PURE__*/ b(2, (e, t) => {
	let n = Object.create(z_);
	return n[$] = e, n[l_] = t.onSuccess, n[u_] = t.onFailure, n;
}), z_ = /*#__PURE__*/ g_({
	op: "OnSuccessAndFailure",
	eval(e) {
		return e._stack.push(this), this[$];
	}
}), B_ = /*#__PURE__*/ b(2, (e, t) => U_((n) => R_(n(e), {
	onFailure: (e) => w_(t(O_(e)), () => b_(e)),
	onSuccess: (e) => w_(t(D_(e)), () => y_(e))
}))), V_ = /*#__PURE__*/ __({
	op: "SetInterruptible",
	ensure(e) {
		if (e.interruptible = this[$], e._interrupted && e.interruptible) return () => k_;
	}
}), H_ = (e) => C_((t) => t.interruptible ? e : (t.interruptible = !0, t._stack.push(V_(!1)), t._interrupted ? k_ : e)), U_ = (e) => C_((t) => t.interruptible ? (t.interruptible = !1, t._stack.push(V_(!0)), e(H_)) : e(x)), W_ = (e, t) => {
	let n = new a_(L_.context(t?.scheduler ?? new N_()));
	if (n.evaluate(e), t?.signal) {
		if (t.signal.aborted) n.unsafeInterrupt();
		else {
			let e = () => n.unsafeInterrupt();
			t.signal.addEventListener("abort", e, { once: !0 }), n.addObserver(() => t.signal.removeEventListener("abort", e));
		}
	}
	return n;
}, G_ = class e {
	scheduleDrain;
	running = !1;
	tasks = /*#__PURE__*/ new K_();
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
}, K_ = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets.length, r, i = 0;
		for (; i < n && this.buckets[i][0] <= t; i++) r = this.buckets[i];
		r && r[0] === t ? r[1].push(e) : i === n ? this.buckets.push([t, [e]]) : this.buckets.splice(i, 0, [t, [e]]);
	}
}, q_ = class {
	maxNextTickBeforeTimer;
	getRunner = /*#__PURE__*/ G_.cached((e, t) => {
		e >= this.maxNextTickBeforeTimer ? setTimeout(() => t(0), 0) : Promise.resolve(void 0).then(() => t(e + 1));
	});
	constructor(e) {
		this.maxNextTickBeforeTimer = e;
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(df) && e.getFiberRef(uf);
	}
	scheduleTask(e, t, n) {
		this.getRunner(n).scheduleTask(e, t);
	}
}, J_ = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Scheduler/defaultScheduler"), () => new q_(2048)), Y_ = class {
	tasks = /*#__PURE__*/ new K_();
	deferred = !1;
	scheduleTask(e, t, n) {
		this.deferred ? J_.scheduleTask(e, t, n) : this.tasks.scheduleTask(e, t);
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(df) && e.getFiberRef(uf);
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) {
			let e = this.tasks.buckets;
			this.tasks.buckets = [];
			for (let [t, n] of e) for (let e = 0; e < n.length; e++) n[e]();
		}
		this.deferred = !0;
	}
}, X_ = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentScheduler"), () => nf(J_)), Z_ = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestMap"), () => nf(/* @__PURE__ */ new Map())), Q_ = (e, t, n, r) => {
	switch (e) {
		case void 0: return t();
		case "unbounded": return n();
		case "inherit": return Zd(gf, (e) => e === "unbounded" ? n() : e > 1 ? r(e) : t());
		default: return e > 1 ? r(e) : t();
	}
}, $_ = "InterruptSignal", ev = "Stateful", tv = "Resume", nv = "YieldNow", rv = (e) => ({
	_tag: $_,
	cause: e
}), iv = (e) => ({
	_tag: ev,
	onFiber: e
}), av = (e) => ({
	_tag: tv,
	effect: e
}), ov = () => ({ _tag: nv }), sv = /*#__PURE__*/ Symbol.for("effect/FiberScope"), cv = class {
	[sv] = sv;
	fiberId = fs;
	roots = /*#__PURE__*/ new Set();
	add(e, t) {
		this.roots.add(t), t.addObserver(() => {
			this.roots.delete(t);
		});
	}
}, lv = class {
	fiberId;
	parent;
	[sv] = sv;
	constructor(e, t) {
		this.fiberId = e, this.parent = t;
	}
	add(e, t) {
		this.parent.tell(iv((e) => {
			e.addChild(t), t.addObserver(() => {
				e.removeChild(t);
			});
		}));
	}
}, uv = (e) => new lv(e.id(), e), dv = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberScope/Global"), () => new cv()), fv = /*#__PURE__*/ Symbol.for("effect/Fiber"), pv = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, mv = {
	[fv]: pv,
	pipe() {
		return I(this, arguments);
	}
}, hv = /*#__PURE__*/ Symbol.for("effect/Fiber"), gv = (e) => Fd(dd(e.await), e.inheritAll);
({ ...Wt }), { ...mv };
var _v = "effect/FiberCurrent", vv = /*#__PURE__*/ Symbol.for("effect/Logger"), yv = {
	/* c8 ignore next */
	_Message: (e) => e,
	/* c8 ignore next */
	_Output: (e) => e
}, bv = (e) => ({
	[vv]: yv,
	log: e,
	pipe() {
		return I(this, arguments);
	}
}), xv = /^[^\s"=]*$/, Sv = /*#__PURE__*/ bv(/*#__PURE__*/ ((e, t) => ({ annotations: n, cause: r, date: i, fiberId: a, logLevel: o, message: s, spans: c }) => {
	let l = (t) => t.match(xv) ? t : e(t), u = (e, t) => `${Dh(e)}=${l(t)}`, d = (e, t) => " " + u(e, t), f = u("timestamp", i.toISOString());
	f += d("level", o.label), f += d("fiber", us(a));
	let p = Fn(s);
	for (let e = 0; e < p.length; e++) f += d("message", ft(p[e], t));
	eu(r) || (f += d("cause", Cu(r, { renderErrorCause: !0 })));
	for (let e of c) f += " " + Oh(i.getTime())(e);
	for (let [e, r] of n) f += d(e, ft(r, t));
	return f;
})((e) => `"${e.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`)), Cv = {
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
Cv.gray, Cv.blue, Cv.green, Cv.yellow, Cv.red, Cv.bgBrightRed, Cv.black;
var wv = typeof process == "object" && process !== null && typeof process.stdout == "object" && process.stdout !== null;
wv && process.stdout.isTTY, wv || "Deno" in globalThis;
// node_modules/effect/dist/esm/internal/metric/boundaries.js
var Tv = "effect/MetricBoundaries", Ev = /*#__PURE__*/ Symbol.for(Tv), Dv = class {
	values;
	[Ev] = Ev;
	constructor(e) {
		this.values = e, this._hash = S(k(Tv), O(ct(this.values)));
	}
	_hash;
	[E]() {
		return this._hash;
	}
	[j](e) {
		return Ov(e) && M(this.values, e.values);
	}
	pipe() {
		return I(this, arguments);
	}
}, Ov = (e) => w(e, Ev), kv = (e) => new Dv(S(e, Rn(_i(Infinity)), vr)), Av = (e) => S(Pn(e.count - 1, (t) => e.start * e.factor ** +t), Ci, kv), jv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType"), Mv = "effect/MetricKeyType/Counter", Nv = /*#__PURE__*/ Symbol.for(Mv), Pv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Frequency"), Fv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Gauge"), Iv = "effect/MetricKeyType/Histogram", Lv = /*#__PURE__*/ Symbol.for(Iv), Rv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Summary"), zv = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Bv = class {
	incremental;
	bigint;
	[jv] = zv;
	[Nv] = Nv;
	constructor(e, t) {
		this.incremental = e, this.bigint = t, this._hash = k(Mv);
	}
	_hash;
	[E]() {
		return this._hash;
	}
	[j](e) {
		return Wv(e);
	}
	pipe() {
		return I(this, arguments);
	}
}, Vv = class {
	boundaries;
	[jv] = zv;
	[Lv] = Lv;
	constructor(e) {
		this.boundaries = e, this._hash = S(k(Iv), O(D(this.boundaries)));
	}
	_hash;
	[E]() {
		return this._hash;
	}
	[j](e) {
		return qv(e) && M(this.boundaries, e.boundaries);
	}
	pipe() {
		return I(this, arguments);
	}
}, Hv = (e) => new Bv(e?.incremental ?? !1, e?.bigint ?? !1), Uv = (e) => new Vv(e), Wv = (e) => w(e, Nv), Gv = (e) => w(e, Pv), Kv = (e) => w(e, Fv), qv = (e) => w(e, Lv), Jv = (e) => w(e, Rv), Yv = /*#__PURE__*/ Symbol.for("effect/MetricKey"), Xv = {
/* c8 ignore next */
_Type: (e) => e }, Zv = /*#__PURE__*/ gr(M), Qv = class {
	name;
	keyType;
	description;
	tags;
	[Yv] = Xv;
	constructor(e, t, n, r = []) {
		this.name = e, this.keyType = t, this.description = n, this.tags = r, this._hash = S(k(this.name + this.description), O(D(this.keyType)), O(ct(this.tags)));
	}
	_hash;
	[E]() {
		return this._hash;
	}
	[j](e) {
		return $v(e) && this.name === e.name && M(this.keyType, e.keyType) && M(this.description, e.description) && Zv(this.tags, e.tags);
	}
	pipe() {
		return I(this, arguments);
	}
}, $v = (e) => w(e, Yv), ey = (e, t) => new Qv(e, Hv(t), Dn(t?.description)), ty = (e, t, n) => new Qv(e, Uv(t), Dn(n)), ny = /*#__PURE__*/ b(2, (e, t) => t.length === 0 ? e : new Qv(e.name, e.keyType, e.description, lr(e.tags, t))), ry = /*#__PURE__*/ Symbol.for("effect/MetricState"), iy = "effect/MetricState/Counter", ay = /*#__PURE__*/ Symbol.for(iy), oy = "effect/MetricState/Frequency", sy = /*#__PURE__*/ Symbol.for(oy), cy = "effect/MetricState/Gauge", ly = /*#__PURE__*/ Symbol.for(cy), uy = "effect/MetricState/Histogram", dy = /*#__PURE__*/ Symbol.for(uy), fy = "effect/MetricState/Summary", py = /*#__PURE__*/ Symbol.for(fy), my = {
/* c8 ignore next */
_A: (e) => e }, hy = class {
	count;
	[ry] = my;
	[ay] = ay;
	constructor(e) {
		this.count = e;
	}
	[E]() {
		return S(D(iy), O(D(this.count)), A(this));
	}
	[j](e) {
		return Ey(e) && this.count === e.count;
	}
	pipe() {
		return I(this, arguments);
	}
}, gy = /*#__PURE__*/ gr(M), _y = class {
	occurrences;
	[ry] = my;
	[sy] = sy;
	constructor(e) {
		this.occurrences = e;
	}
	_hash;
	[E]() {
		return S(k(oy), O(ct(z(this.occurrences.entries()))), A(this));
	}
	[j](e) {
		return Dy(e) && gy(z(this.occurrences.entries()), z(e.occurrences.entries()));
	}
	pipe() {
		return I(this, arguments);
	}
}, vy = class {
	value;
	[ry] = my;
	[ly] = ly;
	constructor(e) {
		this.value = e;
	}
	[E]() {
		return S(D(cy), O(D(this.value)), A(this));
	}
	[j](e) {
		return Oy(e) && this.value === e.value;
	}
	pipe() {
		return I(this, arguments);
	}
}, yy = class {
	buckets;
	count;
	min;
	max;
	sum;
	[ry] = my;
	[dy] = dy;
	constructor(e, t, n, r, i) {
		this.buckets = e, this.count = t, this.min = n, this.max = r, this.sum = i;
	}
	[E]() {
		return S(D(uy), O(D(this.buckets)), O(D(this.count)), O(D(this.min)), O(D(this.max)), O(D(this.sum)), A(this));
	}
	[j](e) {
		return ky(e) && M(this.buckets, e.buckets) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return I(this, arguments);
	}
}, by = class {
	error;
	quantiles;
	count;
	min;
	max;
	sum;
	[ry] = my;
	[py] = py;
	constructor(e, t, n, r, i, a) {
		this.error = e, this.quantiles = t, this.count = n, this.min = r, this.max = i, this.sum = a;
	}
	[E]() {
		return S(D(fy), O(D(this.error)), O(D(this.quantiles)), O(D(this.count)), O(D(this.min)), O(D(this.max)), O(D(this.sum)), A(this));
	}
	[j](e) {
		return Ay(e) && this.error === e.error && M(this.quantiles, e.quantiles) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return I(this, arguments);
	}
}, xy = (e) => new hy(e), Sy = (e) => new _y(e), Cy = (e) => new vy(e), wy = (e) => new yy(e.buckets, e.count, e.min, e.max, e.sum), Ty = (e) => new by(e.error, e.quantiles, e.count, e.min, e.max, e.sum), Ey = (e) => w(e, ay), Dy = (e) => w(e, sy), Oy = (e) => w(e, ly), ky = (e) => w(e, dy), Ay = (e) => w(e, py), jy = /*#__PURE__*/ Symbol.for("effect/MetricHook"), My = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Ny = (e) => ({
	[jy]: My,
	pipe() {
		return I(this, arguments);
	},
	...e
}), Py = /*#__PURE__*/ BigInt(0), Fy = (e) => {
	let t = e.keyType.bigint ? Py : 0, n = e.keyType.incremental ? e.keyType.bigint ? (e) => e >= Py : (e) => e >= 0 : (e) => !0, r = (e) => {
		n(e) && (t += e);
	};
	return Ny({
		get: () => xy(t),
		update: r,
		modify: r
	});
}, Iy = (e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.keyType.preregisteredWords) t.set(n, 0);
	let n = (e) => {
		let n = t.get(e) ?? 0;
		t.set(e, n + 1);
	};
	return Ny({
		get: () => Sy(t),
		update: n,
		modify: n
	});
}, Ly = (e, t) => {
	let n = t;
	return Ny({
		get: () => Cy(n),
		update: (e) => {
			n = e;
		},
		modify: (e) => {
			n += e;
		}
	});
}, Ry = (e) => {
	let t = e.keyType.boundaries.values, n = t.length, r = new Uint32Array(n + 1), i = new Float64Array(n), a = 0, o = 0, s = Number.MAX_VALUE, c = Number.MIN_VALUE;
	S(t, tr(br), fr((e, t) => {
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
		let e = Nn(n), t = 0;
		for (let a = 0; a < n; a++) {
			let n = i[a], o = r[a];
			t += o, e[a] = [n, t];
		}
		return e;
	};
	return Ny({
		get: () => wy({
			buckets: u(),
			count: a,
			min: s,
			max: c,
			sum: o
		}),
		update: l,
		modify: l
	});
}, zy = (e) => {
	let { error: t, maxAge: n, maxSize: r, quantiles: i } = e.keyType, a = S(i, tr(br)), o = Nn(r), s = 0, c = 0, l = 0, u = 0, d = 0, f = (e) => {
		let i = [], s = 0;
		for (; s !== r - 1;) {
			let t = o[s];
			if (t != null) {
				let [r, a] = t, o = ta(e - r);
				ma(o, Zi) && pa(o, n) && i.push(a);
			}
			s += 1;
		}
		return By(t, a, tr(i, br));
	}, p = (e, t) => {
		if (r > 0) {
			s += 1;
			let n = s % r;
			o[n] = [t, e];
		}
		u = c === 0 ? e : Math.min(u, e), d = c === 0 ? e : Math.max(d, e), c += 1, l += e;
	};
	return Ny({
		get: () => Ty({
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
}, By = (e, t, n) => {
	let r = n.length;
	if (!Vn(t)) return ur();
	let i = t[0], a = t.slice(1), o = Vy(e, r, L(), 0, i, n), s = dr(o);
	return a.forEach((t) => {
		s.push(Vy(e, r, o.value, o.consumed, t, o.rest));
	}), fr(s, (e) => [e.quantile, e.value]);
}, Vy = (e, t, n, r, i, a) => {
	let o = e, s = t, c = n, l = r, u = i, d = a, f = e, p = t, m = n, h = r, ee = i, te = a;
	for (;;) {
		if (!Vn(d)) return {
			quantile: u,
			value: L(),
			consumed: l,
			rest: []
		};
		if (u === 1) return {
			quantile: u,
			value: R(Yn(d)),
			consumed: l + d.length,
			rest: []
		};
		let e = qn(d), t = Qn(d, (t) => t === e), n = u * s, r = o / 2 * n, i = l + t[0].length, a = Math.abs(i - n);
		if (i < n - r) f = o, p = s, m = Kn(d), h = i, ee = u, te = t[1], o = f, s = p, c = m, l = h, u = ee, d = te;
		else {
			if (i > n + r) {
				let t = Sn(c) ? R(e) : c;
				return {
					quantile: u,
					value: t,
					consumed: l,
					rest: d
				};
			}
			switch (c._tag) {
				case "None":
					f = o, p = s, m = Kn(d), h = i, ee = u, te = t[1], o = f, s = p, c = m, l = h, u = ee, d = te;
					continue;
				case "Some":
					if (a < Math.abs(n - c.value)) {
						f = o, p = s, m = Kn(d), h = i, ee = u, te = t[1], o = f, s = p, c = m, l = h, u = ee, d = te;
						continue;
					}
					return {
						quantile: u,
						value: R(c.value),
						consumed: l,
						rest: d
					};
			}
		}
	}
	throw Error("BUG: MetricHook.resolveQuantiles - please report an issue at https://github.com/Effect-TS/effect/issues");
}, Hy = /*#__PURE__*/ Symbol.for("effect/MetricPair"), Uy = {
/* c8 ignore next */
_Type: (e) => e }, Wy = (e, t) => ({
	[Hy]: Uy,
	metricKey: e,
	metricState: t,
	pipe() {
		return I(this, arguments);
	}
}), Gy = /*#__PURE__*/ Symbol.for("effect/MetricRegistry"), Ky = class {
	[Gy] = Gy;
	map = /*#__PURE__*/ Ep();
	snapshot() {
		let e = [];
		for (let [t, n] of this.map) e.push(Wy(t, n.get()));
		return e;
	}
	get(e) {
		let t = S(this.map, Dp(e), On);
		if (t == null) {
			if (Wv(e.keyType)) return this.getCounter(e);
			if (Kv(e.keyType)) return this.getGauge(e);
			if (Gv(e.keyType)) return this.getFrequency(e);
			if (qv(e.keyType)) return this.getHistogram(e);
			if (Jv(e.keyType)) return this.getSummary(e);
			throw Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
		}
		return t;
	}
	getCounter(e) {
		let t = S(this.map, Dp(e), On);
		if (t == null) {
			let n = Fy(e);
			S(this.map, kp(e)) || S(this.map, Ap(e, n)), t = n;
		}
		return t;
	}
	getFrequency(e) {
		let t = S(this.map, Dp(e), On);
		if (t == null) {
			let n = Iy(e);
			S(this.map, kp(e)) || S(this.map, Ap(e, n)), t = n;
		}
		return t;
	}
	getGauge(e) {
		let t = S(this.map, Dp(e), On);
		if (t == null) {
			let n = Ly(e, e.keyType.bigint ? BigInt(0) : 0);
			S(this.map, kp(e)) || S(this.map, Ap(e, n)), t = n;
		}
		return t;
	}
	getHistogram(e) {
		let t = S(this.map, Dp(e), On);
		if (t == null) {
			let n = Ry(e);
			S(this.map, kp(e)) || S(this.map, Ap(e, n)), t = n;
		}
		return t;
	}
	getSummary(e) {
		let t = S(this.map, Dp(e), On);
		if (t == null) {
			let n = zy(e);
			S(this.map, kp(e)) || S(this.map, Ap(e, n)), t = n;
		}
		return t;
	}
}, qy = () => new Ky(), Jy = /*#__PURE__*/ Symbol.for("effect/Metric"), Yy = {
	/* c8 ignore next */
	_Type: (e) => e,
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Xy = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Metric/globalMetricRegistry"), () => qy()), Zy = function(e, t, n, r) {
	let i = Object.assign((e) => Sd(e, (e) => rb(i, e)), {
		[Jy]: Yy,
		keyType: e,
		unsafeUpdate: t,
		unsafeValue: n,
		unsafeModify: r,
		register() {
			return this.unsafeValue([]), this;
		},
		pipe() {
			return I(this, arguments);
		}
	});
	return i;
}, Qy = (e, t) => $y(ey(e, t)), $y = (e) => {
	let t, n = /* @__PURE__ */ new WeakMap(), r = (r) => {
		if (r.length === 0) return t === void 0 && (t = Xy.get(e)), t;
		let i = n.get(r);
		return i === void 0 && (i = Xy.get(ny(e, r)), n.set(r, i)), i;
	};
	return Zy(e.keyType, (e, t) => r(t).update(e), (e) => r(e).get(), (e, t) => r(t).modify(e));
}, eb = (e, t, n) => $y(ty(e, t, n)), tb = /*#__PURE__*/ b(3, (e, t, n) => nb(e, [$h(t, n)])), nb = /*#__PURE__*/ b(2, (e, t) => Zy(e.keyType, (n, r) => e.unsafeUpdate(n, lr(t, r)), (n) => e.unsafeValue(lr(t, n)), (n, r) => e.unsafeModify(n, lr(t, r)))), rb = /*#__PURE__*/ b(2, (e, t) => Zd(bf, (n) => Y(() => e.unsafeUpdate(t, n))));
({ ...Ut });
var ib = /*#__PURE__*/ b(2, (e, t) => Zd(Z_, (n) => Y(() => {
	if (n.has(e)) {
		let r = n.get(e);
		r.state.completed || (r.state.completed = !0, up(r.result, t));
	}
}))), ab = /*#__PURE__*/ Symbol.for("effect/Supervisor"), ob = {
/* c8 ignore next */
_T: (e) => e }, sb = class e {
	underlying;
	value0;
	[ab] = ob;
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
		return new e(this, S(this.value, K(t)));
	}
	zip(e) {
		return new cb(this, e);
	}
}, cb = class e {
	left;
	right;
	_tag = "Zip";
	[ab] = ob;
	constructor(e, t) {
		this.left = e, this.right = t;
	}
	get value() {
		return Pd(this.left.value, this.right.value);
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
		return new sb(this, S(this.value, K(e)));
	}
	zip(t) {
		return new e(this, t);
	}
}, lb = (e) => w(e, ab) && Fe(e, "Zip"), ub = class {
	effect;
	[ab] = ob;
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
		return new sb(this, S(this.value, K(e)));
	}
	zip(e) {
		return new cb(this, e);
	}
	onRun(e, t) {
		return e();
	}
}, db = (e) => new ub(e), fb = /*#__PURE__*/ C("effect/Supervisor/none", () => db(X)), pb = Rc, mb = "Empty", hb = "AddSupervisor", gb = "RemoveSupervisor", _b = "AndThen", vb = { _tag: mb }, yb = (e, t) => ({
	_tag: _b,
	first: e,
	second: t
}), bb = (e, t) => xb(t, _i(e)), xb = (e, t) => {
	let n = e, r = t;
	for (; ji(r);) {
		let e = Pi(r);
		switch (e._tag) {
			case mb:
				r = Fi(r);
				break;
			case hb:
				n = n.zip(e.supervisor), r = Fi(r);
				break;
			case gb:
				n = Sb(n, e.supervisor), r = Fi(r);
				break;
			case _b: r = Di(e.first)(Di(e.second)(Fi(r)));
		}
	}
	return n;
}, Sb = (e, t) => M(e, t) ? fb : lb(e) ? Sb(e.left, t).zip(Sb(e.right, t)) : e, Cb = (e) => M(e, fb) ? Lo() : lb(e) ? S(Cb(e.left), Go(Cb(e.right))) : zo(e), wb = /*#__PURE__*/ pb({
	empty: vb,
	patch: bb,
	combine: yb,
	diff: (e, t) => {
		if (M(e, t)) return vb;
		let n = Cb(e), r = Cb(t);
		return yb(S(r, Wo(n), Ko(vb, (e, t) => yb(e, {
			_tag: hb,
			supervisor: t
		}))), S(n, Wo(r), Ko(vb, (e, t) => yb(e, {
			_tag: gb,
			supervisor: t
		}))));
	}
}), Tb = /*#__PURE__*/ Qy("effect_fiber_started", { incremental: !0 }), Eb = /*#__PURE__*/ Qy("effect_fiber_active"), Db = /*#__PURE__*/ Qy("effect_fiber_successes", { incremental: !0 }), Ob = /*#__PURE__*/ Qy("effect_fiber_failures", { incremental: !0 }), kb = /*#__PURE__*/ tb(/*#__PURE__*/ eb("effect_fiber_lifetimes", /*#__PURE__*/ Av({
	start: .5,
	factor: 2,
	count: 35
})), "time_unit", "milliseconds"), Ab = "Continue", jb = "Done", Mb = "Yield", Nb = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Pb = (e) => {
	throw Error(`BUG: FiberRuntime - ${ft(e)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, Fb = /*#__PURE__*/ Symbol.for("effect/internal/fiberRuntime/YieldedOp"), Ib = /*#__PURE__*/ C("effect/internal/fiberRuntime/yieldedOpChannel", () => ({ currentOp: null })), Lb = {
	[Ct]: (e, t, n) => T(() => t.effect_instruction_i1(n)),
	OnStep: (e, t, n) => Q(Q(n)),
	[wt]: (e, t, n) => T(() => t.effect_instruction_i2(n)),
	[Mt]: (e, t, n) => (e.patchRuntimeFlags(e.currentRuntimeFlags, t.patch), il(e.currentRuntimeFlags) && e.isInterrupted() ? Z(e.getInterruptedCause()) : Q(n)),
	[Ot]: (e, t, n) => (T(() => t.effect_instruction_i2(n)), T(() => t.effect_instruction_i0()) ? (e.pushStack(t), T(() => t.effect_instruction_i1())) : X),
	[kt]: (e, t, n) => {
		for (;;) {
			let r = T(() => t.effect_instruction_i0.next(n));
			if (r.done) return Q(r.value);
			let i = Qe(r.value);
			if (!Hf(i)) return e.pushStack(t), i;
			if (i._tag === "Failure") return i;
			n = i.value;
		}
	}
}, Rb = {
	[$_]: (e, t, n, r) => (e.processNewInterruptSignal(r.cause), il(t) ? Z(r.cause) : n),
	[tv]: (e, t, n, r) => {
		throw Error("It is illegal to have multiple concurrent run loops in a single fiber");
	},
	[ev]: (e, t, n, r) => (r.onFiber(e, Wg(t)), n),
	[nv]: (e, t, n, r) => G(Nd(), () => n)
}, zb = (e) => gd(yl(e), (e) => tx(Ll(e), ([e, t]) => {
	let n = /* @__PURE__ */ new Map(), r = [];
	for (let e of t) {
		r.push(bi(e));
		for (let t of e) n.set(t.request, t);
	}
	let i = r.flat();
	return ef(Ox(e.runAll(r), i, () => i.forEach((e) => {
		e.listeners.interrupted = !0;
	})), Z_, n);
}, !1, !1)), Bb = /*#__PURE__*/ Pt(), Vb = class extends jh {
	[fv] = pv;
	[hv] = Nb;
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
		if (super(), this.currentRuntimeFlags = n, this._fiberId = e, this._fiberRefs = t, ll(n)) {
			let e = this.getFiberRef(bf);
			Tb.unsafeUpdate(1, e), Eb.unsafeUpdate(1, e);
		}
		this.refreshRefCache();
	}
	commit() {
		return gv(this);
	}
	id() {
		return this._fiberId;
	}
	resume(e) {
		this.tell(av(e));
	}
	get status() {
		return this.ask((e, t) => t);
	}
	get runtimeFlags() {
		return this.ask((e, t) => Kg(t) ? e.currentRuntimeFlags : t.runtimeFlags);
	}
	scope() {
		return uv(this);
	}
	get children() {
		return this.ask((e) => Array.from(e.getChildren()));
	}
	getChildren() {
		return this._children === null && (this._children = /* @__PURE__ */ new Set()), this._children;
	}
	getInterruptedCause() {
		return this.getFiberRef(Sf);
	}
	fiberRefs() {
		return this.ask((e) => e.getFiberRefs());
	}
	ask(e) {
		return J(() => {
			let t = rp(this._fiberId);
			return this.tell(iv((n, r) => {
				up(t, Y(() => e(n, r)));
			})), op(t);
		});
	}
	tell(e) {
		this._queue.push(e), this._running || (this._running = !0, this.drainQueueLaterOnExecutor());
	}
	get await() {
		return Qu((e) => {
			let t = (t) => e(q(t));
			if (this._exitValue !== null) t(this._exitValue);
			else return this.tell(iv((e, n) => {
				e._exitValue === null ? e.addObserver(t) : t(this._exitValue);
			})), Y(() => this.tell(iv((e, n) => {
				e.removeObserver(t);
			})));
		}, this.id());
	}
	get inheritAll() {
		return H((e, t) => {
			let n = e.id(), r = e.getFiberRefs(), i = t.runtimeFlags, a = ah(r, n, this.getFiberRefs());
			return e.setFiberRefs(a), Ed(S(dl(i, e.getFiberRef(Tx)), gl(1), gl(16)));
		});
	}
	get poll() {
		return Y(() => Dn(this._exitValue));
	}
	unsafePoll() {
		return this._exitValue;
	}
	interruptAsFork(e) {
		return Y(() => this.tell(rv(Xl(e))));
	}
	unsafeInterruptAsFork(e) {
		this.tell(rv(Xl(e)));
	}
	addObserver(e) {
		this._exitValue === null ? this._observers.push(e) : e(this._exitValue);
	}
	removeObserver(e) {
		this._observers = this._observers.filter((t) => t !== e);
	}
	getFiberRefs() {
		return this.setFiberRef(Tx, this.currentRuntimeFlags), this._fiberRefs;
	}
	unsafeDeleteFiberRef(e) {
		this._fiberRefs = ch(this._fiberRefs, e);
	}
	getFiberRef(e) {
		return this._fiberRefs.locals.has(e) ? this._fiberRefs.locals.get(e)[0][1] : e.initial;
	}
	setFiberRef(e, t) {
		this._fiberRefs = dh(this._fiberRefs, {
			fiberId: this._fiberId,
			fiberRef: e,
			value: t
		}), this.refreshRefCache();
	}
	refreshRefCache() {
		this.currentDefaultServices = this.getFiberRef($m), this.currentTracer = this.currentDefaultServices.unsafeMap.get(Km.key), this.currentSupervisor = this.getFiberRef(Ex), this.currentScheduler = this.getFiberRef(X_), this.currentContext = this.getFiberRef(lf), this.currentSpan = this.currentContext.unsafeMap.get(qm.key);
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
			let t = Ab, n = globalThis[_v];
			globalThis[_v] = this;
			try {
				for (; t === Ab;) t = this._queue.length === 0 ? jb : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
			} finally {
				this._running = !1, globalThis[_v] = n;
			}
			this._queue.length > 0 && !this._running ? (this._running = !0, t === Mb ? (this.drainQueueLaterOnExecutor(), e = !1) : e = !0) : e = !1;
		}
	}
	drainQueueLaterOnExecutor() {
		this.currentScheduler.scheduleTask(this.run, this.getFiberRef(uf), this);
	}
	drainQueueWhileRunning(e, t) {
		let n = t;
		for (; this._queue.length > 0;) {
			let t = this._queue.splice(0, 1)[0];
			n = Rb[t._tag](this, e, n, t);
		}
		return n;
	}
	isInterrupted() {
		return !tu(this.getFiberRef(Sf));
	}
	addInterruptedCause(e) {
		let t = this.getFiberRef(Sf);
		this.setFiberRef(Sf, Ql(t, e));
	}
	processNewInterruptSignal(e) {
		this.addInterruptedCause(e), this.sendInterruptSignalToAllChildren();
	}
	sendInterruptSignalToAllChildren() {
		if (this._children === null || this._children.size === 0) return !1;
		let e = !1;
		for (let t of this._children) t.tell(rv(Xl(this.id()))), e = !0;
		return e;
	}
	interruptAllChildren() {
		if (this.sendInterruptSignalToAllChildren()) {
			let e = this._children.values();
			this._children = null;
			let t = !1;
			return Od({
				while: () => !t,
				body: () => {
					let n = e.next();
					return n.done ? Y(() => {
						t = !0;
					}) : Ju(n.value.await);
				},
				step: () => {}
			});
		}
		return null;
	}
	reportExitValue(e) {
		if (ll(this.currentRuntimeFlags)) {
			let t = this.getFiberRef(bf), n = this.id().startTimeMillis, r = Date.now();
			switch (kb.unsafeUpdate(r - n, t), Eb.unsafeUpdate(-1, t), e._tag) {
				case Tt:
					Db.unsafeUpdate(1, t);
					break;
				case xt: Ob.unsafeUpdate(1, t);
			}
		}
		if (e._tag === "Failure") {
			let t = this.getFiberRef(vf);
			!ru(e.cause) && t._tag === "Some" && this.log("Fiber terminated with an unhandled error", e.cause, t);
		}
	}
	setExitValue(e) {
		this._exitValue = e, this.reportExitValue(e);
		for (let t = this._observers.length - 1; t >= 0; t--) this._observers[t](e);
		this._observers = [];
	}
	getLoggers() {
		return this.getFiberRef(Kb);
	}
	log(e, t, n) {
		let r = Cn(n) ? n.value : this.getFiberRef(pf);
		if (Th(this.getFiberRef(Hb), r)) return;
		let i = this.getFiberRef(mf), a = this.getFiberRef(ff), o = this.getLoggers(), s = this.getFiberRefs();
		if (Vo(o) > 0) {
			let n = ti(this.getFiberRef($m), Np), c = new Date(n.unsafeCurrentTimeMillis());
			_t(s, () => {
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
			case nv: return Mb;
			case $_: return this.processNewInterruptSignal(e.cause), this._asyncInterruptor !== null && (this._asyncInterruptor(Z(e.cause)), this._asyncInterruptor = null), Ab;
			case tv: return this._asyncInterruptor = null, this._asyncBlockingOn = null, this.evaluateEffect(e.effect), Ab;
			case ev: return e.onFiber(this, this._exitValue === null ? Gg(this.currentRuntimeFlags, this._asyncBlockingOn) : Ug), Ab;
			default: return Pb(e);
		}
	}
	evaluateEffect(e) {
		this.currentSupervisor.onResume(this);
		try {
			let t = il(this.currentRuntimeFlags) && this.isInterrupted() ? Z(this.getInterruptedCause()) : e;
			for (; t !== null;) {
				let e = t, n = this.runLoop(e);
				if (n === Fb) {
					let e = Ib.currentOp;
					Ib.currentOp = null, e._op === "Yield" ? tl(this.currentRuntimeFlags) ? (this.tell(ov()), this.tell(av(ep)), t = null) : t = ep : e._op === "Async" && (t = null);
				} else {
					this.currentRuntimeFlags = S(this.currentRuntimeFlags, rl(16));
					let e = this.interruptAllChildren();
					e === null ? (this._queue.length === 0 ? this.setExitValue(n) : this.tell(av(n)), t = null) : t = G(e, () => n);
				}
			}
		} finally {
			this.currentSupervisor.onSuspend(this);
		}
	}
	start(e) {
		if (this._running) this.tell(av(e));
		else {
			this._running = !0;
			let t = globalThis[_v];
			globalThis[_v] = this;
			try {
				this.evaluateEffect(e);
			} finally {
				this._running = !1, globalThis[_v] = t, this._queue.length > 0 && this.drainQueueLaterOnExecutor();
			}
		}
	}
	startFork(e) {
		this.tell(av(e));
	}
	patchRuntimeFlags(e, t) {
		let n = fl(e, t);
		return globalThis[_v] = this, this.currentRuntimeFlags = n, n;
	}
	initiateAsync(e, t) {
		let n = !1, r = (e) => {
			n || (n = !0, this.tell(av(e)));
		};
		il(e) && (this._asyncInterruptor = r);
		try {
			t(r);
		} catch (e) {
			r(W(Yl(e)));
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
		return Y(() => ni(this.currentContext, e));
	}
	Left(e) {
		return U(e.left);
	}
	None(e) {
		return U(new zf());
	}
	Right(e) {
		return Q(e.right);
	}
	Some(e) {
		return Q(e.value);
	}
	Micro(e) {
		return Xu((t) => {
			let n = t, r = W_(F_(e, this.currentContext));
			return r.addObserver((e) => {
				if (e._tag === "Success") return n(Q(e.value));
				switch (e.cause._tag) {
					case "Interrupt": return n(Z(Xl(fs)));
					case "Fail": return n(U(e.cause.error));
					case "Die": return n(nd(e.cause.defect));
				}
			}), Xu((e) => {
				n = (t) => {
					e(X);
				}, r.unsafeInterrupt();
			});
		});
	}
	[Et](e) {
		let t = T(() => e.effect_instruction_i0()), n = this.getNextSuccessCont();
		return n === void 0 ? (Ib.currentOp = Q(t), Fb) : (n._op in Lb || Pb(n), Lb[n._op](this, n, t));
	}
	[Tt](e) {
		let t = e, n = this.getNextSuccessCont();
		return n === void 0 ? (Ib.currentOp = t, Fb) : (n._op in Lb || Pb(n), Lb[n._op](this, n, t.effect_instruction_i0));
	}
	[xt](e) {
		let t = e.effect_instruction_i0, n = this.getNextFailCont();
		if (n !== void 0) switch (n._op) {
			case St:
			case wt: return il(this.currentRuntimeFlags) && this.isInterrupted() ? Z(uu(t)) : T(() => n.effect_instruction_i1(t));
			case "OnStep": return il(this.currentRuntimeFlags) && this.isInterrupted() ? Z(uu(t)) : Q(Z(t));
			case Mt: return this.patchRuntimeFlags(this.currentRuntimeFlags, n.patch), il(this.currentRuntimeFlags) && this.isInterrupted() ? Z(Ql(t, this.getInterruptedCause())) : Z(t);
			default: Pb(n);
		}
		else return Ib.currentOp = Z(t), Fb;
	}
	[At](e) {
		return T(() => e.effect_instruction_i0(this, Wg(this.currentRuntimeFlags)));
	}
	Blocked(e) {
		let t = this.getFiberRefs(), n = this.currentRuntimeFlags;
		if (this._steps.length > 0) {
			let r = [], i = this._steps[this._steps.length - 1], a = this.popStack();
			for (; a && a._op !== "OnStep";) r.push(a), a = this.popStack();
			this.setFiberRefs(i.refs), this.currentRuntimeFlags = i.flags;
			let o = Dg(i.refs, t), s = dl(i.flags, n);
			return Q(zu(e.effect_instruction_i0, H((t) => {
				for (; r.length > 0;) t.pushStack(r.pop());
				return t.setFiberRefs(Og(t.id(), t.getFiberRefs())(o)), t.currentRuntimeFlags = fl(s)(t.currentRuntimeFlags), e.effect_instruction_i1;
			})));
		}
		return Td((t) => G(rx(Bu(e.effect_instruction_i0)), () => t(e.effect_instruction_i1)));
	}
	RunBlocked(e) {
		return zb(e.effect_instruction_i0);
	}
	[Dt](e) {
		let t = e.effect_instruction_i0, n = this.currentRuntimeFlags, r = fl(n, t);
		if (il(r) && this.isInterrupted()) return Z(this.getInterruptedCause());
		if (this.patchRuntimeFlags(this.currentRuntimeFlags, t), e.effect_instruction_i1) {
			let t = dl(r, n);
			return this.pushStack(new Hu(t, e)), T(() => e.effect_instruction_i1(n));
		}
		return ep;
	}
	[Ct](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	OnStep(e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[St](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[wt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[yt](e) {
		return this._asyncBlockingOn = e.effect_instruction_i1, this.initiateAsync(this.currentRuntimeFlags, e.effect_instruction_i0), Ib.currentOp = e, Fb;
	}
	[jt](e) {
		return this._isYielding = !1, Ib.currentOp = e, Fb;
	}
	[Ot](e) {
		let t = e.effect_instruction_i0, n = e.effect_instruction_i1;
		return t() ? (this.pushStack(e), n()) : ep;
	}
	[kt](e) {
		return Lb[kt](this, e, void 0);
	}
	[bt](e) {
		return T(() => e.commit());
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
					t = G(Nd({ priority: e }), () => n);
				}
			}
			try {
				if (t = this.currentTracer.context(() => {
					if (Bb !== t[Vu]._V) {
						let e = this.getFiberRef(yf);
						if (e._tag === "Some") {
							let n = t[Vu]._V;
							this.log(`Executing an Effect versioned ${n} with a Runtime of version ${Pt()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, ql, e);
						}
					}
					return this[t._op](t);
				}, this), t === Fb) {
					let e = Ib.currentOp;
					return e._op === "Yield" || e._op === "Async" ? Fb : (Ib.currentOp = null, e._op === "Success" || e._op === "Failure" ? e : Z(Yl(e)));
				}
			} catch (e) {
				t = t !== Fb && !w(t, "_op") || !(t._op in this) ? rd(`Not a valid effect: ${ft(t)}`) : Lf(e) ? Z(Ql(Yl(e), Xl(fs))) : nd(e);
			}
		}
	}
	run = () => {
		this.drainQueueOnCurrentThread();
	};
}, Hb = /*#__PURE__*/ C("effect/FiberRef/currentMinimumLogLevel", () => nf(Eh("Info"))), Ub = (e) => bv((t) => {
	ti(mh(t.context, $m), Im).unsafe.log(e.log(t));
}), Wb = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Logger/defaultLogger"), () => Ub(Sv)), Gb = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Logger/tracerLogger"), () => bv(({ annotations: e, cause: t, context: n, fiberId: r, logLevel: i, message: a }) => {
	let o = hg(ri(uh(n, lf), qm));
	if (o._tag === "None" || o.value._tag === "ExternalSpan") return;
	let s = ni(uh(n, $m), Np), c = {};
	for (let [t, n] of e) c[t] = n;
	c["effect.fiberId"] = ms(r), c["effect.logLevel"] = i.label, t !== null && t._tag !== "Empty" && (c["effect.cause"] = Cu(t, { renderErrorCause: !0 })), o.value.event(ft(Array.isArray(a) && a.length === 1 ? a[0] : a), s.unsafeCurrentTimeNanos(), c);
})), Kb = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLoggers"), () => rf(zo(Wb, Gb))), qb = /*#__PURE__*/ b((e) => Gu(e[0]), (e, t) => wd(Sd(e, (e) => Jb((n) => t(e, n))))), Jb = (e) => H((t) => {
	let n = t.getFiberRefs(), r = nl(t.currentRuntimeFlags, 1);
	return G(_x, (t) => Ef(t, (t) => H((i) => {
		let a = i.getFiberRefs(), o = i.currentRuntimeFlags, s = Dg(a, n), c = dl(o, r), l = Dg(n, a);
		return i.setFiberRefs(Og(s, i.id(), n)), Dx(Md(e(t), c), Y(() => {
			i.setFiberRefs(Og(l, i.id(), i.getFiberRefs()));
		}));
	})));
}), Yb = (e) => {
	if (Array.isArray(e) || Le(e)) return [e, L()];
	let t = Object.keys(e), n = t.length;
	return [t.map((t) => e[t]), R((e) => {
		let r = {};
		for (let i = 0; i < n; i++) r[t[i]] = e[i];
		return r;
	})];
}, Xb = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(id(t));
	return G($b(r, x, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => {
		let r = L(), i = e.length, a = Array(i), o = Array(i), s = !1;
		for (let t = 0; t < i; t++) {
			let n = e[t];
			n._tag === "Left" ? (a[t] = R(n.left), s = !0) : (o[t] = n.right, a[t] = r);
		}
		return s ? t._tag === "Some" ? U(t.value(a)) : U(a) : n?.discard ? X : t._tag === "Some" ? q(t.value(o)) : q(o);
	});
}, Zb = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(id(t));
	return n?.discard ? $b(r, x, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		discard: !0,
		concurrentFinalizers: n?.concurrentFinalizers
	}) : K($b(r, x, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => t._tag === "Some" ? t.value(e) : e);
}, Qb = (e, t) => {
	let [n, r] = Yb(e);
	return t?.mode === "validate" ? Xb(n, r, t) : t?.mode === "either" ? Zb(n, r, t) : t?.discard !== !0 && r._tag === "Some" ? K($b(n, x, t), r.value) : $b(n, x, t);
}, $b = /*#__PURE__*/ b((e) => Le(e[0]), (e, t, n) => H((r) => {
	let i = n?.batching === !0 || n?.batching === "inherit" && r.getFiberRef(_f);
	return n?.discard ? Q_(n.concurrency, () => ux(wg, n?.concurrentFinalizers)((n) => i ? tx(e, (e, r) => n(t(e, r)), !0, !1, 1) : gd(e, (e, r) => n(t(e, r)))), () => ux(Tg, n?.concurrentFinalizers)((n) => tx(e, (e, r) => n(t(e, r)), i, !1)), (r) => ux(Eg(r), n?.concurrentFinalizers)((n) => tx(e, (e, r) => n(t(e, r)), i, !1, r))) : Q_(n?.concurrency, () => ux(wg, n?.concurrentFinalizers)((n) => i ? nx(e, 1, (e, r) => n(t(e, r)), !0) : hd(e, (e, r) => n(t(e, r)))), () => ux(Tg, n?.concurrentFinalizers)((n) => ex(e, (e, r) => n(t(e, r)), i)), (r) => ux(Eg(r), n?.concurrentFinalizers)((n) => nx(e, r, (e, r) => n(t(e, r)), i)));
})), ex = (e, t, n) => J(() => {
	let r = z(e), i = Array(r.length);
	return Id(tx(r, (e, n) => G(t(e, n), (e) => Y(() => i[n] = e)), n, !1), q(i));
}), tx = (e, t, n, r, i) => Td((a) => Cd((o) => H((s) => {
	let c = Array.from(e).reverse(), l = c.length;
	if (l === 0) return X;
	let u = 0, d = !1, f = i ? Math.min(c.length, i) : c.length, p = /* @__PURE__ */ new Set(), m = [], h = () => p.forEach((e) => {
		e.currentScheduler.scheduleTask(() => {
			e.unsafeInterruptAsFork(s.id());
		}, 0, e);
	}), ee = [], te = [], ne = [], g = () => {
		let e = m.filter(({ exit: e }) => e._tag === "Failure").sort((e, t) => e.index < t.index ? -1 : e.index === t.index ? 0 : 1).map(({ exit: e }) => e);
		return e.length === 0 && e.push(ep), e;
	}, re = (e, t = !1) => {
		let n = wd(o(e)), r = ax(n, s, s.currentRuntimeFlags, dv);
		return s.currentScheduler.scheduleTask(() => {
			t && r.unsafeInterruptAsFork(s.id()), r.resume(n);
		}, 0, r), r;
	}, _ = () => {
		r || (l -= c.length, c = []), d = !0, h();
	}, v = n ? ud : ad, ie = re(Qu((e) => {
		let r = (e, t) => {
			e._op === "Blocked" ? ne.push(e) : (m.push({
				index: t,
				exit: e
			}), e._op === "Failure" && !d && _());
		}, o = () => {
			if (c.length > 0) {
				let f = c.pop(), h = u++, _ = () => {
					let e = c.pop();
					return h = u++, G(Nd(), () => G(v(a(t(e, h))), ie));
				}, ie = (e) => c.length > 0 && (r(e, h), c.length > 0) ? _() : q(e), ae = G(v(a(t(f, h))), ie), oe = re(ae);
				ee.push(oe), p.add(oe), d && oe.currentScheduler.scheduleTask(() => {
					oe.unsafeInterruptAsFork(s.id());
				}, 0, oe), oe.addObserver((t) => {
					let a;
					if (a = t._op === "Failure" ? t : t.effect_instruction_i0, te.push(oe), p.delete(oe), r(a, h), m.length === l) e(q(Tn(qf(g(), { parallel: !0 }), () => ep)));
					else if (ne.length + m.length === l) {
						let t = g();
						e(q(zu(ne.map((e) => e.effect_instruction_i0).reduce(_l), tx([Tn(qf(t, { parallel: !0 }), () => ep), ...ne.map((e) => e.effect_instruction_i1)], (e) => e, n, !0, i))));
					} else o();
				});
			}
		};
		for (let e = 0; e < f; e++) o();
	}));
	return Ju(bd(dd(a(gv(ie))), Qf({
		onFailure: (e) => {
			_();
			let t = ne.length + 1, n = Math.min(typeof i == "number" ? i : ne.length, ne.length), r = Array.from(ne);
			return Qu((i) => {
				let a = [], o = 0, s = 0, c = (n, s) => (c) => {
					a[n] = c, o++, o === t && i(Q(Z(e))), r.length > 0 && s && l();
				}, l = () => {
					re(r.pop(), !0).addObserver(c(s, !0)), s++;
				};
				ie.addObserver(c(s, !1)), s++;
				for (let e = 0; e < n; e++) l();
			});
		},
		onSuccess: () => hd(te, (e) => e.inheritAll)
	})));
}))), nx = (e, t, n, r) => J(() => {
	let i = z(e), a = Array(i.length);
	return Id(tx(i, (e, t) => K(n(e, t), (e) => a[t] = e), r, !1, t), q(a));
}), rx = (e) => sx(e, dv), ix = (e, t, n, r = null) => {
	let i = ox(e, t, n, r);
	return i.resume(e), i;
}, ax = (e, t, n, r = null) => ox(e, t, n, r), ox = (e, t, n, r = null) => {
	let i = hs(), a = oh(t.getFiberRefs(), i), o = new Vb(i, a, n), s = uh(a, lf), c = o.currentSupervisor;
	return c.onStart(s, e, R(t), o), o.addObserver((e) => c.onEnd(e, o)), (r === null ? S(t.getFiberRef(xf), Tn(() => t.scope())) : r).add(n, o), o;
}, sx = (e, t) => H((n, r) => q(ix(e, n, r.runtimeFlags, t))), cx = (e) => mp((t) => wn(ri(t, gx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Parallel": return e;
			case "Sequential":
			case "ParallelN": return G(Of(t, Tg), (t) => Sx(e, t));
		}
	}
})), lx = (e) => (t) => mp((n) => wn(ri(n, gx), {
	onNone: () => t,
	onSome: (n) => n.strategy._tag === "ParallelN" && n.strategy.parallelism === e ? t : G(Of(n, Eg(e)), (e) => Sx(t, e))
})), ux = (e, t) => (n) => mp((r) => wn(ri(r, gx), {
	onNone: () => n(x),
	onSome: (r) => {
		if (t === !0) {
			let t = e._tag === "Parallel" ? cx : e._tag === "Sequential" ? mx : lx(e.parallelism);
			switch (r.strategy._tag) {
				case "Parallel": return t(n(cx));
				case "Sequential": return t(n(mx));
				case "ParallelN": return t(n(lx(r.strategy.parallelism)));
			}
		} else return n(x);
	}
})), dx = (e) => G(gx, e), fx = (e) => G(xx(), (t) => bd(e(t), (e) => t.close(e))), px = (e) => G(xx(), (t) => Cx(e, t)), mx = (e) => mp((t) => wn(ri(t, gx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Sequential": return e;
			case "Parallel":
			case "ParallelN": return G(Of(t, wg), (t) => Sx(e, t));
		}
	}
})), hx = /*#__PURE__*/ b((e) => Gu(e[1]), (e, t, n, r) => K(Qb([e, t], {
	concurrency: r?.concurrent ? 2 : 1,
	batching: r?.batching,
	concurrentFinalizers: r?.concurrentFinalizers
}), ([e, t]) => n(e, t))), gx = /*#__PURE__*/ Yr("effect/Scope"), _x = gx, vx = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.set({}, t);
}, yx = {
	[Cf]: Cf,
	[wf]: wf,
	pipe() {
		return I(this, arguments);
	},
	fork(e) {
		return Y(() => {
			let t = bx(e);
			if (this.state._tag === "Closed") return t.state = this.state, t;
			let n = {};
			return this.state.finalizers.set(n, (e) => t.close(e)), vx(t, (e) => Y(() => {
				this.state._tag === "Open" && this.state.finalizers.delete(n);
			})), t;
		});
	},
	close(e) {
		return J(() => {
			if (this.state._tag === "Closed") return X;
			let t = Array.from(this.state.finalizers.values()).reverse();
			return this.state = {
				_tag: "Closed",
				exit: e
			}, t.length === 0 ? X : Sg(this.strategy) ? S(hd(t, (t) => ad(t(e))), G((e) => S(qf(e), kn(Kf), Tn(() => ep)))) : Cg(this.strategy) ? S(ex(t, (t) => ad(t(e)), !1), G((e) => S(qf(e, { parallel: !0 }), kn(Kf), Tn(() => ep)))) : S(nx(t, this.strategy.parallelism, (t) => ad(t(e)), !1), G((e) => S(qf(e, { parallel: !0 }), kn(Kf), Tn(() => ep))));
		});
	},
	addFinalizer(e) {
		return J(() => this.state._tag === "Closed" ? e(this.state.exit) : (this.state.finalizers.set({}, e), X));
	}
}, bx = (e = yg) => {
	let t = Object.create(yx);
	return t.strategy = e, t.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map()
	}, t;
}, xx = (e = yg) => Y(() => bx(e)), Sx = /*#__PURE__*/ b(2, (e, t) => _p(e, ii($r(gx, t)))), Cx = /*#__PURE__*/ b(2, (e, t) => S(e, Sx(t), bd((e) => t.close(e)))), wx = (e) => sf(e, {
	differ: wb,
	fork: vb
}), Tx = /*#__PURE__*/ cf(cl), Ex = /*#__PURE__*/ wx(fb), Dx = /*#__PURE__*/ b(2, (e, t) => Td((n) => pd(n(e), {
	onFailure: (e) => pd(t, {
		onFailure: (t) => W(Ql(e, t)),
		onSuccess: () => W(e)
	}),
	onSuccess: (e) => qu(t, e)
}))), Ox = (e, t, n) => ld((r) => Dx(G(rx(_d(e)), (e) => Qu((r) => {
	let i = t.map((e) => e.listeners.count), a = () => {
		i.every((e) => e === 0) && t.every((e) => !!(e.result.state.current._tag === "Pending" || e.result.state.current._tag === "Done" && Hf(e.result.state.current.effect) && e.result.state.current.effect._tag === "Failure" && nu(e.result.state.current.effect.cause))) && (o.forEach((e) => e()), n?.(), r(Rd(e)));
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
	return a(), Y(() => {
		o.forEach((e) => e());
	});
})), J(() => gd(t.flatMap((e) => e.state.completed ? [] : [e]), (e) => ib(e.request, Xf(r)))))), kx = su, Ax = kf, jx = Tf, Mx = Df, Nx = Sx, Px = Of, Fx = xx, Ix = class {
	permits;
	waiters = /*#__PURE__*/ new Set();
	taken = 0;
	constructor(e) {
		this.permits = e;
	}
	get free() {
		return this.permits - this.taken;
	}
	take = (e) => Zu((t) => {
		if (this.free < e) {
			let n = () => {
				this.free < e || (this.waiters.delete(n), t(J(() => this.free < e ? this.take(e) : (this.taken += e, q(e)))));
			};
			return this.waiters.add(n), Y(() => {
				this.waiters.delete(n);
			});
		}
		t(J(() => this.free < e ? this.take(e) : (this.taken += e, q(e))));
	});
	updateTakenUnsafe(e, t) {
		return this.taken = t(this.taken), this.waiters.size > 0 && e.getFiberRef(X_).scheduleTask(() => {
			let e = this.waiters.values(), t = e.next();
			for (; t.done === !1 && this.free > 0;) t.value(), t = e.next();
		}, e.getFiberRef(uf), e), q(this.free);
	}
	updateTaken(e) {
		return H((t) => this.updateTakenUnsafe(t, e));
	}
	resize = (e) => Ju(H((t) => (this.permits = e, this.free < 0 ? X : this.updateTakenUnsafe(t, (e) => e))));
	release = (e) => this.updateTaken((t) => t - e);
	releaseAll = /*#__PURE__*/ this.updateTaken((e) => 0);
	withPermits = (e) => (t) => Td((n) => G(n(this.take(e)), (e) => Dx(n(t), this.release(e))));
	withPermitsIfAvailable = (e) => (t) => Td((n) => J(() => this.free < e ? ug : (this.taken += e, Dx(n(tg(t)), this.release(e)))));
}, Lx = (e) => new Ix(e), Rx = /*#__PURE__*/ Symbol.for("effect/Ref/SynchronizedRef"), zx = {
/* c8 ignore next */
_A: (e) => e }, Bx = class extends jh {
	ref;
	withLock;
	[Rx] = zx;
	[Nh] = Ph;
	[Mh] = Mh;
	constructor(e, t) {
		super(), this.ref = e, this.withLock = t, this.get = Rh(this.ref);
	}
	get;
	commit() {
		return this.get;
	}
	modify(e) {
		return this.modifyEffect((t) => q(e(t)));
	}
	modifyEffect(e) {
		return this.withLock(S(G(Rh(this.ref), e), G(([e, t]) => qu(zh(this.ref, t), e))));
	}
}, Vx = (e) => Y(() => Hx(e)), Hx = (e) => new Bx(Ih(e), Lx(1).withPermits(1)), Ux = /*#__PURE__*/ Symbol.for("effect/ManagedRuntime"), Wx = "Fresh", Gx = "FromEffect", Kx = "MergeAll", qx = (e) => function() {
	if (arguments.length === 1) {
		let t = arguments[0];
		return (n, ...r) => e(t, n, ...r);
	}
	return e.apply(this, arguments);
}, Jx = /*#__PURE__*/ qx((e, t, n) => {
	let r = hs(), i = [[lf, [[r, e.context]]]];
	n?.scheduler && i.push([X_, [[r, n.scheduler]]]);
	let a = hh(e.fiberRefs, {
		entries: i,
		forkAs: r
	});
	n?.updateRefs && (a = n.updateRefs(a, r));
	let o = new Vb(r, a, e.runtimeFlags), s = t;
	n?.scope && (s = G(Px(n.scope, yg), (e) => Id(Tf(e, ld((e) => M(e, o.id()) ? X : zd(o, e))), bd(t, (t) => Mx(e, t)))));
	let c = o.currentSupervisor;
	return c !== fb && (c.onStart(e.context, s, L(), o), o.addObserver((e) => c.onEnd(e, o))), dv.add(e.runtimeFlags, o), n?.immediate === !1 ? o.resume(s) : o.start(s), o;
}), Yx = /*#__PURE__*/ qx((e, t) => {
	let n = rS(e)(t);
	if (n._tag === "Failure") throw tS(n.effect_instruction_i0);
	return n.effect_instruction_i0;
}), Xx = class extends Error {
	fiber;
	_tag = "AsyncFiberException";
	constructor(e) {
		super(`Fiber #${e.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`), this.fiber = e, this.name = this._tag, this.stack = this.message;
	}
}, Zx = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new Xx(e);
	return Error.stackTraceLimit = t, n;
}, Qx = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure"), $x = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure/Cause"), eS = class extends Error {
	[Qx];
	[$x];
	constructor(e) {
		let t = ju(e)[0];
		super(t?.message || "An error has occurred"), this[Qx] = Qx, this[$x] = e, this.name = t ? `(FiberFailure) ${t.name}` : "FiberFailure", t?.stack && (this.stack = t.stack);
	}
	toJSON() {
		return {
			_id: "FiberFailure",
			cause: this[$x].toJSON()
		};
	}
	toString() {
		return "(FiberFailure) " + Cu(this[$x], { renderErrorCause: !0 });
	}
	[N]() {
		return this.toString();
	}
}, tS = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new eS(e);
	return Error.stackTraceLimit = t, n;
}, nS = (e) => {
	let t = e;
	switch (t._op) {
		case "Failure":
		case "Success": return t;
		case "Left": return Yf(t.left);
		case "Right": return Q(t.right);
		case "Some": return Q(t.value);
		case "None": return Yf(new zf());
	}
}, rS = /*#__PURE__*/ qx((e, t) => {
	let n = nS(t);
	if (n) return n;
	let r = new Y_(), i = Jx(e)(t, { scheduler: r });
	return r.flush(), i.unsafePoll() || Jf(td(Zx(i), vp(i)));
}), iS = /*#__PURE__*/ qx((e, t, n) => aS(e, t, n).then((e) => {
	switch (e._tag) {
		case Tt: return e.effect_instruction_i0;
		case xt: throw tS(e.effect_instruction_i0);
	}
})), aS = /*#__PURE__*/ qx((e, t, n) => new Promise((r) => {
	let i = nS(t);
	i && r(i);
	let a = Jx(e)(t);
	a.addObserver((e) => {
		r(e);
	}), n?.signal !== void 0 && (n.signal.aborted ? a.unsafeInterruptAsFork(a.id()) : n.signal.addEventListener("abort", () => {
		a.unsafeInterruptAsFork(a.id());
	}, { once: !0 }));
})), oS = class {
	context;
	runtimeFlags;
	fiberRefs;
	constructor(e, t, n) {
		this.context = e, this.runtimeFlags = t, this.fiberRefs = n;
	}
	pipe() {
		return I(this, arguments);
	}
}, sS = /*#__PURE__*/ ((e) => new oS(e.context, e.runtimeFlags, e.fiberRefs))({
	context: /*#__PURE__*/ Qr(),
	runtimeFlags: /* @__PURE__ */ sl(1, 32, 4),
	fiberRefs: /*#__PURE__*/ gh()
}), cS = /*#__PURE__*/ iS(sS), lS = /*#__PURE__*/ aS(sS), uS = /*#__PURE__*/ Yx(sS), dS = /*#__PURE__*/ b(2, (e, t) => e.modifyEffect(t)), fS = /*#__PURE__*/ Symbol.for("effect/Layer"), pS = {
	/* c8 ignore next */
	_RIn: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_ROut: (e) => e
}, mS = {
	[fS]: pS,
	pipe() {
		return I(this, arguments);
	}
}, hS = /*#__PURE__*/ Symbol.for("effect/Layer/MemoMap"), gS = /*#__PURE__*/ si()("effect/Layer/CurrentMemoMap", { defaultValue: () => xS() }), _S = (e) => w(e, fS), vS = (e) => e._op_layer === Wx, yS = class {
	ref;
	[hS];
	constructor(e) {
		this.ref = e, this[hS] = hS;
	}
	getOrElseMemoize(e, t) {
		return S(dS(this.ref, (n) => {
			let r = n.get(e);
			if (r !== void 0) {
				let [e, i] = r;
				return q([S(e, G(([e, t]) => S(sg(e), qu(t))), bd(Qf({
					onFailure: () => X,
					onSuccess: () => Ef(t, i)
				}))), n]);
			}
			return S(Lh(0), G((r) => S(ip(), G((i) => S(Lh(() => X), K((a) => {
				let o = Td((o) => S(xx(), G((s) => S(o(G(wS(e, s, !0), (e) => rg(e(this)))), ad, G((o) => {
					switch (o._tag) {
						case xt: return S(cp(i, o.effect_instruction_i0), Id(Df(s, o)), Id(W(o.effect_instruction_i0)));
						case Tt: return S(zh(a, (e) => S(Df(s, e), Dd(Bh(r, (e) => [e === 1, e - 1])), Ju)), Id(Vh(r, (e) => e + 1)), Id(Ef(t, (t) => S(Y(() => n.delete(e)), Id(Rh(a)), G((e) => e(t))))), Id(lp(i, o.effect_instruction_i0)), qu(o.effect_instruction_i0[1]));
					}
				}))))), s = [S(op(i), bd($f({
					onFailure: () => X,
					onSuccess: () => Vh(r, (e) => e + 1)
				}))), (e) => S(Rh(a), G((t) => t(e)))];
				return [o, vS(e) ? n : n.set(e, s)];
			}))))));
		}), dd);
	}
}, bS = /*#__PURE__*/ J(() => K(Vx(/* @__PURE__ */ new Map()), (e) => new yS(e))), xS = () => new yS(Hx(/* @__PURE__ */ new Map())), SS = /*#__PURE__*/ b(2, (e, t) => G(bS, (n) => CS(e, n, t))), CS = /*#__PURE__*/ b(3, (e, t, n) => G(wS(e, n), (e) => lg(e(t), gS, t))), wS = (e, t, n = !1) => {
	let r = e;
	switch (r._op_layer) {
		case "Locally": return Y(() => (e) => r.f(e.getOrElseMemoize(r.self, t)));
		case "ExtendScope": return Y(() => (e) => dx((t) => e.getOrElseMemoize(r.layer, t)));
		case "Fold": return Y(() => (e) => S(e.getOrElseMemoize(r.layer, t), pd({
			onFailure: (n) => e.getOrElseMemoize(r.failureK(n), t),
			onSuccess: (n) => e.getOrElseMemoize(r.successK(n), t)
		})));
		case "Fresh": return Y(() => (e) => S(r.layer, SS(t)));
		case "FromEffect": return Y(n ? () => (e) => r.effect : () => (n) => n.getOrElseMemoize(e, t));
		case "Provide": return Y(() => (e) => S(e.getOrElseMemoize(r.first, t), G((n) => S(e.getOrElseMemoize(r.second, t), hp(n)))));
		case "Scoped": return Y(n ? () => (e) => Sx(r.effect, t) : () => (n) => n.getOrElseMemoize(e, t));
		case "Suspend": return Y(() => (e) => e.getOrElseMemoize(r.evaluate(), t));
		case "ProvideMerge": return Y(() => (e) => S(e.getOrElseMemoize(r.first, t), Ld(e.getOrElseMemoize(r.second, t), r.zipK)));
		case "ZipWith": return Ad(function* () {
			let e = yield* Of(t, bg), n = yield* Of(e, yg), i = yield* Of(e, yg);
			return (e) => S(e.getOrElseMemoize(r.first, n), hx(e.getOrElseMemoize(r.second, i), r.zipK, { concurrent: !0 }));
		});
		case "MergeAll": {
			let e = r.layers;
			return K(Of(t, bg), (t) => (n) => {
				let r = Array(e.length);
				return K(tx(e, jd(function* (e, i) {
					let a = yield* Of(t, yg), o = yield* n.getOrElseMemoize(e, a);
					r[i] = o;
				}), !1, !1), () => ai(...r));
			});
		}
	}
};
function TS(e) {
	let t = Object.create(mS);
	return t._op_layer = Gx, t.effect = e, t;
}
var ES = (...e) => {
	let t = Object.create(mS);
	return t._op_layer = Kx, t.layers = e, t;
}, DS = /*#__PURE__*/ b(2, (e, t) => {
	let n = Zr(e);
	return TS(q($r(n ? e : t, n ? t : e)));
}), OS = /*#__PURE__*/ b(2, (e, t) => fx((n) => G(SS(t, n), (t) => gp(e, t)))), kS = /*#__PURE__*/ b(2, (e, t) => {
	let n = Dg(sS.fiberRefs, t.fiberRefs), r = dl(sS.runtimeFlags, t.runtimeFlags);
	return Td((i) => H((a) => {
		let o = a.getFiberRef(lf), s = a.getFiberRefs(), c = Og(a.id(), s)(n), l = a.currentRuntimeFlags, u = fl(r)(l), d = Dg(c, s), f = dl(u, l);
		return a.setFiberRefs(c), a.currentRuntimeFlags = u, Dx(gp(i(e), ii(o, t.context)), H((e) => (e.setFiberRefs(Og(e.id(), e.getFiberRefs())(d)), e.currentRuntimeFlags = fl(f)(e.currentRuntimeFlags), X)));
	}));
}), AS = /*#__PURE__*/ b(2, (e, t) => Array.isArray(t) ? OS(e, ES(...t)) : _S(t) ? OS(e, t) : Xr(t) ? gp(e, t) : Ux in t ? G(t.runtimeEffect, (t) => kS(e, t)) : kS(e, t)), jS = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return { BaseEffectError: class extends jf {
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
}(), MS = (e) => {
	let t = { BaseEffectError: class extends jS {
		_tag = e;
	} };
	return t.BaseEffectError.prototype.name = e, t.BaseEffectError;
}, NS = U, PS = Ad, FS = cg, IS = q, LS = J, RS = Y, zS = X, BS = $u, VS = og, HS = ng, US = pg, WS = qu, GS = qb, KS = Dx, qS = px, JS = AS, YS = Sd, XS = fg, ZS = md, QS = cS, $S = lS, eC = uS, tC = class extends MS("AuthenticationFailure") {};
function nC(e) {
	return US({
		try: e.command,
		catch: (e) => new tC({ cause: e })
	}).pipe(KS(FS(() => e.reconcile?.() ?? Promise.resolve())));
}
async function rC(e) {
	let t = await $S(e);
	if (bp(t)) return t.value;
	let n = kx(t.cause);
	throw Cn(n) ? n.value.cause : Ax(t.cause);
}
// src/app/services/queries/configuration.ts
function iC(e, t, n, i) {
	let { api: a } = r();
	return _({
		queryKey: y.browse(e ?? "", t, n),
		queryFn: ({ signal: r }) => a.browsePath(e, t, n, r),
		enabled: i,
		staleTime: 2e3,
		retry: !1
	});
}
function aC(e, t, n, i) {
	let { api: a } = r();
	return _({
		queryKey: y.sshBrowse(e ?? { ssh_host: "" }, t ?? "", n),
		queryFn: ({ signal: r }) => a.browseSshPath(e, t, n, r),
		enabled: i && !!e?.ssh_host,
		staleTime: 2e3,
		retry: !1
	});
}
function oC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: (t) => e.browseSshPath(t, null),
		onSuccess: (e, n) => {
			t.setQueryData(y.sshBrowse(n, "", !1), e);
		}
	});
}
function sC() {
	let { api: e } = r();
	return _({
		queryKey: y.sshConfigs,
		queryFn: ({ signal: t }) => e.listSshConfigs(t),
		staleTime: 3e4,
		retry: !1
	});
}
function cC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: (t) => e.createSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.sshConfigs });
		}
	});
}
function lC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ configId: t, payload: n }) => e.updateSshConfig(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.sshConfigs });
		}
	});
}
function uC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: (t) => e.deleteSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.sshConfigs });
		}
	});
}
var dC = 3e5;
function fC() {
	let { api: e } = r();
	return _({
		queryKey: y.mcpLibrary,
		queryFn: ({ signal: t }) => e.getMcpLibrary(t),
		staleTime: dC,
		retry: !1
	});
}
function pC() {
	let { api: e } = r();
	return _({
		queryKey: y.mcpServers,
		queryFn: ({ signal: t }) => e.listMcpServers(t),
		staleTime: 3e4,
		retry: !1
	});
}
function mC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: (t) => e.createMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.mcpServers }), t.invalidateQueries({ queryKey: y.mcpRuntime });
		}
	});
}
function hC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ serverName: t, payload: n }) => e.updateMcpServer(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.mcpServers }), t.invalidateQueries({ queryKey: y.mcpRuntime });
		}
	});
}
function gC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: (t) => e.deleteMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.mcpServers }), t.invalidateQueries({ queryKey: y.mcpRuntime });
		}
	});
}
function _C() {
	let { api: e } = r();
	return g({ mutationFn: (t) => e.testMcpServer(t) });
}
function vC() {
	let { api: e } = r();
	return _({
		queryKey: y.mcpRuntime,
		queryFn: ({ signal: t }) => e.listMcpRuntimeStatus(t),
		staleTime: 5e3,
		retry: !1
	});
}
function yC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ serverName: t, action: n }) => n === "connect" ? e.connectMcpServer(t) : n === "disconnect" ? e.disconnectMcpServer(t) : e.reloadMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.mcpRuntime });
		}
	});
}
function bC(e = !0) {
	let { api: t } = r();
	return _({
		queryKey: y.modelConfigs,
		enabled: e,
		queryFn: ({ signal: e }) => t.listModelConfigs(e),
		staleTime: 3e4,
		retry: !1
	});
}
var xC = 0;
function SC() {
	return globalThis.crypto?.randomUUID?.() ?? `credential-${++xC}`;
}
function CC(e, t, n, i) {
	let { api: a } = r(), o = m(() => ({
		identity: SC(),
		value: t
	}), [t]);
	return _({
		queryKey: y.providerModels(e, o.identity, n ?? ""),
		queryFn: ({ signal: r }) => a.listProviderModels({
			backend: e,
			api_key: t,
			base_url: n
		}, r),
		enabled: i && t.length > 0,
		retry: !1,
		staleTime: 3e5,
		gcTime: 6e4
	});
}
function wC(e = !0) {
	let { api: t } = r();
	return _({
		queryKey: y.modelCatalog,
		queryFn: ({ signal: e }) => t.getModelCatalog(e),
		enabled: e,
		staleTime: 6e5,
		retry: !1
	});
}
async function TC(e) {
	await Promise.all([e.resetQueries({ queryKey: y.managedProviderModelsAll }), e.invalidateQueries({ queryKey: y.modelCatalog })]);
}
async function EC(e) {
	await Promise.all([
		e.invalidateQueries({ queryKey: y.managedAuth }),
		e.invalidateQueries({ queryKey: y.managedHostStatus }),
		TC(e),
		e.invalidateQueries({ queryKey: y.resolvedModelConfigsAll }),
		e.invalidateQueries({ queryKey: y.resolvedConfigFilesAll })
	]);
}
function DC(e) {
	let { api: t } = r();
	return _({
		queryKey: y.sessionCommands(e),
		queryFn: ({ signal: n }) => t.listSessionCommands(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function OC(e) {
	let { api: t } = r();
	return _({
		queryKey: y.sessionSkills(e),
		queryFn: ({ signal: n }) => t.listSessionSkills(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function kC(e, t) {
	let { api: n } = r(), i = t.trim();
	return _({
		queryKey: e ? y.resolvedModelConfig(e) : y.resolvedConfigFile(i),
		queryFn: ({ signal: t }) => e ? n.resolveModelConfig(e, t) : n.resolveConfigFile(i, t),
		enabled: !!(e ?? i),
		retry: !1,
		staleTime: 6e4
	});
}
function AC() {
	let { api: e } = r(), t = v();
	return g({
		retry: !1,
		mutationFn: (t) => e.createModelConfig(t),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: y.modelConfigs }),
				t.invalidateQueries({ queryKey: y.credentials }),
				TC(t)
			]);
		}
	});
}
function jC() {
	let { api: e } = r(), t = v();
	return g({
		retry: !1,
		mutationFn: ({ configId: t, payload: n }) => e.updateModelConfig(t, n),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: y.modelConfigs }),
				t.invalidateQueries({ queryKey: y.credentials }),
				TC(t)
			]);
		}
	});
}
function MC() {
	let { api: e } = r(), t = v();
	return g({
		retry: !1,
		mutationFn: (t) => e.deleteModelConfig(t),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: y.modelConfigs }),
				t.invalidateQueries({ queryKey: y.credentials }),
				TC(t)
			]);
		}
	});
}
// src/app/services/queries/host.ts
function NC() {
	let { api: e } = r();
	return _({
		queryKey: y.storeInfo,
		queryFn: ({ signal: t }) => e.getStore(t),
		staleTime: Infinity
	});
}
function PC(e) {
	let { api: t } = r();
	return _({
		queryKey: y.sandboxAvailability,
		queryFn: ({ signal: e }) => t.getSandboxAvailability(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function FC(e, t) {
	let { api: n } = r();
	return _({
		queryKey: [...y.sandboxActivity, t],
		queryFn: ({ signal: e }) => n.getSandboxActivity(t, e),
		enabled: e && t !== null,
		staleTime: 0,
		refetchInterval: 1e3,
		retry: !1
	});
}
function IC() {
	let { api: e } = r(), t = v();
	return g({
		retry: !1,
		mutationFn: (n) => rC(nC({
			command: () => e.managedLogout(n),
			reconcile: () => EC(t)
		}))
	});
}
// src/app/features/ui-policy/policy.ts
var LC = { orchestrationEnabled: !1 };
function RC(e, t) {
	return e.orchestrationEnabled ? t : "direct";
}
function zC(e, t, n) {
	return e.orchestrationEnabled || t === "direct" && n?.kind !== "managed-orchestrator";
}
function BC(e, t) {
	return t.filter((t) => zC(e, t.summary.behavior, t.lineage));
}
function VC(e, t, n) {
	return e.orchestrationEnabled || !t.some((e) => e.lineage == null && e.summary.project_id === n);
}
// src/app/features/ui-policy/UiPolicyContext.ts
var HC = u(LC);
function UC() {
	return f(HC);
}
// src/app/services/queries/direct.ts
function WC(e, t, n) {
	let r = e.find((e) => n(e) === n(t));
	return r && (r.generation > t.generation || r.version > t.version) ? e : r ? e.map((e) => n(e) === n(t) ? t : e) : [...e, t];
}
function GC(e, t, n) {
	return t.map((t) => {
		let r = e?.find((e) => n(e) === n(t));
		return r && (r.generation > t.generation || r.version > t.version) ? r : t;
	});
}
function KC(e, t, n = !0) {
	let { api: i } = r();
	return _({
		queryKey: y.sessionPermissions(e),
		queryFn: ({ signal: t }) => i.getPermissions(e, t),
		enabled: t,
		refetchInterval: t && n ? 1e3 : !1,
		staleTime: 0,
		retry: !1
	});
}
function qC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, requestId: n, reply: r }) => e.replyPermission(t, n, r),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: y.sessionPermissions(n.sessionId) })
	});
}
function JC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, reviewId: n, parentSessionId: r }) => r ? e.authorizeChildPermissionReviewRetry(r, t, n) : e.authorizePermissionReviewRetry(t, n),
		onSuccess: (e, n) => Promise.all([t.invalidateQueries({ queryKey: y.sessionPermissions(n.sessionId) }), ...n.parentSessionId ? [t.invalidateQueries({ queryKey: y.traditionalChildren(n.parentSessionId) })] : []])
	});
}
function YC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, mode: n }) => e.setPermissionApprovalMode(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(y.sessionPermissions(n.sessionId), (e) => e && {
				...e,
				approval_mode: n.mode,
				requests: n.mode === "auto_approve" ? [] : e.requests
			});
		}
	});
}
function XC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, grantId: n }) => e.deletePermissionGrant(t, n),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: y.sessionPermissions(n.sessionId) })
	});
}
function ZC(e, t) {
	let { api: n } = r();
	return _({
		queryKey: y.sessionGoal(e),
		queryFn: ({ signal: t }) => n.getGoal(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function QC() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, payload: n }) => e.createGoal(t, n),
		onSuccess: (e, n) => t.setQueryData(y.sessionGoal(n.sessionId), e)
	});
}
function $C() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, goalId: n, payload: r }) => e.updateGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(y.sessionGoal(n.sessionId), e)
	});
}
function ew() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, goalId: n, expectedVersion: r }) => e.clearGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(y.sessionGoal(n.sessionId), null)
	});
}
function tw(e, t) {
	let { api: n } = r();
	return _({
		queryKey: y.traditionalChildren(e),
		queryFn: ({ signal: t }) => n.listTraditionalChildren(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => GC(e, t, (e) => e.child_session_id)
	});
}
function nw() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, payload: n }) => e.startTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(y.traditionalChildren(n.sessionId), (t = []) => WC(t, e, (e) => e.child_session_id));
		}
	});
}
function rw() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, childId: n }) => e.cancelTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(y.traditionalChildren(n.sessionId), (t = []) => WC(t, e, (e) => e.child_session_id));
		}
	});
}
function iw(e, t) {
	let { api: n } = r(), i = UC();
	return t &&= i.orchestrationEnabled, _({
		queryKey: y.managedOrchestrators(e),
		queryFn: ({ signal: t }) => n.listManagedOrchestrators(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => GC(e, t, (e) => e.orchestrator_session_id)
	});
}
function aw() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, payload: n }) => e.startManagedOrchestrator(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(y.managedOrchestrators(n.sessionId), (t = []) => WC(t, e, (e) => e.orchestrator_session_id));
		}
	});
}
function ow() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, orchestratorId: n }) => e.cancelManagedOrchestrator(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(y.managedOrchestrators(n.sessionId), (t = []) => WC(t, e, (e) => e.orchestrator_session_id));
		}
	});
}
function sw(e, t) {
	let { api: n } = r();
	return _({
		queryKey: y.sessionInbox(e),
		queryFn: ({ signal: t }) => n.listInbox(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function cw() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, delivery: n, prompt: r }) => e.createInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(y.sessionInbox(n), (t = []) => [...t.filter((t) => t.id !== e.id), e]);
		}
	});
}
function lw() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r, delivery: i }) => e.updateInboxItem(t, n, r, i),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(y.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
function uw() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r }) => e.cancelInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(y.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
// src/app/features/direct-session/commandWorkflow.ts
var dw = class extends MS("CommandFailure") {};
function fw(e) {
	return PS(function* () {
		yield* RS(e.optimistic);
		let t = yield* US({
			try: e.admit,
			catch: (e) => new dw({
				operation: "submit",
				cause: e
			})
		}).pipe(XS(() => RS(e.rejected)));
		return t.kind === "accepted" ? (yield* RS(() => e.reconcile(!1)), t.value) : (yield* RS(() => {
			t.kind === "uncertain" ? e.reconcile(!0) : e.rejected();
		}), yield* NS(new dw({
			operation: "submit",
			cause: t.error
		})));
	});
}
function pw(e) {
	return PS(function* () {
		yield* RS(e.optimistic), yield* US({
			try: e.cancel,
			catch: (e) => new dw({
				operation: "stop",
				cause: e
			})
		}).pipe(XS(() => RS(e.rollback))), yield* RS(e.settled);
	});
}
function mw(e) {
	return US({
		try: e.create,
		catch: (e) => new dw({
			operation: "create",
			cause: e
		})
	}).pipe(YS((t) => RS(() => e.accept(t))));
}
function hw(e) {
	if (e.mode === "direct-running" || e.delivery) {
		let t = e.delivery ?? "steer";
		return US({
			try: () => e.inbox(t),
			catch: (e) => new dw({
				operation: t,
				cause: e
			})
		}).pipe(WS(t === "queue" ? "queued" : "steered"));
	}
	let t = e.mode === "classic-running";
	return US({
		try: t ? e.steer : e.submit,
		catch: (e) => new dw({
			operation: t ? "steer" : "submit",
			cause: e
		})
	}).pipe(WS(t ? "steered" : "submitted"));
}
async function gw(e) {
	let t = await $S(e);
	if (bp(t)) return t.value;
	let n = kx(t.cause);
	throw Cn(n) ? n.value.cause : Ax(t.cause);
}
// src/app/features/direct-session/commandAdapters.ts
function _w(e, t) {
	let { api: r, stores: { runtimeStore: { captureRuntimeActivation: i, finishRunCancel: a, requestRunCancel: o, restoreRunCancel: s, runtimeStore: c } } } = n(e), l = i(t), u = y.sessionSnapshot(t), d, f, p, m = [];
	return {
		optimistic: () => {
			l() && (d = o()), f = e.getQueryData(u), p = f?.active_run ? {
				...f,
				active_run: void 0
			} : f, p &&= e.setQueryData(u, p);
			for (let n of [!1, !0]) {
				let r = e.getQueryData(y.sessions(n))?.find((e) => e.summary.session_id === t), i = e.setQueryData(y.sessions(n), (e) => e?.map((e) => e.summary.session_id !== t || !e.active && e.active_run === void 0 ? e : {
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
			for (let { stats: t, before: n, optimistic: r } of m) e.setQueryData(y.sessions(t), (e) => e?.map((e) => e === r ? n : e));
			e.invalidateQueries({
				queryKey: u,
				exact: !0
			});
		},
		settled: () => {
			l() && c.getState().cancelArmed && a(), e.invalidateQueries({
				queryKey: u,
				exact: !0
			}), e.invalidateQueries({ queryKey: y.sessionsAll });
		}
	};
}
// src/app/lib/messageWindow.ts
function vw(e, t, n) {
	return Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && Number.isSafeInteger(e.total) && e.start >= 0 && e.start <= e.end && e.end <= e.total && e.end - e.start === t && n === t;
}
function yw(e, t, n) {
	let r = /* @__PURE__ */ new Set();
	return (e ?? []).every(({ message_index: e }) => !Number.isSafeInteger(e) || r.has(e) || t[e - n]?.role !== "user" ? !1 : (r.add(e), !0));
}
function bw(e, t, n) {
	return (e ?? []).filter(({ message_index: e }) => e >= t && e < n);
}
function xw(e) {
	return vw(e.page, e.messages.length, e.created_at.length) && yw(e.terminal_selection_attributions, e.messages, e.page.start);
}
function Sw(e) {
	let t = e.message_page, n = e.message_created_at ?? [];
	return !!(t && vw(t, e.messages.length, n.length) && yw(e.terminal_selection_attributions, e.messages, t.start));
}
function Cw(e) {
	return e.message_page ?? {
		start: 0,
		end: e.messages.length,
		total: e.messages.length,
		has_older: !1
	};
}
function ww(e) {
	let t = e.message_created_at ?? [];
	return t.length === e.messages.length ? t : Array.from({ length: e.messages.length }, () => null);
}
function Tw(e, t) {
	if (!xw(t)) return { kind: "snapshot-required" };
	let n = Cw(e), r = ww(e);
	if (!vw(n, e.messages.length, r.length) || t.page.end !== t.page.total || t.page.total < n.total || t.page.start > n.end) return { kind: "snapshot-required" };
	for (let i = Math.max(n.start, t.page.start); i < Math.min(n.end, t.page.end); i += 1) if (JSON.stringify(e.messages[i - n.start]) !== JSON.stringify(t.messages[i - t.page.start]) || r[i - n.start] !== t.created_at[i - t.page.start]) return { kind: "snapshot-required" };
	if (t.page.start <= n.start) return {
		kind: "accepted",
		snapshot: {
			...e,
			messages: t.messages,
			message_created_at: t.created_at,
			message_page: t.page,
			terminal_selection_attributions: t.terminal_selection_attributions ?? []
		}
	};
	let i = t.page.start - n.start;
	return i > e.messages.length ? { kind: "snapshot-required" } : {
		kind: "accepted",
		snapshot: {
			...e,
			messages: [...e.messages.slice(0, i), ...t.messages],
			message_created_at: [...r.slice(0, i), ...t.created_at],
			terminal_selection_attributions: [...bw(e.terminal_selection_attributions, n.start, t.page.start), ...t.terminal_selection_attributions ?? []],
			message_page: {
				...t.page,
				start: n.start,
				has_older: n.start > 0
			}
		}
	};
}
function Ew(e, t, n) {
	if (!xw(t)) return null;
	let r = Cw(e), i = ww(e);
	return r.start !== n || t.page.end !== n || t.page.total !== r.total || !vw(r, e.messages.length, i.length) ? null : {
		...e,
		messages: [...t.messages, ...e.messages],
		message_created_at: [...t.created_at, ...i],
		terminal_selection_attributions: [...t.terminal_selection_attributions ?? [], ...bw(e.terminal_selection_attributions, r.start, r.end)],
		message_page: {
			start: t.page.start,
			end: r.end,
			total: r.total,
			has_older: t.page.start > 0
		}
	};
}
function Dw(e, t, n) {
	if (n || !e || !t.message_page) return t;
	if (!Sw(t)) return e;
	let r = t.message_created_at ?? [], i = Tw(e, {
		messages: t.messages,
		created_at: r,
		page: t.message_page,
		terminal_selection_attributions: t.terminal_selection_attributions
	});
	return i.kind === "accepted" ? {
		...t,
		messages: i.snapshot.messages,
		message_created_at: i.snapshot.message_created_at,
		message_page: i.snapshot.message_page,
		terminal_selection_attributions: i.snapshot.terminal_selection_attributions
	} : t;
}
// src/app/lib/sessionOrder.ts
function Ow(e, t, n) {
	let r = e.filter((e) => e !== t), i = Math.max(0, Math.min(n, r.length));
	return [
		...r.slice(0, i),
		t,
		...r.slice(i)
	];
}
function kw(e, t) {
	return (e.sort_order ?? 0) - (t.sort_order ?? 0) || o(t.created_at) - o(e.created_at);
}
function Aw(e, t) {
	return e.filter((e) => !!e.summary.pinned === t).sort((e, t) => kw(e.summary, t.summary));
}
function jw(e, t, n) {
	let r = new Map(n.map((e) => [e.summary.session_id, e])), i = {};
	for (let e of t) i[e] = r.get(e)?.summary.presentation_version ?? 0;
	return {
		pinned: e,
		session_ids: t,
		expected_versions: i
	};
}
function Mw(e, t) {
	return e.map((e) => e.summary.session_id === t.session_id ? {
		...e,
		summary: t
	} : e);
}
function Nw(e, t, n, r) {
	if (t === r) {
		let t = e.findIndex((e) => e.summary.session_id === r);
		return t < 0 ? e.length : t;
	}
	let i = e.filter((e) => e.summary.session_id !== r), a = i.findIndex((e) => e.summary.session_id === t);
	return a < 0 ? i.length : n === "before" ? a : a + 1;
}
function Pw(e, t) {
	return e.length === t.length && e.every((e, n) => e === t[n]);
}
// src/app/services/queries/invalidation.ts
function Fw() {
	let e = v();
	return {
		sessions: () => e.invalidateQueries({ queryKey: y.sessionsAll }),
		projects: () => e.invalidateQueries({ queryKey: y.projects }),
		session: (t) => e.invalidateQueries({
			queryKey: y.sessionSnapshot(t),
			exact: !0
		}),
		sessionRoot: (t) => e.invalidateQueries({ queryKey: y.sessionRoot(t) })
	};
}
// src/app/services/sessionRefresh.ts
var Iw = /* @__PURE__ */ new Map(), Lw = 0, Rw = /* @__PURE__ */ new WeakMap(), zw = 0;
function Bw(e, t) {
	let n = Rw.get(e);
	return n === void 0 && (n = ++zw, Rw.set(e, n)), `${n}:${t}`;
}
function Vw(e) {
	let t = Iw.get(e);
	if (t) return t;
	let n = {
		generation: ++Lw,
		replaceNextSnapshot: !1,
		tailController: null,
		historyControllers: /* @__PURE__ */ new Set()
	};
	return Iw.set(e, n), n;
}
function Hw(e, t = !1) {
	let n = Vw(e);
	n.generation = ++Lw, n.replaceNextSnapshot ||= t, n.tailController?.abort(), n.tailController = null;
	for (let e of n.historyControllers) e.abort();
	return n.historyControllers.clear(), n.generation;
}
function Uw(e) {
	let t = Vw(e);
	return {
		generation: Hw(e),
		replace: t.replaceNextSnapshot
	};
}
function Ww(e, t) {
	let n = Iw.get(e);
	n?.generation === t.generation && t.replace && (n.replaceNextSnapshot = !1);
}
function Gw(e) {
	let t = Vw(e);
	t.tailController?.abort();
	let n = new AbortController();
	return t.tailController = n, {
		generation: t.generation,
		controller: n
	};
}
function Kw(e, t) {
	let n = Iw.get(e);
	n?.tailController === t.controller && (n.tailController = null);
}
function qw(e, t) {
	return Iw.get(e)?.generation === t;
}
function Jw(e) {
	let t = Vw(e), n = new AbortController();
	return t.historyControllers.add(n), {
		generation: t.generation,
		controller: n
	};
}
function Yw(e, t) {
	Iw.get(e)?.historyControllers.delete(t.controller);
}
function Xw(e) {
	let t = Iw.get(e);
	t?.tailController?.abort();
	for (let e of t?.historyControllers ?? []) e.abort();
	Iw.delete(e);
}
// src/app/services/queries/session.ts
function Zw(e = _e) {
	let { api: t } = r();
	return _({
		queryKey: y.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: e,
		staleTime: 0,
		placeholderData: te
	});
}
function Qw(e) {
	let { api: t } = r(), n = d((t) => t.find((t) => t.summary.session_id === e) ?? null, [e]);
	return _({
		queryKey: y.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: _e,
		staleTime: 0,
		placeholderData: te,
		select: n
	});
}
function $w(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function eT(e, t) {
	let { api: n } = r(), i = v();
	return _({
		queryKey: y.sessionSnapshot(e ?? ""),
		queryFn: async ({ signal: t }) => {
			let r = Uw(Bw(i, e)), a = await n.getSession(e, {
				messageLimit: 24,
				threadEventLimit: 50,
				includeSessions: !1,
				includeSystem: !0,
				signal: t
			});
			if (!Sw(a)) throw Error("The server returned an invalid snapshot message page.");
			if (t.aborted || !qw(Bw(i, e), r.generation)) throw new DOMException("Snapshot superseded", "AbortError");
			return Ww(Bw(i, e), r), Dw(i.getQueryData(y.sessionSnapshot(e)), a, r.replace);
		},
		enabled: !!e,
		staleTime: 1e3,
		placeholderData: $w(e ?? ""),
		...t
	});
}
function tT(e) {
	let { api: t } = r(), n = v();
	return g({ mutationFn: async () => {
		let r = n.getQueryData(y.sessionSnapshot(e))?.message_page?.start;
		if (r === void 0 || r <= 0) throw Error("No older messages are available.");
		let i = Bw(n, e), a = Jw(i);
		try {
			let o = await t.getMessages(e, {
				before: r,
				limit: 24,
				includeSystem: !0,
				signal: a.controller.signal
			});
			if (!xw(o)) throw Error("The server returned an invalid message page.");
			if (!qw(i, a.generation)) return !1;
			let s = !1;
			return n.setQueryData(y.sessionSnapshot(e), (e) => {
				if (!e) return e;
				let t = Ew(e, o, r);
				return t ? (s = !0, t) : e;
			}), s;
		} catch (e) {
			if (a.controller.signal.aborted) return !1;
			throw e;
		} finally {
			Yw(i, a);
		}
	} });
}
function nT(e, t) {
	let { api: n } = r();
	return ne({
		queryKey: y.threadEvents(e ?? "", t ?? ""),
		queryFn: ({ pageParam: r, signal: i }) => n.getThreadEvents(e, t, {
			beforeId: r ?? void 0,
			limit: 50,
			signal: i
		}),
		initialPageParam: null,
		getNextPageParam: (e) => e.has_older ? e.next_before_id : void 0,
		enabled: !!(e && t),
		staleTime: Infinity
	});
}
function rT(e) {
	let { api: t } = r();
	return _({
		queryKey: y.sessionConfig(e ?? ""),
		queryFn: ({ signal: n }) => t.getConfig(e, n),
		enabled: !!e
	});
}
function iT() {
	let { api: e } = r(), t = Fw(), n = v();
	return g({
		retry: !1,
		mutationFn: (r) => gw(mw({
			create: () => e.createSession(r),
			accept: (e) => {
				let r = e.metadata.session_id;
				if (!r) throw Error("The server returned a chat without an identity.");
				Hw(Bw(n, r), !0), n.setQueryData(y.sessionSnapshot(r), e), t.sessions();
			}
		}))
	});
}
function aT(e, t) {
	let n = [];
	for (let r of e.getQueryCache().findAll({ queryKey: ["session"] })) {
		let e = r.queryKey;
		if (e[0] !== "session" || e[2] !== "snapshot" || typeof e[1] != "string") continue;
		let i = e[1];
		i !== t && r.state.data?.forks?.some((e) => e.session_id === t) && n.push(i);
	}
	return n;
}
function oT() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = Fw(), i = v();
	return g({
		mutationFn: (t) => e.deleteSession(t),
		onSuccess: (e, r) => {
			t.purgeSessions([r]), n.sessions(), i.removeQueries({ queryKey: y.sessionRoot(r) });
			for (let e of aT(i, r)) n.sessionRoot(e);
		}
	});
}
function sT() {
	let { api: e } = r(), t = Fw();
	return g({
		retry: !1,
		mutationFn: ({ id: t, title: n, pinned: r, expectedVersion: i }) => e.updatePresentation(t, {
			title: n,
			pinned: r,
			expected_version: i
		}),
		onSuccess: () => t.sessions()
	});
}
function cT() {
	let e = sT();
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
function lT() {
	let { api: e } = r(), t = Fw();
	return g({
		mutationFn: async ({ sessions: t, sessionId: n, targetPinned: r, targetIndex: i }) => {
			let a = t, o = a.find((e) => e.summary.session_id === n);
			if (!o) throw Error(`Session '${n}' was not found`);
			if (!!o.summary.pinned !== r) {
				let t = await e.updatePresentation(n, {
					title: o.summary.title ?? "",
					pinned: r,
					expected_version: o.summary.presentation_version ?? 0
				});
				a = Mw(a, t);
			}
			let s = Aw(a, r), c = s.map((e) => e.summary.session_id), l = Ow(c, n, i);
			return Pw(c, l) ? null : e.reorderSessions(jw(r, l, s));
		},
		onSuccess: () => t.sessions()
	});
}
function uT() {
	let { api: e } = r(), t = Fw(), n = v();
	return g({
		retry: !1,
		mutationFn: ({ id: t, patch: n }) => e.updateConfig(t, n),
		onSuccess: (e, { id: r }) => {
			n.invalidateQueries({ queryKey: y.sessionConfig(r) }), t.session(r), t.sessions();
		}
	});
}
function dT() {
	let { api: e } = r(), { captureRuntimeActivation: t, setOptimisticUserPrompt: n } = r().stores.runtimeStore, a = Fw(), o = v();
	return g({
		retry: !1,
		mutationFn: ({ id: r, prompt: s, signal: c }) => {
			let l = t(r);
			return gw(fw({
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
					e ? (Hw(Bw(o, r), !0), a.sessionRoot(r)) : a.session(r);
				}
			}));
		}
	});
}
function fT() {
	let { api: e } = r();
	return g({ mutationFn: ({ id: t, instruction: n }) => e.steerOrchestrator(t, n) });
}
function pT() {
	let { api: e } = r();
	return g({ mutationFn: ({ id: t, threadName: n, instruction: r }) => e.steerThread(t, n, r) });
}
function mT() {
	let e = v();
	return g({
		retry: !1,
		mutationFn: (t) => gw(pw(_w(e, t)))
	});
}
function hT() {
	let { api: e } = r(), t = Fw(), n = v();
	return g({
		mutationFn: (t) => e.compactSession(t),
		onSuccess: (e, r) => (Hw(Bw(n, r), !0), t.sessionRoot(r))
	});
}
function gT() {
	let { api: e } = r(), t = Fw(), n = v();
	return g({
		mutationFn: ({ id: t, messageIdx: n }) => e.revertSession(t, n),
		onSuccess: (e, { id: r }) => {
			Hw(Bw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function _T() {
	let { api: e } = r(), t = Fw(), n = v();
	return g({
		mutationFn: ({ id: t, messageIdx: n }) => e.regenerateRun(t, n),
		onSuccess: (e, { id: r }) => {
			Hw(Bw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function vT() {
	let { api: e } = r(), t = Fw();
	return g({
		mutationFn: ({ id: t, messageIdx: n }) => e.forkSession(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n), t.sessions();
		}
	});
}
function yT() {
	let { api: e } = r(), t = Fw();
	return g({
		mutationFn: ({ id: t, forkId: n }) => e.dismissSessionFork(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n);
		}
	});
}
function bT() {
	let e = Zw(), t = UC(), n = m(() => e.data ? BC(t, e.data) : void 0, [e.data, t]);
	return {
		...e,
		data: n
	};
}
// src/app/services/queries/workspace.ts
function xT(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function ST(e, t, n = "all", i = 3, a = null) {
	let { api: o } = r();
	return _({
		queryKey: y.workspaceDiff(e ?? "", t ?? "", n, i, a),
		queryFn: ({ signal: r }) => o.getWorkspaceDiff(e, t, {
			stage: n,
			context: i,
			revision: a,
			signal: r
		}),
		enabled: !!(e && t),
		placeholderData: xT(e ?? "")
	});
}
function CT(e, t = null) {
	let { api: n } = r();
	return _({
		queryKey: y.workspaceFiles(e ?? "", t),
		queryFn: ({ signal: r }) => n.getWorkspaceFiles(e, t, r),
		enabled: !!e,
		staleTime: t == null ? 1e4 : Infinity,
		placeholderData: xT(e ?? "")
	});
}
function wT(e, t, n = null) {
	let { api: i } = r();
	return _({
		queryKey: y.workspaceFile(e ?? "", t ?? "", n),
		queryFn: ({ signal: r }) => i.getWorkspaceFile(e, t, n, r),
		enabled: !!(e && t),
		staleTime: n == null ? 1e4 : Infinity,
		placeholderData: xT(e ?? "")
	});
}
function TT(e) {
	let { api: t } = r();
	return _({
		queryKey: y.workspaceRevisions(e ?? ""),
		queryFn: ({ signal: n }) => t.getWorkspaceRevisions(e, n),
		enabled: !!e,
		staleTime: 5e3,
		retry: !1
	});
}
function ET(e, t) {
	let { api: n } = r();
	return _({
		queryKey: y.workspaceRevisionChanges(e ?? "", t ?? 0),
		queryFn: ({ signal: r }) => n.getWorkspaceRevisionChanges(e, t, r),
		enabled: !!(e && t != null),
		staleTime: Infinity,
		placeholderData: xT(e ?? "")
	});
}
function DT(e, t) {
	let { api: n } = r();
	return _({
		queryKey: y.branches(e ?? ""),
		queryFn: ({ signal: t }) => n.getBranches(e, t),
		enabled: !!e && t,
		staleTime: 5e3,
		retry: !1
	});
}
function OT(e) {
	let { api: t } = r(), n = v();
	return g({
		mutationFn: (n) => t.switchBranch(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: y.branches(e) }), n.invalidateQueries({ queryKey: y.sessionRoot(e) }), n.invalidateQueries({ queryKey: y.sessionsAll });
		}
	});
}
function kT(e) {
	let { api: t } = r(), n = v();
	return g({
		mutationFn: (n) => t.commitWorkspace(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: y.sessionRoot(e) }), n.invalidateQueries({ queryKey: y.sessionsAll });
		}
	});
}
// src/app/services/queries/projects.ts
function AT() {
	let { api: e } = r();
	return _({
		queryKey: y.projects,
		queryFn: ({ signal: t }) => e.listProjects(t),
		staleTime: 3e4,
		retry: !1
	});
}
function jT() {
	let { api: e } = r(), t = Fw();
	return g({
		retry: !1,
		mutationFn: (t) => e.createProject(t),
		onSuccess: () => t.projects()
	});
}
function MT() {
	let { api: e } = r(), t = Fw();
	return g({
		retry: !1,
		mutationFn: ({ projectId: t, payload: n }) => e.updateProject(t, n),
		onSuccess: () => t.projects()
	});
}
function NT() {
	let e = MT();
	return {
		...e,
		toggle: (t) => e.mutateAsync({
			projectId: t.project_id,
			payload: { pinned: !t.pinned }
		})
	};
}
function PT() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = Fw();
	return g({
		mutationFn: ({ projectId: t, sessions: n }) => e.deleteProject(t, n),
		onSuccess: (e) => (t.purgeSessions(e.deleted_session_ids), Promise.all([n.projects(), n.sessions()]))
	});
}
function FT() {
	let { api: e } = r(), t = Fw();
	return g({
		mutationFn: ({ projectId: t, sessionId: n }) => e.assignSessionToProject(t, { session_id: n }),
		onSuccess: () => Promise.all([t.projects(), t.sessions()])
	});
}
function IT() {
	let { api: e } = r(), t = Fw();
	return g({
		mutationFn: async ({ projects: t, projectId: n, targetPinned: r, targetIndex: i }) => {
			let a = t.find((e) => e.project_id === n);
			if (!a) return;
			let o = t;
			a.pinned !== r && (await e.updateProject(n, { pinned: r }), o = (await e.listProjects()).projects);
			let s = o.filter((e) => e.pinned === r).sort((e, t) => e.sort_order - t.sort_order), c = Ow(s.map((e) => e.project_id), n, i);
			await e.reorderProjects({
				pinned: r,
				project_ids: c,
				expected_versions: Object.fromEntries(s.map((e) => [e.project_id, e.presentation_version]))
			});
		},
		onSuccess: () => t.projects()
	});
}
// src/app/features/managed/model.ts
var LT = [
	"status",
	"github",
	"secrets"
], RT = /* @__PURE__ */ new Set([
	"PATH",
	"HOME",
	"NAC_HOME",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"EXA_API_KEY"
]);
function zT(e) {
	return e ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(e) ? RT.has(e) ? `${e} is managed by NAC and cannot be replaced here.` : "" : "Use letters, digits, and underscores; the first character cannot be a digit." : "Enter a variable name.";
}
function BT(e) {
	let t = e?.split("/") ?? [];
	return t.length === 2 && t[0] && t[1] ? [t[0], t[1]] : null;
}
function VT(e) {
	return e?.status === "running";
}
function HT(e) {
	return e ? {
		backend: e.model.backend,
		model: e.model.id,
		baseUrl: e.model.endpoint
	} : null;
}
function UT(e, t) {
	return !!(t && e && t.backend === e.model.backend && t.baseUrl === e.model.endpoint);
}
function WT(e, t) {
	return (e?.providers ?? []).flatMap((e) => {
		if (e.auth_status !== "ready") return [];
		if (e.auth !== "api_key_env") return [{ backend: e.id }];
		let n = e.connection;
		return n ? [{
			backend: e.id,
			base_url: n.base_url,
			...n.api_key_env ? { api_key_env: n.api_key_env } : {}
		}] : !t?.model_ready || e.id !== t.model.backend ? [] : [{
			backend: e.id,
			base_url: t.model.endpoint
		}];
	});
}
// src/app/features/managed/upgrade.ts
function GT(e) {
	return typeof e == "object" && e && "status" in e ? e.status : null;
}
function KT(e) {
	return qT(e) || e instanceof Error && e.name === "ManagedUpgradeContractError";
}
function qT(e) {
	let t = GT(e);
	return t === 401 || t === 403 || t === 409;
}
function JT(e) {
	let t = GT(e);
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
var YT = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying"
]);
function XT(e) {
	return YT.has(e);
}
function ZT(e) {
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
function QT(e) {
	switch (e) {
		case "cancel_active_run": return "Stop run";
		case "cancel_traditional_child": return "Cancel coding agent";
		case "cancel_managed_orchestrator": return "Cancel NAC orchestrator";
		case "terminate_terminal": return "Stop terminal";
		case "cancel_clone_operation": return "Cancel clone";
		case "wait": return "Wait";
	}
}
function $T(e) {
	return e === null ? "Accepted-release distance unavailable" : e === 0 ? "Current accepted release" : `${e} accepted ${e === 1 ? "release" : "releases"} ahead`;
}
function eE(e, t) {
	return e.release_id === t.release_id && e.source_revision === t.source_revision && e.build_id === t.build_id && e.product_version === t.product_version && e.schema_version === t.schema_version;
}
// src/app/features/managed/upgradeContract.ts
var tE = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying",
	"succeeded",
	"failed"
]), nE = /* @__PURE__ */ new Set([
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
]), rE = /* @__PURE__ */ new Set([
	"wait",
	"cancel_active_run",
	"cancel_traditional_child",
	"cancel_managed_orchestrator",
	"terminate_terminal",
	"cancel_clone_operation"
]), iE = {
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
}, aE = class extends Error {
	constructor() {
		super("Managed upgrade status did not match the browser contract."), this.name = "ManagedUpgradeContractError";
	}
};
function oE() {
	throw new aE();
}
function sE(e, t, n) {
	(typeof e != "object" || !e || Array.isArray(e)) && oE();
	let r = e;
	return Object.keys(r).some((e) => !t.includes(e)) && oE(), n.some((e) => !Object.hasOwn(r, e)) && oE(), r;
}
function cE(e, t, n = !0) {
	return (typeof e != "string" || e.length > t || !n && e.length === 0 || /\p{Cc}/u.test(e)) && oE(), e;
}
function lE(e) {
	return (typeof e != "number" || !Number.isSafeInteger(e) || e < 0) && oE(), e;
}
function uE(e, t) {
	return typeof e == "string" && t.has(e) || oE(), e;
}
function dE(e, t, n) {
	return Object.hasOwn(e, t) ? cE(e[t], n) : void 0;
}
function fE(e) {
	let t = sE(e, [
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
	]), n = cE(t.source_revision, 40, !1);
	return /^[a-f0-9]{40}$/.test(n) || oE(), {
		release_id: cE(t.release_id, 63, !1),
		source_revision: n,
		build_id: cE(t.build_id, 128, !1),
		product_version: cE(t.product_version, 128, !1),
		schema_version: lE(t.schema_version)
	};
}
function pE(e, t) {
	return Object.hasOwn(e, t) ? fE(e[t]) : void 0;
}
function mE(e) {
	let t = cE(e, 128, !1);
	return /^[A-Za-z0-9_.:@-]+$/.test(t) || oE(), t;
}
function hE(e) {
	let t = [
		"session_id",
		"run_id",
		"child_session_id",
		"orchestrator_session_id",
		"terminal_id",
		"clone_operation_id"
	], n = sE(e, t, []);
	return Object.fromEntries(t.filter((e) => Object.hasOwn(n, e)).map((e) => [e, mE(n[e])]));
}
function gE(e, t) {
	let n = Object.keys(e).sort();
	return n.length === t.length && t.every((t) => n.includes(t) && !!e[t]);
}
function _E(e, t, n) {
	switch (t) {
		case "cancel_active_run": return e === "active_run" && gE(n, ["session_id", "run_id"]);
		case "cancel_traditional_child": return e === "traditional_child" && gE(n, ["session_id", "child_session_id"]);
		case "cancel_managed_orchestrator": return e === "managed_orchestrator" && gE(n, ["session_id", "orchestrator_session_id"]);
		case "terminate_terminal": return e === "terminal_process" && gE(n, ["session_id", "terminal_id"]);
		case "cancel_clone_operation": return e === "clone_operation" && gE(n, ["clone_operation_id"]);
		case "wait": return !1;
	}
}
function vE(e) {
	let t = sE(e, [
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
	]), n = cE(t.selection_key, 71, !1);
	/^sha256:[a-f0-9]{64}$/.test(n) || oE();
	let r = uE(t.kind, nE), i = cE(t.message, 512, !1);
	iE[r].includes(i) || oE(), typeof t.actionable != "boolean" && oE();
	let a = uE(t.action, rE);
	if (!t.actionable) return (a !== "wait" || t.target !== null) && oE(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !1,
		action: a,
		target: null
	};
	let o = hE(t.target);
	return _E(r, a, o) || oE(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !0,
		action: a,
		target: o
	};
}
function yE(e) {
	let t = sE(e, [
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
	t.kind !== "upgrade" && oE();
	let n;
	return Object.hasOwn(t, "blockers") && ((!Array.isArray(t.blockers) || t.blockers.length > 100) && oE(), n = t.blockers.map(vE)), {
		operation_id: cE(t.operation_id, 128, !1),
		managed_host_id: cE(t.managed_host_id, 128, !1),
		kind: "upgrade",
		state: uE(t.state, tE),
		reason: dE(t, "reason", 128),
		message: dE(t, "message", 512),
		target_release: pE(t, "target_release"),
		desired_release: pE(t, "desired_release"),
		observed_release: pE(t, "observed_release"),
		blockers: n,
		created_at: dE(t, "created_at", 64),
		updated_at: dE(t, "updated_at", 64)
	};
}
function bE(e) {
	let t = sE(e, ["preview", "operation"], ["preview", "operation"]), n = sE(t.preview, [
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
	typeof n.upgrade_available != "boolean" && oE();
	let r = null;
	return n.distance !== null && (r = { accepted_releases: lE(sE(n.distance, ["accepted_releases"], ["accepted_releases"]).accepted_releases) }), {
		preview: {
			current: fE(n.current),
			latest_beta: fE(n.latest_beta),
			upgrade_available: n.upgrade_available,
			distance: r
		},
		operation: t.operation === null ? null : yE(t.operation)
	};
}
// src/app/features/managed/queries.ts
var xE = {
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
function SE() {
	let { api: e } = r();
	return _({
		queryKey: xE.hostStatus,
		queryFn: ({ signal: t }) => e.getManagedStatus(t),
		staleTime: 5e3,
		refetchInterval: 15e3,
		retry: !1
	});
}
function CE(e = !0) {
	let { api: t } = r();
	return _({
		queryKey: xE.upgrade,
		queryFn: async ({ signal: e }) => bE(await t.getManagedUpgrade(e)),
		enabled: e,
		staleTime: 0,
		refetchInterval: (e) => e.state.data?.operation && XT(e.state.data.operation.state) ? 1e3 : 15e3,
		refetchIntervalInBackground: !0,
		retry: !1
	});
}
function wE() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: async (t) => yE(await e.startManagedUpgrade(t)),
		onSuccess: (e) => (t.setQueryData(xE.upgrade, (t) => t && {
			...t,
			operation: e
		}), t.invalidateQueries({ queryKey: xE.upgrade }))
	});
}
function TE(e = !0) {
	let { api: t } = r();
	return _({
		queryKey: xE.github,
		queryFn: ({ signal: e }) => t.getManagedGitHub(e),
		enabled: e,
		retry: !1
	});
}
function EE(e = !0) {
	let { api: t } = r();
	return _({
		queryKey: xE.secrets,
		queryFn: ({ signal: e }) => t.listManagedSecrets(e),
		enabled: e,
		retry: !1
	});
}
function DE() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: ({ name: t, value: n }) => e.putManagedSecret(t, n),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: xE.secrets }), t.invalidateQueries({ queryKey: xE.hostStatus })])
	});
}
function OE() {
	let { api: e } = r(), t = v();
	return g({
		mutationFn: (t) => e.deleteManagedSecret(t),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: xE.secrets }), t.invalidateQueries({ queryKey: xE.hostStatus })])
	});
}
function kE(e = !0, t = !1) {
	let { api: n } = r();
	return _({
		queryKey: xE.auth,
		queryFn: ({ signal: e }) => n.listManagedAuth(e),
		enabled: e,
		staleTime: 3e4,
		refetchInterval: t,
		retry: !1
	});
}
function AE(e, t, n) {
	let { api: i } = r();
	return _({
		queryKey: [
			...xE.providerModels(e ?? ""),
			"after-refusal",
			t,
			n
		],
		queryFn: ({ signal: t }) => i.listProviderModels({ backend: e }, t),
		enabled: e !== null && t !== null && n !== null,
		retry: !1,
		staleTime: Infinity
	});
}
function jE(e, t, n = null) {
	let { api: i } = r();
	return _({
		queryKey: xE.providerModels(e ?? "", n),
		queryFn: ({ signal: t }) => i.listProviderModels(n ? {
			backend: e,
			base_url: n
		} : { backend: e }, t),
		enabled: t && e !== null,
		retry: !1,
		staleTime: 3e5
	});
}
function ME(e) {
	let { api: t } = r(), n = SE().data ?? null, i = m(() => WT(e, n), [e, n]), a = re({ queries: i.map((e) => ({
		queryKey: xE.providerModels(e.backend, e.base_url),
		queryFn: ({ signal: n }) => t.listProviderModels(e, n),
		retry: !1,
		staleTime: 3e5
	})) }), o = /* @__PURE__ */ new Map();
	return i.forEach((e, t) => {
		let n = a[t];
		n?.isPending ? o.set(e.backend, null) : n?.isSuccess && o.set(e.backend, n.data.models);
	}), o;
}
// src/app/providers/ToastProvider.tsx
var NE = u(null), PE = 150, FE = 3, IE = 0, LE = () => `toast-${Date.now()}-${IE++}`;
function RE({ toasts: e, removeToast: t }) {
	let n = a(), r = h(/* @__PURE__ */ new Map());
	return p(() => {
		let n = r.current;
		for (let r of e) r.keep || r.dismissing || n.has(r.id) || n.set(r.id, setTimeout(() => t(r.id), r.life * 1e3));
		let i = new Set(e.map((e) => e.id));
		for (let [e, t] of n) i.has(e) || (clearTimeout(t), n.delete(e));
	}, [e, t]), p(() => {
		let e = r.current;
		return () => e.forEach((e) => clearTimeout(e));
	}, []), se(/* @__PURE__ */ ae("div", {
		role: "region",
		"aria-label": "Notifications",
		"aria-live": "polite",
		"aria-relevant": "additions",
		className: "fixed inset-x-0 top-[calc(10px+env(safe-area-inset-top))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2 pointer-events-none",
		children: e.map((e) => /* @__PURE__ */ ae("div", {
			className: "pointer-events-none flex w-full justify-center",
			children: /* @__PURE__ */ ae(c, {
				content: e.content,
				variant: e.variant,
				dismissing: e.dismissing,
				onClose: () => t(e.id)
			})
		}, e.id))
	}), n);
}
function zE({ children: e }) {
	let [t, n] = ee([]), r = d((e) => {
		let t = LE();
		return n((n) => [...n, {
			id: t,
			content: e.content,
			variant: e.variant ?? s.Info,
			life: e.life ?? FE,
			keep: e.keep ?? !1,
			dismissing: !1
		}]), t;
	}, []), i = d((e) => {
		n((t) => {
			let r = t.find((t) => t.id === e);
			return !r || r.dismissing ? t : (setTimeout(() => n((t) => t.filter((t) => t.id !== e)), PE), t.map((t) => t.id === e ? {
				...t,
				dismissing: !0
			} : t));
		});
	}, []), a = d(() => {
		n((e) => e.length === 0 ? e : (setTimeout(() => n((e) => e.filter((e) => !e.dismissing)), PE), e.map((e) => ({
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
	return /* @__PURE__ */ oe(NE.Provider, {
		value: o,
		children: [e, /* @__PURE__ */ ae(RE, {
			toasts: t,
			removeToast: i
		})]
	});
}
function BE() {
	let e = f(NE);
	if (!e) throw Error("useToast must be used within a ToastProvider");
	return e;
}
function VE(e) {
	return e instanceof Error ? e.message : String(e);
}
// src/app/lib/PerfProfiler.tsx
var HE = (e, n, r) => {
	t(`commit:${e}`, {
		ms: r,
		fields: { phase: n },
		throttleMs: 1e3,
		slowMs: 16
	});
};
function UE({ id: t, children: n }) {
	return e() ? /* @__PURE__ */ ae(l, {
		id: t,
		onRender: HE,
		children: n
	}) : /* @__PURE__ */ ae(ie, { children: n });
}
// src/app/lib/workspaceLink.ts
var WE = /^(https?|ircs?|mailto|xmpp|file)$/i, GE = /^[a-zA-Z]:[\\/]/, KE = /^(https?|mailto|ircs?|xmpp):/i;
function qE(e) {
	let t = String(e ?? "").trim();
	if (!t) return "";
	if (GE.test(t)) return t;
	let n = t.indexOf(":");
	return n === -1 || WE.test(t.slice(0, n)) ? t : "";
}
function JE(e) {
	return e.replace(/\\/g, "/");
}
function YE(e, t) {
	if (!t) return null;
	let n = JE(t).replace(/\/+$/, "");
	return n ? e === n ? "" : e.startsWith(`${n}/`) ? e.slice(n.length + 1) : null : null;
}
function XE(e, t = []) {
	let n = (e ?? "").trim();
	if (!n || n.startsWith("#")) return { kind: "blocked" };
	if (KE.test(n)) return {
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
	r = JE(r);
	for (let e of t) {
		let t = YE(r, e);
		if (t != null) {
			r = t;
			break;
		}
	}
	return r.startsWith("/") || GE.test(r) || (r = r.replace(/^\.\//, ""), !r || r === ".") || r.split("/").includes("..") || r.includes("://") ? { kind: "blocked" } : {
		kind: "workspace",
		path: r
	};
}
export { vT as $, Mx as $n, IC as $t, zT as A, zS as An, ow as At, DT as B, QS as Bn, KC as Bt, ZT as C, oC as Cn, Aw as Ct, LT as D, lC as Dn, gw as Dt, eE as E, jC as En, hw as Et, PT as F, PS as Fn, XC as Ft, CT as G, LS as Gn, $C as Gt, OT as H, eC as Hn, aw as Ht, IT as I, VS as In, iw as It, mT as J, US as Jn, UC as Jt, ET as K, RS as Kn, lw as Kt, AT as L, ZS as Ln, qC as Lt, BT as M, BS as Mn, ew as Mt, FT as N, KS as Nn, QC as Nt, VT as O, nC as On, JC as Ot, jT as P, NS as Pn, cw as Pt, yT as Q, jx as Qn, BC as Qt, NT as R, FS as Rn, ZC as Rt, XT as S, sC as Sn, kw as St, KT as T, hC as Tn, Tw as Tt, ST as U, qS as Un, nw as Ut, kT as V, $S as Vn, YC as Vt, wT as W, IS as Wn, tw as Wt, iT as X, MS as Xn, VC as Xt, hT as Y, HS as Yn, RC as Yt, oT as Z, DS as Zn, zC as Zt, ME as _, CC as _n, Xw as _t, VE as a, mC as an, bp as ar, eT as at, qT as b, DC as bn, qw as bt, OE as c, gC as cn, Cn as cr, fT as ct, SE as d, fC as dn, le as dr, nT as dt, FC as en, Nx as er, tT as et, jE as f, yC as fn, de as fr, cT as ft, DE as g, bC as gn, he as gr, Gw as gt, AE as h, wC as hn, me as hr, bT as ht, zE as i, iC as in, yp as ir, rT as it, UT as j, GS as jn, rw as jt, HT as k, rC as kn, uw as kt, kE as l, MC as ln, y as lr, pT as lt, CE as m, pC as mn, ge as mr, sT as mt, qE as n, NC as nn, kx as nr, _T as nt, BE as o, AC as on, xp as or, Qw as ot, EE as p, vC as pn, pe as pr, uT as pt, TT as q, XS as qn, HC as qt, UE as r, EC as rn, Ax as rr, gT as rt, xE as s, cC as sn, oi as sr, Zw as st, XE as t, PC as tn, Fx as tr, lT as tt, TE as u, uC as un, ue as ur, dT as ut, wE as v, kC as vn, Hw as vt, JT as w, _C as wn, Nw as wt, $T as x, aC as xn, Bw as xt, QT as y, OC as yn, Kw as yt, MT as z, JS as zn, sw as zt };
