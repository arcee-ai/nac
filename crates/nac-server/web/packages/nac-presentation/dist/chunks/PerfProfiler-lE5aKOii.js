import { J as e, L as t, a as n, at as r, c as i, d as a, i as o, n as s, o as c, q as l, r as u } from "./PresentationBoundary-h8wd0qiZ.js";
import * as d from "react";
import { Profiler as f, createContext as p, createElement as m, forwardRef as h, useCallback as g, useContext as _, useEffect as v, useInsertionEffect as y, useLayoutEffect as b, useMemo as x, useRef as S, useState as C, useSyncExternalStore as w } from "react";
import { keepPreviousData as T, useInfiniteQuery as ee, useMutation as E, useQueries as te, useQuery as D, useQueryClient as O } from "@tanstack/react-query";
import { Fragment as ne, jsx as k, jsxs as A } from "react/jsx-runtime";
import { useLocation as re } from "react-router-dom";
import * as ie from "react-dom";
import { createPortal as j } from "react-dom";
// src/app/lib/routes.ts
var ae = [
	"sessions",
	"insights",
	"threads",
	"delegated",
	"files",
	"terminal",
	"heartbeats",
	"worksets",
	"history"
], oe = {
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
ae.filter((e) => e !== "history");
var se = "insights";
function ce(e) {
	return ae.includes(e ?? "");
}
var le = {
	list: () => "/",
	session: (e, t = se) => `/session/${encodeURIComponent(e)}/${t}`,
	project: (e) => `/project/${encodeURIComponent(e)}`,
	taskSchedules: (e) => e ? `/project/${encodeURIComponent(e)}/task-schedules` : "/task-schedules",
	designPreview: () => "/design"
};
function ue(e) {
	let [, t, n] = e.split("/");
	return t !== "session" || !n ? null : decodeURIComponent(n);
}
function de(e) {
	let [, t, n] = e.split("/");
	return t !== "project" || !n ? null : decodeURIComponent(n);
}
// src/app/features/ui-policy/policy.ts
var fe = { orchestrationEnabled: !1 };
function pe(e, t) {
	return e.orchestrationEnabled ? t : "direct";
}
function me(e, t, n) {
	return e.orchestrationEnabled || t === "direct" && n?.kind !== "managed-orchestrator";
}
function he(e, t) {
	return t.filter((t) => me(e, t.summary.behavior, t.lineage));
}
function ge(e, t, n) {
	return e.orchestrationEnabled || !t.some((e) => e.lineage == null && e.summary.project_id === n);
}
// src/app/features/ui-policy/UiPolicyContext.ts
var _e = p(fe);
function ve() {
	return _(_e);
}
// node_modules/clsx/dist/clsx.mjs
function ye(e) {
	var t, n, r = "";
	if (typeof e == "string" || typeof e == "number") r += e;
	else if (typeof e == "object") {
		if (Array.isArray(e)) {
			var i = e.length;
			for (t = 0; t < i; t++) e[t] && (n = ye(e[t])) && (r && (r += " "), r += n);
		} else for (n in e) e[n] && (r && (r += " "), r += n);
	}
	return r;
}
function be() {
	for (var e, t, n = 0, r = "", i = arguments.length; n < i; n++) (e = arguments[n]) && (t = ye(e)) && (r && (r += " "), r += t);
	return r;
}
// node_modules/tailwind-merge/dist/bundle-mjs.mjs
var xe = (e, t) => {
	let n = Array(e.length + t.length);
	for (let t = 0; t < e.length; t++) n[t] = e[t];
	for (let r = 0; r < t.length; r++) n[e.length + r] = t[r];
	return n;
}, Se = (e, t) => ({
	classGroupId: e,
	validator: t
}), Ce = (e = /* @__PURE__ */ new Map(), t = null, n) => ({
	nextPart: e,
	validators: t,
	classGroupId: n
}), we = "-", Te = [], Ee = "arbitrary..", De = (e) => {
	let t = Ae(e), { conflictingClassGroups: n, conflictingClassGroupModifiers: r } = e;
	return {
		getClassGroupId: (e) => {
			if (e.startsWith("[") && e.endsWith("]")) return ke(e);
			let n = e.split(we);
			return Oe(n, +(n[0] === "" && n.length > 1), t);
		},
		getConflictingClassGroupIds: (e, t) => {
			if (t) {
				let t = r[e], i = n[e];
				return t ? i ? xe(i, t) : t : i || Te;
			}
			return n[e] || Te;
		}
	};
}, Oe = (e, t, n) => {
	if (e.length - t === 0) return n.classGroupId;
	let r = e[t], i = n.nextPart.get(r);
	if (i) {
		let n = Oe(e, t + 1, i);
		if (n) return n;
	}
	let a = n.validators;
	if (a === null) return;
	let o = t === 0 ? e.join(we) : e.slice(t).join(we), s = a.length;
	for (let e = 0; e < s; e++) {
		let t = a[e];
		if (t.validator(o)) return t.classGroupId;
	}
}, ke = (e) => e.slice(1, -1).indexOf(":") === -1 ? void 0 : (() => {
	let t = e.slice(1, -1), n = t.indexOf(":"), r = t.slice(0, n);
	return r ? Ee + r : void 0;
})(), Ae = (e) => {
	let { theme: t, classGroups: n } = e;
	return je(n, t);
}, je = (e, t) => {
	let n = Ce();
	for (let r in e) {
		let i = e[r];
		Me(i, n, r, t);
	}
	return n;
}, Me = (e, t, n, r) => {
	let i = e.length;
	for (let a = 0; a < i; a++) {
		let i = e[a];
		Ne(i, t, n, r);
	}
}, Ne = (e, t, n, r) => {
	typeof e == "string" ? Pe(e, t, n) : typeof e == "function" ? Fe(e, t, n, r) : Ie(e, t, n, r);
}, Pe = (e, t, n) => {
	let r = e === "" ? t : Le(t, e);
	r.classGroupId = n;
}, Fe = (e, t, n, r) => {
	Re(e) ? Me(e(r), t, n, r) : (t.validators === null && (t.validators = []), t.validators.push(Se(n, e)));
}, Ie = (e, t, n, r) => {
	let i = Object.entries(e), a = i.length;
	for (let e = 0; e < a; e++) {
		let [a, o] = i[e];
		Me(o, Le(t, a), n, r);
	}
}, Le = (e, t) => {
	let n = e, r = t.split(we), i = r.length;
	for (let e = 0; e < i; e++) {
		let t = r[e], i = n.nextPart.get(t);
		i || (i = Ce(), n.nextPart.set(t, i)), n = i;
	}
	return n;
}, Re = (e) => "isThemeGetter" in e && e.isThemeGetter === !0, ze = (e) => {
	if (e < 1) return {
		get: () => void 0,
		set: () => {}
	};
	let t = 0, n = Object.create(null), r = Object.create(null), i = (i, a) => {
		n[i] = a, t++, t > e && (t = 0, r = n, n = Object.create(null));
	};
	return {
		get(e) {
			let t = n[e];
			if (t !== void 0) return t;
			if ((t = r[e]) !== void 0) return i(e, t), t;
		},
		set(e, t) {
			e in n ? n[e] = t : i(e, t);
		}
	};
}, Be = "!", Ve = ":", He = [], Ue = (e, t, n, r, i) => ({
	modifiers: e,
	hasImportantModifier: t,
	baseClassName: n,
	maybePostfixModifierPosition: r,
	isExternal: i
}), We = (e) => {
	let { prefix: t, experimentalParseClassName: n } = e, r = (e) => {
		let t = [], n = 0, r = 0, i = 0, a, o = e.length;
		for (let s = 0; s < o; s++) {
			let o = e[s];
			if (n === 0 && r === 0) {
				if (o === Ve) {
					t.push(e.slice(i, s)), i = s + 1;
					continue;
				}
				if (o === "/") {
					a = s;
					continue;
				}
			}
			o === "[" ? n++ : o === "]" ? n-- : o === "(" ? r++ : o === ")" && r--;
		}
		let s = t.length === 0 ? e : e.slice(i), c = s, l = !1;
		s.endsWith(Be) ? (c = s.slice(0, -1), l = !0) : s.startsWith(Be) && (c = s.slice(1), l = !0);
		let u = a && a > i ? a - i : void 0;
		return Ue(t, l, c, u);
	};
	if (t) {
		let e = t + Ve, n = r;
		r = (t) => t.startsWith(e) ? n(t.slice(e.length)) : Ue(He, !1, t, void 0, !0);
	}
	if (n) {
		let e = r;
		r = (t) => n({
			className: t,
			parseClassName: e
		});
	}
	return r;
}, Ge = (e) => {
	let t = /* @__PURE__ */ new Map();
	return e.orderSensitiveModifiers.forEach((e, n) => {
		t.set(e, 1e6 + n);
	}), (e) => {
		let n = [], r = [];
		for (let i = 0; i < e.length; i++) {
			let a = e[i], o = a[0] === "[", s = t.has(a);
			o || s ? (r.length > 0 && (r.sort(), n.push(...r), r = []), n.push(a)) : r.push(a);
		}
		return r.length > 0 && (r.sort(), n.push(...r)), n;
	};
}, Ke = (e) => ({
	cache: ze(e.cacheSize),
	parseClassName: We(e),
	sortModifiers: Ge(e),
	postfixLookupClassGroupIds: qe(e),
	...De(e)
}), qe = (e) => {
	let t = Object.create(null), n = e.postfixLookupClassGroups;
	if (n) for (let e = 0; e < n.length; e++) t[n[e]] = !0;
	return t;
}, Je = /\s+/, Ye = (e, t) => {
	let { parseClassName: n, getClassGroupId: r, getConflictingClassGroupIds: i, sortModifiers: a, postfixLookupClassGroupIds: o } = t, s = [], c = e.trim().split(Je), l = "";
	for (let e = c.length - 1; e >= 0; --e) {
		let t = c[e], { isExternal: u, modifiers: d, hasImportantModifier: f, baseClassName: p, maybePostfixModifierPosition: m } = n(t);
		if (u) {
			l = t + (l.length > 0 ? " " + l : l);
			continue;
		}
		let h = !!m, g;
		if (h) {
			g = r(p.substring(0, m));
			let e = g && o[g] ? r(p) : void 0;
			e && e !== g && (g = e, h = !1);
		} else g = r(p);
		if (!g) {
			if (!h || (g = r(p), !g)) {
				l = t + (l.length > 0 ? " " + l : l);
				continue;
			}
			h = !1;
		}
		let _ = d.length === 0 ? "" : d.length === 1 ? d[0] : a(d).join(":"), v = f ? _ + Be : _, y = v + g;
		if (s.indexOf(y) > -1) continue;
		s.push(y);
		let b = i(g, h);
		for (let e = 0; e < b.length; ++e) {
			let t = b[e];
			s.push(v + t);
		}
		l = t + (l.length > 0 ? " " + l : l);
	}
	return l;
}, Xe = (...e) => {
	let t = 0, n, r, i = "";
	for (; t < e.length;) (n = e[t++]) && (r = Ze(n)) && (i && (i += " "), i += r);
	return i;
}, Ze = (e) => {
	if (typeof e == "string") return e;
	let t, n = "";
	for (let r = 0; r < e.length; r++) e[r] && (t = Ze(e[r])) && (n && (n += " "), n += t);
	return n;
}, Qe = (e, ...t) => {
	let n, r, i, a, o = (o) => (n = Ke(t.reduce((e, t) => t(e), e())), r = n.cache.get, i = n.cache.set, a = s, s(o)), s = (e) => {
		let t = r(e);
		if (t) return t;
		let a = Ye(e, n);
		return i(e, a), a;
	};
	return a = o, (...e) => a(Xe(...e));
}, $e = [], et = (e) => {
	let t = (t) => t[e] || $e;
	return t.isThemeGetter = !0, t;
}, tt = /^\[(?:(\w[\w-]*):)?(.+)\]$/i, nt = /^\((?:(\w[\w-]*):)?(.+)\)$/i, rt = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/, it = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/, at = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/, ot = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/, st = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/, ct = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/, lt = (e) => rt.test(e), M = (e) => !!e && !Number.isNaN(Number(e)), ut = (e) => !!e && Number.isInteger(Number(e)), dt = (e) => e.endsWith("%") && M(e.slice(0, -1)), ft = (e) => it.test(e), pt = () => !0, mt = (e) => at.test(e) && !ot.test(e), ht = () => !1, gt = (e) => st.test(e), _t = (e) => ct.test(e), vt = (e) => !N(e) && !P(e), yt = (e) => e.startsWith("@container") && (e[10] === "/" && e[11] !== void 0 || e[11] === "s" && e[16] !== void 0 && e.startsWith("-size/", 10) || e[11] === "n" && e[18] !== void 0 && e.startsWith("-normal/", 10)), bt = (e) => Ft(e, zt, ht), N = (e) => tt.test(e), xt = (e) => Ft(e, Bt, mt), St = (e) => Ft(e, Vt, M), Ct = (e) => Ft(e, Ut, pt), wt = (e) => Ft(e, Ht, ht), Tt = (e) => Ft(e, Lt, ht), Et = (e) => Ft(e, Rt, _t), Dt = (e) => Ft(e, Wt, gt), P = (e) => nt.test(e), Ot = (e) => It(e, Bt), kt = (e) => It(e, Ht), At = (e) => It(e, Lt), jt = (e) => It(e, zt), Mt = (e) => It(e, Rt), Nt = (e) => It(e, Wt, !0), Pt = (e) => It(e, Ut, !0), Ft = (e, t, n) => {
	let r = tt.exec(e);
	return r ? r[1] ? t(r[1]) : n(r[2]) : !1;
}, It = (e, t, n = !1) => {
	let r = nt.exec(e);
	return r ? r[1] ? t(r[1]) : n : !1;
}, Lt = (e) => e === "position" || e === "percentage", Rt = (e) => e === "image" || e === "url", zt = (e) => e === "length" || e === "size" || e === "bg-size", Bt = (e) => e === "length", Vt = (e) => e === "number", Ht = (e) => e === "family-name", Ut = (e) => e === "number" || e === "weight", Wt = (e) => e === "shadow", Gt = () => {
	let e = et("color"), t = et("font"), n = et("text"), r = et("font-weight"), i = et("tracking"), a = et("leading"), o = et("breakpoint"), s = et("container"), c = et("spacing"), l = et("radius"), u = et("shadow"), d = et("inset-shadow"), f = et("text-shadow"), p = et("drop-shadow"), m = et("blur"), h = et("perspective"), g = et("aspect"), _ = et("ease"), v = et("animate"), y = () => [
		"auto",
		"avoid",
		"all",
		"avoid-page",
		"page",
		"left",
		"right",
		"column"
	], b = () => [
		"center",
		"top",
		"bottom",
		"left",
		"right",
		"top-left",
		"left-top",
		"top-right",
		"right-top",
		"bottom-right",
		"right-bottom",
		"bottom-left",
		"left-bottom"
	], x = () => [
		...b(),
		P,
		N
	], S = () => [
		"auto",
		"hidden",
		"clip",
		"visible",
		"scroll"
	], C = () => [
		"auto",
		"contain",
		"none"
	], w = () => [
		P,
		N,
		c
	], T = () => [
		lt,
		"full",
		"auto",
		...w()
	], ee = () => [
		ut,
		"none",
		"subgrid",
		P,
		N
	], E = () => [
		"auto",
		{ span: [
			"full",
			ut,
			P,
			N
		] },
		ut,
		P,
		N
	], te = () => [
		ut,
		"auto",
		P,
		N
	], D = () => [
		"auto",
		"min",
		"max",
		"fr",
		P,
		N
	], O = () => [
		"start",
		"end",
		"center",
		"between",
		"around",
		"evenly",
		"stretch",
		"baseline",
		"center-safe",
		"end-safe"
	], ne = () => [
		"start",
		"end",
		"center",
		"stretch",
		"center-safe",
		"end-safe"
	], k = () => ["auto", ...w()], A = () => [
		lt,
		"auto",
		"full",
		"dvw",
		"dvh",
		"lvw",
		"lvh",
		"svw",
		"svh",
		"min",
		"max",
		"fit",
		...w()
	], re = () => [
		lt,
		"screen",
		"full",
		"dvw",
		"lvw",
		"svw",
		"min",
		"max",
		"fit",
		...w()
	], ie = () => [
		lt,
		"screen",
		"full",
		"lh",
		"dvh",
		"lvh",
		"svh",
		"min",
		"max",
		"fit",
		...w()
	], j = () => [
		e,
		P,
		N
	], ae = () => [
		...b(),
		At,
		Tt,
		{ position: [P, N] }
	], oe = () => ["no-repeat", { repeat: [
		"",
		"x",
		"y",
		"space",
		"round"
	] }], se = () => [
		"auto",
		"cover",
		"contain",
		jt,
		bt,
		{ size: [P, N] }
	], ce = () => [
		dt,
		Ot,
		xt
	], le = () => [
		"",
		"none",
		"full",
		l,
		P,
		N
	], ue = () => [
		"",
		M,
		Ot,
		xt
	], de = () => [
		"solid",
		"dashed",
		"dotted",
		"double"
	], fe = () => [
		"normal",
		"multiply",
		"screen",
		"overlay",
		"darken",
		"lighten",
		"color-dodge",
		"color-burn",
		"hard-light",
		"soft-light",
		"difference",
		"exclusion",
		"hue",
		"saturation",
		"color",
		"luminosity"
	], pe = () => [
		M,
		dt,
		At,
		Tt
	], me = () => [
		"",
		"none",
		m,
		P,
		N
	], he = () => [
		"none",
		M,
		P,
		N
	], ge = () => [
		"none",
		M,
		P,
		N
	], _e = () => [
		M,
		P,
		N
	], ve = () => [
		lt,
		"full",
		...w()
	];
	return {
		cacheSize: 500,
		theme: {
			animate: [
				"spin",
				"ping",
				"pulse",
				"bounce"
			],
			aspect: ["video"],
			blur: [ft],
			breakpoint: [ft],
			color: [pt],
			container: [ft],
			"drop-shadow": [ft],
			ease: [
				"in",
				"out",
				"in-out"
			],
			font: [vt],
			"font-weight": [
				"thin",
				"extralight",
				"light",
				"normal",
				"medium",
				"semibold",
				"bold",
				"extrabold",
				"black"
			],
			"inset-shadow": [ft],
			leading: [
				"none",
				"tight",
				"snug",
				"normal",
				"relaxed",
				"loose"
			],
			perspective: [
				"dramatic",
				"near",
				"normal",
				"midrange",
				"distant",
				"none"
			],
			radius: [ft],
			shadow: [ft],
			spacing: ["px", M],
			text: [ft],
			"text-shadow": [ft],
			tracking: [
				"tighter",
				"tight",
				"normal",
				"wide",
				"wider",
				"widest"
			]
		},
		classGroups: {
			aspect: [{ aspect: [
				"auto",
				"square",
				lt,
				N,
				P,
				g
			] }],
			container: ["container"],
			"container-type": [{ "@container": [
				"",
				"normal",
				"size",
				P,
				N
			] }],
			"container-named": [yt],
			columns: [{ columns: [
				M,
				N,
				P,
				s
			] }],
			"break-after": [{ "break-after": y() }],
			"break-before": [{ "break-before": y() }],
			"break-inside": [{ "break-inside": [
				"auto",
				"avoid",
				"avoid-page",
				"avoid-column"
			] }],
			"box-decoration": [{ "box-decoration": ["slice", "clone"] }],
			box: [{ box: ["border", "content"] }],
			display: [
				"block",
				"inline-block",
				"inline",
				"flex",
				"inline-flex",
				"table",
				"inline-table",
				"table-caption",
				"table-cell",
				"table-column",
				"table-column-group",
				"table-footer-group",
				"table-header-group",
				"table-row-group",
				"table-row",
				"flow-root",
				"grid",
				"inline-grid",
				"contents",
				"list-item",
				"hidden"
			],
			sr: ["sr-only", "not-sr-only"],
			float: [{ float: [
				"right",
				"left",
				"none",
				"start",
				"end"
			] }],
			clear: [{ clear: [
				"left",
				"right",
				"both",
				"none",
				"start",
				"end"
			] }],
			isolation: ["isolate", "isolation-auto"],
			"object-fit": [{ object: [
				"contain",
				"cover",
				"fill",
				"none",
				"scale-down"
			] }],
			"object-position": [{ object: x() }],
			overflow: [{ overflow: S() }],
			"overflow-x": [{ "overflow-x": S() }],
			"overflow-y": [{ "overflow-y": S() }],
			overscroll: [{ overscroll: C() }],
			"overscroll-x": [{ "overscroll-x": C() }],
			"overscroll-y": [{ "overscroll-y": C() }],
			position: [
				"static",
				"fixed",
				"absolute",
				"relative",
				"sticky"
			],
			inset: [{ inset: T() }],
			"inset-x": [{ "inset-x": T() }],
			"inset-y": [{ "inset-y": T() }],
			start: [{
				"inset-s": T(),
				start: T()
			}],
			end: [{
				"inset-e": T(),
				end: T()
			}],
			"inset-bs": [{ "inset-bs": T() }],
			"inset-be": [{ "inset-be": T() }],
			top: [{ top: T() }],
			right: [{ right: T() }],
			bottom: [{ bottom: T() }],
			left: [{ left: T() }],
			visibility: [
				"visible",
				"invisible",
				"collapse"
			],
			z: [{ z: [
				ut,
				"auto",
				P,
				N
			] }],
			basis: [{ basis: [
				lt,
				"full",
				"auto",
				s,
				...w()
			] }],
			"flex-direction": [{ flex: [
				"row",
				"row-reverse",
				"col",
				"col-reverse"
			] }],
			"flex-wrap": [{ flex: [
				"nowrap",
				"wrap",
				"wrap-reverse"
			] }],
			flex: [{ flex: [
				M,
				lt,
				"auto",
				"initial",
				"none",
				N
			] }],
			grow: [{ grow: [
				"",
				M,
				P,
				N
			] }],
			shrink: [{ shrink: [
				"",
				M,
				P,
				N
			] }],
			order: [{ order: [
				ut,
				"first",
				"last",
				"none",
				P,
				N
			] }],
			"grid-cols": [{ "grid-cols": ee() }],
			"col-start-end": [{ col: E() }],
			"col-start": [{ "col-start": te() }],
			"col-end": [{ "col-end": te() }],
			"grid-rows": [{ "grid-rows": ee() }],
			"row-start-end": [{ row: E() }],
			"row-start": [{ "row-start": te() }],
			"row-end": [{ "row-end": te() }],
			"grid-flow": [{ "grid-flow": [
				"row",
				"col",
				"dense",
				"row-dense",
				"col-dense"
			] }],
			"auto-cols": [{ "auto-cols": D() }],
			"auto-rows": [{ "auto-rows": D() }],
			gap: [{ gap: w() }],
			"gap-x": [{ "gap-x": w() }],
			"gap-y": [{ "gap-y": w() }],
			"justify-content": [{ justify: [...O(), "normal"] }],
			"justify-items": [{ "justify-items": [...ne(), "normal"] }],
			"justify-self": [{ "justify-self": ["auto", ...ne()] }],
			"align-content": [{ content: ["normal", ...O()] }],
			"align-items": [{ items: [...ne(), { baseline: ["", "last"] }] }],
			"align-self": [{ self: [
				"auto",
				...ne(),
				{ baseline: ["", "last"] }
			] }],
			"place-content": [{ "place-content": O() }],
			"place-items": [{ "place-items": [...ne(), "baseline"] }],
			"place-self": [{ "place-self": ["auto", ...ne()] }],
			p: [{ p: w() }],
			px: [{ px: w() }],
			py: [{ py: w() }],
			ps: [{ ps: w() }],
			pe: [{ pe: w() }],
			pbs: [{ pbs: w() }],
			pbe: [{ pbe: w() }],
			pt: [{ pt: w() }],
			pr: [{ pr: w() }],
			pb: [{ pb: w() }],
			pl: [{ pl: w() }],
			m: [{ m: k() }],
			mx: [{ mx: k() }],
			my: [{ my: k() }],
			ms: [{ ms: k() }],
			me: [{ me: k() }],
			mbs: [{ mbs: k() }],
			mbe: [{ mbe: k() }],
			mt: [{ mt: k() }],
			mr: [{ mr: k() }],
			mb: [{ mb: k() }],
			ml: [{ ml: k() }],
			"space-x": [{ "space-x": w() }],
			"space-x-reverse": ["space-x-reverse"],
			"space-y": [{ "space-y": w() }],
			"space-y-reverse": ["space-y-reverse"],
			size: [{ size: A() }],
			"inline-size": [{ inline: ["auto", ...re()] }],
			"min-inline-size": [{ "min-inline": ["auto", ...re()] }],
			"max-inline-size": [{ "max-inline": ["none", ...re()] }],
			"block-size": [{ block: ["auto", ...ie()] }],
			"min-block-size": [{ "min-block": ["auto", ...ie()] }],
			"max-block-size": [{ "max-block": ["none", ...ie()] }],
			w: [{ w: [
				s,
				"screen",
				...A()
			] }],
			"min-w": [{ "min-w": [
				s,
				"screen",
				"none",
				...A()
			] }],
			"max-w": [{ "max-w": [
				s,
				"screen",
				"none",
				"prose",
				{ screen: [o] },
				...A()
			] }],
			h: [{ h: [
				"screen",
				"lh",
				...A()
			] }],
			"min-h": [{ "min-h": [
				"screen",
				"lh",
				"none",
				...A()
			] }],
			"max-h": [{ "max-h": [
				"screen",
				"lh",
				...A()
			] }],
			"font-size": [{ text: [
				"base",
				n,
				Ot,
				xt
			] }],
			"font-smoothing": ["antialiased", "subpixel-antialiased"],
			"font-style": ["italic", "not-italic"],
			"font-weight": [{ font: [
				r,
				Pt,
				Ct
			] }],
			"font-stretch": [{ "font-stretch": [
				"ultra-condensed",
				"extra-condensed",
				"condensed",
				"semi-condensed",
				"normal",
				"semi-expanded",
				"expanded",
				"extra-expanded",
				"ultra-expanded",
				dt,
				N
			] }],
			"font-family": [{ font: [
				kt,
				wt,
				t
			] }],
			"font-features": [{ "font-features": [N] }],
			"fvn-normal": ["normal-nums"],
			"fvn-ordinal": ["ordinal"],
			"fvn-slashed-zero": ["slashed-zero"],
			"fvn-figure": ["lining-nums", "oldstyle-nums"],
			"fvn-spacing": ["proportional-nums", "tabular-nums"],
			"fvn-fraction": ["diagonal-fractions", "stacked-fractions"],
			tracking: [{ tracking: [
				i,
				P,
				N
			] }],
			"line-clamp": [{ "line-clamp": [
				M,
				"none",
				P,
				St
			] }],
			leading: [{ leading: [a, ...w()] }],
			"list-image": [{ "list-image": [
				"none",
				P,
				N
			] }],
			"list-style-position": [{ list: ["inside", "outside"] }],
			"list-style-type": [{ list: [
				"disc",
				"decimal",
				"none",
				P,
				N
			] }],
			"text-alignment": [{ text: [
				"left",
				"center",
				"right",
				"justify",
				"start",
				"end"
			] }],
			"placeholder-color": [{ placeholder: j() }],
			"text-color": [{ text: j() }],
			"text-decoration": [
				"underline",
				"overline",
				"line-through",
				"no-underline"
			],
			"text-decoration-style": [{ decoration: [...de(), "wavy"] }],
			"text-decoration-thickness": [{ decoration: [
				M,
				"from-font",
				"auto",
				P,
				xt
			] }],
			"text-decoration-color": [{ decoration: j() }],
			"underline-offset": [{ "underline-offset": [
				M,
				"auto",
				P,
				N
			] }],
			"text-transform": [
				"uppercase",
				"lowercase",
				"capitalize",
				"normal-case"
			],
			"text-overflow": [
				"truncate",
				"text-ellipsis",
				"text-clip"
			],
			"text-wrap": [{ text: [
				"wrap",
				"nowrap",
				"balance",
				"pretty"
			] }],
			indent: [{ indent: w() }],
			"tab-size": [{ tab: [
				ut,
				P,
				N
			] }],
			"vertical-align": [{ align: [
				"baseline",
				"top",
				"middle",
				"bottom",
				"text-top",
				"text-bottom",
				"sub",
				"super",
				P,
				N
			] }],
			whitespace: [{ whitespace: [
				"normal",
				"nowrap",
				"pre",
				"pre-line",
				"pre-wrap",
				"break-spaces"
			] }],
			break: [{ break: [
				"normal",
				"words",
				"all",
				"keep"
			] }],
			wrap: [{ wrap: [
				"break-word",
				"anywhere",
				"normal"
			] }],
			hyphens: [{ hyphens: [
				"none",
				"manual",
				"auto"
			] }],
			content: [{ content: [
				"none",
				P,
				N
			] }],
			"bg-attachment": [{ bg: [
				"fixed",
				"local",
				"scroll"
			] }],
			"bg-clip": [{ "bg-clip": [
				"border",
				"padding",
				"content",
				"text"
			] }],
			"bg-origin": [{ "bg-origin": [
				"border",
				"padding",
				"content"
			] }],
			"bg-position": [{ bg: ae() }],
			"bg-repeat": [{ bg: oe() }],
			"bg-size": [{ bg: se() }],
			"bg-image": [{ bg: [
				"none",
				{
					linear: [
						{ to: [
							"t",
							"tr",
							"r",
							"br",
							"b",
							"bl",
							"l",
							"tl"
						] },
						ut,
						P,
						N
					],
					radial: [
						"",
						P,
						N
					],
					conic: [
						ut,
						P,
						N
					]
				},
				Mt,
				Et
			] }],
			"bg-color": [{ bg: j() }],
			"gradient-from-pos": [{ from: ce() }],
			"gradient-via-pos": [{ via: ce() }],
			"gradient-to-pos": [{ to: ce() }],
			"gradient-from": [{ from: j() }],
			"gradient-via": [{ via: j() }],
			"gradient-to": [{ to: j() }],
			rounded: [{ rounded: le() }],
			"rounded-s": [{ "rounded-s": le() }],
			"rounded-e": [{ "rounded-e": le() }],
			"rounded-t": [{ "rounded-t": le() }],
			"rounded-r": [{ "rounded-r": le() }],
			"rounded-b": [{ "rounded-b": le() }],
			"rounded-l": [{ "rounded-l": le() }],
			"rounded-ss": [{ "rounded-ss": le() }],
			"rounded-se": [{ "rounded-se": le() }],
			"rounded-ee": [{ "rounded-ee": le() }],
			"rounded-es": [{ "rounded-es": le() }],
			"rounded-tl": [{ "rounded-tl": le() }],
			"rounded-tr": [{ "rounded-tr": le() }],
			"rounded-br": [{ "rounded-br": le() }],
			"rounded-bl": [{ "rounded-bl": le() }],
			"border-w": [{ border: ue() }],
			"border-w-x": [{ "border-x": ue() }],
			"border-w-y": [{ "border-y": ue() }],
			"border-w-s": [{ "border-s": ue() }],
			"border-w-e": [{ "border-e": ue() }],
			"border-w-bs": [{ "border-bs": ue() }],
			"border-w-be": [{ "border-be": ue() }],
			"border-w-t": [{ "border-t": ue() }],
			"border-w-r": [{ "border-r": ue() }],
			"border-w-b": [{ "border-b": ue() }],
			"border-w-l": [{ "border-l": ue() }],
			"divide-x": [{ "divide-x": ue() }],
			"divide-x-reverse": ["divide-x-reverse"],
			"divide-y": [{ "divide-y": ue() }],
			"divide-y-reverse": ["divide-y-reverse"],
			"border-style": [{ border: [
				...de(),
				"hidden",
				"none"
			] }],
			"divide-style": [{ divide: [
				...de(),
				"hidden",
				"none"
			] }],
			"border-color": [{ border: j() }],
			"border-color-x": [{ "border-x": j() }],
			"border-color-y": [{ "border-y": j() }],
			"border-color-s": [{ "border-s": j() }],
			"border-color-e": [{ "border-e": j() }],
			"border-color-bs": [{ "border-bs": j() }],
			"border-color-be": [{ "border-be": j() }],
			"border-color-t": [{ "border-t": j() }],
			"border-color-r": [{ "border-r": j() }],
			"border-color-b": [{ "border-b": j() }],
			"border-color-l": [{ "border-l": j() }],
			"divide-color": [{ divide: j() }],
			"outline-style": [{ outline: [
				...de(),
				"none",
				"hidden"
			] }],
			"outline-offset": [{ "outline-offset": [
				M,
				P,
				N
			] }],
			"outline-w": [{ outline: [
				"",
				M,
				Ot,
				xt
			] }],
			"outline-color": [{ outline: j() }],
			shadow: [{ shadow: [
				"",
				"none",
				u,
				Nt,
				Dt
			] }],
			"shadow-color": [{ shadow: j() }],
			"inset-shadow": [{ "inset-shadow": [
				"none",
				d,
				Nt,
				Dt
			] }],
			"inset-shadow-color": [{ "inset-shadow": j() }],
			"ring-w": [{ ring: ue() }],
			"ring-w-inset": ["ring-inset"],
			"ring-color": [{ ring: j() }],
			"ring-offset-w": [{ "ring-offset": [M, xt] }],
			"ring-offset-color": [{ "ring-offset": j() }],
			"inset-ring-w": [{ "inset-ring": ue() }],
			"inset-ring-color": [{ "inset-ring": j() }],
			"text-shadow": [{ "text-shadow": [
				"none",
				f,
				Nt,
				Dt
			] }],
			"text-shadow-color": [{ "text-shadow": j() }],
			opacity: [{ opacity: [
				M,
				P,
				N
			] }],
			"mix-blend": [{ "mix-blend": [
				...fe(),
				"plus-darker",
				"plus-lighter"
			] }],
			"bg-blend": [{ "bg-blend": fe() }],
			"mask-clip": [{ "mask-clip": [
				"border",
				"padding",
				"content",
				"fill",
				"stroke",
				"view"
			] }, "mask-no-clip"],
			"mask-composite": [{ mask: [
				"add",
				"subtract",
				"intersect",
				"exclude"
			] }],
			"mask-image-linear-pos": [{ "mask-linear": [M] }],
			"mask-image-linear-from-pos": [{ "mask-linear-from": pe() }],
			"mask-image-linear-to-pos": [{ "mask-linear-to": pe() }],
			"mask-image-linear-from-color": [{ "mask-linear-from": j() }],
			"mask-image-linear-to-color": [{ "mask-linear-to": j() }],
			"mask-image-t-from-pos": [{ "mask-t-from": pe() }],
			"mask-image-t-to-pos": [{ "mask-t-to": pe() }],
			"mask-image-t-from-color": [{ "mask-t-from": j() }],
			"mask-image-t-to-color": [{ "mask-t-to": j() }],
			"mask-image-r-from-pos": [{ "mask-r-from": pe() }],
			"mask-image-r-to-pos": [{ "mask-r-to": pe() }],
			"mask-image-r-from-color": [{ "mask-r-from": j() }],
			"mask-image-r-to-color": [{ "mask-r-to": j() }],
			"mask-image-b-from-pos": [{ "mask-b-from": pe() }],
			"mask-image-b-to-pos": [{ "mask-b-to": pe() }],
			"mask-image-b-from-color": [{ "mask-b-from": j() }],
			"mask-image-b-to-color": [{ "mask-b-to": j() }],
			"mask-image-l-from-pos": [{ "mask-l-from": pe() }],
			"mask-image-l-to-pos": [{ "mask-l-to": pe() }],
			"mask-image-l-from-color": [{ "mask-l-from": j() }],
			"mask-image-l-to-color": [{ "mask-l-to": j() }],
			"mask-image-x-from-pos": [{ "mask-x-from": pe() }],
			"mask-image-x-to-pos": [{ "mask-x-to": pe() }],
			"mask-image-x-from-color": [{ "mask-x-from": j() }],
			"mask-image-x-to-color": [{ "mask-x-to": j() }],
			"mask-image-y-from-pos": [{ "mask-y-from": pe() }],
			"mask-image-y-to-pos": [{ "mask-y-to": pe() }],
			"mask-image-y-from-color": [{ "mask-y-from": j() }],
			"mask-image-y-to-color": [{ "mask-y-to": j() }],
			"mask-image-radial": [{ "mask-radial": [P, N] }],
			"mask-image-radial-from-pos": [{ "mask-radial-from": pe() }],
			"mask-image-radial-to-pos": [{ "mask-radial-to": pe() }],
			"mask-image-radial-from-color": [{ "mask-radial-from": j() }],
			"mask-image-radial-to-color": [{ "mask-radial-to": j() }],
			"mask-image-radial-shape": [{ "mask-radial": ["circle", "ellipse"] }],
			"mask-image-radial-size": [{ "mask-radial": [{
				closest: ["side", "corner"],
				farthest: ["side", "corner"]
			}] }],
			"mask-image-radial-pos": [{ "mask-radial-at": b() }],
			"mask-image-conic-pos": [{ "mask-conic": [M] }],
			"mask-image-conic-from-pos": [{ "mask-conic-from": pe() }],
			"mask-image-conic-to-pos": [{ "mask-conic-to": pe() }],
			"mask-image-conic-from-color": [{ "mask-conic-from": j() }],
			"mask-image-conic-to-color": [{ "mask-conic-to": j() }],
			"mask-mode": [{ mask: [
				"alpha",
				"luminance",
				"match"
			] }],
			"mask-origin": [{ "mask-origin": [
				"border",
				"padding",
				"content",
				"fill",
				"stroke",
				"view"
			] }],
			"mask-position": [{ mask: ae() }],
			"mask-repeat": [{ mask: oe() }],
			"mask-size": [{ mask: se() }],
			"mask-type": [{ "mask-type": ["alpha", "luminance"] }],
			"mask-image": [{ mask: [
				"none",
				P,
				N
			] }],
			filter: [{ filter: [
				"",
				"none",
				P,
				N
			] }],
			blur: [{ blur: me() }],
			brightness: [{ brightness: [
				M,
				P,
				N
			] }],
			contrast: [{ contrast: [
				M,
				P,
				N
			] }],
			"drop-shadow": [{ "drop-shadow": [
				"",
				"none",
				p,
				Nt,
				Dt
			] }],
			"drop-shadow-color": [{ "drop-shadow": j() }],
			grayscale: [{ grayscale: [
				"",
				M,
				P,
				N
			] }],
			"hue-rotate": [{ "hue-rotate": [
				M,
				P,
				N
			] }],
			invert: [{ invert: [
				"",
				M,
				P,
				N
			] }],
			saturate: [{ saturate: [
				M,
				P,
				N
			] }],
			sepia: [{ sepia: [
				"",
				M,
				P,
				N
			] }],
			"backdrop-filter": [{ "backdrop-filter": [
				"",
				"none",
				P,
				N
			] }],
			"backdrop-blur": [{ "backdrop-blur": me() }],
			"backdrop-brightness": [{ "backdrop-brightness": [
				M,
				P,
				N
			] }],
			"backdrop-contrast": [{ "backdrop-contrast": [
				M,
				P,
				N
			] }],
			"backdrop-grayscale": [{ "backdrop-grayscale": [
				"",
				M,
				P,
				N
			] }],
			"backdrop-hue-rotate": [{ "backdrop-hue-rotate": [
				M,
				P,
				N
			] }],
			"backdrop-invert": [{ "backdrop-invert": [
				"",
				M,
				P,
				N
			] }],
			"backdrop-opacity": [{ "backdrop-opacity": [
				M,
				P,
				N
			] }],
			"backdrop-saturate": [{ "backdrop-saturate": [
				M,
				P,
				N
			] }],
			"backdrop-sepia": [{ "backdrop-sepia": [
				"",
				M,
				P,
				N
			] }],
			"border-collapse": [{ border: ["collapse", "separate"] }],
			"border-spacing": [{ "border-spacing": w() }],
			"border-spacing-x": [{ "border-spacing-x": w() }],
			"border-spacing-y": [{ "border-spacing-y": w() }],
			"table-layout": [{ table: ["auto", "fixed"] }],
			caption: [{ caption: ["top", "bottom"] }],
			transition: [{ transition: [
				"",
				"all",
				"colors",
				"opacity",
				"shadow",
				"transform",
				"none",
				P,
				N
			] }],
			"transition-behavior": [{ transition: ["normal", "discrete"] }],
			duration: [{ duration: [
				M,
				"initial",
				P,
				N
			] }],
			ease: [{ ease: [
				"linear",
				"initial",
				_,
				P,
				N
			] }],
			delay: [{ delay: [
				M,
				P,
				N
			] }],
			animate: [{ animate: [
				"none",
				v,
				P,
				N
			] }],
			backface: [{ backface: ["hidden", "visible"] }],
			perspective: [{ perspective: [
				h,
				P,
				N
			] }],
			"perspective-origin": [{ "perspective-origin": x() }],
			rotate: [{ rotate: he() }],
			"rotate-x": [{ "rotate-x": he() }],
			"rotate-y": [{ "rotate-y": he() }],
			"rotate-z": [{ "rotate-z": he() }],
			scale: [{ scale: ge() }],
			"scale-x": [{ "scale-x": ge() }],
			"scale-y": [{ "scale-y": ge() }],
			"scale-z": [{ "scale-z": ge() }],
			"scale-3d": ["scale-3d"],
			skew: [{ skew: _e() }],
			"skew-x": [{ "skew-x": _e() }],
			"skew-y": [{ "skew-y": _e() }],
			transform: [{ transform: [
				P,
				N,
				"",
				"none",
				"gpu",
				"cpu"
			] }],
			"transform-origin": [{ origin: x() }],
			"transform-style": [{ transform: ["3d", "flat"] }],
			translate: [{ translate: ve() }],
			"translate-x": [{ "translate-x": ve() }],
			"translate-y": [{ "translate-y": ve() }],
			"translate-z": [{ "translate-z": ve() }],
			"translate-none": ["translate-none"],
			zoom: [{ zoom: [
				ut,
				P,
				N
			] }],
			accent: [{ accent: j() }],
			appearance: [{ appearance: ["none", "auto"] }],
			"caret-color": [{ caret: j() }],
			"color-scheme": [{ scheme: [
				"normal",
				"dark",
				"light",
				"light-dark",
				"only-dark",
				"only-light"
			] }],
			cursor: [{ cursor: [
				"auto",
				"default",
				"pointer",
				"wait",
				"text",
				"move",
				"help",
				"not-allowed",
				"none",
				"context-menu",
				"progress",
				"cell",
				"crosshair",
				"vertical-text",
				"alias",
				"copy",
				"no-drop",
				"grab",
				"grabbing",
				"all-scroll",
				"col-resize",
				"row-resize",
				"n-resize",
				"e-resize",
				"s-resize",
				"w-resize",
				"ne-resize",
				"nw-resize",
				"se-resize",
				"sw-resize",
				"ew-resize",
				"ns-resize",
				"nesw-resize",
				"nwse-resize",
				"zoom-in",
				"zoom-out",
				P,
				N
			] }],
			"field-sizing": [{ "field-sizing": ["fixed", "content"] }],
			"pointer-events": [{ "pointer-events": ["auto", "none"] }],
			resize: [{ resize: [
				"none",
				"",
				"y",
				"x"
			] }],
			"scroll-behavior": [{ scroll: ["auto", "smooth"] }],
			"scrollbar-thumb-color": [{ "scrollbar-thumb": j() }],
			"scrollbar-track-color": [{ "scrollbar-track": j() }],
			"scrollbar-gutter": [{ "scrollbar-gutter": [
				"auto",
				"stable",
				"both"
			] }],
			"scrollbar-w": [{ scrollbar: [
				"auto",
				"thin",
				"none"
			] }],
			"scroll-m": [{ "scroll-m": w() }],
			"scroll-mx": [{ "scroll-mx": w() }],
			"scroll-my": [{ "scroll-my": w() }],
			"scroll-ms": [{ "scroll-ms": w() }],
			"scroll-me": [{ "scroll-me": w() }],
			"scroll-mbs": [{ "scroll-mbs": w() }],
			"scroll-mbe": [{ "scroll-mbe": w() }],
			"scroll-mt": [{ "scroll-mt": w() }],
			"scroll-mr": [{ "scroll-mr": w() }],
			"scroll-mb": [{ "scroll-mb": w() }],
			"scroll-ml": [{ "scroll-ml": w() }],
			"scroll-p": [{ "scroll-p": w() }],
			"scroll-px": [{ "scroll-px": w() }],
			"scroll-py": [{ "scroll-py": w() }],
			"scroll-ps": [{ "scroll-ps": w() }],
			"scroll-pe": [{ "scroll-pe": w() }],
			"scroll-pbs": [{ "scroll-pbs": w() }],
			"scroll-pbe": [{ "scroll-pbe": w() }],
			"scroll-pt": [{ "scroll-pt": w() }],
			"scroll-pr": [{ "scroll-pr": w() }],
			"scroll-pb": [{ "scroll-pb": w() }],
			"scroll-pl": [{ "scroll-pl": w() }],
			"snap-align": [{ snap: [
				"start",
				"end",
				"center",
				"align-none"
			] }],
			"snap-stop": [{ snap: ["normal", "always"] }],
			"snap-type": [{ snap: [
				"none",
				"x",
				"y",
				"both"
			] }],
			"snap-strictness": [{ snap: ["mandatory", "proximity"] }],
			touch: [{ touch: [
				"auto",
				"none",
				"manipulation"
			] }],
			"touch-x": [{ "touch-pan": [
				"x",
				"left",
				"right"
			] }],
			"touch-y": [{ "touch-pan": [
				"y",
				"up",
				"down"
			] }],
			"touch-pz": ["touch-pinch-zoom"],
			select: [{ select: [
				"none",
				"text",
				"all",
				"auto"
			] }],
			"will-change": [{ "will-change": [
				"auto",
				"scroll",
				"contents",
				"transform",
				P,
				N
			] }],
			fill: [{ fill: ["none", ...j()] }],
			"stroke-w": [{ stroke: [
				M,
				Ot,
				xt,
				St
			] }],
			stroke: [{ stroke: ["none", ...j()] }],
			"forced-color-adjust": [{ "forced-color-adjust": ["auto", "none"] }]
		},
		conflictingClassGroups: {
			"container-named": ["container-type"],
			overflow: ["overflow-x", "overflow-y"],
			overscroll: ["overscroll-x", "overscroll-y"],
			inset: [
				"inset-x",
				"inset-y",
				"inset-bs",
				"inset-be",
				"start",
				"end",
				"top",
				"right",
				"bottom",
				"left"
			],
			"inset-x": ["right", "left"],
			"inset-y": ["top", "bottom"],
			flex: [
				"basis",
				"grow",
				"shrink"
			],
			gap: ["gap-x", "gap-y"],
			p: [
				"px",
				"py",
				"ps",
				"pe",
				"pbs",
				"pbe",
				"pt",
				"pr",
				"pb",
				"pl"
			],
			px: ["pr", "pl"],
			py: ["pt", "pb"],
			m: [
				"mx",
				"my",
				"ms",
				"me",
				"mbs",
				"mbe",
				"mt",
				"mr",
				"mb",
				"ml"
			],
			mx: ["mr", "ml"],
			my: ["mt", "mb"],
			size: ["w", "h"],
			"font-size": ["leading"],
			"fvn-normal": [
				"fvn-ordinal",
				"fvn-slashed-zero",
				"fvn-figure",
				"fvn-spacing",
				"fvn-fraction"
			],
			"fvn-ordinal": ["fvn-normal"],
			"fvn-slashed-zero": ["fvn-normal"],
			"fvn-figure": ["fvn-normal"],
			"fvn-spacing": ["fvn-normal"],
			"fvn-fraction": ["fvn-normal"],
			"line-clamp": ["display", "overflow"],
			rounded: [
				"rounded-s",
				"rounded-e",
				"rounded-t",
				"rounded-r",
				"rounded-b",
				"rounded-l",
				"rounded-ss",
				"rounded-se",
				"rounded-ee",
				"rounded-es",
				"rounded-tl",
				"rounded-tr",
				"rounded-br",
				"rounded-bl"
			],
			"rounded-s": ["rounded-ss", "rounded-es"],
			"rounded-e": ["rounded-se", "rounded-ee"],
			"rounded-t": ["rounded-tl", "rounded-tr"],
			"rounded-r": ["rounded-tr", "rounded-br"],
			"rounded-b": ["rounded-br", "rounded-bl"],
			"rounded-l": ["rounded-tl", "rounded-bl"],
			"border-spacing": ["border-spacing-x", "border-spacing-y"],
			"border-w": [
				"border-w-x",
				"border-w-y",
				"border-w-s",
				"border-w-e",
				"border-w-bs",
				"border-w-be",
				"border-w-t",
				"border-w-r",
				"border-w-b",
				"border-w-l"
			],
			"border-w-x": ["border-w-r", "border-w-l"],
			"border-w-y": ["border-w-t", "border-w-b"],
			"border-color": [
				"border-color-x",
				"border-color-y",
				"border-color-s",
				"border-color-e",
				"border-color-bs",
				"border-color-be",
				"border-color-t",
				"border-color-r",
				"border-color-b",
				"border-color-l"
			],
			"border-color-x": ["border-color-r", "border-color-l"],
			"border-color-y": ["border-color-t", "border-color-b"],
			translate: [
				"translate-x",
				"translate-y",
				"translate-none"
			],
			"translate-none": [
				"translate",
				"translate-x",
				"translate-y",
				"translate-z"
			],
			"scroll-m": [
				"scroll-mx",
				"scroll-my",
				"scroll-ms",
				"scroll-me",
				"scroll-mbs",
				"scroll-mbe",
				"scroll-mt",
				"scroll-mr",
				"scroll-mb",
				"scroll-ml"
			],
			"scroll-mx": ["scroll-mr", "scroll-ml"],
			"scroll-my": ["scroll-mt", "scroll-mb"],
			"scroll-p": [
				"scroll-px",
				"scroll-py",
				"scroll-ps",
				"scroll-pe",
				"scroll-pbs",
				"scroll-pbe",
				"scroll-pt",
				"scroll-pr",
				"scroll-pb",
				"scroll-pl"
			],
			"scroll-px": ["scroll-pr", "scroll-pl"],
			"scroll-py": ["scroll-pt", "scroll-pb"],
			touch: [
				"touch-x",
				"touch-y",
				"touch-pz"
			],
			"touch-x": ["touch"],
			"touch-y": ["touch"],
			"touch-pz": ["touch"]
		},
		conflictingClassGroupModifiers: { "font-size": ["leading"] },
		postfixLookupClassGroups: ["container-type"],
		orderSensitiveModifiers: [
			"*",
			"**",
			"after",
			"backdrop",
			"before",
			"details-content",
			"file",
			"first-letter",
			"first-line",
			"marker",
			"placeholder",
			"selection"
		]
	};
}, Kt = (e, { cacheSize: t, prefix: n, experimentalParseClassName: r, extend: i = {}, override: a = {} }) => (qt(e, "cacheSize", t), qt(e, "prefix", n), qt(e, "experimentalParseClassName", r), Jt(e.theme, a.theme), Jt(e.classGroups, a.classGroups), Jt(e.conflictingClassGroups, a.conflictingClassGroups), Jt(e.conflictingClassGroupModifiers, a.conflictingClassGroupModifiers), qt(e, "postfixLookupClassGroups", a.postfixLookupClassGroups), qt(e, "orderSensitiveModifiers", a.orderSensitiveModifiers), Yt(e.theme, i.theme), Yt(e.classGroups, i.classGroups), Yt(e.conflictingClassGroups, i.conflictingClassGroups), Yt(e.conflictingClassGroupModifiers, i.conflictingClassGroupModifiers), Xt(e, i, "postfixLookupClassGroups"), Xt(e, i, "orderSensitiveModifiers"), e), qt = (e, t, n) => {
	n !== void 0 && (e[t] = n);
}, Jt = (e, t) => {
	if (t) for (let n in t) qt(e, n, t[n]);
}, Yt = (e, t) => {
	if (t) for (let n in t) Xt(e, t, n);
}, Xt = (e, t, n) => {
	let r = t[n];
	r !== void 0 && (e[n] = e[n] ? e[n].concat(r) : r);
}, Zt = ((e, ...t) => typeof e == "function" ? Qe(Gt, e, ...t) : Qe(() => Kt(Gt(), e), ...t))({ extend: {
	theme: { radius: ["interaction"] },
	classGroups: { "font-size": [{ text: [
		"big",
		"medium",
		"small",
		"micro"
	] }] }
} });
function F(...e) {
	return Zt(be(e));
}
// node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
var Qt = (e) => e?.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
// node_modules/lucide-react/dist/esm/shared/src/utils/toLucideIconData.mjs
function $t(e, t, n = []) {
	if (t == null) throw Error("[lucide]: iconNode is required when icon name is used");
	return {
		name: Qt(e),
		size: 24,
		node: t,
		...n.length > 0 ? { aliases: n } : {}
	};
}
// node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
var en = (e) => {
	let t = "", n = !1;
	for (let r of e) r === "-" || r === "_" || r <= " " ? n = t.length > 0 : (t.length === 0 ? t += r.toLowerCase() : t += n ? r.toUpperCase() : r, n = !1);
	return t;
}, tn = (e) => {
	let t = en(e);
	return t.charAt(0).toUpperCase() + t.slice(1);
}, nn = (...e) => e.filter((e, t, n) => !!e && e.trim() !== "" && n.indexOf(e) === t).join(" ").trim(), rn = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	"stroke-width": 2,
	"stroke-linecap": "round",
	"stroke-linejoin": "round"
};
// node_modules/lucide-react/dist/esm/shared/src/build/buildLucideIconNode.mjs
function an(e) {
	return e != null;
}
function on(e, t = {}) {
	let n = t.attributeNames ?? {}, r = (e) => n[e] ?? e, i = e.size ?? e.width ?? rn.width, a = e.size ?? e.height ?? rn.height, o = e.aliases?.filter((e) => typeof e == "string" && e.trim() !== "").map((e) => `lucide-${e}`) ?? [], s = [...e.name ? [`lucide-${e.name}`] : [], ...o], c = t.className?.split(" ").filter(Boolean) ?? [], l = t.includeDefaultClasses === !1 ? nn(...c) : nn("lucide", ...s, ...c), u = t.absoluteStrokeWidth ? Number(t.strokeWidth ?? rn["stroke-width"]) * Number(e.size ?? e.width ?? rn.width) / Number(t.size ?? t.width ?? rn.width) : t.strokeWidth ?? rn["stroke-width"];
	return [
		"svg",
		{
			...Object.entries(rn).reduce((e, [t, n]) => (e[r(t)] = n, e), {}),
			..."color" in t && t.color && { [r("stroke")]: t.color },
			..."size" in t && an(t.size) && {
				[r("width")]: t.size,
				[r("height")]: t.size
			},
			..."width" in t && an(t.width) && { [r("width")]: t.width },
			..."height" in t && an(t.height) && { [r("height")]: t.height },
			[r("stroke-width")]: u,
			...l && { [r("class")]: l },
			[r("viewBox")]: `0 0 ${i} ${a}`,
			...t.hasA11yProp === !1 ? { [r("aria-hidden")]: "true" } : {},
			..."attributes" in t && t.attributes
		},
		e.node.map((e) => {
			let [n, i, a] = e, o = t.nonScalingStroke ? {
				[r("vector-effect")]: "non-scaling-stroke",
				...i
			} : i;
			return a ? [
				n,
				o,
				a
			] : [n, o];
		})
	];
}
// node_modules/lucide-react/dist/esm/shared/src/build/buildLucideIconForReact.mjs
function sn(e, t = {}) {
	return on(e, {
		...t,
		attributeNames: {
			...t.attributeNames,
			class: "className",
			"stroke-width": "strokeWidth",
			"stroke-linecap": "strokeLinecap",
			"stroke-linejoin": "strokeLinejoin",
			"vector-effect": "vectorEffect"
		}
	});
}
// node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs
var cn = (e) => {
	for (let t in e) if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
	return !1;
}, ln = p({}), un = () => _(ln), dn = h(({ color: e, size: t, width: n, height: r, strokeWidth: i, absoluteStrokeWidth: a, nonScalingStroke: o, className: s = "", children: c, iconNode: l = [], icon: u = {
	node: l,
	aliases: [],
	size: 24
}, ...d }, f) => {
	let { size: p = 24, strokeWidth: h = 2, absoluteStrokeWidth: g = !1, nonScalingStroke: _ = !1, color: v = "currentColor", className: y = "" } = un() ?? {}, b = !!c || cn(d), [x, S, C = []] = sn(u, {
		color: e ?? v,
		width: n ?? t ?? p,
		height: r ?? t ?? p,
		strokeWidth: i ?? h,
		absoluteStrokeWidth: a ?? g,
		nonScalingStroke: o ?? _,
		className: nn(y, s),
		hasA11yProp: b,
		attributes: d
	});
	return m(x, {
		ref: f,
		...S
	}, [...C.map(([e, t]) => m(e, t)), ...Array.isArray(c) ? c : [c]]);
});
// node_modules/lucide-react/dist/esm/createLucideIcon.mjs
function I(e, t = [], n = []) {
	let r = typeof e == "string" ? $t(e, t, n) : e, i = h(({ className: e, ...t }, n) => m(dn, {
		ref: n,
		icon: r,
		className: e,
		...t
	}));
	return r.name && (i.displayName = tn(r.name)), i;
}
// node_modules/lucide-react/dist/esm/icons/activity.mjs
var fn = {
	name: "activity",
	size: 24,
	node: [["path", {
		d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
		key: "169zse"
	}]]
};
fn.node;
var pn = I(fn), mn = {
	name: "app-window",
	size: 24,
	node: [
		["rect", {
			x: "2",
			y: "4",
			width: "20",
			height: "16",
			rx: "2",
			key: "izxlao"
		}],
		["path", {
			d: "M10 4v4",
			key: "pp8u80"
		}],
		["path", {
			d: "M2 8h20",
			key: "d11cs7"
		}],
		["path", {
			d: "M6 4v4",
			key: "1svtjw"
		}]
	]
};
mn.node;
var hn = I(mn), gn = {
	name: "archive",
	size: 24,
	node: [
		["rect", {
			width: "20",
			height: "5",
			x: "2",
			y: "3",
			rx: "1",
			key: "1wp1u1"
		}],
		["path", {
			d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",
			key: "1s80jp"
		}],
		["path", {
			d: "M10 12h4",
			key: "a56b0p"
		}]
	]
};
gn.node;
var _n = I(gn), vn = {
	name: "arrow-down-up",
	size: 24,
	node: [
		["path", {
			d: "m3 16 4 4 4-4",
			key: "1co6wj"
		}],
		["path", {
			d: "M7 20V4",
			key: "1yoxec"
		}],
		["path", {
			d: "m21 8-4-4-4 4",
			key: "1c9v7m"
		}],
		["path", {
			d: "M17 4v16",
			key: "7dpous"
		}]
	]
};
vn.node;
var yn = I(vn), bn = {
	name: "arrow-down",
	size: 24,
	node: [["path", {
		d: "M12 5v14",
		key: "s699le"
	}], ["path", {
		d: "m19 12-7 7-7-7",
		key: "1idqje"
	}]]
};
bn.node;
var xn = I(bn), Sn = {
	name: "arrow-left-right",
	size: 24,
	node: [
		["path", {
			d: "M8 3 4 7l4 4",
			key: "9rb6wj"
		}],
		["path", {
			d: "M4 7h16",
			key: "6tx8e3"
		}],
		["path", {
			d: "m16 21 4-4-4-4",
			key: "siv7j2"
		}],
		["path", {
			d: "M20 17H4",
			key: "h6l3hr"
		}]
	]
};
Sn.node;
var Cn = I(Sn), wn = {
	name: "arrow-left",
	size: 24,
	node: [["path", {
		d: "m12 19-7-7 7-7",
		key: "1l729n"
	}], ["path", {
		d: "M19 12H5",
		key: "x3x0zl"
	}]]
};
wn.node;
var Tn = I(wn), En = {
	name: "arrow-right",
	size: 24,
	node: [["path", {
		d: "M5 12h14",
		key: "1ays0h"
	}], ["path", {
		d: "m12 5 7 7-7 7",
		key: "xquz4c"
	}]]
};
En.node;
var Dn = I(En), On = {
	name: "arrow-up-right",
	size: 24,
	node: [["path", {
		d: "M7 7h10v10",
		key: "1tivn9"
	}], ["path", {
		d: "M7 17 17 7",
		key: "1vkiza"
	}]]
};
On.node;
var kn = I(On), An = {
	name: "arrow-up-to-line",
	size: 24,
	node: [
		["path", {
			d: "M5 3h14",
			key: "7usisc"
		}],
		["path", {
			d: "m18 13-6-6-6 6",
			key: "1kf1n9"
		}],
		["path", {
			d: "M12 7v14",
			key: "1akyts"
		}]
	]
};
An.node;
var jn = I(An), Mn = {
	name: "arrow-up",
	size: 24,
	node: [["path", {
		d: "m5 12 7-7 7 7",
		key: "hav0vg"
	}], ["path", {
		d: "M12 19V5",
		key: "x0mq9r"
	}]]
};
Mn.node;
var Nn = I(Mn), Pn = {
	name: "book-open",
	size: 24,
	node: [["path", {
		d: "M12 5v16",
		key: "1f6ucr"
	}], ["path", {
		d: "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z",
		key: "1fyvmf"
	}]]
};
Pn.node;
var Fn = I(Pn), In = {
	name: "book",
	size: 24,
	node: [["path", {
		d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",
		key: "k3hazp"
	}]]
};
In.node;
var Ln = I(In), Rn = {
	name: "bot",
	size: 24,
	node: [
		["path", {
			d: "M12 8V4H8",
			key: "hb8ula"
		}],
		["rect", {
			width: "16",
			height: "12",
			x: "4",
			y: "8",
			rx: "2",
			key: "enze0r"
		}],
		["path", {
			d: "M2 14h2",
			key: "vft8re"
		}],
		["path", {
			d: "M20 14h2",
			key: "4cs60a"
		}],
		["path", {
			d: "M15 13v2",
			key: "1xurst"
		}],
		["path", {
			d: "M9 13v2",
			key: "rq6x2g"
		}]
	]
};
Rn.node;
var zn = I(Rn), Bn = {
	name: "brain",
	size: 24,
	node: [
		["path", {
			d: "M12 18V5",
			key: "adv99a"
		}],
		["path", {
			d: "M15 13a4.17 4.17 0 01-3-4 4.17 4.17 0 01-3 4",
			key: "5nuw1p"
		}],
		["path", {
			d: "M17.707 6.294A3 3 0 1012 5a3 3 0 10-5.707 1.294",
			key: "18ldcf"
		}],
		["path", {
			d: "M17.996 5.125a4 4 0 012.526 5.77",
			key: "1sdu8q"
		}],
		["path", {
			d: "M18 18a4 4 0 002-7.465",
			key: "7xqqvr"
		}],
		["path", {
			d: "M19.967 17.482a4 4 0 11-7.967.517 4 4 0 11-7.967-.517",
			key: "t46ysz"
		}],
		["path", {
			d: "M6 18a4 4 0 01-2-7.465",
			key: "1y2m15"
		}],
		["path", {
			d: "M6.004 5.125a4 4 0 00-2.526 5.77",
			key: "3cw1ss"
		}]
	]
};
Bn.node;
var Vn = I(Bn), Hn = {
	name: "calendar",
	size: 24,
	node: [
		["path", {
			d: "M8 2v3",
			key: "1ioesn"
		}],
		["path", {
			d: "M16 2v3",
			key: "otl347"
		}],
		["rect", {
			x: "3",
			y: "3",
			width: "18",
			height: "18",
			rx: "2",
			key: "h1oib"
		}],
		["path", {
			d: "M3 9h18",
			key: "1pudct"
		}]
	]
};
Hn.node;
var Un = I(Hn), Wn = {
	name: "chart-line",
	size: 24,
	node: [["path", {
		d: "M3 3v16a2 2 0 0 0 2 2h16",
		key: "c24i48"
	}], ["path", {
		d: "m19 9-5 5-4-4-3 3",
		key: "2osh9i"
	}]],
	aliases: ["line-chart"]
};
Wn.node;
var Gn = I(Wn), Kn = {
	name: "check",
	size: 24,
	node: [["path", {
		d: "M20 6 9 17l-5-5",
		key: "1gmf2c"
	}]]
};
Kn.node;
var qn = I(Kn), Jn = {
	name: "chevron-down",
	size: 24,
	node: [["path", {
		d: "m6 9 6 6 6-6",
		key: "qrunsl"
	}]]
};
Jn.node;
var Yn = I(Jn), Xn = {
	name: "chevron-left",
	size: 24,
	node: [["path", {
		d: "m15 18-6-6 6-6",
		key: "1wnfg3"
	}]]
};
Xn.node;
var Zn = I(Xn), Qn = {
	name: "chevron-right",
	size: 24,
	node: [["path", {
		d: "m9 18 6-6-6-6",
		key: "mthhwq"
	}]]
};
Qn.node;
var $n = I(Qn), er = {
	name: "chevron-up",
	size: 24,
	node: [["path", {
		d: "m18 15-6-6-6 6",
		key: "153udz"
	}]]
};
er.node;
var tr = I(er), nr = {
	name: "circle-alert",
	size: 24,
	node: [
		["circle", {
			cx: "12",
			cy: "12",
			r: "10",
			key: "1mglay"
		}],
		["line", {
			x1: "12",
			x2: "12",
			y1: "8",
			y2: "12",
			key: "1pkeuh"
		}],
		["line", {
			x1: "12",
			x2: "12.01",
			y1: "16",
			y2: "16",
			key: "4dfq90"
		}]
	],
	aliases: ["alert-circle"]
};
nr.node;
var rr = I(nr), ir = {
	name: "circle-check",
	size: 24,
	node: [["circle", {
		cx: "12",
		cy: "12",
		r: "10",
		key: "1mglay"
	}], ["path", {
		d: "m16 9-5.5 5.5L8 12",
		key: "xofnsj"
	}]],
	aliases: ["check-circle-2"]
};
ir.node;
var ar = I(ir), or = {
	name: "circle-play",
	size: 24,
	node: [["path", {
		d: "M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z",
		key: "kmsa83"
	}], ["circle", {
		cx: "12",
		cy: "12",
		r: "10",
		key: "1mglay"
	}]],
	aliases: ["play-circle"]
};
or.node;
var sr = I(or), cr = {
	name: "circle-plus",
	size: 24,
	node: [
		["circle", {
			cx: "12",
			cy: "12",
			r: "10",
			key: "1mglay"
		}],
		["path", {
			d: "M8 12h8",
			key: "1wcyev"
		}],
		["path", {
			d: "M12 8v8",
			key: "napkw2"
		}]
	],
	aliases: ["plus-circle"]
};
cr.node;
var lr = I(cr), ur = {
	name: "clock",
	size: 24,
	node: [["circle", {
		cx: "12",
		cy: "12",
		r: "10",
		key: "1mglay"
	}], ["path", {
		d: "M12 6v6l4 2",
		key: "mmk7yg"
	}]]
};
ur.node;
var dr = I(ur), fr = {
	name: "cloud",
	size: 24,
	node: [["path", {
		d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",
		key: "p7xjir"
	}]]
};
fr.node;
var pr = I(fr), mr = {
	name: "coins",
	size: 24,
	node: [
		["path", {
			d: "M13.744 17.736a6 6 0 1 1-7.48-7.48",
			key: "bq4yh3"
		}],
		["path", {
			d: "M15 6h1v4",
			key: "11y1tn"
		}],
		["path", {
			d: "m6.134 14.768.866-.5 2 3.464",
			key: "17snzx"
		}],
		["circle", {
			cx: "16",
			cy: "8",
			r: "6",
			key: "14bfc9"
		}]
	]
};
mr.node;
var hr = I(mr), gr = {
	name: "combine",
	size: 24,
	node: [
		["path", {
			d: "M14 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1",
			key: "1l7d7l"
		}],
		["path", {
			d: "M19 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1",
			key: "9955pe"
		}],
		["path", {
			d: "m7 15 3 3",
			key: "4hkfgk"
		}],
		["path", {
			d: "m7 21 3-3H5a2 2 0 0 1-2-2v-2",
			key: "1xljwe"
		}],
		["rect", {
			x: "14",
			y: "14",
			width: "7",
			height: "7",
			rx: "1",
			key: "1cdgtw"
		}],
		["rect", {
			x: "3",
			y: "3",
			width: "7",
			height: "7",
			rx: "1",
			key: "zi3rio"
		}]
	]
};
gr.node;
var _r = I(gr), vr = {
	name: "contact-round",
	size: 24,
	node: [
		["path", {
			d: "M16 2v2",
			key: "scm5qe"
		}],
		["path", {
			d: "M17.915 21a6 6 0 10-12 0",
			key: "13n4mv"
		}],
		["path", {
			d: "M8 2v2",
			key: "pbkmx"
		}],
		["circle", {
			cx: "12",
			cy: "11",
			r: "4",
			key: "1gt34v"
		}],
		["rect", {
			x: "3",
			y: "3",
			width: "18",
			height: "18",
			rx: "2",
			key: "h1oib"
		}]
	],
	aliases: ["contact-2"]
};
vr.node;
var yr = I(vr), br = {
	name: "copy",
	size: 24,
	node: [["rect", {
		width: "14",
		height: "14",
		x: "8",
		y: "8",
		rx: "2",
		ry: "2",
		key: "17jyea"
	}], ["path", {
		d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
		key: "zix9uf"
	}]]
};
br.node;
var xr = I(br), Sr = {
	name: "credit-card",
	size: 24,
	node: [
		["rect", {
			width: "20",
			height: "14",
			x: "2",
			y: "5",
			rx: "2",
			key: "ynyp8z"
		}],
		["line", {
			x1: "2",
			x2: "22",
			y1: "10",
			y2: "10",
			key: "1b3vmo"
		}],
		["path", {
			d: "M6 14h2",
			key: "mk7k0u"
		}]
	]
};
Sr.node;
var Cr = I(Sr), wr = {
	name: "dollar-sign",
	size: 24,
	node: [["line", {
		x1: "12",
		x2: "12",
		y1: "2",
		y2: "22",
		key: "7eqyqh"
	}], ["path", {
		d: "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
		key: "1b0p4s"
	}]]
};
wr.node;
var Tr = I(wr), Er = {
	name: "download",
	size: 24,
	node: [
		["path", {
			d: "M12 15V3",
			key: "m9g1x1"
		}],
		["path", {
			d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
			key: "ih7n3h"
		}],
		["path", {
			d: "m7 10 5 5 5-5",
			key: "brsn70"
		}]
	]
};
Er.node;
var Dr = I(Er), Or = {
	name: "ellipsis-vertical",
	size: 24,
	node: [
		["circle", {
			cx: "12",
			cy: "12",
			r: "1",
			key: "41hilf"
		}],
		["circle", {
			cx: "12",
			cy: "5",
			r: "1",
			key: "gxeob9"
		}],
		["circle", {
			cx: "12",
			cy: "19",
			r: "1",
			key: "lyex9k"
		}]
	],
	aliases: ["more-vertical"]
};
Or.node;
var kr = I(Or), Ar = {
	name: "ellipsis",
	size: 24,
	node: [
		["circle", {
			cx: "12",
			cy: "12",
			r: "1",
			key: "41hilf"
		}],
		["circle", {
			cx: "19",
			cy: "12",
			r: "1",
			key: "1wjl8i"
		}],
		["circle", {
			cx: "5",
			cy: "12",
			r: "1",
			key: "1pcz8c"
		}]
	],
	aliases: ["more-horizontal"]
};
Ar.node;
var jr = I(Ar), Mr = {
	name: "eye-off",
	size: 24,
	node: [
		["path", {
			d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
			key: "ct8e1f"
		}],
		["path", {
			d: "M14.084 14.158a3 3 0 0 1-4.242-4.242",
			key: "151rxh"
		}],
		["path", {
			d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
			key: "13bj9a"
		}],
		["path", {
			d: "m2 2 20 20",
			key: "1ooewy"
		}]
	]
};
Mr.node;
var Nr = I(Mr), Pr = {
	name: "eye",
	size: 24,
	node: [["path", {
		d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
		key: "1nclc0"
	}], ["circle", {
		cx: "12",
		cy: "12",
		r: "3",
		key: "1v7zrd"
	}]]
};
Pr.node;
var Fr = I(Pr), Ir = {
	name: "file-plus",
	size: 24,
	node: [
		["path", {
			d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
			key: "1oefj6"
		}],
		["path", {
			d: "M14 2v5a1 1 0 0 0 1 1h5",
			key: "wfsgrz"
		}],
		["path", {
			d: "M9 15h6",
			key: "cctwl0"
		}],
		["path", {
			d: "M12 18v-6",
			key: "17g6i2"
		}]
	]
};
Ir.node;
var Lr = I(Ir), Rr = {
	name: "file-search",
	size: 24,
	node: [
		["path", {
			d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
			key: "1oefj6"
		}],
		["path", {
			d: "M14 2v5a1 1 0 0 0 1 1h5",
			key: "wfsgrz"
		}],
		["circle", {
			cx: "11.5",
			cy: "14.5",
			r: "2.5",
			key: "1bq0ko"
		}],
		["path", {
			d: "M13.3 16.3 15 18",
			key: "2quom7"
		}]
	]
};
Rr.node;
var zr = I(Rr), Br = {
	name: "file-text",
	size: 24,
	node: [
		["path", {
			d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
			key: "1oefj6"
		}],
		["path", {
			d: "M14 2v5a1 1 0 0 0 1 1h5",
			key: "wfsgrz"
		}],
		["path", {
			d: "M10 9H8",
			key: "b1mrlr"
		}],
		["path", {
			d: "M16 13H8",
			key: "t4e002"
		}],
		["path", {
			d: "M16 17H8",
			key: "z1uh3a"
		}]
	]
};
Br.node;
var Vr = I(Br), Hr = {
	name: "file-up",
	size: 24,
	node: [
		["path", {
			d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
			key: "1oefj6"
		}],
		["path", {
			d: "M14 2v5a1 1 0 0 0 1 1h5",
			key: "wfsgrz"
		}],
		["path", {
			d: "M12 12v6",
			key: "3ahymv"
		}],
		["path", {
			d: "m15 15-3-3-3 3",
			key: "15xj92"
		}]
	]
};
Hr.node;
var Ur = I(Hr), Wr = {
	name: "flag",
	size: 24,
	node: [["path", {
		d: "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528",
		key: "1jaruq"
	}]]
};
Wr.node;
var Gr = I(Wr), Kr = {
	name: "folder-open",
	size: 24,
	node: [["path", {
		d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
		key: "usdka0"
	}]]
};
Kr.node;
var qr = I(Kr), Jr = {
	name: "folder-search",
	size: 24,
	node: [
		["path", {
			d: "M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",
			key: "1bw5m7"
		}],
		["path", {
			d: "m21 21-1.9-1.9",
			key: "1g2n9r"
		}],
		["circle", {
			cx: "17",
			cy: "17",
			r: "3",
			key: "18b49y"
		}]
	]
};
Jr.node;
var Yr = I(Jr), Xr = {
	name: "folder",
	size: 24,
	node: [["path", {
		d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
		key: "1kt360"
	}]]
};
Xr.node;
var Zr = I(Xr), Qr = {
	name: "folders",
	size: 24,
	node: [["path", {
		d: "M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z",
		key: "a4852j"
	}], ["path", {
		d: "M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1",
		key: "yxbcw3"
	}]]
};
Qr.node;
var $r = I(Qr), ei = {
	name: "funnel",
	size: 24,
	node: [["path", {
		d: "M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z",
		key: "sc7q7i"
	}]],
	aliases: ["filter"]
};
ei.node;
var ti = I(ei), ni = {
	name: "git-branch",
	size: 24,
	node: [
		["path", {
			d: "M15 6a9 9 0 0 0-9 9V3",
			key: "1cii5b"
		}],
		["circle", {
			cx: "18",
			cy: "6",
			r: "3",
			key: "1h7g24"
		}],
		["circle", {
			cx: "6",
			cy: "18",
			r: "3",
			key: "fqmcym"
		}]
	]
};
ni.node;
var ri = I(ni), ii = {
	name: "globe",
	size: 24,
	node: [
		["circle", {
			cx: "12",
			cy: "12",
			r: "10",
			key: "1mglay"
		}],
		["path", {
			d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",
			key: "13o1zl"
		}],
		["path", {
			d: "M2 12h20",
			key: "9i4pu4"
		}]
	]
};
ii.node;
var ai = I(ii), oi = {
	name: "goal",
	size: 24,
	node: [
		["path", {
			d: "M12 13V2l8 4-8 4",
			key: "5wlwwj"
		}],
		["path", {
			d: "M20.561 10.222a9 9 0 1 1-12.55-5.29",
			key: "1c0wjv"
		}],
		["path", {
			d: "M8.002 9.997a5 5 0 1 0 8.9 2.02",
			key: "gb1g7m"
		}]
	]
};
oi.node;
var si = I(oi), ci = {
	name: "grip-vertical",
	size: 24,
	node: [
		["circle", {
			cx: "9",
			cy: "12",
			r: "1",
			key: "1vctgf"
		}],
		["circle", {
			cx: "9",
			cy: "5",
			r: "1",
			key: "hp0tcf"
		}],
		["circle", {
			cx: "9",
			cy: "19",
			r: "1",
			key: "fkjjf6"
		}],
		["circle", {
			cx: "15",
			cy: "12",
			r: "1",
			key: "1tmaij"
		}],
		["circle", {
			cx: "15",
			cy: "5",
			r: "1",
			key: "19l28e"
		}],
		["circle", {
			cx: "15",
			cy: "19",
			r: "1",
			key: "f4zoj3"
		}]
	]
};
ci.node;
var li = I(ci), ui = {
	name: "group",
	size: 24,
	node: [
		["path", {
			d: "M3 7V5c0-1.1.9-2 2-2h2",
			key: "adw53z"
		}],
		["path", {
			d: "M17 3h2c1.1 0 2 .9 2 2v2",
			key: "an4l38"
		}],
		["path", {
			d: "M21 17v2c0 1.1-.9 2-2 2h-2",
			key: "144t0e"
		}],
		["path", {
			d: "M7 21H5c-1.1 0-2-.9-2-2v-2",
			key: "rtnfgi"
		}],
		["rect", {
			width: "7",
			height: "5",
			x: "7",
			y: "7",
			rx: "1",
			key: "1eyiv7"
		}],
		["rect", {
			width: "7",
			height: "5",
			x: "10",
			y: "12",
			rx: "1",
			key: "1qlmkx"
		}]
	]
};
ui.node;
var di = I(ui), fi = {
	name: "hand",
	size: 24,
	node: [
		["path", {
			d: "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2",
			key: "1fvzgz"
		}],
		["path", {
			d: "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2",
			key: "1kc0my"
		}],
		["path", {
			d: "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8",
			key: "10h0bg"
		}],
		["path", {
			d: "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
			key: "1s1gnw"
		}]
	]
};
fi.node;
var pi = I(fi), mi = {
	name: "hash",
	size: 24,
	node: [
		["line", {
			x1: "4",
			x2: "20",
			y1: "9",
			y2: "9",
			key: "4lhtct"
		}],
		["line", {
			x1: "4",
			x2: "20",
			y1: "15",
			y2: "15",
			key: "vyu0kd"
		}],
		["line", {
			x1: "10",
			x2: "8",
			y1: "3",
			y2: "21",
			key: "1ggp8o"
		}],
		["line", {
			x1: "16",
			x2: "14",
			y1: "3",
			y2: "21",
			key: "weycgp"
		}]
	]
};
mi.node;
var hi = I(mi), gi = {
	name: "headphones",
	size: 24,
	node: [["path", {
		d: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
		key: "1xhozi"
	}]]
};
gi.node;
var _i = I(gi), vi = {
	name: "house",
	size: 24,
	node: [["path", {
		d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
		key: "5wwlr5"
	}], ["path", {
		d: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
		key: "r6nss1"
	}]],
	aliases: ["home"]
};
vi.node;
var yi = I(vi), bi = {
	name: "image",
	size: 24,
	node: [
		["rect", {
			width: "18",
			height: "18",
			x: "3",
			y: "3",
			rx: "2",
			ry: "2",
			key: "1m3agn"
		}],
		["circle", {
			cx: "9",
			cy: "9",
			r: "2",
			key: "af1f0g"
		}],
		["path", {
			d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
			key: "1xmnt7"
		}]
	]
};
bi.node;
var xi = I(bi), Si = {
	name: "info",
	size: 24,
	node: [
		["circle", {
			cx: "12",
			cy: "12",
			r: "10",
			key: "1mglay"
		}],
		["path", {
			d: "M12 16v-4",
			key: "1dtifu"
		}],
		["path", {
			d: "M12 8h.01",
			key: "e9boi3"
		}]
	]
};
Si.node;
var Ci = I(Si), wi = {
	name: "key-round",
	size: 24,
	node: [["path", {
		d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
		key: "1s6t7t"
	}], ["circle", {
		cx: "16.5",
		cy: "7.5",
		r: ".5",
		fill: "currentColor",
		key: "w0ekpg"
	}]]
};
wi.node;
var Ti = I(wi), Ei = {
	name: "layers",
	size: 24,
	node: [
		["path", {
			d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
			key: "zw3jo"
		}],
		["path", {
			d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
			key: "1wduqc"
		}],
		["path", {
			d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
			key: "kqbvx6"
		}]
	],
	aliases: ["layers-3"]
};
Ei.node;
var Di = I(Ei), Oi = {
	name: "layout-grid",
	size: 24,
	node: [
		["rect", {
			width: "7",
			height: "7",
			x: "3",
			y: "3",
			rx: "1",
			key: "1g98yp"
		}],
		["rect", {
			width: "7",
			height: "7",
			x: "14",
			y: "3",
			rx: "1",
			key: "6d4xhi"
		}],
		["rect", {
			width: "7",
			height: "7",
			x: "14",
			y: "14",
			rx: "1",
			key: "nxv5o0"
		}],
		["rect", {
			width: "7",
			height: "7",
			x: "3",
			y: "14",
			rx: "1",
			key: "1bb6yr"
		}]
	]
};
Oi.node;
var ki = I(Oi), Ai = {
	name: "layout-list",
	size: 24,
	node: [
		["rect", {
			width: "7",
			height: "7",
			x: "3",
			y: "3",
			rx: "1",
			key: "1g98yp"
		}],
		["rect", {
			width: "7",
			height: "7",
			x: "3",
			y: "14",
			rx: "1",
			key: "1bb6yr"
		}],
		["path", {
			d: "M14 4h7",
			key: "3xa0d5"
		}],
		["path", {
			d: "M14 9h7",
			key: "1icrd9"
		}],
		["path", {
			d: "M14 15h7",
			key: "1mj8o2"
		}],
		["path", {
			d: "M14 20h7",
			key: "11slyb"
		}]
	]
};
Ai.node;
var ji = I(Ai), Mi = {
	name: "list-checks",
	size: 24,
	node: [
		["path", {
			d: "M13 5h8",
			key: "a7qcls"
		}],
		["path", {
			d: "M13 12h8",
			key: "h98zly"
		}],
		["path", {
			d: "M13 19h8",
			key: "c3s6r1"
		}],
		["path", {
			d: "m3 17 2 2 4-4",
			key: "1jhpwq"
		}],
		["path", {
			d: "m3 7 2 2 4-4",
			key: "1obspn"
		}]
	]
};
Mi.node;
var Ni = I(Mi), Pi = {
	name: "list-indent-decrease",
	size: 24,
	node: [
		["path", {
			d: "M21 5H11",
			key: "us1j55"
		}],
		["path", {
			d: "M21 12H11",
			key: "wd7e0v"
		}],
		["path", {
			d: "M21 19H11",
			key: "saa85w"
		}],
		["path", {
			d: "m7 8-4 4 4 4",
			key: "o5hrat"
		}]
	],
	aliases: ["outdent", "indent-decrease"]
};
Pi.node;
var Fi = I(Pi), Ii = {
	name: "list-ordered",
	size: 24,
	node: [
		["path", {
			d: "M11 5h10",
			key: "1cz7ny"
		}],
		["path", {
			d: "M11 12h10",
			key: "1438ji"
		}],
		["path", {
			d: "M11 19h10",
			key: "11t30w"
		}],
		["path", {
			d: "M4 4h1v5",
			key: "10yrso"
		}],
		["path", {
			d: "M4 9h2",
			key: "r1h2o0"
		}],
		["path", {
			d: "M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02",
			key: "xtkcd5"
		}]
	]
};
Ii.node;
var Li = I(Ii), Ri = {
	name: "list",
	size: 24,
	node: [
		["path", {
			d: "M3 5h.01",
			key: "18ugdj"
		}],
		["path", {
			d: "M3 12h.01",
			key: "nlz23k"
		}],
		["path", {
			d: "M3 19h.01",
			key: "noohij"
		}],
		["path", {
			d: "M8 5h13",
			key: "1pao27"
		}],
		["path", {
			d: "M8 12h13",
			key: "1za7za"
		}],
		["path", {
			d: "M8 19h13",
			key: "m83p4d"
		}]
	]
};
Ri.node;
var zi = I(Ri), Bi = {
	name: "loader-circle",
	size: 24,
	node: [["path", {
		d: "M21 12a9 9 0 1 1-6.219-8.56",
		key: "13zald"
	}]],
	aliases: ["loader-2"]
};
Bi.node;
var Vi = I(Bi), Hi = {
	name: "lock",
	size: 24,
	node: [["rect", {
		width: "18",
		height: "11",
		x: "3",
		y: "11",
		rx: "2",
		ry: "2",
		key: "1w4ew1"
	}], ["path", {
		d: "M7 11V7a5 5 0 0 1 10 0v4",
		key: "fwvmzm"
	}]]
};
Hi.node;
var Ui = I(Hi), Wi = {
	name: "log-out",
	size: 24,
	node: [
		["path", {
			d: "m16 17 5-5-5-5",
			key: "1bji2h"
		}],
		["path", {
			d: "M21 12H9",
			key: "dn1m92"
		}],
		["path", {
			d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
			key: "1uf3rs"
		}]
	]
};
Wi.node;
var Gi = I(Wi), Ki = {
	name: "maximize",
	size: 24,
	node: [
		["path", {
			d: "M8 3H5a2 2 0 0 0-2 2v3",
			key: "1dcmit"
		}],
		["path", {
			d: "M21 8V5a2 2 0 0 0-2-2h-3",
			key: "1e4gt3"
		}],
		["path", {
			d: "M3 16v3a2 2 0 0 0 2 2h3",
			key: "wsl5sc"
		}],
		["path", {
			d: "M16 21h3a2 2 0 0 0 2-2v-3",
			key: "18trek"
		}]
	]
};
Ki.node;
var qi = I(Ki), Ji = {
	name: "menu",
	size: 24,
	node: [
		["path", {
			d: "M4 5h16",
			key: "1tepv9"
		}],
		["path", {
			d: "M4 12h16",
			key: "1lakjw"
		}],
		["path", {
			d: "M4 19h16",
			key: "1djgab"
		}]
	]
};
Ji.node;
var Yi = I(Ji), Xi = {
	name: "message-square-plus",
	size: 24,
	node: [
		["path", {
			d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
			key: "18887p"
		}],
		["path", {
			d: "M12 8v6",
			key: "1ib9pf"
		}],
		["path", {
			d: "M9 11h6",
			key: "1fldmi"
		}]
	]
};
Xi.node;
var Zi = I(Xi), Qi = {
	name: "message-square",
	size: 24,
	node: [["path", {
		d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
		key: "18887p"
	}]]
};
Qi.node;
var $i = I(Qi), ea = {
	name: "mic",
	size: 24,
	node: [
		["path", {
			d: "M12 19v3",
			key: "npa21l"
		}],
		["path", {
			d: "M19 10v2a7 7 0 0 1-14 0v-2",
			key: "1vc78b"
		}],
		["rect", {
			x: "9",
			y: "2",
			width: "6",
			height: "13",
			rx: "3",
			key: "s6n7sd"
		}]
	]
};
ea.node;
var ta = I(ea), na = {
	name: "minimize",
	size: 24,
	node: [
		["path", {
			d: "M8 3v3a2 2 0 0 1-2 2H3",
			key: "hohbtr"
		}],
		["path", {
			d: "M21 8h-3a2 2 0 0 1-2-2V3",
			key: "5jw1f3"
		}],
		["path", {
			d: "M3 16h3a2 2 0 0 1 2 2v3",
			key: "198tvr"
		}],
		["path", {
			d: "M16 21v-3a2 2 0 0 1 2-2h3",
			key: "ph8mxp"
		}]
	]
};
na.node;
var ra = I(na), ia = {
	name: "minus",
	size: 24,
	node: [["path", {
		d: "M5 12h14",
		key: "1ays0h"
	}]]
};
ia.node;
var aa = I(ia), oa = {
	name: "monitor",
	size: 24,
	node: [
		["rect", {
			width: "20",
			height: "14",
			x: "2",
			y: "3",
			rx: "2",
			key: "48i651"
		}],
		["line", {
			x1: "8",
			x2: "16",
			y1: "21",
			y2: "21",
			key: "1svkeh"
		}],
		["line", {
			x1: "12",
			x2: "12",
			y1: "17",
			y2: "21",
			key: "vw1qmm"
		}]
	]
};
oa.node;
var sa = I(oa), ca = {
	name: "moon",
	size: 24,
	node: [["path", {
		d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",
		key: "kfwtm"
	}]]
};
ca.node;
var la = I(ca), ua = {
	name: "mouse-pointer-2",
	size: 24,
	node: [["path", {
		d: "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z",
		key: "edeuup"
	}]]
};
ua.node;
var da = I(ua), fa = {
	name: "network",
	size: 24,
	node: [
		["rect", {
			x: "16",
			y: "16",
			width: "6",
			height: "6",
			rx: "1",
			key: "4q2zg0"
		}],
		["rect", {
			x: "2",
			y: "16",
			width: "6",
			height: "6",
			rx: "1",
			key: "8cvhb9"
		}],
		["rect", {
			x: "9",
			y: "2",
			width: "6",
			height: "6",
			rx: "1",
			key: "1egb70"
		}],
		["path", {
			d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3",
			key: "1jsf9p"
		}],
		["path", {
			d: "M12 12V8",
			key: "2874zd"
		}]
	]
};
fa.node;
var pa = I(fa), ma = {
	name: "panel-left",
	size: 24,
	node: [["rect", {
		width: "18",
		height: "18",
		x: "3",
		y: "3",
		rx: "2",
		key: "afitv7"
	}], ["path", {
		d: "M9 3v18",
		key: "fh3hqa"
	}]],
	aliases: ["sidebar"]
};
ma.node;
var ha = I(ma), ga = {
	name: "panel-right-close",
	size: 24,
	node: [
		["rect", {
			width: "18",
			height: "18",
			x: "3",
			y: "3",
			rx: "2",
			key: "afitv7"
		}],
		["path", {
			d: "M15 3v18",
			key: "14nvp0"
		}],
		["path", {
			d: "m8 9 3 3-3 3",
			key: "12hl5m"
		}]
	]
};
ga.node;
var _a = I(ga), va = {
	name: "panel-right-open",
	size: 24,
	node: [
		["rect", {
			width: "18",
			height: "18",
			x: "3",
			y: "3",
			rx: "2",
			key: "afitv7"
		}],
		["path", {
			d: "M15 3v18",
			key: "14nvp0"
		}],
		["path", {
			d: "m10 15-3-3 3-3",
			key: "1pgupc"
		}]
	]
};
va.node;
var ya = I(va), ba = {
	name: "paperclip",
	size: 24,
	node: [["path", {
		d: "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551",
		key: "1miecu"
	}]]
};
ba.node;
var xa = I(ba), Sa = {
	name: "pause",
	size: 24,
	node: [["rect", {
		x: "14",
		y: "3",
		width: "5",
		height: "18",
		rx: "1",
		key: "kaeet6"
	}], ["rect", {
		x: "5",
		y: "3",
		width: "5",
		height: "18",
		rx: "1",
		key: "1wsw3u"
	}]]
};
Sa.node;
var Ca = I(Sa), wa = {
	name: "pin-off",
	size: 24,
	node: [
		["path", {
			d: "M12 17v5",
			key: "bb1du9"
		}],
		["path", {
			d: "M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89",
			key: "znwnzq"
		}],
		["path", {
			d: "m2 2 20 20",
			key: "1ooewy"
		}],
		["path", {
			d: "M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",
			key: "c9qhm2"
		}]
	]
};
wa.node;
var Ta = I(wa), Ea = {
	name: "pin",
	size: 24,
	node: [["path", {
		d: "M12 17v5",
		key: "bb1du9"
	}], ["path", {
		d: "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
		key: "1nkz8b"
	}]]
};
Ea.node;
var Da = I(Ea), Oa = {
	name: "play",
	size: 24,
	node: [["path", {
		d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",
		key: "10ikf1"
	}]]
};
Oa.node;
var ka = I(Oa), Aa = {
	name: "plus",
	size: 24,
	node: [["path", {
		d: "M5 12h14",
		key: "1ays0h"
	}], ["path", {
		d: "M12 5v14",
		key: "s699le"
	}]]
};
Aa.node;
var ja = I(Aa), Ma = {
	name: "redo-2",
	size: 24,
	node: [["path", {
		d: "m15 14 5-5-5-5",
		key: "12vg1m"
	}], ["path", {
		d: "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13",
		key: "6uklza"
	}]]
};
Ma.node;
var Na = I(Ma), Pa = {
	name: "refresh-cw",
	size: 24,
	node: [
		["path", {
			d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
			key: "v9h5vc"
		}],
		["path", {
			d: "M21 3v5h-5",
			key: "1q7to0"
		}],
		["path", {
			d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
			key: "3uifl3"
		}],
		["path", {
			d: "M8 16H3v5",
			key: "1cv678"
		}]
	]
};
Pa.node;
var Fa = I(Pa), Ia = {
	name: "rotate-ccw-clock",
	size: 24,
	node: [
		["path", {
			d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
			key: "1357e3"
		}],
		["path", {
			d: "M3 3v5h5",
			key: "1xhq8a"
		}],
		["path", {
			d: "M12 7v5l4 2",
			key: "1fdv2h"
		}]
	],
	aliases: ["history"]
};
Ia.node;
var La = I(Ia), Ra = {
	name: "rotate-ccw",
	size: 24,
	node: [["path", {
		d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
		key: "1357e3"
	}], ["path", {
		d: "M3 3v5h5",
		key: "1xhq8a"
	}]]
};
Ra.node;
var za = I(Ra), Ba = {
	name: "rows-3",
	size: 24,
	node: [
		["rect", {
			width: "18",
			height: "18",
			x: "3",
			y: "3",
			rx: "2",
			key: "afitv7"
		}],
		["path", {
			d: "M21 9H3",
			key: "1338ky"
		}],
		["path", {
			d: "M21 15H3",
			key: "9uk58r"
		}]
	],
	aliases: ["panels-top-bottom"]
};
Ba.node;
var Va = I(Ba), Ha = {
	name: "scan-text",
	size: 24,
	node: [
		["path", {
			d: "M3 7V5a2 2 0 0 1 2-2h2",
			key: "aa7l1z"
		}],
		["path", {
			d: "M17 3h2a2 2 0 0 1 2 2v2",
			key: "4qcy5o"
		}],
		["path", {
			d: "M21 17v2a2 2 0 0 1-2 2h-2",
			key: "6vwrx8"
		}],
		["path", {
			d: "M7 21H5a2 2 0 0 1-2-2v-2",
			key: "ioqczr"
		}],
		["path", {
			d: "M7 8h8",
			key: "1jbsf9"
		}],
		["path", {
			d: "M7 12h10",
			key: "b7w52i"
		}],
		["path", {
			d: "M7 16h6",
			key: "1vyc9m"
		}]
	]
};
Ha.node;
var Ua = I(Ha), Wa = {
	name: "search",
	size: 24,
	node: [["path", {
		d: "m21 21-4.34-4.34",
		key: "14j7rj"
	}], ["circle", {
		cx: "11",
		cy: "11",
		r: "8",
		key: "4ej97u"
	}]]
};
Wa.node;
var Ga = I(Wa), Ka = {
	name: "send",
	size: 24,
	node: [["path", {
		d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
		key: "1ffxy3"
	}], ["path", {
		d: "m21.854 2.147-10.94 10.939",
		key: "12cjpa"
	}]]
};
Ka.node;
var qa = I(Ka), Ja = {
	name: "server",
	size: 24,
	node: [
		["rect", {
			width: "20",
			height: "8",
			x: "2",
			y: "2",
			rx: "2",
			ry: "2",
			key: "ngkwjq"
		}],
		["rect", {
			width: "20",
			height: "8",
			x: "2",
			y: "14",
			rx: "2",
			ry: "2",
			key: "iecqi9"
		}],
		["line", {
			x1: "6",
			x2: "6.01",
			y1: "6",
			y2: "6",
			key: "16zg32"
		}],
		["line", {
			x1: "6",
			x2: "6.01",
			y1: "18",
			y2: "18",
			key: "nzw8ys"
		}]
	]
};
Ja.node;
var Ya = I(Ja), Xa = {
	name: "settings",
	size: 24,
	node: [["path", {
		d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
		key: "1i5ecw"
	}], ["circle", {
		cx: "12",
		cy: "12",
		r: "3",
		key: "1v7zrd"
	}]]
};
Xa.node;
var Za = I(Xa), Qa = {
	name: "shield-user",
	size: 24,
	node: [
		["path", {
			d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
			key: "oel41y"
		}],
		["path", {
			d: "M6.376 18.91a6 6 0 0 1 11.249.003",
			key: "hnjrf2"
		}],
		["circle", {
			cx: "12",
			cy: "11",
			r: "4",
			key: "1gt34v"
		}]
	]
};
Qa.node;
var $a = I(Qa), eo = {
	name: "shopping-cart",
	size: 24,
	node: [
		["path", {
			d: "m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18",
			key: "uebgi3"
		}],
		["path", {
			d: "M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25",
			key: "1j7c9p"
		}],
		["circle", {
			cx: "18",
			cy: "20",
			r: "2",
			key: "t9985n"
		}],
		["circle", {
			cx: "8",
			cy: "20",
			r: "2",
			key: "ckkr5m"
		}]
	]
};
eo.node;
var to = I(eo), no = {
	name: "sliders-horizontal",
	size: 24,
	node: [
		["path", {
			d: "M10 5H3",
			key: "1qgfaw"
		}],
		["path", {
			d: "M12 19H3",
			key: "yhmn1j"
		}],
		["path", {
			d: "M14 3v4",
			key: "1sua03"
		}],
		["path", {
			d: "M16 17v4",
			key: "1q0r14"
		}],
		["path", {
			d: "M21 12h-9",
			key: "1o4lsq"
		}],
		["path", {
			d: "M21 19h-5",
			key: "1rlt1p"
		}],
		["path", {
			d: "M21 5h-7",
			key: "1oszz2"
		}],
		["path", {
			d: "M8 10v4",
			key: "tgpxqk"
		}],
		["path", {
			d: "M8 12H3",
			key: "a7s4jb"
		}]
	]
};
no.node;
var ro = I(no), io = {
	name: "sparkles",
	size: 24,
	node: [
		["path", {
			d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
			key: "1s2grr"
		}],
		["path", {
			d: "M20 2v4",
			key: "1rf3ol"
		}],
		["path", {
			d: "M22 4h-4",
			key: "gwowj6"
		}],
		["circle", {
			cx: "4",
			cy: "20",
			r: "2",
			key: "6kqj1y"
		}]
	],
	aliases: ["stars"]
};
io.node;
var ao = I(io), oo = {
	name: "square-code",
	size: 24,
	node: [
		["path", {
			d: "m10 9-3 3 3 3",
			key: "1oro0q"
		}],
		["path", {
			d: "m14 15 3-3-3-3",
			key: "bz13h7"
		}],
		["rect", {
			x: "3",
			y: "3",
			width: "18",
			height: "18",
			rx: "2",
			key: "h1oib"
		}]
	],
	aliases: ["code-square"]
};
oo.node;
var so = I(oo), co = {
	name: "square-function",
	size: 24,
	node: [
		["rect", {
			width: "18",
			height: "18",
			x: "3",
			y: "3",
			rx: "2",
			ry: "2",
			key: "1m3agn"
		}],
		["path", {
			d: "M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3",
			key: "m1af9g"
		}],
		["path", {
			d: "M9 11.2h5.7",
			key: "3zgcl2"
		}]
	],
	aliases: ["function-square"]
};
co.node;
var lo = I(co), uo = {
	name: "square-pen",
	size: 24,
	node: [["path", {
		d: "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
		key: "1m0v6g"
	}], ["path", {
		d: "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",
		key: "ohrbg2"
	}]],
	aliases: [
		"pen-box",
		"edit",
		"pen-square"
	]
};
uo.node;
var fo = I(uo), po = {
	name: "square-plus",
	size: 24,
	node: [
		["rect", {
			width: "18",
			height: "18",
			x: "3",
			y: "3",
			rx: "2",
			key: "afitv7"
		}],
		["path", {
			d: "M8 12h8",
			key: "1wcyev"
		}],
		["path", {
			d: "M12 8v8",
			key: "napkw2"
		}]
	],
	aliases: ["plus-square"]
};
po.node;
var mo = I(po), ho = {
	name: "square-terminal",
	size: 24,
	node: [
		["path", {
			d: "m7 11 2-2-2-2",
			key: "1lz0vl"
		}],
		["path", {
			d: "M11 13h4",
			key: "1p7l4v"
		}],
		["rect", {
			width: "18",
			height: "18",
			x: "3",
			y: "3",
			rx: "2",
			ry: "2",
			key: "1m3agn"
		}]
	],
	aliases: ["terminal-square"]
};
ho.node;
var go = I(ho), _o = {
	name: "square",
	size: 24,
	node: [["rect", {
		width: "18",
		height: "18",
		x: "3",
		y: "3",
		rx: "2",
		key: "afitv7"
	}]]
};
_o.node;
var vo = I(_o), yo = {
	name: "sun",
	size: 24,
	node: [
		["circle", {
			cx: "12",
			cy: "12",
			r: "4",
			key: "4exip2"
		}],
		["path", {
			d: "M12 2v2",
			key: "tus03m"
		}],
		["path", {
			d: "M12 20v2",
			key: "1lh1kg"
		}],
		["path", {
			d: "m4.93 4.93 1.41 1.41",
			key: "149t6j"
		}],
		["path", {
			d: "m17.66 17.66 1.41 1.41",
			key: "ptbguv"
		}],
		["path", {
			d: "M2 12h2",
			key: "1t8f8n"
		}],
		["path", {
			d: "M20 12h2",
			key: "1q8mjw"
		}],
		["path", {
			d: "m6.34 17.66-1.41 1.41",
			key: "1m8zz5"
		}],
		["path", {
			d: "m19.07 4.93-1.41 1.41",
			key: "1shlcs"
		}]
	]
};
yo.node;
var bo = I(yo), xo = {
	name: "tag",
	size: 24,
	node: [["path", {
		d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",
		key: "vktsd0"
	}], ["circle", {
		cx: "7.5",
		cy: "7.5",
		r: ".5",
		fill: "currentColor",
		key: "kqv944"
	}]]
};
xo.node;
var So = I(xo), Co = {
	name: "tags",
	size: 24,
	node: [
		["path", {
			d: "M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z",
			key: "16rjxf"
		}],
		["path", {
			d: "M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193",
			key: "178nd4"
		}],
		["circle", {
			cx: "10.5",
			cy: "6.5",
			r: ".5",
			fill: "currentColor",
			key: "12ikhr"
		}]
	]
};
Co.node;
var wo = I(Co), To = {
	name: "terminal",
	size: 24,
	node: [["path", {
		d: "M12 19h8",
		key: "baeox8"
	}], ["path", {
		d: "m4 17 6-6-6-6",
		key: "1yngyt"
	}]]
};
To.node;
var Eo = I(To), Do = {
	name: "text-search",
	size: 24,
	node: [
		["path", {
			d: "M21 5H3",
			key: "1fi0y6"
		}],
		["path", {
			d: "M10 12H3",
			key: "1ulcyk"
		}],
		["path", {
			d: "M10 19H3",
			key: "108z41"
		}],
		["circle", {
			cx: "17",
			cy: "15",
			r: "3",
			key: "1upz2a"
		}],
		["path", {
			d: "m21 19-1.9-1.9",
			key: "dwi7p8"
		}]
	]
};
Do.node;
var Oo = I(Do), ko = {
	name: "thermometer",
	size: 24,
	node: [["path", {
		d: "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z",
		key: "17jzev"
	}]]
};
ko.node;
var Ao = I(ko), jo = {
	name: "timer",
	size: 24,
	node: [
		["line", {
			x1: "10",
			x2: "14",
			y1: "2",
			y2: "2",
			key: "14vaq8"
		}],
		["line", {
			x1: "12",
			x2: "15",
			y1: "14",
			y2: "11",
			key: "17fdiu"
		}],
		["circle", {
			cx: "12",
			cy: "14",
			r: "8",
			key: "1e1u0o"
		}]
	]
};
jo.node;
var Mo = I(jo), No = {
	name: "tool-case",
	size: 24,
	node: [
		["path", {
			d: "M10 15h4",
			key: "192ueg"
		}],
		["path", {
			d: "m14.5 4.058.571-1.429a1 1 0 011.3-.558l5 2a1 1 0 01.549.534.88.88 0 01.01.765l-2.332 5.83",
			key: "1nkiiy"
		}],
		["path", {
			d: "M15.634 11a2 2 0 00-.186-.34l-1.17-1.757 1.31-1.656a2 2 0 00-2.109-3.165l-2.032.57-1.17-1.758a2 2 0 00-3.664 1.028l-.086 2.11-2.032.568a2 2 0 00-.155 3.8l1.617.6",
			key: "7rml5f"
		}],
		["path", {
			d: "M4 12.006A1 1 0 014.994 11H19a1 1 0 011 1v7a2 2 0 01-2 2H6a2 2 0 01-2-2z",
			key: "1y761e"
		}]
	]
};
No.node;
var Po = I(No), Fo = {
	name: "trash",
	size: 24,
	node: [
		["path", {
			d: "M10 11v6",
			key: "nco0om"
		}],
		["path", {
			d: "M14 11v6",
			key: "outv1u"
		}],
		["path", {
			d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
			key: "miytrc"
		}],
		["path", {
			d: "M3 6h18",
			key: "d0wm0j"
		}],
		["path", {
			d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
			key: "e791ji"
		}]
	],
	aliases: ["trash-2"]
};
Fo.node;
var Io = I(Fo), Lo = {
	name: "triangle-alert",
	size: 24,
	node: [
		["path", {
			d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
			key: "wmoenq"
		}],
		["path", {
			d: "M12 9v4",
			key: "juzpu7"
		}],
		["path", {
			d: "M12 17h.01",
			key: "p32p05"
		}]
	],
	aliases: ["alert-triangle"]
};
Lo.node;
var Ro = I(Lo), zo = {
	name: "type",
	size: 24,
	node: [
		["path", {
			d: "M12 4v16",
			key: "1654pz"
		}],
		["path", {
			d: "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2",
			key: "e0r10z"
		}],
		["path", {
			d: "M9 20h6",
			key: "s66wpe"
		}]
	]
};
zo.node;
var Bo = I(zo), Vo = {
	name: "undo-2",
	size: 24,
	node: [["path", {
		d: "M9 14 4 9l5-5",
		key: "102s5s"
	}], ["path", {
		d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11",
		key: "f3b9sd"
	}]]
};
Vo.node;
var Ho = I(Vo), Uo = {
	name: "user-round",
	size: 24,
	node: [["circle", {
		cx: "12",
		cy: "8",
		r: "5",
		key: "1hypcn"
	}], ["path", {
		d: "M20 21a8 8 0 0 0-16 0",
		key: "rfgkzh"
	}]],
	aliases: ["user-2"]
};
Uo.node;
var Wo = I(Uo), Go = {
	name: "users-round",
	size: 24,
	node: [
		["path", {
			d: "M18 21a8 8 0 0 0-16 0",
			key: "3ypg7q"
		}],
		["circle", {
			cx: "10",
			cy: "8",
			r: "5",
			key: "o932ke"
		}],
		["path", {
			d: "M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3",
			key: "10s06x"
		}]
	],
	aliases: ["users-2"]
};
Go.node;
var Ko = I(Go), qo = {
	name: "variable",
	size: 24,
	node: [
		["path", {
			d: "M8 21s-4-3-4-9 4-9 4-9",
			key: "uto9ud"
		}],
		["path", {
			d: "M16 3s4 3 4 9-4 9-4 9",
			key: "4w2vsq"
		}],
		["line", {
			x1: "15",
			x2: "9",
			y1: "9",
			y2: "15",
			key: "f7djnv"
		}],
		["line", {
			x1: "9",
			x2: "15",
			y1: "9",
			y2: "15",
			key: "1shsy8"
		}]
	]
};
qo.node;
var Jo = I(qo), Yo = {
	name: "workflow",
	size: 24,
	node: [
		["rect", {
			width: "8",
			height: "8",
			x: "3",
			y: "3",
			rx: "2",
			key: "by2w9f"
		}],
		["path", {
			d: "M7 11v4a2 2 0 0 0 2 2h4",
			key: "xkn7yn"
		}],
		["rect", {
			width: "8",
			height: "8",
			x: "13",
			y: "13",
			rx: "2",
			key: "1cgmvn"
		}]
	]
};
Yo.node;
var Xo = I(Yo), Zo = {
	name: "wrench",
	size: 24,
	node: [["path", {
		d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",
		key: "1ngwbx"
	}]]
};
Zo.node;
var Qo = I(Zo), $o = {
	name: "x",
	size: 24,
	node: [["path", {
		d: "M18 6 6 18",
		key: "1bl5f8"
	}], ["path", {
		d: "m6 6 12 12",
		key: "d8bk6v"
	}]]
};
$o.node;
var es = I($o), ts = {
	name: "zap-off",
	size: 24,
	node: [
		["path", {
			d: "M10.768 5.111 13.44 2.44a1.5 1.5 0 012.474 1.561l-1.633 4.625",
			key: "l6h226"
		}],
		["path", {
			d: "m18.889 13.232.672-.672A1.5 1.5 0 0018.5 10h-2.844",
			key: "1717b9"
		}],
		["path", {
			d: "m2 2 20 20",
			key: "1ooewy"
		}],
		["path", {
			d: "m7.94 7.94-3.5 3.499A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l5.5-5.5",
			key: "1bjzrh"
		}]
	]
};
ts.node;
var ns = I(ts), rs = {
	name: "zap",
	size: 24,
	node: [["path", {
		d: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z",
		key: "1v7up4"
	}]]
};
rs.node;
var is = I(rs), as = {
	name: "zoom-in",
	size: 24,
	node: [
		["circle", {
			cx: "11",
			cy: "11",
			r: "8",
			key: "4ej97u"
		}],
		["line", {
			x1: "21",
			x2: "16.65",
			y1: "21",
			y2: "16.65",
			key: "13gj7c"
		}],
		["line", {
			x1: "11",
			x2: "11",
			y1: "8",
			y2: "14",
			key: "1vmskp"
		}],
		["line", {
			x1: "8",
			x2: "14",
			y1: "11",
			y2: "11",
			key: "durymu"
		}]
	]
};
as.node;
var os = I(as), ss = {
	name: "zoom-out",
	size: 24,
	node: [
		["circle", {
			cx: "11",
			cy: "11",
			r: "8",
			key: "4ej97u"
		}],
		["line", {
			x1: "21",
			x2: "16.65",
			y1: "21",
			y2: "16.65",
			key: "13gj7c"
		}],
		["line", {
			x1: "8",
			x2: "14",
			y1: "11",
			y2: "11",
			key: "durymu"
		}]
	]
};
ss.node;
var cs = I(ss), ls = {
	arcee: "M11.6967 0L0 20.1629H2.71067L13.0706 2.33934L11.6967 0Z M15.2983 6.23825L4.0472 20.2H7.05492L16.5237 8.42907L15.2983 6.23825Z M20.0163 14.3329L18.828 12.2906L8.35669 20.1627H12.2556L20.0163 14.3329Z M22.1672 18.0466L13.8866 20.1631H23.4297L22.1672 18.0466Z",
	chatGpt: "M9.205 8.658V6.398C9.205 6.208 9.277 6.065 9.443 5.97L13.986 3.354C14.605 2.997 15.342 2.831 16.103 2.831C18.957 2.831 20.765 5.043 20.765 7.397C20.765 7.564 20.765 7.754 20.741 7.944L16.031 5.185C15.903 5.10392 15.7545 5.06088 15.603 5.06088C15.4515 5.06088 15.303 5.10392 15.175 5.185L9.205 8.658ZM19.814 17.458V12.06C19.814 11.727 19.671 11.49 19.385 11.323L13.415 7.85L15.365 6.732C15.4355 6.68513 15.5183 6.66013 15.603 6.66013C15.6877 6.66013 15.7705 6.68513 15.841 6.732L20.384 9.349C21.693 10.109 22.573 11.727 22.573 13.297C22.573 15.105 21.503 16.77 19.813 17.46L19.814 17.458ZM7.802 12.703L5.852 11.561C5.77505 11.5204 5.71152 11.4584 5.66911 11.3824C5.62669 11.3064 5.6072 11.2198 5.613 11.133V5.899C5.613 3.354 7.563 1.427 10.204 1.427C11.204 1.427 12.131 1.76 12.916 2.355L8.23 5.067C7.945 5.233 7.802 5.471 7.802 5.804V12.703ZM12 15.128L9.205 13.558V10.228L12 8.658L14.795 10.228V13.558L12 15.128ZM13.796 22.358C12.796 22.358 11.869 22.026 11.084 21.431L15.77 18.719C16.055 18.553 16.198 18.315 16.198 17.982V11.084L18.172 12.226C18.339 12.321 18.41 12.464 18.41 12.654V17.887C18.41 20.432 16.436 22.358 13.796 22.358ZM8.159 17.055L3.615 14.438C2.307 13.677 1.427 12.06 1.427 10.49C1.42365 9.59786 1.68673 8.72504 2.18255 7.98336C2.67837 7.24169 3.38434 6.66493 4.21 6.327V11.75C4.21 12.083 4.353 12.321 4.638 12.488L10.585 15.937L8.635 17.055C8.56447 17.1019 8.48168 17.1269 8.397 17.1269C8.31232 17.1269 8.22953 17.1019 8.159 17.055ZM7.897 20.955C5.209 20.955 3.235 18.934 3.235 16.436C3.235 16.246 3.259 16.056 3.282 15.866L7.968 18.576C8.0956 18.6582 8.24419 18.702 8.396 18.702C8.54781 18.702 8.6964 18.6582 8.824 18.576L14.794 15.128V17.388C14.794 17.578 14.724 17.721 14.557 17.816L10.014 20.432C9.395 20.789 8.658 20.955 7.897 20.955ZM13.796 23.785C15.1664 23.7845 16.4947 23.3111 17.5563 22.4445C18.618 21.578 19.348 20.3715 19.623 19.029C22.287 18.339 24 15.84 24 13.296C24 11.631 23.287 10.014 22.002 8.848C22.121 8.348 22.192 7.849 22.192 7.35C22.192 3.949 19.433 1.403 16.246 1.403C15.6064 1.40012 14.9708 1.50492 14.366 1.713C13.2561 0.620228 11.7625 0.00535575 10.205 0C8.83445 0.000500422 7.50609 0.474136 6.44441 1.34087C5.38272 2.2076 4.6528 3.41428 4.378 4.757C1.713 5.447 0 7.945 0 10.49C0 12.156 0.713 13.773 1.998 14.938C1.879 15.438 1.808 15.938 1.808 16.437C1.808 19.838 4.567 22.383 7.754 22.383C8.396 22.383 9.014 22.288 9.634 22.074C10.7441 23.167 12.2381 23.7819 13.796 23.787V23.785Z",
	discord: "M19.2701 5.33C17.9401 4.71 16.5001 4.26 15.0001 4C14.9737 4.00038 14.9486 4.01116 14.9301 4.03C14.7501 4.36 14.5401 4.79 14.4001 5.12C12.8091 4.88015 11.1911 4.88015 9.60012 5.12C9.46012 4.78 9.25012 4.36 9.06012 4.03C9.05012 4.01 9.02012 4 8.99012 4C7.49012 4.26 6.06012 4.71 4.72012 5.33C4.71012 5.33 4.70012 5.34 4.69012 5.35C1.97012 9.42 1.22012 13.38 1.59012 17.3C1.59012 17.32 1.60012 17.34 1.62012 17.35C3.42012 18.67 5.15012 19.47 6.86012 20C6.89012 20.01 6.92012 20 6.93012 19.98C7.33012 19.43 7.69012 18.85 8.00012 18.24C8.02012 18.2 8.00012 18.16 7.96012 18.15C7.39012 17.93 6.85012 17.67 6.32012 17.37C6.28012 17.35 6.28012 17.29 6.31012 17.26C6.42012 17.18 6.53012 17.09 6.64012 17.01C6.66012 16.99 6.69012 16.99 6.71012 17C10.1501 18.57 13.8601 18.57 17.2601 17C17.2801 16.99 17.3101 16.99 17.3301 17.01C17.4401 17.1 17.5501 17.18 17.6601 17.27C17.7001 17.3 17.7001 17.36 17.6501 17.38C17.1301 17.69 16.5801 17.94 16.0101 18.16C15.9701 18.17 15.9601 18.22 15.9701 18.25C16.2901 18.86 16.6501 19.44 17.0401 19.99C17.0701 20 17.1001 20.01 17.1301 20C18.8501 19.47 20.5801 18.67 22.3801 17.35C22.4001 17.34 22.4101 17.32 22.4101 17.3C22.8501 12.77 21.6801 8.84 19.3101 5.35C19.3001 5.34 19.2901 5.33 19.2701 5.33ZM8.52012 14.91C7.49012 14.91 6.63012 13.96 6.63012 12.79C6.63012 11.62 7.47012 10.67 8.52012 10.67C9.58012 10.67 10.4201 11.63 10.4101 12.79C10.4101 13.96 9.57012 14.91 8.52012 14.91ZM15.4901 14.91C14.4601 14.91 13.6001 13.96 13.6001 12.79C13.6001 11.62 14.4401 10.67 15.4901 10.67C16.5501 10.67 17.3901 11.63 17.3801 12.79C17.3801 13.96 16.5501 14.91 15.4901 14.91Z",
	github: "M12 2C10.6868 2 9.38642 2.25866 8.17317 2.7612C6.95991 3.26375 5.85752 4.00035 4.92893 4.92893C3.05357 6.8043 2 9.34784 2 12C2 16.42 4.87 20.17 8.84 21.5C9.34 21.58 9.5 21.27 9.5 21V19.31C6.73 19.91 6.14 17.97 6.14 17.97C5.68 16.81 5.03 16.5 5.03 16.5C4.12 15.88 5.1 15.9 5.1 15.9C6.1 15.97 6.63 16.93 6.63 16.93C7.5 18.45 8.97 18 9.54 17.76C9.63 17.11 9.89 16.67 10.17 16.42C7.95 16.17 5.62 15.31 5.62 11.5C5.62 10.39 6 9.5 6.65 8.79C6.55 8.54 6.2 7.5 6.75 6.15C6.75 6.15 7.59 5.88 9.5 7.17C10.29 6.95 11.15 6.84 12 6.84C12.85 6.84 13.71 6.95 14.5 7.17C16.41 5.88 17.25 6.15 17.25 6.15C17.8 7.5 17.45 8.54 17.35 8.79C18 9.5 18.38 10.39 18.38 11.5C18.38 15.32 16.04 16.16 13.81 16.41C14.17 16.72 14.5 17.33 14.5 18.26V21C14.5 21.27 14.66 21.59 15.17 21.5C19.14 20.16 22 16.42 22 12C22 10.6868 21.7413 9.38642 21.2388 8.17317C20.7362 6.95991 19.9997 5.85752 19.0711 4.92893C18.1425 4.00035 17.0401 3.26375 15.8268 2.7612C14.6136 2.25866 13.3132 2 12 2Z",
	google: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z",
	javascript: "M6 3C5.20435 3 4.44129 3.31607 3.87868 3.87868C3.31607 4.44129 3 5.20435 3 6V18C3 18.7956 3.31607 19.5587 3.87868 20.1213C4.44129 20.6839 5.20435 21 6 21H18C18.7956 21 19.5587 20.6839 20.1213 20.1213C20.6839 19.5587 21 18.7956 21 18V6C21 5.20435 20.6839 4.44129 20.1213 3.87868C19.5587 3.31607 18.7956 3 18 3H6ZM13.334 16.055C14.054 16.635 14.7727 16.921 15.49 16.913C15.93 16.913 16.2673 16.8323 16.502 16.671C16.6113 16.6001 16.7002 16.5019 16.76 16.3862C16.8197 16.2705 16.8484 16.1412 16.843 16.011C16.8445 15.869 16.8149 15.7285 16.7561 15.5992C16.6974 15.47 16.611 15.3552 16.503 15.263C16.2683 15.0583 15.8243 14.853 15.171 14.647C14.3863 14.4203 13.7813 14.127 13.356 13.767C12.9387 13.407 12.726 12.9047 12.718 12.26C12.718 11.6513 12.982 11.1417 13.51 10.731C14.0233 10.3203 14.68 10.115 15.48 10.115C16.5947 10.115 17.489 10.3863 18.163 10.929L17.393 12.128C17.1157 11.9124 16.7977 11.7553 16.458 11.666C16.1528 11.5637 15.8338 11.5081 15.512 11.501C15.132 11.501 14.8277 11.5707 14.599 11.71C14.3723 11.85 14.259 12.0333 14.259 12.26C14.259 12.5093 14.398 12.722 14.676 12.898C14.956 13.0673 15.4327 13.2543 16.106 13.459C16.92 13.701 17.4993 14.0237 17.844 14.427C18.1887 14.8303 18.361 15.3437 18.361 15.967C18.361 16.605 18.1153 17.155 17.624 17.617C17.14 18.0717 16.436 18.31 15.512 18.332C14.302 18.332 13.29 17.969 12.476 17.243L13.334 16.055ZM7.804 16.693C8.03867 16.8397 8.321 16.913 8.651 16.913C8.99567 16.913 9.28167 16.814 9.509 16.616C9.73567 16.4107 9.84933 16.055 9.85 15.549V10.247H11.335V15.835C11.313 16.7003 11.0637 17.3237 10.587 17.705C10.3262 17.9255 10.0229 18.0902 9.696 18.189C9.39282 18.2813 9.07792 18.3295 8.761 18.332C8.211 18.332 7.72333 18.2367 7.298 18.046C6.84333 17.8413 6.462 17.4783 6.154 16.957L7.188 16.11C7.378 16.3667 7.58333 16.561 7.804 16.693Z",
	python: "M21.5694 9.42899C21.2154 8.07399 20.5694 7.00899 19.2144 7.00899H17.4094V9.13899C17.4094 10.784 15.9894 12.171 14.4734 12.171H9.66441C8.34241 12.171 7.30941 13.301 7.30941 14.623V19.173C7.30941 20.43 8.43941 21.205 9.66441 21.624C11.1494 22.076 12.6004 22.173 14.4394 21.624C15.6334 21.269 16.7954 20.592 16.7954 19.172V17.365H12.0524V16.785H19.2144C20.5694 16.785 21.1184 15.817 21.5694 14.365C22.0534 12.784 22.0534 11.332 21.5694 9.42899ZM14.7294 18.462C15.2144 18.462 15.6334 18.882 15.6334 19.366C15.6334 19.85 15.2134 20.269 14.7304 20.269C14.2464 20.301 13.8264 19.849 13.8264 19.366C13.7944 18.882 14.2134 18.462 14.7304 18.462M9.44041 11.558H14.2154C15.5374 11.558 16.5704 10.461 16.5704 9.10599V4.62099C16.5704 3.36299 15.4734 2.39499 14.2144 2.16899C12.6344 1.94399 10.8914 1.94399 9.44041 2.16899C7.40741 2.52399 7.08441 3.26599 7.08441 4.62099V6.42799H11.8594V7.00799H5.34141C3.98641 7.00799 2.76041 7.87999 2.40541 9.42799C1.95341 11.235 1.95341 12.364 2.40541 14.236C2.76041 15.656 3.53541 16.656 4.95441 16.656H6.50341V14.494C6.47041 12.913 7.85841 11.558 9.43941 11.558M9.14941 5.20199C8.91134 5.19715 8.68436 5.10048 8.5159 4.93221C8.34743 4.76393 8.25052 4.53705 8.24541 4.29899C8.24541 3.81499 8.66541 3.39499 9.14841 3.39499C9.63141 3.39499 10.0524 3.81499 10.0524 4.29899C10.0524 4.78299 9.63341 5.20199 9.14941 5.20199Z"
}, us = /* @__PURE__ */ function(e) {
	return e.Checklist = "checklist", e.Features = "features", e.Publish = "publish", e.Toolbox = "toolbox", e.Play = "play", e.Add = "add", e.Chat = "chat", e.Home = "home", e.Coursor = "coursor", e.Hand = "hand", e.Order = "order", e.ZoomIn = "zoomIn", e.ZoomOut = "zoomOut", e.TurnLeft = "turnLeft", e.TurnRight = "turnRight", e.History = "history", e.Env = "env", e.AddNote = "addNote", e.Controls = "controls", e.ArrowLeft = "arrowLeft", e.Down = "down", e.Left = "left", e.ArrowRight = "arrowRight", e.Right = "right", e.Top = "top", e.Grid = "grid", e.ArrowTop = "arrowTop", e.Trash = "trash", e.ArrowDown = "arrowDown", e.Close = "close", e.Hamburger = "hamburger", e.BookOpen = "bookOpen", e.Ai = "ai", e.Book = "book", e.FileCopy = "fileCopy", e.FileCopyFilled = "fileCopyFilled", e.FileUpload = "fileUpload", e.Search = "search", e.PlayHistory = "playHistory", e.MenuHorizontal = "menuHorizontal", e.HideSidebar = "hideSidebar", e.MenuVertical = "menuVertical", e.Tag = "tag", e.TagAdd = "tagAdd", e.Moon = "moon", e.Sun = "sun", e.Desktop = "desktop", e.DoubleArrowsVertical = "doubleArrowsVertical", e.FinanceMode = "financeMode", e.Refresh = "refresh", e.Info = "info", e.FolderCopy = "folderCopy", e.Important = "important", e.Globe = "globe", e.Filter = "filter", e.Microphone = "microphone", e.Image = "image", e.Attachment = "attachment", e.Plane = "plane", e.PlaneAdd = "planeAdd", e.Headphones = "headphones", e.Bolt = "bolt", e.Private = "private", e.Scheme = "scheme", e.Repair = "repair", e.Flow = "flow", e.Folder = "folder", e.Folders = "folders", e.Edit = "edit", e.AddCircle = "addCircle", e.Loader = "loader", e.Gear = "gear", e.Exit = "exit", e.Archive = "archive", e.FolderOpen = "folderOpen", e.Flag = "flag", e.DoubleArrowHorizontal = "doubleArrowHorizontal", e.Code = "code", e.List = "list", e.UserData = "userData", e.Text = "text", e.Check = "check", e.FullScreen = "fullScreen", e.Function = "function", e.Combine = "combine", e.Danger = "danger", e.Download = "download", e.Stop = "stop", e.Pause = "pause", e.JSON = "code", e.File = "attachment", e.Remove = "remove", e.AddBox = "addBox", e.Layers = "layers", e.Eye = "eye", e.EyeStrikethrough = "eyeStrikethrough", e.BoltStrikethrough = "boltStrikethrough", e.Drag = "drag", e.Lock = "lock", e.Javascript = "javascript", e.Python = "python", e.FullScreenExit = "fullScreenExit", e.Person = "person", e.People = "people", e.Group = "group", e.Arcee = "arcee", e.Cart = "cart", e.Google = "google", e.Timelaps = "timelaps", e.Token = "token", e.LeftSidebar = "leftSidebar", e.ShowSidePanel = "showSidePanel", e.HideSidePanel = "hideSidePanel", e.Money = "money", e.AddCreditCard = "addCreditCard", e.External = "external", e.ScreenView = "screenView", e.Activity = "activity", e.Purchase = "purchase", e.Key = "key", e.Discord = "discord", e.Dollar = "dollar", e.Temperature = "temperature", e.CheckCircle = "checkCircle", e.Server = "server", e.Retry = "retry", e.Provider = "provider", e.Github = "github", e.Price = "price", e.Calendar = "calendar", e.Terminal = "terminal", e.Chunk = "chunk", e.Markdown = "markdown", e.String = "string", e.Brain = "brain", e.SearchPage = "searchPage", e.Pin = "pin", e.Unpin = "unpin", e.ChatGpt = "chatGpt", e.Orchestrator = "orchestrator", e.Robot = "robot", e.ReadFile = "readFile", e.SearchFile = "searchFile", e.SearchFiles = "searchFiles", e.WriteCommand = "writeCommand", e.Clock = "clock", e.AddChat = "addChat", e.Goal = "goal", e;
}({}), ds = {
	checklist: Ni,
	features: ji,
	publish: jn,
	toolbox: Po,
	play: ka,
	add: ja,
	chat: $i,
	home: yi,
	coursor: da,
	hand: pi,
	order: Li,
	zoomIn: os,
	zoomOut: cs,
	turnLeft: Ho,
	turnRight: Na,
	history: La,
	env: Jo,
	addNote: Lr,
	controls: ro,
	arrowLeft: Tn,
	down: Yn,
	left: Zn,
	arrowRight: Dn,
	right: $n,
	top: tr,
	grid: ki,
	arrowTop: Nn,
	trash: Io,
	arrowDown: xn,
	close: es,
	hamburger: Yi,
	bookOpen: Fn,
	ai: ao,
	book: Ln,
	fileCopy: xr,
	fileCopyFilled: xr,
	fileUpload: Ur,
	search: Ga,
	playHistory: sr,
	menuHorizontal: jr,
	hideSidebar: Fi,
	menuVertical: kr,
	tag: So,
	tagAdd: wo,
	moon: la,
	sun: bo,
	desktop: sa,
	doubleArrowsVertical: yn,
	financeMode: Gn,
	refresh: Fa,
	info: Ci,
	folderCopy: $r,
	important: rr,
	globe: ai,
	filter: ti,
	microphone: ta,
	image: xi,
	attachment: xa,
	plane: qa,
	planeAdd: I("send-plus", [
		["path", {
			d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
			key: "send"
		}],
		["path", {
			d: "m21.854 2.147-10.94 10.939",
			key: "send-fold"
		}],
		["path", {
			d: "M5 16v6",
			key: "plus-vertical"
		}],
		["path", {
			d: "M2 19h6",
			key: "plus-horizontal"
		}]
	]),
	headphones: _i,
	bolt: is,
	private: $a,
	scheme: ri,
	repair: Qo,
	flow: Xo,
	folder: Zr,
	folders: $r,
	edit: fo,
	addCircle: lr,
	loader: Vi,
	gear: Za,
	exit: Gi,
	archive: _n,
	folderOpen: qr,
	flag: Gr,
	doubleArrowHorizontal: Cn,
	code: so,
	list: zi,
	userData: yr,
	text: Vr,
	check: qn,
	fullScreen: qi,
	function: lo,
	combine: _r,
	danger: Ro,
	download: Dr,
	stop: vo,
	pause: Ca,
	remove: aa,
	addBox: mo,
	layers: Di,
	eye: Fr,
	eyeStrikethrough: Nr,
	boltStrikethrough: ns,
	drag: li,
	lock: Ui,
	fullScreenExit: ra,
	person: Wo,
	people: Ko,
	group: di,
	cart: to,
	timelaps: Mo,
	token: hr,
	leftSidebar: ha,
	showSidePanel: ya,
	hideSidePanel: _a,
	money: Cr,
	addCreditCard: Cr,
	external: kn,
	screenView: hn,
	activity: pn,
	purchase: to,
	key: Ti,
	dollar: Tr,
	temperature: Ao,
	checkCircle: ar,
	server: Ya,
	retry: za,
	provider: pr,
	price: Tr,
	calendar: Un,
	terminal: go,
	chunk: Va,
	markdown: hi,
	string: Bo,
	brain: Vn,
	searchPage: zr,
	pin: Da,
	unpin: Ta,
	orchestrator: pa,
	robot: zn,
	readFile: Ua,
	searchFile: Oo,
	searchFiles: Yr,
	writeCommand: Eo,
	clock: dr,
	addChat: Zi,
	goal: si
}, fs = ({ iconName: e = "checklist", color: t, size: n = 20, strokeWidth: r = 1.75, className: i = "", style: a, ...o }) => {
	let s = t ? {
		"--icon-color": t,
		...a
	} : a, c = ds[e];
	return c ? /* @__PURE__ */ k(c, {
		className: `icon ${i}`,
		size: n,
		strokeWidth: r,
		style: s,
		...o
	}) : /* @__PURE__ */ k("svg", {
		className: `icon ${i}`,
		width: n,
		height: n,
		viewBox: "0 0 24 24",
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		style: s,
		...o,
		children: /* @__PURE__ */ k("path", {
			d: ls[e] ?? "",
			fill: "currentColor"
		})
	});
};
fs.Name = us;
// src/app/atoms/loader/index.tsx
var ps = /* @__PURE__ */ function(e) {
	return e[e.XSmall = 16] = "XSmall", e[e.Small = 20] = "Small", e[e.Medium = 24] = "Medium", e[e.MediumLarge = 28] = "MediumLarge", e[e.Large = 32] = "Large", e[e.X2Large = 36] = "X2Large", e[e.X3Large = 40] = "X3Large", e[e.XLarge = 48] = "XLarge", e;
}({}), ms = /* @__PURE__ */ function(e) {
	return e.Brand = "var(--color-fill-accent-primary)", e.Neutral = "var(--color-fill-basic-primary)", e.Destructive = "var(--color-fill-error-primary)", e.OnPrimary = "var(--color-fill-btn-primary)", e;
}({}), hs = ({ size: e = 48, variant: t = "var(--color-fill-basic-primary)", className: n = "", ...r }) => /* @__PURE__ */ k("div", {
	className: F("loader flex size-fit", n),
	...r,
	children: /* @__PURE__ */ k(fs, {
		iconName: us.Loader,
		size: e,
		color: t
	})
});
hs.Size = ps, hs.Variant = ms;
// src/app/lib/anchor.ts
var gs = /* @__PURE__ */ function(e) {
	return e.TopLeft = "top-left", e.TopCenter = "top-center", e.TopRight = "top-right", e.CenterRight = "center-right", e.RightTop = "right-top", e.BottomRight = "bottom-right", e.BottomCenter = "bottom-center", e.BottomLeft = "bottom-left", e.CenterLeft = "center-left", e;
}({}), _s = {
	"top-right": {
		side: "top",
		align: "start"
	},
	"top-center": {
		side: "top",
		align: "center"
	},
	"top-left": {
		side: "top",
		align: "end"
	},
	"center-left": {
		side: "left",
		align: "center"
	},
	"bottom-left": {
		side: "bottom",
		align: "end"
	},
	"bottom-center": {
		side: "bottom",
		align: "center"
	},
	"bottom-right": {
		side: "bottom",
		align: "start"
	},
	"center-right": {
		side: "right",
		align: "center"
	},
	"right-top": {
		side: "right",
		align: "start"
	}
};
function vs(e) {
	let t = [];
	for (let n = e?.parentElement ?? null; n; n = n.parentElement) {
		let e = window.getComputedStyle(n);
		(e.overflowX !== "visible" || e.overflowY !== "visible") && t.push(n);
	}
	return t;
}
// src/app/hooks/useMediaQuery.ts
function ys(e) {
	let t = x(() => window.matchMedia(e), [e]), n = g((e) => (t.addEventListener("change", e), () => t.removeEventListener("change", e)), [t]), r = g(() => t.matches, [t]);
	return w(n, r, r);
}
var bs = () => ys("(min-width: 1280px)"), xs = () => ys("(max-width: 767.98px)"), Ss = () => ys("(min-width: 768px) and (max-width: 1279.98px)"), Cs = Object.defineProperty, ws = (e, t) => Cs(e, "name", {
	value: t,
	configurable: !0
});
function Ts(e, t) {
	if (typeof e == "function") return e(t);
	e != null && (e.current = t);
}
ws(Ts, "setRef");
function Es(...e) {
	return (t) => {
		let n = !1, r = e.map((e) => {
			let r = Ts(e, t);
			return !n && typeof r == "function" && (n = !0), r;
		});
		if (n) return () => {
			for (let t = 0; t < r.length; t++) {
				let n = r[t];
				typeof n == "function" ? n() : Ts(e[t], null);
			}
		};
	};
}
ws(Es, "composeRefs");
function Ds(...e) {
	return d.useCallback(Es(...e), e);
}
ws(Ds, "useComposedRefs");
// node_modules/@radix-ui/react-slot/dist/index.mjs
var Os = Object.defineProperty, ks = (e, t) => Os(e, "name", {
	value: t,
	configurable: !0
});
// @__NO_SIDE_EFFECTS__
function As(e) {
	let t = d.forwardRef((t, n) => {
		let { children: r, ...i } = t, a = null, o = !1, s = [];
		r = Vs(r), d.Children.forEach(r, (e) => {
			if (Ls(e)) {
				o = !0;
				let t = e, n = "child" in t.props ? t.props.child : t.props.children;
				for (; zs(n) && typeof Gs == "function";) n = Gs(n._payload);
				a = Ps(t, n), s.push(a?.props?.children);
			} else s.push(e);
		}), a ? a = d.cloneElement(a, void 0, s) : !o && d.Children.count(r) === 1 && d.isValidElement(r) && (a = r);
		let c = a ? Is(a) : void 0, l = Ds(n, c);
		if (!a) {
			if (r || r === 0) throw Error(o ? Ws(e) : Us(e));
			return r;
		}
		let u = Fs(i, a.props ?? {});
		return a.type !== d.Fragment && (u.ref = n ? l : c), d.cloneElement(a, u);
	});
	return t.displayName = `${e}.Slot`, t;
}
ks(As, "createSlot");
var js = /* @__PURE__ */ As("Slot"), Ms = Symbol.for("radix.slottable");
// @__NO_SIDE_EFFECTS__
function Ns(e) {
	let t = /* @__PURE__ */ ks((e) => "child" in e ? e.children(e.child) : e.children, "Slottable");
	return t.displayName = `${e}.Slottable`, t.__radixId = Ms, t;
}
ks(Ns, "createSlottable");
var Ps = /* @__PURE__ */ ks((e, t) => "child" in e.props ? d.isValidElement(t) ? d.cloneElement(t, void 0, e.props.children(t.props.children)) : null : d.isValidElement(t) ? t : null, "getSlottableElementFromSlottable");
function Fs(e, t) {
	let n = { ...t };
	for (let r in t) {
		let i = e[r], a = t[r];
		/^on[A-Z]/.test(r) ? i && a ? n[r] = (...e) => {
			let t = a(...e);
			return i(...e), t;
		} : i && (n[r] = i) : r === "style" ? n[r] = {
			...i,
			...a
		} : r === "className" ? n[r] = [i, a].filter(Boolean).join(" ") : r === "aria-describedby" && (n[r] = Hs(a, i));
	}
	return {
		...e,
		...n
	};
}
ks(Fs, "mergeProps");
function Is(e) {
	let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning;
	return n ? e.ref : (t = Object.getOwnPropertyDescriptor(e, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning, n ? e.props.ref : e.props.ref || e.ref);
}
ks(Is, "getElementRef");
function Ls(e) {
	return d.isValidElement(e) && typeof e.type == "function" && "__radixId" in e.type && e.type.__radixId === Ms;
}
ks(Ls, "isSlottable");
var Rs = Symbol.for("react.lazy");
function zs(e) {
	return typeof e == "object" && !!e && "$$typeof" in e && e.$$typeof === Rs && "_payload" in e && Bs(e._payload);
}
ks(zs, "isLazyComponent");
function Bs(e) {
	return typeof e == "object" && !!e && "then" in e;
}
ks(Bs, "isPromiseLike");
function Vs(e) {
	let t = e;
	for (; zs(t) && typeof Gs == "function";) t = Gs(t._payload);
	return t;
}
ks(Vs, "useUnwrappedLazy");
function Hs(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
ks(Hs, "concatAriaDescribedby");
var Us = /* @__PURE__ */ ks((e) => `${e} failed to slot onto its children. Expected a single React element child or \`Slottable\`.`, "createSlotError"), Ws = /* @__PURE__ */ ks((e) => `${e} failed to slot onto its \`Slottable\`. Expected \`Slottable\` to receive a single React element child.`, "createSlottableError"), Gs = d.use, Ks = Object.defineProperty, qs = (e, t) => Ks(e, "name", {
	value: t,
	configurable: !0
}), Js = [
	"a",
	"button",
	"div",
	"form",
	"h2",
	"h3",
	"img",
	"input",
	"label",
	"li",
	"nav",
	"ol",
	"p",
	"select",
	"span",
	"svg",
	"ul"
].reduce((e, t) => {
	let n = /* @__PURE__ */ As(`Primitive.${t}`), r = d.forwardRef((e, r) => {
		let { asChild: i, ...a } = e, o = i ? n : t;
		return typeof window < "u" && (window[Symbol.for("radix-ui")] = !0), /* @__PURE__ */ k(o, {
			...a,
			ref: r
		});
	});
	return r.displayName = `Primitive.${t}`, {
		...e,
		[t]: r
	};
}, {});
function Ys(e, t) {
	e && ie.flushSync(() => e.dispatchEvent(t));
}
qs(Ys, "dispatchDiscreteCustomEvent");
// node_modules/@radix-ui/react-visually-hidden/dist/index.mjs
var Xs = Object.defineProperty, Zs = (e, t) => Xs(e, "name", {
	value: t,
	configurable: !0
}), Qs = Object.freeze({
	position: "absolute",
	border: 0,
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: "hidden",
	clip: "rect(0, 0, 0, 0)",
	whiteSpace: "nowrap",
	wordWrap: "normal"
}), $s = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Zs(function(e, t) {
	return /* @__PURE__ */ k(Js.span, {
		...e,
		ref: t,
		style: {
			...Qs,
			...e.style
		}
	});
}, "VisuallyHidden")), ec = Object.defineProperty, tc = (e, t) => ec(e, "name", {
	value: t,
	configurable: !0
});
// @__NO_SIDE_EFFECTS__
function nc(e, t) {
	let n = d.createContext(t);
	n.displayName = e + "Context";
	let r = /* @__PURE__ */ tc((e) => {
		let { children: t, ...r } = e, i = d.useMemo(() => r, Object.values(r));
		return /* @__PURE__ */ k(n.Provider, {
			value: i,
			children: t
		});
	}, "Provider");
	r.displayName = e + "Provider";
	function i(r, i = {}) {
		let { optional: a = !1 } = i, o = d.useContext(n);
		if (o) return o;
		if (t !== void 0) return t;
		if (!a) throw Error(`\`${r}\` must be used within \`${e}\``);
	}
	return tc(i, "useContext"), [r, i];
}
tc(nc, "createContext");
// @__NO_SIDE_EFFECTS__
function rc(e, t = []) {
	let n = [];
	function r(t, r) {
		let i = d.createContext(r);
		i.displayName = t + "Context";
		let a = n.length;
		n = [...n, r];
		let o = /* @__PURE__ */ tc((t) => {
			let { scope: n, children: r, ...o } = t, s = n?.[e]?.[a] || i, c = d.useMemo(() => o, Object.values(o));
			return /* @__PURE__ */ k(s.Provider, {
				value: c,
				children: r
			});
		}, "Provider");
		o.displayName = t + "Provider";
		function s(n, o, s = {}) {
			let { optional: c = !1 } = s, l = o?.[e]?.[a] || i, u = d.useContext(l);
			if (u) return u;
			if (r !== void 0) return r;
			if (!c) throw Error(`\`${n}\` must be used within \`${t}\``);
		}
		return tc(s, "useContext"), [o, s];
	}
	tc(r, "createContext");
	let i = /* @__PURE__ */ tc(() => {
		let t = n.map((e) => d.createContext(e));
		return /* @__PURE__ */ tc(function(n) {
			let r = n?.[e] || t;
			return d.useMemo(() => ({ [`__scope${e}`]: {
				...n,
				[e]: r
			} }), [n, r]);
		}, "useScope");
	}, "createScope");
	return i.scopeName = e, [r, ic(i, ...t)];
}
tc(rc, "createContextScope");
function ic(...e) {
	let t = e[0];
	if (e.length === 1) return t;
	let n = /* @__PURE__ */ tc(() => {
		let n = e.map((e) => ({
			useScope: e(),
			scopeName: e.scopeName
		}));
		return /* @__PURE__ */ tc(function(e) {
			let r = n.reduce((t, { useScope: n, scopeName: r }) => {
				let i = n(e)[`__scope${r}`];
				return {
					...t,
					...i
				};
			}, {});
			return d.useMemo(() => ({ [`__scope${t.scopeName}`]: r }), [r]);
		}, "useComposedScopes");
	}, "createScope");
	return n.scopeName = t.scopeName, n;
}
tc(ic, "composeContextScopes");
// node_modules/@radix-ui/react-use-layout-effect/dist/index.mjs
var ac = globalThis?.document ? d.useLayoutEffect : () => {}, oc = Object.defineProperty, sc = (e, t) => oc(e, "name", {
	value: t,
	configurable: !0
}), cc = !!(typeof window < "u" && window.document && window.document.createElement);
function lc(e, t, { checkForDefaultPrevented: n = !0 } = {}) {
	return /* @__PURE__ */ sc(function(r) {
		if (e?.(r), n === !1 || !r || !r.defaultPrevented) return t?.(r);
	}, "handleEvent");
}
sc(lc, "composeEventHandlers");
function uc(e) {
	if (!cc) throw Error("Cannot access window outside of the DOM");
	return e?.ownerDocument?.defaultView ?? window;
}
sc(uc, "getOwnerWindow");
function dc(e) {
	if (!cc) throw Error("Cannot access document outside of the DOM");
	return e?.ownerDocument ?? document;
}
sc(dc, "getOwnerDocument");
function fc(e, t = !1) {
	let { activeElement: n } = dc(e);
	if (!n?.nodeName) return null;
	if (pc(n) && n.contentDocument) return fc(n.contentDocument.body, t);
	if (t) {
		let e = n.getAttribute("aria-activedescendant");
		if (e) {
			let t = dc(n).getElementById(e);
			if (t) return t;
		}
	}
	return n;
}
sc(fc, "getActiveElement");
function pc(e) {
	return e.tagName === "IFRAME";
}
sc(pc, "isFrame");
// node_modules/@radix-ui/react-use-effect-event/dist/index.mjs
var mc = Object.defineProperty, hc = (e, t) => mc(e, "name", {
	value: t,
	configurable: !0
}), gc = d.useEffectEvent, _c = d.useInsertionEffect;
function vc(e) {
	if (typeof gc == "function") return gc(e);
	let t = d.useRef(() => {
		throw Error("Cannot call an event handler while rendering.");
	});
	return typeof _c == "function" ? _c(() => {
		t.current = e;
	}) : ac(() => {
		t.current = e;
	}), d.useMemo(() => ((...e) => t.current?.(...e)), []);
}
hc(vc, "useEffectEvent");
// node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
var yc = Object.defineProperty, bc = (e, t) => yc(e, "name", {
	value: t,
	configurable: !0
}), xc = d.useInsertionEffect || ac;
function Sc({ prop: e, defaultProp: t, onChange: n = /* @__PURE__ */ bc(() => {}, "onChange"), caller: r }) {
	let [i, a, o] = Cc({
		defaultProp: t,
		onChange: n
	}), s = e !== void 0;
	return [s ? e : i, d.useCallback((t) => {
		if (s) {
			let n = wc(t) ? t(e) : t;
			n !== e && o.current?.(n);
		} else a(t);
	}, [
		s,
		e,
		a,
		o
	])];
}
bc(Sc, "useControllableState");
function Cc({ defaultProp: e, onChange: t }) {
	let [n, r] = d.useState(e), i = d.useRef(n), a = d.useRef(t);
	return xc(() => {
		a.current = t;
	}, [t]), d.useEffect(() => {
		i.current !== n && (a.current?.(n), i.current = n);
	}, [n, i]), [
		n,
		r,
		a
	];
}
bc(Cc, "useUncontrolledState");
function wc(e) {
	return typeof e == "function";
}
bc(wc, "isFunction");
var Tc = Symbol("RADIX:SYNC_STATE");
function Ec(e, t, n, r) {
	let { prop: i, defaultProp: a, onChange: o, caller: s } = t, c = i !== void 0, l = vc(o), u = [{
		...n,
		state: a
	}];
	r && u.push(r);
	let [f, p] = d.useReducer((t, n) => {
		if (n.type === Tc) return {
			...t,
			state: n.state
		};
		let r = e(t, n);
		return c && !Object.is(r.state, t.state) && l(r.state), r;
	}, ...u), m = f.state, h = d.useRef(m);
	d.useEffect(() => {
		h.current !== m && (h.current = m, c || l(m));
	}, [
		m,
		h,
		c
	]);
	let g = d.useMemo(() => i === void 0 ? f : {
		...f,
		state: i
	}, [f, i]);
	return d.useEffect(() => {
		c && !Object.is(i, f.state) && p({
			type: Tc,
			state: i
		});
	}, [
		i,
		f.state,
		c
	]), [g, p];
}
bc(Ec, "useControllableStateReducer");
// node_modules/@radix-ui/react-presence/dist/index.mjs
var Dc = Object.defineProperty, Oc = (e, t) => Dc(e, "name", {
	value: t,
	configurable: !0
});
function kc(e, t) {
	return d.useReducer((e, n) => t[e][n] ?? e, e);
}
Oc(kc, "useStateMachine");
var Ac = /* @__PURE__ */ Oc((e) => {
	let { present: t, children: n } = e, r = jc(t), i = typeof n == "function" ? n({ present: r.isPresent }) : d.Children.only(n), a = Nc(r.ref, Fc(i));
	return typeof n == "function" || r.isPresent ? d.cloneElement(i, { ref: a }) : null;
}, "Presence");
function jc(e) {
	let [t, n] = d.useState(), r = d.useRef(null), i = d.useRef(e), a = d.useRef("none"), o = d.useRef(void 0), [s, c] = kc(e ? "mounted" : "unmounted", {
		mounted: {
			UNMOUNT: "unmounted",
			ANIMATION_OUT: "unmountSuspended"
		},
		unmountSuspended: {
			MOUNT: "mounted",
			ANIMATION_END: "unmounted"
		},
		unmounted: { MOUNT: "mounted" }
	});
	return d.useEffect(() => {
		s === "mounted" ? (a.current = o.current ?? Pc(r.current), o.current = void 0) : a.current = "none";
	}, [s]), ac(() => {
		let t = r.current, n = i.current;
		if (n !== e) {
			let r = a.current, s = Pc(t);
			e ? (o.current = s, c("MOUNT")) : s === "none" || t?.display === "none" ? c("UNMOUNT") : c(n && r !== s ? "ANIMATION_OUT" : "UNMOUNT"), i.current = e;
		}
	}, [e, c]), ac(() => {
		if (t) {
			let e, n = t.ownerDocument.defaultView ?? window, o = /* @__PURE__ */ Oc((a) => {
				let o = Pc(r.current).includes(CSS.escape(a.animationName));
				if (a.target === t && o && (c("ANIMATION_END"), !i.current)) {
					let r = t.style.animationFillMode;
					t.style.animationFillMode = "forwards", e = n.setTimeout(() => {
						t.style.animationFillMode === "forwards" && (t.style.animationFillMode = r);
					});
				}
			}, "handleAnimationEnd"), s = /* @__PURE__ */ Oc((e) => {
				e.target === t && (a.current = Pc(r.current));
			}, "handleAnimationStart");
			return t.addEventListener("animationstart", s), t.addEventListener("animationcancel", o), t.addEventListener("animationend", o), () => {
				n.clearTimeout(e), t.removeEventListener("animationstart", s), t.removeEventListener("animationcancel", o), t.removeEventListener("animationend", o);
			};
		}
		c("ANIMATION_END");
	}, [t, c]), {
		isPresent: ["mounted", "unmountSuspended"].includes(s),
		ref: d.useCallback((e) => {
			if (e) {
				let t = getComputedStyle(e);
				r.current = t, o.current = Pc(t);
			} else r.current = null;
			n(e);
		}, [])
	};
}
Oc(jc, "usePresence");
function Mc(e, t) {
	if (typeof e == "function") return e(t);
	e != null && (e.current = t);
}
Oc(Mc, "setRef");
function Nc(...e) {
	let t = d.useRef(e);
	return t.current = e, d.useCallback((e) => {
		let n = t.current, r = !1, i = n.map((t) => {
			let n = Mc(t, e);
			return !r && typeof n == "function" && (r = !0), n;
		});
		if (r) return () => {
			for (let e = 0; e < i.length; e++) {
				let t = i[e];
				typeof t == "function" ? t() : Mc(n[e], null);
			}
		};
	}, []);
}
Oc(Nc, "useStableComposedRefs");
function Pc(e) {
	return e?.animationName || "none";
}
Oc(Pc, "getAnimationName");
function Fc(e) {
	let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning;
	return n ? e.ref : (t = Object.getOwnPropertyDescriptor(e, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning, n ? e.props.ref : e.props.ref || e.ref);
}
Oc(Fc, "getElementRef");
// node_modules/@radix-ui/react-id/dist/index.mjs
var Ic = Object.defineProperty, Lc = (e, t) => Ic(e, "name", {
	value: t,
	configurable: !0
}), Rc = d.useId || (() => void 0), zc = 0;
function Bc(e) {
	let [t, n] = d.useState(Rc());
	return ac(() => {
		e || n((e) => e ?? String(zc++));
	}, [e]), e || (t ? `radix-${t}` : "");
}
Lc(Bc, "useId");
// node_modules/@radix-ui/react-use-callback-ref/dist/index.mjs
var Vc = Object.defineProperty, Hc = (e, t) => Vc(e, "name", {
	value: t,
	configurable: !0
}), Uc = d.useInsertionEffect;
function Wc(e) {
	let t = d.useRef(e);
	return typeof Uc == "function" ? Uc(() => {
		t.current = e;
	}) : ac(() => {
		t.current = e;
	}), d.useMemo(() => ((...e) => t.current?.(...e)), []);
}
Hc(Wc, "useCallbackRef");
// node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
var Gc = Object.defineProperty, Kc = (e, t) => Gc(e, "name", {
	value: t,
	configurable: !0
}), qc = "dismissableLayer.update", Jc = "dismissableLayer.pointerDownOutside", Yc = "dismissableLayer.focusOutside", Xc, Zc = d.createContext({
	layers: /* @__PURE__ */ new Set(),
	layersWithOutsidePointerEventsDisabled: /* @__PURE__ */ new Set(),
	branches: /* @__PURE__ */ new Set(),
	dismissableSurfaces: /* @__PURE__ */ new Set()
}), Qc = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Kc(function(e, t) {
	let { disableOutsidePointerEvents: n = !1, deferPointerDownOutside: r = !1, onEscapeKeyDown: i, onPointerDownOutside: a, onFocusOutside: o, onInteractOutside: s, onDismiss: c, ...l } = e, u = d.useContext(Zc), [f, p] = d.useState(null), m = f?.ownerDocument ?? globalThis?.document, [, h] = d.useState({}), g = Ds(t, p), _ = Array.from(u.layers), [v] = [...u.layersWithOutsidePointerEventsDisabled].slice(-1), y = v ? _.indexOf(v) : -1, b = f ? _.indexOf(f) : -1, x = u.layersWithOutsidePointerEventsDisabled.size > 0, S = b >= y, C = d.useRef(!1), w = tl((e) => {
		a?.(e), s?.(e), e.defaultPrevented || c?.();
	}, {
		ownerDocument: m,
		deferPointerDownOutside: r,
		isDeferredPointerDownOutsideRef: C,
		dismissableSurfaces: u.dismissableSurfaces,
		shouldHandlePointerDownOutside: d.useCallback((e) => {
			if (!(e instanceof Node)) return !1;
			let t = [...u.branches].some((t) => t.contains(e));
			return S && !t;
		}, [u.branches, S])
	}), T = nl((e) => {
		if (r && C.current) return;
		let t = e.target;
		[...u.branches].some((e) => e.contains(t)) || (o?.(e), s?.(e), e.defaultPrevented || c?.());
	}, m), ee = f ? b === _.length - 1 : !1, E = Wc((e) => {
		e.key === "Escape" && (i?.(e), !e.defaultPrevented && c && (e.preventDefault(), c()));
	});
	return d.useEffect(() => {
		if (ee) return m.addEventListener("keydown", E, { capture: !0 }), () => m.removeEventListener("keydown", E, { capture: !0 });
	}, [
		m,
		ee,
		E
	]), d.useEffect(() => {
		if (f) return n && (u.layersWithOutsidePointerEventsDisabled.size === 0 && (Xc = m.body.style.pointerEvents, m.body.style.pointerEvents = "none"), u.layersWithOutsidePointerEventsDisabled.add(f)), u.layers.add(f), rl(), () => {
			n && (u.layersWithOutsidePointerEventsDisabled.delete(f), u.layersWithOutsidePointerEventsDisabled.size === 0 && (m.body.style.pointerEvents = Xc));
		};
	}, [
		f,
		m,
		n,
		u
	]), d.useEffect(() => () => {
		f && (u.layers.delete(f), u.layersWithOutsidePointerEventsDisabled.delete(f), rl());
	}, [f, u]), d.useEffect(() => {
		let e = /* @__PURE__ */ Kc(() => h({}), "handleUpdate");
		return document.addEventListener(qc, e), () => document.removeEventListener(qc, e);
	}, []), /* @__PURE__ */ k(Js.div, {
		...l,
		ref: g,
		style: {
			pointerEvents: x ? S ? "auto" : "none" : void 0,
			...e.style
		},
		onFocusCapture: lc(e.onFocusCapture, T.onFocusCapture),
		onBlurCapture: lc(e.onBlurCapture, T.onBlurCapture),
		onPointerDownCapture: lc(e.onPointerDownCapture, w.onPointerDownCapture)
	});
}, "DismissableLayer"));
function $c() {
	let e = d.useContext(Zc), [t, n] = d.useState(null);
	return d.useEffect(() => {
		if (t) return e.dismissableSurfaces.add(t), () => {
			e.dismissableSurfaces.delete(t);
		};
	}, [t, e.dismissableSurfaces]), n;
}
Kc($c, "useDismissableLayerSurface");
var el = /* @__PURE__ */ Kc(() => !0, "IS_TRUE");
function tl(e, t) {
	let { ownerDocument: n = globalThis?.document, deferPointerDownOutside: r = !1, isDeferredPointerDownOutsideRef: i, dismissableSurfaces: a, shouldHandlePointerDownOutside: o = el } = t, s = Wc(e), c = d.useRef(!1), l = d.useRef(!1), u = d.useRef(/* @__PURE__ */ new Map()), f = d.useRef(() => {});
	return d.useEffect(() => {
		function e() {
			l.current = !1, i.current = !1, u.current.clear();
		}
		Kc(e, "resetOutsideInteraction");
		function t() {
			return Array.from(u.current.values()).some(Boolean);
		}
		Kc(t, "isOutsideInteractionIntercepted");
		function d(e) {
			if (!l.current) return;
			let t = e.target;
			t instanceof Node && [...a].some((e) => e.contains(t)) || u.current.set(e.type, !0), e.type === "click" && window.setTimeout(() => {
				l.current && f.current();
			}, 0);
		}
		Kc(d, "handleInteractionCapture");
		function p(e) {
			l.current && u.current.set(e.type, !1);
		}
		Kc(p, "handleInteractionBubble");
		let m = /* @__PURE__ */ Kc((a) => {
			if (a.target && !c.current) {
				let d = function() {
					n.removeEventListener("click", f.current);
					let r = t();
					e(), r || il(Jc, s, p, { discrete: !0 });
				};
				if (Kc(d, "handleAndDispatchPointerDownOutsideEvent"), !o(a.target)) {
					n.removeEventListener("click", f.current), e(), c.current = !1;
					return;
				}
				let p = { originalEvent: a };
				l.current = !0, i.current = r && a.button === 0, u.current.clear(), !r || a.button !== 0 ? d() : (n.removeEventListener("click", f.current), f.current = d, n.addEventListener("click", f.current, { once: !0 }));
			} else n.removeEventListener("click", f.current), e();
			c.current = !1;
		}, "handlePointerDown"), h = [
			"pointerup",
			"mousedown",
			"mouseup",
			"touchstart",
			"touchend",
			"click"
		];
		for (let e of h) n.addEventListener(e, d, !0), n.addEventListener(e, p);
		let g = window.setTimeout(() => {
			n.addEventListener("pointerdown", m);
		}, 0);
		return () => {
			window.clearTimeout(g), n.removeEventListener("pointerdown", m), n.removeEventListener("click", f.current);
			for (let e of h) n.removeEventListener(e, d, !0), n.removeEventListener(e, p);
		};
	}, [
		n,
		s,
		r,
		i,
		a,
		o
	]), { onPointerDownCapture: /* @__PURE__ */ Kc(() => c.current = !0, "onPointerDownCapture") };
}
Kc(tl, "usePointerDownOutside");
function nl(e, t = globalThis?.document) {
	let n = Wc(e), r = d.useRef(!1);
	return d.useEffect(() => {
		let e = /* @__PURE__ */ Kc((e) => {
			e.target && !r.current && il(Yc, n, { originalEvent: e }, { discrete: !1 });
		}, "handleFocus");
		return t.addEventListener("focusin", e), () => t.removeEventListener("focusin", e);
	}, [t, n]), {
		onFocusCapture: /* @__PURE__ */ Kc(() => r.current = !0, "onFocusCapture"),
		onBlurCapture: /* @__PURE__ */ Kc(() => r.current = !1, "onBlurCapture")
	};
}
Kc(nl, "useFocusOutside");
function rl() {
	let e = new CustomEvent(qc);
	document.dispatchEvent(e);
}
Kc(rl, "dispatchUpdate");
function il(e, t, n, { discrete: r }) {
	let i = n.originalEvent.target, a = new CustomEvent(e, {
		bubbles: !1,
		cancelable: !0,
		detail: n
	});
	t && i.addEventListener(e, t, { once: !0 }), r ? Ys(i, a) : i.dispatchEvent(a);
}
Kc(il, "handleAndDispatchCustomEvent");
// node_modules/@radix-ui/react-focus-scope/dist/index.mjs
var al = Object.defineProperty, ol = (e, t) => al(e, "name", {
	value: t,
	configurable: !0
}), sl = "focusScope.autoFocusOnMount", cl = "focusScope.autoFocusOnUnmount", ll = {
	bubbles: !1,
	cancelable: !0
}, ul = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ ol(function(e, t) {
	let { loop: n = !1, trapped: r = !1, branches: i, onMountAutoFocus: a, onUnmountAutoFocus: o, ...s } = e, [c, l] = d.useState(null), u = Wc(a), f = Wc(o), p = d.useRef(null), m = Ds(t, l), h = d.useRef(i);
	d.useEffect(() => {
		h.current = i;
	});
	let g = d.useCallback((e) => e ? c?.contains(e) ? !0 : !!h.current?.some((t) => t.contains(e)) : !1, [c]), _ = d.useRef({
		paused: !1,
		pause() {
			this.paused = !0;
		},
		resume() {
			this.paused = !1;
		}
	}).current;
	d.useEffect(() => {
		if (r) {
			let e = function(e) {
				if (_.paused || !c) return;
				let t = e.target;
				g(t) ? p.current = t : xl(p.current, { select: !0 });
			}, t = function(e) {
				if (_.paused || !c) return;
				let t = e.relatedTarget;
				t !== null && (g(t) || xl(p.current, { select: !0 }));
			}, n = function(e) {
				if (document.activeElement === document.body) for (let t of e) t.removedNodes.length > 0 && xl(c);
			};
			ol(e, "handleFocusIn"), ol(t, "handleFocusOut"), ol(n, "handleMutations"), document.addEventListener("focusin", e), document.addEventListener("focusout", t);
			let r = new MutationObserver(n);
			return c && r.observe(c, {
				childList: !0,
				subtree: !0
			}), () => {
				document.removeEventListener("focusin", e), document.removeEventListener("focusout", t), r.disconnect();
			};
		}
	}, [
		r,
		c,
		_.paused,
		g
	]), d.useEffect(() => {
		if (c) {
			Sl.add(_);
			let e = document.activeElement;
			if (!c.contains(e)) {
				let t = new CustomEvent(sl, ll);
				c.addEventListener(sl, u), c.dispatchEvent(t), t.defaultPrevented || (hl(Tl(_l(c)), { select: !0 }), document.activeElement === e && xl(c));
			}
			return () => {
				c.removeEventListener(sl, u);
				let t = c.ownerDocument, n = CustomEvent;
				setTimeout(() => {
					let r = new n(cl, ll);
					c.addEventListener(cl, f), c.dispatchEvent(r), r.defaultPrevented || xl(e ?? t.body, { select: !0 }), c.removeEventListener(cl, f), Sl.remove(_);
				}, 0);
			};
		}
	}, [
		c,
		u,
		f,
		_
	]);
	let v = d.useCallback((e) => {
		if (!n && !r || _.paused) return;
		let t = e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey, i = document.activeElement;
		if (t && i) {
			let t = e.currentTarget, [r, a] = gl(t);
			r && a ? !e.shiftKey && i === a ? (e.preventDefault(), n && xl(r, { select: !0 })) : e.shiftKey && i === r && (e.preventDefault(), n && xl(a, { select: !0 })) : i === t && e.preventDefault();
		}
	}, [
		n,
		r,
		_.paused
	]);
	return /* @__PURE__ */ k(Js.div, {
		tabIndex: -1,
		...s,
		ref: m,
		onKeyDown: v
	});
}, "FocusScope")), dl = d.createContext(null);
function fl({ registry: e, children: t }) {
	return e ? /* @__PURE__ */ k(dl.Provider, {
		value: e,
		children: t
	}) : t;
}
ol(fl, "FocusScopeBranchProvider");
function pl() {
	let [e, t] = d.useState([]);
	return {
		nodes: e,
		registry: d.useMemo(() => ({
			add: /* @__PURE__ */ ol((e) => t((t) => t.includes(e) ? t : [...t, e]), "add"),
			remove: /* @__PURE__ */ ol((e) => t((t) => t.filter((t) => t !== e)), "remove")
		}), [])
	};
}
ol(pl, "useFocusScopeBranchRegistry");
function ml(e) {
	let t = d.useContext(dl);
	d.useEffect(() => {
		if (e && t) return t.add(e), () => t.remove(e);
	}, [e, t]);
}
ol(ml, "useFocusScopeBranch");
function hl(e, { select: t = !1 } = {}) {
	let n = document.activeElement;
	for (let r of e) if (xl(r, { select: t }), document.activeElement !== n) return;
}
ol(hl, "focusFirst");
function gl(e) {
	let t = _l(e);
	return [vl(t, e), vl(t.reverse(), e)];
}
ol(gl, "getTabbableEdges");
function _l(e) {
	let t = [], n = e.ownerDocument.createTreeWalker(e, NodeFilter.SHOW_ELEMENT, { acceptNode: /* @__PURE__ */ ol((e) => {
		let t = e.tagName === "INPUT" && e.type === "hidden";
		return e.disabled || e.hidden || t ? NodeFilter.FILTER_SKIP : e.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
	}, "acceptNode") });
	for (; n.nextNode();) t.push(n.currentNode);
	return t;
}
ol(_l, "getTabbableCandidates");
function vl(e, t) {
	let n = typeof t.checkVisibility == "function" && t.checkVisibility({ checkVisibilityCSS: !0 });
	for (let r of e) if (!(n ? !r.checkVisibility({ checkVisibilityCSS: !0 }) : yl(r, { upTo: t }))) return r;
}
ol(vl, "findVisible");
function yl(e, { upTo: t }) {
	if (getComputedStyle(e).visibility === "hidden") return !0;
	for (; e;) {
		if (t !== void 0 && e === t) return !1;
		if (getComputedStyle(e).display === "none") return !0;
		e = e.parentElement;
	}
	return !1;
}
ol(yl, "isHidden");
function bl(e) {
	return e.tagName === "INPUT" && typeof e.select == "function";
}
ol(bl, "isSelectableInput");
function xl(e, { select: t = !1 } = {}) {
	if (e && e.focus) {
		let n = (e.ownerDocument ?? document).activeElement;
		e.focus({ preventScroll: !0 }), e !== n && bl(e) && t && e.select();
	}
}
ol(xl, "focus");
var Sl = Cl();
function Cl() {
	let e = [];
	return {
		add(t) {
			let n = e[0];
			t !== n && n?.pause(), e = wl(e, t), e.unshift(t);
		},
		remove(t) {
			e = wl(e, t), e[0]?.resume();
		}
	};
}
ol(Cl, "createFocusScopesStack");
function wl(e, t) {
	let n = [...e], r = n.indexOf(t);
	return r !== -1 && n.splice(r, 1), n;
}
ol(wl, "arrayRemove");
function Tl(e) {
	return e.filter((e) => e.tagName !== "A");
}
ol(Tl, "removeLinks");
// node_modules/@radix-ui/react-portal/dist/index.mjs
var El = Object.defineProperty, Dl = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ ((e, t) => El(e, "name", {
	value: t,
	configurable: !0
}))(function(e, t) {
	let { container: n, ...r } = e, [i, a] = d.useState(!1);
	ac(() => a(!0), []);
	let o = n || i && globalThis?.document?.body;
	return o ? ie.createPortal(/* @__PURE__ */ k(Js.div, {
		...r,
		ref: t
	}), o) : null;
}, "Portal")), Ol = Object.defineProperty, kl = (e, t) => Ol(e, "name", {
	value: t,
	configurable: !0
}), Al = 0, jl = null;
function Ml(e) {
	return Nl(), e.children;
}
kl(Ml, "FocusGuards");
function Nl() {
	d.useEffect(() => {
		jl ||= {
			start: Pl(),
			end: Pl()
		};
		let { start: e, end: t } = jl;
		return document.body.firstElementChild !== e && document.body.insertAdjacentElement("afterbegin", e), document.body.lastElementChild !== t && document.body.insertAdjacentElement("beforeend", t), Al++, () => {
			Al === 1 && (jl?.start.remove(), jl?.end.remove(), jl = null), Al = Math.max(0, Al - 1);
		};
	}, []);
}
kl(Nl, "useFocusGuards");
function Pl() {
	let e = document.createElement("span");
	return e.setAttribute("data-radix-focus-guard", ""), e.tabIndex = 0, e.style.outline = "none", e.style.opacity = "0", e.style.position = "fixed", e.style.pointerEvents = "none", e;
}
kl(Pl, "createFocusGuard");
// src/app/ui/radix-modal-stub.ts
function Fl(e) {
	throw Error(`${e} belongs to Radix's modal mode: keep the primitive non-modal and let the presentation layer stack lock scrolling and inert the background.`);
}
function Il() {
	return Fl("RemoveScroll");
}
function Ll() {
	return Fl("hideOthers");
}
// node_modules/@radix-ui/react-dialog/dist/index.mjs
var Rl = Object.defineProperty, zl = (e, t) => Rl(e, "name", {
	value: t,
	configurable: !0
}), Bl = "Dialog", [Vl, Hl] = /* @__PURE__ */ rc(Bl), [Ul, Wl] = Vl(Bl), Gl = /* @__PURE__ */ zl((e) => {
	let { __scopeDialog: t, children: n, open: r, defaultOpen: i, onOpenChange: a, modal: o = !0 } = e, s = d.useRef(null), c = d.useRef(null), { nodes: l, registry: u } = pl(), [f, p] = Sc({
		prop: r,
		defaultProp: i ?? !1,
		onChange: a,
		caller: Bl
	}), [m, h] = d.useState(0), [g, _] = d.useState(0);
	return /* @__PURE__ */ k(Ul, {
		scope: t,
		triggerRef: s,
		contentRef: c,
		contentId: Bc(),
		titleId: Bc(),
		descriptionId: Bc(),
		titlePresent: m > 0,
		descriptionPresent: g > 0,
		setTitleCount: h,
		setDescriptionCount: _,
		open: f,
		onOpenChange: p,
		onOpenToggle: d.useCallback(() => p((e) => !e), [p]),
		modal: o,
		branchNodes: l,
		branchRegistry: u,
		children: n
	});
}, "Dialog"), Kl = "DialogPortal", [ql, Jl] = Vl(Kl, { forceMount: void 0 }), Yl = /* @__PURE__ */ zl((e) => {
	let { __scopeDialog: t, forceMount: n, children: r, container: i } = e, a = Wl(Kl, t);
	return /* @__PURE__ */ k(ql, {
		scope: t,
		forceMount: n,
		children: d.Children.map(r, (e) => /* @__PURE__ */ k(Ac, {
			present: n || a.open,
			children: /* @__PURE__ */ k(Dl, {
				asChild: !0,
				container: i,
				children: e
			})
		}))
	});
}, "DialogPortal"), Xl = "DialogContent", Zl = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ zl(function(e, t) {
	let n = Jl(Xl, e.__scopeDialog), { forceMount: r = n.forceMount, ...i } = e, a = Wl(Xl, e.__scopeDialog);
	return /* @__PURE__ */ k(Ac, {
		present: r || a.open,
		children: a.modal ? /* @__PURE__ */ k(Ql, {
			...i,
			ref: t
		}) : /* @__PURE__ */ k($l, {
			...i,
			ref: t
		})
	});
}, "DialogContent")), Ql = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ zl(function(e, t) {
	let n = Wl(Xl, e.__scopeDialog), r = d.useRef(null), i = Ds(t, n.contentRef, r);
	return d.useEffect(() => {
		let e = r.current;
		if (e) return Ll(e);
	}, []), /* @__PURE__ */ k(eu, {
		...e,
		ref: i,
		trapFocus: n.open,
		disableOutsidePointerEvents: n.open,
		onCloseAutoFocus: lc(e.onCloseAutoFocus, (e) => {
			e.preventDefault(), n.triggerRef.current?.focus();
		}),
		onPointerDownOutside: lc(e.onPointerDownOutside, (e) => {
			let t = e.detail.originalEvent, n = t.button === 0 && t.ctrlKey === !0;
			(t.button === 2 || n) && e.preventDefault();
		}),
		onFocusOutside: lc(e.onFocusOutside, (e) => e.preventDefault())
	});
}, "DialogContentModal")), $l = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ zl(function(e, t) {
	let n = Wl(Xl, e.__scopeDialog), r = d.useRef(!1), i = d.useRef(!1);
	return /* @__PURE__ */ k(eu, {
		...e,
		ref: t,
		trapFocus: !1,
		disableOutsidePointerEvents: !1,
		onCloseAutoFocus: (t) => {
			e.onCloseAutoFocus?.(t), t.defaultPrevented || (r.current || n.triggerRef.current?.focus(), t.preventDefault()), r.current = !1, i.current = !1;
		},
		onInteractOutside: (t) => {
			e.onInteractOutside?.(t), t.defaultPrevented || (r.current = !0, t.detail.originalEvent.type === "pointerdown" && (i.current = !0));
			let a = t.target;
			n.triggerRef.current?.contains(a) && t.preventDefault(), t.detail.originalEvent.type === "focusin" && i.current && t.preventDefault();
		}
	});
}, "DialogContentNonModal")), eu = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ zl(function(e, t) {
	let { __scopeDialog: n, trapFocus: r, onOpenAutoFocus: i, onCloseAutoFocus: a, "aria-describedby": o, children: s, ...c } = e, l = Wl(Xl, n);
	return Nl(), /* @__PURE__ */ k(fl, {
		registry: l.branchRegistry,
		children: /* @__PURE__ */ k(ul, {
			asChild: !0,
			loop: !0,
			trapped: r,
			branches: l.branchNodes,
			onMountAutoFocus: i,
			onUnmountAutoFocus: a,
			children: /* @__PURE__ */ k(Qc, {
				role: "dialog",
				id: l.contentId,
				"aria-labelledby": l.titlePresent ? l.titleId : void 0,
				"aria-describedby": l.descriptionPresent ? ru(o, l.descriptionId) : o,
				"data-state": iu(l.open),
				...c,
				ref: t,
				deferPointerDownOutside: !0,
				onDismiss: () => l.onOpenChange(!1),
				children: s
			})
		})
	});
}, "DialogContentImpl")), tu = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ zl(function(e, t) {
	let { __scopeDialog: n, ...r } = e, i = Wl("DialogTitle", n), { setTitleCount: a } = i;
	return ac(() => (a((e) => e + 1), () => a((e) => e - 1)), [a]), /* @__PURE__ */ k(Js.h2, {
		id: i.titleId,
		...r,
		ref: t
	});
}, "DialogTitle")), nu = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ zl(function(e, t) {
	let { __scopeDialog: n, ...r } = e, i = Wl("DialogDescription", n), { setDescriptionCount: a } = i;
	return ac(() => (a((e) => e + 1), () => a((e) => e - 1)), [a]), /* @__PURE__ */ k(Js.p, {
		id: i.descriptionId,
		...r,
		ref: t
	});
}, "DialogDescription"));
function ru(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
zl(ru, "concatAriaDescribedby");
function iu(e) {
	return e ? "open" : "closed";
}
zl(iu, "getState");
// node_modules/@radix-ui/react-use-size/dist/index.mjs
var au = Object.defineProperty, ou = (e, t) => au(e, "name", {
	value: t,
	configurable: !0
});
function su(e) {
	let [t, n] = d.useState(void 0);
	return ac(() => {
		if (e) {
			n({
				width: e.offsetWidth,
				height: e.offsetHeight
			});
			let t = 0, r = new ResizeObserver((r) => {
				if (!Array.isArray(r) || !r.length) return;
				let i = r[0];
				window.cancelAnimationFrame(t), t = window.requestAnimationFrame(() => {
					let t, r;
					if ("borderBoxSize" in i) {
						let e = i.borderBoxSize, n = Array.isArray(e) ? e[0] : e;
						t = n.inlineSize, r = n.blockSize;
					} else t = e.offsetWidth, r = e.offsetHeight;
					n({
						width: t,
						height: r
					});
				});
			});
			return r.observe(e, { box: "border-box" }), () => {
				window.cancelAnimationFrame(t), r.unobserve(e);
			};
		}
		n(void 0);
	}, [e]), t;
}
ou(su, "useSize");
// node_modules/@floating-ui/utils/dist/floating-ui.utils.mjs
var cu = [
	"top",
	"right",
	"bottom",
	"left"
], lu = Math.min, uu = Math.max, du = Math.round, fu = Math.floor, pu = (e) => ({
	x: e,
	y: e
}), mu = {
	left: "right",
	right: "left",
	bottom: "top",
	top: "bottom"
};
function hu(e, t, n) {
	return uu(e, lu(t, n));
}
function gu(e, t) {
	return typeof e == "function" ? e(t) : e;
}
function _u(e) {
	return e.split("-")[0];
}
function vu(e) {
	return e.split("-")[1];
}
function yu(e) {
	return e === "x" ? "y" : "x";
}
function bu(e) {
	return e === "y" ? "height" : "width";
}
function xu(e) {
	let t = e[0];
	return t === "t" || t === "b" ? "y" : "x";
}
function Su(e) {
	return yu(xu(e));
}
function Cu(e, t, n) {
	n === void 0 && (n = !1);
	let r = vu(e), i = Su(e), a = bu(i), o = i === "x" ? r === (n ? "end" : "start") ? "right" : "left" : r === "start" ? "bottom" : "top";
	return t.reference[a] > t.floating[a] && (o = Mu(o)), [o, Mu(o)];
}
function wu(e) {
	let t = Mu(e);
	return [
		Tu(e),
		t,
		Tu(t)
	];
}
function Tu(e) {
	return e.includes("start") ? e.replace("start", "end") : e.replace("end", "start");
}
var Eu = ["left", "right"], Du = ["right", "left"], Ou = ["top", "bottom"], ku = ["bottom", "top"];
function Au(e, t, n) {
	switch (e) {
		case "top":
		case "bottom": return n ? t ? Du : Eu : t ? Eu : Du;
		case "left":
		case "right": return t ? Ou : ku;
		default: return [];
	}
}
function ju(e, t, n, r) {
	let i = vu(e), a = Au(_u(e), n === "start", r);
	return i && (a = a.map((e) => e + "-" + i), t && (a = a.concat(a.map(Tu)))), a;
}
function Mu(e) {
	let t = _u(e);
	return mu[t] + e.slice(t.length);
}
function Nu(e) {
	return {
		top: e.top ?? 0,
		right: e.right ?? 0,
		bottom: e.bottom ?? 0,
		left: e.left ?? 0
	};
}
function Pu(e) {
	return typeof e == "number" ? {
		top: e,
		right: e,
		bottom: e,
		left: e
	} : Nu(e);
}
function Fu(e) {
	let { x: t, y: n, width: r, height: i } = e;
	return {
		width: r,
		height: i,
		top: n,
		left: t,
		right: t + r,
		bottom: n + i,
		x: t,
		y: n
	};
}
// node_modules/@floating-ui/core/dist/floating-ui.core.mjs
function Iu(e, t, n) {
	let { reference: r, floating: i } = e, a = xu(t), o = Su(t), s = bu(o), c = _u(t), l = a === "y", u = r.x + r.width / 2 - i.width / 2, d = r.y + r.height / 2 - i.height / 2, f = r[s] / 2 - i[s] / 2, p;
	switch (c) {
		case "top":
			p = {
				x: u,
				y: r.y - i.height
			};
			break;
		case "bottom":
			p = {
				x: u,
				y: r.y + r.height
			};
			break;
		case "right":
			p = {
				x: r.x + r.width,
				y: d
			};
			break;
		case "left":
			p = {
				x: r.x - i.width,
				y: d
			};
			break;
		default: p = {
			x: r.x,
			y: r.y
		};
	}
	let m = vu(t);
	return m && (p[o] += f * (m === "end" ? 1 : -1) * (n && l ? -1 : 1)), p;
}
async function Lu(e, t) {
	t === void 0 && (t = {});
	let { x: n, y: r, platform: i, rects: a, elements: o, strategy: s } = e, { boundary: c = "clippingAncestors", rootBoundary: l = "viewport", elementContext: u = "floating", altBoundary: d = !1, padding: f = 0 } = gu(t, e), p = Pu(f), m = o[d ? u === "floating" ? "reference" : "floating" : u], h = Fu(await i.getClippingRect({
		element: await (i.isElement == null ? void 0 : i.isElement(m)) ?? !0 ? m : m.contextElement || await (i.getDocumentElement == null ? void 0 : i.getDocumentElement(o.floating)),
		boundary: c,
		rootBoundary: l,
		strategy: s
	})), g = u === "floating" ? {
		x: n,
		y: r,
		width: a.floating.width,
		height: a.floating.height
	} : a.reference, _ = await (i.getOffsetParent == null ? void 0 : i.getOffsetParent(o.floating)), v = await (i.isElement == null ? void 0 : i.isElement(_)) && await (i.getScale == null ? void 0 : i.getScale(_)) || {
		x: 1,
		y: 1
	}, y = Fu(i.convertOffsetParentRelativeRectToViewportRelativeRect ? await i.convertOffsetParentRelativeRectToViewportRelativeRect({
		elements: o,
		rect: g,
		offsetParent: _,
		strategy: s
	}) : g);
	return {
		top: (h.top - y.top + p.top) / v.y,
		bottom: (y.bottom - h.bottom + p.bottom) / v.y,
		left: (h.left - y.left + p.left) / v.x,
		right: (y.right - h.right + p.right) / v.x
	};
}
var Ru = 50, zu = async (e, t, n) => {
	let { placement: r = "bottom", strategy: i = "absolute", middleware: a = [], platform: o } = n, s = o.detectOverflow ? o : {
		...o,
		detectOverflow: Lu
	}, c = await (o.isRTL == null ? void 0 : o.isRTL(t)), l = await o.getElementRects({
		reference: e,
		floating: t,
		strategy: i
	}), { x: u, y: d } = Iu(l, r, c), f = r, p = 0, m = {};
	for (let n = 0; n < a.length; n++) {
		let h = a[n];
		if (!h) continue;
		let { name: g, fn: _ } = h, { x: v, y, data: b, reset: x } = await _({
			x: u,
			y: d,
			initialPlacement: r,
			placement: f,
			strategy: i,
			middlewareData: m,
			rects: l,
			platform: s,
			elements: {
				reference: e,
				floating: t
			}
		});
		u = v ?? u, d = y ?? d, m[g] = {
			...m[g],
			...b
		}, x && p < Ru && (p++, typeof x == "object" && (x.placement && (f = x.placement), x.rects && (l = x.rects === !0 ? await o.getElementRects({
			reference: e,
			floating: t,
			strategy: i
		}) : x.rects), {x: u, y: d} = Iu(l, f, c)), n = -1);
	}
	return {
		x: u,
		y: d,
		placement: f,
		strategy: i,
		middlewareData: m
	};
}, Bu = (e) => ({
	name: "arrow",
	options: e,
	async fn(t) {
		let { x: n, y: r, placement: i, rects: a, platform: o, elements: s, middlewareData: c } = t, { element: l, padding: u = 0 } = gu(e, t) || {};
		if (l == null) return {};
		let d = Pu(u), f = {
			x: n,
			y: r
		}, p = Su(i), m = bu(p), h = await o.getDimensions(l), g = p === "y", _ = g ? "top" : "left", v = g ? "bottom" : "right", y = g ? "clientHeight" : "clientWidth", b = a.reference[m] + a.reference[p] - f[p] - a.floating[m], x = f[p] - a.reference[p], S = await (o.getOffsetParent == null ? void 0 : o.getOffsetParent(l)), C = S ? S[y] : 0;
		C && await (o.isElement == null ? void 0 : o.isElement(S)) || (C = s.floating[y] || a.floating[m]);
		let w = b / 2 - x / 2, T = C / 2 - h[m] / 2 - 1, ee = lu(d[_], T), E = lu(d[v], T), te = C - h[m] - E, D = C / 2 - h[m] / 2 + w, O = hu(ee, D, te), ne = !c.arrow && vu(i) != null && D !== O && a.reference[m] / 2 - (D < ee ? ee : E) - h[m] / 2 < 0, k = ne ? D < ee ? D - ee : D - te : 0;
		return {
			[p]: f[p] + k,
			data: {
				[p]: O,
				centerOffset: D - O - k,
				...ne && { alignmentOffset: k }
			},
			reset: ne
		};
	}
}), Vu = function(e) {
	return e === void 0 && (e = {}), {
		name: "flip",
		options: e,
		async fn(t) {
			var n;
			let { placement: r, middlewareData: i, rects: a, initialPlacement: o, platform: s, elements: c } = t, { mainAxis: l = !0, crossAxis: u = !0, fallbackPlacements: d, fallbackStrategy: f = "bestFit", fallbackAxisSideDirection: p = "none", flipAlignment: m = !0, ...h } = gu(e, t);
			if ((n = i.arrow) != null && n.alignmentOffset) return {};
			let g = _u(r), _ = xu(o), v = _u(o) === o, y = await (s.isRTL == null ? void 0 : s.isRTL(c.floating)), b = d || (v || !m ? [Mu(o)] : wu(o)), x = p !== "none";
			!d && x && b.push(...ju(o, m, p, y));
			let S = [o, ...b], C = await s.detectOverflow(t, h), w = [], T = i.flip?.overflows || [];
			if (l && w.push(C[g]), u) {
				let e = Cu(r, a, y);
				w.push(C[e[0]], C[e[1]]);
			}
			if (T = [...T, {
				placement: r,
				overflows: w
			}], !w.every((e) => e <= 0)) {
				let e = (i.flip?.index || 0) + 1, t = S[e];
				if (t && (u !== "alignment" || _ === xu(t) || T.every((e) => xu(e.placement) !== _ || e.overflows[0] > 0))) return {
					data: {
						index: e,
						overflows: T
					},
					reset: { placement: t }
				};
				let n = T.filter((e) => e.overflows[0] <= 0).sort((e, t) => e.overflows[1] - t.overflows[1])[0]?.placement;
				if (!n) switch (f) {
					case "bestFit": {
						let e = T.filter((e) => {
							if (x) {
								let t = xu(e.placement);
								return t === _ || t === "y";
							}
							return !0;
						}).map((e) => [e.placement, e.overflows.filter((e) => e > 0).reduce((e, t) => e + t, 0)]).sort((e, t) => e[1] - t[1])[0]?.[0];
						e && (n = e);
						break;
					}
					case "initialPlacement": n = o;
				}
				if (r !== n) return { reset: { placement: n } };
			}
			return {};
		}
	};
};
function Hu(e, t) {
	return {
		top: e.top - t.height,
		right: e.right - t.width,
		bottom: e.bottom - t.height,
		left: e.left - t.width
	};
}
function Uu(e) {
	return cu.some((t) => e[t] >= 0);
}
var Wu = function(e) {
	return e === void 0 && (e = {}), {
		name: "hide",
		options: e,
		async fn(t) {
			let { rects: n, platform: r } = t, { strategy: i = "referenceHidden", ...a } = gu(e, t);
			switch (i) {
				case "referenceHidden": {
					let e = Hu(await r.detectOverflow(t, {
						...a,
						elementContext: "reference"
					}), n.reference);
					return { data: {
						referenceHiddenOffsets: e,
						referenceHidden: Uu(e)
					} };
				}
				case "escaped": {
					let e = Hu(await r.detectOverflow(t, {
						...a,
						altBoundary: !0
					}), n.floating);
					return { data: {
						escapedOffsets: e,
						escaped: Uu(e)
					} };
				}
				default: return {};
			}
		}
	};
}, Gu = /*#__PURE__*/ new Set(["left", "top"]);
async function Ku(e, t) {
	let { placement: n, platform: r, elements: i } = e, a = await (r.isRTL == null ? void 0 : r.isRTL(i.floating)), o = _u(n), s = vu(n), c = xu(n) === "y", l = Gu.has(o) ? -1 : 1, u = a && c ? -1 : 1, d = gu(t, e), { mainAxis: f, crossAxis: p, alignmentAxis: m } = typeof d == "number" ? {
		mainAxis: d,
		crossAxis: 0,
		alignmentAxis: null
	} : {
		mainAxis: d.mainAxis || 0,
		crossAxis: d.crossAxis || 0,
		alignmentAxis: d.alignmentAxis
	};
	return s && typeof m == "number" && (p = s === "end" ? m * -1 : m), c ? {
		x: p * u,
		y: f * l
	} : {
		x: f * l,
		y: p * u
	};
}
var qu = function(e) {
	return e === void 0 && (e = 0), {
		name: "offset",
		options: e,
		async fn(t) {
			var n;
			let { x: r, y: i, placement: a, middlewareData: o } = t, s = await Ku(t, e);
			return a === o.offset?.placement && (n = o.arrow) != null && n.alignmentOffset ? {} : {
				x: r + s.x,
				y: i + s.y,
				data: {
					...s,
					placement: a
				}
			};
		}
	};
}, Ju = function(e) {
	return e === void 0 && (e = {}), {
		name: "shift",
		options: e,
		async fn(t) {
			let { x: n, y: r, placement: i, platform: a } = t, { mainAxis: o = !0, crossAxis: s = !1, limiter: c = { fn: (e) => {
				let { x: t, y: n } = e;
				return {
					x: t,
					y: n
				};
			} }, ...l } = gu(e, t), u = {
				x: n,
				y: r
			}, d = await a.detectOverflow(t, l), f = xu(i), p = yu(f), m = u[p], h = u[f], g = (e, t) => hu(t + d[e === "y" ? "top" : "left"], t, t - d[e === "y" ? "bottom" : "right"]);
			o && (m = g(p, m)), s && (h = g(f, h));
			let _ = c.fn({
				...t,
				[p]: m,
				[f]: h
			});
			return {
				..._,
				data: {
					x: _.x - n,
					y: _.y - r,
					enabled: {
						[p]: o,
						[f]: s
					}
				}
			};
		}
	};
}, Yu = function(e) {
	return e === void 0 && (e = {}), {
		options: e,
		fn(t) {
			let { x: n, y: r, placement: i, rects: a, middlewareData: o } = t, { offset: s = 0, mainAxis: c = !0, crossAxis: l = !0 } = gu(e, t), u = {
				x: n,
				y: r
			}, d = xu(i), f = yu(d), p = u[f], m = u[d], h = gu(s, t), g = typeof h == "number" ? {
				mainAxis: h,
				crossAxis: 0
			} : {
				mainAxis: h.mainAxis ?? 0,
				crossAxis: h.crossAxis ?? 0
			};
			if (c) {
				let e = f === "y" ? "height" : "width", t = a.reference[f] - a.floating[e] + g.mainAxis, n = a.reference[f] + a.reference[e] - g.mainAxis;
				p < t ? p = t : p > n && (p = n);
			}
			if (l) {
				let e = f === "y" ? "width" : "height", t = Gu.has(_u(i)), n = a.reference[d] - a.floating[e] + (t && o.offset?.[d] || 0) + (t ? 0 : g.crossAxis), r = a.reference[d] + a.reference[e] + (t ? 0 : o.offset?.[d] || 0) - (t ? g.crossAxis : 0);
				m < n ? m = n : m > r && (m = r);
			}
			return {
				[f]: p,
				[d]: m
			};
		}
	};
}, Xu = function(e) {
	return e === void 0 && (e = {}), {
		name: "size",
		options: e,
		async fn(t) {
			let { placement: n, rects: r, platform: i, elements: a } = t, { apply: o = () => {}, ...s } = gu(e, t), c = await i.detectOverflow(t, s), l = _u(n), u = vu(n), d = xu(n) === "y", { width: f, height: p } = r.floating, m, h;
			l === "top" || l === "bottom" ? (m = l, h = u === (await (i.isRTL == null ? void 0 : i.isRTL(a.floating)) ? "start" : "end") ? "left" : "right") : (h = l, m = u === "end" ? "top" : "bottom");
			let g = p - c.top - c.bottom, _ = f - c.left - c.right, v = lu(p - c[m], g), y = lu(f - c[h], _), b = t.middlewareData.shift, x = !b, S = v, C = y;
			b != null && b.enabled.x && (C = _), b != null && b.enabled.y && (S = g), x && !u && (d ? C = f - 2 * uu(c.left, c.right) : S = p - 2 * uu(c.top, c.bottom)), await o({
				...t,
				availableWidth: C,
				availableHeight: S
			});
			let w = await i.getDimensions(a.floating);
			return f !== w.width || p !== w.height ? { reset: { rects: !0 } } : {};
		}
	};
};
// node_modules/@floating-ui/utils/dist/floating-ui.utils.dom.mjs
function Zu() {
	return typeof window < "u";
}
function Qu(e) {
	return td(e) ? (e.nodeName || "").toLowerCase() : "#document";
}
function $u(e) {
	var t;
	return (e == null || (t = e.ownerDocument) == null ? void 0 : t.defaultView) || window;
}
function ed(e) {
	return ((td(e) ? e.ownerDocument : e.document) || window.document)?.documentElement;
}
function td(e) {
	return Zu() ? e instanceof Node || e instanceof $u(e).Node : !1;
}
function nd(e) {
	return Zu() ? e instanceof Element || e instanceof $u(e).Element : !1;
}
function rd(e) {
	return Zu() ? e instanceof HTMLElement || e instanceof $u(e).HTMLElement : !1;
}
function id(e) {
	return !Zu() || typeof ShadowRoot > "u" ? !1 : e instanceof ShadowRoot || e instanceof $u(e).ShadowRoot;
}
function ad(e) {
	let { overflow: t, overflowX: n, overflowY: r, display: i } = gd(e);
	return /auto|scroll|overlay|hidden|clip/.test(t + r + n) && i !== "inline" && i !== "contents";
}
function od(e) {
	return /^(table|td|th)$/.test(Qu(e));
}
function sd(e) {
	try {
		if (e.matches(":popover-open")) return !0;
	} catch {}
	try {
		return e.matches(":modal");
	} catch {
		return !1;
	}
}
var cd = /transform|translate|scale|rotate|perspective|filter/, ld = /paint|layout|strict|content/, ud = (e) => !!e && e !== "none", dd;
function fd(e) {
	let t = nd(e) ? gd(e) : e;
	return ud(t.transform) || ud(t.translate) || ud(t.scale) || ud(t.rotate) || ud(t.perspective) || !md() && (ud(t.backdropFilter) || ud(t.filter)) || cd.test(t.willChange || "") || ld.test(t.contain || "");
}
function pd(e) {
	let t = vd(e);
	for (; rd(t) && !hd(t);) {
		if (fd(t)) return t;
		if (sd(t)) return null;
		t = vd(t);
	}
	return null;
}
function md() {
	return dd ??= typeof CSS < "u" && CSS.supports && CSS.supports("-webkit-backdrop-filter", "none"), dd;
}
function hd(e) {
	return /^(html|body|#document)$/.test(Qu(e));
}
function gd(e) {
	return $u(e).getComputedStyle(e);
}
function _d(e) {
	return nd(e) ? {
		scrollLeft: e.scrollLeft,
		scrollTop: e.scrollTop
	} : {
		scrollLeft: e.scrollX,
		scrollTop: e.scrollY
	};
}
function vd(e) {
	if (Qu(e) === "html") return e;
	let t = e.assignedSlot || e.parentNode || id(e) && e.host || ed(e);
	return id(t) ? t.host : t;
}
function yd(e) {
	let t = vd(e);
	return hd(t) ? (e.ownerDocument || e).body : rd(t) && ad(t) ? t : yd(t);
}
function bd(e, t, n) {
	t === void 0 && (t = []), n === void 0 && (n = !0);
	let r = yd(e), i = r === e.ownerDocument?.body, a = $u(r);
	if (i) {
		let e = xd(a);
		return t.concat(a, a.visualViewport || [], ad(r) ? r : [], e && n ? bd(e) : []);
	}
	return t.concat(r, bd(r, [], n));
}
function xd(e) {
	return e.parent && Object.getPrototypeOf(e.parent) ? e.frameElement : null;
}
// node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs
function Sd(e) {
	let t = gd(e), n = parseFloat(t.width) || 0, r = parseFloat(t.height) || 0, i = rd(e), a = i ? e.offsetWidth : n, o = i ? e.offsetHeight : r, s = du(n) !== a || du(r) !== o;
	return s && (n = a, r = o), {
		width: n,
		height: r,
		$: s
	};
}
function Cd(e) {
	return nd(e) ? e : e.contextElement;
}
function wd(e) {
	let t = Cd(e);
	if (!rd(t)) return pu(1);
	let n = t.getBoundingClientRect(), { width: r, height: i, $: a } = Sd(t), o = (a ? du(n.width) : n.width) / r, s = (a ? du(n.height) : n.height) / i;
	return o && Number.isFinite(o) || (o = 1), s && Number.isFinite(s) || (s = 1), {
		x: o,
		y: s
	};
}
var Td = /*#__PURE__*/ pu(0);
function Ed(e) {
	let t = $u(e);
	return !md() || !t.visualViewport ? Td : {
		x: t.visualViewport.offsetLeft,
		y: t.visualViewport.offsetTop
	};
}
function Dd(e, t, n) {
	return t === void 0 && (t = !1), !!n && t && n === $u(e);
}
function Od(e, t, n, r) {
	t === void 0 && (t = !1), n === void 0 && (n = !1);
	let i = e.getBoundingClientRect(), a = Cd(e), o = pu(1);
	t && (r ? nd(r) && (o = wd(r)) : o = wd(e));
	let s = Dd(a, n, r) ? Ed(a) : pu(0), c = (i.left + s.x) / o.x, l = (i.top + s.y) / o.y, u = i.width / o.x, d = i.height / o.y;
	if (a && r) {
		let e = $u(a), t = nd(r) ? $u(r) : r, n = e, i = xd(n);
		for (; i && t !== n;) {
			let e = wd(i), t = i.getBoundingClientRect(), r = gd(i), a = t.left + (i.clientLeft + parseFloat(r.paddingLeft)) * e.x, o = t.top + (i.clientTop + parseFloat(r.paddingTop)) * e.y;
			c *= e.x, l *= e.y, u *= e.x, d *= e.y, c += a, l += o, n = $u(i), i = xd(n);
		}
	}
	return Fu({
		width: u,
		height: d,
		x: c,
		y: l
	});
}
function kd(e, t) {
	let n = _d(e).scrollLeft;
	return t ? t.left + n : Od(ed(e)).left + n;
}
function Ad(e, t) {
	let n = e.getBoundingClientRect();
	return {
		x: n.left + t.scrollLeft - kd(e, n),
		y: n.top + t.scrollTop
	};
}
function jd(e) {
	let { elements: t, rect: n, offsetParent: r, strategy: i } = e, a = i === "fixed", o = ed(r), s = t ? sd(t.floating) : !1;
	if (r === o || s && a) return n;
	let c = {
		scrollLeft: 0,
		scrollTop: 0
	}, l = pu(1), u = pu(0), d = rd(r);
	if ((d || !a) && ((Qu(r) !== "body" || ad(o)) && (c = _d(r)), d)) {
		let e = Od(r);
		l = wd(r), u.x = e.x + r.clientLeft, u.y = e.y + r.clientTop;
	}
	let f = o && !d && !a ? Ad(o, c) : pu(0);
	return {
		width: n.width * l.x,
		height: n.height * l.y,
		x: n.x * l.x - c.scrollLeft * l.x + u.x + f.x,
		y: n.y * l.y - c.scrollTop * l.y + u.y + f.y
	};
}
function Md(e) {
	return e.getClientRects ? Array.from(e.getClientRects()) : [];
}
function Nd(e) {
	let t = _d(e), n = e.ownerDocument.body, r = uu(e.scrollWidth, e.clientWidth, n.scrollWidth, n.clientWidth), i = uu(e.scrollHeight, e.clientHeight, n.scrollHeight, n.clientHeight), a = -t.scrollLeft + kd(e), o = -t.scrollTop;
	return gd(n).direction === "rtl" && (a += uu(e.clientWidth, n.clientWidth) - r), {
		width: r,
		height: i,
		x: a,
		y: o
	};
}
var Pd = 25;
function Fd(e, t, n) {
	n === void 0 && (n = "viewport");
	let r = n === "layoutViewport", i = $u(e), a = ed(e), o = i.visualViewport, s = a.clientWidth, c = a.clientHeight, l = 0, u = 0;
	if (o) {
		let e = !md() || t === "fixed";
		r ? e || (l = -o.offsetLeft, u = -o.offsetTop) : (s = o.width, c = o.height, e && (l = o.offsetLeft, u = o.offsetTop));
	}
	if (kd(a) <= 0) {
		let e = a.ownerDocument, t = e.body, n = getComputedStyle(t), r = e.compatMode === "CSS1Compat" && parseFloat(n.marginLeft) + parseFloat(n.marginRight) || 0, i = Math.abs(a.clientWidth - t.clientWidth - r), o = getComputedStyle(a).scrollbarGutter === "stable both-edges" ? i / 2 : i;
		o <= Pd && (s -= o);
	}
	return {
		width: s,
		height: c,
		x: l,
		y: u
	};
}
function Id(e, t) {
	let n = Od(e, !0, t === "fixed"), r = n.top + e.clientTop, i = n.left + e.clientLeft, a = wd(e);
	return {
		width: e.clientWidth * a.x,
		height: e.clientHeight * a.y,
		x: i * a.x,
		y: r * a.y
	};
}
function Ld(e, t, n) {
	let r;
	if (t === "viewport" || t === "layoutViewport") r = Fd(e, n, t);
	else if (t === "document") r = Nd(ed(e));
	else if (nd(t)) r = Id(t, n);
	else {
		let n = Ed(e);
		r = {
			x: t.x - n.x,
			y: t.y - n.y,
			width: t.width,
			height: t.height
		};
	}
	return Fu(r);
}
function Rd(e, t) {
	let n = t.get(e);
	if (n) return n;
	let r = bd(e, [], !1).filter((e) => nd(e) && Qu(e) !== "body"), i = null, a = gd(e).position === "fixed", o = a ? vd(e) : e;
	for (; nd(o) && !hd(o);) {
		let e = gd(o), t = fd(o), n = i ? i.position : a ? "fixed" : "";
		!t && (n === "fixed" || n === "absolute" && e.position === "static") ? r = r.filter((e) => e !== o) : i = e, o = vd(o);
	}
	return t.set(e, r), r;
}
function zd(e) {
	let { element: t, boundary: n, rootBoundary: r, strategy: i } = e, a = [...n === "clippingAncestors" ? sd(t) ? [] : Rd(t, this._c) : [].concat(n), r], o = Ld(t, a[0], i), s = o.top, c = o.right, l = o.bottom, u = o.left;
	for (let e = 1; e < a.length; e++) {
		let n = Ld(t, a[e], i);
		s = uu(n.top, s), c = lu(n.right, c), l = lu(n.bottom, l), u = uu(n.left, u);
	}
	return {
		width: c - u,
		height: l - s,
		x: u,
		y: s
	};
}
function Bd(e) {
	let { width: t, height: n } = Sd(e);
	return {
		width: t,
		height: n
	};
}
function Vd(e, t, n) {
	let r = rd(t), i = ed(t), a = n === "fixed", o = Od(e, !0, a, t), s = {
		scrollLeft: 0,
		scrollTop: 0
	}, c = pu(0);
	if ((r || !a) && ((Qu(t) !== "body" || ad(i)) && (s = _d(t)), r)) {
		let e = Od(t, !0, a, t);
		c.x = e.x + t.clientLeft, c.y = e.y + t.clientTop;
	}
	!r && i && (c.x = kd(i));
	let l = i && !r && !a ? Ad(i, s) : pu(0);
	return {
		x: o.left + s.scrollLeft - c.x - l.x,
		y: o.top + s.scrollTop - c.y - l.y,
		width: o.width,
		height: o.height
	};
}
function Hd(e) {
	return gd(e).position === "static";
}
function Ud(e, t) {
	if (!rd(e) || gd(e).position === "fixed") return null;
	if (t) return t(e);
	let n = e.offsetParent;
	return ed(e) === n && (n = n.ownerDocument.body), n;
}
function Wd(e, t) {
	let n = $u(e);
	if (sd(e)) return n;
	if (!rd(e)) {
		let t = vd(e);
		for (; t && !hd(t);) {
			if (nd(t) && !Hd(t)) return t;
			t = vd(t);
		}
		return n;
	}
	let r = Ud(e, t);
	for (; r && od(r) && Hd(r);) r = Ud(r, t);
	return r && hd(r) && Hd(r) && !fd(r) ? n : r || pd(e) || n;
}
var Gd = async function(e) {
	let t = this.getOffsetParent || Wd, n = this.getDimensions, r = await n(e.floating);
	return {
		reference: Vd(e.reference, await t(e.floating), e.strategy),
		floating: {
			x: 0,
			y: 0,
			width: r.width,
			height: r.height
		}
	};
};
function Kd(e) {
	return gd(e).direction === "rtl";
}
var qd = {
	convertOffsetParentRelativeRectToViewportRelativeRect: jd,
	getDocumentElement: ed,
	getClippingRect: zd,
	getOffsetParent: Wd,
	getElementRects: Gd,
	getClientRects: Md,
	getDimensions: Bd,
	getScale: wd,
	isElement: nd,
	isRTL: Kd
};
function Jd(e, t) {
	return e.x === t.x && e.y === t.y && e.width === t.width && e.height === t.height;
}
function Yd(e, t, n) {
	let r = null, i, a = ed(e);
	function o() {
		var e;
		clearTimeout(i), (e = r) == null || e.disconnect(), r = null;
	}
	function s(n, c) {
		n === void 0 && (n = !1), c === void 0 && (c = 1), o();
		let l = e.getBoundingClientRect(), { left: u, top: d, width: f, height: p } = l;
		if (n || t(), !f || !p) return;
		let m = fu(d), h = fu(a.clientWidth - (u + f)), g = fu(a.clientHeight - (d + p)), _ = fu(u), v = {
			rootMargin: -m + "px " + -h + "px " + -g + "px " + -_ + "px",
			threshold: uu(0, lu(1, c)) || 1
		}, y = !0;
		function b(t) {
			let n = t[0].intersectionRatio;
			if (!Jd(l, e.getBoundingClientRect())) return s();
			if (n !== c) {
				if (!y) return s();
				n ? s(!1, n) : i = setTimeout(() => {
					s(!1, 1e-7);
				}, 1e3);
			}
			y = !1;
		}
		try {
			r = new IntersectionObserver(b, {
				...v,
				root: a.ownerDocument
			});
		} catch {
			r = new IntersectionObserver(b, v);
		}
		r.observe(e);
	}
	let c = $u(e), l = () => s(n);
	return c.addEventListener("resize", l), s(!0), () => {
		c.removeEventListener("resize", l), o();
	};
}
function Xd(e, t, n, r) {
	r === void 0 && (r = {});
	let { ancestorScroll: i = !0, ancestorResize: a = !0, elementResize: o = typeof ResizeObserver == "function", layoutShift: s = typeof IntersectionObserver == "function", animationFrame: c = !1 } = r, l = Cd(e), u = i || a ? [...l ? bd(l) : [], ...t ? bd(t) : []] : [];
	u.forEach((e) => {
		i && e.addEventListener("scroll", n), a && e.addEventListener("resize", n);
	});
	let d = l && s ? Yd(l, n, a) : null, f = -1, p = null;
	o && (p = new ResizeObserver((e) => {
		let [r] = e;
		r && r.target === l && p && t && (p.unobserve(t), cancelAnimationFrame(f), f = requestAnimationFrame(() => {
			var e;
			(e = p) == null || e.observe(t);
		})), n();
	}), l && !c && p.observe(l), t && p.observe(t));
	let m, h = c ? Od(e) : null;
	c && g();
	function g() {
		let t = Od(e);
		h && !Jd(h, t) && n(), h = t, m = requestAnimationFrame(g);
	}
	return n(), () => {
		var e;
		u.forEach((e) => {
			i && e.removeEventListener("scroll", n), a && e.removeEventListener("resize", n);
		}), d?.(), (e = p) == null || e.disconnect(), p = null, c && cancelAnimationFrame(m);
	};
}
var Zd = qu, Qd = Ju, $d = Vu, ef = Xu, tf = Wu, nf = Bu, rf = Yu, af = (e, t, n) => {
	let r = /* @__PURE__ */ new Map(), i = n ?? {}, a = {
		...qd,
		...i.platform,
		_c: r
	};
	return zu(e, t, {
		...i,
		platform: a
	});
}, of = typeof document < "u" ? b : function() {};
function sf(e, t) {
	if (e === t) return !0;
	if (typeof e != typeof t) return !1;
	if (typeof e == "function" && e.toString() === t.toString()) return !0;
	let n, r, i;
	if (e && t && typeof e == "object") {
		if (Array.isArray(e)) {
			if (n = e.length, n !== t.length) return !1;
			for (r = n; r-- !== 0;) if (!sf(e[r], t[r])) return !1;
			return !0;
		}
		if (i = Object.keys(e), n = i.length, n !== Object.keys(t).length) return !1;
		for (r = n; r-- !== 0;) if (!{}.hasOwnProperty.call(t, i[r])) return !1;
		for (r = n; r-- !== 0;) {
			let n = i[r];
			if (!(n === "_owner" && e.$$typeof) && !sf(e[n], t[n])) return !1;
		}
		return !0;
	}
	return e !== e && t !== t;
}
function cf(e) {
	return typeof window > "u" ? 1 : (e.ownerDocument.defaultView || window).devicePixelRatio || 1;
}
function lf(e, t) {
	let n = cf(e);
	return Math.round(t * n) / n;
}
function uf(e) {
	let t = d.useRef(e);
	return of(() => {
		t.current = e;
	}), t;
}
function df(e) {
	e === void 0 && (e = {});
	let { placement: t = "bottom", strategy: n = "absolute", middleware: r = [], platform: i, elements: { reference: a, floating: o } = {}, transform: s = !0, whileElementsMounted: c, open: l } = e, [u, f] = d.useState({
		x: 0,
		y: 0,
		strategy: n,
		placement: t,
		middlewareData: {},
		isPositioned: !1
	}), [p, m] = d.useState(r);
	sf(p, r) || m(r);
	let [h, g] = d.useState(null), [_, v] = d.useState(null), y = d.useCallback((e) => {
		e !== C.current && (C.current = e, g(e));
	}, []), b = d.useCallback((e) => {
		e !== w.current && (w.current = e, v(e));
	}, []), x = a || h, S = o || _, C = d.useRef(null), w = d.useRef(null), T = d.useRef(u), ee = c != null, E = uf(c), te = uf(i), D = uf(l), O = d.useCallback(() => {
		if (!C.current || !w.current) return;
		let e = {
			placement: t,
			strategy: n,
			middleware: p
		};
		te.current && (e.platform = te.current), af(C.current, w.current, e).then((e) => {
			let t = {
				...e,
				isPositioned: D.current !== !1
			};
			ne.current && !sf(T.current, t) && (T.current = t, ie.flushSync(() => {
				f(t);
			}));
		});
	}, [
		p,
		t,
		n,
		te,
		D
	]);
	of(() => {
		l === !1 && T.current.isPositioned && (T.current.isPositioned = !1, f((e) => ({
			...e,
			isPositioned: !1
		})));
	}, [l]);
	let ne = d.useRef(!1);
	of(() => (ne.current = !0, () => {
		ne.current = !1;
	}), []), of(() => {
		if (x && (C.current = x), S && (w.current = S), x && S) {
			if (E.current) return E.current(x, S, O);
			O();
		}
	}, [
		x,
		S,
		O,
		E,
		ee
	]);
	let k = d.useMemo(() => ({
		reference: C,
		floating: w,
		setReference: y,
		setFloating: b
	}), [y, b]), A = d.useMemo(() => ({
		reference: x,
		floating: S
	}), [x, S]), re = d.useMemo(() => {
		let e = {
			position: n,
			left: 0,
			top: 0
		};
		if (!A.floating) return e;
		let t = lf(A.floating, u.x), r = lf(A.floating, u.y);
		return s ? {
			...e,
			transform: "translate(" + t + "px, " + r + "px)",
			...cf(A.floating) >= 1.5 && { willChange: "transform" }
		} : {
			position: n,
			left: t,
			top: r
		};
	}, [
		n,
		s,
		A.floating,
		u.x,
		u.y
	]);
	return d.useMemo(() => ({
		...u,
		update: O,
		refs: k,
		elements: A,
		floatingStyles: re
	}), [
		u,
		O,
		k,
		A,
		re
	]);
}
var ff = (e) => {
	function t(e) {
		return {}.hasOwnProperty.call(e, "current");
	}
	return {
		name: "arrow",
		options: e,
		fn(n) {
			let { element: r, padding: i } = typeof e == "function" ? e(n) : e;
			return r && t(r) ? r.current == null ? {} : nf({
				element: r.current,
				padding: i
			}).fn(n) : r ? nf({
				element: r,
				padding: i
			}).fn(n) : {};
		}
	};
}, pf = (e, t) => {
	let n = Zd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, mf = (e, t) => {
	let n = Qd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, hf = (e, t) => ({
	fn: rf(e).fn,
	options: [e, t]
}), gf = (e, t) => {
	let n = $d(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, _f = (e, t) => {
	let n = ef(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, vf = (e, t) => {
	let n = tf(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, yf = (e, t) => {
	let n = ff(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, bf = Object.defineProperty, xf = (e, t) => bf(e, "name", {
	value: t,
	configurable: !0
}), Sf = {
	Partial: "partial",
	Always: "always"
}, Cf = {
	Optimized: "optimized",
	Always: "always"
}, wf = "Popper", [Tf, Ef] = /* @__PURE__ */ rc(wf), [Df, Of] = Tf(wf), kf = /* @__PURE__ */ xf((e) => {
	let { __scopePopper: t, children: n } = e, [r, i] = d.useState(null), [a, o] = d.useState(void 0);
	return /* @__PURE__ */ k(Df, {
		scope: t,
		anchor: r,
		onAnchorChange: i,
		placementState: a,
		setPlacementState: o,
		children: n
	});
}, "Popper"), Af = "PopperAnchor", jf = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ xf(function(e, t) {
	let { __scopePopper: n, virtualRef: r, ...i } = e, a = Of(Af, n), o = d.useRef(null), s = a.onAnchorChange, c = Ds(t, d.useCallback((e) => {
		o.current = e, e && s(e);
	}, [s])), l = d.useRef(null);
	d.useEffect(() => {
		if (!r) return;
		let e = l.current;
		l.current = r.current, e !== l.current && s(l.current);
	});
	let u = a.placementState && Rf(a.placementState), f = u?.[0], p = u?.[1];
	return r ? null : /* @__PURE__ */ k(Js.div, {
		"data-radix-popper-side": f,
		"data-radix-popper-align": p,
		...i,
		ref: c
	});
}, "PopperAnchor")), Mf = "PopperContent", [Nf, Pf] = Tf(Mf), Ff = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ xf(function(e, t) {
	let { __scopePopper: n, side: r = "bottom", sideOffset: i = 0, align: a = "center", alignOffset: o = 0, arrowPadding: s = 0, avoidCollisions: c = !0, collisionBoundary: l = [], collisionPadding: u = 0, sticky: f = Sf.Partial, hideWhenDetached: p = !1, updatePositionStrategy: m = Cf.Optimized, onPlaced: h, ...g } = e, _ = Of(Mf, n), [v, y] = d.useState(null), b = Ds(t, y), [x, S] = d.useState(null), C = su(x), w = C?.width ?? 0, T = C?.height ?? 0, ee = r + (a === "center" ? "" : "-" + a), E = typeof u == "number" ? u : {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		...u
	}, te = Array.isArray(l) ? l : [l], D = te.length > 0, O = {
		padding: E,
		boundary: te.filter(If),
		altBoundary: D
	}, { refs: ne, floatingStyles: A, placement: re, isPositioned: ie, middlewareData: j } = df({
		strategy: "fixed",
		placement: ee,
		whileElementsMounted: /* @__PURE__ */ xf((...e) => Xd(...e, { animationFrame: m === Cf.Always }), "whileElementsMounted"),
		elements: { reference: _.anchor },
		middleware: [
			pf({
				mainAxis: i + T,
				alignmentAxis: o
			}),
			c && mf({
				mainAxis: !0,
				crossAxis: !1,
				...f === Sf.Partial ? { limiter: hf() } : {},
				...O
			}),
			c && gf({ ...O }),
			_f({
				...O,
				apply: /* @__PURE__ */ xf(({ elements: e, rects: t, availableWidth: n, availableHeight: r }) => {
					let { width: i, height: a } = t.reference, o = e.floating.style;
					o.setProperty("--radix-popper-available-width", `${n}px`), o.setProperty("--radix-popper-available-height", `${r}px`), o.setProperty("--radix-popper-anchor-width", `${i}px`), o.setProperty("--radix-popper-anchor-height", `${a}px`);
				}, "apply")
			}),
			x && yf({
				element: x,
				padding: s
			}),
			Lf({
				arrowWidth: w,
				arrowHeight: T
			}),
			p && vf(D ? {
				strategy: "referenceHidden",
				...O
			} : {
				strategy: "referenceHidden",
				padding: O.padding,
				altBoundary: O.altBoundary
			})
		]
	}), ae = _.setPlacementState;
	ac(() => (ae(re), () => {
		ae(void 0);
	}), [re, ae]);
	let [oe, se] = Rf(re), ce = Wc(h);
	ac(() => {
		ie && ce?.();
	}, [ie, ce]);
	let le = j.arrow?.x, ue = j.arrow?.y, de = j.arrow?.centerOffset !== 0, [fe, pe] = d.useState();
	return ac(() => {
		v && pe(window.getComputedStyle(v).zIndex);
	}, [v]), /* @__PURE__ */ k("div", {
		ref: ne.setFloating,
		"data-radix-popper-content-wrapper": "",
		style: {
			...A,
			transform: ie ? A.transform : "translate(0, -200%)",
			minWidth: "max-content",
			zIndex: fe,
			"--radix-popper-transform-origin": [j.transformOrigin?.x, j.transformOrigin?.y].join(" "),
			...j.hide?.referenceHidden && {
				visibility: "hidden",
				pointerEvents: "none"
			}
		},
		dir: e.dir,
		children: /* @__PURE__ */ k(Nf, {
			scope: n,
			placedSide: oe,
			placedAlign: se,
			onArrowChange: S,
			arrowX: le,
			arrowY: ue,
			shouldHideArrow: de,
			children: /* @__PURE__ */ k(Js.div, {
				"data-side": oe,
				"data-align": se,
				...g,
				ref: b,
				style: {
					...g.style,
					animation: ie ? g.style?.animation : "none"
				}
			})
		})
	});
}, "PopperContent"));
function If(e) {
	return e !== null;
}
xf(If, "isNotNull");
var Lf = /* @__PURE__ */ xf((e) => ({
	name: "transformOrigin",
	options: e,
	fn(t) {
		let { placement: n, rects: r, middlewareData: i } = t, a = i.arrow?.centerOffset !== 0, o = a ? 0 : e.arrowWidth, s = a ? 0 : e.arrowHeight, [c, l] = Rf(n), u = {
			start: "0%",
			center: "50%",
			end: "100%"
		}[l], d = (i.arrow?.x ?? 0) + o / 2, f = (i.arrow?.y ?? 0) + s / 2, p = "", m = "";
		return c === "bottom" ? (p = a ? u : `${d}px`, m = `${-s}px`) : c === "top" ? (p = a ? u : `${d}px`, m = `${r.floating.height + s}px`) : c === "right" ? (p = `${-s}px`, m = a ? u : `${f}px`) : c === "left" && (p = `${r.floating.width + s}px`, m = a ? u : `${f}px`), { data: {
			x: p,
			y: m
		} };
	}
}), "transformOrigin");
function Rf(e) {
	let [t, n = "center"] = e.split("-");
	return [t, n];
}
xf(Rf, "getSideAndAlignFromPlacement");
// node_modules/@radix-ui/react-popover/dist/index.mjs
var zf = Object.defineProperty, Bf = (e, t) => zf(e, "name", {
	value: t,
	configurable: !0
}), Vf = "Popover", [Hf, Uf] = /* @__PURE__ */ rc(Vf, [Ef]), Wf = Ef(), [Gf, Kf] = Hf(Vf), qf = /* @__PURE__ */ Bf((e) => {
	let { __scopePopover: t, children: n, open: r, defaultOpen: i, onOpenChange: a, modal: o = !1 } = e, s = Wf(t), c = d.useRef(null), [l, u] = d.useState(!1), [f, p] = d.useState(0), [m, h] = d.useState(0), [g, _] = Sc({
		prop: r,
		defaultProp: i ?? !1,
		onChange: a,
		caller: Vf
	});
	return /* @__PURE__ */ k(kf, {
		...s,
		children: /* @__PURE__ */ k(Gf, {
			scope: t,
			contentId: Bc(),
			titleId: Bc(),
			descriptionId: Bc(),
			titlePresent: f > 0,
			descriptionPresent: m > 0,
			setTitleCount: p,
			setDescriptionCount: h,
			triggerRef: c,
			open: g,
			onOpenChange: _,
			onOpenToggle: d.useCallback(() => _((e) => !e), [_]),
			hasCustomAnchor: l,
			onCustomAnchorAdd: d.useCallback(() => u(!0), []),
			onCustomAnchorRemove: d.useCallback(() => u(!1), []),
			modal: o,
			children: n
		})
	});
}, "Popover"), Jf = "PopoverAnchor", Yf = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Bf(function(e, t) {
	let { __scopePopover: n, ...r } = e, i = Kf(Jf, n), a = Wf(n), { onCustomAnchorAdd: o, onCustomAnchorRemove: s } = i;
	return d.useEffect(() => (o(), () => s()), [o, s]), /* @__PURE__ */ k(jf, {
		...a,
		...r,
		ref: t
	});
}, "PopoverAnchor")), Xf = "PopoverPortal", [Zf, Qf] = Hf(Xf, { forceMount: void 0 }), $f = /* @__PURE__ */ Bf((e) => {
	let { __scopePopover: t, forceMount: n, children: r, container: i } = e, a = Kf(Xf, t);
	return /* @__PURE__ */ k(Zf, {
		scope: t,
		forceMount: n,
		children: /* @__PURE__ */ k(Ac, {
			present: n || a.open,
			children: /* @__PURE__ */ k(Dl, {
				asChild: !0,
				container: i,
				children: r
			})
		})
	});
}, "PopoverPortal"), ep = "PopoverContent", tp = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Bf(function(e, t) {
	let n = Qf(ep, e.__scopePopover), { forceMount: r = n.forceMount, ...i } = e, a = Kf(ep, e.__scopePopover);
	return /* @__PURE__ */ k(Ac, {
		present: r || a.open,
		children: a.modal ? /* @__PURE__ */ k(rp, {
			...i,
			ref: t
		}) : /* @__PURE__ */ k(ip, {
			...i,
			ref: t
		})
	});
}, "PopoverContent")), np = /* @__PURE__ */ As("PopoverContent.RemoveScroll"), rp = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Bf(function(e, t) {
	let n = Kf(ep, e.__scopePopover), r = d.useRef(null), i = Ds(t, r), a = d.useRef(!1), { nodes: o, registry: s } = pl();
	return d.useEffect(() => {
		let e = r.current;
		if (e) return Ll(e);
	}, []), /* @__PURE__ */ k(Il, {
		as: np,
		allowPinchZoom: !0,
		shards: d.useMemo(() => [r, ...o.map((e) => ({ current: e }))], [r, o]),
		children: /* @__PURE__ */ k(ap, {
			...e,
			ref: i,
			branchNodes: o,
			branchRegistry: s,
			trapFocus: n.open,
			disableOutsidePointerEvents: !0,
			onCloseAutoFocus: lc(e.onCloseAutoFocus, (e) => {
				e.preventDefault(), a.current || n.triggerRef.current?.focus();
			}),
			onPointerDownOutside: lc(e.onPointerDownOutside, (e) => {
				let t = e.detail.originalEvent, n = t.button === 0 && t.ctrlKey === !0, r = t.button === 2 || n;
				a.current = r;
			}, { checkForDefaultPrevented: !1 }),
			onFocusOutside: lc(e.onFocusOutside, (e) => e.preventDefault(), { checkForDefaultPrevented: !1 })
		})
	});
}, "PopoverContentModal")), ip = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Bf(function(e, t) {
	let n = Kf(ep, e.__scopePopover), r = d.useRef(!1), i = d.useRef(!1);
	return /* @__PURE__ */ k(ap, {
		...e,
		ref: t,
		trapFocus: !1,
		disableOutsidePointerEvents: !1,
		onCloseAutoFocus: (t) => {
			e.onCloseAutoFocus?.(t), t.defaultPrevented || (r.current || n.triggerRef.current?.focus(), t.preventDefault()), r.current = !1, i.current = !1;
		},
		onInteractOutside: (t) => {
			e.onInteractOutside?.(t), t.defaultPrevented || (r.current = !0, t.detail.originalEvent.type === "pointerdown" && (i.current = !0));
			let a = t.target;
			n.triggerRef.current?.contains(a) && t.preventDefault(), t.detail.originalEvent.type === "focusin" && i.current && t.preventDefault();
		}
	});
}, "PopoverContentNonModal")), ap = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Bf(function(e, t) {
	let { __scopePopover: n, trapFocus: r, onOpenAutoFocus: i, onCloseAutoFocus: a, disableOutsidePointerEvents: o, onEscapeKeyDown: s, onPointerDownOutside: c, onFocusOutside: l, onInteractOutside: u, "aria-describedby": f, branchNodes: p, branchRegistry: m, ...h } = e, g = Kf(ep, n), _ = Wf(n), [v, y] = d.useState(null), b = Ds(t, y);
	return ml(v), Nl(), /* @__PURE__ */ k(fl, {
		registry: m,
		children: /* @__PURE__ */ k(ul, {
			asChild: !0,
			loop: !0,
			trapped: r,
			branches: p,
			onMountAutoFocus: i,
			onUnmountAutoFocus: a,
			children: /* @__PURE__ */ k(Qc, {
				asChild: !0,
				disableOutsidePointerEvents: o,
				onInteractOutside: u,
				onEscapeKeyDown: s,
				onPointerDownOutside: c,
				onFocusOutside: l,
				onDismiss: () => g.onOpenChange(!1),
				deferPointerDownOutside: !0,
				children: /* @__PURE__ */ k(Ff, {
					"data-state": op(g.open),
					role: "dialog",
					id: g.contentId,
					"aria-labelledby": g.titlePresent ? g.titleId : void 0,
					"aria-describedby": g.descriptionPresent ? sp(f, g.descriptionId) : f,
					..._,
					...h,
					ref: b,
					style: {
						...h.style,
						"--radix-popover-content-transform-origin": "var(--radix-popper-transform-origin)",
						"--radix-popover-content-available-width": "var(--radix-popper-available-width)",
						"--radix-popover-content-available-height": "var(--radix-popper-available-height)",
						"--radix-popover-trigger-width": "var(--radix-popper-anchor-width)",
						"--radix-popover-trigger-height": "var(--radix-popper-anchor-height)"
					}
				})
			})
		})
	});
}, "PopoverContentImpl"));
function op(e) {
	return e ? "open" : "closed";
}
Bf(op, "getState");
function sp(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
Bf(sp, "concatAriaDescribedby");
// node_modules/@radix-ui/react-tooltip/dist/index.mjs
var cp = Object.defineProperty, lp = (e, t) => cp(e, "name", {
	value: t,
	configurable: !0
}), [up, dp] = /* @__PURE__ */ rc("Tooltip", [Ef]), fp = Ef(), pp = "TooltipProvider", mp = 700, hp = "tooltip.open", [gp, _p] = up(pp), vp = /* @__PURE__ */ lp((e) => {
	let { __scopeTooltip: t, delayDuration: n = mp, skipDelayDuration: r = 300, disableHoverableContent: i = !1, children: a } = e, o = d.useRef(!0), s = d.useRef(!1), c = d.useRef(0);
	return d.useEffect(() => {
		let e = c.current;
		return () => window.clearTimeout(e);
	}, []), /* @__PURE__ */ k(gp, {
		scope: t,
		isOpenDelayedRef: o,
		delayDuration: n,
		onOpen: d.useCallback(() => {
			r <= 0 || (window.clearTimeout(c.current), o.current = !1);
		}, [r]),
		onClose: d.useCallback(() => {
			r <= 0 || (window.clearTimeout(c.current), c.current = window.setTimeout(() => o.current = !0, r));
		}, [r]),
		isPointerInTransitRef: s,
		onPointerInTransitChange: d.useCallback((e) => {
			s.current = e;
		}, []),
		disableHoverableContent: i,
		children: a
	});
}, "TooltipProvider"), yp = "Tooltip", [bp, xp] = up(yp), Sp = /* @__PURE__ */ lp((e) => {
	let { __scopeTooltip: t, children: n, open: r, defaultOpen: i, onOpenChange: a, disableHoverableContent: o, delayDuration: s } = e, c = _p(yp, e.__scopeTooltip), l = fp(t), [u, f] = d.useState(null), [p, m] = d.useState(void 0), h = Bc(), g = d.useRef(0), _ = o ?? c.disableHoverableContent, v = s ?? c.delayDuration, y = d.useRef(!1), [b, x] = Sc({
		prop: r,
		defaultProp: i ?? !1,
		onChange: /* @__PURE__ */ lp((e) => {
			e ? (c.onOpen(), document.dispatchEvent(new CustomEvent(hp))) : c.onClose(), a?.(e);
		}, "onChange"),
		caller: yp
	}), S = d.useMemo(() => b ? y.current ? "delayed-open" : "instant-open" : "closed", [b]), C = d.useCallback(() => {
		window.clearTimeout(g.current), g.current = 0, y.current = !1, x(!0);
	}, [x]), w = d.useCallback(() => {
		window.clearTimeout(g.current), g.current = 0, x(!1);
	}, [x]), T = d.useCallback(() => {
		window.clearTimeout(g.current), g.current = window.setTimeout(() => {
			y.current = !0, x(!0), g.current = 0;
		}, v);
	}, [v, x]);
	d.useEffect(() => () => {
		g.current &&= (window.clearTimeout(g.current), 0);
	}, []);
	let ee = p ?? h;
	return /* @__PURE__ */ k(kf, {
		...l,
		children: /* @__PURE__ */ k(bp, {
			scope: t,
			contentId: ee,
			setContentId: m,
			open: b,
			stateAttribute: S,
			trigger: u,
			onTriggerChange: f,
			onTriggerEnter: d.useCallback(() => {
				c.isOpenDelayedRef.current ? T() : C();
			}, [
				c.isOpenDelayedRef,
				T,
				C
			]),
			onTriggerLeave: d.useCallback(() => {
				_ ? w() : (window.clearTimeout(g.current), g.current = 0);
			}, [w, _]),
			onOpen: C,
			onClose: w,
			disableHoverableContent: _,
			children: n
		})
	});
}, "Tooltip"), Cp = "TooltipTrigger", wp = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ lp(function(e, t) {
	let { __scopeTooltip: n, "aria-describedby": r, ...i } = e, a = xp(Cp, n), o = _p(Cp, n), s = fp(n), c = Ds(t, d.useRef(null), a.onTriggerChange), l = d.useRef(!1), u = d.useRef(!1), f = d.useCallback(() => l.current = !1, []);
	return d.useEffect(() => () => document.removeEventListener("pointerup", f), [f]), /* @__PURE__ */ k(jf, {
		asChild: !0,
		...s,
		children: /* @__PURE__ */ k(Js.button, {
			"aria-describedby": a.open ? Bp(r, a.contentId) : r,
			"data-state": a.stateAttribute,
			...i,
			ref: c,
			onPointerMove: lc(e.onPointerMove, (e) => {
				e.pointerType !== "touch" && !u.current && !o.isPointerInTransitRef.current && (a.onTriggerEnter(), u.current = !0);
			}),
			onPointerLeave: lc(e.onPointerLeave, () => {
				a.onTriggerLeave(), u.current = !1;
			}),
			onPointerDown: lc(e.onPointerDown, () => {
				a.open && a.onClose(), l.current = !0, document.addEventListener("pointerup", f, { once: !0 });
			}),
			onFocus: lc(e.onFocus, () => {
				l.current || a.onOpen();
			}),
			onBlur: lc(e.onBlur, a.onClose),
			onClick: lc(e.onClick, a.onClose)
		})
	});
}, "TooltipTrigger")), Tp = "TooltipPortal", [Ep, Dp] = up(Tp, { forceMount: void 0 }), Op = /* @__PURE__ */ lp((e) => {
	let { __scopeTooltip: t, forceMount: n, children: r, container: i } = e, a = xp(Tp, t);
	return /* @__PURE__ */ k(Ep, {
		scope: t,
		forceMount: n,
		children: /* @__PURE__ */ k(Ac, {
			present: n || a.open,
			children: /* @__PURE__ */ k(Dl, {
				asChild: !0,
				container: i,
				children: r
			})
		})
	});
}, "TooltipPortal"), kp = "TooltipContent", Ap = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ lp(function(e, t) {
	let n = Dp(kp, e.__scopeTooltip), { forceMount: r = n.forceMount, side: i = "top", ...a } = e, o = xp(kp, e.__scopeTooltip);
	return /* @__PURE__ */ k(Ac, {
		present: r || o.open,
		children: o.disableHoverableContent ? /* @__PURE__ */ k(Np, {
			side: i,
			...a,
			ref: t
		}) : /* @__PURE__ */ k(jp, {
			side: i,
			...a,
			ref: t
		})
	});
}, "TooltipContent")), jp = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ lp(function(e, t) {
	let n = xp(kp, e.__scopeTooltip), r = _p(kp, e.__scopeTooltip), i = d.useRef(null), a = Ds(t, i), [o, s] = d.useState(null), { trigger: c, onClose: l } = n, u = i.current, { onPointerInTransitChange: f } = r, p = d.useCallback(() => {
		s(null), f(!1);
	}, [f]), m = d.useCallback((e, t) => {
		let n = e.currentTarget, r = {
			x: e.clientX,
			y: e.clientY
		}, i = Fp(r, Pp(r, n.getBoundingClientRect())), a = Ip(t.getBoundingClientRect()), o = Rp([...i, ...a]);
		s(o), f(!0);
	}, [f]);
	return d.useEffect(() => () => p(), [p]), d.useEffect(() => {
		if (c && u) {
			let e = /* @__PURE__ */ lp((e) => m(e, u), "handleTriggerLeave"), t = /* @__PURE__ */ lp((e) => m(e, c), "handleContentLeave");
			return c.addEventListener("pointerleave", e), u.addEventListener("pointerleave", t), () => {
				c.removeEventListener("pointerleave", e), u.removeEventListener("pointerleave", t);
			};
		}
	}, [
		c,
		u,
		m,
		p
	]), d.useEffect(() => {
		if (o) {
			let e = /* @__PURE__ */ lp((e) => {
				let t = e.target, n = {
					x: e.clientX,
					y: e.clientY
				}, r = c?.contains(t) || u?.contains(t), i = !Lp(n, o);
				r ? p() : i && (p(), l());
			}, "handleTrackPointerGrace");
			return document.addEventListener("pointermove", e), () => document.removeEventListener("pointermove", e);
		}
	}, [
		c,
		u,
		o,
		l,
		p
	]), /* @__PURE__ */ k(Np, {
		...e,
		ref: a
	});
}, "TooltipContentHoverable")), Mp = /* @__PURE__ */ Ns("TooltipContent"), Np = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ lp(function(e, t) {
	let { __scopeTooltip: n, children: r, "aria-label": i, id: a, onEscapeKeyDown: o, onPointerDownOutside: s, ...c } = e, l = xp(kp, n), u = fp(n), { onClose: f } = l, [p, m] = d.useState(null), h = Ds(t, m);
	ml(p), d.useEffect(() => (document.addEventListener(hp, f), () => document.removeEventListener(hp, f)), [f]), d.useEffect(() => {
		if (l.trigger) {
			let e = /* @__PURE__ */ lp((e) => {
				e.target instanceof Node && e.target.contains(l.trigger) && f();
			}, "handleScroll");
			return window.addEventListener("scroll", e, { capture: !0 }), () => window.removeEventListener("scroll", e, { capture: !0 });
		}
	}, [l.trigger, f]);
	let { setContentId: g } = l;
	return ac(() => (g(a), () => {
		g(void 0);
	}), [a, g]), /* @__PURE__ */ k(Qc, {
		asChild: !0,
		disableOutsidePointerEvents: !1,
		onEscapeKeyDown: o,
		onPointerDownOutside: s,
		onFocusOutside: (e) => e.preventDefault(),
		onDismiss: f,
		children: /* @__PURE__ */ A(Ff, {
			"data-state": l.stateAttribute,
			role: i ? void 0 : "tooltip",
			id: i ? void 0 : l.contentId,
			...u,
			...c,
			ref: h,
			style: {
				...c.style,
				"--radix-tooltip-content-transform-origin": "var(--radix-popper-transform-origin)",
				"--radix-tooltip-content-available-width": "var(--radix-popper-available-width)",
				"--radix-tooltip-content-available-height": "var(--radix-popper-available-height)",
				"--radix-tooltip-trigger-width": "var(--radix-popper-anchor-width)",
				"--radix-tooltip-trigger-height": "var(--radix-popper-anchor-height)"
			},
			children: [/* @__PURE__ */ k(Mp, { children: r }), i ? /* @__PURE__ */ k($s, {
				id: l.contentId,
				role: "tooltip",
				children: i
			}) : null]
		})
	});
}, "TooltipContentImpl"));
function Pp(e, t) {
	let n = Math.abs(t.top - e.y), r = Math.abs(t.bottom - e.y), i = Math.abs(t.right - e.x), a = Math.abs(t.left - e.x);
	switch (Math.min(n, r, i, a)) {
		case a: return "left";
		case i: return "right";
		case n: return "top";
		case r: return "bottom";
		default: throw Error("unreachable");
	}
}
lp(Pp, "getExitSideFromRect");
function Fp(e, t, n = 5) {
	let r = [];
	switch (t) {
		case "top":
			r.push({
				x: e.x - n,
				y: e.y + n
			}, {
				x: e.x + n,
				y: e.y + n
			});
			break;
		case "bottom":
			r.push({
				x: e.x - n,
				y: e.y - n
			}, {
				x: e.x + n,
				y: e.y - n
			});
			break;
		case "left":
			r.push({
				x: e.x + n,
				y: e.y - n
			}, {
				x: e.x + n,
				y: e.y + n
			});
			break;
		case "right": r.push({
			x: e.x - n,
			y: e.y - n
		}, {
			x: e.x - n,
			y: e.y + n
		});
	}
	return r;
}
lp(Fp, "getPaddedExitPoints");
function Ip(e) {
	let { top: t, right: n, bottom: r, left: i } = e;
	return [
		{
			x: i,
			y: t
		},
		{
			x: n,
			y: t
		},
		{
			x: n,
			y: r
		},
		{
			x: i,
			y: r
		}
	];
}
lp(Ip, "getPointsFromRect");
function Lp(e, t) {
	let { x: n, y: r } = e, i = !1;
	for (let e = 0, a = t.length - 1; e < t.length; a = e++) {
		let o = t[e], s = t[a], c = o.x, l = o.y, u = s.x, d = s.y;
		l > r != d > r && n < (u - c) * (r - l) / (d - l) + c && (i = !i);
	}
	return i;
}
lp(Lp, "isPointInPolygon");
function Rp(e) {
	let t = e.slice();
	return t.sort((e, t) => e.x < t.x ? -1 : e.x > t.x ? 1 : e.y < t.y ? -1 : +(e.y > t.y)), zp(t);
}
lp(Rp, "getHull");
function zp(e) {
	if (e.length <= 1) return e.slice();
	let t = [];
	for (let n = 0; n < e.length; n++) {
		let r = e[n];
		for (; t.length >= 2;) {
			let e = t[t.length - 1], n = t[t.length - 2];
			if ((e.x - n.x) * (r.y - n.y) >= (e.y - n.y) * (r.x - n.x)) t.pop();
			else break;
		}
		t.push(r);
	}
	t.pop();
	let n = [];
	for (let t = e.length - 1; t >= 0; t--) {
		let r = e[t];
		for (; n.length >= 2;) {
			let e = n[n.length - 1], t = n[n.length - 2];
			if ((e.x - t.x) * (r.y - t.y) >= (e.y - t.y) * (r.x - t.x)) n.pop();
			else break;
		}
		n.push(r);
	}
	return n.pop(), t.length === 1 && n.length === 1 && t[0].x === n[0].x && t[0].y === n[0].y ? t : t.concat(n);
}
lp(zp, "getHullPresorted");
function Bp(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
lp(Bp, "concatAriaDescribedby");
// src/app/ui/compose-refs.ts
function Vp(...e) {
	return (t) => {
		let n = e.map((e) => {
			if (typeof e == "function") return e(t);
			e && (e.current = t);
		});
		return () => {
			n.forEach((t, n) => {
				let r = e[n];
				typeof t == "function" ? t() : typeof r == "function" ? r(null) : r && (r.current = null);
			});
		};
	};
}
// src/app/ui/layer.ts
var Hp = (e) => e.preventDefault();
function Up({ open: e, kind: t, content: n, anchor: r, onEscape: i, onOutsidePress: a, inertBackground: c = !1 }) {
	let l = o(), d = u(), f = s(), [p] = C(() => ({})), m = S(null), h = S(null);
	return y(() => {
		e && (h.current = document.activeElement);
	}, [e]), b(() => {
		m.current = {
			kind: t,
			content: n,
			anchor: r,
			onEscape: i,
			onOutsidePress: a,
			inertBackground: c,
			ownsKeyboard: d,
			inertTarget: f
		};
	}), b(() => {
		if (e) return l.open(p, m, h.current), () => l.close(p);
	}, [
		e,
		l,
		p
	]), b(() => {
		l.refresh();
	}, [
		l,
		c,
		f
	]), {
		covered: w(l.subscribe, () => l.hasModalAbove(p), () => !1),
		isTop: () => l.isTop(p),
		skipFocusRestore: () => l.skipFocusRestore(p),
		markPressInside: () => l.markPressInside(p)
	};
}
// src/app/ui/tooltip.tsx
var Wp = d.createContext(null);
function Gp(e) {
	let t = document.activeElement;
	return !!t && !!e?.contains(t) && t.matches(":focus-visible");
}
function Kp({ delayDuration: e = 0, ...t }) {
	return /* @__PURE__ */ k(vp, {
		delayDuration: e,
		...t
	});
}
function qp({ open: e, defaultOpen: t = !1, onOpenChange: n, delayDuration: r, disableHoverableContent: i, children: a }) {
	let [o, s] = d.useState(t), c = e ?? o, l = (t) => {
		e === void 0 && s(t), n?.(t);
	}, u = d.useRef(null), f = d.useRef(null), p = d.useMemo(() => ({
		content: u,
		trigger: f
	}), []), m = d.useRef(!1);
	return Up({
		open: c,
		kind: "hint",
		content: u,
		onEscape: () => l(!1)
	}), d.useLayoutEffect(() => {
		let e = (e) => {
			e.target instanceof Node && e.target.contains(f.current) && (m.current = !0, setTimeout(() => {
				m.current = !1;
			}));
		};
		return window.addEventListener("scroll", e, { capture: !0 }), () => window.removeEventListener("scroll", e, { capture: !0 });
	}, []), /* @__PURE__ */ k(Wp.Provider, {
		value: p,
		children: /* @__PURE__ */ k(Kp, {
			delayDuration: r,
			disableHoverableContent: i,
			children: /* @__PURE__ */ k(Sp, {
				open: c,
				onOpenChange: (e) => {
					!e && m.current && Gp(f.current) || l(e);
				},
				children: a
			})
		})
	});
}
function Jp({ ref: e, ...t }) {
	let n = d.useContext(Wp), r = d.useMemo(() => Vp(e, n?.trigger), [e, n]);
	return /* @__PURE__ */ k(wp, {
		"data-slot": "tooltip-trigger",
		...t,
		ref: r
	});
}
function Yp({ className: e, sideOffset: t = 8, collisionPadding: r = 8, container: i, nonInteractive: a = !1, ref: o, ...s }) {
	let c = n(), l = d.useContext(Wp), u = d.useMemo(() => Vp(o, l?.content), [o, l]), f = /* @__PURE__ */ k(Ap, {
		"data-slot": "tooltip-content",
		sideOffset: t,
		collisionPadding: r,
		className: F("z-[200]", e),
		...s,
		ref: u,
		onEscapeKeyDown: Hp
	});
	return /* @__PURE__ */ k(Op, {
		container: i ?? c,
		children: a ? /* @__PURE__ */ k("div", {
			className: "pointer-events-none",
			children: f
		}) : f
	});
}
// src/app/lib/shortcuts.ts
var Xp = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent), Zp = Xp ? "meta" : "ctrl", Qp = {
	ctrl: Xp ? "⌘" : "⌃",
	control: Xp ? "⌘" : "⌃",
	cmd: "⌘",
	command: "⌘",
	meta: Xp ? "⌘" : "⊞",
	shift: "⇧",
	alt: Xp ? "⌥" : "Alt",
	option: Xp ? "⌥" : "Alt",
	enter: "⏎",
	return: "⏎",
	esc: "⎋",
	escape: "⎋",
	tab: "⇥",
	delete: "⌫",
	backspace: "⌫",
	space: "␣",
	up: "↑",
	down: "↓",
	left: "←",
	right: "→"
}, $p = (e) => Qp[e.toLowerCase()] ?? e.toUpperCase(), em = /* @__PURE__ */ new Set([
	"ctrl",
	"control",
	"meta",
	"cmd",
	"command",
	"alt",
	"option"
]), tm = (e) => e.some((e) => em.has(e.toLowerCase())), nm = (e) => {
	let t = e.toLowerCase();
	return t === "control" ? "ctrl" : t === "cmd" || t === "command" ? "meta" : t === "option" ? "alt" : t;
};
function rm(e, t) {
	let n = /* @__PURE__ */ new Set();
	e.ctrlKey && n.add("ctrl"), e.metaKey && n.add("meta"), e.altKey && n.add("alt"), e.shiftKey && n.add("shift"), e.key && n.add(e.key.toLowerCase());
	let r = new Set(t.map(nm));
	return n.size === r.size && [...r].every((e) => n.has(e));
}
var im = [
	Zp,
	"shift",
	"o"
], am = im, om = ({ keys: e, inversed: t = !1, spelled: n = !1, className: r = "" }) => e.length === 0 ? null : /* @__PURE__ */ k("div", {
	className: F("flex gap-[3px]", r),
	children: e.map((e, r) => /* @__PURE__ */ k("kbd", {
		className: F("inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-[3px] border tag-label", t ? "text-secondary-inverse border-tertiary-inversed" : "text-basic-secondary border-secondary bg-input"),
		children: n ? e : $p(e)
	}, r))
}), sm = d.createContext(null);
function cm(e) {
	let t = d.useContext(sm);
	if (!t) throw Error(`${e} must be rendered inside Popover`);
	return t;
}
function lm({ open: e, defaultOpen: t = !1, onOpenChange: n, closeOnEscape: r = !0, closeOnOutsidePress: i = !0, children: a }) {
	let [o, s] = d.useState(t), c = e ?? o, l = (t) => {
		e === void 0 && s(t), n?.(t);
	}, u = () => l(!1), f = d.useRef(null), p = d.useRef(null), m = Up({
		open: c,
		kind: "panel",
		content: f,
		anchor: p,
		onEscape: r ? u : void 0,
		onOutsidePress: i ? u : void 0
	});
	return /* @__PURE__ */ k(sm.Provider, {
		value: {
			layer: m,
			content: f,
			anchor: p
		},
		children: /* @__PURE__ */ k(qf, {
			open: c,
			onOpenChange: l,
			modal: !1,
			children: a
		})
	});
}
function um({ ref: e, ...t }) {
	let { anchor: n } = cm("PopoverAnchor"), r = d.useMemo(() => Vp(e, n), [e, n]);
	return /* @__PURE__ */ k(Yf, {
		"data-slot": "popover-anchor",
		ref: r,
		...t
	});
}
function dm({ className: e, align: t = "center", sideOffset: r = 8, collisionPadding: i = 8, portal: a = !0, container: o, role: s, onCloseAutoFocus: c, onMouseDownCapture: l, ref: u, ...f }) {
	let { layer: p, content: m } = cm("PopoverContent"), h = n(), g = d.useMemo(() => Vp(u, m), [u, m]), _ = /* @__PURE__ */ k(tp, {
		"data-slot": "popover-content",
		align: t,
		sideOffset: r,
		collisionPadding: i,
		className: F("z-[120] bg-popover text-popover-foreground outline-none", e),
		...f,
		role: s,
		ref: g,
		onEscapeKeyDown: Hp,
		onInteractOutside: Hp,
		onCloseAutoFocus: (e) => {
			c?.(e), e.preventDefault();
		},
		onMouseDownCapture: (e) => {
			l?.(e), p.markPressInside();
		}
	});
	return a ? /* @__PURE__ */ k($f, {
		container: o ?? h,
		children: _
	}) : _;
}
// src/app/ui/dialog.tsx
var fm = d.createContext(null);
function pm(e) {
	let t = d.useContext(fm);
	if (!t) throw Error(`${e} must be rendered inside Dialog`);
	return t;
}
function mm({ open: e, defaultOpen: t = !1, onOpenChange: n, layer: r = "modal", inertBackground: i = r === "modal", closeOnEscape: a = !0, children: o }) {
	let [s, c] = d.useState(t), l = e ?? s, u = (t) => {
		e === void 0 && c(t), n?.(t);
	}, f = () => u(!1), p = d.useRef(null), m = Up({
		open: l,
		kind: r,
		content: p,
		inertBackground: i,
		onEscape: a ? f : void 0
	});
	return /* @__PURE__ */ k(fm.Provider, {
		value: {
			layer: m,
			content: p,
			close: f
		},
		children: /* @__PURE__ */ k(Gl, {
			open: l,
			onOpenChange: u,
			modal: !1,
			children: o
		})
	});
}
function hm({ container: e, ...t }) {
	let r = n();
	return /* @__PURE__ */ k(Yl, {
		container: e ?? r,
		...t
	});
}
function gm(e) {
	if (!e) return;
	let t = (e) => e.preventDefault();
	return e.addEventListener("wheel", t, { passive: !1 }), e.addEventListener("touchmove", t, { passive: !1 }), () => {
		e.removeEventListener("wheel", t), e.removeEventListener("touchmove", t);
	};
}
function _m({ asChild: e = !1, dismissible: t = !0, className: n, onMouseDown: r, onClick: i, ref: a, ...o }) {
	let { layer: s, close: c } = pm("DialogOverlay"), l = d.useRef(!1), u = d.useMemo(() => Vp(a, gm), [a]);
	return /* @__PURE__ */ k(e ? js : "div", {
		"data-slot": "dialog-overlay",
		className: F(!e && "fixed inset-0", n),
		...o,
		ref: u,
		onMouseDown: (e) => {
			r?.(e), l.current = e.button === 0 && s.isTop();
		},
		onClick: (e) => {
			i?.(e);
			let n = l.current;
			l.current = !1, t && n && !e.defaultPrevented && c();
		}
	});
}
function vm(e) {
	return Array.from(e.querySelectorAll(c)).filter((t) => {
		if (t.tabIndex < 0 || t.matches(":disabled, input[type=hidden]") || t.closest("[hidden], [inert]") || getComputedStyle(t).visibility === "hidden") return !1;
		for (let n = t; n; n = n.parentElement) {
			if (getComputedStyle(n).display === "none") return !1;
			if (n === e) break;
		}
		return !0;
	}).sort((e, t) => (e.tabIndex || Infinity) - (t.tabIndex || Infinity));
}
function ym({ onCloseAutoFocus: e, onKeyDown: t, onMouseDownCapture: n, ref: r, ...i }) {
	let { layer: a, content: o } = pm("DialogContent"), s = d.useMemo(() => Vp(r, o), [r, o]);
	return /* @__PURE__ */ k(Zl, {
		"data-slot": "dialog-content",
		"data-covered": a.covered ? "" : void 0,
		...i,
		ref: s,
		onEscapeKeyDown: Hp,
		onInteractOutside: Hp,
		onCloseAutoFocus: (t) => {
			e?.(t), t.preventDefault();
		},
		onMouseDownCapture: (e) => {
			n?.(e), a.markPressInside();
		},
		onKeyDown: (e) => {
			t?.(e);
			let n = e.currentTarget;
			if (e.defaultPrevented || e.key !== "Tab" || !a.isTop()) return;
			let r = n.ownerDocument.activeElement;
			if (!n.contains(r)) return;
			let i = vm(n), o = i[0], s = i.at(-1), c = e.shiftKey ? s : o;
			(!c || r === n || (e.shiftKey ? r === o : r === s)) && (e.preventDefault(), (c ?? n).focus());
		}
	});
}
function bm(e) {
	return /* @__PURE__ */ k(tu, {
		"data-slot": "dialog-title",
		...e
	});
}
function xm(e) {
	return /* @__PURE__ */ k(nu, {
		"data-slot": "dialog-description",
		...e
	});
}
// src/app/ui/sheet.tsx
var Sm = {
	top: "inset-x-0 top-0",
	right: "inset-y-0 right-0 h-full",
	bottom: "inset-x-0 bottom-0",
	left: "inset-y-0 left-0 h-full"
};
function Cm({ layer: e = "sheet", ...t }) {
	return /* @__PURE__ */ k(mm, {
		layer: e,
		...t
	});
}
function wm({ side: e = "right", className: t, ...n }) {
	return /* @__PURE__ */ k(ym, {
		"data-slot": "sheet-content",
		"data-side": e,
		className: F("fixed flex flex-col outline-none", Sm[e], t),
		...n
	});
}
// src/app/atoms/cover-background/index.tsx
var Tm = ({ open: e = !1, zIndex: t = 40, opacity: n = .25, blur: r = 2, className: i = "", style: a, ...o }) => /* @__PURE__ */ k("div", {
	className: F("fixed inset-0 transition-opacity duration-150 ease-out motion-reduce:transition-none", e ? "opacity-100" : "opacity-0 pointer-events-none", i),
	style: {
		background: `rgba(0, 0, 0, ${n})`,
		zIndex: t,
		backdropFilter: r ? `blur(${r}px)` : void 0,
		...a
	},
	...o
}), Em = 300, Dm = ({ open: e, onClose: t, closeOnEscape: n = !0, zIndex: r = 120, className: i = "", children: a }) => {
	let [o, s] = C(e), [c, l] = C(!0), [u, d] = C(e), f = S(""), p = re();
	return u !== e && (d(e), l(!0), e && s(!0)), v(() => {
		if (!e || !o) return;
		let t = 0, n = requestAnimationFrame(() => {
			t = requestAnimationFrame(() => l(!1));
		});
		return () => {
			cancelAnimationFrame(n), cancelAnimationFrame(t);
		};
	}, [e, o]), v(() => {
		if (e || !o) return;
		let t = setTimeout(() => s(!1), Em);
		return () => clearTimeout(t);
	}, [e, o]), v(() => {
		f.current && f.current !== p.pathname && o && t(), f.current = p.pathname;
	}, [
		p.pathname,
		o,
		t
	]), o ? /* @__PURE__ */ k(Cm, {
		open: e,
		closeOnEscape: n,
		onOpenChange: (e) => {
			e || t();
		},
		children: /* @__PURE__ */ A(hm, {
			forceMount: !0,
			children: [/* @__PURE__ */ k(_m, {
				asChild: !0,
				children: /* @__PURE__ */ k(Tm, {
					open: !c,
					zIndex: r,
					className: "!duration-300"
				})
			}), /* @__PURE__ */ k(wm, {
				side: "bottom",
				forceMount: !0,
				role: void 0,
				onOpenAutoFocus: (e) => e.preventDefault(),
				style: { zIndex: r },
				className: F("fixed inset-x-0 bottom-0 flex flex-col min-h-[120px] max-h-[75dvh] overflow-y-auto overscroll-contain", "rounded-t-3xl py-4 bg-elevation-level-2 shadow-2xl", "transition-transform duration-300 ease-in-out motion-reduce:transition-none [&>*]:shrink-0", c ? "translate-y-full" : "translate-y-0", i),
				onMouseDown: (e) => e.stopPropagation(),
				onClick: (e) => e.stopPropagation(),
				children: a
			})]
		})
	}) : null;
}, Om = "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex=\"-1\"])", km = (e) => Array.from(e.querySelectorAll(Om)).filter((e) => e.tabIndex >= 0 && !e.matches(":disabled") && !e.closest("[inert], [hidden]"));
function Am({ open: e, label: t, children: n }) {
	let r = S(null);
	return b(() => {
		let t = r.current;
		if (!e || !t) return;
		(km(t)[0] ?? t).focus({ preventScroll: !0 });
		let n = (e) => {
			if (e.key === "Tab") {
				e.preventDefault(), e.stopPropagation();
				let n = km(t), r = n.indexOf(document.activeElement);
				(n[e.shiftKey ? (r <= 0 ? n.length : r) - 1 : (r + 1) % n.length] ?? t).focus({ preventScroll: !0 });
			}
		};
		return t.addEventListener("keydown", n), () => {
			t.removeEventListener("keydown", n);
		};
	}, [e]), b(() => {
		let t = r.current;
		e && t && (document.activeElement === document.body || t.contains(document.activeElement) && document.activeElement?.matches(":disabled")) && (km(t)[0] ?? t).focus({ preventScroll: !0 });
	}), /* @__PURE__ */ k("div", {
		ref: r,
		role: "dialog",
		"aria-modal": "true",
		"aria-label": t,
		tabIndex: -1,
		inert: !e,
		"aria-hidden": !e,
		className: "outline-none",
		children: n
	});
}
// src/app/atoms/popover/index.tsx
var jm = /* @__PURE__ */ function(e) {
	return e.Small = "w-[240px]", e.Medium = "w-[320px]", e.Large = "w-[400px]", e.Fit = "w-max", e.TriggerWidth = "min-w-[var(--radix-popover-trigger-width)]", e;
}({}), Mm = "flex flex-col gap-1 p-2 rounded-[12px] bg-elevation-level-3 shadow-2xl fade motion-reduce:!animate-none [&>*]:shrink-0", Nm = ({ open: e, onClose: t, content: n, children: r, placement: i = gs.BottomRight, size: a = "w-[320px]", sticky: o = !1, closeOnOutsideClick: s = !0, closeOnEscape: c = !0, sheetOnMobile: l = !0, className: u = "", panelClassName: d = "", sheetClassName: f = "", focusScope: p }) => {
	let m = xs() && l, h = e && !m, g = p ? /* @__PURE__ */ k(Am, {
		open: e,
		label: p,
		children: n
	}) : n, [_, v] = C(null), y = x(() => h && o && _ ? vs(_) : [], [
		h,
		o,
		_
	]), { side: b, align: S } = _s[i];
	return /* @__PURE__ */ k(lm, {
		open: h,
		onOpenChange: (e) => {
			e || t();
		},
		closeOnEscape: c,
		closeOnOutsidePress: s,
		children: /* @__PURE__ */ A(um, {
			ref: v,
			className: F("relative w-fit h-fit leading-[0]", u),
			children: [
				r,
				m ? /* @__PURE__ */ k(Dm, {
					open: e,
					onClose: t,
					closeOnEscape: c,
					className: f,
					children: g
				}) : null,
				h ? /* @__PURE__ */ k(dm, {
					forceMount: !0,
					portal: o,
					side: b,
					align: S,
					sideOffset: 8,
					collisionPadding: 8,
					collisionBoundary: o ? y : void 0,
					onOpenAutoFocus: (e) => e.preventDefault(),
					className: F(Mm, "text-inherit", a, o ? "z-[120]" : "z-30", d),
					children: g
				}) : null
			]
		})
	});
};
Nm.Placement = gs, Nm.Size = jm;
// src/app/atoms/tooltip/index.tsx
var Pm = "tooltip-box text-left w-max h-fit max-w-[240px] flex flex-col gap-1 shadow-xl bg-elevation-ground-inverse p-2 rounded-interaction fade motion-reduce:!animate-none", Fm = ({ title: e, description: t, keyboardShortcuts: n = [], inverted: r = !0, isMobile: i = !1 }) => /* @__PURE__ */ A(ne, { children: [/* @__PURE__ */ A("div", {
	className: "flex gap-2 items-center",
	children: [/* @__PURE__ */ k("div", {
		className: F(i ? "label-medium" : "label-micro", "flex-grow", r ? "text-primary-inverse" : "text-basic-primary"),
		children: e
	}), n.length > 0 ? /* @__PURE__ */ k(om, {
		keys: n,
		inversed: r
	}) : null]
}), t ? /* @__PURE__ */ k("div", {
	className: F("w-fit h-fit", r ? "text-micro text-secondary-inverse" : "text-medium text-basic-secondary"),
	children: t
}) : null] }), Im = ({ title: e, description: t, keyboardShortcuts: n, className: r, children: i }) => {
	let [a, o] = C(!1), s = S(!1), c = (e) => {
		e.stopPropagation(), e.type === "touchend" && e.preventDefault(), s.current = !0, o((e) => !e), setTimeout(() => {
			s.current = !1;
		}, 100);
	};
	return /* @__PURE__ */ k(Nm, {
		open: a,
		onClose: () => {
			s.current || o(!1);
		},
		className: r,
		content: /* @__PURE__ */ A("div", {
			className: "px-4 py-2 flex overflow-hidden gap-3",
			children: [/* @__PURE__ */ k(fs, {
				iconName: us.Info,
				size: 24,
				className: "w-6 min-w-6 max-w-6",
				color: "var(--color-fill-basic-tertiary)"
			}), /* @__PURE__ */ k("div", {
				className: "flex flex-col gap-2 min-w-0",
				children: /* @__PURE__ */ k("div", {
					className: "flex flex-col gap-2",
					children: /* @__PURE__ */ k(Fm, {
						title: e,
						description: t,
						keyboardShortcuts: n,
						inverted: !1,
						isMobile: !0
					})
				})
			})]
		}),
		children: /* @__PURE__ */ k("div", {
			onClick: c,
			onTouchEnd: c,
			className: "inline-block",
			children: i
		})
	});
};
function Lm({ ref: e, "aria-describedby": t, ...n }) {
	let r = S(null), i = x(() => Vp(e, r), [e]);
	return b(() => {
		let e = r.current;
		if (!e || !t) return;
		let n = t.split(/\s+/).filter(Boolean), i = /* @__PURE__ */ new Map(), a = () => {
			for (let t of e.querySelectorAll("a[href], button, input, select, textarea, [tabindex], [contenteditable=true]")) {
				let e = t.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [], r = i.get(t) ?? /* @__PURE__ */ new Set();
				for (let t of n) e.includes(t) || (e.push(t), r.add(t));
				i.set(t, r);
				let a = e.join(" ");
				t.getAttribute("aria-describedby") !== a && t.setAttribute("aria-describedby", a);
			}
		};
		a();
		let o = new MutationObserver(a);
		return o.observe(e, {
			subtree: !0,
			childList: !0,
			attributes: !0,
			attributeFilter: ["aria-describedby"]
		}), () => {
			o.disconnect();
			for (let [e, t] of i) {
				let n = (e.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((e) => e && !t.has(e)).join(" ");
				n ? e.setAttribute("aria-describedby", n) : e.removeAttribute("aria-describedby");
			}
		};
	}, [t]), /* @__PURE__ */ k("div", {
		...n,
		ref: i,
		"aria-describedby": t
	});
}
var Rm = ({ title: e = "", description: t, keyboardShortcuts: n = [], position: r = gs.TopCenter, className: i = "", boxClassName: a = "", disabled: o = !1, sticky: s = !1, showTooltipOnMobile: c = !1, children: l }) => {
	let u = xs(), [d, f] = C(!1), p = !o && !u;
	if (d && !p && f(!1), s && c && u) return /* @__PURE__ */ k(Im, {
		title: e,
		description: t,
		keyboardShortcuts: n,
		className: i,
		children: l
	});
	let { side: m, align: h } = _s[r];
	return /* @__PURE__ */ A(qp, {
		open: d,
		onOpenChange: (e) => f(e && p),
		disableHoverableContent: !0,
		children: [/* @__PURE__ */ k(Jp, {
			asChild: !0,
			children: /* @__PURE__ */ k(Lm, {
				className: F(s ? "w-fit h-fit leading-[0]" : "relative w-fit h-fit leading-[0] group", i),
				onMouseEnter: () => f(p),
				onMouseLeave: () => f(!1),
				onFocus: (e) => {
					let t = e.target;
					t === document.activeElement && !t.matches(":focus-visible") && e.preventDefault();
				},
				children: l
			})
		}), /* @__PURE__ */ k(Yp, {
			nonInteractive: !0,
			side: m,
			align: h,
			sideOffset: 8,
			collisionPadding: 8,
			className: F(Pm, "pointer-events-none", a),
			children: /* @__PURE__ */ k(Fm, {
				title: e,
				description: t,
				keyboardShortcuts: n
			})
		})]
	});
};
Rm.Position = gs;
// src/app/ui/button.tsx
var zm = /* @__PURE__ */ function(e) {
	return e.Medium = "btn-medium", e.Small = "btn-small", e.Large = "btn-large", e;
}({}), Bm = /* @__PURE__ */ function(e) {
	return e.Primary = "btn-primary", e.Secondary = "btn-secondary", e.SecondaryHighlighted = "btn-secondary-highlighted", e.SecondaryDestructive = "btn-secondary-destructive", e.SecondaryAccent = "btn-secondary-accent", e.SecondaryAccentHighlighted = "btn-secondary-accent-highlighted", e.Tertiary = "btn-tertiary", e.TertiaryDestructive = "btn-tertiary-destructive", e.TertiaryAccent = "btn-tertiary-accent", e.Ghost = "btn-ghost", e.GhostDestructive = "btn-ghost-destructive", e.GhostAccent = "btn-ghost-accent", e.GhostHighlighted = "btn-ghost-highlighted", e.GhostHighlightedAccent = "btn-ghost-highlighted-accent", e;
}({}), Vm = /* @__PURE__ */ function(e) {
	return e.Icon = "btn-icon", e.IconLeft = "btn-icon-left", e.IconRight = "btn-icon-right", e.Text = "btn-text", e;
}({});
function Hm({ variant: e = "btn-ghost", size: t = "btn-medium", content: n = "btn-text", disabled: r = !1, className: i } = {}) {
	return F("btn", t, e, n, r && "btn-disabled", i);
}
function Um({ variant: e, size: t, content: n, disabled: r, className: i, asChild: a = !1, type: o = "button", ...s }) {
	return /* @__PURE__ */ k(a ? js : "button", {
		"data-slot": "button",
		type: a ? void 0 : o,
		disabled: r,
		className: Hm({
			variant: e,
			size: t,
			content: n,
			disabled: r,
			className: i
		}),
		...s
	});
}
// src/app/atoms/button/index.tsx
var Wm = {
	"btn-medium": ps.Small,
	"btn-small": ps.Small,
	"btn-large": ps.Small
}, Gm = {
	"btn-primary": ms.OnPrimary,
	"btn-secondary": ms.Neutral,
	"btn-secondary-highlighted": ms.Neutral,
	"btn-secondary-destructive": ms.Destructive,
	"btn-secondary-accent": ms.Brand,
	"btn-secondary-accent-highlighted": ms.Brand,
	"btn-tertiary": ms.Neutral,
	"btn-tertiary-destructive": ms.Destructive,
	"btn-tertiary-accent": ms.Brand,
	"btn-ghost": ms.Neutral,
	"btn-ghost-destructive": ms.Destructive,
	"btn-ghost-accent": ms.Brand,
	"btn-ghost-highlighted": ms.Neutral,
	"btn-ghost-highlighted-accent": ms.Brand
}, Km = ({ size: e = zm.Medium, variant: t = Bm.Ghost, content: n = Vm.Text, disabled: r, className: i = "", children: a, loading: o = !1, type: s = "button", ...c }) => /* @__PURE__ */ k(Um, {
	size: e,
	variant: t,
	content: n,
	className: i,
	type: s,
	disabled: r || o,
	"aria-busy": o || void 0,
	...c,
	children: o ? /* @__PURE__ */ A(ne, { children: [/* @__PURE__ */ k(hs, {
		size: Wm[e],
		variant: Gm[t]
	}), /* @__PURE__ */ k("span", {
		className: "sr-only",
		children: a
	})] }) : a
});
Km.Size = zm, Km.Variant = Bm, Km.Content = Vm;
// src/app/hooks/useCopyToClipboard.ts
var qm = 2e3;
function Jm(e) {
	let t = document.createElement("textarea");
	t.value = e, t.style.position = "fixed", t.style.top = "-9999px", document.body.appendChild(t);
	try {
		return t.focus(), t.select(), document.execCommand("copy");
	} catch {
		return !1;
	} finally {
		document.body.removeChild(t);
	}
}
function Ym() {
	let [e, t] = C(!1), n = S(null);
	v(() => () => {
		n.current && clearTimeout(n.current);
	}, []);
	let r = g(() => {
		n.current && clearTimeout(n.current), t(!0), n.current = setTimeout(() => t(!1), qm);
	}, []);
	return {
		copied: e,
		copy: g((e) => {
			e && (navigator.clipboard?.writeText ? navigator.clipboard.writeText(e).then(r).catch(() => {
				Jm(e) && r();
			}) : Jm(e) && r());
		}, [r])
	};
}
// src/app/atoms/button/CopyButton.tsx
var Xm = ({ value: e, size: t = zm.Small, variant: n = Bm.Tertiary, content: r = Vm.Icon, position: i = gs.BottomCenter, title: a = "Copy", iconSize: o, onCopy: s, className: c = "", children: l, ...u }) => {
	let { copied: d, copy: f } = Ym(), p = d ? "Copied" : a;
	return /* @__PURE__ */ k(Rm, {
		title: p,
		position: i,
		sticky: !0,
		children: /* @__PURE__ */ k(Km, {
			size: t,
			variant: n,
			content: r,
			className: c,
			"aria-label": p,
			onClick: () => {
				f(e), s?.();
			},
			...u,
			children: l ?? /* @__PURE__ */ k(fs, {
				iconName: d ? us.Check : us.FileCopy,
				size: o,
				className: "fade"
			})
		})
	});
}, Zm = ({ variant: e = Bm.Ghost, content: t = Vm.Text, disabled: n, className: r = "", buttonClassName: i = "", children: a, loading: o = !1, type: s = "button", ...c }) => {
	let l = r.includes("flex-grow") || r.includes("flex-1"), u = e.startsWith("btn-tertiary"), d = !e.startsWith("btn-primary") && !u;
	return /* @__PURE__ */ k("div", {
		className: F(d && "h-10 rounded-full bg-elevation-level-3 shadow-xl", !d && !u && "h-10 rounded-full", l ? "flex w-full" : "inline-flex w-fit", r),
		children: /* @__PURE__ */ k(Km, {
			size: zm.Large,
			variant: e,
			content: t,
			type: s,
			disabled: n,
			loading: o,
			className: F("btn-sticky", l && "w-full", i),
			...c,
			children: a
		})
	});
};
Zm.Variant = Bm, Zm.Content = Vm;
// src/app/ui/alert-dialog.tsx
function Qm(e) {
	return /* @__PURE__ */ k(mm, {
		...e,
		layer: "modal"
	});
}
function $m({ dismissible: e = !1, ...t }) {
	return /* @__PURE__ */ k(_m, {
		"data-slot": "alert-dialog-overlay",
		dismissible: e,
		...t
	});
}
function eh(e) {
	return /* @__PURE__ */ k(ym, {
		"data-slot": "alert-dialog-content",
		role: "alertdialog",
		...e
	});
}
function th(e) {
	return /* @__PURE__ */ k(bm, {
		"data-slot": "alert-dialog-title",
		...e
	});
}
// src/app/atoms/modal/index.tsx
var nh = 300, rh = "pt-14", ih = "pb-20", ah = /* @__PURE__ */ function(e) {
	return e.Small = "max-w-[400px]", e.Medium = "max-w-[604px]", e.Wide = "max-w-[600px]", e.Large = "max-w-[760px]", e;
}({}), oh = ({ open: e, onClose: t, onNavigate: n, title: r, subheader: i, headerActions: a, size: o = "max-w-[604px]", zIndex: s = 100, closeOnOverlay: c = !0, flush: l = !1, fullScreen: u = !1, chromeless: d = !1, mobileCloseIcon: f = us.Left, hideClose: p = !1, keepOnNavigate: m = !1, alert: h = !1, className: g = "", bodyClassName: _ = "", children: y, footer: b }) => {
	let x = xs(), w = S(null), T = S(""), ee = re(), [E, te] = C(e), [D, O] = C(e), [ne, ie] = C(!0);
	if (D !== e && (O(e), e ? (te(!0), x && ie(!0)) : x ? ie(!0) : te(!1)), v(() => {
		if (!e || !x || !E) return;
		let t = 0, n = requestAnimationFrame(() => {
			t = requestAnimationFrame(() => ie(!1));
		});
		return () => {
			cancelAnimationFrame(n), cancelAnimationFrame(t);
		};
	}, [
		e,
		x,
		E
	]), v(() => {
		if (e || !x || !E) return;
		let t = setTimeout(() => te(!1), nh);
		return () => clearTimeout(t);
	}, [
		e,
		x,
		E
	]), v(() => {
		e && w.current?.focus();
	}, [e]), v(() => {
		T.current && T.current !== ee.pathname && e && !m && (n ?? t)?.(), T.current = ee.pathname;
	}, [
		ee.pathname,
		e,
		t,
		n,
		m
	]), !E) return null;
	let j = h ? Qm : mm, ae = h ? $m : _m, oe = h ? eh : ym, se = h ? th : bm, ce = c && !x, le = (e) => x ? /* @__PURE__ */ k(Zm, {
		variant: Bm.Ghost,
		content: Vm.Icon,
		className: "shrink-0",
		"aria-label": "Close",
		onClick: t,
		children: /* @__PURE__ */ k(fs, { iconName: e })
	}) : /* @__PURE__ */ k(Km, {
		variant: Bm.Ghost,
		size: zm.Medium,
		content: Vm.Icon,
		className: F("shrink-0", e === us.Close && "btn-icon-rotate"),
		"aria-label": "Close",
		onClick: t,
		children: /* @__PURE__ */ k(fs, { iconName: e })
	}), ue = u && !x, de = x && !i, fe = d && (ue || x) && t && !p, pe = "header-md flex min-w-0 flex-1 items-center text-basic-primary", me = /* @__PURE__ */ A("div", {
		className: F("flex items-center", i ? "min-h-14" : "h-full", x ? F("gap-4 py-1 pl-2", a ? "pr-1" : "pr-4") : "gap-2 py-1 pl-4 pr-2"),
		children: [
			x && t ? le(f) : null,
			r ? /* @__PURE__ */ k(se, {
				asChild: !0,
				children: /* @__PURE__ */ k("div", {
					className: pe,
					children: r
				})
			}) : /* @__PURE__ */ k("div", { className: pe }),
			a ? /* @__PURE__ */ k("div", {
				className: "flex shrink-0 items-center gap-1",
				children: a
			}) : null,
			!x && t ? le(us.Close) : null
		]
	}), he = !d && (r || i || a || t) ? /* @__PURE__ */ A("header", {
		className: F("flex flex-col", x ? F("fade-from-top z-10", i ? "shrink-0" : "h-14", de ? "absolute inset-x-0 top-0" : "shrink-0") : F("shrink-0 border-b border-muted", i ? "min-h-14" : "h-14")),
		children: [me, i ? /* @__PURE__ */ k("div", {
			className: "px-4 pb-3",
			children: i
		}) : null]
	}) : null, ge = e && !ne ? "translate-x-0 data-[covered]:translate-x-[-30px]" : "translate-x-full";
	return /* @__PURE__ */ k(j, {
		open: e,
		onOpenChange: (e) => {
			e || t?.();
		},
		inertBackground: !x,
		children: /* @__PURE__ */ A(hm, {
			forceMount: !0,
			children: [/* @__PURE__ */ k(ae, {
				asChild: !0,
				dismissible: ce,
				children: /* @__PURE__ */ k(Tm, {
					open: e && (!x || !ne),
					zIndex: s,
					opacity: .25,
					blur: 1,
					className: x ? "!duration-300" : void 0
				})
			}), /* @__PURE__ */ k("div", {
				style: { zIndex: s },
				className: F("pointer-events-none fixed inset-0 z-[100] flex", !x && "items-center justify-center p-4"),
				children: /* @__PURE__ */ A(oe, {
					ref: w,
					forceMount: !0,
					"aria-modal": "true",
					"aria-label": typeof r == "string" ? r : void 0,
					tabIndex: -1,
					"data-modal-open": e ? "true" : void 0,
					onOpenAutoFocus: (e) => e.preventDefault(),
					className: F("pointer-events-auto relative flex flex-col outline-none", x ? F("rounded-none transition-transform duration-300 ease-in-out motion-reduce:transition-none", ge, !d && "bg-elevation-ground") : F("fade w-full motion-reduce:!animate-none", o, d ? "shadow-none" : "max-h-[calc(100vh-2rem)] overflow-hidden rounded-[20px] bg-elevation-level-2 shadow-xl", ue && "h-full max-h-none min-h-0 w-full max-w-none overflow-hidden"), g, x && "h-[min(100%,100dvh)] max-h-[min(100%,100dvh)] min-h-[min(100%,100dvh)] w-full min-w-full max-w-full"),
					children: [
						fe ? /* @__PURE__ */ k("div", {
							className: "absolute top-1 right-2 z-10",
							children: le(us.Close)
						}) : null,
						he,
						/* @__PURE__ */ k("div", {
							className: F("flex w-full min-h-0 flex-auto flex-col overflow-auto overscroll-contain", de && !d && rh),
							children: /* @__PURE__ */ k("div", {
								className: F(d ? "flex min-h-0 w-full flex-1 flex-col" : "paragraph-medium flex flex-col p-4 text-basic-secondary", x || ue ? "min-h-0 flex-1 overflow-auto" : l && "flex-1", x && b && ih, _),
								children: y
							})
						}),
						b ? /* @__PURE__ */ k("footer", {
							className: F("modal-footer flex items-center justify-end", x ? "modal-footer-mobile fade-from-bottom absolute inset-x-0 bottom-0 z-10 gap-3 p-3" : "shrink-0 gap-2 border-t border-muted p-4"),
							children: b
						}) : null
					]
				})
			})]
		})
	});
};
oh.Size = ah;
var sh = xm, ch = {
	muted: "#000001",
	accent: "#000002",
	success: "#000003",
	danger: "#000004",
	info: "#000005",
	secondary: "#000006",
	error: "#000007",
	fg: "#000008"
}, lh = {
	[ch.muted]: "var(--color-text-basic-muted)",
	[ch.accent]: "var(--color-text-accent-primary)",
	[ch.success]: "var(--color-text-success-primary)",
	[ch.danger]: "var(--color-text-danger-primary)",
	[ch.info]: "var(--color-text-info-primary)",
	[ch.secondary]: "var(--color-text-basic-secondary)",
	[ch.error]: "var(--color-text-error-primary)",
	[ch.fg]: "var(--color-text-basic-primary)"
};
function uh(e, t, n) {
	return {
		scope: e,
		settings: n ? {
			foreground: t,
			fontStyle: n
		} : { foreground: t }
	};
}
function dh(e, t) {
	return {
		scope: e,
		settings: { fontStyle: t }
	};
}
var fh = {
	name: "nac",
	type: "dark",
	fg: ch.fg,
	bg: "#000000",
	colorReplacements: lh,
	settings: [
		{ settings: {
			foreground: ch.fg,
			background: "#000000"
		} },
		uh(["comment", "punctuation.definition.comment"], ch.muted, "italic"),
		uh([
			"keyword",
			"storage",
			"storage.type",
			"support.type",
			"entity.name.type",
			"entity.name.tag"
		], ch.accent),
		uh([
			"string",
			"string.regexp",
			"markup.inserted"
		], ch.success),
		uh([
			"constant.numeric",
			"constant.language",
			"constant.character",
			"markup.list"
		], ch.danger),
		uh([
			"entity.name.function",
			"support.function",
			"entity.name.section",
			"entity.name.class",
			"entity.name.type.class"
		], ch.info),
		uh(["variable", "entity.other.attribute-name"], ch.secondary),
		uh("markup.deleted", ch.error),
		dh(["markup.italic", "markup.quote"], "italic"),
		dh("markup.bold", "bold")
	]
};
// src/app/lib/highlight.ts
function ph(e) {
	return {
		color: e.color ?? void 0,
		fontStyle: e.italic ? "italic" : void 0,
		fontWeight: e.bold ? 600 : void 0
	};
}
var mh = {
	bash: "bash",
	c: "c",
	cc: "cpp",
	cjs: "javascript",
	cpp: "cpp",
	cs: "csharp",
	css: "css",
	cts: "typescript",
	diff: "diff",
	go: "go",
	h: "c",
	hpp: "cpp",
	htm: "html",
	html: "html",
	ini: "ini",
	java: "java",
	js: "javascript",
	json: "json",
	jsx: "javascript",
	kt: "kotlin",
	less: "less",
	markdown: "markdown",
	md: "markdown",
	mjs: "javascript",
	mts: "typescript",
	patch: "diff",
	php: "php",
	py: "python",
	rb: "ruby",
	rs: "rust",
	scss: "scss",
	sh: "bash",
	sql: "sql",
	svg: "xml",
	swift: "swift",
	toml: "toml",
	ts: "typescript",
	tsx: "typescript",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
	zsh: "bash"
}, hh = {
	cc: "cpp",
	cjs: "javascript",
	cs: "csharp",
	cts: "typescript",
	h: "c",
	hpp: "cpp",
	htm: "html",
	js: "javascript",
	kt: "kotlin",
	md: "markdown",
	mjs: "javascript",
	mts: "typescript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	sh: "bash",
	shell: "bash",
	svg: "xml",
	ts: "typescript",
	yml: "yaml",
	zsh: "bash"
}, gh = /* @__PURE__ */ new Set([
	"plain",
	"plaintext",
	"text",
	"txt"
]), _h = 1, vh = 2, yh = 50, bh = /* @__PURE__ */ new Map(), xh = {
	bash: () => import("./bash-DFxs5vph.js"),
	c: () => import("./c-B6pUfN3H.js").then((e) => e.n),
	cpp: () => import("./cpp-D3tEjlCH.js"),
	csharp: () => import("./csharp-rJmV-0ss.js"),
	css: () => import("./css-BCrs5pLF.js"),
	diff: () => import("./diff-Diuv0qGT.js"),
	go: () => import("./go-DM5FkVJr.js"),
	html: () => import("./html-BkHgMLvu.js"),
	ini: () => import("./ini-DtrnrQj2.js"),
	java: () => import("./java-CXPFbNTI.js").then((e) => e.n),
	javascript: () => import("./javascript-BSjxD7Ei.js"),
	json: () => import("./json-CWJmcBQn.js"),
	jsonc: () => import("./jsonc-IKox2JSV.js"),
	jsx: () => import("./jsx-DXcqk-V3.js").then((e) => e.n),
	kotlin: () => import("./kotlin-EmJjLeRz.js"),
	less: () => import("./less-Bis9Y9oi.js"),
	markdown: () => import("./markdown-CNVZ8ok-.js"),
	php: () => import("./php-TV9B8IEE.js"),
	python: () => import("./python-BHaXfePs.js"),
	ruby: () => import("./ruby-gsbVfsvC.js"),
	rust: () => import("./rust-BgaDMmGE.js"),
	scss: () => import("./scss-stv2RHpZ.js"),
	sql: () => import("./sql-N25IJRXF.js"),
	swift: () => import("./swift-1fpvFsbf.js"),
	toml: () => import("./toml-CXAVGmfI.js"),
	tsx: () => import("./tsx-BkpuYhFT.js").then((e) => e.n),
	typescript: () => import("./typescript-CMPopAR9.js").then((e) => e.n),
	xml: () => import("./xml-zR8j11Q2.js"),
	yaml: () => import("./yaml-CcAIbj8h.js")
}, Sh = null, Ch = /* @__PURE__ */ new Map();
function wh(e) {
	let t = e.replace(/\/+$/, "").split("/").pop() ?? "";
	return mh[((t.includes(".") ? t.split(".").pop() : "") ?? "").toLowerCase()] ?? null;
}
function Th(e) {
	let t = e.trim().toLowerCase();
	if (!t || gh.has(t)) return null;
	let n = hh[t] ?? t;
	return n in xh ? n : null;
}
function Eh() {
	return Sh ??= (async () => {
		let [{ createHighlighterCore: e }, { createJavaScriptRegexEngine: t }] = await Promise.all([import("./core-DsPjBpwQ.js"), import("./engine-javascript-DVxm-Bxk.js")]);
		return e({
			themes: [fh],
			langs: [],
			engine: t()
		});
	})(), Sh;
}
async function Dh(e) {
	let t = xh[e];
	if (!t) return !1;
	try {
		let n = await Eh();
		return n.getLoadedLanguages().includes(e) ? !0 : (await n.loadLanguage(t()), n.getLoadedLanguages().includes(e));
	} catch {
		return !1;
	}
}
function Oh(e) {
	let t = Ch.get(e);
	return t || (t = Dh(e), Ch.set(e, t)), t;
}
function kh(e) {
	let t = e.fontStyle ?? 0, n = {
		text: e.content,
		color: e.color || null
	};
	return t & _h && (n.italic = !0), t & vh && (n.bold = !0), n;
}
function Ah(e) {
	return e.map((e) => e.map(kh));
}
function jh(e) {
	return e.map((e) => e.map((e) => e.text).join("")).join("\n");
}
function Mh(e, t) {
	return `${e}\0${t}`;
}
function Nh(e) {
	if (!bh.has(e)) return;
	let t = bh.get(e) ?? null;
	return bh.delete(e), bh.set(e, t), t;
}
function Ph(e, t) {
	if (bh.set(e, t), bh.size <= yh) return;
	let n = bh.keys().next().value;
	n !== void 0 && bh.delete(n);
}
async function Fh(e, t) {
	let n = Mh(e, t), r = Nh(n);
	if (r !== void 0) return r;
	if (!await Oh(e)) return Ph(n, null), null;
	let i;
	try {
		i = Ah((await Eh()).codeToTokensBase(t, {
			lang: e,
			theme: "nac",
			colorReplacements: lh
		}));
	} catch {
		return Ph(n, null), null;
	}
	return jh(i) === t ? (Ph(n, i), i) : (Ph(n, null), null);
}
async function Ih(e, t) {
	let n = Th(e);
	return n ? Fh(n, t) : null;
}
async function Lh(e, t) {
	let n = wh(e);
	return n ? Fh(n, t) : null;
}
var Rh = /* @__PURE__ */ new Set(["delete", "context"]), zh = /* @__PURE__ */ new Set(["insert", "context"]);
async function Bh(e, t) {
	let n = /* @__PURE__ */ new Map(), r = wh(e);
	if (!r) return n;
	for (let e of t) for (let t of e.hunks) for (let e of [Rh, zh]) {
		let i = t.lines.filter((t) => e.has(t.kind));
		if (i.length === 0) continue;
		let a = await Fh(r, i.map((e) => e.content).join("\n"));
		a && a.length === i.length && i.forEach((e, t) => n.set(e, a[t]));
	}
	return n;
}
// src/app/atoms/code-block/index.tsx
var Vh = /* @__PURE__ */ function(e) {
	return e.Small = "code-small", e.Medium = "code-medium", e.Large = "code-large", e;
}({}), Hh = ({ code: e, lines: t, lineNumbers: n, wrap: r }) => {
	let i = e.split("\n"), a = t?.length ?? i.length;
	return /* @__PURE__ */ A("div", {
		className: "flex min-w-0",
		children: [n ? /* @__PURE__ */ k("div", {
			"aria-hidden": "true",
			className: "shrink-0 select-none py-2 pl-3 pr-2 text-right text-basic-muted border-r border-muted",
			children: Array.from({ length: a }, (e, t) => /* @__PURE__ */ k("div", { children: t + 1 }, t))
		}) : null, /* @__PURE__ */ k("pre", {
			className: F("flex-1 min-w-0 py-2 px-3 text-basic-primary", r ? "whitespace-pre-wrap break-words" : "overflow-x-auto"),
			children: /* @__PURE__ */ k("code", { children: t ? t.map((e, t) => /* @__PURE__ */ k("div", { children: e.length === 0 ? "\xA0" : e.map((e, t) => /* @__PURE__ */ k("span", {
				style: ph(e),
				children: e.text
			}, t)) }, t)) : i.map((e, t) => /* @__PURE__ */ k("div", { children: e || "\xA0" }, t)) })
		})]
	});
}, Uh = ({ code: e, language: t, size: n = "code-small", title: r, lineNumbers: i = !1, wrap: a = !1, copyable: o = !0, expandable: s = !1, maxHeight: c, className: l = "" }) => {
	let [u, d] = C(!1), [f, p] = C(null);
	v(() => {
		if (!t) return;
		let n = !0;
		return Ih(t, e).then((r) => {
			n && p({
				code: e,
				language: t,
				lines: r
			});
		}), () => {
			n = !1;
		};
	}, [t, e]);
	let m = f?.code === e && f.language === t ? f.lines : null, h = /* @__PURE__ */ k(Hh, {
		code: e,
		lines: m,
		lineNumbers: i,
		wrap: a
	}), g = r || o || s;
	return /* @__PURE__ */ A("div", {
		className: F("flex flex-col min-w-0 rounded-[8px] overflow-hidden", "bg-elevation-sublevel-variant-A border border-muted", "code [&>*]:shrink-0", n, l),
		children: [
			g ? /* @__PURE__ */ A("div", {
				className: "flex items-center gap-2 px-3 py-1.5 border-b border-muted",
				children: [
					/* @__PURE__ */ k("div", {
						className: "flex-1 min-w-0 truncate label-micro text-basic-secondary",
						children: r ?? t
					}),
					o ? /* @__PURE__ */ k(Xm, {
						value: e,
						title: "Copy code"
					}) : null,
					s ? /* @__PURE__ */ k(Km, {
						variant: Bm.Tertiary,
						size: zm.Small,
						content: Vm.Icon,
						"aria-label": "Expand code",
						onClick: () => d(!0),
						children: /* @__PURE__ */ k(fs, { iconName: us.FullScreen })
					}) : null
				]
			}) : null,
			/* @__PURE__ */ k("div", {
				className: "min-w-0 overflow-auto",
				style: { maxHeight: c },
				children: h
			}),
			s ? /* @__PURE__ */ k(oh, {
				open: u,
				onClose: () => d(!1),
				title: r ?? t ?? "Code",
				fullScreen: !0,
				flush: !0,
				children: /* @__PURE__ */ k("div", {
					className: F("code", n),
					children: h
				})
			}) : null
		]
	});
};
Uh.Size = Vh;
// src/app/atoms/toast/Toast.tsx
var Wh = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Success = "success", e.Error = "error", e.Danger = "danger", e;
}({}), Gh = {
	info: "text-info-primary",
	success: "text-success-primary",
	error: "text-error-primary",
	danger: "text-danger-primary"
}, Kh = {
	info: us.Info,
	success: us.CheckCircle,
	error: us.Danger,
	danger: us.Danger
}, qh = ({ content: e, variant: t, dismissing: n, onClose: r }) => {
	let [i, a] = C(!1);
	return v(() => {
		let e = requestAnimationFrame(() => a(!0));
		return () => cancelAnimationFrame(e);
	}, []), /* @__PURE__ */ k("div", {
		className: "overflow-hidden",
		children: /* @__PURE__ */ k("div", {
			className: "nac-toast w-full pointer-events-auto",
			"data-visible": i && !n,
			children: /* @__PURE__ */ A("div", {
				className: "nac-toast-content rounded-xl border border-tertiary bg-elevation-level-2 flex gap-3 items-start p-4 pr-14 relative text-basic-primary shadow-lg w-full",
				children: [
					/* @__PURE__ */ k(fs, {
						iconName: Kh[t],
						size: 20,
						className: `shrink-0 mt-0.5 ${Gh[t]}`
					}),
					/* @__PURE__ */ k("span", {
						role: t === "error" || t === "danger" ? "alert" : "status",
						"aria-atomic": "true",
						className: "nac-toast-message flex-grow min-w-0 text-sm leading-5 break-words [overflow-wrap:anywhere] whitespace-pre-line",
						children: e
					}),
					/* @__PURE__ */ k(Km, {
						variant: Km.Variant.Ghost,
						content: Km.Content.Icon,
						className: "nac-toast-dismiss absolute top-1 right-1 !size-11 shrink-0",
						"aria-label": "Dismiss notification",
						onClick: r,
						children: /* @__PURE__ */ k(fs, { iconName: us.Close })
					})
				]
			})
		})
	});
}, Jh = 5e3, Yh = 3e4, L = {
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
}, Xh = (e) => typeof e == "function", R = function(e, t) {
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
}, Zh = (e) => e, Qh = (e) => () => e, $h = /*#__PURE__*/ Qh(!0), eg = /*#__PURE__*/ Qh(!1), tg = /*#__PURE__*/ Qh(void 0), ng = tg;
function z(e, t, n, r, i, a, o, s, c) {
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
var rg = (e) => (t, n) => t === n || e(t, n), ig = /*#__PURE__*/ R(2, (e, t) => rg((n, r) => e(t(n), t(r)))), ag = (e) => rg((t, n) => {
	if (t.length !== n.length) return !1;
	for (let r = 0; r < t.length; r++) if (!e(t[r], n[r])) return !1;
	return !0;
}), og = "effect/GlobalValue", sg, B = (e, t) => (sg ||= (globalThis[og] ??= /* @__PURE__ */ new Map(), globalThis[og]), sg.has(e) || sg.set(e, t()), sg.get(e)), cg = (e) => typeof e == "string", lg = (e) => typeof e == "number", ug = (e) => typeof e == "bigint", dg = Xh, fg = (e) => typeof e == "object" && !!e, pg = (e) => fg(e) || dg(e), V = /*#__PURE__*/ R(2, (e, t) => pg(e) && t in e), mg = /*#__PURE__*/ R(2, (e, t) => V(e, "_tag") && e._tag === t), hg = (e) => e == null, gg = (e) => typeof e == "string" || V(e, Symbol.iterator), _g = (e) => V(e, "then") && dg(e.then), vg = (e) => `BUG: ${e} - please report an issue at https://github.com/Effect-TS/effect/issues`, yg = class e {
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
}, bg = 335903614, xg = 4150755663, Sg = 1481765933, Cg = 1284865837, wg = 9007199254740992, Tg = 134217728, Eg = class {
	_state;
	constructor(e, t, n, r) {
		return hg(t) && hg(e) ? (t = Math.random() * 4294967295 >>> 0, e = 0) : hg(t) && (t = e, e = 0), hg(r) && hg(n) ? (r = this._state ? this._state[3] : xg, n = this._state ? this._state[2] : bg) : hg(r) && (r = n, n = 0), this._state = new Int32Array([
			0,
			0,
			n >>> 0,
			((r || 0) | 1) >>> 0
		]), this._next(), Og(this._state, this._state[0], this._state[1], e >>> 0, t >>> 0), this._next(), this;
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
		return (e * Tg + t) / wg;
	}
	_next() {
		let e = this._state[0] >>> 0, t = this._state[1] >>> 0;
		Dg(this._state, e, t, Sg, Cg), Og(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
		let n = e >>> 18, r = (t >>> 18 | e << 14) >>> 0;
		n = (n ^ e) >>> 0, r = (r ^ t) >>> 0;
		let i = (r >>> 27 | n << 5) >>> 0, a = e >>> 27, o = (-a >>> 0 & 31) >>> 0;
		return (i >>> a | i << o) >>> 0;
	}
};
function Dg(e, t, n, r, i) {
	let a = (n >>> 16) * (i & 65535) >>> 0, o = (n & 65535) * (i >>> 16) >>> 0, s = (n & 65535) * (i & 65535) >>> 0, c = (n >>> 16) * (i >>> 16) + ((o >>> 16) + (a >>> 16)) >>> 0;
	o = o << 16 >>> 0, s = s + o >>> 0, s >>> 0 < o >>> 0 && (c = c + 1 >>> 0), a = a << 16 >>> 0, s = s + a >>> 0, s >>> 0 < a >>> 0 && (c = c + 1 >>> 0), c = c + Math.imul(n, r) >>> 0, c = c + Math.imul(t, i) >>> 0, e[0] = c, e[1] = s;
}
function Og(e, t, n, r, i) {
	let a = t + r >>> 0, o = n + i >>> 0;
	o >>> 0 < n >>> 0 && (a = a + 1 | 0), e[0] = a, e[1] = o;
}
var kg = /*#__PURE__*/ Symbol.for("effect/Utils/YieldWrap"), Ag = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	[kg]() {
		return this.#e;
	}
};
function jg(e) {
	if (typeof e == "object" && e && kg in e) return e[kg]();
	throw Error(vg("yieldWrapGet"));
}
var Mg = /*#__PURE__*/ B("effect/Utils/isStructuralRegion", () => ({
	enabled: !1,
	tester: void 0
})), Ng = { effect_internal_function: (e) => e() }, Pg = /*#__PURE__*/ Ng.effect_internal_function(() => (/* @__PURE__ */ Error()).stack)?.includes("effect_internal_function") === !0 ? Ng.effect_internal_function : { effect_internal_function: (e) => {
	try {
		return e();
	} finally {}
} }.effect_internal_function;
(function* () {}).constructor;
// node_modules/effect/dist/esm/Hash.js
var Fg = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Hash/randomHashCache"), () => /* @__PURE__ */ new WeakMap()), H = /*#__PURE__*/ Symbol.for("effect/Hash"), U = (e) => {
	if (Mg.enabled === !0) return 0;
	switch (typeof e) {
		case "number": return zg(e);
		case "bigint": return Bg(e.toString(10));
		case "boolean": return Bg(String(e));
		case "symbol": return Bg(String(e));
		case "string": return Bg(e);
		case "undefined": return Bg("undefined");
		case "function":
		case "object": return e === null ? Bg("null") : e instanceof Date ? Number.isNaN(e.getTime()) ? Bg("Invalid Date") : U(e.toISOString()) : e instanceof URL ? U(e.href) : Rg(e) ? e[H]() : Ig(e);
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, Ig = (e) => (Fg.has(e) || Fg.set(e, zg(Math.floor(Math.random() * (2 ** 53 - 1)))), Fg.get(e)), W = (e) => (t) => t * 53 ^ e, Lg = (e) => e & 3221225471 | e >>> 1 & 1073741824, Rg = (e) => V(e, H), zg = (e) => {
	if (e !== e || e === Infinity) return 0;
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return Lg(t);
}, Bg = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return Lg(t);
}, Vg = (e, t) => {
	let n = 12289;
	for (let r = 0; r < t.length; r++) n ^= z(Bg(t[r]), W(U(e[t[r]])));
	return Lg(n);
}, Hg = (e) => Vg(e, Object.keys(e)), Ug = (e) => {
	let t = 6151;
	for (let n = 0; n < e.length; n++) t = z(t, W(U(e[n])));
	return Lg(t);
}, Wg = function() {
	if (arguments.length === 1) {
		let e = arguments[0];
		return function(t) {
			return Object.defineProperty(e, H, {
				value() {
					return t;
				},
				enumerable: !1
			}), t;
		};
	}
	let e = arguments[0], t = arguments[1];
	return Object.defineProperty(e, H, {
		value() {
			return t;
		},
		enumerable: !1
	}), t;
}, G = /*#__PURE__*/ Symbol.for("effect/Equal");
function K() {
	return arguments.length === 1 ? (e) => Gg(e, arguments[0]) : Gg(arguments[0], arguments[1]);
}
function Gg(e, t) {
	if (e === t) return !0;
	let n = typeof e;
	if (n !== typeof t) return !1;
	if (n === "object" || n === "function") {
		if (e !== null && t !== null) {
			if (Kg(e) && Kg(t)) return U(e) === U(t) && e[G](t) ? !0 : Mg.enabled && Mg.tester ? Mg.tester(e, t) : !1;
			if (e instanceof Date && t instanceof Date) {
				let n = e.getTime(), r = t.getTime();
				return n === r || Number.isNaN(n) && Number.isNaN(r);
			}
			if (e instanceof URL && t instanceof URL) return e.href === t.href;
		}
		if (Mg.enabled) {
			if (e === null || t === null) return !1;
			if (Array.isArray(e) && Array.isArray(t)) return e.length === t.length && e.every((e, n) => Gg(e, t[n]));
			if (Object.getPrototypeOf(e) === Object.prototype && Object.getPrototypeOf(t) === Object.prototype) {
				let n = Object.keys(e), r = Object.keys(t);
				if (n.length === r.length) {
					for (let r of n) if (!(r in t && Gg(e[r], t[r]))) return Mg.tester ? Mg.tester(e, t) : !1;
					return !0;
				}
			}
			return Mg.tester ? Mg.tester(e, t) : !1;
		}
	}
	return Mg.enabled && Mg.tester ? Mg.tester(e, t) : !1;
}
var Kg = (e) => V(e, G), qg = () => K, Jg = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), Yg = (e) => {
	try {
		if (V(e, "toJSON") && dg(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(Yg);
	} catch {
		return {};
	}
	return r_(e);
}, Xg = (e) => JSON.stringify(e, null, 2), Zg = (e, t = 2) => {
	if (typeof e == "string") return e;
	try {
		return typeof e == "object" ? Qg(e, t) : String(e);
	} catch {
		return String(e);
	}
}, Qg = (e, t) => {
	let n = [], r = JSON.stringify(e, (e, t) => typeof t == "object" && t ? n.includes(t) ? void 0 : n.push(t) && (t_.fiberRefs !== void 0 && e_(t) ? t[$g](t_.fiberRefs) : t) : t, t);
	return n = void 0, r;
}, $g = /*#__PURE__*/ Symbol.for("effect/Inspectable/Redactable"), e_ = (e) => typeof e == "object" && !!e && $g in e, t_ = /*#__PURE__*/ B("effect/Inspectable/redactableState", () => ({ fiberRefs: void 0 })), n_ = (e, t) => {
	let n = t_.fiberRefs;
	t_.fiberRefs = e;
	try {
		return t();
	} finally {
		t_.fiberRefs = n;
	}
}, r_ = (e) => e_(e) && t_.fiberRefs !== void 0 ? e[$g](t_.fiberRefs) : e, q = (e, t) => {
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
}, i_ = "Async", a_ = "Commit", o_ = "Failure", s_ = "OnFailure", c_ = "OnSuccess", l_ = "OnSuccessAndFailure", u_ = "Success", d_ = "Sync", f_ = "UpdateRuntimeFlags", p_ = "While", m_ = "Iterator", h_ = "WithRuntime", g_ = "Yield", __ = "RevertFlags", v_ = "3.22.2", y_ = () => v_, b_ = /*#__PURE__*/ Symbol.for("effect/Effect"), x_ = /*#__PURE__*/ Symbol.for("effect/Stream"), S_ = /*#__PURE__*/ Symbol.for("effect/Sink"), C_ = /*#__PURE__*/ Symbol.for("effect/Channel"), w_ = {
	/* c8 ignore next */
	_R: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e,
	_V: /*#__PURE__*/ y_()
}, T_ = {
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
}, E_ = {
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
}, D_ = {
	[b_]: w_,
	[x_]: w_,
	[S_]: T_,
	[C_]: E_,
	[G](e) {
		return this === e;
	},
	[H]() {
		return Wg(this, Ig(this));
	},
	[Symbol.iterator]() {
		return new yg(new Ag(this));
	},
	pipe() {
		return q(this, arguments);
	}
}, O_ = {
	[H]() {
		return Wg(this, Hg(this));
	},
	[G](e) {
		let t = Object.keys(this), n = Object.keys(e);
		if (t.length !== n.length) return !1;
		for (let n of t) if (!(n in e && K(this[n], e[n]))) return !1;
		return !0;
	}
}, k_ = {
	...D_,
	_op: a_
}, A_ = {
	...k_,
	...O_
}, j_ = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = k_, e;
}(), M_ = /*#__PURE__*/ Symbol.for("effect/Option"), N_ = {
	...D_,
	[M_]: { _A: (e) => e },
	[Jg]() {
		return this.toJSON();
	},
	toString() {
		return Xg(this.toJSON());
	}
}, P_ = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(N_), {
	_tag: "Some",
	_op: "Some",
	[G](e) {
		return L_(e) && z_(e) && K(this.value, e.value);
	},
	[H]() {
		return Wg(this, W(U(this._tag))(U(this.value)));
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag,
			value: Yg(this.value)
		};
	}
}), F_ = /*#__PURE__*/ U("None"), I_ = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(N_), {
	_tag: "None",
	_op: "None",
	[G](e) {
		return L_(e) && R_(e);
	},
	[H]() {
		return F_;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), L_ = (e) => V(e, M_), R_ = (e) => e._tag === "None", z_ = (e) => e._tag === "Some", B_ = /*#__PURE__*/ Object.create(I_), V_ = (e) => {
	let t = Object.create(P_);
	return t.value = e, t;
}, H_ = /*#__PURE__*/ Symbol.for("effect/Either"), U_ = {
	...D_,
	[H_]: { _R: (e) => e },
	[Jg]() {
		return this.toJSON();
	},
	toString() {
		return Xg(this.toJSON());
	}
}, W_ = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(U_), {
	_tag: "Right",
	_op: "Right",
	[G](e) {
		return K_(e) && J_(e) && K(this.right, e.right);
	},
	[H]() {
		return W(U(this._tag))(U(this.right));
	},
	toJSON() {
		return {
			_id: "Either",
			_tag: this._tag,
			right: Yg(this.right)
		};
	}
}), G_ = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(U_), {
	_tag: "Left",
	_op: "Left",
	[G](e) {
		return K_(e) && q_(e) && K(this.left, e.left);
	},
	[H]() {
		return W(U(this._tag))(U(this.left));
	},
	toJSON() {
		return {
			_id: "Either",
			_tag: this._tag,
			left: Yg(this.left)
		};
	}
}), K_ = (e) => V(e, H_), q_ = (e) => e._tag === "Left", J_ = (e) => e._tag === "Right", Y_ = (e) => {
	let t = Object.create(G_);
	return t.left = e, t;
}, X_ = (e) => {
	let t = Object.create(W_);
	return t.right = e, t;
}, Z_ = Y_, Q_ = q_, $_ = J_, ev = /*#__PURE__*/ (/* @__PURE__ */ R(2, (e, { onLeft: t, onRight: n }) => Q_(e) ? t(e.left) : n(e.right)))({
	onLeft: Zh,
	onRight: Zh
}), tv = (e) => e.length > 0, nv = (e) => (t, n) => t === n ? 0 : e(t, n), rv = /*#__PURE__*/ nv((e, t) => e < t ? -1 : 1), iv = /*#__PURE__*/ R(2, (e, t) => nv((n, r) => e(t(n), t(r)))), av = (e) => R(2, (t, n) => e(t, n) === 1), J = () => B_, Y = V_, ov = R_, sv = z_, cv = /*#__PURE__*/ R(2, (e, { onNone: t, onSome: n }) => ov(e) ? t() : n(e.value)), lv = /*#__PURE__*/ R(2, (e, t) => ov(e) ? t() : e.value), uv = /*#__PURE__*/ R(2, (e, t) => ov(e) ? Y(t()) : e), dv = (e) => e == null ? J() : Y(e), fv = /*#__PURE__*/ lv(tg), pv = /*#__PURE__*/ R(2, (e, t) => ov(e) ? J() : Y(t(e.value))), mv = /*#__PURE__*/ R(2, (e, t) => ov(e) ? J() : t(e.value)), hv = /*#__PURE__*/ ((e) => R(2, (t, n) => !ov(t) && e(t.value, n)))(/* @__PURE__ */ qg()), gv = (...e) => e, _v = (e) => Array(e), vv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Math.max(1, Math.floor(e)), r = Array(n);
	for (let e = 0; e < n; e++) r[e] = t(e);
	return r;
}), yv = (e) => Array.isArray(e) ? e : Array.from(e), bv = (e) => Array.isArray(e) ? e : [e], xv = /*#__PURE__*/ R(2, (e, t) => [t, ...e]), Sv = /*#__PURE__*/ R(2, (e, t) => [...e, t]), Cv = /*#__PURE__*/ R(2, (e, t) => yv(e).concat(yv(t)));
Array.isArray;
var wv = (e) => e.length === 0, Tv = tv, Ev = tv, Dv = (e, t) => e < 0 || e >= t.length, Ov = (e, t) => Math.floor(Math.min(Math.max(0, e), t.length)), kv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Math.floor(t);
	return Dv(n, e) ? J() : Y(e[n]);
}), Av = /*#__PURE__*/ R(2, (e, t) => {
	let n = Math.floor(t);
	if (Dv(n, e)) throw Error(`Index ${n} out of bounds`);
	return e[n];
}), jv = /*#__PURE__*/ kv(0), Mv = /*#__PURE__*/ Av(0), Nv = (e) => Ev(e) ? Y(Pv(e)) : J(), Pv = (e) => e[e.length - 1], Fv = (e) => e.slice(1), Iv = (e, t) => {
	let n = 0;
	for (let r of e) {
		if (!t(r, n)) break;
		n++;
	}
	return n;
}, Lv = /*#__PURE__*/ R(2, (e, t) => Wv(e, Iv(e, t))), Rv = /*#__PURE__*/ R(2, (e, t) => {
	let n = yv(e);
	return n.slice(Ov(t, n), n.length);
}), zv = (e) => Array.from(e).reverse(), Bv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Array.from(e);
	return n.sort(t), n;
}), Vv = /*#__PURE__*/ R(2, (e, t) => Hv(e, t, gv)), Hv = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = yv(e), i = yv(t);
	if (Ev(r) && Ev(i)) {
		let e = [n(Mv(r), Mv(i))], t = Math.min(r.length, i.length);
		for (let a = 1; a < t; a++) e[a] = n(r[a], i[a]);
		return e;
	}
	return [];
}), Uv = /*#__PURE__*/ qg(), Wv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Array.from(e), r = Math.floor(t);
	return Ev(n) ? r >= 1 ? Gv(n, r) : [[], n] : [n, []];
}), Gv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Math.max(1, Math.floor(t));
	return n >= e.length ? [Kv(e), []] : [xv(e.slice(1, n), Mv(e)), e.slice(n)];
}), Kv = (e) => e.slice(), qv = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = yv(e), i = yv(t);
	return Ev(r) ? Ev(i) ? ny(n)(Cv(r, i)) : r : i;
}), Jv = /*#__PURE__*/ R(2, (e, t) => qv(e, t, Uv)), Yv = () => [], Xv = (e) => [e], Zv = /*#__PURE__*/ R(2, (e, t) => e.map(t)), Qv = /*#__PURE__*/ (/* @__PURE__ */ R(2, (e, t) => {
	if (wv(e)) return [];
	let n = [];
	for (let r = 0; r < e.length; r++) {
		let i = t(e[r], r);
		for (let e = 0; e < i.length; e++) n.push(i[e]);
	}
	return n;
}))(Zh), $v = /*#__PURE__*/ R(3, (e, t, n) => yv(e).reduce((e, t, r) => n(e, t, r), t)), ey = (e, t) => {
	let n = [], r = e, i;
	for (; sv(i = t(r));) {
		let [e, t] = i.value;
		n.push(e), r = t;
	}
	return n;
}, ty = ag, ny = /*#__PURE__*/ R(2, (e, t) => {
	let n = yv(e);
	if (Ev(n)) {
		let e = [Mv(n)], r = Fv(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), ry = (e) => ny(e, qg()), iy = /*#__PURE__*/ R(2, (e, t) => yv(e).join(t)), ay = rv, oy = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"), sy = /*#__PURE__*/ Symbol.for("effect/Context/Tag"), cy = /*#__PURE__*/ Symbol.for("effect/Context/Reference"), ly = /*#__PURE__*/ Symbol.for("effect/STM"), uy = {
	...D_,
	_op: "Tag",
	[ly]: w_,
	[sy]: {
		_Service: (e) => e,
		_Identifier: (e) => e
	},
	toString() {
		return Xg(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Tag",
			key: this.key,
			stack: this.stack
		};
	},
	[Jg]() {
		return this.toJSON();
	},
	of(e) {
		return e;
	},
	context(e) {
		return wy(this, e);
	}
}, dy = {
	...uy,
	[cy]: cy
}, fy = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	let r = Object.create(uy);
	return Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r.key = e, r;
}, py = (e) => () => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	function r() {}
	return Object.setPrototypeOf(r, uy), r.key = e, Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r;
}, my = () => (e, t) => {
	let n = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let r = /* @__PURE__ */ Error();
	Error.stackTraceLimit = n;
	function i() {}
	return Object.setPrototypeOf(i, dy), i.key = e, i.defaultValue = t.defaultValue, Object.defineProperty(i, "stack", { get() {
		return r.stack;
	} }), i;
}, hy = /*#__PURE__*/ Symbol.for("effect/Context"), gy = {
	[hy]: { _Services: (e) => e },
	[G](e) {
		if (yy(e) && this.unsafeMap.size === e.unsafeMap.size) {
			for (let t of this.unsafeMap.keys()) if (!e.unsafeMap.has(t) || !K(this.unsafeMap.get(t), e.unsafeMap.get(t))) return !1;
			return !0;
		}
		return !1;
	},
	[H]() {
		return Wg(this, zg(this.unsafeMap.size));
	},
	pipe() {
		return q(this, arguments);
	},
	toString() {
		return Xg(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Context",
			services: Array.from(this.unsafeMap).map(Yg)
		};
	},
	[Jg]() {
		return this.toJSON();
	}
}, _y = (e) => {
	let t = Object.create(gy);
	return t.unsafeMap = e, t;
}, vy = (e) => {
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
}, yy = (e) => V(e, hy), by = (e) => V(e, sy), xy = (e) => V(e, cy), Sy = /*#__PURE__*/ _y(/*#__PURE__*/ new Map()), Cy = () => Sy, wy = (e, t) => _y(/* @__PURE__ */ new Map([[e.key, t]])), Ty = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = new Map(e.unsafeMap);
	return r.set(t.key, n), _y(r);
}), Ey = /*#__PURE__*/ B("effect/Context/defaultValueCache", () => /* @__PURE__ */ new Map()), Dy = (e) => {
	if (Ey.has(e.key)) return Ey.get(e.key);
	let t = e.defaultValue();
	return Ey.set(e.key, t), t;
}, Oy = (e, t) => e.unsafeMap.has(t.key) ? e.unsafeMap.get(t.key) : Dy(t), ky = /*#__PURE__*/ R(2, (e, t) => {
	if (!e.unsafeMap.has(t.key)) {
		if (cy in t) return Dy(t);
		throw vy(t);
	}
	return e.unsafeMap.get(t.key);
}), Ay = ky, jy = /*#__PURE__*/ R(2, (e, t) => e.unsafeMap.has(t.key) ? V_(e.unsafeMap.get(t.key)) : xy(t) ? V_(Dy(t)) : B_), My = /*#__PURE__*/ R(2, (e, t) => {
	let n = new Map(e.unsafeMap);
	for (let [e, r] of t.unsafeMap) n.set(e, r);
	return _y(n);
}), Ny = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n = 0; n < e.length; n++) e[n].unsafeMap.forEach((e, n) => {
		t.set(n, e);
	});
	return _y(t);
}, Py = fy, Fy = yy, Iy = by, Ly = Cy, Ry = wy, zy = Ty, By = Ay, Vy = ky, Hy = jy, Uy = My, Wy = Ny, Gy = py, Ky = my, qy = /*#__PURE__*/ Symbol.for("effect/Chunk");
function Jy(e, t, n, r, i) {
	for (let a = t; a < Math.min(e.length, t + i); a++) n[r + a - t] = e[a];
	return n;
}
var Yy = [], Xy = /*#__PURE__*/ ((e) => rg((t, n) => t.length === n.length && ob(t).every((t, r) => e(t, db(n, r)))))(K), Zy = {
	[qy]: { _A: (e) => e },
	toString() {
		return Xg(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Chunk",
			values: ob(this).map(Yg)
		};
	},
	[Jg]() {
		return this.toJSON();
	},
	[G](e) {
		return $y(e) && Xy(this, e);
	},
	[H]() {
		return Wg(this, Ug(ob(this)));
	},
	[Symbol.iterator]() {
		switch (this.backing._tag) {
			case "IArray": return this.backing.array[Symbol.iterator]();
			case "IEmpty": return Yy[Symbol.iterator]();
			default: return ob(this)[Symbol.iterator]();
		}
	},
	pipe() {
		return q(this, arguments);
	}
}, Qy = (e) => {
	let t = Object.create(Zy);
	switch (t.backing = e, e._tag) {
		case "IEmpty":
			t.length = 0, t.depth = 0, t.left = t, t.right = t;
			break;
		case "IConcat":
			t.length = e.left.length + e.right.length, t.depth = 1 + Math.max(e.left.depth, e.right.depth), t.left = e.left, t.right = e.right;
			break;
		case "IArray":
			t.length = e.array.length, t.depth = 0, t.left = eb, t.right = eb;
			break;
		case "ISingleton":
			t.length = 1, t.depth = 0, t.left = eb, t.right = eb;
			break;
		case "ISlice": t.length = e.length, t.depth = e.chunk.depth + 1, t.left = eb, t.right = eb;
	}
	return t;
}, $y = (e) => V(e, qy), eb = /*#__PURE__*/ Qy({ _tag: "IEmpty" }), tb = () => eb, nb = (...e) => ub(e), rb = (e) => Qy({
	_tag: "ISingleton",
	a: e
}), ib = (e) => $y(e) ? e : lb(yv(e)), ab = (e, t, n) => {
	switch (e.backing._tag) {
		case "IArray":
			Jy(e.backing.array, 0, t, n, e.length);
			break;
		case "IConcat":
			ab(e.left, t, n), ab(e.right, t, n + e.left.length);
			break;
		case "ISingleton":
			t[n] = e.backing.a;
			break;
		case "ISlice": {
			let r = 0, i = n;
			for (; r < e.length;) t[i] = db(e, r), r += 1, i += 1;
			break;
		}
	}
}, ob = (e) => {
	switch (e.backing._tag) {
		case "IEmpty": return Yy;
		case "IArray": return e.backing.array;
		default: {
			let t = Array(e.length);
			return ab(e, t, 0), e.backing = {
				_tag: "IArray",
				array: t
			}, e.left = eb, e.right = eb, e.depth = 0, t;
		}
	}
}, sb = (e) => {
	switch (e.backing._tag) {
		case "IEmpty":
		case "ISingleton": return e;
		case "IArray": return Qy({
			_tag: "IArray",
			array: zv(e.backing.array)
		});
		case "IConcat": return Qy({
			_tag: "IConcat",
			left: sb(e.backing.right),
			right: sb(e.backing.left)
		});
		case "ISlice": return lb(zv(ob(e)));
	}
}, cb = /*#__PURE__*/ R(2, (e, t) => t < 0 || t >= e.length ? J() : Y(db(e, t))), lb = (e) => e.length === 0 ? tb() : e.length === 1 ? rb(e[0]) : Qy({
	_tag: "IArray",
	array: e
}), ub = (e) => lb(e), db = /*#__PURE__*/ R(2, (e, t) => {
	switch (e.backing._tag) {
		case "IEmpty": throw Error("Index out of bounds");
		case "ISingleton":
			if (t !== 0) throw Error("Index out of bounds");
			return e.backing.a;
		case "IArray":
			if (t >= e.length || t < 0) throw Error("Index out of bounds");
			return e.backing.array[t];
		case "IConcat": return t < e.left.length ? db(e.left, t) : db(e.right, t - e.left.length);
		case "ISlice": return db(e.backing.chunk, t + e.backing.offset);
	}
}), fb = /*#__PURE__*/ R(2, (e, t) => hb(e, rb(t))), pb = /*#__PURE__*/ R(2, (e, t) => hb(rb(t), e)), mb = /*#__PURE__*/ R(2, (e, t) => {
	if (t <= 0) return e;
	if (t >= e.length) return eb;
	switch (e.backing._tag) {
		case "ISlice": return Qy({
			_tag: "ISlice",
			chunk: e.backing.chunk,
			offset: e.backing.offset + t,
			length: e.backing.length - t
		});
		case "IConcat": return t > e.left.length ? mb(e.right, t - e.left.length) : Qy({
			_tag: "IConcat",
			left: mb(e.left, t),
			right: e.right
		});
		default: return Qy({
			_tag: "ISlice",
			chunk: e,
			offset: t,
			length: e.length - t
		});
	}
}), hb = /*#__PURE__*/ R(2, (e, t) => {
	if (e.backing._tag === "IEmpty") return t;
	if (t.backing._tag === "IEmpty") return e;
	let n = t.depth - e.depth;
	if (Math.abs(n) <= 1) return Qy({
		_tag: "IConcat",
		left: e,
		right: t
	});
	if (n < -1) {
		if (e.left.depth >= e.right.depth) {
			let n = hb(e.right, t);
			return Qy({
				_tag: "IConcat",
				left: e.left,
				right: n
			});
		}
		{
			let n = hb(e.right.right, t);
			if (n.depth === e.depth - 3) {
				let t = Qy({
					_tag: "IConcat",
					left: e.right.left,
					right: n
				});
				return Qy({
					_tag: "IConcat",
					left: e.left,
					right: t
				});
			}
			return Qy({
				_tag: "IConcat",
				left: Qy({
					_tag: "IConcat",
					left: e.left,
					right: e.right.left
				}),
				right: n
			});
		}
	}
	if (t.right.depth >= t.left.depth) return Qy({
		_tag: "IConcat",
		left: hb(e, t.left),
		right: t.right
	});
	{
		let n = hb(e, t.left.left);
		return n.depth === t.depth - 3 ? Qy({
			_tag: "IConcat",
			left: Qy({
				_tag: "IConcat",
				left: n,
				right: t.left.right
			}),
			right: t.right
		}) : Qy({
			_tag: "IConcat",
			left: n,
			right: Qy({
				_tag: "IConcat",
				left: t.left.right,
				right: t.right
			})
		});
	}
}), gb = (e) => e.length === 0, _b = (e) => e.length > 0, vb = /*#__PURE__*/ cb(0), yb = (e) => db(e, 0), bb = yb, xb = (e) => mb(e, 1), Sb = /*#__PURE__*/ Symbol.for("effect/Duration"), Cb = /*#__PURE__*/ BigInt(0), wb = /*#__PURE__*/ BigInt(24), Tb = /*#__PURE__*/ BigInt(60), Eb = /*#__PURE__*/ BigInt(1e3), Db = /*#__PURE__*/ BigInt(1e6), Ob = /*#__PURE__*/ BigInt(1e9), kb = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Ab = (e) => {
	if (Fb(e)) return e;
	if (lg(e)) return Vb(e);
	if (ug(e)) return zb(e);
	if (Array.isArray(e) && e.length === 2 && e.every(lg)) return e[0] === -Infinity || e[1] === -Infinity || Number.isNaN(e[0]) || Number.isNaN(e[1]) ? Lb : e[0] === Infinity || e[1] === Infinity ? Rb : zb(BigInt(Math.round(e[0] * 1e9)) + BigInt(Math.round(e[1])));
	if (cg(e)) {
		let t = kb.exec(e);
		if (t) {
			let [e, n, r] = t, i = Number(n);
			switch (r) {
				case "nano":
				case "nanos": return zb(BigInt(n));
				case "micro":
				case "micros": return Bb(BigInt(n));
				case "milli":
				case "millis": return Vb(i);
				case "second":
				case "seconds": return Hb(i);
				case "minute":
				case "minutes": return Ub(i);
				case "hour":
				case "hours": return Wb(i);
				case "day":
				case "days": return Gb(i);
				case "week":
				case "weeks": return Kb(i);
			}
		}
	}
	throw Error("Invalid DurationInput");
}, jb = {
	_tag: "Millis",
	millis: 0
}, Mb = { _tag: "Infinity" }, Nb = {
	[Sb]: Sb,
	[H]() {
		return Wg(this, Hg(this.value));
	},
	[G](e) {
		return Fb(e) && tx(this, e);
	},
	toString() {
		return `Duration(${rx(this)})`;
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
				hrtime: Yb(this)
			};
			case "Infinity": return {
				_id: "Duration",
				_tag: "Infinity"
			};
		}
	},
	[Jg]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, Pb = (e) => {
	let t = Object.create(Nb);
	return t.value = lg(e) ? isNaN(e) || e <= 0 ? jb : Number.isFinite(e) ? Number.isInteger(e) ? {
		_tag: "Millis",
		millis: e
	} : {
		_tag: "Nanos",
		nanos: BigInt(Math.round(e * 1e6))
	} : Mb : e <= Cb ? jb : {
		_tag: "Nanos",
		nanos: e
	}, t;
}, Fb = (e) => V(e, Sb), Ib = (e) => {
	switch (e.value._tag) {
		case "Millis": return e.value.millis === 0;
		case "Nanos": return e.value.nanos === Cb;
		case "Infinity": return !1;
	}
}, Lb = /*#__PURE__*/ Pb(0), Rb = /*#__PURE__*/ Pb(Infinity), zb = (e) => Pb(e), Bb = (e) => Pb(e * Eb), Vb = (e) => Pb(e), Hb = (e) => Pb(e * 1e3), Ub = (e) => Pb(e * 6e4), Wb = (e) => Pb(e * 36e5), Gb = (e) => Pb(e * 864e5), Kb = (e) => Pb(e * 6048e5), qb = (e) => Xb(e, {
	onMillis: (e) => e,
	onNanos: (e) => Number(e) / 1e6
}), Jb = (e) => {
	let t = Ab(e);
	switch (t.value._tag) {
		case "Infinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return BigInt(Math.round(t.value.millis * 1e6));
	}
}, Yb = (e) => {
	let t = Ab(e);
	switch (t.value._tag) {
		case "Infinity": return [Infinity, 0];
		case "Nanos": return [Number(t.value.nanos / Ob), Number(t.value.nanos % Ob)];
		case "Millis": return [Math.floor(t.value.millis / 1e3), Math.round(t.value.millis % 1e3 * 1e6)];
	}
}, Xb = /*#__PURE__*/ R(2, (e, t) => {
	let n = Ab(e);
	switch (n.value._tag) {
		case "Nanos": return t.onNanos(n.value.nanos);
		case "Infinity": return t.onMillis(Infinity);
		case "Millis": return t.onMillis(n.value.millis);
	}
}), Zb = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = Ab(e), i = Ab(t);
	if (r.value._tag === "Infinity" || i.value._tag === "Infinity") return n.onMillis(qb(r), qb(i));
	if (r.value._tag === "Nanos" || i.value._tag === "Nanos") {
		let e = r.value._tag === "Nanos" ? r.value.nanos : BigInt(Math.round(r.value.millis * 1e6)), t = i.value._tag === "Nanos" ? i.value.nanos : BigInt(Math.round(i.value.millis * 1e6));
		return n.onNanos(e, t);
	}
	return n.onMillis(r.value.millis, i.value.millis);
}), Qb = (e, t) => Zb(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t
}), $b = /*#__PURE__*/ R(2, (e, t) => Zb(e, t, {
	onMillis: (e, t) => e <= t,
	onNanos: (e, t) => e <= t
})), ex = /*#__PURE__*/ R(2, (e, t) => Zb(e, t, {
	onMillis: (e, t) => e >= t,
	onNanos: (e, t) => e >= t
})), tx = /*#__PURE__*/ R(2, (e, t) => Qb(Ab(e), Ab(t))), nx = (e) => {
	let t = Ab(e);
	if (t.value._tag === "Infinity") return {
		days: Infinity,
		hours: Infinity,
		minutes: Infinity,
		seconds: Infinity,
		millis: Infinity,
		nanos: Infinity
	};
	let n = Jb(t), r = n / Db, i = r / Eb, a = i / Tb, o = a / Tb, s = o / wb;
	return {
		days: Number(s),
		hours: Number(o % wb),
		minutes: Number(a % Tb),
		seconds: Number(i % Tb),
		millis: Number(r % Eb),
		nanos: Number(n % Db)
	};
}, rx = (e) => {
	let t = Ab(e);
	if (t.value._tag === "Infinity") return "Infinity";
	if (Ib(t)) return "0";
	let n = nx(t), r = [];
	return n.days !== 0 && r.push(`${n.days}d`), n.hours !== 0 && r.push(`${n.hours}h`), n.minutes !== 0 && r.push(`${n.minutes}m`), n.seconds !== 0 && r.push(`${n.seconds}s`), n.millis !== 0 && r.push(`${n.millis}ms`), n.nanos !== 0 && r.push(`${n.nanos}ns`), r.join(" ");
}, ix = 32, ax = ix - 1, ox = ix / 2, sx = ix / 4;
// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function cx(e) {
	return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), e = e + (e >> 4) & 252645135, e += e >> 8, e += e >> 16, e & 127;
}
function lx(e, t) {
	return t >>> e & ax;
}
function ux(e) {
	return 1 << e;
}
function dx(e, t) {
	return cx(e & t - 1);
}
// node_modules/effect/dist/esm/internal/stack.js
var fx = (e, t) => ({
	value: e,
	previous: t
});
// node_modules/effect/dist/esm/internal/hashMap/array.js
function px(e, t, n, r) {
	let i = r;
	if (!e) {
		let e = r.length;
		i = Array(e);
		for (let t = 0; t < e; ++t) i[t] = r[t];
	}
	return i[t] = n, i;
}
function mx(e, t, n) {
	let r = n.length - 1, i = 0, a = 0, o = n;
	if (e) i = a = t;
	else for (o = Array(r); i < t;) o[a++] = n[i++];
	for (++i; i <= r;) o[a++] = n[i++];
	return e && (o.length = r), o;
}
function hx(e, t, n, r) {
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
var gx = class e {
	_tag = "EmptyNode";
	modify(t, n, r, i, a, o) {
		let s = r(J());
		return ov(s) ? new e() : (++o.value, new bx(t, i, a, s));
	}
};
function _x(e) {
	return mg(e, "EmptyNode");
}
function vx(e) {
	return _x(e) || e._tag === "LeafNode" || e._tag === "CollisionNode";
}
function yx(e, t) {
	return !_x(e) && t === e.edit;
}
var bx = class e {
	edit;
	hash;
	key;
	value;
	_tag = "LeafNode";
	constructor(e, t, n, r) {
		this.edit = e, this.hash = t, this.key = n, this.value = r;
	}
	modify(t, n, r, i, a, o) {
		if (K(a, this.key)) {
			let n = r(this.value);
			return n === this.value ? this : ov(n) ? (--o.value, new gx()) : yx(this, t) ? (this.value = n, this) : new e(t, i, a, n);
		}
		let s = r(J());
		return ov(s) ? this : (++o.value, Dx(t, n, this.hash, this, i, new e(t, i, a, s)));
	}
}, xx = class e {
	edit;
	hash;
	children;
	_tag = "CollisionNode";
	constructor(e, t, n) {
		this.edit = e, this.hash = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		if (i === this.hash) {
			let n = yx(this, t), i = this.updateCollisionList(n, t, this.hash, this.children, r, a, o);
			return i === this.children ? this : i.length > 1 ? new e(t, this.hash, i) : i[0];
		}
		let s = r(J());
		return ov(s) ? this : (++o.value, Dx(t, n, this.hash, this, i, new bx(t, i, a, s)));
	}
	updateCollisionList(e, t, n, r, i, a, o) {
		let s = r.length;
		for (let c = 0; c < s; ++c) {
			let s = r[c];
			if ("key" in s && K(a, s.key)) {
				let l = s.value, u = i(l);
				return u === l ? r : ov(u) ? (--o.value, mx(e, c, r)) : px(e, c, new bx(t, n, a, u), r);
			}
		}
		let c = i(J());
		return ov(c) ? r : (++o.value, px(e, s, new bx(t, n, a, c), r));
	}
}, Sx = class e {
	edit;
	mask;
	children;
	_tag = "IndexedNode";
	constructor(e, t, n) {
		this.edit = e, this.mask = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.mask, c = this.children, l = lx(n, i), u = ux(l), d = dx(s, u), f = s & u, p = yx(this, t);
		if (!f) {
			let f = new gx().modify(t, n + 5, r, i, a, o);
			return f ? c.length >= ox ? Tx(t, l, f, s, c) : new e(t, s | u, hx(p, d, f, c)) : this;
		}
		let m = c[d], h = m.modify(t, n + 5, r, i, a, o);
		if (m === h) return this;
		let g = s, _;
		if (_x(h)) {
			if (g &= ~u, !g) return new gx();
			if (c.length <= 2 && vx(c[d ^ 1])) return c[d ^ 1];
			_ = mx(p, d, c);
		} else _ = px(p, d, h, c);
		return p ? (this.mask = g, this.children = _, this) : new e(t, g, _);
	}
}, Cx = class e {
	edit;
	size;
	children;
	_tag = "ArrayNode";
	constructor(e, t, n) {
		this.edit = e, this.size = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.size, c = this.children, l = lx(n, i), u = c[l], d = (u || new gx()).modify(t, n + 5, r, i, a, o);
		if (u === d) return this;
		let f = yx(this, t), p;
		if (_x(u) && !_x(d)) ++s, p = px(f, l, d, c);
		else if (!_x(u) && _x(d)) {
			if (--s, s <= sx) return wx(t, s, l, c);
			p = px(f, l, new gx(), c);
		} else p = px(f, l, d, c);
		return f ? (this.size = s, this.children = p, this) : new e(t, s, p);
	}
};
function wx(e, t, n, r) {
	let i = Array(t - 1), a = 0, o = 0;
	for (let e = 0, t = r.length; e < t; ++e) if (e !== n) {
		let t = r[e];
		t && !_x(t) && (i[a++] = t, o |= 1 << e);
	}
	return new Sx(e, o, i);
}
function Tx(e, t, n, r, i) {
	let a = [], o = r, s = 0;
	for (let e = 0; o; ++e) o & 1 && (a[e] = i[s++]), o >>>= 1;
	return a[t] = n, new Cx(e, s + 1, a);
}
function Ex(e, t, n, r, i, a) {
	if (n === i) return new xx(e, n, [a, r]);
	let o = lx(t, n), s = lx(t, i);
	if (o === s) return (t) => new Sx(e, ux(o) | ux(s), [t]);
	{
		let t = o < s ? [r, a] : [a, r];
		return new Sx(e, ux(o) | ux(s), t);
	}
}
function Dx(e, t, n, r, i, a) {
	let o, s = t;
	for (;;) {
		let t = Ex(e, s, n, r, i, a);
		if (typeof t == "function") o = fx(t, o), s += 5;
		else {
			let e = t;
			for (; o != null;) e = o.value(e), o = o.previous;
			return e;
		}
	}
}
// node_modules/effect/dist/esm/internal/hashMap.js
var Ox = "effect/HashMap", kx = /*#__PURE__*/ Symbol.for(Ox), Ax = {
	[kx]: kx,
	[Symbol.iterator]() {
		return new Mx(this, (e, t) => [e, t]);
	},
	[H]() {
		let e = U(Ox);
		for (let t of this) e ^= z(U(t[0]), W(U(t[1])));
		return Wg(this, e);
	},
	[G](e) {
		if (zx(e)) {
			if (e._size !== this._size) return !1;
			for (let t of this) {
				let n = z(e, Hx(t[0], U(t[0])));
				if (ov(n) || !K(t[1], n.value)) return !1;
			}
			return !0;
		}
		return !1;
	},
	toString() {
		return Xg(this.toJSON());
	},
	toJSON() {
		return {
			_id: "HashMap",
			values: Array.from(this).map(Yg)
		};
	},
	[Jg]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, jx = (e, t, n, r) => {
	let i = Object.create(Ax);
	return i._editable = e, i._edit = t, i._root = n, i._size = r, i;
}, Mx = class e {
	map;
	f;
	v;
	constructor(e, t) {
		this.map = e, this.f = t, this.v = Px(this.map._root, this.f, void 0);
	}
	next() {
		if (ov(this.v)) return {
			done: !0,
			value: void 0
		};
		let e = this.v.value;
		return this.v = Nx(e.cont), {
			done: !1,
			value: e.value
		};
	}
	[Symbol.iterator]() {
		return new e(this.map, this.f);
	}
}, Nx = (e) => e ? Fx(e[0], e[1], e[2], e[3], e[4]) : J(), Px = (e, t, n = void 0) => {
	switch (e._tag) {
		case "LeafNode": return sv(e.value) ? Y({
			value: t(e.key, e.value.value),
			cont: n
		}) : Nx(n);
		case "CollisionNode":
		case "ArrayNode":
		case "IndexedNode": {
			let r = e.children;
			return Fx(r.length, r, 0, t, n);
		}
		default: return Nx(n);
	}
}, Fx = (e, t, n, r, i) => {
	for (; n < e;) {
		let a = t[n++];
		if (a && !_x(a)) return Px(a, r, [
			e,
			t,
			n,
			r,
			i
		]);
	}
	return Nx(i);
}, Ix = /*#__PURE__*/ jx(!1, 0, /*#__PURE__*/ new gx(), 0), Lx = () => Ix, Rx = (e) => {
	let t = Jx(Lx());
	for (let n of e) Wx(t, n[0], n[1]);
	return Yx(t);
}, zx = (e) => V(e, kx), Bx = (e) => e && _x(e._root), Vx = /*#__PURE__*/ R(2, (e, t) => Hx(e, t, U(t))), Hx = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = e._root, i = 0;
	for (;;) switch (r._tag) {
		case "LeafNode": return K(t, r.key) ? r.value : J();
		case "CollisionNode":
			if (n === r.hash) {
				let e = r.children;
				for (let n = 0, r = e.length; n < r; ++n) {
					let r = e[n];
					if ("key" in r && K(t, r.key)) return r.value;
				}
			}
			return J();
		case "IndexedNode": {
			let e = ux(lx(i, n));
			if (r.mask & e) {
				r = r.children[dx(r.mask, e)], i += 5;
				break;
			}
			return J();
		}
		case "ArrayNode":
			if (r = r.children[lx(i, n)], r) {
				i += 5;
				break;
			}
			return J();
		default: return J();
	}
}), Ux = /*#__PURE__*/ R(2, (e, t) => sv(Hx(e, t, U(t)))), Wx = /*#__PURE__*/ R(3, (e, t, n) => Xx(e, t, () => Y(n))), Gx = /*#__PURE__*/ R(3, (e, t, n) => e._editable ? (e._root = t, e._size = n, e) : t === e._root ? e : jx(e._editable, e._edit, t, n)), Kx = (e) => new Mx(e, (e) => e), qx = (e) => e._size, Jx = (e) => jx(!0, e._edit + 1, e._root, e._size), Yx = (e) => (e._editable = !1, e), Xx = /*#__PURE__*/ R(3, (e, t, n) => Zx(e, t, U(t), n)), Zx = /*#__PURE__*/ R(4, (e, t, n, r) => {
	let i = { value: e._size };
	return z(e, Gx(e._root.modify(e._editable ? e._edit : NaN, 0, r, n, t, i), i.value));
}), Qx = /*#__PURE__*/ R(2, (e, t) => Xx(e, t, J)), $x = /*#__PURE__*/ R(2, (e, t) => tS(e, Lx(), (e, n, r) => Wx(e, r, t(n, r)))), eS = /*#__PURE__*/ R(2, (e, t) => tS(e, void 0, (e, n, r) => t(n, r))), tS = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = e._root;
	if (r._tag === "LeafNode") return sv(r.value) ? n(t, r.value.value, r.key) : t;
	if (r._tag === "EmptyNode") return t;
	let i = [r.children], a;
	for (; a = i.pop();) for (let e = 0, r = a.length; e < r;) {
		let r = a[e++];
		r && !_x(r) && (r._tag === "LeafNode" ? sv(r.value) && (t = n(t, r.value.value, r.key)) : i.push(r.children));
	}
	return t;
}), nS = "effect/HashSet", rS = /*#__PURE__*/ Symbol.for(nS), iS = {
	[rS]: rS,
	[Symbol.iterator]() {
		return Kx(this._keyMap);
	},
	[H]() {
		return Wg(this, W(U(this._keyMap))(U(nS)));
	},
	[G](e) {
		return oS(e) ? qx(this._keyMap) === qx(e._keyMap) && K(this._keyMap, e._keyMap) : !1;
	},
	toString() {
		return Xg(this.toJSON());
	},
	toJSON() {
		return {
			_id: "HashSet",
			values: Array.from(this).map(Yg)
		};
	},
	[Jg]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, aS = (e) => {
	let t = Object.create(iS);
	return t._keyMap = e, t;
}, oS = (e) => V(e, rS), sS = /*#__PURE__*/ aS(/*#__PURE__*/ Lx()), cS = () => sS, lS = (e) => {
	let t = pS(cS());
	for (let n of e) gS(t, n);
	return mS(t);
}, uS = (...e) => {
	let t = pS(cS());
	for (let n of e) gS(t, n);
	return mS(t);
}, dS = /*#__PURE__*/ R(2, (e, t) => Ux(e._keyMap, t)), fS = (e) => qx(e._keyMap), pS = (e) => aS(Jx(e._keyMap)), mS = (e) => (e._keyMap._editable = !1, e), hS = /*#__PURE__*/ R(2, (e, t) => {
	let n = pS(e);
	return t(n), mS(n);
}), gS = /*#__PURE__*/ R(2, (e, t) => e._keyMap._editable ? (Wx(t, !0)(e._keyMap), e) : aS(Wx(t, !0)(e._keyMap))), _S = /*#__PURE__*/ R(2, (e, t) => e._keyMap._editable ? (Qx(t)(e._keyMap), e) : aS(Qx(t)(e._keyMap))), vS = /*#__PURE__*/ R(2, (e, t) => hS(e, (e) => {
	for (let n of t) _S(e, n);
})), yS = /*#__PURE__*/ R(2, (e, t) => hS(cS(), (n) => {
	bS(e, (e) => gS(n, e));
	for (let e of t) gS(n, e);
})), bS = /*#__PURE__*/ R(2, (e, t) => eS(e._keyMap, (e, n) => t(n))), xS = /*#__PURE__*/ R(3, (e, t, n) => tS(e._keyMap, t, (e, t, r) => n(e, r))), SS = cS, CS = lS, wS = uS, TS = dS, ES = fS, DS = gS, OS = _S, kS = vS, AS = yS, jS = xS, MS = /*#__PURE__*/ Symbol.for("effect/MutableRef"), NS = {
	[MS]: MS,
	toString() {
		return Xg(this.toJSON());
	},
	toJSON() {
		return {
			_id: "MutableRef",
			current: Yg(this.current)
		};
	},
	[Jg]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, PS = (e) => {
	let t = Object.create(NS);
	return t.current = e, t;
}, FS = (e) => e.current, IS = /*#__PURE__*/ R(2, (e, t) => (e.current = t, e)), LS = "effect/FiberId", RS = /*#__PURE__*/ Symbol.for(LS), zS = "None", BS = "Runtime", VS = "Composite", HS = /*#__PURE__*/ Bg(`${LS}-${zS}`), US = class {
	[RS] = RS;
	_tag = zS;
	id = -1;
	startTimeMillis = -1;
	[H]() {
		return HS;
	}
	[G](e) {
		return KS(e) && e._tag === zS;
	}
	toString() {
		return Xg(this.toJSON());
	}
	toJSON() {
		return {
			_id: "FiberId",
			_tag: this._tag
		};
	}
	[Jg]() {
		return this.toJSON();
	}
}, WS = class {
	id;
	startTimeMillis;
	[RS] = RS;
	_tag = BS;
	constructor(e, t) {
		this.id = e, this.startTimeMillis = t;
	}
	[H]() {
		return Wg(this, Bg(`${LS}-${this._tag}-${this.id}-${this.startTimeMillis}`));
	}
	[G](e) {
		return KS(e) && e._tag === BS && this.id === e.id && this.startTimeMillis === e.startTimeMillis;
	}
	toString() {
		return Xg(this.toJSON());
	}
	toJSON() {
		return {
			_id: "FiberId",
			_tag: this._tag,
			id: this.id,
			startTimeMillis: this.startTimeMillis
		};
	}
	[Jg]() {
		return this.toJSON();
	}
}, GS = /*#__PURE__*/ new US(), KS = (e) => V(e, RS), qS = (e) => {
	switch (e._tag) {
		case zS: return SS();
		case BS: return wS(e.id);
		case VS: return z(qS(e.left), AS(qS(e.right)));
	}
}, JS = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => PS(0)), YS = (e) => Array.from(qS(e)).map((e) => `#${e}`).join(","), XS = () => {
	let e = FS(JS);
	return z(JS, IS(e + 1)), new WS(e, Date.now());
}, ZS = GS, QS = qS, $S = YS, eC = XS, tC = Lx, nC = Rx, rC = Bx, iC = Vx, aC = Wx, oC = Kx, sC = Xx, cC = $x, lC = tS, uC = /*#__PURE__*/ Symbol.for("effect/List"), dC = (e) => yv(e), fC = /*#__PURE__*/ ((e) => ig(ty(e), dC))(K), pC = {
	[uC]: uC,
	_tag: "Cons",
	toString() {
		return Xg(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Cons",
			values: dC(this).map(Yg)
		};
	},
	[Jg]() {
		return this.toJSON();
	},
	[G](e) {
		return _C(e) && this._tag === e._tag && fC(this, e);
	},
	[H]() {
		return Wg(this, Ug(dC(this)));
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
		return q(this, arguments);
	}
}, mC = (e, t) => {
	let n = Object.create(pC);
	return n.head = e, n.tail = t, n;
}, hC = /*#__PURE__*/ Bg("Nil"), gC = /*#__PURE__*/ Object.create({
	[uC]: uC,
	_tag: "Nil",
	toString() {
		return Xg(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Nil"
		};
	},
	[Jg]() {
		return this.toJSON();
	},
	[H]() {
		return hC;
	},
	[G](e) {
		return _C(e) && this._tag === e._tag;
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
		return q(this, arguments);
	}
}), _C = (e) => V(e, uC), vC = (e) => e._tag === "Nil", yC = (e) => e._tag === "Cons", bC = () => gC, xC = (e, t) => mC(e, t), SC = bC, CC = (e) => mC(e, gC), wC = /*#__PURE__*/ R(2, (e, t) => EC(t, e)), TC = /*#__PURE__*/ R(2, (e, t) => xC(t, e)), EC = /*#__PURE__*/ R(2, (e, t) => {
	if (vC(e)) return t;
	if (vC(t)) return e;
	{
		let n = mC(t.head, e), r = n, i = t.tail;
		for (; !vC(i);) {
			let t = mC(i.head, e);
			r.tail = t, r = t, i = i.tail;
		}
		return n;
	}
}), DC = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = t, i = e;
	for (; !vC(i);) r = n(r, i.head), i = i.tail;
	return r;
}), OC = (e) => {
	let t = SC(), n = e;
	for (; !vC(n);) t = TC(t, n.head), n = n.tail;
	return t;
};
Array.prototype;
var kC = /*#__PURE__*/ function() {
	function e(e) {
		e && Object.assign(this, e);
	}
	return e.prototype = O_, e;
}(), AC = /*#__PURE__*/ Symbol.for("effect/DifferContextPatch");
function jC(e) {
	return e;
}
var MC = {
	...kC.prototype,
	[AC]: {
		_Value: jC,
		_Patch: jC
	}
}, NC = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(MC), { _tag: "Empty" })), PC = () => NC, FC = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(MC), { _tag: "AndThen" }), IC = (e, t) => {
	let n = Object.create(FC);
	return n.first = e, n.second = t, n;
}, LC = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(MC), { _tag: "AddService" }), RC = (e, t) => {
	let n = Object.create(LC);
	return n.key = e, n.service = t, n;
}, zC = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(MC), { _tag: "RemoveService" }), BC = (e) => {
	let t = Object.create(zC);
	return t.key = e, t;
}, VC = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(MC), { _tag: "UpdateService" }), HC = (e, t) => {
	let n = Object.create(VC);
	return n.key = e, n.update = t, n;
}, UC = (e, t) => {
	let n = new Map(e.unsafeMap), r = PC();
	for (let [e, i] of t.unsafeMap.entries()) if (n.has(e)) {
		let t = n.get(e);
		n.delete(e), K(t, i) || (r = WC(HC(e, () => i))(r));
	} else n.delete(e), r = WC(RC(e, i))(r);
	for (let [e] of n.entries()) r = WC(BC(e))(r);
	return r;
}, WC = /*#__PURE__*/ R(2, (e, t) => IC(e, t)), GC = /*#__PURE__*/ R(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = !1, r = rb(e), i = new Map(t.unsafeMap);
	for (; _b(r);) {
		let e = bb(r), t = xb(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AddService":
				i.set(e.key, e.service), r = t;
				break;
			case "AndThen":
				r = pb(pb(t, e.second), e.first);
				break;
			case "RemoveService":
				i.delete(e.key), r = t;
				break;
			case "UpdateService": i.set(e.key, e.update(i.get(e.key))), n = !0, r = t;
		}
	}
	if (!n) return _y(i);
	let a = /* @__PURE__ */ new Map();
	for (let [e] of t.unsafeMap) i.has(e) && (a.set(e, i.get(e)), i.delete(e));
	for (let [e, t] of i) a.set(e, t);
	return _y(a);
}), KC = /*#__PURE__*/ Symbol.for("effect/DifferHashSetPatch");
function qC(e) {
	return e;
}
var JC = {
	...kC.prototype,
	[KC]: {
		_Value: qC,
		_Key: qC,
		_Patch: qC
	}
}, YC = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(JC), { _tag: "Empty" })), XC = () => YC, ZC = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(JC), { _tag: "AndThen" }), QC = (e, t) => {
	let n = Object.create(ZC);
	return n.first = e, n.second = t, n;
}, $C = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(JC), { _tag: "Add" }), ew = (e) => {
	let t = Object.create($C);
	return t.value = e, t;
}, tw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(JC), { _tag: "Remove" }), nw = (e) => {
	let t = Object.create(tw);
	return t.value = e, t;
}, rw = (e, t) => {
	let [n, r] = jS([e, XC()], ([e, t], n) => TS(n)(e) ? [OS(n)(e), t] : [e, iw(ew(n))(t)])(t);
	return jS(r, (e, t) => iw(nw(t))(e))(n);
}, iw = /*#__PURE__*/ R(2, (e, t) => QC(e, t)), aw = /*#__PURE__*/ R(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = t, r = rb(e);
	for (; _b(r);) {
		let e = bb(r), t = xb(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AndThen":
				r = pb(e.first)(pb(e.second)(t));
				break;
			case "Add":
				n = DS(e.value)(n), r = t;
				break;
			case "Remove": n = OS(e.value)(n), r = t;
		}
	}
	return n;
}), ow = /*#__PURE__*/ Symbol.for("effect/DifferReadonlyArrayPatch");
function sw(e) {
	return e;
}
var cw = {
	...kC.prototype,
	[ow]: {
		_Value: sw,
		_Patch: sw
	}
}, lw = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(cw), { _tag: "Empty" })), uw = () => lw, dw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(cw), { _tag: "AndThen" }), fw = (e, t) => {
	let n = Object.create(dw);
	return n.first = e, n.second = t, n;
}, pw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(cw), { _tag: "Append" }), mw = (e) => {
	let t = Object.create(pw);
	return t.values = e, t;
}, hw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(cw), { _tag: "Slice" }), gw = (e, t) => {
	let n = Object.create(hw);
	return n.from = e, n.until = t, n;
}, _w = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(cw), { _tag: "Update" }), vw = (e, t) => {
	let n = Object.create(_w);
	return n.index = e, n.patch = t, n;
}, yw = (e) => {
	let t = 0, n = uw();
	for (; t < e.oldValue.length && t < e.newValue.length;) {
		let r = e.oldValue[t], i = e.newValue[t], a = e.differ.diff(r, i);
		K(a, e.differ.empty) || (n = bw(n, vw(t, a))), t += 1;
	}
	return t < e.oldValue.length && (n = bw(n, gw(0, t))), t < e.newValue.length && (n = bw(n, mw(Rv(t)(e.newValue)))), n;
}, bw = /*#__PURE__*/ R(2, (e, t) => fw(e, t)), xw = /*#__PURE__*/ R(3, (e, t, n) => {
	if (e._tag === "Empty") return t;
	let r = t.slice(), i = Xv(e);
	for (; Tv(i);) {
		let e = Mv(i), t = Fv(i);
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
}), Sw = {
	[/* @__PURE__ */ Symbol.for("effect/Differ")]: {
		_P: Zh,
		_V: Zh
	},
	pipe() {
		return q(this, arguments);
	}
}, Cw = (e) => {
	let t = Object.create(Sw);
	return t.empty = e.empty, t.diff = e.diff, t.combine = e.combine, t.patch = e.patch, t;
}, ww = () => Cw({
	empty: PC(),
	combine: (e, t) => WC(t)(e),
	diff: (e, t) => UC(e, t),
	patch: (e, t) => GC(t)(e)
}), Tw = () => Cw({
	empty: XC(),
	combine: (e, t) => iw(t)(e),
	diff: (e, t) => rw(e, t),
	patch: (e, t) => aw(t)(e)
}), Ew = (e) => Cw({
	empty: uw(),
	combine: (e, t) => bw(e, t),
	diff: (t, n) => yw({
		oldValue: t,
		newValue: n,
		differ: e
	}),
	patch: (t, n) => xw(t, n, e)
}), Dw = () => Ow((e, t) => t), Ow = (e) => Cw({
	empty: Zh,
	combine: (e, t) => e === Zh ? t : t === Zh ? e : (n) => t(e(n)),
	diff: (e, t) => K(e, t) ? Zh : Qh(t),
	patch: (t, n) => e(n, t(n))
}), kw = 255, Aw = 8, jw = (e) => e & kw, Mw = (e) => e >> Aw & kw, Nw = (e, t) => (e & kw) + ((t & e & kw) << Aw), Pw = /*#__PURE__*/ Nw(0, 0), Fw = (e) => Nw(e, e), Iw = (e) => Nw(e, 0), Lw = /*#__PURE__*/ R(2, (e, t) => Nw(jw(e) & ~t, Mw(e))), Rw = /*#__PURE__*/ R(2, (e, t) => e | t), zw = (e) => ~e >>> 0 & kw, Bw = (e) => Gw(e, 32), Vw = /*#__PURE__*/ R(2, (e, t) => e & ~t), Hw = /*#__PURE__*/ R(2, (e, t) => e | t), Uw = (e) => Ww(e) && !Yw(e), Ww = (e) => Gw(e, 1), Gw = /*#__PURE__*/ R(2, (e, t) => (e & t) !== 0), Kw = (...e) => e.reduce((e, t) => e | t, 0), qw = /*#__PURE__*/ Kw(0), Jw = (e) => Gw(e, 4), Yw = (e) => Gw(e, 16), Xw = /*#__PURE__*/ R(2, (e, t) => Nw(e ^ t, t)), Zw = /*#__PURE__*/ R(2, (e, t) => e & (zw(jw(t)) | Mw(t)) | jw(t) & Mw(t)), Qw = /*#__PURE__*/ Cw({
	empty: Pw,
	diff: (e, t) => Xw(e, t),
	combine: (e, t) => Rw(t)(e),
	patch: (e, t) => Zw(t, e)
}), $w = Fw, eT = Iw, tT = Lw, nT = (e, t) => ({
	_tag: "Par",
	left: e,
	right: t
}), rT = (e, t) => ({
	_tag: "Seq",
	left: e,
	right: t
}), iT = (e) => {
	let t = CC(e), n = SC();
	for (;;) {
		let [e, r] = DC(t, [uT(), SC()], ([e, t], n) => {
			let [r, i] = aT(n);
			return [fT(e, r), wC(t, i)];
		});
		if (n = oT(n, e), vC(r)) return OC(n);
		t = r;
	}
	throw Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, aT = (e) => {
	let t = e, n = uT(), r = SC(), i = SC();
	for (;;) switch (t._tag) {
		case "Empty":
			if (vC(r)) return [n, i];
			t = r.head, r = r.tail;
			break;
		case "Par":
			r = xC(t.right, r), t = t.left;
			break;
		case "Seq": {
			let e = t.left, n = t.right;
			switch (e._tag) {
				case "Empty":
					t = n;
					break;
				case "Par": {
					let r = e.left, i = e.right;
					t = nT(rT(r, n), rT(i, n));
					break;
				}
				case "Seq": {
					let r = e.left, i = e.right;
					t = rT(r, rT(i, n));
					break;
				}
				case "Single": t = e, i = xC(n, i);
			}
			break;
		}
		case "Single":
			if (n = dT(n, t), vC(r)) return [n, i];
			t = r.head, r = r.tail;
	}
	throw Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, oT = (e, t) => {
	if (vC(e)) return CC(hT(t));
	if (pT(t)) return e;
	let n = xT(e.head), r = mT(t);
	return n.length === 1 && r.length === 1 && K(n[0], r[0]) ? xC(bT(e.head, hT(t)), e.tail) : xC(hT(t), e);
}, sT = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockParallel"), cT = {
/* c8 ignore next */
_R: (e) => e }, lT = class {
	map;
	[sT] = cT;
	constructor(e) {
		this.map = e;
	}
}, uT = () => new lT(tC()), dT = (e, t) => new lT(sC(e.map, t.dataSource, (e) => uv(pv(e, fb(t.blockedRequest)), () => rb(t.blockedRequest)))), fT = (e, t) => new lT(lC(e.map, t.map, (e, t, n) => aC(e, n, cv(iC(e, n), {
	onNone: () => t,
	onSome: (e) => hb(t, e)
})))), pT = (e) => rC(e.map), mT = (e) => Array.from(oC(e.map)), hT = (e) => yT(cC(e.map, (e) => rb(e))), gT = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockSequential"), _T = {
/* c8 ignore next */
_R: (e) => e }, vT = class {
	map;
	[gT] = _T;
	constructor(e) {
		this.map = e;
	}
}, yT = (e) => new vT(e), bT = (e, t) => new vT(lC(t.map, e.map, (e, t, n) => aC(e, n, cv(iC(e, n), {
	onNone: () => tb(),
	onSome: (e) => hb(e, t)
})))), xT = (e) => Array.from(oC(e.map)), ST = (e) => Array.from(e.map), CT = "Empty", wT = "Fail", TT = "Interrupt", ET = "Parallel", DT = "Sequential", OT = "effect/Cause", kT = /*#__PURE__*/ Symbol.for(OT), AT = {
/* c8 ignore next */
_E: (e) => e }, jT = {
	[kT]: AT,
	[H]() {
		return z(U(OT), W(U(QT(this))), Wg(this));
	},
	[G](e) {
		return RT(e) && ZT(this, e);
	},
	pipe() {
		return q(this, arguments);
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
				defect: Yg(this.defect)
			};
			case "Interrupt": return {
				_id: "Cause",
				_tag: this._tag,
				fiberId: this.fiberId.toJSON()
			};
			case "Fail": return {
				_id: "Cause",
				_tag: this._tag,
				failure: Yg(this.error)
			};
			case "Sequential":
			case "Parallel": return {
				_id: "Cause",
				_tag: this._tag,
				left: Yg(this.left),
				right: Yg(this.right)
			};
		}
	},
	toString() {
		return cE(this);
	},
	[Jg]() {
		return this.toJSON();
	}
}, MT = /*#__PURE__*/ (() => {
	let e = /*#__PURE__*/ Object.create(jT);
	return e._tag = CT, e;
})(), NT = (e) => {
	let t = Object.create(jT);
	return t._tag = wT, t.error = e, t;
}, PT = (e) => {
	let t = Object.create(jT);
	return t._tag = "Die", t.defect = e, t;
}, FT = (e) => {
	let t = Object.create(jT);
	return t._tag = TT, t.fiberId = e, t;
}, IT = (e, t) => {
	let n = Object.create(jT);
	return n._tag = ET, n.left = e, n.right = t, n;
}, LT = (e, t) => {
	let n = Object.create(jT);
	return n._tag = DT, n.left = e, n.right = t, n;
}, RT = (e) => V(e, kT), zT = (e) => e._tag === CT, BT = (e) => e._tag === "Empty" || oE(e, !0, (e, t) => {
	switch (t._tag) {
		case CT: return Y(e);
		case "Die":
		case wT:
		case TT: return Y(!1);
		default: return J();
	}
}), VT = (e) => sv(JT(e)), HT = (e) => sE(void 0, nE)(e), UT = (e) => sb(oE(e, tb(), (e, t) => t._tag === "Fail" ? Y(z(e, pb(t.error))) : J())), WT = (e) => sb(oE(e, tb(), (e, t) => t._tag === "Die" ? Y(z(e, pb(t.defect))) : J())), GT = (e) => oE(e, SS(), (e, t) => t._tag === "Interrupt" ? Y(z(e, DS(t.fiberId))) : J()), KT = (e) => eE(e, (e) => e._tag === "Fail" ? Y(e.error) : J()), qT = (e) => {
	let t = KT(e);
	switch (t._tag) {
		case "None": return X_(e);
		case "Some": return Z_(t.value);
	}
}, JT = (e) => eE(e, (e) => e._tag === "Interrupt" ? Y(e.fiberId) : J()), YT = (e) => aE(e, {
	onEmpty: MT,
	onFail: () => MT,
	onDie: PT,
	onInterrupt: FT,
	onSequential: LT,
	onParallel: IT
}), XT = (e) => aE(e, {
	onEmpty: MT,
	onFail: PT,
	onDie: PT,
	onInterrupt: FT,
	onSequential: LT,
	onParallel: IT
}), ZT = (e, t) => {
	let n = rb(e), r = rb(t);
	for (; _b(n) && _b(r);) {
		let [e, t] = z(bb(n), oE([SS(), tb()], ([e, t], n) => {
			let [r, i] = tE(n);
			return Y([z(e, AS(r)), z(t, hb(i))]);
		})), [i, a] = z(bb(r), oE([SS(), tb()], ([e, t], n) => {
			let [r, i] = tE(n);
			return Y([z(e, AS(r)), z(t, hb(i))]);
		}));
		if (!K(e, i)) return !1;
		n = t, r = a;
	}
	return !0;
}, QT = (e) => $T(rb(e), tb()), $T = (e, t) => {
	for (;;) {
		let [n, r] = z(e, $v([SS(), tb()], ([e, t], n) => {
			let [r, i] = tE(n);
			return [z(e, AS(r)), z(t, hb(i))];
		})), i = ES(n) > 0 ? z(t, pb(n)) : t;
		if (gb(r)) return sb(i);
		e = r, t = i;
	}
	throw Error(vg("Cause.flattenCauseLoop"));
}, eE = /*#__PURE__*/ R(2, (e, t) => {
	let n = [e];
	for (; n.length > 0;) {
		let e = n.pop(), r = t(e);
		switch (r._tag) {
			case "None":
				switch (e._tag) {
					case DT:
					case ET: n.push(e.right), n.push(e.left);
				}
				break;
			case "Some": return r;
		}
	}
	return J();
}), tE = (e) => {
	let t = e, n = [], r = SS(), i = tb();
	for (; t !== void 0;) switch (t._tag) {
		case CT:
			if (n.length === 0) return [r, i];
			t = n.pop();
			break;
		case wT:
			if (r = DS(r, nb(t._tag, t.error)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case "Die":
			if (r = DS(r, nb(t._tag, t.defect)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case TT:
			if (r = DS(r, nb(t._tag, t.fiberId)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case DT:
			switch (t.left._tag) {
				case CT:
					t = t.right;
					break;
				case DT:
					t = LT(t.left.left, LT(t.left.right, t.right));
					break;
				case ET:
					t = IT(LT(t.left.left, t.right), LT(t.left.right, t.right));
					break;
				default: i = pb(i, t.right), t = t.left;
			}
			break;
		case ET: n.push(t.right), t = t.left;
	}
	throw Error(vg("Cause.evaluateCauseLoop"));
}, nE = {
	emptyCase: $h,
	failCase: eg,
	dieCase: eg,
	interruptCase: $h,
	sequentialCase: (e, t, n) => t && n,
	parallelCase: (e, t, n) => t && n
}, rE = "SequentialCase", iE = "ParallelCase", aE = /*#__PURE__*/ R(2, (e, { onDie: t, onEmpty: n, onFail: r, onInterrupt: i, onParallel: a, onSequential: o }) => sE(e, void 0, {
	emptyCase: () => n,
	failCase: (e, t) => r(t),
	dieCase: (e, n) => t(n),
	interruptCase: (e, t) => i(t),
	sequentialCase: (e, t, n) => o(t, n),
	parallelCase: (e, t, n) => a(t, n)
})), oE = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = t, i = e, a = [];
	for (; i !== void 0;) {
		let e = n(r, i);
		switch (r = sv(e) ? e.value : r, i._tag) {
			case DT:
				a.push(i.right), i = i.left;
				break;
			case ET:
				a.push(i.right), i = i.left;
				break;
			default: i = void 0;
		}
		i === void 0 && a.length > 0 && (i = a.pop());
	}
	return r;
}), sE = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._tag) {
			case CT:
				i.push(X_(n.emptyCase(t)));
				break;
			case wT:
				i.push(X_(n.failCase(t, e.error)));
				break;
			case "Die":
				i.push(X_(n.dieCase(t, e.defect)));
				break;
			case TT:
				i.push(X_(n.interruptCase(t, e.fiberId)));
				break;
			case DT:
				r.push(e.right), r.push(e.left), i.push(Z_({ _tag: rE }));
				break;
			case ET: r.push(e.right), r.push(e.left), i.push(Z_({ _tag: iE }));
		}
	}
	let a = [];
	for (; i.length > 0;) {
		let e = i.pop();
		switch (e._tag) {
			case "Left":
				switch (e.left._tag) {
					case rE: {
						let e = a.pop(), r = a.pop(), i = n.sequentialCase(t, e, r);
						a.push(i);
						break;
					}
					case iE: {
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
}), cE = (e, t) => HT(e) ? "All fibers interrupted without errors." : gE(e).map(function(e) {
	return t?.renderErrorCause !== !0 || e.cause === void 0 ? e.stack : `${e.stack} {\n${lE(e.cause, "  ")}\n}`;
}).join("\n"), lE = (e, t) => {
	let n = e.stack.split("\n"), r = `${t}[cause]: ${n[0]}`;
	for (let e = 1, i = n.length; e < i; e++) r += `\n${t}${n[e]}`;
	return e.cause && (r += ` {\n${lE(e.cause, `${t}  `)}\n${t}}`), r;
}, uE = (e) => {
	let t = typeof e == "object" && !!e, n = Error.stackTraceLimit;
	Error.stackTraceLimit = 1;
	let r = Error(dE(e), t && "cause" in e && e.cause !== void 0 ? { cause: uE(e.cause) } : void 0);
	return Error.stackTraceLimit = n, r.message === "" && (r.message = "An error has occurred"), Error.stackTraceLimit = n, r.name = e instanceof Error ? e.name : "Error", t && (hE in e && (r.span = e[hE]), Object.keys(e).forEach((t) => {
		t in r || (r[t] = e[t]);
	})), r.stack = mE(`${r.name}: ${r.message}`, e instanceof Error && e.stack ? e.stack : "", r.span), r;
}, dE = (e) => {
	if (typeof e == "string") return e;
	if (typeof e == "object" && e && e instanceof Error) return e.message;
	try {
		if (V(e, "toString") && dg(e.toString) && e.toString !== Object.prototype.toString && e.toString !== globalThis.Array.prototype.toString) return e.toString();
	} catch {}
	return Qg(e);
}, fE = /\((.*)\)/g, pE = /*#__PURE__*/ B("effect/Tracer/spanToTrace", () => /* @__PURE__ */ new WeakMap()), mE = (e, t, n) => {
	let r = [e], i = t.startsWith(e) ? t.slice(e.length).split("\n") : t.split("\n");
	for (let e = 1; e < i.length; e++) if (i[e].includes(" at new BaseEffectError") || i[e].includes(" at new YieldableError")) e++;
	else {
		if (i[e].includes("Generator.next") || i[e].includes("effect_internal_function")) break;
		r.push(i[e].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
	}
	if (n) {
		let e = n, t = 0;
		for (; e && e._tag === "Span" && t < 10;) {
			let n = pE.get(e);
			if (typeof n == "function") {
				let t = n();
				if (typeof t == "string") {
					let n = t.matchAll(fE), i = !1;
					for (let [, t] of n) i = !0, r.push(`    at ${e.name} (${t})`);
					i || r.push(`    at ${e.name} (${t.replace(/^at /, "")})`);
				} else r.push(`    at ${e.name}`);
			} else r.push(`    at ${e.name}`);
			e = fv(e.parent), t++;
		}
	}
	return r.join("\n");
}, hE = /*#__PURE__*/ Symbol.for("effect/SpanAnnotation"), gE = (e) => sE(e, void 0, {
	emptyCase: () => [],
	dieCase: (e, t) => [uE(t)],
	failCase: (e, t) => [uE(t)],
	interruptCase: () => [],
	parallelCase: (e, t, n) => [...t, ...n],
	sequentialCase: (e, t, n) => [...t, ...n]
}), _E = "Pending", vE = "Done", yE = /*#__PURE__*/ Symbol.for("effect/Deferred"), bE = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, xE = (e) => ({
	_tag: _E,
	joiners: e
}), SE = (e) => ({
	_tag: vE,
	effect: e
}), CE = class e {
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
}, wE = (e, t) => {
	let n = new OE("Blocked");
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}, TE = (e) => {
	let t = new OE("RunBlocked");
	return t.effect_instruction_i0 = e, t;
}, EE = /*#__PURE__*/ Symbol.for("effect/Effect"), DE = class {
	patch;
	op;
	_op = __;
	constructor(e, t) {
		this.patch = e, this.op = t;
	}
}, OE = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[EE] = w_;
	constructor(e) {
		this._op = e;
	}
	[G](e) {
		return this === e;
	}
	[H]() {
		return Wg(this, Ig(this));
	}
	pipe() {
		return q(this, arguments);
	}
	toJSON() {
		return {
			_id: "Effect",
			_op: this._op,
			effect_instruction_i0: Yg(this.effect_instruction_i0),
			effect_instruction_i1: Yg(this.effect_instruction_i1),
			effect_instruction_i2: Yg(this.effect_instruction_i2)
		};
	}
	toString() {
		return Xg(this.toJSON());
	}
	[Jg]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new CE(new Ag(this));
	}
}, kE = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[EE] = w_;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[G](e) {
		return MO(e) && e._op === "Failure" && K(this.effect_instruction_i0, e.effect_instruction_i0);
	}
	[H]() {
		return z(Bg(this._tag), W(U(this.effect_instruction_i0)), Wg(this));
	}
	get cause() {
		return this.effect_instruction_i0;
	}
	pipe() {
		return q(this, arguments);
	}
	toJSON() {
		return {
			_id: "Exit",
			_tag: this._op,
			cause: this.cause.toJSON()
		};
	}
	toString() {
		return Xg(this.toJSON());
	}
	[Jg]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new CE(new Ag(this));
	}
}, AE = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[EE] = w_;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[G](e) {
		return MO(e) && e._op === "Success" && K(this.effect_instruction_i0, e.effect_instruction_i0);
	}
	[H]() {
		return z(Bg(this._tag), W(U(this.effect_instruction_i0)), Wg(this));
	}
	get value() {
		return this.effect_instruction_i0;
	}
	pipe() {
		return q(this, arguments);
	}
	toJSON() {
		return {
			_id: "Exit",
			_tag: this._op,
			value: Yg(this.value)
		};
	}
	toString() {
		return Xg(this.toJSON());
	}
	[Jg]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new CE(new Ag(this));
	}
}, jE = (e) => V(e, EE), ME = (e) => {
	let t = new OE(h_);
	return t.effect_instruction_i0 = e, t;
}, NE = /*#__PURE__*/ R(3, (e, t, n) => hD((r) => X(e, (e) => X(KE(Q(() => r(t(e)))), (t) => Q(() => n(e, t)).pipe(nD({
	onFailure: (e) => {
		switch (t._tag) {
			case o_: return YE(LT(t.effect_instruction_i0, e));
			case u_: return YE(e);
		}
	},
	onSuccess: () => t
})))))), PE = /*#__PURE__*/ R(2, (e, t) => X(e, () => Z(t))), FE = (e) => PE(e, void 0), IE = function() {
	let e = new OE(a_);
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
		default: throw Error(vg("you're not supposed to end up here"));
	}
	return e;
}, LE = (e, t = ZS) => {
	let n = new OE(i_), r;
	return n.effect_instruction_i0 = (t) => {
		r = e(t);
	}, n.effect_instruction_i1 = t, dD(n, (e) => jE(r) ? r : gD);
}, RE = (e, t = ZS) => Q(() => LE(e, t)), zE = (e, t = ZS) => IE(e, function() {
	let e, n;
	function r(t) {
		e ? e(t) : n === void 0 && (n = t);
	}
	let i = new OE(i_);
	i.effect_instruction_i0 = (t) => {
		e = t, n && t(n);
	}, i.effect_instruction_i1 = t;
	let a, o;
	return this.effect_instruction_i0.length === 1 ? a = Pg(() => this.effect_instruction_i0(r)) : (o = new AbortController(), a = Pg(() => this.effect_instruction_i0(r, o.signal))), a || o ? dD(i, (e) => (o && o.abort(), a ?? gD)) : i;
}), BE = /*#__PURE__*/ R(2, (e, t) => rD(e, {
	onFailure: t,
	onSuccess: Z
})), VE = /*#__PURE__*/ Symbol.for("effect/OriginalAnnotation"), HE = (e, t) => sv(t) ? new Proxy(e, {
	has(e, t) {
		return t === hE || t === VE || t in e;
	},
	get(n, r) {
		return r === hE ? t.value : r === VE ? e : n[r];
	}
}) : e, UE = (e) => pg(e) && !(hE in e) ? ME((t) => YE(PT(HE(e, uk(t))))) : YE(PT(e)), WE = (e) => XE(() => PT(new wO(e))), GE = (e) => rD(e, {
	onFailure: (e) => Z(Z_(e)),
	onSuccess: (e) => Z(X_(e))
}), KE = (e) => tD(e, {
	onFailure: BO,
	onSuccess: GO
}), qE = (e) => pg(e) && !(hE in e) ? ME((t) => YE(NT(HE(e, uk(t))))) : YE(NT(e)), JE = (e) => X($(e), qE), YE = (e) => {
	let t = new kE(o_);
	return t.effect_instruction_i0 = e, t;
}, XE = (e) => X($(e), YE), ZE = /*#__PURE__*/ ME((e) => Z(e.id())), QE = (e) => ME((t) => e(t.id())), X = /*#__PURE__*/ R(2, (e, t) => {
	let n = new OE(c_);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}), $E = (e) => {
	let t = new OE("OnStep");
	return t.effect_instruction_i0 = e, t;
}, eD = (e) => X(e, Zh), tD = /*#__PURE__*/ R(2, (e, t) => nD(e, {
	onFailure: (e) => Z(t.onFailure(e)),
	onSuccess: (e) => Z(t.onSuccess(e))
})), nD = /*#__PURE__*/ R(2, (e, t) => {
	let n = new OE(l_);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t.onFailure, n.effect_instruction_i2 = t.onSuccess, n;
}), rD = /*#__PURE__*/ R(2, (e, t) => nD(e, {
	onFailure: (e) => {
		if (WT(e).length > 0) return YE(XT(e));
		let n = UT(e);
		return n.length > 0 ? t.onFailure(yb(n)) : YE(e);
	},
	onSuccess: t.onSuccess
})), iD = /*#__PURE__*/ R(2, (e, t) => Q(() => {
	let n = yv(e), r = _v(n.length), i = 0;
	return PE(yD({
		while: () => i < n.length,
		body: () => t(n[i], i),
		step: (e) => {
			r[i++] = e;
		}
	}), r);
})), aD = /*#__PURE__*/ R(2, (e, t) => Q(() => {
	let n = yv(e), r = 0;
	return yD({
		while: () => r < n.length,
		body: () => t(n[r], r),
		step: () => {
			r++;
		}
	});
})), oD = (e) => {
	let t = new OE(f_);
	return t.effect_instruction_i0 = $w(1), t.effect_instruction_i1 = () => e, t;
}, sD = /*#__PURE__*/ R(2, (e, t) => X(e, (e) => $(() => t(e)))), cD = /*#__PURE__*/ R(2, (e, t) => rD(e, {
	onFailure: (e) => JE(() => t.onFailure(e)),
	onSuccess: (e) => $(() => t.onSuccess(e))
})), lD = /*#__PURE__*/ R(2, (e, t) => nD(e, {
	onFailure: (e) => {
		let n = qT(e);
		switch (n._tag) {
			case "Left": return JE(() => t(n.left));
			case "Right": return YE(n.right);
		}
	},
	onSuccess: Z
})), uD = /*#__PURE__*/ R(2, (e, t) => hD((n) => nD(n(e), {
	onFailure: (e) => {
		let n = BO(e);
		return nD(t(n), {
			onFailure: (t) => BO(LT(e, t)),
			onSuccess: () => n
		});
	},
	onSuccess: (e) => {
		let n = GO(e);
		return DD(t(n), n);
	}
}))), dD = /*#__PURE__*/ R(2, (e, t) => uD(e, UO({
	onFailure: (e) => HT(e) ? FE(t(GT(e))) : gD,
	onSuccess: () => gD
}))), Z = (e) => {
	let t = new AE(u_);
	return t.effect_instruction_i0 = e, t;
}, Q = (e) => {
	let t = new OE(a_);
	return t.commit = e, t;
}, $ = (e) => {
	let t = new OE(d_);
	return t.effect_instruction_i0 = e, t;
}, fD = /*#__PURE__*/ R((e) => e.length === 3 || e.length === 2 && !(pg(e[1]) && "onlyEffect" in e[1]), (e, t) => X(e, (e) => {
	let n = typeof t == "function" ? t(e) : t;
	return jE(n) ? PE(n, e) : _g(n) ? LE((t) => {
		n.then((n) => t(Z(e)), (e) => t(qE(new jO(e, "An unknown error occurred in Effect.tap"))));
	}) : Z(e);
})), pD = (e) => ME((t) => e(GD(dO, Y(z(t.getFiberRef(dO), lv(() => t.scope())))))), mD = (e) => {
	let t = new OE(f_);
	return t.effect_instruction_i0 = eT(1), t.effect_instruction_i1 = () => e, t;
}, hD = (e) => IE(e, function() {
	let e = new OE(f_);
	return e.effect_instruction_i0 = eT(1), e.effect_instruction_i1 = (e) => Ww(e) ? Pg(() => this.effect_instruction_i0(oD)) : Pg(() => this.effect_instruction_i0(mD)), e;
}), gD = /*#__PURE__*/ Z(void 0), _D = (e) => {
	let t = new OE(f_);
	return t.effect_instruction_i0 = e, t.effect_instruction_i1 = void 0, t;
}, vD = /*#__PURE__*/ R(2, (e, t) => X(t, (t) => t ? z(e, sD(Y)) : Z(J()))), yD = (e) => {
	let t = new OE(p_);
	return t.effect_instruction_i0 = e.while, t.effect_instruction_i1 = e.body, t.effect_instruction_i2 = e.step, t;
}, bD = (e) => Q(() => {
	let t = new OE(m_);
	return t.effect_instruction_i0 = e(), t;
}), xD = function() {
	let e = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
	return bD(() => e(z));
}, SD = (e, ...t) => Object.defineProperty(t.length === 0 ? function(...t) {
	return bD(() => e.apply(this, t));
} : function(...n) {
	let r = bD(() => e.apply(this, n));
	for (let e of t) r = e(r, ...n);
	return r;
}, "length", {
	value: e.length,
	configurable: !0
}), CD = /*#__PURE__*/ R(2, (e, t) => {
	let n = new OE(f_);
	return n.effect_instruction_i0 = t, n.effect_instruction_i1 = () => e, n;
}), wD = (e) => {
	let t = new OE(g_);
	return e?.priority === void 0 ? t : aO(t, e.priority);
}, TD = /*#__PURE__*/ R(2, (e, t) => X(e, (e) => sD(t, (t) => [e, t]))), ED = /*#__PURE__*/ R(2, (e, t) => X(e, (e) => PE(t, e))), DD = /*#__PURE__*/ R(2, (e, t) => X(e, () => t)), OD = /*#__PURE__*/ R(3, (e, t, n) => X(e, (e) => sD(t, (t) => n(e, t)))), kD = (e) => X(ZE, (t) => z(e, AD(t))), AD = /*#__PURE__*/ R(2, (e, t) => X(e.interruptAsFork(t), () => e.await)), jD = {
	_tag: "All",
	syslog: 0,
	label: "ALL",
	ordinal: -(2 ** 53 - 1),
	pipe() {
		return q(this, arguments);
	}
}, MD = {
	_tag: "Fatal",
	syslog: 2,
	label: "FATAL",
	ordinal: 5e4,
	pipe() {
		return q(this, arguments);
	}
}, ND = {
	_tag: "Error",
	syslog: 3,
	label: "ERROR",
	ordinal: 4e4,
	pipe() {
		return q(this, arguments);
	}
}, PD = {
	_tag: "Warning",
	syslog: 4,
	label: "WARN",
	ordinal: 3e4,
	pipe() {
		return q(this, arguments);
	}
}, FD = {
	_tag: "Info",
	syslog: 6,
	label: "INFO",
	ordinal: 2e4,
	pipe() {
		return q(this, arguments);
	}
}, ID = {
	_tag: "Debug",
	syslog: 7,
	label: "DEBUG",
	ordinal: 1e4,
	pipe() {
		return q(this, arguments);
	}
}, LD = {
	_tag: "Trace",
	syslog: 7,
	label: "TRACE",
	ordinal: 0,
	pipe() {
		return q(this, arguments);
	}
}, RD = {
	_tag: "None",
	syslog: 7,
	label: "OFF",
	ordinal: 2 ** 53 - 1,
	pipe() {
		return q(this, arguments);
	}
}, zD = /*#__PURE__*/ Symbol.for("effect/FiberRef"), BD = {
/* c8 ignore next */
_A: (e) => e }, VD = (e) => ME((t) => GO(t.getFiberRef(e))), HD = /*#__PURE__*/ R(2, (e, t) => X(VD(e), t)), UD = /*#__PURE__*/ R(2, (e, t) => WD(e, () => [void 0, t])), WD = /*#__PURE__*/ R(2, (e, t) => ME((n) => {
	let [r, i] = t(n.getFiberRef(e));
	return n.setFiberRef(e, i), Z(r);
})), GD = /*#__PURE__*/ R(3, (e, t, n) => NE(ED(VD(t), UD(t, n)), () => e, (e) => UD(t, e))), KD = /*#__PURE__*/ R(3, (e, t, n) => HD(t, (r) => GD(e, t, n(r)))), qD = (e, t) => ZD(e, {
	differ: Dw(),
	fork: t?.fork ?? Zh,
	join: t?.join
}), JD = (e) => {
	let t = Tw();
	return ZD(e, {
		differ: t,
		fork: t.empty
	});
}, YD = (e) => {
	let t = Ew(Dw());
	return ZD(e, {
		differ: t,
		fork: t.empty
	});
}, XD = (e) => {
	let t = ww();
	return ZD(e, {
		differ: t,
		fork: t.empty
	});
}, ZD = (e, t) => ({
	...k_,
	[zD]: BD,
	initial: e,
	commit() {
		return VD(this);
	},
	diff: (e, n) => t.differ.diff(e, n),
	combine: (e, n) => t.differ.combine(e, n),
	patch: (e) => (n) => t.differ.patch(e, n),
	fork: t.fork,
	join: t.join ?? ((e, t) => t)
}), QD = (e) => ZD(e, {
	differ: Qw,
	fork: Qw.empty
}), $D = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentContext"), () => XD(Ly())), eO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => qD(0)), tO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => qD(2048)), nO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => qD(tC())), rO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogLevel"), () => qD(FD)), iO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogSpan"), () => qD(SC())), aO = /*#__PURE__*/ R(2, (e, t) => GD(e, eO, t)), oO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentConcurrency"), () => qD("unbounded")), sO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestBatching"), () => qD(!0)), cO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => qD(Y(ID))), lO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => qD(Y(PD))), uO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMetricLabels"), () => YD(Yv())), dO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => qD(J(), {
	fork: () => J(),
	join: (e, t) => e
})), fO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => qD(MT, {
	fork: () => MT,
	join: (e, t) => e
})), pO = /*#__PURE__*/ Symbol.for("effect/Scope"), mO = /*#__PURE__*/ Symbol.for("effect/CloseableScope"), hO = (e, t) => e.addFinalizer(() => FE(t)), gO = (e, t) => e.addFinalizer(t), _O = (e, t) => e.close(t), vO = (e, t) => e.fork(t), yO = (e) => bO(Zh)(e), bO = /*#__PURE__*/ R(2, (e, t) => {
	let n = z(e, KT, pv(t));
	switch (n._tag) {
		case "None": return z(WT(e), vb, cv({
			onNone: () => {
				let t = yv(GT(e)).flatMap((e) => yv(QS(e)).map((e) => `#${e}`));
				return new EO(t ? `Interrupted by fibers: ${t.join(", ")}` : void 0);
			},
			onSome: Zh
		}));
		case "Some": return n.value;
	}
}), xO = /*#__PURE__*/ function() {
	class e extends globalThis.Error {
		commit() {
			return qE(this);
		}
		toJSON() {
			let e = { ...this };
			return this.message && (e.message = this.message), this.cause && (e.cause = this.cause), e;
		}
		[Jg]() {
			return this.toString === globalThis.Error.prototype.toString ? "Bun" in globalThis ? cE(NT(this), { renderErrorCause: !0 }) : this : this.stack ? `${this.toString()}\n${this.stack.split("\n").slice(1).join("\n")}` : this.toString();
		}
	}
	return Object.assign(e.prototype, A_), e;
}(), SO = (e, t) => {
	class n extends xO {
		_tag = t;
	}
	return Object.assign(n.prototype, e), n.prototype.name = t, n;
}, CO = /*#__PURE__*/ Symbol.for("effect/Cause/errors/RuntimeException"), wO = /*#__PURE__*/ SO({ [CO]: CO }, "RuntimeException"), TO = /*#__PURE__*/ Symbol.for("effect/Cause/errors/InterruptedException"), EO = /*#__PURE__*/ SO({ [TO]: TO }, "InterruptedException"), DO = (e) => V(e, TO), OO = /*#__PURE__*/ Symbol.for("effect/Cause/errors/NoSuchElement"), kO = /*#__PURE__*/ SO({ [OO]: OO }, "NoSuchElementException"), AO = /*#__PURE__*/ Symbol.for("effect/Cause/errors/UnknownException"), jO = /*#__PURE__*/ function() {
	class e extends xO {
		_tag = "UnknownException";
		error;
		constructor(e, t) {
			super(t ?? "An unknown error occurred", { cause: e }), this.error = e;
		}
	}
	return Object.assign(e.prototype, {
		[AO]: AO,
		name: "UnknownException"
	}), e;
}(), MO = (e) => jE(e) && "_tag" in e && (e._tag === "Success" || e._tag === "Failure"), NO = (e) => e._tag === "Failure", PO = (e) => e._tag === "Success", FO = /*#__PURE__*/ R(2, (e, t) => {
	switch (e._tag) {
		case o_: return BO(e.effect_instruction_i0);
		case u_: return GO(t);
	}
}), IO = (e) => FO(e, void 0), LO = (e, t) => JO(e, t?.parallel ? IT : LT), RO = (e) => BO(PT(e)), zO = (e) => BO(NT(e)), BO = (e) => {
	let t = new kE(o_);
	return t.effect_instruction_i0 = e, t;
}, VO = (e) => BO(FT(e)), HO = /*#__PURE__*/ R(2, (e, t) => {
	switch (e._tag) {
		case o_: return BO(e.effect_instruction_i0);
		case u_: return GO(t(e.effect_instruction_i0));
	}
}), UO = /*#__PURE__*/ R(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case o_: return t(e.effect_instruction_i0);
		case u_: return n(e.effect_instruction_i0);
	}
}), WO = /*#__PURE__*/ R(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case o_: return t(e.effect_instruction_i0);
		case u_: return n(e.effect_instruction_i0);
	}
}), GO = (e) => {
	let t = new AE(u_);
	return t.effect_instruction_i0 = e, t;
}, KO = /*#__PURE__*/ GO(void 0), qO = /*#__PURE__*/ R(3, (e, t, { onFailure: n, onSuccess: r }) => {
	switch (e._tag) {
		case o_: switch (t._tag) {
			case u_: return BO(e.effect_instruction_i0);
			case o_: return BO(n(e.effect_instruction_i0, t.effect_instruction_i0));
		}
		case u_: switch (t._tag) {
			case u_: return GO(r(e.effect_instruction_i0, t.effect_instruction_i0));
			case o_: return BO(t.effect_instruction_i0);
		}
	}
}), JO = (e, t) => {
	let n = ib(e);
	return _b(n) ? z(xb(n), $v(z(bb(n), HO(rb)), (e, n) => z(e, qO(n, {
		onSuccess: (e, t) => z(e, pb(t)),
		onFailure: t
	}))), HO(sb), HO((e) => ob(e)), Y) : J();
}, YO = (e) => ({
	...k_,
	[yE]: bE,
	state: PS(xE([])),
	commit() {
		return QO(this);
	},
	blockingOn: e
}), XO = () => X(ZE, (e) => ZO(e)), ZO = (e) => $(() => YO(e)), QO = (e) => RE((t) => {
	let n = FS(e.state);
	switch (n._tag) {
		case vE: return t(n.effect);
		case _E: return n.joiners.push(t), rk(e, t);
	}
}, e.blockingOn), $O = /*#__PURE__*/ R(2, (e, t) => $(() => {
	let n = FS(e.state);
	switch (n._tag) {
		case vE: return !1;
		case _E:
			IS(e.state, SE(t));
			for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
			return !0;
	}
})), ek = /*#__PURE__*/ R(2, (e, t) => $O(e, YE(t))), tk = /*#__PURE__*/ R(2, (e, t) => $O(e, Z(t))), nk = (e, t) => {
	let n = FS(e.state);
	if (n._tag === "Pending") {
		IS(e.state, SE(t));
		for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
	}
}, rk = (e, t) => $(() => {
	let n = FS(e.state);
	if (n._tag === "Pending") {
		let e = n.joiners.indexOf(t);
		e >= 0 && n.joiners.splice(e, 1);
	}
}), ik = /*#__PURE__*/ ME((e) => GO(e.currentContext)), ak = () => ik, ok = (e) => X(ak(), e), sk = /*#__PURE__*/ R(2, (e, t) => GD($D, t)(e)), ck = /*#__PURE__*/ R(2, (e, t) => KD($D, (e) => Uy(e, t))(e)), lk = /*#__PURE__*/ R(2, (e, t) => ok((n) => sk(e, t(n)))), uk = (e) => {
	let t = e.currentSpan;
	return t !== void 0 && t._tag === "Span" ? Y(t) : J();
}, dk = NO, fk = PO, pk = KO, mk = /*#__PURE__*/ Symbol.for("effect/MutableHashMap"), hk = {
	[mk]: mk,
	[Symbol.iterator]() {
		return new gk(this);
	},
	toString() {
		return Xg(this.toJSON());
	},
	toJSON() {
		return {
			_id: "MutableHashMap",
			values: Array.from(this).map(Yg)
		};
	},
	[Jg]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, gk = class e {
	self;
	referentialIterator;
	bucketIterator;
	constructor(e) {
		this.self = e, this.referentialIterator = e.referential[Symbol.iterator]();
	}
	next() {
		if (this.bucketIterator !== void 0) return this.bucketIterator.next();
		let e = this.referentialIterator.next();
		return e.done ? (this.bucketIterator = new _k(this.self.buckets.values()), this.next()) : e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, _k = class {
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
}, vk = () => {
	let e = Object.create(hk);
	return e.referential = /* @__PURE__ */ new Map(), e.buckets = /* @__PURE__ */ new Map(), e.bucketsSize = 0, e;
}, yk = /*#__PURE__*/ R(2, (e, t) => {
	if (Kg(t) === !1) return e.referential.has(t) ? Y(e.referential.get(t)) : J();
	let n = t[H](), r = e.buckets.get(n);
	return r === void 0 ? J() : bk(e, r, t);
}), bk = (e, t, n, r = !1) => {
	for (let i = 0, a = t.length; i < a; i++) if (n[G](t[i][0])) {
		let n = t[i][1];
		return r && (t.splice(i, 1), e.bucketsSize--), Y(n);
	}
	return J();
}, xk = /*#__PURE__*/ R(2, (e, t) => sv(yk(e, t))), Sk = /*#__PURE__*/ R(3, (e, t, n) => {
	if (Kg(t) === !1) return e.referential.set(t, n), e;
	let r = t[H](), i = e.buckets.get(r);
	return i === void 0 ? (e.buckets.set(r, [[t, n]]), e.bucketsSize++, e) : (Ck(e, i, t), i.push([t, n]), e.bucketsSize++, e);
}), Ck = (e, t, n) => {
	for (let r = 0, i = t.length; r < i; r++) if (n[G](t[r][0])) {
		t.splice(r, 1), e.bucketsSize--;
		return;
	}
}, wk = /*#__PURE__*/ Symbol.for("effect/Clock"), Tk = /*#__PURE__*/ Py("effect/Clock"), Ek = 2 ** 31 - 1, Dk = { unsafeSchedule(e, t) {
	let n = qb(t);
	if (n > Ek) return eg;
	let r = !1, i = setTimeout(() => {
		r = !0, e();
	}, n);
	return () => (clearTimeout(i), !r);
} }, Ok = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || typeof performance.now != "function") return () => BigInt(Date.now()) * e;
	let t;
	return () => (t === void 0 && (t = BigInt(Date.now()) * e - BigInt(Math.round(performance.now() * 1e6))), t + BigInt(Math.round(performance.now() * 1e6)));
}(), kk = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return Ok;
	let t = /*#__PURE__*/ Ok() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}(), Ak = class {
	[wk] = wk;
	unsafeCurrentTimeMillis() {
		return Date.now();
	}
	unsafeCurrentTimeNanos() {
		return kk();
	}
	currentTimeMillis = /*#__PURE__*/ $(() => this.unsafeCurrentTimeMillis());
	currentTimeNanos = /*#__PURE__*/ $(() => this.unsafeCurrentTimeNanos());
	scheduler() {
		return Z(Dk);
	}
	sleep(e) {
		return zE((t) => FE($(Dk.unsafeSchedule(() => t(gD), e))));
	}
}, jk = () => new Ak(), Mk = "InvalidData", Nk = "MissingData", Pk = "SourceUnavailable", Fk = "Unsupported", Ik = /*#__PURE__*/ Symbol.for("effect/ConfigError"), Lk = {
	_tag: "ConfigError",
	[Ik]: Ik
}, Rk = (e, t) => {
	let n = Object.create(Lk);
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
}, zk = (e, t) => {
	let n = Object.create(Lk);
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
}, Bk = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Lk);
	return r._op = Mk, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Invalid data at ${z(this.path, iy(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Vk = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Lk);
	return r._op = Nk, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Missing data at ${z(this.path, iy(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Hk = (e, t, n, r = { pathDelim: "." }) => {
	let i = Object.create(Lk);
	return i._op = Pk, i.path = e, i.message = t, i.cause = n, Object.defineProperty(i, "toString", {
		enumerable: !1,
		value() {
			return `(Source unavailable at ${z(this.path, iy(r.pathDelim))}: "${this.message}")`;
		}
	}), i;
}, Uk = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Lk);
	return r._op = Fk, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Unsupported operation at ${z(this.path, iy(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Wk = /*#__PURE__*/ R(2, (e, t) => {
	switch (e._op) {
		case "And": return Rk(Wk(e.left, t), Wk(e.right, t));
		case "Or": return zk(Wk(e.left, t), Wk(e.right, t));
		case Mk: return Bk([...t, ...e.path], e.message);
		case Nk: return Vk([...t, ...e.path], e.message);
		case Pk: return Hk([...t, ...e.path], e.message, e.cause);
		case Fk: return Uk([...t, ...e.path], e.message);
	}
}), Gk = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._op) {
			case "And":
				r.push(e.right), r.push(e.left), i.push(Z_({ _op: "AndCase" }));
				break;
			case "Or":
				r.push(e.right), r.push(e.left), i.push(Z_({ _op: "OrCase" }));
				break;
			case Mk:
				i.push(X_(n.invalidDataCase(t, e.path, e.message)));
				break;
			case Nk:
				i.push(X_(n.missingDataCase(t, e.path, e.message)));
				break;
			case Pk:
				i.push(X_(n.sourceUnavailableCase(t, e.path, e.message, e.cause)));
				break;
			case Fk: i.push(X_(n.unsupportedCase(t, e.path, e.message)));
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
}), Kk = { _tag: "Empty" }, qk = /*#__PURE__*/ R(2, (e, t) => {
	let n = CC(t), r = e;
	for (; yC(n);) {
		let e = n.head;
		switch (e._tag) {
			case "Empty":
				n = n.tail;
				break;
			case "AndThen":
				n = xC(e.first, xC(e.second, n.tail));
				break;
			case "MapName":
				r = Zv(r, e.f), n = n.tail;
				break;
			case "Nested":
				r = xv(r, e.name), n = n.tail;
				break;
			case "Unnested": if (z(jv(r), hv(e.name))) r = Fv(r), n = n.tail;
			else return Z_(Vk(r, `Expected ${e.name} to be in path in ConfigProvider#unnested`));
		}
	}
	return X_(r);
}), Jk = "Constant", Yk = "Fail", Xk = "Fallback", Zk = "Described", Qk = "Lazy", $k = "MapOrFail", eA = "Nested", tA = "Primitive", nA = "Redacted", rA = "Sequence", iA = "HashMap", aA = "ZipWith", oA = (e, t) => [...e, ...t], sA = /*#__PURE__*/ Symbol.for("effect/ConfigProvider"), cA = /*#__PURE__*/ Py("effect/ConfigProvider"), lA = /*#__PURE__*/ Symbol.for("effect/ConfigProviderFlat"), uA = (e) => ({
	[sA]: sA,
	pipe() {
		return q(this, arguments);
	},
	...e
}), dA = (e) => ({
	[lA]: lA,
	patch: e.patch,
	load: (t, n, r = !0) => e.load(t, n, r),
	enumerateChildren: e.enumerateChildren
}), fA = (e) => uA({
	load: (t) => X(vA(e, Yv(), t, !1), (e) => cv(jv(e), {
		onNone: () => qE(Vk(Yv(), `Expected a single value having structure: ${t}`)),
		onSome: Z
	})),
	flattened: e
}), pA = (e) => {
	let { pathDelim: t, seqDelim: n } = Object.assign({}, {
		pathDelim: "_",
		seqDelim: ","
	}, e), r = (e) => z(e, iy(t)), i = (e) => e.split(t), a = () => typeof process < "u" && "env" in process && typeof process.env == "object" ? process.env : {};
	return fA(dA({
		load: (e, t, i = !0) => {
			let o = r(e), s = a();
			return z(o in s ? Y(s[o]) : J(), lD(() => Vk(e, `Expected ${o} to exist in the process context`)), X((r) => xA(r, e, t, n, i)));
		},
		enumerateChildren: (e) => $(() => {
			let t = a();
			return CS(Object.keys(t).map((e) => i(e.toUpperCase())).filter((t) => {
				for (let n = 0; n < e.length; n++) {
					let r = z(e, Av(n)), i = t[n];
					if (i === void 0 || r !== i) return !1;
				}
				return !0;
			}).flatMap((t) => t.slice(e.length, e.length + 1)));
		}),
		patch: Kk
	}));
}, mA = (e, t, n, r) => {
	let i = ey(n.length, (t) => t >= r.length ? J() : Y([e(t), t + 1])), a = ey(r.length, (e) => e >= n.length ? J() : Y([t(e), e + 1]));
	return [oA(n, i), oA(r, a)];
}, hA = (e, t) => {
	let n = t;
	if (n._tag === "Nested") {
		let t = e.slice();
		for (; n._tag === "Nested";) t.push(n.name), n = n.config;
		return t;
	}
	return e;
}, gA = {
	andCase: (e, t, n) => Rk(t, n),
	orCase: (e, t, n) => zk(t, n),
	invalidDataCase: (e, t) => Bk(t, "<redacted>"),
	missingDataCase: (e, t) => Vk(t, "<redacted>"),
	sourceUnavailableCase: (e, t, n, r) => Hk(t, "<redacted>", r),
	unsupportedCase: (e, t) => Uk(t, "<redacted>")
}, _A = (e) => Gk(e, void 0, gA), vA = (e, t, n, r) => {
	let i = n;
	switch (i._tag) {
		case Jk: return Z(Xv(i.value));
		case Zk: return Q(() => vA(e, t, i.config, r));
		case Yk: return qE(Vk(t, i.message));
		case Xk: return z(Q(() => vA(e, t, i.first, r)), BE((n) => i.condition(n) ? z(vA(e, t, i.second, r), BE((e) => qE(zk(n, e)))) : qE(n)));
		case Qk: return Q(() => vA(e, t, i.config(), r));
		case $k: return Q(() => z(vA(e, t, i.original, r), X(iD((e) => z(i.mapOrFail(e), lD(Wk(hA(t, i.original))))))));
		case eA: return Q(() => vA(e, oA(t, Xv(i.name)), i.config, r));
		case tA: return z(qk(t, e.patch), X((t) => z(e.load(t, i, r), X((e) => {
			if (e.length === 0) {
				let e = z(Nv(t), lv(() => "<n/a>"));
				return qE(Vk([], `Expected ${i.description} with name ${e}`));
			}
			return Z(e);
		}))));
		case nA: return Q(() => z(vA(e, t, i.original, r), lD(_A), sD(Zv(i.redact))));
		case rA: return z(qk(t, e.patch), X((n) => z(e.enumerateChildren(n), X(CA), X((n) => n.length === 0 ? Q(() => sD(vA(e, t, i.config, !0), Xv)) : z(iD(n, (n) => vA(e, Sv(t, `[${n}]`), i.config, !0)), sD((e) => {
			let t = Qv(e);
			return t.length === 0 ? Xv(Yv()) : Xv(t);
		}))))));
		case iA: return Q(() => z(qk(t, e.patch), X((t) => z(e.enumerateChildren(t), X((n) => z(n, iD((n) => vA(e, oA(t, Xv(n)), i.valueConfig, r)), sD((e) => e.length === 0 ? Xv(tC()) : z(SA(e), Zv((e) => nC(Vv(yv(n), e)))))))))));
		case aA: return Q(() => z(vA(e, t, i.left, r), GE, X((n) => z(vA(e, t, i.right, r), GE, X((e) => {
			if (Q_(n) && Q_(e)) return qE(Rk(n.left, e.left));
			if (Q_(n) && $_(e)) return qE(n.left);
			if ($_(n) && Q_(e)) return qE(e.left);
			if ($_(n) && $_(e)) {
				let r = yA(t, z(t, iy("."))), [a, o] = mA(r, r, z(n.right, Zv(X_)), z(e.right, Zv(X_)));
				return z(a, Vv(o), iD(([e, t]) => z(TD(e, t), sD(([e, t]) => i.zip(e, t)))));
			}
			throw Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
		})))));
	}
}, yA = (e, t) => (n) => Z_(Vk(e, `The element at index ${n} in a sequence at path "${t}" was missing`)), bA = (e, t) => e.split(RegExp(`\\s*${oy(t)}\\s*`)), xA = (e, t, n, r, i) => i ? z(bA(e, r), iD((e) => n.parse(e.trim())), lD(Wk(t))) : z(n.parse(e), cD({
	onFailure: Wk(t),
	onSuccess: Xv
})), SA = (e) => Object.keys(e[0]).map((t) => e.map((e) => e[t])), CA = (e) => z(iD(e, TA), cD({
	onFailure: () => Yv(),
	onSuccess: Bv(ay)
}), GE, sD(ev)), wA = /^(\[(\d+)\])$/, TA = (e) => {
	let t = e.match(wA);
	if (t !== null) {
		let e = t[2];
		return z(e !== void 0 && e.length > 0 ? Y(e) : J(), mv(EA));
	}
	return J();
}, EA = (e) => {
	let t = Number.parseInt(e);
	return Number.isNaN(t) ? J() : Y(t);
}, DA = /*#__PURE__*/ Symbol.for("effect/Console"), OA = /*#__PURE__*/ Py("effect/Console"), kA = {
	[DA]: DA,
	assert(e, ...t) {
		return $(() => {
			console.assert(e, ...t);
		});
	},
	clear: /*#__PURE__*/ $(() => {
		console.clear();
	}),
	count(e) {
		return $(() => {
			console.count(e);
		});
	},
	countReset(e) {
		return $(() => {
			console.countReset(e);
		});
	},
	debug(...e) {
		return $(() => {
			console.debug(...e);
		});
	},
	dir(e, t) {
		return $(() => {
			console.dir(e, t);
		});
	},
	dirxml(...e) {
		return $(() => {
			console.dirxml(...e);
		});
	},
	error(...e) {
		return $(() => {
			console.error(...e);
		});
	},
	group(e) {
		return e?.collapsed ? $(() => console.groupCollapsed(e?.label)) : $(() => console.group(e?.label));
	},
	groupEnd: /*#__PURE__*/ $(() => {
		console.groupEnd();
	}),
	info(...e) {
		return $(() => {
			console.info(...e);
		});
	},
	log(...e) {
		return $(() => {
			console.log(...e);
		});
	},
	table(e, t) {
		return $(() => {
			console.table(e, t);
		});
	},
	time(e) {
		return $(() => console.time(e));
	},
	timeEnd(e) {
		return $(() => console.timeEnd(e));
	},
	timeLog(e, ...t) {
		return $(() => {
			console.timeLog(e, ...t);
		});
	},
	trace(...e) {
		return $(() => {
			console.trace(...e);
		});
	},
	warn(...e) {
		return $(() => {
			console.warn(...e);
		});
	},
	unsafe: console
}, AA = /*#__PURE__*/ Symbol.for("effect/Random"), jA = /*#__PURE__*/ Py("effect/Random"), MA = class {
	seed;
	[AA] = AA;
	PRNG;
	constructor(e) {
		this.seed = e, this.PRNG = new Eg(e);
	}
	get next() {
		return $(() => this.PRNG.number());
	}
	get nextBoolean() {
		return sD(this.next, (e) => e > .5);
	}
	get nextInt() {
		return $(() => this.PRNG.integer(2 ** 53 - 1));
	}
	nextRange(e, t) {
		return sD(this.next, (n) => (t - e) * n + e);
	}
	nextIntBetween(e, t) {
		return $(() => this.PRNG.integer(t - e) + e);
	}
	shuffle(e) {
		return NA(e, (e) => this.nextIntBetween(0, e));
	}
}, NA = (e, t) => Q(() => z($(() => Array.from(e)), X((e) => {
	let n = [];
	for (let t = e.length; t >= 2; --t) n.push(t);
	return z(n, aD((n) => z(t(n), sD((t) => PA(e, n - 1, t)))), PE(ib(e)));
}))), PA = (e, t, n) => {
	let r = e[t];
	return e[t] = e[n], e[n] = r, e;
}, FA = (e) => new MA(U(e)), IA = /*#__PURE__*/ Symbol.for("effect/Tracer"), LA = (e) => ({
	[IA]: IA,
	...e
}), RA = /*#__PURE__*/ Py("effect/Tracer"), zA = /*#__PURE__*/ Py("effect/ParentSpan"), BA = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), VA = class {
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
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = t._tag === "Some" ? t.value.traceId : BA(32), this.spanId = BA(16), this.links = Array.from(r);
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
}, HA = /*#__PURE__*/ LA({
	span: (e, t, n, r, i, a) => new VA(e, t, n, r, i, a),
	context: (e) => e()
}), UA = /*#__PURE__*/ Ky()("effect/Tracer/DisablePropagation", { defaultValue: eg }), WA = /*#__PURE__*/ z(/*#__PURE__*/ Ly(), /*#__PURE__*/ zy(Tk, /*#__PURE__*/ jk()), /*#__PURE__*/ zy(OA, kA), /*#__PURE__*/ zy(jA, /*#__PURE__*/ FA(/*#__PURE__*/ Math.random())), /*#__PURE__*/ zy(cA, /*#__PURE__*/ pA()), /*#__PURE__*/ zy(RA, HA)), GA = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/DefaultServices/currentServices"), () => XD(WA));
// node_modules/effect/dist/esm/internal/fiberRefs.js
function KA(e) {
	return new YA(e);
}
function qA() {
	return KA(/* @__PURE__ */ new Map());
}
var JA = /*#__PURE__*/ Symbol.for("effect/FiberRefs"), YA = class {
	locals;
	[JA] = JA;
	constructor(e) {
		this.locals = e;
	}
	pipe() {
		return q(this, arguments);
	}
}, XA = (e, t, n, r = !1) => {
	let i = e, a = t, o = n, s = r, c;
	for (; c === void 0;) if (Ev(a) && Ev(o)) {
		let e = Mv(a)[0], t = Fv(a), n = Mv(o)[0], r = Mv(o)[1], i = Fv(o);
		e.startTimeMillis < n.startTimeMillis ? (o = i, s = !0) : e.startTimeMillis > n.startTimeMillis ? a = t : e.id < n.id ? (o = i, s = !0) : e.id > n.id ? a = t : c = [r, s];
	} else c = [i.initial, !0];
	return c;
}, ZA = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = new Map(e.locals);
	return n.locals.forEach((e, n) => {
		let i = e[0][1];
		if (!e[0][0][G](t)) {
			if (!r.has(n)) {
				if (K(i, n.initial)) return;
				r.set(n, [[t, n.join(n.initial, i)]]);
				return;
			}
			let a = r.get(n), [o, s] = XA(n, a, e);
			if (s) {
				let e = n.diff(o, i), s = a[0][1], c = n.join(s, n.patch(e)(s));
				if (!K(s, c)) {
					let e, i = a[0][0];
					e = i[G](t) ? [[i, c], ...a.slice(1)] : [[t, c], ...a], r.set(n, e);
				}
			}
		}
	}), new YA(r);
}), QA = /*#__PURE__*/ R(2, (e, t) => {
	let n = /* @__PURE__ */ new Map();
	return $A(e, n, t), new YA(n);
}), $A = (e, t, n) => {
	e.locals.forEach((e, r) => {
		let i = e[0][1], a = r.patch(r.fork)(i);
		K(i, a) ? t.set(r, e) : t.set(r, [[n, a], ...e]);
	});
}, ej = /*#__PURE__*/ R(2, (e, t) => {
	let n = new Map(e.locals);
	return n.delete(t), new YA(n);
}), tj = /*#__PURE__*/ R(2, (e, t) => e.locals.has(t) ? Y(Mv(e.locals.get(t))[1]) : J()), nj = /*#__PURE__*/ R(2, (e, t) => z(tj(e, t), lv(() => t.initial))), rj = /*#__PURE__*/ R(2, (e, { fiberId: t, fiberRef: n, value: r }) => {
	if (e.locals.size === 0) return new YA(/* @__PURE__ */ new Map([[n, [[t, r]]]]));
	let i = new Map(e.locals);
	return ij(i, t, n, r), new YA(i);
}), ij = (e, t, n, r) => {
	let i = e.get(n) ?? [], a;
	if (Ev(i)) {
		let [e, n] = Mv(i);
		if (e[G](t)) {
			if (K(n, r)) return;
			a = [[t, r], ...i.slice(1)];
		} else a = [[t, r], ...i];
	} else a = [[t, r]];
	e.set(n, a);
}, aj = /*#__PURE__*/ R(2, (e, { entries: t, forkAs: n }) => {
	if (e.locals.size === 0) return new YA(new Map(t));
	let r = new Map(e.locals);
	return n !== void 0 && $A(e, r, n), t.forEach(([e, t]) => {
		t.length === 1 ? ij(r, t[0][0], e, t[0][1]) : t.forEach(([t, n]) => {
			ij(r, t, e, n);
		});
	}), new YA(r);
}), oj = nj, sj = aj, cj = qA, lj = jD, uj = MD, dj = ND, fj = PD, pj = FD, mj = ID, hj = LD, gj = RD, _j = /*#__PURE__*/ av(/* @__PURE__ */ z(ay, /*#__PURE__*/ iv((e) => e.ordinal))), vj = (e) => {
	switch (e) {
		case "All": return lj;
		case "Debug": return mj;
		case "Error": return dj;
		case "Fatal": return uj;
		case "Info": return pj;
		case "Trace": return hj;
		case "None": return gj;
		case "Warning": return fj;
	}
}, yj = (e) => e.replace(/[\s="]/g, "_"), bj = (e) => (t) => `${yj(t.label)}=${e - t.startTime}ms`, xj = D_, Sj = j_, Cj = class extends Sj {}, wj = /*#__PURE__*/ Symbol.for("effect/Readable"), Tj = /*#__PURE__*/ Symbol.for("effect/Ref"), Ej = {
/* c8 ignore next */
_A: (e) => e }, Dj = class extends Cj {
	ref;
	commit() {
		return this.get;
	}
	[Tj] = Ej;
	[wj] = wj;
	constructor(e) {
		super(), this.ref = e, this.get = $(() => FS(this.ref));
	}
	get;
	modify(e) {
		return $(() => {
			let t = FS(this.ref), [n, r] = e(t);
			return t !== r && IS(r)(this.ref), n;
		});
	}
}, Oj = (e) => new Dj(PS(e)), kj = (e) => $(() => Oj(e)), Aj = (e) => e.get, jj = /*#__PURE__*/ R(2, (e, t) => e.modify(() => [void 0, t])), Mj = /*#__PURE__*/ R(2, (e, t) => e.modify(t)), Nj = /*#__PURE__*/ R(2, (e, t) => e.modify((e) => [void 0, t(e)])), Pj = "Empty", Fj = "Remove", Ij = "Update", Lj = "AndThen", Rj = { _tag: Pj }, zj = (e, t) => {
	let n = new Map(e.locals), r = Rj;
	for (let [e, i] of t.locals.entries()) {
		let t = Mv(i)[1], a = n.get(e);
		if (a !== void 0) {
			let n = Mv(a)[1];
			K(n, t) || (r = Bj({
				_tag: Ij,
				fiberRef: e,
				patch: e.diff(n, t)
			})(r));
		} else r = Bj({
			_tag: "Add",
			fiberRef: e,
			value: t
		})(r);
		n.delete(e);
	}
	for (let [e] of n.entries()) r = Bj({
		_tag: Fj,
		fiberRef: e
	})(r);
	return r;
}, Bj = /*#__PURE__*/ R(2, (e, t) => ({
	_tag: Lj,
	first: e,
	second: t
})), Vj = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = n, i = Xv(e);
	for (; Ev(i);) {
		let e = Mv(i), n = Fv(i);
		switch (e._tag) {
			case Pj:
				i = n;
				break;
			case "Add":
				r = rj(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.value
				}), i = n;
				break;
			case Fj:
				r = ej(r, e.fiberRef), i = n;
				break;
			case Ij: {
				let a = nj(r, e.fiberRef);
				r = rj(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.fiberRef.patch(e.patch)(a)
				}), i = n;
				break;
			}
			case Lj: i = xv(e.first)(xv(e.second)(n));
		}
	}
	return r;
}), Hj = "effect/MetricLabel", Uj = /*#__PURE__*/ Symbol.for(Hj), Wj = class {
	key;
	value;
	[Uj] = Uj;
	_hash;
	constructor(e, t) {
		this.key = e, this.value = t, this._hash = Bg(Hj + this.key + this.value);
	}
	[H]() {
		return this._hash;
	}
	[G](e) {
		return Kj(e) && this.key === e.key && this.value === e.value;
	}
	pipe() {
		return q(this, arguments);
	}
}, Gj = (e, t) => new Wj(e, t), Kj = (e) => V(e, Uj), qj = (e) => sD(e, Y), Jj = (e) => {
	let t, n;
	return typeof e == "function" ? t = e : (t = e.try, n = e.catch), Q(() => {
		try {
			return Z(Pg(t));
		} catch (e) {
			return qE(n ? Pg(() => n(e)) : new jO(e, "An unknown error occurred in Effect.try"));
		}
	});
}, Yj = (e) => rM(e, Zj, zj), Xj = /*#__PURE__*/ R(2, (e, t) => rD(e, {
	onFailure: (e) => Z(t.onFailure(e)),
	onSuccess: (e) => Z(t.onSuccess(e))
})), Zj = /*#__PURE__*/ ME((e) => Z(e.getFiberRefs())), Qj = (e) => Xj(e, {
	onFailure: ng,
	onSuccess: ng
}), $j = (e) => oM((t, n) => z(e, Vj(t, n))), eM = (e) => e.length >= 1 ? zE((t, n) => {
	try {
		e(n).then((e) => t(Z(e)), (e) => t(UE(e)));
	} catch (e) {
		t(UE(e));
	}
}) : zE((t) => {
	try {
		e().then((e) => t(Z(e)), (e) => t(UE(e)));
	} catch (e) {
		t(UE(e));
	}
}), tM = /*#__PURE__*/ R(3, (e, t, n) => ok((r) => sk(e, zy(r, t, n)))), nM = /*#__PURE__*/ Z(/*#__PURE__*/ J()), rM = /*#__PURE__*/ R(3, (e, t, n) => X(t, (r) => X(e, (e) => sD(t, (t) => [n(r, t), e])))), iM = /*#__PURE__*/ R(2, (e, t) => nD(e, {
	onFailure: (e) => {
		let n = qT(e);
		switch (n._tag) {
			case "Left": return DD(t(n.left), YE(e));
			case "Right": return YE(e);
		}
	},
	onSuccess: Z
})), aM = (e) => {
	let t, n;
	typeof e == "function" ? t = e : (t = e.try, n = e.catch);
	let r = (e) => n ? JE(() => n(e)) : qE(new jO(e, "An unknown error occurred in Effect.tryPromise"));
	return t.length >= 1 ? zE((e, n) => {
		try {
			t(n).then((t) => e(Z(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	}) : zE((e) => {
		try {
			t().then((t) => e(Z(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	});
}, oM = (e) => ME((t) => (t.setFiberRefs(e(t.id(), t.getFiberRefs())), gD)), sM = /*#__PURE__*/ mv((e) => By(e.context, UA) ? e._tag === "Span" ? sM(e.parent) : J() : Y(e)), cM = "Sequential", lM = "Parallel", uM = "ParallelN", dM = { _tag: cM }, fM = { _tag: lM }, pM = (e) => ({
	_tag: uM,
	parallelism: e
}), mM = (e) => e._tag === cM, hM = (e) => e._tag === lM, gM = dM, _M = fM, vM = pM, yM = zj, bM = Vj, xM = "effect/FiberStatus", SM = /*#__PURE__*/ Symbol.for(xM), CM = "Done", wM = "Running", TM = "Suspended", EM = /*#__PURE__*/ Bg(`${xM}-${CM}`), DM = class {
	[SM] = SM;
	_tag = CM;
	[H]() {
		return EM;
	}
	[G](e) {
		return NM(e) && e._tag === "Done";
	}
}, OM = class {
	runtimeFlags;
	[SM] = SM;
	_tag = wM;
	constructor(e) {
		this.runtimeFlags = e;
	}
	[H]() {
		return z(U(xM), W(U(this._tag)), W(U(this.runtimeFlags)), Wg(this));
	}
	[G](e) {
		return NM(e) && e._tag === "Running" && this.runtimeFlags === e.runtimeFlags;
	}
}, kM = class {
	runtimeFlags;
	blockingOn;
	[SM] = SM;
	_tag = TM;
	constructor(e, t) {
		this.runtimeFlags = e, this.blockingOn = t;
	}
	[H]() {
		return z(U(xM), W(U(this._tag)), W(U(this.runtimeFlags)), W(U(this.blockingOn)), Wg(this));
	}
	[G](e) {
		return NM(e) && e._tag === "Suspended" && this.runtimeFlags === e.runtimeFlags && K(this.blockingOn, e.blockingOn);
	}
}, AM = /*#__PURE__*/ new DM(), jM = (e) => new OM(e), MM = (e, t) => new kM(e, t), NM = (e) => V(e, SM), PM = (e) => e._tag === CM, FM = AM, IM = jM, LM = MM, RM = PM, zM = /*#__PURE__*/ Symbol.for("effect/Micro"), BM = /*#__PURE__*/ Symbol.for("effect/Micro/MicroExit"), VM = /*#__PURE__*/ Symbol.for("effect/Micro/MicroCause"), HM = { _E: Zh }, UM = class extends globalThis.Error {
	_tag;
	traces;
	[VM];
	constructor(e, t, n) {
		let r = `MicroCause.${e}`, i, a, o;
		if (t instanceof globalThis.Error) {
			i = `(${r}) ${t.name}`, a = t.message;
			let e = a.split("\n").length;
			o = t.stack ? `(${r}) ${t.stack.split("\n").slice(0, e + 3).join("\n")}` : `${i}: ${a}`;
		} else i = r, a = Zg(t, 0), o = `${i}: ${a}`;
		n.length > 0 && (o += `\n    ${n.join("\n    ")}`), super(a), this._tag = e, this.traces = n, this[VM] = HM, this.name = i, this.stack = o;
	}
	pipe() {
		return q(this, arguments);
	}
	toString() {
		return this.stack;
	}
	[Jg]() {
		return this.stack;
	}
}, WM = class extends UM {
	defect;
	constructor(e, t = []) {
		super("Die", e, t), this.defect = e;
	}
}, GM = (e, t = []) => new WM(e, t), KM = class extends UM {
	constructor(e = []) {
		super("Interrupt", "interrupted", e);
	}
}, qM = (e = []) => new KM(e), JM = (e) => e._tag === "Interrupt", YM = /*#__PURE__*/ Symbol.for("effect/Micro/MicroFiber"), XM = {
	_A: Zh,
	_E: Zh
}, ZM = class {
	context;
	interruptible;
	[YM];
	_stack = [];
	_observers = [];
	_exit;
	_children;
	currentOpCount = 0;
	constructor(e, t = !0) {
		this.context = e, this.interruptible = t, this[YM] = XM;
	}
	getRef(e) {
		return Oy(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), ng) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	_interrupted = !1;
	unsafeInterrupt() {
		this._exit || (this._interrupted = !0, this.interruptible && this.evaluate(SN));
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
		if (t === aN) return;
		let n = QM.interruptChildren && QM.interruptChildren(this);
		if (n !== void 0) return this.evaluate(_N(n, () => t));
		this._exit = t;
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = !1, n = e;
		this.currentOpCount = 0;
		try {
			for (;;) {
				if (this.currentOpCount++, !t && this.getRef(AN).shouldYield(this)) {
					t = !0;
					let e = n;
					n = _N(mN, () => e);
				}
				if (n = n[tN](this), n === aN) {
					let e = this._yielded;
					return BM in e ? (this._yielded = void 0, e) : aN;
				}
			}
		} catch (e) {
			return V(n, tN) ? CN(e) : CN(`MicroFiber.runLoop: Not a valid effect: ${String(n)}`);
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[iN] && t[iN](this);
			if (n) return { [e]: n };
			if (t[e]) return t;
		}
	}
	_yielded = void 0;
	yieldWith(e) {
		return this._yielded = e, aN;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
}, QM = /*#__PURE__*/ B("effect/Micro/fiberMiddleware", () => ({ interruptChildren: void 0 })), $M = /*#__PURE__*/ Symbol.for("effect/Micro/identifier"), eN = /*#__PURE__*/ Symbol.for("effect/Micro/args"), tN = /*#__PURE__*/ Symbol.for("effect/Micro/evaluate"), nN = /*#__PURE__*/ Symbol.for("effect/Micro/successCont"), rN = /*#__PURE__*/ Symbol.for("effect/Micro/failureCont"), iN = /*#__PURE__*/ Symbol.for("effect/Micro/ensureCont"), aN = /*#__PURE__*/ Symbol.for("effect/Micro/Yield"), oN = {
	_A: Zh,
	_E: Zh,
	_R: Zh
}, sN = {
	...xj,
	_op: "Micro",
	[zM]: oN,
	pipe() {
		return q(this, arguments);
	},
	[Symbol.iterator]() {
		return new yg(new Ag(this));
	},
	toJSON() {
		return {
			_id: "Micro",
			op: this[$M],
			...eN in this ? { args: this[eN] } : void 0
		};
	},
	toString() {
		return Xg(this);
	},
	[Jg]() {
		return Xg(this);
	}
};
function cN(e) {
	return CN("Micro.evaluate: Not implemented");
}
var lN = (e) => ({
	...sN,
	[$M]: e.op,
	[tN]: e.eval ?? cN,
	[nN]: e.contA,
	[rN]: e.contE,
	[iN]: e.ensure
}), uN = (e) => {
	let t = lN(e);
	return function() {
		let n = Object.create(t);
		return n[eN] = e.single === !1 ? arguments : arguments[0], n;
	};
}, dN = (e) => {
	let t = {
		...lN(e),
		[BM]: BM,
		_tag: e.op,
		get [e.prop]() {
			return this[eN];
		},
		toJSON() {
			return {
				_id: "MicroExit",
				_tag: e.op,
				[e.prop]: this[eN]
			};
		},
		[G](t) {
			return yN(t) && t._tag === e.op && K(this[eN], t[eN]);
		},
		[H]() {
			return Wg(this, W(Bg(e.op))(U(this[eN])));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[eN] = e, n[nN] = void 0, n[rN] = void 0, n[iN] = void 0, n;
	};
}, fN = /*#__PURE__*/ dN({
	op: "Success",
	prop: "value",
	eval(e) {
		let t = e.getCont(nN);
		return t ? t[nN](this[eN], e) : e.yieldWith(this);
	}
}), pN = /*#__PURE__*/ dN({
	op: "Failure",
	prop: "cause",
	eval(e) {
		let t = e.getCont(rN);
		for (; JM(this[eN]) && t && e.interruptible;) t = e.getCont(rN);
		return t ? t[rN](this[eN], e) : e.yieldWith(this);
	}
}), mN = /*#__PURE__*/ (/* @__PURE__ */ uN({
	op: "Yield",
	eval(e) {
		let t = !1;
		return e.getRef(AN).scheduleTask(() => {
			t || e.evaluate(wN);
		}, this[eN] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), hN = /*#__PURE__*/ fN(void 0), gN = /*#__PURE__*/ uN({
	op: "WithMicroFiber",
	eval(e) {
		return this[eN](e);
	}
}), _N = /*#__PURE__*/ R(2, (e, t) => {
	let n = Object.create(vN);
	return n[eN] = e, n[nN] = t, n;
}), vN = /*#__PURE__*/ lN({
	op: "OnSuccess",
	eval(e) {
		return e._stack.push(this), this[eN];
	}
}), yN = (e) => V(e, BM), bN = fN, xN = pN, SN = /*#__PURE__*/ xN(/*#__PURE__*/ qM()), CN = (e) => xN(GM(e)), wN = /*#__PURE__*/ bN(void 0), TN = "setImmediate" in globalThis ? globalThis.setImmediate : (e) => setTimeout(e, 0), EN = class {
	tasks = [];
	running = !1;
	scheduleTask(e, t) {
		this.tasks.push(e), this.running || (this.running = !0, TN(this.afterScheduled));
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
		return e.currentOpCount >= e.getRef(kN);
	}
	flush() {
		for (; this.tasks.length > 0;) this.runTasks();
	}
}, DN = /*#__PURE__*/ R(2, (e, t) => gN((n) => {
	let r = n.context;
	return n.context = t(r), NN(e, () => (n.context = r, hN));
})), ON = /*#__PURE__*/ R(2, (e, t) => DN(e, Uy(t))), kN = class extends (/*#__PURE__*/ Ky()("effect/Micro/currentMaxOpsBeforeYield", { defaultValue: () => 2048 })) {}, AN = class extends (/*#__PURE__*/ Ky()("effect/Micro/currentScheduler", { defaultValue: () => new EN() })) {}, jN = /*#__PURE__*/ R(2, (e, t) => {
	let n = Object.create(MN);
	return n[eN] = e, n[nN] = t.onSuccess, n[rN] = t.onFailure, n;
}), MN = /*#__PURE__*/ lN({
	op: "OnSuccessAndFailure",
	eval(e) {
		return e._stack.push(this), this[eN];
	}
}), NN = /*#__PURE__*/ R(2, (e, t) => IN((n) => jN(n(e), {
	onFailure: (e) => _N(t(xN(e)), () => pN(e)),
	onSuccess: (e) => _N(t(bN(e)), () => fN(e))
}))), PN = /*#__PURE__*/ uN({
	op: "SetInterruptible",
	ensure(e) {
		if (e.interruptible = this[eN], e._interrupted && e.interruptible) return () => SN;
	}
}), FN = (e) => gN((t) => t.interruptible ? e : (t.interruptible = !0, t._stack.push(PN(!1)), t._interrupted ? SN : e)), IN = (e) => gN((t) => t.interruptible ? (t.interruptible = !1, t._stack.push(PN(!0)), e(FN)) : e(Zh)), LN = (e, t) => {
	let n = new ZM(AN.context(t?.scheduler ?? new EN()));
	if (n.evaluate(e), t?.signal) {
		if (t.signal.aborted) n.unsafeInterrupt();
		else {
			let e = () => n.unsafeInterrupt();
			t.signal.addEventListener("abort", e, { once: !0 }), n.addObserver(() => t.signal.removeEventListener("abort", e));
		}
	}
	return n;
}, RN = class e {
	scheduleDrain;
	running = !1;
	tasks = /*#__PURE__*/ new zN();
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
}, zN = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets.length, r, i = 0;
		for (; i < n && this.buckets[i][0] <= t; i++) r = this.buckets[i];
		r && r[0] === t ? r[1].push(e) : i === n ? this.buckets.push([t, [e]]) : this.buckets.splice(i, 0, [t, [e]]);
	}
}, BN = class {
	maxNextTickBeforeTimer;
	getRunner = /*#__PURE__*/ RN.cached((e, t) => {
		e >= this.maxNextTickBeforeTimer ? setTimeout(() => t(0), 0) : Promise.resolve(void 0).then(() => t(e + 1));
	});
	constructor(e) {
		this.maxNextTickBeforeTimer = e;
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(tO) && e.getFiberRef(eO);
	}
	scheduleTask(e, t, n) {
		this.getRunner(n).scheduleTask(e, t);
	}
}, VN = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Scheduler/defaultScheduler"), () => new BN(2048)), HN = class {
	tasks = /*#__PURE__*/ new zN();
	deferred = !1;
	scheduleTask(e, t, n) {
		this.deferred ? VN.scheduleTask(e, t, n) : this.tasks.scheduleTask(e, t);
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(tO) && e.getFiberRef(eO);
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) {
			let e = this.tasks.buckets;
			this.tasks.buckets = [];
			for (let [t, n] of e) for (let e = 0; e < n.length; e++) n[e]();
		}
		this.deferred = !0;
	}
}, UN = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentScheduler"), () => qD(VN)), WN = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestMap"), () => qD(/* @__PURE__ */ new Map())), GN = (e, t, n, r) => {
	switch (e) {
		case void 0: return t();
		case "unbounded": return n();
		case "inherit": return HD(oO, (e) => e === "unbounded" ? n() : e > 1 ? r(e) : t());
		default: return e > 1 ? r(e) : t();
	}
}, KN = "InterruptSignal", qN = "Stateful", JN = "Resume", YN = "YieldNow", XN = (e) => ({
	_tag: KN,
	cause: e
}), ZN = (e) => ({
	_tag: qN,
	onFiber: e
}), QN = (e) => ({
	_tag: JN,
	effect: e
}), $N = () => ({ _tag: YN }), eP = /*#__PURE__*/ Symbol.for("effect/FiberScope"), tP = class {
	[eP] = eP;
	fiberId = ZS;
	roots = /*#__PURE__*/ new Set();
	add(e, t) {
		this.roots.add(t), t.addObserver(() => {
			this.roots.delete(t);
		});
	}
}, nP = class {
	fiberId;
	parent;
	[eP] = eP;
	constructor(e, t) {
		this.fiberId = e, this.parent = t;
	}
	add(e, t) {
		this.parent.tell(ZN((e) => {
			e.addChild(t), t.addObserver(() => {
				e.removeChild(t);
			});
		}));
	}
}, rP = (e) => new nP(e.id(), e), iP = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberScope/Global"), () => new tP()), aP = /*#__PURE__*/ Symbol.for("effect/Fiber"), oP = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, sP = {
	[aP]: oP,
	pipe() {
		return q(this, arguments);
	}
}, cP = /*#__PURE__*/ Symbol.for("effect/Fiber"), lP = (e) => ED(eD(e.await), e.inheritAll);
({ ...k_ }), { ...sP };
var uP = "effect/FiberCurrent", dP = /*#__PURE__*/ Symbol.for("effect/Logger"), fP = {
	/* c8 ignore next */
	_Message: (e) => e,
	/* c8 ignore next */
	_Output: (e) => e
}, pP = (e) => ({
	[dP]: fP,
	log: e,
	pipe() {
		return q(this, arguments);
	}
}), mP = /^[^\s"=]*$/, hP = /*#__PURE__*/ pP(/*#__PURE__*/ ((e, t) => ({ annotations: n, cause: r, date: i, fiberId: a, logLevel: o, message: s, spans: c }) => {
	let l = (t) => t.match(mP) ? t : e(t), u = (e, t) => `${yj(e)}=${l(t)}`, d = (e, t) => " " + u(e, t), f = u("timestamp", i.toISOString());
	f += d("level", o.label), f += d("fiber", YS(a));
	let p = bv(s);
	for (let e = 0; e < p.length; e++) f += d("message", Zg(p[e], t));
	zT(r) || (f += d("cause", cE(r, { renderErrorCause: !0 })));
	for (let e of c) f += " " + bj(i.getTime())(e);
	for (let [e, r] of n) f += d(e, Zg(r, t));
	return f;
})((e) => `"${e.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`)), gP = {
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
gP.gray, gP.blue, gP.green, gP.yellow, gP.red, gP.bgBrightRed, gP.black;
var _P = typeof process == "object" && process !== null && typeof process.stdout == "object" && process.stdout !== null;
_P && process.stdout.isTTY, _P || "Deno" in globalThis;
// node_modules/effect/dist/esm/internal/metric/boundaries.js
var vP = "effect/MetricBoundaries", yP = /*#__PURE__*/ Symbol.for(vP), bP = class {
	values;
	[yP] = yP;
	constructor(e) {
		this.values = e, this._hash = z(Bg(vP), W(Ug(this.values)));
	}
	_hash;
	[H]() {
		return this._hash;
	}
	[G](e) {
		return xP(e) && K(this.values, e.values);
	}
	pipe() {
		return q(this, arguments);
	}
}, xP = (e) => V(e, yP), SP = (e) => new bP(z(e, Cv(rb(Infinity)), ry)), CP = (e) => z(vv(e.count - 1, (t) => e.start * e.factor ** +t), lb, SP), wP = /*#__PURE__*/ Symbol.for("effect/MetricKeyType"), TP = "effect/MetricKeyType/Counter", EP = /*#__PURE__*/ Symbol.for(TP), DP = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Frequency"), OP = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Gauge"), kP = "effect/MetricKeyType/Histogram", AP = /*#__PURE__*/ Symbol.for(kP), jP = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Summary"), MP = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, NP = class {
	incremental;
	bigint;
	[wP] = MP;
	[EP] = EP;
	constructor(e, t) {
		this.incremental = e, this.bigint = t, this._hash = Bg(TP);
	}
	_hash;
	[H]() {
		return this._hash;
	}
	[G](e) {
		return LP(e);
	}
	pipe() {
		return q(this, arguments);
	}
}, PP = class {
	boundaries;
	[wP] = MP;
	[AP] = AP;
	constructor(e) {
		this.boundaries = e, this._hash = z(Bg(kP), W(U(this.boundaries)));
	}
	_hash;
	[H]() {
		return this._hash;
	}
	[G](e) {
		return BP(e) && K(this.boundaries, e.boundaries);
	}
	pipe() {
		return q(this, arguments);
	}
}, FP = (e) => new NP(e?.incremental ?? !1, e?.bigint ?? !1), IP = (e) => new PP(e), LP = (e) => V(e, EP), RP = (e) => V(e, DP), zP = (e) => V(e, OP), BP = (e) => V(e, AP), VP = (e) => V(e, jP), HP = /*#__PURE__*/ Symbol.for("effect/MetricKey"), UP = {
/* c8 ignore next */
_Type: (e) => e }, WP = /*#__PURE__*/ ty(K), GP = class {
	name;
	keyType;
	description;
	tags;
	[HP] = UP;
	constructor(e, t, n, r = []) {
		this.name = e, this.keyType = t, this.description = n, this.tags = r, this._hash = z(Bg(this.name + this.description), W(U(this.keyType)), W(Ug(this.tags)));
	}
	_hash;
	[H]() {
		return this._hash;
	}
	[G](e) {
		return KP(e) && this.name === e.name && K(this.keyType, e.keyType) && K(this.description, e.description) && WP(this.tags, e.tags);
	}
	pipe() {
		return q(this, arguments);
	}
}, KP = (e) => V(e, HP), qP = (e, t) => new GP(e, FP(t), dv(t?.description)), JP = (e, t, n) => new GP(e, IP(t), dv(n)), YP = /*#__PURE__*/ R(2, (e, t) => t.length === 0 ? e : new GP(e.name, e.keyType, e.description, Jv(e.tags, t))), XP = /*#__PURE__*/ Symbol.for("effect/MetricState"), ZP = "effect/MetricState/Counter", QP = /*#__PURE__*/ Symbol.for(ZP), $P = "effect/MetricState/Frequency", eF = /*#__PURE__*/ Symbol.for($P), tF = "effect/MetricState/Gauge", nF = /*#__PURE__*/ Symbol.for(tF), rF = "effect/MetricState/Histogram", iF = /*#__PURE__*/ Symbol.for(rF), aF = "effect/MetricState/Summary", oF = /*#__PURE__*/ Symbol.for(aF), sF = {
/* c8 ignore next */
_A: (e) => e }, cF = class {
	count;
	[XP] = sF;
	[QP] = QP;
	constructor(e) {
		this.count = e;
	}
	[H]() {
		return z(U(ZP), W(U(this.count)), Wg(this));
	}
	[G](e) {
		return yF(e) && this.count === e.count;
	}
	pipe() {
		return q(this, arguments);
	}
}, lF = /*#__PURE__*/ ty(K), uF = class {
	occurrences;
	[XP] = sF;
	[eF] = eF;
	constructor(e) {
		this.occurrences = e;
	}
	_hash;
	[H]() {
		return z(Bg($P), W(Ug(yv(this.occurrences.entries()))), Wg(this));
	}
	[G](e) {
		return bF(e) && lF(yv(this.occurrences.entries()), yv(e.occurrences.entries()));
	}
	pipe() {
		return q(this, arguments);
	}
}, dF = class {
	value;
	[XP] = sF;
	[nF] = nF;
	constructor(e) {
		this.value = e;
	}
	[H]() {
		return z(U(tF), W(U(this.value)), Wg(this));
	}
	[G](e) {
		return xF(e) && this.value === e.value;
	}
	pipe() {
		return q(this, arguments);
	}
}, fF = class {
	buckets;
	count;
	min;
	max;
	sum;
	[XP] = sF;
	[iF] = iF;
	constructor(e, t, n, r, i) {
		this.buckets = e, this.count = t, this.min = n, this.max = r, this.sum = i;
	}
	[H]() {
		return z(U(rF), W(U(this.buckets)), W(U(this.count)), W(U(this.min)), W(U(this.max)), W(U(this.sum)), Wg(this));
	}
	[G](e) {
		return SF(e) && K(this.buckets, e.buckets) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return q(this, arguments);
	}
}, pF = class {
	error;
	quantiles;
	count;
	min;
	max;
	sum;
	[XP] = sF;
	[oF] = oF;
	constructor(e, t, n, r, i, a) {
		this.error = e, this.quantiles = t, this.count = n, this.min = r, this.max = i, this.sum = a;
	}
	[H]() {
		return z(U(aF), W(U(this.error)), W(U(this.quantiles)), W(U(this.count)), W(U(this.min)), W(U(this.max)), W(U(this.sum)), Wg(this));
	}
	[G](e) {
		return CF(e) && this.error === e.error && K(this.quantiles, e.quantiles) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return q(this, arguments);
	}
}, mF = (e) => new cF(e), hF = (e) => new uF(e), gF = (e) => new dF(e), _F = (e) => new fF(e.buckets, e.count, e.min, e.max, e.sum), vF = (e) => new pF(e.error, e.quantiles, e.count, e.min, e.max, e.sum), yF = (e) => V(e, QP), bF = (e) => V(e, eF), xF = (e) => V(e, nF), SF = (e) => V(e, iF), CF = (e) => V(e, oF), wF = /*#__PURE__*/ Symbol.for("effect/MetricHook"), TF = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, EF = (e) => ({
	[wF]: TF,
	pipe() {
		return q(this, arguments);
	},
	...e
}), DF = /*#__PURE__*/ BigInt(0), OF = (e) => {
	let t = e.keyType.bigint ? DF : 0, n = e.keyType.incremental ? e.keyType.bigint ? (e) => e >= DF : (e) => e >= 0 : (e) => !0, r = (e) => {
		n(e) && (t += e);
	};
	return EF({
		get: () => mF(t),
		update: r,
		modify: r
	});
}, kF = (e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.keyType.preregisteredWords) t.set(n, 0);
	let n = (e) => {
		let n = t.get(e) ?? 0;
		t.set(e, n + 1);
	};
	return EF({
		get: () => hF(t),
		update: n,
		modify: n
	});
}, AF = (e, t) => {
	let n = t;
	return EF({
		get: () => gF(n),
		update: (e) => {
			n = e;
		},
		modify: (e) => {
			n += e;
		}
	});
}, jF = (e) => {
	let t = e.keyType.boundaries.values, n = t.length, r = new Uint32Array(n + 1), i = new Float64Array(n), a = 0, o = 0, s = Number.MAX_VALUE, c = Number.MIN_VALUE;
	z(t, Bv(ay), Zv((e, t) => {
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
		let e = _v(n), t = 0;
		for (let a = 0; a < n; a++) {
			let n = i[a], o = r[a];
			t += o, e[a] = [n, t];
		}
		return e;
	};
	return EF({
		get: () => _F({
			buckets: u(),
			count: a,
			min: s,
			max: c,
			sum: o
		}),
		update: l,
		modify: l
	});
}, MF = (e) => {
	let { error: t, maxAge: n, maxSize: r, quantiles: i } = e.keyType, a = z(i, Bv(ay)), o = _v(r), s = 0, c = 0, l = 0, u = 0, d = 0, f = (e) => {
		let i = [], s = 0;
		for (; s !== r - 1;) {
			let t = o[s];
			if (t != null) {
				let [r, a] = t, o = Vb(e - r);
				ex(o, Lb) && $b(o, n) && i.push(a);
			}
			s += 1;
		}
		return NF(t, a, Bv(i, ay));
	}, p = (e, t) => {
		if (r > 0) {
			s += 1;
			let n = s % r;
			o[n] = [t, e];
		}
		u = c === 0 ? e : Math.min(u, e), d = c === 0 ? e : Math.max(d, e), c += 1, l += e;
	};
	return EF({
		get: () => vF({
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
}, NF = (e, t, n) => {
	let r = n.length;
	if (!Ev(t)) return Yv();
	let i = t[0], a = t.slice(1), o = PF(e, r, J(), 0, i, n), s = Xv(o);
	return a.forEach((t) => {
		s.push(PF(e, r, o.value, o.consumed, t, o.rest));
	}), Zv(s, (e) => [e.quantile, e.value]);
}, PF = (e, t, n, r, i, a) => {
	let o = e, s = t, c = n, l = r, u = i, d = a, f = e, p = t, m = n, h = r, g = i, _ = a;
	for (;;) {
		if (!Ev(d)) return {
			quantile: u,
			value: J(),
			consumed: l,
			rest: []
		};
		if (u === 1) return {
			quantile: u,
			value: Y(Pv(d)),
			consumed: l + d.length,
			rest: []
		};
		let e = Mv(d), t = Lv(d, (t) => t === e), n = u * s, r = o / 2 * n, i = l + t[0].length, a = Math.abs(i - n);
		if (i < n - r) f = o, p = s, m = jv(d), h = i, g = u, _ = t[1], o = f, s = p, c = m, l = h, u = g, d = _;
		else {
			if (i > n + r) {
				let t = ov(c) ? Y(e) : c;
				return {
					quantile: u,
					value: t,
					consumed: l,
					rest: d
				};
			}
			switch (c._tag) {
				case "None":
					f = o, p = s, m = jv(d), h = i, g = u, _ = t[1], o = f, s = p, c = m, l = h, u = g, d = _;
					continue;
				case "Some":
					if (a < Math.abs(n - c.value)) {
						f = o, p = s, m = jv(d), h = i, g = u, _ = t[1], o = f, s = p, c = m, l = h, u = g, d = _;
						continue;
					}
					return {
						quantile: u,
						value: Y(c.value),
						consumed: l,
						rest: d
					};
			}
		}
	}
	throw Error("BUG: MetricHook.resolveQuantiles - please report an issue at https://github.com/Effect-TS/effect/issues");
}, FF = /*#__PURE__*/ Symbol.for("effect/MetricPair"), IF = {
/* c8 ignore next */
_Type: (e) => e }, LF = (e, t) => ({
	[FF]: IF,
	metricKey: e,
	metricState: t,
	pipe() {
		return q(this, arguments);
	}
}), RF = /*#__PURE__*/ Symbol.for("effect/MetricRegistry"), zF = class {
	[RF] = RF;
	map = /*#__PURE__*/ vk();
	snapshot() {
		let e = [];
		for (let [t, n] of this.map) e.push(LF(t, n.get()));
		return e;
	}
	get(e) {
		let t = z(this.map, yk(e), fv);
		if (t == null) {
			if (LP(e.keyType)) return this.getCounter(e);
			if (zP(e.keyType)) return this.getGauge(e);
			if (RP(e.keyType)) return this.getFrequency(e);
			if (BP(e.keyType)) return this.getHistogram(e);
			if (VP(e.keyType)) return this.getSummary(e);
			throw Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
		}
		return t;
	}
	getCounter(e) {
		let t = z(this.map, yk(e), fv);
		if (t == null) {
			let n = OF(e);
			z(this.map, xk(e)) || z(this.map, Sk(e, n)), t = n;
		}
		return t;
	}
	getFrequency(e) {
		let t = z(this.map, yk(e), fv);
		if (t == null) {
			let n = kF(e);
			z(this.map, xk(e)) || z(this.map, Sk(e, n)), t = n;
		}
		return t;
	}
	getGauge(e) {
		let t = z(this.map, yk(e), fv);
		if (t == null) {
			let n = AF(e, e.keyType.bigint ? BigInt(0) : 0);
			z(this.map, xk(e)) || z(this.map, Sk(e, n)), t = n;
		}
		return t;
	}
	getHistogram(e) {
		let t = z(this.map, yk(e), fv);
		if (t == null) {
			let n = jF(e);
			z(this.map, xk(e)) || z(this.map, Sk(e, n)), t = n;
		}
		return t;
	}
	getSummary(e) {
		let t = z(this.map, yk(e), fv);
		if (t == null) {
			let n = MF(e);
			z(this.map, xk(e)) || z(this.map, Sk(e, n)), t = n;
		}
		return t;
	}
}, BF = () => new zF(), VF = /*#__PURE__*/ Symbol.for("effect/Metric"), HF = {
	/* c8 ignore next */
	_Type: (e) => e,
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, UF = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Metric/globalMetricRegistry"), () => BF()), WF = function(e, t, n, r) {
	let i = Object.assign((e) => fD(e, (e) => XF(i, e)), {
		[VF]: HF,
		keyType: e,
		unsafeUpdate: t,
		unsafeValue: n,
		unsafeModify: r,
		register() {
			return this.unsafeValue([]), this;
		},
		pipe() {
			return q(this, arguments);
		}
	});
	return i;
}, GF = (e, t) => KF(qP(e, t)), KF = (e) => {
	let t, n = /* @__PURE__ */ new WeakMap(), r = (r) => {
		if (r.length === 0) return t === void 0 && (t = UF.get(e)), t;
		let i = n.get(r);
		return i === void 0 && (i = UF.get(YP(e, r)), n.set(r, i)), i;
	};
	return WF(e.keyType, (e, t) => r(t).update(e), (e) => r(e).get(), (e, t) => r(t).modify(e));
}, qF = (e, t, n) => KF(JP(e, t, n)), JF = /*#__PURE__*/ R(3, (e, t, n) => YF(e, [Gj(t, n)])), YF = /*#__PURE__*/ R(2, (e, t) => WF(e.keyType, (n, r) => e.unsafeUpdate(n, Jv(t, r)), (n) => e.unsafeValue(Jv(t, n)), (n, r) => e.unsafeModify(n, Jv(t, r)))), XF = /*#__PURE__*/ R(2, (e, t) => HD(uO, (n) => $(() => e.unsafeUpdate(t, n))));
({ ...O_ });
var ZF = /*#__PURE__*/ R(2, (e, t) => HD(WN, (n) => $(() => {
	if (n.has(e)) {
		let r = n.get(e);
		r.state.completed || (r.state.completed = !0, nk(r.result, t));
	}
}))), QF = /*#__PURE__*/ Symbol.for("effect/Supervisor"), $F = {
/* c8 ignore next */
_T: (e) => e }, eI = class e {
	underlying;
	value0;
	[QF] = $F;
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
		return new e(this, z(this.value, sD(t)));
	}
	zip(e) {
		return new tI(this, e);
	}
}, tI = class e {
	left;
	right;
	_tag = "Zip";
	[QF] = $F;
	constructor(e, t) {
		this.left = e, this.right = t;
	}
	get value() {
		return TD(this.left.value, this.right.value);
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
		return new eI(this, z(this.value, sD(e)));
	}
	zip(t) {
		return new e(this, t);
	}
}, nI = (e) => V(e, QF) && mg(e, "Zip"), rI = class {
	effect;
	[QF] = $F;
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
		return new eI(this, z(this.value, sD(e)));
	}
	zip(e) {
		return new tI(this, e);
	}
	onRun(e, t) {
		return e();
	}
}, iI = (e) => new rI(e), aI = /*#__PURE__*/ B("effect/Supervisor/none", () => iI(gD)), oI = Cw, sI = "Empty", cI = "AddSupervisor", lI = "RemoveSupervisor", uI = "AndThen", dI = { _tag: sI }, fI = (e, t) => ({
	_tag: uI,
	first: e,
	second: t
}), pI = (e, t) => mI(t, rb(e)), mI = (e, t) => {
	let n = e, r = t;
	for (; _b(r);) {
		let e = bb(r);
		switch (e._tag) {
			case sI:
				r = xb(r);
				break;
			case cI:
				n = n.zip(e.supervisor), r = xb(r);
				break;
			case lI:
				n = hI(n, e.supervisor), r = xb(r);
				break;
			case uI: r = pb(e.first)(pb(e.second)(xb(r)));
		}
	}
	return n;
}, hI = (e, t) => K(e, t) ? aI : nI(e) ? hI(e.left, t).zip(hI(e.right, t)) : e, gI = (e) => K(e, aI) ? SS() : nI(e) ? z(gI(e.left), AS(gI(e.right))) : wS(e), _I = /*#__PURE__*/ oI({
	empty: dI,
	patch: pI,
	combine: fI,
	diff: (e, t) => {
		if (K(e, t)) return dI;
		let n = gI(e), r = gI(t);
		return fI(z(r, kS(n), jS(dI, (e, t) => fI(e, {
			_tag: cI,
			supervisor: t
		}))), z(n, kS(r), jS(dI, (e, t) => fI(e, {
			_tag: lI,
			supervisor: t
		}))));
	}
}), vI = /*#__PURE__*/ GF("effect_fiber_started", { incremental: !0 }), yI = /*#__PURE__*/ GF("effect_fiber_active"), bI = /*#__PURE__*/ GF("effect_fiber_successes", { incremental: !0 }), xI = /*#__PURE__*/ GF("effect_fiber_failures", { incremental: !0 }), SI = /*#__PURE__*/ JF(/*#__PURE__*/ qF("effect_fiber_lifetimes", /*#__PURE__*/ CP({
	start: .5,
	factor: 2,
	count: 35
})), "time_unit", "milliseconds"), CI = "Continue", wI = "Done", TI = "Yield", EI = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, DI = (e) => {
	throw Error(`BUG: FiberRuntime - ${Zg(e)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, OI = /*#__PURE__*/ Symbol.for("effect/internal/fiberRuntime/YieldedOp"), kI = /*#__PURE__*/ B("effect/internal/fiberRuntime/yieldedOpChannel", () => ({ currentOp: null })), AI = {
	[c_]: (e, t, n) => Pg(() => t.effect_instruction_i1(n)),
	OnStep: (e, t, n) => GO(GO(n)),
	[l_]: (e, t, n) => Pg(() => t.effect_instruction_i2(n)),
	[__]: (e, t, n) => (e.patchRuntimeFlags(e.currentRuntimeFlags, t.patch), Uw(e.currentRuntimeFlags) && e.isInterrupted() ? BO(e.getInterruptedCause()) : GO(n)),
	[p_]: (e, t, n) => (Pg(() => t.effect_instruction_i2(n)), Pg(() => t.effect_instruction_i0()) ? (e.pushStack(t), Pg(() => t.effect_instruction_i1())) : gD),
	[m_]: (e, t, n) => {
		for (;;) {
			let r = Pg(() => t.effect_instruction_i0.next(n));
			if (r.done) return GO(r.value);
			let i = jg(r.value);
			if (!MO(i)) return e.pushStack(t), i;
			if (i._tag === "Failure") return i;
			n = i.value;
		}
	}
}, jI = {
	[KN]: (e, t, n, r) => (e.processNewInterruptSignal(r.cause), Uw(t) ? BO(r.cause) : n),
	[JN]: (e, t, n, r) => {
		throw Error("It is illegal to have multiple concurrent run loops in a single fiber");
	},
	[qN]: (e, t, n, r) => (r.onFiber(e, IM(t)), n),
	[YN]: (e, t, n, r) => X(wD(), () => n)
}, MI = (e) => aD(iT(e), (e) => JI(ST(e), ([e, t]) => {
	let n = /* @__PURE__ */ new Map(), r = [];
	for (let e of t) {
		r.push(ob(e));
		for (let t of e) n.set(t.request, t);
	}
	let i = r.flat();
	return GD(xL(e.runAll(r), i, () => i.forEach((e) => {
		e.listeners.interrupted = !0;
	})), WN, n);
}, !1, !1)), NI = /*#__PURE__*/ y_(), PI = class extends Cj {
	[aP] = oP;
	[cP] = EI;
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
		if (super(), this.currentRuntimeFlags = n, this._fiberId = e, this._fiberRefs = t, Jw(n)) {
			let e = this.getFiberRef(uO);
			vI.unsafeUpdate(1, e), yI.unsafeUpdate(1, e);
		}
		this.refreshRefCache();
	}
	commit() {
		return lP(this);
	}
	id() {
		return this._fiberId;
	}
	resume(e) {
		this.tell(QN(e));
	}
	get status() {
		return this.ask((e, t) => t);
	}
	get runtimeFlags() {
		return this.ask((e, t) => RM(t) ? e.currentRuntimeFlags : t.runtimeFlags);
	}
	scope() {
		return rP(this);
	}
	get children() {
		return this.ask((e) => Array.from(e.getChildren()));
	}
	getChildren() {
		return this._children === null && (this._children = /* @__PURE__ */ new Set()), this._children;
	}
	getInterruptedCause() {
		return this.getFiberRef(fO);
	}
	fiberRefs() {
		return this.ask((e) => e.getFiberRefs());
	}
	ask(e) {
		return Q(() => {
			let t = YO(this._fiberId);
			return this.tell(ZN((n, r) => {
				nk(t, $(() => e(n, r)));
			})), QO(t);
		});
	}
	tell(e) {
		this._queue.push(e), this._running || (this._running = !0, this.drainQueueLaterOnExecutor());
	}
	get await() {
		return zE((e) => {
			let t = (t) => e(Z(t));
			if (this._exitValue !== null) t(this._exitValue);
			else return this.tell(ZN((e, n) => {
				e._exitValue === null ? e.addObserver(t) : t(this._exitValue);
			})), $(() => this.tell(ZN((e, n) => {
				e.removeObserver(t);
			})));
		}, this.id());
	}
	get inheritAll() {
		return ME((e, t) => {
			let n = e.id(), r = e.getFiberRefs(), i = t.runtimeFlags, a = ZA(r, n, this.getFiberRefs());
			return e.setFiberRefs(a), _D(z(Xw(i, e.getFiberRef(vL)), tT(1), tT(16)));
		});
	}
	get poll() {
		return $(() => dv(this._exitValue));
	}
	unsafePoll() {
		return this._exitValue;
	}
	interruptAsFork(e) {
		return $(() => this.tell(XN(FT(e))));
	}
	unsafeInterruptAsFork(e) {
		this.tell(XN(FT(e)));
	}
	addObserver(e) {
		this._exitValue === null ? this._observers.push(e) : e(this._exitValue);
	}
	removeObserver(e) {
		this._observers = this._observers.filter((t) => t !== e);
	}
	getFiberRefs() {
		return this.setFiberRef(vL, this.currentRuntimeFlags), this._fiberRefs;
	}
	unsafeDeleteFiberRef(e) {
		this._fiberRefs = ej(this._fiberRefs, e);
	}
	getFiberRef(e) {
		return this._fiberRefs.locals.has(e) ? this._fiberRefs.locals.get(e)[0][1] : e.initial;
	}
	setFiberRef(e, t) {
		this._fiberRefs = rj(this._fiberRefs, {
			fiberId: this._fiberId,
			fiberRef: e,
			value: t
		}), this.refreshRefCache();
	}
	refreshRefCache() {
		this.currentDefaultServices = this.getFiberRef(GA), this.currentTracer = this.currentDefaultServices.unsafeMap.get(RA.key), this.currentSupervisor = this.getFiberRef(yL), this.currentScheduler = this.getFiberRef(UN), this.currentContext = this.getFiberRef($D), this.currentSpan = this.currentContext.unsafeMap.get(zA.key);
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
			let t = CI, n = globalThis[uP];
			globalThis[uP] = this;
			try {
				for (; t === CI;) t = this._queue.length === 0 ? wI : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
			} finally {
				this._running = !1, globalThis[uP] = n;
			}
			this._queue.length > 0 && !this._running ? (this._running = !0, t === TI ? (this.drainQueueLaterOnExecutor(), e = !1) : e = !0) : e = !1;
		}
	}
	drainQueueLaterOnExecutor() {
		this.currentScheduler.scheduleTask(this.run, this.getFiberRef(eO), this);
	}
	drainQueueWhileRunning(e, t) {
		let n = t;
		for (; this._queue.length > 0;) {
			let t = this._queue.splice(0, 1)[0];
			n = jI[t._tag](this, e, n, t);
		}
		return n;
	}
	isInterrupted() {
		return !BT(this.getFiberRef(fO));
	}
	addInterruptedCause(e) {
		let t = this.getFiberRef(fO);
		this.setFiberRef(fO, LT(t, e));
	}
	processNewInterruptSignal(e) {
		this.addInterruptedCause(e), this.sendInterruptSignalToAllChildren();
	}
	sendInterruptSignalToAllChildren() {
		if (this._children === null || this._children.size === 0) return !1;
		let e = !1;
		for (let t of this._children) t.tell(XN(FT(this.id()))), e = !0;
		return e;
	}
	interruptAllChildren() {
		if (this.sendInterruptSignalToAllChildren()) {
			let e = this._children.values();
			this._children = null;
			let t = !1;
			return yD({
				while: () => !t,
				body: () => {
					let n = e.next();
					return n.done ? $(() => {
						t = !0;
					}) : FE(n.value.await);
				},
				step: () => {}
			});
		}
		return null;
	}
	reportExitValue(e) {
		if (Jw(this.currentRuntimeFlags)) {
			let t = this.getFiberRef(uO), n = this.id().startTimeMillis, r = Date.now();
			switch (SI.unsafeUpdate(r - n, t), yI.unsafeUpdate(-1, t), e._tag) {
				case u_:
					bI.unsafeUpdate(1, t);
					break;
				case o_: xI.unsafeUpdate(1, t);
			}
		}
		if (e._tag === "Failure") {
			let t = this.getFiberRef(cO);
			!HT(e.cause) && t._tag === "Some" && this.log("Fiber terminated with an unhandled error", e.cause, t);
		}
	}
	setExitValue(e) {
		this._exitValue = e, this.reportExitValue(e);
		for (let t = this._observers.length - 1; t >= 0; t--) this._observers[t](e);
		this._observers = [];
	}
	getLoggers() {
		return this.getFiberRef(zI);
	}
	log(e, t, n) {
		let r = sv(n) ? n.value : this.getFiberRef(rO);
		if (_j(this.getFiberRef(FI), r)) return;
		let i = this.getFiberRef(iO), a = this.getFiberRef(nO), o = this.getLoggers(), s = this.getFiberRefs();
		if (ES(o) > 0) {
			let n = By(this.getFiberRef(GA), Tk), c = new Date(n.unsafeCurrentTimeMillis());
			n_(s, () => {
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
			case YN: return TI;
			case KN: return this.processNewInterruptSignal(e.cause), this._asyncInterruptor !== null && (this._asyncInterruptor(BO(e.cause)), this._asyncInterruptor = null), CI;
			case JN: return this._asyncInterruptor = null, this._asyncBlockingOn = null, this.evaluateEffect(e.effect), CI;
			case qN: return e.onFiber(this, this._exitValue === null ? LM(this.currentRuntimeFlags, this._asyncBlockingOn) : FM), CI;
			default: return DI(e);
		}
	}
	evaluateEffect(e) {
		this.currentSupervisor.onResume(this);
		try {
			let t = Uw(this.currentRuntimeFlags) && this.isInterrupted() ? BO(this.getInterruptedCause()) : e;
			for (; t !== null;) {
				let e = t, n = this.runLoop(e);
				if (n === OI) {
					let e = kI.currentOp;
					kI.currentOp = null, e._op === "Yield" ? Bw(this.currentRuntimeFlags) ? (this.tell($N()), this.tell(QN(KO)), t = null) : t = KO : e._op === "Async" && (t = null);
				} else {
					this.currentRuntimeFlags = z(this.currentRuntimeFlags, Hw(16));
					let e = this.interruptAllChildren();
					e === null ? (this._queue.length === 0 ? this.setExitValue(n) : this.tell(QN(n)), t = null) : t = X(e, () => n);
				}
			}
		} finally {
			this.currentSupervisor.onSuspend(this);
		}
	}
	start(e) {
		if (this._running) this.tell(QN(e));
		else {
			this._running = !0;
			let t = globalThis[uP];
			globalThis[uP] = this;
			try {
				this.evaluateEffect(e);
			} finally {
				this._running = !1, globalThis[uP] = t, this._queue.length > 0 && this.drainQueueLaterOnExecutor();
			}
		}
	}
	startFork(e) {
		this.tell(QN(e));
	}
	patchRuntimeFlags(e, t) {
		let n = Zw(e, t);
		return globalThis[uP] = this, this.currentRuntimeFlags = n, n;
	}
	initiateAsync(e, t) {
		let n = !1, r = (e) => {
			n || (n = !0, this.tell(QN(e)));
		};
		Uw(e) && (this._asyncInterruptor = r);
		try {
			t(r);
		} catch (e) {
			r(YE(PT(e)));
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
		return $(() => Vy(this.currentContext, e));
	}
	Left(e) {
		return qE(e.left);
	}
	None(e) {
		return qE(new kO());
	}
	Right(e) {
		return GO(e.right);
	}
	Some(e) {
		return GO(e.value);
	}
	Micro(e) {
		return LE((t) => {
			let n = t, r = LN(ON(e, this.currentContext));
			return r.addObserver((e) => {
				if (e._tag === "Success") return n(GO(e.value));
				switch (e.cause._tag) {
					case "Interrupt": return n(BO(FT(ZS)));
					case "Fail": return n(qE(e.cause.error));
					case "Die": return n(UE(e.cause.defect));
				}
			}), LE((e) => {
				n = (t) => {
					e(gD);
				}, r.unsafeInterrupt();
			});
		});
	}
	[d_](e) {
		let t = Pg(() => e.effect_instruction_i0()), n = this.getNextSuccessCont();
		return n === void 0 ? (kI.currentOp = GO(t), OI) : (n._op in AI || DI(n), AI[n._op](this, n, t));
	}
	[u_](e) {
		let t = e, n = this.getNextSuccessCont();
		return n === void 0 ? (kI.currentOp = t, OI) : (n._op in AI || DI(n), AI[n._op](this, n, t.effect_instruction_i0));
	}
	[o_](e) {
		let t = e.effect_instruction_i0, n = this.getNextFailCont();
		if (n !== void 0) switch (n._op) {
			case s_:
			case l_: return Uw(this.currentRuntimeFlags) && this.isInterrupted() ? BO(YT(t)) : Pg(() => n.effect_instruction_i1(t));
			case "OnStep": return Uw(this.currentRuntimeFlags) && this.isInterrupted() ? BO(YT(t)) : GO(BO(t));
			case __: return this.patchRuntimeFlags(this.currentRuntimeFlags, n.patch), Uw(this.currentRuntimeFlags) && this.isInterrupted() ? BO(LT(t, this.getInterruptedCause())) : BO(t);
			default: DI(n);
		}
		else return kI.currentOp = BO(t), OI;
	}
	[h_](e) {
		return Pg(() => e.effect_instruction_i0(this, IM(this.currentRuntimeFlags)));
	}
	Blocked(e) {
		let t = this.getFiberRefs(), n = this.currentRuntimeFlags;
		if (this._steps.length > 0) {
			let r = [], i = this._steps[this._steps.length - 1], a = this.popStack();
			for (; a && a._op !== "OnStep";) r.push(a), a = this.popStack();
			this.setFiberRefs(i.refs), this.currentRuntimeFlags = i.flags;
			let o = yM(i.refs, t), s = Xw(i.flags, n);
			return GO(wE(e.effect_instruction_i0, ME((t) => {
				for (; r.length > 0;) t.pushStack(r.pop());
				return t.setFiberRefs(bM(t.id(), t.getFiberRefs())(o)), t.currentRuntimeFlags = Zw(s)(t.currentRuntimeFlags), e.effect_instruction_i1;
			})));
		}
		return hD((t) => X(XI(TE(e.effect_instruction_i0)), () => t(e.effect_instruction_i1)));
	}
	RunBlocked(e) {
		return MI(e.effect_instruction_i0);
	}
	[f_](e) {
		let t = e.effect_instruction_i0, n = this.currentRuntimeFlags, r = Zw(n, t);
		if (Uw(r) && this.isInterrupted()) return BO(this.getInterruptedCause());
		if (this.patchRuntimeFlags(this.currentRuntimeFlags, t), e.effect_instruction_i1) {
			let t = Xw(r, n);
			return this.pushStack(new DE(t, e)), Pg(() => e.effect_instruction_i1(n));
		}
		return KO;
	}
	[c_](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	OnStep(e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[s_](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[l_](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[i_](e) {
		return this._asyncBlockingOn = e.effect_instruction_i1, this.initiateAsync(this.currentRuntimeFlags, e.effect_instruction_i0), kI.currentOp = e, OI;
	}
	[g_](e) {
		return this._isYielding = !1, kI.currentOp = e, OI;
	}
	[p_](e) {
		let t = e.effect_instruction_i0, n = e.effect_instruction_i1;
		return t() ? (this.pushStack(e), n()) : KO;
	}
	[m_](e) {
		return AI[m_](this, e, void 0);
	}
	[a_](e) {
		return Pg(() => e.commit());
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
					t = X(wD({ priority: e }), () => n);
				}
			}
			try {
				if (t = this.currentTracer.context(() => {
					if (NI !== t[EE]._V) {
						let e = this.getFiberRef(lO);
						if (e._tag === "Some") {
							let n = t[EE]._V;
							this.log(`Executing an Effect versioned ${n} with a Runtime of version ${y_()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, MT, e);
						}
					}
					return this[t._op](t);
				}, this), t === OI) {
					let e = kI.currentOp;
					return e._op === "Yield" || e._op === "Async" ? OI : (kI.currentOp = null, e._op === "Success" || e._op === "Failure" ? e : BO(PT(e)));
				}
			} catch (e) {
				t = t !== OI && !V(t, "_op") || !(t._op in this) ? WE(`Not a valid effect: ${Zg(t)}`) : DO(e) ? BO(LT(PT(e), FT(ZS))) : UE(e);
			}
		}
	}
	run = () => {
		this.drainQueueOnCurrentThread();
	};
}, FI = /*#__PURE__*/ B("effect/FiberRef/currentMinimumLogLevel", () => qD(vj("Info"))), II = (e) => pP((t) => {
	By(oj(t.context, GA), OA).unsafe.log(e.log(t));
}), LI = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Logger/defaultLogger"), () => II(hP)), RI = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Logger/tracerLogger"), () => pP(({ annotations: e, cause: t, context: n, fiberId: r, logLevel: i, message: a }) => {
	let o = sM(Hy(nj(n, $D), zA));
	if (o._tag === "None" || o.value._tag === "ExternalSpan") return;
	let s = Vy(nj(n, GA), Tk), c = {};
	for (let [t, n] of e) c[t] = n;
	c["effect.fiberId"] = $S(r), c["effect.logLevel"] = i.label, t !== null && t._tag !== "Empty" && (c["effect.cause"] = cE(t, { renderErrorCause: !0 })), o.value.event(Zg(Array.isArray(a) && a.length === 1 ? a[0] : a), s.unsafeCurrentTimeNanos(), c);
})), zI = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLoggers"), () => JD(wS(LI, RI))), BI = /*#__PURE__*/ R((e) => jE(e[0]), (e, t) => mD(fD(e, (e) => VI((n) => t(e, n))))), VI = (e) => ME((t) => {
	let n = t.getFiberRefs(), r = Vw(t.currentRuntimeFlags, 1);
	return X(uL, (t) => gO(t, (t) => ME((i) => {
		let a = i.getFiberRefs(), o = i.currentRuntimeFlags, s = yM(a, n), c = Xw(o, r), l = yM(n, a);
		return i.setFiberRefs(bM(s, i.id(), n)), bL(CD(e(t), c), $(() => {
			i.setFiberRefs(bM(l, i.id(), i.getFiberRefs()));
		}));
	})));
}), HI = (e) => {
	if (Array.isArray(e) || gg(e)) return [e, J()];
	let t = Object.keys(e), n = t.length;
	return [t.map((t) => e[t]), Y((e) => {
		let r = {};
		for (let i = 0; i < n; i++) r[t[i]] = e[i];
		return r;
	})];
}, UI = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(GE(t));
	return X(KI(r, Zh, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => {
		let r = J(), i = e.length, a = Array(i), o = Array(i), s = !1;
		for (let t = 0; t < i; t++) {
			let n = e[t];
			n._tag === "Left" ? (a[t] = Y(n.left), s = !0) : (o[t] = n.right, a[t] = r);
		}
		return s ? t._tag === "Some" ? qE(t.value(a)) : qE(a) : n?.discard ? gD : t._tag === "Some" ? Z(t.value(o)) : Z(o);
	});
}, WI = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(GE(t));
	return n?.discard ? KI(r, Zh, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		discard: !0,
		concurrentFinalizers: n?.concurrentFinalizers
	}) : sD(KI(r, Zh, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => t._tag === "Some" ? t.value(e) : e);
}, GI = (e, t) => {
	let [n, r] = HI(e);
	return t?.mode === "validate" ? UI(n, r, t) : t?.mode === "either" ? WI(n, r, t) : t?.discard !== !0 && r._tag === "Some" ? sD(KI(n, Zh, t), r.value) : KI(n, Zh, t);
}, KI = /*#__PURE__*/ R((e) => gg(e[0]), (e, t, n) => ME((r) => {
	let i = n?.batching === !0 || n?.batching === "inherit" && r.getFiberRef(sO);
	return n?.discard ? GN(n.concurrency, () => rL(gM, n?.concurrentFinalizers)((n) => i ? JI(e, (e, r) => n(t(e, r)), !0, !1, 1) : aD(e, (e, r) => n(t(e, r)))), () => rL(_M, n?.concurrentFinalizers)((n) => JI(e, (e, r) => n(t(e, r)), i, !1)), (r) => rL(vM(r), n?.concurrentFinalizers)((n) => JI(e, (e, r) => n(t(e, r)), i, !1, r))) : GN(n?.concurrency, () => rL(gM, n?.concurrentFinalizers)((n) => i ? YI(e, 1, (e, r) => n(t(e, r)), !0) : iD(e, (e, r) => n(t(e, r)))), () => rL(_M, n?.concurrentFinalizers)((n) => qI(e, (e, r) => n(t(e, r)), i)), (r) => rL(vM(r), n?.concurrentFinalizers)((n) => YI(e, r, (e, r) => n(t(e, r)), i)));
})), qI = (e, t, n) => Q(() => {
	let r = yv(e), i = Array(r.length);
	return DD(JI(r, (e, n) => X(t(e, n), (e) => $(() => i[n] = e)), n, !1), Z(i));
}), JI = (e, t, n, r, i) => hD((a) => pD((o) => ME((s) => {
	let c = Array.from(e).reverse(), l = c.length;
	if (l === 0) return gD;
	let u = 0, d = !1, f = i ? Math.min(c.length, i) : c.length, p = /* @__PURE__ */ new Set(), m = [], h = () => p.forEach((e) => {
		e.currentScheduler.scheduleTask(() => {
			e.unsafeInterruptAsFork(s.id());
		}, 0, e);
	}), g = [], _ = [], v = [], y = () => {
		let e = m.filter(({ exit: e }) => e._tag === "Failure").sort((e, t) => e.index < t.index ? -1 : e.index === t.index ? 0 : 1).map(({ exit: e }) => e);
		return e.length === 0 && e.push(KO), e;
	}, b = (e, t = !1) => {
		let n = mD(o(e)), r = QI(n, s, s.currentRuntimeFlags, iP);
		return s.currentScheduler.scheduleTask(() => {
			t && r.unsafeInterruptAsFork(s.id()), r.resume(n);
		}, 0, r), r;
	}, x = () => {
		r || (l -= c.length, c = []), d = !0, h();
	}, S = n ? $E : KE, C = b(zE((e) => {
		let r = (e, t) => {
			e._op === "Blocked" ? v.push(e) : (m.push({
				index: t,
				exit: e
			}), e._op === "Failure" && !d && x());
		}, o = () => {
			if (c.length > 0) {
				let f = c.pop(), h = u++, x = () => {
					let e = c.pop();
					return h = u++, X(wD(), () => X(S(a(t(e, h))), C));
				}, C = (e) => c.length > 0 && (r(e, h), c.length > 0) ? x() : Z(e), w = X(S(a(t(f, h))), C), T = b(w);
				g.push(T), p.add(T), d && T.currentScheduler.scheduleTask(() => {
					T.unsafeInterruptAsFork(s.id());
				}, 0, T), T.addObserver((t) => {
					let a;
					if (a = t._op === "Failure" ? t : t.effect_instruction_i0, _.push(T), p.delete(T), r(a, h), m.length === l) e(Z(lv(LO(y(), { parallel: !0 }), () => KO)));
					else if (v.length + m.length === l) {
						let t = y();
						e(Z(wE(v.map((e) => e.effect_instruction_i0).reduce(nT), JI([lv(LO(t, { parallel: !0 }), () => KO), ...v.map((e) => e.effect_instruction_i1)], (e) => e, n, !0, i))));
					} else o();
				});
			}
		};
		for (let e = 0; e < f; e++) o();
	}));
	return FE(uD(eD(a(lP(C))), UO({
		onFailure: (e) => {
			x();
			let t = v.length + 1, n = Math.min(typeof i == "number" ? i : v.length, v.length), r = Array.from(v);
			return zE((i) => {
				let a = [], o = 0, s = 0, c = (n, s) => (c) => {
					a[n] = c, o++, o === t && i(GO(BO(e))), r.length > 0 && s && l();
				}, l = () => {
					b(r.pop(), !0).addObserver(c(s, !0)), s++;
				};
				C.addObserver(c(s, !1)), s++;
				for (let e = 0; e < n; e++) l();
			});
		},
		onSuccess: () => iD(_, (e) => e.inheritAll)
	})));
}))), YI = (e, t, n, r) => Q(() => {
	let i = yv(e), a = Array(i.length);
	return DD(JI(i, (e, t) => sD(n(e, t), (e) => a[t] = e), r, !1, t), Z(a));
}), XI = (e) => eL(e, iP), ZI = (e, t, n, r = null) => {
	let i = $I(e, t, n, r);
	return i.resume(e), i;
}, QI = (e, t, n, r = null) => $I(e, t, n, r), $I = (e, t, n, r = null) => {
	let i = eC(), a = QA(t.getFiberRefs(), i), o = new PI(i, a, n), s = nj(a, $D), c = o.currentSupervisor;
	return c.onStart(s, e, Y(t), o), o.addObserver((e) => c.onEnd(e, o)), (r === null ? z(t.getFiberRef(dO), lv(() => t.scope())) : r).add(n, o), o;
}, eL = (e, t) => ME((n, r) => Z(ZI(e, n, r.runtimeFlags, t))), tL = (e) => ok((t) => cv(Hy(t, lL), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Parallel": return e;
			case "Sequential":
			case "ParallelN": return X(vO(t, _M), (t) => hL(e, t));
		}
	}
})), nL = (e) => (t) => ok((n) => cv(Hy(n, lL), {
	onNone: () => t,
	onSome: (n) => n.strategy._tag === "ParallelN" && n.strategy.parallelism === e ? t : X(vO(n, vM(e)), (e) => hL(t, e))
})), rL = (e, t) => (n) => ok((r) => cv(Hy(r, lL), {
	onNone: () => n(Zh),
	onSome: (r) => {
		if (t === !0) {
			let t = e._tag === "Parallel" ? tL : e._tag === "Sequential" ? sL : nL(e.parallelism);
			switch (r.strategy._tag) {
				case "Parallel": return t(n(tL));
				case "Sequential": return t(n(sL));
				case "ParallelN": return t(n(nL(r.strategy.parallelism)));
			}
		} else return n(Zh);
	}
})), iL = (e) => X(lL, e), aL = (e) => X(mL(), (t) => uD(e(t), (e) => t.close(e))), oL = (e) => X(mL(), (t) => gL(e, t)), sL = (e) => ok((t) => cv(Hy(t, lL), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Sequential": return e;
			case "Parallel":
			case "ParallelN": return X(vO(t, gM), (t) => hL(e, t));
		}
	}
})), cL = /*#__PURE__*/ R((e) => jE(e[1]), (e, t, n, r) => sD(GI([e, t], {
	concurrency: r?.concurrent ? 2 : 1,
	batching: r?.batching,
	concurrentFinalizers: r?.concurrentFinalizers
}), ([e, t]) => n(e, t))), lL = /*#__PURE__*/ Py("effect/Scope"), uL = lL, dL = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.set({}, t);
}, fL = {
	[pO]: pO,
	[mO]: mO,
	pipe() {
		return q(this, arguments);
	},
	fork(e) {
		return $(() => {
			let t = pL(e);
			if (this.state._tag === "Closed") return t.state = this.state, t;
			let n = {};
			return this.state.finalizers.set(n, (e) => t.close(e)), dL(t, (e) => $(() => {
				this.state._tag === "Open" && this.state.finalizers.delete(n);
			})), t;
		});
	},
	close(e) {
		return Q(() => {
			if (this.state._tag === "Closed") return gD;
			let t = Array.from(this.state.finalizers.values()).reverse();
			return this.state = {
				_tag: "Closed",
				exit: e
			}, t.length === 0 ? gD : mM(this.strategy) ? z(iD(t, (t) => KE(t(e))), X((e) => z(LO(e), pv(IO), lv(() => KO)))) : hM(this.strategy) ? z(qI(t, (t) => KE(t(e)), !1), X((e) => z(LO(e, { parallel: !0 }), pv(IO), lv(() => KO)))) : z(YI(t, this.strategy.parallelism, (t) => KE(t(e)), !1), X((e) => z(LO(e, { parallel: !0 }), pv(IO), lv(() => KO))));
		});
	},
	addFinalizer(e) {
		return Q(() => this.state._tag === "Closed" ? e(this.state.exit) : (this.state.finalizers.set({}, e), gD));
	}
}, pL = (e = dM) => {
	let t = Object.create(fL);
	return t.strategy = e, t.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map()
	}, t;
}, mL = (e = dM) => $(() => pL(e)), hL = /*#__PURE__*/ R(2, (e, t) => lk(e, Uy(Ry(lL, t)))), gL = /*#__PURE__*/ R(2, (e, t) => z(e, hL(t), uD((e) => t.close(e)))), _L = (e) => ZD(e, {
	differ: _I,
	fork: dI
}), vL = /*#__PURE__*/ QD(qw), yL = /*#__PURE__*/ _L(aI), bL = /*#__PURE__*/ R(2, (e, t) => hD((n) => nD(n(e), {
	onFailure: (e) => nD(t, {
		onFailure: (t) => YE(LT(e, t)),
		onSuccess: () => YE(e)
	}),
	onSuccess: (e) => PE(t, e)
}))), xL = (e, t, n) => QE((r) => bL(X(XI(oD(e)), (e) => zE((r) => {
	let i = t.map((e) => e.listeners.count), a = () => {
		i.every((e) => e === 0) && t.every((e) => !!(e.result.state.current._tag === "Pending" || e.result.state.current._tag === "Done" && MO(e.result.state.current.effect) && e.result.state.current.effect._tag === "Failure" && VT(e.result.state.current.effect.cause))) && (o.forEach((e) => e()), n?.(), r(kD(e)));
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
	return a(), $(() => {
		o.forEach((e) => e());
	});
})), Q(() => aD(t.flatMap((e) => e.state.completed ? [] : [e]), (e) => ZF(e.request, VO(r)))))), SL = KT, CL = yO, wL = hO, TL = _O, EL = hL, DL = vO, OL = mL, kL = class {
	permits;
	waiters = /*#__PURE__*/ new Set();
	taken = 0;
	constructor(e) {
		this.permits = e;
	}
	get free() {
		return this.permits - this.taken;
	}
	take = (e) => RE((t) => {
		if (this.free < e) {
			let n = () => {
				this.free < e || (this.waiters.delete(n), t(Q(() => this.free < e ? this.take(e) : (this.taken += e, Z(e)))));
			};
			return this.waiters.add(n), $(() => {
				this.waiters.delete(n);
			});
		}
		t(Q(() => this.free < e ? this.take(e) : (this.taken += e, Z(e))));
	});
	updateTakenUnsafe(e, t) {
		return this.taken = t(this.taken), this.waiters.size > 0 && e.getFiberRef(UN).scheduleTask(() => {
			let e = this.waiters.values(), t = e.next();
			for (; t.done === !1 && this.free > 0;) t.value(), t = e.next();
		}, e.getFiberRef(eO), e), Z(this.free);
	}
	updateTaken(e) {
		return ME((t) => this.updateTakenUnsafe(t, e));
	}
	resize = (e) => FE(ME((t) => (this.permits = e, this.free < 0 ? gD : this.updateTakenUnsafe(t, (e) => e))));
	release = (e) => this.updateTaken((t) => t - e);
	releaseAll = /*#__PURE__*/ this.updateTaken((e) => 0);
	withPermits = (e) => (t) => hD((n) => X(n(this.take(e)), (e) => bL(n(t), this.release(e))));
	withPermitsIfAvailable = (e) => (t) => hD((n) => Q(() => this.free < e ? nM : (this.taken += e, bL(n(qj(t)), this.release(e)))));
}, AL = (e) => new kL(e), jL = /*#__PURE__*/ Symbol.for("effect/Ref/SynchronizedRef"), ML = {
/* c8 ignore next */
_A: (e) => e }, NL = class extends Cj {
	ref;
	withLock;
	[jL] = ML;
	[Tj] = Ej;
	[wj] = wj;
	constructor(e, t) {
		super(), this.ref = e, this.withLock = t, this.get = Aj(this.ref);
	}
	get;
	commit() {
		return this.get;
	}
	modify(e) {
		return this.modifyEffect((t) => Z(e(t)));
	}
	modifyEffect(e) {
		return this.withLock(z(X(Aj(this.ref), e), X(([e, t]) => PE(jj(this.ref, t), e))));
	}
}, PL = (e) => $(() => FL(e)), FL = (e) => new NL(Oj(e), AL(1).withPermits(1)), IL = /*#__PURE__*/ Symbol.for("effect/ManagedRuntime"), LL = "Fresh", RL = "FromEffect", zL = "MergeAll", BL = (e) => function() {
	if (arguments.length === 1) {
		let t = arguments[0];
		return (n, ...r) => e(t, n, ...r);
	}
	return e.apply(this, arguments);
}, VL = /*#__PURE__*/ BL((e, t, n) => {
	let r = eC(), i = [[$D, [[r, e.context]]]];
	n?.scheduler && i.push([UN, [[r, n.scheduler]]]);
	let a = sj(e.fiberRefs, {
		entries: i,
		forkAs: r
	});
	n?.updateRefs && (a = n.updateRefs(a, r));
	let o = new PI(r, a, e.runtimeFlags), s = t;
	n?.scope && (s = X(DL(n.scope, dM), (e) => DD(hO(e, QE((e) => K(e, o.id()) ? gD : AD(o, e))), uD(t, (t) => TL(e, t)))));
	let c = o.currentSupervisor;
	return c !== aI && (c.onStart(e.context, s, J(), o), o.addObserver((e) => c.onEnd(e, o))), iP.add(e.runtimeFlags, o), n?.immediate === !1 ? o.resume(s) : o.start(s), o;
}), HL = /*#__PURE__*/ BL((e, t) => {
	let n = XL(e)(t);
	if (n._tag === "Failure") throw JL(n.effect_instruction_i0);
	return n.effect_instruction_i0;
}), UL = class extends Error {
	fiber;
	_tag = "AsyncFiberException";
	constructor(e) {
		super(`Fiber #${e.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`), this.fiber = e, this.name = this._tag, this.stack = this.message;
	}
}, WL = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new UL(e);
	return Error.stackTraceLimit = t, n;
}, GL = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure"), KL = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure/Cause"), qL = class extends Error {
	[GL];
	[KL];
	constructor(e) {
		let t = gE(e)[0];
		super(t?.message || "An error has occurred"), this[GL] = GL, this[KL] = e, this.name = t ? `(FiberFailure) ${t.name}` : "FiberFailure", t?.stack && (this.stack = t.stack);
	}
	toJSON() {
		return {
			_id: "FiberFailure",
			cause: this[KL].toJSON()
		};
	}
	toString() {
		return "(FiberFailure) " + cE(this[KL], { renderErrorCause: !0 });
	}
	[Jg]() {
		return this.toString();
	}
}, JL = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new qL(e);
	return Error.stackTraceLimit = t, n;
}, YL = (e) => {
	let t = e;
	switch (t._op) {
		case "Failure":
		case "Success": return t;
		case "Left": return zO(t.left);
		case "Right": return GO(t.right);
		case "Some": return GO(t.value);
		case "None": return zO(new kO());
	}
}, XL = /*#__PURE__*/ BL((e, t) => {
	let n = YL(t);
	if (n) return n;
	let r = new HN(), i = VL(e)(t, { scheduler: r });
	return r.flush(), i.unsafePoll() || RO(HE(WL(i), uk(i)));
}), ZL = /*#__PURE__*/ BL((e, t, n) => QL(e, t, n).then((e) => {
	switch (e._tag) {
		case u_: return e.effect_instruction_i0;
		case o_: throw JL(e.effect_instruction_i0);
	}
})), QL = /*#__PURE__*/ BL((e, t, n) => new Promise((r) => {
	let i = YL(t);
	i && r(i);
	let a = VL(e)(t);
	a.addObserver((e) => {
		r(e);
	}), n?.signal !== void 0 && (n.signal.aborted ? a.unsafeInterruptAsFork(a.id()) : n.signal.addEventListener("abort", () => {
		a.unsafeInterruptAsFork(a.id());
	}, { once: !0 }));
})), $L = class {
	context;
	runtimeFlags;
	fiberRefs;
	constructor(e, t, n) {
		this.context = e, this.runtimeFlags = t, this.fiberRefs = n;
	}
	pipe() {
		return q(this, arguments);
	}
}, eR = /*#__PURE__*/ ((e) => new $L(e.context, e.runtimeFlags, e.fiberRefs))({
	context: /*#__PURE__*/ Ly(),
	runtimeFlags: /* @__PURE__ */ Kw(1, 32, 4),
	fiberRefs: /*#__PURE__*/ cj()
}), tR = /*#__PURE__*/ ZL(eR), nR = /*#__PURE__*/ QL(eR), rR = /*#__PURE__*/ HL(eR), iR = /*#__PURE__*/ R(2, (e, t) => e.modifyEffect(t)), aR = /*#__PURE__*/ Symbol.for("effect/Layer"), oR = {
	/* c8 ignore next */
	_RIn: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_ROut: (e) => e
}, sR = {
	[aR]: oR,
	pipe() {
		return q(this, arguments);
	}
}, cR = /*#__PURE__*/ Symbol.for("effect/Layer/MemoMap"), lR = /*#__PURE__*/ Ky()("effect/Layer/CurrentMemoMap", { defaultValue: () => mR() }), uR = (e) => V(e, aR), dR = (e) => e._op_layer === LL, fR = class {
	ref;
	[cR];
	constructor(e) {
		this.ref = e, this[cR] = cR;
	}
	getOrElseMemoize(e, t) {
		return z(iR(this.ref, (n) => {
			let r = n.get(e);
			if (r !== void 0) {
				let [e, i] = r;
				return Z([z(e, X(([e, t]) => z($j(e), PE(t))), uD(UO({
					onFailure: () => gD,
					onSuccess: () => gO(t, i)
				}))), n]);
			}
			return z(kj(0), X((r) => z(XO(), X((i) => z(kj(() => gD), sD((a) => {
				let o = hD((o) => z(mL(), X((s) => z(o(X(_R(e, s, !0), (e) => Yj(e(this)))), KE, X((o) => {
					switch (o._tag) {
						case o_: return z(ek(i, o.effect_instruction_i0), DD(_O(s, o)), DD(YE(o.effect_instruction_i0)));
						case u_: return z(jj(a, (e) => z(_O(s, e), vD(Mj(r, (e) => [e === 1, e - 1])), FE)), DD(Nj(r, (e) => e + 1)), DD(gO(t, (t) => z($(() => n.delete(e)), DD(Aj(a)), X((e) => e(t))))), DD(tk(i, o.effect_instruction_i0)), PE(o.effect_instruction_i0[1]));
					}
				}))))), s = [z(QO(i), uD(WO({
					onFailure: () => gD,
					onSuccess: () => Nj(r, (e) => e + 1)
				}))), (e) => z(Aj(a), X((t) => t(e)))];
				return [o, dR(e) ? n : n.set(e, s)];
			}))))));
		}), eD);
	}
}, pR = /*#__PURE__*/ Q(() => sD(PL(/* @__PURE__ */ new Map()), (e) => new fR(e))), mR = () => new fR(FL(/* @__PURE__ */ new Map())), hR = /*#__PURE__*/ R(2, (e, t) => X(pR, (n) => gR(e, n, t))), gR = /*#__PURE__*/ R(3, (e, t, n) => X(_R(e, n), (e) => tM(e(t), lR, t))), _R = (e, t, n = !1) => {
	let r = e;
	switch (r._op_layer) {
		case "Locally": return $(() => (e) => r.f(e.getOrElseMemoize(r.self, t)));
		case "ExtendScope": return $(() => (e) => iL((t) => e.getOrElseMemoize(r.layer, t)));
		case "Fold": return $(() => (e) => z(e.getOrElseMemoize(r.layer, t), nD({
			onFailure: (n) => e.getOrElseMemoize(r.failureK(n), t),
			onSuccess: (n) => e.getOrElseMemoize(r.successK(n), t)
		})));
		case "Fresh": return $(() => (e) => z(r.layer, hR(t)));
		case "FromEffect": return $(n ? () => (e) => r.effect : () => (n) => n.getOrElseMemoize(e, t));
		case "Provide": return $(() => (e) => z(e.getOrElseMemoize(r.first, t), X((n) => z(e.getOrElseMemoize(r.second, t), sk(n)))));
		case "Scoped": return $(n ? () => (e) => hL(r.effect, t) : () => (n) => n.getOrElseMemoize(e, t));
		case "Suspend": return $(() => (e) => e.getOrElseMemoize(r.evaluate(), t));
		case "ProvideMerge": return $(() => (e) => z(e.getOrElseMemoize(r.first, t), OD(e.getOrElseMemoize(r.second, t), r.zipK)));
		case "ZipWith": return xD(function* () {
			let e = yield* vO(t, fM), n = yield* vO(e, dM), i = yield* vO(e, dM);
			return (e) => z(e.getOrElseMemoize(r.first, n), cL(e.getOrElseMemoize(r.second, i), r.zipK, { concurrent: !0 }));
		});
		case "MergeAll": {
			let e = r.layers;
			return sD(vO(t, fM), (t) => (n) => {
				let r = Array(e.length);
				return sD(JI(e, SD(function* (e, i) {
					let a = yield* vO(t, dM), o = yield* n.getOrElseMemoize(e, a);
					r[i] = o;
				}), !1, !1), () => Wy(...r));
			});
		}
	}
};
function vR(e) {
	let t = Object.create(sR);
	return t._op_layer = RL, t.effect = e, t;
}
var yR = (...e) => {
	let t = Object.create(sR);
	return t._op_layer = zL, t.layers = e, t;
}, bR = /*#__PURE__*/ R(2, (e, t) => {
	let n = Iy(e);
	return vR(Z(Ry(n ? e : t, n ? t : e)));
}), xR = /*#__PURE__*/ R(2, (e, t) => aL((n) => X(hR(t, n), (t) => ck(e, t)))), SR = /*#__PURE__*/ R(2, (e, t) => {
	let n = yM(eR.fiberRefs, t.fiberRefs), r = Xw(eR.runtimeFlags, t.runtimeFlags);
	return hD((i) => ME((a) => {
		let o = a.getFiberRef($D), s = a.getFiberRefs(), c = bM(a.id(), s)(n), l = a.currentRuntimeFlags, u = Zw(r)(l), d = yM(c, s), f = Xw(u, l);
		return a.setFiberRefs(c), a.currentRuntimeFlags = u, bL(ck(i(e), Uy(o, t.context)), ME((e) => (e.setFiberRefs(bM(e.id(), e.getFiberRefs())(d)), e.currentRuntimeFlags = Zw(f)(e.currentRuntimeFlags), gD)));
	}));
}), CR = /*#__PURE__*/ R(2, (e, t) => Array.isArray(t) ? xR(e, yR(...t)) : uR(t) ? xR(e, t) : Fy(t) ? ck(e, t) : IL in t ? X(t.runtimeEffect, (t) => SR(e, t)) : SR(e, t)), wR = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return { BaseEffectError: class extends xO {
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
}(), TR = (e) => {
	let t = { BaseEffectError: class extends wR {
		_tag = e;
	} };
	return t.BaseEffectError.prototype.name = e, t.BaseEffectError;
}, ER = qE, DR = xD, OR = eM, kR = Z, AR = Q, jR = $, MR = gD, NR = BE, PR = Qj, FR = Jj, IR = aM, LR = PE, RR = BI, zR = bL, BR = oL, VR = CR, HR = fD, UR = iM, WR = rD, GR = tR, KR = nR, qR = rR, JR = class extends TR("AuthenticationFailure") {};
function YR(e) {
	return IR({
		try: e.command,
		catch: (e) => new JR({ cause: e })
	}).pipe(zR(OR(() => e.reconcile?.() ?? Promise.resolve())));
}
async function XR(e) {
	let t = await KR(e);
	if (fk(t)) return t.value;
	let n = SL(t.cause);
	throw sv(n) ? n.value.cause : CL(t.cause);
}
// src/app/services/queries/configuration.ts
function ZR(e, t, n, r) {
	let { api: a } = i();
	return D({
		queryKey: L.browse(e ?? "", t, n),
		queryFn: ({ signal: r }) => a.browsePath(e, t, n, r),
		enabled: r,
		staleTime: 2e3,
		retry: !1
	});
}
function QR(e, t, n, r) {
	let { api: a } = i();
	return D({
		queryKey: L.sshBrowse(e ?? { ssh_host: "" }, t ?? "", n),
		queryFn: ({ signal: r }) => a.browseSshPath(e, t, n, r),
		enabled: r && !!e?.ssh_host,
		staleTime: 2e3,
		retry: !1
	});
}
function $R() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: (t) => e.browseSshPath(t, null),
		onSuccess: (e, n) => {
			t.setQueryData(L.sshBrowse(n, "", !1), e);
		}
	});
}
function ez() {
	let { api: e } = i();
	return D({
		queryKey: L.sshConfigs,
		queryFn: ({ signal: t }) => e.listSshConfigs(t),
		staleTime: 3e4,
		retry: !1
	});
}
function tz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: (t) => e.createSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.sshConfigs });
		}
	});
}
function nz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ configId: t, payload: n }) => e.updateSshConfig(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.sshConfigs });
		}
	});
}
function rz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: (t) => e.deleteSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.sshConfigs });
		}
	});
}
var iz = 3e5;
function az() {
	let { api: e } = i();
	return D({
		queryKey: L.mcpLibrary,
		queryFn: ({ signal: t }) => e.getMcpLibrary(t),
		staleTime: iz,
		retry: !1
	});
}
function oz() {
	let { api: e } = i();
	return D({
		queryKey: L.mcpServers,
		queryFn: ({ signal: t }) => e.listMcpServers(t),
		staleTime: 3e4,
		retry: !1
	});
}
function sz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: (t) => e.createMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.mcpServers }), t.invalidateQueries({ queryKey: L.mcpRuntime });
		}
	});
}
function cz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ serverName: t, payload: n }) => e.updateMcpServer(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.mcpServers }), t.invalidateQueries({ queryKey: L.mcpRuntime });
		}
	});
}
function lz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: (t) => e.deleteMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.mcpServers }), t.invalidateQueries({ queryKey: L.mcpRuntime });
		}
	});
}
function uz() {
	let { api: e } = i();
	return E({ mutationFn: (t) => e.testMcpServer(t) });
}
function dz() {
	let { api: e } = i();
	return D({
		queryKey: L.mcpRuntime,
		queryFn: ({ signal: t }) => e.listMcpRuntimeStatus(t),
		staleTime: 5e3,
		retry: !1
	});
}
function fz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ serverName: t, action: n }) => n === "connect" ? e.connectMcpServer(t) : n === "disconnect" ? e.disconnectMcpServer(t) : e.reloadMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.mcpRuntime });
		}
	});
}
function pz(e = !0) {
	let { api: t } = i();
	return D({
		queryKey: L.modelConfigs,
		enabled: e,
		queryFn: ({ signal: e }) => t.listModelConfigs(e),
		staleTime: 3e4,
		retry: !1
	});
}
var mz = 0;
function hz() {
	return globalThis.crypto?.randomUUID?.() ?? `credential-${++mz}`;
}
function gz(e, t, n, r) {
	let { api: a } = i(), o = x(() => ({
		identity: hz(),
		value: t
	}), [t]);
	return D({
		queryKey: L.providerModels(e, o.identity, n ?? ""),
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
function _z(e = !0) {
	let { api: t } = i();
	return D({
		queryKey: L.modelCatalog,
		queryFn: ({ signal: e }) => t.getModelCatalog(e),
		enabled: e,
		staleTime: 6e5,
		retry: !1
	});
}
async function vz(e) {
	await Promise.all([e.resetQueries({ queryKey: L.managedProviderModelsAll }), e.invalidateQueries({ queryKey: L.modelCatalog })]);
}
async function yz(e) {
	await Promise.all([
		e.invalidateQueries({ queryKey: L.managedAuth }),
		e.invalidateQueries({ queryKey: L.managedHostStatus }),
		vz(e),
		e.invalidateQueries({ queryKey: L.resolvedModelConfigsAll }),
		e.invalidateQueries({ queryKey: L.resolvedConfigFilesAll })
	]);
}
function bz(e) {
	let { api: t } = i();
	return D({
		queryKey: L.sessionCommands(e),
		queryFn: ({ signal: n }) => t.listSessionCommands(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function xz(e) {
	let { api: t } = i();
	return D({
		queryKey: L.sessionSkills(e),
		queryFn: ({ signal: n }) => t.listSessionSkills(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function Sz(e, t) {
	let { api: n } = i(), r = t.trim();
	return D({
		queryKey: e ? L.resolvedModelConfig(e) : L.resolvedConfigFile(r),
		queryFn: ({ signal: t }) => e ? n.resolveModelConfig(e, t) : n.resolveConfigFile(r, t),
		enabled: !!(e ?? r),
		retry: !1,
		staleTime: 6e4
	});
}
function Cz() {
	let { api: e } = i(), t = O();
	return E({
		retry: !1,
		mutationFn: (t) => e.createModelConfig(t),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: L.modelConfigs }),
				t.invalidateQueries({ queryKey: L.credentials }),
				vz(t)
			]);
		}
	});
}
function wz() {
	let { api: e } = i(), t = O();
	return E({
		retry: !1,
		mutationFn: ({ configId: t, payload: n }) => e.updateModelConfig(t, n),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: L.modelConfigs }),
				t.invalidateQueries({ queryKey: L.credentials }),
				vz(t)
			]);
		}
	});
}
function Tz() {
	let { api: e } = i(), t = O();
	return E({
		retry: !1,
		mutationFn: (t) => e.deleteModelConfig(t),
		onSuccess: async () => {
			await Promise.all([
				t.invalidateQueries({ queryKey: L.modelConfigs }),
				t.invalidateQueries({ queryKey: L.credentials }),
				vz(t)
			]);
		}
	});
}
// src/app/services/queries/host.ts
function Ez() {
	let { api: e } = i();
	return D({
		queryKey: L.storeInfo,
		queryFn: ({ signal: t }) => e.getStore(t),
		staleTime: Infinity
	});
}
function Dz(e) {
	let { api: t } = i();
	return D({
		queryKey: L.sandboxAvailability,
		queryFn: ({ signal: e }) => t.getSandboxAvailability(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function Oz(e, t) {
	let { api: n } = i();
	return D({
		queryKey: [...L.sandboxActivity, t],
		queryFn: ({ signal: e }) => n.getSandboxActivity(t, e),
		enabled: e && t !== null,
		staleTime: 0,
		refetchInterval: 1e3,
		retry: !1
	});
}
function kz() {
	let { api: e } = i(), t = O();
	return E({
		retry: !1,
		mutationFn: (n) => XR(YR({
			command: () => e.managedLogout(n),
			reconcile: () => yz(t)
		}))
	});
}
// src/app/services/queries/direct.ts
function Az(e, t, n) {
	let r = e.find((e) => n(e) === n(t));
	return r && (r.generation > t.generation || r.version > t.version) ? e : r ? e.map((e) => n(e) === n(t) ? t : e) : [...e, t];
}
function jz(e, t, n) {
	return t.map((t) => {
		let r = e?.find((e) => n(e) === n(t));
		return r && (r.generation > t.generation || r.version > t.version) ? r : t;
	});
}
function Mz(e, t, n = !0) {
	let { api: r } = i();
	return D({
		queryKey: L.sessionPermissions(e),
		queryFn: ({ signal: t }) => r.getPermissions(e, t),
		enabled: t,
		refetchInterval: t && n ? 1e3 : !1,
		staleTime: 0,
		retry: !1
	});
}
function Nz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, requestId: n, reply: r }) => e.replyPermission(t, n, r),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: L.sessionPermissions(n.sessionId) })
	});
}
function Pz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, reviewId: n, parentSessionId: r }) => r ? e.authorizeChildPermissionReviewRetry(r, t, n) : e.authorizePermissionReviewRetry(t, n),
		onSuccess: (e, n) => Promise.all([t.invalidateQueries({ queryKey: L.sessionPermissions(n.sessionId) }), ...n.parentSessionId ? [t.invalidateQueries({ queryKey: L.traditionalChildren(n.parentSessionId) })] : []])
	});
}
function Fz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, mode: n }) => e.setPermissionApprovalMode(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(L.sessionPermissions(n.sessionId), (e) => e && {
				...e,
				approval_mode: n.mode,
				requests: n.mode === "auto_approve" ? [] : e.requests
			});
		}
	});
}
function Iz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, grantId: n }) => e.deletePermissionGrant(t, n),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: L.sessionPermissions(n.sessionId) })
	});
}
function Lz(e, t) {
	let { api: n } = i();
	return D({
		queryKey: L.sessionGoal(e),
		queryFn: ({ signal: t }) => n.getGoal(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function Rz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, payload: n }) => e.createGoal(t, n),
		onSuccess: (e, n) => t.setQueryData(L.sessionGoal(n.sessionId), e)
	});
}
function zz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, goalId: n, payload: r }) => e.updateGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(L.sessionGoal(n.sessionId), e)
	});
}
function Bz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, goalId: n, expectedVersion: r }) => e.clearGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(L.sessionGoal(n.sessionId), null)
	});
}
function Vz(e, t) {
	let { api: n } = i();
	return D({
		queryKey: L.traditionalChildren(e),
		queryFn: ({ signal: t }) => n.listTraditionalChildren(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => jz(e, t, (e) => e.child_session_id)
	});
}
function Hz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, payload: n }) => e.startTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(L.traditionalChildren(n.sessionId), (t = []) => Az(t, e, (e) => e.child_session_id));
		}
	});
}
function Uz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, childId: n }) => e.cancelTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(L.traditionalChildren(n.sessionId), (t = []) => Az(t, e, (e) => e.child_session_id));
		}
	});
}
function Wz(e, t) {
	let { api: n } = i(), r = ve();
	return t &&= r.orchestrationEnabled, D({
		queryKey: L.managedOrchestrators(e),
		queryFn: ({ signal: t }) => n.listManagedOrchestrators(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => jz(e, t, (e) => e.orchestrator_session_id)
	});
}
function Gz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, payload: n }) => e.startManagedOrchestrator(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(L.managedOrchestrators(n.sessionId), (t = []) => Az(t, e, (e) => e.orchestrator_session_id));
		}
	});
}
function Kz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, orchestratorId: n }) => e.cancelManagedOrchestrator(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(L.managedOrchestrators(n.sessionId), (t = []) => Az(t, e, (e) => e.orchestrator_session_id));
		}
	});
}
function qz(e, t) {
	let { api: n } = i();
	return D({
		queryKey: L.sessionInbox(e),
		queryFn: ({ signal: t }) => n.listInbox(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function Jz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, delivery: n, prompt: r }) => e.createInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(L.sessionInbox(n), (t = []) => [...t.filter((t) => t.id !== e.id), e]);
		}
	});
}
function Yz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r, delivery: i }) => e.updateInboxItem(t, n, r, i),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(L.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
function Xz() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r }) => e.cancelInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(L.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
// src/app/features/direct-session/commandWorkflow.ts
var Zz = class extends TR("CommandFailure") {};
function Qz(e) {
	return DR(function* () {
		yield* jR(e.optimistic);
		let t = yield* IR({
			try: e.admit,
			catch: (e) => new Zz({
				operation: "submit",
				cause: e
			})
		}).pipe(UR(() => jR(e.rejected)));
		return t.kind === "accepted" ? (yield* jR(() => e.reconcile(!1)), t.value) : (yield* jR(() => {
			t.kind === "uncertain" ? e.reconcile(!0) : e.rejected();
		}), yield* ER(new Zz({
			operation: "submit",
			cause: t.error
		})));
	});
}
function $z(e) {
	return DR(function* () {
		yield* jR(e.optimistic), yield* IR({
			try: e.cancel,
			catch: (e) => new Zz({
				operation: "stop",
				cause: e
			})
		}).pipe(UR(() => jR(e.rollback))), yield* jR(e.settled);
	});
}
function eB(e) {
	return IR({
		try: e.create,
		catch: (e) => new Zz({
			operation: "create",
			cause: e
		})
	}).pipe(HR((t) => jR(() => e.accept(t))));
}
function tB(e) {
	if (e.mode === "direct-running" || e.delivery) {
		let t = e.delivery ?? "steer";
		return IR({
			try: () => e.inbox(t),
			catch: (e) => new Zz({
				operation: t,
				cause: e
			})
		}).pipe(LR(t === "queue" ? "queued" : "steered"));
	}
	let t = e.mode === "classic-running";
	return IR({
		try: t ? e.steer : e.submit,
		catch: (e) => new Zz({
			operation: t ? "steer" : "submit",
			cause: e
		})
	}).pipe(LR(t ? "steered" : "submitted"));
}
async function nB(e) {
	let t = await KR(e);
	if (fk(t)) return t.value;
	let n = SL(t.cause);
	throw sv(n) ? n.value.cause : CL(t.cause);
}
// src/app/features/direct-session/commandAdapters.ts
function rB(e, t) {
	let { api: n, stores: { runtimeStore: { captureRuntimeActivation: r, finishRunCancel: i, requestRunCancel: o, restoreRunCancel: s, runtimeStore: c } } } = a(e), l = r(t), u = L.sessionSnapshot(t), d, f, p, m = [];
	return {
		optimistic: () => {
			l() && (d = o()), f = e.getQueryData(u), p = f?.active_run ? {
				...f,
				active_run: void 0
			} : f, p &&= e.setQueryData(u, p);
			for (let n of [!1, !0]) {
				let r = e.getQueryData(L.sessions(n))?.find((e) => e.summary.session_id === t), i = e.setQueryData(L.sessions(n), (e) => e?.map((e) => e.summary.session_id !== t || !e.active && e.active_run === void 0 ? e : {
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
			for (let { stats: t, before: n, optimistic: r } of m) e.setQueryData(L.sessions(t), (e) => e?.map((e) => e === r ? n : e));
			e.invalidateQueries({
				queryKey: u,
				exact: !0
			});
		},
		settled: () => {
			l() && c.getState().cancelArmed && i(), e.invalidateQueries({
				queryKey: u,
				exact: !0
			}), e.invalidateQueries({ queryKey: L.sessionsAll });
		}
	};
}
// src/app/lib/messageWindow.ts
function iB(e, t, n) {
	return Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && Number.isSafeInteger(e.total) && e.start >= 0 && e.start <= e.end && e.end <= e.total && e.end - e.start === t && n === t;
}
function aB(e, t, n) {
	let r = /* @__PURE__ */ new Set();
	return (e ?? []).every(({ message_index: e }) => !Number.isSafeInteger(e) || r.has(e) || t[e - n]?.role !== "user" ? !1 : (r.add(e), !0));
}
function oB(e, t, n) {
	return (e ?? []).filter(({ message_index: e }) => e >= t && e < n);
}
function sB(e) {
	return iB(e.page, e.messages.length, e.created_at.length) && aB(e.terminal_selection_attributions, e.messages, e.page.start);
}
function cB(e) {
	let t = e.message_page, n = e.message_created_at ?? [];
	return !!(t && iB(t, e.messages.length, n.length) && aB(e.terminal_selection_attributions, e.messages, t.start));
}
function lB(e) {
	return e.message_page ?? {
		start: 0,
		end: e.messages.length,
		total: e.messages.length,
		has_older: !1
	};
}
function uB(e) {
	let t = e.message_created_at ?? [];
	return t.length === e.messages.length ? t : Array.from({ length: e.messages.length }, () => null);
}
function dB(e, t) {
	if (!sB(t)) return { kind: "snapshot-required" };
	let n = lB(e), r = uB(e);
	if (!iB(n, e.messages.length, r.length) || t.page.end !== t.page.total || t.page.total < n.total || t.page.start > n.end) return { kind: "snapshot-required" };
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
			terminal_selection_attributions: [...oB(e.terminal_selection_attributions, n.start, t.page.start), ...t.terminal_selection_attributions ?? []],
			message_page: {
				...t.page,
				start: n.start,
				has_older: n.start > 0
			}
		}
	};
}
function fB(e, t, n) {
	if (!sB(t)) return null;
	let r = lB(e), i = uB(e);
	return r.start !== n || t.page.end !== n || t.page.total !== r.total || !iB(r, e.messages.length, i.length) ? null : {
		...e,
		messages: [...t.messages, ...e.messages],
		message_created_at: [...t.created_at, ...i],
		terminal_selection_attributions: [...t.terminal_selection_attributions ?? [], ...oB(e.terminal_selection_attributions, r.start, r.end)],
		message_page: {
			start: t.page.start,
			end: r.end,
			total: r.total,
			has_older: t.page.start > 0
		}
	};
}
function pB(e, t, n) {
	if (n || !e || !t.message_page) return t;
	if (!cB(t)) return e;
	let r = t.message_created_at ?? [], i = dB(e, {
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
function mB(e, t, n) {
	let r = e.filter((e) => e !== t), i = Math.max(0, Math.min(n, r.length));
	return [
		...r.slice(0, i),
		t,
		...r.slice(i)
	];
}
function hB(e, n) {
	return (e.sort_order ?? 0) - (n.sort_order ?? 0) || t(n.created_at) - t(e.created_at);
}
function gB(e, t) {
	return e.filter((e) => !!e.summary.pinned === t).sort((e, t) => hB(e.summary, t.summary));
}
function _B(e, t, n) {
	let r = new Map(n.map((e) => [e.summary.session_id, e])), i = {};
	for (let e of t) i[e] = r.get(e)?.summary.presentation_version ?? 0;
	return {
		pinned: e,
		session_ids: t,
		expected_versions: i
	};
}
function vB(e, t) {
	return e.map((e) => e.summary.session_id === t.session_id ? {
		...e,
		summary: t
	} : e);
}
function yB(e, t, n, r) {
	if (t === r) {
		let t = e.findIndex((e) => e.summary.session_id === r);
		return t < 0 ? e.length : t;
	}
	let i = e.filter((e) => e.summary.session_id !== r), a = i.findIndex((e) => e.summary.session_id === t);
	return a < 0 ? i.length : n === "before" ? a : a + 1;
}
function bB(e, t) {
	return e.length === t.length && e.every((e, n) => e === t[n]);
}
// src/app/services/queries/invalidation.ts
function xB() {
	let e = O();
	return {
		sessions: () => e.invalidateQueries({ queryKey: L.sessionsAll }),
		projects: () => e.invalidateQueries({ queryKey: L.projects }),
		session: (t) => e.invalidateQueries({
			queryKey: L.sessionSnapshot(t),
			exact: !0
		}),
		sessionRoot: (t) => e.invalidateQueries({ queryKey: L.sessionRoot(t) })
	};
}
// src/app/services/sessionRefresh.ts
var SB = /* @__PURE__ */ new Map(), CB = 0, wB = /* @__PURE__ */ new WeakMap(), TB = 0;
function EB(e, t) {
	let n = wB.get(e);
	return n === void 0 && (n = ++TB, wB.set(e, n)), `${n}:${t}`;
}
function DB(e) {
	let t = SB.get(e);
	if (t) return t;
	let n = {
		generation: ++CB,
		replaceNextSnapshot: !1,
		tailController: null,
		historyControllers: /* @__PURE__ */ new Set()
	};
	return SB.set(e, n), n;
}
function OB(e, t = !1) {
	let n = DB(e);
	n.generation = ++CB, n.replaceNextSnapshot ||= t, n.tailController?.abort(), n.tailController = null;
	for (let e of n.historyControllers) e.abort();
	return n.historyControllers.clear(), n.generation;
}
function kB(e) {
	let t = DB(e);
	return {
		generation: OB(e),
		replace: t.replaceNextSnapshot
	};
}
function AB(e, t) {
	let n = SB.get(e);
	n?.generation === t.generation && t.replace && (n.replaceNextSnapshot = !1);
}
function jB(e) {
	let t = DB(e);
	t.tailController?.abort();
	let n = new AbortController();
	return t.tailController = n, {
		generation: t.generation,
		controller: n
	};
}
function MB(e, t) {
	let n = SB.get(e);
	n?.tailController === t.controller && (n.tailController = null);
}
function NB(e, t) {
	return SB.get(e)?.generation === t;
}
function PB(e) {
	let t = DB(e), n = new AbortController();
	return t.historyControllers.add(n), {
		generation: t.generation,
		controller: n
	};
}
function FB(e, t) {
	SB.get(e)?.historyControllers.delete(t.controller);
}
function IB(e) {
	let t = SB.get(e);
	t?.tailController?.abort();
	for (let e of t?.historyControllers ?? []) e.abort();
	SB.delete(e);
}
// src/app/services/queries/session.ts
function LB(e = Jh) {
	let { api: t } = i();
	return D({
		queryKey: L.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: e,
		staleTime: 0,
		placeholderData: T
	});
}
function RB(e, t) {
	let n = new Map(t.filter((e) => e.workspace_diff !== void 0).map((e) => [e.summary.session_id, e.workspace_diff]));
	return e.map((e) => {
		let t = n.get(e.summary.session_id);
		return t === void 0 ? e : {
			...e,
			workspace_diff: t
		};
	});
}
function zB(e = {
	baseMs: Jh,
	statsMs: Yh
}) {
	let { api: t } = i(), n = LB(e.baseMs), r = D({
		queryKey: L.sessions(!0),
		queryFn: ({ signal: e }) => t.listSessions({ workspaceStats: !0 }, e),
		refetchInterval: e.statsMs,
		staleTime: e.statsMs
	}), a = x(() => n.data ? RB(n.data, r.data ?? []) : n.data, [n.data, r.data]);
	return {
		...n,
		data: a
	};
}
function BB(e) {
	let { api: t } = i(), n = g((t) => t.find((t) => t.summary.session_id === e) ?? null, [e]);
	return D({
		queryKey: L.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: Jh,
		staleTime: 0,
		placeholderData: T,
		select: n
	});
}
function VB(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function HB(e, t) {
	let { api: n } = i(), r = O();
	return D({
		queryKey: L.sessionSnapshot(e ?? ""),
		queryFn: async ({ signal: t }) => {
			let i = kB(EB(r, e)), a = await n.getSession(e, {
				messageLimit: 24,
				threadEventLimit: 50,
				includeSessions: !1,
				includeSystem: !0,
				signal: t
			});
			if (!cB(a)) throw Error("The server returned an invalid snapshot message page.");
			if (t.aborted || !NB(EB(r, e), i.generation)) throw new DOMException("Snapshot superseded", "AbortError");
			return AB(EB(r, e), i), pB(r.getQueryData(L.sessionSnapshot(e)), a, i.replace);
		},
		enabled: !!e,
		staleTime: 1e3,
		placeholderData: VB(e ?? ""),
		...t
	});
}
function UB(e) {
	let { api: t } = i(), n = O();
	return E({ mutationFn: async () => {
		let r = n.getQueryData(L.sessionSnapshot(e))?.message_page?.start;
		if (r === void 0 || r <= 0) throw Error("No older messages are available.");
		let i = EB(n, e), a = PB(i);
		try {
			let o = await t.getMessages(e, {
				before: r,
				limit: 24,
				includeSystem: !0,
				signal: a.controller.signal
			});
			if (!sB(o)) throw Error("The server returned an invalid message page.");
			if (!NB(i, a.generation)) return !1;
			let s = !1;
			return n.setQueryData(L.sessionSnapshot(e), (e) => {
				if (!e) return e;
				let t = fB(e, o, r);
				return t ? (s = !0, t) : e;
			}), s;
		} catch (e) {
			if (a.controller.signal.aborted) return !1;
			throw e;
		} finally {
			FB(i, a);
		}
	} });
}
function WB(e, t) {
	let { api: n } = i();
	return ee({
		queryKey: L.threadEvents(e ?? "", t ?? ""),
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
function GB(e) {
	let { api: t } = i();
	return D({
		queryKey: L.sessionConfig(e ?? ""),
		queryFn: ({ signal: n }) => t.getConfig(e, n),
		enabled: !!e
	});
}
function KB() {
	let { api: e } = i(), t = xB(), n = O();
	return E({
		retry: !1,
		mutationFn: (r) => nB(eB({
			create: () => e.createSession(r),
			accept: (e) => {
				let r = e.metadata.session_id;
				if (!r) throw Error("The server returned a chat without an identity.");
				OB(EB(n, r), !0), n.setQueryData(L.sessionSnapshot(r), e), t.sessions();
			}
		}))
	});
}
function qB(e, t) {
	let n = [];
	for (let r of e.getQueryCache().findAll({ queryKey: ["session"] })) {
		let e = r.queryKey;
		if (e[0] !== "session" || e[2] !== "snapshot" || typeof e[1] != "string") continue;
		let i = e[1];
		i !== t && r.state.data?.forks?.some((e) => e.session_id === t) && n.push(i);
	}
	return n;
}
function JB() {
	let { api: e, stores: { promptDraftStore: t } } = i(), n = xB(), r = O();
	return E({
		mutationFn: (t) => e.deleteSession(t),
		onSuccess: (e, i) => {
			t.purgeSessions([i]), n.sessions(), r.removeQueries({ queryKey: L.sessionRoot(i) });
			for (let e of qB(r, i)) n.sessionRoot(e);
		}
	});
}
function YB() {
	let { api: e } = i(), t = xB();
	return E({
		retry: !1,
		mutationFn: ({ id: t, title: n, pinned: r, expectedVersion: i }) => e.updatePresentation(t, {
			title: n,
			pinned: r,
			expected_version: i
		}),
		onSuccess: () => t.sessions()
	});
}
function XB() {
	let e = YB();
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
function ZB() {
	let { api: e } = i(), t = xB();
	return E({
		mutationFn: async ({ sessions: t, sessionId: n, targetPinned: r, targetIndex: i }) => {
			let a = t, o = a.find((e) => e.summary.session_id === n);
			if (!o) throw Error(`Session '${n}' was not found`);
			if (!!o.summary.pinned !== r) {
				let t = await e.updatePresentation(n, {
					title: o.summary.title ?? "",
					pinned: r,
					expected_version: o.summary.presentation_version ?? 0
				});
				a = vB(a, t);
			}
			let s = gB(a, r), c = s.map((e) => e.summary.session_id), l = mB(c, n, i);
			return bB(c, l) ? null : e.reorderSessions(_B(r, l, s));
		},
		onSuccess: () => t.sessions()
	});
}
function QB() {
	let { api: e } = i(), t = xB(), n = O();
	return E({
		retry: !1,
		mutationFn: ({ id: t, patch: n }) => e.updateConfig(t, n),
		onSuccess: (e, { id: r }) => {
			n.invalidateQueries({ queryKey: L.sessionConfig(r) }), t.session(r), t.sessions();
		}
	});
}
function $B() {
	let { api: e } = i(), { captureRuntimeActivation: t, setOptimisticUserPrompt: n } = i().stores.runtimeStore, a = xB(), o = O();
	return E({
		retry: !1,
		mutationFn: ({ id: i, prompt: s, signal: c }) => {
			let l = t(i);
			return nB(Qz({
				optimistic: () => {
					l() && n(s);
				},
				admit: async () => {
					let t = await (c ? e.submitRun(i, s, c) : e.submitRun(i, s));
					return t.status === "accepted" ? {
						kind: "accepted",
						value: t.response
					} : t.status === "not-sent" ? {
						kind: "not-sent",
						error: new DOMException("Prompt submission was cancelled before it was sent.", "AbortError")
					} : {
						kind: "uncertain",
						error: new r(t.requestId, t.error)
					};
				},
				rejected: () => {
					l() && n(null);
				},
				reconcile: (e) => {
					e ? (OB(EB(o, i), !0), a.sessionRoot(i)) : a.session(i);
				}
			}));
		}
	});
}
function eV() {
	let { api: e } = i();
	return E({ mutationFn: ({ id: t, instruction: n }) => e.steerOrchestrator(t, n) });
}
function tV() {
	let { api: e } = i();
	return E({ mutationFn: ({ id: t, threadName: n, instruction: r }) => e.steerThread(t, n, r) });
}
function nV() {
	let e = O();
	return E({
		retry: !1,
		mutationFn: (t) => nB($z(rB(e, t)))
	});
}
function rV() {
	let { api: e } = i(), t = xB(), n = O();
	return E({
		mutationFn: (t) => e.compactSession(t),
		onSuccess: (e, r) => (OB(EB(n, r), !0), t.sessionRoot(r))
	});
}
function iV() {
	let { api: e } = i(), t = xB(), n = O();
	return E({
		mutationFn: ({ id: t, messageIdx: n }) => e.revertSession(t, n),
		onSuccess: (e, { id: r }) => {
			OB(EB(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function aV() {
	let { api: e } = i(), t = xB(), n = O();
	return E({
		mutationFn: ({ id: t, messageIdx: n }) => e.regenerateRun(t, n),
		onSuccess: (e, { id: r }) => {
			OB(EB(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function oV() {
	let { api: e } = i(), t = xB();
	return E({
		mutationFn: ({ id: t, messageIdx: n }) => e.forkSession(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n), t.sessions();
		}
	});
}
function sV() {
	let { api: e } = i(), t = xB();
	return E({
		mutationFn: ({ id: t, forkId: n }) => e.dismissSessionFork(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n);
		}
	});
}
function cV() {
	let e = LB(), t = ve(), n = x(() => e.data ? he(t, e.data) : void 0, [e.data, t]);
	return {
		...e,
		data: n
	};
}
// src/app/services/queries/workspace.ts
function lV(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function uV(e, t, n = "all", r = 3, a = null) {
	let { api: o } = i();
	return D({
		queryKey: L.workspaceDiff(e ?? "", t ?? "", n, r, a),
		queryFn: ({ signal: i }) => o.getWorkspaceDiff(e, t, {
			stage: n,
			context: r,
			revision: a,
			signal: i
		}),
		enabled: !!(e && t),
		placeholderData: lV(e ?? "")
	});
}
function dV(e, t = null) {
	let { api: n } = i();
	return D({
		queryKey: L.workspaceFiles(e ?? "", t),
		queryFn: ({ signal: r }) => n.getWorkspaceFiles(e, t, r),
		enabled: !!e,
		staleTime: t == null ? 1e4 : Infinity,
		placeholderData: lV(e ?? "")
	});
}
function fV(e, t, n = null) {
	let { api: r } = i();
	return D({
		queryKey: L.workspaceFile(e ?? "", t ?? "", n),
		queryFn: ({ signal: i }) => r.getWorkspaceFile(e, t, n, i),
		enabled: !!(e && t),
		staleTime: n == null ? 1e4 : Infinity,
		placeholderData: lV(e ?? "")
	});
}
function pV(e) {
	let { api: t } = i();
	return D({
		queryKey: L.workspaceRevisions(e ?? ""),
		queryFn: ({ signal: n }) => t.getWorkspaceRevisions(e, n),
		enabled: !!e,
		staleTime: 5e3,
		retry: !1
	});
}
function mV(e, t) {
	let { api: n } = i();
	return D({
		queryKey: L.workspaceRevisionChanges(e ?? "", t ?? 0),
		queryFn: ({ signal: r }) => n.getWorkspaceRevisionChanges(e, t, r),
		enabled: !!(e && t != null),
		staleTime: Infinity,
		placeholderData: lV(e ?? "")
	});
}
function hV(e, t) {
	let { api: n } = i();
	return D({
		queryKey: L.branches(e ?? ""),
		queryFn: ({ signal: t }) => n.getBranches(e, t),
		enabled: !!e && t,
		staleTime: 5e3,
		retry: !1
	});
}
function gV(e) {
	let { api: t } = i(), n = O();
	return E({
		mutationFn: (n) => t.switchBranch(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: L.branches(e) }), n.invalidateQueries({ queryKey: L.sessionRoot(e) }), n.invalidateQueries({ queryKey: L.sessionsAll });
		}
	});
}
function _V(e) {
	let { api: t } = i(), n = O();
	return E({
		mutationFn: (n) => t.commitWorkspace(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: L.sessionRoot(e) }), n.invalidateQueries({ queryKey: L.sessionsAll });
		}
	});
}
// src/app/services/queries/projects.ts
function vV() {
	let { api: e } = i();
	return D({
		queryKey: L.projects,
		queryFn: ({ signal: t }) => e.listProjects(t),
		staleTime: 3e4,
		retry: !1
	});
}
function yV() {
	let { api: e } = i(), t = xB();
	return E({
		retry: !1,
		mutationFn: (t) => e.createProject(t),
		onSuccess: () => t.projects()
	});
}
function bV() {
	let { api: e } = i(), t = xB();
	return E({
		retry: !1,
		mutationFn: ({ projectId: t, payload: n }) => e.updateProject(t, n),
		onSuccess: () => t.projects()
	});
}
function xV() {
	let e = bV();
	return {
		...e,
		toggle: (t) => e.mutateAsync({
			projectId: t.project_id,
			payload: { pinned: !t.pinned }
		})
	};
}
function SV() {
	let { api: e, stores: { promptDraftStore: t } } = i(), n = xB();
	return E({
		mutationFn: ({ projectId: t, sessions: n }) => e.deleteProject(t, n),
		onSuccess: (e) => (t.purgeSessions(e.deleted_session_ids), Promise.all([n.projects(), n.sessions()]))
	});
}
function CV() {
	let { api: e } = i(), t = xB();
	return E({
		mutationFn: ({ projectId: t, sessionId: n }) => e.assignSessionToProject(t, { session_id: n }),
		onSuccess: () => Promise.all([t.projects(), t.sessions()])
	});
}
function wV() {
	let { api: e } = i(), t = xB();
	return E({
		mutationFn: async ({ projects: t, projectId: n, targetPinned: r, targetIndex: i }) => {
			let a = t.find((e) => e.project_id === n);
			if (!a) return;
			let o = t;
			a.pinned !== r && (await e.updateProject(n, { pinned: r }), o = (await e.listProjects()).projects);
			let s = o.filter((e) => e.pinned === r).sort((e, t) => e.sort_order - t.sort_order), c = mB(s.map((e) => e.project_id), n, i);
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
var TV = [
	"status",
	"github",
	"secrets"
], EV = /* @__PURE__ */ new Set([
	"PATH",
	"HOME",
	"NAC_HOME",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"EXA_API_KEY"
]);
function DV(e) {
	return e ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(e) ? EV.has(e) ? `${e} is managed by NAC and cannot be replaced here.` : "" : "Use letters, digits, and underscores; the first character cannot be a digit." : "Enter a variable name.";
}
function OV(e) {
	let t = e?.split("/") ?? [];
	return t.length === 2 && t[0] && t[1] ? [t[0], t[1]] : null;
}
function kV(e) {
	return e?.status === "running";
}
function AV(e) {
	return e ? {
		backend: e.model.backend,
		model: e.model.id,
		baseUrl: e.model.endpoint
	} : null;
}
function jV(e, t) {
	return !!(t && e && t.backend === e.model.backend && t.baseUrl === e.model.endpoint);
}
function MV(e, t) {
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
function NV(e) {
	return typeof e == "object" && e && "status" in e ? e.status : null;
}
function PV(e) {
	return FV(e) || e instanceof Error && e.name === "ManagedUpgradeContractError";
}
function FV(e) {
	let t = NV(e);
	return t === 401 || t === 403 || t === 409;
}
function IV(e) {
	let t = NV(e);
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
var LV = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying"
]);
function RV(e) {
	return LV.has(e);
}
function zV(e) {
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
function BV(e) {
	switch (e) {
		case "cancel_active_run": return "Stop run";
		case "cancel_traditional_child": return "Cancel coding agent";
		case "cancel_managed_orchestrator": return "Cancel NAC orchestrator";
		case "terminate_terminal": return "Stop terminal";
		case "cancel_clone_operation": return "Cancel clone";
		case "wait": return "Wait";
	}
}
function VV(e) {
	return e === null ? "Accepted-release distance unavailable" : e === 0 ? "Current accepted release" : `${e} accepted ${e === 1 ? "release" : "releases"} ahead`;
}
function HV(e, t) {
	return e.release_id === t.release_id && e.source_revision === t.source_revision && e.build_id === t.build_id && e.product_version === t.product_version && e.schema_version === t.schema_version;
}
// src/app/features/managed/upgradeContract.ts
var UV = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying",
	"succeeded",
	"failed"
]), WV = /* @__PURE__ */ new Set([
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
]), GV = /* @__PURE__ */ new Set([
	"wait",
	"cancel_active_run",
	"cancel_traditional_child",
	"cancel_managed_orchestrator",
	"terminate_terminal",
	"cancel_clone_operation"
]), KV = {
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
}, qV = class extends Error {
	constructor() {
		super("Managed upgrade status did not match the browser contract."), this.name = "ManagedUpgradeContractError";
	}
};
function JV() {
	throw new qV();
}
function YV(e, t, n) {
	(typeof e != "object" || !e || Array.isArray(e)) && JV();
	let r = e;
	return Object.keys(r).some((e) => !t.includes(e)) && JV(), n.some((e) => !Object.hasOwn(r, e)) && JV(), r;
}
function XV(e, t, n = !0) {
	return (typeof e != "string" || e.length > t || !n && e.length === 0 || /\p{Cc}/u.test(e)) && JV(), e;
}
function ZV(e) {
	return (typeof e != "number" || !Number.isSafeInteger(e) || e < 0) && JV(), e;
}
function QV(e, t) {
	return typeof e == "string" && t.has(e) || JV(), e;
}
function $V(e, t, n) {
	return Object.hasOwn(e, t) ? XV(e[t], n) : void 0;
}
function eH(e) {
	let t = YV(e, [
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
	]), n = XV(t.source_revision, 40, !1);
	return /^[a-f0-9]{40}$/.test(n) || JV(), {
		release_id: XV(t.release_id, 63, !1),
		source_revision: n,
		build_id: XV(t.build_id, 128, !1),
		product_version: XV(t.product_version, 128, !1),
		schema_version: ZV(t.schema_version)
	};
}
function tH(e, t) {
	return Object.hasOwn(e, t) ? eH(e[t]) : void 0;
}
function nH(e) {
	let t = XV(e, 128, !1);
	return /^[A-Za-z0-9_.:@-]+$/.test(t) || JV(), t;
}
function rH(e) {
	let t = [
		"session_id",
		"run_id",
		"child_session_id",
		"orchestrator_session_id",
		"terminal_id",
		"clone_operation_id"
	], n = YV(e, t, []);
	return Object.fromEntries(t.filter((e) => Object.hasOwn(n, e)).map((e) => [e, nH(n[e])]));
}
function iH(e, t) {
	let n = Object.keys(e).sort();
	return n.length === t.length && t.every((t) => n.includes(t) && !!e[t]);
}
function aH(e, t, n) {
	switch (t) {
		case "cancel_active_run": return e === "active_run" && iH(n, ["session_id", "run_id"]);
		case "cancel_traditional_child": return e === "traditional_child" && iH(n, ["session_id", "child_session_id"]);
		case "cancel_managed_orchestrator": return e === "managed_orchestrator" && iH(n, ["session_id", "orchestrator_session_id"]);
		case "terminate_terminal": return e === "terminal_process" && iH(n, ["session_id", "terminal_id"]);
		case "cancel_clone_operation": return e === "clone_operation" && iH(n, ["clone_operation_id"]);
		case "wait": return !1;
	}
}
function oH(e) {
	let t = YV(e, [
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
	]), n = XV(t.selection_key, 71, !1);
	/^sha256:[a-f0-9]{64}$/.test(n) || JV();
	let r = QV(t.kind, WV), i = XV(t.message, 512, !1);
	KV[r].includes(i) || JV(), typeof t.actionable != "boolean" && JV();
	let a = QV(t.action, GV);
	if (!t.actionable) return (a !== "wait" || t.target !== null) && JV(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !1,
		action: a,
		target: null
	};
	let o = rH(t.target);
	return aH(r, a, o) || JV(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !0,
		action: a,
		target: o
	};
}
function sH(e) {
	let t = YV(e, [
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
	t.kind !== "upgrade" && JV();
	let n;
	return Object.hasOwn(t, "blockers") && ((!Array.isArray(t.blockers) || t.blockers.length > 100) && JV(), n = t.blockers.map(oH)), {
		operation_id: XV(t.operation_id, 128, !1),
		managed_host_id: XV(t.managed_host_id, 128, !1),
		kind: "upgrade",
		state: QV(t.state, UV),
		reason: $V(t, "reason", 128),
		message: $V(t, "message", 512),
		target_release: tH(t, "target_release"),
		desired_release: tH(t, "desired_release"),
		observed_release: tH(t, "observed_release"),
		blockers: n,
		created_at: $V(t, "created_at", 64),
		updated_at: $V(t, "updated_at", 64)
	};
}
function cH(e) {
	let t = YV(e, ["preview", "operation"], ["preview", "operation"]), n = YV(t.preview, [
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
	typeof n.upgrade_available != "boolean" && JV();
	let r = null;
	return n.distance !== null && (r = { accepted_releases: ZV(YV(n.distance, ["accepted_releases"], ["accepted_releases"]).accepted_releases) }), {
		preview: {
			current: eH(n.current),
			latest_beta: eH(n.latest_beta),
			upgrade_available: n.upgrade_available,
			distance: r
		},
		operation: t.operation === null ? null : sH(t.operation)
	};
}
// src/app/features/managed/queries.ts
var lH = {
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
function uH() {
	let { api: e } = i();
	return D({
		queryKey: lH.hostStatus,
		queryFn: ({ signal: t }) => e.getManagedStatus(t),
		staleTime: 5e3,
		refetchInterval: 15e3,
		retry: !1
	});
}
function dH(e = !0) {
	let { api: t } = i();
	return D({
		queryKey: lH.upgrade,
		queryFn: async ({ signal: e }) => cH(await t.getManagedUpgrade(e)),
		enabled: e,
		staleTime: 0,
		refetchInterval: (e) => e.state.data?.operation && RV(e.state.data.operation.state) ? 1e3 : 15e3,
		refetchIntervalInBackground: !0,
		retry: !1
	});
}
function fH() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: async (t) => sH(await e.startManagedUpgrade(t)),
		onSuccess: (e) => (t.setQueryData(lH.upgrade, (t) => t && {
			...t,
			operation: e
		}), t.invalidateQueries({ queryKey: lH.upgrade }))
	});
}
function pH(e = !0) {
	let { api: t } = i();
	return D({
		queryKey: lH.github,
		queryFn: ({ signal: e }) => t.getManagedGitHub(e),
		enabled: e,
		retry: !1
	});
}
function mH(e = !0) {
	let { api: t } = i();
	return D({
		queryKey: lH.secrets,
		queryFn: ({ signal: e }) => t.listManagedSecrets(e),
		enabled: e,
		retry: !1
	});
}
function hH() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: ({ name: t, value: n }) => e.putManagedSecret(t, n),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: lH.secrets }), t.invalidateQueries({ queryKey: lH.hostStatus })])
	});
}
function gH() {
	let { api: e } = i(), t = O();
	return E({
		mutationFn: (t) => e.deleteManagedSecret(t),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: lH.secrets }), t.invalidateQueries({ queryKey: lH.hostStatus })])
	});
}
function _H(e = !0, t = !1) {
	let { api: n } = i();
	return D({
		queryKey: lH.auth,
		queryFn: ({ signal: e }) => n.listManagedAuth(e),
		enabled: e,
		staleTime: 3e4,
		refetchInterval: t,
		retry: !1
	});
}
function vH(e, t, n) {
	let { api: r } = i();
	return D({
		queryKey: [
			...lH.providerModels(e ?? ""),
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
function yH(e, t, n = null) {
	let { api: r } = i();
	return D({
		queryKey: lH.providerModels(e ?? "", n),
		queryFn: ({ signal: t }) => r.listProviderModels(n ? {
			backend: e,
			base_url: n
		} : { backend: e }, t),
		enabled: t && e !== null,
		retry: !1,
		staleTime: 3e5
	});
}
function bH(e) {
	let { api: t } = i(), n = uH().data ?? null, r = x(() => MV(e, n), [e, n]), a = te({ queries: r.map((e) => ({
		queryKey: lH.providerModels(e.backend, e.base_url),
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
var xH = p(null), SH = 150, CH = 3, wH = 0, TH = () => `toast-${Date.now()}-${wH++}`;
function EH({ toasts: e, removeToast: t }) {
	let r = n(), i = S(/* @__PURE__ */ new Map());
	return v(() => {
		let n = i.current;
		for (let r of e) r.keep || r.dismissing || n.has(r.id) || n.set(r.id, setTimeout(() => t(r.id), r.life * 1e3));
		let r = new Set(e.map((e) => e.id));
		for (let [e, t] of n) r.has(e) || (clearTimeout(t), n.delete(e));
	}, [e, t]), v(() => {
		let e = i.current;
		return () => e.forEach((e) => clearTimeout(e));
	}, []), j(/* @__PURE__ */ k("div", {
		role: "region",
		"aria-label": "Notifications",
		"aria-live": "polite",
		"aria-relevant": "additions",
		className: "fixed top-4 right-4 z-[1100] flex w-[360px] max-w-[calc(100%-2rem)] flex-col gap-2 pointer-events-none",
		children: e.map((e) => /* @__PURE__ */ k("div", {
			className: "pointer-events-auto",
			children: /* @__PURE__ */ k(qh, {
				content: e.content,
				variant: e.variant,
				dismissing: e.dismissing,
				onClose: () => t(e.id)
			})
		}, e.id))
	}), r);
}
function DH({ children: e }) {
	let [t, n] = C([]), r = g((e) => {
		let t = TH();
		return n((n) => [...n, {
			id: t,
			content: e.content,
			variant: e.variant ?? Wh.Info,
			life: e.life ?? CH,
			keep: e.keep ?? !1,
			dismissing: !1
		}]), t;
	}, []), i = g((e) => {
		n((t) => {
			let r = t.find((t) => t.id === e);
			return !r || r.dismissing ? t : (setTimeout(() => n((t) => t.filter((t) => t.id !== e)), SH), t.map((t) => t.id === e ? {
				...t,
				dismissing: !0
			} : t));
		});
	}, []), a = g(() => {
		n((e) => e.length === 0 ? e : (setTimeout(() => n((e) => e.filter((e) => !e.dismissing)), SH), e.map((e) => ({
			...e,
			dismissing: !0
		}))));
	}, []), o = x(() => ({
		addToast: r,
		removeToast: i,
		clearToasts: a,
		info: (e, t) => r({
			content: e,
			variant: Wh.Info,
			...t
		}),
		success: (e, t) => r({
			content: e,
			variant: Wh.Success,
			...t
		}),
		error: (e, t) => r({
			content: e,
			variant: Wh.Error,
			...t
		}),
		danger: (e, t) => r({
			content: e,
			variant: Wh.Danger,
			...t
		})
	}), [
		r,
		i,
		a
	]);
	return /* @__PURE__ */ A(xH.Provider, {
		value: o,
		children: [e, /* @__PURE__ */ k(EH, {
			toasts: t,
			removeToast: i
		})]
	});
}
function OH() {
	let e = _(xH);
	if (!e) throw Error("useToast must be used within a ToastProvider");
	return e;
}
function kH(e) {
	return e instanceof Error ? e.message : String(e);
}
// src/app/lib/workspaceLink.ts
var AH = /^(https?|ircs?|mailto|xmpp|file)$/i, jH = /^[a-zA-Z]:[\\/]/, MH = /^(https?|mailto|ircs?|xmpp):/i;
function NH(e) {
	let t = String(e ?? "").trim();
	if (!t) return "";
	if (jH.test(t)) return t;
	let n = t.indexOf(":");
	return n === -1 || AH.test(t.slice(0, n)) ? t : "";
}
function PH(e) {
	return e.replace(/\\/g, "/");
}
function FH(e, t) {
	if (!t) return null;
	let n = PH(t).replace(/\/+$/, "");
	return n ? e === n ? "" : e.startsWith(`${n}/`) ? e.slice(n.length + 1) : null : null;
}
function IH(e, t = []) {
	let n = (e ?? "").trim();
	if (!n || n.startsWith("#")) return { kind: "blocked" };
	if (MH.test(n)) return {
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
	r = PH(r);
	for (let e of t) {
		let t = FH(r, e);
		if (t != null) {
			r = t;
			break;
		}
	}
	return r.startsWith("/") || jH.test(r) || (r = r.replace(/^\.\//, ""), !r || r === ".") || r.split("/").includes("..") || r.includes("://") ? { kind: "blocked" } : {
		kind: "workspace",
		path: r
	};
}
// src/app/lib/PerfProfiler.tsx
var LH = (t, n, r) => {
	e(`commit:${t}`, {
		ms: r,
		fields: { phase: n },
		throttleMs: 1e3,
		slowMs: 16
	});
};
function RH({ id: e, children: t }) {
	return l() ? /* @__PURE__ */ k(f, {
		id: e,
		onRender: LH,
		children: t
	}) : /* @__PURE__ */ k(ne, { children: t });
}
export { oV as $, dk as $n, ce as $r, ZR as $t, DV as A, DR as An, qp as Ar, Xz as At, hV as B, AR as Bn, ms as Br, qz as Bt, zV as C, YR as Cn, jm as Cr, hB as Ct, TV as D, NR as Dn, im as Dr, tB as Dt, HV as E, RR as En, am as Er, dB as Et, SV as F, GR as Fn, xs as Fr, Jz as Ft, dV as G, TR as Gn, ve as Gr, Vz as Gt, gV as H, UR as Hn, us as Hr, Fz as Ht, wV as I, KR as In, Ss as Ir, Iz as It, nV as J, TL as Jn, me as Jr, kz as Jt, mV as K, bR as Kn, pe as Kr, zz as Kt, vV as L, qR as Ln, gs as Lr, Wz as Lt, OV as M, WR as Mn, Jp as Mr, Uz as Mt, CV as N, OR as Nn, Js as Nr, Bz as Nt, kV as O, zR as On, tm as Or, nB as Ot, yV as P, VR as Pn, bs as Pr, Rz as Pt, sV as Q, CL as Qn, oe as Qr, yz as Qt, xV as R, BR as Rn, hs as Rr, Nz as Rt, RV as S, nz as Sn, Nm as Sr, EB as St, PV as T, MR as Tn, Zp as Tr, yB as Tt, uV as U, IR as Un, F as Ur, Gz as Ut, _V as V, jR as Vn, fs as Vr, Mz as Vt, fV as W, FR as Wn, _e as Wr, Hz as Wt, KB as X, OL as Xn, se as Xr, Dz as Xt, rV as Y, EL as Yn, he as Yr, Oz as Yt, JB as Z, SL as Zn, ae as Zr, Ez as Zt, bH as _, ez as _n, Vm as _r, jB as _t, kH as a, rz as an, Uh as ar, HB as at, FV as b, cz as bn, Hm as br, MB as bt, gH as c, dz as cn, Bh as cr, zB as ct, uH as d, pz as dn, sh as dr, $B as dt, de as ei, sz as en, fk as er, UB as et, yH as f, gz as fn, ah as fr, WB as ft, hH as g, QR as gn, Km as gr, cV as gt, vH as h, bz as hn, Ym as hr, YB as ht, DH as i, Tz as in, L as ir, GB as it, jV as j, PR as jn, Yp as jr, Kz as jt, AV as k, ER as kn, rm as kr, Pz as kt, _H as l, oz as ln, ph as lr, eV as lt, dH as m, xz as mn, Xm as mr, QB as mt, IH as n, ue as ni, tz as nn, Gy as nr, aV as nt, OH as o, az as on, Vh as or, BB as ot, mH as p, Sz as pn, Zm as pr, XB as pt, pV as q, wL as qn, ge as qr, Yz as qt, NH as r, lz as rn, sv as rr, iV as rt, lH as s, fz as sn, Lh as sr, LB as st, RH as t, le as ti, Cz as tn, pk as tr, ZB as tt, pH as u, _z as un, oh as ur, tV as ut, fH as v, $R as vn, zm as vr, IB as vt, IV as w, XR as wn, om as wr, gB as wt, VV as x, wz as xn, Rm as xr, NB as xt, BV as y, uz as yn, Bm as yr, OB as yt, bV as z, kR as zn, ps as zr, Lz as zt };
