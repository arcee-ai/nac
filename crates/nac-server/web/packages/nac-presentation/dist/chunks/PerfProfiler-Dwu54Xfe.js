import { E as e, L as t, T as n, a as r, n as i } from "./RuntimeContext-BG_dqTVV.js";
import { a, y as o } from "./PresentationBoundary-CsyDzkSX.js";
import { n as s, t as c } from "./Toast-miRMAVtc.js";
import { Profiler as l, createContext as u, useCallback as d, useContext as f, useEffect as p, useMemo as m, useRef as ee, useState as te } from "react";
import { keepPreviousData as ne, useInfiniteQuery as re, useMutation as h, useQueries as ie, useQuery as g, useQueryClient as _ } from "@tanstack/react-query";
import { Fragment as ae, jsx as oe, jsxs as se } from "react/jsx-runtime";
import { createPortal as ce } from "react-dom";
// src/app/lib/routes.ts
var le = [
	"sessions",
	"insights",
	"threads",
	"delegated",
	"files",
	"terminal",
	"heartbeats",
	"worksets",
	"history"
], ue = {
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
le.filter((e) => e !== "history");
var de = "insights";
function fe(e) {
	return le.includes(e ?? "");
}
var pe = {
	list: () => "/",
	session: (e, t = de) => `/session/${encodeURIComponent(e)}/${t}`,
	project: (e) => `/project/${encodeURIComponent(e)}`,
	taskSchedules: (e) => e ? `/project/${encodeURIComponent(e)}/task-schedules` : "/task-schedules",
	designPreview: () => "/design"
};
function me(e) {
	let [, t, n] = e.split("/");
	return t !== "session" || !n ? null : decodeURIComponent(n);
}
function he(e) {
	let [, t, n] = e.split("/");
	return t !== "project" || !n ? null : decodeURIComponent(n);
}
// src/app/features/ui-policy/policy.ts
var ge = { orchestrationEnabled: !1 };
function _e(e, t) {
	return e.orchestrationEnabled ? t : "direct";
}
function ve(e, t, n) {
	return e.orchestrationEnabled || t === "direct" && n?.kind !== "managed-orchestrator";
}
function ye(e, t) {
	return t.filter((t) => ve(e, t.summary.behavior, t.lineage));
}
function be(e, t, n) {
	return e.orchestrationEnabled || !t.some((e) => e.lineage == null && e.summary.project_id === n);
}
// src/app/features/ui-policy/UiPolicyContext.ts
var xe = u(ge);
function Se() {
	return f(xe);
}
// src/app/services/queries/keys.ts
var Ce = 5e3, we = 3e4, v = {
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
}, Te = (e) => typeof e == "function", y = function(e, t) {
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
}, b = (e) => e, Ee = (e) => () => e, De = /*#__PURE__*/ Ee(!0), Oe = /*#__PURE__*/ Ee(!1), ke = /*#__PURE__*/ Ee(void 0), Ae = ke;
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
var je = (e) => (t, n) => t === n || e(t, n), Me = /*#__PURE__*/ y(2, (e, t) => je((n, r) => e(t(n), t(r)))), Ne = (e) => je((t, n) => {
	if (t.length !== n.length) return !1;
	for (let r = 0; r < t.length; r++) if (!e(t[r], n[r])) return !1;
	return !0;
}), Pe = "effect/GlobalValue", Fe, S = (e, t) => (Fe ||= (globalThis[Pe] ??= /* @__PURE__ */ new Map(), globalThis[Pe]), Fe.has(e) || Fe.set(e, t()), Fe.get(e)), Ie = (e) => typeof e == "string", Le = (e) => typeof e == "number", Re = (e) => typeof e == "bigint", ze = Te, Be = (e) => typeof e == "object" && !!e, Ve = (e) => Be(e) || ze(e), C = /*#__PURE__*/ y(2, (e, t) => Ve(e) && t in e), He = /*#__PURE__*/ y(2, (e, t) => C(e, "_tag") && e._tag === t), Ue = (e) => e == null, We = (e) => typeof e == "string" || C(e, Symbol.iterator), Ge = (e) => C(e, "then") && ze(e.then), Ke = (e) => `BUG: ${e} - please report an issue at https://github.com/Effect-TS/effect/issues`, qe = class e {
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
}, Je = 335903614, Ye = 4150755663, Xe = 1481765933, Ze = 1284865837, Qe = 9007199254740992, $e = 134217728, et = class {
	_state;
	constructor(e, t, n, r) {
		return Ue(t) && Ue(e) ? (t = Math.random() * 4294967295 >>> 0, e = 0) : Ue(t) && (t = e, e = 0), Ue(r) && Ue(n) ? (r = this._state ? this._state[3] : Ye, n = this._state ? this._state[2] : Je) : Ue(r) && (r = n, n = 0), this._state = new Int32Array([
			0,
			0,
			n >>> 0,
			((r || 0) | 1) >>> 0
		]), this._next(), nt(this._state, this._state[0], this._state[1], e >>> 0, t >>> 0), this._next(), this;
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
		return (e * $e + t) / Qe;
	}
	_next() {
		let e = this._state[0] >>> 0, t = this._state[1] >>> 0;
		tt(this._state, e, t, Xe, Ze), nt(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
		let n = e >>> 18, r = (t >>> 18 | e << 14) >>> 0;
		n = (n ^ e) >>> 0, r = (r ^ t) >>> 0;
		let i = (r >>> 27 | n << 5) >>> 0, a = e >>> 27, o = (-a >>> 0 & 31) >>> 0;
		return (i >>> a | i << o) >>> 0;
	}
};
function tt(e, t, n, r, i) {
	let a = (n >>> 16) * (i & 65535) >>> 0, o = (n & 65535) * (i >>> 16) >>> 0, s = (n & 65535) * (i & 65535) >>> 0, c = (n >>> 16) * (i >>> 16) + ((o >>> 16) + (a >>> 16)) >>> 0;
	o = o << 16 >>> 0, s = s + o >>> 0, s >>> 0 < o >>> 0 && (c = c + 1 >>> 0), a = a << 16 >>> 0, s = s + a >>> 0, s >>> 0 < a >>> 0 && (c = c + 1 >>> 0), c = c + Math.imul(n, r) >>> 0, c = c + Math.imul(t, i) >>> 0, e[0] = c, e[1] = s;
}
function nt(e, t, n, r, i) {
	let a = t + r >>> 0, o = n + i >>> 0;
	o >>> 0 < n >>> 0 && (a = a + 1 | 0), e[0] = a, e[1] = o;
}
var rt = /*#__PURE__*/ Symbol.for("effect/Utils/YieldWrap"), it = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	[rt]() {
		return this.#e;
	}
};
function at(e) {
	if (typeof e == "object" && e && rt in e) return e[rt]();
	throw Error(Ke("yieldWrapGet"));
}
var ot = /*#__PURE__*/ S("effect/Utils/isStructuralRegion", () => ({
	enabled: !1,
	tester: void 0
})), st = { effect_internal_function: (e) => e() }, w = /*#__PURE__*/ st.effect_internal_function(() => (/* @__PURE__ */ Error()).stack)?.includes("effect_internal_function") === !0 ? st.effect_internal_function : { effect_internal_function: (e) => {
	try {
		return e();
	} finally {}
} }.effect_internal_function;
(function* () {}).constructor;
// node_modules/effect/dist/esm/Hash.js
var ct = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Hash/randomHashCache"), () => /* @__PURE__ */ new WeakMap()), T = /*#__PURE__*/ Symbol.for("effect/Hash"), E = (e) => {
	if (ot.enabled === !0) return 0;
	switch (typeof e) {
		case "number": return ft(e);
		case "bigint": return O(e.toString(10));
		case "boolean": return O(String(e));
		case "symbol": return O(String(e));
		case "string": return O(e);
		case "undefined": return O("undefined");
		case "function":
		case "object": return e === null ? O("null") : e instanceof Date ? Number.isNaN(e.getTime()) ? O("Invalid Date") : E(e.toISOString()) : e instanceof URL ? E(e.href) : dt(e) ? e[T]() : lt(e);
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, lt = (e) => (ct.has(e) || ct.set(e, ft(Math.floor(Math.random() * (2 ** 53 - 1)))), ct.get(e)), D = (e) => (t) => t * 53 ^ e, ut = (e) => e & 3221225471 | e >>> 1 & 1073741824, dt = (e) => C(e, T), ft = (e) => {
	if (e !== e || e === Infinity) return 0;
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return ut(t);
}, O = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return ut(t);
}, pt = (e, t) => {
	let n = 12289;
	for (let r = 0; r < t.length; r++) n ^= x(O(t[r]), D(E(e[t[r]])));
	return ut(n);
}, mt = (e) => pt(e, Object.keys(e)), ht = (e) => {
	let t = 6151;
	for (let n = 0; n < e.length; n++) t = x(t, D(E(e[n])));
	return ut(t);
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
	return arguments.length === 1 ? (e) => gt(e, arguments[0]) : gt(arguments[0], arguments[1]);
}
function gt(e, t) {
	if (e === t) return !0;
	let n = typeof e;
	if (n !== typeof t) return !1;
	if (n === "object" || n === "function") {
		if (e !== null && t !== null) {
			if (_t(e) && _t(t)) return E(e) === E(t) && e[A](t) ? !0 : ot.enabled && ot.tester ? ot.tester(e, t) : !1;
			if (e instanceof Date && t instanceof Date) {
				let n = e.getTime(), r = t.getTime();
				return n === r || Number.isNaN(n) && Number.isNaN(r);
			}
			if (e instanceof URL && t instanceof URL) return e.href === t.href;
		}
		if (ot.enabled) {
			if (e === null || t === null) return !1;
			if (Array.isArray(e) && Array.isArray(t)) return e.length === t.length && e.every((e, n) => gt(e, t[n]));
			if (Object.getPrototypeOf(e) === Object.prototype && Object.getPrototypeOf(t) === Object.prototype) {
				let n = Object.keys(e), r = Object.keys(t);
				if (n.length === r.length) {
					for (let r of n) if (!(r in t && gt(e[r], t[r]))) return ot.tester ? ot.tester(e, t) : !1;
					return !0;
				}
			}
			return ot.tester ? ot.tester(e, t) : !1;
		}
	}
	return ot.enabled && ot.tester ? ot.tester(e, t) : !1;
}
var _t = (e) => C(e, A), vt = () => j, M = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), N = (e) => {
	try {
		if (C(e, "toJSON") && ze(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(N);
	} catch {
		return {};
	}
	return Tt(e);
}, P = (e) => JSON.stringify(e, null, 2), yt = (e, t = 2) => {
	if (typeof e == "string") return e;
	try {
		return typeof e == "object" ? bt(e, t) : String(e);
	} catch {
		return String(e);
	}
}, bt = (e, t) => {
	let n = [], r = JSON.stringify(e, (e, t) => typeof t == "object" && t ? n.includes(t) ? void 0 : n.push(t) && (Ct.fiberRefs !== void 0 && St(t) ? t[xt](Ct.fiberRefs) : t) : t, t);
	return n = void 0, r;
}, xt = /*#__PURE__*/ Symbol.for("effect/Inspectable/Redactable"), St = (e) => typeof e == "object" && !!e && xt in e, Ct = /*#__PURE__*/ S("effect/Inspectable/redactableState", () => ({ fiberRefs: void 0 })), wt = (e, t) => {
	let n = Ct.fiberRefs;
	Ct.fiberRefs = e;
	try {
		return t();
	} finally {
		Ct.fiberRefs = n;
	}
}, Tt = (e) => St(e) && Ct.fiberRefs !== void 0 ? e[xt](Ct.fiberRefs) : e, F = (e, t) => {
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
}, Et = "Async", Dt = "Commit", Ot = "Failure", kt = "OnFailure", At = "OnSuccess", jt = "OnSuccessAndFailure", Mt = "Success", Nt = "Sync", Pt = "UpdateRuntimeFlags", Ft = "While", It = "Iterator", Lt = "WithRuntime", Rt = "Yield", zt = "RevertFlags", Bt = "3.22.2", Vt = () => Bt, Ht = /*#__PURE__*/ Symbol.for("effect/Effect"), Ut = /*#__PURE__*/ Symbol.for("effect/Stream"), Wt = /*#__PURE__*/ Symbol.for("effect/Sink"), Gt = /*#__PURE__*/ Symbol.for("effect/Channel"), Kt = {
	/* c8 ignore next */
	_R: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e,
	_V: /*#__PURE__*/ Vt()
}, qt = {
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
}, Jt = {
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
}, Yt = {
	[Ht]: Kt,
	[Ut]: Kt,
	[Wt]: qt,
	[Gt]: Jt,
	[A](e) {
		return this === e;
	},
	[T]() {
		return k(this, lt(this));
	},
	[Symbol.iterator]() {
		return new qe(new it(this));
	},
	pipe() {
		return F(this, arguments);
	}
}, Xt = {
	[T]() {
		return k(this, mt(this));
	},
	[A](e) {
		let t = Object.keys(this), n = Object.keys(e);
		if (t.length !== n.length) return !1;
		for (let n of t) if (!(n in e && j(this[n], e[n]))) return !1;
		return !0;
	}
}, Zt = {
	...Yt,
	_op: Dt
}, Qt = {
	...Zt,
	...Xt
}, $t = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = Zt, e;
}(), en = /*#__PURE__*/ Symbol.for("effect/Option"), tn = {
	...Yt,
	[en]: { _A: (e) => e },
	[M]() {
		return this.toJSON();
	},
	toString() {
		return P(this.toJSON());
	}
}, nn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(tn), {
	_tag: "Some",
	_op: "Some",
	[A](e) {
		return on(e) && cn(e) && j(this.value, e.value);
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
}), rn = /*#__PURE__*/ E("None"), an = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(tn), {
	_tag: "None",
	_op: "None",
	[A](e) {
		return on(e) && sn(e);
	},
	[T]() {
		return rn;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), on = (e) => C(e, en), sn = (e) => e._tag === "None", cn = (e) => e._tag === "Some", ln = /*#__PURE__*/ Object.create(an), un = (e) => {
	let t = Object.create(nn);
	return t.value = e, t;
}, dn = /*#__PURE__*/ Symbol.for("effect/Either"), fn = {
	...Yt,
	[dn]: { _R: (e) => e },
	[M]() {
		return this.toJSON();
	},
	toString() {
		return P(this.toJSON());
	}
}, pn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(fn), {
	_tag: "Right",
	_op: "Right",
	[A](e) {
		return hn(e) && _n(e) && j(this.right, e.right);
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
}), mn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(fn), {
	_tag: "Left",
	_op: "Left",
	[A](e) {
		return hn(e) && gn(e) && j(this.left, e.left);
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
}), hn = (e) => C(e, dn), gn = (e) => e._tag === "Left", _n = (e) => e._tag === "Right", vn = (e) => {
	let t = Object.create(mn);
	return t.left = e, t;
}, yn = (e) => {
	let t = Object.create(pn);
	return t.right = e, t;
}, bn = vn, xn = gn, Sn = _n, Cn = /*#__PURE__*/ (/* @__PURE__ */ y(2, (e, { onLeft: t, onRight: n }) => xn(e) ? t(e.left) : n(e.right)))({
	onLeft: b,
	onRight: b
}), wn = (e) => e.length > 0, Tn = (e) => (t, n) => t === n ? 0 : e(t, n), En = /*#__PURE__*/ Tn((e, t) => e < t ? -1 : 1), Dn = /*#__PURE__*/ y(2, (e, t) => Tn((n, r) => e(t(n), t(r)))), On = (e) => y(2, (t, n) => e(t, n) === 1), I = () => ln, L = un, kn = sn, An = cn, jn = /*#__PURE__*/ y(2, (e, { onNone: t, onSome: n }) => kn(e) ? t() : n(e.value)), Mn = /*#__PURE__*/ y(2, (e, t) => kn(e) ? t() : e.value), Nn = /*#__PURE__*/ y(2, (e, t) => kn(e) ? L(t()) : e), Pn = (e) => e == null ? I() : L(e), Fn = /*#__PURE__*/ Mn(ke), In = /*#__PURE__*/ y(2, (e, t) => kn(e) ? I() : L(t(e.value))), Ln = /*#__PURE__*/ y(2, (e, t) => kn(e) ? I() : t(e.value)), Rn = /*#__PURE__*/ ((e) => y(2, (t, n) => !kn(t) && e(t.value, n)))(/* @__PURE__ */ vt()), zn = (...e) => e, Bn = (e) => Array(e), Vn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.max(1, Math.floor(e)), r = Array(n);
	for (let e = 0; e < n; e++) r[e] = t(e);
	return r;
}), R = (e) => Array.isArray(e) ? e : Array.from(e), Hn = (e) => Array.isArray(e) ? e : [e], Un = /*#__PURE__*/ y(2, (e, t) => [t, ...e]), Wn = /*#__PURE__*/ y(2, (e, t) => [...e, t]), Gn = /*#__PURE__*/ y(2, (e, t) => R(e).concat(R(t)));
Array.isArray;
var Kn = (e) => e.length === 0, qn = wn, Jn = wn, Yn = (e, t) => e < 0 || e >= t.length, Xn = (e, t) => Math.floor(Math.min(Math.max(0, e), t.length)), Zn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.floor(t);
	return Yn(n, e) ? I() : L(e[n]);
}), Qn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.floor(t);
	if (Yn(n, e)) throw Error(`Index ${n} out of bounds`);
	return e[n];
}), $n = /*#__PURE__*/ Zn(0), er = /*#__PURE__*/ Qn(0), tr = (e) => Jn(e) ? L(nr(e)) : I(), nr = (e) => e[e.length - 1], rr = (e) => e.slice(1), ir = (e, t) => {
	let n = 0;
	for (let r of e) {
		if (!t(r, n)) break;
		n++;
	}
	return n;
}, ar = /*#__PURE__*/ y(2, (e, t) => fr(e, ir(e, t))), or = /*#__PURE__*/ y(2, (e, t) => {
	let n = R(e);
	return n.slice(Xn(t, n), n.length);
}), sr = (e) => Array.from(e).reverse(), cr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Array.from(e);
	return n.sort(t), n;
}), lr = /*#__PURE__*/ y(2, (e, t) => ur(e, t, zn)), ur = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = R(e), i = R(t);
	if (Jn(r) && Jn(i)) {
		let e = [n(er(r), er(i))], t = Math.min(r.length, i.length);
		for (let a = 1; a < t; a++) e[a] = n(r[a], i[a]);
		return e;
	}
	return [];
}), dr = /*#__PURE__*/ vt(), fr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Array.from(e), r = Math.floor(t);
	return Jn(n) ? r >= 1 ? pr(n, r) : [[], n] : [n, []];
}), pr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.max(1, Math.floor(t));
	return n >= e.length ? [mr(e), []] : [Un(e.slice(1, n), er(e)), e.slice(n)];
}), mr = (e) => e.slice(), hr = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = R(e), i = R(t);
	return Jn(r) ? Jn(i) ? wr(n)(Gn(r, i)) : r : i;
}), gr = /*#__PURE__*/ y(2, (e, t) => hr(e, t, dr)), _r = () => [], vr = (e) => [e], yr = /*#__PURE__*/ y(2, (e, t) => e.map(t)), br = /*#__PURE__*/ (/* @__PURE__ */ y(2, (e, t) => {
	if (Kn(e)) return [];
	let n = [];
	for (let r = 0; r < e.length; r++) {
		let i = t(e[r], r);
		for (let e = 0; e < i.length; e++) n.push(i[e]);
	}
	return n;
}))(b), xr = /*#__PURE__*/ y(3, (e, t, n) => R(e).reduce((e, t, r) => n(e, t, r), t)), Sr = (e, t) => {
	let n = [], r = e, i;
	for (; An(i = t(r));) {
		let [e, t] = i.value;
		n.push(e), r = t;
	}
	return n;
}, Cr = Ne, wr = /*#__PURE__*/ y(2, (e, t) => {
	let n = R(e);
	if (Jn(n)) {
		let e = [er(n)], r = rr(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), Tr = (e) => wr(e, vt()), Er = /*#__PURE__*/ y(2, (e, t) => R(e).join(t)), Dr = En, Or = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"), kr = /*#__PURE__*/ Symbol.for("effect/Context/Tag"), Ar = /*#__PURE__*/ Symbol.for("effect/Context/Reference"), jr = /*#__PURE__*/ Symbol.for("effect/STM"), Mr = {
	...Yt,
	_op: "Tag",
	[jr]: Kt,
	[kr]: {
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
		return Kr(this, e);
	}
}, Nr = {
	...Mr,
	[Ar]: Ar
}, Pr = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	let r = Object.create(Mr);
	return Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r.key = e, r;
}, Fr = (e) => () => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	function r() {}
	return Object.setPrototypeOf(r, Mr), r.key = e, Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r;
}, Ir = () => (e, t) => {
	let n = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let r = /* @__PURE__ */ Error();
	Error.stackTraceLimit = n;
	function i() {}
	return Object.setPrototypeOf(i, Nr), i.key = e, i.defaultValue = t.defaultValue, Object.defineProperty(i, "stack", { get() {
		return r.stack;
	} }), i;
}, Lr = /*#__PURE__*/ Symbol.for("effect/Context"), Rr = {
	[Lr]: { _Services: (e) => e },
	[A](e) {
		if (Vr(e) && this.unsafeMap.size === e.unsafeMap.size) {
			for (let t of this.unsafeMap.keys()) if (!e.unsafeMap.has(t) || !j(this.unsafeMap.get(t), e.unsafeMap.get(t))) return !1;
			return !0;
		}
		return !1;
	},
	[T]() {
		return k(this, ft(this.unsafeMap.size));
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
}, zr = (e) => {
	let t = Object.create(Rr);
	return t.unsafeMap = e, t;
}, Br = (e) => {
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
}, Vr = (e) => C(e, Lr), Hr = (e) => C(e, kr), Ur = (e) => C(e, Ar), Wr = /*#__PURE__*/ zr(/*#__PURE__*/ new Map()), Gr = () => Wr, Kr = (e, t) => zr(/* @__PURE__ */ new Map([[e.key, t]])), qr = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = new Map(e.unsafeMap);
	return r.set(t.key, n), zr(r);
}), Jr = /*#__PURE__*/ S("effect/Context/defaultValueCache", () => /* @__PURE__ */ new Map()), Yr = (e) => {
	if (Jr.has(e.key)) return Jr.get(e.key);
	let t = e.defaultValue();
	return Jr.set(e.key, t), t;
}, Xr = (e, t) => e.unsafeMap.has(t.key) ? e.unsafeMap.get(t.key) : Yr(t), Zr = /*#__PURE__*/ y(2, (e, t) => {
	if (!e.unsafeMap.has(t.key)) {
		if (Ar in t) return Yr(t);
		throw Br(t);
	}
	return e.unsafeMap.get(t.key);
}), Qr = Zr, $r = /*#__PURE__*/ y(2, (e, t) => e.unsafeMap.has(t.key) ? un(e.unsafeMap.get(t.key)) : Ur(t) ? un(Yr(t)) : ln), ei = /*#__PURE__*/ y(2, (e, t) => {
	let n = new Map(e.unsafeMap);
	for (let [e, r] of t.unsafeMap) n.set(e, r);
	return zr(n);
}), ti = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n = 0; n < e.length; n++) e[n].unsafeMap.forEach((e, n) => {
		t.set(n, e);
	});
	return zr(t);
}, ni = Pr, ri = Vr, ii = Hr, ai = Gr, oi = Kr, si = qr, ci = Qr, li = Zr, ui = $r, di = ei, fi = ti, pi = Fr, mi = Ir, hi = /*#__PURE__*/ Symbol.for("effect/Chunk");
function gi(e, t, n, r, i) {
	for (let a = t; a < Math.min(e.length, t + i); a++) n[r + a - t] = e[a];
	return n;
}
var _i = [], vi = /*#__PURE__*/ ((e) => je((t, n) => t.length === n.length && Di(t).every((t, r) => e(t, Mi(n, r)))))(j), yi = {
	[hi]: { _A: (e) => e },
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Chunk",
			values: Di(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	[A](e) {
		return bi(e) && vi(this, e);
	},
	[T]() {
		return k(this, ht(Di(this)));
	},
	[Symbol.iterator]() {
		switch (this.backing._tag) {
			case "IArray": return this.backing.array[Symbol.iterator]();
			case "IEmpty": return _i[Symbol.iterator]();
			default: return Di(this)[Symbol.iterator]();
		}
	},
	pipe() {
		return F(this, arguments);
	}
}, z = (e) => {
	let t = Object.create(yi);
	switch (t.backing = e, e._tag) {
		case "IEmpty":
			t.length = 0, t.depth = 0, t.left = t, t.right = t;
			break;
		case "IConcat":
			t.length = e.left.length + e.right.length, t.depth = 1 + Math.max(e.left.depth, e.right.depth), t.left = e.left, t.right = e.right;
			break;
		case "IArray":
			t.length = e.array.length, t.depth = 0, t.left = xi, t.right = xi;
			break;
		case "ISingleton":
			t.length = 1, t.depth = 0, t.left = xi, t.right = xi;
			break;
		case "ISlice": t.length = e.length, t.depth = e.chunk.depth + 1, t.left = xi, t.right = xi;
	}
	return t;
}, bi = (e) => C(e, hi), xi = /*#__PURE__*/ z({ _tag: "IEmpty" }), Si = () => xi, Ci = (...e) => ji(e), wi = (e) => z({
	_tag: "ISingleton",
	a: e
}), Ti = (e) => bi(e) ? e : Ai(R(e)), Ei = (e, t, n) => {
	switch (e.backing._tag) {
		case "IArray":
			gi(e.backing.array, 0, t, n, e.length);
			break;
		case "IConcat":
			Ei(e.left, t, n), Ei(e.right, t, n + e.left.length);
			break;
		case "ISingleton":
			t[n] = e.backing.a;
			break;
		case "ISlice": {
			let r = 0, i = n;
			for (; r < e.length;) t[i] = Mi(e, r), r += 1, i += 1;
			break;
		}
	}
}, Di = (e) => {
	switch (e.backing._tag) {
		case "IEmpty": return _i;
		case "IArray": return e.backing.array;
		default: {
			let t = Array(e.length);
			return Ei(e, t, 0), e.backing = {
				_tag: "IArray",
				array: t
			}, e.left = xi, e.right = xi, e.depth = 0, t;
		}
	}
}, Oi = (e) => {
	switch (e.backing._tag) {
		case "IEmpty":
		case "ISingleton": return e;
		case "IArray": return z({
			_tag: "IArray",
			array: sr(e.backing.array)
		});
		case "IConcat": return z({
			_tag: "IConcat",
			left: Oi(e.backing.right),
			right: Oi(e.backing.left)
		});
		case "ISlice": return Ai(sr(Di(e)));
	}
}, ki = /*#__PURE__*/ y(2, (e, t) => t < 0 || t >= e.length ? I() : L(Mi(e, t))), Ai = (e) => e.length === 0 ? Si() : e.length === 1 ? wi(e[0]) : z({
	_tag: "IArray",
	array: e
}), ji = (e) => Ai(e), Mi = /*#__PURE__*/ y(2, (e, t) => {
	switch (e.backing._tag) {
		case "IEmpty": throw Error("Index out of bounds");
		case "ISingleton":
			if (t !== 0) throw Error("Index out of bounds");
			return e.backing.a;
		case "IArray":
			if (t >= e.length || t < 0) throw Error("Index out of bounds");
			return e.backing.array[t];
		case "IConcat": return t < e.left.length ? Mi(e.left, t) : Mi(e.right, t - e.left.length);
		case "ISlice": return Mi(e.backing.chunk, t + e.backing.offset);
	}
}), Ni = /*#__PURE__*/ y(2, (e, t) => Ii(e, wi(t))), Pi = /*#__PURE__*/ y(2, (e, t) => Ii(wi(t), e)), Fi = /*#__PURE__*/ y(2, (e, t) => {
	if (t <= 0) return e;
	if (t >= e.length) return xi;
	switch (e.backing._tag) {
		case "ISlice": return z({
			_tag: "ISlice",
			chunk: e.backing.chunk,
			offset: e.backing.offset + t,
			length: e.backing.length - t
		});
		case "IConcat": return t > e.left.length ? Fi(e.right, t - e.left.length) : z({
			_tag: "IConcat",
			left: Fi(e.left, t),
			right: e.right
		});
		default: return z({
			_tag: "ISlice",
			chunk: e,
			offset: t,
			length: e.length - t
		});
	}
}), Ii = /*#__PURE__*/ y(2, (e, t) => {
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
			let n = Ii(e.right, t);
			return z({
				_tag: "IConcat",
				left: e.left,
				right: n
			});
		}
		{
			let n = Ii(e.right.right, t);
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
		left: Ii(e, t.left),
		right: t.right
	});
	{
		let n = Ii(e, t.left.left);
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
}), Li = (e) => e.length === 0, Ri = (e) => e.length > 0, zi = /*#__PURE__*/ ki(0), Bi = (e) => Mi(e, 0), Vi = Bi, Hi = (e) => Fi(e, 1), Ui = /*#__PURE__*/ Symbol.for("effect/Duration"), Wi = /*#__PURE__*/ BigInt(0), Gi = /*#__PURE__*/ BigInt(24), Ki = /*#__PURE__*/ BigInt(60), qi = /*#__PURE__*/ BigInt(1e3), Ji = /*#__PURE__*/ BigInt(1e6), Yi = /*#__PURE__*/ BigInt(1e9), Xi = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Zi = (e) => {
	if (na(e)) return e;
	if (Le(e)) return ca(e);
	if (Re(e)) return oa(e);
	if (Array.isArray(e) && e.length === 2 && e.every(Le)) return e[0] === -Infinity || e[1] === -Infinity || Number.isNaN(e[0]) || Number.isNaN(e[1]) ? ia : e[0] === Infinity || e[1] === Infinity ? aa : oa(BigInt(Math.round(e[0] * 1e9)) + BigInt(Math.round(e[1])));
	if (Ie(e)) {
		let t = Xi.exec(e);
		if (t) {
			let [e, n, r] = t, i = Number(n);
			switch (r) {
				case "nano":
				case "nanos": return oa(BigInt(n));
				case "micro":
				case "micros": return sa(BigInt(n));
				case "milli":
				case "millis": return ca(i);
				case "second":
				case "seconds": return la(i);
				case "minute":
				case "minutes": return ua(i);
				case "hour":
				case "hours": return da(i);
				case "day":
				case "days": return fa(i);
				case "week":
				case "weeks": return pa(i);
			}
		}
	}
	throw Error("Invalid DurationInput");
}, Qi = {
	_tag: "Millis",
	millis: 0
}, $i = { _tag: "Infinity" }, ea = {
	[Ui]: Ui,
	[T]() {
		return k(this, mt(this.value));
	},
	[A](e) {
		return na(e) && Sa(this, e);
	},
	toString() {
		return `Duration(${wa(this)})`;
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
				hrtime: ga(this)
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
}, ta = (e) => {
	let t = Object.create(ea);
	return t.value = Le(e) ? isNaN(e) || e <= 0 ? Qi : Number.isFinite(e) ? Number.isInteger(e) ? {
		_tag: "Millis",
		millis: e
	} : {
		_tag: "Nanos",
		nanos: BigInt(Math.round(e * 1e6))
	} : $i : e <= Wi ? Qi : {
		_tag: "Nanos",
		nanos: e
	}, t;
}, na = (e) => C(e, Ui), ra = (e) => {
	switch (e.value._tag) {
		case "Millis": return e.value.millis === 0;
		case "Nanos": return e.value.nanos === Wi;
		case "Infinity": return !1;
	}
}, ia = /*#__PURE__*/ ta(0), aa = /*#__PURE__*/ ta(Infinity), oa = (e) => ta(e), sa = (e) => ta(e * qi), ca = (e) => ta(e), la = (e) => ta(e * 1e3), ua = (e) => ta(e * 6e4), da = (e) => ta(e * 36e5), fa = (e) => ta(e * 864e5), pa = (e) => ta(e * 6048e5), ma = (e) => _a(e, {
	onMillis: (e) => e,
	onNanos: (e) => Number(e) / 1e6
}), ha = (e) => {
	let t = Zi(e);
	switch (t.value._tag) {
		case "Infinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return BigInt(Math.round(t.value.millis * 1e6));
	}
}, ga = (e) => {
	let t = Zi(e);
	switch (t.value._tag) {
		case "Infinity": return [Infinity, 0];
		case "Nanos": return [Number(t.value.nanos / Yi), Number(t.value.nanos % Yi)];
		case "Millis": return [Math.floor(t.value.millis / 1e3), Math.round(t.value.millis % 1e3 * 1e6)];
	}
}, _a = /*#__PURE__*/ y(2, (e, t) => {
	let n = Zi(e);
	switch (n.value._tag) {
		case "Nanos": return t.onNanos(n.value.nanos);
		case "Infinity": return t.onMillis(Infinity);
		case "Millis": return t.onMillis(n.value.millis);
	}
}), va = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = Zi(e), i = Zi(t);
	if (r.value._tag === "Infinity" || i.value._tag === "Infinity") return n.onMillis(ma(r), ma(i));
	if (r.value._tag === "Nanos" || i.value._tag === "Nanos") {
		let e = r.value._tag === "Nanos" ? r.value.nanos : BigInt(Math.round(r.value.millis * 1e6)), t = i.value._tag === "Nanos" ? i.value.nanos : BigInt(Math.round(i.value.millis * 1e6));
		return n.onNanos(e, t);
	}
	return n.onMillis(r.value.millis, i.value.millis);
}), ya = (e, t) => va(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t
}), ba = /*#__PURE__*/ y(2, (e, t) => va(e, t, {
	onMillis: (e, t) => e <= t,
	onNanos: (e, t) => e <= t
})), xa = /*#__PURE__*/ y(2, (e, t) => va(e, t, {
	onMillis: (e, t) => e >= t,
	onNanos: (e, t) => e >= t
})), Sa = /*#__PURE__*/ y(2, (e, t) => ya(Zi(e), Zi(t))), Ca = (e) => {
	let t = Zi(e);
	if (t.value._tag === "Infinity") return {
		days: Infinity,
		hours: Infinity,
		minutes: Infinity,
		seconds: Infinity,
		millis: Infinity,
		nanos: Infinity
	};
	let n = ha(t), r = n / Ji, i = r / qi, a = i / Ki, o = a / Ki, s = o / Gi;
	return {
		days: Number(s),
		hours: Number(o % Gi),
		minutes: Number(a % Ki),
		seconds: Number(i % Ki),
		millis: Number(r % qi),
		nanos: Number(n % Ji)
	};
}, wa = (e) => {
	let t = Zi(e);
	if (t.value._tag === "Infinity") return "Infinity";
	if (ra(t)) return "0";
	let n = Ca(t), r = [];
	return n.days !== 0 && r.push(`${n.days}d`), n.hours !== 0 && r.push(`${n.hours}h`), n.minutes !== 0 && r.push(`${n.minutes}m`), n.seconds !== 0 && r.push(`${n.seconds}s`), n.millis !== 0 && r.push(`${n.millis}ms`), n.nanos !== 0 && r.push(`${n.nanos}ns`), r.join(" ");
}, Ta = 32, Ea = Ta - 1, Da = Ta / 2, Oa = Ta / 4;
// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function ka(e) {
	return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), e = e + (e >> 4) & 252645135, e += e >> 8, e += e >> 16, e & 127;
}
function Aa(e, t) {
	return t >>> e & Ea;
}
function ja(e) {
	return 1 << e;
}
function Ma(e, t) {
	return ka(e & t - 1);
}
// node_modules/effect/dist/esm/internal/stack.js
var Na = (e, t) => ({
	value: e,
	previous: t
});
// node_modules/effect/dist/esm/internal/hashMap/array.js
function Pa(e, t, n, r) {
	let i = r;
	if (!e) {
		let e = r.length;
		i = Array(e);
		for (let t = 0; t < e; ++t) i[t] = r[t];
	}
	return i[t] = n, i;
}
function Fa(e, t, n) {
	let r = n.length - 1, i = 0, a = 0, o = n;
	if (e) i = a = t;
	else for (o = Array(r); i < t;) o[a++] = n[i++];
	for (++i; i <= r;) o[a++] = n[i++];
	return e && (o.length = r), o;
}
function Ia(e, t, n, r) {
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
var La = class e {
	_tag = "EmptyNode";
	modify(t, n, r, i, a, o) {
		let s = r(I());
		return kn(s) ? new e() : (++o.value, new Va(t, i, a, s));
	}
};
function Ra(e) {
	return He(e, "EmptyNode");
}
function za(e) {
	return Ra(e) || e._tag === "LeafNode" || e._tag === "CollisionNode";
}
function Ba(e, t) {
	return !Ra(e) && t === e.edit;
}
var Va = class e {
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
			return n === this.value ? this : kn(n) ? (--o.value, new La()) : Ba(this, t) ? (this.value = n, this) : new e(t, i, a, n);
		}
		let s = r(I());
		return kn(s) ? this : (++o.value, Ja(t, n, this.hash, this, i, new e(t, i, a, s)));
	}
}, Ha = class e {
	edit;
	hash;
	children;
	_tag = "CollisionNode";
	constructor(e, t, n) {
		this.edit = e, this.hash = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		if (i === this.hash) {
			let n = Ba(this, t), i = this.updateCollisionList(n, t, this.hash, this.children, r, a, o);
			return i === this.children ? this : i.length > 1 ? new e(t, this.hash, i) : i[0];
		}
		let s = r(I());
		return kn(s) ? this : (++o.value, Ja(t, n, this.hash, this, i, new Va(t, i, a, s)));
	}
	updateCollisionList(e, t, n, r, i, a, o) {
		let s = r.length;
		for (let c = 0; c < s; ++c) {
			let s = r[c];
			if ("key" in s && j(a, s.key)) {
				let l = s.value, u = i(l);
				return u === l ? r : kn(u) ? (--o.value, Fa(e, c, r)) : Pa(e, c, new Va(t, n, a, u), r);
			}
		}
		let c = i(I());
		return kn(c) ? r : (++o.value, Pa(e, s, new Va(t, n, a, c), r));
	}
}, Ua = class e {
	edit;
	mask;
	children;
	_tag = "IndexedNode";
	constructor(e, t, n) {
		this.edit = e, this.mask = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.mask, c = this.children, l = Aa(n, i), u = ja(l), d = Ma(s, u), f = s & u, p = Ba(this, t);
		if (!f) {
			let f = new La().modify(t, n + 5, r, i, a, o);
			return f ? c.length >= Da ? Ka(t, l, f, s, c) : new e(t, s | u, Ia(p, d, f, c)) : this;
		}
		let m = c[d], ee = m.modify(t, n + 5, r, i, a, o);
		if (m === ee) return this;
		let te = s, ne;
		if (Ra(ee)) {
			if (te &= ~u, !te) return new La();
			if (c.length <= 2 && za(c[d ^ 1])) return c[d ^ 1];
			ne = Fa(p, d, c);
		} else ne = Pa(p, d, ee, c);
		return p ? (this.mask = te, this.children = ne, this) : new e(t, te, ne);
	}
}, Wa = class e {
	edit;
	size;
	children;
	_tag = "ArrayNode";
	constructor(e, t, n) {
		this.edit = e, this.size = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.size, c = this.children, l = Aa(n, i), u = c[l], d = (u || new La()).modify(t, n + 5, r, i, a, o);
		if (u === d) return this;
		let f = Ba(this, t), p;
		if (Ra(u) && !Ra(d)) ++s, p = Pa(f, l, d, c);
		else if (!Ra(u) && Ra(d)) {
			if (--s, s <= Oa) return Ga(t, s, l, c);
			p = Pa(f, l, new La(), c);
		} else p = Pa(f, l, d, c);
		return f ? (this.size = s, this.children = p, this) : new e(t, s, p);
	}
};
function Ga(e, t, n, r) {
	let i = Array(t - 1), a = 0, o = 0;
	for (let e = 0, t = r.length; e < t; ++e) if (e !== n) {
		let t = r[e];
		t && !Ra(t) && (i[a++] = t, o |= 1 << e);
	}
	return new Ua(e, o, i);
}
function Ka(e, t, n, r, i) {
	let a = [], o = r, s = 0;
	for (let e = 0; o; ++e) o & 1 && (a[e] = i[s++]), o >>>= 1;
	return a[t] = n, new Wa(e, s + 1, a);
}
function qa(e, t, n, r, i, a) {
	if (n === i) return new Ha(e, n, [a, r]);
	let o = Aa(t, n), s = Aa(t, i);
	if (o === s) return (t) => new Ua(e, ja(o) | ja(s), [t]);
	{
		let t = o < s ? [r, a] : [a, r];
		return new Ua(e, ja(o) | ja(s), t);
	}
}
function Ja(e, t, n, r, i, a) {
	let o, s = t;
	for (;;) {
		let t = qa(e, s, n, r, i, a);
		if (typeof t == "function") o = Na(t, o), s += 5;
		else {
			let e = t;
			for (; o != null;) e = o.value(e), o = o.previous;
			return e;
		}
	}
}
// node_modules/effect/dist/esm/internal/hashMap.js
var Ya = "effect/HashMap", Xa = /*#__PURE__*/ Symbol.for(Ya), Za = {
	[Xa]: Xa,
	[Symbol.iterator]() {
		return new $a(this, (e, t) => [e, t]);
	},
	[T]() {
		let e = E(Ya);
		for (let t of this) e ^= x(E(t[0]), D(E(t[1])));
		return k(this, e);
	},
	[A](e) {
		if (oo(e)) {
			if (e._size !== this._size) return !1;
			for (let t of this) {
				let n = x(e, lo(t[0], E(t[0])));
				if (kn(n) || !j(t[1], n.value)) return !1;
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
}, Qa = (e, t, n, r) => {
	let i = Object.create(Za);
	return i._editable = e, i._edit = t, i._root = n, i._size = r, i;
}, $a = class e {
	map;
	f;
	v;
	constructor(e, t) {
		this.map = e, this.f = t, this.v = to(this.map._root, this.f, void 0);
	}
	next() {
		if (kn(this.v)) return {
			done: !0,
			value: void 0
		};
		let e = this.v.value;
		return this.v = eo(e.cont), {
			done: !1,
			value: e.value
		};
	}
	[Symbol.iterator]() {
		return new e(this.map, this.f);
	}
}, eo = (e) => e ? no(e[0], e[1], e[2], e[3], e[4]) : I(), to = (e, t, n = void 0) => {
	switch (e._tag) {
		case "LeafNode": return An(e.value) ? L({
			value: t(e.key, e.value.value),
			cont: n
		}) : eo(n);
		case "CollisionNode":
		case "ArrayNode":
		case "IndexedNode": {
			let r = e.children;
			return no(r.length, r, 0, t, n);
		}
		default: return eo(n);
	}
}, no = (e, t, n, r, i) => {
	for (; n < e;) {
		let a = t[n++];
		if (a && !Ra(a)) return to(a, r, [
			e,
			t,
			n,
			r,
			i
		]);
	}
	return eo(i);
}, ro = /*#__PURE__*/ Qa(!1, 0, /*#__PURE__*/ new La(), 0), io = () => ro, ao = (e) => {
	let t = go(io());
	for (let n of e) fo(t, n[0], n[1]);
	return _o(t);
}, oo = (e) => C(e, Xa), so = (e) => e && Ra(e._root), co = /*#__PURE__*/ y(2, (e, t) => lo(e, t, E(t))), lo = /*#__PURE__*/ y(3, (e, t, n) => {
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
			let e = ja(Aa(i, n));
			if (r.mask & e) {
				r = r.children[Ma(r.mask, e)], i += 5;
				break;
			}
			return I();
		}
		case "ArrayNode":
			if (r = r.children[Aa(i, n)], r) {
				i += 5;
				break;
			}
			return I();
		default: return I();
	}
}), uo = /*#__PURE__*/ y(2, (e, t) => An(lo(e, t, E(t)))), fo = /*#__PURE__*/ y(3, (e, t, n) => vo(e, t, () => L(n))), po = /*#__PURE__*/ y(3, (e, t, n) => e._editable ? (e._root = t, e._size = n, e) : t === e._root ? e : Qa(e._editable, e._edit, t, n)), mo = (e) => new $a(e, (e) => e), ho = (e) => e._size, go = (e) => Qa(!0, e._edit + 1, e._root, e._size), _o = (e) => (e._editable = !1, e), vo = /*#__PURE__*/ y(3, (e, t, n) => yo(e, t, E(t), n)), yo = /*#__PURE__*/ y(4, (e, t, n, r) => {
	let i = { value: e._size };
	return x(e, po(e._root.modify(e._editable ? e._edit : NaN, 0, r, n, t, i), i.value));
}), bo = /*#__PURE__*/ y(2, (e, t) => vo(e, t, I)), xo = /*#__PURE__*/ y(2, (e, t) => Co(e, io(), (e, n, r) => fo(e, r, t(n, r)))), So = /*#__PURE__*/ y(2, (e, t) => Co(e, void 0, (e, n, r) => t(n, r))), Co = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = e._root;
	if (r._tag === "LeafNode") return An(r.value) ? n(t, r.value.value, r.key) : t;
	if (r._tag === "EmptyNode") return t;
	let i = [r.children], a;
	for (; a = i.pop();) for (let e = 0, r = a.length; e < r;) {
		let r = a[e++];
		r && !Ra(r) && (r._tag === "LeafNode" ? An(r.value) && (t = n(t, r.value.value, r.key)) : i.push(r.children));
	}
	return t;
}), wo = "effect/HashSet", To = /*#__PURE__*/ Symbol.for(wo), Eo = {
	[To]: To,
	[Symbol.iterator]() {
		return mo(this._keyMap);
	},
	[T]() {
		return k(this, D(E(this._keyMap))(E(wo)));
	},
	[A](e) {
		return Oo(e) ? ho(this._keyMap) === ho(e._keyMap) && j(this._keyMap, e._keyMap) : !1;
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
}, Do = (e) => {
	let t = Object.create(Eo);
	return t._keyMap = e, t;
}, Oo = (e) => C(e, To), ko = /*#__PURE__*/ Do(/*#__PURE__*/ io()), Ao = () => ko, jo = (e) => {
	let t = Fo(Ao());
	for (let n of e) Ro(t, n);
	return Io(t);
}, Mo = (...e) => {
	let t = Fo(Ao());
	for (let n of e) Ro(t, n);
	return Io(t);
}, No = /*#__PURE__*/ y(2, (e, t) => uo(e._keyMap, t)), Po = (e) => ho(e._keyMap), Fo = (e) => Do(go(e._keyMap)), Io = (e) => (e._keyMap._editable = !1, e), Lo = /*#__PURE__*/ y(2, (e, t) => {
	let n = Fo(e);
	return t(n), Io(n);
}), Ro = /*#__PURE__*/ y(2, (e, t) => e._keyMap._editable ? (fo(t, !0)(e._keyMap), e) : Do(fo(t, !0)(e._keyMap))), zo = /*#__PURE__*/ y(2, (e, t) => e._keyMap._editable ? (bo(t)(e._keyMap), e) : Do(bo(t)(e._keyMap))), Bo = /*#__PURE__*/ y(2, (e, t) => Lo(e, (e) => {
	for (let n of t) zo(e, n);
})), Vo = /*#__PURE__*/ y(2, (e, t) => Lo(Ao(), (n) => {
	Ho(e, (e) => Ro(n, e));
	for (let e of t) Ro(n, e);
})), Ho = /*#__PURE__*/ y(2, (e, t) => So(e._keyMap, (e, n) => t(n))), Uo = /*#__PURE__*/ y(3, (e, t, n) => Co(e._keyMap, t, (e, t, r) => n(e, r))), Wo = Ao, Go = jo, Ko = Mo, qo = No, Jo = Po, Yo = Ro, Xo = zo, Zo = Bo, Qo = Vo, $o = Uo, es = /*#__PURE__*/ Symbol.for("effect/MutableRef"), ts = {
	[es]: es,
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
}, ns = (e) => {
	let t = Object.create(ts);
	return t.current = e, t;
}, rs = (e) => e.current, is = /*#__PURE__*/ y(2, (e, t) => (e.current = t, e)), as = "effect/FiberId", os = /*#__PURE__*/ Symbol.for(as), ss = "None", cs = "Runtime", ls = "Composite", us = /*#__PURE__*/ O(`${as}-${ss}`), ds = class {
	[os] = os;
	_tag = ss;
	id = -1;
	startTimeMillis = -1;
	[T]() {
		return us;
	}
	[A](e) {
		return ms(e) && e._tag === ss;
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
}, fs = class {
	id;
	startTimeMillis;
	[os] = os;
	_tag = cs;
	constructor(e, t) {
		this.id = e, this.startTimeMillis = t;
	}
	[T]() {
		return k(this, O(`${as}-${this._tag}-${this.id}-${this.startTimeMillis}`));
	}
	[A](e) {
		return ms(e) && e._tag === cs && this.id === e.id && this.startTimeMillis === e.startTimeMillis;
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
}, ps = /*#__PURE__*/ new ds(), ms = (e) => C(e, os), hs = (e) => {
	switch (e._tag) {
		case ss: return Wo();
		case cs: return Ko(e.id);
		case ls: return x(hs(e.left), Qo(hs(e.right)));
	}
}, gs = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => ns(0)), _s = (e) => Array.from(hs(e)).map((e) => `#${e}`).join(","), vs = () => {
	let e = rs(gs);
	return x(gs, is(e + 1)), new fs(e, Date.now());
}, ys = ps, bs = hs, xs = _s, Ss = vs, Cs = io, ws = ao, Ts = so, Es = co, Ds = fo, Os = mo, ks = vo, As = xo, js = Co, Ms = /*#__PURE__*/ Symbol.for("effect/List"), Ns = (e) => R(e), Ps = /*#__PURE__*/ ((e) => Me(Cr(e), Ns))(j), Fs = {
	[Ms]: Ms,
	_tag: "Cons",
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Cons",
			values: Ns(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	[A](e) {
		return zs(e) && this._tag === e._tag && Ps(this, e);
	},
	[T]() {
		return k(this, ht(Ns(this)));
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
}, Is = (e, t) => {
	let n = Object.create(Fs);
	return n.head = e, n.tail = t, n;
}, Ls = /*#__PURE__*/ O("Nil"), Rs = /*#__PURE__*/ Object.create({
	[Ms]: Ms,
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
		return Ls;
	},
	[A](e) {
		return zs(e) && this._tag === e._tag;
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
}), zs = (e) => C(e, Ms), Bs = (e) => e._tag === "Nil", Vs = (e) => e._tag === "Cons", Hs = () => Rs, Us = (e, t) => Is(e, t), Ws = Hs, Gs = (e) => Is(e, Rs), Ks = /*#__PURE__*/ y(2, (e, t) => Js(t, e)), qs = /*#__PURE__*/ y(2, (e, t) => Us(t, e)), Js = /*#__PURE__*/ y(2, (e, t) => {
	if (Bs(e)) return t;
	if (Bs(t)) return e;
	{
		let n = Is(t.head, e), r = n, i = t.tail;
		for (; !Bs(i);) {
			let t = Is(i.head, e);
			r.tail = t, r = t, i = i.tail;
		}
		return n;
	}
}), Ys = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = t, i = e;
	for (; !Bs(i);) r = n(r, i.head), i = i.tail;
	return r;
}), Xs = (e) => {
	let t = Ws(), n = e;
	for (; !Bs(n);) t = qs(t, n.head), n = n.tail;
	return t;
};
Array.prototype;
var Zs = /*#__PURE__*/ function() {
	function e(e) {
		e && Object.assign(this, e);
	}
	return e.prototype = Xt, e;
}(), Qs = /*#__PURE__*/ Symbol.for("effect/DifferContextPatch");
function $s(e) {
	return e;
}
var ec = {
	...Zs.prototype,
	[Qs]: {
		_Value: $s,
		_Patch: $s
	}
}, tc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(ec), { _tag: "Empty" })), nc = () => tc, rc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(ec), { _tag: "AndThen" }), ic = (e, t) => {
	let n = Object.create(rc);
	return n.first = e, n.second = t, n;
}, ac = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(ec), { _tag: "AddService" }), oc = (e, t) => {
	let n = Object.create(ac);
	return n.key = e, n.service = t, n;
}, sc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(ec), { _tag: "RemoveService" }), cc = (e) => {
	let t = Object.create(sc);
	return t.key = e, t;
}, lc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(ec), { _tag: "UpdateService" }), uc = (e, t) => {
	let n = Object.create(lc);
	return n.key = e, n.update = t, n;
}, dc = (e, t) => {
	let n = new Map(e.unsafeMap), r = nc();
	for (let [e, i] of t.unsafeMap.entries()) if (n.has(e)) {
		let t = n.get(e);
		n.delete(e), j(t, i) || (r = fc(uc(e, () => i))(r));
	} else n.delete(e), r = fc(oc(e, i))(r);
	for (let [e] of n.entries()) r = fc(cc(e))(r);
	return r;
}, fc = /*#__PURE__*/ y(2, (e, t) => ic(e, t)), pc = /*#__PURE__*/ y(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = !1, r = wi(e), i = new Map(t.unsafeMap);
	for (; Ri(r);) {
		let e = Vi(r), t = Hi(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AddService":
				i.set(e.key, e.service), r = t;
				break;
			case "AndThen":
				r = Pi(Pi(t, e.second), e.first);
				break;
			case "RemoveService":
				i.delete(e.key), r = t;
				break;
			case "UpdateService": i.set(e.key, e.update(i.get(e.key))), n = !0, r = t;
		}
	}
	if (!n) return zr(i);
	let a = /* @__PURE__ */ new Map();
	for (let [e] of t.unsafeMap) i.has(e) && (a.set(e, i.get(e)), i.delete(e));
	for (let [e, t] of i) a.set(e, t);
	return zr(a);
}), mc = /*#__PURE__*/ Symbol.for("effect/DifferHashSetPatch");
function hc(e) {
	return e;
}
var gc = {
	...Zs.prototype,
	[mc]: {
		_Value: hc,
		_Key: hc,
		_Patch: hc
	}
}, _c = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(gc), { _tag: "Empty" })), vc = () => _c, yc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(gc), { _tag: "AndThen" }), bc = (e, t) => {
	let n = Object.create(yc);
	return n.first = e, n.second = t, n;
}, xc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(gc), { _tag: "Add" }), Sc = (e) => {
	let t = Object.create(xc);
	return t.value = e, t;
}, Cc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(gc), { _tag: "Remove" }), wc = (e) => {
	let t = Object.create(Cc);
	return t.value = e, t;
}, Tc = (e, t) => {
	let [n, r] = $o([e, vc()], ([e, t], n) => qo(n)(e) ? [Xo(n)(e), t] : [e, Ec(Sc(n))(t)])(t);
	return $o(r, (e, t) => Ec(wc(t))(e))(n);
}, Ec = /*#__PURE__*/ y(2, (e, t) => bc(e, t)), Dc = /*#__PURE__*/ y(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = t, r = wi(e);
	for (; Ri(r);) {
		let e = Vi(r), t = Hi(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AndThen":
				r = Pi(e.first)(Pi(e.second)(t));
				break;
			case "Add":
				n = Yo(e.value)(n), r = t;
				break;
			case "Remove": n = Xo(e.value)(n), r = t;
		}
	}
	return n;
}), Oc = /*#__PURE__*/ Symbol.for("effect/DifferReadonlyArrayPatch");
function kc(e) {
	return e;
}
var Ac = {
	...Zs.prototype,
	[Oc]: {
		_Value: kc,
		_Patch: kc
	}
}, jc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(Ac), { _tag: "Empty" })), Mc = () => jc, Nc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ac), { _tag: "AndThen" }), Pc = (e, t) => {
	let n = Object.create(Nc);
	return n.first = e, n.second = t, n;
}, Fc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ac), { _tag: "Append" }), Ic = (e) => {
	let t = Object.create(Fc);
	return t.values = e, t;
}, Lc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ac), { _tag: "Slice" }), Rc = (e, t) => {
	let n = Object.create(Lc);
	return n.from = e, n.until = t, n;
}, zc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ac), { _tag: "Update" }), Bc = (e, t) => {
	let n = Object.create(zc);
	return n.index = e, n.patch = t, n;
}, Vc = (e) => {
	let t = 0, n = Mc();
	for (; t < e.oldValue.length && t < e.newValue.length;) {
		let r = e.oldValue[t], i = e.newValue[t], a = e.differ.diff(r, i);
		j(a, e.differ.empty) || (n = Hc(n, Bc(t, a))), t += 1;
	}
	return t < e.oldValue.length && (n = Hc(n, Rc(0, t))), t < e.newValue.length && (n = Hc(n, Ic(or(t)(e.newValue)))), n;
}, Hc = /*#__PURE__*/ y(2, (e, t) => Pc(e, t)), Uc = /*#__PURE__*/ y(3, (e, t, n) => {
	if (e._tag === "Empty") return t;
	let r = t.slice(), i = vr(e);
	for (; qn(i);) {
		let e = er(i), t = rr(i);
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
}), Wc = {
	[/* @__PURE__ */ Symbol.for("effect/Differ")]: {
		_P: b,
		_V: b
	},
	pipe() {
		return F(this, arguments);
	}
}, Gc = (e) => {
	let t = Object.create(Wc);
	return t.empty = e.empty, t.diff = e.diff, t.combine = e.combine, t.patch = e.patch, t;
}, Kc = () => Gc({
	empty: nc(),
	combine: (e, t) => fc(t)(e),
	diff: (e, t) => dc(e, t),
	patch: (e, t) => pc(t)(e)
}), qc = () => Gc({
	empty: vc(),
	combine: (e, t) => Ec(t)(e),
	diff: (e, t) => Tc(e, t),
	patch: (e, t) => Dc(t)(e)
}), Jc = (e) => Gc({
	empty: Mc(),
	combine: (e, t) => Hc(e, t),
	diff: (t, n) => Vc({
		oldValue: t,
		newValue: n,
		differ: e
	}),
	patch: (t, n) => Uc(t, n, e)
}), Yc = () => Xc((e, t) => t), Xc = (e) => Gc({
	empty: b,
	combine: (e, t) => e === b ? t : t === b ? e : (n) => t(e(n)),
	diff: (e, t) => j(e, t) ? b : Ee(t),
	patch: (t, n) => e(n, t(n))
}), Zc = 255, Qc = 8, $c = (e) => e & Zc, el = (e) => e >> Qc & Zc, tl = (e, t) => (e & Zc) + ((t & e & Zc) << Qc), nl = /*#__PURE__*/ tl(0, 0), rl = (e) => tl(e, e), il = (e) => tl(e, 0), al = /*#__PURE__*/ y(2, (e, t) => tl($c(e) & ~t, el(e))), ol = /*#__PURE__*/ y(2, (e, t) => e | t), sl = (e) => ~e >>> 0 & Zc, cl = (e) => pl(e, 32), ll = /*#__PURE__*/ y(2, (e, t) => e & ~t), ul = /*#__PURE__*/ y(2, (e, t) => e | t), dl = (e) => fl(e) && !_l(e), fl = (e) => pl(e, 1), pl = /*#__PURE__*/ y(2, (e, t) => (e & t) !== 0), ml = (...e) => e.reduce((e, t) => e | t, 0), hl = /*#__PURE__*/ ml(0), gl = (e) => pl(e, 4), _l = (e) => pl(e, 16), vl = /*#__PURE__*/ y(2, (e, t) => tl(e ^ t, t)), yl = /*#__PURE__*/ y(2, (e, t) => e & (sl($c(t)) | el(t)) | $c(t) & el(t)), bl = /*#__PURE__*/ Gc({
	empty: nl,
	diff: (e, t) => vl(e, t),
	combine: (e, t) => ol(t)(e),
	patch: (e, t) => yl(t, e)
}), xl = rl, Sl = il, Cl = al, wl = (e, t) => ({
	_tag: "Par",
	left: e,
	right: t
}), Tl = (e, t) => ({
	_tag: "Seq",
	left: e,
	right: t
}), El = (e) => {
	let t = Gs(e), n = Ws();
	for (;;) {
		let [e, r] = Ys(t, [Ml(), Ws()], ([e, t], n) => {
			let [r, i] = Dl(n);
			return [Pl(e, r), Ks(t, i)];
		});
		if (n = Ol(n, e), Bs(r)) return Xs(n);
		t = r;
	}
	throw Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, Dl = (e) => {
	let t = e, n = Ml(), r = Ws(), i = Ws();
	for (;;) switch (t._tag) {
		case "Empty":
			if (Bs(r)) return [n, i];
			t = r.head, r = r.tail;
			break;
		case "Par":
			r = Us(t.right, r), t = t.left;
			break;
		case "Seq": {
			let e = t.left, n = t.right;
			switch (e._tag) {
				case "Empty":
					t = n;
					break;
				case "Par": {
					let r = e.left, i = e.right;
					t = wl(Tl(r, n), Tl(i, n));
					break;
				}
				case "Seq": {
					let r = e.left, i = e.right;
					t = Tl(r, Tl(i, n));
					break;
				}
				case "Single": t = e, i = Us(n, i);
			}
			break;
		}
		case "Single":
			if (n = Nl(n, t), Bs(r)) return [n, i];
			t = r.head, r = r.tail;
	}
	throw Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, Ol = (e, t) => {
	if (Bs(e)) return Gs(Ll(t));
	if (Fl(t)) return e;
	let n = Ul(e.head), r = Il(t);
	return n.length === 1 && r.length === 1 && j(n[0], r[0]) ? Us(Hl(e.head, Ll(t)), e.tail) : Us(Ll(t), e);
}, kl = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockParallel"), Al = {
/* c8 ignore next */
_R: (e) => e }, jl = class {
	map;
	[kl] = Al;
	constructor(e) {
		this.map = e;
	}
}, Ml = () => new jl(Cs()), Nl = (e, t) => new jl(ks(e.map, t.dataSource, (e) => Nn(In(e, Ni(t.blockedRequest)), () => wi(t.blockedRequest)))), Pl = (e, t) => new jl(js(e.map, t.map, (e, t, n) => Ds(e, n, jn(Es(e, n), {
	onNone: () => t,
	onSome: (e) => Ii(t, e)
})))), Fl = (e) => Ts(e.map), Il = (e) => Array.from(Os(e.map)), Ll = (e) => Vl(As(e.map, (e) => wi(e))), Rl = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockSequential"), zl = {
/* c8 ignore next */
_R: (e) => e }, Bl = class {
	map;
	[Rl] = zl;
	constructor(e) {
		this.map = e;
	}
}, Vl = (e) => new Bl(e), Hl = (e, t) => new Bl(js(t.map, e.map, (e, t, n) => Ds(e, n, jn(Es(e, n), {
	onNone: () => Si(),
	onSome: (e) => Ii(e, t)
})))), Ul = (e) => Array.from(Os(e.map)), Wl = (e) => Array.from(e.map), Gl = "Empty", Kl = "Fail", ql = "Interrupt", Jl = "Parallel", Yl = "Sequential", Xl = "effect/Cause", Zl = /*#__PURE__*/ Symbol.for(Xl), Ql = {
/* c8 ignore next */
_E: (e) => e }, $l = {
	[Zl]: Ql,
	[T]() {
		return x(E(Xl), D(E(bu(this))), k(this));
	},
	[A](e) {
		return ou(e) && yu(this, e);
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
		return Au(this);
	},
	[M]() {
		return this.toJSON();
	}
}, eu = /*#__PURE__*/ (() => {
	let e = /*#__PURE__*/ Object.create($l);
	return e._tag = Gl, e;
})(), tu = (e) => {
	let t = Object.create($l);
	return t._tag = Kl, t.error = e, t;
}, nu = (e) => {
	let t = Object.create($l);
	return t._tag = "Die", t.defect = e, t;
}, ru = (e) => {
	let t = Object.create($l);
	return t._tag = ql, t.fiberId = e, t;
}, iu = (e, t) => {
	let n = Object.create($l);
	return n._tag = Jl, n.left = e, n.right = t, n;
}, au = (e, t) => {
	let n = Object.create($l);
	return n._tag = Yl, n.left = e, n.right = t, n;
}, ou = (e) => C(e, Zl), su = (e) => e._tag === Gl, cu = (e) => e._tag === "Empty" || Ou(e, !0, (e, t) => {
	switch (t._tag) {
		case Gl: return L(e);
		case "Die":
		case Kl:
		case ql: return L(!1);
		default: return I();
	}
}), lu = (e) => An(gu(e)), uu = (e) => ku(void 0, wu)(e), du = (e) => Oi(Ou(e, Si(), (e, t) => t._tag === "Fail" ? L(x(e, Pi(t.error))) : I())), fu = (e) => Oi(Ou(e, Si(), (e, t) => t._tag === "Die" ? L(x(e, Pi(t.defect))) : I())), pu = (e) => Ou(e, Wo(), (e, t) => t._tag === "Interrupt" ? L(x(e, Yo(t.fiberId))) : I()), mu = (e) => Su(e, (e) => e._tag === "Fail" ? L(e.error) : I()), hu = (e) => {
	let t = mu(e);
	switch (t._tag) {
		case "None": return yn(e);
		case "Some": return bn(t.value);
	}
}, gu = (e) => Su(e, (e) => e._tag === "Interrupt" ? L(e.fiberId) : I()), _u = (e) => Du(e, {
	onEmpty: eu,
	onFail: () => eu,
	onDie: nu,
	onInterrupt: ru,
	onSequential: au,
	onParallel: iu
}), vu = (e) => Du(e, {
	onEmpty: eu,
	onFail: nu,
	onDie: nu,
	onInterrupt: ru,
	onSequential: au,
	onParallel: iu
}), yu = (e, t) => {
	let n = wi(e), r = wi(t);
	for (; Ri(n) && Ri(r);) {
		let [e, t] = x(Vi(n), Ou([Wo(), Si()], ([e, t], n) => {
			let [r, i] = Cu(n);
			return L([x(e, Qo(r)), x(t, Ii(i))]);
		})), [i, a] = x(Vi(r), Ou([Wo(), Si()], ([e, t], n) => {
			let [r, i] = Cu(n);
			return L([x(e, Qo(r)), x(t, Ii(i))]);
		}));
		if (!j(e, i)) return !1;
		n = t, r = a;
	}
	return !0;
}, bu = (e) => xu(wi(e), Si()), xu = (e, t) => {
	for (;;) {
		let [n, r] = x(e, xr([Wo(), Si()], ([e, t], n) => {
			let [r, i] = Cu(n);
			return [x(e, Qo(r)), x(t, Ii(i))];
		})), i = Jo(n) > 0 ? x(t, Pi(n)) : t;
		if (Li(r)) return Oi(i);
		e = r, t = i;
	}
	throw Error(Ke("Cause.flattenCauseLoop"));
}, Su = /*#__PURE__*/ y(2, (e, t) => {
	let n = [e];
	for (; n.length > 0;) {
		let e = n.pop(), r = t(e);
		switch (r._tag) {
			case "None":
				switch (e._tag) {
					case Yl:
					case Jl: n.push(e.right), n.push(e.left);
				}
				break;
			case "Some": return r;
		}
	}
	return I();
}), Cu = (e) => {
	let t = e, n = [], r = Wo(), i = Si();
	for (; t !== void 0;) switch (t._tag) {
		case Gl:
			if (n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Kl:
			if (r = Yo(r, Ci(t._tag, t.error)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case "Die":
			if (r = Yo(r, Ci(t._tag, t.defect)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case ql:
			if (r = Yo(r, Ci(t._tag, t.fiberId)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Yl:
			switch (t.left._tag) {
				case Gl:
					t = t.right;
					break;
				case Yl:
					t = au(t.left.left, au(t.left.right, t.right));
					break;
				case Jl:
					t = iu(au(t.left.left, t.right), au(t.left.right, t.right));
					break;
				default: i = Pi(i, t.right), t = t.left;
			}
			break;
		case Jl: n.push(t.right), t = t.left;
	}
	throw Error(Ke("Cause.evaluateCauseLoop"));
}, wu = {
	emptyCase: De,
	failCase: Oe,
	dieCase: Oe,
	interruptCase: De,
	sequentialCase: (e, t, n) => t && n,
	parallelCase: (e, t, n) => t && n
}, Tu = "SequentialCase", Eu = "ParallelCase", Du = /*#__PURE__*/ y(2, (e, { onDie: t, onEmpty: n, onFail: r, onInterrupt: i, onParallel: a, onSequential: o }) => ku(e, void 0, {
	emptyCase: () => n,
	failCase: (e, t) => r(t),
	dieCase: (e, n) => t(n),
	interruptCase: (e, t) => i(t),
	sequentialCase: (e, t, n) => o(t, n),
	parallelCase: (e, t, n) => a(t, n)
})), Ou = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = t, i = e, a = [];
	for (; i !== void 0;) {
		let e = n(r, i);
		switch (r = An(e) ? e.value : r, i._tag) {
			case Yl:
				a.push(i.right), i = i.left;
				break;
			case Jl:
				a.push(i.right), i = i.left;
				break;
			default: i = void 0;
		}
		i === void 0 && a.length > 0 && (i = a.pop());
	}
	return r;
}), ku = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._tag) {
			case Gl:
				i.push(yn(n.emptyCase(t)));
				break;
			case Kl:
				i.push(yn(n.failCase(t, e.error)));
				break;
			case "Die":
				i.push(yn(n.dieCase(t, e.defect)));
				break;
			case ql:
				i.push(yn(n.interruptCase(t, e.fiberId)));
				break;
			case Yl:
				r.push(e.right), r.push(e.left), i.push(bn({ _tag: Tu }));
				break;
			case Jl: r.push(e.right), r.push(e.left), i.push(bn({ _tag: Eu }));
		}
	}
	let a = [];
	for (; i.length > 0;) {
		let e = i.pop();
		switch (e._tag) {
			case "Left":
				switch (e.left._tag) {
					case Tu: {
						let e = a.pop(), r = a.pop(), i = n.sequentialCase(t, e, r);
						a.push(i);
						break;
					}
					case Eu: {
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
}), Au = (e, t) => uu(e) ? "All fibers interrupted without errors." : Ru(e).map(function(e) {
	return t?.renderErrorCause !== !0 || e.cause === void 0 ? e.stack : `${e.stack} {\n${ju(e.cause, "  ")}\n}`;
}).join("\n"), ju = (e, t) => {
	let n = e.stack.split("\n"), r = `${t}[cause]: ${n[0]}`;
	for (let e = 1, i = n.length; e < i; e++) r += `\n${t}${n[e]}`;
	return e.cause && (r += ` {\n${ju(e.cause, `${t}  `)}\n${t}}`), r;
}, Mu = (e) => {
	let t = typeof e == "object" && !!e, n = Error.stackTraceLimit;
	Error.stackTraceLimit = 1;
	let r = Error(Nu(e), t && "cause" in e && e.cause !== void 0 ? { cause: Mu(e.cause) } : void 0);
	return Error.stackTraceLimit = n, r.message === "" && (r.message = "An error has occurred"), Error.stackTraceLimit = n, r.name = e instanceof Error ? e.name : "Error", t && (Lu in e && (r.span = e[Lu]), Object.keys(e).forEach((t) => {
		t in r || (r[t] = e[t]);
	})), r.stack = Iu(`${r.name}: ${r.message}`, e instanceof Error && e.stack ? e.stack : "", r.span), r;
}, Nu = (e) => {
	if (typeof e == "string") return e;
	if (typeof e == "object" && e && e instanceof Error) return e.message;
	try {
		if (C(e, "toString") && ze(e.toString) && e.toString !== Object.prototype.toString && e.toString !== globalThis.Array.prototype.toString) return e.toString();
	} catch {}
	return bt(e);
}, Pu = /\((.*)\)/g, Fu = /*#__PURE__*/ S("effect/Tracer/spanToTrace", () => /* @__PURE__ */ new WeakMap()), Iu = (e, t, n) => {
	let r = [e], i = t.startsWith(e) ? t.slice(e.length).split("\n") : t.split("\n");
	for (let e = 1; e < i.length; e++) if (i[e].includes(" at new BaseEffectError") || i[e].includes(" at new YieldableError")) e++;
	else {
		if (i[e].includes("Generator.next") || i[e].includes("effect_internal_function")) break;
		r.push(i[e].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
	}
	if (n) {
		let e = n, t = 0;
		for (; e && e._tag === "Span" && t < 10;) {
			let n = Fu.get(e);
			if (typeof n == "function") {
				let t = n();
				if (typeof t == "string") {
					let n = t.matchAll(Pu), i = !1;
					for (let [, t] of n) i = !0, r.push(`    at ${e.name} (${t})`);
					i || r.push(`    at ${e.name} (${t.replace(/^at /, "")})`);
				} else r.push(`    at ${e.name}`);
			} else r.push(`    at ${e.name}`);
			e = Fn(e.parent), t++;
		}
	}
	return r.join("\n");
}, Lu = /*#__PURE__*/ Symbol.for("effect/SpanAnnotation"), Ru = (e) => ku(e, void 0, {
	emptyCase: () => [],
	dieCase: (e, t) => [Mu(t)],
	failCase: (e, t) => [Mu(t)],
	interruptCase: () => [],
	parallelCase: (e, t, n) => [...t, ...n],
	sequentialCase: (e, t, n) => [...t, ...n]
}), zu = "Pending", Bu = "Done", Vu = /*#__PURE__*/ Symbol.for("effect/Deferred"), Hu = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Uu = (e) => ({
	_tag: zu,
	joiners: e
}), Wu = (e) => ({
	_tag: Bu,
	effect: e
}), Gu = class e {
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
}, Ku = (e, t) => {
	let n = new B("Blocked");
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}, qu = (e) => {
	let t = new B("RunBlocked");
	return t.effect_instruction_i0 = e, t;
}, Ju = /*#__PURE__*/ Symbol.for("effect/Effect"), Yu = class {
	patch;
	op;
	_op = zt;
	constructor(e, t) {
		this.patch = e, this.op = t;
	}
}, B = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Ju] = Kt;
	constructor(e) {
		this._op = e;
	}
	[A](e) {
		return this === e;
	}
	[T]() {
		return k(this, lt(this));
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
		return new Gu(new it(this));
	}
}, Xu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Ju] = Kt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[A](e) {
		return Yf(e) && e._op === "Failure" && j(this.effect_instruction_i0, e.effect_instruction_i0);
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
		return new Gu(new it(this));
	}
}, Zu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Ju] = Kt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[A](e) {
		return Yf(e) && e._op === "Success" && j(this.effect_instruction_i0, e.effect_instruction_i0);
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
		return new Gu(new it(this));
	}
}, Qu = (e) => C(e, Ju), V = (e) => {
	let t = new B(Lt);
	return t.effect_instruction_i0 = e, t;
}, $u = /*#__PURE__*/ y(3, (e, t, n) => Md((r) => W(e, (e) => W(fd(q(() => r(t(e)))), (t) => q(() => n(e, t)).pipe(bd({
	onFailure: (e) => {
		switch (t._tag) {
			case Ot: return U(au(t.effect_instruction_i0, e));
			case Mt: return U(e);
		}
	},
	onSuccess: () => t
})))))), ed = /*#__PURE__*/ y(2, (e, t) => W(e, () => K(t))), td = (e) => ed(e, void 0), nd = function() {
	let e = new B(Dt);
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
		default: throw Error(Ke("you're not supposed to end up here"));
	}
	return e;
}, rd = (e, t = ys) => {
	let n = new B(Et), r;
	return n.effect_instruction_i0 = (t) => {
		r = e(t);
	}, n.effect_instruction_i1 = t, Od(n, (e) => Qu(r) ? r : Y);
}, id = (e, t = ys) => q(() => rd(e, t)), ad = (e, t = ys) => nd(e, function() {
	let e, n;
	function r(t) {
		e ? e(t) : n === void 0 && (n = t);
	}
	let i = new B(Et);
	i.effect_instruction_i0 = (t) => {
		e = t, n && t(n);
	}, i.effect_instruction_i1 = t;
	let a, o;
	return this.effect_instruction_i0.length === 1 ? a = w(() => this.effect_instruction_i0(r)) : (o = new AbortController(), a = w(() => this.effect_instruction_i0(r, o.signal))), a || o ? Od(i, (e) => (o && o.abort(), a ?? Y)) : i;
}), od = /*#__PURE__*/ y(2, (e, t) => xd(e, {
	onFailure: t,
	onSuccess: K
})), sd = /*#__PURE__*/ Symbol.for("effect/OriginalAnnotation"), cd = (e, t) => An(t) ? new Proxy(e, {
	has(e, t) {
		return t === Lu || t === sd || t in e;
	},
	get(n, r) {
		return r === Lu ? t.value : r === sd ? e : n[r];
	}
}) : e, ld = (e) => Ve(e) && !(Lu in e) ? V((t) => U(nu(cd(e, Tp(t))))) : U(nu(e)), ud = (e) => md(() => nu(new Vf(e))), dd = (e) => xd(e, {
	onFailure: (e) => K(bn(e)),
	onSuccess: (e) => K(yn(e))
}), fd = (e) => yd(e, {
	onFailure: X,
	onSuccess: Z
}), H = (e) => Ve(e) && !(Lu in e) ? V((t) => U(tu(cd(e, Tp(t))))) : U(tu(e)), pd = (e) => W(J(e), H), U = (e) => {
	let t = new Xu(Ot);
	return t.effect_instruction_i0 = e, t;
}, md = (e) => W(J(e), U), hd = /*#__PURE__*/ V((e) => K(e.id())), gd = (e) => V((t) => e(t.id())), W = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(At);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}), _d = (e) => {
	let t = new B("OnStep");
	return t.effect_instruction_i0 = e, t;
}, vd = (e) => W(e, b), yd = /*#__PURE__*/ y(2, (e, t) => bd(e, {
	onFailure: (e) => K(t.onFailure(e)),
	onSuccess: (e) => K(t.onSuccess(e))
})), bd = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(jt);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t.onFailure, n.effect_instruction_i2 = t.onSuccess, n;
}), xd = /*#__PURE__*/ y(2, (e, t) => bd(e, {
	onFailure: (e) => {
		if (fu(e).length > 0) return U(vu(e));
		let n = du(e);
		return n.length > 0 ? t.onFailure(Bi(n)) : U(e);
	},
	onSuccess: t.onSuccess
})), Sd = /*#__PURE__*/ y(2, (e, t) => q(() => {
	let n = R(e), r = Bn(n.length), i = 0;
	return ed(Fd({
		while: () => i < n.length,
		body: () => t(n[i], i),
		step: (e) => {
			r[i++] = e;
		}
	}), r);
})), Cd = /*#__PURE__*/ y(2, (e, t) => q(() => {
	let n = R(e), r = 0;
	return Fd({
		while: () => r < n.length,
		body: () => t(n[r], r),
		step: () => {
			r++;
		}
	});
})), wd = (e) => {
	let t = new B(Pt);
	return t.effect_instruction_i0 = xl(1), t.effect_instruction_i1 = () => e, t;
}, G = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => J(() => t(e)))), Td = /*#__PURE__*/ y(2, (e, t) => xd(e, {
	onFailure: (e) => pd(() => t.onFailure(e)),
	onSuccess: (e) => J(() => t.onSuccess(e))
})), Ed = /*#__PURE__*/ y(2, (e, t) => bd(e, {
	onFailure: (e) => {
		let n = hu(e);
		switch (n._tag) {
			case "Left": return pd(() => t(n.left));
			case "Right": return U(n.right);
		}
	},
	onSuccess: K
})), Dd = /*#__PURE__*/ y(2, (e, t) => Md((n) => bd(n(e), {
	onFailure: (e) => {
		let n = X(e);
		return bd(t(n), {
			onFailure: (t) => X(au(e, t)),
			onSuccess: () => n
		});
	},
	onSuccess: (e) => {
		let n = Z(e);
		return Ud(t(n), n);
	}
}))), Od = /*#__PURE__*/ y(2, (e, t) => Dd(e, ap({
	onFailure: (e) => uu(e) ? td(t(pu(e))) : Y,
	onSuccess: () => Y
}))), K = (e) => {
	let t = new Zu(Mt);
	return t.effect_instruction_i0 = e, t;
}, q = (e) => {
	let t = new B(Dt);
	return t.commit = e, t;
}, J = (e) => {
	let t = new B(Nt);
	return t.effect_instruction_i0 = e, t;
}, kd = /*#__PURE__*/ y((e) => e.length === 3 || e.length === 2 && !(Ve(e[1]) && "onlyEffect" in e[1]), (e, t) => W(e, (e) => {
	let n = typeof t == "function" ? t(e) : t;
	return Qu(n) ? ed(n, e) : Ge(n) ? rd((t) => {
		n.then((n) => t(K(e)), (e) => t(H(new Jf(e, "An unknown error occurred in Effect.tap"))));
	}) : K(e);
})), Ad = (e) => V((t) => e(cf(Of, L(x(t.getFiberRef(Of), Mn(() => t.scope())))))), jd = (e) => {
	let t = new B(Pt);
	return t.effect_instruction_i0 = Sl(1), t.effect_instruction_i1 = () => e, t;
}, Md = (e) => nd(e, function() {
	let e = new B(Pt);
	return e.effect_instruction_i0 = Sl(1), e.effect_instruction_i1 = (e) => fl(e) ? w(() => this.effect_instruction_i0(wd)) : w(() => this.effect_instruction_i0(jd)), e;
}), Y = /*#__PURE__*/ K(void 0), Nd = (e) => {
	let t = new B(Pt);
	return t.effect_instruction_i0 = e, t.effect_instruction_i1 = void 0, t;
}, Pd = /*#__PURE__*/ y(2, (e, t) => W(t, (t) => t ? x(e, G(L)) : K(I()))), Fd = (e) => {
	let t = new B(Ft);
	return t.effect_instruction_i0 = e.while, t.effect_instruction_i1 = e.body, t.effect_instruction_i2 = e.step, t;
}, Id = (e) => q(() => {
	let t = new B(It);
	return t.effect_instruction_i0 = e(), t;
}), Ld = function() {
	let e = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
	return Id(() => e(x));
}, Rd = (e, ...t) => Object.defineProperty(t.length === 0 ? function(...t) {
	return Id(() => e.apply(this, t));
} : function(...n) {
	let r = Id(() => e.apply(this, n));
	for (let e of t) r = e(r, ...n);
	return r;
}, "length", {
	value: e.length,
	configurable: !0
}), zd = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(Pt);
	return n.effect_instruction_i0 = t, n.effect_instruction_i1 = () => e, n;
}), Bd = (e) => {
	let t = new B(Rt);
	return e?.priority === void 0 ? t : Sf(t, e.priority);
}, Vd = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => G(t, (t) => [e, t]))), Hd = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => ed(t, e))), Ud = /*#__PURE__*/ y(2, (e, t) => W(e, () => t)), Wd = /*#__PURE__*/ y(3, (e, t, n) => W(e, (e) => G(t, (t) => n(e, t)))), Gd = (e) => W(hd, (t) => x(e, Kd(t))), Kd = /*#__PURE__*/ y(2, (e, t) => W(e.interruptAsFork(t), () => e.await)), qd = {
	_tag: "All",
	syslog: 0,
	label: "ALL",
	ordinal: -(2 ** 53 - 1),
	pipe() {
		return F(this, arguments);
	}
}, Jd = {
	_tag: "Fatal",
	syslog: 2,
	label: "FATAL",
	ordinal: 5e4,
	pipe() {
		return F(this, arguments);
	}
}, Yd = {
	_tag: "Error",
	syslog: 3,
	label: "ERROR",
	ordinal: 4e4,
	pipe() {
		return F(this, arguments);
	}
}, Xd = {
	_tag: "Warning",
	syslog: 4,
	label: "WARN",
	ordinal: 3e4,
	pipe() {
		return F(this, arguments);
	}
}, Zd = {
	_tag: "Info",
	syslog: 6,
	label: "INFO",
	ordinal: 2e4,
	pipe() {
		return F(this, arguments);
	}
}, Qd = {
	_tag: "Debug",
	syslog: 7,
	label: "DEBUG",
	ordinal: 1e4,
	pipe() {
		return F(this, arguments);
	}
}, $d = {
	_tag: "Trace",
	syslog: 7,
	label: "TRACE",
	ordinal: 0,
	pipe() {
		return F(this, arguments);
	}
}, ef = {
	_tag: "None",
	syslog: 7,
	label: "OFF",
	ordinal: 2 ** 53 - 1,
	pipe() {
		return F(this, arguments);
	}
}, tf = /*#__PURE__*/ Symbol.for("effect/FiberRef"), nf = {
/* c8 ignore next */
_A: (e) => e }, rf = (e) => V((t) => Z(t.getFiberRef(e))), af = /*#__PURE__*/ y(2, (e, t) => W(rf(e), t)), of = /*#__PURE__*/ y(2, (e, t) => sf(e, () => [void 0, t])), sf = /*#__PURE__*/ y(2, (e, t) => V((n) => {
	let [r, i] = t(n.getFiberRef(e));
	return n.setFiberRef(e, i), K(r);
})), cf = /*#__PURE__*/ y(3, (e, t, n) => $u(Hd(rf(t), of(t, n)), () => e, (e) => of(t, e))), lf = /*#__PURE__*/ y(3, (e, t, n) => af(t, (r) => cf(e, t, n(r)))), uf = (e, t) => mf(e, {
	differ: Yc(),
	fork: t?.fork ?? b,
	join: t?.join
}), df = (e) => {
	let t = qc();
	return mf(e, {
		differ: t,
		fork: t.empty
	});
}, ff = (e) => {
	let t = Jc(Yc());
	return mf(e, {
		differ: t,
		fork: t.empty
	});
}, pf = (e) => {
	let t = Kc();
	return mf(e, {
		differ: t,
		fork: t.empty
	});
}, mf = (e, t) => ({
	...Zt,
	[tf]: nf,
	initial: e,
	commit() {
		return rf(this);
	},
	diff: (e, n) => t.differ.diff(e, n),
	combine: (e, n) => t.differ.combine(e, n),
	patch: (e) => (n) => t.differ.patch(e, n),
	fork: t.fork,
	join: t.join ?? ((e, t) => t)
}), hf = (e) => mf(e, {
	differ: bl,
	fork: bl.empty
}), gf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentContext"), () => pf(ai())), _f = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => uf(0)), vf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => uf(2048)), yf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => uf(Cs())), bf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogLevel"), () => uf(Zd)), xf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogSpan"), () => uf(Ws())), Sf = /*#__PURE__*/ y(2, (e, t) => cf(e, _f, t)), Cf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentConcurrency"), () => uf("unbounded")), wf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestBatching"), () => uf(!0)), Tf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => uf(L(Qd))), Ef = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => uf(L(Xd))), Df = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMetricLabels"), () => ff(_r())), Of = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => uf(I(), {
	fork: () => I(),
	join: (e, t) => e
})), kf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => uf(eu, {
	fork: () => eu,
	join: (e, t) => e
})), Af = /*#__PURE__*/ Symbol.for("effect/Scope"), jf = /*#__PURE__*/ Symbol.for("effect/CloseableScope"), Mf = (e, t) => e.addFinalizer(() => td(t)), Nf = (e, t) => e.addFinalizer(t), Pf = (e, t) => e.close(t), Ff = (e, t) => e.fork(t), If = (e) => Lf(b)(e), Lf = /*#__PURE__*/ y(2, (e, t) => {
	let n = x(e, mu, In(t));
	switch (n._tag) {
		case "None": return x(fu(e), zi, jn({
			onNone: () => {
				let t = R(pu(e)).flatMap((e) => R(bs(e)).map((e) => `#${e}`));
				return new Uf(t ? `Interrupted by fibers: ${t.join(", ")}` : void 0);
			},
			onSome: b
		}));
		case "Some": return n.value;
	}
}), Rf = /*#__PURE__*/ function() {
	class e extends globalThis.Error {
		commit() {
			return H(this);
		}
		toJSON() {
			let e = { ...this };
			return this.message && (e.message = this.message), this.cause && (e.cause = this.cause), e;
		}
		[M]() {
			return this.toString === globalThis.Error.prototype.toString ? "Bun" in globalThis ? Au(tu(this), { renderErrorCause: !0 }) : this : this.stack ? `${this.toString()}\n${this.stack.split("\n").slice(1).join("\n")}` : this.toString();
		}
	}
	return Object.assign(e.prototype, Qt), e;
}(), zf = (e, t) => {
	class n extends Rf {
		_tag = t;
	}
	return Object.assign(n.prototype, e), n.prototype.name = t, n;
}, Bf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/RuntimeException"), Vf = /*#__PURE__*/ zf({ [Bf]: Bf }, "RuntimeException"), Hf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/InterruptedException"), Uf = /*#__PURE__*/ zf({ [Hf]: Hf }, "InterruptedException"), Wf = (e) => C(e, Hf), Gf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/NoSuchElement"), Kf = /*#__PURE__*/ zf({ [Gf]: Gf }, "NoSuchElementException"), qf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/UnknownException"), Jf = /*#__PURE__*/ function() {
	class e extends Rf {
		_tag = "UnknownException";
		error;
		constructor(e, t) {
			super(t ?? "An unknown error occurred", { cause: e }), this.error = e;
		}
	}
	return Object.assign(e.prototype, {
		[qf]: qf,
		name: "UnknownException"
	}), e;
}(), Yf = (e) => Qu(e) && "_tag" in e && (e._tag === "Success" || e._tag === "Failure"), Xf = (e) => e._tag === "Failure", Zf = (e) => e._tag === "Success", Qf = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._tag) {
		case Ot: return X(e.effect_instruction_i0);
		case Mt: return Z(t);
	}
}), $f = (e) => Qf(e, void 0), ep = (e, t) => lp(e, t?.parallel ? iu : au), tp = (e) => X(nu(e)), np = (e) => X(tu(e)), X = (e) => {
	let t = new Xu(Ot);
	return t.effect_instruction_i0 = e, t;
}, rp = (e) => X(ru(e)), ip = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._tag) {
		case Ot: return X(e.effect_instruction_i0);
		case Mt: return Z(t(e.effect_instruction_i0));
	}
}), ap = /*#__PURE__*/ y(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case Ot: return t(e.effect_instruction_i0);
		case Mt: return n(e.effect_instruction_i0);
	}
}), op = /*#__PURE__*/ y(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case Ot: return t(e.effect_instruction_i0);
		case Mt: return n(e.effect_instruction_i0);
	}
}), Z = (e) => {
	let t = new Zu(Mt);
	return t.effect_instruction_i0 = e, t;
}, sp = /*#__PURE__*/ Z(void 0), cp = /*#__PURE__*/ y(3, (e, t, { onFailure: n, onSuccess: r }) => {
	switch (e._tag) {
		case Ot: switch (t._tag) {
			case Mt: return X(e.effect_instruction_i0);
			case Ot: return X(n(e.effect_instruction_i0, t.effect_instruction_i0));
		}
		case Mt: switch (t._tag) {
			case Mt: return Z(r(e.effect_instruction_i0, t.effect_instruction_i0));
			case Ot: return X(t.effect_instruction_i0);
		}
	}
}), lp = (e, t) => {
	let n = Ti(e);
	return Ri(n) ? x(Hi(n), xr(x(Vi(n), ip(wi)), (e, n) => x(e, cp(n, {
		onSuccess: (e, t) => x(e, Pi(t)),
		onFailure: t
	}))), ip(Oi), ip((e) => Di(e)), L) : I();
}, up = (e) => ({
	...Zt,
	[Vu]: Hu,
	state: ns(Uu([])),
	commit() {
		return pp(this);
	},
	blockingOn: e
}), dp = () => W(hd, (e) => fp(e)), fp = (e) => J(() => up(e)), pp = (e) => id((t) => {
	let n = rs(e.state);
	switch (n._tag) {
		case Bu: return t(n.effect);
		case zu: return n.joiners.push(t), vp(e, t);
	}
}, e.blockingOn), mp = /*#__PURE__*/ y(2, (e, t) => J(() => {
	let n = rs(e.state);
	switch (n._tag) {
		case Bu: return !1;
		case zu:
			is(e.state, Wu(t));
			for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
			return !0;
	}
})), hp = /*#__PURE__*/ y(2, (e, t) => mp(e, U(t))), gp = /*#__PURE__*/ y(2, (e, t) => mp(e, K(t))), _p = (e, t) => {
	let n = rs(e.state);
	if (n._tag === "Pending") {
		is(e.state, Wu(t));
		for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
	}
}, vp = (e, t) => J(() => {
	let n = rs(e.state);
	if (n._tag === "Pending") {
		let e = n.joiners.indexOf(t);
		e >= 0 && n.joiners.splice(e, 1);
	}
}), yp = /*#__PURE__*/ V((e) => Z(e.currentContext)), bp = () => yp, xp = (e) => W(bp(), e), Sp = /*#__PURE__*/ y(2, (e, t) => cf(gf, t)(e)), Cp = /*#__PURE__*/ y(2, (e, t) => lf(gf, (e) => di(e, t))(e)), wp = /*#__PURE__*/ y(2, (e, t) => xp((n) => Sp(e, t(n)))), Tp = (e) => {
	let t = e.currentSpan;
	return t !== void 0 && t._tag === "Span" ? L(t) : I();
}, Ep = Xf, Dp = Zf, Op = sp, kp = /*#__PURE__*/ Symbol.for("effect/MutableHashMap"), Ap = {
	[kp]: kp,
	[Symbol.iterator]() {
		return new jp(this);
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
}, jp = class e {
	self;
	referentialIterator;
	bucketIterator;
	constructor(e) {
		this.self = e, this.referentialIterator = e.referential[Symbol.iterator]();
	}
	next() {
		if (this.bucketIterator !== void 0) return this.bucketIterator.next();
		let e = this.referentialIterator.next();
		return e.done ? (this.bucketIterator = new Mp(this.self.buckets.values()), this.next()) : e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, Mp = class {
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
}, Np = () => {
	let e = Object.create(Ap);
	return e.referential = /* @__PURE__ */ new Map(), e.buckets = /* @__PURE__ */ new Map(), e.bucketsSize = 0, e;
}, Pp = /*#__PURE__*/ y(2, (e, t) => {
	if (_t(t) === !1) return e.referential.has(t) ? L(e.referential.get(t)) : I();
	let n = t[T](), r = e.buckets.get(n);
	return r === void 0 ? I() : Fp(e, r, t);
}), Fp = (e, t, n, r = !1) => {
	for (let i = 0, a = t.length; i < a; i++) if (n[A](t[i][0])) {
		let n = t[i][1];
		return r && (t.splice(i, 1), e.bucketsSize--), L(n);
	}
	return I();
}, Ip = /*#__PURE__*/ y(2, (e, t) => An(Pp(e, t))), Lp = /*#__PURE__*/ y(3, (e, t, n) => {
	if (_t(t) === !1) return e.referential.set(t, n), e;
	let r = t[T](), i = e.buckets.get(r);
	return i === void 0 ? (e.buckets.set(r, [[t, n]]), e.bucketsSize++, e) : (Rp(e, i, t), i.push([t, n]), e.bucketsSize++, e);
}), Rp = (e, t, n) => {
	for (let r = 0, i = t.length; r < i; r++) if (n[A](t[r][0])) {
		t.splice(r, 1), e.bucketsSize--;
		return;
	}
}, zp = /*#__PURE__*/ Symbol.for("effect/Clock"), Bp = /*#__PURE__*/ ni("effect/Clock"), Vp = 2 ** 31 - 1, Hp = { unsafeSchedule(e, t) {
	let n = ma(t);
	if (n > Vp) return Oe;
	let r = !1, i = setTimeout(() => {
		r = !0, e();
	}, n);
	return () => (clearTimeout(i), !r);
} }, Up = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || typeof performance.now != "function") return () => BigInt(Date.now()) * e;
	let t;
	return () => (t === void 0 && (t = BigInt(Date.now()) * e - BigInt(Math.round(performance.now() * 1e6))), t + BigInt(Math.round(performance.now() * 1e6)));
}(), Wp = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return Up;
	let t = /*#__PURE__*/ Up() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}(), Gp = class {
	[zp] = zp;
	unsafeCurrentTimeMillis() {
		return Date.now();
	}
	unsafeCurrentTimeNanos() {
		return Wp();
	}
	currentTimeMillis = /*#__PURE__*/ J(() => this.unsafeCurrentTimeMillis());
	currentTimeNanos = /*#__PURE__*/ J(() => this.unsafeCurrentTimeNanos());
	scheduler() {
		return K(Hp);
	}
	sleep(e) {
		return ad((t) => td(J(Hp.unsafeSchedule(() => t(Y), e))));
	}
}, Kp = () => new Gp(), qp = "InvalidData", Jp = "MissingData", Yp = "SourceUnavailable", Xp = "Unsupported", Zp = /*#__PURE__*/ Symbol.for("effect/ConfigError"), Qp = {
	_tag: "ConfigError",
	[Zp]: Zp
}, $p = (e, t) => {
	let n = Object.create(Qp);
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
}, em = (e, t) => {
	let n = Object.create(Qp);
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
}, tm = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Qp);
	return r._op = qp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Invalid data at ${x(this.path, Er(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, nm = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Qp);
	return r._op = Jp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Missing data at ${x(this.path, Er(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, rm = (e, t, n, r = { pathDelim: "." }) => {
	let i = Object.create(Qp);
	return i._op = Yp, i.path = e, i.message = t, i.cause = n, Object.defineProperty(i, "toString", {
		enumerable: !1,
		value() {
			return `(Source unavailable at ${x(this.path, Er(r.pathDelim))}: "${this.message}")`;
		}
	}), i;
}, im = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Qp);
	return r._op = Xp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Unsupported operation at ${x(this.path, Er(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, am = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._op) {
		case "And": return $p(am(e.left, t), am(e.right, t));
		case "Or": return em(am(e.left, t), am(e.right, t));
		case qp: return tm([...t, ...e.path], e.message);
		case Jp: return nm([...t, ...e.path], e.message);
		case Yp: return rm([...t, ...e.path], e.message, e.cause);
		case Xp: return im([...t, ...e.path], e.message);
	}
}), om = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._op) {
			case "And":
				r.push(e.right), r.push(e.left), i.push(bn({ _op: "AndCase" }));
				break;
			case "Or":
				r.push(e.right), r.push(e.left), i.push(bn({ _op: "OrCase" }));
				break;
			case qp:
				i.push(yn(n.invalidDataCase(t, e.path, e.message)));
				break;
			case Jp:
				i.push(yn(n.missingDataCase(t, e.path, e.message)));
				break;
			case Yp:
				i.push(yn(n.sourceUnavailableCase(t, e.path, e.message, e.cause)));
				break;
			case Xp: i.push(yn(n.unsupportedCase(t, e.path, e.message)));
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
}), sm = { _tag: "Empty" }, cm = /*#__PURE__*/ y(2, (e, t) => {
	let n = Gs(t), r = e;
	for (; Vs(n);) {
		let e = n.head;
		switch (e._tag) {
			case "Empty":
				n = n.tail;
				break;
			case "AndThen":
				n = Us(e.first, Us(e.second, n.tail));
				break;
			case "MapName":
				r = yr(r, e.f), n = n.tail;
				break;
			case "Nested":
				r = Un(r, e.name), n = n.tail;
				break;
			case "Unnested": if (x($n(r), Rn(e.name))) r = rr(r), n = n.tail;
			else return bn(nm(r, `Expected ${e.name} to be in path in ConfigProvider#unnested`));
		}
	}
	return yn(r);
}), lm = "Constant", um = "Fail", dm = "Fallback", fm = "Described", pm = "Lazy", mm = "MapOrFail", hm = "Nested", gm = "Primitive", _m = "Redacted", vm = "Sequence", ym = "HashMap", bm = "ZipWith", xm = (e, t) => [...e, ...t], Sm = /*#__PURE__*/ Symbol.for("effect/ConfigProvider"), Cm = /*#__PURE__*/ ni("effect/ConfigProvider"), wm = /*#__PURE__*/ Symbol.for("effect/ConfigProviderFlat"), Tm = (e) => ({
	[Sm]: Sm,
	pipe() {
		return F(this, arguments);
	},
	...e
}), Em = (e) => ({
	[wm]: wm,
	patch: e.patch,
	load: (t, n, r = !0) => e.load(t, n, r),
	enumerateChildren: e.enumerateChildren
}), Dm = (e) => Tm({
	load: (t) => W(Nm(e, _r(), t, !1), (e) => jn($n(e), {
		onNone: () => H(nm(_r(), `Expected a single value having structure: ${t}`)),
		onSome: K
	})),
	flattened: e
}), Om = (e) => {
	let { pathDelim: t, seqDelim: n } = Object.assign({}, {
		pathDelim: "_",
		seqDelim: ","
	}, e), r = (e) => x(e, Er(t)), i = (e) => e.split(t), a = () => typeof process < "u" && "env" in process && typeof process.env == "object" ? process.env : {};
	return Dm(Em({
		load: (e, t, i = !0) => {
			let o = r(e), s = a();
			return x(o in s ? L(s[o]) : I(), Ed(() => nm(e, `Expected ${o} to exist in the process context`)), W((r) => Im(r, e, t, n, i)));
		},
		enumerateChildren: (e) => J(() => {
			let t = a();
			return Go(Object.keys(t).map((e) => i(e.toUpperCase())).filter((t) => {
				for (let n = 0; n < e.length; n++) {
					let r = x(e, Qn(n)), i = t[n];
					if (i === void 0 || r !== i) return !1;
				}
				return !0;
			}).flatMap((t) => t.slice(e.length, e.length + 1)));
		}),
		patch: sm
	}));
}, km = (e, t, n, r) => {
	let i = Sr(n.length, (t) => t >= r.length ? I() : L([e(t), t + 1])), a = Sr(r.length, (e) => e >= n.length ? I() : L([t(e), e + 1]));
	return [xm(n, i), xm(r, a)];
}, Am = (e, t) => {
	let n = t;
	if (n._tag === "Nested") {
		let t = e.slice();
		for (; n._tag === "Nested";) t.push(n.name), n = n.config;
		return t;
	}
	return e;
}, jm = {
	andCase: (e, t, n) => $p(t, n),
	orCase: (e, t, n) => em(t, n),
	invalidDataCase: (e, t) => tm(t, "<redacted>"),
	missingDataCase: (e, t) => nm(t, "<redacted>"),
	sourceUnavailableCase: (e, t, n, r) => rm(t, "<redacted>", r),
	unsupportedCase: (e, t) => im(t, "<redacted>")
}, Mm = (e) => om(e, void 0, jm), Nm = (e, t, n, r) => {
	let i = n;
	switch (i._tag) {
		case lm: return K(vr(i.value));
		case fm: return q(() => Nm(e, t, i.config, r));
		case um: return H(nm(t, i.message));
		case dm: return x(q(() => Nm(e, t, i.first, r)), od((n) => i.condition(n) ? x(Nm(e, t, i.second, r), od((e) => H(em(n, e)))) : H(n)));
		case pm: return q(() => Nm(e, t, i.config(), r));
		case mm: return q(() => x(Nm(e, t, i.original, r), W(Sd((e) => x(i.mapOrFail(e), Ed(am(Am(t, i.original))))))));
		case hm: return q(() => Nm(e, xm(t, vr(i.name)), i.config, r));
		case gm: return x(cm(t, e.patch), W((t) => x(e.load(t, i, r), W((e) => {
			if (e.length === 0) {
				let e = x(tr(t), Mn(() => "<n/a>"));
				return H(nm([], `Expected ${i.description} with name ${e}`));
			}
			return K(e);
		}))));
		case _m: return q(() => x(Nm(e, t, i.original, r), Ed(Mm), G(yr(i.redact))));
		case vm: return x(cm(t, e.patch), W((n) => x(e.enumerateChildren(n), W(Rm), W((n) => n.length === 0 ? q(() => G(Nm(e, t, i.config, !0), vr)) : x(Sd(n, (n) => Nm(e, Wn(t, `[${n}]`), i.config, !0)), G((e) => {
			let t = br(e);
			return t.length === 0 ? vr(_r()) : vr(t);
		}))))));
		case ym: return q(() => x(cm(t, e.patch), W((t) => x(e.enumerateChildren(t), W((n) => x(n, Sd((n) => Nm(e, xm(t, vr(n)), i.valueConfig, r)), G((e) => e.length === 0 ? vr(Cs()) : x(Lm(e), yr((e) => ws(lr(R(n), e)))))))))));
		case bm: return q(() => x(Nm(e, t, i.left, r), dd, W((n) => x(Nm(e, t, i.right, r), dd, W((e) => {
			if (xn(n) && xn(e)) return H($p(n.left, e.left));
			if (xn(n) && Sn(e)) return H(n.left);
			if (Sn(n) && xn(e)) return H(e.left);
			if (Sn(n) && Sn(e)) {
				let r = Pm(t, x(t, Er("."))), [a, o] = km(r, r, x(n.right, yr(yn)), x(e.right, yr(yn)));
				return x(a, lr(o), Sd(([e, t]) => x(Vd(e, t), G(([e, t]) => i.zip(e, t)))));
			}
			throw Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
		})))));
	}
}, Pm = (e, t) => (n) => bn(nm(e, `The element at index ${n} in a sequence at path "${t}" was missing`)), Fm = (e, t) => e.split(RegExp(`\\s*${Or(t)}\\s*`)), Im = (e, t, n, r, i) => i ? x(Fm(e, r), Sd((e) => n.parse(e.trim())), Ed(am(t))) : x(n.parse(e), Td({
	onFailure: am(t),
	onSuccess: vr
})), Lm = (e) => Object.keys(e[0]).map((t) => e.map((e) => e[t])), Rm = (e) => x(Sd(e, Bm), Td({
	onFailure: () => _r(),
	onSuccess: cr(Dr)
}), dd, G(Cn)), zm = /^(\[(\d+)\])$/, Bm = (e) => {
	let t = e.match(zm);
	if (t !== null) {
		let e = t[2];
		return x(e !== void 0 && e.length > 0 ? L(e) : I(), Ln(Vm));
	}
	return I();
}, Vm = (e) => {
	let t = Number.parseInt(e);
	return Number.isNaN(t) ? I() : L(t);
}, Hm = /*#__PURE__*/ Symbol.for("effect/Console"), Um = /*#__PURE__*/ ni("effect/Console"), Wm = {
	[Hm]: Hm,
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
}, Gm = /*#__PURE__*/ Symbol.for("effect/Random"), Km = /*#__PURE__*/ ni("effect/Random"), qm = class {
	seed;
	[Gm] = Gm;
	PRNG;
	constructor(e) {
		this.seed = e, this.PRNG = new et(e);
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
		return Jm(e, (e) => this.nextIntBetween(0, e));
	}
}, Jm = (e, t) => q(() => x(J(() => Array.from(e)), W((e) => {
	let n = [];
	for (let t = e.length; t >= 2; --t) n.push(t);
	return x(n, Cd((n) => x(t(n), G((t) => Ym(e, n - 1, t)))), ed(Ti(e)));
}))), Ym = (e, t, n) => {
	let r = e[t];
	return e[t] = e[n], e[n] = r, e;
}, Xm = (e) => new qm(E(e)), Zm = /*#__PURE__*/ Symbol.for("effect/Tracer"), Qm = (e) => ({
	[Zm]: Zm,
	...e
}), $m = /*#__PURE__*/ ni("effect/Tracer"), eh = /*#__PURE__*/ ni("effect/ParentSpan"), th = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), nh = class {
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
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = t._tag === "Some" ? t.value.traceId : th(32), this.spanId = th(16), this.links = Array.from(r);
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
}, rh = /*#__PURE__*/ Qm({
	span: (e, t, n, r, i, a) => new nh(e, t, n, r, i, a),
	context: (e) => e()
}), ih = /*#__PURE__*/ mi()("effect/Tracer/DisablePropagation", { defaultValue: Oe }), ah = /*#__PURE__*/ x(/*#__PURE__*/ ai(), /*#__PURE__*/ si(Bp, /*#__PURE__*/ Kp()), /*#__PURE__*/ si(Um, Wm), /*#__PURE__*/ si(Km, /*#__PURE__*/ Xm(/*#__PURE__*/ Math.random())), /*#__PURE__*/ si(Cm, /*#__PURE__*/ Om()), /*#__PURE__*/ si($m, rh)), oh = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/DefaultServices/currentServices"), () => pf(ah));
// node_modules/effect/dist/esm/internal/fiberRefs.js
function sh(e) {
	return new uh(e);
}
function ch() {
	return sh(/* @__PURE__ */ new Map());
}
var lh = /*#__PURE__*/ Symbol.for("effect/FiberRefs"), uh = class {
	locals;
	[lh] = lh;
	constructor(e) {
		this.locals = e;
	}
	pipe() {
		return F(this, arguments);
	}
}, dh = (e, t, n, r = !1) => {
	let i = e, a = t, o = n, s = r, c;
	for (; c === void 0;) if (Jn(a) && Jn(o)) {
		let e = er(a)[0], t = rr(a), n = er(o)[0], r = er(o)[1], i = rr(o);
		e.startTimeMillis < n.startTimeMillis ? (o = i, s = !0) : e.startTimeMillis > n.startTimeMillis ? a = t : e.id < n.id ? (o = i, s = !0) : e.id > n.id ? a = t : c = [r, s];
	} else c = [i.initial, !0];
	return c;
}, fh = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = new Map(e.locals);
	return n.locals.forEach((e, n) => {
		let i = e[0][1];
		if (!e[0][0][A](t)) {
			if (!r.has(n)) {
				if (j(i, n.initial)) return;
				r.set(n, [[t, n.join(n.initial, i)]]);
				return;
			}
			let a = r.get(n), [o, s] = dh(n, a, e);
			if (s) {
				let e = n.diff(o, i), s = a[0][1], c = n.join(s, n.patch(e)(s));
				if (!j(s, c)) {
					let e, i = a[0][0];
					e = i[A](t) ? [[i, c], ...a.slice(1)] : [[t, c], ...a], r.set(n, e);
				}
			}
		}
	}), new uh(r);
}), ph = /*#__PURE__*/ y(2, (e, t) => {
	let n = /* @__PURE__ */ new Map();
	return mh(e, n, t), new uh(n);
}), mh = (e, t, n) => {
	e.locals.forEach((e, r) => {
		let i = e[0][1], a = r.patch(r.fork)(i);
		j(i, a) ? t.set(r, e) : t.set(r, [[n, a], ...e]);
	});
}, hh = /*#__PURE__*/ y(2, (e, t) => {
	let n = new Map(e.locals);
	return n.delete(t), new uh(n);
}), gh = /*#__PURE__*/ y(2, (e, t) => e.locals.has(t) ? L(er(e.locals.get(t))[1]) : I()), _h = /*#__PURE__*/ y(2, (e, t) => x(gh(e, t), Mn(() => t.initial))), vh = /*#__PURE__*/ y(2, (e, { fiberId: t, fiberRef: n, value: r }) => {
	if (e.locals.size === 0) return new uh(/* @__PURE__ */ new Map([[n, [[t, r]]]]));
	let i = new Map(e.locals);
	return yh(i, t, n, r), new uh(i);
}), yh = (e, t, n, r) => {
	let i = e.get(n) ?? [], a;
	if (Jn(i)) {
		let [e, n] = er(i);
		if (e[A](t)) {
			if (j(n, r)) return;
			a = [[t, r], ...i.slice(1)];
		} else a = [[t, r], ...i];
	} else a = [[t, r]];
	e.set(n, a);
}, bh = /*#__PURE__*/ y(2, (e, { entries: t, forkAs: n }) => {
	if (e.locals.size === 0) return new uh(new Map(t));
	let r = new Map(e.locals);
	return n !== void 0 && mh(e, r, n), t.forEach(([e, t]) => {
		t.length === 1 ? yh(r, t[0][0], e, t[0][1]) : t.forEach(([t, n]) => {
			yh(r, t, e, n);
		});
	}), new uh(r);
}), xh = _h, Sh = bh, Ch = ch, wh = qd, Th = Jd, Eh = Yd, Dh = Xd, Oh = Zd, kh = Qd, Ah = $d, jh = ef, Mh = /*#__PURE__*/ On(/* @__PURE__ */ x(Dr, /*#__PURE__*/ Dn((e) => e.ordinal))), Nh = (e) => {
	switch (e) {
		case "All": return wh;
		case "Debug": return kh;
		case "Error": return Eh;
		case "Fatal": return Th;
		case "Info": return Oh;
		case "Trace": return Ah;
		case "None": return jh;
		case "Warning": return Dh;
	}
}, Ph = (e) => e.replace(/[\s="]/g, "_"), Fh = (e) => (t) => `${Ph(t.label)}=${e - t.startTime}ms`, Ih = Yt, Lh = $t, Rh = class extends Lh {}, zh = /*#__PURE__*/ Symbol.for("effect/Readable"), Bh = /*#__PURE__*/ Symbol.for("effect/Ref"), Vh = {
/* c8 ignore next */
_A: (e) => e }, Hh = class extends Rh {
	ref;
	commit() {
		return this.get;
	}
	[Bh] = Vh;
	[zh] = zh;
	constructor(e) {
		super(), this.ref = e, this.get = J(() => rs(this.ref));
	}
	get;
	modify(e) {
		return J(() => {
			let t = rs(this.ref), [n, r] = e(t);
			return t !== r && is(r)(this.ref), n;
		});
	}
}, Uh = (e) => new Hh(ns(e)), Wh = (e) => J(() => Uh(e)), Gh = (e) => e.get, Kh = /*#__PURE__*/ y(2, (e, t) => e.modify(() => [void 0, t])), qh = /*#__PURE__*/ y(2, (e, t) => e.modify(t)), Jh = /*#__PURE__*/ y(2, (e, t) => e.modify((e) => [void 0, t(e)])), Yh = "Empty", Xh = "Remove", Zh = "Update", Qh = "AndThen", $h = { _tag: Yh }, eg = (e, t) => {
	let n = new Map(e.locals), r = $h;
	for (let [e, i] of t.locals.entries()) {
		let t = er(i)[1], a = n.get(e);
		if (a !== void 0) {
			let n = er(a)[1];
			j(n, t) || (r = tg({
				_tag: Zh,
				fiberRef: e,
				patch: e.diff(n, t)
			})(r));
		} else r = tg({
			_tag: "Add",
			fiberRef: e,
			value: t
		})(r);
		n.delete(e);
	}
	for (let [e] of n.entries()) r = tg({
		_tag: Xh,
		fiberRef: e
	})(r);
	return r;
}, tg = /*#__PURE__*/ y(2, (e, t) => ({
	_tag: Qh,
	first: e,
	second: t
})), ng = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = n, i = vr(e);
	for (; Jn(i);) {
		let e = er(i), n = rr(i);
		switch (e._tag) {
			case Yh:
				i = n;
				break;
			case "Add":
				r = vh(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.value
				}), i = n;
				break;
			case Xh:
				r = hh(r, e.fiberRef), i = n;
				break;
			case Zh: {
				let a = _h(r, e.fiberRef);
				r = vh(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.fiberRef.patch(e.patch)(a)
				}), i = n;
				break;
			}
			case Qh: i = Un(e.first)(Un(e.second)(n));
		}
	}
	return r;
}), rg = "effect/MetricLabel", ig = /*#__PURE__*/ Symbol.for(rg), ag = class {
	key;
	value;
	[ig] = ig;
	_hash;
	constructor(e, t) {
		this.key = e, this.value = t, this._hash = O(rg + this.key + this.value);
	}
	[T]() {
		return this._hash;
	}
	[A](e) {
		return sg(e) && this.key === e.key && this.value === e.value;
	}
	pipe() {
		return F(this, arguments);
	}
}, og = (e, t) => new ag(e, t), sg = (e) => C(e, ig), cg = (e) => G(e, L), lg = (e) => {
	let t, n;
	return typeof e == "function" ? t = e : (t = e.try, n = e.catch), q(() => {
		try {
			return K(w(t));
		} catch (e) {
			return H(n ? w(() => n(e)) : new Jf(e, "An unknown error occurred in Effect.try"));
		}
	});
}, ug = (e) => vg(e, fg, eg), dg = /*#__PURE__*/ y(2, (e, t) => xd(e, {
	onFailure: (e) => K(t.onFailure(e)),
	onSuccess: (e) => K(t.onSuccess(e))
})), fg = /*#__PURE__*/ V((e) => K(e.getFiberRefs())), pg = (e) => dg(e, {
	onFailure: Ae,
	onSuccess: Ae
}), mg = (e) => xg((t, n) => x(e, ng(t, n))), hg = (e) => e.length >= 1 ? ad((t, n) => {
	try {
		e(n).then((e) => t(K(e)), (e) => t(ld(e)));
	} catch (e) {
		t(ld(e));
	}
}) : ad((t) => {
	try {
		e().then((e) => t(K(e)), (e) => t(ld(e)));
	} catch (e) {
		t(ld(e));
	}
}), gg = /*#__PURE__*/ y(3, (e, t, n) => xp((r) => Sp(e, si(r, t, n)))), _g = /*#__PURE__*/ K(/*#__PURE__*/ I()), vg = /*#__PURE__*/ y(3, (e, t, n) => W(t, (r) => W(e, (e) => G(t, (t) => [n(r, t), e])))), yg = /*#__PURE__*/ y(2, (e, t) => bd(e, {
	onFailure: (e) => {
		let n = hu(e);
		switch (n._tag) {
			case "Left": return Ud(t(n.left), U(e));
			case "Right": return U(e);
		}
	},
	onSuccess: K
})), bg = (e) => {
	let t, n;
	typeof e == "function" ? t = e : (t = e.try, n = e.catch);
	let r = (e) => n ? pd(() => n(e)) : H(new Jf(e, "An unknown error occurred in Effect.tryPromise"));
	return t.length >= 1 ? ad((e, n) => {
		try {
			t(n).then((t) => e(K(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	}) : ad((e) => {
		try {
			t().then((t) => e(K(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	});
}, xg = (e) => V((t) => (t.setFiberRefs(e(t.id(), t.getFiberRefs())), Y)), Sg = /*#__PURE__*/ Ln((e) => ci(e.context, ih) ? e._tag === "Span" ? Sg(e.parent) : I() : L(e)), Cg = "Sequential", wg = "Parallel", Tg = "ParallelN", Eg = { _tag: Cg }, Dg = { _tag: wg }, Og = (e) => ({
	_tag: Tg,
	parallelism: e
}), kg = (e) => e._tag === Cg, Ag = (e) => e._tag === wg, jg = Eg, Mg = Dg, Ng = Og, Pg = eg, Fg = ng, Ig = "effect/FiberStatus", Lg = /*#__PURE__*/ Symbol.for(Ig), Rg = "Done", zg = "Running", Bg = "Suspended", Vg = /*#__PURE__*/ O(`${Ig}-${Rg}`), Hg = class {
	[Lg] = Lg;
	_tag = Rg;
	[T]() {
		return Vg;
	}
	[A](e) {
		return Jg(e) && e._tag === "Done";
	}
}, Ug = class {
	runtimeFlags;
	[Lg] = Lg;
	_tag = zg;
	constructor(e) {
		this.runtimeFlags = e;
	}
	[T]() {
		return x(E(Ig), D(E(this._tag)), D(E(this.runtimeFlags)), k(this));
	}
	[A](e) {
		return Jg(e) && e._tag === "Running" && this.runtimeFlags === e.runtimeFlags;
	}
}, Wg = class {
	runtimeFlags;
	blockingOn;
	[Lg] = Lg;
	_tag = Bg;
	constructor(e, t) {
		this.runtimeFlags = e, this.blockingOn = t;
	}
	[T]() {
		return x(E(Ig), D(E(this._tag)), D(E(this.runtimeFlags)), D(E(this.blockingOn)), k(this));
	}
	[A](e) {
		return Jg(e) && e._tag === "Suspended" && this.runtimeFlags === e.runtimeFlags && j(this.blockingOn, e.blockingOn);
	}
}, Gg = /*#__PURE__*/ new Hg(), Kg = (e) => new Ug(e), qg = (e, t) => new Wg(e, t), Jg = (e) => C(e, Lg), Yg = (e) => e._tag === Rg, Xg = Gg, Zg = Kg, Qg = qg, $g = Yg, e_ = /*#__PURE__*/ Symbol.for("effect/Micro"), t_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroExit"), n_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroCause"), r_ = { _E: b }, i_ = class extends globalThis.Error {
	_tag;
	traces;
	[n_];
	constructor(e, t, n) {
		let r = `MicroCause.${e}`, i, a, o;
		if (t instanceof globalThis.Error) {
			i = `(${r}) ${t.name}`, a = t.message;
			let e = a.split("\n").length;
			o = t.stack ? `(${r}) ${t.stack.split("\n").slice(0, e + 3).join("\n")}` : `${i}: ${a}`;
		} else i = r, a = yt(t, 0), o = `${i}: ${a}`;
		n.length > 0 && (o += `\n    ${n.join("\n    ")}`), super(a), this._tag = e, this.traces = n, this[n_] = r_, this.name = i, this.stack = o;
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
}, a_ = class extends i_ {
	defect;
	constructor(e, t = []) {
		super("Die", e, t), this.defect = e;
	}
}, o_ = (e, t = []) => new a_(e, t), s_ = class extends i_ {
	constructor(e = []) {
		super("Interrupt", "interrupted", e);
	}
}, c_ = (e = []) => new s_(e), l_ = (e) => e._tag === "Interrupt", u_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroFiber"), d_ = {
	_A: b,
	_E: b
}, f_ = class {
	context;
	interruptible;
	[u_];
	_stack = [];
	_observers = [];
	_exit;
	_children;
	currentOpCount = 0;
	constructor(e, t = !0) {
		this.context = e, this.interruptible = t, this[u_] = d_;
	}
	getRef(e) {
		return Xr(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), Ae) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	_interrupted = !1;
	unsafeInterrupt() {
		this._exit || (this._interrupted = !0, this.interruptible && this.evaluate(I_));
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
		if (t === y_) return;
		let n = p_.interruptChildren && p_.interruptChildren(this);
		if (n !== void 0) return this.evaluate(j_(n, () => t));
		this._exit = t;
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = !1, n = e;
		this.currentOpCount = 0;
		try {
			for (;;) {
				if (this.currentOpCount++, !t && this.getRef(W_).shouldYield(this)) {
					t = !0;
					let e = n;
					n = j_(O_, () => e);
				}
				if (n = n[h_](this), n === y_) {
					let e = this._yielded;
					return t_ in e ? (this._yielded = void 0, e) : y_;
				}
			}
		} catch (e) {
			return C(n, h_) ? L_(e) : L_(`MicroFiber.runLoop: Not a valid effect: ${String(n)}`);
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[v_] && t[v_](this);
			if (n) return { [e]: n };
			if (t[e]) return t;
		}
	}
	_yielded = void 0;
	yieldWith(e) {
		return this._yielded = e, y_;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
}, p_ = /*#__PURE__*/ S("effect/Micro/fiberMiddleware", () => ({ interruptChildren: void 0 })), m_ = /*#__PURE__*/ Symbol.for("effect/Micro/identifier"), Q = /*#__PURE__*/ Symbol.for("effect/Micro/args"), h_ = /*#__PURE__*/ Symbol.for("effect/Micro/evaluate"), g_ = /*#__PURE__*/ Symbol.for("effect/Micro/successCont"), __ = /*#__PURE__*/ Symbol.for("effect/Micro/failureCont"), v_ = /*#__PURE__*/ Symbol.for("effect/Micro/ensureCont"), y_ = /*#__PURE__*/ Symbol.for("effect/Micro/Yield"), b_ = {
	_A: b,
	_E: b,
	_R: b
}, x_ = {
	...Ih,
	_op: "Micro",
	[e_]: b_,
	pipe() {
		return F(this, arguments);
	},
	[Symbol.iterator]() {
		return new qe(new it(this));
	},
	toJSON() {
		return {
			_id: "Micro",
			op: this[m_],
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
function S_(e) {
	return L_("Micro.evaluate: Not implemented");
}
var C_ = (e) => ({
	...x_,
	[m_]: e.op,
	[h_]: e.eval ?? S_,
	[g_]: e.contA,
	[__]: e.contE,
	[v_]: e.ensure
}), w_ = (e) => {
	let t = C_(e);
	return function() {
		let n = Object.create(t);
		return n[Q] = e.single === !1 ? arguments : arguments[0], n;
	};
}, T_ = (e) => {
	let t = {
		...C_(e),
		[t_]: t_,
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
			return N_(t) && t._tag === e.op && j(this[Q], t[Q]);
		},
		[T]() {
			return k(this, D(O(e.op))(E(this[Q])));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[Q] = e, n[g_] = void 0, n[__] = void 0, n[v_] = void 0, n;
	};
}, E_ = /*#__PURE__*/ T_({
	op: "Success",
	prop: "value",
	eval(e) {
		let t = e.getCont(g_);
		return t ? t[g_](this[Q], e) : e.yieldWith(this);
	}
}), D_ = /*#__PURE__*/ T_({
	op: "Failure",
	prop: "cause",
	eval(e) {
		let t = e.getCont(__);
		for (; l_(this[Q]) && t && e.interruptible;) t = e.getCont(__);
		return t ? t[__](this[Q], e) : e.yieldWith(this);
	}
}), O_ = /*#__PURE__*/ (/* @__PURE__ */ w_({
	op: "Yield",
	eval(e) {
		let t = !1;
		return e.getRef(W_).scheduleTask(() => {
			t || e.evaluate(R_);
		}, this[Q] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), k_ = /*#__PURE__*/ E_(void 0), A_ = /*#__PURE__*/ w_({
	op: "WithMicroFiber",
	eval(e) {
		return this[Q](e);
	}
}), j_ = /*#__PURE__*/ y(2, (e, t) => {
	let n = Object.create(M_);
	return n[Q] = e, n[g_] = t, n;
}), M_ = /*#__PURE__*/ C_({
	op: "OnSuccess",
	eval(e) {
		return e._stack.push(this), this[Q];
	}
}), N_ = (e) => C(e, t_), P_ = E_, F_ = D_, I_ = /*#__PURE__*/ F_(/*#__PURE__*/ c_()), L_ = (e) => F_(o_(e)), R_ = /*#__PURE__*/ P_(void 0), z_ = "setImmediate" in globalThis ? globalThis.setImmediate : (e) => setTimeout(e, 0), B_ = class {
	tasks = [];
	running = !1;
	scheduleTask(e, t) {
		this.tasks.push(e), this.running || (this.running = !0, z_(this.afterScheduled));
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
		return e.currentOpCount >= e.getRef(U_);
	}
	flush() {
		for (; this.tasks.length > 0;) this.runTasks();
	}
}, V_ = /*#__PURE__*/ y(2, (e, t) => A_((n) => {
	let r = n.context;
	return n.context = t(r), q_(e, () => (n.context = r, k_));
})), H_ = /*#__PURE__*/ y(2, (e, t) => V_(e, di(t))), U_ = class extends (/*#__PURE__*/ mi()("effect/Micro/currentMaxOpsBeforeYield", { defaultValue: () => 2048 })) {}, W_ = class extends (/*#__PURE__*/ mi()("effect/Micro/currentScheduler", { defaultValue: () => new B_() })) {}, G_ = /*#__PURE__*/ y(2, (e, t) => {
	let n = Object.create(K_);
	return n[Q] = e, n[g_] = t.onSuccess, n[__] = t.onFailure, n;
}), K_ = /*#__PURE__*/ C_({
	op: "OnSuccessAndFailure",
	eval(e) {
		return e._stack.push(this), this[Q];
	}
}), q_ = /*#__PURE__*/ y(2, (e, t) => X_((n) => G_(n(e), {
	onFailure: (e) => j_(t(F_(e)), () => D_(e)),
	onSuccess: (e) => j_(t(P_(e)), () => E_(e))
}))), J_ = /*#__PURE__*/ w_({
	op: "SetInterruptible",
	ensure(e) {
		if (e.interruptible = this[Q], e._interrupted && e.interruptible) return () => I_;
	}
}), Y_ = (e) => A_((t) => t.interruptible ? e : (t.interruptible = !0, t._stack.push(J_(!1)), t._interrupted ? I_ : e)), X_ = (e) => A_((t) => t.interruptible ? (t.interruptible = !1, t._stack.push(J_(!0)), e(Y_)) : e(b)), Z_ = (e, t) => {
	let n = new f_(W_.context(t?.scheduler ?? new B_()));
	if (n.evaluate(e), t?.signal) {
		if (t.signal.aborted) n.unsafeInterrupt();
		else {
			let e = () => n.unsafeInterrupt();
			t.signal.addEventListener("abort", e, { once: !0 }), n.addObserver(() => t.signal.removeEventListener("abort", e));
		}
	}
	return n;
}, Q_ = class e {
	scheduleDrain;
	running = !1;
	tasks = /*#__PURE__*/ new $_();
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
}, $_ = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets.length, r, i = 0;
		for (; i < n && this.buckets[i][0] <= t; i++) r = this.buckets[i];
		r && r[0] === t ? r[1].push(e) : i === n ? this.buckets.push([t, [e]]) : this.buckets.splice(i, 0, [t, [e]]);
	}
}, ev = class {
	maxNextTickBeforeTimer;
	getRunner = /*#__PURE__*/ Q_.cached((e, t) => {
		e >= this.maxNextTickBeforeTimer ? setTimeout(() => t(0), 0) : Promise.resolve(void 0).then(() => t(e + 1));
	});
	constructor(e) {
		this.maxNextTickBeforeTimer = e;
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(vf) && e.getFiberRef(_f);
	}
	scheduleTask(e, t, n) {
		this.getRunner(n).scheduleTask(e, t);
	}
}, tv = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Scheduler/defaultScheduler"), () => new ev(2048)), nv = class {
	tasks = /*#__PURE__*/ new $_();
	deferred = !1;
	scheduleTask(e, t, n) {
		this.deferred ? tv.scheduleTask(e, t, n) : this.tasks.scheduleTask(e, t);
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(vf) && e.getFiberRef(_f);
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) {
			let e = this.tasks.buckets;
			this.tasks.buckets = [];
			for (let [t, n] of e) for (let e = 0; e < n.length; e++) n[e]();
		}
		this.deferred = !0;
	}
}, rv = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentScheduler"), () => uf(tv)), iv = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestMap"), () => uf(/* @__PURE__ */ new Map())), av = (e, t, n, r) => {
	switch (e) {
		case void 0: return t();
		case "unbounded": return n();
		case "inherit": return af(Cf, (e) => e === "unbounded" ? n() : e > 1 ? r(e) : t());
		default: return e > 1 ? r(e) : t();
	}
}, ov = "InterruptSignal", sv = "Stateful", cv = "Resume", lv = "YieldNow", uv = (e) => ({
	_tag: ov,
	cause: e
}), dv = (e) => ({
	_tag: sv,
	onFiber: e
}), fv = (e) => ({
	_tag: cv,
	effect: e
}), pv = () => ({ _tag: lv }), mv = /*#__PURE__*/ Symbol.for("effect/FiberScope"), hv = class {
	[mv] = mv;
	fiberId = ys;
	roots = /*#__PURE__*/ new Set();
	add(e, t) {
		this.roots.add(t), t.addObserver(() => {
			this.roots.delete(t);
		});
	}
}, gv = class {
	fiberId;
	parent;
	[mv] = mv;
	constructor(e, t) {
		this.fiberId = e, this.parent = t;
	}
	add(e, t) {
		this.parent.tell(dv((e) => {
			e.addChild(t), t.addObserver(() => {
				e.removeChild(t);
			});
		}));
	}
}, _v = (e) => new gv(e.id(), e), vv = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberScope/Global"), () => new hv()), yv = /*#__PURE__*/ Symbol.for("effect/Fiber"), bv = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, xv = {
	[yv]: bv,
	pipe() {
		return F(this, arguments);
	}
}, Sv = /*#__PURE__*/ Symbol.for("effect/Fiber"), Cv = (e) => Hd(vd(e.await), e.inheritAll);
({ ...Zt }), { ...xv };
var wv = "effect/FiberCurrent", Tv = /*#__PURE__*/ Symbol.for("effect/Logger"), Ev = {
	/* c8 ignore next */
	_Message: (e) => e,
	/* c8 ignore next */
	_Output: (e) => e
}, Dv = (e) => ({
	[Tv]: Ev,
	log: e,
	pipe() {
		return F(this, arguments);
	}
}), Ov = /^[^\s"=]*$/, kv = /*#__PURE__*/ Dv(/*#__PURE__*/ ((e, t) => ({ annotations: n, cause: r, date: i, fiberId: a, logLevel: o, message: s, spans: c }) => {
	let l = (t) => t.match(Ov) ? t : e(t), u = (e, t) => `${Ph(e)}=${l(t)}`, d = (e, t) => " " + u(e, t), f = u("timestamp", i.toISOString());
	f += d("level", o.label), f += d("fiber", _s(a));
	let p = Hn(s);
	for (let e = 0; e < p.length; e++) f += d("message", yt(p[e], t));
	su(r) || (f += d("cause", Au(r, { renderErrorCause: !0 })));
	for (let e of c) f += " " + Fh(i.getTime())(e);
	for (let [e, r] of n) f += d(e, yt(r, t));
	return f;
})((e) => `"${e.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`)), Av = {
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
Av.gray, Av.blue, Av.green, Av.yellow, Av.red, Av.bgBrightRed, Av.black;
var jv = typeof process == "object" && process !== null && typeof process.stdout == "object" && process.stdout !== null;
jv && process.stdout.isTTY, jv || "Deno" in globalThis;
// node_modules/effect/dist/esm/internal/metric/boundaries.js
var Mv = "effect/MetricBoundaries", Nv = /*#__PURE__*/ Symbol.for(Mv), Pv = class {
	values;
	[Nv] = Nv;
	constructor(e) {
		this.values = e, this._hash = x(O(Mv), D(ht(this.values)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return Fv(e) && j(this.values, e.values);
	}
	pipe() {
		return F(this, arguments);
	}
}, Fv = (e) => C(e, Nv), Iv = (e) => new Pv(x(e, Gn(wi(Infinity)), Tr)), Lv = (e) => x(Vn(e.count - 1, (t) => e.start * e.factor ** +t), Ai, Iv), Rv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType"), zv = "effect/MetricKeyType/Counter", Bv = /*#__PURE__*/ Symbol.for(zv), Vv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Frequency"), Hv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Gauge"), Uv = "effect/MetricKeyType/Histogram", Wv = /*#__PURE__*/ Symbol.for(Uv), Gv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Summary"), Kv = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, qv = class {
	incremental;
	bigint;
	[Rv] = Kv;
	[Bv] = Bv;
	constructor(e, t) {
		this.incremental = e, this.bigint = t, this._hash = O(zv);
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return Zv(e);
	}
	pipe() {
		return F(this, arguments);
	}
}, Jv = class {
	boundaries;
	[Rv] = Kv;
	[Wv] = Wv;
	constructor(e) {
		this.boundaries = e, this._hash = x(O(Uv), D(E(this.boundaries)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return ey(e) && j(this.boundaries, e.boundaries);
	}
	pipe() {
		return F(this, arguments);
	}
}, Yv = (e) => new qv(e?.incremental ?? !1, e?.bigint ?? !1), Xv = (e) => new Jv(e), Zv = (e) => C(e, Bv), Qv = (e) => C(e, Vv), $v = (e) => C(e, Hv), ey = (e) => C(e, Wv), ty = (e) => C(e, Gv), ny = /*#__PURE__*/ Symbol.for("effect/MetricKey"), ry = {
/* c8 ignore next */
_Type: (e) => e }, iy = /*#__PURE__*/ Cr(j), ay = class {
	name;
	keyType;
	description;
	tags;
	[ny] = ry;
	constructor(e, t, n, r = []) {
		this.name = e, this.keyType = t, this.description = n, this.tags = r, this._hash = x(O(this.name + this.description), D(E(this.keyType)), D(ht(this.tags)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return oy(e) && this.name === e.name && j(this.keyType, e.keyType) && j(this.description, e.description) && iy(this.tags, e.tags);
	}
	pipe() {
		return F(this, arguments);
	}
}, oy = (e) => C(e, ny), sy = (e, t) => new ay(e, Yv(t), Pn(t?.description)), cy = (e, t, n) => new ay(e, Xv(t), Pn(n)), ly = /*#__PURE__*/ y(2, (e, t) => t.length === 0 ? e : new ay(e.name, e.keyType, e.description, gr(e.tags, t))), uy = /*#__PURE__*/ Symbol.for("effect/MetricState"), dy = "effect/MetricState/Counter", fy = /*#__PURE__*/ Symbol.for(dy), py = "effect/MetricState/Frequency", my = /*#__PURE__*/ Symbol.for(py), hy = "effect/MetricState/Gauge", gy = /*#__PURE__*/ Symbol.for(hy), _y = "effect/MetricState/Histogram", vy = /*#__PURE__*/ Symbol.for(_y), yy = "effect/MetricState/Summary", by = /*#__PURE__*/ Symbol.for(yy), xy = {
/* c8 ignore next */
_A: (e) => e }, Sy = class {
	count;
	[uy] = xy;
	[fy] = fy;
	constructor(e) {
		this.count = e;
	}
	[T]() {
		return x(E(dy), D(E(this.count)), k(this));
	}
	[A](e) {
		return Ny(e) && this.count === e.count;
	}
	pipe() {
		return F(this, arguments);
	}
}, Cy = /*#__PURE__*/ Cr(j), wy = class {
	occurrences;
	[uy] = xy;
	[my] = my;
	constructor(e) {
		this.occurrences = e;
	}
	_hash;
	[T]() {
		return x(O(py), D(ht(R(this.occurrences.entries()))), k(this));
	}
	[A](e) {
		return Py(e) && Cy(R(this.occurrences.entries()), R(e.occurrences.entries()));
	}
	pipe() {
		return F(this, arguments);
	}
}, Ty = class {
	value;
	[uy] = xy;
	[gy] = gy;
	constructor(e) {
		this.value = e;
	}
	[T]() {
		return x(E(hy), D(E(this.value)), k(this));
	}
	[A](e) {
		return Fy(e) && this.value === e.value;
	}
	pipe() {
		return F(this, arguments);
	}
}, Ey = class {
	buckets;
	count;
	min;
	max;
	sum;
	[uy] = xy;
	[vy] = vy;
	constructor(e, t, n, r, i) {
		this.buckets = e, this.count = t, this.min = n, this.max = r, this.sum = i;
	}
	[T]() {
		return x(E(_y), D(E(this.buckets)), D(E(this.count)), D(E(this.min)), D(E(this.max)), D(E(this.sum)), k(this));
	}
	[A](e) {
		return Iy(e) && j(this.buckets, e.buckets) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return F(this, arguments);
	}
}, Dy = class {
	error;
	quantiles;
	count;
	min;
	max;
	sum;
	[uy] = xy;
	[by] = by;
	constructor(e, t, n, r, i, a) {
		this.error = e, this.quantiles = t, this.count = n, this.min = r, this.max = i, this.sum = a;
	}
	[T]() {
		return x(E(yy), D(E(this.error)), D(E(this.quantiles)), D(E(this.count)), D(E(this.min)), D(E(this.max)), D(E(this.sum)), k(this));
	}
	[A](e) {
		return Ly(e) && this.error === e.error && j(this.quantiles, e.quantiles) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return F(this, arguments);
	}
}, Oy = (e) => new Sy(e), ky = (e) => new wy(e), Ay = (e) => new Ty(e), jy = (e) => new Ey(e.buckets, e.count, e.min, e.max, e.sum), My = (e) => new Dy(e.error, e.quantiles, e.count, e.min, e.max, e.sum), Ny = (e) => C(e, fy), Py = (e) => C(e, my), Fy = (e) => C(e, gy), Iy = (e) => C(e, vy), Ly = (e) => C(e, by), Ry = /*#__PURE__*/ Symbol.for("effect/MetricHook"), zy = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, By = (e) => ({
	[Ry]: zy,
	pipe() {
		return F(this, arguments);
	},
	...e
}), Vy = /*#__PURE__*/ BigInt(0), Hy = (e) => {
	let t = e.keyType.bigint ? Vy : 0, n = e.keyType.incremental ? e.keyType.bigint ? (e) => e >= Vy : (e) => e >= 0 : (e) => !0, r = (e) => {
		n(e) && (t += e);
	};
	return By({
		get: () => Oy(t),
		update: r,
		modify: r
	});
}, Uy = (e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.keyType.preregisteredWords) t.set(n, 0);
	let n = (e) => {
		let n = t.get(e) ?? 0;
		t.set(e, n + 1);
	};
	return By({
		get: () => ky(t),
		update: n,
		modify: n
	});
}, Wy = (e, t) => {
	let n = t;
	return By({
		get: () => Ay(n),
		update: (e) => {
			n = e;
		},
		modify: (e) => {
			n += e;
		}
	});
}, Gy = (e) => {
	let t = e.keyType.boundaries.values, n = t.length, r = new Uint32Array(n + 1), i = new Float64Array(n), a = 0, o = 0, s = Number.MAX_VALUE, c = Number.MIN_VALUE;
	x(t, cr(Dr), yr((e, t) => {
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
		let e = Bn(n), t = 0;
		for (let a = 0; a < n; a++) {
			let n = i[a], o = r[a];
			t += o, e[a] = [n, t];
		}
		return e;
	};
	return By({
		get: () => jy({
			buckets: u(),
			count: a,
			min: s,
			max: c,
			sum: o
		}),
		update: l,
		modify: l
	});
}, Ky = (e) => {
	let { error: t, maxAge: n, maxSize: r, quantiles: i } = e.keyType, a = x(i, cr(Dr)), o = Bn(r), s = 0, c = 0, l = 0, u = 0, d = 0, f = (e) => {
		let i = [], s = 0;
		for (; s !== r - 1;) {
			let t = o[s];
			if (t != null) {
				let [r, a] = t, o = ca(e - r);
				xa(o, ia) && ba(o, n) && i.push(a);
			}
			s += 1;
		}
		return qy(t, a, cr(i, Dr));
	}, p = (e, t) => {
		if (r > 0) {
			s += 1;
			let n = s % r;
			o[n] = [t, e];
		}
		u = c === 0 ? e : Math.min(u, e), d = c === 0 ? e : Math.max(d, e), c += 1, l += e;
	};
	return By({
		get: () => My({
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
}, qy = (e, t, n) => {
	let r = n.length;
	if (!Jn(t)) return _r();
	let i = t[0], a = t.slice(1), o = Jy(e, r, I(), 0, i, n), s = vr(o);
	return a.forEach((t) => {
		s.push(Jy(e, r, o.value, o.consumed, t, o.rest));
	}), yr(s, (e) => [e.quantile, e.value]);
}, Jy = (e, t, n, r, i, a) => {
	let o = e, s = t, c = n, l = r, u = i, d = a, f = e, p = t, m = n, ee = r, te = i, ne = a;
	for (;;) {
		if (!Jn(d)) return {
			quantile: u,
			value: I(),
			consumed: l,
			rest: []
		};
		if (u === 1) return {
			quantile: u,
			value: L(nr(d)),
			consumed: l + d.length,
			rest: []
		};
		let e = er(d), t = ar(d, (t) => t === e), n = u * s, r = o / 2 * n, i = l + t[0].length, a = Math.abs(i - n);
		if (i < n - r) f = o, p = s, m = $n(d), ee = i, te = u, ne = t[1], o = f, s = p, c = m, l = ee, u = te, d = ne;
		else {
			if (i > n + r) {
				let t = kn(c) ? L(e) : c;
				return {
					quantile: u,
					value: t,
					consumed: l,
					rest: d
				};
			}
			switch (c._tag) {
				case "None":
					f = o, p = s, m = $n(d), ee = i, te = u, ne = t[1], o = f, s = p, c = m, l = ee, u = te, d = ne;
					continue;
				case "Some":
					if (a < Math.abs(n - c.value)) {
						f = o, p = s, m = $n(d), ee = i, te = u, ne = t[1], o = f, s = p, c = m, l = ee, u = te, d = ne;
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
}, Yy = /*#__PURE__*/ Symbol.for("effect/MetricPair"), Xy = {
/* c8 ignore next */
_Type: (e) => e }, Zy = (e, t) => ({
	[Yy]: Xy,
	metricKey: e,
	metricState: t,
	pipe() {
		return F(this, arguments);
	}
}), Qy = /*#__PURE__*/ Symbol.for("effect/MetricRegistry"), $y = class {
	[Qy] = Qy;
	map = /*#__PURE__*/ Np();
	snapshot() {
		let e = [];
		for (let [t, n] of this.map) e.push(Zy(t, n.get()));
		return e;
	}
	get(e) {
		let t = x(this.map, Pp(e), Fn);
		if (t == null) {
			if (Zv(e.keyType)) return this.getCounter(e);
			if ($v(e.keyType)) return this.getGauge(e);
			if (Qv(e.keyType)) return this.getFrequency(e);
			if (ey(e.keyType)) return this.getHistogram(e);
			if (ty(e.keyType)) return this.getSummary(e);
			throw Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
		}
		return t;
	}
	getCounter(e) {
		let t = x(this.map, Pp(e), Fn);
		if (t == null) {
			let n = Hy(e);
			x(this.map, Ip(e)) || x(this.map, Lp(e, n)), t = n;
		}
		return t;
	}
	getFrequency(e) {
		let t = x(this.map, Pp(e), Fn);
		if (t == null) {
			let n = Uy(e);
			x(this.map, Ip(e)) || x(this.map, Lp(e, n)), t = n;
		}
		return t;
	}
	getGauge(e) {
		let t = x(this.map, Pp(e), Fn);
		if (t == null) {
			let n = Wy(e, e.keyType.bigint ? BigInt(0) : 0);
			x(this.map, Ip(e)) || x(this.map, Lp(e, n)), t = n;
		}
		return t;
	}
	getHistogram(e) {
		let t = x(this.map, Pp(e), Fn);
		if (t == null) {
			let n = Gy(e);
			x(this.map, Ip(e)) || x(this.map, Lp(e, n)), t = n;
		}
		return t;
	}
	getSummary(e) {
		let t = x(this.map, Pp(e), Fn);
		if (t == null) {
			let n = Ky(e);
			x(this.map, Ip(e)) || x(this.map, Lp(e, n)), t = n;
		}
		return t;
	}
}, eb = () => new $y(), tb = /*#__PURE__*/ Symbol.for("effect/Metric"), nb = {
	/* c8 ignore next */
	_Type: (e) => e,
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, rb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Metric/globalMetricRegistry"), () => eb()), ib = function(e, t, n, r) {
	let i = Object.assign((e) => kd(e, (e) => ub(i, e)), {
		[tb]: nb,
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
}, ab = (e, t) => ob(sy(e, t)), ob = (e) => {
	let t, n = /* @__PURE__ */ new WeakMap(), r = (r) => {
		if (r.length === 0) return t === void 0 && (t = rb.get(e)), t;
		let i = n.get(r);
		return i === void 0 && (i = rb.get(ly(e, r)), n.set(r, i)), i;
	};
	return ib(e.keyType, (e, t) => r(t).update(e), (e) => r(e).get(), (e, t) => r(t).modify(e));
}, sb = (e, t, n) => ob(cy(e, t, n)), cb = /*#__PURE__*/ y(3, (e, t, n) => lb(e, [og(t, n)])), lb = /*#__PURE__*/ y(2, (e, t) => ib(e.keyType, (n, r) => e.unsafeUpdate(n, gr(t, r)), (n) => e.unsafeValue(gr(t, n)), (n, r) => e.unsafeModify(n, gr(t, r)))), ub = /*#__PURE__*/ y(2, (e, t) => af(Df, (n) => J(() => e.unsafeUpdate(t, n))));
({ ...Xt });
var db = /*#__PURE__*/ y(2, (e, t) => af(iv, (n) => J(() => {
	if (n.has(e)) {
		let r = n.get(e);
		r.state.completed || (r.state.completed = !0, _p(r.result, t));
	}
}))), fb = /*#__PURE__*/ Symbol.for("effect/Supervisor"), pb = {
/* c8 ignore next */
_T: (e) => e }, mb = class e {
	underlying;
	value0;
	[fb] = pb;
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
		return new hb(this, e);
	}
}, hb = class e {
	left;
	right;
	_tag = "Zip";
	[fb] = pb;
	constructor(e, t) {
		this.left = e, this.right = t;
	}
	get value() {
		return Vd(this.left.value, this.right.value);
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
		return new mb(this, x(this.value, G(e)));
	}
	zip(t) {
		return new e(this, t);
	}
}, gb = (e) => C(e, fb) && He(e, "Zip"), _b = class {
	effect;
	[fb] = pb;
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
		return new mb(this, x(this.value, G(e)));
	}
	zip(e) {
		return new hb(this, e);
	}
	onRun(e, t) {
		return e();
	}
}, vb = (e) => new _b(e), yb = /*#__PURE__*/ S("effect/Supervisor/none", () => vb(Y)), bb = Gc, xb = "Empty", Sb = "AddSupervisor", Cb = "RemoveSupervisor", wb = "AndThen", Tb = { _tag: xb }, Eb = (e, t) => ({
	_tag: wb,
	first: e,
	second: t
}), Db = (e, t) => Ob(t, wi(e)), Ob = (e, t) => {
	let n = e, r = t;
	for (; Ri(r);) {
		let e = Vi(r);
		switch (e._tag) {
			case xb:
				r = Hi(r);
				break;
			case Sb:
				n = n.zip(e.supervisor), r = Hi(r);
				break;
			case Cb:
				n = kb(n, e.supervisor), r = Hi(r);
				break;
			case wb: r = Pi(e.first)(Pi(e.second)(Hi(r)));
		}
	}
	return n;
}, kb = (e, t) => j(e, t) ? yb : gb(e) ? kb(e.left, t).zip(kb(e.right, t)) : e, Ab = (e) => j(e, yb) ? Wo() : gb(e) ? x(Ab(e.left), Qo(Ab(e.right))) : Ko(e), jb = /*#__PURE__*/ bb({
	empty: Tb,
	patch: Db,
	combine: Eb,
	diff: (e, t) => {
		if (j(e, t)) return Tb;
		let n = Ab(e), r = Ab(t);
		return Eb(x(r, Zo(n), $o(Tb, (e, t) => Eb(e, {
			_tag: Sb,
			supervisor: t
		}))), x(n, Zo(r), $o(Tb, (e, t) => Eb(e, {
			_tag: Cb,
			supervisor: t
		}))));
	}
}), Mb = /*#__PURE__*/ ab("effect_fiber_started", { incremental: !0 }), Nb = /*#__PURE__*/ ab("effect_fiber_active"), Pb = /*#__PURE__*/ ab("effect_fiber_successes", { incremental: !0 }), Fb = /*#__PURE__*/ ab("effect_fiber_failures", { incremental: !0 }), Ib = /*#__PURE__*/ cb(/*#__PURE__*/ sb("effect_fiber_lifetimes", /*#__PURE__*/ Lv({
	start: .5,
	factor: 2,
	count: 35
})), "time_unit", "milliseconds"), Lb = "Continue", Rb = "Done", zb = "Yield", Bb = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Vb = (e) => {
	throw Error(`BUG: FiberRuntime - ${yt(e)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, Hb = /*#__PURE__*/ Symbol.for("effect/internal/fiberRuntime/YieldedOp"), Ub = /*#__PURE__*/ S("effect/internal/fiberRuntime/yieldedOpChannel", () => ({ currentOp: null })), Wb = {
	[At]: (e, t, n) => w(() => t.effect_instruction_i1(n)),
	OnStep: (e, t, n) => Z(Z(n)),
	[jt]: (e, t, n) => w(() => t.effect_instruction_i2(n)),
	[zt]: (e, t, n) => (e.patchRuntimeFlags(e.currentRuntimeFlags, t.patch), dl(e.currentRuntimeFlags) && e.isInterrupted() ? X(e.getInterruptedCause()) : Z(n)),
	[Ft]: (e, t, n) => (w(() => t.effect_instruction_i2(n)), w(() => t.effect_instruction_i0()) ? (e.pushStack(t), w(() => t.effect_instruction_i1())) : Y),
	[It]: (e, t, n) => {
		for (;;) {
			let r = w(() => t.effect_instruction_i0.next(n));
			if (r.done) return Z(r.value);
			let i = at(r.value);
			if (!Yf(i)) return e.pushStack(t), i;
			if (i._tag === "Failure") return i;
			n = i.value;
		}
	}
}, Gb = {
	[ov]: (e, t, n, r) => (e.processNewInterruptSignal(r.cause), dl(t) ? X(r.cause) : n),
	[cv]: (e, t, n, r) => {
		throw Error("It is illegal to have multiple concurrent run loops in a single fiber");
	},
	[sv]: (e, t, n, r) => (r.onFiber(e, Zg(t)), n),
	[lv]: (e, t, n, r) => W(Bd(), () => n)
}, Kb = (e) => Cd(El(e), (e) => cx(Wl(e), ([e, t]) => {
	let n = /* @__PURE__ */ new Map(), r = [];
	for (let e of t) {
		r.push(Di(e));
		for (let t of e) n.set(t.request, t);
	}
	let i = r.flat();
	return cf(Fx(e.runAll(r), i, () => i.forEach((e) => {
		e.listeners.interrupted = !0;
	})), iv, n);
}, !1, !1)), qb = /*#__PURE__*/ Vt(), Jb = class extends Rh {
	[yv] = bv;
	[Sv] = Bb;
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
		if (super(), this.currentRuntimeFlags = n, this._fiberId = e, this._fiberRefs = t, gl(n)) {
			let e = this.getFiberRef(Df);
			Mb.unsafeUpdate(1, e), Nb.unsafeUpdate(1, e);
		}
		this.refreshRefCache();
	}
	commit() {
		return Cv(this);
	}
	id() {
		return this._fiberId;
	}
	resume(e) {
		this.tell(fv(e));
	}
	get status() {
		return this.ask((e, t) => t);
	}
	get runtimeFlags() {
		return this.ask((e, t) => $g(t) ? e.currentRuntimeFlags : t.runtimeFlags);
	}
	scope() {
		return _v(this);
	}
	get children() {
		return this.ask((e) => Array.from(e.getChildren()));
	}
	getChildren() {
		return this._children === null && (this._children = /* @__PURE__ */ new Set()), this._children;
	}
	getInterruptedCause() {
		return this.getFiberRef(kf);
	}
	fiberRefs() {
		return this.ask((e) => e.getFiberRefs());
	}
	ask(e) {
		return q(() => {
			let t = up(this._fiberId);
			return this.tell(dv((n, r) => {
				_p(t, J(() => e(n, r)));
			})), pp(t);
		});
	}
	tell(e) {
		this._queue.push(e), this._running || (this._running = !0, this.drainQueueLaterOnExecutor());
	}
	get await() {
		return ad((e) => {
			let t = (t) => e(K(t));
			if (this._exitValue !== null) t(this._exitValue);
			else return this.tell(dv((e, n) => {
				e._exitValue === null ? e.addObserver(t) : t(this._exitValue);
			})), J(() => this.tell(dv((e, n) => {
				e.removeObserver(t);
			})));
		}, this.id());
	}
	get inheritAll() {
		return V((e, t) => {
			let n = e.id(), r = e.getFiberRefs(), i = t.runtimeFlags, a = fh(r, n, this.getFiberRefs());
			return e.setFiberRefs(a), Nd(x(vl(i, e.getFiberRef(Mx)), Cl(1), Cl(16)));
		});
	}
	get poll() {
		return J(() => Pn(this._exitValue));
	}
	unsafePoll() {
		return this._exitValue;
	}
	interruptAsFork(e) {
		return J(() => this.tell(uv(ru(e))));
	}
	unsafeInterruptAsFork(e) {
		this.tell(uv(ru(e)));
	}
	addObserver(e) {
		this._exitValue === null ? this._observers.push(e) : e(this._exitValue);
	}
	removeObserver(e) {
		this._observers = this._observers.filter((t) => t !== e);
	}
	getFiberRefs() {
		return this.setFiberRef(Mx, this.currentRuntimeFlags), this._fiberRefs;
	}
	unsafeDeleteFiberRef(e) {
		this._fiberRefs = hh(this._fiberRefs, e);
	}
	getFiberRef(e) {
		return this._fiberRefs.locals.has(e) ? this._fiberRefs.locals.get(e)[0][1] : e.initial;
	}
	setFiberRef(e, t) {
		this._fiberRefs = vh(this._fiberRefs, {
			fiberId: this._fiberId,
			fiberRef: e,
			value: t
		}), this.refreshRefCache();
	}
	refreshRefCache() {
		this.currentDefaultServices = this.getFiberRef(oh), this.currentTracer = this.currentDefaultServices.unsafeMap.get($m.key), this.currentSupervisor = this.getFiberRef(Nx), this.currentScheduler = this.getFiberRef(rv), this.currentContext = this.getFiberRef(gf), this.currentSpan = this.currentContext.unsafeMap.get(eh.key);
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
			let t = Lb, n = globalThis[wv];
			globalThis[wv] = this;
			try {
				for (; t === Lb;) t = this._queue.length === 0 ? Rb : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
			} finally {
				this._running = !1, globalThis[wv] = n;
			}
			this._queue.length > 0 && !this._running ? (this._running = !0, t === zb ? (this.drainQueueLaterOnExecutor(), e = !1) : e = !0) : e = !1;
		}
	}
	drainQueueLaterOnExecutor() {
		this.currentScheduler.scheduleTask(this.run, this.getFiberRef(_f), this);
	}
	drainQueueWhileRunning(e, t) {
		let n = t;
		for (; this._queue.length > 0;) {
			let t = this._queue.splice(0, 1)[0];
			n = Gb[t._tag](this, e, n, t);
		}
		return n;
	}
	isInterrupted() {
		return !cu(this.getFiberRef(kf));
	}
	addInterruptedCause(e) {
		let t = this.getFiberRef(kf);
		this.setFiberRef(kf, au(t, e));
	}
	processNewInterruptSignal(e) {
		this.addInterruptedCause(e), this.sendInterruptSignalToAllChildren();
	}
	sendInterruptSignalToAllChildren() {
		if (this._children === null || this._children.size === 0) return !1;
		let e = !1;
		for (let t of this._children) t.tell(uv(ru(this.id()))), e = !0;
		return e;
	}
	interruptAllChildren() {
		if (this.sendInterruptSignalToAllChildren()) {
			let e = this._children.values();
			this._children = null;
			let t = !1;
			return Fd({
				while: () => !t,
				body: () => {
					let n = e.next();
					return n.done ? J(() => {
						t = !0;
					}) : td(n.value.await);
				},
				step: () => {}
			});
		}
		return null;
	}
	reportExitValue(e) {
		if (gl(this.currentRuntimeFlags)) {
			let t = this.getFiberRef(Df), n = this.id().startTimeMillis, r = Date.now();
			switch (Ib.unsafeUpdate(r - n, t), Nb.unsafeUpdate(-1, t), e._tag) {
				case Mt:
					Pb.unsafeUpdate(1, t);
					break;
				case Ot: Fb.unsafeUpdate(1, t);
			}
		}
		if (e._tag === "Failure") {
			let t = this.getFiberRef(Tf);
			!uu(e.cause) && t._tag === "Some" && this.log("Fiber terminated with an unhandled error", e.cause, t);
		}
	}
	setExitValue(e) {
		this._exitValue = e, this.reportExitValue(e);
		for (let t = this._observers.length - 1; t >= 0; t--) this._observers[t](e);
		this._observers = [];
	}
	getLoggers() {
		return this.getFiberRef($b);
	}
	log(e, t, n) {
		let r = An(n) ? n.value : this.getFiberRef(bf);
		if (Mh(this.getFiberRef(Yb), r)) return;
		let i = this.getFiberRef(xf), a = this.getFiberRef(yf), o = this.getLoggers(), s = this.getFiberRefs();
		if (Jo(o) > 0) {
			let n = ci(this.getFiberRef(oh), Bp), c = new Date(n.unsafeCurrentTimeMillis());
			wt(s, () => {
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
			case lv: return zb;
			case ov: return this.processNewInterruptSignal(e.cause), this._asyncInterruptor !== null && (this._asyncInterruptor(X(e.cause)), this._asyncInterruptor = null), Lb;
			case cv: return this._asyncInterruptor = null, this._asyncBlockingOn = null, this.evaluateEffect(e.effect), Lb;
			case sv: return e.onFiber(this, this._exitValue === null ? Qg(this.currentRuntimeFlags, this._asyncBlockingOn) : Xg), Lb;
			default: return Vb(e);
		}
	}
	evaluateEffect(e) {
		this.currentSupervisor.onResume(this);
		try {
			let t = dl(this.currentRuntimeFlags) && this.isInterrupted() ? X(this.getInterruptedCause()) : e;
			for (; t !== null;) {
				let e = t, n = this.runLoop(e);
				if (n === Hb) {
					let e = Ub.currentOp;
					Ub.currentOp = null, e._op === "Yield" ? cl(this.currentRuntimeFlags) ? (this.tell(pv()), this.tell(fv(sp)), t = null) : t = sp : e._op === "Async" && (t = null);
				} else {
					this.currentRuntimeFlags = x(this.currentRuntimeFlags, ul(16));
					let e = this.interruptAllChildren();
					e === null ? (this._queue.length === 0 ? this.setExitValue(n) : this.tell(fv(n)), t = null) : t = W(e, () => n);
				}
			}
		} finally {
			this.currentSupervisor.onSuspend(this);
		}
	}
	start(e) {
		if (this._running) this.tell(fv(e));
		else {
			this._running = !0;
			let t = globalThis[wv];
			globalThis[wv] = this;
			try {
				this.evaluateEffect(e);
			} finally {
				this._running = !1, globalThis[wv] = t, this._queue.length > 0 && this.drainQueueLaterOnExecutor();
			}
		}
	}
	startFork(e) {
		this.tell(fv(e));
	}
	patchRuntimeFlags(e, t) {
		let n = yl(e, t);
		return globalThis[wv] = this, this.currentRuntimeFlags = n, n;
	}
	initiateAsync(e, t) {
		let n = !1, r = (e) => {
			n || (n = !0, this.tell(fv(e)));
		};
		dl(e) && (this._asyncInterruptor = r);
		try {
			t(r);
		} catch (e) {
			r(U(nu(e)));
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
		return J(() => li(this.currentContext, e));
	}
	Left(e) {
		return H(e.left);
	}
	None(e) {
		return H(new Kf());
	}
	Right(e) {
		return Z(e.right);
	}
	Some(e) {
		return Z(e.value);
	}
	Micro(e) {
		return rd((t) => {
			let n = t, r = Z_(H_(e, this.currentContext));
			return r.addObserver((e) => {
				if (e._tag === "Success") return n(Z(e.value));
				switch (e.cause._tag) {
					case "Interrupt": return n(X(ru(ys)));
					case "Fail": return n(H(e.cause.error));
					case "Die": return n(ld(e.cause.defect));
				}
			}), rd((e) => {
				n = (t) => {
					e(Y);
				}, r.unsafeInterrupt();
			});
		});
	}
	[Nt](e) {
		let t = w(() => e.effect_instruction_i0()), n = this.getNextSuccessCont();
		return n === void 0 ? (Ub.currentOp = Z(t), Hb) : (n._op in Wb || Vb(n), Wb[n._op](this, n, t));
	}
	[Mt](e) {
		let t = e, n = this.getNextSuccessCont();
		return n === void 0 ? (Ub.currentOp = t, Hb) : (n._op in Wb || Vb(n), Wb[n._op](this, n, t.effect_instruction_i0));
	}
	[Ot](e) {
		let t = e.effect_instruction_i0, n = this.getNextFailCont();
		if (n !== void 0) switch (n._op) {
			case kt:
			case jt: return dl(this.currentRuntimeFlags) && this.isInterrupted() ? X(_u(t)) : w(() => n.effect_instruction_i1(t));
			case "OnStep": return dl(this.currentRuntimeFlags) && this.isInterrupted() ? X(_u(t)) : Z(X(t));
			case zt: return this.patchRuntimeFlags(this.currentRuntimeFlags, n.patch), dl(this.currentRuntimeFlags) && this.isInterrupted() ? X(au(t, this.getInterruptedCause())) : X(t);
			default: Vb(n);
		}
		else return Ub.currentOp = X(t), Hb;
	}
	[Lt](e) {
		return w(() => e.effect_instruction_i0(this, Zg(this.currentRuntimeFlags)));
	}
	Blocked(e) {
		let t = this.getFiberRefs(), n = this.currentRuntimeFlags;
		if (this._steps.length > 0) {
			let r = [], i = this._steps[this._steps.length - 1], a = this.popStack();
			for (; a && a._op !== "OnStep";) r.push(a), a = this.popStack();
			this.setFiberRefs(i.refs), this.currentRuntimeFlags = i.flags;
			let o = Pg(i.refs, t), s = vl(i.flags, n);
			return Z(Ku(e.effect_instruction_i0, V((t) => {
				for (; r.length > 0;) t.pushStack(r.pop());
				return t.setFiberRefs(Fg(t.id(), t.getFiberRefs())(o)), t.currentRuntimeFlags = yl(s)(t.currentRuntimeFlags), e.effect_instruction_i1;
			})));
		}
		return Md((t) => W(ux(qu(e.effect_instruction_i0)), () => t(e.effect_instruction_i1)));
	}
	RunBlocked(e) {
		return Kb(e.effect_instruction_i0);
	}
	[Pt](e) {
		let t = e.effect_instruction_i0, n = this.currentRuntimeFlags, r = yl(n, t);
		if (dl(r) && this.isInterrupted()) return X(this.getInterruptedCause());
		if (this.patchRuntimeFlags(this.currentRuntimeFlags, t), e.effect_instruction_i1) {
			let t = vl(r, n);
			return this.pushStack(new Yu(t, e)), w(() => e.effect_instruction_i1(n));
		}
		return sp;
	}
	[At](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	OnStep(e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[kt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[jt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[Et](e) {
		return this._asyncBlockingOn = e.effect_instruction_i1, this.initiateAsync(this.currentRuntimeFlags, e.effect_instruction_i0), Ub.currentOp = e, Hb;
	}
	[Rt](e) {
		return this._isYielding = !1, Ub.currentOp = e, Hb;
	}
	[Ft](e) {
		let t = e.effect_instruction_i0, n = e.effect_instruction_i1;
		return t() ? (this.pushStack(e), n()) : sp;
	}
	[It](e) {
		return Wb[It](this, e, void 0);
	}
	[Dt](e) {
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
					t = W(Bd({ priority: e }), () => n);
				}
			}
			try {
				if (t = this.currentTracer.context(() => {
					if (qb !== t[Ju]._V) {
						let e = this.getFiberRef(Ef);
						if (e._tag === "Some") {
							let n = t[Ju]._V;
							this.log(`Executing an Effect versioned ${n} with a Runtime of version ${Vt()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, eu, e);
						}
					}
					return this[t._op](t);
				}, this), t === Hb) {
					let e = Ub.currentOp;
					return e._op === "Yield" || e._op === "Async" ? Hb : (Ub.currentOp = null, e._op === "Success" || e._op === "Failure" ? e : X(nu(e)));
				}
			} catch (e) {
				t = t !== Hb && !C(t, "_op") || !(t._op in this) ? ud(`Not a valid effect: ${yt(t)}`) : Wf(e) ? X(au(nu(e), ru(ys))) : ld(e);
			}
		}
	}
	run = () => {
		this.drainQueueOnCurrentThread();
	};
}, Yb = /*#__PURE__*/ S("effect/FiberRef/currentMinimumLogLevel", () => uf(Nh("Info"))), Xb = (e) => Dv((t) => {
	ci(xh(t.context, oh), Um).unsafe.log(e.log(t));
}), Zb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Logger/defaultLogger"), () => Xb(kv)), Qb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Logger/tracerLogger"), () => Dv(({ annotations: e, cause: t, context: n, fiberId: r, logLevel: i, message: a }) => {
	let o = Sg(ui(_h(n, gf), eh));
	if (o._tag === "None" || o.value._tag === "ExternalSpan") return;
	let s = li(_h(n, oh), Bp), c = {};
	for (let [t, n] of e) c[t] = n;
	c["effect.fiberId"] = xs(r), c["effect.logLevel"] = i.label, t !== null && t._tag !== "Empty" && (c["effect.cause"] = Au(t, { renderErrorCause: !0 })), o.value.event(yt(Array.isArray(a) && a.length === 1 ? a[0] : a), s.unsafeCurrentTimeNanos(), c);
})), $b = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLoggers"), () => df(Ko(Zb, Qb))), ex = /*#__PURE__*/ y((e) => Qu(e[0]), (e, t) => jd(kd(e, (e) => tx((n) => t(e, n))))), tx = (e) => V((t) => {
	let n = t.getFiberRefs(), r = ll(t.currentRuntimeFlags, 1);
	return W(wx, (t) => Nf(t, (t) => V((i) => {
		let a = i.getFiberRefs(), o = i.currentRuntimeFlags, s = Pg(a, n), c = vl(o, r), l = Pg(n, a);
		return i.setFiberRefs(Fg(s, i.id(), n)), Px(zd(e(t), c), J(() => {
			i.setFiberRefs(Fg(l, i.id(), i.getFiberRefs()));
		}));
	})));
}), nx = (e) => {
	if (Array.isArray(e) || We(e)) return [e, I()];
	let t = Object.keys(e), n = t.length;
	return [t.map((t) => e[t]), L((e) => {
		let r = {};
		for (let i = 0; i < n; i++) r[t[i]] = e[i];
		return r;
	})];
}, rx = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(dd(t));
	return W(ox(r, b, {
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
}, ix = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(dd(t));
	return n?.discard ? ox(r, b, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		discard: !0,
		concurrentFinalizers: n?.concurrentFinalizers
	}) : G(ox(r, b, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => t._tag === "Some" ? t.value(e) : e);
}, ax = (e, t) => {
	let [n, r] = nx(e);
	return t?.mode === "validate" ? rx(n, r, t) : t?.mode === "either" ? ix(n, r, t) : t?.discard !== !0 && r._tag === "Some" ? G(ox(n, b, t), r.value) : ox(n, b, t);
}, ox = /*#__PURE__*/ y((e) => We(e[0]), (e, t, n) => V((r) => {
	let i = n?.batching === !0 || n?.batching === "inherit" && r.getFiberRef(wf);
	return n?.discard ? av(n.concurrency, () => _x(jg, n?.concurrentFinalizers)((n) => i ? cx(e, (e, r) => n(t(e, r)), !0, !1, 1) : Cd(e, (e, r) => n(t(e, r)))), () => _x(Mg, n?.concurrentFinalizers)((n) => cx(e, (e, r) => n(t(e, r)), i, !1)), (r) => _x(Ng(r), n?.concurrentFinalizers)((n) => cx(e, (e, r) => n(t(e, r)), i, !1, r))) : av(n?.concurrency, () => _x(jg, n?.concurrentFinalizers)((n) => i ? lx(e, 1, (e, r) => n(t(e, r)), !0) : Sd(e, (e, r) => n(t(e, r)))), () => _x(Mg, n?.concurrentFinalizers)((n) => sx(e, (e, r) => n(t(e, r)), i)), (r) => _x(Ng(r), n?.concurrentFinalizers)((n) => lx(e, r, (e, r) => n(t(e, r)), i)));
})), sx = (e, t, n) => q(() => {
	let r = R(e), i = Array(r.length);
	return Ud(cx(r, (e, n) => W(t(e, n), (e) => J(() => i[n] = e)), n, !1), K(i));
}), cx = (e, t, n, r, i) => Md((a) => Ad((o) => V((s) => {
	let c = Array.from(e).reverse(), l = c.length;
	if (l === 0) return Y;
	let u = 0, d = !1, f = i ? Math.min(c.length, i) : c.length, p = /* @__PURE__ */ new Set(), m = [], ee = () => p.forEach((e) => {
		e.currentScheduler.scheduleTask(() => {
			e.unsafeInterruptAsFork(s.id());
		}, 0, e);
	}), te = [], ne = [], re = [], h = () => {
		let e = m.filter(({ exit: e }) => e._tag === "Failure").sort((e, t) => e.index < t.index ? -1 : e.index === t.index ? 0 : 1).map(({ exit: e }) => e);
		return e.length === 0 && e.push(sp), e;
	}, ie = (e, t = !1) => {
		let n = jd(o(e)), r = fx(n, s, s.currentRuntimeFlags, vv);
		return s.currentScheduler.scheduleTask(() => {
			t && r.unsafeInterruptAsFork(s.id()), r.resume(n);
		}, 0, r), r;
	}, g = () => {
		r || (l -= c.length, c = []), d = !0, ee();
	}, _ = n ? _d : fd, ae = ie(ad((e) => {
		let r = (e, t) => {
			e._op === "Blocked" ? re.push(e) : (m.push({
				index: t,
				exit: e
			}), e._op === "Failure" && !d && g());
		}, o = () => {
			if (c.length > 0) {
				let f = c.pop(), ee = u++, g = () => {
					let e = c.pop();
					return ee = u++, W(Bd(), () => W(_(a(t(e, ee))), ae));
				}, ae = (e) => c.length > 0 && (r(e, ee), c.length > 0) ? g() : K(e), oe = W(_(a(t(f, ee))), ae), se = ie(oe);
				te.push(se), p.add(se), d && se.currentScheduler.scheduleTask(() => {
					se.unsafeInterruptAsFork(s.id());
				}, 0, se), se.addObserver((t) => {
					let a;
					if (a = t._op === "Failure" ? t : t.effect_instruction_i0, ne.push(se), p.delete(se), r(a, ee), m.length === l) e(K(Mn(ep(h(), { parallel: !0 }), () => sp)));
					else if (re.length + m.length === l) {
						let t = h();
						e(K(Ku(re.map((e) => e.effect_instruction_i0).reduce(wl), cx([Mn(ep(t, { parallel: !0 }), () => sp), ...re.map((e) => e.effect_instruction_i1)], (e) => e, n, !0, i))));
					} else o();
				});
			}
		};
		for (let e = 0; e < f; e++) o();
	}));
	return td(Dd(vd(a(Cv(ae))), ap({
		onFailure: (e) => {
			g();
			let t = re.length + 1, n = Math.min(typeof i == "number" ? i : re.length, re.length), r = Array.from(re);
			return ad((i) => {
				let a = [], o = 0, s = 0, c = (n, s) => (c) => {
					a[n] = c, o++, o === t && i(Z(X(e))), r.length > 0 && s && l();
				}, l = () => {
					ie(r.pop(), !0).addObserver(c(s, !0)), s++;
				};
				ae.addObserver(c(s, !1)), s++;
				for (let e = 0; e < n; e++) l();
			});
		},
		onSuccess: () => Sd(ne, (e) => e.inheritAll)
	})));
}))), lx = (e, t, n, r) => q(() => {
	let i = R(e), a = Array(i.length);
	return Ud(cx(i, (e, t) => G(n(e, t), (e) => a[t] = e), r, !1, t), K(a));
}), ux = (e) => mx(e, vv), dx = (e, t, n, r = null) => {
	let i = px(e, t, n, r);
	return i.resume(e), i;
}, fx = (e, t, n, r = null) => px(e, t, n, r), px = (e, t, n, r = null) => {
	let i = Ss(), a = ph(t.getFiberRefs(), i), o = new Jb(i, a, n), s = _h(a, gf), c = o.currentSupervisor;
	return c.onStart(s, e, L(t), o), o.addObserver((e) => c.onEnd(e, o)), (r === null ? x(t.getFiberRef(Of), Mn(() => t.scope())) : r).add(n, o), o;
}, mx = (e, t) => V((n, r) => K(dx(e, n, r.runtimeFlags, t))), hx = (e) => xp((t) => jn(ui(t, Cx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Parallel": return e;
			case "Sequential":
			case "ParallelN": return W(Ff(t, Mg), (t) => kx(e, t));
		}
	}
})), gx = (e) => (t) => xp((n) => jn(ui(n, Cx), {
	onNone: () => t,
	onSome: (n) => n.strategy._tag === "ParallelN" && n.strategy.parallelism === e ? t : W(Ff(n, Ng(e)), (e) => kx(t, e))
})), _x = (e, t) => (n) => xp((r) => jn(ui(r, Cx), {
	onNone: () => n(b),
	onSome: (r) => {
		if (t === !0) {
			let t = e._tag === "Parallel" ? hx : e._tag === "Sequential" ? xx : gx(e.parallelism);
			switch (r.strategy._tag) {
				case "Parallel": return t(n(hx));
				case "Sequential": return t(n(xx));
				case "ParallelN": return t(n(gx(r.strategy.parallelism)));
			}
		} else return n(b);
	}
})), vx = (e) => W(Cx, e), yx = (e) => W(Ox(), (t) => Dd(e(t), (e) => t.close(e))), bx = (e) => W(Ox(), (t) => Ax(e, t)), xx = (e) => xp((t) => jn(ui(t, Cx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Sequential": return e;
			case "Parallel":
			case "ParallelN": return W(Ff(t, jg), (t) => kx(e, t));
		}
	}
})), Sx = /*#__PURE__*/ y((e) => Qu(e[1]), (e, t, n, r) => G(ax([e, t], {
	concurrency: r?.concurrent ? 2 : 1,
	batching: r?.batching,
	concurrentFinalizers: r?.concurrentFinalizers
}), ([e, t]) => n(e, t))), Cx = /*#__PURE__*/ ni("effect/Scope"), wx = Cx, Tx = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.set({}, t);
}, Ex = {
	[Af]: Af,
	[jf]: jf,
	pipe() {
		return F(this, arguments);
	},
	fork(e) {
		return J(() => {
			let t = Dx(e);
			if (this.state._tag === "Closed") return t.state = this.state, t;
			let n = {};
			return this.state.finalizers.set(n, (e) => t.close(e)), Tx(t, (e) => J(() => {
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
			}, t.length === 0 ? Y : kg(this.strategy) ? x(Sd(t, (t) => fd(t(e))), W((e) => x(ep(e), In($f), Mn(() => sp)))) : Ag(this.strategy) ? x(sx(t, (t) => fd(t(e)), !1), W((e) => x(ep(e, { parallel: !0 }), In($f), Mn(() => sp)))) : x(lx(t, this.strategy.parallelism, (t) => fd(t(e)), !1), W((e) => x(ep(e, { parallel: !0 }), In($f), Mn(() => sp))));
		});
	},
	addFinalizer(e) {
		return q(() => this.state._tag === "Closed" ? e(this.state.exit) : (this.state.finalizers.set({}, e), Y));
	}
}, Dx = (e = Eg) => {
	let t = Object.create(Ex);
	return t.strategy = e, t.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map()
	}, t;
}, Ox = (e = Eg) => J(() => Dx(e)), kx = /*#__PURE__*/ y(2, (e, t) => wp(e, di(oi(Cx, t)))), Ax = /*#__PURE__*/ y(2, (e, t) => x(e, kx(t), Dd((e) => t.close(e)))), jx = (e) => mf(e, {
	differ: jb,
	fork: Tb
}), Mx = /*#__PURE__*/ hf(hl), Nx = /*#__PURE__*/ jx(yb), Px = /*#__PURE__*/ y(2, (e, t) => Md((n) => bd(n(e), {
	onFailure: (e) => bd(t, {
		onFailure: (t) => U(au(e, t)),
		onSuccess: () => U(e)
	}),
	onSuccess: (e) => ed(t, e)
}))), Fx = (e, t, n) => gd((r) => Px(W(ux(wd(e)), (e) => ad((r) => {
	let i = t.map((e) => e.listeners.count), a = () => {
		i.every((e) => e === 0) && t.every((e) => !!(e.result.state.current._tag === "Pending" || e.result.state.current._tag === "Done" && Yf(e.result.state.current.effect) && e.result.state.current.effect._tag === "Failure" && lu(e.result.state.current.effect.cause))) && (o.forEach((e) => e()), n?.(), r(Gd(e)));
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
})), q(() => Cd(t.flatMap((e) => e.state.completed ? [] : [e]), (e) => db(e.request, rp(r)))))), Ix = mu, Lx = If, Rx = Mf, zx = Pf, Bx = kx, Vx = Ff, Hx = Ox, Ux = class {
	permits;
	waiters = /*#__PURE__*/ new Set();
	taken = 0;
	constructor(e) {
		this.permits = e;
	}
	get free() {
		return this.permits - this.taken;
	}
	take = (e) => id((t) => {
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
		return this.taken = t(this.taken), this.waiters.size > 0 && e.getFiberRef(rv).scheduleTask(() => {
			let e = this.waiters.values(), t = e.next();
			for (; t.done === !1 && this.free > 0;) t.value(), t = e.next();
		}, e.getFiberRef(_f), e), K(this.free);
	}
	updateTaken(e) {
		return V((t) => this.updateTakenUnsafe(t, e));
	}
	resize = (e) => td(V((t) => (this.permits = e, this.free < 0 ? Y : this.updateTakenUnsafe(t, (e) => e))));
	release = (e) => this.updateTaken((t) => t - e);
	releaseAll = /*#__PURE__*/ this.updateTaken((e) => 0);
	withPermits = (e) => (t) => Md((n) => W(n(this.take(e)), (e) => Px(n(t), this.release(e))));
	withPermitsIfAvailable = (e) => (t) => Md((n) => q(() => this.free < e ? _g : (this.taken += e, Px(n(cg(t)), this.release(e)))));
}, Wx = (e) => new Ux(e), Gx = /*#__PURE__*/ Symbol.for("effect/Ref/SynchronizedRef"), Kx = {
/* c8 ignore next */
_A: (e) => e }, qx = class extends Rh {
	ref;
	withLock;
	[Gx] = Kx;
	[Bh] = Vh;
	[zh] = zh;
	constructor(e, t) {
		super(), this.ref = e, this.withLock = t, this.get = Gh(this.ref);
	}
	get;
	commit() {
		return this.get;
	}
	modify(e) {
		return this.modifyEffect((t) => K(e(t)));
	}
	modifyEffect(e) {
		return this.withLock(x(W(Gh(this.ref), e), W(([e, t]) => ed(Kh(this.ref, t), e))));
	}
}, Jx = (e) => J(() => Yx(e)), Yx = (e) => new qx(Uh(e), Wx(1).withPermits(1)), Xx = /*#__PURE__*/ Symbol.for("effect/ManagedRuntime"), Zx = "Fresh", Qx = "FromEffect", $x = "MergeAll", eS = (e) => function() {
	if (arguments.length === 1) {
		let t = arguments[0];
		return (n, ...r) => e(t, n, ...r);
	}
	return e.apply(this, arguments);
}, tS = /*#__PURE__*/ eS((e, t, n) => {
	let r = Ss(), i = [[gf, [[r, e.context]]]];
	n?.scheduler && i.push([rv, [[r, n.scheduler]]]);
	let a = Sh(e.fiberRefs, {
		entries: i,
		forkAs: r
	});
	n?.updateRefs && (a = n.updateRefs(a, r));
	let o = new Jb(r, a, e.runtimeFlags), s = t;
	n?.scope && (s = W(Vx(n.scope, Eg), (e) => Ud(Mf(e, gd((e) => j(e, o.id()) ? Y : Kd(o, e))), Dd(t, (t) => zx(e, t)))));
	let c = o.currentSupervisor;
	return c !== yb && (c.onStart(e.context, s, I(), o), o.addObserver((e) => c.onEnd(e, o))), vv.add(e.runtimeFlags, o), n?.immediate === !1 ? o.resume(s) : o.start(s), o;
}), nS = /*#__PURE__*/ eS((e, t) => {
	let n = uS(e)(t);
	if (n._tag === "Failure") throw cS(n.effect_instruction_i0);
	return n.effect_instruction_i0;
}), rS = class extends Error {
	fiber;
	_tag = "AsyncFiberException";
	constructor(e) {
		super(`Fiber #${e.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`), this.fiber = e, this.name = this._tag, this.stack = this.message;
	}
}, iS = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new rS(e);
	return Error.stackTraceLimit = t, n;
}, aS = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure"), oS = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure/Cause"), sS = class extends Error {
	[aS];
	[oS];
	constructor(e) {
		let t = Ru(e)[0];
		super(t?.message || "An error has occurred"), this[aS] = aS, this[oS] = e, this.name = t ? `(FiberFailure) ${t.name}` : "FiberFailure", t?.stack && (this.stack = t.stack);
	}
	toJSON() {
		return {
			_id: "FiberFailure",
			cause: this[oS].toJSON()
		};
	}
	toString() {
		return "(FiberFailure) " + Au(this[oS], { renderErrorCause: !0 });
	}
	[M]() {
		return this.toString();
	}
}, cS = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new sS(e);
	return Error.stackTraceLimit = t, n;
}, lS = (e) => {
	let t = e;
	switch (t._op) {
		case "Failure":
		case "Success": return t;
		case "Left": return np(t.left);
		case "Right": return Z(t.right);
		case "Some": return Z(t.value);
		case "None": return np(new Kf());
	}
}, uS = /*#__PURE__*/ eS((e, t) => {
	let n = lS(t);
	if (n) return n;
	let r = new nv(), i = tS(e)(t, { scheduler: r });
	return r.flush(), i.unsafePoll() || tp(cd(iS(i), Tp(i)));
}), dS = /*#__PURE__*/ eS((e, t, n) => fS(e, t, n).then((e) => {
	switch (e._tag) {
		case Mt: return e.effect_instruction_i0;
		case Ot: throw cS(e.effect_instruction_i0);
	}
})), fS = /*#__PURE__*/ eS((e, t, n) => new Promise((r) => {
	let i = lS(t);
	i && r(i);
	let a = tS(e)(t);
	a.addObserver((e) => {
		r(e);
	}), n?.signal !== void 0 && (n.signal.aborted ? a.unsafeInterruptAsFork(a.id()) : n.signal.addEventListener("abort", () => {
		a.unsafeInterruptAsFork(a.id());
	}, { once: !0 }));
})), pS = class {
	context;
	runtimeFlags;
	fiberRefs;
	constructor(e, t, n) {
		this.context = e, this.runtimeFlags = t, this.fiberRefs = n;
	}
	pipe() {
		return F(this, arguments);
	}
}, mS = /*#__PURE__*/ ((e) => new pS(e.context, e.runtimeFlags, e.fiberRefs))({
	context: /*#__PURE__*/ ai(),
	runtimeFlags: /* @__PURE__ */ ml(1, 32, 4),
	fiberRefs: /*#__PURE__*/ Ch()
}), hS = /*#__PURE__*/ dS(mS), gS = /*#__PURE__*/ fS(mS), _S = /*#__PURE__*/ nS(mS), vS = /*#__PURE__*/ y(2, (e, t) => e.modifyEffect(t)), yS = /*#__PURE__*/ Symbol.for("effect/Layer"), bS = {
	/* c8 ignore next */
	_RIn: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_ROut: (e) => e
}, xS = {
	[yS]: bS,
	pipe() {
		return F(this, arguments);
	}
}, SS = /*#__PURE__*/ Symbol.for("effect/Layer/MemoMap"), CS = /*#__PURE__*/ mi()("effect/Layer/CurrentMemoMap", { defaultValue: () => OS() }), wS = (e) => C(e, yS), TS = (e) => e._op_layer === Zx, ES = class {
	ref;
	[SS];
	constructor(e) {
		this.ref = e, this[SS] = SS;
	}
	getOrElseMemoize(e, t) {
		return x(vS(this.ref, (n) => {
			let r = n.get(e);
			if (r !== void 0) {
				let [e, i] = r;
				return K([x(e, W(([e, t]) => x(mg(e), ed(t))), Dd(ap({
					onFailure: () => Y,
					onSuccess: () => Nf(t, i)
				}))), n]);
			}
			return x(Wh(0), W((r) => x(dp(), W((i) => x(Wh(() => Y), G((a) => {
				let o = Md((o) => x(Ox(), W((s) => x(o(W(jS(e, s, !0), (e) => ug(e(this)))), fd, W((o) => {
					switch (o._tag) {
						case Ot: return x(hp(i, o.effect_instruction_i0), Ud(Pf(s, o)), Ud(U(o.effect_instruction_i0)));
						case Mt: return x(Kh(a, (e) => x(Pf(s, e), Pd(qh(r, (e) => [e === 1, e - 1])), td)), Ud(Jh(r, (e) => e + 1)), Ud(Nf(t, (t) => x(J(() => n.delete(e)), Ud(Gh(a)), W((e) => e(t))))), Ud(gp(i, o.effect_instruction_i0)), ed(o.effect_instruction_i0[1]));
					}
				}))))), s = [x(pp(i), Dd(op({
					onFailure: () => Y,
					onSuccess: () => Jh(r, (e) => e + 1)
				}))), (e) => x(Gh(a), W((t) => t(e)))];
				return [o, TS(e) ? n : n.set(e, s)];
			}))))));
		}), vd);
	}
}, DS = /*#__PURE__*/ q(() => G(Jx(/* @__PURE__ */ new Map()), (e) => new ES(e))), OS = () => new ES(Yx(/* @__PURE__ */ new Map())), kS = /*#__PURE__*/ y(2, (e, t) => W(DS, (n) => AS(e, n, t))), AS = /*#__PURE__*/ y(3, (e, t, n) => W(jS(e, n), (e) => gg(e(t), CS, t))), jS = (e, t, n = !1) => {
	let r = e;
	switch (r._op_layer) {
		case "Locally": return J(() => (e) => r.f(e.getOrElseMemoize(r.self, t)));
		case "ExtendScope": return J(() => (e) => vx((t) => e.getOrElseMemoize(r.layer, t)));
		case "Fold": return J(() => (e) => x(e.getOrElseMemoize(r.layer, t), bd({
			onFailure: (n) => e.getOrElseMemoize(r.failureK(n), t),
			onSuccess: (n) => e.getOrElseMemoize(r.successK(n), t)
		})));
		case "Fresh": return J(() => (e) => x(r.layer, kS(t)));
		case "FromEffect": return J(n ? () => (e) => r.effect : () => (n) => n.getOrElseMemoize(e, t));
		case "Provide": return J(() => (e) => x(e.getOrElseMemoize(r.first, t), W((n) => x(e.getOrElseMemoize(r.second, t), Sp(n)))));
		case "Scoped": return J(n ? () => (e) => kx(r.effect, t) : () => (n) => n.getOrElseMemoize(e, t));
		case "Suspend": return J(() => (e) => e.getOrElseMemoize(r.evaluate(), t));
		case "ProvideMerge": return J(() => (e) => x(e.getOrElseMemoize(r.first, t), Wd(e.getOrElseMemoize(r.second, t), r.zipK)));
		case "ZipWith": return Ld(function* () {
			let e = yield* Ff(t, Dg), n = yield* Ff(e, Eg), i = yield* Ff(e, Eg);
			return (e) => x(e.getOrElseMemoize(r.first, n), Sx(e.getOrElseMemoize(r.second, i), r.zipK, { concurrent: !0 }));
		});
		case "MergeAll": {
			let e = r.layers;
			return G(Ff(t, Dg), (t) => (n) => {
				let r = Array(e.length);
				return G(cx(e, Rd(function* (e, i) {
					let a = yield* Ff(t, Eg), o = yield* n.getOrElseMemoize(e, a);
					r[i] = o;
				}), !1, !1), () => fi(...r));
			});
		}
	}
};
function MS(e) {
	let t = Object.create(xS);
	return t._op_layer = Qx, t.effect = e, t;
}
var NS = (...e) => {
	let t = Object.create(xS);
	return t._op_layer = $x, t.layers = e, t;
}, PS = /*#__PURE__*/ y(2, (e, t) => {
	let n = ii(e);
	return MS(K(oi(n ? e : t, n ? t : e)));
}), FS = /*#__PURE__*/ y(2, (e, t) => yx((n) => W(kS(t, n), (t) => Cp(e, t)))), IS = /*#__PURE__*/ y(2, (e, t) => {
	let n = Pg(mS.fiberRefs, t.fiberRefs), r = vl(mS.runtimeFlags, t.runtimeFlags);
	return Md((i) => V((a) => {
		let o = a.getFiberRef(gf), s = a.getFiberRefs(), c = Fg(a.id(), s)(n), l = a.currentRuntimeFlags, u = yl(r)(l), d = Pg(c, s), f = vl(u, l);
		return a.setFiberRefs(c), a.currentRuntimeFlags = u, Px(Cp(i(e), di(o, t.context)), V((e) => (e.setFiberRefs(Fg(e.id(), e.getFiberRefs())(d)), e.currentRuntimeFlags = yl(f)(e.currentRuntimeFlags), Y)));
	}));
}), LS = /*#__PURE__*/ y(2, (e, t) => Array.isArray(t) ? FS(e, NS(...t)) : wS(t) ? FS(e, t) : ri(t) ? Cp(e, t) : Xx in t ? W(t.runtimeEffect, (t) => IS(e, t)) : IS(e, t)), RS = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return { BaseEffectError: class extends Rf {
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
}(), zS = (e) => {
	let t = { BaseEffectError: class extends RS {
		_tag = e;
	} };
	return t.BaseEffectError.prototype.name = e, t.BaseEffectError;
}, BS = H, VS = Ld, HS = hg, US = K, WS = q, GS = J, KS = Y, qS = od, JS = pg, YS = lg, XS = bg, ZS = ed, QS = ex, $S = Px, eC = bx, tC = LS, nC = kd, rC = yg, iC = xd, aC = hS, oC = gS, sC = _S, cC = class extends zS("AuthenticationFailure") {};
function lC(e) {
	return XS({
		try: e.command,
		catch: (e) => new cC({ cause: e })
	}).pipe($S(HS(() => e.reconcile?.() ?? Promise.resolve())));
}
async function uC(e) {
	let t = await oC(e);
	if (Dp(t)) return t.value;
	let n = Ix(t.cause);
	throw An(n) ? n.value.cause : Lx(t.cause);
}
// src/app/services/queries/configuration.ts
function dC(e, t, n, r, i) {
	return t ? {
		queryKey: v.sshBrowse(t, n ?? "", i),
		queryFn: ({ signal: r }) => e.browseSshPath(t, n, i, r)
	} : {
		queryKey: v.browse(n ?? "", r, i),
		queryFn: ({ signal: t }) => e.browsePath(n, r, i, t)
	};
}
function fC(e, t, n, r) {
	let { api: a } = i();
	return g({
		...dC(a, null, e, t, n),
		enabled: r,
		staleTime: 2e3,
		retry: !1
	});
}
function pC(e, t, n, r) {
	let { api: a } = i();
	return g({
		...dC(a, e ?? { ssh_host: "" }, t, "directory", n),
		enabled: r && !!e?.ssh_host,
		staleTime: 2e3,
		retry: !1
	});
}
function mC() {
	let { api: e } = i();
	return d((t, n, r, i) => dC(e, t, n, r, i).queryFn({ signal: new AbortController().signal }), [e]);
}
function hC() {
	let { api: e } = i(), t = _();
	return d(async (n, r, i) => {
		try {
			return await (n ? e.createSshFolder(n, r, i) : e.createFolder(r, i));
		} finally {
			t.invalidateQueries({ queryKey: [n ? "ssh-browse" : "fs-browse"] });
		}
	}, [e, t]);
}
function gC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: (t) => e.browseSshPath(t, null),
		onSuccess: (e, n) => {
			t.setQueryData(v.sshBrowse(n, "", !1), e);
		}
	});
}
function _C() {
	let { api: e } = i();
	return g({
		queryKey: v.sshConfigs,
		queryFn: ({ signal: t }) => e.listSshConfigs(t),
		staleTime: 3e4,
		retry: !1
	});
}
function vC(e = !0) {
	let { api: t } = i();
	return g({
		queryKey: v.sshAliases,
		queryFn: ({ signal: e }) => t.listSshAliases(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function yC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: (t) => e.createSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
function bC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ configId: t, payload: n }) => e.updateSshConfig(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
function xC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: (t) => e.deleteSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
var SC = 3e5;
function CC() {
	let { api: e } = i();
	return g({
		queryKey: v.mcpLibrary,
		queryFn: ({ signal: t }) => e.getMcpLibrary(t),
		staleTime: SC,
		retry: !1
	});
}
function wC() {
	let { api: e } = i();
	return g({
		queryKey: v.mcpServers,
		queryFn: ({ signal: t }) => e.listMcpServers(t),
		staleTime: 3e4,
		retry: !1
	});
}
function TC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: (t) => e.createMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function EC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ serverName: t, payload: n }) => e.updateMcpServer(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function DC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: (t) => e.deleteMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function OC() {
	let { api: e } = i();
	return h({ mutationFn: (t) => e.testMcpServer(t) });
}
function kC() {
	let { api: e } = i();
	return g({
		queryKey: v.mcpRuntime,
		queryFn: ({ signal: t }) => e.listMcpRuntimeStatus(t),
		staleTime: 5e3,
		retry: !1
	});
}
function AC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ serverName: t, action: n }) => n === "connect" ? e.connectMcpServer(t) : n === "disconnect" ? e.disconnectMcpServer(t) : e.reloadMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function jC(e = !0) {
	let { api: t } = i();
	return g({
		queryKey: v.modelConfigs,
		enabled: e,
		queryFn: ({ signal: e }) => t.listModelConfigs(e),
		staleTime: 3e4,
		retry: !1
	});
}
var MC = 0;
function NC() {
	return globalThis.crypto?.randomUUID?.() ?? `credential-${++MC}`;
}
function PC(e, t, n, r) {
	let { api: a } = i(), o = m(() => ({
		identity: NC(),
		value: t
	}), [t]);
	return g({
		queryKey: v.providerModels(e, o.identity, n ?? ""),
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
function FC(e = !0) {
	let { api: t } = i();
	return g({
		queryKey: v.modelCatalog,
		queryFn: ({ signal: e }) => t.getModelCatalog(e),
		enabled: e,
		staleTime: 6e5,
		retry: !1
	});
}
async function IC(e) {
	await Promise.all([e.resetQueries({ queryKey: v.managedProviderModelsAll }), e.invalidateQueries({ queryKey: v.modelCatalog })]);
}
async function LC(e) {
	await Promise.all([
		e.invalidateQueries({ queryKey: v.managedAuth }),
		e.invalidateQueries({ queryKey: v.managedHostStatus }),
		IC(e),
		e.invalidateQueries({ queryKey: v.resolvedModelConfigsAll }),
		e.invalidateQueries({ queryKey: v.resolvedConfigFilesAll })
	]);
}
function RC(e) {
	let { api: t } = i();
	return g({
		queryKey: v.sessionCommands(e),
		queryFn: ({ signal: n }) => t.listSessionCommands(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function zC(e) {
	let { api: t } = i();
	return g({
		queryKey: v.sessionSkills(e),
		queryFn: ({ signal: n }) => t.listSessionSkills(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function BC(e, t) {
	let { api: n } = i(), r = t.trim();
	return g({
		queryKey: e ? v.resolvedModelConfig(e) : v.resolvedConfigFile(r),
		queryFn: ({ signal: t }) => e ? n.resolveModelConfig(e, t) : n.resolveConfigFile(r, t),
		enabled: !!(e ?? r),
		retry: !1,
		staleTime: 6e4
	});
}
function VC() {
	let { api: e } = i(), t = _();
	return h({
		retry: !1,
		mutationFn: (t) => e.createModelConfig(t),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: v.modelConfigs }),
				t.invalidateQueries({ queryKey: v.credentials }),
				IC(t)
			]);
		}
	});
}
function HC() {
	let { api: e } = i(), t = _();
	return h({
		retry: !1,
		mutationFn: ({ configId: t, payload: n }) => e.updateModelConfig(t, n),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: v.modelConfigs }),
				t.invalidateQueries({ queryKey: v.credentials }),
				IC(t)
			]);
		}
	});
}
function UC() {
	let { api: e } = i(), t = _();
	return h({
		retry: !1,
		mutationFn: (t) => e.deleteModelConfig(t),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: v.modelConfigs }),
				t.invalidateQueries({ queryKey: v.credentials }),
				IC(t)
			]);
		}
	});
}
// src/app/services/queries/host.ts
function WC() {
	let { api: e } = i();
	return g({
		queryKey: v.storeInfo,
		queryFn: ({ signal: t }) => e.getStore(t),
		staleTime: Infinity
	});
}
function GC(e) {
	let { api: t } = i();
	return g({
		queryKey: v.sandboxAvailability,
		queryFn: ({ signal: e }) => t.getSandboxAvailability(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function KC(e, t) {
	let { api: n } = i();
	return g({
		queryKey: [...v.sandboxActivity, t],
		queryFn: ({ signal: e }) => n.getSandboxActivity(t, e),
		enabled: e && t !== null,
		staleTime: 0,
		refetchInterval: 1e3,
		retry: !1
	});
}
function qC() {
	let { api: e } = i(), t = _();
	return h({
		retry: !1,
		mutationFn: (n) => uC(lC({
			command: () => e.managedLogout(n),
			reconcile: () => LC(t)
		}))
	});
}
// src/app/services/queries/direct.ts
function JC(e, t, n) {
	let r = e.find((e) => n(e) === n(t));
	return r && (r.generation > t.generation || r.version > t.version) ? e : r ? e.map((e) => n(e) === n(t) ? t : e) : [...e, t];
}
function YC(e, t, n) {
	return t.map((t) => {
		let r = e?.find((e) => n(e) === n(t));
		return r && (r.generation > t.generation || r.version > t.version) ? r : t;
	});
}
function XC(e, t, n = !0) {
	let { api: r } = i();
	return g({
		queryKey: v.sessionPermissions(e),
		queryFn: ({ signal: t }) => r.getPermissions(e, t),
		enabled: t,
		refetchInterval: t && n ? 1e3 : !1,
		staleTime: 0,
		retry: !1
	});
}
function ZC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, requestId: n, reply: r }) => e.replyPermission(t, n, r),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) })
	});
}
function QC() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, reviewId: n, parentSessionId: r }) => r ? e.authorizeChildPermissionReviewRetry(r, t, n) : e.authorizePermissionReviewRetry(t, n),
		onSuccess: (e, n) => Promise.all([t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) }), ...n.parentSessionId ? [t.invalidateQueries({ queryKey: v.traditionalChildren(n.parentSessionId) })] : []])
	});
}
function $C() {
	let { api: e } = i(), t = _();
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
function ew() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, grantId: n }) => e.deletePermissionGrant(t, n),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) })
	});
}
function tw(e, t) {
	let { api: n } = i();
	return g({
		queryKey: v.sessionGoal(e),
		queryFn: ({ signal: t }) => n.getGoal(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function nw() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, payload: n }) => e.createGoal(t, n),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), e)
	});
}
function rw() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, goalId: n, payload: r }) => e.updateGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), e)
	});
}
function iw() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, goalId: n, expectedVersion: r }) => e.clearGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), null)
	});
}
function aw(e, t) {
	let { api: n } = i();
	return g({
		queryKey: v.traditionalChildren(e),
		queryFn: ({ signal: t }) => n.listTraditionalChildren(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => YC(e, t, (e) => e.child_session_id)
	});
}
function ow() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, payload: n }) => e.startTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.traditionalChildren(n.sessionId), (t = []) => JC(t, e, (e) => e.child_session_id));
		}
	});
}
function sw() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, childId: n }) => e.cancelTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.traditionalChildren(n.sessionId), (t = []) => JC(t, e, (e) => e.child_session_id));
		}
	});
}
function cw(e, t) {
	let { api: n } = i(), r = Se();
	return t &&= r.orchestrationEnabled, g({
		queryKey: v.managedOrchestrators(e),
		queryFn: ({ signal: t }) => n.listManagedOrchestrators(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => YC(e, t, (e) => e.orchestrator_session_id)
	});
}
function lw() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, payload: n }) => e.startManagedOrchestrator(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.managedOrchestrators(n.sessionId), (t = []) => JC(t, e, (e) => e.orchestrator_session_id));
		}
	});
}
function uw() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, orchestratorId: n }) => e.cancelManagedOrchestrator(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.managedOrchestrators(n.sessionId), (t = []) => JC(t, e, (e) => e.orchestrator_session_id));
		}
	});
}
function dw(e, t) {
	let { api: n } = i();
	return g({
		queryKey: v.sessionInbox(e),
		queryFn: ({ signal: t }) => n.listInbox(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function fw() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, delivery: n, prompt: r }) => e.createInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => [...t.filter((t) => t.id !== e.id), e]);
		}
	});
}
function pw() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r, delivery: i }) => e.updateInboxItem(t, n, r, i),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
function mw() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r }) => e.cancelInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
// src/app/features/direct-session/commandWorkflow.ts
var hw = class extends zS("CommandFailure") {};
function gw(e) {
	return VS(function* () {
		yield* GS(e.optimistic);
		let t = yield* XS({
			try: e.admit,
			catch: (e) => new hw({
				operation: "submit",
				cause: e
			})
		}).pipe(rC(() => GS(e.rejected)));
		return t.kind === "accepted" ? (yield* GS(() => e.reconcile(!1)), t.value) : (yield* GS(() => {
			t.kind === "uncertain" ? e.reconcile(!0) : e.rejected();
		}), yield* BS(new hw({
			operation: "submit",
			cause: t.error
		})));
	});
}
function _w(e) {
	return VS(function* () {
		yield* GS(e.optimistic), yield* XS({
			try: e.cancel,
			catch: (e) => new hw({
				operation: "stop",
				cause: e
			})
		}).pipe(rC(() => GS(e.rollback))), yield* GS(e.settled);
	});
}
function vw(e) {
	return XS({
		try: e.create,
		catch: (e) => new hw({
			operation: "create",
			cause: e
		})
	}).pipe(nC((t) => GS(() => e.accept(t))));
}
function yw(e) {
	if (e.mode === "direct-running" || e.delivery) {
		let t = e.delivery ?? "steer";
		return XS({
			try: () => e.inbox(t),
			catch: (e) => new hw({
				operation: t,
				cause: e
			})
		}).pipe(ZS(t === "queue" ? "queued" : "steered"));
	}
	let t = e.mode === "classic-running";
	return XS({
		try: t ? e.steer : e.submit,
		catch: (e) => new hw({
			operation: t ? "steer" : "submit",
			cause: e
		})
	}).pipe(ZS(t ? "steered" : "submitted"));
}
async function bw(e) {
	let t = await oC(e);
	if (Dp(t)) return t.value;
	let n = Ix(t.cause);
	throw An(n) ? n.value.cause : Lx(t.cause);
}
// src/app/features/direct-session/commandAdapters.ts
function xw(e, t) {
	let { api: n, stores: { runtimeStore: { captureRuntimeActivation: i, finishRunCancel: a, requestRunCancel: o, restoreRunCancel: s, runtimeStore: c } } } = r(e), l = i(t), u = v.sessionSnapshot(t), d, f, p, m = [];
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
		cancel: () => n.cancelActiveRun(t),
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
function Sw(e, t, n) {
	return Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && Number.isSafeInteger(e.total) && e.start >= 0 && e.start <= e.end && e.end <= e.total && e.end - e.start === t && n === t;
}
function Cw(e, t, n) {
	let r = /* @__PURE__ */ new Set();
	return (e ?? []).every(({ message_index: e }) => !Number.isSafeInteger(e) || r.has(e) || t[e - n]?.role !== "user" ? !1 : (r.add(e), !0));
}
function ww(e, t, n) {
	return (e ?? []).filter(({ message_index: e }) => e >= t && e < n);
}
function Tw(e) {
	return Sw(e.page, e.messages.length, e.created_at.length) && Cw(e.terminal_selection_attributions, e.messages, e.page.start);
}
function Ew(e) {
	let t = e.message_page, n = e.message_created_at ?? [];
	return !!(t && Sw(t, e.messages.length, n.length) && Cw(e.terminal_selection_attributions, e.messages, t.start));
}
function Dw(e) {
	return e.message_page ?? {
		start: 0,
		end: e.messages.length,
		total: e.messages.length,
		has_older: !1
	};
}
function Ow(e) {
	let t = e.message_created_at ?? [];
	return t.length === e.messages.length ? t : Array.from({ length: e.messages.length }, () => null);
}
function kw(e, t) {
	if (!Tw(t)) return { kind: "snapshot-required" };
	let n = Dw(e), r = Ow(e);
	if (!Sw(n, e.messages.length, r.length) || t.page.end !== t.page.total || t.page.total < n.total || t.page.start > n.end) return { kind: "snapshot-required" };
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
			terminal_selection_attributions: [...ww(e.terminal_selection_attributions, n.start, t.page.start), ...t.terminal_selection_attributions ?? []],
			message_page: {
				...t.page,
				start: n.start,
				has_older: n.start > 0
			}
		}
	};
}
function Aw(e, t, n) {
	if (!Tw(t)) return null;
	let r = Dw(e), i = Ow(e);
	return r.start !== n || t.page.end !== n || t.page.total !== r.total || !Sw(r, e.messages.length, i.length) ? null : {
		...e,
		messages: [...t.messages, ...e.messages],
		message_created_at: [...t.created_at, ...i],
		terminal_selection_attributions: [...t.terminal_selection_attributions ?? [], ...ww(e.terminal_selection_attributions, r.start, r.end)],
		message_page: {
			start: t.page.start,
			end: r.end,
			total: r.total,
			has_older: t.page.start > 0
		}
	};
}
function jw(e, t, n) {
	if (n || !e || !t.message_page) return t;
	if (!Ew(t)) return e;
	let r = t.message_created_at ?? [], i = kw(e, {
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
function Mw(e, t, n) {
	let r = e.filter((e) => e !== t), i = Math.max(0, Math.min(n, r.length));
	return [
		...r.slice(0, i),
		t,
		...r.slice(i)
	];
}
function Nw(e, t) {
	return (e.sort_order ?? 0) - (t.sort_order ?? 0) || o(t.created_at) - o(e.created_at);
}
function Pw(e, t) {
	return e.filter((e) => !!e.summary.pinned === t).sort((e, t) => Nw(e.summary, t.summary));
}
function Fw(e, t, n) {
	let r = new Map(n.map((e) => [e.summary.session_id, e])), i = {};
	for (let e of t) i[e] = r.get(e)?.summary.presentation_version ?? 0;
	return {
		pinned: e,
		session_ids: t,
		expected_versions: i
	};
}
function Iw(e, t) {
	return e.map((e) => e.summary.session_id === t.session_id ? {
		...e,
		summary: t
	} : e);
}
function Lw(e, t, n, r) {
	if (t === r) {
		let t = e.findIndex((e) => e.summary.session_id === r);
		return t < 0 ? e.length : t;
	}
	let i = e.filter((e) => e.summary.session_id !== r), a = i.findIndex((e) => e.summary.session_id === t);
	return a < 0 ? i.length : n === "before" ? a : a + 1;
}
function Rw(e, t) {
	return e.length === t.length && e.every((e, n) => e === t[n]);
}
// src/app/services/queries/invalidation.ts
function zw() {
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
var Bw = /* @__PURE__ */ new Map(), Vw = 0, Hw = /* @__PURE__ */ new WeakMap(), Uw = 0;
function Ww(e, t) {
	let n = Hw.get(e);
	return n === void 0 && (n = ++Uw, Hw.set(e, n)), `${n}:${t}`;
}
function Gw(e) {
	let t = Bw.get(e);
	if (t) return t;
	let n = {
		generation: ++Vw,
		replaceNextSnapshot: !1,
		tailController: null,
		historyControllers: /* @__PURE__ */ new Set()
	};
	return Bw.set(e, n), n;
}
function Kw(e, t = !1) {
	let n = Gw(e);
	n.generation = ++Vw, n.replaceNextSnapshot ||= t, n.tailController?.abort(), n.tailController = null;
	for (let e of n.historyControllers) e.abort();
	return n.historyControllers.clear(), n.generation;
}
function qw(e) {
	let t = Gw(e);
	return {
		generation: Kw(e),
		replace: t.replaceNextSnapshot
	};
}
function Jw(e, t) {
	let n = Bw.get(e);
	n?.generation === t.generation && t.replace && (n.replaceNextSnapshot = !1);
}
function Yw(e) {
	let t = Gw(e);
	t.tailController?.abort();
	let n = new AbortController();
	return t.tailController = n, {
		generation: t.generation,
		controller: n
	};
}
function Xw(e, t) {
	let n = Bw.get(e);
	n?.tailController === t.controller && (n.tailController = null);
}
function Zw(e, t) {
	return Bw.get(e)?.generation === t;
}
function Qw(e) {
	let t = Gw(e), n = new AbortController();
	return t.historyControllers.add(n), {
		generation: t.generation,
		controller: n
	};
}
function $w(e, t) {
	Bw.get(e)?.historyControllers.delete(t.controller);
}
function eT(e) {
	let t = Bw.get(e);
	t?.tailController?.abort();
	for (let e of t?.historyControllers ?? []) e.abort();
	Bw.delete(e);
}
// src/app/services/queries/session.ts
function tT(e = Ce) {
	let { api: t } = i();
	return g({
		queryKey: v.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: e,
		staleTime: 0,
		placeholderData: ne
	});
}
function nT(e, t) {
	let n = new Map(t.filter((e) => e.workspace_diff !== void 0).map((e) => [e.summary.session_id, e.workspace_diff]));
	return e.map((e) => {
		let t = n.get(e.summary.session_id);
		return t === void 0 ? e : {
			...e,
			workspace_diff: t
		};
	});
}
function rT(e = {
	baseMs: Ce,
	statsMs: we
}) {
	let { api: t } = i(), n = tT(e.baseMs), r = g({
		queryKey: v.sessions(!0),
		queryFn: ({ signal: e }) => t.listSessions({ workspaceStats: !0 }, e),
		refetchInterval: e.statsMs,
		staleTime: e.statsMs
	}), a = m(() => n.data ? nT(n.data, r.data ?? []) : n.data, [n.data, r.data]);
	return {
		...n,
		data: a
	};
}
function iT(e) {
	let { api: t } = i(), n = d((t) => t.find((t) => t.summary.session_id === e) ?? null, [e]);
	return g({
		queryKey: v.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: Ce,
		staleTime: 0,
		placeholderData: ne,
		select: n
	});
}
function aT(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function oT(e, t) {
	let { api: n } = i(), r = _();
	return g({
		queryKey: v.sessionSnapshot(e ?? ""),
		queryFn: async ({ signal: t }) => {
			let i = qw(Ww(r, e)), a = await n.getSession(e, {
				messageLimit: 24,
				threadEventLimit: 50,
				includeSessions: !1,
				includeSystem: !0,
				signal: t
			});
			if (!Ew(a)) throw Error("The server returned an invalid snapshot message page.");
			if (t.aborted || !Zw(Ww(r, e), i.generation)) throw new DOMException("Snapshot superseded", "AbortError");
			return Jw(Ww(r, e), i), jw(r.getQueryData(v.sessionSnapshot(e)), a, i.replace);
		},
		enabled: !!e,
		staleTime: 1e3,
		placeholderData: aT(e ?? ""),
		...t
	});
}
function sT(e) {
	let { api: t } = i(), n = _();
	return h({ mutationFn: async () => {
		let r = n.getQueryData(v.sessionSnapshot(e))?.message_page?.start;
		if (r === void 0 || r <= 0) throw Error("No older messages are available.");
		let i = Ww(n, e), a = Qw(i);
		try {
			let o = await t.getMessages(e, {
				before: r,
				limit: 24,
				includeSystem: !0,
				signal: a.controller.signal
			});
			if (!Tw(o)) throw Error("The server returned an invalid message page.");
			if (!Zw(i, a.generation)) return !1;
			let s = !1;
			return n.setQueryData(v.sessionSnapshot(e), (e) => {
				if (!e) return e;
				let t = Aw(e, o, r);
				return t ? (s = !0, t) : e;
			}), s;
		} catch (e) {
			if (a.controller.signal.aborted) return !1;
			throw e;
		} finally {
			$w(i, a);
		}
	} });
}
function cT(e, t) {
	let { api: n } = i();
	return re({
		queryKey: v.threadEvents(e ?? "", t ?? ""),
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
function lT(e) {
	let { api: t } = i();
	return g({
		queryKey: v.sessionConfig(e ?? ""),
		queryFn: ({ signal: n }) => t.getConfig(e, n),
		enabled: !!e
	});
}
function uT() {
	let { api: e } = i(), t = zw(), n = _();
	return h({
		retry: !1,
		mutationFn: (r) => bw(vw({
			create: () => e.createSession(r),
			accept: (e) => {
				let r = e.metadata.session_id;
				if (!r) throw Error("The server returned a chat without an identity.");
				Kw(Ww(n, r), !0), n.setQueryData(v.sessionSnapshot(r), e), t.sessions();
			}
		}))
	});
}
function dT(e, t) {
	let n = [];
	for (let r of e.getQueryCache().findAll({ queryKey: ["session"] })) {
		let e = r.queryKey;
		if (e[0] !== "session" || e[2] !== "snapshot" || typeof e[1] != "string") continue;
		let i = e[1];
		i !== t && r.state.data?.forks?.some((e) => e.session_id === t) && n.push(i);
	}
	return n;
}
function fT() {
	let { api: e, stores: { promptDraftStore: t } } = i(), n = zw(), r = _();
	return h({
		mutationFn: (t) => e.deleteSession(t),
		onSuccess: (e, i) => {
			t.purgeSessions([i]), n.sessions(), r.removeQueries({ queryKey: v.sessionRoot(i) });
			for (let e of dT(r, i)) n.sessionRoot(e);
		}
	});
}
function pT() {
	let { api: e } = i(), t = zw();
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
function mT() {
	let e = pT();
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
function hT() {
	let { api: e } = i(), t = zw();
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
				a = Iw(a, t);
			}
			let s = Pw(a, r), c = s.map((e) => e.summary.session_id), l = Mw(c, n, i);
			return Rw(c, l) ? null : e.reorderSessions(Fw(r, l, s));
		},
		onSuccess: () => t.sessions()
	});
}
function gT() {
	let { api: e } = i(), t = zw(), n = _();
	return h({
		retry: !1,
		mutationFn: ({ id: t, patch: n }) => e.updateConfig(t, n),
		onSuccess: (e, { id: r }) => {
			n.invalidateQueries({ queryKey: v.sessionConfig(r) }), t.session(r), t.sessions();
		}
	});
}
function _T() {
	let { api: e } = i(), { captureRuntimeActivation: n, setOptimisticUserPrompt: r } = i().stores.runtimeStore, a = zw(), o = _();
	return h({
		retry: !1,
		mutationFn: ({ id: i, prompt: s, signal: c }) => {
			let l = n(i);
			return bw(gw({
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
					e ? (Kw(Ww(o, i), !0), a.sessionRoot(i)) : a.session(i);
				}
			}));
		}
	});
}
function vT() {
	let { api: e } = i();
	return h({ mutationFn: ({ id: t, instruction: n }) => e.steerOrchestrator(t, n) });
}
function yT() {
	let { api: e } = i();
	return h({ mutationFn: ({ id: t, threadName: n, instruction: r }) => e.steerThread(t, n, r) });
}
function bT() {
	let e = _();
	return h({
		retry: !1,
		mutationFn: (t) => bw(_w(xw(e, t)))
	});
}
function xT() {
	let { api: e } = i(), t = zw(), n = _();
	return h({
		mutationFn: (t) => e.compactSession(t),
		onSuccess: (e, r) => (Kw(Ww(n, r), !0), t.sessionRoot(r))
	});
}
function ST() {
	let { api: e } = i(), t = zw(), n = _();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.revertSession(t, n),
		onSuccess: (e, { id: r }) => {
			Kw(Ww(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function CT() {
	let { api: e } = i(), t = zw(), n = _();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.regenerateRun(t, n),
		onSuccess: (e, { id: r }) => {
			Kw(Ww(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function wT() {
	let { api: e } = i(), t = zw();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.forkSession(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n), t.sessions();
		}
	});
}
function TT() {
	let { api: e } = i(), t = zw();
	return h({
		mutationFn: ({ id: t, forkId: n }) => e.dismissSessionFork(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n);
		}
	});
}
function ET() {
	let e = tT(), t = Se(), n = m(() => e.data ? ye(t, e.data) : void 0, [e.data, t]);
	return {
		...e,
		data: n
	};
}
// src/app/services/queries/workspace.ts
function DT(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function OT(e, t, n = "all", r = 3, a = null) {
	let { api: o } = i();
	return g({
		queryKey: v.workspaceDiff(e ?? "", t ?? "", n, r, a),
		queryFn: ({ signal: i }) => o.getWorkspaceDiff(e, t, {
			stage: n,
			context: r,
			revision: a,
			signal: i
		}),
		enabled: !!(e && t),
		placeholderData: DT(e ?? "")
	});
}
function kT(e, t = null) {
	let { api: n } = i();
	return g({
		queryKey: v.workspaceFiles(e ?? "", t),
		queryFn: ({ signal: r }) => n.getWorkspaceFiles(e, t, r),
		enabled: !!e,
		staleTime: t == null ? 1e4 : Infinity,
		placeholderData: DT(e ?? "")
	});
}
function AT(e, t, n = null) {
	let { api: r } = i();
	return g({
		queryKey: v.workspaceFile(e ?? "", t ?? "", n),
		queryFn: ({ signal: i }) => r.getWorkspaceFile(e, t, n, i),
		enabled: !!(e && t),
		staleTime: n == null ? 1e4 : Infinity,
		placeholderData: DT(e ?? "")
	});
}
function jT(e) {
	let { api: t } = i();
	return g({
		queryKey: v.workspaceRevisions(e ?? ""),
		queryFn: ({ signal: n }) => t.getWorkspaceRevisions(e, n),
		enabled: !!e,
		staleTime: 5e3,
		retry: !1
	});
}
function MT(e, t) {
	let { api: n } = i();
	return g({
		queryKey: v.workspaceRevisionChanges(e ?? "", t ?? 0),
		queryFn: ({ signal: r }) => n.getWorkspaceRevisionChanges(e, t, r),
		enabled: !!(e && t != null),
		staleTime: Infinity,
		placeholderData: DT(e ?? "")
	});
}
function NT(e, t) {
	let { api: n } = i();
	return g({
		queryKey: v.branches(e ?? ""),
		queryFn: ({ signal: t }) => n.getBranches(e, t),
		enabled: !!e && t,
		staleTime: 5e3,
		retry: !1
	});
}
function PT(e) {
	let { api: t } = i(), n = _();
	return h({
		mutationFn: (n) => t.switchBranch(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: v.branches(e) }), n.invalidateQueries({ queryKey: v.sessionRoot(e) }), n.invalidateQueries({ queryKey: v.sessionsAll });
		}
	});
}
function FT(e) {
	let { api: t } = i(), n = _();
	return h({
		mutationFn: (n) => t.commitWorkspace(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: v.sessionRoot(e) }), n.invalidateQueries({ queryKey: v.sessionsAll });
		}
	});
}
// src/app/services/queries/projects.ts
function IT() {
	let { api: e } = i();
	return g({
		queryKey: v.projects,
		queryFn: ({ signal: t }) => e.listProjects(t),
		staleTime: 3e4,
		retry: !1
	});
}
function LT() {
	let { api: e } = i(), t = zw();
	return h({
		retry: !1,
		mutationFn: (t) => e.createProject(t),
		onSuccess: () => t.projects()
	});
}
function RT() {
	let { api: e } = i(), t = zw();
	return h({
		retry: !1,
		mutationFn: ({ projectId: t, payload: n }) => e.updateProject(t, n),
		onSuccess: () => t.projects()
	});
}
function zT() {
	let e = RT();
	return {
		...e,
		toggle: (t) => e.mutateAsync({
			projectId: t.project_id,
			payload: { pinned: !t.pinned }
		})
	};
}
function BT() {
	let { api: e, stores: { promptDraftStore: t } } = i(), n = zw();
	return h({
		mutationFn: ({ projectId: t, sessions: n }) => e.deleteProject(t, n),
		onSuccess: (e) => (t.purgeSessions(e.deleted_session_ids), Promise.all([n.projects(), n.sessions()]))
	});
}
function VT() {
	let { api: e } = i(), t = zw();
	return h({
		mutationFn: ({ projectId: t, sessionId: n }) => e.assignSessionToProject(t, { session_id: n }),
		onSuccess: () => Promise.all([t.projects(), t.sessions()])
	});
}
function HT() {
	let { api: e } = i(), t = zw();
	return h({
		mutationFn: async ({ projects: t, projectId: n, targetPinned: r, targetIndex: i }) => {
			let a = t.find((e) => e.project_id === n);
			if (!a) return;
			let o = t;
			a.pinned !== r && (await e.updateProject(n, { pinned: r }), o = (await e.listProjects()).projects);
			let s = o.filter((e) => e.pinned === r).sort((e, t) => e.sort_order - t.sort_order), c = Mw(s.map((e) => e.project_id), n, i);
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
var UT = [
	"status",
	"github",
	"secrets"
], WT = /* @__PURE__ */ new Set([
	"PATH",
	"HOME",
	"NAC_HOME",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"EXA_API_KEY"
]);
function GT(e) {
	return e ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(e) ? WT.has(e) ? `${e} is managed by NAC and cannot be replaced here.` : "" : "Use letters, digits, and underscores; the first character cannot be a digit." : "Enter a variable name.";
}
function KT(e) {
	let t = e?.split("/") ?? [];
	return t.length === 2 && t[0] && t[1] ? [t[0], t[1]] : null;
}
function qT(e) {
	return e?.status === "running";
}
function JT(e) {
	return e ? {
		backend: e.model.backend,
		model: e.model.id,
		baseUrl: e.model.endpoint
	} : null;
}
function YT(e, t) {
	return !!(t && e && t.backend === e.model.backend && t.baseUrl === e.model.endpoint);
}
function XT(e, t) {
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
function ZT(e) {
	return typeof e == "object" && e && "status" in e ? e.status : null;
}
function QT(e) {
	return $T(e) || e instanceof Error && e.name === "ManagedUpgradeContractError";
}
function $T(e) {
	let t = ZT(e);
	return t === 401 || t === 403 || t === 409;
}
function eE(e) {
	let t = ZT(e);
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
var tE = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying"
]);
function nE(e) {
	return tE.has(e);
}
function rE(e) {
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
function iE(e) {
	switch (e) {
		case "cancel_active_run": return "Stop run";
		case "cancel_traditional_child": return "Cancel coding agent";
		case "cancel_managed_orchestrator": return "Cancel NAC orchestrator";
		case "terminate_terminal": return "Stop terminal";
		case "cancel_clone_operation": return "Cancel clone";
		case "wait": return "Wait";
	}
}
function aE(e) {
	return e === null ? "Accepted-release distance unavailable" : e === 0 ? "Current accepted release" : `${e} accepted ${e === 1 ? "release" : "releases"} ahead`;
}
function oE(e, t) {
	return e.release_id === t.release_id && e.source_revision === t.source_revision && e.build_id === t.build_id && e.product_version === t.product_version && e.schema_version === t.schema_version;
}
// src/app/features/managed/upgradeContract.ts
var sE = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying",
	"succeeded",
	"failed"
]), cE = /* @__PURE__ */ new Set([
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
]), lE = /* @__PURE__ */ new Set([
	"wait",
	"cancel_active_run",
	"cancel_traditional_child",
	"cancel_managed_orchestrator",
	"terminate_terminal",
	"cancel_clone_operation"
]), uE = {
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
}, dE = class extends Error {
	constructor() {
		super("Managed upgrade status did not match the browser contract."), this.name = "ManagedUpgradeContractError";
	}
};
function $() {
	throw new dE();
}
function fE(e, t, n) {
	(typeof e != "object" || !e || Array.isArray(e)) && $();
	let r = e;
	return Object.keys(r).some((e) => !t.includes(e)) && $(), n.some((e) => !Object.hasOwn(r, e)) && $(), r;
}
function pE(e, t, n = !0) {
	return (typeof e != "string" || e.length > t || !n && e.length === 0 || /\p{Cc}/u.test(e)) && $(), e;
}
function mE(e) {
	return (typeof e != "number" || !Number.isSafeInteger(e) || e < 0) && $(), e;
}
function hE(e, t) {
	return typeof e == "string" && t.has(e) || $(), e;
}
function gE(e, t, n) {
	return Object.hasOwn(e, t) ? pE(e[t], n) : void 0;
}
function _E(e) {
	let t = fE(e, [
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
	]), n = pE(t.source_revision, 40, !1);
	return /^[a-f0-9]{40}$/.test(n) || $(), {
		release_id: pE(t.release_id, 63, !1),
		source_revision: n,
		build_id: pE(t.build_id, 128, !1),
		product_version: pE(t.product_version, 128, !1),
		schema_version: mE(t.schema_version)
	};
}
function vE(e, t) {
	return Object.hasOwn(e, t) ? _E(e[t]) : void 0;
}
function yE(e) {
	let t = pE(e, 128, !1);
	return /^[A-Za-z0-9_.:@-]+$/.test(t) || $(), t;
}
function bE(e) {
	let t = [
		"session_id",
		"run_id",
		"child_session_id",
		"orchestrator_session_id",
		"terminal_id",
		"clone_operation_id"
	], n = fE(e, t, []);
	return Object.fromEntries(t.filter((e) => Object.hasOwn(n, e)).map((e) => [e, yE(n[e])]));
}
function xE(e, t) {
	let n = Object.keys(e).sort();
	return n.length === t.length && t.every((t) => n.includes(t) && !!e[t]);
}
function SE(e, t, n) {
	switch (t) {
		case "cancel_active_run": return e === "active_run" && xE(n, ["session_id", "run_id"]);
		case "cancel_traditional_child": return e === "traditional_child" && xE(n, ["session_id", "child_session_id"]);
		case "cancel_managed_orchestrator": return e === "managed_orchestrator" && xE(n, ["session_id", "orchestrator_session_id"]);
		case "terminate_terminal": return e === "terminal_process" && xE(n, ["session_id", "terminal_id"]);
		case "cancel_clone_operation": return e === "clone_operation" && xE(n, ["clone_operation_id"]);
		case "wait": return !1;
	}
}
function CE(e) {
	let t = fE(e, [
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
	]), n = pE(t.selection_key, 71, !1);
	/^sha256:[a-f0-9]{64}$/.test(n) || $();
	let r = hE(t.kind, cE), i = pE(t.message, 512, !1);
	uE[r].includes(i) || $(), typeof t.actionable != "boolean" && $();
	let a = hE(t.action, lE);
	if (!t.actionable) return (a !== "wait" || t.target !== null) && $(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !1,
		action: a,
		target: null
	};
	let o = bE(t.target);
	return SE(r, a, o) || $(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !0,
		action: a,
		target: o
	};
}
function wE(e) {
	let t = fE(e, [
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
	t.kind !== "upgrade" && $();
	let n;
	return Object.hasOwn(t, "blockers") && ((!Array.isArray(t.blockers) || t.blockers.length > 100) && $(), n = t.blockers.map(CE)), {
		operation_id: pE(t.operation_id, 128, !1),
		managed_host_id: pE(t.managed_host_id, 128, !1),
		kind: "upgrade",
		state: hE(t.state, sE),
		reason: gE(t, "reason", 128),
		message: gE(t, "message", 512),
		target_release: vE(t, "target_release"),
		desired_release: vE(t, "desired_release"),
		observed_release: vE(t, "observed_release"),
		blockers: n,
		created_at: gE(t, "created_at", 64),
		updated_at: gE(t, "updated_at", 64)
	};
}
function TE(e) {
	let t = fE(e, ["preview", "operation"], ["preview", "operation"]), n = fE(t.preview, [
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
	typeof n.upgrade_available != "boolean" && $();
	let r = null;
	return n.distance !== null && (r = { accepted_releases: mE(fE(n.distance, ["accepted_releases"], ["accepted_releases"]).accepted_releases) }), {
		preview: {
			current: _E(n.current),
			latest_beta: _E(n.latest_beta),
			upgrade_available: n.upgrade_available,
			distance: r
		},
		operation: t.operation === null ? null : wE(t.operation)
	};
}
// src/app/features/managed/queries.ts
var EE = {
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
function DE() {
	let { api: e } = i();
	return g({
		queryKey: EE.hostStatus,
		queryFn: ({ signal: t }) => e.getManagedStatus(t),
		staleTime: 5e3,
		refetchInterval: 15e3,
		retry: !1
	});
}
function OE(e = !0) {
	let { api: t } = i();
	return g({
		queryKey: EE.upgrade,
		queryFn: async ({ signal: e }) => TE(await t.getManagedUpgrade(e)),
		enabled: e,
		staleTime: 0,
		refetchInterval: (e) => e.state.data?.operation && nE(e.state.data.operation.state) ? 1e3 : 15e3,
		refetchIntervalInBackground: !0,
		retry: !1
	});
}
function kE() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: async (t) => wE(await e.startManagedUpgrade(t)),
		onSuccess: (e) => (t.setQueryData(EE.upgrade, (t) => t && {
			...t,
			operation: e
		}), t.invalidateQueries({ queryKey: EE.upgrade }))
	});
}
function AE(e = !0) {
	let { api: t } = i();
	return g({
		queryKey: EE.github,
		queryFn: ({ signal: e }) => t.getManagedGitHub(e),
		enabled: e,
		retry: !1
	});
}
function jE(e = !0) {
	let { api: t } = i();
	return g({
		queryKey: EE.secrets,
		queryFn: ({ signal: e }) => t.listManagedSecrets(e),
		enabled: e,
		retry: !1
	});
}
function ME() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: ({ name: t, value: n }) => e.putManagedSecret(t, n),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: EE.secrets }), t.invalidateQueries({ queryKey: EE.hostStatus })])
	});
}
function NE() {
	let { api: e } = i(), t = _();
	return h({
		mutationFn: (t) => e.deleteManagedSecret(t),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: EE.secrets }), t.invalidateQueries({ queryKey: EE.hostStatus })])
	});
}
function PE(e = !0, t = !1) {
	let { api: n } = i();
	return g({
		queryKey: EE.auth,
		queryFn: ({ signal: e }) => n.listManagedAuth(e),
		enabled: e,
		staleTime: 3e4,
		refetchInterval: t,
		retry: !1
	});
}
function FE(e, t, n) {
	let { api: r } = i();
	return g({
		queryKey: [
			...EE.providerModels(e ?? ""),
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
function IE(e, t, n = null) {
	let { api: r } = i();
	return g({
		queryKey: EE.providerModels(e ?? "", n),
		queryFn: ({ signal: t }) => r.listProviderModels(n ? {
			backend: e,
			base_url: n
		} : { backend: e }, t),
		enabled: t && e !== null,
		retry: !1,
		staleTime: 3e5
	});
}
function LE(e) {
	let { api: t } = i(), n = DE().data ?? null, r = m(() => XT(e, n), [e, n]), a = ie({ queries: r.map((e) => ({
		queryKey: EE.providerModels(e.backend, e.base_url),
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
var RE = u(null), zE = 150, BE = 3, VE = 0, HE = () => `toast-${Date.now()}-${VE++}`;
function UE({ toasts: e, removeToast: t }) {
	let n = a(), r = ee(/* @__PURE__ */ new Map());
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
		className: "fixed top-4 right-4 z-[1100] flex w-[360px] max-w-[calc(100%-2rem)] flex-col gap-2 pointer-events-none",
		children: e.map((e) => /* @__PURE__ */ oe("div", {
			className: "pointer-events-auto",
			children: /* @__PURE__ */ oe(c, {
				content: e.content,
				variant: e.variant,
				dismissing: e.dismissing,
				onClose: () => t(e.id)
			})
		}, e.id))
	}), n);
}
function WE({ children: e }) {
	let [t, n] = te([]), r = d((e) => {
		let t = HE();
		return n((n) => [...n, {
			id: t,
			content: e.content,
			variant: e.variant ?? s.Info,
			life: e.life ?? BE,
			keep: e.keep ?? !1,
			dismissing: !1
		}]), t;
	}, []), i = d((e) => {
		n((t) => {
			let r = t.find((t) => t.id === e);
			return !r || r.dismissing ? t : (setTimeout(() => n((t) => t.filter((t) => t.id !== e)), zE), t.map((t) => t.id === e ? {
				...t,
				dismissing: !0
			} : t));
		});
	}, []), a = d(() => {
		n((e) => e.length === 0 ? e : (setTimeout(() => n((e) => e.filter((e) => !e.dismissing)), zE), e.map((e) => ({
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
	return /* @__PURE__ */ se(RE.Provider, {
		value: o,
		children: [e, /* @__PURE__ */ oe(UE, {
			toasts: t,
			removeToast: i
		})]
	});
}
function GE() {
	let e = f(RE);
	if (!e) throw Error("useToast must be used within a ToastProvider");
	return e;
}
function KE(e) {
	return e instanceof Error ? e.message : String(e);
}
// src/app/lib/workspaceLink.ts
var qE = /^(https?|ircs?|mailto|xmpp|file)$/i, JE = /^[a-zA-Z]:[\\/]/, YE = /^(https?|mailto|ircs?|xmpp):/i;
function XE(e) {
	let t = String(e ?? "").trim();
	if (!t) return "";
	if (JE.test(t)) return t;
	let n = t.indexOf(":");
	return n === -1 || qE.test(t.slice(0, n)) ? t : "";
}
function ZE(e) {
	return e.replace(/\\/g, "/");
}
function QE(e, t) {
	if (!t) return null;
	let n = ZE(t).replace(/\/+$/, "");
	return n ? e === n ? "" : e.startsWith(`${n}/`) ? e.slice(n.length + 1) : null : null;
}
function $E(e, t = []) {
	let n = (e ?? "").trim();
	if (!n || n.startsWith("#")) return { kind: "blocked" };
	if (YE.test(n)) return {
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
	r = ZE(r);
	for (let e of t) {
		let t = QE(r, e);
		if (t != null) {
			r = t;
			break;
		}
	}
	return r.startsWith("/") || JE.test(r) || (r = r.replace(/^\.\//, ""), !r || r === ".") || r.split("/").includes("..") || r.includes("://") ? { kind: "blocked" } : {
		kind: "workspace",
		path: r
	};
}
// src/app/lib/PerfProfiler.tsx
var eD = (t, n, r) => {
	e(`commit:${t}`, {
		ms: r,
		fields: { phase: n },
		throttleMs: 1e3,
		slowMs: 16
	});
};
function tD({ id: e, children: t }) {
	return n() ? /* @__PURE__ */ oe(l, {
		id: e,
		onRender: eD,
		children: t
	}) : /* @__PURE__ */ oe(ae, { children: t });
}
export { wT as $, Hx as $n, fC as $t, GT as A, qS as An, mw as At, NT as B, sC as Bn, dw as Bt, rE as C, EC as Cn, Nw as Ct, UT as D, uC as Dn, yw as Dt, oE as E, lC as En, kw as Et, BT as F, iC as Fn, fw as Ft, kT as G, rC as Gn, aw as Gt, PT as H, US as Hn, $C as Ht, HT as I, HS as In, ew as It, bT as J, zS as Jn, qC as Jt, MT as K, XS as Kn, rw as Kt, IT as L, tC as Ln, cw as Lt, KT as M, BS as Mn, sw as Mt, VT as N, VS as Nn, iw as Nt, qT as O, KS as On, bw as Ot, LT as P, JS as Pn, nw as Pt, TT as Q, Bx as Qn, LC as Qt, zT as R, aC as Rn, ZC as Rt, nE as S, OC as Sn, Ww as St, QT as T, bC as Tn, Lw as Tt, OT as U, WS as Un, lw as Ut, FT as V, eC as Vn, XC as Vt, AT as W, GS as Wn, ow as Wt, uT as X, Rx as Xn, GC as Xt, xT as Y, PS as Yn, KC as Yt, fT as Z, zx as Zn, WC as Zt, LE as _, RC as _n, fe as _r, Yw as _t, KE as a, UC as an, pi as ar, oT as at, $T as b, _C as bn, me as br, Xw as bt, NE as c, AC as cn, xe as cr, rT as ct, DE as d, FC as dn, be as dr, _T as dt, hC as en, Ix as er, sT as et, IE as f, jC as fn, ve as fr, cT as ft, ME as g, zC as gn, ue as gr, ET as gt, FE as h, BC as hn, le as hr, pT as ht, WE as i, DC as in, Op as ir, lT as it, YT as j, $S as jn, uw as jt, JT as k, QS as kn, QC as kt, PE as l, kC as ln, Se as lr, vT as lt, OE as m, mC as mn, de as mr, gT as mt, $E as n, VC as nn, Ep as nr, CT as nt, GE as o, xC as on, An as or, iT as ot, jE as p, PC as pn, ye as pr, mT as pt, jT as q, YS as qn, pw as qt, XE as r, yC as rn, Dp as rr, ST as rt, EE as s, CC as sn, v as sr, tT as st, tD as t, TC as tn, Lx as tr, hT as tt, AE as u, wC as un, _e as ur, yT as ut, kE as v, vC as vn, he as vr, eT as vt, eE as w, HC as wn, Pw as wt, aE as x, gC as xn, Zw as xt, iE as y, pC as yn, pe as yr, Kw as yt, RT as z, oC as zn, tw as zt };
