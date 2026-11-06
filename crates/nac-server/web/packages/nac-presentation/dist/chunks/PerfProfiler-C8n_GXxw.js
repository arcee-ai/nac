import { E as e, L as t, T as n, a as r, n as i } from "./RuntimeContext-BntTaIwR.js";
import { a, y as o } from "./PresentationBoundary-DgJz1GXw.js";
import { n as s, t as c } from "./Toast-y4mFgUIo.js";
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
var fe = {
	list: () => "/",
	session: (e, t = ue) => `/session/${encodeURIComponent(e)}/${t}`,
	project: (e) => `/project/${encodeURIComponent(e)}`,
	taskSchedules: (e) => e ? `/project/${encodeURIComponent(e)}/task-schedules` : "/task-schedules",
	designPreview: () => "/design"
};
function pe(e) {
	let [, t, n] = e.split("/");
	return t !== "session" || !n ? null : decodeURIComponent(n);
}
function me(e) {
	let [, t, n] = e.split("/");
	return t !== "project" || !n ? null : decodeURIComponent(n);
}
// src/app/features/ui-policy/policy.ts
var he = { orchestrationEnabled: !1 };
function ge(e, t) {
	return e.orchestrationEnabled ? t : "direct";
}
function _e(e, t, n) {
	return e.orchestrationEnabled || t === "direct" && n?.kind !== "managed-orchestrator";
}
function ve(e, t) {
	return t.filter((t) => _e(e, t.summary.behavior, t.lineage));
}
function ye(e, t, n) {
	return e.orchestrationEnabled || !t.some((e) => e.lineage == null && e.summary.project_id === n);
}
// src/app/features/ui-policy/UiPolicyContext.ts
var be = u(he);
function xe() {
	return f(be);
}
// src/app/services/queries/keys.ts
var Se = 5e3, Ce = 3e4, y = {
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
}, we = (e) => typeof e == "function", b = function(e, t) {
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
}, x = (e) => e, Te = (e) => () => e, Ee = /*#__PURE__*/ Te(!0), De = /*#__PURE__*/ Te(!1), Oe = /*#__PURE__*/ Te(void 0), ke = Oe;
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
var Ae = (e) => (t, n) => t === n || e(t, n), je = /*#__PURE__*/ b(2, (e, t) => Ae((n, r) => e(t(n), t(r)))), Me = (e) => Ae((t, n) => {
	if (t.length !== n.length) return !1;
	for (let r = 0; r < t.length; r++) if (!e(t[r], n[r])) return !1;
	return !0;
}), Ne = "effect/GlobalValue", Pe, C = (e, t) => (Pe ||= (globalThis[Ne] ??= /* @__PURE__ */ new Map(), globalThis[Ne]), Pe.has(e) || Pe.set(e, t()), Pe.get(e)), Fe = (e) => typeof e == "string", Ie = (e) => typeof e == "number", Le = (e) => typeof e == "bigint", Re = we, ze = (e) => typeof e == "object" && !!e, Be = (e) => ze(e) || Re(e), w = /*#__PURE__*/ b(2, (e, t) => Be(e) && t in e), Ve = /*#__PURE__*/ b(2, (e, t) => w(e, "_tag") && e._tag === t), He = (e) => e == null, Ue = (e) => typeof e == "string" || w(e, Symbol.iterator), We = (e) => w(e, "then") && Re(e.then), Ge = (e) => `BUG: ${e} - please report an issue at https://github.com/Effect-TS/effect/issues`, Ke = class e {
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
}, qe = 335903614, Je = 4150755663, Ye = 1481765933, Xe = 1284865837, Ze = 9007199254740992, Qe = 134217728, $e = class {
	_state;
	constructor(e, t, n, r) {
		return He(t) && He(e) ? (t = Math.random() * 4294967295 >>> 0, e = 0) : He(t) && (t = e, e = 0), He(r) && He(n) ? (r = this._state ? this._state[3] : Je, n = this._state ? this._state[2] : qe) : He(r) && (r = n, n = 0), this._state = new Int32Array([
			0,
			0,
			n >>> 0,
			((r || 0) | 1) >>> 0
		]), this._next(), tt(this._state, this._state[0], this._state[1], e >>> 0, t >>> 0), this._next(), this;
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
		return (e * Qe + t) / Ze;
	}
	_next() {
		let e = this._state[0] >>> 0, t = this._state[1] >>> 0;
		et(this._state, e, t, Ye, Xe), tt(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
		let n = e >>> 18, r = (t >>> 18 | e << 14) >>> 0;
		n = (n ^ e) >>> 0, r = (r ^ t) >>> 0;
		let i = (r >>> 27 | n << 5) >>> 0, a = e >>> 27, o = (-a >>> 0 & 31) >>> 0;
		return (i >>> a | i << o) >>> 0;
	}
};
function et(e, t, n, r, i) {
	let a = (n >>> 16) * (i & 65535) >>> 0, o = (n & 65535) * (i >>> 16) >>> 0, s = (n & 65535) * (i & 65535) >>> 0, c = (n >>> 16) * (i >>> 16) + ((o >>> 16) + (a >>> 16)) >>> 0;
	o = o << 16 >>> 0, s = s + o >>> 0, s >>> 0 < o >>> 0 && (c = c + 1 >>> 0), a = a << 16 >>> 0, s = s + a >>> 0, s >>> 0 < a >>> 0 && (c = c + 1 >>> 0), c = c + Math.imul(n, r) >>> 0, c = c + Math.imul(t, i) >>> 0, e[0] = c, e[1] = s;
}
function tt(e, t, n, r, i) {
	let a = t + r >>> 0, o = n + i >>> 0;
	o >>> 0 < n >>> 0 && (a = a + 1 | 0), e[0] = a, e[1] = o;
}
var nt = /*#__PURE__*/ Symbol.for("effect/Utils/YieldWrap"), rt = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	[nt]() {
		return this.#e;
	}
};
function it(e) {
	if (typeof e == "object" && e && nt in e) return e[nt]();
	throw Error(Ge("yieldWrapGet"));
}
var at = /*#__PURE__*/ C("effect/Utils/isStructuralRegion", () => ({
	enabled: !1,
	tester: void 0
})), ot = { effect_internal_function: (e) => e() }, T = /*#__PURE__*/ ot.effect_internal_function(() => (/* @__PURE__ */ Error()).stack)?.includes("effect_internal_function") === !0 ? ot.effect_internal_function : { effect_internal_function: (e) => {
	try {
		return e();
	} finally {}
} }.effect_internal_function;
(function* () {}).constructor;
// node_modules/effect/dist/esm/Hash.js
var st = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Hash/randomHashCache"), () => /* @__PURE__ */ new WeakMap()), E = /*#__PURE__*/ Symbol.for("effect/Hash"), D = (e) => {
	if (at.enabled === !0) return 0;
	switch (typeof e) {
		case "number": return dt(e);
		case "bigint": return k(e.toString(10));
		case "boolean": return k(String(e));
		case "symbol": return k(String(e));
		case "string": return k(e);
		case "undefined": return k("undefined");
		case "function":
		case "object": return e === null ? k("null") : e instanceof Date ? Number.isNaN(e.getTime()) ? k("Invalid Date") : D(e.toISOString()) : e instanceof URL ? D(e.href) : ut(e) ? e[E]() : ct(e);
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, ct = (e) => (st.has(e) || st.set(e, dt(Math.floor(Math.random() * (2 ** 53 - 1)))), st.get(e)), O = (e) => (t) => t * 53 ^ e, lt = (e) => e & 3221225471 | e >>> 1 & 1073741824, ut = (e) => w(e, E), dt = (e) => {
	if (e !== e || e === Infinity) return 0;
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return lt(t);
}, k = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return lt(t);
}, ft = (e, t) => {
	let n = 12289;
	for (let r = 0; r < t.length; r++) n ^= S(k(t[r]), O(D(e[t[r]])));
	return lt(n);
}, pt = (e) => ft(e, Object.keys(e)), mt = (e) => {
	let t = 6151;
	for (let n = 0; n < e.length; n++) t = S(t, O(D(e[n])));
	return lt(t);
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
	return arguments.length === 1 ? (e) => ht(e, arguments[0]) : ht(arguments[0], arguments[1]);
}
function ht(e, t) {
	if (e === t) return !0;
	let n = typeof e;
	if (n !== typeof t) return !1;
	if (n === "object" || n === "function") {
		if (e !== null && t !== null) {
			if (gt(e) && gt(t)) return D(e) === D(t) && e[j](t) ? !0 : at.enabled && at.tester ? at.tester(e, t) : !1;
			if (e instanceof Date && t instanceof Date) {
				let n = e.getTime(), r = t.getTime();
				return n === r || Number.isNaN(n) && Number.isNaN(r);
			}
			if (e instanceof URL && t instanceof URL) return e.href === t.href;
		}
		if (at.enabled) {
			if (e === null || t === null) return !1;
			if (Array.isArray(e) && Array.isArray(t)) return e.length === t.length && e.every((e, n) => ht(e, t[n]));
			if (Object.getPrototypeOf(e) === Object.prototype && Object.getPrototypeOf(t) === Object.prototype) {
				let n = Object.keys(e), r = Object.keys(t);
				if (n.length === r.length) {
					for (let r of n) if (!(r in t && ht(e[r], t[r]))) return at.tester ? at.tester(e, t) : !1;
					return !0;
				}
			}
			return at.tester ? at.tester(e, t) : !1;
		}
	}
	return at.enabled && at.tester ? at.tester(e, t) : !1;
}
var gt = (e) => w(e, j), _t = () => M, N = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), P = (e) => {
	try {
		if (w(e, "toJSON") && Re(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(P);
	} catch {
		return {};
	}
	return wt(e);
}, F = (e) => JSON.stringify(e, null, 2), vt = (e, t = 2) => {
	if (typeof e == "string") return e;
	try {
		return typeof e == "object" ? yt(e, t) : String(e);
	} catch {
		return String(e);
	}
}, yt = (e, t) => {
	let n = [], r = JSON.stringify(e, (e, t) => typeof t == "object" && t ? n.includes(t) ? void 0 : n.push(t) && (St.fiberRefs !== void 0 && xt(t) ? t[bt](St.fiberRefs) : t) : t, t);
	return n = void 0, r;
}, bt = /*#__PURE__*/ Symbol.for("effect/Inspectable/Redactable"), xt = (e) => typeof e == "object" && !!e && bt in e, St = /*#__PURE__*/ C("effect/Inspectable/redactableState", () => ({ fiberRefs: void 0 })), Ct = (e, t) => {
	let n = St.fiberRefs;
	St.fiberRefs = e;
	try {
		return t();
	} finally {
		St.fiberRefs = n;
	}
}, wt = (e) => xt(e) && St.fiberRefs !== void 0 ? e[bt](St.fiberRefs) : e, I = (e, t) => {
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
}, Tt = "Async", Et = "Commit", Dt = "Failure", Ot = "OnFailure", kt = "OnSuccess", At = "OnSuccessAndFailure", jt = "Success", Mt = "Sync", Nt = "UpdateRuntimeFlags", Pt = "While", Ft = "Iterator", It = "WithRuntime", Lt = "Yield", Rt = "RevertFlags", zt = "3.22.2", Bt = () => zt, Vt = /*#__PURE__*/ Symbol.for("effect/Effect"), Ht = /*#__PURE__*/ Symbol.for("effect/Stream"), Ut = /*#__PURE__*/ Symbol.for("effect/Sink"), Wt = /*#__PURE__*/ Symbol.for("effect/Channel"), Gt = {
	/* c8 ignore next */
	_R: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e,
	_V: /*#__PURE__*/ Bt()
}, Kt = {
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
}, qt = {
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
}, Jt = {
	[Vt]: Gt,
	[Ht]: Gt,
	[Ut]: Kt,
	[Wt]: qt,
	[j](e) {
		return this === e;
	},
	[E]() {
		return A(this, ct(this));
	},
	[Symbol.iterator]() {
		return new Ke(new rt(this));
	},
	pipe() {
		return I(this, arguments);
	}
}, Yt = {
	[E]() {
		return A(this, pt(this));
	},
	[j](e) {
		let t = Object.keys(this), n = Object.keys(e);
		if (t.length !== n.length) return !1;
		for (let n of t) if (!(n in e && M(this[n], e[n]))) return !1;
		return !0;
	}
}, Xt = {
	...Jt,
	_op: Et
}, Zt = {
	...Xt,
	...Yt
}, Qt = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = Xt, e;
}(), $t = /*#__PURE__*/ Symbol.for("effect/Option"), en = {
	...Jt,
	[$t]: { _A: (e) => e },
	[N]() {
		return this.toJSON();
	},
	toString() {
		return F(this.toJSON());
	}
}, tn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(en), {
	_tag: "Some",
	_op: "Some",
	[j](e) {
		return an(e) && sn(e) && M(this.value, e.value);
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
}), nn = /*#__PURE__*/ D("None"), rn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(en), {
	_tag: "None",
	_op: "None",
	[j](e) {
		return an(e) && on(e);
	},
	[E]() {
		return nn;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), an = (e) => w(e, $t), on = (e) => e._tag === "None", sn = (e) => e._tag === "Some", cn = /*#__PURE__*/ Object.create(rn), ln = (e) => {
	let t = Object.create(tn);
	return t.value = e, t;
}, un = /*#__PURE__*/ Symbol.for("effect/Either"), dn = {
	...Jt,
	[un]: { _R: (e) => e },
	[N]() {
		return this.toJSON();
	},
	toString() {
		return F(this.toJSON());
	}
}, fn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(dn), {
	_tag: "Right",
	_op: "Right",
	[j](e) {
		return mn(e) && gn(e) && M(this.right, e.right);
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
}), pn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(dn), {
	_tag: "Left",
	_op: "Left",
	[j](e) {
		return mn(e) && hn(e) && M(this.left, e.left);
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
}), mn = (e) => w(e, un), hn = (e) => e._tag === "Left", gn = (e) => e._tag === "Right", _n = (e) => {
	let t = Object.create(pn);
	return t.left = e, t;
}, vn = (e) => {
	let t = Object.create(fn);
	return t.right = e, t;
}, yn = _n, bn = hn, xn = gn, Sn = /*#__PURE__*/ (/* @__PURE__ */ b(2, (e, { onLeft: t, onRight: n }) => bn(e) ? t(e.left) : n(e.right)))({
	onLeft: x,
	onRight: x
}), Cn = (e) => e.length > 0, wn = (e) => (t, n) => t === n ? 0 : e(t, n), Tn = /*#__PURE__*/ wn((e, t) => e < t ? -1 : 1), En = /*#__PURE__*/ b(2, (e, t) => wn((n, r) => e(t(n), t(r)))), Dn = (e) => b(2, (t, n) => e(t, n) === 1), L = () => cn, R = ln, On = on, kn = sn, An = /*#__PURE__*/ b(2, (e, { onNone: t, onSome: n }) => On(e) ? t() : n(e.value)), jn = /*#__PURE__*/ b(2, (e, t) => On(e) ? t() : e.value), Mn = /*#__PURE__*/ b(2, (e, t) => On(e) ? R(t()) : e), Nn = (e) => e == null ? L() : R(e), Pn = /*#__PURE__*/ jn(Oe), Fn = /*#__PURE__*/ b(2, (e, t) => On(e) ? L() : R(t(e.value))), In = /*#__PURE__*/ b(2, (e, t) => On(e) ? L() : t(e.value)), Ln = /*#__PURE__*/ ((e) => b(2, (t, n) => !On(t) && e(t.value, n)))(/* @__PURE__ */ _t()), Rn = (...e) => e, zn = (e) => Array(e), Bn = /*#__PURE__*/ b(2, (e, t) => {
	let n = Math.max(1, Math.floor(e)), r = Array(n);
	for (let e = 0; e < n; e++) r[e] = t(e);
	return r;
}), z = (e) => Array.isArray(e) ? e : Array.from(e), Vn = (e) => Array.isArray(e) ? e : [e], Hn = /*#__PURE__*/ b(2, (e, t) => [t, ...e]), Un = /*#__PURE__*/ b(2, (e, t) => [...e, t]), Wn = /*#__PURE__*/ b(2, (e, t) => z(e).concat(z(t)));
Array.isArray;
var Gn = (e) => e.length === 0, Kn = Cn, qn = Cn, Jn = (e, t) => e < 0 || e >= t.length, Yn = (e, t) => Math.floor(Math.min(Math.max(0, e), t.length)), Xn = /*#__PURE__*/ b(2, (e, t) => {
	let n = Math.floor(t);
	return Jn(n, e) ? L() : R(e[n]);
}), Zn = /*#__PURE__*/ b(2, (e, t) => {
	let n = Math.floor(t);
	if (Jn(n, e)) throw Error(`Index ${n} out of bounds`);
	return e[n];
}), Qn = /*#__PURE__*/ Xn(0), $n = /*#__PURE__*/ Zn(0), er = (e) => qn(e) ? R(tr(e)) : L(), tr = (e) => e[e.length - 1], nr = (e) => e.slice(1), rr = (e, t) => {
	let n = 0;
	for (let r of e) {
		if (!t(r, n)) break;
		n++;
	}
	return n;
}, ir = /*#__PURE__*/ b(2, (e, t) => dr(e, rr(e, t))), ar = /*#__PURE__*/ b(2, (e, t) => {
	let n = z(e);
	return n.slice(Yn(t, n), n.length);
}), or = (e) => Array.from(e).reverse(), sr = /*#__PURE__*/ b(2, (e, t) => {
	let n = Array.from(e);
	return n.sort(t), n;
}), cr = /*#__PURE__*/ b(2, (e, t) => lr(e, t, Rn)), lr = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = z(e), i = z(t);
	if (qn(r) && qn(i)) {
		let e = [n($n(r), $n(i))], t = Math.min(r.length, i.length);
		for (let a = 1; a < t; a++) e[a] = n(r[a], i[a]);
		return e;
	}
	return [];
}), ur = /*#__PURE__*/ _t(), dr = /*#__PURE__*/ b(2, (e, t) => {
	let n = Array.from(e), r = Math.floor(t);
	return qn(n) ? r >= 1 ? fr(n, r) : [[], n] : [n, []];
}), fr = /*#__PURE__*/ b(2, (e, t) => {
	let n = Math.max(1, Math.floor(t));
	return n >= e.length ? [pr(e), []] : [Hn(e.slice(1, n), $n(e)), e.slice(n)];
}), pr = (e) => e.slice(), mr = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = z(e), i = z(t);
	return qn(r) ? qn(i) ? Cr(n)(Wn(r, i)) : r : i;
}), hr = /*#__PURE__*/ b(2, (e, t) => mr(e, t, ur)), gr = () => [], _r = (e) => [e], vr = /*#__PURE__*/ b(2, (e, t) => e.map(t)), yr = /*#__PURE__*/ (/* @__PURE__ */ b(2, (e, t) => {
	if (Gn(e)) return [];
	let n = [];
	for (let r = 0; r < e.length; r++) {
		let i = t(e[r], r);
		for (let e = 0; e < i.length; e++) n.push(i[e]);
	}
	return n;
}))(x), br = /*#__PURE__*/ b(3, (e, t, n) => z(e).reduce((e, t, r) => n(e, t, r), t)), xr = (e, t) => {
	let n = [], r = e, i;
	for (; kn(i = t(r));) {
		let [e, t] = i.value;
		n.push(e), r = t;
	}
	return n;
}, Sr = Me, Cr = /*#__PURE__*/ b(2, (e, t) => {
	let n = z(e);
	if (qn(n)) {
		let e = [$n(n)], r = nr(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), wr = (e) => Cr(e, _t()), Tr = /*#__PURE__*/ b(2, (e, t) => z(e).join(t)), Er = Tn, Dr = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"), Or = /*#__PURE__*/ Symbol.for("effect/Context/Tag"), kr = /*#__PURE__*/ Symbol.for("effect/Context/Reference"), Ar = /*#__PURE__*/ Symbol.for("effect/STM"), jr = {
	...Jt,
	_op: "Tag",
	[Ar]: Gt,
	[Or]: {
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
		return Gr(this, e);
	}
}, Mr = {
	...jr,
	[kr]: kr
}, Nr = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	let r = Object.create(jr);
	return Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r.key = e, r;
}, Pr = (e) => () => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	function r() {}
	return Object.setPrototypeOf(r, jr), r.key = e, Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r;
}, Fr = () => (e, t) => {
	let n = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let r = /* @__PURE__ */ Error();
	Error.stackTraceLimit = n;
	function i() {}
	return Object.setPrototypeOf(i, Mr), i.key = e, i.defaultValue = t.defaultValue, Object.defineProperty(i, "stack", { get() {
		return r.stack;
	} }), i;
}, Ir = /*#__PURE__*/ Symbol.for("effect/Context"), Lr = {
	[Ir]: { _Services: (e) => e },
	[j](e) {
		if (Br(e) && this.unsafeMap.size === e.unsafeMap.size) {
			for (let t of this.unsafeMap.keys()) if (!e.unsafeMap.has(t) || !M(this.unsafeMap.get(t), e.unsafeMap.get(t))) return !1;
			return !0;
		}
		return !1;
	},
	[E]() {
		return A(this, dt(this.unsafeMap.size));
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
}, Rr = (e) => {
	let t = Object.create(Lr);
	return t.unsafeMap = e, t;
}, zr = (e) => {
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
}, Br = (e) => w(e, Ir), Vr = (e) => w(e, Or), Hr = (e) => w(e, kr), Ur = /*#__PURE__*/ Rr(/*#__PURE__*/ new Map()), Wr = () => Ur, Gr = (e, t) => Rr(/* @__PURE__ */ new Map([[e.key, t]])), Kr = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = new Map(e.unsafeMap);
	return r.set(t.key, n), Rr(r);
}), qr = /*#__PURE__*/ C("effect/Context/defaultValueCache", () => /* @__PURE__ */ new Map()), Jr = (e) => {
	if (qr.has(e.key)) return qr.get(e.key);
	let t = e.defaultValue();
	return qr.set(e.key, t), t;
}, Yr = (e, t) => e.unsafeMap.has(t.key) ? e.unsafeMap.get(t.key) : Jr(t), Xr = /*#__PURE__*/ b(2, (e, t) => {
	if (!e.unsafeMap.has(t.key)) {
		if (kr in t) return Jr(t);
		throw zr(t);
	}
	return e.unsafeMap.get(t.key);
}), Zr = Xr, Qr = /*#__PURE__*/ b(2, (e, t) => e.unsafeMap.has(t.key) ? ln(e.unsafeMap.get(t.key)) : Hr(t) ? ln(Jr(t)) : cn), $r = /*#__PURE__*/ b(2, (e, t) => {
	let n = new Map(e.unsafeMap);
	for (let [e, r] of t.unsafeMap) n.set(e, r);
	return Rr(n);
}), ei = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n = 0; n < e.length; n++) e[n].unsafeMap.forEach((e, n) => {
		t.set(n, e);
	});
	return Rr(t);
}, ti = Nr, ni = Br, ri = Vr, ii = Wr, ai = Gr, oi = Kr, si = Zr, ci = Xr, li = Qr, ui = $r, di = ei, fi = Pr, pi = Fr, mi = /*#__PURE__*/ Symbol.for("effect/Chunk");
function hi(e, t, n, r, i) {
	for (let a = t; a < Math.min(e.length, t + i); a++) n[r + a - t] = e[a];
	return n;
}
var gi = [], _i = /*#__PURE__*/ ((e) => Ae((t, n) => t.length === n.length && Ei(t).every((t, r) => e(t, ji(n, r)))))(M), vi = {
	[mi]: { _A: (e) => e },
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Chunk",
			values: Ei(this).map(P)
		};
	},
	[N]() {
		return this.toJSON();
	},
	[j](e) {
		return yi(e) && _i(this, e);
	},
	[E]() {
		return A(this, mt(Ei(this)));
	},
	[Symbol.iterator]() {
		switch (this.backing._tag) {
			case "IArray": return this.backing.array[Symbol.iterator]();
			case "IEmpty": return gi[Symbol.iterator]();
			default: return Ei(this)[Symbol.iterator]();
		}
	},
	pipe() {
		return I(this, arguments);
	}
}, B = (e) => {
	let t = Object.create(vi);
	switch (t.backing = e, e._tag) {
		case "IEmpty":
			t.length = 0, t.depth = 0, t.left = t, t.right = t;
			break;
		case "IConcat":
			t.length = e.left.length + e.right.length, t.depth = 1 + Math.max(e.left.depth, e.right.depth), t.left = e.left, t.right = e.right;
			break;
		case "IArray":
			t.length = e.array.length, t.depth = 0, t.left = bi, t.right = bi;
			break;
		case "ISingleton":
			t.length = 1, t.depth = 0, t.left = bi, t.right = bi;
			break;
		case "ISlice": t.length = e.length, t.depth = e.chunk.depth + 1, t.left = bi, t.right = bi;
	}
	return t;
}, yi = (e) => w(e, mi), bi = /*#__PURE__*/ B({ _tag: "IEmpty" }), xi = () => bi, Si = (...e) => Ai(e), Ci = (e) => B({
	_tag: "ISingleton",
	a: e
}), wi = (e) => yi(e) ? e : ki(z(e)), Ti = (e, t, n) => {
	switch (e.backing._tag) {
		case "IArray":
			hi(e.backing.array, 0, t, n, e.length);
			break;
		case "IConcat":
			Ti(e.left, t, n), Ti(e.right, t, n + e.left.length);
			break;
		case "ISingleton":
			t[n] = e.backing.a;
			break;
		case "ISlice": {
			let r = 0, i = n;
			for (; r < e.length;) t[i] = ji(e, r), r += 1, i += 1;
			break;
		}
	}
}, Ei = (e) => {
	switch (e.backing._tag) {
		case "IEmpty": return gi;
		case "IArray": return e.backing.array;
		default: {
			let t = Array(e.length);
			return Ti(e, t, 0), e.backing = {
				_tag: "IArray",
				array: t
			}, e.left = bi, e.right = bi, e.depth = 0, t;
		}
	}
}, Di = (e) => {
	switch (e.backing._tag) {
		case "IEmpty":
		case "ISingleton": return e;
		case "IArray": return B({
			_tag: "IArray",
			array: or(e.backing.array)
		});
		case "IConcat": return B({
			_tag: "IConcat",
			left: Di(e.backing.right),
			right: Di(e.backing.left)
		});
		case "ISlice": return ki(or(Ei(e)));
	}
}, Oi = /*#__PURE__*/ b(2, (e, t) => t < 0 || t >= e.length ? L() : R(ji(e, t))), ki = (e) => e.length === 0 ? xi() : e.length === 1 ? Ci(e[0]) : B({
	_tag: "IArray",
	array: e
}), Ai = (e) => ki(e), ji = /*#__PURE__*/ b(2, (e, t) => {
	switch (e.backing._tag) {
		case "IEmpty": throw Error("Index out of bounds");
		case "ISingleton":
			if (t !== 0) throw Error("Index out of bounds");
			return e.backing.a;
		case "IArray":
			if (t >= e.length || t < 0) throw Error("Index out of bounds");
			return e.backing.array[t];
		case "IConcat": return t < e.left.length ? ji(e.left, t) : ji(e.right, t - e.left.length);
		case "ISlice": return ji(e.backing.chunk, t + e.backing.offset);
	}
}), Mi = /*#__PURE__*/ b(2, (e, t) => Fi(e, Ci(t))), Ni = /*#__PURE__*/ b(2, (e, t) => Fi(Ci(t), e)), Pi = /*#__PURE__*/ b(2, (e, t) => {
	if (t <= 0) return e;
	if (t >= e.length) return bi;
	switch (e.backing._tag) {
		case "ISlice": return B({
			_tag: "ISlice",
			chunk: e.backing.chunk,
			offset: e.backing.offset + t,
			length: e.backing.length - t
		});
		case "IConcat": return t > e.left.length ? Pi(e.right, t - e.left.length) : B({
			_tag: "IConcat",
			left: Pi(e.left, t),
			right: e.right
		});
		default: return B({
			_tag: "ISlice",
			chunk: e,
			offset: t,
			length: e.length - t
		});
	}
}), Fi = /*#__PURE__*/ b(2, (e, t) => {
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
			let n = Fi(e.right, t);
			return B({
				_tag: "IConcat",
				left: e.left,
				right: n
			});
		}
		{
			let n = Fi(e.right.right, t);
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
		left: Fi(e, t.left),
		right: t.right
	});
	{
		let n = Fi(e, t.left.left);
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
}), Ii = (e) => e.length === 0, Li = (e) => e.length > 0, Ri = /*#__PURE__*/ Oi(0), zi = (e) => ji(e, 0), Bi = zi, Vi = (e) => Pi(e, 1), Hi = /*#__PURE__*/ Symbol.for("effect/Duration"), Ui = /*#__PURE__*/ BigInt(0), Wi = /*#__PURE__*/ BigInt(24), Gi = /*#__PURE__*/ BigInt(60), Ki = /*#__PURE__*/ BigInt(1e3), qi = /*#__PURE__*/ BigInt(1e6), Ji = /*#__PURE__*/ BigInt(1e9), Yi = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Xi = (e) => {
	if (ta(e)) return e;
	if (Ie(e)) return sa(e);
	if (Le(e)) return aa(e);
	if (Array.isArray(e) && e.length === 2 && e.every(Ie)) return e[0] === -Infinity || e[1] === -Infinity || Number.isNaN(e[0]) || Number.isNaN(e[1]) ? ra : e[0] === Infinity || e[1] === Infinity ? ia : aa(BigInt(Math.round(e[0] * 1e9)) + BigInt(Math.round(e[1])));
	if (Fe(e)) {
		let t = Yi.exec(e);
		if (t) {
			let [e, n, r] = t, i = Number(n);
			switch (r) {
				case "nano":
				case "nanos": return aa(BigInt(n));
				case "micro":
				case "micros": return oa(BigInt(n));
				case "milli":
				case "millis": return sa(i);
				case "second":
				case "seconds": return ca(i);
				case "minute":
				case "minutes": return la(i);
				case "hour":
				case "hours": return ua(i);
				case "day":
				case "days": return da(i);
				case "week":
				case "weeks": return fa(i);
			}
		}
	}
	throw Error("Invalid DurationInput");
}, Zi = {
	_tag: "Millis",
	millis: 0
}, Qi = { _tag: "Infinity" }, $i = {
	[Hi]: Hi,
	[E]() {
		return A(this, pt(this.value));
	},
	[j](e) {
		return ta(e) && xa(this, e);
	},
	toString() {
		return `Duration(${Ca(this)})`;
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
				hrtime: ha(this)
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
}, ea = (e) => {
	let t = Object.create($i);
	return t.value = Ie(e) ? isNaN(e) || e <= 0 ? Zi : Number.isFinite(e) ? Number.isInteger(e) ? {
		_tag: "Millis",
		millis: e
	} : {
		_tag: "Nanos",
		nanos: BigInt(Math.round(e * 1e6))
	} : Qi : e <= Ui ? Zi : {
		_tag: "Nanos",
		nanos: e
	}, t;
}, ta = (e) => w(e, Hi), na = (e) => {
	switch (e.value._tag) {
		case "Millis": return e.value.millis === 0;
		case "Nanos": return e.value.nanos === Ui;
		case "Infinity": return !1;
	}
}, ra = /*#__PURE__*/ ea(0), ia = /*#__PURE__*/ ea(Infinity), aa = (e) => ea(e), oa = (e) => ea(e * Ki), sa = (e) => ea(e), ca = (e) => ea(e * 1e3), la = (e) => ea(e * 6e4), ua = (e) => ea(e * 36e5), da = (e) => ea(e * 864e5), fa = (e) => ea(e * 6048e5), pa = (e) => ga(e, {
	onMillis: (e) => e,
	onNanos: (e) => Number(e) / 1e6
}), ma = (e) => {
	let t = Xi(e);
	switch (t.value._tag) {
		case "Infinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return BigInt(Math.round(t.value.millis * 1e6));
	}
}, ha = (e) => {
	let t = Xi(e);
	switch (t.value._tag) {
		case "Infinity": return [Infinity, 0];
		case "Nanos": return [Number(t.value.nanos / Ji), Number(t.value.nanos % Ji)];
		case "Millis": return [Math.floor(t.value.millis / 1e3), Math.round(t.value.millis % 1e3 * 1e6)];
	}
}, ga = /*#__PURE__*/ b(2, (e, t) => {
	let n = Xi(e);
	switch (n.value._tag) {
		case "Nanos": return t.onNanos(n.value.nanos);
		case "Infinity": return t.onMillis(Infinity);
		case "Millis": return t.onMillis(n.value.millis);
	}
}), _a = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = Xi(e), i = Xi(t);
	if (r.value._tag === "Infinity" || i.value._tag === "Infinity") return n.onMillis(pa(r), pa(i));
	if (r.value._tag === "Nanos" || i.value._tag === "Nanos") {
		let e = r.value._tag === "Nanos" ? r.value.nanos : BigInt(Math.round(r.value.millis * 1e6)), t = i.value._tag === "Nanos" ? i.value.nanos : BigInt(Math.round(i.value.millis * 1e6));
		return n.onNanos(e, t);
	}
	return n.onMillis(r.value.millis, i.value.millis);
}), va = (e, t) => _a(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t
}), ya = /*#__PURE__*/ b(2, (e, t) => _a(e, t, {
	onMillis: (e, t) => e <= t,
	onNanos: (e, t) => e <= t
})), ba = /*#__PURE__*/ b(2, (e, t) => _a(e, t, {
	onMillis: (e, t) => e >= t,
	onNanos: (e, t) => e >= t
})), xa = /*#__PURE__*/ b(2, (e, t) => va(Xi(e), Xi(t))), Sa = (e) => {
	let t = Xi(e);
	if (t.value._tag === "Infinity") return {
		days: Infinity,
		hours: Infinity,
		minutes: Infinity,
		seconds: Infinity,
		millis: Infinity,
		nanos: Infinity
	};
	let n = ma(t), r = n / qi, i = r / Ki, a = i / Gi, o = a / Gi, s = o / Wi;
	return {
		days: Number(s),
		hours: Number(o % Wi),
		minutes: Number(a % Gi),
		seconds: Number(i % Gi),
		millis: Number(r % Ki),
		nanos: Number(n % qi)
	};
}, Ca = (e) => {
	let t = Xi(e);
	if (t.value._tag === "Infinity") return "Infinity";
	if (na(t)) return "0";
	let n = Sa(t), r = [];
	return n.days !== 0 && r.push(`${n.days}d`), n.hours !== 0 && r.push(`${n.hours}h`), n.minutes !== 0 && r.push(`${n.minutes}m`), n.seconds !== 0 && r.push(`${n.seconds}s`), n.millis !== 0 && r.push(`${n.millis}ms`), n.nanos !== 0 && r.push(`${n.nanos}ns`), r.join(" ");
}, wa = 32, Ta = wa - 1, Ea = wa / 2, Da = wa / 4;
// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function Oa(e) {
	return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), e = e + (e >> 4) & 252645135, e += e >> 8, e += e >> 16, e & 127;
}
function ka(e, t) {
	return t >>> e & Ta;
}
function Aa(e) {
	return 1 << e;
}
function ja(e, t) {
	return Oa(e & t - 1);
}
// node_modules/effect/dist/esm/internal/stack.js
var Ma = (e, t) => ({
	value: e,
	previous: t
});
// node_modules/effect/dist/esm/internal/hashMap/array.js
function Na(e, t, n, r) {
	let i = r;
	if (!e) {
		let e = r.length;
		i = Array(e);
		for (let t = 0; t < e; ++t) i[t] = r[t];
	}
	return i[t] = n, i;
}
function Pa(e, t, n) {
	let r = n.length - 1, i = 0, a = 0, o = n;
	if (e) i = a = t;
	else for (o = Array(r); i < t;) o[a++] = n[i++];
	for (++i; i <= r;) o[a++] = n[i++];
	return e && (o.length = r), o;
}
function Fa(e, t, n, r) {
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
var Ia = class e {
	_tag = "EmptyNode";
	modify(t, n, r, i, a, o) {
		let s = r(L());
		return On(s) ? new e() : (++o.value, new Ba(t, i, a, s));
	}
};
function La(e) {
	return Ve(e, "EmptyNode");
}
function Ra(e) {
	return La(e) || e._tag === "LeafNode" || e._tag === "CollisionNode";
}
function za(e, t) {
	return !La(e) && t === e.edit;
}
var Ba = class e {
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
			return n === this.value ? this : On(n) ? (--o.value, new Ia()) : za(this, t) ? (this.value = n, this) : new e(t, i, a, n);
		}
		let s = r(L());
		return On(s) ? this : (++o.value, qa(t, n, this.hash, this, i, new e(t, i, a, s)));
	}
}, Va = class e {
	edit;
	hash;
	children;
	_tag = "CollisionNode";
	constructor(e, t, n) {
		this.edit = e, this.hash = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		if (i === this.hash) {
			let n = za(this, t), i = this.updateCollisionList(n, t, this.hash, this.children, r, a, o);
			return i === this.children ? this : i.length > 1 ? new e(t, this.hash, i) : i[0];
		}
		let s = r(L());
		return On(s) ? this : (++o.value, qa(t, n, this.hash, this, i, new Ba(t, i, a, s)));
	}
	updateCollisionList(e, t, n, r, i, a, o) {
		let s = r.length;
		for (let c = 0; c < s; ++c) {
			let s = r[c];
			if ("key" in s && M(a, s.key)) {
				let l = s.value, u = i(l);
				return u === l ? r : On(u) ? (--o.value, Pa(e, c, r)) : Na(e, c, new Ba(t, n, a, u), r);
			}
		}
		let c = i(L());
		return On(c) ? r : (++o.value, Na(e, s, new Ba(t, n, a, c), r));
	}
}, Ha = class e {
	edit;
	mask;
	children;
	_tag = "IndexedNode";
	constructor(e, t, n) {
		this.edit = e, this.mask = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.mask, c = this.children, l = ka(n, i), u = Aa(l), d = ja(s, u), f = s & u, p = za(this, t);
		if (!f) {
			let f = new Ia().modify(t, n + 5, r, i, a, o);
			return f ? c.length >= Ea ? Ga(t, l, f, s, c) : new e(t, s | u, Fa(p, d, f, c)) : this;
		}
		let m = c[d], h = m.modify(t, n + 5, r, i, a, o);
		if (m === h) return this;
		let ee = s, te;
		if (La(h)) {
			if (ee &= ~u, !ee) return new Ia();
			if (c.length <= 2 && Ra(c[d ^ 1])) return c[d ^ 1];
			te = Pa(p, d, c);
		} else te = Na(p, d, h, c);
		return p ? (this.mask = ee, this.children = te, this) : new e(t, ee, te);
	}
}, Ua = class e {
	edit;
	size;
	children;
	_tag = "ArrayNode";
	constructor(e, t, n) {
		this.edit = e, this.size = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.size, c = this.children, l = ka(n, i), u = c[l], d = (u || new Ia()).modify(t, n + 5, r, i, a, o);
		if (u === d) return this;
		let f = za(this, t), p;
		if (La(u) && !La(d)) ++s, p = Na(f, l, d, c);
		else if (!La(u) && La(d)) {
			if (--s, s <= Da) return Wa(t, s, l, c);
			p = Na(f, l, new Ia(), c);
		} else p = Na(f, l, d, c);
		return f ? (this.size = s, this.children = p, this) : new e(t, s, p);
	}
};
function Wa(e, t, n, r) {
	let i = Array(t - 1), a = 0, o = 0;
	for (let e = 0, t = r.length; e < t; ++e) if (e !== n) {
		let t = r[e];
		t && !La(t) && (i[a++] = t, o |= 1 << e);
	}
	return new Ha(e, o, i);
}
function Ga(e, t, n, r, i) {
	let a = [], o = r, s = 0;
	for (let e = 0; o; ++e) o & 1 && (a[e] = i[s++]), o >>>= 1;
	return a[t] = n, new Ua(e, s + 1, a);
}
function Ka(e, t, n, r, i, a) {
	if (n === i) return new Va(e, n, [a, r]);
	let o = ka(t, n), s = ka(t, i);
	if (o === s) return (t) => new Ha(e, Aa(o) | Aa(s), [t]);
	{
		let t = o < s ? [r, a] : [a, r];
		return new Ha(e, Aa(o) | Aa(s), t);
	}
}
function qa(e, t, n, r, i, a) {
	let o, s = t;
	for (;;) {
		let t = Ka(e, s, n, r, i, a);
		if (typeof t == "function") o = Ma(t, o), s += 5;
		else {
			let e = t;
			for (; o != null;) e = o.value(e), o = o.previous;
			return e;
		}
	}
}
// node_modules/effect/dist/esm/internal/hashMap.js
var Ja = "effect/HashMap", Ya = /*#__PURE__*/ Symbol.for(Ja), Xa = {
	[Ya]: Ya,
	[Symbol.iterator]() {
		return new Qa(this, (e, t) => [e, t]);
	},
	[E]() {
		let e = D(Ja);
		for (let t of this) e ^= S(D(t[0]), O(D(t[1])));
		return A(this, e);
	},
	[j](e) {
		if (ao(e)) {
			if (e._size !== this._size) return !1;
			for (let t of this) {
				let n = S(e, co(t[0], D(t[0])));
				if (On(n) || !M(t[1], n.value)) return !1;
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
}, Za = (e, t, n, r) => {
	let i = Object.create(Xa);
	return i._editable = e, i._edit = t, i._root = n, i._size = r, i;
}, Qa = class e {
	map;
	f;
	v;
	constructor(e, t) {
		this.map = e, this.f = t, this.v = eo(this.map._root, this.f, void 0);
	}
	next() {
		if (On(this.v)) return {
			done: !0,
			value: void 0
		};
		let e = this.v.value;
		return this.v = $a(e.cont), {
			done: !1,
			value: e.value
		};
	}
	[Symbol.iterator]() {
		return new e(this.map, this.f);
	}
}, $a = (e) => e ? to(e[0], e[1], e[2], e[3], e[4]) : L(), eo = (e, t, n = void 0) => {
	switch (e._tag) {
		case "LeafNode": return kn(e.value) ? R({
			value: t(e.key, e.value.value),
			cont: n
		}) : $a(n);
		case "CollisionNode":
		case "ArrayNode":
		case "IndexedNode": {
			let r = e.children;
			return to(r.length, r, 0, t, n);
		}
		default: return $a(n);
	}
}, to = (e, t, n, r, i) => {
	for (; n < e;) {
		let a = t[n++];
		if (a && !La(a)) return eo(a, r, [
			e,
			t,
			n,
			r,
			i
		]);
	}
	return $a(i);
}, no = /*#__PURE__*/ Za(!1, 0, /*#__PURE__*/ new Ia(), 0), ro = () => no, io = (e) => {
	let t = ho(ro());
	for (let n of e) uo(t, n[0], n[1]);
	return go(t);
}, ao = (e) => w(e, Ya), oo = (e) => e && La(e._root), so = /*#__PURE__*/ b(2, (e, t) => co(e, t, D(t))), co = /*#__PURE__*/ b(3, (e, t, n) => {
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
			let e = Aa(ka(i, n));
			if (r.mask & e) {
				r = r.children[ja(r.mask, e)], i += 5;
				break;
			}
			return L();
		}
		case "ArrayNode":
			if (r = r.children[ka(i, n)], r) {
				i += 5;
				break;
			}
			return L();
		default: return L();
	}
}), lo = /*#__PURE__*/ b(2, (e, t) => kn(co(e, t, D(t)))), uo = /*#__PURE__*/ b(3, (e, t, n) => _o(e, t, () => R(n))), fo = /*#__PURE__*/ b(3, (e, t, n) => e._editable ? (e._root = t, e._size = n, e) : t === e._root ? e : Za(e._editable, e._edit, t, n)), po = (e) => new Qa(e, (e) => e), mo = (e) => e._size, ho = (e) => Za(!0, e._edit + 1, e._root, e._size), go = (e) => (e._editable = !1, e), _o = /*#__PURE__*/ b(3, (e, t, n) => vo(e, t, D(t), n)), vo = /*#__PURE__*/ b(4, (e, t, n, r) => {
	let i = { value: e._size };
	return S(e, fo(e._root.modify(e._editable ? e._edit : NaN, 0, r, n, t, i), i.value));
}), yo = /*#__PURE__*/ b(2, (e, t) => _o(e, t, L)), bo = /*#__PURE__*/ b(2, (e, t) => So(e, ro(), (e, n, r) => uo(e, r, t(n, r)))), xo = /*#__PURE__*/ b(2, (e, t) => So(e, void 0, (e, n, r) => t(n, r))), So = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = e._root;
	if (r._tag === "LeafNode") return kn(r.value) ? n(t, r.value.value, r.key) : t;
	if (r._tag === "EmptyNode") return t;
	let i = [r.children], a;
	for (; a = i.pop();) for (let e = 0, r = a.length; e < r;) {
		let r = a[e++];
		r && !La(r) && (r._tag === "LeafNode" ? kn(r.value) && (t = n(t, r.value.value, r.key)) : i.push(r.children));
	}
	return t;
}), Co = "effect/HashSet", wo = /*#__PURE__*/ Symbol.for(Co), To = {
	[wo]: wo,
	[Symbol.iterator]() {
		return po(this._keyMap);
	},
	[E]() {
		return A(this, O(D(this._keyMap))(D(Co)));
	},
	[j](e) {
		return Do(e) ? mo(this._keyMap) === mo(e._keyMap) && M(this._keyMap, e._keyMap) : !1;
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
}, Eo = (e) => {
	let t = Object.create(To);
	return t._keyMap = e, t;
}, Do = (e) => w(e, wo), Oo = /*#__PURE__*/ Eo(/*#__PURE__*/ ro()), ko = () => Oo, Ao = (e) => {
	let t = Po(ko());
	for (let n of e) Lo(t, n);
	return Fo(t);
}, jo = (...e) => {
	let t = Po(ko());
	for (let n of e) Lo(t, n);
	return Fo(t);
}, Mo = /*#__PURE__*/ b(2, (e, t) => lo(e._keyMap, t)), No = (e) => mo(e._keyMap), Po = (e) => Eo(ho(e._keyMap)), Fo = (e) => (e._keyMap._editable = !1, e), Io = /*#__PURE__*/ b(2, (e, t) => {
	let n = Po(e);
	return t(n), Fo(n);
}), Lo = /*#__PURE__*/ b(2, (e, t) => e._keyMap._editable ? (uo(t, !0)(e._keyMap), e) : Eo(uo(t, !0)(e._keyMap))), Ro = /*#__PURE__*/ b(2, (e, t) => e._keyMap._editable ? (yo(t)(e._keyMap), e) : Eo(yo(t)(e._keyMap))), zo = /*#__PURE__*/ b(2, (e, t) => Io(e, (e) => {
	for (let n of t) Ro(e, n);
})), Bo = /*#__PURE__*/ b(2, (e, t) => Io(ko(), (n) => {
	Vo(e, (e) => Lo(n, e));
	for (let e of t) Lo(n, e);
})), Vo = /*#__PURE__*/ b(2, (e, t) => xo(e._keyMap, (e, n) => t(n))), Ho = /*#__PURE__*/ b(3, (e, t, n) => So(e._keyMap, t, (e, t, r) => n(e, r))), Uo = ko, Wo = Ao, Go = jo, Ko = Mo, qo = No, Jo = Lo, Yo = Ro, Xo = zo, Zo = Bo, Qo = Ho, $o = /*#__PURE__*/ Symbol.for("effect/MutableRef"), es = {
	[$o]: $o,
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
}, ts = (e) => {
	let t = Object.create(es);
	return t.current = e, t;
}, ns = (e) => e.current, rs = /*#__PURE__*/ b(2, (e, t) => (e.current = t, e)), is = "effect/FiberId", as = /*#__PURE__*/ Symbol.for(is), os = "None", ss = "Runtime", cs = "Composite", ls = /*#__PURE__*/ k(`${is}-${os}`), us = class {
	[as] = as;
	_tag = os;
	id = -1;
	startTimeMillis = -1;
	[E]() {
		return ls;
	}
	[j](e) {
		return ps(e) && e._tag === os;
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
}, ds = class {
	id;
	startTimeMillis;
	[as] = as;
	_tag = ss;
	constructor(e, t) {
		this.id = e, this.startTimeMillis = t;
	}
	[E]() {
		return A(this, k(`${is}-${this._tag}-${this.id}-${this.startTimeMillis}`));
	}
	[j](e) {
		return ps(e) && e._tag === ss && this.id === e.id && this.startTimeMillis === e.startTimeMillis;
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
}, fs = /*#__PURE__*/ new us(), ps = (e) => w(e, as), ms = (e) => {
	switch (e._tag) {
		case os: return Uo();
		case ss: return Go(e.id);
		case cs: return S(ms(e.left), Zo(ms(e.right)));
	}
}, hs = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => ts(0)), gs = (e) => Array.from(ms(e)).map((e) => `#${e}`).join(","), _s = () => {
	let e = ns(hs);
	return S(hs, rs(e + 1)), new ds(e, Date.now());
}, vs = fs, ys = ms, bs = gs, xs = _s, Ss = ro, Cs = io, ws = oo, Ts = so, Es = uo, Ds = po, Os = _o, ks = bo, As = So, js = /*#__PURE__*/ Symbol.for("effect/List"), Ms = (e) => z(e), Ns = /*#__PURE__*/ ((e) => je(Sr(e), Ms))(M), Ps = {
	[js]: js,
	_tag: "Cons",
	toString() {
		return F(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Cons",
			values: Ms(this).map(P)
		};
	},
	[N]() {
		return this.toJSON();
	},
	[j](e) {
		return Rs(e) && this._tag === e._tag && Ns(this, e);
	},
	[E]() {
		return A(this, mt(Ms(this)));
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
}, Fs = (e, t) => {
	let n = Object.create(Ps);
	return n.head = e, n.tail = t, n;
}, Is = /*#__PURE__*/ k("Nil"), Ls = /*#__PURE__*/ Object.create({
	[js]: js,
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
		return Is;
	},
	[j](e) {
		return Rs(e) && this._tag === e._tag;
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
}), Rs = (e) => w(e, js), zs = (e) => e._tag === "Nil", Bs = (e) => e._tag === "Cons", Vs = () => Ls, Hs = (e, t) => Fs(e, t), Us = Vs, Ws = (e) => Fs(e, Ls), Gs = /*#__PURE__*/ b(2, (e, t) => qs(t, e)), Ks = /*#__PURE__*/ b(2, (e, t) => Hs(t, e)), qs = /*#__PURE__*/ b(2, (e, t) => {
	if (zs(e)) return t;
	if (zs(t)) return e;
	{
		let n = Fs(t.head, e), r = n, i = t.tail;
		for (; !zs(i);) {
			let t = Fs(i.head, e);
			r.tail = t, r = t, i = i.tail;
		}
		return n;
	}
}), Js = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = t, i = e;
	for (; !zs(i);) r = n(r, i.head), i = i.tail;
	return r;
}), Ys = (e) => {
	let t = Us(), n = e;
	for (; !zs(n);) t = Ks(t, n.head), n = n.tail;
	return t;
};
Array.prototype;
var Xs = /*#__PURE__*/ function() {
	function e(e) {
		e && Object.assign(this, e);
	}
	return e.prototype = Yt, e;
}(), Zs = /*#__PURE__*/ Symbol.for("effect/DifferContextPatch");
function Qs(e) {
	return e;
}
var $s = {
	...Xs.prototype,
	[Zs]: {
		_Value: Qs,
		_Patch: Qs
	}
}, ec = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create($s), { _tag: "Empty" })), tc = () => ec, nc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create($s), { _tag: "AndThen" }), rc = (e, t) => {
	let n = Object.create(nc);
	return n.first = e, n.second = t, n;
}, ic = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create($s), { _tag: "AddService" }), ac = (e, t) => {
	let n = Object.create(ic);
	return n.key = e, n.service = t, n;
}, oc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create($s), { _tag: "RemoveService" }), sc = (e) => {
	let t = Object.create(oc);
	return t.key = e, t;
}, cc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create($s), { _tag: "UpdateService" }), lc = (e, t) => {
	let n = Object.create(cc);
	return n.key = e, n.update = t, n;
}, uc = (e, t) => {
	let n = new Map(e.unsafeMap), r = tc();
	for (let [e, i] of t.unsafeMap.entries()) if (n.has(e)) {
		let t = n.get(e);
		n.delete(e), M(t, i) || (r = dc(lc(e, () => i))(r));
	} else n.delete(e), r = dc(ac(e, i))(r);
	for (let [e] of n.entries()) r = dc(sc(e))(r);
	return r;
}, dc = /*#__PURE__*/ b(2, (e, t) => rc(e, t)), fc = /*#__PURE__*/ b(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = !1, r = Ci(e), i = new Map(t.unsafeMap);
	for (; Li(r);) {
		let e = Bi(r), t = Vi(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AddService":
				i.set(e.key, e.service), r = t;
				break;
			case "AndThen":
				r = Ni(Ni(t, e.second), e.first);
				break;
			case "RemoveService":
				i.delete(e.key), r = t;
				break;
			case "UpdateService": i.set(e.key, e.update(i.get(e.key))), n = !0, r = t;
		}
	}
	if (!n) return Rr(i);
	let a = /* @__PURE__ */ new Map();
	for (let [e] of t.unsafeMap) i.has(e) && (a.set(e, i.get(e)), i.delete(e));
	for (let [e, t] of i) a.set(e, t);
	return Rr(a);
}), pc = /*#__PURE__*/ Symbol.for("effect/DifferHashSetPatch");
function mc(e) {
	return e;
}
var hc = {
	...Xs.prototype,
	[pc]: {
		_Value: mc,
		_Key: mc,
		_Patch: mc
	}
}, gc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(hc), { _tag: "Empty" })), _c = () => gc, vc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(hc), { _tag: "AndThen" }), yc = (e, t) => {
	let n = Object.create(vc);
	return n.first = e, n.second = t, n;
}, bc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(hc), { _tag: "Add" }), xc = (e) => {
	let t = Object.create(bc);
	return t.value = e, t;
}, Sc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(hc), { _tag: "Remove" }), Cc = (e) => {
	let t = Object.create(Sc);
	return t.value = e, t;
}, wc = (e, t) => {
	let [n, r] = Qo([e, _c()], ([e, t], n) => Ko(n)(e) ? [Yo(n)(e), t] : [e, Tc(xc(n))(t)])(t);
	return Qo(r, (e, t) => Tc(Cc(t))(e))(n);
}, Tc = /*#__PURE__*/ b(2, (e, t) => yc(e, t)), Ec = /*#__PURE__*/ b(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = t, r = Ci(e);
	for (; Li(r);) {
		let e = Bi(r), t = Vi(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AndThen":
				r = Ni(e.first)(Ni(e.second)(t));
				break;
			case "Add":
				n = Jo(e.value)(n), r = t;
				break;
			case "Remove": n = Yo(e.value)(n), r = t;
		}
	}
	return n;
}), Dc = /*#__PURE__*/ Symbol.for("effect/DifferReadonlyArrayPatch");
function Oc(e) {
	return e;
}
var kc = {
	...Xs.prototype,
	[Dc]: {
		_Value: Oc,
		_Patch: Oc
	}
}, Ac = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(kc), { _tag: "Empty" })), jc = () => Ac, Mc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(kc), { _tag: "AndThen" }), Nc = (e, t) => {
	let n = Object.create(Mc);
	return n.first = e, n.second = t, n;
}, Pc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(kc), { _tag: "Append" }), Fc = (e) => {
	let t = Object.create(Pc);
	return t.values = e, t;
}, Ic = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(kc), { _tag: "Slice" }), Lc = (e, t) => {
	let n = Object.create(Ic);
	return n.from = e, n.until = t, n;
}, Rc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(kc), { _tag: "Update" }), zc = (e, t) => {
	let n = Object.create(Rc);
	return n.index = e, n.patch = t, n;
}, Bc = (e) => {
	let t = 0, n = jc();
	for (; t < e.oldValue.length && t < e.newValue.length;) {
		let r = e.oldValue[t], i = e.newValue[t], a = e.differ.diff(r, i);
		M(a, e.differ.empty) || (n = Vc(n, zc(t, a))), t += 1;
	}
	return t < e.oldValue.length && (n = Vc(n, Lc(0, t))), t < e.newValue.length && (n = Vc(n, Fc(ar(t)(e.newValue)))), n;
}, Vc = /*#__PURE__*/ b(2, (e, t) => Nc(e, t)), Hc = /*#__PURE__*/ b(3, (e, t, n) => {
	if (e._tag === "Empty") return t;
	let r = t.slice(), i = _r(e);
	for (; Kn(i);) {
		let e = $n(i), t = nr(i);
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
}), Uc = {
	[/* @__PURE__ */ Symbol.for("effect/Differ")]: {
		_P: x,
		_V: x
	},
	pipe() {
		return I(this, arguments);
	}
}, Wc = (e) => {
	let t = Object.create(Uc);
	return t.empty = e.empty, t.diff = e.diff, t.combine = e.combine, t.patch = e.patch, t;
}, Gc = () => Wc({
	empty: tc(),
	combine: (e, t) => dc(t)(e),
	diff: (e, t) => uc(e, t),
	patch: (e, t) => fc(t)(e)
}), Kc = () => Wc({
	empty: _c(),
	combine: (e, t) => Tc(t)(e),
	diff: (e, t) => wc(e, t),
	patch: (e, t) => Ec(t)(e)
}), qc = (e) => Wc({
	empty: jc(),
	combine: (e, t) => Vc(e, t),
	diff: (t, n) => Bc({
		oldValue: t,
		newValue: n,
		differ: e
	}),
	patch: (t, n) => Hc(t, n, e)
}), Jc = () => Yc((e, t) => t), Yc = (e) => Wc({
	empty: x,
	combine: (e, t) => e === x ? t : t === x ? e : (n) => t(e(n)),
	diff: (e, t) => M(e, t) ? x : Te(t),
	patch: (t, n) => e(n, t(n))
}), Xc = 255, Zc = 8, Qc = (e) => e & Xc, $c = (e) => e >> Zc & Xc, el = (e, t) => (e & Xc) + ((t & e & Xc) << Zc), tl = /*#__PURE__*/ el(0, 0), nl = (e) => el(e, e), rl = (e) => el(e, 0), il = /*#__PURE__*/ b(2, (e, t) => el(Qc(e) & ~t, $c(e))), al = /*#__PURE__*/ b(2, (e, t) => e | t), ol = (e) => ~e >>> 0 & Xc, sl = (e) => fl(e, 32), cl = /*#__PURE__*/ b(2, (e, t) => e & ~t), ll = /*#__PURE__*/ b(2, (e, t) => e | t), ul = (e) => dl(e) && !gl(e), dl = (e) => fl(e, 1), fl = /*#__PURE__*/ b(2, (e, t) => (e & t) !== 0), pl = (...e) => e.reduce((e, t) => e | t, 0), ml = /*#__PURE__*/ pl(0), hl = (e) => fl(e, 4), gl = (e) => fl(e, 16), _l = /*#__PURE__*/ b(2, (e, t) => el(e ^ t, t)), vl = /*#__PURE__*/ b(2, (e, t) => e & (ol(Qc(t)) | $c(t)) | Qc(t) & $c(t)), yl = /*#__PURE__*/ Wc({
	empty: tl,
	diff: (e, t) => _l(e, t),
	combine: (e, t) => al(t)(e),
	patch: (e, t) => vl(t, e)
}), bl = nl, xl = rl, Sl = il, Cl = (e, t) => ({
	_tag: "Par",
	left: e,
	right: t
}), wl = (e, t) => ({
	_tag: "Seq",
	left: e,
	right: t
}), Tl = (e) => {
	let t = Ws(e), n = Us();
	for (;;) {
		let [e, r] = Js(t, [jl(), Us()], ([e, t], n) => {
			let [r, i] = El(n);
			return [Nl(e, r), Gs(t, i)];
		});
		if (n = Dl(n, e), zs(r)) return Ys(n);
		t = r;
	}
	throw Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, El = (e) => {
	let t = e, n = jl(), r = Us(), i = Us();
	for (;;) switch (t._tag) {
		case "Empty":
			if (zs(r)) return [n, i];
			t = r.head, r = r.tail;
			break;
		case "Par":
			r = Hs(t.right, r), t = t.left;
			break;
		case "Seq": {
			let e = t.left, n = t.right;
			switch (e._tag) {
				case "Empty":
					t = n;
					break;
				case "Par": {
					let r = e.left, i = e.right;
					t = Cl(wl(r, n), wl(i, n));
					break;
				}
				case "Seq": {
					let r = e.left, i = e.right;
					t = wl(r, wl(i, n));
					break;
				}
				case "Single": t = e, i = Hs(n, i);
			}
			break;
		}
		case "Single":
			if (n = Ml(n, t), zs(r)) return [n, i];
			t = r.head, r = r.tail;
	}
	throw Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, Dl = (e, t) => {
	if (zs(e)) return Ws(Il(t));
	if (Pl(t)) return e;
	let n = Hl(e.head), r = Fl(t);
	return n.length === 1 && r.length === 1 && M(n[0], r[0]) ? Hs(Vl(e.head, Il(t)), e.tail) : Hs(Il(t), e);
}, Ol = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockParallel"), kl = {
/* c8 ignore next */
_R: (e) => e }, Al = class {
	map;
	[Ol] = kl;
	constructor(e) {
		this.map = e;
	}
}, jl = () => new Al(Ss()), Ml = (e, t) => new Al(Os(e.map, t.dataSource, (e) => Mn(Fn(e, Mi(t.blockedRequest)), () => Ci(t.blockedRequest)))), Nl = (e, t) => new Al(As(e.map, t.map, (e, t, n) => Es(e, n, An(Ts(e, n), {
	onNone: () => t,
	onSome: (e) => Fi(t, e)
})))), Pl = (e) => ws(e.map), Fl = (e) => Array.from(Ds(e.map)), Il = (e) => Bl(ks(e.map, (e) => Ci(e))), Ll = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockSequential"), Rl = {
/* c8 ignore next */
_R: (e) => e }, zl = class {
	map;
	[Ll] = Rl;
	constructor(e) {
		this.map = e;
	}
}, Bl = (e) => new zl(e), Vl = (e, t) => new zl(As(t.map, e.map, (e, t, n) => Es(e, n, An(Ts(e, n), {
	onNone: () => xi(),
	onSome: (e) => Fi(e, t)
})))), Hl = (e) => Array.from(Ds(e.map)), Ul = (e) => Array.from(e.map), Wl = "Empty", Gl = "Fail", Kl = "Interrupt", ql = "Parallel", Jl = "Sequential", Yl = "effect/Cause", Xl = /*#__PURE__*/ Symbol.for(Yl), Zl = {
/* c8 ignore next */
_E: (e) => e }, Ql = {
	[Xl]: Zl,
	[E]() {
		return S(D(Yl), O(D(yu(this))), A(this));
	},
	[j](e) {
		return au(e) && vu(this, e);
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
		return ku(this);
	},
	[N]() {
		return this.toJSON();
	}
}, $l = /*#__PURE__*/ (() => {
	let e = /*#__PURE__*/ Object.create(Ql);
	return e._tag = Wl, e;
})(), eu = (e) => {
	let t = Object.create(Ql);
	return t._tag = Gl, t.error = e, t;
}, tu = (e) => {
	let t = Object.create(Ql);
	return t._tag = "Die", t.defect = e, t;
}, nu = (e) => {
	let t = Object.create(Ql);
	return t._tag = Kl, t.fiberId = e, t;
}, ru = (e, t) => {
	let n = Object.create(Ql);
	return n._tag = ql, n.left = e, n.right = t, n;
}, iu = (e, t) => {
	let n = Object.create(Ql);
	return n._tag = Jl, n.left = e, n.right = t, n;
}, au = (e) => w(e, Xl), ou = (e) => e._tag === Wl, su = (e) => e._tag === "Empty" || Du(e, !0, (e, t) => {
	switch (t._tag) {
		case Wl: return R(e);
		case "Die":
		case Gl:
		case Kl: return R(!1);
		default: return L();
	}
}), cu = (e) => kn(hu(e)), lu = (e) => Ou(void 0, Cu)(e), uu = (e) => Di(Du(e, xi(), (e, t) => t._tag === "Fail" ? R(S(e, Ni(t.error))) : L())), du = (e) => Di(Du(e, xi(), (e, t) => t._tag === "Die" ? R(S(e, Ni(t.defect))) : L())), fu = (e) => Du(e, Uo(), (e, t) => t._tag === "Interrupt" ? R(S(e, Jo(t.fiberId))) : L()), pu = (e) => xu(e, (e) => e._tag === "Fail" ? R(e.error) : L()), mu = (e) => {
	let t = pu(e);
	switch (t._tag) {
		case "None": return vn(e);
		case "Some": return yn(t.value);
	}
}, hu = (e) => xu(e, (e) => e._tag === "Interrupt" ? R(e.fiberId) : L()), gu = (e) => Eu(e, {
	onEmpty: $l,
	onFail: () => $l,
	onDie: tu,
	onInterrupt: nu,
	onSequential: iu,
	onParallel: ru
}), _u = (e) => Eu(e, {
	onEmpty: $l,
	onFail: tu,
	onDie: tu,
	onInterrupt: nu,
	onSequential: iu,
	onParallel: ru
}), vu = (e, t) => {
	let n = Ci(e), r = Ci(t);
	for (; Li(n) && Li(r);) {
		let [e, t] = S(Bi(n), Du([Uo(), xi()], ([e, t], n) => {
			let [r, i] = Su(n);
			return R([S(e, Zo(r)), S(t, Fi(i))]);
		})), [i, a] = S(Bi(r), Du([Uo(), xi()], ([e, t], n) => {
			let [r, i] = Su(n);
			return R([S(e, Zo(r)), S(t, Fi(i))]);
		}));
		if (!M(e, i)) return !1;
		n = t, r = a;
	}
	return !0;
}, yu = (e) => bu(Ci(e), xi()), bu = (e, t) => {
	for (;;) {
		let [n, r] = S(e, br([Uo(), xi()], ([e, t], n) => {
			let [r, i] = Su(n);
			return [S(e, Zo(r)), S(t, Fi(i))];
		})), i = qo(n) > 0 ? S(t, Ni(n)) : t;
		if (Ii(r)) return Di(i);
		e = r, t = i;
	}
	throw Error(Ge("Cause.flattenCauseLoop"));
}, xu = /*#__PURE__*/ b(2, (e, t) => {
	let n = [e];
	for (; n.length > 0;) {
		let e = n.pop(), r = t(e);
		switch (r._tag) {
			case "None":
				switch (e._tag) {
					case Jl:
					case ql: n.push(e.right), n.push(e.left);
				}
				break;
			case "Some": return r;
		}
	}
	return L();
}), Su = (e) => {
	let t = e, n = [], r = Uo(), i = xi();
	for (; t !== void 0;) switch (t._tag) {
		case Wl:
			if (n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Gl:
			if (r = Jo(r, Si(t._tag, t.error)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case "Die":
			if (r = Jo(r, Si(t._tag, t.defect)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Kl:
			if (r = Jo(r, Si(t._tag, t.fiberId)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Jl:
			switch (t.left._tag) {
				case Wl:
					t = t.right;
					break;
				case Jl:
					t = iu(t.left.left, iu(t.left.right, t.right));
					break;
				case ql:
					t = ru(iu(t.left.left, t.right), iu(t.left.right, t.right));
					break;
				default: i = Ni(i, t.right), t = t.left;
			}
			break;
		case ql: n.push(t.right), t = t.left;
	}
	throw Error(Ge("Cause.evaluateCauseLoop"));
}, Cu = {
	emptyCase: Ee,
	failCase: De,
	dieCase: De,
	interruptCase: Ee,
	sequentialCase: (e, t, n) => t && n,
	parallelCase: (e, t, n) => t && n
}, wu = "SequentialCase", Tu = "ParallelCase", Eu = /*#__PURE__*/ b(2, (e, { onDie: t, onEmpty: n, onFail: r, onInterrupt: i, onParallel: a, onSequential: o }) => Ou(e, void 0, {
	emptyCase: () => n,
	failCase: (e, t) => r(t),
	dieCase: (e, n) => t(n),
	interruptCase: (e, t) => i(t),
	sequentialCase: (e, t, n) => o(t, n),
	parallelCase: (e, t, n) => a(t, n)
})), Du = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = t, i = e, a = [];
	for (; i !== void 0;) {
		let e = n(r, i);
		switch (r = kn(e) ? e.value : r, i._tag) {
			case Jl:
				a.push(i.right), i = i.left;
				break;
			case ql:
				a.push(i.right), i = i.left;
				break;
			default: i = void 0;
		}
		i === void 0 && a.length > 0 && (i = a.pop());
	}
	return r;
}), Ou = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._tag) {
			case Wl:
				i.push(vn(n.emptyCase(t)));
				break;
			case Gl:
				i.push(vn(n.failCase(t, e.error)));
				break;
			case "Die":
				i.push(vn(n.dieCase(t, e.defect)));
				break;
			case Kl:
				i.push(vn(n.interruptCase(t, e.fiberId)));
				break;
			case Jl:
				r.push(e.right), r.push(e.left), i.push(yn({ _tag: wu }));
				break;
			case ql: r.push(e.right), r.push(e.left), i.push(yn({ _tag: Tu }));
		}
	}
	let a = [];
	for (; i.length > 0;) {
		let e = i.pop();
		switch (e._tag) {
			case "Left":
				switch (e.left._tag) {
					case wu: {
						let e = a.pop(), r = a.pop(), i = n.sequentialCase(t, e, r);
						a.push(i);
						break;
					}
					case Tu: {
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
}), ku = (e, t) => lu(e) ? "All fibers interrupted without errors." : Lu(e).map(function(e) {
	return t?.renderErrorCause !== !0 || e.cause === void 0 ? e.stack : `${e.stack} {\n${Au(e.cause, "  ")}\n}`;
}).join("\n"), Au = (e, t) => {
	let n = e.stack.split("\n"), r = `${t}[cause]: ${n[0]}`;
	for (let e = 1, i = n.length; e < i; e++) r += `\n${t}${n[e]}`;
	return e.cause && (r += ` {\n${Au(e.cause, `${t}  `)}\n${t}}`), r;
}, ju = (e) => {
	let t = typeof e == "object" && !!e, n = Error.stackTraceLimit;
	Error.stackTraceLimit = 1;
	let r = Error(Mu(e), t && "cause" in e && e.cause !== void 0 ? { cause: ju(e.cause) } : void 0);
	return Error.stackTraceLimit = n, r.message === "" && (r.message = "An error has occurred"), Error.stackTraceLimit = n, r.name = e instanceof Error ? e.name : "Error", t && (Iu in e && (r.span = e[Iu]), Object.keys(e).forEach((t) => {
		t in r || (r[t] = e[t]);
	})), r.stack = Fu(`${r.name}: ${r.message}`, e instanceof Error && e.stack ? e.stack : "", r.span), r;
}, Mu = (e) => {
	if (typeof e == "string") return e;
	if (typeof e == "object" && e && e instanceof Error) return e.message;
	try {
		if (w(e, "toString") && Re(e.toString) && e.toString !== Object.prototype.toString && e.toString !== globalThis.Array.prototype.toString) return e.toString();
	} catch {}
	return yt(e);
}, Nu = /\((.*)\)/g, Pu = /*#__PURE__*/ C("effect/Tracer/spanToTrace", () => /* @__PURE__ */ new WeakMap()), Fu = (e, t, n) => {
	let r = [e], i = t.startsWith(e) ? t.slice(e.length).split("\n") : t.split("\n");
	for (let e = 1; e < i.length; e++) if (i[e].includes(" at new BaseEffectError") || i[e].includes(" at new YieldableError")) e++;
	else {
		if (i[e].includes("Generator.next") || i[e].includes("effect_internal_function")) break;
		r.push(i[e].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
	}
	if (n) {
		let e = n, t = 0;
		for (; e && e._tag === "Span" && t < 10;) {
			let n = Pu.get(e);
			if (typeof n == "function") {
				let t = n();
				if (typeof t == "string") {
					let n = t.matchAll(Nu), i = !1;
					for (let [, t] of n) i = !0, r.push(`    at ${e.name} (${t})`);
					i || r.push(`    at ${e.name} (${t.replace(/^at /, "")})`);
				} else r.push(`    at ${e.name}`);
			} else r.push(`    at ${e.name}`);
			e = Pn(e.parent), t++;
		}
	}
	return r.join("\n");
}, Iu = /*#__PURE__*/ Symbol.for("effect/SpanAnnotation"), Lu = (e) => Ou(e, void 0, {
	emptyCase: () => [],
	dieCase: (e, t) => [ju(t)],
	failCase: (e, t) => [ju(t)],
	interruptCase: () => [],
	parallelCase: (e, t, n) => [...t, ...n],
	sequentialCase: (e, t, n) => [...t, ...n]
}), Ru = "Pending", zu = "Done", Bu = /*#__PURE__*/ Symbol.for("effect/Deferred"), Vu = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Hu = (e) => ({
	_tag: Ru,
	joiners: e
}), Uu = (e) => ({
	_tag: zu,
	effect: e
}), Wu = class e {
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
}, Gu = (e, t) => {
	let n = new V("Blocked");
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}, Ku = (e) => {
	let t = new V("RunBlocked");
	return t.effect_instruction_i0 = e, t;
}, qu = /*#__PURE__*/ Symbol.for("effect/Effect"), Ju = class {
	patch;
	op;
	_op = Rt;
	constructor(e, t) {
		this.patch = e, this.op = t;
	}
}, V = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[qu] = Gt;
	constructor(e) {
		this._op = e;
	}
	[j](e) {
		return this === e;
	}
	[E]() {
		return A(this, ct(this));
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
		return new Wu(new rt(this));
	}
}, Yu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[qu] = Gt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[j](e) {
		return Jf(e) && e._op === "Failure" && M(this.effect_instruction_i0, e.effect_instruction_i0);
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
		return new Wu(new rt(this));
	}
}, Xu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[qu] = Gt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[j](e) {
		return Jf(e) && e._op === "Success" && M(this.effect_instruction_i0, e.effect_instruction_i0);
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
		return new Wu(new rt(this));
	}
}, Zu = (e) => w(e, qu), H = (e) => {
	let t = new V(It);
	return t.effect_instruction_i0 = e, t;
}, Qu = /*#__PURE__*/ b(3, (e, t, n) => jd((r) => G(e, (e) => G(dd(J(() => r(t(e)))), (t) => J(() => n(e, t)).pipe(yd({
	onFailure: (e) => {
		switch (t._tag) {
			case Dt: return W(iu(t.effect_instruction_i0, e));
			case jt: return W(e);
		}
	},
	onSuccess: () => t
})))))), $u = /*#__PURE__*/ b(2, (e, t) => G(e, () => q(t))), ed = (e) => $u(e, void 0), td = function() {
	let e = new V(Et);
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
		default: throw Error(Ge("you're not supposed to end up here"));
	}
	return e;
}, nd = (e, t = vs) => {
	let n = new V(Tt), r;
	return n.effect_instruction_i0 = (t) => {
		r = e(t);
	}, n.effect_instruction_i1 = t, Dd(n, (e) => Zu(r) ? r : X);
}, rd = (e, t = vs) => J(() => nd(e, t)), id = (e, t = vs) => td(e, function() {
	let e, n;
	function r(t) {
		e ? e(t) : n === void 0 && (n = t);
	}
	let i = new V(Tt);
	i.effect_instruction_i0 = (t) => {
		e = t, n && t(n);
	}, i.effect_instruction_i1 = t;
	let a, o;
	return this.effect_instruction_i0.length === 1 ? a = T(() => this.effect_instruction_i0(r)) : (o = new AbortController(), a = T(() => this.effect_instruction_i0(r, o.signal))), a || o ? Dd(i, (e) => (o && o.abort(), a ?? X)) : i;
}), ad = /*#__PURE__*/ b(2, (e, t) => bd(e, {
	onFailure: t,
	onSuccess: q
})), od = /*#__PURE__*/ Symbol.for("effect/OriginalAnnotation"), sd = (e, t) => kn(t) ? new Proxy(e, {
	has(e, t) {
		return t === Iu || t === od || t in e;
	},
	get(n, r) {
		return r === Iu ? t.value : r === od ? e : n[r];
	}
}) : e, cd = (e) => Be(e) && !(Iu in e) ? H((t) => W(tu(sd(e, wp(t))))) : W(tu(e)), ld = (e) => pd(() => tu(new Bf(e))), ud = (e) => bd(e, {
	onFailure: (e) => q(yn(e)),
	onSuccess: (e) => q(vn(e))
}), dd = (e) => vd(e, {
	onFailure: Z,
	onSuccess: Q
}), U = (e) => Be(e) && !(Iu in e) ? H((t) => W(eu(sd(e, wp(t))))) : W(eu(e)), fd = (e) => G(Y(e), U), W = (e) => {
	let t = new Yu(Dt);
	return t.effect_instruction_i0 = e, t;
}, pd = (e) => G(Y(e), W), md = /*#__PURE__*/ H((e) => q(e.id())), hd = (e) => H((t) => e(t.id())), G = /*#__PURE__*/ b(2, (e, t) => {
	let n = new V(kt);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}), gd = (e) => {
	let t = new V("OnStep");
	return t.effect_instruction_i0 = e, t;
}, _d = (e) => G(e, x), vd = /*#__PURE__*/ b(2, (e, t) => yd(e, {
	onFailure: (e) => q(t.onFailure(e)),
	onSuccess: (e) => q(t.onSuccess(e))
})), yd = /*#__PURE__*/ b(2, (e, t) => {
	let n = new V(At);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t.onFailure, n.effect_instruction_i2 = t.onSuccess, n;
}), bd = /*#__PURE__*/ b(2, (e, t) => yd(e, {
	onFailure: (e) => {
		if (du(e).length > 0) return W(_u(e));
		let n = uu(e);
		return n.length > 0 ? t.onFailure(zi(n)) : W(e);
	},
	onSuccess: t.onSuccess
})), xd = /*#__PURE__*/ b(2, (e, t) => J(() => {
	let n = z(e), r = zn(n.length), i = 0;
	return $u(Pd({
		while: () => i < n.length,
		body: () => t(n[i], i),
		step: (e) => {
			r[i++] = e;
		}
	}), r);
})), Sd = /*#__PURE__*/ b(2, (e, t) => J(() => {
	let n = z(e), r = 0;
	return Pd({
		while: () => r < n.length,
		body: () => t(n[r], r),
		step: () => {
			r++;
		}
	});
})), Cd = (e) => {
	let t = new V(Nt);
	return t.effect_instruction_i0 = bl(1), t.effect_instruction_i1 = () => e, t;
}, K = /*#__PURE__*/ b(2, (e, t) => G(e, (e) => Y(() => t(e)))), wd = /*#__PURE__*/ b(2, (e, t) => bd(e, {
	onFailure: (e) => fd(() => t.onFailure(e)),
	onSuccess: (e) => Y(() => t.onSuccess(e))
})), Td = /*#__PURE__*/ b(2, (e, t) => yd(e, {
	onFailure: (e) => {
		let n = mu(e);
		switch (n._tag) {
			case "Left": return fd(() => t(n.left));
			case "Right": return W(n.right);
		}
	},
	onSuccess: q
})), Ed = /*#__PURE__*/ b(2, (e, t) => jd((n) => yd(n(e), {
	onFailure: (e) => {
		let n = Z(e);
		return yd(t(n), {
			onFailure: (t) => Z(iu(e, t)),
			onSuccess: () => n
		});
	},
	onSuccess: (e) => {
		let n = Q(e);
		return Hd(t(n), n);
	}
}))), Dd = /*#__PURE__*/ b(2, (e, t) => Ed(e, ip({
	onFailure: (e) => lu(e) ? ed(t(fu(e))) : X,
	onSuccess: () => X
}))), q = (e) => {
	let t = new Xu(jt);
	return t.effect_instruction_i0 = e, t;
}, J = (e) => {
	let t = new V(Et);
	return t.commit = e, t;
}, Y = (e) => {
	let t = new V(Mt);
	return t.effect_instruction_i0 = e, t;
}, Od = /*#__PURE__*/ b((e) => e.length === 3 || e.length === 2 && !(Be(e[1]) && "onlyEffect" in e[1]), (e, t) => G(e, (e) => {
	let n = typeof t == "function" ? t(e) : t;
	return Zu(n) ? $u(n, e) : We(n) ? nd((t) => {
		n.then((n) => t(q(e)), (e) => t(U(new qf(e, "An unknown error occurred in Effect.tap"))));
	}) : q(e);
})), kd = (e) => H((t) => e(sf(Df, R(S(t.getFiberRef(Df), jn(() => t.scope())))))), Ad = (e) => {
	let t = new V(Nt);
	return t.effect_instruction_i0 = xl(1), t.effect_instruction_i1 = () => e, t;
}, jd = (e) => td(e, function() {
	let e = new V(Nt);
	return e.effect_instruction_i0 = xl(1), e.effect_instruction_i1 = (e) => dl(e) ? T(() => this.effect_instruction_i0(Cd)) : T(() => this.effect_instruction_i0(Ad)), e;
}), X = /*#__PURE__*/ q(void 0), Md = (e) => {
	let t = new V(Nt);
	return t.effect_instruction_i0 = e, t.effect_instruction_i1 = void 0, t;
}, Nd = /*#__PURE__*/ b(2, (e, t) => G(t, (t) => t ? S(e, K(R)) : q(L()))), Pd = (e) => {
	let t = new V(Pt);
	return t.effect_instruction_i0 = e.while, t.effect_instruction_i1 = e.body, t.effect_instruction_i2 = e.step, t;
}, Fd = (e) => J(() => {
	let t = new V(Ft);
	return t.effect_instruction_i0 = e(), t;
}), Id = function() {
	let e = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
	return Fd(() => e(S));
}, Ld = (e, ...t) => Object.defineProperty(t.length === 0 ? function(...t) {
	return Fd(() => e.apply(this, t));
} : function(...n) {
	let r = Fd(() => e.apply(this, n));
	for (let e of t) r = e(r, ...n);
	return r;
}, "length", {
	value: e.length,
	configurable: !0
}), Rd = /*#__PURE__*/ b(2, (e, t) => {
	let n = new V(Nt);
	return n.effect_instruction_i0 = t, n.effect_instruction_i1 = () => e, n;
}), zd = (e) => {
	let t = new V(Lt);
	return e?.priority === void 0 ? t : xf(t, e.priority);
}, Bd = /*#__PURE__*/ b(2, (e, t) => G(e, (e) => K(t, (t) => [e, t]))), Vd = /*#__PURE__*/ b(2, (e, t) => G(e, (e) => $u(t, e))), Hd = /*#__PURE__*/ b(2, (e, t) => G(e, () => t)), Ud = /*#__PURE__*/ b(3, (e, t, n) => G(e, (e) => K(t, (t) => n(e, t)))), Wd = (e) => G(md, (t) => S(e, Gd(t))), Gd = /*#__PURE__*/ b(2, (e, t) => G(e.interruptAsFork(t), () => e.await)), Kd = {
	_tag: "All",
	syslog: 0,
	label: "ALL",
	ordinal: -(2 ** 53 - 1),
	pipe() {
		return I(this, arguments);
	}
}, qd = {
	_tag: "Fatal",
	syslog: 2,
	label: "FATAL",
	ordinal: 5e4,
	pipe() {
		return I(this, arguments);
	}
}, Jd = {
	_tag: "Error",
	syslog: 3,
	label: "ERROR",
	ordinal: 4e4,
	pipe() {
		return I(this, arguments);
	}
}, Yd = {
	_tag: "Warning",
	syslog: 4,
	label: "WARN",
	ordinal: 3e4,
	pipe() {
		return I(this, arguments);
	}
}, Xd = {
	_tag: "Info",
	syslog: 6,
	label: "INFO",
	ordinal: 2e4,
	pipe() {
		return I(this, arguments);
	}
}, Zd = {
	_tag: "Debug",
	syslog: 7,
	label: "DEBUG",
	ordinal: 1e4,
	pipe() {
		return I(this, arguments);
	}
}, Qd = {
	_tag: "Trace",
	syslog: 7,
	label: "TRACE",
	ordinal: 0,
	pipe() {
		return I(this, arguments);
	}
}, $d = {
	_tag: "None",
	syslog: 7,
	label: "OFF",
	ordinal: 2 ** 53 - 1,
	pipe() {
		return I(this, arguments);
	}
}, ef = /*#__PURE__*/ Symbol.for("effect/FiberRef"), tf = {
/* c8 ignore next */
_A: (e) => e }, nf = (e) => H((t) => Q(t.getFiberRef(e))), rf = /*#__PURE__*/ b(2, (e, t) => G(nf(e), t)), af = /*#__PURE__*/ b(2, (e, t) => of(e, () => [void 0, t])), of = /*#__PURE__*/ b(2, (e, t) => H((n) => {
	let [r, i] = t(n.getFiberRef(e));
	return n.setFiberRef(e, i), q(r);
})), sf = /*#__PURE__*/ b(3, (e, t, n) => Qu(Vd(nf(t), af(t, n)), () => e, (e) => af(t, e))), cf = /*#__PURE__*/ b(3, (e, t, n) => rf(t, (r) => sf(e, t, n(r)))), lf = (e, t) => pf(e, {
	differ: Jc(),
	fork: t?.fork ?? x,
	join: t?.join
}), uf = (e) => {
	let t = Kc();
	return pf(e, {
		differ: t,
		fork: t.empty
	});
}, df = (e) => {
	let t = qc(Jc());
	return pf(e, {
		differ: t,
		fork: t.empty
	});
}, ff = (e) => {
	let t = Gc();
	return pf(e, {
		differ: t,
		fork: t.empty
	});
}, pf = (e, t) => ({
	...Xt,
	[ef]: tf,
	initial: e,
	commit() {
		return nf(this);
	},
	diff: (e, n) => t.differ.diff(e, n),
	combine: (e, n) => t.differ.combine(e, n),
	patch: (e) => (n) => t.differ.patch(e, n),
	fork: t.fork,
	join: t.join ?? ((e, t) => t)
}), mf = (e) => pf(e, {
	differ: yl,
	fork: yl.empty
}), hf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentContext"), () => ff(ii())), gf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => lf(0)), _f = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => lf(2048)), vf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => lf(Ss())), yf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogLevel"), () => lf(Xd)), bf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogSpan"), () => lf(Us())), xf = /*#__PURE__*/ b(2, (e, t) => sf(e, gf, t)), Sf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentConcurrency"), () => lf("unbounded")), Cf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestBatching"), () => lf(!0)), wf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => lf(R(Zd))), Tf = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => lf(R(Yd))), Ef = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMetricLabels"), () => df(gr())), Df = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => lf(L(), {
	fork: () => L(),
	join: (e, t) => e
})), Of = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => lf($l, {
	fork: () => $l,
	join: (e, t) => e
})), kf = /*#__PURE__*/ Symbol.for("effect/Scope"), Af = /*#__PURE__*/ Symbol.for("effect/CloseableScope"), jf = (e, t) => e.addFinalizer(() => ed(t)), Mf = (e, t) => e.addFinalizer(t), Nf = (e, t) => e.close(t), Pf = (e, t) => e.fork(t), Ff = (e) => If(x)(e), If = /*#__PURE__*/ b(2, (e, t) => {
	let n = S(e, pu, Fn(t));
	switch (n._tag) {
		case "None": return S(du(e), Ri, An({
			onNone: () => {
				let t = z(fu(e)).flatMap((e) => z(ys(e)).map((e) => `#${e}`));
				return new Hf(t ? `Interrupted by fibers: ${t.join(", ")}` : void 0);
			},
			onSome: x
		}));
		case "Some": return n.value;
	}
}), Lf = /*#__PURE__*/ function() {
	class e extends globalThis.Error {
		commit() {
			return U(this);
		}
		toJSON() {
			let e = { ...this };
			return this.message && (e.message = this.message), this.cause && (e.cause = this.cause), e;
		}
		[N]() {
			return this.toString === globalThis.Error.prototype.toString ? "Bun" in globalThis ? ku(eu(this), { renderErrorCause: !0 }) : this : this.stack ? `${this.toString()}\n${this.stack.split("\n").slice(1).join("\n")}` : this.toString();
		}
	}
	return Object.assign(e.prototype, Zt), e;
}(), Rf = (e, t) => {
	class n extends Lf {
		_tag = t;
	}
	return Object.assign(n.prototype, e), n.prototype.name = t, n;
}, zf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/RuntimeException"), Bf = /*#__PURE__*/ Rf({ [zf]: zf }, "RuntimeException"), Vf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/InterruptedException"), Hf = /*#__PURE__*/ Rf({ [Vf]: Vf }, "InterruptedException"), Uf = (e) => w(e, Vf), Wf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/NoSuchElement"), Gf = /*#__PURE__*/ Rf({ [Wf]: Wf }, "NoSuchElementException"), Kf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/UnknownException"), qf = /*#__PURE__*/ function() {
	class e extends Lf {
		_tag = "UnknownException";
		error;
		constructor(e, t) {
			super(t ?? "An unknown error occurred", { cause: e }), this.error = e;
		}
	}
	return Object.assign(e.prototype, {
		[Kf]: Kf,
		name: "UnknownException"
	}), e;
}(), Jf = (e) => Zu(e) && "_tag" in e && (e._tag === "Success" || e._tag === "Failure"), Yf = (e) => e._tag === "Failure", Xf = (e) => e._tag === "Success", Zf = /*#__PURE__*/ b(2, (e, t) => {
	switch (e._tag) {
		case Dt: return Z(e.effect_instruction_i0);
		case jt: return Q(t);
	}
}), Qf = (e) => Zf(e, void 0), $f = (e, t) => cp(e, t?.parallel ? ru : iu), ep = (e) => Z(tu(e)), tp = (e) => Z(eu(e)), Z = (e) => {
	let t = new Yu(Dt);
	return t.effect_instruction_i0 = e, t;
}, np = (e) => Z(nu(e)), rp = /*#__PURE__*/ b(2, (e, t) => {
	switch (e._tag) {
		case Dt: return Z(e.effect_instruction_i0);
		case jt: return Q(t(e.effect_instruction_i0));
	}
}), ip = /*#__PURE__*/ b(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case Dt: return t(e.effect_instruction_i0);
		case jt: return n(e.effect_instruction_i0);
	}
}), ap = /*#__PURE__*/ b(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case Dt: return t(e.effect_instruction_i0);
		case jt: return n(e.effect_instruction_i0);
	}
}), Q = (e) => {
	let t = new Xu(jt);
	return t.effect_instruction_i0 = e, t;
}, op = /*#__PURE__*/ Q(void 0), sp = /*#__PURE__*/ b(3, (e, t, { onFailure: n, onSuccess: r }) => {
	switch (e._tag) {
		case Dt: switch (t._tag) {
			case jt: return Z(e.effect_instruction_i0);
			case Dt: return Z(n(e.effect_instruction_i0, t.effect_instruction_i0));
		}
		case jt: switch (t._tag) {
			case jt: return Q(r(e.effect_instruction_i0, t.effect_instruction_i0));
			case Dt: return Z(t.effect_instruction_i0);
		}
	}
}), cp = (e, t) => {
	let n = wi(e);
	return Li(n) ? S(Vi(n), br(S(Bi(n), rp(Ci)), (e, n) => S(e, sp(n, {
		onSuccess: (e, t) => S(e, Ni(t)),
		onFailure: t
	}))), rp(Di), rp((e) => Ei(e)), R) : L();
}, lp = (e) => ({
	...Xt,
	[Bu]: Vu,
	state: ts(Hu([])),
	commit() {
		return fp(this);
	},
	blockingOn: e
}), up = () => G(md, (e) => dp(e)), dp = (e) => Y(() => lp(e)), fp = (e) => rd((t) => {
	let n = ns(e.state);
	switch (n._tag) {
		case zu: return t(n.effect);
		case Ru: return n.joiners.push(t), _p(e, t);
	}
}, e.blockingOn), pp = /*#__PURE__*/ b(2, (e, t) => Y(() => {
	let n = ns(e.state);
	switch (n._tag) {
		case zu: return !1;
		case Ru:
			rs(e.state, Uu(t));
			for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
			return !0;
	}
})), mp = /*#__PURE__*/ b(2, (e, t) => pp(e, W(t))), hp = /*#__PURE__*/ b(2, (e, t) => pp(e, q(t))), gp = (e, t) => {
	let n = ns(e.state);
	if (n._tag === "Pending") {
		rs(e.state, Uu(t));
		for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
	}
}, _p = (e, t) => Y(() => {
	let n = ns(e.state);
	if (n._tag === "Pending") {
		let e = n.joiners.indexOf(t);
		e >= 0 && n.joiners.splice(e, 1);
	}
}), vp = /*#__PURE__*/ H((e) => Q(e.currentContext)), yp = () => vp, bp = (e) => G(yp(), e), xp = /*#__PURE__*/ b(2, (e, t) => sf(hf, t)(e)), Sp = /*#__PURE__*/ b(2, (e, t) => cf(hf, (e) => ui(e, t))(e)), Cp = /*#__PURE__*/ b(2, (e, t) => bp((n) => xp(e, t(n)))), wp = (e) => {
	let t = e.currentSpan;
	return t !== void 0 && t._tag === "Span" ? R(t) : L();
}, Tp = Yf, Ep = Xf, Dp = op, Op = /*#__PURE__*/ Symbol.for("effect/MutableHashMap"), kp = {
	[Op]: Op,
	[Symbol.iterator]() {
		return new Ap(this);
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
}, Ap = class e {
	self;
	referentialIterator;
	bucketIterator;
	constructor(e) {
		this.self = e, this.referentialIterator = e.referential[Symbol.iterator]();
	}
	next() {
		if (this.bucketIterator !== void 0) return this.bucketIterator.next();
		let e = this.referentialIterator.next();
		return e.done ? (this.bucketIterator = new jp(this.self.buckets.values()), this.next()) : e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, jp = class {
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
}, Mp = () => {
	let e = Object.create(kp);
	return e.referential = /* @__PURE__ */ new Map(), e.buckets = /* @__PURE__ */ new Map(), e.bucketsSize = 0, e;
}, Np = /*#__PURE__*/ b(2, (e, t) => {
	if (gt(t) === !1) return e.referential.has(t) ? R(e.referential.get(t)) : L();
	let n = t[E](), r = e.buckets.get(n);
	return r === void 0 ? L() : Pp(e, r, t);
}), Pp = (e, t, n, r = !1) => {
	for (let i = 0, a = t.length; i < a; i++) if (n[j](t[i][0])) {
		let n = t[i][1];
		return r && (t.splice(i, 1), e.bucketsSize--), R(n);
	}
	return L();
}, Fp = /*#__PURE__*/ b(2, (e, t) => kn(Np(e, t))), Ip = /*#__PURE__*/ b(3, (e, t, n) => {
	if (gt(t) === !1) return e.referential.set(t, n), e;
	let r = t[E](), i = e.buckets.get(r);
	return i === void 0 ? (e.buckets.set(r, [[t, n]]), e.bucketsSize++, e) : (Lp(e, i, t), i.push([t, n]), e.bucketsSize++, e);
}), Lp = (e, t, n) => {
	for (let r = 0, i = t.length; r < i; r++) if (n[j](t[r][0])) {
		t.splice(r, 1), e.bucketsSize--;
		return;
	}
}, Rp = /*#__PURE__*/ Symbol.for("effect/Clock"), zp = /*#__PURE__*/ ti("effect/Clock"), Bp = 2 ** 31 - 1, Vp = { unsafeSchedule(e, t) {
	let n = pa(t);
	if (n > Bp) return De;
	let r = !1, i = setTimeout(() => {
		r = !0, e();
	}, n);
	return () => (clearTimeout(i), !r);
} }, Hp = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || typeof performance.now != "function") return () => BigInt(Date.now()) * e;
	let t;
	return () => (t === void 0 && (t = BigInt(Date.now()) * e - BigInt(Math.round(performance.now() * 1e6))), t + BigInt(Math.round(performance.now() * 1e6)));
}(), Up = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return Hp;
	let t = /*#__PURE__*/ Hp() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}(), Wp = class {
	[Rp] = Rp;
	unsafeCurrentTimeMillis() {
		return Date.now();
	}
	unsafeCurrentTimeNanos() {
		return Up();
	}
	currentTimeMillis = /*#__PURE__*/ Y(() => this.unsafeCurrentTimeMillis());
	currentTimeNanos = /*#__PURE__*/ Y(() => this.unsafeCurrentTimeNanos());
	scheduler() {
		return q(Vp);
	}
	sleep(e) {
		return id((t) => ed(Y(Vp.unsafeSchedule(() => t(X), e))));
	}
}, Gp = () => new Wp(), Kp = "InvalidData", qp = "MissingData", Jp = "SourceUnavailable", Yp = "Unsupported", Xp = /*#__PURE__*/ Symbol.for("effect/ConfigError"), Zp = {
	_tag: "ConfigError",
	[Xp]: Xp
}, Qp = (e, t) => {
	let n = Object.create(Zp);
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
}, $p = (e, t) => {
	let n = Object.create(Zp);
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
}, em = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Zp);
	return r._op = Kp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Invalid data at ${S(this.path, Tr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, tm = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Zp);
	return r._op = qp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Missing data at ${S(this.path, Tr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, nm = (e, t, n, r = { pathDelim: "." }) => {
	let i = Object.create(Zp);
	return i._op = Jp, i.path = e, i.message = t, i.cause = n, Object.defineProperty(i, "toString", {
		enumerable: !1,
		value() {
			return `(Source unavailable at ${S(this.path, Tr(r.pathDelim))}: "${this.message}")`;
		}
	}), i;
}, rm = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Zp);
	return r._op = Yp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Unsupported operation at ${S(this.path, Tr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, im = /*#__PURE__*/ b(2, (e, t) => {
	switch (e._op) {
		case "And": return Qp(im(e.left, t), im(e.right, t));
		case "Or": return $p(im(e.left, t), im(e.right, t));
		case Kp: return em([...t, ...e.path], e.message);
		case qp: return tm([...t, ...e.path], e.message);
		case Jp: return nm([...t, ...e.path], e.message, e.cause);
		case Yp: return rm([...t, ...e.path], e.message);
	}
}), am = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._op) {
			case "And":
				r.push(e.right), r.push(e.left), i.push(yn({ _op: "AndCase" }));
				break;
			case "Or":
				r.push(e.right), r.push(e.left), i.push(yn({ _op: "OrCase" }));
				break;
			case Kp:
				i.push(vn(n.invalidDataCase(t, e.path, e.message)));
				break;
			case qp:
				i.push(vn(n.missingDataCase(t, e.path, e.message)));
				break;
			case Jp:
				i.push(vn(n.sourceUnavailableCase(t, e.path, e.message, e.cause)));
				break;
			case Yp: i.push(vn(n.unsupportedCase(t, e.path, e.message)));
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
}), om = { _tag: "Empty" }, sm = /*#__PURE__*/ b(2, (e, t) => {
	let n = Ws(t), r = e;
	for (; Bs(n);) {
		let e = n.head;
		switch (e._tag) {
			case "Empty":
				n = n.tail;
				break;
			case "AndThen":
				n = Hs(e.first, Hs(e.second, n.tail));
				break;
			case "MapName":
				r = vr(r, e.f), n = n.tail;
				break;
			case "Nested":
				r = Hn(r, e.name), n = n.tail;
				break;
			case "Unnested": if (S(Qn(r), Ln(e.name))) r = nr(r), n = n.tail;
			else return yn(tm(r, `Expected ${e.name} to be in path in ConfigProvider#unnested`));
		}
	}
	return vn(r);
}), cm = "Constant", lm = "Fail", um = "Fallback", dm = "Described", fm = "Lazy", pm = "MapOrFail", mm = "Nested", hm = "Primitive", gm = "Redacted", _m = "Sequence", vm = "HashMap", ym = "ZipWith", bm = (e, t) => [...e, ...t], xm = /*#__PURE__*/ Symbol.for("effect/ConfigProvider"), Sm = /*#__PURE__*/ ti("effect/ConfigProvider"), Cm = /*#__PURE__*/ Symbol.for("effect/ConfigProviderFlat"), wm = (e) => ({
	[xm]: xm,
	pipe() {
		return I(this, arguments);
	},
	...e
}), Tm = (e) => ({
	[Cm]: Cm,
	patch: e.patch,
	load: (t, n, r = !0) => e.load(t, n, r),
	enumerateChildren: e.enumerateChildren
}), Em = (e) => wm({
	load: (t) => G(Mm(e, gr(), t, !1), (e) => An(Qn(e), {
		onNone: () => U(tm(gr(), `Expected a single value having structure: ${t}`)),
		onSome: q
	})),
	flattened: e
}), Dm = (e) => {
	let { pathDelim: t, seqDelim: n } = Object.assign({}, {
		pathDelim: "_",
		seqDelim: ","
	}, e), r = (e) => S(e, Tr(t)), i = (e) => e.split(t), a = () => typeof process < "u" && "env" in process && typeof process.env == "object" ? process.env : {};
	return Em(Tm({
		load: (e, t, i = !0) => {
			let o = r(e), s = a();
			return S(o in s ? R(s[o]) : L(), Td(() => tm(e, `Expected ${o} to exist in the process context`)), G((r) => Fm(r, e, t, n, i)));
		},
		enumerateChildren: (e) => Y(() => {
			let t = a();
			return Wo(Object.keys(t).map((e) => i(e.toUpperCase())).filter((t) => {
				for (let n = 0; n < e.length; n++) {
					let r = S(e, Zn(n)), i = t[n];
					if (i === void 0 || r !== i) return !1;
				}
				return !0;
			}).flatMap((t) => t.slice(e.length, e.length + 1)));
		}),
		patch: om
	}));
}, Om = (e, t, n, r) => {
	let i = xr(n.length, (t) => t >= r.length ? L() : R([e(t), t + 1])), a = xr(r.length, (e) => e >= n.length ? L() : R([t(e), e + 1]));
	return [bm(n, i), bm(r, a)];
}, km = (e, t) => {
	let n = t;
	if (n._tag === "Nested") {
		let t = e.slice();
		for (; n._tag === "Nested";) t.push(n.name), n = n.config;
		return t;
	}
	return e;
}, Am = {
	andCase: (e, t, n) => Qp(t, n),
	orCase: (e, t, n) => $p(t, n),
	invalidDataCase: (e, t) => em(t, "<redacted>"),
	missingDataCase: (e, t) => tm(t, "<redacted>"),
	sourceUnavailableCase: (e, t, n, r) => nm(t, "<redacted>", r),
	unsupportedCase: (e, t) => rm(t, "<redacted>")
}, jm = (e) => am(e, void 0, Am), Mm = (e, t, n, r) => {
	let i = n;
	switch (i._tag) {
		case cm: return q(_r(i.value));
		case dm: return J(() => Mm(e, t, i.config, r));
		case lm: return U(tm(t, i.message));
		case um: return S(J(() => Mm(e, t, i.first, r)), ad((n) => i.condition(n) ? S(Mm(e, t, i.second, r), ad((e) => U($p(n, e)))) : U(n)));
		case fm: return J(() => Mm(e, t, i.config(), r));
		case pm: return J(() => S(Mm(e, t, i.original, r), G(xd((e) => S(i.mapOrFail(e), Td(im(km(t, i.original))))))));
		case mm: return J(() => Mm(e, bm(t, _r(i.name)), i.config, r));
		case hm: return S(sm(t, e.patch), G((t) => S(e.load(t, i, r), G((e) => {
			if (e.length === 0) {
				let e = S(er(t), jn(() => "<n/a>"));
				return U(tm([], `Expected ${i.description} with name ${e}`));
			}
			return q(e);
		}))));
		case gm: return J(() => S(Mm(e, t, i.original, r), Td(jm), K(vr(i.redact))));
		case _m: return S(sm(t, e.patch), G((n) => S(e.enumerateChildren(n), G(Lm), G((n) => n.length === 0 ? J(() => K(Mm(e, t, i.config, !0), _r)) : S(xd(n, (n) => Mm(e, Un(t, `[${n}]`), i.config, !0)), K((e) => {
			let t = yr(e);
			return t.length === 0 ? _r(gr()) : _r(t);
		}))))));
		case vm: return J(() => S(sm(t, e.patch), G((t) => S(e.enumerateChildren(t), G((n) => S(n, xd((n) => Mm(e, bm(t, _r(n)), i.valueConfig, r)), K((e) => e.length === 0 ? _r(Ss()) : S(Im(e), vr((e) => Cs(cr(z(n), e)))))))))));
		case ym: return J(() => S(Mm(e, t, i.left, r), ud, G((n) => S(Mm(e, t, i.right, r), ud, G((e) => {
			if (bn(n) && bn(e)) return U(Qp(n.left, e.left));
			if (bn(n) && xn(e)) return U(n.left);
			if (xn(n) && bn(e)) return U(e.left);
			if (xn(n) && xn(e)) {
				let r = Nm(t, S(t, Tr("."))), [a, o] = Om(r, r, S(n.right, vr(vn)), S(e.right, vr(vn)));
				return S(a, cr(o), xd(([e, t]) => S(Bd(e, t), K(([e, t]) => i.zip(e, t)))));
			}
			throw Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
		})))));
	}
}, Nm = (e, t) => (n) => yn(tm(e, `The element at index ${n} in a sequence at path "${t}" was missing`)), Pm = (e, t) => e.split(RegExp(`\\s*${Dr(t)}\\s*`)), Fm = (e, t, n, r, i) => i ? S(Pm(e, r), xd((e) => n.parse(e.trim())), Td(im(t))) : S(n.parse(e), wd({
	onFailure: im(t),
	onSuccess: _r
})), Im = (e) => Object.keys(e[0]).map((t) => e.map((e) => e[t])), Lm = (e) => S(xd(e, zm), wd({
	onFailure: () => gr(),
	onSuccess: sr(Er)
}), ud, K(Sn)), Rm = /^(\[(\d+)\])$/, zm = (e) => {
	let t = e.match(Rm);
	if (t !== null) {
		let e = t[2];
		return S(e !== void 0 && e.length > 0 ? R(e) : L(), In(Bm));
	}
	return L();
}, Bm = (e) => {
	let t = Number.parseInt(e);
	return Number.isNaN(t) ? L() : R(t);
}, Vm = /*#__PURE__*/ Symbol.for("effect/Console"), Hm = /*#__PURE__*/ ti("effect/Console"), Um = {
	[Vm]: Vm,
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
}, Wm = /*#__PURE__*/ Symbol.for("effect/Random"), Gm = /*#__PURE__*/ ti("effect/Random"), Km = class {
	seed;
	[Wm] = Wm;
	PRNG;
	constructor(e) {
		this.seed = e, this.PRNG = new $e(e);
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
		return qm(e, (e) => this.nextIntBetween(0, e));
	}
}, qm = (e, t) => J(() => S(Y(() => Array.from(e)), G((e) => {
	let n = [];
	for (let t = e.length; t >= 2; --t) n.push(t);
	return S(n, Sd((n) => S(t(n), K((t) => Jm(e, n - 1, t)))), $u(wi(e)));
}))), Jm = (e, t, n) => {
	let r = e[t];
	return e[t] = e[n], e[n] = r, e;
}, Ym = (e) => new Km(D(e)), Xm = /*#__PURE__*/ Symbol.for("effect/Tracer"), Zm = (e) => ({
	[Xm]: Xm,
	...e
}), Qm = /*#__PURE__*/ ti("effect/Tracer"), $m = /*#__PURE__*/ ti("effect/ParentSpan"), eh = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), th = class {
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
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = t._tag === "Some" ? t.value.traceId : eh(32), this.spanId = eh(16), this.links = Array.from(r);
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
}, nh = /*#__PURE__*/ Zm({
	span: (e, t, n, r, i, a) => new th(e, t, n, r, i, a),
	context: (e) => e()
}), rh = /*#__PURE__*/ pi()("effect/Tracer/DisablePropagation", { defaultValue: De }), ih = /*#__PURE__*/ S(/*#__PURE__*/ ii(), /*#__PURE__*/ oi(zp, /*#__PURE__*/ Gp()), /*#__PURE__*/ oi(Hm, Um), /*#__PURE__*/ oi(Gm, /*#__PURE__*/ Ym(/*#__PURE__*/ Math.random())), /*#__PURE__*/ oi(Sm, /*#__PURE__*/ Dm()), /*#__PURE__*/ oi(Qm, nh)), ah = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/DefaultServices/currentServices"), () => ff(ih));
// node_modules/effect/dist/esm/internal/fiberRefs.js
function oh(e) {
	return new lh(e);
}
function sh() {
	return oh(/* @__PURE__ */ new Map());
}
var ch = /*#__PURE__*/ Symbol.for("effect/FiberRefs"), lh = class {
	locals;
	[ch] = ch;
	constructor(e) {
		this.locals = e;
	}
	pipe() {
		return I(this, arguments);
	}
}, uh = (e, t, n, r = !1) => {
	let i = e, a = t, o = n, s = r, c;
	for (; c === void 0;) if (qn(a) && qn(o)) {
		let e = $n(a)[0], t = nr(a), n = $n(o)[0], r = $n(o)[1], i = nr(o);
		e.startTimeMillis < n.startTimeMillis ? (o = i, s = !0) : e.startTimeMillis > n.startTimeMillis ? a = t : e.id < n.id ? (o = i, s = !0) : e.id > n.id ? a = t : c = [r, s];
	} else c = [i.initial, !0];
	return c;
}, dh = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = new Map(e.locals);
	return n.locals.forEach((e, n) => {
		let i = e[0][1];
		if (!e[0][0][j](t)) {
			if (!r.has(n)) {
				if (M(i, n.initial)) return;
				r.set(n, [[t, n.join(n.initial, i)]]);
				return;
			}
			let a = r.get(n), [o, s] = uh(n, a, e);
			if (s) {
				let e = n.diff(o, i), s = a[0][1], c = n.join(s, n.patch(e)(s));
				if (!M(s, c)) {
					let e, i = a[0][0];
					e = i[j](t) ? [[i, c], ...a.slice(1)] : [[t, c], ...a], r.set(n, e);
				}
			}
		}
	}), new lh(r);
}), fh = /*#__PURE__*/ b(2, (e, t) => {
	let n = /* @__PURE__ */ new Map();
	return ph(e, n, t), new lh(n);
}), ph = (e, t, n) => {
	e.locals.forEach((e, r) => {
		let i = e[0][1], a = r.patch(r.fork)(i);
		M(i, a) ? t.set(r, e) : t.set(r, [[n, a], ...e]);
	});
}, mh = /*#__PURE__*/ b(2, (e, t) => {
	let n = new Map(e.locals);
	return n.delete(t), new lh(n);
}), hh = /*#__PURE__*/ b(2, (e, t) => e.locals.has(t) ? R($n(e.locals.get(t))[1]) : L()), gh = /*#__PURE__*/ b(2, (e, t) => S(hh(e, t), jn(() => t.initial))), _h = /*#__PURE__*/ b(2, (e, { fiberId: t, fiberRef: n, value: r }) => {
	if (e.locals.size === 0) return new lh(/* @__PURE__ */ new Map([[n, [[t, r]]]]));
	let i = new Map(e.locals);
	return vh(i, t, n, r), new lh(i);
}), vh = (e, t, n, r) => {
	let i = e.get(n) ?? [], a;
	if (qn(i)) {
		let [e, n] = $n(i);
		if (e[j](t)) {
			if (M(n, r)) return;
			a = [[t, r], ...i.slice(1)];
		} else a = [[t, r], ...i];
	} else a = [[t, r]];
	e.set(n, a);
}, yh = /*#__PURE__*/ b(2, (e, { entries: t, forkAs: n }) => {
	if (e.locals.size === 0) return new lh(new Map(t));
	let r = new Map(e.locals);
	return n !== void 0 && ph(e, r, n), t.forEach(([e, t]) => {
		t.length === 1 ? vh(r, t[0][0], e, t[0][1]) : t.forEach(([t, n]) => {
			vh(r, t, e, n);
		});
	}), new lh(r);
}), bh = gh, xh = yh, Sh = sh, Ch = Kd, wh = qd, Th = Jd, Eh = Yd, Dh = Xd, Oh = Zd, kh = Qd, Ah = $d, jh = /*#__PURE__*/ Dn(/* @__PURE__ */ S(Er, /*#__PURE__*/ En((e) => e.ordinal))), Mh = (e) => {
	switch (e) {
		case "All": return Ch;
		case "Debug": return Oh;
		case "Error": return Th;
		case "Fatal": return wh;
		case "Info": return Dh;
		case "Trace": return kh;
		case "None": return Ah;
		case "Warning": return Eh;
	}
}, Nh = (e) => e.replace(/[\s="]/g, "_"), Ph = (e) => (t) => `${Nh(t.label)}=${e - t.startTime}ms`, Fh = Jt, Ih = Qt, Lh = class extends Ih {}, Rh = /*#__PURE__*/ Symbol.for("effect/Readable"), zh = /*#__PURE__*/ Symbol.for("effect/Ref"), Bh = {
/* c8 ignore next */
_A: (e) => e }, Vh = class extends Lh {
	ref;
	commit() {
		return this.get;
	}
	[zh] = Bh;
	[Rh] = Rh;
	constructor(e) {
		super(), this.ref = e, this.get = Y(() => ns(this.ref));
	}
	get;
	modify(e) {
		return Y(() => {
			let t = ns(this.ref), [n, r] = e(t);
			return t !== r && rs(r)(this.ref), n;
		});
	}
}, Hh = (e) => new Vh(ts(e)), Uh = (e) => Y(() => Hh(e)), Wh = (e) => e.get, Gh = /*#__PURE__*/ b(2, (e, t) => e.modify(() => [void 0, t])), Kh = /*#__PURE__*/ b(2, (e, t) => e.modify(t)), qh = /*#__PURE__*/ b(2, (e, t) => e.modify((e) => [void 0, t(e)])), Jh = "Empty", Yh = "Remove", Xh = "Update", Zh = "AndThen", Qh = { _tag: Jh }, $h = (e, t) => {
	let n = new Map(e.locals), r = Qh;
	for (let [e, i] of t.locals.entries()) {
		let t = $n(i)[1], a = n.get(e);
		if (a !== void 0) {
			let n = $n(a)[1];
			M(n, t) || (r = eg({
				_tag: Xh,
				fiberRef: e,
				patch: e.diff(n, t)
			})(r));
		} else r = eg({
			_tag: "Add",
			fiberRef: e,
			value: t
		})(r);
		n.delete(e);
	}
	for (let [e] of n.entries()) r = eg({
		_tag: Yh,
		fiberRef: e
	})(r);
	return r;
}, eg = /*#__PURE__*/ b(2, (e, t) => ({
	_tag: Zh,
	first: e,
	second: t
})), tg = /*#__PURE__*/ b(3, (e, t, n) => {
	let r = n, i = _r(e);
	for (; qn(i);) {
		let e = $n(i), n = nr(i);
		switch (e._tag) {
			case Jh:
				i = n;
				break;
			case "Add":
				r = _h(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.value
				}), i = n;
				break;
			case Yh:
				r = mh(r, e.fiberRef), i = n;
				break;
			case Xh: {
				let a = gh(r, e.fiberRef);
				r = _h(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.fiberRef.patch(e.patch)(a)
				}), i = n;
				break;
			}
			case Zh: i = Hn(e.first)(Hn(e.second)(n));
		}
	}
	return r;
}), ng = "effect/MetricLabel", rg = /*#__PURE__*/ Symbol.for(ng), ig = class {
	key;
	value;
	[rg] = rg;
	_hash;
	constructor(e, t) {
		this.key = e, this.value = t, this._hash = k(ng + this.key + this.value);
	}
	[E]() {
		return this._hash;
	}
	[j](e) {
		return og(e) && this.key === e.key && this.value === e.value;
	}
	pipe() {
		return I(this, arguments);
	}
}, ag = (e, t) => new ig(e, t), og = (e) => w(e, rg), sg = (e) => K(e, R), cg = (e) => {
	let t, n;
	return typeof e == "function" ? t = e : (t = e.try, n = e.catch), J(() => {
		try {
			return q(T(t));
		} catch (e) {
			return U(n ? T(() => n(e)) : new qf(e, "An unknown error occurred in Effect.try"));
		}
	});
}, lg = (e) => _g(e, dg, $h), ug = /*#__PURE__*/ b(2, (e, t) => bd(e, {
	onFailure: (e) => q(t.onFailure(e)),
	onSuccess: (e) => q(t.onSuccess(e))
})), dg = /*#__PURE__*/ H((e) => q(e.getFiberRefs())), fg = (e) => ug(e, {
	onFailure: ke,
	onSuccess: ke
}), pg = (e) => bg((t, n) => S(e, tg(t, n))), mg = (e) => e.length >= 1 ? id((t, n) => {
	try {
		e(n).then((e) => t(q(e)), (e) => t(cd(e)));
	} catch (e) {
		t(cd(e));
	}
}) : id((t) => {
	try {
		e().then((e) => t(q(e)), (e) => t(cd(e)));
	} catch (e) {
		t(cd(e));
	}
}), hg = /*#__PURE__*/ b(3, (e, t, n) => bp((r) => xp(e, oi(r, t, n)))), gg = /*#__PURE__*/ q(/*#__PURE__*/ L()), _g = /*#__PURE__*/ b(3, (e, t, n) => G(t, (r) => G(e, (e) => K(t, (t) => [n(r, t), e])))), vg = /*#__PURE__*/ b(2, (e, t) => yd(e, {
	onFailure: (e) => {
		let n = mu(e);
		switch (n._tag) {
			case "Left": return Hd(t(n.left), W(e));
			case "Right": return W(e);
		}
	},
	onSuccess: q
})), yg = (e) => {
	let t, n;
	typeof e == "function" ? t = e : (t = e.try, n = e.catch);
	let r = (e) => n ? fd(() => n(e)) : U(new qf(e, "An unknown error occurred in Effect.tryPromise"));
	return t.length >= 1 ? id((e, n) => {
		try {
			t(n).then((t) => e(q(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	}) : id((e) => {
		try {
			t().then((t) => e(q(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	});
}, bg = (e) => H((t) => (t.setFiberRefs(e(t.id(), t.getFiberRefs())), X)), xg = /*#__PURE__*/ In((e) => si(e.context, rh) ? e._tag === "Span" ? xg(e.parent) : L() : R(e)), Sg = "Sequential", Cg = "Parallel", wg = "ParallelN", Tg = { _tag: Sg }, Eg = { _tag: Cg }, Dg = (e) => ({
	_tag: wg,
	parallelism: e
}), Og = (e) => e._tag === Sg, kg = (e) => e._tag === Cg, Ag = Tg, jg = Eg, Mg = Dg, Ng = $h, Pg = tg, Fg = "effect/FiberStatus", Ig = /*#__PURE__*/ Symbol.for(Fg), Lg = "Done", Rg = "Running", zg = "Suspended", Bg = /*#__PURE__*/ k(`${Fg}-${Lg}`), Vg = class {
	[Ig] = Ig;
	_tag = Lg;
	[E]() {
		return Bg;
	}
	[j](e) {
		return qg(e) && e._tag === "Done";
	}
}, Hg = class {
	runtimeFlags;
	[Ig] = Ig;
	_tag = Rg;
	constructor(e) {
		this.runtimeFlags = e;
	}
	[E]() {
		return S(D(Fg), O(D(this._tag)), O(D(this.runtimeFlags)), A(this));
	}
	[j](e) {
		return qg(e) && e._tag === "Running" && this.runtimeFlags === e.runtimeFlags;
	}
}, Ug = class {
	runtimeFlags;
	blockingOn;
	[Ig] = Ig;
	_tag = zg;
	constructor(e, t) {
		this.runtimeFlags = e, this.blockingOn = t;
	}
	[E]() {
		return S(D(Fg), O(D(this._tag)), O(D(this.runtimeFlags)), O(D(this.blockingOn)), A(this));
	}
	[j](e) {
		return qg(e) && e._tag === "Suspended" && this.runtimeFlags === e.runtimeFlags && M(this.blockingOn, e.blockingOn);
	}
}, Wg = /*#__PURE__*/ new Vg(), Gg = (e) => new Hg(e), Kg = (e, t) => new Ug(e, t), qg = (e) => w(e, Ig), Jg = (e) => e._tag === Lg, Yg = Wg, Xg = Gg, Zg = Kg, Qg = Jg, $g = /*#__PURE__*/ Symbol.for("effect/Micro"), e_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroExit"), t_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroCause"), n_ = { _E: x }, r_ = class extends globalThis.Error {
	_tag;
	traces;
	[t_];
	constructor(e, t, n) {
		let r = `MicroCause.${e}`, i, a, o;
		if (t instanceof globalThis.Error) {
			i = `(${r}) ${t.name}`, a = t.message;
			let e = a.split("\n").length;
			o = t.stack ? `(${r}) ${t.stack.split("\n").slice(0, e + 3).join("\n")}` : `${i}: ${a}`;
		} else i = r, a = vt(t, 0), o = `${i}: ${a}`;
		n.length > 0 && (o += `\n    ${n.join("\n    ")}`), super(a), this._tag = e, this.traces = n, this[t_] = n_, this.name = i, this.stack = o;
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
}, i_ = class extends r_ {
	defect;
	constructor(e, t = []) {
		super("Die", e, t), this.defect = e;
	}
}, a_ = (e, t = []) => new i_(e, t), o_ = class extends r_ {
	constructor(e = []) {
		super("Interrupt", "interrupted", e);
	}
}, s_ = (e = []) => new o_(e), c_ = (e) => e._tag === "Interrupt", l_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroFiber"), u_ = {
	_A: x,
	_E: x
}, d_ = class {
	context;
	interruptible;
	[l_];
	_stack = [];
	_observers = [];
	_exit;
	_children;
	currentOpCount = 0;
	constructor(e, t = !0) {
		this.context = e, this.interruptible = t, this[l_] = u_;
	}
	getRef(e) {
		return Yr(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), ke) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	_interrupted = !1;
	unsafeInterrupt() {
		this._exit || (this._interrupted = !0, this.interruptible && this.evaluate(F_));
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
		if (t === v_) return;
		let n = f_.interruptChildren && f_.interruptChildren(this);
		if (n !== void 0) return this.evaluate(A_(n, () => t));
		this._exit = t;
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = !1, n = e;
		this.currentOpCount = 0;
		try {
			for (;;) {
				if (this.currentOpCount++, !t && this.getRef(U_).shouldYield(this)) {
					t = !0;
					let e = n;
					n = A_(D_, () => e);
				}
				if (n = n[m_](this), n === v_) {
					let e = this._yielded;
					return e_ in e ? (this._yielded = void 0, e) : v_;
				}
			}
		} catch (e) {
			return w(n, m_) ? I_(e) : I_(`MicroFiber.runLoop: Not a valid effect: ${String(n)}`);
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[__] && t[__](this);
			if (n) return { [e]: n };
			if (t[e]) return t;
		}
	}
	_yielded = void 0;
	yieldWith(e) {
		return this._yielded = e, v_;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
}, f_ = /*#__PURE__*/ C("effect/Micro/fiberMiddleware", () => ({ interruptChildren: void 0 })), p_ = /*#__PURE__*/ Symbol.for("effect/Micro/identifier"), $ = /*#__PURE__*/ Symbol.for("effect/Micro/args"), m_ = /*#__PURE__*/ Symbol.for("effect/Micro/evaluate"), h_ = /*#__PURE__*/ Symbol.for("effect/Micro/successCont"), g_ = /*#__PURE__*/ Symbol.for("effect/Micro/failureCont"), __ = /*#__PURE__*/ Symbol.for("effect/Micro/ensureCont"), v_ = /*#__PURE__*/ Symbol.for("effect/Micro/Yield"), y_ = {
	_A: x,
	_E: x,
	_R: x
}, b_ = {
	...Fh,
	_op: "Micro",
	[$g]: y_,
	pipe() {
		return I(this, arguments);
	},
	[Symbol.iterator]() {
		return new Ke(new rt(this));
	},
	toJSON() {
		return {
			_id: "Micro",
			op: this[p_],
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
function x_(e) {
	return I_("Micro.evaluate: Not implemented");
}
var S_ = (e) => ({
	...b_,
	[p_]: e.op,
	[m_]: e.eval ?? x_,
	[h_]: e.contA,
	[g_]: e.contE,
	[__]: e.ensure
}), C_ = (e) => {
	let t = S_(e);
	return function() {
		let n = Object.create(t);
		return n[$] = e.single === !1 ? arguments : arguments[0], n;
	};
}, w_ = (e) => {
	let t = {
		...S_(e),
		[e_]: e_,
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
			return M_(t) && t._tag === e.op && M(this[$], t[$]);
		},
		[E]() {
			return A(this, O(k(e.op))(D(this[$])));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[$] = e, n[h_] = void 0, n[g_] = void 0, n[__] = void 0, n;
	};
}, T_ = /*#__PURE__*/ w_({
	op: "Success",
	prop: "value",
	eval(e) {
		let t = e.getCont(h_);
		return t ? t[h_](this[$], e) : e.yieldWith(this);
	}
}), E_ = /*#__PURE__*/ w_({
	op: "Failure",
	prop: "cause",
	eval(e) {
		let t = e.getCont(g_);
		for (; c_(this[$]) && t && e.interruptible;) t = e.getCont(g_);
		return t ? t[g_](this[$], e) : e.yieldWith(this);
	}
}), D_ = /*#__PURE__*/ (/* @__PURE__ */ C_({
	op: "Yield",
	eval(e) {
		let t = !1;
		return e.getRef(U_).scheduleTask(() => {
			t || e.evaluate(L_);
		}, this[$] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), O_ = /*#__PURE__*/ T_(void 0), k_ = /*#__PURE__*/ C_({
	op: "WithMicroFiber",
	eval(e) {
		return this[$](e);
	}
}), A_ = /*#__PURE__*/ b(2, (e, t) => {
	let n = Object.create(j_);
	return n[$] = e, n[h_] = t, n;
}), j_ = /*#__PURE__*/ S_({
	op: "OnSuccess",
	eval(e) {
		return e._stack.push(this), this[$];
	}
}), M_ = (e) => w(e, e_), N_ = T_, P_ = E_, F_ = /*#__PURE__*/ P_(/*#__PURE__*/ s_()), I_ = (e) => P_(a_(e)), L_ = /*#__PURE__*/ N_(void 0), R_ = "setImmediate" in globalThis ? globalThis.setImmediate : (e) => setTimeout(e, 0), z_ = class {
	tasks = [];
	running = !1;
	scheduleTask(e, t) {
		this.tasks.push(e), this.running || (this.running = !0, R_(this.afterScheduled));
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
		return e.currentOpCount >= e.getRef(H_);
	}
	flush() {
		for (; this.tasks.length > 0;) this.runTasks();
	}
}, B_ = /*#__PURE__*/ b(2, (e, t) => k_((n) => {
	let r = n.context;
	return n.context = t(r), K_(e, () => (n.context = r, O_));
})), V_ = /*#__PURE__*/ b(2, (e, t) => B_(e, ui(t))), H_ = class extends (/*#__PURE__*/ pi()("effect/Micro/currentMaxOpsBeforeYield", { defaultValue: () => 2048 })) {}, U_ = class extends (/*#__PURE__*/ pi()("effect/Micro/currentScheduler", { defaultValue: () => new z_() })) {}, W_ = /*#__PURE__*/ b(2, (e, t) => {
	let n = Object.create(G_);
	return n[$] = e, n[h_] = t.onSuccess, n[g_] = t.onFailure, n;
}), G_ = /*#__PURE__*/ S_({
	op: "OnSuccessAndFailure",
	eval(e) {
		return e._stack.push(this), this[$];
	}
}), K_ = /*#__PURE__*/ b(2, (e, t) => Y_((n) => W_(n(e), {
	onFailure: (e) => A_(t(P_(e)), () => E_(e)),
	onSuccess: (e) => A_(t(N_(e)), () => T_(e))
}))), q_ = /*#__PURE__*/ C_({
	op: "SetInterruptible",
	ensure(e) {
		if (e.interruptible = this[$], e._interrupted && e.interruptible) return () => F_;
	}
}), J_ = (e) => k_((t) => t.interruptible ? e : (t.interruptible = !0, t._stack.push(q_(!1)), t._interrupted ? F_ : e)), Y_ = (e) => k_((t) => t.interruptible ? (t.interruptible = !1, t._stack.push(q_(!0)), e(J_)) : e(x)), X_ = (e, t) => {
	let n = new d_(U_.context(t?.scheduler ?? new z_()));
	if (n.evaluate(e), t?.signal) {
		if (t.signal.aborted) n.unsafeInterrupt();
		else {
			let e = () => n.unsafeInterrupt();
			t.signal.addEventListener("abort", e, { once: !0 }), n.addObserver(() => t.signal.removeEventListener("abort", e));
		}
	}
	return n;
}, Z_ = class e {
	scheduleDrain;
	running = !1;
	tasks = /*#__PURE__*/ new Q_();
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
}, Q_ = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets.length, r, i = 0;
		for (; i < n && this.buckets[i][0] <= t; i++) r = this.buckets[i];
		r && r[0] === t ? r[1].push(e) : i === n ? this.buckets.push([t, [e]]) : this.buckets.splice(i, 0, [t, [e]]);
	}
}, $_ = class {
	maxNextTickBeforeTimer;
	getRunner = /*#__PURE__*/ Z_.cached((e, t) => {
		e >= this.maxNextTickBeforeTimer ? setTimeout(() => t(0), 0) : Promise.resolve(void 0).then(() => t(e + 1));
	});
	constructor(e) {
		this.maxNextTickBeforeTimer = e;
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(_f) && e.getFiberRef(gf);
	}
	scheduleTask(e, t, n) {
		this.getRunner(n).scheduleTask(e, t);
	}
}, ev = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Scheduler/defaultScheduler"), () => new $_(2048)), tv = class {
	tasks = /*#__PURE__*/ new Q_();
	deferred = !1;
	scheduleTask(e, t, n) {
		this.deferred ? ev.scheduleTask(e, t, n) : this.tasks.scheduleTask(e, t);
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(_f) && e.getFiberRef(gf);
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) {
			let e = this.tasks.buckets;
			this.tasks.buckets = [];
			for (let [t, n] of e) for (let e = 0; e < n.length; e++) n[e]();
		}
		this.deferred = !0;
	}
}, nv = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentScheduler"), () => lf(ev)), rv = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestMap"), () => lf(/* @__PURE__ */ new Map())), iv = (e, t, n, r) => {
	switch (e) {
		case void 0: return t();
		case "unbounded": return n();
		case "inherit": return rf(Sf, (e) => e === "unbounded" ? n() : e > 1 ? r(e) : t());
		default: return e > 1 ? r(e) : t();
	}
}, av = "InterruptSignal", ov = "Stateful", sv = "Resume", cv = "YieldNow", lv = (e) => ({
	_tag: av,
	cause: e
}), uv = (e) => ({
	_tag: ov,
	onFiber: e
}), dv = (e) => ({
	_tag: sv,
	effect: e
}), fv = () => ({ _tag: cv }), pv = /*#__PURE__*/ Symbol.for("effect/FiberScope"), mv = class {
	[pv] = pv;
	fiberId = vs;
	roots = /*#__PURE__*/ new Set();
	add(e, t) {
		this.roots.add(t), t.addObserver(() => {
			this.roots.delete(t);
		});
	}
}, hv = class {
	fiberId;
	parent;
	[pv] = pv;
	constructor(e, t) {
		this.fiberId = e, this.parent = t;
	}
	add(e, t) {
		this.parent.tell(uv((e) => {
			e.addChild(t), t.addObserver(() => {
				e.removeChild(t);
			});
		}));
	}
}, gv = (e) => new hv(e.id(), e), _v = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberScope/Global"), () => new mv()), vv = /*#__PURE__*/ Symbol.for("effect/Fiber"), yv = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, bv = {
	[vv]: yv,
	pipe() {
		return I(this, arguments);
	}
}, xv = /*#__PURE__*/ Symbol.for("effect/Fiber"), Sv = (e) => Vd(_d(e.await), e.inheritAll);
({ ...Xt }), { ...bv };
var Cv = "effect/FiberCurrent", wv = /*#__PURE__*/ Symbol.for("effect/Logger"), Tv = {
	/* c8 ignore next */
	_Message: (e) => e,
	/* c8 ignore next */
	_Output: (e) => e
}, Ev = (e) => ({
	[wv]: Tv,
	log: e,
	pipe() {
		return I(this, arguments);
	}
}), Dv = /^[^\s"=]*$/, Ov = /*#__PURE__*/ Ev(/*#__PURE__*/ ((e, t) => ({ annotations: n, cause: r, date: i, fiberId: a, logLevel: o, message: s, spans: c }) => {
	let l = (t) => t.match(Dv) ? t : e(t), u = (e, t) => `${Nh(e)}=${l(t)}`, d = (e, t) => " " + u(e, t), f = u("timestamp", i.toISOString());
	f += d("level", o.label), f += d("fiber", gs(a));
	let p = Vn(s);
	for (let e = 0; e < p.length; e++) f += d("message", vt(p[e], t));
	ou(r) || (f += d("cause", ku(r, { renderErrorCause: !0 })));
	for (let e of c) f += " " + Ph(i.getTime())(e);
	for (let [e, r] of n) f += d(e, vt(r, t));
	return f;
})((e) => `"${e.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`)), kv = {
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
kv.gray, kv.blue, kv.green, kv.yellow, kv.red, kv.bgBrightRed, kv.black;
var Av = typeof process == "object" && process !== null && typeof process.stdout == "object" && process.stdout !== null;
Av && process.stdout.isTTY, Av || "Deno" in globalThis;
// node_modules/effect/dist/esm/internal/metric/boundaries.js
var jv = "effect/MetricBoundaries", Mv = /*#__PURE__*/ Symbol.for(jv), Nv = class {
	values;
	[Mv] = Mv;
	constructor(e) {
		this.values = e, this._hash = S(k(jv), O(mt(this.values)));
	}
	_hash;
	[E]() {
		return this._hash;
	}
	[j](e) {
		return Pv(e) && M(this.values, e.values);
	}
	pipe() {
		return I(this, arguments);
	}
}, Pv = (e) => w(e, Mv), Fv = (e) => new Nv(S(e, Wn(Ci(Infinity)), wr)), Iv = (e) => S(Bn(e.count - 1, (t) => e.start * e.factor ** +t), ki, Fv), Lv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType"), Rv = "effect/MetricKeyType/Counter", zv = /*#__PURE__*/ Symbol.for(Rv), Bv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Frequency"), Vv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Gauge"), Hv = "effect/MetricKeyType/Histogram", Uv = /*#__PURE__*/ Symbol.for(Hv), Wv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Summary"), Gv = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Kv = class {
	incremental;
	bigint;
	[Lv] = Gv;
	[zv] = zv;
	constructor(e, t) {
		this.incremental = e, this.bigint = t, this._hash = k(Rv);
	}
	_hash;
	[E]() {
		return this._hash;
	}
	[j](e) {
		return Xv(e);
	}
	pipe() {
		return I(this, arguments);
	}
}, qv = class {
	boundaries;
	[Lv] = Gv;
	[Uv] = Uv;
	constructor(e) {
		this.boundaries = e, this._hash = S(k(Hv), O(D(this.boundaries)));
	}
	_hash;
	[E]() {
		return this._hash;
	}
	[j](e) {
		return $v(e) && M(this.boundaries, e.boundaries);
	}
	pipe() {
		return I(this, arguments);
	}
}, Jv = (e) => new Kv(e?.incremental ?? !1, e?.bigint ?? !1), Yv = (e) => new qv(e), Xv = (e) => w(e, zv), Zv = (e) => w(e, Bv), Qv = (e) => w(e, Vv), $v = (e) => w(e, Uv), ey = (e) => w(e, Wv), ty = /*#__PURE__*/ Symbol.for("effect/MetricKey"), ny = {
/* c8 ignore next */
_Type: (e) => e }, ry = /*#__PURE__*/ Sr(M), iy = class {
	name;
	keyType;
	description;
	tags;
	[ty] = ny;
	constructor(e, t, n, r = []) {
		this.name = e, this.keyType = t, this.description = n, this.tags = r, this._hash = S(k(this.name + this.description), O(D(this.keyType)), O(mt(this.tags)));
	}
	_hash;
	[E]() {
		return this._hash;
	}
	[j](e) {
		return ay(e) && this.name === e.name && M(this.keyType, e.keyType) && M(this.description, e.description) && ry(this.tags, e.tags);
	}
	pipe() {
		return I(this, arguments);
	}
}, ay = (e) => w(e, ty), oy = (e, t) => new iy(e, Jv(t), Nn(t?.description)), sy = (e, t, n) => new iy(e, Yv(t), Nn(n)), cy = /*#__PURE__*/ b(2, (e, t) => t.length === 0 ? e : new iy(e.name, e.keyType, e.description, hr(e.tags, t))), ly = /*#__PURE__*/ Symbol.for("effect/MetricState"), uy = "effect/MetricState/Counter", dy = /*#__PURE__*/ Symbol.for(uy), fy = "effect/MetricState/Frequency", py = /*#__PURE__*/ Symbol.for(fy), my = "effect/MetricState/Gauge", hy = /*#__PURE__*/ Symbol.for(my), gy = "effect/MetricState/Histogram", _y = /*#__PURE__*/ Symbol.for(gy), vy = "effect/MetricState/Summary", yy = /*#__PURE__*/ Symbol.for(vy), by = {
/* c8 ignore next */
_A: (e) => e }, xy = class {
	count;
	[ly] = by;
	[dy] = dy;
	constructor(e) {
		this.count = e;
	}
	[E]() {
		return S(D(uy), O(D(this.count)), A(this));
	}
	[j](e) {
		return My(e) && this.count === e.count;
	}
	pipe() {
		return I(this, arguments);
	}
}, Sy = /*#__PURE__*/ Sr(M), Cy = class {
	occurrences;
	[ly] = by;
	[py] = py;
	constructor(e) {
		this.occurrences = e;
	}
	_hash;
	[E]() {
		return S(k(fy), O(mt(z(this.occurrences.entries()))), A(this));
	}
	[j](e) {
		return Ny(e) && Sy(z(this.occurrences.entries()), z(e.occurrences.entries()));
	}
	pipe() {
		return I(this, arguments);
	}
}, wy = class {
	value;
	[ly] = by;
	[hy] = hy;
	constructor(e) {
		this.value = e;
	}
	[E]() {
		return S(D(my), O(D(this.value)), A(this));
	}
	[j](e) {
		return Py(e) && this.value === e.value;
	}
	pipe() {
		return I(this, arguments);
	}
}, Ty = class {
	buckets;
	count;
	min;
	max;
	sum;
	[ly] = by;
	[_y] = _y;
	constructor(e, t, n, r, i) {
		this.buckets = e, this.count = t, this.min = n, this.max = r, this.sum = i;
	}
	[E]() {
		return S(D(gy), O(D(this.buckets)), O(D(this.count)), O(D(this.min)), O(D(this.max)), O(D(this.sum)), A(this));
	}
	[j](e) {
		return Fy(e) && M(this.buckets, e.buckets) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return I(this, arguments);
	}
}, Ey = class {
	error;
	quantiles;
	count;
	min;
	max;
	sum;
	[ly] = by;
	[yy] = yy;
	constructor(e, t, n, r, i, a) {
		this.error = e, this.quantiles = t, this.count = n, this.min = r, this.max = i, this.sum = a;
	}
	[E]() {
		return S(D(vy), O(D(this.error)), O(D(this.quantiles)), O(D(this.count)), O(D(this.min)), O(D(this.max)), O(D(this.sum)), A(this));
	}
	[j](e) {
		return Iy(e) && this.error === e.error && M(this.quantiles, e.quantiles) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return I(this, arguments);
	}
}, Dy = (e) => new xy(e), Oy = (e) => new Cy(e), ky = (e) => new wy(e), Ay = (e) => new Ty(e.buckets, e.count, e.min, e.max, e.sum), jy = (e) => new Ey(e.error, e.quantiles, e.count, e.min, e.max, e.sum), My = (e) => w(e, dy), Ny = (e) => w(e, py), Py = (e) => w(e, hy), Fy = (e) => w(e, _y), Iy = (e) => w(e, yy), Ly = /*#__PURE__*/ Symbol.for("effect/MetricHook"), Ry = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, zy = (e) => ({
	[Ly]: Ry,
	pipe() {
		return I(this, arguments);
	},
	...e
}), By = /*#__PURE__*/ BigInt(0), Vy = (e) => {
	let t = e.keyType.bigint ? By : 0, n = e.keyType.incremental ? e.keyType.bigint ? (e) => e >= By : (e) => e >= 0 : (e) => !0, r = (e) => {
		n(e) && (t += e);
	};
	return zy({
		get: () => Dy(t),
		update: r,
		modify: r
	});
}, Hy = (e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.keyType.preregisteredWords) t.set(n, 0);
	let n = (e) => {
		let n = t.get(e) ?? 0;
		t.set(e, n + 1);
	};
	return zy({
		get: () => Oy(t),
		update: n,
		modify: n
	});
}, Uy = (e, t) => {
	let n = t;
	return zy({
		get: () => ky(n),
		update: (e) => {
			n = e;
		},
		modify: (e) => {
			n += e;
		}
	});
}, Wy = (e) => {
	let t = e.keyType.boundaries.values, n = t.length, r = new Uint32Array(n + 1), i = new Float64Array(n), a = 0, o = 0, s = Number.MAX_VALUE, c = Number.MIN_VALUE;
	S(t, sr(Er), vr((e, t) => {
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
		let e = zn(n), t = 0;
		for (let a = 0; a < n; a++) {
			let n = i[a], o = r[a];
			t += o, e[a] = [n, t];
		}
		return e;
	};
	return zy({
		get: () => Ay({
			buckets: u(),
			count: a,
			min: s,
			max: c,
			sum: o
		}),
		update: l,
		modify: l
	});
}, Gy = (e) => {
	let { error: t, maxAge: n, maxSize: r, quantiles: i } = e.keyType, a = S(i, sr(Er)), o = zn(r), s = 0, c = 0, l = 0, u = 0, d = 0, f = (e) => {
		let i = [], s = 0;
		for (; s !== r - 1;) {
			let t = o[s];
			if (t != null) {
				let [r, a] = t, o = sa(e - r);
				ba(o, ra) && ya(o, n) && i.push(a);
			}
			s += 1;
		}
		return Ky(t, a, sr(i, Er));
	}, p = (e, t) => {
		if (r > 0) {
			s += 1;
			let n = s % r;
			o[n] = [t, e];
		}
		u = c === 0 ? e : Math.min(u, e), d = c === 0 ? e : Math.max(d, e), c += 1, l += e;
	};
	return zy({
		get: () => jy({
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
}, Ky = (e, t, n) => {
	let r = n.length;
	if (!qn(t)) return gr();
	let i = t[0], a = t.slice(1), o = qy(e, r, L(), 0, i, n), s = _r(o);
	return a.forEach((t) => {
		s.push(qy(e, r, o.value, o.consumed, t, o.rest));
	}), vr(s, (e) => [e.quantile, e.value]);
}, qy = (e, t, n, r, i, a) => {
	let o = e, s = t, c = n, l = r, u = i, d = a, f = e, p = t, m = n, h = r, ee = i, te = a;
	for (;;) {
		if (!qn(d)) return {
			quantile: u,
			value: L(),
			consumed: l,
			rest: []
		};
		if (u === 1) return {
			quantile: u,
			value: R(tr(d)),
			consumed: l + d.length,
			rest: []
		};
		let e = $n(d), t = ir(d, (t) => t === e), n = u * s, r = o / 2 * n, i = l + t[0].length, a = Math.abs(i - n);
		if (i < n - r) f = o, p = s, m = Qn(d), h = i, ee = u, te = t[1], o = f, s = p, c = m, l = h, u = ee, d = te;
		else {
			if (i > n + r) {
				let t = On(c) ? R(e) : c;
				return {
					quantile: u,
					value: t,
					consumed: l,
					rest: d
				};
			}
			switch (c._tag) {
				case "None":
					f = o, p = s, m = Qn(d), h = i, ee = u, te = t[1], o = f, s = p, c = m, l = h, u = ee, d = te;
					continue;
				case "Some":
					if (a < Math.abs(n - c.value)) {
						f = o, p = s, m = Qn(d), h = i, ee = u, te = t[1], o = f, s = p, c = m, l = h, u = ee, d = te;
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
}, Jy = /*#__PURE__*/ Symbol.for("effect/MetricPair"), Yy = {
/* c8 ignore next */
_Type: (e) => e }, Xy = (e, t) => ({
	[Jy]: Yy,
	metricKey: e,
	metricState: t,
	pipe() {
		return I(this, arguments);
	}
}), Zy = /*#__PURE__*/ Symbol.for("effect/MetricRegistry"), Qy = class {
	[Zy] = Zy;
	map = /*#__PURE__*/ Mp();
	snapshot() {
		let e = [];
		for (let [t, n] of this.map) e.push(Xy(t, n.get()));
		return e;
	}
	get(e) {
		let t = S(this.map, Np(e), Pn);
		if (t == null) {
			if (Xv(e.keyType)) return this.getCounter(e);
			if (Qv(e.keyType)) return this.getGauge(e);
			if (Zv(e.keyType)) return this.getFrequency(e);
			if ($v(e.keyType)) return this.getHistogram(e);
			if (ey(e.keyType)) return this.getSummary(e);
			throw Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
		}
		return t;
	}
	getCounter(e) {
		let t = S(this.map, Np(e), Pn);
		if (t == null) {
			let n = Vy(e);
			S(this.map, Fp(e)) || S(this.map, Ip(e, n)), t = n;
		}
		return t;
	}
	getFrequency(e) {
		let t = S(this.map, Np(e), Pn);
		if (t == null) {
			let n = Hy(e);
			S(this.map, Fp(e)) || S(this.map, Ip(e, n)), t = n;
		}
		return t;
	}
	getGauge(e) {
		let t = S(this.map, Np(e), Pn);
		if (t == null) {
			let n = Uy(e, e.keyType.bigint ? BigInt(0) : 0);
			S(this.map, Fp(e)) || S(this.map, Ip(e, n)), t = n;
		}
		return t;
	}
	getHistogram(e) {
		let t = S(this.map, Np(e), Pn);
		if (t == null) {
			let n = Wy(e);
			S(this.map, Fp(e)) || S(this.map, Ip(e, n)), t = n;
		}
		return t;
	}
	getSummary(e) {
		let t = S(this.map, Np(e), Pn);
		if (t == null) {
			let n = Gy(e);
			S(this.map, Fp(e)) || S(this.map, Ip(e, n)), t = n;
		}
		return t;
	}
}, $y = () => new Qy(), eb = /*#__PURE__*/ Symbol.for("effect/Metric"), tb = {
	/* c8 ignore next */
	_Type: (e) => e,
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, nb = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Metric/globalMetricRegistry"), () => $y()), rb = function(e, t, n, r) {
	let i = Object.assign((e) => Od(e, (e) => lb(i, e)), {
		[eb]: tb,
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
}, ib = (e, t) => ab(oy(e, t)), ab = (e) => {
	let t, n = /* @__PURE__ */ new WeakMap(), r = (r) => {
		if (r.length === 0) return t === void 0 && (t = nb.get(e)), t;
		let i = n.get(r);
		return i === void 0 && (i = nb.get(cy(e, r)), n.set(r, i)), i;
	};
	return rb(e.keyType, (e, t) => r(t).update(e), (e) => r(e).get(), (e, t) => r(t).modify(e));
}, ob = (e, t, n) => ab(sy(e, t, n)), sb = /*#__PURE__*/ b(3, (e, t, n) => cb(e, [ag(t, n)])), cb = /*#__PURE__*/ b(2, (e, t) => rb(e.keyType, (n, r) => e.unsafeUpdate(n, hr(t, r)), (n) => e.unsafeValue(hr(t, n)), (n, r) => e.unsafeModify(n, hr(t, r)))), lb = /*#__PURE__*/ b(2, (e, t) => rf(Ef, (n) => Y(() => e.unsafeUpdate(t, n))));
({ ...Yt });
var ub = /*#__PURE__*/ b(2, (e, t) => rf(rv, (n) => Y(() => {
	if (n.has(e)) {
		let r = n.get(e);
		r.state.completed || (r.state.completed = !0, gp(r.result, t));
	}
}))), db = /*#__PURE__*/ Symbol.for("effect/Supervisor"), fb = {
/* c8 ignore next */
_T: (e) => e }, pb = class e {
	underlying;
	value0;
	[db] = fb;
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
		return new mb(this, e);
	}
}, mb = class e {
	left;
	right;
	_tag = "Zip";
	[db] = fb;
	constructor(e, t) {
		this.left = e, this.right = t;
	}
	get value() {
		return Bd(this.left.value, this.right.value);
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
		return new pb(this, S(this.value, K(e)));
	}
	zip(t) {
		return new e(this, t);
	}
}, hb = (e) => w(e, db) && Ve(e, "Zip"), gb = class {
	effect;
	[db] = fb;
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
		return new pb(this, S(this.value, K(e)));
	}
	zip(e) {
		return new mb(this, e);
	}
	onRun(e, t) {
		return e();
	}
}, _b = (e) => new gb(e), vb = /*#__PURE__*/ C("effect/Supervisor/none", () => _b(X)), yb = Wc, bb = "Empty", xb = "AddSupervisor", Sb = "RemoveSupervisor", Cb = "AndThen", wb = { _tag: bb }, Tb = (e, t) => ({
	_tag: Cb,
	first: e,
	second: t
}), Eb = (e, t) => Db(t, Ci(e)), Db = (e, t) => {
	let n = e, r = t;
	for (; Li(r);) {
		let e = Bi(r);
		switch (e._tag) {
			case bb:
				r = Vi(r);
				break;
			case xb:
				n = n.zip(e.supervisor), r = Vi(r);
				break;
			case Sb:
				n = Ob(n, e.supervisor), r = Vi(r);
				break;
			case Cb: r = Ni(e.first)(Ni(e.second)(Vi(r)));
		}
	}
	return n;
}, Ob = (e, t) => M(e, t) ? vb : hb(e) ? Ob(e.left, t).zip(Ob(e.right, t)) : e, kb = (e) => M(e, vb) ? Uo() : hb(e) ? S(kb(e.left), Zo(kb(e.right))) : Go(e), Ab = /*#__PURE__*/ yb({
	empty: wb,
	patch: Eb,
	combine: Tb,
	diff: (e, t) => {
		if (M(e, t)) return wb;
		let n = kb(e), r = kb(t);
		return Tb(S(r, Xo(n), Qo(wb, (e, t) => Tb(e, {
			_tag: xb,
			supervisor: t
		}))), S(n, Xo(r), Qo(wb, (e, t) => Tb(e, {
			_tag: Sb,
			supervisor: t
		}))));
	}
}), jb = /*#__PURE__*/ ib("effect_fiber_started", { incremental: !0 }), Mb = /*#__PURE__*/ ib("effect_fiber_active"), Nb = /*#__PURE__*/ ib("effect_fiber_successes", { incremental: !0 }), Pb = /*#__PURE__*/ ib("effect_fiber_failures", { incremental: !0 }), Fb = /*#__PURE__*/ sb(/*#__PURE__*/ ob("effect_fiber_lifetimes", /*#__PURE__*/ Iv({
	start: .5,
	factor: 2,
	count: 35
})), "time_unit", "milliseconds"), Ib = "Continue", Lb = "Done", Rb = "Yield", zb = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Bb = (e) => {
	throw Error(`BUG: FiberRuntime - ${vt(e)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, Vb = /*#__PURE__*/ Symbol.for("effect/internal/fiberRuntime/YieldedOp"), Hb = /*#__PURE__*/ C("effect/internal/fiberRuntime/yieldedOpChannel", () => ({ currentOp: null })), Ub = {
	[kt]: (e, t, n) => T(() => t.effect_instruction_i1(n)),
	OnStep: (e, t, n) => Q(Q(n)),
	[At]: (e, t, n) => T(() => t.effect_instruction_i2(n)),
	[Rt]: (e, t, n) => (e.patchRuntimeFlags(e.currentRuntimeFlags, t.patch), ul(e.currentRuntimeFlags) && e.isInterrupted() ? Z(e.getInterruptedCause()) : Q(n)),
	[Pt]: (e, t, n) => (T(() => t.effect_instruction_i2(n)), T(() => t.effect_instruction_i0()) ? (e.pushStack(t), T(() => t.effect_instruction_i1())) : X),
	[Ft]: (e, t, n) => {
		for (;;) {
			let r = T(() => t.effect_instruction_i0.next(n));
			if (r.done) return Q(r.value);
			let i = it(r.value);
			if (!Jf(i)) return e.pushStack(t), i;
			if (i._tag === "Failure") return i;
			n = i.value;
		}
	}
}, Wb = {
	[av]: (e, t, n, r) => (e.processNewInterruptSignal(r.cause), ul(t) ? Z(r.cause) : n),
	[sv]: (e, t, n, r) => {
		throw Error("It is illegal to have multiple concurrent run loops in a single fiber");
	},
	[ov]: (e, t, n, r) => (r.onFiber(e, Xg(t)), n),
	[cv]: (e, t, n, r) => G(zd(), () => n)
}, Gb = (e) => Sd(Tl(e), (e) => sx(Ul(e), ([e, t]) => {
	let n = /* @__PURE__ */ new Map(), r = [];
	for (let e of t) {
		r.push(Ei(e));
		for (let t of e) n.set(t.request, t);
	}
	let i = r.flat();
	return sf(Px(e.runAll(r), i, () => i.forEach((e) => {
		e.listeners.interrupted = !0;
	})), rv, n);
}, !1, !1)), Kb = /*#__PURE__*/ Bt(), qb = class extends Lh {
	[vv] = yv;
	[xv] = zb;
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
		if (super(), this.currentRuntimeFlags = n, this._fiberId = e, this._fiberRefs = t, hl(n)) {
			let e = this.getFiberRef(Ef);
			jb.unsafeUpdate(1, e), Mb.unsafeUpdate(1, e);
		}
		this.refreshRefCache();
	}
	commit() {
		return Sv(this);
	}
	id() {
		return this._fiberId;
	}
	resume(e) {
		this.tell(dv(e));
	}
	get status() {
		return this.ask((e, t) => t);
	}
	get runtimeFlags() {
		return this.ask((e, t) => Qg(t) ? e.currentRuntimeFlags : t.runtimeFlags);
	}
	scope() {
		return gv(this);
	}
	get children() {
		return this.ask((e) => Array.from(e.getChildren()));
	}
	getChildren() {
		return this._children === null && (this._children = /* @__PURE__ */ new Set()), this._children;
	}
	getInterruptedCause() {
		return this.getFiberRef(Of);
	}
	fiberRefs() {
		return this.ask((e) => e.getFiberRefs());
	}
	ask(e) {
		return J(() => {
			let t = lp(this._fiberId);
			return this.tell(uv((n, r) => {
				gp(t, Y(() => e(n, r)));
			})), fp(t);
		});
	}
	tell(e) {
		this._queue.push(e), this._running || (this._running = !0, this.drainQueueLaterOnExecutor());
	}
	get await() {
		return id((e) => {
			let t = (t) => e(q(t));
			if (this._exitValue !== null) t(this._exitValue);
			else return this.tell(uv((e, n) => {
				e._exitValue === null ? e.addObserver(t) : t(this._exitValue);
			})), Y(() => this.tell(uv((e, n) => {
				e.removeObserver(t);
			})));
		}, this.id());
	}
	get inheritAll() {
		return H((e, t) => {
			let n = e.id(), r = e.getFiberRefs(), i = t.runtimeFlags, a = dh(r, n, this.getFiberRefs());
			return e.setFiberRefs(a), Md(S(_l(i, e.getFiberRef(jx)), Sl(1), Sl(16)));
		});
	}
	get poll() {
		return Y(() => Nn(this._exitValue));
	}
	unsafePoll() {
		return this._exitValue;
	}
	interruptAsFork(e) {
		return Y(() => this.tell(lv(nu(e))));
	}
	unsafeInterruptAsFork(e) {
		this.tell(lv(nu(e)));
	}
	addObserver(e) {
		this._exitValue === null ? this._observers.push(e) : e(this._exitValue);
	}
	removeObserver(e) {
		this._observers = this._observers.filter((t) => t !== e);
	}
	getFiberRefs() {
		return this.setFiberRef(jx, this.currentRuntimeFlags), this._fiberRefs;
	}
	unsafeDeleteFiberRef(e) {
		this._fiberRefs = mh(this._fiberRefs, e);
	}
	getFiberRef(e) {
		return this._fiberRefs.locals.has(e) ? this._fiberRefs.locals.get(e)[0][1] : e.initial;
	}
	setFiberRef(e, t) {
		this._fiberRefs = _h(this._fiberRefs, {
			fiberId: this._fiberId,
			fiberRef: e,
			value: t
		}), this.refreshRefCache();
	}
	refreshRefCache() {
		this.currentDefaultServices = this.getFiberRef(ah), this.currentTracer = this.currentDefaultServices.unsafeMap.get(Qm.key), this.currentSupervisor = this.getFiberRef(Mx), this.currentScheduler = this.getFiberRef(nv), this.currentContext = this.getFiberRef(hf), this.currentSpan = this.currentContext.unsafeMap.get($m.key);
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
			let t = Ib, n = globalThis[Cv];
			globalThis[Cv] = this;
			try {
				for (; t === Ib;) t = this._queue.length === 0 ? Lb : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
			} finally {
				this._running = !1, globalThis[Cv] = n;
			}
			this._queue.length > 0 && !this._running ? (this._running = !0, t === Rb ? (this.drainQueueLaterOnExecutor(), e = !1) : e = !0) : e = !1;
		}
	}
	drainQueueLaterOnExecutor() {
		this.currentScheduler.scheduleTask(this.run, this.getFiberRef(gf), this);
	}
	drainQueueWhileRunning(e, t) {
		let n = t;
		for (; this._queue.length > 0;) {
			let t = this._queue.splice(0, 1)[0];
			n = Wb[t._tag](this, e, n, t);
		}
		return n;
	}
	isInterrupted() {
		return !su(this.getFiberRef(Of));
	}
	addInterruptedCause(e) {
		let t = this.getFiberRef(Of);
		this.setFiberRef(Of, iu(t, e));
	}
	processNewInterruptSignal(e) {
		this.addInterruptedCause(e), this.sendInterruptSignalToAllChildren();
	}
	sendInterruptSignalToAllChildren() {
		if (this._children === null || this._children.size === 0) return !1;
		let e = !1;
		for (let t of this._children) t.tell(lv(nu(this.id()))), e = !0;
		return e;
	}
	interruptAllChildren() {
		if (this.sendInterruptSignalToAllChildren()) {
			let e = this._children.values();
			this._children = null;
			let t = !1;
			return Pd({
				while: () => !t,
				body: () => {
					let n = e.next();
					return n.done ? Y(() => {
						t = !0;
					}) : ed(n.value.await);
				},
				step: () => {}
			});
		}
		return null;
	}
	reportExitValue(e) {
		if (hl(this.currentRuntimeFlags)) {
			let t = this.getFiberRef(Ef), n = this.id().startTimeMillis, r = Date.now();
			switch (Fb.unsafeUpdate(r - n, t), Mb.unsafeUpdate(-1, t), e._tag) {
				case jt:
					Nb.unsafeUpdate(1, t);
					break;
				case Dt: Pb.unsafeUpdate(1, t);
			}
		}
		if (e._tag === "Failure") {
			let t = this.getFiberRef(wf);
			!lu(e.cause) && t._tag === "Some" && this.log("Fiber terminated with an unhandled error", e.cause, t);
		}
	}
	setExitValue(e) {
		this._exitValue = e, this.reportExitValue(e);
		for (let t = this._observers.length - 1; t >= 0; t--) this._observers[t](e);
		this._observers = [];
	}
	getLoggers() {
		return this.getFiberRef(Qb);
	}
	log(e, t, n) {
		let r = kn(n) ? n.value : this.getFiberRef(yf);
		if (jh(this.getFiberRef(Jb), r)) return;
		let i = this.getFiberRef(bf), a = this.getFiberRef(vf), o = this.getLoggers(), s = this.getFiberRefs();
		if (qo(o) > 0) {
			let n = si(this.getFiberRef(ah), zp), c = new Date(n.unsafeCurrentTimeMillis());
			Ct(s, () => {
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
			case cv: return Rb;
			case av: return this.processNewInterruptSignal(e.cause), this._asyncInterruptor !== null && (this._asyncInterruptor(Z(e.cause)), this._asyncInterruptor = null), Ib;
			case sv: return this._asyncInterruptor = null, this._asyncBlockingOn = null, this.evaluateEffect(e.effect), Ib;
			case ov: return e.onFiber(this, this._exitValue === null ? Zg(this.currentRuntimeFlags, this._asyncBlockingOn) : Yg), Ib;
			default: return Bb(e);
		}
	}
	evaluateEffect(e) {
		this.currentSupervisor.onResume(this);
		try {
			let t = ul(this.currentRuntimeFlags) && this.isInterrupted() ? Z(this.getInterruptedCause()) : e;
			for (; t !== null;) {
				let e = t, n = this.runLoop(e);
				if (n === Vb) {
					let e = Hb.currentOp;
					Hb.currentOp = null, e._op === "Yield" ? sl(this.currentRuntimeFlags) ? (this.tell(fv()), this.tell(dv(op)), t = null) : t = op : e._op === "Async" && (t = null);
				} else {
					this.currentRuntimeFlags = S(this.currentRuntimeFlags, ll(16));
					let e = this.interruptAllChildren();
					e === null ? (this._queue.length === 0 ? this.setExitValue(n) : this.tell(dv(n)), t = null) : t = G(e, () => n);
				}
			}
		} finally {
			this.currentSupervisor.onSuspend(this);
		}
	}
	start(e) {
		if (this._running) this.tell(dv(e));
		else {
			this._running = !0;
			let t = globalThis[Cv];
			globalThis[Cv] = this;
			try {
				this.evaluateEffect(e);
			} finally {
				this._running = !1, globalThis[Cv] = t, this._queue.length > 0 && this.drainQueueLaterOnExecutor();
			}
		}
	}
	startFork(e) {
		this.tell(dv(e));
	}
	patchRuntimeFlags(e, t) {
		let n = vl(e, t);
		return globalThis[Cv] = this, this.currentRuntimeFlags = n, n;
	}
	initiateAsync(e, t) {
		let n = !1, r = (e) => {
			n || (n = !0, this.tell(dv(e)));
		};
		ul(e) && (this._asyncInterruptor = r);
		try {
			t(r);
		} catch (e) {
			r(W(tu(e)));
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
		return Y(() => ci(this.currentContext, e));
	}
	Left(e) {
		return U(e.left);
	}
	None(e) {
		return U(new Gf());
	}
	Right(e) {
		return Q(e.right);
	}
	Some(e) {
		return Q(e.value);
	}
	Micro(e) {
		return nd((t) => {
			let n = t, r = X_(V_(e, this.currentContext));
			return r.addObserver((e) => {
				if (e._tag === "Success") return n(Q(e.value));
				switch (e.cause._tag) {
					case "Interrupt": return n(Z(nu(vs)));
					case "Fail": return n(U(e.cause.error));
					case "Die": return n(cd(e.cause.defect));
				}
			}), nd((e) => {
				n = (t) => {
					e(X);
				}, r.unsafeInterrupt();
			});
		});
	}
	[Mt](e) {
		let t = T(() => e.effect_instruction_i0()), n = this.getNextSuccessCont();
		return n === void 0 ? (Hb.currentOp = Q(t), Vb) : (n._op in Ub || Bb(n), Ub[n._op](this, n, t));
	}
	[jt](e) {
		let t = e, n = this.getNextSuccessCont();
		return n === void 0 ? (Hb.currentOp = t, Vb) : (n._op in Ub || Bb(n), Ub[n._op](this, n, t.effect_instruction_i0));
	}
	[Dt](e) {
		let t = e.effect_instruction_i0, n = this.getNextFailCont();
		if (n !== void 0) switch (n._op) {
			case Ot:
			case At: return ul(this.currentRuntimeFlags) && this.isInterrupted() ? Z(gu(t)) : T(() => n.effect_instruction_i1(t));
			case "OnStep": return ul(this.currentRuntimeFlags) && this.isInterrupted() ? Z(gu(t)) : Q(Z(t));
			case Rt: return this.patchRuntimeFlags(this.currentRuntimeFlags, n.patch), ul(this.currentRuntimeFlags) && this.isInterrupted() ? Z(iu(t, this.getInterruptedCause())) : Z(t);
			default: Bb(n);
		}
		else return Hb.currentOp = Z(t), Vb;
	}
	[It](e) {
		return T(() => e.effect_instruction_i0(this, Xg(this.currentRuntimeFlags)));
	}
	Blocked(e) {
		let t = this.getFiberRefs(), n = this.currentRuntimeFlags;
		if (this._steps.length > 0) {
			let r = [], i = this._steps[this._steps.length - 1], a = this.popStack();
			for (; a && a._op !== "OnStep";) r.push(a), a = this.popStack();
			this.setFiberRefs(i.refs), this.currentRuntimeFlags = i.flags;
			let o = Ng(i.refs, t), s = _l(i.flags, n);
			return Q(Gu(e.effect_instruction_i0, H((t) => {
				for (; r.length > 0;) t.pushStack(r.pop());
				return t.setFiberRefs(Pg(t.id(), t.getFiberRefs())(o)), t.currentRuntimeFlags = vl(s)(t.currentRuntimeFlags), e.effect_instruction_i1;
			})));
		}
		return jd((t) => G(lx(Ku(e.effect_instruction_i0)), () => t(e.effect_instruction_i1)));
	}
	RunBlocked(e) {
		return Gb(e.effect_instruction_i0);
	}
	[Nt](e) {
		let t = e.effect_instruction_i0, n = this.currentRuntimeFlags, r = vl(n, t);
		if (ul(r) && this.isInterrupted()) return Z(this.getInterruptedCause());
		if (this.patchRuntimeFlags(this.currentRuntimeFlags, t), e.effect_instruction_i1) {
			let t = _l(r, n);
			return this.pushStack(new Ju(t, e)), T(() => e.effect_instruction_i1(n));
		}
		return op;
	}
	[kt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	OnStep(e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[Ot](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[At](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[Tt](e) {
		return this._asyncBlockingOn = e.effect_instruction_i1, this.initiateAsync(this.currentRuntimeFlags, e.effect_instruction_i0), Hb.currentOp = e, Vb;
	}
	[Lt](e) {
		return this._isYielding = !1, Hb.currentOp = e, Vb;
	}
	[Pt](e) {
		let t = e.effect_instruction_i0, n = e.effect_instruction_i1;
		return t() ? (this.pushStack(e), n()) : op;
	}
	[Ft](e) {
		return Ub[Ft](this, e, void 0);
	}
	[Et](e) {
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
					t = G(zd({ priority: e }), () => n);
				}
			}
			try {
				if (t = this.currentTracer.context(() => {
					if (Kb !== t[qu]._V) {
						let e = this.getFiberRef(Tf);
						if (e._tag === "Some") {
							let n = t[qu]._V;
							this.log(`Executing an Effect versioned ${n} with a Runtime of version ${Bt()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, $l, e);
						}
					}
					return this[t._op](t);
				}, this), t === Vb) {
					let e = Hb.currentOp;
					return e._op === "Yield" || e._op === "Async" ? Vb : (Hb.currentOp = null, e._op === "Success" || e._op === "Failure" ? e : Z(tu(e)));
				}
			} catch (e) {
				t = t !== Vb && !w(t, "_op") || !(t._op in this) ? ld(`Not a valid effect: ${vt(t)}`) : Uf(e) ? Z(iu(tu(e), nu(vs))) : cd(e);
			}
		}
	}
	run = () => {
		this.drainQueueOnCurrentThread();
	};
}, Jb = /*#__PURE__*/ C("effect/FiberRef/currentMinimumLogLevel", () => lf(Mh("Info"))), Yb = (e) => Ev((t) => {
	si(bh(t.context, ah), Hm).unsafe.log(e.log(t));
}), Xb = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Logger/defaultLogger"), () => Yb(Ov)), Zb = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/Logger/tracerLogger"), () => Ev(({ annotations: e, cause: t, context: n, fiberId: r, logLevel: i, message: a }) => {
	let o = xg(li(gh(n, hf), $m));
	if (o._tag === "None" || o.value._tag === "ExternalSpan") return;
	let s = ci(gh(n, ah), zp), c = {};
	for (let [t, n] of e) c[t] = n;
	c["effect.fiberId"] = bs(r), c["effect.logLevel"] = i.label, t !== null && t._tag !== "Empty" && (c["effect.cause"] = ku(t, { renderErrorCause: !0 })), o.value.event(vt(Array.isArray(a) && a.length === 1 ? a[0] : a), s.unsafeCurrentTimeNanos(), c);
})), Qb = /*#__PURE__*/ C(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLoggers"), () => uf(Go(Xb, Zb))), $b = /*#__PURE__*/ b((e) => Zu(e[0]), (e, t) => Ad(Od(e, (e) => ex((n) => t(e, n))))), ex = (e) => H((t) => {
	let n = t.getFiberRefs(), r = cl(t.currentRuntimeFlags, 1);
	return G(Cx, (t) => Mf(t, (t) => H((i) => {
		let a = i.getFiberRefs(), o = i.currentRuntimeFlags, s = Ng(a, n), c = _l(o, r), l = Ng(n, a);
		return i.setFiberRefs(Pg(s, i.id(), n)), Nx(Rd(e(t), c), Y(() => {
			i.setFiberRefs(Pg(l, i.id(), i.getFiberRefs()));
		}));
	})));
}), tx = (e) => {
	if (Array.isArray(e) || Ue(e)) return [e, L()];
	let t = Object.keys(e), n = t.length;
	return [t.map((t) => e[t]), R((e) => {
		let r = {};
		for (let i = 0; i < n; i++) r[t[i]] = e[i];
		return r;
	})];
}, nx = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(ud(t));
	return G(ax(r, x, {
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
}, rx = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(ud(t));
	return n?.discard ? ax(r, x, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		discard: !0,
		concurrentFinalizers: n?.concurrentFinalizers
	}) : K(ax(r, x, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => t._tag === "Some" ? t.value(e) : e);
}, ix = (e, t) => {
	let [n, r] = tx(e);
	return t?.mode === "validate" ? nx(n, r, t) : t?.mode === "either" ? rx(n, r, t) : t?.discard !== !0 && r._tag === "Some" ? K(ax(n, x, t), r.value) : ax(n, x, t);
}, ax = /*#__PURE__*/ b((e) => Ue(e[0]), (e, t, n) => H((r) => {
	let i = n?.batching === !0 || n?.batching === "inherit" && r.getFiberRef(Cf);
	return n?.discard ? iv(n.concurrency, () => gx(Ag, n?.concurrentFinalizers)((n) => i ? sx(e, (e, r) => n(t(e, r)), !0, !1, 1) : Sd(e, (e, r) => n(t(e, r)))), () => gx(jg, n?.concurrentFinalizers)((n) => sx(e, (e, r) => n(t(e, r)), i, !1)), (r) => gx(Mg(r), n?.concurrentFinalizers)((n) => sx(e, (e, r) => n(t(e, r)), i, !1, r))) : iv(n?.concurrency, () => gx(Ag, n?.concurrentFinalizers)((n) => i ? cx(e, 1, (e, r) => n(t(e, r)), !0) : xd(e, (e, r) => n(t(e, r)))), () => gx(jg, n?.concurrentFinalizers)((n) => ox(e, (e, r) => n(t(e, r)), i)), (r) => gx(Mg(r), n?.concurrentFinalizers)((n) => cx(e, r, (e, r) => n(t(e, r)), i)));
})), ox = (e, t, n) => J(() => {
	let r = z(e), i = Array(r.length);
	return Hd(sx(r, (e, n) => G(t(e, n), (e) => Y(() => i[n] = e)), n, !1), q(i));
}), sx = (e, t, n, r, i) => jd((a) => kd((o) => H((s) => {
	let c = Array.from(e).reverse(), l = c.length;
	if (l === 0) return X;
	let u = 0, d = !1, f = i ? Math.min(c.length, i) : c.length, p = /* @__PURE__ */ new Set(), m = [], h = () => p.forEach((e) => {
		e.currentScheduler.scheduleTask(() => {
			e.unsafeInterruptAsFork(s.id());
		}, 0, e);
	}), ee = [], te = [], ne = [], g = () => {
		let e = m.filter(({ exit: e }) => e._tag === "Failure").sort((e, t) => e.index < t.index ? -1 : e.index === t.index ? 0 : 1).map(({ exit: e }) => e);
		return e.length === 0 && e.push(op), e;
	}, re = (e, t = !1) => {
		let n = Ad(o(e)), r = dx(n, s, s.currentRuntimeFlags, _v);
		return s.currentScheduler.scheduleTask(() => {
			t && r.unsafeInterruptAsFork(s.id()), r.resume(n);
		}, 0, r), r;
	}, _ = () => {
		r || (l -= c.length, c = []), d = !0, h();
	}, v = n ? gd : dd, ie = re(id((e) => {
		let r = (e, t) => {
			e._op === "Blocked" ? ne.push(e) : (m.push({
				index: t,
				exit: e
			}), e._op === "Failure" && !d && _());
		}, o = () => {
			if (c.length > 0) {
				let f = c.pop(), h = u++, _ = () => {
					let e = c.pop();
					return h = u++, G(zd(), () => G(v(a(t(e, h))), ie));
				}, ie = (e) => c.length > 0 && (r(e, h), c.length > 0) ? _() : q(e), ae = G(v(a(t(f, h))), ie), oe = re(ae);
				ee.push(oe), p.add(oe), d && oe.currentScheduler.scheduleTask(() => {
					oe.unsafeInterruptAsFork(s.id());
				}, 0, oe), oe.addObserver((t) => {
					let a;
					if (a = t._op === "Failure" ? t : t.effect_instruction_i0, te.push(oe), p.delete(oe), r(a, h), m.length === l) e(q(jn($f(g(), { parallel: !0 }), () => op)));
					else if (ne.length + m.length === l) {
						let t = g();
						e(q(Gu(ne.map((e) => e.effect_instruction_i0).reduce(Cl), sx([jn($f(t, { parallel: !0 }), () => op), ...ne.map((e) => e.effect_instruction_i1)], (e) => e, n, !0, i))));
					} else o();
				});
			}
		};
		for (let e = 0; e < f; e++) o();
	}));
	return ed(Ed(_d(a(Sv(ie))), ip({
		onFailure: (e) => {
			_();
			let t = ne.length + 1, n = Math.min(typeof i == "number" ? i : ne.length, ne.length), r = Array.from(ne);
			return id((i) => {
				let a = [], o = 0, s = 0, c = (n, s) => (c) => {
					a[n] = c, o++, o === t && i(Q(Z(e))), r.length > 0 && s && l();
				}, l = () => {
					re(r.pop(), !0).addObserver(c(s, !0)), s++;
				};
				ie.addObserver(c(s, !1)), s++;
				for (let e = 0; e < n; e++) l();
			});
		},
		onSuccess: () => xd(te, (e) => e.inheritAll)
	})));
}))), cx = (e, t, n, r) => J(() => {
	let i = z(e), a = Array(i.length);
	return Hd(sx(i, (e, t) => K(n(e, t), (e) => a[t] = e), r, !1, t), q(a));
}), lx = (e) => px(e, _v), ux = (e, t, n, r = null) => {
	let i = fx(e, t, n, r);
	return i.resume(e), i;
}, dx = (e, t, n, r = null) => fx(e, t, n, r), fx = (e, t, n, r = null) => {
	let i = xs(), a = fh(t.getFiberRefs(), i), o = new qb(i, a, n), s = gh(a, hf), c = o.currentSupervisor;
	return c.onStart(s, e, R(t), o), o.addObserver((e) => c.onEnd(e, o)), (r === null ? S(t.getFiberRef(Df), jn(() => t.scope())) : r).add(n, o), o;
}, px = (e, t) => H((n, r) => q(ux(e, n, r.runtimeFlags, t))), mx = (e) => bp((t) => An(li(t, Sx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Parallel": return e;
			case "Sequential":
			case "ParallelN": return G(Pf(t, jg), (t) => Ox(e, t));
		}
	}
})), hx = (e) => (t) => bp((n) => An(li(n, Sx), {
	onNone: () => t,
	onSome: (n) => n.strategy._tag === "ParallelN" && n.strategy.parallelism === e ? t : G(Pf(n, Mg(e)), (e) => Ox(t, e))
})), gx = (e, t) => (n) => bp((r) => An(li(r, Sx), {
	onNone: () => n(x),
	onSome: (r) => {
		if (t === !0) {
			let t = e._tag === "Parallel" ? mx : e._tag === "Sequential" ? bx : hx(e.parallelism);
			switch (r.strategy._tag) {
				case "Parallel": return t(n(mx));
				case "Sequential": return t(n(bx));
				case "ParallelN": return t(n(hx(r.strategy.parallelism)));
			}
		} else return n(x);
	}
})), _x = (e) => G(Sx, e), vx = (e) => G(Dx(), (t) => Ed(e(t), (e) => t.close(e))), yx = (e) => G(Dx(), (t) => kx(e, t)), bx = (e) => bp((t) => An(li(t, Sx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Sequential": return e;
			case "Parallel":
			case "ParallelN": return G(Pf(t, Ag), (t) => Ox(e, t));
		}
	}
})), xx = /*#__PURE__*/ b((e) => Zu(e[1]), (e, t, n, r) => K(ix([e, t], {
	concurrency: r?.concurrent ? 2 : 1,
	batching: r?.batching,
	concurrentFinalizers: r?.concurrentFinalizers
}), ([e, t]) => n(e, t))), Sx = /*#__PURE__*/ ti("effect/Scope"), Cx = Sx, wx = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.set({}, t);
}, Tx = {
	[kf]: kf,
	[Af]: Af,
	pipe() {
		return I(this, arguments);
	},
	fork(e) {
		return Y(() => {
			let t = Ex(e);
			if (this.state._tag === "Closed") return t.state = this.state, t;
			let n = {};
			return this.state.finalizers.set(n, (e) => t.close(e)), wx(t, (e) => Y(() => {
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
			}, t.length === 0 ? X : Og(this.strategy) ? S(xd(t, (t) => dd(t(e))), G((e) => S($f(e), Fn(Qf), jn(() => op)))) : kg(this.strategy) ? S(ox(t, (t) => dd(t(e)), !1), G((e) => S($f(e, { parallel: !0 }), Fn(Qf), jn(() => op)))) : S(cx(t, this.strategy.parallelism, (t) => dd(t(e)), !1), G((e) => S($f(e, { parallel: !0 }), Fn(Qf), jn(() => op))));
		});
	},
	addFinalizer(e) {
		return J(() => this.state._tag === "Closed" ? e(this.state.exit) : (this.state.finalizers.set({}, e), X));
	}
}, Ex = (e = Tg) => {
	let t = Object.create(Tx);
	return t.strategy = e, t.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map()
	}, t;
}, Dx = (e = Tg) => Y(() => Ex(e)), Ox = /*#__PURE__*/ b(2, (e, t) => Cp(e, ui(ai(Sx, t)))), kx = /*#__PURE__*/ b(2, (e, t) => S(e, Ox(t), Ed((e) => t.close(e)))), Ax = (e) => pf(e, {
	differ: Ab,
	fork: wb
}), jx = /*#__PURE__*/ mf(ml), Mx = /*#__PURE__*/ Ax(vb), Nx = /*#__PURE__*/ b(2, (e, t) => jd((n) => yd(n(e), {
	onFailure: (e) => yd(t, {
		onFailure: (t) => W(iu(e, t)),
		onSuccess: () => W(e)
	}),
	onSuccess: (e) => $u(t, e)
}))), Px = (e, t, n) => hd((r) => Nx(G(lx(Cd(e)), (e) => id((r) => {
	let i = t.map((e) => e.listeners.count), a = () => {
		i.every((e) => e === 0) && t.every((e) => !!(e.result.state.current._tag === "Pending" || e.result.state.current._tag === "Done" && Jf(e.result.state.current.effect) && e.result.state.current.effect._tag === "Failure" && cu(e.result.state.current.effect.cause))) && (o.forEach((e) => e()), n?.(), r(Wd(e)));
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
})), J(() => Sd(t.flatMap((e) => e.state.completed ? [] : [e]), (e) => ub(e.request, np(r)))))), Fx = pu, Ix = Ff, Lx = jf, Rx = Nf, zx = Ox, Bx = Pf, Vx = Dx, Hx = class {
	permits;
	waiters = /*#__PURE__*/ new Set();
	taken = 0;
	constructor(e) {
		this.permits = e;
	}
	get free() {
		return this.permits - this.taken;
	}
	take = (e) => rd((t) => {
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
		return this.taken = t(this.taken), this.waiters.size > 0 && e.getFiberRef(nv).scheduleTask(() => {
			let e = this.waiters.values(), t = e.next();
			for (; t.done === !1 && this.free > 0;) t.value(), t = e.next();
		}, e.getFiberRef(gf), e), q(this.free);
	}
	updateTaken(e) {
		return H((t) => this.updateTakenUnsafe(t, e));
	}
	resize = (e) => ed(H((t) => (this.permits = e, this.free < 0 ? X : this.updateTakenUnsafe(t, (e) => e))));
	release = (e) => this.updateTaken((t) => t - e);
	releaseAll = /*#__PURE__*/ this.updateTaken((e) => 0);
	withPermits = (e) => (t) => jd((n) => G(n(this.take(e)), (e) => Nx(n(t), this.release(e))));
	withPermitsIfAvailable = (e) => (t) => jd((n) => J(() => this.free < e ? gg : (this.taken += e, Nx(n(sg(t)), this.release(e)))));
}, Ux = (e) => new Hx(e), Wx = /*#__PURE__*/ Symbol.for("effect/Ref/SynchronizedRef"), Gx = {
/* c8 ignore next */
_A: (e) => e }, Kx = class extends Lh {
	ref;
	withLock;
	[Wx] = Gx;
	[zh] = Bh;
	[Rh] = Rh;
	constructor(e, t) {
		super(), this.ref = e, this.withLock = t, this.get = Wh(this.ref);
	}
	get;
	commit() {
		return this.get;
	}
	modify(e) {
		return this.modifyEffect((t) => q(e(t)));
	}
	modifyEffect(e) {
		return this.withLock(S(G(Wh(this.ref), e), G(([e, t]) => $u(Gh(this.ref, t), e))));
	}
}, qx = (e) => Y(() => Jx(e)), Jx = (e) => new Kx(Hh(e), Ux(1).withPermits(1)), Yx = /*#__PURE__*/ Symbol.for("effect/ManagedRuntime"), Xx = "Fresh", Zx = "FromEffect", Qx = "MergeAll", $x = (e) => function() {
	if (arguments.length === 1) {
		let t = arguments[0];
		return (n, ...r) => e(t, n, ...r);
	}
	return e.apply(this, arguments);
}, eS = /*#__PURE__*/ $x((e, t, n) => {
	let r = xs(), i = [[hf, [[r, e.context]]]];
	n?.scheduler && i.push([nv, [[r, n.scheduler]]]);
	let a = xh(e.fiberRefs, {
		entries: i,
		forkAs: r
	});
	n?.updateRefs && (a = n.updateRefs(a, r));
	let o = new qb(r, a, e.runtimeFlags), s = t;
	n?.scope && (s = G(Bx(n.scope, Tg), (e) => Hd(jf(e, hd((e) => M(e, o.id()) ? X : Gd(o, e))), Ed(t, (t) => Rx(e, t)))));
	let c = o.currentSupervisor;
	return c !== vb && (c.onStart(e.context, s, L(), o), o.addObserver((e) => c.onEnd(e, o))), _v.add(e.runtimeFlags, o), n?.immediate === !1 ? o.resume(s) : o.start(s), o;
}), tS = /*#__PURE__*/ $x((e, t) => {
	let n = lS(e)(t);
	if (n._tag === "Failure") throw sS(n.effect_instruction_i0);
	return n.effect_instruction_i0;
}), nS = class extends Error {
	fiber;
	_tag = "AsyncFiberException";
	constructor(e) {
		super(`Fiber #${e.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`), this.fiber = e, this.name = this._tag, this.stack = this.message;
	}
}, rS = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new nS(e);
	return Error.stackTraceLimit = t, n;
}, iS = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure"), aS = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure/Cause"), oS = class extends Error {
	[iS];
	[aS];
	constructor(e) {
		let t = Lu(e)[0];
		super(t?.message || "An error has occurred"), this[iS] = iS, this[aS] = e, this.name = t ? `(FiberFailure) ${t.name}` : "FiberFailure", t?.stack && (this.stack = t.stack);
	}
	toJSON() {
		return {
			_id: "FiberFailure",
			cause: this[aS].toJSON()
		};
	}
	toString() {
		return "(FiberFailure) " + ku(this[aS], { renderErrorCause: !0 });
	}
	[N]() {
		return this.toString();
	}
}, sS = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new oS(e);
	return Error.stackTraceLimit = t, n;
}, cS = (e) => {
	let t = e;
	switch (t._op) {
		case "Failure":
		case "Success": return t;
		case "Left": return tp(t.left);
		case "Right": return Q(t.right);
		case "Some": return Q(t.value);
		case "None": return tp(new Gf());
	}
}, lS = /*#__PURE__*/ $x((e, t) => {
	let n = cS(t);
	if (n) return n;
	let r = new tv(), i = eS(e)(t, { scheduler: r });
	return r.flush(), i.unsafePoll() || ep(sd(rS(i), wp(i)));
}), uS = /*#__PURE__*/ $x((e, t, n) => dS(e, t, n).then((e) => {
	switch (e._tag) {
		case jt: return e.effect_instruction_i0;
		case Dt: throw sS(e.effect_instruction_i0);
	}
})), dS = /*#__PURE__*/ $x((e, t, n) => new Promise((r) => {
	let i = cS(t);
	i && r(i);
	let a = eS(e)(t);
	a.addObserver((e) => {
		r(e);
	}), n?.signal !== void 0 && (n.signal.aborted ? a.unsafeInterruptAsFork(a.id()) : n.signal.addEventListener("abort", () => {
		a.unsafeInterruptAsFork(a.id());
	}, { once: !0 }));
})), fS = class {
	context;
	runtimeFlags;
	fiberRefs;
	constructor(e, t, n) {
		this.context = e, this.runtimeFlags = t, this.fiberRefs = n;
	}
	pipe() {
		return I(this, arguments);
	}
}, pS = /*#__PURE__*/ ((e) => new fS(e.context, e.runtimeFlags, e.fiberRefs))({
	context: /*#__PURE__*/ ii(),
	runtimeFlags: /* @__PURE__ */ pl(1, 32, 4),
	fiberRefs: /*#__PURE__*/ Sh()
}), mS = /*#__PURE__*/ uS(pS), hS = /*#__PURE__*/ dS(pS), gS = /*#__PURE__*/ tS(pS), _S = /*#__PURE__*/ b(2, (e, t) => e.modifyEffect(t)), vS = /*#__PURE__*/ Symbol.for("effect/Layer"), yS = {
	/* c8 ignore next */
	_RIn: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_ROut: (e) => e
}, bS = {
	[vS]: yS,
	pipe() {
		return I(this, arguments);
	}
}, xS = /*#__PURE__*/ Symbol.for("effect/Layer/MemoMap"), SS = /*#__PURE__*/ pi()("effect/Layer/CurrentMemoMap", { defaultValue: () => DS() }), CS = (e) => w(e, vS), wS = (e) => e._op_layer === Xx, TS = class {
	ref;
	[xS];
	constructor(e) {
		this.ref = e, this[xS] = xS;
	}
	getOrElseMemoize(e, t) {
		return S(_S(this.ref, (n) => {
			let r = n.get(e);
			if (r !== void 0) {
				let [e, i] = r;
				return q([S(e, G(([e, t]) => S(pg(e), $u(t))), Ed(ip({
					onFailure: () => X,
					onSuccess: () => Mf(t, i)
				}))), n]);
			}
			return S(Uh(0), G((r) => S(up(), G((i) => S(Uh(() => X), K((a) => {
				let o = jd((o) => S(Dx(), G((s) => S(o(G(AS(e, s, !0), (e) => lg(e(this)))), dd, G((o) => {
					switch (o._tag) {
						case Dt: return S(mp(i, o.effect_instruction_i0), Hd(Nf(s, o)), Hd(W(o.effect_instruction_i0)));
						case jt: return S(Gh(a, (e) => S(Nf(s, e), Nd(Kh(r, (e) => [e === 1, e - 1])), ed)), Hd(qh(r, (e) => e + 1)), Hd(Mf(t, (t) => S(Y(() => n.delete(e)), Hd(Wh(a)), G((e) => e(t))))), Hd(hp(i, o.effect_instruction_i0)), $u(o.effect_instruction_i0[1]));
					}
				}))))), s = [S(fp(i), Ed(ap({
					onFailure: () => X,
					onSuccess: () => qh(r, (e) => e + 1)
				}))), (e) => S(Wh(a), G((t) => t(e)))];
				return [o, wS(e) ? n : n.set(e, s)];
			}))))));
		}), _d);
	}
}, ES = /*#__PURE__*/ J(() => K(qx(/* @__PURE__ */ new Map()), (e) => new TS(e))), DS = () => new TS(Jx(/* @__PURE__ */ new Map())), OS = /*#__PURE__*/ b(2, (e, t) => G(ES, (n) => kS(e, n, t))), kS = /*#__PURE__*/ b(3, (e, t, n) => G(AS(e, n), (e) => hg(e(t), SS, t))), AS = (e, t, n = !1) => {
	let r = e;
	switch (r._op_layer) {
		case "Locally": return Y(() => (e) => r.f(e.getOrElseMemoize(r.self, t)));
		case "ExtendScope": return Y(() => (e) => _x((t) => e.getOrElseMemoize(r.layer, t)));
		case "Fold": return Y(() => (e) => S(e.getOrElseMemoize(r.layer, t), yd({
			onFailure: (n) => e.getOrElseMemoize(r.failureK(n), t),
			onSuccess: (n) => e.getOrElseMemoize(r.successK(n), t)
		})));
		case "Fresh": return Y(() => (e) => S(r.layer, OS(t)));
		case "FromEffect": return Y(n ? () => (e) => r.effect : () => (n) => n.getOrElseMemoize(e, t));
		case "Provide": return Y(() => (e) => S(e.getOrElseMemoize(r.first, t), G((n) => S(e.getOrElseMemoize(r.second, t), xp(n)))));
		case "Scoped": return Y(n ? () => (e) => Ox(r.effect, t) : () => (n) => n.getOrElseMemoize(e, t));
		case "Suspend": return Y(() => (e) => e.getOrElseMemoize(r.evaluate(), t));
		case "ProvideMerge": return Y(() => (e) => S(e.getOrElseMemoize(r.first, t), Ud(e.getOrElseMemoize(r.second, t), r.zipK)));
		case "ZipWith": return Id(function* () {
			let e = yield* Pf(t, Eg), n = yield* Pf(e, Tg), i = yield* Pf(e, Tg);
			return (e) => S(e.getOrElseMemoize(r.first, n), xx(e.getOrElseMemoize(r.second, i), r.zipK, { concurrent: !0 }));
		});
		case "MergeAll": {
			let e = r.layers;
			return K(Pf(t, Eg), (t) => (n) => {
				let r = Array(e.length);
				return K(sx(e, Ld(function* (e, i) {
					let a = yield* Pf(t, Tg), o = yield* n.getOrElseMemoize(e, a);
					r[i] = o;
				}), !1, !1), () => di(...r));
			});
		}
	}
};
function jS(e) {
	let t = Object.create(bS);
	return t._op_layer = Zx, t.effect = e, t;
}
var MS = (...e) => {
	let t = Object.create(bS);
	return t._op_layer = Qx, t.layers = e, t;
}, NS = /*#__PURE__*/ b(2, (e, t) => {
	let n = ri(e);
	return jS(q(ai(n ? e : t, n ? t : e)));
}), PS = /*#__PURE__*/ b(2, (e, t) => vx((n) => G(OS(t, n), (t) => Sp(e, t)))), FS = /*#__PURE__*/ b(2, (e, t) => {
	let n = Ng(pS.fiberRefs, t.fiberRefs), r = _l(pS.runtimeFlags, t.runtimeFlags);
	return jd((i) => H((a) => {
		let o = a.getFiberRef(hf), s = a.getFiberRefs(), c = Pg(a.id(), s)(n), l = a.currentRuntimeFlags, u = vl(r)(l), d = Ng(c, s), f = _l(u, l);
		return a.setFiberRefs(c), a.currentRuntimeFlags = u, Nx(Sp(i(e), ui(o, t.context)), H((e) => (e.setFiberRefs(Pg(e.id(), e.getFiberRefs())(d)), e.currentRuntimeFlags = vl(f)(e.currentRuntimeFlags), X)));
	}));
}), IS = /*#__PURE__*/ b(2, (e, t) => Array.isArray(t) ? PS(e, MS(...t)) : CS(t) ? PS(e, t) : ni(t) ? Sp(e, t) : Yx in t ? G(t.runtimeEffect, (t) => FS(e, t)) : FS(e, t)), LS = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return { BaseEffectError: class extends Lf {
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
}(), RS = (e) => {
	let t = { BaseEffectError: class extends LS {
		_tag = e;
	} };
	return t.BaseEffectError.prototype.name = e, t.BaseEffectError;
}, zS = U, BS = Id, VS = mg, HS = q, US = J, WS = Y, GS = X, KS = ad, qS = fg, JS = cg, YS = yg, XS = $u, ZS = $b, QS = Nx, $S = yx, eC = IS, tC = Od, nC = vg, rC = bd, iC = mS, aC = hS, oC = gS, sC = class extends RS("AuthenticationFailure") {};
function cC(e) {
	return YS({
		try: e.command,
		catch: (e) => new sC({ cause: e })
	}).pipe(QS(VS(() => e.reconcile?.() ?? Promise.resolve())));
}
async function lC(e) {
	let t = await aC(e);
	if (Ep(t)) return t.value;
	let n = Fx(t.cause);
	throw kn(n) ? n.value.cause : Ix(t.cause);
}
// src/app/services/queries/configuration.ts
function uC(e, t, n, r) {
	let { api: a } = i();
	return _({
		queryKey: y.browse(e ?? "", t, n),
		queryFn: ({ signal: r }) => a.browsePath(e, t, n, r),
		enabled: r,
		staleTime: 2e3,
		retry: !1
	});
}
function dC(e, t, n, r) {
	let { api: a } = i();
	return _({
		queryKey: y.sshBrowse(e ?? { ssh_host: "" }, t ?? "", n),
		queryFn: ({ signal: r }) => a.browseSshPath(e, t, n, r),
		enabled: r && !!e?.ssh_host,
		staleTime: 2e3,
		retry: !1
	});
}
function fC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: (t) => e.browseSshPath(t, null),
		onSuccess: (e, n) => {
			t.setQueryData(y.sshBrowse(n, "", !1), e);
		}
	});
}
function pC() {
	let { api: e } = i();
	return _({
		queryKey: y.sshConfigs,
		queryFn: ({ signal: t }) => e.listSshConfigs(t),
		staleTime: 3e4,
		retry: !1
	});
}
function mC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: (t) => e.createSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.sshConfigs });
		}
	});
}
function hC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ configId: t, payload: n }) => e.updateSshConfig(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.sshConfigs });
		}
	});
}
function gC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: (t) => e.deleteSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.sshConfigs });
		}
	});
}
var _C = 3e5;
function vC() {
	let { api: e } = i();
	return _({
		queryKey: y.mcpLibrary,
		queryFn: ({ signal: t }) => e.getMcpLibrary(t),
		staleTime: _C,
		retry: !1
	});
}
function yC() {
	let { api: e } = i();
	return _({
		queryKey: y.mcpServers,
		queryFn: ({ signal: t }) => e.listMcpServers(t),
		staleTime: 3e4,
		retry: !1
	});
}
function bC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: (t) => e.createMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.mcpServers }), t.invalidateQueries({ queryKey: y.mcpRuntime });
		}
	});
}
function xC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ serverName: t, payload: n }) => e.updateMcpServer(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.mcpServers }), t.invalidateQueries({ queryKey: y.mcpRuntime });
		}
	});
}
function SC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: (t) => e.deleteMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.mcpServers }), t.invalidateQueries({ queryKey: y.mcpRuntime });
		}
	});
}
function CC() {
	let { api: e } = i();
	return g({ mutationFn: (t) => e.testMcpServer(t) });
}
function wC() {
	let { api: e } = i();
	return _({
		queryKey: y.mcpRuntime,
		queryFn: ({ signal: t }) => e.listMcpRuntimeStatus(t),
		staleTime: 5e3,
		retry: !1
	});
}
function TC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ serverName: t, action: n }) => n === "connect" ? e.connectMcpServer(t) : n === "disconnect" ? e.disconnectMcpServer(t) : e.reloadMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: y.mcpRuntime });
		}
	});
}
function EC(e = !0) {
	let { api: t } = i();
	return _({
		queryKey: y.modelConfigs,
		enabled: e,
		queryFn: ({ signal: e }) => t.listModelConfigs(e),
		staleTime: 3e4,
		retry: !1
	});
}
var DC = 0;
function OC() {
	return globalThis.crypto?.randomUUID?.() ?? `credential-${++DC}`;
}
function kC(e, t, n, r) {
	let { api: a } = i(), o = m(() => ({
		identity: OC(),
		value: t
	}), [t]);
	return _({
		queryKey: y.providerModels(e, o.identity, n ?? ""),
		queryFn: ({ signal: r }) => a.listProviderModels({
			backend: e,
			api_key: t,
			base_url: n
		}, r),
		enabled: r && t.length > 0,
		retry: !1,
		staleTime: 3e5,
		gcTime: 6e4
	});
}
function AC(e = !0) {
	let { api: t } = i();
	return _({
		queryKey: y.modelCatalog,
		queryFn: ({ signal: e }) => t.getModelCatalog(e),
		enabled: e,
		staleTime: 6e5,
		retry: !1
	});
}
async function jC(e) {
	await Promise.all([e.resetQueries({ queryKey: y.managedProviderModelsAll }), e.invalidateQueries({ queryKey: y.modelCatalog })]);
}
async function MC(e) {
	await Promise.all([
		e.invalidateQueries({ queryKey: y.managedAuth }),
		e.invalidateQueries({ queryKey: y.managedHostStatus }),
		jC(e),
		e.invalidateQueries({ queryKey: y.resolvedModelConfigsAll }),
		e.invalidateQueries({ queryKey: y.resolvedConfigFilesAll })
	]);
}
function NC(e) {
	let { api: t } = i();
	return _({
		queryKey: y.sessionCommands(e),
		queryFn: ({ signal: n }) => t.listSessionCommands(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function PC(e) {
	let { api: t } = i();
	return _({
		queryKey: y.sessionSkills(e),
		queryFn: ({ signal: n }) => t.listSessionSkills(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function FC(e, t) {
	let { api: n } = i(), r = t.trim();
	return _({
		queryKey: e ? y.resolvedModelConfig(e) : y.resolvedConfigFile(r),
		queryFn: ({ signal: t }) => e ? n.resolveModelConfig(e, t) : n.resolveConfigFile(r, t),
		enabled: !!(e ?? r),
		retry: !1,
		staleTime: 6e4
	});
}
function IC() {
	let { api: e } = i(), t = v();
	return g({
		retry: !1,
		mutationFn: (t) => e.createModelConfig(t),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: y.modelConfigs }),
				t.invalidateQueries({ queryKey: y.credentials }),
				jC(t)
			]);
		}
	});
}
function LC() {
	let { api: e } = i(), t = v();
	return g({
		retry: !1,
		mutationFn: ({ configId: t, payload: n }) => e.updateModelConfig(t, n),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: y.modelConfigs }),
				t.invalidateQueries({ queryKey: y.credentials }),
				jC(t)
			]);
		}
	});
}
function RC() {
	let { api: e } = i(), t = v();
	return g({
		retry: !1,
		mutationFn: (t) => e.deleteModelConfig(t),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: y.modelConfigs }),
				t.invalidateQueries({ queryKey: y.credentials }),
				jC(t)
			]);
		}
	});
}
// src/app/services/queries/host.ts
function zC() {
	let { api: e } = i();
	return _({
		queryKey: y.storeInfo,
		queryFn: ({ signal: t }) => e.getStore(t),
		staleTime: Infinity
	});
}
function BC(e) {
	let { api: t } = i();
	return _({
		queryKey: y.sandboxAvailability,
		queryFn: ({ signal: e }) => t.getSandboxAvailability(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function VC(e, t) {
	let { api: n } = i();
	return _({
		queryKey: [...y.sandboxActivity, t],
		queryFn: ({ signal: e }) => n.getSandboxActivity(t, e),
		enabled: e && t !== null,
		staleTime: 0,
		refetchInterval: 1e3,
		retry: !1
	});
}
function HC() {
	let { api: e } = i(), t = v();
	return g({
		retry: !1,
		mutationFn: (n) => lC(cC({
			command: () => e.managedLogout(n),
			reconcile: () => MC(t)
		}))
	});
}
// src/app/services/queries/direct.ts
function UC(e, t, n) {
	let r = e.find((e) => n(e) === n(t));
	return r && (r.generation > t.generation || r.version > t.version) ? e : r ? e.map((e) => n(e) === n(t) ? t : e) : [...e, t];
}
function WC(e, t, n) {
	return t.map((t) => {
		let r = e?.find((e) => n(e) === n(t));
		return r && (r.generation > t.generation || r.version > t.version) ? r : t;
	});
}
function GC(e, t, n = !0) {
	let { api: r } = i();
	return _({
		queryKey: y.sessionPermissions(e),
		queryFn: ({ signal: t }) => r.getPermissions(e, t),
		enabled: t,
		refetchInterval: t && n ? 1e3 : !1,
		staleTime: 0,
		retry: !1
	});
}
function KC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, requestId: n, reply: r }) => e.replyPermission(t, n, r),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: y.sessionPermissions(n.sessionId) })
	});
}
function qC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, reviewId: n, parentSessionId: r }) => r ? e.authorizeChildPermissionReviewRetry(r, t, n) : e.authorizePermissionReviewRetry(t, n),
		onSuccess: (e, n) => Promise.all([t.invalidateQueries({ queryKey: y.sessionPermissions(n.sessionId) }), ...n.parentSessionId ? [t.invalidateQueries({ queryKey: y.traditionalChildren(n.parentSessionId) })] : []])
	});
}
function JC() {
	let { api: e } = i(), t = v();
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
function YC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, grantId: n }) => e.deletePermissionGrant(t, n),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: y.sessionPermissions(n.sessionId) })
	});
}
function XC(e, t) {
	let { api: n } = i();
	return _({
		queryKey: y.sessionGoal(e),
		queryFn: ({ signal: t }) => n.getGoal(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function ZC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, payload: n }) => e.createGoal(t, n),
		onSuccess: (e, n) => t.setQueryData(y.sessionGoal(n.sessionId), e)
	});
}
function QC() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, goalId: n, payload: r }) => e.updateGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(y.sessionGoal(n.sessionId), e)
	});
}
function $C() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, goalId: n, expectedVersion: r }) => e.clearGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(y.sessionGoal(n.sessionId), null)
	});
}
function ew(e, t) {
	let { api: n } = i();
	return _({
		queryKey: y.traditionalChildren(e),
		queryFn: ({ signal: t }) => n.listTraditionalChildren(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => WC(e, t, (e) => e.child_session_id)
	});
}
function tw() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, payload: n }) => e.startTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(y.traditionalChildren(n.sessionId), (t = []) => UC(t, e, (e) => e.child_session_id));
		}
	});
}
function nw() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, childId: n }) => e.cancelTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(y.traditionalChildren(n.sessionId), (t = []) => UC(t, e, (e) => e.child_session_id));
		}
	});
}
function rw(e, t) {
	let { api: n } = i(), r = xe();
	return t &&= r.orchestrationEnabled, _({
		queryKey: y.managedOrchestrators(e),
		queryFn: ({ signal: t }) => n.listManagedOrchestrators(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => WC(e, t, (e) => e.orchestrator_session_id)
	});
}
function iw() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, payload: n }) => e.startManagedOrchestrator(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(y.managedOrchestrators(n.sessionId), (t = []) => UC(t, e, (e) => e.orchestrator_session_id));
		}
	});
}
function aw() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, orchestratorId: n }) => e.cancelManagedOrchestrator(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(y.managedOrchestrators(n.sessionId), (t = []) => UC(t, e, (e) => e.orchestrator_session_id));
		}
	});
}
function ow(e, t) {
	let { api: n } = i();
	return _({
		queryKey: y.sessionInbox(e),
		queryFn: ({ signal: t }) => n.listInbox(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function sw() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, delivery: n, prompt: r }) => e.createInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(y.sessionInbox(n), (t = []) => [...t.filter((t) => t.id !== e.id), e]);
		}
	});
}
function cw() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r, delivery: i }) => e.updateInboxItem(t, n, r, i),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(y.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
function lw() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r }) => e.cancelInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(y.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
// src/app/features/direct-session/commandWorkflow.ts
var uw = class extends RS("CommandFailure") {};
function dw(e) {
	return BS(function* () {
		yield* WS(e.optimistic);
		let t = yield* YS({
			try: e.admit,
			catch: (e) => new uw({
				operation: "submit",
				cause: e
			})
		}).pipe(nC(() => WS(e.rejected)));
		return t.kind === "accepted" ? (yield* WS(() => e.reconcile(!1)), t.value) : (yield* WS(() => {
			t.kind === "uncertain" ? e.reconcile(!0) : e.rejected();
		}), yield* zS(new uw({
			operation: "submit",
			cause: t.error
		})));
	});
}
function fw(e) {
	return BS(function* () {
		yield* WS(e.optimistic), yield* YS({
			try: e.cancel,
			catch: (e) => new uw({
				operation: "stop",
				cause: e
			})
		}).pipe(nC(() => WS(e.rollback))), yield* WS(e.settled);
	});
}
function pw(e) {
	return YS({
		try: e.create,
		catch: (e) => new uw({
			operation: "create",
			cause: e
		})
	}).pipe(tC((t) => WS(() => e.accept(t))));
}
function mw(e) {
	if (e.mode === "direct-running" || e.delivery) {
		let t = e.delivery ?? "steer";
		return YS({
			try: () => e.inbox(t),
			catch: (e) => new uw({
				operation: t,
				cause: e
			})
		}).pipe(XS(t === "queue" ? "queued" : "steered"));
	}
	let t = e.mode === "classic-running";
	return YS({
		try: t ? e.steer : e.submit,
		catch: (e) => new uw({
			operation: t ? "steer" : "submit",
			cause: e
		})
	}).pipe(XS(t ? "steered" : "submitted"));
}
async function hw(e) {
	let t = await aC(e);
	if (Ep(t)) return t.value;
	let n = Fx(t.cause);
	throw kn(n) ? n.value.cause : Ix(t.cause);
}
// src/app/features/direct-session/commandAdapters.ts
function gw(e, t) {
	let { api: n, stores: { runtimeStore: { captureRuntimeActivation: i, finishRunCancel: a, requestRunCancel: o, restoreRunCancel: s, runtimeStore: c } } } = r(e), l = i(t), u = y.sessionSnapshot(t), d, f, p, m = [];
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
		cancel: () => n.cancelActiveRun(t),
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
function _w(e, t, n) {
	return Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && Number.isSafeInteger(e.total) && e.start >= 0 && e.start <= e.end && e.end <= e.total && e.end - e.start === t && n === t;
}
function vw(e, t, n) {
	let r = /* @__PURE__ */ new Set();
	return (e ?? []).every(({ message_index: e }) => !Number.isSafeInteger(e) || r.has(e) || t[e - n]?.role !== "user" ? !1 : (r.add(e), !0));
}
function yw(e, t, n) {
	return (e ?? []).filter(({ message_index: e }) => e >= t && e < n);
}
function bw(e) {
	return _w(e.page, e.messages.length, e.created_at.length) && vw(e.terminal_selection_attributions, e.messages, e.page.start);
}
function xw(e) {
	let t = e.message_page, n = e.message_created_at ?? [];
	return !!(t && _w(t, e.messages.length, n.length) && vw(e.terminal_selection_attributions, e.messages, t.start));
}
function Sw(e) {
	return e.message_page ?? {
		start: 0,
		end: e.messages.length,
		total: e.messages.length,
		has_older: !1
	};
}
function Cw(e) {
	let t = e.message_created_at ?? [];
	return t.length === e.messages.length ? t : Array.from({ length: e.messages.length }, () => null);
}
function ww(e, t) {
	if (!bw(t)) return { kind: "snapshot-required" };
	let n = Sw(e), r = Cw(e);
	if (!_w(n, e.messages.length, r.length) || t.page.end !== t.page.total || t.page.total < n.total || t.page.start > n.end) return { kind: "snapshot-required" };
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
			terminal_selection_attributions: [...yw(e.terminal_selection_attributions, n.start, t.page.start), ...t.terminal_selection_attributions ?? []],
			message_page: {
				...t.page,
				start: n.start,
				has_older: n.start > 0
			}
		}
	};
}
function Tw(e, t, n) {
	if (!bw(t)) return null;
	let r = Sw(e), i = Cw(e);
	return r.start !== n || t.page.end !== n || t.page.total !== r.total || !_w(r, e.messages.length, i.length) ? null : {
		...e,
		messages: [...t.messages, ...e.messages],
		message_created_at: [...t.created_at, ...i],
		terminal_selection_attributions: [...t.terminal_selection_attributions ?? [], ...yw(e.terminal_selection_attributions, r.start, r.end)],
		message_page: {
			start: t.page.start,
			end: r.end,
			total: r.total,
			has_older: t.page.start > 0
		}
	};
}
function Ew(e, t, n) {
	if (n || !e || !t.message_page) return t;
	if (!xw(t)) return e;
	let r = t.message_created_at ?? [], i = ww(e, {
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
function Dw(e, t, n) {
	let r = e.filter((e) => e !== t), i = Math.max(0, Math.min(n, r.length));
	return [
		...r.slice(0, i),
		t,
		...r.slice(i)
	];
}
function Ow(e, t) {
	return (e.sort_order ?? 0) - (t.sort_order ?? 0) || o(t.created_at) - o(e.created_at);
}
function kw(e, t) {
	return e.filter((e) => !!e.summary.pinned === t).sort((e, t) => Ow(e.summary, t.summary));
}
function Aw(e, t, n) {
	let r = new Map(n.map((e) => [e.summary.session_id, e])), i = {};
	for (let e of t) i[e] = r.get(e)?.summary.presentation_version ?? 0;
	return {
		pinned: e,
		session_ids: t,
		expected_versions: i
	};
}
function jw(e, t) {
	return e.map((e) => e.summary.session_id === t.session_id ? {
		...e,
		summary: t
	} : e);
}
function Mw(e, t, n, r) {
	if (t === r) {
		let t = e.findIndex((e) => e.summary.session_id === r);
		return t < 0 ? e.length : t;
	}
	let i = e.filter((e) => e.summary.session_id !== r), a = i.findIndex((e) => e.summary.session_id === t);
	return a < 0 ? i.length : n === "before" ? a : a + 1;
}
function Nw(e, t) {
	return e.length === t.length && e.every((e, n) => e === t[n]);
}
// src/app/services/queries/invalidation.ts
function Pw() {
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
var Fw = /* @__PURE__ */ new Map(), Iw = 0, Lw = /* @__PURE__ */ new WeakMap(), Rw = 0;
function zw(e, t) {
	let n = Lw.get(e);
	return n === void 0 && (n = ++Rw, Lw.set(e, n)), `${n}:${t}`;
}
function Bw(e) {
	let t = Fw.get(e);
	if (t) return t;
	let n = {
		generation: ++Iw,
		replaceNextSnapshot: !1,
		tailController: null,
		historyControllers: /* @__PURE__ */ new Set()
	};
	return Fw.set(e, n), n;
}
function Vw(e, t = !1) {
	let n = Bw(e);
	n.generation = ++Iw, n.replaceNextSnapshot ||= t, n.tailController?.abort(), n.tailController = null;
	for (let e of n.historyControllers) e.abort();
	return n.historyControllers.clear(), n.generation;
}
function Hw(e) {
	let t = Bw(e);
	return {
		generation: Vw(e),
		replace: t.replaceNextSnapshot
	};
}
function Uw(e, t) {
	let n = Fw.get(e);
	n?.generation === t.generation && t.replace && (n.replaceNextSnapshot = !1);
}
function Ww(e) {
	let t = Bw(e);
	t.tailController?.abort();
	let n = new AbortController();
	return t.tailController = n, {
		generation: t.generation,
		controller: n
	};
}
function Gw(e, t) {
	let n = Fw.get(e);
	n?.tailController === t.controller && (n.tailController = null);
}
function Kw(e, t) {
	return Fw.get(e)?.generation === t;
}
function qw(e) {
	let t = Bw(e), n = new AbortController();
	return t.historyControllers.add(n), {
		generation: t.generation,
		controller: n
	};
}
function Jw(e, t) {
	Fw.get(e)?.historyControllers.delete(t.controller);
}
function Yw(e) {
	let t = Fw.get(e);
	t?.tailController?.abort();
	for (let e of t?.historyControllers ?? []) e.abort();
	Fw.delete(e);
}
// src/app/services/queries/session.ts
function Xw(e = Se) {
	let { api: t } = i();
	return _({
		queryKey: y.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: e,
		staleTime: 0,
		placeholderData: te
	});
}
function Zw(e, t) {
	let n = new Map(t.filter((e) => e.workspace_diff !== void 0).map((e) => [e.summary.session_id, e.workspace_diff]));
	return e.map((e) => {
		let t = n.get(e.summary.session_id);
		return t === void 0 ? e : {
			...e,
			workspace_diff: t
		};
	});
}
function Qw(e = {
	baseMs: Se,
	statsMs: Ce
}) {
	let { api: t } = i(), n = Xw(e.baseMs), r = _({
		queryKey: y.sessions(!0),
		queryFn: ({ signal: e }) => t.listSessions({ workspaceStats: !0 }, e),
		refetchInterval: e.statsMs,
		staleTime: e.statsMs
	}), a = m(() => n.data ? Zw(n.data, r.data ?? []) : n.data, [n.data, r.data]);
	return {
		...n,
		data: a
	};
}
function $w(e) {
	let { api: t } = i(), n = d((t) => t.find((t) => t.summary.session_id === e) ?? null, [e]);
	return _({
		queryKey: y.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: Se,
		staleTime: 0,
		placeholderData: te,
		select: n
	});
}
function eT(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function tT(e, t) {
	let { api: n } = i(), r = v();
	return _({
		queryKey: y.sessionSnapshot(e ?? ""),
		queryFn: async ({ signal: t }) => {
			let i = Hw(zw(r, e)), a = await n.getSession(e, {
				messageLimit: 24,
				threadEventLimit: 50,
				includeSessions: !1,
				includeSystem: !0,
				signal: t
			});
			if (!xw(a)) throw Error("The server returned an invalid snapshot message page.");
			if (t.aborted || !Kw(zw(r, e), i.generation)) throw new DOMException("Snapshot superseded", "AbortError");
			return Uw(zw(r, e), i), Ew(r.getQueryData(y.sessionSnapshot(e)), a, i.replace);
		},
		enabled: !!e,
		staleTime: 1e3,
		placeholderData: eT(e ?? ""),
		...t
	});
}
function nT(e) {
	let { api: t } = i(), n = v();
	return g({ mutationFn: async () => {
		let r = n.getQueryData(y.sessionSnapshot(e))?.message_page?.start;
		if (r === void 0 || r <= 0) throw Error("No older messages are available.");
		let i = zw(n, e), a = qw(i);
		try {
			let o = await t.getMessages(e, {
				before: r,
				limit: 24,
				includeSystem: !0,
				signal: a.controller.signal
			});
			if (!bw(o)) throw Error("The server returned an invalid message page.");
			if (!Kw(i, a.generation)) return !1;
			let s = !1;
			return n.setQueryData(y.sessionSnapshot(e), (e) => {
				if (!e) return e;
				let t = Tw(e, o, r);
				return t ? (s = !0, t) : e;
			}), s;
		} catch (e) {
			if (a.controller.signal.aborted) return !1;
			throw e;
		} finally {
			Jw(i, a);
		}
	} });
}
function rT(e, t) {
	let { api: n } = i();
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
function iT(e) {
	let { api: t } = i();
	return _({
		queryKey: y.sessionConfig(e ?? ""),
		queryFn: ({ signal: n }) => t.getConfig(e, n),
		enabled: !!e
	});
}
function aT() {
	let { api: e } = i(), t = Pw(), n = v();
	return g({
		retry: !1,
		mutationFn: (r) => hw(pw({
			create: () => e.createSession(r),
			accept: (e) => {
				let r = e.metadata.session_id;
				if (!r) throw Error("The server returned a chat without an identity.");
				Vw(zw(n, r), !0), n.setQueryData(y.sessionSnapshot(r), e), t.sessions();
			}
		}))
	});
}
function oT(e, t) {
	let n = [];
	for (let r of e.getQueryCache().findAll({ queryKey: ["session"] })) {
		let e = r.queryKey;
		if (e[0] !== "session" || e[2] !== "snapshot" || typeof e[1] != "string") continue;
		let i = e[1];
		i !== t && r.state.data?.forks?.some((e) => e.session_id === t) && n.push(i);
	}
	return n;
}
function sT() {
	let { api: e, stores: { promptDraftStore: t } } = i(), n = Pw(), r = v();
	return g({
		mutationFn: (t) => e.deleteSession(t),
		onSuccess: (e, i) => {
			t.purgeSessions([i]), n.sessions(), r.removeQueries({ queryKey: y.sessionRoot(i) });
			for (let e of oT(r, i)) n.sessionRoot(e);
		}
	});
}
function cT() {
	let { api: e } = i(), t = Pw();
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
function lT() {
	let e = cT();
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
function uT() {
	let { api: e } = i(), t = Pw();
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
				a = jw(a, t);
			}
			let s = kw(a, r), c = s.map((e) => e.summary.session_id), l = Dw(c, n, i);
			return Nw(c, l) ? null : e.reorderSessions(Aw(r, l, s));
		},
		onSuccess: () => t.sessions()
	});
}
function dT() {
	let { api: e } = i(), t = Pw(), n = v();
	return g({
		retry: !1,
		mutationFn: ({ id: t, patch: n }) => e.updateConfig(t, n),
		onSuccess: (e, { id: r }) => {
			n.invalidateQueries({ queryKey: y.sessionConfig(r) }), t.session(r), t.sessions();
		}
	});
}
function fT() {
	let { api: e } = i(), { captureRuntimeActivation: n, setOptimisticUserPrompt: r } = i().stores.runtimeStore, a = Pw(), o = v();
	return g({
		retry: !1,
		mutationFn: ({ id: i, prompt: s, signal: c }) => {
			let l = n(i);
			return hw(dw({
				optimistic: () => {
					l() && r(s);
				},
				admit: async () => {
					let n = await (c ? e.submitRun(i, s, c) : e.submitRun(i, s));
					return n.status === "accepted" ? {
						kind: "accepted",
						value: n.response
					} : n.status === "not-sent" ? {
						kind: "not-sent",
						error: new DOMException("Prompt submission was cancelled before it was sent.", "AbortError")
					} : {
						kind: "uncertain",
						error: new t(n.requestId, n.error)
					};
				},
				rejected: () => {
					l() && r(null);
				},
				reconcile: (e) => {
					e ? (Vw(zw(o, i), !0), a.sessionRoot(i)) : a.session(i);
				}
			}));
		}
	});
}
function pT() {
	let { api: e } = i();
	return g({ mutationFn: ({ id: t, instruction: n }) => e.steerOrchestrator(t, n) });
}
function mT() {
	let { api: e } = i();
	return g({ mutationFn: ({ id: t, threadName: n, instruction: r }) => e.steerThread(t, n, r) });
}
function hT() {
	let e = v();
	return g({
		retry: !1,
		mutationFn: (t) => hw(fw(gw(e, t)))
	});
}
function gT() {
	let { api: e } = i(), t = Pw(), n = v();
	return g({
		mutationFn: (t) => e.compactSession(t),
		onSuccess: (e, r) => (Vw(zw(n, r), !0), t.sessionRoot(r))
	});
}
function _T() {
	let { api: e } = i(), t = Pw(), n = v();
	return g({
		mutationFn: ({ id: t, messageIdx: n }) => e.revertSession(t, n),
		onSuccess: (e, { id: r }) => {
			Vw(zw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function vT() {
	let { api: e } = i(), t = Pw(), n = v();
	return g({
		mutationFn: ({ id: t, messageIdx: n }) => e.regenerateRun(t, n),
		onSuccess: (e, { id: r }) => {
			Vw(zw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function yT() {
	let { api: e } = i(), t = Pw();
	return g({
		mutationFn: ({ id: t, messageIdx: n }) => e.forkSession(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n), t.sessions();
		}
	});
}
function bT() {
	let { api: e } = i(), t = Pw();
	return g({
		mutationFn: ({ id: t, forkId: n }) => e.dismissSessionFork(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n);
		}
	});
}
function xT() {
	let e = Xw(), t = xe(), n = m(() => e.data ? ve(t, e.data) : void 0, [e.data, t]);
	return {
		...e,
		data: n
	};
}
// src/app/services/queries/workspace.ts
function ST(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function CT(e, t, n = "all", r = 3, a = null) {
	let { api: o } = i();
	return _({
		queryKey: y.workspaceDiff(e ?? "", t ?? "", n, r, a),
		queryFn: ({ signal: i }) => o.getWorkspaceDiff(e, t, {
			stage: n,
			context: r,
			revision: a,
			signal: i
		}),
		enabled: !!(e && t),
		placeholderData: ST(e ?? "")
	});
}
function wT(e, t = null) {
	let { api: n } = i();
	return _({
		queryKey: y.workspaceFiles(e ?? "", t),
		queryFn: ({ signal: r }) => n.getWorkspaceFiles(e, t, r),
		enabled: !!e,
		staleTime: t == null ? 1e4 : Infinity,
		placeholderData: ST(e ?? "")
	});
}
function TT(e, t, n = null) {
	let { api: r } = i();
	return _({
		queryKey: y.workspaceFile(e ?? "", t ?? "", n),
		queryFn: ({ signal: i }) => r.getWorkspaceFile(e, t, n, i),
		enabled: !!(e && t),
		staleTime: n == null ? 1e4 : Infinity,
		placeholderData: ST(e ?? "")
	});
}
function ET(e) {
	let { api: t } = i();
	return _({
		queryKey: y.workspaceRevisions(e ?? ""),
		queryFn: ({ signal: n }) => t.getWorkspaceRevisions(e, n),
		enabled: !!e,
		staleTime: 5e3,
		retry: !1
	});
}
function DT(e, t) {
	let { api: n } = i();
	return _({
		queryKey: y.workspaceRevisionChanges(e ?? "", t ?? 0),
		queryFn: ({ signal: r }) => n.getWorkspaceRevisionChanges(e, t, r),
		enabled: !!(e && t != null),
		staleTime: Infinity,
		placeholderData: ST(e ?? "")
	});
}
function OT(e, t) {
	let { api: n } = i();
	return _({
		queryKey: y.branches(e ?? ""),
		queryFn: ({ signal: t }) => n.getBranches(e, t),
		enabled: !!e && t,
		staleTime: 5e3,
		retry: !1
	});
}
function kT(e) {
	let { api: t } = i(), n = v();
	return g({
		mutationFn: (n) => t.switchBranch(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: y.branches(e) }), n.invalidateQueries({ queryKey: y.sessionRoot(e) }), n.invalidateQueries({ queryKey: y.sessionsAll });
		}
	});
}
function AT(e) {
	let { api: t } = i(), n = v();
	return g({
		mutationFn: (n) => t.commitWorkspace(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: y.sessionRoot(e) }), n.invalidateQueries({ queryKey: y.sessionsAll });
		}
	});
}
// src/app/services/queries/projects.ts
function jT() {
	let { api: e } = i();
	return _({
		queryKey: y.projects,
		queryFn: ({ signal: t }) => e.listProjects(t),
		staleTime: 3e4,
		retry: !1
	});
}
function MT() {
	let { api: e } = i(), t = Pw();
	return g({
		retry: !1,
		mutationFn: (t) => e.createProject(t),
		onSuccess: () => t.projects()
	});
}
function NT() {
	let { api: e } = i(), t = Pw();
	return g({
		retry: !1,
		mutationFn: ({ projectId: t, payload: n }) => e.updateProject(t, n),
		onSuccess: () => t.projects()
	});
}
function PT() {
	let e = NT();
	return {
		...e,
		toggle: (t) => e.mutateAsync({
			projectId: t.project_id,
			payload: { pinned: !t.pinned }
		})
	};
}
function FT() {
	let { api: e, stores: { promptDraftStore: t } } = i(), n = Pw();
	return g({
		mutationFn: ({ projectId: t, sessions: n }) => e.deleteProject(t, n),
		onSuccess: (e) => (t.purgeSessions(e.deleted_session_ids), Promise.all([n.projects(), n.sessions()]))
	});
}
function IT() {
	let { api: e } = i(), t = Pw();
	return g({
		mutationFn: ({ projectId: t, sessionId: n }) => e.assignSessionToProject(t, { session_id: n }),
		onSuccess: () => Promise.all([t.projects(), t.sessions()])
	});
}
function LT() {
	let { api: e } = i(), t = Pw();
	return g({
		mutationFn: async ({ projects: t, projectId: n, targetPinned: r, targetIndex: i }) => {
			let a = t.find((e) => e.project_id === n);
			if (!a) return;
			let o = t;
			a.pinned !== r && (await e.updateProject(n, { pinned: r }), o = (await e.listProjects()).projects);
			let s = o.filter((e) => e.pinned === r).sort((e, t) => e.sort_order - t.sort_order), c = Dw(s.map((e) => e.project_id), n, i);
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
var RT = [
	"status",
	"github",
	"secrets"
], zT = /* @__PURE__ */ new Set([
	"PATH",
	"HOME",
	"NAC_HOME",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"EXA_API_KEY"
]);
function BT(e) {
	return e ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(e) ? zT.has(e) ? `${e} is managed by NAC and cannot be replaced here.` : "" : "Use letters, digits, and underscores; the first character cannot be a digit." : "Enter a variable name.";
}
function VT(e) {
	let t = e?.split("/") ?? [];
	return t.length === 2 && t[0] && t[1] ? [t[0], t[1]] : null;
}
function HT(e) {
	return e?.status === "running";
}
function UT(e) {
	return e ? {
		backend: e.model.backend,
		model: e.model.id,
		baseUrl: e.model.endpoint
	} : null;
}
function WT(e, t) {
	return !!(t && e && t.backend === e.model.backend && t.baseUrl === e.model.endpoint);
}
function GT(e, t) {
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
function KT(e) {
	return typeof e == "object" && e && "status" in e ? e.status : null;
}
function qT(e) {
	return JT(e) || e instanceof Error && e.name === "ManagedUpgradeContractError";
}
function JT(e) {
	let t = KT(e);
	return t === 401 || t === 403 || t === 409;
}
function YT(e) {
	let t = KT(e);
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
var XT = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying"
]);
function ZT(e) {
	return XT.has(e);
}
function QT(e) {
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
function $T(e) {
	switch (e) {
		case "cancel_active_run": return "Stop run";
		case "cancel_traditional_child": return "Cancel coding agent";
		case "cancel_managed_orchestrator": return "Cancel NAC orchestrator";
		case "terminate_terminal": return "Stop terminal";
		case "cancel_clone_operation": return "Cancel clone";
		case "wait": return "Wait";
	}
}
function eE(e) {
	return e === null ? "Accepted-release distance unavailable" : e === 0 ? "Current accepted release" : `${e} accepted ${e === 1 ? "release" : "releases"} ahead`;
}
function tE(e, t) {
	return e.release_id === t.release_id && e.source_revision === t.source_revision && e.build_id === t.build_id && e.product_version === t.product_version && e.schema_version === t.schema_version;
}
// src/app/features/managed/upgradeContract.ts
var nE = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying",
	"succeeded",
	"failed"
]), rE = /* @__PURE__ */ new Set([
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
]), iE = /* @__PURE__ */ new Set([
	"wait",
	"cancel_active_run",
	"cancel_traditional_child",
	"cancel_managed_orchestrator",
	"terminate_terminal",
	"cancel_clone_operation"
]), aE = {
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
}, oE = class extends Error {
	constructor() {
		super("Managed upgrade status did not match the browser contract."), this.name = "ManagedUpgradeContractError";
	}
};
function sE() {
	throw new oE();
}
function cE(e, t, n) {
	(typeof e != "object" || !e || Array.isArray(e)) && sE();
	let r = e;
	return Object.keys(r).some((e) => !t.includes(e)) && sE(), n.some((e) => !Object.hasOwn(r, e)) && sE(), r;
}
function lE(e, t, n = !0) {
	return (typeof e != "string" || e.length > t || !n && e.length === 0 || /\p{Cc}/u.test(e)) && sE(), e;
}
function uE(e) {
	return (typeof e != "number" || !Number.isSafeInteger(e) || e < 0) && sE(), e;
}
function dE(e, t) {
	return typeof e == "string" && t.has(e) || sE(), e;
}
function fE(e, t, n) {
	return Object.hasOwn(e, t) ? lE(e[t], n) : void 0;
}
function pE(e) {
	let t = cE(e, [
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
	]), n = lE(t.source_revision, 40, !1);
	return /^[a-f0-9]{40}$/.test(n) || sE(), {
		release_id: lE(t.release_id, 63, !1),
		source_revision: n,
		build_id: lE(t.build_id, 128, !1),
		product_version: lE(t.product_version, 128, !1),
		schema_version: uE(t.schema_version)
	};
}
function mE(e, t) {
	return Object.hasOwn(e, t) ? pE(e[t]) : void 0;
}
function hE(e) {
	let t = lE(e, 128, !1);
	return /^[A-Za-z0-9_.:@-]+$/.test(t) || sE(), t;
}
function gE(e) {
	let t = [
		"session_id",
		"run_id",
		"child_session_id",
		"orchestrator_session_id",
		"terminal_id",
		"clone_operation_id"
	], n = cE(e, t, []);
	return Object.fromEntries(t.filter((e) => Object.hasOwn(n, e)).map((e) => [e, hE(n[e])]));
}
function _E(e, t) {
	let n = Object.keys(e).sort();
	return n.length === t.length && t.every((t) => n.includes(t) && !!e[t]);
}
function vE(e, t, n) {
	switch (t) {
		case "cancel_active_run": return e === "active_run" && _E(n, ["session_id", "run_id"]);
		case "cancel_traditional_child": return e === "traditional_child" && _E(n, ["session_id", "child_session_id"]);
		case "cancel_managed_orchestrator": return e === "managed_orchestrator" && _E(n, ["session_id", "orchestrator_session_id"]);
		case "terminate_terminal": return e === "terminal_process" && _E(n, ["session_id", "terminal_id"]);
		case "cancel_clone_operation": return e === "clone_operation" && _E(n, ["clone_operation_id"]);
		case "wait": return !1;
	}
}
function yE(e) {
	let t = cE(e, [
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
	]), n = lE(t.selection_key, 71, !1);
	/^sha256:[a-f0-9]{64}$/.test(n) || sE();
	let r = dE(t.kind, rE), i = lE(t.message, 512, !1);
	aE[r].includes(i) || sE(), typeof t.actionable != "boolean" && sE();
	let a = dE(t.action, iE);
	if (!t.actionable) return (a !== "wait" || t.target !== null) && sE(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !1,
		action: a,
		target: null
	};
	let o = gE(t.target);
	return vE(r, a, o) || sE(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !0,
		action: a,
		target: o
	};
}
function bE(e) {
	let t = cE(e, [
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
	t.kind !== "upgrade" && sE();
	let n;
	return Object.hasOwn(t, "blockers") && ((!Array.isArray(t.blockers) || t.blockers.length > 100) && sE(), n = t.blockers.map(yE)), {
		operation_id: lE(t.operation_id, 128, !1),
		managed_host_id: lE(t.managed_host_id, 128, !1),
		kind: "upgrade",
		state: dE(t.state, nE),
		reason: fE(t, "reason", 128),
		message: fE(t, "message", 512),
		target_release: mE(t, "target_release"),
		desired_release: mE(t, "desired_release"),
		observed_release: mE(t, "observed_release"),
		blockers: n,
		created_at: fE(t, "created_at", 64),
		updated_at: fE(t, "updated_at", 64)
	};
}
function xE(e) {
	let t = cE(e, ["preview", "operation"], ["preview", "operation"]), n = cE(t.preview, [
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
	typeof n.upgrade_available != "boolean" && sE();
	let r = null;
	return n.distance !== null && (r = { accepted_releases: uE(cE(n.distance, ["accepted_releases"], ["accepted_releases"]).accepted_releases) }), {
		preview: {
			current: pE(n.current),
			latest_beta: pE(n.latest_beta),
			upgrade_available: n.upgrade_available,
			distance: r
		},
		operation: t.operation === null ? null : bE(t.operation)
	};
}
// src/app/features/managed/queries.ts
var SE = {
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
function CE() {
	let { api: e } = i();
	return _({
		queryKey: SE.hostStatus,
		queryFn: ({ signal: t }) => e.getManagedStatus(t),
		staleTime: 5e3,
		refetchInterval: 15e3,
		retry: !1
	});
}
function wE(e = !0) {
	let { api: t } = i();
	return _({
		queryKey: SE.upgrade,
		queryFn: async ({ signal: e }) => xE(await t.getManagedUpgrade(e)),
		enabled: e,
		staleTime: 0,
		refetchInterval: (e) => e.state.data?.operation && ZT(e.state.data.operation.state) ? 1e3 : 15e3,
		refetchIntervalInBackground: !0,
		retry: !1
	});
}
function TE() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: async (t) => bE(await e.startManagedUpgrade(t)),
		onSuccess: (e) => (t.setQueryData(SE.upgrade, (t) => t && {
			...t,
			operation: e
		}), t.invalidateQueries({ queryKey: SE.upgrade }))
	});
}
function EE(e = !0) {
	let { api: t } = i();
	return _({
		queryKey: SE.github,
		queryFn: ({ signal: e }) => t.getManagedGitHub(e),
		enabled: e,
		retry: !1
	});
}
function DE(e = !0) {
	let { api: t } = i();
	return _({
		queryKey: SE.secrets,
		queryFn: ({ signal: e }) => t.listManagedSecrets(e),
		enabled: e,
		retry: !1
	});
}
function OE() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: ({ name: t, value: n }) => e.putManagedSecret(t, n),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: SE.secrets }), t.invalidateQueries({ queryKey: SE.hostStatus })])
	});
}
function kE() {
	let { api: e } = i(), t = v();
	return g({
		mutationFn: (t) => e.deleteManagedSecret(t),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: SE.secrets }), t.invalidateQueries({ queryKey: SE.hostStatus })])
	});
}
function AE(e = !0, t = !1) {
	let { api: n } = i();
	return _({
		queryKey: SE.auth,
		queryFn: ({ signal: e }) => n.listManagedAuth(e),
		enabled: e,
		staleTime: 3e4,
		refetchInterval: t,
		retry: !1
	});
}
function jE(e, t, n) {
	let { api: r } = i();
	return _({
		queryKey: [
			...SE.providerModels(e ?? ""),
			"after-refusal",
			t,
			n
		],
		queryFn: ({ signal: t }) => r.listProviderModels({ backend: e }, t),
		enabled: e !== null && t !== null && n !== null,
		retry: !1,
		staleTime: Infinity
	});
}
function ME(e, t, n = null) {
	let { api: r } = i();
	return _({
		queryKey: SE.providerModels(e ?? "", n),
		queryFn: ({ signal: t }) => r.listProviderModels(n ? {
			backend: e,
			base_url: n
		} : { backend: e }, t),
		enabled: t && e !== null,
		retry: !1,
		staleTime: 3e5
	});
}
function NE(e) {
	let { api: t } = i(), n = CE().data ?? null, r = m(() => GT(e, n), [e, n]), a = re({ queries: r.map((e) => ({
		queryKey: SE.providerModels(e.backend, e.base_url),
		queryFn: ({ signal: n }) => t.listProviderModels(e, n),
		retry: !1,
		staleTime: 3e5
	})) }), o = /* @__PURE__ */ new Map();
	return r.forEach((e, t) => {
		let n = a[t];
		n?.isPending ? o.set(e.backend, null) : n?.isSuccess && o.set(e.backend, n.data.models);
	}), o;
}
// src/app/providers/ToastProvider.tsx
var PE = u(null), FE = 150, IE = 3, LE = 0, RE = () => `toast-${Date.now()}-${LE++}`;
function zE({ toasts: e, removeToast: t }) {
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
		className: "fixed top-4 right-4 z-[1100] flex w-[360px] max-w-[calc(100%-2rem)] flex-col gap-2 pointer-events-none",
		children: e.map((e) => /* @__PURE__ */ ae("div", {
			className: "pointer-events-auto",
			children: /* @__PURE__ */ ae(c, {
				content: e.content,
				variant: e.variant,
				dismissing: e.dismissing,
				onClose: () => t(e.id)
			})
		}, e.id))
	}), n);
}
function BE({ children: e }) {
	let [t, n] = ee([]), r = d((e) => {
		let t = RE();
		return n((n) => [...n, {
			id: t,
			content: e.content,
			variant: e.variant ?? s.Info,
			life: e.life ?? IE,
			keep: e.keep ?? !1,
			dismissing: !1
		}]), t;
	}, []), i = d((e) => {
		n((t) => {
			let r = t.find((t) => t.id === e);
			return !r || r.dismissing ? t : (setTimeout(() => n((t) => t.filter((t) => t.id !== e)), FE), t.map((t) => t.id === e ? {
				...t,
				dismissing: !0
			} : t));
		});
	}, []), a = d(() => {
		n((e) => e.length === 0 ? e : (setTimeout(() => n((e) => e.filter((e) => !e.dismissing)), FE), e.map((e) => ({
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
	return /* @__PURE__ */ oe(PE.Provider, {
		value: o,
		children: [e, /* @__PURE__ */ ae(zE, {
			toasts: t,
			removeToast: i
		})]
	});
}
function VE() {
	let e = f(PE);
	if (!e) throw Error("useToast must be used within a ToastProvider");
	return e;
}
function HE(e) {
	return e instanceof Error ? e.message : String(e);
}
// src/app/lib/workspaceLink.ts
var UE = /^(https?|ircs?|mailto|xmpp|file)$/i, WE = /^[a-zA-Z]:[\\/]/, GE = /^(https?|mailto|ircs?|xmpp):/i;
function KE(e) {
	let t = String(e ?? "").trim();
	if (!t) return "";
	if (WE.test(t)) return t;
	let n = t.indexOf(":");
	return n === -1 || UE.test(t.slice(0, n)) ? t : "";
}
function qE(e) {
	return e.replace(/\\/g, "/");
}
function JE(e, t) {
	if (!t) return null;
	let n = qE(t).replace(/\/+$/, "");
	return n ? e === n ? "" : e.startsWith(`${n}/`) ? e.slice(n.length + 1) : null : null;
}
function YE(e, t = []) {
	let n = (e ?? "").trim();
	if (!n || n.startsWith("#")) return { kind: "blocked" };
	if (GE.test(n)) return {
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
	r = qE(r);
	for (let e of t) {
		let t = JE(r, e);
		if (t != null) {
			r = t;
			break;
		}
	}
	return r.startsWith("/") || WE.test(r) || (r = r.replace(/^\.\//, ""), !r || r === ".") || r.split("/").includes("..") || r.includes("://") ? { kind: "blocked" } : {
		kind: "workspace",
		path: r
	};
}
// src/app/lib/PerfProfiler.tsx
var XE = (t, n, r) => {
	e(`commit:${t}`, {
		ms: r,
		fields: { phase: n },
		throttleMs: 1e3,
		slowMs: 16
	});
};
function ZE({ id: e, children: t }) {
	return n() ? /* @__PURE__ */ ae(l, {
		id: e,
		onRender: XE,
		children: t
	}) : /* @__PURE__ */ ae(ie, { children: t });
}
export { yT as $, Tp as $n, uC as $t, BT as A, BS as An, lw as At, OT as B, US as Bn, ow as Bt, QT as C, cC as Cn, Ow as Ct, RT as D, KS as Dn, mw as Dt, tE as E, ZS as En, ww as Et, FT as F, iC as Fn, sw as Ft, wT as G, RS as Gn, ew as Gt, kT as H, nC as Hn, JC as Ht, LT as I, aC as In, YC as It, hT as J, Rx as Jn, HC as Jt, DT as K, NS as Kn, QC as Kt, jT as L, oC as Ln, rw as Lt, VT as M, rC as Mn, nw as Mt, IT as N, VS as Nn, $C as Nt, HT as O, QS as On, hw as Ot, MT as P, eC as Pn, ZC as Pt, bT as Q, Ix as Qn, MC as Qt, PT as R, $S as Rn, KC as Rt, ZT as S, hC as Sn, zw as St, qT as T, GS as Tn, Mw as Tt, CT as U, YS as Un, iw as Ut, AT as V, WS as Vn, GC as Vt, TT as W, JS as Wn, tw as Wt, aT as X, Vx as Xn, BC as Xt, gT as Y, zx as Yn, VC as Yt, sT as Z, Fx as Zn, zC as Zt, NE as _, pC as _n, pe as _r, Ww as _t, HE as a, gC as an, be as ar, tT as at, JT as b, xC as bn, Gw as bt, kE as c, wC as cn, ye as cr, Qw as ct, CE as d, EC as dn, ue as dr, fT as dt, bC as en, Ep as er, nT as et, ME as f, kC as fn, ce as fr, rT as ft, OE as g, dC as gn, fe as gr, xT as gt, jE as h, NC as hn, me as hr, cT as ht, BE as i, RC as in, y as ir, iT as it, WT as j, qS as jn, aw as jt, UT as k, zS as kn, qC as kt, AE as l, yC as ln, _e as lr, pT as lt, wE as m, PC as mn, de as mr, dT as mt, YE as n, mC as nn, fi as nr, vT as nt, VE as o, vC as on, xe as or, $w as ot, DE as p, FC as pn, le as pr, lT as pt, ET as q, Lx as qn, cw as qt, KE as r, SC as rn, kn as rr, _T as rt, SE as s, TC as sn, ge as sr, Xw as st, ZE as t, IC as tn, Dp as tr, uT as tt, EE as u, AC as un, ve as ur, mT as ut, TE as v, fC as vn, Yw as vt, YT as w, lC as wn, kw as wt, eE as x, LC as xn, Kw as xt, $T as y, CC as yn, Vw as yt, NT as z, HS as zn, XC as zt };
