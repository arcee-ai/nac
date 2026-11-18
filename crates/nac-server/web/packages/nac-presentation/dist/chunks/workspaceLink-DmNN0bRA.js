import { F as e, J as t, a as n, c as r, d as i, i as a, n as o, o as s, q as c, r as l, rt as u } from "./PresentationBoundary-CE0AqTej.js";
import * as d from "react";
import { Profiler as f, createContext as p, createElement as m, forwardRef as h, useCallback as g, useContext as _, useEffect as v, useInsertionEffect as y, useLayoutEffect as b, useMemo as x, useReducer as S, useRef as C, useState as w, useSyncExternalStore as T } from "react";
import { keepPreviousData as ee, useMutation as E, useQueries as te, useQuery as D, useQueryClient as O } from "@tanstack/react-query";
import { Fragment as ne, jsx as k, jsxs as A } from "react/jsx-runtime";
import { useLocation as re } from "react-router-dom";
import * as ie from "react-dom";
import { createPortal as j } from "react-dom";
// src/app/lib/primitive.ts
function ae(e) {
	return e != null && Object(e) !== e && e.constructor === String;
}
function oe(e) {
	return e != null && Object(e) !== e && e.constructor === Number;
}
// src/app/lib/routes.ts
var se = [
	"sessions",
	"insights",
	"delegated",
	"files",
	"terminal",
	"heartbeats",
	"history"
], ce = {
	sessions: "Sessions",
	insights: "Insights",
	delegated: "Subagents",
	files: "Files",
	terminal: "Terminal",
	heartbeats: "Heartbeats",
	history: "History"
};
se.filter((e) => e !== "history");
var le = "insights";
function ue(e) {
	return se.includes(e ?? "");
}
var de = [
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
function fe(e) {
	return de.includes(e ?? "");
}
var pe = {
	list: () => "/",
	newSession: (e) => e ? `/?project=${encodeURIComponent(e)}` : "/",
	settings: (e = "general") => `/settings/${e}`,
	session: (e, t = le) => `/session/${encodeURIComponent(e)}/${t}`,
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
// node_modules/clsx/dist/clsx.mjs
function ge(e) {
	var t, n, r = "";
	if (typeof e == "string" || typeof e == "number") r += e;
	else if (typeof e == "object") {
		if (Array.isArray(e)) {
			var i = e.length;
			for (t = 0; t < i; t++) e[t] && (n = ge(e[t])) && (r && (r += " "), r += n);
		} else for (n in e) e[n] && (r && (r += " "), r += n);
	}
	return r;
}
function _e() {
	for (var e, t, n = 0, r = "", i = arguments.length; n < i; n++) (e = arguments[n]) && (t = ge(e)) && (r && (r += " "), r += t);
	return r;
}
// node_modules/tailwind-merge/dist/bundle-mjs.mjs
var ve = (e, t) => {
	let n = Array(e.length + t.length);
	for (let t = 0; t < e.length; t++) n[t] = e[t];
	for (let r = 0; r < t.length; r++) n[e.length + r] = t[r];
	return n;
}, ye = (e, t) => ({
	classGroupId: e,
	validator: t
}), be = (e = /* @__PURE__ */ new Map(), t = null, n) => ({
	nextPart: e,
	validators: t,
	classGroupId: n
}), xe = "-", Se = [], Ce = "arbitrary..", we = (e) => {
	let t = De(e), { conflictingClassGroups: n, conflictingClassGroupModifiers: r } = e;
	return {
		getClassGroupId: (e) => {
			if (e.startsWith("[") && e.endsWith("]")) return Ee(e);
			let n = e.split(xe);
			return Te(n, +(n[0] === "" && n.length > 1), t);
		},
		getConflictingClassGroupIds: (e, t) => {
			if (t) {
				let t = r[e], i = n[e];
				return t ? i ? ve(i, t) : t : i || Se;
			}
			return n[e] || Se;
		}
	};
}, Te = (e, t, n) => {
	if (e.length - t === 0) return n.classGroupId;
	let r = e[t], i = n.nextPart.get(r);
	if (i) {
		let n = Te(e, t + 1, i);
		if (n) return n;
	}
	let a = n.validators;
	if (a === null) return;
	let o = t === 0 ? e.join(xe) : e.slice(t).join(xe), s = a.length;
	for (let e = 0; e < s; e++) {
		let t = a[e];
		if (t.validator(o)) return t.classGroupId;
	}
}, Ee = (e) => e.slice(1, -1).indexOf(":") === -1 ? void 0 : (() => {
	let t = e.slice(1, -1), n = t.indexOf(":"), r = t.slice(0, n);
	return r ? Ce + r : void 0;
})(), De = (e) => {
	let { theme: t, classGroups: n } = e;
	return Oe(n, t);
}, Oe = (e, t) => {
	let n = be();
	for (let r in e) {
		let i = e[r];
		ke(i, n, r, t);
	}
	return n;
}, ke = (e, t, n, r) => {
	let i = e.length;
	for (let a = 0; a < i; a++) {
		let i = e[a];
		Ae(i, t, n, r);
	}
}, Ae = (e, t, n, r) => {
	typeof e == "string" ? je(e, t, n) : typeof e == "function" ? Me(e, t, n, r) : Ne(e, t, n, r);
}, je = (e, t, n) => {
	let r = e === "" ? t : Pe(t, e);
	r.classGroupId = n;
}, Me = (e, t, n, r) => {
	Fe(e) ? ke(e(r), t, n, r) : (t.validators === null && (t.validators = []), t.validators.push(ye(n, e)));
}, Ne = (e, t, n, r) => {
	let i = Object.entries(e), a = i.length;
	for (let e = 0; e < a; e++) {
		let [a, o] = i[e];
		ke(o, Pe(t, a), n, r);
	}
}, Pe = (e, t) => {
	let n = e, r = t.split(xe), i = r.length;
	for (let e = 0; e < i; e++) {
		let t = r[e], i = n.nextPart.get(t);
		i || (i = be(), n.nextPart.set(t, i)), n = i;
	}
	return n;
}, Fe = (e) => "isThemeGetter" in e && e.isThemeGetter === !0, Ie = (e) => {
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
}, Le = "!", Re = ":", ze = [], Be = (e, t, n, r, i) => ({
	modifiers: e,
	hasImportantModifier: t,
	baseClassName: n,
	maybePostfixModifierPosition: r,
	isExternal: i
}), Ve = (e) => {
	let { prefix: t, experimentalParseClassName: n } = e, r = (e) => {
		let t = [], n = 0, r = 0, i = 0, a, o = e.length;
		for (let s = 0; s < o; s++) {
			let o = e[s];
			if (n === 0 && r === 0) {
				if (o === Re) {
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
		s.endsWith(Le) ? (c = s.slice(0, -1), l = !0) : s.startsWith(Le) && (c = s.slice(1), l = !0);
		let u = a && a > i ? a - i : void 0;
		return Be(t, l, c, u);
	};
	if (t) {
		let e = t + Re, n = r;
		r = (t) => t.startsWith(e) ? n(t.slice(e.length)) : Be(ze, !1, t, void 0, !0);
	}
	if (n) {
		let e = r;
		r = (t) => n({
			className: t,
			parseClassName: e
		});
	}
	return r;
}, He = (e) => {
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
}, Ue = (e) => ({
	cache: Ie(e.cacheSize),
	parseClassName: Ve(e),
	sortModifiers: He(e),
	postfixLookupClassGroupIds: We(e),
	...we(e)
}), We = (e) => {
	let t = Object.create(null), n = e.postfixLookupClassGroups;
	if (n) for (let e = 0; e < n.length; e++) t[n[e]] = !0;
	return t;
}, Ge = /\s+/, Ke = (e, t) => {
	let { parseClassName: n, getClassGroupId: r, getConflictingClassGroupIds: i, sortModifiers: a, postfixLookupClassGroupIds: o } = t, s = [], c = e.trim().split(Ge), l = "";
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
		let _ = d.length === 0 ? "" : d.length === 1 ? d[0] : a(d).join(":"), v = f ? _ + Le : _, y = v + g;
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
}, qe = (...e) => {
	let t = 0, n, r, i = "";
	for (; t < e.length;) (n = e[t++]) && (r = Je(n)) && (i && (i += " "), i += r);
	return i;
}, Je = (e) => {
	if (typeof e == "string") return e;
	let t, n = "";
	for (let r = 0; r < e.length; r++) e[r] && (t = Je(e[r])) && (n && (n += " "), n += t);
	return n;
}, Ye = (e, ...t) => {
	let n, r, i, a, o = (o) => (n = Ue(t.reduce((e, t) => t(e), e())), r = n.cache.get, i = n.cache.set, a = s, s(o)), s = (e) => {
		let t = r(e);
		if (t) return t;
		let a = Ke(e, n);
		return i(e, a), a;
	};
	return a = o, (...e) => a(qe(...e));
}, Xe = [], Ze = (e) => {
	let t = (t) => t[e] || Xe;
	return t.isThemeGetter = !0, t;
}, Qe = /^\[(?:(\w[\w-]*):)?(.+)\]$/i, $e = /^\((?:(\w[\w-]*):)?(.+)\)$/i, et = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/, tt = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/, nt = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/, rt = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/, it = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/, at = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/, ot = (e) => et.test(e), M = (e) => !!e && !Number.isNaN(Number(e)), st = (e) => !!e && Number.isInteger(Number(e)), ct = (e) => e.endsWith("%") && M(e.slice(0, -1)), lt = (e) => tt.test(e), ut = () => !0, dt = (e) => nt.test(e) && !rt.test(e), ft = () => !1, pt = (e) => it.test(e), mt = (e) => at.test(e), ht = (e) => !N(e) && !P(e), gt = (e) => e.startsWith("@container") && (e[10] === "/" && e[11] !== void 0 || e[11] === "s" && e[16] !== void 0 && e.startsWith("-size/", 10) || e[11] === "n" && e[18] !== void 0 && e.startsWith("-normal/", 10)), _t = (e) => Mt(e, It, ft), N = (e) => Qe.test(e), vt = (e) => Mt(e, Lt, dt), yt = (e) => Mt(e, Rt, M), bt = (e) => Mt(e, Bt, ut), xt = (e) => Mt(e, zt, ft), St = (e) => Mt(e, Pt, ft), Ct = (e) => Mt(e, Ft, mt), wt = (e) => Mt(e, Vt, pt), P = (e) => $e.test(e), Tt = (e) => Nt(e, Lt), Et = (e) => Nt(e, zt), Dt = (e) => Nt(e, Pt), Ot = (e) => Nt(e, It), kt = (e) => Nt(e, Ft), At = (e) => Nt(e, Vt, !0), jt = (e) => Nt(e, Bt, !0), Mt = (e, t, n) => {
	let r = Qe.exec(e);
	return r ? r[1] ? t(r[1]) : n(r[2]) : !1;
}, Nt = (e, t, n = !1) => {
	let r = $e.exec(e);
	return r ? r[1] ? t(r[1]) : n : !1;
}, Pt = (e) => e === "position" || e === "percentage", Ft = (e) => e === "image" || e === "url", It = (e) => e === "length" || e === "size" || e === "bg-size", Lt = (e) => e === "length", Rt = (e) => e === "number", zt = (e) => e === "family-name", Bt = (e) => e === "number" || e === "weight", Vt = (e) => e === "shadow", Ht = () => {
	let e = Ze("color"), t = Ze("font"), n = Ze("text"), r = Ze("font-weight"), i = Ze("tracking"), a = Ze("leading"), o = Ze("breakpoint"), s = Ze("container"), c = Ze("spacing"), l = Ze("radius"), u = Ze("shadow"), d = Ze("inset-shadow"), f = Ze("text-shadow"), p = Ze("drop-shadow"), m = Ze("blur"), h = Ze("perspective"), g = Ze("aspect"), _ = Ze("ease"), v = Ze("animate"), y = () => [
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
		ot,
		"full",
		"auto",
		...w()
	], ee = () => [
		st,
		"none",
		"subgrid",
		P,
		N
	], E = () => [
		"auto",
		{ span: [
			"full",
			st,
			P,
			N
		] },
		st,
		P,
		N
	], te = () => [
		st,
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
		ot,
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
		ot,
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
		ot,
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
		Dt,
		St,
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
		Ot,
		_t,
		{ size: [P, N] }
	], ce = () => [
		ct,
		Tt,
		vt
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
		Tt,
		vt
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
		ct,
		Dt,
		St
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
		ot,
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
			blur: [lt],
			breakpoint: [lt],
			color: [ut],
			container: [lt],
			"drop-shadow": [lt],
			ease: [
				"in",
				"out",
				"in-out"
			],
			font: [ht],
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
			"inset-shadow": [lt],
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
			radius: [lt],
			shadow: [lt],
			spacing: ["px", M],
			text: [lt],
			"text-shadow": [lt],
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
				ot,
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
			"container-named": [gt],
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
				st,
				"auto",
				P,
				N
			] }],
			basis: [{ basis: [
				ot,
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
				ot,
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
				st,
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
				Tt,
				vt
			] }],
			"font-smoothing": ["antialiased", "subpixel-antialiased"],
			"font-style": ["italic", "not-italic"],
			"font-weight": [{ font: [
				r,
				jt,
				bt
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
				ct,
				N
			] }],
			"font-family": [{ font: [
				Et,
				xt,
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
				yt
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
				vt
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
				st,
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
						st,
						P,
						N
					],
					radial: [
						"",
						P,
						N
					],
					conic: [
						st,
						P,
						N
					]
				},
				kt,
				Ct
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
				Tt,
				vt
			] }],
			"outline-color": [{ outline: j() }],
			shadow: [{ shadow: [
				"",
				"none",
				u,
				At,
				wt
			] }],
			"shadow-color": [{ shadow: j() }],
			"inset-shadow": [{ "inset-shadow": [
				"none",
				d,
				At,
				wt
			] }],
			"inset-shadow-color": [{ "inset-shadow": j() }],
			"ring-w": [{ ring: ue() }],
			"ring-w-inset": ["ring-inset"],
			"ring-color": [{ ring: j() }],
			"ring-offset-w": [{ "ring-offset": [M, vt] }],
			"ring-offset-color": [{ "ring-offset": j() }],
			"inset-ring-w": [{ "inset-ring": ue() }],
			"inset-ring-color": [{ "inset-ring": j() }],
			"text-shadow": [{ "text-shadow": [
				"none",
				f,
				At,
				wt
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
				At,
				wt
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
				st,
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
				Tt,
				vt,
				yt
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
}, Ut = (e, { cacheSize: t, prefix: n, experimentalParseClassName: r, extend: i = {}, override: a = {} }) => (Wt(e, "cacheSize", t), Wt(e, "prefix", n), Wt(e, "experimentalParseClassName", r), Gt(e.theme, a.theme), Gt(e.classGroups, a.classGroups), Gt(e.conflictingClassGroups, a.conflictingClassGroups), Gt(e.conflictingClassGroupModifiers, a.conflictingClassGroupModifiers), Wt(e, "postfixLookupClassGroups", a.postfixLookupClassGroups), Wt(e, "orderSensitiveModifiers", a.orderSensitiveModifiers), Kt(e.theme, i.theme), Kt(e.classGroups, i.classGroups), Kt(e.conflictingClassGroups, i.conflictingClassGroups), Kt(e.conflictingClassGroupModifiers, i.conflictingClassGroupModifiers), qt(e, i, "postfixLookupClassGroups"), qt(e, i, "orderSensitiveModifiers"), e), Wt = (e, t, n) => {
	n !== void 0 && (e[t] = n);
}, Gt = (e, t) => {
	if (t) for (let n in t) Wt(e, n, t[n]);
}, Kt = (e, t) => {
	if (t) for (let n in t) qt(e, t, n);
}, qt = (e, t, n) => {
	let r = t[n];
	r !== void 0 && (e[n] = e[n] ? e[n].concat(r) : r);
}, Jt = ((e, ...t) => typeof e == "function" ? Ye(Ht, e, ...t) : Ye(() => Ut(Ht(), e), ...t))({ extend: {
	theme: { radius: ["interaction"] },
	classGroups: { "font-size": [{ text: [
		"big",
		"medium",
		"small",
		"micro"
	] }, { type: [
		"display",
		"title",
		"heading",
		"subheading",
		"strong",
		"label",
		"body",
		"body-chrome",
		"meta",
		"meta-strong",
		"tag"
	] }] }
} });
function F(...e) {
	return Jt(_e(e));
}
// node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
var Yt = (e) => e?.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
// node_modules/lucide-react/dist/esm/shared/src/utils/toLucideIconData.mjs
function Xt(e, t, n = []) {
	if (t == null) throw Error("[lucide]: iconNode is required when icon name is used");
	return {
		name: Yt(e),
		size: 24,
		node: t,
		...n.length > 0 ? { aliases: n } : {}
	};
}
// node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
var Zt = (e) => {
	let t = "", n = !1;
	for (let r of e) r === "-" || r === "_" || r <= " " ? n = t.length > 0 : (t.length === 0 ? t += r.toLowerCase() : t += n ? r.toUpperCase() : r, n = !1);
	return t;
}, Qt = (e) => {
	let t = Zt(e);
	return t.charAt(0).toUpperCase() + t.slice(1);
}, $t = (...e) => e.filter((e, t, n) => !!e && e.trim() !== "" && n.indexOf(e) === t).join(" ").trim(), en = {
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
function tn(e) {
	return e != null;
}
function nn(e, t = {}) {
	let n = t.attributeNames ?? {}, r = (e) => n[e] ?? e, i = e.size ?? e.width ?? en.width, a = e.size ?? e.height ?? en.height, o = e.aliases?.filter((e) => typeof e == "string" && e.trim() !== "").map((e) => `lucide-${e}`) ?? [], s = [...e.name ? [`lucide-${e.name}`] : [], ...o], c = t.className?.split(" ").filter(Boolean) ?? [], l = t.includeDefaultClasses === !1 ? $t(...c) : $t("lucide", ...s, ...c), u = t.absoluteStrokeWidth ? Number(t.strokeWidth ?? en["stroke-width"]) * Number(e.size ?? e.width ?? en.width) / Number(t.size ?? t.width ?? en.width) : t.strokeWidth ?? en["stroke-width"];
	return [
		"svg",
		{
			...Object.entries(en).reduce((e, [t, n]) => (e[r(t)] = n, e), {}),
			..."color" in t && t.color && { [r("stroke")]: t.color },
			..."size" in t && tn(t.size) && {
				[r("width")]: t.size,
				[r("height")]: t.size
			},
			..."width" in t && tn(t.width) && { [r("width")]: t.width },
			..."height" in t && tn(t.height) && { [r("height")]: t.height },
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
function rn(e, t = {}) {
	return nn(e, {
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
var an = (e) => {
	for (let t in e) if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
	return !1;
}, on = p({}), sn = () => _(on), cn = h(({ color: e, size: t, width: n, height: r, strokeWidth: i, absoluteStrokeWidth: a, nonScalingStroke: o, className: s = "", children: c, iconNode: l = [], icon: u = {
	node: l,
	aliases: [],
	size: 24
}, ...d }, f) => {
	let { size: p = 24, strokeWidth: h = 2, absoluteStrokeWidth: g = !1, nonScalingStroke: _ = !1, color: v = "currentColor", className: y = "" } = sn() ?? {}, b = !!c || an(d), [x, S, C = []] = rn(u, {
		color: e ?? v,
		width: n ?? t ?? p,
		height: r ?? t ?? p,
		strokeWidth: i ?? h,
		absoluteStrokeWidth: a ?? g,
		nonScalingStroke: o ?? _,
		className: $t(y, s),
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
	let r = typeof e == "string" ? Xt(e, t, n) : e, i = h(({ className: e, ...t }, n) => m(cn, {
		ref: n,
		icon: r,
		className: e,
		...t
	}));
	return r.name && (i.displayName = Qt(r.name)), i;
}
// node_modules/lucide-react/dist/esm/icons/activity.mjs
var ln = {
	name: "activity",
	size: 24,
	node: [["path", {
		d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
		key: "169zse"
	}]]
};
ln.node;
var un = I(ln), dn = {
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
dn.node;
var fn = I(dn), pn = {
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
pn.node;
var mn = I(pn), hn = {
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
hn.node;
var gn = I(hn), _n = {
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
_n.node;
var vn = I(_n), yn = {
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
yn.node;
var bn = I(yn), xn = {
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
xn.node;
var Sn = I(xn), Cn = {
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
Cn.node;
var wn = I(Cn), Tn = {
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
Tn.node;
var En = I(Tn), Dn = {
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
Dn.node;
var On = I(Dn), kn = {
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
kn.node;
var An = I(kn), jn = {
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
jn.node;
var Mn = I(jn), Nn = {
	name: "book",
	size: 24,
	node: [["path", {
		d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",
		key: "k3hazp"
	}]]
};
Nn.node;
var Pn = I(Nn), Fn = {
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
Fn.node;
var In = I(Fn), Ln = {
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
Ln.node;
var Rn = I(Ln), zn = {
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
zn.node;
var Bn = I(zn), Vn = {
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
Vn.node;
var Hn = I(Vn), Un = {
	name: "check",
	size: 24,
	node: [["path", {
		d: "M20 6 9 17l-5-5",
		key: "1gmf2c"
	}]]
};
Un.node;
var Wn = I(Un), Gn = {
	name: "chevron-down",
	size: 24,
	node: [["path", {
		d: "m6 9 6 6 6-6",
		key: "qrunsl"
	}]]
};
Gn.node;
var Kn = I(Gn), qn = {
	name: "chevron-left",
	size: 24,
	node: [["path", {
		d: "m15 18-6-6 6-6",
		key: "1wnfg3"
	}]]
};
qn.node;
var Jn = I(qn), Yn = {
	name: "chevron-right",
	size: 24,
	node: [["path", {
		d: "m9 18 6-6-6-6",
		key: "mthhwq"
	}]]
};
Yn.node;
var Xn = I(Yn), Zn = {
	name: "chevron-up",
	size: 24,
	node: [["path", {
		d: "m18 15-6-6-6 6",
		key: "153udz"
	}]]
};
Zn.node;
var Qn = I(Zn), $n = {
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
$n.node;
var er = I($n), tr = {
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
tr.node;
var nr = I(tr), rr = {
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
rr.node;
var ir = I(rr), ar = {
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
ar.node;
var or = I(ar), sr = {
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
sr.node;
var cr = I(sr), lr = {
	name: "cloud",
	size: 24,
	node: [["path", {
		d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",
		key: "p7xjir"
	}]]
};
lr.node;
var ur = I(lr), dr = {
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
dr.node;
var fr = I(dr), pr = {
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
pr.node;
var mr = I(pr), hr = {
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
hr.node;
var gr = I(hr), _r = {
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
_r.node;
var vr = I(_r), yr = {
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
yr.node;
var br = I(yr), xr = {
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
xr.node;
var Sr = I(xr), Cr = {
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
Cr.node;
var wr = I(Cr), Tr = {
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
Tr.node;
var Er = I(Tr), Dr = {
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
Dr.node;
var Or = I(Dr), kr = {
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
kr.node;
var Ar = I(kr), jr = {
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
jr.node;
var Mr = I(jr), Nr = {
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
Nr.node;
var Pr = I(Nr), Fr = {
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
Fr.node;
var Ir = I(Fr), Lr = {
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
Lr.node;
var Rr = I(Lr), zr = {
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
zr.node;
var Br = I(zr), Vr = {
	name: "flag",
	size: 24,
	node: [["path", {
		d: "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528",
		key: "1jaruq"
	}]]
};
Vr.node;
var Hr = I(Vr), Ur = {
	name: "folder-open",
	size: 24,
	node: [["path", {
		d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
		key: "usdka0"
	}]]
};
Ur.node;
var Wr = I(Ur), Gr = {
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
Gr.node;
var Kr = I(Gr), qr = {
	name: "folder",
	size: 24,
	node: [["path", {
		d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
		key: "1kt360"
	}]]
};
qr.node;
var Jr = I(qr), Yr = {
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
Yr.node;
var Xr = I(Yr), Zr = {
	name: "funnel",
	size: 24,
	node: [["path", {
		d: "M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z",
		key: "sc7q7i"
	}]],
	aliases: ["filter"]
};
Zr.node;
var Qr = I(Zr), $r = {
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
$r.node;
var ei = I($r), ti = {
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
ti.node;
var ni = I(ti), ri = {
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
ri.node;
var ii = I(ri), ai = {
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
ai.node;
var oi = I(ai), si = {
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
si.node;
var ci = I(si), li = {
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
li.node;
var ui = I(li), di = {
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
di.node;
var fi = I(di), pi = {
	name: "headphones",
	size: 24,
	node: [["path", {
		d: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
		key: "1xhozi"
	}]]
};
pi.node;
var mi = I(pi), hi = {
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
hi.node;
var gi = I(hi), _i = {
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
_i.node;
var vi = I(_i), yi = {
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
yi.node;
var bi = I(yi), xi = {
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
xi.node;
var Si = I(xi), Ci = {
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
Ci.node;
var wi = I(Ci), Ti = {
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
Ti.node;
var Ei = I(Ti), Di = {
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
Di.node;
var Oi = I(Di), ki = {
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
ki.node;
var Ai = I(ki), ji = {
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
ji.node;
var Mi = I(ji), Ni = {
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
Ni.node;
var Pi = I(Ni), Fi = {
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
Fi.node;
var Ii = I(Fi), Li = {
	name: "loader-circle",
	size: 24,
	node: [["path", {
		d: "M21 12a9 9 0 1 1-6.219-8.56",
		key: "13zald"
	}]],
	aliases: ["loader-2"]
};
Li.node;
var Ri = I(Li), zi = {
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
zi.node;
var Bi = I(zi), Vi = {
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
Vi.node;
var Hi = I(Vi), Ui = {
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
Ui.node;
var Wi = I(Ui), Gi = {
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
Gi.node;
var Ki = I(Gi), qi = {
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
qi.node;
var Ji = I(qi), Yi = {
	name: "message-square",
	size: 24,
	node: [["path", {
		d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
		key: "18887p"
	}]]
};
Yi.node;
var Xi = I(Yi), Zi = {
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
Zi.node;
var Qi = I(Zi), $i = {
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
$i.node;
var ea = I($i), ta = {
	name: "minus",
	size: 24,
	node: [["path", {
		d: "M5 12h14",
		key: "1ays0h"
	}]]
};
ta.node;
var na = I(ta), ra = {
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
ra.node;
var ia = I(ra), aa = {
	name: "moon",
	size: 24,
	node: [["path", {
		d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",
		key: "kfwtm"
	}]]
};
aa.node;
var oa = I(aa), sa = {
	name: "mouse-pointer-2",
	size: 24,
	node: [["path", {
		d: "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z",
		key: "edeuup"
	}]]
};
sa.node;
var ca = I(sa), la = {
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
la.node;
var ua = I(la), da = {
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
da.node;
var fa = I(da), pa = {
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
pa.node;
var ma = I(pa), ha = {
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
ha.node;
var ga = I(ha), _a = {
	name: "paperclip",
	size: 24,
	node: [["path", {
		d: "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551",
		key: "1miecu"
	}]]
};
_a.node;
var va = I(_a), ya = {
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
ya.node;
var ba = I(ya), xa = {
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
xa.node;
var Sa = I(xa), Ca = {
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
Ca.node;
var wa = I(Ca), Ta = {
	name: "play",
	size: 24,
	node: [["path", {
		d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",
		key: "10ikf1"
	}]]
};
Ta.node;
var Ea = I(Ta), Da = {
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
Da.node;
var Oa = I(Da), ka = {
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
ka.node;
var Aa = I(ka), ja = {
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
ja.node;
var Ma = I(ja), Na = {
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
Na.node;
var Pa = I(Na), Fa = {
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
Fa.node;
var Ia = I(Fa), La = {
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
La.node;
var Ra = I(La), za = {
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
za.node;
var Ba = I(za), Va = {
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
Va.node;
var Ha = I(Va), Ua = {
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
Ua.node;
var Wa = I(Ua), Ga = {
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
Ga.node;
var Ka = I(Ga), qa = {
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
qa.node;
var Ja = I(qa), Ya = {
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
Ya.node;
var Xa = I(Ya), Za = {
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
Za.node;
var Qa = I(Za), $a = {
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
$a.node;
var eo = I($a), to = {
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
to.node;
var no = I(to), ro = {
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
ro.node;
var io = I(ro), ao = {
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
ao.node;
var oo = I(ao), so = {
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
so.node;
var co = I(so), lo = {
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
lo.node;
var uo = I(lo), fo = {
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
fo.node;
var po = I(fo), mo = {
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
mo.node;
var ho = I(mo), go = {
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
go.node;
var _o = I(go), vo = {
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
vo.node;
var yo = I(vo), bo = {
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
bo.node;
var xo = I(bo), So = {
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
So.node;
var Co = I(So), wo = {
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
wo.node;
var To = I(wo), Eo = {
	name: "thermometer",
	size: 24,
	node: [["path", {
		d: "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z",
		key: "17jzev"
	}]]
};
Eo.node;
var Do = I(Eo), Oo = {
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
Oo.node;
var ko = I(Oo), Ao = {
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
Ao.node;
var jo = I(Ao), Mo = {
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
Mo.node;
var No = I(Mo), Po = {
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
Po.node;
var Fo = I(Po), Io = {
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
Io.node;
var Lo = I(Io), Ro = {
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
Ro.node;
var zo = I(Ro), Bo = {
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
Bo.node;
var Vo = I(Bo), Ho = {
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
Ho.node;
var Uo = I(Ho), Wo = {
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
Wo.node;
var Go = I(Wo), Ko = {
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
Ko.node;
var qo = I(Ko), Jo = {
	name: "wrench",
	size: 24,
	node: [["path", {
		d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",
		key: "1ngwbx"
	}]]
};
Jo.node;
var Yo = I(Jo), Xo = {
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
Xo.node;
var Zo = I(Xo), Qo = {
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
Qo.node;
var $o = I(Qo), es = {
	name: "zap",
	size: 24,
	node: [["path", {
		d: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z",
		key: "1v7up4"
	}]]
};
es.node;
var ts = I(es), ns = {
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
ns.node;
var rs = I(ns), is = {
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
is.node;
var as = I(is), os = {
	arcee: "M11.6967 0L0 20.1629H2.71067L13.0706 2.33934L11.6967 0Z M15.2983 6.23825L4.0472 20.2H7.05492L16.5237 8.42907L15.2983 6.23825Z M20.0163 14.3329L18.828 12.2906L8.35669 20.1627H12.2556L20.0163 14.3329Z M22.1672 18.0466L13.8866 20.1631H23.4297L22.1672 18.0466Z",
	chatGpt: "M9.205 8.658V6.398C9.205 6.208 9.277 6.065 9.443 5.97L13.986 3.354C14.605 2.997 15.342 2.831 16.103 2.831C18.957 2.831 20.765 5.043 20.765 7.397C20.765 7.564 20.765 7.754 20.741 7.944L16.031 5.185C15.903 5.10392 15.7545 5.06088 15.603 5.06088C15.4515 5.06088 15.303 5.10392 15.175 5.185L9.205 8.658ZM19.814 17.458V12.06C19.814 11.727 19.671 11.49 19.385 11.323L13.415 7.85L15.365 6.732C15.4355 6.68513 15.5183 6.66013 15.603 6.66013C15.6877 6.66013 15.7705 6.68513 15.841 6.732L20.384 9.349C21.693 10.109 22.573 11.727 22.573 13.297C22.573 15.105 21.503 16.77 19.813 17.46L19.814 17.458ZM7.802 12.703L5.852 11.561C5.77505 11.5204 5.71152 11.4584 5.66911 11.3824C5.62669 11.3064 5.6072 11.2198 5.613 11.133V5.899C5.613 3.354 7.563 1.427 10.204 1.427C11.204 1.427 12.131 1.76 12.916 2.355L8.23 5.067C7.945 5.233 7.802 5.471 7.802 5.804V12.703ZM12 15.128L9.205 13.558V10.228L12 8.658L14.795 10.228V13.558L12 15.128ZM13.796 22.358C12.796 22.358 11.869 22.026 11.084 21.431L15.77 18.719C16.055 18.553 16.198 18.315 16.198 17.982V11.084L18.172 12.226C18.339 12.321 18.41 12.464 18.41 12.654V17.887C18.41 20.432 16.436 22.358 13.796 22.358ZM8.159 17.055L3.615 14.438C2.307 13.677 1.427 12.06 1.427 10.49C1.42365 9.59786 1.68673 8.72504 2.18255 7.98336C2.67837 7.24169 3.38434 6.66493 4.21 6.327V11.75C4.21 12.083 4.353 12.321 4.638 12.488L10.585 15.937L8.635 17.055C8.56447 17.1019 8.48168 17.1269 8.397 17.1269C8.31232 17.1269 8.22953 17.1019 8.159 17.055ZM7.897 20.955C5.209 20.955 3.235 18.934 3.235 16.436C3.235 16.246 3.259 16.056 3.282 15.866L7.968 18.576C8.0956 18.6582 8.24419 18.702 8.396 18.702C8.54781 18.702 8.6964 18.6582 8.824 18.576L14.794 15.128V17.388C14.794 17.578 14.724 17.721 14.557 17.816L10.014 20.432C9.395 20.789 8.658 20.955 7.897 20.955ZM13.796 23.785C15.1664 23.7845 16.4947 23.3111 17.5563 22.4445C18.618 21.578 19.348 20.3715 19.623 19.029C22.287 18.339 24 15.84 24 13.296C24 11.631 23.287 10.014 22.002 8.848C22.121 8.348 22.192 7.849 22.192 7.35C22.192 3.949 19.433 1.403 16.246 1.403C15.6064 1.40012 14.9708 1.50492 14.366 1.713C13.2561 0.620228 11.7625 0.00535575 10.205 0C8.83445 0.000500422 7.50609 0.474136 6.44441 1.34087C5.38272 2.2076 4.6528 3.41428 4.378 4.757C1.713 5.447 0 7.945 0 10.49C0 12.156 0.713 13.773 1.998 14.938C1.879 15.438 1.808 15.938 1.808 16.437C1.808 19.838 4.567 22.383 7.754 22.383C8.396 22.383 9.014 22.288 9.634 22.074C10.7441 23.167 12.2381 23.7819 13.796 23.787V23.785Z",
	discord: "M19.2701 5.33C17.9401 4.71 16.5001 4.26 15.0001 4C14.9737 4.00038 14.9486 4.01116 14.9301 4.03C14.7501 4.36 14.5401 4.79 14.4001 5.12C12.8091 4.88015 11.1911 4.88015 9.60012 5.12C9.46012 4.78 9.25012 4.36 9.06012 4.03C9.05012 4.01 9.02012 4 8.99012 4C7.49012 4.26 6.06012 4.71 4.72012 5.33C4.71012 5.33 4.70012 5.34 4.69012 5.35C1.97012 9.42 1.22012 13.38 1.59012 17.3C1.59012 17.32 1.60012 17.34 1.62012 17.35C3.42012 18.67 5.15012 19.47 6.86012 20C6.89012 20.01 6.92012 20 6.93012 19.98C7.33012 19.43 7.69012 18.85 8.00012 18.24C8.02012 18.2 8.00012 18.16 7.96012 18.15C7.39012 17.93 6.85012 17.67 6.32012 17.37C6.28012 17.35 6.28012 17.29 6.31012 17.26C6.42012 17.18 6.53012 17.09 6.64012 17.01C6.66012 16.99 6.69012 16.99 6.71012 17C10.1501 18.57 13.8601 18.57 17.2601 17C17.2801 16.99 17.3101 16.99 17.3301 17.01C17.4401 17.1 17.5501 17.18 17.6601 17.27C17.7001 17.3 17.7001 17.36 17.6501 17.38C17.1301 17.69 16.5801 17.94 16.0101 18.16C15.9701 18.17 15.9601 18.22 15.9701 18.25C16.2901 18.86 16.6501 19.44 17.0401 19.99C17.0701 20 17.1001 20.01 17.1301 20C18.8501 19.47 20.5801 18.67 22.3801 17.35C22.4001 17.34 22.4101 17.32 22.4101 17.3C22.8501 12.77 21.6801 8.84 19.3101 5.35C19.3001 5.34 19.2901 5.33 19.2701 5.33ZM8.52012 14.91C7.49012 14.91 6.63012 13.96 6.63012 12.79C6.63012 11.62 7.47012 10.67 8.52012 10.67C9.58012 10.67 10.4201 11.63 10.4101 12.79C10.4101 13.96 9.57012 14.91 8.52012 14.91ZM15.4901 14.91C14.4601 14.91 13.6001 13.96 13.6001 12.79C13.6001 11.62 14.4401 10.67 15.4901 10.67C16.5501 10.67 17.3901 11.63 17.3801 12.79C17.3801 13.96 16.5501 14.91 15.4901 14.91Z",
	github: "M12 2C10.6868 2 9.38642 2.25866 8.17317 2.7612C6.95991 3.26375 5.85752 4.00035 4.92893 4.92893C3.05357 6.8043 2 9.34784 2 12C2 16.42 4.87 20.17 8.84 21.5C9.34 21.58 9.5 21.27 9.5 21V19.31C6.73 19.91 6.14 17.97 6.14 17.97C5.68 16.81 5.03 16.5 5.03 16.5C4.12 15.88 5.1 15.9 5.1 15.9C6.1 15.97 6.63 16.93 6.63 16.93C7.5 18.45 8.97 18 9.54 17.76C9.63 17.11 9.89 16.67 10.17 16.42C7.95 16.17 5.62 15.31 5.62 11.5C5.62 10.39 6 9.5 6.65 8.79C6.55 8.54 6.2 7.5 6.75 6.15C6.75 6.15 7.59 5.88 9.5 7.17C10.29 6.95 11.15 6.84 12 6.84C12.85 6.84 13.71 6.95 14.5 7.17C16.41 5.88 17.25 6.15 17.25 6.15C17.8 7.5 17.45 8.54 17.35 8.79C18 9.5 18.38 10.39 18.38 11.5C18.38 15.32 16.04 16.16 13.81 16.41C14.17 16.72 14.5 17.33 14.5 18.26V21C14.5 21.27 14.66 21.59 15.17 21.5C19.14 20.16 22 16.42 22 12C22 10.6868 21.7413 9.38642 21.2388 8.17317C20.7362 6.95991 19.9997 5.85752 19.0711 4.92893C18.1425 4.00035 17.0401 3.26375 15.8268 2.7612C14.6136 2.25866 13.3132 2 12 2Z",
	google: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z",
	javascript: "M6 3C5.20435 3 4.44129 3.31607 3.87868 3.87868C3.31607 4.44129 3 5.20435 3 6V18C3 18.7956 3.31607 19.5587 3.87868 20.1213C4.44129 20.6839 5.20435 21 6 21H18C18.7956 21 19.5587 20.6839 20.1213 20.1213C20.6839 19.5587 21 18.7956 21 18V6C21 5.20435 20.6839 4.44129 20.1213 3.87868C19.5587 3.31607 18.7956 3 18 3H6ZM13.334 16.055C14.054 16.635 14.7727 16.921 15.49 16.913C15.93 16.913 16.2673 16.8323 16.502 16.671C16.6113 16.6001 16.7002 16.5019 16.76 16.3862C16.8197 16.2705 16.8484 16.1412 16.843 16.011C16.8445 15.869 16.8149 15.7285 16.7561 15.5992C16.6974 15.47 16.611 15.3552 16.503 15.263C16.2683 15.0583 15.8243 14.853 15.171 14.647C14.3863 14.4203 13.7813 14.127 13.356 13.767C12.9387 13.407 12.726 12.9047 12.718 12.26C12.718 11.6513 12.982 11.1417 13.51 10.731C14.0233 10.3203 14.68 10.115 15.48 10.115C16.5947 10.115 17.489 10.3863 18.163 10.929L17.393 12.128C17.1157 11.9124 16.7977 11.7553 16.458 11.666C16.1528 11.5637 15.8338 11.5081 15.512 11.501C15.132 11.501 14.8277 11.5707 14.599 11.71C14.3723 11.85 14.259 12.0333 14.259 12.26C14.259 12.5093 14.398 12.722 14.676 12.898C14.956 13.0673 15.4327 13.2543 16.106 13.459C16.92 13.701 17.4993 14.0237 17.844 14.427C18.1887 14.8303 18.361 15.3437 18.361 15.967C18.361 16.605 18.1153 17.155 17.624 17.617C17.14 18.0717 16.436 18.31 15.512 18.332C14.302 18.332 13.29 17.969 12.476 17.243L13.334 16.055ZM7.804 16.693C8.03867 16.8397 8.321 16.913 8.651 16.913C8.99567 16.913 9.28167 16.814 9.509 16.616C9.73567 16.4107 9.84933 16.055 9.85 15.549V10.247H11.335V15.835C11.313 16.7003 11.0637 17.3237 10.587 17.705C10.3262 17.9255 10.0229 18.0902 9.696 18.189C9.39282 18.2813 9.07792 18.3295 8.761 18.332C8.211 18.332 7.72333 18.2367 7.298 18.046C6.84333 17.8413 6.462 17.4783 6.154 16.957L7.188 16.11C7.378 16.3667 7.58333 16.561 7.804 16.693Z",
	python: "M21.5694 9.42899C21.2154 8.07399 20.5694 7.00899 19.2144 7.00899H17.4094V9.13899C17.4094 10.784 15.9894 12.171 14.4734 12.171H9.66441C8.34241 12.171 7.30941 13.301 7.30941 14.623V19.173C7.30941 20.43 8.43941 21.205 9.66441 21.624C11.1494 22.076 12.6004 22.173 14.4394 21.624C15.6334 21.269 16.7954 20.592 16.7954 19.172V17.365H12.0524V16.785H19.2144C20.5694 16.785 21.1184 15.817 21.5694 14.365C22.0534 12.784 22.0534 11.332 21.5694 9.42899ZM14.7294 18.462C15.2144 18.462 15.6334 18.882 15.6334 19.366C15.6334 19.85 15.2134 20.269 14.7304 20.269C14.2464 20.301 13.8264 19.849 13.8264 19.366C13.7944 18.882 14.2134 18.462 14.7304 18.462M9.44041 11.558H14.2154C15.5374 11.558 16.5704 10.461 16.5704 9.10599V4.62099C16.5704 3.36299 15.4734 2.39499 14.2144 2.16899C12.6344 1.94399 10.8914 1.94399 9.44041 2.16899C7.40741 2.52399 7.08441 3.26599 7.08441 4.62099V6.42799H11.8594V7.00799H5.34141C3.98641 7.00799 2.76041 7.87999 2.40541 9.42799C1.95341 11.235 1.95341 12.364 2.40541 14.236C2.76041 15.656 3.53541 16.656 4.95441 16.656H6.50341V14.494C6.47041 12.913 7.85841 11.558 9.43941 11.558M9.14941 5.20199C8.91134 5.19715 8.68436 5.10048 8.5159 4.93221C8.34743 4.76393 8.25052 4.53705 8.24541 4.29899C8.24541 3.81499 8.66541 3.39499 9.14841 3.39499C9.63141 3.39499 10.0524 3.81499 10.0524 4.29899C10.0524 4.78299 9.63341 5.20199 9.14941 5.20199Z"
}, ss = /* @__PURE__ */ function(e) {
	return e.Checklist = "checklist", e.Features = "features", e.Publish = "publish", e.Toolbox = "toolbox", e.Play = "play", e.Add = "add", e.Chat = "chat", e.Home = "home", e.Coursor = "coursor", e.Hand = "hand", e.Order = "order", e.ZoomIn = "zoomIn", e.ZoomOut = "zoomOut", e.TurnLeft = "turnLeft", e.TurnRight = "turnRight", e.History = "history", e.Env = "env", e.AddNote = "addNote", e.Controls = "controls", e.ArrowLeft = "arrowLeft", e.Down = "down", e.Left = "left", e.ArrowRight = "arrowRight", e.Right = "right", e.Top = "top", e.Grid = "grid", e.ArrowTop = "arrowTop", e.Trash = "trash", e.ArrowDown = "arrowDown", e.Close = "close", e.Hamburger = "hamburger", e.BookOpen = "bookOpen", e.Ai = "ai", e.Book = "book", e.FileCopy = "fileCopy", e.FileCopyFilled = "fileCopyFilled", e.FileUpload = "fileUpload", e.Search = "search", e.PlayHistory = "playHistory", e.MenuHorizontal = "menuHorizontal", e.HideSidebar = "hideSidebar", e.MenuVertical = "menuVertical", e.Tag = "tag", e.TagAdd = "tagAdd", e.Moon = "moon", e.Sun = "sun", e.Desktop = "desktop", e.DoubleArrowsVertical = "doubleArrowsVertical", e.FinanceMode = "financeMode", e.Refresh = "refresh", e.Info = "info", e.FolderCopy = "folderCopy", e.Important = "important", e.Globe = "globe", e.Filter = "filter", e.Microphone = "microphone", e.Image = "image", e.Attachment = "attachment", e.Plane = "plane", e.PlaneAdd = "planeAdd", e.Headphones = "headphones", e.Bolt = "bolt", e.Private = "private", e.Scheme = "scheme", e.Repair = "repair", e.Flow = "flow", e.Folder = "folder", e.Folders = "folders", e.Edit = "edit", e.AddCircle = "addCircle", e.Loader = "loader", e.Gear = "gear", e.Exit = "exit", e.Archive = "archive", e.FolderOpen = "folderOpen", e.Flag = "flag", e.DoubleArrowHorizontal = "doubleArrowHorizontal", e.Code = "code", e.List = "list", e.UserData = "userData", e.Text = "text", e.Check = "check", e.FullScreen = "fullScreen", e.Function = "function", e.Combine = "combine", e.Danger = "danger", e.Download = "download", e.Stop = "stop", e.Pause = "pause", e.JSON = "code", e.File = "attachment", e.Remove = "remove", e.AddBox = "addBox", e.Layers = "layers", e.Eye = "eye", e.EyeStrikethrough = "eyeStrikethrough", e.BoltStrikethrough = "boltStrikethrough", e.Drag = "drag", e.Lock = "lock", e.Javascript = "javascript", e.Python = "python", e.FullScreenExit = "fullScreenExit", e.Person = "person", e.People = "people", e.Group = "group", e.Arcee = "arcee", e.Cart = "cart", e.Google = "google", e.Timelaps = "timelaps", e.Token = "token", e.LeftSidebar = "leftSidebar", e.ShowSidePanel = "showSidePanel", e.HideSidePanel = "hideSidePanel", e.Money = "money", e.AddCreditCard = "addCreditCard", e.External = "external", e.ScreenView = "screenView", e.Activity = "activity", e.Purchase = "purchase", e.Key = "key", e.Discord = "discord", e.Dollar = "dollar", e.Temperature = "temperature", e.CheckCircle = "checkCircle", e.Server = "server", e.Retry = "retry", e.Provider = "provider", e.Github = "github", e.Price = "price", e.Calendar = "calendar", e.Terminal = "terminal", e.Chunk = "chunk", e.Markdown = "markdown", e.String = "string", e.Brain = "brain", e.SearchPage = "searchPage", e.Pin = "pin", e.Unpin = "unpin", e.ChatGpt = "chatGpt", e.Orchestrator = "orchestrator", e.Robot = "robot", e.ReadFile = "readFile", e.SearchFile = "searchFile", e.SearchFiles = "searchFiles", e.WriteCommand = "writeCommand", e.Clock = "clock", e.AddChat = "addChat", e.Goal = "goal", e;
}({}), cs = {
	checklist: Ai,
	features: Oi,
	publish: On,
	toolbox: jo,
	play: Ea,
	add: Oa,
	chat: Xi,
	home: gi,
	coursor: ca,
	hand: ui,
	order: Pi,
	zoomIn: rs,
	zoomOut: as,
	turnLeft: zo,
	turnRight: Aa,
	history: Pa,
	env: Go,
	addNote: Pr,
	controls: eo,
	arrowLeft: Sn,
	down: Kn,
	left: Jn,
	arrowRight: wn,
	right: Xn,
	top: Qn,
	grid: Ei,
	arrowTop: An,
	trash: No,
	arrowDown: vn,
	close: Zo,
	hamburger: Ki,
	bookOpen: Mn,
	ai: no,
	book: Pn,
	fileCopy: vr,
	fileCopyFilled: vr,
	fileUpload: Br,
	search: Ha,
	playHistory: ir,
	menuHorizontal: Or,
	hideSidebar: Mi,
	menuVertical: Er,
	tag: yo,
	tagAdd: xo,
	moon: oa,
	sun: _o,
	desktop: ia,
	doubleArrowsVertical: gn,
	financeMode: Hn,
	refresh: Ma,
	info: bi,
	folderCopy: Xr,
	important: er,
	globe: ni,
	filter: Qr,
	microphone: Qi,
	image: vi,
	attachment: va,
	plane: Wa,
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
	headphones: mi,
	bolt: ts,
	private: Xa,
	scheme: ei,
	repair: Yo,
	flow: qo,
	folder: Jr,
	folders: Xr,
	edit: co,
	addCircle: or,
	loader: Ri,
	gear: Ja,
	exit: Hi,
	archive: mn,
	folderOpen: Wr,
	flag: Hr,
	doubleArrowHorizontal: bn,
	code: io,
	list: Ii,
	userData: gr,
	text: Rr,
	check: Wn,
	fullScreen: Wi,
	function: oo,
	combine: mr,
	danger: Fo,
	download: wr,
	stop: ho,
	pause: ba,
	remove: na,
	addBox: uo,
	layers: wi,
	eye: Mr,
	eyeStrikethrough: Ar,
	boltStrikethrough: $o,
	drag: oi,
	lock: Bi,
	fullScreenExit: ea,
	person: Vo,
	people: Uo,
	group: ci,
	cart: Qa,
	timelaps: ko,
	token: fr,
	leftSidebar: fa,
	showSidePanel: ga,
	hideSidePanel: ma,
	money: br,
	addCreditCard: br,
	external: En,
	screenView: fn,
	activity: un,
	purchase: Qa,
	key: Si,
	dollar: Sr,
	temperature: Do,
	checkCircle: nr,
	server: Ka,
	retry: Ia,
	provider: ur,
	price: Sr,
	calendar: Bn,
	terminal: po,
	chunk: Ra,
	markdown: fi,
	string: Lo,
	brain: Rn,
	searchPage: Ir,
	pin: wa,
	unpin: Sa,
	orchestrator: ua,
	robot: In,
	readFile: Ba,
	searchFile: To,
	searchFiles: Kr,
	writeCommand: Co,
	clock: cr,
	addChat: Ji,
	goal: ii
}, ls = ({ iconName: e = "checklist", color: t, size: n = 20, strokeWidth: r = 1.75, className: i = "", style: a, ...o }) => {
	let s = t ? {
		"--icon-color": t,
		...a
	} : a, c = cs[e];
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
			d: os[e] ?? "",
			fill: "currentColor"
		})
	});
};
ls.Name = ss;
// src/app/atoms/loader/index.tsx
var us = /* @__PURE__ */ function(e) {
	return e[e.XSmall = 16] = "XSmall", e[e.Small = 20] = "Small", e[e.Medium = 24] = "Medium", e[e.MediumLarge = 28] = "MediumLarge", e[e.Large = 32] = "Large", e[e.X2Large = 36] = "X2Large", e[e.X3Large = 40] = "X3Large", e[e.XLarge = 48] = "XLarge", e;
}({}), ds = /* @__PURE__ */ function(e) {
	return e.Brand = "var(--color-fill-accent-primary)", e.Neutral = "var(--color-fill-basic-tertiary)", e.Destructive = "var(--color-fill-error-primary)", e.OnPrimary = "var(--color-fill-btn-primary)", e;
}({}), fs = ({ size: e = 48, variant: t = "var(--color-fill-basic-tertiary)", className: n = "", ...r }) => /* @__PURE__ */ k("div", {
	className: F("loader flex size-fit", n),
	...r,
	children: /* @__PURE__ */ k(ls, {
		iconName: ss.Loader,
		size: e,
		color: t
	})
});
fs.Size = us, fs.Variant = ds;
// src/app/lib/anchor.ts
var ps = /* @__PURE__ */ function(e) {
	return e.TopLeft = "top-left", e.TopCenter = "top-center", e.TopRight = "top-right", e.CenterRight = "center-right", e.RightTop = "right-top", e.BottomRight = "bottom-right", e.BottomCenter = "bottom-center", e.BottomLeft = "bottom-left", e.CenterLeft = "center-left", e;
}({}), ms = {
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
function hs(e) {
	let t = [];
	for (let n = e?.parentElement ?? null; n; n = n.parentElement) {
		let e = window.getComputedStyle(n);
		(e.overflowX !== "visible" || e.overflowY !== "visible") && t.push(n);
	}
	return t;
}
// src/app/hooks/useMediaQuery.ts
function gs(e) {
	let t = x(() => window.matchMedia(e), [e]), n = g((e) => (t.addEventListener("change", e), () => t.removeEventListener("change", e)), [t]), r = g(() => t.matches, [t]);
	return T(n, r, r);
}
var _s = () => gs("(min-width: 1280px)"), vs = () => gs("(max-width: 767.98px)"), ys = () => gs("(min-width: 768px) and (max-width: 1279.98px)"), bs = Object.defineProperty, xs = (e, t) => bs(e, "name", {
	value: t,
	configurable: !0
});
function Ss(e, t) {
	if (typeof e == "function") return e(t);
	e != null && (e.current = t);
}
xs(Ss, "setRef");
function Cs(...e) {
	return (t) => {
		let n = !1, r = e.map((e) => {
			let r = Ss(e, t);
			return !n && typeof r == "function" && (n = !0), r;
		});
		if (n) return () => {
			for (let t = 0; t < r.length; t++) {
				let n = r[t];
				typeof n == "function" ? n() : Ss(e[t], null);
			}
		};
	};
}
xs(Cs, "composeRefs");
function ws(...e) {
	return d.useCallback(Cs(...e), e);
}
xs(ws, "useComposedRefs");
// node_modules/@radix-ui/react-slot/dist/index.mjs
var Ts = Object.defineProperty, Es = (e, t) => Ts(e, "name", {
	value: t,
	configurable: !0
});
// @__NO_SIDE_EFFECTS__
function Ds(e) {
	let t = d.forwardRef((t, n) => {
		let { children: r, ...i } = t, a = null, o = !1, s = [];
		r = Rs(r), d.Children.forEach(r, (e) => {
			if (Ps(e)) {
				o = !0;
				let t = e, n = "child" in t.props ? t.props.child : t.props.children;
				for (; Is(n) && typeof Hs == "function";) n = Hs(n._payload);
				a = js(t, n), s.push(a?.props?.children);
			} else s.push(e);
		}), a ? a = d.cloneElement(a, void 0, s) : !o && d.Children.count(r) === 1 && d.isValidElement(r) && (a = r);
		let c = a ? Ns(a) : void 0, l = ws(n, c);
		if (!a) {
			if (r || r === 0) throw Error(o ? Vs(e) : Bs(e));
			return r;
		}
		let u = Ms(i, a.props ?? {});
		return a.type !== d.Fragment && (u.ref = n ? l : c), d.cloneElement(a, u);
	});
	return t.displayName = `${e}.Slot`, t;
}
Es(Ds, "createSlot");
var Os = /* @__PURE__ */ Ds("Slot"), ks = Symbol.for("radix.slottable");
// @__NO_SIDE_EFFECTS__
function As(e) {
	let t = /* @__PURE__ */ Es((e) => "child" in e ? e.children(e.child) : e.children, "Slottable");
	return t.displayName = `${e}.Slottable`, t.__radixId = ks, t;
}
Es(As, "createSlottable");
var js = /* @__PURE__ */ Es((e, t) => "child" in e.props ? d.isValidElement(t) ? d.cloneElement(t, void 0, e.props.children(t.props.children)) : null : d.isValidElement(t) ? t : null, "getSlottableElementFromSlottable");
function Ms(e, t) {
	let n = { ...t };
	for (let r in t) {
		let i = e[r], a = t[r];
		/^on[A-Z]/.test(r) ? i && a ? n[r] = (...e) => {
			let t = a(...e);
			return i(...e), t;
		} : i && (n[r] = i) : r === "style" ? n[r] = {
			...i,
			...a
		} : r === "className" ? n[r] = [i, a].filter(Boolean).join(" ") : r === "aria-describedby" && (n[r] = zs(a, i));
	}
	return {
		...e,
		...n
	};
}
Es(Ms, "mergeProps");
function Ns(e) {
	let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning;
	return n ? e.ref : (t = Object.getOwnPropertyDescriptor(e, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning, n ? e.props.ref : e.props.ref || e.ref);
}
Es(Ns, "getElementRef");
function Ps(e) {
	return d.isValidElement(e) && typeof e.type == "function" && "__radixId" in e.type && e.type.__radixId === ks;
}
Es(Ps, "isSlottable");
var Fs = Symbol.for("react.lazy");
function Is(e) {
	return typeof e == "object" && !!e && "$$typeof" in e && e.$$typeof === Fs && "_payload" in e && Ls(e._payload);
}
Es(Is, "isLazyComponent");
function Ls(e) {
	return typeof e == "object" && !!e && "then" in e;
}
Es(Ls, "isPromiseLike");
function Rs(e) {
	let t = e;
	for (; Is(t) && typeof Hs == "function";) t = Hs(t._payload);
	return t;
}
Es(Rs, "useUnwrappedLazy");
function zs(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
Es(zs, "concatAriaDescribedby");
var Bs = /* @__PURE__ */ Es((e) => `${e} failed to slot onto its children. Expected a single React element child or \`Slottable\`.`, "createSlotError"), Vs = /* @__PURE__ */ Es((e) => `${e} failed to slot onto its \`Slottable\`. Expected \`Slottable\` to receive a single React element child.`, "createSlottableError"), Hs = d.use, Us = Object.defineProperty, Ws = (e, t) => Us(e, "name", {
	value: t,
	configurable: !0
}), Gs = [
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
	let n = /* @__PURE__ */ Ds(`Primitive.${t}`), r = d.forwardRef((e, r) => {
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
function Ks(e, t) {
	e && ie.flushSync(() => e.dispatchEvent(t));
}
Ws(Ks, "dispatchDiscreteCustomEvent");
// node_modules/@radix-ui/react-visually-hidden/dist/index.mjs
var qs = Object.defineProperty, Js = (e, t) => qs(e, "name", {
	value: t,
	configurable: !0
}), Ys = Object.freeze({
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
}), Xs = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Js(function(e, t) {
	return /* @__PURE__ */ k(Gs.span, {
		...e,
		ref: t,
		style: {
			...Ys,
			...e.style
		}
	});
}, "VisuallyHidden")), Zs = Object.defineProperty, Qs = (e, t) => Zs(e, "name", {
	value: t,
	configurable: !0
});
// @__NO_SIDE_EFFECTS__
function $s(e, t) {
	let n = d.createContext(t);
	n.displayName = e + "Context";
	let r = /* @__PURE__ */ Qs((e) => {
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
	return Qs(i, "useContext"), [r, i];
}
Qs($s, "createContext");
// @__NO_SIDE_EFFECTS__
function ec(e, t = []) {
	let n = [];
	function r(t, r) {
		let i = d.createContext(r);
		i.displayName = t + "Context";
		let a = n.length;
		n = [...n, r];
		let o = /* @__PURE__ */ Qs((t) => {
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
		return Qs(s, "useContext"), [o, s];
	}
	Qs(r, "createContext");
	let i = /* @__PURE__ */ Qs(() => {
		let t = n.map((e) => d.createContext(e));
		return /* @__PURE__ */ Qs(function(n) {
			let r = n?.[e] || t;
			return d.useMemo(() => ({ [`__scope${e}`]: {
				...n,
				[e]: r
			} }), [n, r]);
		}, "useScope");
	}, "createScope");
	return i.scopeName = e, [r, tc(i, ...t)];
}
Qs(ec, "createContextScope");
function tc(...e) {
	let t = e[0];
	if (e.length === 1) return t;
	let n = /* @__PURE__ */ Qs(() => {
		let n = e.map((e) => ({
			useScope: e(),
			scopeName: e.scopeName
		}));
		return /* @__PURE__ */ Qs(function(e) {
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
Qs(tc, "composeContextScopes");
// node_modules/@radix-ui/react-use-layout-effect/dist/index.mjs
var nc = globalThis?.document ? d.useLayoutEffect : () => {}, rc = Object.defineProperty, ic = (e, t) => rc(e, "name", {
	value: t,
	configurable: !0
}), ac = !!(typeof window < "u" && window.document && window.document.createElement);
function oc(e, t, { checkForDefaultPrevented: n = !0 } = {}) {
	return /* @__PURE__ */ ic(function(r) {
		if (e?.(r), n === !1 || !r || !r.defaultPrevented) return t?.(r);
	}, "handleEvent");
}
ic(oc, "composeEventHandlers");
function sc(e) {
	if (!ac) throw Error("Cannot access window outside of the DOM");
	return e?.ownerDocument?.defaultView ?? window;
}
ic(sc, "getOwnerWindow");
function cc(e) {
	if (!ac) throw Error("Cannot access document outside of the DOM");
	return e?.ownerDocument ?? document;
}
ic(cc, "getOwnerDocument");
function lc(e, t = !1) {
	let { activeElement: n } = cc(e);
	if (!n?.nodeName) return null;
	if (uc(n) && n.contentDocument) return lc(n.contentDocument.body, t);
	if (t) {
		let e = n.getAttribute("aria-activedescendant");
		if (e) {
			let t = cc(n).getElementById(e);
			if (t) return t;
		}
	}
	return n;
}
ic(lc, "getActiveElement");
function uc(e) {
	return e.tagName === "IFRAME";
}
ic(uc, "isFrame");
// node_modules/@radix-ui/react-use-effect-event/dist/index.mjs
var dc = Object.defineProperty, fc = (e, t) => dc(e, "name", {
	value: t,
	configurable: !0
}), pc = d.useEffectEvent, mc = d.useInsertionEffect;
function hc(e) {
	if (typeof pc == "function") return pc(e);
	let t = d.useRef(() => {
		throw Error("Cannot call an event handler while rendering.");
	});
	return typeof mc == "function" ? mc(() => {
		t.current = e;
	}) : nc(() => {
		t.current = e;
	}), d.useMemo(() => ((...e) => t.current?.(...e)), []);
}
fc(hc, "useEffectEvent");
// node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
var gc = Object.defineProperty, _c = (e, t) => gc(e, "name", {
	value: t,
	configurable: !0
}), vc = d.useInsertionEffect || nc;
function yc({ prop: e, defaultProp: t, onChange: n = /* @__PURE__ */ _c(() => {}, "onChange"), caller: r }) {
	let [i, a, o] = bc({
		defaultProp: t,
		onChange: n
	}), s = e !== void 0;
	return [s ? e : i, d.useCallback((t) => {
		if (s) {
			let n = xc(t) ? t(e) : t;
			n !== e && o.current?.(n);
		} else a(t);
	}, [
		s,
		e,
		a,
		o
	])];
}
_c(yc, "useControllableState");
function bc({ defaultProp: e, onChange: t }) {
	let [n, r] = d.useState(e), i = d.useRef(n), a = d.useRef(t);
	return vc(() => {
		a.current = t;
	}, [t]), d.useEffect(() => {
		i.current !== n && (a.current?.(n), i.current = n);
	}, [n, i]), [
		n,
		r,
		a
	];
}
_c(bc, "useUncontrolledState");
function xc(e) {
	return typeof e == "function";
}
_c(xc, "isFunction");
var Sc = Symbol("RADIX:SYNC_STATE");
function Cc(e, t, n, r) {
	let { prop: i, defaultProp: a, onChange: o, caller: s } = t, c = i !== void 0, l = hc(o), u = [{
		...n,
		state: a
	}];
	r && u.push(r);
	let [f, p] = d.useReducer((t, n) => {
		if (n.type === Sc) return {
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
			type: Sc,
			state: i
		});
	}, [
		i,
		f.state,
		c
	]), [g, p];
}
_c(Cc, "useControllableStateReducer");
// node_modules/@radix-ui/react-presence/dist/index.mjs
var wc = Object.defineProperty, Tc = (e, t) => wc(e, "name", {
	value: t,
	configurable: !0
});
function Ec(e, t) {
	return d.useReducer((e, n) => t[e][n] ?? e, e);
}
Tc(Ec, "useStateMachine");
var Dc = /* @__PURE__ */ Tc((e) => {
	let { present: t, children: n } = e, r = Oc(t), i = typeof n == "function" ? n({ present: r.isPresent }) : d.Children.only(n), a = Ac(r.ref, Mc(i));
	return typeof n == "function" || r.isPresent ? d.cloneElement(i, { ref: a }) : null;
}, "Presence");
function Oc(e) {
	let [t, n] = d.useState(), r = d.useRef(null), i = d.useRef(e), a = d.useRef("none"), o = d.useRef(void 0), [s, c] = Ec(e ? "mounted" : "unmounted", {
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
		s === "mounted" ? (a.current = o.current ?? jc(r.current), o.current = void 0) : a.current = "none";
	}, [s]), nc(() => {
		let t = r.current, n = i.current;
		if (n !== e) {
			let r = a.current, s = jc(t);
			e ? (o.current = s, c("MOUNT")) : s === "none" || t?.display === "none" ? c("UNMOUNT") : c(n && r !== s ? "ANIMATION_OUT" : "UNMOUNT"), i.current = e;
		}
	}, [e, c]), nc(() => {
		if (t) {
			let e, n = t.ownerDocument.defaultView ?? window, o = /* @__PURE__ */ Tc((a) => {
				let o = jc(r.current).includes(CSS.escape(a.animationName));
				if (a.target === t && o && (c("ANIMATION_END"), !i.current)) {
					let r = t.style.animationFillMode;
					t.style.animationFillMode = "forwards", e = n.setTimeout(() => {
						t.style.animationFillMode === "forwards" && (t.style.animationFillMode = r);
					});
				}
			}, "handleAnimationEnd"), s = /* @__PURE__ */ Tc((e) => {
				e.target === t && (a.current = jc(r.current));
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
				r.current = t, o.current = jc(t);
			} else r.current = null;
			n(e);
		}, [])
	};
}
Tc(Oc, "usePresence");
function kc(e, t) {
	if (typeof e == "function") return e(t);
	e != null && (e.current = t);
}
Tc(kc, "setRef");
function Ac(...e) {
	let t = d.useRef(e);
	return t.current = e, d.useCallback((e) => {
		let n = t.current, r = !1, i = n.map((t) => {
			let n = kc(t, e);
			return !r && typeof n == "function" && (r = !0), n;
		});
		if (r) return () => {
			for (let e = 0; e < i.length; e++) {
				let t = i[e];
				typeof t == "function" ? t() : kc(n[e], null);
			}
		};
	}, []);
}
Tc(Ac, "useStableComposedRefs");
function jc(e) {
	return e?.animationName || "none";
}
Tc(jc, "getAnimationName");
function Mc(e) {
	let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning;
	return n ? e.ref : (t = Object.getOwnPropertyDescriptor(e, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning, n ? e.props.ref : e.props.ref || e.ref);
}
Tc(Mc, "getElementRef");
// node_modules/@radix-ui/react-id/dist/index.mjs
var Nc = Object.defineProperty, Pc = (e, t) => Nc(e, "name", {
	value: t,
	configurable: !0
}), Fc = d.useId || (() => void 0), Ic = 0;
function Lc(e) {
	let [t, n] = d.useState(Fc());
	return nc(() => {
		e || n((e) => e ?? String(Ic++));
	}, [e]), e || (t ? `radix-${t}` : "");
}
Pc(Lc, "useId");
// node_modules/@radix-ui/react-use-callback-ref/dist/index.mjs
var Rc = Object.defineProperty, zc = (e, t) => Rc(e, "name", {
	value: t,
	configurable: !0
}), Bc = d.useInsertionEffect;
function Vc(e) {
	let t = d.useRef(e);
	return typeof Bc == "function" ? Bc(() => {
		t.current = e;
	}) : nc(() => {
		t.current = e;
	}), d.useMemo(() => ((...e) => t.current?.(...e)), []);
}
zc(Vc, "useCallbackRef");
// node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
var Hc = Object.defineProperty, Uc = (e, t) => Hc(e, "name", {
	value: t,
	configurable: !0
}), Wc = "dismissableLayer.update", Gc = "dismissableLayer.pointerDownOutside", Kc = "dismissableLayer.focusOutside", qc, Jc = d.createContext({
	layers: /* @__PURE__ */ new Set(),
	layersWithOutsidePointerEventsDisabled: /* @__PURE__ */ new Set(),
	branches: /* @__PURE__ */ new Set(),
	dismissableSurfaces: /* @__PURE__ */ new Set()
}), Yc = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Uc(function(e, t) {
	let { disableOutsidePointerEvents: n = !1, deferPointerDownOutside: r = !1, onEscapeKeyDown: i, onPointerDownOutside: a, onFocusOutside: o, onInteractOutside: s, onDismiss: c, ...l } = e, u = d.useContext(Jc), [f, p] = d.useState(null), m = f?.ownerDocument ?? globalThis?.document, [, h] = d.useState({}), g = ws(t, p), _ = Array.from(u.layers), [v] = [...u.layersWithOutsidePointerEventsDisabled].slice(-1), y = v ? _.indexOf(v) : -1, b = f ? _.indexOf(f) : -1, x = u.layersWithOutsidePointerEventsDisabled.size > 0, S = b >= y, C = d.useRef(!1), w = Qc((e) => {
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
	}), T = $c((e) => {
		if (r && C.current) return;
		let t = e.target;
		[...u.branches].some((e) => e.contains(t)) || (o?.(e), s?.(e), e.defaultPrevented || c?.());
	}, m), ee = f ? b === _.length - 1 : !1, E = Vc((e) => {
		e.key === "Escape" && (i?.(e), !e.defaultPrevented && c && (e.preventDefault(), c()));
	});
	return d.useEffect(() => {
		if (ee) return m.addEventListener("keydown", E, { capture: !0 }), () => m.removeEventListener("keydown", E, { capture: !0 });
	}, [
		m,
		ee,
		E
	]), d.useEffect(() => {
		if (f) return n && (u.layersWithOutsidePointerEventsDisabled.size === 0 && (qc = m.body.style.pointerEvents, m.body.style.pointerEvents = "none"), u.layersWithOutsidePointerEventsDisabled.add(f)), u.layers.add(f), el(), () => {
			n && (u.layersWithOutsidePointerEventsDisabled.delete(f), u.layersWithOutsidePointerEventsDisabled.size === 0 && (m.body.style.pointerEvents = qc));
		};
	}, [
		f,
		m,
		n,
		u
	]), d.useEffect(() => () => {
		f && (u.layers.delete(f), u.layersWithOutsidePointerEventsDisabled.delete(f), el());
	}, [f, u]), d.useEffect(() => {
		let e = /* @__PURE__ */ Uc(() => h({}), "handleUpdate");
		return document.addEventListener(Wc, e), () => document.removeEventListener(Wc, e);
	}, []), /* @__PURE__ */ k(Gs.div, {
		...l,
		ref: g,
		style: {
			pointerEvents: x ? S ? "auto" : "none" : void 0,
			...e.style
		},
		onFocusCapture: oc(e.onFocusCapture, T.onFocusCapture),
		onBlurCapture: oc(e.onBlurCapture, T.onBlurCapture),
		onPointerDownCapture: oc(e.onPointerDownCapture, w.onPointerDownCapture)
	});
}, "DismissableLayer"));
function Xc() {
	let e = d.useContext(Jc), [t, n] = d.useState(null);
	return d.useEffect(() => {
		if (t) return e.dismissableSurfaces.add(t), () => {
			e.dismissableSurfaces.delete(t);
		};
	}, [t, e.dismissableSurfaces]), n;
}
Uc(Xc, "useDismissableLayerSurface");
var Zc = /* @__PURE__ */ Uc(() => !0, "IS_TRUE");
function Qc(e, t) {
	let { ownerDocument: n = globalThis?.document, deferPointerDownOutside: r = !1, isDeferredPointerDownOutsideRef: i, dismissableSurfaces: a, shouldHandlePointerDownOutside: o = Zc } = t, s = Vc(e), c = d.useRef(!1), l = d.useRef(!1), u = d.useRef(/* @__PURE__ */ new Map()), f = d.useRef(() => {});
	return d.useEffect(() => {
		function e() {
			l.current = !1, i.current = !1, u.current.clear();
		}
		Uc(e, "resetOutsideInteraction");
		function t() {
			return Array.from(u.current.values()).some(Boolean);
		}
		Uc(t, "isOutsideInteractionIntercepted");
		function d(e) {
			if (!l.current) return;
			let t = e.target;
			t instanceof Node && [...a].some((e) => e.contains(t)) || u.current.set(e.type, !0), e.type === "click" && window.setTimeout(() => {
				l.current && f.current();
			}, 0);
		}
		Uc(d, "handleInteractionCapture");
		function p(e) {
			l.current && u.current.set(e.type, !1);
		}
		Uc(p, "handleInteractionBubble");
		let m = /* @__PURE__ */ Uc((a) => {
			if (a.target && !c.current) {
				let d = function() {
					n.removeEventListener("click", f.current);
					let r = t();
					e(), r || tl(Gc, s, p, { discrete: !0 });
				};
				if (Uc(d, "handleAndDispatchPointerDownOutsideEvent"), !o(a.target)) {
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
	]), { onPointerDownCapture: /* @__PURE__ */ Uc(() => c.current = !0, "onPointerDownCapture") };
}
Uc(Qc, "usePointerDownOutside");
function $c(e, t = globalThis?.document) {
	let n = Vc(e), r = d.useRef(!1);
	return d.useEffect(() => {
		let e = /* @__PURE__ */ Uc((e) => {
			e.target && !r.current && tl(Kc, n, { originalEvent: e }, { discrete: !1 });
		}, "handleFocus");
		return t.addEventListener("focusin", e), () => t.removeEventListener("focusin", e);
	}, [t, n]), {
		onFocusCapture: /* @__PURE__ */ Uc(() => r.current = !0, "onFocusCapture"),
		onBlurCapture: /* @__PURE__ */ Uc(() => r.current = !1, "onBlurCapture")
	};
}
Uc($c, "useFocusOutside");
function el() {
	let e = new CustomEvent(Wc);
	document.dispatchEvent(e);
}
Uc(el, "dispatchUpdate");
function tl(e, t, n, { discrete: r }) {
	let i = n.originalEvent.target, a = new CustomEvent(e, {
		bubbles: !1,
		cancelable: !0,
		detail: n
	});
	t && i.addEventListener(e, t, { once: !0 }), r ? Ks(i, a) : i.dispatchEvent(a);
}
Uc(tl, "handleAndDispatchCustomEvent");
// node_modules/@radix-ui/react-focus-scope/dist/index.mjs
var nl = Object.defineProperty, rl = (e, t) => nl(e, "name", {
	value: t,
	configurable: !0
}), il = "focusScope.autoFocusOnMount", al = "focusScope.autoFocusOnUnmount", ol = {
	bubbles: !1,
	cancelable: !0
}, sl = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ rl(function(e, t) {
	let { loop: n = !1, trapped: r = !1, branches: i, onMountAutoFocus: a, onUnmountAutoFocus: o, ...s } = e, [c, l] = d.useState(null), u = Vc(a), f = Vc(o), p = d.useRef(null), m = ws(t, l), h = d.useRef(i);
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
				g(t) ? p.current = t : vl(p.current, { select: !0 });
			}, t = function(e) {
				if (_.paused || !c) return;
				let t = e.relatedTarget;
				t !== null && (g(t) || vl(p.current, { select: !0 }));
			}, n = function(e) {
				if (document.activeElement === document.body) for (let t of e) t.removedNodes.length > 0 && vl(c);
			};
			rl(e, "handleFocusIn"), rl(t, "handleFocusOut"), rl(n, "handleMutations"), document.addEventListener("focusin", e), document.addEventListener("focusout", t);
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
			yl.add(_);
			let e = document.activeElement;
			if (!c.contains(e)) {
				let t = new CustomEvent(il, ol);
				c.addEventListener(il, u), c.dispatchEvent(t), t.defaultPrevented || (fl(Sl(ml(c)), { select: !0 }), document.activeElement === e && vl(c));
			}
			return () => {
				c.removeEventListener(il, u);
				let t = c.ownerDocument, n = CustomEvent;
				setTimeout(() => {
					let r = new n(al, ol);
					c.addEventListener(al, f), c.dispatchEvent(r), r.defaultPrevented || vl(e ?? t.body, { select: !0 }), c.removeEventListener(al, f), yl.remove(_);
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
			let t = e.currentTarget, [r, a] = pl(t);
			r && a ? !e.shiftKey && i === a ? (e.preventDefault(), n && vl(r, { select: !0 })) : e.shiftKey && i === r && (e.preventDefault(), n && vl(a, { select: !0 })) : i === t && e.preventDefault();
		}
	}, [
		n,
		r,
		_.paused
	]);
	return /* @__PURE__ */ k(Gs.div, {
		tabIndex: -1,
		...s,
		ref: m,
		onKeyDown: v
	});
}, "FocusScope")), cl = d.createContext(null);
function ll({ registry: e, children: t }) {
	return e ? /* @__PURE__ */ k(cl.Provider, {
		value: e,
		children: t
	}) : t;
}
rl(ll, "FocusScopeBranchProvider");
function ul() {
	let [e, t] = d.useState([]);
	return {
		nodes: e,
		registry: d.useMemo(() => ({
			add: /* @__PURE__ */ rl((e) => t((t) => t.includes(e) ? t : [...t, e]), "add"),
			remove: /* @__PURE__ */ rl((e) => t((t) => t.filter((t) => t !== e)), "remove")
		}), [])
	};
}
rl(ul, "useFocusScopeBranchRegistry");
function dl(e) {
	let t = d.useContext(cl);
	d.useEffect(() => {
		if (e && t) return t.add(e), () => t.remove(e);
	}, [e, t]);
}
rl(dl, "useFocusScopeBranch");
function fl(e, { select: t = !1 } = {}) {
	let n = document.activeElement;
	for (let r of e) if (vl(r, { select: t }), document.activeElement !== n) return;
}
rl(fl, "focusFirst");
function pl(e) {
	let t = ml(e);
	return [hl(t, e), hl(t.reverse(), e)];
}
rl(pl, "getTabbableEdges");
function ml(e) {
	let t = [], n = e.ownerDocument.createTreeWalker(e, NodeFilter.SHOW_ELEMENT, { acceptNode: /* @__PURE__ */ rl((e) => {
		let t = e.tagName === "INPUT" && e.type === "hidden";
		return e.disabled || e.hidden || t ? NodeFilter.FILTER_SKIP : e.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
	}, "acceptNode") });
	for (; n.nextNode();) t.push(n.currentNode);
	return t;
}
rl(ml, "getTabbableCandidates");
function hl(e, t) {
	let n = typeof t.checkVisibility == "function" && t.checkVisibility({ checkVisibilityCSS: !0 });
	for (let r of e) if (!(n ? !r.checkVisibility({ checkVisibilityCSS: !0 }) : gl(r, { upTo: t }))) return r;
}
rl(hl, "findVisible");
function gl(e, { upTo: t }) {
	if (getComputedStyle(e).visibility === "hidden") return !0;
	for (; e;) {
		if (t !== void 0 && e === t) return !1;
		if (getComputedStyle(e).display === "none") return !0;
		e = e.parentElement;
	}
	return !1;
}
rl(gl, "isHidden");
function _l(e) {
	return e.tagName === "INPUT" && typeof e.select == "function";
}
rl(_l, "isSelectableInput");
function vl(e, { select: t = !1 } = {}) {
	if (e && e.focus) {
		let n = (e.ownerDocument ?? document).activeElement;
		e.focus({ preventScroll: !0 }), e !== n && _l(e) && t && e.select();
	}
}
rl(vl, "focus");
var yl = bl();
function bl() {
	let e = [];
	return {
		add(t) {
			let n = e[0];
			t !== n && n?.pause(), e = xl(e, t), e.unshift(t);
		},
		remove(t) {
			e = xl(e, t), e[0]?.resume();
		}
	};
}
rl(bl, "createFocusScopesStack");
function xl(e, t) {
	let n = [...e], r = n.indexOf(t);
	return r !== -1 && n.splice(r, 1), n;
}
rl(xl, "arrayRemove");
function Sl(e) {
	return e.filter((e) => e.tagName !== "A");
}
rl(Sl, "removeLinks");
// node_modules/@radix-ui/react-portal/dist/index.mjs
var Cl = Object.defineProperty, wl = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ ((e, t) => Cl(e, "name", {
	value: t,
	configurable: !0
}))(function(e, t) {
	let { container: n, ...r } = e, [i, a] = d.useState(!1);
	nc(() => a(!0), []);
	let o = n || i && globalThis?.document?.body;
	return o ? ie.createPortal(/* @__PURE__ */ k(Gs.div, {
		...r,
		ref: t
	}), o) : null;
}, "Portal")), Tl = Object.defineProperty, El = (e, t) => Tl(e, "name", {
	value: t,
	configurable: !0
}), Dl = 0, Ol = null;
function kl(e) {
	return Al(), e.children;
}
El(kl, "FocusGuards");
function Al() {
	d.useEffect(() => {
		Ol ||= {
			start: jl(),
			end: jl()
		};
		let { start: e, end: t } = Ol;
		return document.body.firstElementChild !== e && document.body.insertAdjacentElement("afterbegin", e), document.body.lastElementChild !== t && document.body.insertAdjacentElement("beforeend", t), Dl++, () => {
			Dl === 1 && (Ol?.start.remove(), Ol?.end.remove(), Ol = null), Dl = Math.max(0, Dl - 1);
		};
	}, []);
}
El(Al, "useFocusGuards");
function jl() {
	let e = document.createElement("span");
	return e.setAttribute("data-radix-focus-guard", ""), e.tabIndex = 0, e.style.outline = "none", e.style.opacity = "0", e.style.position = "fixed", e.style.pointerEvents = "none", e;
}
El(jl, "createFocusGuard");
// src/app/ui/radix-modal-stub.ts
function Ml(e) {
	throw Error(`${e} belongs to Radix's modal mode: keep the primitive non-modal and let the presentation layer stack lock scrolling and inert the background.`);
}
function Nl() {
	return Ml("RemoveScroll");
}
function Pl() {
	return Ml("hideOthers");
}
// node_modules/@radix-ui/react-dialog/dist/index.mjs
var Fl = Object.defineProperty, Il = (e, t) => Fl(e, "name", {
	value: t,
	configurable: !0
}), Ll = "Dialog", [Rl, zl] = /* @__PURE__ */ ec(Ll), [Bl, Vl] = Rl(Ll), Hl = /* @__PURE__ */ Il((e) => {
	let { __scopeDialog: t, children: n, open: r, defaultOpen: i, onOpenChange: a, modal: o = !0 } = e, s = d.useRef(null), c = d.useRef(null), { nodes: l, registry: u } = ul(), [f, p] = yc({
		prop: r,
		defaultProp: i ?? !1,
		onChange: a,
		caller: Ll
	}), [m, h] = d.useState(0), [g, _] = d.useState(0);
	return /* @__PURE__ */ k(Bl, {
		scope: t,
		triggerRef: s,
		contentRef: c,
		contentId: Lc(),
		titleId: Lc(),
		descriptionId: Lc(),
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
}, "Dialog"), Ul = "DialogPortal", [Wl, Gl] = Rl(Ul, { forceMount: void 0 }), Kl = /* @__PURE__ */ Il((e) => {
	let { __scopeDialog: t, forceMount: n, children: r, container: i } = e, a = Vl(Ul, t);
	return /* @__PURE__ */ k(Wl, {
		scope: t,
		forceMount: n,
		children: d.Children.map(r, (e) => /* @__PURE__ */ k(Dc, {
			present: n || a.open,
			children: /* @__PURE__ */ k(wl, {
				asChild: !0,
				container: i,
				children: e
			})
		}))
	});
}, "DialogPortal"), ql = "DialogContent", Jl = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Il(function(e, t) {
	let n = Gl(ql, e.__scopeDialog), { forceMount: r = n.forceMount, ...i } = e, a = Vl(ql, e.__scopeDialog);
	return /* @__PURE__ */ k(Dc, {
		present: r || a.open,
		children: a.modal ? /* @__PURE__ */ k(Yl, {
			...i,
			ref: t
		}) : /* @__PURE__ */ k(Xl, {
			...i,
			ref: t
		})
	});
}, "DialogContent")), Yl = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Il(function(e, t) {
	let n = Vl(ql, e.__scopeDialog), r = d.useRef(null), i = ws(t, n.contentRef, r);
	return d.useEffect(() => {
		let e = r.current;
		if (e) return Pl(e);
	}, []), /* @__PURE__ */ k(Zl, {
		...e,
		ref: i,
		trapFocus: n.open,
		disableOutsidePointerEvents: n.open,
		onCloseAutoFocus: oc(e.onCloseAutoFocus, (e) => {
			e.preventDefault(), n.triggerRef.current?.focus();
		}),
		onPointerDownOutside: oc(e.onPointerDownOutside, (e) => {
			let t = e.detail.originalEvent, n = t.button === 0 && t.ctrlKey === !0;
			(t.button === 2 || n) && e.preventDefault();
		}),
		onFocusOutside: oc(e.onFocusOutside, (e) => e.preventDefault())
	});
}, "DialogContentModal")), Xl = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Il(function(e, t) {
	let n = Vl(ql, e.__scopeDialog), r = d.useRef(!1), i = d.useRef(!1);
	return /* @__PURE__ */ k(Zl, {
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
}, "DialogContentNonModal")), Zl = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Il(function(e, t) {
	let { __scopeDialog: n, trapFocus: r, onOpenAutoFocus: i, onCloseAutoFocus: a, "aria-describedby": o, children: s, ...c } = e, l = Vl(ql, n);
	return Al(), /* @__PURE__ */ k(ll, {
		registry: l.branchRegistry,
		children: /* @__PURE__ */ k(sl, {
			asChild: !0,
			loop: !0,
			trapped: r,
			branches: l.branchNodes,
			onMountAutoFocus: i,
			onUnmountAutoFocus: a,
			children: /* @__PURE__ */ k(Yc, {
				role: "dialog",
				id: l.contentId,
				"aria-labelledby": l.titlePresent ? l.titleId : void 0,
				"aria-describedby": l.descriptionPresent ? eu(o, l.descriptionId) : o,
				"data-state": tu(l.open),
				...c,
				ref: t,
				deferPointerDownOutside: !0,
				onDismiss: () => l.onOpenChange(!1),
				children: s
			})
		})
	});
}, "DialogContentImpl")), Ql = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Il(function(e, t) {
	let { __scopeDialog: n, ...r } = e, i = Vl("DialogTitle", n), { setTitleCount: a } = i;
	return nc(() => (a((e) => e + 1), () => a((e) => e - 1)), [a]), /* @__PURE__ */ k(Gs.h2, {
		id: i.titleId,
		...r,
		ref: t
	});
}, "DialogTitle")), $l = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Il(function(e, t) {
	let { __scopeDialog: n, ...r } = e, i = Vl("DialogDescription", n), { setDescriptionCount: a } = i;
	return nc(() => (a((e) => e + 1), () => a((e) => e - 1)), [a]), /* @__PURE__ */ k(Gs.p, {
		id: i.descriptionId,
		...r,
		ref: t
	});
}, "DialogDescription"));
function eu(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
Il(eu, "concatAriaDescribedby");
function tu(e) {
	return e ? "open" : "closed";
}
Il(tu, "getState");
// node_modules/@radix-ui/react-use-size/dist/index.mjs
var nu = Object.defineProperty, ru = (e, t) => nu(e, "name", {
	value: t,
	configurable: !0
});
function iu(e) {
	let [t, n] = d.useState(void 0);
	return nc(() => {
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
ru(iu, "useSize");
// node_modules/@floating-ui/utils/dist/floating-ui.utils.mjs
var au = [
	"top",
	"right",
	"bottom",
	"left"
], ou = Math.min, su = Math.max, cu = Math.round, lu = Math.floor, uu = (e) => ({
	x: e,
	y: e
}), du = {
	left: "right",
	right: "left",
	bottom: "top",
	top: "bottom"
};
function fu(e, t, n) {
	return su(e, ou(t, n));
}
function pu(e, t) {
	return typeof e == "function" ? e(t) : e;
}
function mu(e) {
	return e.split("-")[0];
}
function hu(e) {
	return e.split("-")[1];
}
function gu(e) {
	return e === "x" ? "y" : "x";
}
function _u(e) {
	return e === "y" ? "height" : "width";
}
function vu(e) {
	let t = e[0];
	return t === "t" || t === "b" ? "y" : "x";
}
function yu(e) {
	return gu(vu(e));
}
function bu(e, t, n) {
	n === void 0 && (n = !1);
	let r = hu(e), i = yu(e), a = _u(i), o = i === "x" ? r === (n ? "end" : "start") ? "right" : "left" : r === "start" ? "bottom" : "top";
	return t.reference[a] > t.floating[a] && (o = ku(o)), [o, ku(o)];
}
function xu(e) {
	let t = ku(e);
	return [
		Su(e),
		t,
		Su(t)
	];
}
function Su(e) {
	return e.includes("start") ? e.replace("start", "end") : e.replace("end", "start");
}
var Cu = ["left", "right"], wu = ["right", "left"], Tu = ["top", "bottom"], Eu = ["bottom", "top"];
function Du(e, t, n) {
	switch (e) {
		case "top":
		case "bottom": return n ? t ? wu : Cu : t ? Cu : wu;
		case "left":
		case "right": return t ? Tu : Eu;
		default: return [];
	}
}
function Ou(e, t, n, r) {
	let i = hu(e), a = Du(mu(e), n === "start", r);
	return i && (a = a.map((e) => e + "-" + i), t && (a = a.concat(a.map(Su)))), a;
}
function ku(e) {
	let t = mu(e);
	return du[t] + e.slice(t.length);
}
function Au(e) {
	return {
		top: e.top ?? 0,
		right: e.right ?? 0,
		bottom: e.bottom ?? 0,
		left: e.left ?? 0
	};
}
function ju(e) {
	return typeof e == "number" ? {
		top: e,
		right: e,
		bottom: e,
		left: e
	} : Au(e);
}
function Mu(e) {
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
function Nu(e, t, n) {
	let { reference: r, floating: i } = e, a = vu(t), o = yu(t), s = _u(o), c = mu(t), l = a === "y", u = r.x + r.width / 2 - i.width / 2, d = r.y + r.height / 2 - i.height / 2, f = r[s] / 2 - i[s] / 2, p;
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
	let m = hu(t);
	return m && (p[o] += f * (m === "end" ? 1 : -1) * (n && l ? -1 : 1)), p;
}
async function Pu(e, t) {
	t === void 0 && (t = {});
	let { x: n, y: r, platform: i, rects: a, elements: o, strategy: s } = e, { boundary: c = "clippingAncestors", rootBoundary: l = "viewport", elementContext: u = "floating", altBoundary: d = !1, padding: f = 0 } = pu(t, e), p = ju(f), m = o[d ? u === "floating" ? "reference" : "floating" : u], h = Mu(await i.getClippingRect({
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
	}, y = Mu(i.convertOffsetParentRelativeRectToViewportRelativeRect ? await i.convertOffsetParentRelativeRectToViewportRelativeRect({
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
var Fu = 50, Iu = async (e, t, n) => {
	let { placement: r = "bottom", strategy: i = "absolute", middleware: a = [], platform: o } = n, s = o.detectOverflow ? o : {
		...o,
		detectOverflow: Pu
	}, c = await (o.isRTL == null ? void 0 : o.isRTL(t)), l = await o.getElementRects({
		reference: e,
		floating: t,
		strategy: i
	}), { x: u, y: d } = Nu(l, r, c), f = r, p = 0, m = {};
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
		}, x && p < Fu && (p++, typeof x == "object" && (x.placement && (f = x.placement), x.rects && (l = x.rects === !0 ? await o.getElementRects({
			reference: e,
			floating: t,
			strategy: i
		}) : x.rects), {x: u, y: d} = Nu(l, f, c)), n = -1);
	}
	return {
		x: u,
		y: d,
		placement: f,
		strategy: i,
		middlewareData: m
	};
}, Lu = (e) => ({
	name: "arrow",
	options: e,
	async fn(t) {
		let { x: n, y: r, placement: i, rects: a, platform: o, elements: s, middlewareData: c } = t, { element: l, padding: u = 0 } = pu(e, t) || {};
		if (l == null) return {};
		let d = ju(u), f = {
			x: n,
			y: r
		}, p = yu(i), m = _u(p), h = await o.getDimensions(l), g = p === "y", _ = g ? "top" : "left", v = g ? "bottom" : "right", y = g ? "clientHeight" : "clientWidth", b = a.reference[m] + a.reference[p] - f[p] - a.floating[m], x = f[p] - a.reference[p], S = await (o.getOffsetParent == null ? void 0 : o.getOffsetParent(l)), C = S ? S[y] : 0;
		C && await (o.isElement == null ? void 0 : o.isElement(S)) || (C = s.floating[y] || a.floating[m]);
		let w = b / 2 - x / 2, T = C / 2 - h[m] / 2 - 1, ee = ou(d[_], T), E = ou(d[v], T), te = C - h[m] - E, D = C / 2 - h[m] / 2 + w, O = fu(ee, D, te), ne = !c.arrow && hu(i) != null && D !== O && a.reference[m] / 2 - (D < ee ? ee : E) - h[m] / 2 < 0, k = ne ? D < ee ? D - ee : D - te : 0;
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
}), Ru = function(e) {
	return e === void 0 && (e = {}), {
		name: "flip",
		options: e,
		async fn(t) {
			var n;
			let { placement: r, middlewareData: i, rects: a, initialPlacement: o, platform: s, elements: c } = t, { mainAxis: l = !0, crossAxis: u = !0, fallbackPlacements: d, fallbackStrategy: f = "bestFit", fallbackAxisSideDirection: p = "none", flipAlignment: m = !0, ...h } = pu(e, t);
			if ((n = i.arrow) != null && n.alignmentOffset) return {};
			let g = mu(r), _ = vu(o), v = mu(o) === o, y = await (s.isRTL == null ? void 0 : s.isRTL(c.floating)), b = d || (v || !m ? [ku(o)] : xu(o)), x = p !== "none";
			!d && x && b.push(...Ou(o, m, p, y));
			let S = [o, ...b], C = await s.detectOverflow(t, h), w = [], T = i.flip?.overflows || [];
			if (l && w.push(C[g]), u) {
				let e = bu(r, a, y);
				w.push(C[e[0]], C[e[1]]);
			}
			if (T = [...T, {
				placement: r,
				overflows: w
			}], !w.every((e) => e <= 0)) {
				let e = (i.flip?.index || 0) + 1, t = S[e];
				if (t && (u !== "alignment" || _ === vu(t) || T.every((e) => vu(e.placement) !== _ || e.overflows[0] > 0))) return {
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
								let t = vu(e.placement);
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
function zu(e, t) {
	return {
		top: e.top - t.height,
		right: e.right - t.width,
		bottom: e.bottom - t.height,
		left: e.left - t.width
	};
}
function Bu(e) {
	return au.some((t) => e[t] >= 0);
}
var Vu = function(e) {
	return e === void 0 && (e = {}), {
		name: "hide",
		options: e,
		async fn(t) {
			let { rects: n, platform: r } = t, { strategy: i = "referenceHidden", ...a } = pu(e, t);
			switch (i) {
				case "referenceHidden": {
					let e = zu(await r.detectOverflow(t, {
						...a,
						elementContext: "reference"
					}), n.reference);
					return { data: {
						referenceHiddenOffsets: e,
						referenceHidden: Bu(e)
					} };
				}
				case "escaped": {
					let e = zu(await r.detectOverflow(t, {
						...a,
						altBoundary: !0
					}), n.floating);
					return { data: {
						escapedOffsets: e,
						escaped: Bu(e)
					} };
				}
				default: return {};
			}
		}
	};
}, Hu = /*#__PURE__*/ new Set(["left", "top"]);
async function Uu(e, t) {
	let { placement: n, platform: r, elements: i } = e, a = await (r.isRTL == null ? void 0 : r.isRTL(i.floating)), o = mu(n), s = hu(n), c = vu(n) === "y", l = Hu.has(o) ? -1 : 1, u = a && c ? -1 : 1, d = pu(t, e), { mainAxis: f, crossAxis: p, alignmentAxis: m } = typeof d == "number" ? {
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
var Wu = function(e) {
	return e === void 0 && (e = 0), {
		name: "offset",
		options: e,
		async fn(t) {
			var n;
			let { x: r, y: i, placement: a, middlewareData: o } = t, s = await Uu(t, e);
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
}, Gu = function(e) {
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
			} }, ...l } = pu(e, t), u = {
				x: n,
				y: r
			}, d = await a.detectOverflow(t, l), f = vu(i), p = gu(f), m = u[p], h = u[f], g = (e, t) => fu(t + d[e === "y" ? "top" : "left"], t, t - d[e === "y" ? "bottom" : "right"]);
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
}, Ku = function(e) {
	return e === void 0 && (e = {}), {
		options: e,
		fn(t) {
			let { x: n, y: r, placement: i, rects: a, middlewareData: o } = t, { offset: s = 0, mainAxis: c = !0, crossAxis: l = !0 } = pu(e, t), u = {
				x: n,
				y: r
			}, d = vu(i), f = gu(d), p = u[f], m = u[d], h = pu(s, t), g = typeof h == "number" ? {
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
				let e = f === "y" ? "width" : "height", t = Hu.has(mu(i)), n = a.reference[d] - a.floating[e] + (t && o.offset?.[d] || 0) + (t ? 0 : g.crossAxis), r = a.reference[d] + a.reference[e] + (t ? 0 : o.offset?.[d] || 0) - (t ? g.crossAxis : 0);
				m < n ? m = n : m > r && (m = r);
			}
			return {
				[f]: p,
				[d]: m
			};
		}
	};
}, qu = function(e) {
	return e === void 0 && (e = {}), {
		name: "size",
		options: e,
		async fn(t) {
			let { placement: n, rects: r, platform: i, elements: a } = t, { apply: o = () => {}, ...s } = pu(e, t), c = await i.detectOverflow(t, s), l = mu(n), u = hu(n), d = vu(n) === "y", { width: f, height: p } = r.floating, m, h;
			l === "top" || l === "bottom" ? (m = l, h = u === (await (i.isRTL == null ? void 0 : i.isRTL(a.floating)) ? "start" : "end") ? "left" : "right") : (h = l, m = u === "end" ? "top" : "bottom");
			let g = p - c.top - c.bottom, _ = f - c.left - c.right, v = ou(p - c[m], g), y = ou(f - c[h], _), b = t.middlewareData.shift, x = !b, S = v, C = y;
			b != null && b.enabled.x && (C = _), b != null && b.enabled.y && (S = g), x && !u && (d ? C = f - 2 * su(c.left, c.right) : S = p - 2 * su(c.top, c.bottom)), await o({
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
function Ju() {
	return typeof window < "u";
}
function Yu(e) {
	return Qu(e) ? (e.nodeName || "").toLowerCase() : "#document";
}
function Xu(e) {
	var t;
	return (e == null || (t = e.ownerDocument) == null ? void 0 : t.defaultView) || window;
}
function Zu(e) {
	return ((Qu(e) ? e.ownerDocument : e.document) || window.document)?.documentElement;
}
function Qu(e) {
	return Ju() ? e instanceof Node || e instanceof Xu(e).Node : !1;
}
function $u(e) {
	return Ju() ? e instanceof Element || e instanceof Xu(e).Element : !1;
}
function ed(e) {
	return Ju() ? e instanceof HTMLElement || e instanceof Xu(e).HTMLElement : !1;
}
function td(e) {
	return !Ju() || typeof ShadowRoot > "u" ? !1 : e instanceof ShadowRoot || e instanceof Xu(e).ShadowRoot;
}
function nd(e) {
	let { overflow: t, overflowX: n, overflowY: r, display: i } = pd(e);
	return /auto|scroll|overlay|hidden|clip/.test(t + r + n) && i !== "inline" && i !== "contents";
}
function rd(e) {
	return /^(table|td|th)$/.test(Yu(e));
}
function id(e) {
	try {
		if (e.matches(":popover-open")) return !0;
	} catch {}
	try {
		return e.matches(":modal");
	} catch {
		return !1;
	}
}
var ad = /transform|translate|scale|rotate|perspective|filter/, od = /paint|layout|strict|content/, sd = (e) => !!e && e !== "none", cd;
function ld(e) {
	let t = $u(e) ? pd(e) : e;
	return sd(t.transform) || sd(t.translate) || sd(t.scale) || sd(t.rotate) || sd(t.perspective) || !dd() && (sd(t.backdropFilter) || sd(t.filter)) || ad.test(t.willChange || "") || od.test(t.contain || "");
}
function ud(e) {
	let t = hd(e);
	for (; ed(t) && !fd(t);) {
		if (ld(t)) return t;
		if (id(t)) return null;
		t = hd(t);
	}
	return null;
}
function dd() {
	return cd ??= typeof CSS < "u" && CSS.supports && CSS.supports("-webkit-backdrop-filter", "none"), cd;
}
function fd(e) {
	return /^(html|body|#document)$/.test(Yu(e));
}
function pd(e) {
	return Xu(e).getComputedStyle(e);
}
function md(e) {
	return $u(e) ? {
		scrollLeft: e.scrollLeft,
		scrollTop: e.scrollTop
	} : {
		scrollLeft: e.scrollX,
		scrollTop: e.scrollY
	};
}
function hd(e) {
	if (Yu(e) === "html") return e;
	let t = e.assignedSlot || e.parentNode || td(e) && e.host || Zu(e);
	return td(t) ? t.host : t;
}
function gd(e) {
	let t = hd(e);
	return fd(t) ? (e.ownerDocument || e).body : ed(t) && nd(t) ? t : gd(t);
}
function _d(e, t, n) {
	t === void 0 && (t = []), n === void 0 && (n = !0);
	let r = gd(e), i = r === e.ownerDocument?.body, a = Xu(r);
	if (i) {
		let e = vd(a);
		return t.concat(a, a.visualViewport || [], nd(r) ? r : [], e && n ? _d(e) : []);
	}
	return t.concat(r, _d(r, [], n));
}
function vd(e) {
	return e.parent && Object.getPrototypeOf(e.parent) ? e.frameElement : null;
}
// node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs
function yd(e) {
	let t = pd(e), n = parseFloat(t.width) || 0, r = parseFloat(t.height) || 0, i = ed(e), a = i ? e.offsetWidth : n, o = i ? e.offsetHeight : r, s = cu(n) !== a || cu(r) !== o;
	return s && (n = a, r = o), {
		width: n,
		height: r,
		$: s
	};
}
function bd(e) {
	return $u(e) ? e : e.contextElement;
}
function xd(e) {
	let t = bd(e);
	if (!ed(t)) return uu(1);
	let n = t.getBoundingClientRect(), { width: r, height: i, $: a } = yd(t), o = (a ? cu(n.width) : n.width) / r, s = (a ? cu(n.height) : n.height) / i;
	return o && Number.isFinite(o) || (o = 1), s && Number.isFinite(s) || (s = 1), {
		x: o,
		y: s
	};
}
var Sd = /*#__PURE__*/ uu(0);
function Cd(e) {
	let t = Xu(e);
	return !dd() || !t.visualViewport ? Sd : {
		x: t.visualViewport.offsetLeft,
		y: t.visualViewport.offsetTop
	};
}
function wd(e, t, n) {
	return t === void 0 && (t = !1), !!n && t && n === Xu(e);
}
function Td(e, t, n, r) {
	t === void 0 && (t = !1), n === void 0 && (n = !1);
	let i = e.getBoundingClientRect(), a = bd(e), o = uu(1);
	t && (r ? $u(r) && (o = xd(r)) : o = xd(e));
	let s = wd(a, n, r) ? Cd(a) : uu(0), c = (i.left + s.x) / o.x, l = (i.top + s.y) / o.y, u = i.width / o.x, d = i.height / o.y;
	if (a && r) {
		let e = Xu(a), t = $u(r) ? Xu(r) : r, n = e, i = vd(n);
		for (; i && t !== n;) {
			let e = xd(i), t = i.getBoundingClientRect(), r = pd(i), a = t.left + (i.clientLeft + parseFloat(r.paddingLeft)) * e.x, o = t.top + (i.clientTop + parseFloat(r.paddingTop)) * e.y;
			c *= e.x, l *= e.y, u *= e.x, d *= e.y, c += a, l += o, n = Xu(i), i = vd(n);
		}
	}
	return Mu({
		width: u,
		height: d,
		x: c,
		y: l
	});
}
function Ed(e, t) {
	let n = md(e).scrollLeft;
	return t ? t.left + n : Td(Zu(e)).left + n;
}
function Dd(e, t) {
	let n = e.getBoundingClientRect();
	return {
		x: n.left + t.scrollLeft - Ed(e, n),
		y: n.top + t.scrollTop
	};
}
function Od(e) {
	let { elements: t, rect: n, offsetParent: r, strategy: i } = e, a = i === "fixed", o = Zu(r), s = t ? id(t.floating) : !1;
	if (r === o || s && a) return n;
	let c = {
		scrollLeft: 0,
		scrollTop: 0
	}, l = uu(1), u = uu(0), d = ed(r);
	if ((d || !a) && ((Yu(r) !== "body" || nd(o)) && (c = md(r)), d)) {
		let e = Td(r);
		l = xd(r), u.x = e.x + r.clientLeft, u.y = e.y + r.clientTop;
	}
	let f = o && !d && !a ? Dd(o, c) : uu(0);
	return {
		width: n.width * l.x,
		height: n.height * l.y,
		x: n.x * l.x - c.scrollLeft * l.x + u.x + f.x,
		y: n.y * l.y - c.scrollTop * l.y + u.y + f.y
	};
}
function kd(e) {
	return e.getClientRects ? Array.from(e.getClientRects()) : [];
}
function Ad(e) {
	let t = md(e), n = e.ownerDocument.body, r = su(e.scrollWidth, e.clientWidth, n.scrollWidth, n.clientWidth), i = su(e.scrollHeight, e.clientHeight, n.scrollHeight, n.clientHeight), a = -t.scrollLeft + Ed(e), o = -t.scrollTop;
	return pd(n).direction === "rtl" && (a += su(e.clientWidth, n.clientWidth) - r), {
		width: r,
		height: i,
		x: a,
		y: o
	};
}
var jd = 25;
function Md(e, t, n) {
	n === void 0 && (n = "viewport");
	let r = n === "layoutViewport", i = Xu(e), a = Zu(e), o = i.visualViewport, s = a.clientWidth, c = a.clientHeight, l = 0, u = 0;
	if (o) {
		let e = !dd() || t === "fixed";
		r ? e || (l = -o.offsetLeft, u = -o.offsetTop) : (s = o.width, c = o.height, e && (l = o.offsetLeft, u = o.offsetTop));
	}
	if (Ed(a) <= 0) {
		let e = a.ownerDocument, t = e.body, n = getComputedStyle(t), r = e.compatMode === "CSS1Compat" && parseFloat(n.marginLeft) + parseFloat(n.marginRight) || 0, i = Math.abs(a.clientWidth - t.clientWidth - r), o = getComputedStyle(a).scrollbarGutter === "stable both-edges" ? i / 2 : i;
		o <= jd && (s -= o);
	}
	return {
		width: s,
		height: c,
		x: l,
		y: u
	};
}
function Nd(e, t) {
	let n = Td(e, !0, t === "fixed"), r = n.top + e.clientTop, i = n.left + e.clientLeft, a = xd(e);
	return {
		width: e.clientWidth * a.x,
		height: e.clientHeight * a.y,
		x: i * a.x,
		y: r * a.y
	};
}
function Pd(e, t, n) {
	let r;
	if (t === "viewport" || t === "layoutViewport") r = Md(e, n, t);
	else if (t === "document") r = Ad(Zu(e));
	else if ($u(t)) r = Nd(t, n);
	else {
		let n = Cd(e);
		r = {
			x: t.x - n.x,
			y: t.y - n.y,
			width: t.width,
			height: t.height
		};
	}
	return Mu(r);
}
function Fd(e, t) {
	let n = t.get(e);
	if (n) return n;
	let r = _d(e, [], !1).filter((e) => $u(e) && Yu(e) !== "body"), i = null, a = pd(e).position === "fixed", o = a ? hd(e) : e;
	for (; $u(o) && !fd(o);) {
		let e = pd(o), t = ld(o), n = i ? i.position : a ? "fixed" : "";
		!t && (n === "fixed" || n === "absolute" && e.position === "static") ? r = r.filter((e) => e !== o) : i = e, o = hd(o);
	}
	return t.set(e, r), r;
}
function Id(e) {
	let { element: t, boundary: n, rootBoundary: r, strategy: i } = e, a = [...n === "clippingAncestors" ? id(t) ? [] : Fd(t, this._c) : [].concat(n), r], o = Pd(t, a[0], i), s = o.top, c = o.right, l = o.bottom, u = o.left;
	for (let e = 1; e < a.length; e++) {
		let n = Pd(t, a[e], i);
		s = su(n.top, s), c = ou(n.right, c), l = ou(n.bottom, l), u = su(n.left, u);
	}
	return {
		width: c - u,
		height: l - s,
		x: u,
		y: s
	};
}
function Ld(e) {
	let { width: t, height: n } = yd(e);
	return {
		width: t,
		height: n
	};
}
function Rd(e, t, n) {
	let r = ed(t), i = Zu(t), a = n === "fixed", o = Td(e, !0, a, t), s = {
		scrollLeft: 0,
		scrollTop: 0
	}, c = uu(0);
	if ((r || !a) && ((Yu(t) !== "body" || nd(i)) && (s = md(t)), r)) {
		let e = Td(t, !0, a, t);
		c.x = e.x + t.clientLeft, c.y = e.y + t.clientTop;
	}
	!r && i && (c.x = Ed(i));
	let l = i && !r && !a ? Dd(i, s) : uu(0);
	return {
		x: o.left + s.scrollLeft - c.x - l.x,
		y: o.top + s.scrollTop - c.y - l.y,
		width: o.width,
		height: o.height
	};
}
function zd(e) {
	return pd(e).position === "static";
}
function Bd(e, t) {
	if (!ed(e) || pd(e).position === "fixed") return null;
	if (t) return t(e);
	let n = e.offsetParent;
	return Zu(e) === n && (n = n.ownerDocument.body), n;
}
function Vd(e, t) {
	let n = Xu(e);
	if (id(e)) return n;
	if (!ed(e)) {
		let t = hd(e);
		for (; t && !fd(t);) {
			if ($u(t) && !zd(t)) return t;
			t = hd(t);
		}
		return n;
	}
	let r = Bd(e, t);
	for (; r && rd(r) && zd(r);) r = Bd(r, t);
	return r && fd(r) && zd(r) && !ld(r) ? n : r || ud(e) || n;
}
var Hd = async function(e) {
	let t = this.getOffsetParent || Vd, n = this.getDimensions, r = await n(e.floating);
	return {
		reference: Rd(e.reference, await t(e.floating), e.strategy),
		floating: {
			x: 0,
			y: 0,
			width: r.width,
			height: r.height
		}
	};
};
function Ud(e) {
	return pd(e).direction === "rtl";
}
var Wd = {
	convertOffsetParentRelativeRectToViewportRelativeRect: Od,
	getDocumentElement: Zu,
	getClippingRect: Id,
	getOffsetParent: Vd,
	getElementRects: Hd,
	getClientRects: kd,
	getDimensions: Ld,
	getScale: xd,
	isElement: $u,
	isRTL: Ud
};
function Gd(e, t) {
	return e.x === t.x && e.y === t.y && e.width === t.width && e.height === t.height;
}
function Kd(e, t, n) {
	let r = null, i, a = Zu(e);
	function o() {
		var e;
		clearTimeout(i), (e = r) == null || e.disconnect(), r = null;
	}
	function s(n, c) {
		n === void 0 && (n = !1), c === void 0 && (c = 1), o();
		let l = e.getBoundingClientRect(), { left: u, top: d, width: f, height: p } = l;
		if (n || t(), !f || !p) return;
		let m = lu(d), h = lu(a.clientWidth - (u + f)), g = lu(a.clientHeight - (d + p)), _ = lu(u), v = {
			rootMargin: -m + "px " + -h + "px " + -g + "px " + -_ + "px",
			threshold: su(0, ou(1, c)) || 1
		}, y = !0;
		function b(t) {
			let n = t[0].intersectionRatio;
			if (!Gd(l, e.getBoundingClientRect())) return s();
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
	let c = Xu(e), l = () => s(n);
	return c.addEventListener("resize", l), s(!0), () => {
		c.removeEventListener("resize", l), o();
	};
}
function qd(e, t, n, r) {
	r === void 0 && (r = {});
	let { ancestorScroll: i = !0, ancestorResize: a = !0, elementResize: o = typeof ResizeObserver == "function", layoutShift: s = typeof IntersectionObserver == "function", animationFrame: c = !1 } = r, l = bd(e), u = i || a ? [...l ? _d(l) : [], ...t ? _d(t) : []] : [];
	u.forEach((e) => {
		i && e.addEventListener("scroll", n), a && e.addEventListener("resize", n);
	});
	let d = l && s ? Kd(l, n, a) : null, f = -1, p = null;
	o && (p = new ResizeObserver((e) => {
		let [r] = e;
		r && r.target === l && p && t && (p.unobserve(t), cancelAnimationFrame(f), f = requestAnimationFrame(() => {
			var e;
			(e = p) == null || e.observe(t);
		})), n();
	}), l && !c && p.observe(l), t && p.observe(t));
	let m, h = c ? Td(e) : null;
	c && g();
	function g() {
		let t = Td(e);
		h && !Gd(h, t) && n(), h = t, m = requestAnimationFrame(g);
	}
	return n(), () => {
		var e;
		u.forEach((e) => {
			i && e.removeEventListener("scroll", n), a && e.removeEventListener("resize", n);
		}), d?.(), (e = p) == null || e.disconnect(), p = null, c && cancelAnimationFrame(m);
	};
}
var Jd = Wu, Yd = Gu, Xd = Ru, Zd = qu, Qd = Vu, $d = Lu, ef = Ku, tf = (e, t, n) => {
	let r = /* @__PURE__ */ new Map(), i = n ?? {}, a = {
		...Wd,
		...i.platform,
		_c: r
	};
	return Iu(e, t, {
		...i,
		platform: a
	});
}, nf = typeof document < "u" ? b : function() {};
function rf(e, t) {
	if (e === t) return !0;
	if (typeof e != typeof t) return !1;
	if (typeof e == "function" && e.toString() === t.toString()) return !0;
	let n, r, i;
	if (e && t && typeof e == "object") {
		if (Array.isArray(e)) {
			if (n = e.length, n !== t.length) return !1;
			for (r = n; r-- !== 0;) if (!rf(e[r], t[r])) return !1;
			return !0;
		}
		if (i = Object.keys(e), n = i.length, n !== Object.keys(t).length) return !1;
		for (r = n; r-- !== 0;) if (!{}.hasOwnProperty.call(t, i[r])) return !1;
		for (r = n; r-- !== 0;) {
			let n = i[r];
			if (!(n === "_owner" && e.$$typeof) && !rf(e[n], t[n])) return !1;
		}
		return !0;
	}
	return e !== e && t !== t;
}
function af(e) {
	return typeof window > "u" ? 1 : (e.ownerDocument.defaultView || window).devicePixelRatio || 1;
}
function of(e, t) {
	let n = af(e);
	return Math.round(t * n) / n;
}
function sf(e) {
	let t = d.useRef(e);
	return nf(() => {
		t.current = e;
	}), t;
}
function cf(e) {
	e === void 0 && (e = {});
	let { placement: t = "bottom", strategy: n = "absolute", middleware: r = [], platform: i, elements: { reference: a, floating: o } = {}, transform: s = !0, whileElementsMounted: c, open: l } = e, [u, f] = d.useState({
		x: 0,
		y: 0,
		strategy: n,
		placement: t,
		middlewareData: {},
		isPositioned: !1
	}), [p, m] = d.useState(r);
	rf(p, r) || m(r);
	let [h, g] = d.useState(null), [_, v] = d.useState(null), y = d.useCallback((e) => {
		e !== C.current && (C.current = e, g(e));
	}, []), b = d.useCallback((e) => {
		e !== w.current && (w.current = e, v(e));
	}, []), x = a || h, S = o || _, C = d.useRef(null), w = d.useRef(null), T = d.useRef(u), ee = c != null, E = sf(c), te = sf(i), D = sf(l), O = d.useCallback(() => {
		if (!C.current || !w.current) return;
		let e = {
			placement: t,
			strategy: n,
			middleware: p
		};
		te.current && (e.platform = te.current), tf(C.current, w.current, e).then((e) => {
			let t = {
				...e,
				isPositioned: D.current !== !1
			};
			ne.current && !rf(T.current, t) && (T.current = t, ie.flushSync(() => {
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
	nf(() => {
		l === !1 && T.current.isPositioned && (T.current.isPositioned = !1, f((e) => ({
			...e,
			isPositioned: !1
		})));
	}, [l]);
	let ne = d.useRef(!1);
	nf(() => (ne.current = !0, () => {
		ne.current = !1;
	}), []), nf(() => {
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
		let t = of(A.floating, u.x), r = of(A.floating, u.y);
		return s ? {
			...e,
			transform: "translate(" + t + "px, " + r + "px)",
			...af(A.floating) >= 1.5 && { willChange: "transform" }
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
var lf = (e) => {
	function t(e) {
		return {}.hasOwnProperty.call(e, "current");
	}
	return {
		name: "arrow",
		options: e,
		fn(n) {
			let { element: r, padding: i } = typeof e == "function" ? e(n) : e;
			return r && t(r) ? r.current == null ? {} : $d({
				element: r.current,
				padding: i
			}).fn(n) : r ? $d({
				element: r,
				padding: i
			}).fn(n) : {};
		}
	};
}, uf = (e, t) => {
	let n = Jd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, df = (e, t) => {
	let n = Yd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, ff = (e, t) => ({
	fn: ef(e).fn,
	options: [e, t]
}), pf = (e, t) => {
	let n = Xd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, mf = (e, t) => {
	let n = Zd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, hf = (e, t) => {
	let n = Qd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, gf = (e, t) => {
	let n = lf(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, _f = Object.defineProperty, vf = (e, t) => _f(e, "name", {
	value: t,
	configurable: !0
}), yf = {
	Partial: "partial",
	Always: "always"
}, bf = {
	Optimized: "optimized",
	Always: "always"
}, xf = "Popper", [Sf, Cf] = /* @__PURE__ */ ec(xf), [wf, Tf] = Sf(xf), Ef = /* @__PURE__ */ vf((e) => {
	let { __scopePopper: t, children: n } = e, [r, i] = d.useState(null), [a, o] = d.useState(void 0);
	return /* @__PURE__ */ k(wf, {
		scope: t,
		anchor: r,
		onAnchorChange: i,
		placementState: a,
		setPlacementState: o,
		children: n
	});
}, "Popper"), Df = "PopperAnchor", Of = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ vf(function(e, t) {
	let { __scopePopper: n, virtualRef: r, ...i } = e, a = Tf(Df, n), o = d.useRef(null), s = a.onAnchorChange, c = ws(t, d.useCallback((e) => {
		o.current = e, e && s(e);
	}, [s])), l = d.useRef(null);
	d.useEffect(() => {
		if (!r) return;
		let e = l.current;
		l.current = r.current, e !== l.current && s(l.current);
	});
	let u = a.placementState && Ff(a.placementState), f = u?.[0], p = u?.[1];
	return r ? null : /* @__PURE__ */ k(Gs.div, {
		"data-radix-popper-side": f,
		"data-radix-popper-align": p,
		...i,
		ref: c
	});
}, "PopperAnchor")), kf = "PopperContent", [Af, jf] = Sf(kf), Mf = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ vf(function(e, t) {
	let { __scopePopper: n, side: r = "bottom", sideOffset: i = 0, align: a = "center", alignOffset: o = 0, arrowPadding: s = 0, avoidCollisions: c = !0, collisionBoundary: l = [], collisionPadding: u = 0, sticky: f = yf.Partial, hideWhenDetached: p = !1, updatePositionStrategy: m = bf.Optimized, onPlaced: h, ...g } = e, _ = Tf(kf, n), [v, y] = d.useState(null), b = ws(t, y), [x, S] = d.useState(null), C = iu(x), w = C?.width ?? 0, T = C?.height ?? 0, ee = r + (a === "center" ? "" : "-" + a), E = typeof u == "number" ? u : {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		...u
	}, te = Array.isArray(l) ? l : [l], D = te.length > 0, O = {
		padding: E,
		boundary: te.filter(Nf),
		altBoundary: D
	}, { refs: ne, floatingStyles: A, placement: re, isPositioned: ie, middlewareData: j } = cf({
		strategy: "fixed",
		placement: ee,
		whileElementsMounted: /* @__PURE__ */ vf((...e) => qd(...e, { animationFrame: m === bf.Always }), "whileElementsMounted"),
		elements: { reference: _.anchor },
		middleware: [
			uf({
				mainAxis: i + T,
				alignmentAxis: o
			}),
			c && df({
				mainAxis: !0,
				crossAxis: !1,
				...f === yf.Partial ? { limiter: ff() } : {},
				...O
			}),
			c && pf({ ...O }),
			mf({
				...O,
				apply: /* @__PURE__ */ vf(({ elements: e, rects: t, availableWidth: n, availableHeight: r }) => {
					let { width: i, height: a } = t.reference, o = e.floating.style;
					o.setProperty("--radix-popper-available-width", `${n}px`), o.setProperty("--radix-popper-available-height", `${r}px`), o.setProperty("--radix-popper-anchor-width", `${i}px`), o.setProperty("--radix-popper-anchor-height", `${a}px`);
				}, "apply")
			}),
			x && gf({
				element: x,
				padding: s
			}),
			Pf({
				arrowWidth: w,
				arrowHeight: T
			}),
			p && hf(D ? {
				strategy: "referenceHidden",
				...O
			} : {
				strategy: "referenceHidden",
				padding: O.padding,
				altBoundary: O.altBoundary
			})
		]
	}), ae = _.setPlacementState;
	nc(() => (ae(re), () => {
		ae(void 0);
	}), [re, ae]);
	let [oe, se] = Ff(re), ce = Vc(h);
	nc(() => {
		ie && ce?.();
	}, [ie, ce]);
	let le = j.arrow?.x, ue = j.arrow?.y, de = j.arrow?.centerOffset !== 0, [fe, pe] = d.useState();
	return nc(() => {
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
		children: /* @__PURE__ */ k(Af, {
			scope: n,
			placedSide: oe,
			placedAlign: se,
			onArrowChange: S,
			arrowX: le,
			arrowY: ue,
			shouldHideArrow: de,
			children: /* @__PURE__ */ k(Gs.div, {
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
function Nf(e) {
	return e !== null;
}
vf(Nf, "isNotNull");
var Pf = /* @__PURE__ */ vf((e) => ({
	name: "transformOrigin",
	options: e,
	fn(t) {
		let { placement: n, rects: r, middlewareData: i } = t, a = i.arrow?.centerOffset !== 0, o = a ? 0 : e.arrowWidth, s = a ? 0 : e.arrowHeight, [c, l] = Ff(n), u = {
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
function Ff(e) {
	let [t, n = "center"] = e.split("-");
	return [t, n];
}
vf(Ff, "getSideAndAlignFromPlacement");
// node_modules/@radix-ui/react-popover/dist/index.mjs
var If = Object.defineProperty, Lf = (e, t) => If(e, "name", {
	value: t,
	configurable: !0
}), Rf = "Popover", [zf, Bf] = /* @__PURE__ */ ec(Rf, [Cf]), Vf = Cf(), [Hf, Uf] = zf(Rf), Wf = /* @__PURE__ */ Lf((e) => {
	let { __scopePopover: t, children: n, open: r, defaultOpen: i, onOpenChange: a, modal: o = !1 } = e, s = Vf(t), c = d.useRef(null), [l, u] = d.useState(!1), [f, p] = d.useState(0), [m, h] = d.useState(0), [g, _] = yc({
		prop: r,
		defaultProp: i ?? !1,
		onChange: a,
		caller: Rf
	});
	return /* @__PURE__ */ k(Ef, {
		...s,
		children: /* @__PURE__ */ k(Hf, {
			scope: t,
			contentId: Lc(),
			titleId: Lc(),
			descriptionId: Lc(),
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
}, "Popover"), Gf = "PopoverAnchor", Kf = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Lf(function(e, t) {
	let { __scopePopover: n, ...r } = e, i = Uf(Gf, n), a = Vf(n), { onCustomAnchorAdd: o, onCustomAnchorRemove: s } = i;
	return d.useEffect(() => (o(), () => s()), [o, s]), /* @__PURE__ */ k(Of, {
		...a,
		...r,
		ref: t
	});
}, "PopoverAnchor")), qf = "PopoverPortal", [Jf, Yf] = zf(qf, { forceMount: void 0 }), Xf = /* @__PURE__ */ Lf((e) => {
	let { __scopePopover: t, forceMount: n, children: r, container: i } = e, a = Uf(qf, t);
	return /* @__PURE__ */ k(Jf, {
		scope: t,
		forceMount: n,
		children: /* @__PURE__ */ k(Dc, {
			present: n || a.open,
			children: /* @__PURE__ */ k(wl, {
				asChild: !0,
				container: i,
				children: r
			})
		})
	});
}, "PopoverPortal"), Zf = "PopoverContent", Qf = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Lf(function(e, t) {
	let n = Yf(Zf, e.__scopePopover), { forceMount: r = n.forceMount, ...i } = e, a = Uf(Zf, e.__scopePopover);
	return /* @__PURE__ */ k(Dc, {
		present: r || a.open,
		children: a.modal ? /* @__PURE__ */ k(ep, {
			...i,
			ref: t
		}) : /* @__PURE__ */ k(tp, {
			...i,
			ref: t
		})
	});
}, "PopoverContent")), $f = /* @__PURE__ */ Ds("PopoverContent.RemoveScroll"), ep = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Lf(function(e, t) {
	let n = Uf(Zf, e.__scopePopover), r = d.useRef(null), i = ws(t, r), a = d.useRef(!1), { nodes: o, registry: s } = ul();
	return d.useEffect(() => {
		let e = r.current;
		if (e) return Pl(e);
	}, []), /* @__PURE__ */ k(Nl, {
		as: $f,
		allowPinchZoom: !0,
		shards: d.useMemo(() => [r, ...o.map((e) => ({ current: e }))], [r, o]),
		children: /* @__PURE__ */ k(np, {
			...e,
			ref: i,
			branchNodes: o,
			branchRegistry: s,
			trapFocus: n.open,
			disableOutsidePointerEvents: !0,
			onCloseAutoFocus: oc(e.onCloseAutoFocus, (e) => {
				e.preventDefault(), a.current || n.triggerRef.current?.focus();
			}),
			onPointerDownOutside: oc(e.onPointerDownOutside, (e) => {
				let t = e.detail.originalEvent, n = t.button === 0 && t.ctrlKey === !0, r = t.button === 2 || n;
				a.current = r;
			}, { checkForDefaultPrevented: !1 }),
			onFocusOutside: oc(e.onFocusOutside, (e) => e.preventDefault(), { checkForDefaultPrevented: !1 })
		})
	});
}, "PopoverContentModal")), tp = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Lf(function(e, t) {
	let n = Uf(Zf, e.__scopePopover), r = d.useRef(!1), i = d.useRef(!1);
	return /* @__PURE__ */ k(np, {
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
}, "PopoverContentNonModal")), np = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ Lf(function(e, t) {
	let { __scopePopover: n, trapFocus: r, onOpenAutoFocus: i, onCloseAutoFocus: a, disableOutsidePointerEvents: o, onEscapeKeyDown: s, onPointerDownOutside: c, onFocusOutside: l, onInteractOutside: u, "aria-describedby": f, branchNodes: p, branchRegistry: m, ...h } = e, g = Uf(Zf, n), _ = Vf(n), [v, y] = d.useState(null), b = ws(t, y);
	return dl(v), Al(), /* @__PURE__ */ k(ll, {
		registry: m,
		children: /* @__PURE__ */ k(sl, {
			asChild: !0,
			loop: !0,
			trapped: r,
			branches: p,
			onMountAutoFocus: i,
			onUnmountAutoFocus: a,
			children: /* @__PURE__ */ k(Yc, {
				asChild: !0,
				disableOutsidePointerEvents: o,
				onInteractOutside: u,
				onEscapeKeyDown: s,
				onPointerDownOutside: c,
				onFocusOutside: l,
				onDismiss: () => g.onOpenChange(!1),
				deferPointerDownOutside: !0,
				children: /* @__PURE__ */ k(Mf, {
					"data-state": rp(g.open),
					role: "dialog",
					id: g.contentId,
					"aria-labelledby": g.titlePresent ? g.titleId : void 0,
					"aria-describedby": g.descriptionPresent ? ip(f, g.descriptionId) : f,
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
function rp(e) {
	return e ? "open" : "closed";
}
Lf(rp, "getState");
function ip(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
Lf(ip, "concatAriaDescribedby");
// node_modules/@radix-ui/react-tooltip/dist/index.mjs
var ap = Object.defineProperty, op = (e, t) => ap(e, "name", {
	value: t,
	configurable: !0
}), [sp, cp] = /* @__PURE__ */ ec("Tooltip", [Cf]), lp = Cf(), up = "TooltipProvider", dp = 700, fp = "tooltip.open", [pp, mp] = sp(up), hp = /* @__PURE__ */ op((e) => {
	let { __scopeTooltip: t, delayDuration: n = dp, skipDelayDuration: r = 300, disableHoverableContent: i = !1, children: a } = e, o = d.useRef(!0), s = d.useRef(!1), c = d.useRef(0);
	return d.useEffect(() => {
		let e = c.current;
		return () => window.clearTimeout(e);
	}, []), /* @__PURE__ */ k(pp, {
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
}, "TooltipProvider"), gp = "Tooltip", [_p, vp] = sp(gp), yp = /* @__PURE__ */ op((e) => {
	let { __scopeTooltip: t, children: n, open: r, defaultOpen: i, onOpenChange: a, disableHoverableContent: o, delayDuration: s } = e, c = mp(gp, e.__scopeTooltip), l = lp(t), [u, f] = d.useState(null), [p, m] = d.useState(void 0), h = Lc(), g = d.useRef(0), _ = o ?? c.disableHoverableContent, v = s ?? c.delayDuration, y = d.useRef(!1), [b, x] = yc({
		prop: r,
		defaultProp: i ?? !1,
		onChange: /* @__PURE__ */ op((e) => {
			e ? (c.onOpen(), document.dispatchEvent(new CustomEvent(fp))) : c.onClose(), a?.(e);
		}, "onChange"),
		caller: gp
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
	return /* @__PURE__ */ k(Ef, {
		...l,
		children: /* @__PURE__ */ k(_p, {
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
}, "Tooltip"), bp = "TooltipTrigger", xp = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ op(function(e, t) {
	let { __scopeTooltip: n, "aria-describedby": r, ...i } = e, a = vp(bp, n), o = mp(bp, n), s = lp(n), c = ws(t, d.useRef(null), a.onTriggerChange), l = d.useRef(!1), u = d.useRef(!1), f = d.useCallback(() => l.current = !1, []);
	return d.useEffect(() => () => document.removeEventListener("pointerup", f), [f]), /* @__PURE__ */ k(Of, {
		asChild: !0,
		...s,
		children: /* @__PURE__ */ k(Gs.button, {
			"aria-describedby": a.open ? Lp(r, a.contentId) : r,
			"data-state": a.stateAttribute,
			...i,
			ref: c,
			onPointerMove: oc(e.onPointerMove, (e) => {
				e.pointerType !== "touch" && !u.current && !o.isPointerInTransitRef.current && (a.onTriggerEnter(), u.current = !0);
			}),
			onPointerLeave: oc(e.onPointerLeave, () => {
				a.onTriggerLeave(), u.current = !1;
			}),
			onPointerDown: oc(e.onPointerDown, () => {
				a.open && a.onClose(), l.current = !0, document.addEventListener("pointerup", f, { once: !0 });
			}),
			onFocus: oc(e.onFocus, () => {
				l.current || a.onOpen();
			}),
			onBlur: oc(e.onBlur, a.onClose),
			onClick: oc(e.onClick, a.onClose)
		})
	});
}, "TooltipTrigger")), Sp = "TooltipPortal", [Cp, wp] = sp(Sp, { forceMount: void 0 }), Tp = /* @__PURE__ */ op((e) => {
	let { __scopeTooltip: t, forceMount: n, children: r, container: i } = e, a = vp(Sp, t);
	return /* @__PURE__ */ k(Cp, {
		scope: t,
		forceMount: n,
		children: /* @__PURE__ */ k(Dc, {
			present: n || a.open,
			children: /* @__PURE__ */ k(wl, {
				asChild: !0,
				container: i,
				children: r
			})
		})
	});
}, "TooltipPortal"), Ep = "TooltipContent", Dp = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ op(function(e, t) {
	let n = wp(Ep, e.__scopeTooltip), { forceMount: r = n.forceMount, side: i = "top", ...a } = e, o = vp(Ep, e.__scopeTooltip);
	return /* @__PURE__ */ k(Dc, {
		present: r || o.open,
		children: o.disableHoverableContent ? /* @__PURE__ */ k(Ap, {
			side: i,
			...a,
			ref: t
		}) : /* @__PURE__ */ k(Op, {
			side: i,
			...a,
			ref: t
		})
	});
}, "TooltipContent")), Op = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ op(function(e, t) {
	let n = vp(Ep, e.__scopeTooltip), r = mp(Ep, e.__scopeTooltip), i = d.useRef(null), a = ws(t, i), [o, s] = d.useState(null), { trigger: c, onClose: l } = n, u = i.current, { onPointerInTransitChange: f } = r, p = d.useCallback(() => {
		s(null), f(!1);
	}, [f]), m = d.useCallback((e, t) => {
		let n = e.currentTarget, r = {
			x: e.clientX,
			y: e.clientY
		}, i = Mp(r, jp(r, n.getBoundingClientRect())), a = Np(t.getBoundingClientRect()), o = Fp([...i, ...a]);
		s(o), f(!0);
	}, [f]);
	return d.useEffect(() => () => p(), [p]), d.useEffect(() => {
		if (c && u) {
			let e = /* @__PURE__ */ op((e) => m(e, u), "handleTriggerLeave"), t = /* @__PURE__ */ op((e) => m(e, c), "handleContentLeave");
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
			let e = /* @__PURE__ */ op((e) => {
				let t = e.target, n = {
					x: e.clientX,
					y: e.clientY
				}, r = c?.contains(t) || u?.contains(t), i = !Pp(n, o);
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
	]), /* @__PURE__ */ k(Ap, {
		...e,
		ref: a
	});
}, "TooltipContentHoverable")), kp = /* @__PURE__ */ As("TooltipContent"), Ap = /* @__PURE__ */ d.forwardRef(/* @__PURE__ */ op(function(e, t) {
	let { __scopeTooltip: n, children: r, "aria-label": i, id: a, onEscapeKeyDown: o, onPointerDownOutside: s, ...c } = e, l = vp(Ep, n), u = lp(n), { onClose: f } = l, [p, m] = d.useState(null), h = ws(t, m);
	dl(p), d.useEffect(() => (document.addEventListener(fp, f), () => document.removeEventListener(fp, f)), [f]), d.useEffect(() => {
		if (l.trigger) {
			let e = /* @__PURE__ */ op((e) => {
				e.target instanceof Node && e.target.contains(l.trigger) && f();
			}, "handleScroll");
			return window.addEventListener("scroll", e, { capture: !0 }), () => window.removeEventListener("scroll", e, { capture: !0 });
		}
	}, [l.trigger, f]);
	let { setContentId: g } = l;
	return nc(() => (g(a), () => {
		g(void 0);
	}), [a, g]), /* @__PURE__ */ k(Yc, {
		asChild: !0,
		disableOutsidePointerEvents: !1,
		onEscapeKeyDown: o,
		onPointerDownOutside: s,
		onFocusOutside: (e) => e.preventDefault(),
		onDismiss: f,
		children: /* @__PURE__ */ A(Mf, {
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
			children: [/* @__PURE__ */ k(kp, { children: r }), i ? /* @__PURE__ */ k(Xs, {
				id: l.contentId,
				role: "tooltip",
				children: i
			}) : null]
		})
	});
}, "TooltipContentImpl"));
function jp(e, t) {
	let n = Math.abs(t.top - e.y), r = Math.abs(t.bottom - e.y), i = Math.abs(t.right - e.x), a = Math.abs(t.left - e.x);
	switch (Math.min(n, r, i, a)) {
		case a: return "left";
		case i: return "right";
		case n: return "top";
		case r: return "bottom";
		default: throw Error("unreachable");
	}
}
op(jp, "getExitSideFromRect");
function Mp(e, t, n = 5) {
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
op(Mp, "getPaddedExitPoints");
function Np(e) {
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
op(Np, "getPointsFromRect");
function Pp(e, t) {
	let { x: n, y: r } = e, i = !1;
	for (let e = 0, a = t.length - 1; e < t.length; a = e++) {
		let o = t[e], s = t[a], c = o.x, l = o.y, u = s.x, d = s.y;
		l > r != d > r && n < (u - c) * (r - l) / (d - l) + c && (i = !i);
	}
	return i;
}
op(Pp, "isPointInPolygon");
function Fp(e) {
	let t = e.slice();
	return t.sort((e, t) => e.x < t.x ? -1 : e.x > t.x ? 1 : e.y < t.y ? -1 : +(e.y > t.y)), Ip(t);
}
op(Fp, "getHull");
function Ip(e) {
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
op(Ip, "getHullPresorted");
function Lp(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
op(Lp, "concatAriaDescribedby");
// src/app/ui/compose-refs.ts
function Rp(...e) {
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
var zp = (e) => e.preventDefault();
function Bp({ open: e, kind: t, content: n, anchor: r, onEscape: i, onOutsidePress: s, inertBackground: c = !1 }) {
	let u = a(), d = l(), f = o(), [p] = w(() => ({})), m = C(null), h = C(null);
	return y(() => {
		e && (h.current = document.activeElement);
	}, [e]), b(() => {
		m.current = {
			kind: t,
			content: n,
			anchor: r,
			onEscape: i,
			onOutsidePress: s,
			inertBackground: c,
			ownsKeyboard: d,
			inertTarget: f
		};
	}), b(() => {
		if (e) return u.open(p, m, h.current), () => u.close(p);
	}, [
		e,
		u,
		p
	]), b(() => {
		u.refresh();
	}, [
		u,
		c,
		f
	]), {
		covered: T(u.subscribe, () => u.hasModalAbove(p), () => !1),
		isTop: () => u.isTop(p),
		skipFocusRestore: () => u.skipFocusRestore(p),
		markPressInside: () => u.markPressInside(p)
	};
}
// src/app/ui/tooltip.tsx
var Vp = d.createContext(null);
function Hp(e) {
	let t = document.activeElement;
	return !!t && !!e?.contains(t) && t.matches(":focus-visible");
}
function Up({ delayDuration: e = 0, ...t }) {
	return /* @__PURE__ */ k(hp, {
		delayDuration: e,
		...t
	});
}
function Wp({ open: e, defaultOpen: t = !1, onOpenChange: n, delayDuration: r, disableHoverableContent: i, children: a }) {
	let [o, s] = d.useState(t), c = e ?? o, l = (t) => {
		e === void 0 && s(t), n?.(t);
	}, u = d.useRef(null), f = d.useRef(null), p = d.useMemo(() => ({
		content: u,
		trigger: f
	}), []), m = d.useRef(!1);
	return Bp({
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
	}, []), /* @__PURE__ */ k(Vp.Provider, {
		value: p,
		children: /* @__PURE__ */ k(Up, {
			delayDuration: r,
			disableHoverableContent: i,
			children: /* @__PURE__ */ k(yp, {
				open: c,
				onOpenChange: (e) => {
					!e && m.current && Hp(f.current) || l(e);
				},
				children: a
			})
		})
	});
}
function Gp({ ref: e, ...t }) {
	let n = d.useContext(Vp), r = d.useMemo(() => Rp(e, n?.trigger), [e, n]);
	return /* @__PURE__ */ k(xp, {
		"data-slot": "tooltip-trigger",
		...t,
		ref: r
	});
}
function Kp({ className: e, sideOffset: t = 8, collisionPadding: r = 8, container: i, nonInteractive: a = !1, ref: o, ...s }) {
	let c = n(), l = d.useContext(Vp), u = d.useMemo(() => Rp(o, l?.content), [o, l]), f = /* @__PURE__ */ k(Dp, {
		"data-slot": "tooltip-content",
		sideOffset: t,
		collisionPadding: r,
		className: F("z-[200]", e),
		...s,
		ref: u,
		onEscapeKeyDown: zp
	});
	return /* @__PURE__ */ k(Tp, {
		container: i ?? c,
		children: a ? /* @__PURE__ */ k("div", {
			className: "pointer-events-none",
			children: f
		}) : f
	});
}
// src/app/lib/shortcuts.ts
var qp = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent), Jp = qp ? "meta" : "ctrl", Yp = {
	ctrl: qp ? "⌘" : "⌃",
	control: qp ? "⌘" : "⌃",
	cmd: "⌘",
	command: "⌘",
	meta: qp ? "⌘" : "⊞",
	shift: "⇧",
	alt: qp ? "⌥" : "Alt",
	option: qp ? "⌥" : "Alt",
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
}, Xp = (e) => Yp[e.toLowerCase()] ?? e.toUpperCase(), Zp = /* @__PURE__ */ new Set([
	"ctrl",
	"control",
	"meta",
	"cmd",
	"command",
	"alt",
	"option"
]), Qp = (e) => e.some((e) => Zp.has(e.toLowerCase())), $p = (e) => {
	let t = e.toLowerCase();
	return t === "control" ? "ctrl" : t === "cmd" || t === "command" ? "meta" : t === "option" ? "alt" : t;
};
function em(e, t) {
	let n = /* @__PURE__ */ new Set();
	e.ctrlKey && n.add("ctrl"), e.metaKey && n.add("meta"), e.altKey && n.add("alt"), e.shiftKey && n.add("shift"), e.key && n.add(e.key.toLowerCase());
	let r = new Set(t.map($p));
	return n.size === r.size && [...r].every((e) => n.has(e));
}
var tm = [
	Jp,
	"shift",
	"o"
], nm = tm, rm = tm, im = [Jp, "k"], am = [Jp, "/"], om = [Jp, "n"], sm = [Jp, "b"], cm = [Jp, "\\"], lm = [
	Jp,
	"shift",
	"e"
], um = [
	{
		id: "palette",
		keys: im,
		label: "Open the command palette",
		group: "General"
	},
	{
		id: "shortcuts",
		keys: am,
		label: "Show keyboard shortcuts",
		group: "General"
	},
	{
		id: "close",
		keys: ["Esc"],
		label: "Close a dialog, drawer or palette",
		group: "General",
		spelled: !0
	},
	{
		id: "new-session",
		keys: om,
		label: "New session",
		group: "Navigation"
	},
	{
		id: "new-in-project",
		keys: rm,
		label: "New session in this project (new project elsewhere)",
		group: "Navigation"
	},
	{
		id: "sidebar",
		keys: sm,
		label: "Toggle the sidebar",
		group: "Navigation"
	},
	{
		id: "next-needs-you",
		keys: lm,
		label: "Next session that needs you",
		group: "Navigation"
	},
	{
		id: "inbox-move",
		keys: ["j / k"],
		label: "Move through the Inbox (Enter opens)",
		group: "Navigation",
		spelled: !0
	},
	{
		id: "dock",
		keys: cm,
		label: "Dock or float the drawer",
		group: "Session"
	},
	{
		id: "approve",
		keys: ["enter"],
		label: "Approve the request",
		group: "Attention card"
	},
	{
		id: "deny",
		keys: ["d"],
		label: "Deny the request",
		group: "Attention card"
	},
	{
		id: "answer",
		keys: ["1–9"],
		label: "Pick an answer option",
		group: "Attention card",
		spelled: !0
	}
], dm = [
	"General",
	"Navigation",
	"Session",
	"Attention card"
], fm = ({ keys: e, inversed: t = !1, spelled: n = !1, className: r = "" }) => e.length === 0 ? null : /* @__PURE__ */ k("div", {
	className: F("flex gap-[3px]", r),
	children: e.map((e, r) => /* @__PURE__ */ k("kbd", {
		className: F("type-tag inline-flex h-4 min-w-4 items-center justify-center rounded-xs border px-1 leading-none", t ? "text-secondary-inverse border-tertiary-inversed" : "border-tertiary bg-[var(--f-wash-1)] text-basic-tertiary"),
		children: n ? e : Xp(e)
	}, r))
}), pm = d.createContext(null);
function mm(e) {
	let t = d.useContext(pm);
	if (!t) throw Error(`${e} must be rendered inside Popover`);
	return t;
}
function hm({ open: e, defaultOpen: t = !1, onOpenChange: n, closeOnEscape: r = !0, closeOnOutsidePress: i = !0, children: a }) {
	let [o, s] = d.useState(t), c = e ?? o, l = (t) => {
		e === void 0 && s(t), n?.(t);
	}, u = () => l(!1), f = d.useRef(null), p = d.useRef(null), m = Bp({
		open: c,
		kind: "panel",
		content: f,
		anchor: p,
		onEscape: r ? u : void 0,
		onOutsidePress: i ? u : void 0
	});
	return /* @__PURE__ */ k(pm.Provider, {
		value: {
			layer: m,
			content: f,
			anchor: p
		},
		children: /* @__PURE__ */ k(Wf, {
			open: c,
			onOpenChange: l,
			modal: !1,
			children: a
		})
	});
}
function gm({ ref: e, ...t }) {
	let { anchor: n } = mm("PopoverAnchor"), r = d.useMemo(() => Rp(e, n), [e, n]);
	return /* @__PURE__ */ k(Kf, {
		"data-slot": "popover-anchor",
		ref: r,
		...t
	});
}
function _m({ className: e, align: t = "center", sideOffset: r = 8, collisionPadding: i = 8, portal: a = !0, container: o, role: s, onCloseAutoFocus: c, onMouseDownCapture: l, ref: u, ...f }) {
	let { layer: p, content: m } = mm("PopoverContent"), h = n(), g = d.useMemo(() => Rp(u, m), [u, m]), _ = /* @__PURE__ */ k(Qf, {
		"data-slot": "popover-content",
		align: t,
		sideOffset: r,
		collisionPadding: i,
		className: F("z-[120] bg-popover text-popover-foreground outline-none", e),
		...f,
		role: s,
		ref: g,
		onEscapeKeyDown: zp,
		onInteractOutside: zp,
		onCloseAutoFocus: (e) => {
			c?.(e), e.preventDefault();
		},
		onMouseDownCapture: (e) => {
			l?.(e), p.markPressInside();
		}
	});
	return a ? /* @__PURE__ */ k(Xf, {
		container: o ?? h,
		children: _
	}) : _;
}
// src/app/ui/dialog.tsx
var vm = d.createContext(null);
function ym(e) {
	let t = d.useContext(vm);
	if (!t) throw Error(`${e} must be rendered inside Dialog`);
	return t;
}
function bm({ open: e, defaultOpen: t = !1, onOpenChange: n, layer: r = "modal", inertBackground: i = r === "modal", closeOnEscape: a = !0, onEscape: o, children: s }) {
	let [c, l] = d.useState(t), u = e ?? c, f = (t) => {
		e === void 0 && l(t), n?.(t);
	}, p = () => f(!1), m = d.useRef(null), h = Bp({
		open: u,
		kind: r,
		content: m,
		inertBackground: i,
		onEscape: a ? o ?? p : void 0
	});
	return /* @__PURE__ */ k(vm.Provider, {
		value: {
			layer: h,
			content: m,
			close: p
		},
		children: /* @__PURE__ */ k(Hl, {
			open: u,
			onOpenChange: f,
			modal: !1,
			children: s
		})
	});
}
function xm({ container: e, ...t }) {
	let r = n();
	return /* @__PURE__ */ k(Kl, {
		container: e ?? r,
		...t
	});
}
function Sm(e) {
	if (!e) return;
	let t = (e) => e.preventDefault();
	return e.addEventListener("wheel", t, { passive: !1 }), e.addEventListener("touchmove", t, { passive: !1 }), () => {
		e.removeEventListener("wheel", t), e.removeEventListener("touchmove", t);
	};
}
function Cm({ asChild: e = !1, dismissible: t = !0, className: n, onMouseDown: r, onClick: i, ref: a, ...o }) {
	let { layer: s, close: c } = ym("DialogOverlay"), l = d.useRef(!1), u = d.useMemo(() => Rp(a, Sm), [a]);
	return /* @__PURE__ */ k(e ? Os : "div", {
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
function wm(e) {
	return Array.from(e.querySelectorAll(s)).filter((t) => {
		if (t.tabIndex < 0 || t.matches(":disabled, input[type=hidden]") || t.closest("[hidden], [inert]") || getComputedStyle(t).visibility === "hidden") return !1;
		for (let n = t; n; n = n.parentElement) {
			if (getComputedStyle(n).display === "none") return !1;
			if (n === e) break;
		}
		return !0;
	}).sort((e, t) => (e.tabIndex || Infinity) - (t.tabIndex || Infinity));
}
function Tm({ onCloseAutoFocus: e, onKeyDown: t, onMouseDownCapture: n, ref: r, ...i }) {
	let { layer: a, content: o } = ym("DialogContent"), s = d.useMemo(() => Rp(r, o), [r, o]);
	return /* @__PURE__ */ k(Jl, {
		"data-slot": "dialog-content",
		"data-covered": a.covered ? "" : void 0,
		...i,
		ref: s,
		onEscapeKeyDown: zp,
		onInteractOutside: zp,
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
			let i = wm(n), o = i[0], s = i.at(-1), c = e.shiftKey ? s : o;
			(!c || r === n || (e.shiftKey ? r === o : r === s)) && (e.preventDefault(), (c ?? n).focus());
		}
	});
}
function Em(e) {
	return /* @__PURE__ */ k(Ql, {
		"data-slot": "dialog-title",
		...e
	});
}
function Dm(e) {
	return /* @__PURE__ */ k($l, {
		"data-slot": "dialog-description",
		...e
	});
}
// src/app/ui/sheet.tsx
var Om = {
	top: "inset-x-0 top-0",
	right: "inset-y-0 right-0 h-full",
	bottom: "inset-x-0 bottom-0",
	left: "inset-y-0 left-0 h-full"
};
function km({ layer: e = "sheet", ...t }) {
	return /* @__PURE__ */ k(bm, {
		layer: e,
		...t
	});
}
function Am({ side: e = "right", className: t, ...n }) {
	return /* @__PURE__ */ k(Tm, {
		"data-slot": "sheet-content",
		"data-side": e,
		className: F("fixed flex flex-col outline-none", Om[e], t),
		...n
	});
}
// src/app/atoms/cover-background/index.tsx
var jm = ({ open: e = !1, zIndex: t = 40, opacity: n, blur: r = 0, className: i = "", style: a, ...o }) => /* @__PURE__ */ k("div", {
	className: F("fixed inset-0 transition-opacity duration-200 ease-out motion-reduce:transition-none", e ? "opacity-100" : "opacity-0 pointer-events-none", i),
	style: {
		background: n == null ? "var(--f-scrim)" : `oklch(0.14 0.006 85 / ${n})`,
		zIndex: t,
		backdropFilter: r ? `blur(${r}px)` : void 0,
		...a
	},
	...o
}), Mm = 200, Nm = ({ open: e, onClose: t, closeOnEscape: n = !0, zIndex: r = 120, className: i = "", children: a }) => {
	let [o, s] = w(e), [c, l] = w(!0), [u, d] = w(e), f = C(""), p = re();
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
		let t = setTimeout(() => s(!1), Mm);
		return () => clearTimeout(t);
	}, [e, o]), v(() => {
		f.current && f.current !== p.pathname && o && t(), f.current = p.pathname;
	}, [
		p.pathname,
		o,
		t
	]), o ? /* @__PURE__ */ k(km, {
		open: e,
		closeOnEscape: n,
		onOpenChange: (e) => {
			e || t();
		},
		children: /* @__PURE__ */ A(xm, {
			forceMount: !0,
			children: [/* @__PURE__ */ k(Cm, {
				asChild: !0,
				children: /* @__PURE__ */ k(jm, {
					open: !c,
					zIndex: r
				})
			}), /* @__PURE__ */ A(Am, {
				side: "bottom",
				forceMount: !0,
				role: void 0,
				onOpenAutoFocus: (e) => e.preventDefault(),
				style: { zIndex: r },
				className: F("fixed inset-x-0 bottom-0 flex flex-col min-h-[120px] max-h-[min(75dvh,calc(100%-16px))] overflow-y-auto overscroll-contain", "rounded-t-sheet bg-elevation-level-2 pt-1 pb-[calc(12px+env(safe-area-inset-bottom))] shadow-2xl", "transition-transform duration-200 ease-[var(--ease-drawer)] motion-reduce:transition-none [&>*]:shrink-0", c ? "translate-y-full" : "translate-y-0", i),
				onMouseDown: (e) => e.stopPropagation(),
				onClick: (e) => e.stopPropagation(),
				children: [/* @__PURE__ */ k("div", {
					"aria-hidden": !0,
					className: "flex justify-center pt-1 pb-2",
					children: /* @__PURE__ */ k("span", { className: "h-1 w-9 rounded-pill bg-[var(--f-wash-4)]" })
				}), a]
			})]
		})
	}) : null;
}, Pm = "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex=\"-1\"])", Fm = (e) => Array.from(e.querySelectorAll(Pm)).filter((e) => e.tabIndex >= 0 && !e.matches(":disabled") && !e.closest("[inert], [hidden]"));
function Im({ open: e, label: t, children: n }) {
	let r = C(null);
	return b(() => {
		let t = r.current;
		if (!e || !t) return;
		(Fm(t)[0] ?? t).focus({ preventScroll: !0 });
		let n = (e) => {
			if (e.key === "Tab") {
				e.preventDefault(), e.stopPropagation();
				let n = Fm(t), r = n.indexOf(document.activeElement);
				(n[e.shiftKey ? (r <= 0 ? n.length : r) - 1 : (r + 1) % n.length] ?? t).focus({ preventScroll: !0 });
			}
		};
		return t.addEventListener("keydown", n), () => {
			t.removeEventListener("keydown", n);
		};
	}, [e]), b(() => {
		let t = r.current;
		e && t && (document.activeElement === document.body || t.contains(document.activeElement) && document.activeElement?.matches(":disabled")) && (Fm(t)[0] ?? t).focus({ preventScroll: !0 });
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
var Lm = /* @__PURE__ */ function(e) {
	return e.Small = "w-[240px]", e.Medium = "w-[320px]", e.Large = "w-[400px]", e.Fit = "w-max", e.TriggerWidth = "min-w-[var(--radix-popover-trigger-width)]", e;
}({}), Rm = "type-body-chrome flex flex-col gap-0.5 p-1.5 rounded-xl bg-elevation-level-3 shadow-lg fade motion-reduce:!animate-none [&>*]:shrink-0", zm = ({ open: e, onClose: t, content: n, children: r, placement: i = ps.BottomRight, size: a = "w-[320px]", sticky: o = !1, closeOnOutsideClick: s = !0, closeOnEscape: c = !0, sheetOnMobile: l = !0, className: u = "", panelClassName: d = "", sheetClassName: f = "", focusScope: p }) => {
	let m = vs() && l, h = e && !m, g = p ? /* @__PURE__ */ k(Im, {
		open: e,
		label: p,
		children: n
	}) : n, [_, v] = w(null), y = x(() => h && o && _ ? hs(_) : [], [
		h,
		o,
		_
	]), { side: b, align: S } = ms[i];
	return /* @__PURE__ */ k(hm, {
		open: h,
		onOpenChange: (e) => {
			e || t();
		},
		closeOnEscape: c,
		closeOnOutsidePress: s,
		children: /* @__PURE__ */ A(gm, {
			ref: v,
			className: F("relative w-fit h-fit leading-[0]", u),
			children: [
				r,
				m ? /* @__PURE__ */ k(Nm, {
					open: e,
					onClose: t,
					closeOnEscape: c,
					className: f,
					children: g
				}) : null,
				h ? /* @__PURE__ */ k(_m, {
					forceMount: !0,
					portal: o,
					side: b,
					align: S,
					sideOffset: 8,
					collisionPadding: 8,
					collisionBoundary: o ? y : void 0,
					onOpenAutoFocus: (e) => e.preventDefault(),
					className: F(Rm, "text-inherit", a, o ? "z-[120]" : "z-30", d),
					children: g
				}) : null
			]
		})
	});
};
zm.Placement = ps, zm.Size = Lm;
// src/app/atoms/tooltip/index.tsx
var Bm = "tooltip-box text-left w-max h-fit max-w-[260px] flex flex-col gap-0.5 shadow-md bg-elevation-ground-inverse px-2 py-1.5 rounded-md fade motion-reduce:!animate-none", Vm = ({ title: e, description: t, keyboardShortcuts: n = [], inverted: r = !0, isMobile: i = !1 }) => /* @__PURE__ */ A(ne, { children: [/* @__PURE__ */ A("div", {
	className: "flex gap-2 items-center",
	children: [/* @__PURE__ */ k("div", {
		className: F(i ? "type-label" : "type-meta-strong", "flex-grow", r ? "text-primary-inverse" : "text-basic-primary"),
		children: e
	}), n.length > 0 ? /* @__PURE__ */ k(fm, {
		keys: n,
		inversed: r
	}) : null]
}), t ? /* @__PURE__ */ k("div", {
	className: F("w-fit h-fit", r ? "type-meta text-secondary-inverse" : "type-body-chrome text-basic-secondary"),
	children: t
}) : null] }), Hm = ({ title: e, description: t, keyboardShortcuts: n, className: r, children: i }) => {
	let [a, o] = w(!1), s = C(!1), c = (e) => {
		e.stopPropagation(), e.type === "touchend" && e.preventDefault(), s.current = !0, o((e) => !e), setTimeout(() => {
			s.current = !1;
		}, 100);
	};
	return /* @__PURE__ */ k(zm, {
		open: a,
		onClose: () => {
			s.current || o(!1);
		},
		className: r,
		content: /* @__PURE__ */ A("div", {
			className: "px-4 py-2 flex overflow-hidden gap-3",
			children: [/* @__PURE__ */ k(ls, {
				iconName: ss.Info,
				size: 20,
				className: "mt-px w-5 min-w-5 max-w-5",
				color: "var(--color-fill-basic-tertiary)"
			}), /* @__PURE__ */ k("div", {
				className: "flex flex-col gap-2 min-w-0",
				children: /* @__PURE__ */ k("div", {
					className: "flex flex-col gap-2",
					children: /* @__PURE__ */ k(Vm, {
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
function Um({ ref: e, "aria-describedby": t, ...n }) {
	let r = C(null), i = x(() => Rp(e, r), [e]);
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
var Wm = ({ title: e = "", description: t, keyboardShortcuts: n = [], position: r = ps.TopCenter, className: i = "", boxClassName: a = "", disabled: o = !1, sticky: s = !1, showTooltipOnMobile: c = !1, children: l }) => {
	let u = vs(), [d, f] = w(!1), p = !o && !u;
	if (d && !p && f(!1), s && c && u) return /* @__PURE__ */ k(Hm, {
		title: e,
		description: t,
		keyboardShortcuts: n,
		className: i,
		children: l
	});
	let { side: m, align: h } = ms[r];
	return /* @__PURE__ */ A(Wp, {
		open: d,
		onOpenChange: (e) => f(e && p),
		disableHoverableContent: !0,
		children: [/* @__PURE__ */ k(Gp, {
			asChild: !0,
			children: /* @__PURE__ */ k(Um, {
				className: F(s ? "w-fit h-fit leading-[0]" : "relative w-fit h-fit leading-[0] group", i),
				onMouseEnter: () => f(p),
				onMouseLeave: () => f(!1),
				onFocus: (e) => {
					let t = e.target;
					t === document.activeElement && !t.matches(":focus-visible") && e.preventDefault();
				},
				children: l
			})
		}), /* @__PURE__ */ k(Kp, {
			nonInteractive: !0,
			side: m,
			align: h,
			sideOffset: 8,
			collisionPadding: 8,
			className: F(Bm, "pointer-events-none", a),
			children: /* @__PURE__ */ k(Vm, {
				title: e,
				description: t,
				keyboardShortcuts: n
			})
		})]
	});
};
Wm.Position = ps;
// src/app/ui/button.tsx
var Gm = /* @__PURE__ */ function(e) {
	return e.Medium = "btn-medium", e.Small = "btn-small", e.Large = "btn-large", e;
}({}), Km = /* @__PURE__ */ function(e) {
	return e.Primary = "btn-primary", e.Secondary = "btn-secondary", e.SecondaryHighlighted = "btn-secondary-highlighted", e.SecondaryDestructive = "btn-secondary-destructive", e.SecondaryAccent = "btn-secondary-accent", e.SecondaryAccentHighlighted = "btn-secondary-accent-highlighted", e.Tertiary = "btn-tertiary", e.TertiaryDestructive = "btn-tertiary-destructive", e.TertiaryAccent = "btn-tertiary-accent", e.Ghost = "btn-ghost", e.GhostDestructive = "btn-ghost-destructive", e.GhostAccent = "btn-ghost-accent", e.GhostHighlighted = "btn-ghost-highlighted", e.GhostHighlightedAccent = "btn-ghost-highlighted-accent", e;
}({}), qm = /* @__PURE__ */ function(e) {
	return e.Icon = "btn-icon", e.IconLeft = "btn-icon-left", e.IconRight = "btn-icon-right", e.Text = "btn-text", e;
}({});
function Jm({ variant: e = "btn-ghost", size: t = "btn-medium", content: n = "btn-text", disabled: r = !1, className: i } = {}) {
	return F("btn", t, e, n, r && "btn-disabled", i);
}
function Ym({ variant: e, size: t, content: n, disabled: r, className: i, asChild: a = !1, type: o = "button", ...s }) {
	return /* @__PURE__ */ k(a ? Os : "button", {
		"data-slot": "button",
		type: a ? void 0 : o,
		disabled: r,
		className: Jm({
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
var Xm = {
	"btn-medium": us.Small,
	"btn-small": us.Small,
	"btn-large": us.Small
}, Zm = {
	"btn-primary": ds.OnPrimary,
	"btn-secondary": ds.Neutral,
	"btn-secondary-highlighted": ds.Neutral,
	"btn-secondary-destructive": ds.Destructive,
	"btn-secondary-accent": ds.Brand,
	"btn-secondary-accent-highlighted": ds.Brand,
	"btn-tertiary": ds.Neutral,
	"btn-tertiary-destructive": ds.Destructive,
	"btn-tertiary-accent": ds.Brand,
	"btn-ghost": ds.Neutral,
	"btn-ghost-destructive": ds.Destructive,
	"btn-ghost-accent": ds.Brand,
	"btn-ghost-highlighted": ds.Neutral,
	"btn-ghost-highlighted-accent": ds.Brand
}, Qm = ({ size: e = Gm.Medium, variant: t = Km.Ghost, content: n = qm.Text, disabled: r, className: i = "", children: a, loading: o = !1, type: s = "button", ...c }) => /* @__PURE__ */ k(Ym, {
	size: e,
	variant: t,
	content: n,
	className: i,
	type: s,
	disabled: r || o,
	"aria-busy": o || void 0,
	...c,
	children: o ? /* @__PURE__ */ A(ne, { children: [/* @__PURE__ */ k(fs, {
		size: Xm[e],
		variant: Zm[t]
	}), /* @__PURE__ */ k("span", {
		className: "sr-only",
		children: a
	})] }) : a
});
Qm.Size = Gm, Qm.Variant = Km, Qm.Content = qm;
// src/app/hooks/useCopyToClipboard.ts
var $m = 2e3;
function eh(e) {
	let t = document.activeElement instanceof HTMLElement ? document.activeElement : null, n = document.createElement("textarea");
	n.value = e, n.style.position = "fixed", n.style.top = "-9999px", document.body.appendChild(n);
	try {
		return n.focus(), n.select(), document.execCommand("copy");
	} catch {
		return !1;
	} finally {
		document.body.removeChild(n), t?.focus();
	}
}
function th() {
	let [e, t] = w("idle"), n = C(null);
	v(() => () => {
		n.current && clearTimeout(n.current);
	}, []);
	let r = g((e) => {
		n.current && clearTimeout(n.current), t(e), n.current = e === "copied" ? setTimeout(() => t("idle"), $m) : null;
	}, []), i = g((e) => {
		if (!e) return;
		let t = () => r(eh(e) ? "copied" : "failed");
		navigator.clipboard?.writeText ? navigator.clipboard.writeText(e).then(() => r("copied")).catch(t) : t();
	}, [r]);
	return {
		copied: e === "copied",
		outcome: e,
		copy: i
	};
}
// src/app/atoms/button/CopyButton.tsx
var nh = ({ value: e, size: t = Gm.Small, variant: n = Km.Tertiary, content: r = qm.Icon, position: i = ps.BottomCenter, title: a = "Copy", iconSize: o, onCopy: s, className: c = "", children: l, ...u }) => {
	let { copied: d, copy: f } = th(), p = d ? "Copied" : a;
	return /* @__PURE__ */ k(Wm, {
		title: p,
		position: i,
		sticky: !0,
		children: /* @__PURE__ */ k(Qm, {
			size: t,
			variant: n,
			content: r,
			className: c,
			"aria-label": p,
			onClick: () => {
				f(e), s?.();
			},
			...u,
			children: l ?? /* @__PURE__ */ k(ls, {
				iconName: d ? ss.Check : ss.FileCopy,
				size: o,
				className: "fade"
			})
		})
	});
}, rh = ({ variant: e = Km.Ghost, content: t = qm.Text, disabled: n, className: r = "", buttonClassName: i = "", children: a, loading: o = !1, type: s = "button", ...c }) => {
	let l = r.includes("flex-grow") || r.includes("flex-1"), u = e.startsWith("btn-tertiary"), d = !e.startsWith("btn-primary") && !u;
	return /* @__PURE__ */ k("div", {
		className: F(d && "h-10 rounded-pill bg-elevation-level-3 shadow-md", !d && !u && "h-10 rounded-pill", l ? "flex w-full" : "inline-flex w-fit", r),
		children: /* @__PURE__ */ k(Qm, {
			size: Gm.Large,
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
rh.Variant = Km, rh.Content = qm;
// src/app/ui/alert-dialog.tsx
function ih(e) {
	return /* @__PURE__ */ k(bm, {
		...e,
		layer: "modal"
	});
}
function ah({ dismissible: e = !1, ...t }) {
	return /* @__PURE__ */ k(Cm, {
		"data-slot": "alert-dialog-overlay",
		dismissible: e,
		...t
	});
}
function oh(e) {
	return /* @__PURE__ */ k(Tm, {
		"data-slot": "alert-dialog-content",
		role: "alertdialog",
		...e
	});
}
function sh(e) {
	return /* @__PURE__ */ k(Em, {
		"data-slot": "alert-dialog-title",
		...e
	});
}
// src/app/atoms/modal/index.tsx
var ch = 300, lh = "pt-[calc(56px+env(safe-area-inset-top))]", uh = "pb-[calc(84px+env(safe-area-inset-bottom))]", dh = /* @__PURE__ */ function(e) {
	return e.Small = "max-w-[420px]", e.Medium = "max-w-[600px]", e.Wide = "max-w-[640px]", e.Large = "max-w-[760px]", e;
}({}), fh = ({ open: e, onClose: t, onNavigate: n, title: r, subheader: i, headerActions: a, size: o = "max-w-[600px]", zIndex: s = 100, closeOnOverlay: c = !0, flush: l = !1, fullScreen: u = !1, chromeless: d = !1, mobileCloseIcon: f = ss.Left, hideClose: p = !1, keepOnNavigate: m = !1, alert: h = !1, inertOnPhone: g = !1, className: _ = "", bodyClassName: y = "", children: b, footer: x }) => {
	let S = vs(), T = C(null), [ee, E] = w(null), [te, D] = w(0);
	v(() => {
		if (!ee || typeof ResizeObserver > "u") return;
		let e = new ResizeObserver(() => D(ee.offsetHeight));
		return e.observe(ee), () => e.disconnect();
	}, [ee]);
	let O = C(""), ne = re(), [ie, j] = w(e), [ae, oe] = w(e), [se, ce] = w(!0);
	if (ae !== e && (oe(e), e ? (j(!0), S && ce(!0)) : S ? ce(!0) : j(!1)), v(() => {
		if (!e || !S || !ie) return;
		let t = 0, n = requestAnimationFrame(() => {
			t = requestAnimationFrame(() => ce(!1));
		});
		return () => {
			cancelAnimationFrame(n), cancelAnimationFrame(t);
		};
	}, [
		e,
		S,
		ie
	]), v(() => {
		if (e || !S || !ie) return;
		let t = setTimeout(() => j(!1), ch);
		return () => clearTimeout(t);
	}, [
		e,
		S,
		ie
	]), v(() => {
		e && T.current?.focus();
	}, [e]), v(() => {
		O.current && O.current !== ne.pathname && e && !m && (n ?? t)?.(), O.current = ne.pathname;
	}, [
		ne.pathname,
		e,
		t,
		n,
		m
	]), !ie) return null;
	let le = h ? ih : bm, ue = h ? ah : Cm, de = h ? oh : Tm, fe = h ? sh : Em, pe = c && !S, me = (e) => S ? /* @__PURE__ */ k(rh, {
		variant: Km.Ghost,
		content: qm.Icon,
		className: "shrink-0",
		"aria-label": "Close",
		onClick: t,
		children: /* @__PURE__ */ k(ls, { iconName: e })
	}) : /* @__PURE__ */ k(Qm, {
		variant: Km.Ghost,
		size: Gm.Medium,
		content: qm.Icon,
		className: F("shrink-0", e === ss.Close && "btn-icon-rotate"),
		"aria-label": "Close",
		onClick: t,
		children: /* @__PURE__ */ k(ls, { iconName: e })
	}), he = u && !S, ge = S && !i, _e = d && (he || S) && t && !p, ve = F("flex min-w-0 flex-1 items-center text-basic-primary", S ? "type-heading" : "type-subheading"), ye = /* @__PURE__ */ A("div", {
		className: F("flex items-center", i ? S ? "min-h-14" : "min-h-[52px]" : "h-full", S ? F("gap-3 py-1 pl-2", a ? "pr-1" : "pr-4") : "gap-2 py-1 pl-5 pr-2.5"),
		children: [
			S && t ? me(f) : null,
			r ? /* @__PURE__ */ k(fe, {
				asChild: !0,
				children: /* @__PURE__ */ k("div", {
					className: ve,
					children: r
				})
			}) : /* @__PURE__ */ k("div", { className: ve }),
			a ? /* @__PURE__ */ k("div", {
				className: "flex shrink-0 items-center gap-1",
				children: a
			}) : null,
			!S && t ? me(ss.Close) : null
		]
	}), be = !d && (r || i || a || t) ? /* @__PURE__ */ A("header", {
		className: F("flex flex-col", S ? F("fade-from-top z-10 pt-[env(safe-area-inset-top)]", i ? "shrink-0" : "h-[calc(56px+env(safe-area-inset-top))]", ge ? "absolute inset-x-0 top-0" : "shrink-0") : F("shrink-0 border-b border-muted", i ? "min-h-[52px]" : "h-[52px]")),
		children: [ye, i ? /* @__PURE__ */ k("div", {
			className: S ? "px-4 pb-3" : "px-5 pb-3",
			children: i
		}) : null]
	}) : null, xe = e && !se ? "translate-x-0 data-[covered]:translate-x-[-30px]" : "translate-x-full";
	return /* @__PURE__ */ k(le, {
		open: e,
		onOpenChange: (e) => {
			e || t?.();
		},
		inertBackground: !S || g,
		children: /* @__PURE__ */ A(xm, {
			forceMount: !0,
			children: [/* @__PURE__ */ k(ue, {
				asChild: !0,
				dismissible: pe,
				children: /* @__PURE__ */ k(jm, {
					open: e && (!S || !se),
					zIndex: s,
					className: S ? "!duration-300" : void 0
				})
			}), /* @__PURE__ */ k("div", {
				style: { zIndex: s },
				className: F("pointer-events-none fixed inset-0 z-[100] flex", !S && "items-center justify-center p-4"),
				children: /* @__PURE__ */ A(de, {
					ref: T,
					forceMount: !0,
					"aria-modal": "true",
					"aria-label": typeof r == "string" ? r : void 0,
					tabIndex: -1,
					"data-modal-open": e ? "true" : void 0,
					onOpenAutoFocus: (e) => e.preventDefault(),
					className: F("pointer-events-auto relative flex flex-col outline-none", S ? F("rounded-none transition-transform duration-300 ease-in-out motion-reduce:transition-none", xe, !d && "bg-elevation-ground") : F("fade w-full motion-reduce:!animate-none", o, d ? "shadow-none" : "max-h-[calc(100vh-2rem)] overflow-hidden rounded-sheet bg-elevation-level-2 shadow-2xl", he && "h-full max-h-none min-h-0 w-full max-w-none overflow-hidden"), _, S && "h-[min(100%,100dvh)] max-h-[min(100%,100dvh)] min-h-[min(100%,100dvh)] w-full min-w-full max-w-full"),
					children: [
						_e ? /* @__PURE__ */ k("div", {
							className: "absolute top-[calc(4px+env(safe-area-inset-top))] right-2 z-10",
							children: me(ss.Close)
						}) : null,
						be,
						/* @__PURE__ */ k("div", {
							className: F("flex w-full min-h-0 flex-auto flex-col overflow-auto overscroll-contain", ge && !d && lh),
							children: /* @__PURE__ */ k("div", {
								className: F(d ? "flex min-h-0 w-full flex-1 flex-col" : "modal-body paragraph-medium flex flex-col px-5 py-4 text-basic-secondary", S || he ? "min-h-0 flex-1 overflow-auto" : l && "flex-1", S && x && uh, y),
								style: S && x && te > 72 ? { paddingBottom: `calc(${te + 16}px)` } : void 0,
								children: b
							})
						}),
						x ? /* @__PURE__ */ k("footer", {
							ref: S ? E : void 0,
							className: F("modal-footer flex items-center justify-end", S ? "modal-footer-mobile fade-from-bottom absolute inset-x-0 bottom-0 z-10 gap-3 px-3 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]" : "shrink-0 gap-2 border-t border-muted px-5 py-3"),
							children: x
						}) : null
					]
				})
			})]
		})
	});
};
fh.Size = dh;
var ph = Dm, mh = {
	muted: "#000001",
	accent: "#000002",
	success: "#000003",
	danger: "#000004",
	info: "#000005",
	secondary: "#000006",
	error: "#000007",
	fg: "#000008",
	inserted: "#000009"
}, hh = {
	[mh.muted]: "var(--color-code-comment)",
	[mh.accent]: "var(--color-code-keyword)",
	[mh.success]: "var(--color-code-string)",
	[mh.danger]: "var(--color-code-number)",
	[mh.info]: "var(--color-code-function)",
	[mh.secondary]: "var(--color-code-variable)",
	[mh.error]: "var(--color-text-error-primary)",
	[mh.fg]: "var(--color-text-basic-primary)",
	[mh.inserted]: "var(--color-text-success-primary)"
};
function gh(e, t, n) {
	return {
		scope: e,
		settings: n ? {
			foreground: t,
			fontStyle: n
		} : { foreground: t }
	};
}
function _h(e, t) {
	return {
		scope: e,
		settings: { fontStyle: t }
	};
}
var vh = {
	name: "nac",
	type: "light",
	fg: mh.fg,
	bg: "#000000",
	colorReplacements: hh,
	settings: [
		{ settings: {
			foreground: mh.fg,
			background: "#000000"
		} },
		gh(["comment", "punctuation.definition.comment"], mh.muted, "italic"),
		gh([
			"keyword",
			"storage",
			"storage.type",
			"support.type",
			"entity.name.type",
			"entity.name.tag"
		], mh.accent),
		gh(["string", "string.regexp"], mh.success),
		gh("markup.inserted", mh.inserted),
		gh([
			"constant.numeric",
			"constant.language",
			"constant.character",
			"markup.list"
		], mh.danger),
		gh([
			"entity.name.function",
			"support.function",
			"entity.name.section",
			"entity.name.class",
			"entity.name.type.class"
		], mh.info),
		gh(["variable", "entity.other.attribute-name"], mh.secondary),
		gh("markup.deleted", mh.error),
		_h(["markup.italic", "markup.quote"], "italic"),
		_h("markup.bold", "bold")
	]
};
// src/app/lib/highlight.ts
function yh(e) {
	return {
		color: e.color ?? void 0,
		fontStyle: e.italic ? "italic" : void 0,
		fontWeight: e.bold ? 600 : void 0
	};
}
var bh = {
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
}, xh = {
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
}, Sh = /* @__PURE__ */ new Set([
	"plain",
	"plaintext",
	"text",
	"txt"
]), Ch = 1, wh = 2, Th = 50, Eh = /* @__PURE__ */ new Map(), Dh = {
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
}, Oh = null, kh = /* @__PURE__ */ new Map();
function Ah(e) {
	let t = e.replace(/\/+$/, "").split("/").pop() ?? "";
	return bh[((t.includes(".") ? t.split(".").pop() : "") ?? "").toLowerCase()] ?? null;
}
function jh(e) {
	let t = e.trim().toLowerCase();
	if (!t || Sh.has(t)) return null;
	let n = xh[t] ?? t;
	return n in Dh ? n : null;
}
function Mh() {
	return Oh ??= (async () => {
		let [{ createHighlighterCore: e }, { createJavaScriptRegexEngine: t }] = await Promise.all([import("./core-DsPjBpwQ.js"), import("./engine-javascript-DVxm-Bxk.js")]);
		return e({
			themes: [vh],
			langs: [],
			engine: t()
		});
	})(), Oh;
}
async function Nh(e) {
	let t = Dh[e];
	if (!t) return !1;
	try {
		let n = await Mh();
		return n.getLoadedLanguages().includes(e) ? !0 : (await n.loadLanguage(t()), n.getLoadedLanguages().includes(e));
	} catch {
		return !1;
	}
}
function Ph(e) {
	let t = kh.get(e);
	return t || (t = Nh(e), kh.set(e, t)), t;
}
function Fh(e) {
	let t = e.fontStyle ?? 0, n = {
		text: e.content,
		color: e.color || null
	};
	return t & Ch && (n.italic = !0), t & wh && (n.bold = !0), n;
}
function Ih(e) {
	return e.map((e) => e.map(Fh));
}
function Lh(e) {
	return e.map((e) => e.map((e) => e.text).join("")).join("\n");
}
function Rh(e, t) {
	return `${e}\0${t}`;
}
function zh(e) {
	if (!Eh.has(e)) return;
	let t = Eh.get(e) ?? null;
	return Eh.delete(e), Eh.set(e, t), t;
}
function Bh(e, t) {
	if (Eh.set(e, t), Eh.size <= Th) return;
	let n = Eh.keys().next().value;
	n !== void 0 && Eh.delete(n);
}
async function Vh(e, t) {
	let n = Rh(e, t), r = zh(n);
	if (r !== void 0) return r;
	if (!await Ph(e)) return Bh(n, null), null;
	let i;
	try {
		i = Ih((await Mh()).codeToTokensBase(t, {
			lang: e,
			theme: "nac",
			colorReplacements: hh
		}));
	} catch {
		return Bh(n, null), null;
	}
	return Lh(i) === t ? (Bh(n, i), i) : (Bh(n, null), null);
}
async function Hh(e, t) {
	let n = jh(e);
	return n ? Vh(n, t) : null;
}
async function Uh(e, t) {
	let n = Ah(e);
	return n ? Vh(n, t) : null;
}
var Wh = /* @__PURE__ */ new Set(["delete", "context"]), Gh = /* @__PURE__ */ new Set(["insert", "context"]);
async function Kh(e, t) {
	let n = /* @__PURE__ */ new Map(), r = Ah(e);
	if (!r) return n;
	for (let e of t) for (let t of e.hunks) for (let e of [Wh, Gh]) {
		let i = t.lines.filter((t) => e.has(t.kind));
		if (i.length === 0) continue;
		let a = await Vh(r, i.map((e) => e.content).join("\n"));
		a && a.length === i.length && i.forEach((e, t) => n.set(e, a[t]));
	}
	return n;
}
// src/app/atoms/code-block/index.tsx
var qh = /* @__PURE__ */ function(e) {
	return e.Small = "code-small", e.Medium = "code-medium", e.Large = "code-large", e;
}({}), Jh = ({ code: e, lines: t, lineNumbers: n, wrap: r }) => {
	let i = e.split("\n"), a = t?.length ?? i.length;
	return /* @__PURE__ */ A("div", {
		className: "flex min-w-0",
		children: [n ? /* @__PURE__ */ k("div", {
			"aria-hidden": "true",
			className: "shrink-0 select-none py-3 pl-4 pr-3 text-right tabular text-basic-muted border-r border-muted",
			children: Array.from({ length: a }, (e, t) => /* @__PURE__ */ k("div", { children: t + 1 }, t))
		}) : null, /* @__PURE__ */ k("pre", {
			className: F("flex-1 min-w-0 py-3 px-4 text-basic-primary", r ? "whitespace-pre-wrap break-words" : "overflow-x-auto"),
			children: /* @__PURE__ */ k("code", { children: t ? t.map((e, t) => /* @__PURE__ */ k("div", { children: e.length === 0 ? "\xA0" : e.map((e, t) => /* @__PURE__ */ k("span", {
				style: yh(e),
				children: e.text
			}, t)) }, t)) : i.map((e, t) => /* @__PURE__ */ k("div", { children: e || "\xA0" }, t)) })
		})]
	});
}, Yh = ({ code: e, language: t, size: n = "code-small", title: r, lineNumbers: i = !1, wrap: a = !1, copyable: o = !0, expandable: s = !1, maxHeight: c, className: l = "" }) => {
	let [u, d] = w(!1), [f, p] = w(null);
	v(() => {
		if (!t) return;
		let n = !0;
		return Hh(t, e).then((r) => {
			n && p({
				code: e,
				language: t,
				lines: r
			});
		}), () => {
			n = !1;
		};
	}, [t, e]);
	let m = f?.code === e && f.language === t ? f.lines : null, h = /* @__PURE__ */ k(Jh, {
		code: e,
		lines: m,
		lineNumbers: i,
		wrap: a
	}), g = r || o || s;
	return /* @__PURE__ */ A("div", {
		className: F("flex flex-col min-w-0 rounded-card overflow-hidden", "bg-[var(--color-code-bg)] border border-tertiary", "code [&>*]:shrink-0", n, l),
		children: [
			g ? /* @__PURE__ */ A("div", {
				className: "flex h-9 items-center gap-1 border-b border-muted pl-4 pr-1.5",
				children: [
					/* @__PURE__ */ k("div", {
						className: "flex-1 min-w-0 truncate type-meta text-basic-tertiary",
						children: r ?? t
					}),
					o ? /* @__PURE__ */ k(nh, {
						value: e,
						title: "Copy code"
					}) : null,
					s ? /* @__PURE__ */ k(Qm, {
						variant: Km.Tertiary,
						size: Gm.Small,
						content: qm.Icon,
						"aria-label": "Expand code",
						onClick: () => d(!0),
						children: /* @__PURE__ */ k(ls, { iconName: ss.FullScreen })
					}) : null
				]
			}) : null,
			/* @__PURE__ */ k("div", {
				className: "min-w-0 overflow-auto",
				style: { maxHeight: c },
				children: h
			}),
			s ? /* @__PURE__ */ k(fh, {
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
Yh.Size = qh;
// src/app/atoms/toast/Toast.tsx
var Xh = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Success = "success", e.Error = "error", e.Danger = "danger", e;
}({}), Zh = {
	info: "nac-toast-ink bg-elevation-ground-inverse text-primary-inverse",
	success: "nac-toast-ink bg-elevation-ground-inverse text-primary-inverse",
	error: "bg-elevation-level-3 text-error-primary",
	danger: "bg-elevation-level-3 text-basic-primary"
}, Qh = {
	info: "text-secondary-inverse",
	success: "text-secondary-inverse",
	error: "text-error-primary",
	danger: "text-danger-tertiary"
}, $h = {
	info: ss.Info,
	success: ss.CheckCircle,
	error: ss.Danger,
	danger: ss.Danger
}, eg = ({ content: e, variant: t, dismissing: n, onClose: r }) => {
	let [i, a] = w(!1);
	v(() => {
		let e = requestAnimationFrame(() => a(!0));
		return () => cancelAnimationFrame(e);
	}, []);
	let o = i && !n, s = t === "error" || t === "danger";
	return /* @__PURE__ */ k("div", {
		className: "nac-toast pointer-events-none flex w-full justify-center",
		"data-visible": o,
		children: /* @__PURE__ */ A("div", {
			className: F("nac-toast-content pointer-events-auto relative flex max-w-full items-start gap-2 rounded-sheet py-1.5 pr-1.5 pl-3.5 shadow-lg", Zh[t]),
			children: [
				/* @__PURE__ */ k(ls, {
					iconName: $h[t],
					size: 16,
					className: F("mt-[6px] shrink-0", Qh[t])
				}),
				/* @__PURE__ */ k("span", {
					role: s ? "alert" : "status",
					"aria-atomic": "true",
					className: "nac-toast-message type-body-chrome min-w-0 flex-grow py-[4px] break-words [overflow-wrap:anywhere] whitespace-pre-line",
					children: e
				}),
				/* @__PURE__ */ k(Qm, {
					variant: Qm.Variant.Ghost,
					size: Qm.Size.Small,
					content: Qm.Content.Icon,
					className: "nac-toast-dismiss !size-7 shrink-0 max-md:!size-11 max-md:-my-2 max-md:-mr-1",
					"aria-label": "Dismiss notification",
					onClick: r,
					children: /* @__PURE__ */ k(ls, { iconName: ss.Close })
				})
			]
		})
	});
}, tg = 5e3, L = {
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
}, ng = (e) => typeof e == "function", R = function(e, t) {
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
}, rg = (e) => e, ig = (e) => () => e, ag = /*#__PURE__*/ ig(!0), og = /*#__PURE__*/ ig(!1), sg = /*#__PURE__*/ ig(void 0), cg = sg;
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
var lg = (e) => (t, n) => t === n || e(t, n), ug = /*#__PURE__*/ R(2, (e, t) => lg((n, r) => e(t(n), t(r)))), dg = (e) => lg((t, n) => {
	if (t.length !== n.length) return !1;
	for (let r = 0; r < t.length; r++) if (!e(t[r], n[r])) return !1;
	return !0;
}), fg = "effect/GlobalValue", pg, B = (e, t) => (pg ||= (globalThis[fg] ??= /* @__PURE__ */ new Map(), globalThis[fg]), pg.has(e) || pg.set(e, t()), pg.get(e)), mg = (e) => typeof e == "string", hg = (e) => typeof e == "number", gg = (e) => typeof e == "bigint", _g = ng, vg = (e) => typeof e == "object" && !!e, yg = (e) => vg(e) || _g(e), V = /*#__PURE__*/ R(2, (e, t) => yg(e) && t in e), bg = /*#__PURE__*/ R(2, (e, t) => V(e, "_tag") && e._tag === t), xg = (e) => e == null, Sg = (e) => typeof e == "string" || V(e, Symbol.iterator), Cg = (e) => V(e, "then") && _g(e.then), wg = (e) => `BUG: ${e} - please report an issue at https://github.com/Effect-TS/effect/issues`, Tg = class e {
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
}, Eg = 335903614, Dg = 4150755663, Og = 1481765933, kg = 1284865837, Ag = 9007199254740992, jg = 134217728, Mg = class {
	_state;
	constructor(e, t, n, r) {
		return xg(t) && xg(e) ? (t = Math.random() * 4294967295 >>> 0, e = 0) : xg(t) && (t = e, e = 0), xg(r) && xg(n) ? (r = this._state ? this._state[3] : Dg, n = this._state ? this._state[2] : Eg) : xg(r) && (r = n, n = 0), this._state = new Int32Array([
			0,
			0,
			n >>> 0,
			((r || 0) | 1) >>> 0
		]), this._next(), Pg(this._state, this._state[0], this._state[1], e >>> 0, t >>> 0), this._next(), this;
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
		return (e * jg + t) / Ag;
	}
	_next() {
		let e = this._state[0] >>> 0, t = this._state[1] >>> 0;
		Ng(this._state, e, t, Og, kg), Pg(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
		let n = e >>> 18, r = (t >>> 18 | e << 14) >>> 0;
		n = (n ^ e) >>> 0, r = (r ^ t) >>> 0;
		let i = (r >>> 27 | n << 5) >>> 0, a = e >>> 27, o = (-a >>> 0 & 31) >>> 0;
		return (i >>> a | i << o) >>> 0;
	}
};
function Ng(e, t, n, r, i) {
	let a = (n >>> 16) * (i & 65535) >>> 0, o = (n & 65535) * (i >>> 16) >>> 0, s = (n & 65535) * (i & 65535) >>> 0, c = (n >>> 16) * (i >>> 16) + ((o >>> 16) + (a >>> 16)) >>> 0;
	o = o << 16 >>> 0, s = s + o >>> 0, s >>> 0 < o >>> 0 && (c = c + 1 >>> 0), a = a << 16 >>> 0, s = s + a >>> 0, s >>> 0 < a >>> 0 && (c = c + 1 >>> 0), c = c + Math.imul(n, r) >>> 0, c = c + Math.imul(t, i) >>> 0, e[0] = c, e[1] = s;
}
function Pg(e, t, n, r, i) {
	let a = t + r >>> 0, o = n + i >>> 0;
	o >>> 0 < n >>> 0 && (a = a + 1 | 0), e[0] = a, e[1] = o;
}
var Fg = /*#__PURE__*/ Symbol.for("effect/Utils/YieldWrap"), Ig = class {
	#e;
	constructor(e) {
		this.#e = e;
	}
	[Fg]() {
		return this.#e;
	}
};
function Lg(e) {
	if (typeof e == "object" && e && Fg in e) return e[Fg]();
	throw Error(wg("yieldWrapGet"));
}
var Rg = /*#__PURE__*/ B("effect/Utils/isStructuralRegion", () => ({
	enabled: !1,
	tester: void 0
})), zg = { effect_internal_function: (e) => e() }, Bg = /*#__PURE__*/ zg.effect_internal_function(() => (/* @__PURE__ */ Error()).stack)?.includes("effect_internal_function") === !0 ? zg.effect_internal_function : { effect_internal_function: (e) => {
	try {
		return e();
	} finally {}
} }.effect_internal_function;
(function* () {}).constructor;
// node_modules/effect/dist/esm/Hash.js
var Vg = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Hash/randomHashCache"), () => /* @__PURE__ */ new WeakMap()), H = /*#__PURE__*/ Symbol.for("effect/Hash"), U = (e) => {
	if (Rg.enabled === !0) return 0;
	switch (typeof e) {
		case "number": return Gg(e);
		case "bigint": return Kg(e.toString(10));
		case "boolean": return Kg(String(e));
		case "symbol": return Kg(String(e));
		case "string": return Kg(e);
		case "undefined": return Kg("undefined");
		case "function":
		case "object": return e === null ? Kg("null") : e instanceof Date ? Number.isNaN(e.getTime()) ? Kg("Invalid Date") : U(e.toISOString()) : e instanceof URL ? U(e.href) : Wg(e) ? e[H]() : Hg(e);
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, Hg = (e) => (Vg.has(e) || Vg.set(e, Gg(Math.floor(Math.random() * (2 ** 53 - 1)))), Vg.get(e)), W = (e) => (t) => t * 53 ^ e, Ug = (e) => e & 3221225471 | e >>> 1 & 1073741824, Wg = (e) => V(e, H), Gg = (e) => {
	if (e !== e || e === Infinity) return 0;
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return Ug(t);
}, Kg = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return Ug(t);
}, qg = (e, t) => {
	let n = 12289;
	for (let r = 0; r < t.length; r++) n ^= z(Kg(t[r]), W(U(e[t[r]])));
	return Ug(n);
}, Jg = (e) => qg(e, Object.keys(e)), Yg = (e) => {
	let t = 6151;
	for (let n = 0; n < e.length; n++) t = z(t, W(U(e[n])));
	return Ug(t);
}, Xg = function() {
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
	return arguments.length === 1 ? (e) => Zg(e, arguments[0]) : Zg(arguments[0], arguments[1]);
}
function Zg(e, t) {
	if (e === t) return !0;
	let n = typeof e;
	if (n !== typeof t) return !1;
	if (n === "object" || n === "function") {
		if (e !== null && t !== null) {
			if (Qg(e) && Qg(t)) return U(e) === U(t) && e[G](t) ? !0 : Rg.enabled && Rg.tester ? Rg.tester(e, t) : !1;
			if (e instanceof Date && t instanceof Date) {
				let n = e.getTime(), r = t.getTime();
				return n === r || Number.isNaN(n) && Number.isNaN(r);
			}
			if (e instanceof URL && t instanceof URL) return e.href === t.href;
		}
		if (Rg.enabled) {
			if (e === null || t === null) return !1;
			if (Array.isArray(e) && Array.isArray(t)) return e.length === t.length && e.every((e, n) => Zg(e, t[n]));
			if (Object.getPrototypeOf(e) === Object.prototype && Object.getPrototypeOf(t) === Object.prototype) {
				let n = Object.keys(e), r = Object.keys(t);
				if (n.length === r.length) {
					for (let r of n) if (!(r in t && Zg(e[r], t[r]))) return Rg.tester ? Rg.tester(e, t) : !1;
					return !0;
				}
			}
			return Rg.tester ? Rg.tester(e, t) : !1;
		}
	}
	return Rg.enabled && Rg.tester ? Rg.tester(e, t) : !1;
}
var Qg = (e) => V(e, G), $g = () => K, e_ = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), t_ = (e) => {
	try {
		if (V(e, "toJSON") && _g(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(t_);
	} catch {
		return {};
	}
	return l_(e);
}, n_ = (e) => JSON.stringify(e, null, 2), r_ = (e, t = 2) => {
	if (typeof e == "string") return e;
	try {
		return typeof e == "object" ? i_(e, t) : String(e);
	} catch {
		return String(e);
	}
}, i_ = (e, t) => {
	let n = [], r = JSON.stringify(e, (e, t) => typeof t == "object" && t ? n.includes(t) ? void 0 : n.push(t) && (s_.fiberRefs !== void 0 && o_(t) ? t[a_](s_.fiberRefs) : t) : t, t);
	return n = void 0, r;
}, a_ = /*#__PURE__*/ Symbol.for("effect/Inspectable/Redactable"), o_ = (e) => typeof e == "object" && !!e && a_ in e, s_ = /*#__PURE__*/ B("effect/Inspectable/redactableState", () => ({ fiberRefs: void 0 })), c_ = (e, t) => {
	let n = s_.fiberRefs;
	s_.fiberRefs = e;
	try {
		return t();
	} finally {
		s_.fiberRefs = n;
	}
}, l_ = (e) => o_(e) && s_.fiberRefs !== void 0 ? e[a_](s_.fiberRefs) : e, q = (e, t) => {
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
}, u_ = "Async", d_ = "Commit", f_ = "Failure", p_ = "OnFailure", m_ = "OnSuccess", h_ = "OnSuccessAndFailure", g_ = "Success", __ = "Sync", v_ = "UpdateRuntimeFlags", y_ = "While", b_ = "Iterator", x_ = "WithRuntime", S_ = "Yield", C_ = "RevertFlags", w_ = "3.22.2", T_ = () => w_, E_ = /*#__PURE__*/ Symbol.for("effect/Effect"), D_ = /*#__PURE__*/ Symbol.for("effect/Stream"), O_ = /*#__PURE__*/ Symbol.for("effect/Sink"), k_ = /*#__PURE__*/ Symbol.for("effect/Channel"), A_ = {
	/* c8 ignore next */
	_R: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e,
	_V: /*#__PURE__*/ T_()
}, j_ = {
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
}, M_ = {
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
}, N_ = {
	[E_]: A_,
	[D_]: A_,
	[O_]: j_,
	[k_]: M_,
	[G](e) {
		return this === e;
	},
	[H]() {
		return Xg(this, Hg(this));
	},
	[Symbol.iterator]() {
		return new Tg(new Ig(this));
	},
	pipe() {
		return q(this, arguments);
	}
}, P_ = {
	[H]() {
		return Xg(this, Jg(this));
	},
	[G](e) {
		let t = Object.keys(this), n = Object.keys(e);
		if (t.length !== n.length) return !1;
		for (let n of t) if (!(n in e && K(this[n], e[n]))) return !1;
		return !0;
	}
}, F_ = {
	...N_,
	_op: d_
}, I_ = {
	...F_,
	...P_
}, L_ = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = F_, e;
}(), R_ = /*#__PURE__*/ Symbol.for("effect/Option"), z_ = {
	...N_,
	[R_]: { _A: (e) => e },
	[e_]() {
		return this.toJSON();
	},
	toString() {
		return n_(this.toJSON());
	}
}, B_ = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(z_), {
	_tag: "Some",
	_op: "Some",
	[G](e) {
		return U_(e) && G_(e) && K(this.value, e.value);
	},
	[H]() {
		return Xg(this, W(U(this._tag))(U(this.value)));
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag,
			value: t_(this.value)
		};
	}
}), V_ = /*#__PURE__*/ U("None"), H_ = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(z_), {
	_tag: "None",
	_op: "None",
	[G](e) {
		return U_(e) && W_(e);
	},
	[H]() {
		return V_;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), U_ = (e) => V(e, R_), W_ = (e) => e._tag === "None", G_ = (e) => e._tag === "Some", K_ = /*#__PURE__*/ Object.create(H_), q_ = (e) => {
	let t = Object.create(B_);
	return t.value = e, t;
}, J_ = /*#__PURE__*/ Symbol.for("effect/Either"), Y_ = {
	...N_,
	[J_]: { _R: (e) => e },
	[e_]() {
		return this.toJSON();
	},
	toString() {
		return n_(this.toJSON());
	}
}, X_ = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Y_), {
	_tag: "Right",
	_op: "Right",
	[G](e) {
		return Q_(e) && ev(e) && K(this.right, e.right);
	},
	[H]() {
		return W(U(this._tag))(U(this.right));
	},
	toJSON() {
		return {
			_id: "Either",
			_tag: this._tag,
			right: t_(this.right)
		};
	}
}), Z_ = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Y_), {
	_tag: "Left",
	_op: "Left",
	[G](e) {
		return Q_(e) && $_(e) && K(this.left, e.left);
	},
	[H]() {
		return W(U(this._tag))(U(this.left));
	},
	toJSON() {
		return {
			_id: "Either",
			_tag: this._tag,
			left: t_(this.left)
		};
	}
}), Q_ = (e) => V(e, J_), $_ = (e) => e._tag === "Left", ev = (e) => e._tag === "Right", tv = (e) => {
	let t = Object.create(Z_);
	return t.left = e, t;
}, nv = (e) => {
	let t = Object.create(X_);
	return t.right = e, t;
}, rv = tv, iv = $_, av = ev, ov = /*#__PURE__*/ (/* @__PURE__ */ R(2, (e, { onLeft: t, onRight: n }) => iv(e) ? t(e.left) : n(e.right)))({
	onLeft: rg,
	onRight: rg
}), sv = (e) => e.length > 0, cv = (e) => (t, n) => t === n ? 0 : e(t, n), lv = /*#__PURE__*/ cv((e, t) => e < t ? -1 : 1), uv = /*#__PURE__*/ R(2, (e, t) => cv((n, r) => e(t(n), t(r)))), dv = (e) => R(2, (t, n) => e(t, n) === 1), J = () => K_, Y = q_, fv = W_, pv = G_, mv = /*#__PURE__*/ R(2, (e, { onNone: t, onSome: n }) => fv(e) ? t() : n(e.value)), hv = /*#__PURE__*/ R(2, (e, t) => fv(e) ? t() : e.value), gv = /*#__PURE__*/ R(2, (e, t) => fv(e) ? Y(t()) : e), _v = (e) => e == null ? J() : Y(e), vv = /*#__PURE__*/ hv(sg), yv = /*#__PURE__*/ R(2, (e, t) => fv(e) ? J() : Y(t(e.value))), bv = /*#__PURE__*/ R(2, (e, t) => fv(e) ? J() : t(e.value)), xv = /*#__PURE__*/ ((e) => R(2, (t, n) => !fv(t) && e(t.value, n)))(/* @__PURE__ */ $g()), Sv = (...e) => e, Cv = (e) => Array(e), wv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Math.max(1, Math.floor(e)), r = Array(n);
	for (let e = 0; e < n; e++) r[e] = t(e);
	return r;
}), Tv = (e) => Array.isArray(e) ? e : Array.from(e), Ev = (e) => Array.isArray(e) ? e : [e], Dv = /*#__PURE__*/ R(2, (e, t) => [t, ...e]), Ov = /*#__PURE__*/ R(2, (e, t) => [...e, t]), kv = /*#__PURE__*/ R(2, (e, t) => Tv(e).concat(Tv(t)));
Array.isArray;
var Av = (e) => e.length === 0, jv = sv, Mv = sv, Nv = (e, t) => e < 0 || e >= t.length, Pv = (e, t) => Math.floor(Math.min(Math.max(0, e), t.length)), Fv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Math.floor(t);
	return Nv(n, e) ? J() : Y(e[n]);
}), Iv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Math.floor(t);
	if (Nv(n, e)) throw Error(`Index ${n} out of bounds`);
	return e[n];
}), Lv = /*#__PURE__*/ Fv(0), Rv = /*#__PURE__*/ Iv(0), zv = (e) => Mv(e) ? Y(Bv(e)) : J(), Bv = (e) => e[e.length - 1], Vv = (e) => e.slice(1), Hv = (e, t) => {
	let n = 0;
	for (let r of e) {
		if (!t(r, n)) break;
		n++;
	}
	return n;
}, Uv = /*#__PURE__*/ R(2, (e, t) => Xv(e, Hv(e, t))), Wv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Tv(e);
	return n.slice(Pv(t, n), n.length);
}), Gv = (e) => Array.from(e).reverse(), Kv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Array.from(e);
	return n.sort(t), n;
}), qv = /*#__PURE__*/ R(2, (e, t) => Jv(e, t, Sv)), Jv = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = Tv(e), i = Tv(t);
	if (Mv(r) && Mv(i)) {
		let e = [n(Rv(r), Rv(i))], t = Math.min(r.length, i.length);
		for (let a = 1; a < t; a++) e[a] = n(r[a], i[a]);
		return e;
	}
	return [];
}), Yv = /*#__PURE__*/ $g(), Xv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Array.from(e), r = Math.floor(t);
	return Mv(n) ? r >= 1 ? Zv(n, r) : [[], n] : [n, []];
}), Zv = /*#__PURE__*/ R(2, (e, t) => {
	let n = Math.max(1, Math.floor(t));
	return n >= e.length ? [Qv(e), []] : [Dv(e.slice(1, n), Rv(e)), e.slice(n)];
}), Qv = (e) => e.slice(), $v = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = Tv(e), i = Tv(t);
	return Mv(r) ? Mv(i) ? cy(n)(kv(r, i)) : r : i;
}), ey = /*#__PURE__*/ R(2, (e, t) => $v(e, t, Yv)), ty = () => [], ny = (e) => [e], ry = /*#__PURE__*/ R(2, (e, t) => e.map(t)), iy = /*#__PURE__*/ (/* @__PURE__ */ R(2, (e, t) => {
	if (Av(e)) return [];
	let n = [];
	for (let r = 0; r < e.length; r++) {
		let i = t(e[r], r);
		for (let e = 0; e < i.length; e++) n.push(i[e]);
	}
	return n;
}))(rg), ay = /*#__PURE__*/ R(3, (e, t, n) => Tv(e).reduce((e, t, r) => n(e, t, r), t)), oy = (e, t) => {
	let n = [], r = e, i;
	for (; pv(i = t(r));) {
		let [e, t] = i.value;
		n.push(e), r = t;
	}
	return n;
}, sy = dg, cy = /*#__PURE__*/ R(2, (e, t) => {
	let n = Tv(e);
	if (Mv(n)) {
		let e = [Rv(n)], r = Vv(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), ly = (e) => cy(e, $g()), uy = /*#__PURE__*/ R(2, (e, t) => Tv(e).join(t)), dy = lv, fy = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"), py = /*#__PURE__*/ Symbol.for("effect/Context/Tag"), my = /*#__PURE__*/ Symbol.for("effect/Context/Reference"), hy = /*#__PURE__*/ Symbol.for("effect/STM"), gy = {
	...N_,
	_op: "Tag",
	[hy]: A_,
	[py]: {
		_Service: (e) => e,
		_Identifier: (e) => e
	},
	toString() {
		return n_(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Tag",
			key: this.key,
			stack: this.stack
		};
	},
	[e_]() {
		return this.toJSON();
	},
	of(e) {
		return e;
	},
	context(e) {
		return Ay(this, e);
	}
}, _y = {
	...gy,
	[my]: my
}, vy = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	let r = Object.create(gy);
	return Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r.key = e, r;
}, yy = (e) => () => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let n = /* @__PURE__ */ Error();
	Error.stackTraceLimit = t;
	function r() {}
	return Object.setPrototypeOf(r, gy), r.key = e, Object.defineProperty(r, "stack", { get() {
		return n.stack;
	} }), r;
}, by = () => (e, t) => {
	let n = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let r = /* @__PURE__ */ Error();
	Error.stackTraceLimit = n;
	function i() {}
	return Object.setPrototypeOf(i, _y), i.key = e, i.defaultValue = t.defaultValue, Object.defineProperty(i, "stack", { get() {
		return r.stack;
	} }), i;
}, xy = /*#__PURE__*/ Symbol.for("effect/Context"), Sy = {
	[xy]: { _Services: (e) => e },
	[G](e) {
		if (Ty(e) && this.unsafeMap.size === e.unsafeMap.size) {
			for (let t of this.unsafeMap.keys()) if (!e.unsafeMap.has(t) || !K(this.unsafeMap.get(t), e.unsafeMap.get(t))) return !1;
			return !0;
		}
		return !1;
	},
	[H]() {
		return Xg(this, Gg(this.unsafeMap.size));
	},
	pipe() {
		return q(this, arguments);
	},
	toString() {
		return n_(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Context",
			services: Array.from(this.unsafeMap).map(t_)
		};
	},
	[e_]() {
		return this.toJSON();
	}
}, Cy = (e) => {
	let t = Object.create(Sy);
	return t.unsafeMap = e, t;
}, wy = (e) => {
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
}, Ty = (e) => V(e, xy), Ey = (e) => V(e, py), Dy = (e) => V(e, my), Oy = /*#__PURE__*/ Cy(/*#__PURE__*/ new Map()), ky = () => Oy, Ay = (e, t) => Cy(/* @__PURE__ */ new Map([[e.key, t]])), jy = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = new Map(e.unsafeMap);
	return r.set(t.key, n), Cy(r);
}), My = /*#__PURE__*/ B("effect/Context/defaultValueCache", () => /* @__PURE__ */ new Map()), Ny = (e) => {
	if (My.has(e.key)) return My.get(e.key);
	let t = e.defaultValue();
	return My.set(e.key, t), t;
}, Py = (e, t) => e.unsafeMap.has(t.key) ? e.unsafeMap.get(t.key) : Ny(t), Fy = /*#__PURE__*/ R(2, (e, t) => {
	if (!e.unsafeMap.has(t.key)) {
		if (my in t) return Ny(t);
		throw wy(t);
	}
	return e.unsafeMap.get(t.key);
}), Iy = Fy, Ly = /*#__PURE__*/ R(2, (e, t) => e.unsafeMap.has(t.key) ? q_(e.unsafeMap.get(t.key)) : Dy(t) ? q_(Ny(t)) : K_), Ry = /*#__PURE__*/ R(2, (e, t) => {
	let n = new Map(e.unsafeMap);
	for (let [e, r] of t.unsafeMap) n.set(e, r);
	return Cy(n);
}), zy = (...e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n = 0; n < e.length; n++) e[n].unsafeMap.forEach((e, n) => {
		t.set(n, e);
	});
	return Cy(t);
}, By = vy, Vy = Ty, Hy = Ey, Uy = ky, Wy = Ay, Gy = jy, Ky = Iy, qy = Fy, Jy = Ly, Yy = Ry, Xy = zy, Zy = yy, Qy = by, $y = /*#__PURE__*/ Symbol.for("effect/Chunk");
function eb(e, t, n, r, i) {
	for (let a = t; a < Math.min(e.length, t + i); a++) n[r + a - t] = e[a];
	return n;
}
var tb = [], nb = /*#__PURE__*/ ((e) => lg((t, n) => t.length === n.length && fb(t).every((t, r) => e(t, _b(n, r)))))(K), rb = {
	[$y]: { _A: (e) => e },
	toString() {
		return n_(this.toJSON());
	},
	toJSON() {
		return {
			_id: "Chunk",
			values: fb(this).map(t_)
		};
	},
	[e_]() {
		return this.toJSON();
	},
	[G](e) {
		return ab(e) && nb(this, e);
	},
	[H]() {
		return Xg(this, Yg(fb(this)));
	},
	[Symbol.iterator]() {
		switch (this.backing._tag) {
			case "IArray": return this.backing.array[Symbol.iterator]();
			case "IEmpty": return tb[Symbol.iterator]();
			default: return fb(this)[Symbol.iterator]();
		}
	},
	pipe() {
		return q(this, arguments);
	}
}, ib = (e) => {
	let t = Object.create(rb);
	switch (t.backing = e, e._tag) {
		case "IEmpty":
			t.length = 0, t.depth = 0, t.left = t, t.right = t;
			break;
		case "IConcat":
			t.length = e.left.length + e.right.length, t.depth = 1 + Math.max(e.left.depth, e.right.depth), t.left = e.left, t.right = e.right;
			break;
		case "IArray":
			t.length = e.array.length, t.depth = 0, t.left = ob, t.right = ob;
			break;
		case "ISingleton":
			t.length = 1, t.depth = 0, t.left = ob, t.right = ob;
			break;
		case "ISlice": t.length = e.length, t.depth = e.chunk.depth + 1, t.left = ob, t.right = ob;
	}
	return t;
}, ab = (e) => V(e, $y), ob = /*#__PURE__*/ ib({ _tag: "IEmpty" }), sb = () => ob, cb = (...e) => gb(e), lb = (e) => ib({
	_tag: "ISingleton",
	a: e
}), ub = (e) => ab(e) ? e : hb(Tv(e)), db = (e, t, n) => {
	switch (e.backing._tag) {
		case "IArray":
			eb(e.backing.array, 0, t, n, e.length);
			break;
		case "IConcat":
			db(e.left, t, n), db(e.right, t, n + e.left.length);
			break;
		case "ISingleton":
			t[n] = e.backing.a;
			break;
		case "ISlice": {
			let r = 0, i = n;
			for (; r < e.length;) t[i] = _b(e, r), r += 1, i += 1;
			break;
		}
	}
}, fb = (e) => {
	switch (e.backing._tag) {
		case "IEmpty": return tb;
		case "IArray": return e.backing.array;
		default: {
			let t = Array(e.length);
			return db(e, t, 0), e.backing = {
				_tag: "IArray",
				array: t
			}, e.left = ob, e.right = ob, e.depth = 0, t;
		}
	}
}, pb = (e) => {
	switch (e.backing._tag) {
		case "IEmpty":
		case "ISingleton": return e;
		case "IArray": return ib({
			_tag: "IArray",
			array: Gv(e.backing.array)
		});
		case "IConcat": return ib({
			_tag: "IConcat",
			left: pb(e.backing.right),
			right: pb(e.backing.left)
		});
		case "ISlice": return hb(Gv(fb(e)));
	}
}, mb = /*#__PURE__*/ R(2, (e, t) => t < 0 || t >= e.length ? J() : Y(_b(e, t))), hb = (e) => e.length === 0 ? sb() : e.length === 1 ? lb(e[0]) : ib({
	_tag: "IArray",
	array: e
}), gb = (e) => hb(e), _b = /*#__PURE__*/ R(2, (e, t) => {
	switch (e.backing._tag) {
		case "IEmpty": throw Error("Index out of bounds");
		case "ISingleton":
			if (t !== 0) throw Error("Index out of bounds");
			return e.backing.a;
		case "IArray":
			if (t >= e.length || t < 0) throw Error("Index out of bounds");
			return e.backing.array[t];
		case "IConcat": return t < e.left.length ? _b(e.left, t) : _b(e.right, t - e.left.length);
		case "ISlice": return _b(e.backing.chunk, t + e.backing.offset);
	}
}), vb = /*#__PURE__*/ R(2, (e, t) => xb(e, lb(t))), yb = /*#__PURE__*/ R(2, (e, t) => xb(lb(t), e)), bb = /*#__PURE__*/ R(2, (e, t) => {
	if (t <= 0) return e;
	if (t >= e.length) return ob;
	switch (e.backing._tag) {
		case "ISlice": return ib({
			_tag: "ISlice",
			chunk: e.backing.chunk,
			offset: e.backing.offset + t,
			length: e.backing.length - t
		});
		case "IConcat": return t > e.left.length ? bb(e.right, t - e.left.length) : ib({
			_tag: "IConcat",
			left: bb(e.left, t),
			right: e.right
		});
		default: return ib({
			_tag: "ISlice",
			chunk: e,
			offset: t,
			length: e.length - t
		});
	}
}), xb = /*#__PURE__*/ R(2, (e, t) => {
	if (e.backing._tag === "IEmpty") return t;
	if (t.backing._tag === "IEmpty") return e;
	let n = t.depth - e.depth;
	if (Math.abs(n) <= 1) return ib({
		_tag: "IConcat",
		left: e,
		right: t
	});
	if (n < -1) {
		if (e.left.depth >= e.right.depth) {
			let n = xb(e.right, t);
			return ib({
				_tag: "IConcat",
				left: e.left,
				right: n
			});
		}
		{
			let n = xb(e.right.right, t);
			if (n.depth === e.depth - 3) {
				let t = ib({
					_tag: "IConcat",
					left: e.right.left,
					right: n
				});
				return ib({
					_tag: "IConcat",
					left: e.left,
					right: t
				});
			}
			return ib({
				_tag: "IConcat",
				left: ib({
					_tag: "IConcat",
					left: e.left,
					right: e.right.left
				}),
				right: n
			});
		}
	}
	if (t.right.depth >= t.left.depth) return ib({
		_tag: "IConcat",
		left: xb(e, t.left),
		right: t.right
	});
	{
		let n = xb(e, t.left.left);
		return n.depth === t.depth - 3 ? ib({
			_tag: "IConcat",
			left: ib({
				_tag: "IConcat",
				left: n,
				right: t.left.right
			}),
			right: t.right
		}) : ib({
			_tag: "IConcat",
			left: n,
			right: ib({
				_tag: "IConcat",
				left: t.left.right,
				right: t.right
			})
		});
	}
}), Sb = (e) => e.length === 0, Cb = (e) => e.length > 0, wb = /*#__PURE__*/ mb(0), Tb = (e) => _b(e, 0), Eb = Tb, Db = (e) => bb(e, 1), Ob = /*#__PURE__*/ Symbol.for("effect/Duration"), kb = /*#__PURE__*/ BigInt(0), Ab = /*#__PURE__*/ BigInt(24), jb = /*#__PURE__*/ BigInt(60), Mb = /*#__PURE__*/ BigInt(1e3), Nb = /*#__PURE__*/ BigInt(1e6), Pb = /*#__PURE__*/ BigInt(1e9), Fb = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Ib = (e) => {
	if (Vb(e)) return e;
	if (hg(e)) return qb(e);
	if (gg(e)) return Gb(e);
	if (Array.isArray(e) && e.length === 2 && e.every(hg)) return e[0] === -Infinity || e[1] === -Infinity || Number.isNaN(e[0]) || Number.isNaN(e[1]) ? Ub : e[0] === Infinity || e[1] === Infinity ? Wb : Gb(BigInt(Math.round(e[0] * 1e9)) + BigInt(Math.round(e[1])));
	if (mg(e)) {
		let t = Fb.exec(e);
		if (t) {
			let [e, n, r] = t, i = Number(n);
			switch (r) {
				case "nano":
				case "nanos": return Gb(BigInt(n));
				case "micro":
				case "micros": return Kb(BigInt(n));
				case "milli":
				case "millis": return qb(i);
				case "second":
				case "seconds": return Jb(i);
				case "minute":
				case "minutes": return Yb(i);
				case "hour":
				case "hours": return Xb(i);
				case "day":
				case "days": return Zb(i);
				case "week":
				case "weeks": return Qb(i);
			}
		}
	}
	throw Error("Invalid DurationInput");
}, Lb = {
	_tag: "Millis",
	millis: 0
}, Rb = { _tag: "Infinity" }, zb = {
	[Ob]: Ob,
	[H]() {
		return Xg(this, Jg(this.value));
	},
	[G](e) {
		return Vb(e) && sx(this, e);
	},
	toString() {
		return `Duration(${lx(this)})`;
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
				hrtime: tx(this)
			};
			case "Infinity": return {
				_id: "Duration",
				_tag: "Infinity"
			};
		}
	},
	[e_]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, Bb = (e) => {
	let t = Object.create(zb);
	return t.value = hg(e) ? isNaN(e) || e <= 0 ? Lb : Number.isFinite(e) ? Number.isInteger(e) ? {
		_tag: "Millis",
		millis: e
	} : {
		_tag: "Nanos",
		nanos: BigInt(Math.round(e * 1e6))
	} : Rb : e <= kb ? Lb : {
		_tag: "Nanos",
		nanos: e
	}, t;
}, Vb = (e) => V(e, Ob), Hb = (e) => {
	switch (e.value._tag) {
		case "Millis": return e.value.millis === 0;
		case "Nanos": return e.value.nanos === kb;
		case "Infinity": return !1;
	}
}, Ub = /*#__PURE__*/ Bb(0), Wb = /*#__PURE__*/ Bb(Infinity), Gb = (e) => Bb(e), Kb = (e) => Bb(e * Mb), qb = (e) => Bb(e), Jb = (e) => Bb(e * 1e3), Yb = (e) => Bb(e * 6e4), Xb = (e) => Bb(e * 36e5), Zb = (e) => Bb(e * 864e5), Qb = (e) => Bb(e * 6048e5), $b = (e) => nx(e, {
	onMillis: (e) => e,
	onNanos: (e) => Number(e) / 1e6
}), ex = (e) => {
	let t = Ib(e);
	switch (t.value._tag) {
		case "Infinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return BigInt(Math.round(t.value.millis * 1e6));
	}
}, tx = (e) => {
	let t = Ib(e);
	switch (t.value._tag) {
		case "Infinity": return [Infinity, 0];
		case "Nanos": return [Number(t.value.nanos / Pb), Number(t.value.nanos % Pb)];
		case "Millis": return [Math.floor(t.value.millis / 1e3), Math.round(t.value.millis % 1e3 * 1e6)];
	}
}, nx = /*#__PURE__*/ R(2, (e, t) => {
	let n = Ib(e);
	switch (n.value._tag) {
		case "Nanos": return t.onNanos(n.value.nanos);
		case "Infinity": return t.onMillis(Infinity);
		case "Millis": return t.onMillis(n.value.millis);
	}
}), rx = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = Ib(e), i = Ib(t);
	if (r.value._tag === "Infinity" || i.value._tag === "Infinity") return n.onMillis($b(r), $b(i));
	if (r.value._tag === "Nanos" || i.value._tag === "Nanos") {
		let e = r.value._tag === "Nanos" ? r.value.nanos : BigInt(Math.round(r.value.millis * 1e6)), t = i.value._tag === "Nanos" ? i.value.nanos : BigInt(Math.round(i.value.millis * 1e6));
		return n.onNanos(e, t);
	}
	return n.onMillis(r.value.millis, i.value.millis);
}), ix = (e, t) => rx(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t
}), ax = /*#__PURE__*/ R(2, (e, t) => rx(e, t, {
	onMillis: (e, t) => e <= t,
	onNanos: (e, t) => e <= t
})), ox = /*#__PURE__*/ R(2, (e, t) => rx(e, t, {
	onMillis: (e, t) => e >= t,
	onNanos: (e, t) => e >= t
})), sx = /*#__PURE__*/ R(2, (e, t) => ix(Ib(e), Ib(t))), cx = (e) => {
	let t = Ib(e);
	if (t.value._tag === "Infinity") return {
		days: Infinity,
		hours: Infinity,
		minutes: Infinity,
		seconds: Infinity,
		millis: Infinity,
		nanos: Infinity
	};
	let n = ex(t), r = n / Nb, i = r / Mb, a = i / jb, o = a / jb, s = o / Ab;
	return {
		days: Number(s),
		hours: Number(o % Ab),
		minutes: Number(a % jb),
		seconds: Number(i % jb),
		millis: Number(r % Mb),
		nanos: Number(n % Nb)
	};
}, lx = (e) => {
	let t = Ib(e);
	if (t.value._tag === "Infinity") return "Infinity";
	if (Hb(t)) return "0";
	let n = cx(t), r = [];
	return n.days !== 0 && r.push(`${n.days}d`), n.hours !== 0 && r.push(`${n.hours}h`), n.minutes !== 0 && r.push(`${n.minutes}m`), n.seconds !== 0 && r.push(`${n.seconds}s`), n.millis !== 0 && r.push(`${n.millis}ms`), n.nanos !== 0 && r.push(`${n.nanos}ns`), r.join(" ");
}, ux = 32, dx = ux - 1, fx = ux / 2, px = ux / 4;
// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function mx(e) {
	return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), e = e + (e >> 4) & 252645135, e += e >> 8, e += e >> 16, e & 127;
}
function hx(e, t) {
	return t >>> e & dx;
}
function gx(e) {
	return 1 << e;
}
function _x(e, t) {
	return mx(e & t - 1);
}
// node_modules/effect/dist/esm/internal/stack.js
var vx = (e, t) => ({
	value: e,
	previous: t
});
// node_modules/effect/dist/esm/internal/hashMap/array.js
function yx(e, t, n, r) {
	let i = r;
	if (!e) {
		let e = r.length;
		i = Array(e);
		for (let t = 0; t < e; ++t) i[t] = r[t];
	}
	return i[t] = n, i;
}
function bx(e, t, n) {
	let r = n.length - 1, i = 0, a = 0, o = n;
	if (e) i = a = t;
	else for (o = Array(r); i < t;) o[a++] = n[i++];
	for (++i; i <= r;) o[a++] = n[i++];
	return e && (o.length = r), o;
}
function xx(e, t, n, r) {
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
var Sx = class e {
	_tag = "EmptyNode";
	modify(t, n, r, i, a, o) {
		let s = r(J());
		return fv(s) ? new e() : (++o.value, new Ex(t, i, a, s));
	}
};
function Cx(e) {
	return bg(e, "EmptyNode");
}
function wx(e) {
	return Cx(e) || e._tag === "LeafNode" || e._tag === "CollisionNode";
}
function Tx(e, t) {
	return !Cx(e) && t === e.edit;
}
var Ex = class e {
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
			return n === this.value ? this : fv(n) ? (--o.value, new Sx()) : Tx(this, t) ? (this.value = n, this) : new e(t, i, a, n);
		}
		let s = r(J());
		return fv(s) ? this : (++o.value, Nx(t, n, this.hash, this, i, new e(t, i, a, s)));
	}
}, Dx = class e {
	edit;
	hash;
	children;
	_tag = "CollisionNode";
	constructor(e, t, n) {
		this.edit = e, this.hash = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		if (i === this.hash) {
			let n = Tx(this, t), i = this.updateCollisionList(n, t, this.hash, this.children, r, a, o);
			return i === this.children ? this : i.length > 1 ? new e(t, this.hash, i) : i[0];
		}
		let s = r(J());
		return fv(s) ? this : (++o.value, Nx(t, n, this.hash, this, i, new Ex(t, i, a, s)));
	}
	updateCollisionList(e, t, n, r, i, a, o) {
		let s = r.length;
		for (let c = 0; c < s; ++c) {
			let s = r[c];
			if ("key" in s && K(a, s.key)) {
				let l = s.value, u = i(l);
				return u === l ? r : fv(u) ? (--o.value, bx(e, c, r)) : yx(e, c, new Ex(t, n, a, u), r);
			}
		}
		let c = i(J());
		return fv(c) ? r : (++o.value, yx(e, s, new Ex(t, n, a, c), r));
	}
}, Ox = class e {
	edit;
	mask;
	children;
	_tag = "IndexedNode";
	constructor(e, t, n) {
		this.edit = e, this.mask = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.mask, c = this.children, l = hx(n, i), u = gx(l), d = _x(s, u), f = s & u, p = Tx(this, t);
		if (!f) {
			let f = new Sx().modify(t, n + 5, r, i, a, o);
			return f ? c.length >= fx ? jx(t, l, f, s, c) : new e(t, s | u, xx(p, d, f, c)) : this;
		}
		let m = c[d], h = m.modify(t, n + 5, r, i, a, o);
		if (m === h) return this;
		let g = s, _;
		if (Cx(h)) {
			if (g &= ~u, !g) return new Sx();
			if (c.length <= 2 && wx(c[d ^ 1])) return c[d ^ 1];
			_ = bx(p, d, c);
		} else _ = yx(p, d, h, c);
		return p ? (this.mask = g, this.children = _, this) : new e(t, g, _);
	}
}, kx = class e {
	edit;
	size;
	children;
	_tag = "ArrayNode";
	constructor(e, t, n) {
		this.edit = e, this.size = t, this.children = n;
	}
	modify(t, n, r, i, a, o) {
		let s = this.size, c = this.children, l = hx(n, i), u = c[l], d = (u || new Sx()).modify(t, n + 5, r, i, a, o);
		if (u === d) return this;
		let f = Tx(this, t), p;
		if (Cx(u) && !Cx(d)) ++s, p = yx(f, l, d, c);
		else if (!Cx(u) && Cx(d)) {
			if (--s, s <= px) return Ax(t, s, l, c);
			p = yx(f, l, new Sx(), c);
		} else p = yx(f, l, d, c);
		return f ? (this.size = s, this.children = p, this) : new e(t, s, p);
	}
};
function Ax(e, t, n, r) {
	let i = Array(t - 1), a = 0, o = 0;
	for (let e = 0, t = r.length; e < t; ++e) if (e !== n) {
		let t = r[e];
		t && !Cx(t) && (i[a++] = t, o |= 1 << e);
	}
	return new Ox(e, o, i);
}
function jx(e, t, n, r, i) {
	let a = [], o = r, s = 0;
	for (let e = 0; o; ++e) o & 1 && (a[e] = i[s++]), o >>>= 1;
	return a[t] = n, new kx(e, s + 1, a);
}
function Mx(e, t, n, r, i, a) {
	if (n === i) return new Dx(e, n, [a, r]);
	let o = hx(t, n), s = hx(t, i);
	if (o === s) return (t) => new Ox(e, gx(o) | gx(s), [t]);
	{
		let t = o < s ? [r, a] : [a, r];
		return new Ox(e, gx(o) | gx(s), t);
	}
}
function Nx(e, t, n, r, i, a) {
	let o, s = t;
	for (;;) {
		let t = Mx(e, s, n, r, i, a);
		if (typeof t == "function") o = vx(t, o), s += 5;
		else {
			let e = t;
			for (; o != null;) e = o.value(e), o = o.previous;
			return e;
		}
	}
}
// node_modules/effect/dist/esm/internal/hashMap.js
var Px = "effect/HashMap", Fx = /*#__PURE__*/ Symbol.for(Px), Ix = {
	[Fx]: Fx,
	[Symbol.iterator]() {
		return new Rx(this, (e, t) => [e, t]);
	},
	[H]() {
		let e = U(Px);
		for (let t of this) e ^= z(U(t[0]), W(U(t[1])));
		return Xg(this, e);
	},
	[G](e) {
		if (Gx(e)) {
			if (e._size !== this._size) return !1;
			for (let t of this) {
				let n = z(e, Jx(t[0], U(t[0])));
				if (fv(n) || !K(t[1], n.value)) return !1;
			}
			return !0;
		}
		return !1;
	},
	toString() {
		return n_(this.toJSON());
	},
	toJSON() {
		return {
			_id: "HashMap",
			values: Array.from(this).map(t_)
		};
	},
	[e_]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, Lx = (e, t, n, r) => {
	let i = Object.create(Ix);
	return i._editable = e, i._edit = t, i._root = n, i._size = r, i;
}, Rx = class e {
	map;
	f;
	v;
	constructor(e, t) {
		this.map = e, this.f = t, this.v = Bx(this.map._root, this.f, void 0);
	}
	next() {
		if (fv(this.v)) return {
			done: !0,
			value: void 0
		};
		let e = this.v.value;
		return this.v = zx(e.cont), {
			done: !1,
			value: e.value
		};
	}
	[Symbol.iterator]() {
		return new e(this.map, this.f);
	}
}, zx = (e) => e ? Vx(e[0], e[1], e[2], e[3], e[4]) : J(), Bx = (e, t, n = void 0) => {
	switch (e._tag) {
		case "LeafNode": return pv(e.value) ? Y({
			value: t(e.key, e.value.value),
			cont: n
		}) : zx(n);
		case "CollisionNode":
		case "ArrayNode":
		case "IndexedNode": {
			let r = e.children;
			return Vx(r.length, r, 0, t, n);
		}
		default: return zx(n);
	}
}, Vx = (e, t, n, r, i) => {
	for (; n < e;) {
		let a = t[n++];
		if (a && !Cx(a)) return Bx(a, r, [
			e,
			t,
			n,
			r,
			i
		]);
	}
	return zx(i);
}, Hx = /*#__PURE__*/ Lx(!1, 0, /*#__PURE__*/ new Sx(), 0), Ux = () => Hx, Wx = (e) => {
	let t = eS(Ux());
	for (let n of e) Xx(t, n[0], n[1]);
	return tS(t);
}, Gx = (e) => V(e, Fx), Kx = (e) => e && Cx(e._root), qx = /*#__PURE__*/ R(2, (e, t) => Jx(e, t, U(t))), Jx = /*#__PURE__*/ R(3, (e, t, n) => {
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
			let e = gx(hx(i, n));
			if (r.mask & e) {
				r = r.children[_x(r.mask, e)], i += 5;
				break;
			}
			return J();
		}
		case "ArrayNode":
			if (r = r.children[hx(i, n)], r) {
				i += 5;
				break;
			}
			return J();
		default: return J();
	}
}), Yx = /*#__PURE__*/ R(2, (e, t) => pv(Jx(e, t, U(t)))), Xx = /*#__PURE__*/ R(3, (e, t, n) => nS(e, t, () => Y(n))), Zx = /*#__PURE__*/ R(3, (e, t, n) => e._editable ? (e._root = t, e._size = n, e) : t === e._root ? e : Lx(e._editable, e._edit, t, n)), Qx = (e) => new Rx(e, (e) => e), $x = (e) => e._size, eS = (e) => Lx(!0, e._edit + 1, e._root, e._size), tS = (e) => (e._editable = !1, e), nS = /*#__PURE__*/ R(3, (e, t, n) => rS(e, t, U(t), n)), rS = /*#__PURE__*/ R(4, (e, t, n, r) => {
	let i = { value: e._size };
	return z(e, Zx(e._root.modify(e._editable ? e._edit : NaN, 0, r, n, t, i), i.value));
}), iS = /*#__PURE__*/ R(2, (e, t) => nS(e, t, J)), aS = /*#__PURE__*/ R(2, (e, t) => sS(e, Ux(), (e, n, r) => Xx(e, r, t(n, r)))), oS = /*#__PURE__*/ R(2, (e, t) => sS(e, void 0, (e, n, r) => t(n, r))), sS = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = e._root;
	if (r._tag === "LeafNode") return pv(r.value) ? n(t, r.value.value, r.key) : t;
	if (r._tag === "EmptyNode") return t;
	let i = [r.children], a;
	for (; a = i.pop();) for (let e = 0, r = a.length; e < r;) {
		let r = a[e++];
		r && !Cx(r) && (r._tag === "LeafNode" ? pv(r.value) && (t = n(t, r.value.value, r.key)) : i.push(r.children));
	}
	return t;
}), cS = "effect/HashSet", lS = /*#__PURE__*/ Symbol.for(cS), uS = {
	[lS]: lS,
	[Symbol.iterator]() {
		return Qx(this._keyMap);
	},
	[H]() {
		return Xg(this, W(U(this._keyMap))(U(cS)));
	},
	[G](e) {
		return fS(e) ? $x(this._keyMap) === $x(e._keyMap) && K(this._keyMap, e._keyMap) : !1;
	},
	toString() {
		return n_(this.toJSON());
	},
	toJSON() {
		return {
			_id: "HashSet",
			values: Array.from(this).map(t_)
		};
	},
	[e_]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, dS = (e) => {
	let t = Object.create(uS);
	return t._keyMap = e, t;
}, fS = (e) => V(e, lS), pS = /*#__PURE__*/ dS(/*#__PURE__*/ Ux()), mS = () => pS, hS = (e) => {
	let t = yS(mS());
	for (let n of e) SS(t, n);
	return bS(t);
}, gS = (...e) => {
	let t = yS(mS());
	for (let n of e) SS(t, n);
	return bS(t);
}, _S = /*#__PURE__*/ R(2, (e, t) => Yx(e._keyMap, t)), vS = (e) => $x(e._keyMap), yS = (e) => dS(eS(e._keyMap)), bS = (e) => (e._keyMap._editable = !1, e), xS = /*#__PURE__*/ R(2, (e, t) => {
	let n = yS(e);
	return t(n), bS(n);
}), SS = /*#__PURE__*/ R(2, (e, t) => e._keyMap._editable ? (Xx(t, !0)(e._keyMap), e) : dS(Xx(t, !0)(e._keyMap))), CS = /*#__PURE__*/ R(2, (e, t) => e._keyMap._editable ? (iS(t)(e._keyMap), e) : dS(iS(t)(e._keyMap))), wS = /*#__PURE__*/ R(2, (e, t) => xS(e, (e) => {
	for (let n of t) CS(e, n);
})), TS = /*#__PURE__*/ R(2, (e, t) => xS(mS(), (n) => {
	ES(e, (e) => SS(n, e));
	for (let e of t) SS(n, e);
})), ES = /*#__PURE__*/ R(2, (e, t) => oS(e._keyMap, (e, n) => t(n))), DS = /*#__PURE__*/ R(3, (e, t, n) => sS(e._keyMap, t, (e, t, r) => n(e, r))), OS = mS, kS = hS, AS = gS, jS = _S, MS = vS, NS = SS, PS = CS, FS = wS, IS = TS, LS = DS, RS = /*#__PURE__*/ Symbol.for("effect/MutableRef"), zS = {
	[RS]: RS,
	toString() {
		return n_(this.toJSON());
	},
	toJSON() {
		return {
			_id: "MutableRef",
			current: t_(this.current)
		};
	},
	[e_]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, BS = (e) => {
	let t = Object.create(zS);
	return t.current = e, t;
}, VS = (e) => e.current, HS = /*#__PURE__*/ R(2, (e, t) => (e.current = t, e)), US = "effect/FiberId", WS = /*#__PURE__*/ Symbol.for(US), GS = "None", KS = "Runtime", qS = "Composite", JS = /*#__PURE__*/ Kg(`${US}-${GS}`), YS = class {
	[WS] = WS;
	_tag = GS;
	id = -1;
	startTimeMillis = -1;
	[H]() {
		return JS;
	}
	[G](e) {
		return QS(e) && e._tag === GS;
	}
	toString() {
		return n_(this.toJSON());
	}
	toJSON() {
		return {
			_id: "FiberId",
			_tag: this._tag
		};
	}
	[e_]() {
		return this.toJSON();
	}
}, XS = class {
	id;
	startTimeMillis;
	[WS] = WS;
	_tag = KS;
	constructor(e, t) {
		this.id = e, this.startTimeMillis = t;
	}
	[H]() {
		return Xg(this, Kg(`${US}-${this._tag}-${this.id}-${this.startTimeMillis}`));
	}
	[G](e) {
		return QS(e) && e._tag === KS && this.id === e.id && this.startTimeMillis === e.startTimeMillis;
	}
	toString() {
		return n_(this.toJSON());
	}
	toJSON() {
		return {
			_id: "FiberId",
			_tag: this._tag,
			id: this.id,
			startTimeMillis: this.startTimeMillis
		};
	}
	[e_]() {
		return this.toJSON();
	}
}, ZS = /*#__PURE__*/ new YS(), QS = (e) => V(e, WS), $S = (e) => {
	switch (e._tag) {
		case GS: return OS();
		case KS: return AS(e.id);
		case qS: return z($S(e.left), IS($S(e.right)));
	}
}, eC = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => BS(0)), tC = (e) => Array.from($S(e)).map((e) => `#${e}`).join(","), nC = () => {
	let e = VS(eC);
	return z(eC, HS(e + 1)), new XS(e, Date.now());
}, rC = ZS, iC = $S, aC = tC, oC = nC, sC = Ux, cC = Wx, lC = Kx, uC = qx, dC = Xx, fC = Qx, pC = nS, mC = aS, hC = sS, gC = /*#__PURE__*/ Symbol.for("effect/List"), _C = (e) => Tv(e), vC = /*#__PURE__*/ ((e) => ug(sy(e), _C))(K), yC = {
	[gC]: gC,
	_tag: "Cons",
	toString() {
		return n_(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Cons",
			values: _C(this).map(t_)
		};
	},
	[e_]() {
		return this.toJSON();
	},
	[G](e) {
		return CC(e) && this._tag === e._tag && vC(this, e);
	},
	[H]() {
		return Xg(this, Yg(_C(this)));
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
}, bC = (e, t) => {
	let n = Object.create(yC);
	return n.head = e, n.tail = t, n;
}, xC = /*#__PURE__*/ Kg("Nil"), SC = /*#__PURE__*/ Object.create({
	[gC]: gC,
	_tag: "Nil",
	toString() {
		return n_(this.toJSON());
	},
	toJSON() {
		return {
			_id: "List",
			_tag: "Nil"
		};
	},
	[e_]() {
		return this.toJSON();
	},
	[H]() {
		return xC;
	},
	[G](e) {
		return CC(e) && this._tag === e._tag;
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
}), CC = (e) => V(e, gC), wC = (e) => e._tag === "Nil", TC = (e) => e._tag === "Cons", EC = () => SC, DC = (e, t) => bC(e, t), OC = EC, kC = (e) => bC(e, SC), AC = /*#__PURE__*/ R(2, (e, t) => MC(t, e)), jC = /*#__PURE__*/ R(2, (e, t) => DC(t, e)), MC = /*#__PURE__*/ R(2, (e, t) => {
	if (wC(e)) return t;
	if (wC(t)) return e;
	{
		let n = bC(t.head, e), r = n, i = t.tail;
		for (; !wC(i);) {
			let t = bC(i.head, e);
			r.tail = t, r = t, i = i.tail;
		}
		return n;
	}
}), NC = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = t, i = e;
	for (; !wC(i);) r = n(r, i.head), i = i.tail;
	return r;
}), PC = (e) => {
	let t = OC(), n = e;
	for (; !wC(n);) t = jC(t, n.head), n = n.tail;
	return t;
};
Array.prototype;
var FC = /*#__PURE__*/ function() {
	function e(e) {
		e && Object.assign(this, e);
	}
	return e.prototype = P_, e;
}(), IC = /*#__PURE__*/ Symbol.for("effect/DifferContextPatch");
function LC(e) {
	return e;
}
var RC = {
	...FC.prototype,
	[IC]: {
		_Value: LC,
		_Patch: LC
	}
}, zC = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(RC), { _tag: "Empty" })), BC = () => zC, VC = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(RC), { _tag: "AndThen" }), HC = (e, t) => {
	let n = Object.create(VC);
	return n.first = e, n.second = t, n;
}, UC = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(RC), { _tag: "AddService" }), WC = (e, t) => {
	let n = Object.create(UC);
	return n.key = e, n.service = t, n;
}, GC = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(RC), { _tag: "RemoveService" }), KC = (e) => {
	let t = Object.create(GC);
	return t.key = e, t;
}, qC = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(RC), { _tag: "UpdateService" }), JC = (e, t) => {
	let n = Object.create(qC);
	return n.key = e, n.update = t, n;
}, YC = (e, t) => {
	let n = new Map(e.unsafeMap), r = BC();
	for (let [e, i] of t.unsafeMap.entries()) if (n.has(e)) {
		let t = n.get(e);
		n.delete(e), K(t, i) || (r = XC(JC(e, () => i))(r));
	} else n.delete(e), r = XC(WC(e, i))(r);
	for (let [e] of n.entries()) r = XC(KC(e))(r);
	return r;
}, XC = /*#__PURE__*/ R(2, (e, t) => HC(e, t)), ZC = /*#__PURE__*/ R(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = !1, r = lb(e), i = new Map(t.unsafeMap);
	for (; Cb(r);) {
		let e = Eb(r), t = Db(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AddService":
				i.set(e.key, e.service), r = t;
				break;
			case "AndThen":
				r = yb(yb(t, e.second), e.first);
				break;
			case "RemoveService":
				i.delete(e.key), r = t;
				break;
			case "UpdateService": i.set(e.key, e.update(i.get(e.key))), n = !0, r = t;
		}
	}
	if (!n) return Cy(i);
	let a = /* @__PURE__ */ new Map();
	for (let [e] of t.unsafeMap) i.has(e) && (a.set(e, i.get(e)), i.delete(e));
	for (let [e, t] of i) a.set(e, t);
	return Cy(a);
}), QC = /*#__PURE__*/ Symbol.for("effect/DifferHashSetPatch");
function $C(e) {
	return e;
}
var ew = {
	...FC.prototype,
	[QC]: {
		_Value: $C,
		_Key: $C,
		_Patch: $C
	}
}, tw = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(ew), { _tag: "Empty" })), nw = () => tw, rw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(ew), { _tag: "AndThen" }), iw = (e, t) => {
	let n = Object.create(rw);
	return n.first = e, n.second = t, n;
}, aw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(ew), { _tag: "Add" }), ow = (e) => {
	let t = Object.create(aw);
	return t.value = e, t;
}, sw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(ew), { _tag: "Remove" }), cw = (e) => {
	let t = Object.create(sw);
	return t.value = e, t;
}, lw = (e, t) => {
	let [n, r] = LS([e, nw()], ([e, t], n) => jS(n)(e) ? [PS(n)(e), t] : [e, uw(ow(n))(t)])(t);
	return LS(r, (e, t) => uw(cw(t))(e))(n);
}, uw = /*#__PURE__*/ R(2, (e, t) => iw(e, t)), dw = /*#__PURE__*/ R(2, (e, t) => {
	if (e._tag === "Empty") return t;
	let n = t, r = lb(e);
	for (; Cb(r);) {
		let e = Eb(r), t = Db(r);
		switch (e._tag) {
			case "Empty":
				r = t;
				break;
			case "AndThen":
				r = yb(e.first)(yb(e.second)(t));
				break;
			case "Add":
				n = NS(e.value)(n), r = t;
				break;
			case "Remove": n = PS(e.value)(n), r = t;
		}
	}
	return n;
}), fw = /*#__PURE__*/ Symbol.for("effect/DifferReadonlyArrayPatch");
function pw(e) {
	return e;
}
var mw = {
	...FC.prototype,
	[fw]: {
		_Value: pw,
		_Patch: pw
	}
}, hw = /*#__PURE__*/ Object.create(/* @__PURE__ */ Object.assign(/*#__PURE__*/ Object.create(mw), { _tag: "Empty" })), gw = () => hw, _w = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(mw), { _tag: "AndThen" }), vw = (e, t) => {
	let n = Object.create(_w);
	return n.first = e, n.second = t, n;
}, yw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(mw), { _tag: "Append" }), bw = (e) => {
	let t = Object.create(yw);
	return t.values = e, t;
}, xw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(mw), { _tag: "Slice" }), Sw = (e, t) => {
	let n = Object.create(xw);
	return n.from = e, n.until = t, n;
}, Cw = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(mw), { _tag: "Update" }), ww = (e, t) => {
	let n = Object.create(Cw);
	return n.index = e, n.patch = t, n;
}, Tw = (e) => {
	let t = 0, n = gw();
	for (; t < e.oldValue.length && t < e.newValue.length;) {
		let r = e.oldValue[t], i = e.newValue[t], a = e.differ.diff(r, i);
		K(a, e.differ.empty) || (n = Ew(n, ww(t, a))), t += 1;
	}
	return t < e.oldValue.length && (n = Ew(n, Sw(0, t))), t < e.newValue.length && (n = Ew(n, bw(Wv(t)(e.newValue)))), n;
}, Ew = /*#__PURE__*/ R(2, (e, t) => vw(e, t)), Dw = /*#__PURE__*/ R(3, (e, t, n) => {
	if (e._tag === "Empty") return t;
	let r = t.slice(), i = ny(e);
	for (; jv(i);) {
		let e = Rv(i), t = Vv(i);
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
}), Ow = {
	[/* @__PURE__ */ Symbol.for("effect/Differ")]: {
		_P: rg,
		_V: rg
	},
	pipe() {
		return q(this, arguments);
	}
}, kw = (e) => {
	let t = Object.create(Ow);
	return t.empty = e.empty, t.diff = e.diff, t.combine = e.combine, t.patch = e.patch, t;
}, Aw = () => kw({
	empty: BC(),
	combine: (e, t) => XC(t)(e),
	diff: (e, t) => YC(e, t),
	patch: (e, t) => ZC(t)(e)
}), jw = () => kw({
	empty: nw(),
	combine: (e, t) => uw(t)(e),
	diff: (e, t) => lw(e, t),
	patch: (e, t) => dw(t)(e)
}), Mw = (e) => kw({
	empty: gw(),
	combine: (e, t) => Ew(e, t),
	diff: (t, n) => Tw({
		oldValue: t,
		newValue: n,
		differ: e
	}),
	patch: (t, n) => Dw(t, n, e)
}), Nw = () => Pw((e, t) => t), Pw = (e) => kw({
	empty: rg,
	combine: (e, t) => e === rg ? t : t === rg ? e : (n) => t(e(n)),
	diff: (e, t) => K(e, t) ? rg : ig(t),
	patch: (t, n) => e(n, t(n))
}), Fw = 255, Iw = 8, Lw = (e) => e & Fw, Rw = (e) => e >> Iw & Fw, zw = (e, t) => (e & Fw) + ((t & e & Fw) << Iw), Bw = /*#__PURE__*/ zw(0, 0), Vw = (e) => zw(e, e), Hw = (e) => zw(e, 0), Uw = /*#__PURE__*/ R(2, (e, t) => zw(Lw(e) & ~t, Rw(e))), Ww = /*#__PURE__*/ R(2, (e, t) => e | t), Gw = (e) => ~e >>> 0 & Fw, Kw = (e) => Zw(e, 32), qw = /*#__PURE__*/ R(2, (e, t) => e & ~t), Jw = /*#__PURE__*/ R(2, (e, t) => e | t), Yw = (e) => Xw(e) && !tT(e), Xw = (e) => Zw(e, 1), Zw = /*#__PURE__*/ R(2, (e, t) => (e & t) !== 0), Qw = (...e) => e.reduce((e, t) => e | t, 0), $w = /*#__PURE__*/ Qw(0), eT = (e) => Zw(e, 4), tT = (e) => Zw(e, 16), nT = /*#__PURE__*/ R(2, (e, t) => zw(e ^ t, t)), rT = /*#__PURE__*/ R(2, (e, t) => e & (Gw(Lw(t)) | Rw(t)) | Lw(t) & Rw(t)), iT = /*#__PURE__*/ kw({
	empty: Bw,
	diff: (e, t) => nT(e, t),
	combine: (e, t) => Ww(t)(e),
	patch: (e, t) => rT(t, e)
}), aT = Vw, oT = Hw, sT = Uw, cT = (e, t) => ({
	_tag: "Par",
	left: e,
	right: t
}), lT = (e, t) => ({
	_tag: "Seq",
	left: e,
	right: t
}), uT = (e) => {
	let t = kC(e), n = OC();
	for (;;) {
		let [e, r] = NC(t, [gT(), OC()], ([e, t], n) => {
			let [r, i] = dT(n);
			return [vT(e, r), AC(t, i)];
		});
		if (n = fT(n, e), wC(r)) return PC(n);
		t = r;
	}
	throw Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, dT = (e) => {
	let t = e, n = gT(), r = OC(), i = OC();
	for (;;) switch (t._tag) {
		case "Empty":
			if (wC(r)) return [n, i];
			t = r.head, r = r.tail;
			break;
		case "Par":
			r = DC(t.right, r), t = t.left;
			break;
		case "Seq": {
			let e = t.left, n = t.right;
			switch (e._tag) {
				case "Empty":
					t = n;
					break;
				case "Par": {
					let r = e.left, i = e.right;
					t = cT(lT(r, n), lT(i, n));
					break;
				}
				case "Seq": {
					let r = e.left, i = e.right;
					t = lT(r, lT(i, n));
					break;
				}
				case "Single": t = e, i = DC(n, i);
			}
			break;
		}
		case "Single":
			if (n = _T(n, t), wC(r)) return [n, i];
			t = r.head, r = r.tail;
	}
	throw Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, fT = (e, t) => {
	if (wC(e)) return kC(xT(t));
	if (yT(t)) return e;
	let n = DT(e.head), r = bT(t);
	return n.length === 1 && r.length === 1 && K(n[0], r[0]) ? DC(ET(e.head, xT(t)), e.tail) : DC(xT(t), e);
}, pT = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockParallel"), mT = {
/* c8 ignore next */
_R: (e) => e }, hT = class {
	map;
	[pT] = mT;
	constructor(e) {
		this.map = e;
	}
}, gT = () => new hT(sC()), _T = (e, t) => new hT(pC(e.map, t.dataSource, (e) => gv(yv(e, vb(t.blockedRequest)), () => lb(t.blockedRequest)))), vT = (e, t) => new hT(hC(e.map, t.map, (e, t, n) => dC(e, n, mv(uC(e, n), {
	onNone: () => t,
	onSome: (e) => xb(t, e)
})))), yT = (e) => lC(e.map), bT = (e) => Array.from(fC(e.map)), xT = (e) => TT(mC(e.map, (e) => lb(e))), ST = /*#__PURE__*/ Symbol.for("effect/RequestBlock/RequestBlockSequential"), CT = {
/* c8 ignore next */
_R: (e) => e }, wT = class {
	map;
	[ST] = CT;
	constructor(e) {
		this.map = e;
	}
}, TT = (e) => new wT(e), ET = (e, t) => new wT(hC(t.map, e.map, (e, t, n) => dC(e, n, mv(uC(e, n), {
	onNone: () => sb(),
	onSome: (e) => xb(e, t)
})))), DT = (e) => Array.from(fC(e.map)), OT = (e) => Array.from(e.map), kT = "Empty", AT = "Fail", jT = "Interrupt", MT = "Parallel", NT = "Sequential", PT = "effect/Cause", FT = /*#__PURE__*/ Symbol.for(PT), IT = {
/* c8 ignore next */
_E: (e) => e }, LT = {
	[FT]: IT,
	[H]() {
		return z(U(PT), W(U(iE(this))), Xg(this));
	},
	[G](e) {
		return WT(e) && rE(this, e);
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
				defect: t_(this.defect)
			};
			case "Interrupt": return {
				_id: "Cause",
				_tag: this._tag,
				fiberId: this.fiberId.toJSON()
			};
			case "Fail": return {
				_id: "Cause",
				_tag: this._tag,
				failure: t_(this.error)
			};
			case "Sequential":
			case "Parallel": return {
				_id: "Cause",
				_tag: this._tag,
				left: t_(this.left),
				right: t_(this.right)
			};
		}
	},
	toString() {
		return mE(this);
	},
	[e_]() {
		return this.toJSON();
	}
}, RT = /*#__PURE__*/ (() => {
	let e = /*#__PURE__*/ Object.create(LT);
	return e._tag = kT, e;
})(), zT = (e) => {
	let t = Object.create(LT);
	return t._tag = AT, t.error = e, t;
}, BT = (e) => {
	let t = Object.create(LT);
	return t._tag = "Die", t.defect = e, t;
}, VT = (e) => {
	let t = Object.create(LT);
	return t._tag = jT, t.fiberId = e, t;
}, HT = (e, t) => {
	let n = Object.create(LT);
	return n._tag = MT, n.left = e, n.right = t, n;
}, UT = (e, t) => {
	let n = Object.create(LT);
	return n._tag = NT, n.left = e, n.right = t, n;
}, WT = (e) => V(e, FT), GT = (e) => e._tag === kT, KT = (e) => e._tag === "Empty" || fE(e, !0, (e, t) => {
	switch (t._tag) {
		case kT: return Y(e);
		case "Die":
		case AT:
		case jT: return Y(!1);
		default: return J();
	}
}), qT = (e) => pv(eE(e)), JT = (e) => pE(void 0, cE)(e), YT = (e) => pb(fE(e, sb(), (e, t) => t._tag === "Fail" ? Y(z(e, yb(t.error))) : J())), XT = (e) => pb(fE(e, sb(), (e, t) => t._tag === "Die" ? Y(z(e, yb(t.defect))) : J())), ZT = (e) => fE(e, OS(), (e, t) => t._tag === "Interrupt" ? Y(z(e, NS(t.fiberId))) : J()), QT = (e) => oE(e, (e) => e._tag === "Fail" ? Y(e.error) : J()), $T = (e) => {
	let t = QT(e);
	switch (t._tag) {
		case "None": return nv(e);
		case "Some": return rv(t.value);
	}
}, eE = (e) => oE(e, (e) => e._tag === "Interrupt" ? Y(e.fiberId) : J()), tE = (e) => dE(e, {
	onEmpty: RT,
	onFail: () => RT,
	onDie: BT,
	onInterrupt: VT,
	onSequential: UT,
	onParallel: HT
}), nE = (e) => dE(e, {
	onEmpty: RT,
	onFail: BT,
	onDie: BT,
	onInterrupt: VT,
	onSequential: UT,
	onParallel: HT
}), rE = (e, t) => {
	let n = lb(e), r = lb(t);
	for (; Cb(n) && Cb(r);) {
		let [e, t] = z(Eb(n), fE([OS(), sb()], ([e, t], n) => {
			let [r, i] = sE(n);
			return Y([z(e, IS(r)), z(t, xb(i))]);
		})), [i, a] = z(Eb(r), fE([OS(), sb()], ([e, t], n) => {
			let [r, i] = sE(n);
			return Y([z(e, IS(r)), z(t, xb(i))]);
		}));
		if (!K(e, i)) return !1;
		n = t, r = a;
	}
	return !0;
}, iE = (e) => aE(lb(e), sb()), aE = (e, t) => {
	for (;;) {
		let [n, r] = z(e, ay([OS(), sb()], ([e, t], n) => {
			let [r, i] = sE(n);
			return [z(e, IS(r)), z(t, xb(i))];
		})), i = MS(n) > 0 ? z(t, yb(n)) : t;
		if (Sb(r)) return pb(i);
		e = r, t = i;
	}
	throw Error(wg("Cause.flattenCauseLoop"));
}, oE = /*#__PURE__*/ R(2, (e, t) => {
	let n = [e];
	for (; n.length > 0;) {
		let e = n.pop(), r = t(e);
		switch (r._tag) {
			case "None":
				switch (e._tag) {
					case NT:
					case MT: n.push(e.right), n.push(e.left);
				}
				break;
			case "Some": return r;
		}
	}
	return J();
}), sE = (e) => {
	let t = e, n = [], r = OS(), i = sb();
	for (; t !== void 0;) switch (t._tag) {
		case kT:
			if (n.length === 0) return [r, i];
			t = n.pop();
			break;
		case AT:
			if (r = NS(r, cb(t._tag, t.error)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case "Die":
			if (r = NS(r, cb(t._tag, t.defect)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case jT:
			if (r = NS(r, cb(t._tag, t.fiberId)), n.length === 0) return [r, i];
			t = n.pop();
			break;
		case NT:
			switch (t.left._tag) {
				case kT:
					t = t.right;
					break;
				case NT:
					t = UT(t.left.left, UT(t.left.right, t.right));
					break;
				case MT:
					t = HT(UT(t.left.left, t.right), UT(t.left.right, t.right));
					break;
				default: i = yb(i, t.right), t = t.left;
			}
			break;
		case MT: n.push(t.right), t = t.left;
	}
	throw Error(wg("Cause.evaluateCauseLoop"));
}, cE = {
	emptyCase: ag,
	failCase: og,
	dieCase: og,
	interruptCase: ag,
	sequentialCase: (e, t, n) => t && n,
	parallelCase: (e, t, n) => t && n
}, lE = "SequentialCase", uE = "ParallelCase", dE = /*#__PURE__*/ R(2, (e, { onDie: t, onEmpty: n, onFail: r, onInterrupt: i, onParallel: a, onSequential: o }) => pE(e, void 0, {
	emptyCase: () => n,
	failCase: (e, t) => r(t),
	dieCase: (e, n) => t(n),
	interruptCase: (e, t) => i(t),
	sequentialCase: (e, t, n) => o(t, n),
	parallelCase: (e, t, n) => a(t, n)
})), fE = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = t, i = e, a = [];
	for (; i !== void 0;) {
		let e = n(r, i);
		switch (r = pv(e) ? e.value : r, i._tag) {
			case NT:
				a.push(i.right), i = i.left;
				break;
			case MT:
				a.push(i.right), i = i.left;
				break;
			default: i = void 0;
		}
		i === void 0 && a.length > 0 && (i = a.pop());
	}
	return r;
}), pE = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._tag) {
			case kT:
				i.push(nv(n.emptyCase(t)));
				break;
			case AT:
				i.push(nv(n.failCase(t, e.error)));
				break;
			case "Die":
				i.push(nv(n.dieCase(t, e.defect)));
				break;
			case jT:
				i.push(nv(n.interruptCase(t, e.fiberId)));
				break;
			case NT:
				r.push(e.right), r.push(e.left), i.push(rv({ _tag: lE }));
				break;
			case MT: r.push(e.right), r.push(e.left), i.push(rv({ _tag: uE }));
		}
	}
	let a = [];
	for (; i.length > 0;) {
		let e = i.pop();
		switch (e._tag) {
			case "Left":
				switch (e.left._tag) {
					case lE: {
						let e = a.pop(), r = a.pop(), i = n.sequentialCase(t, e, r);
						a.push(i);
						break;
					}
					case uE: {
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
}), mE = (e, t) => JT(e) ? "All fibers interrupted without errors." : SE(e).map(function(e) {
	return t?.renderErrorCause !== !0 || e.cause === void 0 ? e.stack : `${e.stack} {\n${hE(e.cause, "  ")}\n}`;
}).join("\n"), hE = (e, t) => {
	let n = e.stack.split("\n"), r = `${t}[cause]: ${n[0]}`;
	for (let e = 1, i = n.length; e < i; e++) r += `\n${t}${n[e]}`;
	return e.cause && (r += ` {\n${hE(e.cause, `${t}  `)}\n${t}}`), r;
}, gE = (e) => {
	let t = typeof e == "object" && !!e, n = Error.stackTraceLimit;
	Error.stackTraceLimit = 1;
	let r = Error(_E(e), t && "cause" in e && e.cause !== void 0 ? { cause: gE(e.cause) } : void 0);
	return Error.stackTraceLimit = n, r.message === "" && (r.message = "An error has occurred"), Error.stackTraceLimit = n, r.name = e instanceof Error ? e.name : "Error", t && (xE in e && (r.span = e[xE]), Object.keys(e).forEach((t) => {
		t in r || (r[t] = e[t]);
	})), r.stack = bE(`${r.name}: ${r.message}`, e instanceof Error && e.stack ? e.stack : "", r.span), r;
}, _E = (e) => {
	if (typeof e == "string") return e;
	if (typeof e == "object" && e && e instanceof Error) return e.message;
	try {
		if (V(e, "toString") && _g(e.toString) && e.toString !== Object.prototype.toString && e.toString !== globalThis.Array.prototype.toString) return e.toString();
	} catch {}
	return i_(e);
}, vE = /\((.*)\)/g, yE = /*#__PURE__*/ B("effect/Tracer/spanToTrace", () => /* @__PURE__ */ new WeakMap()), bE = (e, t, n) => {
	let r = [e], i = t.startsWith(e) ? t.slice(e.length).split("\n") : t.split("\n");
	for (let e = 1; e < i.length; e++) if (i[e].includes(" at new BaseEffectError") || i[e].includes(" at new YieldableError")) e++;
	else {
		if (i[e].includes("Generator.next") || i[e].includes("effect_internal_function")) break;
		r.push(i[e].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
	}
	if (n) {
		let e = n, t = 0;
		for (; e && e._tag === "Span" && t < 10;) {
			let n = yE.get(e);
			if (typeof n == "function") {
				let t = n();
				if (typeof t == "string") {
					let n = t.matchAll(vE), i = !1;
					for (let [, t] of n) i = !0, r.push(`    at ${e.name} (${t})`);
					i || r.push(`    at ${e.name} (${t.replace(/^at /, "")})`);
				} else r.push(`    at ${e.name}`);
			} else r.push(`    at ${e.name}`);
			e = vv(e.parent), t++;
		}
	}
	return r.join("\n");
}, xE = /*#__PURE__*/ Symbol.for("effect/SpanAnnotation"), SE = (e) => pE(e, void 0, {
	emptyCase: () => [],
	dieCase: (e, t) => [gE(t)],
	failCase: (e, t) => [gE(t)],
	interruptCase: () => [],
	parallelCase: (e, t, n) => [...t, ...n],
	sequentialCase: (e, t, n) => [...t, ...n]
}), CE = "Pending", wE = "Done", TE = /*#__PURE__*/ Symbol.for("effect/Deferred"), EE = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, DE = (e) => ({
	_tag: CE,
	joiners: e
}), OE = (e) => ({
	_tag: wE,
	effect: e
}), kE = class e {
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
}, AE = (e, t) => {
	let n = new PE("Blocked");
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}, jE = (e) => {
	let t = new PE("RunBlocked");
	return t.effect_instruction_i0 = e, t;
}, ME = /*#__PURE__*/ Symbol.for("effect/Effect"), NE = class {
	patch;
	op;
	_op = C_;
	constructor(e, t) {
		this.patch = e, this.op = t;
	}
}, PE = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[ME] = A_;
	constructor(e) {
		this._op = e;
	}
	[G](e) {
		return this === e;
	}
	[H]() {
		return Xg(this, Hg(this));
	}
	pipe() {
		return q(this, arguments);
	}
	toJSON() {
		return {
			_id: "Effect",
			_op: this._op,
			effect_instruction_i0: t_(this.effect_instruction_i0),
			effect_instruction_i1: t_(this.effect_instruction_i1),
			effect_instruction_i2: t_(this.effect_instruction_i2)
		};
	}
	toString() {
		return n_(this.toJSON());
	}
	[e_]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new kE(new Ig(this));
	}
}, FE = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[ME] = A_;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[G](e) {
		return RO(e) && e._op === "Failure" && K(this.effect_instruction_i0, e.effect_instruction_i0);
	}
	[H]() {
		return z(Kg(this._tag), W(U(this.effect_instruction_i0)), Xg(this));
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
		return n_(this.toJSON());
	}
	[e_]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new kE(new Ig(this));
	}
}, IE = class {
	_op;
	effect_instruction_i0 = void 0;
	effect_instruction_i1 = void 0;
	effect_instruction_i2 = void 0;
	trace = void 0;
	[ME] = A_;
	constructor(e) {
		this._op = e, this._tag = e;
	}
	[G](e) {
		return RO(e) && e._op === "Success" && K(this.effect_instruction_i0, e.effect_instruction_i0);
	}
	[H]() {
		return z(Kg(this._tag), W(U(this.effect_instruction_i0)), Xg(this));
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
			value: t_(this.value)
		};
	}
	toString() {
		return n_(this.toJSON());
	}
	[e_]() {
		return this.toJSON();
	}
	[Symbol.iterator]() {
		return new kE(new Ig(this));
	}
}, LE = (e) => V(e, ME), RE = (e) => {
	let t = new PE(x_);
	return t.effect_instruction_i0 = e, t;
}, zE = /*#__PURE__*/ R(3, (e, t, n) => xD((r) => X(e, (e) => X(QE(Q(() => r(t(e)))), (t) => Q(() => n(e, t)).pipe(cD({
	onFailure: (e) => {
		switch (t._tag) {
			case f_: return tD(UT(t.effect_instruction_i0, e));
			case g_: return tD(e);
		}
	},
	onSuccess: () => t
})))))), BE = /*#__PURE__*/ R(2, (e, t) => X(e, () => Z(t))), VE = (e) => BE(e, void 0), HE = function() {
	let e = new PE(d_);
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
		default: throw Error(wg("you're not supposed to end up here"));
	}
	return e;
}, UE = (e, t = rC) => {
	let n = new PE(u_), r;
	return n.effect_instruction_i0 = (t) => {
		r = e(t);
	}, n.effect_instruction_i1 = t, _D(n, (e) => LE(r) ? r : SD);
}, WE = (e, t = rC) => Q(() => UE(e, t)), GE = (e, t = rC) => HE(e, function() {
	let e, n;
	function r(t) {
		e ? e(t) : n === void 0 && (n = t);
	}
	let i = new PE(u_);
	i.effect_instruction_i0 = (t) => {
		e = t, n && t(n);
	}, i.effect_instruction_i1 = t;
	let a, o;
	return this.effect_instruction_i0.length === 1 ? a = Bg(() => this.effect_instruction_i0(r)) : (o = new AbortController(), a = Bg(() => this.effect_instruction_i0(r, o.signal))), a || o ? _D(i, (e) => (o && o.abort(), a ?? SD)) : i;
}), KE = /*#__PURE__*/ R(2, (e, t) => lD(e, {
	onFailure: t,
	onSuccess: Z
})), qE = /*#__PURE__*/ Symbol.for("effect/OriginalAnnotation"), JE = (e, t) => pv(t) ? new Proxy(e, {
	has(e, t) {
		return t === xE || t === qE || t in e;
	},
	get(n, r) {
		return r === xE ? t.value : r === qE ? e : n[r];
	}
}) : e, YE = (e) => yg(e) && !(xE in e) ? RE((t) => tD(BT(JE(e, gk(t))))) : tD(BT(e)), XE = (e) => nD(() => BT(new AO(e))), ZE = (e) => lD(e, {
	onFailure: (e) => Z(rv(e)),
	onSuccess: (e) => Z(nv(e))
}), QE = (e) => sD(e, {
	onFailure: KO,
	onSuccess: ZO
}), $E = (e) => yg(e) && !(xE in e) ? RE((t) => tD(zT(JE(e, gk(t))))) : tD(zT(e)), eD = (e) => X($(e), $E), tD = (e) => {
	let t = new FE(f_);
	return t.effect_instruction_i0 = e, t;
}, nD = (e) => X($(e), tD), rD = /*#__PURE__*/ RE((e) => Z(e.id())), iD = (e) => RE((t) => e(t.id())), X = /*#__PURE__*/ R(2, (e, t) => {
	let n = new PE(m_);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t, n;
}), aD = (e) => {
	let t = new PE("OnStep");
	return t.effect_instruction_i0 = e, t;
}, oD = (e) => X(e, rg), sD = /*#__PURE__*/ R(2, (e, t) => cD(e, {
	onFailure: (e) => Z(t.onFailure(e)),
	onSuccess: (e) => Z(t.onSuccess(e))
})), cD = /*#__PURE__*/ R(2, (e, t) => {
	let n = new PE(h_);
	return n.effect_instruction_i0 = e, n.effect_instruction_i1 = t.onFailure, n.effect_instruction_i2 = t.onSuccess, n;
}), lD = /*#__PURE__*/ R(2, (e, t) => cD(e, {
	onFailure: (e) => {
		if (XT(e).length > 0) return tD(nE(e));
		let n = YT(e);
		return n.length > 0 ? t.onFailure(Tb(n)) : tD(e);
	},
	onSuccess: t.onSuccess
})), uD = /*#__PURE__*/ R(2, (e, t) => Q(() => {
	let n = Tv(e), r = Cv(n.length), i = 0;
	return BE(TD({
		while: () => i < n.length,
		body: () => t(n[i], i),
		step: (e) => {
			r[i++] = e;
		}
	}), r);
})), dD = /*#__PURE__*/ R(2, (e, t) => Q(() => {
	let n = Tv(e), r = 0;
	return TD({
		while: () => r < n.length,
		body: () => t(n[r], r),
		step: () => {
			r++;
		}
	});
})), fD = (e) => {
	let t = new PE(v_);
	return t.effect_instruction_i0 = aT(1), t.effect_instruction_i1 = () => e, t;
}, pD = /*#__PURE__*/ R(2, (e, t) => X(e, (e) => $(() => t(e)))), mD = /*#__PURE__*/ R(2, (e, t) => lD(e, {
	onFailure: (e) => eD(() => t.onFailure(e)),
	onSuccess: (e) => $(() => t.onSuccess(e))
})), hD = /*#__PURE__*/ R(2, (e, t) => cD(e, {
	onFailure: (e) => {
		let n = $T(e);
		switch (n._tag) {
			case "Left": return eD(() => t(n.left));
			case "Right": return tD(n.right);
		}
	},
	onSuccess: Z
})), gD = /*#__PURE__*/ R(2, (e, t) => xD((n) => cD(n(e), {
	onFailure: (e) => {
		let n = KO(e);
		return cD(t(n), {
			onFailure: (t) => KO(UT(e, t)),
			onSuccess: () => n
		});
	},
	onSuccess: (e) => {
		let n = ZO(e);
		return ND(t(n), n);
	}
}))), _D = /*#__PURE__*/ R(2, (e, t) => gD(e, YO({
	onFailure: (e) => JT(e) ? VE(t(ZT(e))) : SD,
	onSuccess: () => SD
}))), Z = (e) => {
	let t = new IE(g_);
	return t.effect_instruction_i0 = e, t;
}, Q = (e) => {
	let t = new PE(d_);
	return t.commit = e, t;
}, $ = (e) => {
	let t = new PE(__);
	return t.effect_instruction_i0 = e, t;
}, vD = /*#__PURE__*/ R((e) => e.length === 3 || e.length === 2 && !(yg(e[1]) && "onlyEffect" in e[1]), (e, t) => X(e, (e) => {
	let n = typeof t == "function" ? t(e) : t;
	return LE(n) ? BE(n, e) : Cg(n) ? UE((t) => {
		n.then((n) => t(Z(e)), (e) => t($E(new LO(e, "An unknown error occurred in Effect.tap"))));
	}) : Z(e);
})), yD = (e) => RE((t) => e(ZD(_O, Y(z(t.getFiberRef(_O), hv(() => t.scope())))))), bD = (e) => {
	let t = new PE(v_);
	return t.effect_instruction_i0 = oT(1), t.effect_instruction_i1 = () => e, t;
}, xD = (e) => HE(e, function() {
	let e = new PE(v_);
	return e.effect_instruction_i0 = oT(1), e.effect_instruction_i1 = (e) => Xw(e) ? Bg(() => this.effect_instruction_i0(fD)) : Bg(() => this.effect_instruction_i0(bD)), e;
}), SD = /*#__PURE__*/ Z(void 0), CD = (e) => {
	let t = new PE(v_);
	return t.effect_instruction_i0 = e, t.effect_instruction_i1 = void 0, t;
}, wD = /*#__PURE__*/ R(2, (e, t) => X(t, (t) => t ? z(e, pD(Y)) : Z(J()))), TD = (e) => {
	let t = new PE(y_);
	return t.effect_instruction_i0 = e.while, t.effect_instruction_i1 = e.body, t.effect_instruction_i2 = e.step, t;
}, ED = (e) => Q(() => {
	let t = new PE(b_);
	return t.effect_instruction_i0 = e(), t;
}), DD = function() {
	let e = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
	return ED(() => e(z));
}, OD = (e, ...t) => Object.defineProperty(t.length === 0 ? function(...t) {
	return ED(() => e.apply(this, t));
} : function(...n) {
	let r = ED(() => e.apply(this, n));
	for (let e of t) r = e(r, ...n);
	return r;
}, "length", {
	value: e.length,
	configurable: !0
}), kD = /*#__PURE__*/ R(2, (e, t) => {
	let n = new PE(v_);
	return n.effect_instruction_i0 = t, n.effect_instruction_i1 = () => e, n;
}), AD = (e) => {
	let t = new PE(S_);
	return e?.priority === void 0 ? t : dO(t, e.priority);
}, jD = /*#__PURE__*/ R(2, (e, t) => X(e, (e) => pD(t, (t) => [e, t]))), MD = /*#__PURE__*/ R(2, (e, t) => X(e, (e) => BE(t, e))), ND = /*#__PURE__*/ R(2, (e, t) => X(e, () => t)), PD = /*#__PURE__*/ R(3, (e, t, n) => X(e, (e) => pD(t, (t) => n(e, t)))), FD = (e) => X(rD, (t) => z(e, ID(t))), ID = /*#__PURE__*/ R(2, (e, t) => X(e.interruptAsFork(t), () => e.await)), LD = {
	_tag: "All",
	syslog: 0,
	label: "ALL",
	ordinal: -(2 ** 53 - 1),
	pipe() {
		return q(this, arguments);
	}
}, RD = {
	_tag: "Fatal",
	syslog: 2,
	label: "FATAL",
	ordinal: 5e4,
	pipe() {
		return q(this, arguments);
	}
}, zD = {
	_tag: "Error",
	syslog: 3,
	label: "ERROR",
	ordinal: 4e4,
	pipe() {
		return q(this, arguments);
	}
}, BD = {
	_tag: "Warning",
	syslog: 4,
	label: "WARN",
	ordinal: 3e4,
	pipe() {
		return q(this, arguments);
	}
}, VD = {
	_tag: "Info",
	syslog: 6,
	label: "INFO",
	ordinal: 2e4,
	pipe() {
		return q(this, arguments);
	}
}, HD = {
	_tag: "Debug",
	syslog: 7,
	label: "DEBUG",
	ordinal: 1e4,
	pipe() {
		return q(this, arguments);
	}
}, UD = {
	_tag: "Trace",
	syslog: 7,
	label: "TRACE",
	ordinal: 0,
	pipe() {
		return q(this, arguments);
	}
}, WD = {
	_tag: "None",
	syslog: 7,
	label: "OFF",
	ordinal: 2 ** 53 - 1,
	pipe() {
		return q(this, arguments);
	}
}, GD = /*#__PURE__*/ Symbol.for("effect/FiberRef"), KD = {
/* c8 ignore next */
_A: (e) => e }, qD = (e) => RE((t) => ZO(t.getFiberRef(e))), JD = /*#__PURE__*/ R(2, (e, t) => X(qD(e), t)), YD = /*#__PURE__*/ R(2, (e, t) => XD(e, () => [void 0, t])), XD = /*#__PURE__*/ R(2, (e, t) => RE((n) => {
	let [r, i] = t(n.getFiberRef(e));
	return n.setFiberRef(e, i), Z(r);
})), ZD = /*#__PURE__*/ R(3, (e, t, n) => zE(MD(qD(t), YD(t, n)), () => e, (e) => YD(t, e))), QD = /*#__PURE__*/ R(3, (e, t, n) => JD(t, (r) => ZD(e, t, n(r)))), $D = (e, t) => rO(e, {
	differ: Nw(),
	fork: t?.fork ?? rg,
	join: t?.join
}), eO = (e) => {
	let t = jw();
	return rO(e, {
		differ: t,
		fork: t.empty
	});
}, tO = (e) => {
	let t = Mw(Nw());
	return rO(e, {
		differ: t,
		fork: t.empty
	});
}, nO = (e) => {
	let t = Aw();
	return rO(e, {
		differ: t,
		fork: t.empty
	});
}, rO = (e, t) => ({
	...F_,
	[GD]: KD,
	initial: e,
	commit() {
		return qD(this);
	},
	diff: (e, n) => t.differ.diff(e, n),
	combine: (e, n) => t.differ.combine(e, n),
	patch: (e) => (n) => t.differ.patch(e, n),
	fork: t.fork,
	join: t.join ?? ((e, t) => t)
}), iO = (e) => rO(e, {
	differ: iT,
	fork: iT.empty
}), aO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentContext"), () => nO(Uy())), oO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => $D(0)), sO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => $D(2048)), cO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => $D(sC())), lO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogLevel"), () => $D(VD)), uO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLogSpan"), () => $D(OC())), dO = /*#__PURE__*/ R(2, (e, t) => ZD(e, oO, t)), fO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentConcurrency"), () => $D("unbounded")), pO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestBatching"), () => $D(!0)), mO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => $D(Y(HD))), hO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => $D(Y(BD))), gO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentMetricLabels"), () => tO(ty())), _O = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => $D(J(), {
	fork: () => J(),
	join: (e, t) => e
})), vO = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => $D(RT, {
	fork: () => RT,
	join: (e, t) => e
})), yO = /*#__PURE__*/ Symbol.for("effect/Scope"), bO = /*#__PURE__*/ Symbol.for("effect/CloseableScope"), xO = (e, t) => e.addFinalizer(() => VE(t)), SO = (e, t) => e.addFinalizer(t), CO = (e, t) => e.close(t), wO = (e, t) => e.fork(t), TO = (e) => EO(rg)(e), EO = /*#__PURE__*/ R(2, (e, t) => {
	let n = z(e, QT, yv(t));
	switch (n._tag) {
		case "None": return z(XT(e), wb, mv({
			onNone: () => {
				let t = Tv(ZT(e)).flatMap((e) => Tv(iC(e)).map((e) => `#${e}`));
				return new MO(t ? `Interrupted by fibers: ${t.join(", ")}` : void 0);
			},
			onSome: rg
		}));
		case "Some": return n.value;
	}
}), DO = /*#__PURE__*/ function() {
	class e extends globalThis.Error {
		commit() {
			return $E(this);
		}
		toJSON() {
			let e = { ...this };
			return this.message && (e.message = this.message), this.cause && (e.cause = this.cause), e;
		}
		[e_]() {
			return this.toString === globalThis.Error.prototype.toString ? "Bun" in globalThis ? mE(zT(this), { renderErrorCause: !0 }) : this : this.stack ? `${this.toString()}\n${this.stack.split("\n").slice(1).join("\n")}` : this.toString();
		}
	}
	return Object.assign(e.prototype, I_), e;
}(), OO = (e, t) => {
	class n extends DO {
		_tag = t;
	}
	return Object.assign(n.prototype, e), n.prototype.name = t, n;
}, kO = /*#__PURE__*/ Symbol.for("effect/Cause/errors/RuntimeException"), AO = /*#__PURE__*/ OO({ [kO]: kO }, "RuntimeException"), jO = /*#__PURE__*/ Symbol.for("effect/Cause/errors/InterruptedException"), MO = /*#__PURE__*/ OO({ [jO]: jO }, "InterruptedException"), NO = (e) => V(e, jO), PO = /*#__PURE__*/ Symbol.for("effect/Cause/errors/NoSuchElement"), FO = /*#__PURE__*/ OO({ [PO]: PO }, "NoSuchElementException"), IO = /*#__PURE__*/ Symbol.for("effect/Cause/errors/UnknownException"), LO = /*#__PURE__*/ function() {
	class e extends DO {
		_tag = "UnknownException";
		error;
		constructor(e, t) {
			super(t ?? "An unknown error occurred", { cause: e }), this.error = e;
		}
	}
	return Object.assign(e.prototype, {
		[IO]: IO,
		name: "UnknownException"
	}), e;
}(), RO = (e) => LE(e) && "_tag" in e && (e._tag === "Success" || e._tag === "Failure"), zO = (e) => e._tag === "Failure", BO = (e) => e._tag === "Success", VO = /*#__PURE__*/ R(2, (e, t) => {
	switch (e._tag) {
		case f_: return KO(e.effect_instruction_i0);
		case g_: return ZO(t);
	}
}), HO = (e) => VO(e, void 0), UO = (e, t) => ek(e, t?.parallel ? HT : UT), WO = (e) => KO(BT(e)), GO = (e) => KO(zT(e)), KO = (e) => {
	let t = new FE(f_);
	return t.effect_instruction_i0 = e, t;
}, qO = (e) => KO(VT(e)), JO = /*#__PURE__*/ R(2, (e, t) => {
	switch (e._tag) {
		case f_: return KO(e.effect_instruction_i0);
		case g_: return ZO(t(e.effect_instruction_i0));
	}
}), YO = /*#__PURE__*/ R(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case f_: return t(e.effect_instruction_i0);
		case g_: return n(e.effect_instruction_i0);
	}
}), XO = /*#__PURE__*/ R(2, (e, { onFailure: t, onSuccess: n }) => {
	switch (e._tag) {
		case f_: return t(e.effect_instruction_i0);
		case g_: return n(e.effect_instruction_i0);
	}
}), ZO = (e) => {
	let t = new IE(g_);
	return t.effect_instruction_i0 = e, t;
}, QO = /*#__PURE__*/ ZO(void 0), $O = /*#__PURE__*/ R(3, (e, t, { onFailure: n, onSuccess: r }) => {
	switch (e._tag) {
		case f_: switch (t._tag) {
			case g_: return KO(e.effect_instruction_i0);
			case f_: return KO(n(e.effect_instruction_i0, t.effect_instruction_i0));
		}
		case g_: switch (t._tag) {
			case g_: return ZO(r(e.effect_instruction_i0, t.effect_instruction_i0));
			case f_: return KO(t.effect_instruction_i0);
		}
	}
}), ek = (e, t) => {
	let n = ub(e);
	return Cb(n) ? z(Db(n), ay(z(Eb(n), JO(lb)), (e, n) => z(e, $O(n, {
		onSuccess: (e, t) => z(e, yb(t)),
		onFailure: t
	}))), JO(pb), JO((e) => fb(e)), Y) : J();
}, tk = (e) => ({
	...F_,
	[TE]: EE,
	state: BS(DE([])),
	commit() {
		return ik(this);
	},
	blockingOn: e
}), nk = () => X(rD, (e) => rk(e)), rk = (e) => $(() => tk(e)), ik = (e) => WE((t) => {
	let n = VS(e.state);
	switch (n._tag) {
		case wE: return t(n.effect);
		case CE: return n.joiners.push(t), lk(e, t);
	}
}, e.blockingOn), ak = /*#__PURE__*/ R(2, (e, t) => $(() => {
	let n = VS(e.state);
	switch (n._tag) {
		case wE: return !1;
		case CE:
			HS(e.state, OE(t));
			for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
			return !0;
	}
})), ok = /*#__PURE__*/ R(2, (e, t) => ak(e, tD(t))), sk = /*#__PURE__*/ R(2, (e, t) => ak(e, Z(t))), ck = (e, t) => {
	let n = VS(e.state);
	if (n._tag === "Pending") {
		HS(e.state, OE(t));
		for (let e = 0, r = n.joiners.length; e < r; e++) n.joiners[e](t);
	}
}, lk = (e, t) => $(() => {
	let n = VS(e.state);
	if (n._tag === "Pending") {
		let e = n.joiners.indexOf(t);
		e >= 0 && n.joiners.splice(e, 1);
	}
}), uk = /*#__PURE__*/ RE((e) => ZO(e.currentContext)), dk = () => uk, fk = (e) => X(dk(), e), pk = /*#__PURE__*/ R(2, (e, t) => ZD(aO, t)(e)), mk = /*#__PURE__*/ R(2, (e, t) => QD(aO, (e) => Yy(e, t))(e)), hk = /*#__PURE__*/ R(2, (e, t) => fk((n) => pk(e, t(n)))), gk = (e) => {
	let t = e.currentSpan;
	return t !== void 0 && t._tag === "Span" ? Y(t) : J();
}, _k = zO, vk = BO, yk = QO, bk = /*#__PURE__*/ Symbol.for("effect/MutableHashMap"), xk = {
	[bk]: bk,
	[Symbol.iterator]() {
		return new Sk(this);
	},
	toString() {
		return n_(this.toJSON());
	},
	toJSON() {
		return {
			_id: "MutableHashMap",
			values: Array.from(this).map(t_)
		};
	},
	[e_]() {
		return this.toJSON();
	},
	pipe() {
		return q(this, arguments);
	}
}, Sk = class e {
	self;
	referentialIterator;
	bucketIterator;
	constructor(e) {
		this.self = e, this.referentialIterator = e.referential[Symbol.iterator]();
	}
	next() {
		if (this.bucketIterator !== void 0) return this.bucketIterator.next();
		let e = this.referentialIterator.next();
		return e.done ? (this.bucketIterator = new Ck(this.self.buckets.values()), this.next()) : e;
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, Ck = class {
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
}, wk = () => {
	let e = Object.create(xk);
	return e.referential = /* @__PURE__ */ new Map(), e.buckets = /* @__PURE__ */ new Map(), e.bucketsSize = 0, e;
}, Tk = /*#__PURE__*/ R(2, (e, t) => {
	if (Qg(t) === !1) return e.referential.has(t) ? Y(e.referential.get(t)) : J();
	let n = t[H](), r = e.buckets.get(n);
	return r === void 0 ? J() : Ek(e, r, t);
}), Ek = (e, t, n, r = !1) => {
	for (let i = 0, a = t.length; i < a; i++) if (n[G](t[i][0])) {
		let n = t[i][1];
		return r && (t.splice(i, 1), e.bucketsSize--), Y(n);
	}
	return J();
}, Dk = /*#__PURE__*/ R(2, (e, t) => pv(Tk(e, t))), Ok = /*#__PURE__*/ R(3, (e, t, n) => {
	if (Qg(t) === !1) return e.referential.set(t, n), e;
	let r = t[H](), i = e.buckets.get(r);
	return i === void 0 ? (e.buckets.set(r, [[t, n]]), e.bucketsSize++, e) : (kk(e, i, t), i.push([t, n]), e.bucketsSize++, e);
}), kk = (e, t, n) => {
	for (let r = 0, i = t.length; r < i; r++) if (n[G](t[r][0])) {
		t.splice(r, 1), e.bucketsSize--;
		return;
	}
}, Ak = /*#__PURE__*/ Symbol.for("effect/Clock"), jk = /*#__PURE__*/ By("effect/Clock"), Mk = 2 ** 31 - 1, Nk = { unsafeSchedule(e, t) {
	let n = $b(t);
	if (n > Mk) return og;
	let r = !1, i = setTimeout(() => {
		r = !0, e();
	}, n);
	return () => (clearTimeout(i), !r);
} }, Pk = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || typeof performance.now != "function") return () => BigInt(Date.now()) * e;
	let t;
	return () => (t === void 0 && (t = BigInt(Date.now()) * e - BigInt(Math.round(performance.now() * 1e6))), t + BigInt(Math.round(performance.now() * 1e6)));
}(), Fk = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return Pk;
	let t = /*#__PURE__*/ Pk() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}(), Ik = class {
	[Ak] = Ak;
	unsafeCurrentTimeMillis() {
		return Date.now();
	}
	unsafeCurrentTimeNanos() {
		return Fk();
	}
	currentTimeMillis = /*#__PURE__*/ $(() => this.unsafeCurrentTimeMillis());
	currentTimeNanos = /*#__PURE__*/ $(() => this.unsafeCurrentTimeNanos());
	scheduler() {
		return Z(Nk);
	}
	sleep(e) {
		return GE((t) => VE($(Nk.unsafeSchedule(() => t(SD), e))));
	}
}, Lk = () => new Ik(), Rk = "InvalidData", zk = "MissingData", Bk = "SourceUnavailable", Vk = "Unsupported", Hk = /*#__PURE__*/ Symbol.for("effect/ConfigError"), Uk = {
	_tag: "ConfigError",
	[Hk]: Hk
}, Wk = (e, t) => {
	let n = Object.create(Uk);
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
}, Gk = (e, t) => {
	let n = Object.create(Uk);
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
}, Kk = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Uk);
	return r._op = Rk, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Invalid data at ${z(this.path, uy(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, qk = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Uk);
	return r._op = zk, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Missing data at ${z(this.path, uy(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Jk = (e, t, n, r = { pathDelim: "." }) => {
	let i = Object.create(Uk);
	return i._op = Bk, i.path = e, i.message = t, i.cause = n, Object.defineProperty(i, "toString", {
		enumerable: !1,
		value() {
			return `(Source unavailable at ${z(this.path, uy(r.pathDelim))}: "${this.message}")`;
		}
	}), i;
}, Yk = (e, t, n = { pathDelim: "." }) => {
	let r = Object.create(Uk);
	return r._op = Vk, r.path = e, r.message = t, Object.defineProperty(r, "toString", {
		enumerable: !1,
		value() {
			return `(Unsupported operation at ${z(this.path, uy(n.pathDelim))}: "${this.message}")`;
		}
	}), r;
}, Xk = /*#__PURE__*/ R(2, (e, t) => {
	switch (e._op) {
		case "And": return Wk(Xk(e.left, t), Xk(e.right, t));
		case "Or": return Gk(Xk(e.left, t), Xk(e.right, t));
		case Rk: return Kk([...t, ...e.path], e.message);
		case zk: return qk([...t, ...e.path], e.message);
		case Bk: return Jk([...t, ...e.path], e.message, e.cause);
		case Vk: return Yk([...t, ...e.path], e.message);
	}
}), Zk = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = [e], i = [];
	for (; r.length > 0;) {
		let e = r.pop();
		switch (e._op) {
			case "And":
				r.push(e.right), r.push(e.left), i.push(rv({ _op: "AndCase" }));
				break;
			case "Or":
				r.push(e.right), r.push(e.left), i.push(rv({ _op: "OrCase" }));
				break;
			case Rk:
				i.push(nv(n.invalidDataCase(t, e.path, e.message)));
				break;
			case zk:
				i.push(nv(n.missingDataCase(t, e.path, e.message)));
				break;
			case Bk:
				i.push(nv(n.sourceUnavailableCase(t, e.path, e.message, e.cause)));
				break;
			case Vk: i.push(nv(n.unsupportedCase(t, e.path, e.message)));
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
}), Qk = { _tag: "Empty" }, $k = /*#__PURE__*/ R(2, (e, t) => {
	let n = kC(t), r = e;
	for (; TC(n);) {
		let e = n.head;
		switch (e._tag) {
			case "Empty":
				n = n.tail;
				break;
			case "AndThen":
				n = DC(e.first, DC(e.second, n.tail));
				break;
			case "MapName":
				r = ry(r, e.f), n = n.tail;
				break;
			case "Nested":
				r = Dv(r, e.name), n = n.tail;
				break;
			case "Unnested": if (z(Lv(r), xv(e.name))) r = Vv(r), n = n.tail;
			else return rv(qk(r, `Expected ${e.name} to be in path in ConfigProvider#unnested`));
		}
	}
	return nv(r);
}), eA = "Constant", tA = "Fail", nA = "Fallback", rA = "Described", iA = "Lazy", aA = "MapOrFail", oA = "Nested", sA = "Primitive", cA = "Redacted", lA = "Sequence", uA = "HashMap", dA = "ZipWith", fA = (e, t) => [...e, ...t], pA = /*#__PURE__*/ Symbol.for("effect/ConfigProvider"), mA = /*#__PURE__*/ By("effect/ConfigProvider"), hA = /*#__PURE__*/ Symbol.for("effect/ConfigProviderFlat"), gA = (e) => ({
	[pA]: pA,
	pipe() {
		return q(this, arguments);
	},
	...e
}), _A = (e) => ({
	[hA]: hA,
	patch: e.patch,
	load: (t, n, r = !0) => e.load(t, n, r),
	enumerateChildren: e.enumerateChildren
}), vA = (e) => gA({
	load: (t) => X(wA(e, ty(), t, !1), (e) => mv(Lv(e), {
		onNone: () => $E(qk(ty(), `Expected a single value having structure: ${t}`)),
		onSome: Z
	})),
	flattened: e
}), yA = (e) => {
	let { pathDelim: t, seqDelim: n } = Object.assign({}, {
		pathDelim: "_",
		seqDelim: ","
	}, e), r = (e) => z(e, uy(t)), i = (e) => e.split(t), a = () => typeof process < "u" && "env" in process && typeof process.env == "object" ? process.env : {};
	return vA(_A({
		load: (e, t, i = !0) => {
			let o = r(e), s = a();
			return z(o in s ? Y(s[o]) : J(), hD(() => qk(e, `Expected ${o} to exist in the process context`)), X((r) => DA(r, e, t, n, i)));
		},
		enumerateChildren: (e) => $(() => {
			let t = a();
			return kS(Object.keys(t).map((e) => i(e.toUpperCase())).filter((t) => {
				for (let n = 0; n < e.length; n++) {
					let r = z(e, Iv(n)), i = t[n];
					if (i === void 0 || r !== i) return !1;
				}
				return !0;
			}).flatMap((t) => t.slice(e.length, e.length + 1)));
		}),
		patch: Qk
	}));
}, bA = (e, t, n, r) => {
	let i = oy(n.length, (t) => t >= r.length ? J() : Y([e(t), t + 1])), a = oy(r.length, (e) => e >= n.length ? J() : Y([t(e), e + 1]));
	return [fA(n, i), fA(r, a)];
}, xA = (e, t) => {
	let n = t;
	if (n._tag === "Nested") {
		let t = e.slice();
		for (; n._tag === "Nested";) t.push(n.name), n = n.config;
		return t;
	}
	return e;
}, SA = {
	andCase: (e, t, n) => Wk(t, n),
	orCase: (e, t, n) => Gk(t, n),
	invalidDataCase: (e, t) => Kk(t, "<redacted>"),
	missingDataCase: (e, t) => qk(t, "<redacted>"),
	sourceUnavailableCase: (e, t, n, r) => Jk(t, "<redacted>", r),
	unsupportedCase: (e, t) => Yk(t, "<redacted>")
}, CA = (e) => Zk(e, void 0, SA), wA = (e, t, n, r) => {
	let i = n;
	switch (i._tag) {
		case eA: return Z(ny(i.value));
		case rA: return Q(() => wA(e, t, i.config, r));
		case tA: return $E(qk(t, i.message));
		case nA: return z(Q(() => wA(e, t, i.first, r)), KE((n) => i.condition(n) ? z(wA(e, t, i.second, r), KE((e) => $E(Gk(n, e)))) : $E(n)));
		case iA: return Q(() => wA(e, t, i.config(), r));
		case aA: return Q(() => z(wA(e, t, i.original, r), X(uD((e) => z(i.mapOrFail(e), hD(Xk(xA(t, i.original))))))));
		case oA: return Q(() => wA(e, fA(t, ny(i.name)), i.config, r));
		case sA: return z($k(t, e.patch), X((t) => z(e.load(t, i, r), X((e) => {
			if (e.length === 0) {
				let e = z(zv(t), hv(() => "<n/a>"));
				return $E(qk([], `Expected ${i.description} with name ${e}`));
			}
			return Z(e);
		}))));
		case cA: return Q(() => z(wA(e, t, i.original, r), hD(CA), pD(ry(i.redact))));
		case lA: return z($k(t, e.patch), X((n) => z(e.enumerateChildren(n), X(kA), X((n) => n.length === 0 ? Q(() => pD(wA(e, t, i.config, !0), ny)) : z(uD(n, (n) => wA(e, Ov(t, `[${n}]`), i.config, !0)), pD((e) => {
			let t = iy(e);
			return t.length === 0 ? ny(ty()) : ny(t);
		}))))));
		case uA: return Q(() => z($k(t, e.patch), X((t) => z(e.enumerateChildren(t), X((n) => z(n, uD((n) => wA(e, fA(t, ny(n)), i.valueConfig, r)), pD((e) => e.length === 0 ? ny(sC()) : z(OA(e), ry((e) => cC(qv(Tv(n), e)))))))))));
		case dA: return Q(() => z(wA(e, t, i.left, r), ZE, X((n) => z(wA(e, t, i.right, r), ZE, X((e) => {
			if (iv(n) && iv(e)) return $E(Wk(n.left, e.left));
			if (iv(n) && av(e)) return $E(n.left);
			if (av(n) && iv(e)) return $E(e.left);
			if (av(n) && av(e)) {
				let r = TA(t, z(t, uy("."))), [a, o] = bA(r, r, z(n.right, ry(nv)), z(e.right, ry(nv)));
				return z(a, qv(o), uD(([e, t]) => z(jD(e, t), pD(([e, t]) => i.zip(e, t)))));
			}
			throw Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
		})))));
	}
}, TA = (e, t) => (n) => rv(qk(e, `The element at index ${n} in a sequence at path "${t}" was missing`)), EA = (e, t) => e.split(RegExp(`\\s*${fy(t)}\\s*`)), DA = (e, t, n, r, i) => i ? z(EA(e, r), uD((e) => n.parse(e.trim())), hD(Xk(t))) : z(n.parse(e), mD({
	onFailure: Xk(t),
	onSuccess: ny
})), OA = (e) => Object.keys(e[0]).map((t) => e.map((e) => e[t])), kA = (e) => z(uD(e, jA), mD({
	onFailure: () => ty(),
	onSuccess: Kv(dy)
}), ZE, pD(ov)), AA = /^(\[(\d+)\])$/, jA = (e) => {
	let t = e.match(AA);
	if (t !== null) {
		let e = t[2];
		return z(e !== void 0 && e.length > 0 ? Y(e) : J(), bv(MA));
	}
	return J();
}, MA = (e) => {
	let t = Number.parseInt(e);
	return Number.isNaN(t) ? J() : Y(t);
}, NA = /*#__PURE__*/ Symbol.for("effect/Console"), PA = /*#__PURE__*/ By("effect/Console"), FA = {
	[NA]: NA,
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
}, IA = /*#__PURE__*/ Symbol.for("effect/Random"), LA = /*#__PURE__*/ By("effect/Random"), RA = class {
	seed;
	[IA] = IA;
	PRNG;
	constructor(e) {
		this.seed = e, this.PRNG = new Mg(e);
	}
	get next() {
		return $(() => this.PRNG.number());
	}
	get nextBoolean() {
		return pD(this.next, (e) => e > .5);
	}
	get nextInt() {
		return $(() => this.PRNG.integer(2 ** 53 - 1));
	}
	nextRange(e, t) {
		return pD(this.next, (n) => (t - e) * n + e);
	}
	nextIntBetween(e, t) {
		return $(() => this.PRNG.integer(t - e) + e);
	}
	shuffle(e) {
		return zA(e, (e) => this.nextIntBetween(0, e));
	}
}, zA = (e, t) => Q(() => z($(() => Array.from(e)), X((e) => {
	let n = [];
	for (let t = e.length; t >= 2; --t) n.push(t);
	return z(n, dD((n) => z(t(n), pD((t) => BA(e, n - 1, t)))), BE(ub(e)));
}))), BA = (e, t, n) => {
	let r = e[t];
	return e[t] = e[n], e[n] = r, e;
}, VA = (e) => new RA(U(e)), HA = /*#__PURE__*/ Symbol.for("effect/Tracer"), UA = (e) => ({
	[HA]: HA,
	...e
}), WA = /*#__PURE__*/ By("effect/Tracer"), GA = /*#__PURE__*/ By("effect/ParentSpan"), KA = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), qA = class {
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
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = t._tag === "Some" ? t.value.traceId : KA(32), this.spanId = KA(16), this.links = Array.from(r);
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
}, JA = /*#__PURE__*/ UA({
	span: (e, t, n, r, i, a) => new qA(e, t, n, r, i, a),
	context: (e) => e()
}), YA = /*#__PURE__*/ Qy()("effect/Tracer/DisablePropagation", { defaultValue: og }), XA = /*#__PURE__*/ z(/*#__PURE__*/ Uy(), /*#__PURE__*/ Gy(jk, /*#__PURE__*/ Lk()), /*#__PURE__*/ Gy(PA, FA), /*#__PURE__*/ Gy(LA, /*#__PURE__*/ VA(/*#__PURE__*/ Math.random())), /*#__PURE__*/ Gy(mA, /*#__PURE__*/ yA()), /*#__PURE__*/ Gy(WA, JA)), ZA = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/DefaultServices/currentServices"), () => nO(XA));
// node_modules/effect/dist/esm/internal/fiberRefs.js
function QA(e) {
	return new tj(e);
}
function $A() {
	return QA(/* @__PURE__ */ new Map());
}
var ej = /*#__PURE__*/ Symbol.for("effect/FiberRefs"), tj = class {
	locals;
	[ej] = ej;
	constructor(e) {
		this.locals = e;
	}
	pipe() {
		return q(this, arguments);
	}
}, nj = (e, t, n, r = !1) => {
	let i = e, a = t, o = n, s = r, c;
	for (; c === void 0;) if (Mv(a) && Mv(o)) {
		let e = Rv(a)[0], t = Vv(a), n = Rv(o)[0], r = Rv(o)[1], i = Vv(o);
		e.startTimeMillis < n.startTimeMillis ? (o = i, s = !0) : e.startTimeMillis > n.startTimeMillis ? a = t : e.id < n.id ? (o = i, s = !0) : e.id > n.id ? a = t : c = [r, s];
	} else c = [i.initial, !0];
	return c;
}, rj = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = new Map(e.locals);
	return n.locals.forEach((e, n) => {
		let i = e[0][1];
		if (!e[0][0][G](t)) {
			if (!r.has(n)) {
				if (K(i, n.initial)) return;
				r.set(n, [[t, n.join(n.initial, i)]]);
				return;
			}
			let a = r.get(n), [o, s] = nj(n, a, e);
			if (s) {
				let e = n.diff(o, i), s = a[0][1], c = n.join(s, n.patch(e)(s));
				if (!K(s, c)) {
					let e, i = a[0][0];
					e = i[G](t) ? [[i, c], ...a.slice(1)] : [[t, c], ...a], r.set(n, e);
				}
			}
		}
	}), new tj(r);
}), ij = /*#__PURE__*/ R(2, (e, t) => {
	let n = /* @__PURE__ */ new Map();
	return aj(e, n, t), new tj(n);
}), aj = (e, t, n) => {
	e.locals.forEach((e, r) => {
		let i = e[0][1], a = r.patch(r.fork)(i);
		K(i, a) ? t.set(r, e) : t.set(r, [[n, a], ...e]);
	});
}, oj = /*#__PURE__*/ R(2, (e, t) => {
	let n = new Map(e.locals);
	return n.delete(t), new tj(n);
}), sj = /*#__PURE__*/ R(2, (e, t) => e.locals.has(t) ? Y(Rv(e.locals.get(t))[1]) : J()), cj = /*#__PURE__*/ R(2, (e, t) => z(sj(e, t), hv(() => t.initial))), lj = /*#__PURE__*/ R(2, (e, { fiberId: t, fiberRef: n, value: r }) => {
	if (e.locals.size === 0) return new tj(/* @__PURE__ */ new Map([[n, [[t, r]]]]));
	let i = new Map(e.locals);
	return uj(i, t, n, r), new tj(i);
}), uj = (e, t, n, r) => {
	let i = e.get(n) ?? [], a;
	if (Mv(i)) {
		let [e, n] = Rv(i);
		if (e[G](t)) {
			if (K(n, r)) return;
			a = [[t, r], ...i.slice(1)];
		} else a = [[t, r], ...i];
	} else a = [[t, r]];
	e.set(n, a);
}, dj = /*#__PURE__*/ R(2, (e, { entries: t, forkAs: n }) => {
	if (e.locals.size === 0) return new tj(new Map(t));
	let r = new Map(e.locals);
	return n !== void 0 && aj(e, r, n), t.forEach(([e, t]) => {
		t.length === 1 ? uj(r, t[0][0], e, t[0][1]) : t.forEach(([t, n]) => {
			uj(r, t, e, n);
		});
	}), new tj(r);
}), fj = cj, pj = dj, mj = $A, hj = LD, gj = RD, _j = zD, vj = BD, yj = VD, bj = HD, xj = UD, Sj = WD, Cj = /*#__PURE__*/ dv(/* @__PURE__ */ z(dy, /*#__PURE__*/ uv((e) => e.ordinal))), wj = (e) => {
	switch (e) {
		case "All": return hj;
		case "Debug": return bj;
		case "Error": return _j;
		case "Fatal": return gj;
		case "Info": return yj;
		case "Trace": return xj;
		case "None": return Sj;
		case "Warning": return vj;
	}
}, Tj = (e) => e.replace(/[\s="]/g, "_"), Ej = (e) => (t) => `${Tj(t.label)}=${e - t.startTime}ms`, Dj = N_, Oj = L_, kj = class extends Oj {}, Aj = /*#__PURE__*/ Symbol.for("effect/Readable"), jj = /*#__PURE__*/ Symbol.for("effect/Ref"), Mj = {
/* c8 ignore next */
_A: (e) => e }, Nj = class extends kj {
	ref;
	commit() {
		return this.get;
	}
	[jj] = Mj;
	[Aj] = Aj;
	constructor(e) {
		super(), this.ref = e, this.get = $(() => VS(this.ref));
	}
	get;
	modify(e) {
		return $(() => {
			let t = VS(this.ref), [n, r] = e(t);
			return t !== r && HS(r)(this.ref), n;
		});
	}
}, Pj = (e) => new Nj(BS(e)), Fj = (e) => $(() => Pj(e)), Ij = (e) => e.get, Lj = /*#__PURE__*/ R(2, (e, t) => e.modify(() => [void 0, t])), Rj = /*#__PURE__*/ R(2, (e, t) => e.modify(t)), zj = /*#__PURE__*/ R(2, (e, t) => e.modify((e) => [void 0, t(e)])), Bj = "Empty", Vj = "Remove", Hj = "Update", Uj = "AndThen", Wj = { _tag: Bj }, Gj = (e, t) => {
	let n = new Map(e.locals), r = Wj;
	for (let [e, i] of t.locals.entries()) {
		let t = Rv(i)[1], a = n.get(e);
		if (a !== void 0) {
			let n = Rv(a)[1];
			K(n, t) || (r = Kj({
				_tag: Hj,
				fiberRef: e,
				patch: e.diff(n, t)
			})(r));
		} else r = Kj({
			_tag: "Add",
			fiberRef: e,
			value: t
		})(r);
		n.delete(e);
	}
	for (let [e] of n.entries()) r = Kj({
		_tag: Vj,
		fiberRef: e
	})(r);
	return r;
}, Kj = /*#__PURE__*/ R(2, (e, t) => ({
	_tag: Uj,
	first: e,
	second: t
})), qj = /*#__PURE__*/ R(3, (e, t, n) => {
	let r = n, i = ny(e);
	for (; Mv(i);) {
		let e = Rv(i), n = Vv(i);
		switch (e._tag) {
			case Bj:
				i = n;
				break;
			case "Add":
				r = lj(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.value
				}), i = n;
				break;
			case Vj:
				r = oj(r, e.fiberRef), i = n;
				break;
			case Hj: {
				let a = cj(r, e.fiberRef);
				r = lj(r, {
					fiberId: t,
					fiberRef: e.fiberRef,
					value: e.fiberRef.patch(e.patch)(a)
				}), i = n;
				break;
			}
			case Uj: i = Dv(e.first)(Dv(e.second)(n));
		}
	}
	return r;
}), Jj = "effect/MetricLabel", Yj = /*#__PURE__*/ Symbol.for(Jj), Xj = class {
	key;
	value;
	[Yj] = Yj;
	_hash;
	constructor(e, t) {
		this.key = e, this.value = t, this._hash = Kg(Jj + this.key + this.value);
	}
	[H]() {
		return this._hash;
	}
	[G](e) {
		return Qj(e) && this.key === e.key && this.value === e.value;
	}
	pipe() {
		return q(this, arguments);
	}
}, Zj = (e, t) => new Xj(e, t), Qj = (e) => V(e, Yj), $j = (e) => pD(e, Y), eM = (e) => {
	let t, n;
	return typeof e == "function" ? t = e : (t = e.try, n = e.catch), Q(() => {
		try {
			return Z(Bg(t));
		} catch (e) {
			return $E(n ? Bg(() => n(e)) : new LO(e, "An unknown error occurred in Effect.try"));
		}
	});
}, tM = (e) => lM(e, rM, Gj), nM = /*#__PURE__*/ R(2, (e, t) => lD(e, {
	onFailure: (e) => Z(t.onFailure(e)),
	onSuccess: (e) => Z(t.onSuccess(e))
})), rM = /*#__PURE__*/ RE((e) => Z(e.getFiberRefs())), iM = (e) => nM(e, {
	onFailure: cg,
	onSuccess: cg
}), aM = (e) => fM((t, n) => z(e, qj(t, n))), oM = (e) => e.length >= 1 ? GE((t, n) => {
	try {
		e(n).then((e) => t(Z(e)), (e) => t(YE(e)));
	} catch (e) {
		t(YE(e));
	}
}) : GE((t) => {
	try {
		e().then((e) => t(Z(e)), (e) => t(YE(e)));
	} catch (e) {
		t(YE(e));
	}
}), sM = /*#__PURE__*/ R(3, (e, t, n) => fk((r) => pk(e, Gy(r, t, n)))), cM = /*#__PURE__*/ Z(/*#__PURE__*/ J()), lM = /*#__PURE__*/ R(3, (e, t, n) => X(t, (r) => X(e, (e) => pD(t, (t) => [n(r, t), e])))), uM = /*#__PURE__*/ R(2, (e, t) => cD(e, {
	onFailure: (e) => {
		let n = $T(e);
		switch (n._tag) {
			case "Left": return ND(t(n.left), tD(e));
			case "Right": return tD(e);
		}
	},
	onSuccess: Z
})), dM = (e) => {
	let t, n;
	typeof e == "function" ? t = e : (t = e.try, n = e.catch);
	let r = (e) => n ? eD(() => n(e)) : $E(new LO(e, "An unknown error occurred in Effect.tryPromise"));
	return t.length >= 1 ? GE((e, n) => {
		try {
			t(n).then((t) => e(Z(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	}) : GE((e) => {
		try {
			t().then((t) => e(Z(t)), (t) => e(r(t)));
		} catch (t) {
			e(r(t));
		}
	});
}, fM = (e) => RE((t) => (t.setFiberRefs(e(t.id(), t.getFiberRefs())), SD)), pM = /*#__PURE__*/ bv((e) => Ky(e.context, YA) ? e._tag === "Span" ? pM(e.parent) : J() : Y(e)), mM = "Sequential", hM = "Parallel", gM = "ParallelN", _M = { _tag: mM }, vM = { _tag: hM }, yM = (e) => ({
	_tag: gM,
	parallelism: e
}), bM = (e) => e._tag === mM, xM = (e) => e._tag === hM, SM = _M, CM = vM, wM = yM, TM = Gj, EM = qj, DM = "effect/FiberStatus", OM = /*#__PURE__*/ Symbol.for(DM), kM = "Done", AM = "Running", jM = "Suspended", MM = /*#__PURE__*/ Kg(`${DM}-${kM}`), NM = class {
	[OM] = OM;
	_tag = kM;
	[H]() {
		return MM;
	}
	[G](e) {
		return zM(e) && e._tag === "Done";
	}
}, PM = class {
	runtimeFlags;
	[OM] = OM;
	_tag = AM;
	constructor(e) {
		this.runtimeFlags = e;
	}
	[H]() {
		return z(U(DM), W(U(this._tag)), W(U(this.runtimeFlags)), Xg(this));
	}
	[G](e) {
		return zM(e) && e._tag === "Running" && this.runtimeFlags === e.runtimeFlags;
	}
}, FM = class {
	runtimeFlags;
	blockingOn;
	[OM] = OM;
	_tag = jM;
	constructor(e, t) {
		this.runtimeFlags = e, this.blockingOn = t;
	}
	[H]() {
		return z(U(DM), W(U(this._tag)), W(U(this.runtimeFlags)), W(U(this.blockingOn)), Xg(this));
	}
	[G](e) {
		return zM(e) && e._tag === "Suspended" && this.runtimeFlags === e.runtimeFlags && K(this.blockingOn, e.blockingOn);
	}
}, IM = /*#__PURE__*/ new NM(), LM = (e) => new PM(e), RM = (e, t) => new FM(e, t), zM = (e) => V(e, OM), BM = (e) => e._tag === kM, VM = IM, HM = LM, UM = RM, WM = BM, GM = /*#__PURE__*/ Symbol.for("effect/Micro"), KM = /*#__PURE__*/ Symbol.for("effect/Micro/MicroExit"), qM = /*#__PURE__*/ Symbol.for("effect/Micro/MicroCause"), JM = { _E: rg }, YM = class extends globalThis.Error {
	_tag;
	traces;
	[qM];
	constructor(e, t, n) {
		let r = `MicroCause.${e}`, i, a, o;
		if (t instanceof globalThis.Error) {
			i = `(${r}) ${t.name}`, a = t.message;
			let e = a.split("\n").length;
			o = t.stack ? `(${r}) ${t.stack.split("\n").slice(0, e + 3).join("\n")}` : `${i}: ${a}`;
		} else i = r, a = r_(t, 0), o = `${i}: ${a}`;
		n.length > 0 && (o += `\n    ${n.join("\n    ")}`), super(a), this._tag = e, this.traces = n, this[qM] = JM, this.name = i, this.stack = o;
	}
	pipe() {
		return q(this, arguments);
	}
	toString() {
		return this.stack;
	}
	[e_]() {
		return this.stack;
	}
}, XM = class extends YM {
	defect;
	constructor(e, t = []) {
		super("Die", e, t), this.defect = e;
	}
}, ZM = (e, t = []) => new XM(e, t), QM = class extends YM {
	constructor(e = []) {
		super("Interrupt", "interrupted", e);
	}
}, $M = (e = []) => new QM(e), eN = (e) => e._tag === "Interrupt", tN = /*#__PURE__*/ Symbol.for("effect/Micro/MicroFiber"), nN = {
	_A: rg,
	_E: rg
}, rN = class {
	context;
	interruptible;
	[tN];
	_stack = [];
	_observers = [];
	_exit;
	_children;
	currentOpCount = 0;
	constructor(e, t = !0) {
		this.context = e, this.interruptible = t, this[tN] = nN;
	}
	getRef(e) {
		return Py(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), cg) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	_interrupted = !1;
	unsafeInterrupt() {
		this._exit || (this._interrupted = !0, this.interruptible && this.evaluate(ON));
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
		if (t === dN) return;
		let n = iN.interruptChildren && iN.interruptChildren(this);
		if (n !== void 0) return this.evaluate(CN(n, () => t));
		this._exit = t;
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = !1, n = e;
		this.currentOpCount = 0;
		try {
			for (;;) {
				if (this.currentOpCount++, !t && this.getRef(IN).shouldYield(this)) {
					t = !0;
					let e = n;
					n = CN(bN, () => e);
				}
				if (n = n[sN](this), n === dN) {
					let e = this._yielded;
					return KM in e ? (this._yielded = void 0, e) : dN;
				}
			}
		} catch (e) {
			return V(n, sN) ? kN(e) : kN(`MicroFiber.runLoop: Not a valid effect: ${String(n)}`);
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[uN] && t[uN](this);
			if (n) return { [e]: n };
			if (t[e]) return t;
		}
	}
	_yielded = void 0;
	yieldWith(e) {
		return this._yielded = e, dN;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
}, iN = /*#__PURE__*/ B("effect/Micro/fiberMiddleware", () => ({ interruptChildren: void 0 })), aN = /*#__PURE__*/ Symbol.for("effect/Micro/identifier"), oN = /*#__PURE__*/ Symbol.for("effect/Micro/args"), sN = /*#__PURE__*/ Symbol.for("effect/Micro/evaluate"), cN = /*#__PURE__*/ Symbol.for("effect/Micro/successCont"), lN = /*#__PURE__*/ Symbol.for("effect/Micro/failureCont"), uN = /*#__PURE__*/ Symbol.for("effect/Micro/ensureCont"), dN = /*#__PURE__*/ Symbol.for("effect/Micro/Yield"), fN = {
	_A: rg,
	_E: rg,
	_R: rg
}, pN = {
	...Dj,
	_op: "Micro",
	[GM]: fN,
	pipe() {
		return q(this, arguments);
	},
	[Symbol.iterator]() {
		return new Tg(new Ig(this));
	},
	toJSON() {
		return {
			_id: "Micro",
			op: this[aN],
			...oN in this ? { args: this[oN] } : void 0
		};
	},
	toString() {
		return n_(this);
	},
	[e_]() {
		return n_(this);
	}
};
function mN(e) {
	return kN("Micro.evaluate: Not implemented");
}
var hN = (e) => ({
	...pN,
	[aN]: e.op,
	[sN]: e.eval ?? mN,
	[cN]: e.contA,
	[lN]: e.contE,
	[uN]: e.ensure
}), gN = (e) => {
	let t = hN(e);
	return function() {
		let n = Object.create(t);
		return n[oN] = e.single === !1 ? arguments : arguments[0], n;
	};
}, _N = (e) => {
	let t = {
		...hN(e),
		[KM]: KM,
		_tag: e.op,
		get [e.prop]() {
			return this[oN];
		},
		toJSON() {
			return {
				_id: "MicroExit",
				_tag: e.op,
				[e.prop]: this[oN]
			};
		},
		[G](t) {
			return TN(t) && t._tag === e.op && K(this[oN], t[oN]);
		},
		[H]() {
			return Xg(this, W(Kg(e.op))(U(this[oN])));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[oN] = e, n[cN] = void 0, n[lN] = void 0, n[uN] = void 0, n;
	};
}, vN = /*#__PURE__*/ _N({
	op: "Success",
	prop: "value",
	eval(e) {
		let t = e.getCont(cN);
		return t ? t[cN](this[oN], e) : e.yieldWith(this);
	}
}), yN = /*#__PURE__*/ _N({
	op: "Failure",
	prop: "cause",
	eval(e) {
		let t = e.getCont(lN);
		for (; eN(this[oN]) && t && e.interruptible;) t = e.getCont(lN);
		return t ? t[lN](this[oN], e) : e.yieldWith(this);
	}
}), bN = /*#__PURE__*/ (/* @__PURE__ */ gN({
	op: "Yield",
	eval(e) {
		let t = !1;
		return e.getRef(IN).scheduleTask(() => {
			t || e.evaluate(AN);
		}, this[oN] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), xN = /*#__PURE__*/ vN(void 0), SN = /*#__PURE__*/ gN({
	op: "WithMicroFiber",
	eval(e) {
		return this[oN](e);
	}
}), CN = /*#__PURE__*/ R(2, (e, t) => {
	let n = Object.create(wN);
	return n[oN] = e, n[cN] = t, n;
}), wN = /*#__PURE__*/ hN({
	op: "OnSuccess",
	eval(e) {
		return e._stack.push(this), this[oN];
	}
}), TN = (e) => V(e, KM), EN = vN, DN = yN, ON = /*#__PURE__*/ DN(/*#__PURE__*/ $M()), kN = (e) => DN(ZM(e)), AN = /*#__PURE__*/ EN(void 0), jN = "setImmediate" in globalThis ? globalThis.setImmediate : (e) => setTimeout(e, 0), MN = class {
	tasks = [];
	running = !1;
	scheduleTask(e, t) {
		this.tasks.push(e), this.running || (this.running = !0, jN(this.afterScheduled));
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
		return e.currentOpCount >= e.getRef(FN);
	}
	flush() {
		for (; this.tasks.length > 0;) this.runTasks();
	}
}, NN = /*#__PURE__*/ R(2, (e, t) => SN((n) => {
	let r = n.context;
	return n.context = t(r), zN(e, () => (n.context = r, xN));
})), PN = /*#__PURE__*/ R(2, (e, t) => NN(e, Yy(t))), FN = class extends (/*#__PURE__*/ Qy()("effect/Micro/currentMaxOpsBeforeYield", { defaultValue: () => 2048 })) {}, IN = class extends (/*#__PURE__*/ Qy()("effect/Micro/currentScheduler", { defaultValue: () => new MN() })) {}, LN = /*#__PURE__*/ R(2, (e, t) => {
	let n = Object.create(RN);
	return n[oN] = e, n[cN] = t.onSuccess, n[lN] = t.onFailure, n;
}), RN = /*#__PURE__*/ hN({
	op: "OnSuccessAndFailure",
	eval(e) {
		return e._stack.push(this), this[oN];
	}
}), zN = /*#__PURE__*/ R(2, (e, t) => HN((n) => LN(n(e), {
	onFailure: (e) => CN(t(DN(e)), () => yN(e)),
	onSuccess: (e) => CN(t(EN(e)), () => vN(e))
}))), BN = /*#__PURE__*/ gN({
	op: "SetInterruptible",
	ensure(e) {
		if (e.interruptible = this[oN], e._interrupted && e.interruptible) return () => ON;
	}
}), VN = (e) => SN((t) => t.interruptible ? e : (t.interruptible = !0, t._stack.push(BN(!1)), t._interrupted ? ON : e)), HN = (e) => SN((t) => t.interruptible ? (t.interruptible = !1, t._stack.push(BN(!0)), e(VN)) : e(rg)), UN = (e, t) => {
	let n = new rN(IN.context(t?.scheduler ?? new MN()));
	if (n.evaluate(e), t?.signal) {
		if (t.signal.aborted) n.unsafeInterrupt();
		else {
			let e = () => n.unsafeInterrupt();
			t.signal.addEventListener("abort", e, { once: !0 }), n.addObserver(() => t.signal.removeEventListener("abort", e));
		}
	}
	return n;
}, WN = class e {
	scheduleDrain;
	running = !1;
	tasks = /*#__PURE__*/ new GN();
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
}, GN = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets.length, r, i = 0;
		for (; i < n && this.buckets[i][0] <= t; i++) r = this.buckets[i];
		r && r[0] === t ? r[1].push(e) : i === n ? this.buckets.push([t, [e]]) : this.buckets.splice(i, 0, [t, [e]]);
	}
}, KN = class {
	maxNextTickBeforeTimer;
	getRunner = /*#__PURE__*/ WN.cached((e, t) => {
		e >= this.maxNextTickBeforeTimer ? setTimeout(() => t(0), 0) : Promise.resolve(void 0).then(() => t(e + 1));
	});
	constructor(e) {
		this.maxNextTickBeforeTimer = e;
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(sO) && e.getFiberRef(oO);
	}
	scheduleTask(e, t, n) {
		this.getRunner(n).scheduleTask(e, t);
	}
}, qN = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Scheduler/defaultScheduler"), () => new KN(2048)), JN = class {
	tasks = /*#__PURE__*/ new GN();
	deferred = !1;
	scheduleTask(e, t, n) {
		this.deferred ? qN.scheduleTask(e, t, n) : this.tasks.scheduleTask(e, t);
	}
	shouldYield(e) {
		return e.currentOpCount > e.getFiberRef(sO) && e.getFiberRef(oO);
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) {
			let e = this.tasks.buckets;
			this.tasks.buckets = [];
			for (let [t, n] of e) for (let e = 0; e < n.length; e++) n[e]();
		}
		this.deferred = !0;
	}
}, YN = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentScheduler"), () => $D(qN)), XN = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentRequestMap"), () => $D(/* @__PURE__ */ new Map())), ZN = (e, t, n, r) => {
	switch (e) {
		case void 0: return t();
		case "unbounded": return n();
		case "inherit": return JD(fO, (e) => e === "unbounded" ? n() : e > 1 ? r(e) : t());
		default: return e > 1 ? r(e) : t();
	}
}, QN = "InterruptSignal", $N = "Stateful", eP = "Resume", tP = "YieldNow", nP = (e) => ({
	_tag: QN,
	cause: e
}), rP = (e) => ({
	_tag: $N,
	onFiber: e
}), iP = (e) => ({
	_tag: eP,
	effect: e
}), aP = () => ({ _tag: tP }), oP = /*#__PURE__*/ Symbol.for("effect/FiberScope"), sP = class {
	[oP] = oP;
	fiberId = rC;
	roots = /*#__PURE__*/ new Set();
	add(e, t) {
		this.roots.add(t), t.addObserver(() => {
			this.roots.delete(t);
		});
	}
}, cP = class {
	fiberId;
	parent;
	[oP] = oP;
	constructor(e, t) {
		this.fiberId = e, this.parent = t;
	}
	add(e, t) {
		this.parent.tell(rP((e) => {
			e.addChild(t), t.addObserver(() => {
				e.removeChild(t);
			});
		}));
	}
}, lP = (e) => new cP(e.id(), e), uP = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberScope/Global"), () => new sP()), dP = /*#__PURE__*/ Symbol.for("effect/Fiber"), fP = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, pP = {
	[dP]: fP,
	pipe() {
		return q(this, arguments);
	}
}, mP = /*#__PURE__*/ Symbol.for("effect/Fiber"), hP = (e) => MD(oD(e.await), e.inheritAll);
({ ...F_ }), { ...pP };
var gP = "effect/FiberCurrent", _P = /*#__PURE__*/ Symbol.for("effect/Logger"), vP = {
	/* c8 ignore next */
	_Message: (e) => e,
	/* c8 ignore next */
	_Output: (e) => e
}, yP = (e) => ({
	[_P]: vP,
	log: e,
	pipe() {
		return q(this, arguments);
	}
}), bP = /^[^\s"=]*$/, xP = /*#__PURE__*/ yP(/*#__PURE__*/ ((e, t) => ({ annotations: n, cause: r, date: i, fiberId: a, logLevel: o, message: s, spans: c }) => {
	let l = (t) => t.match(bP) ? t : e(t), u = (e, t) => `${Tj(e)}=${l(t)}`, d = (e, t) => " " + u(e, t), f = u("timestamp", i.toISOString());
	f += d("level", o.label), f += d("fiber", tC(a));
	let p = Ev(s);
	for (let e = 0; e < p.length; e++) f += d("message", r_(p[e], t));
	GT(r) || (f += d("cause", mE(r, { renderErrorCause: !0 })));
	for (let e of c) f += " " + Ej(i.getTime())(e);
	for (let [e, r] of n) f += d(e, r_(r, t));
	return f;
})((e) => `"${e.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`)), SP = {
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
SP.gray, SP.blue, SP.green, SP.yellow, SP.red, SP.bgBrightRed, SP.black;
var CP = typeof process == "object" && process !== null && typeof process.stdout == "object" && process.stdout !== null;
CP && process.stdout.isTTY, CP || "Deno" in globalThis;
// node_modules/effect/dist/esm/internal/metric/boundaries.js
var wP = "effect/MetricBoundaries", TP = /*#__PURE__*/ Symbol.for(wP), EP = class {
	values;
	[TP] = TP;
	constructor(e) {
		this.values = e, this._hash = z(Kg(wP), W(Yg(this.values)));
	}
	_hash;
	[H]() {
		return this._hash;
	}
	[G](e) {
		return DP(e) && K(this.values, e.values);
	}
	pipe() {
		return q(this, arguments);
	}
}, DP = (e) => V(e, TP), OP = (e) => new EP(z(e, kv(lb(Infinity)), ly)), kP = (e) => z(wv(e.count - 1, (t) => e.start * e.factor ** +t), hb, OP), AP = /*#__PURE__*/ Symbol.for("effect/MetricKeyType"), jP = "effect/MetricKeyType/Counter", MP = /*#__PURE__*/ Symbol.for(jP), NP = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Frequency"), PP = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Gauge"), FP = "effect/MetricKeyType/Histogram", IP = /*#__PURE__*/ Symbol.for(FP), LP = /*#__PURE__*/ Symbol.for("effect/MetricKeyType/Summary"), RP = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, zP = class {
	incremental;
	bigint;
	[AP] = RP;
	[MP] = MP;
	constructor(e, t) {
		this.incremental = e, this.bigint = t, this._hash = Kg(jP);
	}
	_hash;
	[H]() {
		return this._hash;
	}
	[G](e) {
		return UP(e);
	}
	pipe() {
		return q(this, arguments);
	}
}, BP = class {
	boundaries;
	[AP] = RP;
	[IP] = IP;
	constructor(e) {
		this.boundaries = e, this._hash = z(Kg(FP), W(U(this.boundaries)));
	}
	_hash;
	[H]() {
		return this._hash;
	}
	[G](e) {
		return KP(e) && K(this.boundaries, e.boundaries);
	}
	pipe() {
		return q(this, arguments);
	}
}, VP = (e) => new zP(e?.incremental ?? !1, e?.bigint ?? !1), HP = (e) => new BP(e), UP = (e) => V(e, MP), WP = (e) => V(e, NP), GP = (e) => V(e, PP), KP = (e) => V(e, IP), qP = (e) => V(e, LP), JP = /*#__PURE__*/ Symbol.for("effect/MetricKey"), YP = {
/* c8 ignore next */
_Type: (e) => e }, XP = /*#__PURE__*/ sy(K), ZP = class {
	name;
	keyType;
	description;
	tags;
	[JP] = YP;
	constructor(e, t, n, r = []) {
		this.name = e, this.keyType = t, this.description = n, this.tags = r, this._hash = z(Kg(this.name + this.description), W(U(this.keyType)), W(Yg(this.tags)));
	}
	_hash;
	[H]() {
		return this._hash;
	}
	[G](e) {
		return QP(e) && this.name === e.name && K(this.keyType, e.keyType) && K(this.description, e.description) && XP(this.tags, e.tags);
	}
	pipe() {
		return q(this, arguments);
	}
}, QP = (e) => V(e, JP), $P = (e, t) => new ZP(e, VP(t), _v(t?.description)), eF = (e, t, n) => new ZP(e, HP(t), _v(n)), tF = /*#__PURE__*/ R(2, (e, t) => t.length === 0 ? e : new ZP(e.name, e.keyType, e.description, ey(e.tags, t))), nF = /*#__PURE__*/ Symbol.for("effect/MetricState"), rF = "effect/MetricState/Counter", iF = /*#__PURE__*/ Symbol.for(rF), aF = "effect/MetricState/Frequency", oF = /*#__PURE__*/ Symbol.for(aF), sF = "effect/MetricState/Gauge", cF = /*#__PURE__*/ Symbol.for(sF), lF = "effect/MetricState/Histogram", uF = /*#__PURE__*/ Symbol.for(lF), dF = "effect/MetricState/Summary", fF = /*#__PURE__*/ Symbol.for(dF), pF = {
/* c8 ignore next */
_A: (e) => e }, mF = class {
	count;
	[nF] = pF;
	[iF] = iF;
	constructor(e) {
		this.count = e;
	}
	[H]() {
		return z(U(rF), W(U(this.count)), Xg(this));
	}
	[G](e) {
		return TF(e) && this.count === e.count;
	}
	pipe() {
		return q(this, arguments);
	}
}, hF = /*#__PURE__*/ sy(K), gF = class {
	occurrences;
	[nF] = pF;
	[oF] = oF;
	constructor(e) {
		this.occurrences = e;
	}
	_hash;
	[H]() {
		return z(Kg(aF), W(Yg(Tv(this.occurrences.entries()))), Xg(this));
	}
	[G](e) {
		return EF(e) && hF(Tv(this.occurrences.entries()), Tv(e.occurrences.entries()));
	}
	pipe() {
		return q(this, arguments);
	}
}, _F = class {
	value;
	[nF] = pF;
	[cF] = cF;
	constructor(e) {
		this.value = e;
	}
	[H]() {
		return z(U(sF), W(U(this.value)), Xg(this));
	}
	[G](e) {
		return DF(e) && this.value === e.value;
	}
	pipe() {
		return q(this, arguments);
	}
}, vF = class {
	buckets;
	count;
	min;
	max;
	sum;
	[nF] = pF;
	[uF] = uF;
	constructor(e, t, n, r, i) {
		this.buckets = e, this.count = t, this.min = n, this.max = r, this.sum = i;
	}
	[H]() {
		return z(U(lF), W(U(this.buckets)), W(U(this.count)), W(U(this.min)), W(U(this.max)), W(U(this.sum)), Xg(this));
	}
	[G](e) {
		return OF(e) && K(this.buckets, e.buckets) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return q(this, arguments);
	}
}, yF = class {
	error;
	quantiles;
	count;
	min;
	max;
	sum;
	[nF] = pF;
	[fF] = fF;
	constructor(e, t, n, r, i, a) {
		this.error = e, this.quantiles = t, this.count = n, this.min = r, this.max = i, this.sum = a;
	}
	[H]() {
		return z(U(dF), W(U(this.error)), W(U(this.quantiles)), W(U(this.count)), W(U(this.min)), W(U(this.max)), W(U(this.sum)), Xg(this));
	}
	[G](e) {
		return kF(e) && this.error === e.error && K(this.quantiles, e.quantiles) && this.count === e.count && this.min === e.min && this.max === e.max && this.sum === e.sum;
	}
	pipe() {
		return q(this, arguments);
	}
}, bF = (e) => new mF(e), xF = (e) => new gF(e), SF = (e) => new _F(e), CF = (e) => new vF(e.buckets, e.count, e.min, e.max, e.sum), wF = (e) => new yF(e.error, e.quantiles, e.count, e.min, e.max, e.sum), TF = (e) => V(e, iF), EF = (e) => V(e, oF), DF = (e) => V(e, cF), OF = (e) => V(e, uF), kF = (e) => V(e, fF), AF = /*#__PURE__*/ Symbol.for("effect/MetricHook"), jF = {
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, MF = (e) => ({
	[AF]: jF,
	pipe() {
		return q(this, arguments);
	},
	...e
}), NF = /*#__PURE__*/ BigInt(0), PF = (e) => {
	let t = e.keyType.bigint ? NF : 0, n = e.keyType.incremental ? e.keyType.bigint ? (e) => e >= NF : (e) => e >= 0 : (e) => !0, r = (e) => {
		n(e) && (t += e);
	};
	return MF({
		get: () => bF(t),
		update: r,
		modify: r
	});
}, FF = (e) => {
	let t = /* @__PURE__ */ new Map();
	for (let n of e.keyType.preregisteredWords) t.set(n, 0);
	let n = (e) => {
		let n = t.get(e) ?? 0;
		t.set(e, n + 1);
	};
	return MF({
		get: () => xF(t),
		update: n,
		modify: n
	});
}, IF = (e, t) => {
	let n = t;
	return MF({
		get: () => SF(n),
		update: (e) => {
			n = e;
		},
		modify: (e) => {
			n += e;
		}
	});
}, LF = (e) => {
	let t = e.keyType.boundaries.values, n = t.length, r = new Uint32Array(n + 1), i = new Float64Array(n), a = 0, o = 0, s = Number.MAX_VALUE, c = Number.MIN_VALUE;
	z(t, Kv(dy), ry((e, t) => {
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
		let e = Cv(n), t = 0;
		for (let a = 0; a < n; a++) {
			let n = i[a], o = r[a];
			t += o, e[a] = [n, t];
		}
		return e;
	};
	return MF({
		get: () => CF({
			buckets: u(),
			count: a,
			min: s,
			max: c,
			sum: o
		}),
		update: l,
		modify: l
	});
}, RF = (e) => {
	let { error: t, maxAge: n, maxSize: r, quantiles: i } = e.keyType, a = z(i, Kv(dy)), o = Cv(r), s = 0, c = 0, l = 0, u = 0, d = 0, f = (e) => {
		let i = [], s = 0;
		for (; s !== r - 1;) {
			let t = o[s];
			if (t != null) {
				let [r, a] = t, o = qb(e - r);
				ox(o, Ub) && ax(o, n) && i.push(a);
			}
			s += 1;
		}
		return zF(t, a, Kv(i, dy));
	}, p = (e, t) => {
		if (r > 0) {
			s += 1;
			let n = s % r;
			o[n] = [t, e];
		}
		u = c === 0 ? e : Math.min(u, e), d = c === 0 ? e : Math.max(d, e), c += 1, l += e;
	};
	return MF({
		get: () => wF({
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
}, zF = (e, t, n) => {
	let r = n.length;
	if (!Mv(t)) return ty();
	let i = t[0], a = t.slice(1), o = BF(e, r, J(), 0, i, n), s = ny(o);
	return a.forEach((t) => {
		s.push(BF(e, r, o.value, o.consumed, t, o.rest));
	}), ry(s, (e) => [e.quantile, e.value]);
}, BF = (e, t, n, r, i, a) => {
	let o = e, s = t, c = n, l = r, u = i, d = a, f = e, p = t, m = n, h = r, g = i, _ = a;
	for (;;) {
		if (!Mv(d)) return {
			quantile: u,
			value: J(),
			consumed: l,
			rest: []
		};
		if (u === 1) return {
			quantile: u,
			value: Y(Bv(d)),
			consumed: l + d.length,
			rest: []
		};
		let e = Rv(d), t = Uv(d, (t) => t === e), n = u * s, r = o / 2 * n, i = l + t[0].length, a = Math.abs(i - n);
		if (i < n - r) f = o, p = s, m = Lv(d), h = i, g = u, _ = t[1], o = f, s = p, c = m, l = h, u = g, d = _;
		else {
			if (i > n + r) {
				let t = fv(c) ? Y(e) : c;
				return {
					quantile: u,
					value: t,
					consumed: l,
					rest: d
				};
			}
			switch (c._tag) {
				case "None":
					f = o, p = s, m = Lv(d), h = i, g = u, _ = t[1], o = f, s = p, c = m, l = h, u = g, d = _;
					continue;
				case "Some":
					if (a < Math.abs(n - c.value)) {
						f = o, p = s, m = Lv(d), h = i, g = u, _ = t[1], o = f, s = p, c = m, l = h, u = g, d = _;
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
}, VF = /*#__PURE__*/ Symbol.for("effect/MetricPair"), HF = {
/* c8 ignore next */
_Type: (e) => e }, UF = (e, t) => ({
	[VF]: HF,
	metricKey: e,
	metricState: t,
	pipe() {
		return q(this, arguments);
	}
}), WF = /*#__PURE__*/ Symbol.for("effect/MetricRegistry"), GF = class {
	[WF] = WF;
	map = /*#__PURE__*/ wk();
	snapshot() {
		let e = [];
		for (let [t, n] of this.map) e.push(UF(t, n.get()));
		return e;
	}
	get(e) {
		let t = z(this.map, Tk(e), vv);
		if (t == null) {
			if (UP(e.keyType)) return this.getCounter(e);
			if (GP(e.keyType)) return this.getGauge(e);
			if (WP(e.keyType)) return this.getFrequency(e);
			if (KP(e.keyType)) return this.getHistogram(e);
			if (qP(e.keyType)) return this.getSummary(e);
			throw Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
		}
		return t;
	}
	getCounter(e) {
		let t = z(this.map, Tk(e), vv);
		if (t == null) {
			let n = PF(e);
			z(this.map, Dk(e)) || z(this.map, Ok(e, n)), t = n;
		}
		return t;
	}
	getFrequency(e) {
		let t = z(this.map, Tk(e), vv);
		if (t == null) {
			let n = FF(e);
			z(this.map, Dk(e)) || z(this.map, Ok(e, n)), t = n;
		}
		return t;
	}
	getGauge(e) {
		let t = z(this.map, Tk(e), vv);
		if (t == null) {
			let n = IF(e, e.keyType.bigint ? BigInt(0) : 0);
			z(this.map, Dk(e)) || z(this.map, Ok(e, n)), t = n;
		}
		return t;
	}
	getHistogram(e) {
		let t = z(this.map, Tk(e), vv);
		if (t == null) {
			let n = LF(e);
			z(this.map, Dk(e)) || z(this.map, Ok(e, n)), t = n;
		}
		return t;
	}
	getSummary(e) {
		let t = z(this.map, Tk(e), vv);
		if (t == null) {
			let n = RF(e);
			z(this.map, Dk(e)) || z(this.map, Ok(e, n)), t = n;
		}
		return t;
	}
}, KF = () => new GF(), qF = /*#__PURE__*/ Symbol.for("effect/Metric"), JF = {
	/* c8 ignore next */
	_Type: (e) => e,
	/* c8 ignore next */
	_In: (e) => e,
	/* c8 ignore next */
	_Out: (e) => e
}, YF = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Metric/globalMetricRegistry"), () => KF()), XF = function(e, t, n, r) {
	let i = Object.assign((e) => vD(e, (e) => nI(i, e)), {
		[qF]: JF,
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
}, ZF = (e, t) => QF($P(e, t)), QF = (e) => {
	let t, n = /* @__PURE__ */ new WeakMap(), r = (r) => {
		if (r.length === 0) return t === void 0 && (t = YF.get(e)), t;
		let i = n.get(r);
		return i === void 0 && (i = YF.get(tF(e, r)), n.set(r, i)), i;
	};
	return XF(e.keyType, (e, t) => r(t).update(e), (e) => r(e).get(), (e, t) => r(t).modify(e));
}, $F = (e, t, n) => QF(eF(e, t, n)), eI = /*#__PURE__*/ R(3, (e, t, n) => tI(e, [Zj(t, n)])), tI = /*#__PURE__*/ R(2, (e, t) => XF(e.keyType, (n, r) => e.unsafeUpdate(n, ey(t, r)), (n) => e.unsafeValue(ey(t, n)), (n, r) => e.unsafeModify(n, ey(t, r)))), nI = /*#__PURE__*/ R(2, (e, t) => JD(gO, (n) => $(() => e.unsafeUpdate(t, n))));
({ ...P_ });
var rI = /*#__PURE__*/ R(2, (e, t) => JD(XN, (n) => $(() => {
	if (n.has(e)) {
		let r = n.get(e);
		r.state.completed || (r.state.completed = !0, ck(r.result, t));
	}
}))), iI = /*#__PURE__*/ Symbol.for("effect/Supervisor"), aI = {
/* c8 ignore next */
_T: (e) => e }, oI = class e {
	underlying;
	value0;
	[iI] = aI;
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
		return new e(this, z(this.value, pD(t)));
	}
	zip(e) {
		return new sI(this, e);
	}
}, sI = class e {
	left;
	right;
	_tag = "Zip";
	[iI] = aI;
	constructor(e, t) {
		this.left = e, this.right = t;
	}
	get value() {
		return jD(this.left.value, this.right.value);
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
		return new oI(this, z(this.value, pD(e)));
	}
	zip(t) {
		return new e(this, t);
	}
}, cI = (e) => V(e, iI) && bg(e, "Zip"), lI = class {
	effect;
	[iI] = aI;
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
		return new oI(this, z(this.value, pD(e)));
	}
	zip(e) {
		return new sI(this, e);
	}
	onRun(e, t) {
		return e();
	}
}, uI = (e) => new lI(e), dI = /*#__PURE__*/ B("effect/Supervisor/none", () => uI(SD)), fI = kw, pI = "Empty", mI = "AddSupervisor", hI = "RemoveSupervisor", gI = "AndThen", _I = { _tag: pI }, vI = (e, t) => ({
	_tag: gI,
	first: e,
	second: t
}), yI = (e, t) => bI(t, lb(e)), bI = (e, t) => {
	let n = e, r = t;
	for (; Cb(r);) {
		let e = Eb(r);
		switch (e._tag) {
			case pI:
				r = Db(r);
				break;
			case mI:
				n = n.zip(e.supervisor), r = Db(r);
				break;
			case hI:
				n = xI(n, e.supervisor), r = Db(r);
				break;
			case gI: r = yb(e.first)(yb(e.second)(Db(r)));
		}
	}
	return n;
}, xI = (e, t) => K(e, t) ? dI : cI(e) ? xI(e.left, t).zip(xI(e.right, t)) : e, SI = (e) => K(e, dI) ? OS() : cI(e) ? z(SI(e.left), IS(SI(e.right))) : AS(e), CI = /*#__PURE__*/ fI({
	empty: _I,
	patch: yI,
	combine: vI,
	diff: (e, t) => {
		if (K(e, t)) return _I;
		let n = SI(e), r = SI(t);
		return vI(z(r, FS(n), LS(_I, (e, t) => vI(e, {
			_tag: mI,
			supervisor: t
		}))), z(n, FS(r), LS(_I, (e, t) => vI(e, {
			_tag: hI,
			supervisor: t
		}))));
	}
}), wI = /*#__PURE__*/ ZF("effect_fiber_started", { incremental: !0 }), TI = /*#__PURE__*/ ZF("effect_fiber_active"), EI = /*#__PURE__*/ ZF("effect_fiber_successes", { incremental: !0 }), DI = /*#__PURE__*/ ZF("effect_fiber_failures", { incremental: !0 }), OI = /*#__PURE__*/ eI(/*#__PURE__*/ $F("effect_fiber_lifetimes", /*#__PURE__*/ kP({
	start: .5,
	factor: 2,
	count: 35
})), "time_unit", "milliseconds"), kI = "Continue", AI = "Done", jI = "Yield", MI = {
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_A: (e) => e
}, NI = (e) => {
	throw Error(`BUG: FiberRuntime - ${r_(e)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, PI = /*#__PURE__*/ Symbol.for("effect/internal/fiberRuntime/YieldedOp"), FI = /*#__PURE__*/ B("effect/internal/fiberRuntime/yieldedOpChannel", () => ({ currentOp: null })), II = {
	[m_]: (e, t, n) => Bg(() => t.effect_instruction_i1(n)),
	OnStep: (e, t, n) => ZO(ZO(n)),
	[h_]: (e, t, n) => Bg(() => t.effect_instruction_i2(n)),
	[C_]: (e, t, n) => (e.patchRuntimeFlags(e.currentRuntimeFlags, t.patch), Yw(e.currentRuntimeFlags) && e.isInterrupted() ? KO(e.getInterruptedCause()) : ZO(n)),
	[y_]: (e, t, n) => (Bg(() => t.effect_instruction_i2(n)), Bg(() => t.effect_instruction_i0()) ? (e.pushStack(t), Bg(() => t.effect_instruction_i1())) : SD),
	[b_]: (e, t, n) => {
		for (;;) {
			let r = Bg(() => t.effect_instruction_i0.next(n));
			if (r.done) return ZO(r.value);
			let i = Lg(r.value);
			if (!RO(i)) return e.pushStack(t), i;
			if (i._tag === "Failure") return i;
			n = i.value;
		}
	}
}, LI = {
	[QN]: (e, t, n, r) => (e.processNewInterruptSignal(r.cause), Yw(t) ? KO(r.cause) : n),
	[eP]: (e, t, n, r) => {
		throw Error("It is illegal to have multiple concurrent run loops in a single fiber");
	},
	[$N]: (e, t, n, r) => (r.onFiber(e, HM(t)), n),
	[tP]: (e, t, n, r) => X(AD(), () => n)
}, RI = (e) => dD(uT(e), (e) => eL(OT(e), ([e, t]) => {
	let n = /* @__PURE__ */ new Map(), r = [];
	for (let e of t) {
		r.push(fb(e));
		for (let t of e) n.set(t.request, t);
	}
	let i = r.flat();
	return ZD(DL(e.runAll(r), i, () => i.forEach((e) => {
		e.listeners.interrupted = !0;
	})), XN, n);
}, !1, !1)), zI = /*#__PURE__*/ T_(), BI = class extends kj {
	[dP] = fP;
	[mP] = MI;
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
		if (super(), this.currentRuntimeFlags = n, this._fiberId = e, this._fiberRefs = t, eT(n)) {
			let e = this.getFiberRef(gO);
			wI.unsafeUpdate(1, e), TI.unsafeUpdate(1, e);
		}
		this.refreshRefCache();
	}
	commit() {
		return hP(this);
	}
	id() {
		return this._fiberId;
	}
	resume(e) {
		this.tell(iP(e));
	}
	get status() {
		return this.ask((e, t) => t);
	}
	get runtimeFlags() {
		return this.ask((e, t) => WM(t) ? e.currentRuntimeFlags : t.runtimeFlags);
	}
	scope() {
		return lP(this);
	}
	get children() {
		return this.ask((e) => Array.from(e.getChildren()));
	}
	getChildren() {
		return this._children === null && (this._children = /* @__PURE__ */ new Set()), this._children;
	}
	getInterruptedCause() {
		return this.getFiberRef(vO);
	}
	fiberRefs() {
		return this.ask((e) => e.getFiberRefs());
	}
	ask(e) {
		return Q(() => {
			let t = tk(this._fiberId);
			return this.tell(rP((n, r) => {
				ck(t, $(() => e(n, r)));
			})), ik(t);
		});
	}
	tell(e) {
		this._queue.push(e), this._running || (this._running = !0, this.drainQueueLaterOnExecutor());
	}
	get await() {
		return GE((e) => {
			let t = (t) => e(Z(t));
			if (this._exitValue !== null) t(this._exitValue);
			else return this.tell(rP((e, n) => {
				e._exitValue === null ? e.addObserver(t) : t(this._exitValue);
			})), $(() => this.tell(rP((e, n) => {
				e.removeObserver(t);
			})));
		}, this.id());
	}
	get inheritAll() {
		return RE((e, t) => {
			let n = e.id(), r = e.getFiberRefs(), i = t.runtimeFlags, a = rj(r, n, this.getFiberRefs());
			return e.setFiberRefs(a), CD(z(nT(i, e.getFiberRef(wL)), sT(1), sT(16)));
		});
	}
	get poll() {
		return $(() => _v(this._exitValue));
	}
	unsafePoll() {
		return this._exitValue;
	}
	interruptAsFork(e) {
		return $(() => this.tell(nP(VT(e))));
	}
	unsafeInterruptAsFork(e) {
		this.tell(nP(VT(e)));
	}
	addObserver(e) {
		this._exitValue === null ? this._observers.push(e) : e(this._exitValue);
	}
	removeObserver(e) {
		this._observers = this._observers.filter((t) => t !== e);
	}
	getFiberRefs() {
		return this.setFiberRef(wL, this.currentRuntimeFlags), this._fiberRefs;
	}
	unsafeDeleteFiberRef(e) {
		this._fiberRefs = oj(this._fiberRefs, e);
	}
	getFiberRef(e) {
		return this._fiberRefs.locals.has(e) ? this._fiberRefs.locals.get(e)[0][1] : e.initial;
	}
	setFiberRef(e, t) {
		this._fiberRefs = lj(this._fiberRefs, {
			fiberId: this._fiberId,
			fiberRef: e,
			value: t
		}), this.refreshRefCache();
	}
	refreshRefCache() {
		this.currentDefaultServices = this.getFiberRef(ZA), this.currentTracer = this.currentDefaultServices.unsafeMap.get(WA.key), this.currentSupervisor = this.getFiberRef(TL), this.currentScheduler = this.getFiberRef(YN), this.currentContext = this.getFiberRef(aO), this.currentSpan = this.currentContext.unsafeMap.get(GA.key);
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
			let t = kI, n = globalThis[gP];
			globalThis[gP] = this;
			try {
				for (; t === kI;) t = this._queue.length === 0 ? AI : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
			} finally {
				this._running = !1, globalThis[gP] = n;
			}
			this._queue.length > 0 && !this._running ? (this._running = !0, t === jI ? (this.drainQueueLaterOnExecutor(), e = !1) : e = !0) : e = !1;
		}
	}
	drainQueueLaterOnExecutor() {
		this.currentScheduler.scheduleTask(this.run, this.getFiberRef(oO), this);
	}
	drainQueueWhileRunning(e, t) {
		let n = t;
		for (; this._queue.length > 0;) {
			let t = this._queue.splice(0, 1)[0];
			n = LI[t._tag](this, e, n, t);
		}
		return n;
	}
	isInterrupted() {
		return !KT(this.getFiberRef(vO));
	}
	addInterruptedCause(e) {
		let t = this.getFiberRef(vO);
		this.setFiberRef(vO, UT(t, e));
	}
	processNewInterruptSignal(e) {
		this.addInterruptedCause(e), this.sendInterruptSignalToAllChildren();
	}
	sendInterruptSignalToAllChildren() {
		if (this._children === null || this._children.size === 0) return !1;
		let e = !1;
		for (let t of this._children) t.tell(nP(VT(this.id()))), e = !0;
		return e;
	}
	interruptAllChildren() {
		if (this.sendInterruptSignalToAllChildren()) {
			let e = this._children.values();
			this._children = null;
			let t = !1;
			return TD({
				while: () => !t,
				body: () => {
					let n = e.next();
					return n.done ? $(() => {
						t = !0;
					}) : VE(n.value.await);
				},
				step: () => {}
			});
		}
		return null;
	}
	reportExitValue(e) {
		if (eT(this.currentRuntimeFlags)) {
			let t = this.getFiberRef(gO), n = this.id().startTimeMillis, r = Date.now();
			switch (OI.unsafeUpdate(r - n, t), TI.unsafeUpdate(-1, t), e._tag) {
				case g_:
					EI.unsafeUpdate(1, t);
					break;
				case f_: DI.unsafeUpdate(1, t);
			}
		}
		if (e._tag === "Failure") {
			let t = this.getFiberRef(mO);
			!JT(e.cause) && t._tag === "Some" && this.log("Fiber terminated with an unhandled error", e.cause, t);
		}
	}
	setExitValue(e) {
		this._exitValue = e, this.reportExitValue(e);
		for (let t = this._observers.length - 1; t >= 0; t--) this._observers[t](e);
		this._observers = [];
	}
	getLoggers() {
		return this.getFiberRef(GI);
	}
	log(e, t, n) {
		let r = pv(n) ? n.value : this.getFiberRef(lO);
		if (Cj(this.getFiberRef(VI), r)) return;
		let i = this.getFiberRef(uO), a = this.getFiberRef(cO), o = this.getLoggers(), s = this.getFiberRefs();
		if (MS(o) > 0) {
			let n = Ky(this.getFiberRef(ZA), jk), c = new Date(n.unsafeCurrentTimeMillis());
			c_(s, () => {
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
			case tP: return jI;
			case QN: return this.processNewInterruptSignal(e.cause), this._asyncInterruptor !== null && (this._asyncInterruptor(KO(e.cause)), this._asyncInterruptor = null), kI;
			case eP: return this._asyncInterruptor = null, this._asyncBlockingOn = null, this.evaluateEffect(e.effect), kI;
			case $N: return e.onFiber(this, this._exitValue === null ? UM(this.currentRuntimeFlags, this._asyncBlockingOn) : VM), kI;
			default: return NI(e);
		}
	}
	evaluateEffect(e) {
		this.currentSupervisor.onResume(this);
		try {
			let t = Yw(this.currentRuntimeFlags) && this.isInterrupted() ? KO(this.getInterruptedCause()) : e;
			for (; t !== null;) {
				let e = t, n = this.runLoop(e);
				if (n === PI) {
					let e = FI.currentOp;
					FI.currentOp = null, e._op === "Yield" ? Kw(this.currentRuntimeFlags) ? (this.tell(aP()), this.tell(iP(QO)), t = null) : t = QO : e._op === "Async" && (t = null);
				} else {
					this.currentRuntimeFlags = z(this.currentRuntimeFlags, Jw(16));
					let e = this.interruptAllChildren();
					e === null ? (this._queue.length === 0 ? this.setExitValue(n) : this.tell(iP(n)), t = null) : t = X(e, () => n);
				}
			}
		} finally {
			this.currentSupervisor.onSuspend(this);
		}
	}
	start(e) {
		if (this._running) this.tell(iP(e));
		else {
			this._running = !0;
			let t = globalThis[gP];
			globalThis[gP] = this;
			try {
				this.evaluateEffect(e);
			} finally {
				this._running = !1, globalThis[gP] = t, this._queue.length > 0 && this.drainQueueLaterOnExecutor();
			}
		}
	}
	startFork(e) {
		this.tell(iP(e));
	}
	patchRuntimeFlags(e, t) {
		let n = rT(e, t);
		return globalThis[gP] = this, this.currentRuntimeFlags = n, n;
	}
	initiateAsync(e, t) {
		let n = !1, r = (e) => {
			n || (n = !0, this.tell(iP(e)));
		};
		Yw(e) && (this._asyncInterruptor = r);
		try {
			t(r);
		} catch (e) {
			r(tD(BT(e)));
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
		return $(() => qy(this.currentContext, e));
	}
	Left(e) {
		return $E(e.left);
	}
	None(e) {
		return $E(new FO());
	}
	Right(e) {
		return ZO(e.right);
	}
	Some(e) {
		return ZO(e.value);
	}
	Micro(e) {
		return UE((t) => {
			let n = t, r = UN(PN(e, this.currentContext));
			return r.addObserver((e) => {
				if (e._tag === "Success") return n(ZO(e.value));
				switch (e.cause._tag) {
					case "Interrupt": return n(KO(VT(rC)));
					case "Fail": return n($E(e.cause.error));
					case "Die": return n(YE(e.cause.defect));
				}
			}), UE((e) => {
				n = (t) => {
					e(SD);
				}, r.unsafeInterrupt();
			});
		});
	}
	[__](e) {
		let t = Bg(() => e.effect_instruction_i0()), n = this.getNextSuccessCont();
		return n === void 0 ? (FI.currentOp = ZO(t), PI) : (n._op in II || NI(n), II[n._op](this, n, t));
	}
	[g_](e) {
		let t = e, n = this.getNextSuccessCont();
		return n === void 0 ? (FI.currentOp = t, PI) : (n._op in II || NI(n), II[n._op](this, n, t.effect_instruction_i0));
	}
	[f_](e) {
		let t = e.effect_instruction_i0, n = this.getNextFailCont();
		if (n !== void 0) switch (n._op) {
			case p_:
			case h_: return Yw(this.currentRuntimeFlags) && this.isInterrupted() ? KO(tE(t)) : Bg(() => n.effect_instruction_i1(t));
			case "OnStep": return Yw(this.currentRuntimeFlags) && this.isInterrupted() ? KO(tE(t)) : ZO(KO(t));
			case C_: return this.patchRuntimeFlags(this.currentRuntimeFlags, n.patch), Yw(this.currentRuntimeFlags) && this.isInterrupted() ? KO(UT(t, this.getInterruptedCause())) : KO(t);
			default: NI(n);
		}
		else return FI.currentOp = KO(t), PI;
	}
	[x_](e) {
		return Bg(() => e.effect_instruction_i0(this, HM(this.currentRuntimeFlags)));
	}
	Blocked(e) {
		let t = this.getFiberRefs(), n = this.currentRuntimeFlags;
		if (this._steps.length > 0) {
			let r = [], i = this._steps[this._steps.length - 1], a = this.popStack();
			for (; a && a._op !== "OnStep";) r.push(a), a = this.popStack();
			this.setFiberRefs(i.refs), this.currentRuntimeFlags = i.flags;
			let o = TM(i.refs, t), s = nT(i.flags, n);
			return ZO(AE(e.effect_instruction_i0, RE((t) => {
				for (; r.length > 0;) t.pushStack(r.pop());
				return t.setFiberRefs(EM(t.id(), t.getFiberRefs())(o)), t.currentRuntimeFlags = rT(s)(t.currentRuntimeFlags), e.effect_instruction_i1;
			})));
		}
		return xD((t) => X(nL(jE(e.effect_instruction_i0)), () => t(e.effect_instruction_i1)));
	}
	RunBlocked(e) {
		return RI(e.effect_instruction_i0);
	}
	[v_](e) {
		let t = e.effect_instruction_i0, n = this.currentRuntimeFlags, r = rT(n, t);
		if (Yw(r) && this.isInterrupted()) return KO(this.getInterruptedCause());
		if (this.patchRuntimeFlags(this.currentRuntimeFlags, t), e.effect_instruction_i1) {
			let t = nT(r, n);
			return this.pushStack(new NE(t, e)), Bg(() => e.effect_instruction_i1(n));
		}
		return QO;
	}
	[m_](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	OnStep(e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[p_](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[h_](e) {
		return this.pushStack(e), e.effect_instruction_i0;
	}
	[u_](e) {
		return this._asyncBlockingOn = e.effect_instruction_i1, this.initiateAsync(this.currentRuntimeFlags, e.effect_instruction_i0), FI.currentOp = e, PI;
	}
	[S_](e) {
		return this._isYielding = !1, FI.currentOp = e, PI;
	}
	[y_](e) {
		let t = e.effect_instruction_i0, n = e.effect_instruction_i1;
		return t() ? (this.pushStack(e), n()) : QO;
	}
	[b_](e) {
		return II[b_](this, e, void 0);
	}
	[d_](e) {
		return Bg(() => e.commit());
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
					t = X(AD({ priority: e }), () => n);
				}
			}
			try {
				if (t = this.currentTracer.context(() => {
					if (zI !== t[ME]._V) {
						let e = this.getFiberRef(hO);
						if (e._tag === "Some") {
							let n = t[ME]._V;
							this.log(`Executing an Effect versioned ${n} with a Runtime of version ${T_()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, RT, e);
						}
					}
					return this[t._op](t);
				}, this), t === PI) {
					let e = FI.currentOp;
					return e._op === "Yield" || e._op === "Async" ? PI : (FI.currentOp = null, e._op === "Success" || e._op === "Failure" ? e : KO(BT(e)));
				}
			} catch (e) {
				t = t !== PI && !V(t, "_op") || !(t._op in this) ? XE(`Not a valid effect: ${r_(t)}`) : NO(e) ? KO(UT(BT(e), VT(rC))) : YE(e);
			}
		}
	}
	run = () => {
		this.drainQueueOnCurrentThread();
	};
}, VI = /*#__PURE__*/ B("effect/FiberRef/currentMinimumLogLevel", () => $D(wj("Info"))), HI = (e) => yP((t) => {
	Ky(fj(t.context, ZA), PA).unsafe.log(e.log(t));
}), UI = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Logger/defaultLogger"), () => HI(xP)), WI = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/Logger/tracerLogger"), () => yP(({ annotations: e, cause: t, context: n, fiberId: r, logLevel: i, message: a }) => {
	let o = pM(Jy(cj(n, aO), GA));
	if (o._tag === "None" || o.value._tag === "ExternalSpan") return;
	let s = qy(cj(n, ZA), jk), c = {};
	for (let [t, n] of e) c[t] = n;
	c["effect.fiberId"] = aC(r), c["effect.logLevel"] = i.label, t !== null && t._tag !== "Empty" && (c["effect.cause"] = mE(t, { renderErrorCause: !0 })), o.value.event(r_(Array.isArray(a) && a.length === 1 ? a[0] : a), s.unsafeCurrentTimeNanos(), c);
})), GI = /*#__PURE__*/ B(/*#__PURE__*/ Symbol.for("effect/FiberRef/currentLoggers"), () => eO(AS(UI, WI))), KI = /*#__PURE__*/ R((e) => LE(e[0]), (e, t) => bD(vD(e, (e) => qI((n) => t(e, n))))), qI = (e) => RE((t) => {
	let n = t.getFiberRefs(), r = qw(t.currentRuntimeFlags, 1);
	return X(gL, (t) => SO(t, (t) => RE((i) => {
		let a = i.getFiberRefs(), o = i.currentRuntimeFlags, s = TM(a, n), c = nT(o, r), l = TM(n, a);
		return i.setFiberRefs(EM(s, i.id(), n)), EL(kD(e(t), c), $(() => {
			i.setFiberRefs(EM(l, i.id(), i.getFiberRefs()));
		}));
	})));
}), JI = (e) => {
	if (Array.isArray(e) || Sg(e)) return [e, J()];
	let t = Object.keys(e), n = t.length;
	return [t.map((t) => e[t]), Y((e) => {
		let r = {};
		for (let i = 0; i < n; i++) r[t[i]] = e[i];
		return r;
	})];
}, YI = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(ZE(t));
	return X(QI(r, rg, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => {
		let r = J(), i = e.length, a = Array(i), o = Array(i), s = !1;
		for (let t = 0; t < i; t++) {
			let n = e[t];
			n._tag === "Left" ? (a[t] = Y(n.left), s = !0) : (o[t] = n.right, a[t] = r);
		}
		return s ? t._tag === "Some" ? $E(t.value(a)) : $E(a) : n?.discard ? SD : t._tag === "Some" ? Z(t.value(o)) : Z(o);
	});
}, XI = (e, t, n) => {
	let r = [];
	for (let t of e) r.push(ZE(t));
	return n?.discard ? QI(r, rg, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		discard: !0,
		concurrentFinalizers: n?.concurrentFinalizers
	}) : pD(QI(r, rg, {
		concurrency: n?.concurrency,
		batching: n?.batching,
		concurrentFinalizers: n?.concurrentFinalizers
	}), (e) => t._tag === "Some" ? t.value(e) : e);
}, ZI = (e, t) => {
	let [n, r] = JI(e);
	return t?.mode === "validate" ? YI(n, r, t) : t?.mode === "either" ? XI(n, r, t) : t?.discard !== !0 && r._tag === "Some" ? pD(QI(n, rg, t), r.value) : QI(n, rg, t);
}, QI = /*#__PURE__*/ R((e) => Sg(e[0]), (e, t, n) => RE((r) => {
	let i = n?.batching === !0 || n?.batching === "inherit" && r.getFiberRef(pO);
	return n?.discard ? ZN(n.concurrency, () => lL(SM, n?.concurrentFinalizers)((n) => i ? eL(e, (e, r) => n(t(e, r)), !0, !1, 1) : dD(e, (e, r) => n(t(e, r)))), () => lL(CM, n?.concurrentFinalizers)((n) => eL(e, (e, r) => n(t(e, r)), i, !1)), (r) => lL(wM(r), n?.concurrentFinalizers)((n) => eL(e, (e, r) => n(t(e, r)), i, !1, r))) : ZN(n?.concurrency, () => lL(SM, n?.concurrentFinalizers)((n) => i ? tL(e, 1, (e, r) => n(t(e, r)), !0) : uD(e, (e, r) => n(t(e, r)))), () => lL(CM, n?.concurrentFinalizers)((n) => $I(e, (e, r) => n(t(e, r)), i)), (r) => lL(wM(r), n?.concurrentFinalizers)((n) => tL(e, r, (e, r) => n(t(e, r)), i)));
})), $I = (e, t, n) => Q(() => {
	let r = Tv(e), i = Array(r.length);
	return ND(eL(r, (e, n) => X(t(e, n), (e) => $(() => i[n] = e)), n, !1), Z(i));
}), eL = (e, t, n, r, i) => xD((a) => yD((o) => RE((s) => {
	let c = Array.from(e).reverse(), l = c.length;
	if (l === 0) return SD;
	let u = 0, d = !1, f = i ? Math.min(c.length, i) : c.length, p = /* @__PURE__ */ new Set(), m = [], h = () => p.forEach((e) => {
		e.currentScheduler.scheduleTask(() => {
			e.unsafeInterruptAsFork(s.id());
		}, 0, e);
	}), g = [], _ = [], v = [], y = () => {
		let e = m.filter(({ exit: e }) => e._tag === "Failure").sort((e, t) => e.index < t.index ? -1 : e.index === t.index ? 0 : 1).map(({ exit: e }) => e);
		return e.length === 0 && e.push(QO), e;
	}, b = (e, t = !1) => {
		let n = bD(o(e)), r = iL(n, s, s.currentRuntimeFlags, uP);
		return s.currentScheduler.scheduleTask(() => {
			t && r.unsafeInterruptAsFork(s.id()), r.resume(n);
		}, 0, r), r;
	}, x = () => {
		r || (l -= c.length, c = []), d = !0, h();
	}, S = n ? aD : QE, C = b(GE((e) => {
		let r = (e, t) => {
			e._op === "Blocked" ? v.push(e) : (m.push({
				index: t,
				exit: e
			}), e._op === "Failure" && !d && x());
		}, o = () => {
			if (c.length > 0) {
				let f = c.pop(), h = u++, x = () => {
					let e = c.pop();
					return h = u++, X(AD(), () => X(S(a(t(e, h))), C));
				}, C = (e) => c.length > 0 && (r(e, h), c.length > 0) ? x() : Z(e), w = X(S(a(t(f, h))), C), T = b(w);
				g.push(T), p.add(T), d && T.currentScheduler.scheduleTask(() => {
					T.unsafeInterruptAsFork(s.id());
				}, 0, T), T.addObserver((t) => {
					let a;
					if (a = t._op === "Failure" ? t : t.effect_instruction_i0, _.push(T), p.delete(T), r(a, h), m.length === l) e(Z(hv(UO(y(), { parallel: !0 }), () => QO)));
					else if (v.length + m.length === l) {
						let t = y();
						e(Z(AE(v.map((e) => e.effect_instruction_i0).reduce(cT), eL([hv(UO(t, { parallel: !0 }), () => QO), ...v.map((e) => e.effect_instruction_i1)], (e) => e, n, !0, i))));
					} else o();
				});
			}
		};
		for (let e = 0; e < f; e++) o();
	}));
	return VE(gD(oD(a(hP(C))), YO({
		onFailure: (e) => {
			x();
			let t = v.length + 1, n = Math.min(typeof i == "number" ? i : v.length, v.length), r = Array.from(v);
			return GE((i) => {
				let a = [], o = 0, s = 0, c = (n, s) => (c) => {
					a[n] = c, o++, o === t && i(ZO(KO(e))), r.length > 0 && s && l();
				}, l = () => {
					b(r.pop(), !0).addObserver(c(s, !0)), s++;
				};
				C.addObserver(c(s, !1)), s++;
				for (let e = 0; e < n; e++) l();
			});
		},
		onSuccess: () => uD(_, (e) => e.inheritAll)
	})));
}))), tL = (e, t, n, r) => Q(() => {
	let i = Tv(e), a = Array(i.length);
	return ND(eL(i, (e, t) => pD(n(e, t), (e) => a[t] = e), r, !1, t), Z(a));
}), nL = (e) => oL(e, uP), rL = (e, t, n, r = null) => {
	let i = aL(e, t, n, r);
	return i.resume(e), i;
}, iL = (e, t, n, r = null) => aL(e, t, n, r), aL = (e, t, n, r = null) => {
	let i = oC(), a = ij(t.getFiberRefs(), i), o = new BI(i, a, n), s = cj(a, aO), c = o.currentSupervisor;
	return c.onStart(s, e, Y(t), o), o.addObserver((e) => c.onEnd(e, o)), (r === null ? z(t.getFiberRef(_O), hv(() => t.scope())) : r).add(n, o), o;
}, oL = (e, t) => RE((n, r) => Z(rL(e, n, r.runtimeFlags, t))), sL = (e) => fk((t) => mv(Jy(t, hL), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Parallel": return e;
			case "Sequential":
			case "ParallelN": return X(wO(t, CM), (t) => xL(e, t));
		}
	}
})), cL = (e) => (t) => fk((n) => mv(Jy(n, hL), {
	onNone: () => t,
	onSome: (n) => n.strategy._tag === "ParallelN" && n.strategy.parallelism === e ? t : X(wO(n, wM(e)), (e) => xL(t, e))
})), lL = (e, t) => (n) => fk((r) => mv(Jy(r, hL), {
	onNone: () => n(rg),
	onSome: (r) => {
		if (t === !0) {
			let t = e._tag === "Parallel" ? sL : e._tag === "Sequential" ? pL : cL(e.parallelism);
			switch (r.strategy._tag) {
				case "Parallel": return t(n(sL));
				case "Sequential": return t(n(pL));
				case "ParallelN": return t(n(cL(r.strategy.parallelism)));
			}
		} else return n(rg);
	}
})), uL = (e) => X(hL, e), dL = (e) => X(bL(), (t) => gD(e(t), (e) => t.close(e))), fL = (e) => X(bL(), (t) => SL(e, t)), pL = (e) => fk((t) => mv(Jy(t, hL), {
	onNone: () => e,
	onSome: (t) => {
		switch (t.strategy._tag) {
			case "Sequential": return e;
			case "Parallel":
			case "ParallelN": return X(wO(t, SM), (t) => xL(e, t));
		}
	}
})), mL = /*#__PURE__*/ R((e) => LE(e[1]), (e, t, n, r) => pD(ZI([e, t], {
	concurrency: r?.concurrent ? 2 : 1,
	batching: r?.batching,
	concurrentFinalizers: r?.concurrentFinalizers
}), ([e, t]) => n(e, t))), hL = /*#__PURE__*/ By("effect/Scope"), gL = hL, _L = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.set({}, t);
}, vL = {
	[yO]: yO,
	[bO]: bO,
	pipe() {
		return q(this, arguments);
	},
	fork(e) {
		return $(() => {
			let t = yL(e);
			if (this.state._tag === "Closed") return t.state = this.state, t;
			let n = {};
			return this.state.finalizers.set(n, (e) => t.close(e)), _L(t, (e) => $(() => {
				this.state._tag === "Open" && this.state.finalizers.delete(n);
			})), t;
		});
	},
	close(e) {
		return Q(() => {
			if (this.state._tag === "Closed") return SD;
			let t = Array.from(this.state.finalizers.values()).reverse();
			return this.state = {
				_tag: "Closed",
				exit: e
			}, t.length === 0 ? SD : bM(this.strategy) ? z(uD(t, (t) => QE(t(e))), X((e) => z(UO(e), yv(HO), hv(() => QO)))) : xM(this.strategy) ? z($I(t, (t) => QE(t(e)), !1), X((e) => z(UO(e, { parallel: !0 }), yv(HO), hv(() => QO)))) : z(tL(t, this.strategy.parallelism, (t) => QE(t(e)), !1), X((e) => z(UO(e, { parallel: !0 }), yv(HO), hv(() => QO))));
		});
	},
	addFinalizer(e) {
		return Q(() => this.state._tag === "Closed" ? e(this.state.exit) : (this.state.finalizers.set({}, e), SD));
	}
}, yL = (e = _M) => {
	let t = Object.create(vL);
	return t.strategy = e, t.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map()
	}, t;
}, bL = (e = _M) => $(() => yL(e)), xL = /*#__PURE__*/ R(2, (e, t) => hk(e, Yy(Wy(hL, t)))), SL = /*#__PURE__*/ R(2, (e, t) => z(e, xL(t), gD((e) => t.close(e)))), CL = (e) => rO(e, {
	differ: CI,
	fork: _I
}), wL = /*#__PURE__*/ iO($w), TL = /*#__PURE__*/ CL(dI), EL = /*#__PURE__*/ R(2, (e, t) => xD((n) => cD(n(e), {
	onFailure: (e) => cD(t, {
		onFailure: (t) => tD(UT(e, t)),
		onSuccess: () => tD(e)
	}),
	onSuccess: (e) => BE(t, e)
}))), DL = (e, t, n) => iD((r) => EL(X(nL(fD(e)), (e) => GE((r) => {
	let i = t.map((e) => e.listeners.count), a = () => {
		i.every((e) => e === 0) && t.every((e) => !!(e.result.state.current._tag === "Pending" || e.result.state.current._tag === "Done" && RO(e.result.state.current.effect) && e.result.state.current.effect._tag === "Failure" && qT(e.result.state.current.effect.cause))) && (o.forEach((e) => e()), n?.(), r(FD(e)));
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
})), Q(() => dD(t.flatMap((e) => e.state.completed ? [] : [e]), (e) => rI(e.request, qO(r)))))), OL = QT, kL = TO, AL = xO, jL = CO, ML = xL, NL = wO, PL = bL, FL = class {
	permits;
	waiters = /*#__PURE__*/ new Set();
	taken = 0;
	constructor(e) {
		this.permits = e;
	}
	get free() {
		return this.permits - this.taken;
	}
	take = (e) => WE((t) => {
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
		return this.taken = t(this.taken), this.waiters.size > 0 && e.getFiberRef(YN).scheduleTask(() => {
			let e = this.waiters.values(), t = e.next();
			for (; t.done === !1 && this.free > 0;) t.value(), t = e.next();
		}, e.getFiberRef(oO), e), Z(this.free);
	}
	updateTaken(e) {
		return RE((t) => this.updateTakenUnsafe(t, e));
	}
	resize = (e) => VE(RE((t) => (this.permits = e, this.free < 0 ? SD : this.updateTakenUnsafe(t, (e) => e))));
	release = (e) => this.updateTaken((t) => t - e);
	releaseAll = /*#__PURE__*/ this.updateTaken((e) => 0);
	withPermits = (e) => (t) => xD((n) => X(n(this.take(e)), (e) => EL(n(t), this.release(e))));
	withPermitsIfAvailable = (e) => (t) => xD((n) => Q(() => this.free < e ? cM : (this.taken += e, EL(n($j(t)), this.release(e)))));
}, IL = (e) => new FL(e), LL = /*#__PURE__*/ Symbol.for("effect/Ref/SynchronizedRef"), RL = {
/* c8 ignore next */
_A: (e) => e }, zL = class extends kj {
	ref;
	withLock;
	[LL] = RL;
	[jj] = Mj;
	[Aj] = Aj;
	constructor(e, t) {
		super(), this.ref = e, this.withLock = t, this.get = Ij(this.ref);
	}
	get;
	commit() {
		return this.get;
	}
	modify(e) {
		return this.modifyEffect((t) => Z(e(t)));
	}
	modifyEffect(e) {
		return this.withLock(z(X(Ij(this.ref), e), X(([e, t]) => BE(Lj(this.ref, t), e))));
	}
}, BL = (e) => $(() => VL(e)), VL = (e) => new zL(Pj(e), IL(1).withPermits(1)), HL = /*#__PURE__*/ Symbol.for("effect/ManagedRuntime"), UL = "Fresh", WL = "FromEffect", GL = "MergeAll", KL = (e) => function() {
	if (arguments.length === 1) {
		let t = arguments[0];
		return (n, ...r) => e(t, n, ...r);
	}
	return e.apply(this, arguments);
}, qL = /*#__PURE__*/ KL((e, t, n) => {
	let r = oC(), i = [[aO, [[r, e.context]]]];
	n?.scheduler && i.push([YN, [[r, n.scheduler]]]);
	let a = pj(e.fiberRefs, {
		entries: i,
		forkAs: r
	});
	n?.updateRefs && (a = n.updateRefs(a, r));
	let o = new BI(r, a, e.runtimeFlags), s = t;
	n?.scope && (s = X(NL(n.scope, _M), (e) => ND(xO(e, iD((e) => K(e, o.id()) ? SD : ID(o, e))), gD(t, (t) => jL(e, t)))));
	let c = o.currentSupervisor;
	return c !== dI && (c.onStart(e.context, s, J(), o), o.addObserver((e) => c.onEnd(e, o))), uP.add(e.runtimeFlags, o), n?.immediate === !1 ? o.resume(s) : o.start(s), o;
}), JL = /*#__PURE__*/ KL((e, t) => {
	let n = nR(e)(t);
	if (n._tag === "Failure") throw eR(n.effect_instruction_i0);
	return n.effect_instruction_i0;
}), YL = class extends Error {
	fiber;
	_tag = "AsyncFiberException";
	constructor(e) {
		super(`Fiber #${e.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`), this.fiber = e, this.name = this._tag, this.stack = this.message;
	}
}, XL = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new YL(e);
	return Error.stackTraceLimit = t, n;
}, ZL = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure"), QL = /*#__PURE__*/ Symbol.for("effect/Runtime/FiberFailure/Cause"), $L = class extends Error {
	[ZL];
	[QL];
	constructor(e) {
		let t = SE(e)[0];
		super(t?.message || "An error has occurred"), this[ZL] = ZL, this[QL] = e, this.name = t ? `(FiberFailure) ${t.name}` : "FiberFailure", t?.stack && (this.stack = t.stack);
	}
	toJSON() {
		return {
			_id: "FiberFailure",
			cause: this[QL].toJSON()
		};
	}
	toString() {
		return "(FiberFailure) " + mE(this[QL], { renderErrorCause: !0 });
	}
	[e_]() {
		return this.toString();
	}
}, eR = (e) => {
	let t = Error.stackTraceLimit;
	Error.stackTraceLimit = 0;
	let n = new $L(e);
	return Error.stackTraceLimit = t, n;
}, tR = (e) => {
	let t = e;
	switch (t._op) {
		case "Failure":
		case "Success": return t;
		case "Left": return GO(t.left);
		case "Right": return ZO(t.right);
		case "Some": return ZO(t.value);
		case "None": return GO(new FO());
	}
}, nR = /*#__PURE__*/ KL((e, t) => {
	let n = tR(t);
	if (n) return n;
	let r = new JN(), i = qL(e)(t, { scheduler: r });
	return r.flush(), i.unsafePoll() || WO(JE(XL(i), gk(i)));
}), rR = /*#__PURE__*/ KL((e, t, n) => iR(e, t, n).then((e) => {
	switch (e._tag) {
		case g_: return e.effect_instruction_i0;
		case f_: throw eR(e.effect_instruction_i0);
	}
})), iR = /*#__PURE__*/ KL((e, t, n) => new Promise((r) => {
	let i = tR(t);
	i && r(i);
	let a = qL(e)(t);
	a.addObserver((e) => {
		r(e);
	}), n?.signal !== void 0 && (n.signal.aborted ? a.unsafeInterruptAsFork(a.id()) : n.signal.addEventListener("abort", () => {
		a.unsafeInterruptAsFork(a.id());
	}, { once: !0 }));
})), aR = class {
	context;
	runtimeFlags;
	fiberRefs;
	constructor(e, t, n) {
		this.context = e, this.runtimeFlags = t, this.fiberRefs = n;
	}
	pipe() {
		return q(this, arguments);
	}
}, oR = /*#__PURE__*/ ((e) => new aR(e.context, e.runtimeFlags, e.fiberRefs))({
	context: /*#__PURE__*/ Uy(),
	runtimeFlags: /* @__PURE__ */ Qw(1, 32, 4),
	fiberRefs: /*#__PURE__*/ mj()
}), sR = /*#__PURE__*/ rR(oR), cR = /*#__PURE__*/ iR(oR), lR = /*#__PURE__*/ JL(oR), uR = /*#__PURE__*/ R(2, (e, t) => e.modifyEffect(t)), dR = /*#__PURE__*/ Symbol.for("effect/Layer"), fR = {
	/* c8 ignore next */
	_RIn: (e) => e,
	/* c8 ignore next */
	_E: (e) => e,
	/* c8 ignore next */
	_ROut: (e) => e
}, pR = {
	[dR]: fR,
	pipe() {
		return q(this, arguments);
	}
}, mR = /*#__PURE__*/ Symbol.for("effect/Layer/MemoMap"), hR = /*#__PURE__*/ Qy()("effect/Layer/CurrentMemoMap", { defaultValue: () => bR() }), gR = (e) => V(e, dR), _R = (e) => e._op_layer === UL, vR = class {
	ref;
	[mR];
	constructor(e) {
		this.ref = e, this[mR] = mR;
	}
	getOrElseMemoize(e, t) {
		return z(uR(this.ref, (n) => {
			let r = n.get(e);
			if (r !== void 0) {
				let [e, i] = r;
				return Z([z(e, X(([e, t]) => z(aM(e), BE(t))), gD(YO({
					onFailure: () => SD,
					onSuccess: () => SO(t, i)
				}))), n]);
			}
			return z(Fj(0), X((r) => z(nk(), X((i) => z(Fj(() => SD), pD((a) => {
				let o = xD((o) => z(bL(), X((s) => z(o(X(CR(e, s, !0), (e) => tM(e(this)))), QE, X((o) => {
					switch (o._tag) {
						case f_: return z(ok(i, o.effect_instruction_i0), ND(CO(s, o)), ND(tD(o.effect_instruction_i0)));
						case g_: return z(Lj(a, (e) => z(CO(s, e), wD(Rj(r, (e) => [e === 1, e - 1])), VE)), ND(zj(r, (e) => e + 1)), ND(SO(t, (t) => z($(() => n.delete(e)), ND(Ij(a)), X((e) => e(t))))), ND(sk(i, o.effect_instruction_i0)), BE(o.effect_instruction_i0[1]));
					}
				}))))), s = [z(ik(i), gD(XO({
					onFailure: () => SD,
					onSuccess: () => zj(r, (e) => e + 1)
				}))), (e) => z(Ij(a), X((t) => t(e)))];
				return [o, _R(e) ? n : n.set(e, s)];
			}))))));
		}), oD);
	}
}, yR = /*#__PURE__*/ Q(() => pD(BL(/* @__PURE__ */ new Map()), (e) => new vR(e))), bR = () => new vR(VL(/* @__PURE__ */ new Map())), xR = /*#__PURE__*/ R(2, (e, t) => X(yR, (n) => SR(e, n, t))), SR = /*#__PURE__*/ R(3, (e, t, n) => X(CR(e, n), (e) => sM(e(t), hR, t))), CR = (e, t, n = !1) => {
	let r = e;
	switch (r._op_layer) {
		case "Locally": return $(() => (e) => r.f(e.getOrElseMemoize(r.self, t)));
		case "ExtendScope": return $(() => (e) => uL((t) => e.getOrElseMemoize(r.layer, t)));
		case "Fold": return $(() => (e) => z(e.getOrElseMemoize(r.layer, t), cD({
			onFailure: (n) => e.getOrElseMemoize(r.failureK(n), t),
			onSuccess: (n) => e.getOrElseMemoize(r.successK(n), t)
		})));
		case "Fresh": return $(() => (e) => z(r.layer, xR(t)));
		case "FromEffect": return $(n ? () => (e) => r.effect : () => (n) => n.getOrElseMemoize(e, t));
		case "Provide": return $(() => (e) => z(e.getOrElseMemoize(r.first, t), X((n) => z(e.getOrElseMemoize(r.second, t), pk(n)))));
		case "Scoped": return $(n ? () => (e) => xL(r.effect, t) : () => (n) => n.getOrElseMemoize(e, t));
		case "Suspend": return $(() => (e) => e.getOrElseMemoize(r.evaluate(), t));
		case "ProvideMerge": return $(() => (e) => z(e.getOrElseMemoize(r.first, t), PD(e.getOrElseMemoize(r.second, t), r.zipK)));
		case "ZipWith": return DD(function* () {
			let e = yield* wO(t, vM), n = yield* wO(e, _M), i = yield* wO(e, _M);
			return (e) => z(e.getOrElseMemoize(r.first, n), mL(e.getOrElseMemoize(r.second, i), r.zipK, { concurrent: !0 }));
		});
		case "MergeAll": {
			let e = r.layers;
			return pD(wO(t, vM), (t) => (n) => {
				let r = Array(e.length);
				return pD(eL(e, OD(function* (e, i) {
					let a = yield* wO(t, _M), o = yield* n.getOrElseMemoize(e, a);
					r[i] = o;
				}), !1, !1), () => Xy(...r));
			});
		}
	}
};
function wR(e) {
	let t = Object.create(pR);
	return t._op_layer = WL, t.effect = e, t;
}
var TR = (...e) => {
	let t = Object.create(pR);
	return t._op_layer = GL, t.layers = e, t;
}, ER = /*#__PURE__*/ R(2, (e, t) => {
	let n = Hy(e);
	return wR(Z(Wy(n ? e : t, n ? t : e)));
}), DR = /*#__PURE__*/ R(2, (e, t) => dL((n) => X(xR(t, n), (t) => mk(e, t)))), OR = /*#__PURE__*/ R(2, (e, t) => {
	let n = TM(oR.fiberRefs, t.fiberRefs), r = nT(oR.runtimeFlags, t.runtimeFlags);
	return xD((i) => RE((a) => {
		let o = a.getFiberRef(aO), s = a.getFiberRefs(), c = EM(a.id(), s)(n), l = a.currentRuntimeFlags, u = rT(r)(l), d = TM(c, s), f = nT(u, l);
		return a.setFiberRefs(c), a.currentRuntimeFlags = u, EL(mk(i(e), Yy(o, t.context)), RE((e) => (e.setFiberRefs(EM(e.id(), e.getFiberRefs())(d)), e.currentRuntimeFlags = rT(f)(e.currentRuntimeFlags), SD)));
	}));
}), kR = /*#__PURE__*/ R(2, (e, t) => Array.isArray(t) ? DR(e, TR(...t)) : gR(t) ? DR(e, t) : Vy(t) ? mk(e, t) : HL in t ? X(t.runtimeEffect, (t) => OR(e, t)) : OR(e, t)), AR = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return { BaseEffectError: class extends DO {
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
}(), jR = (e) => {
	let t = { BaseEffectError: class extends AR {
		_tag = e;
	} };
	return t.BaseEffectError.prototype.name = e, t.BaseEffectError;
}, MR = $E, NR = DD, PR = oM, FR = Z, IR = Q, LR = $, RR = SD, zR = KE, BR = iM, VR = eM, HR = dM, UR = BE, WR = KI, GR = EL, KR = fL, qR = kR, JR = vD, YR = uM, XR = lD, ZR = sR, QR = cR, $R = lR, ez = class extends jR("AuthenticationFailure") {};
function tz(e) {
	return HR({
		try: e.command,
		catch: (e) => new ez({ cause: e })
	}).pipe(GR(PR(() => e.reconcile?.() ?? Promise.resolve())));
}
async function nz(e) {
	let t = await QR(e);
	if (vk(t)) return t.value;
	let n = OL(t.cause);
	throw pv(n) ? n.value.cause : kL(t.cause);
}
// src/app/services/queries/configuration.ts
function rz(e, t, n, r, i) {
	return t ? {
		queryKey: L.sshBrowse(t, n ?? "", i),
		queryFn: ({ signal: r }) => e.browseSshPath(t, n, i, r)
	} : {
		queryKey: L.browse(n ?? "", r, i),
		queryFn: ({ signal: t }) => e.browsePath(n, r, i, t)
	};
}
function iz(e, t, n, i) {
	let { api: a } = r();
	return D({
		...rz(a, null, e, t, n),
		enabled: i,
		staleTime: 2e3,
		retry: !1
	});
}
function az(e, t, n, i) {
	let { api: a } = r();
	return D({
		...rz(a, e ?? { ssh_host: "" }, t, "directory", n),
		enabled: i && !!e?.ssh_host,
		staleTime: 2e3,
		retry: !1
	});
}
function oz() {
	let { api: e } = r();
	return g((t, n, r, i) => rz(e, t, n, r, i).queryFn({ signal: new AbortController().signal }), [e]);
}
function sz() {
	let { api: e } = r(), t = O();
	return g(async (n, r, i) => {
		try {
			return await (n ? e.createSshFolder(n, r, i) : e.createFolder(r, i));
		} finally {
			t.invalidateQueries({ queryKey: [n ? "ssh-browse" : "fs-browse"] });
		}
	}, [e, t]);
}
function cz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: (t) => e.browseSshPath(t, null),
		onSuccess: (e, n) => {
			t.setQueryData(L.sshBrowse(n, "", !1), e);
		}
	});
}
function lz() {
	let { api: e } = r();
	return D({
		queryKey: L.sshConfigs,
		queryFn: ({ signal: t }) => e.listSshConfigs(t),
		staleTime: 3e4,
		retry: !1
	});
}
function uz(e = !0) {
	let { api: t } = r();
	return D({
		queryKey: L.sshAliases,
		queryFn: ({ signal: e }) => t.listSshAliases(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function dz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: (t) => e.createSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.sshConfigs });
		}
	});
}
function fz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ configId: t, payload: n }) => e.updateSshConfig(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.sshConfigs });
		}
	});
}
function pz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: (t) => e.deleteSshConfig(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.sshConfigs });
		}
	});
}
var mz = 3e5;
function hz() {
	let { api: e } = r();
	return D({
		queryKey: L.mcpLibrary,
		queryFn: ({ signal: t }) => e.getMcpLibrary(t),
		staleTime: mz,
		retry: !1
	});
}
function gz() {
	let { api: e } = r();
	return D({
		queryKey: L.mcpServers,
		queryFn: ({ signal: t }) => e.listMcpServers(t),
		staleTime: 3e4,
		retry: !1
	});
}
function _z() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: (t) => e.createMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.mcpServers }), t.invalidateQueries({ queryKey: L.mcpRuntime });
		}
	});
}
function vz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ serverName: t, payload: n }) => e.updateMcpServer(t, n),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.mcpServers }), t.invalidateQueries({ queryKey: L.mcpRuntime });
		}
	});
}
function yz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: (t) => e.deleteMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.mcpServers }), t.invalidateQueries({ queryKey: L.mcpRuntime });
		}
	});
}
function bz() {
	let { api: e } = r();
	return E({ mutationFn: (t) => e.testMcpServer(t) });
}
function xz() {
	let { api: e } = r();
	return D({
		queryKey: L.mcpRuntime,
		queryFn: ({ signal: t }) => e.listMcpRuntimeStatus(t),
		staleTime: 5e3,
		retry: !1
	});
}
function Sz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ serverName: t, action: n }) => n === "connect" ? e.connectMcpServer(t) : n === "disconnect" ? e.disconnectMcpServer(t) : e.reloadMcpServer(t),
		onSuccess: () => {
			t.invalidateQueries({ queryKey: L.mcpRuntime });
		}
	});
}
function Cz(e = !0) {
	let { api: t } = r();
	return D({
		queryKey: L.modelCatalog,
		queryFn: ({ signal: e }) => t.getModelCatalog(e),
		enabled: e,
		staleTime: 6e5,
		refetchInterval: 6e4,
		retry: !1
	});
}
async function wz(e) {
	await Promise.all([e.resetQueries({ queryKey: L.managedProviderModelsAll }), e.invalidateQueries({ queryKey: L.modelCatalog })]);
}
async function Tz(e) {
	await Promise.all([
		e.invalidateQueries({ queryKey: L.managedAuth }),
		e.invalidateQueries({ queryKey: L.managedHostStatus }),
		wz(e)
	]);
}
function Ez(e) {
	let { api: t } = r();
	return D({
		queryKey: L.sessionCommands(e),
		queryFn: ({ signal: n }) => t.listSessionCommands(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
function Dz(e) {
	let { api: t } = r();
	return D({
		queryKey: L.sessionSkills(e),
		queryFn: ({ signal: n }) => t.listSessionSkills(e, n),
		refetchOnMount: "always",
		retry: !1
	});
}
// src/app/services/queries/host.ts
function Oz() {
	let { api: e } = r();
	return D({
		queryKey: L.storeInfo,
		queryFn: ({ signal: t }) => e.getStore(t),
		staleTime: Infinity
	});
}
function kz(e) {
	let { api: t } = r();
	return D({
		queryKey: L.sandboxAvailability,
		queryFn: ({ signal: e }) => t.getSandboxAvailability(e),
		enabled: e,
		staleTime: 3e4,
		retry: !1
	});
}
function Az(e, t) {
	let { api: n } = r();
	return D({
		queryKey: [...L.sandboxActivity, t],
		queryFn: ({ signal: e }) => n.getSandboxActivity(t, e),
		enabled: e && t !== null,
		staleTime: 0,
		refetchInterval: 1e3,
		retry: !1
	});
}
function jz() {
	let { api: e } = r(), t = O();
	return E({
		retry: !1,
		mutationFn: (n) => nz(tz({
			command: () => e.managedLogout(n),
			reconcile: () => Tz(t)
		}))
	});
}
// src/app/services/queries/direct.ts
function Mz(e, t, n) {
	let r = e.find((e) => n(e) === n(t));
	return r && (r.generation > t.generation || r.version > t.version) ? e : r ? e.map((e) => n(e) === n(t) ? t : e) : [...e, t];
}
function Nz(e, t, n) {
	return t.map((t) => {
		let r = e?.find((e) => n(e) === n(t));
		return r && (r.generation > t.generation || r.version > t.version) ? r : t;
	});
}
function Pz(e, t, n = !0) {
	let { api: i } = r();
	return D({
		queryKey: L.sessionPermissions(e),
		queryFn: ({ signal: t }) => i.getPermissions(e, t),
		enabled: t,
		refetchInterval: t && n ? 1e3 : !1,
		staleTime: 0,
		retry: !1
	});
}
function Fz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, requestId: n, reply: r }) => e.replyPermission(t, n, r),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: L.sessionPermissions(n.sessionId) })
	});
}
function Iz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, reviewId: n, parentSessionId: r }) => r ? e.authorizeChildPermissionReviewRetry(r, t, n) : e.authorizePermissionReviewRetry(t, n),
		onSuccess: (e, n) => Promise.all([t.invalidateQueries({ queryKey: L.sessionPermissions(n.sessionId) }), ...n.parentSessionId ? [t.invalidateQueries({ queryKey: L.traditionalChildren(n.parentSessionId) })] : []])
	});
}
function Lz() {
	let { api: e } = r(), t = O();
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
function Rz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, grantId: n }) => e.deletePermissionGrant(t, n),
		onSuccess: (e, n) => t.invalidateQueries({ queryKey: L.sessionPermissions(n.sessionId) })
	});
}
function zz(e, t) {
	let { api: n } = r();
	return D({
		queryKey: L.sessionGoal(e),
		queryFn: ({ signal: t }) => n.getGoal(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function Bz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, payload: n }) => e.createGoal(t, n),
		onSuccess: (e, n) => t.setQueryData(L.sessionGoal(n.sessionId), e)
	});
}
function Vz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, goalId: n, payload: r }) => e.updateGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(L.sessionGoal(n.sessionId), e)
	});
}
function Hz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, goalId: n, expectedVersion: r }) => e.clearGoal(t, n, r),
		onSuccess: (e, n) => t.setQueryData(L.sessionGoal(n.sessionId), null)
	});
}
function Uz(e, t) {
	let { api: n } = r();
	return D({
		queryKey: L.traditionalChildren(e),
		queryFn: ({ signal: t }) => n.listTraditionalChildren(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1,
		structuralSharing: (e, t) => Nz(e, t, (e) => e.child_session_id)
	});
}
function Wz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, payload: n }) => e.startTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(L.traditionalChildren(n.sessionId), (t = []) => Mz(t, e, (e) => e.child_session_id));
		}
	});
}
function Gz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, childId: n }) => e.cancelTraditionalChild(t, n),
		onSuccess: (e, n) => {
			t.setQueryData(L.traditionalChildren(n.sessionId), (t = []) => Mz(t, e, (e) => e.child_session_id));
		}
	});
}
function Kz(e, t) {
	let { api: n } = r();
	return D({
		queryKey: L.sessionInbox(e),
		queryFn: ({ signal: t }) => n.listInbox(e, t),
		enabled: t,
		refetchInterval: t ? 1e3 : !1,
		retry: !1
	});
}
function qz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, delivery: n, prompt: r }) => e.createInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(L.sessionInbox(n), (t = []) => [...t.filter((t) => t.id !== e.id), e]);
		}
	});
}
function Jz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r, delivery: i }) => e.updateInboxItem(t, n, r, i),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(L.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
function Yz() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ sessionId: t, itemId: n, expectedVersion: r }) => e.cancelInboxItem(t, n, r),
		onSuccess: (e, { sessionId: n }) => {
			t.setQueryData(L.sessionInbox(n), (t = []) => t.map((t) => t.id === e.id ? e : t));
		}
	});
}
// src/app/features/direct-session/commandWorkflow.ts
var Xz = class extends jR("CommandFailure") {};
function Zz(e) {
	return NR(function* () {
		yield* LR(e.optimistic);
		let t = yield* HR({
			try: e.admit,
			catch: (e) => new Xz({
				operation: "submit",
				cause: e
			})
		}).pipe(YR(() => LR(e.rejected)));
		return t.kind === "accepted" ? (yield* LR(() => e.reconcile(!1)), t.value) : (yield* LR(() => {
			t.kind === "uncertain" ? e.reconcile(!0) : e.rejected();
		}), yield* MR(new Xz({
			operation: "submit",
			cause: t.error
		})));
	});
}
function Qz(e) {
	return NR(function* () {
		yield* LR(e.optimistic), yield* HR({
			try: e.cancel,
			catch: (e) => new Xz({
				operation: "stop",
				cause: e
			})
		}).pipe(YR(() => LR(e.rollback))), yield* LR(e.settled);
	});
}
function $z(e) {
	return HR({
		try: e.create,
		catch: (e) => new Xz({
			operation: "create",
			cause: e
		})
	}).pipe(JR((t) => LR(() => e.accept(t))));
}
function eB(e) {
	if (e.mode === "direct-running" || e.delivery) {
		let t = e.delivery ?? "steer";
		return HR({
			try: () => e.inbox(t),
			catch: (e) => new Xz({
				operation: t,
				cause: e
			})
		}).pipe(UR(t === "queue" ? "queued" : "steered"));
	}
	return HR({
		try: e.submit,
		catch: (e) => new Xz({
			operation: "submit",
			cause: e
		})
	}).pipe(UR("submitted"));
}
async function tB(e) {
	let t = await QR(e);
	if (vk(t)) return t.value;
	let n = OL(t.cause);
	throw pv(n) ? n.value.cause : kL(t.cause);
}
// src/app/features/direct-session/commandAdapters.ts
function nB(e, t) {
	let { api: n, stores: { runtimeStore: { captureRuntimeActivation: r, finishRunCancel: a, requestRunCancel: o, restoreRunCancel: s, runtimeStore: c } } } = i(e), l = r(t), u = L.sessionSnapshot(t), d, f, p, m = [];
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
			l() && c.getState().cancelArmed && a(), e.invalidateQueries({
				queryKey: u,
				exact: !0
			}), e.invalidateQueries({ queryKey: L.sessionsAll });
		}
	};
}
// src/app/lib/messageWindow.ts
function rB(e, t, n) {
	return Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end) && Number.isSafeInteger(e.total) && e.start >= 0 && e.start <= e.end && e.end <= e.total && e.end - e.start === t && n === t;
}
function iB(e, t) {
	return e?.length === t ? e : Array.from({ length: t }, () => null);
}
function aB(e, t) {
	return e === void 0 || e.length === t && e.every((e) => e === null || typeof e == "string");
}
function oB(e) {
	if (!e.startsWith("log:")) return e;
	let t = e.lastIndexOf(":"), n = e.lastIndexOf(":", t - 1);
	return n > 4 ? e.slice(0, n) : e;
}
function sB(e, t, n) {
	let r = /* @__PURE__ */ new Set();
	return (e ?? []).every(({ message_index: e }) => !Number.isSafeInteger(e) || r.has(e) || t[e - n]?.role !== "user" ? !1 : (r.add(e), !0));
}
function cB(e, t, n) {
	return (e ?? []).filter(({ message_index: e }) => e >= t && e < n);
}
function lB(e) {
	return rB(e.page, e.messages.length, e.created_at.length) && aB(e.tool_call_occurrences, e.messages.length) && sB(e.terminal_selection_attributions, e.messages, e.page.start);
}
function uB(e) {
	let t = e.message_page, n = e.message_created_at ?? [];
	return !!(t && rB(t, e.messages.length, n.length) && aB(e.tool_call_occurrences, e.messages.length) && sB(e.terminal_selection_attributions, e.messages, t.start));
}
function dB(e) {
	return e.message_page ?? {
		start: 0,
		end: e.messages.length,
		total: e.messages.length,
		has_older: !1
	};
}
function fB(e) {
	let t = e.message_created_at ?? [];
	return t.length === e.messages.length ? t : Array.from({ length: e.messages.length }, () => null);
}
function pB(e, t) {
	if (!lB(t)) return { kind: "snapshot-required" };
	let n = dB(e), r = fB(e);
	if (!rB(n, e.messages.length, r.length) || t.page.end !== t.page.total || t.page.total < n.total || t.page.start > n.end) return { kind: "snapshot-required" };
	for (let i = Math.max(n.start, t.page.start); i < Math.min(n.end, t.page.end); i += 1) if (JSON.stringify(e.messages[i - n.start]) !== JSON.stringify(t.messages[i - t.page.start]) || r[i - n.start] !== t.created_at[i - t.page.start] || (() => {
		let r = e.tool_call_occurrences?.[i - n.start], a = t.tool_call_occurrences?.[i - t.page.start];
		return r != null && a != null && oB(r) !== oB(a);
	})()) return { kind: "snapshot-required" };
	if (t.page.start <= n.start) return {
		kind: "accepted",
		snapshot: {
			...e,
			messages: t.messages,
			message_created_at: t.created_at,
			tool_call_occurrences: iB(t.tool_call_occurrences, t.messages.length),
			message_page: t.page,
			terminal_selection_attributions: t.terminal_selection_attributions ?? []
		}
	};
	let i = t.page.start - n.start;
	if (i > e.messages.length) return { kind: "snapshot-required" };
	let a = iB(e.tool_call_occurrences, e.messages.length).slice(0, i);
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
			tool_call_occurrences: [...a, ...iB(t.tool_call_occurrences, t.messages.length)],
			terminal_selection_attributions: [...cB(e.terminal_selection_attributions, n.start, t.page.start), ...t.terminal_selection_attributions ?? []],
			message_page: {
				...t.page,
				start: n.start,
				has_older: n.start > 0
			}
		}
	};
}
function mB(e, t, n) {
	if (!lB(t)) return null;
	let r = dB(e), i = fB(e);
	return r.start !== n || t.page.end !== n || t.page.total !== r.total || !rB(r, e.messages.length, i.length) ? null : {
		...e,
		messages: [...t.messages, ...e.messages],
		message_created_at: [...t.created_at, ...i],
		tool_call_occurrences: [...iB(t.tool_call_occurrences, t.messages.length), ...iB(e.tool_call_occurrences, e.messages.length)],
		terminal_selection_attributions: [...t.terminal_selection_attributions ?? [], ...cB(e.terminal_selection_attributions, r.start, r.end)],
		message_page: {
			start: t.page.start,
			end: r.end,
			total: r.total,
			has_older: t.page.start > 0
		}
	};
}
function hB(e, t, n) {
	if (n || !e || !t.message_page) return t;
	if (!uB(t)) return e;
	let r = t.message_created_at ?? [], i = pB(e, {
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
function gB(e, t, n) {
	let r = e.filter((e) => e !== t), i = Math.max(0, Math.min(n, r.length));
	return [
		...r.slice(0, i),
		t,
		...r.slice(i)
	];
}
function _B(t, n) {
	return (t.sort_order ?? 0) - (n.sort_order ?? 0) || e(n.created_at) - e(t.created_at);
}
function vB(e, t) {
	return e.filter((e) => !!e.summary.pinned === t).sort((e, t) => _B(e.summary, t.summary));
}
function yB(e, t, n) {
	let r = new Map(n.map((e) => [e.summary.session_id, e])), i = {};
	for (let e of t) i[e] = r.get(e)?.summary.presentation_version ?? 0;
	return {
		pinned: e,
		session_ids: t,
		expected_versions: i
	};
}
function bB(e, t) {
	return e.map((e) => e.summary.session_id === t.session_id ? {
		...e,
		summary: t
	} : e);
}
function xB(e, t, n, r) {
	if (t === r) {
		let t = e.findIndex((e) => e.summary.session_id === r);
		return t < 0 ? e.length : t;
	}
	let i = e.filter((e) => e.summary.session_id !== r), a = i.findIndex((e) => e.summary.session_id === t);
	return a < 0 ? i.length : n === "before" ? a : a + 1;
}
function SB(e, t) {
	return e.length === t.length && e.every((e, n) => e === t[n]);
}
// src/app/services/queries/invalidation.ts
function CB() {
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
var wB = /* @__PURE__ */ new Map(), TB = 0, EB = /* @__PURE__ */ new WeakMap(), DB = 0;
function OB(e, t) {
	let n = EB.get(e);
	return n === void 0 && (n = ++DB, EB.set(e, n)), `${n}:${t}`;
}
function kB(e) {
	let t = wB.get(e);
	if (t) return t;
	let n = {
		generation: ++TB,
		replaceNextSnapshot: !1,
		tailController: null,
		historyControllers: /* @__PURE__ */ new Set()
	};
	return wB.set(e, n), n;
}
function AB(e, t = !1) {
	let n = kB(e);
	n.generation = ++TB, n.replaceNextSnapshot ||= t, n.tailController?.abort(), n.tailController = null;
	for (let e of n.historyControllers) e.abort();
	return n.historyControllers.clear(), n.generation;
}
function jB(e) {
	let t = kB(e);
	return {
		generation: AB(e),
		replace: t.replaceNextSnapshot
	};
}
function MB(e, t) {
	let n = wB.get(e);
	n?.generation === t.generation && t.replace && (n.replaceNextSnapshot = !1);
}
function NB(e) {
	let t = kB(e);
	t.tailController?.abort();
	let n = new AbortController();
	return t.tailController = n, {
		generation: t.generation,
		controller: n
	};
}
function PB(e, t) {
	let n = wB.get(e);
	n?.tailController === t.controller && (n.tailController = null);
}
function FB(e, t) {
	return wB.get(e)?.generation === t;
}
function IB(e) {
	let t = kB(e), n = new AbortController();
	return t.historyControllers.add(n), {
		generation: t.generation,
		controller: n
	};
}
function LB(e, t) {
	wB.get(e)?.historyControllers.delete(t.controller);
}
function RB(e) {
	let t = wB.get(e);
	t?.tailController?.abort();
	for (let e of t?.historyControllers ?? []) e.abort();
	wB.delete(e);
}
// src/app/services/queries/session.ts
function zB(e = tg) {
	let { api: t } = r();
	return D({
		queryKey: L.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: e,
		staleTime: 0,
		placeholderData: ee
	});
}
function BB(e) {
	let { api: t } = r(), n = g((t) => t.find((t) => t.summary.session_id === e) ?? null, [e]);
	return D({
		queryKey: L.sessions(!1),
		queryFn: ({ signal: e }) => t.listSessions({}, e),
		refetchInterval: tg,
		staleTime: 0,
		placeholderData: ee,
		select: n
	});
}
function VB(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function HB(e, t) {
	let { api: n } = r(), i = O();
	return D({
		queryKey: L.sessionSnapshot(e ?? ""),
		queryFn: async ({ signal: t }) => {
			let r = jB(OB(i, e)), a = await n.getSession(e, {
				messageLimit: 24,
				threadEventLimit: 50,
				includeSessions: !1,
				includeSystem: !0,
				signal: t
			});
			if (!uB(a)) throw Error("The server returned an invalid snapshot message page.");
			if (t.aborted || !FB(OB(i, e), r.generation)) throw new DOMException("Snapshot superseded", "AbortError");
			return MB(OB(i, e), r), hB(i.getQueryData(L.sessionSnapshot(e)), a, r.replace);
		},
		enabled: !!e,
		staleTime: 1e3,
		placeholderData: VB(e ?? ""),
		...t
	});
}
function UB(e) {
	let { api: t } = r(), n = O();
	return E({ mutationFn: async () => {
		let r = n.getQueryData(L.sessionSnapshot(e))?.message_page?.start;
		if (r === void 0 || r <= 0) throw Error("No older messages are available.");
		let i = OB(n, e), a = IB(i);
		try {
			let o = await t.getMessages(e, {
				before: r,
				limit: 24,
				includeSystem: !0,
				signal: a.controller.signal
			});
			if (!lB(o)) throw Error("The server returned an invalid message page.");
			if (!FB(i, a.generation)) return !1;
			let s = !1;
			return n.setQueryData(L.sessionSnapshot(e), (e) => {
				if (!e) return e;
				let t = mB(e, o, r);
				return t ? (s = !0, t) : e;
			}), s;
		} catch (e) {
			if (a.controller.signal.aborted) return !1;
			throw e;
		} finally {
			LB(i, a);
		}
	} });
}
function WB(e) {
	let { api: t } = r();
	return D({
		queryKey: L.sessionConfig(e ?? ""),
		queryFn: ({ signal: n }) => t.getConfig(e, n),
		enabled: !!e
	});
}
function GB() {
	let { api: e } = r(), t = CB(), n = O();
	return E({
		retry: !1,
		mutationFn: (r) => tB($z({
			create: () => e.createSession(r),
			accept: (e) => {
				let r = e.metadata.session_id;
				if (!r) throw Error("The server returned a chat without an identity.");
				AB(OB(n, r), !0), n.setQueryData(L.sessionSnapshot(r), e), t.sessions();
			}
		}))
	});
}
function KB(e, t) {
	let n = [];
	for (let r of e.getQueryCache().findAll({ queryKey: ["session"] })) {
		let e = r.queryKey;
		if (e[0] !== "session" || e[2] !== "snapshot" || typeof e[1] != "string") continue;
		let i = e[1];
		i !== t && r.state.data?.forks?.some((e) => e.session_id === t) && n.push(i);
	}
	return n;
}
function qB() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = CB(), i = O();
	return E({
		mutationFn: (t) => e.deleteSession(t),
		onSuccess: (e, r) => {
			t.purgeSessions([r]), n.sessions(), i.removeQueries({ queryKey: L.sessionRoot(r) });
			for (let e of KB(i, r)) n.sessionRoot(e);
		}
	});
}
function JB() {
	let { api: e } = r(), t = CB();
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
function YB() {
	let e = JB();
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
function XB() {
	let { api: e } = r(), t = CB();
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
				a = bB(a, t);
			}
			let s = vB(a, r), c = s.map((e) => e.summary.session_id), l = gB(c, n, i);
			return SB(c, l) ? null : e.reorderSessions(yB(r, l, s));
		},
		onSuccess: () => t.sessions()
	});
}
function ZB() {
	let { api: e } = r(), t = CB(), n = O();
	return E({
		retry: !1,
		mutationFn: ({ id: t, patch: n }) => e.updateConfig(t, n),
		onSuccess: (e, { id: r }) => {
			n.invalidateQueries({ queryKey: L.sessionConfig(r) }), t.session(r), t.sessions();
		}
	});
}
function QB() {
	let { api: e } = r(), { captureRuntimeActivation: t, setOptimisticUserPrompt: n } = r().stores.runtimeStore, i = CB(), a = O();
	return E({
		retry: !1,
		mutationFn: ({ id: r, prompt: o, signal: s }) => {
			let c = t(r);
			return tB(Zz({
				optimistic: () => {
					c() && n(o);
				},
				admit: async () => {
					let t = await (s ? e.submitRun(r, o, s) : e.submitRun(r, o));
					return t.status === "accepted" ? {
						kind: "accepted",
						value: t.response
					} : t.status === "not-sent" ? {
						kind: "not-sent",
						error: new DOMException("Prompt submission was cancelled before it was sent.", "AbortError")
					} : {
						kind: "uncertain",
						error: new u(t.requestId, t.error)
					};
				},
				rejected: () => {
					c() && n(null);
				},
				reconcile: (e) => {
					e ? (AB(OB(a, r), !0), i.sessionRoot(r)) : i.session(r);
				}
			}));
		}
	});
}
function $B() {
	let e = O();
	return E({
		retry: !1,
		mutationFn: (t) => tB(Qz(nB(e, t)))
	});
}
function eV() {
	let { api: e } = r(), t = CB(), n = O();
	return E({
		mutationFn: (t) => e.compactSession(t),
		onSuccess: (e, r) => (AB(OB(n, r), !0), t.sessionRoot(r))
	});
}
function tV() {
	let { api: e } = r(), t = CB(), n = O();
	return E({
		mutationFn: ({ id: t, messageIdx: n }) => e.revertSession(t, n),
		onSuccess: (e, { id: r }) => {
			AB(OB(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function nV() {
	let { api: e } = r(), t = CB(), n = O();
	return E({
		mutationFn: ({ id: t, messageIdx: n }) => e.regenerateRun(t, n),
		onSuccess: (e, { id: r }) => {
			AB(OB(n, r), !0), t.sessionRoot(r), t.sessions();
		}
	});
}
function rV() {
	let { api: e } = r(), t = CB();
	return E({
		mutationFn: ({ id: t, messageIdx: n }) => e.forkSession(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n), t.sessions();
		}
	});
}
function iV() {
	let { api: e } = r(), t = CB();
	return E({
		mutationFn: ({ id: t, forkId: n }) => e.dismissSessionFork(t, n),
		onSuccess: (e, { id: n }) => {
			t.sessionRoot(n);
		}
	});
}
function aV() {
	return zB();
}
// src/app/services/queries/workspace.ts
function oV(e) {
	return (t, n) => n?.queryKey[1] === e ? t : void 0;
}
function sV(e, t, n = "all", i = 3, a = null) {
	let { api: o } = r();
	return D({
		queryKey: L.workspaceDiff(e ?? "", t ?? "", n, i, a),
		queryFn: ({ signal: r }) => o.getWorkspaceDiff(e, t, {
			stage: n,
			context: i,
			revision: a,
			signal: r
		}),
		enabled: !!(e && t),
		placeholderData: oV(e ?? "")
	});
}
function cV(e, t = null) {
	let { api: n } = r();
	return D({
		queryKey: L.workspaceFiles(e ?? "", t),
		queryFn: ({ signal: r }) => n.getWorkspaceFiles(e, t, r),
		enabled: !!e,
		staleTime: t == null ? 1e4 : Infinity,
		placeholderData: oV(e ?? "")
	});
}
function lV(e, t, n = null) {
	let { api: i } = r();
	return D({
		queryKey: L.workspaceFile(e ?? "", t ?? "", n),
		queryFn: ({ signal: r }) => i.getWorkspaceFile(e, t, n, r),
		enabled: !!(e && t),
		staleTime: n == null ? 1e4 : Infinity,
		placeholderData: oV(e ?? "")
	});
}
function uV(e) {
	let { api: t } = r();
	return D({
		queryKey: L.workspaceRevisions(e ?? ""),
		queryFn: ({ signal: n }) => t.getWorkspaceRevisions(e, n),
		enabled: !!e,
		staleTime: 5e3,
		retry: !1
	});
}
function dV(e, t) {
	let { api: n } = r();
	return D({
		queryKey: L.workspaceRevisionChanges(e ?? "", t ?? 0),
		queryFn: ({ signal: r }) => n.getWorkspaceRevisionChanges(e, t, r),
		enabled: !!(e && t != null),
		staleTime: Infinity,
		placeholderData: oV(e ?? "")
	});
}
function fV(e, t) {
	let { api: n } = r();
	return D({
		queryKey: L.branches(e ?? ""),
		queryFn: ({ signal: t }) => n.getBranches(e, t),
		enabled: !!e && t,
		staleTime: 5e3,
		retry: !1
	});
}
function pV(e) {
	let { api: t } = r(), n = O();
	return E({
		mutationFn: (n) => t.switchBranch(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: L.branches(e) }), n.invalidateQueries({ queryKey: L.sessionRoot(e) }), n.invalidateQueries({ queryKey: L.sessionsAll });
		}
	});
}
function mV(e) {
	let { api: t } = r(), n = O();
	return E({
		mutationFn: (n) => t.commitWorkspace(e, n),
		onSuccess: () => {
			n.invalidateQueries({ queryKey: L.sessionRoot(e) }), n.invalidateQueries({ queryKey: L.sessionsAll });
		}
	});
}
// src/app/services/queries/projects.ts
function hV() {
	let { api: e } = r();
	return D({
		queryKey: L.projects,
		queryFn: ({ signal: t }) => e.listProjects(t),
		staleTime: 3e4,
		retry: !1
	});
}
function gV() {
	let { api: e } = r(), t = CB();
	return E({
		retry: !1,
		mutationFn: (t) => e.createProject(t),
		onSuccess: () => t.projects()
	});
}
function _V() {
	let { api: e } = r(), t = CB();
	return E({
		retry: !1,
		mutationFn: ({ projectId: t, payload: n }) => e.updateProject(t, n),
		onSuccess: () => t.projects()
	});
}
function vV() {
	let e = _V();
	return {
		...e,
		toggle: (t) => e.mutateAsync({
			projectId: t.project_id,
			payload: { pinned: !t.pinned }
		})
	};
}
function yV() {
	let { api: e, stores: { promptDraftStore: t } } = r(), n = CB();
	return E({
		mutationFn: ({ projectId: t, sessions: n }) => e.deleteProject(t, n),
		onSuccess: (e) => (t.purgeSessions(e.deleted_session_ids), Promise.all([n.projects(), n.sessions()]))
	});
}
function bV() {
	let { api: e } = r(), t = CB();
	return E({
		mutationFn: ({ projectId: t, sessionId: n }) => e.assignSessionToProject(t, { session_id: n }),
		onSuccess: () => Promise.all([t.projects(), t.sessions()])
	});
}
function xV() {
	let { api: e } = r(), t = CB();
	return E({
		mutationFn: async ({ projects: t, projectId: n, targetPinned: r, targetIndex: i }) => {
			let a = t.find((e) => e.project_id === n);
			if (!a) return;
			let o = t;
			a.pinned !== r && (await e.updateProject(n, { pinned: r }), o = (await e.listProjects()).projects);
			let s = o.filter((e) => e.pinned === r).sort((e, t) => e.sort_order - t.sort_order), c = gB(s.map((e) => e.project_id), n, i);
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
var SV = {
	scope: null,
	epoch: null,
	revision: 0,
	sessions: /* @__PURE__ */ new Map()
};
function CV(e, t) {
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
var wV = 1e3, TV = 3e4;
function EV(e = {}) {
	let t = r(), { api: n, client: i } = t, a = e.projectId, o = e.enabled ?? !0, s = o && (e.stream ?? !0), [c, l] = S(CV, SV), u = C(0), d = C({
		scope: a ?? null,
		at: 0
	}), [f, p] = w({
		scope: a ?? null,
		version: 0
	}), [m, h] = w(null), g = `/attention/stream${a ? `?project_id=${encodeURIComponent(a)}` : ""}`, [_, y] = w({
		path: g,
		status: "connecting"
	}), b = s ? _.path === g ? _.status : "connecting" : "down", T = x(() => e.eventSource ?? t.openStream ?? ((e) => new EventSource(i.transport.url(e), i.transport.eventSourceInit())), [
		e.eventSource,
		t.openStream,
		i
	]), ee = D({
		queryKey: L.fleetAttention(a ?? null),
		queryFn: async ({ signal: e }) => {
			let t = ++u.current, r = performance.now(), i = await n.fleetAttention(a, e);
			return e.aborted || p({
				scope: a ?? null,
				version: t
			}), {
				snapshot: i,
				startedAt: r
			};
		},
		enabled: o,
		refetchInterval: b === "live" ? !1 : e.pollMs ?? 5e3,
		staleTime: 0
	}), E = ee.refetch;
	v(() => {
		let e = d.current;
		ee.data && (e.scope !== (a ?? null) || ee.data.startedAt >= e.at) && l({
			kind: "snapshot",
			...ee.data.snapshot,
			scope: a ?? null
		});
	}, [ee.data, a]), v(() => {
		if (!s) return;
		let e = g, t = (t) => y({
			path: e,
			status: t
		}), n = !1, r = null, i = null, o = wV, c = () => {
			r?.close(), r = null, !(n || i !== null) && (t("down"), i = setTimeout(() => {
				i = null, f();
			}, o), o = Math.min(o * 2, TV));
		}, f = async () => {
			let i;
			try {
				i = await T(e);
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
				s.kind === "unavailable" ? (h({
					scope: a ?? null,
					version: u.current
				}), c(), E()) : (o = wV, s.kind === "snapshot" && (d.current = {
					scope: a ?? null,
					at: performance.now()
				}), l({
					...s,
					scope: a ?? null
				}), h(null), t("live"));
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
		T,
		g,
		E
	]);
	let te = m?.scope === (a ?? null) && (f.scope !== m.scope || f.version <= m.version), O = b === "live" ? "live" : ee.isError || te ? "unavailable" : (b === "connecting" || !s) && !ee.data ? "connecting" : "polling";
	return {
		...c.scope === (a ?? null) ? c : SV,
		status: O
	};
}
// src/app/features/managed/model.ts
var DV = [
	"status",
	"github",
	"secrets"
], OV = /* @__PURE__ */ new Set([
	"PATH",
	"HOME",
	"NAC_HOME",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"EXA_API_KEY"
]);
function kV(e) {
	return e ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(e) ? OV.has(e) ? `${e} is managed by NAC and cannot be replaced here.` : "" : "Use letters, digits, and underscores; the first character cannot be a digit." : "Enter a variable name.";
}
function AV(e) {
	let t = e?.split("/") ?? [];
	return t.length === 2 && t[0] && t[1] ? [t[0], t[1]] : null;
}
function jV(e) {
	return e?.status === "running";
}
function MV(e) {
	return e ? {
		backend: e.model.backend,
		model: e.model.id,
		baseUrl: e.model.endpoint
	} : null;
}
function NV(e, t) {
	return !!(t && e && t.backend === e.model.backend && t.baseUrl === e.model.endpoint);
}
function PV(e, t) {
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
function FV(e) {
	return typeof e == "object" && e && "status" in e ? e.status : null;
}
function IV(e) {
	return LV(e) || e instanceof Error && e.name === "ManagedUpgradeContractError";
}
function LV(e) {
	let t = FV(e);
	return t === 401 || t === 403 || t === 409;
}
function RV(e) {
	let t = FV(e);
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
var zV = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying"
]);
function BV(e) {
	return zV.has(e);
}
function VV(e) {
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
function HV(e) {
	switch (e) {
		case "cancel_active_run": return "Stop run";
		case "cancel_traditional_child": return "Cancel coding agent";
		case "cancel_managed_orchestrator": return "Cancel NAC orchestrator";
		case "terminate_terminal": return "Stop terminal";
		case "cancel_clone_operation": return "Cancel clone";
		case "wait": return "Wait";
	}
}
function UV(e) {
	return e === null ? "Accepted-release distance unavailable" : e === 0 ? "Current accepted release" : `${e} accepted ${e === 1 ? "release" : "releases"} ahead`;
}
function WV(e, t) {
	return e.release_id === t.release_id && e.source_revision === t.source_revision && e.build_id === t.build_id && e.product_version === t.product_version && e.schema_version === t.schema_version;
}
// src/app/features/managed/upgradeContract.ts
var GV = /* @__PURE__ */ new Set([
	"pending",
	"preparing",
	"blocked",
	"safe-to-stop",
	"replacing",
	"starting/migrating",
	"verifying",
	"succeeded",
	"failed"
]), KV = /* @__PURE__ */ new Set([
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
]), qV = /* @__PURE__ */ new Set([
	"wait",
	"cancel_active_run",
	"cancel_traditional_child",
	"cancel_managed_orchestrator",
	"terminate_terminal",
	"cancel_clone_operation"
]), JV = {
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
}, YV = class extends Error {
	constructor() {
		super("Managed upgrade status did not match the browser contract."), this.name = "ManagedUpgradeContractError";
	}
};
function XV() {
	throw new YV();
}
function ZV(e, t, n) {
	(typeof e != "object" || !e || Array.isArray(e)) && XV();
	let r = e;
	return Object.keys(r).some((e) => !t.includes(e)) && XV(), n.some((e) => !Object.hasOwn(r, e)) && XV(), r;
}
function QV(e, t, n = !0) {
	return (typeof e != "string" || e.length > t || !n && e.length === 0 || /\p{Cc}/u.test(e)) && XV(), e;
}
function $V(e) {
	return (typeof e != "number" || !Number.isSafeInteger(e) || e < 0) && XV(), e;
}
function eH(e, t) {
	return typeof e == "string" && t.has(e) || XV(), e;
}
function tH(e, t, n) {
	return Object.hasOwn(e, t) ? QV(e[t], n) : void 0;
}
function nH(e) {
	let t = ZV(e, [
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
	]), n = QV(t.source_revision, 40, !1);
	return /^[a-f0-9]{40}$/.test(n) || XV(), {
		release_id: QV(t.release_id, 63, !1),
		source_revision: n,
		build_id: QV(t.build_id, 128, !1),
		product_version: QV(t.product_version, 128, !1),
		schema_version: $V(t.schema_version)
	};
}
function rH(e, t) {
	return Object.hasOwn(e, t) ? nH(e[t]) : void 0;
}
function iH(e) {
	let t = QV(e, 128, !1);
	return /^[A-Za-z0-9_.:@-]+$/.test(t) || XV(), t;
}
function aH(e) {
	let t = [
		"session_id",
		"run_id",
		"child_session_id",
		"orchestrator_session_id",
		"terminal_id",
		"clone_operation_id"
	], n = ZV(e, t, []);
	return Object.fromEntries(t.filter((e) => Object.hasOwn(n, e)).map((e) => [e, iH(n[e])]));
}
function oH(e, t) {
	let n = Object.keys(e).sort();
	return n.length === t.length && t.every((t) => n.includes(t) && !!e[t]);
}
function sH(e, t, n) {
	switch (t) {
		case "cancel_active_run": return e === "active_run" && oH(n, ["session_id", "run_id"]);
		case "cancel_traditional_child": return e === "traditional_child" && oH(n, ["session_id", "child_session_id"]);
		case "cancel_managed_orchestrator": return e === "managed_orchestrator" && oH(n, ["session_id", "orchestrator_session_id"]);
		case "terminate_terminal": return e === "terminal_process" && oH(n, ["session_id", "terminal_id"]);
		case "cancel_clone_operation": return e === "clone_operation" && oH(n, ["clone_operation_id"]);
		case "wait": return !1;
	}
}
function cH(e) {
	let t = ZV(e, [
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
	]), n = QV(t.selection_key, 71, !1);
	/^sha256:[a-f0-9]{64}$/.test(n) || XV();
	let r = eH(t.kind, KV), i = QV(t.message, 512, !1);
	JV[r].includes(i) || XV(), typeof t.actionable != "boolean" && XV();
	let a = eH(t.action, qV);
	if (!t.actionable) return (a !== "wait" || t.target !== null) && XV(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !1,
		action: a,
		target: null
	};
	let o = aH(t.target);
	return sH(r, a, o) || XV(), {
		selection_key: n,
		kind: r,
		message: i,
		actionable: !0,
		action: a,
		target: o
	};
}
function lH(e) {
	let t = ZV(e, [
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
	t.kind !== "upgrade" && XV();
	let n;
	return Object.hasOwn(t, "blockers") && ((!Array.isArray(t.blockers) || t.blockers.length > 100) && XV(), n = t.blockers.map(cH)), {
		operation_id: QV(t.operation_id, 128, !1),
		managed_host_id: QV(t.managed_host_id, 128, !1),
		kind: "upgrade",
		state: eH(t.state, GV),
		reason: tH(t, "reason", 128),
		message: tH(t, "message", 512),
		target_release: rH(t, "target_release"),
		desired_release: rH(t, "desired_release"),
		observed_release: rH(t, "observed_release"),
		blockers: n,
		created_at: tH(t, "created_at", 64),
		updated_at: tH(t, "updated_at", 64)
	};
}
function uH(e) {
	let t = ZV(e, ["preview", "operation"], ["preview", "operation"]), n = ZV(t.preview, [
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
	typeof n.upgrade_available != "boolean" && XV();
	let r = null;
	return n.distance !== null && (r = { accepted_releases: $V(ZV(n.distance, ["accepted_releases"], ["accepted_releases"]).accepted_releases) }), {
		preview: {
			current: nH(n.current),
			latest_beta: nH(n.latest_beta),
			upgrade_available: n.upgrade_available,
			distance: r
		},
		operation: t.operation === null ? null : lH(t.operation)
	};
}
// src/app/features/managed/queries.ts
var dH = {
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
function fH() {
	let { api: e } = r();
	return D({
		queryKey: dH.hostStatus,
		queryFn: ({ signal: t }) => e.getManagedStatus(t),
		staleTime: 5e3,
		refetchInterval: 15e3,
		retry: !1
	});
}
function pH(e = !0) {
	let { api: t } = r();
	return D({
		queryKey: dH.upgrade,
		queryFn: async ({ signal: e }) => uH(await t.getManagedUpgrade(e)),
		enabled: e,
		staleTime: 0,
		refetchInterval: (e) => e.state.data?.operation && BV(e.state.data.operation.state) ? 1e3 : 15e3,
		refetchIntervalInBackground: !0,
		retry: !1
	});
}
function mH() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: async (t) => lH(await e.startManagedUpgrade(t)),
		onSuccess: (e) => (t.setQueryData(dH.upgrade, (t) => t && {
			...t,
			operation: e
		}), t.invalidateQueries({ queryKey: dH.upgrade }))
	});
}
function hH(e = !0) {
	let { api: t } = r();
	return D({
		queryKey: dH.github,
		queryFn: ({ signal: e }) => t.getManagedGitHub(e),
		enabled: e,
		retry: !1
	});
}
function gH(e = !0) {
	let { api: t } = r();
	return D({
		queryKey: dH.secrets,
		queryFn: ({ signal: e }) => t.listManagedSecrets(e),
		enabled: e,
		retry: !1
	});
}
function _H() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: ({ name: t, value: n }) => e.putManagedSecret(t, n),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: dH.secrets }), t.invalidateQueries({ queryKey: dH.hostStatus })])
	});
}
function vH() {
	let { api: e } = r(), t = O();
	return E({
		mutationFn: (t) => e.deleteManagedSecret(t),
		onSuccess: () => Promise.all([t.invalidateQueries({ queryKey: dH.secrets }), t.invalidateQueries({ queryKey: dH.hostStatus })])
	});
}
function yH(e = !0, t = !1) {
	let { api: n } = r();
	return D({
		queryKey: dH.auth,
		queryFn: ({ signal: e }) => n.listManagedAuth(e),
		enabled: e,
		staleTime: 3e4,
		refetchInterval: t,
		retry: !1
	});
}
function bH(e, t, n) {
	let { api: i } = r(), a = O(), o = Cz(e === "chatgpt-codex-responses" && t !== null && n !== null);
	return D({
		queryKey: [
			...dH.providerModels(e ?? ""),
			"after-refusal",
			t,
			n,
			...e === "chatgpt-codex-responses" ? [o.data?.catalog_version] : []
		],
		queryFn: async ({ signal: t }) => {
			let n = await i.listProviderModels({ backend: e }, t);
			return e === "chatgpt-codex-responses" && await a.invalidateQueries({ queryKey: L.modelCatalog }), n;
		},
		enabled: e !== null && t !== null && n !== null && (e !== "chatgpt-codex-responses" || o.data !== void 0),
		retry: !1,
		staleTime: Infinity
	});
}
function xH(e, t, n = null) {
	let { api: i } = r(), a = O(), o = Cz(t && e === "chatgpt-codex-responses");
	return D({
		queryKey: e === "chatgpt-codex-responses" ? [
			...dH.providerModels(e, n),
			"catalog",
			o.data?.catalog_version
		] : dH.providerModels(e ?? "", n),
		queryFn: async ({ signal: t }) => {
			let r = await i.listProviderModels(n ? {
				backend: e,
				base_url: n
			} : { backend: e }, t);
			return e === "chatgpt-codex-responses" && await a.invalidateQueries({ queryKey: L.modelCatalog }), r;
		},
		enabled: t && e !== null && (e !== "chatgpt-codex-responses" || o.data !== void 0),
		retry: !1,
		staleTime: 3e5
	});
}
function SH(e) {
	let { api: t } = r(), n = O(), i = fH().data ?? null, a = x(() => PV(e, i), [e, i]), o = te({ queries: a.map((r) => ({
		queryKey: r.backend === "chatgpt-codex-responses" ? [
			...dH.providerModels(r.backend, r.base_url),
			"catalog",
			e?.catalog_version
		] : [
			...dH.providerModels(r.backend, r.base_url),
			r.api_key_env ?? null,
			r.allow_insecure_http ?? !1
		],
		queryFn: async ({ signal: e }) => {
			let i = await t.listProviderModels(r, e);
			return r.backend === "chatgpt-codex-responses" && await n.invalidateQueries({ queryKey: L.modelCatalog }), i;
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
var CH = p(null), wH = 150, TH = 3, EH = 0, DH = () => `toast-${Date.now()}-${EH++}`;
function OH({ toasts: e, removeToast: t }) {
	let r = n(), i = C(/* @__PURE__ */ new Map());
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
		className: "fixed inset-x-0 top-[calc(64px+env(safe-area-inset-top))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2 pointer-events-none",
		children: e.map((e) => /* @__PURE__ */ k("div", {
			className: "pointer-events-none flex w-full justify-center",
			children: /* @__PURE__ */ k(eg, {
				content: e.content,
				variant: e.variant,
				dismissing: e.dismissing,
				onClose: () => t(e.id)
			})
		}, e.id))
	}), r);
}
function kH({ children: e }) {
	let [t, n] = w([]), r = g((e) => {
		let t = DH();
		return n((n) => [...n, {
			id: t,
			content: e.content,
			variant: e.variant ?? Xh.Info,
			life: e.life ?? TH,
			keep: e.keep ?? !1,
			dismissing: !1
		}]), t;
	}, []), i = g((e) => {
		n((t) => {
			let r = t.find((t) => t.id === e);
			return !r || r.dismissing ? t : (setTimeout(() => n((t) => t.filter((t) => t.id !== e)), wH), t.map((t) => t.id === e ? {
				...t,
				dismissing: !0
			} : t));
		});
	}, []), a = g(() => {
		n((e) => e.length === 0 ? e : (setTimeout(() => n((e) => e.filter((e) => !e.dismissing)), wH), e.map((e) => ({
			...e,
			dismissing: !0
		}))));
	}, []), o = x(() => ({
		addToast: r,
		removeToast: i,
		clearToasts: a,
		info: (e, t) => r({
			content: e,
			variant: Xh.Info,
			...t
		}),
		success: (e, t) => r({
			content: e,
			variant: Xh.Success,
			...t
		}),
		error: (e, t) => r({
			content: e,
			variant: Xh.Error,
			...t
		}),
		danger: (e, t) => r({
			content: e,
			variant: Xh.Danger,
			...t
		})
	}), [
		r,
		i,
		a
	]);
	return /* @__PURE__ */ A(CH.Provider, {
		value: o,
		children: [e, /* @__PURE__ */ k(OH, {
			toasts: t,
			removeToast: i
		})]
	});
}
function AH() {
	let e = _(CH);
	if (!e) throw Error("useToast must be used within a ToastProvider");
	return e;
}
function jH(e) {
	return e instanceof Error ? e.message : String(e);
}
// src/app/lib/PerfProfiler.tsx
var MH = (e, n, r) => {
	t(`commit:${e}`, {
		ms: r,
		fields: { phase: n },
		throttleMs: 1e3,
		slowMs: 16
	});
};
function NH({ id: e, children: t }) {
	return c() ? /* @__PURE__ */ k(f, {
		id: e,
		onRender: MH,
		children: t
	}) : /* @__PURE__ */ k(ne, { children: t });
}
// src/app/lib/workspaceLink.ts
var PH = /^(https?|ircs?|mailto|xmpp|file)$/i, FH = /^[a-zA-Z]:[\\/]/, IH = /^(https?|mailto|ircs?|xmpp):/i;
function LH(e) {
	let t = String(e ?? "").trim();
	if (!t) return "";
	if (FH.test(t)) return t;
	let n = t.indexOf(":");
	return n === -1 || PH.test(t.slice(0, n)) ? t : "";
}
function RH(e) {
	return e.replace(/\\/g, "/");
}
function zH(e, t) {
	if (!t) return null;
	let n = RH(t).replace(/\/+$/, "");
	return n ? e === n ? "" : e.startsWith(`${n}/`) ? e.slice(n.length + 1) : null : null;
}
function BH(e, t = []) {
	let n = (e ?? "").trim();
	if (!n || n.startsWith("#")) return { kind: "blocked" };
	if (IH.test(n)) return {
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
	r = RH(r);
	for (let e of t) {
		let t = zH(r, e);
		if (t != null) {
			r = t;
			break;
		}
	}
	return r.startsWith("/") || FH.test(r) || (r = r.replace(/^\.\//, ""), !r || r === ".") || r.split("/").includes("..") || r.includes("://") ? { kind: "blocked" } : {
		kind: "workspace",
		path: r
	};
}
export { iV as $, Kh as $n, ue as $r, hz as $t, kV as A, FR as An, dm as Ar, Bz as At, _V as B, ML as Bn, vs as Br, Vz as Bt, VV as C, XR as Cn, cm as Cr, pB as Ct, DV as D, QR as Dn, om as Dr, Yz as Dt, WV as E, ZR as En, tm as Er, Iz as Et, gV as F, VR as Fn, Wp as Fr, Kz as Ft, lV as G, vk as Gn, us as Gr, Oz as Gt, mV as H, OL as Hn, gs as Hr, jz as Ht, yV as I, jR as In, Kp as Ir, Pz as It, uV as J, pv as Jn, ss as Jr, sz as Jt, cV as K, yk as Kn, ds as Kr, Tz as Kt, xV as L, ER as Ln, Gp as Lr, Lz as Lt, AV as M, LR as Mn, sm as Mr, Rz as Mt, EV as N, YR as Nn, Qp as Nr, Fz as Nt, jV as O, $R as On, lm as Or, Gz as Ot, bV as P, HR as Pn, em as Pr, zz as Pt, qB as Q, Uh as Qn, ce as Qr, pz as Qt, hV as R, AL as Rn, Gs as Rr, Wz as Rt, BV as S, BR as Sn, im as Sr, xB as St, IV as T, qR as Tn, nm as Tr, tB as Tt, pV as U, kL as Un, ps as Ur, Az as Ut, fV as V, PL as Vn, ys as Vr, Jz as Vt, sV as W, _k as Wn, fs as Wr, kz as Wt, eV as X, Yh as Xn, F as Xr, dz as Xt, $B as Y, L as Yn, Xn as Yr, _z as Yt, GB as Z, qh as Zn, le as Zr, yz as Zt, SH as _, WR as _n, Am as _r, PB as _t, jH as a, ae as ai, Dz as an, nh as ar, WB as at, LV as b, MR as bn, Em as br, _B as bt, vH as c, az as cn, qm as cr, zB as ct, fH as d, bz as dn, Jm as dr, ZB as dt, fe as ei, Sz as en, yh as er, rV as et, xH as f, vz as fn, Wm as fr, JB as ft, _H as g, RR as gn, km as gr, AB as gt, bH as h, nz as hn, Nm as hr, RB as ht, kH as i, oe as ii, oz as in, rh as ir, tV as it, NV as j, IR as jn, am as jr, qz as jt, MV as k, KR as kn, um as kr, Hz as kt, yH as l, lz as ln, Gm as lr, QB as lt, pH as m, tz as mn, Lm as mr, NB as mt, LH as n, pe as ni, gz as nn, ph as nr, XB as nt, AH as o, Ez as on, th as or, HB as ot, gH as p, fz as pn, zm as pr, aV as pt, dV as q, Zy as qn, ls as qr, iz as qt, NH as r, me as ri, Cz as rn, dh as rr, nV as rt, dH as s, uz as sn, Qm as sr, BB as st, BH as t, he as ti, xz as tn, fh as tr, UB as tt, hH as u, cz as un, Km as ur, YB as ut, mH as v, zR as vn, Cm as vr, FB as vt, RV as w, PR as wn, Jp as wr, eB as wt, UV as x, NR as xn, fm as xr, vB as xt, HV as y, GR as yn, xm as yr, OB as yt, vV as z, jL as zn, _s as zr, Uz as zt };
