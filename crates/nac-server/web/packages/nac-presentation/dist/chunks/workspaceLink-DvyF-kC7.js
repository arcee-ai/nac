import { S as e, a as t, j as n, n as r, x as i } from "./RuntimeContext-CzbBXx-g.js";
import { a, y as o } from "./PresentationBoundary-BAUfAcJZ.js";
import { n as s, t as c } from "./Toast-J9CfluTU.js";
import { Profiler as l, createContext as u, useCallback as d, useContext as f, useEffect as p, useMemo as m, useReducer as ee, useRef as te, useState as ne } from "react";
import { keepPreviousData as re, useMutation as h, useQueries as ie, useQuery as g, useQueryClient as _ } from "@tanstack/react-query";
import { Fragment as ae, jsx as oe, jsxs as se } from "react/jsx-runtime";
import { createPortal as ce } from "react-dom";
// src/app/lib/primitive.ts
function le(e) {
	return e != null && Object(e) !== e && e.constructor === String;
}
function ue(e) {
	return e != null && Object(e) !== e && e.constructor === Number;
}
// src/app/lib/routes.ts
var de = [
	"sessions",
	"insights",
	"delegated",
	"files",
	"terminal",
	"heartbeats",
	"history"
], fe = {
	sessions: "Sessions",
	insights: "Insights",
	delegated: "Subagents",
	files: "Files",
	terminal: "Terminal",
	heartbeats: "Heartbeats",
	history: "History"
};
de.filter((e) => e !== "history");
var pe = "insights";
function me(e) {
	return de.includes(e ?? "");
}
var he = [
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
function ge(e) {
	return he.includes(e ?? "");
}
var _e = {
	list: () => "/",
	newSession: (e) => e ? `/?project=${encodeURIComponent(e)}` : "/",
	settings: (e = "general") => `/settings/${e}`,
	session: (e, t = pe) => `/session/${encodeURIComponent(e)}/${t}`,
	project: (e) => `/project/${encodeURIComponent(e)}`,
	taskSchedules: (e) => e ? `/project/${encodeURIComponent(e)}/task-schedules` : "/task-schedules",
	designPreview: () => "/design"
};
function ve(e) {
	let [, t, n] = e.split("/");
	return t !== "session" || !n ? null : decodeURIComponent(n);
}
function ye(e) {
	let [, t, n] = e.split("/");
	return t !== "project" || !n ? null : decodeURIComponent(n);
}
// src/app/services/queries/keys.ts
var be = 5e3, v = {
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
}, xe = (e) => typeof e == "function", y = function(e, t) {
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
}, b = (e) => e, Se = (e) => () => e, Ce = /*#__PURE__*/ Se(!0), we = /*#__PURE__*/ Se(!1), Te = /*#__PURE__*/ Se(void 0), Ee = Te;
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
var De = (e) => (t, n) => t === n || e(t, n), Oe = /*#__PURE__*/ y(2, (e, t) => De((n, r) => e(t(n), t(r)))), ke = (e) => De((t, n) => {
	if (t.length !== n.length) return !1;
	for (let r = 0; r < t.length; r++) if (!e(t[r], n[r])) return !1;
	return !0;
}), Ae = "effect/GlobalValue", je, S = (e, t) => (je ||= (globalThis[Ae] ??= /* @__PURE__ */ new Map(), globalThis[Ae]), je.has(e) || je.set(e, t()), je.get(e)), Me = (e) => typeof e == "string", Ne = (e) => typeof e == "number", Pe = (e) => typeof e == "bigint", Fe = xe, Ie = (e) => typeof e == "object" && !!e, Le = (e) => Ie(e) || Fe(e), C = /*#__PURE__*/ y(2, (e, t) => Le(e) && t in e), Re = /*#__PURE__*/ y(2, (e, t) => C(e, "_tag") && e._tag === t), ze = (e) => e == null, Be = (e) => typeof e == "string" || C(e, Symbol.iterator), Ve = (e) => C(e, "then") && Fe(e.then), He = (e) => `BUG: ${e} - please report an issue at https://github.com/Effect-TS/effect/issues`, Ue = class e {
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
}, We = 335903614, Ge = 4150755663, Ke = 1481765933, qe = 1284865837, Je = 9007199254740992, Ye = 134217728, Xe = class {
	_state;
	constructor(e, t, n, r) {
		return ze(t) && ze(e) ? (t = Math.random() * 4294967295 >>> 0, e = 0) : ze(t) && (t = e, e = 0), ze(r) && ze(n) ? (r = this._state ? this._state[3] : Ge, n = this._state ? this._state[2] : We) : ze(r) && (r = n, n = 0), this._state = new Int32Array([
			0,
			0,
			n >>> 0,
			((r || 0) | 1) >>> 0
		]), this._next(), Qe(this._state, this._state[0], this._state[1], e >>> 0, t >>> 0), this._next(), this;
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
		return (e * Ye + t) / Je;
	}
	_next() {
		let e = this._state[0] >>> 0, t = this._state[1] >>> 0;
		Ze(this._state, e, t, Ke, qe), Qe(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
		let n = e >>> 18, r = (t >>> 18 | e << 14) >>> 0;
		n = (n ^ e) >>> 0, r = (r ^ t) >>> 0;
		let i = (r >>> 27 | n << 5) >>> 0, a = e >>> 27, o = (-a >>> 0 & 31) >>> 0;
		return (i >>> a | i << o) >>> 0;
	}
};
function Ze(e, t, n, r, i) {
	let a = (n >>> 16) * (i & 65535) >>> 0, o = (n & 65535) * (i >>> 16) >>> 0, s = (n & 65535) * (i & 65535) >>> 0, c = (n >>> 16) * (i >>> 16) + ((o >>> 16) + (a >>> 16)) >>> 0;
	o = o << 16 >>> 0, s = s + o >>> 0, s >>> 0 < o >>> 0 && (c = c + 1 >>> 0), a = a << 16 >>> 0, s = s + a >>> 0, s >>> 0 < a >>> 0 && (c = c + 1 >>> 0), c = c + Math.imul(n, r) >>> 0, c = c + Math.imul(t, i) >>> 0, e[0] = c, e[1] = s;
}
function Qe(e, t, n, r, i) {
	let a = t + r >>> 0, o = n + i >>> 0;
	o >>> 0 < n >>> 0 && (a = a + 1 | 0), e[0] = a, e[1] = o;
}
var $e = /*#__PURE__*/ Symbol.for("effect/Utils/YieldWrap"), et = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	[$e]() {
		return this.#e;
	}
};
function tt(e) {
	if (typeof e == "object" && e && $e in e) return e[$e]();
	throw Error(He("yieldWrapGet"));
}
var nt = /*#__PURE__*/ S("effect/Utils/isStructuralRegion", () => ({
	enabled: !1,
	tester: void 0
})), rt = { effect_internal_function: (e) => e() }, w = /*#__PURE__*/ rt.effect_internal_function(() => (/* @__PURE__ */ Error()).stack)?.includes("effect_internal_function") === !0 ? rt.effect_internal_function : { effect_internal_function: (e) => {
	try {
		return e();
	} finally {}
} }.effect_internal_function;
(function* () {}).constructor;
// node_modules/effect/dist/esm/Hash.js
var it = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Hash/randomHashCache"), () => /* @__PURE__ */ new WeakMap()), T = /*#__PURE__*/ Symbol.for("effect/Hash"), E = (e) => {
	if (nt.enabled === !0) return 0;
	switch (typeof e) {
		case "number": return ct(e);
		case "bigint": return O(e.toString(10));
		case "boolean": return O(String(e));
		case "symbol": return O(String(e));
		case "string": return O(e);
		case "undefined": return O("undefined");
		case "function":
		case "object": return e === null ? O("null") : e instanceof Date ? Number.isNaN(e.getTime()) ? O("Invalid Date") : E(e.toISOString()) : e instanceof URL ? E(e.href) : st(e) ? e[T]() : at(e);
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, at = (e) => (it.has(e) || it.set(e, ct(Math.floor(Math.random() * (2 ** 53 - 1)))), it.get(e)), D = (e) => (t) => t * 53 ^ e, ot = (e) => e & 3221225471 | e >>> 1 & 1073741824, st = (e) => C(e, T), ct = (e) => {
	if (e !== e || e === Infinity) return 0;
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return ot(t);
}, O = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return ot(t);
}, lt = (e, t) => {
	let n = 12289;
	for (let r = 0; r < t.length; r++) n ^= x(O(t[r]), D(E(e[t[r]])));
	return ot(n);
}, ut = (e) => lt(e, Object.keys(e)), dt = (e) => {
	let t = 6151;
	for (let n = 0; n < e.length; n++) t = x(t, D(E(e[n])));
	return ot(t);
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
	return arguments.length === 1 ? (e) => ft(e, arguments[0]) : ft(arguments[0], arguments[1]);
}
function ft(e, t) {
	if (e === t) return !0;
	let n = typeof e;
	if (n !== typeof t) return !1;
	if (n === "object" || n === "function") {
		if (e !== null && t !== null) {
			if (pt(e) && pt(t)) return E(e) === E(t) && e[A](t) ? !0 : nt.enabled && nt.tester ? nt.tester(e, t) : !1;
			if (e instanceof Date && t instanceof Date) {
				let n = e.getTime(), r = t.getTime();
				return n === r || Number.isNaN(n) && Number.isNaN(r);
			}
			if (e instanceof URL && t instanceof URL) return e.href === t.href;
		}
		if (nt.enabled) {
			if (e === null || t === null) return !1;
			if (Array.isArray(e) && Array.isArray(t)) return e.length === t.length && e.every((e, n) => ft(e, t[n]));
			if (Object.getPrototypeOf(e) === Object.prototype && Object.getPrototypeOf(t) === Object.prototype) {
				let n = Object.keys(e), r = Object.keys(t);
				if (n.length === r.length) {
					for (let r of n) if (!(r in t && ft(e[r], t[r]))) return nt.tester ? nt.tester(e, t) : !1;
					return !0;
				}
			}
			return nt.tester ? nt.tester(e, t) : !1;
		}
	}
	return nt.enabled && nt.tester ? nt.tester(e, t) : !1;
}
var pt = (e) => C(e, A), mt = () => j, M = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), N = (e) => {
	try {
		if (C(e, "toJSON") && Fe(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(N);
	} catch {
		return {};
	}
	return xt(e);
}, P = (e) => JSON.stringify(e, null, 2), ht = (e, t = 2) => {
	if (typeof e == "string") return e;
	try {
		return typeof e == "object" ? gt(e, t) : String(e);
	} catch {
		return String(e);
	}
}, gt = (e, t) => {
	let n = [], r = JSON.stringify(e, (e, t) => typeof t == "object" && t ? n.includes(t) ? void 0 : n.push(t) && (yt.fiberRefs !== void 0 && vt(t) ? t[_t](yt.fiberRefs) : t) : t, t);
	return n = void 0, r;
}, _t = /*#__PURE__*/ Symbol.for("effect/Inspectable/Redactable"), vt = (e) => typeof e == "object" && !!e && _t in e, yt = /*#__PURE__*/ S("effect/Inspectable/redactableState", () => ({ fiberRefs: void 0 })), bt = (e, t) => {
	let n = yt.fiberRefs;
	yt.fiberRefs = e;
	try {
		return t();
	} finally {
		yt.fiberRefs = n;
	}
}, xt = (e) => vt(e) && yt.fiberRefs !== void 0 ? e[_t](yt.fiberRefs) : e, F = (e, t) => {
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
}, St = "Async", Ct = "Commit", wt = "Failure", Tt = "OnFailure", Et = "OnSuccess", Dt = "OnSuccessAndFailure", Ot = "Success", kt = "Sync", At = "UpdateRuntimeFlags", jt = "While", Mt = "Iterator", Nt = "WithRuntime", Pt = "Yield", Ft = "RevertFlags", It = "3.22.2", Lt = () => It, Rt = /*#__PURE__*/ Symbol.for("effect/Effect"), zt = /*#__PURE__*/ Symbol.for("effect/Stream"), Bt = /*#__PURE__*/ Symbol.for("effect/Sink"), Vt = /*#__PURE__*/ Symbol.for("effect/Channel"), Ht = {
	/* c8 ignore next */
	_R: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e,
	_V: /*#__PURE__*/ Lt()
}, Ut = {
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
}, Wt = {
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
}, Gt = {
	[Rt]: Ht,
	[zt]: Ht,
	[Bt]: Ut,
	[Vt]: Wt,
	[A](e) {
		return this === e;
	},
	[T]() {
		return k(this, at(this));
	},
	[Symbol.iterator]() {
		return new Ue(new et(this));
	},
	pipe() {
		return F(this, arguments);
	}
}, Kt = {
	[T]() {
		return k(this, ut(this));
	},
	[A](e) {
		let t = Object.keys(this), n = Object.keys(e);
		if (t.length !== n.length) return !1;
		for (let n of t) if (!(n in e && j(this[n], e[n]))) return !1;
		return !0;
	}
}, qt = {
	...Gt,
	_op: Ct
}, Jt = {
	...qt,
	...Kt
}, Yt = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = qt, e;
}(), Xt = /*#__PURE__*/ Symbol.for("effect/Option"), Zt = {
	...Gt,
	[Xt]: { _A: (e) => e },
	[M]() {
		return this.toJSON();
	},
	toString() {
		return P(this.toJSON());
	}
}, Qt = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Zt), {
	_tag: "Some",
	_op: "Some",
	[A](e) {
		return tn(e) && rn(e) && j(this.value, e.value);
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
}), $t = /*#__PURE__*/ E("None"), en = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Zt), {
	_tag: "None",
	_op: "None",
	[A](e) {
		return tn(e) && nn(e);
	},
	[T]() {
		return $t;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), tn = (e) => C(e, Xt), nn = (e) => e._tag === "None", rn = (e) => e._tag === "Some", an = /*#__PURE__*/ Object.create(en), on = (e) => {
	let t = Object.create(Qt);
	return t.value = e, t;
}, sn = /*#__PURE__*/ Symbol.for("effect/Either"), cn = {
	...Gt,
	[sn]: { _R: (e) => e },
	[M]() {
		return this.toJSON();
	},
	toString() {
		return P(this.toJSON());
	}
}, ln = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(cn), {
	_tag: "Right",
	_op: "Right",
	[A](e) {
		return dn(e) && pn(e) && j(this.right, e.right);
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
}), un = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(cn), {
	_tag: "Left",
	_op: "Left",
	[A](e) {
		return dn(e) && fn(e) && j(this.left, e.left);
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
}), dn = (e) => C(e, sn), fn = (e) => e._tag === "Left", pn = (e) => e._tag === "Right", mn = (e) => {
	let t = Object.create(un);
	return t.left = e, t;
}, hn = (e) => {
	let t = Object.create(ln);
	return t.right = e, t;
}, gn = mn, _n = fn, vn = pn, yn = /*#__PURE__*/ (/* @__PURE__ */ y(2, (e, { onLeft: t, onRight: n }) => _n(e) ? t(e.left) : n(e.right)))({
	onLeft: b,
	onRight: b
}), bn = (e) => e.length > 0, xn = (e) => (t, n) => t === n ? 0 : e(t, n), Sn = /*#__PURE__*/ xn((e, t) => e < t ? -1 : 1), Cn = /*#__PURE__*/ y(2, (e, t) => xn((n, r) => e(t(n), t(r)))), wn = (e) => y(2, (t, n) => e(t, n) === 1), I = () => an, L = on, Tn = nn, En = rn, Dn = /*#__PURE__*/ y(2, (e, { onNone: t, onSome: n }) => Tn(e) ? t() : n(e.value)), On = /*#__PURE__*/ y(2, (e, t) => Tn(e) ? t() : e.value), kn = /*#__PURE__*/ y(2, (e, t) => Tn(e) ? L(t()) : e), An = (e) => e == null ? I() : L(e), jn = /*#__PURE__*/ On(Te), Mn = /*#__PURE__*/ y(2, (e, t) => Tn(e) ? I() : L(t(e.value))), Nn = /*#__PURE__*/ y(2, (e, t) => Tn(e) ? I() : t(e.value)), Pn = /*#__PURE__*/ ((e) => y(2, (t, n) => !Tn(t) && e(t.value, n)))(/* @__PURE__ */ mt()), Fn = (...e) => e, In = (e) => Array(e), Ln = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.max(1, Math.floor(e)), r = Array(n);
	for (let e = 0; e < n; e++) r[e] = t(e);
	return r;
}), R = (e) => Array.isArray(e) ? e : Array.from(e), Rn = (e) => Array.isArray(e) ? e : [e], zn = /*#__PURE__*/ y(2, (e, t) => [t, ...e]), Bn = /*#__PURE__*/ y(2, (e, t) => [...e, t]), Vn = /*#__PURE__*/ y(2, (e, t) => R(e).concat(R(t)));
Array.isArray;
var Hn = (e) => e.length === 0, Un = bn, Wn = bn, Gn = (e, t) => e < 0 || e >= t.length, Kn = (e, t) => Math.floor(Math.min(Math.max(0, e), t.length)), qn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.floor(t);
	return Gn(n, e) ? I() : L(e[n]);
}), Jn = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.floor(t);
	if (Gn(n, e)) throw Error(`Index ${n} out of bounds`);
	return e[n];
}), Yn = /*#__PURE__*/ qn(0), Xn = /*#__PURE__*/ Jn(0), Zn = (e) => Wn(e) ? L(Qn(e)) : I(), Qn = (e) => e[e.length - 1], $n = (e) => e.slice(1), er = (e, t) => {
	let n = 0;
	for (let r of e) {
		if (!t(r, n)) break;
		n++;
	}
	return n;
}, tr = /*#__PURE__*/ y(2, (e, t) => cr(e, er(e, t))), nr = /*#__PURE__*/ y(2, (e, t) => {
	let n = R(e);
	return n.slice(Kn(t, n), n.length);
}), rr = (e) => Array.from(e).reverse(), ir = /*#__PURE__*/ y(2, (e, t) => {
	let n = Array.from(e);
	return n.sort(t), n;
}), ar = /*#__PURE__*/ y(2, (e, t) => or(e, t, Fn)), or = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = R(e), i = R(t);
	if (Wn(r) && Wn(i)) {
		let e = [n(Xn(r), Xn(i))], t = Math.min(r.length, i.length);
		for (let a = 1; a < t; a++) e[a] = n(r[a], i[a]);
		return e;
	}
	return [];
}), sr = /*#__PURE__*/ mt(), cr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Array.from(e), r = Math.floor(t);
	return Wn(n) ? r >= 1 ? lr(n, r) : [[], n] : [n, []];
}), lr = /*#__PURE__*/ y(2, (e, t) => {
	let n = Math.max(1, Math.floor(t));
	return n >= e.length ? [ur(e), []] : [zn(e.slice(1, n), Xn(e)), e.slice(n)];
}), ur = (e) => e.slice(), dr = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = R(e), i = R(t);
	return Wn(r) ? Wn(i) ? br(n)(Vn(r, i)) : r : i;
}), fr = /*#__PURE__*/ y(2, (e, t) => dr(e, t, sr)), pr = () => [], mr = (e) => [e], hr = /*#__PURE__*/ y(2, (e, t) => e.map(t)), gr = /*#__PURE__*/ (/* @__PURE__ */ y(2, (e, t) => {
	if (Hn(e)) return [];
	let n = [];
	for (let r = 0; r < e.length; r++) {
		let i = t(e[r], r);
		for (let e = 0; e < i.length; e++) n.push(i[e]);
	}
	return n;
}))(b), _r = /*#__PURE__*/ y(3, (e, t, n) => R(e).reduce((e, t, r) => n(e, t, r), t)), vr = (e, t) => {
	let n = [], r = e, i;
	for (; En(i = t(r));) {
		let [e, t] = i.value;
		n.push(e), r = t;
	}
	return n;
}, yr = ke, br = /*#__PURE__*/ y(2, (e, t) => {
	let n = R(e);
	if (Wn(n)) {
		let e = [Xn(n)], r = $n(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), xr = (e) => br(e, mt()), Sr = /*#__PURE__*/ y(2, (e, t) => R(e).join(t)), Cr = Sn, wr = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"), Tr = /*#__PURE__*/ Symbol.for("effect/Context/Tag"), Er = /*#__PURE__*/ Symbol.for("effect/Context/Reference"), Dr = /*#__PURE__*/ Symbol.for("effect/STM"), Or = {
	...Gt,
	_op: "Tag",
	[Dr]: Ht,
	[Tr]: {
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
		return Hr(this, e);
	}
}, kr = {
	...Or,
	[Er]: Er
}, Ar = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	let r = Object.create(Or);
	return Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r.key = e, r;
}, jr = (e) => () => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	function r() {}
	return Object.setPrototypeOf(r, Or), r.key = e, Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r;
}, Mr = () => (e, t) => {
	let n = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let r = /* @__PURE__ */ Error();
	Error.stackTraceLimit = n;
	function i() {}
	return Object.setPrototypeOf(i, kr), i.key = e, i.defaultValue = t.defaultValue, Object.defineProperty(i, "stack", { get() {
		return r.stack;
	} }), i;
}, Nr = /*#__PURE__*/ Symbol.for("effect/Context"), Pr = {
	[Nr]: { _Services: (e) => e },
	[A](e) {
		if (Lr(e) && this.unsafeMap.size === e.unsafeMap.size) {
			for (let t of this.unsafeMap.keys()) if (!e.unsafeMap.has(t) || !j(this.unsafeMap.get(t), e.unsafeMap.get(t))) return !1;
			return !0;
		}
		return !1;
	},
	[T]() {
		return k(this, ct(this.unsafeMap.size));
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
}, Fr = (e) => {
	let t = Object.create(Pr);
	return t.unsafeMap = e, t;
}, Ir = (e) => {
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
}, Lr = (e) => C(e, Nr), Rr = (e) => C(e, Tr), zr = (e) => C(e, Er), Br = /*#__PURE__*/ Fr(/*#__PURE__*/ new Map()), Vr = () => Br, Hr = (e, t) => Fr(/* @__PURE__ */ new Map([[e.key, t]])), Ur = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = new Map(e.unsafeMap);
	return r.set(t.key, n), Fr(r);
}), Wr = /*#__PURE__*/ S("effect/Context/defaultValueCache", () => /* @__PURE__ */ new Map()), Gr = (e) => {
	if (Wr.has(e.key)) return Wr.get(e.key);
	let t = e.defaultValue();
	return Wr.set(e.key, t), t;
}, Kr = (e, t) => e.unsafeMap.has(t.key) ? e.unsafeMap.get(t.key) : Gr(t), qr = /*#__PURE__*/ y(2, (e, t) => {
	if (!e.unsafeMap.has(t.key)) {
		if (Er in t) return Gr(t);
		throw Ir(t);
	}
	return e.unsafeMap.get(t.key);
}), Jr = qr, Yr = /*#__PURE__*/ y(2, (e, t) => e.unsafeMap.has(t.key) ? on(e.unsafeMap.get(t.key)) : zr(t) ? on(Gr(t)) : an), Xr = /*#__PURE__*/ y(2, (e, t) => {
	let n = new Map(e.unsafeMap);
	for (let [e, r] of t.unsafeMap) n.set(e, r);
	return Fr(n);
}), Zr = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n = 0; n < e.length; n++) e[n].unsafeMap.forEach((e, n) => {
		t.set(n, e);
	});
	return Fr(t);
}, Qr = Ar, $r = Lr, ei = Rr, ti = Vr, ni = Hr, ri = Ur, ii = Jr, ai = qr, oi = Yr, si = Xr, ci = Zr, li = jr, ui = Mr, di = /*#__PURE__*/ Symbol.for("effect/Chunk");
function fi(e, t, n, r, i) {
	for (let a = t; a < Math.min(e.length, t + i); a++) n[r + a - t] = e[a];
	return n;
}
var pi = [], mi = /*#__PURE__*/ ((e) => De((t, n) => t.length === n.length && Ci(t).every((t, r) => e(t, Oi(n, r)))))(j), hi = {
	[di]: { _A: (e) => e },
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Chunk",
			values: Ci(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	[A](e) {
		return gi(e) && mi(this, e);
	},
	[T]() {
		return k(this, dt(Ci(this)));
	},
	[Symbol.iterator]() {
		switch (this.backing._tag) {
			case "IArray": return this.backing.array[Symbol.iterator]();
			case "IEmpty": return pi[Symbol.iterator]();
			default: return Ci(this)[Symbol.iterator]();
		}
	},
	pipe() {
		return F(this, arguments);
	}
}, z = (e) => {
	let t = Object.create(hi);
	switch (t.backing = e, e._tag) {
		case "IEmpty":
			t.length = 0, t.depth = 0, t.left = t, t.right = t;
			break;
		case "IConcat":
			t.length = e.left.length + e.right.length, t.depth = 1 + Math.max(e.left.depth, e.right.depth), t.left = e.left, t.right = e.right;
			break;
		case "IArray":
			t.length = e.array.length, t.depth = 0, t.left = _i, t.right = _i;
			break;
		case "ISingleton":
			t.length = 1, t.depth = 0, t.left = _i, t.right = _i;
			break;
		case "ISlice": t.length = e.length, t.depth = e.chunk.depth + 1, t.left = _i, t.right = _i;
	}
	return t;
}, gi = (e) => C(e, di), _i = /*#__PURE__*/ z({ _tag: "IEmpty" }), vi = () => _i, yi = (...e) => Di(e), bi = (e) => z({
	_tag: "ISingleton",
	a: e
}), xi = (e) => gi(e) ? e : Ei(R(e)), Si = (e, t, n) => {
	switch (e.backing._tag) {
		case "IArray":
			fi(e.backing.array, 0, t, n, e.length);
			break;
		case "IConcat":
			Si(e.left, t, n), Si(e.right, t, n + e.left.length);
			break;
		case "ISingleton":
			t[n] = e.backing.a;
			break;
		case "ISlice": {
			let r = 0, i = n;
			for (; r < e.length;) t[i] = Oi(e, r), r += 1, i += 1;
			break;
		}
	}
}, Ci = (e) => {
	switch (e.backing._tag) {
		case "IEmpty": return pi;
		case "IArray": return e.backing.array;
		default: {
			let t = Array(e.length);
			return Si(e, t, 0), e.backing = {
				_tag: "IArray",
				array: t
			}, e.left = _i, e.right = _i, e.depth = 0, t;
		}
	}
}, wi = (e) => {
	switch (e.backing._tag) {
		case "IEmpty":
		case "ISingleton": return e;
		case "IArray": return z({
			_tag: "IArray",
			array: rr(e.backing.array)
		});
		case "IConcat": return z({
			_tag: "IConcat",
			left: wi(e.backing.right),
			right: wi(e.backing.left)
		});
		case "ISlice": return Ei(rr(Ci(e)));
	}
}, Ti = /*#__PURE__*/ y(2, (e, t) => t < 0 || t >= e.length ? I() : L(Oi(e, t))), Ei = (e) => e.length === 0 ? vi() : e.length === 1 ? bi(e[0]) : z({
	_tag: "IArray",
	array: e
}), Di = (e) => Ei(e), Oi = /*#__PURE__*/ y(2, (e, t) => {
	switch (e.backing._tag) {
		case "IEmpty": throw Error("Index out of bounds");
		case "ISingleton":
			if (t !== 0) throw Error("Index out of bounds");
			return e.backing.a;
		case "IArray":
			if (t >= e.length || t < 0) throw Error("Index out of bounds");
			return e.backing.array[t];
		case "IConcat": return t < e.left.length ? Oi(e.left, t) : Oi(e.right, t - e.left.length);
		case "ISlice": return Oi(e.backing.chunk, t + e.backing.offset);
	}
}), ki = /*#__PURE__*/ y(2, (e, t) => Mi(e, bi(t))), Ai = /*#__PURE__*/ y(2, (e, t) => Mi(bi(t), e)), ji = /*#__PURE__*/ y(2, (e, t) => {
	if (t <= 0) return e;
	if (t >= e.length) return _i;
	switch (e.backing._tag) {
		case "ISlice": return z({
			_tag: "ISlice",
			chunk: e.backing.chunk,
			offset: e.backing.offset + t,
			length: e.backing.length - t
		});
		case "IConcat": return t > e.left.length ? ji(e.right, t - e.left.length) : z({
			_tag: "IConcat",
			left: ji(e.left, t),
			right: e.right
		});
		default: return z({
			_tag: "ISlice",
			chunk: e,
			offset: t,
			length: e.length - t
		});
	}
}), Mi = /*#__PURE__*/ y(2, (e, t) => {
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
			let n = Mi(e.right, t);
			return z({
				_tag: "IConcat",
				left: e.left,
				right: n
			});
		}
		{
			let n = Mi(e.right.right, t);
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
		left: Mi(e, t.left),
		right: t.right
	});
	{
		let n = Mi(e, t.left.left);
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
}), Ni = (e) => e.length === 0, Pi = (e) => e.length > 0, Fi = /*#__PURE__*/ Ti(0), Ii = (e) => Oi(e, 0), Li = Ii, Ri = (e) => ji(e, 1), zi = /*#__PURE__*/ Symbol.for("effect/Duration"), Bi = /*#__PURE__*/ BigInt(0), Vi = /*#__PURE__*/ BigInt(24), Hi = /*#__PURE__*/ BigInt(60), Ui = /*#__PURE__*/ BigInt(1e3), Wi = /*#__PURE__*/ BigInt(1e6), Gi = /*#__PURE__*/ BigInt(1e9), Ki = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, qi = (e) => {
	if (Qi(e)) return e;
	if (Ne(e)) return ia(e);
	if (Pe(e)) return na(e);
	if (Array.isArray(e) && e.length === 2 && e.every(Ne)) return e[0] === -Infinity || e[1] === -Infinity || Number.isNaN(e[0]) || Number.isNaN(e[1]) ? ea : e[0] === Infinity || e[1] === Infinity ? ta : na(BigInt(Math.round(e[0] * 1e9)) + BigInt(Math.round(e[1])));
	if (Me(e)) {
		let t = Ki.exec(e);
		if (t) {
			let [e, n, r] = t, i = Number(n);
			switch (r) {
				case "nano":
				case "nanos": return na(BigInt(n));
				case "micro":
				case "micros": return ra(BigInt(n));
				case "milli":
				case "millis": return ia(i);
				case "second":
				case "seconds": return aa(i);
				case "minute":
				case "minutes": return oa(i);
				case "hour":
				case "hours": return sa(i);
				case "day":
				case "days": return ca(i);
				case "week":
				case "weeks": return la(i);
			}
		}
	}
	throw Error("Invalid DurationInput");
}, Ji = {
	_tag: "Millis",
	millis: 0
}, Yi = { _tag: "Infinity" }, Xi = {
	[zi]: zi,
	[T]() {
		return k(this, ut(this.value));
	},
	[A](e) {
		return Qi(e) && va(this, e);
	},
	toString() {
		return `Duration(${ba(this)})`;
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
				hrtime: fa(this)
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
}, Zi = (e) => {
	let t = Object.create(Xi);
	return t.value = Ne(e) ? isNaN(e) || e <= 0 ? Ji : Number.isFinite(e) ? Number.isInteger(e) ? {
		_tag: "Millis",
		millis: e
	} : {
		_tag: "Nanos",
		nanos: BigInt(Math.round(e * 1e6))
	} : Yi : e <= Bi ? Ji : {
		_tag: "Nanos",
		nanos: e
	}, t;
}, Qi = (e) => C(e, zi), $i = (e) => {
	switch (e.value._tag) {
		case "Millis": return e.value.millis === 0;
		case "Nanos": return e.value.nanos === Bi;
		case "Infinity": return !1;
	}
}, ea = /*#__PURE__*/ Zi(0), ta = /*#__PURE__*/ Zi(Infinity), na = (e) => Zi(e), ra = (e) => Zi(e * Ui), ia = (e) => Zi(e), aa = (e) => Zi(e * 1e3), oa = (e) => Zi(e * 6e4), sa = (e) => Zi(e * 36e5), ca = (e) => Zi(e * 864e5), la = (e) => Zi(e * 6048e5), ua = (e) => pa(e, {
	onMillis: (e) => e,
	onNanos: (e) => Number(e) / 1e6
}), da = (e) => {
	let t = qi(e);
	switch (t.value._tag) {
		case "Infinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return BigInt(Math.round(t.value.millis * 1e6));
	}
}, fa = (e) => {
	let t = qi(e);
	switch (t.value._tag) {
		case "Infinity": return [Infinity, 0];
		case "Nanos": return [Number(t.value.nanos / Gi), Number(t.value.nanos % Gi)];
		case "Millis": return [Math.floor(t.value.millis / 1e3), Math.round(t.value.millis % 1e3 * 1e6)];
	}
}, pa = /*#__PURE__*/ y(2, (e, t) => {
	let n = qi(e);
	switch (n.value._tag) {
		case "Nanos": return t.onNanos(n.value.nanos);
		case "Infinity": return t.onMillis(Infinity);
		case "Millis": return t.onMillis(n.value.millis);
	}
}), ma = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = qi(e), i = qi(t);
	if (r.value._tag === "Infinity" || i.value._tag === "Infinity") return n.onMillis(ua(r), ua(i));
	if (r.value._tag === "Nanos" || i.value._tag === "Nanos") {
		let e = r.value._tag === "Nanos" ? r.value.nanos : BigInt(Math.round(r.value.millis * 1e6)), t = i.value._tag === "Nanos" ? i.value.nanos : BigInt(Math.round(i.value.millis * 1e6));
		return n.onNanos(e, t);
	}
	return n.onMillis(r.value.millis, i.value.millis);
}), ha = (e, t) => ma(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t
}), ga = /*#__PURE__*/ y(2, (e, t) => ma(e, t, {
	onMillis: (e, t) => e <= t,
	onNanos: (e, t) => e <= t
})), _a = /*#__PURE__*/ y(2, (e, t) => ma(e, t, {
	onMillis: (e, t) => e >= t,
	onNanos: (e, t) => e >= t
})), va = /*#__PURE__*/ y(2, (e, t) => ha(qi(e), qi(t))), ya = (e) => {
	let t = qi(e);
	if (t.value._tag === "Infinity") return {
		days: Infinity,
		hours: Infinity,
		minutes: Infinity,
		seconds: Infinity,
		millis: Infinity,
		nanos: Infinity
	};
	let n = da(t), r = n / Wi, i = r / Ui, a = i / Hi, o = a / Hi, s = o / Vi;
	return {
		days: Number(s),
		hours: Number(o % Vi),
		minutes: Number(a % Hi),
		seconds: Number(i % Hi),
		millis: Number(r % Ui),
		nanos: Number(n % Wi)
	};
}, ba = (e) => {
	let t = qi(e);
	if (t.value._tag === "Infinity") return "Infinity";
	if ($i(t)) return "0";
	let n = ya(t), r = [];
	return n.days !== 0 && r.push(`${n.days}d`), n.hours !== 0 && r.push(`${n.hours}h`), n.minutes !== 0 && r.push(`${n.minutes}m`), n.seconds !== 0 && r.push(`${n.seconds}s`), n.millis !== 0 && r.push(`${n.millis}ms`), n.nanos !== 0 && r.push(`${n.nanos}ns`), r.join(" ");
}, xa = 32, Sa = xa - 1, Ca = xa / 2, wa = xa / 4;
// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function Ta(e) {
	return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), e = e + (e >> 4) & 252645135, e += e >> 8, e += e >> 16, e & 127;
}
function Ea(e, t) {
	return t >>> e & Sa;
}
function Da(e) {
	return 1 << e;
}
function Oa(e, t) {
	return Ta(e & t - 1);
}
// node_modules/effect/dist/esm/internal/stack.js
var ka = (e, t) => ({
	value: e,
	previous: t
});
// node_modules/effect/dist/esm/internal/hashMap/array.js
function Aa(e, t, n, r) {
	let i = r;
	if (!e) {
		let e = r.length;
		i = Array(e);
		for (let t = 0; t < e; ++t) i[t] = r[t];
	}
	return i[t] = n, i;
}
function ja(e, t, n) {
	let r = n.length - 1, i = 0, a = 0, o = n;
	if (e) i = a = t;
	else for (o = Array(r); i < t;) o[a++] = n[i++];
	for (++i; i <= r;) o[a++] = n[i++];
	return e && (o.length = r), o;
}
function Ma(e, t, n, r) {
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
var Na = class e {
	_tag = "EmptyNode";
	modify(t, n, r, i, a, o) {
		let s = r(I());
		return Tn(s) ? new e() : (++o.value, new La(t, i, a, s));
	}
};
function Pa(e) {
	return Re(e, "EmptyNode");
}
function Fa(e) {
	return Pa(e) || e._tag === "LeafNode" || e._tag === "CollisionNode";
}
function Ia(e, t) {
	return !Pa(e) && t === e.edit;
}
var La = class e {
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
			return n === this.value ? this : Tn(n) ? (--o.value, new Na()) : Ia(this, t) ? (this.value = n, this) : new e(t, i, a, n);
		}
		let s = r(I());
		return Tn(s) ? this : (++o.value, Wa(t, n, this.hash, this, i, new e(t, i, a, s)));
	}
}, Ra = class e {
	edit;
	hash;
	children;
	_tag = "CollisionNode";
	constructor(e, t, n) {
		this.edit = e, this.hash = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		if (i === this.hash) {
			let n = Ia(this, t), i = this.updateCollisionList(n, t, this.hash, this.children, r, a, o);
			return i === this.children ? this : i.length > 1 ? new e(t, this.hash, i) : i[0];
		}
		let s = r(I());
		return Tn(s) ? this : (++o.value, Wa(t, n, this.hash, this, i, new La(t, i, a, s)));
	}
	updateCollisionList(e, t, n, r, i, a, o) {
		let s = r.length;
		for (let c = 0; c < s; ++c) {
			let s = r[c];
			if ("key" in s && j(a, s.key)) {
				let l = s.value, u = i(l);
				return u === l ? r : Tn(u) ? (--o.value, ja(e, c, r)) : Aa(e, c, new La(t, n, a, u), r);
			}
		}
		let c = i(I());
		return Tn(c) ? r : (++o.value, Aa(e, s, new La(t, n, a, c), r));
	}
}, za = class e {
	edit;
	mask;
	children;
	_tag = "IndexedNode";
	constructor(e, t, n) {
		this.edit = e, this.mask = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.mask, c = this.children, l = Ea(n, i), u = Da(l), d = Oa(s, u), f = s & u, p = Ia(this, t);
		if (!f) {
			let f = new Na().modify(t, n + 5, r, i, a, o);
			return f ? c.length >= Ca ? Ha(t, l, f, s, c) : new e(t, s | u, Ma(p, d, f, c)) : this;
		}
		let m = c[d], ee = m.modify(t, n + 5, r, i, a, o);
		if (m === ee) return this;
		let te = s, ne;
		if (Pa(ee)) {
			if (te &= ~u, !te) return new Na();
			if (c.length <= 2 && Fa(c[d ^ 1])) return c[d ^ 1];
			ne = ja(p, d, c);
		} else ne = Aa(p, d, ee, c);
		return p ? (this.mask = te, this.children = ne, this) : new e(t, te, ne);
	}
}, Ba = class e {
	edit;
	size;
	children;
	_tag = "ArrayNode";
	constructor(e, t, n) {
		this.edit = e, this.size = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.size, c = this.children, l = Ea(n, i), u = c[l], d = (u || new Na()).modify(t, n + 5, r, i, a, o);
		if (u === d) return this;
		let f = Ia(this, t), p;
		if (Pa(u) && !Pa(d)) ++s, p = Aa(f, l, d, c);
		else if (!Pa(u) && Pa(d)) {
			if (--s, s <= wa) return Va(t, s, l, c);
			p = Aa(f, l, new Na(), c);
		} else p = Aa(f, l, d, c);
		return f ? (this.size = s, this.children = p, this) : new e(t, s, p);
	}
};
function Va(e, t, n, r) {
	let i = Array(t - 1), a = 0, o = 0;
	for (let e = 0, t = r.length; e < t; ++e) if (e !== n) {
		let t = r[e];
		t && !Pa(t) && (i[a++] = t, o |= 1 << e);
	}
	return new za(e, o, i);
}
function Ha(e, t, n, r, i) {
	let a = [], o = r, s = 0;
	for (let e = 0; o; ++e) o & 1 && (a[e] = i[s++]), o >>>= 1;
	return a[t] = n, new Ba(e, s + 1, a);
}
function Ua(e, t, n, r, i, a) {
	if (n === i) return new Ra(e, n, [a, r]);
	let o = Ea(t, n), s = Ea(t, i);
	if (o === s) return (t) => new za(e, Da(o) | Da(s), [t]);
	{
		let t = o < s ? [r, a] : [a, r];
		return new za(e, Da(o) | Da(s), t);
	}
}
function Wa(e, t, n, r, i, a) {
	let o, s = t;
	for (;;) {
		let t = Ua(e, s, n, r, i, a);
		if (typeof t == "function") o = ka(t, o), s += 5;
		else {
			let e = t;
			for (; o != null;) e = o.value(e), o = o.previous;
			return e;
		}
	}
}
// node_modules/effect/dist/esm/internal/hashMap.js
var Ga = "effect/HashMap", Ka = /*#__PURE__*/ Symbol.for(Ga), qa = {
	[Ka]: Ka,
	[Symbol.iterator]() {
		return new Ya(this, (e, t) => [e, t]);
	},
	[T]() {
		let e = E(Ga);
		for (let t of this) e ^= x(E(t[0]), D(E(t[1])));
		return k(this, e);
	},
	[A](e) {
		if (no(e)) {
			if (e._size !== this._size) return !1;
			for (let t of this) {
				let n = x(e, ao(t[0], E(t[0])));
				if (Tn(n) || !j(t[1], n.value)) return !1;
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
}, Ja = (e, t, n, r) => {
	let i = Object.create(qa);
	return i._editable = e, i._edit = t, i._root = n, i._size = r, i;
}, Ya = class e {
	map;
	f;
	v;
	constructor(e, t) {
		this.map = e, this.f = t, this.v = Za(this.map._root, this.f, void 0);
	}
	next() {
		if (Tn(this.v)) return {
			done: !0,
			value: void 0
		};
		let e = this.v.value;
		return this.v = Xa(e.cont), {
			done: !1,
			value: e.value
		};
	}
	[Symbol.iterator]() {
		return new e(this.map, this.f);
	}
}, Xa = (e) => e ? Qa(e[0], e[1], e[2], e[3], e[4]) : I(), Za = (e, t, n = void 0) => {
	switch (e._tag) {
		case "LeafNode": return En(e.value) ? L({
			value: t(e.key, e.value.value),
			cont: n
		}) : Xa(n);
		case "CollisionNode":
		case "ArrayNode":
		case "IndexedNode": {
			let r = e.children;
			return Qa(r.length, r, 0, t, n);
		}
		default: return Xa(n);
	}
}, Qa = (e, t, n, r, i) => {
	for (; n < e;) {
		let a = t[n++];
		if (a && !Pa(a)) return Za(a, r, [
			e,
			t,
			n,
			r,
			i
		]);
	}
	return Xa(i);
}, $a = /*#__PURE__*/ Ja(!1, 0, /*#__PURE__*/ new Na(), 0), eo = () => $a, to = (e) => {
	let t = fo(eo());
	for (let n of e) so(t, n[0], n[1]);
	return po(t);
}, no = (e) => C(e, Ka), ro = (e) => e && Pa(e._root), io = /*#__PURE__*/ y(2, (e, t) => ao(e, t, E(t))), ao = /*#__PURE__*/ y(3, (e, t, n) => {
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
			let e = Da(Ea(i, n));
			if (r.mask & e) {
				r = r.children[Oa(r.mask, e)], i += 5;
				break;
			}
			return I();
		}
		case "ArrayNode":
			if (r = r.children[Ea(i, n)], r) {
				i += 5;
				break;
			}
			return I();
		default: return I();
	}
}), oo = /*#__PURE__*/ y(2, (e, t) => En(ao(e, t, E(t)))), so = /*#__PURE__*/ y(3, (e, t, n) => mo(e, t, () => L(n))), co = /*#__PURE__*/ y(3, (e, t, n) => e._editable ? (e._root = t, e._size = n, e) : t === e._root ? e : Ja(e._editable, e._edit, t, n)), lo = (e) => new Ya(e, (e) => e), uo = (e) => e._size, fo = (e) => Ja(!0, e._edit + 1, e._root, e._size), po = (e) => (e._editable = !1, e), mo = /*#__PURE__*/ y(3, (e, t, n) => ho(e, t, E(t), n)), ho = /*#__PURE__*/ y(4, (e, t, n, r) => {
	let i = { value: e._size };
	return x(e, co(e._root.modify(e._editable ? e._edit : NaN, 0, r, n, t, i), i.value));
}), go = /*#__PURE__*/ y(2, (e, t) => mo(e, t, I)), _o = /*#__PURE__*/ y(2, (e, t) => yo(e, eo(), (e, n, r) => so(e, r, t(n, r)))), vo = /*#__PURE__*/ y(2, (e, t) => yo(e, void 0, (e, n, r) => t(n, r))), yo = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = e._root;
	if (r._tag === "LeafNode") return En(r.value) ? n(t, r.value.value, r.key) : t;
	if (r._tag === "EmptyNode") return t;
	let i = [r.children], a;
	for (; a = i.pop();) for (let e = 0, r = a.length; e < r;) {
		let r = a[e++];
		r && !Pa(r) && (r._tag === "LeafNode" ? En(r.value) && (t = n(t, r.value.value, r.key)) : i.push(r.children));
	}
	return t;
}), bo = "effect/HashSet", xo = /*#__PURE__*/ Symbol.for(bo), So = {
	[xo]: xo,
	[Symbol.iterator]() {
		return lo(this._keyMap);
	},
	[T]() {
		return k(this, D(E(this._keyMap))(E(bo)));
	},
	[A](e) {
		return wo(e) ? uo(this._keyMap) === uo(e._keyMap) && j(this._keyMap, e._keyMap) : !1;
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
}, Co = (e) => {
	let t = Object.create(So);
	return t._keyMap = e, t;
}, wo = (e) => C(e, xo), To = /*#__PURE__*/ Co(/*#__PURE__*/ eo()), Eo = () => To, Do = (e) => {
	let t = jo(Eo());
	for (let n of e) Po(t, n);
	return Mo(t);
}, Oo = (...e) => {
	let t = jo(Eo());
	for (let n of e) Po(t, n);
	return Mo(t);
}, ko = /*#__PURE__*/ y(2, (e, t) => oo(e._keyMap, t)), Ao = (e) => uo(e._keyMap), jo = (e) => Co(fo(e._keyMap)), Mo = (e) => (e._keyMap._editable = !1, e), No = /*#__PURE__*/ y(2, (e, t) => {
	let n = jo(e);
	return t(n), Mo(n);
}), Po = /*#__PURE__*/ y(2, (e, t) => e._keyMap._editable ? (so(t, !0)(e._keyMap), e) : Co(so(t, !0)(e._keyMap))), Fo = /*#__PURE__*/ y(2, (e, t) => e._keyMap._editable ? (go(t)(e._keyMap), e) : Co(go(t)(e._keyMap))), Io = /*#__PURE__*/ y(2, (e, t) => No(e, (e) => {
	for (let n of t) Fo(e, n);
})), Lo = /*#__PURE__*/ y(2, (e, t) => No(Eo(), (n) => {
	Ro(e, (e) => Po(n, e));
	for (let e of t) Po(n, e);
})), Ro = /*#__PURE__*/ y(2, (e, t) => vo(e._keyMap, (e, n) => t(n))), zo = /*#__PURE__*/ y(3, (e, t, n) => yo(e._keyMap, t, (e, t, r) => n(e, r))), Bo = Eo, Vo = Do, Ho = Oo, Uo = ko, Wo = Ao, Go = Po, Ko = Fo, qo = Io, Jo = Lo, Yo = zo, Xo = /*#__PURE__*/ Symbol.for("effect/MutableRef"), Zo = {
	[Xo]: Xo,
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
}, Qo = (e) => {
	let t = Object.create(Zo);
	return t.current = e, t;
}, $o = (e) => e.current, es = /*#__PURE__*/ y(2, (e, t) => (e.current = t, e)), ts = "effect/FiberId", ns = /*#__PURE__*/ Symbol.for(ts), rs = "None", is = "Runtime", as = "Composite", os = /*#__PURE__*/ O(`${ts}-${rs}`), ss = class {
	[ns] = ns;
	_tag = rs;
	id = -1;
	startTimeMillis = -1;
	[T]() {
		return os;
	}
	[A](e) {
		return us(e) && e._tag === rs;
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
}, cs = class {
	id;
	startTimeMillis;
	[ns] = ns;
	_tag = is;
	constructor(e, t) {
		this.id = e, this.startTimeMillis = t;
	}
	[T]() {
		return k(this, O(`${ts}-${this._tag}-${this.id}-${this.startTimeMillis}`));
	}
	[A](e) {
		return us(e) && e._tag === is && this.id === e.id && this.startTimeMillis === e.startTimeMillis;
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
}, ls = /*#__PURE__*/ new ss(), us = (e) => C(e, ns), ds = (e) => {
	switch (e._tag) {
		case rs: return Bo();
		case is: return Ho(e.id);
		case as: return x(ds(e.left), Jo(ds(e.right)));
	}
}, fs = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => Qo(0)), ps = (e) => Array.from(ds(e)).map((e) => `#${e}`).join(","), ms = () => {
	let e = $o(fs);
	return x(fs, es(e + 1)), new cs(e, Date.now());
}, hs = ls, gs = ds, _s = ps, vs = ms, ys = eo, bs = to, xs = ro, Ss = io, Cs = so, ws = lo, Ts = mo, Es = _o, Ds = yo, Os = /*#__PURE__*/ Symbol.for("effect/List"), ks = (e) => R(e), As = /*#__PURE__*/ ((e) => Oe(yr(e), ks))(j), js = {
	[Os]: Os,
	_tag: "Cons",
	toString() {
		return P(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Cons",
			values: ks(this).map(N)
		};
	},
	[M]() {
		return this.toJSON();
	},
	[A](e) {
		return Fs(e) && this._tag === e._tag && As(this, e);
	},
	[T]() {
		return k(this, dt(ks(this)));
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
}, Ms = (e, t) => {
	let n = Object.create(js);
	return n.head = e, n.tail = t, n;
}, Ns = /*#__PURE__*/ O("Nil"), Ps = /*#__PURE__*/ Object.create({
	[Os]: Os,
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
		return Ns;
	},
	[A](e) {
		return Fs(e) && this._tag === e._tag;
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
}), Fs = (e) => C(e, Os), Is = (e) => e._tag === "Nil", Ls = (e) => e._tag === "Cons", Rs = () => Ps, zs = (e, t) => Ms(e, t), Bs = Rs, Vs = (e) => Ms(e, Ps), Hs = /*#__PURE__*/ y(2, (e, t) => Ws(t, e)), Us = /*#__PURE__*/ y(2, (e, t) => zs(t, e)), Ws = /*#__PURE__*/ y(2, (e, t) => {
	if (Is(e)) return t;
	if (Is(t)) return e;
	{
		let n = Ms(t.head, e), r = n, i = t.tail;
		for (; !Is(i);) {
			let t = Ms(i.head, e);
			r.tail = t, r = t, i = i.tail;
		}
		return n;
	}
}), Gs = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = t, i = e;
	for (; !Is(i);) r = n(r, i.head), i = i.tail;
	return r;
}), Ks = (e) => {
	let t = Bs(), n = e;
	for (; !Is(n);) t = Us(t, n.head), n = n.tail;
	return t;
};
Array.prototype;
var qs = /*#__PURE__*/ function() {
	function e(e) {
		e && Object.assign(this, e);
	}
	return e.prototype = Kt, e;
}(), Js = /*#__PURE__*/ Symbol.for("effect/DifferContextPatch");
function Ys(e) {
	return e;
}
var Xs = {
	...qs.prototype,
	[Js]: {
		_Value: Ys,
		_Patch: Ys
	}
}, Zs = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(Xs), { _tag: "Empty" })), Qs = () => Zs, $s = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Xs), { _tag: "AndThen" }), ec = (e, t) => {
	let n = Object.create($s);
	return n.first = e, n.second = t, n;
}, tc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Xs), { _tag: "AddService" }), nc = (e, t) => {
	let n = Object.create(tc);
	return n.key = e, n.service = t, n;
}, rc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Xs), { _tag: "RemoveService" }), ic = (e) => {
	let t = Object.create(rc);
	return t.key = e, t;
}, ac = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Xs), { _tag: "UpdateService" }), oc = (e, t) => {
	let n = Object.create(ac);
	return n.key = e, n.update = t, n;
}, sc = (e, t) => {
	let n = new Map(e.unsafeMap), r = Qs();
	for (let [e, i] of t.unsafeMap.entries()) if (n.has(e)) {
		let t = n.get(e);
		n.delete(e), j(t, i) || (r = cc(oc(e, () => i))(r));
	} else n.delete(e), r = cc(nc(e, i))(r);
	for (let [e] of n.entries()) r = cc(ic(e))(r);
	return r;
}, cc = /*#__PURE__*/ y(2, (e, t) => ec(e, t)), lc = /*#__PURE__*/ y(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = !1, r = bi(e), i = new Map(t.unsafeMap);
	for (; Pi(r);) {
		let e = Li(r), t = Ri(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AddService":
				i.set(e.key, e.service), r = t;
				break;
			case "AndThen":
				r = Ai(Ai(t, e.second), e.first);
				break;
			case "RemoveService":
				i.delete(e.key), r = t;
				break;
			case "UpdateService": i.set(e.key, e.update(i.get(e.key))), n = !0, r = t;
		}
	}
	if (!n) return Fr(i);
	let a = /* @__PURE__ */ new Map();
	for (let [e] of t.unsafeMap) i.has(e) && (a.set(e, i.get(e)), i.delete(e));
	for (let [e, t] of i) a.set(e, t);
	return Fr(a);
}), uc = /*#__PURE__*/ Symbol.for("effect/DifferHashSetPatch");
function dc(e) {
	return e;
}
var fc = {
	...qs.prototype,
	[uc]: {
		_Value: dc,
		_Key: dc,
		_Patch: dc
	}
}, pc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(fc), { _tag: "Empty" })), mc = () => pc, hc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(fc), { _tag: "AndThen" }), gc = (e, t) => {
	let n = Object.create(hc);
	return n.first = e, n.second = t, n;
}, _c = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(fc), { _tag: "Add" }), vc = (e) => {
	let t = Object.create(_c);
	return t.value = e, t;
}, yc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(fc), { _tag: "Remove" }), bc = (e) => {
	let t = Object.create(yc);
	return t.value = e, t;
}, xc = (e, t) => {
	let [n, r] = Yo([e, mc()], ([e, t], n) => Uo(n)(e) ? [Ko(n)(e), t] : [e, Sc(vc(n))(t)])(t);
	return Yo(r, (e, t) => Sc(bc(t))(e))(n);
}, Sc = /*#__PURE__*/ y(2, (e, t) => gc(e, t)), Cc = /*#__PURE__*/ y(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = t, r = bi(e);
	for (; Pi(r);) {
		let e = Li(r), t = Ri(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AndThen":
				r = Ai(e.first)(Ai(e.second)(t));
				break;
			case "Add":
				n = Go(e.value)(n), r = t;
				break;
			case "Remove": n = Ko(e.value)(n), r = t;
		}
	}
	return n;
}), wc = /*#__PURE__*/ Symbol.for("effect/DifferReadonlyArrayPatch");
function Tc(e) {
	return e;
}
var Ec = {
	...qs.prototype,
	[wc]: {
		_Value: Tc,
		_Patch: Tc
	}
}, Dc = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(Ec), { _tag: "Empty" })), Oc = () => Dc, kc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ec), { _tag: "AndThen" }), Ac = (e, t) => {
	let n = Object.create(kc);
	return n.first = e, n.second = t, n;
}, jc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ec), { _tag: "Append" }), Mc = (e) => {
	let t = Object.create(jc);
	return t.values = e, t;
}, Nc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ec), { _tag: "Slice" }), Pc = (e, t) => {
	let n = Object.create(Nc);
	return n.from = e, n.until = t, n;
}, Fc = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Ec), { _tag: "Update" }), Ic = (e, t) => {
	let n = Object.create(Fc);
	return n.index = e, n.patch = t, n;
}, Lc = (e) => {
	let t = 0, n = Oc();
	for (; t < e.oldValue.length && t < e.newValue.length;) {
		let r = e.oldValue[t], i = e.newValue[t], a = e.differ.diff(r, i);
		j(a, e.differ.empty) || (n = Rc(n, Ic(t, a))), t += 1;
	}
	return t < e.oldValue.length && (n = Rc(n, Pc(0, t))), t < e.newValue.length && (n = Rc(n, Mc(nr(t)(e.newValue)))), n;
}, Rc = /*#__PURE__*/ y(2, (e, t) => Ac(e, t)), zc = /*#__PURE__*/ y(3, (e, t, n) => {
	if (e._tag === "Empty") return t;
	let r = t.slice(), i = mr(e);
	for (; Un(i);) {
		let e = Xn(i), t = $n(i);
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
}), Bc = {
	[/* @__PURE__ */ Symbol.for("effect/Differ")]: {
		_P: b,
		_V: b
	},
	pipe() {
		return F(this, arguments);
	}
}, Vc = (e) => {
	let t = Object.create(Bc);
	return t.empty = e.empty, t.diff = e.diff, t.combine = e.combine, t.patch = e.patch, t;
}, Hc = () => Vc({
	empty: Qs(),
	combine: (e, t) => cc(t)(e),
	diff: (e, t) => sc(e, t),
	patch: (e, t) => lc(t)(e)
}), Uc = () => Vc({
	empty: mc(),
	combine: (e, t) => Sc(t)(e),
	diff: (e, t) => xc(e, t),
	patch: (e, t) => Cc(t)(e)
}), Wc = (e) => Vc({
	empty: Oc(),
	combine: (e, t) => Rc(e, t),
	diff: (t, n) => Lc({
		oldValue: t,
		newValue: n,
		differ: e
	}),
	patch: (t, n) => zc(t, n, e)
}), Gc = () => Kc((e, t) => t), Kc = (e) => Vc({
	empty: b,
	combine: (e, t) => e === b ? t : t === b ? e : (n) => t(e(n)),
	diff: (e, t) => j(e, t) ? b : Se(t),
	patch: (t, n) => e(n, t(n))
}), qc = 255, Jc = 8, Yc = (e) => e & qc, Xc = (e) => e >> Jc & qc, Zc = (e, t) => (e & qc) + ((t & e & qc) << Jc), Qc = /*#__PURE__*/ Zc(0, 0), $c = (e) => Zc(e, e), el = (e) => Zc(e, 0), tl = /*#__PURE__*/ y(2, (e, t) => Zc(Yc(e) & ~t, Xc(e))), nl = /*#__PURE__*/ y(2, (e, t) => e | t), rl = (e) => ~e >>> 0 & qc, il = (e) => ll(e, 32), al = /*#__PURE__*/ y(2, (e, t) => e & ~t), ol = /*#__PURE__*/ y(2, (e, t) => e | t), sl = (e) => cl(e) && !pl(e), cl = (e) => ll(e, 1), ll = /*#__PURE__*/ y(2, (e, t) => (e & t) !== 0), ul = (...e) => e.reduce((e, t) => e | t, 0), dl = /*#__PURE__*/ ul(0), fl = (e) => ll(e, 4), pl = (e) => ll(e, 16), ml = /*#__PURE__*/ y(2, (e, t) => Zc(e ^ t, t)), hl = /*#__PURE__*/ y(2, (e, t) => e & (rl(Yc(t)) | Xc(t)) | Yc(t) & Xc(t)), gl = /*#__PURE__*/ Vc({
	empty: Qc,
	diff: (e, t) => ml(e, t),
	combine: (e, t) => nl(t)(e),
	patch: (e, t) => hl(t, e)
}), _l = $c, vl = el, yl = tl, bl = (e, t) => ({
	_tag: "Par",
	left: e,
	right: t
}), xl = (e, t) => ({
	_tag: "Seq",
	left: e,
	right: t
}), Sl = (e) => {
	let t = Vs(e), n = Bs();
	for (;;) {
		let [e, r] = Gs(t, [Ol(), Bs()], ([e, t], n) => {
			let [r, i] = Cl(n);
			return [Al(e, r), Hs(t, i)];
		});
		if (n = wl(n, e), Is(r)) return Ks(n);
		t = r;
	}
	throw Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, Cl = (e) => {
	let t = e, n = Ol(), r = Bs(), i = Bs();
	for (;;) switch (t._tag) {
		case "Empty":
			if (Is(r)) return [n, i];
			t = r.head, r = r.tail;
			break;
		case "Par":
			r = zs(t.right, r), t = t.left;
			break;
		case "Seq": {
			let e = t.left, n = t.right;
			switch (e._tag) {
				case "Empty":
					t = n;
					break;
				case "Par": {
					let r = e.left, i = e.right;
					t = bl(xl(r, n), xl(i, n));
					break;
				}
				case "Seq": {
					let r = e.left, i = e.right;
					t = xl(r, xl(i, n));
					break;
				}
				case "Single": t = e, i = zs(n, i);
			}
			break;
		}
		case "Single":
			if (n = kl(n, t), Is(r)) return [n, i];
			t = r.head, r = r.tail;
	}
	throw Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, wl = (e, t) => {
	if (Is(e)) return Vs(Nl(t));
	if (jl(t)) return e;
	let n = zl(e.head), r = Ml(t);
	return n.length === 1 && r.length === 1 && j(n[0], r[0]) ? zs(Rl(e.head, Nl(t)), e.tail) : zs(Nl(t), e);
}, Tl = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockParallel"), El = {
/* c8 ignore next */
_R: (e) => e }, Dl = class {
	map;
	[Tl] = El;
	constructor(e) {
		this.map = e;
	}
}, Ol = () => new Dl(ys()), kl = (e, t) => new Dl(Ts(e.map, t.dataSource, (e) => kn(Mn(e, ki(t.blockedRequest)), () => bi(t.blockedRequest)))), Al = (e, t) => new Dl(Ds(e.map, t.map, (e, t, n) => Cs(e, n, Dn(Ss(e, n), {
	onNone: () => t,
	onSome: (e) => Mi(t, e)
})))), jl = (e) => xs(e.map), Ml = (e) => Array.from(ws(e.map)), Nl = (e) => Ll(Es(e.map, (e) => bi(e))), Pl = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockSequential"), Fl = {
/* c8 ignore next */
_R: (e) => e }, Il = class {
	map;
	[Pl] = Fl;
	constructor(e) {
		this.map = e;
	}
}, Ll = (e) => new Il(e), Rl = (e, t) => new Il(Ds(t.map, e.map, (e, t, n) => Cs(e, n, Dn(Ss(e, n), {
	onNone: () => vi(),
	onSome: (e) => Mi(e, t)
})))), zl = (e) => Array.from(ws(e.map)), Bl = (e) => Array.from(e.map), Vl = "Empty", Hl = "Fail", Ul = "Interrupt", Wl = "Parallel", Gl = "Sequential", Kl = "effect/Cause", ql = /*#__PURE__*/ Symbol.for(Kl), Jl = {
/* c8 ignore next */
_E: (e) => e }, Yl = {
	[ql]: Jl,
	[T]() {
		return x(E(Kl), D(E(gu(this))), k(this));
	},
	[A](e) {
		return nu(e) && hu(this, e);
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
		return Eu(this);
	},
	[M]() {
		return this.toJSON();
	}
}, Xl = /*#__PURE__*/ (() => {
	let e = /*#__PURE__*/ Object.create(Yl);
	return e._tag = Vl, e;
})(), Zl = (e) => {
	let t = Object.create(Yl);
	return t._tag = Hl, t.error = e, t;
}, Ql = (e) => {
	let t = Object.create(Yl);
	return t._tag = "Die", t.defect = e, t;
}, $l = (e) => {
	let t = Object.create(Yl);
	return t._tag = Ul, t.fiberId = e, t;
}, eu = (e, t) => {
	let n = Object.create(Yl);
	return n._tag = Wl, n.left = e, n.right = t, n;
}, tu = (e, t) => {
	let n = Object.create(Yl);
	return n._tag = Gl, n.left = e, n.right = t, n;
}, nu = (e) => C(e, ql), ru = (e) => e._tag === Vl, iu = (e) => e._tag === "Empty" || wu(e, !0, (e, t) => {
	switch (t._tag) {
		case Vl: return L(e);
		case "Die":
		case Hl:
		case Ul: return L(!1);
		default: return I();
	}
}), au = (e) => En(fu(e)), ou = (e) => Tu(void 0, bu)(e), su = (e) => wi(wu(e, vi(), (e, t) => t._tag === "Fail" ? L(x(e, Ai(t.error))) : I())), cu = (e) => wi(wu(e, vi(), (e, t) => t._tag === "Die" ? L(x(e, Ai(t.defect))) : I())), lu = (e) => wu(e, Bo(), (e, t) => t._tag === "Interrupt" ? L(x(e, Go(t.fiberId))) : I()), uu = (e) => vu(e, (e) => e._tag === "Fail" ? L(e.error) : I()), du = (e) => {
	let t = uu(e);
	switch (t._tag) {
		case "None": return hn(e);
		case "Some": return gn(t.value);
	}
}, fu = (e) => vu(e, (e) => e._tag === "Interrupt" ? L(e.fiberId) : I()), pu = (e) => Cu(e, {
	onEmpty: Xl,
	onFail: () => Xl,
	onDie: Ql,
	onInterrupt: $l,
	onSequential: tu,
	onParallel: eu
}), mu = (e) => Cu(e, {
	onEmpty: Xl,
	onFail: Ql,
	onDie: Ql,
	onInterrupt: $l,
	onSequential: tu,
	onParallel: eu
}), hu = (e, t) => {
	let n = bi(e), r = bi(t);
	for (; Pi(n) && Pi(r);) {
		let [e, t] = x(Li(n), wu([Bo(), vi()], ([e, t], n) => {
			let [r, i] = yu(n);
			return L([x(e, Jo(r)), x(t, Mi(i))]);
		})), [i, a] = x(Li(r), wu([Bo(), vi()], ([e, t], n) => {
			let [r, i] = yu(n);
			return L([x(e, Jo(r)), x(t, Mi(i))]);
		}));
		if (!j(e, i)) return !1;
		n = t, r = a;
	}
	return !0;
}, gu = (e) => _u(bi(e), vi()), _u = (e, t) => {
	for (;;) {
		let [n, r] = x(e, _r([Bo(), vi()], ([e, t], n) => {
			let [r, i] = yu(n);
			return [x(e, Jo(r)), x(t, Mi(i))];
		})), i = Wo(n) > 0 ? x(t, Ai(n)) : t;
		if (Ni(r)) return wi(i);
		e = r, t = i;
	}
	throw Error(He("Cause.flattenCauseLoop"));
}, vu = /*#__PURE__*/ y(2, (e, t) => {
	let n = [e];
	for (; n.length > 0;) {
		let e = n.pop(), r = t(e);
		switch (r._tag) {
			case "None":
				switch (e._tag) {
					case Gl:
					case Wl: n.push(e.right), n.push(e.left);
				}
				break;
			case "Some": return r;
		}
	}
	return I();
}), yu = (e) => {
	let t = e, n = [], r = Bo(), i = vi();
	for (; t !== void 0;) switch (t._tag) {
		case Vl:
			if (n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Hl:
			if (r = Go(r, yi(t._tag, t.error)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case "Die":
			if (r = Go(r, yi(t._tag, t.defect)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Ul:
			if (r = Go(r, yi(t._tag, t.fiberId)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case Gl:
			switch (t.left._tag) {
				case Vl:
					t = t.right;
					break;
				case Gl:
					t = tu(t.left.left, tu(t.left.right, t.right));
					break;
				case Wl:
					t = eu(tu(t.left.left, t.right), tu(t.left.right, t.right));
					break;
				default: i = Ai(i, t.right), t = t.left;
			}
			break;
		case Wl: n.push(t.right), t = t.left;
	}
	throw Error(He("Cause.evaluateCauseLoop"));
}, bu = {
	emptyCase: Ce,
	failCase: we,
	dieCase: we,
	interruptCase: Ce,
	sequentialCase: (e, t, n) => t && n,
	parallelCase: (e, t, n) => t && n
}, xu = "SequentialCase", Su = "ParallelCase", Cu = /*#__PURE__*/ y(2, (e, { onDie: t, onEmpty: n, onFail: r, onInterrupt: i, onParallel: a, onSequential: o }) => Tu(e, void 0, {
	emptyCase: () => n,
	failCase: (e, t) => r(t),
	dieCase: (e, n) => t(n),
	interruptCase: (e, t) => i(t),
	sequentialCase: (e, t, n) => o(t, n),
	parallelCase: (e, t, n) => a(t, n)
})), wu = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = t, i = e, a = [];
	for (; i !== void 0;) {
		let e = n(r, i);
		switch (r = En(e) ? e.value : r, i._tag) {
			case Gl:
				a.push(i.right), i = i.left;
				break;
			case Wl:
				a.push(i.right), i = i.left;
				break;
			default: i = void 0;
		}
		i === void 0 && a.length > 0 && (i = a.pop());
	}
	return r;
}), Tu = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._tag) {
			case Vl:
				i.push(hn(n.emptyCase(t)));
				break;
			case Hl:
				i.push(hn(n.failCase(t, e.error)));
				break;
			case "Die":
				i.push(hn(n.dieCase(t, e.defect)));
				break;
			case Ul:
				i.push(hn(n.interruptCase(t, e.fiberId)));
				break;
			case Gl:
				r.push(e.right), r.push(e.left), i.push(gn({ _tag: xu }));
				break;
			case Wl: r.push(e.right), r.push(e.left), i.push(gn({ _tag: Su }));
		}
	}
	let a = [];
	for (; i.length > 0;) {
		let e = i.pop();
		switch (e._tag) {
			case "Left":
				switch (e.left._tag) {
					case xu: {
						let e = a.pop(), r = a.pop(), i = n.sequentialCase(t, e, r);
						a.push(i);
						break;
					}
					case Su: {
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
}), Eu = (e, t) => ou(e) ? "All fibers interrupted without errors." : Pu(e).map(function(e) {
	return t?.renderErrorCause !== !0 || e.cause === void 0 ? e.stack : `${e.stack} {\n${Du(e.cause, "  ")}\n}`;
}).join("\n"), Du = (e, t) => {
	let n = e.stack.split("\n"), r = `${t}[cause]: ${n[0]}`;
	for (let e = 1, i = n.length; e < i; e++) r += `\n${t}${n[e]}`;
	return e.cause && (r += ` {\n${Du(e.cause, `${t}  `)}\n${t}}`), r;
}, Ou = (e) => {
	let t = typeof e == "object" && !!e, n = Error.stackTraceLimit;
	Error.stackTraceLimit = 1;
	let r = Error(ku(e), t && "cause" in e && e.cause !== void 0 ? { cause: Ou(e.cause) } : void 0);
	return Error.stackTraceLimit = n, r.message === "" && (r.message = "An error has occurred"), Error.stackTraceLimit = n, r.name = e instanceof Error ? e.name : "Error", t && (Nu in e && (r.span = e[Nu]), Object.keys(e).forEach((t) => {
		t in r || (r[t] = e[t]);
	})), r.stack = Mu(`${r.name}: ${r.message}`, e instanceof Error && e.stack ? e.stack : "", r.span), r;
}, ku = (e) => {
	if (typeof e == "string") return e;
	if (typeof e == "object" && e && e instanceof Error) return e.message;
	try {
		if (C(e, "toString") && Fe(e.toString) && e.toString !== Object.prototype.toString && e.toString !== globalThis.Array.prototype.toString) return e.toString();
	} catch {}
	return gt(e);
}, Au = /\((.*)\)/g, ju = /*#__PURE__*/ S("effect/Tracer/spanToTrace", () => /* @__PURE__ */ new WeakMap()), Mu = (e, t, n) => {
	let r = [e], i = t.startsWith(e) ? t.slice(e.length).split("\n") : t.split("\n");
	for (let e = 1; e < i.length; e++) if (i[e].includes(" at new BaseEffectError") || i[e].includes(" at new YieldableError")) e++;
	else {
		if (i[e].includes("Generator.next") || i[e].includes("effect_internal_function")) break;
		r.push(i[e].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
	}
	if (n) {
		let e = n, t = 0;
		for (; e && e._tag === "Span" && t < 10;) {
			let n = ju.get(e);
			if (typeof n == "function") {
				let t = n();
				if (typeof t == "string") {
					let n = t.matchAll(Au), i = !1;
					for (let [, t] of n) i = !0, r.push(`    at ${e.name} (${t})`);
					i || r.push(`    at ${e.name} (${t.replace(/^at /, "")})`);
				} else r.push(`    at ${e.name}`);
			} else r.push(`    at ${e.name}`);
			e = jn(e.parent), t++;
		}
	}
	return r.join("\n");
}, Nu = /*#__PURE__*/ Symbol.for("effect/SpanAnnotation"), Pu = (e) => Tu(e, void 0, {
	emptyCase: () => [],
	dieCase: (e, t) => [Ou(t)],
	failCase: (e, t) => [Ou(t)],
	interruptCase: () => [],
	parallelCase: (e, t, n) => [...t, ...n],
	sequentialCase: (e, t, n) => [...t, ...n]
}), Fu = "Pending", Iu = "Done", Lu = /*#__PURE__*/ Symbol.for("effect/Deferred"), Ru = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, zu = (e) => ({
	_tag: Fu,
	joiners: e
}), Bu = (e) => ({
	_tag: Iu,
	effect: e
}), Vu = class e {
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
}, Hu = (e, t) => {
	let n = new B("Blocked");
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}, Uu = (e) => {
	let t = new B("RunBlocked");
	return t.effect_instruction_i0 = e, t;
}, Wu = /*#__PURE__*/ Symbol.for("effect/Effect"), Gu = class {
	patch;
	op;
	_op = Ft;
	constructor(e, t) {
		this.patch = e, this.op = t;
	}
}, B = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Wu] = Ht;
	constructor(e) {
		this._op = e;
	}
	[A](e) {
		return this === e;
	}
	[T]() {
		return k(this, at(this));
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
		return new Vu(new et(this));
	}
}, Ku = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Wu] = Ht;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[A](e) {
		return Gf(e) && e._op === "Failure" && j(this.effect_instruction_i0, e.effect_instruction_i0);
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
		return new Vu(new et(this));
	}
}, qu = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[Wu] = Ht;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[A](e) {
		return Gf(e) && e._op === "Success" && j(this.effect_instruction_i0, e.effect_instruction_i0);
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
		return new Vu(new et(this));
	}
}, Ju = (e) => C(e, Wu), V = (e) => {
	let t = new B(Nt);
	return t.effect_instruction_i0 = e, t;
}, Yu = /*#__PURE__*/ y(3, (e, t, n) => Od((r) => W(e, (e) => W(cd(q(() => r(t(e)))), (t) => q(() => n(e, t)).pipe(gd({
	onFailure: (e) => {
		switch (t._tag) {
			case wt: return U(tu(t.effect_instruction_i0, e));
			case Ot: return U(e);
		}
	},
	onSuccess: () => t
})))))), Xu = /*#__PURE__*/ y(2, (e, t) => W(e, () => K(t))), Zu = (e) => Xu(e, void 0), Qu = function() {
	let e = new B(Ct);
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
		default: throw Error(He("you're not supposed to end up here"));
	}
	return e;
}, $u = (e, t = hs) => {
	let n = new B(St), r;
	return n.effect_instruction_i0 = (t) => {
		r = e(t);
	}, n.effect_instruction_i1 = t, wd(n, (e) => Ju(r) ? r : Y);
}, ed = (e, t = hs) => q(() => $u(e, t)), td = (e, t = hs) => Qu(e, function() {
	let e, n;
	function r(t) {
		e ? e(t) : n === void 0 && (n = t);
	}
	let i = new B(St);
	i.effect_instruction_i0 = (t) => {
		e = t, n && t(n);
	}, i.effect_instruction_i1 = t;
	let a, o;
	return this.effect_instruction_i0.length === 1 ? a = w(() => this.effect_instruction_i0(r)) : (o = new AbortController(), a = w(() => this.effect_instruction_i0(r, o.signal))), a || o ? wd(i, (e) => (o && o.abort(), a ?? Y)) : i;
}), nd = /*#__PURE__*/ y(2, (e, t) => _d(e, {
	onFailure: t,
	onSuccess: K
})), rd = /*#__PURE__*/ Symbol.for("effect/OriginalAnnotation"), id = (e, t) => En(t) ? new Proxy(e, {
	has(e, t) {
		return t === Nu || t === rd || t in e;
	},
	get(n, r) {
		return r === Nu ? t.value : r === rd ? e : n[r];
	}
}) : e, ad = (e) => Le(e) && !(Nu in e) ? V((t) => U(Ql(id(e, xp(t))))) : U(Ql(e)), od = (e) => ud(() => Ql(new Lf(e))), sd = (e) => _d(e, {
	onFailure: (e) => K(gn(e)),
	onSuccess: (e) => K(hn(e))
}), cd = (e) => hd(e, {
	onFailure: X,
	onSuccess: Z
}), H = (e) => Le(e) && !(Nu in e) ? V((t) => U(Zl(id(e, xp(t))))) : U(Zl(e)), ld = (e) => W(J(e), H), U = (e) => {
	let t = new Ku(wt);
	return t.effect_instruction_i0 = e, t;
}, ud = (e) => W(J(e), U), dd = /*#__PURE__*/ V((e) => K(e.id())), fd = (e) => V((t) => e(t.id())), W = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(Et);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}), pd = (e) => {
	let t = new B("OnStep");
	return t.effect_instruction_i0 = e, t;
}, md = (e) => W(e, b), hd = /*#__PURE__*/ y(2, (e, t) => gd(e, {
	onFailure: (e) => K(t.onFailure(e)),
	onSuccess: (e) => K(t.onSuccess(e))
})), gd = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(Dt);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t.onFailure, n.effect_instruction_i2 = t.onSuccess, n;
}), _d = /*#__PURE__*/ y(2, (e, t) => gd(e, {
	onFailure: (e) => {
		if (cu(e).length > 0) return U(mu(e));
		let n = su(e);
		return n.length > 0 ? t.onFailure(Ii(n)) : U(e);
	},
	onSuccess: t.onSuccess
})), vd = /*#__PURE__*/ y(2, (e, t) => q(() => {
	let n = R(e), r = In(n.length), i = 0;
	return Xu(jd({
		while: () => i < n.length,
		body: () => t(n[i], i),
		step: (e) => {
			r[i++] = e;
		}
	}), r);
})), yd = /*#__PURE__*/ y(2, (e, t) => q(() => {
	let n = R(e), r = 0;
	return jd({
		while: () => r < n.length,
		body: () => t(n[r], r),
		step: () => {
			r++;
		}
	});
})), bd = (e) => {
	let t = new B(At);
	return t.effect_instruction_i0 = _l(1), t.effect_instruction_i1 = () => e, t;
}, G = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => J(() => t(e)))), xd = /*#__PURE__*/ y(2, (e, t) => _d(e, {
	onFailure: (e) => ld(() => t.onFailure(e)),
	onSuccess: (e) => J(() => t.onSuccess(e))
})), Sd = /*#__PURE__*/ y(2, (e, t) => gd(e, {
	onFailure: (e) => {
		let n = du(e);
		switch (n._tag) {
			case "Left": return ld(() => t(n.left));
			case "Right": return U(n.right);
		}
	},
	onSuccess: K
})), Cd = /*#__PURE__*/ y(2, (e, t) => Od((n) => gd(n(e), {
	onFailure: (e) => {
		let n = X(e);
		return gd(t(n), {
			onFailure: (t) => X(tu(e, t)),
			onSuccess: () => n
		});
	},
	onSuccess: (e) => {
		let n = Z(e);
		return zd(t(n), n);
	}
}))), wd = /*#__PURE__*/ y(2, (e, t) => Cd(e, tp({
	onFailure: (e) => ou(e) ? Zu(t(lu(e))) : Y,
	onSuccess: () => Y
}))), K = (e) => {
	let t = new qu(Ot);
	return t.effect_instruction_i0 = e, t;
}, q = (e) => {
	let t = new B(Ct);
	return t.commit = e, t;
}, J = (e) => {
	let t = new B(kt);
	return t.effect_instruction_i0 = e, t;
}, Td = /*#__PURE__*/ y((e) => e.length === 3 || e.length === 2 && !(Le(e[1]) && "onlyEffect" in e[1]), (e, t) => W(e, (e) => {
	let n = typeof t == "function" ? t(e) : t;
	return Ju(n) ? Xu(n, e) : Ve(n) ? $u((t) => {
		n.then((n) => t(K(e)), (e) => t(H(new Wf(e, "An unknown error occurred in Effect.tap"))));
	}) : K(e);
})), Ed = (e) => V((t) => e(rf(wf, L(x(t.getFiberRef(wf), On(() => t.scope())))))), Dd = (e) => {
	let t = new B(At);
	return t.effect_instruction_i0 = vl(1), t.effect_instruction_i1 = () => e, t;
}, Od = (e) => Qu(e, function() {
	let e = new B(At);
	return e.effect_instruction_i0 = vl(1), e.effect_instruction_i1 = (e) => cl(e) ? w(() => this.effect_instruction_i0(bd)) : w(() => this.effect_instruction_i0(Dd)), e;
}), Y = /*#__PURE__*/ K(void 0), kd = (e) => {
	let t = new B(At);
	return t.effect_instruction_i0 = e, t.effect_instruction_i1 = void 0, t;
}, Ad = /*#__PURE__*/ y(2, (e, t) => W(t, (t) => t ? x(e, G(L)) : K(I()))), jd = (e) => {
	let t = new B(jt);
	return t.effect_instruction_i0 = e.while, t.effect_instruction_i1 = e.body, t.effect_instruction_i2 = e.step, t;
}, Md = (e) => q(() => {
	let t = new B(Mt);
	return t.effect_instruction_i0 = e(), t;
}), Nd = function() {
	let e = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
	return Md(() => e(x));
}, Pd = (e, ...t) => Object.defineProperty(t.length === 0 ? function(...t) {
	return Md(() => e.apply(this, t));
} : function(...n) {
	let r = Md(() => e.apply(this, n));
	for (let e of t) r = e(r, ...n);
	return r;
}, "length", {
	value: e.length,
	configurable: !0
}), Fd = /*#__PURE__*/ y(2, (e, t) => {
	let n = new B(At);
	return n.effect_instruction_i0 = t, n.effect_instruction_i1 = () => e, n;
}), Id = (e) => {
	let t = new B(Pt);
	return e?.priority === void 0 ? t : vf(t, e.priority);
}, Ld = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => G(t, (t) => [e, t]))), Rd = /*#__PURE__*/ y(2, (e, t) => W(e, (e) => Xu(t, e))), zd = /*#__PURE__*/ y(2, (e, t) => W(e, () => t)), Bd = /*#__PURE__*/ y(3, (e, t, n) => W(e, (e) => G(t, (t) => n(e, t)))), Vd = (e) => W(dd, (t) => x(e, Hd(t))), Hd = /*#__PURE__*/ y(2, (e, t) => W(e.interruptAsFork(t), () => e.await)), Ud = {
	_tag: "All",
	syslog: 0,
	label: "ALL",
	ordinal: -(2 ** 53 - 1),
	pipe() {
		return F(this, arguments);
	}
}, Wd = {
	_tag: "Fatal",
	syslog: 2,
	label: "FATAL",
	ordinal: 5e4,
	pipe() {
		return F(this, arguments);
	}
}, Gd = {
	_tag: "Error",
	syslog: 3,
	label: "ERROR",
	ordinal: 4e4,
	pipe() {
		return F(this, arguments);
	}
}, Kd = {
	_tag: "Warning",
	syslog: 4,
	label: "WARN",
	ordinal: 3e4,
	pipe() {
		return F(this, arguments);
	}
}, qd = {
	_tag: "Info",
	syslog: 6,
	label: "INFO",
	ordinal: 2e4,
	pipe() {
		return F(this, arguments);
	}
}, Jd = {
	_tag: "Debug",
	syslog: 7,
	label: "DEBUG",
	ordinal: 1e4,
	pipe() {
		return F(this, arguments);
	}
}, Yd = {
	_tag: "Trace",
	syslog: 7,
	label: "TRACE",
	ordinal: 0,
	pipe() {
		return F(this, arguments);
	}
}, Xd = {
	_tag: "None",
	syslog: 7,
	label: "OFF",
	ordinal: 2 ** 53 - 1,
	pipe() {
		return F(this, arguments);
	}
}, Zd = /*#__PURE__*/ Symbol.for("effect/FiberRef"), Qd = {
/* c8 ignore next */
_A: (e) => e }, $d = (e) => V((t) => Z(t.getFiberRef(e))), ef = /*#__PURE__*/ y(2, (e, t) => W($d(e), t)), tf = /*#__PURE__*/ y(2, (e, t) => nf(e, () => [void 0, t])), nf = /*#__PURE__*/ y(2, (e, t) => V((n) => {
	let [r, i] = t(n.getFiberRef(e));
	return n.setFiberRef(e, i), K(r);
})), rf = /*#__PURE__*/ y(3, (e, t, n) => Yu(Rd($d(t), tf(t, n)), () => e, (e) => tf(t, e))), af = /*#__PURE__*/ y(3, (e, t, n) => ef(t, (r) => rf(e, t, n(r)))), of = (e, t) => uf(e, {
	differ: Gc(),
	fork: t?.fork ?? b,
	join: t?.join
}), sf = (e) => {
	let t = Uc();
	return uf(e, {
		differ: t,
		fork: t.empty
	});
}, cf = (e) => {
	let t = Wc(Gc());
	return uf(e, {
		differ: t,
		fork: t.empty
	});
}, lf = (e) => {
	let t = Hc();
	return uf(e, {
		differ: t,
		fork: t.empty
	});
}, uf = (e, t) => ({
	...qt,
	[Zd]: Qd,
	initial: e,
	commit() {
		return $d(this);
	},
	diff: (e, n) => t.differ.diff(e, n),
	combine: (e, n) => t.differ.combine(e, n),
	patch: (e) => (n) => t.differ.patch(e, n),
	fork: t.fork,
	join: t.join ?? ((e, t) => t)
}), df = (e) => uf(e, {
	differ: gl,
	fork: gl.empty
}), ff = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentContext"), () => lf(ti())), pf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => of(0)), mf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => of(2048)), hf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => of(ys())), gf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogLevel"), () => of(qd)), _f = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogSpan"), () => of(Bs())), vf = /*#__PURE__*/ y(2, (e, t) => rf(e, pf, t)), yf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentConcurrency"), () => of("unbounded")), bf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestBatching"), () => of(!0)), xf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => of(L(Jd))), Sf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => of(L(Kd))), Cf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMetricLabels"), () => cf(pr())), wf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => of(I(), {
	fork: () => I(),
	join: (e, t) => e
})), Tf = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => of(Xl, {
	fork: () => Xl,
	join: (e, t) => e
})), Ef = /*#__PURE__*/ Symbol.for("effect/Scope"), Df = /*#__PURE__*/ Symbol.for("effect/CloseableScope"), Of = (e, t) => e.addFinalizer(() => Zu(t)), kf = (e, t) => e.addFinalizer(t), Af = (e, t) => e.close(t), jf = (e, t) => e.fork(t), Mf = (e) => Nf(b)(e), Nf = /*#__PURE__*/ y(2, (e, t) => {
	let n = x(e, uu, Mn(t));
	switch (n._tag) {
		case "None": return x(cu(e), Fi, Dn({
			onNone: () => {
				let t = R(lu(e)).flatMap((e) => R(gs(e)).map((e) => `#${e}`));
				return new zf(t ? `Interrupted by fibers: ${t.join(", ")}` : void 0);
			},
			onSome: b
		}));
		case "Some": return n.value;
	}
}), Pf = /*#__PURE__*/ function() {
	class e extends globalThis.Error {
		commit() {
			return H(this);
		}
		toJSON() {
			let e = { ...this };
			return this.message && (e.message = this.message), this.cause && (e.cause = this.cause), e;
		}
		[M]() {
			return this.toString === globalThis.Error.prototype.toString ? "Bun" in globalThis ? Eu(Zl(this), { renderErrorCause: !0 }) : this : this.stack ? `${this.toString()}\n${this.stack.split("\n").slice(1).join("\n")}` : this.toString();
		}
	}
	return Object.assign(e.prototype, Jt), e;
}(), Ff = (e, t) => {
	class n extends Pf {
		_tag = t;
	}
	return Object.assign(n.prototype, e), n.prototype.name = t, n;
}, If = /*#__PURE__*/ Symbol.for("effect/Cause/errors/RuntimeException"), Lf = /*#__PURE__*/ Ff({ [If]: If }, "RuntimeException"), Rf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/InterruptedException"), zf = /*#__PURE__*/ Ff({ [Rf]: Rf }, "InterruptedException"), Bf = (e) => C(e, Rf), Vf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/NoSuchElement"), Hf = /*#__PURE__*/ Ff({ [Vf]: Vf }, "NoSuchElementException"), Uf = /*#__PURE__*/ Symbol.for("effect/Cause/errors/UnknownException"), Wf = /*#__PURE__*/ function() {
	class e extends Pf {
		_tag = "UnknownException";
		error;
		constructor(e, t) {
			super(t ?? "An unknown error occurred", { cause: e }), this.error = e;
		}
	}
	return Object.assign(e.prototype, {
		[Uf]: Uf,
		name: "UnknownException"
	}), e;
}(), Gf = (e) => Ju(e) && "_tag" in e && (e._tag === "Success" || e._tag === "Failure"), Kf = (e) => e._tag === "Failure", qf = (e) => e._tag === "Success", Jf = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._tag) {
		case wt: return X(e.effect_instruction_i0);
		case Ot: return Z(t);
	}
}), Yf = (e) => Jf(e, void 0), Xf = (e, t) => ap(e, t?.parallel ? eu : tu), Zf = (e) => X(Ql(e)), Qf = (e) => X(Zl(e)), X = (e) => {
	let t = new Ku(wt);
	return t.effect_instruction_i0 = e, t;
}, $f = (e) => X($l(e)), ep = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._tag) {
		case wt: return X(e.effect_instruction_i0);
		case Ot: return Z(t(e.effect_instruction_i0));
	}
}), tp = /*#__PURE__*/ y(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case wt: return t(e.effect_instruction_i0);
		case Ot: return n(e.effect_instruction_i0);
	}
}), np = /*#__PURE__*/ y(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case wt: return t(e.effect_instruction_i0);
		case Ot: return n(e.effect_instruction_i0);
	}
}), Z = (e) => {
	let t = new qu(Ot);
	return t.effect_instruction_i0 = e, t;
}, rp = /*#__PURE__*/ Z(void 0), ip = /*#__PURE__*/ y(3, (e, t, { onFailure: n, onSuccess: r }) => {
	switch (e._tag) {
		case wt: switch (t._tag) {
			case Ot: return X(e.effect_instruction_i0);
			case wt: return X(n(e.effect_instruction_i0, t.effect_instruction_i0));
		}
		case Ot: switch (t._tag) {
			case Ot: return Z(r(e.effect_instruction_i0, t.effect_instruction_i0));
			case wt: return X(t.effect_instruction_i0);
		}
	}
}), ap = (e, t) => {
	let n = xi(e);
	return Pi(n) ? x(Ri(n), _r(x(Li(n), ep(bi)), (e, n) => x(e, ip(n, {
		onSuccess: (e, t) => x(e, Ai(t)),
		onFailure: t
	}))), ep(wi), ep((e) => Ci(e)), L) : I();
}, op = (e) => ({
	...qt,
	[Lu]: Ru,
	state: Qo(zu([])),
	commit() {
		return lp(this);
	},
	blockingOn: e
}), sp = () => W(dd, (e) => cp(e)), cp = (e) => J(() => op(e)), lp = (e) => ed((t) => {
	let n = $o(e.state);
	switch (n._tag) {
		case Iu: return t(n.effect);
		case Fu: return n.joiners.push(t), mp(e, t);
	}
}, e.blockingOn), up = /*#__PURE__*/ y(2, (e, t) => J(() => {
	let n = $o(e.state);
	switch (n._tag) {
		case Iu: return !1;
		case Fu:
			es(e.state, Bu(t));
			for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
			return !0;
	}
})), dp = /*#__PURE__*/ y(2, (e, t) => up(e, U(t))), fp = /*#__PURE__*/ y(2, (e, t) => up(e, K(t))), pp = (e, t) => {
	let n = $o(e.state);
	if (n._tag === "Pending") {
		es(e.state, Bu(t));
		for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
	}
}, mp = (e, t) => J(() => {
	let n = $o(e.state);
	if (n._tag === "Pending") {
		let e = n.joiners.indexOf(t);
		e >= 0 && n.joiners.splice(e, 1);
	}
}), hp = /*#__PURE__*/ V((e) => Z(e.currentContext)), gp = () => hp, _p = (e) => W(gp(), e), vp = /*#__PURE__*/ y(2, (e, t) => rf(ff, t)(e)), yp = /*#__PURE__*/ y(2, (e, t) => af(ff, (e) => si(e, t))(e)), bp = /*#__PURE__*/ y(2, (e, t) => _p((n) => vp(e, t(n)))), xp = (e) => {
	let t = e.currentSpan;
	return t !== void 0 && t._tag === "Span" ? L(t) : I();
}, Sp = Kf, Cp = qf, wp = rp, Tp = /*#__PURE__*/ Symbol.for("effect/MutableHashMap"), Ep = {
	[Tp]: Tp,
	[Symbol.iterator]() {
		return new Dp(this);
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
}, Dp = class e {
	self;
	referentialIterator;
	bucketIterator;
	constructor(e) {
		this.self = e, this.referentialIterator = e.referential[Symbol.iterator]();
	}
	next() {
		if (this.bucketIterator !== void 0) return this.bucketIterator.next();
		let e = this.referentialIterator.next();
		return e.done ? (this.bucketIterator = new Op(this.self.buckets.values()), this.next()) : e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, Op = class {
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
}, kp = () => {
	let e = Object.create(Ep);
	return e.referential = /* @__PURE__ */ new Map(), e.buckets = /* @__PURE__ */ new Map(), e.bucketsSize = 0, e;
}, Ap = /*#__PURE__*/ y(2, (e, t) => {
	if (pt(t) === !1) return e.referential.has(t) ? L(e.referential.get(t)) : I();
	let n = t[T](), r = e.buckets.get(n);
	return r === void 0 ? I() : jp(e, r, t);
}), jp = (e, t, n, r = !1) => {
	for (let i = 0, a = t.length; i < a; i++) if (n[A](t[i][0])) {
		let n = t[i][1];
		return r && (t.splice(i, 1), e.bucketsSize--), L(n);
	}
	return I();
}, Mp = /*#__PURE__*/ y(2, (e, t) => En(Ap(e, t))), Np = /*#__PURE__*/ y(3, (e, t, n) => {
	if (pt(t) === !1) return e.referential.set(t, n), e;
	let r = t[T](), i = e.buckets.get(r);
	return i === void 0 ? (e.buckets.set(r, [[t, n]]), e.bucketsSize++, e) : (Pp(e, i, t), i.push([t, n]), e.bucketsSize++, e);
}), Pp = (e, t, n) => {
	for (let r = 0, i = t.length; r < i; r++) if (n[A](t[r][0])) {
		t.splice(r, 1), e.bucketsSize--;
		return;
	}
}, Fp = /*#__PURE__*/ Symbol.for("effect/Clock"), Ip = /*#__PURE__*/ Qr("effect/Clock"), Lp = 2 ** 31 - 1, Rp = { unsafeSchedule(e, t) {
	let n = ua(t);
	if (n > Lp) return we;
	let r = !1, i = setTimeout(() => {
		r = !0, e();
	}, n);
	return () => (clearTimeout(i), !r);
} }, zp = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || typeof performance.now != "function") return () => BigInt(Date.now()) * e;
	let t;
	return () => (t === void 0 && (t = BigInt(Date.now()) * e - BigInt(Math.round(performance.now() * 1e6))), t + BigInt(Math.round(performance.now() * 1e6)));
}(), Bp = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return zp;
	let t = /*#__PURE__*/ zp() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}(), Vp = class {
	[Fp] = Fp;
	unsafeCurrentTimeMillis() {
		return Date.now();
	}
	unsafeCurrentTimeNanos() {
		return Bp();
	}
	currentTimeMillis = /*#__PURE__*/ J(() => this.unsafeCurrentTimeMillis());
	currentTimeNanos = /*#__PURE__*/ J(() => this.unsafeCurrentTimeNanos());
	scheduler() {
		return K(Rp);
	}
	sleep(e) {
		return td((t) => Zu(J(Rp.unsafeSchedule(() => t(Y), e))));
	}
}, Hp = () => new Vp(), Up = "InvalidData", Wp = "MissingData", Gp = "SourceUnavailable", Kp = "Unsupported", qp = /*#__PURE__*/ Symbol.for("effect/ConfigError"), Jp = {
	_tag: "ConfigError",
	[qp]: qp
}, Yp = (e, t) => {
	let n = Object.create(Jp);
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
}, Xp = (e, t) => {
	let n = Object.create(Jp);
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
}, Zp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Jp);
	return r._op = Up, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Invalid data at ${x(this.path, Sr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Qp = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Jp);
	return r._op = Wp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Missing data at ${x(this.path, Sr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, $p = (e, t, n, r = { pathDelim: "." }) => {
	let i = Object.create(Jp);
	return i._op = Gp, i.path = e, i.message = t, i.cause = n, Object.defineProperty(i, "toString", {
		enumerable: !1,
		value() {
			return `(Source unavailable at ${x(this.path, Sr(r.pathDelim))}: "${this.message}")`;
		}
	}), i;
}, em = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Jp);
	return r._op = Kp, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Unsupported operation at ${x(this.path, Sr(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, tm = /*#__PURE__*/ y(2, (e, t) => {
	switch (e._op) {
		case "And": return Yp(tm(e.left, t), tm(e.right, t));
		case "Or": return Xp(tm(e.left, t), tm(e.right, t));
		case Up: return Zp([...t, ...e.path], e.message);
		case Wp: return Qp([...t, ...e.path], e.message);
		case Gp: return $p([...t, ...e.path], e.message, e.cause);
		case Kp: return em([...t, ...e.path], e.message);
	}
}), nm = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._op) {
			case "And":
				r.push(e.right), r.push(e.left), i.push(gn({ _op: "AndCase" }));
				break;
			case "Or":
				r.push(e.right), r.push(e.left), i.push(gn({ _op: "OrCase" }));
				break;
			case Up:
				i.push(hn(n.invalidDataCase(t, e.path, e.message)));
				break;
			case Wp:
				i.push(hn(n.missingDataCase(t, e.path, e.message)));
				break;
			case Gp:
				i.push(hn(n.sourceUnavailableCase(t, e.path, e.message, e.cause)));
				break;
			case Kp: i.push(hn(n.unsupportedCase(t, e.path, e.message)));
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
}), rm = { _tag: "Empty" }, im = /*#__PURE__*/ y(2, (e, t) => {
	let n = Vs(t), r = e;
	for (; Ls(n);) {
		let e = n.head;
		switch (e._tag) {
			case "Empty":
				n = n.tail;
				break;
			case "AndThen":
				n = zs(e.first, zs(e.second, n.tail));
				break;
			case "MapName":
				r = hr(r, e.f), n = n.tail;
				break;
			case "Nested":
				r = zn(r, e.name), n = n.tail;
				break;
			case "Unnested": if (x(Yn(r), Pn(e.name))) r = $n(r), n = n.tail;
			else return gn(Qp(r, `Expected ${e.name} to be in path in ConfigProvider#unnested`));
		}
	}
	return hn(r);
}), am = "Constant", om = "Fail", sm = "Fallback", cm = "Described", lm = "Lazy", um = "MapOrFail", dm = "Nested", fm = "Primitive", pm = "Redacted", mm = "Sequence", hm = "HashMap", gm = "ZipWith", _m = (e, t) => [...e, ...t], vm = /*#__PURE__*/ Symbol.for("effect/ConfigProvider"), ym = /*#__PURE__*/ Qr("effect/ConfigProvider"), bm = /*#__PURE__*/ Symbol.for("effect/ConfigProviderFlat"), xm = (e) => ({
	[vm]: vm,
	pipe() {
		return F(this, arguments);
	},
	...e
}), Sm = (e) => ({
	[bm]: bm,
	patch: e.patch,
	load: (t, n, r = !0) => e.load(t, n, r),
	enumerateChildren: e.enumerateChildren
}), Cm = (e) => xm({
	load: (t) => W(km(e, pr(), t, !1), (e) => Dn(Yn(e), {
		onNone: () => H(Qp(pr(), `Expected a single value having structure: ${t}`)),
		onSome: K
	})),
	flattened: e
}), wm = (e) => {
	let { pathDelim: t, seqDelim: n } = Object.assign({}, {
		pathDelim: "_",
		seqDelim: ","
	}, e), r = (e) => x(e, Sr(t)), i = (e) => e.split(t), a = () => typeof process < "u" && "env" in process && typeof process.env == "object" ? process.env : {};
	return Cm(Sm({
		load: (e, t, i = !0) => {
			let o = r(e), s = a();
			return x(o in s ? L(s[o]) : I(), Sd(() => Qp(e, `Expected ${o} to exist in the process context`)), W((r) => Mm(r, e, t, n, i)));
		},
		enumerateChildren: (e) => J(() => {
			let t = a();
			return Vo(Object.keys(t).map((e) => i(e.toUpperCase())).filter((t) => {
				for (let n = 0; n < e.length; n++) {
					let r = x(e, Jn(n)), i = t[n];
					if (i === void 0 || r !== i) return !1;
				}
				return !0;
			}).flatMap((t) => t.slice(e.length, e.length + 1)));
		}),
		patch: rm
	}));
}, Tm = (e, t, n, r) => {
	let i = vr(n.length, (t) => t >= r.length ? I() : L([e(t), t + 1])), a = vr(r.length, (e) => e >= n.length ? I() : L([t(e), e + 1]));
	return [_m(n, i), _m(r, a)];
}, Em = (e, t) => {
	let n = t;
	if (n._tag === "Nested") {
		let t = e.slice();
		for (; n._tag === "Nested";) t.push(n.name), n = n.config;
		return t;
	}
	return e;
}, Dm = {
	andCase: (e, t, n) => Yp(t, n),
	orCase: (e, t, n) => Xp(t, n),
	invalidDataCase: (e, t) => Zp(t, "<redacted>"),
	missingDataCase: (e, t) => Qp(t, "<redacted>"),
	sourceUnavailableCase: (e, t, n, r) => $p(t, "<redacted>", r),
	unsupportedCase: (e, t) => em(t, "<redacted>")
}, Om = (e) => nm(e, void 0, Dm), km = (e, t, n, r) => {
	let i = n;
	switch (i._tag) {
		case am: return K(mr(i.value));
		case cm: return q(() => km(e, t, i.config, r));
		case om: return H(Qp(t, i.message));
		case sm: return x(q(() => km(e, t, i.first, r)), nd((n) => i.condition(n) ? x(km(e, t, i.second, r), nd((e) => H(Xp(n, e)))) : H(n)));
		case lm: return q(() => km(e, t, i.config(), r));
		case um: return q(() => x(km(e, t, i.original, r), W(vd((e) => x(i.mapOrFail(e), Sd(tm(Em(t, i.original))))))));
		case dm: return q(() => km(e, _m(t, mr(i.name)), i.config, r));
		case fm: return x(im(t, e.patch), W((t) => x(e.load(t, i, r), W((e) => {
			if (e.length === 0) {
				let e = x(Zn(t), On(() => "<n/a>"));
				return H(Qp([], `Expected ${i.description} with name ${e}`));
			}
			return K(e);
		}))));
		case pm: return q(() => x(km(e, t, i.original, r), Sd(Om), G(hr(i.redact))));
		case mm: return x(im(t, e.patch), W((n) => x(e.enumerateChildren(n), W(Pm), W((n) => n.length === 0 ? q(() => G(km(e, t, i.config, !0), mr)) : x(vd(n, (n) => km(e, Bn(t, `[${n}]`), i.config, !0)), G((e) => {
			let t = gr(e);
			return t.length === 0 ? mr(pr()) : mr(t);
		}))))));
		case hm: return q(() => x(im(t, e.patch), W((t) => x(e.enumerateChildren(t), W((n) => x(n, vd((n) => km(e, _m(t, mr(n)), i.valueConfig, r)), G((e) => e.length === 0 ? mr(ys()) : x(Nm(e), hr((e) => bs(ar(R(n), e)))))))))));
		case gm: return q(() => x(km(e, t, i.left, r), sd, W((n) => x(km(e, t, i.right, r), sd, W((e) => {
			if (_n(n) && _n(e)) return H(Yp(n.left, e.left));
			if (_n(n) && vn(e)) return H(n.left);
			if (vn(n) && _n(e)) return H(e.left);
			if (vn(n) && vn(e)) {
				let r = Am(t, x(t, Sr("."))), [a, o] = Tm(r, r, x(n.right, hr(hn)), x(e.right, hr(hn)));
				return x(a, ar(o), vd(([e, t]) => x(Ld(e, t), G(([e, t]) => i.zip(e, t)))));
			}
			throw Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
		})))));
	}
}, Am = (e, t) => (n) => gn(Qp(e, `The element at index ${n} in a sequence at path "${t}" was missing`)), jm = (e, t) => e.split(RegExp(`\\s*${wr(t)}\\s*`)), Mm = (e, t, n, r, i) => i ? x(jm(e, r), vd((e) => n.parse(e.trim())), Sd(tm(t))) : x(n.parse(e), xd({
	onFailure: tm(t),
	onSuccess: mr
})), Nm = (e) => Object.keys(e[0]).map((t) => e.map((e) => e[t])), Pm = (e) => x(vd(e, Im), xd({
	onFailure: () => pr(),
	onSuccess: ir(Cr)
}), sd, G(yn)), Fm = /^(\[(\d+)\])$/, Im = (e) => {
	let t = e.match(Fm);
	if (t !== null) {
		let e = t[2];
		return x(e !== void 0 && e.length > 0 ? L(e) : I(), Nn(Lm));
	}
	return I();
}, Lm = (e) => {
	let t = Number.parseInt(e);
	return Number.isNaN(t) ? I() : L(t);
}, Rm = /*#__PURE__*/ Symbol.for("effect/Console"), zm = /*#__PURE__*/ Qr("effect/Console"), Bm = {
	[Rm]: Rm,
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
}, Vm = /*#__PURE__*/ Symbol.for("effect/Random"), Hm = /*#__PURE__*/ Qr("effect/Random"), Um = class {
	seed;
	[Vm] = Vm;
	PRNG;
	constructor(e) {
		this.seed = e, this.PRNG = new Xe(e);
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
		return Wm(e, (e) => this.nextIntBetween(0, e));
	}
}, Wm = (e, t) => q(() => x(J(() => Array.from(e)), W((e) => {
	let n = [];
	for (let t = e.length; t >= 2; --t) n.push(t);
	return x(n, yd((n) => x(t(n), G((t) => Gm(e, n - 1, t)))), Xu(xi(e)));
}))), Gm = (e, t, n) => {
	let r = e[t];
	return e[t] = e[n], e[n] = r, e;
}, Km = (e) => new Um(E(e)), qm = /*#__PURE__*/ Symbol.for("effect/Tracer"), Jm = (e) => ({
	[qm]: qm,
	...e
}), Ym = /*#__PURE__*/ Qr("effect/Tracer"), Xm = /*#__PURE__*/ Qr("effect/ParentSpan"), Zm = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), Qm = class {
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
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = t._tag === "Some" ? t.value.traceId : Zm(32), this.spanId = Zm(16), this.links = Array.from(r);
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
}, $m = /*#__PURE__*/ Jm({
	span: (e, t, n, r, i, a) => new Qm(e, t, n, r, i, a),
	context: (e) => e()
}), eh = /*#__PURE__*/ ui()("effect/Tracer/DisablePropagation", { defaultValue: we }), th = /*#__PURE__*/ x(/*#__PURE__*/ ti(), /*#__PURE__*/ ri(Ip, /*#__PURE__*/ Hp()), /*#__PURE__*/ ri(zm, Bm), /*#__PURE__*/ ri(Hm, /*#__PURE__*/ Km(/*#__PURE__*/ Math.random())), /*#__PURE__*/ ri(ym, /*#__PURE__*/ wm()), /*#__PURE__*/ ri(Ym, $m)), nh = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/DefaultServices/currentServices"), () => lf(th));
// node_modules/effect/dist/esm/internal/fiberRefs.js
function rh(e) {
	return new oh(e);
}
function ih() {
	return rh(/* @__PURE__ */ new Map());
}
var ah = /*#__PURE__*/ Symbol.for("effect/FiberRefs"), oh = class {
	locals;
	[ah] = ah;
	constructor(e) {
		this.locals = e;
	}
	pipe() {
		return F(this, arguments);
	}
}, sh = (e, t, n, r = !1) => {
	let i = e, a = t, o = n, s = r, c;
	for (; c === void 0;) if (Wn(a) && Wn(o)) {
		let e = Xn(a)[0], t = $n(a), n = Xn(o)[0], r = Xn(o)[1], i = $n(o);
		e.startTimeMillis < n.startTimeMillis ? (o = i, s = !0) : e.startTimeMillis > n.startTimeMillis ? a = t : e.id < n.id ? (o = i, s = !0) : e.id > n.id ? a = t : c = [r, s];
	} else c = [i.initial, !0];
	return c;
}, ch = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = new Map(e.locals);
	return n.locals.forEach((e, n) => {
		let i = e[0][1];
		if (!e[0][0][A](t)) {
			if (!r.has(n)) {
				if (j(i, n.initial)) return;
				r.set(n, [[t, n.join(n.initial, i)]]);
				return;
			}
			let a = r.get(n), [o, s] = sh(n, a, e);
			if (s) {
				let e = n.diff(o, i), s = a[0][1], c = n.join(s, n.patch(e)(s));
				if (!j(s, c)) {
					let e, i = a[0][0];
					e = i[A](t) ? [[i, c], ...a.slice(1)] : [[t, c], ...a], r.set(n, e);
				}
			}
		}
	}), new oh(r);
}), lh = /*#__PURE__*/ y(2, (e, t) => {
	let n = /* @__PURE__ */ new Map();
	return uh(e, n, t), new oh(n);
}), uh = (e, t, n) => {
	e.locals.forEach((e, r) => {
		let i = e[0][1], a = r.patch(r.fork)(i);
		j(i, a) ? t.set(r, e) : t.set(r, [[n, a], ...e]);
	});
}, dh = /*#__PURE__*/ y(2, (e, t) => {
	let n = new Map(e.locals);
	return n.delete(t), new oh(n);
}), fh = /*#__PURE__*/ y(2, (e, t) => e.locals.has(t) ? L(Xn(e.locals.get(t))[1]) : I()), ph = /*#__PURE__*/ y(2, (e, t) => x(fh(e, t), On(() => t.initial))), mh = /*#__PURE__*/ y(2, (e, { fiberId: t, fiberRef: n, value: r }) => {
	if (e.locals.size === 0) return new oh(/* @__PURE__ */ new Map([[n, [[t, r]]]]));
	let i = new Map(e.locals);
	return hh(i, t, n, r), new oh(i);
}), hh = (e, t, n, r) => {
	let i = e.get(n) ?? [], a;
	if (Wn(i)) {
		let [e, n] = Xn(i);
		if (e[A](t)) {
			if (j(n, r)) return;
			a = [[t, r], ...i.slice(1)];
		} else a = [[t, r], ...i];
	} else a = [[t, r]];
	e.set(n, a);
}, gh = /*#__PURE__*/ y(2, (e, { entries: t, forkAs: n }) => {
	if (e.locals.size === 0) return new oh(new Map(t));
	let r = new Map(e.locals);
	return n !== void 0 && uh(e, r, n), t.forEach(([e, t]) => {
		t.length === 1 ? hh(r, t[0][0], e, t[0][1]) : t.forEach(([t, n]) => {
			hh(r, t, e, n);
		});
	}), new oh(r);
}), _h = ph, vh = gh, yh = ih, bh = Ud, xh = Wd, Sh = Gd, Ch = Kd, wh = qd, Th = Jd, Eh = Yd, Dh = Xd, Oh = /*#__PURE__*/ wn(/* @__PURE__ */ x(Cr, /*#__PURE__*/ Cn((e) => e.ordinal))), kh = (e) => {
	switch (e) {
		case "All": return bh;
		case "Debug": return Th;
		case "Error": return Sh;
		case "Fatal": return xh;
		case "Info": return wh;
		case "Trace": return Eh;
		case "None": return Dh;
		case "Warning": return Ch;
	}
}, Ah = (e) => e.replace(/[\s="]/g, "_"), jh = (e) => (t) => `${Ah(t.label)}=${e - t.startTime}ms`, Mh = Gt, Nh = Yt, Ph = class extends Nh {}, Fh = /*#__PURE__*/ Symbol.for("effect/Readable"), Ih = /*#__PURE__*/ Symbol.for("effect/Ref"), Lh = {
/* c8 ignore next */
_A: (e) => e }, Rh = class extends Ph {
	ref;
	commit() {
		return this.get;
	}
	[Ih] = Lh;
	[Fh] = Fh;
	constructor(e) {
		super(), this.ref = e, this.get = J(() => $o(this.ref));
	}
	get;
	modify(e) {
		return J(() => {
			let t = $o(this.ref), [n, r] = e(t);
			return t !== r && es(r)(this.ref), n;
		});
	}
}, zh = (e) => new Rh(Qo(e)), Bh = (e) => J(() => zh(e)), Vh = (e) => e.get, Hh = /*#__PURE__*/ y(2, (e, t) => e.modify(() => [void 0, t])), Uh = /*#__PURE__*/ y(2, (e, t) => e.modify(t)), Wh = /*#__PURE__*/ y(2, (e, t) => e.modify((e) => [void 0, t(e)])), Gh = "Empty", Kh = "Remove", qh = "Update", Jh = "AndThen", Yh = { _tag: Gh }, Xh = (e, t) => {
	let n = new Map(e.locals), r = Yh;
	for (let [e, i] of t.locals.entries()) {
		let t = Xn(i)[1], a = n.get(e);
		if (a !== void 0) {
			let n = Xn(a)[1];
			j(n, t) || (r = Zh({
				_tag: qh,
				fiberRef: e,
				patch: e.diff(n, t)
			})(r));
		} else r = Zh({
			_tag: "Add",
			fiberRef: e,
			value: t
		})(r);
		n.delete(e);
	}
	for (let [e] of n.entries()) r = Zh({
		_tag: Kh,
		fiberRef: e
	})(r);
	return r;
}, Zh = /*#__PURE__*/ y(2, (e, t) => ({
	_tag: Jh,
	first: e,
	second: t
})), Qh = /*#__PURE__*/ y(3, (e, t, n) => {
	let r = n, i = mr(e);
	for (; Wn(i);) {
		let e = Xn(i), n = $n(i);
		switch (e._tag) {
			case Gh:
				i = n;
				break;
			case "Add":
				r = mh(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.value
				}), i = n;
				break;
			case Kh:
				r = dh(r, e.fiberRef), i = n;
				break;
			case qh: {
				let a = ph(r, e.fiberRef);
				r = mh(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.fiberRef.patch(e.patch)(a)
				}), i = n;
				break;
			}
			case Jh: i = zn(e.first)(zn(e.second)(n));
		}
	}
	return r;
}), $h = "effect/MetricLabel", eg = /*#__PURE__*/ Symbol.for($h), tg = class {
	key;
	value;
	[eg] = eg;
	_hash;
	constructor(e, t) {
		this.key = e, this.value = t, this._hash = O($h + this.key + this.value);
	}
	[T]() {
		return this._hash;
	}
	[A](e) {
		return rg(e) && this.key === e.key && this.value === e.value;
	}
	pipe() {
		return F(this, arguments);
	}
}, ng = (e, t) => new tg(e, t), rg = (e) => C(e, eg), ig = (e) => G(e, L), ag = (e) => {
	let t, n;
	return typeof e == "function" ? t = e : (t = e.try, n = e.catch), q(() => {
		try {
			return K(w(t));
		} catch (e) {
			return H(n ? w(() => n(e)) : new Wf(e, "An unknown error occurred in Effect.try"));
		}
	});
}, og = (e) => mg(e, cg, Xh), sg = /*#__PURE__*/ y(2, (e, t) => _d(e, {
	onFailure: (e) => K(t.onFailure(e)),
	onSuccess: (e) => K(t.onSuccess(e))
})), cg = /*#__PURE__*/ V((e) => K(e.getFiberRefs())), lg = (e) => sg(e, {
	onFailure: Ee,
	onSuccess: Ee
}), ug = (e) => _g((t, n) => x(e, Qh(t, n))), dg = (e) => e.length >= 1 ? td((t, n) => {
	try {
		e(n).then((e) => t(K(e)), (e) => t(ad(e)));
	} catch (e) {
		t(ad(e));
	}
}) : td((t) => {
	try {
		e().then((e) => t(K(e)), (e) => t(ad(e)));
	} catch (e) {
		t(ad(e));
	}
}), fg = /*#__PURE__*/ y(3, (e, t, n) => _p((r) => vp(e, ri(r, t, n)))), pg = /*#__PURE__*/ K(/*#__PURE__*/ I()), mg = /*#__PURE__*/ y(3, (e, t, n) => W(t, (r) => W(e, (e) => G(t, (t) => [n(r, t), e])))), hg = /*#__PURE__*/ y(2, (e, t) => gd(e, {
	onFailure: (e) => {
		let n = du(e);
		switch (n._tag) {
			case "Left": return zd(t(n.left), U(e));
			case "Right": return U(e);
		}
	},
	onSuccess: K
})), gg = (e) => {
	let t, n;
	typeof e == "function" ? t = e : (t = e.try, n = e.catch);
	let r = (e) => n ? ld(() => n(e)) : H(new Wf(e, "An unknown error occurred in Effect.tryPromise"));
	return t.length >= 1 ? td((e, n) => {
		try {
			t(n).then((t) => e(K(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	}) : td((e) => {
		try {
			t().then((t) => e(K(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	});
}, _g = (e) => V((t) => (t.setFiberRefs(e(t.id(), t.getFiberRefs())), Y)), vg = /*#__PURE__*/ Nn((e) => ii(e.context, eh) ? e._tag === "Span" ? vg(e.parent) : I() : L(e)), yg = "Sequential", bg = "Parallel", xg = "ParallelN", Sg = { _tag: yg }, Cg = { _tag: bg }, wg = (e) => ({
	_tag: xg,
	parallelism: e
}), Tg = (e) => e._tag === yg, Eg = (e) => e._tag === bg, Dg = Sg, Og = Cg, kg = wg, Ag = Xh, jg = Qh, Mg = "effect/FiberStatus", Ng = /*#__PURE__*/ Symbol.for(Mg), Pg = "Done", Fg = "Running", Ig = "Suspended", Lg = /*#__PURE__*/ O(`${Mg}-${Pg}`), Rg = class {
	[Ng] = Ng;
	_tag = Pg;
	[T]() {
		return Lg;
	}
	[A](e) {
		return Wg(e) && e._tag === "Done";
	}
}, zg = class {
	runtimeFlags;
	[Ng] = Ng;
	_tag = Fg;
	constructor(e) {
		this.runtimeFlags = e;
	}
	[T]() {
		return x(E(Mg), D(E(this._tag)), D(E(this.runtimeFlags)), k(this));
	}
	[A](e) {
		return Wg(e) && e._tag === "Running" && this.runtimeFlags === e.runtimeFlags;
	}
}, Bg = class {
	runtimeFlags;
	blockingOn;
	[Ng] = Ng;
	_tag = Ig;
	constructor(e, t) {
		this.runtimeFlags = e, this.blockingOn = t;
	}
	[T]() {
		return x(E(Mg), D(E(this._tag)), D(E(this.runtimeFlags)), D(E(this.blockingOn)), k(this));
	}
	[A](e) {
		return Wg(e) && e._tag === "Suspended" && this.runtimeFlags === e.runtimeFlags && j(this.blockingOn, e.blockingOn);
	}
}, Vg = /*#__PURE__*/ new Rg(), Hg = (e) => new zg(e), Ug = (e, t) => new Bg(e, t), Wg = (e) => C(e, Ng), Gg = (e) => e._tag === Pg, Kg = Vg, qg = Hg, Jg = Ug, Yg = Gg, Xg = /*#__PURE__*/ Symbol.for("effect/Micro"), Zg = /*#__PURE__*/ Symbol.for("effect/Micro/MicroExit"), Qg = /*#__PURE__*/ Symbol.for("effect/Micro/MicroCause"), $g = { _E: b }, e_ = class extends globalThis.Error {
	_tag;
	traces;
	[Qg];
	constructor(e, t, n) {
		let r = `MicroCause.${e}`, i, a, o;
		if (t instanceof globalThis.Error) {
			i = `(${r}) ${t.name}`, a = t.message;
			let e = a.split("\n").length;
			o = t.stack ? `(${r}) ${t.stack.split("\n").slice(0, e + 3).join("\n")}` : `${i}: ${a}`;
		} else i = r, a = ht(t, 0), o = `${i}: ${a}`;
		n.length > 0 && (o += `\n    ${n.join("\n    ")}`), super(a), this._tag = e, this.traces = n, this[Qg] = $g, this.name = i, this.stack = o;
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
}, t_ = class extends e_ {
	defect;
	constructor(e, t = []) {
		super("Die", e, t), this.defect = e;
	}
}, n_ = (e, t = []) => new t_(e, t), r_ = class extends e_ {
	constructor(e = []) {
		super("Interrupt", "interrupted", e);
	}
}, i_ = (e = []) => new r_(e), a_ = (e) => e._tag === "Interrupt", o_ = /*#__PURE__*/ Symbol.for("effect/Micro/MicroFiber"), s_ = {
	_A: b,
	_E: b
}, c_ = class {
	context;
	interruptible;
	[o_];
	_stack = [];
	_observers = [];
	_exit;
	_children;
	currentOpCount = 0;
	constructor(e, t = !0) {
		this.context = e, this.interruptible = t, this[o_] = s_;
	}
	getRef(e) {
		return Kr(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), Ee) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	_interrupted = !1;
	unsafeInterrupt() {
		this._exit || (this._interrupted = !0, this.interruptible && this.evaluate(M_));
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
		if (t === h_) return;
		let n = l_.interruptChildren && l_.interruptChildren(this);
		if (n !== void 0) return this.evaluate(D_(n, () => t));
		this._exit = t;
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = !1, n = e;
		this.currentOpCount = 0;
		try {
			for (;;) {
				if (this.currentOpCount++, !t && this.getRef(B_).shouldYield(this)) {
					t = !0;
					let e = n;
					n = D_(w_, () => e);
				}
				if (n = n[d_](this), n === h_) {
					let e = this._yielded;
					return Zg in e ? (this._yielded = void 0, e) : h_;
				}
			}
		} catch (e) {
			return C(n, d_) ? N_(e) : N_(`MicroFiber.runLoop: Not a valid effect: ${String(n)}`);
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[m_] && t[m_](this);
			if (n) return { [e]: n };
			if (t[e]) return t;
		}
	}
	_yielded = void 0;
	yieldWith(e) {
		return this._yielded = e, h_;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
}, l_ = /*#__PURE__*/ S("effect/Micro/fiberMiddleware", () => ({ interruptChildren: void 0 })), u_ = /*#__PURE__*/ Symbol.for("effect/Micro/identifier"), Q = /*#__PURE__*/ Symbol.for("effect/Micro/args"), d_ = /*#__PURE__*/ Symbol.for("effect/Micro/evaluate"), f_ = /*#__PURE__*/ Symbol.for("effect/Micro/successCont"), p_ = /*#__PURE__*/ Symbol.for("effect/Micro/failureCont"), m_ = /*#__PURE__*/ Symbol.for("effect/Micro/ensureCont"), h_ = /*#__PURE__*/ Symbol.for("effect/Micro/Yield"), g_ = {
	_A: b,
	_E: b,
	_R: b
}, __ = {
	...Mh,
	_op: "Micro",
	[Xg]: g_,
	pipe() {
		return F(this, arguments);
	},
	[Symbol.iterator]() {
		return new Ue(new et(this));
	},
	toJSON() {
		return {
			_id: "Micro",
			op: this[u_],
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
function v_(e) {
	return N_("Micro.evaluate: Not implemented");
}
var y_ = (e) => ({
	...__,
	[u_]: e.op,
	[d_]: e.eval ?? v_,
	[f_]: e.contA,
	[p_]: e.contE,
	[m_]: e.ensure
}), b_ = (e) => {
	let t = y_(e);
	return function() {
		let n = Object.create(t);
		return n[Q] = e.single === !1 ? arguments : arguments[0], n;
	};
}, x_ = (e) => {
	let t = {
		...y_(e),
		[Zg]: Zg,
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
			return k_(t) && t._tag === e.op && j(this[Q], t[Q]);
		},
		[T]() {
			return k(this, D(O(e.op))(E(this[Q])));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[Q] = e, n[f_] = void 0, n[p_] = void 0, n[m_] = void 0, n;
	};
}, S_ = /*#__PURE__*/ x_({
	op: "Success",
	prop: "value",
	eval(e) {
		let t = e.getCont(f_);
		return t ? t[f_](this[Q], e) : e.yieldWith(this);
	}
}), C_ = /*#__PURE__*/ x_({
	op: "Failure",
	prop: "cause",
	eval(e) {
		let t = e.getCont(p_);
		for (; a_(this[Q]) && t && e.interruptible;) t = e.getCont(p_);
		return t ? t[p_](this[Q], e) : e.yieldWith(this);
	}
}), w_ = /*#__PURE__*/ (/* @__PURE__ */ b_({
	op: "Yield",
	eval(e) {
		let t = !1;
		return e.getRef(B_).scheduleTask(() => {
			t || e.evaluate(P_);
		}, this[Q] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), T_ = /*#__PURE__*/ S_(void 0), E_ = /*#__PURE__*/ b_({
	op: "WithMicroFiber",
	eval(e) {
		return this[Q](e);
	}
}), D_ = /*#__PURE__*/ y(2, (e, t) => {
	let n = Object.create(O_);
	return n[Q] = e, n[f_] = t, n;
}), O_ = /*#__PURE__*/ y_({
	op: "OnSuccess",
	eval(e) {
		return e._stack.push(this), this[Q];
	}
}), k_ = (e) => C(e, Zg), A_ = S_, j_ = C_, M_ = /*#__PURE__*/ j_(/*#__PURE__*/ i_()), N_ = (e) => j_(n_(e)), P_ = /*#__PURE__*/ A_(void 0), F_ = "setImmediate" in globalThis ? globalThis.setImmediate : (e) => setTimeout(e, 0), I_ = class {
	tasks = [];
	running = !1;
	scheduleTask(e, t) {
		this.tasks.push(e), this.running || (this.running = !0, F_(this.afterScheduled));
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
		return e.currentOpCount >= e.getRef(z_);
	}
	flush() {
		for (; this.tasks.length > 0;) this.runTasks();
	}
}, L_ = /*#__PURE__*/ y(2, (e, t) => E_((n) => {
	let r = n.context;
	return n.context = t(r), U_(e, () => (n.context = r, T_));
})), R_ = /*#__PURE__*/ y(2, (e, t) => L_(e, si(t))), z_ = class extends (/*#__PURE__*/ ui()("effect/Micro/currentMaxOpsBeforeYield", { defaultValue: () => 2048 })) {}, B_ = class extends (/*#__PURE__*/ ui()("effect/Micro/currentScheduler", { defaultValue: () => new I_() })) {}, V_ = /*#__PURE__*/ y(2, (e, t) => {
	let n = Object.create(H_);
	return n[Q] = e, n[f_] = t.onSuccess, n[p_] = t.onFailure, n;
}), H_ = /*#__PURE__*/ y_({
	op: "OnSuccessAndFailure",
	eval(e) {
		return e._stack.push(this), this[Q];
	}
}), U_ = /*#__PURE__*/ y(2, (e, t) => K_((n) => V_(n(e), {
	onFailure: (e) => D_(t(j_(e)), () => C_(e)),
	onSuccess: (e) => D_(t(A_(e)), () => S_(e))
}))), W_ = /*#__PURE__*/ b_({
	op: "SetInterruptible",
	ensure(e) {
		if (e.interruptible = this[Q], e._interrupted && e.interruptible) return () => M_;
	}
}), G_ = (e) => E_((t) => t.interruptible ? e : (t.interruptible = !0, t._stack.push(W_(!1)), t._interrupted ? M_ : e)), K_ = (e) => E_((t) => t.interruptible ? (t.interruptible = !1, t._stack.push(W_(!0)), e(G_)) : e(b)), q_ = (e, t) => {
	let n = new c_(B_.context(t?.scheduler ?? new I_()));
	if (n.evaluate(e), t?.signal) {
		if (t.signal.aborted) n.unsafeInterrupt();
		else {
			let e = () => n.unsafeInterrupt();
			t.signal.addEventListener("abort", e, { once: !0 }), n.addObserver(() => t.signal.removeEventListener("abort", e));
		}
	}
	return n;
}, J_ = class e {
	scheduleDrain;
	running = !1;
	tasks = /*#__PURE__*/ new Y_();
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
}, Y_ = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets.length, r, i = 0;
		for (; i < n && this.buckets[i][0] <= t; i++) r = this.buckets[i];
		r && r[0] === t ? r[1].push(e) : i === n ? this.buckets.push([t, [e]]) : this.buckets.splice(i, 0, [t, [e]]);
	}
}, X_ = class {
	maxNextTickBeforeTimer;
	getRunner = /*#__PURE__*/ J_.cached((e, t) => {
		e >= this.maxNextTickBeforeTimer ? setTimeout(() => t(0), 0) : Promise.resolve(void 0).then(() => t(e + 1));
	});
	constructor(e) {
		this.maxNextTickBeforeTimer = e;
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(mf) && e.getFiberRef(pf);
	}
	scheduleTask(e, t, n) {
		this.getRunner(n).scheduleTask(e, t);
	}
}, Z_ = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Scheduler/defaultScheduler"), () => new X_(2048)), Q_ = class {
	tasks = /*#__PURE__*/ new Y_();
	deferred = !1;
	scheduleTask(e, t, n) {
		this.deferred ? Z_.scheduleTask(e, t, n) : this.tasks.scheduleTask(e, t);
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(mf) && e.getFiberRef(pf);
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) {
			let e = this.tasks.buckets;
			this.tasks.buckets = [];
			for (let [t, n] of e) for (let e = 0; e < n.length; e++) n[e]();
		}
		this.deferred = !0;
	}
}, $_ = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentScheduler"), () => of(Z_)), ev = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestMap"), () => of(/* @__PURE__ */ new Map())), tv = (e, t, n, r) => {
	switch (e) {
		case void 0: return t();
		case "unbounded": return n();
		case "inherit": return ef(yf, (e) => e === "unbounded" ? n() : e > 1 ? r(e) : t());
		default: return e > 1 ? r(e) : t();
	}
}, nv = "InterruptSignal", rv = "Stateful", iv = "Resume", av = "YieldNow", ov = (e) => ({
	_tag: nv,
	cause: e
}), sv = (e) => ({
	_tag: rv,
	onFiber: e
}), cv = (e) => ({
	_tag: iv,
	effect: e
}), lv = () => ({ _tag: av }), uv = /*#__PURE__*/ Symbol.for("effect/FiberScope"), dv = class {
	[uv] = uv;
	fiberId = hs;
	roots = /*#__PURE__*/ new Set();
	add(e, t) {
		this.roots.add(t), t.addObserver(() => {
			this.roots.delete(t);
		});
	}
}, fv = class {
	fiberId;
	parent;
	[uv] = uv;
	constructor(e, t) {
		this.fiberId = e, this.parent = t;
	}
	add(e, t) {
		this.parent.tell(sv((e) => {
			e.addChild(t), t.addObserver(() => {
				e.removeChild(t);
			});
		}));
	}
}, pv = (e) => new fv(e.id(), e), mv = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberScope/Global"), () => new dv()), hv = /*#__PURE__*/ Symbol.for("effect/Fiber"), gv = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, _v = {
	[hv]: gv,
	pipe() {
		return F(this, arguments);
	}
}, vv = /*#__PURE__*/ Symbol.for("effect/Fiber"), yv = (e) => Rd(md(e.await), e.inheritAll);
({ ...qt }), { ..._v };
var bv = "effect/FiberCurrent", xv = /*#__PURE__*/ Symbol.for("effect/Logger"), Sv = {
	/* c8 ignore next */
	_Message: (e) => e,
	/* c8 ignore next */
	_Output: (e) => e
}, Cv = (e) => ({
	[xv]: Sv,
	log: e,
	pipe() {
		return F(this, arguments);
	}
}), wv = /^[^\s"=]*$/, Tv = /*#__PURE__*/ Cv(/*#__PURE__*/ ((e, t) => ({ annotations: n, cause: r, date: i, fiberId: a, logLevel: o, message: s, spans: c }) => {
	let l = (t) => t.match(wv) ? t : e(t), u = (e, t) => `${Ah(e)}=${l(t)}`, d = (e, t) => " " + u(e, t), f = u("timestamp", i.toISOString());
	f += d("level", o.label), f += d("fiber", ps(a));
	let p = Rn(s);
	for (let e = 0; e < p.length; e++) f += d("message", ht(p[e], t));
	ru(r) || (f += d("cause", Eu(r, { renderErrorCause: !0 })));
	for (let e of c) f += " " + jh(i.getTime())(e);
	for (let [e, r] of n) f += d(e, ht(r, t));
	return f;
})((e) => `"${e.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`)), Ev = {
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
Ev.gray, Ev.blue, Ev.green, Ev.yellow, Ev.red, Ev.bgBrightRed, Ev.black;
var Dv = typeof process == "object" && process !== null && typeof process.stdout == "object" && process.stdout !== null;
Dv && process.stdout.isTTY, Dv || "Deno" in globalThis;
// node_modules/effect/dist/esm/internal/metric/boundaries.js
var Ov = "effect/MetricBoundaries", kv = /*#__PURE__*/ Symbol.for(Ov), Av = class {
	values;
	[kv] = kv;
	constructor(e) {
		this.values = e, this._hash = x(O(Ov), D(dt(this.values)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return jv(e) && j(this.values, e.values);
	}
	pipe() {
		return F(this, arguments);
	}
}, jv = (e) => C(e, kv), Mv = (e) => new Av(x(e, Vn(bi(Infinity)), xr)), Nv = (e) => x(Ln(e.count - 1, (t) => e.start * e.factor ** +t), Ei, Mv), Pv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType"), Fv = "effect/MetricKeyType/Counter", Iv = /*#__PURE__*/ Symbol.for(Fv), Lv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Frequency"), Rv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Gauge"), zv = "effect/MetricKeyType/Histogram", Bv = /*#__PURE__*/ Symbol.for(zv), Vv = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Summary"), Hv = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Uv = class {
	incremental;
	bigint;
	[Pv] = Hv;
	[Iv] = Iv;
	constructor(e, t) {
		this.incremental = e, this.bigint = t, this._hash = O(Fv);
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return qv(e);
	}
	pipe() {
		return F(this, arguments);
	}
}, Wv = class {
	boundaries;
	[Pv] = Hv;
	[Bv] = Bv;
	constructor(e) {
		this.boundaries = e, this._hash = x(O(zv), D(E(this.boundaries)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return Xv(e) && j(this.boundaries, e.boundaries);
	}
	pipe() {
		return F(this, arguments);
	}
}, Gv = (e) => new Uv(e?.incremental ?? !1, e?.bigint ?? !1), Kv = (e) => new Wv(e), qv = (e) => C(e, Iv), Jv = (e) => C(e, Lv), Yv = (e) => C(e, Rv), Xv = (e) => C(e, Bv), Zv = (e) => C(e, Vv), Qv = /*#__PURE__*/ Symbol.for("effect/MetricKey"), $v = {
/* c8 ignore next */
_Type: (e) => e }, ey = /*#__PURE__*/ yr(j), ty = class {
	name;
	keyType;
	description;
	tags;
	[Qv] = $v;
	constructor(e, t, n, r = []) {
		this.name = e, this.keyType = t, this.description = n, this.tags = r, this._hash = x(O(this.name + this.description), D(E(this.keyType)), D(dt(this.tags)));
	}
	_hash;
	[T]() {
		return this._hash;
	}
	[A](e) {
		return ny(e) && this.name === e.name && j(this.keyType, e.keyType) && j(this.description, e.description) && ey(this.tags, e.tags);
	}
	pipe() {
		return F(this, arguments);
	}
}, ny = (e) => C(e, Qv), ry = (e, t) => new ty(e, Gv(t), An(t?.description)), iy = (e, t, n) => new ty(e, Kv(t), An(n)), ay = /*#__PURE__*/ y(2, (e, t) => t.length === 0 ? e : new ty(e.name, e.keyType, e.description, fr(e.tags, t))), oy = /*#__PURE__*/ Symbol.for("effect/MetricState"), sy = "effect/MetricState/Counter", cy = /*#__PURE__*/ Symbol.for(sy), ly = "effect/MetricState/Frequency", uy = /*#__PURE__*/ Symbol.for(ly), dy = "effect/MetricState/Gauge", fy = /*#__PURE__*/ Symbol.for(dy), py = "effect/MetricState/Histogram", my = /*#__PURE__*/ Symbol.for(py), hy = "effect/MetricState/Summary", gy = /*#__PURE__*/ Symbol.for(hy), _y = {
/* c8 ignore next */
_A: (e) => e }, vy = class {
	count;
	[oy] = _y;
	[cy] = cy;
	constructor(e) {
		this.count = e;
	}
	[T]() {
		return x(E(sy), D(E(this.count)), k(this));
	}
	[A](e) {
		return ky(e) && this.count === e.count;
	}
	pipe() {
		return F(this, arguments);
	}
}, yy = /*#__PURE__*/ yr(j), by = class {
	occurrences;
	[oy] = _y;
	[uy] = uy;
	constructor(e) {
		this.occurrences = e;
	}
	_hash;
	[T]() {
		return x(O(ly), D(dt(R(this.occurrences.entries()))), k(this));
	}
	[A](e) {
		return Ay(e) && yy(R(this.occurrences.entries()), R(e.occurrences.entries()));
	}
	pipe() {
		return F(this, arguments);
	}
}, xy = class {
	value;
	[oy] = _y;
	[fy] = fy;
	constructor(e) {
		this.value = e;
	}
	[T]() {
		return x(E(dy), D(E(this.value)), k(this));
	}
	[A](e) {
		return jy(e) && this.value === e.value;
	}
	pipe() {
		return F(this, arguments);
	}
}, Sy = class {
	buckets;
	count;
	min;
	max;
	sum;
	[oy] = _y;
	[my] = my;
	constructor(e, t, n, r, i) {
		this.buckets = e, this.count = t, this.min = n, this.max = r, this.sum = i;
	}
	[T]() {
		return x(E(py), D(E(this.buckets)), D(E(this.count)), D(E(this.min)), D(E(this.max)), D(E(this.sum)), k(this));
	}
	[A](e) {
		return My(e) && j(this.buckets, e.buckets) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return F(this, arguments);
	}
}, Cy = class {
	error;
	quantiles;
	count;
	min;
	max;
	sum;
	[oy] = _y;
	[gy] = gy;
	constructor(e, t, n, r, i, a) {
		this.error = e, this.quantiles = t, this.count = n, this.min = r, this.max = i, this.sum = a;
	}
	[T]() {
		return x(E(hy), D(E(this.error)), D(E(this.quantiles)), D(E(this.count)), D(E(this.min)), D(E(this.max)), D(E(this.sum)), k(this));
	}
	[A](e) {
		return Ny(e) && this.error === e.error && j(this.quantiles, e.quantiles) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return F(this, arguments);
	}
}, wy = (e) => new vy(e), Ty = (e) => new by(e), Ey = (e) => new xy(e), Dy = (e) => new Sy(e.buckets, e.count, e.min, e.max, e.sum), Oy = (e) => new Cy(e.error, e.quantiles, e.count, e.min, e.max, e.sum), ky = (e) => C(e, cy), Ay = (e) => C(e, uy), jy = (e) => C(e, fy), My = (e) => C(e, my), Ny = (e) => C(e, gy), Py = /*#__PURE__*/ Symbol.for("effect/MetricHook"), Fy = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, Iy = (e) => ({
	[Py]: Fy,
	pipe() {
		return F(this, arguments);
	},
	...e
}), Ly = /*#__PURE__*/ BigInt(0), Ry = (e) => {
	let t = e.keyType.bigint ? Ly : 0, n = e.keyType.incremental ? e.keyType.bigint ? (e) => e >= Ly : (e) => e >= 0 : (e) => !0, r = (e) => {
		n(e) && (t += e);
	};
	return Iy({
		get: () => wy(t),
		update: r,
		modify: r
	});
}, zy = (e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.keyType.preregisteredWords) t.set(n, 0);
	let n = (e) => {
		let n = t.get(e) ?? 0;
		t.set(e, n + 1);
	};
	return Iy({
		get: () => Ty(t),
		update: n,
		modify: n
	});
}, By = (e, t) => {
	let n = t;
	return Iy({
		get: () => Ey(n),
		update: (e) => {
			n = e;
		},
		modify: (e) => {
			n += e;
		}
	});
}, Vy = (e) => {
	let t = e.keyType.boundaries.values, n = t.length, r = new Uint32Array(n + 1), i = new Float64Array(n), a = 0, o = 0, s = Number.MAX_VALUE, c = Number.MIN_VALUE;
	x(t, ir(Cr), hr((e, t) => {
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
		let e = In(n), t = 0;
		for (let a = 0; a < n; a++) {
			let n = i[a], o = r[a];
			t += o, e[a] = [n, t];
		}
		return e;
	};
	return Iy({
		get: () => Dy({
			buckets: u(),
			count: a,
			min: s,
			max: c,
			sum: o
		}),
		update: l,
		modify: l
	});
}, Hy = (e) => {
	let { error: t, maxAge: n, maxSize: r, quantiles: i } = e.keyType, a = x(i, ir(Cr)), o = In(r), s = 0, c = 0, l = 0, u = 0, d = 0, f = (e) => {
		let i = [], s = 0;
		for (; s !== r - 1;) {
			let t = o[s];
			if (t != null) {
				let [r, a] = t, o = ia(e - r);
				_a(o, ea) && ga(o, n) && i.push(a);
			}
			s += 1;
		}
		return Uy(t, a, ir(i, Cr));
	}, p = (e, t) => {
		if (r > 0) {
			s += 1;
			let n = s % r;
			o[n] = [t, e];
		}
		u = c === 0 ? e : Math.min(u, e), d = c === 0 ? e : Math.max(d, e), c += 1, l += e;
	};
	return Iy({
		get: () => Oy({
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
}, Uy = (e, t, n) => {
	let r = n.length;
	if (!Wn(t)) return pr();
	let i = t[0], a = t.slice(1), o = Wy(e, r, I(), 0, i, n), s = mr(o);
	return a.forEach((t) => {
		s.push(Wy(e, r, o.value, o.consumed, t, o.rest));
	}), hr(s, (e) => [e.quantile, e.value]);
}, Wy = (e, t, n, r, i, a) => {
	let o = e, s = t, c = n, l = r, u = i, d = a, f = e, p = t, m = n, ee = r, te = i, ne = a;
	for (;;) {
		if (!Wn(d)) return {
			quantile: u,
			value: I(),
			consumed: l,
			rest: []
		};
		if (u === 1) return {
			quantile: u,
			value: L(Qn(d)),
			consumed: l + d.length,
			rest: []
		};
		let e = Xn(d), t = tr(d, (t) => t === e), n = u * s, r = o / 2 * n, i = l + t[0].length, a = Math.abs(i - n);
		if (i < n - r) f = o, p = s, m = Yn(d), ee = i, te = u, ne = t[1], o = f, s = p, c = m, l = ee, u = te, d = ne;
		else {
			if (i > n + r) {
				let t = Tn(c) ? L(e) : c;
				return {
					quantile: u,
					value: t,
					consumed: l,
					rest: d
				};
			}
			switch (c._tag) {
				case "None":
					f = o, p = s, m = Yn(d), ee = i, te = u, ne = t[1], o = f, s = p, c = m, l = ee, u = te, d = ne;
					continue;
				case "Some":
					if (a < Math.abs(n - c.value)) {
						f = o, p = s, m = Yn(d), ee = i, te = u, ne = t[1], o = f, s = p, c = m, l = ee, u = te, d = ne;
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
}, Gy = /*#__PURE__*/ Symbol.for("effect/MetricPair"), Ky = {
/* c8 ignore next */
_Type: (e) => e }, qy = (e, t) => ({
	[Gy]: Ky,
	metricKey: e,
	metricState: t,
	pipe() {
		return F(this, arguments);
	}
}), Jy = /*#__PURE__*/ Symbol.for("effect/MetricRegistry"), Yy = class {
	[Jy] = Jy;
	map = /*#__PURE__*/ kp();
	snapshot() {
		let e = [];
		for (let [t, n] of this.map) e.push(qy(t, n.get()));
		return e;
	}
	get(e) {
		let t = x(this.map, Ap(e), jn);
		if (t == null) {
			if (qv(e.keyType)) return this.getCounter(e);
			if (Yv(e.keyType)) return this.getGauge(e);
			if (Jv(e.keyType)) return this.getFrequency(e);
			if (Xv(e.keyType)) return this.getHistogram(e);
			if (Zv(e.keyType)) return this.getSummary(e);
			throw Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
		}
		return t;
	}
	getCounter(e) {
		let t = x(this.map, Ap(e), jn);
		if (t == null) {
			let n = Ry(e);
			x(this.map, Mp(e)) || x(this.map, Np(e, n)), t = n;
		}
		return t;
	}
	getFrequency(e) {
		let t = x(this.map, Ap(e), jn);
		if (t == null) {
			let n = zy(e);
			x(this.map, Mp(e)) || x(this.map, Np(e, n)), t = n;
		}
		return t;
	}
	getGauge(e) {
		let t = x(this.map, Ap(e), jn);
		if (t == null) {
			let n = By(e, e.keyType.bigint ? BigInt(0) : 0);
			x(this.map, Mp(e)) || x(this.map, Np(e, n)), t = n;
		}
		return t;
	}
	getHistogram(e) {
		let t = x(this.map, Ap(e), jn);
		if (t == null) {
			let n = Vy(e);
			x(this.map, Mp(e)) || x(this.map, Np(e, n)), t = n;
		}
		return t;
	}
	getSummary(e) {
		let t = x(this.map, Ap(e), jn);
		if (t == null) {
			let n = Hy(e);
			x(this.map, Mp(e)) || x(this.map, Np(e, n)), t = n;
		}
		return t;
	}
}, Xy = () => new Yy(), Zy = /*#__PURE__*/ Symbol.for("effect/Metric"), Qy = {
	/* c8 ignore next */
	_Type: (e) => e,
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, $y = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Metric/globalMetricRegistry"), () => Xy()), eb = function(e, t, n, r) {
	let i = Object.assign((e) => Td(e, (e) => ob(i, e)), {
		[Zy]: Qy,
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
}, tb = (e, t) => nb(ry(e, t)), nb = (e) => {
	let t, n = /* @__PURE__ */ new WeakMap(), r = (r) => {
		if (r.length === 0) return t === void 0 && (t = $y.get(e)), t;
		let i = n.get(r);
		return i === void 0 && (i = $y.get(ay(e, r)), n.set(r, i)), i;
	};
	return eb(e.keyType, (e, t) => r(t).update(e), (e) => r(e).get(), (e, t) => r(t).modify(e));
}, rb = (e, t, n) => nb(iy(e, t, n)), ib = /*#__PURE__*/ y(3, (e, t, n) => ab(e, [ng(t, n)])), ab = /*#__PURE__*/ y(2, (e, t) => eb(e.keyType, (n, r) => e.unsafeUpdate(n, fr(t, r)), (n) => e.unsafeValue(fr(t, n)), (n, r) => e.unsafeModify(n, fr(t, r)))), ob = /*#__PURE__*/ y(2, (e, t) => ef(Cf, (n) => J(() => e.unsafeUpdate(t, n))));
({ ...Kt });
var sb = /*#__PURE__*/ y(2, (e, t) => ef(ev, (n) => J(() => {
	if (n.has(e)) {
		let r = n.get(e);
		r.state.completed || (r.state.completed = !0, pp(r.result, t));
	}
}))), cb = /*#__PURE__*/ Symbol.for("effect/Supervisor"), lb = {
/* c8 ignore next */
_T: (e) => e }, ub = class e {
	underlying;
	value0;
	[cb] = lb;
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
		return new db(this, e);
	}
}, db = class e {
	left;
	right;
	_tag = "Zip";
	[cb] = lb;
	constructor(e, t) {
		this.left = e, this.right = t;
	}
	get value() {
		return Ld(this.left.value, this.right.value);
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
		return new ub(this, x(this.value, G(e)));
	}
	zip(t) {
		return new e(this, t);
	}
}, fb = (e) => C(e, cb) && Re(e, "Zip"), pb = class {
	effect;
	[cb] = lb;
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
		return new ub(this, x(this.value, G(e)));
	}
	zip(e) {
		return new db(this, e);
	}
	onRun(e, t) {
		return e();
	}
}, mb = (e) => new pb(e), hb = /*#__PURE__*/ S("effect/Supervisor/none", () => mb(Y)), gb = Vc, _b = "Empty", vb = "AddSupervisor", yb = "RemoveSupervisor", bb = "AndThen", xb = { _tag: _b }, Sb = (e, t) => ({
	_tag: bb,
	first: e,
	second: t
}), Cb = (e, t) => wb(t, bi(e)), wb = (e, t) => {
	let n = e, r = t;
	for (; Pi(r);) {
		let e = Li(r);
		switch (e._tag) {
			case _b:
				r = Ri(r);
				break;
			case vb:
				n = n.zip(e.supervisor), r = Ri(r);
				break;
			case yb:
				n = Tb(n, e.supervisor), r = Ri(r);
				break;
			case bb: r = Ai(e.first)(Ai(e.second)(Ri(r)));
		}
	}
	return n;
}, Tb = (e, t) => j(e, t) ? hb : fb(e) ? Tb(e.left, t).zip(Tb(e.right, t)) : e, Eb = (e) => j(e, hb) ? Bo() : fb(e) ? x(Eb(e.left), Jo(Eb(e.right))) : Ho(e), Db = /*#__PURE__*/ gb({
	empty: xb,
	patch: Cb,
	combine: Sb,
	diff: (e, t) => {
		if (j(e, t)) return xb;
		let n = Eb(e), r = Eb(t);
		return Sb(x(r, qo(n), Yo(xb, (e, t) => Sb(e, {
			_tag: vb,
			supervisor: t
		}))), x(n, qo(r), Yo(xb, (e, t) => Sb(e, {
			_tag: yb,
			supervisor: t
		}))));
	}
}), Ob = /*#__PURE__*/ tb("effect_fiber_started", { incremental: !0 }), kb = /*#__PURE__*/ tb("effect_fiber_active"), Ab = /*#__PURE__*/ tb("effect_fiber_successes", { incremental: !0 }), jb = /*#__PURE__*/ tb("effect_fiber_failures", { incremental: !0 }), Mb = /*#__PURE__*/ ib(/*#__PURE__*/ rb("effect_fiber_lifetimes", /*#__PURE__*/ Nv({
	start: .5,
	factor: 2,
	count: 35
})), "time_unit", "milliseconds"), Nb = "Continue", Pb = "Done", Fb = "Yield", Ib = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, Lb = (e) => {
	throw Error(`BUG: FiberRuntime - ${ht(e)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, Rb = /*#__PURE__*/ Symbol.for("effect/internal/fiberRuntime/YieldedOp"), zb = /*#__PURE__*/ S("effect/internal/fiberRuntime/yieldedOpChannel", () => ({ currentOp: null })), Bb = {
	[Et]: (e, t, n) => w(() => t.effect_instruction_i1(n)),
	OnStep: (e, t, n) => Z(Z(n)),
	[Dt]: (e, t, n) => w(() => t.effect_instruction_i2(n)),
	[Ft]: (e, t, n) => (e.patchRuntimeFlags(e.currentRuntimeFlags, t.patch), sl(e.currentRuntimeFlags) && e.isInterrupted() ? X(e.getInterruptedCause()) : Z(n)),
	[jt]: (e, t, n) => (w(() => t.effect_instruction_i2(n)), w(() => t.effect_instruction_i0()) ? (e.pushStack(t), w(() => t.effect_instruction_i1())) : Y),
	[Mt]: (e, t, n) => {
		for (;;) {
			let r = w(() => t.effect_instruction_i0.next(n));
			if (r.done) return Z(r.value);
			let i = tt(r.value);
			if (!Gf(i)) return e.pushStack(t), i;
			if (i._tag === "Failure") return i;
			n = i.value;
		}
	}
}, Vb = {
	[nv]: (e, t, n, r) => (e.processNewInterruptSignal(r.cause), sl(t) ? X(r.cause) : n),
	[iv]: (e, t, n, r) => {
		throw Error("It is illegal to have multiple concurrent run loops in a single fiber");
	},
	[rv]: (e, t, n, r) => (r.onFiber(e, qg(t)), n),
	[av]: (e, t, n, r) => W(Id(), () => n)
}, Hb = (e) => yd(Sl(e), (e) => ix(Bl(e), ([e, t]) => {
	let n = /* @__PURE__ */ new Map(), r = [];
	for (let e of t) {
		r.push(Ci(e));
		for (let t of e) n.set(t.request, t);
	}
	let i = r.flat();
	return rf(jx(e.runAll(r), i, () => i.forEach((e) => {
		e.listeners.interrupted = !0;
	})), ev, n);
}, !1, !1)), Ub = /*#__PURE__*/ Lt(), Wb = class extends Ph {
	[hv] = gv;
	[vv] = Ib;
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
		if (super(), this.currentRuntimeFlags = n, this._fiberId = e, this._fiberRefs = t, fl(n)) {
			let e = this.getFiberRef(Cf);
			Ob.unsafeUpdate(1, e), kb.unsafeUpdate(1, e);
		}
		this.refreshRefCache();
	}
	commit() {
		return yv(this);
	}
	id() {
		return this._fiberId;
	}
	resume(e) {
		this.tell(cv(e));
	}
	get status() {
		return this.ask((e, t) => t);
	}
	get runtimeFlags() {
		return this.ask((e, t) => Yg(t) ? e.currentRuntimeFlags : t.runtimeFlags);
	}
	scope() {
		return pv(this);
	}
	get children() {
		return this.ask((e) => Array.from(e.getChildren()));
	}
	getChildren() {
		return this._children === null && (this._children = /* @__PURE__ */ new Set()), this._children;
	}
	getInterruptedCause() {
		return this.getFiberRef(Tf);
	}
	fiberRefs() {
		return this.ask((e) => e.getFiberRefs());
	}
	ask(e) {
		return q(() => {
			let t = op(this._fiberId);
			return this.tell(sv((n, r) => {
				pp(t, J(() => e(n, r)));
			})), lp(t);
		});
	}
	tell(e) {
		this._queue.push(e), this._running || (this._running = !0, this.drainQueueLaterOnExecutor());
	}
	get await() {
		return td((e) => {
			let t = (t) => e(K(t));
			if (this._exitValue !== null) t(this._exitValue);
			else return this.tell(sv((e, n) => {
				e._exitValue === null ? e.addObserver(t) : t(this._exitValue);
			})), J(() => this.tell(sv((e, n) => {
				e.removeObserver(t);
			})));
		}, this.id());
	}
	get inheritAll() {
		return V((e, t) => {
			let n = e.id(), r = e.getFiberRefs(), i = t.runtimeFlags, a = ch(r, n, this.getFiberRefs());
			return e.setFiberRefs(a), kd(x(ml(i, e.getFiberRef(Ox)), yl(1), yl(16)));
		});
	}
	get poll() {
		return J(() => An(this._exitValue));
	}
	unsafePoll() {
		return this._exitValue;
	}
	interruptAsFork(e) {
		return J(() => this.tell(ov($l(e))));
	}
	unsafeInterruptAsFork(e) {
		this.tell(ov($l(e)));
	}
	addObserver(e) {
		this._exitValue === null ? this._observers.push(e) : e(this._exitValue);
	}
	removeObserver(e) {
		this._observers = this._observers.filter((t) => t !== e);
	}
	getFiberRefs() {
		return this.setFiberRef(Ox, this.currentRuntimeFlags), this._fiberRefs;
	}
	unsafeDeleteFiberRef(e) {
		this._fiberRefs = dh(this._fiberRefs, e);
	}
	getFiberRef(e) {
		return this._fiberRefs.locals.has(e) ? this._fiberRefs.locals.get(e)[0][1] : e.initial;
	}
	setFiberRef(e, t) {
		this._fiberRefs = mh(this._fiberRefs, {
			fiberId: this._fiberId,
			fiberRef: e,
			value: t
		}), this.refreshRefCache();
	}
	refreshRefCache() {
		this.currentDefaultServices = this.getFiberRef(nh), this.currentTracer = this.currentDefaultServices.unsafeMap.get(Ym.key), this.currentSupervisor = this.getFiberRef(kx), this.currentScheduler = this.getFiberRef($_), this.currentContext = this.getFiberRef(ff), this.currentSpan = this.currentContext.unsafeMap.get(Xm.key);
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
			let t = Nb, n = globalThis[bv];
			globalThis[bv] = this;
			try {
				for (; t === Nb;) t = this._queue.length === 0 ? Pb : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
			} finally {
				this._running = !1, globalThis[bv] = n;
			}
			this._queue.length > 0 && !this._running ? (this._running = !0, t === Fb ? (this.drainQueueLaterOnExecutor(), e = !1) : e = !0) : e = !1;
		}
	}
	drainQueueLaterOnExecutor() {
		this.currentScheduler.scheduleTask(this.run, this.getFiberRef(pf), this);
	}
	drainQueueWhileRunning(e, t) {
		let n = t;
		for (; this._queue.length > 0;) {
			let t = this._queue.splice(0, 1)[0];
			n = Vb[t._tag](this, e, n, t);
		}
		return n;
	}
	isInterrupted() {
		return !iu(this.getFiberRef(Tf));
	}
	addInterruptedCause(e) {
		let t = this.getFiberRef(Tf);
		this.setFiberRef(Tf, tu(t, e));
	}
	processNewInterruptSignal(e) {
		this.addInterruptedCause(e), this.sendInterruptSignalToAllChildren();
	}
	sendInterruptSignalToAllChildren() {
		if (this._children === null || this._children.size === 0) return !1;
		let e = !1;
		for (let t of this._children) t.tell(ov($l(this.id()))), e = !0;
		return e;
	}
	interruptAllChildren() {
		if (this.sendInterruptSignalToAllChildren()) {
			let e = this._children.values();
			this._children = null;
			let t = !1;
			return jd({
				while: () => !t,
				body: () => {
					let n = e.next();
					return n.done ? J(() => {
						t = !0;
					}) : Zu(n.value.await);
				},
				step: () => {}
			});
		}
		return null;
	}
	reportExitValue(e) {
		if (fl(this.currentRuntimeFlags)) {
			let t = this.getFiberRef(Cf), n = this.id().startTimeMillis, r = Date.now();
			switch (Mb.unsafeUpdate(r - n, t), kb.unsafeUpdate(-1, t), e._tag) {
				case Ot:
					Ab.unsafeUpdate(1, t);
					break;
				case wt: jb.unsafeUpdate(1, t);
			}
		}
		if (e._tag === "Failure") {
			let t = this.getFiberRef(xf);
			!ou(e.cause) && t._tag === "Some" && this.log("Fiber terminated with an unhandled error", e.cause, t);
		}
	}
	setExitValue(e) {
		this._exitValue = e, this.reportExitValue(e);
		for (let t = this._observers.length - 1; t >= 0; t--) this._observers[t](e);
		this._observers = [];
	}
	getLoggers() {
		return this.getFiberRef(Yb);
	}
	log(e, t, n) {
		let r = En(n) ? n.value : this.getFiberRef(gf);
		if (Oh(this.getFiberRef(Gb), r)) return;
		let i = this.getFiberRef(_f), a = this.getFiberRef(hf), o = this.getLoggers(), s = this.getFiberRefs();
		if (Wo(o) > 0) {
			let n = ii(this.getFiberRef(nh), Ip), c = new Date(n.unsafeCurrentTimeMillis());
			bt(s, () => {
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
			case av: return Fb;
			case nv: return this.processNewInterruptSignal(e.cause), this._asyncInterruptor !== null && (this._asyncInterruptor(X(e.cause)), this._asyncInterruptor = null), Nb;
			case iv: return this._asyncInterruptor = null, this._asyncBlockingOn = null, this.evaluateEffect(e.effect), Nb;
			case rv: return e.onFiber(this, this._exitValue === null ? Jg(this.currentRuntimeFlags, this._asyncBlockingOn) : Kg), Nb;
			default: return Lb(e);
		}
	}
	evaluateEffect(e) {
		this.currentSupervisor.onResume(this);
		try {
			let t = sl(this.currentRuntimeFlags) && this.isInterrupted() ? X(this.getInterruptedCause()) : e;
			for (; t !== null;) {
				let e = t, n = this.runLoop(e);
				if (n === Rb) {
					let e = zb.currentOp;
					zb.currentOp = null, e._op === "Yield" ? il(this.currentRuntimeFlags) ? (this.tell(lv()), this.tell(cv(rp)), t = null) : t = rp : e._op === "Async" && (t = null);
				} else {
					this.currentRuntimeFlags = x(this.currentRuntimeFlags, ol(16));
					let e = this.interruptAllChildren();
					e === null ? (this._queue.length === 0 ? this.setExitValue(n) : this.tell(cv(n)), t = null) : t = W(e, () => n);
				}
			}
		} finally {
			this.currentSupervisor.onSuspend(this);
		}
	}
	start(e) {
		if (this._running) this.tell(cv(e));
		else {
			this._running = !0;
			let t = globalThis[bv];
			globalThis[bv] = this;
			try {
				this.evaluateEffect(e);
			} finally {
				this._running = !1, globalThis[bv] = t, this._queue.length > 0 && this.drainQueueLaterOnExecutor();
			}
		}
	}
	startFork(e) {
		this.tell(cv(e));
	}
	patchRuntimeFlags(e, t) {
		let n = hl(e, t);
		return globalThis[bv] = this, this.currentRuntimeFlags = n, n;
	}
	initiateAsync(e, t) {
		let n = !1, r = (e) => {
			n || (n = !0, this.tell(cv(e)));
		};
		sl(e) && (this._asyncInterruptor = r);
		try {
			t(r);
		} catch (e) {
			r(U(Ql(e)));
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
		return J(() => ai(this.currentContext, e));
	}
	Left(e) {
		return H(e.left);
	}
	None(e) {
		return H(new Hf());
	}
	Right(e) {
		return Z(e.right);
	}
	Some(e) {
		return Z(e.value);
	}
	Micro(e) {
		return $u((t) => {
			let n = t, r = q_(R_(e, this.currentContext));
			return r.addObserver((e) => {
				if (e._tag === "Success") return n(Z(e.value));
				switch (e.cause._tag) {
					case "Interrupt": return n(X($l(hs)));
					case "Fail": return n(H(e.cause.error));
					case "Die": return n(ad(e.cause.defect));
				}
			}), $u((e) => {
				n = (t) => {
					e(Y);
				}, r.unsafeInterrupt();
			});
		});
	}
	[kt](e) {
		let t = w(() => e.effect_instruction_i0()), n = this.getNextSuccessCont();
		return n === void 0 ? (zb.currentOp = Z(t), Rb) : (n._op in Bb || Lb(n), Bb[n._op](this, n, t));
	}
	[Ot](e) {
		let t = e, n = this.getNextSuccessCont();
		return n === void 0 ? (zb.currentOp = t, Rb) : (n._op in Bb || Lb(n), Bb[n._op](this, n, t.effect_instruction_i0));
	}
	[wt](e) {
		let t = e.effect_instruction_i0, n = this.getNextFailCont();
		if (n !== void 0) switch (n._op) {
			case Tt:
			case Dt: return sl(this.currentRuntimeFlags) && this.isInterrupted() ? X(pu(t)) : w(() => n.effect_instruction_i1(t));
			case "OnStep": return sl(this.currentRuntimeFlags) && this.isInterrupted() ? X(pu(t)) : Z(X(t));
			case Ft: return this.patchRuntimeFlags(this.currentRuntimeFlags, n.patch), sl(this.currentRuntimeFlags) && this.isInterrupted() ? X(tu(t, this.getInterruptedCause())) : X(t);
			default: Lb(n);
		}
		else return zb.currentOp = X(t), Rb;
	}
	[Nt](e) {
		return w(() => e.effect_instruction_i0(this, qg(this.currentRuntimeFlags)));
	}
	Blocked(e) {
		let t = this.getFiberRefs(), n = this.currentRuntimeFlags;
		if (this._steps.length > 0) {
			let r = [], i = this._steps[this._steps.length - 1], a = this.popStack();
			for (; a && a._op !== "OnStep";) r.push(a), a = this.popStack();
			this.setFiberRefs(i.refs), this.currentRuntimeFlags = i.flags;
			let o = Ag(i.refs, t), s = ml(i.flags, n);
			return Z(Hu(e.effect_instruction_i0, V((t) => {
				for (; r.length > 0;) t.pushStack(r.pop());
				return t.setFiberRefs(jg(t.id(), t.getFiberRefs())(o)), t.currentRuntimeFlags = hl(s)(t.currentRuntimeFlags), e.effect_instruction_i1;
			})));
		}
		return Od((t) => W(ox(Uu(e.effect_instruction_i0)), () => t(e.effect_instruction_i1)));
	}
	RunBlocked(e) {
		return Hb(e.effect_instruction_i0);
	}
	[At](e) {
		let t = e.effect_instruction_i0, n = this.currentRuntimeFlags, r = hl(n, t);
		if (sl(r) && this.isInterrupted()) return X(this.getInterruptedCause());
		if (this.patchRuntimeFlags(this.currentRuntimeFlags, t), e.effect_instruction_i1) {
			let t = ml(r, n);
			return this.pushStack(new Gu(t, e)), w(() => e.effect_instruction_i1(n));
		}
		return rp;
	}
	[Et](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	OnStep(e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[Tt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[Dt](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[St](e) {
		return this._asyncBlockingOn = e.effect_instruction_i1, this.initiateAsync(this.currentRuntimeFlags, e.effect_instruction_i0), zb.currentOp = e, Rb;
	}
	[Pt](e) {
		return this._isYielding = !1, zb.currentOp = e, Rb;
	}
	[jt](e) {
		let t = e.effect_instruction_i0, n = e.effect_instruction_i1;
		return t() ? (this.pushStack(e), n()) : rp;
	}
	[Mt](e) {
		return Bb[Mt](this, e, void 0);
	}
	[Ct](e) {
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
					t = W(Id({ priority: e }), () => n);
				}
			}
			try {
				if (t = this.currentTracer.context(() => {
					if (Ub !== t[Wu]._V) {
						let e = this.getFiberRef(Sf);
						if (e._tag === "Some") {
							let n = t[Wu]._V;
							this.log(`Executing an Effect versioned ${n} with a Runtime of version ${Lt()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, Xl, e);
						}
					}
					return this[t._op](t);
				}, this), t === Rb) {
					let e = zb.currentOp;
					return e._op === "Yield" || e._op === "Async" ? Rb : (zb.currentOp = null, e._op === "Success" || e._op === "Failure" ? e : X(Ql(e)));
				}
			} catch (e) {
				t = t !== Rb && !C(t, "_op") || !(t._op in this) ? od(`Not a valid effect: ${ht(t)}`) : Bf(e) ? X(tu(Ql(e), $l(hs))) : ad(e);
			}
		}
	}
	run = () => {
		this.drainQueueOnCurrentThread();
	};
}, Gb = /*#__PURE__*/ S("effect/FiberRef/currentMinimumLogLevel", () => of(kh("Info"))), Kb = (e) => Cv((t) => {
	ii(_h(t.context, nh), zm).unsafe.log(e.log(t));
}), qb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Logger/defaultLogger"), () => Kb(Tv)), Jb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/Logger/tracerLogger"), () => Cv(({ annotations: e, cause: t, context: n, fiberId: r, logLevel: i, message: a }) => {
	let o = vg(oi(ph(n, ff), Xm));
	if (o._tag === "None" || o.value._tag === "ExternalSpan") return;
	let s = ai(ph(n, nh), Ip), c = {};
	for (let [t, n] of e) c[t] = n;
	c["effect.fiberId"] = _s(r), c["effect.logLevel"] = i.label, t !== null && t._tag !== "Empty" && (c["effect.cause"] = Eu(t, { renderErrorCause: !0 })), o.value.event(ht(Array.isArray(a) && a.length === 1 ? a[0] : a), s.unsafeCurrentTimeNanos(), c);
})), Yb = /*#__PURE__*/ S(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLoggers"), () => sf(Ho(qb, Jb))), Xb = /*#__PURE__*/ y((e) => Ju(e[0]), (e, t) => Dd(Td(e, (e) => Zb((n) => t(e, n))))), Zb = (e) => V((t) => {
	let n = t.getFiberRefs(), r = al(t.currentRuntimeFlags, 1);
	return W(bx, (t) => kf(t, (t) => V((i) => {
		let a = i.getFiberRefs(), o = i.currentRuntimeFlags, s = Ag(a, n), c = ml(o, r), l = Ag(n, a);
		return i.setFiberRefs(jg(s, i.id(), n)), Ax(Fd(e(t), c), J(() => {
			i.setFiberRefs(jg(l, i.id(), i.getFiberRefs()));
		}));
	})));
}), Qb = (e) => {
	if (Array.isArray(e) || Be(e)) return [e, I()];
	let t = Object.keys(e), n = t.length;
	return [t.map((t) => e[t]), L((e) => {
		let r = {};
		for (let i = 0; i < n; i++) r[t[i]] = e[i];
		return r;
	})];
}, $b = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(sd(t));
	return W(nx(r, b, {
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
}, ex = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(sd(t));
	return n?.discard ? nx(r, b, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		discard: !0,
		concurrentFinalizers: n?.concurrentFinalizers
	}) : G(nx(r, b, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => t._tag === "Some" ? t.value(e) : e);
}, tx = (e, t) => {
	let [n, r] = Qb(e);
	return t?.mode === "validate" ? $b(n, r, t) : t?.mode === "either" ? ex(n, r, t) : t?.discard !== !0 && r._tag === "Some" ? G(nx(n, b, t), r.value) : nx(n, b, t);
}, nx = /*#__PURE__*/ y((e) => Be(e[0]), (e, t, n) => V((r) => {
	let i = n?.batching === !0 || n?.batching === "inherit" && r.getFiberRef(bf);
	return n?.discard ? tv(n.concurrency, () => px(Dg, n?.concurrentFinalizers)((n) => i ? ix(e, (e, r) => n(t(e, r)), !0, !1, 1) : yd(e, (e, r) => n(t(e, r)))), () => px(Og, n?.concurrentFinalizers)((n) => ix(e, (e, r) => n(t(e, r)), i, !1)), (r) => px(kg(r), n?.concurrentFinalizers)((n) => ix(e, (e, r) => n(t(e, r)), i, !1, r))) : tv(n?.concurrency, () => px(Dg, n?.concurrentFinalizers)((n) => i ? ax(e, 1, (e, r) => n(t(e, r)), !0) : vd(e, (e, r) => n(t(e, r)))), () => px(Og, n?.concurrentFinalizers)((n) => rx(e, (e, r) => n(t(e, r)), i)), (r) => px(kg(r), n?.concurrentFinalizers)((n) => ax(e, r, (e, r) => n(t(e, r)), i)));
})), rx = (e, t, n) => q(() => {
	let r = R(e), i = Array(r.length);
	return zd(ix(r, (e, n) => W(t(e, n), (e) => J(() => i[n] = e)), n, !1), K(i));
}), ix = (e, t, n, r, i) => Od((a) => Ed((o) => V((s) => {
	let c = Array.from(e).reverse(), l = c.length;
	if (l === 0) return Y;
	let u = 0, d = !1, f = i ? Math.min(c.length, i) : c.length, p = /* @__PURE__ */ new Set(), m = [], ee = () => p.forEach((e) => {
		e.currentScheduler.scheduleTask(() => {
			e.unsafeInterruptAsFork(s.id());
		}, 0, e);
	}), te = [], ne = [], re = [], h = () => {
		let e = m.filter(({ exit: e }) => e._tag === "Failure").sort((e, t) => e.index < t.index ? -1 : e.index === t.index ? 0 : 1).map(({ exit: e }) => e);
		return e.length === 0 && e.push(rp), e;
	}, ie = (e, t = !1) => {
		let n = Dd(o(e)), r = cx(n, s, s.currentRuntimeFlags, mv);
		return s.currentScheduler.scheduleTask(() => {
			t && r.unsafeInterruptAsFork(s.id()), r.resume(n);
		}, 0, r), r;
	}, g = () => {
		r || (l -= c.length, c = []), d = !0, ee();
	}, _ = n ? pd : cd, ae = ie(td((e) => {
		let r = (e, t) => {
			e._op === "Blocked" ? re.push(e) : (m.push({
				index: t,
				exit: e
			}), e._op === "Failure" && !d && g());
		}, o = () => {
			if (c.length > 0) {
				let f = c.pop(), ee = u++, g = () => {
					let e = c.pop();
					return ee = u++, W(Id(), () => W(_(a(t(e, ee))), ae));
				}, ae = (e) => c.length > 0 && (r(e, ee), c.length > 0) ? g() : K(e), oe = W(_(a(t(f, ee))), ae), se = ie(oe);
				te.push(se), p.add(se), d && se.currentScheduler.scheduleTask(() => {
					se.unsafeInterruptAsFork(s.id());
				}, 0, se), se.addObserver((t) => {
					let a;
					if (a = t._op === "Failure" ? t : t.effect_instruction_i0, ne.push(se), p.delete(se), r(a, ee), m.length === l) e(K(On(Xf(h(), { parallel: !0 }), () => rp)));
					else if (re.length + m.length === l) {
						let t = h();
						e(K(Hu(re.map((e) => e.effect_instruction_i0).reduce(bl), ix([On(Xf(t, { parallel: !0 }), () => rp), ...re.map((e) => e.effect_instruction_i1)], (e) => e, n, !0, i))));
					} else o();
				});
			}
		};
		for (let e = 0; e < f; e++) o();
	}));
	return Zu(Cd(md(a(yv(ae))), tp({
		onFailure: (e) => {
			g();
			let t = re.length + 1, n = Math.min(typeof i == "number" ? i : re.length, re.length), r = Array.from(re);
			return td((i) => {
				let a = [], o = 0, s = 0, c = (n, s) => (c) => {
					a[n] = c, o++, o === t && i(Z(X(e))), r.length > 0 && s && l();
				}, l = () => {
					ie(r.pop(), !0).addObserver(c(s, !0)), s++;
				};
				ae.addObserver(c(s, !1)), s++;
				for (let e = 0; e < n; e++) l();
			});
		},
		onSuccess: () => vd(ne, (e) => e.inheritAll)
	})));
}))), ax = (e, t, n, r) => q(() => {
	let i = R(e), a = Array(i.length);
	return zd(ix(i, (e, t) => G(n(e, t), (e) => a[t] = e), r, !1, t), K(a));
}), ox = (e) => ux(e, mv), sx = (e, t, n, r = null) => {
	let i = lx(e, t, n, r);
	return i.resume(e), i;
}, cx = (e, t, n, r = null) => lx(e, t, n, r), lx = (e, t, n, r = null) => {
	let i = vs(), a = lh(t.getFiberRefs(), i), o = new Wb(i, a, n), s = ph(a, ff), c = o.currentSupervisor;
	return c.onStart(s, e, L(t), o), o.addObserver((e) => c.onEnd(e, o)), (r === null ? x(t.getFiberRef(wf), On(() => t.scope())) : r).add(n, o), o;
}, ux = (e, t) => V((n, r) => K(sx(e, n, r.runtimeFlags, t))), dx = (e) => _p((t) => Dn(oi(t, yx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Parallel": return e;
			case "Sequential":
			case "ParallelN": return W(jf(t, Og), (t) => Tx(e, t));
		}
	}
})), fx = (e) => (t) => _p((n) => Dn(oi(n, yx), {
	onNone: () => t,
	onSome: (n) => n.strategy._tag === "ParallelN" && n.strategy.parallelism === e ? t : W(jf(n, kg(e)), (e) => Tx(t, e))
})), px = (e, t) => (n) => _p((r) => Dn(oi(r, yx), {
	onNone: () => n(b),
	onSome: (r) => {
		if (t === !0) {
			let t = e._tag === "Parallel" ? dx : e._tag === "Sequential" ? _x : fx(e.parallelism);
			switch (r.strategy._tag) {
				case "Parallel": return t(n(dx));
				case "Sequential": return t(n(_x));
				case "ParallelN": return t(n(fx(r.strategy.parallelism)));
			}
		} else return n(b);
	}
})), mx = (e) => W(yx, e), hx = (e) => W(wx(), (t) => Cd(e(t), (e) => t.close(e))), gx = (e) => W(wx(), (t) => Ex(e, t)), _x = (e) => _p((t) => Dn(oi(t, yx), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Sequential": return e;
			case "Parallel":
			case "ParallelN": return W(jf(t, Dg), (t) => Tx(e, t));
		}
	}
})), vx = /*#__PURE__*/ y((e) => Ju(e[1]), (e, t, n, r) => G(tx([e, t], {
	concurrency: r?.concurrent ? 2 : 1,
	batching: r?.batching,
	concurrentFinalizers: r?.concurrentFinalizers
}), ([e, t]) => n(e, t))), yx = /*#__PURE__*/ Qr("effect/Scope"), bx = yx, xx = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.set({}, t);
}, Sx = {
	[Ef]: Ef,
	[Df]: Df,
	pipe() {
		return F(this, arguments);
	},
	fork(e) {
		return J(() => {
			let t = Cx(e);
			if (this.state._tag === "Closed") return t.state = this.state, t;
			let n = {};
			return this.state.finalizers.set(n, (e) => t.close(e)), xx(t, (e) => J(() => {
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
			}, t.length === 0 ? Y : Tg(this.strategy) ? x(vd(t, (t) => cd(t(e))), W((e) => x(Xf(e), Mn(Yf), On(() => rp)))) : Eg(this.strategy) ? x(rx(t, (t) => cd(t(e)), !1), W((e) => x(Xf(e, { parallel: !0 }), Mn(Yf), On(() => rp)))) : x(ax(t, this.strategy.parallelism, (t) => cd(t(e)), !1), W((e) => x(Xf(e, { parallel: !0 }), Mn(Yf), On(() => rp))));
		});
	},
	addFinalizer(e) {
		return q(() => this.state._tag === "Closed" ? e(this.state.exit) : (this.state.finalizers.set({}, e), Y));
	}
}, Cx = (e = Sg) => {
	let t = Object.create(Sx);
	return t.strategy = e, t.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map()
	}, t;
}, wx = (e = Sg) => J(() => Cx(e)), Tx = /*#__PURE__*/ y(2, (e, t) => bp(e, si(ni(yx, t)))), Ex = /*#__PURE__*/ y(2, (e, t) => x(e, Tx(t), Cd((e) => t.close(e)))), Dx = (e) => uf(e, {
	differ: Db,
	fork: xb
}), Ox = /*#__PURE__*/ df(dl), kx = /*#__PURE__*/ Dx(hb), Ax = /*#__PURE__*/ y(2, (e, t) => Od((n) => gd(n(e), {
	onFailure: (e) => gd(t, {
		onFailure: (t) => U(tu(e, t)),
		onSuccess: () => U(e)
	}),
	onSuccess: (e) => Xu(t, e)
}))), jx = (e, t, n) => fd((r) => Ax(W(ox(bd(e)), (e) => td((r) => {
	let i = t.map((e) => e.listeners.count), a = () => {
		i.every((e) => e === 0) && t.every((e) => !!(e.result.state.current._tag === "Pending" || e.result.state.current._tag === "Done" && Gf(e.result.state.current.effect) && e.result.state.current.effect._tag === "Failure" && au(e.result.state.current.effect.cause))) && (o.forEach((e) => e()), n?.(), r(Vd(e)));
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
})), q(() => yd(t.flatMap((e) => e.state.completed ? [] : [e]), (e) => sb(e.request, $f(r)))))), Mx = uu, Nx = Mf, Px = Of, Fx = Af, Ix = Tx, Lx = jf, Rx = wx, zx = class {
	permits;
	waiters = /*#__PURE__*/ new Set();
	taken = 0;
	constructor(e) {
		this.permits = e;
	}
	get free() {
		return this.permits - this.taken;
	}
	take = (e) => ed((t) => {
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
		return this.taken = t(this.taken), this.waiters.size > 0 && e.getFiberRef($_).scheduleTask(() => {
			let e = this.waiters.values(), t = e.next();
			for (; t.done === !1 && this.free > 0;) t.value(), t = e.next();
		}, e.getFiberRef(pf), e), K(this.free);
	}
	updateTaken(e) {
		return V((t) => this.updateTakenUnsafe(t, e));
	}
	resize = (e) => Zu(V((t) => (this.permits = e, this.free < 0 ? Y : this.updateTakenUnsafe(t, (e) => e))));
	release = (e) => this.updateTaken((t) => t - e);
	releaseAll = /*#__PURE__*/ this.updateTaken((e) => 0);
	withPermits = (e) => (t) => Od((n) => W(n(this.take(e)), (e) => Ax(n(t), this.release(e))));
	withPermitsIfAvailable = (e) => (t) => Od((n) => q(() => this.free < e ? pg : (this.taken += e, Ax(n(ig(t)), this.release(e)))));
}, Bx = (e) => new zx(e), Vx = /*#__PURE__*/ Symbol.for("effect/Ref/SynchronizedRef"), Hx = {
/* c8 ignore next */
_A: (e) => e }, Ux = class extends Ph {
	ref;
	withLock;
	[Vx] = Hx;
	[Ih] = Lh;
	[Fh] = Fh;
	constructor(e, t) {
		super(), this.ref = e, this.withLock = t, this.get = Vh(this.ref);
	}
	get;
	commit() {
		return this.get;
	}
	modify(e) {
		return this.modifyEffect((t) => K(e(t)));
	}
	modifyEffect(e) {
		return this.withLock(x(W(Vh(this.ref), e), W(([e, t]) => Xu(Hh(this.ref, t), e))));
	}
}, Wx = (e) => J(() => Gx(e)), Gx = (e) => new Ux(zh(e), Bx(1).withPermits(1)), Kx = /*#__PURE__*/ Symbol.for("effect/ManagedRuntime"), qx = "Fresh", Jx = "FromEffect", Yx = "MergeAll", Xx = (e) => function() {
	if (arguments.length === 1) {
		let t = arguments[0];
		return (n, ...r) => e(t, n, ...r);
	}
	return e.apply(this, arguments);
}, Zx = /*#__PURE__*/ Xx((e, t, n) => {
	let r = vs(), i = [[ff, [[r, e.context]]]];
	n?.scheduler && i.push([$_, [[r, n.scheduler]]]);
	let a = vh(e.fiberRefs, {
		entries: i,
		forkAs: r
	});
	n?.updateRefs && (a = n.updateRefs(a, r));
	let o = new Wb(r, a, e.runtimeFlags), s = t;
	n?.scope && (s = W(Lx(n.scope, Sg), (e) => zd(Of(e, fd((e) => j(e, o.id()) ? Y : Hd(o, e))), Cd(t, (t) => Fx(e, t)))));
	let c = o.currentSupervisor;
	return c !== hb && (c.onStart(e.context, s, I(), o), o.addObserver((e) => c.onEnd(e, o))), mv.add(e.runtimeFlags, o), n?.immediate === !1 ? o.resume(s) : o.start(s), o;
}), Qx = /*#__PURE__*/ Xx((e, t) => {
	let n = oS(e)(t);
	if (n._tag === "Failure") throw iS(n.effect_instruction_i0);
	return n.effect_instruction_i0;
}), $x = class extends Error {
	fiber;
	_tag = "AsyncFiberException";
	constructor(e) {
		super(`Fiber #${e.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`), this.fiber = e, this.name = this._tag, this.stack = this.message;
	}
}, eS = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new $x(e);
	return Error.stackTraceLimit = t, n;
}, tS = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure"), nS = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure/Cause"), rS = class extends Error {
	[tS];
	[nS];
	constructor(e) {
		let t = Pu(e)[0];
		super(t?.message || "An error has occurred"), this[tS] = tS, this[nS] = e, this.name = t ? `(FiberFailure) ${t.name}` : "FiberFailure", t?.stack && (this.stack = t.stack);
	}
	toJSON() {
		return {
			_id: "FiberFailure",
			cause: this[nS].toJSON()
		};
	}
	toString() {
		return "(FiberFailure) " + Eu(this[nS], { renderErrorCause: !0 });
	}
	[M]() {
		return this.toString();
	}
}, iS = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new rS(e);
	return Error.stackTraceLimit = t, n;
}, aS = (e) => {
	let t = e;
	switch (t._op) {
		case "Failure":
		case "Success": return t;
		case "Left": return Qf(t.left);
		case "Right": return Z(t.right);
		case "Some": return Z(t.value);
		case "None": return Qf(new Hf());
	}
}, oS = /*#__PURE__*/ Xx((e, t) => {
	let n = aS(t);
	if (n) return n;
	let r = new Q_(), i = Zx(e)(t, { scheduler: r });
	return r.flush(), i.unsafePoll() || Zf(id(eS(i), xp(i)));
}), sS = /*#__PURE__*/ Xx((e, t, n) => cS(e, t, n).then((e) => {
	switch (e._tag) {
		case Ot: return e.effect_instruction_i0;
		case wt: throw iS(e.effect_instruction_i0);
	}
})), cS = /*#__PURE__*/ Xx((e, t, n) => new Promise((r) => {
	let i = aS(t);
	i && r(i);
	let a = Zx(e)(t);
	a.addObserver((e) => {
		r(e);
	}), n?.signal !== void 0 && (n.signal.aborted ? a.unsafeInterruptAsFork(a.id()) : n.signal.addEventListener("abort", () => {
		a.unsafeInterruptAsFork(a.id());
	}, { once: !0 }));
})), lS = class {
	context;
	runtimeFlags;
	fiberRefs;
	constructor(e, t, n) {
		this.context = e, this.runtimeFlags = t, this.fiberRefs = n;
	}
	pipe() {
		return F(this, arguments);
	}
}, uS = /*#__PURE__*/ ((e) => new lS(e.context, e.runtimeFlags, e.fiberRefs))({
	context: /*#__PURE__*/ ti(),
	runtimeFlags: /* @__PURE__ */ ul(1, 32, 4),
	fiberRefs: /*#__PURE__*/ yh()
}), dS = /*#__PURE__*/ sS(uS), fS = /*#__PURE__*/ cS(uS), pS = /*#__PURE__*/ Qx(uS), mS = /*#__PURE__*/ y(2, (e, t) => e.modifyEffect(t)), hS = /*#__PURE__*/ Symbol.for("effect/Layer"), gS = {
	/* c8 ignore next */
	_RIn: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_ROut: (e) => e
}, _S = {
	[hS]: gS,
	pipe() {
		return F(this, arguments);
	}
}, vS = /*#__PURE__*/ Symbol.for("effect/Layer/MemoMap"), yS = /*#__PURE__*/ ui()("effect/Layer/CurrentMemoMap", { defaultValue: () => wS() }), bS = (e) => C(e, hS), xS = (e) => e._op_layer === qx, SS = class {
	ref;
	[vS];
	constructor(e) {
		this.ref = e, this[vS] = vS;
	}
	getOrElseMemoize(e, t) {
		return x(mS(this.ref, (n) => {
			let r = n.get(e);
			if (r !== void 0) {
				let [e, i] = r;
				return K([x(e, W(([e, t]) => x(ug(e), Xu(t))), Cd(tp({
					onFailure: () => Y,
					onSuccess: () => kf(t, i)
				}))), n]);
			}
			return x(Bh(0), W((r) => x(sp(), W((i) => x(Bh(() => Y), G((a) => {
				let o = Od((o) => x(wx(), W((s) => x(o(W(DS(e, s, !0), (e) => og(e(this)))), cd, W((o) => {
					switch (o._tag) {
						case wt: return x(dp(i, o.effect_instruction_i0), zd(Af(s, o)), zd(U(o.effect_instruction_i0)));
						case Ot: return x(Hh(a, (e) => x(Af(s, e), Ad(Uh(r, (e) => [e === 1, e - 1])), Zu)), zd(Wh(r, (e) => e + 1)), zd(kf(t, (t) => x(J(() => n.delete(e)), zd(Vh(a)), W((e) => e(t))))), zd(fp(i, o.effect_instruction_i0)), Xu(o.effect_instruction_i0[1]));
					}
				}))))), s = [x(lp(i), Cd(np({
					onFailure: () => Y,
					onSuccess: () => Wh(r, (e) => e + 1)
				}))), (e) => x(Vh(a), W((t) => t(e)))];
				return [o, xS(e) ? n : n.set(e, s)];
			}))))));
		}), md);
	}
}, CS = /*#__PURE__*/ q(() => G(Wx(/* @__PURE__ */ new Map()), (e) => new SS(e))), wS = () => new SS(Gx(/* @__PURE__ */ new Map())), TS = /*#__PURE__*/ y(2, (e, t) => W(CS, (n) => ES(e, n, t))), ES = /*#__PURE__*/ y(3, (e, t, n) => W(DS(e, n), (e) => fg(e(t), yS, t))), DS = (e, t, n = !1) => {
	let r = e;
	switch (r._op_layer) {
		case "Locally": return J(() => (e) => r.f(e.getOrElseMemoize(r.self, t)));
		case "ExtendScope": return J(() => (e) => mx((t) => e.getOrElseMemoize(r.layer, t)));
		case "Fold": return J(() => (e) => x(e.getOrElseMemoize(r.layer, t), gd({
			onFailure: (n) => e.getOrElseMemoize(r.failureK(n), t),
			onSuccess: (n) => e.getOrElseMemoize(r.successK(n), t)
		})));
		case "Fresh": return J(() => (e) => x(r.layer, TS(t)));
		case "FromEffect": return J(n ? () => (e) => r.effect : () => (n) => n.getOrElseMemoize(e, t));
		case "Provide": return J(() => (e) => x(e.getOrElseMemoize(r.first, t), W((n) => x(e.getOrElseMemoize(r.second, t), vp(n)))));
		case "Scoped": return J(n ? () => (e) => Tx(r.effect, t) : () => (n) => n.getOrElseMemoize(e, t));
		case "Suspend": return J(() => (e) => e.getOrElseMemoize(r.evaluate(), t));
		case "ProvideMerge": return J(() => (e) => x(e.getOrElseMemoize(r.first, t), Bd(e.getOrElseMemoize(r.second, t), r.zipK)));
		case "ZipWith": return Nd(function* () {
			let e = yield* jf(t, Cg), n = yield* jf(e, Sg), i = yield* jf(e, Sg);
			return (e) => x(e.getOrElseMemoize(r.first, n), vx(e.getOrElseMemoize(r.second, i), r.zipK, { concurrent: !0 }));
		});
		case "MergeAll": {
			let e = r.layers;
			return G(jf(t, Cg), (t) => (n) => {
				let r = Array(e.length);
				return G(ix(e, Pd(function* (e, i) {
					let a = yield* jf(t, Sg), o = yield* n.getOrElseMemoize(e, a);
					r[i] = o;
				}), !1, !1), () => ci(...r));
			});
		}
	}
};
function OS(e) {
	let t = Object.create(_S);
	return t._op_layer = Jx, t.effect = e, t;
}
var kS = (...e) => {
	let t = Object.create(_S);
	return t._op_layer = Yx, t.layers = e, t;
}, AS = /*#__PURE__*/ y(2, (e, t) => {
	let n = ei(e);
	return OS(K(ni(n ? e : t, n ? t : e)));
}), jS = /*#__PURE__*/ y(2, (e, t) => hx((n) => W(TS(t, n), (t) => yp(e, t)))), MS = /*#__PURE__*/ y(2, (e, t) => {
	let n = Ag(uS.fiberRefs, t.fiberRefs), r = ml(uS.runtimeFlags, t.runtimeFlags);
	return Od((i) => V((a) => {
		let o = a.getFiberRef(ff), s = a.getFiberRefs(), c = jg(a.id(), s)(n), l = a.currentRuntimeFlags, u = hl(r)(l), d = Ag(c, s), f = ml(u, l);
		return a.setFiberRefs(c), a.currentRuntimeFlags = u, Ax(yp(i(e), si(o, t.context)), V((e) => (e.setFiberRefs(jg(e.id(), e.getFiberRefs())(d)), e.currentRuntimeFlags = hl(f)(e.currentRuntimeFlags), Y)));
	}));
}), NS = /*#__PURE__*/ y(2, (e, t) => Array.isArray(t) ? jS(e, kS(...t)) : bS(t) ? jS(e, t) : $r(t) ? yp(e, t) : Kx in t ? W(t.runtimeEffect, (t) => MS(e, t)) : MS(e, t)), PS = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return { BaseEffectError: class extends Pf {
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
}(), FS = (e) => {
	let t = { BaseEffectError: class extends PS {
		_tag = e;
	} };
	return t.BaseEffectError.prototype.name = e, t.BaseEffectError;
}, IS = H, LS = Nd, RS = dg, zS = K, BS = q, VS = J, HS = Y, US = nd, WS = lg, GS = ag, KS = gg, qS = Xu, JS = Xb, YS = Ax, XS = gx, ZS = NS, QS = Td, $S = hg, eC = _d, tC = dS, nC = fS, rC = pS, iC = class extends FS("AuthenticationFailure") {};
function aC(e) {
	return KS({
		try: e.command,
		catch: (e) => new iC({ cause: e })
	}).pipe(YS(RS(() => e.reconcile?.() ?? Promise.resolve())));
}
async function oC(e) {
	let t = await nC(e);
	if (Cp(t)) return t.value;
	let n = Mx(t.cause);
	throw En(n) ? n.value.cause : Nx(t.cause);
}
// src/app/services/queries/configuration.ts
function sC(e, t, n, r, i) {
	return t ? {
		queryKey: v.sshBrowse(t, n ?? "", i),
		queryFn: ({ signal: r }) => e.browseSshPath(t, n, i, r)
	} : {
		queryKey: v.browse(n ?? "", r, i),
		queryFn: ({ signal: t }) => e.browsePath(n, r, i, t)
	};
}
function cC(e, t, n, i) {
	let { api: a } = r();
	return g({
		...sC(a, null, e, t, n),
		enabled: i,
		staleTime: 2e3,
		retry: !1
	});
}
function lC(e, t, n, i) {
	let { api: a } = r();
	return g({
		...sC(a, e ?? { ssh_host: "" }, t, "directory", n),
		enabled: i && !!e?.ssh_host,
		staleTime: 2e3,
		retry: !1
	});
}
function uC() {
	let { api: e } = r();
	return d((t, n, r, i) => sC(e, t, n, r, i).queryFn({ signal: new AbortController().signal }), [e]);
}
function dC() {
	let { api: e } = r(), t = _();
	return d(async (n, r, i) => {
		try {
			return await (n ? e.createSshFolder(n, r, i) : e.createFolder(r, i));
		} finally {
			t.invalidateQueries({ queryKey: [n ? "ssh-browse" : "fs-browse"] });
		}
	}, [e, t]);
}
function fC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.browseSshPath(t, null),
		onSuccess: (e, n) => {
			t.setQueryData(v.sshBrowse(n, "", !1), e);
		}
	});
}
function pC() {
	let { api: e } = r();
	return g({
		queryKey: v.sshConfigs,
		queryFn: ({ signal: t }) => e.listSshConfigs(t),
		staleTime: 3e4,
		retry: !1
	});
}
function mC(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: v.sshAliases,
		queryFn: ({ signal: e }) => t.listSshAliases(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function hC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.createSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
function gC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ configId: t, payload: n }) => e.updateSshConfig(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
function _C() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.sshConfigs });
		}
	});
}
var vC = 3e5;
function yC() {
	let { api: e } = r();
	return g({
		queryKey: v.mcpLibrary,
		queryFn: ({ signal: t }) => e.getMcpLibrary(t),
		staleTime: vC,
		retry: !1
	});
}
function bC() {
	let { api: e } = r();
	return g({
		queryKey: v.mcpServers,
		queryFn: ({ signal: t }) => e.listMcpServers(t),
		staleTime: 3e4,
		retry: !1
	});
}
function xC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.createMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function SC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ serverName: t, payload: n }) => e.updateMcpServer(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function CC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpServers }), t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function wC() {
	let { api: e } = r();
	return h({ mutationFn: (t) => e.testMcpServer(t) });
}
function TC() {
	let { api: e } = r();
	return g({
		queryKey: v.mcpRuntime,
		queryFn: ({ signal: t }) => e.listMcpRuntimeStatus(t),
		staleTime: 5e3,
		retry: !1
	});
}
function EC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ serverName: t, action: n }) => n === "connect" ? e.connectMcpServer(t) : n === "disconnect" ? e.disconnectMcpServer(t) : e.reloadMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: v.mcpRuntime });
		}
	});
}
function DC(e = !0) {
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
async function OC(e) {
	await Promise.all([e.resetQueries({ queryKey: v.managedProviderModelsAll }), e.invalidateQueries({ queryKey: v.modelCatalog })]);
}
async function kC(e) {
	await Promise.all([
		e.invalidateQueries({ queryKey: v.managedAuth }),
		e.invalidateQueries({ queryKey: v.managedHostStatus }),
		OC(e)
	]);
}
function AC(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sessionCommands(e),
		queryFn: ({ signal: n }) => t.listSessionCommands(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function jC(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sessionSkills(e),
		queryFn: ({ signal: n }) => t.listSessionSkills(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
// src/app/services/queries/host.ts
function MC() {
	let { api: e } = r();
	return g({
		queryKey: v.storeInfo,
		queryFn: ({ signal: t }) => e.getStore(t),
		staleTime: Infinity
	});
}
function NC(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sandboxAvailability,
		queryFn: ({ signal: e }) => t.getSandboxAvailability(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function PC(e, t) {
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
function FC() {
	let { api: e } = r(), t = _();
	return h({
		retry: !1,
		mutationFn: (n) => oC(aC({
			command: () => e.managedLogout(n),
			reconcile: () => kC(t)
		}))
	});
}
// src/app/services/queries/direct.ts
function IC(e, t, n) {
	let r = e.find((e) => n(e) === n(t));
	return r && (r.generation > t.generation || r.version > t.version) ? e : r ? e.map((e) => n(e) === n(t) ? t : e) : [...e, t];
}
function LC(e, t, n) {
	return t.map((t) => {
		let r = e?.find((e) => n(e) === n(t));
		return r && (r.generation > t.generation || r.version > t.version) ? r : t;
	});
}
function RC(e, t, n = !0) {
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
function zC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, requestId: n, reply: r }) => e.replyPermission(t, n, r),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) })
	});
}
function BC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, reviewId: n, parentSessionId: r }) => r ? e.authorizeChildPermissionReviewRetry(r, t, n) : e.authorizePermissionReviewRetry(t, n),
		onSuccess: (e, n) => Promise.all([t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) }), ...n.parentSessionId ? [t.invalidateQueries({ queryKey: v.traditionalChildren(n.parentSessionId) })] : []])
	});
}
function VC() {
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
function HC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, grantId: n }) => e.deletePermissionGrant(t, n),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: v.sessionPermissions(n.sessionId) })
	});
}
function UC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.sessionGoal(e),
		queryFn: ({ signal: t }) => n.getGoal(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function WC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, payload: n }) => e.createGoal(t, n),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), e)
	});
}
function GC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, goalId: n, payload: r }) => e.updateGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), e)
	});
}
function KC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, goalId: n, expectedVersion: r }) => e.clearGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(v.sessionGoal(n.sessionId), null)
	});
}
function qC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.traditionalChildren(e),
		queryFn: ({ signal: t }) => n.listTraditionalChildren(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => LC(e, t, (e) => e.child_session_id)
	});
}
function JC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, payload: n }) => e.startTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.traditionalChildren(n.sessionId), (t = []) => IC(t, e, (e) => e.child_session_id));
		}
	});
}
function YC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, childId: n }) => e.cancelTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(v.traditionalChildren(n.sessionId), (t = []) => IC(t, e, (e) => e.child_session_id));
		}
	});
}
function XC(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.sessionInbox(e),
		queryFn: ({ signal: t }) => n.listInbox(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function ZC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, delivery: n, prompt: r }) => e.createInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => [...t.filter((t) => t.id !== e.id), e]);
		}
	});
}
function QC() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r, delivery: i }) => e.updateInboxItem(t, n, r, i),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
function $C() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r }) => e.cancelInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(v.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
// src/app/features/direct-session/commandWorkflow.ts
var ew = class extends FS("CommandFailure") {};
function tw(e) {
	return LS(function* () {
		yield* VS(e.optimistic);
		let t = yield* KS({
			try: e.admit,
			catch: (e) => new ew({
				operation: "submit",
				cause: e
			})
		}).pipe($S(() => VS(e.rejected)));
		return t.kind === "accepted" ? (yield* VS(() => e.reconcile(!1)), t.value) : (yield* VS(() => {
			t.kind === "uncertain" ? e.reconcile(!0) : e.rejected();
		}), yield* IS(new ew({
			operation: "submit",
			cause: t.error
		})));
	});
}
function nw(e) {
	return LS(function* () {
		yield* VS(e.optimistic), yield* KS({
			try: e.cancel,
			catch: (e) => new ew({
				operation: "stop",
				cause: e
			})
		}).pipe($S(() => VS(e.rollback))), yield* VS(e.settled);
	});
}
function rw(e) {
	return KS({
		try: e.create,
		catch: (e) => new ew({
			operation: "create",
			cause: e
		})
	}).pipe(QS((t) => VS(() => e.accept(t))));
}
function iw(e) {
	if (e.mode === "direct-running" || e.delivery) {
		let t = e.delivery ?? "steer";
		return KS({
			try: () => e.inbox(t),
			catch: (e) => new ew({
				operation: t,
				cause: e
			})
		}).pipe(qS(t === "queue" ? "queued" : "steered"));
	}
	return KS({
		try: e.submit,
		catch: (e) => new ew({
			operation: "submit",
			cause: e
		})
	}).pipe(qS("submitted"));
}
async function aw(e) {
	let t = await nC(e);
	if (Cp(t)) return t.value;
	let n = Mx(t.cause);
	throw En(n) ? n.value.cause : Nx(t.cause);
}
// src/app/features/direct-session/commandAdapters.ts
function ow(e, n) {
	let { api: r, stores: { runtimeStore: { captureRuntimeActivation: i, finishRunCancel: a, requestRunCancel: o, restoreRunCancel: s, runtimeStore: c } } } = t(e), l = i(n), u = v.sessionSnapshot(n), d, f, p, m = [];
	return {
		optimistic: () => {
			l() && (d = o()), f = e.getQueryData(u), p = f?.active_run ? {
				...f,
				active_run: void 0
			} : f, p &&= e.setQueryData(u, p);
			for (let t of [!1, !0]) {
				let r = e.getQueryData(v.sessions(t))?.find((e) => e.summary.session_id === n), i = e.setQueryData(v.sessions(t), (e) => e?.map((e) => e.summary.session_id !== n || !e.active && e.active_run === void 0 ? e : {
					...e,
					active: !1,
					active_run: void 0
				}))?.find((e) => e.summary.session_id === n);
				r && i && r !== i && m.push({
					stats: t,
					before: r,
					optimistic: i
				});
			}
		},
		cancel: () => r.cancelActiveRun(n),
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
function sw(e, t, n) {
	return Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && Number.isSafeInteger(e.total) && e.start >= 0 && e.start <= e.end && e.end <= e.total && e.end - e.start === t && n === t;
}
function cw(e, t) {
	return e?.length === t ? e : Array.from({ length: t }, () => null);
}
function lw(e, t) {
	return e === void 0 || e.length === t && e.every((e) => e === null || typeof e == "string");
}
function uw(e) {
	if (!e.startsWith("log:")) return e;
	let t = e.lastIndexOf(":"), n = e.lastIndexOf(":", t - 1);
	return n > 4 ? e.slice(0, n) : e;
}
function dw(e, t, n) {
	let r = /* @__PURE__ */ new Set();
	return (e ?? []).every(({ message_index: e }) => !Number.isSafeInteger(e) || r.has(e) || t[e - n]?.role !== "user" ? !1 : (r.add(e), !0));
}
function fw(e, t, n) {
	return (e ?? []).filter(({ message_index: e }) => e >= t && e < n);
}
function pw(e) {
	return sw(e.page, e.messages.length, e.created_at.length) && lw(e.tool_call_occurrences, e.messages.length) && dw(e.terminal_selection_attributions, e.messages, e.page.start);
}
function mw(e) {
	let t = e.message_page, n = e.message_created_at ?? [];
	return !!(t && sw(t, e.messages.length, n.length) && lw(e.tool_call_occurrences, e.messages.length) && dw(e.terminal_selection_attributions, e.messages, t.start));
}
function hw(e) {
	return e.message_page ?? {
		start: 0,
		end: e.messages.length,
		total: e.messages.length,
		has_older: !1
	};
}
function gw(e) {
	let t = e.message_created_at ?? [];
	return t.length === e.messages.length ? t : Array.from({ length: e.messages.length }, () => null);
}
function _w(e, t) {
	if (!pw(t)) return { kind: "snapshot-required" };
	let n = hw(e), r = gw(e);
	if (!sw(n, e.messages.length, r.length) || t.page.end !== t.page.total || t.page.total < n.total || t.page.start > n.end) return { kind: "snapshot-required" };
	for (let i = Math.max(n.start, t.page.start); i < Math.min(n.end, t.page.end); i += 1) if (JSON.stringify(e.messages[i - n.start]) !== JSON.stringify(t.messages[i - t.page.start]) || r[i - n.start] !== t.created_at[i - t.page.start] || (() => {
		let r = e.tool_call_occurrences?.[i - n.start], a = t.tool_call_occurrences?.[i - t.page.start];
		return r != null && a != null && uw(r) !== uw(a);
	})()) return { kind: "snapshot-required" };
	if (t.page.start <= n.start) return {
		kind: "accepted",
		snapshot: {
			...e,
			messages: t.messages,
			message_created_at: t.created_at,
			tool_call_occurrences: cw(t.tool_call_occurrences, t.messages.length),
			message_page: t.page,
			terminal_selection_attributions: t.terminal_selection_attributions ?? []
		}
	};
	let i = t.page.start - n.start;
	if (i > e.messages.length) return { kind: "snapshot-required" };
	let a = cw(e.tool_call_occurrences, e.messages.length).slice(0, i);
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
			tool_call_occurrences: [...a, ...cw(t.tool_call_occurrences, t.messages.length)],
			terminal_selection_attributions: [...fw(e.terminal_selection_attributions, n.start, t.page.start), ...t.terminal_selection_attributions ?? []],
			message_page: {
				...t.page,
				start: n.start,
				has_older: n.start > 0
			}
		}
	};
}
function vw(e, t, n) {
	if (!pw(t)) return null;
	let r = hw(e), i = gw(e);
	return r.start !== n || t.page.end !== n || t.page.total !== r.total || !sw(r, e.messages.length, i.length) ? null : {
		...e,
		messages: [...t.messages, ...e.messages],
		message_created_at: [...t.created_at, ...i],
		tool_call_occurrences: [...cw(t.tool_call_occurrences, t.messages.length), ...cw(e.tool_call_occurrences, e.messages.length)],
		terminal_selection_attributions: [...t.terminal_selection_attributions ?? [], ...fw(e.terminal_selection_attributions, r.start, r.end)],
		message_page: {
			start: t.page.start,
			end: r.end,
			total: r.total,
			has_older: t.page.start > 0
		}
	};
}
function yw(e, t, n) {
	if (n || !e || !t.message_page) return t;
	if (!mw(t)) return e;
	let r = t.message_created_at ?? [], i = _w(e, {
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
function bw(e, t, n) {
	let r = e.filter((e) => e !== t), i = Math.max(0, Math.min(n, r.length));
	return [
		...r.slice(0, i),
		t,
		...r.slice(i)
	];
}
function xw(e, t) {
	return (e.sort_order ?? 0) - (t.sort_order ?? 0) || o(t.created_at) - o(e.created_at);
}
function Sw(e, t) {
	return e.filter((e) => !!e.summary.pinned === t).sort((e, t) => xw(e.summary, t.summary));
}
function Cw(e, t, n) {
	let r = new Map(n.map((e) => [e.summary.session_id, e])), i = {};
	for (let e of t) i[e] = r.get(e)?.summary.presentation_version ?? 0;
	return {
		pinned: e,
		session_ids: t,
		expected_versions: i
	};
}
function ww(e, t) {
	return e.map((e) => e.summary.session_id === t.session_id ? {
		...e,
		summary: t
	} : e);
}
function Tw(e, t, n, r) {
	if (t === r) {
		let t = e.findIndex((e) => e.summary.session_id === r);
		return t < 0 ? e.length : t;
	}
	let i = e.filter((e) => e.summary.session_id !== r), a = i.findIndex((e) => e.summary.session_id === t);
	return a < 0 ? i.length : n === "before" ? a : a + 1;
}
function Ew(e, t) {
	return e.length === t.length && e.every((e, n) => e === t[n]);
}
// src/app/services/queries/invalidation.ts
function Dw() {
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
var Ow = /* @__PURE__ */ new Map(), kw = 0, Aw = /* @__PURE__ */ new WeakMap(), jw = 0;
function Mw(e, t) {
	let n = Aw.get(e);
	return n === void 0 && (n = ++jw, Aw.set(e, n)), `${n}:${t}`;
}
function Nw(e) {
	let t = Ow.get(e);
	if (t) return t;
	let n = {
		generation: ++kw,
		replaceNextSnapshot: !1,
		tailController: null,
		historyControllers: /* @__PURE__ */ new Set()
	};
	return Ow.set(e, n), n;
}
function Pw(e, t = !1) {
	let n = Nw(e);
	n.generation = ++kw, n.replaceNextSnapshot ||= t, n.tailController?.abort(), n.tailController = null;
	for (let e of n.historyControllers) e.abort();
	return n.historyControllers.clear(), n.generation;
}
function Fw(e) {
	let t = Nw(e);
	return {
		generation: Pw(e),
		replace: t.replaceNextSnapshot
	};
}
function Iw(e, t) {
	let n = Ow.get(e);
	n?.generation === t.generation && t.replace && (n.replaceNextSnapshot = !1);
}
function Lw(e) {
	let t = Nw(e);
	t.tailController?.abort();
	let n = new AbortController();
	return t.tailController = n, {
		generation: t.generation,
		controller: n
	};
}
function Rw(e, t) {
	let n = Ow.get(e);
	n?.tailController === t.controller && (n.tailController = null);
}
function zw(e, t) {
	return Ow.get(e)?.generation === t;
}
function Bw(e) {
	let t = Nw(e), n = new AbortController();
	return t.historyControllers.add(n), {
		generation: t.generation,
		controller: n
	};
}
function Vw(e, t) {
	Ow.get(e)?.historyControllers.delete(t.controller);
}
function Hw(e) {
	let t = Ow.get(e);
	t?.tailController?.abort();
	for (let e of t?.historyControllers ?? []) e.abort();
	Ow.delete(e);
}
// src/app/services/queries/session.ts
function Uw(e = be) {
	let { api: t } = r();
	return g({
		queryKey: v.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: e,
		staleTime: 0,
		placeholderData: re
	});
}
function Ww(e) {
	let { api: t } = r(), n = d((t) => t.find((t) => t.summary.session_id === e) ?? null, [e]);
	return g({
		queryKey: v.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: be,
		staleTime: 0,
		placeholderData: re,
		select: n
	});
}
function Gw(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function Kw(e, t) {
	let { api: n } = r(), i = _();
	return g({
		queryKey: v.sessionSnapshot(e ?? ""),
		queryFn: async ({ signal: t }) => {
			let r = Fw(Mw(i, e)), a = await n.getSession(e, {
				messageLimit: 24,
				threadEventLimit: 50,
				includeSessions: !1,
				includeSystem: !0,
				signal: t
			});
			if (!mw(a)) throw Error("The server returned an invalid snapshot message page.");
			if (t.aborted || !zw(Mw(i, e), r.generation)) throw new DOMException("Snapshot superseded", "AbortError");
			return Iw(Mw(i, e), r), yw(i.getQueryData(v.sessionSnapshot(e)), a, r.replace);
		},
		enabled: !!e,
		staleTime: 1e3,
		placeholderData: Gw(e ?? ""),
		...t
	});
}
function qw(e) {
	let { api: t } = r(), n = _();
	return h({ mutationFn: async () => {
		let r = n.getQueryData(v.sessionSnapshot(e))?.message_page?.start;
		if (r === void 0 || r <= 0) throw Error("No older messages are available.");
		let i = Mw(n, e), a = Bw(i);
		try {
			let o = await t.getMessages(e, {
				before: r,
				limit: 24,
				includeSystem: !0,
				signal: a.controller.signal
			});
			if (!pw(o)) throw Error("The server returned an invalid message page.");
			if (!zw(i, a.generation)) return !1;
			let s = !1;
			return n.setQueryData(v.sessionSnapshot(e), (e) => {
				if (!e) return e;
				let t = vw(e, o, r);
				return t ? (s = !0, t) : e;
			}), s;
		} catch (e) {
			if (a.controller.signal.aborted) return !1;
			throw e;
		} finally {
			Vw(i, a);
		}
	} });
}
function Jw(e) {
	let { api: t } = r();
	return g({
		queryKey: v.sessionConfig(e ?? ""),
		queryFn: ({ signal: n }) => t.getConfig(e, n),
		enabled: !!e
	});
}
function Yw() {
	let { api: e } = r(), t = Dw(), n = _();
	return h({
		retry: !1,
		mutationFn: (r) => aw(rw({
			create: () => e.createSession(r),
			accept: (e) => {
				let r = e.metadata.session_id;
				if (!r) throw Error("The server returned a chat without an identity.");
				Pw(Mw(n, r), !0), n.setQueryData(v.sessionSnapshot(r), e), t.sessions();
			}
		}))
	});
}
function Xw(e, t) {
	let n = [];
	for (let r of e.getQueryCache().findAll({ queryKey: ["session"] })) {
		let e = r.queryKey;
		if (e[0] !== "session" || e[2] !== "snapshot" || typeof e[1] != "string") continue;
		let i = e[1];
		i !== t && r.state.data?.forks?.some((e) => e.session_id === t) && n.push(i);
	}
	return n;
}
function Zw() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = Dw(), i = _();
	return h({
		mutationFn: (t) => e.deleteSession(t),
		onSuccess: (e, r) => {
			t.purgeSessions([r]), n.sessions(), i.removeQueries({ queryKey: v.sessionRoot(r) });
			for (let e of Xw(i, r)) n.sessionRoot(e);
		}
	});
}
function Qw() {
	let { api: e } = r(), t = Dw();
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
function $w() {
	let e = Qw();
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
function eT() {
	let { api: e } = r(), t = Dw();
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
				a = ww(a, t);
			}
			let s = Sw(a, r), c = s.map((e) => e.summary.session_id), l = bw(c, n, i);
			return Ew(c, l) ? null : e.reorderSessions(Cw(r, l, s));
		},
		onSuccess: () => t.sessions()
	});
}
function tT() {
	let { api: e } = r(), t = Dw(), n = _();
	return h({
		retry: !1,
		mutationFn: ({ id: t, patch: n }) => e.updateConfig(t, n),
		onSuccess: (e, { id: r }) => {
			n.invalidateQueries({ queryKey: v.sessionConfig(r) }), t.session(r), t.sessions();
		}
	});
}
function nT() {
	let { api: e } = r(), { captureRuntimeActivation: t, setOptimisticUserPrompt: i } = r().stores.runtimeStore, a = Dw(), o = _();
	return h({
		retry: !1,
		mutationFn: ({ id: r, prompt: s, signal: c }) => {
			let l = t(r);
			return aw(tw({
				optimistic: () => {
					l() && i(s);
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
						error: new n(t.requestId, t.error)
					};
				},
				rejected: () => {
					l() && i(null);
				},
				reconcile: (e) => {
					e ? (Pw(Mw(o, r), !0), a.sessionRoot(r)) : a.session(r);
				}
			}));
		}
	});
}
function rT() {
	let e = _();
	return h({
		retry: !1,
		mutationFn: (t) => aw(nw(ow(e, t)))
	});
}
function iT() {
	let { api: e } = r(), t = Dw(), n = _();
	return h({
		mutationFn: (t) => e.compactSession(t),
		onSuccess: (e, r) => (Pw(Mw(n, r), !0), t.sessionRoot(r))
	});
}
function aT() {
	let { api: e } = r(), t = Dw(), n = _();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.revertSession(t, n),
		onSuccess: (e, { id: r }) => {
			Pw(Mw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function oT() {
	let { api: e } = r(), t = Dw(), n = _();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.regenerateRun(t, n),
		onSuccess: (e, { id: r }) => {
			Pw(Mw(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function sT() {
	let { api: e } = r(), t = Dw();
	return h({
		mutationFn: ({ id: t, messageIdx: n }) => e.forkSession(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n), t.sessions();
		}
	});
}
function cT() {
	let { api: e } = r(), t = Dw();
	return h({
		mutationFn: ({ id: t, forkId: n }) => e.dismissSessionFork(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n);
		}
	});
}
function lT() {
	return Uw();
}
// src/app/services/queries/workspace.ts
function uT(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function dT(e, t, n = "all", i = 3, a = null) {
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
		placeholderData: uT(e ?? "")
	});
}
function fT(e, t = null) {
	let { api: n } = r();
	return g({
		queryKey: v.workspaceFiles(e ?? "", t),
		queryFn: ({ signal: r }) => n.getWorkspaceFiles(e, t, r),
		enabled: !!e,
		staleTime: t == null ? 1e4 : Infinity,
		placeholderData: uT(e ?? "")
	});
}
function pT(e, t, n = null) {
	let { api: i } = r();
	return g({
		queryKey: v.workspaceFile(e ?? "", t ?? "", n),
		queryFn: ({ signal: r }) => i.getWorkspaceFile(e, t, n, r),
		enabled: !!(e && t),
		staleTime: n == null ? 1e4 : Infinity,
		placeholderData: uT(e ?? "")
	});
}
function mT(e) {
	let { api: t } = r();
	return g({
		queryKey: v.workspaceRevisions(e ?? ""),
		queryFn: ({ signal: n }) => t.getWorkspaceRevisions(e, n),
		enabled: !!e,
		staleTime: 5e3,
		retry: !1
	});
}
function hT(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.workspaceRevisionChanges(e ?? "", t ?? 0),
		queryFn: ({ signal: r }) => n.getWorkspaceRevisionChanges(e, t, r),
		enabled: !!(e && t != null),
		staleTime: Infinity,
		placeholderData: uT(e ?? "")
	});
}
function gT(e, t) {
	let { api: n } = r();
	return g({
		queryKey: v.branches(e ?? ""),
		queryFn: ({ signal: t }) => n.getBranches(e, t),
		enabled: !!e && t,
		staleTime: 5e3,
		retry: !1
	});
}
function _T(e) {
	let { api: t } = r(), n = _();
	return h({
		mutationFn: (n) => t.switchBranch(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: v.branches(e) }), n.invalidateQueries({ queryKey: v.sessionRoot(e) }), n.invalidateQueries({ queryKey: v.sessionsAll });
		}
	});
}
function vT(e) {
	let { api: t } = r(), n = _();
	return h({
		mutationFn: (n) => t.commitWorkspace(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: v.sessionRoot(e) }), n.invalidateQueries({ queryKey: v.sessionsAll });
		}
	});
}
// src/app/services/queries/projects.ts
function yT() {
	let { api: e } = r();
	return g({
		queryKey: v.projects,
		queryFn: ({ signal: t }) => e.listProjects(t),
		staleTime: 3e4,
		retry: !1
	});
}
function bT() {
	let { api: e } = r(), t = Dw();
	return h({
		retry: !1,
		mutationFn: (t) => e.createProject(t),
		onSuccess: () => t.projects()
	});
}
function xT() {
	let { api: e } = r(), t = Dw();
	return h({
		retry: !1,
		mutationFn: ({ projectId: t, payload: n }) => e.updateProject(t, n),
		onSuccess: () => t.projects()
	});
}
function ST() {
	let e = xT();
	return {
		...e,
		toggle: (t) => e.mutateAsync({
			projectId: t.project_id,
			payload: { pinned: !t.pinned }
		})
	};
}
function CT() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = Dw();
	return h({
		mutationFn: ({ projectId: t, sessions: n }) => e.deleteProject(t, n),
		onSuccess: (e) => (t.purgeSessions(e.deleted_session_ids), Promise.all([n.projects(), n.sessions()]))
	});
}
function wT() {
	let { api: e } = r(), t = Dw();
	return h({
		mutationFn: ({ projectId: t, sessionId: n }) => e.assignSessionToProject(t, { session_id: n }),
		onSuccess: () => Promise.all([t.projects(), t.sessions()])
	});
}
function TT() {
	let { api: e } = r(), t = Dw();
	return h({
		mutationFn: async ({ projects: t, projectId: n, targetPinned: r, targetIndex: i }) => {
			let a = t.find((e) => e.project_id === n);
			if (!a) return;
			let o = t;
			a.pinned !== r && (await e.updateProject(n, { pinned: r }), o = (await e.listProjects()).projects);
			let s = o.filter((e) => e.pinned === r).sort((e, t) => e.sort_order - t.sort_order), c = bw(s.map((e) => e.project_id), n, i);
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
var ET = {
	scope: null,
	epoch: null,
	revision: 0,
	sessions: /* @__PURE__ */ new Map()
};
function DT(e, t) {
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
var OT = 1e3, kT = 3e4;
function AT(e = {}) {
	let t = r(), { api: n, client: i } = t, a = e.projectId, o = e.enabled ?? !0, s = o && (e.stream ?? !0), [c, l] = ee(DT, ET), u = te(0), d = te({
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
		}), n = !1, r = null, i = null, o = OT, c = () => {
			r?.close(), r = null, !(n || i !== null) && (t("down"), i = setTimeout(() => {
				i = null, f();
			}, o), o = Math.min(o * 2, kT));
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
				}), c(), ue()) : (o = OT, s.kind === "snapshot" && (d.current = {
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
		...c.scope === (a ?? null) ? c : ET,
		status: fe
	};
}
// src/app/features/managed/model.ts
var jT = [
	"status",
	"github",
	"secrets"
], MT = /* @__PURE__ */ new Set([
	"PATH",
	"HOME",
	"NAC_HOME",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"EXA_API_KEY"
]);
function NT(e) {
	return e ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(e) ? MT.has(e) ? `${e} is managed by NAC and cannot be replaced here.` : "" : "Use letters, digits, and underscores; the first character cannot be a digit." : "Enter a variable name.";
}
function PT(e) {
	let t = e?.split("/") ?? [];
	return t.length === 2 && t[0] && t[1] ? [t[0], t[1]] : null;
}
function FT(e) {
	return e?.status === "running";
}
function IT(e) {
	return e ? {
		backend: e.model.backend,
		model: e.model.id,
		baseUrl: e.model.endpoint
	} : null;
}
function LT(e, t) {
	return !!(t && e && t.backend === e.model.backend && t.baseUrl === e.model.endpoint);
}
function RT(e, t) {
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
function zT(e) {
	return typeof e == "object" && e && "status" in e ? e.status : null;
}
function BT(e) {
	return VT(e) || e instanceof Error && e.name === "ManagedUpgradeContractError";
}
function VT(e) {
	let t = zT(e);
	return t === 401 || t === 403 || t === 409;
}
function HT(e) {
	let t = zT(e);
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
var UT = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying"
]);
function WT(e) {
	return UT.has(e);
}
function GT(e) {
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
function KT(e) {
	switch (e) {
		case "cancel_active_run": return "Stop run";
		case "cancel_traditional_child": return "Cancel coding agent";
		case "cancel_managed_orchestrator": return "Cancel NAC orchestrator";
		case "terminate_terminal": return "Stop terminal";
		case "cancel_clone_operation": return "Cancel clone";
		case "wait": return "Wait";
	}
}
function qT(e) {
	return e === null ? "Accepted-release distance unavailable" : e === 0 ? "Current accepted release" : `${e} accepted ${e === 1 ? "release" : "releases"} ahead`;
}
function JT(e, t) {
	return e.release_id === t.release_id && e.source_revision === t.source_revision && e.build_id === t.build_id && e.product_version === t.product_version && e.schema_version === t.schema_version;
}
// src/app/features/managed/upgradeContract.ts
var YT = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying",
	"succeeded",
	"failed"
]), XT = /* @__PURE__ */ new Set([
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
]), ZT = /* @__PURE__ */ new Set([
	"wait",
	"cancel_active_run",
	"cancel_traditional_child",
	"cancel_managed_orchestrator",
	"terminate_terminal",
	"cancel_clone_operation"
]), QT = {
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
}, $T = class extends Error {
	constructor() {
		super("Managed upgrade status did not match the browser contract."), this.name = "ManagedUpgradeContractError";
	}
};
function eE() {
	throw new $T();
}
function tE(e, t, n) {
	(typeof e != "object" || !e || Array.isArray(e)) && eE();
	let r = e;
	return Object.keys(r).some((e) => !t.includes(e)) && eE(), n.some((e) => !Object.hasOwn(r, e)) && eE(), r;
}
function nE(e, t, n = !0) {
	return (typeof e != "string" || e.length > t || !n && e.length === 0 || /\p{Cc}/u.test(e)) && eE(), e;
}
function rE(e) {
	return (typeof e != "number" || !Number.isSafeInteger(e) || e < 0) && eE(), e;
}
function iE(e, t) {
	return typeof e == "string" && t.has(e) || eE(), e;
}
function aE(e, t, n) {
	return Object.hasOwn(e, t) ? nE(e[t], n) : void 0;
}
function oE(e) {
	let t = tE(e, [
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
	]), n = nE(t.source_revision, 40, !1);
	return /^[a-f0-9]{40}$/.test(n) || eE(), {
		release_id: nE(t.release_id, 63, !1),
		source_revision: n,
		build_id: nE(t.build_id, 128, !1),
		product_version: nE(t.product_version, 128, !1),
		schema_version: rE(t.schema_version)
	};
}
function sE(e, t) {
	return Object.hasOwn(e, t) ? oE(e[t]) : void 0;
}
function cE(e) {
	let t = nE(e, 128, !1);
	return /^[A-Za-z0-9_.:@-]+$/.test(t) || eE(), t;
}
function lE(e) {
	let t = [
		"session_id",
		"run_id",
		"child_session_id",
		"orchestrator_session_id",
		"terminal_id",
		"clone_operation_id"
	], n = tE(e, t, []);
	return Object.fromEntries(t.filter((e) => Object.hasOwn(n, e)).map((e) => [e, cE(n[e])]));
}
function uE(e, t) {
	let n = Object.keys(e).sort();
	return n.length === t.length && t.every((t) => n.includes(t) && !!e[t]);
}
function dE(e, t, n) {
	switch (t) {
		case "cancel_active_run": return e === "active_run" && uE(n, ["session_id", "run_id"]);
		case "cancel_traditional_child": return e === "traditional_child" && uE(n, ["session_id", "child_session_id"]);
		case "cancel_managed_orchestrator": return e === "managed_orchestrator" && uE(n, ["session_id", "orchestrator_session_id"]);
		case "terminate_terminal": return e === "terminal_process" && uE(n, ["session_id", "terminal_id"]);
		case "cancel_clone_operation": return e === "clone_operation" && uE(n, ["clone_operation_id"]);
		case "wait": return !1;
	}
}
function fE(e) {
	let t = tE(e, [
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
	]), n = nE(t.selection_key, 71, !1);
	/^sha256:[a-f0-9]{64}$/.test(n) || eE();
	let r = iE(t.kind, XT), i = nE(t.message, 512, !1);
	QT[r].includes(i) || eE(), typeof t.actionable != "boolean" && eE();
	let a = iE(t.action, ZT);
	if (!t.actionable) return (a !== "wait" || t.target !== null) && eE(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !1,
		action: a,
		target: null
	};
	let o = lE(t.target);
	return dE(r, a, o) || eE(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !0,
		action: a,
		target: o
	};
}
function pE(e) {
	let t = tE(e, [
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
	t.kind !== "upgrade" && eE();
	let n;
	return Object.hasOwn(t, "blockers") && ((!Array.isArray(t.blockers) || t.blockers.length > 100) && eE(), n = t.blockers.map(fE)), {
		operation_id: nE(t.operation_id, 128, !1),
		managed_host_id: nE(t.managed_host_id, 128, !1),
		kind: "upgrade",
		state: iE(t.state, YT),
		reason: aE(t, "reason", 128),
		message: aE(t, "message", 512),
		target_release: sE(t, "target_release"),
		desired_release: sE(t, "desired_release"),
		observed_release: sE(t, "observed_release"),
		blockers: n,
		created_at: aE(t, "created_at", 64),
		updated_at: aE(t, "updated_at", 64)
	};
}
function mE(e) {
	let t = tE(e, ["preview", "operation"], ["preview", "operation"]), n = tE(t.preview, [
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
	typeof n.upgrade_available != "boolean" && eE();
	let r = null;
	return n.distance !== null && (r = { accepted_releases: rE(tE(n.distance, ["accepted_releases"], ["accepted_releases"]).accepted_releases) }), {
		preview: {
			current: oE(n.current),
			latest_beta: oE(n.latest_beta),
			upgrade_available: n.upgrade_available,
			distance: r
		},
		operation: t.operation === null ? null : pE(t.operation)
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
function hE() {
	let { api: e } = r();
	return g({
		queryKey: $.hostStatus,
		queryFn: ({ signal: t }) => e.getManagedStatus(t),
		staleTime: 5e3,
		refetchInterval: 15e3,
		retry: !1
	});
}
function gE(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: $.upgrade,
		queryFn: async ({ signal: e }) => mE(await t.getManagedUpgrade(e)),
		enabled: e,
		staleTime: 0,
		refetchInterval: (e) => e.state.data?.operation && WT(e.state.data.operation.state) ? 1e3 : 15e3,
		refetchIntervalInBackground: !0,
		retry: !1
	});
}
function _E() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: async (t) => pE(await e.startManagedUpgrade(t)),
		onSuccess: (e) => (t.setQueryData($.upgrade, (t) => t && {
			...t,
			operation: e
		}), t.invalidateQueries({ queryKey: $.upgrade }))
	});
}
function vE(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: $.github,
		queryFn: ({ signal: e }) => t.getManagedGitHub(e),
		enabled: e,
		retry: !1
	});
}
function yE(e = !0) {
	let { api: t } = r();
	return g({
		queryKey: $.secrets,
		queryFn: ({ signal: e }) => t.listManagedSecrets(e),
		enabled: e,
		retry: !1
	});
}
function bE() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: ({ name: t, value: n }) => e.putManagedSecret(t, n),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: $.secrets }), t.invalidateQueries({ queryKey: $.hostStatus })])
	});
}
function xE() {
	let { api: e } = r(), t = _();
	return h({
		mutationFn: (t) => e.deleteManagedSecret(t),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: $.secrets }), t.invalidateQueries({ queryKey: $.hostStatus })])
	});
}
function SE(e = !0, t = !1) {
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
function CE(e, t, n) {
	let { api: i } = r(), a = _(), o = DC(e === "chatgpt-codex-responses" && t !== null && n !== null);
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
function wE(e, t, n = null) {
	let { api: i } = r(), a = _(), o = DC(t && e === "chatgpt-codex-responses");
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
function TE(e) {
	let { api: t } = r(), n = _(), i = hE().data ?? null, a = m(() => RT(e, i), [e, i]), o = ie({ queries: a.map((r) => ({
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
var EE = u(null), DE = 150, OE = 3, kE = 0, AE = () => `toast-${Date.now()}-${kE++}`;
function jE({ toasts: e, removeToast: t }) {
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
function ME({ children: e }) {
	let [t, n] = ne([]), r = d((e) => {
		let t = AE();
		return n((n) => [...n, {
			id: t,
			content: e.content,
			variant: e.variant ?? s.Info,
			life: e.life ?? OE,
			keep: e.keep ?? !1,
			dismissing: !1
		}]), t;
	}, []), i = d((e) => {
		n((t) => {
			let r = t.find((t) => t.id === e);
			return !r || r.dismissing ? t : (setTimeout(() => n((t) => t.filter((t) => t.id !== e)), DE), t.map((t) => t.id === e ? {
				...t,
				dismissing: !0
			} : t));
		});
	}, []), a = d(() => {
		n((e) => e.length === 0 ? e : (setTimeout(() => n((e) => e.filter((e) => !e.dismissing)), DE), e.map((e) => ({
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
	return /* @__PURE__ */ se(EE.Provider, {
		value: o,
		children: [e, /* @__PURE__ */ oe(jE, {
			toasts: t,
			removeToast: i
		})]
	});
}
function NE() {
	let e = f(EE);
	if (!e) throw Error("useToast must be used within a ToastProvider");
	return e;
}
function PE(e) {
	return e instanceof Error ? e.message : String(e);
}
// src/app/lib/PerfProfiler.tsx
var FE = (t, n, r) => {
	e(`commit:${t}`, {
		ms: r,
		fields: { phase: n },
		throttleMs: 1e3,
		slowMs: 16
	});
};
function IE({ id: e, children: t }) {
	return i() ? /* @__PURE__ */ oe(l, {
		id: e,
		onRender: FE,
		children: t
	}) : /* @__PURE__ */ oe(ae, { children: t });
}
// src/app/lib/workspaceLink.ts
var LE = /^(https?|ircs?|mailto|xmpp|file)$/i, RE = /^[a-zA-Z]:[\\/]/, zE = /^(https?|mailto|ircs?|xmpp):/i;
function BE(e) {
	let t = String(e ?? "").trim();
	if (!t) return "";
	if (RE.test(t)) return t;
	let n = t.indexOf(":");
	return n === -1 || LE.test(t.slice(0, n)) ? t : "";
}
function VE(e) {
	return e.replace(/\\/g, "/");
}
function HE(e, t) {
	if (!t) return null;
	let n = VE(t).replace(/\/+$/, "");
	return n ? e === n ? "" : e.startsWith(`${n}/`) ? e.slice(n.length + 1) : null : null;
}
function UE(e, t = []) {
	let n = (e ?? "").trim();
	if (!n || n.startsWith("#")) return { kind: "blocked" };
	if (zE.test(n)) return {
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
	r = VE(r);
	for (let e of t) {
		let t = HE(r, e);
		if (t != null) {
			r = t;
			break;
		}
	}
	return r.startsWith("/") || RE.test(r) || (r = r.replace(/^\.\//, ""), !r || r === ".") || r.split("/").includes("..") || r.includes("://") ? { kind: "blocked" } : {
		kind: "workspace",
		path: r
	};
}
export { cT as $, ge as $n, yC as $t, NT as A, zS as An, WC as At, xT as B, Ix as Bn, GC as Bt, GT as C, eC as Cn, _w as Ct, jT as D, nC as Dn, $C as Dt, JT as E, tC as En, BC as Et, bT as F, GS as Fn, XC as Ft, pT as G, Cp as Gn, MC as Gt, vT as H, Mx as Hn, FC as Ht, CT as I, FS as In, RC as It, mT as J, En as Jn, dC as Jt, fT as K, wp as Kn, kC as Kt, TT as L, AS as Ln, VC as Lt, PT as M, VS as Mn, HC as Mt, AT as N, $S as Nn, zC as Nt, FT as O, rC as On, YC as Ot, wT as P, KS as Pn, UC as Pt, Zw as Q, me as Qn, _C as Qt, yT as R, Px as Rn, JC as Rt, WT as S, WS as Sn, Tw as St, BT as T, ZS as Tn, aw as Tt, _T as U, Nx as Un, PC as Ut, gT as V, Rx as Vn, QC as Vt, dT as W, Sp as Wn, NC as Wt, iT as X, pe as Xn, hC as Xt, rT as Y, v as Yn, xC as Yt, Yw as Z, fe as Zn, CC as Zt, TE as _, JS as _n, Rw as _t, PE as a, jC as an, Jw as at, VT as b, IS as bn, xw as bt, xE as c, lC as cn, Uw as ct, hE as d, wC as dn, tT as dt, EC as en, ye as er, sT as et, wE as f, SC as fn, Qw as ft, bE as g, HS as gn, Pw as gt, CE as h, oC as hn, Hw as ht, ME as i, uC as in, le as ir, aT as it, LT as j, BS as jn, ZC as jt, IT as k, XS as kn, KC as kt, SE as l, pC as ln, nT as lt, gE as m, aC as mn, Lw as mt, BE as n, bC as nn, ve as nr, eT as nt, NE as o, AC as on, Kw as ot, yE as p, gC as pn, lT as pt, hT as q, li as qn, cC as qt, IE as r, DC as rn, ue as rr, oT as rt, $ as s, mC as sn, Ww as st, UE as t, TC as tn, _e as tr, qw as tt, vE as u, fC as un, $w as ut, _E as v, US as vn, zw as vt, HT as w, RS as wn, iw as wt, qT as x, LS as xn, Sw as xt, KT as y, YS as yn, Mw as yt, ST as z, Fx as zn, qC as zt };
