import { a as e, i as t, n, o as r, r as i } from "./PresentationBoundary-BVEraDGB.js";
import * as a from "react";
import { createContext as o, createElement as s, forwardRef as c, useCallback as l, useContext as u, useEffect as d, useInsertionEffect as f, useLayoutEffect as p, useMemo as m, useRef as h, useState as g, useSyncExternalStore as _ } from "react";
import { Fragment as v, jsx as y, jsxs as b } from "react/jsx-runtime";
import { useLocation as x } from "react-router-dom";
import * as S from "react-dom";
// node_modules/clsx/dist/clsx.mjs
function C(e) {
	var t, n, r = "";
	if (typeof e == "string" || typeof e == "number") r += e;
	else if (typeof e == "object") {
		if (Array.isArray(e)) {
			var i = e.length;
			for (t = 0; t < i; t++) e[t] && (n = C(e[t])) && (r && (r += " "), r += n);
		} else for (n in e) e[n] && (r && (r += " "), r += n);
	}
	return r;
}
function w() {
	for (var e, t, n = 0, r = "", i = arguments.length; n < i; n++) (e = arguments[n]) && (t = C(e)) && (r && (r += " "), r += t);
	return r;
}
// node_modules/tailwind-merge/dist/bundle-mjs.mjs
var T = (e, t) => {
	let n = Array(e.length + t.length);
	for (let t = 0; t < e.length; t++) n[t] = e[t];
	for (let r = 0; r < t.length; r++) n[e.length + r] = t[r];
	return n;
}, E = (e, t) => ({
	classGroupId: e,
	validator: t
}), D = (e = /* @__PURE__ */ new Map(), t = null, n) => ({
	nextPart: e,
	validators: t,
	classGroupId: n
}), O = "-", k = [], ee = "arbitrary..", A = (e) => {
	let t = N(e), { conflictingClassGroups: n, conflictingClassGroupModifiers: r } = e;
	return {
		getClassGroupId: (e) => {
			if (e.startsWith("[") && e.endsWith("]")) return M(e);
			let n = e.split(O);
			return j(n, +(n[0] === "" && n.length > 1), t);
		},
		getConflictingClassGroupIds: (e, t) => {
			if (t) {
				let t = r[e], i = n[e];
				return t ? i ? T(i, t) : t : i || k;
			}
			return n[e] || k;
		}
	};
}, j = (e, t, n) => {
	if (e.length - t === 0) return n.classGroupId;
	let r = e[t], i = n.nextPart.get(r);
	if (i) {
		let n = j(e, t + 1, i);
		if (n) return n;
	}
	let a = n.validators;
	if (a === null) return;
	let o = t === 0 ? e.join(O) : e.slice(t).join(O), s = a.length;
	for (let e = 0; e < s; e++) {
		let t = a[e];
		if (t.validator(o)) return t.classGroupId;
	}
}, M = (e) => e.slice(1, -1).indexOf(":") === -1 ? void 0 : (() => {
	let t = e.slice(1, -1), n = t.indexOf(":"), r = t.slice(0, n);
	return r ? ee + r : void 0;
})(), N = (e) => {
	let { theme: t, classGroups: n } = e;
	return P(n, t);
}, P = (e, t) => {
	let n = D();
	for (let r in e) {
		let i = e[r];
		F(i, n, r, t);
	}
	return n;
}, F = (e, t, n, r) => {
	let i = e.length;
	for (let a = 0; a < i; a++) {
		let i = e[a];
		te(i, t, n, r);
	}
}, te = (e, t, n, r) => {
	typeof e == "string" ? ne(e, t, n) : typeof e == "function" ? re(e, t, n, r) : ie(e, t, n, r);
}, ne = (e, t, n) => {
	let r = e === "" ? t : I(t, e);
	r.classGroupId = n;
}, re = (e, t, n, r) => {
	L(e) ? F(e(r), t, n, r) : (t.validators === null && (t.validators = []), t.validators.push(E(n, e)));
}, ie = (e, t, n, r) => {
	let i = Object.entries(e), a = i.length;
	for (let e = 0; e < a; e++) {
		let [a, o] = i[e];
		F(o, I(t, a), n, r);
	}
}, I = (e, t) => {
	let n = e, r = t.split(O), i = r.length;
	for (let e = 0; e < i; e++) {
		let t = r[e], i = n.nextPart.get(t);
		i || (i = D(), n.nextPart.set(t, i)), n = i;
	}
	return n;
}, L = (e) => "isThemeGetter" in e && e.isThemeGetter === !0, ae = (e) => {
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
}, oe = "!", R = ":", se = [], ce = (e, t, n, r, i) => ({
	modifiers: e,
	hasImportantModifier: t,
	baseClassName: n,
	maybePostfixModifierPosition: r,
	isExternal: i
}), le = (e) => {
	let { prefix: t, experimentalParseClassName: n } = e, r = (e) => {
		let t = [], n = 0, r = 0, i = 0, a, o = e.length;
		for (let s = 0; s < o; s++) {
			let o = e[s];
			if (n === 0 && r === 0) {
				if (o === R) {
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
		s.endsWith(oe) ? (c = s.slice(0, -1), l = !0) : s.startsWith(oe) && (c = s.slice(1), l = !0);
		let u = a && a > i ? a - i : void 0;
		return ce(t, l, c, u);
	};
	if (t) {
		let e = t + R, n = r;
		r = (t) => t.startsWith(e) ? n(t.slice(e.length)) : ce(se, !1, t, void 0, !0);
	}
	if (n) {
		let e = r;
		r = (t) => n({
			className: t,
			parseClassName: e
		});
	}
	return r;
}, ue = (e) => {
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
}, de = (e) => ({
	cache: ae(e.cacheSize),
	parseClassName: le(e),
	sortModifiers: ue(e),
	postfixLookupClassGroupIds: fe(e),
	...A(e)
}), fe = (e) => {
	let t = Object.create(null), n = e.postfixLookupClassGroups;
	if (n) for (let e = 0; e < n.length; e++) t[n[e]] = !0;
	return t;
}, pe = /\s+/, me = (e, t) => {
	let { parseClassName: n, getClassGroupId: r, getConflictingClassGroupIds: i, sortModifiers: a, postfixLookupClassGroupIds: o } = t, s = [], c = e.trim().split(pe), l = "";
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
		let _ = d.length === 0 ? "" : d.length === 1 ? d[0] : a(d).join(":"), v = f ? _ + oe : _, y = v + g;
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
}, he = (...e) => {
	let t = 0, n, r, i = "";
	for (; t < e.length;) (n = e[t++]) && (r = ge(n)) && (i && (i += " "), i += r);
	return i;
}, ge = (e) => {
	if (typeof e == "string") return e;
	let t, n = "";
	for (let r = 0; r < e.length; r++) e[r] && (t = ge(e[r])) && (n && (n += " "), n += t);
	return n;
}, _e = (e, ...t) => {
	let n, r, i, a, o = (o) => (n = de(t.reduce((e, t) => t(e), e())), r = n.cache.get, i = n.cache.set, a = s, s(o)), s = (e) => {
		let t = r(e);
		if (t) return t;
		let a = me(e, n);
		return i(e, a), a;
	};
	return a = o, (...e) => a(he(...e));
}, ve = [], z = (e) => {
	let t = (t) => t[e] || ve;
	return t.isThemeGetter = !0, t;
}, ye = /^\[(?:(\w[\w-]*):)?(.+)\]$/i, be = /^\((?:(\w[\w-]*):)?(.+)\)$/i, xe = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/, Se = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/, Ce = /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/, we = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/, Te = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/, Ee = /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/, De = (e) => xe.test(e), B = (e) => !!e && !Number.isNaN(Number(e)), Oe = (e) => !!e && Number.isInteger(Number(e)), ke = (e) => e.endsWith("%") && B(e.slice(0, -1)), Ae = (e) => Se.test(e), je = () => !0, Me = (e) => Ce.test(e) && !we.test(e), Ne = () => !1, Pe = (e) => Te.test(e), Fe = (e) => Ee.test(e), Ie = (e) => !V(e) && !H(e), Le = (e) => e.startsWith("@container") && (e[10] === "/" && e[11] !== void 0 || e[11] === "s" && e[16] !== void 0 && e.startsWith("-size/", 10) || e[11] === "n" && e[18] !== void 0 && e.startsWith("-normal/", 10)), Re = (e) => $e(e, rt, Ne), V = (e) => ye.test(e), ze = (e) => $e(e, it, Me), Be = (e) => $e(e, at, B), Ve = (e) => $e(e, st, je), He = (e) => $e(e, ot, Ne), Ue = (e) => $e(e, tt, Ne), We = (e) => $e(e, nt, Fe), Ge = (e) => $e(e, ct, Pe), H = (e) => be.test(e), Ke = (e) => et(e, it), qe = (e) => et(e, ot), Je = (e) => et(e, tt), Ye = (e) => et(e, rt), Xe = (e) => et(e, nt), Ze = (e) => et(e, ct, !0), Qe = (e) => et(e, st, !0), $e = (e, t, n) => {
	let r = ye.exec(e);
	return r ? r[1] ? t(r[1]) : n(r[2]) : !1;
}, et = (e, t, n = !1) => {
	let r = be.exec(e);
	return r ? r[1] ? t(r[1]) : n : !1;
}, tt = (e) => e === "position" || e === "percentage", nt = (e) => e === "image" || e === "url", rt = (e) => e === "length" || e === "size" || e === "bg-size", it = (e) => e === "length", at = (e) => e === "number", ot = (e) => e === "family-name", st = (e) => e === "number" || e === "weight", ct = (e) => e === "shadow", lt = () => {
	let e = z("color"), t = z("font"), n = z("text"), r = z("font-weight"), i = z("tracking"), a = z("leading"), o = z("breakpoint"), s = z("container"), c = z("spacing"), l = z("radius"), u = z("shadow"), d = z("inset-shadow"), f = z("text-shadow"), p = z("drop-shadow"), m = z("blur"), h = z("perspective"), g = z("aspect"), _ = z("ease"), v = z("animate"), y = () => [
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
		H,
		V
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
		H,
		V,
		c
	], T = () => [
		De,
		"full",
		"auto",
		...w()
	], E = () => [
		Oe,
		"none",
		"subgrid",
		H,
		V
	], D = () => [
		"auto",
		{ span: [
			"full",
			Oe,
			H,
			V
		] },
		Oe,
		H,
		V
	], O = () => [
		Oe,
		"auto",
		H,
		V
	], k = () => [
		"auto",
		"min",
		"max",
		"fr",
		H,
		V
	], ee = () => [
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
	], A = () => [
		"start",
		"end",
		"center",
		"stretch",
		"center-safe",
		"end-safe"
	], j = () => ["auto", ...w()], M = () => [
		De,
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
	], N = () => [
		De,
		"screen",
		"full",
		"dvw",
		"lvw",
		"svw",
		"min",
		"max",
		"fit",
		...w()
	], P = () => [
		De,
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
	], F = () => [
		e,
		H,
		V
	], te = () => [
		...b(),
		Je,
		Ue,
		{ position: [H, V] }
	], ne = () => ["no-repeat", { repeat: [
		"",
		"x",
		"y",
		"space",
		"round"
	] }], re = () => [
		"auto",
		"cover",
		"contain",
		Ye,
		Re,
		{ size: [H, V] }
	], ie = () => [
		ke,
		Ke,
		ze
	], I = () => [
		"",
		"none",
		"full",
		l,
		H,
		V
	], L = () => [
		"",
		B,
		Ke,
		ze
	], ae = () => [
		"solid",
		"dashed",
		"dotted",
		"double"
	], oe = () => [
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
	], R = () => [
		B,
		ke,
		Je,
		Ue
	], se = () => [
		"",
		"none",
		m,
		H,
		V
	], ce = () => [
		"none",
		B,
		H,
		V
	], le = () => [
		"none",
		B,
		H,
		V
	], ue = () => [
		B,
		H,
		V
	], de = () => [
		De,
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
			blur: [Ae],
			breakpoint: [Ae],
			color: [je],
			container: [Ae],
			"drop-shadow": [Ae],
			ease: [
				"in",
				"out",
				"in-out"
			],
			font: [Ie],
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
			"inset-shadow": [Ae],
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
			radius: [Ae],
			shadow: [Ae],
			spacing: ["px", B],
			text: [Ae],
			"text-shadow": [Ae],
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
				De,
				V,
				H,
				g
			] }],
			container: ["container"],
			"container-type": [{ "@container": [
				"",
				"normal",
				"size",
				H,
				V
			] }],
			"container-named": [Le],
			columns: [{ columns: [
				B,
				V,
				H,
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
				Oe,
				"auto",
				H,
				V
			] }],
			basis: [{ basis: [
				De,
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
				B,
				De,
				"auto",
				"initial",
				"none",
				V
			] }],
			grow: [{ grow: [
				"",
				B,
				H,
				V
			] }],
			shrink: [{ shrink: [
				"",
				B,
				H,
				V
			] }],
			order: [{ order: [
				Oe,
				"first",
				"last",
				"none",
				H,
				V
			] }],
			"grid-cols": [{ "grid-cols": E() }],
			"col-start-end": [{ col: D() }],
			"col-start": [{ "col-start": O() }],
			"col-end": [{ "col-end": O() }],
			"grid-rows": [{ "grid-rows": E() }],
			"row-start-end": [{ row: D() }],
			"row-start": [{ "row-start": O() }],
			"row-end": [{ "row-end": O() }],
			"grid-flow": [{ "grid-flow": [
				"row",
				"col",
				"dense",
				"row-dense",
				"col-dense"
			] }],
			"auto-cols": [{ "auto-cols": k() }],
			"auto-rows": [{ "auto-rows": k() }],
			gap: [{ gap: w() }],
			"gap-x": [{ "gap-x": w() }],
			"gap-y": [{ "gap-y": w() }],
			"justify-content": [{ justify: [...ee(), "normal"] }],
			"justify-items": [{ "justify-items": [...A(), "normal"] }],
			"justify-self": [{ "justify-self": ["auto", ...A()] }],
			"align-content": [{ content: ["normal", ...ee()] }],
			"align-items": [{ items: [...A(), { baseline: ["", "last"] }] }],
			"align-self": [{ self: [
				"auto",
				...A(),
				{ baseline: ["", "last"] }
			] }],
			"place-content": [{ "place-content": ee() }],
			"place-items": [{ "place-items": [...A(), "baseline"] }],
			"place-self": [{ "place-self": ["auto", ...A()] }],
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
			m: [{ m: j() }],
			mx: [{ mx: j() }],
			my: [{ my: j() }],
			ms: [{ ms: j() }],
			me: [{ me: j() }],
			mbs: [{ mbs: j() }],
			mbe: [{ mbe: j() }],
			mt: [{ mt: j() }],
			mr: [{ mr: j() }],
			mb: [{ mb: j() }],
			ml: [{ ml: j() }],
			"space-x": [{ "space-x": w() }],
			"space-x-reverse": ["space-x-reverse"],
			"space-y": [{ "space-y": w() }],
			"space-y-reverse": ["space-y-reverse"],
			size: [{ size: M() }],
			"inline-size": [{ inline: ["auto", ...N()] }],
			"min-inline-size": [{ "min-inline": ["auto", ...N()] }],
			"max-inline-size": [{ "max-inline": ["none", ...N()] }],
			"block-size": [{ block: ["auto", ...P()] }],
			"min-block-size": [{ "min-block": ["auto", ...P()] }],
			"max-block-size": [{ "max-block": ["none", ...P()] }],
			w: [{ w: [
				s,
				"screen",
				...M()
			] }],
			"min-w": [{ "min-w": [
				s,
				"screen",
				"none",
				...M()
			] }],
			"max-w": [{ "max-w": [
				s,
				"screen",
				"none",
				"prose",
				{ screen: [o] },
				...M()
			] }],
			h: [{ h: [
				"screen",
				"lh",
				...M()
			] }],
			"min-h": [{ "min-h": [
				"screen",
				"lh",
				"none",
				...M()
			] }],
			"max-h": [{ "max-h": [
				"screen",
				"lh",
				...M()
			] }],
			"font-size": [{ text: [
				"base",
				n,
				Ke,
				ze
			] }],
			"font-smoothing": ["antialiased", "subpixel-antialiased"],
			"font-style": ["italic", "not-italic"],
			"font-weight": [{ font: [
				r,
				Qe,
				Ve
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
				ke,
				V
			] }],
			"font-family": [{ font: [
				qe,
				He,
				t
			] }],
			"font-features": [{ "font-features": [V] }],
			"fvn-normal": ["normal-nums"],
			"fvn-ordinal": ["ordinal"],
			"fvn-slashed-zero": ["slashed-zero"],
			"fvn-figure": ["lining-nums", "oldstyle-nums"],
			"fvn-spacing": ["proportional-nums", "tabular-nums"],
			"fvn-fraction": ["diagonal-fractions", "stacked-fractions"],
			tracking: [{ tracking: [
				i,
				H,
				V
			] }],
			"line-clamp": [{ "line-clamp": [
				B,
				"none",
				H,
				Be
			] }],
			leading: [{ leading: [a, ...w()] }],
			"list-image": [{ "list-image": [
				"none",
				H,
				V
			] }],
			"list-style-position": [{ list: ["inside", "outside"] }],
			"list-style-type": [{ list: [
				"disc",
				"decimal",
				"none",
				H,
				V
			] }],
			"text-alignment": [{ text: [
				"left",
				"center",
				"right",
				"justify",
				"start",
				"end"
			] }],
			"placeholder-color": [{ placeholder: F() }],
			"text-color": [{ text: F() }],
			"text-decoration": [
				"underline",
				"overline",
				"line-through",
				"no-underline"
			],
			"text-decoration-style": [{ decoration: [...ae(), "wavy"] }],
			"text-decoration-thickness": [{ decoration: [
				B,
				"from-font",
				"auto",
				H,
				ze
			] }],
			"text-decoration-color": [{ decoration: F() }],
			"underline-offset": [{ "underline-offset": [
				B,
				"auto",
				H,
				V
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
				Oe,
				H,
				V
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
				H,
				V
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
				H,
				V
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
			"bg-position": [{ bg: te() }],
			"bg-repeat": [{ bg: ne() }],
			"bg-size": [{ bg: re() }],
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
						Oe,
						H,
						V
					],
					radial: [
						"",
						H,
						V
					],
					conic: [
						Oe,
						H,
						V
					]
				},
				Xe,
				We
			] }],
			"bg-color": [{ bg: F() }],
			"gradient-from-pos": [{ from: ie() }],
			"gradient-via-pos": [{ via: ie() }],
			"gradient-to-pos": [{ to: ie() }],
			"gradient-from": [{ from: F() }],
			"gradient-via": [{ via: F() }],
			"gradient-to": [{ to: F() }],
			rounded: [{ rounded: I() }],
			"rounded-s": [{ "rounded-s": I() }],
			"rounded-e": [{ "rounded-e": I() }],
			"rounded-t": [{ "rounded-t": I() }],
			"rounded-r": [{ "rounded-r": I() }],
			"rounded-b": [{ "rounded-b": I() }],
			"rounded-l": [{ "rounded-l": I() }],
			"rounded-ss": [{ "rounded-ss": I() }],
			"rounded-se": [{ "rounded-se": I() }],
			"rounded-ee": [{ "rounded-ee": I() }],
			"rounded-es": [{ "rounded-es": I() }],
			"rounded-tl": [{ "rounded-tl": I() }],
			"rounded-tr": [{ "rounded-tr": I() }],
			"rounded-br": [{ "rounded-br": I() }],
			"rounded-bl": [{ "rounded-bl": I() }],
			"border-w": [{ border: L() }],
			"border-w-x": [{ "border-x": L() }],
			"border-w-y": [{ "border-y": L() }],
			"border-w-s": [{ "border-s": L() }],
			"border-w-e": [{ "border-e": L() }],
			"border-w-bs": [{ "border-bs": L() }],
			"border-w-be": [{ "border-be": L() }],
			"border-w-t": [{ "border-t": L() }],
			"border-w-r": [{ "border-r": L() }],
			"border-w-b": [{ "border-b": L() }],
			"border-w-l": [{ "border-l": L() }],
			"divide-x": [{ "divide-x": L() }],
			"divide-x-reverse": ["divide-x-reverse"],
			"divide-y": [{ "divide-y": L() }],
			"divide-y-reverse": ["divide-y-reverse"],
			"border-style": [{ border: [
				...ae(),
				"hidden",
				"none"
			] }],
			"divide-style": [{ divide: [
				...ae(),
				"hidden",
				"none"
			] }],
			"border-color": [{ border: F() }],
			"border-color-x": [{ "border-x": F() }],
			"border-color-y": [{ "border-y": F() }],
			"border-color-s": [{ "border-s": F() }],
			"border-color-e": [{ "border-e": F() }],
			"border-color-bs": [{ "border-bs": F() }],
			"border-color-be": [{ "border-be": F() }],
			"border-color-t": [{ "border-t": F() }],
			"border-color-r": [{ "border-r": F() }],
			"border-color-b": [{ "border-b": F() }],
			"border-color-l": [{ "border-l": F() }],
			"divide-color": [{ divide: F() }],
			"outline-style": [{ outline: [
				...ae(),
				"none",
				"hidden"
			] }],
			"outline-offset": [{ "outline-offset": [
				B,
				H,
				V
			] }],
			"outline-w": [{ outline: [
				"",
				B,
				Ke,
				ze
			] }],
			"outline-color": [{ outline: F() }],
			shadow: [{ shadow: [
				"",
				"none",
				u,
				Ze,
				Ge
			] }],
			"shadow-color": [{ shadow: F() }],
			"inset-shadow": [{ "inset-shadow": [
				"none",
				d,
				Ze,
				Ge
			] }],
			"inset-shadow-color": [{ "inset-shadow": F() }],
			"ring-w": [{ ring: L() }],
			"ring-w-inset": ["ring-inset"],
			"ring-color": [{ ring: F() }],
			"ring-offset-w": [{ "ring-offset": [B, ze] }],
			"ring-offset-color": [{ "ring-offset": F() }],
			"inset-ring-w": [{ "inset-ring": L() }],
			"inset-ring-color": [{ "inset-ring": F() }],
			"text-shadow": [{ "text-shadow": [
				"none",
				f,
				Ze,
				Ge
			] }],
			"text-shadow-color": [{ "text-shadow": F() }],
			opacity: [{ opacity: [
				B,
				H,
				V
			] }],
			"mix-blend": [{ "mix-blend": [
				...oe(),
				"plus-darker",
				"plus-lighter"
			] }],
			"bg-blend": [{ "bg-blend": oe() }],
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
			"mask-image-linear-pos": [{ "mask-linear": [B] }],
			"mask-image-linear-from-pos": [{ "mask-linear-from": R() }],
			"mask-image-linear-to-pos": [{ "mask-linear-to": R() }],
			"mask-image-linear-from-color": [{ "mask-linear-from": F() }],
			"mask-image-linear-to-color": [{ "mask-linear-to": F() }],
			"mask-image-t-from-pos": [{ "mask-t-from": R() }],
			"mask-image-t-to-pos": [{ "mask-t-to": R() }],
			"mask-image-t-from-color": [{ "mask-t-from": F() }],
			"mask-image-t-to-color": [{ "mask-t-to": F() }],
			"mask-image-r-from-pos": [{ "mask-r-from": R() }],
			"mask-image-r-to-pos": [{ "mask-r-to": R() }],
			"mask-image-r-from-color": [{ "mask-r-from": F() }],
			"mask-image-r-to-color": [{ "mask-r-to": F() }],
			"mask-image-b-from-pos": [{ "mask-b-from": R() }],
			"mask-image-b-to-pos": [{ "mask-b-to": R() }],
			"mask-image-b-from-color": [{ "mask-b-from": F() }],
			"mask-image-b-to-color": [{ "mask-b-to": F() }],
			"mask-image-l-from-pos": [{ "mask-l-from": R() }],
			"mask-image-l-to-pos": [{ "mask-l-to": R() }],
			"mask-image-l-from-color": [{ "mask-l-from": F() }],
			"mask-image-l-to-color": [{ "mask-l-to": F() }],
			"mask-image-x-from-pos": [{ "mask-x-from": R() }],
			"mask-image-x-to-pos": [{ "mask-x-to": R() }],
			"mask-image-x-from-color": [{ "mask-x-from": F() }],
			"mask-image-x-to-color": [{ "mask-x-to": F() }],
			"mask-image-y-from-pos": [{ "mask-y-from": R() }],
			"mask-image-y-to-pos": [{ "mask-y-to": R() }],
			"mask-image-y-from-color": [{ "mask-y-from": F() }],
			"mask-image-y-to-color": [{ "mask-y-to": F() }],
			"mask-image-radial": [{ "mask-radial": [H, V] }],
			"mask-image-radial-from-pos": [{ "mask-radial-from": R() }],
			"mask-image-radial-to-pos": [{ "mask-radial-to": R() }],
			"mask-image-radial-from-color": [{ "mask-radial-from": F() }],
			"mask-image-radial-to-color": [{ "mask-radial-to": F() }],
			"mask-image-radial-shape": [{ "mask-radial": ["circle", "ellipse"] }],
			"mask-image-radial-size": [{ "mask-radial": [{
				closest: ["side", "corner"],
				farthest: ["side", "corner"]
			}] }],
			"mask-image-radial-pos": [{ "mask-radial-at": b() }],
			"mask-image-conic-pos": [{ "mask-conic": [B] }],
			"mask-image-conic-from-pos": [{ "mask-conic-from": R() }],
			"mask-image-conic-to-pos": [{ "mask-conic-to": R() }],
			"mask-image-conic-from-color": [{ "mask-conic-from": F() }],
			"mask-image-conic-to-color": [{ "mask-conic-to": F() }],
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
			"mask-position": [{ mask: te() }],
			"mask-repeat": [{ mask: ne() }],
			"mask-size": [{ mask: re() }],
			"mask-type": [{ "mask-type": ["alpha", "luminance"] }],
			"mask-image": [{ mask: [
				"none",
				H,
				V
			] }],
			filter: [{ filter: [
				"",
				"none",
				H,
				V
			] }],
			blur: [{ blur: se() }],
			brightness: [{ brightness: [
				B,
				H,
				V
			] }],
			contrast: [{ contrast: [
				B,
				H,
				V
			] }],
			"drop-shadow": [{ "drop-shadow": [
				"",
				"none",
				p,
				Ze,
				Ge
			] }],
			"drop-shadow-color": [{ "drop-shadow": F() }],
			grayscale: [{ grayscale: [
				"",
				B,
				H,
				V
			] }],
			"hue-rotate": [{ "hue-rotate": [
				B,
				H,
				V
			] }],
			invert: [{ invert: [
				"",
				B,
				H,
				V
			] }],
			saturate: [{ saturate: [
				B,
				H,
				V
			] }],
			sepia: [{ sepia: [
				"",
				B,
				H,
				V
			] }],
			"backdrop-filter": [{ "backdrop-filter": [
				"",
				"none",
				H,
				V
			] }],
			"backdrop-blur": [{ "backdrop-blur": se() }],
			"backdrop-brightness": [{ "backdrop-brightness": [
				B,
				H,
				V
			] }],
			"backdrop-contrast": [{ "backdrop-contrast": [
				B,
				H,
				V
			] }],
			"backdrop-grayscale": [{ "backdrop-grayscale": [
				"",
				B,
				H,
				V
			] }],
			"backdrop-hue-rotate": [{ "backdrop-hue-rotate": [
				B,
				H,
				V
			] }],
			"backdrop-invert": [{ "backdrop-invert": [
				"",
				B,
				H,
				V
			] }],
			"backdrop-opacity": [{ "backdrop-opacity": [
				B,
				H,
				V
			] }],
			"backdrop-saturate": [{ "backdrop-saturate": [
				B,
				H,
				V
			] }],
			"backdrop-sepia": [{ "backdrop-sepia": [
				"",
				B,
				H,
				V
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
				H,
				V
			] }],
			"transition-behavior": [{ transition: ["normal", "discrete"] }],
			duration: [{ duration: [
				B,
				"initial",
				H,
				V
			] }],
			ease: [{ ease: [
				"linear",
				"initial",
				_,
				H,
				V
			] }],
			delay: [{ delay: [
				B,
				H,
				V
			] }],
			animate: [{ animate: [
				"none",
				v,
				H,
				V
			] }],
			backface: [{ backface: ["hidden", "visible"] }],
			perspective: [{ perspective: [
				h,
				H,
				V
			] }],
			"perspective-origin": [{ "perspective-origin": x() }],
			rotate: [{ rotate: ce() }],
			"rotate-x": [{ "rotate-x": ce() }],
			"rotate-y": [{ "rotate-y": ce() }],
			"rotate-z": [{ "rotate-z": ce() }],
			scale: [{ scale: le() }],
			"scale-x": [{ "scale-x": le() }],
			"scale-y": [{ "scale-y": le() }],
			"scale-z": [{ "scale-z": le() }],
			"scale-3d": ["scale-3d"],
			skew: [{ skew: ue() }],
			"skew-x": [{ "skew-x": ue() }],
			"skew-y": [{ "skew-y": ue() }],
			transform: [{ transform: [
				H,
				V,
				"",
				"none",
				"gpu",
				"cpu"
			] }],
			"transform-origin": [{ origin: x() }],
			"transform-style": [{ transform: ["3d", "flat"] }],
			translate: [{ translate: de() }],
			"translate-x": [{ "translate-x": de() }],
			"translate-y": [{ "translate-y": de() }],
			"translate-z": [{ "translate-z": de() }],
			"translate-none": ["translate-none"],
			zoom: [{ zoom: [
				Oe,
				H,
				V
			] }],
			accent: [{ accent: F() }],
			appearance: [{ appearance: ["none", "auto"] }],
			"caret-color": [{ caret: F() }],
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
				H,
				V
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
			"scrollbar-thumb-color": [{ "scrollbar-thumb": F() }],
			"scrollbar-track-color": [{ "scrollbar-track": F() }],
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
				H,
				V
			] }],
			fill: [{ fill: ["none", ...F()] }],
			"stroke-w": [{ stroke: [
				B,
				Ke,
				ze,
				Be
			] }],
			stroke: [{ stroke: ["none", ...F()] }],
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
}, ut = (e, { cacheSize: t, prefix: n, experimentalParseClassName: r, extend: i = {}, override: a = {} }) => (dt(e, "cacheSize", t), dt(e, "prefix", n), dt(e, "experimentalParseClassName", r), ft(e.theme, a.theme), ft(e.classGroups, a.classGroups), ft(e.conflictingClassGroups, a.conflictingClassGroups), ft(e.conflictingClassGroupModifiers, a.conflictingClassGroupModifiers), dt(e, "postfixLookupClassGroups", a.postfixLookupClassGroups), dt(e, "orderSensitiveModifiers", a.orderSensitiveModifiers), pt(e.theme, i.theme), pt(e.classGroups, i.classGroups), pt(e.conflictingClassGroups, i.conflictingClassGroups), pt(e.conflictingClassGroupModifiers, i.conflictingClassGroupModifiers), mt(e, i, "postfixLookupClassGroups"), mt(e, i, "orderSensitiveModifiers"), e), dt = (e, t, n) => {
	n !== void 0 && (e[t] = n);
}, ft = (e, t) => {
	if (t) for (let n in t) dt(e, n, t[n]);
}, pt = (e, t) => {
	if (t) for (let n in t) mt(e, t, n);
}, mt = (e, t, n) => {
	let r = t[n];
	r !== void 0 && (e[n] = e[n] ? e[n].concat(r) : r);
}, ht = ((e, ...t) => typeof e == "function" ? _e(lt, e, ...t) : _e(() => ut(lt(), e), ...t))({ extend: {
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
function U(...e) {
	return ht(w(e));
}
// node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
var gt = (e) => e?.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
// node_modules/lucide-react/dist/esm/shared/src/utils/toLucideIconData.mjs
function _t(e, t, n = []) {
	if (t == null) throw Error("[lucide]: iconNode is required when icon name is used");
	return {
		name: gt(e),
		size: 24,
		node: t,
		...n.length > 0 ? { aliases: n } : {}
	};
}
// node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
var vt = (e) => {
	let t = "", n = !1;
	for (let r of e) r === "-" || r === "_" || r <= " " ? n = t.length > 0 : (t.length === 0 ? t += r.toLowerCase() : t += n ? r.toUpperCase() : r, n = !1);
	return t;
}, yt = (e) => {
	let t = vt(e);
	return t.charAt(0).toUpperCase() + t.slice(1);
}, bt = (...e) => e.filter((e, t, n) => !!e && e.trim() !== "" && n.indexOf(e) === t).join(" ").trim(), xt = {
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
function St(e) {
	return e != null;
}
function Ct(e, t = {}) {
	let n = t.attributeNames ?? {}, r = (e) => n[e] ?? e, i = e.size ?? e.width ?? xt.width, a = e.size ?? e.height ?? xt.height, o = e.aliases?.filter((e) => typeof e == "string" && e.trim() !== "").map((e) => `lucide-${e}`) ?? [], s = [...e.name ? [`lucide-${e.name}`] : [], ...o], c = t.className?.split(" ").filter(Boolean) ?? [], l = t.includeDefaultClasses === !1 ? bt(...c) : bt("lucide", ...s, ...c), u = t.absoluteStrokeWidth ? Number(t.strokeWidth ?? xt["stroke-width"]) * Number(e.size ?? e.width ?? xt.width) / Number(t.size ?? t.width ?? xt.width) : t.strokeWidth ?? xt["stroke-width"];
	return [
		"svg",
		{
			...Object.entries(xt).reduce((e, [t, n]) => (e[r(t)] = n, e), {}),
			..."color" in t && t.color && { [r("stroke")]: t.color },
			..."size" in t && St(t.size) && {
				[r("width")]: t.size,
				[r("height")]: t.size
			},
			..."width" in t && St(t.width) && { [r("width")]: t.width },
			..."height" in t && St(t.height) && { [r("height")]: t.height },
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
function wt(e, t = {}) {
	return Ct(e, {
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
var Tt = (e) => {
	for (let t in e) if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
	return !1;
}, Et = o({}), Dt = () => u(Et), Ot = c(({ color: e, size: t, width: n, height: r, strokeWidth: i, absoluteStrokeWidth: a, nonScalingStroke: o, className: c = "", children: l, iconNode: u = [], icon: d = {
	node: u,
	aliases: [],
	size: 24
}, ...f }, p) => {
	let { size: m = 24, strokeWidth: h = 2, absoluteStrokeWidth: g = !1, nonScalingStroke: _ = !1, color: v = "currentColor", className: y = "" } = Dt() ?? {}, b = !!l || Tt(f), [x, S, C = []] = wt(d, {
		color: e ?? v,
		width: n ?? t ?? m,
		height: r ?? t ?? m,
		strokeWidth: i ?? h,
		absoluteStrokeWidth: a ?? g,
		nonScalingStroke: o ?? _,
		className: bt(y, c),
		hasA11yProp: b,
		attributes: f
	});
	return s(x, {
		ref: p,
		...S
	}, [...C.map(([e, t]) => s(e, t)), ...Array.isArray(l) ? l : [l]]);
});
// node_modules/lucide-react/dist/esm/createLucideIcon.mjs
function W(e, t = [], n = []) {
	let r = typeof e == "string" ? _t(e, t, n) : e, i = c(({ className: e, ...t }, n) => s(Ot, {
		ref: n,
		icon: r,
		className: e,
		...t
	}));
	return r.name && (i.displayName = yt(r.name)), i;
}
// node_modules/lucide-react/dist/esm/icons/activity.mjs
var kt = {
	name: "activity",
	size: 24,
	node: [["path", {
		d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
		key: "169zse"
	}]]
};
kt.node;
var At = W(kt), jt = {
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
jt.node;
var Mt = W(jt), Nt = {
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
Nt.node;
var Pt = W(Nt), Ft = {
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
Ft.node;
var It = W(Ft), Lt = {
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
Lt.node;
var Rt = W(Lt), zt = {
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
zt.node;
var Bt = W(zt), Vt = {
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
Vt.node;
var Ht = W(Vt), Ut = {
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
Ut.node;
var Wt = W(Ut), Gt = {
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
Gt.node;
var Kt = W(Gt), qt = {
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
qt.node;
var Jt = W(qt), Yt = {
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
Yt.node;
var Xt = W(Yt), Zt = {
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
Zt.node;
var Qt = W(Zt), $t = {
	name: "book",
	size: 24,
	node: [["path", {
		d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",
		key: "k3hazp"
	}]]
};
$t.node;
var en = W($t), tn = {
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
tn.node;
var nn = W(tn), rn = {
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
rn.node;
var an = W(rn), on = {
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
on.node;
var sn = W(on), cn = {
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
cn.node;
var ln = W(cn), un = {
	name: "check",
	size: 24,
	node: [["path", {
		d: "M20 6 9 17l-5-5",
		key: "1gmf2c"
	}]]
};
un.node;
var dn = W(un), fn = {
	name: "chevron-down",
	size: 24,
	node: [["path", {
		d: "m6 9 6 6 6-6",
		key: "qrunsl"
	}]]
};
fn.node;
var pn = W(fn), mn = {
	name: "chevron-left",
	size: 24,
	node: [["path", {
		d: "m15 18-6-6 6-6",
		key: "1wnfg3"
	}]]
};
mn.node;
var hn = W(mn), gn = {
	name: "chevron-right",
	size: 24,
	node: [["path", {
		d: "m9 18 6-6-6-6",
		key: "mthhwq"
	}]]
};
gn.node;
var _n = W(gn), vn = {
	name: "chevron-up",
	size: 24,
	node: [["path", {
		d: "m18 15-6-6-6 6",
		key: "153udz"
	}]]
};
vn.node;
var yn = W(vn), bn = {
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
bn.node;
var xn = W(bn), Sn = {
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
Sn.node;
var Cn = W(Sn), wn = {
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
wn.node;
var Tn = W(wn), En = {
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
En.node;
var Dn = W(En), On = {
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
On.node;
var kn = W(On), An = {
	name: "cloud",
	size: 24,
	node: [["path", {
		d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",
		key: "p7xjir"
	}]]
};
An.node;
var jn = W(An), Mn = {
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
Mn.node;
var Nn = W(Mn), Pn = {
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
Pn.node;
var Fn = W(Pn), In = {
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
In.node;
var Ln = W(In), Rn = {
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
Rn.node;
var zn = W(Rn), Bn = {
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
Bn.node;
var Vn = W(Bn), Hn = {
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
Hn.node;
var Un = W(Hn), Wn = {
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
Wn.node;
var Gn = W(Wn), Kn = {
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
Kn.node;
var qn = W(Kn), Jn = {
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
Jn.node;
var Yn = W(Jn), Xn = {
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
Xn.node;
var Zn = W(Xn), Qn = {
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
Qn.node;
var $n = W(Qn), er = {
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
er.node;
var tr = W(er), nr = {
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
nr.node;
var rr = W(nr), ir = {
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
ir.node;
var ar = W(ir), or = {
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
or.node;
var sr = W(or), cr = {
	name: "flag",
	size: 24,
	node: [["path", {
		d: "M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528",
		key: "1jaruq"
	}]]
};
cr.node;
var lr = W(cr), ur = {
	name: "folder-open",
	size: 24,
	node: [["path", {
		d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
		key: "usdka0"
	}]]
};
ur.node;
var dr = W(ur), fr = {
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
fr.node;
var pr = W(fr), mr = {
	name: "folder",
	size: 24,
	node: [["path", {
		d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
		key: "1kt360"
	}]]
};
mr.node;
var hr = W(mr), gr = {
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
gr.node;
var _r = W(gr), vr = {
	name: "funnel",
	size: 24,
	node: [["path", {
		d: "M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z",
		key: "sc7q7i"
	}]],
	aliases: ["filter"]
};
vr.node;
var yr = W(vr), br = {
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
br.node;
var xr = W(br), Sr = {
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
Sr.node;
var Cr = W(Sr), wr = {
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
wr.node;
var Tr = W(wr), Er = {
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
Er.node;
var Dr = W(Er), Or = {
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
Or.node;
var kr = W(Or), Ar = {
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
Ar.node;
var jr = W(Ar), Mr = {
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
Mr.node;
var Nr = W(Mr), Pr = {
	name: "headphones",
	size: 24,
	node: [["path", {
		d: "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
		key: "1xhozi"
	}]]
};
Pr.node;
var Fr = W(Pr), Ir = {
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
Ir.node;
var Lr = W(Ir), Rr = {
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
Rr.node;
var zr = W(Rr), Br = {
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
Br.node;
var Vr = W(Br), Hr = {
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
Hr.node;
var Ur = W(Hr), Wr = {
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
Wr.node;
var Gr = W(Wr), Kr = {
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
Kr.node;
var qr = W(Kr), Jr = {
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
Jr.node;
var Yr = W(Jr), Xr = {
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
Xr.node;
var Zr = W(Xr), Qr = {
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
Qr.node;
var $r = W(Qr), ei = {
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
ei.node;
var ti = W(ei), ni = {
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
ni.node;
var ri = W(ni), ii = {
	name: "loader-circle",
	size: 24,
	node: [["path", {
		d: "M21 12a9 9 0 1 1-6.219-8.56",
		key: "13zald"
	}]],
	aliases: ["loader-2"]
};
ii.node;
var ai = W(ii), oi = {
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
oi.node;
var si = W(oi), ci = {
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
ci.node;
var li = W(ci), ui = {
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
ui.node;
var di = W(ui), fi = {
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
fi.node;
var pi = W(fi), mi = {
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
mi.node;
var hi = W(mi), gi = {
	name: "message-square",
	size: 24,
	node: [["path", {
		d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
		key: "18887p"
	}]]
};
gi.node;
var _i = W(gi), vi = {
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
vi.node;
var yi = W(vi), bi = {
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
bi.node;
var xi = W(bi), Si = {
	name: "minus",
	size: 24,
	node: [["path", {
		d: "M5 12h14",
		key: "1ays0h"
	}]]
};
Si.node;
var Ci = W(Si), wi = {
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
wi.node;
var Ti = W(wi), Ei = {
	name: "moon",
	size: 24,
	node: [["path", {
		d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401",
		key: "kfwtm"
	}]]
};
Ei.node;
var Di = W(Ei), Oi = {
	name: "mouse-pointer-2",
	size: 24,
	node: [["path", {
		d: "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z",
		key: "edeuup"
	}]]
};
Oi.node;
var ki = W(Oi), Ai = {
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
Ai.node;
var ji = W(Ai), Mi = {
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
Mi.node;
var Ni = W(Mi), Pi = {
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
Pi.node;
var Fi = W(Pi), Ii = {
	name: "paperclip",
	size: 24,
	node: [["path", {
		d: "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551",
		key: "1miecu"
	}]]
};
Ii.node;
var Li = W(Ii), Ri = {
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
Ri.node;
var zi = W(Ri), Bi = {
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
Bi.node;
var Vi = W(Bi), Hi = {
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
Hi.node;
var Ui = W(Hi), Wi = {
	name: "play",
	size: 24,
	node: [["path", {
		d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",
		key: "10ikf1"
	}]]
};
Wi.node;
var Gi = W(Wi), Ki = {
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
Ki.node;
var qi = W(Ki), Ji = {
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
Ji.node;
var Yi = W(Ji), Xi = {
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
Xi.node;
var Zi = W(Xi), Qi = {
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
Qi.node;
var $i = W(Qi), ea = {
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
ea.node;
var ta = W(ea), na = {
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
na.node;
var ra = W(na), ia = {
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
ia.node;
var aa = W(ia), oa = {
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
oa.node;
var sa = W(oa), ca = {
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
ca.node;
var la = W(ca), ua = {
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
ua.node;
var da = W(ua), fa = {
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
fa.node;
var pa = W(fa), ma = {
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
ma.node;
var ha = W(ma), ga = {
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
ga.node;
var _a = W(ga), va = {
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
va.node;
var ya = W(va), ba = {
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
ba.node;
var xa = W(ba), Sa = {
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
Sa.node;
var Ca = W(Sa), wa = {
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
wa.node;
var Ta = W(wa), Ea = {
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
Ea.node;
var Da = W(Ea), Oa = {
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
Oa.node;
var ka = W(Oa), Aa = {
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
Aa.node;
var ja = W(Aa), Ma = {
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
Ma.node;
var Na = W(Ma), Pa = {
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
Pa.node;
var Fa = W(Pa), Ia = {
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
Ia.node;
var La = W(Ia), Ra = {
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
Ra.node;
var za = W(Ra), Ba = {
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
Ba.node;
var Va = W(Ba), Ha = {
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
Ha.node;
var Ua = W(Ha), Wa = {
	name: "thermometer",
	size: 24,
	node: [["path", {
		d: "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z",
		key: "17jzev"
	}]]
};
Wa.node;
var Ga = W(Wa), Ka = {
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
Ka.node;
var qa = W(Ka), Ja = {
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
Ja.node;
var Ya = W(Ja), Xa = {
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
Xa.node;
var Za = W(Xa), Qa = {
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
Qa.node;
var $a = W(Qa), eo = {
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
eo.node;
var to = W(eo), no = {
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
no.node;
var ro = W(no), io = {
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
io.node;
var ao = W(io), oo = {
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
oo.node;
var so = W(oo), co = {
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
co.node;
var lo = W(co), uo = {
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
uo.node;
var fo = W(uo), po = {
	name: "wrench",
	size: 24,
	node: [["path", {
		d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",
		key: "1ngwbx"
	}]]
};
po.node;
var mo = W(po), ho = {
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
ho.node;
var go = W(ho), _o = {
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
_o.node;
var vo = W(_o), yo = {
	name: "zap",
	size: 24,
	node: [["path", {
		d: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z",
		key: "1v7up4"
	}]]
};
yo.node;
var bo = W(yo), xo = {
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
xo.node;
var So = W(xo), Co = {
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
Co.node;
var wo = W(Co), To = {
	arcee: "M11.6967 0L0 20.1629H2.71067L13.0706 2.33934L11.6967 0Z M15.2983 6.23825L4.0472 20.2H7.05492L16.5237 8.42907L15.2983 6.23825Z M20.0163 14.3329L18.828 12.2906L8.35669 20.1627H12.2556L20.0163 14.3329Z M22.1672 18.0466L13.8866 20.1631H23.4297L22.1672 18.0466Z",
	chatGpt: "M9.205 8.658V6.398C9.205 6.208 9.277 6.065 9.443 5.97L13.986 3.354C14.605 2.997 15.342 2.831 16.103 2.831C18.957 2.831 20.765 5.043 20.765 7.397C20.765 7.564 20.765 7.754 20.741 7.944L16.031 5.185C15.903 5.10392 15.7545 5.06088 15.603 5.06088C15.4515 5.06088 15.303 5.10392 15.175 5.185L9.205 8.658ZM19.814 17.458V12.06C19.814 11.727 19.671 11.49 19.385 11.323L13.415 7.85L15.365 6.732C15.4355 6.68513 15.5183 6.66013 15.603 6.66013C15.6877 6.66013 15.7705 6.68513 15.841 6.732L20.384 9.349C21.693 10.109 22.573 11.727 22.573 13.297C22.573 15.105 21.503 16.77 19.813 17.46L19.814 17.458ZM7.802 12.703L5.852 11.561C5.77505 11.5204 5.71152 11.4584 5.66911 11.3824C5.62669 11.3064 5.6072 11.2198 5.613 11.133V5.899C5.613 3.354 7.563 1.427 10.204 1.427C11.204 1.427 12.131 1.76 12.916 2.355L8.23 5.067C7.945 5.233 7.802 5.471 7.802 5.804V12.703ZM12 15.128L9.205 13.558V10.228L12 8.658L14.795 10.228V13.558L12 15.128ZM13.796 22.358C12.796 22.358 11.869 22.026 11.084 21.431L15.77 18.719C16.055 18.553 16.198 18.315 16.198 17.982V11.084L18.172 12.226C18.339 12.321 18.41 12.464 18.41 12.654V17.887C18.41 20.432 16.436 22.358 13.796 22.358ZM8.159 17.055L3.615 14.438C2.307 13.677 1.427 12.06 1.427 10.49C1.42365 9.59786 1.68673 8.72504 2.18255 7.98336C2.67837 7.24169 3.38434 6.66493 4.21 6.327V11.75C4.21 12.083 4.353 12.321 4.638 12.488L10.585 15.937L8.635 17.055C8.56447 17.1019 8.48168 17.1269 8.397 17.1269C8.31232 17.1269 8.22953 17.1019 8.159 17.055ZM7.897 20.955C5.209 20.955 3.235 18.934 3.235 16.436C3.235 16.246 3.259 16.056 3.282 15.866L7.968 18.576C8.0956 18.6582 8.24419 18.702 8.396 18.702C8.54781 18.702 8.6964 18.6582 8.824 18.576L14.794 15.128V17.388C14.794 17.578 14.724 17.721 14.557 17.816L10.014 20.432C9.395 20.789 8.658 20.955 7.897 20.955ZM13.796 23.785C15.1664 23.7845 16.4947 23.3111 17.5563 22.4445C18.618 21.578 19.348 20.3715 19.623 19.029C22.287 18.339 24 15.84 24 13.296C24 11.631 23.287 10.014 22.002 8.848C22.121 8.348 22.192 7.849 22.192 7.35C22.192 3.949 19.433 1.403 16.246 1.403C15.6064 1.40012 14.9708 1.50492 14.366 1.713C13.2561 0.620228 11.7625 0.00535575 10.205 0C8.83445 0.000500422 7.50609 0.474136 6.44441 1.34087C5.38272 2.2076 4.6528 3.41428 4.378 4.757C1.713 5.447 0 7.945 0 10.49C0 12.156 0.713 13.773 1.998 14.938C1.879 15.438 1.808 15.938 1.808 16.437C1.808 19.838 4.567 22.383 7.754 22.383C8.396 22.383 9.014 22.288 9.634 22.074C10.7441 23.167 12.2381 23.7819 13.796 23.787V23.785Z",
	discord: "M19.2701 5.33C17.9401 4.71 16.5001 4.26 15.0001 4C14.9737 4.00038 14.9486 4.01116 14.9301 4.03C14.7501 4.36 14.5401 4.79 14.4001 5.12C12.8091 4.88015 11.1911 4.88015 9.60012 5.12C9.46012 4.78 9.25012 4.36 9.06012 4.03C9.05012 4.01 9.02012 4 8.99012 4C7.49012 4.26 6.06012 4.71 4.72012 5.33C4.71012 5.33 4.70012 5.34 4.69012 5.35C1.97012 9.42 1.22012 13.38 1.59012 17.3C1.59012 17.32 1.60012 17.34 1.62012 17.35C3.42012 18.67 5.15012 19.47 6.86012 20C6.89012 20.01 6.92012 20 6.93012 19.98C7.33012 19.43 7.69012 18.85 8.00012 18.24C8.02012 18.2 8.00012 18.16 7.96012 18.15C7.39012 17.93 6.85012 17.67 6.32012 17.37C6.28012 17.35 6.28012 17.29 6.31012 17.26C6.42012 17.18 6.53012 17.09 6.64012 17.01C6.66012 16.99 6.69012 16.99 6.71012 17C10.1501 18.57 13.8601 18.57 17.2601 17C17.2801 16.99 17.3101 16.99 17.3301 17.01C17.4401 17.1 17.5501 17.18 17.6601 17.27C17.7001 17.3 17.7001 17.36 17.6501 17.38C17.1301 17.69 16.5801 17.94 16.0101 18.16C15.9701 18.17 15.9601 18.22 15.9701 18.25C16.2901 18.86 16.6501 19.44 17.0401 19.99C17.0701 20 17.1001 20.01 17.1301 20C18.8501 19.47 20.5801 18.67 22.3801 17.35C22.4001 17.34 22.4101 17.32 22.4101 17.3C22.8501 12.77 21.6801 8.84 19.3101 5.35C19.3001 5.34 19.2901 5.33 19.2701 5.33ZM8.52012 14.91C7.49012 14.91 6.63012 13.96 6.63012 12.79C6.63012 11.62 7.47012 10.67 8.52012 10.67C9.58012 10.67 10.4201 11.63 10.4101 12.79C10.4101 13.96 9.57012 14.91 8.52012 14.91ZM15.4901 14.91C14.4601 14.91 13.6001 13.96 13.6001 12.79C13.6001 11.62 14.4401 10.67 15.4901 10.67C16.5501 10.67 17.3901 11.63 17.3801 12.79C17.3801 13.96 16.5501 14.91 15.4901 14.91Z",
	github: "M12 2C10.6868 2 9.38642 2.25866 8.17317 2.7612C6.95991 3.26375 5.85752 4.00035 4.92893 4.92893C3.05357 6.8043 2 9.34784 2 12C2 16.42 4.87 20.17 8.84 21.5C9.34 21.58 9.5 21.27 9.5 21V19.31C6.73 19.91 6.14 17.97 6.14 17.97C5.68 16.81 5.03 16.5 5.03 16.5C4.12 15.88 5.1 15.9 5.1 15.9C6.1 15.97 6.63 16.93 6.63 16.93C7.5 18.45 8.97 18 9.54 17.76C9.63 17.11 9.89 16.67 10.17 16.42C7.95 16.17 5.62 15.31 5.62 11.5C5.62 10.39 6 9.5 6.65 8.79C6.55 8.54 6.2 7.5 6.75 6.15C6.75 6.15 7.59 5.88 9.5 7.17C10.29 6.95 11.15 6.84 12 6.84C12.85 6.84 13.71 6.95 14.5 7.17C16.41 5.88 17.25 6.15 17.25 6.15C17.8 7.5 17.45 8.54 17.35 8.79C18 9.5 18.38 10.39 18.38 11.5C18.38 15.32 16.04 16.16 13.81 16.41C14.17 16.72 14.5 17.33 14.5 18.26V21C14.5 21.27 14.66 21.59 15.17 21.5C19.14 20.16 22 16.42 22 12C22 10.6868 21.7413 9.38642 21.2388 8.17317C20.7362 6.95991 19.9997 5.85752 19.0711 4.92893C18.1425 4.00035 17.0401 3.26375 15.8268 2.7612C14.6136 2.25866 13.3132 2 12 2Z",
	google: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z",
	javascript: "M6 3C5.20435 3 4.44129 3.31607 3.87868 3.87868C3.31607 4.44129 3 5.20435 3 6V18C3 18.7956 3.31607 19.5587 3.87868 20.1213C4.44129 20.6839 5.20435 21 6 21H18C18.7956 21 19.5587 20.6839 20.1213 20.1213C20.6839 19.5587 21 18.7956 21 18V6C21 5.20435 20.6839 4.44129 20.1213 3.87868C19.5587 3.31607 18.7956 3 18 3H6ZM13.334 16.055C14.054 16.635 14.7727 16.921 15.49 16.913C15.93 16.913 16.2673 16.8323 16.502 16.671C16.6113 16.6001 16.7002 16.5019 16.76 16.3862C16.8197 16.2705 16.8484 16.1412 16.843 16.011C16.8445 15.869 16.8149 15.7285 16.7561 15.5992C16.6974 15.47 16.611 15.3552 16.503 15.263C16.2683 15.0583 15.8243 14.853 15.171 14.647C14.3863 14.4203 13.7813 14.127 13.356 13.767C12.9387 13.407 12.726 12.9047 12.718 12.26C12.718 11.6513 12.982 11.1417 13.51 10.731C14.0233 10.3203 14.68 10.115 15.48 10.115C16.5947 10.115 17.489 10.3863 18.163 10.929L17.393 12.128C17.1157 11.9124 16.7977 11.7553 16.458 11.666C16.1528 11.5637 15.8338 11.5081 15.512 11.501C15.132 11.501 14.8277 11.5707 14.599 11.71C14.3723 11.85 14.259 12.0333 14.259 12.26C14.259 12.5093 14.398 12.722 14.676 12.898C14.956 13.0673 15.4327 13.2543 16.106 13.459C16.92 13.701 17.4993 14.0237 17.844 14.427C18.1887 14.8303 18.361 15.3437 18.361 15.967C18.361 16.605 18.1153 17.155 17.624 17.617C17.14 18.0717 16.436 18.31 15.512 18.332C14.302 18.332 13.29 17.969 12.476 17.243L13.334 16.055ZM7.804 16.693C8.03867 16.8397 8.321 16.913 8.651 16.913C8.99567 16.913 9.28167 16.814 9.509 16.616C9.73567 16.4107 9.84933 16.055 9.85 15.549V10.247H11.335V15.835C11.313 16.7003 11.0637 17.3237 10.587 17.705C10.3262 17.9255 10.0229 18.0902 9.696 18.189C9.39282 18.2813 9.07792 18.3295 8.761 18.332C8.211 18.332 7.72333 18.2367 7.298 18.046C6.84333 17.8413 6.462 17.4783 6.154 16.957L7.188 16.11C7.378 16.3667 7.58333 16.561 7.804 16.693Z",
	python: "M21.5694 9.42899C21.2154 8.07399 20.5694 7.00899 19.2144 7.00899H17.4094V9.13899C17.4094 10.784 15.9894 12.171 14.4734 12.171H9.66441C8.34241 12.171 7.30941 13.301 7.30941 14.623V19.173C7.30941 20.43 8.43941 21.205 9.66441 21.624C11.1494 22.076 12.6004 22.173 14.4394 21.624C15.6334 21.269 16.7954 20.592 16.7954 19.172V17.365H12.0524V16.785H19.2144C20.5694 16.785 21.1184 15.817 21.5694 14.365C22.0534 12.784 22.0534 11.332 21.5694 9.42899ZM14.7294 18.462C15.2144 18.462 15.6334 18.882 15.6334 19.366C15.6334 19.85 15.2134 20.269 14.7304 20.269C14.2464 20.301 13.8264 19.849 13.8264 19.366C13.7944 18.882 14.2134 18.462 14.7304 18.462M9.44041 11.558H14.2154C15.5374 11.558 16.5704 10.461 16.5704 9.10599V4.62099C16.5704 3.36299 15.4734 2.39499 14.2144 2.16899C12.6344 1.94399 10.8914 1.94399 9.44041 2.16899C7.40741 2.52399 7.08441 3.26599 7.08441 4.62099V6.42799H11.8594V7.00799H5.34141C3.98641 7.00799 2.76041 7.87999 2.40541 9.42799C1.95341 11.235 1.95341 12.364 2.40541 14.236C2.76041 15.656 3.53541 16.656 4.95441 16.656H6.50341V14.494C6.47041 12.913 7.85841 11.558 9.43941 11.558M9.14941 5.20199C8.91134 5.19715 8.68436 5.10048 8.5159 4.93221C8.34743 4.76393 8.25052 4.53705 8.24541 4.29899C8.24541 3.81499 8.66541 3.39499 9.14841 3.39499C9.63141 3.39499 10.0524 3.81499 10.0524 4.29899C10.0524 4.78299 9.63341 5.20199 9.14941 5.20199Z"
}, G = /* @__PURE__ */ function(e) {
	return e.Checklist = "checklist", e.Features = "features", e.Publish = "publish", e.Toolbox = "toolbox", e.Play = "play", e.Add = "add", e.Chat = "chat", e.Home = "home", e.Coursor = "coursor", e.Hand = "hand", e.Order = "order", e.ZoomIn = "zoomIn", e.ZoomOut = "zoomOut", e.TurnLeft = "turnLeft", e.TurnRight = "turnRight", e.History = "history", e.Env = "env", e.AddNote = "addNote", e.Controls = "controls", e.ArrowLeft = "arrowLeft", e.Down = "down", e.Left = "left", e.ArrowRight = "arrowRight", e.Right = "right", e.Top = "top", e.Grid = "grid", e.ArrowTop = "arrowTop", e.Trash = "trash", e.ArrowDown = "arrowDown", e.Close = "close", e.Hamburger = "hamburger", e.BookOpen = "bookOpen", e.Ai = "ai", e.Book = "book", e.FileCopy = "fileCopy", e.FileCopyFilled = "fileCopyFilled", e.FileUpload = "fileUpload", e.Search = "search", e.PlayHistory = "playHistory", e.MenuHorizontal = "menuHorizontal", e.HideSidebar = "hideSidebar", e.MenuVertical = "menuVertical", e.Tag = "tag", e.TagAdd = "tagAdd", e.Moon = "moon", e.Sun = "sun", e.Desktop = "desktop", e.DoubleArrowsVertical = "doubleArrowsVertical", e.FinanceMode = "financeMode", e.Refresh = "refresh", e.Info = "info", e.FolderCopy = "folderCopy", e.Important = "important", e.Globe = "globe", e.Filter = "filter", e.Microphone = "microphone", e.Image = "image", e.Attachment = "attachment", e.Plane = "plane", e.PlaneAdd = "planeAdd", e.Headphones = "headphones", e.Bolt = "bolt", e.Private = "private", e.Scheme = "scheme", e.Repair = "repair", e.Flow = "flow", e.Folder = "folder", e.Folders = "folders", e.Edit = "edit", e.AddCircle = "addCircle", e.Loader = "loader", e.Gear = "gear", e.Exit = "exit", e.Archive = "archive", e.FolderOpen = "folderOpen", e.Flag = "flag", e.DoubleArrowHorizontal = "doubleArrowHorizontal", e.Code = "code", e.List = "list", e.UserData = "userData", e.Text = "text", e.Check = "check", e.FullScreen = "fullScreen", e.Function = "function", e.Combine = "combine", e.Danger = "danger", e.Download = "download", e.Stop = "stop", e.Pause = "pause", e.JSON = "code", e.File = "attachment", e.Remove = "remove", e.AddBox = "addBox", e.Layers = "layers", e.Eye = "eye", e.EyeStrikethrough = "eyeStrikethrough", e.BoltStrikethrough = "boltStrikethrough", e.Drag = "drag", e.Lock = "lock", e.Javascript = "javascript", e.Python = "python", e.FullScreenExit = "fullScreenExit", e.Person = "person", e.People = "people", e.Group = "group", e.Arcee = "arcee", e.Cart = "cart", e.Google = "google", e.Timelaps = "timelaps", e.Token = "token", e.LeftSidebar = "leftSidebar", e.ShowSidePanel = "showSidePanel", e.HideSidePanel = "hideSidePanel", e.Money = "money", e.AddCreditCard = "addCreditCard", e.External = "external", e.ScreenView = "screenView", e.Activity = "activity", e.Purchase = "purchase", e.Key = "key", e.Discord = "discord", e.Dollar = "dollar", e.Temperature = "temperature", e.CheckCircle = "checkCircle", e.Server = "server", e.Retry = "retry", e.Provider = "provider", e.Github = "github", e.Price = "price", e.Calendar = "calendar", e.Terminal = "terminal", e.Chunk = "chunk", e.Markdown = "markdown", e.String = "string", e.Brain = "brain", e.SearchPage = "searchPage", e.Pin = "pin", e.Unpin = "unpin", e.ChatGpt = "chatGpt", e.Robot = "robot", e.ReadFile = "readFile", e.SearchFile = "searchFile", e.SearchFiles = "searchFiles", e.WriteCommand = "writeCommand", e.Clock = "clock", e.AddChat = "addChat", e.Goal = "goal", e;
}({}), Eo = {
	checklist: Zr,
	features: Yr,
	publish: Jt,
	toolbox: Ya,
	play: Gi,
	add: qi,
	chat: _i,
	home: Lr,
	coursor: ki,
	hand: jr,
	order: ti,
	zoomIn: So,
	zoomOut: wo,
	turnLeft: ro,
	turnRight: Yi,
	history: $i,
	env: lo,
	addNote: tr,
	controls: ya,
	arrowLeft: Ht,
	down: pn,
	left: hn,
	arrowRight: Wt,
	right: _n,
	top: yn,
	grid: qr,
	arrowTop: Xt,
	trash: Za,
	arrowDown: Rt,
	close: go,
	hamburger: pi,
	bookOpen: Qt,
	ai: xa,
	book: en,
	fileCopy: zn,
	fileCopyFilled: zn,
	fileUpload: sr,
	search: sa,
	playHistory: Tn,
	menuHorizontal: Yn,
	hideSidebar: $r,
	menuVertical: qn,
	tag: La,
	tagAdd: za,
	moon: Di,
	sun: Fa,
	desktop: Ti,
	doubleArrowsVertical: It,
	financeMode: ln,
	refresh: Zi,
	info: Vr,
	folderCopy: _r,
	important: xn,
	globe: Cr,
	filter: yr,
	microphone: yi,
	image: zr,
	attachment: Li,
	plane: la,
	planeAdd: W("send-plus", [
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
	headphones: Fr,
	bolt: bo,
	private: ha,
	scheme: xr,
	repair: mo,
	flow: fo,
	folder: hr,
	folders: _r,
	edit: Da,
	addCircle: Dn,
	loader: ai,
	gear: pa,
	exit: li,
	archive: Pt,
	folderOpen: dr,
	flag: lr,
	doubleArrowHorizontal: Bt,
	code: Ca,
	list: ri,
	userData: Ln,
	text: ar,
	check: dn,
	fullScreen: di,
	function: Ta,
	combine: Fn,
	danger: $a,
	download: Gn,
	stop: Na,
	pause: zi,
	remove: Ci,
	addBox: ka,
	layers: Gr,
	eye: $n,
	eyeStrikethrough: Zn,
	boltStrikethrough: vo,
	drag: Dr,
	lock: si,
	fullScreenExit: xi,
	person: ao,
	people: so,
	group: kr,
	cart: _a,
	timelaps: qa,
	token: Nn,
	leftSidebar: ji,
	showSidePanel: Fi,
	hideSidePanel: Ni,
	money: Vn,
	addCreditCard: Vn,
	external: Kt,
	screenView: Mt,
	activity: At,
	purchase: _a,
	key: Ur,
	dollar: Un,
	temperature: Ga,
	checkCircle: Cn,
	server: da,
	retry: ta,
	provider: jn,
	price: Un,
	calendar: sn,
	terminal: ja,
	chunk: ra,
	markdown: Nr,
	string: to,
	brain: an,
	searchPage: rr,
	pin: Ui,
	unpin: Vi,
	robot: nn,
	readFile: aa,
	searchFile: Ua,
	searchFiles: pr,
	writeCommand: Va,
	clock: kn,
	addChat: hi,
	goal: Tr
}, Do = ({ iconName: e = "checklist", color: t, size: n = 20, strokeWidth: r = 1.75, className: i = "", style: a, ...o }) => {
	let s = t ? {
		"--icon-color": t,
		...a
	} : a, c = Eo[e];
	return c ? /* @__PURE__ */ y(c, {
		className: `icon ${i}`,
		size: n,
		strokeWidth: r,
		style: s,
		...o
	}) : /* @__PURE__ */ y("svg", {
		className: `icon ${i}`,
		width: n,
		height: n,
		viewBox: "0 0 24 24",
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		style: s,
		...o,
		children: /* @__PURE__ */ y("path", {
			d: To[e] ?? "",
			fill: "currentColor"
		})
	});
};
Do.Name = G;
// src/app/atoms/loader/index.tsx
var Oo = /* @__PURE__ */ function(e) {
	return e[e.XSmall = 16] = "XSmall", e[e.Small = 20] = "Small", e[e.Medium = 24] = "Medium", e[e.MediumLarge = 28] = "MediumLarge", e[e.Large = 32] = "Large", e[e.X2Large = 36] = "X2Large", e[e.X3Large = 40] = "X3Large", e[e.XLarge = 48] = "XLarge", e;
}({}), K = /* @__PURE__ */ function(e) {
	return e.Brand = "var(--color-fill-accent-primary)", e.Neutral = "var(--color-fill-basic-tertiary)", e.Destructive = "var(--color-fill-error-primary)", e.OnPrimary = "var(--color-fill-btn-primary)", e;
}({}), ko = ({ size: e = 48, variant: t = "var(--color-fill-basic-tertiary)", className: n = "", ...r }) => /* @__PURE__ */ y("div", {
	className: U("loader flex size-fit", n),
	...r,
	children: /* @__PURE__ */ y(Do, {
		iconName: G.Loader,
		size: e,
		color: t
	})
});
ko.Size = Oo, ko.Variant = K;
// src/app/lib/anchor.ts
var Ao = /* @__PURE__ */ function(e) {
	return e.TopLeft = "top-left", e.TopCenter = "top-center", e.TopRight = "top-right", e.CenterRight = "center-right", e.RightTop = "right-top", e.BottomRight = "bottom-right", e.BottomCenter = "bottom-center", e.BottomLeft = "bottom-left", e.CenterLeft = "center-left", e;
}({}), jo = {
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
function Mo(e) {
	let t = [];
	for (let n = e?.parentElement ?? null; n; n = n.parentElement) {
		let e = window.getComputedStyle(n);
		(e.overflowX !== "visible" || e.overflowY !== "visible") && t.push(n);
	}
	return t;
}
// src/app/hooks/useMediaQuery.ts
function No(e) {
	let t = m(() => window.matchMedia(e), [e]), n = l((e) => (t.addEventListener("change", e), () => t.removeEventListener("change", e)), [t]), r = l(() => t.matches, [t]);
	return _(n, r, r);
}
var Po = () => No("(min-width: 1280px)"), Fo = () => No("(max-width: 767.98px)"), Io = () => No("(min-width: 768px) and (max-width: 1279.98px)"), Lo = Object.defineProperty, Ro = (e, t) => Lo(e, "name", {
	value: t,
	configurable: !0
});
function zo(e, t) {
	if (typeof e == "function") return e(t);
	e != null && (e.current = t);
}
Ro(zo, "setRef");
function Bo(...e) {
	return (t) => {
		let n = !1, r = e.map((e) => {
			let r = zo(e, t);
			return !n && typeof r == "function" && (n = !0), r;
		});
		if (n) return () => {
			for (let t = 0; t < r.length; t++) {
				let n = r[t];
				typeof n == "function" ? n() : zo(e[t], null);
			}
		};
	};
}
Ro(Bo, "composeRefs");
function Vo(...e) {
	return a.useCallback(Bo(...e), e);
}
Ro(Vo, "useComposedRefs");
// node_modules/@radix-ui/react-slot/dist/index.mjs
var Ho = Object.defineProperty, Uo = (e, t) => Ho(e, "name", {
	value: t,
	configurable: !0
});
// @__NO_SIDE_EFFECTS__
function Wo(e) {
	let t = a.forwardRef((t, n) => {
		let { children: r, ...i } = t, o = null, s = !1, c = [];
		r = ts(r), a.Children.forEach(r, (e) => {
			if (Zo(e)) {
				s = !0;
				let t = e, n = "child" in t.props ? t.props.child : t.props.children;
				for (; $o(n) && typeof as == "function";) n = as(n._payload);
				o = Jo(t, n), c.push(o?.props?.children);
			} else c.push(e);
		}), o ? o = a.cloneElement(o, void 0, c) : !s && a.Children.count(r) === 1 && a.isValidElement(r) && (o = r);
		let l = o ? Xo(o) : void 0, u = Vo(n, l);
		if (!o) {
			if (r || r === 0) throw Error(s ? is(e) : rs(e));
			return r;
		}
		let d = Yo(i, o.props ?? {});
		return o.type !== a.Fragment && (d.ref = n ? u : l), a.cloneElement(o, d);
	});
	return t.displayName = `${e}.Slot`, t;
}
Uo(Wo, "createSlot");
var Go = /* @__PURE__ */ Wo("Slot"), Ko = Symbol.for("radix.slottable");
// @__NO_SIDE_EFFECTS__
function qo(e) {
	let t = /* @__PURE__ */ Uo((e) => "child" in e ? e.children(e.child) : e.children, "Slottable");
	return t.displayName = `${e}.Slottable`, t.__radixId = Ko, t;
}
Uo(qo, "createSlottable");
var Jo = /* @__PURE__ */ Uo((e, t) => "child" in e.props ? a.isValidElement(t) ? a.cloneElement(t, void 0, e.props.children(t.props.children)) : null : a.isValidElement(t) ? t : null, "getSlottableElementFromSlottable");
function Yo(e, t) {
	let n = { ...t };
	for (let r in t) {
		let i = e[r], a = t[r];
		/^on[A-Z]/.test(r) ? i && a ? n[r] = (...e) => {
			let t = a(...e);
			return i(...e), t;
		} : i && (n[r] = i) : r === "style" ? n[r] = {
			...i,
			...a
		} : r === "className" ? n[r] = [i, a].filter(Boolean).join(" ") : r === "aria-describedby" && (n[r] = ns(a, i));
	}
	return {
		...e,
		...n
	};
}
Uo(Yo, "mergeProps");
function Xo(e) {
	let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning;
	return n ? e.ref : (t = Object.getOwnPropertyDescriptor(e, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning, n ? e.props.ref : e.props.ref || e.ref);
}
Uo(Xo, "getElementRef");
function Zo(e) {
	return a.isValidElement(e) && typeof e.type == "function" && "__radixId" in e.type && e.type.__radixId === Ko;
}
Uo(Zo, "isSlottable");
var Qo = Symbol.for("react.lazy");
function $o(e) {
	return typeof e == "object" && !!e && "$$typeof" in e && e.$$typeof === Qo && "_payload" in e && es(e._payload);
}
Uo($o, "isLazyComponent");
function es(e) {
	return typeof e == "object" && !!e && "then" in e;
}
Uo(es, "isPromiseLike");
function ts(e) {
	let t = e;
	for (; $o(t) && typeof as == "function";) t = as(t._payload);
	return t;
}
Uo(ts, "useUnwrappedLazy");
function ns(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
Uo(ns, "concatAriaDescribedby");
var rs = /* @__PURE__ */ Uo((e) => `${e} failed to slot onto its children. Expected a single React element child or \`Slottable\`.`, "createSlotError"), is = /* @__PURE__ */ Uo((e) => `${e} failed to slot onto its \`Slottable\`. Expected \`Slottable\` to receive a single React element child.`, "createSlottableError"), as = a.use, os = Object.defineProperty, ss = (e, t) => os(e, "name", {
	value: t,
	configurable: !0
}), cs = [
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
	let n = /* @__PURE__ */ Wo(`Primitive.${t}`), r = a.forwardRef((e, r) => {
		let { asChild: i, ...a } = e, o = i ? n : t;
		return typeof window < "u" && (window[Symbol.for("radix-ui")] = !0), /* @__PURE__ */ y(o, {
			...a,
			ref: r
		});
	});
	return r.displayName = `Primitive.${t}`, {
		...e,
		[t]: r
	};
}, {});
function ls(e, t) {
	e && S.flushSync(() => e.dispatchEvent(t));
}
ss(ls, "dispatchDiscreteCustomEvent");
// node_modules/@radix-ui/react-visually-hidden/dist/index.mjs
var us = Object.defineProperty, ds = (e, t) => us(e, "name", {
	value: t,
	configurable: !0
}), fs = Object.freeze({
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
}), ps = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ ds(function(e, t) {
	return /* @__PURE__ */ y(cs.span, {
		...e,
		ref: t,
		style: {
			...fs,
			...e.style
		}
	});
}, "VisuallyHidden")), ms = Object.defineProperty, hs = (e, t) => ms(e, "name", {
	value: t,
	configurable: !0
});
// @__NO_SIDE_EFFECTS__
function gs(e, t) {
	let n = a.createContext(t);
	n.displayName = e + "Context";
	let r = /* @__PURE__ */ hs((e) => {
		let { children: t, ...r } = e, i = a.useMemo(() => r, Object.values(r));
		return /* @__PURE__ */ y(n.Provider, {
			value: i,
			children: t
		});
	}, "Provider");
	r.displayName = e + "Provider";
	function i(r, i = {}) {
		let { optional: o = !1 } = i, s = a.useContext(n);
		if (s) return s;
		if (t !== void 0) return t;
		if (!o) throw Error(`\`${r}\` must be used within \`${e}\``);
	}
	return hs(i, "useContext"), [r, i];
}
hs(gs, "createContext");
// @__NO_SIDE_EFFECTS__
function _s(e, t = []) {
	let n = [];
	function r(t, r) {
		let i = a.createContext(r);
		i.displayName = t + "Context";
		let o = n.length;
		n = [...n, r];
		let s = /* @__PURE__ */ hs((t) => {
			let { scope: n, children: r, ...s } = t, c = n?.[e]?.[o] || i, l = a.useMemo(() => s, Object.values(s));
			return /* @__PURE__ */ y(c.Provider, {
				value: l,
				children: r
			});
		}, "Provider");
		s.displayName = t + "Provider";
		function c(n, s, c = {}) {
			let { optional: l = !1 } = c, u = s?.[e]?.[o] || i, d = a.useContext(u);
			if (d) return d;
			if (r !== void 0) return r;
			if (!l) throw Error(`\`${n}\` must be used within \`${t}\``);
		}
		return hs(c, "useContext"), [s, c];
	}
	hs(r, "createContext");
	let i = /* @__PURE__ */ hs(() => {
		let t = n.map((e) => a.createContext(e));
		return /* @__PURE__ */ hs(function(n) {
			let r = n?.[e] || t;
			return a.useMemo(() => ({ [`__scope${e}`]: {
				...n,
				[e]: r
			} }), [n, r]);
		}, "useScope");
	}, "createScope");
	return i.scopeName = e, [r, vs(i, ...t)];
}
hs(_s, "createContextScope");
function vs(...e) {
	let t = e[0];
	if (e.length === 1) return t;
	let n = /* @__PURE__ */ hs(() => {
		let n = e.map((e) => ({
			useScope: e(),
			scopeName: e.scopeName
		}));
		return /* @__PURE__ */ hs(function(e) {
			let r = n.reduce((t, { useScope: n, scopeName: r }) => {
				let i = n(e)[`__scope${r}`];
				return {
					...t,
					...i
				};
			}, {});
			return a.useMemo(() => ({ [`__scope${t.scopeName}`]: r }), [r]);
		}, "useComposedScopes");
	}, "createScope");
	return n.scopeName = t.scopeName, n;
}
hs(vs, "composeContextScopes");
// node_modules/@radix-ui/react-use-layout-effect/dist/index.mjs
var q = globalThis?.document ? a.useLayoutEffect : () => {}, ys = Object.defineProperty, bs = (e, t) => ys(e, "name", {
	value: t,
	configurable: !0
}), xs = !!(typeof window < "u" && window.document && window.document.createElement);
function J(e, t, { checkForDefaultPrevented: n = !0 } = {}) {
	return /* @__PURE__ */ bs(function(r) {
		if (e?.(r), n === !1 || !r || !r.defaultPrevented) return t?.(r);
	}, "handleEvent");
}
bs(J, "composeEventHandlers");
function Ss(e) {
	if (!xs) throw Error("Cannot access window outside of the DOM");
	return e?.ownerDocument?.defaultView ?? window;
}
bs(Ss, "getOwnerWindow");
function Cs(e) {
	if (!xs) throw Error("Cannot access document outside of the DOM");
	return e?.ownerDocument ?? document;
}
bs(Cs, "getOwnerDocument");
function ws(e, t = !1) {
	let { activeElement: n } = Cs(e);
	if (!n?.nodeName) return null;
	if (Ts(n) && n.contentDocument) return ws(n.contentDocument.body, t);
	if (t) {
		let e = n.getAttribute("aria-activedescendant");
		if (e) {
			let t = Cs(n).getElementById(e);
			if (t) return t;
		}
	}
	return n;
}
bs(ws, "getActiveElement");
function Ts(e) {
	return e.tagName === "IFRAME";
}
bs(Ts, "isFrame");
// node_modules/@radix-ui/react-use-effect-event/dist/index.mjs
var Es = Object.defineProperty, Ds = (e, t) => Es(e, "name", {
	value: t,
	configurable: !0
}), Os = a.useEffectEvent, ks = a.useInsertionEffect;
function As(e) {
	if (typeof Os == "function") return Os(e);
	let t = a.useRef(() => {
		throw Error("Cannot call an event handler while rendering.");
	});
	return typeof ks == "function" ? ks(() => {
		t.current = e;
	}) : q(() => {
		t.current = e;
	}), a.useMemo(() => ((...e) => t.current?.(...e)), []);
}
Ds(As, "useEffectEvent");
// node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
var js = Object.defineProperty, Ms = (e, t) => js(e, "name", {
	value: t,
	configurable: !0
}), Ns = a.useInsertionEffect || q;
function Ps({ prop: e, defaultProp: t, onChange: n = /* @__PURE__ */ Ms(() => {}, "onChange"), caller: r }) {
	let [i, o, s] = Fs({
		defaultProp: t,
		onChange: n
	}), c = e !== void 0;
	return [c ? e : i, a.useCallback((t) => {
		if (c) {
			let n = Is(t) ? t(e) : t;
			n !== e && s.current?.(n);
		} else o(t);
	}, [
		c,
		e,
		o,
		s
	])];
}
Ms(Ps, "useControllableState");
function Fs({ defaultProp: e, onChange: t }) {
	let [n, r] = a.useState(e), i = a.useRef(n), o = a.useRef(t);
	return Ns(() => {
		o.current = t;
	}, [t]), a.useEffect(() => {
		i.current !== n && (o.current?.(n), i.current = n);
	}, [n, i]), [
		n,
		r,
		o
	];
}
Ms(Fs, "useUncontrolledState");
function Is(e) {
	return typeof e == "function";
}
Ms(Is, "isFunction");
var Ls = Symbol("RADIX:SYNC_STATE");
function Rs(e, t, n, r) {
	let { prop: i, defaultProp: o, onChange: s, caller: c } = t, l = i !== void 0, u = As(s), d = [{
		...n,
		state: o
	}];
	r && d.push(r);
	let [f, p] = a.useReducer((t, n) => {
		if (n.type === Ls) return {
			...t,
			state: n.state
		};
		let r = e(t, n);
		return l && !Object.is(r.state, t.state) && u(r.state), r;
	}, ...d), m = f.state, h = a.useRef(m);
	a.useEffect(() => {
		h.current !== m && (h.current = m, l || u(m));
	}, [
		m,
		h,
		l
	]);
	let g = a.useMemo(() => i === void 0 ? f : {
		...f,
		state: i
	}, [f, i]);
	return a.useEffect(() => {
		l && !Object.is(i, f.state) && p({
			type: Ls,
			state: i
		});
	}, [
		i,
		f.state,
		l
	]), [g, p];
}
Ms(Rs, "useControllableStateReducer");
// node_modules/@radix-ui/react-presence/dist/index.mjs
var zs = Object.defineProperty, Bs = (e, t) => zs(e, "name", {
	value: t,
	configurable: !0
});
function Vs(e, t) {
	return a.useReducer((e, n) => t[e][n] ?? e, e);
}
Bs(Vs, "useStateMachine");
var Hs = /* @__PURE__ */ Bs((e) => {
	let { present: t, children: n } = e, r = Us(t), i = typeof n == "function" ? n({ present: r.isPresent }) : a.Children.only(n), o = Gs(r.ref, qs(i));
	return typeof n == "function" || r.isPresent ? a.cloneElement(i, { ref: o }) : null;
}, "Presence");
function Us(e) {
	let [t, n] = a.useState(), r = a.useRef(null), i = a.useRef(e), o = a.useRef("none"), s = a.useRef(void 0), [c, l] = Vs(e ? "mounted" : "unmounted", {
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
	return a.useEffect(() => {
		c === "mounted" ? (o.current = s.current ?? Ks(r.current), s.current = void 0) : o.current = "none";
	}, [c]), q(() => {
		let t = r.current, n = i.current;
		if (n !== e) {
			let r = o.current, a = Ks(t);
			e ? (s.current = a, l("MOUNT")) : a === "none" || t?.display === "none" ? l("UNMOUNT") : l(n && r !== a ? "ANIMATION_OUT" : "UNMOUNT"), i.current = e;
		}
	}, [e, l]), q(() => {
		if (t) {
			let e, n = t.ownerDocument.defaultView ?? window, a = /* @__PURE__ */ Bs((a) => {
				let o = Ks(r.current).includes(CSS.escape(a.animationName));
				if (a.target === t && o && (l("ANIMATION_END"), !i.current)) {
					let r = t.style.animationFillMode;
					t.style.animationFillMode = "forwards", e = n.setTimeout(() => {
						t.style.animationFillMode === "forwards" && (t.style.animationFillMode = r);
					});
				}
			}, "handleAnimationEnd"), s = /* @__PURE__ */ Bs((e) => {
				e.target === t && (o.current = Ks(r.current));
			}, "handleAnimationStart");
			return t.addEventListener("animationstart", s), t.addEventListener("animationcancel", a), t.addEventListener("animationend", a), () => {
				n.clearTimeout(e), t.removeEventListener("animationstart", s), t.removeEventListener("animationcancel", a), t.removeEventListener("animationend", a);
			};
		}
		l("ANIMATION_END");
	}, [t, l]), {
		isPresent: ["mounted", "unmountSuspended"].includes(c),
		ref: a.useCallback((e) => {
			if (e) {
				let t = getComputedStyle(e);
				r.current = t, s.current = Ks(t);
			} else r.current = null;
			n(e);
		}, [])
	};
}
Bs(Us, "usePresence");
function Ws(e, t) {
	if (typeof e == "function") return e(t);
	e != null && (e.current = t);
}
Bs(Ws, "setRef");
function Gs(...e) {
	let t = a.useRef(e);
	return t.current = e, a.useCallback((e) => {
		let n = t.current, r = !1, i = n.map((t) => {
			let n = Ws(t, e);
			return !r && typeof n == "function" && (r = !0), n;
		});
		if (r) return () => {
			for (let e = 0; e < i.length; e++) {
				let t = i[e];
				typeof t == "function" ? t() : Ws(n[e], null);
			}
		};
	}, []);
}
Bs(Gs, "useStableComposedRefs");
function Ks(e) {
	return e?.animationName || "none";
}
Bs(Ks, "getAnimationName");
function qs(e) {
	let t = Object.getOwnPropertyDescriptor(e.props, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning;
	return n ? e.ref : (t = Object.getOwnPropertyDescriptor(e, "ref")?.get, n = t && "isReactWarning" in t && t.isReactWarning, n ? e.props.ref : e.props.ref || e.ref);
}
Bs(qs, "getElementRef");
// node_modules/@radix-ui/react-id/dist/index.mjs
var Js = Object.defineProperty, Ys = (e, t) => Js(e, "name", {
	value: t,
	configurable: !0
}), Xs = a.useId || (() => void 0), Zs = 0;
function Qs(e) {
	let [t, n] = a.useState(Xs());
	return q(() => {
		e || n((e) => e ?? String(Zs++));
	}, [e]), e || (t ? `radix-${t}` : "");
}
Ys(Qs, "useId");
// node_modules/@radix-ui/react-use-callback-ref/dist/index.mjs
var $s = Object.defineProperty, ec = (e, t) => $s(e, "name", {
	value: t,
	configurable: !0
}), tc = a.useInsertionEffect;
function nc(e) {
	let t = a.useRef(e);
	return typeof tc == "function" ? tc(() => {
		t.current = e;
	}) : q(() => {
		t.current = e;
	}), a.useMemo(() => ((...e) => t.current?.(...e)), []);
}
ec(nc, "useCallbackRef");
// node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs
var rc = Object.defineProperty, Y = (e, t) => rc(e, "name", {
	value: t,
	configurable: !0
}), ic = "dismissableLayer.update", ac = "dismissableLayer.pointerDownOutside", oc = "dismissableLayer.focusOutside", sc, cc = a.createContext({
	layers: /* @__PURE__ */ new Set(),
	layersWithOutsidePointerEventsDisabled: /* @__PURE__ */ new Set(),
	branches: /* @__PURE__ */ new Set(),
	dismissableSurfaces: /* @__PURE__ */ new Set()
}), lc = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Y(function(e, t) {
	let { disableOutsidePointerEvents: n = !1, deferPointerDownOutside: r = !1, onEscapeKeyDown: i, onPointerDownOutside: o, onFocusOutside: s, onInteractOutside: c, onDismiss: l, ...u } = e, d = a.useContext(cc), [f, p] = a.useState(null), m = f?.ownerDocument ?? globalThis?.document, [, h] = a.useState({}), g = Vo(t, p), _ = Array.from(d.layers), [v] = [...d.layersWithOutsidePointerEventsDisabled].slice(-1), b = v ? _.indexOf(v) : -1, x = f ? _.indexOf(f) : -1, S = d.layersWithOutsidePointerEventsDisabled.size > 0, C = x >= b, w = a.useRef(!1), T = fc((e) => {
		o?.(e), c?.(e), e.defaultPrevented || l?.();
	}, {
		ownerDocument: m,
		deferPointerDownOutside: r,
		isDeferredPointerDownOutsideRef: w,
		dismissableSurfaces: d.dismissableSurfaces,
		shouldHandlePointerDownOutside: a.useCallback((e) => {
			if (!(e instanceof Node)) return !1;
			let t = [...d.branches].some((t) => t.contains(e));
			return C && !t;
		}, [d.branches, C])
	}), E = pc((e) => {
		if (r && w.current) return;
		let t = e.target;
		[...d.branches].some((e) => e.contains(t)) || (s?.(e), c?.(e), e.defaultPrevented || l?.());
	}, m), D = f ? x === _.length - 1 : !1, O = nc((e) => {
		e.key === "Escape" && (i?.(e), !e.defaultPrevented && l && (e.preventDefault(), l()));
	});
	return a.useEffect(() => {
		if (D) return m.addEventListener("keydown", O, { capture: !0 }), () => m.removeEventListener("keydown", O, { capture: !0 });
	}, [
		m,
		D,
		O
	]), a.useEffect(() => {
		if (f) return n && (d.layersWithOutsidePointerEventsDisabled.size === 0 && (sc = m.body.style.pointerEvents, m.body.style.pointerEvents = "none"), d.layersWithOutsidePointerEventsDisabled.add(f)), d.layers.add(f), mc(), () => {
			n && (d.layersWithOutsidePointerEventsDisabled.delete(f), d.layersWithOutsidePointerEventsDisabled.size === 0 && (m.body.style.pointerEvents = sc));
		};
	}, [
		f,
		m,
		n,
		d
	]), a.useEffect(() => () => {
		f && (d.layers.delete(f), d.layersWithOutsidePointerEventsDisabled.delete(f), mc());
	}, [f, d]), a.useEffect(() => {
		let e = /* @__PURE__ */ Y(() => h({}), "handleUpdate");
		return document.addEventListener(ic, e), () => document.removeEventListener(ic, e);
	}, []), /* @__PURE__ */ y(cs.div, {
		...u,
		ref: g,
		style: {
			pointerEvents: S ? C ? "auto" : "none" : void 0,
			...e.style
		},
		onFocusCapture: J(e.onFocusCapture, E.onFocusCapture),
		onBlurCapture: J(e.onBlurCapture, E.onBlurCapture),
		onPointerDownCapture: J(e.onPointerDownCapture, T.onPointerDownCapture)
	});
}, "DismissableLayer"));
function uc() {
	let e = a.useContext(cc), [t, n] = a.useState(null);
	return a.useEffect(() => {
		if (t) return e.dismissableSurfaces.add(t), () => {
			e.dismissableSurfaces.delete(t);
		};
	}, [t, e.dismissableSurfaces]), n;
}
Y(uc, "useDismissableLayerSurface");
var dc = /* @__PURE__ */ Y(() => !0, "IS_TRUE");
function fc(e, t) {
	let { ownerDocument: n = globalThis?.document, deferPointerDownOutside: r = !1, isDeferredPointerDownOutsideRef: i, dismissableSurfaces: o, shouldHandlePointerDownOutside: s = dc } = t, c = nc(e), l = a.useRef(!1), u = a.useRef(!1), d = a.useRef(/* @__PURE__ */ new Map()), f = a.useRef(() => {});
	return a.useEffect(() => {
		function e() {
			u.current = !1, i.current = !1, d.current.clear();
		}
		Y(e, "resetOutsideInteraction");
		function t() {
			return Array.from(d.current.values()).some(Boolean);
		}
		Y(t, "isOutsideInteractionIntercepted");
		function a(e) {
			if (!u.current) return;
			let t = e.target;
			t instanceof Node && [...o].some((e) => e.contains(t)) || d.current.set(e.type, !0), e.type === "click" && window.setTimeout(() => {
				u.current && f.current();
			}, 0);
		}
		Y(a, "handleInteractionCapture");
		function p(e) {
			u.current && d.current.set(e.type, !1);
		}
		Y(p, "handleInteractionBubble");
		let m = /* @__PURE__ */ Y((a) => {
			if (a.target && !l.current) {
				let o = function() {
					n.removeEventListener("click", f.current);
					let r = t();
					e(), r || hc(ac, c, p, { discrete: !0 });
				};
				if (Y(o, "handleAndDispatchPointerDownOutsideEvent"), !s(a.target)) {
					n.removeEventListener("click", f.current), e(), l.current = !1;
					return;
				}
				let p = { originalEvent: a };
				u.current = !0, i.current = r && a.button === 0, d.current.clear(), !r || a.button !== 0 ? o() : (n.removeEventListener("click", f.current), f.current = o, n.addEventListener("click", f.current, { once: !0 }));
			} else n.removeEventListener("click", f.current), e();
			l.current = !1;
		}, "handlePointerDown"), h = [
			"pointerup",
			"mousedown",
			"mouseup",
			"touchstart",
			"touchend",
			"click"
		];
		for (let e of h) n.addEventListener(e, a, !0), n.addEventListener(e, p);
		let g = window.setTimeout(() => {
			n.addEventListener("pointerdown", m);
		}, 0);
		return () => {
			window.clearTimeout(g), n.removeEventListener("pointerdown", m), n.removeEventListener("click", f.current);
			for (let e of h) n.removeEventListener(e, a, !0), n.removeEventListener(e, p);
		};
	}, [
		n,
		c,
		r,
		i,
		o,
		s
	]), { onPointerDownCapture: /* @__PURE__ */ Y(() => l.current = !0, "onPointerDownCapture") };
}
Y(fc, "usePointerDownOutside");
function pc(e, t = globalThis?.document) {
	let n = nc(e), r = a.useRef(!1);
	return a.useEffect(() => {
		let e = /* @__PURE__ */ Y((e) => {
			e.target && !r.current && hc(oc, n, { originalEvent: e }, { discrete: !1 });
		}, "handleFocus");
		return t.addEventListener("focusin", e), () => t.removeEventListener("focusin", e);
	}, [t, n]), {
		onFocusCapture: /* @__PURE__ */ Y(() => r.current = !0, "onFocusCapture"),
		onBlurCapture: /* @__PURE__ */ Y(() => r.current = !1, "onBlurCapture")
	};
}
Y(pc, "useFocusOutside");
function mc() {
	let e = new CustomEvent(ic);
	document.dispatchEvent(e);
}
Y(mc, "dispatchUpdate");
function hc(e, t, n, { discrete: r }) {
	let i = n.originalEvent.target, a = new CustomEvent(e, {
		bubbles: !1,
		cancelable: !0,
		detail: n
	});
	t && i.addEventListener(e, t, { once: !0 }), r ? ls(i, a) : i.dispatchEvent(a);
}
Y(hc, "handleAndDispatchCustomEvent");
// node_modules/@radix-ui/react-focus-scope/dist/index.mjs
var gc = Object.defineProperty, X = (e, t) => gc(e, "name", {
	value: t,
	configurable: !0
}), _c = "focusScope.autoFocusOnMount", vc = "focusScope.autoFocusOnUnmount", yc = {
	bubbles: !1,
	cancelable: !0
}, bc = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ X(function(e, t) {
	let { loop: n = !1, trapped: r = !1, branches: i, onMountAutoFocus: o, onUnmountAutoFocus: s, ...c } = e, [l, u] = a.useState(null), d = nc(o), f = nc(s), p = a.useRef(null), m = Vo(t, u), h = a.useRef(i);
	a.useEffect(() => {
		h.current = i;
	});
	let g = a.useCallback((e) => e ? l?.contains(e) ? !0 : !!h.current?.some((t) => t.contains(e)) : !1, [l]), _ = a.useRef({
		paused: !1,
		pause() {
			this.paused = !0;
		},
		resume() {
			this.paused = !1;
		}
	}).current;
	a.useEffect(() => {
		if (r) {
			let e = function(e) {
				if (_.paused || !l) return;
				let t = e.target;
				g(t) ? p.current = t : jc(p.current, { select: !0 });
			}, t = function(e) {
				if (_.paused || !l) return;
				let t = e.relatedTarget;
				t !== null && (g(t) || jc(p.current, { select: !0 }));
			}, n = function(e) {
				if (document.activeElement === document.body) for (let t of e) t.removedNodes.length > 0 && jc(l);
			};
			X(e, "handleFocusIn"), X(t, "handleFocusOut"), X(n, "handleMutations"), document.addEventListener("focusin", e), document.addEventListener("focusout", t);
			let r = new MutationObserver(n);
			return l && r.observe(l, {
				childList: !0,
				subtree: !0
			}), () => {
				document.removeEventListener("focusin", e), document.removeEventListener("focusout", t), r.disconnect();
			};
		}
	}, [
		r,
		l,
		_.paused,
		g
	]), a.useEffect(() => {
		if (l) {
			Mc.add(_);
			let e = document.activeElement;
			if (!l.contains(e)) {
				let t = new CustomEvent(_c, yc);
				l.addEventListener(_c, d), l.dispatchEvent(t), t.defaultPrevented || (Tc(Fc(Dc(l)), { select: !0 }), document.activeElement === e && jc(l));
			}
			return () => {
				l.removeEventListener(_c, d);
				let t = l.ownerDocument, n = CustomEvent;
				setTimeout(() => {
					let r = new n(vc, yc);
					l.addEventListener(vc, f), l.dispatchEvent(r), r.defaultPrevented || jc(e ?? t.body, { select: !0 }), l.removeEventListener(vc, f), Mc.remove(_);
				}, 0);
			};
		}
	}, [
		l,
		d,
		f,
		_
	]);
	let v = a.useCallback((e) => {
		if (!n && !r || _.paused) return;
		let t = e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey, i = document.activeElement;
		if (t && i) {
			let t = e.currentTarget, [r, a] = Ec(t);
			r && a ? !e.shiftKey && i === a ? (e.preventDefault(), n && jc(r, { select: !0 })) : e.shiftKey && i === r && (e.preventDefault(), n && jc(a, { select: !0 })) : i === t && e.preventDefault();
		}
	}, [
		n,
		r,
		_.paused
	]);
	return /* @__PURE__ */ y(cs.div, {
		tabIndex: -1,
		...c,
		ref: m,
		onKeyDown: v
	});
}, "FocusScope")), xc = a.createContext(null);
function Sc({ registry: e, children: t }) {
	return e ? /* @__PURE__ */ y(xc.Provider, {
		value: e,
		children: t
	}) : t;
}
X(Sc, "FocusScopeBranchProvider");
function Cc() {
	let [e, t] = a.useState([]);
	return {
		nodes: e,
		registry: a.useMemo(() => ({
			add: /* @__PURE__ */ X((e) => t((t) => t.includes(e) ? t : [...t, e]), "add"),
			remove: /* @__PURE__ */ X((e) => t((t) => t.filter((t) => t !== e)), "remove")
		}), [])
	};
}
X(Cc, "useFocusScopeBranchRegistry");
function wc(e) {
	let t = a.useContext(xc);
	a.useEffect(() => {
		if (e && t) return t.add(e), () => t.remove(e);
	}, [e, t]);
}
X(wc, "useFocusScopeBranch");
function Tc(e, { select: t = !1 } = {}) {
	let n = document.activeElement;
	for (let r of e) if (jc(r, { select: t }), document.activeElement !== n) return;
}
X(Tc, "focusFirst");
function Ec(e) {
	let t = Dc(e);
	return [Oc(t, e), Oc(t.reverse(), e)];
}
X(Ec, "getTabbableEdges");
function Dc(e) {
	let t = [], n = e.ownerDocument.createTreeWalker(e, NodeFilter.SHOW_ELEMENT, { acceptNode: /* @__PURE__ */ X((e) => {
		let t = e.tagName === "INPUT" && e.type === "hidden";
		return e.disabled || e.hidden || t ? NodeFilter.FILTER_SKIP : e.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
	}, "acceptNode") });
	for (; n.nextNode();) t.push(n.currentNode);
	return t;
}
X(Dc, "getTabbableCandidates");
function Oc(e, t) {
	let n = typeof t.checkVisibility == "function" && t.checkVisibility({ checkVisibilityCSS: !0 });
	for (let r of e) if (!(n ? !r.checkVisibility({ checkVisibilityCSS: !0 }) : kc(r, { upTo: t }))) return r;
}
X(Oc, "findVisible");
function kc(e, { upTo: t }) {
	if (getComputedStyle(e).visibility === "hidden") return !0;
	for (; e;) {
		if (t !== void 0 && e === t) return !1;
		if (getComputedStyle(e).display === "none") return !0;
		e = e.parentElement;
	}
	return !1;
}
X(kc, "isHidden");
function Ac(e) {
	return e.tagName === "INPUT" && typeof e.select == "function";
}
X(Ac, "isSelectableInput");
function jc(e, { select: t = !1 } = {}) {
	if (e && e.focus) {
		let n = (e.ownerDocument ?? document).activeElement;
		e.focus({ preventScroll: !0 }), e !== n && Ac(e) && t && e.select();
	}
}
X(jc, "focus");
var Mc = Nc();
function Nc() {
	let e = [];
	return {
		add(t) {
			let n = e[0];
			t !== n && n?.pause(), e = Pc(e, t), e.unshift(t);
		},
		remove(t) {
			e = Pc(e, t), e[0]?.resume();
		}
	};
}
X(Nc, "createFocusScopesStack");
function Pc(e, t) {
	let n = [...e], r = n.indexOf(t);
	return r !== -1 && n.splice(r, 1), n;
}
X(Pc, "arrayRemove");
function Fc(e) {
	return e.filter((e) => e.tagName !== "A");
}
X(Fc, "removeLinks");
// node_modules/@radix-ui/react-portal/dist/index.mjs
var Ic = Object.defineProperty, Lc = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ ((e, t) => Ic(e, "name", {
	value: t,
	configurable: !0
}))(function(e, t) {
	let { container: n, ...r } = e, [i, o] = a.useState(!1);
	q(() => o(!0), []);
	let s = n || i && globalThis?.document?.body;
	return s ? S.createPortal(/* @__PURE__ */ y(cs.div, {
		...r,
		ref: t
	}), s) : null;
}, "Portal")), Rc = Object.defineProperty, zc = (e, t) => Rc(e, "name", {
	value: t,
	configurable: !0
}), Bc = 0, Vc = null;
function Hc(e) {
	return Uc(), e.children;
}
zc(Hc, "FocusGuards");
function Uc() {
	a.useEffect(() => {
		Vc ||= {
			start: Wc(),
			end: Wc()
		};
		let { start: e, end: t } = Vc;
		return document.body.firstElementChild !== e && document.body.insertAdjacentElement("afterbegin", e), document.body.lastElementChild !== t && document.body.insertAdjacentElement("beforeend", t), Bc++, () => {
			Bc === 1 && (Vc?.start.remove(), Vc?.end.remove(), Vc = null), Bc = Math.max(0, Bc - 1);
		};
	}, []);
}
zc(Uc, "useFocusGuards");
function Wc() {
	let e = document.createElement("span");
	return e.setAttribute("data-radix-focus-guard", ""), e.tabIndex = 0, e.style.outline = "none", e.style.opacity = "0", e.style.position = "fixed", e.style.pointerEvents = "none", e;
}
zc(Wc, "createFocusGuard");
// src/app/ui/radix-modal-stub.ts
function Gc(e) {
	throw Error(`${e} belongs to Radix's modal mode: keep the primitive non-modal and let the presentation layer stack lock scrolling and inert the background.`);
}
function Kc() {
	return Gc("RemoveScroll");
}
function qc() {
	return Gc("hideOthers");
}
// node_modules/@radix-ui/react-dialog/dist/index.mjs
var Jc = Object.defineProperty, Yc = (e, t) => Jc(e, "name", {
	value: t,
	configurable: !0
}), Xc = "Dialog", [Zc, Qc] = /* @__PURE__ */ _s(Xc), [$c, el] = Zc(Xc), tl = /* @__PURE__ */ Yc((e) => {
	let { __scopeDialog: t, children: n, open: r, defaultOpen: i, onOpenChange: o, modal: s = !0 } = e, c = a.useRef(null), l = a.useRef(null), { nodes: u, registry: d } = Cc(), [f, p] = Ps({
		prop: r,
		defaultProp: i ?? !1,
		onChange: o,
		caller: Xc
	}), [m, h] = a.useState(0), [g, _] = a.useState(0);
	return /* @__PURE__ */ y($c, {
		scope: t,
		triggerRef: c,
		contentRef: l,
		contentId: Qs(),
		titleId: Qs(),
		descriptionId: Qs(),
		titlePresent: m > 0,
		descriptionPresent: g > 0,
		setTitleCount: h,
		setDescriptionCount: _,
		open: f,
		onOpenChange: p,
		onOpenToggle: a.useCallback(() => p((e) => !e), [p]),
		modal: s,
		branchNodes: u,
		branchRegistry: d,
		children: n
	});
}, "Dialog"), nl = "DialogPortal", [rl, il] = Zc(nl, { forceMount: void 0 }), al = /* @__PURE__ */ Yc((e) => {
	let { __scopeDialog: t, forceMount: n, children: r, container: i } = e, o = el(nl, t);
	return /* @__PURE__ */ y(rl, {
		scope: t,
		forceMount: n,
		children: a.Children.map(r, (e) => /* @__PURE__ */ y(Hs, {
			present: n || o.open,
			children: /* @__PURE__ */ y(Lc, {
				asChild: !0,
				container: i,
				children: e
			})
		}))
	});
}, "DialogPortal"), ol = "DialogContent", sl = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Yc(function(e, t) {
	let n = il(ol, e.__scopeDialog), { forceMount: r = n.forceMount, ...i } = e, a = el(ol, e.__scopeDialog);
	return /* @__PURE__ */ y(Hs, {
		present: r || a.open,
		children: a.modal ? /* @__PURE__ */ y(cl, {
			...i,
			ref: t
		}) : /* @__PURE__ */ y(ll, {
			...i,
			ref: t
		})
	});
}, "DialogContent")), cl = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Yc(function(e, t) {
	let n = el(ol, e.__scopeDialog), r = a.useRef(null), i = Vo(t, n.contentRef, r);
	return a.useEffect(() => {
		let e = r.current;
		if (e) return qc(e);
	}, []), /* @__PURE__ */ y(ul, {
		...e,
		ref: i,
		trapFocus: n.open,
		disableOutsidePointerEvents: n.open,
		onCloseAutoFocus: J(e.onCloseAutoFocus, (e) => {
			e.preventDefault(), n.triggerRef.current?.focus();
		}),
		onPointerDownOutside: J(e.onPointerDownOutside, (e) => {
			let t = e.detail.originalEvent, n = t.button === 0 && t.ctrlKey === !0;
			(t.button === 2 || n) && e.preventDefault();
		}),
		onFocusOutside: J(e.onFocusOutside, (e) => e.preventDefault())
	});
}, "DialogContentModal")), ll = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Yc(function(e, t) {
	let n = el(ol, e.__scopeDialog), r = a.useRef(!1), i = a.useRef(!1);
	return /* @__PURE__ */ y(ul, {
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
}, "DialogContentNonModal")), ul = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Yc(function(e, t) {
	let { __scopeDialog: n, trapFocus: r, onOpenAutoFocus: i, onCloseAutoFocus: a, "aria-describedby": o, children: s, ...c } = e, l = el(ol, n);
	return Uc(), /* @__PURE__ */ y(Sc, {
		registry: l.branchRegistry,
		children: /* @__PURE__ */ y(bc, {
			asChild: !0,
			loop: !0,
			trapped: r,
			branches: l.branchNodes,
			onMountAutoFocus: i,
			onUnmountAutoFocus: a,
			children: /* @__PURE__ */ y(lc, {
				role: "dialog",
				id: l.contentId,
				"aria-labelledby": l.titlePresent ? l.titleId : void 0,
				"aria-describedby": l.descriptionPresent ? pl(o, l.descriptionId) : o,
				"data-state": ml(l.open),
				...c,
				ref: t,
				deferPointerDownOutside: !0,
				onDismiss: () => l.onOpenChange(!1),
				children: s
			})
		})
	});
}, "DialogContentImpl")), dl = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Yc(function(e, t) {
	let { __scopeDialog: n, ...r } = e, i = el("DialogTitle", n), { setTitleCount: a } = i;
	return q(() => (a((e) => e + 1), () => a((e) => e - 1)), [a]), /* @__PURE__ */ y(cs.h2, {
		id: i.titleId,
		...r,
		ref: t
	});
}, "DialogTitle")), fl = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Yc(function(e, t) {
	let { __scopeDialog: n, ...r } = e, i = el("DialogDescription", n), { setDescriptionCount: a } = i;
	return q(() => (a((e) => e + 1), () => a((e) => e - 1)), [a]), /* @__PURE__ */ y(cs.p, {
		id: i.descriptionId,
		...r,
		ref: t
	});
}, "DialogDescription"));
function pl(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
Yc(pl, "concatAriaDescribedby");
function ml(e) {
	return e ? "open" : "closed";
}
Yc(ml, "getState");
// node_modules/@radix-ui/react-use-size/dist/index.mjs
var hl = Object.defineProperty, gl = (e, t) => hl(e, "name", {
	value: t,
	configurable: !0
});
function _l(e) {
	let [t, n] = a.useState(void 0);
	return q(() => {
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
gl(_l, "useSize");
// node_modules/@floating-ui/utils/dist/floating-ui.utils.mjs
var vl = [
	"top",
	"right",
	"bottom",
	"left"
], yl = Math.min, bl = Math.max, xl = Math.round, Sl = Math.floor, Cl = (e) => ({
	x: e,
	y: e
}), wl = {
	left: "right",
	right: "left",
	bottom: "top",
	top: "bottom"
};
function Tl(e, t, n) {
	return bl(e, yl(t, n));
}
function El(e, t) {
	return typeof e == "function" ? e(t) : e;
}
function Dl(e) {
	return e.split("-")[0];
}
function Ol(e) {
	return e.split("-")[1];
}
function kl(e) {
	return e === "x" ? "y" : "x";
}
function Al(e) {
	return e === "y" ? "height" : "width";
}
function jl(e) {
	let t = e[0];
	return t === "t" || t === "b" ? "y" : "x";
}
function Ml(e) {
	return kl(jl(e));
}
function Nl(e, t, n) {
	n === void 0 && (n = !1);
	let r = Ol(e), i = Ml(e), a = Al(i), o = i === "x" ? r === (n ? "end" : "start") ? "right" : "left" : r === "start" ? "bottom" : "top";
	return t.reference[a] > t.floating[a] && (o = Hl(o)), [o, Hl(o)];
}
function Pl(e) {
	let t = Hl(e);
	return [
		Fl(e),
		t,
		Fl(t)
	];
}
function Fl(e) {
	return e.includes("start") ? e.replace("start", "end") : e.replace("end", "start");
}
var Il = ["left", "right"], Ll = ["right", "left"], Rl = ["top", "bottom"], zl = ["bottom", "top"];
function Bl(e, t, n) {
	switch (e) {
		case "top":
		case "bottom": return n ? t ? Ll : Il : t ? Il : Ll;
		case "left":
		case "right": return t ? Rl : zl;
		default: return [];
	}
}
function Vl(e, t, n, r) {
	let i = Ol(e), a = Bl(Dl(e), n === "start", r);
	return i && (a = a.map((e) => e + "-" + i), t && (a = a.concat(a.map(Fl)))), a;
}
function Hl(e) {
	let t = Dl(e);
	return wl[t] + e.slice(t.length);
}
function Ul(e) {
	return {
		top: e.top ?? 0,
		right: e.right ?? 0,
		bottom: e.bottom ?? 0,
		left: e.left ?? 0
	};
}
function Wl(e) {
	return typeof e == "number" ? {
		top: e,
		right: e,
		bottom: e,
		left: e
	} : Ul(e);
}
function Gl(e) {
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
function Kl(e, t, n) {
	let { reference: r, floating: i } = e, a = jl(t), o = Ml(t), s = Al(o), c = Dl(t), l = a === "y", u = r.x + r.width / 2 - i.width / 2, d = r.y + r.height / 2 - i.height / 2, f = r[s] / 2 - i[s] / 2, p;
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
	let m = Ol(t);
	return m && (p[o] += f * (m === "end" ? 1 : -1) * (n && l ? -1 : 1)), p;
}
async function ql(e, t) {
	t === void 0 && (t = {});
	let { x: n, y: r, platform: i, rects: a, elements: o, strategy: s } = e, { boundary: c = "clippingAncestors", rootBoundary: l = "viewport", elementContext: u = "floating", altBoundary: d = !1, padding: f = 0 } = El(t, e), p = Wl(f), m = o[d ? u === "floating" ? "reference" : "floating" : u], h = Gl(await i.getClippingRect({
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
	}, y = Gl(i.convertOffsetParentRelativeRectToViewportRelativeRect ? await i.convertOffsetParentRelativeRectToViewportRelativeRect({
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
var Jl = 50, Yl = async (e, t, n) => {
	let { placement: r = "bottom", strategy: i = "absolute", middleware: a = [], platform: o } = n, s = o.detectOverflow ? o : {
		...o,
		detectOverflow: ql
	}, c = await (o.isRTL == null ? void 0 : o.isRTL(t)), l = await o.getElementRects({
		reference: e,
		floating: t,
		strategy: i
	}), { x: u, y: d } = Kl(l, r, c), f = r, p = 0, m = {};
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
		}, x && p < Jl && (p++, typeof x == "object" && (x.placement && (f = x.placement), x.rects && (l = x.rects === !0 ? await o.getElementRects({
			reference: e,
			floating: t,
			strategy: i
		}) : x.rects), {x: u, y: d} = Kl(l, f, c)), n = -1);
	}
	return {
		x: u,
		y: d,
		placement: f,
		strategy: i,
		middlewareData: m
	};
}, Xl = (e) => ({
	name: "arrow",
	options: e,
	async fn(t) {
		let { x: n, y: r, placement: i, rects: a, platform: o, elements: s, middlewareData: c } = t, { element: l, padding: u = 0 } = El(e, t) || {};
		if (l == null) return {};
		let d = Wl(u), f = {
			x: n,
			y: r
		}, p = Ml(i), m = Al(p), h = await o.getDimensions(l), g = p === "y", _ = g ? "top" : "left", v = g ? "bottom" : "right", y = g ? "clientHeight" : "clientWidth", b = a.reference[m] + a.reference[p] - f[p] - a.floating[m], x = f[p] - a.reference[p], S = await (o.getOffsetParent == null ? void 0 : o.getOffsetParent(l)), C = S ? S[y] : 0;
		C && await (o.isElement == null ? void 0 : o.isElement(S)) || (C = s.floating[y] || a.floating[m]);
		let w = b / 2 - x / 2, T = C / 2 - h[m] / 2 - 1, E = yl(d[_], T), D = yl(d[v], T), O = C - h[m] - D, k = C / 2 - h[m] / 2 + w, ee = Tl(E, k, O), A = !c.arrow && Ol(i) != null && k !== ee && a.reference[m] / 2 - (k < E ? E : D) - h[m] / 2 < 0, j = A ? k < E ? k - E : k - O : 0;
		return {
			[p]: f[p] + j,
			data: {
				[p]: ee,
				centerOffset: k - ee - j,
				...A && { alignmentOffset: j }
			},
			reset: A
		};
	}
}), Zl = function(e) {
	return e === void 0 && (e = {}), {
		name: "flip",
		options: e,
		async fn(t) {
			var n;
			let { placement: r, middlewareData: i, rects: a, initialPlacement: o, platform: s, elements: c } = t, { mainAxis: l = !0, crossAxis: u = !0, fallbackPlacements: d, fallbackStrategy: f = "bestFit", fallbackAxisSideDirection: p = "none", flipAlignment: m = !0, ...h } = El(e, t);
			if ((n = i.arrow) != null && n.alignmentOffset) return {};
			let g = Dl(r), _ = jl(o), v = Dl(o) === o, y = await (s.isRTL == null ? void 0 : s.isRTL(c.floating)), b = d || (v || !m ? [Hl(o)] : Pl(o)), x = p !== "none";
			!d && x && b.push(...Vl(o, m, p, y));
			let S = [o, ...b], C = await s.detectOverflow(t, h), w = [], T = i.flip?.overflows || [];
			if (l && w.push(C[g]), u) {
				let e = Nl(r, a, y);
				w.push(C[e[0]], C[e[1]]);
			}
			if (T = [...T, {
				placement: r,
				overflows: w
			}], !w.every((e) => e <= 0)) {
				let e = (i.flip?.index || 0) + 1, t = S[e];
				if (t && (u !== "alignment" || _ === jl(t) || T.every((e) => jl(e.placement) !== _ || e.overflows[0] > 0))) return {
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
								let t = jl(e.placement);
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
function Ql(e, t) {
	return {
		top: e.top - t.height,
		right: e.right - t.width,
		bottom: e.bottom - t.height,
		left: e.left - t.width
	};
}
function $l(e) {
	return vl.some((t) => e[t] >= 0);
}
var eu = function(e) {
	return e === void 0 && (e = {}), {
		name: "hide",
		options: e,
		async fn(t) {
			let { rects: n, platform: r } = t, { strategy: i = "referenceHidden", ...a } = El(e, t);
			switch (i) {
				case "referenceHidden": {
					let e = Ql(await r.detectOverflow(t, {
						...a,
						elementContext: "reference"
					}), n.reference);
					return { data: {
						referenceHiddenOffsets: e,
						referenceHidden: $l(e)
					} };
				}
				case "escaped": {
					let e = Ql(await r.detectOverflow(t, {
						...a,
						altBoundary: !0
					}), n.floating);
					return { data: {
						escapedOffsets: e,
						escaped: $l(e)
					} };
				}
				default: return {};
			}
		}
	};
}, tu = /*#__PURE__*/ new Set(["left", "top"]);
async function nu(e, t) {
	let { placement: n, platform: r, elements: i } = e, a = await (r.isRTL == null ? void 0 : r.isRTL(i.floating)), o = Dl(n), s = Ol(n), c = jl(n) === "y", l = tu.has(o) ? -1 : 1, u = a && c ? -1 : 1, d = El(t, e), { mainAxis: f, crossAxis: p, alignmentAxis: m } = typeof d == "number" ? {
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
var ru = function(e) {
	return e === void 0 && (e = 0), {
		name: "offset",
		options: e,
		async fn(t) {
			var n;
			let { x: r, y: i, placement: a, middlewareData: o } = t, s = await nu(t, e);
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
}, iu = function(e) {
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
			} }, ...l } = El(e, t), u = {
				x: n,
				y: r
			}, d = await a.detectOverflow(t, l), f = jl(i), p = kl(f), m = u[p], h = u[f], g = (e, t) => Tl(t + d[e === "y" ? "top" : "left"], t, t - d[e === "y" ? "bottom" : "right"]);
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
}, au = function(e) {
	return e === void 0 && (e = {}), {
		options: e,
		fn(t) {
			let { x: n, y: r, placement: i, rects: a, middlewareData: o } = t, { offset: s = 0, mainAxis: c = !0, crossAxis: l = !0 } = El(e, t), u = {
				x: n,
				y: r
			}, d = jl(i), f = kl(d), p = u[f], m = u[d], h = El(s, t), g = typeof h == "number" ? {
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
				let e = f === "y" ? "width" : "height", t = tu.has(Dl(i)), n = a.reference[d] - a.floating[e] + (t && o.offset?.[d] || 0) + (t ? 0 : g.crossAxis), r = a.reference[d] + a.reference[e] + (t ? 0 : o.offset?.[d] || 0) - (t ? g.crossAxis : 0);
				m < n ? m = n : m > r && (m = r);
			}
			return {
				[f]: p,
				[d]: m
			};
		}
	};
}, ou = function(e) {
	return e === void 0 && (e = {}), {
		name: "size",
		options: e,
		async fn(t) {
			let { placement: n, rects: r, platform: i, elements: a } = t, { apply: o = () => {}, ...s } = El(e, t), c = await i.detectOverflow(t, s), l = Dl(n), u = Ol(n), d = jl(n) === "y", { width: f, height: p } = r.floating, m, h;
			l === "top" || l === "bottom" ? (m = l, h = u === (await (i.isRTL == null ? void 0 : i.isRTL(a.floating)) ? "start" : "end") ? "left" : "right") : (h = l, m = u === "end" ? "top" : "bottom");
			let g = p - c.top - c.bottom, _ = f - c.left - c.right, v = yl(p - c[m], g), y = yl(f - c[h], _), b = t.middlewareData.shift, x = !b, S = v, C = y;
			b != null && b.enabled.x && (C = _), b != null && b.enabled.y && (S = g), x && !u && (d ? C = f - 2 * bl(c.left, c.right) : S = p - 2 * bl(c.top, c.bottom)), await o({
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
function su() {
	return typeof window < "u";
}
function cu(e) {
	return uu(e) ? (e.nodeName || "").toLowerCase() : "#document";
}
function Z(e) {
	var t;
	return (e == null || (t = e.ownerDocument) == null ? void 0 : t.defaultView) || window;
}
function lu(e) {
	return ((uu(e) ? e.ownerDocument : e.document) || window.document)?.documentElement;
}
function uu(e) {
	return su() ? e instanceof Node || e instanceof Z(e).Node : !1;
}
function du(e) {
	return su() ? e instanceof Element || e instanceof Z(e).Element : !1;
}
function fu(e) {
	return su() ? e instanceof HTMLElement || e instanceof Z(e).HTMLElement : !1;
}
function pu(e) {
	return !su() || typeof ShadowRoot > "u" ? !1 : e instanceof ShadowRoot || e instanceof Z(e).ShadowRoot;
}
function mu(e) {
	let { overflow: t, overflowX: n, overflowY: r, display: i } = Tu(e);
	return /auto|scroll|overlay|hidden|clip/.test(t + r + n) && i !== "inline" && i !== "contents";
}
function hu(e) {
	return /^(table|td|th)$/.test(cu(e));
}
function gu(e) {
	try {
		if (e.matches(":popover-open")) return !0;
	} catch {}
	try {
		return e.matches(":modal");
	} catch {
		return !1;
	}
}
var _u = /transform|translate|scale|rotate|perspective|filter/, vu = /paint|layout|strict|content/, yu = (e) => !!e && e !== "none", bu;
function xu(e) {
	let t = du(e) ? Tu(e) : e;
	return yu(t.transform) || yu(t.translate) || yu(t.scale) || yu(t.rotate) || yu(t.perspective) || !Cu() && (yu(t.backdropFilter) || yu(t.filter)) || _u.test(t.willChange || "") || vu.test(t.contain || "");
}
function Su(e) {
	let t = Du(e);
	for (; fu(t) && !wu(t);) {
		if (xu(t)) return t;
		if (gu(t)) return null;
		t = Du(t);
	}
	return null;
}
function Cu() {
	return bu ??= typeof CSS < "u" && CSS.supports && CSS.supports("-webkit-backdrop-filter", "none"), bu;
}
function wu(e) {
	return /^(html|body|#document)$/.test(cu(e));
}
function Tu(e) {
	return Z(e).getComputedStyle(e);
}
function Eu(e) {
	return du(e) ? {
		scrollLeft: e.scrollLeft,
		scrollTop: e.scrollTop
	} : {
		scrollLeft: e.scrollX,
		scrollTop: e.scrollY
	};
}
function Du(e) {
	if (cu(e) === "html") return e;
	let t = e.assignedSlot || e.parentNode || pu(e) && e.host || lu(e);
	return pu(t) ? t.host : t;
}
function Ou(e) {
	let t = Du(e);
	return wu(t) ? (e.ownerDocument || e).body : fu(t) && mu(t) ? t : Ou(t);
}
function ku(e, t, n) {
	t === void 0 && (t = []), n === void 0 && (n = !0);
	let r = Ou(e), i = r === e.ownerDocument?.body, a = Z(r);
	if (i) {
		let e = Au(a);
		return t.concat(a, a.visualViewport || [], mu(r) ? r : [], e && n ? ku(e) : []);
	}
	return t.concat(r, ku(r, [], n));
}
function Au(e) {
	return e.parent && Object.getPrototypeOf(e.parent) ? e.frameElement : null;
}
// node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs
function ju(e) {
	let t = Tu(e), n = parseFloat(t.width) || 0, r = parseFloat(t.height) || 0, i = fu(e), a = i ? e.offsetWidth : n, o = i ? e.offsetHeight : r, s = xl(n) !== a || xl(r) !== o;
	return s && (n = a, r = o), {
		width: n,
		height: r,
		$: s
	};
}
function Mu(e) {
	return du(e) ? e : e.contextElement;
}
function Nu(e) {
	let t = Mu(e);
	if (!fu(t)) return Cl(1);
	let n = t.getBoundingClientRect(), { width: r, height: i, $: a } = ju(t), o = (a ? xl(n.width) : n.width) / r, s = (a ? xl(n.height) : n.height) / i;
	return o && Number.isFinite(o) || (o = 1), s && Number.isFinite(s) || (s = 1), {
		x: o,
		y: s
	};
}
var Pu = /*#__PURE__*/ Cl(0);
function Fu(e) {
	let t = Z(e);
	return !Cu() || !t.visualViewport ? Pu : {
		x: t.visualViewport.offsetLeft,
		y: t.visualViewport.offsetTop
	};
}
function Iu(e, t, n) {
	return t === void 0 && (t = !1), !!n && t && n === Z(e);
}
function Lu(e, t, n, r) {
	t === void 0 && (t = !1), n === void 0 && (n = !1);
	let i = e.getBoundingClientRect(), a = Mu(e), o = Cl(1);
	t && (r ? du(r) && (o = Nu(r)) : o = Nu(e));
	let s = Iu(a, n, r) ? Fu(a) : Cl(0), c = (i.left + s.x) / o.x, l = (i.top + s.y) / o.y, u = i.width / o.x, d = i.height / o.y;
	if (a && r) {
		let e = Z(a), t = du(r) ? Z(r) : r, n = e, i = Au(n);
		for (; i && t !== n;) {
			let e = Nu(i), t = i.getBoundingClientRect(), r = Tu(i), a = t.left + (i.clientLeft + parseFloat(r.paddingLeft)) * e.x, o = t.top + (i.clientTop + parseFloat(r.paddingTop)) * e.y;
			c *= e.x, l *= e.y, u *= e.x, d *= e.y, c += a, l += o, n = Z(i), i = Au(n);
		}
	}
	return Gl({
		width: u,
		height: d,
		x: c,
		y: l
	});
}
function Ru(e, t) {
	let n = Eu(e).scrollLeft;
	return t ? t.left + n : Lu(lu(e)).left + n;
}
function zu(e, t) {
	let n = e.getBoundingClientRect();
	return {
		x: n.left + t.scrollLeft - Ru(e, n),
		y: n.top + t.scrollTop
	};
}
function Bu(e) {
	let { elements: t, rect: n, offsetParent: r, strategy: i } = e, a = i === "fixed", o = lu(r), s = t ? gu(t.floating) : !1;
	if (r === o || s && a) return n;
	let c = {
		scrollLeft: 0,
		scrollTop: 0
	}, l = Cl(1), u = Cl(0), d = fu(r);
	if ((d || !a) && ((cu(r) !== "body" || mu(o)) && (c = Eu(r)), d)) {
		let e = Lu(r);
		l = Nu(r), u.x = e.x + r.clientLeft, u.y = e.y + r.clientTop;
	}
	let f = o && !d && !a ? zu(o, c) : Cl(0);
	return {
		width: n.width * l.x,
		height: n.height * l.y,
		x: n.x * l.x - c.scrollLeft * l.x + u.x + f.x,
		y: n.y * l.y - c.scrollTop * l.y + u.y + f.y
	};
}
function Vu(e) {
	return e.getClientRects ? Array.from(e.getClientRects()) : [];
}
function Hu(e) {
	let t = Eu(e), n = e.ownerDocument.body, r = bl(e.scrollWidth, e.clientWidth, n.scrollWidth, n.clientWidth), i = bl(e.scrollHeight, e.clientHeight, n.scrollHeight, n.clientHeight), a = -t.scrollLeft + Ru(e), o = -t.scrollTop;
	return Tu(n).direction === "rtl" && (a += bl(e.clientWidth, n.clientWidth) - r), {
		width: r,
		height: i,
		x: a,
		y: o
	};
}
var Uu = 25;
function Wu(e, t, n) {
	n === void 0 && (n = "viewport");
	let r = n === "layoutViewport", i = Z(e), a = lu(e), o = i.visualViewport, s = a.clientWidth, c = a.clientHeight, l = 0, u = 0;
	if (o) {
		let e = !Cu() || t === "fixed";
		r ? e || (l = -o.offsetLeft, u = -o.offsetTop) : (s = o.width, c = o.height, e && (l = o.offsetLeft, u = o.offsetTop));
	}
	if (Ru(a) <= 0) {
		let e = a.ownerDocument, t = e.body, n = getComputedStyle(t), r = e.compatMode === "CSS1Compat" && parseFloat(n.marginLeft) + parseFloat(n.marginRight) || 0, i = Math.abs(a.clientWidth - t.clientWidth - r), o = getComputedStyle(a).scrollbarGutter === "stable both-edges" ? i / 2 : i;
		o <= Uu && (s -= o);
	}
	return {
		width: s,
		height: c,
		x: l,
		y: u
	};
}
function Gu(e, t) {
	let n = Lu(e, !0, t === "fixed"), r = n.top + e.clientTop, i = n.left + e.clientLeft, a = Nu(e);
	return {
		width: e.clientWidth * a.x,
		height: e.clientHeight * a.y,
		x: i * a.x,
		y: r * a.y
	};
}
function Ku(e, t, n) {
	let r;
	if (t === "viewport" || t === "layoutViewport") r = Wu(e, n, t);
	else if (t === "document") r = Hu(lu(e));
	else if (du(t)) r = Gu(t, n);
	else {
		let n = Fu(e);
		r = {
			x: t.x - n.x,
			y: t.y - n.y,
			width: t.width,
			height: t.height
		};
	}
	return Gl(r);
}
function qu(e, t) {
	let n = t.get(e);
	if (n) return n;
	let r = ku(e, [], !1).filter((e) => du(e) && cu(e) !== "body"), i = null, a = Tu(e).position === "fixed", o = a ? Du(e) : e;
	for (; du(o) && !wu(o);) {
		let e = Tu(o), t = xu(o), n = i ? i.position : a ? "fixed" : "";
		!t && (n === "fixed" || n === "absolute" && e.position === "static") ? r = r.filter((e) => e !== o) : i = e, o = Du(o);
	}
	return t.set(e, r), r;
}
function Ju(e) {
	let { element: t, boundary: n, rootBoundary: r, strategy: i } = e, a = [...n === "clippingAncestors" ? gu(t) ? [] : qu(t, this._c) : [].concat(n), r], o = Ku(t, a[0], i), s = o.top, c = o.right, l = o.bottom, u = o.left;
	for (let e = 1; e < a.length; e++) {
		let n = Ku(t, a[e], i);
		s = bl(n.top, s), c = yl(n.right, c), l = yl(n.bottom, l), u = bl(n.left, u);
	}
	return {
		width: c - u,
		height: l - s,
		x: u,
		y: s
	};
}
function Yu(e) {
	let { width: t, height: n } = ju(e);
	return {
		width: t,
		height: n
	};
}
function Xu(e, t, n) {
	let r = fu(t), i = lu(t), a = n === "fixed", o = Lu(e, !0, a, t), s = {
		scrollLeft: 0,
		scrollTop: 0
	}, c = Cl(0);
	if ((r || !a) && ((cu(t) !== "body" || mu(i)) && (s = Eu(t)), r)) {
		let e = Lu(t, !0, a, t);
		c.x = e.x + t.clientLeft, c.y = e.y + t.clientTop;
	}
	!r && i && (c.x = Ru(i));
	let l = i && !r && !a ? zu(i, s) : Cl(0);
	return {
		x: o.left + s.scrollLeft - c.x - l.x,
		y: o.top + s.scrollTop - c.y - l.y,
		width: o.width,
		height: o.height
	};
}
function Zu(e) {
	return Tu(e).position === "static";
}
function Qu(e, t) {
	if (!fu(e) || Tu(e).position === "fixed") return null;
	if (t) return t(e);
	let n = e.offsetParent;
	return lu(e) === n && (n = n.ownerDocument.body), n;
}
function $u(e, t) {
	let n = Z(e);
	if (gu(e)) return n;
	if (!fu(e)) {
		let t = Du(e);
		for (; t && !wu(t);) {
			if (du(t) && !Zu(t)) return t;
			t = Du(t);
		}
		return n;
	}
	let r = Qu(e, t);
	for (; r && hu(r) && Zu(r);) r = Qu(r, t);
	return r && wu(r) && Zu(r) && !xu(r) ? n : r || Su(e) || n;
}
var ed = async function(e) {
	let t = this.getOffsetParent || $u, n = this.getDimensions, r = await n(e.floating);
	return {
		reference: Xu(e.reference, await t(e.floating), e.strategy),
		floating: {
			x: 0,
			y: 0,
			width: r.width,
			height: r.height
		}
	};
};
function td(e) {
	return Tu(e).direction === "rtl";
}
var nd = {
	convertOffsetParentRelativeRectToViewportRelativeRect: Bu,
	getDocumentElement: lu,
	getClippingRect: Ju,
	getOffsetParent: $u,
	getElementRects: ed,
	getClientRects: Vu,
	getDimensions: Yu,
	getScale: Nu,
	isElement: du,
	isRTL: td
};
function rd(e, t) {
	return e.x === t.x && e.y === t.y && e.width === t.width && e.height === t.height;
}
function id(e, t, n) {
	let r = null, i, a = lu(e);
	function o() {
		var e;
		clearTimeout(i), (e = r) == null || e.disconnect(), r = null;
	}
	function s(n, c) {
		n === void 0 && (n = !1), c === void 0 && (c = 1), o();
		let l = e.getBoundingClientRect(), { left: u, top: d, width: f, height: p } = l;
		if (n || t(), !f || !p) return;
		let m = Sl(d), h = Sl(a.clientWidth - (u + f)), g = Sl(a.clientHeight - (d + p)), _ = Sl(u), v = {
			rootMargin: -m + "px " + -h + "px " + -g + "px " + -_ + "px",
			threshold: bl(0, yl(1, c)) || 1
		}, y = !0;
		function b(t) {
			let n = t[0].intersectionRatio;
			if (!rd(l, e.getBoundingClientRect())) return s();
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
	let c = Z(e), l = () => s(n);
	return c.addEventListener("resize", l), s(!0), () => {
		c.removeEventListener("resize", l), o();
	};
}
function ad(e, t, n, r) {
	r === void 0 && (r = {});
	let { ancestorScroll: i = !0, ancestorResize: a = !0, elementResize: o = typeof ResizeObserver == "function", layoutShift: s = typeof IntersectionObserver == "function", animationFrame: c = !1 } = r, l = Mu(e), u = i || a ? [...l ? ku(l) : [], ...t ? ku(t) : []] : [];
	u.forEach((e) => {
		i && e.addEventListener("scroll", n), a && e.addEventListener("resize", n);
	});
	let d = l && s ? id(l, n, a) : null, f = -1, p = null;
	o && (p = new ResizeObserver((e) => {
		let [r] = e;
		r && r.target === l && p && t && (p.unobserve(t), cancelAnimationFrame(f), f = requestAnimationFrame(() => {
			var e;
			(e = p) == null || e.observe(t);
		})), n();
	}), l && !c && p.observe(l), t && p.observe(t));
	let m, h = c ? Lu(e) : null;
	c && g();
	function g() {
		let t = Lu(e);
		h && !rd(h, t) && n(), h = t, m = requestAnimationFrame(g);
	}
	return n(), () => {
		var e;
		u.forEach((e) => {
			i && e.removeEventListener("scroll", n), a && e.removeEventListener("resize", n);
		}), d?.(), (e = p) == null || e.disconnect(), p = null, c && cancelAnimationFrame(m);
	};
}
var od = ru, sd = iu, cd = Zl, ld = ou, ud = eu, dd = Xl, fd = au, pd = (e, t, n) => {
	let r = /* @__PURE__ */ new Map(), i = n ?? {}, a = {
		...nd,
		...i.platform,
		_c: r
	};
	return Yl(e, t, {
		...i,
		platform: a
	});
}, md = typeof document < "u" ? p : function() {};
function hd(e, t) {
	if (e === t) return !0;
	if (typeof e != typeof t) return !1;
	if (typeof e == "function" && e.toString() === t.toString()) return !0;
	let n, r, i;
	if (e && t && typeof e == "object") {
		if (Array.isArray(e)) {
			if (n = e.length, n !== t.length) return !1;
			for (r = n; r-- !== 0;) if (!hd(e[r], t[r])) return !1;
			return !0;
		}
		if (i = Object.keys(e), n = i.length, n !== Object.keys(t).length) return !1;
		for (r = n; r-- !== 0;) if (!{}.hasOwnProperty.call(t, i[r])) return !1;
		for (r = n; r-- !== 0;) {
			let n = i[r];
			if (!(n === "_owner" && e.$$typeof) && !hd(e[n], t[n])) return !1;
		}
		return !0;
	}
	return e !== e && t !== t;
}
function gd(e) {
	return typeof window > "u" ? 1 : (e.ownerDocument.defaultView || window).devicePixelRatio || 1;
}
function _d(e, t) {
	let n = gd(e);
	return Math.round(t * n) / n;
}
function vd(e) {
	let t = a.useRef(e);
	return md(() => {
		t.current = e;
	}), t;
}
function yd(e) {
	e === void 0 && (e = {});
	let { placement: t = "bottom", strategy: n = "absolute", middleware: r = [], platform: i, elements: { reference: o, floating: s } = {}, transform: c = !0, whileElementsMounted: l, open: u } = e, [d, f] = a.useState({
		x: 0,
		y: 0,
		strategy: n,
		placement: t,
		middlewareData: {},
		isPositioned: !1
	}), [p, m] = a.useState(r);
	hd(p, r) || m(r);
	let [h, g] = a.useState(null), [_, v] = a.useState(null), y = a.useCallback((e) => {
		e !== w.current && (w.current = e, g(e));
	}, []), b = a.useCallback((e) => {
		e !== T.current && (T.current = e, v(e));
	}, []), x = o || h, C = s || _, w = a.useRef(null), T = a.useRef(null), E = a.useRef(d), D = l != null, O = vd(l), k = vd(i), ee = vd(u), A = a.useCallback(() => {
		if (!w.current || !T.current) return;
		let e = {
			placement: t,
			strategy: n,
			middleware: p
		};
		k.current && (e.platform = k.current), pd(w.current, T.current, e).then((e) => {
			let t = {
				...e,
				isPositioned: ee.current !== !1
			};
			j.current && !hd(E.current, t) && (E.current = t, S.flushSync(() => {
				f(t);
			}));
		});
	}, [
		p,
		t,
		n,
		k,
		ee
	]);
	md(() => {
		u === !1 && E.current.isPositioned && (E.current.isPositioned = !1, f((e) => ({
			...e,
			isPositioned: !1
		})));
	}, [u]);
	let j = a.useRef(!1);
	md(() => (j.current = !0, () => {
		j.current = !1;
	}), []), md(() => {
		if (x && (w.current = x), C && (T.current = C), x && C) {
			if (O.current) return O.current(x, C, A);
			A();
		}
	}, [
		x,
		C,
		A,
		O,
		D
	]);
	let M = a.useMemo(() => ({
		reference: w,
		floating: T,
		setReference: y,
		setFloating: b
	}), [y, b]), N = a.useMemo(() => ({
		reference: x,
		floating: C
	}), [x, C]), P = a.useMemo(() => {
		let e = {
			position: n,
			left: 0,
			top: 0
		};
		if (!N.floating) return e;
		let t = _d(N.floating, d.x), r = _d(N.floating, d.y);
		return c ? {
			...e,
			transform: "translate(" + t + "px, " + r + "px)",
			...gd(N.floating) >= 1.5 && { willChange: "transform" }
		} : {
			position: n,
			left: t,
			top: r
		};
	}, [
		n,
		c,
		N.floating,
		d.x,
		d.y
	]);
	return a.useMemo(() => ({
		...d,
		update: A,
		refs: M,
		elements: N,
		floatingStyles: P
	}), [
		d,
		A,
		M,
		N,
		P
	]);
}
var bd = (e) => {
	function t(e) {
		return {}.hasOwnProperty.call(e, "current");
	}
	return {
		name: "arrow",
		options: e,
		fn(n) {
			let { element: r, padding: i } = typeof e == "function" ? e(n) : e;
			return r && t(r) ? r.current == null ? {} : dd({
				element: r.current,
				padding: i
			}).fn(n) : r ? dd({
				element: r,
				padding: i
			}).fn(n) : {};
		}
	};
}, xd = (e, t) => {
	let n = od(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, Sd = (e, t) => {
	let n = sd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, Cd = (e, t) => ({
	fn: fd(e).fn,
	options: [e, t]
}), wd = (e, t) => {
	let n = cd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, Td = (e, t) => {
	let n = ld(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, Ed = (e, t) => {
	let n = ud(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, Dd = (e, t) => {
	let n = bd(e);
	return {
		name: n.name,
		fn: n.fn,
		options: [e, t]
	};
}, Od = Object.defineProperty, kd = (e, t) => Od(e, "name", {
	value: t,
	configurable: !0
}), Ad = {
	Partial: "partial",
	Always: "always"
}, jd = {
	Optimized: "optimized",
	Always: "always"
}, Md = "Popper", [Nd, Pd] = /* @__PURE__ */ _s(Md), [Fd, Id] = Nd(Md), Ld = /* @__PURE__ */ kd((e) => {
	let { __scopePopper: t, children: n } = e, [r, i] = a.useState(null), [o, s] = a.useState(void 0);
	return /* @__PURE__ */ y(Fd, {
		scope: t,
		anchor: r,
		onAnchorChange: i,
		placementState: o,
		setPlacementState: s,
		children: n
	});
}, "Popper"), Rd = "PopperAnchor", zd = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ kd(function(e, t) {
	let { __scopePopper: n, virtualRef: r, ...i } = e, o = Id(Rd, n), s = a.useRef(null), c = o.onAnchorChange, l = Vo(t, a.useCallback((e) => {
		s.current = e, e && c(e);
	}, [c])), u = a.useRef(null);
	a.useEffect(() => {
		if (!r) return;
		let e = u.current;
		u.current = r.current, e !== u.current && c(u.current);
	});
	let d = o.placementState && Kd(o.placementState), f = d?.[0], p = d?.[1];
	return r ? null : /* @__PURE__ */ y(cs.div, {
		"data-radix-popper-side": f,
		"data-radix-popper-align": p,
		...i,
		ref: l
	});
}, "PopperAnchor")), Bd = "PopperContent", [Vd, Hd] = Nd(Bd), Ud = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ kd(function(e, t) {
	let { __scopePopper: n, side: r = "bottom", sideOffset: i = 0, align: o = "center", alignOffset: s = 0, arrowPadding: c = 0, avoidCollisions: l = !0, collisionBoundary: u = [], collisionPadding: d = 0, sticky: f = Ad.Partial, hideWhenDetached: p = !1, updatePositionStrategy: m = jd.Optimized, onPlaced: h, ...g } = e, _ = Id(Bd, n), [v, b] = a.useState(null), x = Vo(t, b), [S, C] = a.useState(null), w = _l(S), T = w?.width ?? 0, E = w?.height ?? 0, D = r + (o === "center" ? "" : "-" + o), O = typeof d == "number" ? d : {
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		...d
	}, k = Array.isArray(u) ? u : [u], ee = k.length > 0, A = {
		padding: O,
		boundary: k.filter(Wd),
		altBoundary: ee
	}, { refs: j, floatingStyles: M, placement: N, isPositioned: P, middlewareData: F } = yd({
		strategy: "fixed",
		placement: D,
		whileElementsMounted: /* @__PURE__ */ kd((...e) => ad(...e, { animationFrame: m === jd.Always }), "whileElementsMounted"),
		elements: { reference: _.anchor },
		middleware: [
			xd({
				mainAxis: i + E,
				alignmentAxis: s
			}),
			l && Sd({
				mainAxis: !0,
				crossAxis: !1,
				...f === Ad.Partial ? { limiter: Cd() } : {},
				...A
			}),
			l && wd({ ...A }),
			Td({
				...A,
				apply: /* @__PURE__ */ kd(({ elements: e, rects: t, availableWidth: n, availableHeight: r }) => {
					let { width: i, height: a } = t.reference, o = e.floating.style;
					o.setProperty("--radix-popper-available-width", `${n}px`), o.setProperty("--radix-popper-available-height", `${r}px`), o.setProperty("--radix-popper-anchor-width", `${i}px`), o.setProperty("--radix-popper-anchor-height", `${a}px`);
				}, "apply")
			}),
			S && Dd({
				element: S,
				padding: c
			}),
			Gd({
				arrowWidth: T,
				arrowHeight: E
			}),
			p && Ed(ee ? {
				strategy: "referenceHidden",
				...A
			} : {
				strategy: "referenceHidden",
				padding: A.padding,
				altBoundary: A.altBoundary
			})
		]
	}), te = _.setPlacementState;
	q(() => (te(N), () => {
		te(void 0);
	}), [N, te]);
	let [ne, re] = Kd(N), ie = nc(h);
	q(() => {
		P && ie?.();
	}, [P, ie]);
	let I = F.arrow?.x, L = F.arrow?.y, ae = F.arrow?.centerOffset !== 0, [oe, R] = a.useState();
	return q(() => {
		v && R(window.getComputedStyle(v).zIndex);
	}, [v]), /* @__PURE__ */ y("div", {
		ref: j.setFloating,
		"data-radix-popper-content-wrapper": "",
		style: {
			...M,
			transform: P ? M.transform : "translate(0, -200%)",
			minWidth: "max-content",
			zIndex: oe,
			"--radix-popper-transform-origin": [F.transformOrigin?.x, F.transformOrigin?.y].join(" "),
			...F.hide?.referenceHidden && {
				visibility: "hidden",
				pointerEvents: "none"
			}
		},
		dir: e.dir,
		children: /* @__PURE__ */ y(Vd, {
			scope: n,
			placedSide: ne,
			placedAlign: re,
			onArrowChange: C,
			arrowX: I,
			arrowY: L,
			shouldHideArrow: ae,
			children: /* @__PURE__ */ y(cs.div, {
				"data-side": ne,
				"data-align": re,
				...g,
				ref: x,
				style: {
					...g.style,
					animation: P ? g.style?.animation : "none"
				}
			})
		})
	});
}, "PopperContent"));
function Wd(e) {
	return e !== null;
}
kd(Wd, "isNotNull");
var Gd = /* @__PURE__ */ kd((e) => ({
	name: "transformOrigin",
	options: e,
	fn(t) {
		let { placement: n, rects: r, middlewareData: i } = t, a = i.arrow?.centerOffset !== 0, o = a ? 0 : e.arrowWidth, s = a ? 0 : e.arrowHeight, [c, l] = Kd(n), u = {
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
function Kd(e) {
	let [t, n = "center"] = e.split("-");
	return [t, n];
}
kd(Kd, "getSideAndAlignFromPlacement");
// node_modules/@radix-ui/react-popover/dist/index.mjs
var qd = Object.defineProperty, Jd = (e, t) => qd(e, "name", {
	value: t,
	configurable: !0
}), Yd = "Popover", [Xd, Zd] = /* @__PURE__ */ _s(Yd, [Pd]), Qd = Pd(), [$d, ef] = Xd(Yd), tf = /* @__PURE__ */ Jd((e) => {
	let { __scopePopover: t, children: n, open: r, defaultOpen: i, onOpenChange: o, modal: s = !1 } = e, c = Qd(t), l = a.useRef(null), [u, d] = a.useState(!1), [f, p] = a.useState(0), [m, h] = a.useState(0), [g, _] = Ps({
		prop: r,
		defaultProp: i ?? !1,
		onChange: o,
		caller: Yd
	});
	return /* @__PURE__ */ y(Ld, {
		...c,
		children: /* @__PURE__ */ y($d, {
			scope: t,
			contentId: Qs(),
			titleId: Qs(),
			descriptionId: Qs(),
			titlePresent: f > 0,
			descriptionPresent: m > 0,
			setTitleCount: p,
			setDescriptionCount: h,
			triggerRef: l,
			open: g,
			onOpenChange: _,
			onOpenToggle: a.useCallback(() => _((e) => !e), [_]),
			hasCustomAnchor: u,
			onCustomAnchorAdd: a.useCallback(() => d(!0), []),
			onCustomAnchorRemove: a.useCallback(() => d(!1), []),
			modal: s,
			children: n
		})
	});
}, "Popover"), nf = "PopoverAnchor", rf = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Jd(function(e, t) {
	let { __scopePopover: n, ...r } = e, i = ef(nf, n), o = Qd(n), { onCustomAnchorAdd: s, onCustomAnchorRemove: c } = i;
	return a.useEffect(() => (s(), () => c()), [s, c]), /* @__PURE__ */ y(zd, {
		...o,
		...r,
		ref: t
	});
}, "PopoverAnchor")), af = "PopoverPortal", [of, sf] = Xd(af, { forceMount: void 0 }), cf = /* @__PURE__ */ Jd((e) => {
	let { __scopePopover: t, forceMount: n, children: r, container: i } = e, a = ef(af, t);
	return /* @__PURE__ */ y(of, {
		scope: t,
		forceMount: n,
		children: /* @__PURE__ */ y(Hs, {
			present: n || a.open,
			children: /* @__PURE__ */ y(Lc, {
				asChild: !0,
				container: i,
				children: r
			})
		})
	});
}, "PopoverPortal"), lf = "PopoverContent", uf = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Jd(function(e, t) {
	let n = sf(lf, e.__scopePopover), { forceMount: r = n.forceMount, ...i } = e, a = ef(lf, e.__scopePopover);
	return /* @__PURE__ */ y(Hs, {
		present: r || a.open,
		children: a.modal ? /* @__PURE__ */ y(ff, {
			...i,
			ref: t
		}) : /* @__PURE__ */ y(pf, {
			...i,
			ref: t
		})
	});
}, "PopoverContent")), df = /* @__PURE__ */ Wo("PopoverContent.RemoveScroll"), ff = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Jd(function(e, t) {
	let n = ef(lf, e.__scopePopover), r = a.useRef(null), i = Vo(t, r), o = a.useRef(!1), { nodes: s, registry: c } = Cc();
	return a.useEffect(() => {
		let e = r.current;
		if (e) return qc(e);
	}, []), /* @__PURE__ */ y(Kc, {
		as: df,
		allowPinchZoom: !0,
		shards: a.useMemo(() => [r, ...s.map((e) => ({ current: e }))], [r, s]),
		children: /* @__PURE__ */ y(mf, {
			...e,
			ref: i,
			branchNodes: s,
			branchRegistry: c,
			trapFocus: n.open,
			disableOutsidePointerEvents: !0,
			onCloseAutoFocus: J(e.onCloseAutoFocus, (e) => {
				e.preventDefault(), o.current || n.triggerRef.current?.focus();
			}),
			onPointerDownOutside: J(e.onPointerDownOutside, (e) => {
				let t = e.detail.originalEvent, n = t.button === 0 && t.ctrlKey === !0, r = t.button === 2 || n;
				o.current = r;
			}, { checkForDefaultPrevented: !1 }),
			onFocusOutside: J(e.onFocusOutside, (e) => e.preventDefault(), { checkForDefaultPrevented: !1 })
		})
	});
}, "PopoverContentModal")), pf = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Jd(function(e, t) {
	let n = ef(lf, e.__scopePopover), r = a.useRef(!1), i = a.useRef(!1);
	return /* @__PURE__ */ y(mf, {
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
}, "PopoverContentNonModal")), mf = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Jd(function(e, t) {
	let { __scopePopover: n, trapFocus: r, onOpenAutoFocus: i, onCloseAutoFocus: o, disableOutsidePointerEvents: s, onEscapeKeyDown: c, onPointerDownOutside: l, onFocusOutside: u, onInteractOutside: d, "aria-describedby": f, branchNodes: p, branchRegistry: m, ...h } = e, g = ef(lf, n), _ = Qd(n), [v, b] = a.useState(null), x = Vo(t, b);
	return wc(v), Uc(), /* @__PURE__ */ y(Sc, {
		registry: m,
		children: /* @__PURE__ */ y(bc, {
			asChild: !0,
			loop: !0,
			trapped: r,
			branches: p,
			onMountAutoFocus: i,
			onUnmountAutoFocus: o,
			children: /* @__PURE__ */ y(lc, {
				asChild: !0,
				disableOutsidePointerEvents: s,
				onInteractOutside: d,
				onEscapeKeyDown: c,
				onPointerDownOutside: l,
				onFocusOutside: u,
				onDismiss: () => g.onOpenChange(!1),
				deferPointerDownOutside: !0,
				children: /* @__PURE__ */ y(Ud, {
					"data-state": hf(g.open),
					role: "dialog",
					id: g.contentId,
					"aria-labelledby": g.titlePresent ? g.titleId : void 0,
					"aria-describedby": g.descriptionPresent ? gf(f, g.descriptionId) : f,
					..._,
					...h,
					ref: x,
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
function hf(e) {
	return e ? "open" : "closed";
}
Jd(hf, "getState");
function gf(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
Jd(gf, "concatAriaDescribedby");
// node_modules/@radix-ui/react-tooltip/dist/index.mjs
var _f = Object.defineProperty, Q = (e, t) => _f(e, "name", {
	value: t,
	configurable: !0
}), [vf, yf] = /* @__PURE__ */ _s("Tooltip", [Pd]), bf = Pd(), xf = "TooltipProvider", Sf = 700, Cf = "tooltip.open", [wf, Tf] = vf(xf), Ef = /* @__PURE__ */ Q((e) => {
	let { __scopeTooltip: t, delayDuration: n = Sf, skipDelayDuration: r = 300, disableHoverableContent: i = !1, children: o } = e, s = a.useRef(!0), c = a.useRef(!1), l = a.useRef(0);
	return a.useEffect(() => {
		let e = l.current;
		return () => window.clearTimeout(e);
	}, []), /* @__PURE__ */ y(wf, {
		scope: t,
		isOpenDelayedRef: s,
		delayDuration: n,
		onOpen: a.useCallback(() => {
			r <= 0 || (window.clearTimeout(l.current), s.current = !1);
		}, [r]),
		onClose: a.useCallback(() => {
			r <= 0 || (window.clearTimeout(l.current), l.current = window.setTimeout(() => s.current = !0, r));
		}, [r]),
		isPointerInTransitRef: c,
		onPointerInTransitChange: a.useCallback((e) => {
			c.current = e;
		}, []),
		disableHoverableContent: i,
		children: o
	});
}, "TooltipProvider"), Df = "Tooltip", [Of, kf] = vf(Df), Af = /* @__PURE__ */ Q((e) => {
	let { __scopeTooltip: t, children: n, open: r, defaultOpen: i, onOpenChange: o, disableHoverableContent: s, delayDuration: c } = e, l = Tf(Df, e.__scopeTooltip), u = bf(t), [d, f] = a.useState(null), [p, m] = a.useState(void 0), h = Qs(), g = a.useRef(0), _ = s ?? l.disableHoverableContent, v = c ?? l.delayDuration, b = a.useRef(!1), [x, S] = Ps({
		prop: r,
		defaultProp: i ?? !1,
		onChange: /* @__PURE__ */ Q((e) => {
			e ? (l.onOpen(), document.dispatchEvent(new CustomEvent(Cf))) : l.onClose(), o?.(e);
		}, "onChange"),
		caller: Df
	}), C = a.useMemo(() => x ? b.current ? "delayed-open" : "instant-open" : "closed", [x]), w = a.useCallback(() => {
		window.clearTimeout(g.current), g.current = 0, b.current = !1, S(!0);
	}, [S]), T = a.useCallback(() => {
		window.clearTimeout(g.current), g.current = 0, S(!1);
	}, [S]), E = a.useCallback(() => {
		window.clearTimeout(g.current), g.current = window.setTimeout(() => {
			b.current = !0, S(!0), g.current = 0;
		}, v);
	}, [v, S]);
	a.useEffect(() => () => {
		g.current &&= (window.clearTimeout(g.current), 0);
	}, []);
	let D = p ?? h;
	return /* @__PURE__ */ y(Ld, {
		...u,
		children: /* @__PURE__ */ y(Of, {
			scope: t,
			contentId: D,
			setContentId: m,
			open: x,
			stateAttribute: C,
			trigger: d,
			onTriggerChange: f,
			onTriggerEnter: a.useCallback(() => {
				l.isOpenDelayedRef.current ? E() : w();
			}, [
				l.isOpenDelayedRef,
				E,
				w
			]),
			onTriggerLeave: a.useCallback(() => {
				_ ? T() : (window.clearTimeout(g.current), g.current = 0);
			}, [T, _]),
			onOpen: w,
			onClose: T,
			disableHoverableContent: _,
			children: n
		})
	});
}, "Tooltip"), jf = "TooltipTrigger", Mf = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Q(function(e, t) {
	let { __scopeTooltip: n, "aria-describedby": r, ...i } = e, o = kf(jf, n), s = Tf(jf, n), c = bf(n), l = Vo(t, a.useRef(null), o.onTriggerChange), u = a.useRef(!1), d = a.useRef(!1), f = a.useCallback(() => u.current = !1, []);
	return a.useEffect(() => () => document.removeEventListener("pointerup", f), [f]), /* @__PURE__ */ y(zd, {
		asChild: !0,
		...c,
		children: /* @__PURE__ */ y(cs.button, {
			"aria-describedby": o.open ? Jf(r, o.contentId) : r,
			"data-state": o.stateAttribute,
			...i,
			ref: l,
			onPointerMove: J(e.onPointerMove, (e) => {
				e.pointerType !== "touch" && !d.current && !s.isPointerInTransitRef.current && (o.onTriggerEnter(), d.current = !0);
			}),
			onPointerLeave: J(e.onPointerLeave, () => {
				o.onTriggerLeave(), d.current = !1;
			}),
			onPointerDown: J(e.onPointerDown, () => {
				o.open && o.onClose(), u.current = !0, document.addEventListener("pointerup", f, { once: !0 });
			}),
			onFocus: J(e.onFocus, () => {
				u.current || o.onOpen();
			}),
			onBlur: J(e.onBlur, o.onClose),
			onClick: J(e.onClick, o.onClose)
		})
	});
}, "TooltipTrigger")), Nf = "TooltipPortal", [Pf, Ff] = vf(Nf, { forceMount: void 0 }), If = /* @__PURE__ */ Q((e) => {
	let { __scopeTooltip: t, forceMount: n, children: r, container: i } = e, a = kf(Nf, t);
	return /* @__PURE__ */ y(Pf, {
		scope: t,
		forceMount: n,
		children: /* @__PURE__ */ y(Hs, {
			present: n || a.open,
			children: /* @__PURE__ */ y(Lc, {
				asChild: !0,
				container: i,
				children: r
			})
		})
	});
}, "TooltipPortal"), Lf = "TooltipContent", Rf = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Q(function(e, t) {
	let n = Ff(Lf, e.__scopeTooltip), { forceMount: r = n.forceMount, side: i = "top", ...a } = e, o = kf(Lf, e.__scopeTooltip);
	return /* @__PURE__ */ y(Hs, {
		present: r || o.open,
		children: o.disableHoverableContent ? /* @__PURE__ */ y(Vf, {
			side: i,
			...a,
			ref: t
		}) : /* @__PURE__ */ y(zf, {
			side: i,
			...a,
			ref: t
		})
	});
}, "TooltipContent")), zf = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Q(function(e, t) {
	let n = kf(Lf, e.__scopeTooltip), r = Tf(Lf, e.__scopeTooltip), i = a.useRef(null), o = Vo(t, i), [s, c] = a.useState(null), { trigger: l, onClose: u } = n, d = i.current, { onPointerInTransitChange: f } = r, p = a.useCallback(() => {
		c(null), f(!1);
	}, [f]), m = a.useCallback((e, t) => {
		let n = e.currentTarget, r = {
			x: e.clientX,
			y: e.clientY
		}, i = Uf(r, Hf(r, n.getBoundingClientRect())), a = Wf(t.getBoundingClientRect()), o = Kf([...i, ...a]);
		c(o), f(!0);
	}, [f]);
	return a.useEffect(() => () => p(), [p]), a.useEffect(() => {
		if (l && d) {
			let e = /* @__PURE__ */ Q((e) => m(e, d), "handleTriggerLeave"), t = /* @__PURE__ */ Q((e) => m(e, l), "handleContentLeave");
			return l.addEventListener("pointerleave", e), d.addEventListener("pointerleave", t), () => {
				l.removeEventListener("pointerleave", e), d.removeEventListener("pointerleave", t);
			};
		}
	}, [
		l,
		d,
		m,
		p
	]), a.useEffect(() => {
		if (s) {
			let e = /* @__PURE__ */ Q((e) => {
				let t = e.target, n = {
					x: e.clientX,
					y: e.clientY
				}, r = l?.contains(t) || d?.contains(t), i = !Gf(n, s);
				r ? p() : i && (p(), u());
			}, "handleTrackPointerGrace");
			return document.addEventListener("pointermove", e), () => document.removeEventListener("pointermove", e);
		}
	}, [
		l,
		d,
		s,
		u,
		p
	]), /* @__PURE__ */ y(Vf, {
		...e,
		ref: o
	});
}, "TooltipContentHoverable")), Bf = /* @__PURE__ */ qo("TooltipContent"), Vf = /* @__PURE__ */ a.forwardRef(/* @__PURE__ */ Q(function(e, t) {
	let { __scopeTooltip: n, children: r, "aria-label": i, id: o, onEscapeKeyDown: s, onPointerDownOutside: c, ...l } = e, u = kf(Lf, n), d = bf(n), { onClose: f } = u, [p, m] = a.useState(null), h = Vo(t, m);
	wc(p), a.useEffect(() => (document.addEventListener(Cf, f), () => document.removeEventListener(Cf, f)), [f]), a.useEffect(() => {
		if (u.trigger) {
			let e = /* @__PURE__ */ Q((e) => {
				e.target instanceof Node && e.target.contains(u.trigger) && f();
			}, "handleScroll");
			return window.addEventListener("scroll", e, { capture: !0 }), () => window.removeEventListener("scroll", e, { capture: !0 });
		}
	}, [u.trigger, f]);
	let { setContentId: g } = u;
	return q(() => (g(o), () => {
		g(void 0);
	}), [o, g]), /* @__PURE__ */ y(lc, {
		asChild: !0,
		disableOutsidePointerEvents: !1,
		onEscapeKeyDown: s,
		onPointerDownOutside: c,
		onFocusOutside: (e) => e.preventDefault(),
		onDismiss: f,
		children: /* @__PURE__ */ b(Ud, {
			"data-state": u.stateAttribute,
			role: i ? void 0 : "tooltip",
			id: i ? void 0 : u.contentId,
			...d,
			...l,
			ref: h,
			style: {
				...l.style,
				"--radix-tooltip-content-transform-origin": "var(--radix-popper-transform-origin)",
				"--radix-tooltip-content-available-width": "var(--radix-popper-available-width)",
				"--radix-tooltip-content-available-height": "var(--radix-popper-available-height)",
				"--radix-tooltip-trigger-width": "var(--radix-popper-anchor-width)",
				"--radix-tooltip-trigger-height": "var(--radix-popper-anchor-height)"
			},
			children: [/* @__PURE__ */ y(Bf, { children: r }), i ? /* @__PURE__ */ y(ps, {
				id: u.contentId,
				role: "tooltip",
				children: i
			}) : null]
		})
	});
}, "TooltipContentImpl"));
function Hf(e, t) {
	let n = Math.abs(t.top - e.y), r = Math.abs(t.bottom - e.y), i = Math.abs(t.right - e.x), a = Math.abs(t.left - e.x);
	switch (Math.min(n, r, i, a)) {
		case a: return "left";
		case i: return "right";
		case n: return "top";
		case r: return "bottom";
		default: throw Error("unreachable");
	}
}
Q(Hf, "getExitSideFromRect");
function Uf(e, t, n = 5) {
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
Q(Uf, "getPaddedExitPoints");
function Wf(e) {
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
Q(Wf, "getPointsFromRect");
function Gf(e, t) {
	let { x: n, y: r } = e, i = !1;
	for (let e = 0, a = t.length - 1; e < t.length; a = e++) {
		let o = t[e], s = t[a], c = o.x, l = o.y, u = s.x, d = s.y;
		l > r != d > r && n < (u - c) * (r - l) / (d - l) + c && (i = !i);
	}
	return i;
}
Q(Gf, "isPointInPolygon");
function Kf(e) {
	let t = e.slice();
	return t.sort((e, t) => e.x < t.x ? -1 : e.x > t.x ? 1 : e.y < t.y ? -1 : +(e.y > t.y)), qf(t);
}
Q(Kf, "getHull");
function qf(e) {
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
Q(qf, "getHullPresorted");
function Jf(...e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) if (typeof n == "string") for (let e of String(n).trim().split(/\s+/)) e && t.add(e);
	return t.size > 0 ? Array.from(t).join(" ") : void 0;
}
Q(Jf, "concatAriaDescribedby");
// src/app/ui/compose-refs.ts
function Yf(...e) {
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
var Xf = (e) => e.preventDefault();
function Zf({ open: e, kind: r, content: a, anchor: o, onEscape: s, onOutsidePress: c, inertBackground: l = !1 }) {
	let u = t(), d = i(), m = n(), [v] = g(() => ({})), y = h(null), b = h(null);
	return f(() => {
		e && (b.current = document.activeElement);
	}, [e]), p(() => {
		y.current = {
			kind: r,
			content: a,
			anchor: o,
			onEscape: s,
			onOutsidePress: c,
			inertBackground: l,
			ownsKeyboard: d,
			inertTarget: m
		};
	}), p(() => {
		if (e) return u.open(v, y, b.current), () => u.close(v);
	}, [
		e,
		u,
		v
	]), p(() => {
		u.refresh();
	}, [
		u,
		l,
		m
	]), {
		covered: _(u.subscribe, () => u.hasModalAbove(v), () => !1),
		isTop: () => u.isTop(v),
		skipFocusRestore: () => u.skipFocusRestore(v),
		markPressInside: () => u.markPressInside(v)
	};
}
// src/app/ui/tooltip.tsx
var Qf = a.createContext(null);
function $f(e) {
	let t = document.activeElement;
	return !!t && !!e?.contains(t) && t.matches(":focus-visible");
}
function ep({ delayDuration: e = 0, ...t }) {
	return /* @__PURE__ */ y(Ef, {
		delayDuration: e,
		...t
	});
}
function tp({ open: e, defaultOpen: t = !1, onOpenChange: n, delayDuration: r, disableHoverableContent: i, children: o }) {
	let [s, c] = a.useState(t), l = e ?? s, u = (t) => {
		e === void 0 && c(t), n?.(t);
	}, d = a.useRef(null), f = a.useRef(null), p = a.useMemo(() => ({
		content: d,
		trigger: f
	}), []), m = a.useRef(!1);
	return Zf({
		open: l,
		kind: "hint",
		content: d,
		onEscape: () => u(!1)
	}), a.useLayoutEffect(() => {
		let e = (e) => {
			e.target instanceof Node && e.target.contains(f.current) && (m.current = !0, setTimeout(() => {
				m.current = !1;
			}));
		};
		return window.addEventListener("scroll", e, { capture: !0 }), () => window.removeEventListener("scroll", e, { capture: !0 });
	}, []), /* @__PURE__ */ y(Qf.Provider, {
		value: p,
		children: /* @__PURE__ */ y(ep, {
			delayDuration: r,
			disableHoverableContent: i,
			children: /* @__PURE__ */ y(Af, {
				open: l,
				onOpenChange: (e) => {
					!e && m.current && $f(f.current) || u(e);
				},
				children: o
			})
		})
	});
}
function np({ ref: e, ...t }) {
	let n = a.useContext(Qf), r = a.useMemo(() => Yf(e, n?.trigger), [e, n]);
	return /* @__PURE__ */ y(Mf, {
		"data-slot": "tooltip-trigger",
		...t,
		ref: r
	});
}
function rp({ className: t, sideOffset: n = 8, collisionPadding: r = 8, container: i, nonInteractive: o = !1, ref: s, ...c }) {
	let l = e(), u = a.useContext(Qf), d = a.useMemo(() => Yf(s, u?.content), [s, u]), f = /* @__PURE__ */ y(Rf, {
		"data-slot": "tooltip-content",
		sideOffset: n,
		collisionPadding: r,
		className: U("z-[200]", t),
		...c,
		ref: d,
		onEscapeKeyDown: Xf
	});
	return /* @__PURE__ */ y(If, {
		container: i ?? l,
		children: o ? /* @__PURE__ */ y("div", {
			className: "pointer-events-none",
			children: f
		}) : f
	});
}
// src/app/lib/shortcuts.ts
var ip = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent), ap = ip ? "meta" : "ctrl", op = {
	ctrl: ip ? "⌘" : "⌃",
	control: ip ? "⌘" : "⌃",
	cmd: "⌘",
	command: "⌘",
	meta: ip ? "⌘" : "⊞",
	shift: "⇧",
	alt: ip ? "⌥" : "Alt",
	option: ip ? "⌥" : "Alt",
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
}, sp = (e) => op[e.toLowerCase()] ?? e.toUpperCase(), cp = /* @__PURE__ */ new Set([
	"ctrl",
	"control",
	"meta",
	"cmd",
	"command",
	"alt",
	"option"
]), lp = (e) => e.some((e) => cp.has(e.toLowerCase())), up = (e) => {
	let t = e.toLowerCase();
	return t === "control" ? "ctrl" : t === "cmd" || t === "command" ? "meta" : t === "option" ? "alt" : t;
};
function dp(e, t) {
	let n = /* @__PURE__ */ new Set();
	e.ctrlKey && n.add("ctrl"), e.metaKey && n.add("meta"), e.altKey && n.add("alt"), e.shiftKey && n.add("shift"), e.key && n.add(e.key.toLowerCase());
	let r = new Set(t.map(up));
	return n.size === r.size && [...r].every((e) => n.has(e));
}
var fp = [
	ap,
	"shift",
	"o"
], pp = fp, mp = fp, hp = [ap, "k"], gp = [ap, "/"], _p = [ap, "n"], vp = [ap, "b"], yp = [ap, "\\"], bp = [
	ap,
	"shift",
	"e"
], xp = [
	{
		id: "palette",
		keys: hp,
		label: "Open the command palette",
		group: "General"
	},
	{
		id: "shortcuts",
		keys: gp,
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
		keys: _p,
		label: "New session",
		group: "Navigation"
	},
	{
		id: "new-in-project",
		keys: mp,
		label: "New session in this project (new project elsewhere)",
		group: "Navigation"
	},
	{
		id: "sidebar",
		keys: vp,
		label: "Toggle the sidebar",
		group: "Navigation"
	},
	{
		id: "next-needs-you",
		keys: bp,
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
		keys: yp,
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
], Sp = [
	"General",
	"Navigation",
	"Session",
	"Attention card"
], Cp = ({ keys: e, inversed: t = !1, spelled: n = !1, className: r = "" }) => e.length === 0 ? null : /* @__PURE__ */ y("div", {
	className: U("flex gap-[3px]", r),
	children: e.map((e, r) => /* @__PURE__ */ y("kbd", {
		className: U("type-tag inline-flex h-4 min-w-4 items-center justify-center rounded-xs border px-1 leading-none", t ? "text-secondary-inverse border-tertiary-inversed" : "border-tertiary bg-[var(--f-wash-1)] text-basic-tertiary"),
		children: n ? e : sp(e)
	}, r))
}), wp = a.createContext(null);
function Tp(e) {
	let t = a.useContext(wp);
	if (!t) throw Error(`${e} must be rendered inside Popover`);
	return t;
}
function Ep({ open: e, defaultOpen: t = !1, onOpenChange: n, closeOnEscape: r = !0, closeOnOutsidePress: i = !0, children: o }) {
	let [s, c] = a.useState(t), l = e ?? s, u = (t) => {
		e === void 0 && c(t), n?.(t);
	}, d = () => u(!1), f = a.useRef(null), p = a.useRef(null), m = Zf({
		open: l,
		kind: "panel",
		content: f,
		anchor: p,
		onEscape: r ? d : void 0,
		onOutsidePress: i ? d : void 0
	});
	return /* @__PURE__ */ y(wp.Provider, {
		value: {
			layer: m,
			content: f,
			anchor: p
		},
		children: /* @__PURE__ */ y(tf, {
			open: l,
			onOpenChange: u,
			modal: !1,
			children: o
		})
	});
}
function Dp({ ref: e, ...t }) {
	let { anchor: n } = Tp("PopoverAnchor"), r = a.useMemo(() => Yf(e, n), [e, n]);
	return /* @__PURE__ */ y(rf, {
		"data-slot": "popover-anchor",
		ref: r,
		...t
	});
}
function Op({ className: t, align: n = "center", sideOffset: r = 8, collisionPadding: i = 8, portal: o = !0, container: s, role: c, onCloseAutoFocus: l, onMouseDownCapture: u, ref: d, ...f }) {
	let { layer: p, content: m } = Tp("PopoverContent"), h = e(), g = a.useMemo(() => Yf(d, m), [d, m]), _ = /* @__PURE__ */ y(uf, {
		"data-slot": "popover-content",
		align: n,
		sideOffset: r,
		collisionPadding: i,
		className: U("z-[120] bg-popover text-popover-foreground outline-none", t),
		...f,
		role: c,
		ref: g,
		onEscapeKeyDown: Xf,
		onInteractOutside: Xf,
		onCloseAutoFocus: (e) => {
			l?.(e), e.preventDefault();
		},
		onMouseDownCapture: (e) => {
			u?.(e), p.markPressInside();
		}
	});
	return o ? /* @__PURE__ */ y(cf, {
		container: s ?? h,
		children: _
	}) : _;
}
// src/app/ui/dialog.tsx
var kp = a.createContext(null);
function Ap(e) {
	let t = a.useContext(kp);
	if (!t) throw Error(`${e} must be rendered inside Dialog`);
	return t;
}
function jp({ open: e, defaultOpen: t = !1, onOpenChange: n, layer: r = "modal", inertBackground: i = r === "modal", closeOnEscape: o = !0, onEscape: s, children: c }) {
	let [l, u] = a.useState(t), d = e ?? l, f = (t) => {
		e === void 0 && u(t), n?.(t);
	}, p = () => f(!1), m = a.useRef(null), h = Zf({
		open: d,
		kind: r,
		content: m,
		inertBackground: i,
		onEscape: o ? s ?? p : void 0
	});
	return /* @__PURE__ */ y(kp.Provider, {
		value: {
			layer: h,
			content: m,
			close: p
		},
		children: /* @__PURE__ */ y(tl, {
			open: d,
			onOpenChange: f,
			modal: !1,
			children: c
		})
	});
}
function Mp({ container: t, ...n }) {
	let r = e();
	return /* @__PURE__ */ y(al, {
		container: t ?? r,
		...n
	});
}
function Np(e) {
	if (!e) return;
	let t = (e) => e.preventDefault();
	return e.addEventListener("wheel", t, { passive: !1 }), e.addEventListener("touchmove", t, { passive: !1 }), () => {
		e.removeEventListener("wheel", t), e.removeEventListener("touchmove", t);
	};
}
function Pp({ asChild: e = !1, dismissible: t = !0, className: n, onMouseDown: r, onClick: i, ref: o, ...s }) {
	let { layer: c, close: l } = Ap("DialogOverlay"), u = a.useRef(!1), d = a.useMemo(() => Yf(o, Np), [o]);
	return /* @__PURE__ */ y(e ? Go : "div", {
		"data-slot": "dialog-overlay",
		className: U(!e && "fixed inset-0", n),
		...s,
		ref: d,
		onMouseDown: (e) => {
			r?.(e), u.current = e.button === 0 && c.isTop();
		},
		onClick: (e) => {
			i?.(e);
			let n = u.current;
			u.current = !1, t && n && !e.defaultPrevented && l();
		}
	});
}
function Fp(e) {
	return Array.from(e.querySelectorAll(r)).filter((t) => {
		if (t.tabIndex < 0 || t.matches(":disabled, input[type=hidden]") || t.closest("[hidden], [inert]") || getComputedStyle(t).visibility === "hidden") return !1;
		for (let n = t; n; n = n.parentElement) {
			if (getComputedStyle(n).display === "none") return !1;
			if (n === e) break;
		}
		return !0;
	}).sort((e, t) => (e.tabIndex || Infinity) - (t.tabIndex || Infinity));
}
function Ip({ onCloseAutoFocus: e, onKeyDown: t, onMouseDownCapture: n, ref: r, ...i }) {
	let { layer: o, content: s } = Ap("DialogContent"), c = a.useMemo(() => Yf(r, s), [r, s]);
	return /* @__PURE__ */ y(sl, {
		"data-slot": "dialog-content",
		"data-covered": o.covered ? "" : void 0,
		...i,
		ref: c,
		onEscapeKeyDown: Xf,
		onInteractOutside: Xf,
		onCloseAutoFocus: (t) => {
			e?.(t), t.preventDefault();
		},
		onMouseDownCapture: (e) => {
			n?.(e), o.markPressInside();
		},
		onKeyDown: (e) => {
			t?.(e);
			let n = e.currentTarget;
			if (e.defaultPrevented || e.key !== "Tab" || !o.isTop()) return;
			let r = n.ownerDocument.activeElement;
			if (!n.contains(r)) return;
			let i = Fp(n), a = i[0], s = i.at(-1), c = e.shiftKey ? s : a;
			(!c || r === n || (e.shiftKey ? r === a : r === s)) && (e.preventDefault(), (c ?? n).focus());
		}
	});
}
function Lp(e) {
	return /* @__PURE__ */ y(dl, {
		"data-slot": "dialog-title",
		...e
	});
}
function Rp(e) {
	return /* @__PURE__ */ y(fl, {
		"data-slot": "dialog-description",
		...e
	});
}
// src/app/ui/sheet.tsx
var zp = {
	top: "inset-x-0 top-0",
	right: "inset-y-0 right-0 h-full",
	bottom: "inset-x-0 bottom-0",
	left: "inset-y-0 left-0 h-full"
};
function Bp({ layer: e = "sheet", ...t }) {
	return /* @__PURE__ */ y(jp, {
		layer: e,
		...t
	});
}
function Vp({ side: e = "right", className: t, ...n }) {
	return /* @__PURE__ */ y(Ip, {
		"data-slot": "sheet-content",
		"data-side": e,
		className: U("fixed flex flex-col outline-none", zp[e], t),
		...n
	});
}
// src/app/atoms/cover-background/index.tsx
var Hp = ({ open: e = !1, zIndex: t = 40, opacity: n, blur: r = 0, className: i = "", style: a, ...o }) => /* @__PURE__ */ y("div", {
	className: U("fixed inset-0 transition-opacity duration-200 ease-out motion-reduce:transition-none", e ? "opacity-100" : "opacity-0 pointer-events-none", i),
	style: {
		background: n == null ? "var(--f-scrim)" : `oklch(0.14 0.006 85 / ${n})`,
		zIndex: t,
		backdropFilter: r ? `blur(${r}px)` : void 0,
		...a
	},
	...o
}), Up = 200, Wp = ({ open: e, onClose: t, closeOnEscape: n = !0, zIndex: r = 120, className: i = "", children: a }) => {
	let [o, s] = g(e), [c, l] = g(!0), [u, f] = g(e), p = h(""), m = x();
	return u !== e && (f(e), l(!0), e && s(!0)), d(() => {
		if (!e || !o) return;
		let t = 0, n = requestAnimationFrame(() => {
			t = requestAnimationFrame(() => l(!1));
		});
		return () => {
			cancelAnimationFrame(n), cancelAnimationFrame(t);
		};
	}, [e, o]), d(() => {
		if (e || !o) return;
		let t = setTimeout(() => s(!1), Up);
		return () => clearTimeout(t);
	}, [e, o]), d(() => {
		p.current && p.current !== m.pathname && o && t(), p.current = m.pathname;
	}, [
		m.pathname,
		o,
		t
	]), o ? /* @__PURE__ */ y(Bp, {
		open: e,
		closeOnEscape: n,
		onOpenChange: (e) => {
			e || t();
		},
		children: /* @__PURE__ */ b(Mp, {
			forceMount: !0,
			children: [/* @__PURE__ */ y(Pp, {
				asChild: !0,
				children: /* @__PURE__ */ y(Hp, {
					open: !c,
					zIndex: r
				})
			}), /* @__PURE__ */ b(Vp, {
				side: "bottom",
				forceMount: !0,
				role: void 0,
				onOpenAutoFocus: (e) => e.preventDefault(),
				style: { zIndex: r },
				className: U("fixed inset-x-0 bottom-0 flex flex-col min-h-[120px] max-h-[min(75dvh,calc(100%-16px))] overflow-y-auto overscroll-contain", "rounded-t-sheet bg-elevation-level-2 pt-1 pb-[calc(12px+env(safe-area-inset-bottom))] shadow-2xl", "transition-transform duration-200 ease-[var(--ease-drawer)] motion-reduce:transition-none [&>*]:shrink-0", c ? "translate-y-full" : "translate-y-0", i),
				onMouseDown: (e) => e.stopPropagation(),
				onClick: (e) => e.stopPropagation(),
				children: [/* @__PURE__ */ y("div", {
					"aria-hidden": !0,
					className: "flex justify-center pt-1 pb-2",
					children: /* @__PURE__ */ y("span", { className: "h-1 w-9 rounded-pill bg-[var(--f-wash-4)]" })
				}), a]
			})]
		})
	}) : null;
}, Gp = "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex=\"-1\"])", Kp = (e) => Array.from(e.querySelectorAll(Gp)).filter((e) => e.tabIndex >= 0 && !e.matches(":disabled") && !e.closest("[inert], [hidden]"));
function qp({ open: e, label: t, children: n }) {
	let r = h(null);
	return p(() => {
		let t = r.current;
		if (!e || !t) return;
		(Kp(t)[0] ?? t).focus({ preventScroll: !0 });
		let n = (e) => {
			if (e.key === "Tab") {
				e.preventDefault(), e.stopPropagation();
				let n = Kp(t), r = n.indexOf(document.activeElement);
				(n[e.shiftKey ? (r <= 0 ? n.length : r) - 1 : (r + 1) % n.length] ?? t).focus({ preventScroll: !0 });
			}
		};
		return t.addEventListener("keydown", n), () => {
			t.removeEventListener("keydown", n);
		};
	}, [e]), p(() => {
		let t = r.current;
		e && t && (document.activeElement === document.body || t.contains(document.activeElement) && document.activeElement?.matches(":disabled")) && (Kp(t)[0] ?? t).focus({ preventScroll: !0 });
	}), /* @__PURE__ */ y("div", {
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
var Jp = /* @__PURE__ */ function(e) {
	return e.Small = "w-[240px]", e.Medium = "w-[320px]", e.Large = "w-[400px]", e.Fit = "w-max", e.TriggerWidth = "min-w-[var(--radix-popover-trigger-width)]", e;
}({}), Yp = "type-body-chrome flex flex-col gap-0.5 p-1.5 rounded-xl bg-elevation-level-3 shadow-lg fade motion-reduce:!animate-none [&>*]:shrink-0", Xp = ({ open: e, onClose: t, content: n, children: r, placement: i = Ao.BottomRight, size: a = "w-[320px]", sticky: o = !1, closeOnOutsideClick: s = !0, closeOnEscape: c = !0, sheetOnMobile: l = !0, className: u = "", panelClassName: d = "", sheetClassName: f = "", focusScope: p }) => {
	let h = Fo() && l, _ = e && !h, v = p ? /* @__PURE__ */ y(qp, {
		open: e,
		label: p,
		children: n
	}) : n, [x, S] = g(null), C = m(() => _ && o && x ? Mo(x) : [], [
		_,
		o,
		x
	]), { side: w, align: T } = jo[i];
	return /* @__PURE__ */ y(Ep, {
		open: _,
		onOpenChange: (e) => {
			e || t();
		},
		closeOnEscape: c,
		closeOnOutsidePress: s,
		children: /* @__PURE__ */ b(Dp, {
			ref: S,
			className: U("relative w-fit h-fit leading-[0]", u),
			children: [
				r,
				h ? /* @__PURE__ */ y(Wp, {
					open: e,
					onClose: t,
					closeOnEscape: c,
					className: f,
					children: v
				}) : null,
				_ ? /* @__PURE__ */ y(Op, {
					forceMount: !0,
					portal: o,
					side: w,
					align: T,
					sideOffset: 8,
					collisionPadding: 8,
					collisionBoundary: o ? C : void 0,
					onOpenAutoFocus: (e) => e.preventDefault(),
					className: U(Yp, "text-inherit", a, o ? "z-[120]" : "z-30", d),
					children: v
				}) : null
			]
		})
	});
};
Xp.Placement = Ao, Xp.Size = Jp;
// src/app/atoms/tooltip/index.tsx
var Zp = "tooltip-box text-left w-max h-fit max-w-[260px] flex flex-col gap-0.5 shadow-md bg-elevation-ground-inverse px-2 py-1.5 rounded-md fade motion-reduce:!animate-none", Qp = ({ title: e, description: t, keyboardShortcuts: n = [], inverted: r = !0, isMobile: i = !1 }) => /* @__PURE__ */ b(v, { children: [/* @__PURE__ */ b("div", {
	className: "flex gap-2 items-center",
	children: [/* @__PURE__ */ y("div", {
		className: U(i ? "type-label" : "type-meta-strong", "flex-grow", r ? "text-primary-inverse" : "text-basic-primary"),
		children: e
	}), n.length > 0 ? /* @__PURE__ */ y(Cp, {
		keys: n,
		inversed: r
	}) : null]
}), t ? /* @__PURE__ */ y("div", {
	className: U("w-fit h-fit", r ? "type-meta text-secondary-inverse" : "type-body-chrome text-basic-secondary"),
	children: t
}) : null] }), $p = ({ title: e, description: t, keyboardShortcuts: n, className: r, children: i }) => {
	let [a, o] = g(!1), s = h(!1), c = (e) => {
		e.stopPropagation(), e.type === "touchend" && e.preventDefault(), s.current = !0, o((e) => !e), setTimeout(() => {
			s.current = !1;
		}, 100);
	};
	return /* @__PURE__ */ y(Xp, {
		open: a,
		onClose: () => {
			s.current || o(!1);
		},
		className: r,
		content: /* @__PURE__ */ b("div", {
			className: "px-4 py-2 flex overflow-hidden gap-3",
			children: [/* @__PURE__ */ y(Do, {
				iconName: G.Info,
				size: 20,
				className: "mt-px w-5 min-w-5 max-w-5",
				color: "var(--color-fill-basic-tertiary)"
			}), /* @__PURE__ */ y("div", {
				className: "flex flex-col gap-2 min-w-0",
				children: /* @__PURE__ */ y("div", {
					className: "flex flex-col gap-2",
					children: /* @__PURE__ */ y(Qp, {
						title: e,
						description: t,
						keyboardShortcuts: n,
						inverted: !1,
						isMobile: !0
					})
				})
			})]
		}),
		children: /* @__PURE__ */ y("div", {
			onClick: c,
			onTouchEnd: c,
			className: "inline-block",
			children: i
		})
	});
};
function em({ ref: e, "aria-describedby": t, ...n }) {
	let r = h(null), i = m(() => Yf(e, r), [e]);
	return p(() => {
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
	}, [t]), /* @__PURE__ */ y("div", {
		...n,
		ref: i,
		"aria-describedby": t
	});
}
var tm = ({ title: e = "", description: t, keyboardShortcuts: n = [], position: r = Ao.TopCenter, className: i = "", boxClassName: a = "", disabled: o = !1, sticky: s = !1, showTooltipOnMobile: c = !1, children: l }) => {
	let u = Fo(), [d, f] = g(!1), p = !o && !u;
	if (d && !p && f(!1), s && c && u) return /* @__PURE__ */ y($p, {
		title: e,
		description: t,
		keyboardShortcuts: n,
		className: i,
		children: l
	});
	let { side: m, align: h } = jo[r];
	return /* @__PURE__ */ b(tp, {
		open: d,
		onOpenChange: (e) => f(e && p),
		disableHoverableContent: !0,
		children: [/* @__PURE__ */ y(np, {
			asChild: !0,
			children: /* @__PURE__ */ y(em, {
				className: U(s ? "w-fit h-fit leading-[0]" : "relative w-fit h-fit leading-[0] group", i),
				onMouseEnter: () => f(p),
				onMouseLeave: () => f(!1),
				onFocus: (e) => {
					let t = e.target;
					t === document.activeElement && !t.matches(":focus-visible") && e.preventDefault();
				},
				children: l
			})
		}), /* @__PURE__ */ y(rp, {
			nonInteractive: !0,
			side: m,
			align: h,
			sideOffset: 8,
			collisionPadding: 8,
			className: U(Zp, "pointer-events-none", a),
			children: /* @__PURE__ */ y(Qp, {
				title: e,
				description: t,
				keyboardShortcuts: n
			})
		})]
	});
};
tm.Position = Ao;
// src/app/ui/button.tsx
var nm = /* @__PURE__ */ function(e) {
	return e.Medium = "btn-medium", e.Small = "btn-small", e.Large = "btn-large", e;
}({}), rm = /* @__PURE__ */ function(e) {
	return e.Primary = "btn-primary", e.Secondary = "btn-secondary", e.SecondaryHighlighted = "btn-secondary-highlighted", e.SecondaryDestructive = "btn-secondary-destructive", e.SecondaryAccent = "btn-secondary-accent", e.SecondaryAccentHighlighted = "btn-secondary-accent-highlighted", e.Tertiary = "btn-tertiary", e.TertiaryDestructive = "btn-tertiary-destructive", e.TertiaryAccent = "btn-tertiary-accent", e.Ghost = "btn-ghost", e.GhostDestructive = "btn-ghost-destructive", e.GhostAccent = "btn-ghost-accent", e.GhostHighlighted = "btn-ghost-highlighted", e.GhostHighlightedAccent = "btn-ghost-highlighted-accent", e;
}({}), im = /* @__PURE__ */ function(e) {
	return e.Icon = "btn-icon", e.IconLeft = "btn-icon-left", e.IconRight = "btn-icon-right", e.Text = "btn-text", e;
}({});
function am({ variant: e = "btn-ghost", size: t = "btn-medium", content: n = "btn-text", disabled: r = !1, className: i } = {}) {
	return U("btn", t, e, n, r && "btn-disabled", i);
}
function om({ variant: e, size: t, content: n, disabled: r, className: i, asChild: a = !1, type: o = "button", ...s }) {
	return /* @__PURE__ */ y(a ? Go : "button", {
		"data-slot": "button",
		type: a ? void 0 : o,
		disabled: r,
		className: am({
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
var sm = {
	"btn-medium": Oo.Small,
	"btn-small": Oo.Small,
	"btn-large": Oo.Small
}, cm = {
	"btn-primary": K.OnPrimary,
	"btn-secondary": K.Neutral,
	"btn-secondary-highlighted": K.Neutral,
	"btn-secondary-destructive": K.Destructive,
	"btn-secondary-accent": K.Brand,
	"btn-secondary-accent-highlighted": K.Brand,
	"btn-tertiary": K.Neutral,
	"btn-tertiary-destructive": K.Destructive,
	"btn-tertiary-accent": K.Brand,
	"btn-ghost": K.Neutral,
	"btn-ghost-destructive": K.Destructive,
	"btn-ghost-accent": K.Brand,
	"btn-ghost-highlighted": K.Neutral,
	"btn-ghost-highlighted-accent": K.Brand
}, lm = ({ size: e = nm.Medium, variant: t = rm.Ghost, content: n = im.Text, disabled: r, className: i = "", children: a, loading: o = !1, type: s = "button", ...c }) => /* @__PURE__ */ y(om, {
	size: e,
	variant: t,
	content: n,
	className: i,
	type: s,
	disabled: r || o,
	"aria-busy": o || void 0,
	...c,
	children: o ? /* @__PURE__ */ b(v, { children: [/* @__PURE__ */ y(ko, {
		size: sm[e],
		variant: cm[t]
	}), /* @__PURE__ */ y("span", {
		className: "sr-only",
		children: a
	})] }) : a
});
lm.Size = nm, lm.Variant = rm, lm.Content = im;
// src/app/hooks/useCopyToClipboard.ts
var um = 2e3;
function dm(e) {
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
function fm() {
	let [e, t] = g("idle"), n = h(null);
	d(() => () => {
		n.current && clearTimeout(n.current);
	}, []);
	let r = l((e) => {
		n.current && clearTimeout(n.current), t(e), n.current = e === "copied" ? setTimeout(() => t("idle"), um) : null;
	}, []), i = l((e) => {
		if (!e) return;
		let t = () => r(dm(e) ? "copied" : "failed");
		navigator.clipboard?.writeText ? navigator.clipboard.writeText(e).then(() => r("copied")).catch(t) : t();
	}, [r]);
	return {
		copied: e === "copied",
		outcome: e,
		copy: i
	};
}
// src/app/atoms/button/CopyButton.tsx
var pm = ({ value: e, size: t = nm.Small, variant: n = rm.Tertiary, content: r = im.Icon, position: i = Ao.BottomCenter, title: a = "Copy", iconSize: o, onCopy: s, className: c = "", children: l, ...u }) => {
	let { copied: d, copy: f } = fm(), p = d ? "Copied" : a;
	return /* @__PURE__ */ y(tm, {
		title: p,
		position: i,
		sticky: !0,
		children: /* @__PURE__ */ y(lm, {
			size: t,
			variant: n,
			content: r,
			className: c,
			"aria-label": p,
			onClick: () => {
				f(e), s?.();
			},
			...u,
			children: l ?? /* @__PURE__ */ y(Do, {
				iconName: d ? G.Check : G.FileCopy,
				size: o,
				className: "fade"
			})
		})
	});
}, mm = ({ variant: e = rm.Ghost, content: t = im.Text, disabled: n, className: r = "", buttonClassName: i = "", children: a, loading: o = !1, type: s = "button", ...c }) => {
	let l = r.includes("flex-grow") || r.includes("flex-1"), u = e.startsWith("btn-tertiary"), d = !e.startsWith("btn-primary") && !u;
	return /* @__PURE__ */ y("div", {
		className: U(d && "h-10 rounded-pill bg-elevation-level-3 shadow-md", !d && !u && "h-10 rounded-pill", l ? "flex w-full" : "inline-flex w-fit", r),
		children: /* @__PURE__ */ y(lm, {
			size: nm.Large,
			variant: e,
			content: t,
			type: s,
			disabled: n,
			loading: o,
			className: U("btn-sticky", l && "w-full", i),
			...c,
			children: a
		})
	});
};
mm.Variant = rm, mm.Content = im;
// src/app/ui/alert-dialog.tsx
function hm(e) {
	return /* @__PURE__ */ y(jp, {
		...e,
		layer: "modal"
	});
}
function gm({ dismissible: e = !1, ...t }) {
	return /* @__PURE__ */ y(Pp, {
		"data-slot": "alert-dialog-overlay",
		dismissible: e,
		...t
	});
}
function _m(e) {
	return /* @__PURE__ */ y(Ip, {
		"data-slot": "alert-dialog-content",
		role: "alertdialog",
		...e
	});
}
function vm(e) {
	return /* @__PURE__ */ y(Lp, {
		"data-slot": "alert-dialog-title",
		...e
	});
}
// src/app/atoms/modal/index.tsx
var ym = 300, bm = "pt-[calc(56px+env(safe-area-inset-top))]", xm = "pb-[calc(84px+env(safe-area-inset-bottom))]", Sm = /* @__PURE__ */ function(e) {
	return e.Small = "max-w-[420px]", e.Medium = "max-w-[600px]", e.Wide = "max-w-[640px]", e.Large = "max-w-[760px]", e;
}({}), Cm = ({ open: e, onClose: t, onNavigate: n, title: r, subheader: i, headerActions: a, size: o = "max-w-[600px]", zIndex: s = 100, closeOnOverlay: c = !0, flush: l = !1, fullScreen: u = !1, chromeless: f = !1, mobileCloseIcon: p = G.Left, hideClose: m = !1, keepOnNavigate: _ = !1, alert: v = !1, inertOnPhone: S = !1, className: C = "", bodyClassName: w = "", children: T, footer: E }) => {
	let D = Fo(), O = h(null), [k, ee] = g(null), [A, j] = g(0);
	d(() => {
		if (!k || typeof ResizeObserver > "u") return;
		let e = new ResizeObserver(() => j(k.offsetHeight));
		return e.observe(k), () => e.disconnect();
	}, [k]);
	let M = h(""), N = x(), [P, F] = g(e), [te, ne] = g(e), [re, ie] = g(!0);
	if (te !== e && (ne(e), e ? (F(!0), D && ie(!0)) : D ? ie(!0) : F(!1)), d(() => {
		if (!e || !D || !P) return;
		let t = 0, n = requestAnimationFrame(() => {
			t = requestAnimationFrame(() => ie(!1));
		});
		return () => {
			cancelAnimationFrame(n), cancelAnimationFrame(t);
		};
	}, [
		e,
		D,
		P
	]), d(() => {
		if (e || !D || !P) return;
		let t = setTimeout(() => F(!1), ym);
		return () => clearTimeout(t);
	}, [
		e,
		D,
		P
	]), d(() => {
		e && O.current?.focus();
	}, [e]), d(() => {
		M.current && M.current !== N.pathname && e && !_ && (n ?? t)?.(), M.current = N.pathname;
	}, [
		N.pathname,
		e,
		t,
		n,
		_
	]), !P) return null;
	let I = v ? hm : jp, L = v ? gm : Pp, ae = v ? _m : Ip, oe = v ? vm : Lp, R = c && !D, se = (e) => D ? /* @__PURE__ */ y(mm, {
		variant: rm.Ghost,
		content: im.Icon,
		className: "shrink-0",
		"aria-label": "Close",
		onClick: t,
		children: /* @__PURE__ */ y(Do, { iconName: e })
	}) : /* @__PURE__ */ y(lm, {
		variant: rm.Ghost,
		size: nm.Medium,
		content: im.Icon,
		className: U("shrink-0", e === G.Close && "btn-icon-rotate"),
		"aria-label": "Close",
		onClick: t,
		children: /* @__PURE__ */ y(Do, { iconName: e })
	}), ce = u && !D, le = D && !i, ue = f && (ce || D) && t && !m, de = U("flex min-w-0 flex-1 items-center text-basic-primary", D ? "type-heading" : "type-subheading"), fe = /* @__PURE__ */ b("div", {
		className: U("flex items-center", i ? D ? "min-h-14" : "min-h-[52px]" : "h-full", D ? U("gap-3 py-1 pl-2", a ? "pr-1" : "pr-4") : "gap-2 py-1 pl-5 pr-2.5"),
		children: [
			D && t ? se(p) : null,
			r ? /* @__PURE__ */ y(oe, {
				asChild: !0,
				children: /* @__PURE__ */ y("div", {
					className: de,
					children: r
				})
			}) : /* @__PURE__ */ y("div", { className: de }),
			a ? /* @__PURE__ */ y("div", {
				className: "flex shrink-0 items-center gap-1",
				children: a
			}) : null,
			!D && t ? se(G.Close) : null
		]
	}), pe = !f && (r || i || a || t) ? /* @__PURE__ */ b("header", {
		className: U("flex flex-col", D ? U("fade-from-top z-10 pt-[env(safe-area-inset-top)]", i ? "shrink-0" : "h-[calc(56px+env(safe-area-inset-top))]", le ? "absolute inset-x-0 top-0" : "shrink-0") : U("shrink-0 border-b border-muted", i ? "min-h-[52px]" : "h-[52px]")),
		children: [fe, i ? /* @__PURE__ */ y("div", {
			className: D ? "px-4 pb-3" : "px-5 pb-3",
			children: i
		}) : null]
	}) : null, me = e && !re ? "translate-x-0 data-[covered]:translate-x-[-30px]" : "translate-x-full";
	return /* @__PURE__ */ y(I, {
		open: e,
		onOpenChange: (e) => {
			e || t?.();
		},
		inertBackground: !D || S,
		children: /* @__PURE__ */ b(Mp, {
			forceMount: !0,
			children: [/* @__PURE__ */ y(L, {
				asChild: !0,
				dismissible: R,
				children: /* @__PURE__ */ y(Hp, {
					open: e && (!D || !re),
					zIndex: s,
					className: D ? "!duration-300" : void 0
				})
			}), /* @__PURE__ */ y("div", {
				style: { zIndex: s },
				className: U("pointer-events-none fixed inset-0 z-[100] flex", !D && "items-center justify-center p-4"),
				children: /* @__PURE__ */ b(ae, {
					ref: O,
					forceMount: !0,
					"aria-modal": "true",
					"aria-label": typeof r == "string" ? r : void 0,
					tabIndex: -1,
					"data-modal-open": e ? "true" : void 0,
					onOpenAutoFocus: (e) => e.preventDefault(),
					className: U("pointer-events-auto relative flex flex-col outline-none", D ? U("rounded-none transition-transform duration-300 ease-in-out motion-reduce:transition-none", me, !f && "bg-elevation-ground") : U("fade w-full motion-reduce:!animate-none", o, f ? "shadow-none" : "max-h-[calc(100vh-2rem)] overflow-hidden rounded-sheet bg-elevation-level-2 shadow-2xl", ce && "h-full max-h-none min-h-0 w-full max-w-none overflow-hidden"), C, D && "h-[min(100%,100dvh)] max-h-[min(100%,100dvh)] min-h-[min(100%,100dvh)] w-full min-w-full max-w-full"),
					children: [
						ue ? /* @__PURE__ */ y("div", {
							className: "absolute top-[calc(4px+env(safe-area-inset-top))] right-2 z-10",
							children: se(G.Close)
						}) : null,
						pe,
						/* @__PURE__ */ y("div", {
							className: U("flex w-full min-h-0 flex-auto flex-col overflow-auto overscroll-contain", le && !f && bm),
							children: /* @__PURE__ */ y("div", {
								className: U(f ? "flex min-h-0 w-full flex-1 flex-col" : "modal-body paragraph-medium flex flex-col px-5 py-4 text-basic-secondary", D || ce ? "min-h-0 flex-1 overflow-auto" : l && "flex-1", D && E && xm, w),
								style: D && E && A > 72 ? { paddingBottom: `calc(${A + 16}px)` } : void 0,
								children: T
							})
						}),
						E ? /* @__PURE__ */ y("footer", {
							ref: D ? ee : void 0,
							className: U("modal-footer flex items-center justify-end", D ? "modal-footer-mobile fade-from-bottom absolute inset-x-0 bottom-0 z-10 gap-3 px-3 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]" : "shrink-0 gap-2 border-t border-muted px-5 py-3"),
							children: E
						}) : null
					]
				})
			})]
		})
	});
};
Cm.Size = Sm;
var wm = Rp, $ = {
	muted: "#000001",
	accent: "#000002",
	success: "#000003",
	danger: "#000004",
	info: "#000005",
	secondary: "#000006",
	error: "#000007",
	fg: "#000008",
	inserted: "#000009"
}, Tm = {
	[$.muted]: "var(--color-code-comment)",
	[$.accent]: "var(--color-code-keyword)",
	[$.success]: "var(--color-code-string)",
	[$.danger]: "var(--color-code-number)",
	[$.info]: "var(--color-code-function)",
	[$.secondary]: "var(--color-code-variable)",
	[$.error]: "var(--color-text-error-primary)",
	[$.fg]: "var(--color-text-basic-primary)",
	[$.inserted]: "var(--color-text-success-primary)"
};
function Em(e, t, n) {
	return {
		scope: e,
		settings: n ? {
			foreground: t,
			fontStyle: n
		} : { foreground: t }
	};
}
function Dm(e, t) {
	return {
		scope: e,
		settings: { fontStyle: t }
	};
}
var Om = {
	name: "nac",
	type: "light",
	fg: $.fg,
	bg: "#000000",
	colorReplacements: Tm,
	settings: [
		{ settings: {
			foreground: $.fg,
			background: "#000000"
		} },
		Em(["comment", "punctuation.definition.comment"], $.muted, "italic"),
		Em([
			"keyword",
			"storage",
			"storage.type",
			"support.type",
			"entity.name.type",
			"entity.name.tag"
		], $.accent),
		Em(["string", "string.regexp"], $.success),
		Em("markup.inserted", $.inserted),
		Em([
			"constant.numeric",
			"constant.language",
			"constant.character",
			"markup.list"
		], $.danger),
		Em([
			"entity.name.function",
			"support.function",
			"entity.name.section",
			"entity.name.class",
			"entity.name.type.class"
		], $.info),
		Em(["variable", "entity.other.attribute-name"], $.secondary),
		Em("markup.deleted", $.error),
		Dm(["markup.italic", "markup.quote"], "italic"),
		Dm("markup.bold", "bold")
	]
};
// src/app/lib/highlight.ts
function km(e) {
	return {
		color: e.color ?? void 0,
		fontStyle: e.italic ? "italic" : void 0,
		fontWeight: e.bold ? 600 : void 0
	};
}
var Am = {
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
}, jm = {
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
}, Mm = /* @__PURE__ */ new Set([
	"plain",
	"plaintext",
	"text",
	"txt"
]), Nm = 1, Pm = 2, Fm = 50, Im = /* @__PURE__ */ new Map(), Lm = {
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
}, Rm = null, zm = /* @__PURE__ */ new Map();
function Bm(e) {
	let t = e.replace(/\/+$/, "").split("/").pop() ?? "";
	return Am[((t.includes(".") ? t.split(".").pop() : "") ?? "").toLowerCase()] ?? null;
}
function Vm(e) {
	let t = e.trim().toLowerCase();
	if (!t || Mm.has(t)) return null;
	let n = jm[t] ?? t;
	return n in Lm ? n : null;
}
function Hm() {
	return Rm ??= (async () => {
		let [{ createHighlighterCore: e }, { createJavaScriptRegexEngine: t }] = await Promise.all([import("./core-DsPjBpwQ.js"), import("./engine-javascript-DVxm-Bxk.js")]);
		return e({
			themes: [Om],
			langs: [],
			engine: t()
		});
	})(), Rm;
}
async function Um(e) {
	let t = Lm[e];
	if (!t) return !1;
	try {
		let n = await Hm();
		return n.getLoadedLanguages().includes(e) ? !0 : (await n.loadLanguage(t()), n.getLoadedLanguages().includes(e));
	} catch {
		return !1;
	}
}
function Wm(e) {
	let t = zm.get(e);
	return t || (t = Um(e), zm.set(e, t)), t;
}
function Gm(e) {
	let t = e.fontStyle ?? 0, n = {
		text: e.content,
		color: e.color || null
	};
	return t & Nm && (n.italic = !0), t & Pm && (n.bold = !0), n;
}
function Km(e) {
	return e.map((e) => e.map(Gm));
}
function qm(e) {
	return e.map((e) => e.map((e) => e.text).join("")).join("\n");
}
function Jm(e, t) {
	return `${e}\0${t}`;
}
function Ym(e) {
	if (!Im.has(e)) return;
	let t = Im.get(e) ?? null;
	return Im.delete(e), Im.set(e, t), t;
}
function Xm(e, t) {
	if (Im.set(e, t), Im.size <= Fm) return;
	let n = Im.keys().next().value;
	n !== void 0 && Im.delete(n);
}
async function Zm(e, t) {
	let n = Jm(e, t), r = Ym(n);
	if (r !== void 0) return r;
	if (!await Wm(e)) return Xm(n, null), null;
	let i;
	try {
		i = Km((await Hm()).codeToTokensBase(t, {
			lang: e,
			theme: "nac",
			colorReplacements: Tm
		}));
	} catch {
		return Xm(n, null), null;
	}
	return qm(i) === t ? (Xm(n, i), i) : (Xm(n, null), null);
}
async function Qm(e, t) {
	let n = Vm(e);
	return n ? Zm(n, t) : null;
}
async function $m(e, t) {
	let n = Bm(e);
	return n ? Zm(n, t) : null;
}
var eh = /* @__PURE__ */ new Set(["delete", "context"]), th = /* @__PURE__ */ new Set(["insert", "context"]);
async function nh(e, t) {
	let n = /* @__PURE__ */ new Map(), r = Bm(e);
	if (!r) return n;
	for (let e of t) for (let t of e.hunks) for (let e of [eh, th]) {
		let i = t.lines.filter((t) => e.has(t.kind));
		if (i.length === 0) continue;
		let a = await Zm(r, i.map((e) => e.content).join("\n"));
		a && a.length === i.length && i.forEach((e, t) => n.set(e, a[t]));
	}
	return n;
}
// src/app/atoms/code-block/index.tsx
var rh = /* @__PURE__ */ function(e) {
	return e.Small = "code-small", e.Medium = "code-medium", e.Large = "code-large", e;
}({}), ih = ({ code: e, lines: t, lineNumbers: n, wrap: r }) => {
	let i = e.split("\n"), a = t?.length ?? i.length;
	return /* @__PURE__ */ b("div", {
		className: "flex min-w-0",
		children: [n ? /* @__PURE__ */ y("div", {
			"aria-hidden": "true",
			className: "shrink-0 select-none py-3 pl-4 pr-3 text-right tabular text-basic-muted border-r border-muted",
			children: Array.from({ length: a }, (e, t) => /* @__PURE__ */ y("div", { children: t + 1 }, t))
		}) : null, /* @__PURE__ */ y("pre", {
			className: U("flex-1 min-w-0 py-3 px-4 text-basic-primary", r ? "whitespace-pre-wrap break-words" : "overflow-x-auto"),
			children: /* @__PURE__ */ y("code", { children: t ? t.map((e, t) => /* @__PURE__ */ y("div", { children: e.length === 0 ? "\xA0" : e.map((e, t) => /* @__PURE__ */ y("span", {
				style: km(e),
				children: e.text
			}, t)) }, t)) : i.map((e, t) => /* @__PURE__ */ y("div", { children: e || "\xA0" }, t)) })
		})]
	});
}, ah = ({ code: e, language: t, size: n = "code-small", title: r, lineNumbers: i = !1, wrap: a = !1, copyable: o = !0, expandable: s = !1, maxHeight: c, className: l = "" }) => {
	let [u, f] = g(!1), [p, m] = g(null);
	d(() => {
		if (!t) return;
		let n = !0;
		return Qm(t, e).then((r) => {
			n && m({
				code: e,
				language: t,
				lines: r
			});
		}), () => {
			n = !1;
		};
	}, [t, e]);
	let h = p?.code === e && p.language === t ? p.lines : null, _ = /* @__PURE__ */ y(ih, {
		code: e,
		lines: h,
		lineNumbers: i,
		wrap: a
	}), v = r || o || s;
	return /* @__PURE__ */ b("div", {
		className: U("flex flex-col min-w-0 rounded-card overflow-hidden", "bg-[var(--color-code-bg)] border border-tertiary", "code [&>*]:shrink-0", n, l),
		children: [
			v ? /* @__PURE__ */ b("div", {
				className: "flex h-9 items-center gap-1 border-b border-muted pl-4 pr-1.5",
				children: [
					/* @__PURE__ */ y("div", {
						className: "flex-1 min-w-0 truncate type-meta text-basic-tertiary",
						children: r ?? t
					}),
					o ? /* @__PURE__ */ y(pm, {
						value: e,
						title: "Copy code"
					}) : null,
					s ? /* @__PURE__ */ y(lm, {
						variant: rm.Tertiary,
						size: nm.Small,
						content: im.Icon,
						"aria-label": "Expand code",
						onClick: () => f(!0),
						children: /* @__PURE__ */ y(Do, { iconName: G.FullScreen })
					}) : null
				]
			}) : null,
			/* @__PURE__ */ y("div", {
				className: "min-w-0 overflow-auto",
				style: { maxHeight: c },
				children: _
			}),
			s ? /* @__PURE__ */ y(Cm, {
				open: u,
				onClose: () => f(!1),
				title: r ?? t ?? "Code",
				fullScreen: !0,
				flush: !0,
				children: /* @__PURE__ */ y("div", {
					className: U("code", n),
					children: _
				})
			}) : null
		]
	});
};
ah.Size = rh;
// src/app/atoms/toast/Toast.tsx
var oh = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Success = "success", e.Error = "error", e.Danger = "danger", e;
}({}), sh = {
	info: "nac-toast-ink bg-elevation-ground-inverse text-primary-inverse",
	success: "nac-toast-ink bg-elevation-ground-inverse text-primary-inverse",
	error: "bg-elevation-level-3 text-error-primary",
	danger: "bg-elevation-level-3 text-basic-primary"
}, ch = {
	info: "text-secondary-inverse",
	success: "text-secondary-inverse",
	error: "text-error-primary",
	danger: "text-danger-tertiary"
}, lh = {
	info: G.Info,
	success: G.CheckCircle,
	error: G.Danger,
	danger: G.Danger
}, uh = ({ content: e, variant: t, dismissing: n, onClose: r }) => {
	let [i, a] = g(!1);
	d(() => {
		let e = requestAnimationFrame(() => a(!0));
		return () => cancelAnimationFrame(e);
	}, []);
	let o = i && !n, s = t === "error" || t === "danger";
	return /* @__PURE__ */ y("div", {
		className: "nac-toast pointer-events-none flex w-full justify-center",
		"data-visible": o,
		children: /* @__PURE__ */ b("div", {
			className: U("nac-toast-content pointer-events-auto relative flex max-w-full items-start gap-2 rounded-sheet py-1.5 pr-1.5 pl-3.5 shadow-lg", sh[t]),
			children: [
				/* @__PURE__ */ y(Do, {
					iconName: lh[t],
					size: 16,
					className: U("mt-[6px] shrink-0", ch[t])
				}),
				/* @__PURE__ */ y("span", {
					role: s ? "alert" : "status",
					"aria-atomic": "true",
					className: "nac-toast-message type-body-chrome min-w-0 flex-grow py-[4px] break-words [overflow-wrap:anywhere] whitespace-pre-line",
					children: e
				}),
				/* @__PURE__ */ y(lm, {
					variant: lm.Variant.Ghost,
					size: lm.Size.Small,
					content: lm.Content.Icon,
					className: "nac-toast-dismiss !size-7 shrink-0 max-md:!size-11 max-md:-my-2 max-md:-mr-1",
					"aria-label": "Dismiss notification",
					onClick: r,
					children: /* @__PURE__ */ y(Do, { iconName: G.Close })
				})
			]
		})
	});
};
export { K as $, yp as A, lp as B, Bp as C, Lp as D, Mp as E, bp as F, cs as G, tp as H, xp as I, Io as J, Po as K, Sp as L, pp as M, fp as N, Cp as O, _p as P, Oo as Q, gp as R, Wp as S, Pp as T, rp as U, dp as V, np as W, Ao as X, No as Y, ko as Z, rm as _, $m as a, Xp as b, Cm as c, mm as d, Do as et, pm as f, nm as g, im as h, rh as i, ap as j, hp as k, wm as l, lm as m, oh as n, _n as nt, nh as o, fm as p, Fo as q, ah as r, U as rt, km as s, uh as t, G as tt, Sm as u, am as v, Vp as w, Jp as x, tm as y, vp as z };
