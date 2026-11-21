import { P as e, T as t, a as n, n as r, w as i } from "./RuntimeContext-DOnTWREP.js";
import { a } from "./PresentationBoundary-wIna-o0Q.js";
import { n as o, t as s } from "./Toast-tnv3_Qct.js";
import { Profiler as c, createContext as l, useCallback as u, useContext as d, useEffect as f, useMemo as p, useReducer as ee, useRef as m, useState as te } from "react";
import { keepPreviousData as ne, useMutation as h, useQueries as re, useQuery as g, useQueryClient as _ } from "@tanstack/react-query";
import { Fragment as ie, jsx as ae, jsxs as oe } from "react/jsx-runtime";
import { createPortal as se } from "react-dom";
// src/app/lib/primitive.ts
function ce(e) {
	return e != null && Object(e) !== e && e.constructor === String;
}
function le(e) {
	return e != null && Object(e) !== e && e.constructor === Number;
}
// src/app/lib/routes.ts
var ue = [
	"sessions",
	"insights",
	"delegated",
	"files",
	"terminal",
	"heartbeats",
	"history"
], de = {
	sessions: "Sessions",
	insights: "Insights",
	delegated: "Subagents",
	files: "Files",
	terminal: "Terminal",
	heartbeats: "Heartbeats",
	history: "History"
};
ue.filter((e) => e !== "history");
var fe = "insights";
function pe(e) {
	return ue.includes(e ?? "");
}
var me = [
	"general",
	"appearance",
	"accounts",
	"mcp",
	"capabilities",
	"ssh",
	"managed",
	"shortcuts",
	"about"
];
function he(e) {
	return me.includes(e ?? "");
}
var ge = {
	list: () => "/",
	newSession: (e) => e ? `/?project=${encodeURIComponent(e)}` : "/",
	settings: (e = "general") => `/settings/${e}`,
	session: (e, t = fe) => `/session/${encodeURIComponent(e)}/${t}`,
	project: (e) => `/project/${encodeURIComponent(e)}`,
	taskSchedules: (e) => e ? `/project/${encodeURIComponent(e)}/task-schedules` : "/task-schedules",
	designPreview: () => "/design"
};
function _e(e) {
	let [, t, n] = e.split("/");
	return t !== "session" || !n ? null : decodeURIComponent(n);
}
function ve(e) {
	let [, t, n] = e.split("/");
	return t !== "project" || !n ? null : decodeURIComponent(n);
}
// src/app/services/queries/keys.ts
var ye = 5e3, v = {
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
}, be = (e) => typeof e == "function", y = function(e, t) {
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
}, b = (e) => e, xe = (e) => () => e, Se = /*#__PURE__*/ xe(!0), Ce = /*#__PURE__*/ xe(!1), we = /*#__PURE__*/ xe(void 0), Te = we;
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
var Ee = (e) => (t, n) => t === n || e(t, n), De = /*#__PURE__*/ y(2, (e, t) => Ee((n, r) => e(t(n), t(r)))), Oe = (e) => Ee((t, n) => {
	if (t.length !== n.length) return !1;
	for (let r = 0; r < t.length; r++) if (!e(t[r], n[r])) return !1;
	return !0;
}), ke = "effect/GlobalValue", Ae, S = (e, t) => (Ae ||= (globalThis[ke] ??= /* @__PURE__ */ new Map(), globalThis[ke]), Ae.has(e) || Ae.set(e, t()), Ae.get(e)), je = (e) => typeof e == "string", Me = (e) => typeof e == "number", Ne = (e) => typeof e == "bigint", Pe = be, Fe = (e) => typeof e == "object" && !!e, Ie = (e) => Fe(e) || Pe(e), C = /*#__PURE__*/ y(2, (e, t) => Ie(e) && t in e), Le = /*#__PURE__*/ y(2, (e, t) => C(e, "_tag") && e._tag === t), Re = (e) => e == null, ze = (e) => typeof e == "string" || C(e, Symbol.iterator), Be = (e) => C(e, "then") && Pe(e.then), Ve = (e) => `BUG: ${e} - please report an issue at https://github.com/Effect-TS/effect/issues`, He = class e {
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
}, Ue = 335903614, We = 4150755663, Ge = 1481765933, Ke = 1284865837, qe = 9007199254740992, Je = 134217728, Ye = class {
	_state;
	constructor(e, t, n, r) {
		return Re(t) && Re(e) ? (t = Math.random() * 4294967295 >>> 0, e = 0) : Re(t) && (t = e, e = 0), Re(r) && Re(n) ? (r = this._state ? this._state[3] : We, n = this._state ? this._state[2] : Ue) : Re(r) && (r = n, n = 0), this._state = new Int32Array([
			0,
			0,
			n >>> 0,
			((r || 0) | 1) >>> 0
		]), this._next(), Ze(this._state, this._state[0], this._state[1], e >>> 0, t >>> 0), this._next(), this;
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
		return (e * Je + t) / qe;
	}
	_next() {
		let e = this._state[0] >>> 0, t = this._state[1] >>> 0;
		Xe(this._state, e, t, Ge, Ke), Ze(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
		let n = e >>> 18, r = (t >>> 18 | e << 14) >>> 0;
		n = (n ^ e) >>> 0, r = (r ^ t) >>> 0;
		let i = (r >>> 27 | n << 5) >>> 0, a = e >>> 27, o = (-a >>> 0 & 31) >>> 0;
		return (i >>> a | i << o) >>> 0;
	}
};
function Xe(e, t, n, r, i) {
	let a = (n >>> 16) * (i & 65535) >>> 0, o = (n & 65535) * (i >>> 16) >>> 0, s = (n & 65535) * (i & 65535) >>> 0, c = (n >>> 16) * (i >>> 16) + ((o >>> 16) + (a >>> 16)) >>> 0;
	o = o << 16 >>> 0, s = s + o >>> 0, s >>> 0 < o >>> 0 && (c = c + 1 >>> 0), a = a << 16 >>> 0, s = s + a >>> 0, s >>> 0 < a >>> 0 && (c = c + 1 >>> 0), c = c + Math.imul(n, r) >>> 0, c = c + Math.imul(t, i) >>> 0, e[0] = c, e[1] = s;
}
function Ze(e, t, n, r, i) {
	let a = t + r >>> 0, o = n + i >>> 0;
	o >>> 0 < n >>> 0 && (a = a + 1 | 0), e[0] = a, e[1] = o;
}
var Qe = /*#__PURE__*/ Symbol.for("effect/Utils/YieldWrap"), $e = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	[Qe]() {
		return this.#e;
	}
};
function et(e) {
	if (typeof e == "object" && e && Qe in e) return e[Qe]();
	throw Error(Ve("yieldWrapGet"));
}
var tt = /*#__PURE__*/ S("effect/Utils/isStructuralRegion", () => ({
	enabled: !1,
	tester: void 0
})), nt = { effect_internal_function: (e) => e() }, w = /*#__PURE__*/ nt.effect_internal_function(() => (/* @__PURE__ */ Error()).stack)?.includes("effect_internal_function") === !0 ? nt.effect_internal_function : { effect_internal_function: (e) => {
	try {
		return e();
	} finally {}
} }.effect_internal_function;
(function* () {}).constructor;
// node_modules/effect/dist/esm/Hash.js
var rt = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Hash/randomHashCache"), () => /* @__PURE__ */ new WeakMap()), T = /*#__PURE__*/ Symbol.for("effect/Hash"), E = (e) => {
	if (tt.enabled === !0) return 0;
	switch (typeof e) {
		case "number": return st(e);
		case "bigint": return O(e.toString(10));
		case "boolean": return O(String(e));
		case "symbol": return O(String(e));
		case "string": return O(e);
		case "undefined": return O("undefined");
		case "function":
		case "object": return e === null ? O("null") : e instanceof Date ? Number.isNaN(e.getTime()) ? O("Invalid Date") : E(e.toISOString()) : e instanceof URL ? E(e.href) : ot(e) ? e[T]() : it(e);
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, it = (e) => (rt.has(e) || rt.set(e, st(Math.floor(Math.random() * (2 ** 53 - 1)))), rt.get(e)), D = (e) => (t) => t * 53 ^ e, at = (e) => e & 3221225471 | e >>> 1 & 1073741824, ot = (e) => C(e, T), st = (e) => {
	if (e !== e || e === Infinity) return 0;
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return at(t);
}, O = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return at(t);
}, ct = (e, t) => {
	let n = 12289;
	for (let r = 0; r < t.length; r++) n ^= x(O(t[r]), D(E(e[t[r]])));
	return at(n);
}, lt = (e) => ct(e, Object.keys(e)), ut = (e) => {
	let t = 6151;
	for (let n = 0; n < e.length; n++) t = x(t, D(E(e[n])));
	return at(t);
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
	return arguments.length === 1 ? (e) => dt(e, arguments[0]) : dt(arguments[0], arguments[1]);
}
function dt(e, t) {
	if (e === t) return !0;
	let n = typeof e;
	if (n !== typeof t) return !1;
	if (n === "object" || n === "function") {
		if (e !== null && t !== null) {
			if (ft(e) && ft(t)) return E(e) === E(t) && e[A](t) ? !0 : tt.enabled && tt.tester ? tt.tester(e, t) : !1;
			if (e instanceof Date && t instanceof Date) {
				let n = e.getTime(), r = t.getTime();
				return n === r || Number.isNaN(n) && Number.isNaN(r);
			}
			if (e instanceof URL && t instanceof URL) return e.href === t.href;
		}
		if (tt.enabled) {
			if (e === null || t === null) return !1;
			if (Array.isArray(e) && Array.isArray(t)) return e.length === t.length && e.every((e, n) => dt(e, t[n]));
			if (Object.getPrototypeOf(e) === Object.prototype && Object.getPrototypeOf(t) === Object.prototype) {
				let n = Object.keys(e), r = Object.keys(t);
				if (n.length === r.length) {
					for (let r of n) if (!(r in t && dt(e[r], t[r]))) return tt.tester ? tt.tester(e, t) : !1;
					return !0;
				}
			}
			return tt.tester ? tt.tester(e, t) : !1;
		}
	}
	return tt.enabled && tt.tester ? tt.tester(e, t) : !1;
}
var ft = (e) => C(e, A), pt = () => j, M = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), N = (e) => {
	try {
		if (C(e, "toJSON") && Pe(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(N);
	} catch {
		return {};
	}
	return bt(e);
}, P = (e) => JSON.stringify(e, null, 2), mt = (e, t = 2) => {
	if (typeof e == "string") return e;
	try {
		return typeof e == "object" ? ht(e, t) : String(e);
	} catch {
		return String(e);
	}
}, ht = (e, t) => {
	let n = [], r = JSON.stringify(e, (e, t) => typeof t == "object" && t ? n.includes(t) ? void 0 : n.push(t) && (vt.fiberRefs !== void 0 && _t(t) ? t[gt](vt.fiberRefs) : t) : t, t);
	return n = void 0, r;
}, gt = /*#__PURE__*/ Symbol.for("effect/Inspectable/Redactable"), _t = (e) => typeof e == "object" && !!e && gt in e, vt = /*#__PURE__*/ S("effect/Inspectable/redactableState", () => ({ fiberRefs: void 0 })), yt = (e, t) => {
	let n = vt.fiberRefs;
	vt.fiberRefs = e;
	try {
		return t();
	} finally {
		vt.fiberRefs = n;
	}
}, bt = (e) => _t(e) && vt.fiberRefs !== void 0 ? e[gt](vt.fiberRefs) : e, F = (e, t) => {
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
}, xt = "Async", St = "Commit", Ct = "Failure", wt = "OnFailure", Tt = "OnSuccess", Et = "OnSuccessAndFailure", Dt = "Success", Ot = "Sync", kt = "UpdateRuntimeFlags", At = "While", jt = "Iterator", Mt = "WithRuntime", Nt = "Yield", Pt = "RevertFlags", Ft = "3.22.2", It = () => Ft, Lt = /*#__PURE__*/ Symbol.for("effect/Effect"), Rt = /*#__PURE__*/ Symbol.for("effect/Stream"), zt = /*#__PURE__*/ Symbol.for("effect/Sink"), Bt = /*#__PURE__*/ Symbol.for("effect/Channel"), Vt = {
	/* c8 ignore next */
	_R: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e,
	_V: /*#__PURE__*/ It()
}, Ht = {
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
}, Ut = {
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
}, Wt = {
	[Lt]: Vt,
	[Rt]: Vt,
	[zt]: Ht,
	[Bt]: Ut,
	[A](e) {
		return this === e;
	},
	[T]() {
		return k(this, it(this));
	},
	[Symbol.iterator]() {
		return new He(new $e(this));
	},
	pipe() {
		return F(this, arguments);
	}
}, Gt = {
	[T]() {
		return k(this, lt(this));
	},
	[A](e) {
		let t = Object.keys(this), n = Object.keys(e);
		if (t.length !== n.length) return !1;
		for (let n of t) if (!(n in e && j(this[n], e[n]))) return !1;
		return !0;
	}
}, Kt = {
	...Wt,
	_op: St
}, qt = {
	...Kt,
	...Gt
}, Jt = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = Kt, e;
}(), Yt = /*#__PURE__*/ Symbol.for("effect/Option"), Xt = {
	...Wt,
	[Yt]: { _A: (e) => e },
	[M]() {
		return this.toJSON();
	},
	toString() {
		return P(this.toJSON());
	}
}, Zt = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Xt), {
	_tag: "Some",
	_op: "Some",
	[A](e) {
		return en(e) && nn(e) && j(this.value, e.value);
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
}), Qt = /*#__PURE__*/ E("None"), $t = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Xt), {
	_tag: "None",
	_op: "None",
	[A](e) {
		return en(e) && tn(e);
	},
	[T]() {
		return Qt;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), en = (e) => C(e, Yt), tn = (e) => e._tag === "None", nn = (e) => e._tag === "Some", rn = /*#__PURE__*/ Object.create($t), an = (e) => {
	let t = Object.create(Zt);
	return t.value = e, t;
}, on = /*#__PURE__*/ Symbol.for("effect/Either"), sn = {
	...Wt,
	[on]: { _R: (e) => e },
	[M]() {
		return this.toJSON();
	},
	toString() {
		return P(this.toJSON());
	}
}, cn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(sn), {
	_tag: "Right",
	_op: "Right",
	[A](e) {
		return un(e) && fn(e) && j(this.right, e.right);
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
}), ln = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(sn), {
	_tag: "Left",
	_op: "Left",
	[A](e) {
		return un(e) && dn(e) && j(this.left, e.left);
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
}), un = (e) => C(e, on), dn = (e) => e._tag === "Left", fn = (e) => e._tag === "Right", pn = (e) => {
	let t = Object.create(ln);
	return t.left = e, t;
}, mn = (e) => {
	let t = Object.create(cn);
	return t.right = e, t;
}, hn = pn, gn = dn, _n = fn, vn = /*#__PURE__*/ (/* @__PURE__ */ y(2, (e, { onLeft: t, onRight: n }) => gn(e) ? t(e.left) : n(e.right)))({
	onLeft: b,
	onRight: b
}), yn = (e) => e.length > 0, bn = (e) => (t, n) => t === n ? 0 : e(t, n), xn = /*#__PURE__*/ bn((e, t) => e < t ? -1 : 1), Sn = /*#__PURE__*/ y(2, (e, t) => bn((n, r) => e(t(n), t(r)))), Cn = (e) => y(2, (t, n) => e(t, n) === 1), I = () => rn, L = an, wn = tn, Tn = nn, En = /*#__PURE__*/ y(2, (e, { onNone: t, onSome: n }) => wn(e) ? t() : n(e.value)), Dn = /*#__PURE__*/ y(2, (e, t) => wn(e) ? t() : e.value), On = /*#__PURE__*/ y(2, (e, t) => wn(e) ? L(t()) : e), kn = (e) => e == null ? I() : L(e), An = /*#__PURE__*/ Dn(we), jn = /*#__PURE__*/ y(2, (e, t) => wn(e) ? I() : L(t(e.value))), Mn = /*#__PURE__*/ y(2, (e, t) => wn(e) ? I() : t(e.value)), Nn = /*#__PURE__*/ ((e) => y(2, (t, n) => !wn(t) && e(t.value, n)))(/* @__PURE__ */ pt()), Pn = (...e) => e, Fn = (e) => Array(e), In = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.max(1, Math.floor(e)), r = Array(n);
	for (let e = 0; e < n; e++) r[e] = t(e);
	return r;
}), R = (e) => Array.isArray(e) ? e : Array.from(e), Ln = (e) => Array.isArray(e) ? e : [e], Rn = /*#__PURE__*/ y(2, (e, t) => [t, ...e]), zn = /*#__PURE__*/ y(2, (e, t) => [...e, t]), Bn = /*#__PURE__*/ y(2, (e, t) => R(e).concat(R(t)));
Array.isArray;
var Vn = (e) => e.length === 0, Hn = yn, Un = yn, Wn = (e, t) => e < 0 || e >= t.length, Gn = (e, t) => Math.floor(Math.min(Math.max(0, e), t.length)), Kn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.floor(t);
	return Wn(n, e) ? I() : L(e[n]);
}), qn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.floor(t);
	if (Wn(n, e)) throw Error(`Index ${n} out of bounds`);
	return e[n];
}), Jn = /*#__PURE__*/ Kn(0), Yn = /*#__PURE__*/ qn(0), Xn = (e) => Un(e) ? L(Zn(e)) : I(), Zn = (e) => e[e.length - 1], Qn = (e) => e.slice(1), $n = (e, t) => {
	let n = 0;
	for (let r of e) {
		if (!t(r, n)) break;
		n++;
	}
	return n;
}, er = /*#__PURE__*/ y(2, (e, t) => sr(e, $n(e, t))), tr = /*#__PURE__*/ y(2, (e, t) => {
	let n = R(e);
	return n.slice(Gn(t, n), n.length);
}), nr = (e) => Array.from(e).reverse(), rr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Array.from(e);
	return n.sort(t), n;
}), ir = /*#__PURE__*/ y(2, (e, t) => ar(e, t, Pn)), ar = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = R(e), i = R(t);
	if (Un(r) && Un(i)) {
		let e = [n(Yn(r), Yn(i))], t = Math.min(r.length, i.length);
		for (let a = 1; a < t; a++) e[a] = n(r[a], i[a]);
		return e;
	}
	return [];
}), or = /*#__PURE__*/ pt(), sr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Array.from(e), r = Math.floor(t);
	return Un(n) ? r >= 1 ? cr(n, r) : [[], n] : [n, []];
}), cr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.max(1, Math.floor(t));
	return n >= e.length ? [lr(e), []] : [Rn(e.slice(1, n), Yn(e)), e.slice(n)];
}), lr = (e) => e.slice(), ur = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = R(e), i = R(t);
	return Un(r) ? Un(i) ? yr(n)(Bn(r, i)) : r : i;
}), dr = /*#__PURE__*/ y(2, (e, t) => ur(e, t, or)), fr = () => [], pr = (e) => [e], mr = /*#__PURE__*/ y(2, (e, t) => e.map(t)), hr = /*#__PURE__*/ (/* @__PURE__ */ y(2, (e, t) => {
	if (Vn(e)) return [];
	let n = [];
	for (let r = 0; r < e.length; r++) {
		let i = t(e[r], r);
		for (let e = 0; e < i.length; e++) n.push(i[e]);
	}
	return n;
}))(b), gr = /*#__PURE__*/ y(3, (e, t, n) => R(e).reduce((e, t, r) => n(e, t, r), t)), _r = (e, t) => {
	let n = [], r = e, i;
	for (; Tn(i = t(r));) {
		let [e, t] = i.value;
		n.push(e), r = t;
	}
	return n;
}, vr = Oe, yr = /*#__PURE__*/ y(2, (e, t) => {
	let n = R(e);
	if (Un(n)) {
		let e = [Yn(n)], r = Qn(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), br = (e) => yr(e, pt()), xr = /*#__PURE__*/ y(2, (e, t) => R(e).join(t)), Sr = xn, Cr = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"), wr = /*#__PURE__*/ Symbol.for("effect/Context/Tag"), Tr = /*#__PURE__*/ Symbol.for("effect/Context/Reference"), Er = /*#__PURE__*/ Symbol.for("effect/STM"), Dr = {
	...Wt,
	_op: "Tag",
	[Er]: Vt,
	[wr]: {
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
		return Vr(this, e);
	}
}, Or = {
	...Dr,
	[Tr]: Tr
}, kr = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	let r = Object.create(Dr);
	return Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r.key = e, r;
}, Ar = (e) => () => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	function r() {}
	return Object.setPrototypeOf(r, Dr), r.key = e, Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r;
}, jr = () => (e, t) => {
	let n = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let r = /* @__PURE__ */ Error();
	Error.stackTraceLimit = n;
	function i() {}
	return Object.setPrototypeOf(i, Or), i.key = e, i.defaultValue = t.defaultValue, Object.defineProperty(i, "stack", { get() {
		return r.stack;
	} }), i;
}, Mr = /*#__PURE__*/ Symbol.for("effect/Context"), Nr = {
	[Mr]: { _Services: (e) => e },
	[A](e) {
		if (Ir(e) && this.unsafeMap.size === e.unsafeMap.size) {
			for (let t of this.unsafeMap.keys()) if (!e.unsafeMap.has(t) || !j(this.unsafeMap.get(t), e.unsafeMap.get(t))) return !1;
			return !0;
		}
		return !1;
	},
	[T]() {
		return k(this, st(this.unsafeMap.size));
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
}, Pr = (e) => {
	let t = Object.create(Nr);
	return t.unsafeMap = e, t;
}, Fr = (e) => {
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
}, Ir = (e) => C(e, Mr), Lr = (e) => C(e, wr), Rr = (e) => C(e, Tr), zr = /*#__PURE__*/ Pr(/*#__PURE__*/ new Map()), Br = () => zr, Vr = (e, t) => Pr(/* @__PURE__ */ new Map([[e.key, t]])), Hr = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = new Map(e.unsafeMap);
	return r.set(t.key, n), Pr(r);
}), Ur = /*#__PURE__*/ S("effect/Context/defaultValueCache", () => /* @__PURE__ */ new Map()), Wr = (e) => {
	if (Ur.has(e.key)) return Ur.get(e.key);
	let t = e.defaultValue();
	return Ur.set(e.key, t), t;
}, Gr = (e, t) => e.unsafeMap.has(t.key) ? e.unsafeMap.get(t.key) : Wr(t), Kr = /*#__PURE__*/ y(2, (e, t) => {
	if (!e.unsafeMap.has(t.key)) {
		if (Tr in t) return Wr(t);
		throw Fr(t);
	}
	return e.unsafeMap.get(t.key);
}), qr = Kr, Jr = /*#__PURE__*/ y(2, (e, t) => e.unsafeMap.has(t.key) ? an(e.unsafeMap.get(t.key)) : Rr(t) ? an(Wr(t)) : rn), Yr = /*#__PURE__*/ y(2, (e, t) => {
	let n = new Map(e.unsafeMap);
	for (let [e, r] of t.unsafeMap) n.set(e, r);
	return Pr(n);
}), Xr = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n = 0; n < e.length; n++) e[n].unsafeMap.forEach((e, n) => {
		t.set(n, e);
	});
	return Pr(t);
}, Zr = kr, Qr = Ir, $r = Lr, ei = Br, ti = Vr, ni = Hr, ri = qr, ii = Kr, ai = Jr, oi = Yr, si = Xr, ci = Ar, li = jr, ui = /*#__PURE__*/ Symbol.for("effect/Chunk");
function di(e, t, n, r, i) {
	for (let a = t; a < Math.min(e.length, t + i); a++) n[r + a - t] = e[a];
	return n;
}
var fi = [], pi = /*#__PURE__*/ ((e) => Ee((t, n) => t.length === n.length && Si(t).every((t, r) => e(t, Di(n, r)))))(j), mi = {
	[ui]: { _A: (e) => e },
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Chunk",
			values: Si(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	[A](e) {
		return hi(e) && pi(this, e);
	},
	[T]() {
		return k(this, ut(Si(this)));
	},
	[Symbol.iterator]() {
		switch (this.backing._tag) {
			case "IArray": return this.backing.array[Symbol.iterator]();
			case "IEmpty": return fi[Symbol.iterator]();
			default: return Si(this)[Symbol.iterator]();
		}
	},
	pipe() {
		return F(this, arguments);
	}
}, z = (e) => {
	let t = Object.create(mi);
	switch (t.backing = e, e._tag) {
		case "IEmpty":
			t.length = 0, t.depth = 0, t.left = t, t.right = t;
			break;
		case "IConcat":
			t.length = e.left.length + e.right.length, t.depth = 1 + Math.max(e.left.depth, e.right.depth), t.left = e.left, t.right = e.right;
			break;
		case "IArray":
			t.length = e.array.length, t.depth = 0, t.left = gi, t.right = gi;
			break;
		case "ISingleton":
			t.length = 1, t.depth = 0, t.left = gi, t.right = gi;
			break;
		case "ISlice": t.length = e.length, t.depth = e.chunk.depth + 1, t.left = gi, t.right = gi;
	}
	return t;
}, hi = (e) => C(e, ui), gi = /*#__PURE__*/ z({ _tag: "IEmpty" }), _i = () => gi, vi = (...e) => Ei(e), yi = (e) => z({
	_tag: "ISingleton",
	a: e
}), bi = (e) => hi(e) ? e : Ti(R(e)), xi = (e, t, n) => {
	switch (e.backing._tag) {
		case "IArray":
			di(e.backing.array, 0, t, n, e.length);
			break;
		case "IConcat":
			xi(e.left, t, n), xi(e.right, t, n + e.left.length);
			break;
		case "ISingleton":
			t[n] = e.backing.a;
			break;
		case "ISlice": {
			let r = 0, i = n;
			for (; r < e.length;) t[i] = Di(e, r), r += 1, i += 1;
			break;
		}
	}
}, Si = (e) => {
	switch (e.backing._tag) {
		case "IEmpty": return fi;
		case "IArray": return e.backing.array;
		default: {
			let t = Array(e.length);
			return xi(e, t, 0), e.backing = {
				_tag: "IArray",
				array: t
			}, e.left = gi, e.right = gi, e.depth = 0, t;
		}
	}
}, Ci = (e) => {
	switch (e.backing._tag) {
		case "IEmpty":
		case "ISingleton": return e;
		case "IArray": return z({
			_tag: "IArray",
			array: nr(e.backing.array)
		});
		case "IConcat": return z({
			_tag: "IConcat",
			left: Ci(e.backing.right),
			right: Ci(e.backing.left)
		});
		case "ISlice": return Ti(nr(Si(e)));
	}
}, wi = /*#__PURE__*/ y(2, (e, t) => t < 0 || t >= e.length ? I() : L(Di(e, t))), Ti = (e) => e.length === 0 ? _i() : e.length === 1 ? yi(e[0]) : z({
	_tag: "IArray",
	array: e
}), Ei = (e) => Ti(e), Di = /*#__PURE__*/ y(2, (e, t) => {
	switch (e.backing._tag) {
		case "IEmpty": throw Error("Index out of bounds");
		case "ISingleton":
			if (t !== 0) throw Error("Index out of bounds");
			return e.backing.a;
		case "IArray":
			if (t >= e.length || t < 0) throw Error("Index out of bounds");
			return e.backing.array[t];
		case "IConcat": return t < e.left.length ? Di(e.left, t) : Di(e.right, t - e.left.length);
		case "ISlice": return Di(e.backing.chunk, t + e.backing.offset);
	}
}), Oi = /*#__PURE__*/ y(2, (e, t) => ji(e, yi(t))), ki = /*#__PURE__*/ y(2, (e, t) => ji(yi(t), e)), Ai = /*#__PURE__*/ y(2, (e, t) => {
	if (t <= 0) return e;
	if (t >= e.length) return gi;
	switch (e.backing._tag) {
		case "ISlice": return z({
			_tag: "ISlice",
			chunk: e.backing.chunk,
			offset: e.backing.offset + t,
			length: e.backing.length - t
		});
		case "IConcat": return t > e.left.length ? Ai(e.right, t - e.left.length) : z({
			_tag: "IConcat",
			left: Ai(e.left, t),
			right: e.right
		});
		default: return z({
			_tag: "ISlice",
			chunk: e,
			offset: t,
			length: e.length - t
		});
	}
}), ji = /*#__PURE__*/ y(2, (e, t) => {
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
			let n = ji(e.right, t);
			return z({
				_tag: "IConcat",
				left: e.left,
				right: n
			});
		}
		{
			let n = ji(e.right.right, t);
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
		left: ji(e, t.left),
		right: t.right
	});
	{
		let n = ji(e, t.left.left);
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
}), Mi = (e) => e.length === 0, Ni = (e) => e.length > 0, Pi = /*#__PURE__*/ wi(0), Fi = (e) => Di(e, 0), Ii = Fi, Li = (e) => Ai(e, 1), Ri = /*#__PURE__*/ Symbol.for("effect/Duration"), zi = /*#__PURE__*/ BigInt(0), Bi = /*#__PURE__*/ BigInt(24), Vi = /*#__PURE__*/ BigInt(60), Hi = /*#__PURE__*/ BigInt(1e3), Ui = /*#__PURE__*/ BigInt(1e6), Wi = /*#__PURE__*/ BigInt(1e9), Gi = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Ki = (e) => {
	if (Zi(e)) return e;
	if (Me(e)) return ra(e);
	if (Ne(e)) return ta(e);
	if (Array.isArray(e) && e.length === 2 && e.every(Me)) return e[0] === -Infinity || e[1] === -Infinity || Number.isNaN(e[0]) || Number.isNaN(e[1]) ? $i : e[0] === Infinity || e[1] === Infinity ? ea : ta(BigInt(Math.round(e[0] * 1e9)) + BigInt(Math.round(e[1])));
	if (je(e)) {
		let t = Gi.exec(e);
		if (t) {
			let [e, n, r] = t, i = Number(n);
			switch (r) {
				case "nano":
				case "nanos": return ta(BigInt(n));
				case "micro":
				case "micros": return na(BigInt(n));
				case "milli":
				case "millis": return ra(i);
				case "second":
				case "seconds": return ia(i);
				case "minute":
				case "minutes": return aa(i);
				case "hour":
				case "hours": return oa(i);
				case "day":
				case "days": return sa(i);
				case "week":
				case "weeks": return ca(i);
			}
		}
	}
	throw Error("Invalid DurationInput");
}, qi = {
	_tag: "Millis",
	millis: 0
}, Ji = { _tag: "Infinity" }, Yi = {
	[Ri]: Ri,
	[T]() {
		return k(this, lt(this.value));
	},
	[A](e) {
		return Zi(e) && _a(this, e);
	},
	toString() {
		return `Duration(${ya(this)})`;
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
				hrtime: da(this)
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
}, Xi = (e) => {
	let t = Object.create(Yi);
	return t.value = Me(e) ? isNaN(e) || e <= 0 ? qi : Number.isFinite(e) ? Number.isInteger(e) ? {
		_tag: "Millis",
		millis: e
	} : {
		_tag: "Nanos",
		nanos: BigInt(Math.round(e * 1e6))
	} : Ji : e <= zi ? qi : {
		_tag: "Nanos",
		nanos: e
	}, t;
}, Zi = (e) => C(e, Ri), Qi = (e) => {
	switch (e.value._tag) {
		case "Millis": return e.value.millis === 0;
		case "Nanos": return e.value.nanos === zi;
		case "Infinity": return !1;
	}
}, $i = /*#__PURE__*/ Xi(0), ea = /*#__PURE__*/ Xi(Infinity), ta = (e) => Xi(e), na = (e) => Xi(e * Hi), ra = (e) => Xi(e), ia = (e) => Xi(e * 1e3), aa = (e) => Xi(e * 6e4), oa = (e) => Xi(e * 36e5), sa = (e) => Xi(e * 864e5), ca = (e) => Xi(e * 6048e5), la = (e) => fa(e, {
	onMillis: (e) => e,
	onNanos: (e) => Number(e) / 1e6
}), ua = (e) => {
	let t = Ki(e);
	switch (t.value._tag) {
		case "Infinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return BigInt(Math.round(t.value.millis * 1e6));
	}
}, da = (e) => {
	let t = Ki(e);
	switch (t.value._tag) {
		case "Infinity": return [Infinity, 0];
		case "Nanos": return [Number(t.value.nanos / Wi), Number(t.value.nanos % Wi)];
		case "Millis": return [Math.floor(t.value.millis / 1e3), Math.round(t.value.millis % 1e3 * 1e6)];
	}
}, fa = /*#__PURE__*/ y(2, (e, t) => {
	let n = Ki(e);
	switch (n.value._tag) {
		case "Nanos": return t.onNanos(n.value.nanos);
		case "Infinity": return t.onMillis(Infinity);
		case "Millis": return t.onMillis(n.value.millis);
	}
}), pa = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = Ki(e), i = Ki(t);
	if (r.value._tag === "Infinity" || i.value._tag === "Infinity") return n.onMillis(la(r), la(i));
	if (r.value._tag === "Nanos" || i.value._tag === "Nanos") {
		let e = r.value._tag === "Nanos" ? r.value.nanos : BigInt(Math.round(r.value.millis * 1e6)), t = i.value._tag === "Nanos" ? i.value.nanos : BigInt(Math.round(i.value.millis * 1e6));
		return n.onNanos(e, t);
	}
	return n.onMillis(r.value.millis, i.value.millis);
}), ma = (e, t) => pa(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t
}), ha = /*#__PURE__*/ y(2, (e, t) => pa(e, t, {
	onMillis: (e, t) => e <= t,
	onNanos: (e, t) => e <= t
})), ga = /*#__PURE__*/ y(2, (e, t) => pa(e, t, {
	onMillis: (e, t) => e >= t,
	onNanos: (e, t) => e >= t
})), _a = /*#__PURE__*/ y(2, (e, t) => ma(Ki(e), Ki(t))), va = (e) => {
	let t = Ki(e);
	if (t.value._tag === "Infinity") return {
		days: Infinity,
		hours: Infinity,
		minutes: Infinity,
		seconds: Infinity,
		millis: Infinity,
		nanos: Infinity
	};
	let n = ua(t), r = n / Ui, i = r / Hi, a = i / Vi, o = a / Vi, s = o / Bi;
	return {
		days: Number(s),
		hours: Number(o % Bi),
		minutes: Number(a % Vi),
		seconds: Number(i % Vi),
		millis: Number(r % Hi),
		nanos: Number(n % Ui)
	};
}, ya = (e) => {
	let t = Ki(e);
	if (t.value._tag === "Infinity") return "Infinity";
	if (Qi(t)) return "0";
	let n = va(t), r = [];
	return n.days !== 0 && r.push(`${n.days}d`), n.hours !== 0 && r.push(`${n.hours}h`), n.minutes !== 0 && r.push(`${n.minutes}m`), n.seconds !== 0 && r.push(`${n.seconds}s`), n.millis !== 0 && r.push(`${n.millis}ms`), n.nanos !== 0 && r.push(`${n.nanos}ns`), r.join(" ");
}, ba = 32, xa = ba - 1, Sa = ba / 2, Ca = ba / 4;
// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function wa(e) {
	return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), e = e + (e >> 4) & 252645135, e += e >> 8, e += e >> 16, e & 127;
}
function Ta(e, t) {
	return t >>> e & xa;
}
function Ea(e) {
	return 1 << e;
}
function Da(e, t) {
	return wa(e & t - 1);
}
// node_modules/effect/dist/esm/internal/stack.js
var Oa = (e, t) => ({
	value: e,
	previous: t
});
// node_modules/effect/dist/esm/internal/hashMap/array.js
function ka(e, t, n, r) {
	let i = r;
	if (!e) {
		let e = r.length;
		i = Array(e);
		for (let t = 0; t < e; ++t) i[t] = r[t];
	}
	return i[t] = n, i;
}
function Aa(e, t, n) {
	let r = n.length - 1, i = 0, a = 0, o = n;
	if (e) i = a = t;
	else for (o = Array(r); i < t;) o[a++] = n[i++];
	for (++i; i <= r;) o[a++] = n[i++];
	return e && (o.length = r), o;
}
function ja(e, t, n, r) {
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
var Ma = class e {
	_tag = "EmptyNode";
	modify(t, n, r, i, a, o) {
		let s = r(I());
		return wn(s) ? new e() : (++o.value, new Ia(t, i, a, s));
	}
};
function Na(e) {
	return Le(e, "EmptyNode");
}
function Pa(e) {
	return Na(e) || e._tag === "LeafNode" || e._tag === "CollisionNode";
}
function Fa(e, t) {
	return !Na(e) && t === e.edit;
}
var Ia = class e {
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
			return n === this.value ? this : wn(n) ? (--o.value, new Ma()) : Fa(this, t) ? (this.value = n, this) : new e(t, i, a, n);
		}
		let s = r(I());
		return wn(s) ? this : (++o.value, Ua(t, n, this.hash, this, i, new e(t, i, a, s)));
	}
}, La = class e {
	edit;
	hash;
	children;
	_tag = "CollisionNode";
	constructor(e, t, n) {
		this.edit = e, this.hash = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		if (i === this.hash) {
			let n = Fa(this, t), i = this.updateCollisionList(n, t, this.hash, this.children, r, a, o);
			return i === this.children ? this : i.length > 1 ? new e(t, this.hash, i) : i[0];
		}
		let s = r(I());
		return wn(s) ? this : (++o.value, Ua(t, n, this.hash, this, i, new Ia(t, i, a, s)));
	}
	updateCollisionList(e, t, n, r, i, a, o) {
		let s = r.length;
		for (let c = 0; c < s; ++c) {
			let s = r[c];
			if ("key" in s && j(a, s.key)) {
				let l = s.value, u = i(l);
				return u === l ? r : wn(u) ? (--o.value, Aa(e, c, r)) : ka(e, c, new Ia(t, n, a, u), r);
			}
		}
		let c = i(I());
		return wn(c) ? r : (++o.value, ka(e, s, new Ia(t, n, a, c), r));
	}
}, Ra = class e {
	edit;
	mask;
	children;
	_tag = "IndexedNode";
	constructor(e, t, n) {
		this.edit = e, this.mask = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.mask, c = this.children, l = Ta(n, i), u = Ea(l), d = Da(s, u), f = s & u, p = Fa(this, t);
		if (!f) {
			let f = new Ma().modify(t, n + 5, r, i, a, o);
			return f ? c.length >= Sa ? Va(t, l, f, s, c) : new e(t, s | u, ja(p, d, f, c)) : this;
		}
		let ee = c[d], m = ee.modify(t, n + 5, r, i, a, o);
		if (ee === m) return this;
		let te = s, ne;
		if (Na(m)) {
			if (te &= ~u, !te) return new Ma();
			if (c.length <= 2 && Pa(c[d ^ 1])) return c[d ^ 1];
			ne = Aa(p, d, c);
		} else ne = ka(p, d, m, c);
		return p ? (this.mask = te, this.children = ne, this) : new e(t, te, ne);
	}
}, za = class e {
	edit;
	size;
	children;
	_tag = "ArrayNode";
	constructor(e, t, n) {
		this.edit = e, this.size = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.size, c = this.children, l = Ta(n, i), u = c[l], d = (u || new Ma()).modify(t, n + 5, r, i, a, o);
		if (u === d) return this;
		let f = Fa(this, t), p;
		if (Na(u) && !Na(d)) ++s, p = ka(f, l, d, c);
		else if (!Na(u) && Na(d)) {
			if (--s, s <= Ca) return Ba(t, s, l, c);
			p = ka(f, l, new Ma(), c);
		} else p = ka(f, l, d, c);
		return f ? (this.size = s, this.children = p, this) : new e(t, s, p);
	}
};
function Ba(e, t, n, r) {
	let i = Array(t - 1), a = 0, o = 0;
	for (let e = 0, t = r.length; e < t; ++e) if (e !== n) {
		let t = r[e];
		t && !Na(t) && (i[a++] = t, o |= 1 << e);
	}
	return new Ra(e, o, i);
}
function Va(e, t, n, r, i) {
	let a = [], o = r, s = 0;
	for (let e = 0; o; ++e) o & 1 && (a[e] = i[s++]), o >>>= 1;
	return a[t] = n, new za(e, s + 1, a);
}
function Ha(e, t, n, r, i, a) {
	if (n === i) return new La(e, n, [a, r]);
	let o = Ta(t, n), s = Ta(t, i);
	if (o === s) return (t) => new Ra(e, Ea(o) | Ea(s), [t]);
	{
		let t = o < s ? [r, a] : [a, r];
		return new Ra(e, Ea(o) | Ea(s), t);
	}
}
function Ua(e, t, n, r, i, a) {
	let o, s = t;
	for (;;) {
		let t = Ha(e, s, n, r, i, a);
		if (typeof t == "function") o = Oa(t, o), s += 5;
		else {
			let e = t;
			for (; o != null;) e = o.value(e), o = o.previous;
			return e;
		}
	}
}
// node_modules/effect/dist/esm/internal/hashMap.js
var Wa = "effect/HashMap", Ga = /*#__PURE__*/ Symbol.for(Wa), Ka = {
	[Ga]: Ga,
	[Symbol.iterator]() {
		return new Ja(this, (e, t) => [e, t]);
	},
	[T]() {
		let e = E(Wa);
		for (let t of this) e ^= x(E(t[0]), D(E(t[1])));
		return k(this, e);
	},
	[A](e) {
		if (to(e)) {
			if (e._size !== this._size) return !1;
			for (let t of this) {
				let n = x(e, io(t[0], E(t[0])));
				if (wn(n) || !j(t[1], n.value)) return !1;
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
}, qa = (e, t, n, r) => {
	let i = Object.create(Ka);
	return i._editable = e, i._edit = t, i._root = n, i._size = r, i;
}, Ja = class e {
	map;
	f;
	v;
	constructor(e, t) {
		this.map = e, this.f = t, this.v = Xa(this.map._root, this.f, void 0);
	}
	next() {
		if (wn(this.v)) return {
			done: !0,
			value: void 0
		};
		let e = this.v.value;
		return this.v = Ya(e.cont), {
			done: !1,
			value: e.value
		};
	}
	[Symbol.iterator]() {
		return new e(this.map, this.f);
	}
}, Ya = (e) => e ? Za(e[0], e[1], e[2], e[3], e[4]) : I(), Xa = (e, t, n = void 0) => {
	switch (e._tag) {
		case "LeafNode": return Tn(e.value) ? L({
			value: t(e.key, e.value.value),
			cont: n
		}) : Ya(n);
		case "CollisionNode":
		case "ArrayNode":
		case "IndexedNode": {
			let r = e.children;
			return Za(r.length, r, 0, t, n);
		}
		default: return Ya(n);
	}
}, Za = (e, t, n, r, i) => {
	for (; n < e;) {
		let a = t[n++];
		if (a && !Na(a)) return Xa(a, r, [
			e,
			t,
			n,
			r,
			i
		]);
	}
	return Ya(i);
}, Qa = /*#__PURE__*/ qa(!1, 0, /*#__PURE__*/ new Ma(), 0), $a = () => Qa, eo = (e) => {
	let t = uo($a());
	for (let n of e) oo(t, n[0], n[1]);
	return fo(t);
}, to = (e) => C(e, Ga), no = (e) => e && Na(e._root), ro = /*#__PURE__*/ y(2, (e, t) => io(e, t, E(t))), io = /*#__PURE__*/ y(3, (e, t, n) => {
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
			let e = Ea(Ta(i, n));
			if (r.mask & e) {
				r = r.children[Da(r.mask, e)], i += 5;
				break;
			}
			return I();
		}
		case "ArrayNode":
			if (r = r.children[Ta(i, n)], r) {
				i += 5;
				break;
			}
			return I();
		default: return I();
	}
}), ao = /*#__PURE__*/ y(2, (e, t) => Tn(io(e, t, E(t)))), oo = /*#__PURE__*/ y(3, (e, t, n) => po(e, t, () => L(n))), so = /*#__PURE__*/ y(3, (e, t, n) => e._editable ? (e._root = t, e._size = n, e) : t === e._root ? e : qa(e._editable, e._edit, t, n)), co = (e) => new Ja(e, (e) => e), lo = (e) => e._size, uo = (e) => qa(!0, e._edit + 1, e._root, e._size), fo = (e) => (e._editable = !1, e), po = /*#__PURE__*/ y(3, (e, t, n) => mo(e, t, E(t), n)), mo = /*#__PURE__*/ y(4, (e, t, n, r) => {
	let i = { value: e._size };
	return x(e, so(e._root.modify(e._editable ? e._edit : NaN, 0, r, n, t, i), i.value));
}), ho = /*#__PURE__*/ y(2, (e, t) => po(e, t, I)), go = /*#__PURE__*/ y(2, (e, t) => vo(e, $a(), (e, n, r) => oo(e, r, t(n, r)))), _o = /*#__PURE__*/ y(2, (e, t) => vo(e, void 0, (e, n, r) => t(n, r))), vo = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = e._root;
	if (r._tag === "LeafNode") return Tn(r.value) ? n(t, r.value.value, r.key) : t;
	if (r._tag === "EmptyNode") return t;
	let i = [r.children], a;
	for (; a = i.pop();) for (let e = 0, r = a.length; e < r;) {
		let r = a[e++];
		r && !Na(r) && (r._tag === "LeafNode" ? Tn(r.value) && (t = n(t, r.value.value, r.key)) : i.push(r.children));
	}
	return t;
}), yo = "effect/HashSet", bo = /*#__PURE__*/ Symbol.for(yo), xo = {
	[bo]: bo,
	[Symbol.iterator]() {
		return co(this._keyMap);
	},
	[T]() {
		return k(this, D(E(this._keyMap))(E(yo)));
	},
	[A](e) {
		return Co(e) ? lo(this._keyMap) === lo(e._keyMap) && j(this._keyMap, e._keyMap) : !1;
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
}, So = (e) => {
	let t = Object.create(xo);
	return t._keyMap = e, t;
}, Co = (e) => C(e, bo), wo = /*#__PURE__*/ So(/*#__PURE__*/ $a()), To = () => wo, Eo = (e) => {
	let t = Ao(To());
	for (let n of e) No(t, n);
	return jo(t);
}, Do = (...e) => {
	let t = Ao(To());
	for (let n of e) No(t, n);
	return jo(t);
}, Oo = /*#__PURE__*/ y(2, (e, t) => ao(e._keyMap, t)), ko = (e) => lo(e._keyMap), Ao = (e) => So(uo(e._keyMap)), jo = (e) => (e._keyMap._editable = !1, e), Mo = /*#__PURE__*/ y(2, (e, t) => {
	let n = Ao(e);
	return t(n), jo(n);
}), No = /*#__PURE__*/ y(2, (e, t) => e._keyMap._editable ? (oo(t, !0)(e._keyMap), e) : So(oo(t, !0)(e._keyMap))), Po = /*#__PURE__*/ y(2, (e, t) => e._keyMap._editable ? (ho(t)(e._keyMap), e) : So(ho(t)(e._keyMap))), Fo = /*#__PURE__*/ y(2, (e, t) => Mo(e, (e) => {
	for (let n of t) Po(e, n);
})), Io = /*#__PURE__*/ y(2, (e, t) => Mo(To(), (n) => {
	Lo(e, (e) => No(n, e));
	for (let e of t) No(n, e);
})), Lo = /*#__PURE__*/ y(2, (e, t) => _o(e._keyMap, (e, n) => t(n))), Ro = /*#__PURE__*/ y(3, (e, t, n) => vo(e._keyMap, t, (e, t, r) => n(e, r))), zo = To, Bo = Eo, Vo = Do, Ho = Oo, Uo = ko, Wo = No, Go = Po, Ko = Fo, qo = Io, Jo = Ro, Yo = /*#__PURE__*/ Symbol.for("effect/MutableRef"), Xo = {
	[Yo]: Yo,
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
}, Zo = (e) => {
	let t = Object.create(Xo);
	return t.current = e, t;
}, Qo = (e) => e.current, $o = /*#__PURE__*/ y(2, (e, t) => (e.current = t, e)), es = "effect/FiberId", ts = /*#__PURE__*/ Symbol.for(es), ns = "None", rs = "Runtime", is = "Composite", as = /*#__PURE__*/ O(`${es}-${ns}`), os = class {
	[ts] = ts;
	_tag = ns;
	id = -1;
	startTimeMillis = -1;
	[T]() {
		return as;
	}
	[A](e) {
		return ls(e) && e._tag === ns;
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
}, ss = class {
	id;
	startTimeMillis;
	[ts] = ts;
	_tag = rs;
	constructor(e, t) {
		this.id = e, this.startTimeMillis = t;
	}
	[T]() {
		return k(this, O(`${es}-${this._tag}-${this.id}-${this.startTimeMillis}`));
	}
	[A](e) {
		return ls(e) && e._tag === rs && this.id === e.id && this.startTimeMillis === e.startTimeMillis;
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
}, cs = /*#__PURE__*/ new os(), ls = (e) => C(e, ts), us = (e) => {
	switch (e._tag) {
		case ns: return zo();
		case rs: return Vo(e.id);
		case is: return x(us(e.left), qo(us(e.right)));
	}
}, ds = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => Zo(0)), fs = (e) => Array.from(us(e)).map((e) => `#${e}`).join(","), ps = () => {
	let e = Qo(ds);
	return x(ds, $o(e + 1)), new ss(e, Date.now());
}, ms = cs, hs = us, gs = fs, _s = ps, vs = $a, ys = eo, bs = no, xs = ro, Ss = oo, Cs = co, ws = po, Ts = go, Es = vo, Ds = /*#__PURE__*/ Symbol.for("effect/List"), Os = (e) => R(e), ks = /*#__PURE__*/ ((e) => De(vr(e), Os))(j), As = {
	[Ds]: Ds,
	_tag: "Cons",
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Cons",
			values: Os(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	[A](e) {
		return Ps(e) && this._tag === e._tag && ks(this, e);
	},
	[T]() {
		return k(this, ut(Os(this)));
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
}, js = (e, t) => {
	let n = Object.create(As);
	return n.head = e, n.tail = t, n;
}, Ms = /*#__PURE__*/ O("Nil"), Ns = /*#__PURE__*/ Object.create({
	[Ds]: Ds,
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
		return Ms;
	},
	[A](e) {
		return Ps(e) && this._tag === e._tag;
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
}), Ps = (e) => C(e, Ds), Fs = (e) => e._tag === "Nil", Is = (e) => e._tag === "Cons", Ls = () => Ns, Rs = (e, t) => js(e, t), zs = Ls, Bs = (e) => js(e, Ns), Vs = /*#__PURE__*/ y(2, (e, t) => Us(t, e)), Hs = /*#__PURE__*/ y(2, (e, t) => Rs(t, e)), Us = /*#__PURE__*/ y(2, (e, t) => {
	if (Fs(e)) return t;
	if (Fs(t)) return e;
	{
		let n = js(t.head, e), r = n, i = t.tail;
		for (; !Fs(i);) {
			let t = js(i.head, e);
			r.tail = t, r = t, i = i.tail;
		}
		return n;
	}
}), Ws = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = t, i = e;
	for (; !Fs(i);) r = n(r, i.head), i = i.tail;
	return r;
}), Gs = (e) => {
	let t = zs(), n = e;
	for (; !Fs(n);) t = Hs(t, n.head), n = n.tail;
	return t;
};
Array.prototype;
var Ks = /*#__PURE__*/ function() {
	function e(e) {
		e && Object.assign(this, e);
	}
	return e.prototype = Gt, e;
}(), qs = /*#__PURE__*/ Symbol.for("effect/DifferContextPatch");
function Js(e) {
	return e;
}
var Ys = {
	...Ks.prototype,
	[qs]: {
		_Value: Js,
		_Patch: Js
	}
}, Xs = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(Ys), { _tag: "Empty" })), Zs = () => Xs, Qs = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ys), { _tag: "AndThen" }), $s = (e, t) => {
	let n = Object.create(Qs);
	return n.first = e, n.second = t, n;
}, ec = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ys), { _tag: "AddService" }), tc = (e, t) => {
	let n = Object.create(ec);
	return n.key = e, n.service = t, n;
}, nc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ys), { _tag: "RemoveService" }), rc = (e) => {
	let t = Object.create(nc);
	return t.key = e, t;
}, ic = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ys), { _tag: "UpdateService" }), ac = (e, t) => {
	let n = Object.create(ic);
	return n.key = e, n.update = t, n;
}, oc = (e, t) => {
	let n = new Map(e.unsafeMap), r = Zs();
	for (let [e, i] of t.unsafeMap.entries()) if (n.has(e)) {
		let t = n.get(e);
		n.delete(e), j(t, i) || (r = sc(ac(e, () => i))(r));
	} else n.delete(e), r = sc(tc(e, i))(r);
	for (let [e] of n.entries()) r = sc(rc(e))(r);
	return r;
}, sc = /*#__PURE__*/ y(2, (e, t) => $s(e, t)), cc = /*#__PURE__*/ y(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = !1, r = yi(e), i = new Map(t.unsafeMap);
	for (; Ni(r);) {
		let e = Ii(r), t = Li(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AddService":
				i.set(e.key, e.service), r = t;
				break;
			case "AndThen":
				r = ki(ki(t, e.second), e.first);
				break;
			case "RemoveService":
				i.delete(e.key), r = t;
				break;
			case "UpdateService": i.set(e.key, e.update(i.get(e.key))), n = !0, r = t;
		}
	}
	if (!n) return Pr(i);
	let a = /* @__PURE__ */ new Map();
	for (let [e] of t.unsafeMap) i.has(e) && (a.set(e, i.get(e)), i.delete(e));
	for (let [e, t] of i) a.set(e, t);
	return Pr(a);
}), lc = /*#__PURE__*/ Symbol.for("effect/DifferHashSetPatch");
function uc(e) {
	return e;
}
var dc = {
	...Ks.prototype,
	[lc]: {
		_Value: uc,
		_Key: uc,
		_Patch: uc
	}
}, fc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(dc), { _tag: "Empty" })), pc = () => fc, mc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(dc), { _tag: "AndThen" }), hc = (e, t) => {
	let n = Object.create(mc);
	return n.first = e, n.second = t, n;
}, gc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(dc), { _tag: "Add" }), _c = (e) => {
	let t = Object.create(gc);
	return t.value = e, t;
}, vc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(dc), { _tag: "Remove" }), yc = (e) => {
	let t = Object.create(vc);
	return t.value = e, t;
}, bc = (e, t) => {
	let [n, r] = Jo([e, pc()], ([e, t], n) => Ho(n)(e) ? [Go(n)(e), t] : [e, xc(_c(n))(t)])(t);
	return Jo(r, (e, t) => xc(yc(t))(e))(n);
}, xc = /*#__PURE__*/ y(2, (e, t) => hc(e, t)), Sc = /*#__PURE__*/ y(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = t, r = yi(e);
	for (; Ni(r);) {
		let e = Ii(r), t = Li(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AndThen":
				r = ki(e.first)(ki(e.second)(t));
				break;
			case "Add":
				n = Wo(e.value)(n), r = t;
				break;
			case "Remove": n = Go(e.value)(n), r = t;
		}
	}
	return n;
}), Cc = /*#__PURE__*/ Symbol.for("effect/DifferReadonlyArrayPatch");
function wc(e) {
	return e;
}
var Tc = {
	...Ks.prototype,
	[Cc]: {
		_Value: wc,
		_Patch: wc
	}
}, Ec = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(Tc), { _tag: "Empty" })), Dc = () => Ec, Oc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Tc), { _tag: "AndThen" }), kc = (e, t) => {
	let n = Object.create(Oc);
	return n.first = e, n.second = t, n;
}, Ac = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Tc), { _tag: "Append" }), jc = (e) => {
	let t = Object.create(Ac);
	return t.values = e, t;
}, Mc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Tc), { _tag: "Slice" }), Nc = (e, t) => {
	let n = Object.create(Mc);
	return n.from = e, n.until = t, n;
}, Pc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Tc), { _tag: "Update" }), Fc = (e, t) => {
	let n = Object.create(Pc);
	return n.index = e, n.patch = t, n;
}, Ic = (e) => {
	let t = 0, n = Dc();
	for (; t < e.oldValue.length && t < e.newValue.length;) {
		let r = e.oldValue[t], i = e.newValue[t], a = e.differ.diff(r, i);
		j(a, e.differ.empty) || (n = Lc(n, Fc(t, a))), t += 1;
	}
	return t < e.oldValue.length && (n = Lc(n, Nc(0, t))), t < e.newValue.length && (n = Lc(n, jc(tr(t)(e.newValue)))), n;
}, Lc = /*#__PURE__*/ y(2, (e, t) => kc(e, t)), Rc = /*#__PURE__*/ y(3, (e, t, n) => {
	if (e._tag === "Empty") return t;
	let r = t.slice(), i = pr(e);
	for (; Hn(i);) {
		let e = Yn(i), t = Qn(i);
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
}), zc = {
	[/* @__PURE__ */ Symbol.for("effect/Differ")]: {
		_P: b,
		_V: b
	},
	pipe() {
		return F(this, arguments);
	}
}, Bc = (e) => {
	let t = Object.create(zc);
	return t.empty = e.empty, t.diff = e.diff, t.combine = e.combine, t.patch = e.patch, t;
}, Vc = () => Bc({
	empty: Zs(),
	combine: (e, t) => sc(t)(e),
	diff: (e, t) => oc(e, t),
	patch: (e, t) => cc(t)(e)
}), Hc = () => Bc({
	empty: pc(),
	combine: (e, t) => xc(t)(e),
	diff: (e, t) => bc(e, t),
	patch: (e, t) => Sc(t)(e)
}), Uc = (e) => Bc({
	empty: Dc(),
	combine: (e, t) => Lc(e, t),
	diff: (t, n) => Ic({
		oldValue: t,
		newValue: n,
		differ: e
	}),
	patch: (t, n) => Rc(t, n, e)
}), Wc = () => Gc((e, t) => t), Gc = (e) => Bc({
	empty: b,
	combine: (e, t) => e === b ? t : t === b ? e : (n) => t(e(n)),
	diff: (e, t) => j(e, t) ? b : xe(t),
	patch: (t, n) => e(n, t(n))
}), Kc = 255, qc = 8, Jc = (e) => e & Kc, Yc = (e) => e >> qc & Kc, Xc = (e, t) => (e & Kc) + ((t & e & Kc) << qc), Zc = /*#__PURE__*/ Xc(0, 0), Qc = (e) => Xc(e, e), $c = (e) => Xc(e, 0), el = /*#__PURE__*/ y(2, (e, t) => Xc(Jc(e) & ~t, Yc(e))), tl = /*#__PURE__*/ y(2, (e, t) => e | t), nl = (e) => ~e >>> 0 & Kc, rl = (e) => cl(e, 32), il = /*#__PURE__*/ y(2, (e, t) => e & ~t), al = /*#__PURE__*/ y(2, (e, t) => e | t), ol = (e) => sl(e) && !fl(e), sl = (e) => cl(e, 1), cl = /*#__PURE__*/ y(2, (e, t) => (e & t) !== 0), ll = (...e) => e.reduce((e, t) => e | t, 0), ul = /*#__PURE__*/ ll(0), dl = (e) => cl(e, 4), fl = (e) => cl(e, 16), pl = /*#__PURE__*/ y(2, (e, t) => Xc(e ^ t, t)), ml = /*#__PURE__*/ y(2, (e, t) => e & (nl(Jc(t)) | Yc(t)) | Jc(t) & Yc(t)), hl = /*#__PURE__*/ Bc({
	empty: Zc,
	diff: (e, t) => pl(e, t),
	combine: (e, t) => tl(t)(e),
	patch: (e, t) => ml(t, e)
}), gl = Qc, _l = $c, vl = el, yl = (e, t) => ({
	_tag: "Par",
	left: e,
	right: t
}), bl = (e, t) => ({
	_tag: "Seq",
	left: e,
	right: t
}), xl = (e) => {
	let t = Bs(e), n = zs();
	for (;;) {
		let [e, r] = Ws(t, [Dl(), zs()], ([e, t], n) => {
			let [r, i] = Sl(n);
			return [kl(e, r), Vs(t, i)];
		});
		if (n = Cl(n, e), Fs(r)) return Gs(n);
		t = r;
	}
	throw Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, Sl = (e) => {
	let t = e, n = Dl(), r = zs(), i = zs();
	for (;;) switch (t._tag) {
		case "Empty":
			if (Fs(r)) return [n, i];
			t = r.head, r = r.tail;
			break;
		case "Par":
			r = Rs(t.right, r), t = t.left;
			break;
		case "Seq": {
			let e = t.left, n = t.right;
			switch (e._tag) {
				case "Empty":
					t = n;
					break;
				case "Par": {
					let r = e.left, i = e.right;
					t = yl(bl(r, n), bl(i, n));
					break;
				}
				case "Seq": {
					let r = e.left, i = e.right;
					t = bl(r, bl(i, n));
					break;
				}
				case "Single": t = e, i = Rs(n, i);
			}
			break;
		}
		case "Single":
			if (n = Ol(n, t), Fs(r)) return [n, i];
			t = r.head, r = r.tail;
	}
	throw Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, Cl = (e, t) => {
	if (Fs(e)) return Bs(Ml(t));
	if (Al(t)) return e;
	let n = Rl(e.head), r = jl(t);
	return n.length === 1 && r.length === 1 && j(n[0], r[0]) ? Rs(Ll(e.head, Ml(t)), e.tail) : Rs(Ml(t), e);
}, wl = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockParallel"), Tl = {
/* c8 ignore next */
_R: (e) => e }, El = class {
	map;
	[wl] = Tl;
	constructor(e) {
		this.map = e;
	}
}, Dl = () => new El(vs()), Ol = (e, t) => new El(ws(e.map, t.dataSource, (e) => On(jn(e, Oi(t.blockedRequest)), () => yi(t.blockedRequest)))), kl = (e, t) => new El(Es(e.map, t.map, (e, t, n) => Ss(e, n, En(xs(e, n), {
	onNone: () => t,
	onSome: (e) => ji(t, e)
})))), Al = (e) => bs(e.map), jl = (e) => Array.from(Cs(e.map)), Ml = (e) => Il(Ts(e.map, (e) => yi(e))), Nl = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockSequential"), Pl = {
/* c8 ignore next */
_R: (e) => e }, Fl = class {
	map;
	[Nl] = Pl;
	constructor(e) {
		this.map = e;
	}
}, Il = (e) => new Fl(e), Ll = (e, t) => new Fl(Es(t.map, e.map, (e, t, n) => Ss(e, n, En(xs(e, n), {
	onNone: () => _i(),
	onSome: (e) => ji(e, t)
})))), Rl = (e) => Array.from(Cs(e.map)), zl = (e) => Array.from(e.map), Bl = "Empty", Vl = "Fail", Hl = "Interrupt", Ul = "Parallel", Wl = "Sequential", Gl = "effect/Cause", Kl = /*#__PURE__*/ Symbol.for(Gl), ql = {
/* c8 ignore next */
_E: (e) => e }, Jl = {
	[Kl]: ql,
	[T]() {
		return x(E(Gl), D(E(hu(this))), k(this));
	},
	[A](e) {
		return tu(e) && mu(this, e);
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
		return Tu(this);
	},
	[M]() {
		return this.toJSON();
	}
}, Yl = /*#__PURE__*/ (() => {
	let e = /*#__PURE__*/ Object.create(Jl);
	return e._tag = Bl, e;
})(), Xl = (e) => {
	let t = Object.create(Jl);
	return t._tag = Vl, t.error = e, t;
}, Zl = (e) => {
	let t = Object.create(Jl);
	return t._tag = "Die", t.defect = e, t;
}, Ql = (e) => {
	let t = Object.create(Jl);
	return t._tag = Hl, t.fiberId = e, t;
}, $l = (e, t) => {
	let n = Object.create(Jl);
	return n._tag = Ul, n.left = e, n.right = t, n;
}, eu = (e, t) => {
	let n = Object.create(Jl);
	return n._tag = Wl, n.left = e, n.right = t, n;
}, tu = (e) => C(e, Kl), nu = (e) => e._tag === Bl, ru = (e) => e._tag === "Empty" || Cu(e, !0, (e, t) => {
	switch (t._tag) {
		case Bl: return L(e);
		case "Die":
		case Vl:
		case Hl: return L(!1);
		default: return I();
	}
}), iu = (e) => Tn(du(e)), au = (e) => wu(void 0, yu)(e), ou = (e) => Ci(Cu(e, _i(), (e, t) => t._tag === "Fail" ? L(x(e, ki(t.error))) : I())), su = (e) => Ci(Cu(e, _i(), (e, t) => t._tag === "Die" ? L(x(e, ki(t.defect))) : I())), cu = (e) => Cu(e, zo(), (e, t) => t._tag === "Interrupt" ? L(x(e, Wo(t.fiberId))) : I()), lu = (e) => _u(e, (e) => e._tag === "Fail" ? L(e.error) : I()), uu = (e) => {
	let t = lu(e);
	switch (t._tag) {
		case "None": return mn(e);
		case "Some": return hn(t.value);
	}
}, du = (e) => _u(e, (e) => e._tag === "Interrupt" ? L(e.fiberId) : I()), fu = (e) => Su(e, {
	onEmpty: Yl,
	onFail: () => Yl,
	onDie: Zl,
	onInterrupt: Ql,
	onSequential: eu,
	onParallel: $l
}), pu = (e) => Su(e, {
	onEmpty: Yl,
	onFail: Zl,
	onDie: Zl,
	onInterrupt: Ql,
	onSequential: eu,
	onParallel: $l
}), mu = (e, t) => {
	let n = yi(e), r = yi(t);
	for (; Ni(n) && Ni(r);) {
		let [e, t] = x(Ii(n), Cu([zo(), _i()], ([e, t], n) => {
			let [r, i] = vu(n);
			return L([x(e, qo(r)), x(t, ji(i))]);
		})), [i, a] = x(Ii(r), Cu([zo(), _i()], ([e, t], n) => {
			let [r, i] = vu(n);
			return L([x(e, qo(r)), x(t, ji(i))]);
		}));
		if (!j(e, i)) return !1;
		n = t, r = a;
	}
	return !0;
}, hu = (e) => gu(yi(e), _i()), gu = (e, t) => {
	for (;;) {
		let [n, r] = x(e, gr([zo(), _i()], ([e, t], n) => {
			let [r, i] = vu(n);
			return [x(e, qo(r)), x(t, ji(i))];
		})), i = Uo(n) > 0 ? x(t, ki(n)) : t;
		if (Mi(r)) return Ci(i);
		e = r, t = i;
	}
	throw Error(Ve("Cause.flattenCauseLoop"));
}, _u = /*#__PURE__*/ y(2, (e, t) => {
	let n = [e];
	for (; n.length > 0;) {
		let e = n.pop(), r = t(e);
		switch (r._tag) {
			case "None":
				switch (e._tag) {
					case Wl:
					case Ul: n.push(e.right), n.push(e.left);
				}
				break;
			case "Some": return r;
		}
	}
	return I();
}), vu = (e) => {
	let t = e, n = [], r = zo(), i = _i();
	for (; t !== void 0;) switch (t._tag) {
		case Bl:
			if (n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Vl:
			if (r = Wo(r, vi(t._tag, t.error)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case "Die":
			if (r = Wo(r, vi(t._tag, t.defect)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Hl:
			if (r = Wo(r, vi(t._tag, t.fiberId)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Wl:
			switch (t.left._tag) {
				case Bl:
					t = t.right;
					break;
				case Wl:
					t = eu(t.left.left, eu(t.left.right, t.right));
					break;
				case Ul:
					t = $l(eu(t.left.left, t.right), eu(t.left.right, t.right));
					break;
				default: i = ki(i, t.right), t = t.left;
			}
			break;
		case Ul: n.push(t.right), t = t.left;
	}
	throw Error(Ve("Cause.evaluateCauseLoop"));
}, yu = {
	emptyCase: Se,
	failCase: Ce,
	dieCase: Ce,
	interruptCase: Se,
	sequentialCase: (e, t, n) => t && n,
	parallelCase: (e, t, n) => t && n
}, bu = "SequentialCase", xu = "ParallelCase", Su = /*#__PURE__*/ y(2, (e, { onDie: t, onEmpty: n, onFail: r, onInterrupt: i, onParallel: a, onSequential: o }) => wu(e, void 0, {
	emptyCase: () => n,
	failCase: (e, t) => r(t),
	dieCase: (e, n) => t(n),
	interruptCase: (e, t) => i(t),
	sequentialCase: (e, t, n) => o(t, n),
	parallelCase: (e, t, n) => a(t, n)
})), Cu = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = t, i = e, a = [];
	for (; i !== void 0;) {
		let e = n(r, i);
		switch (r = Tn(e) ? e.value : r, i._tag) {
			case Wl:
				a.push(i.right), i = i.left;
				break;
			case Ul:
				a.push(i.right), i = i.left;
				break;
			default: i = void 0;
		}
		i === void 0 && a.length > 0 && (i = a.pop());
	}
	return r;
}), wu = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._tag) {
			case Bl:
				i.push(mn(n.emptyCase(t)));
				break;
			case Vl:
				i.push(mn(n.failCase(t, e.error)));
				break;
			case "Die":
				i.push(mn(n.dieCase(t, e.defect)));
				break;
			case Hl:
				i.push(mn(n.interruptCase(t, e.fiberId)));
				break;
			case Wl:
				r.push(e.right), r.push(e.left), i.push(hn({ _tag: bu }));
				break;
			case Ul: r.push(e.right), r.push(e.left), i.push(hn({ _tag: xu }));
		}
	}
	let a = [];
	for (; i.length > 0;) {
		let e = i.pop();
		switch (e._tag) {
			case "Left":
				switch (e.left._tag) {
					case bu: {
						let e = a.pop(), r = a.pop(), i = n.sequentialCase(t, e, r);
						a.push(i);
						break;
					}
					case xu: {
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
}), Tu = (e, t) => au(e) ? "All fibers interrupted without errors." : Nu(e).map(function(e) {
	return t?.renderErrorCause !== !0 || e.cause === void 0 ? e.stack : `${e.stack} {\n${Eu(e.cause, "  ")}\n}`;
}).join("\n"), Eu = (e, t) => {
	let n = e.stack.split("\n"), r = `${t}[cause]: ${n[0]}`;
	for (let e = 1, i = n.length; e < i; e++) r += `\n${t}${n[e]}`;
	return e.cause && (r += ` {\n${Eu(e.cause, `${t}  `)}\n${t}}`), r;
}, Du = (e) => {
	let t = typeof e == "object" && !!e, n = Error.stackTraceLimit;
	Error.stackTraceLimit = 1;
	let r = Error(Ou(e), t && "cause" in e && e.cause !== void 0 ? { cause: Du(e.cause) } : void 0);
	return Error.stackTraceLimit = n, r.message === "" && (r.message = "An error has occurred"), Error.stackTraceLimit = n, r.name = e instanceof Error ? e.name : "Error", t && (Mu in e && (r.span = e[Mu]), Object.keys(e).forEach((t) => {
		t in r || (r[t] = e[t]);
	})), r.stack = ju(`${r.name}: ${r.message}`, e instanceof Error && e.stack ? e.stack : "", r.span), r;
}, Ou = (e) => {
	if (typeof e == "string") return e;
	if (typeof e == "object" && e && e instanceof Error) return e.message;
	try {
		if (C(e, "toString") && Pe(e.toString) && e.toString !== Object.prototype.toString && e.toString !== globalThis.Array.prototype.toString) return e.toString();
	} catch {}
	return ht(e);
}, ku = /\((.*)\)/g, Au = /*#__PURE__*/ S("effect/Tracer/spanToTrace", () => /* @__PURE__ */ new WeakMap()), ju = (e, t, n) => {
	let r = [e], i = t.startsWith(e) ? t.slice(e.length).split("\n") : t.split("\n");
	for (let e = 1; e < i.length; e++) if (i[e].includes(" at new BaseEffectError") || i[e].includes(" at new YieldableError")) e++;
	else {
		if (i[e].includes("Generator.next") || i[e].includes("effect_internal_function")) break;
		r.push(i[e].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
	}
	if (n) {
		let e = n, t = 0;
		for (; e && e._tag === "Span" && t < 10;) {
			let n = Au.get(e);
			if (typeof n == "function") {
				let t = n();
				if (typeof t == "string") {
					let n = t.matchAll(ku), i = !1;
					for (let [, t] of n) i = !0, r.push(`    at ${e.name} (${t})`);
					i || r.push(`    at ${e.name} (${t.replace(/^at /, "")})`);
				} else r.push(`    at ${e.name}`);
			} else r.push(`    at ${e.name}`);
			e = An(e.parent), t++;
		}
	}
	return r.join("\n");
}, Mu = /*#__PURE__*/ Symbol.for("effect/SpanAnnotation"), Nu = (e) => wu(e, void 0, {
	emptyCase: () => [],
	dieCase: (e, t) => [Du(t)],
	failCase: (e, t) => [Du(t)],
	interruptCase: () => [],
	parallelCase: (e, t, n) => [...t, ...n],
	sequentialCase: (e, t, n) => [...t, ...n]
}), Pu = "Pending", Fu = "Done", Iu = /*#__PURE__*/ Symbol.for("effect/Deferred"), Lu = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Ru = (e) => ({
	_tag: Pu,
	joiners: e
}), zu = (e) => ({
	_tag: Fu,
	effect: e
}), Bu = class e {
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
}, Vu = (e, t) => {
	let n = new B("Blocked");
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}, Hu = (e) => {
	let t = new B("RunBlocked");
	return t.effect_instruction_i0 = e, t;
}, Uu = /*#__PURE__*/ Symbol.for("effect/Effect"), Wu = class {
	patch;
	op;
	_op = Pt;
	constructor(e, t) {
		this.patch = e, this.op = t;
	}
}, B = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Uu] = Vt;
	constructor(e) {
		this._op = e;
	}
	[A](e) {
		return this === e;
	}
	[T]() {
		return k(this, it(this));
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
		return new Bu(new $e(this));
	}
}, Gu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Uu] = Vt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[A](e) {
		return Wf(e) && e._op === "Failure" && j(this.effect_instruction_i0, e.effect_instruction_i0);
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
		return new Bu(new $e(this));
	}
}, Ku = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Uu] = Vt;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[A](e) {
		return Wf(e) && e._op === "Success" && j(this.effect_instruction_i0, e.effect_instruction_i0);
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
		return new Bu(new $e(this));
	}
}, qu = (e) => C(e, Uu), V = (e) => {
	let t = new B(Mt);
	return t.effect_instruction_i0 = e, t;
}, Ju = /*#__PURE__*/ y(3, (e, t, n) => Dd((r) => W(e, (e) => W(sd(q(() => r(t(e)))), (t) => q(() => n(e, t)).pipe(hd({
	onFailure: (e) => {
		switch (t._tag) {
			case Ct: return U(eu(t.effect_instruction_i0, e));
			case Dt: return U(e);
		}
	},
	onSuccess: () => t
})))))), Yu = /*#__PURE__*/ y(2, (e, t) => W(e, () => K(t))), Xu = (e) => Yu(e, void 0), Zu = function() {
	let e = new B(St);
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
		default: throw Error(Ve("you're not supposed to end up here"));
	}
	return e;
}, Qu = (e, t = ms) => {
	let n = new B(xt), r;
	return n.effect_instruction_i0 = (t) => {
		r = e(t);
	}, n.effect_instruction_i1 = t, Cd(n, (e) => qu(r) ? r : Y);
}, $u = (e, t = ms) => q(() => Qu(e, t)), ed = (e, t = ms) => Zu(e, function() {
	let e, n;
	function r(t) {
		e ? e(t) : n === void 0 && (n = t);
	}
	let i = new B(xt);
	i.effect_instruction_i0 = (t) => {
		e = t, n && t(n);
	}, i.effect_instruction_i1 = t;
	let a, o;
	return this.effect_instruction_i0.length === 1 ? a = w(() => this.effect_instruction_i0(r)) : (o = new AbortController(), a = w(() => this.effect_instruction_i0(r, o.signal))), a || o ? Cd(i, (e) => (o && o.abort(), a ?? Y)) : i;
}), td = /*#__PURE__*/ y(2, (e, t) => gd(e, {
	onFailure: t,
	onSuccess: K
})), nd = /*#__PURE__*/ Symbol.for("effect/OriginalAnnotation"), rd = (e, t) => Tn(t) ? new Proxy(e, {
	has(e, t) {
		return t === Mu || t === nd || t in e;
	},
	get(n, r) {
		return r === Mu ? t.value : r === nd ? e : n[r];
	}
}) : e, id = (e) => Ie(e) && !(Mu in e) ? V((t) => U(Zl(rd(e, bp(t))))) : U(Zl(e)), ad = (e) => ld(() => Zl(new If(e))), od = (e) => gd(e, {
	onFailure: (e) => K(hn(e)),
	onSuccess: (e) => K(mn(e))
}), sd = (e) => md(e, {
	onFailure: X,
	onSuccess: Z
}), H = (e) => Ie(e) && !(Mu in e) ? V((t) => U(Xl(rd(e, bp(t))))) : U(Xl(e)), cd = (e) => W(J(e), H), U = (e) => {
	let t = new Gu(Ct);
	return t.effect_instruction_i0 = e, t;
}, ld = (e) => W(J(e), U), ud = /*#__PURE__*/ V((e) => K(e.id())), dd = (e) => V((t) => e(t.id())), W = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(Tt);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}), fd = (e) => {
	let t = new B("OnStep");
	return t.effect_instruction_i0 = e, t;
}, pd = (e) => W(e, b), md = /*#__PURE__*/ y(2, (e, t) => hd(e, {
	onFailure: (e) => K(t.onFailure(e)),
	onSuccess: (e) => K(t.onSuccess(e))
})), hd = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(Et);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t.onFailure, n.effect_instruction_i2 = t.onSuccess, n;
}), gd = /*#__PURE__*/ y(2, (e, t) => hd(e, {
	onFailure: (e) => {
		if (su(e).length > 0) return U(pu(e));
		let n = ou(e);
		return n.length > 0 ? t.onFailure(Fi(n)) : U(e);
	},
	onSuccess: t.onSuccess
})), _d = /*#__PURE__*/ y(2, (e, t) => q(() => {
	let n = R(e), r = Fn(n.length), i = 0;
	return Yu(Ad({
		while: () => i < n.length,
		body: () => t(n[i], i),
		step: (e) => {
			r[i++] = e;
		}
	}), r);
})), vd = /*#__PURE__*/ y(2, (e, t) => q(() => {
	let n = R(e), r = 0;
	return Ad({
		while: () => r < n.length,
		body: () => t(n[r], r),
		step: () => {
			r++;
		}
	});
})), yd = (e) => {
	let t = new B(kt);
	return t.effect_instruction_i0 = gl(1), t.effect_instruction_i1 = () => e, t;
}, G = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => J(() => t(e)))), bd = /*#__PURE__*/ y(2, (e, t) => gd(e, {
	onFailure: (e) => cd(() => t.onFailure(e)),
	onSuccess: (e) => J(() => t.onSuccess(e))
})), xd = /*#__PURE__*/ y(2, (e, t) => hd(e, {
	onFailure: (e) => {
		let n = uu(e);
		switch (n._tag) {
			case "Left": return cd(() => t(n.left));
			case "Right": return U(n.right);
		}
	},
	onSuccess: K
})), Sd = /*#__PURE__*/ y(2, (e, t) => Dd((n) => hd(n(e), {
	onFailure: (e) => {
		let n = X(e);
		return hd(t(n), {
			onFailure: (t) => X(eu(e, t)),
			onSuccess: () => n
		});
	},
	onSuccess: (e) => {
		let n = Z(e);
		return Rd(t(n), n);
	}
}))), Cd = /*#__PURE__*/ y(2, (e, t) => Sd(e, ep({
	onFailure: (e) => au(e) ? Xu(t(cu(e))) : Y,
	onSuccess: () => Y
}))), K = (e) => {
	let t = new Ku(Dt);
	return t.effect_instruction_i0 = e, t;
}, q = (e) => {
	let t = new B(St);
	return t.commit = e, t;
}, J = (e) => {
	let t = new B(Ot);
	return t.effect_instruction_i0 = e, t;
}, wd = /*#__PURE__*/ y((e) => e.length === 3 || e.length === 2 && !(Ie(e[1]) && "onlyEffect" in e[1]), (e, t) => W(e, (e) => {
	let n = typeof t == "function" ? t(e) : t;
	return qu(n) ? Yu(n, e) : Be(n) ? Qu((t) => {
		n.then((n) => t(K(e)), (e) => t(H(new Uf(e, "An unknown error occurred in Effect.tap"))));
	}) : K(e);
})), Td = (e) => V((t) => e(nf(Cf, L(x(t.getFiberRef(Cf), Dn(() => t.scope())))))), Ed = (e) => {
	let t = new B(kt);
	return t.effect_instruction_i0 = _l(1), t.effect_instruction_i1 = () => e, t;
}, Dd = (e) => Zu(e, function() {
	let e = new B(kt);
	return e.effect_instruction_i0 = _l(1), e.effect_instruction_i1 = (e) => sl(e) ? w(() => this.effect_instruction_i0(yd)) : w(() => this.effect_instruction_i0(Ed)), e;
}), Y = /*#__PURE__*/ K(void 0), Od = (e) => {
	let t = new B(kt);
	return t.effect_instruction_i0 = e, t.effect_instruction_i1 = void 0, t;
}, kd = /*#__PURE__*/ y(2, (e, t) => W(t, (t) => t ? x(e, G(L)) : K(I()))), Ad = (e) => {
	let t = new B(At);
	return t.effect_instruction_i0 = e.while, t.effect_instruction_i1 = e.body, t.effect_instruction_i2 = e.step, t;
}, jd = (e) => q(() => {
	let t = new B(jt);
	return t.effect_instruction_i0 = e(), t;
}), Md = function() {
	let e = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
	return jd(() => e(x));
}, Nd = (e, ...t) => Object.defineProperty(t.length === 0 ? function(...t) {
	return jd(() => e.apply(this, t));
} : function(...n) {
	let r = jd(() => e.apply(this, n));
	for (let e of t) r = e(r, ...n);
	return r;
}, "length", {
	value: e.length,
	configurable: !0
}), Pd = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(kt);
	return n.effect_instruction_i0 = t, n.effect_instruction_i1 = () => e, n;
}), Fd = (e) => {
	let t = new B(Nt);
	return e?.priority === void 0 ? t : _f(t, e.priority);
}, Id = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => G(t, (t) => [e, t]))), Ld = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => Yu(t, e))), Rd = /*#__PURE__*/ y(2, (e, t) => W(e, () => t)), zd = /*#__PURE__*/ y(3, (e, t, n) => W(e, (e) => G(t, (t) => n(e, t)))), Bd = (e) => W(ud, (t) => x(e, Vd(t))), Vd = /*#__PURE__*/ y(2, (e, t) => W(e.interruptAsFork(t), () => e.await)), Hd = {
	_tag: "All",
	syslog: 0,
	label: "ALL",
	ordinal: -(2 ** 53 - 1),
	pipe() {
		return F(this, arguments);
	}
}, Ud = {
	_tag: "Fatal",
	syslog: 2,
	label: "FATAL",
	ordinal: 5e4,
	pipe() {
		return F(this, arguments);
	}
}, Wd = {
	_tag: "Error",
	syslog: 3,
	label: "ERROR",
	ordinal: 4e4,
	pipe() {
		return F(this, arguments);
	}
}, Gd = {
	_tag: "Warning",
	syslog: 4,
	label: "WARN",
	ordinal: 3e4,
	pipe() {
		return F(this, arguments);
	}
}, Kd = {
	_tag: "Info",
	syslog: 6,
	label: "INFO",
	ordinal: 2e4,
	pipe() {
		return F(this, arguments);
	}
}, qd = {
	_tag: "Debug",
	syslog: 7,
	label: "DEBUG",
	ordinal: 1e4,
	pipe() {
		return F(this, arguments);
	}
}, Jd = {
	_tag: "Trace",
	syslog: 7,
	label: "TRACE",
	ordinal: 0,
	pipe() {
		return F(this, arguments);
	}
}, Yd = {
	_tag: "None",
	syslog: 7,
	label: "OFF",
	ordinal: 2 ** 53 - 1,
	pipe() {
		return F(this, arguments);
	}
}, Xd = /*#__PURE__*/ Symbol.for("effect/FiberRef"), Zd = {
/* c8 ignore next */
_A: (e) => e }, Qd = (e) => V((t) => Z(t.getFiberRef(e))), $d = /*#__PURE__*/ y(2, (e, t) => W(Qd(e), t)), ef = /*#__PURE__*/ y(2, (e, t) => tf(e, () => [void 0, t])), tf = /*#__PURE__*/ y(2, (e, t) => V((n) => {
	let [r, i] = t(n.getFiberRef(e));
	return n.setFiberRef(e, i), K(r);
})), nf = /*#__PURE__*/ y(3, (e, t, n) => Ju(Ld(Qd(t), ef(t, n)), () => e, (e) => ef(t, e))), rf = /*#__PURE__*/ y(3, (e, t, n) => $d(t, (r) => nf(e, t, n(r)))), af = (e, t) => lf(e, {
	differ: Wc(),
	fork: t?.fork ?? b,
	join: t?.join
}), of = (e) => {
	let t = Hc();
	return lf(e, {
		differ: t,
		fork: t.empty
	});
}, sf = (e) => {
	let t = Uc(Wc());
	return lf(e, {
		differ: t,
		fork: t.empty
	});
}, cf = (e) => {
	let t = Vc();
	return lf(e, {
		differ: t,
		fork: t.empty
	});
}, lf = (e, t) => ({
	...Kt,
	[Xd]: Zd,
	initial: e,
	commit() {
		return Qd(this);
	},
	diff: (e, n) => t.differ.diff(e, n),
	combine: (e, n) => t.differ.combine(e, n),
	patch: (e) => (n) => t.differ.patch(e, n),
	fork: t.fork,
	join: t.join ?? ((e, t) => t)
}), uf = (e) => lf(e, {
	differ: hl,
	fork: hl.empty
}), df = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentContext"), () => cf(ei())), ff = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => af(0)), pf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => af(2048)), mf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => af(vs())), hf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogLevel"), () => af(Kd)), gf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogSpan"), () => af(zs())), _f = /*#__PURE__*/ y(2, (e, t) => nf(e, ff, t)), vf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentConcurrency"), () => af("unbounded")), yf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestBatching"), () => af(!0)), bf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => af(L(qd))), xf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => af(L(Gd))), Sf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMetricLabels"), () => sf(fr())), Cf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => af(I(), {
	fork: () => I(),
	join: (e, t) => e
})), wf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => af(Yl, {
	fork: () => Yl,
	join: (e, t) => e
})), Tf = /*#__PURE__*/ Symbol.for("effect/Scope"), Ef = /*#__PURE__*/ Symbol.for("effect/CloseableScope"), Df = (e, t) => e.addFinalizer(() => Xu(t)), Of = (e, t) => e.addFinalizer(t), kf = (e, t) => e.close(t), Af = (e, t) => e.fork(t), jf = (e) => Mf(b)(e), Mf = /*#__PURE__*/ y(2, (e, t) => {
	let n = x(e, lu, jn(t));
	switch (n._tag) {
		case "None": return x(su(e), Pi, En({
			onNone: () => {
				let t = R(cu(e)).flatMap((e) => R(hs(e)).map((e) => `#${e}`));
				return new Rf(t ? `Interrupted by fibers: ${t.join(", ")}` : void 0);
			},
			onSome: b
		}));
		case "Some": return n.value;
	}
}), Nf = /*#__PURE__*/ function() {
	class e extends globalThis.Error {
		commit() {
			return H(this);
		}
		toJSON() {
			let e = { ...this };
			return this.message && (e.message = this.message), this.cause && (e.cause = this.cause), e;
		}
		[M]() {
			return this.toString === globalThis.Error.prototype.toString ? "Bun" in globalThis ? Tu(Xl(this), { renderErrorCause: !0 }) : this : this.stack ? `${this.toString()}\n${this.stack.split("\n").slice(1).join("\n")}` : this.toString();
		}
	}
	return Object.assign(e.prototype, qt), e;
}(), Pf = (e, t) => {
	class n extends Nf {
		_tag = t;
	}
	return Object.assign(n.prototype, e), n.prototype.name = t, n;
}, Ff = /*#__PURE__*/ Symbol.for("effect/Cause/errors/RuntimeException"), If = /*#__PURE__*/ Pf({ [Ff]: Ff }, "RuntimeException"), Lf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/InterruptedException"), Rf = /*#__PURE__*/ Pf({ [Lf]: Lf }, "InterruptedException"), zf = (e) => C(e, Lf), Bf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/NoSuchElement"), Vf = /*#__PURE__*/ Pf({ [Bf]: Bf }, "NoSuchElementException"), Hf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/UnknownException"), Uf = /*#__PURE__*/ function() {
	class e extends Nf {
		_tag = "UnknownException";
		error;
		constructor(e, t) {
			super(t ?? "An unknown error occurred", { cause: e }), this.error = e;
		}
	}
	return Object.assign(e.prototype, {
		[Hf]: Hf,
		name: "UnknownException"
	}), e;
}(), Wf = (e) => qu(e) && "_tag" in e && (e._tag === "Success" || e._tag === "Failure"), Gf = (e) => e._tag === "Failure", Kf = (e) => e._tag === "Success", qf = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._tag) {
		case Ct: return X(e.effect_instruction_i0);
		case Dt: return Z(t);
	}
}), Jf = (e) => qf(e, void 0), Yf = (e, t) => ip(e, t?.parallel ? $l : eu), Xf = (e) => X(Zl(e)), Zf = (e) => X(Xl(e)), X = (e) => {
	let t = new Gu(Ct);
	return t.effect_instruction_i0 = e, t;
}, Qf = (e) => X(Ql(e)), $f = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._tag) {
		case Ct: return X(e.effect_instruction_i0);
		case Dt: return Z(t(e.effect_instruction_i0));
	}
}), ep = /*#__PURE__*/ y(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case Ct: return t(e.effect_instruction_i0);
		case Dt: return n(e.effect_instruction_i0);
	}
}), tp = /*#__PURE__*/ y(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case Ct: return t(e.effect_instruction_i0);
		case Dt: return n(e.effect_instruction_i0);
	}
}), Z = (e) => {
	let t = new Ku(Dt);
	return t.effect_instruction_i0 = e, t;
}, np = /*#__PURE__*/ Z(void 0), rp = /*#__PURE__*/ y(3, (e, t, { onFailure: n, onSuccess: r }) => {
	switch (e._tag) {
		case Ct: switch (t._tag) {
			case Dt: return X(e.effect_instruction_i0);
			case Ct: return X(n(e.effect_instruction_i0, t.effect_instruction_i0));
		}
		case Dt: switch (t._tag) {
			case Dt: return Z(r(e.effect_instruction_i0, t.effect_instruction_i0));
			case Ct: return X(t.effect_instruction_i0);
		}
	}
}), ip = (e, t) => {
	let n = bi(e);
	return Ni(n) ? x(Li(n), gr(x(Ii(n), $f(yi)), (e, n) => x(e, rp(n, {
		onSuccess: (e, t) => x(e, ki(t)),
		onFailure: t
	}))), $f(Ci), $f((e) => Si(e)), L) : I();
}, ap = (e) => ({
	...Kt,
	[Iu]: Lu,
	state: Zo(Ru([])),
	commit() {
		return cp(this);
	},
	blockingOn: e
}), op = () => W(ud, (e) => sp(e)), sp = (e) => J(() => ap(e)), cp = (e) => $u((t) => {
	let n = Qo(e.state);
	switch (n._tag) {
		case Fu: return t(n.effect);
		case Pu: return n.joiners.push(t), pp(e, t);
	}
}, e.blockingOn), lp = /*#__PURE__*/ y(2, (e, t) => J(() => {
	let n = Qo(e.state);
	switch (n._tag) {
		case Fu: return !1;
		case Pu:
			$o(e.state, zu(t));
			for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
			return !0;
	}
})), up = /*#__PURE__*/ y(2, (e, t) => lp(e, U(t))), dp = /*#__PURE__*/ y(2, (e, t) => lp(e, K(t))), fp = (e, t) => {
	let n = Qo(e.state);
	if (n._tag === "Pending") {
		$o(e.state, zu(t));
		for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
	}
}, pp = (e, t) => J(() => {
	let n = Qo(e.state);
	if (n._tag === "Pending") {
		let e = n.joiners.indexOf(t);
		e >= 0 && n.joiners.splice(e, 1);
	}
}), mp = /*#__PURE__*/ V((e) => Z(e.currentContext)), hp = () => mp, gp = (e) => W(hp(), e), _p = /*#__PURE__*/ y(2, (e, t) => nf(df, t)(e)), vp = /*#__PURE__*/ y(2, (e, t) => rf(df, (e) => oi(e, t))(e)), yp = /*#__PURE__*/ y(2, (e, t) => gp((n) => _p(e, t(n)))), bp = (e) => {
	let t = e.currentSpan;
	return t !== void 0 && t._tag === "Span" ? L(t) : I();
}, xp = Gf, Sp = Kf, Cp = np, wp = /*#__PURE__*/ Symbol.for("effect/MutableHashMap"), Tp = {
	[wp]: wp,
	[Symbol.iterator]() {
		return new Ep(this);
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
}, Ep = class e {
	self;
	referentialIterator;
	bucketIterator;
	constructor(e) {
		this.self = e, this.referentialIterator = e.referential[Symbol.iterator]();
	}
	next() {
		if (this.bucketIterator !== void 0) return this.bucketIterator.next();
		let e = this.referentialIterator.next();
		return e.done ? (this.bucketIterator = new Dp(this.self.buckets.values()), this.next()) : e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, Dp = class {
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
}, Op = () => {
	let e = Object.create(Tp);
	return e.referential = /* @__PURE__ */ new Map(), e.buckets = /* @__PURE__ */ new Map(), e.bucketsSize = 0, e;
}, kp = /*#__PURE__*/ y(2, (e, t) => {
	if (ft(t) === !1) return e.referential.has(t) ? L(e.referential.get(t)) : I();
	let n = t[T](), r = e.buckets.get(n);
	return r === void 0 ? I() : Ap(e, r, t);
}), Ap = (e, t, n, r = !1) => {
	for (let i = 0, a = t.length; i < a; i++) if (n[A](t[i][0])) {
		let n = t[i][1];
		return r && (t.splice(i, 1), e.bucketsSize--), L(n);
	}
	return I();
}, jp = /*#__PURE__*/ y(2, (e, t) => Tn(kp(e, t))), Mp = /*#__PURE__*/ y(3, (e, t, n) => {
	if (ft(t) === !1) return e.referential.set(t, n), e;
	let r = t[T](), i = e.buckets.get(r);
	return i === void 0 ? (e.buckets.set(r, [[t, n]]), e.bucketsSize++, e) : (Np(e, i, t), i.push([t, n]), e.bucketsSize++, e);
}), Np = (e, t, n) => {
	for (let r = 0, i = t.length; r < i; r++) if (n[A](t[r][0])) {
		t.splice(r, 1), e.bucketsSize--;
		return;
	}
}, Pp = /*#__PURE__*/ Symbol.for("effect/Clock"), Fp = /*#__PURE__*/ Zr("effect/Clock"), Ip = 2 ** 31 - 1, Lp = { unsafeSchedule(e, t) {
	let n = la(t);
	if (n > Ip) return Ce;
	let r = !1, i = setTimeout(() => {
		r = !0, e();
	}, n);
	return () => (clearTimeout(i), !r);
} }, Rp = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || typeof performance.now != "function") return () => BigInt(Date.now()) * e;
	let t;
	return () => (t === void 0 && (t = BigInt(Date.now()) * e - BigInt(Math.round(performance.now() * 1e6))), t + BigInt(Math.round(performance.now() * 1e6)));
}(), zp = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return Rp;
	let t = /*#__PURE__*/ Rp() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}(), Bp = class {
	[Pp] = Pp;
	unsafeCurrentTimeMillis() {
		return Date.now();
	}
	unsafeCurrentTimeNanos() {
		return zp();
	}
	currentTimeMillis = /*#__PURE__*/ J(() => this.unsafeCurrentTimeMillis());
	currentTimeNanos = /*#__PURE__*/ J(() => this.unsafeCurrentTimeNanos());
	scheduler() {
		return K(Lp);
	}
	sleep(e) {
		return ed((t) => Xu(J(Lp.unsafeSchedule(() => t(Y), e))));
	}
}, Vp = () => new Bp(), Hp = "InvalidData", Up = "MissingData", Wp = "SourceUnavailable", Gp = "Unsupported", Kp = /*#__PURE__*/ Symbol.for("effect/ConfigError"), qp = {
	_tag: "ConfigError",
	[Kp]: Kp
}, Jp = (e, t) => {
	let n = Object.create(qp);
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
}, Yp = (e, t) => {
	let n = Object.create(qp);
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
}, Xp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(qp);
	return r._op = Hp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Invalid data at ${x(this.path, xr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Zp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(qp);
	return r._op = Up, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Missing data at ${x(this.path, xr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Qp = (e, t, n, r = { pathDelim: "." }) => {
	let i = Object.create(qp);
	return i._op = Wp, i.path = e, i.message = t, i.cause = n, Object.defineProperty(i, "toString", {
		enumerable: !1,
		value() {
			return `(Source unavailable at ${x(this.path, xr(r.pathDelim))}: "${this.message}")`;
		}
	}), i;
}, $p = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(qp);
	return r._op = Gp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Unsupported operation at ${x(this.path, xr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, em = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._op) {
		case "And": return Jp(em(e.left, t), em(e.right, t));
		case "Or": return Yp(em(e.left, t), em(e.right, t));
		case Hp: return Xp([...t, ...e.path], e.message);
		case Up: return Zp([...t, ...e.path], e.message);
		case Wp: return Qp([...t, ...e.path], e.message, e.cause);
		case Gp: return $p([...t, ...e.path], e.message);
	}
}), tm = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._op) {
			case "And":
				r.push(e.right), r.push(e.left), i.push(hn({ _op: "AndCase" }));
				break;
			case "Or":
				r.push(e.right), r.push(e.left), i.push(hn({ _op: "OrCase" }));
				break;
			case Hp:
				i.push(mn(n.invalidDataCase(t, e.path, e.message)));
				break;
			case Up:
				i.push(mn(n.missingDataCase(t, e.path, e.message)));
				break;
			case Wp:
				i.push(mn(n.sourceUnavailableCase(t, e.path, e.message, e.cause)));
				break;
			case Gp: i.push(mn(n.unsupportedCase(t, e.path, e.message)));
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
}), nm = { _tag: "Empty" }, rm = /*#__PURE__*/ y(2, (e, t) => {
	let n = Bs(t), r = e;
	for (; Is(n);) {
		let e = n.head;
		switch (e._tag) {
			case "Empty":
				n = n.tail;
				break;
			case "AndThen":
				n = Rs(e.first, Rs(e.second, n.tail));
				break;
			case "MapName":
				r = mr(r, e.f), n = n.tail;
				break;
			case "Nested":
				r = Rn(r, e.name), n = n.tail;
				break;
			case "Unnested": if (x(Jn(r), Nn(e.name))) r = Qn(r), n = n.tail;
			else return hn(Zp(r, `Expected ${e.name} to be in path in ConfigProvider#unnested`));
		}
	}
	return mn(r);
}), im = "Constant", am = "Fail", om = "Fallback", sm = "Described", cm = "Lazy", lm = "MapOrFail", um = "Nested", dm = "Primitive", fm = "Redacted", pm = "Sequence", mm = "HashMap", hm = "ZipWith", gm = (e, t) => [...e, ...t], _m = /*#__PURE__*/ Symbol.for("effect/ConfigProvider"), vm = /*#__PURE__*/ Zr("effect/ConfigProvider"), ym = /*#__PURE__*/ Symbol.for("effect/ConfigProviderFlat"), bm = (e) => ({
	[_m]: _m,
	pipe() {
		return F(this, arguments);
	},
	...e
}), xm = (e) => ({
	[ym]: ym,
	patch: e.patch,
	load: (t, n, r = !0) => e.load(t, n, r),
	enumerateChildren: e.enumerateChildren
}), Sm = (e) => bm({
	load: (t) => W(Om(e, fr(), t, !1), (e) => En(Jn(e), {
		onNone: () => H(Zp(fr(), `Expected a single value having structure: ${t}`)),
		onSome: K
	})),
	flattened: e
}), Cm = (e) => {
	let { pathDelim: t, seqDelim: n } = Object.assign({}, {
		pathDelim: "_",
		seqDelim: ","
	}, e), r = (e) => x(e, xr(t)), i = (e) => e.split(t), a = () => typeof process < "u" && "env" in process && typeof process.env == "object" ? process.env : {};
	return Sm(xm({
		load: (e, t, i = !0) => {
			let o = r(e), s = a();
			return x(o in s ? L(s[o]) : I(), xd(() => Zp(e, `Expected ${o} to exist in the process context`)), W((r) => jm(r, e, t, n, i)));
		},
		enumerateChildren: (e) => J(() => {
			let t = a();
			return Bo(Object.keys(t).map((e) => i(e.toUpperCase())).filter((t) => {
				for (let n = 0; n < e.length; n++) {
					let r = x(e, qn(n)), i = t[n];
					if (i === void 0 || r !== i) return !1;
				}
				return !0;
			}).flatMap((t) => t.slice(e.length, e.length + 1)));
		}),
		patch: nm
	}));
}, wm = (e, t, n, r) => {
	let i = _r(n.length, (t) => t >= r.length ? I() : L([e(t), t + 1])), a = _r(r.length, (e) => e >= n.length ? I() : L([t(e), e + 1]));
	return [gm(n, i), gm(r, a)];
}, Tm = (e, t) => {
	let n = t;
	if (n._tag === "Nested") {
		let t = e.slice();
		for (; n._tag === "Nested";) t.push(n.name), n = n.config;
		return t;
	}
	return e;
}, Em = {
	andCase: (e, t, n) => Jp(t, n),
	orCase: (e, t, n) => Yp(t, n),
	invalidDataCase: (e, t) => Xp(t, "<redacted>"),
	missingDataCase: (e, t) => Zp(t, "<redacted>"),
	sourceUnavailableCase: (e, t, n, r) => Qp(t, "<redacted>", r),
	unsupportedCase: (e, t) => $p(t, "<redacted>")
}, Dm = (e) => tm(e, void 0, Em), Om = (e, t, n, r) => {
	let i = n;
	switch (i._tag) {
		case im: return K(pr(i.value));
		case sm: return q(() => Om(e, t, i.config, r));
		case am: return H(Zp(t, i.message));
		case om: return x(q(() => Om(e, t, i.first, r)), td((n) => i.condition(n) ? x(Om(e, t, i.second, r), td((e) => H(Yp(n, e)))) : H(n)));
		case cm: return q(() => Om(e, t, i.config(), r));
		case lm: return q(() => x(Om(e, t, i.original, r), W(_d((e) => x(i.mapOrFail(e), xd(em(Tm(t, i.original))))))));
		case um: return q(() => Om(e, gm(t, pr(i.name)), i.config, r));
		case dm: return x(rm(t, e.patch), W((t) => x(e.load(t, i, r), W((e) => {
			if (e.length === 0) {
				let e = x(Xn(t), Dn(() => "<n/a>"));
				return H(Zp([], `Expected ${i.description} with name ${e}`));
			}
			return K(e);
		}))));
		case fm: return q(() => x(Om(e, t, i.original, r), xd(Dm), G(mr(i.redact))));
		case pm: return x(rm(t, e.patch), W((n) => x(e.enumerateChildren(n), W(Nm), W((n) => n.length === 0 ? q(() => G(Om(e, t, i.config, !0), pr)) : x(_d(n, (n) => Om(e, zn(t, `[${n}]`), i.config, !0)), G((e) => {
			let t = hr(e);
			return t.length === 0 ? pr(fr()) : pr(t);
		}))))));
		case mm: return q(() => x(rm(t, e.patch), W((t) => x(e.enumerateChildren(t), W((n) => x(n, _d((n) => Om(e, gm(t, pr(n)), i.valueConfig, r)), G((e) => e.length === 0 ? pr(vs()) : x(Mm(e), mr((e) => ys(ir(R(n), e)))))))))));
		case hm: return q(() => x(Om(e, t, i.left, r), od, W((n) => x(Om(e, t, i.right, r), od, W((e) => {
			if (gn(n) && gn(e)) return H(Jp(n.left, e.left));
			if (gn(n) && _n(e)) return H(n.left);
			if (_n(n) && gn(e)) return H(e.left);
			if (_n(n) && _n(e)) {
				let r = km(t, x(t, xr("."))), [a, o] = wm(r, r, x(n.right, mr(mn)), x(e.right, mr(mn)));
				return x(a, ir(o), _d(([e, t]) => x(Id(e, t), G(([e, t]) => i.zip(e, t)))));
			}
			throw Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
		})))));
	}
}, km = (e, t) => (n) => hn(Zp(e, `The element at index ${n} in a sequence at path "${t}" was missing`)), Am = (e, t) => e.split(RegExp(`\\s*${Cr(t)}\\s*`)), jm = (e, t, n, r, i) => i ? x(Am(e, r), _d((e) => n.parse(e.trim())), xd(em(t))) : x(n.parse(e), bd({
	onFailure: em(t),
	onSuccess: pr
})), Mm = (e) => Object.keys(e[0]).map((t) => e.map((e) => e[t])), Nm = (e) => x(_d(e, Fm), bd({
	onFailure: () => fr(),
	onSuccess: rr(Sr)
}), od, G(vn)), Pm = /^(\[(\d+)\])$/, Fm = (e) => {
	let t = e.match(Pm);
	if (t !== null) {
		let e = t[2];
		return x(e !== void 0 && e.length > 0 ? L(e) : I(), Mn(Im));
	}
	return I();
}, Im = (e) => {
	let t = Number.parseInt(e);
	return Number.isNaN(t) ? I() : L(t);
}, Lm = /*#__PURE__*/ Symbol.for("effect/Console"), Rm = /*#__PURE__*/ Zr("effect/Console"), zm = {
	[Lm]: Lm,
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
}, Bm = /*#__PURE__*/ Symbol.for("effect/Random"), Vm = /*#__PURE__*/ Zr("effect/Random"), Hm = class {
	seed;
	[Bm] = Bm;
	PRNG;
	constructor(e) {
		this.seed = e, this.PRNG = new Ye(e);
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
		return Um(e, (e) => this.nextIntBetween(0, e));
	}
}, Um = (e, t) => q(() => x(J(() => Array.from(e)), W((e) => {
	let n = [];
	for (let t = e.length; t >= 2; --t) n.push(t);
	return x(n, vd((n) => x(t(n), G((t) => Wm(e, n - 1, t)))), Yu(bi(e)));
}))), Wm = (e, t, n) => {
	let r = e[t];
	return e[t] = e[n], e[n] = r, e;
}, Gm = (e) => new Hm(E(e)), Km = /*#__PURE__*/ Symbol.for("effect/Tracer"), qm = (e) => ({
	[Km]: Km,
	...e
}), Jm = /*#__PURE__*/ Zr("effect/Tracer"), Ym = /*#__PURE__*/ Zr("effect/ParentSpan"), Xm = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), Zm = class {
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
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = t._tag === "Some" ? t.value.traceId : Xm(32), this.spanId = Xm(16), this.links = Array.from(r);
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
}, Qm = /*#__PURE__*/ qm({
	span: (e, t, n, r, i, a) => new Zm(e, t, n, r, i, a),
	context: (e) => e()
}), $m = /*#__PURE__*/ li()("effect/Tracer/DisablePropagation", { defaultValue: Ce }), eh = /*#__PURE__*/ x(/*#__PURE__*/ ei(), /*#__PURE__*/ ni(Fp, /*#__PURE__*/ Vp()), /*#__PURE__*/ ni(Rm, zm), /*#__PURE__*/ ni(Vm, /*#__PURE__*/ Gm(/*#__PURE__*/ Math.random())), /*#__PURE__*/ ni(vm, /*#__PURE__*/ Cm()), /*#__PURE__*/ ni(Jm, Qm)), th = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/DefaultServices/currentServices"), () => cf(eh));
// node_modules/effect/dist/esm/internal/fiberRefs.js
function nh(e) {
	return new ah(e);
}
function rh() {
	return nh(/* @__PURE__ */ new Map());
}
var ih = /*#__PURE__*/ Symbol.for("effect/FiberRefs"), ah = class {
	locals;
	[ih] = ih;
	constructor(e) {
		this.locals = e;
	}
	pipe() {
		return F(this, arguments);
	}
}, oh = (e, t, n, r = !1) => {
	let i = e, a = t, o = n, s = r, c;
	for (; c === void 0;) if (Un(a) && Un(o)) {
		let e = Yn(a)[0], t = Qn(a), n = Yn(o)[0], r = Yn(o)[1], i = Qn(o);
		e.startTimeMillis < n.startTimeMillis ? (o = i, s = !0) : e.startTimeMillis > n.startTimeMillis ? a = t : e.id < n.id ? (o = i, s = !0) : e.id > n.id ? a = t : c = [r, s];
	} else c = [i.initial, !0];
	return c;
}, sh = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = new Map(e.locals);
	return n.locals.forEach((e, n) => {
		let i = e[0][1];
		if (!e[0][0][A](t)) {
			if (!r.has(n)) {
				if (j(i, n.initial)) return;
				r.set(n, [[t, n.join(n.initial, i)]]);
				return;
			}
			let a = r.get(n), [o, s] = oh(n, a, e);
			if (s) {
				let e = n.diff(o, i), s = a[0][1], c = n.join(s, n.patch(e)(s));
				if (!j(s, c)) {
					let e, i = a[0][0];
					e = i[A](t) ? [[i, c], ...a.slice(1)] : [[t, c], ...a], r.set(n, e);
				}
			}
		}
	}), new ah(r);
}), ch = /*#__PURE__*/ y(2, (e, t) => {
	let n = /* @__PURE__ */ new Map();
	return lh(e, n, t), new ah(n);
}), lh = (e, t, n) => {
	e.locals.forEach((e, r) => {
		let i = e[0][1], a = r.patch(r.fork)(i);
		j(i, a) ? t.set(r, e) : t.set(r, [[n, a], ...e]);
	});
}, uh = /*#__PURE__*/ y(2, (e, t) => {
	let n = new Map(e.locals);
	return n.delete(t), new ah(n);
}), dh = /*#__PURE__*/ y(2, (e, t) => e.locals.has(t) ? L(Yn(e.locals.get(t))[1]) : I()), fh = /*#__PURE__*/ y(2, (e, t) => x(dh(e, t), Dn(() => t.initial))), ph = /*#__PURE__*/ y(2, (e, { fiberId: t, fiberRef: n, value: r }) => {
	if (e.locals.size === 0) return new ah(/* @__PURE__ */ new Map([[n, [[t, r]]]]));
	let i = new Map(e.locals);
	return mh(i, t, n, r), new ah(i);
}), mh = (e, t, n, r) => {
	let i = e.get(n) ?? [], a;
	if (Un(i)) {
		let [e, n] = Yn(i);
		if (e[A](t)) {
			if (j(n, r)) return;
			a = [[t, r], ...i.slice(1)];
		} else a = [[t, r], ...i];
	} else a = [[t, r]];
	e.set(n, a);
}, hh = /*#__PURE__*/ y(2, (e, { entries: t, forkAs: n }) => {
	if (e.locals.size === 0) return new ah(new Map(t));
	let r = new Map(e.locals);
	return n !== void 0 && lh(e, r, n), t.forEach(([e, t]) => {
		t.length === 1 ? mh(r, t[0][0], e, t[0][1]) : t.forEach(([t, n]) => {
			mh(r, t, e, n);
		});
	}), new ah(r);
}), gh = fh, _h = hh, vh = rh, yh = Hd, bh = Ud, xh = Wd, Sh = Gd, Ch = Kd, wh = qd, Th = Jd, Eh = Yd, Dh = /*#__PURE__*/ Cn(/* @__PURE__ */ x(Sr, /*#__PURE__*/ Sn((e) => e.ordinal))), Oh = (e) => {
	switch (e) {
		case "All": return yh;
		case "Debug": return wh;
		case "Error": return xh;
		case "Fatal": return bh;
		case "Info": return Ch;
		case "Trace": return Th;
		case "None": return Eh;
		case "Warning": return Sh;
	}
}, kh = (e) => e.replace(/[\s="]/g, "_"), Ah = (e) => (t) => `${kh(t.label)}=${e - t.startTime}ms`, jh = Wt, Mh = Jt, Nh = class extends Mh {}, Ph = /*#__PURE__*/ Symbol.for("effect/Readable"), Fh = /*#__PURE__*/ Symbol.for("effect/Ref"), Ih = {
/* c8 ignore next */
_A: (e) => e }, Lh = class extends Nh {
	ref;
	commit() {
		return this.get;
	}
	[Fh] = Ih;
	[Ph] = Ph;
	constructor(e) {
		super(), this.ref = e, this.get = J(() => Qo(this.ref));
	}
	get;
	modify(e) {
		return J(() => {
			let t = Qo(this.ref), [n, r] = e(t);
			return t !== r && $o(r)(this.ref), n;
		});
	}
}, Rh = (e) => new Lh(Zo(e)), zh = (e) => J(() => Rh(e)), Bh = (e) => e.get, Vh = /*#__PURE__*/ y(2, (e, t) => e.modify(() => [void 0, t])), Hh = /*#__PURE__*/ y(2, (e, t) => e.modify(t)), Uh = /*#__PURE__*/ y(2, (e, t) => e.modify((e) => [void 0, t(e)])), Wh = "Empty", Gh = "Remove", Kh = "Update", qh = "AndThen", Jh = { _tag: Wh }, Yh = (e, t) => {
	let n = new Map(e.locals), r = Jh;
	for (let [e, i] of t.locals.entries()) {
		let t = Yn(i)[1], a = n.get(e);
		if (a !== void 0) {
			let n = Yn(a)[1];
			j(n, t) || (r = Xh({
				_tag: Kh,
				fiberRef: e,
				patch: e.diff(n, t)
			})(r));
		} else r = Xh({
			_tag: "Add",
			fiberRef: e,
			value: t
		})(r);
		n.delete(e);
	}
	for (let [e] of n.entries()) r = Xh({
		_tag: Gh,
		fiberRef: e
	})(r);
	return r;
}, Xh = /*#__PURE__*/ y(2, (e, t) => ({
	_tag: qh,
	first: e,
	second: t
})), Zh = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = n, i = pr(e);
	for (; Un(i);) {
		let e = Yn(i), n = Qn(i);
		switch (e._tag) {
			case Wh:
				i = n;
				break;
			case "Add":
				r = ph(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.value
				}), i = n;
				break;
			case Gh:
				r = uh(r, e.fiberRef), i = n;
				break;
			case Kh: {
				let a = fh(r, e.fiberRef);
				r = ph(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.fiberRef.patch(e.patch)(a)
				}), i = n;
				break;
			}
			case qh: i = Rn(e.first)(Rn(e.second)(n));
		}
	}
	return r;
}), Qh = "effect/MetricLabel", $h = /*#__PURE__*/ Symbol.for(Qh), eg = class {
	key;
	value;
	[$h] = $h;
	_hash;
	constructor(e, t) {
		this.key = e, this.value = t, this._hash = O(Qh + this.key + this.value);
	}
	[T]() {
		return this._hash;
	}
	[A](e) {
		return ng(e) && this.key === e.key && this.value === e.value;
	}
	pipe() {
		return F(this, arguments);
	}
}, tg = (e, t) => new eg(e, t), ng = (e) => C(e, $h), rg = (e) => G(e, L), ig = (e) => {
	let t, n;
	return typeof e == "function" ? t = e : (t = e.try, n = e.catch), q(() => {
		try {
			return K(w(t));
		} catch (e) {
			return H(n ? w(() => n(e)) : new Uf(e, "An unknown error occurred in Effect.try"));
		}
	});
}, ag = (e) => pg(e, sg, Yh), og = /*#__PURE__*/ y(2, (e, t) => gd(e, {
	onFailure: (e) => K(t.onFailure(e)),
	onSuccess: (e) => K(t.onSuccess(e))
})), sg = /*#__PURE__*/ V((e) => K(e.getFiberRefs())), cg = (e) => og(e, {
	onFailure: Te,
	onSuccess: Te
}), lg = (e) => gg((t, n) => x(e, Zh(t, n))), ug = (e) => e.length >= 1 ? ed((t, n) => {
	try {
		e(n).then((e) => t(K(e)), (e) => t(id(e)));
	} catch (e) {
		t(id(e));
	}
}) : ed((t) => {
	try {
		e().then((e) => t(K(e)), (e) => t(id(e)));
	} catch (e) {
		t(id(e));
	}
}), dg = /*#__PURE__*/ y(3, (e, t, n) => gp((r) => _p(e, ni(r, t, n)))), fg = /*#__PURE__*/ K(/*#__PURE__*/ I()), pg = /*#__PURE__*/ y(3, (e, t, n) => W(t, (r) => W(e, (e) => G(t, (t) => [n(r, t), e])))), mg = /*#__PURE__*/ y(2, (e, t) => hd(e, {
	onFailure: (e) => {
		let n = uu(e);
		switch (n._tag) {
			case "Left": return Rd(t(n.left), U(e));
			case "Right": return U(e);
		}
	},
	onSuccess: K
})), hg = (e) => {
	let t, n;
	typeof e == "function" ? t = e : (t = e.try, n = e.catch);
	let r = (e) => n ? cd(() => n(e)) : H(new Uf(e, "An unknown error occurred in Effect.tryPromise"));
	return t.length >= 1 ? ed((e, n) => {
		try {
			t(n).then((t) => e(K(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	}) : ed((e) => {
		try {
			t().then((t) => e(K(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	});
}, gg = (e) => V((t) => (t.setFiberRefs(e(t.id(), t.getFiberRefs())), Y)), _g = /*#__PURE__*/ Mn((e) => ri(e.context, $m) ? e._tag === "Span" ? _g(e.parent) : I() : L(e)), vg = "Sequential", yg = "Parallel", bg = "ParallelN", xg = { _tag: vg }, Sg = { _tag: yg }, Cg = (e) => ({
	_tag: bg,
	parallelism: e
}), wg = (e) => e._tag === vg, Tg = (e) => e._tag === yg, Eg = xg, Dg = Sg, Og = Cg, kg = Yh, Ag = Zh, jg = "effect/FiberStatus", Mg = /*#__PURE__*/ Symbol.for(jg), Ng = "Done", Pg = "Running", Fg = "Suspended", Ig = /*#__PURE__*/ O(`${jg}-${Ng}`), Lg = class {
	[Mg] = Mg;
	_tag = Ng;
	[T]() {
		return Ig;
	}
	[A](e) {
		return Ug(e) && e._tag === "Done";
	}
}, Rg = class {
	runtimeFlags;
	[Mg] = Mg;
	_tag = Pg;
	constructor(e) {
		this.runtimeFlags = e;
	}
	[T]() {
		return x(E(jg), D(E(this._tag)), D(E(this.runtimeFlags)), k(this));
	}
	[A](e) {
		return Ug(e) && e._tag === "Running" && this.runtimeFlags === e.runtimeFlags;
	}
}, zg = class {
	runtimeFlags;
	blockingOn;
	[Mg] = Mg;
	_tag = Fg;
	constructor(e, t) {
		this.runtimeFlags = e, this.blockingOn = t;
	}
	[T]() {
		return x(E(jg), D(E(this._tag)), D(E(this.runtimeFlags)), D(E(this.blockingOn)), k(this));
	}
	[A](e) {
		return Ug(e) && e._tag === "Suspended" && this.runtimeFlags === e.runtimeFlags && j(this.blockingOn, e.blockingOn);
	}
}, Bg = /*#__PURE__*/ new Lg(), Vg = (e) => new Rg(e), Hg = (e, t) => new zg(e, t), Ug = (e) => C(e, Mg), Wg = (e) => e._tag === Ng, Gg = Bg, Kg = Vg, qg = Hg, Jg = Wg, Yg = /*#__PURE__*/ Symbol.for("effect/Micro"), Xg = /*#__PURE__*/ Symbol.for("effect/Micro/MicroExit"), Zg = /*#__PURE__*/ Symbol.for("effect/Micro/MicroCause"), Qg = { _E: b }, $g = class extends globalThis.Error {
	_tag;
	traces;
	[Zg];
	constructor(e, t, n) {
		let r = `MicroCause.${e}`, i, a, o;
		if (t instanceof globalThis.Error) {
			i = `(${r}) ${t.name}`, a = t.message;
			let e = a.split("\n").length;
			o = t.stack ? `(${r}) ${t.stack.split("\n").slice(0, e + 3).join("\n")}` : `${i}: ${a}`;
		} else i = r, a = mt(t, 0), o = `${i}: ${a}`;
		n.length > 0 && (o += `\n    ${n.join("\n    ")}`), super(a), this._tag = e, this.traces = n, this[Zg] = Qg, this.name = i, this.stack = o;
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
}, e_ = class extends $g {
	defect;
	constructor(e, t = []) {
		super("Die", e, t), this.defect = e;
	}
}, t_ = (e, t = []) => new e_(e, t), n_ = class extends $g {
	constructor(e = []) {
		super("Interrupt", "interrupted", e);
	}
}, r_ = (e = []) => new n_(e), i_ = (e) => e._tag === "Interrupt", a_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroFiber"), o_ = {
	_A: b,
	_E: b
}, s_ = class {
	context;
	interruptible;
	[a_];
	_stack = [];
	_observers = [];
	_exit;
	_children;
	currentOpCount = 0;
	constructor(e, t = !0) {
		this.context = e, this.interruptible = t, this[a_] = o_;
	}
	getRef(e) {
		return Gr(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), Te) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	_interrupted = !1;
	unsafeInterrupt() {
		this._exit || (this._interrupted = !0, this.interruptible && this.evaluate(j_));
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
		if (t === m_) return;
		let n = c_.interruptChildren && c_.interruptChildren(this);
		if (n !== void 0) return this.evaluate(E_(n, () => t));
		this._exit = t;
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = !1, n = e;
		this.currentOpCount = 0;
		try {
			for (;;) {
				if (this.currentOpCount++, !t && this.getRef(z_).shouldYield(this)) {
					t = !0;
					let e = n;
					n = E_(C_, () => e);
				}
				if (n = n[u_](this), n === m_) {
					let e = this._yielded;
					return Xg in e ? (this._yielded = void 0, e) : m_;
				}
			}
		} catch (e) {
			return C(n, u_) ? M_(e) : M_(`MicroFiber.runLoop: Not a valid effect: ${String(n)}`);
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[p_] && t[p_](this);
			if (n) return { [e]: n };
			if (t[e]) return t;
		}
	}
	_yielded = void 0;
	yieldWith(e) {
		return this._yielded = e, m_;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
}, c_ = /*#__PURE__*/ S("effect/Micro/fiberMiddleware", () => ({ interruptChildren: void 0 })), l_ = /*#__PURE__*/ Symbol.for("effect/Micro/identifier"), Q = /*#__PURE__*/ Symbol.for("effect/Micro/args"), u_ = /*#__PURE__*/ Symbol.for("effect/Micro/evaluate"), d_ = /*#__PURE__*/ Symbol.for("effect/Micro/successCont"), f_ = /*#__PURE__*/ Symbol.for("effect/Micro/failureCont"), p_ = /*#__PURE__*/ Symbol.for("effect/Micro/ensureCont"), m_ = /*#__PURE__*/ Symbol.for("effect/Micro/Yield"), h_ = {
	_A: b,
	_E: b,
	_R: b
}, g_ = {
	...jh,
	_op: "Micro",
	[Yg]: h_,
	pipe() {
		return F(this, arguments);
	},
	[Symbol.iterator]() {
		return new He(new $e(this));
	},
	toJSON() {
		return {
			_id: "Micro",
			op: this[l_],
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
function __(e) {
	return M_("Micro.evaluate: Not implemented");
}
var v_ = (e) => ({
	...g_,
	[l_]: e.op,
	[u_]: e.eval ?? __,
	[d_]: e.contA,
	[f_]: e.contE,
	[p_]: e.ensure
}), y_ = (e) => {
	let t = v_(e);
	return function() {
		let n = Object.create(t);
		return n[Q] = e.single === !1 ? arguments : arguments[0], n;
	};
}, b_ = (e) => {
	let t = {
		...v_(e),
		[Xg]: Xg,
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
			return O_(t) && t._tag === e.op && j(this[Q], t[Q]);
		},
		[T]() {
			return k(this, D(O(e.op))(E(this[Q])));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[Q] = e, n[d_] = void 0, n[f_] = void 0, n[p_] = void 0, n;
	};
}, x_ = /*#__PURE__*/ b_({
	op: "Success",
	prop: "value",
	eval(e) {
		let t = e.getCont(d_);
		return t ? t[d_](this[Q], e) : e.yieldWith(this);
	}
}), S_ = /*#__PURE__*/ b_({
	op: "Failure",
	prop: "cause",
	eval(e) {
		let t = e.getCont(f_);
		for (; i_(this[Q]) && t && e.interruptible;) t = e.getCont(f_);
		return t ? t[f_](this[Q], e) : e.yieldWith(this);
	}
}), C_ = /*#__PURE__*/ (/* @__PURE__ */ y_({
	op: "Yield",
	eval(e) {
		let t = !1;
		return e.getRef(z_).scheduleTask(() => {
			t || e.evaluate(N_);
		}, this[Q] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), w_ = /*#__PURE__*/ x_(void 0), T_ = /*#__PURE__*/ y_({
	op: "WithMicroFiber",
	eval(e) {
		return this[Q](e);
	}
}), E_ = /*#__PURE__*/ y(2, (e, t) => {
	let n = Object.create(D_);
	return n[Q] = e, n[d_] = t, n;
}), D_ = /*#__PURE__*/ v_({
	op: "OnSuccess",
	eval(e) {
		return e._stack.push(this), this[Q];
	}
}), O_ = (e) => C(e, Xg), k_ = x_, A_ = S_, j_ = /*#__PURE__*/ A_(/*#__PURE__*/ r_()), M_ = (e) => A_(t_(e)), N_ = /*#__PURE__*/ k_(void 0), P_ = "setImmediate" in globalThis ? globalThis.setImmediate : (e) => setTimeout(e, 0), F_ = class {
	tasks = [];
	running = !1;
	scheduleTask(e, t) {
		this.tasks.push(e), this.running || (this.running = !0, P_(this.afterScheduled));
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
		return e.currentOpCount >= e.getRef(R_);
	}
	flush() {
		for (; this.tasks.length > 0;) this.runTasks();
	}
}, I_ = /*#__PURE__*/ y(2, (e, t) => T_((n) => {
	let r = n.context;
	return n.context = t(r), H_(e, () => (n.context = r, w_));
})), L_ = /*#__PURE__*/ y(2, (e, t) => I_(e, oi(t))), R_ = class extends (/*#__PURE__*/ li()("effect/Micro/currentMaxOpsBeforeYield", { defaultValue: () => 2048 })) {}, z_ = class extends (/*#__PURE__*/ li()("effect/Micro/currentScheduler", { defaultValue: () => new F_() })) {}, B_ = /*#__PURE__*/ y(2, (e, t) => {
	let n = Object.create(V_);
	return n[Q] = e, n[d_] = t.onSuccess, n[f_] = t.onFailure, n;
}), V_ = /*#__PURE__*/ v_({
	op: "OnSuccessAndFailure",
	eval(e) {
		return e._stack.push(this), this[Q];
	}
}), H_ = /*#__PURE__*/ y(2, (e, t) => G_((n) => B_(n(e), {
	onFailure: (e) => E_(t(A_(e)), () => S_(e)),
	onSuccess: (e) => E_(t(k_(e)), () => x_(e))
}))), U_ = /*#__PURE__*/ y_({
	op: "SetInterruptible",
	ensure(e) {
		if (e.interruptible = this[Q], e._interrupted && e.interruptible) return () => j_;
	}
}), W_ = (e) => T_((t) => t.interruptible ? e : (t.interruptible = !0, t._stack.push(U_(!1)), t._interrupted ? j_ : e)), G_ = (e) => T_((t) => t.interruptible ? (t.interruptible = !1, t._stack.push(U_(!0)), e(W_)) : e(b)), K_ = (e, t) => {
	let n = new s_(z_.context(t?.scheduler ?? new F_()));
	if (n.evaluate(e), t?.signal) {
		if (t.signal.aborted) n.unsafeInterrupt();
		else {
			let e = () => n.unsafeInterrupt();
			t.signal.addEventListener("abort", e, { once: !0 }), n.addObserver(() => t.signal.removeEventListener("abort", e));
		}
	}
	return n;
}, q_ = class e {
	scheduleDrain;
	running = !1;
	tasks = /*#__PURE__*/ new J_();
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
}, J_ = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets.length, r, i = 0;
		for (; i < n && this.buckets[i][0] <= t; i++) r = this.buckets[i];
		r && r[0] === t ? r[1].push(e) : i === n ? this.buckets.push([t, [e]]) : this.buckets.splice(i, 0, [t, [e]]);
	}
}, Y_ = class {
	maxNextTickBeforeTimer;
	getRunner = /*#__PURE__*/ q_.cached((e, t) => {
		e >= this.maxNextTickBeforeTimer ? setTimeout(() => t(0), 0) : Promise.resolve(void 0).then(() => t(e + 1));
	});
	constructor(e) {
		this.maxNextTickBeforeTimer = e;
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(pf) && e.getFiberRef(ff);
	}
	scheduleTask(e, t, n) {
		this.getRunner(n).scheduleTask(e, t);
	}
}, X_ = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Scheduler/defaultScheduler"), () => new Y_(2048)), Z_ = class {
	tasks = /*#__PURE__*/ new J_();
	deferred = !1;
	scheduleTask(e, t, n) {
		this.deferred ? X_.scheduleTask(e, t, n) : this.tasks.scheduleTask(e, t);
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(pf) && e.getFiberRef(ff);
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) {
			let e = this.tasks.buckets;
			this.tasks.buckets = [];
			for (let [t, n] of e) for (let e = 0; e < n.length; e++) n[e]();
		}
		this.deferred = !0;
	}
}, Q_ = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentScheduler"), () => af(X_)), $_ = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestMap"), () => af(/* @__PURE__ */ new Map())), ev = (e, t, n, r) => {
	switch (e) {
		case void 0: return t();
		case "unbounded": return n();
		case "inherit": return $d(vf, (e) => e === "unbounded" ? n() : e > 1 ? r(e) : t());
		default: return e > 1 ? r(e) : t();
	}
}, tv = "InterruptSignal", nv = "Stateful", rv = "Resume", iv = "YieldNow", av = (e) => ({
	_tag: tv,
	cause: e
}), ov = (e) => ({
	_tag: nv,
	onFiber: e
}), sv = (e) => ({
	_tag: rv,
	effect: e
}), cv = () => ({ _tag: iv }), lv = /*#__PURE__*/ Symbol.for("effect/FiberScope"), uv = class {
	[lv] = lv;
	fiberId = ms;
	roots = /*#__PURE__*/ new Set();
	add(e, t) {
		this.roots.add(t), t.addObserver(() => {
			this.roots.delete(t);
		});
	}
}, dv = class {
	fiberId;
	parent;
	[lv] = lv;
	constructor(e, t) {
		this.fiberId = e, this.parent = t;
	}
	add(e, t) {
		this.parent.tell(ov((e) => {
			e.addChild(t), t.addObserver(() => {
				e.removeChild(t);
			});
		}));
	}
}, fv = (e) => new dv(e.id(), e), pv = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberScope/Global"), () => new uv()), mv = /*#__PURE__*/ Symbol.for("effect/Fiber"), hv = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, gv = {
	[mv]: hv,
	pipe() {
		return F(this, arguments);
	}
}, _v = /*#__PURE__*/ Symbol.for("effect/Fiber"), vv = (e) => Ld(pd(e.await), e.inheritAll);
({ ...Kt }), { ...gv };
var yv = "effect/FiberCurrent", bv = /*#__PURE__*/ Symbol.for("effect/Logger"), xv = {
	/* c8 ignore next */
	_Message: (e) => e,
	/* c8 ignore next */
	_Output: (e) => e
}, Sv = (e) => ({
	[bv]: xv,
	log: e,
	pipe() {
		return F(this, arguments);
	}
}), Cv = /^[^\s"=]*$/, wv = /*#__PURE__*/ Sv(/*#__PURE__*/ ((e, t) => ({ annotations: n, cause: r, date: i, fiberId: a, logLevel: o, message: s, spans: c }) => {
	let l = (t) => t.match(Cv) ? t : e(t), u = (e, t) => `${kh(e)}=${l(t)}`, d = (e, t) => " " + u(e, t), f = u("timestamp", i.toISOString());
	f += d("level", o.label), f += d("fiber", fs(a));
	let p = Ln(s);
	for (let e = 0; e < p.length; e++) f += d("message", mt(p[e], t));
	nu(r) || (f += d("cause", Tu(r, { renderErrorCause: !0 })));
	for (let e of c) f += " " + Ah(i.getTime())(e);
	for (let [e, r] of n) f += d(e, mt(r, t));
	return f;
})((e) => `"${e.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`)), Tv = {
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
Tv.gray, Tv.blue, Tv.green, Tv.yellow, Tv.red, Tv.bgBrightRed, Tv.black;
var Ev = typeof process == "object" && process !== null && typeof process.stdout == "object" && process.stdout !== null;
Ev && process.stdout.isTTY, Ev || "Deno" in globalThis;
// node_modules/effect/dist/esm/internal/metric/boundaries.js
var Dv = "effect/MetricBoundaries", Ov = /*#__PURE__*/ Symbol.for(Dv), kv = class {
	values;
	[Ov] = Ov;
	constructor(e) {
		this.values = e, this._hash = x(O(Dv), D(ut(this.values)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return Av(e) && j(this.values, e.values);
	}
	pipe() {
		return F(this, arguments);
	}
}, Av = (e) => C(e, Ov), jv = (e) => new kv(x(e, Bn(yi(Infinity)), br)), Mv = (e) => x(In(e.count - 1, (t) => e.start * e.factor ** +t), Ti, jv), Nv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType"), Pv = "effect/MetricKeyType/Counter", Fv = /*#__PURE__*/ Symbol.for(Pv), Iv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Frequency"), Lv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Gauge"), Rv = "effect/MetricKeyType/Histogram", zv = /*#__PURE__*/ Symbol.for(Rv), Bv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Summary"), Vv = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Hv = class {
	incremental;
	bigint;
	[Nv] = Vv;
	[Fv] = Fv;
	constructor(e, t) {
		this.incremental = e, this.bigint = t, this._hash = O(Pv);
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return Kv(e);
	}
	pipe() {
		return F(this, arguments);
	}
}, Uv = class {
	boundaries;
	[Nv] = Vv;
	[zv] = zv;
	constructor(e) {
		this.boundaries = e, this._hash = x(O(Rv), D(E(this.boundaries)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return Yv(e) && j(this.boundaries, e.boundaries);
	}
	pipe() {
		return F(this, arguments);
	}
}, Wv = (e) => new Hv(e?.incremental ?? !1, e?.bigint ?? !1), Gv = (e) => new Uv(e), Kv = (e) => C(e, Fv), qv = (e) => C(e, Iv), Jv = (e) => C(e, Lv), Yv = (e) => C(e, zv), Xv = (e) => C(e, Bv), Zv = /*#__PURE__*/ Symbol.for("effect/MetricKey"), Qv = {
/* c8 ignore next */
_Type: (e) => e }, $v = /*#__PURE__*/ vr(j), ey = class {
	name;
	keyType;
	description;
	tags;
	[Zv] = Qv;
	constructor(e, t, n, r = []) {
		this.name = e, this.keyType = t, this.description = n, this.tags = r, this._hash = x(O(this.name + this.description), D(E(this.keyType)), D(ut(this.tags)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return ty(e) && this.name === e.name && j(this.keyType, e.keyType) && j(this.description, e.description) && $v(this.tags, e.tags);
	}
	pipe() {
		return F(this, arguments);
	}
}, ty = (e) => C(e, Zv), ny = (e, t) => new ey(e, Wv(t), kn(t?.description)), ry = (e, t, n) => new ey(e, Gv(t), kn(n)), iy = /*#__PURE__*/ y(2, (e, t) => t.length === 0 ? e : new ey(e.name, e.keyType, e.description, dr(e.tags, t))), ay = /*#__PURE__*/ Symbol.for("effect/MetricState"), oy = "effect/MetricState/Counter", sy = /*#__PURE__*/ Symbol.for(oy), cy = "effect/MetricState/Frequency", ly = /*#__PURE__*/ Symbol.for(cy), uy = "effect/MetricState/Gauge", dy = /*#__PURE__*/ Symbol.for(uy), fy = "effect/MetricState/Histogram", py = /*#__PURE__*/ Symbol.for(fy), my = "effect/MetricState/Summary", hy = /*#__PURE__*/ Symbol.for(my), gy = {
/* c8 ignore next */
_A: (e) => e }, _y = class {
	count;
	[ay] = gy;
	[sy] = sy;
	constructor(e) {
		this.count = e;
	}
	[T]() {
		return x(E(oy), D(E(this.count)), k(this));
	}
	[A](e) {
		return Oy(e) && this.count === e.count;
	}
	pipe() {
		return F(this, arguments);
	}
}, vy = /*#__PURE__*/ vr(j), yy = class {
	occurrences;
	[ay] = gy;
	[ly] = ly;
	constructor(e) {
		this.occurrences = e;
	}
	_hash;
	[T]() {
		return x(O(cy), D(ut(R(this.occurrences.entries()))), k(this));
	}
	[A](e) {
		return ky(e) && vy(R(this.occurrences.entries()), R(e.occurrences.entries()));
	}
	pipe() {
		return F(this, arguments);
	}
}, by = class {
	value;
	[ay] = gy;
	[dy] = dy;
	constructor(e) {
		this.value = e;
	}
	[T]() {
		return x(E(uy), D(E(this.value)), k(this));
	}
	[A](e) {
		return Ay(e) && this.value === e.value;
	}
	pipe() {
		return F(this, arguments);
	}
}, xy = class {
	buckets;
	count;
	min;
	max;
	sum;
	[ay] = gy;
	[py] = py;
	constructor(e, t, n, r, i) {
		this.buckets = e, this.count = t, this.min = n, this.max = r, this.sum = i;
	}
	[T]() {
		return x(E(fy), D(E(this.buckets)), D(E(this.count)), D(E(this.min)), D(E(this.max)), D(E(this.sum)), k(this));
	}
	[A](e) {
		return jy(e) && j(this.buckets, e.buckets) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return F(this, arguments);
	}
}, Sy = class {
	error;
	quantiles;
	count;
	min;
	max;
	sum;
	[ay] = gy;
	[hy] = hy;
	constructor(e, t, n, r, i, a) {
		this.error = e, this.quantiles = t, this.count = n, this.min = r, this.max = i, this.sum = a;
	}
	[T]() {
		return x(E(my), D(E(this.error)), D(E(this.quantiles)), D(E(this.count)), D(E(this.min)), D(E(this.max)), D(E(this.sum)), k(this));
	}
	[A](e) {
		return My(e) && this.error === e.error && j(this.quantiles, e.quantiles) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return F(this, arguments);
	}
}, Cy = (e) => new _y(e), wy = (e) => new yy(e), Ty = (e) => new by(e), Ey = (e) => new xy(e.buckets, e.count, e.min, e.max, e.sum), Dy = (e) => new Sy(e.error, e.quantiles, e.count, e.min, e.max, e.sum), Oy = (e) => C(e, sy), ky = (e) => C(e, ly), Ay = (e) => C(e, dy), jy = (e) => C(e, py), My = (e) => C(e, hy), Ny = /*#__PURE__*/ Symbol.for("effect/MetricHook"), Py = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Fy = (e) => ({
	[Ny]: Py,
	pipe() {
		return F(this, arguments);
	},
	...e
}), Iy = /*#__PURE__*/ BigInt(0), Ly = (e) => {
	let t = e.keyType.bigint ? Iy : 0, n = e.keyType.incremental ? e.keyType.bigint ? (e) => e >= Iy : (e) => e >= 0 : (e) => !0, r = (e) => {
		n(e) && (t += e);
	};
	return Fy({
		get: () => Cy(t),
		update: r,
		modify: r
	});
}, Ry = (e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.keyType.preregisteredWords) t.set(n, 0);
	let n = (e) => {
		let n = t.get(e) ?? 0;
		t.set(e, n + 1);
	};
	return Fy({
		get: () => wy(t),
		update: n,
		modify: n
	});
}, zy = (e, t) => {
	let n = t;
	return Fy({
		get: () => Ty(n),
		update: (e) => {
			n = e;
		},
		modify: (e) => {
			n += e;
		}
	});
}, By = (e) => {
	let t = e.keyType.boundaries.values, n = t.length, r = new Uint32Array(n + 1), i = new Float64Array(n), a = 0, o = 0, s = Number.MAX_VALUE, c = Number.MIN_VALUE;
	x(t, rr(Sr), mr((e, t) => {
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
		let e = Fn(n), t = 0;
		for (let a = 0; a < n; a++) {
			let n = i[a], o = r[a];
			t += o, e[a] = [n, t];
		}
		return e;
	};
	return Fy({
		get: () => Ey({
			buckets: u(),
			count: a,
			min: s,
			max: c,
			sum: o
		}),
		update: l,
		modify: l
	});
}, Vy = (e) => {
	let { error: t, maxAge: n, maxSize: r, quantiles: i } = e.keyType, a = x(i, rr(Sr)), o = Fn(r), s = 0, c = 0, l = 0, u = 0, d = 0, f = (e) => {
		let i = [], s = 0;
		for (; s !== r - 1;) {
			let t = o[s];
			if (t != null) {
				let [r, a] = t, o = ra(e - r);
				ga(o, $i) && ha(o, n) && i.push(a);
			}
			s += 1;
		}
		return Hy(t, a, rr(i, Sr));
	}, p = (e, t) => {
		if (r > 0) {
			s += 1;
			let n = s % r;
			o[n] = [t, e];
		}
		u = c === 0 ? e : Math.min(u, e), d = c === 0 ? e : Math.max(d, e), c += 1, l += e;
	};
	return Fy({
		get: () => Dy({
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
}, Hy = (e, t, n) => {
	let r = n.length;
	if (!Un(t)) return fr();
	let i = t[0], a = t.slice(1), o = Uy(e, r, I(), 0, i, n), s = pr(o);
	return a.forEach((t) => {
		s.push(Uy(e, r, o.value, o.consumed, t, o.rest));
	}), mr(s, (e) => [e.quantile, e.value]);
}, Uy = (e, t, n, r, i, a) => {
	let o = e, s = t, c = n, l = r, u = i, d = a, f = e, p = t, ee = n, m = r, te = i, ne = a;
	for (;;) {
		if (!Un(d)) return {
			quantile: u,
			value: I(),
			consumed: l,
			rest: []
		};
		if (u === 1) return {
			quantile: u,
			value: L(Zn(d)),
			consumed: l + d.length,
			rest: []
		};
		let e = Yn(d), t = er(d, (t) => t === e), n = u * s, r = o / 2 * n, i = l + t[0].length, a = Math.abs(i - n);
		if (i < n - r) f = o, p = s, ee = Jn(d), m = i, te = u, ne = t[1], o = f, s = p, c = ee, l = m, u = te, d = ne;
		else {
			if (i > n + r) {
				let t = wn(c) ? L(e) : c;
				return {
					quantile: u,
					value: t,
					consumed: l,
					rest: d
				};
			}
			switch (c._tag) {
				case "None":
					f = o, p = s, ee = Jn(d), m = i, te = u, ne = t[1], o = f, s = p, c = ee, l = m, u = te, d = ne;
					continue;
				case "Some":
					if (a < Math.abs(n - c.value)) {
						f = o, p = s, ee = Jn(d), m = i, te = u, ne = t[1], o = f, s = p, c = ee, l = m, u = te, d = ne;
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
}, Wy = /*#__PURE__*/ Symbol.for("effect/MetricPair"), Gy = {
/* c8 ignore next */
_Type: (e) => e }, Ky = (e, t) => ({
	[Wy]: Gy,
	metricKey: e,
	metricState: t,
	pipe() {
		return F(this, arguments);
	}
}), qy = /*#__PURE__*/ Symbol.for("effect/MetricRegistry"), Jy = class {
	[qy] = qy;
	map = /*#__PURE__*/ Op();
	snapshot() {
		let e = [];
		for (let [t, n] of this.map) e.push(Ky(t, n.get()));
		return e;
	}
	get(e) {
		let t = x(this.map, kp(e), An);
		if (t == null) {
			if (Kv(e.keyType)) return this.getCounter(e);
			if (Jv(e.keyType)) return this.getGauge(e);
			if (qv(e.keyType)) return this.getFrequency(e);
			if (Yv(e.keyType)) return this.getHistogram(e);
			if (Xv(e.keyType)) return this.getSummary(e);
			throw Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
		}
		return t;
	}
	getCounter(e) {
		let t = x(this.map, kp(e), An);
		if (t == null) {
			let n = Ly(e);
			x(this.map, jp(e)) || x(this.map, Mp(e, n)), t = n;
		}
		return t;
	}
	getFrequency(e) {
		let t = x(this.map, kp(e), An);
		if (t == null) {
			let n = Ry(e);
			x(this.map, jp(e)) || x(this.map, Mp(e, n)), t = n;
		}
		return t;
	}
	getGauge(e) {
		let t = x(this.map, kp(e), An);
		if (t == null) {
			let n = zy(e, e.keyType.bigint ? BigInt(0) : 0);
			x(this.map, jp(e)) || x(this.map, Mp(e, n)), t = n;
		}
		return t;
	}
	getHistogram(e) {
		let t = x(this.map, kp(e), An);
		if (t == null) {
			let n = By(e);
			x(this.map, jp(e)) || x(this.map, Mp(e, n)), t = n;
		}
		return t;
	}
	getSummary(e) {
		let t = x(this.map, kp(e), An);
		if (t == null) {
			let n = Vy(e);
			x(this.map, jp(e)) || x(this.map, Mp(e, n)), t = n;
		}
		return t;
	}
}, Yy = () => new Jy(), Xy = /*#__PURE__*/ Symbol.for("effect/Metric"), Zy = {
	/* c8 ignore next */
	_Type: (e) => e,
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Qy = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Metric/globalMetricRegistry"), () => Yy()), $y = function(e, t, n, r) {
	let i = Object.assign((e) => wd(e, (e) => ab(i, e)), {
		[Xy]: Zy,
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
}, eb = (e, t) => tb(ny(e, t)), tb = (e) => {
	let t, n = /* @__PURE__ */ new WeakMap(), r = (r) => {
		if (r.length === 0) return t === void 0 && (t = Qy.get(e)), t;
		let i = n.get(r);
		return i === void 0 && (i = Qy.get(iy(e, r)), n.set(r, i)), i;
	};
	return $y(e.keyType, (e, t) => r(t).update(e), (e) => r(e).get(), (e, t) => r(t).modify(e));
}, nb = (e, t, n) => tb(ry(e, t, n)), rb = /*#__PURE__*/ y(3, (e, t, n) => ib(e, [tg(t, n)])), ib = /*#__PURE__*/ y(2, (e, t) => $y(e.keyType, (n, r) => e.unsafeUpdate(n, dr(t, r)), (n) => e.unsafeValue(dr(t, n)), (n, r) => e.unsafeModify(n, dr(t, r)))), ab = /*#__PURE__*/ y(2, (e, t) => $d(Sf, (n) => J(() => e.unsafeUpdate(t, n))));
({ ...Gt });
var ob = /*#__PURE__*/ y(2, (e, t) => $d($_, (n) => J(() => {
	if (n.has(e)) {
		let r = n.get(e);
		r.state.completed || (r.state.completed = !0, fp(r.result, t));
	}
}))), sb = /*#__PURE__*/ Symbol.for("effect/Supervisor"), cb = {
/* c8 ignore next */
_T: (e) => e }, lb = class e {
	underlying;
	value0;
	[sb] = cb;
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
		return new ub(this, e);
	}
}, ub = class e {
	left;
	right;
	_tag = "Zip";
	[sb] = cb;
	constructor(e, t) {
		this.left = e, this.right = t;
	}
	get value() {
		return Id(this.left.value, this.right.value);
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
		return new lb(this, x(this.value, G(e)));
	}
	zip(t) {
		return new e(this, t);
	}
}, db = (e) => C(e, sb) && Le(e, "Zip"), fb = class {
	effect;
	[sb] = cb;
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
		return new lb(this, x(this.value, G(e)));
	}
	zip(e) {
		return new ub(this, e);
	}
	onRun(e, t) {
		return e();
	}
}, pb = (e) => new fb(e), mb = /*#__PURE__*/ S("effect/Supervisor/none", () => pb(Y)), hb = Bc, gb = "Empty", _b = "AddSupervisor", vb = "RemoveSupervisor", yb = "AndThen", bb = { _tag: gb }, xb = (e, t) => ({
	_tag: yb,
	first: e,
	second: t
}), Sb = (e, t) => Cb(t, yi(e)), Cb = (e, t) => {
	let n = e, r = t;
	for (; Ni(r);) {
		let e = Ii(r);
		switch (e._tag) {
			case gb:
				r = Li(r);
				break;
			case _b:
				n = n.zip(e.supervisor), r = Li(r);
				break;
			case vb:
				n = wb(n, e.supervisor), r = Li(r);
				break;
			case yb: r = ki(e.first)(ki(e.second)(Li(r)));
		}
	}
	return n;
}, wb = (e, t) => j(e, t) ? mb : db(e) ? wb(e.left, t).zip(wb(e.right, t)) : e, Tb = (e) => j(e, mb) ? zo() : db(e) ? x(Tb(e.left), qo(Tb(e.right))) : Vo(e), Eb = /*#__PURE__*/ hb({
	empty: bb,
	patch: Sb,
	combine: xb,
	diff: (e, t) => {
		if (j(e, t)) return bb;
		let n = Tb(e), r = Tb(t);
		return xb(x(r, Ko(n), Jo(bb, (e, t) => xb(e, {
			_tag: _b,
			supervisor: t
		}))), x(n, Ko(r), Jo(bb, (e, t) => xb(e, {
			_tag: vb,
			supervisor: t
		}))));
	}
}), Db = /*#__PURE__*/ eb("effect_fiber_started", { incremental: !0 }), Ob = /*#__PURE__*/ eb("effect_fiber_active"), kb = /*#__PURE__*/ eb("effect_fiber_successes", { incremental: !0 }), Ab = /*#__PURE__*/ eb("effect_fiber_failures", { incremental: !0 }), jb = /*#__PURE__*/ rb(/*#__PURE__*/ nb("effect_fiber_lifetimes", /*#__PURE__*/ Mv({
	start: .5,
	factor: 2,
	count: 35
})), "time_unit", "milliseconds"), Mb = "Continue", Nb = "Done", Pb = "Yield", Fb = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Ib = (e) => {
	throw Error(`BUG: FiberRuntime - ${mt(e)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, Lb = /*#__PURE__*/ Symbol.for("effect/internal/fiberRuntime/YieldedOp"), Rb = /*#__PURE__*/ S("effect/internal/fiberRuntime/yieldedOpChannel", () => ({ currentOp: null })), zb = {
	[Tt]: (e, t, n) => w(() => t.effect_instruction_i1(n)),
	OnStep: (e, t, n) => Z(Z(n)),
	[Et]: (e, t, n) => w(() => t.effect_instruction_i2(n)),
	[Pt]: (e, t, n) => (e.patchRuntimeFlags(e.currentRuntimeFlags, t.patch), ol(e.currentRuntimeFlags) && e.isInterrupted() ? X(e.getInterruptedCause()) : Z(n)),
	[At]: (e, t, n) => (w(() => t.effect_instruction_i2(n)), w(() => t.effect_instruction_i0()) ? (e.pushStack(t), w(() => t.effect_instruction_i1())) : Y),
	[jt]: (e, t, n) => {
		for (;;) {
			let r = w(() => t.effect_instruction_i0.next(n));
			if (r.done) return Z(r.value);
			let i = et(r.value);
			if (!Wf(i)) return e.pushStack(t), i;
			if (i._tag === "Failure") return i;
			n = i.value;
		}
	}
}, Bb = {
	[tv]: (e, t, n, r) => (e.processNewInterruptSignal(r.cause), ol(t) ? X(r.cause) : n),
	[rv]: (e, t, n, r) => {
		throw Error("It is illegal to have multiple concurrent run loops in a single fiber");
	},
	[nv]: (e, t, n, r) => (r.onFiber(e, Kg(t)), n),
	[iv]: (e, t, n, r) => W(Fd(), () => n)
}, Vb = (e) => vd(xl(e), (e) => rx(zl(e), ([e, t]) => {
	let n = /* @__PURE__ */ new Map(), r = [];
	for (let e of t) {
		r.push(Si(e));
		for (let t of e) n.set(t.request, t);
	}
	let i = r.flat();
	return nf(Ax(e.runAll(r), i, () => i.forEach((e) => {
		e.listeners.interrupted = !0;
	})), $_, n);
}, !1, !1)), Hb = /*#__PURE__*/ It(), Ub = class extends Nh {
	[mv] = hv;
	[_v] = Fb;
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
		if (super(), this.currentRuntimeFlags = n, this._fiberId = e, this._fiberRefs = t, dl(n)) {
			let e = this.getFiberRef(Sf);
			Db.unsafeUpdate(1, e), Ob.unsafeUpdate(1, e);
		}
		this.refreshRefCache();
	}
	commit() {
		return vv(this);
	}
	id() {
		return this._fiberId;
	}
	resume(e) {
		this.tell(sv(e));
	}
	get status() {
		return this.ask((e, t) => t);
	}
	get runtimeFlags() {
		return this.ask((e, t) => Jg(t) ? e.currentRuntimeFlags : t.runtimeFlags);
	}
	scope() {
		return fv(this);
	}
	get children() {
		return this.ask((e) => Array.from(e.getChildren()));
	}
	getChildren() {
		return this._children === null && (this._children = /* @__PURE__ */ new Set()), this._children;
	}
	getInterruptedCause() {
		return this.getFiberRef(wf);
	}
	fiberRefs() {
		return this.ask((e) => e.getFiberRefs());
	}
	ask(e) {
		return q(() => {
			let t = ap(this._fiberId);
			return this.tell(ov((n, r) => {
				fp(t, J(() => e(n, r)));
			})), cp(t);
		});
	}
	tell(e) {
		this._queue.push(e), this._running || (this._running = !0, this.drainQueueLaterOnExecutor());
	}
	get await() {
		return ed((e) => {
			let t = (t) => e(K(t));
			if (this._exitValue !== null) t(this._exitValue);
			else return this.tell(ov((e, n) => {
				e._exitValue === null ? e.addObserver(t) : t(this._exitValue);
			})), J(() => this.tell(ov((e, n) => {
				e.removeObserver(t);
			})));
		}, this.id());
	}
	get inheritAll() {
		return V((e, t) => {
			let n = e.id(), r = e.getFiberRefs(), i = t.runtimeFlags, a = sh(r, n, this.getFiberRefs());
			return e.setFiberRefs(a), Od(x(pl(i, e.getFiberRef(Dx)), vl(1), vl(16)));
		});
	}
	get poll() {
		return J(() => kn(this._exitValue));
	}
	unsafePoll() {
		return this._exitValue;
	}
	interruptAsFork(e) {
		return J(() => this.tell(av(Ql(e))));
	}
	unsafeInterruptAsFork(e) {
		this.tell(av(Ql(e)));
	}
	addObserver(e) {
		this._exitValue === null ? this._observers.push(e) : e(this._exitValue);
	}
	removeObserver(e) {
		this._observers = this._observers.filter((t) => t !== e);
	}
	getFiberRefs() {
		return this.setFiberRef(Dx, this.currentRuntimeFlags), this._fiberRefs;
	}
	unsafeDeleteFiberRef(e) {
		this._fiberRefs = uh(this._fiberRefs, e);
	}
	getFiberRef(e) {
		return this._fiberRefs.locals.has(e) ? this._fiberRefs.locals.get(e)[0][1] : e.initial;
	}
	setFiberRef(e, t) {
		this._fiberRefs = ph(this._fiberRefs, {
			fiberId: this._fiberId,
			fiberRef: e,
			value: t
		}), this.refreshRefCache();
	}
	refreshRefCache() {
		this.currentDefaultServices = this.getFiberRef(th), this.currentTracer = this.currentDefaultServices.unsafeMap.get(Jm.key), this.currentSupervisor = this.getFiberRef(Ox), this.currentScheduler = this.getFiberRef(Q_), this.currentContext = this.getFiberRef(df), this.currentSpan = this.currentContext.unsafeMap.get(Ym.key);
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
			let t = Mb, n = globalThis[yv];
			globalThis[yv] = this;
			try {
				for (; t === Mb;) t = this._queue.length === 0 ? Nb : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
			} finally {
				this._running = !1, globalThis[yv] = n;
			}
			this._queue.length > 0 && !this._running ? (this._running = !0, t === Pb ? (this.drainQueueLaterOnExecutor(), e = !1) : e = !0) : e = !1;
		}
	}
	drainQueueLaterOnExecutor() {
		this.currentScheduler.scheduleTask(this.run, this.getFiberRef(ff), this);
	}
	drainQueueWhileRunning(e, t) {
		let n = t;
		for (; this._queue.length > 0;) {
			let t = this._queue.splice(0, 1)[0];
			n = Bb[t._tag](this, e, n, t);
		}
		return n;
	}
	isInterrupted() {
		return !ru(this.getFiberRef(wf));
	}
	addInterruptedCause(e) {
		let t = this.getFiberRef(wf);
		this.setFiberRef(wf, eu(t, e));
	}
	processNewInterruptSignal(e) {
		this.addInterruptedCause(e), this.sendInterruptSignalToAllChildren();
	}
	sendInterruptSignalToAllChildren() {
		if (this._children === null || this._children.size === 0) return !1;
		let e = !1;
		for (let t of this._children) t.tell(av(Ql(this.id()))), e = !0;
		return e;
	}
	interruptAllChildren() {
		if (this.sendInterruptSignalToAllChildren()) {
			let e = this._children.values();
			this._children = null;
			let t = !1;
			return Ad({
				while: () => !t,
				body: () => {
					let n = e.next();
					return n.done ? J(() => {
						t = !0;
					}) : Xu(n.value.await);
				},
				step: () => {}
			});
		}
		return null;
	}
	reportExitValue(e) {
		if (dl(this.currentRuntimeFlags)) {
			let t = this.getFiberRef(Sf), n = this.id().startTimeMillis, r = Date.now();
			switch (jb.unsafeUpdate(r - n, t), Ob.unsafeUpdate(-1, t), e._tag) {
				case Dt:
					kb.unsafeUpdate(1, t);
					break;
				case Ct: Ab.unsafeUpdate(1, t);
			}
		}
		if (e._tag === "Failure") {
			let t = this.getFiberRef(bf);
			!au(e.cause) && t._tag === "Some" && this.log("Fiber terminated with an unhandled error", e.cause, t);
		}
	}
	setExitValue(e) {
		this._exitValue = e, this.reportExitValue(e);
		for (let t = this._observers.length - 1; t >= 0; t--) this._observers[t](e);
		this._observers = [];
	}
	getLoggers() {
		return this.getFiberRef(Jb);
	}
	log(e, t, n) {
		let r = Tn(n) ? n.value : this.getFiberRef(hf);
		if (Dh(this.getFiberRef(Wb), r)) return;
		let i = this.getFiberRef(gf), a = this.getFiberRef(mf), o = this.getLoggers(), s = this.getFiberRefs();
		if (Uo(o) > 0) {
			let n = ri(this.getFiberRef(th), Fp), c = new Date(n.unsafeCurrentTimeMillis());
			yt(s, () => {
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
			case iv: return Pb;
			case tv: return this.processNewInterruptSignal(e.cause), this._asyncInterruptor !== null && (this._asyncInterruptor(X(e.cause)), this._asyncInterruptor = null), Mb;
			case rv: return this._asyncInterruptor = null, this._asyncBlockingOn = null, this.evaluateEffect(e.effect), Mb;
			case nv: return e.onFiber(this, this._exitValue === null ? qg(this.currentRuntimeFlags, this._asyncBlockingOn) : Gg), Mb;
			default: return Ib(e);
		}
	}
	evaluateEffect(e) {
		this.currentSupervisor.onResume(this);
		try {
			let t = ol(this.currentRuntimeFlags) && this.isInterrupted() ? X(this.getInterruptedCause()) : e;
			for (; t !== null;) {
				let e = t, n = this.runLoop(e);
				if (n === Lb) {
					let e = Rb.currentOp;
					Rb.currentOp = null, e._op === "Yield" ? rl(this.currentRuntimeFlags) ? (this.tell(cv()), this.tell(sv(np)), t = null) : t = np : e._op === "Async" && (t = null);
				} else {
					this.currentRuntimeFlags = x(this.currentRuntimeFlags, al(16));
					let e = this.interruptAllChildren();
					e === null ? (this._queue.length === 0 ? this.setExitValue(n) : this.tell(sv(n)), t = null) : t = W(e, () => n);
				}
			}
		} finally {
			this.currentSupervisor.onSuspend(this);
		}
	}
	start(e) {
		if (this._running) this.tell(sv(e));
		else {
			this._running = !0;
			let t = globalThis[yv];
			globalThis[yv] = this;
			try {
				this.evaluateEffect(e);
			} finally {
				this._running = !1, globalThis[yv] = t, this._queue.length > 0 && this.drainQueueLaterOnExecutor();
			}
		}
	}
	startFork(e) {
		this.tell(sv(e));
	}
	patchRuntimeFlags(e, t) {
		let n = ml(e, t);
		return globalThis[yv] = this, this.currentRuntimeFlags = n, n;
	}
	initiateAsync(e, t) {
		let n = !1, r = (e) => {
			n || (n = !0, this.tell(sv(e)));
		};
		ol(e) && (this._asyncInterruptor = r);
		try {
			t(r);
		} catch (e) {
			r(U(Zl(e)));
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
		return J(() => ii(this.currentContext, e));
	}
	Left(e) {
		return H(e.left);
	}
	None(e) {
		return H(new Vf());
	}
	Right(e) {
		return Z(e.right);
	}
	Some(e) {
		return Z(e.value);
	}
	Micro(e) {
		return Qu((t) => {
			let n = t, r = K_(L_(e, this.currentContext));
			return r.addObserver((e) => {
				if (e._tag === "Success") return n(Z(e.value));
				switch (e.cause._tag) {
					case "Interrupt": return n(X(Ql(ms)));
					case "Fail": return n(H(e.cause.error));
					case "Die": return n(id(e.cause.defect));
				}
			}), Qu((e) => {
				n = (t) => {
					e(Y);
				}, r.unsafeInterrupt();
			});
		});
	}
	[Ot](e) {
		let t = w(() => e.effect_instruction_i0()), n = this.getNextSuccessCont();
		return n === void 0 ? (Rb.currentOp = Z(t), Lb) : (n._op in zb || Ib(n), zb[n._op](this, n, t));
	}
	[Dt](e) {
		let t = e, n = this.getNextSuccessCont();
		return n === void 0 ? (Rb.currentOp = t, Lb) : (n._op in zb || Ib(n), zb[n._op](this, n, t.effect_instruction_i0));
	}
	[Ct](e) {
		let t = e.effect_instruction_i0, n = this.getNextFailCont();
		if (n !== void 0) switch (n._op) {
			case wt:
			case Et: return ol(this.currentRuntimeFlags) && this.isInterrupted() ? X(fu(t)) : w(() => n.effect_instruction_i1(t));
			case "OnStep": return ol(this.currentRuntimeFlags) && this.isInterrupted() ? X(fu(t)) : Z(X(t));
			case Pt: return this.patchRuntimeFlags(this.currentRuntimeFlags, n.patch), ol(this.currentRuntimeFlags) && this.isInterrupted() ? X(eu(t, this.getInterruptedCause())) : X(t);
			default: Ib(n);
		}
		else return Rb.currentOp = X(t), Lb;
	}
	[Mt](e) {
		return w(() => e.effect_instruction_i0(this, Kg(this.currentRuntimeFlags)));
	}
	Blocked(e) {
		let t = this.getFiberRefs(), n = this.currentRuntimeFlags;
		if (this._steps.length > 0) {
			let r = [], i = this._steps[this._steps.length - 1], a = this.popStack();
			for (; a && a._op !== "OnStep";) r.push(a), a = this.popStack();
			this.setFiberRefs(i.refs), this.currentRuntimeFlags = i.flags;
			let o = kg(i.refs, t), s = pl(i.flags, n);
			return Z(Vu(e.effect_instruction_i0, V((t) => {
				for (; r.length > 0;) t.pushStack(r.pop());
				return t.setFiberRefs(Ag(t.id(), t.getFiberRefs())(o)), t.currentRuntimeFlags = ml(s)(t.currentRuntimeFlags), e.effect_instruction_i1;
			})));
		}
		return Dd((t) => W(ax(Hu(e.effect_instruction_i0)), () => t(e.effect_instruction_i1)));
	}
	RunBlocked(e) {
		return Vb(e.effect_instruction_i0);
	}
	[kt](e) {
		let t = e.effect_instruction_i0, n = this.currentRuntimeFlags, r = ml(n, t);
		if (ol(r) && this.isInterrupted()) return X(this.getInterruptedCause());
		if (this.patchRuntimeFlags(this.currentRuntimeFlags, t), e.effect_instruction_i1) {
			let t = pl(r, n);
			return this.pushStack(new Wu(t, e)), w(() => e.effect_instruction_i1(n));
		}
		return np;
	}
	[Tt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	OnStep(e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[wt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[Et](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[xt](e) {
		return this._asyncBlockingOn = e.effect_instruction_i1, this.initiateAsync(this.currentRuntimeFlags, e.effect_instruction_i0), Rb.currentOp = e, Lb;
	}
	[Nt](e) {
		return this._isYielding = !1, Rb.currentOp = e, Lb;
	}
	[At](e) {
		let t = e.effect_instruction_i0, n = e.effect_instruction_i1;
		return t() ? (this.pushStack(e), n()) : np;
	}
	[jt](e) {
		return zb[jt](this, e, void 0);
	}
	[St](e) {
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
					t = W(Fd({ priority: e }), () => n);
				}
			}
			try {
				if (t = this.currentTracer.context(() => {
					if (Hb !== t[Uu]._V) {
						let e = this.getFiberRef(xf);
						if (e._tag === "Some") {
							let n = t[Uu]._V;
							this.log(`Executing an Effect versioned ${n} with a Runtime of version ${It()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, Yl, e);
						}
					}
					return this[t._op](t);
				}, this), t === Lb) {
					let e = Rb.currentOp;
					return e._op === "Yield" || e._op === "Async" ? Lb : (Rb.currentOp = null, e._op === "Success" || e._op === "Failure" ? e : X(Zl(e)));
				}
			} catch (e) {
				t = t !== Lb && !C(t, "_op") || !(t._op in this) ? ad(`Not a valid effect: ${mt(t)}`) : zf(e) ? X(eu(Zl(e), Ql(ms))) : id(e);
			}
		}
	}
	run = () => {
		this.drainQueueOnCurrentThread();
	};
}, Wb = /*#__PURE__*/ S("effect/FiberRef/currentMinimumLogLevel", () => af(Oh("Info"))), Gb = (e) => Sv((t) => {
	ri(gh(t.context, th), Rm).unsafe.log(e.log(t));
}), Kb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Logger/defaultLogger"), () => Gb(wv)), qb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Logger/tracerLogger"), () => Sv(({ annotations: e, cause: t, context: n, fiberId: r, logLevel: i, message: a }) => {
	let o = _g(ai(fh(n, df), Ym));
	if (o._tag === "None" || o.value._tag === "ExternalSpan") return;
	let s = ii(fh(n, th), Fp), c = {};
	for (let [t, n] of e) c[t] = n;
	c["effect.fiberId"] = gs(r), c["effect.logLevel"] = i.label, t !== null && t._tag !== "Empty" && (c["effect.cause"] = Tu(t, { renderErrorCause: !0 })), o.value.event(mt(Array.isArray(a) && a.length === 1 ? a[0] : a), s.unsafeCurrentTimeNanos(), c);
})), Jb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLoggers"), () => of(Vo(Kb, qb))), Yb = /*#__PURE__*/ y((e) => qu(e[0]), (e, t) => Ed(wd(e, (e) => Xb((n) => t(e, n))))), Xb = (e) => V((t) => {
	let n = t.getFiberRefs(), r = il(t.currentRuntimeFlags, 1);
	return W(yx, (t) => Of(t, (t) => V((i) => {
		let a = i.getFiberRefs(), o = i.currentRuntimeFlags, s = kg(a, n), c = pl(o, r), l = kg(n, a);
		return i.setFiberRefs(Ag(s, i.id(), n)), kx(Pd(e(t), c), J(() => {
			i.setFiberRefs(Ag(l, i.id(), i.getFiberRefs()));
		}));
	})));
}), Zb = (e) => {
	if (Array.isArray(e) || ze(e)) return [e, I()];
	let t = Object.keys(e), n = t.length;
	return [t.map((t) => e[t]), L((e) => {
		let r = {};
		for (let i = 0; i < n; i++) r[t[i]] = e[i];
		return r;
	})];
}, Qb = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(od(t));
	return W(tx(r, b, {
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
}, $b = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(od(t));
	return n?.discard ? tx(r, b, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		discard: !0,
		concurrentFinalizers: n?.concurrentFinalizers
	}) : G(tx(r, b, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => t._tag === "Some" ? t.value(e) : e);
}, ex = (e, t) => {
	let [n, r] = Zb(e);
	return t?.mode === "validate" ? Qb(n, r, t) : t?.mode === "either" ? $b(n, r, t) : t?.discard !== !0 && r._tag === "Some" ? G(tx(n, b, t), r.value) : tx(n, b, t);
}, tx = /*#__PURE__*/ y((e) => ze(e[0]), (e, t, n) => V((r) => {
	let i = n?.batching === !0 || n?.batching === "inherit" && r.getFiberRef(yf);
	return n?.discard ? ev(n.concurrency, () => fx(Eg, n?.concurrentFinalizers)((n) => i ? rx(e, (e, r) => n(t(e, r)), !0, !1, 1) : vd(e, (e, r) => n(t(e, r)))), () => fx(Dg, n?.concurrentFinalizers)((n) => rx(e, (e, r) => n(t(e, r)), i, !1)), (r) => fx(Og(r), n?.concurrentFinalizers)((n) => rx(e, (e, r) => n(t(e, r)), i, !1, r))) : ev(n?.concurrency, () => fx(Eg, n?.concurrentFinalizers)((n) => i ? ix(e, 1, (e, r) => n(t(e, r)), !0) : _d(e, (e, r) => n(t(e, r)))), () => fx(Dg, n?.concurrentFinalizers)((n) => nx(e, (e, r) => n(t(e, r)), i)), (r) => fx(Og(r), n?.concurrentFinalizers)((n) => ix(e, r, (e, r) => n(t(e, r)), i)));
})), nx = (e, t, n) => q(() => {
	let r = R(e), i = Array(r.length);
	return Rd(rx(r, (e, n) => W(t(e, n), (e) => J(() => i[n] = e)), n, !1), K(i));
}), rx = (e, t, n, r, i) => Dd((a) => Td((o) => V((s) => {
	let c = Array.from(e).reverse(), l = c.length;
	if (l === 0) return Y;
	let u = 0, d = !1, f = i ? Math.min(c.length, i) : c.length, p = /* @__PURE__ */ new Set(), ee = [], m = () => p.forEach((e) => {
		e.currentScheduler.scheduleTask(() => {
			e.unsafeInterruptAsFork(s.id());
		}, 0, e);
	}), te = [], ne = [], h = [], re = () => {
		let e = ee.filter(({ exit: e }) => e._tag === "Failure").sort((e, t) => e.index < t.index ? -1 : e.index === t.index ? 0 : 1).map(({ exit: e }) => e);
		return e.length === 0 && e.push(np), e;
	}, g = (e, t = !1) => {
		let n = Ed(o(e)), r = sx(n, s, s.currentRuntimeFlags, pv);
		return s.currentScheduler.scheduleTask(() => {
			t && r.unsafeInterruptAsFork(s.id()), r.resume(n);
		}, 0, r), r;
	}, _ = () => {
		r || (l -= c.length, c = []), d = !0, m();
	}, ie = n ? fd : sd, ae = g(ed((e) => {
		let r = (e, t) => {
			e._op === "Blocked" ? h.push(e) : (ee.push({
				index: t,
				exit: e
			}), e._op === "Failure" && !d && _());
		}, o = () => {
			if (c.length > 0) {
				let f = c.pop(), m = u++, _ = () => {
					let e = c.pop();
					return m = u++, W(Fd(), () => W(ie(a(t(e, m))), ae));
				}, ae = (e) => c.length > 0 && (r(e, m), c.length > 0) ? _() : K(e), oe = W(ie(a(t(f, m))), ae), se = g(oe);
				te.push(se), p.add(se), d && se.currentScheduler.scheduleTask(() => {
					se.unsafeInterruptAsFork(s.id());
				}, 0, se), se.addObserver((t) => {
					let a;
					if (a = t._op === "Failure" ? t : t.effect_instruction_i0, ne.push(se), p.delete(se), r(a, m), ee.length === l) e(K(Dn(Yf(re(), { parallel: !0 }), () => np)));
					else if (h.length + ee.length === l) {
						let t = re();
						e(K(Vu(h.map((e) => e.effect_instruction_i0).reduce(yl), rx([Dn(Yf(t, { parallel: !0 }), () => np), ...h.map((e) => e.effect_instruction_i1)], (e) => e, n, !0, i))));
					} else o();
				});
			}
		};
		for (let e = 0; e < f; e++) o();
	}));
	return Xu(Sd(pd(a(vv(ae))), ep({
		onFailure: (e) => {
			_();
			let t = h.length + 1, n = Math.min(typeof i == "number" ? i : h.length, h.length), r = Array.from(h);
			return ed((i) => {
				let a = [], o = 0, s = 0, c = (n, s) => (c) => {
					a[n] = c, o++, o === t && i(Z(X(e))), r.length > 0 && s && l();
				}, l = () => {
					g(r.pop(), !0).addObserver(c(s, !0)), s++;
				};
				ae.addObserver(c(s, !1)), s++;
				for (let e = 0; e < n; e++) l();
			});
		},
		onSuccess: () => _d(ne, (e) => e.inheritAll)
	})));
}))), ix = (e, t, n, r) => q(() => {
	let i = R(e), a = Array(i.length);
	return Rd(rx(i, (e, t) => G(n(e, t), (e) => a[t] = e), r, !1, t), K(a));
}), ax = (e) => lx(e, pv), ox = (e, t, n, r = null) => {
	let i = cx(e, t, n, r);
	return i.resume(e), i;
}, sx = (e, t, n, r = null) => cx(e, t, n, r), cx = (e, t, n, r = null) => {
	let i = _s(), a = ch(t.getFiberRefs(), i), o = new Ub(i, a, n), s = fh(a, df), c = o.currentSupervisor;
	return c.onStart(s, e, L(t), o), o.addObserver((e) => c.onEnd(e, o)), (r === null ? x(t.getFiberRef(Cf), Dn(() => t.scope())) : r).add(n, o), o;
}, lx = (e, t) => V((n, r) => K(ox(e, n, r.runtimeFlags, t))), ux = (e) => gp((t) => En(ai(t, vx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Parallel": return e;
			case "Sequential":
			case "ParallelN": return W(Af(t, Dg), (t) => wx(e, t));
		}
	}
})), dx = (e) => (t) => gp((n) => En(ai(n, vx), {
	onNone: () => t,
	onSome: (n) => n.strategy._tag === "ParallelN" && n.strategy.parallelism === e ? t : W(Af(n, Og(e)), (e) => wx(t, e))
})), fx = (e, t) => (n) => gp((r) => En(ai(r, vx), {
	onNone: () => n(b),
	onSome: (r) => {
		if (t === !0) {
			let t = e._tag === "Parallel" ? ux : e._tag === "Sequential" ? gx : dx(e.parallelism);
			switch (r.strategy._tag) {
				case "Parallel": return t(n(ux));
				case "Sequential": return t(n(gx));
				case "ParallelN": return t(n(dx(r.strategy.parallelism)));
			}
		} else return n(b);
	}
})), px = (e) => W(vx, e), mx = (e) => W(Cx(), (t) => Sd(e(t), (e) => t.close(e))), hx = (e) => W(Cx(), (t) => Tx(e, t)), gx = (e) => gp((t) => En(ai(t, vx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Sequential": return e;
			case "Parallel":
			case "ParallelN": return W(Af(t, Eg), (t) => wx(e, t));
		}
	}
})), _x = /*#__PURE__*/ y((e) => qu(e[1]), (e, t, n, r) => G(ex([e, t], {
	concurrency: r?.concurrent ? 2 : 1,
	batching: r?.batching,
	concurrentFinalizers: r?.concurrentFinalizers
}), ([e, t]) => n(e, t))), vx = /*#__PURE__*/ Zr("effect/Scope"), yx = vx, bx = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.set({}, t);
}, xx = {
	[Tf]: Tf,
	[Ef]: Ef,
	pipe() {
		return F(this, arguments);
	},
	fork(e) {
		return J(() => {
			let t = Sx(e);
			if (this.state._tag === "Closed") return t.state = this.state, t;
			let n = {};
			return this.state.finalizers.set(n, (e) => t.close(e)), bx(t, (e) => J(() => {
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
			}, t.length === 0 ? Y : wg(this.strategy) ? x(_d(t, (t) => sd(t(e))), W((e) => x(Yf(e), jn(Jf), Dn(() => np)))) : Tg(this.strategy) ? x(nx(t, (t) => sd(t(e)), !1), W((e) => x(Yf(e, { parallel: !0 }), jn(Jf), Dn(() => np)))) : x(ix(t, this.strategy.parallelism, (t) => sd(t(e)), !1), W((e) => x(Yf(e, { parallel: !0 }), jn(Jf), Dn(() => np))));
		});
	},
	addFinalizer(e) {
		return q(() => this.state._tag === "Closed" ? e(this.state.exit) : (this.state.finalizers.set({}, e), Y));
	}
}, Sx = (e = xg) => {
	let t = Object.create(xx);
	return t.strategy = e, t.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map()
	}, t;
}, Cx = (e = xg) => J(() => Sx(e)), wx = /*#__PURE__*/ y(2, (e, t) => yp(e, oi(ti(vx, t)))), Tx = /*#__PURE__*/ y(2, (e, t) => x(e, wx(t), Sd((e) => t.close(e)))), Ex = (e) => lf(e, {
	differ: Eb,
	fork: bb
}), Dx = /*#__PURE__*/ uf(ul), Ox = /*#__PURE__*/ Ex(mb), kx = /*#__PURE__*/ y(2, (e, t) => Dd((n) => hd(n(e), {
	onFailure: (e) => hd(t, {
		onFailure: (t) => U(eu(e, t)),
		onSuccess: () => U(e)
	}),
	onSuccess: (e) => Yu(t, e)
}))), Ax = (e, t, n) => dd((r) => kx(W(ax(yd(e)), (e) => ed((r) => {
	let i = t.map((e) => e.listeners.count), a = () => {
		i.every((e) => e === 0) && t.every((e) => !!(e.result.state.current._tag === "Pending" || e.result.state.current._tag === "Done" && Wf(e.result.state.current.effect) && e.result.state.current.effect._tag === "Failure" && iu(e.result.state.current.effect.cause))) && (o.forEach((e) => e()), n?.(), r(Bd(e)));
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
})), q(() => vd(t.flatMap((e) => e.state.completed ? [] : [e]), (e) => ob(e.request, Qf(r)))))), jx = lu, Mx = jf, Nx = Df, Px = kf, Fx = wx, Ix = Af, Lx = Cx, Rx = class {
	permits;
	waiters = /*#__PURE__*/ new Set();
	taken = 0;
	constructor(e) {
		this.permits = e;
	}
	get free() {
		return this.permits - this.taken;
	}
	take = (e) => $u((t) => {
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
		return this.taken = t(this.taken), this.waiters.size > 0 && e.getFiberRef(Q_).scheduleTask(() => {
			let e = this.waiters.values(), t = e.next();
			for (; t.done === !1 && this.free > 0;) t.value(), t = e.next();
		}, e.getFiberRef(ff), e), K(this.free);
	}
	updateTaken(e) {
		return V((t) => this.updateTakenUnsafe(t, e));
	}
	resize = (e) => Xu(V((t) => (this.permits = e, this.free < 0 ? Y : this.updateTakenUnsafe(t, (e) => e))));
	release = (e) => this.updateTaken((t) => t - e);
	releaseAll = /*#__PURE__*/ this.updateTaken((e) => 0);
	withPermits = (e) => (t) => Dd((n) => W(n(this.take(e)), (e) => kx(n(t), this.release(e))));
	withPermitsIfAvailable = (e) => (t) => Dd((n) => q(() => this.free < e ? fg : (this.taken += e, kx(n(rg(t)), this.release(e)))));
}, zx = (e) => new Rx(e), Bx = /*#__PURE__*/ Symbol.for("effect/Ref/SynchronizedRef"), Vx = {
/* c8 ignore next */
_A: (e) => e }, Hx = class extends Nh {
	ref;
	withLock;
	[Bx] = Vx;
	[Fh] = Ih;
	[Ph] = Ph;
	constructor(e, t) {
		super(), this.ref = e, this.withLock = t, this.get = Bh(this.ref);
	}
	get;
	commit() {
		return this.get;
	}
	modify(e) {
		return this.modifyEffect((t) => K(e(t)));
	}
	modifyEffect(e) {
		return this.withLock(x(W(Bh(this.ref), e), W(([e, t]) => Yu(Vh(this.ref, t), e))));
	}
}, Ux = (e) => J(() => Wx(e)), Wx = (e) => new Hx(Rh(e), zx(1).withPermits(1)), Gx = /*#__PURE__*/ Symbol.for("effect/ManagedRuntime"), Kx = "Fresh", qx = "FromEffect", Jx = "MergeAll", Yx = (e) => function() {
	if (arguments.length === 1) {
		let t = arguments[0];
		return (n, ...r) => e(t, n, ...r);
	}
	return e.apply(this, arguments);
}, Xx = /*#__PURE__*/ Yx((e, t, n) => {
	let r = _s(), i = [[df, [[r, e.context]]]];
	n?.scheduler && i.push([Q_, [[r, n.scheduler]]]);
	let a = _h(e.fiberRefs, {
		entries: i,
		forkAs: r
	});
	n?.updateRefs && (a = n.updateRefs(a, r));
	let o = new Ub(r, a, e.runtimeFlags), s = t;
	n?.scope && (s = W(Ix(n.scope, xg), (e) => Rd(Df(e, dd((e) => j(e, o.id()) ? Y : Vd(o, e))), Sd(t, (t) => Px(e, t)))));
	let c = o.currentSupervisor;
	return c !== mb && (c.onStart(e.context, s, I(), o), o.addObserver((e) => c.onEnd(e, o))), pv.add(e.runtimeFlags, o), n?.immediate === !1 ? o.resume(s) : o.start(s), o;
}), Zx = /*#__PURE__*/ Yx((e, t) => {
	let n = aS(e)(t);
	if (n._tag === "Failure") throw rS(n.effect_instruction_i0);
	return n.effect_instruction_i0;
}), Qx = class extends Error {
	fiber;
	_tag = "AsyncFiberException";
	constructor(e) {
		super(`Fiber #${e.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`), this.fiber = e, this.name = this._tag, this.stack = this.message;
	}
}, $x = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new Qx(e);
	return Error.stackTraceLimit = t, n;
}, eS = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure"), tS = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure/Cause"), nS = class extends Error {
	[eS];
	[tS];
	constructor(e) {
		let t = Nu(e)[0];
		super(t?.message || "An error has occurred"), this[eS] = eS, this[tS] = e, this.name = t ? `(FiberFailure) ${t.name}` : "FiberFailure", t?.stack && (this.stack = t.stack);
	}
	toJSON() {
		return {
			_id: "FiberFailure",
			cause: this[tS].toJSON()
		};
	}
	toString() {
		return "(FiberFailure) " + Tu(this[tS], { renderErrorCause: !0 });
	}
	[M]() {
		return this.toString();
	}
}, rS = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new nS(e);
	return Error.stackTraceLimit = t, n;
}, iS = (e) => {
	let t = e;
	switch (t._op) {
		case "Failure":
		case "Success": return t;
		case "Left": return Zf(t.left);
		case "Right": return Z(t.right);
		case "Some": return Z(t.value);
		case "None": return Zf(new Vf());
	}
}, aS = /*#__PURE__*/ Yx((e, t) => {
	let n = iS(t);
	if (n) return n;
	let r = new Z_(), i = Xx(e)(t, { scheduler: r });
	return r.flush(), i.unsafePoll() || Xf(rd($x(i), bp(i)));
}), oS = /*#__PURE__*/ Yx((e, t, n) => sS(e, t, n).then((e) => {
	switch (e._tag) {
		case Dt: return e.effect_instruction_i0;
		case Ct: throw rS(e.effect_instruction_i0);
	}
})), sS = /*#__PURE__*/ Yx((e, t, n) => new Promise((r) => {
	let i = iS(t);
	i && r(i);
	let a = Xx(e)(t);
	a.addObserver((e) => {
		r(e);
	}), n?.signal !== void 0 && (n.signal.aborted ? a.unsafeInterruptAsFork(a.id()) : n.signal.addEventListener("abort", () => {
		a.unsafeInterruptAsFork(a.id());
	}, { once: !0 }));
})), cS = class {
	context;
	runtimeFlags;
	fiberRefs;
	constructor(e, t, n) {
		this.context = e, this.runtimeFlags = t, this.fiberRefs = n;
	}
	pipe() {
		return F(this, arguments);
	}
}, lS = /*#__PURE__*/ ((e) => new cS(e.context, e.runtimeFlags, e.fiberRefs))({
	context: /*#__PURE__*/ ei(),
	runtimeFlags: /* @__PURE__ */ ll(1, 32, 4),
	fiberRefs: /*#__PURE__*/ vh()
}), uS = /*#__PURE__*/ oS(lS), dS = /*#__PURE__*/ sS(lS), fS = /*#__PURE__*/ Zx(lS), pS = /*#__PURE__*/ y(2, (e, t) => e.modifyEffect(t)), mS = /*#__PURE__*/ Symbol.for("effect/Layer"), hS = {
	/* c8 ignore next */
	_RIn: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_ROut: (e) => e
}, gS = {
	[mS]: hS,
	pipe() {
		return F(this, arguments);
	}
}, _S = /*#__PURE__*/ Symbol.for("effect/Layer/MemoMap"), vS = /*#__PURE__*/ li()("effect/Layer/CurrentMemoMap", { defaultValue: () => CS() }), yS = (e) => C(e, mS), bS = (e) => e._op_layer === Kx, xS = class {
	ref;
	[_S];
	constructor(e) {
		this.ref = e, this[_S] = _S;
	}
	getOrElseMemoize(e, t) {
		return x(pS(this.ref, (n) => {
			let r = n.get(e);
			if (r !== void 0) {
				let [e, i] = r;
				return K([x(e, W(([e, t]) => x(lg(e), Yu(t))), Sd(ep({
					onFailure: () => Y,
					onSuccess: () => Of(t, i)
				}))), n]);
			}
			return x(zh(0), W((r) => x(op(), W((i) => x(zh(() => Y), G((a) => {
				let o = Dd((o) => x(Cx(), W((s) => x(o(W(ES(e, s, !0), (e) => ag(e(this)))), sd, W((o) => {
					switch (o._tag) {
						case Ct: return x(up(i, o.effect_instruction_i0), Rd(kf(s, o)), Rd(U(o.effect_instruction_i0)));
						case Dt: return x(Vh(a, (e) => x(kf(s, e), kd(Hh(r, (e) => [e === 1, e - 1])), Xu)), Rd(Uh(r, (e) => e + 1)), Rd(Of(t, (t) => x(J(() => n.delete(e)), Rd(Bh(a)), W((e) => e(t))))), Rd(dp(i, o.effect_instruction_i0)), Yu(o.effect_instruction_i0[1]));
					}
				}))))), s = [x(cp(i), Sd(tp({
					onFailure: () => Y,
					onSuccess: () => Uh(r, (e) => e + 1)
				}))), (e) => x(Bh(a), W((t) => t(e)))];
				return [o, bS(e) ? n : n.set(e, s)];
			}))))));
		}), pd);
	}
}, SS = /*#__PURE__*/ q(() => G(Ux(/* @__PURE__ */ new Map()), (e) => new xS(e))), CS = () => new xS(Wx(/* @__PURE__ */ new Map())), wS = /*#__PURE__*/ y(2, (e, t) => W(SS, (n) => TS(e, n, t))), TS = /*#__PURE__*/ y(3, (e, t, n) => W(ES(e, n), (e) => dg(e(t), vS, t))), ES = (e, t, n = !1) => {
	let r = e;
	switch (r._op_layer) {
		case "Locally": return J(() => (e) => r.f(e.getOrElseMemoize(r.self, t)));
		case "ExtendScope": return J(() => (e) => px((t) => e.getOrElseMemoize(r.layer, t)));
		case "Fold": return J(() => (e) => x(e.getOrElseMemoize(r.layer, t), hd({
			onFailure: (n) => e.getOrElseMemoize(r.failureK(n), t),
			onSuccess: (n) => e.getOrElseMemoize(r.successK(n), t)
		})));
		case "Fresh": return J(() => (e) => x(r.layer, wS(t)));
		case "FromEffect": return J(n ? () => (e) => r.effect : () => (n) => n.getOrElseMemoize(e, t));
		case "Provide": return J(() => (e) => x(e.getOrElseMemoize(r.first, t), W((n) => x(e.getOrElseMemoize(r.second, t), _p(n)))));
		case "Scoped": return J(n ? () => (e) => wx(r.effect, t) : () => (n) => n.getOrElseMemoize(e, t));
		case "Suspend": return J(() => (e) => e.getOrElseMemoize(r.evaluate(), t));
		case "ProvideMerge": return J(() => (e) => x(e.getOrElseMemoize(r.first, t), zd(e.getOrElseMemoize(r.second, t), r.zipK)));
		case "ZipWith": return Md(function* () {
			let e = yield* Af(t, Sg), n = yield* Af(e, xg), i = yield* Af(e, xg);
			return (e) => x(e.getOrElseMemoize(r.first, n), _x(e.getOrElseMemoize(r.second, i), r.zipK, { concurrent: !0 }));
		});
		case "MergeAll": {
			let e = r.layers;
			return G(Af(t, Sg), (t) => (n) => {
				let r = Array(e.length);
				return G(rx(e, Nd(function* (e, i) {
					let a = yield* Af(t, xg), o = yield* n.getOrElseMemoize(e, a);
					r[i] = o;
				}), !1, !1), () => si(...r));
			});
		}
	}
};
function DS(e) {
	let t = Object.create(gS);
	return t._op_layer = qx, t.effect = e, t;
}
var OS = (...e) => {
	let t = Object.create(gS);
	return t._op_layer = Jx, t.layers = e, t;
}, kS = /*#__PURE__*/ y(2, (e, t) => {
	let n = $r(e);
	return DS(K(ti(n ? e : t, n ? t : e)));
}), AS = /*#__PURE__*/ y(2, (e, t) => mx((n) => W(wS(t, n), (t) => vp(e, t)))), jS = /*#__PURE__*/ y(2, (e, t) => {
	let n = kg(lS.fiberRefs, t.fiberRefs), r = pl(lS.runtimeFlags, t.runtimeFlags);
	return Dd((i) => V((a) => {
		let o = a.getFiberRef(df), s = a.getFiberRefs(), c = Ag(a.id(), s)(n), l = a.currentRuntimeFlags, u = ml(r)(l), d = kg(c, s), f = pl(u, l);
		return a.setFiberRefs(c), a.currentRuntimeFlags = u, kx(vp(i(e), oi(o, t.context)), V((e) => (e.setFiberRefs(Ag(e.id(), e.getFiberRefs())(d)), e.currentRuntimeFlags = ml(f)(e.currentRuntimeFlags), Y)));
	}));
}), MS = /*#__PURE__*/ y(2, (e, t) => Array.isArray(t) ? AS(e, OS(...t)) : yS(t) ? AS(e, t) : Qr(t) ? vp(e, t) : Gx in t ? W(t.runtimeEffect, (t) => jS(e, t)) : jS(e, t)), NS = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return { BaseEffectError: class extends Nf {
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
}(), PS = (e) => {
	let t = { BaseEffectError: class extends NS {
		_tag = e;
	} };
	return t.BaseEffectError.prototype.name = e, t.BaseEffectError;
}, FS = H, IS = Md, LS = ug, RS = K, zS = q, BS = J, VS = Y, HS = td, US = cg, WS = ig, GS = hg, KS = Yu, qS = Yb, JS = kx, YS = hx, XS = MS, ZS = wd, QS = mg, $S = gd, eC = uS, tC = dS, nC = fS, rC = class extends PS("AuthenticationFailure") {};
function iC(e) {
	return GS({
		try: e.command,
		catch: (e) => new rC({ cause: e })
	}).pipe(JS(LS(() => e.reconcile?.() ?? Promise.resolve())));
}
async function aC(e) {
	let t = await tC(e);
	if (Sp(t)) return t.value;
	let n = jx(t.cause);
	throw Tn(n) ? n.value.cause : Mx(t.cause);
}
// src/app/services/queries/configuration.ts
function oC(e, t, n, r, i) {
	return t ? {
		queryKey: v.sshBrowse(t, n ?? "", i),
		queryFn: ({ signal: r }) => e.browseSshPath(t, n, i, r)
	} : {
		queryKey: v.browse(n ?? "", r, i),
		queryFn: ({ signal: t }) => e.browsePath(n, r, i, t)
	};
}
function sC(e, t, n, i) {
	let { api: a } = r();
	return g({
		...oC(a, null, e, t, n),
		enabled: i,
		staleTime: 2e3,
		retry: !1
	});
}
function cC(e, t, n, i) {
	let { api: a } = r();
	return g({
		...oC(a, e ?? { ssh_host: "" }, t, "directory", n),
		enabled: i && !!e?.ssh_host,
		staleTime: 2e3,
		retry: !1
	});
}
function lC() {
	let { api: e } = r();
	return u((t, n, r, i) => oC(e, t, n, r, i).queryFn({ signal: new AbortController().signal }), [e]);
}
function uC() {
	let { api: e } = r(), t = _();
	return u(async (n, r, i) => {
		try {
			return await (n ? e.createSshFolder(n, r, i) : e.createFolder(r, i));
		} finally {
			t.invalidateQueries({ queryKey: [n ? "ssh-browse" : "fs-browse"] });
		}
	}, [e, t]);
}
function dC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.browseSshPath(t, null),
		onSuccess: (e, n) => {
			t.setQueryData(v.sshBrowse(n, "", !1), e);
		}
	});
}
function fC() {
	let { api: e } = r();
	return g({
		queryKey: v.sshConfigs,
		queryFn: ({ signal: t }) => e.listSshConfigs(t),
		staleTime: 3e4,
		retry: !1
	});
}
function pC(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: v.sshAliases,
		queryFn: ({ signal: e }) => t.listSshAliases(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function mC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.createSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
function hC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ configId: t, payload: n }) => e.updateSshConfig(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
function gC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
var _C = 3e5;
function vC() {
	let { api: e } = r();
	return g({
		queryKey: v.mcpLibrary,
		queryFn: ({ signal: t }) => e.getMcpLibrary(t),
		staleTime: _C,
		retry: !1
	});
}
function yC() {
	let { api: e } = r();
	return g({
		queryKey: v.mcpServers,
		queryFn: ({ signal: t }) => e.listMcpServers(t),
		staleTime: 3e4,
		retry: !1
	});
}
function bC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.createMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function xC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ serverName: t, payload: n }) => e.updateMcpServer(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function SC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function CC() {
	let { api: e } = r();
	return h({ mutationFn: (t) => e.testMcpServer(t) });
}
function wC() {
	let { api: e } = r();
	return g({
		queryKey: v.mcpRuntime,
		queryFn: ({ signal: t }) => e.listMcpRuntimeStatus(t),
		staleTime: 5e3,
		retry: !1
	});
}
function TC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ serverName: t, action: n }) => n === "connect" ? e.connectMcpServer(t) : n === "disconnect" ? e.disconnectMcpServer(t) : e.reloadMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function EC(e = !0) {
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
async function DC(e) {
	await Promise.all([e.resetQueries({ queryKey: v.managedProviderModelsAll }), e.invalidateQueries({ queryKey: v.modelCatalog })]);
}
async function OC(e) {
	await Promise.all([
		e.invalidateQueries({ queryKey: v.managedAuth }),
		e.invalidateQueries({ queryKey: v.managedHostStatus }),
		DC(e)
	]);
}
function kC(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sessionCommands(e),
		queryFn: ({ signal: n }) => t.listSessionCommands(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function AC(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sessionSkills(e),
		queryFn: ({ signal: n }) => t.listSessionSkills(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
// src/app/services/queries/host.ts
function jC() {
	let { api: e } = r();
	return g({
		queryKey: v.storeInfo,
		queryFn: ({ signal: t }) => e.getStore(t),
		staleTime: Infinity
	});
}
function MC(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sandboxAvailability,
		queryFn: ({ signal: e }) => t.getSandboxAvailability(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function NC(e) {
	let { api: t } = r();
	return g({
		queryKey: [...v.sandboxActivity, e],
		queryFn: ({ signal: n }) => e ? t.getSandboxActivity(e, n) : null,
		enabled: e !== null,
		refetchInterval: 1e3,
		retry: !1
	});
}
function PC(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: v.credentials,
		queryFn: ({ signal: e }) => t.listCredentials(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function FC() {
	let { api: e } = r(), t = _();
	return h({
		gcTime: 0,
		mutationFn: ({ name: t, value: n }) => e.storeCredential(t, n),
		onSuccess: async () => {
			await Promise.all([t.invalidateQueries({ queryKey: v.credentials }), DC(t)]);
		}
	});
}
function IC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteCredential(t),
		onSuccess: async () => {
			await Promise.all([t.invalidateQueries({ queryKey: v.credentials }), DC(t)]);
		}
	});
}
function LC() {
	let { api: e } = r(), t = _();
	return h({
		retry: !1,
		mutationFn: (n) => aC(iC({
			command: () => e.managedLogout(n),
			reconcile: () => OC(t)
		}))
	});
}
// src/app/services/queries/direct.ts
function RC(e, t, n) {
	let r = e.find((e) => n(e) === n(t));
	return r && (r.generation > t.generation || r.version > t.version) ? e : r ? e.map((e) => n(e) === n(t) ? t : e) : [...e, t];
}
function zC(e, t, n) {
	return t.map((t) => {
		let r = e?.find((e) => n(e) === n(t));
		return r && (r.generation > t.generation || r.version > t.version) ? r : t;
	});
}
function BC(e, t, n = !0) {
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
function VC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, requestId: n, reply: r }) => e.replyPermission(t, n, r),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) })
	});
}
function HC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, reviewId: n, parentSessionId: r }) => r ? e.authorizeChildPermissionReviewRetry(r, t, n) : e.authorizePermissionReviewRetry(t, n),
		onSuccess: (e, n) => Promise.all([t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) }), ...n.parentSessionId ? [t.invalidateQueries({ queryKey: v.traditionalChildren(n.parentSessionId) })] : []])
	});
}
function UC() {
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
function WC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, grantId: n }) => e.deletePermissionGrant(t, n),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) })
	});
}
function GC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.sessionGoal(e),
		queryFn: ({ signal: t }) => n.getGoal(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function KC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, payload: n }) => e.createGoal(t, n),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), e)
	});
}
function qC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, goalId: n, payload: r }) => e.updateGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), e)
	});
}
function JC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, goalId: n, expectedVersion: r }) => e.clearGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), null)
	});
}
function YC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.traditionalChildren(e),
		queryFn: ({ signal: t }) => n.listTraditionalChildren(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => zC(e, t, (e) => e.child_session_id)
	});
}
function XC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, payload: n }) => e.startTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.traditionalChildren(n.sessionId), (t = []) => RC(t, e, (e) => e.child_session_id));
		}
	});
}
function ZC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, childId: n }) => e.cancelTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.traditionalChildren(n.sessionId), (t = []) => RC(t, e, (e) => e.child_session_id));
		}
	});
}
function QC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.sessionInbox(e),
		queryFn: ({ signal: t }) => n.listInbox(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function $C() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, delivery: n, prompt: r }) => e.createInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => [...t.filter((t) => t.id !== e.id), e]);
		}
	});
}
function ew() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r, delivery: i }) => e.updateInboxItem(t, n, r, i),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
function tw() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r }) => e.cancelInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
// src/app/features/direct-session/commandWorkflow.ts
var nw = class extends PS("CommandFailure") {};
function rw(e) {
	return IS(function* () {
		yield* BS(e.optimistic);
		let t = yield* GS({
			try: e.admit,
			catch: (e) => new nw({
				operation: "submit",
				cause: e
			})
		}).pipe(QS(() => BS(e.rejected)));
		return t.kind === "accepted" ? (yield* BS(() => e.reconcile(!1)), t.value) : (yield* BS(() => {
			t.kind === "uncertain" ? e.reconcile(!0) : e.rejected();
		}), yield* FS(new nw({
			operation: "submit",
			cause: t.error
		})));
	});
}
function iw(e) {
	return IS(function* () {
		yield* BS(e.optimistic), yield* GS({
			try: e.cancel,
			catch: (e) => new nw({
				operation: "stop",
				cause: e
			})
		}).pipe(QS(() => BS(e.rollback))), yield* BS(e.settled);
	});
}
function aw(e) {
	return GS({
		try: e.create,
		catch: (e) => new nw({
			operation: "create",
			cause: e
		})
	}).pipe(ZS((t) => BS(() => e.accept(t))));
}
function ow(e) {
	if (e.mode === "direct-running" || e.delivery) {
		let t = e.delivery ?? "steer";
		return GS({
			try: () => e.inbox(t),
			catch: (e) => new nw({
				operation: t,
				cause: e
			})
		}).pipe(KS(t === "queue" ? "queued" : "steered"));
	}
	return GS({
		try: e.submit,
		catch: (e) => new nw({
			operation: "submit",
			cause: e
		})
	}).pipe(KS("submitted"));
}
async function sw(e) {
	let t = await tC(e);
	if (Sp(t)) return t.value;
	let n = jx(t.cause);
	throw Tn(n) ? n.value.cause : Mx(t.cause);
}
// src/app/features/direct-session/commandAdapters.ts
function cw(e, t) {
	let { api: r, stores: { runtimeStore: { captureRuntimeActivation: i, finishRunCancel: a, requestRunCancel: o, restoreRunCancel: s, runtimeStore: c } } } = n(e), l = i(t), u = v.sessionSnapshot(t), d, f, p, ee = [];
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
				r && i && r !== i && ee.push({
					stats: n,
					before: r,
					optimistic: i
				});
			}
		},
		cancel: () => r.cancelActiveRun(t),
		rollback: () => {
			d && l() && c.getState().cancelArmed && s(d), e.setQueryData(u, (e) => e === p ? f : e);
			for (let { stats: t, before: n, optimistic: r } of ee) e.setQueryData(v.sessions(t), (e) => e?.map((e) => e === r ? n : e));
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
function lw(e, t, n) {
	return Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && Number.isSafeInteger(e.total) && e.start >= 0 && e.start <= e.end && e.end <= e.total && e.end - e.start === t && n === t;
}
function uw(e, t) {
	return e?.length === t ? e : Array.from({ length: t }, () => null);
}
function dw(e, t) {
	return e === void 0 || e.length === t && e.every((e) => e === null || typeof e == "string");
}
function fw(e) {
	if (!e.startsWith("log:")) return e;
	let t = e.lastIndexOf(":"), n = e.lastIndexOf(":", t - 1);
	return n > 4 ? e.slice(0, n) : e;
}
function pw(e, t, n) {
	let r = /* @__PURE__ */ new Set();
	return (e ?? []).every(({ message_index: e }) => !Number.isSafeInteger(e) || r.has(e) || t[e - n]?.role !== "user" ? !1 : (r.add(e), !0));
}
function mw(e, t, n) {
	return (e ?? []).filter(({ message_index: e }) => e >= t && e < n);
}
function hw(e) {
	return lw(e.page, e.messages.length, e.created_at.length) && dw(e.tool_call_occurrences, e.messages.length) && pw(e.terminal_selection_attributions, e.messages, e.page.start);
}
function gw(e) {
	let t = e.message_page, n = e.message_created_at ?? [];
	return !!(t && lw(t, e.messages.length, n.length) && dw(e.tool_call_occurrences, e.messages.length) && pw(e.terminal_selection_attributions, e.messages, t.start));
}
function _w(e) {
	return e.message_page ?? {
		start: 0,
		end: e.messages.length,
		total: e.messages.length,
		has_older: !1
	};
}
function vw(e) {
	let t = e.message_created_at ?? [];
	return t.length === e.messages.length ? t : Array.from({ length: e.messages.length }, () => null);
}
function yw(e, t) {
	if (!hw(t)) return { kind: "snapshot-required" };
	let n = _w(e), r = vw(e);
	if (!lw(n, e.messages.length, r.length) || t.page.end !== t.page.total || t.page.total < n.total || t.page.start > n.end) return { kind: "snapshot-required" };
	for (let i = Math.max(n.start, t.page.start); i < Math.min(n.end, t.page.end); i += 1) if (JSON.stringify(e.messages[i - n.start]) !== JSON.stringify(t.messages[i - t.page.start]) || r[i - n.start] !== t.created_at[i - t.page.start] || (() => {
		let r = e.tool_call_occurrences?.[i - n.start], a = t.tool_call_occurrences?.[i - t.page.start];
		return r != null && a != null && fw(r) !== fw(a);
	})()) return { kind: "snapshot-required" };
	if (t.page.start <= n.start) return {
		kind: "accepted",
		snapshot: {
			...e,
			messages: t.messages,
			message_created_at: t.created_at,
			tool_call_occurrences: uw(t.tool_call_occurrences, t.messages.length),
			message_page: t.page,
			terminal_selection_attributions: t.terminal_selection_attributions ?? []
		}
	};
	let i = t.page.start - n.start;
	if (i > e.messages.length) return { kind: "snapshot-required" };
	let a = uw(e.tool_call_occurrences, e.messages.length).slice(0, i);
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
			tool_call_occurrences: [...a, ...uw(t.tool_call_occurrences, t.messages.length)],
			terminal_selection_attributions: [...mw(e.terminal_selection_attributions, n.start, t.page.start), ...t.terminal_selection_attributions ?? []],
			message_page: {
				...t.page,
				start: n.start,
				has_older: n.start > 0
			}
		}
	};
}
function bw(e, t, n) {
	if (!hw(t)) return null;
	let r = _w(e), i = vw(e);
	return r.start !== n || t.page.end !== n || t.page.total !== r.total || !lw(r, e.messages.length, i.length) ? null : {
		...e,
		messages: [...t.messages, ...e.messages],
		message_created_at: [...t.created_at, ...i],
		tool_call_occurrences: [...uw(t.tool_call_occurrences, t.messages.length), ...uw(e.tool_call_occurrences, e.messages.length)],
		terminal_selection_attributions: [...t.terminal_selection_attributions ?? [], ...mw(e.terminal_selection_attributions, r.start, r.end)],
		message_page: {
			start: t.page.start,
			end: r.end,
			total: r.total,
			has_older: t.page.start > 0
		}
	};
}
function xw(e, t, n) {
	if (n || !e || !t.message_page) return t;
	if (!gw(t)) return e;
	let r = t.message_created_at ?? [], i = yw(e, {
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
// src/app/services/queries/invalidation.ts
function Sw() {
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
var Cw = /* @__PURE__ */ new Map(), ww = 0, Tw = /* @__PURE__ */ new WeakMap(), Ew = 0;
function Dw(e, t) {
	let n = Tw.get(e);
	return n === void 0 && (n = ++Ew, Tw.set(e, n)), `${n}:${t}`;
}
function Ow(e) {
	let t = Cw.get(e);
	if (t) return t;
	let n = {
		generation: ++ww,
		replaceNextSnapshot: !1,
		tailController: null,
		historyControllers: /* @__PURE__ */ new Set()
	};
	return Cw.set(e, n), n;
}
function kw(e, t = !1) {
	let n = Ow(e);
	n.generation = ++ww, n.replaceNextSnapshot ||= t, n.tailController?.abort(), n.tailController = null;
	for (let e of n.historyControllers) e.abort();
	return n.historyControllers.clear(), n.generation;
}
function Aw(e) {
	let t = Ow(e);
	return {
		generation: kw(e),
		replace: t.replaceNextSnapshot
	};
}
function jw(e, t) {
	let n = Cw.get(e);
	n?.generation === t.generation && t.replace && (n.replaceNextSnapshot = !1);
}
function Mw(e) {
	let t = Ow(e);
	t.tailController?.abort();
	let n = new AbortController();
	return t.tailController = n, {
		generation: t.generation,
		controller: n
	};
}
function Nw(e, t) {
	let n = Cw.get(e);
	n?.tailController === t.controller && (n.tailController = null);
}
function Pw(e, t) {
	return Cw.get(e)?.generation === t;
}
function Fw(e) {
	let t = Ow(e), n = new AbortController();
	return t.historyControllers.add(n), {
		generation: t.generation,
		controller: n
	};
}
function Iw(e, t) {
	Cw.get(e)?.historyControllers.delete(t.controller);
}
function Lw(e) {
	let t = Cw.get(e);
	t?.tailController?.abort();
	for (let e of t?.historyControllers ?? []) e.abort();
	Cw.delete(e);
}
// src/app/services/queries/session.ts
function Rw(e = ye) {
	let { api: t } = r();
	return g({
		queryKey: v.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: e,
		staleTime: 0,
		placeholderData: ne
	});
}
function zw(e) {
	let { api: t } = r(), n = u((t) => t.find((t) => t.summary.session_id === e) ?? null, [e]);
	return g({
		queryKey: v.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: ye,
		staleTime: 0,
		placeholderData: ne,
		select: n
	});
}
function Bw(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function Vw(e, t) {
	let { api: n } = r(), i = _();
	return g({
		queryKey: v.sessionSnapshot(e ?? ""),
		queryFn: async ({ signal: t }) => {
			let r = Aw(Dw(i, e)), a = await n.getSession(e, {
				messageLimit: 24,
				threadEventLimit: 50,
				includeSessions: !1,
				includeSystem: !0,
				signal: t
			});
			if (!gw(a)) throw Error("The server returned an invalid snapshot message page.");
			if (t.aborted || !Pw(Dw(i, e), r.generation)) throw new DOMException("Snapshot superseded", "AbortError");
			return jw(Dw(i, e), r), xw(i.getQueryData(v.sessionSnapshot(e)), a, r.replace);
		},
		enabled: !!e,
		staleTime: 1e3,
		placeholderData: Bw(e ?? ""),
		...t
	});
}
function Hw(e) {
	let { api: t } = r(), n = _();
	return h({ mutationFn: async () => {
		let r = n.getQueryData(v.sessionSnapshot(e))?.message_page?.start;
		if (r === void 0 || r <= 0) throw Error("No older messages are available.");
		let i = Dw(n, e), a = Fw(i);
		try {
			let o = await t.getMessages(e, {
				before: r,
				limit: 24,
				includeSystem: !0,
				signal: a.controller.signal
			});
			if (!hw(o)) throw Error("The server returned an invalid message page.");
			if (!Pw(i, a.generation)) return !1;
			let s = !1;
			return n.setQueryData(v.sessionSnapshot(e), (e) => {
				if (!e) return e;
				let t = bw(e, o, r);
				return t ? (s = !0, t) : e;
			}), s;
		} catch (e) {
			if (a.controller.signal.aborted) return !1;
			throw e;
		} finally {
			Iw(i, a);
		}
	} });
}
function Uw(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sessionConfig(e ?? ""),
		queryFn: ({ signal: n }) => t.getConfig(e, n),
		enabled: !!e
	});
}
function Ww() {
	let { api: e } = r(), t = Sw(), n = _();
	return h({
		retry: !1,
		mutationFn: (r) => sw(aw({
			create: () => e.createSession(r),
			accept: (e) => {
				let r = e.metadata.session_id;
				if (!r) throw Error("The server returned a chat without an identity.");
				kw(Dw(n, r), !0), n.setQueryData(v.sessionSnapshot(r), e), t.sessions();
			}
		}))
	});
}
function Gw(e, t) {
	let n = [];
	for (let r of e.getQueryCache().findAll({ queryKey: ["session"] })) {
		let e = r.queryKey;
		if (e[0] !== "session" || e[2] !== "snapshot" || typeof e[1] != "string") continue;
		let i = e[1];
		i !== t && r.state.data?.forks?.some((e) => e.session_id === t) && n.push(i);
	}
	return n;
}
function Kw() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = Sw(), i = _();
	return h({
		mutationFn: (t) => e.deleteSession(t),
		onSuccess: (e, r) => {
			t.purgeSessions([r]), n.sessions(), i.removeQueries({ queryKey: v.sessionRoot(r) });
			for (let e of Gw(i, r)) n.sessionRoot(e);
		}
	});
}
function qw() {
	let { api: e } = r(), t = Sw();
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
function Jw() {
	let e = qw();
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
function Yw() {
	let { api: t } = r(), { captureRuntimeActivation: n, setOptimisticUserPrompt: i } = r().stores.runtimeStore, a = Sw(), o = _();
	return h({
		retry: !1,
		mutationFn: ({ id: r, prompt: s, signal: c }) => {
			let l = n(r);
			return sw(rw({
				optimistic: () => {
					l() && i(s);
				},
				admit: async () => {
					let n = await (c ? t.submitRun(r, s, c) : t.submitRun(r, s));
					return n.status === "accepted" ? {
						kind: "accepted",
						value: n.response
					} : n.status === "not-sent" ? {
						kind: "not-sent",
						error: new DOMException("Prompt submission was cancelled before it was sent.", "AbortError")
					} : {
						kind: "uncertain",
						error: new e(n.requestId, n.error)
					};
				},
				rejected: () => {
					l() && i(null);
				},
				reconcile: (e) => {
					e ? (kw(Dw(o, r), !0), a.sessionRoot(r)) : a.session(r);
				}
			}));
		}
	});
}
function Xw() {
	let e = _();
	return h({
		retry: !1,
		mutationFn: (t) => sw(iw(cw(e, t)))
	});
}
function Zw() {
	let { api: e } = r(), t = Sw(), n = _();
	return h({
		mutationFn: (t) => e.compactSession(t),
		onSuccess: (e, r) => (kw(Dw(n, r), !0), t.sessionRoot(r))
	});
}
function Qw() {
	let { api: e } = r(), t = Sw(), n = _();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.revertSession(t, n),
		onSuccess: (e, { id: r }) => {
			kw(Dw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function $w() {
	let { api: e } = r(), t = Sw(), n = _();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.regenerateRun(t, n),
		onSuccess: (e, { id: r }) => {
			kw(Dw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function eT() {
	let { api: e } = r(), t = Sw();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.forkSession(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n), t.sessions();
		}
	});
}
function tT() {
	let { api: e } = r(), t = Sw();
	return h({
		mutationFn: ({ id: t, forkId: n }) => e.dismissSessionFork(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n);
		}
	});
}
function nT() {
	return Rw();
}
// src/app/services/queries/workspace.ts
function rT(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function iT(e, t, n = "all", i = 3, a = null) {
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
		placeholderData: rT(e ?? "")
	});
}
function aT(e, t = null) {
	let { api: n } = r();
	return g({
		queryKey: v.workspaceFiles(e ?? "", t),
		queryFn: ({ signal: r }) => n.getWorkspaceFiles(e, t, r),
		enabled: !!e,
		staleTime: t == null ? 1e4 : Infinity,
		placeholderData: rT(e ?? "")
	});
}
function oT(e, t, n = null) {
	let { api: i } = r();
	return g({
		queryKey: v.workspaceFile(e ?? "", t ?? "", n),
		queryFn: ({ signal: r }) => i.getWorkspaceFile(e, t, n, r),
		enabled: !!(e && t),
		staleTime: n == null ? 1e4 : Infinity,
		placeholderData: rT(e ?? "")
	});
}
function sT(e) {
	let { api: t } = r();
	return g({
		queryKey: v.workspaceRevisions(e ?? ""),
		queryFn: ({ signal: n }) => t.getWorkspaceRevisions(e, n),
		enabled: !!e,
		staleTime: 5e3,
		retry: !1
	});
}
function cT(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.workspaceRevisionChanges(e ?? "", t ?? 0),
		queryFn: ({ signal: r }) => n.getWorkspaceRevisionChanges(e, t, r),
		enabled: !!(e && t != null),
		staleTime: Infinity,
		placeholderData: rT(e ?? "")
	});
}
function lT(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.branches(e ?? ""),
		queryFn: ({ signal: t }) => n.getBranches(e, t),
		enabled: !!e && t,
		staleTime: 5e3,
		retry: !1
	});
}
function uT(e) {
	let { api: t } = r(), n = _();
	return h({
		mutationFn: (n) => t.switchBranch(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: v.branches(e) }), n.invalidateQueries({ queryKey: v.sessionRoot(e) }), n.invalidateQueries({ queryKey: v.sessionsAll });
		}
	});
}
function dT(e) {
	let { api: t } = r(), n = _();
	return h({
		mutationFn: (n) => t.commitWorkspace(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: v.sessionRoot(e) }), n.invalidateQueries({ queryKey: v.sessionsAll });
		}
	});
}
// src/app/services/queries/projects.ts
function fT() {
	let { api: e } = r();
	return g({
		queryKey: v.projects,
		queryFn: ({ signal: t }) => e.listProjects(t),
		staleTime: 3e4,
		retry: !1
	});
}
function pT() {
	let { api: e } = r(), t = Sw();
	return h({
		retry: !1,
		mutationFn: (t) => e.createProject(t),
		onSettled: () => t.projects()
	});
}
function mT() {
	let { api: e } = r(), t = Sw();
	return h({
		retry: !1,
		mutationFn: ({ projectId: t, payload: n }) => e.updateProject(t, n),
		onSuccess: () => t.projects()
	});
}
function hT() {
	let e = mT();
	return {
		...e,
		toggle: (t) => e.mutateAsync({
			projectId: t.project_id,
			payload: { pinned: !t.pinned }
		})
	};
}
function gT() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = Sw();
	return h({
		mutationFn: ({ projectId: t, sessions: n }) => e.deleteProject(t, n),
		onSuccess: (e) => (t.purgeSessions(e.deleted_session_ids), Promise.all([n.projects(), n.sessions()]))
	});
}
function _T() {
	let { api: e } = r(), t = Sw();
	return h({
		mutationFn: ({ projectId: t, sessionId: n }) => e.assignSessionToProject(t, { session_id: n }),
		onSuccess: () => Promise.all([t.projects(), t.sessions()])
	});
}
// src/app/services/queries/fleetAttentionModel.ts
var vT = {
	scope: null,
	epoch: null,
	revision: 0,
	sessions: /* @__PURE__ */ new Map()
};
function yT(e, t) {
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
var bT = 1e3, xT = 3e4;
function ST(e = {}) {
	let t = r(), { api: n, client: i } = t, a = e.projectId, o = e.enabled ?? !0, s = o && (e.stream ?? !0), [c, l] = ee(yT, vT), u = m(0), d = m({
		scope: a ?? null,
		at: 0
	}), [ne, h] = te({
		scope: a ?? null,
		version: 0
	}), [re, _] = te(null), ie = `/attention/stream${a ? `?project_id=${encodeURIComponent(a)}` : ""}`, [ae, oe] = te({
		path: ie,
		status: "connecting"
	}), se = s ? ae.path === ie ? ae.status : "connecting" : "down", ce = p(() => e.eventSource ?? t.openStream ?? ((e) => new EventSource(i.transport.url(e), i.transport.eventSourceInit())), [
		e.eventSource,
		t.openStream,
		i
	]), le = g({
		queryKey: v.fleetAttention(a ?? null),
		queryFn: async ({ signal: e }) => {
			let t = ++u.current, r = performance.now(), i = await n.fleetAttention(a, e);
			return e.aborted || h({
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
	f(() => {
		let e = d.current;
		le.data && (e.scope !== (a ?? null) || le.data.startedAt >= e.at) && l({
			kind: "snapshot",
			...le.data.snapshot,
			scope: a ?? null
		});
	}, [le.data, a]), f(() => {
		if (!s) return;
		let e = ie, t = (t) => oe({
			path: e,
			status: t
		}), n = !1, r = null, i = null, o = bT, c = () => {
			r?.close(), r = null, !(n || i !== null) && (t("down"), i = setTimeout(() => {
				i = null, f();
			}, o), o = Math.min(o * 2, xT));
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
				s.kind === "unavailable" ? (_({
					scope: a ?? null,
					version: u.current
				}), c(), ue()) : (o = bT, s.kind === "snapshot" && (d.current = {
					scope: a ?? null,
					at: performance.now()
				}), l({
					...s,
					scope: a ?? null
				}), _(null), t("live"));
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
		ie,
		ue
	]);
	let de = re?.scope === (a ?? null) && (ne.scope !== re.scope || ne.version <= re.version), fe = se === "live" ? "live" : le.isError || de ? "unavailable" : (se === "connecting" || !s) && !le.data ? "connecting" : "polling";
	return {
		...c.scope === (a ?? null) ? c : vT,
		status: fe
	};
}
// src/app/features/managed/model.ts
var CT = [
	"status",
	"github",
	"secrets"
], wT = /* @__PURE__ */ new Set([
	"PATH",
	"HOME",
	"NAC_HOME",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"EXA_API_KEY"
]);
function TT(e) {
	return e ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(e) ? wT.has(e) ? `${e} is managed by NAC and cannot be replaced here.` : "" : "Use letters, digits, and underscores; the first character cannot be a digit." : "Enter a variable name.";
}
function ET(e) {
	let t = e?.split("/") ?? [];
	return t.length === 2 && t[0] && t[1] ? [t[0], t[1]] : null;
}
function DT(e) {
	return e?.status === "running";
}
function OT(e) {
	return e ? {
		backend: e.model.backend,
		model: e.model.id,
		baseUrl: e.model.endpoint
	} : null;
}
function kT(e, t) {
	return !!(t && e && t.backend === e.model.backend && t.baseUrl === e.model.endpoint);
}
function AT(e, t) {
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
function jT(e) {
	return typeof e == "object" && e && "status" in e ? e.status : null;
}
function MT(e) {
	return NT(e) || e instanceof Error && e.name === "ManagedUpgradeContractError";
}
function NT(e) {
	let t = jT(e);
	return t === 401 || t === 403 || t === 409;
}
function PT(e) {
	let t = jT(e);
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
var FT = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying"
]);
function IT(e) {
	return FT.has(e);
}
function LT(e) {
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
function RT(e) {
	switch (e) {
		case "cancel_active_run": return "Stop run";
		case "cancel_traditional_child": return "Cancel coding agent";
		case "cancel_managed_orchestrator": return "Cancel NAC orchestrator";
		case "terminate_terminal": return "Stop terminal";
		case "cancel_clone_operation": return "Cancel clone";
		case "wait": return "Wait";
	}
}
function zT(e) {
	return e === null ? "Accepted-release distance unavailable" : e === 0 ? "Current accepted release" : `${e} accepted ${e === 1 ? "release" : "releases"} ahead`;
}
function BT(e, t) {
	return e.release_id === t.release_id && e.source_revision === t.source_revision && e.build_id === t.build_id && e.product_version === t.product_version && e.schema_version === t.schema_version;
}
// src/app/features/managed/upgradeContract.ts
var VT = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying",
	"succeeded",
	"failed"
]), HT = /* @__PURE__ */ new Set([
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
]), UT = /* @__PURE__ */ new Set([
	"wait",
	"cancel_active_run",
	"cancel_traditional_child",
	"cancel_managed_orchestrator",
	"terminate_terminal",
	"cancel_clone_operation"
]), WT = {
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
}, GT = class extends Error {
	constructor() {
		super("Managed upgrade status did not match the browser contract."), this.name = "ManagedUpgradeContractError";
	}
};
function KT() {
	throw new GT();
}
function qT(e, t, n) {
	(typeof e != "object" || !e || Array.isArray(e)) && KT();
	let r = e;
	return Object.keys(r).some((e) => !t.includes(e)) && KT(), n.some((e) => !Object.hasOwn(r, e)) && KT(), r;
}
function JT(e, t, n = !0) {
	return (typeof e != "string" || e.length > t || !n && e.length === 0 || /\p{Cc}/u.test(e)) && KT(), e;
}
function YT(e) {
	return (typeof e != "number" || !Number.isSafeInteger(e) || e < 0) && KT(), e;
}
function XT(e, t) {
	return typeof e == "string" && t.has(e) || KT(), e;
}
function ZT(e, t, n) {
	return Object.hasOwn(e, t) ? JT(e[t], n) : void 0;
}
function QT(e) {
	let t = qT(e, [
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
	]), n = JT(t.source_revision, 40, !1);
	return /^[a-f0-9]{40}$/.test(n) || KT(), {
		release_id: JT(t.release_id, 63, !1),
		source_revision: n,
		build_id: JT(t.build_id, 128, !1),
		product_version: JT(t.product_version, 128, !1),
		schema_version: YT(t.schema_version)
	};
}
function $T(e, t) {
	return Object.hasOwn(e, t) ? QT(e[t]) : void 0;
}
function eE(e) {
	let t = JT(e, 128, !1);
	return /^[A-Za-z0-9_.:@-]+$/.test(t) || KT(), t;
}
function tE(e) {
	let t = [
		"session_id",
		"run_id",
		"child_session_id",
		"orchestrator_session_id",
		"terminal_id",
		"clone_operation_id"
	], n = qT(e, t, []);
	return Object.fromEntries(t.filter((e) => Object.hasOwn(n, e)).map((e) => [e, eE(n[e])]));
}
function nE(e, t) {
	let n = Object.keys(e).sort();
	return n.length === t.length && t.every((t) => n.includes(t) && !!e[t]);
}
function rE(e, t, n) {
	switch (t) {
		case "cancel_active_run": return e === "active_run" && nE(n, ["session_id", "run_id"]);
		case "cancel_traditional_child": return e === "traditional_child" && nE(n, ["session_id", "child_session_id"]);
		case "cancel_managed_orchestrator": return e === "managed_orchestrator" && nE(n, ["session_id", "orchestrator_session_id"]);
		case "terminate_terminal": return e === "terminal_process" && nE(n, ["session_id", "terminal_id"]);
		case "cancel_clone_operation": return e === "clone_operation" && nE(n, ["clone_operation_id"]);
		case "wait": return !1;
	}
}
function iE(e) {
	let t = qT(e, [
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
	]), n = JT(t.selection_key, 71, !1);
	/^sha256:[a-f0-9]{64}$/.test(n) || KT();
	let r = XT(t.kind, HT), i = JT(t.message, 512, !1);
	WT[r].includes(i) || KT(), typeof t.actionable != "boolean" && KT();
	let a = XT(t.action, UT);
	if (!t.actionable) return (a !== "wait" || t.target !== null) && KT(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !1,
		action: a,
		target: null
	};
	let o = tE(t.target);
	return rE(r, a, o) || KT(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !0,
		action: a,
		target: o
	};
}
function aE(e) {
	let t = qT(e, [
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
	t.kind !== "upgrade" && KT();
	let n;
	return Object.hasOwn(t, "blockers") && ((!Array.isArray(t.blockers) || t.blockers.length > 100) && KT(), n = t.blockers.map(iE)), {
		operation_id: JT(t.operation_id, 128, !1),
		managed_host_id: JT(t.managed_host_id, 128, !1),
		kind: "upgrade",
		state: XT(t.state, VT),
		reason: ZT(t, "reason", 128),
		message: ZT(t, "message", 512),
		target_release: $T(t, "target_release"),
		desired_release: $T(t, "desired_release"),
		observed_release: $T(t, "observed_release"),
		blockers: n,
		created_at: ZT(t, "created_at", 64),
		updated_at: ZT(t, "updated_at", 64)
	};
}
function oE(e) {
	let t = qT(e, ["preview", "operation"], ["preview", "operation"]), n = qT(t.preview, [
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
	typeof n.upgrade_available != "boolean" && KT();
	let r = null;
	return n.distance !== null && (r = { accepted_releases: YT(qT(n.distance, ["accepted_releases"], ["accepted_releases"]).accepted_releases) }), {
		preview: {
			current: QT(n.current),
			latest_beta: QT(n.latest_beta),
			upgrade_available: n.upgrade_available,
			distance: r
		},
		operation: t.operation === null ? null : aE(t.operation)
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
function sE() {
	let { api: e } = r();
	return g({
		queryKey: $.hostStatus,
		queryFn: ({ signal: t }) => e.getManagedStatus(t),
		staleTime: 5e3,
		refetchInterval: 15e3,
		retry: !1
	});
}
function cE(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: $.upgrade,
		queryFn: async ({ signal: e }) => oE(await t.getManagedUpgrade(e)),
		enabled: e,
		staleTime: 0,
		refetchInterval: (e) => e.state.data?.operation && IT(e.state.data.operation.state) ? 1e3 : 15e3,
		refetchIntervalInBackground: !0,
		retry: !1
	});
}
function lE() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: async (t) => aE(await e.startManagedUpgrade(t)),
		onSuccess: (e) => (t.setQueryData($.upgrade, (t) => t && {
			...t,
			operation: e
		}), t.invalidateQueries({ queryKey: $.upgrade }))
	});
}
function uE(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: $.github,
		queryFn: ({ signal: e }) => t.getManagedGitHub(e),
		enabled: e,
		retry: !1
	});
}
function dE(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: $.secrets,
		queryFn: ({ signal: e }) => t.listManagedSecrets(e),
		enabled: e,
		retry: !1
	});
}
function fE() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ name: t, value: n }) => e.putManagedSecret(t, n),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: $.secrets }), t.invalidateQueries({ queryKey: $.hostStatus })])
	});
}
function pE() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteManagedSecret(t),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: $.secrets }), t.invalidateQueries({ queryKey: $.hostStatus })])
	});
}
function mE(e = !0, t = !1) {
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
function hE(e, t, n) {
	let { api: i } = r(), a = _(), o = EC(e === "chatgpt-codex-responses" && t !== null && n !== null);
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
function gE(e, t, n = null) {
	let { api: i } = r(), a = _(), o = EC(t && e === "chatgpt-codex-responses");
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
function _E(e) {
	let { api: t } = r(), n = _(), i = sE().data ?? null, a = p(() => AT(e, i), [e, i]), o = re({ queries: a.map((r) => ({
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
var vE = l(null), yE = 150, bE = 3, xE = 0, SE = () => `toast-${Date.now()}-${xE++}`;
function CE({ toasts: e, removeToast: t }) {
	let n = a(), r = m(/* @__PURE__ */ new Map());
	return f(() => {
		let n = r.current;
		for (let r of e) r.keep || r.dismissing || n.has(r.id) || n.set(r.id, setTimeout(() => t(r.id), r.life * 1e3));
		let i = new Set(e.map((e) => e.id));
		for (let [e, t] of n) i.has(e) || (clearTimeout(t), n.delete(e));
	}, [e, t]), f(() => {
		let e = r.current;
		return () => e.forEach((e) => clearTimeout(e));
	}, []), se(/* @__PURE__ */ ae("div", {
		role: "region",
		"aria-label": "Notifications",
		"aria-live": "polite",
		"aria-relevant": "additions",
		className: "fixed inset-x-0 top-[calc(64px+env(safe-area-inset-top))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2 pointer-events-none",
		children: e.map((e) => /* @__PURE__ */ ae("div", {
			className: "pointer-events-none flex w-full justify-center",
			children: /* @__PURE__ */ ae(s, {
				content: e.content,
				variant: e.variant,
				dismissing: e.dismissing,
				onClose: () => t(e.id)
			})
		}, e.id))
	}), n);
}
function wE({ children: e }) {
	let [t, n] = te([]), r = u((e) => {
		let t = SE();
		return n((n) => [...n, {
			id: t,
			content: e.content,
			variant: e.variant ?? o.Info,
			life: e.life ?? bE,
			keep: e.keep ?? !1,
			dismissing: !1
		}]), t;
	}, []), i = u((e) => {
		n((t) => {
			let r = t.find((t) => t.id === e);
			return !r || r.dismissing ? t : (setTimeout(() => n((t) => t.filter((t) => t.id !== e)), yE), t.map((t) => t.id === e ? {
				...t,
				dismissing: !0
			} : t));
		});
	}, []), a = u(() => {
		n((e) => e.length === 0 ? e : (setTimeout(() => n((e) => e.filter((e) => !e.dismissing)), yE), e.map((e) => ({
			...e,
			dismissing: !0
		}))));
	}, []), s = p(() => ({
		addToast: r,
		removeToast: i,
		clearToasts: a,
		info: (e, t) => r({
			content: e,
			variant: o.Info,
			...t
		}),
		success: (e, t) => r({
			content: e,
			variant: o.Success,
			...t
		}),
		error: (e, t) => r({
			content: e,
			variant: o.Error,
			...t
		}),
		danger: (e, t) => r({
			content: e,
			variant: o.Danger,
			...t
		})
	}), [
		r,
		i,
		a
	]);
	return /* @__PURE__ */ oe(vE.Provider, {
		value: s,
		children: [e, /* @__PURE__ */ ae(CE, {
			toasts: t,
			removeToast: i
		})]
	});
}
function TE() {
	let e = d(vE);
	if (!e) throw Error("useToast must be used within a ToastProvider");
	return e;
}
function EE(e) {
	return e instanceof Error ? e.message : String(e);
}
// src/app/lib/PerfProfiler.tsx
var DE = (e, n, r) => {
	t(`commit:${e}`, {
		ms: r,
		fields: { phase: n },
		throttleMs: 1e3,
		slowMs: 16
	});
};
function OE({ id: e, children: t }) {
	return i() ? /* @__PURE__ */ ae(c, {
		id: e,
		onRender: DE,
		children: t
	}) : /* @__PURE__ */ ae(ie, { children: t });
}
// src/app/lib/workspaceLink.ts
var kE = /^(https?|ircs?|mailto|xmpp|file)$/i, AE = /^[a-zA-Z]:[\\/]/, jE = /^(https?|mailto|ircs?|xmpp):/i;
function ME(e) {
	let t = String(e ?? "").trim();
	if (!t) return "";
	if (AE.test(t)) return t;
	let n = t.indexOf(":");
	return n === -1 || kE.test(t.slice(0, n)) ? t : "";
}
function NE(e) {
	return e.replace(/\\/g, "/");
}
function PE(e, t) {
	if (!t) return null;
	let n = NE(t).replace(/\/+$/, "");
	return n ? e === n ? "" : e.startsWith(`${n}/`) ? e.slice(n.length + 1) : null : null;
}
function FE(e, t = []) {
	let n = (e ?? "").trim();
	if (!n || n.startsWith("#")) return { kind: "blocked" };
	if (jE.test(n)) return {
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
	r = NE(r);
	for (let e of t) {
		let t = PE(r, e);
		if (t != null) {
			r = t;
			break;
		}
	}
	return r.startsWith("/") || AE.test(r) || (r = r.replace(/^\.\//, ""), !r || r === ".") || r.split("/").includes("..") || r.includes("://") ? { kind: "blocked" } : {
		kind: "workspace",
		path: r
	};
}
export { eT as $, _e as $n, yC as $t, TT as A, QS as An, BC as At, lT as B, Mx as Bn, FC as Bt, LT as C, eC as Cn, JC as Ct, CT as D, RS as Dn, VC as Dt, BT as E, YS as En, WC as Et, pT as F, Nx as Fn, ew as Ft, aT as G, Tn as Gn, uC as Gt, uT as H, Sp as Hn, PC as Ht, gT as I, Px as In, IC as It, Xw as J, de as Jn, SC as Jt, cT as K, v as Kn, bC as Kt, fT as L, Fx as Ln, LC as Lt, ET as M, WS as Mn, XC as Mt, ST as N, PS as Nn, YC as Nt, DT as O, zS as On, GC as Ot, _T as P, kS as Pn, qC as Pt, tT as Q, ge as Qn, wC as Qt, hT as R, Lx as Rn, NC as Rt, IT as S, XS as Sn, ZC as St, MT as T, nC as Tn, $C as Tt, iT as U, Cp as Un, OC as Ut, dT as V, xp as Vn, jC as Vt, oT as W, ci as Wn, sC as Wt, Ww as X, he as Xn, vC as Xt, Zw as Y, pe as Yn, gC as Yt, Kw as Z, ve as Zn, TC as Zt, _E as _, FS as _n, yw as _t, EE as a, cC as an, zw as at, NT as b, $S as bn, HC as bt, pE as c, CC as cn, Jw as ct, sE as d, iC as dn, Mw as dt, EC as en, le as er, Hw as et, gE as f, aC as fn, Lw as ft, fE as g, JS as gn, Dw as gt, hE as h, HS as hn, Pw as ht, wE as i, pC as in, Vw as it, kT as j, GS as jn, UC as jt, OT as k, BS as kn, QC as kt, mE as l, xC as ln, qw as lt, cE as m, qS as mn, Nw as mt, ME as n, AC as nn, Qw as nt, TE as o, fC as on, Rw as ot, dE as p, VS as pn, kw as pt, sT as q, fe as qn, mC as qt, OE as r, kC as rn, Uw as rt, $ as s, dC as sn, Yw as st, FE as t, lC as tn, ce as tr, $w as tt, uE as u, hC as un, nT as ut, lE as v, IS as vn, ow as vt, PT as w, tC as wn, KC as wt, zT as x, LS as xn, tw as xt, RT as y, US as yn, sw as yt, mT as z, jx as zn, MC as zt };
