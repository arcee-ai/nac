import { $ as e, $n as t, $r as n, $t as r, A as i, Ai as a, An as o, Ar as s, At as c, B as l, Bi as u, Bn as d, Bt as f, C as p, Ci as m, Cn as h, Cr as g, Ct as _, D as v, Di as y, Dn as b, Dr as x, Dt as S, E as C, Ei as w, En as T, Er as E, Et as D, F as O, Fi as k, Fn as ee, Fr as A, Ft as te, G as j, Gi as ne, Gn as re, Gr as ie, Gt as ae, H as oe, Hi as se, Hn as ce, Hr as M, Ht as le, I as ue, Ii as de, In as fe, Ir as N, It as pe, J as P, Ji as me, Jn as F, Jr as I, Jt as he, K as ge, Ki as _e, Kn as L, Kr as R, Kt as ve, L as ye, Li as be, Ln as xe, Lr as Se, Lt as Ce, M as we, Mi as Te, Mn as Ee, Mr as De, Mt as Oe, N as ke, Ni as Ae, Nn as je, Nr as Me, Nt as Ne, O as Pe, Oi as Fe, On as Ie, Or as Le, Ot as Re, P as ze, Pi as Be, Pn as Ve, Pr as He, Pt as Ue, Q as We, Qn as Ge, Qr as Ke, Qt as qe, R as Je, Ri as Ye, Rn as Xe, Rr as Ze, Rt as Qe, S as $e, Si as et, Sn as tt, Sr as z, St as nt, T as rt, Ti as it, Tn as at, Tr as B, Tt as ot, U as st, Ui as ct, Un as lt, Ur as ut, Ut as dt, V as ft, Vi as pt, Vn as mt, Vr as ht, Vt as gt, W as _t, Wi as vt, Wn as yt, Wr as bt, Wt as xt, X as St, Xi as Ct, Xn as wt, Xr as Tt, Xt as Et, Y as Dt, Yi as Ot, Yn as kt, Yr as At, Yt as jt, Z as Mt, Zn as Nt, Zr as Pt, Zt as Ft, _ as It, _i as Lt, _n as Rt, _r as zt, _t as Bt, a as Vt, ai as Ht, an as Ut, ar as Wt, at as Gt, b as Kt, bi as qt, bn as Jt, br as Yt, bt as Xt, c as Zt, ci as Qt, cn as $t, cr as en, ct as tn, d as nn, di as rn, dn as an, dr as on, dt as sn, ei as cn, en as ln, er as un, et as dn, f as fn, fi as pn, fn as mn, fr as hn, ft as gn, g as _n, gi as vn, gn as yn, gr as bn, gt as xn, h as Sn, hi as Cn, hn as wn, hr as Tn, ht as En, i as Dn, ii as On, in as kn, ir as An, it as jn, j as Mn, ji as Nn, jn as Pn, jr as Fn, jt as In, k as Ln, ki as Rn, kn as zn, kr as Bn, kt as Vn, l as Hn, li as Un, ln as Wn, lr as Gn, lt as Kn, m as qn, mi as Jn, mn as Yn, mr as Xn, mt as Zn, n as Qn, ni as V, nn as $n, nr as er, nt as tr, o as nr, oi as rr, on as ir, or as ar, ot as or, p as sr, pi as cr, pn as lr, pt as ur, q as dr, qi as fr, qn as pr, qr as H, qt as mr, ri as hr, rn as gr, rr as _r, rt as vr, s as yr, si as br, sn as xr, sr as Sr, st as Cr, t as wr, ti as Tr, tn as Er, tr as Dr, tt as Or, u as kr, ui as Ar, un as jr, ur as Mr, ut as Nr, v as Pr, vi as Fr, vn as Ir, vr as Lr, vt as Rr, w as zr, wi as Br, wn as Vr, wr as U, wt as Hr, x as Ur, xi as Wr, xn as Gr, xr as Kr, xt as qr, y as Jr, yi as Yr, yn as Xr, yr as Zr, yt as Qr, z as $r, zi as ei, zn as ti, zr as ni, zt as ri } from "./chunks/PerfProfiler-CS2rjEo0.js";
import ii, { Fragment as ai, Suspense as oi, createContext as si, lazy as ci, memo as li, use as ui, useCallback as W, useContext as di, useEffect as G, useId as fi, useLayoutEffect as pi, useMemo as K, useRef as q, useState as J, useSyncExternalStore as mi } from "react";
import { QueryClientProvider as hi, QueryObserver as gi, replaceEqualDeep as _i, useIsFetching as vi, useMutation as yi, useQueries as bi, useQuery as xi, useQueryClient as Si } from "@tanstack/react-query";
import { Link as Ci, Navigate as wi, Outlet as Ti, Route as Ei, Routes as Di, useHref as Oi, useLinkClickHandler as ki, useLocation as Ai, useNavigate as ji, useParams as Mi } from "react-router-dom";
import { Fragment as Y, jsx as X, jsxs as Z } from "react/jsx-runtime";
import { flushSync as Ni } from "react-dom";
// src/app/features/ui-policy/UiPolicyProvider.tsx
var Pi = /* @__PURE__ */ new WeakMap(), Fi = 0;
function Ii(e) {
	let t = Pi.get(e);
	return t === void 0 && (t = ++Fi, Pi.set(e, t)), t;
}
function Li({ children: e, client: t }) {
	let n = V(), r = t ?? n.client, i = xi({
		queryKey: [
			"ui-configuration",
			r.transport.endpoint,
			Ii(r)
		],
		queryFn: async ({ signal: e }) => {
			let t = await r.getUiConfiguration(e);
			if (typeof t.orchestration_enabled != "boolean" || t.diagnostic !== null && typeof t.diagnostic != "string") throw Error("Invalid UI configuration response");
			return t;
		},
		retry: !1,
		staleTime: Infinity
	}), a = K(() => ({ orchestrationEnabled: i.data?.orchestration_enabled === !0 }), [i.data]);
	return i.isPending ? /* @__PURE__ */ X("div", {
		role: "status",
		className: "p-8",
		children: "Loading workspace configuration…"
	}) : i.isError ? /* @__PURE__ */ Z("div", {
		role: "alert",
		className: "p-8",
		children: [
			"Workspace configuration could not be loaded.",
			" ",
			/* @__PURE__ */ X("button", {
				onClick: () => void i.refetch(),
				children: "Try again"
			})
		]
	}) : /* @__PURE__ */ Z(At.Provider, {
		value: a,
		children: [i.data.diagnostic ? /* @__PURE__ */ X("div", {
			role: "alert",
			className: "p-3",
			children: i.data.diagnostic
		}) : null, e]
	});
}
// src/app/atoms/hover-hint/index.tsx
var Ri = /* @__PURE__ */ function(e) {
	return e[e.Small = 16] = "Small", e[e.Medium = 20] = "Medium", e[e.Large = 24] = "Large", e;
}({}), zi = ({ title: e, description: t, size: n = 16, position: r = M.TopCenter, className: i = "", muted: a = !1 }) => /* @__PURE__ */ X(E, {
	title: e,
	description: t,
	position: r,
	sticky: !0,
	showTooltipOnMobile: !0,
	className: i,
	children: /* @__PURE__ */ X(R, {
		iconName: H.Info,
		size: n,
		className: I("cursor-help shrink-0", a && "[&>path]:!fill-basic-muted"),
		color: a ? void 0 : "var(--color-fill-basic-tertiary)"
	})
});
zi.Size = Ri;
// src/app/atoms/tab-button/index.tsx
var Bi = /* @__PURE__ */ function(e) {
	return e.Large = "btn-large", e.Medium = "btn-medium", e.Small = "btn-small", e;
}({}), Vi = /* @__PURE__ */ function(e) {
	return e.Regular = "btn-ghost", e.Accent = "btn-ghost-accent", e.Destructive = "btn-ghost-destructive", e;
}({}), Hi = {
	"btn-ghost": "tab-btn-regular",
	"btn-ghost-accent": "tab-btn-accent",
	"btn-ghost-destructive": "tab-btn-destructive"
}, Ui = ({ size: e = "btn-medium", variant: t = "btn-ghost", active: n = !1, disabled: r, className: i = "", children: a, hoverHint: o, trailing: s, ...c }) => {
	let l = I("btn btn-icon tab-btn w-full", e, Hi[t], n && "tab-btn-active", r && "btn-disabled", i);
	return /* @__PURE__ */ Z("button", {
		onClick: () => {},
		className: l,
		disabled: r,
		...c,
		children: [
			a,
			s,
			o ? /* @__PURE__ */ X("span", {
				className: "inline-flex shrink-0",
				onClick: (e) => e.stopPropagation(),
				onMouseDown: (e) => e.stopPropagation(),
				onKeyDown: (e) => e.stopPropagation(),
				children: /* @__PURE__ */ X(zi, {
					title: o.title,
					description: o.description,
					muted: o.muted,
					position: M.CenterRight
				})
			}) : null
		]
	});
};
Ui.Size = Bi, Ui.Variant = Vi;
// src/app/atoms/action-list-button/index.tsx
var Wi = /* @__PURE__ */ function(e) {
	return e.Ready = "ready", e.Pending = "pending", e.Running = "running", e.Failed = "failed", e;
}({}), Gi = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Large = "large", e;
}({}), Ki = {
	small: {
		button: Bi.Small,
		box: "!h-7 !px-2",
		glyph: 16,
		loader: bt.XSmall
	},
	large: {
		button: Bi.Large,
		box: null,
		glyph: 24,
		loader: bt.Medium
	}
}, qi = {
	pending: "text-btn-secondary-disabled",
	running: "text-shimmer-basic motion-reduce:animate-none"
}, Ji = {
	ready: null,
	pending: "pending",
	running: "running",
	failed: "failed"
};
function Yi({ expanded: e, size: t }) {
	return /* @__PURE__ */ X(R, {
		iconName: H.Right,
		size: t,
		className: I("shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none", e && "rotate-90")
	});
}
function Xi({ icon: e, status: t, expanded: n, size: r }) {
	let { glyph: i, loader: a } = Ki[r];
	if (n !== void 0) return /* @__PURE__ */ X(Yi, {
		expanded: n,
		size: i
	});
	switch (t) {
		case "running": return /* @__PURE__ */ X(ut, {
			size: a,
			className: "shrink-0"
		});
		case "failed": return /* @__PURE__ */ X(R, {
			iconName: H.Close,
			size: i,
			className: "shrink-0 [&>path]:!fill-btn-destructive"
		});
		case "pending": return /* @__PURE__ */ X(R, {
			iconName: H.Clock,
			size: i,
			className: "shrink-0 [&>path]:!fill-btn-secondary-disabled"
		});
		default: return /* @__PURE__ */ X(R, {
			iconName: e,
			size: i,
			className: "shrink-0"
		});
	}
}
var Zi = ({ icon: e, label: t, meta: n, status: r = "ready", size: i = "small", selected: a, expanded: o, onClick: s, className: c }) => {
	let l = Ki[i], u = [
		t,
		n,
		Ji[r]
	].filter(Boolean).join(", ");
	return /* @__PURE__ */ Z(Ui, {
		type: "button",
		size: l.button,
		active: a === !0,
		"aria-pressed": a,
		"aria-expanded": o,
		"aria-label": u,
		disabled: s === null,
		onClick: s ?? void 0,
		className: I(l.box, c),
		children: [
			/* @__PURE__ */ X(Xi, {
				icon: e,
				status: r,
				expanded: o,
				size: i
			}),
			/* @__PURE__ */ X("span", {
				className: I("flex-1 min-w-0 truncate text-left", qi[r]),
				children: t
			}),
			n ? /* @__PURE__ */ X("span", {
				className: "shrink-0 text-[10px] leading-[12px] uppercase text-basic-muted",
				children: n
			}) : null
		]
	});
};
function Qi({ children: e, className: t }) {
	return /* @__PURE__ */ X("div", {
		className: I("flex flex-col gap-1 border-l border-primary py-1 pl-[7px] [&>*]:shrink-0", t),
		children: e
	});
}
// src/app/atoms/avatar/index.tsx
var $i = /* @__PURE__ */ function(e) {
	return e.Micro = "size-4 avatar-xs", e.Small = "size-5 avatar-sm", e.Medium = "size-6 avatar-md", e.Large = "size-8 avatar-xl", e.XLarge = "size-12 avatar-4xl", e.MediumLarge = "size-7 avatar-lg", e.X2Large = "size-9 avatar-2xl", e.X3Large = "size-10 avatar-3xl", e;
}({}), ea = "var(--color-bg-elevation-ground-inverse)", ta = ({ imageUrl: e, name: t, size: n = "size-6 avatar-md", color: r = ea, glyph: i = !1, className: a = "" }) => {
	let [o, s] = ii.useState(null), c = t?.trim() ?? "", l = i ? c : c[0]?.toUpperCase() ?? "?", u = !!e && o !== e;
	return /* @__PURE__ */ X("div", {
		className: I("avatar inline-flex items-center justify-center shrink-0 overflow-hidden rounded-full", n, u ? "border-tertiary bg-elevation-level-3" : I("border-secondary-inversed", i || r !== ea ? "text-primary-inverse" : "text-tertiary-inverse"), a),
		style: u ? void 0 : { background: r },
		children: u ? /* @__PURE__ */ X("img", {
			src: e ?? void 0,
			alt: c,
			className: "size-full rounded-full object-cover",
			onError: () => s(e ?? null)
		}) : l
	});
};
ta.Size = $i;
// src/app/atoms/badge/index.tsx
var na = /* @__PURE__ */ function(e) {
	return e.Neutral = "bg-elevation-sublevel-variant-B text-basic-tertiary border-tertiary", e.Green = "bg-success-secondary text-success-primary border-success-secondary", e.Blue = "bg-info-secondary text-info-primary border-info-secondary", e.Red = "bg-error-secondary text-error-primary border-error-secondary", e.Yellow = "bg-danger-secondary text-danger-primary border-danger-secondary", e.Gray = "bg-elevation-sublevel-variant-A text-basic-secondary border-muted", e;
}({}), ra = {
	"bg-elevation-sublevel-variant-B text-basic-tertiary border-tertiary": "text-basic-muted",
	"bg-success-secondary text-success-primary border-success-secondary": "text-success-primary",
	"bg-info-secondary text-info-primary border-info-secondary": "text-info-primary",
	"bg-error-secondary text-error-primary border-error-secondary": "text-error-primary",
	"bg-danger-secondary text-danger-primary border-danger-secondary": "text-danger-primary",
	"bg-elevation-sublevel-variant-A text-basic-secondary border-muted": "text-basic-secondary"
}, ia = ({ text: e, color: t = "bg-elevation-sublevel-variant-B text-basic-tertiary border-tertiary", background: n = !0, className: r = "" }) => /* @__PURE__ */ X("span", {
	className: I("badge inline-flex items-center justify-center whitespace-nowrap rounded-full", n ? I("badge-filled border", t) : ra[t], r),
	children: e
});
ia.Color = na;
// src/app/atoms/box-surface/index.tsx
var aa = ({ title: e, headerContent: t, footer: n, className: r = "", bodyClassName: i = "", children: a }) => {
	let o = e != null || t != null;
	return /* @__PURE__ */ Z("div", {
		className: I("flex flex-col rounded-[8px] overflow-hidden bg-elevation-level-1 shadow-convex", r),
		children: [
			o ? /* @__PURE__ */ Z("div", {
				className: "flex items-center gap-4 h-14 px-4 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ X("div", {
					className: "header-md text-basic-primary flex-1 min-w-0 truncate",
					children: e
				}), t]
			}) : null,
			/* @__PURE__ */ X("div", {
				className: I("flex-1 min-h-0 flex flex-col [&>*]:shrink-0", i),
				children: a
			}),
			n ? /* @__PURE__ */ X("div", {
				className: "flex items-center p-4 border-t border-muted shrink-0",
				children: n
			}) : null
		]
	});
}, oa = /* @__PURE__ */ function(e) {
	return e.Small = "w-1.5 h-1.5", e.Medium = "w-2 h-2", e.Large = "w-3 h-3", e;
}({}), sa = ({ size: e = "w-2 h-2", className: t = "" }) => /* @__PURE__ */ X("div", {
	role: "status",
	"aria-label": "Waiting for a response",
	className: I("flex items-end gap-1 fade", t),
	children: [
		0,
		1,
		2
	].map((t) => /* @__PURE__ */ X("span", { className: I("chat-loader-dot rounded-full bg-divider-secondary", e) }, t))
});
sa.Size = oa;
// src/app/atoms/chat-session-fork-mark/index.tsx
var ca = ({ forkedFromTitle: e, running: t = !1, className: n = "" }) => {
	if (t) return /* @__PURE__ */ X(ut, {
		size: bt.XSmall,
		variant: ie.Neutral,
		className: "shrink-0"
	});
	let r = e?.trim();
	if (!r) return null;
	let i = `Fork of ${r}`;
	return /* @__PURE__ */ X(E, {
		title: i,
		position: E.Position.BottomCenter,
		sticky: !0,
		className: "shrink-0",
		children: /* @__PURE__ */ X("span", {
			className: "inline-flex shrink-0",
			"aria-label": i,
			children: /* @__PURE__ */ X(R, {
				iconName: H.Scheme,
				size: 16,
				className: I("shrink-0", n)
			})
		})
	});
};
// src/app/lib/animationPhase.ts
function la(e) {
	if (typeof e?.getAnimations == "function") for (let t of e.getAnimations({ subtree: !0 })) t.startTime = 0;
}
function ua(e, t) {
	pi(() => {
		t && la(e.current);
	}, [e, t]);
}
// src/app/atoms/model-loader/index.tsx
var da = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), fa = /* @__PURE__ */ function(e) {
	return e.Default = "default", e.Accent = "accent", e;
}({}), pa = {
	small: {
		box: "size-[16px]",
		dot: "size-[2px]"
	},
	medium: {
		box: "size-[20px]",
		dot: "size-[3px]"
	},
	large: {
		box: "size-[24px]",
		dot: "size-[4px]"
	}
}, ma = {
	default: "bg-btn-primary",
	accent: "bg-accent-inverse"
}, ha = [
	"opacity-0",
	"opacity-25",
	"opacity-100"
], ga = [
	0,
	.25,
	1
], _a = 400, va = 16, ya = "cubic-bezier(0.4, 0, 0.2, 1)", ba = {
	1: [
		[
			2,
			1,
			2,
			0
		],
		[
			0,
			2,
			0,
			1
		],
		[
			1,
			2,
			1,
			0
		],
		[
			0,
			1,
			1,
			2
		]
	].flat(),
	2: [
		[
			0,
			2,
			1,
			1
		],
		[
			2,
			1,
			1,
			2
		],
		[
			0,
			0,
			2,
			1
		],
		[
			1,
			2,
			2,
			0
		]
	].flat(),
	3: [
		[
			1,
			0,
			0,
			2
		],
		[
			1,
			0,
			2,
			0
		],
		[
			2,
			1,
			0,
			2
		],
		[
			2,
			0,
			0,
			1
		]
	].flat()
}, xa = 1, Sa = "(prefers-reduced-motion: reduce)", Ca = () => typeof window.matchMedia == "function" ? window.matchMedia(Sa) : null, wa = (e) => {
	let t = Ca();
	return t?.addEventListener("change", e), () => t?.removeEventListener("change", e);
}, Ta = () => Ca()?.matches ?? !1, Ea = () => Math.floor(Math.random() * ga.length), Da = ba[xa].map((e) => [
	e,
	...Array.from({ length: 15 }, Ea),
	e
].map((e, t) => ({
	offset: t / va,
	opacity: ga[e],
	easing: ya
}))), Oa = ba[xa].map(() => Math.random() * _a), ka = ({ size: e = "medium", variant: t = "default", frame: n, label: r, className: i = "" }) => {
	let a = q(null), o = mi(wa, Ta, Ta), s = n === void 0 && !o;
	pi(() => {
		let e = a.current;
		if (!s || typeof e?.animate != "function") return;
		let t = Array.from(e.children, (e, t) => e.animate(Da[t], {
			duration: va * _a,
			delay: Oa[t],
			iterations: Infinity
		}));
		return la(e), () => t.forEach((e) => e.cancel());
	}, [s]);
	let { box: c, dot: l } = pa[e];
	return /* @__PURE__ */ X("span", {
		ref: a,
		role: r ? "status" : void 0,
		"aria-label": r,
		"aria-hidden": !r || void 0,
		"data-variant": t,
		"data-frame": n,
		className: I("grid shrink-0 grid-cols-4 grid-rows-4 gap-[2px] p-px", c, i),
		children: ba[n ?? xa].map((e, n) => /* @__PURE__ */ X("span", { className: I("rounded-[1px]", l, ma[t], ha[e]) }, n))
	});
};
ka.Size = da, ka.Variant = fa;
// src/app/lib/sessionBehavior.ts
var Aa = [
	{
		id: "orchestrator",
		label: "NAC orchestrator",
		navigationLabel: "Orchestrator",
		topLevel: "A planner handles the top-level conversation.",
		editsDirectly: !1,
		editing: "The planner does not edit directly.",
		delegation: "It delegates coding to retained NAC worker threads.",
		inspection: "Insights and Worksets show the plan and worker progress."
	},
	{
		id: "direct",
		label: "Direct coding agent",
		navigationLabel: "Direct",
		topLevel: "One persistent coding agent handles the top-level conversation.",
		editsDirectly: !0,
		editing: "The top-level agent edits files and runs commands directly.",
		delegation: "It can launch fresh-context traditional coding agents.",
		inspection: "Subagents shows those traditional child sessions."
	},
	{
		id: "direct-with-orchestrator",
		label: "Direct + NAC orchestration",
		navigationLabel: "Direct + NAC",
		topLevel: "One persistent coding agent handles the top-level conversation.",
		editsDirectly: !0,
		editing: "The top-level agent edits files and runs commands directly.",
		delegation: "It can launch traditional coding agents and separate NAC orchestrator sessions.",
		inspection: "Subagents keeps both delegated topologies distinct."
	}
];
function ja(e) {
	return Aa.find((t) => t.id === e) ?? Aa[0];
}
function Ma(e, t) {
	if (t === "managed-orchestrator") return H.Orchestrator;
	if (t === "traditional-child") return H.Plane;
	switch (e) {
		case "direct": return H.Plane;
		case "direct-with-orchestrator": return H.PlaneAdd;
		default: return H.Orchestrator;
	}
}
function Na(e, t) {
	return t === "managed-orchestrator" ? "NAC orchestrator" : t === "traditional-child" ? "Coding agent" : ja(e).label;
}
var Pa = {
	widePanels: [
		"insights",
		"files",
		"worksets"
	],
	mobilePanels: [
		"insights",
		"files",
		"worksets",
		"history"
	],
	defaultPanel: "insights",
	readOnly: !1
}, Fa = {
	widePanels: [
		"insights",
		"delegated",
		"files",
		"terminal"
	],
	mobilePanels: [
		"insights",
		"delegated",
		"files",
		"terminal",
		"history"
	],
	defaultPanel: "insights",
	readOnly: !1
}, Ia = {
	widePanels: ["insights", "files"],
	mobilePanels: [
		"insights",
		"files",
		"history"
	],
	defaultPanel: "insights",
	readOnly: !0
}, La = {
	...Pa,
	readOnly: !0
};
function Ra(e, t) {
	return t === "traditional-child" ? Ia : t === "managed-orchestrator" ? La : ja(e).id === "orchestrator" ? Pa : Fa;
}
// src/app/atoms/session-behavior-icon/index.tsx
var za = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), Ba = {
	small: 16,
	medium: 20,
	large: 24
}, Va = ({ behavior: e, lineage: t, size: n = "medium", className: r }) => {
	let i = Ma(e, t);
	return /* @__PURE__ */ X(R, {
		iconName: i,
		size: Ba[n],
		"aria-hidden": !0,
		"data-session-behavior-icon": i,
		className: I("shrink-0", r)
	});
}, Ha = "[&_path]:fill-btn-secondary group-hover:[&_path]:fill-btn-secondary-hovered group-has-[>button:active]:[&_path]:fill-btn-secondary-pressed group-has-[>button:disabled]:[&_path]:fill-btn-secondary-disabled", Ua = ({ title: e, active: t = !1, running: n = !1, behavior: r, lineage: i, showBehaviorIcon: a = !1, behaviorLabel: o, forkedFromTitle: s, badge: c, badgeLabel: l, unread: u = !1, isMobile: d = !1, actions: f, className: p = "", type: m = "button", "aria-label": h, ...g }) => {
	let _ = [
		e,
		o,
		l
	].filter(Boolean);
	return /* @__PURE__ */ Z("div", {
		className: I("group flex items-center min-w-0 rounded-[4px]", "-outline-offset-2 outline-[var(--color-border-focus-outline)] has-[>button:focus-visible]:outline-2", d ? "h-12 gap-3 py-2 pl-2.5 pr-3" : "h-9 gap-1.5 px-2 py-1", t ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered has-[>button:active]:bg-btn-ghost-highlighted-pressed has-[>button:disabled]:bg-btn-ghost-highlighted-disabled" : "hover:bg-btn-ghost-hovered has-[>button:active]:bg-btn-ghost-pressed has-[>button:disabled]:bg-btn-ghost-disabled", p),
		children: [/* @__PURE__ */ Z("button", {
			type: m,
			title: _.join(" · "),
			"aria-label": h ?? _.join(", "),
			"aria-current": t ? "page" : void 0,
			className: I("flex flex-1 items-center min-w-0 text-left outline-none", t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered active:text-btn-secondary-pressed", "disabled:cursor-not-allowed disabled:text-btn-secondary-disabled", d ? "gap-3" : "gap-1.5"),
			...g,
			children: [
				n ? /* @__PURE__ */ X(ka, { size: d ? da.Large : da.Medium }) : a ? /* @__PURE__ */ X(Va, {
					behavior: r,
					lineage: i,
					size: d ? za.Large : za.Medium,
					className: Ha
				}) : null,
				/* @__PURE__ */ X("span", {
					className: I("min-w-0 flex-1 truncate", d ? "label-medium" : "label-small", n && "text-shimmer-basic"),
					children: e
				}),
				/* @__PURE__ */ X(ca, {
					forkedFromTitle: s,
					className: "[&_path]:fill-btn-secondary-disabled"
				}),
				c ? /* @__PURE__ */ X("span", {
					title: l,
					className: "tag-label max-w-[76px] shrink-0 truncate rounded bg-elevation-level-3 px-1 text-basic-tertiary",
					children: c
				}) : null,
				u ? /* @__PURE__ */ X("span", {
					className: "h-2 w-2 shrink-0 rounded-full bg-accent-primary",
					title: "Updated since last viewed",
					children: /* @__PURE__ */ X("span", {
						className: "sr-only",
						children: "Unread"
					})
				}) : null
			]
		}), f ? /* @__PURE__ */ X("div", {
			className: I("flex items-center shrink-0", d ? "gap-3" : "gap-1 sr-only group-hover:not-sr-only group-has-[:focus-visible]:not-sr-only focus-within:not-sr-only group-has-[>button:disabled]:hidden"),
			children: f
		}) : null]
	});
}, Wa = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), Ga = {
	info: "border-info-primary text-info-primary",
	error: "border-error-primary text-error-primary",
	danger: "border-danger-primary text-danger-primary",
	success: "border-success-primary text-success-primary"
}, Ka = {
	info: H.Info,
	error: H.Close,
	danger: H.Danger,
	success: H.CheckCircle
}, qa = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, Ja = ({ title: e, variant: t = "info", action: n, className: r = "", children: i, ...a }) => /* @__PURE__ */ X("div", {
	className: I("flex w-full items-start overflow-hidden border-l-2 px-4 py-2", Ga[t], r),
	...a,
	children: /* @__PURE__ */ Z("div", {
		className: "flex flex-1 min-w-0 flex-col items-start gap-2",
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex w-full items-start gap-1.5",
				children: [/* @__PURE__ */ X(R, {
					iconName: Ka[t],
					size: 20,
					color: qa[t],
					className: "shrink-0"
				}), /* @__PURE__ */ X("p", {
					className: "flex-1 min-w-0 header-sm break-words !my-0",
					children: e
				})]
			}),
			i ? /* @__PURE__ */ X("div", {
				className: "w-full text-small break-words",
				children: i
			}) : null,
			n ? /* @__PURE__ */ X(z, {
				size: U.Small,
				variant: B.Primary,
				content: g.Text,
				onClick: n.onClick,
				children: n.label
			}) : null
		]
	})
});
Ja.Variant = Wa;
// src/app/atoms/chat-session-orphan-avatar/index.tsx
var Ya = (e) => Math.round(e * .7 / 4) * 4, Xa = (e) => Math.round(e / 10), Za = ({ size: e = 40, isRunning: t = !1, className: n = "", ...r }) => /* @__PURE__ */ X("div", {
	className: I("flex items-center justify-center shrink-0", "border border-muted bg-elevation-sublevel-variant-B", n),
	style: {
		width: e,
		height: e,
		borderRadius: Xa(e)
	},
	"aria-hidden": "true",
	...r,
	children: /* @__PURE__ */ X(R, {
		iconName: H.Chat,
		size: Ya(e),
		className: I("text-basic-secondary", t && "pulse-dim")
	})
}), Qa = li(({ rows: e = 3, className: t = "", rowClassName: n = "" }) => /* @__PURE__ */ X("div", {
	className: I("flex flex-col gap-2", t),
	children: Array.from({ length: e }).map((e, t) => /* @__PURE__ */ X("div", {
		className: I("relative h-4 rounded-[4px] overflow-hidden bg-elevation-level-2", n),
		children: /* @__PURE__ */ X("div", {
			className: "absolute inset-0 animate-shimmer bg-[length:200%_100%] bg-[position:-200%_0] opacity-50",
			style: { backgroundImage: "linear-gradient(90deg, transparent 0%, var(--color-bg-btn-secondary-highlighted-hovered) 50%, transparent 100%)" }
		})
	}, t))
})), $a = ({ title: e, active: t = !1, running: n = !1, forkedFromTitle: r, behavior: i, showBehaviorIcon: a = !1, behaviorLabel: o, onDismiss: s, className: c = "", type: l = "button", "aria-label": u, ...d }) => {
	let f = n ? "text-shimmer-basic" : r ? "text-btn-secondary group-hover:text-btn-secondary-hovered" : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered", p = t && !r ? "[&_path]:fill-btn-secondary-pressed" : "[&_path]:fill-btn-secondary group-hover:[&_path]:fill-btn-secondary-hovered", m = /* @__PURE__ */ Z("button", {
		type: l,
		title: e,
		"aria-label": u ?? (o ? `${e}, ${o}` : e),
		"aria-current": t ? "page" : void 0,
		className: "flex h-10 w-full min-w-0 flex-1 items-center justify-start gap-1 py-1 pl-2 pr-2 group-hover:pr-8 group-has-[:focus-visible]:pr-8",
		...d,
		children: [
			/* @__PURE__ */ X(ca, {
				forkedFromTitle: r,
				running: n,
				className: n ? void 0 : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered"
			}),
			a ? /* @__PURE__ */ X(Va, {
				behavior: i,
				size: za.Small,
				className: p
			}) : null,
			/* @__PURE__ */ X("span", {
				"data-session-tab-title": !0,
				className: I("label-micro w-full min-w-0 flex-1 truncate text-left", f),
				children: e
			})
		]
	});
	return /* @__PURE__ */ Z("div", {
		className: I("chat-session-tab group relative flex w-32 max-w-full shrink-0 items-center justify-start gap-1", t ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered" : "hover:bg-btn-ghost-hovered", c),
		children: [o ? /* @__PURE__ */ X(E, {
			title: o,
			position: E.Position.BottomLeft,
			sticky: !0,
			className: "min-w-0 flex-1",
			children: m
		}) : m, s ? /* @__PURE__ */ X(z, {
			variant: B.Tertiary,
			size: U.Small,
			content: g.Icon,
			"aria-label": `Close ${e}`,
			title: "Close tab",
			onClick: (e) => {
				e.stopPropagation(), s();
			},
			className: "absolute right-1 top-1/2 -translate-y-1/2 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto",
			children: /* @__PURE__ */ X(R, { iconName: H.Close })
		}) : null]
	});
}, eo = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ Z("label", {
	className: I("group flex w-fit items-center gap-2", n ? "cursor-not-allowed" : "cursor-pointer", i),
	children: [/* @__PURE__ */ Z("span", {
		className: "relative flex h-5 w-5 shrink-0 items-center justify-center",
		children: [
			/* @__PURE__ */ X("input", {
				type: "checkbox",
				checked: e,
				onChange: (e) => t(e.target.checked),
				disabled: n,
				className: "peer sr-only",
				...a
			}),
			/* @__PURE__ */ X("span", {
				"aria-hidden": "true",
				className: I("h-4 w-4 rounded-[4px] border bg-btn-secondary", n ? "border-muted" : "border-secondary group-hover:bg-btn-secondary-hovered group-active:bg-btn-secondary-pressed")
			}),
			e ? /* @__PURE__ */ X(R, {
				iconName: H.Check,
				size: 20,
				"aria-hidden": "true",
				color: n ? "var(--color-fill-basic-muted)" : "var(--color-fill-basic-primary)",
				className: "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
			}) : null,
			/* @__PURE__ */ X("span", {
				"aria-hidden": "true",
				className: "pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-[8px] border-2 border-[var(--color-border-focus-outline)] opacity-0 peer-focus-visible:opacity-100"
			})
		]
	}), r ? /* @__PURE__ */ X("span", {
		className: I("label-small", n ? "text-basic-muted" : "text-basic-primary"),
		children: r
	}) : null]
}), to = "code code-small font-medium !leading-4 !tracking-normal", no = I(to, "w-12 shrink-0 select-none text-right text-basic-muted opacity-50"), ro = {
	insert: "bg-success-primary border-success-primary",
	delete: "bg-error-primary border-error-primary",
	context: "border-transparent"
}, io = {
	insert: "Added",
	delete: "Deleted"
};
function ao({ line: e }) {
	let t = e.kind ?? "context", n = io[t];
	return /* @__PURE__ */ Z("div", {
		className: I("flex min-h-4 w-full items-start border-l-2 border-solid", ro[t]),
		children: [/* @__PURE__ */ Z("span", {
			className: no,
			children: [n ? /* @__PURE__ */ Z("span", {
				className: "sr-only",
				children: [n, " "]
			}) : null, e.number ?? null]
		}), /* @__PURE__ */ Z("span", {
			className: I(to, "min-w-0 flex-1 whitespace-pre-wrap break-words px-2 text-basic-primary"),
			children: [e.tokens ? e.tokens.map((e, t) => /* @__PURE__ */ X("span", {
				style: Lr(e),
				children: e.text
			}, t)) : e.content, e.trailing]
		})]
	});
}
var oo = ({ "aria-label": e, hunks: t, className: n }) => /* @__PURE__ */ X("div", {
	role: "group",
	"aria-label": e,
	className: I("flex w-full min-w-0 flex-col overflow-clip rounded-lg py-2 [&>*]:shrink-0", n),
	children: t.map((e, t) => /* @__PURE__ */ Z(ai, { children: [t > 0 ? /* @__PURE__ */ X("div", {
		role: "separator",
		className: "flex w-full border-l-2 border-solid border-transparent",
		children: /* @__PURE__ */ X("span", {
			"aria-hidden": !0,
			className: no,
			children: "…"
		})
	}) : null, e.map((e, t) => /* @__PURE__ */ X(ao, { line: e }, t))] }, t))
}), so = "en-US", co = new Intl.DateTimeFormat(so, {
	month: "long",
	year: "numeric"
}), lo = new Intl.DateTimeFormat(so, { weekday: "short" }), uo = (e) => new Date(e.getFullYear(), e.getMonth(), 1), fo = (e, t) => new Date(e.getFullYear(), e.getMonth() + t, 1), po = (e, t) => new Date(e.getFullYear(), e.getMonth(), e.getDate() + t), mo = (e) => new Date(e.getFullYear(), e.getMonth(), e.getDate()), ho = (e, t) => e.getFullYear() === t.getFullYear() && e.getMonth() === t.getMonth() && e.getDate() === t.getDate(), go = (e) => ho(e, /* @__PURE__ */ new Date()), _o = (e, t, n) => {
	let r = mo(e).getTime();
	return r >= mo(t).getTime() && r <= mo(n).getTime();
}, vo = (e, t, n) => {
	let r = mo(e).getTime();
	return !!(t && r < mo(t).getTime() || n && r > mo(n).getTime());
}, yo = (e) => co.format(e), bo = () => {
	let e = new Date(2021, 7, 1);
	return Array.from({ length: 7 }, (t, n) => lo.format(po(e, n)));
}, xo = (e) => `${e.getFullYear()}-${e.getMonth()}-${e.getDate()}`;
function So(e) {
	let t = uo(e), n = t.getDay(), r = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate(), i = [];
	for (let e = -n; e < 0; e += 1) i.push({
		date: po(t, e),
		inMonth: !1
	});
	for (let t = 1; t <= r; t += 1) i.push({
		date: new Date(e.getFullYear(), e.getMonth(), t),
		inMonth: !0
	});
	let a = (7 - i.length % 7) % 7;
	for (let t = 1; t <= a; t += 1) i.push({
		date: new Date(e.getFullYear(), e.getMonth(), r + t),
		inMonth: !1
	});
	return i;
}
// src/app/atoms/date-picker/DayGrid.tsx
function Co(e, t, n, r) {
	return e || t ? B.Primary : n ? B.GhostHighlightedAccent : r ? B.SecondaryHighlighted : B.Ghost;
}
var wo = ({ days: e, selected: t, range: n, focused: r, min: i, max: a, disabled: o = !1, onSelect: s, onFocusDay: c, onNavigate: l }) => {
	let u = q(null);
	G(() => {
		let e = u.current;
		if (!r || !e) return;
		let t = requestAnimationFrame(() => {
			let t = e.querySelector(`button[data-day="${xo(r)}"]`);
			t && !t.disabled && t.focus();
		});
		return () => cancelAnimationFrame(t);
	}, [r, e]);
	let d = (e, t) => {
		let n = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -7,
			ArrowDown: 7
		}[e.key];
		n !== void 0 && (e.preventDefault(), l(t, n));
	};
	return /* @__PURE__ */ X("div", {
		ref: u,
		className: "grid grid-cols-7 gap-y-1 p-2",
		role: "rowgroup",
		children: e.map(({ date: e, inMonth: l }) => {
			let u = t ? ho(e, t) : !1, f = n?.from ? ho(e, n.from) : !1, p = n?.to ? ho(e, n.to) : !1, m = n?.from && n?.to ? _o(e, n.from, n.to) : !1, h = o || !l || vo(e, i, a), g = f && p ? null : f ? "rounded-r-none" : p ? "rounded-l-none" : m ? "rounded-none" : null;
			return /* @__PURE__ */ X("div", {
				role: "gridcell",
				"aria-selected": u,
				children: /* @__PURE__ */ X(z, {
					"data-day": xo(e),
					variant: Co(u, f || p, m, go(e)),
					size: U.Medium,
					disabled: h,
					tabIndex: r && ho(e, r) ? 0 : -1,
					className: I("w-full", g, !l && "invisible"),
					onClick: () => s(e),
					onFocus: () => c(e),
					onKeyDown: (t) => d(t, e),
					children: e.getDate()
				})
			}, xo(e));
		})
	});
}, To = bo(), Eo = ({ selected: e, onSelect: t, range: n, onRangeChange: r, min: i, max: a, disabled: o = !1, defaultMonth: s, className: c = "" }) => {
	let l = n ? n.to ?? n.from : e, [u, d] = J(() => uo(s ?? l ?? /* @__PURE__ */ new Date())), [f, p] = J(l), m = K(() => So(u), [u]);
	return /* @__PURE__ */ Z("div", {
		role: "group",
		"aria-label": "Calendar",
		className: I("flex flex-col min-w-0 w-[280px]", c),
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex items-center justify-between gap-2 p-1 border-b border-muted",
				children: [
					/* @__PURE__ */ X(z, {
						variant: B.Ghost,
						size: U.Medium,
						content: g.Icon,
						"aria-label": "Previous month",
						onClick: () => d((e) => fo(e, -1)),
						children: /* @__PURE__ */ X(R, { iconName: H.Left })
					}),
					/* @__PURE__ */ X("div", {
						className: "label-small text-basic-primary",
						"aria-live": "polite",
						children: yo(u)
					}),
					/* @__PURE__ */ X(z, {
						variant: B.Ghost,
						size: U.Medium,
						content: g.Icon,
						"aria-label": "Next month",
						onClick: () => d((e) => fo(e, 1)),
						children: /* @__PURE__ */ X(R, { iconName: H.Right })
					})
				]
			}),
			/* @__PURE__ */ X("div", {
				className: "grid grid-cols-7 px-2 pt-2",
				role: "row",
				children: To.map((e) => /* @__PURE__ */ X("div", {
					role: "columnheader",
					className: "label-micro text-basic-tertiary text-center py-1",
					children: e
				}, e))
			}),
			/* @__PURE__ */ X(wo, {
				days: m,
				selected: n ? void 0 : e,
				range: n,
				focused: f,
				min: i,
				max: a,
				disabled: o,
				onSelect: (e) => {
					if (p(e), !n) {
						t?.(e);
						return;
					}
					let i = n.from;
					!i || n.to ? r?.({
						from: e,
						to: void 0
					}) : r?.(e < i ? {
						from: e,
						to: i
					} : {
						from: i,
						to: e
					});
				},
				onFocusDay: p,
				onNavigate: (e, t) => {
					let n = po(e, t);
					p(n), (n.getFullYear() !== u.getFullYear() || n.getMonth() !== u.getMonth()) && d(uo(n));
				}
			})
		]
	});
}, Do = /* @__PURE__ */ function(e) {
	return e.Micro = "label-micro", e.Small = "label-small", e.Medium = "label-medium", e;
}({}), Oo = {
	"label-micro": 16,
	"label-small": 20,
	"label-medium": 24
}, ko = {
	"label-micro": Ri.Small,
	"label-small": Ri.Small,
	"label-medium": Ri.Medium
}, Ao = ({ children: e, htmlFor: t, size: n = "label-small", icon: r, validation: i = !1, tone: a = "secondary", hoverHint: o, className: s = "" }) => /* @__PURE__ */ Z("label", {
	htmlFor: t,
	className: I("flex items-center gap-1.5 min-w-0", n, i ? "text-error-primary" : a === "primary" ? "text-basic-primary" : a === "muted" ? "text-basic-muted" : "text-basic-secondary", s),
	children: [
		r ? /* @__PURE__ */ X(R, {
			iconName: r,
			size: Oo[n],
			className: "shrink-0"
		}) : null,
		/* @__PURE__ */ X("span", {
			className: "truncate",
			children: e
		}),
		o ? /* @__PURE__ */ X(zi, {
			title: o.title,
			description: o.description,
			muted: o.muted,
			size: ko[n]
		}) : null
	]
});
Ao.Size = Do;
// src/app/atoms/input/InputWrapper.tsx
var jo = ({ label: e, required: t, validation: n, validationText: r, hintText: i, caption: a, hoverHint: o, className: s, children: c }) => {
	let l = a === "compact" ? Do.Micro : Do.Small, u = a === "compact" ? "label-micro" : a === "large" ? "label-small" : "text-micro";
	return /* @__PURE__ */ Z("div", {
		className: I("flex text-left flex-col gap-1", s),
		children: [
			e ? /* @__PURE__ */ Z("div", {
				className: "flex items-baseline gap-1 min-w-0",
				children: [/* @__PURE__ */ X(Ao, {
					validation: n,
					hoverHint: o,
					tone: "primary",
					size: l,
					className: "min-w-0",
					children: e
				}), t ? /* @__PURE__ */ X("span", {
					className: I("label-small shrink-0", n ? "text-error-primary" : "text-basic-primary"),
					children: "*"
				}) : null]
			}) : null,
			c,
			n && r ? /* @__PURE__ */ X("p", {
				className: I(u, "text-error-primary"),
				children: r
			}) : !n && i ? /* @__PURE__ */ X("p", {
				className: "text-micro text-basic-muted",
				children: i
			}) : null
		]
	});
}, Mo = (e) => `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`, No = (e) => {
	let t = e?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (t) return new Date(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
}, Po = (e) => {
	let t = No(e);
	return t ? t.toLocaleDateString("en-US") : "";
}, Fo = ({ value: e, onChange: t, range: n, onRangeChange: r, size: i = U.Medium, disabled: a = !1, validation: o, validationText: s, placement: c = M.BottomRight, min: l, max: u, placeholder: d, label: f, required: p, hintText: m, hoverHint: h, className: _ = "" }) => {
	let [v, y] = J(!1), b = !!n, S = b ? n?.from || n?.to ? `${Po(n?.from) || "Start"} – ${Po(n?.to) || "End"}` : d ?? "Select range" : (Po(e) || d) ?? "Select date", C = b ? /* @__PURE__ */ X(Eo, {
		range: {
			from: No(n?.from),
			to: No(n?.to)
		},
		onRangeChange: (e) => {
			r?.({
				from: e.from ? Mo(e.from) : null,
				to: e.to ? Mo(e.to) : null
			}), e.from && e.to && y(!1);
		},
		min: No(l),
		max: No(u),
		disabled: a
	}) : /* @__PURE__ */ X(Eo, {
		selected: No(e),
		onSelect: (e) => {
			t?.(Mo(e)), y(!1);
		},
		min: No(l),
		max: No(u),
		disabled: a
	});
	return /* @__PURE__ */ X(jo, {
		label: f,
		required: p,
		validation: o,
		validationText: s,
		hintText: m,
		hoverHint: h,
		className: _,
		children: /* @__PURE__ */ X(x, {
			open: v,
			onClose: () => y(!1),
			placement: c,
			size: Le.Fit,
			sticky: !0,
			className: "w-full",
			panelClassName: "p-0",
			content: C,
			children: /* @__PURE__ */ Z(z, {
				variant: v ? B.SecondaryHighlighted : B.Secondary,
				size: i,
				content: g.IconLeft,
				disabled: a,
				"aria-haspopup": "dialog",
				"aria-expanded": v,
				className: I("w-full justify-between", o && "input-validation"),
				onClick: () => y((e) => !e),
				children: [
					/* @__PURE__ */ X(R, { iconName: H.Calendar }),
					/* @__PURE__ */ X("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: S
					}),
					/* @__PURE__ */ X(R, {
						iconName: H.Down,
						className: I("transition-transform", v && "rotate-180")
					})
				]
			})
		})
	});
}, Io = ({ isOpen: e, children: t, className: n = "", onCloseMaxHeight: r, isScrollable: i = !1, scrollToBottom: a = !1, ...o }) => {
	let s = q(null), c = q(null), [l, u] = J(0), d = q(null);
	G(() => {
		if (s.current) {
			if (e) {
				let e = s.current.scrollHeight;
				u(e);
			} else u(r ?? 0);
		}
	}, [e, r]), G(() => {
		if (!e || !s.current) return;
		let t = () => {
			s.current && u(s.current.scrollHeight);
		}, n = new ResizeObserver(t);
		return n.observe(s.current), t(), () => {
			n.disconnect();
		};
	}, [e]), G(() => {
		if (!i || !a || !c.current || !s.current) return;
		let e = new ResizeObserver(() => {
			c.current && d.current === null && (d.current = window.setTimeout(() => {
				c.current && (c.current.scrollTop = c.current.scrollHeight), d.current = null;
			}, 100));
		});
		return e.observe(s.current), () => {
			e.disconnect(), d.current !== null && (clearTimeout(d.current), d.current = null);
		};
	}, [i, a]);
	let f = i ? "overflow-y-auto" : "overflow-hidden";
	return /* @__PURE__ */ X("div", {
		...o,
		ref: c,
		className: I(f, "transition-[height] duration-150 ease-out", n),
		style: {
			height: `${l}px`,
			...o.style
		},
		children: /* @__PURE__ */ X("div", {
			ref: s,
			children: t
		})
	});
}, Lo = /* @__PURE__ */ function(e) {
	return e.Micro = "header-micro", e.Small = "header-small", e.Medium = "header-medium", e;
}({}), Ro = ({ value: e, onCommit: t, size: n = "header-small", placeholder: r = "Untitled", disabled: i = !1, className: a = "" }) => {
	let [o, s] = J(!1), [c, l] = J(e), u = q(null), [d, f] = J(e);
	d !== e && (f(e), o || l(e)), G(() => {
		if (!o) return;
		let e = u.current;
		e?.focus(), e?.select();
	}, [o]);
	let p = () => {
		s(!1);
		let n = c.trim();
		n && n !== e ? t(n) : l(e);
	};
	return /* @__PURE__ */ X("div", {
		className: I("flex items-center min-w-0 h-8", n, a),
		children: o ? /* @__PURE__ */ X("input", {
			ref: u,
			value: c,
			placeholder: r,
			className: I("w-full min-w-0 bg-btn-secondary-hovered text-basic-primary font-normal", "rounded-t-[4px] border-b border-primary outline-none px-1", n),
			onChange: (e) => l(e.target.value),
			onBlur: p,
			onKeyDown: (t) => {
				t.key === "Enter" && (t.preventDefault(), p()), t.key === "Escape" && (t.preventDefault(), l(e), s(!1));
			}
		}) : /* @__PURE__ */ X("button", {
			type: "button",
			disabled: i,
			className: I("min-w-0 truncate text-left text-basic-primary px-1", i ? "cursor-default" : "cursor-text", n),
			onClick: () => !i && s(!0),
			children: e || r
		})
	});
};
Ro.Size = Lo;
// src/app/atoms/file-icon/icons/asciidoc.svg?raw
var zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M4 18V8l5.39 10Zm0 4v3.67A2.33 2.33 0 0 0 6.33 28h8.9l-3.496-6Zm12.444 0 3.177 5.444A11.88 11.88 0 0 0 26.448 22Zm11.419-4A15 15 0 0 0 28 16 12 12 0 0 0 16 4L6 3.995q-.08 0-.158.005L14 18Z\"/></svg>", Bo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff6e40\" d=\"M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2v-1H2V2h2V1Zm10 0v1h2v12h-2v1h2a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1ZM6 3c0 1 0 1-1 1v1h1v2h1V3Zm3 0a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm0 1h1v2H9ZM6 9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Zm4 0c0 1 0 1-1 1v1h1v2h1V9Zm-4 1h1v2H6Z\"/></svg>", Vo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M12.106 25.849c-1.262-1.156-1.63-3.586-1.105-5.346a5.18 5.18 0 0 0 3.484 1.66 9.68 9.68 0 0 0 5.882-.734c.215-.106.413-.247.648-.39a3.5 3.5 0 0 1 .16 1.555 4.26 4.26 0 0 1-1.798 3.021c-.404.3-.832.569-1.25.852a2.613 2.613 0 0 0-1.15 3.372l.048.161a3.4 3.4 0 0 1-1.5-1.285 3.6 3.6 0 0 1-.578-1.962 9 9 0 0 0-.05-1.037c-.114-.831-.504-1.204-1.238-1.225a1.45 1.45 0 0 0-1.507 1.18c-.012.056-.028.112-.046.178M4.901 20a17.75 17.75 0 0 1 7.4-2l2.913-8.38a.765.765 0 0 1 1.527 0L19.7 18a14.24 14.24 0 0 1 7.399 2S20.704 2.877 20.692 2.842C20.51 2.33 20.202 2 19.787 2h-7.619c-.415 0-.71.33-.904.842z\"/></svg>", Ho = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m6 10h-4v8a4 4 0 1 1-4-4 3.96 3.96 0 0 1 2 .555V8h6Z\"/></svg>", Uo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fbc02d\" d=\"M3 18S4.15 6.885 7 3l5 1-1 3H9v7h1c1.9-2.915 5.783-3.98 8.157-2.915 4.475 1.915 2.998 5.967.148 7.905C16.025 20.548 10.113 23.05 3 18\"/></svg>", Wo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", Go = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g transform=\"translate(0 -822.52)\"><rect width=\"107.25\" height=\"156.59\" x=\"405.55\" y=\"967.22\" fill=\"#0097a7\" rx=\"12.306\" ry=\"12.31\" transform=\"matrix(-.98339 .18149 .60192 .79856 0 0)\"/><rect width=\"108.34\" height=\"123.15\" x=\"-1156.5\" y=\"1461.9\" fill=\"#3f51b5\" rx=\"10.69\" ry=\"12.31\" transform=\"matrix(-.98528 .17093 -.59175 .80612 0 0)\"/><path fill=\"#3f51b5\" d=\"M52.112 965.158c-1.343 3.515-26.292 23.248-25.744 27.277.548 4.03 29.812 16.023 32.04 19.027s10.545 41.668 13.603 42.5 18.828-31.274 21.548-32.932 32.808 2.503 34.15-1.01c1.343-3.515-18.174-35.352-18.721-39.381s9.732-40.12 7.502-43.125-30.06 9.427-33.118 8.594-26.793-27.3-29.514-25.643-.405 41.177-1.747 44.693z\"/></g></svg>", Ko = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M2 2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h6v3l2-1.25L12 14v-3h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Zm0 1h4v1H2Zm6 0 2 1.25L12 3v2.5l2 1-2 1V10l-2-1.25L8 10V7.5l-2-1 2-1zM2 5h3v1H2Zm0 2h3v1H2Zm0 2h4v1H2Z\"/></svg>", qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path fill=\"#64dd17\" d=\"M123.456 129.975a507 507 0 0 0-3.54 7.846c-4.406 9.981-9.284 22.127-11.066 29.908-.64 2.77-1.037 6.205-1.03 10.013 0 1.506.081 3.09.21 4.702a58.1 58.1 0 0 0 19.98 3.559 58.2 58.2 0 0 0 18.29-2.98c-1.352-1.237-2.642-2.554-3.816-4.038-7.796-9.942-12.146-24.512-19.028-49.01m-28.784-49.39C79.782 91.08 70.039 108.387 70.002 128c.037 19.32 9.487 36.403 24.002 46.94 3.56-14.83 12.485-28.41 25.868-55.63a219 219 0 0 0-2.714-7.083c-3.708-9.3-9.059-20.102-13.834-24.993-2.435-2.555-5.389-4.763-8.652-6.648\"/><path fill=\"#7cb342\" d=\"M178.532 194.535c-7.683-.963-14.023-2.124-19.57-4.081a69.4 69.4 0 0 1-30.958 7.249c-38.491 0-69.693-31.198-69.698-69.7 0-20.891 9.203-39.62 23.764-52.392-3.895-.94-7.956-1.49-12.104-1.482-20.45.193-42.037 11.51-51.025 42.075-.84 4.45-.64 7.813-.64 11.8 0 60.591 49.12 109.715 109.705 109.715 37.104 0 69.882-18.437 89.732-46.633-10.736 2.675-21.06 3.955-29.902 3.982-3.314 0-6.425-.177-9.305-.53\"/><path fill=\"#29b6f6\" d=\"M157.922 173.271c.678.336 2.213.884 4.35 1.49 14.375-10.553 23.717-27.552 23.754-46.764h-.005c-.055-32.03-25.974-57.945-58.011-58.009a58.2 58.2 0 0 0-18.213 2.961c11.779 13.426 17.443 32.613 22.922 53.6l.01.025c.01.017 1.752 5.828 4.743 13.538 2.97 7.7 7.203 17.231 11.818 24.178 3.03 4.655 6.363 8 8.632 8.981\"/><path fill=\"#1e88e5\" d=\"M128.009 18.29c-36.746 0-69.25 18.089-89.16 45.826 10.361-6.49 20.941-8.83 30.174-8.747 12.753.037 22.779 3.991 27.589 6.696a51 51 0 0 1 3.345 2.131 69.4 69.4 0 0 1 28.049-5.894c38.496.004 69.703 31.202 69.709 69.698h-.006c0 19.409-7.938 36.957-20.736 49.594 3.142.352 6.492.571 9.912.554 12.15.006 25.284-2.675 35.13-10.956 6.42-5.408 11.798-13.327 14.78-25.199.584-4.586.92-9.247.92-13.991 0-60.588-49.116-109.715-109.705-109.715\"/></svg>", Jo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M11.94 2.984 2.928 21.017l9.875-8.47z\"/><path fill=\"#e53935\" d=\"m11.958 2.982.002.29 1.312 14.499-.002.006.023.26 7.363 2.978h.415l-.158-.31-.114-.228h-.001l-8.84-17.494z\"/><path fill=\"#7cb342\" d=\"m8.558 16.13-5.627 4.884h17.743v-.016z\"/></svg>", Yo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff7043\" d=\"M2 2a1 1 0 0 0-1 1v10c0 .554.446 1 1 1h12c.554 0 1-.446 1-1V3a1 1 0 0 0-1-1zm0 3h12v8H2zm1 2 2 2-2 2 1 1 3-3-3-3zm5 3.5V12h5v-1.5z\"/></svg>", Xo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#0288d1\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", Zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#cfd8dc\" d=\"m179.363 121.67-57.623 57.507c-.23.23-.576.346-.806.23l-78.713-21.09c-.346-.115-.577-.345-.577-.576L20.44 79.144c-.115-.345 0-.576.23-.806L78.294 20.83c.23-.23.576-.346.807-.23l78.713 21.09c.345.114.576.345.576.575l21.09 78.597c.23.346.115.577-.115.807zm-77.215-62.58-77.33 20.63c-.115 0-.23.23-.115.345l56.586 56.47c.115.115.346.115.346-.115l20.744-77.215c.115 0-.115-.23-.23-.116z\"/></svg>", Qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M30 14v-2h-2V8h-2v4h-2V8h-2v4h-2v2h2v2h-2v2h2v4h2v-4h2v4h2v-4h2v-2h-2v-2Zm-4 2h-2v-2h2Zm-12.437 6A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", $o = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7e57c2\" d=\"M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034\"/><path fill=\"#7e57c2\" d=\"M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z\"/></svg>", es = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#4fc3f7\" d=\"M16.83 2a1.3 1.3 0 0 0-.916.377l-.013.01L7.323 7.34l8.556 8.55v.005l10.283 10.277 1.96-3.529-7.068-16.96-3.299-3.297A1.3 1.3 0 0 0 16.828 2Z\"/><path fill=\"#01579b\" d=\"m7.343 7.32-4.955 8.565-.01.013a1.297 1.297 0 0 0 .004 1.835l.005.005 4.106 4.107 16.064 6.314 3.632-2.015-.098-.098-.025.002L15.995 15.97h-.012z\"/><path fill=\"#01579b\" d=\"m7.321 7.324 8.753 8.755h.013L26.16 26.156l3.835-.73L30 14.089l-4.049-3.965a6.5 6.5 0 0 0-3.618-1.612l.002-.043L7.323 7.325Z\"/><path fill=\"#64b5f6\" d=\"m7.332 7.335 8.758 8.75v.013l10.079 10.071L25.436 30H14.09l-3.967-4.048a6.5 6.5 0 0 1-1.611-3.618l-.045.004Z\"/></svg>", ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M16 24c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-8c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-12C10.477 4 6 4.895 6 6v4c0 1.1 4.475 2 10 2s10-.9 10-2V6c0-1.105-4.477-2-10-2\"/></svg>", ns = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M18 23H4c-1.1 0-2-.9-2-2V7h2v14h14zM14.5 7V5h-2v2h-2v2h2v2h2V9h2V7zm2 6h-6v2h6zM15 1H8c-1.1 0-1.99.9-1.99 2L6 17c0 1.1.89 2 1.99 2H19c1.1 0 2-.9 2-2V7zm4 16H8V3h6.17L19 7.83z\"/></svg>", rs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#42a5f5\" d=\"M6 2a2 2 0 0 0-2 2v16c0 1.11.89 2 2 2h6v-2H6V4h7v5h5v3h2V8l-6-6m4 12a.26.26 0 0 0-.26.21l-.19 1.32c-.3.13-.59.29-.85.47l-1.24-.5c-.11 0-.24 0-.31.13l-1 1.73c-.06.11-.04.24.06.32l1.06.82a4.2 4.2 0 0 0 0 1l-1.06.82a.26.26 0 0 0-.06.32l1 1.73c.06.13.19.13.31.13l1.24-.5c.26.18.54.35.85.47l.19 1.32c.02.12.12.21.26.21h2c.11 0 .22-.09.24-.21l.19-1.32c.3-.13.57-.29.84-.47l1.23.5c.13 0 .26 0 .33-.13l1-1.73a.26.26 0 0 0-.06-.32l-1.07-.82c.02-.17.04-.33.04-.5s-.01-.33-.04-.5l1.06-.82a.26.26 0 0 0 .06-.32l-1-1.73c-.06-.13-.19-.13-.32-.13l-1.23.5c-.27-.18-.54-.35-.85-.47l-.19-1.32A.236.236 0 0 0 20 14m-1 3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5c-.84 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5\"/></svg>", is = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M21.81 10.25c-.06-.04-.56-.43-1.64-.43-.28 0-.56.03-.84.08-.21-1.4-1.38-2.11-1.43-2.14l-.29-.17-.18.27c-.24.36-.43.77-.51 1.19-.2.8-.08 1.56.33 2.21-.49.28-1.29.35-1.46.35H2.62c-.34 0-.62.28-.62.63 0 1.15.18 2.3.58 3.38.45 1.19 1.13 2.07 2 2.61.98.6 2.59.94 4.42.94.79 0 1.61-.07 2.42-.22 1.12-.2 2.2-.59 3.19-1.16A8.3 8.3 0 0 0 16.78 16c1.05-1.17 1.67-2.5 2.12-3.65h.19c1.14 0 1.85-.46 2.24-.85.26-.24.45-.53.59-.87l.08-.24zm-17.96.99h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H3.85c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.43 0h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H6.28c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.47 0h1.75c.1 0 .17-.07.17-.16V9.5c0-.08-.06-.16-.17-.16H8.75c-.08 0-.15.07-.15.16v1.58c0 .09.06.16.15.16m2.44 0h1.77c.08 0 .15-.07.15-.16V9.5c0-.08-.06-.16-.15-.16h-1.77c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16M6.28 9h1.76c.08 0 .16-.09.16-.18V7.25c0-.09-.07-.16-.16-.16H6.28c-.09 0-.16.06-.16.16v1.57c.01.09.07.18.16.18m2.47 0h1.75c.1 0 .17-.09.17-.18V7.25c0-.09-.06-.16-.17-.16H8.75c-.08 0-.15.06-.15.16v1.57c0 .09.06.18.15.18m2.44 0h1.77c.08 0 .15-.09.15-.18V7.25c0-.09-.07-.16-.15-.16h-1.77c-.08 0-.15.06-.15.16v1.57c0 .09.07.18.15.18m0-2.28h1.77c.08 0 .15-.07.15-.16V5c0-.1-.07-.17-.15-.17h-1.77c-.08 0-.15.06-.15.17v1.56c0 .08.07.16.15.16m2.46 4.52h1.76c.09 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16h-1.76c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16\"/></svg>", as = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 16h8v2H8zm0-4h8v2H8zm6-10H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm4 18H6V4h7v5h5z\"/></svg>", os = "<svg xmlns=\"http://www.w3.org/2000/svg\" clip-rule=\"evenodd\" image-rendering=\"optimizeQuality\" shape-rendering=\"geometricPrecision\" text-rendering=\"geometricPrecision\" viewBox=\"0 0 3473 3473\"><path fill=\"#ede7f6\" d=\"M989.342 1977.409c41.146-26.835 75.137-93.922 54.564-141.33-56.353 24.151-53.67 79.61-54.564 141.33m636.877 153.851c44.724-14.311 87.66-64.402 63.509-116.283-34.886 24.151-57.248 57.247-63.51 116.284z\"/><g fill=\"#fafafa\"><path d=\"M374.827 2871.899c0 56.352 14.312 117.178 53.67 138.645 144.907 81.4 652.977 17.89 825.614-20.573 90.343-20.573 163.692-87.66 248.668-124.334 191.421-83.187 330.067-150.274 483.025-262.085 110.916-81.399 287.131-310.388 305.915-447.245l-151.169-33.991c-3.578 153.852-38.463 188.737-175.32 224.517-92.132 25.046-271.925 30.413-365.846 14.312-124.334-20.574-180.687-85.871-237.04-160.114-109.128-144.907 24.151-245.985-148.485-255.824-181.582 222.728-501.81 62.614-642.244 40.252-59.93 86.765-200.366 650.294-198.577 779.1 86.766-29.517 141.33 2.684 219.15 33.097 275.503 106.444 34.885 200.366-75.137 172.636-75.137-17.89-98.394-67.086-142.224-98.393m360.48-1285.383c111.81 21.468 211.1 67.982 305.915 115.39 154.747 76.926 182.476 66.192 196.788 173.53 1.789 19.68-1.789 30.413 54.564 48.303 94.816 29.518-54.564-23.257 199.471-22.362 151.169.894 497.337 61.72 609.148 132.384 46.513 29.519 37.568 67.087 194.999 62.615-1.79-185.16-50.986-461.557-123.44-631.51-88.554-205.733-205.733-237.04-444.561-313.966-139.54-44.725-549.217-93.922-676.235-15.207-118.967 74.243-141.33 162.798-252.246 318.439-32.202 45.619-43.83 80.504-64.403 132.384\"/><path d=\"M1720.14 1966.675c89.45 36.674-4.472 273.714-128.806 216.466-40.252-113.6 55.458-178.003 81.398-228.99-53.67-8.05-206.627-32.2-252.246-15.206-59.036 22.363-72.454 148.486-42.041 207.522 143.118 280.87 775.523 220.94 708.436 2.684-26.835-88.555-51.88-102.867-142.224-133.28-72.454-24.15-144.907-49.196-224.517-49.196m-1124.374-31.307c71.56 68.875 233.462 79.61 338.117 84.976 13.418-138.646 25.046-242.407 135.963-234.356 54.564 74.242 25.94 161.902-31.307 218.255 97.5-.894 153.852-74.242 139.54-180.687-82.293-59.036-331.856-177.109-457.084-194.104-34.885 37.569-120.756 243.301-125.229 305.916\"/></g><path d=\"M427.602 2820.913c59.036-5.367 212.889 39.357 225.412 89.449-95.71 11.628-217.361 2.683-225.412-89.45zm-52.775 50.986c43.83 31.307 67.087 80.504 142.224 98.393 110.022 27.73 350.64-66.192 75.137-172.636-77.82-30.413-132.384-62.614-219.15-33.096-1.789-128.807 138.646-692.336 198.577-779.101 140.435 22.362 460.662 182.476 642.244-40.252 172.636 9.84 39.357 110.917 148.485 255.824 56.353 74.243 112.706 139.54 237.04 160.114 93.921 16.1 273.714 10.734 365.846-14.312 136.857-35.78 171.742-70.665 175.32-224.517l151.17 33.99c-18.785 136.858-195 365.847-305.916 447.246-152.958 111.81-291.604 178.898-483.025 262.085-84.976 36.674-158.325 103.761-248.668 124.334-172.637 38.463-680.707 101.972-825.614 20.574-39.358-21.468-53.67-82.294-53.67-138.646M1626.22 2131.26c6.261-59.037 28.623-92.133 63.508-116.284 24.152 51.88-18.784 101.972-63.508 116.284m93.921-164.586c79.61 0 152.063 25.045 224.517 49.197 90.344 30.412 115.39 44.724 142.224 133.279 67.087 218.255-565.318 278.186-708.436-2.684-30.413-59.036-16.995-185.16 42.041-207.522 45.619-16.995 198.577 7.156 252.246 15.207-25.94 50.986-121.65 115.389-81.398 228.99 124.334 57.247 218.255-179.793 128.806-216.467m-730.798 10.734c.894-61.72-1.79-117.179 54.564-141.33 20.573 47.408-13.418 114.495-54.564 141.33m-393.576-42.041c4.473-62.615 90.344-268.347 125.229-305.916 125.228 16.995 374.791 135.068 457.084 194.104 14.312 106.445-42.04 179.793-139.54 180.687 57.247-56.353 85.87-144.013 31.307-218.255-110.917-8.05-122.545 95.71-135.963 234.356-104.655-5.367-266.558-16.1-338.117-84.976m-89.449-71.56c-33.096-91.238-33.096-233.462 107.339-245.09l-71.56 199.471c-18.783 42.936-18.783 33.096-35.779 45.62zm228.99-277.292c20.573-51.88 32.201-86.765 64.403-132.384 110.917-155.641 133.279-244.196 252.246-318.439 127.018-78.715 536.694-29.518 676.235 15.207 238.828 76.926 356.007 108.233 444.561 313.966 72.454 169.953 121.65 446.35 123.44 631.51-157.43 4.472-148.486-33.096-195-62.615-111.81-70.664-457.978-131.49-609.147-132.384-254.035-.895-104.655 51.88-199.471 22.362-56.353-17.89-52.775-28.624-54.564-48.302-14.312-107.34-42.041-96.605-196.788-173.531-94.816-47.408-194.104-93.922-305.915-115.39m1583.247-43.83c-16.995-56.352 14.312-52.775 68.876-91.238 31.307-22.362 56.353-45.619 94.816-67.086 144.013-80.504 412.36-93.922 526.854 1.789 46.514 38.463 122.545 113.6 110.917 211.994-24.151 195.893-158.325 303.232-268.347 392.68-111.811 91.239-297.865 185.16-490.18 122.546-16.101-39.358-3.578-288.92-22.363-381.053-16.995-82.293-8.05-91.238 39.358-140.435 139.54-144.907 441.878-250.457 613.62-126.123 72.454 53.67 51.88 74.243 89.449 115.39 46.513-50.092-40.252-218.256-360.48-207.522-217.36 7.156-311.282 177.109-402.52 169.058m-1302.377-508.964c4.472-124.335 118.967-381.948 233.461-471.397 138.646-107.338 283.554-208.416 496.442-87.66 52.775 29.519 50.092 44.725 55.459 118.073 4.472 70.665-1.79 96.605-19.679 153.852-141.33 456.19-259.402 194.105-712.014 302.338 16.995-148.485 145.802-280.87 217.361-349.746 122.545-118.967 211.1-195.893 395.365-170.847 50.986 84.976 56.352 138.646-5.367 237.934-82.293 132.385-102.867 124.334-90.344 214.678 64.403-16.101 84.082-78.715 113.6-141.33 179.793-375.686-81.398-421.305-241.512-352.429-107.339 45.62-298.76 256.719-361.374 383.736-12.523 25.046-25.94 57.248-37.568 84.977zm708.436 18.784c18.784-111.811 129.7-139.54 129.7-483.92 0-148.485-182.475-281.764-421.304-182.475-204.838 84.082-236.145 148.485-345.273 313.071-102.867 155.642-99.289 326.49-187.843 470.502-25.94 41.147-49.197 55.458-77.82 96.605-20.574 30.413-35.78 68.876-56.354 104.655-42.04 68.876-84.976 118.968-118.967 201.26-107.339 2.684-197.682 4.473-208.416 115.39-14.312 152.063 57.247 189.632 57.247 246.879-.894 61.72-251.351 684.285-181.581 1055.498 19.679 101.972 86.765 102.867 194.104 115.39 258.508 31.307 593.942 20.573 825.614-72.454l420.41-201.26c106.445-59.931 285.343-173.532 364.953-256.72 56.353-58.141 85.87-107.338 134.173-176.214 66.192-96.605 67.981-94.816 82.293-226.306 87.66 16.101 251.352 54.564 305.916 101.972-6.262 61.72-36.674 32.202-36.674 87.66 34.885.895 93.027-42.935 107.339-91.238-36.675-53.67-75.138-44.724-127.913-87.66 42.042-33.096 118.073-48.302 176.215-72.453 125.229-51.88 339.012-209.311 391.787-352.43 42.04-115.389 10.734-307.704-57.248-382.841-71.559-78.715-237.934-118.967-373.897-118.967-161.902 0-329.172 116.283-459.767 166.375-50.092-43.83-53.67-93.922-90.344-142.224-42.04-57.248-315.755-200.366-446.35-228.095\"/><path fill=\"#efebe9\" d=\"M2318.554 1542.686c91.238 8.05 185.16-161.902 402.52-169.058 320.228-10.734 406.993 157.43 360.48 207.521-37.569-41.146-16.995-61.72-89.45-115.389-171.741-124.334-474.079-18.784-613.62 126.123-47.407 49.197-56.352 58.142-39.357 140.435 18.785 92.133 6.262 341.695 22.362 381.053 192.316 62.614 378.37-31.307 490.181-122.545 110.022-89.45 244.196-196.788 268.347-392.681 11.628-98.394-64.403-173.531-110.917-211.994-114.494-95.71-382.841-82.293-526.854-1.79-38.463 21.468-63.51 44.725-94.816 67.087-54.564 38.464-85.871 34.886-68.876 91.238m-1302.377-508.964 43.83-77.821c11.628-27.73 25.045-59.93 37.568-84.977 62.614-127.017 254.035-338.117 361.374-383.736 160.114-68.876 421.305-23.257 241.512 352.43-29.518 62.614-49.197 125.228-113.6 141.329-12.523-90.344 8.05-82.293 90.344-214.678 61.72-99.288 56.353-152.958 5.367-237.934-184.265-25.046-272.82 51.88-395.365 170.847-71.56 68.876-200.366 201.26-217.361 349.746 452.612-108.233 570.685 153.852 712.014-302.338 17.89-57.247 24.151-83.187 19.679-153.852-5.367-73.348-2.684-88.554-55.459-118.073-212.888-120.756-357.796-19.678-496.442 87.66-114.494 89.45-228.989 347.062-233.461 471.397\"/><path fill=\"#eee\" d=\"M506.317 1863.808c16.996-12.523 16.996-2.683 35.78-45.619l71.559-199.47c-140.435 11.627-140.435 153.851-107.339 245.09z\"/><path fill=\"#efebe9\" d=\"M653.014 2910.362c-12.523-50.092-166.376-94.816-225.412-89.45 8.05 92.133 129.701 101.078 225.412 89.45\"/></svg>", ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#9575cd\" d=\"M12.173 22.681c-3.86 0-6.99-3.64-6.99-8.13 0-3.678 2.773-8.172 4.916-10.91 1.014-1.296 2.93-2.322 2.93-2.322s-.982 5.239 1.683 7.319c2.366 1.847 4.106 4.25 4.106 6.363 0 4.232-2.784 7.68-6.645 7.68\"/></svg>", cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 323 323\"><path fill=\"#ffb300\" d=\"m106.716 99.763 54.785 54.782 54.779-54.782z\"/><path fill=\"#64dd17\" d=\"M96.881 89.93H216.83l-55.18-55.184H41.7zm131.546 11.593 59.705 59.704L228.16 221.2l-59.705-59.704z\"/><path fill=\"#00b8d4\" d=\"m175.552 34.746 112.703 112.695V34.746z\"/><path fill=\"#455a64\" d=\"m34.746 281.3 119.8-119.8-119.8-119.8z\"/><path fill=\"#ffb300\" d=\"m288.255 175.01-53.148 53.149 53.148 53.14z\"/><path fill=\"#00b8d4\" d=\"M281.3 288.254 161.5 168.455l-119.8 119.8z\"/></svg>", ls = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 30 30\"><path fill=\"#f44336\" d=\"M5.207 4.33q-.072.075-.143.153Q1.5 8.476 1.5 15.33c0 4.418 1.155 7.862 3.459 10.34h19.415c2.553-1.152 4.127-3.43 4.127-3.43l-3.147-2.52L23.9 21.1c-.867.773-.845.931-2.315 1.78-1.495.674-3.04.966-4.634.966-2.515 0-4.423-.909-5.723-2.059-1.286-1.15-1.985-4.511-2.096-6.68l17.458.067-.183-1.472s-.847-7.129-2.541-9.372zm8.76.846c1.565 0 3.22.535 3.961 1.471.74.937.931 1.667.973 3.524H9.11c.112-1.955.436-2.81 1.373-3.698.936-.887 2.03-1.297 3.484-1.297\"/></svg>", us = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#3f51b5\" d=\"M22.713 4H9.287a.5.5 0 0 0-.432.248l-6.708 11.5a.5.5 0 0 0 0 .504l6.708 11.5a.5.5 0 0 0 .432.248h13.426a.5.5 0 0 0 .432-.248l6.708-11.5a.5.5 0 0 0 0-.504l-6.708-11.5A.5.5 0 0 0 22.713 4m-6.937 20.888-7.5-3.75A.5.5 0 0 1 8 20.691v-9.382a.5.5 0 0 1 .276-.447l7.5-3.75a.5.5 0 0 1 .448 0l7.5 3.75a.5.5 0 0 1 .276.447v9.382a.5.5 0 0 1-.276.447l-7.5 3.75a.5.5 0 0 1-.448 0\"/><path fill=\"#7986cb\" d=\"M22 19.441v-6.882a.5.5 0 0 0-.276-.447l-5.5-2.75a.5.5 0 0 0-.448 0l-5.5 2.75a.5.5 0 0 0-.276.447v6.882a.5.5 0 0 0 .276.447l5.5 2.75a.5.5 0 0 0 .448 0l5.5-2.75a.5.5 0 0 0 .276-.447\"/></svg>", ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M28 4H4a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 22H4V10h24Z\"/></svg>", fs = "<svg viewBox=\"0 0 16 16\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"m8.668 6h3.6641l-3.6641-3.668v3.668m-4.668-4.668h5.332l4 4v8c0 0.73828-0.59375 1.3359-1.332 1.3359h-8c-0.73828 0-1.332-0.59766-1.332-1.3359v-10.664c0-0.74219 0.59375-1.3359 1.332-1.3359m3.332 1.3359h-3.332v10.664h8v-6h-4.668z\" fill=\"#90a4ae\" /></svg>", ps = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M24 28h4L18 4h-4L4 28h4l8-19.422\"/><path fill=\"#f44336\" d=\"M8 20h16v4H8z\"/></svg>", ms = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><path fill=\"#0288d1\" d=\"m236.249 36.066-213.94 213.94 213.94 213.94v-84.36l-129.7-129.7 129.7-129.7z\"/><path fill=\"#0288d1\" d=\"m236.249 156.017-93.622 93.62 93.622 93.622z\"/><path fill=\"#00b8d4\" d=\"m263.759 36.047 213.94 213.94-213.94 213.94v-84.36l129.7-129.7-129.7-129.7z\"/></svg>", hs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M13.172 2.828 11.78 4.22l1.91 1.91 2 2A2.986 2.986 0 0 1 20 10.81a3.25 3.25 0 0 1-.31 1.31l2.06 2a2.68 2.68 0 0 1 3.37.57 2.86 2.86 0 0 1 .88 2.117 3.02 3.02 0 0 1-.856 2.109A2.9 2.9 0 0 1 23 19.81a2.93 2.93 0 0 1-2.13-.87 2.694 2.694 0 0 1-.56-3.38l-2-2.06a3 3 0 0 1-.31.12V20a3 3 0 0 1 1.44 1.09 2.92 2.92 0 0 1 .56 1.72 2.88 2.88 0 0 1-.878 2.128 2.98 2.98 0 0 1-2.048.871 2.981 2.981 0 0 1-2.514-4.719A3 3 0 0 1 16 20v-6.38a2.96 2.96 0 0 1-1.44-1.09 2.9 2.9 0 0 1-.56-1.72 2.9 2.9 0 0 1 .31-1.31l-3.9-3.9-7.579 7.572a4 4 0 0 0-.001 5.658l10.342 10.342a4 4 0 0 0 5.656 0l10.344-10.344a4 4 0 0 0 0-5.656L18.828 2.828a4 4 0 0 0-5.656 0\"/></svg>", gs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#78909c\" d=\"M26 18h-6a2 2 0 0 0-2 2v2h-6a2 2 0 0 1-2-2v-6h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2v6a4 4 0 0 0 4 4h6v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2M6.5 12a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5ZM26 25.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5Z\"/></svg>", _s = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"m29.532 13.083-.037-.105-3.811-10.322a1 1 0 0 0-.392-.49.985.985 0 0 0-1.39.316 1 1 0 0 0-.122.28L21.208 10H10.792L8.22 2.762a1.004 1.004 0 0 0-1.246-.721 1 1 0 0 0-.266.124 1 1 0 0 0-.392.491L2.507 12.98l-.04.103a7.52 7.52 0 0 0 2.348 8.491l.015.012.032.026 5.797 4.511 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257 5.838-4.537.016-.013a7.52 7.52 0 0 0 2.35-8.49Z\"/><path fill=\"#ef6c00\" d=\"m29.532 13.083-.037-.105a12.6 12.6 0 0 0-5.123 2.394l-8.367 6.57 5.327 4.181 5.839-4.537.016-.013a7.52 7.52 0 0 0 2.345-8.49\"/><path fill=\"#f9a825\" d=\"m10.659 26.123 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257L16 21.943Z\"/><path fill=\"#ef6c00\" d=\"M7.628 15.371a12.6 12.6 0 0 0-5.12-2.39l-.04.102a7.52 7.52 0 0 0 2.347 8.491l.015.012.032.026 5.797 4.511 5.331-4.18Z\"/></svg>", vs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#ec407a\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", ys = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00acc1\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#00acc1\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", bs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M16 10v2h6c-2 0-3-2-6-2\"/><path fill=\"#0097a7\" d=\"M26 4h-2a4 4 0 0 0-4 4h4a1 1 0 0 1 2 0v4H16v-2h-5.317A2.683 2.683 0 0 0 8 12.683v2.634A2.683 2.683 0 0 0 10.683 18H16v2h-5.98A4.02 4.02 0 0 1 6 16v-2c-2 0-4 4-4 8 0 5 1 6 2 6h4v-4h4v4h4v-4h4v4h4v-6a2 2 0 0 0 2-2v-2a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4m-4 12h-2a2 2 0 0 1-2-2h6a2 2 0 0 1-2 2\"/></svg>", xs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M6 20h20v2H6z\"/><circle cx=\"7\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"27\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 10h20v2H6z\"/><circle cx=\"7\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"5\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 12h2v10H6zm18-2h2v12h-2z\"/><path fill=\"#ec407a\" d=\"m5.014 19.41 11.674 6.866L15.674 28 4 21.134z\"/><path fill=\"#ec407a\" d=\"M26.688 21.724 15.014 28.59 14 26.866 25.674 20zM5.124 10.382l11.415-7.29 1.077 1.686L6.2 12.068z\"/><path fill=\"#ec407a\" d=\"m25.798 12.067-11.415-7.29 1.077-1.685 11.415 7.29zM6.2 19.932l11.416 7.29-1.077 1.686-11.415-7.29z\"/><path fill=\"#ec407a\" d=\"m26.875 21.619-11.415 7.29-1.077-1.687 11.415-7.289zM5.877 22.6 16.04 3.686l1.762.946L7.638 23.546z\"/><path fill=\"#ec407a\" d=\"M24.361 23.545 14.197 4.633l1.761-.947 10.165 18.913z\"/></svg>", Ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26c6da\" d=\"M19.322 2a6.5 6.5 0 0 1 4.352 1.419 4.55 4.55 0 0 1 1.685 3.662 5.82 5.82 0 0 1-1.886 4.275 6.04 6.04 0 0 1-4.34 1.846 4.15 4.15 0 0 1-2.385-.649 1.91 1.91 0 0 1-.936-1.603 1.6 1.6 0 0 1 .356-1.024 1.1 1.1 0 0 1 .861-.447q.469 0 .468.504a.79.79 0 0 0 .358.693 1.43 1.43 0 0 0 .826.245 3.1 3.1 0 0 0 2.39-1.573 5.66 5.66 0 0 0 1.154-3.39 2.64 2.64 0 0 0-.891-2.064 3.28 3.28 0 0 0-2.293-.812 6.18 6.18 0 0 0-4.086 1.736 12.9 12.9 0 0 0-3.215 4.557 13.4 13.4 0 0 0-1.233 5.36 5.86 5.86 0 0 0 1.091 3.723 3.53 3.53 0 0 0 2.905 1.372q3.058 0 5.848-4.002l2.935-.388q.546-.07.545.246a8 8 0 0 1-.423 1.24q-.421 1.097-1.152 3.668A12.7 12.7 0 0 0 26 17.72v1.66a14.2 14.2 0 0 1-4.055 2.57 10.38 10.38 0 0 1-2.764 5.931 6.7 6.7 0 0 1-4.806 2.11 3.3 3.3 0 0 1-2.012-.55 1.8 1.8 0 0 1-.718-1.514q0-2.685 5.634-5.212.532-1.766 1.152-3.507a8.6 8.6 0 0 1-2.853 2.323 7.4 7.4 0 0 1-3.48 1.01 5.46 5.46 0 0 1-4.366-2.093A8.1 8.1 0 0 1 6 15.122a11.6 11.6 0 0 1 1.966-6.426 14.7 14.7 0 0 1 5.162-4.862A12.44 12.44 0 0 1 19.322 2m-2.407 22.17q-4.055 1.875-4.054 3.695a.87.87 0 0 0 .999.97q1.964 0 3.055-4.665\"/></svg>", Cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M18.5 11a5.49 5.49 0 0 0-4.5 2.344V4H8v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", ws = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"M12.023 12a4 4 0 0 0-3.94 3.182 1 1 0 0 1-.972.818H5.229C4.446 16 4 15.552 4 15v-1H3a1 1 0 0 0-1 1v1c0 3.866 3.134 6 7 6 3.425 0 6.275-1.675 6.881-4.745.545-2.764-1.041-5.24-3.858-5.255\"/><path fill=\"#ff7043\" d=\"M29 14h-1v1c0 .552-.446 1-1.229 1H24.89a1 1 0 0 1-.973-.818A4 4 0 0 0 19.977 12c-2.817.016-4.403 2.491-3.858 5.255C16.725 20.325 19.575 22 23 22c3.866 0 7-2.134 7-6v-1a1 1 0 0 0-1-1\"/></svg>", Ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g stroke-width=\"2.422\"><path fill=\"#ef5350\" d=\"m23.928 240.5 59.94-89.852-59.94-89.855h44.955l59.94 89.855-59.94 89.852z\"/><path fill=\"#ffa726\" d=\"m83.869 240.5 59.94-89.852-59.94-89.855h44.955l119.88 179.71h-44.95l-37.46-56.156-37.468 56.156z\"/><path fill=\"#ffee58\" d=\"m228.72 188.08-19.98-29.953h69.93v29.956h-49.95zm-29.97-44.924-19.98-29.953h99.901v29.953z\"/></g></svg>", Es = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#eceff1\" d=\"M18 1.2V14h-4v-4l-4 2v16.37l4 2.43V18h4v4l4-2V3.63z\"/><path fill=\"#eceff1\" d=\"M14 1.2 2 8.49v15.02l4 2.43v-15.2l8-4.86zm12 4.86v15.2l-8 4.86v4.68l12-7.29V8.49z\"/></svg>", Ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M4 8v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2m4 14V10h4v12Zm11.999-6L18 18.001 21 21l-3 3.001L19.999 26l3.003-3 3 2.999L28 24l-3-2.999 3-3L26.001 16l-3 3z\"/></svg>", Os = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 6V2h-2v4h-6V2h-2v4h-4v2h4v4h2V8h6v4h2V8h4V6zm-15.5 5A5.49 5.49 0 0 0 8 13.344V4H2v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", ks = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e65100\" d=\"m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z\"/></svg>", As = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#26a69a\" d=\"M8.5 6h4l-4-4zM3.875 1H9.5l4 4v8.6c0 .773-.616 1.4-1.375 1.4h-8.25c-.76 0-1.375-.627-1.375-1.4V2.4c0-.777.612-1.4 1.375-1.4M4 13.6h8V8l-2.625 2.8L8 9.4zm1.25-7.7c-.76 0-1.375.627-1.375 1.4s.616 1.4 1.375 1.4c.76 0 1.375-.627 1.375-1.4S6.009 5.9 5.25 5.9\"/></svg>", js = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M22 10h2v4h-2z\"/><path fill=\"#f44336\" d=\"M28 2H4a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2m-2 12a2 2 0 0 1-2 2h-2v4a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V8h18a2 2 0 0 1 2 2Z\"/></svg>", Ms = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", Ns = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#1e88e5\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", Ps = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ffca28\" d=\"M2 2v12h12V2zm6 6h1v4a1.003 1.003 0 0 1-1 1H7a1.003 1.003 0 0 1-1-1v-1h1v1h1zm3 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", Fs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path fill=\"#f9a825\" d=\"M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z\"/></svg>", Is = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 50 50\"><g transform=\"translate(.21 -247.01)\"><circle cx=\"13.497\" cy=\"281.63\" r=\"9.555\" fill=\"#c62828\"/><circle cx=\"36.081\" cy=\"281.63\" r=\"9.555\" fill=\"#7e57c2\"/><circle cx=\"24.722\" cy=\"262.39\" r=\"9.555\" fill=\"#388e3c\"/></g></svg>", Ls = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f57c00\" d=\"M6.2 18a22.7 22.7 0 0 0 9.8 2 22.7 22.7 0 0 0 9.8-2 10.002 10.002 0 0 1-19.6 0m19.6-4a22.7 22.7 0 0 0-9.8-2 22.7 22.7 0 0 0-9.8 2 10.002 10.002 0 0 1 19.6 0\"/><circle cx=\"27\" cy=\"5\" r=\"3\" fill=\"#757575\"/><circle cx=\"5\" cy=\"27\" r=\"3\" fill=\"#9e9e9e\"/><circle cx=\"5\" cy=\"5\" r=\"3\" fill=\"#616161\"/></svg>", Rs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M30 14H17.738a8 8 0 1 0 0 4H24v4h4v-4h2Zm-20 5a3 3 0 1 1 3-3 3.003 3.003 0 0 1-3 3\"/></svg>", zs = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\"1.725\" x2=\"22.185\" y1=\"22.67\" y2=\"1.982\" gradientTransform=\"translate(1.306 1.129)scale(.89324)\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#7c4dff\"/><stop offset=\".5\" stop-color=\"#d500f9\"/><stop offset=\"1\" stop-color=\"#ef5350\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M2.975 2.976v18.048h18.05v-.03l-4.478-4.511-4.48-4.515 4.48-4.515 4.443-4.477z\"/></svg>", Bs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#448aff\" d=\"M12.074 1.424a.638.638 0 0 0-.686.691v.173c.015.2.044.402.087.588.058.358.085.73.07 1.102a.65.65 0 0 1-.201.33l-.014.258a7 7 0 0 0-1.117.17 7.9 7.9 0 0 0-4.012 2.292l-.213-.157a.56.56 0 0 1-.374-.042 6 6 0 0 1-.829-.747c-.129-.143-.26-.299-.403-.428l-.128-.1a.8.8 0 0 0-.431-.171c-.2 0-.372.07-.501.212-.2.301-.127.675.16.904l.013.014c.03.029.087.072.115.1q.258.172.515.3c.33.186.631.403.918.647a.63.63 0 0 1 .114.358l.2.17a7.82 7.82 0 0 0-1.232 5.546l-.271.07a.84.84 0 0 1-.275.274c-.358.086-.73.17-1.102.17-.186 0-.387 0-.588.057l-.156.03h-.014v.015c-.043 0-.086.014-.115.014a.62.62 0 0 0-.4.789.625.625 0 0 0 .772.386 1 1 0 0 0 .188-.045c.186-.057.37-.127.528-.213a7.4 7.4 0 0 1 1.103-.316c.114 0 .244.057.33.129l.285-.042a8.04 8.04 0 0 0 3.54 4.426l-.1.258a.8.8 0 0 1 .044.358c-.143.344-.33.687-.56.987-.114.172-.215.33-.344.501 0 .043.001.117-.056.16-.014.043-.044.072-.059.114a.615.615 0 0 0 .372.787.62.62 0 0 0 .79-.372c.028-.043.055-.143.083-.143.072-.2.131-.387.174-.574a5.4 5.4 0 0 1 .473-1.102.5.5 0 0 1 .271-.129l.143-.257c1.82.702 3.84.701 5.688.014l.115.23a.53.53 0 0 1 .3.198c.186.33.301.674.43 1.032.043.187.102.373.174.588.028 0 .055.086.084.129.014.043.03.071.044.114a.61.61 0 0 0 .845.216.614.614 0 0 0 .213-.845c-.014-.057-.056-.13-.056-.174-.115-.157-.23-.329-.344-.486-.215-.316-.371-.63-.543-.974a.48.48 0 0 1 .042-.372 1.2 1.2 0 0 1-.1-.244c1.661-1.002 2.951-2.577 3.539-4.454.086.014.17.028.271.042.086-.115.201-.115.33-.115.387.057.73.16 1.103.302q.235.128.514.213c.058.014.116.03.202.03v.015c0 .014.058.013.1.028.344.043.617-.202.689-.532a.617.617 0 0 0-.532-.7c-.057-.014-.127-.03-.17-.072h-.588a7 7 0 0 1-1.102-.202.6.6 0 0 1-.274-.257l-.272-.07a7.8 7.8 0 0 0-1.262-5.531l.23-.2a.44.44 0 0 1 .114-.343c.273-.244.589-.46.918-.647a3.6 3.6 0 0 0 .5-.3 1 1 0 0 0 .13-.1c.043-.028.086-.058.086-.087.258-.243.273-.63 0-.859-.214-.257-.601-.257-.845 0-.043 0-.1.059-.142.087a11 11 0 0 0-.403.428c-.244.272-.53.532-.831.747a.55.55 0 0 1-.372.042l-.23.171a7.98 7.98 0 0 0-5.098-2.462l-.014-.274a.5.5 0 0 1-.201-.314 5.6 5.6 0 0 1 .07-1.102 4 4 0 0 0 .087-.588v-.316a.62.62 0 0 0-.546-.548m-.842 4.773-.174 3.223h-.014a.56.56 0 0 1-.114.302.543.543 0 0 1-.745.13h-.014L7.536 7.973a6.23 6.23 0 0 1 3.035-1.662c.23-.043.446-.086.66-.115zm1.544 0a6.38 6.38 0 0 1 3.682 1.777L13.837 9.85h-.014a.66.66 0 0 1-.3.073.535.535 0 0 1-.56-.518zm-6.2 2.938 2.406 2.19v.015c.086.071.157.16.157.274a.523.523 0 0 1-.372.657v.014l-3.095.89a6.4 6.4 0 0 1 .904-4.04m10.842.042c.73 1.189 1.032 2.595.932 3.984l-3.109-.89-.014-.014a.5.5 0 0 1-.257-.17.53.53 0 0 1 .056-.761l-.014-.042zm-5.915 2.322h.988l.615.758-.215.96-.887.431-.887-.43-.23-.96zm-2.308 2.65h.115c.243 0 .46.17.545.414 0 .1.001.23-.056.302v.042l-1.22 2.966a6.33 6.33 0 0 1-2.563-3.195zm5.274 0h.344l3.193.515a6.34 6.34 0 0 1-2.563 3.223l-1.234-3.022c-.115-.258.002-.558.26-.716m-2.521 1.298a.55.55 0 0 1 .529.277h.014l1.561 2.823a5 5 0 0 1-.615.171 6.4 6.4 0 0 1-3.481-.17l1.561-2.824h.014c.043-.1.115-.144.216-.215a.5.5 0 0 1 .201-.062\"/></svg>", Vs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0277bd\" d=\"M8 3a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2H3v2h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2v-2H8v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V5h2V3m6 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3z\"/></svg>", Hs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M8 1a5.5 5.5 0 0 0-4 9.26V15l4-1.5 4 1.5v-4.74A5.49 5.49 0 0 0 8 1m0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4\"/></svg>", Us = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffd54f\" d=\"M25 12h-3V8a6 6 0 0 0-12 0v4H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V13a1 1 0 0 0-1-1M14 8a2 2 0 0 1 4 0v4h-4Zm2 17a4 4 0 1 1 4-4 4 4 0 0 1-4 4\"/></svg>", Ws = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#afb42b\" d=\"M19 5v9h-5v5H5V5zm0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10l6-6V5c0-1.1-.9-2-2-2m-7 11H7v-2h5zm5-4H7V8h10z\"/></svg>", Gs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"M30 6a3.86 3.86 0 0 1-1.167 2.833 4.024 4.024 0 0 1-5.666 0A3.86 3.86 0 0 1 22 6a3.86 3.86 0 0 1 1.167-2.833 4.024 4.024 0 0 1 5.666 0A3.86 3.86 0 0 1 30 6m-9.208 5.208A10.6 10.6 0 0 0 13 8a10.6 10.6 0 0 0-7.792 3.208A10.6 10.6 0 0 0 2 19a10.6 10.6 0 0 0 3.208 7.792A10.6 10.6 0 0 0 13 30a10.6 10.6 0 0 0 7.792-3.208A10.6 10.6 0 0 0 24 19a10.6 10.6 0 0 0-3.208-7.792m-1.959 7.625a4.024 4.024 0 0 1-5.666 0 4.024 4.024 0 0 1 0-5.666 4.024 4.024 0 0 1 5.666 0 4.024 4.024 0 0 1 0 5.666\"/></svg>", Ks = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"m29.5 24.02-1.6-.92a4.4 4.4 0 0 0 .09-.9A1.3 1.3 0 0 0 28 22a5.6 5.6 0 0 0-.1-1.1l1.6-.92a.493.493 0 0 0 .18-.68l-1.5-2.6a.45.45 0 0 0-.18-.18V6.01a2.006 2.006 0 0 0-2-2H4a2.006 2.006 0 0 0-2 2V22a2.006 2.006 0 0 0 2 2h10.53l-.03.02a.493.493 0 0 0-.18.68l1.5 2.6a.493.493 0 0 0 .68.18l1.6-.92a5.9 5.9 0 0 0 1.9 1.09v1.85a.495.495 0 0 0 .5.5h3a.495.495 0 0 0 .5-.5v-1.85a5.9 5.9 0 0 0 1.9-1.09l1.6.92a.493.493 0 0 0 .68-.18l1.5-2.6a.493.493 0 0 0-.18-.68M24 22.01a1.99 1.99 0 0 1-.88 1.65l-.18.11a2.04 2.04 0 0 1-1.88 0l-.18-.11a1.99 1.99 0 0 1-.88-1.65V22a2 2 0 0 1 .88-1.66l.18-.11a2.04 2.04 0 0 1 1.88 0l.18.11A2 2 0 0 1 24 22Zm2-4.63-.1.06a5.9 5.9 0 0 0-1.9-1.09V14.5a.495.495 0 0 0-.5-.5h-3a.495.495 0 0 0-.5.5v1.85a5.9 5.9 0 0 0-1.9 1.09l-1.6-.92a.493.493 0 0 0-.68.18l-1.5 2.6a.493.493 0 0 0 .18.68l1.6.92A5.6 5.6 0 0 0 16 22v.01L4 22V10.01h22Z\"/></svg>", qs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", Js = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\".125\" x2=\"0\" y1=\"1\" y2=\"0\"><stop offset=\"0%\" stop-color=\"#ab47bc\"/><stop offset=\"37.5%\" stop-color=\"#ab47bc\"/><stop offset=\"37.501%\" stop-color=\"#d32f2f\"/><stop offset=\"54.25%\" stop-color=\"#d32f2f\"/><stop offset=\"54.251%\" stop-color=\"#ff7043\"/><stop offset=\"69.75%\" stop-color=\"#ff7043\"/><stop offset=\"69.751%\" stop-color=\"#ffa726\"/><stop offset=\"100%\" stop-color=\"#ffa726\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M22 2s-7.64-.37-13.66 7.88C3.72 16.21 2 22 2 22l1.94-1c1.44-2.5 2.19-3.53 3.6-5 2.53.74 5.17.65 7.46-2-2-.56-3.6-.43-5.96-.19C11.69 12 13.5 11.6 16 12l1-2c-1.8-.34-3-.37-4.78.04C14.19 8.65 15.56 7.87 18 8l1.11-1.73c-1.53-.06-2.4-.02-4.19.3 1.61-1.46 3.08-2.12 5.22-2.25 0 0 1.05-1.89 1.86-2.32\"/></svg>", Ys = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", Xs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M16 0 2 8v16l14 8 14-8V8Zm8 23a1 1 0 0 1-1 1h-2.52a1 1 0 0 1-.78-.375L12 14v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2.52a1 1 0 0 1 .78.375L20 18V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1Z\"/></svg>", Zs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M6 24h20v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM30 6l-9 9-5-11-5 11-9-9 4 14h20z\"/></svg>", Qs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><g stroke-width=\".395\"><path fill=\"#1976d2\" d=\"M133.347 451.499c0-.295-2.752-5.283-6.116-11.084s-6.116-10.776-6.116-11.055 9.514-16.889 21.143-36.912c11.629-20.022 21.323-36.798 21.542-37.279.346-.76-1.608-4.363-14.896-27.466-8.412-14.625-15.294-26.785-15.294-27.023 0-.5 24.46-43.501 25.206-44.31.414-.45.592-.384 1.078.395.32.513 16.876 29.256 36.791 63.87 62.62 108.85 74.852 130.01 75.41 130.46.3.242.544.554.544.694s-11.836.21-26.302.154c-23.023-.09-26.313-.175-26.393-.694-.11-.714-27.662-48.825-28.86-50.392-.746-.978-.906-1.035-1.426-.51-.688.696-28.954 49.323-29.49 50.733l-.364.96h-13.23c-10.895 0-13.228-.095-13.228-.538zm167.58-125.61c-.134-.216 1.189-2.863 2.939-5.882 6.924-11.944 84.29-145.75 96.49-166.88 7.143-12.371 13.143-22.465 13.334-22.433.362.062 25.86 43.105 25.86 43.655 0 .174-6.761 11.952-15.025 26.173-8.46 14.557-14.932 26.104-14.81 26.421.185.483 4.563.564 30.213.564h29.996l.957 1.48c.527.814 3.296 5.547 6.155 10.518s5.45 9.29 5.757 9.597c.705.705.703.724-.16 1.572-.396.388-3.36 5.323-6.588 10.965-3.228 5.643-6.056 10.387-6.285 10.543s-19.695.171-43.256.034l-42.84-.249-.803 1.15c-.442.632-7.505 12.736-15.696 26.897l-14.892 25.747h-15.486c-8.518 0-20.015.116-25.551.259-6.55.168-10.15.121-10.308-.135zm-133.75-157.86c-56.373-.055-102.5-.182-102.5-.282s5.617-10.132 12.481-22.294L89.64 123.34h30.332c27.113 0 30.332-.065 30.332-.611 0-.336-6.659-12.228-14.797-26.427s-14.797-25.917-14.797-26.04 2.682-4.853 5.96-10.51 6.003-10.578 6.056-10.934c.086-.586 1.375-.648 13.572-.648 7.412 0 13.463.143 13.446.317-.018.174.22.707.53 1.184.31.476 9.763 16.937 21.007 36.578 11.244 19.64 20.71 36.022 21.036 36.4.554.647 2.549.691 31.428.691h30.837l12.896 22.145c7.093 12.18 12.8 22.301 12.682 22.492-.117.19-4.776.303-10.352.249-5.575-.054-56.26-.143-112.63-.198z\"/><path fill=\"#64b5f6\" d=\"M23.046 238.939c-6.098 10.563-6.69 11.711-6.224 12.078.282.224 3.18 5.044 6.44 10.712s6.016 10.355 6.123 10.417c.106.061 13.585.153 29.95.204 16.367.052 29.994.23 30.285.399.473.273-1.08 3.094-14.637 26.574l-15.166 26.269 12.907 21.865c7.1 12.026 12.982 21.906 13.068 21.956s23.257-39.831 51.492-88.624c11.352-19.617 21.214-36.64 30.37-52.442 23.308-40.452 30.68-53.468 30.73-54.132-1.096-.11-6.141-.187-13.006-.216-3.945-.01-7.82-.02-12.75-.002l-25.341.092-15.42 26.706c-14.256 24.693-15.445 26.663-16.278 26.86l-.023.037c-.012.003-1.622-.001-1.826 0-4.29.062-20.453.063-40.226-.01-22.632-.082-41.615-.125-42.183-.096-.567.03-1.147-.03-1.29-.132-.141-.102-3.29 5.066-6.996 11.485zm205.16-190.3c-.123.149 5.62 10.392 12.761 22.763 12.2 21.131 89.393 155.03 96.276 167 1.503 2.613 2.92 4.803 3.443 5.348.9-1.249 3.532-5.63 7.954-13.219a1343 1343 0 0 1 10.05-17.76l6.606-11.443c.691-1.403.753-1.818.652-2.117-.161-.48-6.903-12.332-14.982-26.337-8.078-14.005-14.824-25.849-14.99-26.32a.73.73 0 0 1-.01-.366l-.426-.913 21.636-36.976c3.69-6.307 6.425-11.042 9.471-16.29 9.158-15.948 12.036-21.189 11.895-21.55-.126-.324-2.7-4.83-5.72-10.017-3.021-5.185-5.845-10.148-6.275-11.026-.483-.987-.734-1.364-1.1-1.456-.054.014-.083.018-.144.035-.42.112-5.455.195-11.19.185s-11.22.024-12.187.073l-1.76.089-14.998 25.978c-12.824 22.212-15.084 25.964-15.595 25.883-.024-.004-.15-.189-.235-.301-.109.066-.2.09-.271.05-.256-.148-7.144-11.902-15.306-26.119L279.4 48.817c-.116-.186-.444-.744-.458-.752-.476-.275-50.502.287-50.737.57zm-18.646 283.09c-.047.109-.026.262.043.48.328 1.05 25.338 43.735 25.772 43.985.206.119 14.178.239 31.05.266 26.65.044 30.749.152 31.234.832.307.43 9.987 17.214 21.513 37.296s21.152 36.627 21.394 36.767 5.926.243 12.633.23c6.705-.013 12.4.099 12.657.246.131.076.381-.141.851-.795l6.008-10.406c5.234-9.065 6.62-11.684 6.294-11.888-.575-.36-15.597-26.643-23.859-41.482-3.09-5.45-5.37-9.516-5.44-9.774-.196-.712-.066-.822 1.155-.98 1.956-.252 57.397-.057 58.071.205.237.092.79-.569 2.593-3.497 1.866-3.067 5.03-8.524 11.001-18.866 7.22-12.505 13.043-22.784 12.941-22.843s-.77-.051-1.489.016l-.046.001c-4.451.204-33.918.203-149.74.025-38.96-.06-69.786-.09-71.912-.072-1.12.01-2.095.076-2.66.172a.3.3 0 0 0-.062.083z\"/></g></svg>", $s = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#8bc34a\" d=\"M16 20.003v2h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2v-2h4v-2h-4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v2Z\"/><path fill=\"#8bc34a\" d=\"m16 3.003-12 7v14l4 2h6v-13.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v11.5H8l-2-1.034V11.15l10-5.833 10 5.833v11.703l-10 5.833-1.745-1.022L13 29.253l3 1.75 12-7v-14Z\"/></svg>", ec = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"M4 4v24h24V4Zm20 20h-4V12h-4v12H8V8h16Z\"/></svg>", tc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", nc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#ffab40\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", rc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"m12.019 15.021.003-.008c-.005-.021-.006-.026-.003.008\"/><path fill=\"#ff9800\" d=\"M4.51 3.273a2.523 2.523 0 0 0-2.524 2.523V11.3c.361-.13.88-.898 1.043-1.085.285-.327.337-.743.478-1.006C3.83 8.612 3.886 8.2 4.62 8.2c.342 0 .478.08.71.39.16.216.438.615.568.882.15.307.396.724.503.808q.122.095.233.137c.119.044.218-.037.297-.1.102-.082.145-.247.24-.467.135-.317.283-.697.367-.83.146-.23.195-.501.352-.633.232-.195.535-.208.618-.225.466-.092.677.225.907.43.15.133.355.403.5.765.114.283.26.544.32.707.059.158.203.41.289.713.077.275.286.486.365.616 0 0 .121.34.858.65.16.067.482.176.674.246.32.116.63.101 1.025.054.281 0 .434-.408.562-.734.075-.193.148-.745.197-.902.048-.153-.064-.27.031-.405.112-.156.178-.164.242-.368.138-.436.936-.458 1.384-.458.374 0 .327.363.96.239.364-.072.714.046 1.1.149.324.086.63.184.812.398.119.139.412.834.113.863.029.035.05.099.104.134-.067.262-.357.075-.518.041-.217-.045-.37.007-.583.101-.363.162-.894.143-1.21.407-.27.223-.269.721-.394 1 0 0-.348.895-1.106 1.443-.194.14-.574.477-1.4.605a5.3 5.3 0 0 1-1.1.043c-.186-.009-.362-.018-.549-.02-.11-.002-.48-.013-.461.022l-.041.103.024.138c.015.083.019.149.022.225.006.157-.013.32-.005.478.017.328.138.627.154.958.017.368.199.758.375 1.059.067.114.169.128.213.269.052.161.003.333.028.505.1.668.292 1.366.592 1.97l.008.014c.371-.062.743-.196 1.226-.267.885-.132 2.115-.064 2.906-.138 2-.188 3.085.82 4.882.407V5.796a2.523 2.523 0 0 0-2.523-2.523zm-.907 11.144q-.022 0-.046.003c-.159.025-.313.08-.412.24-.08.13-.108.355-.164.505-.064.175-.176.338-.274.505-.18.305-.504.581-.644.879-.028.06-.053.13-.076.2v3.402c.163.028.333.062.524.113 1.407.375 1.75.407 3.13.25l.13-.018c.105-.22.187-.968.255-1.2.054-.178.127-.32.155-.5.026-.173-.003-.337-.017-.493-.04-.393.285-.533.44-.87.14-.304.22-.651.336-.963.11-.298.284-.721.579-.872-.036-.041-.617-.06-.772-.076a5 5 0 0 1-.5-.07c-.314-.064-.656-.126-.965-.2a10 10 0 0 1-.947-.328c-.298-.138-.503-.497-.732-.507m5.737.83c-.74.149-.97.876-1.32 1.451-.192.319-.396.59-.548.928-.14.312-.128.657-.368.924a2.55 2.55 0 0 0-.528.922c-.023.067-.088.776-.158.943l1.101-.078c1.026.07.73.464 2.332.378l2.529-.078a7 7 0 0 0-.228-.588c-.07-.147-.16-.434-.218-.56a3.5 3.5 0 0 0-.309-.526c-.184-.215-.227-.23-.28-.503-.095-.473-.344-1.33-.637-1.923-.151-.306-.403-.562-.634-.784-.2-.195-.655-.522-.734-.505z\"/></svg>", ic = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ef5350\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z\"/></svg>", ac = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ba68c8\" d=\"M11.057 2.981c.537.735.028 1.653.141 2.472a3.42 3.42 0 0 1-1.03 2.415c-1.414 1.625-3.165 3.038-4.097 5.03a5.28 5.28 0 0 0 1.412 5.847c.706.735 1.54 1.342 2.472 1.738.17.805-1.088.184-1.455 0A6.7 6.7 0 0 1 4.361 16.4a5.44 5.44 0 0 1 .904-5.368c1.272-1.61 3.136-2.543 4.662-3.857.565-.55 1.003-1.3.932-2.119.156-.678-.254-1.469.212-2.09zm-.07 18.929c-.17.198-.467.325-.495.24-.042-.085.212-.127.381-.325.17-.183.127-.522.24-.522.1 0 .043.395-.14.607zm2.16 0c.17.198.453.31.495.24.028-.085-.212-.141-.395-.339-.156-.184-.113-.523-.24-.523-.085 0-.029.41.14.608zm-1.03.48c-.1 0-.071-.296-.071-.65 0-.367-.028-.663.07-.663.085 0 .057.296.057.663 0 .354.014.65-.057.65m-.495-20.765c.34.24.254 2.077.254 3.136 0 1.653.184 3.376-.805 4.916-.96 1.497-2.048 3.108-1.95 4.972.1 1.837.99 3.504 2.148 5.043.664.876-.353.509-.876.085a7.2 7.2 0 0 1-2.755-5.664c.142-1.907 1.597-3.348 2.628-4.803.805-1.13 1.186-1.879 1.215-3.645.028-1.412-.142-3.531.042-3.983.014-.043.07-.1.099-.057m.537 2.232c-.085 0-.043.396.028.72.424 2.26-.198 4.52-.749 6.682a12.77 12.77 0 0 0 .283 7.826c.607 1.568 1.71.791 2.161 1.568.34.593 1.272.198 1.978-.141 2.232-1.102 4.012-3.108 4.11-5.566.029-.494 0-.989-.07-1.497-.283-1.837-1.78-3.065-3.15-4.083-1.215-.89-2.74-1.483-3.659-2.613-.523-.65-.297-1.638-.381-2.458-.043-.452-.255-.042-.382-.268-.084-.127-.14-.17-.17-.17zm.72 3.616c.057 0 .17.071.325.226a20 20 0 0 0 2.161 1.921c1.272.961 2.43 2.091 2.967 3.504.339.875.339 1.836.226 2.74-.184 1.384-1.187 2.444-2.119 3.404-.339.354-1.06.791-1.074.678-.084-.367.763-1.172 1.159-1.695A5.93 5.93 0 0 0 16 10.962c-1.102-1.214-2.317-1.907-2.995-3.08-.14-.253-.183-.409-.113-.409z\"/></svg>", oc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M12 18.08c-6.63 0-12-2.72-12-6.08s5.37-6.08 12-6.08S24 8.64 24 12s-5.37 6.08-12 6.08m-5.19-7.95c.54 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.58 1.09q-.42.33-1.29.33h-.87l.53-2.76zm-3.5 5.55h1.44l.34-1.75h1.23c.54 0 .98-.06 1.33-.17.35-.12.67-.31.96-.58.24-.22.43-.46.58-.73.15-.26.26-.56.31-.88.16-.78.05-1.39-.33-1.82-.39-.44-.99-.65-1.82-.65H4.59zm7.25-8.33-1.28 6.58h1.42l.74-3.77h1.14c.36 0 .6.06.71.18s.13.34.07.66l-.57 2.93h1.45l.59-3.07c.13-.62.03-1.07-.27-1.36-.3-.27-.85-.4-1.65-.4h-1.27L12 7.35zM18 10.13c.55 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.57 1.09-.29.22-.72.33-1.3.33h-.85l.5-2.76zm-3.5 5.55h1.44l.34-1.75h1.22c.55 0 1-.06 1.35-.17.35-.12.65-.31.95-.58.24-.22.44-.46.58-.73.15-.26.26-.56.32-.88.15-.78.04-1.39-.34-1.82-.36-.44-.99-.65-1.82-.65h-2.75z\"/></svg>", sc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e0e0e0\" d=\"M2 22h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zM12 12h8v8h-8z\"/><path fill=\"#ffb300\" d=\"M2 2h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zm0 10h8v8h-8z\"/></svg>", cc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#e64a19\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM8 11v2h1v6H8v1h4v-1h-1v-2h2a3 3 0 0 0 3-3 3 3 0 0 0-3-3zm5 2a1 1 0 0 1 1 1 1 1 0 0 1-1 1h-2v-2z\"/></svg>", lc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#03a9f4\" d=\"M29.07 6H7.677A1.535 1.535 0 0 0 6.24 7.113l-4.2 17.774A.852.852 0 0 0 2.93 26h21.393a1.535 1.535 0 0 0 1.436-1.113L29.96 7.112A.852.852 0 0 0 29.07 6M8.626 23.797a1.4 1.4 0 0 1-1.814-.31l-.007-.009a1.075 1.075 0 0 1 .315-1.599l9.6-6.061-6.102-5.852-.01-.01a1.068 1.068 0 0 1 .084-1.625l.037-.03a1.38 1.38 0 0 1 1.8.07l7.233 6.957a1.1 1.1 0 0 1 .236.739 1.08 1.08 0 0 1-.412.79c-.074.04-.146.119-10.951 6.935ZM24 22.94A1.135 1.135 0 0 1 22.803 24h-5.634a1.061 1.061 0 1 1 .001-2.112h5.633A1.134 1.134 0 0 1 24 22.938Z\"/></svg>", uc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#f44336\" d=\"M2 8h4v1H2zm0 6h4v1H2zm9-10h3v1h-3zM2 2h3v1H2z\"/><path fill=\"#f9a825\" d=\"M9 2h3v1H9zm1 4h4v1h-4zm-5 6h1v1H5zm-3-2h6v1H2z\"/><path fill=\"#26a69a\" d=\"M2 12h3v1H2zm7-4h5v1H9zM2 4h4v1H2zm3-2h4v1H5z\"/><path fill=\"#ba68c8\" d=\"M2 6h3v1H2zm7-2h2v1H9zm-1 6h4v1H8z\"/></svg>", dc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"m27.777 22.617-.459-.946L18.43 3.26a2.25 2.25 0 0 0-1.914-1.256A2 2 0 0 0 16.379 2a2.23 2.23 0 0 0-1.891 1.042L4.348 19.056a2.2 2.2 0 0 0 .025 2.417l4.957 7.488A2.34 2.34 0 0 0 11.29 30a2.4 2.4 0 0 0 .655-.092l14.387-4.149a2.32 2.32 0 0 0 1.458-1.234 2.21 2.21 0 0 0-.013-1.908m-3.538.604-11.268 3.25 4.075-19.033 7.568 15.671-.376.098Z\"/></svg>", fc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"M16 27 2 19v-5l14 8z\"/><path fill=\"#ffeb3b\" d=\"m30 14-14 8v5l14-8z\"/><path fill=\"#ff5722\" d=\"M16 6 2 14v5l14-8z\"/><path fill=\"#00e676\" d=\"m30 19-14-8V6l14 8z\"/><path fill=\"#03a9f4\" d=\"M16 27 2 19v-5l14 8z\"/></svg>", pc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\"><g transform=\"translate(-.25 -1.71)\"><path fill=\"#ffe0b2\" d=\"M107.4 50.9c-.2-4.4.4-8.3-1.6-11.6-4.8-8.2-16.8-13-40.8-13v.7h-.5.5v-.7c-24 0-36.6 4.8-41.4 13.1-1.9 3.4-1.7 7.2-2 11.6-.2 3.5-1.8 7.2-1.1 11.2.8 5.2 1.1 10.4 1.9 15.2.6 3.9 6 7.2 6.5 10.9 1.4 10.2 12 14.9 36 14.9v.8h-.6.7v-.8c24 0 34.2-4.7 35.5-14.9.5-3.8 5.5-7 6.1-10.9.8-4.8 1.1-10 1.9-15.2.7-4-.9-7.8-1.1-11.3\"/><path fill=\"#ffe0b2\" d=\"M64.6 54.5c4.3.1 7.3 2.8 10.1 5.3 3.3 2.9 8.9 4.9 11.2 7.4s5.3 5 6.4 8.9 1.4 8.9 1.4 10.2.7 1 2.7 0c4.7-2.3 9.9-8.5 9.9-8.5-.6 3.9-5.7 7.4-6.2 11.1C98.9 99.1 89 104 64.5 104h-.1.6\"/><path fill=\"#ffe0b2\" d=\"M80.4 46.7c.9 3.1 4.1 13.6-2.1 10.1 0 0 2.6 1.5 4.2 7.2 1.7 5.7 5.8 6.4 5.8 6.4s6.7 1.3 11.7-3c4.2-3.6 4.9-10 3.1-14.9-1.8-4.8-5-6.3-9.7-7.3-4.7-1.1-14.1-2-13 1.5\"/><circle cx=\"92.3\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"90\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#ffe0b2\" d=\"M78.9 57.7s7.9 5.4 12.2 10.7 4.2 6.3 4.2 6.3l-3.1 1.4s-4.4-8.3-9.8-11.4c-5.5-3.1-6.1-5.7-6.1-5.7zm-14-3.2c-4.3.1-7.5 2.8-10.4 5.3-3.3 2.9-9.1 4.9-11.4 7.4s-5.4 5-6.5 8.9-1.5 8.9-1.5 10.2.2 1.4-2.7 0c-4.7-2.2-9.9-8.5-9.9-8.5.6 3.9 5.7 7.4 6.2 11.1C30.1 99.1 40 104 64.5 104h.5\"/><path fill=\"#4e342e\" d=\"M88.1 71.4C83.3 65.5 75.6 60 64.9 60h-.1c-10.7 0-18.4 5.5-23.2 11.4-5 6.1-4.6 8.5-4.6 14.3 0 21 7.4 15 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.7 12.3-17.3.1-5.8.4-8.4-4.6-14.5\"/><path fill=\"#3e2723\" d=\"M64.4 65.2s-.7 9.7-2.1 11.6l2.6-.6z\"/><path fill=\"#3e2723\" d=\"M65.1 65.2s.7 9.7 2.1 11.6l-2.6-.6z\"/><path fill=\"#4e342e\" d=\"M56.7 62.9c-1-2.3 2.6-6 8.3-6.1 5.7 0 9.3 3.7 8.3 6.1S68.7 66 65 66.1c-3.6-.1-7.3-.8-8.3-3.2\"/><path d=\"M65 65.2c0-.4 3.4-.5 5.2-1.7 0 0-3.7 1.2-4.5.7-.8-.4-1-1.6-1-1.6s-.3 1.2-.9 1.6c-.7.4-4.9-.7-4.9-.7s5.6 1.4 5.6 1.7-.1 1.3-.1 2c0 2.5 0 8.7.4 9.2.6.9.4-6.7.4-9.2-.1-.8-.1-1.6-.2-2\"/><path fill=\"#795548\" d=\"M65.2 78.6c1.7 0 4.7 1.2 7.4 3.1-2.6-2.9-5.7-4.9-7.4-4.9-1.8 0-5.6 2.2-8.3 5.4 2.8-2.2 6.4-3.6 8.3-3.6\"/><g fill=\"#3e2723\"><path d=\"M64.5 96.3c-3.8 0-7.5-1.2-10.9-2.1-.7-.2-1.4.3-2.1.1-6.3-2-11.4-5.4-14.5-9.7v1c0 21 7.4 15.1 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.6 12.3-17.4 0-.8 0-1.6.1-2.3-2.9 4.7-8.2 8.4-14.8 10.6-.6.2-2-.3-2.6-.2-3.6 1.2-6.8 2.5-10.9 2.5\"/><path d=\"M55 85s-2.5 7.5-.8 10.8l-2.3-1s1.7-7.6 3.1-9.8m19.8 0s2.5 7.5.8 10.8l2.3-1s-1.8-7.6-3.1-9.8\"/></g><path fill=\"#ffe0b2\" d=\"M48.6 46.7c-.9 3.1-4.1 13.6 2.1 10.1 0 0-2.6 1.5-4.2 7.2s-5.8 6.4-5.8 6.4-6.7 1.3-11.7-3c-4.2-3.6-4.9-10-3.1-14.9s5-6.3 9.7-7.3c4.7-1.1 14-2 13 1.5\"/><path d=\"M64.9 76.8c2.7 0 11.1 5.8 11.2 12.9v-.4c0-7.4-6.8-13.3-11.2-13.3s-11.2 6-11.2 13.3v.4c.1-7.1 8.5-12.9 11.2-12.9\"/><g fill=\"#3e2723\"><ellipse cx=\"66.7\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(-14.465 66.71 61.469)\"/><ellipse cx=\"62.4\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(17.235 62.372 61.463)\"/></g><circle cx=\"37.2\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"39.5\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#795548\" d=\"M67.5 58.2c0-.1-2.3 1-2.9 1.1-.6-.1-2.9-1.2-2.9-1.1z\"/><path fill=\"#ffe0b2\" d=\"M50 57.7s-7.9 5.4-12.2 10.7-4.2 6.3-4.2 6.3l3.1 1.4s4.4-8.3 9.8-11.4 6.1-5.7 6.1-5.7z\"/><path fill=\"#ffe0b2\" d=\"M32.7 41.7S30 49.1 24 52.2c0 0 9.4-1.1 8.7-10.5m63.1 0s2.7 7.4 8.7 10.5c0 0-9.4-1.1-8.7-10.5M78.7 55.5s-5.9-6.2-13.8-6.4h.2c-8 .2-13.8 6.4-13.8 6.4 6.9-4.8 12.8-4.7 13.8-4.7-.1 0 6.7-.1 13.6 4.7m-6.9-13s-3-4.2-7-4.3h.2c-3 .1-6.9 4.3-6.9 4.3 3.4-3.3 6.9-3.2 6.9-3.2s3.3-.1 6.8 3.2M37.2 73.2s-4.7 2.3-8.1.9H29c-3-1.7-4.5-6.8-4.5-6.8s3 9 12.7 5.9m54.8 0s4.7 2.3 8.1.9c4-1.7 4.6-6.8 4.6-6.8s-3 9-12.7 5.9\"/><path fill=\"#ffe0b2\" d=\"M42.6 41.2c2.6-.5 6.9-.6 10.3.5 4.3 1.5.8 7 1.7 7.3s2.1-3.8 10.1-3.4c8.1.4 9 4 10.1 3.4s-1.1-10 11-7.8c0 0-12.7-3.4-12.1 5.8 0 0-7.3-5.6-17.5-.6.1 0 2.7-8.6-13.6-5.2m44.3 0c.2 0 .3.1.4.1s-.1-.1-.4-.1M39.1 28.9S28.3 42.5 26.7 47.7c-1.6 5.3-2.8 27-4.2 30.1l-5-21.4 9.2-22.3zm50.8 0s10.8 13.6 12.4 18.8c1.6 5.3 2.8 27 4.2 30.1l5-21.4-9.2-22.3z\"/><path fill=\"#4e342e\" d=\"M89.4 28.9s11.6 9.7 15 20.9 2 24.8 4.6 26.5c3.7 2.4 7.9-11.9 9.3-13.4 2.2-2.4 9.5-8.5 10-9.6s-14.8-17.8-21.5-21.1c-8.1-3.8-18.1-4.1-17.4-3.3\"/><path fill=\"#3e2723\" d=\"M99.3 34.9s13.7 17.5 13.5 39.3l5.5-11.2c-.1 0-4.9-14.3-19-28.1\"/><path fill=\"#4e342e\" d=\"M39.1 28.9s-11.6 9.7-15 20.9-2 24.8-4.6 26.5c-3.7 2.4-7.9-11.9-9.3-13.4C8 60.5.7 54.4.2 53.3S15 35.5 21.7 32.2c8.1-3.8 18.1-4.1 17.4-3.3\"/><path fill=\"#3e2723\" d=\"M29.2 34.9S15.5 52.4 15.7 74.2L10.3 63s4.8-14.3 18.9-28.1\"/><path fill=\"#ffe0b2\" d=\"M21.8 74.6s1 5.4 2.6 7.1.5-1.3.5-1.3-1.7-.9-1.4-7.8-1.7 2-1.7 2m85.3 0s-1 5.4-2.6 7.1-.5-1.3-.5-1.3 1.7-.9 1.4-7.8 1.7 2 1.7 2\"/><g fill=\"#3e2723\"><circle cx=\"54.5\" cy=\"70.5\" r=\".8\"/><circle cx=\"49.9\" cy=\"75.3\" r=\".8\"/><circle cx=\"48.4\" cy=\"70.5\" r=\".8\"/></g><g fill=\"#3e2723\"><circle cx=\"74\" cy=\"70.5\" r=\".8\"/><circle cx=\"78.6\" cy=\"75.3\" r=\".8\"/><circle cx=\"80.1\" cy=\"70.5\" r=\".8\"/></g></g></svg>", mc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M9.86 2A2.86 2.86 0 0 0 7 4.86v1.68h4.29c.39 0 .71.57.71.96H4.86A2.86 2.86 0 0 0 2 10.36v3.781a2.86 2.86 0 0 0 2.86 2.86h1.18v-2.68a2.85 2.85 0 0 1 2.85-2.86h5.25c1.58 0 2.86-1.271 2.86-2.851V4.86A2.86 2.86 0 0 0 14.14 2zm-.72 1.61c.4 0 .72.12.72.71s-.32.891-.72.891c-.39 0-.71-.3-.71-.89s.32-.711.71-.711\"/><path fill=\"#fdd835\" d=\"M17.959 7v2.68a2.85 2.85 0 0 1-2.85 2.859H9.86A2.85 2.85 0 0 0 7 15.389v3.75a2.86 2.86 0 0 0 2.86 2.86h4.28A2.86 2.86 0 0 0 17 19.14v-1.68h-4.291c-.39 0-.709-.57-.709-.96h7.14A2.86 2.86 0 0 0 22 13.64V9.86A2.86 2.86 0 0 0 19.14 7zM8.32 11.513l-.004.004.038-.004zm6.54 7.276c.39 0 .71.3.71.89a.71.71 0 0 1-.71.71c-.4 0-.72-.12-.72-.71s.32-.89.72-.89\"/></svg>", hc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1976d2\" d=\"M11.956 4.05c-5.694 0-10.354 3.106-10.354 6.947 0 3.396 3.686 6.212 8.531 6.813v2.205h3.53V17.82c.88-.093 1.699-.259 2.475-.497l1.43 2.692h3.996l-2.402-4.048c1.936-1.263 3.147-3.034 3.147-4.97 0-3.841-4.659-6.947-10.354-6.947m1.584 2.712c4.349 0 7.558 1.45 7.558 4.753 0 1.77-.952 3.013-2.505 3.779a1 1 0 0 1-.228-.156c-.373-.165-.994-.352-.994-.352s3.085-.227 3.085-3.302-3.23-3.127-3.23-3.127h-7.092v7.413c-2.64-.766-4.462-2.392-4.462-4.255 0-2.63 3.52-4.753 7.868-4.753m.156 4.12h2.143s.983-.05.983.974c0 1.004-.983 1.004-.983 1.004h-2.143v-1.977m-.031 4.566h.952c.186 0 .28.052.445.207.135.103.28.3.404.476-.57.073-1.17.104-1.801.104z\"/></svg>", gc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bcd4\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#00bcd4\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#00bcd4\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#00bcd4\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", _c = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#0288d1\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#0288d1\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#0288d1\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", vc = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 1C4.136 1 1 4.136 1 8s3.136 7 7 7 7-3.136 7-7-3.136-7-7-7m1 11H7V7.5h2zm0-6H7V4h2z\"/></svg>", yc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#f44336\" d=\"M18.041 3.177c2.24.382 2.879 1.919 2.843 3.527V6.67l-1.013 13.266-13.132.897h.008c-1.093-.044-3.518-.151-3.634-3.545l1.217-2.222 2.462 5.74 2.097-6.77-.045.009.018-.018 6.85 2.186L13.945 9.3l6.53-.409-5.144-4.212 2.71-1.51v.009M3.113 17.252v.017zM6.916 6.874c2.63-2.622 6.033-4.168 7.34-2.844 1.297 1.306-.072 4.523-2.702 7.135-2.666 2.613-6.015 4.248-7.322 2.933-1.306-1.324.036-4.612 2.675-7.224z\"/></svg>", bc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"m30 12-4-2V6h-4l-2-4-4 2-4-2-2 4H6v4l-4 2 2 4-2 4 4 2v4h4l2 4 4-2 4 2 2-4h4v-4l4-2-2-4ZM6 16a9.9 9.9 0 0 1 .842-4H10v8H6.842A9.9 9.9 0 0 1 6 16m10 10a9.98 9.98 0 0 1-7.978-4H16v-2h-2v-2h4c.819.819.297 2.308 1.179 3.37a1.89 1.89 0 0 0 1.46.63h3.34A9.98 9.98 0 0 1 16 26m-2-12v-2h4a1 1 0 0 1 0 2Zm11.158 6H24a2.006 2.006 0 0 1-2-2 2 2 0 0 0-2-2 3 3 0 0 0 3-3q0-.08-.004-.161A3.115 3.115 0 0 0 19.83 10H8.022a9.986 9.986 0 0 1 17.136 10\"/></svg>", xc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M27.837 5.673a4.33 4.33 0 0 0-2.293-2.701c-2.362-1.261-6.11-1.298-9.548-.092a26.3 26.3 0 0 0-8.76 4.966c-2.752 2.542-3.438 4.925-3.189 6.194.523 2.668 3.274 4.539 5.485 6.042.418.284.822.559 1.175.816-1.429.76-4.261 2.444-5.088 4.248a3.88 3.88 0 0 0-.118 3.332A2.37 2.37 0 0 0 6.869 29.8a5.6 5.6 0 0 0 1.49.2 6.35 6.35 0 0 0 5.19-2.856 6.74 6.74 0 0 0 .864-5.382 7.3 7.3 0 0 1 2.044-.03 3.92 3.92 0 0 1 2.816 1.311 1.82 1.82 0 0 1 .423 1.262 1.55 1.55 0 0 1-.772 1.05c-.234.14-.586.355-.504.803.036.194.198.633.894.512a2.93 2.93 0 0 0 2.145-2.651 4 4 0 0 0-1.197-2.904 5.94 5.94 0 0 0-4.396-1.626 10.6 10.6 0 0 0-2.672.304 20 20 0 0 0-2.203-1.846c-1.712-1.3-3.33-2.529-3.235-4.26.125-2.263 2.468-4.532 6.964-6.744 4.016-1.976 7.254-2.037 8.944-1.438a2 2 0 0 1 1.204.883 2.77 2.77 0 0 1-.36 2.47 9.71 9.71 0 0 1-7.425 4.304 3.86 3.86 0 0 1-3.238-.757c-.278-.302-.593-.645-1.074-.383q-.565.31-.225 1.189a3.9 3.9 0 0 0 2.407 1.92 11.7 11.7 0 0 0 7.128-.671c3.527-1.35 6.681-5.202 5.756-8.787M11.895 24.475a4 4 0 0 1-.192.468 4.5 4.5 0 0 1-.753 1.081 2.83 2.83 0 0 1-2.533 1.107c-.056-.032-.078-.146-.085-.193a3.28 3.28 0 0 1 1.076-2.284 11.3 11.3 0 0 1 2.644-1.933 3.85 3.85 0 0 1-.157 1.754\"/></svg>", Sc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#0277bd\" d=\"M105.46 209.517c-7.875 0-13.452-7.521-13.452-15.37v-.327c0-7.848 5.578-13.735 13.452-13.735h164.05c1.476-4.905 2.625-11.446 3.281-17.986h-137.81c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h137.31c-.82-6.54-1.969-13.081-3.773-17.986h-104.01c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h91.87c-21.327-37.607-60.864-61.315-106.14-61.315-67.918 0-123.04 54.448-123.04 122.3 0 67.856 55.122 123.28 123.04 123.28 46.59 0 87.112-25.507 107.95-63.114h-152.73z\"/></svg>", Cc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"m6.457 9.894 12.523 5.163-.456 1.211L6 11.105Zm7.02-3.091L26 11.966l-.457 1.21L13.02 8.015ZM6.465 18.885l12.524 5.163-.457 1.21L6.01 20.097Zm7.007-3.086 12.524 5.163-.456 1.21-12.524-5.162Z\"/><path fill=\"#f44336\" d=\"M6 24.07V30l19.997-3.106V20.96zM6 5.11v5.99l20-3.11V2zm0 9.96v5.03l20-3.11v-5.03z\"/></svg>", wc = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.6.6 0 0 0-.18-.03c-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1q.09.03.18.03c.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64zm-1.98-1.71c.04.31.05.52.05.73s-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2\"/></svg>", Tc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"#0288d1\"><path d=\"m5.747 14.046 6.254 8.61 6.252-8.61-6.254 3.807z\"/><path d=\"M11.999 1.343 5.747 11.83l6.252 3.807 6.253-3.807z\"/></g></svg>", Ec = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff4081\" d=\"m24.95 28.948-18-.9a1 1 0 0 1-.95-1V6.906a1 1 0 0 1 .9-.995l18-1.905A1 1 0 0 1 26 5v22.949a1 1 0 0 1-1.05.998Z\"/><path fill=\"#fafafa\" d=\"m20 8.52.19-4.242 3.649-.275.16 4.37a.28.28 0 0 1-.276.283.3.3 0 0 1-.188-.063L22.123 7.52l-1.668 1.23a.29.29 0 0 1-.398-.055A.27.27 0 0 1 20 8.52m-2.128 6.647c0 .487 3.448.25 3.912-.094 0-3.324-1.87-5.073-5.298-5.073-3.421 0-5.345 1.774-5.345 4.436 0 4.642 6.561 4.735 6.561 7.266a1.022 1.022 0 0 1-1.164 1.13c-1.047 0-1.459-.512-1.413-2.242 0-.375-3.984-.494-4.101 0-.308 4.198 2.426 5.41 5.56 5.41C19.619 26 22 24.45 22 21.658c0-4.973-6.653-4.842-6.653-7.31a1.08 1.08 0 0 1 1.243-1.13c.478 0 1.354.08 1.282 1.949\"/></svg>", Dc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#c0ca33\" d=\"M127.22 155.91c14.639-17.51 16.362-35.594 5.023-69.178-7.176-21.241-19.089-37.603-10.334-50.807 9.33-14.065 29.135-.43 12.63 18.371l3.301 2.296c19.806 2.297 29.566-24.83 14.783-32.58-39.038-20.38-73.197 18.802-58.127 64.155 6.459 19.232 15.501 39.613 8.181 55.831-6.315 13.922-18.515 22.103-26.695 22.39-17.079.862-5.74-38.32 13.922-48.08 1.722-.86 4.162-2.009 1.866-4.88-24.255-2.726-38.464 8.468-46.645 24.113-23.825 45.497 45.21 62.289 82.096 18.37z\"/></svg>", Oc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#ff5722\" d=\"M175.94 24.328c-13.037.252-26.009 3.872-37.471 11.174L79.912 72.818a67.13 67.13 0 0 0-30.355 44.906 70.8 70.8 0 0 0 6.959 45.445 67.2 67.2 0 0 0-10.035 25.102 71.54 71.54 0 0 0 12.236 54.156c23.351 33.41 69.468 43.311 102.81 22.07l58.559-37.158a67.36 67.36 0 0 0 30.355-44.906 70.77 70.77 0 0 0-6.982-45.422 67.65 67.65 0 0 0 10.059-25.102 71.63 71.63 0 0 0-12.236-54.156v-.18c-15.324-21.925-40.453-33.727-65.342-33.246zm5.137 28.68a46.5 46.5 0 0 1 36.09 19.969 42.98 42.98 0 0 1 7.365 32.557 45 45 0 0 1-1.393 5.455l-1.123 3.37-2.986-2.247a75.9 75.9 0 0 0-22.902-11.45l-2.244-.651.201-2.246a13.16 13.16 0 0 0-2.379-8.711 13.99 13.99 0 0 0-14.953-5.412 12.8 12.8 0 0 0-3.594 1.572l-58.578 37.25a12.24 12.24 0 0 0-5.502 8.15 13.1 13.1 0 0 0 2.246 9.834 14.03 14.03 0 0 0 14.93 5.569 13.5 13.5 0 0 0 3.594-1.573l22.453-14.234a41.8 41.8 0 0 1 11.898-5.232 46.48 46.48 0 0 1 49.914 18.502 43.02 43.02 0 0 1 7.363 32.557 40.42 40.42 0 0 1-18.254 27.078l-58.58 37.316a43 43 0 0 1-11.898 5.23A46.545 46.545 0 0 1 82.81 227.14a42.98 42.98 0 0 1-7.341-32.557 38 38 0 0 1 1.39-5.41l1.102-3.37 3.008 2.246a75.9 75.9 0 0 0 22.836 11.361l2.244.65-.201 2.247a13.25 13.25 0 0 0 2.447 8.644 14.03 14.03 0 0 0 15.043 5.569 13.1 13.1 0 0 0 3.592-1.573l58.467-37.316a12.17 12.17 0 0 0 5.502-8.173 12.96 12.96 0 0 0-2.246-9.811 14.03 14.03 0 0 0-15.043-5.568 12.8 12.8 0 0 0-3.592 1.57l-22.453 14.258a42.9 42.9 0 0 1-11.877 5.209 46.52 46.52 0 0 1-49.846-18.5 43.02 43.02 0 0 1-7.297-32.557A40.42 40.42 0 0 1 96.798 96.98l58.646-37.316a42.8 42.8 0 0 1 11.811-5.21 46.5 46.5 0 0 1 13.822-1.444z\"/></svg>", kc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffb300\" d=\"M29.168 14.03a2.7 2.7 0 0 0-1.968-.83 2.51 2.51 0 0 0-1.929.8h-4.443l3.078-3.078a2.835 2.835 0 0 0 2.857-2.842 2.6 2.6 0 0 0-.831-1.969 2.82 2.82 0 0 0-2.014-.788 2.67 2.67 0 0 0-1.968.788 2.36 2.36 0 0 0-.812 1.922L18 11.17V6.726a2.51 2.51 0 0 0 .8-1.929 2.7 2.7 0 0 0-.832-1.968 2.745 2.745 0 0 0-3.936 0 2.7 2.7 0 0 0-.832 1.968 2.51 2.51 0 0 0 .8 1.93v4.443l-3.138-3.138a2.36 2.36 0 0 0-.812-1.922 2.66 2.66 0 0 0-1.968-.788 2.83 2.83 0 0 0-2.014.788 2.6 2.6 0 0 0-.831 1.969 2.74 2.74 0 0 0 .831 2.013 2.8 2.8 0 0 0 2.026.829l3.078 3.078H6.729a2.51 2.51 0 0 0-1.929-.8 2.7 2.7 0 0 0-1.968.831 2.745 2.745 0 0 0 0 3.937 2.7 2.7 0 0 0 1.968.832 2.51 2.51 0 0 0 1.929-.8h4.443l-3.078 3.077a2.835 2.835 0 0 0-2.857 2.842 2.6 2.6 0 0 0 .831 1.969 2.82 2.82 0 0 0 2.014.788 2.67 2.67 0 0 0 1.968-.788 2.36 2.36 0 0 0 .812-1.922L14 20.827v4.444a2.51 2.51 0 0 0-.8 1.929 2.784 2.784 0 0 0 4.768 1.968A2.7 2.7 0 0 0 18.8 27.2a2.51 2.51 0 0 0-.8-1.929v-4.444l3.138 3.138a2.36 2.36 0 0 0 .812 1.922 2.66 2.66 0 0 0 1.968.788 2.83 2.83 0 0 0 2.014-.788 2.6 2.6 0 0 0 .831-1.969 2.74 2.74 0 0 0-.831-2.013 2.8 2.8 0 0 0-2.026-.829L20.828 18h4.443a2.51 2.51 0 0 0 1.93.8 2.784 2.784 0 0 0 1.967-4.769Z\"/></svg>", Ac = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff6e40\" d=\"M17.087 19.721c-2.36 1.36-5.59 1.5-8.86.1a13.8 13.8 0 0 1-6.23-5.32c.67.55 1.46 1 2.3 1.4 3.37 1.57 6.73 1.46 9.1 0-3.37-2.59-6.24-5.96-8.37-8.71-.45-.45-.78-1.01-1.12-1.51 8.28 6.05 7.92 7.59 2.41-1.01 4.89 4.94 9.43 7.74 9.43 7.74.16.09.25.16.36.22.1-.25.19-.51.26-.78.79-2.85-.11-6.12-2.08-8.81 4.55 2.75 7.25 7.91 6.12 12.24-.03.11-.06.22-.05.39 2.24 2.83 1.64 5.78 1.35 5.22-1.21-2.39-3.48-1.65-4.62-1.17\"/></svg>", jc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zm4 7.5h-4v2h1l-2 1.67L10 13h1v-2H7v2h1l3 2.5L8 18H7v2h4v-2h-1l2-1.67L14 18h-1v2h4v-2h-1l-3-2.5 3-2.5h1z\"/></svg>", Mc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#5c6bc0\" d=\"m2 10 8 4V6L2 2zm10 5 8 4v-8l-8-4zm0 11 8 4v-8l-8-4zm10-14v8l8-4V8z\"/></svg>", Nc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#ffca28\"/><path fill=\"#ffca28\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", Pc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#0288d1\"/><path fill=\"#0288d1\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", Fc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><path fill=\"#2196f3\" d=\"M80 192 64 320h32c16-80 16-96 63.242-96H176c8.837 0 16 7.163 16 16v352c0 8.837 0 16-32 16h-32v32h192v-32h-32c-32 0-32-7.163-32-16V240c0-8.837 7.163-16 16-16h16c48 0 48 16 64 96h32l-16-128zm560 0v32c16 0 45.713 0 52.57 16L776 434.666 708.57 592c-6.857 16-52.57 16-68.57 16v32h128v-32s-34.285 0-27.428-16L792 472l51.428 120c3.103 7.24-1.52 16-11.428 16v32h128v-32c-16 0-45.713 0-52.57-16L824 397.334 891.43 240c6.857-16 52.57-16 68.57-16v-32H832v32s34.285 0 27.428 16L808 360l-51.428-120c-3.103-7.24 1.52-16 11.428-16v-32zM320 384v32h32c32 0 32 7.163 32 16v352c0 8.837 0 16-32 16h-32v32h304l16-128h-32c-16 80-16 96-64 96h-64c-32 0-32-7.163-32-16V624h80c8.837 0 16 0 16 32v16h32V544h-32v16c0 32-7.163 32-16 32h-80V432c0-8.837 0-16 32-16h64c48 0 48 16 64 96h32l-16-128z\"/></svg>", Ic = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7cb342\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m-1.667 22.143L6.92 16.73l3.293-3.293 4.12 4.107 7.455-7.44 3.294 3.293Z\"/></svg>", Lc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#cfd8dc\" d=\"M4 6V4h8v2H9v7H7V6z\"/><path fill=\"#ef5350\" d=\"M4 1v1H2v12h2v1H1V1zm8 0v1h2v12h-2v1h3V1z\"/></svg>", Rc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#757575\" d=\"M15 2H6a2.006 2.006 0 0 0-2 2v22a2.006 2.006 0 0 0 2 2h6v-4H6v-2h6v-2H6v-2h6v-2H6v-2h6v-2h2V4l8 8h2v-1Z\" data-mit-no-recolor=\"true\"/><path fill=\"#0288d1\" d=\"M12 12v18h18V12Zm8 6h-2v8h-2v-8h-2v-2h6Zm8 0h-4v2h2a2.006 2.006 0 0 1 2 2v2a2.006 2.006 0 0 1-2 2h-4v-2h4v-2h-2a2.006 2.006 0 0 1-2-2v-2a2.006 2.006 0 0 1 2-2h4Z\"/></svg>", zc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#fbc02d\" d=\"M12 10h10v2H12z\"/><path fill=\"#fbc02d\" d=\"M16 4h2v8h-2zm4 18h10v2H20zm4 2h2v4h-2zm0-20h2v14h-2zM2 18h10v2H2z\"/><path fill=\"#fbc02d\" d=\"M6 18h2v10H6zM6 4h2v10H6zm10 12h2v12h-2z\"/></svg>", Bc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><g fill=\"#0288d1\"><path d=\"M2 2v12h12V2zm1 1h10v10H3z\"/><path d=\"M5 7v1h1v4h1V8h1V7zm5 0a1.003 1.003 0 0 0-1 1v1a1.003 1.003 0 0 0 1 1h1v1H9v1h2a1.003 1.003 0 0 0 1-1v-1a1.003 1.003 0 0 0-1-1h-1V8h2V7z\"/></g></svg>", Vc = "<svg xmlns=\"http://www.w3.org/2000/svg\" xml:space=\"preserve\" viewBox=\"0 0 16 16\"><path fill=\"#0288d1\" d=\"M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", Hc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff9800\" d=\"m24 6 2 6h-4l-2-6h-3l2 6h-4l-2-6h-3l2 6H8L6 6H5a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3V6Z\"/></svg>", Uc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M22.19 4H16v4h2.19L12 14.19V8h2V4H2v4h2v20h4v-.01l.01.01L28 8V4z\"/></svg>", Wc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ab47bc\" d=\"m22 11.8-5.7 4.584L22 20.8zM7.24 23.68 4 21.64v-10.8l3.6-1.2 5.16 3.996L23.2 4 28 7v18.6L22 28l-9.192-8.808zm.36-5.28 2.232-2.064L7.6 14.2Z\"/></svg>", Gc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#a0f\" d=\"M29.313 12h-6.664a1.427 1.427 0 0 1-1.1-2.24l4.398-6.676A.703.703 0 0 0 25.397 2H8.428a.62.62 0 0 0-.55.289l-5.77 8.627A.703.703 0 0 0 2.658 12h8.175a1.427 1.427 0 0 1 1.099 2.24l-4.48 6.676A.702.702 0 0 0 8 22l6.695.002A1.34 1.34 0 0 1 16 23.375v5.934a.652.652 0 0 0 1.168.433l12.694-16.586a.725.725 0 0 0-.55-1.156\"/></svg>", Kc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#41b883\" d=\"M1.791 3.851 12 21.471 22.209 3.936V3.85H18.24l-6.18 10.616L5.906 3.851z\"/><path fill=\"#35495e\" d=\"m5.907 3.851 6.152 10.617L18.24 3.851h-3.723L12.084 8.03 9.66 3.85z\"/></svg>", qc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M22 18h4v4h-4z\"/><path fill=\"#7c4dff\" d=\"M20 2a4 4 0 0 1-8 0H2v28h28V2Zm-2 24h-2v2h-4v-2h-2v2H6v-2H4V16h2v10h4V16h2v10h4V16h2Zm10 2h-2v-4h-4v4h-2V18h2v-2h4v2h2Z\"/></svg>", Jc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fafafa\" fill-opacity=\".785\" d=\"m19.376 15.988-7.708 4.45-7.709-4.45v-8.9l7.709-4.451 7.708 4.45z\"/><path fill=\"#90caf9\" d=\"M12.286 1.98c-.21 0-.41.059-.57.179l-7.9 4.44c-.32.17-.53.5-.53.88v9c0 .38.21.711.53.881l7.9 4.44c.16.12.36.18.57.18s.41-.06.57-.18l7.9-4.44c.32-.17.53-.5.53-.88v-9c0-.38-.21-.712-.53-.882l-7.9-4.44a.95.95 0 0 0-.57-.179zm0 2.15 7 3.94v2.103h-.016v5.177h.016v.54l-7 3.939-7-3.94V8.07zm0 2.08-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/><path fill=\"#0277bd\" d=\"m12.286 6.21-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/></svg>", Yc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#01579b\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM7 13l1.5 7h2l1.5-3 1.5 3h2l1.5-7h1v-2h-4v2h1l-.9 4.2L13 15h-2l-1.1 2.2L9 13h1v-2H6v2z\"/></svg>", Xc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m.12 13.5 3.74 3.74 1.42-1.41-2.33-2.33 2.33-2.33-1.42-1.41zm11.16 0-3.74-3.74-1.42 1.41 2.33 2.33-2.33 2.33 1.42 1.41z\"/></svg>", Zc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff5252\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2m12 16v-2H9v2zm-4-4v-2H6v2z\"/></svg>", Qc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M27.575 23.967a9.9 9.9 0 0 0-3.751 1.726 22.6 22.6 0 0 1-5.537 2.504 1.55 1.55 0 0 1-.931.52 59 59 0 0 1-6.11.548c-1.102.008-1.777-.282-1.965-.735a1.49 1.49 0 0 1 .82-1.965 3.6 3.6 0 0 1-.486-.359c-.163-.162-.334-.487-.385-.367-.213.52-.324 1.794-.897 2.366-.786.795-2.273.53-3.153.069-.965-.513.069-1.718.069-1.718a.69.69 0 0 1-.94-.324 4.6 4.6 0 0 1-.632-2.794 5.2 5.2 0 0 1 1.674-2.76 8.84 8.84 0 0 1 .624-4.17 9.9 9.9 0 0 1 3-3.469S7.136 11.015 7.82 9.177c.444-1.196.623-1.187.769-1.239a3.44 3.44 0 0 0 1.375-.811 4.99 4.99 0 0 1 4.178-1.607s1.094-3.357 2.12-2.7a17.4 17.4 0 0 1 1.452 2.735s1.213-.71 1.35-.445a10.74 10.74 0 0 1 .495 5.81 13.3 13.3 0 0 1-2.46 5.127c-.129.214 1.47.889 2.477 3.683.932 2.554.103 4.699.248 4.938.026.043.034.06.034.06s1.068.085 3.213-1.24a8.05 8.05 0 0 1 4.05-1.52 1.026 1.026 0 0 1 .453 2Z\"/></svg>", $c = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f9a825\" d=\"M2 8h6v4H2zm8 0h12v4H10zm0 12h12v4H10zm14 0h2v4h-2zM8 20l-3 4H2V12h4v8zm14-8h-6l-6 8h6z\"/><path fill=\"#f9a825\" d=\"M16 20h-6l-6 8m12-16h6l6-8m2 4v16h-4V12h-2l3-4z\"/></svg>", el = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#afb42b\" d=\"M14 17h-2v-2h-2v-2h2v2h2m0-6h-2v2h2v2h-2v-2h-2V9h2V7h-2V5h2v2h2m5-4H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2\"/></svg>", tl = "file", nl = {
	".buildignore": "settings",
	".clang-format": "settings",
	".clang-format-ignore": "settings",
	".clang-tidy": "settings",
	".conf": "settings",
	".config/eslintrc": "eslint",
	".config/eslintrc.cjs": "eslint",
	".config/eslintrc.cts": "eslint",
	".config/eslintrc.js": "eslint",
	".config/eslintrc.json": "eslint",
	".config/eslintrc.json5": "eslint",
	".config/eslintrc.jsonc": "eslint",
	".config/eslintrc.mjs": "eslint",
	".config/eslintrc.mts": "eslint",
	".config/eslintrc.toml": "eslint",
	".config/eslintrc.ts": "eslint",
	".config/eslintrc.yaml": "eslint",
	".config/eslintrc.yml": "eslint",
	".config/graphqlrc": "graphql",
	".config/graphqlrc.cjs": "graphql",
	".config/graphqlrc.cts": "graphql",
	".config/graphqlrc.js": "graphql",
	".config/graphqlrc.json": "graphql",
	".config/graphqlrc.json5": "graphql",
	".config/graphqlrc.jsonc": "graphql",
	".config/graphqlrc.mjs": "graphql",
	".config/graphqlrc.mts": "graphql",
	".config/graphqlrc.toml": "graphql",
	".config/graphqlrc.ts": "graphql",
	".config/graphqlrc.yaml": "graphql",
	".config/graphqlrc.yml": "graphql",
	".config/prettierrc": "prettier",
	".config/prettierrc.cjs": "prettier",
	".config/prettierrc.cts": "prettier",
	".config/prettierrc.js": "prettier",
	".config/prettierrc.json": "prettier",
	".config/prettierrc.json5": "prettier",
	".config/prettierrc.jsonc": "prettier",
	".config/prettierrc.mjs": "prettier",
	".config/prettierrc.mts": "prettier",
	".config/prettierrc.toml": "prettier",
	".config/prettierrc.ts": "prettier",
	".config/prettierrc.yaml": "prettier",
	".config/prettierrc.yml": "prettier",
	".dev.vars": "tune",
	".ecrc": "editorconfig",
	".editorconfig": "editorconfig",
	".editorconfig-checker.json": "editorconfig",
	".env.alpha": "tune",
	".env.defaults": "tune",
	".env.dev": "tune",
	".env.dev.local": "tune",
	".env.development": "tune",
	".env.development.local": "tune",
	".env.dist": "tune",
	".env.e2e": "tune",
	".env.example": "tune",
	".env.local": "tune",
	".env.preview": "tune",
	".env.prod": "tune",
	".env.prod.example": "tune",
	".env.prod.local": "tune",
	".env.production": "tune",
	".env.production.example": "tune",
	".env.production.local": "tune",
	".env.qa": "tune",
	".env.qa.local": "tune",
	".env.sample": "tune",
	".env.schema": "tune",
	".env.stage": "tune",
	".env.staging": "tune",
	".env.staging.local": "tune",
	".env.stg": "tune",
	".env.stg.local": "tune",
	".env.template": "tune",
	".env.test": "tune",
	".env.test.local": "tune",
	".env.testing": "tune",
	".env.uat": "tune",
	".envrc": "console",
	".esformatter": "json",
	".eslintcache": "eslint",
	".eslintignore": "eslint",
	".eslintrc": "eslint",
	".eslintrc-jsdoc.js": "eslint",
	".eslintrc-md.js": "eslint",
	".eslintrc.base.json": "eslint",
	".eslintrc.cjs": "eslint",
	".eslintrc.cts": "eslint",
	".eslintrc.js": "eslint",
	".eslintrc.json": "eslint",
	".eslintrc.json5": "eslint",
	".eslintrc.jsonc": "eslint",
	".eslintrc.mjs": "eslint",
	".eslintrc.mts": "eslint",
	".eslintrc.toml": "eslint",
	".eslintrc.ts": "eslint",
	".eslintrc.yaml": "eslint",
	".eslintrc.yml": "eslint",
	".esmrc": "nodejs",
	".git": "git",
	".git-blame-ignore": "git",
	".git-blame-ignore-revs": "git",
	".git-for-windows-updater": "git",
	".gitattributes": "git",
	".gitattributes-global": "git",
	".gitattributes_global": "git",
	".gitconfig": "git",
	".gitignore": "git",
	".gitignore-global": "git",
	".gitignore_global": "git",
	".gitinclude": "git",
	".gitkeep": "git",
	".gitmessage": "git",
	".gitmodules": "git",
	".gitpreserve": "git",
	".graphqlconfig": "graphql",
	".graphqlrc": "graphql",
	".graphqlrc.cjs": "graphql",
	".graphqlrc.cts": "graphql",
	".graphqlrc.js": "graphql",
	".graphqlrc.json": "graphql",
	".graphqlrc.json5": "graphql",
	".graphqlrc.jsonc": "graphql",
	".graphqlrc.mjs": "graphql",
	".graphqlrc.mts": "graphql",
	".graphqlrc.toml": "graphql",
	".graphqlrc.ts": "graphql",
	".graphqlrc.yaml": "graphql",
	".graphqlrc.yml": "graphql",
	".htaccess": "xml",
	".htpasswd": "key",
	".hushlogin": "console",
	".jsbeautifyrc": "json",
	".jscsrc": "json",
	".jshintignore": "settings",
	".jshintrc": "json",
	".k8s.yaml": "kubernetes",
	".k8s.yml": "kubernetes",
	".keep": "git",
	".luacheckrc": "lua",
	".mrconfig": "settings",
	".node-version": "nodejs",
	".npmignore": "npm",
	".npmrc": "npm",
	".nvmrc": "nodejs",
	".pnpmfile.cjs": "pnpm",
	".prettierignore": "prettier",
	".prettierrc": "prettier",
	".prettierrc.cjs": "prettier",
	".prettierrc.cts": "prettier",
	".prettierrc.js": "prettier",
	".prettierrc.json": "prettier",
	".prettierrc.json5": "prettier",
	".prettierrc.jsonc": "prettier",
	".prettierrc.mjs": "prettier",
	".prettierrc.mts": "prettier",
	".prettierrc.toml": "prettier",
	".prettierrc.ts": "prettier",
	".prettierrc.yaml": "prettier",
	".prettierrc.yml": "prettier",
	".pubignore": "dart",
	".pug-lintrc": "pug",
	".pug-lintrc.js": "pug",
	".pug-lintrc.json": "pug",
	".rhistory": "r",
	".ruby-version": "ruby",
	".secrets": "key",
	".swift-format": "swift",
	".swift-version": "swift",
	".swiftformat": "swift",
	".vars": "tune",
	".vsconfig": "visualstudio",
	".whitesource": "json",
	".yardopts": "settings",
	".yarn-integrity": "yarn",
	".yarnclean": "yarn",
	".yarnrc": "yarn",
	".yarnrc.yaml": "yarn",
	".yarnrc.yml": "yarn",
	apkbuild: "console",
	appraisals: "ruby",
	bashrc_apple_terminal: "console",
	berksfile: "ruby",
	"berksfile.lock": "ruby",
	brewfile: "ruby",
	"cabal.project": "cabal",
	"cabal.project.freeze": "cabal",
	"cabal.project.local": "cabal",
	capfile: "ruby",
	"cdp.pid": "json",
	cheffile: "ruby",
	"cmakecache.txt": "cmake",
	"cmakelists.txt": "cmake",
	"cmakepresets.json": "cmake",
	"commit-msg": "console",
	commit_editmsg: "git",
	"compile_flags.txt": "settings",
	"compose.alpha.yaml": "docker",
	"compose.alpha.yml": "docker",
	"compose.beta.yaml": "docker",
	"compose.beta.yml": "docker",
	"compose.ci.yaml": "docker",
	"compose.ci.yml": "docker",
	"compose.dev.yaml": "docker",
	"compose.dev.yml": "docker",
	"compose.development.yaml": "docker",
	"compose.development.yml": "docker",
	"compose.local.yaml": "docker",
	"compose.local.yml": "docker",
	"compose.override.yaml": "docker",
	"compose.override.yml": "docker",
	"compose.prod.yaml": "docker",
	"compose.prod.yml": "docker",
	"compose.production.yaml": "docker",
	"compose.production.yml": "docker",
	"compose.stage.yaml": "docker",
	"compose.stage.yml": "docker",
	"compose.staging.yaml": "docker",
	"compose.staging.yml": "docker",
	"compose.test.yaml": "docker",
	"compose.test.yml": "docker",
	"compose.testing.yaml": "docker",
	"compose.testing.yml": "docker",
	"compose.web.yaml": "docker",
	"compose.web.yml": "docker",
	"compose.worker.yaml": "docker",
	"compose.worker.yml": "docker",
	"compose.yaml": "docker",
	"compose.yml": "docker",
	"composer.lock": "json",
	containerfile: "docker",
	"containerfile.alpha": "docker",
	"containerfile.beta": "docker",
	"containerfile.ci": "docker",
	"containerfile.dev": "docker",
	"containerfile.development": "docker",
	"containerfile.local": "docker",
	"containerfile.prod": "docker",
	"containerfile.production": "docker",
	"containerfile.stage": "docker",
	"containerfile.staging": "docker",
	"containerfile.test": "docker",
	"containerfile.testing": "docker",
	"containerfile.web": "docker",
	"containerfile.worker": "docker",
	copying: "license",
	"copying.md": "license",
	"copying.rst": "license",
	"copying.txt": "license",
	copyright: "license",
	"copyright.md": "license",
	"copyright.rst": "license",
	"copyright.txt": "license",
	dangerfile: "ruby",
	deliverfile: "ruby",
	"docker-compose.alpha.yaml": "docker",
	"docker-compose.alpha.yml": "docker",
	"docker-compose.beta.yaml": "docker",
	"docker-compose.beta.yml": "docker",
	"docker-compose.ci.yaml": "docker",
	"docker-compose.ci.yml": "docker",
	"docker-compose.dev.yaml": "docker",
	"docker-compose.dev.yml": "docker",
	"docker-compose.development.yaml": "docker",
	"docker-compose.development.yml": "docker",
	"docker-compose.local.yaml": "docker",
	"docker-compose.local.yml": "docker",
	"docker-compose.override.yaml": "docker",
	"docker-compose.override.yml": "docker",
	"docker-compose.prod.yaml": "docker",
	"docker-compose.prod.yml": "docker",
	"docker-compose.production.yaml": "docker",
	"docker-compose.production.yml": "docker",
	"docker-compose.stage.yaml": "docker",
	"docker-compose.stage.yml": "docker",
	"docker-compose.staging.yaml": "docker",
	"docker-compose.staging.yml": "docker",
	"docker-compose.test.yaml": "docker",
	"docker-compose.test.yml": "docker",
	"docker-compose.testing.yaml": "docker",
	"docker-compose.testing.yml": "docker",
	"docker-compose.web.yaml": "docker",
	"docker-compose.web.yml": "docker",
	"docker-compose.worker.yaml": "docker",
	"docker-compose.worker.yml": "docker",
	"docker-compose.yaml": "docker",
	"docker-compose.yml": "docker",
	dockerfile: "docker",
	"dockerfile.alpha": "docker",
	"dockerfile.beta": "docker",
	"dockerfile.ci": "docker",
	"dockerfile.dev": "docker",
	"dockerfile.development": "docker",
	"dockerfile.local": "docker",
	"dockerfile.prod": "docker",
	"dockerfile.production": "docker",
	"dockerfile.stage": "docker",
	"dockerfile.staging": "docker",
	"dockerfile.test": "docker",
	"dockerfile.testing": "docker",
	"dockerfile.web": "docker",
	"dockerfile.windows": "docker",
	"dockerfile.worker": "docker",
	"eslint-options.js": "eslint",
	"eslint.config.cjs": "eslint",
	"eslint.config.cts": "eslint",
	"eslint.config.js": "eslint",
	"eslint.config.json": "eslint",
	"eslint.config.json5": "eslint",
	"eslint.config.jsonc": "eslint",
	"eslint.config.mjs": "eslint",
	"eslint.config.mts": "eslint",
	"eslint.config.toml": "eslint",
	"eslint.config.ts": "eslint",
	"eslint.config.yaml": "eslint",
	"eslint.config.yml": "eslint",
	"git-history": "git",
	"git-rebase-todo": "git",
	gnumakefile: "makefile",
	"go.mod": "go-mod",
	"go.sum": "go-mod",
	"go.work": "go-mod",
	"go.work.sum": "go-mod",
	"gradle-wrapper.properties": "gradle",
	"gradle.properties": "gradle",
	gradlew: "gradle",
	"gradlew.bat": "gradle",
	"graphql.config.cjs": "graphql",
	"graphql.config.cts": "graphql",
	"graphql.config.js": "graphql",
	"graphql.config.json": "graphql",
	"graphql.config.json5": "graphql",
	"graphql.config.jsonc": "graphql",
	"graphql.config.mjs": "graphql",
	"graphql.config.mts": "graphql",
	"graphql.config.toml": "graphql",
	"graphql.config.ts": "graphql",
	"graphql.config.yaml": "graphql",
	"graphql.config.yml": "graphql",
	guardfile: "ruby",
	gymfile: "ruby",
	hobofile: "ruby",
	jakefile: "javascript",
	"jvm.config": "maven",
	"k8s.yaml": "kubernetes",
	"k8s.yml": "kubernetes",
	kbuild: "makefile",
	"kubernetes.yaml": "kubernetes",
	"kubernetes.yml": "kubernetes",
	licence: "license",
	"licence-agpl": "license",
	"licence-apache": "license",
	"licence-bsd": "license",
	"licence-gpl": "license",
	"licence-lgpl": "license",
	"licence-mit": "license",
	"licence.md": "license",
	"licence.rst": "license",
	"licence.txt": "license",
	license: "license",
	"license-agpl": "license",
	"license-apache": "license",
	"license-bsd": "license",
	"license-gpl": "license",
	"license-lgpl": "license",
	"license-mit": "license",
	"license.md": "license",
	"license.rst": "license",
	"license.txt": "license",
	makefile: "makefile",
	"manifest.mf": "settings",
	matchfile: "ruby",
	"maven.config": "maven",
	merge_msg: "git",
	"nginx.conf": "nginx",
	"package-lock.json": "nodejs",
	"package.json": "nodejs",
	pkgbuild: "console",
	"pnpm-lock.yaml": "pnpm",
	"pnpm-workspace.yaml": "pnpm",
	podfile: "ruby",
	"pom.xml": "maven",
	"post-merge": "console",
	"pre-commit": "console",
	"pre-push": "console",
	"prettier.config.cjs": "prettier",
	"prettier.config.cts": "prettier",
	"prettier.config.js": "prettier",
	"prettier.config.json": "prettier",
	"prettier.config.json5": "prettier",
	"prettier.config.jsonc": "prettier",
	"prettier.config.mjs": "prettier",
	"prettier.config.mts": "prettier",
	"prettier.config.toml": "prettier",
	"prettier.config.ts": "prettier",
	"prettier.config.yaml": "prettier",
	"prettier.config.yml": "prettier",
	"prisma.config.ts": "prisma",
	"prisma.yml": "prisma",
	puppetfile: "ruby",
	rakefile: "ruby",
	rantfile: "ruby",
	readme: "readme",
	"readme.md": "readme",
	"readme.rst": "readme",
	"readme.txt": "readme",
	scanfile: "ruby",
	security: "lock",
	"security.md": "lock",
	"security.txt": "lock",
	sha256sums: "key",
	snapfile: "ruby",
	"svelte.config.cjs": "svelte",
	"svelte.config.cts": "svelte",
	"svelte.config.js": "svelte",
	"svelte.config.mjs": "svelte",
	"svelte.config.mts": "svelte",
	"svelte.config.ts": "svelte",
	thorfile: "ruby",
	"todo.md": "todo",
	"todos.md": "todo",
	"tsconfig.app.json": "tsconfig",
	"tsconfig.base.json": "tsconfig",
	"tsconfig.build.json": "tsconfig",
	"tsconfig.cjs.json": "tsconfig",
	"tsconfig.client.json": "tsconfig",
	"tsconfig.config.json": "tsconfig",
	"tsconfig.declaration.json": "tsconfig",
	"tsconfig.doc.json": "tsconfig",
	"tsconfig.e2e.json": "tsconfig",
	"tsconfig.editor.json": "tsconfig",
	"tsconfig.eslint.json": "tsconfig",
	"tsconfig.esm.json": "tsconfig",
	"tsconfig.json": "tsconfig",
	"tsconfig.lib.json": "tsconfig",
	"tsconfig.lib.prod.json": "tsconfig",
	"tsconfig.main.json": "tsconfig",
	"tsconfig.mjs.json": "tsconfig",
	"tsconfig.node.json": "tsconfig",
	"tsconfig.paths.json": "tsconfig",
	"tsconfig.renderer.json": "tsconfig",
	"tsconfig.server.json": "tsconfig",
	"tsconfig.spec.json": "tsconfig",
	"tsconfig.test.json": "tsconfig",
	"tsconfig.vitest.json": "tsconfig",
	"tsconfig.web.json": "tsconfig",
	"tsconfig.webworker.json": "tsconfig",
	"tsconfig.worker.json": "tsconfig",
	"vite.config.cjs": "vite",
	"vite.config.cts": "vite",
	"vite.config.js": "vite",
	"vite.config.mjs": "vite",
	"vite.config.mts": "vite",
	"vite.config.ts": "vite",
	"webpack.base.cjs": "webpack",
	"webpack.base.cts": "webpack",
	"webpack.base.js": "webpack",
	"webpack.base.mjs": "webpack",
	"webpack.base.mts": "webpack",
	"webpack.base.ts": "webpack",
	"webpack.cjs": "webpack",
	"webpack.client.cjs": "webpack",
	"webpack.client.cts": "webpack",
	"webpack.client.js": "webpack",
	"webpack.client.mjs": "webpack",
	"webpack.client.mts": "webpack",
	"webpack.client.ts": "webpack",
	"webpack.common.cjs": "webpack",
	"webpack.common.cts": "webpack",
	"webpack.common.js": "webpack",
	"webpack.common.mjs": "webpack",
	"webpack.common.mts": "webpack",
	"webpack.common.ts": "webpack",
	"webpack.config.babel.cjs": "webpack",
	"webpack.config.babel.cts": "webpack",
	"webpack.config.babel.js": "webpack",
	"webpack.config.babel.mjs": "webpack",
	"webpack.config.babel.mts": "webpack",
	"webpack.config.babel.ts": "webpack",
	"webpack.config.base.babel.cjs": "webpack",
	"webpack.config.base.babel.cts": "webpack",
	"webpack.config.base.babel.js": "webpack",
	"webpack.config.base.babel.mjs": "webpack",
	"webpack.config.base.babel.mts": "webpack",
	"webpack.config.base.babel.ts": "webpack",
	"webpack.config.base.cjs": "webpack",
	"webpack.config.base.cts": "webpack",
	"webpack.config.base.js": "webpack",
	"webpack.config.base.mjs": "webpack",
	"webpack.config.base.mts": "webpack",
	"webpack.config.base.ts": "webpack",
	"webpack.config.cjs": "webpack",
	"webpack.config.client.cjs": "webpack",
	"webpack.config.client.cts": "webpack",
	"webpack.config.client.js": "webpack",
	"webpack.config.client.mjs": "webpack",
	"webpack.config.client.mts": "webpack",
	"webpack.config.client.ts": "webpack",
	"webpack.config.coffee": "webpack",
	"webpack.config.common.babel.cjs": "webpack",
	"webpack.config.common.babel.cts": "webpack",
	"webpack.config.common.babel.js": "webpack",
	"webpack.config.common.babel.mjs": "webpack",
	"webpack.config.common.babel.mts": "webpack",
	"webpack.config.common.babel.ts": "webpack",
	"webpack.config.common.cjs": "webpack",
	"webpack.config.common.cts": "webpack",
	"webpack.config.common.js": "webpack",
	"webpack.config.common.mjs": "webpack",
	"webpack.config.common.mts": "webpack",
	"webpack.config.common.ts": "webpack",
	"webpack.config.cts": "webpack",
	"webpack.config.dev.babel.cjs": "webpack",
	"webpack.config.dev.babel.cts": "webpack",
	"webpack.config.dev.babel.js": "webpack",
	"webpack.config.dev.babel.mjs": "webpack",
	"webpack.config.dev.babel.mts": "webpack",
	"webpack.config.dev.babel.ts": "webpack",
	"webpack.config.dev.cjs": "webpack",
	"webpack.config.dev.cts": "webpack",
	"webpack.config.dev.js": "webpack",
	"webpack.config.dev.mjs": "webpack",
	"webpack.config.dev.mts": "webpack",
	"webpack.config.dev.ts": "webpack",
	"webpack.config.js": "webpack",
	"webpack.config.main.cjs": "webpack",
	"webpack.config.main.cts": "webpack",
	"webpack.config.main.js": "webpack",
	"webpack.config.main.mjs": "webpack",
	"webpack.config.main.mts": "webpack",
	"webpack.config.main.ts": "webpack",
	"webpack.config.mjs": "webpack",
	"webpack.config.mts": "webpack",
	"webpack.config.prod.babel.cjs": "webpack",
	"webpack.config.prod.babel.cts": "webpack",
	"webpack.config.prod.babel.js": "webpack",
	"webpack.config.prod.babel.mjs": "webpack",
	"webpack.config.prod.babel.mts": "webpack",
	"webpack.config.prod.babel.ts": "webpack",
	"webpack.config.prod.cjs": "webpack",
	"webpack.config.prod.cts": "webpack",
	"webpack.config.prod.js": "webpack",
	"webpack.config.prod.mjs": "webpack",
	"webpack.config.prod.mts": "webpack",
	"webpack.config.prod.ts": "webpack",
	"webpack.config.production.babel.cjs": "webpack",
	"webpack.config.production.babel.cts": "webpack",
	"webpack.config.production.babel.js": "webpack",
	"webpack.config.production.babel.mjs": "webpack",
	"webpack.config.production.babel.mts": "webpack",
	"webpack.config.production.babel.ts": "webpack",
	"webpack.config.production.cjs": "webpack",
	"webpack.config.production.cts": "webpack",
	"webpack.config.production.js": "webpack",
	"webpack.config.production.mjs": "webpack",
	"webpack.config.production.mts": "webpack",
	"webpack.config.production.ts": "webpack",
	"webpack.config.renderer.cjs": "webpack",
	"webpack.config.renderer.cts": "webpack",
	"webpack.config.renderer.js": "webpack",
	"webpack.config.renderer.mjs": "webpack",
	"webpack.config.renderer.mts": "webpack",
	"webpack.config.renderer.ts": "webpack",
	"webpack.config.server.cjs": "webpack",
	"webpack.config.server.cts": "webpack",
	"webpack.config.server.js": "webpack",
	"webpack.config.server.mjs": "webpack",
	"webpack.config.server.mts": "webpack",
	"webpack.config.server.ts": "webpack",
	"webpack.config.staging.babel.cjs": "webpack",
	"webpack.config.staging.babel.cts": "webpack",
	"webpack.config.staging.babel.js": "webpack",
	"webpack.config.staging.babel.mjs": "webpack",
	"webpack.config.staging.babel.mts": "webpack",
	"webpack.config.staging.babel.ts": "webpack",
	"webpack.config.staging.cjs": "webpack",
	"webpack.config.staging.cts": "webpack",
	"webpack.config.staging.js": "webpack",
	"webpack.config.staging.mjs": "webpack",
	"webpack.config.staging.mts": "webpack",
	"webpack.config.staging.ts": "webpack",
	"webpack.config.test.cjs": "webpack",
	"webpack.config.test.cts": "webpack",
	"webpack.config.test.js": "webpack",
	"webpack.config.test.mjs": "webpack",
	"webpack.config.test.mts": "webpack",
	"webpack.config.test.ts": "webpack",
	"webpack.config.ts": "webpack",
	"webpack.config.vendor.cjs": "webpack",
	"webpack.config.vendor.cts": "webpack",
	"webpack.config.vendor.js": "webpack",
	"webpack.config.vendor.mjs": "webpack",
	"webpack.config.vendor.mts": "webpack",
	"webpack.config.vendor.production.cjs": "webpack",
	"webpack.config.vendor.production.cts": "webpack",
	"webpack.config.vendor.production.js": "webpack",
	"webpack.config.vendor.production.mjs": "webpack",
	"webpack.config.vendor.production.mts": "webpack",
	"webpack.config.vendor.production.ts": "webpack",
	"webpack.config.vendor.ts": "webpack",
	"webpack.cts": "webpack",
	"webpack.dev.cjs": "webpack",
	"webpack.dev.cts": "webpack",
	"webpack.dev.js": "webpack",
	"webpack.dev.mjs": "webpack",
	"webpack.dev.mts": "webpack",
	"webpack.dev.ts": "webpack",
	"webpack.development.cjs": "webpack",
	"webpack.development.cts": "webpack",
	"webpack.development.js": "webpack",
	"webpack.development.mjs": "webpack",
	"webpack.development.mts": "webpack",
	"webpack.development.ts": "webpack",
	"webpack.dist.cjs": "webpack",
	"webpack.dist.cts": "webpack",
	"webpack.dist.js": "webpack",
	"webpack.dist.mjs": "webpack",
	"webpack.dist.mts": "webpack",
	"webpack.dist.ts": "webpack",
	"webpack.js": "webpack",
	"webpack.mix.cjs": "webpack",
	"webpack.mix.cts": "webpack",
	"webpack.mix.js": "webpack",
	"webpack.mix.mjs": "webpack",
	"webpack.mix.mts": "webpack",
	"webpack.mix.ts": "webpack",
	"webpack.mjs": "webpack",
	"webpack.mts": "webpack",
	"webpack.prod.cjs": "webpack",
	"webpack.prod.config.cjs": "webpack",
	"webpack.prod.config.cts": "webpack",
	"webpack.prod.config.js": "webpack",
	"webpack.prod.config.mjs": "webpack",
	"webpack.prod.config.mts": "webpack",
	"webpack.prod.config.ts": "webpack",
	"webpack.prod.cts": "webpack",
	"webpack.prod.js": "webpack",
	"webpack.prod.mjs": "webpack",
	"webpack.prod.mts": "webpack",
	"webpack.prod.ts": "webpack",
	"webpack.production.cjs": "webpack",
	"webpack.production.cts": "webpack",
	"webpack.production.js": "webpack",
	"webpack.production.mjs": "webpack",
	"webpack.production.mts": "webpack",
	"webpack.production.ts": "webpack",
	"webpack.server.cjs": "webpack",
	"webpack.server.cts": "webpack",
	"webpack.server.js": "webpack",
	"webpack.server.mjs": "webpack",
	"webpack.server.mts": "webpack",
	"webpack.server.ts": "webpack",
	"webpack.test.cjs": "webpack",
	"webpack.test.cts": "webpack",
	"webpack.test.js": "webpack",
	"webpack.test.mjs": "webpack",
	"webpack.test.mts": "webpack",
	"webpack.test.ts": "webpack",
	"webpack.ts": "webpack",
	"webpackfile.cjs": "webpack",
	"webpackfile.cts": "webpack",
	"webpackfile.js": "webpack",
	"webpackfile.mjs": "webpack",
	"webpackfile.mts": "webpack",
	"webpackfile.ts": "webpack",
	"yarn-error.log": "yarn",
	"yarn.lock": "yarn",
	zlogin: "console",
	zlogout: "console",
	zprofile: "console",
	zshenv: "console",
	zshrc: "console",
	zshrc_apple_terminal: "console"
}, rl = {
	"001": "zip",
	"3fr": "image",
	"7z": "zip",
	"8svx": "audio",
	a51: "assembly",
	aa: "audio",
	aac: "audio",
	aax: "audio",
	ac3: "audio",
	accdb: "database",
	accde: "database",
	ad: "asciidoc",
	adoc: "asciidoc",
	adp: "database",
	aea: "assembly",
	afphoto: "image",
	agc: "assembly",
	ags: "assembly",
	aif: "audio",
	aiff: "audio",
	alac: "audio",
	ami: "image",
	amr: "audio",
	ape: "audio",
	apfs: "zip",
	apx: "image",
	argus: "assembly",
	ari: "image",
	arj: "zip",
	arw: "image",
	asc: "key",
	asciidoc: "asciidoc",
	ascx: "xml",
	ase: "image",
	aseprite: "image",
	asm: "assembly",
	asp: "html",
	aspx: "html",
	astro: "astro",
	atom: "xml",
	aux: "tex",
	avi: "video",
	avif: "image",
	awk: "console",
	axaml: "xml",
	axml: "xml",
	bak: "database",
	bas: "visualstudio",
	bash: "console",
	bash_aliases: "console",
	bash_login: "console",
	bash_logout: "console",
	bash_profile: "console",
	bashrc: "console",
	bat: "console",
	bay: "image",
	bdb: "database",
	bicep: "bicep",
	bin: "hex",
	binsource: "assembly",
	bmap: "font",
	bmp: "image",
	bpg: "image",
	bpmn: "xml",
	br: "zip",
	braw: "image",
	brk: "image",
	brotli: "zip",
	brs: "visualstudio",
	bz2: "zip",
	bzip2: "zip",
	c: "c",
	"c++": "cpp",
	"c++m": "cpp",
	cab: "zip",
	cabal: "cabal",
	caf: "audio",
	cap: "image",
	cc: "cpp",
	ccm: "cpp",
	cda: "audio",
	cdr: "audio",
	cer: "certificate",
	cert: "certificate",
	cff: "yaml",
	cfg: "settings",
	cjs: "javascript",
	class: "javaclass",
	clip: "image",
	clj: "clojure",
	cljc: "clojure",
	cljs: "clojure",
	cljx: "clojure",
	clo: "tex",
	clojure: "clojure",
	cls: "tex",
	cmake: "cmake",
	cmd: "console",
	cmx: "ocaml",
	cnf: "settings",
	"compose.yaml": "docker",
	"compose.yml": "docker",
	conf: "settings",
	config: "settings",
	containerfile: "docker",
	containerignore: "docker",
	copilotmd: "markdown",
	cp: "cpp",
	cpio: "zip",
	cpp: "cpp",
	cppm: "cpp",
	cpt: "image",
	cpy: "python",
	cr: "crystal",
	cr2: "image",
	cr3: "image",
	crt: "certificate",
	crw: "image",
	cs: "csharp",
	csh: "console",
	csharp: "csharp",
	cshrc: "console",
	csl: "xml",
	csproj: "visualstudio",
	"csproj.user": "xml",
	css: "css",
	csv: "table",
	csx: "csharp",
	ctp: "php",
	cts: "typescript",
	cur: "image",
	cxx: "cpp",
	cxxm: "cpp",
	"cy.js": "test-js",
	"cy.ts": "test-ts",
	"d.cts": "typescript-def",
	"d.ets": "typescript-def",
	"d.mts": "typescript-def",
	"d.ts": "typescript-def",
	dart: "dart",
	dat: "hex",
	data: "image",
	db: "database",
	db3: "database",
	dbf: "database",
	dblite: "database",
	dblite3: "database",
	dcr: "image",
	dcs: "image",
	dds: "image",
	deb: "zip",
	debugsymbols: "database",
	diff: "diff",
	directory: "settings",
	dita: "xml",
	ditamap: "xml",
	dlc: "settings",
	dll: "dll",
	dmn: "xml",
	dng: "image",
	doc: "word",
	"docker-compose.yaml": "docker",
	"docker-compose.yml": "docker",
	dockerfile: "docker",
	dockerignore: "docker",
	docx: "word",
	drf: "image",
	dsql: "database",
	dss: "audio",
	dtd: "xml",
	dtml: "xml",
	"e2e-spec.cjs": "test-js",
	"e2e-spec.cts": "test-ts",
	"e2e-spec.js": "test-js",
	"e2e-spec.mjs": "test-js",
	"e2e-spec.mts": "test-ts",
	"e2e-spec.ts": "test-ts",
	ebuild: "console",
	ec3: "audio",
	eclass: "console",
	ecr: "crystal",
	edn: "clojure",
	eex: "elixir",
	efs: "audio",
	eip: "image",
	elm: "elm",
	enc: "audio",
	ent: "xml",
	env: "tune",
	eot: "font",
	eps: "image",
	erb: "ruby",
	erf: "image",
	erl: "erlang",
	es6: "javascript",
	esd: "zip",
	esx: "javascript",
	ex: "elixir",
	exe: "exe",
	exp: "console",
	exr: "image",
	exrc: "vim",
	exs: "elixir",
	eyaml: "yaml",
	eyml: "yaml",
	far: "zip",
	fat: "zip",
	fdb: "database",
	feather: "database",
	fff: "image",
	fish: "console",
	flac: "audio",
	flp: "audio",
	flv: "video",
	fnt: "font",
	font: "font",
	fonts: "font",
	fpx: "image",
	frm: "database",
	fs: "fsharp",
	fsi: "fsharp",
	fsproj: "fsharp",
	fsscript: "fsharp",
	fsx: "fsharp",
	fxml: "xml",
	gbr: "image",
	gdb: "database",
	gemspec: "ruby",
	geojson: "json",
	gif: "image",
	gifv: "video",
	"gitlab-ci.yml": "gitlab",
	go: "go",
	gp: "audio",
	gpg: "key",
	gpr: "image",
	gql: "graphql",
	gradle: "gradle",
	graphql: "graphql",
	groovy: "groovy",
	gsm: "audio",
	gvimrc: "vim",
	gvy: "groovy",
	gyp: "python",
	gypi: "python",
	gz: "zip",
	gzip: "zip",
	h: "h",
	"h++": "hpp",
	"h.in": "cpp",
	handlebars: "handlebars",
	har: "json",
	hbs: "handlebars",
	hcl: "hcl",
	heex: "elixir",
	heic: "image",
	heif: "image",
	hex: "hex",
	hfs: "zip",
	hh: "hpp",
	hjs: "handlebars",
	hp: "hpp",
	hpp: "hpp",
	"hpp.in": "cpp",
	hs: "haskell",
	htm: "html",
	html: "html",
	html_vm: "html",
	hxx: "hpp",
	i: "c",
	ibd: "database",
	icns: "image",
	ico: "image",
	ii: "cpp",
	iiq: "image",
	ilk: "dll",
	img: "image",
	iml: "xml",
	inc: "assembly",
	ini: "settings",
	inl: "hpp",
	ipp: "cpp",
	ipy: "python",
	ipynb: "jupyter",
	isml: "xml",
	it: "audio",
	ixx: "cpp",
	jade: "pug",
	jar: "jar",
	jav: "java",
	java: "java",
	jb2: "image",
	jbig2: "image",
	jfif: "image",
	jl: "julia",
	jmx: "xml",
	jng: "image",
	jpeg: "image",
	jpg: "image",
	jrxml: "xml",
	js: "javascript",
	"js.snap": "test-js",
	jshtm: "html",
	json: "json",
	json5: "json",
	jsonc: "json",
	jsonl: "json",
	jsonld: "json",
	jsp: "java",
	jsx: "react",
	jxl: "image",
	jxr: "image",
	k25: "image",
	kdbx: "database",
	kdc: "image",
	key: "key",
	kra: "image",
	ksh: "console",
	kt: "kotlin",
	kts: "kotlin",
	ktx: "image",
	ktx2: "image",
	latex: "tex",
	launch: "xml",
	ldf: "database",
	leex: "elixir",
	less: "less",
	lha: "zip",
	lhs: "haskell",
	litcoffee: "markdown",
	liz: "zip",
	lock: "lock",
	log: "log",
	ltx: "tex",
	lua: "lua",
	lz: "zip",
	lz4: "zip",
	lz5: "zip",
	lzh: "zip",
	lzma: "zip",
	lzma2: "zip",
	m: "objective-c",
	m2v: "video",
	m3u: "audio",
	m3u8: "audio",
	m4a: "audio",
	m4b: "audio",
	m4p: "audio",
	m4r: "audio",
	m4v: "video",
	mak: "settings",
	manifest: "xml",
	markdn: "markdown",
	markdown: "markdown",
	md: "markdown",
	mdb: "database",
	mdc: "image",
	mde: "database",
	mdf: "database",
	mdown: "markdown",
	mdp: "image",
	mdtext: "markdown",
	mdtxt: "markdown",
	mdwn: "markdown",
	mdx: "mdx",
	mef: "image",
	menu: "xml",
	mi: "c",
	mid: "audio",
	mii: "cpp",
	mitigus: "assembly",
	mjs: "javascript",
	mk: "makefile",
	mka: "audio",
	mkd: "markdown",
	mkdn: "markdown",
	mkv: "video",
	ml: "ocaml",
	mli: "ocaml",
	mm: "objective-cpp",
	mmf: "audio",
	mod: "audio",
	mos: "image",
	mov: "video",
	mp2: "video",
	mp3: "audio",
	mp4: "video",
	mpc: "audio",
	mpe: "video",
	mpeg: "video",
	mpg: "video",
	mpv: "video",
	mrf: "font",
	mrw: "image",
	ms: "assembly",
	mscz: "audio",
	msi: "exe",
	mtm: "audio",
	mts: "typescript",
	mui: "audio",
	mustache: "handlebars",
	musx: "audio",
	mxl: "audio",
	myd: "database",
	myi: "database",
	nasm: "assembly",
	ndf: "database",
	ndjson: "json",
	nef: "image",
	nf: "groovy",
	nginx: "nginx",
	nginxconf: "nginx",
	nginxconfig: "nginx",
	nim: "nim",
	nimble: "nim",
	nix: "nix",
	npmrc: "settings",
	nrw: "image",
	nsa: "audio",
	ntf: "font",
	ntfs: "zip",
	nu: "console",
	obm: "image",
	odb: "database",
	odp: "powerpoint",
	ods: "table",
	odt: "word",
	odttf: "font",
	ogg: "video",
	ogv: "video",
	opml: "xml",
	option: "settings",
	opus: "audio",
	ora: "image",
	orc: "database",
	orf: "image",
	otf: "font",
	owl: "xml",
	pac: "javascript",
	parquet: "database",
	passwd: "key",
	patch: "git",
	pbm: "image",
	pdb: "database",
	pdf: "pdf",
	pdn: "image",
	pef: "image",
	pem: "key",
	pgf: "image",
	pgm: "image",
	pgsql: "database",
	php: "php",
	php4: "php",
	php5: "php",
	phtml: "php",
	pic: "image",
	pkb: "database",
	pkf: "audio",
	pks: "database",
	plist: "xml",
	plpgsql: "database",
	pm: "perl",
	png: "image",
	pnm: "image",
	pod: "perl",
	podspec: "ruby",
	postgres: "database",
	potm: "powerpoint",
	potx: "powerpoint",
	ppa: "powerpoint",
	ppam: "powerpoint",
	ppm: "image",
	pps: "powerpoint",
	ppsm: "powerpoint",
	ppsx: "powerpoint",
	ppt: "powerpoint",
	pptm: "powerpoint",
	pptx: "powerpoint",
	prefs: "settings",
	prisma: "prisma",
	profile: "console",
	proj: "xml",
	project: "xml",
	prop: "settings",
	properties: "settings",
	props: "settings",
	proto: "proto",
	ps1: "powershell",
	ps1xml: "powershell",
	psc1: "powershell",
	psd1: "powershell",
	psgi: "perl",
	psm1: "powershell",
	psql: "database",
	psrc: "powershell",
	pssc: "powershell",
	psv: "table",
	ptx: "image",
	pub: "key",
	publishsettings: "xml",
	pubxml: "xml",
	"pubxml.user": "xml",
	pug: "pug",
	pxn: "image",
	py: "python",
	pyi: "python",
	pyt: "python",
	pyw: "python",
	qcp: "audio",
	qt: "video",
	r: "r",
	r3d: "image",
	ra: "audio",
	raf: "image",
	rake: "ruby",
	raku: "perl",
	rar: "zip",
	raw: "image",
	rb: "ruby",
	rbi: "ruby",
	rbs: "ruby",
	rbx: "ruby",
	rdf: "xml",
	reb: "image",
	rej: "diff",
	repo: "settings",
	resx: "xml",
	rf64: "audio",
	rhistory: "r",
	rhtml: "html",
	rip: "audio",
	rjs: "ruby",
	rm: "video",
	rmd: "r",
	rmvb: "video",
	rng: "xml",
	ron: "rust",
	ronn: "markdown",
	rpm: "zip",
	rprofile: "r",
	rpy: "python",
	rs: "rust",
	rss: "xml",
	rst: "markdown",
	rt: "r",
	rtf: "word",
	ru: "ruby",
	ruleset: "visualstudio",
	rw2: "image",
	rwl: "image",
	rwz: "image",
	s: "assembly",
	sai: "image",
	sass: "sass",
	sbt: "sbt",
	sc: "scala",
	scala: "scala",
	scss: "sass",
	sdf: "database",
	sdt: "audio",
	secret: "key",
	sesx: "audio",
	settings: "settings",
	sf2: "audio",
	sh: "console",
	sha256: "key",
	sha256sum: "key",
	sha256sums: "key",
	shasum: "key",
	shproj: "xml",
	shtml: "html",
	sln: "visualstudio",
	"sln.dotsettings": "settings",
	"sln.dotsettings.user": "settings",
	slnf: "visualstudio",
	slnx: "visualstudio",
	so: "dll",
	sol: "solidity",
	"spec-d.ts": "test-ts",
	"spec.cjs": "test-js",
	"spec.cts": "test-ts",
	"spec.js": "test-js",
	"spec.mjs": "test-js",
	"spec.mts": "test-ts",
	"spec.ts": "test-ts",
	sql: "database",
	sqlite: "database",
	sqlite3: "database",
	squashfs: "zip",
	sr2: "image",
	srf: "image",
	srw: "image",
	stap: "audio",
	"stories.js": "storybook",
	"stories.jsx": "storybook",
	"stories.mdx": "storybook",
	"stories.svelte": "storybook",
	"stories.ts": "storybook",
	"stories.tsx": "storybook",
	"stories.vue": "storybook",
	"story.js": "storybook",
	"story.jsx": "storybook",
	"story.mdx": "storybook",
	"story.ts": "storybook",
	"story.tsx": "storybook",
	storyboard: "xml",
	styl: "stylus",
	sui: "font",
	suit: "font",
	suo: "visualstudio",
	svelte: "svelte",
	svg: "svg",
	swift: "swift",
	swiftdeps: "swift",
	swiftdoc: "swift",
	swiftmodule: "swift",
	swiftsourceinfo: "swift",
	swm: "zip",
	synctex: "tex",
	"synctex.gz": "tex",
	t: "perl",
	tar: "zip",
	targets: "xml",
	taz: "zip",
	tbz: "zip",
	tbz2: "zip",
	tcc: "hpp",
	tcsh: "console",
	tcshrc: "console",
	terraformignore: "terraform",
	"test-d.ts": "test-ts",
	"test.cjs": "test-js",
	"test.cts": "test-ts",
	"test.js": "test-js",
	"test.mjs": "test-js",
	"test.mts": "test-ts",
	"test.ts": "test-ts",
	tex: "tex",
	tf: "terraform",
	"tf.json": "terraform",
	tfbackend: "terraform",
	tfstate: "terraform",
	tfvars: "terraform",
	tg: "audio",
	tga: "image",
	tgz: "zip",
	tif: "image",
	tiff: "image",
	tikz: "tex",
	tld: "xml",
	tlz: "zip",
	tmlanguage: "xml",
	tmx: "xml",
	todo: "todo",
	toml: "toml",
	"tool-versions": "settings",
	tpp: "cpp",
	tpz: "zip",
	ts: "typescript",
	"ts.map": "json",
	"ts.snap": "test-ts",
	tsbuildinfo: "json",
	"tsconfig.json": "tsconfig",
	tsv: "table",
	tsx: "react_ts",
	ttc: "font",
	ttf: "font",
	txt: "document",
	txx: "cpp",
	txz: "zip",
	tz: "zip",
	tzst: "zip",
	tzstd: "zip",
	vb: "visualstudio",
	vba: "visualstudio",
	vbproj: "xml",
	"vbproj.user": "xml",
	vbs: "visualstudio",
	vcxitems: "visualstudio",
	"vcxitems.filters": "visualstudio",
	vcxproj: "visualstudio",
	"vcxproj.filters": "visualstudio",
	vim: "vim",
	viminfo: "vim",
	vimrc: "vim",
	vob: "video",
	voc: "audio",
	volt: "html",
	vqf: "audio",
	vue: "vue",
	wasm: "webassembly",
	wat: "webassembly",
	wav: "audio",
	weba: "audio",
	webm: "video",
	webmanifest: "json",
	webp: "image",
	wfp: "audio",
	wim: "zip",
	winget: "yaml",
	wixproj: "visualstudio",
	wma: "audio",
	wmv: "video",
	woff: "font",
	woff2: "font",
	workbook: "markdown",
	wpl: "audio",
	wproj: "audio",
	wsdl: "xml",
	wv: "audio",
	wxi: "xml",
	wxl: "xml",
	wxs: "xml",
	x3f: "image",
	xar: "zip",
	xbl: "xml",
	xcf: "image",
	xcplayground: "swift",
	xht: "html",
	xhtml: "html",
	xib: "xml",
	xliff: "xml",
	xls: "table",
	xlsm: "table",
	xlsx: "table",
	xml: "xml",
	"xml.dist": "xml",
	"xml.dist.sample": "xml",
	xmp: "xml",
	xoml: "xml",
	xpdl: "xml",
	xprofile: "console",
	xquery: "xml",
	xsd: "xml",
	xsession: "console",
	xsessionrc: "console",
	xsh: "console",
	xsl: "xml",
	xslt: "xml",
	xul: "xml",
	xz: "zip",
	yaml: "yaml",
	"yaml-tmlanguage": "yaml",
	"yaml-tmpreferences": "yaml",
	"yaml-tmtheme": "yaml",
	"yaml.dist": "yaml",
	yash_profile: "console",
	yashrc: "console",
	yml: "yaml",
	"yml.dist": "yaml",
	yuv: "video",
	z: "zip",
	zig: "zig",
	zip: "zip",
	zlogin: "console",
	zlogout: "console",
	zon: "zig",
	zprofile: "console",
	zsh: "console",
	"zsh-theme": "console",
	zshenv: "console",
	zshrc: "console",
	zst: "zip",
	zstd: "zip"
}, il = new Map(Object.entries(/* @__PURE__ */ Object.assign({
	"./icons/asciidoc.svg": zo,
	"./icons/assembly.svg": Bo,
	"./icons/astro.svg": Vo,
	"./icons/audio.svg": Ho,
	"./icons/bicep.svg": Uo,
	"./icons/c.svg": Wo,
	"./icons/cabal.svg": Go,
	"./icons/certificate.svg": Ko,
	"./icons/clojure.svg": qo,
	"./icons/cmake.svg": Jo,
	"./icons/console.svg": Yo,
	"./icons/cpp.svg": Xo,
	"./icons/crystal.svg": Zo,
	"./icons/csharp.svg": Qo,
	"./icons/css.svg": $o,
	"./icons/dart.svg": es,
	"./icons/database.svg": ts,
	"./icons/diff.svg": ns,
	"./icons/dll.svg": rs,
	"./icons/docker.svg": is,
	"./icons/document.svg": as,
	"./icons/editorconfig.svg": os,
	"./icons/elixir.svg": ss,
	"./icons/elm.svg": cs,
	"./icons/erlang.svg": ls,
	"./icons/eslint.svg": us,
	"./icons/exe.svg": ds,
	"./icons/file.svg": fs,
	"./icons/font.svg": ps,
	"./icons/fsharp.svg": ms,
	"./icons/git.svg": hs,
	"./icons/github-actions-workflow.svg": gs,
	"./icons/gitlab.svg": _s,
	"./icons/go-mod.svg": vs,
	"./icons/go.svg": ys,
	"./icons/gradle.svg": bs,
	"./icons/graphql.svg": xs,
	"./icons/groovy.svg": Ss,
	"./icons/h.svg": Cs,
	"./icons/handlebars.svg": ws,
	"./icons/haskell.svg": Ts,
	"./icons/hcl.svg": Es,
	"./icons/hex.svg": Ds,
	"./icons/hpp.svg": Os,
	"./icons/html.svg": ks,
	"./icons/image.svg": As,
	"./icons/jar.svg": js,
	"./icons/java.svg": Ms,
	"./icons/javaclass.svg": Ns,
	"./icons/javascript.svg": Ps,
	"./icons/json.svg": Fs,
	"./icons/julia.svg": Is,
	"./icons/jupyter.svg": Ls,
	"./icons/key.svg": Rs,
	"./icons/kotlin.svg": zs,
	"./icons/kubernetes.svg": Bs,
	"./icons/less.svg": Vs,
	"./icons/license.svg": Hs,
	"./icons/lock.svg": Us,
	"./icons/log.svg": Ws,
	"./icons/lua.svg": Gs,
	"./icons/makefile.svg": Ks,
	"./icons/markdown.svg": qs,
	"./icons/maven.svg": Js,
	"./icons/mdx.svg": Ys,
	"./icons/nginx.svg": Xs,
	"./icons/nim.svg": Zs,
	"./icons/nix.svg": Qs,
	"./icons/nodejs.svg": $s,
	"./icons/npm.svg": ec,
	"./icons/objective-c.svg": tc,
	"./icons/objective-cpp.svg": nc,
	"./icons/ocaml.svg": rc,
	"./icons/pdf.svg": ic,
	"./icons/perl.svg": ac,
	"./icons/php.svg": oc,
	"./icons/pnpm.svg": sc,
	"./icons/powerpoint.svg": cc,
	"./icons/powershell.svg": lc,
	"./icons/prettier.svg": uc,
	"./icons/prisma.svg": dc,
	"./icons/proto.svg": fc,
	"./icons/pug.svg": pc,
	"./icons/python.svg": mc,
	"./icons/r.svg": hc,
	"./icons/react.svg": gc,
	"./icons/react_ts.svg": _c,
	"./icons/readme.svg": vc,
	"./icons/ruby.svg": yc,
	"./icons/rust.svg": bc,
	"./icons/sass.svg": xc,
	"./icons/sbt.svg": Sc,
	"./icons/scala.svg": Cc,
	"./icons/settings.svg": wc,
	"./icons/solidity.svg": Tc,
	"./icons/storybook.svg": Ec,
	"./icons/stylus.svg": Dc,
	"./icons/svelte.svg": Oc,
	"./icons/svg.svg": kc,
	"./icons/swift.svg": Ac,
	"./icons/table.svg": jc,
	"./icons/terraform.svg": Mc,
	"./icons/test-js.svg": Nc,
	"./icons/test-ts.svg": Pc,
	"./icons/tex.svg": Fc,
	"./icons/todo.svg": Ic,
	"./icons/toml.svg": Lc,
	"./icons/tsconfig.svg": Rc,
	"./icons/tune.svg": zc,
	"./icons/typescript-def.svg": Bc,
	"./icons/typescript.svg": Vc,
	"./icons/video.svg": Hc,
	"./icons/vim.svg": Uc,
	"./icons/visualstudio.svg": Wc,
	"./icons/vite.svg": Gc,
	"./icons/vue.svg": Kc,
	"./icons/webassembly.svg": qc,
	"./icons/webpack.svg": Jc,
	"./icons/word.svg": Yc,
	"./icons/xml.svg": Xc,
	"./icons/yaml.svg": Zc,
	"./icons/yarn.svg": Qc,
	"./icons/zig.svg": $c,
	"./icons/zip.svg": el
})).map(([e, t]) => [e.slice(8, -4), t]));
function al(e) {
	let t = e.slice(e.lastIndexOf("/") + 1).toLowerCase(), n = nl[t];
	if (n) return n;
	let r = t.split(".");
	for (let e = 1; e < r.length; e++) {
		let t = rl[r.slice(e).join(".")];
		if (t) return t;
	}
	return tl;
}
var ol = /* @__PURE__ */ new Map(), sl = (e) => {
	let t = ol.get(e);
	if (t) return t;
	let n = il.get(e) ?? il.get("file") ?? "", r = `data:image/svg+xml,${encodeURIComponent(n)}`;
	return ol.set(e, r), r;
};
function cl({ path: e, size: t = 16, className: n }) {
	return /* @__PURE__ */ X("img", {
		src: sl(al(e)),
		alt: "",
		"aria-hidden": !0,
		width: t,
		height: t,
		className: I("shrink-0", n)
	});
}
// src/app/atoms/file-button/CodeChangesBadge.tsx
var ll = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), ul = {
	small: "text-xs !leading-4",
	medium: "text-sm !leading-5",
	large: "text-base !leading-6"
}, dl = (e) => typeof e == "number", fl = (e, t) => `${e} ${t}${e === 1 ? "" : "s"}`;
function pl(e, t) {
	return [dl(e) ? fl(e, "addition") : null, dl(t) ? fl(t, "deletion") : null].filter(Boolean).join(", ");
}
var ml = ({ additions: e, deletions: t, size: n = "small", className: r }) => {
	let i = pl(e, t);
	return i ? /* @__PURE__ */ Z("span", {
		className: I("code inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium !tracking-normal", ul[n], r),
		children: [
			dl(e) ? /* @__PURE__ */ Z("span", {
				"aria-hidden": !0,
				className: "text-success-primary",
				children: ["+", e]
			}) : null,
			dl(t) ? /* @__PURE__ */ Z("span", {
				"aria-hidden": !0,
				className: "text-error-primary",
				children: ["-", t]
			}) : null,
			/* @__PURE__ */ X("span", {
				className: "sr-only",
				children: i
			})
		]
	}) : null;
}, hl = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), gl = {
	small: {
		box: "gap-1.5 py-1 pl-1 pr-3",
		label: "label-micro",
		icon: 16,
		badge: ll.Small
	},
	medium: {
		box: "gap-1.5 py-2 pl-2 pr-4",
		label: "label-small",
		icon: 20,
		badge: ll.Medium
	},
	large: {
		box: "gap-2 py-3 pl-3 pr-6",
		label: "label-medium",
		icon: 24,
		badge: ll.Large
	}
}, _l = {
	regular: I("bg-btn-ghost text-btn-secondary", "enabled:hover:bg-btn-ghost-hovered enabled:hover:text-btn-secondary-hovered", "enabled:active:bg-btn-ghost-pressed enabled:active:text-btn-secondary-pressed", "disabled:bg-btn-ghost-disabled disabled:text-btn-secondary-disabled"),
	highlighted: I("bg-btn-ghost-highlighted text-btn-secondary-highlighted", "enabled:hover:bg-btn-ghost-highlighted-hovered enabled:hover:text-btn-secondary-hovered-highlighted", "enabled:active:bg-btn-ghost-highlighted-pressed enabled:active:text-btn-secondary-pressed-highlighted", "disabled:bg-btn-ghost-highlighted-disabled disabled:text-btn-secondary-disabled")
}, vl = "group-disabled/file-button:opacity-50", yl = (e) => e.replace(/\/+$/, "").split("/").pop() || e, bl = ({ ref: e, path: t, label: n, size: r = "small", active: i = !1, disabled: a = !1, additions: o, deletions: s, onClick: c, className: l }) => {
	let u = gl[r], d = n || yl(t), f = [d, pl(o, s)].filter(Boolean).join(", ");
	return /* @__PURE__ */ Z("button", {
		ref: e,
		type: "button",
		title: t,
		"aria-label": f,
		"aria-current": i || void 0,
		disabled: a,
		onClick: c,
		className: I("group/file-button inline-flex min-w-0 max-w-full items-center rounded-[4px]", "transition-colors duration-150 ease-out disabled:cursor-not-allowed", "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]", u.box, i ? _l.highlighted : _l.regular, l),
		children: [
			/* @__PURE__ */ X(cl, {
				path: t,
				size: u.icon,
				className: i ? void 0 : vl
			}),
			/* @__PURE__ */ X("span", {
				className: I("min-w-0 truncate", u.label),
				children: d
			}),
			/* @__PURE__ */ X(ml, {
				additions: o,
				deletions: s,
				size: u.badge,
				className: vl
			})
		]
	});
}, xl = {
	[hl.Small]: U.Small,
	[hl.Medium]: U.Medium,
	[hl.Large]: U.Large
}, Sl = ({ files: e, size: t = hl.Small, onOpen: n, limit: r = 10, "aria-label": i, className: a }) => {
	let [o, s] = J(!1), c = q(null), l = q(null), u = Math.max(0, r - 1), d = !o && e.length > r ? e.slice(0, u) : e, f = e.length - d.length, p = e.findIndex((e, t) => t >= u && !e.disabled);
	return /* @__PURE__ */ Z("div", {
		className: I("flex flex-col items-start gap-1 [&>*]:shrink-0", a),
		children: [/* @__PURE__ */ X("ul", {
			ref: c,
			role: "list",
			"aria-label": i,
			tabIndex: -1,
			className: "flex w-full flex-col gap-1 [&>*]:shrink-0",
			children: d.map((e, r) => /* @__PURE__ */ X("li", {
				className: "flex",
				children: /* @__PURE__ */ X(bl, {
					ref: r === p ? l : void 0,
					path: e.path,
					label: e.label,
					size: t,
					active: e.active,
					disabled: e.disabled,
					additions: e.additions,
					deletions: e.deletions,
					onClick: () => n(e.path),
					className: "w-full"
				})
			}, `${r}:${e.path}`))
		}), f > 0 ? /* @__PURE__ */ Z(z, {
			size: xl[t],
			variant: B.Ghost,
			onClick: () => {
				Ni(() => s(!0)), (l.current ?? c.current)?.focus();
			},
			children: [
				"+",
				f,
				" more"
			]
		}) : null]
	});
}, Cl = ({ multiple: e = !1, accept: t, files: n = [], errors: r = [], hint: i, disabled: a = !1, onFilesSelected: o, onRemove: s, className: c = "" }) => {
	let l = q(null), u = r.length > 0, d = n.length === 0 || u, f = e && n.length === 0 && !u ? "Upload files" : "Upload file";
	return /* @__PURE__ */ Z("div", {
		className: I("file-input flex w-full flex-col items-start gap-[10px] rounded-[8px] bg-input p-2", c),
		"data-invalid": u || void 0,
		children: [
			/* @__PURE__ */ X("input", {
				ref: l,
				type: "file",
				className: "sr-only",
				tabIndex: -1,
				"aria-hidden": "true",
				multiple: e,
				accept: t,
				disabled: a,
				onChange: (e) => {
					let t = e.target.files ? [...e.target.files] : [];
					o?.(t), e.target.value = "";
				}
			}),
			n.map((e) => /* @__PURE__ */ Z("div", {
				className: "file-input-row flex w-full items-center gap-1 overflow-hidden rounded-[4px] bg-elevation-level-1 shadow-convex",
				children: [
					/* @__PURE__ */ X(R, {
						iconName: H.Attachment,
						size: 16,
						"aria-hidden": "true",
						color: "var(--color-fill-basic-primary)"
					}),
					/* @__PURE__ */ X("span", {
						className: "file-input-meta min-w-0 flex-1 truncate text-basic-primary",
						children: e.name
					}),
					/* @__PURE__ */ X("span", {
						className: "file-input-meta shrink-0 text-basic-tertiary",
						children: e.size
					}),
					/* @__PURE__ */ X("button", {
						type: "button",
						"aria-label": `Remove ${e.name}`,
						disabled: a,
						className: "flex size-4 shrink-0 items-center justify-center disabled:cursor-not-allowed",
						onClick: () => s?.(e.id),
						children: /* @__PURE__ */ X(R, {
							iconName: H.Close,
							size: 16,
							"aria-hidden": "true",
							color: a ? "var(--color-fill-basic-muted)" : "var(--color-fill-basic-primary)"
						})
					})
				]
			}, e.id)),
			d ? /* @__PURE__ */ Z(z, {
				variant: B.Secondary,
				size: U.Medium,
				content: g.IconLeft,
				disabled: a,
				onClick: () => l.current?.click(),
				children: [/* @__PURE__ */ X(R, {
					iconName: H.FileUpload,
					"aria-hidden": "true"
				}), f]
			}) : null,
			r.map((e, t) => /* @__PURE__ */ X("p", {
				className: "label-micro w-full text-error-primary",
				children: e
			}, `${t}-${e}`)),
			i ? /* @__PURE__ */ X("p", {
				className: "file-input-hint w-full text-basic-muted",
				children: i
			}) : null
		]
	});
}, wl = /* @__PURE__ */ function(e) {
	return e.Changed = "M", e.Added = "A", e.Deleted = "D", e.ChangedName = "R", e.Copied = "C", e.ChangedType = "T", e.Conflict = "U", e.NotTracked = "?", e.Ignored = "!", e;
}({}), Tl = {
	M: {
		title: "Modified",
		name: "text-danger-primary",
		fill: "[&_path]:fill-danger-primary",
		letter: "text-danger-primary"
	},
	A: {
		title: "Added",
		name: "text-info-primary",
		fill: "[&_path]:fill-info-primary",
		letter: "text-info-primary"
	},
	D: {
		title: "Deleted",
		name: "text-error-primary",
		fill: "[&_path]:fill-error-primary",
		letter: "text-error-primary"
	},
	R: {
		title: "Renamed",
		name: "text-accent-primary",
		fill: "[&_path]:fill-accent-primary",
		letter: "text-accent-primary"
	},
	C: {
		title: "Copied",
		name: "text-info-secondary",
		fill: "[&_path]:fill-info-secondary",
		letter: "text-info-secondary"
	},
	T: {
		title: "Type changed",
		name: "text-danger-secondary",
		fill: "[&_path]:fill-danger-secondary",
		letter: "text-danger-secondary"
	},
	U: {
		title: "Conflict",
		name: "text-error-secondary",
		fill: "[&_path]:fill-error-secondary",
		letter: "text-error-secondary"
	},
	"?": {
		title: "Untracked",
		name: "text-basic-tertiary",
		fill: "[&_path]:fill-basic-tertiary",
		letter: "text-basic-muted"
	},
	"!": {
		title: "Ignored",
		name: "text-basic-tertiary",
		fill: "[&_path]:fill-basic-tertiary",
		letter: "text-basic-muted"
	}
}, El = new Map(Object.values(wl).map((e) => [e, e]));
function Dl(e) {
	let t = e?.trim()[0];
	return t ? El.get(t) ?? "M" : null;
}
function Ol({ status: e, className: t }) {
	let n = Tl[e];
	return /* @__PURE__ */ X("span", {
		"aria-hidden": !0,
		title: n.title,
		className: I("header-2xs inline-flex size-4 shrink-0 items-center justify-center", n.letter, t),
		children: e
	});
}
// src/app/atoms/file-list-tab-button/index.tsx
var kl = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Large = "large", e;
}({}), Al = /* @__PURE__ */ function(e) {
	return e.File = "file", e.Folder = "folder", e;
}({}), jl = {
	small: {
		box: "h-7 gap-1 p-1",
		label: "label-micro",
		icon: 16
	},
	large: {
		box: "h-12 gap-3 px-3 py-2",
		label: "label-medium",
		icon: 24
	}
}, Ml = {
	regular: I("bg-btn-ghost text-btn-secondary", "enabled:hover:bg-btn-ghost-hovered enabled:hover:text-btn-secondary-hovered", "enabled:active:bg-btn-ghost-pressed enabled:active:text-btn-secondary-pressed", "disabled:bg-btn-ghost-disabled disabled:text-btn-secondary-disabled"),
	highlighted: I("bg-btn-ghost-highlighted text-btn-secondary-highlighted", "enabled:hover:bg-btn-ghost-highlighted-hovered", "enabled:active:bg-btn-ghost-highlighted-pressed enabled:active:text-btn-secondary-pressed-highlighted", "disabled:bg-btn-ghost-highlighted-disabled disabled:text-btn-secondary-disabled-highlighted")
}, Nl = I("[&_path]:fill-btn-secondary", "group-hover/file-list-tab-button:[&_path]:fill-btn-secondary-hovered", "group-active/file-list-tab-button:[&_path]:fill-btn-secondary-pressed", "group-disabled/file-list-tab-button:[&_path]:fill-btn-secondary-disabled"), Pl = "group-disabled/file-list-tab-button:opacity-50", Fl = ({ ref: e, name: t, path: n, variant: r = "file", size: i = "small", status: a = null, active: o = !1, disabled: s = !1, className: c, ...l }) => {
	let u = jl[i], d = a ? Tl[a] : null, f = r === "folder";
	return /* @__PURE__ */ Z("button", {
		ref: e,
		type: "button",
		disabled: s,
		"aria-pressed": f ? void 0 : o,
		"aria-expanded": f ? o : void 0,
		className: I("group/file-list-tab-button flex w-full min-w-0 items-center rounded-[4px]", "transition-colors duration-150 ease-out disabled:cursor-not-allowed", "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]", u.box, o && !f ? Ml.highlighted : Ml.regular, c),
		...l,
		children: [
			f ? /* @__PURE__ */ X(R, {
				iconName: H.Right,
				size: u.icon,
				className: I("shrink-0 transition-transform", o && "rotate-90", d ? I(d.fill, Pl) : Nl)
			}) : /* @__PURE__ */ X(cl, {
				path: n ?? t,
				size: u.icon,
				className: Pl
			}),
			/* @__PURE__ */ Z("span", {
				className: I("min-w-0 flex-1 truncate text-left", u.label, d && I(d.name, Pl)),
				children: [t, d ? /* @__PURE__ */ Z("span", {
					className: "sr-only",
					children: [", ", d.title]
				}) : null]
			}),
			a && !f ? /* @__PURE__ */ X(Ol, {
				status: a,
				className: Pl
			}) : null
		]
	});
};
// src/app/atoms/fork-session-item/index.tsx
function Il(e) {
	return e.replace(/-/g, "").slice(0, 12);
}
var Ll = ({ sessionId: e, title: t, deleted: n = !1, onOpen: r, onDismiss: i }) => {
	let a = n ? "No fork found" : t?.trim() || "Fork", o = `ID: ${Il(e)}`;
	return n ? /* @__PURE__ */ X("div", {
		className: I("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] max-w-[540px]", "border-l-2 border-tertiary bg-elevation-sublevel-variant-A text-basic-tertiary"),
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ Z("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ X(R, {
						iconName: H.Scheme,
						size: 20,
						className: "shrink-0"
					}),
					/* @__PURE__ */ X("span", {
						className: "header-micro",
						children: a
					}),
					i ? /* @__PURE__ */ X("button", {
						type: "button",
						title: "Dismiss",
						"aria-label": "Dismiss deleted fork",
						onClick: i,
						className: "shrink-0 inline-flex",
						children: /* @__PURE__ */ X(R, {
							iconName: H.Close,
							size: 20
						})
					}) : /* @__PURE__ */ X(R, {
						iconName: H.Close,
						size: 20,
						className: "shrink-0"
					})
				]
			}), /* @__PURE__ */ X("span", {
				className: "code-micro opacity-75 whitespace-nowrap",
				children: o
			})]
		})
	}) : /* @__PURE__ */ X("button", {
		type: "button",
		onClick: r,
		className: I("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] text-left max-w-[540px]", "border-l-2 border-accent-primary bg-btn-ghost-accent-highlighted text-btn-accent", "hover:bg-btn-ghost-accent-highlighted-hovered", "active:bg-btn-ghost-accent-highlighted-pressed"),
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ Z("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ X(R, {
						iconName: H.Scheme,
						size: 20,
						className: "shrink-0"
					}),
					/* @__PURE__ */ X("span", {
						className: "header-micro",
						children: a
					}),
					/* @__PURE__ */ X(R, {
						iconName: H.Right,
						size: 20,
						className: "shrink-0"
					})
				]
			}), /* @__PURE__ */ X("span", {
				className: "code code-micro opacity-75 whitespace-nowrap",
				children: o
			})]
		})
	});
}, Rl = /* @__PURE__ */ function(e) {
	return e.Small = "btn-small", e.Medium = "btn-medium", e.Large = "btn-large", e;
}({}), zl = /* @__PURE__ */ function(e) {
	return e.IconLeft = "horizontal-tab-item-icon-left", e.IconRight = "horizontal-tab-item-icon-right", e.IconOnly = "horizontal-tab-item-icon", e.TextOnly = "horizontal-tab-item-text", e.Full = "horizontal-tab-item-full", e;
}({}), Bl = ({ active: e = !1, size: t = "btn-large", content: n, iconName: r, trailingIcon: i, disabled: a = !1, className: o = "", children: s, type: c = "button", ...l }) => {
	let u = s != null && s !== !1 && s !== "", d = n ?? (r && i ? "horizontal-tab-item-full" : r ? u ? "horizontal-tab-item-icon-left" : "horizontal-tab-item-icon" : i ? u ? "horizontal-tab-item-icon-right" : "horizontal-tab-item-icon" : "horizontal-tab-item-text"), f = d !== "horizontal-tab-item-icon", p = !!r && (d === "horizontal-tab-item-icon-left" || d === "horizontal-tab-item-icon" || d === "horizontal-tab-item-full"), m = !!i && (d === "horizontal-tab-item-icon-right" || d === "horizontal-tab-item-full" || d === "horizontal-tab-item-icon" && !r);
	return /* @__PURE__ */ Z("button", {
		type: c,
		disabled: a,
		className: I("horizontal-tab-item btn", t, d, e ? "horizontal-tab-item-active btn-ghost-highlighted" : "btn-ghost", a && "btn-disabled", o),
		...l,
		children: [
			p ? /* @__PURE__ */ X(R, { iconName: r }) : null,
			f ? /* @__PURE__ */ X("span", {
				className: "min-w-0 truncate",
				children: s
			}) : null,
			m ? /* @__PURE__ */ X(R, { iconName: i }) : null
		]
	});
};
Bl.Size = Rl, Bl.Content = zl;
// src/app/atoms/initial-prompt-box/index.tsx
var Vl = ({ icon: e, title: t, description: n, onClick: r, className: i = "" }) => /* @__PURE__ */ Z("button", {
	type: "button",
	onClick: r,
	className: I("group relative flex h-[100px] w-full flex-col items-start overflow-hidden", "rounded-[4px] bg-elevation-level-1 text-left shadow-convex", "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--blue-500)]", i),
	children: [
		/* @__PURE__ */ X("span", {
			"aria-hidden": !0,
			className: "absolute inset-0 bg-btn-ghost transition-colors duration-200 ease-out group-hover:bg-btn-ghost-hovered group-active:bg-btn-ghost-pressed"
		}),
		/* @__PURE__ */ Z("span", {
			className: "relative flex w-full items-center gap-[10px] px-4 pb-2 pt-4",
			children: [/* @__PURE__ */ X(R, {
				iconName: e,
				size: 20,
				className: "shrink-0 [&>path]:fill-basic-tertiary"
			}), /* @__PURE__ */ X("span", {
				className: "flex-1 min-w-0 truncate label-small text-basic-primary",
				children: t
			})]
		}),
		/* @__PURE__ */ X("span", {
			className: "relative flex w-full flex-col justify-end px-4 pb-4 pt-2",
			children: /* @__PURE__ */ X("span", {
				className: "text-micro text-basic-muted line-clamp-2",
				children: n
			})
		})
	]
}), Q = /* @__PURE__ */ function(e) {
	return e.Small = "input-small", e.Medium = "input-medium", e.Large = "input-large", e;
}({}), Hl = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Ul = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Wl = {
	"input-small": U.Small,
	"input-medium": U.Medium,
	"input-large": U.Large
}, Gl = {
	"input-small": 16,
	"input-medium": 20,
	"input-large": 24
}, Kl = {
	"input-small": "pl-1",
	"input-medium": "pl-2",
	"input-large": "pl-3"
}, ql = {
	"input-small": "pr-1",
	"input-medium": "pr-2",
	"input-large": "pr-3"
}, Jl = {
	"input-small": "pl-6",
	"input-medium": "pl-9",
	"input-large": "pl-12"
}, Yl = {
	"input-small": "pr-6",
	"input-medium": "pr-9",
	"input-large": "pr-12"
}, Xl = {
	"input-small": "top-1 left-1",
	"input-medium": "top-2 left-2",
	"input-large": "top-3 left-3"
}, Zl = {
	"input-small": "top-1 right-1",
	"input-medium": "top-2 right-2",
	"input-large": "top-3 right-3"
}, $ = ({ inputSize: e = "input-large", leading: t = "none", leadingOnClick: n, leadingSlot: r, trailing: i = "none", trailingOnClick: a, leadingIconName: o = H.Add, trailingIconName: s = H.Search, inputClassName: c = "", label: l = "", required: u = !1, rounded: d = !1, placeholder: f = "", isDisabled: p = !1, validation: m = !1, validationText: h = "", hintText: _, className: v = "", ref: y, ...b }) => {
	let x = t !== "none" || !!r, S = i !== "none", C = e === "input-large" && x && !S, w = I("w-full input font-normal", e, c, d ? "rounded-full" : "rounded-[4px]", x ? C ? "input-pad-search" : Jl[e] : Kl[e], S ? Yl[e] : ql[e], p && "input-disabled", m && "input-validation"), T = p ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)";
	return /* @__PURE__ */ X(jo, {
		label: l,
		required: u,
		validation: m,
		validationText: h,
		hintText: _,
		caption: e === "input-large" ? "large" : "compact",
		className: v,
		children: /* @__PURE__ */ Z("div", {
			className: "input-wrapper relative w-full h-fit",
			children: [
				r ? /* @__PURE__ */ X("div", {
					className: I("absolute flex items-center justify-center", C ? "top-3 left-1.5" : Xl[e]),
					style: {
						width: Gl[e],
						height: Gl[e]
					},
					children: r
				}) : null,
				!r && t === "icon" ? /* @__PURE__ */ X(R, {
					iconName: o,
					size: Gl[e],
					className: I("absolute", C ? "top-3 left-1.5" : Xl[e]),
					color: T
				}) : null,
				!r && t === "button" ? /* @__PURE__ */ X(z, {
					size: Wl[e],
					variant: B.Ghost,
					content: g.Icon,
					onClick: n,
					className: I("input-btn-leading", !d && "rounded-lg"),
					children: /* @__PURE__ */ X(R, { iconName: o })
				}) : null,
				/* @__PURE__ */ X("input", {
					ref: y,
					className: w,
					placeholder: f,
					disabled: p,
					...b
				}),
				i === "icon" ? /* @__PURE__ */ X(R, {
					iconName: s,
					size: Gl[e],
					className: I("absolute", Zl[e]),
					color: T
				}) : null,
				i === "button" ? /* @__PURE__ */ X(z, {
					size: Wl[e],
					variant: B.Ghost,
					content: g.Icon,
					onClick: a,
					className: I("input-btn-trailing", !d && "rounded-lg"),
					children: /* @__PURE__ */ X(R, { iconName: s })
				}) : null
			]
		})
	});
};
$.Size = Q, $.Leading = Hl, $.Trailing = Ul;
// src/app/atoms/input/StickyInput.tsx
var Ql = /* @__PURE__ */ function(e) {
	return e.Default = "default", e.Search = "search", e;
}({}), $l = ({ variant: e = "default", leading: t = Hl.None, leadingOnClick: n, trailing: r = Ul.None, trailingOnClick: i, leadingIconName: a = H.Add, trailingIconName: o = H.Search, inputClassName: s = "", className: c = "", rounded: l = !0, isDisabled: u = !1, validation: d = !1, onClear: f, value: p, ref: m, ...h }) => {
	let _ = e === "search", v = p != null && String(p).length > 0, y = _ ? Hl.Icon : t, b = _ ? H.Search : a, x = _ ? v ? Ul.Button : Ul.None : r, S = _ ? H.Close : o, C = _ ? f : i, w = c.includes("flex-grow") || c.includes("flex-1"), T = l ? "rounded-full" : "rounded-[4px]", E = u ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)", D = {
		[Hl.None]: "pl-3",
		[Hl.Icon]: "pl-10",
		[Hl.Button]: "pl-12"
	}[y], O = {
		[Ul.None]: "pr-3",
		[Ul.Icon]: "pr-10",
		[Ul.Button]: "pr-12"
	}[x];
	return /* @__PURE__ */ X("div", {
		className: I("bg-elevation-level-3 shadow-xl overflow-hidden h-10", w ? "flex w-full" : "inline-flex w-fit", T, c),
		children: /* @__PURE__ */ Z("div", {
			className: "input-wrapper relative w-full h-full",
			children: [
				y === Hl.Icon ? /* @__PURE__ */ X(R, {
					iconName: b,
					size: 24,
					className: "absolute top-2 left-2",
					color: E
				}) : null,
				y === Hl.Button ? /* @__PURE__ */ X(z, {
					size: U.Large,
					variant: B.Ghost,
					content: g.Icon,
					onClick: n,
					className: "btn-sticky input-btn-leading",
					children: /* @__PURE__ */ X(R, { iconName: b })
				}) : null,
				/* @__PURE__ */ X("input", {
					ref: m,
					className: I("w-full input input-sticky font-normal", T, D, O, u && "input-disabled", d && "input-validation", s),
					disabled: u,
					value: p,
					...h
				}),
				x === Ul.Icon ? /* @__PURE__ */ X(R, {
					iconName: S,
					size: 24,
					className: "absolute top-2 right-2",
					color: E
				}) : null,
				x === Ul.Button ? /* @__PURE__ */ X(z, {
					size: U.Large,
					variant: B.Ghost,
					content: g.Icon,
					onClick: C,
					"aria-label": _ ? "Clear search" : void 0,
					className: "btn-sticky input-btn-trailing",
					children: /* @__PURE__ */ X(R, { iconName: S })
				}) : null
			]
		})
	});
};
$l.Variant = Ql, $l.Leading = Hl, $l.Trailing = Ul;
// src/app/atoms/input/TextArea.tsx
var eu = /* @__PURE__ */ function(e) {
	return e.Small = "h-[93px] p-1 text-micro", e.Medium = "h-[86px] p-2 text-small", e.Large = "h-[120px] p-3 text-medium", e;
}({}), tu = ({ textAreaSize: e = "h-[86px] p-2 text-small", label: t = "", required: n = !1, isDisabled: r = !1, validation: i = !1, validationText: a = "", hintText: o, className: s = "", textAreaClassName: c = "", ref: l, ...u }) => /* @__PURE__ */ X(jo, {
	label: t,
	required: n,
	validation: i,
	validationText: a,
	hintText: o,
	caption: e === "h-[120px] p-3 text-medium" ? "large" : "compact",
	className: s,
	children: /* @__PURE__ */ X("textarea", {
		ref: l,
		className: I("w-full input font-normal rounded-[4px]", e, r && "input-disabled", i && "input-validation", c),
		disabled: r,
		...u
	})
});
tu.Size = eu;
// src/app/atoms/insight-item/InsightShowFullButton.tsx
var nu = ({ expanded: e, loading: t = !1, controls: n, onClick: r }) => /* @__PURE__ */ Z(z, {
	size: U.Small,
	variant: B.Tertiary,
	content: g.IconRight,
	"aria-expanded": e,
	"aria-controls": n,
	"aria-disabled": t || void 0,
	className: I("self-start", t && "btn-disabled"),
	onClick: t ? void 0 : r,
	children: [/* @__PURE__ */ X("span", {
		className: "underline",
		children: e ? "Hide" : "Show full"
	}), t ? /* @__PURE__ */ X(ut, {
		size: bt.XSmall,
		"aria-hidden": !0
	}) : /* @__PURE__ */ X(R, {
		iconName: e ? H.Top : H.Down,
		size: 16,
		"aria-hidden": !0
	})]
}), ru = /* @__PURE__ */ function(e) {
	return e.Default = "default", e.Loading = "loading", e.Expanded = "expanded", e;
}({}), iu = "code code-small font-medium !leading-4 !tracking-normal whitespace-pre-wrap break-words", au = ({ title: e, showHeading: t = !0, state: n = "default", shortContent: r, fullContent: i, onShowFull: a, onHide: o, error: s, note: c }) => {
	let l = fi(), u = fi(), d = n === "loading", f = n === "expanded", p = f ? i ?? r : r, m = f ? o : a, h = d || m !== void 0;
	return /* @__PURE__ */ Z("div", {
		role: "group",
		"aria-labelledby": t ? l : void 0,
		"aria-label": t ? void 0 : e,
		className: "flex w-full min-w-0 flex-col gap-2 border-l-2 border-muted pl-4",
		children: [
			t ? /* @__PURE__ */ X("p", {
				id: l,
				className: "break-words text-micro font-semibold text-basic-primary",
				children: e
			}) : null,
			/* @__PURE__ */ X("div", {
				id: u,
				"aria-busy": d || void 0,
				className: I(iu, "empty:hidden", d ? "text-shimmer-basic motion-reduce:animate-none" : "text-basic-tertiary"),
				children: p
			}),
			s && n === "default" ? /* @__PURE__ */ X("p", {
				role: "alert",
				className: "break-words text-micro text-error-primary",
				children: s
			}) : null,
			c && f ? /* @__PURE__ */ X("p", {
				className: "break-words text-micro text-basic-muted",
				children: c
			}) : null,
			h || f ? /* @__PURE__ */ Z("div", {
				className: "flex w-full items-start gap-4",
				children: [h ? /* @__PURE__ */ X(nu, {
					expanded: f,
					loading: d,
					controls: u,
					onClick: m
				}) : null, f ? /* @__PURE__ */ X(Yt, {
					value: p,
					title: `Copy ${e}`
				}) : null]
			}) : null
		]
	});
}, ou = ({ label: e, href: t, onClick: n, className: r }) => {
	let i = I("btn", U.Small, B.Ghost, g.IconRight, "!h-7 !p-1 max-w-full self-start", r), a = /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("span", {
		className: "min-w-0 truncate",
		children: e
	}), /* @__PURE__ */ X(R, {
		iconName: H.Right,
		size: 16,
		className: "shrink-0"
	})] });
	return t == null ? /* @__PURE__ */ X("button", {
		type: "button",
		onClick: n,
		className: i,
		children: a
	}) : /* @__PURE__ */ X("a", {
		href: t,
		onClick: n,
		className: i,
		children: a
	});
}, su = /* @__PURE__ */ function(e) {
	return e.Default = "default", e.Loading = "loading", e.Error = "error", e;
}({}), cu = ({ id: e, icon: t, title: n, state: r = "default", active: i = !1, copyText: a, errorMessage: o, errorAction: s, children: c }) => {
	let l = N(), u = fi(), d = r === "loading", f = r === "error";
	return /* @__PURE__ */ Z("div", {
		id: e,
		role: "group",
		"aria-labelledby": u,
		"aria-current": i || void 0,
		className: I("flex flex-col gap-4 border-b border-muted px-4 pt-6 pb-[23px] text-micro text-basic-tertiary", i && "bg-elevation-level-1"),
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex w-full items-start gap-2 py-1",
				children: [
					d ? /* @__PURE__ */ X(ut, {
						size: bt.Small,
						"aria-hidden": !0,
						className: "shrink-0"
					}) : /* @__PURE__ */ X(R, {
						iconName: f ? H.Close : t,
						size: 20,
						"aria-hidden": !0,
						className: I("shrink-0", f ? "[&>path]:fill-error-primary" : "[&>path]:fill-basic-primary")
					}),
					/* @__PURE__ */ X("span", {
						id: u,
						className: I("flex-1 min-w-0 break-words label-small", d ? "text-shimmer-basic motion-reduce:animate-none" : "text-basic-primary"),
						children: d ? `${n}…` : n
					}),
					a && r === "default" ? /* @__PURE__ */ X(Yt, {
						value: a,
						title: `Copy ${n}`,
						size: l ? U.Medium : U.Small,
						variant: l ? B.Ghost : B.Tertiary,
						position: M.BottomLeft,
						className: "md:!h-4 md:!min-h-4 md:!p-0"
					}) : null
				]
			}),
			c,
			f && o ? /* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-2",
				children: [/* @__PURE__ */ X("p", {
					className: "whitespace-pre-wrap break-words text-small text-error-primary",
					children: o
				}), s]
			}) : null
		]
	});
}, lu = /* @__PURE__ */ function(e) {
	return e.Brand = "stroke-[var(--color-fill-accent-primary)]", e.Neutral = "stroke-[var(--color-fill-basic-primary)]", e.Destructive = "stroke-[var(--color-fill-error-primary)]", e;
}({}), uu = ({ size: e = bt.Medium, variant: t = "stroke-[var(--color-fill-basic-primary)]", strokeWidth: n = 2, className: r = "", ...i }) => {
	let a = fi().replace(/:/g, ""), o = `circular-loader-mask-${a}`, s = `circular-loader-gradient-${a}`, c = 12 - n / 2;
	return /* @__PURE__ */ X("div", {
		className: I("inline-flex w-fit h-fit animate-spin", r),
		...i,
		children: /* @__PURE__ */ Z("svg", {
			width: e - 2,
			height: e - 2,
			viewBox: "0 0 24 24",
			fill: "none",
			xmlns: "http://www.w3.org/2000/svg",
			children: [/* @__PURE__ */ Z("defs", { children: [/* @__PURE__ */ Z("linearGradient", {
				id: s,
				x1: "0",
				y1: "0",
				x2: "0",
				y2: "1",
				children: [/* @__PURE__ */ X("stop", {
					offset: "0",
					stopColor: "white",
					stopOpacity: "1"
				}), /* @__PURE__ */ X("stop", {
					offset: "1",
					stopColor: "white",
					stopOpacity: "0"
				})]
			}), /* @__PURE__ */ Z("mask", {
				id: o,
				maskUnits: "userSpaceOnUse",
				children: [/* @__PURE__ */ X("rect", {
					x: "0",
					y: "0",
					width: "12",
					height: "24",
					fill: "white"
				}), /* @__PURE__ */ X("rect", {
					x: "12",
					y: "0",
					width: "12",
					height: "24",
					fill: `url(#${s})`
				})]
			})] }), /* @__PURE__ */ X("circle", {
				cx: "12",
				cy: "12",
				r: c,
				fill: "none",
				strokeWidth: n,
				strokeLinecap: "round",
				mask: `url(#${o})`,
				className: t
			})]
		})
	});
};
uu.Size = bt, uu.Variant = lu;
// src/app/atoms/loader/ProgressLoader.tsx
var du = ({ active: e = !1, className: t = "" }) => /* @__PURE__ */ X("div", {
	className: I("h-px w-full overflow-hidden transition-opacity duration-150", e ? "opacity-100" : "opacity-0", t),
	children: /* @__PURE__ */ X("div", { className: "h-full w-full rounded-full bg-[var(--color-fill-basic-primary)] animate-progress" })
}), fu = "M121.021 9.70276e-06C121.635 0.00562721 122.201 0.336563 122.507 0.870577L135.925 24.2549C136.063 24.7077 136.011 25.2039 135.77 25.6245C123.798 46.5422 95.5972 95.432 95.5972 95.432C95.2748 95.7673 94.8263 95.9633 94.35 95.9633C94.35 95.9633 41.4186 95.9998 14.9471 96C14.327 96 13.7541 95.6678 13.4452 95.1289L0.251482 72.1142C-0.109585 71.4843 -0.0743152 70.5531 0.308855 69.8878C0.308855 69.8878 26.8205 24.1272 39.9734 1.1421C40.3239 0.529539 40.9631 0.0326747 41.6869 0.0326651C41.6869 0.0331171 121.021 9.70276e-06 121.021 9.70276e-06ZM17.9867 92.5287H38.3062L28.0888 74.8628L17.9867 92.5287ZM71.4405 92.4921H91.3571L81.3833 75.1488L71.4405 92.4921ZM44.4776 92.3253H64.8395L54.7068 74.6392L44.4776 92.3253ZM94.3943 90.7219L104.699 72.9047H84.1208L94.3943 90.7219ZM31.4008 73.0222L41.4435 90.5842L51.4972 73.0222H31.4008ZM84.704 69.3835H104.622L94.6593 51.9934L84.704 69.3835ZM31.5361 69.3112H51.9053L41.7633 51.595L31.5361 69.3112ZM107.678 67.7382L117.965 49.7693H97.3917L107.678 67.7382ZM98.0384 46.2393H117.945L107.94 28.9421L98.0384 46.2393ZM120.957 44.5242L131.277 26.4965H110.637L120.957 44.5242ZM68.3422 44.1304L78.6021 26.3231H58.0823L68.3422 44.1304ZM110.648 23.0128H131.258L120.976 5.23426L110.648 23.0128ZM58.1921 22.8519H78.4107L68.3014 5.46138L58.1921 22.8519ZM55.0653 21.3342L65.4303 3.50386H44.7004L55.0653 21.3342ZM81.5178 21.3003L91.8827 3.46996H71.1528L81.5178 21.3003Z", pu = "M153.045 9.30753e-05C153.475 0 153.734 0.165348 153.935 0.513892C156.659 5.22122 159.463 9.99634 162.212 14.7289L170.478 0.496114C170.663 0.188622 170.997 1.01676e-06 171.357 0C189.161 0.00012553 206.964 0.0226173 224.768 0.0226173C225.263 0.0226173 225.641 0.126836 225.863 0.498976L234.863 16.1296C235.046 16.4462 235.045 16.8479 234.863 17.1649L208.298 63.4387C208.131 63.7127 207.797 64 207.444 64C207.444 64 171.362 63.9773 153.308 63.9774C152.95 63.9774 152.567 63.7127 152.417 63.4632L144.303 49.3669L136.244 63.3367C136.08 63.5817 135.817 63.9484 135.411 63.9484C135.411 63.9484 96.8361 63.9773 81.4848 63.9773C81.4838 63.9773 81.4828 63.9773 81.4819 63.9773C81.479 63.9773 81.4762 63.9774 81.4734 63.9774C81.1058 63.9774 80.7662 63.7813 80.5831 63.4632L72.7738 49.8976L64.8804 63.4892C64.6968 63.8053 64.3583 64 63.9921 64C63.9921 64 27.959 63.9802 9.97191 63.9803C9.6043 63.9803 9.26474 63.7841 9.08163 63.4661L0.136438 47.9273C-0.0460772 47.6102 -0.0454374 47.2201 0.138117 46.9037C0.13793 46.9037 26.9095 0.698576 26.9095 0.698576C27.1378 0.308359 27.4681 0.0248531 27.9419 0.0248511C45.8728 0.0248511 81.7347 0 81.7347 0C82.1599 1.62705e-08 82.6177 0.296445 82.8391 0.692247L90.6841 14.2006L98.6433 0.496114C98.8288 0.188622 99.1624 1.01676e-06 99.5229 0C117.363 0.000125786 135.204 2.31608e-05 153.045 9.30753e-05ZM48.0609 61.9748H61.9268L54.9897 49.9265L48.0609 61.9748ZM191.465 61.9508H205.669L198.567 49.6279L191.465 61.9508ZM11.7777 61.9311H26.0793L18.9273 49.4798L11.7777 61.9311ZM83.2587 61.9282H97.5671L90.4129 49.5006L83.2587 61.9282ZM101.147 61.9282H115.448L108.296 49.4771L101.147 61.9282ZM29.906 61.7949H43.9006L36.9004 49.6222L29.906 61.7949ZM119.275 61.7921H133.27L126.269 49.6193L119.275 61.7921ZM63.9921 60.9321L71.1556 48.5974H56.8286L63.9921 60.9321ZM99.3581 60.8662L106.512 48.4386H92.2039L99.3581 60.8662ZM135.263 60.8448L142.361 48.5974H128.218L135.263 60.8448ZM27.8172 60.7005L34.7728 48.6002H20.7913L27.8172 60.7005ZM207.524 60.6894L214.566 48.4386H200.481L207.524 60.6894ZM20.8834 46.3924H35.0459L27.9937 34.1242L20.8834 46.3924ZM182.087 46.3895H196.249L189.197 34.1219L182.087 46.3895ZM164.037 46.3895H178.359L171.198 34.0343L164.037 46.3895ZM57.0693 46.2307H70.9708L64.0186 34.1364L57.0693 46.2307ZM128.29 46.2307H142.191L135.239 34.1364L128.29 46.2307ZM200.484 46.1626H214.258L207.38 34.1969L200.484 46.1626ZM180.223 45.5056L187.395 33.0359H173.05L180.223 45.5056ZM198.194 45.3711L205.285 33.0359H191.041L198.194 45.3711ZM216.337 45.3669L223.425 33.0359H209.23L216.337 45.3669ZM144.355 45.1453L151.299 33.0359H137.389L144.355 45.1453ZM72.8971 44.7322L79.6799 33.0359H66.1684L72.8971 44.7322ZM65.8535 30.9867H79.973L72.9494 18.7682L65.8535 30.9867ZM101.228 30.9867H115.536L108.378 18.7232L101.228 30.9867ZM137.09 30.9867H151.194L144.196 18.813L137.09 30.9867ZM173.063 30.9867H187.369L180.212 18.7239L173.063 30.9867ZM191.078 30.9867H205.279L198.165 18.6904L191.078 30.9867ZM209.219 30.9867H223.294L216.257 18.7753L209.219 30.9867ZM45.8569 29.9615L52.9107 17.7693H38.8302L45.8569 29.9615ZM207.059 29.9591L214.112 17.7693H200.034L207.059 29.9591ZM153.161 29.9309L160.23 17.6333H146.019L153.161 29.9309ZM117.363 29.9065L124.388 17.7693H110.287L117.363 29.9065ZM189.197 29.9058L196.222 17.7693H182.121L189.197 29.9058ZM225.16 29.8901L232.198 17.6787H218.122L225.16 29.8901ZM81.7234 29.5569L88.6482 17.6333H74.7987L81.7234 29.5569ZM38.6257 15.587H52.7652L45.7468 3.38717L38.6257 15.587ZM74.7873 15.5841H89.1142L81.9508 3.24932L74.7873 15.5841ZM146.008 15.5841H160.335L153.171 3.24932L146.008 15.5841ZM217.88 15.4026H232.084L224.982 3.0797L217.88 15.4026ZM164.21 15.3754L174.931 9.22166L171.357 3.06792L164.21 15.3754ZM92.4047 15.3247L103.071 9.17803L99.5229 3.06792L92.4047 15.3247ZM215.969 14.4006L223.101 2.07176H208.836L215.969 14.4006ZM54.7173 14.3916L61.9217 2.04914H47.5129L54.7173 14.3916ZM144.055 14.3915L151.259 2.04905H136.85L144.055 14.3915ZM36.917 14.3898L43.9936 2.07399H29.7281L36.917 14.3898ZM176.746 8.2023L187.531 2.04914H173.155L176.746 8.2023ZM104.85 8.15332L115.695 2.0491H101.305L104.85 8.15332Z", mu = ({ height: e = 20, markOnly: t = !1, className: n = "" }) => t ? /* @__PURE__ */ X("svg", {
	height: e,
	viewBox: "0 0 136 96",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	className: n,
	role: "img",
	"aria-label": "NAC",
	children: /* @__PURE__ */ X("path", {
		fill: "currentColor",
		d: fu
	})
}) : /* @__PURE__ */ X("svg", {
	height: e,
	viewBox: "0 0 235 64",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	className: n,
	role: "img",
	"aria-label": "NAC",
	children: /* @__PURE__ */ X("path", {
		fill: "currentColor",
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: pu
	})
}), hu = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), gu = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), _u = {
	info: "bg-info-primary text-info-primary border-info-primary",
	error: "bg-error-primary text-error-primary border-error-primary",
	danger: "bg-danger-primary text-danger-primary border-danger-primary",
	success: "bg-success-primary text-success-primary border-success-primary"
}, vu = {
	info: H.Info,
	error: H.Danger,
	danger: H.Danger,
	success: H.CheckCircle
}, yu = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, bu = {
	small: "p-2 gap-2",
	medium: "p-3 gap-2",
	large: "p-4 gap-3"
}, xu = {
	small: "label-micro",
	medium: "label-small",
	large: "label-medium"
}, Su = {
	small: "text-micro",
	medium: "text-small",
	large: "text-medium"
}, Cu = {
	small: 16,
	medium: 20,
	large: 24
}, wu = ({ title: e, variant: t = "info", size: n = "small", className: r = "", children: i, ...a }) => /* @__PURE__ */ Z("div", {
	className: I("flex rounded-[4px] border", _u[t], bu[n], r),
	...a,
	children: [/* @__PURE__ */ X(R, {
		iconName: vu[t],
		size: Cu[n],
		color: yu[t],
		className: "shrink-0"
	}), /* @__PURE__ */ Z("div", {
		className: "flex-1 min-w-0 flex flex-col gap-1",
		children: [e ? /* @__PURE__ */ X("div", {
			className: xu[n],
			children: e
		}) : null, i ? /* @__PURE__ */ X("div", {
			className: I("opacity-80", Su[n]),
			children: i
		}) : null]
	})]
});
wu.Variant = hu, wu.Size = gu;
// src/app/atoms/model-pill/index.tsx
var Tu = /* @__PURE__ */ function(e) {
	return e[e.Small = 20] = "Small", e[e.Medium = 28] = "Medium", e;
}({}), Eu = {
	28: "text-base !leading-7",
	20: "text-sm !leading-5"
}, Du = ({ size: e = 20, className: t = "", children: n, ...r }) => /* @__PURE__ */ X("span", {
	className: I("code min-w-0 truncate font-medium !tracking-normal text-basic-primary", Eu[e], t),
	...r,
	children: n
});
Du.Size = Tu;
// src/app/atoms/number-input/index.tsx
var Ou = {
	[Q.Small]: U.Small,
	[Q.Medium]: U.Medium,
	[Q.Large]: U.Large
}, ku = (e, t, n) => Math.min(Math.max(e, t), n), Au = ({ value: e, onChange: t, min: n = 0, max: r = 2 ** 53 - 1, step: i = 1, size: a = Q.Medium, disabled: o = !1, className: s = "", "aria-label": c }) => {
	let [l, u] = J(String(e)), [d, f] = J(e);
	d !== e && (f(e), u(String(e)));
	let p = () => {
		let i = Number(l);
		if (l.trim() === "" || Number.isNaN(i)) {
			u(String(e));
			return;
		}
		let a = ku(i, n, r);
		u(String(a)), a !== e && t(a);
	}, m = (i) => {
		let a = ku(e + i, n, r);
		a !== e && t(a);
	};
	return /* @__PURE__ */ Z("div", {
		className: I("flex items-center gap-2 w-fit", s),
		children: [
			/* @__PURE__ */ X(z, {
				variant: B.Secondary,
				size: Ou[a],
				content: g.Icon,
				disabled: o || e <= n,
				"aria-label": "Decrease",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => m(-i),
				children: /* @__PURE__ */ X(R, { iconName: H.Remove })
			}),
			/* @__PURE__ */ X("input", {
				type: "text",
				inputMode: "numeric",
				role: "spinbutton",
				"aria-label": c,
				"aria-valuenow": e,
				"aria-valuemin": n,
				"aria-valuemax": r,
				className: I("input rounded-[4px] text-center w-16 px-1 font-normal", a, o && "input-disabled"),
				value: l,
				disabled: o,
				onChange: (e) => u(e.target.value),
				onBlur: p,
				onKeyDown: (e) => {
					e.key === "Enter" && (e.preventDefault(), p()), e.key === "ArrowUp" && (e.preventDefault(), m(i)), e.key === "ArrowDown" && (e.preventDefault(), m(-i));
				}
			}),
			/* @__PURE__ */ X(z, {
				variant: B.Secondary,
				size: Ou[a],
				content: g.Icon,
				disabled: o || e >= r,
				"aria-label": "Increase",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => m(i),
				children: /* @__PURE__ */ X(R, { iconName: H.Add })
			})
		]
	});
}, ju = ({ page: e, pageSize: t, totalItems: n, onPageChange: r, itemLabel: i = "items", className: a = "" }) => {
	let o = N(), s = Math.max(1, Math.ceil(n / t)), c = n === 0 ? 0 : (e - 1) * t + 1, l = Math.min(e * t, n);
	return /* @__PURE__ */ Z("div", {
		className: I("flex items-center w-full gap-4 px-4 py-3", o ? "justify-center" : "justify-between", a),
		children: [o ? null : /* @__PURE__ */ Z("div", {
			className: "label-small text-basic-secondary",
			children: [
				c,
				"–",
				l,
				" of ",
				n,
				" ",
				i
			]
		}), /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-3",
			children: [
				/* @__PURE__ */ X(z, {
					variant: B.Tertiary,
					size: U.Small,
					content: g.Icon,
					disabled: e <= 1,
					"aria-label": "Previous page",
					onClick: () => r(e - 1),
					children: /* @__PURE__ */ X(R, { iconName: H.Left })
				}),
				/* @__PURE__ */ Z("div", {
					className: "label-small text-basic-secondary",
					children: [
						"Page ",
						e,
						" of ",
						s
					]
				}),
				/* @__PURE__ */ X(z, {
					variant: B.Tertiary,
					size: U.Small,
					content: g.Icon,
					disabled: e >= s,
					"aria-label": "Next page",
					onClick: () => r(e + 1),
					children: /* @__PURE__ */ X(R, { iconName: H.Right })
				})
			]
		})]
	});
}, Mu = 6, Nu = 36;
function Pu(e) {
	let t = String(e ?? ""), n = 2166136261;
	for (let e = 0; e < t.length; e += 1) n ^= t.charCodeAt(e), n = Math.imul(n, 16777619) >>> 0;
	return n >>> 0;
}
function Fu(e) {
	let t = e >>> 0 || 2654435769;
	return () => (t = (t ^ t << 13) >>> 0, t = (t ^ t >>> 17) >>> 0, t = (t ^ t << 5) >>> 0, t);
}
function Iu(e) {
	return `hsl(${Pu(e) % 360} 75% 50%)`;
}
function Lu(e) {
	let t = e % Mu, n = (e - t) / Mu, r = [];
	return n > 0 && r.push(e - Mu), n < 5 && r.push(e + Mu), t > 0 && r.push(e - 1), t < 5 && r.push(e + 1), r;
}
function Ru(e) {
	let t = Array.from({ length: Nu }, () => !1), n = [];
	for (let e = 0; e < Nu; e += 1) {
		let t = e % Mu, r = (e - t) / Mu;
		(r === 0 || t === 0 || r === 5 || t === 5) && n.push(e);
	}
	let r = 4 + e() % 5, i = 0;
	for (; i < r && n.length > 0;) {
		let r = e() % 2 == 0 ? n.length - 1 : e() % n.length, a = n.splice(r, 1)[0];
		if (!t[a]) {
			t[a] = !0, i += 1;
			for (let e of Lu(a)) !t[e] && !n.includes(e) && n.push(e);
		}
	}
	return t;
}
function zu(e) {
	let t = Fu(Pu(e)), n = Ru(t), r = [];
	for (let e = 0; e < Nu; e += 1) r.push(n[e] ? 0 : t() % 7 < 4 ? 1 : 2);
	return r;
}
var Bu = 40, Vu = 1.5;
function Hu(e) {
	let t = Math.max(1, Vu * e / Bu);
	return t * Mu / (e - t);
}
var Uu = ({ id: e, size: t = 40, isRunning: n = !1, className: r = "", ...i }) => {
	let a = Iu(e), o = zu(e), s = Hu(t), c = s / 2;
	return /* @__PURE__ */ X("svg", {
		className: I("block shrink-0", n && "pulse-dim", r),
		width: t,
		height: t,
		viewBox: `${-c} ${-c} ${Mu + s} ${Mu + s}`,
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		"aria-hidden": "true",
		...i,
		children: o.map((e, t) => e === 0 ? null : /* @__PURE__ */ X("rect", {
			x: t % Mu,
			y: Math.floor(t / Mu),
			width: "1",
			height: "1",
			fill: e === 2 ? a : "none",
			stroke: a,
			strokeWidth: s
		}, t))
	});
}, Wu = /* @__PURE__ */ function(e) {
	return e.Project = "project", e.Orphan = "orphan", e;
}({}), Gu = ({ entityId: e, name: t, variant: n = "project", active: r = !1, running: i = !1, trailing: a, isMobile: o = !1, actions: s, className: c = "", type: l = "button", ...u }) => /* @__PURE__ */ Z("div", {
	className: I("group flex items-center min-w-0 rounded-[4px] hover:bg-btn-ghost-hovered", o ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1", r && "bg-btn-ghost-highlighted", c),
	children: [
		/* @__PURE__ */ Z("button", {
			type: l,
			className: I("flex flex-1 items-center min-w-0 text-left", o ? "gap-3" : "gap-1.5"),
			...u,
			children: [n === "orphan" ? /* @__PURE__ */ X(Za, {
				size: o ? 20 : 24,
				isRunning: i
			}) : /* @__PURE__ */ X(Uu, {
				id: e,
				size: o ? 20 : 24,
				isRunning: i,
				className: "rounded-[2px]"
			}), /* @__PURE__ */ X("span", {
				className: I("flex-1 truncate", o ? "label-medium" : "label-small", i ? "text-shimmer-basic" : o ? "text-btn-secondary" : "text-basic-primary"),
				children: t
			})]
		}),
		a ? /* @__PURE__ */ X("span", {
			className: I("shrink-0 label-micro text-basic-muted", s && !o && "group-hover:hidden group-has-[:focus-visible]:hidden"),
			children: a
		}) : null,
		s ? /* @__PURE__ */ X("div", {
			className: I("items-center shrink-0", o ? "flex gap-3" : "hidden gap-1.5 group-hover:flex group-has-[:focus-visible]:flex"),
			children: s
		}) : null
	]
});
Gu.Variant = Wu;
// src/app/atoms/radio/index.tsx
var Ku = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ Z("label", {
	className: I("group flex w-fit items-center gap-2", n ? "cursor-not-allowed" : "cursor-pointer", i),
	children: [/* @__PURE__ */ Z("span", {
		className: "relative flex size-4 shrink-0 items-center justify-center",
		children: [
			/* @__PURE__ */ X("input", {
				type: "radio",
				checked: e,
				onChange: (e) => t(e.target.checked),
				disabled: n,
				className: "peer sr-only",
				...a
			}),
			/* @__PURE__ */ X("span", {
				"aria-hidden": "true",
				className: I("size-4 rounded-full border shadow-concave", n ? I("bg-btn-secondary-disabled", e ? "border-primary" : "border-muted") : "border-primary bg-btn-secondary group-hover:bg-btn-secondary-hovered group-active:bg-btn-secondary-pressed")
			}),
			e ? /* @__PURE__ */ X("span", {
				"aria-hidden": "true",
				className: I("pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-convex", n ? "radio-mark-disabled" : "radio-mark")
			}) : null,
			/* @__PURE__ */ X("span", {
				"aria-hidden": "true",
				className: "pointer-events-none absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-border-focus-outline)] opacity-0 peer-focus-visible:opacity-100"
			})
		]
	}), r ? /* @__PURE__ */ X("span", {
		className: I("label-small", n ? "text-basic-muted" : "text-basic-primary"),
		children: r
	}) : null]
}), qu = (e, t, n) => Math.min(Math.max(e, t), n), Ju = ({ min: e, max: t, value: n, onChange: r, step: i = 1, disabled: a = !1, label: o, smallKnob: s = !1, className: c = "" }) => {
	let l = q(null), [u, d] = J(!1), [f, p] = J(!1), m = !a && (u || f), h = W((a) => {
		let o = qu(Math.round(a / i) * i, e, t), s = Number(o.toFixed(4));
		s !== n && r(s);
	}, [
		i,
		e,
		t,
		n,
		r
	]), g = W((n) => {
		let r = l.current;
		if (!r) return;
		let i = r.getBoundingClientRect();
		if (i.width === 0) return;
		let a = qu((n - i.left) / i.width, 0, 1);
		h(e + a * (t - e));
	}, [
		h,
		e,
		t
	]), _ = (e) => {
		if (!a) {
			d(!0);
			try {
				e.currentTarget.setPointerCapture(e.pointerId);
			} catch {}
			g(e.clientX);
		}
	}, v = (e) => {
		a || e.currentTarget.hasPointerCapture(e.pointerId) && g(e.clientX);
	}, y = () => d(!1), b = (r) => {
		if (a) return;
		let o = r.key === "ArrowLeft" || r.key === "ArrowDown" ? -i : r.key === "ArrowRight" || r.key === "ArrowUp" ? i : 0;
		o ? (r.preventDefault(), p(!0), h(n + o)) : (r.key === "Home" && (r.preventDefault(), p(!0), h(e)), r.key === "End" && (r.preventDefault(), p(!0), h(t)));
	}, x = t === e ? 0 : (n - e) / (t - e) * 100;
	return /* @__PURE__ */ Z("div", {
		ref: l,
		role: "slider",
		tabIndex: a ? -1 : 0,
		"aria-label": o ?? "Range",
		"aria-valuemin": e,
		"aria-valuemax": t,
		"aria-valuenow": n,
		"aria-disabled": a,
		className: I("range-input relative w-full touch-none select-none", s && "range-input-small", a ? "cursor-not-allowed" : "cursor-pointer", c),
		onPointerDown: _,
		onPointerMove: v,
		onPointerUp: y,
		onPointerCancel: y,
		onKeyDown: b,
		onKeyUp: () => p(!1),
		onBlur: () => {
			d(!1), p(!1);
		},
		children: [
			/* @__PURE__ */ X("div", { className: I("pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full", m ? "bg-input-progress-bar" : "bg-input-progress-bar-disabled") }),
			/* @__PURE__ */ X("div", {
				className: I("pointer-events-none absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full", m ? "bg-input-progress" : "bg-input-progress-disabled"),
				style: { width: `${x}%` }
			}),
			/* @__PURE__ */ X("div", {
				className: I("range-knob absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", a ? "bg-input-knob-disabled" : "bg-input-knob"),
				style: { left: `${x}%` }
			})
		]
	});
}, Yu = {
	[U.Small]: Bi.Small,
	[U.Medium]: Bi.Medium,
	[U.Large]: Bi.Large
}, Xu = ({ items: e = [], value: t, onValueChange: n, size: r = U.Medium, itemSize: i, variant: a = B.Secondary, placement: o = M.BottomRight, placeholder: s = "Select...", disabled: c = !1, sticky: l = !1, floating: u = !1, triggerLabel: d, className: f = "", trailingIcon: p = H.Down, triggerClassName: m = "", panelClassName: h = "", onOpenChange: _ }) => {
	let [v, y] = J(!1), b = e.find((e) => e.id === t), S = i ?? Yu[r], C = (e) => {
		y(e), _?.(e);
	}, w = (e) => {
		n?.(e), C(!1);
	}, T = {
		variant: a,
		disabled: c,
		content: p ? g.IconRight : g.Text,
		onClick: () => !c && C(!v),
		"aria-expanded": v
	}, E = `${m} overflow-hidden max-w-full`, D = /* @__PURE__ */ Z(Y, { children: [
		b?.icon && d === void 0 ? /* @__PURE__ */ X(R, { iconName: b.icon }) : null,
		/* @__PURE__ */ X("span", {
			className: "text-left flex-grow truncate md:max-w-full",
			children: d ?? b?.label ?? s
		}),
		p ? /* @__PURE__ */ X(R, {
			iconName: p,
			className: I(p === H.Down && "transition-transform duration-150 ease-out", p === H.Down && (v ? "rotate-180" : "rotate-0"))
		}) : null
	] });
	return /* @__PURE__ */ X(x, {
		open: v,
		onClose: () => C(!1),
		placement: o,
		size: l ? Le.Fit : "min-w-full",
		sticky: l,
		className: f,
		panelClassName: h,
		content: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-1 px-2 md:px-0",
			children: e.map((e) => /* @__PURE__ */ Z(Ui, {
				size: S,
				variant: Vi.Regular,
				active: e.id === t,
				hoverHint: e.hoverHint,
				onClick: () => w(e.id),
				children: [e.icon ? /* @__PURE__ */ X(R, { iconName: e.icon }) : null, /* @__PURE__ */ X("span", {
					className: "text-left flex-grow",
					children: e.label
				})]
			}, e.id))
		}),
		children: u ? /* @__PURE__ */ X(Zr, {
			...T,
			buttonClassName: E,
			children: D
		}) : /* @__PURE__ */ X(z, {
			...T,
			size: r,
			className: E,
			children: D
		})
	});
}, Zu = "M95 64.7797H79.5544V78.0484H95V96H0V31.2203H61.7894V0H95V64.7797ZM33.2129 93.6586H46.3415V80.3898H33.2129V93.6586ZM48.6585 93.6586H61.7894V80.3898H48.6585V93.6586ZM79.5544 93.6586H92.6829V80.3898H79.5544V93.6586ZM2.31707 78.0484H15.4479V64.7797H2.31707V78.0484ZM17.765 78.0484H30.8936V49.1718H17.765V78.0484ZM33.2106 78.0484H46.3415V64.7797H33.2106V78.0484ZM2.31707 62.4383H15.4479V49.1718H2.31707V62.4383ZM48.6585 62.4383H61.7894V49.1718H48.6585V62.4383ZM64.1064 62.4383H77.235V49.1718H64.1064V62.4383ZM79.5544 62.4383H92.6829V49.1718H79.5544V62.4383ZM17.765 46.8304H30.8936V33.5617H17.765V46.8304ZM33.2129 46.8282H46.3415V33.5617H33.2129V46.8282ZM79.5544 46.8282H92.6829V33.5617H79.5544V46.8282ZM64.1064 31.2203H77.235V17.9516H64.1064V31.2203ZM64.1064 15.6101H77.235V2.34141H64.1064V15.6101ZM79.5544 15.6101H92.6829V2.34141H79.5544V15.6101Z", Qu = "M48.6585 17.9516H0V0H48.6585V17.9516ZM2.31707 15.6101H15.4479V2.34141H2.31707V15.6101ZM17.765 15.6101H30.8936V2.34141H17.765V15.6101Z", $u = ({ className: e = "" }) => /* @__PURE__ */ Z("svg", {
	width: 95,
	height: 96,
	viewBox: "0 0 95 96",
	xmlns: "http://www.w3.org/2000/svg",
	className: I("fill-basic-muted", e),
	"aria-hidden": !0,
	children: [/* @__PURE__ */ X("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: Zu
	}), /* @__PURE__ */ X("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: Qu
	})]
}), ed = /* @__PURE__ */ function(e) {
	return e.Muted = "muted", e.Tertiary = "tertiary", e.Secondary = "secondary", e.Primary = "primary", e;
}({}), td = /* @__PURE__ */ function(e) {
	return e.Horizontal = "horizontal", e.Vertical = "vertical", e;
}({}), nd = ({ variant: e = "muted", label: t, orientation: n = "horizontal", width: r, height: i, className: a = "", ...o }) => {
	let s = () => {
		switch (e) {
			case "primary": return "bg-divider-primary";
			case "secondary": return "bg-divider-secondary";
			case "tertiary": return "bg-divider-tertiary";
			default: return "bg-divider-muted";
		}
	}, c = () => {
		switch (e) {
			case "primary": return "text-basic-primary";
			case "secondary": return "text-basic-secondary";
			case "tertiary": return "text-basic-tertiary";
			default: return "text-basic-muted";
		}
	}, l = s(), u = c(), { style: d, ...f } = o;
	if (n === "vertical") {
		let e = { ...d };
		return i && (e.height = i), r && (e.width = r), /* @__PURE__ */ X("div", {
			className: `h-full w-px ${l} ${a}`,
			style: e,
			...f
		});
	}
	if (t) {
		let e = { ...d };
		return r && (e.width = r), i && (e.height = i), /* @__PURE__ */ Z("div", {
			className: `flex items-center gap-2 w-full ${a}`,
			style: e,
			...f,
			children: [/* @__PURE__ */ X("span", {
				className: `label-micro ${u} whitespace-nowrap`,
				children: t
			}), /* @__PURE__ */ X("div", { className: `flex-1 h-[1px] min-h-[1px] max-h-[1px] ${l}` })]
		});
	}
	let p = { ...d };
	return r && (p.width = r), i && (p.height = i), /* @__PURE__ */ X("div", {
		className: `h-[1px] min-h-[1px] max-h-[1px] w-full ${l} ${a}`,
		style: p,
		...f
	});
};
nd.Variant = ed, nd.Orientation = td;
// src/app/atoms/subagent-transcript-card/index.tsx
var rd = /* @__PURE__ */ function(e) {
	return e.Ready = "ready", e.Running = "running", e.Failed = "failed", e.NotFound = "not-found", e;
}({}), id = {
	ready: "text-basic-primary",
	running: "text-shimmer-basic",
	failed: "text-basic-primary",
	"not-found": "text-basic-muted"
}, ad = {
	ready: null,
	running: "running",
	failed: "failed",
	"not-found": null
}, od = I("pointer-events-auto relative z-10 flex h-7 min-w-0 items-center gap-1 rounded-[4px] p-1 label-micro", "text-btn-secondary hover:text-btn-secondary-hovered active:text-btn-secondary-pressed", "[&_path]:fill-btn-secondary hover:[&_path]:fill-btn-secondary-hovered active:[&_path]:fill-btn-secondary-pressed", "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2");
function sd({ status: e, behavior: t, lineage: n, showBehaviorIcon: r }) {
	switch (e) {
		case "running": return /* @__PURE__ */ X(ka, { size: da.Medium });
		case "failed": return /* @__PURE__ */ X(R, {
			iconName: H.Close,
			size: 20,
			"aria-hidden": !0,
			className: "shrink-0 text-error-primary"
		});
		case "not-found": return /* @__PURE__ */ X(R, {
			iconName: H.Close,
			size: 20,
			"aria-hidden": !0,
			className: "shrink-0 [&_path]:fill-btn-secondary-disabled"
		});
		default: return r ? /* @__PURE__ */ X(Va, {
			behavior: t,
			lineage: n,
			size: za.Medium,
			className: "[&_path]:fill-btn-secondary"
		}) : null;
	}
}
var cd = ({ title: e, status: t, statusLabel: n, error: r, behavior: i, lineage: a, showBehaviorIcon: o, onOpen: s, sessionHref: c, onSessionLinkClick: l, className: u }) => {
	let d = fi(), f = t === "not-found", p = !f && s != null, m = f ? null : c || null, h = f ? void 0 : n, g = t === "failed" && r?.trim() || null, _ = t === "failed" && h ? h.toLowerCase() : ad[t], v = t === "ready" && o ? Na(i, a) : null, y = [
		`Open ${e} in Subagents`,
		v,
		_
	].filter(Boolean).join(", ");
	return /* @__PURE__ */ Z("div", {
		title: f ? void 0 : e,
		className: I("relative isolate flex w-[320px] max-w-full min-w-0 flex-col gap-4 rounded-[4px] p-3", "bg-elevation-level-1 shadow-convex", "-outline-offset-2 outline-[var(--color-border-focus-outline)] has-[>button:focus-visible]:outline-2", u),
		children: [
			p ? /* @__PURE__ */ X("button", {
				type: "button",
				"aria-label": y,
				"aria-describedby": g ? d : void 0,
				onClick: s,
				className: "absolute inset-0 rounded-[4px] outline-none hover:bg-btn-ghost-hovered active:bg-btn-ghost-pressed"
			}) : null,
			/* @__PURE__ */ Z("div", {
				className: I("relative flex min-w-0 items-start gap-2.5 p-1", p && "pointer-events-none"),
				children: [
					/* @__PURE__ */ X(sd, {
						status: t,
						behavior: i,
						lineage: a,
						showBehaviorIcon: o
					}),
					/* @__PURE__ */ Z("div", {
						className: "flex min-w-0 flex-1 flex-col gap-1",
						children: [/* @__PURE__ */ X("span", {
							className: I("truncate label-small", id[t]),
							children: f ? "Not found" : e
						}), g ? /* @__PURE__ */ X("p", {
							id: d,
							title: g,
							className: "line-clamp-3 text-xs break-words text-error-primary",
							children: g
						}) : null]
					}),
					v && !p ? /* @__PURE__ */ Z("span", {
						className: "sr-only",
						children: [", ", v]
					}) : null
				]
			}),
			f ? /* @__PURE__ */ X("div", {
				className: "relative flex h-7 min-w-0 items-center justify-end p-1",
				children: /* @__PURE__ */ X("span", {
					className: "truncate text-xs text-basic-muted",
					children: "No session found"
				})
			}) : h || m ? /* @__PURE__ */ Z("div", {
				className: I("relative flex h-7 min-w-0 items-center justify-end gap-1", p && "pointer-events-none"),
				children: [h ? /* @__PURE__ */ X("span", {
					className: "min-w-0 truncate px-1 text-xs text-basic-muted",
					children: h
				}) : null, m ? /* @__PURE__ */ Z("a", {
					href: m,
					onClick: l,
					"aria-label": `Go to session ${e}`,
					className: od,
					children: [/* @__PURE__ */ X("span", {
						className: "truncate",
						children: "Go to session"
					}), /* @__PURE__ */ X(R, {
						iconName: H.Right,
						size: 16,
						"aria-hidden": !0,
						className: "shrink-0"
					})]
				}) : null]
			}) : null
		]
	});
}, ld = /* @__PURE__ */ function(e) {
	return e.Medium = "medium", e.Large = "large", e;
}({}), ud = {
	medium: "h-4 w-8",
	large: "h-5 w-10"
}, dd = {
	medium: "top-0.5 left-0.5 size-3",
	large: "top-0.5 left-[3px] size-4"
}, fd = {
	medium: "translate-x-4",
	large: "translate-x-[18px]"
}, pd = ({ checked: e = !1, disabled: t = !1, onChange: n, size: r = "medium", className: i = "", ...a }) => /* @__PURE__ */ X("button", {
	type: "button",
	role: "switch",
	"aria-checked": e,
	disabled: t,
	onClick: () => !t && n?.(!e),
	className: I("relative shrink-0 rounded-full shadow-convex transition-colors duration-150", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]", ud[r], t ? I("cursor-not-allowed", e ? "bg-input-switcher-active-disabled" : "bg-input-switcher-disabled") : I("cursor-pointer", e ? "bg-input-switcher-active" : "bg-input-switcher"), i),
	...a,
	children: /* @__PURE__ */ X("span", { className: I("absolute rounded-full transition-transform duration-150", dd[r], t ? "bg-input-knob-disabled" : e ? "bg-input-knob-active" : "bg-input-knob", e ? fd[r] : "translate-x-0") })
}), md = ({ tags: e, selected: t, onChange: n, disabled: r = !1, className: i = "" }) => {
	let a = (e) => {
		n(t.includes(e) ? t.filter((t) => t !== e) : [...t, e]);
	};
	return /* @__PURE__ */ X("div", {
		className: I("flex flex-wrap gap-2", i),
		children: e.map((e) => {
			let n = t.includes(e);
			return /* @__PURE__ */ X(z, {
				size: U.Small,
				variant: n ? B.SecondaryAccent : B.Secondary,
				disabled: r,
				"aria-pressed": n,
				onClick: () => a(e),
				children: e
			}, e);
		})
	});
}, hd = {
	done: "text-basic-tertiary hover:text-basic-secondary active:text-basic-primary disabled:text-basic-muted",
	live: "text-basic-primary hover:text-basic-secondary active:text-basic-primary disabled:text-basic-muted",
	selected: "text-accent-primary hover:text-accent-secondary active:text-accent-tertiary disabled:text-accent-muted"
}, gd = {
	basic: "[&>path]:fill-basic-tertiary group-hover:[&>path]:fill-basic-secondary group-active:[&>path]:fill-basic-primary group-disabled:[&>path]:fill-basic-muted",
	selected: "[&>path]:fill-accent-primary group-hover:[&>path]:fill-accent-secondary group-active:[&>path]:fill-accent-tertiary group-disabled:[&>path]:fill-accent-muted"
}, _d = "text-shimmer-basic group-hover:animate-none group-hover:bg-none group-hover:text-inherit group-hover:[-webkit-text-fill-color:currentColor] group-active:animate-none group-active:bg-none group-active:text-inherit group-active:[-webkit-text-fill-color:currentColor] group-disabled:animate-none group-disabled:bg-none group-disabled:text-inherit group-disabled:[-webkit-text-fill-color:currentColor] motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-inherit motion-reduce:[-webkit-text-fill-color:currentColor]", vd = ({ label: e, inProgress: t, selected: n = !1, avatarUrl: r, leadingIcon: i, disabled: a = !1, onClick: o, controls: s, className: c = "" }) => {
	let l = n ? hd.selected : t ? hd.live : hd.done, u = n ? gd.selected : gd.basic, d = t && !n, f = q(null);
	return ua(f, d), /* @__PURE__ */ Z("button", {
		type: "button",
		"aria-pressed": n,
		"aria-controls": s,
		disabled: a,
		onClick: o,
		className: I("group relative inline-flex max-w-full items-center gap-2 border-l-2 pl-4 transition-colors", "focus-visible:outline-none disabled:cursor-not-allowed", n ? "border-primary" : "border-muted", l, c),
		children: [
			/* @__PURE__ */ X("span", {
				"aria-hidden": "true",
				className: "pointer-events-none absolute -top-1 -right-1 -bottom-1 -left-1.5 hidden rounded-[4px] border-2 border-[var(--color-border-focus-outline)] group-focus-visible:block"
			}),
			t ? /* @__PURE__ */ X(ka, {
				size: da.Medium,
				variant: n ? fa.Accent : fa.Default,
				className: "group-disabled:opacity-50"
			}) : null,
			/* @__PURE__ */ X("span", {
				ref: f,
				className: I("label-small min-w-0 truncate", d && _d),
				children: e
			}),
			r || i ? /* @__PURE__ */ X("span", {
				"aria-hidden": "true",
				className: "flex size-[20px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-tertiary bg-elevation-level-3 p-px",
				children: r ? /* @__PURE__ */ X("img", {
					src: r,
					alt: "",
					className: "block size-full rounded-full object-cover"
				}) : i ? /* @__PURE__ */ X(R, {
					iconName: i,
					size: 16,
					className: u
				}) : null
			}) : null,
			t ? null : /* @__PURE__ */ X(R, {
				iconName: H.Right,
				size: 20,
				"aria-hidden": !0,
				className: I("shrink-0", u)
			})
		]
	});
};
// src/app/components/projects/GroupLabel.tsx
function yd({ children: e, className: t }) {
	return /* @__PURE__ */ Z("div", {
		className: I("flex items-baseline gap-2", t),
		children: [/* @__PURE__ */ X("span", {
			className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
			children: e
		}), /* @__PURE__ */ X(nd, { className: "shrink" })]
	});
}
// node_modules/effect/dist/esm/Layer.js
var bd = t;
// src/app/hooks/useSessionTitle.ts
function xd() {
	let { data: e = [] } = Zn(), t = Fe(e);
	return (e) => Te(e, t);
}
// src/app/lib/projects.ts
function Sd(e) {
	return e.filter((e) => e.lineage == null);
}
function Cd(e, t) {
	let n = t;
	for (let t of Sd(e)) Rn(t.summary.updated_at) > Rn(n) && (n = t.summary.updated_at);
	return n;
}
function wd(e, t) {
	return Rn(t.summary.updated_at) - Rn(e.summary.updated_at);
}
function Td(e, t) {
	return Sd(e).filter((e) => e.summary.project_id === t).sort(wd)[0] ?? null;
}
function Ed(e, t) {
	return Sd(e).filter((e) => e.summary.project_id === t).sort((e, t) => Rn(t.summary.created_at) - Rn(e.summary.created_at))[0] ?? null;
}
function Dd(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let e of Sd(t)) {
		let t = e.summary.project_id;
		if (!t) continue;
		let r = n.get(t);
		r ? r.push(e) : n.set(t, [e]);
	}
	return e.map((e) => {
		let t = (n.get(e.project_id) ?? []).sort(wd);
		return {
			project: e,
			sessions: t,
			running: t.filter((e) => y(e.active_run)).length,
			totalCostMicros: t.reduce((e, t) => e + (t.summary.total_cost_micros ?? 0), 0),
			updatedAt: Cd(t, e.updated_at)
		};
	});
}
function Od(e) {
	return e.filter((e) => e.lineage == null && !e.summary.project_id).sort((e, t) => c(e.summary, t.summary));
}
function kd(e) {
	return e.kind === "project" ? e.entry.project.project_id : e.session.summary.session_id;
}
function Ad(e, t) {
	return [...Dd(e, t).map((e) => ({
		kind: "project",
		entry: e
	})), ...Od(t).map((e) => ({
		kind: "orphan",
		session: e
	}))];
}
function jd(e, t) {
	return t ? e.find((e) => e.project_id === t) ?? null : null;
}
function Md(e, t) {
	return e.cwd === t.cwd && (e.ssh_host ?? null) === (t.ssh_host ?? null) && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function Nd(e) {
	return {
		cwd: e.cwd,
		ssh_host: e.ssh_host ?? null,
		ssh_port: e.ssh_port ?? null,
		ssh_identity_file: e.ssh_identity_file ?? null
	};
}
function Pd(e, t) {
	return t ? e.find((e) => Md(e, t)) ?? null : null;
}
var Fd = [
	"Pinned",
	"Today",
	"Yesterday",
	"This week",
	"This month",
	"Older"
];
function Id(e) {
	let t = new Date(e);
	return t.setHours(0, 0, 0, 0), t;
}
function Ld(e, t) {
	let n = new Date(e);
	return n.setDate(n.getDate() - t), n.getTime();
}
function Rd(e, t) {
	let n = Rn(e);
	if (!Number.isFinite(n)) return "Older";
	let r = Id(t);
	return n >= r.getTime() ? "Today" : n >= Ld(r, 1) ? "Yesterday" : n >= Ld(r, 7) ? "This week" : n >= Ld(r, 30) ? "This month" : "Older";
}
function zd(e, t, n) {
	let r = /* @__PURE__ */ new Map();
	for (let i of e) {
		let { updatedAt: e, pinned: a } = t(i), o = a ? "Pinned" : Rd(e, n), s = r.get(o);
		s ? s.push(i) : r.set(o, [i]);
	}
	return Fd.flatMap((e) => {
		let t = r.get(e);
		return t && t.length > 0 ? [{
			label: e,
			items: t
		}] : [];
	});
}
// src/app/components/projects/ProjectsList.tsx
var Bd = 6e4;
function Vd({ items: e, activeId: t = null, onOpenProject: n, onOpenSession: r, isMobile: i = !1, renderActions: a, emptyLabel: o = "No projects" }) {
	let s = Jn(Bd), c = xd(), l = K(() => zd(e, (e) => e.kind === "project" ? {
		updatedAt: e.entry.updatedAt,
		pinned: e.entry.project.pinned
	} : {
		updatedAt: e.session.summary.updated_at,
		pinned: !1
	}, s), [e, s]);
	return e.length === 0 ? /* @__PURE__ */ X("div", {
		className: "label-small text-basic-muted px-2 py-1",
		children: o
	}) : /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-8",
		children: l.map((e) => /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ X(yd, {
				className: i ? "px-3" : "px-2",
				children: e.label
			}), /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let o = kd(e), s = a?.(e);
					return e.kind === "project" ? /* @__PURE__ */ X(Gu, {
						entityId: o,
						name: e.entry.project.name,
						active: o === t,
						running: e.entry.running > 0,
						trailing: String(e.entry.sessions.length),
						isMobile: i,
						actions: s,
						onClick: () => n(o)
					}, o) : /* @__PURE__ */ X(Gu, {
						entityId: o,
						name: c(e.session.summary),
						variant: Wu.Orphan,
						active: o === t,
						running: y(e.session.active_run),
						isMobile: i,
						actions: s,
						onClick: () => r(o)
					}, o);
				})
			})]
		}, e.label))
	});
}
// src/app/lib/json.ts
function Hd(e) {
	return Object(e) === e && !Array.isArray(e);
}
// src/app/lib/providerError.ts
function Ud(e) {
	return e instanceof Error || e == null || ct(e) ? e : Object(e) === e ? { status: e.status } : String(e);
}
var Wd = "/api/wallet", Gd = "/admin/workspace/workspace-settings", Kd = "platform.arcee.ai";
function qd(e) {
	return e instanceof Error ? e.message : String(e);
}
function Jd(e, t) {
	let n = e.match(/https:\/\/[^\s"'),]+/), r = Kd;
	if (n) try {
		let { hostname: e } = new URL(n[0]);
		e.endsWith(".arcee.ai") && /^api\d*\./.test(e) && (r = e.replace(/^api(\d*)\./, "platform$1."));
	} catch {}
	return `https://${r}${t}`;
}
function Yd(e, t) {
	let n = /* @__PURE__ */ new Set();
	for (let t of [
		/HTTP (\d{3})/g,
		/\((\d{3}) [A-Z]/g,
		/"code":\s*(\d{3})/g,
		/status[ _]code["']?[:=]\s*(\d{3})/gi
	]) for (let r of e.matchAll(t)) n.add(Number(r[1]));
	return t !== null && n.add(t), n;
}
function Xd(e) {
	let t = e.indexOf("{");
	if (t === -1) return e;
	let n = e.slice(t), r = Zd(n) ?? Qd(n);
	if (r === null) return e;
	let i = e.slice(0, t).trim().replace(/:$/, "");
	return i ? `${i} — ${r}` : r;
}
function Zd(e) {
	try {
		return $d(JSON.parse(e));
	} catch {
		return null;
	}
}
function Qd(e) {
	let t = e.match(/"(?:message|detail|error_description)"\s*:\s*"((?:[^"\\]|\\.)*)/);
	if (!t) return null;
	try {
		return JSON.parse(`"${t[1]}"`);
	} catch {
		return t[1];
	}
}
function $d(e) {
	if (ct(e)) return e;
	if (!Hd(e)) return null;
	for (let t of [
		"message",
		"detail",
		"error",
		"error_description"
	]) {
		let n = $d(e[t]);
		if (n !== null) return n;
	}
	return null;
}
var ef = {
	title: "There was a problem with authentication",
	description: "Please sign back in to continue using the API.",
	fix: {
		kind: "login",
		label: "Sign in again"
	}
};
function tf(e, t) {
	let n = qd(e), r = of(e) ? e.status : null, i = n.toLowerCase(), a = (...e) => e.some((e) => i.includes(e)), o = Yd(n, r), s = n.match(/invalid model configuration:\s*(.+)/is);
	if (s) return {
		title: "Configuration needs repair",
		description: rf(s[1]),
		fix: {
			kind: "settings",
			label: "Open settings"
		}
	};
	if (a("hard_limit_exceeded", "hard limit exceeded")) return {
		title: "Spending limit reached",
		description: "This request would take the workspace below its hard limit. Raise the limit or reduce usage to continue.",
		fix: {
			kind: "link",
			label: "Open Workspace Settings",
			url: Jd(n, Gd)
		}
	};
	if (a("insufficient_credits", "insufficient credits", "insufficient_quota", "top up your wallet") || o.has(402)) return {
		title: "Not enough credits for this request",
		description: "The provider reserved more than the remaining balance allows. The wallet can still show a balance. Top up, or retry.",
		fix: {
			kind: "link",
			label: "Open wallet",
			url: Jd(n, Wd)
		}
	};
	if (a("arcee auth is not configured")) return {
		title: "Not signed in to Arcee",
		description: "Sign in to continue using the API.",
		fix: {
			kind: "login",
			label: "Sign in"
		}
	};
	let c = a("rejected this api key", "invalid or expired api key", "auth.invalid_api_key", "auth.missing_bearer", "missing or invalid authorization header");
	return c || a("arcee authorization was revoked", "arcee token refresh failed", "rejected this login", "authentication_error") || o.has(401) ? !(t && Ar(t) !== null) && (c || t === "arcee-api") ? {
		title: "There was a problem with authentication",
		description: "The API key was rejected. Add a valid Arcee API key to continue.",
		fix: {
			kind: "settings",
			label: "Open settings"
		}
	} : ef : a("permission_error") || o.has(403) ? {
		title: "This account is not allowed to do that",
		description: "Ask the workspace owner for access, or pick a model the account can use.",
		fix: {
			kind: "settings",
			label: "Open settings"
		}
	} : a("rate_limit", "rate limit exceeded") || o.has(429) ? {
		title: "Rate limit reached",
		description: a("token") ? "The token rate limit for this account is used up. Wait a moment and try again." : "Arcee is throttling requests for this account. Wait a moment and try again.",
		fix: {
			kind: "retry",
			label: "Try again"
		}
	} : a("context_window_exceeded", "context window exceeded", "context length", "maximum context") ? {
		title: "The conversation is too long",
		description: "Compact the context with /compact, or start a new session to continue."
	} : a("content_policy_blocked", "content policy") ? {
		title: "Blocked by the content policy",
		description: "The provider refused this request. Rephrase and try again."
	} : a("model.not_accessible", "not accessible with the current access profile", "model_not_found", "the requested model") ? {
		title: "This model is not available",
		description: "The account cannot use the selected model. Pick a different one to continue.",
		fix: {
			kind: "settings",
			label: "Open settings"
		}
	} : a("provider.unprocessable") || o.has(422) ? {
		title: "The request was rejected",
		description: "One or more request parameters are invalid or out of range."
	} : a("could not reach the provider", "failed to refresh arcee access token") || a("failed to fetch", "load failed", "networkerror", "err_connection") ? {
		title: "Cannot reach Arcee",
		description: "Check the connection and try again.",
		fix: {
			kind: "retry",
			label: "Try again"
		}
	} : a("internal.unexpected", "service_unavailable", "api_error") || [
		500,
		502,
		503,
		504
	].some((e) => o.has(e)) ? {
		title: "Arcee is having trouble",
		description: "The provider returned a server error. Try again in a moment.",
		fix: {
			kind: "retry",
			label: "Try again"
		}
	} : i === "operation failed" || i === "run failed" ? {
		title: "The run could not finish",
		description: "Check the command log for what the agent was doing.",
		fix: {
			kind: "retry",
			label: "Try again"
		}
	} : { title: rf(Xd(n)) };
}
function nf(e, t) {
	let { title: n, description: r } = tf(e, t);
	return r ? `${n}. ${r}` : n;
}
function rf(e) {
	let t = e.trim();
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function af(e) {
	return e != null && !(e instanceof Error) && !ct(e);
}
function of(e) {
	return af(e) ? Number.isFinite(e.status) : !1;
}
// src/app/components/modals/AssignToProjectModal.tsx
function sf({ open: e, onClose: t, summary: n }) {
	let r = nr(), i = N(), a = xd(), { data: o } = _t(), s = l(), c = ft(), [u, d] = J(""), [f, p] = J(null), m = K(() => Pd(o?.projects ?? [], n), [o, n]), h = s.isPending || c.isPending;
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: t,
		title: "Assign to Project",
		size: Tn.Small,
		footer: /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(z, {
			variant: B.Tertiary,
			content: g.Text,
			onClick: t,
			disabled: h,
			children: "Cancel"
		}), /* @__PURE__ */ X(z, {
			variant: B.Primary,
			content: g.Text,
			onClick: async () => {
				if (n && !h) {
					p(null);
					try {
						let e = m ?? await c.mutateAsync({
							name: u.trim() || null,
							...Nd(n)
						});
						await s.mutateAsync({
							projectId: e.project_id,
							sessionId: n.session_id
						}), r.success(`Assigned to ${e.name}`), t();
					} catch (e) {
						p(nf(Ud(e)));
					}
				}
			},
			loading: h,
			children: m ? "Assign" : "Create and assign"
		})] }),
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-4",
			children: [
				/* @__PURE__ */ Z("p", {
					className: "text-small",
					children: [/* @__PURE__ */ X("span", {
						className: "text-basic-primary font-bold",
						children: a(n)
					}), " belongs to no project yet."]
				}),
				m ? /* @__PURE__ */ Z("div", {
					className: "flex items-center gap-3 rounded-[8px] border border-muted p-3",
					children: [/* @__PURE__ */ X(Uu, {
						id: m.project_id,
						size: 32,
						className: "rounded-[4px]"
					}), /* @__PURE__ */ Z("div", {
						className: "flex flex-col min-w-0",
						children: [/* @__PURE__ */ X("span", {
							className: "label-medium text-basic-primary truncate",
							children: m.name
						}), /* @__PURE__ */ X("span", {
							className: "text-micro text-basic-muted truncate",
							children: m.cwd
						})]
					})]
				}) : /* @__PURE__ */ X(Y, { children: /* @__PURE__ */ X($, {
					label: "Project name",
					inputSize: i ? Q.Large : Q.Medium,
					placeholder: "Taken from the git remote",
					value: u,
					onChange: (e) => {
						p(null), d(e.target.value);
					}
				}) }),
				f ? /* @__PURE__ */ X("p", {
					className: "text-error-primary text-micro",
					children: f
				}) : null
			]
		})
	});
}
// src/app/components/modals/ConfigRow.tsx
var cf = "w-full md:w-[280px]";
function lf({ label: e, hint: t, required: n = !1, invalid: r = !1 }) {
	return /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-1 w-full",
		children: [/* @__PURE__ */ Z("div", {
			className: I("label-small", r ? "text-error-primary" : "text-basic-primary"),
			children: [e, n ? "*" : ""]
		}), t ? /* @__PURE__ */ X(zi, {
			title: t,
			position: M.TopCenter
		}) : null]
	});
}
function uf({ label: e, hint: t, required: n = !1, invalid: r = !1, secondary: i = !1, muted: a = !1, verticalOnMobile: o = !1, labelClassName: s = "", control: c }) {
	return /* @__PURE__ */ Z("div", {
		className: I("flex w-full min-h-9 md:flex-row items-center md:justify-between md:min-h-5", o ? "flex-col items-stretch justify-center gap-1" : "flex-row items-center justify-between"),
		children: [/* @__PURE__ */ Z("div", {
			className: I("flex items-center gap-1 min-w-0 md:flex-1 md:max-w-[220px]", o ? "max-w-none" : "flex-1 max-w-[220px]", s),
			children: [/* @__PURE__ */ Z("div", {
				className: I(o ? "md:truncate" : "truncate", i ? "text-small" : "label-small", r ? "text-error-primary" : a ? "text-basic-muted" : i ? "text-basic-secondary" : "text-basic-primary"),
				children: [e, n ? "*" : ""]
			}), t ? /* @__PURE__ */ X(zi, {
				title: t,
				position: M.TopCenter
			}) : null]
		}), /* @__PURE__ */ X("div", {
			className: I("shrink-0", o && "w-full md:w-auto"),
			children: c
		})]
	});
}
// src/app/lib/catalog.ts
function df(e) {
	return e.connection?.base_url ?? e.managed_base_url ?? e.default_base_url ?? "";
}
var ff = "deepseek/deepseek-v4-flash-latest", pf = ["arcee-auth", "arcee-api"];
function mf(e) {
	let t = pf.flatMap((t) => {
		let n = _f(e, t);
		if (!n) return [];
		let r = df(n);
		return r ? [{
			provider: n,
			baseUrl: r
		}] : [];
	}), n = t.find((e) => e.provider.auth_status === "ready") ?? t[0];
	return n ? {
		backend: n.provider.id,
		model: ff,
		baseUrl: n.baseUrl
	} : null;
}
var hf = {
	provider: null,
	model: null,
	contextWindow: null,
	supportedEfforts: [],
	estimated: !1
};
function gf(e) {
	let t = e.lastIndexOf("-");
	if (t <= 0) return null;
	let n = e.slice(t + 1);
	return n.length === 8 && /^\d{8}$/.test(n) ? e.slice(0, t) : null;
}
function _f(e, t) {
	return e?.providers?.find((e) => e.id === t) ?? null;
}
function vf(e, t) {
	let n = e.models.find((e) => e.id === t);
	if (n) return n;
	let r = gf(t);
	return r ? e.models.find((e) => e.id === r) ?? null : null;
}
function yf(e, t, n) {
	let r = (n ?? "").trim(), i = _f(e, (t ?? "").trim());
	if (!i || !r) return hf;
	let a = vf(i, r);
	return a ? {
		provider: i,
		model: a,
		contextWindow: a.context_window || null,
		supportedEfforts: a.supported_efforts,
		estimated: !1
	} : {
		provider: i,
		model: null,
		contextWindow: i.default_limits.context_window || null,
		supportedEfforts: i.default_limits.supported_efforts,
		estimated: !0
	};
}
function bf(e, t) {
	let n = t.contextWindow;
	if (!n || e == null) return null;
	let r = `${Math.round(e / n * 100)}%`;
	return t.estimated ? `${r} of ${t.provider?.id ?? "the provider"}'s default window. The catalog does not know this model, so the limit is an estimate.` : `${r} of the model's context window`;
}
function xf(e, t) {
	let n = t.trim();
	if (!n) return null;
	let r = (e?.providers ?? []).filter((e) => e.models.some((e) => e.id === n));
	if (r.length === 0) return null;
	let i = r.find((e) => e.id === "openai-responses"), a = r.find((e) => e.managed_base_url === null);
	return (i ?? a ?? r[0]).id;
}
// src/app/components/modals/catalogModelOverlay.ts
var Sf = {
	input: 0,
	output: 0,
	cache_read: 0,
	cache_write: 0
};
function Cf(e, t) {
	if (t === void 0) return e.models;
	if (t === null) return [];
	let n = new Map(e.models.map((e) => [e.id, e]));
	return t.map((t) => {
		let r = n.get(t.id);
		return r ? t.display_name && t.display_name !== r.display_name ? {
			...r,
			display_name: t.display_name
		} : r : {
			id: t.id,
			display_name: t.display_name,
			context_window: e.default_limits.context_window,
			max_tokens: e.default_limits.max_tokens,
			cost: Sf,
			reasoning: !1,
			supported_efforts: e.default_limits.supported_efforts,
			source: "fallback"
		};
	});
}
// src/app/components/modals/CatalogModelPicker.tsx
function wf(e, t, n) {
	let r = t.trim().toLowerCase(), i = [...e?.providers ?? []].sort((e, t) => {
		let n = e.auth_status === "ready" ? 0 : 1, r = t.auth_status === "ready" ? 0 : 1;
		return n === r ? pn(e.id) - pn(t.id) : n - r;
	}), a = [];
	for (let e of i) for (let t of Cf(e, n.get(e.id))) (!r || `${t.id} ${t.display_name ?? ""} ${e.id}`.toLowerCase().includes(r)) && a.push({
		provider: e,
		model: t
	});
	return a;
}
function Tf(e) {
	return Number.isFinite(e) && e > 0 ? `$${Number(e.toFixed(2))}` : null;
}
function Ef(e) {
	let t = Tf(e.input), n = Tf(e.output);
	return t && n ? `${t}/${n} per 1M` : "pricing unknown";
}
function Df(e) {
	return [e.context_window > 0 ? `${it(e.context_window)} ctx` : "", Ef(e.cost)].filter(Boolean).join(" · ");
}
var Of = (e) => e.display_name || e.id;
function kf({ provider: e }) {
	return e.auth_status === "ready" ? /* @__PURE__ */ X(ia, {
		text: "available",
		color: na.Green,
		className: "shrink-0 whitespace-nowrap"
	}) : /* @__PURE__ */ X(ia, {
		text: e.managed_base_url ? "login required" : "no credential detected",
		color: na.Yellow,
		className: "shrink-0 whitespace-nowrap"
	});
}
function Af({ catalog: e, loading: t, failed: n, disabled: r = !1, compact: i = !1, liveByBackend: a, value: o, onSelect: s }) {
	let c = N(), [l, u] = J(!1), [d, f] = J(""), [p, m] = J(null), [h, _] = J(null), v = q(null), y = c ? Bi.Large : Bi.Medium, b = K(() => wf(e, d, a), [
		e,
		d,
		a
	]), S = p === null ? null : Math.min(p, Math.max(b.length - 1, 0)), C = h !== null && h < b.length ? h : S, w = (e) => {
		f(e), m(null), _(null);
	};
	G(() => {
		l && S !== null && v.current?.querySelector(`[data-row="${S}"]`)?.scrollIntoView({ block: "nearest" });
	}, [l, S]);
	let T = b.find((e) => e.provider.id === o?.backend && e.model.id === o?.model), E = () => {
		u(!1), m(null), _(null);
	}, D = (e) => {
		s({
			backend: e.provider.id,
			model: e.model.id,
			baseUrl: df(e.provider)
		}), u(!1), w("");
	}, O = (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (e.preventDefault(), !b.length) return;
			let t = e.key === "ArrowDown" ? 1 : -1;
			m(((C ?? (t === 1 ? -1 : 0)) + t + b.length) % b.length), _(null);
		} else if (e.key === "Enter") {
			e.preventDefault();
			let t = b[C ?? 0];
			t && D(t);
		}
	}, k = !e || r, ee = o ? T ? Of(T.model) : o.model : t ? "Loading models…" : n ? "Model catalog unavailable" : "Select a model";
	return /* @__PURE__ */ X(x, {
		open: l,
		onClose: E,
		placement: i ? M.TopRight : M.BottomLeft,
		size: "w-[520px]",
		sticky: !0,
		className: I(i ? "min-w-0" : "shrink-0", c && "w-full"),
		panelClassName: "p-2 overflow-hidden",
		sheetClassName: "h-[70dvh] max-h-[70dvh] min-h-[70dvh] overflow-hidden [&>*]:min-h-0 [&>*]:h-full [&>*]:flex [&>*]:flex-col",
		content: /* @__PURE__ */ Z("div", {
			className: I("flex flex-col min-h-0", c ? "h-full" : "h-[340px]"),
			children: [/* @__PURE__ */ X("div", {
				className: "shrink-0 p-4 pt-0 md:p-0 md:pb-2",
				children: /* @__PURE__ */ X($, {
					inputSize: c ? Q.Large : Q.Medium,
					leading: Hl.Icon,
					leadingIconName: H.Search,
					placeholder: "Search models…",
					autoFocus: !0,
					autoComplete: "off",
					spellCheck: !1,
					value: d,
					onChange: (e) => w(e.target.value),
					onKeyDown: O
				})
			}), /* @__PURE__ */ X("div", {
				ref: v,
				className: "flex flex-col flex-1 gap-1 min-h-0 overflow-auto [&>*]:shrink-0",
				children: b.length === 0 ? /* @__PURE__ */ X("p", {
					className: "px-4 md:px-2 py-3 text-micro text-basic-muted",
					children: t ? "Reading the catalog…" : n ? "The model catalog could not be read." : `No model matches "${d.trim()}".`
				}) : b.map((e, t) => {
					let n = t === 0 || b[t - 1].provider.id !== e.provider.id, r = e.provider.id === o?.backend && e.model.id === o?.model;
					return /* @__PURE__ */ Z("div", {
						className: "px-2 md:px-0",
						children: [n ? /* @__PURE__ */ Z("div", {
							className: "flex items-center gap-2 px-2 pt-6 pb-2",
							children: [
								/* @__PURE__ */ X("span", {
									className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
									children: rn(e.provider.id)
								}),
								/* @__PURE__ */ X(nd, { className: "shrink" }),
								/* @__PURE__ */ X(kf, { provider: e.provider })
							]
						}) : null, /* @__PURE__ */ Z(Ui, {
							size: y,
							variant: Vi.Regular,
							active: r,
							"data-row": t,
							onMouseEnter: () => _(t),
							onMouseLeave: () => _((e) => e === t ? null : e),
							onClick: () => D(e),
							children: [
								/* @__PURE__ */ X("span", {
									className: "flex-1 min-w-0 text-left truncate",
									children: Of(e.model)
								}),
								c ? null : /* @__PURE__ */ X("span", {
									className: "code-small text-basic-muted truncate md:max-w-[180px]",
									children: e.model.id
								}),
								/* @__PURE__ */ X("span", {
									className: "text-micro text-basic-muted shrink-0",
									children: Df(e.model)
								})
							]
						})]
					}, `${e.provider.id}/${e.model.id}`);
				})
			})]
		}),
		children: /* @__PURE__ */ Z(z, {
			variant: i ? B.Ghost : B.Secondary,
			size: i ? U.Small : c ? U.Large : U.Medium,
			content: i ? g.Text : g.IconRight,
			disabled: k,
			onClick: () => l ? E() : u(!0),
			"aria-expanded": l,
			"aria-label": i ? "Model" : void 0,
			className: i ? "min-w-0 max-w-full !gap-1 !px-2" : "w-full md:w-[280px]",
			children: [
				/* @__PURE__ */ X("span", {
					className: I("min-w-0 text-left truncate", i ? I("label-micro", c ? "max-w-[64px]" : "max-w-[96px]") : "flex-1"),
					children: ee
				}),
				o && rn(o.backend) !== ee ? /* @__PURE__ */ X("span", {
					className: I("truncate", i ? I("text-micro font-normal", c ? "max-w-[64px]" : "max-w-[96px]", k ? "text-basic-muted" : "text-basic-tertiary") : "text-micro text-basic-muted max-w-[110px]"),
					children: rn(o.backend)
				}) : null,
				i ? null : /* @__PURE__ */ X(R, {
					iconName: H.Down,
					className: I("transition-transform duration-150 ease-out", l ? "rotate-180" : "rotate-0")
				})
			]
		})
	});
}
// src/app/components/modals/KeyStatus.tsx
function jf({ status: e }) {
	return e === "validating" ? /* @__PURE__ */ X(ut, { size: bt.XSmall }) : e === "ready" ? /* @__PURE__ */ X(R, {
		iconName: H.CheckCircle,
		size: 16,
		className: "text-success-primary"
	}) : /* @__PURE__ */ X(R, {
		iconName: e === "error" ? H.Danger : H.Key,
		size: 16,
		className: I(e === "error" ? "text-error-primary" : "text-basic-muted")
	});
}
// src/app/features/setup/lifetime.ts
function Mf() {
	let e = yt(_r()), t = new AbortController(), n = !0;
	return yt(un(e, F(() => {
		n = !1, t.abort();
	}))), {
		signal: t.signal,
		current: () => n,
		close: () => yt(Dr(e, en))
	};
}
function Nf(e = !0) {
	let t = q(null);
	return G(() => {
		let n = Mf();
		return t.current = n, e || n.close(), n.close;
	}, [e]), t;
}
// src/app/features/managed/controller/deviceLoginOperation.ts
var Pf = (e) => ["provider-device-login-attempt", e];
async function Ff(e, t) {
	let { api: n } = Ht(e), r = Pf(t), i = e.getQueryData(r);
	if (i && ["starting", "waiting"].includes(i.state.status)) return {
		attempt: i.attempt,
		fresh: !1
	};
	let a = {
		provider: t,
		cancelled: !1
	}, s = () => e.getQueryData(r)?.attempt === a, c = (t, n = !1) => {
		s() && e.setQueryData(r, {
			attempt: a,
			state: t,
			completed: n
		});
	};
	e.setQueryDefaults(r, { gcTime: Infinity }), e.setQueryData(r, {
		attempt: a,
		state: { status: "starting" },
		completed: !1
	});
	try {
		let i = await Pn(o({ command: () => n.startManagedLogin(t) }));
		if (a.prompt = i, a.cancelled) return await n.cancelManagedLogin(t, i.login_id).catch(() => {}), {
			attempt: a,
			fresh: !1
		};
		if (!s()) return {
			attempt: a,
			fresh: !1
		};
		c({
			status: "waiting",
			prompt: i
		});
		let l = [
			"provider-device-login",
			t,
			i.login_id
		], u = new gi(e, {
			queryKey: l,
			queryFn: async ({ signal: r }) => {
				let a = await n.pollManagedLogin(t, i.login_id, r);
				return a.state === "complete" && s() && await Ut(e), a;
			},
			retry: !1,
			refetchInterval: (e) => !e.state.error && (!e.state.data || e.state.data.state === "pending") && 2e3,
			refetchIntervalInBackground: !0,
			gcTime: 0
		}), d = !1, f = () => {}, p = () => {
			d || (d = !0, a.dispose = void 0, u.destroy(), f(), e.removeQueries({
				queryKey: l,
				exact: !0
			}));
		};
		return a.dispose = p, f = e.getQueryCache().subscribe((e) => {
			e.type === "removed" && e.query.queryKey[0] === r[0] && e.query.queryKey[1] === t && e.query.state.data?.attempt === a && p();
		}), u.subscribe((e) => {
			d || a.cancelled || !s() || (e.isError ? (c({
				status: "failed",
				message: Vt(Ud(e.error))
			}), p()) : e.data?.state === "complete" ? (c({ status: "idle" }, !0), p()) : e.data?.state === "failed" && (c({
				status: "failed",
				message: e.data.error
			}), p()));
		}), {
			attempt: a,
			fresh: !0
		};
	} catch (e) {
		return !a.cancelled && s() && c({
			status: "failed",
			message: Vt(Ud(e))
		}), {
			attempt: a,
			fresh: !1
		};
	}
}
async function If(e, t) {
	let { api: n } = Ht(e), r = Pf(t), i = e.getQueryData(r);
	if (!i || !["starting", "waiting"].includes(i.state.status)) return;
	let a = i.attempt;
	a.cancelled = !0, a.dispose?.(), e.setQueryData(r, {
		attempt: a,
		state: { status: "idle" },
		completed: !1
	}), a.prompt && await n.cancelManagedLogin(t, a.prompt.login_id).catch(() => {});
}
// src/app/features/managed/controller/useDeviceLogin.ts
function Lf(e, t) {
	let n = Si(), r = Nf(), [i, a] = J(t ?? null), [o, s] = J(null), c = t ?? i, l = q(c);
	pi(() => {
		l.current = c;
	}, [c]);
	let u = Pf(c), d = xi({
		queryKey: u,
		queryFn: () => n.getQueryData(u) ?? null,
		enabled: !1,
		gcTime: Infinity
	}).data, f = q(e), p = q(null);
	G(() => {
		f.current = e;
	}, [e]);
	let m = W(async (e) => {
		let t = r.current;
		if (!t?.current()) return;
		l.current = e, a(e);
		let i = await Ff(n, e);
		t.current() && l.current === e && n.getQueryData(Pf(e))?.attempt === i.attempt && (s({
			attempt: i.attempt,
			current: t.current
		}), i.fresh && i.attempt.prompt && !i.attempt.cancelled && window.open(i.attempt.prompt.verification_uri, "_blank", "noopener,noreferrer"));
	}, [n, r]), h = W(async () => {
		c && await If(n, c);
	}, [n, c]);
	return G(() => {
		d?.completed && d.attempt === o?.attempt && o.current() && p.current !== d.attempt && (p.current = d.attempt, f.current?.());
	}, [d, o]), {
		state: d?.state ?? { status: "idle" },
		start: m,
		cancel: h
	};
}
// src/app/features/managed/controller/useManagedSignIn.ts
function Rf(e) {
	let t = Ar(e), { data: n } = _n(!!t);
	return {
		provider: t,
		signedIn: !!(t && n?.providers.find((e) => e.provider === t)?.signed_in)
	};
}
// src/app/features/managed/presentation/ManagedAuthCallout.tsx
var zf = {
	arcee: H.Arcee,
	codex: H.ChatGpt
};
function Bf({ backend: e, className: t = "", rejected: n = !1 }) {
	let { provider: r, signedIn: i } = Rf(e), { state: a, start: o, cancel: s } = Lf(void 0, r), c = Er(), l = Jr(e, !!r && i);
	if (!r) return null;
	let u = Un(r), d = a.status === "failed", f = i && l.isError, p = d || f || n, m = a.status === "waiting", h = i && !p, _ = n && i, v = m ? /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-2",
		children: [
			/* @__PURE__ */ X(ut, { size: bt.XSmall }),
			a.prompt.user_code ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("span", {
				className: "text-micro text-basic-muted",
				children: "Code"
			}), /* @__PURE__ */ X("span", {
				className: "label-small text-basic-primary tabular-nums",
				children: a.prompt.user_code
			})] }) : /* @__PURE__ */ X("span", {
				className: "text-micro text-basic-muted",
				children: "Waiting for the browser"
			}),
			/* @__PURE__ */ Z(z, {
				variant: B.Ghost,
				size: U.Medium,
				content: g.IconRight,
				onClick: () => window.open(a.prompt.verification_uri, "_blank", "noopener,noreferrer"),
				children: [/* @__PURE__ */ Z("span", { children: ["Open ", u] }), /* @__PURE__ */ X(R, { iconName: H.External })]
			}),
			/* @__PURE__ */ X(z, {
				variant: B.Ghost,
				size: U.Medium,
				content: g.Text,
				onClick: () => void s(),
				children: "Cancel"
			})
		]
	}) : h ? /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-2",
		children: [/* @__PURE__ */ Z("div", {
			className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
			children: [/* @__PURE__ */ X(R, {
				iconName: H.CheckCircle,
				className: "text-success-primary"
			}), /* @__PURE__ */ X("span", {
				className: "label-small text-success-primary",
				children: "Signed in"
			})]
		}), /* @__PURE__ */ X(z, {
			variant: B.Ghost,
			size: U.Medium,
			content: g.Text,
			loading: c.isPending,
			onClick: () => void c.mutateAsync(r).catch(() => {}),
			children: "Sign out"
		})]
	}) : /* @__PURE__ */ Z(z, {
		variant: B.Primary,
		size: U.Medium,
		content: g.IconRight,
		loading: a.status === "starting" || c.isPending,
		onClick: () => void (_ ? c.mutateAsync(r) : Promise.resolve()).then(() => o(r)).catch(() => {}),
		children: [/* @__PURE__ */ X("span", { children: _ ? `Sign in to ${u} again` : `Sign in with ${u}` }), /* @__PURE__ */ X(R, { iconName: H.External })]
	}), y = m ? `Approve the request on ${u}, then return here.` : h ? "NAC holds this login and every session on this provider uses it." : `This provider authenticates with ${u} in your browser instead of with an API key.`;
	return /* @__PURE__ */ Z("div", {
		className: I("flex flex-col gap-3 rounded-[8px] border bg-elevation-level-2 p-3 md:flex-row md:items-center md:justify-between md:gap-4", p ? "border-error-primary" : "border-muted", t),
		children: [/* @__PURE__ */ Z("div", {
			className: "flex items-start gap-2 min-w-0",
			children: [/* @__PURE__ */ X(R, {
				iconName: zf[r],
				className: I("shrink-0", p ? "text-error-primary" : "text-basic-secondary")
			}), /* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-0.5 min-w-0",
				children: [/* @__PURE__ */ Z("span", {
					className: I("label-small", p ? "text-error-primary" : "text-basic-primary"),
					children: [u, " sign-in"]
				}), /* @__PURE__ */ X("span", {
					className: "text-micro text-basic-muted",
					children: y
				})]
			})]
		}), /* @__PURE__ */ Z("div", {
			className: "flex flex-col items-stretch md:items-end gap-1 shrink-0",
			children: [v, d || f || c.isError ? /* @__PURE__ */ X("p", {
				className: "label-micro !text-[10px] !leading-[12px] text-error-primary max-w-[280px] md:text-right pt-1 opacity-70",
				children: nf(d ? a.message : c.isError ? c.error : l.error, e)
			}) : null]
		})]
	});
}
// src/app/lib/modelConfig.ts
function Vf(e, t, n, r = null) {
	return {
		...e,
		api_key_env: e.backend === t && (!e.api_key_env || e.api_key_env === r) ? n : e.api_key_env
	};
}
function Hf(e, t) {
	return {
		...e,
		api_key_env: t !== null && e.api_key_env === t ? null : e.api_key_env
	};
}
function Uf(e, t) {
	return e === t ? !0 : !e || !t ? !1 : e.model === t.model && (e.backend ?? null) === (t.backend ?? null) && (e.base_url ?? null) === (t.base_url ?? null) && (e.api_key_env ?? null) === (t.api_key_env ?? null) && (e.reasoning_effort ?? null) === (t.reasoning_effort ?? null);
}
var Wf = {
	"arcee-auth": "https://api.arcee.ai/api/v1",
	"chatgpt-codex-responses": "https://chatgpt.com/backend-api"
}, Gf = "__clear__";
function Kf(e) {
	return Wf[(e ?? "").trim()] ?? null;
}
function qf(e) {
	return e === "arcee-auth" || e === "chatgpt-codex-responses";
}
function Jf(e) {
	return (e ?? "").trim() || null;
}
function Yf(e) {
	return (e ?? "").split(",").map((e) => e.trim()).filter(Boolean);
}
function Xf(e, t) {
	if (e !== "inherit") {
		if (e === "none") return null;
		if (e !== "variable") throw Error("Choose how credentials are selected");
		if (!t) throw Error("API key environment variable is required when Environment variable is selected");
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) throw Error("API key environment variable must match [A-Za-z_][A-Za-z0-9_]* exactly (no whitespace)");
		return t;
	}
}
function Zf(e, t) {
	if (!e) return;
	let n = qf(e);
	if (n && t !== "none") throw Error(`${e} uses ${e === "arcee-auth" ? "stored Arcee login" : "stored Codex OAuth"} and does not accept an API key environment variable`);
	if (!n && t !== "variable") throw Error(`${e} requires an API key environment variable; explicitly select Environment variable`);
}
function Qf(e, t) {
	let n = e.trim();
	if (!n) return t;
	let r;
	try {
		r = JSON.parse(n);
	} catch {
		throw Error("Extra Headers must be valid JSON");
	}
	if (r === null || Array.isArray(r) || Object(r) !== r) throw Error("Extra Headers must be a JSON object with string keys and string values");
	let i = r;
	for (let [e, t] of Object.entries(i)) if (!ct(t)) throw Error(`Extra Headers value for "${e}" must be a string`);
	return i;
}
function $f(e, t) {
	let n = e.trim();
	if (!n) throw Error(`${t} is required and cannot be cleared`);
	return n;
}
function ep(e, t) {
	let n = Object.keys(e).sort(), r = Object.keys(t).sort();
	return n.length === r.length && n.every((n, i) => n === r[i] && e[n] === t[n]);
}
function tp(e, t, n = !1) {
	let r = $f(e.backend, "Backend"), i = Kf(r), a, o;
	if (i) a = Jf(e.base_url) ?? i, o = null;
	else {
		a = $f(e.base_url, "Base URL");
		let t = Xf(e.credential_mode, e.api_key_env);
		if (t === void 0) throw Error("Select an API key environment variable or explicitly choose none");
		o = t, n && e.credential_mode === "none" || Zf(r, e.credential_mode);
	}
	let s = {
		model: $f(e.model, "Model"),
		base_url: a,
		allow_insecure_http: e.allow_insecure_http,
		backend: r,
		reasoning_effort: e.reasoning_effort === "__clear__" ? null : e.reasoning_effort || null,
		api_key_env: o
	}, c = {};
	s.model !== t.model && (c.model = s.model), s.base_url !== t.base_url && (c.base_url = s.base_url), s.allow_insecure_http !== t.allow_insecure_http && (c.allow_insecure_http = s.allow_insecure_http), s.backend !== t.backend && (c.backend = s.backend), s.reasoning_effort !== t.reasoning_effort && (c.reasoning_effort = s.reasoning_effort), s.api_key_env !== t.api_key_env && (c.api_key_env = s.api_key_env);
	let l = Qf(e.extra_headers, {});
	(t.extra_headers_invalid || !ep(l, t.extra_headers)) && (c.extra_headers = l);
	let u = e.orchestrator_compaction_threshold.trim();
	if (u !== "" && !/^\d+$/.test(u)) throw Error("Context Limit must be a non-negative integer");
	let d = u === "" ? null : Number(u);
	return d !== t.orchestrator_compaction_threshold && (c.orchestrator_compaction_threshold = d), c;
}
[...br.map((e) => ({
	id: e,
	label: rn(e)
}))];
var np = br.map((e) => ({
	id: e,
	label: rn(e)
})), rp = [
	{
		id: "none",
		label: "None"
	},
	{
		id: "minimal",
		label: "Minimal"
	},
	{
		id: "low",
		label: "Low"
	},
	{
		id: "medium",
		label: "Medium"
	},
	{
		id: "high",
		label: "High"
	},
	{
		id: "xhigh",
		label: "X-High"
	},
	{
		id: "max",
		label: "Max"
	}
], ip = [
	{
		id: "",
		label: "Inherit config"
	},
	{
		id: Gf,
		label: "Clear configured effort"
	},
	...rp
], ap = /* @__PURE__ */ new Set(["", Gf]);
function op(e, t, n = ip) {
	if (e.length === 0) return n;
	let r = new Set(e);
	return n.filter((e) => ap.has(String(e.id)) || r.has(String(e.id)) || e.id === t);
}
// src/app/hooks/useExitTransition.ts
var sp = 300;
function cp(e, t = sp) {
	let [n, r] = J(e);
	return e && !n && r(!0), G(() => {
		if (e) return;
		let n = setTimeout(() => r(!1), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
// src/app/components/modals/PathPickerModal.tsx
function lp({ open: e, ssh: t, ...n }) {
	return cp(e) ? /* @__PURE__ */ X(up, {
		open: e,
		ssh: t ?? null,
		...n
	}) : null;
}
function up({ open: e, kind: t, initialPath: n, ssh: r, title: i, showHidden: a = !1, clearLabel: o, onClear: s, onClose: c, onSelect: l }) {
	let u = t !== "directory", d = N(), [f, p] = J(n.trim()), [m, _] = J(n.trim()), [v, y] = J(null), [b, x] = J(a), S = ir(f || null, t, b, !r), C = h(r ?? null, f || null, b, !!r), { data: w, error: T, isFetching: E } = r ? C : S, D = (e) => {
		p(e), _(e), y(null);
	}, O = u ? v : w?.path ?? f;
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: c,
		title: i ?? (t === "toml" ? "Select Config File" : t === "file" ? "Select File" : r ? `Select Working Folder on ${r.ssh_host}` : "Select Working Folder"),
		size: Tn.Wide,
		flush: !0,
		className: "h-[560px]",
		bodyClassName: "min-h-0",
		footer: /* @__PURE__ */ Z(Y, { children: [
			s ? d ? /* @__PURE__ */ X(Zr, {
				variant: B.Secondary,
				content: g.Text,
				onClick: s,
				children: o ?? "Clear"
			}) : /* @__PURE__ */ X(z, {
				variant: B.Ghost,
				size: U.Large,
				content: g.Text,
				className: "mr-auto",
				onClick: s,
				children: o ?? "Clear"
			}) : null,
			d ? /* @__PURE__ */ X(Zr, {
				variant: B.Secondary,
				content: g.Text,
				onClick: c,
				children: "Cancel"
			}) : /* @__PURE__ */ X(z, {
				variant: B.Secondary,
				size: U.Large,
				content: g.Text,
				onClick: c,
				children: "Cancel"
			}),
			d ? /* @__PURE__ */ X(Zr, {
				variant: B.Primary,
				content: g.Text,
				disabled: !O,
				onClick: () => {
					O && l(O);
				},
				children: "Select"
			}) : /* @__PURE__ */ X(z, {
				variant: B.Primary,
				size: U.Large,
				content: g.Text,
				disabled: !O,
				onClick: () => {
					O && l(O);
				},
				children: "Select"
			})
		] }),
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-3 h-full min-h-0",
			children: [
				/* @__PURE__ */ Z("div", {
					className: "flex items-center gap-2 shrink-0",
					children: [
						/* @__PURE__ */ X(z, {
							variant: B.Secondary,
							size: U.Medium,
							content: g.Icon,
							disabled: !w?.parent,
							onClick: () => w?.parent && D(w.parent),
							"aria-label": "Parent directory",
							children: /* @__PURE__ */ X(R, { iconName: H.Top })
						}),
						/* @__PURE__ */ X(z, {
							variant: B.Secondary,
							size: U.Medium,
							content: g.Icon,
							disabled: !w?.home,
							onClick: () => w?.home && D(w.home),
							"aria-label": "Home directory",
							children: /* @__PURE__ */ X(R, { iconName: H.Home })
						}),
						/* @__PURE__ */ X($, {
							inputSize: Q.Medium,
							className: "flex-1 min-w-0",
							placeholder: r ? "~/path/on/the/host" : "/path/to/directory",
							value: m,
							onChange: (e) => _(e.target.value),
							onKeyDown: (e) => {
								e.key === "Enter" && D(m.trim());
							}
						}),
						/* @__PURE__ */ X(z, {
							variant: b ? B.SecondaryHighlighted : B.Secondary,
							size: U.Medium,
							content: g.Icon,
							onClick: () => x((e) => !e),
							"aria-pressed": b,
							title: b ? "Hide dot-prefixed entries" : "Show hidden entries",
							"aria-label": b ? "Hide dot-prefixed entries" : "Show hidden entries",
							children: /* @__PURE__ */ X(R, { iconName: b ? H.Eye : H.EyeStrikethrough })
						})
					]
				}),
				T ? /* @__PURE__ */ X("p", {
					className: "label-micro text-error-primary shrink-0",
					children: Vt(T)
				}) : null,
				/* @__PURE__ */ Z("div", {
					className: "flex-1 min-h-0 overflow-auto rounded-[4px] bg-input shadow-concave p-1 flex flex-col [&>*]:shrink-0",
					children: [
						E && !w ? /* @__PURE__ */ X("div", {
							className: "flex items-center justify-center py-6",
							children: /* @__PURE__ */ X(ut, { size: bt.Small })
						}) : null,
						w?.entries.length === 0 ? /* @__PURE__ */ Z("p", {
							className: "text-micro text-basic-muted px-2 py-3",
							children: [t === "toml" ? "No directories or .toml files here." : t === "file" ? "Nothing here." : "No subdirectories here.", b ? "" : " Hidden entries are not listed."]
						}) : null,
						w?.entries.map((e) => /* @__PURE__ */ Z("button", {
							type: "button",
							className: I("flex items-center gap-3 md:gap-2 w-full px-2 md:px-2 py-3 md:py-1.5 rounded-[4px] text-left", "hover:bg-elevation-sublevel-variant-A", v === e.path && "bg-elevation-sublevel-variant-A"),
							onClick: () => e.is_directory ? D(e.path) : y(e.path),
							onDoubleClick: () => {
								e.is_directory || l(e.path);
							},
							children: [/* @__PURE__ */ X(R, {
								iconName: e.is_directory ? H.Folder : H.File,
								size: d ? 20 : 16,
								className: "shrink-0 text-basic-muted"
							}), /* @__PURE__ */ X("span", {
								className: I("text-basic-primary truncate", d ? "text-small" : "text-small "),
								children: e.name
							})]
						}, e.path)),
						w?.truncated ? /* @__PURE__ */ X("p", {
							className: "text-micro text-basic-muted px-2 py-2",
							children: "Only the first entries are listed; type a path to go deeper."
						}) : null
					]
				}),
				/* @__PURE__ */ X("p", {
					className: "text-micro text-basic-muted shrink-0 truncate",
					children: O ? `Selected: ${O}` : "Nothing selected yet."
				})
			]
		})
	});
}
// src/app/components/modals/SmallSelect.tsx
function dp({ items: e, value: t, onValueChange: n, placeholder: r, disabled: i = !1, size: a = U.Medium, trailingIcon: o, triggerClassName: s, placement: c = M.CenterLeft, onOpenChange: l }) {
	let u = N();
	return /* @__PURE__ */ X(Xu, {
		items: e,
		value: t,
		onValueChange: n,
		placeholder: r,
		disabled: i,
		size: a,
		trailingIcon: o,
		triggerClassName: s,
		itemSize: u ? Bi.Large : Bi.Medium,
		variant: B.Ghost,
		placement: c,
		onOpenChange: l,
		sticky: !0,
		panelClassName: "max-h-[200px] overflow-auto min-w-[220px] max-w-[calc(100vw-16px)]"
	});
}
// src/app/lib/apiKey.ts
var fp = "*".repeat(32);
function pp(e) {
	return e.map((e) => ({
		id: e.id,
		label: e.display_name ?? e.id
	}));
}
// src/app/components/modals/ResolvedRows.tsx
function mp({ resolving: e, resolved: t, backend: n, onBackend: r, baseUrl: i, onBaseUrl: a, model: o, onModel: s, failed: c }) {
	if (e) return /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-2 py-1",
		children: [/* @__PURE__ */ X(ut, { size: bt.XSmall }), /* @__PURE__ */ X("span", {
			className: "text-micro text-basic-muted",
			children: "Checking the key and reading the model list…"
		})]
	});
	if (!t || !n) return c ? null : /* @__PURE__ */ X("p", {
		className: "text-micro text-basic-muted py-1",
		children: "Pick a configuration to see its provider and models."
	});
	let l = cr(n), u = t.models.length > 0, d = !!t.models_error, f = u ? pp(t.models) : o ? [{
		id: o,
		label: o
	}] : [];
	return /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ X(uf, {
			label: "Model Provider",
			required: !0,
			hint: "Service that provides the models for this session.",
			control: /* @__PURE__ */ X(dp, {
				items: np,
				value: n,
				onValueChange: (e) => r(e)
			})
		}),
		l ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(nd, {}), /* @__PURE__ */ X(uf, {
			label: "API Key",
			required: !0,
			hint: "Held by NAC for this configuration; save a new setup to use a different key.",
			control: /* @__PURE__ */ X($, {
				inputSize: Q.Medium,
				className: cf,
				value: fp,
				isDisabled: !0,
				readOnly: !0,
				leadingSlot: /* @__PURE__ */ X(jf, { status: "ready" })
			})
		})] }) : null,
		/* @__PURE__ */ X(nd, {}),
		u || d ? /* @__PURE__ */ X(uf, {
			label: "Default Model",
			invalid: d,
			hint: "The NAC session will start with this default and may switch to another.",
			control: /* @__PURE__ */ X(dp, {
				items: d ? [] : f,
				value: d ? "" : o,
				onValueChange: s,
				disabled: d,
				placeholder: "–"
			})
		}) : /* @__PURE__ */ Z(Y, { children: [
			/* @__PURE__ */ X(uf, {
				label: "Model",
				required: !0,
				hint: "Model identifier the endpoint expects.",
				control: /* @__PURE__ */ X($, {
					inputSize: Q.Medium,
					className: cf,
					placeholder: "gpt-5.5",
					value: o,
					onChange: (e) => s(e.target.value)
				})
			}),
			/* @__PURE__ */ X(nd, {}),
			/* @__PURE__ */ X(uf, {
				label: "Base URL",
				required: !0,
				hint: "Endpoint the session sends its requests to.",
				control: /* @__PURE__ */ X($, {
					inputSize: Q.Medium,
					className: cf,
					placeholder: "https://api.openai.com/v1",
					value: i,
					onChange: (e) => a(e.target.value)
				})
			})
		] })
	] });
}
// src/app/components/modals/SourceMenu.tsx
function hp({ label: e, configurations: t, activeId: n, source: r, onSelect: i, onDelete: a }) {
	let o = N(), [s, c] = J(!1), l = o ? Bi.Large : Bi.Medium, u = o ? U.Large : U.Medium, d = (e) => {
		i(e), c(!1);
	}, f = /* @__PURE__ */ Z("div", {
		className: I("flex flex-col min-h-0", o ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
		children: [/* @__PURE__ */ Z("div", {
			className: "flex flex-col shrink-0 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ Z(Ui, {
					size: l,
					variant: Vi.Regular,
					active: r === "catalog",
					onClick: () => d({ kind: "catalog" }),
					children: [/* @__PURE__ */ X(R, { iconName: H.Search }), /* @__PURE__ */ X("span", {
						className: "text-left flex-grow",
						children: "Browse Models"
					})]
				}),
				/* @__PURE__ */ Z(Ui, {
					size: l,
					variant: Vi.Regular,
					active: r === "new",
					onClick: () => d({ kind: "new" }),
					children: [/* @__PURE__ */ X(R, { iconName: H.Add }), /* @__PURE__ */ X("span", {
						className: "text-left flex-grow",
						children: "Create New"
					})]
				}),
				/* @__PURE__ */ Z(Ui, {
					size: l,
					variant: Vi.Regular,
					active: r === "file",
					onClick: () => d({ kind: "file" }),
					children: [/* @__PURE__ */ X(R, { iconName: H.File }), /* @__PURE__ */ X("span", {
						className: "text-left flex-grow",
						children: "From a .toml file"
					})]
				})
			]
		}), t.length > 0 ? /* @__PURE__ */ Z("div", {
			className: "flex flex-col flex-1 min-h-0 min-w-0",
			children: [/* @__PURE__ */ X("div", { className: "h-px w-full bg-divider-muted my-1 shrink-0" }), /* @__PURE__ */ X("div", {
				className: "flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
				children: t.map((e) => /* @__PURE__ */ Z("div", {
					className: "flex items-center gap-1",
					children: [/* @__PURE__ */ Z(Ui, {
						size: l,
						variant: Vi.Regular,
						active: n === e.id,
						className: "flex-1 min-w-0",
						onClick: () => d({
							kind: "saved",
							configId: e.id
						}),
						children: [/* @__PURE__ */ X(R, { iconName: H.Gear }), /* @__PURE__ */ X("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						})]
					}), /* @__PURE__ */ X(z, {
						variant: B.TertiaryDestructive,
						size: u,
						content: g.Icon,
						"aria-label": `Remove ${e.name}`,
						onClick: () => a(e.id, e.name),
						children: /* @__PURE__ */ X(R, { iconName: H.Trash })
					})]
				}, e.id))
			})]
		}) : null]
	});
	return /* @__PURE__ */ X(x, {
		open: s,
		onClose: () => c(!1),
		placement: M.BottomLeft,
		size: "w-auto",
		className: "shrink-0",
		panelClassName: "max-h-72 overflow-hidden",
		sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
		content: f,
		children: /* @__PURE__ */ Z(z, {
			variant: B.Secondary,
			size: U.Medium,
			content: g.IconRight,
			onClick: () => c((e) => !e),
			"aria-expanded": s,
			children: [/* @__PURE__ */ X("span", {
				className: "text-left flex-grow truncate max-w-[96px] md:max-w-[220px]",
				children: e
			}), /* @__PURE__ */ X(R, {
				iconName: H.Down,
				className: I("transition-transform duration-150 ease-out", s ? "rotate-180" : "rotate-0")
			})]
		})
	});
}
// src/app/hooks/useDebouncedValue.ts
function gp(e, t) {
	let [n, r] = J(e);
	return G(() => {
		let n = setTimeout(() => r(e), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
// src/app/features/managed/controller/useManagedModelProfile.ts
function _p() {
	let e = Pr(), t = e.data ?? null, n = K(() => ue(t), [t]), r = W((e) => Je(t, e), [t]);
	return {
		defaultPick: n,
		configured: n !== null,
		matches: r,
		credentialReady: !!t?.model_ready,
		initializing: e.isPending
	};
}
// src/app/features/managed/presentation/ManagedModelCredentialStatus.tsx
function vp({ ready: e }) {
	return /* @__PURE__ */ X(uf, {
		label: "Credential",
		verticalOnMobile: !0,
		hint: "This managed host supplies the credential securely; it is not stored in this configuration or exposed to commands.",
		control: /* @__PURE__ */ Z("div", {
			className: I("flex items-center gap-1.5 rounded-[4px] py-2 pl-2 pr-4", e ? "bg-success-secondary" : "bg-error-tertiary"),
			children: [/* @__PURE__ */ X(R, {
				iconName: e ? H.CheckCircle : H.Repair,
				className: e ? "text-success-primary" : "text-error-primary"
			}), /* @__PURE__ */ X("span", {
				className: I("label-small", e ? "text-success-primary" : "text-error-primary"),
				children: e ? "Detected" : "Host needs attention"
			})]
		})
	});
}
// src/app/components/modals/ConfigurationsPanel.tsx
var yp = "custom", bp = [...br.map((e) => ({
	id: e,
	label: rn(e)
})), {
	id: yp,
	label: "Custom"
}], xp = 400;
function Sp(e, t) {
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => e[n] === t[n]);
}
function Cp({ invalid: e, errorText: t, onChange: n, initial: r, children: i }) {
	let a = nr(), o = _p(), { data: s, isPending: c } = Ir(), l = Rt(), u = zr(l.data), d = an(), f = K(() => s?.configurations ?? [], [s]), [p, m] = J(null), [h, _] = J(null), v = r?.backend ?? "arcee-api", [y, b] = J(br.includes(v) ? v : yp), [x, S] = J(v), [C, w] = J(null), [T, E] = J(""), [D, O] = J(r?.model ?? ""), [k, ee] = J(r?.base_url ?? ""), [A, te] = J(r?.allow_insecure_http ?? !1), [j, ne] = J(r?.model ?? ""), [re, ie] = J(""), [ae, oe] = J(!1), [se, ce] = J(null), [M, le] = J(null), [ue, de] = J(null), fe = o.defaultPick, pe = fe ? u.get(fe.backend) : void 0, P = o.configured && o.credentialReady && l.isPending, me = pe === null, F = p === null && h === null && (c || o.initializing || P || me), he = K(() => fe ? pe === void 0 ? fe : pe === null ? null : pe.some((e) => e.id === fe.model) ? fe : null : null, [fe, pe]), ge = r ? f.find((e) => (!r.config_id || e.config_id === r.config_id) && r.orchestrator_compaction_threshold !== void 0 && r.light_model !== void 0 && e.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && Uf(e.light_model ?? null, r.light_model) && e.backend === r.backend && e.model === r.model && e.base_url === r.base_url && e.allow_insecure_http === (r.allow_insecure_http ?? !1) && e.api_key_env === r.api_key_env && (e.reasoning_effort ?? null) === r.reasoning_effort && Sp(e.extra_headers, r.extra_headers)) : null, _e = f.at(-1), L = p ?? (r ? ge ? {
		kind: "saved",
		configId: ge.config_id
	} : { kind: "new" } : _e ? {
		kind: "saved",
		configId: _e.config_id
	} : { kind: "catalog" }), ve = K(() => L.kind === "catalog" && !F ? o.configured ? he : mf(l.data) : null, [
		L.kind,
		l.data,
		o.configured,
		he,
		F
	]), ye = h ?? ve, be = L.kind === "catalog" && ye ? ye.backend : y === yp ? x : y, xe = cr(be), Se = y !== yp && xe, Ce = K(() => {
		let e = L.kind === "catalog" ? ye?.backend ?? "catalog" : y === yp ? "custom" : y, t = new Set(f.map((e) => e.name));
		for (let n = 1;; n += 1) {
			let r = `${e}-config-${n}`;
			if (!t.has(r)) return r;
		}
	}, [
		L.kind,
		ye,
		y,
		f
	]), we = C ?? Ce, Te = gp(T.trim(), 600), Ee = gp(re.trim(), xp), De = L.kind === "saved" ? L.configId : null, Oe = L.kind === "file" ? Ee : "", ke = N(), { signedIn: Ae } = Rf(be), je = l.data?.providers.find((e) => e.id === be) ?? null, Me = L.kind === "catalog" && o.matches(ye), Ne = Me ? o.credentialReady : xe ? je?.auth_status === "ready" : Ae, Pe = L.kind === "catalog" && !!ye && xe && !Me && !Ne, Fe = L.kind === "new" && Se || Pe, Ie = Xr(be, Te, null, Fe), Le = Jr(be, L.kind === "new" && y !== yp && !xe && Ae), Re = Jt(De, Oe), ze = Fe && Te ? Ie.isFetching ? { status: "validating" } : Ie.error ? {
		status: "error",
		message: nf(Ie.error, be)
	} : Ie.data ? {
		status: "ready",
		models: Ie.data.models,
		baseUrl: Ie.data.base_url
	} : { status: "validating" } : { status: "idle" }, Be = ze.status === "ready", Ve = Ie.data?.base_url ?? "", He = !!(De ?? Oe), Ue = He && Re.isFetching, We = He && !Re.error ? Re.data ?? null : null, Ge = He && Re.error ? nf(Re.error, be) : "", Ke = se ?? We?.backend ?? null, qe = M ?? We?.base_url ?? "", Je = L.kind === "new" ? (xe ? Ie.data?.models : Le.data?.models) ?? [] : We?.models ?? [], Ye = L.kind === "new" ? "" : We?.model ?? "", Xe = L.kind === "new" ? Je.some((e) => e.id === j) ? j : Je[0]?.id ?? ue ?? j : j || ue || Ye || Je[0]?.id || "", Ze = (e) => {
		m(e), E(""), ne(""), ce(null), le(null), de(null), e?.kind !== "file" && ie(""), e?.kind !== "catalog" && _(null), e?.kind !== "new" && e?.kind !== "catalog" && w(null);
	}, Qe = De ? f.find((e) => e.config_id === De) ?? null : null, $e = !(!r || p !== null || L.kind !== "new" || be !== r.backend || k.trim() !== r.base_url || A !== (r.allow_insecure_http ?? !1) || T.trim()), et = K(() => {
		if (F) return null;
		if (r && $e) {
			let e = y === yp ? D.trim() : Xe;
			return e ? {
				kind: "resolved",
				backend: r.backend,
				model: e,
				base_url: r.base_url,
				allow_insecure_http: r.allow_insecure_http ?? !1,
				api_key_env: r.api_key_env,
				reasoning_effort: r.reasoning_effort,
				extra_headers: r.extra_headers,
				orchestrator_compaction_threshold: r.orchestrator_compaction_threshold,
				light_model: r.light_model
			} : null;
		}
		if (L.kind === "catalog") {
			if (!ye || !ye.baseUrl || Me && !Ne) return null;
			if (Ne) return {
				kind: "resolved",
				backend: ye.backend,
				model: ye.model,
				base_url: ye.baseUrl,
				allow_insecure_http: !1,
				api_key_env: xe ? je?.connection?.api_key_env ?? null : null,
				reasoning_effort: null,
				extra_headers: null,
				light_model: void 0
			};
			if (!xe) return null;
			let e = we.trim();
			return !e || !Be ? null : {
				kind: "save",
				request: {
					name: e,
					backend: ye.backend,
					model: ye.model,
					base_url: Ve || ye.baseUrl,
					allow_insecure_http: !1,
					api_key: T.trim()
				}
			};
		}
		if (L.kind === "new") {
			let e = we.trim();
			if (!e) return null;
			let t = T.trim();
			if (xe && !t) return null;
			if (y === yp) {
				let n = k.trim(), r = D.trim();
				return !n || !r ? null : {
					kind: "save",
					request: {
						name: e,
						backend: be,
						model: r,
						base_url: n,
						allow_insecure_http: A,
						api_key: xe ? t : null
					}
				};
			}
			return xe ? !Be || !Xe || !Ve ? null : {
				kind: "save",
				request: {
					name: e,
					backend: be,
					model: Xe,
					base_url: Ve,
					allow_insecure_http: !1,
					api_key: t
				}
			} : !Ae || !Xe ? null : {
				kind: "save",
				request: {
					name: e,
					backend: be,
					model: Xe
				}
			};
		}
		if (!We || !Ke) return null;
		let e = Xe || We.model || "", t = qe.trim();
		return !e || !t ? null : {
			kind: "resolved",
			backend: Ke,
			model: e,
			base_url: t,
			allow_insecure_http: We.allow_insecure_http,
			api_key_env: We.api_key_env,
			reasoning_effort: We.reasoning_effort,
			extra_headers: Qe?.extra_headers ?? null,
			orchestrator_compaction_threshold: r && p === null ? r.orchestrator_compaction_threshold : Qe ? Qe.orchestrator_compaction_threshold ?? null : void 0,
			light_model: r && p === null ? r.light_model : Qe ? Qe.light_model ?? null : void 0,
			config_id: r && p === null ? r.config_id ?? Qe?.config_id ?? null : Qe?.config_id ?? null
		};
	}, [
		L.kind,
		F,
		r,
		$e,
		ye,
		Ne,
		Me,
		je,
		we,
		T,
		xe,
		y,
		be,
		k,
		A,
		D,
		Ae,
		Be,
		Ve,
		Xe,
		We,
		Ke,
		qe,
		Qe,
		p
	]);
	G(() => {
		n(et);
	}, [et, n]);
	let tt = async (e, t) => {
		try {
			await d.mutateAsync(e), De === e && Ze(null), a.success(`Configuration ${t} removed`);
		} catch (e) {
			a.error(`Failed to remove the configuration: ${nf(Ud(e))}`);
		}
	}, nt = $e ? !0 : L.kind === "catalog" ? !!ye && (Ne || Be) : L.kind === "new" ? y === yp ? !!(k.trim() && D.trim()) : xe ? Be : Ae : !!We, rt = ze.status === "error", it = Le.isError ? nf(Le.error, be) : We?.models_error ?? "", at = e || rt || !!Ge || !!it, ot = Le.isError || !!(We && !cr(We.backend) && We.models_error), st = t ?? (rt ? ze.message : Ge || (ot ? "" : it)), ct = Ge || We?.models_error && cr(We.backend) ? Re.refetch : null, lt = L.kind === "catalog" ? ye && !xe ? be : null : L.kind === "new" ? y !== yp && !xe ? be : null : Ke && !cr(Ke) ? Ke : null, ut = L.kind === "catalog" ? "Browse Models" : L.kind === "new" ? "Create New" : L.kind === "file" ? "From a .toml file" : Qe?.name ?? "Configuration";
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-1",
		children: [
			/* @__PURE__ */ Z("div", {
				className: I("flex flex-col rounded-[8px] bg-elevation-level-2 border border-muted overflow-visible", at && "border border-error-primary"),
				children: [
					/* @__PURE__ */ Z("div", {
						className: "flex items-center gap-4 px-3 py-2 bg-elevation-level-3 rounded-t-[8px] border-b border-muted",
						children: [/* @__PURE__ */ X("div", {
							className: I("flex-1 min-w-0 truncate", ke ? "label-medium" : "label-small", at ? "text-error-primary" : "text-basic-primary"),
							children: "Configurations"
						}), /* @__PURE__ */ X(hp, {
							label: ut,
							configurations: f.map((e) => ({
								id: e.config_id,
								name: e.name
							})),
							activeId: De,
							source: L.kind,
							onSelect: Ze,
							onDelete: (e, t) => void tt(e, t)
						})]
					}),
					/* @__PURE__ */ X(nd, {}),
					/* @__PURE__ */ Z("div", {
						className: "flex flex-col gap-4 md:gap-2 p-3",
						children: [
							L.kind === "catalog" ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(uf, {
								label: "Model",
								required: !0,
								verticalOnMobile: !0,
								hint: "Every model this build knows about; picking one names its provider.",
								control: /* @__PURE__ */ X(Af, {
									catalog: l.data,
									loading: l.isLoading,
									failed: l.isError,
									disabled: F,
									liveByBackend: u,
									value: ye,
									onSelect: (e) => {
										m({ kind: "catalog" }), _(e), E(""), w(null);
									}
								})
							}), ye ? /* @__PURE__ */ Z(Y, { children: [
								/* @__PURE__ */ X(nd, {}),
								/* @__PURE__ */ X(uf, {
									label: "Base URL",
									hint: "Endpoint the catalog names for this provider.",
									verticalOnMobile: !0,
									control: /* @__PURE__ */ X($, {
										inputSize: ke ? Q.Large : Q.Medium,
										className: cf,
										value: ye.baseUrl,
										isDisabled: !0,
										readOnly: !0
									})
								}),
								xe ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(nd, {}), Me ? /* @__PURE__ */ X(vp, { ready: Ne }) : Ne ? /* @__PURE__ */ X(uf, {
									label: "Credential",
									verticalOnMobile: !0,
									hint: "This provider's conventional environment variable is set on the server; the session reuses it.",
									control: /* @__PURE__ */ Z("div", {
										className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
										children: [/* @__PURE__ */ X(R, {
											iconName: H.CheckCircle,
											className: "text-success-primary"
										}), /* @__PURE__ */ X("span", {
											className: "label-small text-success-primary",
											children: "Detected"
										})]
									})
								}) : /* @__PURE__ */ Z(Y, { children: [
									/* @__PURE__ */ X(uf, {
										label: "Name",
										required: !0,
										verticalOnMobile: !0,
										hint: "How this setup is listed the next time a session is created.",
										control: /* @__PURE__ */ X($, {
											inputSize: ke ? Q.Large : Q.Medium,
											className: cf,
											value: we,
											onChange: (e) => w(e.target.value)
										})
									}),
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "API Key",
										required: !0,
										verticalOnMobile: !0,
										invalid: rt,
										hint: je?.auth_hint ? `Stored in NAC once the setup is saved, or set ${je.auth_hint} on the server instead.` : "Stored in NAC under a generated name once the setup is saved.",
										control: /* @__PURE__ */ X($, {
											inputSize: ke ? Q.Large : Q.Medium,
											className: cf,
											type: "password",
											autoComplete: "off",
											placeholder: "Paste the provider key",
											leadingSlot: /* @__PURE__ */ X(jf, { status: ze.status }),
											validation: rt,
											value: T,
											onChange: (e) => E(e.target.value)
										})
									})
								] })] }) : null
							] }) : null] }) : null,
							L.kind === "file" ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(uf, {
								label: "Config File",
								required: !0,
								hint: "A config.toml on this machine; its [model] section is read.",
								invalid: !!Ge,
								verticalOnMobile: !0,
								control: /* @__PURE__ */ X($, {
									inputSize: ke ? Q.Large : Q.Medium,
									className: cf,
									placeholder: "Select Config File",
									trailing: Ul.Button,
									trailingIconName: H.Folder,
									trailingOnClick: () => oe(!0),
									value: re,
									onChange: (e) => ie(e.target.value)
								})
							}), re.trim() ? /* @__PURE__ */ X(nd, {}) : null] }) : null,
							L.kind === "new" ? /* @__PURE__ */ Z(Y, { children: [
								/* @__PURE__ */ X(uf, {
									label: "Model Provider",
									required: !0,
									hint: "Service that provides the models for this session.",
									control: /* @__PURE__ */ X(dp, {
										items: bp,
										value: y,
										onValueChange: (e) => {
											b(e), E(""), ne("");
										}
									})
								}),
								/* @__PURE__ */ X(nd, {}),
								y === yp ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(uf, {
									label: "Protocol",
									required: !0,
									hint: "Wire format the endpoint speaks; a URL alone cannot say.",
									control: /* @__PURE__ */ X(dp, {
										items: np,
										value: x,
										onValueChange: (e) => S(e)
									})
								}), /* @__PURE__ */ X(nd, {})] }) : null,
								/* @__PURE__ */ X(uf, {
									label: "Name",
									required: !0,
									hint: "How this setup is listed the next time a session is created.",
									control: /* @__PURE__ */ X($, {
										inputSize: Q.Medium,
										className: cf,
										value: we,
										onChange: (e) => w(e.target.value)
									})
								}),
								xe ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(nd, {}), /* @__PURE__ */ X(uf, {
									label: "API Key",
									required: !0,
									invalid: rt,
									hint: "Stored in NAC under a generated name once the setup is saved.",
									control: /* @__PURE__ */ X($, {
										inputSize: Q.Medium,
										className: cf,
										type: "password",
										autoComplete: "off",
										placeholder: "Paste the provider key",
										leadingSlot: /* @__PURE__ */ X(jf, { status: ze.status }),
										validation: rt,
										value: T,
										onChange: (e) => E(e.target.value)
									})
								})] }) : null,
								y === yp ? /* @__PURE__ */ Z(Y, { children: [
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "Model",
										required: !0,
										hint: "Model identifier the endpoint expects.",
										control: /* @__PURE__ */ X($, {
											inputSize: Q.Medium,
											className: cf,
											placeholder: "gpt-5.5",
											value: D,
											onChange: (e) => O(e.target.value)
										})
									}),
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "Base URL",
										required: !0,
										hint: "Endpoint the session sends its requests to.",
										control: /* @__PURE__ */ X($, {
											inputSize: Q.Medium,
											className: cf,
											placeholder: "https://api.openai.com/v1",
											value: k,
											onChange: (e) => ee(e.target.value)
										})
									}),
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "Allow insecure HTTP",
										control: /* @__PURE__ */ Z("div", {
											className: `${cf} flex flex-col items-start gap-1`,
											children: [/* @__PURE__ */ X(pd, {
												"aria-label": "Allow insecure HTTP",
												checked: A,
												onChange: te
											}), /* @__PURE__ */ X("p", {
												className: "body-small text-basic-secondary",
												children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
											})]
										})
									})
								] }) : xe ? ze.status === "ready" ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(nd, {}), /* @__PURE__ */ X(uf, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									control: /* @__PURE__ */ X(dp, {
										items: pp(ze.models),
										value: Xe,
										onValueChange: ne,
										placeholder: "No models offered"
									})
								})] }) : null : Ae ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(nd, {}), /* @__PURE__ */ X(uf, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									invalid: !!it,
									control: /* @__PURE__ */ X(dp, {
										items: it ? [] : pp(Je),
										value: it ? "" : Xe,
										onValueChange: ne,
										disabled: !!it,
										placeholder: Le.isFetching ? "Reading the model list…" : it ? "–" : "No models offered"
									})
								})] }) : null
							] }) : null,
							L.kind === "saved" || L.kind === "file" ? /* @__PURE__ */ X(mp, {
								resolving: Ue,
								resolved: We,
								backend: Ke,
								onBackend: ce,
								baseUrl: qe,
								onBaseUrl: le,
								model: Xe,
								onModel: (e) => We?.models.length ? ne(e) : de(e),
								failed: !!Ge
							}) : null,
							i && nt ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(nd, {}), i] }) : null
						]
					})
				]
			}),
			lt ? /* @__PURE__ */ X(Bf, {
				backend: lt,
				className: "mt-1"
			}) : null,
			st ? /* @__PURE__ */ Z("div", {
				className: "flex items-start gap-2",
				children: [/* @__PURE__ */ X("p", {
					className: "label-micro text-error-primary flex-1 min-w-0",
					children: st
				}), ct ? /* @__PURE__ */ X(z, {
					variant: B.Ghost,
					size: U.Medium,
					content: g.Text,
					onClick: () => void ct(),
					children: "Try again"
				}) : null]
			}) : null,
			/* @__PURE__ */ X("p", {
				className: "text-micro text-basic-muted",
				children: "* Required fields"
			}),
			/* @__PURE__ */ X(lp, {
				open: ae,
				kind: "toml",
				initialPath: re.trim(),
				onClose: () => oe(!1),
				onSelect: (e) => {
					ie(e), oe(!1);
				}
			})
		]
	});
}
// src/app/components/modals/LightModelSection.tsx
var wp = [{
	id: "",
	label: "Model default"
}, ...rp];
function Tp(e, t) {
	if (!e?.model) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let n = e.backend ?? xf(t, e.model);
	if (!n) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let r = t?.providers?.find((e) => e.id === n), i = e.base_url ?? (r ? df(r) : "");
	return {
		pick: {
			backend: n,
			model: e.model,
			baseUrl: i
		},
		effort: e.reasoning_effort ?? "",
		apiKeyEnv: e.api_key_env ?? null
	};
}
function Ep(e) {
	return e.pick ? {
		model: e.pick.model,
		backend: e.pick.backend,
		base_url: e.pick.baseUrl || null,
		api_key_env: e.apiKeyEnv,
		reasoning_effort: e.effort || null
	} : null;
}
function Dp({ initial: e, onChange: t, behavior: n = "orchestrator" }) {
	let r = Rt(), i = zr(r.data), [a, o] = J(e ? "dual" : "single"), [s, c] = J(() => Tp(e, r.data)), l = K(() => {
		if (s.pick) return s;
		let t = Tp(e, r.data);
		return t.pick ? t : s;
	}, [
		s,
		e,
		r.data
	]), u = K(() => a === "single" ? {
		mode: a,
		light: null
	} : {
		mode: a,
		light: Ep(l)
	}, [a, l]);
	G(() => {
		t(u);
	}, [u, t]);
	let d = op(yf(r.data, l.pick?.backend, l.pick?.model).supportedEfforts, l.effort, wp), f = n === "direct" ? {
		label: "Optional light model",
		hint: "Saved with this chat, but plain direct sessions do not use it yet.",
		modelHint: "Preserved for future direct-session capabilities; it does not route current work."
	} : n === "direct-with-orchestrator" ? {
		label: "Orchestrator models",
		hint: "Dual passes a lighter model to NAC orchestrators launched from this chat.",
		modelHint: "Runs dispatches that a launched NAC orchestrator classifies as light."
	} : {
		label: "Worker models",
		hint: "Dual adds a lighter model for simple dispatches; the model above handles everything else.",
		modelHint: "Runs dispatches the orchestrator classifies as light."
	};
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ Z("div", {
			className: "flex items-center justify-between",
			children: [/* @__PURE__ */ X(lf, {
				label: f.label,
				hint: f.hint
			}), /* @__PURE__ */ X("div", {
				className: "flex items-center gap-2",
				children: ["single", "dual"].map((e) => /* @__PURE__ */ X(z, {
					variant: a === e ? B.Primary : B.Secondary,
					size: U.Medium,
					content: g.Text,
					onClick: () => o(e),
					"aria-pressed": a === e,
					children: e === "single" ? "Single" : "Dual"
				}, e))
			})]
		}), a === "dual" ? /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
			children: [/* @__PURE__ */ X(uf, {
				label: "Light model",
				required: !0,
				verticalOnMobile: !0,
				hint: f.modelHint,
				control: /* @__PURE__ */ X(Af, {
					catalog: r.data,
					loading: r.isLoading,
					failed: r.isError,
					liveByBackend: i,
					value: l.pick,
					onSelect: (e) => c({
						...l,
						pick: e,
						effort: "",
						apiKeyEnv: e.backend === l.pick?.backend ? l.apiKeyEnv : r.data?.providers.find((t) => t.id === e.backend)?.connection?.api_key_env ?? null
					})
				})
			}), /* @__PURE__ */ X(uf, {
				label: "Light effort",
				secondary: !0,
				hint: "Reasoning effort the light model runs with.",
				control: /* @__PURE__ */ X(Xu, {
					items: d,
					value: l.effort,
					onValueChange: (e) => c({
						...l,
						effort: e
					}),
					disabled: !l.pick,
					size: U.Medium,
					variant: B.Ghost,
					placement: M.BottomLeft,
					panelClassName: "max-h-64 overflow-auto"
				})
			})]
		}) : null]
	});
}
// src/app/components/modals/SshConnectionBox.tsx
var Op = "__new__", kp = ".ssh/config";
function Ap(e) {
	let t = e.trim();
	return t ? t.replace(/\/[^/]*$/, "") || "/" : "~/.ssh";
}
function jp(e) {
	let t = e.trim();
	if (!t) return null;
	let n = Number(t);
	return !Number.isInteger(n) || n < 1 || n > 65535 ? "Port must be an integer between 1 and 65535." : null;
}
function Mp(e) {
	return e.trim() || null;
}
function Np(e, t, n) {
	let r = Mp(e);
	if (!r) return { error: "An SSH host is required." };
	let i = jp(t);
	return i ? { error: i } : {
		ssh_host: r,
		ssh_port: Mp(t) ? Number(t.trim()) : null,
		ssh_identity_file: Mp(n)
	};
}
function Pp(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function Fp(e, t) {
	return e.ssh_host === t.ssh_host && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function Ip({ mode: e, connection: t, onConnectionChange: n, seedTarget: r = null, name: i, onNameChange: a, host: o, onHostChange: s, port: c, onPortChange: l, identityFile: u, onIdentityFileChange: d, onTest: f, testing: p = !1, locked: m = !1, className: h }) {
	let { markSshDisconnected: g, markSshConnected: _ } = V().stores.sshConnectionStore, v = nr(), { data: y } = Vr(), b = K(() => y?.configurations ?? [], [y]), S = Wn(), C = at(), w = e === "manage", T = K(() => w || !r?.ssh_host.trim() ? null : b.find((e) => Fp(r, e))?.config_id ?? null, [
		w,
		r,
		b
	]), [E, D] = J(null), O = E ?? T ?? Op, [k, ee] = J(!1), [A, te] = J(() => Pp(b)), [j, ne] = J(r?.ssh_host ?? ""), [re, ie] = J(r?.ssh_port ? String(r.ssh_port) : ""), [ae, oe] = J(r?.ssh_identity_file ?? ""), [se, ce] = J(null), [le, ue] = J(!1), de = N(), fe = !!t, pe = C.isPending || S.isPending || p, P = m || fe || pe, me = O === Op ? null : b.find((e) => e.config_id === O) ?? null, F = w ? i ?? "" : A, he = w ? o ?? "" : fe ? t?.ssh_host ?? "" : j, ge = w ? c ?? "" : fe ? t?.ssh_port ? String(t.ssh_port) : "" : re, _e = w ? u ?? "" : fe ? t?.ssh_identity_file ?? "" : ae, L = (e) => {
		w ? a?.(e) : te(e);
	}, ve = (e) => {
		w ? s?.(e) : ne(e);
	}, ye = (e) => {
		w ? l?.(e) : ie(e);
	}, be = (e) => {
		w ? d?.(e) : oe(e);
	}, xe = O === Op ? "Create New" : me?.name ?? "SSH config", Se = (e) => {
		if (D(e), ee(!1), ce(null), e === Op) {
			te(Pp(b)), ne(r?.ssh_host ?? ""), ie(r?.ssh_port ? String(r.ssh_port) : ""), oe(r?.ssh_identity_file ?? "");
			return;
		}
		let t = b.find((t) => t.config_id === e);
		t && (te(t.name), ne(t.ssh_host), ie(t.ssh_port ? String(t.ssh_port) : ""), oe(t.ssh_identity_file ?? ""));
	}, Ce = async () => {
		ce(null);
		let e = Np(he, ge, _e);
		if ("error" in e) ce(e.error);
		else if (O === Op && !Mp(F)) ce("An SSH config name is required.");
		else try {
			let t = await C.mutateAsync(e);
			if (_(e), O === Op) {
				let t = await S.mutateAsync({
					name: F.trim(),
					ssh_host: e.ssh_host,
					ssh_port: e.ssh_port ?? null,
					ssh_identity_file: e.ssh_identity_file ?? null
				});
				D(t.config_id);
			}
			n(e, t.path);
		} catch (t) {
			g(e);
			let n = Vt(Ud(t));
			ce(n), v.error(`SSH connect failed: ${n}`);
		}
	}, we = () => {
		t && g(t), n(null), ce(null);
	}, Te = async () => {
		if (f) {
			ce(null);
			try {
				await f();
			} catch (e) {
				let t = Vt(Ud(e));
				ce(t);
			}
		}
	}, Ee = w || !fe && O === Op, De = !w;
	return /* @__PURE__ */ Z("div", {
		className: I("relative flex flex-col rounded-[8px] overflow-hidden shadow-convex", fe ? "bg-info-primary" : "bg-elevation-sublevel-variant-A", h),
		children: [
			De ? /* @__PURE__ */ Z("div", {
				className: "flex items-center gap-4 h-12 pl-3 pr-1.5 py-1 border-b border-muted bg-elevation-sublevel-variant-A",
				children: [
					/* @__PURE__ */ X("p", {
						className: "label-small text-basic-primary flex-1 min-w-0",
						children: "SSH config"
					}),
					fe ? /* @__PURE__ */ X(ia, {
						text: "Connected",
						color: na.Blue,
						className: "!py-0.5 !px-1"
					}) : null,
					/* @__PURE__ */ X(x, {
						open: k && !P,
						onClose: () => ee(!1),
						placement: M.BottomLeft,
						size: "w-auto",
						className: "shrink-0",
						panelClassName: "max-h-72 overflow-hidden",
						sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
						content: /* @__PURE__ */ Z("div", {
							className: I("flex flex-col min-h-0", de ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
							children: [/* @__PURE__ */ X("div", {
								className: "flex flex-col shrink-0 [&>*]:shrink-0",
								children: /* @__PURE__ */ Z(Ui, {
									size: de ? Bi.Large : Bi.Medium,
									variant: O === Op ? Vi.Accent : Vi.Regular,
									active: O === Op,
									onClick: () => Se(Op),
									children: [/* @__PURE__ */ X(R, { iconName: H.Add }), /* @__PURE__ */ X("span", {
										className: "text-left flex-grow",
										children: "Create New"
									})]
								})
							}), b.length > 0 ? /* @__PURE__ */ Z("div", {
								className: "flex flex-col flex-1 min-h-0 min-w-0",
								children: [/* @__PURE__ */ X("div", { className: "h-px w-full bg-divider-muted my-1 shrink-0" }), /* @__PURE__ */ X("div", {
									className: "flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
									children: b.map((e) => /* @__PURE__ */ Z(Ui, {
										size: de ? Bi.Large : Bi.Medium,
										variant: O === e.config_id ? Vi.Accent : Vi.Regular,
										active: O === e.config_id,
										onClick: () => Se(e.config_id),
										children: [/* @__PURE__ */ X(R, { iconName: H.Globe }), /* @__PURE__ */ X("span", {
											className: "text-left flex-grow truncate",
											children: e.name
										})]
									}, e.config_id))
								})]
							}) : null]
						}),
						children: /* @__PURE__ */ Z(z, {
							size: U.Medium,
							variant: B.Secondary,
							disabled: P,
							onClick: () => ee((e) => !e),
							"aria-expanded": k,
							children: [/* @__PURE__ */ X("span", {
								className: "truncate max-w-[140px]",
								children: xe
							}), /* @__PURE__ */ X(R, {
								iconName: H.Down,
								className: I("shrink-0 transition-transform duration-150 ease-out", k ? "rotate-180" : "rotate-0")
							})]
						})
					})
				]
			}) : null,
			/* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-4 p-3",
				children: [
					Ee ? /* @__PURE__ */ Z("div", {
						className: "flex flex-col gap-1 w-full",
						children: [/* @__PURE__ */ X(lf, {
							label: "SSH config name",
							required: !0
						}), /* @__PURE__ */ X($, {
							inputSize: de ? Q.Large : Q.Medium,
							value: F,
							isDisabled: P,
							onChange: (e) => L(e.target.value),
							placeholder: "SSH-config-1"
						})]
					}) : null,
					/* @__PURE__ */ Z("div", {
						className: "flex flex-col md:flex-row gap-4 items-start w-full",
						children: [/* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1 w-full md:flex-1 min-w-0",
							children: [/* @__PURE__ */ X(lf, {
								label: "SSH Host",
								required: !0,
								hint: "user@host, a host alias from ~/.ssh/config, or an IP."
							}), /* @__PURE__ */ X($, {
								inputSize: de ? Q.Large : Q.Medium,
								value: he,
								isDisabled: P,
								onChange: (e) => ve(e.target.value),
								placeholder: "example@192.0.2.10 or build-box"
							})]
						}), /* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1 w-full md:w-[98px] shrink-0",
							children: [/* @__PURE__ */ X(lf, {
								label: "Port",
								hint: "Blank uses OpenSSH's default (usually 22)."
							}), /* @__PURE__ */ X($, {
								inputSize: de ? Q.Large : Q.Medium,
								value: ge,
								isDisabled: P,
								onChange: (e) => ye(e.target.value),
								placeholder: "22"
							})]
						})]
					}),
					/* @__PURE__ */ Z("div", {
						className: "flex gap-4 items-end w-full",
						children: [/* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1 flex-1 min-w-0",
							children: [/* @__PURE__ */ X(lf, {
								label: "Private Key",
								hint: "A key file on this machine. The default leaves the choice to your ~/.ssh/config and ssh agent."
							}), /* @__PURE__ */ Z(z, {
								size: U.Medium,
								variant: B.Secondary,
								className: "w-full",
								disabled: P,
								onClick: () => ue(!0),
								children: [/* @__PURE__ */ X("span", {
									className: "flex-1 min-w-0 truncate text-left",
									children: _e.trim() || kp
								}), /* @__PURE__ */ X(R, {
									iconName: H.FolderOpen,
									size: 20
								})]
							})]
						}), /* @__PURE__ */ X("div", {
							className: "md:w-[128px] shrink-0 relative",
							children: w ? /* @__PURE__ */ Z(z, {
								size: U.Medium,
								variant: B.Secondary,
								className: "w-full",
								disabled: pe,
								onClick: () => void Te(),
								children: [p ? /* @__PURE__ */ X(ut, { size: bt.Small }) : /* @__PURE__ */ X(R, {
									iconName: H.Bolt,
									size: 20
								}), "Test"]
							}) : fe ? /* @__PURE__ */ X(z, {
								size: U.Medium,
								variant: B.Ghost,
								className: "w-full",
								onClick: we,
								children: "Disconnect"
							}) : /* @__PURE__ */ Z(z, {
								size: U.Medium,
								variant: B.Primary,
								className: "w-full",
								disabled: pe,
								onClick: () => void Ce(),
								children: [pe ? /* @__PURE__ */ X(ut, { size: bt.Small }) : null, "Connect"]
							})
						})]
					}),
					se ? /* @__PURE__ */ X("p", {
						className: "text-micro text-error-primary",
						children: se
					}) : null
				]
			}),
			/* @__PURE__ */ X(lp, {
				open: le,
				kind: "file",
				title: "Select Private Key",
				showHidden: !0,
				initialPath: Ap(_e),
				clearLabel: `Use ${kp}`,
				onClear: () => {
					be(""), ue(!1);
				},
				onClose: () => ue(!1),
				onSelect: (e) => {
					be(e), ue(!1);
				}
			})
		]
	});
}
// src/app/components/modals/SessionBehaviorPicker.tsx
function Lp({ value: e, onChange: t, disabled: n = !1 }) {
	return /* @__PURE__ */ Z("fieldset", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ X("legend", {
				className: "label-small text-basic-primary",
				children: "How should this chat work?"
			}),
			/* @__PURE__ */ X("div", {
				className: "grid grid-cols-1 gap-2 md:grid-cols-3",
				role: "radiogroup",
				children: Aa.map((r, i) => {
					let a = r.id === e;
					return /* @__PURE__ */ Z("button", {
						type: "button",
						role: "radio",
						"aria-checked": a,
						tabIndex: a ? 0 : -1,
						disabled: n,
						className: I("flex min-h-[196px] cursor-pointer flex-col gap-2 rounded-[6px] border p-3 text-left transition-colors", a ? "border-accent-primary bg-accent-secondary" : "border-border-primary bg-elevation-level-1 hover:bg-elevation-level-2", n && "cursor-not-allowed opacity-60"),
						onClick: () => t(r.id),
						onKeyDown: (e) => {
							let n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0, r = e.key === "Home" ? 0 : e.key === "End" ? Aa.length - 1 : n ? (i + n + Aa.length) % Aa.length : null;
							r != null && (e.preventDefault(), t(Aa[r].id), (e.currentTarget.parentElement?.querySelectorAll("[role=\"radio\"]"))?.[r]?.focus());
						},
						children: [
							/* @__PURE__ */ Z("span", {
								className: "flex items-center justify-between gap-2",
								children: [/* @__PURE__ */ X("span", {
									className: "text-small font-medium text-basic-primary",
									children: r.label
								}), r.id === "orchestrator" ? /* @__PURE__ */ X("span", {
									className: "tag-label shrink-0 text-basic-tertiary",
									children: "Default"
								}) : null]
							}),
							/* @__PURE__ */ X("span", {
								className: "text-xs text-basic-secondary",
								children: r.topLevel
							}),
							/* @__PURE__ */ X("span", {
								className: "text-xs text-basic-secondary",
								children: r.editing
							}),
							/* @__PURE__ */ X("span", {
								className: "text-xs text-basic-secondary",
								children: r.delegation
							}),
							/* @__PURE__ */ X("span", {
								className: "mt-auto text-xs text-basic-muted",
								children: r.inspection
							})
						]
					}, r.id);
				})
			}),
			/* @__PURE__ */ X("p", {
				className: "text-micro text-basic-muted",
				children: "Behavior is fixed for the lifetime of this chat. Start a new chat to choose a different behavior."
			})
		]
	});
}
// src/app/features/setup/modelSelection.ts
function Rp(e) {
	return {
		kind: "resolved",
		backend: e.backend,
		model: e.model,
		base_url: e.base_url,
		allow_insecure_http: e.allow_insecure_http ?? !1,
		api_key_env: e.api_key_env ?? null,
		reasoning_effort: e.reasoning_effort ?? null,
		extra_headers: e.extra_headers,
		orchestrator_compaction_threshold: e.orchestrator_compaction_threshold,
		light_model: e.light_model ?? null,
		config_id: e.config_id
	};
}
function zp(e, t) {
	if (e === t) return !0;
	if (e == null || t == null) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Object.hasOwn(t, n) && e[n] === t[n]);
}
function Bp(e, t) {
	return e === void 0 || t === void 0 ? e === t : Uf(e ?? null, t ?? null);
}
function Vp(e, t) {
	if (e === t) return !0;
	if (!e || !t) return !1;
	if (e.kind === "resolved" && t.kind === "resolved") return e.backend === t.backend && e.model === t.model && e.base_url === t.base_url && e.allow_insecure_http === t.allow_insecure_http && e.api_key_env === t.api_key_env && e.reasoning_effort === t.reasoning_effort && zp(e.extra_headers, t.extra_headers) && e.orchestrator_compaction_threshold === t.orchestrator_compaction_threshold && Bp(e.light_model, t.light_model);
	if (e.kind !== "save" || t.kind !== "save") return !1;
	let n = e.request, r = t.request;
	return n.name === r.name && n.backend === r.backend && n.model === r.model && n.base_url === r.base_url && n.allow_insecure_http === r.allow_insecure_http && n.api_key === r.api_key && n.reasoning_effort === r.reasoning_effort && n.initial_prompt === r.initial_prompt && zp(n.extra_headers, r.extra_headers) && n.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && Bp(n.light_model, r.light_model);
}
// src/app/components/modals/PrimaryModelSection.tsx
var Hp = [{
	id: "",
	label: "Model default"
}, ...rp];
function Up({ initial: e, inheritSavedDefault: t = !1, existingSession: n = !1, onChange: r }) {
	let i = Rt(), a = _p(), o = zr(i.data), [s, c] = J(null), l = Ir(t && !e), u = t && !e ? l.data?.configurations.at(-1) : void 0, d = K(() => e ?? (u ? {
		...Rp(u),
		extra_headers: u.extra_headers
	} : void 0), [e, u]), f = Jt(u && !s ? u.config_id : null, ""), p = t && !e && !s && (l.isPending || u && !f.data), m = K(() => d ? {
		pick: {
			backend: d.backend,
			model: d.model,
			baseUrl: d.base_url
		},
		effort: d.reasoning_effort ?? ""
	} : null, [d]), h = a.defaultPick ? o.get(a.defaultPick.backend) : void 0, g = a.configured && a.credentialReady && (i.isPending || h === null), _ = h === void 0 || a.defaultPick && h?.some((e) => e.id === a.defaultPick?.model) ? a.defaultPick : null, v = K(() => mf(i.data), [i.data]), y = K(() => s ?? m ?? (a.configured ? _ ? {
		pick: _,
		effort: ""
	} : null : v ? {
		pick: v,
		effort: ""
	} : null), [
		s,
		m,
		v,
		_,
		a.configured
	]), b = i.data?.providers.find((e) => e.id === y?.pick.backend), x = !!(d && y && y.pick.backend === d.backend), S = !!(b?.auth_status === "ready" || y && a.matches(y.pick) && a.credentialReady), C = y ? a.matches(y.pick) : !1, w = C && y ? o.get(y.pick.backend) : void 0, T = K(() => {
		if (p || !y || !y.pick.baseUrl) return null;
		let e = !!(n && d && x && y.pick.model === d.model);
		if (!e && (a.initializing || g)) return null;
		if (!e && C) {
			let e = w;
			if (!a.credentialReady || e === null || e && !e.some((e) => e.id === y.pick.model)) return null;
		}
		return !e && !cr(y.pick.backend) && !S ? null : x && d ? {
			kind: "resolved",
			backend: y.pick.backend,
			model: y.pick.model,
			base_url: d.base_url,
			allow_insecure_http: d.allow_insecure_http ?? !1,
			api_key_env: d.api_key_env,
			reasoning_effort: y.effort || null,
			extra_headers: d.extra_headers,
			light_model: d.light_model,
			orchestrator_compaction_threshold: d.orchestrator_compaction_threshold,
			config_id: d.config_id
		} : S ? {
			kind: "resolved",
			backend: y.pick.backend,
			model: y.pick.model,
			base_url: y.pick.baseUrl,
			allow_insecure_http: !1,
			api_key_env: b?.connection?.api_key_env ?? null,
			reasoning_effort: y.effort || null,
			extra_headers: null,
			light_model: void 0
		} : null;
	}, [
		y,
		d,
		n,
		x,
		b,
		S,
		a.initializing,
		a.credentialReady,
		C,
		g,
		w,
		p
	]);
	G(() => r(T), [r, T]);
	let E = op(yf(i.data, y?.pick.backend, y?.pick.model).supportedEfforts, y?.effort ?? "", Hp);
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
		children: [
			/* @__PURE__ */ X(lf, {
				label: "Primary model",
				hint: "Search one catalog across every connected provider. Provider accounts and advanced presets are managed separately below."
			}),
			/* @__PURE__ */ X(uf, {
				label: "Model",
				required: !0,
				verticalOnMobile: !0,
				control: /* @__PURE__ */ X(Af, {
					catalog: i.data,
					loading: i.isLoading,
					failed: i.isError,
					liveByBackend: o,
					value: y?.pick ?? null,
					onSelect: (e) => {
						let t = yf(i.data, e.backend, e.model).supportedEfforts, n = y?.effort ?? "";
						c({
							pick: e,
							effort: n && !t.includes(n) ? "" : n
						});
					}
				})
			}),
			/* @__PURE__ */ X(uf, {
				label: "Reasoning",
				hint: "Stored with this chat and switchable independently of provider setup.",
				control: /* @__PURE__ */ X(dp, {
					items: E,
					value: y?.effort ?? "",
					placeholder: "Model default",
					disabled: !y,
					onValueChange: (e) => {
						y && c({
							...y,
							effort: e
						});
					}
				})
			}),
			u && f.isError ? /* @__PURE__ */ X("p", {
				role: "alert",
				className: "text-micro text-error-primary",
				children: "The saved project setup could not be resolved. Review it in Advanced or choose another model."
			}) : null,
			y && !x && !S ? /* @__PURE__ */ Z("p", {
				className: "text-micro text-error-primary",
				role: "alert",
				children: [
					"Connect ",
					rn(y.pick.backend),
					" in Provider connections or Advanced before selecting this model."
				]
			}) : null
		]
	});
}
// src/app/features/managed/presentation/ProviderConnections.tsx
function Wp() {
	return /* @__PURE__ */ Z("section", {
		"aria-label": "Provider connections",
		className: "flex flex-col gap-3",
		children: [
			/* @__PURE__ */ X("p", {
				className: "text-micro text-basic-muted",
				children: "Connect another account without changing this chat or signing out of your current provider. API keys and custom endpoints are available in Advanced provider setup."
			}),
			/* @__PURE__ */ X(Bf, { backend: "arcee-auth" }),
			/* @__PURE__ */ X(Bf, { backend: "chatgpt-codex-responses" })
		]
	});
}
// src/app/features/setup/ModelSetupSection.tsx
function Gp({ initial: e, onChange: t, invalid: n, errorText: r, children: i, simple: a = !0, inheritSavedDefault: o = !1, existingSession: s = !1 }) {
	let [c, l] = J(!a), [u, d] = J(!1), [f, p] = J(!1), m = q(null), [h, g] = J(e), _ = W((e) => {
		m.current = e, p(e?.kind === "save"), t(e, "preset");
	}, [t]), v = W((e) => {
		let n = m.current;
		if (e?.kind === "resolved" && n?.kind === "resolved") {
			let t = e.backend === n.backend && e.model === n.model && e.base_url === n.base_url && e.allow_insecure_http === n.allow_insecure_http && e.api_key_env === n.api_key_env && e.reasoning_effort === n.reasoning_effort && JSON.stringify(e.extra_headers) === JSON.stringify(n.extra_headers);
			e = {
				...e,
				light_model: n.light_model,
				orchestrator_compaction_threshold: n.orchestrator_compaction_threshold,
				config_id: t ? n.config_id : void 0
			};
		}
		m.current = e, p(e?.kind === "save"), t(e, "primary");
	}, [t]);
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-3",
		children: [
			c ? /* @__PURE__ */ X(Cp, {
				initial: h,
				invalid: n,
				onChange: _,
				children: i
			}) : /* @__PURE__ */ X(Up, {
				inheritSavedDefault: o,
				existingSession: s,
				initial: h,
				onChange: v
			}),
			/* @__PURE__ */ X(z, {
				variant: B.Secondary,
				"aria-expanded": u,
				onClick: () => d((e) => !e),
				children: "Provider connections"
			}),
			u ? /* @__PURE__ */ X(Wp, {}) : null,
			/* @__PURE__ */ X(z, {
				variant: B.Secondary,
				"aria-expanded": c,
				onClick: () => {
					let e = m.current;
					e?.kind === "resolved" && g({
						...e,
						extra_headers: e.extra_headers ?? {}
					}), !(e?.kind === "save" && c) && l((e) => !e);
				},
				disabled: c && f,
				children: c ? "Back to unified models" : "Advanced presets and provider setup"
			}),
			!c && i ? /* @__PURE__ */ Z("details", {
				className: "text-micro",
				children: [/* @__PURE__ */ X("summary", {
					className: "cursor-pointer py-2",
					children: "Advanced execution settings"
				}), i]
			}) : null,
			r ? /* @__PURE__ */ X("p", {
				role: "alert",
				className: "text-micro text-error-primary",
				children: r
			}) : null
		]
	});
}
// src/app/features/setup/workflow.ts
var Kp = class extends Ge("SetupFailure") {};
function qp(e) {
	return e instanceof Kp && (e.kind === "unknown" || e.kind === "conflict" || e.completed.length > 0);
}
function Jp(e, t) {
	return pr(() => {
		let n = [];
		return t((t, r, i = !0) => xe(function* () {
			if (!e.current()) return yield* fe(new Kp({
				phase: t,
				kind: "cancelled",
				cause: null,
				completed: [...n]
			}));
			let a = yield* wt({
				try: r,
				catch: (r) => {
					let i = e.classify(r, t);
					return new Kp({
						phase: t,
						kind: t === "read" && i === "unknown" ? "rejected" : i,
						cause: r,
						completed: [...n]
					});
				}
			}).pipe(kt(() => i ? d(() => e.reconcile(t)) : Ee));
			return i && (n.push(t), yield* d(() => e.reconcile(t))), a;
		}));
	});
}
function Yp(e) {
	return Jp(e, (t) => xe(function* () {
		let n = yield* t("preset", e.model, e.persistsModel ?? !0), r = yield* t("project", () => e.project(n));
		return {
			model: n,
			project: r,
			chat: yield* t("chat", () => e.chat(n, r))
		};
	}));
}
function Xp(e) {
	return Jp(e, (t) => xe(function* () {
		if (e.existing) {
			let n = yield* t("read", e.existing, !1);
			if (n !== null) return n;
		}
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("chat", () => e.chat(n));
	}));
}
function Zp(e) {
	return Jp(e, (t) => xe(function* () {
		yield* t("read", e.check, !1);
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("configuration", () => e.configuration(n), e.configurationSaved ?? !0), e.title && (yield* t("title", e.title)), e.projectDefault && (yield* t("default", () => e.projectDefault(n))), n;
	}));
}
async function Qp(e) {
	let t = await lt(e);
	if (Sr(t)) return t.value;
	let n = An(t.cause);
	throw Mr(n) ? n.value : Wt(t.cause);
}
// src/app/features/setup/useSetupAction.ts
function $p(e = !0) {
	let t = Nf(e), n = q(!1), r = q(!1), [i, a] = J(!1), [o, s] = J(!1);
	return {
		busy: i,
		needsReview: o,
		run: async (e) => {
			let i = t.current;
			if (!(!i?.current() || n.current || r.current)) {
				n.current = !0, a(!0);
				try {
					let t = await Qp(e(i));
					return i.current() ? t : void 0;
				} catch (e) {
					if (!i.current()) return;
					throw qp(e) && (r.current = !0, s(!0)), e;
				} finally {
					n.current = !1, i.current() && a(!1);
				}
			}
		}
	};
}
// src/app/features/setup/browserAdapters.ts
var em = class extends Error {}, tm = class extends Error {
	constructor() {
		super("This chat's settings changed. Reopen settings to review the current values before saving.");
	}
};
function nm(e, t) {
	return e instanceof em ? "rejected" : e instanceof tm ? "conflict" : e instanceof Ot ? t === "project" && e.status === 409 ? "rejected" : e.status === 409 ? "conflict" : e.status >= 500 ? "unknown" : "rejected" : "unknown";
}
function rm(e) {
	if (!(e instanceof Kp)) return nf(Ud(e));
	if (e.kind === "cancelled") return "This setup view was closed.";
	let t = e.completed.includes("configuration") ? "Chat settings were saved. " : e.completed.includes("project") ? "The project was saved. " : e.completed.includes("preset") ? "The preset was saved. " : "";
	return e.kind === "unknown" ? `${t}The ${e.phase} save outcome is unknown. Refresh and review the saved values before trying again.` : e.kind === "conflict" ? `${t}The ${e.phase} changed or is busy. Refresh and review before saving again. ${nf(Ud(e.cause))}` : `${t}${nf(Ud(e.cause))}${e.completed.length ? " Reopen setup to review the saved values before continuing." : ""}`;
}
function im(e, t) {
	return async (n) => {
		let r = n === "preset" ? [
			on.modelConfigs,
			on.modelCatalog,
			on.credentials
		] : n === "project" || n === "default" ? [on.projects] : t ? [
			on.sessionConfig(t),
			on.sessionSnapshot(t),
			on.sessionsAll
		] : [on.sessionsAll];
		await Promise.all(r.map((t) => e.invalidateQueries({ queryKey: t })));
	};
}
// src/app/features/setup/projectLaunch.ts
function am(e) {
	let { selected: t, policy: n, light: r, sandbox: i } = e, a = {
		project_id: e.projectId,
		behavior: Pt(n, e.behavior),
		first_chat: !0,
		first_chat_same_behavior: !n.orchestrationEnabled,
		backend: t.backend,
		model: t.model,
		base_url: t.base_url,
		allow_insecure_http: t.allow_insecure_http,
		api_key_env: t.api_key_env,
		reasoning_effort: e.reasoning === "__clear__" ? null : e.reasoning || t.reasoning_effort || null,
		light_model: n.orchestrationEnabled ? r.mode === "dual" && r.light ? Vf(r.light, t.backend, t.api_key_env) : null : e.savedLight ?? null
	}, o = e.headers ?? t.extra_headers ?? void 0;
	return o !== void 0 && (a.extra_headers = o), e.presetCompaction && t.orchestrator_compaction_threshold !== void 0 ? a.orchestrator_compaction_threshold = t.orchestrator_compaction_threshold : Jf(e.compaction) !== null && (a.orchestrator_compaction_threshold = Number(e.compaction)), e.execution !== "ssh" && (a.sandbox = {
		enabled: e.execution === "sandbox",
		no_mount_cwd: i.noMount,
		image: Jf(i.image),
		gpus: Yf(i.gpu),
		workdir: Jf(i.workdir),
		shm_size: Jf(i.shm),
		mounts: Yf(i.mounts),
		mounts_ro: [],
		activity_key: e.activityKey
	}), a;
}
// src/app/components/modals/CreateProjectModal.tsx
var om = [
	{
		id: "local",
		label: "Local",
		description: "Runs on this machine with access to local files."
	},
	{
		id: "ssh",
		label: "SSH",
		description: "Runs on a connected remote machine."
	},
	{
		id: "sandbox",
		label: "Sandbox",
		description: "Runs in an isolated environment with limited access."
	}
], sm = ip.map((e) => e.id === "" ? {
	...e,
	label: "From configuration"
} : e), cm = { paddingInline: "8px" }, lm = {
	noMount: !1,
	image: "",
	gpu: "",
	workdir: "",
	shm: "",
	mounts: ""
};
function um({ open: e, onClose: t }) {
	let { data: n } = kn();
	return cp(e) ? /* @__PURE__ */ X(dm, {
		open: e,
		defaultCwd: n?.root_cwd ?? "",
		onClose: t
	}, e ? "open" : "closing") : null;
}
function dm({ open: e, defaultCwd: t, onClose: n }) {
	let { loadLastLight: r, storeLastLight: i } = V().stores.lastLight, a = ji(), o = nr(), s = $p(e), c = Si(), l = ft(), u = vr(), d = $t(), [f, p] = J("local"), m = Tt(), [h, _] = J(m.orchestrationEnabled ? "orchestrator" : "direct"), [v, y] = J(t), [b, x] = J(""), [S, C] = J(""), [w, T] = J(""), [E, D] = J(""), [O, k] = J(lm), [ee, A] = J(!1), [te, j] = J(!1), [ne, re] = J(!1), [ie, ae] = J(null), [oe, se] = J({
		mode: "single",
		light: null
	}), [ce, le] = J(null), [ue, de] = J(""), [fe, pe] = J(null), P = q(""), me = q(!0), F = q(!1), he = Rt(), ge = ie?.kind === "save" ? ie.request : ie ?? null, _e = op(yf(he.data, ge?.backend, ge?.model).supportedEfforts, S, sm), L = N(), ve = f === "ssh", ye = gr(f === "sandbox").data, be = ve ? fe : null, xe = !ve || be !== null, Se = s.busy, [Ce, we] = J(null), Te = u.isPending && f === "sandbox", Ee = $n(Te, Ce).data, De = Ee?.since_epoch_ms, [Oe, ke] = J(0);
	G(() => {
		if (!Te) return;
		let e = setInterval(() => {
			ke(De ? Math.max(0, Math.floor((Date.now() - De) / 1e3)) : 0);
		}, 1e3);
		return () => clearInterval(e);
	}, [Te, De]);
	let Ae = (e) => (t) => {
		le(null), e(t);
	}, je = (e) => {
		le(null), k((t) => ({
			...t,
			...e
		}));
	}, Me = q(null), Ne = W((e, t) => {
		if (ae(e), !e || Vp(Me.current, e)) return;
		let n = Me.current;
		if (Me.current = e, t === "primary" && n?.kind === "resolved") le((e) => e?.field === "config" ? null : e);
		else {
			if (e?.kind === "resolved" && e.orchestrator_compaction_threshold !== void 0) {
				let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
				F.current = !0, me.current = !1, P.current = n, T(n);
			} else {
				let e = F.current;
				F.current = !1, e && (me.current = !0, P.current = "", T(""));
			}
			le((e) => e?.field === "config" ? null : e);
		}
	}, []), Pe = W((e) => {
		se(e), le((e) => e?.field === "config" ? null : e);
	}, []), Fe = K(() => r(), [r]), Ie = ie?.kind === "resolved" && ie.light_model !== void 0 ? ie.light_model : Fe, Le = JSON.stringify(Ie), Re = K(() => {
		let e = yf(he.data, ge?.backend, ge?.model).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		he.data,
		ge?.backend,
		ge?.model
	]);
	G(() => {
		!F.current && Re !== "auto" && (P.current === "" || me.current) && (me.current = !0, P.current = Re, T(Re));
	}, [Re, ie]);
	let ze = (e) => {
		le(null), F.current = !1, me.current = !1, P.current = e, T(e);
	}, Be = (e) => {
		e !== f && (le(null), p(e), pe(null), y(e === "ssh" ? "" : t));
	}, Ve = (e, t) => {
		le(null), pe(e), e ? t && y(t) : y("");
	}, He = async () => {
		if (s.needsReview || Se) return;
		if (ve && !be) {
			le({
				field: "ssh",
				message: "Connect to the SSH host before creating a project."
			});
			return;
		}
		if (!Jf(v)) {
			le({
				field: "cwd",
				message: "A working folder is required."
			});
			return;
		}
		if (!ie) {
			le({
				field: "config",
				message: "Complete the provider configuration before creating a project."
			});
			return;
		}
		if (m.orchestrationEnabled && oe.mode === "dual" && !oe.light) {
			le({
				field: "config",
				message: "Pick the light model before creating a project."
			});
			return;
		}
		let e;
		try {
			e = Qf(E, void 0);
		} catch (e) {
			le({
				field: "config",
				message: Vt(Ud(e))
			});
			return;
		}
		let t = null;
		try {
			let r = await s.run((n) => Yp({
				current: n.current,
				classify: nm,
				reconcile: im(c),
				persistsModel: ie.kind === "save",
				model: async () => {
					if (ie.kind === "save") {
						let e = oe.mode === "dual" && oe.light ? {
							...ie.request,
							light_model: oe.light
						} : ie.request, t = Rp(await d.mutateAsync(e));
						return n.current() && ae(t), t;
					}
					return ie;
				},
				project: async (e) => {
					let n = await l.mutateAsync({
						name: Jf(b),
						cwd: v,
						ssh_host: be?.ssh_host ?? null,
						ssh_port: be?.ssh_port ?? null,
						ssh_identity_file: be?.ssh_identity_file ?? null,
						default_model_config_id: e.config_id ?? null
					});
					return t = n.project_id, n;
				},
				chat: async (t, r) => {
					let i = f === "sandbox" ? crypto.randomUUID() : null;
					n.current() && we(i);
					let a = am({
						selected: t,
						projectId: r.project_id,
						policy: m,
						behavior: h,
						reasoning: S,
						headers: e,
						compaction: w,
						presetCompaction: F.current,
						savedLight: Ie,
						light: oe,
						execution: be ? "ssh" : f,
						sandbox: O,
						activityKey: i
					});
					return {
						snapshot: await u.mutateAsync(a),
						launchLight: a.light_model ?? null,
						apiKeyEnv: t.api_key_env
					};
				}
			}));
			if (!r) return;
			let { snapshot: p, launchLight: g, apiKeyEnv: _ } = r.chat;
			i(g && Hf(g, _)), o.success("Project created"), a(p.metadata.session_id ? fn.session(p.metadata.session_id) : fn.project(r.project.project_id)), n();
		} catch (e) {
			if (t && e instanceof Kp && e.kind !== "unknown") o.error(`Project created, but the first chat failed: ${rm(e)}`), a(fn.project(t)), n();
			else {
				let t = rm(e);
				qp(e) && de(t), le({
					field: e instanceof Kp && e.phase === "project" && e.kind === "rejected" ? "cwd" : "config",
					message: t
				});
			}
		}
	}, Ue = (e) => ce?.field === e;
	return /* @__PURE__ */ Z(Xn, {
		open: e,
		onClose: n,
		title: "New Project",
		size: Tn.Wide,
		flush: !0,
		className: "h-[680px]",
		footer: L ? /* @__PURE__ */ X(Zr, {
			variant: B.Primary,
			content: g.Text,
			onClick: He,
			loading: Se,
			disabled: Se || s.needsReview || !!ce || !ie || !xe,
			children: "Create Project"
		}) : /* @__PURE__ */ X(z, {
			variant: B.Primary,
			size: U.Large,
			content: g.Text,
			onClick: He,
			loading: Se,
			disabled: Se || s.needsReview || !!ce || !ie || !xe,
			children: "Create Project"
		}),
		children: [/* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-8 md:gap-6 [&>*]:shrink-0",
			children: [
				m.orchestrationEnabled ? /* @__PURE__ */ X(Lp, {
					value: h,
					onChange: _,
					disabled: Se
				}) : null,
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-1",
					children: [
						/* @__PURE__ */ X(lf, {
							label: "Environment",
							hint: "Where NAC runs commands and accesses files."
						}),
						/* @__PURE__ */ X("div", {
							className: "flex items-start gap-3",
							children: om.map((e) => /* @__PURE__ */ X(z, {
								variant: f === e.id ? B.Primary : B.Secondary,
								size: U.Medium,
								content: g.Text,
								onClick: () => Be(e.id),
								"aria-pressed": f === e.id,
								className: `${L ? "!rounded-full" : ""}`,
								children: e.label
							}, e.id))
						}),
						/* @__PURE__ */ X("p", {
							className: "pt-1 text-micro text-basic-muted",
							children: om.find((e) => e.id === f)?.description
						}),
						f === "sandbox" && ye && ye.status !== "ready" ? /* @__PURE__ */ Z("div", {
							className: "pt-1",
							children: [/* @__PURE__ */ X("p", {
								className: "text-error-primary text-micro",
								children: ye.status === "missing" ? "Sandbox mode runs sessions in a podman container, and podman is not installed on this machine." : `Sandbox mode needs podman, which is not responding${ye.detail ? `: ${ye.detail}` : "."}`
							}), ye.guidance ? /* @__PURE__ */ X("pre", {
								className: "pt-1 whitespace-pre-wrap font-mono text-micro text-basic-muted",
								children: ye.guidance
							}) : null]
						}) : null
					]
				}),
				ve ? /* @__PURE__ */ X(Ip, {
					mode: "launch",
					connection: fe,
					onConnectionChange: Ve
				}) : null,
				xe ? /* @__PURE__ */ Z("div", {
					className: "flex flex-col md:flex-row items-start gap-6 md:gap-4",
					children: [/* @__PURE__ */ Z("div", {
						className: "flex flex-col gap-1 flex-1 min-w-0 w-full",
						children: [
							/* @__PURE__ */ X(lf, {
								label: "Working Folder",
								hint: ve ? "The project folder NAC works within on the SSH host." : "The project folder NAC works within.",
								required: !0,
								invalid: Ue("cwd")
							}),
							/* @__PURE__ */ Z(z, {
								variant: B.Secondary,
								size: L ? U.Large : U.Medium,
								content: g.IconRight,
								className: I("w-full", Ue("cwd") && "input-validation"),
								style: cm,
								onClick: () => re(!0),
								children: [/* @__PURE__ */ X("span", {
									className: I("flex-1 min-w-0 truncate text-left font-normal", v ? "text-basic-primary" : "text-basic-muted"),
									children: v || "/path/to/project"
								}), /* @__PURE__ */ X(R, {
									iconName: H.Folder,
									className: "shrink-0"
								})]
							}),
							Ue("cwd") ? /* @__PURE__ */ X("p", {
								className: "pt-1 text-error-primary text-micro",
								children: ce?.message
							}) : null
						]
					}), /* @__PURE__ */ Z("div", {
						className: "flex flex-col gap-1 flex-1 min-w-0 w-full",
						children: [/* @__PURE__ */ X(lf, { label: "Project name" }), /* @__PURE__ */ X($, {
							inputSize: L ? Q.Large : Q.Medium,
							placeholder: "Taken from the git remote",
							value: b,
							onChange: (e) => Ae(x)(e.target.value),
							className: `${L ? "w-full" : ""}`
						})]
					})]
				}) : null,
				xe ? /* @__PURE__ */ X(Gp, {
					simple: !m.orchestrationEnabled,
					inheritSavedDefault: !0,
					invalid: Ue("config"),
					errorText: ue || (Ue("config") ? ce?.message : void 0),
					onChange: Ne,
					children: /* @__PURE__ */ Z("div", {
						className: "flex flex-col gap-2",
						children: [
							m.orchestrationEnabled ? /* @__PURE__ */ X(Dp, {
								initial: Ie,
								behavior: h,
								onChange: Pe
							}, Le) : null,
							/* @__PURE__ */ X(nd, {}),
							/* @__PURE__ */ X(uf, {
								label: "Reasoning Effort",
								hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
								control: ((e, t, n, r = !1) => /* @__PURE__ */ X(Xu, {
									items: e,
									value: t,
									onValueChange: n,
									disabled: r,
									size: U.Medium,
									variant: B.Ghost,
									placement: M.BottomLeft,
									sticky: !0,
									panelClassName: "max-h-64 overflow-auto min-w-[220px]"
								}))(_e, S, Ae(C))
							}),
							/* @__PURE__ */ X(nd, {}),
							/* @__PURE__ */ X(uf, {
								label: "Context Limit",
								hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
								control: /* @__PURE__ */ Z("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ X($, {
										inputSize: L ? Q.Large : Q.Medium,
										className: "w-full md:w-[120px]",
										inputClassName: "md:text-right",
										placeholder: Re,
										inputMode: "numeric",
										value: w,
										onChange: (e) => ze(e.target.value)
									}), /* @__PURE__ */ X("span", {
										className: "shrink-0 text-micro text-basic-muted",
										children: "tokens"
									})]
								})
							}),
							f === "sandbox" ? /* @__PURE__ */ Z(Y, { children: [
								/* @__PURE__ */ X(nd, {}),
								/* @__PURE__ */ X(uf, {
									label: "Sandbox options",
									hint: "The container the session runs in: image, GPUs, workdir, shared memory and mounts.",
									control: /* @__PURE__ */ X(pd, {
										checked: te,
										onChange: j,
										"aria-label": "Sandbox options"
									})
								}),
								te ? /* @__PURE__ */ Z(Y, { children: [
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "Container image",
										hint: "Image the sandbox runs; empty uses the configured default.",
										control: /* @__PURE__ */ X($, {
											inputSize: Q.Medium,
											className: "w-[181px]",
											placeholder: "python:3.13-bookworm",
											value: O.image,
											onChange: (e) => je({ image: e.target.value })
										})
									}),
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "GPUs",
										hint: "Comma-separated GPU list, e.g. all.",
										control: /* @__PURE__ */ X($, {
											inputSize: Q.Medium,
											className: "w-[181px]",
											placeholder: "all",
											value: O.gpu,
											onChange: (e) => je({ gpu: e.target.value })
										})
									}),
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "Container workdir",
										hint: "Working directory inside the container.",
										control: /* @__PURE__ */ X($, {
											inputSize: Q.Medium,
											className: "w-[181px]",
											placeholder: "/workspace",
											value: O.workdir,
											onChange: (e) => je({ workdir: e.target.value })
										})
									}),
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "Shared memory size",
										hint: "Container /dev/shm size, e.g. 1g.",
										control: /* @__PURE__ */ X($, {
											inputSize: Q.Medium,
											className: "w-[181px]",
											placeholder: "0",
											value: O.shm,
											onChange: (e) => je({ shm: e.target.value })
										})
									}),
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "Mounts (HOST:GUEST)",
										hint: "Comma-separated bind mounts.",
										control: /* @__PURE__ */ X($, {
											inputSize: Q.Medium,
											className: "w-[181px]",
											placeholder: "/data:/data",
											value: O.mounts,
											onChange: (e) => je({ mounts: e.target.value })
										})
									}),
									/* @__PURE__ */ X(nd, {}),
									/* @__PURE__ */ X(uf, {
										label: "Don't mount the working folder",
										secondary: !0,
										control: /* @__PURE__ */ X(pd, {
											checked: O.noMount,
											onChange: (e) => je({ noMount: e }),
											"aria-label": "Don't mount the working folder",
											size: L ? ld.Large : ld.Medium
										})
									})
								] }) : null
							] }) : null,
							/* @__PURE__ */ X(nd, {}),
							/* @__PURE__ */ X(uf, {
								label: "Custom HTTP headers",
								hint: "Turn this on only if you need to send additional request metadata.",
								control: /* @__PURE__ */ X(pd, {
									checked: ee,
									onChange: A,
									"aria-label": "Custom HTTP headers"
								})
							}),
							ee ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(nd, {}), /* @__PURE__ */ X(tu, {
								label: "Extra headers (JSON object)",
								hintText: "Blank keeps the configuration's headers. Enter {} to send none; header values must be strings.",
								placeholder: "{\"X-Title\": \"NAC\"}",
								value: E,
								onChange: (e) => Ae(D)(e.target.value),
								textAreaClassName: "h-[108px] resize-none"
							})] }) : null
						]
					})
				}) : null,
				Te ? /* @__PURE__ */ Z("div", {
					className: "flex items-center gap-2",
					role: "status",
					"aria-live": "polite",
					children: [/* @__PURE__ */ X("span", {
						className: "text-micro text-basic-primary",
						children: Ee?.phase ?? "Creating the sandbox…"
					}), /* @__PURE__ */ Z("span", {
						className: "text-micro text-basic-muted",
						children: [Oe, "s"]
					})]
				}) : null
			]
		}), /* @__PURE__ */ X(lp, {
			open: ne,
			kind: "directory",
			initialPath: v.trim(),
			ssh: be,
			onClose: () => re(!1),
			onSelect: (e) => {
				Ae(y)(e), re(!1);
			}
		})]
	});
}
// src/app/components/modals/NewChatModal.tsx
function fm(e) {
	if (!e) return {};
	try {
		let t = JSON.parse(e);
		return Object(t) !== t || Array.isArray(t) ? {} : t;
	} catch {
		return {};
	}
}
function pm(e) {
	return {
		initial: {
			backend: e.backend,
			model: e.model,
			base_url: e.base_url,
			allow_insecure_http: e.allow_insecure_http,
			api_key_env: e.api_key_env ?? null,
			reasoning_effort: e.reasoning_effort ?? null,
			extra_headers: e.extra_headers,
			orchestrator_compaction_threshold: e.orchestrator_compaction_threshold,
			light_model: e.light_model ?? null,
			config_id: e.config_id
		},
		light: e.light_model ?? null
	};
}
function mm(e, t) {
	return {
		initial: {
			backend: e.backend ?? t,
			model: e.model,
			base_url: e.base_url,
			allow_insecure_http: e.allow_insecure_http,
			api_key_env: e.api_key_env ?? null,
			reasoning_effort: e.reasoning_effort ?? null,
			extra_headers: fm(e.extra_headers_json),
			orchestrator_compaction_threshold: e.orchestrator_compaction_threshold,
			light_model: e.light_model ?? null
		},
		light: e.light_model ?? null
	};
}
function hm({ projectId: e, firstChat: t = !1, onClose: n }) {
	return !cp(e !== null) || e === null ? null : /* @__PURE__ */ X(gm, {
		projectId: e,
		firstChat: t,
		onClose: n
	}, e);
}
function gm({ projectId: e, firstChat: t, onClose: n }) {
	let { api: r } = V(), i = ji(), a = $p(), o = Si(), s = vr(), c = $t(), l = _t(), u = Zn(), d = Ir(), f = Tt(), [p, m] = J(f.orchestrationEnabled ? "orchestrator" : "direct"), [h, g] = J(null), [_, v] = J({
		mode: "single",
		light: null
	}), [y, b] = J(""), x = l.data?.projects.find((t) => t.project_id === e) ?? null, S = Ed(u.data ?? [], e), C = x?.default_model_config_id ? d.data?.configurations.find((e) => e.config_id === x.default_model_config_id) ?? null : null, w = sn(x?.default_model_config_id ? null : S?.summary.session_id ?? null), T = K(() => C ? pm(C) : w.data && S ? mm(w.data, S.summary.backend) : null, [
		C,
		w.data,
		S
	]), E = l.isPending || u.isPending || d.isPending || !!S && !x?.default_model_config_id && w.isPending, D = l.error || u.error || w.error || x?.default_model_config_id && (d.error || !d.isPending && !C ? /* @__PURE__ */ Error("The project default is unavailable. Review the project settings before creating a chat.") : null), O = a.busy, k = W((e) => {
		g(e), b((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), ee = W((e) => {
		v(e), b((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), A = h?.kind === "resolved" && h.light_model !== void 0 ? h.light_model : T?.light, te = JSON.stringify(A), j = async () => {
		if (!(O || a.needsReview || E || D)) {
			if (!h) b("Choose the primary model before creating this chat.");
			else if (f.orchestrationEnabled && _.mode === "dual" && !_.light) b("Pick the light model before creating this chat.");
			else try {
				let l = await a.run((n) => Xp({
					current: n.current,
					classify: nm,
					reconcile: im(o),
					existing: t ? async () => {
						let [t, i] = await Promise.all([r.listProjects(n.signal), r.listSessions({ projectId: e }, n.signal)]);
						if (!t.projects.some((t) => t.project_id === e)) return fn.list();
						let a = Td(cn(f, i), e);
						return a ? fn.session(a.summary.session_id) : null;
					} : void 0,
					persistsModel: h.kind === "save",
					model: async () => {
						let e;
						if (h.kind === "save") {
							let t = await c.mutateAsync({
								...h.request,
								light_model: f.orchestrationEnabled ? _.mode === "dual" ? _.light : null : A ?? null
							});
							n.current() && g({
								kind: "resolved",
								...t,
								backend: t.backend,
								api_key_env: t.api_key_env ?? null,
								reasoning_effort: t.reasoning_effort ?? null,
								light_model: t.light_model ?? null
							}), e = {
								backend: t.backend,
								model: t.model,
								base_url: t.base_url,
								allow_insecure_http: t.allow_insecure_http ?? !1,
								api_key_env: t.api_key_env ?? null,
								reasoning_effort: t.reasoning_effort ?? null,
								extra_headers: t.extra_headers,
								orchestrator_compaction_threshold: t.orchestrator_compaction_threshold ?? null
							};
						} else e = h;
						return e;
					},
					chat: async (n) => {
						let r = f.orchestrationEnabled ? _.mode === "dual" && _.light ? Vf(_.light, n.backend, n.api_key_env) : null : A ?? null, i = {
							project_id: e,
							behavior: Pt(f, p),
							first_chat: t && Ke(f, u.data ?? [], e),
							first_chat_same_behavior: !f.orchestrationEnabled,
							backend: n.backend,
							model: n.model,
							base_url: n.base_url,
							allow_insecure_http: n.allow_insecure_http,
							api_key_env: n.api_key_env,
							reasoning_effort: n.reasoning_effort,
							extra_headers: n.extra_headers,
							light_model: r
						};
						n.orchestrator_compaction_threshold !== void 0 && (i.orchestrator_compaction_threshold = n.orchestrator_compaction_threshold);
						let a = await s.mutateAsync(i);
						return a.metadata.session_id ? fn.session(a.metadata.session_id) : fn.project(e);
					}
				}));
				l && (n(), i(l, { replace: t }));
			} catch (e) {
				b(rm(e));
			}
		}
	};
	return /* @__PURE__ */ Z(Xn, {
		open: !0,
		onClose: n,
		size: Tn.Wide,
		flush: !0,
		className: "h-[700px]",
		title: "New Chat",
		subheader: f.orchestrationEnabled ? "Choose this chat's behavior and models. These settings apply to this chat without changing the project default." : "Choose this chat's model. These settings apply to this chat without changing the project default.",
		footer: /* @__PURE__ */ X(z, {
			variant: B.Primary,
			loading: O,
			disabled: O || a.needsReview || E || !!D || !h,
			onClick: () => void j(),
			children: "Create chat"
		}),
		children: [f.orchestrationEnabled ? /* @__PURE__ */ X(Lp, {
			value: p,
			onChange: m,
			disabled: O
		}) : null, D ? /* @__PURE__ */ X("p", {
			role: "alert",
			className: "text-micro text-error-primary",
			children: "The inherited settings could not be loaded. Reopen New Chat to refresh and review them."
		}) : E ? /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-2 py-6 text-micro text-basic-muted",
			role: "status",
			children: [/* @__PURE__ */ X(ut, { size: bt.XSmall }), "Loading the project's model settings…"]
		}) : /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-3",
			children: [
				/* @__PURE__ */ Z("p", {
					className: "text-micro text-basic-muted",
					children: [
						C ? "Inherited from the project default" : T ? "Inherited from the latest chat" : "No saved project model default",
						T ? `: ${T.initial.model} · ${T.initial.backend} · reasoning ${T.initial.reasoning_effort ?? "model default"}.` : ".",
						" ",
						"Changes below override this chat only."
					]
				}),
				/* @__PURE__ */ X(Gp, {
					initial: T?.initial,
					onChange: k,
					invalid: !!y,
					errorText: y || void 0
				}),
				f.orchestrationEnabled ? /* @__PURE__ */ X(Dp, {
					initial: A,
					behavior: p,
					onChange: ee
				}, te) : null
			]
		})]
	});
}
// src/app/components/modals/DeleteProjectModal.tsx
var _m = (e) => e === 1 ? "chat" : "chats";
function vm({ open: e, onClose: t, project: n }) {
	let r = nr(), i = ji(), a = Ai(), o = oe(), s = N(), c = async (e) => {
		if (n && !o.isPending) try {
			let s = await o.mutateAsync({
				projectId: n.project_id,
				sessions: e
			}), c = s?.deleted_session_ids ?? [], l = sr(a.pathname);
			(a.pathname.startsWith(`/project/${encodeURIComponent(n.project_id)}`) || l && c.includes(l)) && i(fn.list(), { replace: !0 });
			let u = s?.released_session_ids?.length ?? 0, d = c.length;
			r.success(d > 0 ? `Project and ${d} ${_m(d)} removed` : u > 0 ? `Project removed; ${u} ${_m(u)} kept` : "Project removed"), t();
		} catch (e) {
			r.error(`Failed to delete: ${Vt(Ud(e))}`);
		}
	};
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: t,
		title: "Remove Project?",
		size: Tn.Medium,
		footer: /* @__PURE__ */ Z(Y, { children: [
			!s && /* @__PURE__ */ X(z, {
				variant: B.Tertiary,
				content: g.Text,
				onClick: t,
				disabled: o.isPending,
				children: "Cancel"
			}),
			/* @__PURE__ */ X(z, {
				variant: B.Secondary,
				content: g.Text,
				onClick: () => void c("keep"),
				disabled: o.isPending,
				children: "Keep Sessions"
			}),
			/* @__PURE__ */ X(z, {
				variant: B.SecondaryDestructive,
				content: g.Text,
				onClick: () => void c("delete"),
				loading: o.isPending,
				children: "Remove Project and Sessions"
			})
		] }),
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ Z("p", { children: [
				"Remove ",
				/* @__PURE__ */ Z("span", {
					className: "text-basic-primary",
					children: [
						"\"",
						n?.name,
						"\""
					]
				}),
				" from NAC?"
			] }), /* @__PURE__ */ Z("p", { children: [
				"Files at ",
				/* @__PURE__ */ X("code", {
					className: "break-all text-basic-primary",
					children: n?.cwd
				}),
				" will be preserved. Select Keep Sessions to leave its chats unassigned, or remove the Project and its chats together."
			] })]
		})
	});
}
// src/app/components/modals/RenameProjectModal.tsx
function ym({ open: e, onClose: t, project: n }) {
	return !cp(e) || !n ? null : /* @__PURE__ */ X(bm, {
		open: e,
		project: n,
		onClose: t
	}, n.project_id);
}
function bm({ open: e, project: t, onClose: n }) {
	let r = nr(), i = ge(), [a, o] = J(t.name), [s, c] = J(t.description ?? ""), l = async () => {
		if (i.isPending) return;
		let e = a.trim();
		if (!e) r.error("A project needs a name");
		else try {
			await i.mutateAsync({
				projectId: t.project_id,
				payload: {
					name: e,
					description: s.trim() || null
				}
			}), r.success("Project saved"), n();
		} catch (e) {
			let t = e instanceof Ot && e.status === 409;
			r.error(t ? "Version conflict — the project changed in the meantime" : `Error: ${Vt(Ud(e))}`);
		}
	};
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: n,
		title: "Rename project",
		size: Tn.Small,
		footer: /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(z, {
			variant: B.Tertiary,
			content: g.Text,
			onClick: n,
			disabled: i.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ X(z, {
			variant: B.Primary,
			content: g.Text,
			onClick: l,
			loading: i.isPending,
			children: "Save"
		})] }),
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ X($, {
				label: "Name",
				placeholder: "Project name",
				value: a,
				onChange: (e) => o(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && l();
				}
			}), /* @__PURE__ */ X($, {
				label: "Description",
				placeholder: "Optional",
				value: s,
				onChange: (e) => c(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && l();
				}
			})]
		})
	});
}
// src/app/hooks/useKeyboardShortcuts.ts
var xm = /* @__PURE__ */ new Set([
	"INPUT",
	"TEXTAREA",
	"SELECT"
]);
function Sm(e) {
	return e instanceof HTMLElement ? xm.has(e.tagName) || e.isContentEditable : !1;
}
function Cm(e) {
	let { getStackLength: t } = ht(), n = ni(), r = q(e);
	G(() => {
		r.current = e;
	}), G(() => {
		let e = (e) => {
			if (!e.repeat && n(e.target)) {
				for (let n of r.current) if (n.enabled !== !1 && He(e, n.keys)) {
					if (t() > 0 || !Me(n.keys) && Sm(e.target)) return;
					e.preventDefault(), n.onTrigger();
					return;
				}
			}
		};
		return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
	}, [t, n]);
}
// src/app/providers/ProjectActionsProvider.tsx
var wm = si(null);
function Tm({ children: e }) {
	let { pruneSessionNavigation: t } = V().stores.sessionNavigationStore, { pruneChatTabs: n } = V().stores.chatTabsStore, r = nr(), { pathname: i } = Ai(), a = ji(), o = Zn(), s = Tt(), c = o.isSuccess, u = K(() => cn(s, o.data ?? []), [o.data, s]), { data: d } = _t(), f = j(), p = l(), [m, h] = J(null), [g, _] = J(null), [v, y] = J(null), [b, x] = J(null), [S, C] = J(!1), w = f.toggle, T = p.mutateAsync, E = W(async (e, t) => {
		try {
			await T({
				projectId: e.project_id,
				sessionId: t.session_id
			}), r.success(`Assigned to ${e.name}`);
		} catch (e) {
			r.error(`Failed to assign the chat: ${nf(Ud(e))}`);
		}
	}, [T, r]), D = W(async (e, t = !1) => {
		C(t), x(e);
	}, []), O = K(() => ({
		create: () => h("create"),
		assign: (e) => {
			let t = Pd(d?.projects ?? [], e);
			t ? E(t, e) : (y(e), h("assign"));
		},
		rename: (e) => {
			_(e), h("rename");
		},
		remove: (e) => {
			_(e), h("delete");
		},
		togglePin: async (e) => {
			try {
				await w(e);
			} catch (e) {
				r.error(`Failed to update pin: ${Vt(Ud(e))}`);
			}
		},
		newChat: D
	}), [
		w,
		D,
		r,
		E,
		d
	]);
	G(() => {
		let e = o.data;
		c && e && d && (n(e.map((e) => e.summary.session_id), d.projects.map((e) => e.project_id)), t(Sd(e).map((e) => e.summary.session_id)));
	}, [
		c,
		o.data,
		d,
		n,
		t
	]);
	let k = sr(i), ee = nn(i) ?? o.data?.find((e) => e.summary.session_id === k)?.summary.project_id ?? null;
	Cm([{
		keys: Fn,
		enabled: ee != null,
		onTrigger: () => {
			ee && D(ee);
		}
	}, {
		keys: De,
		enabled: ee == null,
		onTrigger: () => h("create")
	}]);
	let A = () => h(null);
	return /* @__PURE__ */ Z(wm.Provider, {
		value: O,
		children: [
			e,
			/* @__PURE__ */ X(um, {
				open: m === "create",
				onClose: A
			}),
			/* @__PURE__ */ X(hm, {
				projectId: b,
				firstChat: S,
				onClose: () => {
					let e = b;
					x(null), C(!1), e && nn(i) === e && !Sd(u).some((t) => t.summary.project_id === e) && a(fn.list(), { replace: !0 });
				}
			}),
			/* @__PURE__ */ X(sf, {
				open: m === "assign",
				onClose: A,
				summary: v
			}),
			/* @__PURE__ */ X(ym, {
				open: m === "rename",
				onClose: A,
				project: g
			}),
			/* @__PURE__ */ X(vm, {
				open: m === "delete",
				onClose: A,
				project: g
			})
		]
	});
}
function Em() {
	let e = di(wm);
	if (!e) throw Error("useProjectActions must be used within ProjectActionsProvider");
	return e;
}
// src/app/components/modals/DeleteModal.tsx
function Dm(e, t) {
	let n = e.project_id?.trim();
	if (!n) return fn.list();
	let r = t.filter((t) => t.summary.project_id === n && t.summary.session_id !== e.session_id);
	r.sort((e, t) => Rn(t.summary.updated_at) - Rn(e.summary.updated_at));
	let i = r[0];
	return i ? fn.session(i.summary.session_id) : fn.project(n);
}
function Om({ open: e, onClose: t, summary: n }) {
	let r = nr(), i = xd(), a = ji(), o = Ai(), s = jn(), { data: c = [] } = Zn();
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: t,
		title: "Delete session",
		size: Tn.Small,
		footer: /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(z, {
			variant: B.Tertiary,
			content: g.Text,
			onClick: t,
			disabled: s.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ X(z, {
			variant: B.SecondaryDestructive,
			content: g.Text,
			onClick: async () => {
				if (!n || s.isPending) return;
				let e = n.session_id, i = o.pathname, l = sr(i) === e ? Dm(n, c) : null;
				try {
					l && Ni(() => {
						a(l, { replace: !0 });
					}), await s.mutateAsync(e), r.success("Session deleted"), t();
				} catch (e) {
					l && a(i, { replace: !0 }), r.error(`Failed to delete: ${Vt(Ud(e))}`);
				}
			},
			loading: s.isPending,
			children: "Delete session"
		})] }),
		children: /* @__PURE__ */ Z("p", { children: [
			"Are you sure you want to delete the session",
			" ",
			/* @__PURE__ */ Z("span", {
				className: "text-basic-primary",
				children: [
					"\"",
					i(n),
					"\""
				]
			}),
			" ",
			/* @__PURE__ */ Z("span", {
				className: "font-mono text-basic-muted",
				children: [
					"(",
					Ae(n?.session_id),
					")"
				]
			}),
			"? This action cannot be undone."
		] })
	});
}
// src/app/components/modals/RenameModal.tsx
function km({ open: e, onClose: t, summary: n }) {
	return !cp(e) || !n ? null : /* @__PURE__ */ X(Am, {
		open: e,
		summary: n,
		onClose: t
	}, n.session_id);
}
function Am({ open: e, summary: t, onClose: n }) {
	let r = nr(), i = xd(), a = nt(), [o, s] = J(t.title ?? ""), [c, l] = J(!!t.pinned), u = !!t.project_id, d = async () => {
		if (!a.isPending) try {
			await a.mutateAsync({
				id: t.session_id,
				title: o.trim(),
				pinned: u ? c : !1,
				expectedVersion: t.presentation_version ?? 0
			}), r.success("Session presentation saved"), n();
		} catch (e) {
			let t = e instanceof Ot && e.status === 409;
			r.error(t ? "Version conflict — the session changed in the meantime" : `Error: ${Vt(Ud(e))}`);
		}
	};
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: n,
		title: "Rename session",
		size: Tn.Small,
		footer: /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(z, {
			variant: B.Tertiary,
			content: g.Text,
			onClick: n,
			disabled: a.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ X(z, {
			variant: B.Primary,
			content: g.Text,
			onClick: d,
			loading: a.isPending,
			children: "Save"
		})] }),
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ X($, {
				label: "Title",
				placeholder: i(t) || "Session name",
				hintText: "Leave empty to restore the automatic title (last prompt).",
				value: o,
				onChange: (e) => s(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && d();
				}
			}), u ? /* @__PURE__ */ Z("label", {
				className: "flex items-center gap-2 label-small text-basic-secondary select-none",
				children: [/* @__PURE__ */ X("input", {
					type: "checkbox",
					checked: c,
					onChange: (e) => l(e.target.checked),
					className: "accent-[var(--color-fill-accent-primary)]"
				}), "Pin to top of the list"]
			}) : null]
		})
	});
}
// src/app/components/SshBadge.tsx
function jm({ state: e, onReconnect: t, className: n }) {
	let r = e !== "connected";
	return /* @__PURE__ */ Z("div", {
		className: I("flex items-center h-4 shrink-0", r ? "gap-1" : null, n),
		children: [
			r ? /* @__PURE__ */ X(R, {
				iconName: H.Danger,
				size: 16,
				className: "text-error-primary"
			}) : null,
			/* @__PURE__ */ X("span", {
				className: I("tag-label uppercase", r ? "text-error-primary" : "text-info-primary"),
				children: "SSH"
			}),
			e === "reconnect" && t ? /* @__PURE__ */ X(E, {
				title: "Reconnect SSH",
				position: M.TopCenter,
				children: /* @__PURE__ */ X(z, {
					size: U.Small,
					variant: B.Ghost,
					content: g.Icon,
					"aria-label": "Reconnect SSH",
					onClick: (e) => {
						e.stopPropagation(), t();
					},
					children: /* @__PURE__ */ X(R, {
						iconName: H.Refresh,
						size: 16
					})
				})
			}) : null
		]
	});
}
// src/app/components/modals/SettingsModal.tsx
function Mm(e) {
	return Object.keys(e).length === 0 ? "" : JSON.stringify(e, null, 2);
}
function Nm(e) {
	if (!e) return {
		headers: {},
		invalid: !1
	};
	try {
		let t = JSON.parse(e);
		return Object(t) !== t || Array.isArray(t) || Object.values(t).some((e) => typeof e != "string") ? {
			headers: {},
			invalid: !0
		} : {
			headers: t,
			invalid: !1
		};
	} catch {
		return {
			headers: {},
			invalid: !0
		};
	}
}
function Pm(e) {
	let t = Nm(e.extra_headers_json);
	return {
		model: e.model,
		backend: e.backend ?? "",
		base_url: e.base_url,
		allow_insecure_http: e.allow_insecure_http ?? !1,
		reasoning_effort: e.reasoning_effort || null,
		api_key_env: e.api_key_env || null,
		extra_headers: t.headers,
		extra_headers_invalid: t.invalid,
		orchestrator_compaction_threshold: e.orchestrator_compaction_threshold
	};
}
function Fm({ open: e, onClose: t, footer: n, titleExtra: r, children: i }) {
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: t,
		title: r ? /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-4",
			children: [/* @__PURE__ */ X("span", {
				className: "flex-1 min-w-0",
				children: "Session settings"
			}), r]
		}) : "Session settings",
		size: Tn.Wide,
		flush: !0,
		className: "h-[700px]",
		footer: n,
		children: i
	});
}
function Im({ open: e, id: t, onClose: n }) {
	let r = cp(e), { data: i, isLoading: a } = ur(r ? t : null), { data: o, isLoading: s } = sn(r ? t : null);
	if (!r || !t) return null;
	let c = o ? Pm(o) : null;
	return !c || !i || s ? /* @__PURE__ */ X(Fm, {
		open: e,
		onClose: n,
		children: /* @__PURE__ */ X("p", {
			className: "text-basic-muted text-micro",
			children: s || a ? "Loading session configuration…" : "Session configuration unavailable."
		})
	}) : /* @__PURE__ */ X(Lm, {
		initialVersion: o?.config_version,
		open: e,
		id: t,
		initial: c,
		initialLight: o?.light_model ?? null,
		summary: i.summary,
		diagnostics: o?.diagnostics ?? [],
		onClose: n
	}, `${t}:${e ? "open" : "closing"}`);
}
function Lm({ open: e, id: t, initial: n, initialLight: r, initialVersion: i, summary: a, diagnostics: o, onClose: s }) {
	let { useSshConnectionStatus: c, sshTargetFromSummary: l } = V().stores.sshConnectionStore, { api: u } = V(), d = N(), f = nr(), p = Si(), m = $p(e), h = xd(), _ = qr(), v = ge(), [y, b] = J(!1), x = Pr(), S = x.data ?? null, C = $t(), w = Tt(), [T] = J(a), [E] = J(i), D = nt(), O = T.title ?? "", [k, ee] = J(O), [A, te] = J(n.model), [j, ne] = J(n.backend), [re, ie] = J(n.reasoning_effort ?? ""), [, ae] = J(n.base_url), [oe, se] = J(Mm(n.extra_headers)), [ce, M] = J(n.orchestrator_compaction_threshold == null ? "" : String(n.orchestrator_compaction_threshold)), le = q(n.orchestrator_compaction_threshold == null ? "" : String(n.orchestrator_compaction_threshold)), ue = q(!1), de = q(!1), [fe, pe] = J(""), [P, me] = J(null), [F, I] = J({
		mode: r ? "dual" : "single",
		light: r
	}), [he, _e] = J(r), [L, ve] = J(!1), [ye, be] = J(!1), xe = o.some((e) => e.startsWith("malformed stored light model")), Se = q(null), Ce = W((e, t) => {
		if (me(e), !e || Vp(Se.current, e)) return;
		let n = Se.current;
		Se.current = e;
		let r = e.kind === "resolved" ? e : e.request;
		if (ne(r.backend), te(r.model), ae(r.base_url ?? Kf(r.backend) ?? ""), e.kind === "resolved") {
			ie(e.reasoning_effort ?? "");
			let r = t === "primary" && n?.kind === "resolved";
			if (r && n.backend === e.backend && n.base_url === e.base_url && n.api_key_env === e.api_key_env && n.allow_insecure_http === e.allow_insecure_http || se(Mm(e.extra_headers ?? {})), r) return;
			if (e.orchestrator_compaction_threshold !== void 0) {
				let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
				de.current = !0, ue.current = !1, le.current = n, M(n);
			} else {
				let e = de.current;
				de.current = !1, e && (ue.current = !0, le.current = "", M(""));
			}
			e.light_model !== void 0 && (_e(e.light_model), I({
				mode: e.light_model ? "dual" : "single",
				light: e.light_model
			}));
		}
	}, []), we = Rt(), Te = op(yf(we.data, j, A).supportedEfforts, re), Ee = K(() => {
		let e = yf(we.data, j, A).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		we.data,
		j,
		A
	]);
	G(() => {
		!de.current && Ee !== "auto" && ue.current && (ue.current = !0, le.current = Ee, M(Ee));
	}, [Ee, P]);
	let De = !P || m.needsReview || m.busy, Oe = m.busy || x.isPending || _.isPending || D.isPending || C.isPending, ke = l(T), Ae = c(ke), [je, Me] = J(void 0), Ne = je === void 0 ? Ae === "connected" ? ke : null : je, Pe = (e) => {
		Me(e);
	}, Fe = () => D.mutateAsync({
		id: t,
		title: k.trim(),
		pinned: !!T.pinned,
		expectedVersion: T.presentation_version ?? 0
	}), Ie = (e) => {
		let t;
		try {
			let r = !!(S?.model_ready && Je(S, {
				backend: e.backend,
				model: e.model,
				baseUrl: e.base_url
			}));
			t = tp({
				model: e.model,
				backend: e.backend,
				base_url: e.base_url,
				allow_insecure_http: e.allow_insecure_http,
				reasoning_effort: re,
				credential_mode: e.api_key_env ? "variable" : "none",
				api_key_env: e.api_key_env ?? "",
				extra_headers: oe,
				orchestrator_compaction_threshold: ce
			}, n, r);
		} catch (e) {
			throw new em(e instanceof Error ? e.message : String(e));
		}
		if (w.orchestrationEnabled) {
			if (F.mode === "dual") {
				if (!F.light) throw new em("Pick the light model before saving.");
				let i = Vf(F.light, e.backend, e.api_key_env, n.api_key_env);
				(xe || !Uf(i, r)) && (t.light_model = i);
			} else (r || xe) && (t.light_model = null);
		} else ye ? t.light_model = null : Uf(F.light, r) || (t.light_model = F.light);
		return t;
	}, Le = async () => {
		if (Oe || m.needsReview || !P) return;
		if (y && P.kind === "resolved" && !P.config_id) {
			pe("Choose a saved preset in Advanced before updating the project default.");
			return;
		}
		if (w.orchestrationEnabled && F.mode === "dual" && !F.light) {
			pe("Pick the light model before saving.");
			return;
		}
		let e = !1;
		try {
			let t = P.kind === "save" ? P.request : P, n = Ie({
				...t,
				base_url: t.base_url ?? Kf(t.backend) ?? "",
				allow_insecure_http: t.allow_insecure_http ?? !1,
				api_key_env: P.kind === "resolved" ? P.api_key_env : P.request.api_key ? "PENDING_SAVED_CREDENTIAL" : null
			});
			e = P.kind === "save" || Object.keys(n).length > 0;
		} catch (e) {
			pe(rm(e));
			return;
		}
		try {
			if (!await m.run((n) => Zp({
				current: n.current,
				classify: nm,
				reconcile: im(p, t),
				check: async () => {
					let e = await u.getConfig(t, n.signal);
					if (E !== void 0 && e.config_version !== E) throw new tm();
				},
				persistsModel: P.kind === "save",
				model: async () => {
					if (P.kind === "save") {
						let e = Rp(await C.mutateAsync({
							...P.request,
							light_model: F.mode === "dual" ? F.light : null
						}));
						return n.current() && me(e), e;
					}
					return P;
				},
				configurationSaved: e,
				configuration: async (e) => {
					let n = Ie(e);
					Object.keys(n).length > 0 && await _.mutateAsync({
						id: t,
						patch: n
					});
				},
				title: k.trim() === O.trim() ? void 0 : Fe,
				projectDefault: y && T.project_id ? (e) => {
					if (!e.config_id) throw new em("Choose a saved preset before updating the project default.");
					return v.mutateAsync({
						projectId: T.project_id,
						payload: { default_model_config_id: e.config_id }
					});
				} : void 0
			}))) return;
			f.success("Session settings saved"), s();
		} catch (e) {
			pe(rm(e));
		}
	}, Re = /* @__PURE__ */ Z(Y, { children: [d ? /* @__PURE__ */ X(Zr, {
		variant: B.Tertiary,
		content: g.Text,
		onClick: s,
		disabled: Oe,
		children: "Cancel"
	}) : /* @__PURE__ */ X(z, {
		variant: B.Tertiary,
		size: U.Large,
		content: g.Text,
		onClick: s,
		disabled: Oe,
		children: "Cancel"
	}), d ? /* @__PURE__ */ X(Zr, {
		variant: B.Primary,
		"aria-label": "Save",
		content: g.Text,
		onClick: Le,
		disabled: De,
		loading: Oe,
		children: "Save"
	}) : /* @__PURE__ */ X(z, {
		variant: B.Primary,
		"aria-label": "Save",
		size: U.Large,
		content: g.Text,
		onClick: Le,
		disabled: De,
		loading: Oe,
		children: "Save"
	})] });
	return /* @__PURE__ */ X(Fm, {
		open: e,
		onClose: s,
		footer: Re,
		titleExtra: ke ? /* @__PURE__ */ X(jm, { state: Ae === "connected" ? "connected" : "disconnected" }) : null,
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-6 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ X("p", {
					className: "text-micro text-basic-muted",
					children: "Changes apply to this inactive primary chat. Project defaults and existing children keep their settings."
				}),
				o.length > 0 ? /* @__PURE__ */ Z("div", {
					className: "rounded-[4px] border border-error-muted bg-error-tertiary p-3 text-micro text-error-primary",
					children: [/* @__PURE__ */ X("div", {
						className: "label-small mb-1",
						children: "Repair required"
					}), o.map((e) => /* @__PURE__ */ Z("div", { children: ["• ", e] }, e))]
				}) : null,
				ke ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(Ip, {
					mode: "settings",
					connection: Ne,
					seedTarget: ke,
					onConnectionChange: Pe
				}), /* @__PURE__ */ X(nd, {})] }) : null,
				/* @__PURE__ */ X($, {
					label: "Session title",
					"aria-label": "Session title",
					inputSize: d ? Q.Large : Q.Medium,
					placeholder: h(T) || "Session name",
					hintText: "Leave empty to restore the automatic title (the last prompt).",
					value: k,
					onChange: (e) => ee(e.target.value)
				}),
				/* @__PURE__ */ X(Gp, {
					existingSession: !0,
					simple: !w.orchestrationEnabled,
					invalid: !!fe,
					errorText: fe || void 0,
					initial: {
						backend: n.backend,
						model: n.model,
						base_url: n.base_url,
						allow_insecure_http: n.allow_insecure_http,
						api_key_env: n.api_key_env,
						reasoning_effort: n.reasoning_effort,
						extra_headers: n.extra_headers,
						orchestrator_compaction_threshold: n.orchestrator_compaction_threshold,
						light_model: r
					},
					onChange: Ce,
					children: /* @__PURE__ */ Z("div", {
						className: "flex flex-col gap-2",
						children: [
							w.orchestrationEnabled ? /* @__PURE__ */ X(Dp, {
								initial: F.light,
								behavior: T.behavior ?? "orchestrator",
								onChange: I
							}, JSON.stringify(he)) : null,
							T.project_id ? /* @__PURE__ */ Z("label", {
								className: "flex items-start gap-2 text-micro",
								children: [
									/* @__PURE__ */ X("input", {
										type: "checkbox",
										checked: y,
										onChange: (e) => b(e.target.checked)
									}),
									" ",
									/* @__PURE__ */ Z("span", { children: ["Use selected preset as the project default", /* @__PURE__ */ X("span", {
										className: "block text-basic-muted",
										children: "Future chats inherit that saved preset, including its Advanced values. Existing chats and children keep their settings."
									})] })
								]
							}) : null,
							/* @__PURE__ */ X(nd, {}),
							/* @__PURE__ */ Z("button", {
								type: "button",
								className: "btn-ghost flex w-full items-center gap-1.5 rounded-[4px] p-2 text-btn-secondary",
								"aria-expanded": L,
								onClick: () => ve((e) => !e),
								children: [
									/* @__PURE__ */ X(R, {
										iconName: H.Gear,
										size: 20
									}),
									/* @__PURE__ */ X("span", {
										className: "label-small flex-1 text-left",
										children: "Advanced Configurations"
									}),
									/* @__PURE__ */ X(R, {
										iconName: L ? H.Down : H.Right,
										size: 20
									})
								]
							}),
							L ? /* @__PURE__ */ Z(Y, { children: [
								xe && !w.orchestrationEnabled ? /* @__PURE__ */ Z("label", {
									className: "text-micro",
									children: [
										/* @__PURE__ */ X("input", {
											type: "checkbox",
											checked: ye,
											onChange: (e) => be(e.target.checked)
										}),
										" ",
										"Clear malformed legacy light settings"
									]
								}) : null,
								/* @__PURE__ */ X(nd, {}),
								/* @__PURE__ */ X(uf, {
									label: "Reasoning Effort",
									hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
									control: /* @__PURE__ */ X(dp, {
										items: Te,
										value: re,
										onValueChange: ie
									})
								}),
								/* @__PURE__ */ X(nd, {}),
								/* @__PURE__ */ X(uf, {
									label: "Context Limit",
									hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
									control: /* @__PURE__ */ Z("div", {
										className: "flex items-center gap-2",
										children: [/* @__PURE__ */ X($, {
											inputSize: d ? Q.Large : Q.Medium,
											className: cf,
											inputClassName: "md:text-right",
											"aria-label": "Context limit",
											placeholder: Ee,
											inputMode: "numeric",
											value: ce,
											onChange: (e) => {
												de.current = !1, ue.current = !1, le.current = e.target.value, M(e.target.value);
											}
										}), /* @__PURE__ */ X("span", {
											className: "shrink-0 text-micro text-basic-muted",
											children: "tokens"
										})]
									})
								}),
								/* @__PURE__ */ X(nd, {}),
								/* @__PURE__ */ X(tu, {
									label: "Extra headers (JSON object)",
									textAreaSize: d ? eu.Large : eu.Medium,
									hintText: "Blank sends none; header values must be strings.",
									placeholder: "{ \"X-Title\": \"NAC\" }",
									value: oe,
									onChange: (e) => se(e.target.value),
									textAreaClassName: "h-[160px] resize-none font-mono"
								})
							] }) : null
						]
					})
				})
			]
		})
	});
}
// src/app/providers/SessionActionsProvider.tsx
var Rm = si(null);
function zm({ children: e }) {
	let { pushLocalEvent: t, captureRuntimeActivation: n } = V().stores.runtimeStore, r = nr(), i = Xt(), a = Or(), [o, s] = J(null), [c, l] = J(null), [u, d] = J(null), f = W((e) => (t) => {
		l(t), s(e);
	}, []), p = i.toggle, m = K(() => ({
		rename: f("rename"),
		remove: f("delete"),
		settings: (e) => {
			d(e), s("settings");
		},
		togglePin: async (e) => {
			try {
				await p(e);
			} catch (e) {
				r.error(`Failed to update pin: ${Vt(Ud(e))}`);
			}
		},
		stopRun: async (e) => {
			let i = n(e);
			try {
				await a.mutateAsync(e), i() && t("run", "■ run cancellation requested"), r.success("Run cancellation requested");
			} catch (e) {
				r.error(`Failed to stop run: ${Vt(Ud(e))}`);
			}
		}
	}), [
		f,
		p,
		r,
		n,
		a,
		t
	]), h = () => s(null);
	return /* @__PURE__ */ Z(Rm.Provider, {
		value: m,
		children: [
			e,
			/* @__PURE__ */ X(km, {
				open: o === "rename",
				onClose: h,
				summary: c
			}),
			/* @__PURE__ */ X(Om, {
				open: o === "delete",
				onClose: h,
				summary: c
			}),
			/* @__PURE__ */ X(Im, {
				open: o === "settings",
				id: u,
				onClose: h
			})
		]
	});
}
function Bm() {
	let e = di(Rm);
	if (!e) throw Error("useSessionActions must be used within SessionActionsProvider");
	return e;
}
// src/app/components/projects/ProjectPopover.tsx
function Vm({ tooltip: e, label: t, icon: n, onClick: r, variant: i = B.Ghost }) {
	return /* @__PURE__ */ X(z, {
		variant: i,
		size: U.Small,
		content: g.Icon,
		title: e,
		"aria-label": t,
		onClick: r,
		children: /* @__PURE__ */ X(R, { iconName: n })
	});
}
function Hm(e, t, n) {
	return (e.kind === "project" ? `${e.entry.project.name} ${e.entry.project.cwd}` : `${n(e.session.summary)} ${e.session.summary.cwd}`).toLowerCase().includes(t);
}
function Um({ activeId: e, onClose: t }) {
	let n = ji(), r = Em(), i = Bm(), a = xd(), o = N(), [s, c] = J(""), { data: l } = _t(), { data: u = [] } = _(), d = K(() => Ad(l?.projects ?? [], u), [l, u]), f = K(() => {
		let e = s.trim().toLowerCase();
		return e ? d.filter((t) => Hm(t, e, a)) : d;
	}, [
		d,
		s,
		a
	]);
	return /* @__PURE__ */ Z("div", {
		className: I("flex flex-col", o ? "h-[calc(70dvh)]" : "max-h-[520px]"),
		children: [/* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2 shrink-0",
			children: [/* @__PURE__ */ X($, {
				inputSize: o ? Q.Large : Q.Medium,
				leading: Hl.Icon,
				leadingIconName: H.Search,
				placeholder: "Search Projects",
				"aria-label": "Search projects",
				value: s,
				onChange: (e) => c(e.target.value)
			}), /* @__PURE__ */ X(nd, {})]
		}), /* @__PURE__ */ X("div", {
			className: "flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
			children: /* @__PURE__ */ X(Vd, {
				items: f,
				activeId: e,
				isMobile: o,
				emptyLabel: s.trim() ? "No matching projects" : "No projects yet",
				onOpenProject: (e) => {
					t(), n(fn.project(e));
				},
				onOpenSession: (e) => {
					t(), n(fn.session(e));
				},
				renderActions: (e) => {
					if (e.kind === "project") {
						let { project: n } = e.entry;
						return /* @__PURE__ */ Z(Y, { children: [
							/* @__PURE__ */ X(Vm, {
								tooltip: n.pinned ? "Unpin project" : "Pin project",
								label: `${n.pinned ? "Unpin" : "Pin"} ${n.name}`,
								icon: n.pinned ? H.Unpin : H.Pin,
								onClick: () => void r.togglePin(n)
							}),
							/* @__PURE__ */ X(Vm, {
								tooltip: "Rename project",
								label: `Rename ${n.name}`,
								icon: H.Edit,
								onClick: () => {
									t(), r.rename(n);
								}
							}),
							/* @__PURE__ */ X(Vm, {
								tooltip: "Remove project",
								label: `Remove ${n.name}`,
								icon: H.Trash,
								variant: B.GhostDestructive,
								onClick: () => {
									t(), r.remove(n);
								}
							})
						] });
					}
					let { summary: n } = e.session, o = a(n);
					return /* @__PURE__ */ Z(Y, { children: [
						/* @__PURE__ */ X(Vm, {
							tooltip: "Rename chat",
							label: `Rename ${o}`,
							icon: H.Edit,
							onClick: () => {
								t(), i.rename(n);
							}
						}),
						/* @__PURE__ */ X(Vm, {
							tooltip: "Delete chat",
							label: `Delete ${o}`,
							icon: H.Trash,
							variant: B.GhostDestructive,
							onClick: () => {
								t(), i.remove(n);
							}
						}),
						/* @__PURE__ */ X(Vm, {
							tooltip: "Assign to a project",
							label: `Assign ${o} to a project`,
							icon: H.Folders,
							onClick: () => {
								t(), r.assign(n);
							}
						})
					] });
				}
			})
		})]
	});
}
// src/app/components/Breadcrumbs.tsx
function Wm() {
	let { pathname: e } = Ai(), t = sr(e), n = nn(e), r = ji(), i = Em(), a = xd(), { data: o } = _t(), { data: s = [] } = _(), [c, l] = J(!1), u = t ? s.find((e) => e.summary.session_id === t) : void 0, d = n ?? u?.summary.project_id ?? null, f = jd(o?.projects ?? [], d), p = !!(d || t), m = f?.name ?? a(u?.summary) ?? t ?? "", h = f?.project_id ?? t ?? "", v = d ? Sd(s).some((e) => e.summary.project_id === d && y(e.active_run)) : y(u?.active_run);
	return /* @__PURE__ */ Z("nav", {
		className: "flex items-center min-w-0 gap-1",
		"aria-label": "Breadcrumb",
		children: [/* @__PURE__ */ X(z, {
			variant: B.Ghost,
			size: U.Medium,
			content: g.Text,
			onClick: () => r(fn.list()),
			"aria-current": p ? void 0 : "page",
			children: "All Projects"
		}), p ? /* @__PURE__ */ Z(Y, { children: [
			/* @__PURE__ */ X(R, {
				iconName: H.Right,
				className: "text-basic-muted shrink-0"
			}),
			/* @__PURE__ */ X(x, {
				open: c,
				onClose: () => l(!1),
				placement: M.BottomRight,
				size: Le.Medium,
				className: "min-w-0",
				content: /* @__PURE__ */ X(Um, {
					activeId: d ?? t,
					onClose: () => l(!1)
				}),
				children: /* @__PURE__ */ Z(z, {
					variant: B.Ghost,
					size: U.Medium,
					content: g.Text,
					className: "!px-2 max-w-[320px]",
					onClick: () => l((e) => !e),
					"aria-expanded": c,
					"aria-label": "Switch project",
					children: [
						f ? /* @__PURE__ */ X(Uu, {
							id: h,
							size: 24,
							isRunning: v,
							className: "rounded-[2px]"
						}) : /* @__PURE__ */ X(Za, {
							size: 24,
							isRunning: v
						}),
						/* @__PURE__ */ X("span", {
							className: I("truncate max-w-[120px]", v && "text-shimmer-basic"),
							children: m
						}),
						/* @__PURE__ */ X(R, {
							iconName: H.Down,
							className: I("transition-transform", c ? "rotate-180" : void 0)
						})
					]
				})
			}),
			/* @__PURE__ */ X(E, {
				title: "New project",
				keyboardShortcuts: f ? void 0 : De,
				position: E.Position.BottomCenter,
				children: /* @__PURE__ */ X(z, {
					variant: B.Ghost,
					size: U.Small,
					content: g.Icon,
					"aria-label": "New project",
					onClick: i.create,
					children: /* @__PURE__ */ X(R, { iconName: H.AddCircle })
				})
			})
		] }) : null]
	});
}
// src/app/components/HeaderMenu.tsx
var Gm = "https://github.com/arcee-ai/nac", Km = "https://github.com/arcee-ai/nac#readme";
function qm({ onConfigurations: e, onSshConfigs: t, onManagedHost: n }) {
	let [r, i] = J(!1), a = N(), { data: o } = kn(), s = o?.store_path ?? "store path pending", c = a ? Bi.Large : Bi.Medium, l = (e) => () => {
		i(!1), e();
	}, u = (e) => l(() => window.open(e, "_blank", "noopener"));
	return /* @__PURE__ */ X(x, {
		open: r,
		onClose: () => i(!1),
		placement: M.BottomLeft,
		size: "w-[280px]",
		panelClassName: "p-1",
		sheetClassName: "px-2",
		content: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2",
			children: [
				/* @__PURE__ */ Z("div", {
					className: I("flex items-center", a ? "h-16 gap-2 pl-4 pr-2" : "h-9 gap-1 pl-2"),
					children: [
						/* @__PURE__ */ X("span", {
							className: I("text-basic-primary shrink-0", a ? "label-medium" : "label-small"),
							children: "Store:"
						}),
						/* @__PURE__ */ X("span", {
							className: I("code text-info-primary flex-1 min-w-0 truncate", a ? "code-medium" : "code-small"),
							title: s,
							children: s
						}),
						/* @__PURE__ */ X(Yt, {
							value: s,
							size: U.Medium,
							variant: B.Ghost,
							title: "Copy the store path"
						})
					]
				}),
				/* @__PURE__ */ X(nd, {}),
				/* @__PURE__ */ Z(Ui, {
					size: c,
					onClick: l(e),
					children: [/* @__PURE__ */ X(R, { iconName: H.Gear }), /* @__PURE__ */ X("span", {
						className: "text-left flex-grow",
						children: "Configurations"
					})]
				}),
				/* @__PURE__ */ Z(Ui, {
					size: c,
					onClick: l(t),
					children: [/* @__PURE__ */ X(R, { iconName: H.Globe }), /* @__PURE__ */ X("span", {
						className: "text-left flex-grow",
						children: "SSH configs"
					})]
				}),
				n ? /* @__PURE__ */ Z(Ui, {
					size: c,
					onClick: l(n),
					children: [/* @__PURE__ */ X(R, { iconName: H.Controls }), /* @__PURE__ */ X("span", {
						className: "text-left flex-grow",
						children: "Managed host"
					})]
				}) : null,
				/* @__PURE__ */ X(nd, {}),
				/* @__PURE__ */ Z(Ui, {
					size: c,
					onClick: u(Km),
					children: [
						/* @__PURE__ */ X(R, { iconName: H.Book }),
						/* @__PURE__ */ X("span", {
							className: "text-left flex-grow",
							children: "See docs"
						}),
						/* @__PURE__ */ X(R, { iconName: H.External })
					]
				}),
				/* @__PURE__ */ Z(Ui, {
					size: c,
					onClick: u(Gm),
					children: [
						/* @__PURE__ */ X(R, { iconName: H.Github }),
						/* @__PURE__ */ X("span", {
							className: "text-left flex-grow",
							children: "See Github"
						}),
						/* @__PURE__ */ X(R, { iconName: H.External })
					]
				})
			]
		}),
		children: /* @__PURE__ */ X(z, {
			variant: B.Ghost,
			size: U.Medium,
			content: g.Icon,
			className: I(a && "btn-round"),
			onClick: () => i((e) => !e),
			"aria-expanded": r,
			"aria-label": r ? "Close the menu" : "Open the menu",
			children: /* @__PURE__ */ X(R, { iconName: r ? H.Close : H.Hamburger })
		})
	});
}
// src/app/components/McpServersButton.tsx
function Jm({ onOpen: e }) {
	let t = N(), { data: n } = yn(), r = n?.servers.filter((e) => e.enabled).length ?? 0, i = r ? `MCP servers, ${r} active` : "MCP servers";
	return /* @__PURE__ */ Z("div", {
		className: "relative shrink-0",
		children: [t ? /* @__PURE__ */ X(Zr, {
			variant: B.Ghost,
			content: g.Icon,
			"aria-label": i,
			onClick: e,
			children: /* @__PURE__ */ X(R, { iconName: H.Toolbox })
		}) : /* @__PURE__ */ Z(z, {
			variant: B.Secondary,
			size: U.Medium,
			content: g.IconLeft,
			"aria-label": i,
			onClick: e,
			children: [/* @__PURE__ */ X(R, { iconName: H.Toolbox }), "MCP"]
		}), r ? /* @__PURE__ */ X("span", {
			"aria-hidden": !0,
			className: "label-micro pointer-events-none absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 bg-btn-primary text-btn-primary",
			children: r
		}) : null]
	});
}
// src/app/components/sessions/SessionFilters.tsx
var Ym = { paddingInline: "12px" };
function Xm() {
	return /* @__PURE__ */ X("div", { className: "h-px w-full bg-divider-muted shrink-0" });
}
function Zm({ label: e, items: t, value: n, onValueChange: r }) {
	return /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-1",
		children: [/* @__PURE__ */ X("div", {
			className: "label-small min-w-0 flex-1 text-basic-primary",
			children: e
		}), /* @__PURE__ */ X(Xu, {
			items: t,
			value: n,
			onValueChange: r,
			size: U.Small,
			variant: B.Secondary,
			placement: M.BottomLeft,
			sticky: !0,
			className: "min-w-0",
			triggerClassName: "!gap-1.5 !pl-3"
		})]
	});
}
function Qm({ label: e, options: t, selected: n, onToggle: r, labelOf: i = (e) => e }) {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("div", {
			className: "label-small text-basic-primary",
			children: e
		}), /* @__PURE__ */ X("div", {
			className: "flex flex-wrap gap-2",
			children: t.map((e) => /* @__PURE__ */ X(z, {
				size: U.Small,
				content: g.Text,
				variant: n.includes(e) ? B.Primary : B.Secondary,
				onClick: () => r(e),
				"aria-pressed": n.includes(e),
				style: Ym,
				children: i(e)
			}, e))
		})]
	});
}
function $m({ sessions: e, inset: t = !1 }) {
	let { useSort: n, useSessionProviders: r, useSessionEnvs: i, useSelectedProviders: a, useSelectedEnvs: o, useModifiedRange: s, useCreatedRange: c, toggleProvider: l, toggleEnv: u, setSort: d, setModifiedRange: f, setCreatedRange: p, pruneUnavailableFacets: m, SORT_ITEMS: h, RANGE_ITEMS: g } = V().stores.sessionFiltersStore, _ = n(), v = c(), y = s(), b = o(), x = a(), S = i(e), C = r(e);
	G(() => {
		m(S, C);
	}, [
		S,
		C,
		m
	]);
	let w = /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ X(Zm, {
			label: "Sort by",
			items: h,
			value: _,
			onValueChange: (e) => d(e)
		}),
		/* @__PURE__ */ X(Zm, {
			label: "Creation date",
			items: g,
			value: v,
			onValueChange: (e) => p(e)
		}),
		/* @__PURE__ */ X(Zm, {
			label: "Modification date",
			items: g,
			value: y,
			onValueChange: (e) => f(e)
		})
	] }), T = t ? "px-3 py-2" : "py-2";
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ X("div", {
				className: I("flex flex-col gap-6", T),
				children: w
			}),
			S.length > 1 ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(Xm, {}), /* @__PURE__ */ X("div", {
				className: T,
				children: /* @__PURE__ */ X(Qm, {
					label: "Environment",
					options: S,
					selected: b,
					onToggle: u
				})
			})] }) : null,
			C.length > 1 ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(Xm, {}), /* @__PURE__ */ X("div", {
				className: T,
				children: /* @__PURE__ */ X(Qm, {
					label: "Provider",
					options: C,
					selected: x,
					onToggle: l,
					labelOf: rn
				})
			})] }) : null
		]
	});
}
// src/app/features/managed/controller/useManagedHost.ts
var eh = si(null);
function th() {
	let e = di(eh);
	if (!e) throw Error("useManagedHost must be used within ManagedHostProvider");
	return e;
}
// src/app/features/ui-policy/useSessionBehaviorIconVisible.ts
function nh() {
	return Tt().orchestrationEnabled;
}
// src/app/components/projects/RowActionButton.tsx
function rh({ icon: e, label: t, title: n, isMobile: r = !1, destructive: i = !1, onClick: a }) {
	return /* @__PURE__ */ X(z, {
		variant: i ? B.GhostDestructive : B.Ghost,
		size: r ? U.Medium : U.Small,
		content: g.Icon,
		title: n ?? t,
		"aria-label": t,
		className: I(r && "relative !h-5 !rounded-[8px] !p-0 after:absolute after:-inset-1.5"),
		onClick: a,
		children: /* @__PURE__ */ X(R, { iconName: e })
	});
}
// src/app/components/projects/ChatSessionActions.tsx
function ih({ title: e, pinned: t = !1, isMobile: n = !1, onPin: r, onRename: i, onDelete: a }) {
	return /* @__PURE__ */ Z(Y, { children: [
		r ? /* @__PURE__ */ X(rh, {
			icon: t ? H.Unpin : H.Pin,
			title: t ? "Unpin chat" : "Pin chat",
			label: `${t ? "Unpin" : "Pin"} ${e}`,
			isMobile: n,
			onClick: r
		}) : null,
		i ? /* @__PURE__ */ X(rh, {
			icon: H.Edit,
			title: "Rename chat",
			label: `Rename ${e}`,
			isMobile: n,
			onClick: i
		}) : null,
		a ? /* @__PURE__ */ X(rh, {
			icon: H.Trash,
			title: "Delete chat",
			label: `Delete ${e}`,
			isMobile: n,
			destructive: !0,
			onClick: a
		}) : null
	] });
}
// src/app/components/projects/ProjectRowActions.tsx
function ah({ project: e }) {
	let t = Em();
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(rh, {
		icon: H.Edit,
		title: "Rename project",
		label: `Rename ${e.name}`,
		isMobile: !0,
		onClick: () => t.rename(e)
	}), /* @__PURE__ */ X(rh, {
		icon: H.Trash,
		title: "Delete project",
		label: `Delete ${e.name}`,
		isMobile: !0,
		destructive: !0,
		onClick: () => t.remove(e)
	})] });
}
// src/app/components/LeftSidebar/MobileSearchModal.tsx
function oh({ open: e, onClose: t, onNavigate: n, kind: r, activeSessionId: i, activeProjectId: a }) {
	let [o, s] = J(""), c = () => {
		s(""), t();
	}, l = () => {
		c(), n();
	}, u = o.trim().toLowerCase(), d = r === "chats";
	return /* @__PURE__ */ Z(Xn, {
		open: e,
		onClose: c,
		title: d ? "Search Chats" : "Search Projects",
		bodyClassName: "p-0 [&>*]:shrink-0",
		children: [/* @__PURE__ */ X("div", {
			className: "sticky top-0 z-10 flex p-3",
			children: /* @__PURE__ */ X($l, {
				className: "flex-1 min-w-0",
				variant: Ql.Search,
				placeholder: d ? "Search chats…" : "Search projects…",
				value: o,
				onChange: (e) => s(e.target.value),
				onClear: () => s(""),
				"aria-label": d ? "Search chats" : "Search projects"
			})
		}), /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2 px-2 py-8 [&>*]:shrink-0",
			children: d ? /* @__PURE__ */ X(sh, {
				needle: u,
				activeSessionId: i,
				onPicked: l
			}) : /* @__PURE__ */ X(ch, {
				needle: u,
				activeProjectId: a,
				onPicked: l
			})
		})]
	});
}
function sh({ needle: e, activeSessionId: t, onPicked: n }) {
	let r = ji(), i = Tt(), a = nh(), o = Bm(), s = xd(), { data: c = [] } = _(), l = K(() => Sd(c).filter((t) => !e || s(t.summary).toLowerCase().includes(e)).sort((e, t) => Number(!!t.summary.pinned) - Number(!!e.summary.pinned) || Rn(t.summary.updated_at) - Rn(e.summary.updated_at)), [
		e,
		s,
		c
	]);
	return l.length === 0 ? /* @__PURE__ */ X(lh, { children: e ? "No matching chats" : "No chats yet" }) : l.map((e) => {
		let c = s(e.summary), l = ja(e.summary.behavior);
		return /* @__PURE__ */ X(Ua, {
			title: c,
			behavior: e.summary.behavior,
			showBehaviorIcon: a,
			"aria-label": i.orchestrationEnabled ? `${c}, ${l.navigationLabel}` : c,
			active: e.summary.session_id === t,
			running: y(e.active_run),
			forkedFromTitle: e.summary.forked_from?.title,
			isMobile: !0,
			onClick: () => {
				n(), r(fn.session(e.summary.session_id));
			},
			actions: /* @__PURE__ */ X(ih, {
				title: c,
				pinned: e.summary.pinned,
				isMobile: !0,
				onPin: () => void o.togglePin(e.summary),
				onRename: () => o.rename(e.summary),
				onDelete: () => o.remove(e.summary)
			})
		}, e.summary.session_id);
	});
}
function ch({ needle: e, activeProjectId: t, onPicked: n }) {
	let r = ji(), { data: i } = _t(), { data: a = [] } = _(), o = K(() => Dd(i?.projects ?? [], a).filter((t) => !e || t.project.name.toLowerCase().includes(e)), [
		e,
		i,
		a
	]);
	return o.length === 0 ? /* @__PURE__ */ X(lh, { children: e ? "No matching projects" : "No projects yet" }) : o.map((e) => /* @__PURE__ */ X(Gu, {
		entityId: e.project.project_id,
		name: e.project.name,
		active: e.project.project_id === t,
		running: e.running > 0,
		isMobile: !0,
		actions: /* @__PURE__ */ X(ah, { project: e.project }),
		onClick: () => {
			n(), r(fn.project(e.project.project_id));
		}
	}, e.project.project_id));
}
function lh({ children: e }) {
	return /* @__PURE__ */ X("p", {
		className: "label-small px-3 text-basic-muted",
		children: e
	});
}
// src/app/features/task-launches/useTaskLaunch.ts
function uh() {
	let e = globalThis.crypto;
	if (typeof e?.randomUUID == "function") return e.randomUUID();
	if (typeof e?.getRandomValues != "function") throw Error("This browser cannot securely create a task request. Use a browser with Web Crypto support.");
	let t = e.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
	t[6] = t[6] & 15 | 64, t[8] = t[8] & 63 | 128;
	let n = Array.from(t, (e) => e.toString(16).padStart(2, "0")).join("");
	return `${n.slice(0, 8)}-${n.slice(8, 12)}-${n.slice(12, 16)}-${n.slice(16, 20)}-${n.slice(20)}`;
}
function dh(e) {
	let { api: t } = V(), n = Si(), [r, i] = J(null), [a, o] = J(null), s = xi({
		queryKey: ["task-launches", e],
		queryFn: ({ signal: n }) => t.taskLaunchInventory(e, n),
		refetchInterval: 2e3
	}), c = yi({
		mutationFn: (e) => t.startTaskLaunch(e),
		retry: !1,
		onSuccess: () => n.invalidateQueries({ queryKey: ["task-launches", e] })
	}), l = yi({
		mutationFn: (e) => t.cancelTaskLaunch(e),
		onSuccess: () => n.invalidateQueries({ queryKey: ["task-launches", e] })
	}), u = s.data?.find((e) => e.request.request_id === r?.request_id);
	return G(() => {
		u?.first_input_id != null && n.invalidateQueries({ queryKey: on.sessionsAll });
	}, [n, u?.first_input_id]), {
		inventory: s,
		start: c,
		cancel: l,
		receipt: u,
		intent: r,
		error: a ?? c.error,
		launch: (e) => {
			try {
				let t = r ?? {
					...e,
					request_id: uh()
				};
				o(null), i(t), c.mutate(t);
			} catch (e) {
				o(e instanceof Error ? e : /* @__PURE__ */ Error("Could not securely create a task request."));
			}
		},
		retry: (e) => {
			o(null), i(e), c.mutate(e);
		},
		newRequest: () => {
			o(null), i(null), c.reset();
		}
	};
}
// src/app/features/task-launches/TaskLaunchModal.tsx
var fh = {
	pinned: "Commit pinned",
	preparing_workspace: "Preparing isolated checkout",
	preparing_runtime: "Checking agent readiness",
	ready: "Task ready",
	failed: "Preparation failed — files retained",
	cancelled: "Cancelled — files retained"
};
function ph({ projectId: e, defaultRef: t, onClose: n, onExistingCheckout: r }) {
	let i = Ai(), [a, o] = J(""), [s, c] = J(""), [l, u] = J(""), [d, f] = J(t ?? ""), p = dh(e), m = p.intent !== null;
	return /* @__PURE__ */ X(Xn, {
		open: !0,
		title: "New isolated task",
		size: Tn.Wide,
		onClose: n,
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-3",
			children: [
				/* @__PURE__ */ X("p", {
					className: "text-micro text-basic-muted",
					children: "Start a direct agent in a retained Local Git checkout. Source edits are excluded. Your project model settings apply. Repository setup remains the agent's first work."
				}),
				!p.receipt && /* @__PURE__ */ Z(Y, { children: [
					/* @__PURE__ */ X($, {
						label: "Task title",
						"aria-label": "Task title",
						value: a,
						maxLength: 120,
						isDisabled: m,
						onChange: (e) => o(e.target.value)
					}),
					/* @__PURE__ */ X(tu, {
						label: "Initial brief",
						"aria-label": "Initial brief",
						rows: 4,
						value: s,
						isDisabled: m,
						onChange: (e) => c(e.target.value)
					}),
					/* @__PURE__ */ X($, {
						label: "Git ref (optional)",
						"aria-label": "Git ref (optional)",
						value: l,
						isDisabled: m,
						onChange: (e) => u(e.target.value),
						placeholder: "Branch, tag, or commit"
					}),
					/* @__PURE__ */ X("p", {
						className: "text-micro text-basic-muted",
						children: "An explicit ref wins. Otherwise use the invoking task's committed HEAD in this project, or the destination's saved default branch."
					}),
					!t && /* @__PURE__ */ X($, {
						label: "Save project default branch",
						"aria-label": "Save project default branch",
						value: d,
						isDisabled: m,
						onChange: (e) => f(e.target.value),
						placeholder: "Exact configured branch"
					})
				] }),
				p.error && /* @__PURE__ */ Z("p", {
					role: "alert",
					children: [p.error.message, p.intent && " Retry uses the same request identity."]
				}),
				!p.receipt && /* @__PURE__ */ X(z, {
					variant: B.Primary,
					loading: p.start.isPending,
					disabled: !a.trim() || !s.trim() || !d.trim() || p.start.isPending,
					onClick: () => p.launch({
						project_id: e,
						invoking_session_id: sr(i.pathname),
						git_ref: l.trim() || null,
						default_ref: t ? null : d.trim(),
						title: a.trim(),
						prompt: s.trim()
					}),
					children: m ? "Retry same request" : "Start isolated task"
				}),
				p.intent && (p.receipt || p.start.error) && /* @__PURE__ */ X(z, {
					onClick: p.newRequest,
					children: "Start another intentional task"
				}),
				/* @__PURE__ */ X(z, {
					onClick: r,
					disabled: p.start.isPending,
					children: "Use existing checkout"
				}),
				/* @__PURE__ */ Z("div", {
					"aria-label": "Retained task inventory",
					className: "flex flex-col gap-3",
					children: [p.inventory.error && /* @__PURE__ */ X("p", {
						role: "alert",
						children: p.inventory.error.message
					}), p.inventory.data?.map((e) => /* @__PURE__ */ Z("article", {
						className: "rounded border p-3",
						children: [
							/* @__PURE__ */ X("p", {
								className: "font-medium",
								children: e.request.title
							}),
							/* @__PURE__ */ X("p", {
								role: "status",
								children: fh[e.phase]
							}),
							/* @__PURE__ */ Z("p", {
								className: "break-all text-micro",
								children: [
									e.source.selected_ref,
									" → ",
									e.source.commit
								]
							}),
							/* @__PURE__ */ Z("p", {
								className: "break-all text-micro",
								children: [e.workspace_path, e.source.subdirectory ? `/${e.source.subdirectory}` : ""]
							}),
							/* @__PURE__ */ X("p", {
								className: "text-micro",
								children: "Source edits excluded. Checkout retained after completion, cancellation, or task deletion."
							}),
							e.error && /* @__PURE__ */ X("p", {
								role: "alert",
								className: "break-words",
								children: e.error
							}),
							e.first_input_id != null && !e.session_present && /* @__PURE__ */ X("p", { children: "Task removed — checkout retained." }),
							e.session_present && /* @__PURE__ */ X(Ci, {
								onClick: n,
								to: fn.session(e.session_id),
								children: "Open task"
							}),
							e.phase !== "ready" && e.phase !== "cancelled" && /* @__PURE__ */ X(z, {
								onClick: () => p.retry(e.request),
								disabled: p.start.isPending,
								children: "Resume same request"
							}),
							e.phase !== "cancelled" && /* @__PURE__ */ X(z, {
								onClick: () => p.cancel.mutate(e.request.request_id),
								disabled: p.cancel.isPending,
								children: "Cancel preparation or current run"
							})
						]
					}, e.request.request_id))]
				})
			]
		})
	});
}
// src/app/components/LeftSidebar/NewSessionPopover.tsx
var mh = [
	{
		behavior: "direct",
		label: "Agent Session"
	},
	{
		behavior: "direct-with-orchestrator",
		label: "Agent + Orchestrator Session"
	},
	{
		behavior: "orchestrator",
		label: "Orchestrator Session"
	}
];
function hh(e) {
	let t = ja(e);
	return [
		t.topLevel,
		t.editing,
		t.delegation,
		t.inspection
	].join(" ");
}
function gh({ projectId: e, onUnavailable: t, className: n, children: r }) {
	let i = Tt(), [a, o] = J(!1), [s, c] = J(null), [l, u] = J(!1), [d, f] = J(null), { api: p } = V(), m = ji(), h = nr(), g = vr(), _ = () => {
		e ? i.orchestrationEnabled ? o((e) => !e) : v("direct") : t();
	}, v = async (t, n = !1) => {
		if (!(!e || g.isPending || l)) try {
			if (t === "direct" && !n) {
				u(!0);
				let t;
				try {
					t = await p.taskLaunchSource(e);
				} catch (e) {
					o(!1), f(nf(Ud(e)));
					return;
				} finally {
					u(!1);
				}
				if (t.eligible) {
					o(!1), c({ defaultRef: t.default_ref ?? null });
					return;
				}
			}
			let r = (await g.mutateAsync({
				project_id: e,
				behavior: Pt(i, t)
			})).metadata.session_id;
			o(!1), r && m(fn.session(r));
		} catch (e) {
			u(!1), h.error(`Failed to start a chat: ${nf(Ud(e))}`);
		}
	};
	return /* @__PURE__ */ Z(Y, { children: [
		d && /* @__PURE__ */ Z(Xn, {
			open: !0,
			title: "Git source unavailable",
			onClose: () => f(null),
			children: [
				/* @__PURE__ */ X("p", {
					role: "alert",
					children: d
				}),
				/* @__PURE__ */ X("p", { children: "Repair the Git source to start an isolated task, or explicitly use the existing checkout." }),
				/* @__PURE__ */ X(z, {
					onClick: () => {
						f(null), v("direct", !0);
					},
					children: "Use existing checkout"
				})
			]
		}),
		s && e && /* @__PURE__ */ X(ph, {
			projectId: e,
			defaultRef: s.defaultRef,
			onClose: () => c(null),
			onExistingCheckout: () => {
				c(null), v("direct", !0);
			}
		}),
		/* @__PURE__ */ X(x, {
			open: a,
			onClose: () => o(!1),
			sticky: !0,
			placement: M.RightTop,
			size: Le.Medium,
			panelClassName: "gap-2",
			className: n,
			content: /* @__PURE__ */ X(Y, { children: mh.map((e) => {
				let t = ja(e.behavior);
				return /* @__PURE__ */ Z(Ui, {
					disabled: g.isPending || l,
					hoverHint: {
						title: t.label,
						description: hh(e.behavior),
						muted: !0
					},
					onClick: () => void v(e.behavior),
					children: [/* @__PURE__ */ X(Va, { behavior: e.behavior }), /* @__PURE__ */ X("span", {
						className: "min-w-0 flex-1 truncate text-left",
						children: e.label
					})]
				}, e.behavior);
			}) }),
			children: r(_)
		})
	] });
}
// src/app/components/LeftSidebar/SidebarProjectList.tsx
var _h = 6e4, vh = 4;
function yh({ projects: e, sessions: t, query: n, activeSessionId: r, activeProjectId: i, mobile: a = !1, onNavigate: o }) {
	let s = ji(), c = (e) => {
		o?.(), s(fn.session(e));
	}, l = xd(), u = Jn(_h), [d, f] = J(() => /* @__PURE__ */ new Set()), [p, m] = J(() => /* @__PURE__ */ new Map()), [h, g] = J(() => /* @__PURE__ */ new Set()), _ = n.trim().toLowerCase(), v = K(() => Dd(e, t), [e, t]), b = K(() => t.filter((e) => e.lineage == null && !e.summary.project_id), [t]), x = (e) => _ ? !0 : p.get(e) === r ? !1 : d.has(e) || e === i, S = (e) => {
		x(e) ? (m((t) => new Map(t).set(e, r)), f((t) => {
			let n = new Set(t);
			return n.delete(e), n;
		})) : (f((t) => new Set(t).add(e)), m((t) => {
			let n = new Map(t);
			return n.delete(e), n;
		}));
	}, C = v.filter((e) => !_ || e.project.name.toLowerCase().includes(_) ? !0 : e.sessions.some((e) => l(e.summary).toLowerCase().includes(_))), w = b.filter((e) => !_ || l(e.summary).toLowerCase().includes(_));
	return C.length === 0 && w.length === 0 ? /* @__PURE__ */ X("p", {
		className: "label-small text-basic-muted px-4 py-3",
		children: "No matching sessions"
	}) : /* @__PURE__ */ Z("div", {
		className: I("flex flex-col [&>*]:shrink-0", a && "gap-2 px-2 py-4"),
		children: [C.map((e, t) => {
			let n = e.project.project_id, i = x(n), o = e.project.name.toLowerCase().includes(_), s = _ && !o ? e.sessions.filter((e) => l(e.summary).toLowerCase().includes(_)) : e.sessions, d = /* @__PURE__ */ X(Gu, {
				entityId: n,
				name: e.project.name,
				running: e.running > 0,
				isMobile: a,
				actions: a ? /* @__PURE__ */ X(ah, { project: e.project }) : void 0,
				"aria-expanded": i,
				onClick: () => S(n)
			});
			return /* @__PURE__ */ Z(ai, { children: [a && t > 0 ? /* @__PURE__ */ X(nd, {}) : null, /* @__PURE__ */ Z("section", {
				className: a ? "flex flex-col" : "border-b border-muted py-4",
				children: [a ? d : /* @__PURE__ */ X("div", {
					className: "px-2 py-1",
					children: d
				}), /* @__PURE__ */ X(Io, {
					isOpen: i,
					inert: !i,
					"aria-hidden": !i,
					className: "w-full duration-500 ease-in-out",
					children: /* @__PURE__ */ X(Sh, {
						sessions: s,
						activeSessionId: r,
						revealed: _.length > 0 || h.has(n),
						onReveal: () => g((e) => {
							let t = new Set(e);
							return t.add(n), t;
						}),
						now: u,
						mobile: a,
						onOpen: c
					})
				})]
			})] }, n);
		}), w.length > 0 ? /* @__PURE__ */ Z(Y, { children: [a && C.length > 0 ? /* @__PURE__ */ X(nd, {}) : null, /* @__PURE__ */ X("section", {
			className: I("flex flex-col", a ? "gap-1" : "px-2 py-1"),
			children: w.map((e) => /* @__PURE__ */ X(Gu, {
				entityId: e.summary.session_id,
				name: l(e.summary),
				variant: Wu.Orphan,
				active: e.summary.session_id === r,
				running: y(e.active_run),
				isMobile: a,
				onClick: () => c(e.summary.session_id)
			}, e.summary.session_id))
		})] }) : null]
	});
}
function bh(e, t, n) {
	if (!n || e.some((e) => e.items.some((e) => e.summary.session_id === n))) return e;
	let r = t.find((e) => e.items.some((e) => e.summary.session_id === n)), i = r?.items.find((e) => e.summary.session_id === n);
	return !r || !i ? e : e.find((e) => e.label === r.label) ? e.map((e) => e.label === r.label ? {
		...e,
		items: [...e.items, i]
	} : e) : [...e, {
		label: r.label,
		items: [i]
	}];
}
function xh(e, t) {
	if (t) return e;
	let n = vh, r = [];
	for (let t of e) {
		if (t.label === "Pinned") {
			r.push(t);
			continue;
		}
		if (n <= 0) continue;
		let e = t.items.slice(0, n);
		n -= e.length, e.length > 0 && r.push({
			label: t.label,
			items: e
		});
	}
	return r;
}
function Sh({ sessions: e, activeSessionId: t, revealed: n, onReveal: r, now: i, mobile: a, onOpen: o }) {
	let s = xd(), c = Tt(), l = nh(), u = Bm(), d = K(() => zd(e, (e) => ({
		updatedAt: e.summary.updated_at,
		pinned: !!e.summary.pinned
	}), i), [e, i]);
	if (e.length === 0) return /* @__PURE__ */ X("p", {
		className: "label-small text-basic-muted px-4 pb-3",
		children: "No chats yet"
	});
	let f = bh(xh(d, n), d, t), p = f.reduce((e, t) => e + t.items.length, 0), m = Math.max(0, e.length - p);
	return /* @__PURE__ */ Z("div", {
		className: I("flex flex-col", a ? "gap-0.5 pt-1 pb-4" : "gap-1 px-2 pb-2"),
		children: [f.map((e) => /* @__PURE__ */ Z("div", {
			className: I("flex flex-col", a && "gap-2 pt-4"),
			children: [/* @__PURE__ */ X("p", {
				className: I("tag-label text-basic-tertiary uppercase px-2", a ? null : "pt-4 pb-4"),
				children: e.label
			}), /* @__PURE__ */ X("div", {
				className: I("flex flex-col", a ? "gap-1" : "gap-0.5"),
				children: e.items.map((e) => {
					let n = s(e.summary), r = ja(e.summary.behavior);
					return /* @__PURE__ */ X(Ua, {
						title: n,
						behavior: e.summary.behavior,
						showBehaviorIcon: l,
						"aria-label": c.orchestrationEnabled ? `${n}, ${r.navigationLabel}` : n,
						active: e.summary.session_id === t,
						running: y(e.active_run),
						forkedFromTitle: e.summary.forked_from?.title,
						isMobile: a,
						onClick: () => o(e.summary.session_id),
						actions: /* @__PURE__ */ X(ih, {
							title: n,
							pinned: e.summary.pinned,
							isMobile: a,
							onPin: () => void u.togglePin(e.summary),
							onRename: () => u.rename(e.summary),
							onDelete: () => u.remove(e.summary)
						})
					}, e.summary.session_id);
				})
			})]
		}, e.label)), m > 0 ? /* @__PURE__ */ Z(Ui, {
			size: a ? Bi.Large : void 0,
			onClick: r,
			children: [/* @__PURE__ */ X(R, { iconName: H.MenuHorizontal }), /* @__PURE__ */ Z("span", {
				className: "text-left flex-grow",
				children: [
					"See ",
					m,
					" more"
				]
			})]
		}) : null]
	});
}
// src/app/components/modals/ConfigListNav.tsx
function Ch({ draftLabel: e, draftSelected: t, onSelectDraft: n, entries: r, selectedId: i, onSelect: a, isLoading: o = !1 }) {
	let s = N(), [c, l] = J(!1), u = t ? e : r.find((e) => e.id === i)?.name ?? e, d = () => {
		n(), l(!1);
	}, f = (e) => {
		a(e), l(!1);
	}, p = /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ Z(Ui, {
			size: s ? Bi.Large : Bi.Medium,
			variant: Vi.Regular,
			active: t,
			onClick: d,
			children: [/* @__PURE__ */ X(R, { iconName: H.Add }), /* @__PURE__ */ X("span", {
				className: "text-left flex-grow truncate",
				children: e
			})]
		}),
		r.length ? /* @__PURE__ */ X(nd, {}) : null,
		r.map((e) => /* @__PURE__ */ X(Ui, {
			size: s ? Bi.Large : Bi.Medium,
			active: i === e.id,
			onClick: () => f(e.id),
			children: /* @__PURE__ */ X("span", {
				className: "text-left flex-grow truncate",
				children: e.name
			})
		}, e.id)),
		o ? /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-2 px-2 py-1",
			children: [/* @__PURE__ */ X(ut, { size: bt.XSmall }), /* @__PURE__ */ X("span", {
				className: "text-micro text-basic-muted",
				children: "Loading…"
			})]
		}) : null
	] });
	return s ? /* @__PURE__ */ X("div", {
		className: "shrink-0 border-b border-muted px-2 py-2",
		children: /* @__PURE__ */ X(x, {
			open: c,
			onClose: () => l(!1),
			placement: M.BottomLeft,
			size: "min-w-full",
			className: "w-full",
			panelClassName: "max-h-[50dvh] overflow-auto",
			content: /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-1 px-2",
				children: p
			}),
			children: /* @__PURE__ */ Z(z, {
				variant: B.Ghost,
				size: U.Large,
				content: g.Icon,
				className: "w-full",
				"aria-expanded": c,
				"aria-label": "Choose configuration",
				onClick: () => l((e) => !e),
				children: [
					t ? /* @__PURE__ */ X(R, {
						iconName: H.Add,
						className: "shrink-0"
					}) : null,
					/* @__PURE__ */ X("span", {
						className: "text-left flex-grow truncate",
						children: u
					}),
					/* @__PURE__ */ X(R, {
						iconName: H.Down,
						className: I("shrink-0 transition-transform duration-150 ease-out", c ? "rotate-180" : "rotate-0")
					})
				]
			})
		})
	}) : /* @__PURE__ */ X("div", {
		className: "flex flex-col shrink-0 gap-2 w-[240px] overflow-y-auto border-r border-muted px-2 py-4 [&>*]:shrink-0",
		children: p
	});
}
// src/app/components/modals/ConfigurationsModal.tsx
var wh = br.map((e) => ({
	id: e,
	label: rn(e)
})), Th = ip.filter((e) => e.id !== Gf).map((e) => e.id === "" ? {
	...e,
	label: "Not set"
} : e), Eh = "__new__";
function Dh({ open: e, onClose: t }) {
	return cp(e) ? /* @__PURE__ */ X(Oh, {
		open: e,
		onClose: t
	}) : null;
}
function Oh({ open: e, onClose: t }) {
	let n = N(), { data: r, isLoading: i } = Ir(), a = K(() => r?.configurations ?? [], [r]), [o, s] = J(null), [c, l] = J(null), u = c ?? a.at(-1)?.config_id ?? Eh, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: t,
		title: "Configurations",
		size: Tn.Large,
		flush: !0,
		className: "max-w-[820px] md:h-[720px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: o,
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ X(Ch, {
				draftLabel: "New configuration",
				draftSelected: u === Eh,
				onSelectDraft: () => l(Eh),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: l,
				isLoading: i
			}), /* @__PURE__ */ X(kh, {
				record: d,
				takenNames: a.filter((e) => e.config_id !== u).map((e) => e.name),
				onClose: t,
				onSaved: l,
				onDeleted: () => l(null),
				setFooter: s,
				isMobile: n
			}, u)]
		})
	});
}
function kh({ record: e, takenNames: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: o }) {
	let s = nr(), c = $t(), l = Ie(), u = an(), d = e?.backend, [f, p] = J(d ?? "openai-responses"), [m, h] = J(e?.name ?? null), [_, v] = J(e?.base_url ?? ""), [y, b] = J(e?.allow_insecure_http ?? !1), [x, S] = J(""), [C, w] = J(e?.model ?? ""), [T, E] = J(e?.reasoning_effort ?? ""), [D, O] = J(e?.orchestrator_compaction_threshold?.toString() ?? ""), k = q(e?.orchestrator_compaction_threshold?.toString() ?? ""), ee = q(e?.orchestrator_compaction_threshold == null), [A, te] = J(() => e && Object.keys(e.extra_headers).length ? JSON.stringify(e.extra_headers, null, 2) : ""), [j, ne] = J(e?.initial_prompt ?? ""), [re, ie] = J({
		mode: e?.light_model ? "dual" : "single",
		light: e?.light_model ?? null
	}), [ae, oe] = J(""), se = m ?? Ah(f, t), ce = cr(f), M = Rt(), le = op(yf(M.data, f, C).supportedEfforts, T, Th), ue = K(() => {
		let e = yf(M.data, f, C).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		M.data,
		f,
		C
	]);
	G(() => {
		ue !== "auto" && (k.current === "" || ee.current) && (ee.current = !0, k.current = ue, O(ue));
	}, [ue]);
	let { signedIn: de } = Rf(f), fe = gp(x.trim(), 600), N = Xr(f, fe, null, ce && !!fe), pe = Jr(f, !ce && de), P = Jt(e && f === d ? e.config_id : null, ""), me = ce && fe ? N.isFetching ? { status: "validating" } : N.error ? {
		status: "error",
		message: nf(N.error, f)
	} : N.data ? {
		status: "ready",
		models: N.data.models,
		baseUrl: N.data.base_url
	} : { status: "validating" } : { status: "idle" }, F = N.data?.models ?? pe.data?.models ?? P.data?.models ?? [], he = F.some((e) => e.id === C) ? C : C ?? "", ge = me.status === "idle" ? e?.api_key_env ? "ready" : "idle" : me.status, _e = c.isPending || l.isPending || u.isPending, L = (e) => (t) => {
		oe(""), e(t);
	}, ve = async () => {
		if (_e) return;
		if (!se.trim()) {
			oe("A name is required.");
			return;
		}
		if (!he.trim()) {
			oe("A model is required.");
			return;
		}
		let t;
		try {
			t = Qf(A, {});
		} catch (e) {
			oe(Vt(Ud(e)));
			return;
		}
		let n = D.trim() ? Number(D.trim()) : 0, i = T || null;
		if (!Number.isSafeInteger(n) || n < 0) {
			oe("The compaction threshold must be a whole number, or 0 to disable it.");
			return;
		}
		if (re.mode === "dual" && !re.light) {
			oe("Pick the light model before saving.");
			return;
		}
		let a = re.mode === "dual" ? re.light : null;
		try {
			if (e) {
				let o = {
					name: se.trim(),
					backend: f,
					model: he.trim(),
					allow_insecure_http: y,
					reasoning_effort: i,
					extra_headers: t,
					orchestrator_compaction_threshold: n,
					initial_prompt: j.trim() || null,
					light_model: a
				};
				x.trim() && (o.api_key = x.trim()), _.trim() && (o.base_url = _.trim());
				let c = await l.mutateAsync({
					configId: e.config_id,
					payload: o
				});
				r(c.config_id), s.success(`Configuration ${c.name} saved`);
			} else {
				let e = await c.mutateAsync({
					name: se.trim(),
					backend: f,
					model: he.trim(),
					base_url: _.trim() || null,
					allow_insecure_http: y,
					api_key: ce ? x.trim() : null,
					reasoning_effort: i,
					extra_headers: t,
					orchestrator_compaction_threshold: n,
					initial_prompt: j.trim() || null,
					light_model: a
				});
				r(e.config_id), s.success(`Configuration ${e.name} created`);
			}
		} catch (e) {
			oe(nf(Ud(e), f));
		}
	}, ye = async () => {
		if (e && !_e) try {
			await u.mutateAsync(e.config_id), i(), s.success(`Configuration ${e.name} removed`);
		} catch (e) {
			oe(nf(Ud(e)));
		}
	}, be = q(ve), xe = q(ye);
	return pi(() => {
		be.current = ve, xe.current = ye;
	}), pi(() => {
		let t = c.isPending || l.isPending;
		return a(/* @__PURE__ */ Z(Y, { children: [
			e ? o ? /* @__PURE__ */ X(Zr, {
				variant: B.SecondaryDestructive,
				content: g.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: _e,
				loading: u.isPending,
				onClick: () => void xe.current(),
				children: /* @__PURE__ */ X(R, { iconName: H.Trash })
			}) : /* @__PURE__ */ X(z, {
				variant: B.SecondaryDestructive,
				size: U.Large,
				content: g.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: _e,
				loading: u.isPending,
				onClick: () => void xe.current(),
				children: /* @__PURE__ */ X(R, { iconName: H.Trash })
			}) : null,
			o ? /* @__PURE__ */ X(Zr, {
				variant: B.Secondary,
				content: g.Text,
				onClick: n,
				children: "Cancel"
			}) : /* @__PURE__ */ X(z, {
				variant: B.Ghost,
				size: U.Large,
				content: g.Text,
				onClick: n,
				children: "Cancel"
			}),
			o ? /* @__PURE__ */ X(Zr, {
				variant: B.Primary,
				content: g.Text,
				disabled: _e,
				loading: t,
				onClick: () => void be.current(),
				children: "Save"
			}) : /* @__PURE__ */ X(z, {
				variant: B.Primary,
				size: U.Large,
				content: g.Text,
				disabled: _e,
				loading: t,
				onClick: () => void be.current(),
				children: "Save"
			})
		] })), () => a(null);
	}, [
		_e,
		c.isPending,
		u.isPending,
		o,
		n,
		e,
		a,
		l.isPending
	]), /* @__PURE__ */ X("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: /* @__PURE__ */ Z("div", {
			className: I("flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", o && "pb-[88px]"),
			children: [
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col md:rounded-[8px] md:bg-elevation-level-2 md:border md:border-muted md:p-3 gap-4 md:gap-2",
					children: [
						/* @__PURE__ */ X(uf, {
							label: "Model Provider",
							required: !0,
							hint: "Service that provides the models for this session.",
							control: /* @__PURE__ */ X(dp, {
								items: wh,
								value: f,
								onValueChange: (e) => {
									L(p)(e), S(""), w("");
								}
							})
						}),
						/* @__PURE__ */ X(nd, {}),
						/* @__PURE__ */ X(uf, {
							label: "Name",
							required: !0,
							hint: "How this setup is listed the next time a session is created.",
							verticalOnMobile: !0,
							control: /* @__PURE__ */ X($, {
								inputSize: o ? Q.Large : Q.Medium,
								className: "w-full md:w-[280px]",
								"aria-label": "Configuration name",
								value: se,
								onChange: (e) => L(h)(e.target.value)
							})
						}),
						/* @__PURE__ */ X(nd, {}),
						ce ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(uf, {
							label: "API Key",
							required: !0,
							invalid: me.status === "error",
							verticalOnMobile: !0,
							hint: e ? "Held by NAC for this configuration; type a new key to replace it." : "Stored in NAC under a generated name once the setup is saved.",
							control: /* @__PURE__ */ X($, {
								inputSize: o ? Q.Large : Q.Medium,
								className: "w-full md:w-[280px]",
								type: "password",
								autoComplete: "off",
								placeholder: e?.api_key_env ? fp : "Paste the provider key",
								leadingSlot: /* @__PURE__ */ X(jf, { status: ge }),
								validation: me.status === "error",
								value: x,
								onChange: (e) => L(S)(e.target.value)
							})
						}), /* @__PURE__ */ X(nd, {})] }) : null,
						/* @__PURE__ */ X(uf, {
							label: "Base URL",
							hint: "Endpoint the session sends its requests to; blank uses the provider's own.",
							control: /* @__PURE__ */ X($, {
								inputSize: o ? Q.Large : Q.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "https://api.openai.com/v1",
								value: _,
								onChange: (e) => L(v)(e.target.value)
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ X(nd, {}),
						/* @__PURE__ */ X(uf, {
							label: "Allow insecure HTTP",
							control: /* @__PURE__ */ Z("div", {
								className: "w-full md:w-[280px] flex flex-col items-start gap-1",
								children: [/* @__PURE__ */ X(pd, {
									"aria-label": "Allow insecure HTTP",
									checked: y,
									onChange: L(b)
								}), /* @__PURE__ */ X("p", {
									className: "body-small text-basic-secondary",
									children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
								})]
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ X(nd, {}),
						/* @__PURE__ */ X(uf, {
							label: "Default Model",
							required: !0,
							hint: "Sessions started from this setup begin with this default and may switch to another.",
							verticalOnMobile: !F.length,
							control: F.length ? /* @__PURE__ */ X(dp, {
								items: pp(F),
								value: he,
								onValueChange: L(w),
								placeholder: "No models offered"
							}) : /* @__PURE__ */ X($, {
								inputSize: o ? Q.Large : Q.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "gpt-5.5",
								value: C,
								onChange: (e) => L(w)(e.target.value)
							})
						}),
						/* @__PURE__ */ X(nd, {}),
						/* @__PURE__ */ X(uf, {
							label: "Reasoning Effort",
							hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
							control: /* @__PURE__ */ X(dp, {
								items: le,
								value: T,
								onValueChange: L(E)
							})
						}),
						/* @__PURE__ */ X(nd, {}),
						/* @__PURE__ */ X(uf, {
							label: "Context Limit",
							verticalOnMobile: !0,
							labelClassName: "max-w-none",
							hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
							control: /* @__PURE__ */ Z("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ X($, {
									inputSize: o ? Q.Large : Q.Medium,
									className: "w-full md:w-[105px]",
									inputClassName: "text-right",
									placeholder: ue,
									inputMode: "numeric",
									value: D,
									onChange: (e) => {
										oe(""), ee.current = !1, k.current = e.target.value, O(e.target.value);
									}
								}), /* @__PURE__ */ X("span", {
									className: "shrink-0 text-micro text-basic-muted",
									children: "tokens"
								})]
							})
						}),
						/* @__PURE__ */ X(nd, {}),
						/* @__PURE__ */ X(Dp, {
							initial: e?.light_model ?? null,
							onChange: ie
						}),
						/* @__PURE__ */ X(nd, {}),
						/* @__PURE__ */ X(tu, {
							label: "Extra headers (JSON object)",
							hintText: "Blank sends none; header values must be strings.",
							placeholder: "{\"X-Title\": \"NAC\"}",
							value: A,
							onChange: (e) => L(te)(e.target.value),
							textAreaClassName: "h-[108px] resize-none"
						}),
						/* @__PURE__ */ X(nd, {}),
						/* @__PURE__ */ X(tu, {
							label: "Initial prompt",
							hintText: "Pre-fills the first message of a session started from this setup.",
							placeholder: "Send a message",
							value: j,
							onChange: (e) => L(ne)(e.target.value),
							textAreaClassName: "h-[92px] resize-none"
						})
					]
				}),
				/* @__PURE__ */ X(Bf, {
					backend: f,
					className: "mt-2"
				}),
				ae ? /* @__PURE__ */ X("p", {
					className: "label-micro text-error-primary pt-2",
					children: ae
				}) : null,
				/* @__PURE__ */ X("p", {
					className: "text-micro text-basic-muted pt-2",
					children: "* Required fields"
				})
			]
		})
	});
}
function Ah(e, t) {
	let n = new Set(t);
	for (let t = 1;; t += 1) {
		let r = `${e}-config-${t}`;
		if (!n.has(r)) return r;
	}
}
// src/app/components/modals/MCPServersModal/McpEntryDetails.tsx
function jh({ entry: e }) {
	let [t, n] = J(!1);
	return /* @__PURE__ */ X("div", {
		className: "flex items-center justify-center size-10 shrink-0 rounded-md bg-elevation-sublevel-variant-B overflow-hidden",
		children: e.icon_url && !t ? /* @__PURE__ */ X("img", {
			src: e.icon_url,
			alt: "",
			className: "size-8 object-contain",
			loading: "lazy",
			onError: () => n(!0)
		}) : /* @__PURE__ */ X("span", {
			className: "text-small text-basic-muted uppercase",
			children: e.name.charAt(0)
		})
	});
}
function Mh({ entry: e }) {
	let [t, n] = J(!1), [r, i] = J(!1), a = q(null), o = e.description.replace(/\bDocs:\s*https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
	return pi(() => {
		let e = a.current;
		e && i(e.scrollHeight > e.clientHeight);
	}, [o]), /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2 rounded-lg border border-muted p-3 bg-elevation-sublevel-variant-A",
		children: [/* @__PURE__ */ Z("div", {
			className: "flex items-center gap-2 min-w-0",
			children: [
				/* @__PURE__ */ X(jh, { entry: e }),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col min-w-0 flex-grow",
					children: [/* @__PURE__ */ Z("div", {
						className: "flex items-center gap-2 min-w-0",
						children: [/* @__PURE__ */ X("span", {
							className: "header-small text-basic-primary truncate",
							children: e.name
						}), e.auth === "required_header" ? /* @__PURE__ */ X(ia, {
							text: "Key required",
							color: na.Yellow
						}) : null]
					}), /* @__PURE__ */ X("span", {
						className: "tag-label text-basic-muted",
						children: e.category
					})]
				}),
				/* @__PURE__ */ Z("a", {
					href: e.docs_url,
					target: "_blank",
					rel: "noopener noreferrer",
					className: "flex items-center gap-1 shrink-0 text-small text-info-primary hover:underline",
					children: [/* @__PURE__ */ X(R, { iconName: H.BookOpen }), "Docs"]
				})
			]
		}), o ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("span", {
			ref: a,
			className: I("text-small text-basic-muted", !t && "line-clamp-3"),
			children: o
		}), r || t ? /* @__PURE__ */ X("button", {
			type: "button",
			className: "self-start text-small text-basic-primary hover:underline",
			onClick: () => n((e) => !e),
			children: t ? "Show less" : "Show more"
		}) : null] }) : null]
	});
}
// src/app/components/modals/ModalFooterButton.tsx
function Nh({ isMobile: e, variant: t, content: n, className: r, disabled: i, onClick: a, children: o, ariaLabel: s }) {
	return e ? /* @__PURE__ */ X(Zr, {
		variant: t,
		content: n ?? g.Text,
		className: r,
		disabled: i,
		"aria-label": s,
		onClick: a,
		children: o
	}) : /* @__PURE__ */ X(z, {
		size: U.Large,
		variant: t,
		content: n,
		className: r,
		disabled: i,
		"aria-label": s,
		onClick: a,
		children: o
	});
}
// src/app/components/modals/MCPServersModal/McpLibraryPicker.tsx
function Ph({ onPick: e, onCustom: t, onClose: n, setFooter: r }) {
	let i = N(), { data: a } = lr(), { data: o } = yn(), [s, c] = J(""), [l, u] = J(null), d = K(() => {
		let e = [];
		for (let t of a?.entries ?? []) e.includes(t.category) || e.push(t.category);
		return e;
	}, [a]), f = K(() => {
		let e = /* @__PURE__ */ new Set(), t = /* @__PURE__ */ new Set();
		for (let n of o?.servers ?? []) n.library_id && e.add(n.library_id), t.add(n.name);
		return (n) => e.has(n.id) || t.has(n.name);
	}, [o]), p = K(() => {
		let e = (a?.entries ?? []).filter((e) => l === null || e.category === l), t = s.trim().toLowerCase();
		if (t) {
			let n = e.filter((e) => e.name.toLowerCase().includes(t) || e.description.toLowerCase().includes(t)), r = n.length > 0 ? n : e.filter((e) => e.tags.some((e) => e.toLowerCase().includes(t)));
			return r.length > 0 ? [{
				category: null,
				entries: r
			}] : [];
		}
		let n = [];
		for (let t of e) {
			let e = n.find((e) => e.category === t.category);
			e ? e.entries.push(t) : n.push({
				category: t.category,
				entries: [t]
			});
		}
		return n;
	}, [
		a,
		s,
		l
	]);
	return pi(() => {
		if (n && r) return r(/* @__PURE__ */ X(Nh, {
			isMobile: i,
			variant: B.Tertiary,
			onClick: n,
			children: "Close"
		})), () => r(null);
	}, [
		i,
		n,
		r
	]), /* @__PURE__ */ Z("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: [/* @__PURE__ */ Z("div", {
			className: "shrink-0 flex flex-col gap-2",
			children: [/* @__PURE__ */ Z("div", {
				className: "flex items-center gap-2 px-4 pt-4",
				children: [/* @__PURE__ */ X($, {
					className: "flex-1 min-w-0",
					inputSize: Q.Medium,
					leading: Hl.Icon,
					leadingIconName: H.Search,
					placeholder: "Search the library",
					value: s,
					onChange: (e) => c(e.target.value)
				}), /* @__PURE__ */ X(z, {
					size: U.Medium,
					variant: B.Secondary,
					content: g.Text,
					className: "shrink-0",
					onClick: t,
					children: i ? "Custom" : "Custom server"
				})]
			}), d.length > 1 ? /* @__PURE__ */ X("div", {
				className: "overflow-x-auto scrollbar-none [&>*]:shrink-0",
				children: /* @__PURE__ */ X("div", {
					className: "flex gap-1.5 px-4 py-2",
					children: [null, ...d].map((e) => /* @__PURE__ */ X(z, {
						size: i ? U.Medium : U.Small,
						variant: l === e ? B.Primary : B.Secondary,
						content: g.Text,
						"aria-pressed": l === e,
						onClick: () => u(e),
						className: i ? "!rounded-full" : "",
						children: e ?? "All"
					}, e ?? "all"))
				})
			}) : null]
		}), /* @__PURE__ */ X("div", {
			className: I("flex-1 overflow-auto px-4 pb-4 flex flex-col gap-2 [&>*]:shrink-0", i && n && "pb-[88px]"),
			children: p.map((t) => /* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-2 [&>*]:shrink-0",
				children: [t.category === null ? null : /* @__PURE__ */ X("span", {
					className: "tag-label text-basic-muted pt-6 px-1",
					children: t.category
				}), t.entries.map((t) => {
					let n = f(t);
					return /* @__PURE__ */ Z(Ui, {
						size: Bi.Large,
						disabled: n,
						className: I(n && "opacity-50", "!px-2"),
						onClick: () => e(t),
						children: [
							/* @__PURE__ */ X(jh, { entry: t }),
							/* @__PURE__ */ Z("div", {
								className: "flex flex-col items-start text-left min-w-0 flex-grow py-1",
								children: [/* @__PURE__ */ Z("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ X("span", {
										className: "label-small text-basic-primary",
										children: t.name
									}), n ? /* @__PURE__ */ X(ia, {
										text: "Added",
										color: na.Green
									}) : t.auth === "required_header" ? /* @__PURE__ */ X(ia, {
										text: "Key required",
										color: na.Yellow
									}) : null]
								}), /* @__PURE__ */ X("span", {
									className: "text-micro text-basic-muted truncate w-full",
									children: t.description
								})]
							}),
							n ? null : /* @__PURE__ */ X(R, {
								iconName: H.Right,
								className: "shrink-0"
							})
						]
					}, t.id);
				})]
			}, t.category ?? "search"))
		})]
	});
}
// src/app/lib/mcpArgRows.ts
var Fh = 0;
function Ih(e = "") {
	return Fh += 1, {
		id: Fh,
		value: e
	};
}
function Lh(e = []) {
	return e.map((e) => Ih(e));
}
function Rh(e) {
	return e.map((e) => e.value.trim()).filter(Boolean);
}
// src/app/components/modals/MCPServersModal/McpArgsEditor.tsx
function zh({ label: e, itemLabel: t, rows: n, onChange: r }) {
	let i = N(), a = q(/* @__PURE__ */ new Map()), o = q(null), s = q(null);
	pi(() => {
		let e = s.current;
		e !== null && (s.current = null, e === "add" ? o.current?.querySelector("button")?.focus() : a.current.get(e)?.focus());
	});
	let c = () => {
		let e = Ih();
		s.current = e.id, r([...n, e]);
	}, l = (e) => {
		s.current = (n[e + 1] ?? n[e - 1])?.id ?? "add", r(n.filter((t, n) => n !== e));
	}, u = (e, t) => {
		let i = t.clipboardData.getData("text");
		if (!/[\r\n]/.test(i)) return;
		t.preventDefault();
		let { selectionStart: a, selectionEnd: o } = t.currentTarget, c = n[e].value, l = (c.slice(0, a ?? c.length) + i + c.slice(o ?? c.length)).split(/\r\n|\r|\n/).filter((e) => e.trim());
		l.length === 0 && l.push("");
		let u = l.map((t, r) => r === 0 ? {
			...n[e],
			value: t
		} : Ih(t));
		s.current = u[u.length - 1].id, r([
			...n.slice(0, e),
			...u,
			...n.slice(e + 1)
		]);
	}, d = t.toLowerCase();
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ X(lf, { label: e }),
			/* @__PURE__ */ X("p", {
				className: "label-small text-basic-tertiary",
				children: "Each field is one argument. Values are passed in this order."
			}),
			n.length === 0 ? /* @__PURE__ */ X("p", {
				className: "label-small text-basic-tertiary",
				children: "No arguments."
			}) : null,
			n.map((e, o) => /* @__PURE__ */ Z("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ X($, {
					ref: (t) => {
						t ? a.current.set(e.id, t) : a.current.delete(e.id);
					},
					inputSize: i ? Q.Large : Q.Medium,
					className: "flex-1 min-w-0",
					inputClassName: "font-mono",
					"aria-label": `${t} ${o + 1}`,
					value: e.value,
					onPaste: (e) => u(o, e),
					onChange: (t) => r(n.map((n) => n.id === e.id ? {
						...n,
						value: t.target.value
					} : n))
				}), /* @__PURE__ */ X(z, {
					size: i ? U.Large : U.Medium,
					variant: B.GhostDestructive,
					content: g.Icon,
					"aria-label": `Remove ${d} ${o + 1}`,
					onClick: () => l(o),
					children: /* @__PURE__ */ X(R, { iconName: H.Trash })
				})]
			}, e.id)),
			/* @__PURE__ */ X("div", {
				ref: o,
				className: "flex flex-col",
				children: /* @__PURE__ */ Z(Ui, {
					type: "button",
					size: i ? Bi.Large : Bi.Medium,
					className: "!border !border-tertiary !border-dashed",
					onClick: c,
					children: [/* @__PURE__ */ X(R, { iconName: H.Add }), "Add argument"]
				})
			})
		]
	});
}
// src/app/components/modals/MCPServersModal/McpKvEditor.tsx
function Bh({ label: e, hint: t, keyPlaceholder: n, rows: r, onChange: i }) {
	let a = N(), o = (e, t) => {
		i(r.map((n, r) => r === e ? {
			...n,
			...t
		} : n));
	};
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-4 md:gap-2",
		children: [
			/* @__PURE__ */ X(lf, {
				label: e,
				hint: t
			}),
			r.map((e, t) => /* @__PURE__ */ Z("div", {
				className: "flex flex-col md:flex-row md:items-center gap-2 p-2 md:p-0 rounded-md bg-elevation-sublevel-variant-A shadow-convex md:shadow-none md:rounded-none md:bg-transparent",
				children: [
					/* @__PURE__ */ X($, {
						inputSize: a ? Q.Large : Q.Medium,
						className: "flex-1 min-w-0",
						placeholder: n,
						value: e.key,
						onChange: (e) => o(t, { key: e.target.value })
					}),
					/* @__PURE__ */ X($, {
						inputSize: a ? Q.Large : Q.Medium,
						className: "flex-1 min-w-0",
						placeholder: e.placeholder ?? "value",
						value: e.value,
						onChange: (e) => o(t, { value: e.target.value })
					}),
					/* @__PURE__ */ Z(z, {
						size: U.Medium,
						variant: B.GhostDestructive,
						content: a ? g.IconLeft : g.Icon,
						"aria-label": "Remove entry",
						onClick: () => i(r.filter((e, n) => n !== t)),
						className: a ? "self-end" : "",
						children: [a ? "Remove" : null, /* @__PURE__ */ X(R, { iconName: H.Trash })]
					})
				]
			}, t)),
			/* @__PURE__ */ Z(Ui, {
				size: a ? Bi.Large : Bi.Medium,
				className: "!border !border-tertiary !border-dashed",
				onClick: () => i([...r, {
					key: "",
					value: ""
				}]),
				children: [/* @__PURE__ */ X(R, { iconName: H.Add }), "Add entry"]
			})
		]
	});
}
// src/app/components/modals/MCPServersModal/McpOAuthPanel.tsx
function Vh(e) {
	switch (e) {
		case "connected": return "Connected";
		case "connecting": return "Waiting for authorization";
		case "failed": return "Authorization failed";
		case "needs_authorization": return "Ready to connect";
		case "needs_configuration": return "Not configured";
		default: return "Checking…";
	}
}
var Hh = "https://slack.com/help/articles/360003125231";
function Uh(e) {
	try {
		return e !== void 0 && new URL(e).hostname === "mcp.slack.com";
	} catch {
		return !1;
	}
}
function Wh({ serverName: e, endpoint: t }) {
	let { api: n } = V(), r = N(), [i, a] = J(null), [o, s] = J(null), [c, l] = J(!1), [u, d] = J(null), [f, p] = J(!1), [m, h] = J(""), [_, v] = J(""), [y, b] = J("pre_registered"), [x, S] = J(""), [C, w] = J("NAC MCP Client"), [T, E] = J("channels:history\nchat:write"), [D, O] = J(""), k = W(async (t = !1) => {
		try {
			let t = await n.getMcpOAuthStatus(e);
			a(t.status), s(t.message ?? null), d(t.authorization_url ?? null);
		} catch {
			t || a("failed"), s(t ? "OAuth status is temporarily unavailable. Retrying…" : "OAuth status is unavailable.");
		}
	}, [n, e]);
	G(() => {
		let e = window.setTimeout(() => void k(), 0);
		return () => window.clearTimeout(e);
	}, [k]), G(() => {
		if (i !== "connecting" && i !== "connected") return;
		let e = !1, t, n = async () => {
			await k(!0), e || (t = window.setTimeout(() => void n(), 1e3));
		};
		return t = window.setTimeout(() => void n(), 1e3), () => {
			e = !0, t !== void 0 && window.clearTimeout(t);
		};
	}, [k, i]);
	let ee = async () => {
		if (y === "pre_registered" && !m.trim()) {
			s("A protected client ID credential name is required.");
			return;
		}
		if (y === "client_metadata" && !x.trim()) {
			s("A client metadata document URL is required.");
			return;
		}
		let t;
		try {
			t = D.trim() ? JSON.parse(D) : void 0;
		} catch {
			s("The authorization metadata override must be valid JSON.");
			return;
		}
		let r = y === "pre_registered" ? {
			type: "pre_registered",
			client_id_credential: m.trim(),
			client_secret_credential: _.trim() || void 0
		} : y === "client_metadata" ? {
			type: "client_metadata",
			url: x.trim()
		} : {
			type: "dynamic",
			client_name: C.trim() || void 0
		};
		l(!0), s(null);
		try {
			let i = await n.configureMcpOAuth(e, {
				registration: r,
				scopes: T.split("\n").map((e) => e.trim()).filter(Boolean),
				authorization_metadata: t
			});
			a(i.status), d(i.authorization_url ?? null), p(!1), h(""), v("");
		} catch {
			s("OAuth configuration was rejected. Check the protected credential names.");
		} finally {
			l(!1);
		}
	}, A = async () => {
		l(!0), s(null), d(null);
		try {
			let t = await n.authenticateMcpOAuth(e);
			a(t.status), d(t.authorization_url);
		} catch {
			a("failed"), s("OAuth authentication could not start.");
		} finally {
			l(!1);
		}
	}, te = async () => {
		l(!0), s(null), d(null);
		try {
			let t = await n.logoutMcpOAuth(e);
			a(t.status);
		} catch {
			s("OAuth logout could not complete.");
		} finally {
			l(!1);
		}
	};
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-3 p-4 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex items-center justify-between gap-3",
				children: [/* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("div", {
					className: "text-medium text-basic-primary",
					children: "OAuth"
				}), /* @__PURE__ */ X("div", {
					className: "text-small text-basic-muted",
					children: "Authorization Code with PKCE. Tokens and callback state stay in protected local storage."
				})] }), /* @__PURE__ */ X("span", {
					className: "text-small text-basic-muted",
					children: Vh(i)
				})]
			}),
			i === "needs_configuration" || f ? /* @__PURE__ */ Z(Y, { children: [
				/* @__PURE__ */ Z("div", {
					className: "grid md:grid-cols-2 gap-3",
					children: [
						/* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ X(lf, {
								label: "Client registration",
								required: !0
							}), /* @__PURE__ */ Z("select", {
								className: "h-10 rounded-md border border-border-subtle bg-elevation-surface px-3 text-small text-basic-primary",
								value: y,
								onChange: (e) => b(e.target.value),
								children: [
									/* @__PURE__ */ X("option", {
										value: "pre_registered",
										children: "Pre-registered client"
									}),
									/* @__PURE__ */ X("option", {
										value: "client_metadata",
										children: "Client metadata document (SEP-991)"
									}),
									/* @__PURE__ */ X("option", {
										value: "dynamic",
										children: "Dynamic client registration"
									})
								]
							})]
						}),
						y === "pre_registered" ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ X(lf, {
								label: "Client ID credential",
								required: !0
							}), /* @__PURE__ */ X($, {
								inputSize: r ? Q.Large : Q.Medium,
								value: m,
								placeholder: "SLACK_MCP_CLIENT_ID",
								onChange: (e) => h(e.target.value)
							})]
						}), /* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ X(lf, {
								label: "Client secret credential",
								hint: "Optional for public clients."
							}), /* @__PURE__ */ X($, {
								inputSize: r ? Q.Large : Q.Medium,
								value: _,
								placeholder: "SLACK_MCP_CLIENT_SECRET",
								onChange: (e) => v(e.target.value)
							})]
						})] }) : null,
						y === "client_metadata" ? /* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ X(lf, {
								label: "Client metadata URL",
								required: !0
							}), /* @__PURE__ */ X($, {
								inputSize: r ? Q.Large : Q.Medium,
								value: x,
								placeholder: "https://nac.example.com/.well-known/oauth-client.json",
								onChange: (e) => S(e.target.value)
							})]
						}) : null,
						y === "dynamic" ? /* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ X(lf, {
								label: "Client name",
								hint: "Sent to the authorization server."
							}), /* @__PURE__ */ X($, {
								inputSize: r ? Q.Large : Q.Medium,
								value: C,
								onChange: (e) => w(e.target.value)
							})]
						}) : null
					]
				}),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ X(lf, {
						label: "Scopes",
						hint: "One scope per line."
					}), /* @__PURE__ */ X(tu, {
						textAreaClassName: "min-h-[64px] font-mono text-small",
						value: T,
						onChange: (e) => E(e.target.value)
					})]
				}),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ X(lf, {
						label: "Authorization metadata override",
						hint: "Optional JSON for servers without discovery metadata."
					}), /* @__PURE__ */ X(tu, {
						textAreaClassName: "min-h-[72px] font-mono text-small",
						value: D,
						placeholder: y === "client_metadata" ? "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\",\"client_id_metadata_document_supported\":true}" : "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\"}",
						onChange: (e) => O(e.target.value)
					})]
				}),
				/* @__PURE__ */ X("div", {
					className: "flex justify-end",
					children: /* @__PURE__ */ X(z, {
						size: U.Medium,
						variant: B.Secondary,
						content: g.Text,
						disabled: c,
						onClick: () => void ee(),
						children: "Configure OAuth"
					})
				})
			] }) : null,
			i && i !== "needs_configuration" && i !== "connecting" && !f ? /* @__PURE__ */ X("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ X(z, {
					size: U.Medium,
					variant: B.Ghost,
					content: g.Text,
					disabled: c,
					onClick: () => p(!0),
					children: "Edit OAuth configuration"
				})
			}) : null,
			i === "needs_authorization" || i === "failed" ? /* @__PURE__ */ X("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ X(z, {
					size: U.Medium,
					variant: B.Secondary,
					content: g.Text,
					disabled: c,
					onClick: () => void A(),
					children: "Authenticate"
				})
			}) : null,
			u ? /* @__PURE__ */ X("a", {
				className: "text-small text-accent-primary underline self-end",
				href: u,
				target: "_blank",
				rel: "noreferrer",
				children: "Continue OAuth authorization"
			}) : null,
			i === "connected" ? /* @__PURE__ */ Z("div", {
				className: "text-small text-basic-muted",
				children: [
					"Log out deletes the tokens NAC saved on this computer, and sessions stop sending requests to this server until you authenticate again. It does not revoke NAC's access at the provider.",
					" ",
					Uh(t) ? /* @__PURE__ */ X("a", {
						className: "text-accent-primary underline",
						href: Hh,
						target: "_blank",
						rel: "noreferrer",
						children: "Revoke it in Slack"
					}) : "To revoke it, remove NAC's access in the provider's connected-app settings."
				]
			}) : null,
			i === "connected" || i === "connecting" ? /* @__PURE__ */ X("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ X(z, {
					size: U.Medium,
					variant: B.SecondaryDestructive,
					content: g.Text,
					disabled: c,
					onClick: () => void te(),
					children: i === "connected" ? "Log out" : "Cancel authorization"
				})
			}) : null,
			o ? /* @__PURE__ */ X("div", {
				className: "text-small text-error-primary",
				children: o
			}) : null
		]
	});
}
// src/app/lib/mcpKvRows.ts
function Gh(e) {
	return Object.entries(e).map(([e, t]) => ({
		key: e,
		value: "",
		storedKey: e,
		placeholder: t
	}));
}
function Kh(e) {
	let t = {};
	for (let n of e) {
		let e = n.key.trim();
		e && (n.value ? t[e] = n.value : n.storedKey && (t[e] = null));
	}
	return t;
}
function qh(e) {
	let t = {};
	for (let [n, r] of Object.entries(e)) r !== null && (t[n] = r);
	return t;
}
// src/app/components/modals/MCPServersModal/McpServerForm.tsx
var Jh = [{
	id: "streamable_http",
	label: "Streamable HTTP"
}, {
	id: "stdio",
	label: "Stdio"
}], Yh = [
	{
		id: "legacy",
		label: "Legacy",
		hint: "Use the 2025-11-25 initialize handshake."
	},
	{
		id: "auto",
		label: "Auto",
		hint: "Try 2026-07-28 discovery, then safely fall back to legacy."
	},
	{
		id: "current",
		label: "Current",
		hint: "Require 2026-07-28 stateless discovery."
	}
];
function Xh(e) {
	return e.split("\n").map((e) => e.trim()).filter(Boolean);
}
function Zh(e) {
	return e === "stdio" || e === "streamable_http" ? e : "streamable_http";
}
function Qh(e) {
	return e.trim() ? Number(e) : null;
}
function $h({ record: e, template: t, libraryEntry: n, onBack: r, onClose: i, onSaved: a, onDeleted: o, setFooter: s }) {
	let c = N(), l = nr(), u = xr(), d = b(), f = jr(), p = T(), m = wn(), h = Yn(), [_, v] = J(e?.name ?? t?.name ?? ""), [y, x] = J(e?.enabled ?? !0), [S, C] = J(e?.required ?? !1), [w, E] = J(e?.protocol ?? "legacy"), [D, O] = J(() => Zh(e?.transport ?? t?.transport)), [k, ee] = J(e?.url ?? t?.url ?? ""), [A, te] = J(e?.command ?? ""), [j, ne] = J(() => Lh(e?.args)), [re, ie] = J(e?.cwd ?? ""), [ae, oe] = J(e?.env_vars.join("\n") ?? ""), [se, ce] = J(e?.startup_timeout_ms?.toString() ?? ""), [M, le] = J(e?.catalog_timeout_ms?.toString() ?? ""), [ue, de] = J(e?.execution_timeout_ms?.toString() ?? ""), [fe, pe] = J(() => e ? Gh(e.headers) : t?.auth_header ? [{
		key: t.auth_header,
		value: "",
		placeholder: t.auth_hint ?? void 0
	}] : []), [P, me] = J(e ? Gh(e.env) : []), [F, he] = J(() => Object.entries(e?.env_headers ?? {}).map(([e, t]) => ({
		key: e,
		value: t
	}))), [ge, _e] = J(e?.bearer_token_env_var ?? ""), [L, ve] = J(e?.header_helper?.command ?? ""), [ye, be] = J(() => Lh(e?.header_helper?.args)), [xe, Se] = J(e?.header_helper?.cwd ?? ""), [Ce, we] = J(() => e?.header_helper ? Gh(e.header_helper.env ?? {}) : []), [Te, Ee] = J(e?.header_helper?.env_vars?.join("\n") ?? ""), [De, Oe] = J(e?.header_helper?.timeout_ms?.toString() ?? ""), [ke, Ae] = J(null), je = m.data?.servers.find((t) => t.name === e?.name), Me = u.isPending || d.isPending || f.isPending || p.isPending || h.isPending, Ne = () => _.trim() ? D === "streamable_http" && !k.trim() ? "A URL is required." : D === "stdio" && !A.trim() ? "A command is required." : null : "A name is required.", Pe = async () => {
		let n = Ne();
		if (n) {
			l.error(n);
			return;
		}
		let r = Kh(fe), i = Kh(P), o = L.trim() ? {
			command: L.trim(),
			args: Rh(ye),
			cwd: xe.trim() || null,
			env: Kh(Ce),
			env_vars: Xh(Te),
			timeout_ms: Qh(De)
		} : null;
		try {
			e ? (a((await d.mutateAsync({
				serverName: e.name,
				payload: {
					name: _.trim(),
					enabled: y,
					required: S,
					startup_timeout_ms: Qh(se),
					catalog_timeout_ms: Qh(M),
					execution_timeout_ms: Qh(ue),
					protocol: w,
					transport: D,
					command: D === "stdio" ? A.trim() : null,
					args: D === "stdio" ? Rh(j) : [],
					env: D === "stdio" ? i : {},
					env_vars: D === "stdio" ? Xh(ae) : [],
					cwd: D === "stdio" && re.trim() || null,
					url: D === "streamable_http" ? k.trim() : null,
					headers: D === "streamable_http" ? r : {},
					env_headers: D === "streamable_http" ? qh(Kh(F)) : {},
					bearer_token_env_var: D === "streamable_http" && ge.trim() || null,
					header_helper: D === "streamable_http" ? o : null
				}
			})).name), l.success("MCP server updated.")) : (a((await u.mutateAsync({
				name: _.trim(),
				enabled: y,
				required: S,
				startup_timeout_ms: Qh(se),
				catalog_timeout_ms: Qh(M),
				execution_timeout_ms: Qh(ue),
				protocol: w,
				transport: D,
				command: D === "stdio" ? A.trim() : null,
				args: D === "stdio" ? Rh(j) : [],
				env: D === "stdio" ? qh(i) : {},
				env_vars: D === "stdio" ? Xh(ae) : [],
				cwd: D === "stdio" && re.trim() || null,
				url: D === "streamable_http" ? k.trim() : null,
				headers: D === "streamable_http" ? qh(r) : {},
				env_headers: D === "streamable_http" ? qh(Kh(F)) : {},
				bearer_token_env_var: D === "streamable_http" && ge.trim() || null,
				header_helper: D === "streamable_http" && o ? {
					...o,
					env: qh(o.env)
				} : null,
				library_id: t?.id ?? null
			})).name), l.success("MCP server saved."));
		} catch (e) {
			l.error(`Save failed: ${Vt(Ud(e))}`);
		}
	}, Fe = async () => {
		if (e) try {
			await f.mutateAsync(e.name), o(), l.success("MCP server deleted.");
		} catch (e) {
			l.error(`Delete failed: ${Vt(Ud(e))}`);
		}
	}, Ie = async (t) => {
		if (e) try {
			let n = await h.mutateAsync({
				serverName: e.name,
				action: t
			});
			n.state === "failed" ? l.error(n.error ?? "MCP runtime operation failed.") : l.success(`MCP server is ${n.state}.`);
		} catch (e) {
			l.error(`Runtime operation failed: ${Vt(Ud(e))}`);
		}
	}, Le = async () => {
		let t = D === "streamable_http" && !k.trim() ? "A URL is required to test." : D === "stdio" && !A.trim() ? "A command is required to test." : null;
		if (t) l.error(t);
		else {
			Ae(null);
			try {
				let t = await p.mutateAsync({
					stored_name: e?.name ?? null,
					name: _.trim() || null,
					transport: D,
					command: D === "stdio" ? A.trim() : null,
					args: D === "stdio" ? Rh(j) : [],
					env: D === "stdio" ? Kh(P) : {},
					env_vars: D === "stdio" ? Xh(ae) : [],
					cwd: D === "stdio" && re.trim() || null,
					url: D === "streamable_http" ? k.trim() : null,
					headers: D === "streamable_http" ? Kh(fe) : {},
					env_headers: D === "streamable_http" ? qh(Kh(F)) : {},
					bearer_token_env_var: D === "streamable_http" && ge.trim() || null,
					header_helper: D === "streamable_http" && L.trim() ? {
						command: L.trim(),
						args: Rh(ye),
						cwd: xe.trim() || null,
						env: Kh(Ce),
						env_vars: Xh(Te),
						timeout_ms: Qh(De)
					} : null,
					startup_timeout_ms: Qh(se),
					catalog_timeout_ms: Qh(M),
					execution_timeout_ms: Qh(ue),
					protocol: w
				});
				if (!t.connected) {
					l.error(`Test failed: ${t.error ?? "connection failed"}`);
					return;
				}
				Ae(t.tools), l.success(`Connection succeeded: ${t.tools.length} tool${t.tools.length === 1 ? "" : "s"} found.`);
			} catch (e) {
				l.error(`Test failed: ${Vt(Ud(e))}`);
			}
		}
	}, Re = q(Pe), ze = q(Fe), Be = q(i);
	return pi(() => {
		Re.current = Pe, ze.current = Fe, Be.current = i;
	}), pi(() => (s(/* @__PURE__ */ Z(Y, { children: [
		e ? /* @__PURE__ */ X(Nh, {
			isMobile: c,
			variant: B.SecondaryDestructive,
			content: g.Icon,
			className: "mr-auto",
			ariaLabel: "Delete server",
			disabled: Me,
			onClick: () => void ze.current(),
			children: /* @__PURE__ */ X(R, { iconName: H.Trash })
		}) : null,
		/* @__PURE__ */ X(Nh, {
			isMobile: c,
			variant: B.Tertiary,
			onClick: () => Be.current(),
			children: "Cancel"
		}),
		/* @__PURE__ */ X(Nh, {
			isMobile: c,
			variant: B.Primary,
			disabled: Me,
			onClick: () => void Re.current(),
			children: "Save"
		})
	] })), () => s(null)), [
		c,
		Me,
		e,
		s
	]), /* @__PURE__ */ Z("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: [r ? /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-1 shrink-0 border-b border-muted px-2 py-2",
			children: [/* @__PURE__ */ X(z, {
				size: U.Medium,
				variant: B.Ghost,
				content: g.Icon,
				"aria-label": "Back to library",
				onClick: r,
				children: /* @__PURE__ */ X(R, { iconName: H.Left })
			}), /* @__PURE__ */ X("span", {
				className: "text-medium text-basic-primary truncate",
				children: _.trim() || "Custom server"
			})]
		}) : null, /* @__PURE__ */ Z("div", {
			className: I("flex-1 overflow-auto p-4 flex flex-col gap-4 [&>*]:shrink-0", c && "pb-[88px]"),
			children: [
				n ? /* @__PURE__ */ X(Mh, { entry: n }) : null,
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col md:flex-row gap-4",
					children: [/* @__PURE__ */ Z("div", {
						className: "flex flex-col gap-1 flex-grow",
						children: [/* @__PURE__ */ X(lf, {
							label: "Name",
							required: !0
						}), /* @__PURE__ */ X($, {
							inputSize: c ? Q.Large : Q.Medium,
							placeholder: "my_server",
							value: _,
							onChange: (e) => v(e.target.value)
						})]
					}), /* @__PURE__ */ X("div", {
						className: "md:pt-6",
						children: /* @__PURE__ */ Z("div", {
							className: "flex gap-4 items-center px-4 py-2 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
							children: [
								/* @__PURE__ */ X(lf, {
									label: "Enabled",
									hint: "Disabled servers are kept but not connected when a session starts."
								}),
								/* @__PURE__ */ X(pd, {
									checked: y,
									size: c ? ld.Large : ld.Medium,
									onChange: x
								}),
								/* @__PURE__ */ X(lf, {
									label: "Required",
									hint: "Fail session admission when this enabled server cannot start."
								}),
								/* @__PURE__ */ X(pd, {
									checked: S,
									size: c ? ld.Large : ld.Medium,
									onChange: C
								})
							]
						})
					})]
				}),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-4 p-4 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
					children: [
						/* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ X(lf, { label: "Transport" }), /* @__PURE__ */ X("div", {
								className: "flex gap-2",
								children: Jh.map((e) => /* @__PURE__ */ X(z, {
									size: c ? U.Medium : U.Small,
									variant: D === e.id ? B.Primary : B.Secondary,
									content: g.Text,
									"aria-pressed": D === e.id,
									onClick: () => O(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						/* @__PURE__ */ Z("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ X(lf, {
								label: "Protocol",
								hint: Yh.find((e) => e.id === w)?.hint
							}), /* @__PURE__ */ X("div", {
								className: "flex flex-wrap gap-2",
								children: Yh.map((e) => /* @__PURE__ */ X(z, {
									size: c ? U.Medium : U.Small,
									variant: w === e.id ? B.Primary : B.Secondary,
									content: g.Text,
									"aria-pressed": w === e.id,
									onClick: () => E(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						D === "streamable_http" ? /* @__PURE__ */ Z(Y, { children: [
							/* @__PURE__ */ Z("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ X(lf, {
									label: "URL",
									required: !0
								}), /* @__PURE__ */ X($, {
									inputSize: c ? Q.Large : Q.Medium,
									placeholder: "https://example.com/mcp",
									value: k,
									onChange: (e) => ee(e.target.value)
								})]
							}),
							/* @__PURE__ */ X(Bh, {
								label: "Headers",
								hint: "Sent with every request. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "Authorization",
								rows: fe,
								onChange: pe
							}),
							/* @__PURE__ */ Z("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ X(lf, {
									label: "Bearer token environment variable",
									hint: "The variable value is sent as a Bearer token without persisting it."
								}), /* @__PURE__ */ X($, {
									inputSize: c ? Q.Large : Q.Medium,
									placeholder: "MCP_TOKEN",
									value: ge,
									onChange: (e) => _e(e.target.value)
								})]
							}),
							/* @__PURE__ */ X(Bh, {
								label: "Environment-backed headers",
								hint: "Map each HTTP header name to the environment variable that supplies its value.",
								keyPlaceholder: "X-API-Key",
								rows: F,
								onChange: he
							}),
							/* @__PURE__ */ Z("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ X(lf, {
									label: "Header helper command",
									hint: "Optional bounded command that prints a JSON object of same-origin request headers."
								}), /* @__PURE__ */ X($, {
									inputSize: c ? Q.Large : Q.Medium,
									placeholder: "./refresh-mcp-headers",
									value: L,
									onChange: (e) => ve(e.target.value)
								})]
							}),
							L.trim() ? /* @__PURE__ */ Z(Y, { children: [
								/* @__PURE__ */ X(zh, {
									label: "Header helper arguments",
									itemLabel: "Header helper argument",
									rows: ye,
									onChange: be
								}),
								/* @__PURE__ */ Z("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ X(lf, { label: "Header helper working directory" }), /* @__PURE__ */ X($, {
										inputSize: c ? Q.Large : Q.Medium,
										value: xe,
										onChange: (e) => Se(e.target.value)
									})]
								}),
								/* @__PURE__ */ X(Bh, {
									label: "Header helper environment",
									hint: "Stored literals remain write-only.",
									keyPlaceholder: "TOKEN",
									rows: Ce,
									onChange: we
								}),
								/* @__PURE__ */ Z("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ X(lf, {
										label: "Header helper forwarded environment",
										hint: "One variable name per line."
									}), /* @__PURE__ */ X(tu, {
										textAreaClassName: "min-h-[64px] font-mono",
										value: Te,
										onChange: (e) => Ee(e.target.value)
									})]
								}),
								/* @__PURE__ */ Z("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ X(lf, { label: "Header helper timeout (ms)" }), /* @__PURE__ */ X($, {
										inputSize: c ? Q.Large : Q.Medium,
										type: "number",
										min: 100,
										max: 6e5,
										value: De,
										onChange: (e) => Oe(e.target.value)
									})]
								})
							] }) : null
						] }) : /* @__PURE__ */ Z(Y, { children: [
							/* @__PURE__ */ Z("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ X(lf, {
									label: "Command",
									required: !0
								}), /* @__PURE__ */ X($, {
									inputSize: c ? Q.Large : Q.Medium,
									placeholder: "npx",
									value: A,
									onChange: (e) => te(e.target.value)
								})]
							}),
							/* @__PURE__ */ X(zh, {
								label: "Arguments",
								itemLabel: "Argument",
								rows: j,
								onChange: ne
							}),
							/* @__PURE__ */ X(Bh, {
								label: "Environment",
								hint: "Set for the server process. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "API_KEY",
								rows: P,
								onChange: me
							}),
							/* @__PURE__ */ Z("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ X(lf, {
									label: "Working directory",
									hint: "Relative paths resolve from the workspace."
								}), /* @__PURE__ */ X($, {
									inputSize: c ? Q.Large : Q.Medium,
									placeholder: "packages/server",
									value: re,
									onChange: (e) => ie(e.target.value)
								})]
							}),
							/* @__PURE__ */ Z("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ X(lf, {
									label: "Forward environment variables",
									hint: "One existing host variable name per line."
								}), /* @__PURE__ */ X(tu, {
									textAreaClassName: "min-h-[64px] font-mono",
									value: ae,
									onChange: (e) => oe(e.target.value)
								})]
							})
						] }),
						/* @__PURE__ */ X("div", {
							className: "grid grid-cols-1 md:grid-cols-3 gap-3",
							children: [
								[
									"Startup timeout (ms)",
									se,
									ce
								],
								[
									"Catalog timeout (ms)",
									M,
									le
								],
								[
									"Execution timeout (ms)",
									ue,
									de
								]
							].map(([e, t, n]) => /* @__PURE__ */ Z("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ X(lf, { label: e }), /* @__PURE__ */ X($, {
									inputSize: c ? Q.Large : Q.Medium,
									type: "number",
									min: 100,
									max: 6e5,
									value: t,
									onChange: (e) => n(e.target.value)
								})]
							}, e))
						}),
						e ? /* @__PURE__ */ Z("div", {
							className: "flex flex-wrap items-center gap-2",
							children: [/* @__PURE__ */ Z("span", {
								className: "text-small text-basic-muted",
								children: [je?.sessions_blocked ? "Disconnected. Sessions won't use this server until you connect it." : `Runtime: ${je?.state ?? "disconnected"}`, je?.error ? ` — ${je.error}` : ""]
							}), [
								"connect",
								"disconnect",
								"reload"
							].map((e) => /* @__PURE__ */ X(z, {
								size: U.Small,
								variant: B.Secondary,
								disabled: Me,
								onClick: () => void Ie(e),
								children: e[0].toUpperCase() + e.slice(1)
							}, e))]
						}) : null,
						/* @__PURE__ */ Z("div", {
							className: "flex items-center gap-2 justify-end",
							children: [/* @__PURE__ */ Z(z, {
								size: U.Medium,
								variant: B.Secondary,
								disabled: Me,
								onClick: () => void Le(),
								content: g.IconLeft,
								children: [/* @__PURE__ */ X(R, { iconName: H.Bolt }), p.isPending ? "Testing…" : "Test connection"]
							}), ke ? /* @__PURE__ */ Z("span", {
								className: "text-small text-basic-muted",
								children: [
									ke.length,
									" tool",
									ke.length === 1 ? "" : "s",
									" found"
								]
							}) : null]
						})
					]
				}),
				e && D === "streamable_http" ? /* @__PURE__ */ X(Wh, {
					serverName: e.name,
					endpoint: e.url ?? void 0
				}) : null,
				ke && ke.length ? /* @__PURE__ */ X("div", {
					className: "flex flex-col gap-1",
					children: ke.map((e) => /* @__PURE__ */ Z("div", {
						className: "flex items-baseline gap-2 min-w-0",
						children: [/* @__PURE__ */ X("span", {
							className: "code code-small text-basic-primary shrink-0",
							children: e.name
						}), e.description ? /* @__PURE__ */ X("span", {
							className: "text-small text-basic-muted truncate",
							children: e.description
						}) : null]
					}, e.name))
				}) : null
			]
		})]
	});
}
// src/app/components/modals/MCPServersModal/McpServersLoadError.tsx
function eg({ error: e, retrying: t, onRetry: n }) {
	let r = e instanceof Error ? e.message : "The MCP configuration could not be read.";
	return /* @__PURE__ */ Z("div", {
		className: "flex h-full min-h-0 flex-col items-start justify-center gap-3 overflow-auto p-6",
		children: [
			/* @__PURE__ */ X("div", {
				className: "label-small text-error-primary",
				children: "MCP servers could not be loaded."
			}),
			/* @__PURE__ */ X("p", {
				className: "max-w-full whitespace-pre-wrap break-words text-micro text-basic-secondary",
				children: r
			}),
			/* @__PURE__ */ X(z, {
				variant: B.Secondary,
				size: U.Small,
				content: g.Text,
				loading: t,
				onClick: n,
				children: "Try again"
			})
		]
	});
}
// src/app/components/modals/MCPServersModal/McpServersMobile.tsx
function tg({ open: e, onClose: t }) {
	let { data: n } = lr(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = yn(), l = r?.servers ?? [], [u, d] = J(!1), [f, p] = J(null), [m, h] = J(null), [g, _] = J(null), v = l.find((e) => e.name === m) ?? null, y = f?.template ?? null, b = y ?? (v ? n?.entries.find((e) => e.id === v.library_id || e.name === v.name) ?? null : null), x = () => {
		p(null), h(null), d(!1);
	}, S = () => {
		p(null), h(null);
	};
	return /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ X(Xn, {
			open: e,
			onClose: t,
			title: "MCP servers",
			children: a ? /* @__PURE__ */ X(eg, {
				error: i,
				retrying: o,
				onRetry: () => {
					c();
				}
			}) : /* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-1 [&>*]:shrink-0",
				children: [
					/* @__PURE__ */ Z(Ui, {
						size: Bi.Large,
						onClick: () => d(!0),
						children: [
							/* @__PURE__ */ X(R, { iconName: H.Add }),
							/* @__PURE__ */ X("span", {
								className: "text-left flex-grow truncate",
								children: "Add server"
							}),
							/* @__PURE__ */ X(R, {
								iconName: H.Right,
								className: "shrink-0"
							})
						]
					}),
					l.length ? /* @__PURE__ */ X(nd, {}) : null,
					l.map((e) => /* @__PURE__ */ Z(Ui, {
						size: Bi.Large,
						onClick: () => h(e.name),
						children: [/* @__PURE__ */ X("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						}), /* @__PURE__ */ X(R, {
							iconName: H.Right,
							className: "shrink-0"
						})]
					}, e.name)),
					s ? /* @__PURE__ */ Z("div", {
						className: "flex items-center gap-2 px-2 py-1",
						children: [/* @__PURE__ */ X(ut, { size: bt.XSmall }), /* @__PURE__ */ X("span", {
							className: "text-micro text-basic-muted",
							children: "Loading…"
						})]
					}) : null
				]
			})
		}),
		/* @__PURE__ */ X(Xn, {
			open: u,
			onClose: () => d(!1),
			title: "Add server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			children: /* @__PURE__ */ X(Ph, {
				onPick: (e) => p({ template: e }),
				onCustom: () => p({ template: null })
			})
		}),
		/* @__PURE__ */ X(Xn, {
			open: f !== null || m !== null,
			onClose: S,
			title: v?.name ?? y?.name ?? "Custom server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			footer: g,
			children: /* @__PURE__ */ X($h, {
				record: v,
				template: y,
				libraryEntry: b,
				onClose: S,
				onSaved: x,
				onDeleted: x,
				setFooter: _
			}, v?.name ?? y?.id ?? "custom")
		})
	] });
}
// src/app/components/modals/MCPServersModal/McpServersModal.tsx
var ng = "__new__";
function rg({ open: e, onClose: t }) {
	let n = cp(e), r = N();
	return n ? X(r ? tg : ig, {
		open: e,
		onClose: t
	}) : null;
}
function ig({ open: e, onClose: t }) {
	let { data: n } = lr(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = yn(), l = K(() => r?.servers ?? [], [r]), [u, d] = J(null), [f, p] = J(null), [m, h] = J(!1), [g, _] = J(null), v = u ?? l.at(-1)?.name ?? ng, y = l.find((e) => e.name === v) ?? null, b = v === ng, x = (e) => {
		d(e), p(null), h(!1);
	}, S = f ?? (y ? n?.entries.find((e) => e.id === y.library_id || e.name === y.name) ?? null : null);
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: t,
		title: "MCP servers",
		size: Tn.Large,
		flush: !0,
		className: "md:h-[740px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: g,
		children: a ? /* @__PURE__ */ X(eg, {
			error: i,
			retrying: o,
			onRetry: () => {
				c();
			}
		}) : /* @__PURE__ */ Z("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ X(Ch, {
				draftLabel: "Add server",
				draftSelected: b,
				onSelectDraft: () => x(ng),
				entries: l.map((e) => ({
					id: e.name,
					name: e.name
				})),
				selectedId: v,
				onSelect: x,
				isLoading: s
			}), b && !f && !m ? /* @__PURE__ */ X(Ph, {
				onPick: (e) => p(e),
				onCustom: () => h(!0),
				onClose: t,
				setFooter: _
			}) : /* @__PURE__ */ X($h, {
				record: y,
				template: f,
				libraryEntry: S,
				onBack: () => {
					d(ng), p(null), h(!1);
				},
				onClose: t,
				onSaved: x,
				onDeleted: () => x(ng),
				setFooter: _
			}, y ? y.name : f?.id ?? "custom")]
		})
	});
}
// src/app/components/modals/SshConfigsModal.tsx
var ag = "__new__";
function og(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function sg({ open: e, onClose: t }) {
	return cp(e) ? /* @__PURE__ */ X(cg, {
		open: e,
		onClose: t
	}) : null;
}
function cg({ open: e, onClose: t }) {
	let n = N(), { data: r, isLoading: i } = Vr(), a = K(() => r?.configurations ?? [], [r]), [o, s] = J(null), [c, l] = J(null), u = o ?? a.at(-1)?.config_id ?? ag, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: t,
		title: "SSH configs",
		size: Tn.Large,
		flush: !0,
		className: "max-w-[780px] md:h-[480px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: c,
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ X(Ch, {
				draftLabel: "Create New",
				draftSelected: u === ag,
				onSelectDraft: () => s(ag),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: s,
				isLoading: i
			}), /* @__PURE__ */ X(lg, {
				record: d,
				defaultName: og(a),
				onClose: t,
				onSaved: s,
				onDeleted: () => s(ag),
				setFooter: l,
				isMobile: n
			}, u)]
		})
	});
}
function lg({ record: e, defaultName: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: o }) {
	let s = nr(), c = Wn(), l = zn(), u = mn(), d = at(), [f, p] = J(e?.name ?? t), [m, h] = J(e?.ssh_host ?? ""), [_, v] = J(e?.ssh_port ? String(e.ssh_port) : ""), [y, b] = J(e?.ssh_identity_file ?? ""), x = c.isPending || l.isPending || u.isPending || d.isPending, S = async () => {
		let t = f.trim(), n = m.trim();
		if (!t || !n) {
			s.error("Name and SSH host are required.");
			return;
		}
		let i = _.trim() ? Number(_.trim()) : null;
		if (_.trim() && (!Number.isInteger(i) || (i ?? 0) < 1 || (i ?? 0) > 65535)) s.error("Port must be an integer between 1 and 65535.");
		else try {
			e ? (await l.mutateAsync({
				configId: e.config_id,
				payload: {
					name: t,
					ssh_host: n,
					ssh_port: i,
					ssh_identity_file: y.trim() || null
				}
			}), s.success("SSH config updated.")) : (r((await c.mutateAsync({
				name: t,
				ssh_host: n,
				ssh_port: i,
				ssh_identity_file: y.trim() || null
			})).config_id), s.success("SSH config saved."));
		} catch (e) {
			s.error(`Save failed: ${Vt(Ud(e))}`);
		}
	}, C = async () => {
		if (e) try {
			await u.mutateAsync(e.config_id), i(), s.success("SSH config deleted.");
		} catch (e) {
			s.error(`Delete failed: ${Vt(Ud(e))}`);
		}
	}, w = async () => {
		let e = m.trim();
		if (!e) {
			s.error("An SSH host is required to test.");
			return;
		}
		let t = _.trim() ? Number(_.trim()) : null;
		await d.mutateAsync({
			ssh_host: e,
			ssh_port: t,
			ssh_identity_file: y.trim() || null
		}), s.success("SSH connection succeeded.");
	}, T = q(S), E = q(C);
	return pi(() => {
		T.current = S, E.current = C;
	}), pi(() => (a(/* @__PURE__ */ Z(Y, { children: [
		e ? o ? /* @__PURE__ */ X(Zr, {
			variant: B.SecondaryDestructive,
			content: g.Icon,
			className: "mr-auto",
			disabled: x,
			onClick: () => void E.current(),
			children: /* @__PURE__ */ X(R, { iconName: H.Trash })
		}) : /* @__PURE__ */ X(z, {
			size: U.Large,
			variant: B.SecondaryDestructive,
			content: g.Icon,
			className: "mr-auto",
			disabled: x,
			onClick: () => void E.current(),
			children: /* @__PURE__ */ X(R, { iconName: H.Trash })
		}) : null,
		o ? /* @__PURE__ */ X(Zr, {
			variant: B.Secondary,
			content: g.Text,
			onClick: n,
			children: "Cancel"
		}) : /* @__PURE__ */ X(z, {
			size: U.Large,
			variant: B.Ghost,
			onClick: n,
			children: "Cancel"
		}),
		o ? /* @__PURE__ */ X(Zr, {
			variant: B.Primary,
			content: g.Text,
			disabled: x,
			onClick: () => void T.current(),
			children: "Save"
		}) : /* @__PURE__ */ X(z, {
			size: U.Large,
			variant: B.Primary,
			disabled: x,
			onClick: () => void T.current(),
			children: "Save"
		})
	] })), () => a(null)), [
		x,
		o,
		n,
		e,
		a
	]), /* @__PURE__ */ X("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: /* @__PURE__ */ X("div", {
			className: I("flex-1 overflow-auto p-4 [&>*]:shrink-0", o && "pb-[88px]"),
			children: /* @__PURE__ */ X(Ip, {
				mode: "manage",
				connection: null,
				onConnectionChange: () => void 0,
				name: f,
				onNameChange: p,
				host: m,
				onHostChange: h,
				port: _,
				onPortChange: v,
				identityFile: y,
				onIdentityFileChange: b,
				onTest: w,
				testing: d.isPending,
				className: "bg-elevation-level-2"
			})
		})
	});
}
// src/app/components/LeftSidebar/useSidebarCommands.tsx
function ug() {
	let [e, t] = J(!1), [n, r] = J(!1), [i, a] = J(!1), { pathname: o } = Ai(), s = ji(), c = Em(), l = th(), { data: u = [] } = Zn(), { data: d } = yn(), { data: f } = Vr(), p = sr(o), m = p != null && u.some((e) => e.summary.session_id === p), h = nn(o) ?? u.find((e) => e.summary.session_id === p)?.summary.project_id ?? null, g = d?.servers.filter((e) => e.enabled).length ?? 0;
	return {
		projectId: h,
		sessionId: p,
		activeMcp: g,
		sshCount: f?.configurations.length ?? 0,
		mcpLabel: g ? `MCP servers, ${g} active` : "MCP servers",
		newSession: () => {
			h ? c.newChat(h) : (!p || m) && c.create();
		},
		newProject: () => {
			l.isManaged ? l.addRepository() : c.create();
		},
		createLabel: l.isManaged ? "Add repository" : "New Project",
		openProjects: () => s(fn.list()),
		openMcp: () => a(!0),
		openSsh: () => r(!0),
		openConfigurations: () => t(!0),
		openManaged: l.openSettings,
		modals: /* @__PURE__ */ Z(Y, { children: [
			/* @__PURE__ */ X(Dh, {
				open: e,
				onClose: () => t(!1)
			}),
			/* @__PURE__ */ X(sg, {
				open: n,
				onClose: () => r(!1)
			}),
			/* @__PURE__ */ X(rg, {
				open: i,
				onClose: () => a(!1)
			})
		] })
	};
}
// src/app/components/LeftSidebar/MobileMenu.tsx
function dg({ open: e, onClose: t }) {
	let { pathname: n } = Ai(), r = ug(), i = th(), [a, o] = J(!1), { data: s = [] } = _(), { data: c } = _t(), l = n === fn.list(), u = (e) => () => {
		t(), e();
	};
	return /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ Z(Xn, {
			open: e,
			onClose: t,
			title: "Menu",
			bodyClassName: "p-0 pb-[184px] [&>*]:shrink-0",
			children: [/* @__PURE__ */ Z("nav", {
				"aria-label": "Menu",
				className: "flex flex-col gap-1 border-b border-muted px-2 py-3",
				children: [
					/* @__PURE__ */ X(gh, {
						projectId: r.projectId,
						onUnavailable: u(r.newSession),
						className: "w-full",
						children: (e) => /* @__PURE__ */ Z(Ui, {
							size: Bi.Large,
							onClick: e,
							children: [
								/* @__PURE__ */ X(R, { iconName: H.Add }),
								/* @__PURE__ */ X("span", {
									className: "flex-grow text-left",
									children: "New Session"
								}),
								/* @__PURE__ */ X(R, { iconName: H.Right })
							]
						})
					}),
					/* @__PURE__ */ Z(Ui, {
						size: Bi.Large,
						onClick: () => o(!0),
						children: [
							/* @__PURE__ */ X(R, { iconName: H.Search }),
							/* @__PURE__ */ X("span", {
								className: "flex-grow text-left",
								children: l ? "Search Projects" : "Search Chats"
							}),
							/* @__PURE__ */ X(R, { iconName: H.Right })
						]
					}),
					/* @__PURE__ */ Z("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ Z(Ui, {
							size: Bi.Large,
							className: "!w-auto flex-1",
							onClick: u(r.openProjects),
							children: [/* @__PURE__ */ X(R, { iconName: H.Folders }), /* @__PURE__ */ X("span", {
								className: "flex-grow truncate text-left",
								children: "All projects"
							})]
						}), /* @__PURE__ */ X(z, {
							variant: B.Ghost,
							size: U.Large,
							content: g.Icon,
							"aria-label": i.isManaged ? "Add repository" : "New project",
							onClick: u(r.newProject),
							children: /* @__PURE__ */ X(R, { iconName: H.Add })
						})]
					}),
					/* @__PURE__ */ Z(Ui, {
						size: Bi.Large,
						"aria-label": r.mcpLabel,
						onClick: u(r.openMcp),
						children: [
							/* @__PURE__ */ X(R, { iconName: H.Toolbox }),
							/* @__PURE__ */ X("span", {
								className: "flex-grow text-left",
								children: "MCP"
							}),
							r.activeMcp > 0 ? /* @__PURE__ */ X(ia, {
								text: `${r.activeMcp} ACTIVE`,
								color: na.Blue,
								background: !1
							}) : null
						]
					}),
					/* @__PURE__ */ Z(Ui, {
						size: Bi.Large,
						onClick: u(r.openSsh),
						children: [
							/* @__PURE__ */ X(R, { iconName: H.Globe }),
							/* @__PURE__ */ X("span", {
								className: "flex-grow text-left",
								children: "SSH"
							}),
							r.sshCount > 0 ? /* @__PURE__ */ X(ia, {
								text: String(r.sshCount),
								color: na.Gray,
								background: !1
							}) : null
						]
					}),
					/* @__PURE__ */ X(nd, {}),
					/* @__PURE__ */ Z(Ui, {
						size: Bi.Large,
						onClick: u(r.openConfigurations),
						children: [
							/* @__PURE__ */ X(R, { iconName: H.Gear }),
							/* @__PURE__ */ X("span", {
								className: "flex-grow text-left",
								children: "Configurations"
							}),
							/* @__PURE__ */ X(R, { iconName: H.Right })
						]
					}),
					/* @__PURE__ */ Z(Ui, {
						size: Bi.Large,
						onClick: u(r.openManaged),
						children: [
							/* @__PURE__ */ X(R, { iconName: H.Controls }),
							/* @__PURE__ */ X("span", {
								className: "flex-grow text-left",
								children: "Manage Host"
							}),
							/* @__PURE__ */ X(R, { iconName: H.Right })
						]
					})
				]
			}), l ? /* @__PURE__ */ X("div", {
				className: "px-2 py-4",
				children: /* @__PURE__ */ X($m, {
					sessions: s,
					inset: !0
				})
			}) : /* @__PURE__ */ X(yh, {
				projects: c?.projects ?? [],
				sessions: s,
				query: "",
				activeSessionId: r.sessionId,
				activeProjectId: r.projectId,
				mobile: !0,
				onNavigate: t
			})]
		}),
		/* @__PURE__ */ X(oh, {
			open: a,
			onClose: () => o(!1),
			onNavigate: t,
			kind: l ? "projects" : "chats",
			activeSessionId: r.sessionId,
			activeProjectId: r.projectId
		}),
		r.modals
	] });
}
// src/app/components/MobileHeader.tsx
function fg() {
	let { openSidePanelList: e } = V().stores.sessionLayoutStore, t = ji(), { pathname: n } = Ai(), [r, i] = J(!1), a = sr(n);
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ Z("header", {
		className: "fade-from-top fixed inset-x-0 top-0 z-10 flex items-center gap-4 p-2",
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex min-w-0 flex-1 items-center gap-4",
				children: [/* @__PURE__ */ X(Zr, {
					content: g.Icon,
					className: "shrink-0",
					"aria-label": "All projects",
					onClick: () => t(fn.list()),
					children: /* @__PURE__ */ X(mu, {
						markOnly: !0,
						height: 24,
						className: "icon"
					})
				}), a ? /* @__PURE__ */ X(pg, { sessionId: a }) : /* @__PURE__ */ X("p", {
					className: "header-md min-w-0 flex-1 truncate text-basic-primary",
					children: "All Projects"
				})]
			}),
			a ? /* @__PURE__ */ X(Zr, {
				content: g.Icon,
				className: "shrink-0",
				"aria-label": "Open panel",
				onClick: () => e(),
				children: /* @__PURE__ */ X(R, { iconName: H.OpenMobileModal })
			}) : null,
			/* @__PURE__ */ X(Zr, {
				content: g.Icon,
				className: "shrink-0",
				"aria-label": "Open the menu",
				"aria-expanded": r,
				onClick: () => i(!0),
				children: /* @__PURE__ */ X(R, { iconName: H.MenuVertical })
			})
		]
	}), /* @__PURE__ */ X(dg, {
		open: r,
		onClose: () => i(!1)
	})] });
}
function pg({ sessionId: t }) {
	let { useRunning: n } = V().stores.runtimeStore, { useSelectedRevision: r } = V().stores.sessionLayoutStore, i = ji(), a = xd(), { data: o = null } = gn(t, { enabled: !1 }), { data: s = null } = ur(t), { data: c = [] } = _(), l = n(t), u = r(), d = e(t, u), f = o?.workspace ?? null, p = u == null ? f : d.data ?? {
		total_additions: 0,
		total_deletions: 0
	}, m = p?.total_additions ?? 0, h = p?.total_deletions ?? 0, g = f?.repo_label ?? f?.workspace_display ?? null, v = s?.lineage ?? o?.lineage ?? null, y = v ? c.find((e) => e.summary.session_id === v.parent_session_id) : void 0, b = y ? a(y.summary) : "Parent session", x = /* @__PURE__ */ X("p", {
		className: I("header-sm min-w-0 flex-1 truncate", l ? "text-shimmer-basic" : "text-btn-secondary-pressed"),
		children: a(s?.summary)
	});
	return /* @__PURE__ */ Z("div", {
		className: "flex min-w-0 flex-1 flex-col gap-1",
		children: [v ? /* @__PURE__ */ Z("div", {
			className: "flex w-full items-center gap-1",
			children: [
				/* @__PURE__ */ X(z, {
					variant: B.Tertiary,
					size: U.Medium,
					className: "min-w-0 max-w-16 shrink-0",
					"aria-label": `${b}, parent chat`,
					title: b,
					onClick: () => i(fn.session(v.parent_session_id, "delegated")),
					children: /* @__PURE__ */ X("span", {
						className: "truncate underline",
						children: b
					})
				}),
				/* @__PURE__ */ X(R, {
					iconName: H.Right,
					size: 16,
					color: "var(--color-fill-basic-tertiary)",
					className: "shrink-0"
				}),
				x
			]
		}) : /* @__PURE__ */ X("div", {
			className: "flex w-full",
			children: x
		}), g || m || h ? /* @__PURE__ */ Z("div", {
			className: "flex w-full min-w-0 items-center gap-4 overflow-clip rounded-[4px]",
			children: [g ? /* @__PURE__ */ X("span", {
				className: "label-micro min-w-0 truncate text-btn-secondary",
				children: g
			}) : null, m || h ? /* @__PURE__ */ X(ml, {
				additions: m,
				deletions: h,
				className: "shrink-0"
			}) : null]
		}) : null]
	});
}
// src/app/components/TopBar.tsx
var mg = "linear-gradient(to bottom, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))", hg = { backgroundImage: `${mg}, ${mg}` };
function gg() {
	return N() ? /* @__PURE__ */ X(fg, {}) : /* @__PURE__ */ X(_g, {});
}
function _g() {
	let { useSidebarOffset: e } = V().stores.sidebarLayoutStore, [t, n] = J(!1), [r, i] = J(!1), [a, o] = J(!1), s = Se(), { pathname: c } = Ai(), l = th(), u = e();
	return sr(c) !== null || c === fn.list() ? null : /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ Z("header", {
			className: I("fixed top-0 right-0 z-10 flex items-center justify-between py-2 shrink-0", "transition-[left] duration-300 ease-out", s ? "h-[52px] px-3" : "h-[52px] px-4"),
			style: { left: u },
			children: [
				/* @__PURE__ */ X("div", {
					className: "absolute inset-x-0 top-0 -bottom-[8px] pointer-events-none",
					style: hg
				}),
				/* @__PURE__ */ Z("div", {
					className: I("relative flex items-center shrink-0", s ? "gap-4" : "gap-8"),
					children: [u > 0 ? null : /* @__PURE__ */ X(Ci, {
						to: fn.list(),
						className: "shrink-0",
						"aria-label": "All projects",
						children: /* @__PURE__ */ X(mu, {
							height: 36,
							markOnly: s,
							className: "text-basic-primary"
						})
					}), /* @__PURE__ */ X(Wm, {})]
				}),
				/* @__PURE__ */ Z("div", {
					className: "relative flex items-center shrink-0 gap-2",
					children: [/* @__PURE__ */ X(Jm, { onOpen: () => o(!0) }), /* @__PURE__ */ X(qm, {
						onConfigurations: () => n(!0),
						onSshConfigs: () => i(!0),
						onManagedHost: l.isManaged ? l.openSettings : void 0
					})]
				})
			]
		}),
		/* @__PURE__ */ X(Dh, {
			open: t,
			onClose: () => n(!1)
		}),
		/* @__PURE__ */ X(sg, {
			open: r,
			onClose: () => i(!1)
		}),
		/* @__PURE__ */ X(rg, {
			open: a,
			onClose: () => o(!1)
		})
	] });
}
// src/app/components/AppShell.tsx
function vg() {
	return /* @__PURE__ */ Z("div", {
		className: "h-full flex flex-col bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ X(gg, {}), /* @__PURE__ */ X("main", {
			className: "flex-1 min-h-0",
			children: /* @__PURE__ */ X(Ti, {})
		})]
	});
}
// src/app/components/LeftSidebar/LeftSidebarPanel.tsx
function yg({ isOpen: e, onToggle: t, toggleKeys: n, commands: r, variant: i }) {
	let { useFilterQuery: a, setQuery: o } = V().stores.sessionFiltersStore, s = i === "projects", [c, l] = J(""), u = a(), { data: d = [] } = _(), { data: f } = _t(), { data: p } = kn(), m = p?.store_path ?? "", h = f?.projects ?? [];
	return /* @__PURE__ */ Z("div", {
		className: "flex h-full flex-col bg-elevation-ground border-r border-tertiary",
		style: { boxShadow: "var(--left-sidebar-open)" },
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex items-center justify-between pl-3 pr-2 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ X(mu, {
					height: 28,
					className: "text-basic-primary"
				}), /* @__PURE__ */ X(E, {
					title: "Hide sidebar",
					keyboardShortcuts: n,
					position: M.CenterLeft,
					sticky: !0,
					disabled: !e,
					children: /* @__PURE__ */ X(z, {
						variant: B.Ghost,
						content: g.Icon,
						"aria-label": "Hide sidebar",
						onClick: t,
						children: /* @__PURE__ */ X(R, { iconName: H.SidebarChevronLeft })
					})
				})]
			}),
			/* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-3 px-2 py-3 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ X("div", {
					className: "px-1",
					children: /* @__PURE__ */ X($, {
						inputSize: Q.Medium,
						leading: Hl.Icon,
						leadingIconName: H.Search,
						placeholder: s ? "Search Projects" : "Search Sessions",
						value: s ? u : c,
						"aria-label": s ? "Search projects" : "Search sessions",
						onChange: (e) => s ? o(e.target.value) : l(e.target.value)
					})
				}), /* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-0.5",
					children: [
						s ? /* @__PURE__ */ Z(Ui, {
							onClick: r.newProject,
							children: [/* @__PURE__ */ X(R, { iconName: H.Add }), /* @__PURE__ */ X("span", {
								className: "text-left flex-grow",
								children: r.createLabel
							})]
						}) : /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(gh, {
							projectId: r.projectId,
							onUnavailable: r.newSession,
							className: "w-full",
							children: (e) => /* @__PURE__ */ Z(Ui, {
								onClick: e,
								children: [
									/* @__PURE__ */ X(R, { iconName: H.Add }),
									/* @__PURE__ */ X("span", {
										className: "text-left flex-grow",
										children: "New Session"
									}),
									/* @__PURE__ */ X(R, { iconName: H.Right })
								]
							})
						}), /* @__PURE__ */ Z("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ Z(Ui, {
								className: "flex-1 !w-auto",
								onClick: r.openProjects,
								children: [/* @__PURE__ */ X(R, { iconName: H.Folders }), /* @__PURE__ */ X("span", {
									className: "text-left flex-grow truncate",
									children: "All projects"
								})]
							}), /* @__PURE__ */ X(E, {
								title: "Create a new project",
								position: M.CenterRight,
								sticky: !0,
								children: /* @__PURE__ */ X(z, {
									variant: B.Ghost,
									content: g.Icon,
									"aria-label": "New project",
									onClick: r.newProject,
									children: /* @__PURE__ */ X(R, { iconName: H.AddCircle })
								})
							})]
						})] }),
						/* @__PURE__ */ Z(Ui, {
							onClick: r.openMcp,
							"aria-label": r.mcpLabel,
							children: [
								/* @__PURE__ */ X(R, { iconName: H.Toolbox }),
								/* @__PURE__ */ X("span", {
									className: "text-left flex-grow",
									children: "MCP"
								}),
								r.activeMcp > 0 ? /* @__PURE__ */ X(ia, {
									text: `${r.activeMcp} ACTIVE`,
									color: na.Blue
								}) : null
							]
						}),
						/* @__PURE__ */ Z(Ui, {
							onClick: r.openSsh,
							children: [
								/* @__PURE__ */ X(R, { iconName: H.Globe }),
								/* @__PURE__ */ X("span", {
									className: "text-left flex-grow",
									children: "SSH"
								}),
								r.sshCount > 0 ? /* @__PURE__ */ X("span", {
									className: "label-small text-basic-secondary tabular-nums",
									children: r.sshCount
								}) : null
							]
						})
					]
				})]
			}),
			s ? /* @__PURE__ */ X("div", {
				className: "flex-1 min-h-0 overflow-y-auto p-4 [&>*]:shrink-0",
				children: /* @__PURE__ */ X($m, { sessions: d })
			}) : /* @__PURE__ */ X("div", {
				className: "flex-1 min-h-0 overflow-y-auto",
				children: /* @__PURE__ */ X(yh, {
					projects: h,
					sessions: d,
					query: c,
					activeSessionId: r.sessionId,
					activeProjectId: r.projectId
				})
			}),
			/* @__PURE__ */ Z("div", {
				className: "shrink-0 border-t border-muted",
				children: [
					/* @__PURE__ */ Z("div", {
						className: "px-2 py-1",
						children: [/* @__PURE__ */ Z(Ui, {
							onClick: r.openConfigurations,
							children: [/* @__PURE__ */ X(R, { iconName: H.Gear }), /* @__PURE__ */ X("span", {
								className: "text-left flex-grow",
								children: "Configurations"
							})]
						}), /* @__PURE__ */ Z(Ui, {
							onClick: r.openManaged,
							children: [/* @__PURE__ */ X(R, { iconName: H.Controls }), /* @__PURE__ */ X("span", {
								className: "text-left flex-grow",
								children: "Managed host"
							})]
						})]
					}),
					/* @__PURE__ */ X(nd, {}),
					/* @__PURE__ */ Z("div", {
						className: "flex items-center gap-2 h-10 pl-4 pr-2",
						children: [
							/* @__PURE__ */ X("span", {
								className: "label-micro text-basic-primary shrink-0",
								children: "Store:"
							}),
							/* @__PURE__ */ X("span", {
								className: "code code-micro text-basic-tertiary flex-1 min-w-0 truncate",
								title: m,
								children: m || "store path pending"
							}),
							/* @__PURE__ */ X(Yt, {
								value: m,
								size: U.Small,
								variant: B.Tertiary,
								title: "Copy the store path",
								disabled: !m,
								position: M.TopLeft,
								className: "scale-90"
							})
						]
					})
				]
			})
		]
	});
}
// src/app/components/LeftSidebar/LeftSidebarRail.tsx
function bg({ commands: e, onToggle: t, toggleKeys: n, variant: r }) {
	let i = r === "projects";
	return /* @__PURE__ */ Z("div", {
		className: "flex h-full flex-col justify-between border-r border-tertiary py-2 pr-[7px] pl-2",
		children: [/* @__PURE__ */ Z("div", {
			className: "flex flex-col items-center gap-4 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ X("button", {
					type: "button",
					className: "text-basic-primary",
					"aria-label": "All projects",
					onClick: e.openProjects,
					children: /* @__PURE__ */ X(mu, {
						markOnly: !0,
						height: 25
					})
				}),
				/* @__PURE__ */ X(xg, {
					label: "Show sidebar",
					keys: n,
					onClick: t,
					children: /* @__PURE__ */ X(R, { iconName: H.SidebarChevronRight })
				}),
				i ? null : /* @__PURE__ */ X(xg, {
					label: "All projects",
					onClick: e.openProjects,
					children: /* @__PURE__ */ X(R, { iconName: H.Folders })
				}),
				i ? /* @__PURE__ */ X(xg, {
					label: e.createLabel,
					onClick: e.newProject,
					children: /* @__PURE__ */ X(R, { iconName: H.Add })
				}) : /* @__PURE__ */ X(gh, {
					projectId: e.projectId,
					onUnavailable: e.newSession,
					children: (e) => /* @__PURE__ */ X(xg, {
						label: "New session",
						onClick: e,
						children: /* @__PURE__ */ X(R, { iconName: H.Add })
					})
				}),
				/* @__PURE__ */ X(xg, {
					label: e.mcpLabel,
					onClick: e.openMcp,
					children: /* @__PURE__ */ X(R, { iconName: H.Toolbox })
				}),
				/* @__PURE__ */ X(xg, {
					label: "SSH",
					onClick: e.openSsh,
					children: /* @__PURE__ */ X(R, { iconName: H.Globe })
				})
			]
		}), /* @__PURE__ */ Z("div", {
			className: "flex flex-col items-center gap-1 [&>*]:shrink-0",
			children: [/* @__PURE__ */ X(xg, {
				label: "Configurations",
				onClick: e.openConfigurations,
				children: /* @__PURE__ */ X(R, { iconName: H.Gear })
			}), /* @__PURE__ */ X(xg, {
				label: "Managed host",
				onClick: e.openManaged,
				children: /* @__PURE__ */ X(R, { iconName: H.Controls })
			})]
		})]
	});
}
function xg({ label: e, keys: t, onClick: n, children: r }) {
	return /* @__PURE__ */ X(E, {
		title: e,
		keyboardShortcuts: t,
		position: M.CenterRight,
		sticky: !0,
		children: /* @__PURE__ */ X(z, {
			variant: B.Ghost,
			content: g.Icon,
			"aria-label": e,
			onClick: n,
			children: r
		})
	});
}
var Sg = [s, "h"];
function Cg({ variant: e = "session" }) {
	let { setSidebarOffset: t, storedOpen: n, storeOpen: r } = V().stores.sidebarLayoutStore, i = N(), a = A(), [o, s] = J(null), c = o ?? n() ?? a, l = W(() => {
		s((e) => {
			let t = !(e ?? n() ?? a);
			return r(t), t;
		});
	}, [
		a,
		n,
		r
	]), u = ug();
	return pi(() => {
		t(i ? 0 : c ? 280 : 52);
	}, [
		i,
		c,
		t
	]), pi(() => () => t(0), [t]), Cm([{
		keys: Sg,
		onTrigger: l,
		enabled: !i
	}]), i ? null : /* @__PURE__ */ Z("div", {
		"data-sidebar": "true",
		className: I("relative h-full shrink-0 transition-[width] duration-300 ease-out", c ? "w-[280px]" : "w-[52px]"),
		children: [
			c ? null : /* @__PURE__ */ X("div", {
				className: "absolute inset-y-0 left-0 w-[52px]",
				children: /* @__PURE__ */ X(bg, {
					commands: u,
					onToggle: l,
					toggleKeys: Sg,
					variant: e
				})
			}),
			/* @__PURE__ */ X("div", {
				className: I("absolute inset-y-0 z-[1] h-full w-[280px] transition-[left] duration-300 ease-out", c ? "left-0" : "left-[-280px]"),
				"aria-hidden": !c,
				inert: !c,
				children: /* @__PURE__ */ X(yg, {
					isOpen: c,
					commands: u,
					onToggle: l,
					toggleKeys: Sg,
					variant: e
				})
			}),
			u.modals
		]
	});
}
// src/app/components/pages/design-preview/AvatarsSection.tsx
function wg() {
	let [e, t] = J("Port the ArceeFM atoms");
	return /* @__PURE__ */ X(aa, {
		title: "Avatars and editable header",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ Z("div", {
				className: "flex flex-wrap items-center gap-4",
				children: [
					/* @__PURE__ */ X(ta, {
						name: "Aleksy",
						size: $i.Small
					}),
					/* @__PURE__ */ X(ta, { name: "NAC Orchestrator" }),
					/* @__PURE__ */ X(ta, {
						name: "Opus",
						size: $i.Large
					}),
					/* @__PURE__ */ X(ta, {
						name: "🛠",
						glyph: !0,
						size: $i.Large
					}),
					/* @__PURE__ */ X(ta, {
						name: "Anthropic",
						size: $i.XLarge,
						color: "var(--color-bg-info-primary)"
					})
				]
			}), /* @__PURE__ */ X(Ro, {
				value: e,
				onCommit: t,
				size: Lo.Medium,
				className: "max-w-[360px]"
			})]
		})
	});
}
// src/app/components/pages/design-preview/BadgesSection.tsx
function Tg() {
	let [e, t] = J(!0);
	return /* @__PURE__ */ X(aa, {
		title: "Badges, loader, switch, tooltip",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [
				/* @__PURE__ */ X(ia, {
					text: "Running",
					color: na.Green
				}),
				/* @__PURE__ */ X(ia, {
					text: "Queued",
					color: na.Blue
				}),
				/* @__PURE__ */ X(ia, {
					text: "Failed",
					color: na.Red
				}),
				/* @__PURE__ */ X(ia, {
					text: "Idle",
					color: na.Gray
				}),
				/* @__PURE__ */ X(ut, { size: bt.Small }),
				/* @__PURE__ */ X(pd, {
					checked: e,
					onChange: t
				}),
				/* @__PURE__ */ X(E, {
					title: "Pin session",
					description: "Keeps the card at the top of the board.",
					position: M.BottomCenter,
					sticky: !0,
					showTooltipOnMobile: !0,
					children: /* @__PURE__ */ X(R, { iconName: H.Pin })
				}),
				/* @__PURE__ */ X(R, { iconName: H.Unpin })
			]
		})
	});
}
// src/app/components/pages/design-preview/TabsPreview.tsx
var Eg = [
	{
		label: "Default",
		active: !1,
		disabled: !1
	},
	{
		label: "Active",
		active: !0,
		disabled: !1
	},
	{
		label: "Disabled",
		active: !1,
		disabled: !0
	},
	{
		label: "Active, disabled",
		active: !0,
		disabled: !0
	}
], Dg = [
	{
		label: "Regular",
		variant: Vi.Regular
	},
	{
		label: "Accent",
		variant: Vi.Accent
	},
	{
		label: "Destructive",
		variant: Vi.Destructive
	}
], Og = [
	{
		label: "small",
		size: Bi.Small
	},
	{
		label: "medium",
		size: Bi.Medium
	},
	{
		label: "large",
		size: Bi.Large
	}
], kg = [
	{
		label: "Small",
		size: Rl.Small
	},
	{
		label: "Medium",
		size: Rl.Medium
	},
	{
		label: "Large",
		size: Rl.Large
	}
], Ag = [
	{
		label: "Icon left",
		content: zl.IconLeft
	},
	{
		label: "Icon right",
		content: zl.IconRight
	},
	{
		label: "Icon",
		content: zl.IconOnly
	},
	{
		label: "Text",
		content: zl.TextOnly
	},
	{
		label: "Full",
		content: zl.Full
	}
];
function jg() {
	return /* @__PURE__ */ Z("div", {
		className: "grid w-fit grid-cols-[160px_repeat(4,200px)] items-center gap-x-4 gap-y-2",
		children: [
			/* @__PURE__ */ X("span", {}),
			Eg.map((e) => /* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			Dg.flatMap((e) => Og.map((t) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ Z("span", {
				className: "label-small text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), Eg.map((n) => /* @__PURE__ */ Z(Ui, {
				variant: e.variant,
				size: t.size,
				active: n.active,
				disabled: n.disabled,
				children: [
					/* @__PURE__ */ X(R, { iconName: H.Search }),
					/* @__PURE__ */ X("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: "New chat"
					}),
					/* @__PURE__ */ X(R, { iconName: H.Edit })
				]
			}, n.label))] }, `${e.label}-${t.label}`)))
		]
	});
}
function Mg() {
	return /* @__PURE__ */ Z("div", {
		className: "grid w-fit grid-cols-[160px_repeat(5,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ X("span", {}),
			Ag.map((e) => /* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			kg.flatMap((e) => Eg.map((t) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ Z("span", {
				className: "label-small text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label.toLowerCase()
				]
			}), Ag.map((n) => /* @__PURE__ */ X(Bl, {
				size: e.size,
				content: n.content,
				active: t.active,
				disabled: t.disabled,
				iconName: H.Play,
				trailingIcon: H.Right,
				"aria-label": n.content === zl.IconOnly ? "Run" : void 0,
				children: "Run"
			}, n.label))] }, `${e.label}-${t.label}`)))
		]
	});
}
function Ng() {
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ X("span", {
			className: "label-medium text-basic-primary",
			children: "Tab button"
		}), /* @__PURE__ */ X(jg, {})]
	}), /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ X("span", {
			className: "label-medium text-basic-primary",
			children: "Horizontal tab item"
		}), /* @__PURE__ */ X(Mg, {})]
	})] });
}
// src/app/components/pages/design-preview/ButtonsSection.tsx
var Pg = [
	{
		label: "Primary",
		variant: B.Primary
	},
	{
		label: "Secondary",
		variant: B.Secondary
	},
	{
		label: "Secondary highlighted",
		variant: B.SecondaryHighlighted
	},
	{
		label: "Secondary destructive",
		variant: B.SecondaryDestructive
	},
	{
		label: "Secondary accent",
		variant: B.SecondaryAccent
	},
	{
		label: "Secondary accent highlighted",
		variant: B.SecondaryAccentHighlighted
	},
	{
		label: "Ghost",
		variant: B.Ghost
	},
	{
		label: "Ghost highlighted",
		variant: B.GhostHighlighted
	},
	{
		label: "Ghost destructive",
		variant: B.GhostDestructive
	},
	{
		label: "Ghost accent",
		variant: B.GhostAccent
	},
	{
		label: "Ghost highlighted accent",
		variant: B.GhostHighlightedAccent
	},
	{
		label: "Tertiary",
		variant: B.Tertiary
	},
	{
		label: "Tertiary destructive",
		variant: B.TertiaryDestructive
	},
	{
		label: "Tertiary accent",
		variant: B.TertiaryAccent
	}
], Fg = [
	{
		label: "Secondary",
		variant: B.Secondary
	},
	{
		label: "Ghost highlighted",
		variant: B.GhostHighlighted
	},
	{
		label: "Tertiary",
		variant: B.Tertiary
	}
], Ig = [
	{
		label: "small",
		size: U.Small
	},
	{
		label: "medium",
		size: U.Medium
	},
	{
		label: "large",
		size: U.Large
	}
], Lg = [
	{
		label: "Icon",
		content: g.Icon
	},
	{
		label: "Icon left",
		content: g.IconLeft
	},
	{
		label: "Text",
		content: g.Text
	},
	{
		label: "Icon right",
		content: g.IconRight
	}
];
function Rg({ variant: e, size: t = U.Medium, content: n = g.IconLeft, disabled: r = !1 }) {
	let i = n === g.Icon;
	return /* @__PURE__ */ Z(z, {
		variant: e,
		size: t,
		content: n,
		disabled: r,
		"aria-label": i ? "Add" : void 0,
		children: [
			i || n === g.IconLeft ? /* @__PURE__ */ X(R, { iconName: H.Add }) : null,
			i ? null : "Label",
			n === g.IconRight ? /* @__PURE__ */ X(R, { iconName: H.Right }) : null
		]
	});
}
function zg() {
	return /* @__PURE__ */ Z("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ X("span", {}),
			[
				"Default",
				"Disabled",
				"Icon",
				"Icon, disabled"
			].map((e) => /* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: e
			}, e)),
			Pg.map(({ label: e, variant: t }) => /* @__PURE__ */ Z(ai, { children: [
				/* @__PURE__ */ X("span", {
					className: "label-small text-basic-secondary",
					children: e
				}),
				/* @__PURE__ */ X(Rg, { variant: t }),
				/* @__PURE__ */ X(Rg, {
					variant: t,
					disabled: !0
				}),
				/* @__PURE__ */ X(Rg, {
					variant: t,
					content: g.Icon
				}),
				/* @__PURE__ */ X(Rg, {
					variant: t,
					content: g.Icon,
					disabled: !0
				})
			] }, e))
		]
	});
}
function Bg() {
	return /* @__PURE__ */ Z("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ X("span", {}),
			Lg.map(({ label: e }) => /* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: e
			}, e)),
			Fg.flatMap((e) => Ig.map((t) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ Z("span", {
				className: "label-small text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), Lg.map(({ label: n, content: r }) => /* @__PURE__ */ X(Rg, {
				variant: e.variant,
				size: t.size,
				content: r
			}, n))] }, `${e.label}-${t.label}`)))
		]
	});
}
function Vg() {
	return /* @__PURE__ */ X(aa, {
		title: "Buttons",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-8 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ Z("div", {
					className: "flex flex-wrap items-center gap-3",
					children: [
						/* @__PURE__ */ X(z, {
							variant: B.Primary,
							children: "Primary"
						}),
						/* @__PURE__ */ X(z, {
							variant: B.Secondary,
							children: "Secondary"
						}),
						/* @__PURE__ */ X(z, {
							variant: B.Tertiary,
							children: "Tertiary"
						}),
						/* @__PURE__ */ X(z, {
							variant: B.Ghost,
							children: "Ghost"
						}),
						/* @__PURE__ */ X(z, {
							variant: B.GhostDestructive,
							children: "Destructive"
						}),
						/* @__PURE__ */ X(z, {
							variant: B.Primary,
							loading: !0,
							children: "Loading"
						}),
						/* @__PURE__ */ X(z, {
							variant: B.Secondary,
							disabled: !0,
							children: "Disabled"
						}),
						/* @__PURE__ */ Z(z, {
							variant: B.Secondary,
							content: g.IconLeft,
							children: [/* @__PURE__ */ X(R, { iconName: H.Add }), "With icon"]
						})
					]
				}),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-3",
					children: [
						/* @__PURE__ */ X("span", {
							className: "label-medium text-basic-primary",
							children: "Button"
						}),
						/* @__PURE__ */ X(zg, {}),
						/* @__PURE__ */ X(Bg, {})
					]
				}),
				/* @__PURE__ */ X(Ng, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ChoicesSection.tsx
var Hg = [{
	id: "trace",
	name: "session-trace.txt",
	size: "12 KB"
}];
function Ug(e) {
	return {
		id: `${e.name}-${e.lastModified}`,
		name: e.name,
		size: `${Math.ceil(e.size / 1024)} KB`
	};
}
function Wg() {
	let [e, t] = J(!0), [n, r] = J("first"), [i, a] = J(Hg);
	return /* @__PURE__ */ X(aa, {
		title: "Choices, multi-line and file input",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ X(eo, {
						checked: e,
						onChange: t,
						children: "Skip permission prompts"
					}), /* @__PURE__ */ X(eo, {
						checked: !1,
						onChange: () => {},
						disabled: !0,
						children: "Disabled"
					})]
				}),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ X(Ku, {
						name: "preview-choice",
						checked: n === "first",
						onChange: () => r("first"),
						children: "Working tree"
					}), /* @__PURE__ */ X(Ku, {
						name: "preview-choice",
						checked: n === "second",
						onChange: () => r("second"),
						children: "Latest snapshot"
					})]
				}),
				/* @__PURE__ */ X(tu, {
					label: "System prompt",
					rows: 3,
					placeholder: "Extra instructions for the agent",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ Z("div", {
					className: "flex w-[320px] flex-col gap-2",
					children: [/* @__PURE__ */ X(Cl, {
						accept: ".txt,.md,.pdf",
						hint: "Text, Markdown or PDF.",
						onFilesSelected: (e) => a(e.map(Ug))
					}), /* @__PURE__ */ X(Cl, {
						files: i,
						onRemove: (e) => a(i.filter((t) => t.id !== e))
					})]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/CodeBlockSection.tsx
var Gg = "pub enum AgentEvent {\n    RunStarted { thread_name: Option<String> },\n    AssistantMessage {\n        thread_name: Option<String>,\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { thread_name: Option<String> },\n}";
function Kg() {
	return /* @__PURE__ */ X(aa, {
		title: "Code block and chat loader",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ X(hn, {
				code: Gg,
				language: "rust",
				title: "events.rs",
				lineNumbers: !0,
				expandable: !0,
				maxHeight: "220px"
			}), /* @__PURE__ */ X(sa, {})]
		})
	});
}
// src/app/components/pages/design-preview/DatesSection.tsx
function qg() {
	let [e, t] = J(null), [n, r] = J({
		from: null,
		to: null
	});
	return /* @__PURE__ */ X(aa, {
		title: "Dates",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ X(Fo, {
					label: "Created after",
					value: e,
					onChange: t,
					className: "w-[240px]"
				}),
				/* @__PURE__ */ X(Fo, {
					label: "Window",
					range: n,
					onRangeChange: r,
					hintText: "Two clicks pick the ends.",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ X(Eo, {
					selected: e ? /* @__PURE__ */ new Date(`${e}T00:00:00`) : void 0,
					onSelect: (e) => t(`${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`),
					className: "rounded-[8px] border border-muted bg-elevation-level-2"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/FilesAtomsSection.tsx
var Jg = [
	{
		size: hl.Large,
		badge: ll.Large,
		title: "Large"
	},
	{
		size: hl.Medium,
		badge: ll.Medium,
		title: "Medium"
	},
	{
		size: hl.Small,
		badge: ll.Small,
		title: "Small"
	}
], Yg = "src/app/components/index.tsx", Xg = "src/app/components/calendar/RecurringEventsTimeZonePicker.tsx", Zg = [
	{
		title: "Default",
		additions: 279,
		deletions: 84
	},
	{
		title: "Active",
		active: !0,
		additions: 279,
		deletions: 84
	},
	{
		title: "Disabled",
		disabled: !0,
		additions: 279,
		deletions: 84
	},
	{
		title: "Active, disabled",
		active: !0,
		disabled: !0,
		additions: 279,
		deletions: 84
	},
	{ title: "Without counts" }
], Qg = [
	{
		title: "Both",
		additions: 279,
		deletions: 84
	},
	{
		title: "Additions only",
		additions: 12
	},
	{
		title: "Deletions only",
		deletions: 1
	}
], $g = [
	{
		path: "src/app/components/index.tsx",
		additions: 279,
		deletions: 84
	},
	{
		path: "src/app/lib/parser.ts",
		additions: 42,
		deletions: 17
	},
	{
		path: "src/app/lib/lexer.ts",
		additions: 8,
		deletions: 3
	},
	{
		path: "src/app/theme/tokens.css",
		additions: 16,
		deletions: 16
	},
	{
		path: "docs/getting-started.md",
		additions: 31,
		deletions: 0
	},
	{
		path: "crates/demo-core/src/lib.rs",
		additions: 120,
		deletions: 45
	},
	{
		path: "crates/demo-core/Cargo.toml",
		additions: 2,
		deletions: 1
	},
	{
		path: "package.json",
		additions: 3,
		deletions: 2
	},
	{
		path: "scripts/release.sh",
		additions: 14,
		deletions: 9
	},
	{
		path: "src/app/hooks/useCalendar.ts",
		additions: 66,
		deletions: 12
	},
	{
		path: "src/app/components/CalendarView.tsx",
		additions: 98,
		deletions: 40
	},
	{
		path: "src/app/components/EventCard.tsx",
		additions: 25,
		deletions: 7
	},
	{
		path: "tests/parser.test.ts",
		additions: 54,
		deletions: 0
	},
	{
		path: ".github/workflows/ci.yml",
		additions: 6,
		deletions: 4
	},
	{
		path: "Dockerfile",
		additions: 1,
		deletions: 1
	},
	{
		path: "src/app/styles/calendar.scss",
		additions: 19,
		deletions: 22
	},
	{
		path: Xg,
		additions: 1204,
		deletions: 377
	}
], e_ = [
	{
		title: "Default",
		status: null
	},
	{
		title: "Changed",
		status: wl.Changed
	},
	{
		title: "Added",
		status: wl.Added
	},
	{
		title: "Deleted",
		status: wl.Deleted
	},
	{
		title: "Changed name",
		status: wl.ChangedName
	},
	{
		title: "Copied",
		status: wl.Copied
	},
	{
		title: "Changed type",
		status: wl.ChangedType
	},
	{
		title: "Conflict",
		status: wl.Conflict
	},
	{
		title: "Not tracked",
		status: wl.NotTracked
	},
	{
		title: "Ignored",
		status: wl.Ignored
	}
], t_ = [
	{
		title: "File",
		variant: Al.File
	},
	{
		title: "File, active",
		variant: Al.File,
		active: !0
	},
	{
		title: "File, disabled",
		variant: Al.File,
		disabled: !0
	},
	{
		title: "Folder",
		variant: Al.Folder
	},
	{
		title: "Folder, open",
		variant: Al.Folder,
		active: !0
	}
], n_ = "src/app/lib/parser.ts", r_ = (e, t, n, r, i = !0) => ({
	kind: e,
	old_lineno: t,
	new_lineno: n,
	content: r,
	has_trailing_newline: i
}), i_ = {
	stage: "unstaged",
	status: "modified",
	additions: 3,
	deletions: 2,
	binary: !1,
	too_large: !1,
	truncated: !1,
	error: null,
	hunks: [{
		function_context: null,
		old_start: 1,
		old_lines: 3,
		new_start: 1,
		new_lines: 3,
		lines: [
			r_("context", 1, 1, "import { tokenize } from \"./lexer\";"),
			r_("delete", 2, null, "import type { Token } from \"./lexer\";"),
			r_("insert", null, 2, "import { type Token, TokenKind } from \"./lexer\";"),
			r_("context", 3, 3, "")
		]
	}, {
		function_context: null,
		old_start: 24,
		old_lines: 3,
		new_start: 24,
		new_lines: 4,
		lines: [
			r_("context", 24, 24, "export function parse(source: string): Token[] {"),
			r_("delete", 25, null, "  return tokenize(source);"),
			r_("insert", null, 25, "  const tokens = tokenize(source);"),
			r_("insert", null, 26, "  return tokens.filter((token) => token.kind !== TokenKind.Whitespace && token.kind !== TokenKind.Comment);"),
			r_("context", 26, 27, "}", !1)
		]
	}]
}, a_ = "bg-elevation-ground p-2", o_ = () => {};
function s_() {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("span", {
			className: "label-micro text-basic-muted",
			children: "File button"
		}), /* @__PURE__ */ Z("div", {
			className: "grid w-fit grid-cols-[auto_repeat(3,auto)] items-center gap-x-4 gap-y-2",
			children: [
				/* @__PURE__ */ X("span", {}),
				Jg.map(({ size: e, title: t }) => /* @__PURE__ */ X("span", {
					className: "label-micro text-basic-muted",
					children: t
				}, e)),
				Zg.map((e) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X("span", {
					className: "label-micro text-basic-tertiary",
					children: e.title
				}), Jg.map(({ size: t }) => /* @__PURE__ */ X("div", {
					className: a_,
					children: /* @__PURE__ */ X(bl, {
						path: Yg,
						size: t,
						active: e.active,
						disabled: e.disabled,
						additions: e.additions,
						deletions: e.deletions,
						onClick: o_
					})
				}, t))] }, e.title))
			]
		})]
	});
}
function c_() {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("span", {
			className: "label-micro text-basic-muted",
			children: "A long name in 200px"
		}), /* @__PURE__ */ X("div", {
			className: "flex flex-wrap items-start gap-4",
			children: Jg.map(({ size: e }) => /* @__PURE__ */ X("div", {
				className: `w-[200px] ${a_}`,
				children: /* @__PURE__ */ X(bl, {
					path: Xg,
					size: e,
					additions: 1204,
					deletions: 377,
					onClick: o_
				})
			}, e))
		})]
	});
}
function l_() {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("span", {
			className: "label-micro text-basic-muted",
			children: "Code changes badge"
		}), /* @__PURE__ */ Z("div", {
			className: "grid w-fit grid-cols-[64px_repeat(3,auto)] items-center gap-x-6 gap-y-2",
			children: [
				/* @__PURE__ */ X("span", {}),
				Qg.map(({ title: e }) => /* @__PURE__ */ X("span", {
					className: "label-micro text-basic-muted",
					children: e
				}, e)),
				Jg.map(({ badge: e, title: t }) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X("span", {
					className: "label-micro text-basic-tertiary",
					children: t
				}), Qg.map((t) => /* @__PURE__ */ X(ml, {
					size: e,
					additions: t.additions,
					deletions: t.deletions
				}, t.title))] }, e))
			]
		})]
	});
}
function u_({ files: e, size: t, caption: n }) {
	let [r, i] = J(e[1]?.path ?? null);
	return /* @__PURE__ */ Z("div", {
		className: "flex w-[280px] flex-col gap-2",
		children: [
			/* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: n
			}),
			/* @__PURE__ */ X("div", {
				className: a_,
				children: /* @__PURE__ */ X(Sl, {
					"aria-label": "Changed files",
					size: t,
					files: e.map((e) => ({
						...e,
						active: e.path === r
					})),
					onOpen: i
				})
			}),
			/* @__PURE__ */ Z("span", {
				className: "label-micro text-basic-tertiary",
				children: ["Open file: ", r ?? "none"]
			})
		]
	});
}
function d_() {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [Jg.map(({ size: e, title: t }) => /* @__PURE__ */ X(u_, {
			size: e,
			files: $g.slice(0, 5),
			caption: `List, 5 files, ${t}`
		}, e)), /* @__PURE__ */ X(u_, {
			size: hl.Small,
			files: $g,
			caption: "List, 17 files, Small"
		})]
	});
}
function f_() {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("span", {
			className: "label-micro text-basic-muted",
			children: "Git status labels"
		}), /* @__PURE__ */ X("div", {
			className: `flex w-fit gap-3 ${a_}`,
			children: Object.values(wl).map((e) => /* @__PURE__ */ X(Ol, { status: e }, e))
		})]
	});
}
var p_ = (e) => e === Al.Folder ? "components" : "index.tsx";
function m_() {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: "File list tab button, Small"
			}),
			/* @__PURE__ */ Z("div", {
				className: "grid w-fit grid-cols-[auto_repeat(5,160px)] items-center gap-x-3 gap-y-1",
				children: [
					/* @__PURE__ */ X("span", {}),
					t_.map(({ title: e }) => /* @__PURE__ */ X("span", {
						className: "label-micro text-basic-muted",
						children: e
					}, e)),
					e_.map(({ title: e, status: t }) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X("span", {
						className: "label-micro text-basic-tertiary",
						children: e
					}), t_.map((e) => /* @__PURE__ */ X("div", {
						className: a_,
						children: /* @__PURE__ */ X(Fl, {
							name: p_(e.variant),
							variant: e.variant,
							status: t,
							active: e.active,
							disabled: e.disabled,
							onClick: o_
						})
					}, e.title))] }, e))
				]
			}),
			/* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: "File list tab button, Large"
			}),
			/* @__PURE__ */ X("div", {
				className: "flex flex-wrap items-start gap-4",
				children: t_.filter((e) => !e.disabled).map((e) => /* @__PURE__ */ X("div", {
					className: `w-[280px] ${a_}`,
					children: /* @__PURE__ */ X(Fl, {
						name: p_(e.variant),
						variant: e.variant,
						size: kl.Large,
						status: wl.Changed,
						active: e.active,
						onClick: o_
					})
				}, e.title))
			})
		]
	});
}
var h_ = (e, t) => ({
	kind: e.kind === "insert" || e.kind === "delete" ? e.kind : "context",
	number: e.kind === "delete" ? e.old_lineno : e.new_lineno ?? e.old_lineno,
	content: e.content,
	tokens: t,
	trailing: e.has_trailing_newline ? null : /* @__PURE__ */ X("span", {
		className: "italic text-basic-muted",
		children: " No newline at end of file"
	})
});
function g_() {
	let [e, t] = J(() => /* @__PURE__ */ new Map());
	return G(() => {
		let e = !0;
		return zt(n_, [i_]).then((n) => {
			e && t(n);
		}), () => {
			e = !1;
		};
	}, []), /* @__PURE__ */ X("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [{
			title: "Code displayer, two hunks",
			tokens: e
		}, {
			title: "Code displayer without tokens",
			tokens: null
		}].map(({ title: e, tokens: t }) => /* @__PURE__ */ Z("div", {
			className: "flex w-[480px] flex-col gap-2",
			children: [/* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: e
			}), /* @__PURE__ */ X("div", {
				className: a_,
				children: /* @__PURE__ */ X(oo, {
					"aria-label": `Changes to ${n_}`,
					hunks: i_.hunks.map((e) => e.lines.map((e) => h_(e, t?.get(e))))
				})
			})]
		}, e))
	});
}
function __() {
	return /* @__PURE__ */ X(aa, {
		title: "Files",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ X(s_, {}),
				/* @__PURE__ */ X(c_, {}),
				/* @__PURE__ */ X(l_, {}),
				/* @__PURE__ */ X(d_, {}),
				/* @__PURE__ */ X(f_, {}),
				/* @__PURE__ */ X(m_, {}),
				/* @__PURE__ */ X(g_, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/InputsSection.tsx
var v_ = [
	{
		id: "sonnet",
		label: "Claude Sonnet",
		icon: H.Brain
	},
	{
		id: "opus",
		label: "Claude Opus",
		icon: H.Brain
	},
	{
		id: "gpt",
		label: "GPT",
		icon: H.Ai
	}
];
function y_({ onOpenModal: e }) {
	let [t, n] = J("sonnet");
	return /* @__PURE__ */ X(aa, {
		title: "Inputs",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-wrap items-end gap-4",
			children: [
				/* @__PURE__ */ X($, {
					label: "Working directory",
					inputSize: Q.Medium,
					placeholder: "/Users/me/project",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ X($, {
					label: "Search",
					inputSize: Q.Medium,
					leading: Hl.Icon,
					leadingIconName: H.Search,
					placeholder: "Filter sessions",
					hintText: "Matches name and cwd",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ X(Xu, {
					items: v_,
					value: t,
					onValueChange: n,
					placeholder: "Pick a model"
				}),
				/* @__PURE__ */ X(z, {
					variant: B.Secondary,
					onClick: e,
					children: "Open modal"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/InsightItemsPreview.tsx
var b_ = "The parser drops nested tables because the lexer resets its indent stack on every blank line. Check where resetIndent is called before changing it: the list renderer relies on the same reset.", x_ = "npm run typecheck", S_ = JSON.stringify({
	cmd: x_,
	workdir: "/workspace/demo-project",
	yield_time_ms: 1e4
}, null, 2), C_ = "> nac-web@0.0.0 typecheck\n> tsc -p packages/nac-client/tsconfig.json --noEmit && tsc -b\n\nChecked src/app/components/inspector/insights/presentation/InsightDetailColumn.tsx without errors.", w_ = `${C_}\nChecked 412 files in 6.1 s.\nFound 0 errors.`, T_ = "Pause after the staging deploy and wait for my review before touching production.", E_ = "resetIndent\\(", D_ = JSON.stringify({
	pattern: E_,
	path: "src/app/lib",
	output_mode: "content"
}, null, 2), O_ = "src/app/lib/lexer.ts:42\nsrc/app/lib/lexer.ts:118\nsrc/app/lib/parser/table.ts:7", k_ = `${O_}\nsrc/app/lib/parser/list.ts:63\nsrc/app/lib/parser/list.ts:91`, A_ = [
	"resetIndent",
	"clearIndentStack",
	"popIndent",
	"pushIndent",
	"indentLevel",
	"dedentTokens",
	"blankLineReset",
	"tableRowIndent",
	"listItemIndent",
	"nestedTableDepth"
], j_ = `${A_.join("|").slice(0, 110)}…`, M_ = JSON.stringify({
	pattern: A_.join("|"),
	path: "src/app/lib",
	regex: !0
}, null, 2), N_ = "The file changed on disk after it was read, so the edit was not applied. Read src/app/lib/lexer.ts again and repeat the edit against its current content; the old text no longer matches line 42.", P_ = `${N_.slice(0, 160).trimEnd()}...`, F_ = 1200;
function I_() {
	let [e, t] = J(ru.Default);
	return G(() => {
		if (e !== ru.Loading) return;
		let n = window.setTimeout(() => t(ru.Expanded), F_);
		return () => window.clearTimeout(n);
	}, [e]), {
		state: e,
		showFull: () => t(ru.Loading),
		hide: () => t(ru.Default)
	};
}
function L_({ title: e, shortContent: t, fullContent: n }) {
	let r = I_();
	return /* @__PURE__ */ X(au, {
		title: e,
		state: r.state,
		shortContent: t,
		fullContent: n,
		onShowFull: r.showFull,
		onHide: r.hide
	});
}
function R_() {
	let e = I_(), t = e.state === ru.Expanded;
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("span", {
			className: "label-micro text-basic-muted",
			children: "Error, the message cut by its preview"
		}), /* @__PURE__ */ X("div", {
			className: "w-[542px] max-w-full bg-elevation-ground",
			children: /* @__PURE__ */ X(cu, {
				id: "preview-cut-error",
				icon: H.Edit,
				title: "Edit lexer.ts",
				state: su.Error,
				errorMessage: t ? N_ : P_,
				errorAction: /* @__PURE__ */ X(nu, {
					expanded: t,
					loading: e.state === ru.Loading,
					onClick: t ? e.hide : e.showFull
				})
			})
		})]
	});
}
var z_ = () => {}, B_ = [
	{
		label: "Default, with Show full",
		title: "Input",
		shortContent: j_,
		onShowFull: z_
	},
	{
		label: "Default, without Show full",
		title: "Input",
		shortContent: j_
	},
	{
		label: "Default, without a preview",
		title: "Input",
		shortContent: "",
		onShowFull: z_
	},
	{
		label: "Default, the load failed (Show full retries)",
		title: "Input",
		shortContent: j_,
		onShowFull: z_,
		error: "Could not load the full input."
	},
	{
		label: "Loading",
		title: "Input",
		state: ru.Loading,
		shortContent: j_,
		onShowFull: z_
	},
	{
		label: "Expanded",
		title: "Input",
		state: ru.Expanded,
		shortContent: j_,
		fullContent: M_,
		onHide: z_
	},
	{
		label: "Expanded, cut by the server",
		title: "Input",
		state: ru.Expanded,
		shortContent: j_,
		fullContent: M_,
		onHide: z_,
		note: "The server cut this input at its size limit."
	},
	{
		label: "Without heading",
		title: "Input",
		showHeading: !1,
		shortContent: j_,
		onShowFull: z_
	}
];
function V_() {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("span", {
			className: "label-micro text-basic-muted",
			children: "Code displayer"
		}), /* @__PURE__ */ Z("div", {
			className: "grid grid-cols-3 items-start gap-4",
			children: [B_.map(({ label: e, ...t }) => /* @__PURE__ */ Z("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ X("span", {
					className: "label-micro text-basic-tertiary",
					children: e
				}), /* @__PURE__ */ X("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ X(au, { ...t })
				})]
			}, e)), /* @__PURE__ */ Z("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ X("span", {
					className: "label-micro text-basic-tertiary",
					children: "Interactive"
				}), /* @__PURE__ */ X("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ X(L_, {
						title: "Input",
						shortContent: j_,
						fullContent: M_
					})
				})]
			})]
		})]
	});
}
var H_ = [
	{
		type: "Reasoning",
		icon: H.Brain,
		title: "Thoughts, 2.3 s",
		loadingTitle: "Thinking",
		copyText: b_,
		errorMessage: "The model stopped before it finished reasoning.",
		body: (e) => e === su.Default ? /* @__PURE__ */ X("p", { children: b_ }) : null
	},
	{
		type: "Run Command (Error keeps the input)",
		icon: H.Terminal,
		title: "Run command",
		loadingTitle: "Running command",
		copyText: x_,
		errorMessage: "Command exited with code 2.",
		body: (e) => {
			if (e === su.Loading) return null;
			let t = /* @__PURE__ */ X(L_, {
				title: "Input",
				shortContent: x_,
				fullContent: S_
			});
			return e === su.Error ? t : /* @__PURE__ */ Z(Y, { children: [t, /* @__PURE__ */ X(L_, {
				title: "Output",
				shortContent: C_,
				fullContent: w_
			})] });
		}
	},
	{
		type: "Steer Session (Loading and Error keep the link)",
		icon: H.AddChat,
		title: "Steer session",
		loadingTitle: "Steer session",
		copyText: T_,
		errorMessage: "The session is no longer running.",
		body: (e) => e === su.Default ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("p", { children: T_ }), /* @__PURE__ */ X(ou, {
			label: "Calendar rollout",
			href: "#/design"
		})] }) : /* @__PURE__ */ X(ou, {
			label: "Calendar rollout",
			onClick: () => {}
		})
	},
	{
		type: "Search File",
		icon: H.SearchFile,
		title: "Search files",
		loadingTitle: "Search files",
		copyText: E_,
		errorMessage: "The pattern is not a valid regular expression.",
		body: (e) => {
			if (e === su.Loading) return null;
			let t = /* @__PURE__ */ X(L_, {
				title: "Input",
				shortContent: E_,
				fullContent: D_
			});
			return e === su.Error ? t : /* @__PURE__ */ Z(Y, { children: [t, /* @__PURE__ */ X(L_, {
				title: "Output",
				shortContent: O_,
				fullContent: k_
			})] });
		}
	}
], U_ = [
	{
		state: su.Default,
		title: "Default"
	},
	{
		state: su.Loading,
		title: "Loading"
	},
	{
		state: su.Error,
		title: "Error"
	}
];
function W_() {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("span", {
			className: "label-micro text-basic-muted",
			children: "Stacked, the first one active"
		}), /* @__PURE__ */ X("div", {
			className: "flex w-[542px] max-w-full flex-col bg-elevation-ground",
			children: H_.map((e, t) => /* @__PURE__ */ X(cu, {
				id: `preview-stacked-${e.icon}`,
				icon: e.icon,
				title: e.title,
				active: t === 0,
				copyText: e.copyText,
				children: e.body(su.Default)
			}, e.type))
		})]
	});
}
function G_() {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ X(V_, {}),
			/* @__PURE__ */ X(W_, {}),
			/* @__PURE__ */ X(R_, {}),
			/* @__PURE__ */ Z("div", {
				className: "grid grid-cols-3 items-start gap-x-4 gap-y-2",
				children: [U_.map(({ state: e, title: t }) => /* @__PURE__ */ X("span", {
					className: "label-micro text-basic-muted",
					children: t
				}, e)), H_.flatMap((e) => [!1, !0].map((t) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X("span", {
					className: "col-span-3 pt-2 label-micro text-basic-tertiary",
					children: t ? `${e.type}, active` : e.type
				}), U_.map(({ state: n }) => /* @__PURE__ */ X("div", {
					className: "min-w-0 bg-elevation-ground",
					children: /* @__PURE__ */ X(cu, {
						id: `preview-${e.icon}-${n}-${t}`,
						icon: e.icon,
						title: n === su.Loading ? e.loadingTitle : e.title,
						state: n,
						active: t,
						copyText: e.copyText,
						errorMessage: e.errorMessage,
						children: e.body(n)
					})
				}, n))] }, `${e.type}-${t}`)))]
			})
		]
	});
}
// src/app/components/pages/design-preview/InsightsAtomsSection.tsx
var K_ = [
	{
		type: "Thread",
		icon: H.Chat,
		label: "impl/calendar",
		meta: "Thread, 3"
	},
	{
		type: "Thoughts",
		icon: H.Brain,
		label: "Thoughts",
		meta: "13.8 s",
		runningLabel: "Thinking…"
	},
	{
		type: "Define Workset",
		icon: H.Checklist,
		label: "calendar-sync",
		meta: "Workset",
		failedLabel: "Define Workset",
		runningLabel: "Defining Workset…"
	},
	{
		type: "Delete Workset",
		icon: H.Trash,
		label: "Deleted: impl/calendar",
		failedLabel: "Delete thread",
		runningLabel: "Deleting…"
	},
	{
		type: "Read File",
		icon: H.ReadFile,
		label: "index.tsx",
		meta: "Read",
		failedLabel: "Read File",
		runningLabel: "Reading File…"
	},
	{
		type: "Write File",
		icon: H.FileUpload,
		label: "index.tsx",
		meta: "Write",
		failedLabel: "Create File",
		runningLabel: "Creating File…"
	},
	{
		type: "Edit File",
		icon: H.Edit,
		label: "index.tsx",
		meta: "Edit",
		failedLabel: "Edit File",
		runningLabel: "Editing File…"
	},
	{
		type: "Glob",
		icon: H.SearchFiles,
		label: "Find files",
		meta: "Glob",
		runningLabel: "Find files…"
	},
	{
		type: "Grep",
		icon: H.SearchFile,
		label: "Search files",
		meta: "Grep",
		runningLabel: "Search files…"
	},
	{
		type: "Run Terminal",
		icon: H.Terminal,
		label: "Run command",
		meta: "Exec",
		runningLabel: "Running command…"
	},
	{
		type: "Use Terminal",
		icon: H.WriteCommand,
		label: "Write command",
		meta: "Write",
		runningLabel: "Write command…"
	},
	{
		type: "Read Output Command",
		icon: H.ScreenView,
		label: "Read Output Command",
		meta: "Read",
		runningLabel: "Read Output Command…"
	},
	{
		type: "Create goal",
		icon: H.Flag,
		label: "Create goal",
		meta: "Create",
		runningLabel: "Creating goal…"
	},
	{
		type: "Read goal",
		icon: H.Important,
		label: "Get goal",
		meta: "Read",
		runningLabel: "Get goal…"
	},
	{
		type: "Update goal",
		icon: H.Checklist,
		label: "Update goal",
		meta: "Edit",
		runningLabel: "Updating goal…"
	},
	{
		type: "Spawn Session - Agent",
		icon: H.Plane,
		label: "Calendar sync agent",
		meta: "Spawn",
		failedLabel: "Spawn Agent",
		runningLabel: "Spawn Agent…"
	},
	{
		type: "Spawn Session - Orchestrator",
		icon: H.Orchestrator,
		label: "Calendar rollout",
		meta: "Spawn",
		failedLabel: "Spawn Orchestrator",
		runningLabel: "Spawn Orchestrator…"
	},
	{
		type: "Check session status",
		icon: H.Info,
		label: "Calendar sync agent",
		meta: "Check",
		failedLabel: "Check session status",
		runningLabel: "Checking session status…"
	},
	{
		type: "Steer Session",
		icon: H.AddChat,
		label: "Calendar rollout",
		meta: "Steer",
		failedLabel: "Steer session",
		runningLabel: "Steer session…"
	},
	{
		type: "Session Read",
		icon: H.Eye,
		label: "Calendar rollout",
		meta: "Read",
		failedLabel: "Read session",
		runningLabel: "Reading session…"
	},
	{
		type: "Session Wait",
		icon: H.Timelaps,
		label: "Calendar rollout",
		meta: "Wait",
		failedLabel: "Wait for session",
		runningLabel: "Wait for session…"
	},
	{
		type: "Cancel session",
		icon: H.Trash,
		label: "Calendar sync agent",
		meta: "Delete",
		failedLabel: "Delete session",
		runningLabel: "Deleting session…"
	},
	{
		type: "ToolsSegment",
		icon: H.Right,
		label: "Total activity: 13.3s",
		meta: "12",
		runningLabel: "Working…",
		group: !0
	},
	{
		type: "Web search",
		icon: H.Search,
		label: "tokio select timeout",
		meta: "Search",
		runningLabel: "Searching the web…"
	},
	{
		type: "Web fetch",
		icon: H.Globe,
		label: "docs.rs",
		meta: "Fetch",
		runningLabel: "Fetching docs.rs…"
	},
	{
		type: "Other tool",
		icon: H.Code,
		label: "MCP · list_issues",
		meta: "Tool",
		runningLabel: "Running list_issues…"
	}
], q_ = [
	{
		status: Wi.Ready,
		title: "Ready"
	},
	{
		status: Wi.Pending,
		title: "Pending"
	},
	{
		status: Wi.Running,
		title: "Running"
	},
	{
		status: Wi.Failed,
		title: "Failed or canceled"
	}
], J_ = [
	"Thread",
	"Read File",
	"ToolsSegment"
], Y_ = [
	{
		key: "thoughts",
		icon: H.Brain,
		label: "Thoughts",
		meta: "13.8 s"
	},
	{
		key: "read",
		icon: H.ReadFile,
		label: "index.tsx",
		meta: "Read"
	},
	{
		key: "write",
		icon: H.FileUpload,
		label: "index.tsx",
		meta: "Write"
	}
], X_ = [
	"impl/calendar",
	"impl/recurring-events",
	"review/calendar",
	"docs/calendar"
], Z_ = "flex w-[268px] flex-col gap-1 bg-elevation-ground p-2", Q_ = "flex w-[380px] flex-col gap-1 bg-elevation-ground p-2";
function $_(e, t) {
	return t === Wi.Running ? e.runningLabel ?? e.label : t === Wi.Failed ? e.failedLabel ?? e.label : e.label;
}
function ev(e, t) {
	return (t === Wi.Running || t === Wi.Failed) && e.type !== "Thread" ? void 0 : e.meta;
}
function tv() {
	let e = [...K_.map((e) => ({
		sample: e,
		active: !1
	})), ...K_.filter((e) => J_.includes(e.type)).map((e) => ({
		sample: e,
		active: !0
	}))];
	return /* @__PURE__ */ Z("div", {
		className: "grid grid-cols-[136px_repeat(4,minmax(0,1fr))] items-center gap-x-3 gap-y-1",
		children: [
			/* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: "Type"
			}),
			q_.map(({ status: e, title: t }) => /* @__PURE__ */ X("span", {
				className: "px-2 label-micro text-basic-muted",
				children: t
			}, e)),
			e.map(({ sample: e, active: t }) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X("span", {
				className: "truncate label-micro text-basic-tertiary",
				children: t ? `${e.type}, active` : e.type
			}), q_.map(({ status: n }) => /* @__PURE__ */ X(Zi, {
				icon: e.icon,
				label: $_(e, n),
				meta: ev(e, n),
				status: n,
				selected: t || void 0,
				expanded: e.group ? t : void 0
			}, n))] }, `${e.type}-${t}`))
		]
	});
}
function nv() {
	let [e, t] = J(!0), [n, r] = J("thoughts"), i = n === "group" || Y_.some(({ key: e }) => e === n);
	return /* @__PURE__ */ Z("div", {
		className: Z_,
		children: [
			/* @__PURE__ */ X(Zi, {
				icon: H.Right,
				label: "Total activity: 13.3s",
				meta: String(Y_.length),
				expanded: e,
				selected: i,
				onClick: () => {
					t((e) => !e), r("group");
				}
			}),
			e ? /* @__PURE__ */ X(Qi, { children: Y_.map((e) => /* @__PURE__ */ X(Zi, {
				icon: e.icon,
				label: e.label,
				meta: e.meta,
				selected: n === e.key,
				onClick: () => r(e.key)
			}, e.key)) }) : null,
			/* @__PURE__ */ X(Zi, {
				icon: H.Eye,
				label: "Calendar rollout",
				meta: "Read",
				onClick: () => {}
			}),
			/* @__PURE__ */ X(Zi, {
				icon: H.Right,
				label: "Total activity: 4.1s",
				meta: "5",
				expanded: !1
			}),
			/* @__PURE__ */ X(Zi, {
				icon: H.Orchestrator,
				label: "Calendar rollout",
				meta: "Spawn",
				onClick: () => {}
			}),
			/* @__PURE__ */ X(Zi, {
				icon: H.Brain,
				label: "Thoughts",
				meta: "2.1 s",
				selected: n === "last",
				onClick: () => r("last")
			})
		]
	});
}
function rv() {
	let [e, t] = J(X_[0]), n = (n) => /* @__PURE__ */ X(Zi, {
		icon: H.Chat,
		label: n,
		meta: "Thread, 3",
		selected: e === n,
		onClick: () => t(n)
	}, n);
	return /* @__PURE__ */ Z("div", {
		className: Z_,
		children: [
			/* @__PURE__ */ X(Zi, {
				icon: H.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ X(Qi, { children: X_.map(n) }),
			/* @__PURE__ */ X(Zi, {
				icon: H.Right,
				label: "Total activity: 13.3s",
				meta: "12",
				expanded: !1
			}),
			/* @__PURE__ */ X(Qi, { children: n("impl/time-zones") }),
			/* @__PURE__ */ X(Zi, {
				icon: H.Brain,
				label: "Thoughts",
				meta: "2.1 s"
			})
		]
	});
}
function iv() {
	return /* @__PURE__ */ Z("div", {
		className: Z_,
		children: [
			/* @__PURE__ */ X(Zi, {
				icon: H.Chat,
				label: "impl/calendar-sync-recurring-events-and-time-zones",
				meta: "Thread, 12"
			}),
			/* @__PURE__ */ X(Zi, {
				icon: H.Orchestrator,
				label: "Roll the recurring-events fix out to every calendar provider",
				meta: "Spawn"
			}),
			/* @__PURE__ */ X(Zi, {
				icon: H.Plane,
				label: "Investigate why the nightly export drops recurring events",
				meta: "Spawn",
				status: Wi.Pending,
				selected: !0
			})
		]
	});
}
function av() {
	let [e, t] = J(!0), [n, r] = J("review/calendar"), i = Gi.Large;
	return /* @__PURE__ */ Z("div", {
		className: Q_,
		children: [
			/* @__PURE__ */ X(Zi, {
				size: i,
				icon: H.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ Z(Qi, {
				className: "py-2",
				children: [
					/* @__PURE__ */ X(Zi, {
						size: i,
						icon: H.Chat,
						label: "impl/calendar",
						meta: "Thread, 3",
						status: Wi.Running
					}),
					/* @__PURE__ */ X(Zi, {
						size: i,
						icon: H.Chat,
						label: "impl/recurring-events",
						meta: "Thread, 2",
						status: Wi.Failed
					}),
					/* @__PURE__ */ X(Zi, {
						size: i,
						icon: H.Chat,
						label: "docs/calendar",
						meta: "Thread, 1",
						status: Wi.Pending
					}),
					/* @__PURE__ */ X(Zi, {
						size: i,
						icon: H.Chat,
						label: "review/calendar",
						meta: "Thread, 3",
						selected: n === "review/calendar",
						onClick: () => r("review/calendar")
					})
				]
			}),
			/* @__PURE__ */ X(Zi, {
				size: i,
				icon: H.Right,
				label: "Worked for 13.3s",
				meta: String(Y_.length),
				expanded: e,
				onClick: () => t((e) => !e)
			}),
			e ? /* @__PURE__ */ X(Qi, { children: Y_.map((e) => /* @__PURE__ */ X(Zi, {
				size: i,
				icon: e.icon,
				label: e.label,
				meta: e.meta,
				selected: n === e.key,
				onClick: () => r(e.key)
			}, e.key)) }) : null
		]
	});
}
function ov() {
	return /* @__PURE__ */ X(aa, {
		title: "Insights",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ X(tv, {}),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-wrap items-start gap-6",
					children: [
						/* @__PURE__ */ X(nv, {}),
						/* @__PURE__ */ X(rv, {}),
						/* @__PURE__ */ X(iv, {}),
						/* @__PURE__ */ X(av, {})
					]
				}),
				/* @__PURE__ */ X(G_, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ModelLoaderSection.tsx
var sv = [{
	variant: fa.Default,
	label: "Default"
}, {
	variant: fa.Accent,
	label: "Accent"
}], cv = [
	{
		size: da.Small,
		label: "Small 16px"
	},
	{
		size: da.Medium,
		label: "Medium 20px"
	},
	{
		size: da.Large,
		label: "Large 24px"
	}
], lv = [
	1,
	2,
	3
];
function uv() {
	return /* @__PURE__ */ X(aa, {
		title: "Model loader",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(4,72px)] items-center gap-x-4 gap-y-3",
			children: [
				/* @__PURE__ */ X("span", {}),
				/* @__PURE__ */ X("span", {
					className: "label-micro text-basic-muted",
					children: "Animated"
				}),
				lv.map((e) => /* @__PURE__ */ Z("span", {
					className: "label-micro text-basic-muted",
					children: ["Frame ", e]
				}, e)),
				sv.flatMap(({ variant: e, label: t }) => cv.map(({ size: n, label: r }) => /* @__PURE__ */ Z(ai, { children: [
					/* @__PURE__ */ Z("span", {
						className: "label-small text-basic-secondary",
						children: [
							t,
							" · ",
							r
						]
					}),
					/* @__PURE__ */ X(ka, {
						size: n,
						variant: e
					}),
					lv.map((t) => /* @__PURE__ */ X(ka, {
						size: n,
						variant: e,
						frame: t
					}, t))
				] }, `${e}-${n}`)))
			]
		})
	});
}
// src/app/components/pages/design-preview/NoticesSection.tsx
function dv() {
	return /* @__PURE__ */ X(aa, {
		title: "Notices and loaders",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [
				/* @__PURE__ */ Z("div", {
					className: "flex flex-wrap gap-3",
					children: [
						/* @__PURE__ */ X(wu, {
							variant: hu.Info,
							title: "Read-only snapshot",
							className: "w-[280px]",
							children: "Pick the working tree to edit files again."
						}),
						/* @__PURE__ */ X(wu, {
							variant: hu.Error,
							title: "Run failed",
							className: "w-[280px]",
							children: "The provider rejected the request."
						}),
						/* @__PURE__ */ X(wu, {
							variant: hu.Success,
							title: "Branch switched",
							className: "w-[280px]"
						})
					]
				}),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-2 w-[398px]",
					children: [
						/* @__PURE__ */ X(Ja, {
							variant: Wa.Danger,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						}),
						/* @__PURE__ */ X(Ja, {
							variant: Wa.Error,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						}),
						/* @__PURE__ */ X(Ja, {
							variant: Wa.Success,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						}),
						/* @__PURE__ */ X(Ja, {
							variant: Wa.Info,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						})
					]
				}),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-wrap items-center gap-6",
					children: [
						/* @__PURE__ */ X(uu, { size: bt.Medium }),
						/* @__PURE__ */ X(Qa, {
							rows: 3,
							className: "w-[200px]"
						}),
						/* @__PURE__ */ X(du, {
							active: !0,
							className: "w-[200px]"
						})
					]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/NumericInputsSection.tsx
function fv() {
	let [e, t] = J(4), [n, r] = J(.7), [i, a] = J(["local"]), [o, s] = J(1);
	return /* @__PURE__ */ X(aa, {
		title: "Numeric inputs, tags and pagination",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ Z("div", {
					className: "flex flex-wrap items-center gap-8",
					children: [/* @__PURE__ */ X(Au, {
						value: e,
						onChange: t,
						min: 1,
						max: 16,
						"aria-label": "Parallel threads"
					}), /* @__PURE__ */ Z("div", {
						className: "flex items-center gap-4 w-[320px]",
						children: [/* @__PURE__ */ X(Ju, {
							min: 0,
							max: 2,
							step: .1,
							value: n,
							onChange: r,
							label: "Temperature"
						}), /* @__PURE__ */ X("span", {
							className: "code code-small text-basic-muted w-8 shrink-0",
							children: n.toFixed(1)
						})]
					})]
				}),
				/* @__PURE__ */ X(md, {
					tags: [
						"local",
						"docker",
						"remote",
						"sandbox"
					],
					selected: i,
					onChange: a
				}),
				/* @__PURE__ */ X(ju, {
					page: o,
					pageSize: 10,
					totalItems: 84,
					itemLabel: "sessions",
					onPageChange: s,
					className: "border-t border-muted"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/PopoverSection.tsx
function pv() {
	let [e, t] = J(!1);
	return /* @__PURE__ */ X(aa, {
		title: "Popover, copy, shortcuts",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [
				/* @__PURE__ */ X(x, {
					open: e,
					onClose: () => t(!1),
					placement: M.BottomRight,
					sticky: !0,
					content: /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("div", {
						className: "label-small text-basic-primary px-2 py-1",
						children: "Anchored panel"
					}), /* @__PURE__ */ X("div", {
						className: "text-micro text-basic-muted px-2 pb-1",
						children: "Closes on Escape or a click outside. On a phone it becomes a bottom sheet instead."
					})] }),
					children: /* @__PURE__ */ X(z, {
						variant: B.Secondary,
						onClick: () => t((e) => !e),
						children: "Open popover"
					})
				}),
				/* @__PURE__ */ X(Yt, { value: "nac" }),
				/* @__PURE__ */ X(Bn, { keys: [
					"cmd",
					"shift",
					"k"
				] })
			]
		})
	});
}
// src/app/components/pages/design-preview/samples.ts
var mv = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
];
// src/app/components/pages/design-preview/SessionAvatarsSection.tsx
function hv() {
	return /* @__PURE__ */ X(aa, {
		title: "Session avatars",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [mv.map((e) => /* @__PURE__ */ Z("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ X(Uu, {
					id: e,
					size: 40
				}), /* @__PURE__ */ X("span", {
					className: "code code-small text-basic-muted",
					children: e
				})]
			}, e)), /* @__PURE__ */ Z("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ X(Za, {}), /* @__PURE__ */ X("span", {
					className: "code code-small text-basic-muted",
					children: "unassigned"
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/SessionIdentitySection.tsx
var gv = [
	za.Small,
	za.Medium,
	za.Large
], _v = [
	{
		label: "Default",
		className: "[&_path]:fill-btn-secondary"
	},
	{
		label: "Hovered",
		className: "[&_path]:fill-btn-secondary-hovered"
	},
	{
		label: "Pressed",
		className: "[&_path]:fill-btn-secondary-pressed"
	},
	{
		label: "Disabled",
		className: "[&_path]:fill-btn-secondary-disabled"
	}
], vv = [
	{
		label: "Default",
		sample: {}
	},
	{
		label: "Active",
		sample: { active: !0 }
	},
	{
		label: "Running",
		sample: { running: !0 }
	},
	{
		label: "Active, running",
		sample: {
			active: !0,
			running: !0
		}
	}
], yv = [
	{
		label: "Direct agent",
		sample: { behavior: "direct" }
	},
	{
		label: "Direct + NAC",
		sample: { behavior: "direct-with-orchestrator" }
	},
	{
		label: "Orchestrator",
		sample: { behavior: "orchestrator" }
	},
	{
		label: "Fork",
		sample: {
			behavior: "direct",
			forkedFromTitle: "Chat session 0"
		}
	},
	{
		label: "Unread",
		sample: {
			behavior: "direct",
			unread: !0
		}
	},
	{
		label: "Without NAC",
		sample: {
			behavior: "direct",
			showBehaviorIcon: !1
		}
	},
	{
		label: "Disabled",
		sample: {
			behavior: "direct",
			disabled: !0
		}
	}
], bv = () => {};
function xv() {
	return /* @__PURE__ */ Z("div", {
		className: "grid w-fit grid-cols-[200px_repeat(12,32px)] items-center gap-y-3",
		children: [
			/* @__PURE__ */ X("span", {}),
			_v.map((e) => /* @__PURE__ */ X("span", {
				className: "col-span-3 label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			Aa.map((e) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X("span", {
				className: "label-small truncate text-basic-secondary",
				children: e.label
			}), _v.flatMap((t) => gv.map((n) => /* @__PURE__ */ X("span", {
				className: I("flex items-center justify-center", t.className),
				children: /* @__PURE__ */ X(Va, {
					behavior: e.id,
					size: n
				})
			}, `${t.label}-${n}`)))] }, e.id))
		]
	});
}
function Sv({ isMobile: e }) {
	let t = /* @__PURE__ */ X(ih, {
		title: "Chat session 1",
		isMobile: e,
		onPin: bv,
		onRename: bv,
		onDelete: bv
	});
	return /* @__PURE__ */ Z("div", {
		className: I("grid w-fit items-center gap-x-4 gap-y-2", e ? "grid-cols-[120px_repeat(4,240px)]" : "grid-cols-[120px_repeat(4,200px)]"),
		children: [
			/* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: e ? "Mobile" : "Desktop"
			}),
			vv.map((e) => /* @__PURE__ */ X("span", {
				className: "label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			yv.map((n) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X("span", {
				className: "label-small text-basic-secondary",
				children: n.label
			}), vv.map((r) => /* @__PURE__ */ X(Ua, {
				title: "Chat session 1",
				showBehaviorIcon: !0,
				isMobile: e,
				actions: t,
				...n.sample,
				...r.sample
			}, r.label))] }, n.label))
		]
	});
}
function Cv() {
	return /* @__PURE__ */ X(aa, {
		title: "Project navigation",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ X(xv, {}),
				/* @__PURE__ */ Z("div", {
					className: "flex items-start gap-2",
					children: [
						/* @__PURE__ */ X($a, {
							title: "Fix the parser",
							behavior: "direct",
							showBehaviorIcon: !0,
							active: !0
						}),
						/* @__PURE__ */ X($a, {
							title: "Rewrite the store layer",
							behavior: "direct-with-orchestrator",
							showBehaviorIcon: !0
						}),
						/* @__PURE__ */ X($a, {
							title: "Investigating",
							behavior: "orchestrator",
							showBehaviorIcon: !0,
							running: !0
						}),
						/* @__PURE__ */ X($a, {
							title: "Without NAC",
							behavior: "direct"
						}),
						/* @__PURE__ */ X($a, {
							title: "Fork: Fix the parser",
							forkedFromTitle: "Fix the parser"
						}),
						/* @__PURE__ */ X($a, {
							title: "Fork running",
							forkedFromTitle: "Fix the parser",
							running: !0
						})
					]
				}),
				/* @__PURE__ */ X(Sv, { isMobile: !1 }),
				/* @__PURE__ */ X(Sv, { isMobile: !0 }),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-2 max-w-[320px]",
					children: [/* @__PURE__ */ X(Ll, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title"
					}), /* @__PURE__ */ X(Ll, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title",
						deleted: !0
					})]
				}),
				/* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-1 max-w-[320px]",
					children: [
						/* @__PURE__ */ X(Gu, {
							entityId: mv[3],
							name: "arcee-ai/nac",
							trailing: "4",
							active: !0
						}),
						/* @__PURE__ */ X(Gu, {
							entityId: mv[4],
							name: "arcee-ai/telos",
							trailing: "1",
							running: !0
						}),
						/* @__PURE__ */ X(Gu, {
							entityId: mv[5],
							name: "Unassigned session",
							variant: Wu.Orphan
						})
					]
				})
			]
		})
	});
}
var wv = {
	onOpen: () => {},
	sessionHref: "#/design"
}, Tv = [
	{
		label: "Ready · direct agent",
		card: {
			title: "Child session title",
			status: rd.Ready,
			behavior: "direct",
			...wv
		}
	},
	{
		label: "Ready · direct + NAC",
		card: {
			title: "Child session title",
			status: rd.Ready,
			behavior: "direct-with-orchestrator",
			...wv
		}
	},
	{
		label: "Ready · managed orchestrator",
		card: {
			title: "Child session title",
			status: rd.Ready,
			lineage: "managed-orchestrator",
			...wv
		}
	},
	{
		label: "Running",
		card: {
			title: "Child session title",
			status: rd.Running,
			behavior: "direct",
			...wv
		}
	},
	{
		label: "Failed",
		card: {
			title: "Child session title",
			status: rd.Failed,
			statusLabel: "Failed",
			behavior: "direct",
			...wv
		}
	},
	{
		label: "Failed · cancelled",
		card: {
			title: "Child session title",
			status: rd.Failed,
			statusLabel: "Cancelled",
			behavior: "direct",
			...wv
		}
	},
	{
		label: "Not found",
		card: {
			title: "Child session title",
			status: rd.NotFound,
			...wv
		}
	},
	{
		label: "Static",
		card: {
			title: "Child session title",
			status: rd.Ready,
			behavior: "direct"
		}
	}
], Ev = [{
	label: "NAC on",
	showBehaviorIcon: !0
}, {
	label: "NAC off",
	showBehaviorIcon: !1
}], Dv = "Investigate the flaky parser tests in the store layer";
function Ov() {
	return /* @__PURE__ */ X(aa, {
		title: "Subagent transcript card",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [/* @__PURE__ */ Z("div", {
				className: "grid w-fit grid-cols-[200px_repeat(2,320px)] items-center gap-x-4 gap-y-3",
				children: [
					/* @__PURE__ */ X("span", {}),
					Ev.map((e) => /* @__PURE__ */ X("span", {
						className: "label-micro text-basic-muted",
						children: e.label
					}, e.label)),
					Tv.map((e) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X("span", {
						className: "label-small text-basic-secondary",
						children: e.label
					}), Ev.map((t) => /* @__PURE__ */ X(cd, {
						showBehaviorIcon: t.showBehaviorIcon,
						...e.card
					}, t.label))] }, e.label))
				]
			}), /* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-2",
				children: [/* @__PURE__ */ X("span", {
					className: "label-micro text-basic-muted",
					children: "Narrow container · 240px"
				}), /* @__PURE__ */ Z("div", {
					className: "flex w-[240px] flex-col gap-3",
					children: [/* @__PURE__ */ X(cd, {
						title: Dv,
						status: rd.Ready,
						behavior: "direct",
						showBehaviorIcon: !0,
						...wv
					}), /* @__PURE__ */ X(cd, {
						title: Dv,
						status: rd.Failed,
						statusLabel: "Cancelled",
						behavior: "direct",
						showBehaviorIcon: !0,
						...wv
					})]
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/ToolsBadgeSection.tsx
var kv = [
	{
		caption: "Done",
		label: "Total activity: 12.3s",
		inProgress: !1,
		disabled: !1
	},
	{
		caption: "Done, disabled",
		label: "Total activity: 12.3s",
		inProgress: !1,
		disabled: !0
	},
	{
		caption: "In progress, disabled",
		label: "Thinking…",
		inProgress: !0,
		disabled: !0
	}
], Av = [
	{ label: "Thinking…" },
	{ label: "Searching the web…" },
	{
		label: "Fetching arcee.ai…",
		leadingIcon: H.Globe
	},
	{ label: "Reading index.tsx…" },
	{ label: "Creating index.tsx…" },
	{ label: "Editing index.tsx…" },
	{ label: "Finding files…" },
	{ label: "Searching files…" },
	{ label: "Running npm test…" },
	{ label: "Writing to terminal…" },
	{ label: "Reading command output…" },
	{ label: "Creating goal…" },
	{ label: "Getting goal…" },
	{ label: "Updating goal…" },
	{ label: "Spawning agent…" },
	{ label: "Spawning orchestrator…" },
	{ label: "Checking session status…" },
	{ label: "Steering session…" },
	{ label: "Reading session…" },
	{ label: "Waiting for session…" },
	{ label: "Deleting session…" },
	{ label: "Defining workset…" },
	{ label: "Deleting thread…" }
], jv = () => {};
function Mv() {
	return /* @__PURE__ */ X(aa, {
		title: "Tools and reasoning badge",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(2,auto)] items-center justify-items-start gap-x-10 gap-y-3",
			children: [
				/* @__PURE__ */ X("span", {}),
				/* @__PURE__ */ X("span", {
					className: "label-micro text-basic-muted",
					children: "Default"
				}),
				/* @__PURE__ */ X("span", {
					className: "label-micro text-basic-muted",
					children: "Selected"
				}),
				kv.map(({ caption: e, label: t, inProgress: n, disabled: r }) => /* @__PURE__ */ Z(ai, { children: [
					/* @__PURE__ */ X("span", {
						className: "label-small text-basic-secondary",
						children: e
					}),
					/* @__PURE__ */ X(vd, {
						label: t,
						inProgress: n,
						disabled: r,
						onClick: jv
					}),
					/* @__PURE__ */ X(vd, {
						label: t,
						inProgress: n,
						disabled: r,
						selected: !0,
						onClick: jv
					})
				] }, e)),
				Av.map(({ label: e, leadingIcon: t }, n) => /* @__PURE__ */ Z(ai, { children: [
					/* @__PURE__ */ X("span", {
						className: "label-small text-basic-secondary",
						children: n === 0 ? "In progress" : null
					}),
					/* @__PURE__ */ X(vd, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						onClick: jv
					}),
					/* @__PURE__ */ X(vd, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						selected: !0,
						onClick: jv
					})
				] }, e))
			]
		})
	});
}
// src/app/components/pages/design-preview/TypographySection.tsx
function Nv() {
	return /* @__PURE__ */ X(aa, {
		title: "Typography",
		children: /* @__PURE__ */ Z("div", {
			className: "p-4 flex flex-col gap-2",
			children: [
				/* @__PURE__ */ X("div", {
					className: "title",
					children: "Title"
				}),
				/* @__PURE__ */ X("div", {
					className: "header-medium",
					children: "Header medium"
				}),
				/* @__PURE__ */ X("div", {
					className: "label-small text-basic-secondary",
					children: "Label small"
				}),
				/* @__PURE__ */ X("div", {
					className: "paragraph-medium text-basic-secondary",
					children: "Paragraph medium on the secondary text token."
				}),
				/* @__PURE__ */ X("div", {
					className: "code code-small text-basic-muted",
					children: "code-small / IBM Plex Mono"
				})
			]
		})
	});
}
// src/app/components/pages/DesignPreviewPage.tsx
function Pv() {
	let [e, t] = J(!1);
	return /* @__PURE__ */ Z("div", {
		className: "h-full overflow-y-auto bg-elevation-ground text-basic-primary",
		children: [
			/* @__PURE__ */ Z("header", {
				className: "flex items-center gap-4 h-14 px-6 border-b border-secondary",
				children: [/* @__PURE__ */ X(mu, { height: 18 }), /* @__PURE__ */ X("span", {
					className: "text-basic-muted label-small",
					children: "design system"
				})]
			}),
			/* @__PURE__ */ Z("main", {
				className: "p-6 flex flex-col gap-6 max-w-[1100px]",
				children: [
					/* @__PURE__ */ X(Vg, {}),
					/* @__PURE__ */ X(Tg, {}),
					/* @__PURE__ */ X(y_, { onOpenModal: () => t(!0) }),
					/* @__PURE__ */ X(pv, {}),
					/* @__PURE__ */ X(Wg, {}),
					/* @__PURE__ */ X(dv, {}),
					/* @__PURE__ */ X(hv, {}),
					/* @__PURE__ */ X(Cv, {}),
					/* @__PURE__ */ X(uv, {}),
					/* @__PURE__ */ X(Mv, {}),
					/* @__PURE__ */ X(ov, {}),
					/* @__PURE__ */ X(__, {}),
					/* @__PURE__ */ X(Ov, {}),
					/* @__PURE__ */ X(wg, {}),
					/* @__PURE__ */ X(fv, {}),
					/* @__PURE__ */ X(qg, {}),
					/* @__PURE__ */ X(Kg, {}),
					/* @__PURE__ */ X(Nv, {})
				]
			}),
			/* @__PURE__ */ X(Xn, {
				open: e,
				onClose: () => t(!1),
				title: "Delete session",
				footer: /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(z, {
					variant: B.Secondary,
					onClick: () => t(!1),
					children: "Cancel"
				}), /* @__PURE__ */ X(z, {
					variant: B.SecondaryDestructive,
					onClick: () => t(!1),
					children: "Delete"
				})] }),
				children: "This is the shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom."
			})
		]
	});
}
// src/app/components/pages/ProjectRedirectPage.tsx
var Fv = /* @__PURE__ */ new Map();
function Iv() {
	let { projectId: e = "" } = Mi(), t = Em(), n = Tt(), r = _t(), i = Zn(), [a, o] = J(null), s = r.refetch, c = i.refetch;
	G(() => {
		let t = !0;
		return Promise.all([s(), c()]).then(([n, r]) => {
			t && n.isSuccess && r.isSuccess && o(e);
		}).catch(() => void 0), () => {
			t = !1;
		};
	}, [
		e,
		s,
		c
	]);
	let l = K(() => r.data?.projects.find((t) => t.project_id === e) ?? null, [r.data, e]), u = K(() => Td(cn(n, i.data ?? []), e), [
		i.data,
		e,
		n
	]), d = r.isLoading || i.isLoading, f = r.isFetching || i.isFetching, p = r.isError || i.isError, m = r.isSuccess && i.isSuccess, h = a === e && !d && !f && !p && m && l != null && u == null, g = t.newChat;
	G(() => {
		if (!h) return;
		let t = Fv.get(e);
		t || (t = g(e, Ke(n, i.data ?? [], e)).finally(() => {
			Fv.delete(e);
		}), Fv.set(e, t));
	}, [
		h,
		g,
		e,
		n,
		i.data
	]);
	let _ = a === e;
	return _ && !d && !l ? /* @__PURE__ */ X(wi, {
		to: fn.list(),
		replace: !0
	}) : _ && u ? /* @__PURE__ */ X(wi, {
		to: fn.session(u.summary.session_id),
		replace: !0
	}) : /* @__PURE__ */ X("div", {
		className: "flex h-full items-center justify-center",
		children: /* @__PURE__ */ X(ut, { size: bt.Large })
	});
}
// src/app/components/projects/ProjectCardActions.tsx
function Lv({ title: e, icon: t, onClick: n, variant: r = B.Ghost, disabled: i = !1 }) {
	return /* @__PURE__ */ X(E, {
		title: e,
		position: M.TopCenter,
		sticky: !0,
		children: /* @__PURE__ */ X(z, {
			variant: r,
			size: U.Small,
			content: g.Icon,
			"aria-label": e,
			disabled: i,
			onClick: (e) => {
				e.stopPropagation(), n();
			},
			children: /* @__PURE__ */ X(R, { iconName: t })
		})
	});
}
function Rv({ orphan: e, pinned: t, onDelete: n, onTogglePin: r, onRename: i, onAssign: a, reorder: o }) {
	return /* @__PURE__ */ Z("div", {
		className: o ? "flex items-center gap-1.5 shrink-0" : "flex items-center gap-4 xl:gap-1.5 shrink-0",
		children: [o ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(Lv, {
			title: "Move down",
			icon: H.ArrowDown,
			disabled: !o.canMoveDown,
			onClick: o.onMoveDown
		}), /* @__PURE__ */ X(Lv, {
			title: "Move up",
			icon: H.ArrowTop,
			disabled: !o.canMoveUp,
			onClick: o.onMoveUp
		})] }) : null, e ? /* @__PURE__ */ Z(Y, { children: [
			i ? /* @__PURE__ */ X(Lv, {
				title: "Edit",
				icon: H.Edit,
				onClick: i
			}) : null,
			a ? /* @__PURE__ */ X(Lv, {
				title: "Assign to project",
				icon: H.FolderOpen,
				onClick: a
			}) : null,
			/* @__PURE__ */ X(Lv, {
				title: "Delete chat",
				icon: H.Trash,
				variant: B.GhostDestructive,
				onClick: n
			})
		] }) : /* @__PURE__ */ Z(Y, { children: [
			r ? /* @__PURE__ */ X(Lv, {
				title: t ? "Unpin project" : "Pin project",
				icon: t ? H.Unpin : H.Pin,
				onClick: r
			}) : null,
			i ? /* @__PURE__ */ X(Lv, {
				title: "Rename project",
				icon: H.Edit,
				onClick: i
			}) : null,
			/* @__PURE__ */ X(Lv, {
				title: "Remove project",
				icon: H.Trash,
				variant: B.GhostDestructive,
				onClick: n
			})
		] })]
	});
}
// src/app/components/projects/ProjectCard.tsx
var zv = {
	default: "--color-bg-btn-ghost",
	hovered: "--color-bg-btn-ghost-hovered",
	pressed: "--color-bg-btn-ghost-pressed",
	highlighted: "--color-bg-btn-ghost-highlighted",
	highlightedHovered: "--color-bg-btn-ghost-highlighted-hovered",
	highlightedPressed: "--color-bg-btn-ghost-highlighted-pressed"
};
function Bv({ highlighted: e, hover: t, pressed: n }) {
	return n ? e ? zv.highlightedPressed : zv.pressed : t ? e ? zv.highlightedHovered : zv.hovered : e ? zv.highlighted : zv.default;
}
function Vv(e, t) {
	if (e.kind === "project") {
		let { project: t, sessions: n, running: r, totalCostMicros: i } = e.entry, a = n.find((e) => y(e.active_run));
		return {
			id: t.project_id,
			orphan: !1,
			title: t.name,
			cwd: t.cwd,
			pinned: t.pinned,
			running: r > 0,
			costMicros: i,
			countLabel: `${n.length} ${n.length === 1 ? "Session" : "Sessions"}`,
			runningCount: r,
			representative: a?.summary ?? n[0]?.summary ?? null
		};
	}
	let { summary: n, active_run: r } = e.session, i = y(r);
	return {
		id: n.session_id,
		orphan: !0,
		title: t(n),
		cwd: n.cwd,
		pinned: !1,
		running: i,
		costMicros: n.total_cost_micros ?? 0,
		countLabel: null,
		runningCount: +!!i,
		representative: n
	};
}
function Hv({ facts: e }) {
	let t = e.costMicros > 0 ? et(e.costMicros) : null;
	return /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-2.5 shrink-0 min-w-0",
		children: [t ? /* @__PURE__ */ X("span", {
			className: "text-micro text-basic-primary whitespace-nowrap",
			children: t
		}) : null, e.countLabel ? /* @__PURE__ */ X("span", {
			className: "text-micro text-info-primary whitespace-nowrap truncate",
			children: e.countLabel
		}) : null]
	});
}
function Uv({ facts: e }) {
	let t = rn(e.representative?.backend);
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-wrap items-center gap-2.5 min-w-0 whitespace-nowrap",
		children: [/* @__PURE__ */ X("span", {
			className: "label-micro text-basic-tertiary",
			children: Nn(e.representative)
		}), t ? /* @__PURE__ */ X("span", {
			className: "text-micro text-basic-muted truncate md:max-w-[128px]",
			children: t
		}) : null]
	});
}
function Wv({ getCardElement: e, onReorderStart: t }) {
	return /* @__PURE__ */ Z("button", {
		type: "button",
		"aria-label": "Drag to reorder",
		className: I("absolute right-1.5 top-1/2 z-1 -translate-y-1/2", "flex h-6 items-center gap-[3px]", "cursor-grab active:cursor-grabbing touch-none", "rounded-sm border-0 bg-transparent p-0"),
		onClick: (e) => e.stopPropagation(),
		onPointerDown: (n) => {
			if (n.button !== 0) return;
			n.preventDefault(), n.stopPropagation();
			let r = e();
			if (!r) return;
			let i = r.getBoundingClientRect();
			n.currentTarget.setPointerCapture(n.pointerId), t({
				itemId: r.dataset.itemId ?? "",
				kind: r.dataset.itemKind === "orphan" ? "orphan" : "project",
				pinned: r.dataset.itemPinned === "true",
				clientX: n.clientX,
				clientY: n.clientY,
				offsetX: n.clientX - i.left,
				offsetY: n.clientY - i.top,
				width: i.width,
				height: i.height
			});
		},
		children: [/* @__PURE__ */ X("span", { className: "h-full w-px rounded-[2px] bg-divider-primary" }), /* @__PURE__ */ X("span", { className: "h-full w-px rounded-[2px] bg-divider-primary" })]
	});
}
function Gv({ item: e, selected: t, attention: n, onOpen: r, onDelete: i, onTogglePin: a, onRename: o, onAssign: s, reorder: c, dragging: l = !1 }) {
	let u = Vv(e, xd()), d = u.representative?.model_config_error, f = N(), p = A(), [m, h] = J(!1), [g, _] = J(!1), [v, y] = J(!1), b = q(!1), x = q(null), S = !p || m || g || t, C = !!c && p, w = !!c && !p, T = p && m, D = () => {
		b.current ? b.current = !1 : r();
	};
	return /* @__PURE__ */ Z("div", {
		ref: x,
		"data-item-id": u.id,
		"data-item-kind": u.orphan ? "orphan" : "project",
		"data-item-pinned": u.pinned ? "true" : "false",
		className: I("group fade relative flex flex-col rounded-[8px] overflow-hidden cursor-default", f ? "gap-4 px-4 pt-4 pb-2" : "gap-4 px-6 pt-5 pb-3", "shadow-convex bg-elevation-level-1", l && "shadow-lg"),
		role: "button",
		tabIndex: 0,
		"aria-pressed": t,
		onClick: D,
		onKeyDown: (e) => {
			e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), D());
		},
		onMouseEnter: () => {
			p && h(!0);
		},
		onMouseLeave: () => {
			h(!1), y(!1);
		},
		onFocus: () => _(!0),
		onBlur: () => _(!1),
		onPointerDown: (e) => {
			e.button === 0 && !e.target.closest("button, a, input, textarea") && y(!0);
		},
		onPointerUp: () => y(!1),
		onPointerCancel: () => y(!1),
		children: [
			/* @__PURE__ */ X("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none ease-out",
				style: { backgroundColor: `var(${Bv({
					highlighted: u.running,
					hover: T,
					pressed: v
				})})` }
			}),
			t || g || l ? /* @__PURE__ */ X("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none border-2",
				style: { borderColor: "var(--blue-500)" }
			}) : null,
			n ? /* @__PURE__ */ X(E, {
				title: "Run finished",
				position: M.BottomLeft,
				sticky: !0,
				className: "absolute left-2 top-2 z-1",
				children: /* @__PURE__ */ X("span", { className: "block size-2 rounded-full bg-accent-primary" })
			}) : null,
			C && c ? /* @__PURE__ */ X(Wv, {
				getCardElement: () => x.current,
				onReorderStart: (e) => {
					b.current = !0, c.onReorderStart(e), window.setTimeout(() => {
						b.current = !1;
					}, 100);
				}
			}) : null,
			/* @__PURE__ */ Z("div", {
				className: "relative flex items-center gap-4 w-full",
				children: [u.orphan ? /* @__PURE__ */ X(Za, { isRunning: u.running }) : /* @__PURE__ */ X(Uu, {
					id: u.id,
					size: 40,
					isRunning: u.running
				}), /* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-0.5 flex-1 min-w-0",
					children: [/* @__PURE__ */ Z("div", {
						className: "flex items-center gap-1.5 w-full",
						children: [
							u.pinned ? /* @__PURE__ */ X(R, {
								iconName: H.Pin,
								className: "text-basic-secondary shrink-0"
							}) : null,
							/* @__PURE__ */ X("div", {
								className: I("header-md flex-1 min-w-0 truncate", u.running ? "text-shimmer-basic" : "text-basic-primary"),
								children: u.title
							}),
							d ? /* @__PURE__ */ X(E, {
								title: d,
								position: M.BottomRight,
								sticky: !0,
								children: /* @__PURE__ */ X(R, {
									iconName: H.Repair,
									className: "text-error-primary shrink-0"
								})
							}) : null,
							u.running ? u.orphan ? /* @__PURE__ */ X(ut, {
								size: bt.XSmall,
								className: "shrink-0"
							}) : /* @__PURE__ */ Z("div", {
								className: "flex items-center gap-1 shrink-0",
								children: [/* @__PURE__ */ X(ut, { size: bt.XSmall }), /* @__PURE__ */ Z("span", {
									className: "text-micro text-basic-primary whitespace-nowrap",
									children: [u.runningCount, " Running"]
								})]
							}) : null
						]
					}), /* @__PURE__ */ X("div", {
						className: "code code-micro text-basic-tertiary truncate w-full",
						children: u.cwd
					})]
				})]
			}),
			p ? null : /* @__PURE__ */ X(Uv, { facts: u }),
			/* @__PURE__ */ Z("div", {
				className: "relative flex items-center justify-between w-full h-6 gap-2",
				children: [/* @__PURE__ */ X(Hv, { facts: u }), S ? /* @__PURE__ */ X(Rv, {
					orphan: u.orphan,
					pinned: u.pinned,
					onTogglePin: a,
					onRename: o,
					onDelete: i,
					onAssign: s,
					reorder: w && c ? {
						canMoveUp: c.canMoveUp,
						canMoveDown: c.canMoveDown,
						onMoveUp: c.onMoveUp,
						onMoveDown: c.onMoveDown
					} : void 0
				}) : /* @__PURE__ */ X(Uv, { facts: u })]
			})
		]
	});
}
// src/app/components/projects/ProjectsEmptyState.tsx
function Kv({ onStart: e, onAddRepository: t, onManagedSettings: n, modelReady: r, githubConnected: i, mobile: a }) {
	let o = t != null;
	return /* @__PURE__ */ X("div", {
		className: I("flex h-full flex-col items-center justify-center py-16", a ? "px-4" : "px-6"),
		children: /* @__PURE__ */ Z("div", {
			className: "flex w-[420px] max-w-full flex-col items-center gap-6",
			children: [
				/* @__PURE__ */ X($u, {}),
				/* @__PURE__ */ Z("div", {
					className: "w-full text-center",
					children: [/* @__PURE__ */ X("p", {
						className: "header-2xl text-basic-primary",
						children: "No projects yet"
					}), /* @__PURE__ */ X("p", {
						className: "text-medium text-basic-tertiary",
						children: o ? "Connect a repository or create a Project from an existing path." : "Create your first and start building!"
					})]
				}),
				o ? /* @__PURE__ */ Z("div", {
					className: "grid w-full grid-cols-1 gap-2 rounded-lg border border-basic p-4 text-left sm:grid-cols-3",
					"data-testid": "managed-empty-status",
					children: [
						/* @__PURE__ */ X(qv, {
							label: "Arcee model",
							value: r ? "Ready" : "Needs attention",
							ready: !!r
						}),
						/* @__PURE__ */ X(qv, {
							label: "GitHub",
							value: i ? "Connected" : "Not connected",
							ready: !!i
						}),
						/* @__PURE__ */ X(qv, {
							label: "Projects",
							value: "None",
							ready: !1
						})
					]
				}) : null,
				/* @__PURE__ */ Z("div", {
					className: "flex flex-wrap justify-center gap-2",
					children: [
						/* @__PURE__ */ X(z, {
							variant: B.Primary,
							size: U.Large,
							content: g.Text,
							onClick: o ? t : e,
							children: o ? "Add repository" : "Get Started"
						}),
						o ? /* @__PURE__ */ X(z, {
							variant: B.Secondary,
							size: U.Large,
							content: g.Text,
							onClick: e,
							children: "Create Project"
						}) : null,
						o && !i && n ? /* @__PURE__ */ X(z, {
							variant: B.Tertiary,
							size: U.Large,
							content: g.Text,
							onClick: n,
							children: "Connect GitHub"
						}) : null
					]
				})
			]
		})
	});
}
function qv({ label: e, value: t, ready: n }) {
	return /* @__PURE__ */ Z("div", {
		className: "min-w-0",
		children: [/* @__PURE__ */ X("p", {
			className: "text-small text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ X("p", {
			className: `label-small ${n ? "text-success-primary" : "text-basic-primary"}`,
			children: t
		})]
	});
}
// src/app/components/pages/ProjectsListPage.tsx
function Jv({ children: e, single: t }) {
	return /* @__PURE__ */ X("div", {
		className: I("grid gap-2", t ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]"),
		children: e
	});
}
function Yv() {
	return /* @__PURE__ */ X("div", {
		"aria-hidden": !0,
		className: "min-h-[112px] rounded-[8px] border-2",
		style: { borderColor: "var(--blue-500)" }
	});
}
function Xv(e) {
	return e.kind === "project" ? e.entry.sessions.map((e) => e.summary.session_id) : [e.session.summary.session_id];
}
function Zv(e) {
	return e.kind === "project" && e.entry.project.pinned;
}
function Qv({ item: e, onOpen: t, reorderable: n, dragging: r, canMoveUp: i, canMoveDown: a, onMoveUp: o, onMoveDown: s, onReorderStart: c }) {
	let { useAnyAttention: l } = V().stores.attentionStore, u = Em(), d = Bm(), f = {
		item: e,
		selected: !1,
		attention: l(Xv(e)),
		dragging: r,
		onOpen: () => t(e),
		reorder: n ? {
			canMoveUp: i,
			canMoveDown: a,
			onMoveUp: o,
			onMoveDown: s,
			onReorderStart: c
		} : void 0
	};
	if (e.kind === "project") {
		let { project: t } = e.entry;
		return /* @__PURE__ */ X(Gv, {
			...f,
			onTogglePin: () => void u.togglePin(t),
			onRename: () => u.rename(t),
			onDelete: () => u.remove(t)
		});
	}
	let { summary: p } = e.session;
	return /* @__PURE__ */ X(Gv, {
		...f,
		onRename: () => d.rename(p),
		onDelete: () => d.remove(p),
		onAssign: () => u.assign(p)
	});
}
function $v(e, t, n, r) {
	let i = document.elementsFromPoint(e, t);
	for (let t of i) {
		if (!(t instanceof HTMLElement)) continue;
		if (t.dataset.pinDropZone === "true") {
			if (r !== "project") continue;
			return "pin-zone";
		}
		let i = t.closest("[data-item-id]");
		if (!i) continue;
		let a = i.dataset.itemId;
		if (!a || a === n || i.dataset.dragging === "true") continue;
		let o = i.getBoundingClientRect(), s = e < o.left + o.width / 2 ? "before" : "after";
		if (r === "orphan" && i.dataset.itemKind === "project" || i.dataset.itemKind === r) return {
			itemId: a,
			edge: s
		};
	}
	return null;
}
function ey(e, t) {
	return e.filter((e) => e.pinned === t).sort((e, t) => e.sort_order - t.sort_order);
}
function ty() {
	let { useVisibleProjectItems: e, useIsDefaultSort: t, useFilterQuery: n, setQuery: r } = V().stores.sessionFiltersStore, { trackAttention: i, clearAttentionAll: a } = V().stores.attentionStore, o = ji(), s = N(), c = Em(), l = th(), u = nr(), d = n(), f = t(), p = st(), m = tn(), [h, _] = J(null), [v, y] = J(null), [b, x] = J(!1), S = q(null), C = q(null), w = q(!1), { data: T, isLoading: E, error: D, refetch: O } = En(), k = _t(), ee = Tt(), A = K(() => cn(ee, T ?? []), [T, ee]), te = K(() => k.data?.projects ?? [], [k.data]), j = K(() => Ad(te, A), [te, A]), ne = e(j);
	G(() => {
		T && i(T, null);
	}, [T, i]), G(() => {
		s && d && r("");
	}, [
		s,
		d,
		r
	]);
	let re = (e) => {
		let t = kd(e);
		a(Xv(e)), o(e.kind === "project" ? fn.project(t) : fn.session(t));
	}, ie = ne.filter(Zv), ae = ne.filter((e) => e.kind === "project" && !Zv(e)), oe = ne.filter((e) => e.kind === "orphan"), se = K(() => ey(te, !0), [te]), ce = K(() => ey(te, !1), [te]), M = K(() => Od(A), [A]), le = K(() => In(A, !1), [A]), ue = W(() => {
		S.current = null, C.current = null, w.current = !1, _(null), y(null), x(!1);
	}, []), de = W(async (e, t, n) => {
		let r = ey(te, t).findIndex((t) => t.project_id === e), i = te.find((t) => t.project_id === e);
		if (i && i.pinned === t && r === n) ue();
		else try {
			await p.mutateAsync({
				projects: te,
				projectId: e,
				targetPinned: t,
				targetIndex: n
			});
		} catch (e) {
			u.error(`Failed to reorder projects: ${Vt(Ud(e))}`);
		} finally {
			ue();
		}
	}, [
		te,
		ue,
		p,
		u
	]), fe = W(async (e, t) => {
		try {
			await m.mutateAsync({
				sessions: A,
				sessionId: e,
				targetPinned: !1,
				targetIndex: t
			});
		} catch (e) {
			u.error(`Failed to reorder chats: ${Vt(Ud(e))}`);
		} finally {
			ue();
		}
	}, [
		A,
		ue,
		m,
		u
	]), pe = W(async (e, t) => {
		let n = A.find((t) => t.summary.session_id === e), r = te.find((e) => e.project_id === t);
		if (!n || !r) ue();
		else if (Pd(te, n.summary)?.project_id !== r.project_id) u.error("That chat does not run in this project's location"), ue();
		else try {
			c.assign(n.summary);
		} finally {
			ue();
		}
	}, [
		A,
		ue,
		c,
		te,
		u
	]), P = W((e, t) => {
		let n = e.pinned ? se : ce, r = n.findIndex((t) => t.project_id === e.project_id);
		if (r < 0) return;
		let i = r + t;
		i < 0 || i >= n.length || de(e.project_id, e.pinned, i);
	}, [
		se,
		ce,
		de
	]), me = W((e, t) => {
		let n = M.findIndex((t) => t.summary.session_id === e), r = n < 0 ? void 0 : M[n + t];
		if (!r) return;
		let i = Oe(le, r.summary.session_id, t === -1 ? "before" : "after", e);
		fe(e, i);
	}, [
		M,
		le,
		fe
	]), F = W((e, t, n) => {
		if (t === "orphan") {
			let t = te.find((e) => e.project_id === n.itemId);
			if (t) {
				pe(e, t.project_id);
				return;
			}
			if (n.itemId === e) {
				ue();
				return;
			}
			let r = Oe(le, n.itemId, n.edge, e);
			fe(e, r);
			return;
		}
		let r = te.find((e) => e.project_id === n.itemId);
		if (!r || n.itemId === e) {
			ue();
			return;
		}
		let i = ey(te, r.pinned).map((e) => e.project_id).filter((t) => t !== e).indexOf(n.itemId);
		i < 0 ? ue() : de(e, r.pinned, n.edge === "before" ? i : i + 1);
	}, [
		pe,
		ue,
		le,
		fe,
		de,
		te
	]), he = W((e) => {
		if (!e.itemId) return;
		let t = {
			itemId: e.itemId,
			kind: e.kind,
			offsetX: e.offsetX,
			offsetY: e.offsetY,
			width: e.width,
			height: e.height,
			x: e.clientX - e.offsetX,
			y: e.clientY - e.offsetY
		};
		S.current = t, _(t);
	}, []);
	G(() => {
		if (!h) return;
		let e = (e) => {
			let t = S.current;
			if (!t) return;
			let n = {
				...t,
				x: e.clientX - t.offsetX,
				y: e.clientY - t.offsetY
			};
			S.current = n, _(n);
			let r = $v(e.clientX, e.clientY, t.itemId, t.kind);
			r === "pin-zone" ? (w.current = !0, C.current = null, x(!0), y(null)) : (w.current = !1, x(!1), r && (C.current = r, y((e) => e?.itemId === r.itemId && e.edge === r.edge ? e : r)));
		}, t = () => {
			let e = S.current;
			if (!e) {
				ue();
				return;
			}
			if (w.current && e.kind === "project") {
				de(e.itemId, !0, 0);
				return;
			}
			let t = C.current;
			t ? F(e.itemId, e.kind, t) : ue();
		};
		return window.addEventListener("pointermove", e), window.addEventListener("pointerup", t), window.addEventListener("pointercancel", t), () => {
			window.removeEventListener("pointermove", e), window.removeEventListener("pointerup", t), window.removeEventListener("pointercancel", t);
		};
	}, [
		F,
		ue,
		h,
		de
	]);
	let ge = (e) => {
		let t = kd(e), n = e.kind === "project" ? e.entry.project : null, r = n ? n.pinned ? se : ce : [], i = n ? r.findIndex((e) => e.project_id === n.project_id) : -1, a = e.kind === "orphan" ? M.findIndex((e) => e.summary.session_id === t) : -1, o = n ? i : a, s = n ? r.length : M.length, c = h?.itemId === t, l = !c && v?.itemId === t ? v.edge : null;
		return /* @__PURE__ */ Z(ai, { children: [
			l === "before" ? /* @__PURE__ */ X(Yv, {}) : null,
			/* @__PURE__ */ X("div", {
				"data-item-id": t,
				"data-item-kind": e.kind,
				"data-dragging": c ? "true" : void 0,
				className: "relative",
				style: c && h ? {
					position: "fixed",
					left: h.x,
					top: h.y,
					width: h.width,
					zIndex: 50,
					pointerEvents: "none",
					margin: 0
				} : void 0,
				children: /* @__PURE__ */ X(Qv, {
					item: e,
					onOpen: re,
					reorderable: f,
					dragging: c,
					canMoveUp: o > 0,
					canMoveDown: o >= 0 && o < s - 1,
					onMoveUp: () => {
						n ? P(n, -1) : e.kind === "orphan" && me(t, -1);
					},
					onMoveDown: () => {
						n ? P(n, 1) : e.kind === "orphan" && me(t, 1);
					},
					onReorderStart: he
				})
			}),
			l === "after" ? /* @__PURE__ */ X(Yv, {}) : null
		] }, t);
	};
	if (!E && !D && j.length === 0) return /* @__PURE__ */ Z("div", {
		className: "flex h-full min-h-0",
		children: [s ? null : /* @__PURE__ */ X(Cg, { variant: "projects" }), /* @__PURE__ */ X("div", {
			className: "min-h-0 min-w-0 flex-1",
			children: /* @__PURE__ */ X(Kv, {
				mobile: s,
				onStart: c.create,
				onAddRepository: l.isManaged ? l.addRepository : void 0,
				onManagedSettings: l.isManaged ? l.openSettings : void 0,
				modelReady: l.status?.model_ready,
				githubConnected: l.status?.github_status === "connected"
			})
		})]
	});
	let _e = f && h != null && h.kind === "project" && ie.length === 0 && !te.find((e) => e.project_id === h.itemId)?.pinned;
	return /* @__PURE__ */ Z("div", {
		className: "flex h-full min-h-0",
		children: [s ? null : /* @__PURE__ */ X(Cg, { variant: "projects" }), /* @__PURE__ */ X("div", {
			className: I("flex-1 min-h-0 overflow-auto", s ? "px-2" : "px-8", h && "select-none cursor-grabbing"),
			children: /* @__PURE__ */ Z("div", {
				className: I("flex flex-col gap-6 [&>*]:shrink-0", s ? "pt-18 pb-8" : "py-4"),
				children: [
					D ? /* @__PURE__ */ Z("div", {
						className: "flex items-center gap-2 label-small text-error-primary",
						children: [/* @__PURE__ */ X("span", { children: Vt(D) }), /* @__PURE__ */ X(z, {
							variant: B.Ghost,
							size: U.Small,
							content: g.Text,
							onClick: () => {
								O();
							},
							children: "Try again"
						})]
					}) : null,
					!E && !D && ne.length === 0 ? /* @__PURE__ */ X("div", {
						className: "label-small text-basic-muted text-center py-16",
						children: "No projects match the current filters."
					}) : null,
					ie.length > 0 || _e ? /* @__PURE__ */ Z(Jv, {
						single: s,
						children: [ie.map(ge), _e ? /* @__PURE__ */ X("div", {
							"data-pin-drop-zone": "true",
							className: I("min-h-[112px] rounded-[8px] border-2 border-dashed", b && "bg-info-primary/10"),
							style: { borderColor: "var(--blue-500)" }
						}) : null]
					}) : null,
					ae.length > 0 ? /* @__PURE__ */ X(Jv, {
						single: s,
						children: ae.map(ge)
					}) : null,
					oe.length > 0 ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(yd, { children: "Unassigned chat sessions" }), /* @__PURE__ */ X(Jv, {
						single: s,
						children: oe.map(ge)
					})] }) : null
				]
			})
		})]
	});
}
// src/app/features/insights/useInsightsNavigation.ts
var ny = "insights-detail", ry = si({
	sessionId: "",
	panels: [],
	focusPanel: () => {},
	detailFocusRef: { current: null }
});
function iy() {
	let { sessionId: e, panels: t, focusPanel: n, detailFocusRef: r } = di(ry), { sessionLayoutStore: i, selectInsightsFilter: a, selectInsight: o, selectThread: s, selectSubagent: c, selectWorkset: l, selectRevision: u, selectFileListing: d, selectFile: f } = V().stores.sessionLayoutStore;
	return K(() => {
		let p = (e, r) => {
			t.includes(e) && (r(), n(e));
		}, m = (e) => {
			let t = i.getState().insightsFilter;
			t !== "all" && t !== e && a("all");
		}, h = (e, t) => {
			r.current = t?.focusDetail ? e : null, o(e);
		};
		return {
			openGroup: (e, t, n) => p("insights", () => {
				m("tools"), h({
					kind: "group",
					groupId: e,
					segmentKey: t ?? null
				}, n);
			}),
			openThread: (e, t, n) => p("insights", () => {
				m("threads"), s(e, t ?? null), h({ kind: "thread" }, n);
			}),
			openSubagent: (t) => p("delegated", () => c(e, t)),
			openWorkset: (e) => p("worksets", () => l(e)),
			openFile: (e) => p("files", () => {
				u(null), d("tree"), f(e);
			})
		};
	}, [
		e,
		t,
		n,
		r,
		i,
		a,
		o,
		s,
		c,
		l,
		u,
		d,
		f
	]);
}
function ay(e, t) {
	let { detailFocusRef: n } = di(ry), r = q(null);
	return G(() => {
		if (!t || !e || n.current !== e) return;
		let i = requestAnimationFrame(() => {
			let t = r.current;
			t && n.current === e && (n.current = null, t.focus({ preventScroll: !0 }));
		});
		return () => cancelAnimationFrame(i);
	}, [
		n,
		e,
		t
	]), r;
}
// src/app/features/insights/InsightsNavigationProvider.tsx
function oy({ sessionId: e, panels: t, focusPanel: n, children: r }) {
	let i = q(n);
	pi(() => {
		i.current = n;
	});
	let a = q(null), o = K(() => ({
		sessionId: e,
		panels: t,
		focusPanel: (e) => i.current(e),
		detailFocusRef: a
	}), [e, t]);
	return /* @__PURE__ */ X(ry.Provider, {
		value: o,
		children: r
	});
}
// src/app/features/terminal-selection/TerminalSelectionAttachment.tsx
function sy({ evidence: e, canonicalText: t, sessionId: n }) {
	let r = fi(), i = e.attribution, a = n != null && i.source_session_id !== n;
	return /* @__PURE__ */ Z("section", {
		"aria-labelledby": `${r}-title`,
		className: "w-full min-w-0 max-w-full rounded-lg border border-border-primary p-3 text-small text-basic-primary",
		children: [
			/* @__PURE__ */ X("h3", {
				id: `${r}-title`,
				className: "font-medium",
				children: "Terminal selection"
			}),
			/* @__PURE__ */ Z("p", {
				className: "text-basic-secondary mt-1",
				children: ["Reviewed rendered text · frozen capture. Live source availability is not checked.", a ? " Original source from another chat; no live access is granted." : ""]
			}),
			/* @__PURE__ */ X("pre", {
				"aria-label": "Attached terminal output",
				tabIndex: 0,
				className: "mt-3 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3 font-mono",
				children: e.text
			}),
			e.user_text == null ? null : /* @__PURE__ */ Z("div", {
				className: "mt-3",
				children: [/* @__PURE__ */ X("span", {
					className: "text-basic-secondary",
					children: "Accompanying message"
				}), /* @__PURE__ */ X("pre", {
					"aria-label": "Attached accompanying message",
					tabIndex: 0,
					className: "mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans",
					children: e.user_text
				})]
			}),
			/* @__PURE__ */ Z("details", {
				className: "mt-3",
				children: [
					/* @__PURE__ */ X("summary", {
						className: "cursor-pointer",
						children: "Source and capture details"
					}),
					/* @__PURE__ */ Z("dl", {
						className: "mt-2 break-all",
						children: [
							/* @__PURE__ */ X("dt", { children: "Source chat" }),
							/* @__PURE__ */ X("dd", { children: i.source_session_id }),
							/* @__PURE__ */ X("dt", { children: "Terminal" }),
							/* @__PURE__ */ X("dd", { children: i.terminal_id }),
							/* @__PURE__ */ X("dt", { children: "Process owner" }),
							/* @__PURE__ */ X("dd", { children: i.owner_instance_id }),
							/* @__PURE__ */ X("dt", { children: "Capture" }),
							/* @__PURE__ */ X("dd", { children: i.capture_id }),
							i.client_capture_time_ms == null ? null : /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("dt", { children: "Client capture time (client supplied, epoch ms)" }), /* @__PURE__ */ X("dd", { children: i.client_capture_time_ms })] }),
							/* @__PURE__ */ X("dt", { children: "Submission" }),
							/* @__PURE__ */ X("dd", { children: i.admission_id })
						]
					}),
					/* @__PURE__ */ X("p", {
						className: "mt-2 text-basic-secondary",
						children: "This evidence remains readable after the source exits or expires. It grants no terminal control."
					})
				]
			}),
			/* @__PURE__ */ Z("details", {
				className: "mt-3",
				children: [/* @__PURE__ */ X("summary", {
					className: "cursor-pointer",
					children: "Canonical message"
				}), /* @__PURE__ */ X("pre", {
					"aria-label": "Canonical terminal evidence message",
					tabIndex: 0,
					className: "mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono",
					children: t
				})]
			})
		]
	});
}
// src/app/features/human-shell/input.ts
function cy(e) {
	return e.startsWith("\\!") ? {
		kind: "prompt",
		prompt: e.slice(1)
	} : e.startsWith("!") ? {
		kind: "command",
		command: e.slice(1)
	} : {
		kind: "prompt",
		prompt: e
	};
}
// src/app/features/human-shell/presentationLifetime.ts
function ly(e, t) {
	let n = q(null);
	return G(() => {
		let e = yt(_r()), t = !0;
		return yt(un(e, F(() => {
			t = !1;
		}))), n.current = { current: () => t }, () => yt(Dr(e, en));
	}, [e, t]), n;
}
// src/app/features/human-shell/workflow.ts
var uy = class extends Ge("HumanCommandFailure") {};
function dy(e) {
	return e instanceof uy ? e : new uy({
		kind: "uncertain",
		cause: e
	});
}
function fy(e) {
	return e.state === "accepted" || e.state === "started";
}
function py(e) {
	let { sessionId: t, intents: n } = e, r = () => je(Nt({
		try: () => n.claim(t, e.command),
		catch: (e) => new uy({
			kind: "blocked",
			cause: e
		})
	}), (e) => F(() => n.uncertain(t, e))), i = (r, i) => F(() => {
		i.kind === "uncertain" ? n.uncertain(t, r) : n.confirmed(t, r), e.settled();
	});
	return re(xe(function* () {
		let a = yield* r();
		if (a.request.command !== e.command) {
			let o = yield* wt({
				try: () => e.lookup(a.request.request_id),
				catch: dy
			}).pipe(kt((e) => i(a, e)));
			if (yield* F(() => {
				n.confirmed(t, a), e.settled();
			}), fy(o)) return yield* fe(new uy({
				kind: "blocked",
				cause: /* @__PURE__ */ Error("The previous command is still active. Wait or explicitly cancel it before starting another.")
			}));
			a = yield* r();
		}
		let o = yield* wt({
			try: () => e.submit(a.request),
			catch: dy
		}).pipe(kt((e) => i(a, e)));
		return yield* F(() => {
			n.confirmed(t, a), e.settled();
		}), o;
	}));
}
async function my(e) {
	let t = await lt(e);
	if (Sr(t)) return t.value;
	let n = An(t.cause);
	throw Mr(n) ? n.value.cause : Wt(t.cause);
}
// src/app/features/human-shell/queries.ts
function hy(e) {
	let t = Si(), { api: n, stores: { composerStore: { shellIntents: r } } } = V(), i = q(/* @__PURE__ */ new Map()).current, a = yi({
		mutationFn: (a) => {
			let o = i.get(a);
			if (i.delete(a), o === void 0) throw Error("Command attempt is unavailable.");
			return my(py({
				sessionId: e,
				command: o,
				intents: r,
				submit: (t) => n.submitShellCommand(e, t).catch((e) => {
					throw new uy({
						kind: e instanceof Ot && e.status < 500 ? "rejected" : e instanceof DOMException && e.name === "AbortError" ? "not-sent" : "uncertain",
						cause: e
					});
				}),
				lookup: (t) => n.getShellCommand(e, t).catch((e) => {
					throw new uy({
						kind: "uncertain",
						cause: new Ct(t, e)
					});
				}),
				settled: () => {
					t.invalidateQueries({ queryKey: on.sessionRoot(e) }), t.invalidateQueries({ queryKey: on.sessionsAll });
				}
			}));
		},
		retry: !1
	}), o = a.mutateAsync, s = W((e) => {
		let t = crypto.randomUUID();
		return i.set(t, e), o(t).finally(() => i.delete(t));
	}, [i, o]);
	return {
		isPending: a.isPending,
		isError: a.isError,
		error: a.error,
		data: a.data,
		mutateAsync: s
	};
}
function gy(e) {
	let { api: t } = V(), n = Si();
	return yi({
		mutationFn: (n) => t.cancelShellCommand(e, n),
		retry: !1,
		onSettled: () => n.invalidateQueries({ queryKey: on.sessionSnapshot(e) })
	});
}
function _y(e, t, n, r) {
	let { api: i } = V();
	return xi({
		queryKey: [
			"session",
			e,
			"human-shell-output",
			t,
			n
		],
		queryFn: ({ signal: r }) => i.getShellOutput(e, t, n, r),
		enabled: r,
		retry: !1
	});
}
// src/app/components/inspector/composer/ComposerFrame.tsx
function vy({ compact: e, faded: t = !0, className: n, children: r, ...i }) {
	return /* @__PURE__ */ X("form", {
		className: I("pointer-events-none flex flex-col items-center gap-4 pt-4 pb-8 [&>*]:pointer-events-auto [&>*]:w-full [&>*]:max-w-[640px]", e ? "px-2" : "px-4", t && "fade-from-bottom", n),
		...i,
		children: r
	});
}
function yy({ compact: e, outline: t, className: n, children: r }) {
	return /* @__PURE__ */ Z("div", {
		className: I("relative flex min-w-0 flex-1 items-end bg-elevation-level-3 shadow-xl", e ? "rounded-[20px]" : "rounded-[24px]", n),
		children: [r, t ? /* @__PURE__ */ X("span", {
			"aria-hidden": !0,
			className: I("pointer-events-none absolute inset-0 rounded-[inherit] border-2", t === "accent" ? "border-accent-primary" : "border-tertiary")
		}) : null]
	});
}
function by({ compact: e, className: t, ...n }) {
	return /* @__PURE__ */ X(z, {
		size: e ? U.Medium : U.Large,
		content: g.Icon,
		className: I("btn-round shrink-0", t),
		...n
	});
}
function xy({ className: e, ...t }) {
	return /* @__PURE__ */ X(by, {
		variant: B.Primary,
		className: I("!shadow-composer-send", e),
		...t
	});
}
// src/app/components/inspector/ModelPicker.tsx
var Sy = {
	"": {
		title: "Default effort",
		description: "NAC does not send an effort. The model answers the way it does when the level is left unset."
	},
	none: {
		title: "None",
		description: "The model answers without a reasoning pass. This is the fastest and cheapest option."
	},
	minimal: {
		title: "Minimal",
		description: "A very short reasoning pass before the answer. Slightly more careful than none, still built for speed."
	},
	low: {
		title: "Low",
		description: "A light reasoning pass. Enough for small decisions, without a long investigation."
	},
	medium: {
		title: "Medium",
		description: "A balanced reasoning pass. The model thinks the task through, then answers."
	},
	high: {
		title: "High",
		description: "A deep reasoning pass. The model spends more time checking its work, so replies are slower and cost more."
	},
	xhigh: {
		title: "X-High",
		description: "Extra-deep reasoning for hard problems. Longer and more expensive than high."
	},
	max: {
		title: "Max",
		description: "The deepest reasoning this model offers. Slowest and most expensive, for the hardest tasks."
	}
}, Cy = [{
	id: "",
	label: "Default",
	hoverHint: {
		...Sy[""],
		muted: !0
	}
}, ...rp.map((e) => ({
	...e,
	hoverHint: {
		...Sy[e.id],
		muted: !0
	}
}))];
function wy({ sessionId: e, metadata: t, label: n, disabled: r }) {
	let i = N(), a = nr(), o = Rt(), s = _p(), c = zr(o.data), l = qr(), u = t?.model ?? n, d = t?.reasoning_effort ?? "", f = t ? {
		backend: t.backend,
		model: t.model,
		baseUrl: t.base_url ?? ""
	} : null, p = yf(o.data, t?.backend, u), m = K(() => op(p.supportedEfforts, d, Cy), [p.supportedEfforts, d]), h = m.find((e) => e.id === d)?.label, g = typeof h == "string" ? h : "Default", [_, v] = J(!1), y = async (n) => {
		if (!t || n.backend === t.backend && n.model === t.model) return;
		let r = o.data?.providers.find((e) => e.id === n.backend), i = n.backend === t.backend, c = !!(r?.auth_status === "ready" || s.matches(n) && s.credentialReady);
		if (!i && !c) {
			a.error(`Connect ${n.backend} in session settings before switching to this model.`);
			return;
		}
		if (!i && !n.baseUrl) {
			a.error(`Configure an endpoint for ${n.backend} in session settings first.`);
			return;
		}
		let u = yf(o.data, n.backend, n.model).supportedEfforts, f = d && u.includes(d) ? d : null, p = i ? {
			model: n.model,
			reasoning_effort: f
		} : {
			backend: n.backend,
			model: n.model,
			base_url: n.baseUrl,
			api_key_env: r?.connection?.api_key_env ?? null,
			reasoning_effort: f,
			extra_headers: null
		};
		try {
			await l.mutateAsync({
				id: e,
				patch: p
			}), a.success(`Model switched to ${n.model}`);
		} catch (e) {
			a.error(`The model was not switched: ${nf(Ud(e), n.backend)}`);
		}
	}, b = async (n) => {
		if (t && n !== d) try {
			await l.mutateAsync({
				id: e,
				patch: { reasoning_effort: n || null }
			}), a.success(`Reasoning set to ${n || "the model default"}`);
		} catch (e) {
			a.error(`Reasoning was not changed: ${nf(Ud(e), t.backend)}`);
		}
	};
	return /* @__PURE__ */ Z("div", {
		className: I("flex min-w-0 items-center", i ? "gap-1" : "gap-2"),
		children: [/* @__PURE__ */ X(Af, {
			catalog: o.data,
			loading: o.isLoading,
			failed: o.isError,
			compact: !0,
			disabled: r || !t || l.isPending,
			liveByBackend: c,
			value: f,
			onSelect: (e) => void y(e)
		}), /* @__PURE__ */ X(E, {
			title: `Effort: ${g}`,
			description: "How much the model reasons before it answers.",
			position: M.TopCenter,
			sticky: !0,
			disabled: _,
			children: /* @__PURE__ */ X(dp, {
				items: m,
				value: d,
				placeholder: "Default",
				disabled: r || !t || l.isPending,
				size: U.Small,
				trailingIcon: null,
				placement: M.TopCenter,
				onOpenChange: v,
				onValueChange: (e) => void b(e)
			})
		})]
	});
}
// src/app/features/direct-session/browserAdapters.ts
function Ty(e, t, n = {
	readMessages: Ht(e).api.getMessages,
	subscribe: Ht(e).events
}) {
	let { applyAssistantDelta: r, applyEnvelope: i, captureRuntimeActivation: a, clearRuntimeThreads: o, resetRuntime: s, setStreamStatus: c, syncRunFromSnapshot: l } = Ht(e).stores.runtimeStore, u = Vn(e, t), d = !1, f = () => !1;
	return {
		attach: () => {
			d = !0, s(t), f = a(t), l(e.getQueryData(on.sessionSnapshot(t))?.active_run);
		},
		detach: () => {
			d = !1, f() && s(null), ot(u), e.cancelQueries({
				queryKey: on.sessionSnapshot(t),
				exact: !0
			}), e.cancelQueries({ queryKey: on.threadEventsRoot(t) }), e.removeQueries({ queryKey: on.threadEventsRoot(t) });
		},
		subscribe: (e) => n.subscribe(t, {
			onEnvelope: (t) => {
				if (!d) return;
				let n = t.event;
				e.change({
					refresh: i(t),
					transcriptLength: n.type === "transcript_appended" ? n.transcript_len : 0,
					finishedThread: n.type === "agent" && n.event.type === "thread_finished" ? n.event.name : void 0,
					runCompleted: n.type === "run_completed",
					permissionsChanged: n.type === "permission_asked" || n.type === "permission_replied" || n.type === "permission_dismissed" || n.type === "permission_approval_mode_changed" || n.type === "permission_review_started" || n.type === "permission_reviewed"
				});
			},
			onAssistantDelta: (e) => {
				d && r(e);
			},
			onStatus: (e) => {
				d && c(e);
			},
			onReplayBoundary: (t) => {
				d && e.epoch(t.epoch_id);
			},
			onReplayGap: e.replayLost,
			onLagged: e.replayLost,
			onSequenceGap: e.replayLost,
			onBackpressure: e.replayLost
		}),
		fenceSnapshot: (n) => {
			n && (o(), e.cancelQueries({ queryKey: on.threadEventsRoot(t) }), e.removeQueries({ queryKey: on.threadEventsRoot(t) })), e.cancelQueries({
				queryKey: on.sessionSnapshot(t),
				exact: !0
			}), D(u, n);
		},
		snapshot: async () => {
			ei("query:invalidate.session", { throttleMs: 0 }), await e.invalidateQueries({
				queryKey: on.sessionSnapshot(t),
				exact: !0
			});
		},
		tail: async (r) => {
			let i = Hr(u), a = AbortSignal.any([r, i.controller.signal]);
			try {
				let r = await n.readMessages(t, {
					limit: 24,
					includeSystem: !0,
					signal: a
				});
				if (!d || a.aborted || !Re(u, i.generation)) return { kind: "obsolete" };
				let o = !1;
				return e.setQueryData(on.sessionSnapshot(t), (e) => {
					if (!e) return o = !0, e;
					let t = Ne(e, r);
					return t.kind === "snapshot-required" ? (o = !0, e) : t.snapshot;
				}), o ? { kind: "snapshot-required" } : {
					kind: "accepted",
					total: r.page.total
				};
			} catch (e) {
				if (a.aborted || !Re(u, i.generation)) return { kind: "obsolete" };
				throw e;
			} finally {
				S(u, i);
			}
		},
		invalidate: (n, r) => {
			let i = n === "permissions" ? on.sessionPermissions(t) : n === "skills" ? on.sessionSkills(t) : n === "revisions" ? on.workspaceRevisions(t) : on.threadEvents(t, r ?? "");
			e.invalidateQueries({
				queryKey: i,
				exact: !0
			});
		}
	};
}
// src/app/features/direct-session/streamReconciliation.ts
var Ey = class extends Gn("nac/SessionObservation")() {}, Dy = 250, Oy = xe(function* () {
	let e = yield* Ey;
	return yield* je(F(() => {
		e.attach();
		let t = !1, n = null, r = null, i = !1, a = !1, o = !1, s = 0, c = 0, l = null, u = new AbortController();
		function d(i) {
			t || (i && (s = 0), e.fenceSnapshot(i), clearTimeout(n ?? void 0), n = null, o = !1, clearTimeout(r ?? void 0), r = setTimeout(() => {
				if (r = null, t) return;
				let n = ++c;
				a = !0, ce(wt({
					try: e.snapshot,
					catch: () => "snapshot-unavailable"
				}).pipe(Xe, ee(F(() => {
					t || n !== c || (a = !1, o && r === null && f());
				}))));
			}, Dy));
		}
		function f() {
			if (t || i || a || r !== null) return;
			i = !0;
			let n = xe(function* () {
				let n = 1;
				for (; !t && o && !a && r === null;) {
					o = !1;
					let r = yield* wt({
						try: () => e.tail(u.signal),
						catch: () => "tail-unavailable"
					}).pipe(Ve(() => L({ kind: "snapshot-required" })));
					if (!(t || r.kind === "obsolete")) {
						if (r.kind === "snapshot-required") {
							d(!0);
							return;
						}
						if (r.total < s) {
							if (n === 0) {
								d(!1);
								return;
							}
							--n, o = !0;
						}
					}
				}
			}).pipe(ee(F(() => {
				i = !1;
			})));
			ce(n);
		}
		function p(e) {
			t || (s = Math.max(s, e), o = !0, !(r !== null || a || i) && (clearTimeout(n ?? void 0), n = setTimeout(() => {
				n = null, f();
			}, Dy)));
		}
		let m = e.subscribe({
			change: (n) => {
				t || (n.finishedThread && e.invalidate("thread", n.finishedThread), n.refresh === "messages" ? p(n.transcriptLength) : n.refresh === "snapshot" ? d(!1) : n.refresh === "replace-snapshot" && d(!0), n.runCompleted && e.invalidate("revisions"), n.permissionsChanged && e.invalidate("permissions"));
			},
			epoch: (n) => {
				t || (l !== null && n !== l && (d(!0), e.invalidate("skills"), e.invalidate("permissions")), l = n);
			},
			replayLost: () => {
				t || (d(!0), e.invalidate("permissions"));
			}
		});
		return { close: () => {
			t || (t = !0, c += 1, m(), clearTimeout(n ?? void 0), clearTimeout(r ?? void 0), u.abort(), e.detach());
		} };
	}), (e) => F(e.close));
});
// src/app/features/direct-session/browserRuntime.ts
function ky(e) {
	let t = yt(_r()), n = (() => {
		try {
			return yt(Oy.pipe(mt(bd(Ey, e)), er(t)));
		} catch (n) {
			throw e.detach(), yt(Dr(t, en)), n;
		}
	})();
	return () => {
		n.close(), yt(Dr(t, en));
	};
}
// src/app/hooks/useSessionStream.ts
function Ay(e) {
	let { resetRuntime: t } = V().stores.runtimeStore, n = Si();
	G(() => {
		if (!e) t(null);
		else return ky(Ty(n, e));
	}, [
		e,
		n,
		t
	]);
}
function jy(e, t) {
	let { subscribeToSessionEvents: n } = { subscribeToSessionEvents: V().events }, r = Si();
	G(() => {
		if (!t) return;
		let i = () => {
			r.invalidateQueries({
				queryKey: on.sessionPermissions(e),
				exact: !0
			});
		};
		return n(e, {
			onEnvelope: (e) => {
				(e.event.type === "permission_asked" || e.event.type === "permission_replied" || e.event.type === "permission_dismissed" || e.event.type === "permission_approval_mode_changed" || e.event.type === "permission_review_started" || e.event.type === "permission_reviewed") && i();
			},
			onStatus: (e) => {
				e === "live" && i();
			},
			onReplayBoundary: i,
			onReplayGap: i,
			onLagged: i,
			onSequenceGap: i,
			onBackpressure: i
		});
	}, [
		r,
		t,
		e,
		n
	]);
}
function My(e) {
	let { syncRunFromSnapshot: t } = V().stores.runtimeStore;
	G(() => {
		t(e);
	}, [e, t]);
}
// src/app/features/permissions/usePermissionQueue.ts
function Ny(e, t, n, { poll: r = !0, includeChildren: i = !0, parentSessionId: a } = {}) {
	let { api: o } = V(), s = he(e, t, r), c = qe(e, t && i), l = t && i ? c.data ?? [] : [], u = bi({ queries: l.map((e) => ({
		queryKey: on.sessionPermissions(e.child_session_id),
		queryFn: ({ signal: t }) => o.getPermissions(e.child_session_id, t),
		refetchInterval: 1e3,
		staleTime: 0,
		retry: !1
	})) }), d = [{
		sessionId: e,
		parentSessionId: a,
		label: n ?? "this session",
		query: s
	}, ...l.map((e, t) => ({
		sessionId: e.child_session_id,
		parentSessionId: e.parent_session_id,
		label: `child agent “${e.description}”`,
		query: u[t]
	}))];
	return {
		parent: s,
		children: c,
		records: l,
		scopes: d,
		requests: d.flatMap((e) => (e.query.data?.requests ?? []).map((t) => ({
			scope: e,
			request: t,
			key: JSON.stringify([e.sessionId, t.id])
		}))),
		reviews: d.flatMap((e) => (e.query.data?.reviews ?? []).map((t) => ({
			scope: e,
			review: t,
			key: JSON.stringify([e.sessionId, t.id]),
			authorizable: (e.query.data?.authorizable_review_ids ?? []).includes(t.id)
		}))).sort((e, t) => t.review.created_at_epoch_ms - e.review.created_at_epoch_ms),
		includeChildren: i
	};
}
// src/app/components/inspector/PermissionReviews.tsx
var Py = {
	authentication: "The review service could not authenticate. Sign in to Arcee again or check the configured Arcee API key.",
	access_denied: "The selected Arcee workspace cannot access the review service. Ask an administrator to check its access settings.",
	model_unavailable: "The review model or endpoint is unavailable in the selected Arcee environment. Ask an administrator to check model registration, API availability and workspace access.",
	insufficient_credits: "The selected Arcee workspace has insufficient credits for review. Check its balance or use Manual approval.",
	rate_limited: "The review service is rate limited. Try again later or use Manual approval.",
	timeout: "The review service did not answer in time. Try again later or use Manual approval.",
	invalid_response: "The review service returned an invalid response. Try again later or contact an administrator.",
	service_unavailable: "The review service could not be reached or could not complete the request. Try again later or check server diagnostics.",
	cancelled: "The review was cancelled before a verdict was used."
};
function Fy(e) {
	return e.failure_reason && Py[e.failure_reason] || "The review service could not complete this request. Try again later or check server diagnostics.";
}
function Iy({ reviews: e }) {
	let t = e[0], n = t ? t.outcome ? t.outcome === "unavailable" ? "Last review unavailable" : "Last review completed" : "Review in progress" : "Service availability not checked";
	return /* @__PURE__ */ Z("section", {
		"aria-label": "Review service status",
		role: "status",
		className: "rounded-[6px] bg-elevation-level-2 p-3",
		children: [/* @__PURE__ */ X("div", {
			className: "text-small font-medium text-basic-primary",
			children: n
		}), /* @__PURE__ */ X("div", {
			className: "mt-1 text-small text-basic-secondary",
			children: t ? t.outcome ? t.outcome === "unavailable" ? `${Fy(t)} That action was not executed. Eligible actions will still require a new review; you can switch to Manual to decide requests yourself.` : "The last request reached the review service. Service availability can change before the next request." : "The requested action has not run." : "Enabling this mode checks credentials only. Model access, credits and connectivity are checked when an eligible action is reviewed."
		})]
	});
}
function Ly(e) {
	switch (e.outcome) {
		case "rejected": return e.category ? `Blocked: ${e.category.replace(/_/g, " ")}` : "Blocked";
		case "uncertain": return "Blocked: review was not confident";
		case "unavailable": return "Review service unavailable";
		case "approved": return "Allowed by reviewer";
		default: return "Reviewing";
	}
}
function Ry({ review: e, authorizable: t, authorizing: n, disabled: r, disabledReason: i, onAuthorize: a }) {
	let o = e.outcome === "approved" ? "text-basic-secondary" : e.outcome === void 0 || e.outcome === null ? "text-accent-primary" : "text-error-primary";
	return /* @__PURE__ */ Z("div", {
		className: "rounded-[4px] bg-elevation-level-2 px-3 py-2",
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex flex-wrap items-center gap-x-2 gap-y-1",
				children: [
					/* @__PURE__ */ X("span", {
						className: "tag-label uppercase text-basic-secondary",
						children: e.tool
					}),
					/* @__PURE__ */ X("span", {
						className: "tag-label uppercase text-basic-tertiary",
						children: e.backend
					}),
					e.backend === "local" || e.backend === "ssh" ? /* @__PURE__ */ X("span", {
						className: "tag-label uppercase text-basic-tertiary",
						children: "unsandboxed host"
					}) : e.backend === "podman_with_host_mounts" ? /* @__PURE__ */ X("span", {
						className: "tag-label uppercase text-basic-tertiary",
						children: "container with writable host mounts"
					}) : null,
					/* @__PURE__ */ X("span", {
						className: `text-small ${o}`,
						children: Ly(e)
					})
				]
			}),
			e.resources.map((e, t) => /* @__PURE__ */ Z("div", {
				className: "mt-1 break-words text-small text-basic-primary",
				children: [
					/* @__PURE__ */ X("span", {
						className: "tag-label uppercase text-basic-secondary",
						children: e.action
					}),
					" ",
					e.display || e.resource
				]
			}, `${e.action}:${e.resource}:${t}`)),
			e.outcome === "unavailable" ? /* @__PURE__ */ Z("div", {
				className: "mt-2 text-small text-basic-secondary",
				children: [Fy(e), " This action was not executed."]
			}) : null,
			t ? /* @__PURE__ */ Z("div", {
				className: "mt-2 flex items-center justify-end gap-2",
				children: [i ? /* @__PURE__ */ X("span", {
					className: "text-small text-basic-tertiary",
					children: i
				}) : null, /* @__PURE__ */ X(z, {
					size: U.Small,
					variant: B.Secondary,
					loading: n,
					disabled: r,
					title: "Ask the agent to retry exactly this action. The retry is reviewed again before it runs.",
					onClick: a,
					children: "Authorize retry"
				})]
			}) : null
		]
	});
}
// src/app/components/inspector/PermissionControls.tsx
var zy = [
	{
		mode: "manual",
		name: "Manual",
		description: "Each request pauses until you approve or deny it."
	},
	{
		mode: "auto_approve",
		name: "Approve all",
		description: "Automatically allows ordinary requests after they reach the permission broker. Hard and configured denials still apply."
	},
	{
		mode: "review",
		name: "Approve for me",
		description: "Eligible requests are reviewed automatically, and routine ones are allowed once. Ineligible requests still ask you. A rejected, uncertain or unavailable review leaves the action unexecuted and returns it to the agent; it does not open a manual prompt. You can switch to Manual to decide requests yourself. Uses your Arcee sign-in or Arcee API key."
	}
];
function By(e) {
	return zy.find((t) => t.mode === e)?.name ?? "Manual";
}
function Vy({ sessionId: e, running: t }) {
	return jy(e, t), null;
}
function Hy({ grant: e, deleting: t, disabled: n, onDelete: r }) {
	return /* @__PURE__ */ Z("div", {
		className: "flex items-start gap-3 rounded-[4px] bg-elevation-level-2 px-3 py-2",
		children: [/* @__PURE__ */ Z("div", {
			className: "min-w-0 flex-1",
			children: [/* @__PURE__ */ Z("div", {
				className: "flex flex-wrap items-center gap-x-2 gap-y-1",
				children: [/* @__PURE__ */ X("span", {
					className: "tag-label uppercase text-basic-secondary",
					children: e.action
				}), /* @__PURE__ */ X("span", {
					className: "tag-label uppercase text-basic-tertiary",
					children: e.backend
				})]
			}), /* @__PURE__ */ X("div", {
				className: "mt-1 break-all code code-small text-basic-primary",
				children: e.resource
			})]
		}), /* @__PURE__ */ X(z, {
			size: U.Small,
			variant: B.GhostDestructive,
			content: g.Icon,
			"aria-label": `Forget ${e.action} permission`,
			loading: t,
			disabled: n,
			onClick: r,
			children: /* @__PURE__ */ X(R, {
				iconName: H.Trash,
				size: 16
			})
		})]
	});
}
function Uy({ sessionId: e, behavior: t, label: n = "Permissions", autoApprovalAvailable: r = !0, requesterLabel: i, retryParentSessionId: a, poll: o = !0, compact: s = !1 }) {
	let c = t === "direct" || t === "direct-with-orchestrator", l = Ny(e, c, i, {
		poll: o,
		includeChildren: r,
		parentSessionId: a
	}), u = l.parent, d = ae(), f = jt(), p = dt(), m = pe(), h = nr(), _ = l.requests, v = l.scopes.flatMap((e) => e.query.data?.grants ?? []), y = l.reviews, b = y.filter((e) => e.authorizable).length, x = u.data?.approval_mode ?? "manual", S = x === "auto_approve", C = x === "review", w = y[0]?.review, T = w ? w.outcome === "unavailable" ? "Unavailable" : w.outcome ? null : "Reviewing" : "Not checked", D = x !== "manual" && !r, [O, k] = J(!1), [ee, A] = J(""), [te, j] = J(null), [ne, re] = J(null), [ie, oe] = J(null), [se, ce] = J(null), le = JSON.stringify(_.map((e) => e.key)), ue = O || !!(_.length && le !== ee), de = () => {
		A(le), k(!1);
	};
	if (!c) return null;
	let fe = _.find((e) => e.key === se) ?? _[0] ?? null, N = fe?.request ?? null, P = fe?.scope.label ?? i ?? "this session", me = fe?.scope.query.isError || fe?.scope.query.isPending, F = te !== null, I = N?.resources.some((e) => e.save_resource) ?? !1, he = async (e) => {
		if (N && fe && !F && !me) {
			j(fe.key);
			try {
				await d.mutateAsync({
					sessionId: fe.scope.sessionId,
					requestId: N.id,
					reply: e
				}), _.length === 1 && de();
			} catch (e) {
				h.error(`Unable to answer permission request: ${Vt(Ud(e))}`);
			} finally {
				j(null);
			}
		}
	}, ge = async (e, t) => {
		if (!ne) {
			re(JSON.stringify([e, t.id]));
			try {
				await p.mutateAsync({
					sessionId: e,
					grantId: t.id
				});
			} catch (e) {
				h.error(`Unable to forget permission: ${Vt(Ud(e))}`);
			} finally {
				re(null);
			}
		}
	}, _e = async (t) => {
		if (k(!0), t !== x) try {
			await f.mutateAsync({
				sessionId: e,
				mode: t
			});
		} catch (e) {
			h.error(`Unable to change approval mode: ${Vt(Ud(e))}`);
		}
	}, L = async (e) => {
		if (!(ie || e.scope.query.isError || e.scope.query.isPending)) {
			oe(e.key);
			try {
				await m.mutateAsync({
					sessionId: e.scope.sessionId,
					reviewId: e.review.id,
					parentSessionId: e.scope.parentSessionId
				}), h.success("Retry authorized. The agent will retry it, and it is reviewed again.");
			} catch (e) {
				h.error(`Unable to authorize retry: ${Vt(Ud(e))}`);
			} finally {
				oe(null);
			}
		}
	}, ve = _.length ? ` (${_.length})` : b ? ` (${b})` : v.length ? ` (${v.length})` : "", ye = By(x), be = D ? `This child agent inherits ${ye} from the parent session. Change the mode on the parent.` : zy.find((e) => e.mode === x)?.description ?? zy[0].description;
	return /* @__PURE__ */ Z(Y, { children: [
		l.records.map((e) => /* @__PURE__ */ X(Vy, {
			sessionId: e.child_session_id,
			running: e.status === "running"
		}, e.child_session_id)),
		/* @__PURE__ */ X(E, {
			title: `Permission: ${ye}`,
			description: be,
			position: M.TopCenter,
			children: /* @__PURE__ */ Z(z, {
				size: U.Small,
				variant: _.length || b ? B.GhostHighlightedAccent : B.Ghost,
				content: s && !_.length ? g.Icon : g.IconLeft,
				"aria-label": D ? `${n} — ${S ? "auto-approve" : ye} inherited; open permissions` : S ? "Auto-approve on — open permissions" : C ? `Approve for me enabled${ve} — open permissions` : `${n}${ve}`,
				onClick: () => k(!0),
				children: [
					/* @__PURE__ */ X(R, {
						iconName: H.Private,
						size: 16
					}),
					s ? null : /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("span", {
						className: "label-micro",
						children: ye
					}), C && T ? /* @__PURE__ */ X("span", {
						className: "label-micro text-basic-tertiary",
						children: T
					}) : null] }),
					_.length ? /* @__PURE__ */ Z("span", {
						className: "label-micro",
						children: [
							"(",
							_.length,
							" pending)"
						]
					}) : null
				]
			})
		}),
		/* @__PURE__ */ X(Xn, {
			open: ue,
			onClose: de,
			size: Tn.Wide,
			flush: !0,
			title: N ? "Permission required" : "Permissions",
			subheader: N ? `${N.tool} requested by ${P} is paused before execution.` : D ? S ? "Automatic approval is inherited from the parent session; change it from the parent." : `${ye} is inherited from the parent session; change it from the parent.` : S ? "Automatic approval is active for this session and its owned child agents." : C ? "Approve for me is enabled for this session and its owned child agents. This setting does not guarantee that the review service is available." : "Remembered access for this session.",
			footer: N ? /* @__PURE__ */ Z("div", {
				className: "flex w-full flex-wrap justify-end gap-2",
				children: [
					/* @__PURE__ */ X(z, {
						variant: B.SecondaryDestructive,
						loading: te === fe?.key && d.variables?.reply === "reject",
						disabled: F || me,
						onClick: () => void he("reject"),
						children: "Reject"
					}),
					/* @__PURE__ */ X(z, {
						variant: B.Secondary,
						loading: te === fe?.key && d.variables?.reply === "once",
						disabled: F || me,
						onClick: () => void he("once"),
						children: "Allow once"
					}),
					/* @__PURE__ */ X(z, {
						variant: B.Primary,
						loading: te === fe?.key && d.variables?.reply === "always",
						disabled: F || me || !I,
						title: I ? "Remember the server-derived narrow access pattern" : "This operation has no safe reusable permission pattern",
						onClick: () => void he("always"),
						children: "Always allow"
					})
				]
			}) : void 0,
			children: /* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-5",
				children: [
					[...l.includeChildren ? [{
						sessionId: "discovery",
						label: "Child request discovery",
						query: l.children
					}] : [], ...l.scopes].map(({ sessionId: e, label: t, query: n }) => n.isError ? /* @__PURE__ */ Z("div", {
						role: "alert",
						className: "rounded-[4px] bg-error-secondary p-3 text-small text-error-primary",
						children: [
							"Permissions could not be loaded for ",
							t,
							". The run remains fail-closed.",
							/* @__PURE__ */ Z(z, {
								size: U.Small,
								variant: B.Secondary,
								onClick: () => void n.refetch(),
								children: ["Retry ", t]
							})
						]
					}, e) : n.isPending ? /* @__PURE__ */ Z("div", {
						role: "status",
						className: "text-small text-basic-secondary",
						children: [
							"Loading permissions for ",
							t,
							"…"
						]
					}, e) : null),
					_.length ? /* @__PURE__ */ Z("section", {
						"aria-label": "Pending permission requests",
						className: "flex flex-col gap-2",
						children: [/* @__PURE__ */ Z("div", {
							className: "tag-label uppercase text-basic-tertiary",
							children: [
								"Pending requests (",
								_.length,
								")"
							]
						}), _.map((e) => /* @__PURE__ */ X(z, {
							variant: e.key === fe?.key ? B.Secondary : B.Ghost,
							className: "!h-auto min-h-9 min-w-0 !py-2",
							"aria-pressed": e.key === fe?.key,
							disabled: F,
							onClick: () => ce(e.key),
							children: /* @__PURE__ */ Z("span", {
								className: "min-w-0 flex-1 whitespace-normal text-left [overflow-wrap:anywhere]",
								children: [
									e.scope.label,
									" (",
									e.scope.sessionId,
									"): ",
									e.request.tool
								]
							})
						}, e.key))]
					}) : /* @__PURE__ */ X("div", {
						className: "text-small text-basic-secondary",
						children: "No pending permission requests."
					}),
					r ? /* @__PURE__ */ Z("section", {
						"aria-label": "Approval mode",
						role: "radiogroup",
						className: "flex flex-col gap-3 rounded-[6px] bg-elevation-level-2 p-3",
						children: [zy.map((t) => /* @__PURE__ */ X(Ku, {
							name: `approval-mode-${e}`,
							"aria-label": t.name,
							checked: x === t.mode,
							disabled: f.isPending || u.isError || u.isPending,
							onChange: (e) => {
								e && _e(t.mode);
							},
							children: /* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("div", {
								className: "text-small font-medium text-basic-primary",
								children: t.name
							}), /* @__PURE__ */ X("div", {
								className: "mt-1 text-small text-basic-secondary",
								children: t.description
							})] })
						}, t.mode)), /* @__PURE__ */ X("div", {
							className: "text-small text-basic-tertiary",
							children: "The mode governs this session and all existing or future owned child agents, stays saved across restarts and never creates remembered permissions. Separately managed orchestrators are not included."
						})]
					}) : null,
					C ? /* @__PURE__ */ X(Iy, { reviews: y.map((e) => e.review) }) : null,
					C || y.length ? /* @__PURE__ */ Z("section", {
						"aria-label": "Automatic reviews",
						children: [
							/* @__PURE__ */ X("div", {
								className: "mb-2 tag-label uppercase text-basic-tertiary",
								children: "Automatic reviews"
							}),
							/* @__PURE__ */ X("div", {
								className: "mb-2 text-small text-basic-secondary",
								children: "Blocked actions were returned to the agent unexecuted. Authorizing a retry asks the agent to try exactly that action again; it passes policy and a fresh review."
							}),
							/* @__PURE__ */ X("div", {
								className: "mb-2 text-small text-basic-tertiary",
								children: "Review history, blocked actions and retry authorizations are temporary. They are lost when the server restarts or an idle session is unloaded, including after all clients disconnect. The selected mode and recorded human intent remain saved."
							}),
							y.length === 0 ? /* @__PURE__ */ X("div", {
								className: "text-small text-basic-secondary",
								children: "No reviews are retained for this session."
							}) : null,
							/* @__PURE__ */ X("div", {
								className: "flex flex-col gap-2",
								children: y.map((e) => {
									let t = e.scope.parentSessionId || r ? void 0 : "Open the child's parent to authorize a retry or switch the parent to Manual.";
									return /* @__PURE__ */ Z("section", {
										"aria-label": `Review for ${e.scope.label}`,
										children: [/* @__PURE__ */ Z("div", {
											className: "mb-1 break-all text-small text-basic-secondary",
											children: [
												e.scope.label,
												" (",
												e.scope.sessionId,
												")"
											]
										}), /* @__PURE__ */ X(Ry, {
											review: e.review,
											authorizable: e.authorizable,
											authorizing: ie === e.key,
											disabled: ie !== null || e.scope.query.data?.approval_mode !== "review" || e.scope.query.isError || e.scope.query.isPending || !!t,
											disabledReason: t,
											onAuthorize: () => void L(e)
										})]
									}, e.key);
								})
							}),
							C && r ? /* @__PURE__ */ X("div", {
								className: "mt-2 flex justify-end",
								children: /* @__PURE__ */ X(z, {
									size: U.Small,
									variant: B.Ghost,
									disabled: f.isPending || u.isError || u.isPending,
									onClick: () => void _e("manual"),
									children: "Switch to Manual"
								})
							}) : null
						]
					}) : null,
					D ? /* @__PURE__ */ Z("section", {
						"aria-label": "Inherited automatic approval mode",
						className: "rounded-[6px] border border-accent-primary bg-elevation-level-2 p-3",
						children: [/* @__PURE__ */ Z("div", {
							className: "text-small font-medium text-basic-primary",
							children: [S ? "Auto-approve" : ye, " inherited"]
						}), /* @__PURE__ */ Z("div", {
							className: "mt-1 text-small text-basic-secondary",
							children: [
								S ? "Ordinary requests from this child agent inherit automatic approval from the parent session." : `Ordinary requests from this child agent follow the parent session’s ${ye} mode.`,
								" ",
								"Change this mode from the parent session; hard and configured denials still apply."
							]
						})]
					}) : null,
					N ? /* @__PURE__ */ Z("section", {
						"aria-label": "Requested access",
						children: [
							/* @__PURE__ */ Z("div", {
								className: "mb-2 text-small text-basic-secondary",
								children: [
									"Requested by ",
									P,
									" (",
									N.session_id,
									").",
									" ",
									fe?.scope.query.data?.approval_mode === "review" ? "This request is not eligible for automatic review, so it needs your decision. Eligibility also depends on the available human intent and redaction checks." : "Manual approval is effective because automatic approval is off for this session and its owned child agents."
								]
							}),
							/* @__PURE__ */ X("div", {
								className: "mb-2 tag-label uppercase text-basic-tertiary",
								children: "Requested access"
							}),
							/* @__PURE__ */ X("div", {
								className: "flex flex-col gap-2",
								children: N.resources.map((e, t) => /* @__PURE__ */ Z("div", {
									className: "rounded-[4px] bg-elevation-level-2 px-3 py-2",
									children: [
										/* @__PURE__ */ X("div", {
											className: "tag-label uppercase text-basic-secondary",
											children: e.action
										}),
										/* @__PURE__ */ X("div", {
											className: "mt-1 break-words text-small text-basic-primary",
											children: e.display
										}),
										e.save_resource ? /* @__PURE__ */ Z("div", {
											className: "mt-2 break-all code code-small text-basic-tertiary",
											children: ["Always: ", e.save_resource]
										}) : null
									]
								}, `${e.action}:${e.resource}:${t}`))
							}),
							_.length > 1 ? /* @__PURE__ */ Z("div", {
								className: "mt-2 text-small text-basic-secondary",
								children: [
									_.length - 1,
									" more request",
									_.length === 2 ? "" : "s",
									" waiting."
								]
							}) : null
						]
					}) : null,
					/* @__PURE__ */ Z("section", {
						"aria-label": "Remembered permissions",
						children: [
							/* @__PURE__ */ X("div", {
								className: "mb-2 tag-label uppercase text-basic-tertiary",
								children: "Remembered permissions by session"
							}),
							/* @__PURE__ */ X("div", {
								className: "mb-3 text-small text-basic-secondary",
								children: "Each grant stays in its original session. A child’s grants never apply to the parent or siblings."
							}),
							l.scopes.map((t) => /* @__PURE__ */ Z("section", {
								"aria-label": `Remembered for ${t.label}`,
								className: "mb-4",
								children: [
									/* @__PURE__ */ Z("div", {
										className: "mb-2 break-all text-small text-basic-secondary",
										children: [
											"Remembered for ",
											t.label,
											" (",
											t.sessionId,
											")"
										]
									}),
									/* @__PURE__ */ Z("div", {
										className: "flex flex-col gap-2",
										children: [
											t.sessionId !== e && t.query.data?.approval_mode === "auto_approve" ? /* @__PURE__ */ X("div", {
												className: "text-small text-basic-secondary",
												children: "Auto-approve inherited from parent."
											}) : null,
											t.sessionId !== e && t.query.data?.approval_mode === "review" ? /* @__PURE__ */ X("div", {
												className: "text-small text-basic-secondary",
												children: "Approve for me inherited from parent."
											}) : null,
											(t.query.data?.grants ?? []).map((e) => /* @__PURE__ */ X(Hy, {
												grant: e,
												deleting: ne === JSON.stringify([t.sessionId, e.id]),
												disabled: ne !== null || t.query.isError || t.query.isPending,
												onDelete: () => void ge(t.sessionId, e)
											}, e.id))
										]
									}),
									!t.query.isPending && !t.query.isError && !t.query.data?.grants.length ? /* @__PURE__ */ X("div", {
										className: "text-small text-basic-secondary",
										children: "No remembered permissions."
									}) : null
								]
							}, t.sessionId))
						]
					})
				]
			})
		})
	] });
}
// src/app/components/inspector/GoalComposer.tsx
var Wy = "Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited.", Gy = 100, Ky = 1e6, qy = 100, Jy = 9600, Yy = 180;
function Xy(e) {
	let t = e.replaceAll("_", " ");
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function Zy(e) {
	return e === "active" ? na.Green : e === "complete" ? na.Gray : na.Yellow;
}
function Qy(e) {
	let t = Math.round(e / qy) * qy;
	return Math.min(Ky, Math.max(Gy, t));
}
function $y({ sessionId: e, compact: t, className: n, onOpen: r }) {
	let i = ve(e, !0).data ?? null, a = i?.status === "active";
	return /* @__PURE__ */ X(E, {
		className: n,
		position: M.TopCenter,
		title: i ? `Current Goal: ${Xy(i.status)} - Click To Edit` : "Set Durable Goal",
		description: i ? i.objective : Wy,
		children: /* @__PURE__ */ X(by, {
			compact: t,
			type: "button",
			variant: a ? B.GhostHighlightedAccent : B.Ghost,
			"aria-label": i ? `Edit goal: ${Xy(i.status)}` : "Set durable goal",
			onClick: r,
			children: /* @__PURE__ */ X(R, {
				iconName: H.Flag,
				size: 24
			})
		})
	});
}
function eb({ sessionId: e, compact: t, onClose: n }) {
	let i = ve(e, !0), a = gt(), o = r(), s = f(), c = nr(), l = i.data ?? null, [u, d] = J(l?.objective ?? ""), [p, m] = J(l?.token_budget != null), [h, g] = J(l?.token_budget ?? Jy), _ = q(!1), v = q(i.data !== void 0);
	G(() => {
		if (v.current || i.isPending) return;
		v.current = !0;
		let e = i.data ?? null;
		d(e?.objective ?? ""), m(e?.token_budget != null), g(e?.token_budget ?? Jy), _.current = !1;
	}, [i.data, i.isPending]);
	let y = q(null);
	pi(() => {
		let e = y.current;
		e && (e.style.height = "auto", e.style.height = `${Math.min(e.scrollHeight, Yy)}px`);
	}, [u]);
	let b = a.isPending || o.isPending || s.isPending, x = l != null && l.status !== "complete", S = (e, t) => {
		c.error(`${e}: ${Vt(Ud(t))}`);
	}, C = async (t) => {
		let r = p ? h : null;
		if (!u.trim()) c.error("Goal objective is required.");
		else try {
			x && l ? await o.mutateAsync({
				sessionId: e,
				goalId: l.goal_id,
				payload: {
					expected_version: l.version,
					objective: u.trim(),
					..._.current ? { token_budget: r } : {}
				}
			}) : await a.mutateAsync({
				sessionId: e,
				payload: {
					objective: u.trim(),
					...r === null ? {} : { token_budget: r }
				}
			}), t && n();
		} catch (e) {
			S(x ? "Unable to update goal" : "Unable to create goal", e);
		}
	}, w = async (t) => {
		if (l) try {
			await o.mutateAsync({
				sessionId: e,
				goalId: l.goal_id,
				payload: {
					expected_version: l.version,
					status: t
				}
			});
		} catch (e) {
			S("Unable to change goal status", e);
		}
	}, T = async () => {
		if (l) try {
			await s.mutateAsync({
				sessionId: e,
				goalId: l.goal_id,
				expectedVersion: l.version
			}), d(""), m(!1), g(Jy), _.current = !1;
		} catch (e) {
			S("Unable to clear goal", e);
		}
	}, E = tb(l, b || !u.trim());
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-4",
		children: [/* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2 rounded-[20px] bg-elevation-level-2 p-3 shadow-md",
			children: [i.isPending ? /* @__PURE__ */ X("div", {
				className: "text-micro text-basic-secondary",
				children: "Loading goal…"
			}) : i.isError ? /* @__PURE__ */ X("div", {
				className: "rounded-[4px] bg-error-secondary p-2 text-micro text-error-primary",
				children: "Goal state could not be loaded."
			}) : l ? /* @__PURE__ */ Z("div", {
				className: "flex min-h-6 flex-wrap items-center gap-2",
				children: [
					/* @__PURE__ */ X("span", {
						className: "shrink-0 text-micro font-semibold text-basic-primary",
						children: "Current Goal"
					}),
					/* @__PURE__ */ X(ia, {
						text: Xy(l.status),
						color: Zy(l.status)
					}),
					/* @__PURE__ */ Z("span", {
						className: "min-w-0 flex-1 truncate text-micro text-basic-secondary",
						children: [
							l.tokens_used.toLocaleString(),
							" Tokens, ",
							Math.floor(l.time_used_ms / 1e3),
							"s"
						]
					}),
					/* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						variant: B.GhostDestructive,
						disabled: b,
						onClick: () => void T(),
						children: "Clear"
					}),
					/* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						variant: B.Primary,
						loading: b,
						disabled: !u.trim(),
						onClick: () => void C(!x),
						children: l.status === "complete" ? "Replace" : "Save"
					})
				]
			}) : null, /* @__PURE__ */ Z("div", {
				className: "flex items-center",
				children: [/* @__PURE__ */ Z("div", {
					className: "flex min-w-fit flex-1 items-center gap-2",
					children: [
						/* @__PURE__ */ X(pd, {
							checked: p,
							disabled: b,
							"aria-label": "Token budget",
							onChange: (e) => {
								_.current = !0, m(e);
							}
						}),
						/* @__PURE__ */ X("span", {
							className: "label-micro shrink-0 text-basic-primary",
							children: "Token Budget"
						}),
						p ? null : /* @__PURE__ */ X("span", {
							className: "label-micro shrink-0 text-basic-muted",
							children: "Disabled"
						})
					]
				}), /* @__PURE__ */ Z("div", {
					className: "flex min-w-0 flex-1 items-center gap-2",
					children: [/* @__PURE__ */ X("span", {
						className: "code code-small w-[60px] shrink-0 truncate text-right font-medium !leading-4 text-btn-secondary",
						children: h
					}), /* @__PURE__ */ X(Ju, {
						className: "min-w-0 flex-1",
						smallKnob: !0,
						min: Gy,
						max: Ky,
						step: qy,
						value: Qy(h),
						disabled: b,
						label: "Token budget",
						onChange: (e) => {
							_.current = !0, g(e), m(!0);
						}
					})]
				})]
			})]
		}), /* @__PURE__ */ Z("div", {
			className: "flex items-end gap-2",
			children: [/* @__PURE__ */ Z(yy, {
				compact: t,
				outline: "accent",
				children: [/* @__PURE__ */ X("textarea", {
					ref: y,
					className: I("block min-w-0 flex-1 resize-none border-none bg-transparent text-medium text-input outline-none placeholder:text-input-placeholder", t ? "px-3 py-2" : "px-4 py-3"),
					rows: 1,
					"aria-label": "Goal objective",
					placeholder: "Describe the concrete output",
					value: u,
					onChange: (e) => d(e.target.value),
					onKeyDown: (e) => {
						e.key === "Escape" ? (e.preventDefault(), n()) : e.key !== "Enter" || e.shiftKey || (!t || e.metaKey || e.ctrlKey) && (e.preventDefault(), C(l == null || l.status === "complete"));
					}
				}), /* @__PURE__ */ X(by, {
					compact: t,
					type: "button",
					variant: B.GhostAccent,
					"aria-label": "Close goal editor",
					onClick: n,
					children: /* @__PURE__ */ X(R, {
						iconName: H.Close,
						size: 24
					})
				})]
			}), /* @__PURE__ */ X(xy, {
				compact: t,
				type: "button",
				disabled: E.disabled || b,
				loading: b && E.kind === "save",
				"aria-label": E.label,
				onClick: () => {
					E.kind === "pause" ? w("paused") : E.kind === "resume" ? w("active") : C(!0);
				},
				children: /* @__PURE__ */ X(R, { iconName: E.icon })
			})]
		})]
	});
}
function tb(e, t) {
	return e?.status === "active" ? {
		kind: "pause",
		label: "Pause goal",
		icon: H.Pause,
		disabled: !1
	} : e && e.status !== "complete" ? {
		kind: "resume",
		label: "Resume goal",
		icon: H.Play,
		disabled: !1
	} : {
		kind: "save",
		label: e?.status === "complete" ? "Replace goal" : "Create goal",
		icon: H.ArrowTop,
		disabled: t
	};
}
// src/app/components/inspector/SessionUsage.tsx
function nb({ context: e, contextShare: t, input: n, output: r, cacheRead: i = null, cost: a, running: o, startedAt: s, lastElapsedMs: c, environment: l = null, compact: u = !1 }) {
	let [d, f] = J(!1), p = Jn(1e3, o), m = o && s != null ? Math.max(0, p - s) : c, h = [
		["Context tokens", e],
		["Input tokens", n],
		["Output tokens", r],
		...i ? [["Cache read tokens", i]] : [],
		["Session cost", a],
		[o ? "Run elapsed" : "Last response time", Wr(m)],
		...l ? [["Environment", l]] : []
	];
	return /* @__PURE__ */ X(x, {
		open: d,
		onClose: () => f(!1),
		sticky: !0,
		placement: M.BottomLeft,
		size: Le.Small,
		className: "shrink-0",
		sheetClassName: "px-4",
		content: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2 p-1",
			children: [/* @__PURE__ */ X("dl", {
				className: "grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-micro",
				children: h.map(([e, t]) => /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X("dt", {
					className: "text-basic-tertiary",
					children: e
				}), /* @__PURE__ */ X("dd", {
					className: "text-right text-basic-primary",
					children: t
				})] }, e))
			}), t ? /* @__PURE__ */ X("p", {
				className: "text-micro text-basic-muted",
				children: t
			}) : null]
		}),
		children: u ? /* @__PURE__ */ X(z, {
			variant: B.Ghost,
			size: U.Small,
			content: g.Icon,
			"aria-label": "Usage",
			"aria-expanded": d,
			onClick: () => f(!d),
			children: /* @__PURE__ */ X(R, {
				iconName: H.Timelaps,
				size: 16
			})
		}) : /* @__PURE__ */ Z(z, {
			variant: B.Tertiary,
			size: U.Small,
			content: g.IconLeft,
			"aria-expanded": d,
			onClick: () => f(!d),
			children: [/* @__PURE__ */ X(R, {
				iconName: H.Timelaps,
				size: 16
			}), "Usage"]
		})
	});
}
// src/app/components/inspector/SubagentChatInputBox.tsx
var rb = "Send a message", ib = "The subagent keeps working after you leave this chat. Steer or stop it from here.", ab = 40, ob = 180;
function sb({ value: e, onChange: t, onSubmit: n, onStop: r, running: i, background: a, onBackgroundChange: o, busy: s = !1, starting: c = !1, permission: l, floating: u = !1 }) {
	let d = N(), f = q(null), [p, m] = J(!1), h = e.trim().length > 0, g = h && (i || !c), _ = d && !p && h, v = i ? a ? "Running in the background" : "Regular run" : "Run in the background", y = d ? i ? "py-2 pr-2 pl-3" : "px-3 py-2" : i ? "py-3 pr-2 pl-4" : "px-4 py-3";
	return pi(() => {
		let e = f.current;
		e && (_ ? e.style.height = `${ab}px` : (e.style.height = "auto", e.style.height = `${Math.min(e.scrollHeight, ob)}px`));
	}, [_, e]), /* @__PURE__ */ Z(vy, {
		compact: d,
		faded: u,
		className: u ? void 0 : "p-0",
		onSubmit: (e) => {
			e.preventDefault(), !s && g && n();
		},
		children: [/* @__PURE__ */ Z("div", {
			className: "flex items-end gap-2",
			children: [/* @__PURE__ */ Z(yy, {
				compact: d,
				outline: p ? "focus" : void 0,
				children: [/* @__PURE__ */ Z("div", {
					className: "relative min-w-0 flex-1",
					children: [/* @__PURE__ */ X("textarea", {
						ref: f,
						rows: 1,
						value: e,
						placeholder: rb,
						"aria-label": rb,
						disabled: s,
						className: I("block w-full resize-none bg-transparent text-medium text-input outline-none placeholder:text-input-placeholder focus:placeholder:text-transparent", y, _ && "overflow-hidden opacity-0"),
						onChange: (e) => t(e.target.value),
						onFocus: () => m(!0),
						onBlur: () => m(!1),
						onKeyDown: (e) => {
							e.nativeEvent.isComposing || e.key !== "Enter" || e.shiftKey || (!d || e.metaKey || e.ctrlKey) && (e.preventDefault(), g && !s && n());
						}
					}), _ ? /* @__PURE__ */ X("div", {
						"aria-hidden": !0,
						className: I("pointer-events-none absolute inset-0 flex items-center", y),
						children: /* @__PURE__ */ X("span", {
							className: "w-full truncate text-medium text-input",
							children: e
						})
					}) : null]
				}), i ? /* @__PURE__ */ X(by, {
					compact: d,
					type: "button",
					variant: B.Ghost,
					disabled: s,
					onClick: r,
					"aria-label": "Stop",
					children: /* @__PURE__ */ X(R, {
						iconName: H.Stop,
						size: 24
					})
				}) : null]
			}), /* @__PURE__ */ X(xy, {
				compact: d,
				type: "submit",
				disabled: s || !g,
				"aria-label": i ? "Steer" : "Send",
				children: /* @__PURE__ */ X(R, { iconName: H.ArrowTop })
			})]
		}), /* @__PURE__ */ Z("div", {
			className: "flex min-h-6 items-center gap-2.5",
			children: [/* @__PURE__ */ Z("div", {
				className: "flex min-w-0 flex-1 items-center gap-2",
				children: [
					i ? null : /* @__PURE__ */ X(pd, {
						size: d ? ld.Large : ld.Medium,
						checked: a,
						disabled: s || c,
						"aria-label": "Run in the background",
						onChange: o
					}),
					/* @__PURE__ */ X("span", {
						className: I("truncate", d ? "label-small" : "label-micro", i && a ? "text-info-primary" : i ? "text-basic-tertiary" : "text-basic-primary"),
						children: v
					}),
					/* @__PURE__ */ X(zi, {
						title: v,
						description: ib,
						muted: !0
					})
				]
			}), l]
		})]
	});
}
// src/app/components/inspector/SubagentComposer.tsx
function cb({ recovery: e, hasDraft: t, onRestore: n, onDismiss: r }) {
	let { copy: i, copied: a } = Kr();
	return /* @__PURE__ */ Z("div", {
		className: "rounded-[4px] bg-elevation-level-2 p-3 text-small",
		children: [
			/* @__PURE__ */ X("p", {
				role: "status",
				children: e.status === "pending" ? "Sending message…" : e.status === "not-sent" ? "Message was not sent." : "Message delivery is unconfirmed. Check the transcript before sending it again."
			}),
			/* @__PURE__ */ X("p", {
				className: "max-h-32 overflow-auto whitespace-pre-wrap break-words",
				children: e.text
			}),
			e.status === "pending" ? null : /* @__PURE__ */ Z("div", {
				className: "mt-2 flex flex-wrap gap-2",
				children: [
					/* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						variant: B.Ghost,
						disabled: t,
						onClick: n,
						children: "Restore to composer"
					}),
					/* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						variant: B.Ghost,
						onClick: () => i(e.text),
						children: a ? "Copied" : "Copy message"
					}),
					/* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						variant: B.Ghost,
						onClick: r,
						children: "Dismiss"
					})
				]
			}),
			e.status !== "pending" && t ? /* @__PURE__ */ X("p", {
				className: "text-basic-tertiary",
				children: "Your current draft is preserved. Clear it before restoring this message."
			}) : null
		]
	});
}
function lb({ parentSessionId: e, target: t, permissionSessionId: n, permissionBehavior: r, requesterLabel: i, showPermissions: a = !0, floating: o = !1 }) {
	let s = nr(), c = Ft(), l = Et(), u = ri(), d = Qe(), f = V().stores.promptDraftStore, p = f.useDraft(t.id), m = f.useRecoveries(t.id), h = f.useSubmitting(t.id), [g, _] = J(null), v = g ?? t.background, y = t.status === "running", b = f.useCancelling(t.id), x = async () => {
		let n = f.get(t.id), r = n.text.trim();
		if (!r) return;
		let i = f.claimSubmission(t.id);
		if (!i && !y) return;
		let a = null;
		try {
			if (a = f.retainSubmission(t.id, n), !a) return;
			f.acknowledge(t.id, n), t.mode === "orchestrator" ? await l.mutateAsync({
				sessionId: e,
				payload: {
					description: t.description,
					prompt: r,
					background: v,
					orchestrator_session_id: t.id
				}
			}) : await c.mutateAsync({
				sessionId: e,
				payload: {
					profile: "general",
					description: t.description,
					prompt: r,
					background: v,
					child_session_id: t.id
				}
			}), f.settleSubmission(t.id, a, "confirmed");
		} catch (e) {
			a && f.settleSubmission(t.id, a, "uncertain"), s.error(`Unable to update the subagent: ${Vt(Ud(e))}`);
		} finally {
			i?.();
		}
	}, S = async () => {
		let n = f.claimCancellation(t.id);
		if (n) try {
			t.mode === "child" ? await u.mutateAsync({
				sessionId: e,
				childId: t.id
			}) : await d.mutateAsync({
				sessionId: e,
				orchestratorId: t.id
			});
		} catch (e) {
			s.error(`Unable to stop the subagent: ${Vt(Ud(e))}`);
		} finally {
			n();
		}
	};
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X(sb, {
			value: p.text,
			onChange: (e) => f.update(t.id, e),
			onSubmit: () => void x(),
			onStop: () => void S(),
			running: y,
			background: y ? t.background : v,
			onBackgroundChange: _,
			busy: b,
			starting: h,
			floating: o,
			permission: a ? /* @__PURE__ */ X(Uy, {
				sessionId: n,
				behavior: r,
				autoApprovalAvailable: !1,
				retryParentSessionId: t.mode === "child" ? e : void 0,
				poll: y,
				requesterLabel: i
			}) : null
		}), m.length ? /* @__PURE__ */ X("div", {
			role: "region",
			"aria-label": "Subagent message delivery",
			className: "pointer-events-auto flex max-h-48 flex-col gap-2 overflow-y-auto",
			children: m.map((e) => /* @__PURE__ */ X(cb, {
				recovery: e,
				hasDraft: !!p.text,
				onRestore: () => f.restoreRecovery(t.id, e),
				onDismiss: () => f.dismissRecovery(t.id, e)
			}, e.id))
		}) : null]
	});
}
function ub({ parentSessionId: e, sessionId: t, kind: n, description: r, behavior: i }) {
	let a = n === "managed-orchestrator", o = qe(e, !a), s = xt(e, a), c = a ? s.data?.find((e) => e.orchestrator_session_id === t) : o.data?.find((e) => e.child_session_id === t), l = {
		mode: a ? "orchestrator" : "child",
		id: t,
		description: c?.description || r || "Subagent",
		status: c?.status ?? "idle",
		background: c?.execution_mode !== "foreground"
	};
	return /* @__PURE__ */ X(lb, {
		parentSessionId: e,
		target: l,
		permissionSessionId: t,
		permissionBehavior: a ? "orchestrator" : i ?? "direct",
		requesterLabel: a ? void 0 : `child agent “${l.description}”`,
		floating: !0
	}, `${l.mode}:${l.id}`);
}
// src/app/hooks/usePromptHistoryPreview.ts
var db = 40;
function fb(e) {
	let t = e.trim();
	if (!t) return "[empty]";
	let n = t.split("\n")[0] ?? "";
	return n.length <= db ? n : `${n.slice(0, db)}…`;
}
function pb({ prompts: e, value: t, enabled: n, setValue: r, textareaRef: i, afterCommit: a }) {
	let [o, s] = J(-1), [c, l] = J(-1), u = n && o >= 0 && o < e.length, d = u ? e[o] ?? "" : "", f = W(() => {
		s(-1), l(-1);
	}, []), p = W(() => {
		r(d), s(-1), requestAnimationFrame(() => {
			let e = i.current;
			e && (e.selectionStart = d.length, e.selectionEnd = d.length, a?.());
		});
	}, [
		a,
		d,
		r,
		i
	]), m = W((r) => !n || r.nativeEvent.isComposing ? !1 : r.key === "ArrowUp" && e.length > 0 ? t !== "" && !u ? !1 : (r.preventDefault(), s(Math.min((u ? o : -1) + 1, e.length - 1)), !0) : u ? r.key === "ArrowDown" ? (r.preventDefault(), s(o - 1 >= 0 ? o - 1 : -1), !0) : r.key === "Tab" ? (r.preventDefault(), p(), !0) : r.key === "Escape" && (r.preventDefault(), s(-1), !0) : !1, [
		u,
		p,
		n,
		o,
		e.length,
		t
	]), h = W((e) => {
		n && (o >= 0 && e !== "" ? (l(o), s(-1)) : e === "" && c >= 0 && (s(c), l(-1)));
	}, [
		n,
		o,
		c
	]);
	return K(() => ({
		active: u,
		previewText: u ? fb(d) : "",
		onKeyDown: m,
		onValueChange: h,
		reset: f
	}), [
		u,
		d,
		m,
		h,
		f
	]);
}
// src/app/lib/skillReferences.ts
var mb = /[\p{Alphabetic}\p{Number}_-]/u;
function hb(e, t) {
	return t >= e.length ? null : e.slice(t)[Symbol.iterator]().next().value ?? null;
}
function gb(e, t) {
	let n = hb(e, t);
	return n === null || !mb.test(n);
}
function _b(e) {
	return [...e].sort((e, t) => t.name.length - e.name.length || e.name.localeCompare(t.name));
}
function vb(e, t) {
	if (!e || t.length === 0) return [{
		text: e,
		skillName: null
	}];
	let n = _b(t), r = [], i = 0, a = 0;
	for (;;) {
		let t = e.indexOf("$", a);
		if (t === -1) break;
		let o = t + 1, s = n.find((t) => e.startsWith(t.name, o) && gb(e, o + t.name.length));
		if (!s) {
			a = o;
			continue;
		}
		t > i && r.push({
			text: e.slice(i, t),
			skillName: null
		});
		let c = o + s.name.length;
		r.push({
			text: e.slice(t, c),
			skillName: s.name
		}), i = c, a = c;
	}
	return (i < e.length || r.length === 0) && r.push({
		text: e.slice(i),
		skillName: null
	}), r;
}
function yb(e, t, n, r) {
	if (t === 0 || t !== n || r.length === 0 || !gb(e, n)) return null;
	let i = r.reduce((e, t) => Math.max(e, t.name.length), 0), a = Math.max(0, t - i - 1), o = e.lastIndexOf("$", t - 1), s = null;
	for (; o >= a;) {
		let n = e.slice(o + 1, t).toLocaleLowerCase(), i = r.filter((e) => e.name.toLocaleLowerCase().startsWith(n));
		i.length > 0 && (s = {
			start: o,
			end: t,
			entries: i
		}), o = o === 0 ? -1 : e.lastIndexOf("$", o - 1);
	}
	return s;
}
// src/app/components/inspector/ChatInputBox.tsx
var bb = "Send a message", xb = {
	mobile: 40,
	wide: 48
}, Sb = 180;
function Cb(e) {
	let t = /^(\s*)\/(\S*)$/u.exec(e);
	if (!t || t[0] !== e) return null;
	let n = t[2];
	return n.includes("/") || n.includes("\\") ? null : {
		leadingWhitespace: t[1],
		prefix: n
	};
}
function wb(e, t) {
	let n = e.trim();
	if (!n.startsWith("/")) return null;
	let r = n.slice(1), i = r.search(/\s/u), a = i === -1 ? r : r.slice(0, i), o = i === -1 ? "" : r.slice(i).trim();
	return t.find((e) => e.name === a && (e.accepts_arguments || !o)) ?? null;
}
function Tb(e, t, n, r) {
	return `${e}:${n}:${r}:${t}`;
}
var Eb = { WebkitTextStroke: "0.45px currentColor" };
function Db(e) {
	return e.map((e, t) => e.skillName ? /* @__PURE__ */ X("strong", {
		className: "[font-weight:inherit] text-danger-primary",
		style: Eb,
		children: e.text
	}, `${e.skillName}-${t}`) : /* @__PURE__ */ X("span", { children: e.text }, t));
}
function Ob({ sessionId: e, snapshot: t, entry: n }) {
	let i = V(), o = ly(i, e), { useSshConnectionStatus: s, sshTargetFromSummary: c, markSshDisconnected: l, markSshConnected: d } = V().stores.sshConnectionStore, { useSessionSpend: p, useRunning: m, useRunUsage: h, useRunStartedAt: _, useLastElapsedMs: v, useCancelArmed: y, pushLocalEvent: b, liftSessionSpend: S, captureRuntimeActivation: C } = V().stores.runtimeStore, { consumePromptRequests: w, consumeDraftRequests: T, shellIntents: D } = V().stores.composerStore;
	u("ChatInputBox");
	let O = i.stores.promptDraftStore, { text: k } = O.useDraft(e), ee = O.useSubmitting(e), A = W((t) => {
		O.update(e, t);
	}, [O, e]), j = N(), [ne, re] = J(!1), [ie, ae] = J({
		start: 0,
		end: 0
	}), [oe, se] = J(null), [ce, ue] = J(0), [de, fe] = J(null), pe = j ? xb.mobile : xb.wide, P = m(e), me = y(e), F = nr(), he = Bm(), ge = Rr(), _e = hy(e), L = xn(), ye = tr(), be = le(), xe = ln(), Se = Ce(), we = n?.summary.behavior ?? t?.metadata.behavior ?? null, Te = we === "direct" || we === "direct-with-orchestrator", Ee = n?.lineage ?? t?.lineage ?? null, De = Ee != null, Oe = n !== null || t !== null, ke = mr(e, Te && !De), { data: Ae, refetch: je } = ve(e, Te && !De), Me = gt(), Ne = r(), Pe = f(), [Fe, Ie] = J(!1), [Le, Re] = J(e);
	Le !== e && (Re(e), Ie(!1));
	let ze = W(() => {
		re(!1), Ie(!0);
	}, []), { data: Ve, isError: He, refetch: We } = tt(e), { data: Ge, isError: Ke } = Gr(e), qe = q(null), Je = q(null), Ye = q(null), Xe = q([]), Ze = fi(), Qe = h(), $e = p();
	G(() => {
		S(Be(t));
	}, [S, t]);
	let nt = a(t, n, P || me ? Qe : null, $e), rt = n?.summary.backend ?? t?.metadata.backend ?? null, ot = Rt(), st = Be(t), ct = nt.usage?.total_tokens || st?.total_tokens || null, lt = _(), ut = v(), dt = c(n?.summary), ft = s(dt), pt = at(), mt = Nn(n?.summary) === "SSH", ht = P && Te && !De, _t = P && we === "orchestrator" && !De, vt = ht || _t, yt = ee || ge.isPending || _e.isPending || L.isPending || ye.isPending || be.isPending || xe.isPending || Se.isPending || Me.isPending || Ne.isPending || Pe.isPending, bt = yt || me || P && !vt, xt = !!k.trim() && !bt, St = (ke.data ?? []).filter((e) => e.status === "pending"), Ct = async (t, n, r) => {
		try {
			await xe.mutateAsync({
				sessionId: e,
				itemId: t,
				expectedVersion: n,
				delivery: r
			});
		} catch (e) {
			F.error(`Unable to change pending message: ${Vt(Ud(e))}`);
		}
	}, wt = async (t, n) => {
		try {
			await Se.mutateAsync({
				sessionId: e,
				itemId: t,
				expectedVersion: n
			});
		} catch (e) {
			F.error(`Unable to cancel pending message: ${Vt(Ud(e))}`);
		}
	}, Tt = W(() => {
		let e = qe.current;
		e && (e.style.height = `${pe}px`, e.style.height = `${Math.min(e.scrollHeight, Sb)}px`);
	}, [pe]);
	pi(() => {
		let e = Ye.current, t = qe.current;
		e !== null && t && (Ye.current = null, Tt(), t.focus(), t.setSelectionRange(e, e));
	}, [Tt, k]);
	let Et = pb({
		prompts: K(() => {
			let e = [];
			for (let n of t?.messages ?? []) n.role === "user" && e.push(qt(n.content));
			return e.reverse();
		}, [t?.messages]),
		value: k,
		enabled: !j,
		setValue: A,
		textareaRef: qe,
		afterCommit: Tt
	}), Dt = Et.reset, Ot = fi();
	G(() => Dt(), [e, Dt]);
	let kt = K(() => Cb(k), [k]), At = K(() => {
		if (!kt || !Ve) return [];
		let e = kt.prefix.toLocaleLowerCase();
		return Ve.filter((t) => (t.name !== "goal" || Te) && t.name.toLocaleLowerCase().startsWith(e));
	}, [
		Ve,
		kt,
		Te
	]), jt = K(() => yb(k, ie.start, ie.end, Ge ?? []), [
		ie,
		Ge,
		k
	]), Mt = K(() => {
		if (kt !== null || Ge !== void 0 || ie.start === 0 || ie.start !== ie.end) return null;
		let e = k.lastIndexOf("$", ie.start - 1);
		return e === -1 ? null : {
			start: e,
			end: ie.end
		};
	}, [
		kt,
		ie,
		Ge,
		k
	]), Nt = kt ? "slash" : jt || Mt ? "skill" : null, Pt = K(() => Nt === "slash" ? At.map((e) => ({
		kind: "slash",
		key: e.command,
		name: `/${e.name}`,
		description: e.description,
		definition: e
	})) : Nt === "skill" && jt ? jt.entries.map((e) => ({
		kind: "skill",
		key: e.name,
		name: `$${e.name}`,
		description: e.description,
		definition: e
	})) : [], [
		At,
		jt,
		Nt
	]), Ft = Nt === "slash" ? Tb("slash", k, 0, k.length) : Nt === "skill" ? Tb("skill", k, jt?.start ?? Mt?.start ?? ie.start, jt?.end ?? Mt?.end ?? ie.end) : null, It = ne && Nt !== null && Ft !== oe, Lt = Math.min(ce, Math.max(Pt.length - 1, 0)), zt = de !== null && de < Pt.length ? de : Lt, Bt = It ? Pt[zt] : void 0, Ht = Bt ? `${Ze}-option-${zt}` : void 0, Ut = W((e) => {
		Bt && e.preventDefault();
	}, [Bt]);
	G(() => {
		It && Xe.current[Lt]?.scrollIntoView({ block: "nearest" });
	}, [
		Lt,
		It,
		Pt
	]);
	let Wt = W(() => {
		se(Ft), fe(null);
	}, [Ft]), Gt = W((e) => {
		let t, n, r;
		if (e.kind === "slash") {
			if (!kt) return;
			t = `${kt.leadingWhitespace}/${e.definition.name}${e.definition.accepts_arguments ? " " : ""}`, n = t.length, r = Tb("slash", t, 0, t.length);
		} else {
			if (!jt) return;
			let i = `$${e.definition.name}`;
			t = `${k.slice(0, jt.start)}${i}${k.slice(jt.end)}`, n = jt.start + i.length, r = Tb("skill", t, jt.start, n);
		}
		t === k ? (Ye.current = null, Tt(), qe.current?.focus(), qe.current?.setSelectionRange(n, n)) : (Ye.current = n, A(t)), ae({
			start: n,
			end: n
		}), se(r), fe(null);
	}, [
		kt,
		Tt,
		A,
		jt,
		k
	]), Kt = K(() => vb(k, Ge ?? []), [Ge, k]), Jt = !Et.active && Kt.some((e) => e.skillName !== null);
	pi(() => {
		let e = qe.current, t = Je.current;
		Jt && e && t && (t.scrollTop = e.scrollTop, t.scrollLeft = e.scrollLeft);
	}, [Jt, k]), G(() => Tt(), [Tt, k]);
	let Yt = W(async () => {
		if (dt && !pt.isPending) try {
			await pt.mutateAsync(dt), d(dt);
		} catch (e) {
			l(dt), F.error(`SSH reconnect failed: ${Vt(Ud(e))}`);
		}
	}, [
		dt,
		pt,
		d,
		l,
		F
	]), Xt = W(async (t) => {
		if (!Te) throw Error("Durable goals are available only in direct chats");
		let n = C(e), r = Ae;
		if (r === void 0) {
			let e = await je();
			if (!n()) return !1;
			if (e.error) throw e.error;
			r = e.data;
		}
		let i = t.trim().slice(5).trim();
		if (i === "" || i === "edit") ze();
		else if (i === "clear") {
			if (!r) throw Error("There is no durable goal to clear");
			await Pe.mutateAsync({
				sessionId: e,
				goalId: r.goal_id,
				expectedVersion: r.version
			});
		} else if (i === "pause" || i === "resume") {
			if (!r) throw Error(`There is no durable goal to ${i}`);
			await Ne.mutateAsync({
				sessionId: e,
				goalId: r.goal_id,
				payload: {
					expected_version: r.version,
					status: i === "pause" ? "paused" : "active"
				}
			});
		} else {
			if (r && r.status !== "complete") throw Error("An unfinished durable goal already exists; use /goal edit or /goal clear first");
			await Me.mutateAsync({
				sessionId: e,
				payload: { objective: i }
			});
		}
	}, [
		C,
		Pe,
		Me,
		Te,
		ze,
		Ae,
		je,
		e,
		Ne
	]), Zt = W(async (n, r) => {
		let i = n ?? k, a = cy(i), s = a.kind === "prompt" ? a.prompt.trim() : i.trim();
		if (!s || bt) return;
		let c = n === void 0 || r !== void 0, l = O.get(e), u = C(e), d = () => {
			c && O.acknowledge(e, l) && u() && (ae({
				start: 0,
				end: 0
			}), Dt(), qe.current && (qe.current.style.height = `${pe}px`));
		}, f = O.claimSubmission(e);
		if (f) try {
			if (a.kind === "command") {
				let n = o.current, r = () => u() && !!n?.current(), i = D.get(e)?.phase === "uncertain" && D.get(e)?.request.command === a.command;
				if (!Te || De || !i && (P || (t?.shell_commands ?? []).some((e) => e.state === "accepted" || e.state === "started"))) {
					F.error("Shell commands require an idle direct-primary chat");
					return;
				}
				if (!a.command.trim()) {
					F.error("Enter a command after !");
					return;
				}
				try {
					await _e.mutateAsync(a.command), d();
				} catch (e) {
					r() && F.error(`Command outcome: ${Vt(Ud(e))}`);
				}
				return;
			}
			let n = Ve;
			if (i.trimStart().startsWith("/") && n === void 0) {
				let e = await We();
				if (!u()) return;
				if (n = e.data, n === void 0) {
					F.error("Unable to load slash commands");
					return;
				}
			}
			let c = n ? wb(i, n) : null;
			if (c?.command === "compact") {
				try {
					if (await ye.mutateAsync(e), d(), !u()) return;
					b("compaction", "▶ compacting context…");
				} catch (e) {
					if (!u()) return;
					b("error", `compact failed: ${Vt(Ud(e))}`, !0), F.error(`Failed to compact: ${nf(Ud(e), rt)}`);
				}
				return;
			}
			if (c?.command === "goal") {
				try {
					await Xt(s) !== !1 && d();
				} catch (e) {
					if (!u()) return;
					F.error(`Goal command failed: ${nf(Ud(e))}`);
				}
				return;
			}
			if (c && c.command !== "mcp_prompt") {
				F.error(`Unsupported slash command: /${c.name}`);
				return;
			}
			try {
				let t = await te(Ue({
					mode: ht ? "direct-running" : _t ? "classic-running" : "idle",
					delivery: r,
					inbox: (t) => be.mutateAsync({
						sessionId: e,
						delivery: t,
						prompt: s
					}),
					steer: () => L.mutateAsync({
						id: e,
						instruction: s
					}),
					submit: () => ge.mutateAsync({
						id: e,
						prompt: s
					})
				}));
				if (d(), !u()) return;
				t === "submitted" ? b("run", `▶ submitted: ${s.slice(0, 80)}`) : (ht || r) && b("steering", `▶ ${r ?? "steer"}: ${s.slice(0, 80)}`);
			} catch (e) {
				if (!u()) return;
				b("error", `submit failed: ${Vt(Ud(e))}`, !0), F.error(`Failed to send: ${nf(Ud(e), rt)}`);
			}
		} finally {
			f();
		}
	}, [
		k,
		O,
		bt,
		C,
		e,
		Dt,
		pe,
		Ve,
		We,
		_e,
		D,
		o,
		Te,
		De,
		P,
		t?.shell_commands,
		F,
		ye,
		b,
		rt,
		Xt,
		ht,
		_t,
		be,
		L,
		ge
	]);
	G(() => w((e) => void Zt(e)), [w, Zt]), G(() => {
		let t, n = T(e, (e) => {
			A(e), t !== void 0 && cancelAnimationFrame(t), t = requestAnimationFrame(() => qe.current?.focus());
		});
		return () => {
			n(), t !== void 0 && cancelAnimationFrame(t);
		};
	}, [
		e,
		T,
		A
	]);
	let Qt = W(async () => {
		await he.stopRun(e);
	}, [he, e]), $t = !!k.trim(), en = (P || me) && !$t, tn = /* @__PURE__ */ X(xy, {
		compact: j,
		type: en ? "button" : "submit",
		disabled: me || !en && !xt,
		loading: me,
		"aria-label": me ? "Stopping run" : P && !$t ? "Stop run" : vt ? "Steer active run" : "Send",
		onPointerDown: Ut,
		onClick: P && !$t && !me ? () => void Qt() : void 0,
		children: /* @__PURE__ */ X(R, { iconName: en ? H.Stop : H.ArrowTop })
	}), nn = Te && (!j || !ne && !k), rn = j ? nn ? "py-2 pr-2 pl-3" : "px-3 py-2" : nn ? "py-3 pr-2 pl-4" : "px-4 py-3", an = It ? Nt === "slash" ? Ve === void 0 ? He ? "Slash commands unavailable" : "Loading slash commands" : Pt.length ? `${Pt.length} slash ${Pt.length === 1 ? "command" : "commands"} available` : "No matching commands" : Ge === void 0 ? Ke ? "Skills unavailable" : "Loading skills" : `${Pt.length} ${Pt.length === 1 ? "skill" : "skills"} available` : "", on = /* @__PURE__ */ Z(yy, {
		compact: j,
		outline: ne ? "focus" : void 0,
		children: [/* @__PURE__ */ Z("div", {
			className: "relative flex-1 min-w-0",
			children: [
				/* @__PURE__ */ X("span", {
					className: "sr-only",
					role: "status",
					"aria-live": "polite",
					"aria-atomic": "true",
					children: an
				}),
				Jt ? /* @__PURE__ */ Z("div", {
					ref: Je,
					"aria-hidden": "true",
					className: I("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-medium text-input [scrollbar-gutter:stable]", rn),
					children: [Db(Kt), k.endsWith("\n") ? " " : null]
				}) : null,
				/* @__PURE__ */ X("textarea", {
					ref: qe,
					className: I("relative block w-full bg-transparent resize-none border-none outline-none text-medium text-input placeholder:text-input-placeholder placeholder:whitespace-nowrap focus:placeholder:text-transparent [scrollbar-gutter:stable]", rn),
					rows: 1,
					role: "combobox",
					"aria-label": "Message",
					"aria-autocomplete": "list",
					"aria-haspopup": "listbox",
					"aria-expanded": It,
					"aria-controls": It ? Ze : void 0,
					"aria-activedescendant": Ht,
					"aria-describedby": Et.active ? Ot : void 0,
					enterKeyHint: j ? "enter" : void 0,
					placeholder: Et.active ? "" : bb,
					spellCheck: !1,
					value: k,
					style: {
						minHeight: `${pe}px`,
						maxHeight: `${Sb}px`,
						color: Jt ? "transparent" : void 0,
						caretColor: Jt ? "var(--color-text-input)" : void 0
					},
					onChange: (e) => {
						e.target.value !== k && se(null), ue(0), fe(null), Et.onValueChange(e.target.value), A(e.target.value), ae({
							start: e.target.selectionStart,
							end: e.target.selectionEnd
						}), Tt();
					},
					onSelect: (e) => {
						let t = {
							start: e.currentTarget.selectionStart,
							end: e.currentTarget.selectionEnd
						};
						(t.start !== ie.start || t.end !== ie.end) && (ue(0), fe(null), ae(t));
					},
					onScroll: (e) => {
						Je.current && (Je.current.scrollTop = e.currentTarget.scrollTop, Je.current.scrollLeft = e.currentTarget.scrollLeft);
					},
					onFocus: (e) => {
						re(!0), ae({
							start: e.currentTarget.selectionStart,
							end: e.currentTarget.selectionEnd
						});
					},
					onBlur: () => {
						re(!1), fe(null), Dt();
					},
					onKeyDown: (e) => {
						if (!e.nativeEvent.isComposing && (e.key !== "Enter" || !j || e.metaKey || e.ctrlKey)) {
							if (It && !e.shiftKey) {
								if (e.key === "Escape") {
									e.preventDefault(), Wt();
									return;
								}
								if ((e.key === "ArrowDown" || e.key === "ArrowUp") && Pt.length) {
									e.preventDefault(), ue(e.key === "ArrowDown" ? Math.min(zt + 1, Pt.length - 1) : Math.max(zt - 1, 0)), fe(null);
									return;
								}
								if (e.key === "Tab" && Bt) {
									e.preventDefault(), Gt(Bt);
									return;
								}
								if (e.key === "Enter" && (Bt || Nt === "slash")) {
									e.preventDefault(), Bt && Gt(Bt);
									return;
								}
							}
							Et.onKeyDown(e) || e.key === "Enter" && (e.shiftKey || (e.preventDefault(), Zt()));
						}
					}
				}),
				Et.active ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("span", {
					id: Ot,
					className: "sr-only",
					children: "Press Tab to take this prompt, Escape to leave it, or start typing to dismiss it"
				}), /* @__PURE__ */ Z("div", {
					className: I("pointer-events-none absolute inset-0 flex items-center gap-2", rn),
					children: [/* @__PURE__ */ X("span", {
						className: "min-w-0 truncate text-medium text-input-placeholder",
						children: Et.previewText
					}), /* @__PURE__ */ X(Bn, {
						keys: ["tab"],
						spelled: !0,
						className: "shrink-0"
					})]
				})] }) : null
			]
		}), nn ? /* @__PURE__ */ X($y, {
			compact: j,
			sessionId: e,
			onOpen: ze
		}) : null]
	}), sn = /* @__PURE__ */ X("div", {
		id: Ze,
		role: "listbox",
		"aria-label": Nt === "skill" ? "Skills" : "Slash commands",
		children: Nt === "slash" && Ve === void 0 ? /* @__PURE__ */ X("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: He ? "Slash commands unavailable" : "Loading commands…"
		}) : Nt === "skill" && Ge === void 0 ? /* @__PURE__ */ X("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: Ke ? "Skills unavailable" : "Loading skills…"
		}) : Pt.length ? Pt.map((e, t) => /* @__PURE__ */ Z("button", {
			id: `${Ze}-option-${t}`,
			ref: (e) => {
				Xe.current[t] = e;
			},
			type: "button",
			role: "option",
			"aria-selected": t === zt,
			tabIndex: -1,
			className: I("flex min-h-10 w-full items-center gap-3 rounded-[4px] px-3 py-2 text-left", t === zt ? "btn-ghost-highlighted" : "btn-ghost"),
			onPointerDown: (e) => e.preventDefault(),
			onPointerMove: () => fe(t),
			onPointerLeave: () => fe((e) => e === t ? null : e),
			onClick: () => Gt(e),
			children: [/* @__PURE__ */ X("span", {
				className: "code code-small shrink-0 text-basic-primary",
				children: e.name
			}), /* @__PURE__ */ X("span", {
				className: I("min-w-0 flex-1 text-small text-basic-secondary", e.kind === "skill" && "truncate"),
				children: e.description
			})]
		}, `${e.kind}-${e.key}`)) : /* @__PURE__ */ X("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: "No matching commands"
		})
	}), cn = /* @__PURE__ */ X(x, {
		open: It,
		onClose: Wt,
		content: sn,
		placement: M.TopRight,
		sticky: !0,
		closeOnEscape: !1,
		sheetOnMobile: !1,
		className: "min-w-0 flex-1",
		size: "w-[min(400px,calc(100vw-16px))]",
		panelClassName: "max-h-[min(40vh,320px)] overflow-y-auto",
		children: on
	});
	return Oe ? De && Ee ? /* @__PURE__ */ X(ub, {
		parentSessionId: Ee.parent_session_id,
		sessionId: e,
		kind: Ee.kind,
		description: Ee.description,
		behavior: we
	}) : /* @__PURE__ */ Z(vy, {
		compact: j,
		onSubmit: (e) => {
			e.preventDefault(), !Fe && (Bt ? Gt(Bt) : Zt());
		},
		children: [
			Fe && Te ? /* @__PURE__ */ X(eb, {
				sessionId: e,
				compact: j,
				onClose: () => Ie(!1)
			}) : /* @__PURE__ */ Z("div", {
				className: "flex items-end gap-2",
				children: [cn, tn]
			}),
			St.length ? /* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-2",
				"aria-label": "Pending messages",
				children: [/* @__PURE__ */ X("div", {
					className: "tag-label uppercase text-basic-secondary",
					children: "Pending messages"
				}), St.map((t) => /* @__PURE__ */ Z("div", {
					className: "flex flex-wrap items-center gap-2 rounded-[4px] border border-border-primary px-3 py-2",
					children: [
						/* @__PURE__ */ X("span", {
							className: "tag-label text-accent-primary",
							children: t.delivery
						}),
						t.terminal_selection ? /* @__PURE__ */ X(sy, {
							evidence: t.terminal_selection,
							canonicalText: t.prompt,
							sessionId: e
						}) : /* @__PURE__ */ X("span", {
							className: "min-w-0 flex-1 truncate text-small text-basic-primary",
							children: t.prompt
						}),
						/* @__PURE__ */ Z(z, {
							type: "button",
							size: U.Small,
							variant: B.Ghost,
							disabled: yt,
							onClick: () => void Ct(t.id, t.version, t.delivery === "steer" ? "queue" : "steer"),
							children: ["Change to ", t.delivery === "steer" ? "queue" : "steer"]
						}),
						/* @__PURE__ */ X(z, {
							type: "button",
							size: U.Small,
							variant: B.GhostDestructive,
							disabled: yt,
							onClick: () => void wt(t.id, t.version),
							children: "Cancel"
						})
					]
				}, t.id))]
			}) : null,
			/* @__PURE__ */ Z("div", {
				className: I("flex flex-wrap items-center gap-y-1", j ? "gap-x-2" : "gap-x-2.5"),
				children: [/* @__PURE__ */ Z("div", {
					className: I("flex grow min-w-0 flex-wrap items-center gap-y-1", j ? "gap-x-1" : "gap-x-2"),
					children: [
						ht ? /* @__PURE__ */ X(z, {
							type: "button",
							size: U.Small,
							variant: B.Secondary,
							disabled: !xt,
							onClick: () => void Zt(k, "queue"),
							children: "Queue Next"
						}) : null,
						/* @__PURE__ */ X("div", {
							className: "flex min-w-0 grow basis-[160px] max-w-fit",
							children: /* @__PURE__ */ X(wy, {
								sessionId: e,
								metadata: t?.metadata ?? null,
								label: nt.model,
								disabled: bt
							})
						}),
						mt ? /* @__PURE__ */ X(jm, {
							state: ft === "connected" ? "connected" : "reconnect",
							onReconnect: () => void Yt()
						}) : null
					]
				}), /* @__PURE__ */ Z("div", {
					className: I("ml-auto flex shrink-0 items-center", j ? "gap-3" : "gap-4"),
					children: [
						j ? /* @__PURE__ */ X(nb, {
							compact: !0,
							context: it(ct),
							contextShare: bf(ct, yf(ot.data, t?.metadata?.backend, nt.model)),
							input: it(nt.usage?.input_tokens),
							output: it(nt.usage?.output_tokens),
							cacheRead: nt.usage?.cache_read_tokens ? it(nt.usage.cache_read_tokens) : null,
							cost: et(nt.usage?.cost?.total),
							running: P,
							startedAt: lt,
							lastElapsedMs: ut ?? nt.lastResponseMs,
							environment: nt.env
						}) : null,
						/* @__PURE__ */ X(E, {
							title: "Session settings",
							position: M.TopLeft,
							children: /* @__PURE__ */ X(z, {
								type: "button",
								size: U.Small,
								variant: B.Ghost,
								content: g.Icon,
								"aria-label": "Session settings",
								onClick: () => he.settings(e),
								children: /* @__PURE__ */ X(R, {
									iconName: H.Gear,
									size: 16
								})
							})
						}),
						/* @__PURE__ */ X(Uy, {
							sessionId: e,
							behavior: we,
							compact: j
						})
					]
				})]
			})
		]
	}) : /* @__PURE__ */ X(vy, {
		compact: j,
		onSubmit: (e) => e.preventDefault(),
		children: /* @__PURE__ */ Z("div", {
			className: I("flex items-center gap-3 bg-elevation-level-3 text-small text-basic-secondary shadow-xl", j ? "min-h-10 rounded-[20px] px-3 py-1" : "min-h-12 rounded-[24px] px-4 py-2"),
			children: [/* @__PURE__ */ X("span", {
				className: "flex-1",
				children: "Loading session controls…"
			}), P && /* @__PURE__ */ X(z, {
				type: "button",
				size: U.Small,
				variant: B.GhostDestructive,
				content: g.Text,
				"aria-label": "Stop run",
				onClick: () => void Qt(),
				children: "Stop"
			})]
		})
	});
}
// src/app/components/inspector/sessionPanelIcons.ts
var kb = {
	sessions: H.Chat,
	insights: H.Eye,
	threads: H.Flow,
	delegated: H.Robot,
	files: H.Folders,
	terminal: H.Terminal,
	worksets: H.Checklist,
	history: H.History
};
function Ab(e, t, n) {
	return e === "delegated" ? t : e === "worksets" ? n : 0;
}
// src/app/components/inspector/MobileBottomBar.tsx
function jb({ panel: e, onPanelChange: t, panels: n = Zt }) {
	return /* @__PURE__ */ X("div", {
		className: "fade-from-bottom absolute inset-x-0 bottom-0 z-10 p-3 pointer-events-none",
		children: /* @__PURE__ */ X("div", {
			className: "flex items-center gap-[2px] w-full rounded-[12px] bg-elevation-level-3 shadow-2xl overflow-hidden pointer-events-auto",
			role: "tablist",
			children: n.map((n) => {
				let r = e === n;
				return /* @__PURE__ */ Z("button", {
					type: "button",
					role: "tab",
					"aria-selected": r,
					className: I("flex flex-col flex-1 min-w-0 items-center justify-center gap-[6px] h-16 rounded-[12px]", "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2", r ? "btn-primary" : "btn-ghost"),
					onClick: () => t(n),
					children: [/* @__PURE__ */ X(R, {
						iconName: kb[n],
						size: 20
					}), /* @__PURE__ */ X("span", {
						className: I("text-[11px] leading-[14px] font-medium truncate max-w-full", r ? null : "text-basic-primary"),
						children: Hn[n]
					})]
				}, n);
			})
		})
	});
}
// src/app/components/inspector/PanelCountBadge.tsx
function Mb({ count: e, className: t }) {
	return /* @__PURE__ */ X("span", {
		className: I("pointer-events-none absolute -top-1 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-elevation-ground-inverse px-0.5 text-[9px] leading-3 font-medium tracking-[-0.05em] text-primary-inverse", t),
		children: e
	});
}
function Nb({ sessionId: e, snapshot: t, behavior: n, panels: r, onOpen: i, onSelect: a }) {
	let o = Tt(), s = r.includes("delegated"), c = qe(e, s), l = xt(e, s && n === "direct-with-orchestrator"), u = (c.data?.length ?? 0) + (o.orchestrationEnabled ? l.data?.length ?? 0 : 0), d = t?.worksets?.items.length ?? 0;
	return /* @__PURE__ */ X("div", {
		className: "flex h-full flex-col items-center border-l border-tertiary py-2 pr-2 pl-[7px]",
		style: { width: 52 },
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col items-center gap-4 [&>*]:shrink-0",
			children: [/* @__PURE__ */ X(Pb, {
				label: "Show panel",
				onClick: i,
				children: /* @__PURE__ */ X(R, { iconName: H.SidebarChevronLeft })
			}), /* @__PURE__ */ X("div", {
				className: "flex flex-col items-center gap-4",
				children: r.map((e) => {
					let t = Ab(e, u, d);
					return /* @__PURE__ */ Z("span", {
						className: "relative",
						children: [/* @__PURE__ */ X(Pb, {
							label: Hn[e],
							onClick: () => a(e),
							children: /* @__PURE__ */ X(R, { iconName: kb[e] })
						}), t > 0 ? /* @__PURE__ */ X(Mb, { count: t }) : null]
					}, e);
				})
			})]
		})
	});
}
function Pb({ label: e, onClick: t, children: n }) {
	return /* @__PURE__ */ X(E, {
		title: e,
		position: M.CenterLeft,
		sticky: !0,
		children: /* @__PURE__ */ X(z, {
			variant: B.Ghost,
			content: g.Icon,
			"aria-label": e,
			onClick: t,
			children: n
		})
	});
}
// src/app/features/terminal/queries.ts
var Fb = {
	list: (e) => [
		"session",
		e,
		"user-terminals"
	],
	status: (e, t) => [
		"session",
		e,
		"user-terminal",
		t
	]
};
function Ib(e, t) {
	let { api: n } = V();
	return xi({
		queryKey: Fb.status(e, t),
		queryFn: ({ signal: r }) => n.getUserTerminal(e, t, r),
		retry: !1,
		refetchInterval: (e) => !e.state.data || e.state.data.alive || !e.state.data.output_complete ? 1e3 : !1
	});
}
function Lb(e) {
	let { api: t } = V(), n = Si();
	return yi({
		mutationFn: (n) => t.openUserTerminal(e, {
			protocol_version: 1,
			launch_id: n,
			cols: 80,
			rows: 24
		}),
		retry: !1,
		onSuccess: () => Promise.all([n.invalidateQueries({ queryKey: Fb.list(e) }), n.invalidateQueries({ queryKey: Rb.list(e) })])
	});
}
var Rb = { list: (e) => [
	"session",
	e,
	"executions"
] };
function zb(e) {
	let { api: t } = V();
	return xi({
		queryKey: Rb.list(e),
		queryFn: ({ signal: n }) => t.listExecutions(e, n),
		retry: !1,
		refetchInterval: 1e3
	});
}
function Bb(e, t) {
	let { api: n } = V(), r = Si();
	return yi({
		mutationFn: () => n.stopExecution(e, t),
		retry: !1,
		onSuccess: () => r.invalidateQueries({ queryKey: Rb.list(e) })
	});
}
// packages/nac-client/src/userTerminalInputPump.ts
var Vb = 16384, Hb = class extends Error {
	cause;
	constructor(e, t) {
		super(e), this.name = "TerminalInputNotSentError", this.cause = t;
	}
}, Ub = class {
	connection;
	abort = new AbortController();
	signal;
	cancelListener;
	pending;
	active = !1;
	failed;
	disposed = !1;
	constructor(e, t) {
		this.connection = e, this.signal = t ? AbortSignal.any([this.abort.signal, t]) : this.abort.signal, this.cancelListener = () => {
			this.disposed = !0, this.rejectPending(new Hb("Terminal input was not sent because its consumer closed", this.signal.reason));
		}, this.signal.addEventListener("abort", this.cancelListener, { once: !0 }), this.signal.aborted && this.cancelListener();
	}
	get pendingBytes() {
		return this.pending?.length ?? 0;
	}
	get hasActiveInput() {
		return this.active;
	}
	get needsAcknowledgement() {
		return this.failed !== void 0;
	}
	send(e) {
		return e.length === 0 || e.length > Vb ? Promise.reject(new Hb("Terminal input was not sent: each input must contain 1–16384 bytes")) : this.disposed ? Promise.reject(new Hb("Terminal input was not sent because its consumer closed")) : this.failed === void 0 ? this.active && this.pendingBytes + e.length > Vb ? Promise.reject(new Hb("Terminal input was not sent because the pending 16 KiB buffer is full")) : new Promise((t, n) => {
			let r = {
				resolve: t,
				reject: n
			};
			this.active ? (this.pending ??= {
				buffer: new Uint8Array(Vb),
				length: 0,
				receipts: []
			}, this.pending.buffer.set(e, this.pending.length), this.pending.length += e.length, this.pending.receipts.push(r)) : (this.active = !0, this.deliver({
				bytes: e.slice(),
				receipts: [r]
			}));
		}) : Promise.reject(new Hb("Terminal input was not sent: acknowledge the preceding delivery failure first", this.failed));
	}
	rejectPending(e) {
		let t = this.pending;
		this.pending = void 0;
		for (let n of t?.receipts ?? []) n.reject(e);
	}
	async deliver(e) {
		try {
			await this.connection.input(e.bytes, this.signal);
			for (let t of e.receipts) t.resolve();
		} catch (t) {
			this.failed = t ?? /* @__PURE__ */ Error("Terminal input delivery failed");
			let n = t instanceof fr ? t : new Hb("Terminal input was not sent", t);
			for (let t of e.receipts) t.reject(n);
			this.rejectPending(new Hb("Pending terminal input was not sent after the preceding delivery failed", t));
		} finally {
			this.active = !1;
		}
		if (this.pending && !this.disposed && this.failed === void 0) {
			let e = this.pending;
			this.pending = void 0, this.active = !0, this.deliver({
				bytes: e.buffer.slice(0, e.length),
				receipts: e.receipts
			});
		}
	}
	acknowledgeFailure() {
		if (this.active) throw new Hb("Wait for the active input receipt before acknowledging its outcome");
		this.failed = void 0, this.connection.acknowledgeInputUncertainty();
	}
	dispose() {
		this.abort.abort(new DOMException("Terminal input consumer closed", "AbortError")), this.signal.removeEventListener("abort", this.cancelListener);
	}
}, Wb = 65536;
function Gb(e, t) {
	let n = new TextDecoder(), r = "", i = !1, a = !1, o = (n) => {
		let i = "";
		for (let e of n) {
			let t = e.charCodeAt(0);
			i += t < 32 && t !== 9 && t !== 10 || t >= 127 && t <= 159 ? `\\x${t.toString(16).padStart(2, "0")}` : e;
		}
		let o = r + i;
		r = o.slice(-65536), e.textContent = r, e.scrollTop = e.scrollHeight, o.length > Wb && !a && (a = !0, t?.(!0));
	}, s = (e) => {
		if (e.throwIfAborted(), i) throw new DOMException("Log renderer closed", "AbortError");
	};
	return {
		renderer: {
			write: async (e, t) => {
				s(t), o(n.decode(e, { stream: !0 }));
			},
			reset: async (i, o) => {
				s(o), n = new TextDecoder(), r = "", e.textContent = "", a = !1, t?.(!1);
			}
		},
		get displayTruncated() {
			return a;
		},
		finish: () => {
			i || o(n.decode());
		},
		dispose: () => {
			i = !0;
		}
	};
}
// src/app/features/terminal/ExecutionLog.tsx
function Kb({ sessionId: e, source: t }) {
	let { api: n } = V(), r = q(null), [i] = J(() => t), [a, o] = J(0), [s, c] = J("Connecting"), [l, u] = J(""), [d, f] = J(!1);
	return G(() => {
		if (!r.current) return;
		let t = yt(_r()), o = new AbortController(), s = Gb(r.current, f), l = ne(n, e, i, s.renderer, { pageLimit: 32768 });
		yt(un(t, F(() => {
			s.dispose(), l.detach().catch(() => {});
		})));
		let d = wt({
			try: async () => {
				c("Connecting"), u(""), await l.attach(o.signal, a ? "reconnect" : "attach"), !o.signal.aborted && (c("Connected"), await l.run(o.signal, (e) => {
					e.gap && !o.signal.aborted && u("Earlier output was discarded. The log was reset before replay.");
				}), o.signal.aborted || (s.finish(), c("Output complete")));
			},
			catch: (e) => e
		});
		return lt(d, { signal: o.signal }).then((e) => {
			if (!o.signal.aborted && ar(e)) {
				let t = Wt(e.cause);
				c("Disconnected"), u(t instanceof Error ? t.message : "Log observation unavailable");
			}
		}), () => {
			o.abort(), yt(Dr(t, en));
		};
	}, [
		n,
		e,
		i,
		a
	]), /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ Z("div", {
			className: "flex items-center gap-2",
			children: [/* @__PURE__ */ X("span", {
				role: "status",
				children: s
			}), /* @__PURE__ */ X(z, {
				type: "button",
				size: U.Small,
				variant: B.Ghost,
				onClick: () => o((e) => e + 1),
				children: "Reconnect"
			})]
		}),
		l ? /* @__PURE__ */ X("p", {
			role: "alert",
			children: l
		}) : null,
		d ? /* @__PURE__ */ X("p", {
			role: "status",
			children: "Display limit reached. Showing the latest output; earlier text is hidden in this view."
		}) : null,
		/* @__PURE__ */ X("pre", {
			ref: r,
			tabIndex: 0,
			role: "region",
			"aria-label": "Execution log",
			className: "flex-1 min-h-32 overflow-auto whitespace-pre-wrap break-words bg-elevation-level-1 p-2 text-sm font-mono"
		})
	] });
}
// src/app/features/terminal/useInputOwnership.ts
var qb = (e, t) => [
	"session",
	e,
	"execution",
	t,
	"input-control"
];
function Jb(e, t) {
	return !t && e?.representation === "pty" && e.backend === "local" && (e.origin === "human" || e.origin === "agent" && e.retained);
}
function Yb(e, t) {
	return e && BigInt(e.revision) > BigInt(t.revision) ? e : t;
}
function Xb(e, t, n) {
	let { api: r } = V(), i = Si(), a = qb(e, t.id), o = Jb(t, n), s = xi({
		queryKey: a,
		queryFn: ({ signal: n }) => r.getTerminalInputControl(e, t.id, n),
		enabled: o,
		retry: !1,
		refetchInterval: o ? 1e3 : !1,
		structuralSharing: (e, t) => Yb(e, t)
	}), c = yi({
		mutationFn: async ({ controller: n, acknowledge: c = !1 }) => {
			if (!o || s.isError || !s.data) throw Error("Current input ownership is unavailable. Refresh before changing control.");
			let l = s.data.revision;
			return await i.cancelQueries({ queryKey: a }), r.transferTerminalInputControl(e, t.id, {
				protocol_version: 1,
				expected_revision: l,
				controller: n,
				acknowledge_uncertainty: c
			});
		},
		retry: !1,
		onSuccess: (e) => i.setQueryData(a, (t) => Yb(t, e)),
		onSettled: () => i.invalidateQueries({ queryKey: a })
	});
	return {
		offered: o,
		state: o && !s.isError ? s.data : void 0,
		loading: o && s.isPending,
		unavailable: o && s.isError,
		pending: c.isPending,
		error: c.error,
		change: c.mutateAsync,
		refresh: s.refetch
	};
}
// src/app/features/terminal/xtermAdapter.ts
var Zb = 14, Qb = 1.2, $b = "\"IBMPlexMono\", Menlo, monospace";
async function ex(e) {
	let { Terminal: t } = await import("./chunks/xterm-q3E93r5O.js"), n = new t({
		cols: 80,
		rows: 24,
		fontFamily: $b,
		fontSize: Zb,
		lineHeight: Qb,
		scrollback: 2e3,
		screenReaderMode: !0,
		disableStdin: !0,
		linkHandler: { activate: (e, t) => {
			if (e.isTrusted) try {
				let e = new URL(t);
				(e.protocol === "https:" || e.protocol === "http:") && window.open(e.href, "_blank", "noopener,noreferrer");
			} catch {}
		} },
		theme: {
			background: "#151719",
			foreground: "#eeeeee"
		}
	});
	n.open(e);
	let r = n.parser.registerOscHandler(52, () => !0), i = !1;
	return {
		terminal: n,
		renderer: {
			write: (e, t) => new Promise((r, a) => {
				if (i || t.aborted) {
					a(t.reason ?? new DOMException("Renderer closed", "AbortError"));
					return;
				}
				let o = () => a(t.reason);
				t.addEventListener("abort", o, { once: !0 }), n.write(e, () => {
					t.removeEventListener("abort", o), i || t.aborted ? a(t.reason) : r();
				});
			}),
			reset: async (e, t) => {
				if (t.throwIfAborted(), i) throw new DOMException("Renderer closed", "AbortError");
				n.reset();
			}
		},
		fit: () => tx(n, e),
		dispose: () => {
			i = !0, r.dispose(), n.dispose();
		}
	};
}
function tx(e, t) {
	let n = document.createElement("canvas").getContext("2d");
	if (!n || t.clientWidth < 1 || t.clientHeight < 1) return null;
	n.font = `${Zb}px ${$b}`;
	let r = n.measureText("W").width;
	if (r <= 0) return null;
	let i = Math.max(2, Math.min(500, Math.floor((t.clientWidth - 18) / r))), a = e.element ? e.element.clientHeight / e.rows : 0, o = a > 0 ? a : Zb * Qb, s = Math.max(1, Math.min(300, Math.floor(t.clientHeight / o)));
	return e.cols === i && e.rows === s ? null : (e.resize(i, s), {
		cols: i,
		rows: s
	});
}
// src/app/features/terminal/humanInput.ts
function nx(e, t) {
	let n = e.textarea;
	if (!n) return () => {};
	let r = !1, i = !1, a, o, s = () => !r && n.ownerDocument.activeElement === n, c = e.element ?? n, l = /* @__PURE__ */ new Set([
		"mousedown",
		"mouseup",
		"mousemove",
		"wheel"
	]), u = () => {
		let e = n.ownerDocument.defaultView?.event;
		return !!e?.isTrusted && e.currentTarget !== null && l.has(e.type) && !!e.target && typeof e.target.nodeType == "number" && c.contains(e.target);
	}, d = (e) => {
		e && s() && t(new TextEncoder().encode(e));
	}, f = () => {
		o !== void 0 && clearTimeout(o), o = void 0;
		let e = a;
		a = void 0, e && s() && d(e.text);
	}, p = e.onKey(({ key: e, domEvent: t }) => {
		t.isTrusted && s() && (f(), d(e));
	}), m = e.onData((e) => {
		(i || u()) && d(e);
	}), h = e.onBinary((e) => {
		u() && s() && t(Uint8Array.from(e, (e) => e.charCodeAt(0)));
	}), g = (t) => {
		if (t.isTrusted && s() && t.clipboardData) {
			t.preventDefault(), t.stopImmediatePropagation(), f(), i = !0;
			try {
				e.paste(t.clipboardData.getData("text/plain"));
			} finally {
				i = !1;
			}
		}
	}, _ = (e) => {
		e.isTrusted && s() && (f(), a = {
			prefix: n.value,
			text: ""
		});
	}, v = (e) => {
		if (!e.isTrusted || !s() || !a) return;
		let t = n.value;
		a.text = t.startsWith(a.prefix) ? t.slice(a.prefix.length) : "";
	}, y = () => {
		let e = a;
		e && (o !== void 0 && clearTimeout(o), o = setTimeout(() => {
			o = void 0, !r && a === e && f();
		}, 0));
	};
	return c.addEventListener("paste", g, !0), n.addEventListener("compositionstart", _, !0), n.addEventListener("compositionend", y, !0), n.addEventListener("input", v, !0), () => {
		r || (r = !0, o !== void 0 && clearTimeout(o), o = void 0, a = void 0, p.dispose(), m.dispose(), h.dispose(), c.removeEventListener("paste", g, !0), n.removeEventListener("compositionstart", _, !0), n.removeEventListener("compositionend", y, !0), n.removeEventListener("input", v, !0));
	};
}
// src/app/features/terminal/browserRuntime.ts
var rx = class extends Ge("TerminalOperationFailure") {};
function ix(e, t) {
	return wt({
		try: t,
		catch: (t) => new rx({
			operation: e,
			cause: t
		})
	});
}
function ax(e, t) {
	return e instanceof Error ? e.message : t;
}
function ox(e) {
	let t = yt(_r()), n = new AbortController(), r = () => !n.signal.aborted, i = (e) => {
		r() ? yt(un(t, F(e))) : e();
	}, a, o = !1, s = !1, c = e.inputControl, l = e.inputPaused ?? !1, u = (t) => {
		r() && (o = !1, e.phase("Disconnected"), e.notice(ax(t, "Terminal observation failed")), a && (a.terminal.options.disableStdin = !0));
	}, d = (e) => {
		lt(e, { signal: n.signal }).then((e) => {
			if (ar(e) && r()) {
				let t = An(e.cause);
				u(Mr(t) ? t.value.cause : Wt(e.cause));
			}
		}).catch(u);
	};
	return d(xe(function* () {
		a = yield* ix("renderer", () => ex(e.host).then((e) => (i(e.dispose), n.signal.throwIfAborted(), e)));
		let t = a, u = e.source && e.api.attachExecution && e.api.pullExecution && e.api.detachExecution && e.api.stopExecution && e.api.listExecutions ? ne(e.api, e.sessionId, e.source, t.renderer, {
			pageLimit: 32768,
			readonly: e.readonly
		}, e.inputControl) : new me(e.api, e.sessionId, e.terminalId, t.renderer, { pageLimit: 32768 });
		i(() => {
			u.detach().catch(() => {});
		});
		let f = new Ub(u, n.signal), p = /* @__PURE__ */ new Set(), m = () => f.hasActiveInput || [...p].some((e) => e.hasActiveInput);
		i(() => {
			(m() || f.needsAcknowledgement) && (e.previousFailure.current = !0), f.dispose(), e.controls(null);
		});
		let h = () => {
			let n = r() && o && !e.readonly && !l && (c === void 0 ? s && e.source?.input !== !1 : !!c && c.controller === "human" && !c.frozen) && !e.previousFailure.current && e.previousFailure.available !== !1 && !f.needsAcknowledgement;
			return t.terminal.options.disableStdin = !n, n;
		}, g;
		e.controls({
			adapter: t,
			get pump() {
				return f;
			},
			restoreFreshInput: h,
			hasActiveInput: m,
			updateInput: (r, i) => {
				if (!(c && r && BigInt(r.revision) < BigInt(c.revision)) && (c?.controller !== r?.controller || c?.revision !== r?.revision || c?.frozen !== r?.frozen || c === void 0 != (r === void 0) || c === null != (r === null) || l !== i)) {
					g?.(), t.terminal.options.disableStdin = !0, (f.hasActiveInput || f.needsAcknowledgement) && (e.previousFailure.current = !0), f.hasActiveInput && p.add(f), f.dispose(), c = r, l = i, e.source && u.replaceInputTransport(vt(e.api, e.source, r, e.readonly)), f = new Ub(u, n.signal);
					for (let e of p) e.hasActiveInput || p.delete(e);
					e.inputFailure(e.previousFailure.current), h();
				}
			}
		}), i(e.previousFailure.subscribe?.(() => {
			r() && (h(), e.inputFailure(e.previousFailure.current), e.notice(e.previousFailure.current ? "Input delivery was not confirmed. Check the shell before enabling fresh input." : "Previous input will not be retried. Only fresh typing will be sent."));
		}) ?? (() => {}));
		let _ = !1, v = null, y = pr(() => {
			if (e.readonly || e.source && e.source.origin !== "human" && e.source.resize === !1) return e.source && t.terminal.resize(e.source.cols, e.source.rows), Ee;
			let i = t.fit();
			return i && (v = i), _ || !o || !s || e.source?.resize === !1 ? Ee : (_ = !0, xe(function* () {
				for (; v && r() && s;) {
					let e = v;
					v = null, yield* ix("resize", () => u.resize(e.cols, e.rows, n.signal));
				}
			}).pipe(Ve((t) => F(() => {
				r() && e.notice(`Terminal resize failed: ${ax(t.cause, "geometry control unavailable")}`);
			})), ee(F(() => {
				_ = !1;
			}))));
		}), b = (n) => {
			let i = t.terminal.textarea;
			if (!r() || !o || e.readonly || l || t.terminal.options.disableStdin || e.previousFailure.current || e.previousFailure.available === !1 || !i || i.ownerDocument.activeElement !== i) return;
			let a = f;
			d(ix("input", () => a.send(n)).pipe(Ve((n) => F(() => {
				r() && (e.notice(ax(n.cause, "Terminal input failed")), n.cause instanceof Hb && n.cause.cause instanceof _e ? (a.acknowledgeFailure(), h()) : a.needsAcknowledgement && (e.previousFailure.current = !0, t.terminal.options.disableStdin = !0, e.inputFailure(!0)));
			}))));
		}, x = nx(t.terminal, b);
		g = () => {
			x(), x = nx(t.terminal, b);
		}, i(() => {
			x(), g = void 0;
		});
		let S = new ResizeObserver(() => d(y));
		i(() => S.disconnect()), S.observe(e.host), t.terminal.element && S.observe(t.terminal.element), e.phase("Connecting"), e.notice(""), e.inputFailure(e.previousFailure.current);
		let C = yield* ix("attach", () => u.attach(n.signal, e.reconnect ? "reconnect" : "attach"));
		r() && (o = !0, s = C.alive, h(), e.previousFailure.current && e.notice("Input delivery was not confirmed. Check the shell before enabling fresh input."), e.previousFailure.available === !1 && e.notice("Input recovery storage is full. Acknowledge earlier failures, then reconnect before typing in another terminal."), e.phase(C.alive ? "Connected" : "Retained output"), yield* y, document.fonts.ready.then(() => {
			r() && d(y);
		}), yield* ix("observe", () => u.run(n.signal, (t) => {
			s = t.terminal.alive, s || (v = null), h(), t.gap && r() && e.notice("Earlier output was discarded. The display was reset before retained output was replayed.");
		})), r() && (c === void 0 && (o = !1), h(), e.phase("Output complete")));
	})), () => {
		n.abort(), yt(Dr(t, en));
	};
}
// src/app/features/terminal/useTerminalController.ts
function sx(e, t, n, r, i = {}) {
	let a = V(), { api: o } = a, s = q(null), [c, l] = J(0), [u, d] = J("Connecting"), [f, p] = J(""), [m, h] = J(!1), g = q(null), _ = i.inputControl, v = _?.controller, y = _?.revision, b = _?.frozen, x = _ === void 0, S = _ === null, C = K(() => x ? void 0 : S ? null : {
		controller: v,
		revision: y,
		frozen: b
	}, [
		x,
		S,
		v,
		y,
		b
	]), w = q(r);
	pi(() => {
		w.current = r;
	}, [r]);
	let T = r !== void 0, E = q({
		binding: C,
		paused: i.inputPaused ?? !1
	});
	return pi(() => {
		E.current = {
			binding: C,
			paused: i.inputPaused ?? !1
		}, s.current?.updateInput(C, i.inputPaused ?? !1);
	}, [C, i.inputPaused]), G(() => {
		let r = n.current;
		if (!r) return;
		let l = rr(a).acquire(e, t);
		g.current = l;
		let u = ox({
			api: o,
			source: w.current,
			readonly: i.readonly,
			inputControl: E.current.binding,
			inputPaused: E.current.paused,
			sessionId: e,
			terminalId: t,
			host: r,
			reconnect: c !== 0,
			previousFailure: l,
			controls: (e) => {
				s.current = e, e?.updateInput(E.current.binding, E.current.paused);
			},
			phase: d,
			notice: p,
			inputFailure: h
		});
		return () => {
			u(), l.release(), g.current === l && (g.current = null);
		};
	}, [
		a,
		o,
		e,
		t,
		c,
		n,
		T,
		r?.id,
		r?.origin,
		r?.representation,
		r?.backend,
		r?.retained,
		r?.input,
		r?.resize,
		i.readonly
	]), {
		phase: u,
		notice: f,
		inputFailure: m,
		reconnect: () => l((e) => e + 1),
		selection: () => {
			let e = s.current?.adapter.terminal.getSelection() ?? "";
			return e || p("Select text in the terminal before reviewing it."), e;
		},
		focus: () => s.current?.adapter.terminal.focus(),
		hasActiveInput: () => s.current?.hasActiveInput() === !0,
		acknowledgeInput: (e) => {
			let t = s.current;
			if (!t || t.hasActiveInput() || !g.current?.available) return !1;
			e && t.updateInput(e, !1), t.pump.acknowledgeFailure(), g.current.acknowledge();
			let n = t.restoreFreshInput();
			return h(!1), p(n ? "Previous input will not be retried. Only fresh typing will be sent." : "Previous input will not be retried. This source has no connected live input."), n && t.adapter.terminal.focus(), !0;
		}
	};
}
// src/app/features/terminal/TerminalPane.tsx
function cx(e) {
	let { api: t } = V(), n = K(() => ({
		api: t,
		id: crypto.randomUUID()
	}), [t]);
	return /* @__PURE__ */ X(lx, { ...e }, `${n.id}:${e.sessionId}`);
}
function lx({ sessionId: e, onReviewSelection: t, history: n }) {
	let r = zb(e), i = Lb(e), [a, o] = J(null), [s, c] = J(null), l = q(null), u = r.data?.executions ?? [], d = a ?? u[0]?.id, f = s?.id === d ? s : u.find((e) => e.id === d);
	return a == null && f && o(f.id), /* @__PURE__ */ Z("section", {
		"aria-label": "Session terminal",
		className: "flex flex-col flex-1 min-h-0 gap-2 p-3",
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex items-center flex-wrap gap-2",
				children: [
					/* @__PURE__ */ X("label", {
						className: "sr-only",
						htmlFor: `terminal-${e}`,
						children: "Shell"
					}),
					/* @__PURE__ */ Z("select", {
						id: `terminal-${e}`,
						"aria-label": "Shell",
						value: d ?? "",
						onChange: (e) => {
							c(null), o(e.target.value);
						},
						className: "min-w-0 max-w-full rounded-md border border-muted bg-elevation-level-2 px-2 py-1 text-sm",
						children: [
							d ? null : /* @__PURE__ */ X("option", {
								value: "",
								children: "No shell"
							}),
							d && !u.some((e) => e.id === d) ? /* @__PURE__ */ X("option", {
								value: d,
								children: "Selected shell unavailable"
							}) : null,
							u.map((e, t) => /* @__PURE__ */ Z("option", {
								value: e.id,
								children: [
									e.origin === "human" ? "Human shell" : e.origin === "human_command" ? "! command" : e.representation === "pty" ? "Agent PTY" : "Agent command",
									" ",
									t + 1,
									e.process_state === "cleanup_pending" ? " (cleanup pending)" : e.alive ? " (running)" : " (settled)"
								]
							}, e.id))
						]
					}),
					/* @__PURE__ */ X(z, {
						size: U.Small,
						type: "button",
						variant: B.Secondary,
						disabled: i.isPending,
						onClick: () => {
							l.current ??= crypto.randomUUID(), i.mutate(l.current, { onSuccess: (e) => {
								c(null), o(e.terminal_id), l.current = null;
							} });
						},
						children: i.isPending ? "Opening shell…" : i.isError ? "Retry opening same shell" : "New shell"
					})
				]
			}),
			/* @__PURE__ */ X("p", {
				className: "text-sm text-basic-secondary",
				children: "Human shells, agent executions and ! commands use the chat’s existing execution environment."
			}),
			r.isError ? /* @__PURE__ */ Z("p", {
				role: "alert",
				children: [
					"Shell list unavailable.",
					" ",
					/* @__PURE__ */ X(z, {
						size: U.Small,
						type: "button",
						onClick: () => {
							r.refetch();
						},
						children: "Refresh"
					})
				]
			}) : null,
			i.isError ? /* @__PURE__ */ Z("p", {
				role: "alert",
				children: [i.error.message, " Opening was not confirmed; retry uses the same launch identity."]
			}) : null,
			n?.((e) => {
				c(e), o(e.id);
			}),
			s ? /* @__PURE__ */ X(z, {
				type: "button",
				size: U.Small,
				variant: B.Ghost,
				onClick: () => c(null),
				children: "Return to live source"
			}) : null,
			f ? /* @__PURE__ */ X(ux, {
				sessionId: e,
				source: f,
				historical: s != null,
				onReviewSelection: t
			}, `${f.id}:${s ? "history" : "live"}`) : /* @__PURE__ */ X("p", {
				role: "status",
				children: d ? "Selected execution unavailable." : r.isPending ? "Loading executions…" : "Open a shell to start typing. Terminal output stays separate from the conversation."
			})
		]
	});
}
function ux({ sessionId: e, source: t, onReviewSelection: n, historical: r = !1 }) {
	let i = Bb(e, t.id);
	return /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ X("code", {
			"aria-label": "Execution identity",
			className: "break-all text-xs text-basic-secondary",
			children: t.id
		}),
		/* @__PURE__ */ Z("p", {
			className: "text-sm text-basic-secondary break-words",
			children: [
				t.origin === "human" ? "Human shell" : t.origin === "human_command" ? "Human ! command" : "Agent execution",
				` · ${t.backend} · ${t.cwd} · ${t.process_state.replaceAll("_", " ")}`,
				t.exit_code == null ? "" : ` (${t.exit_code})`,
				t.output_complete ? " · collection complete" : " · collecting output",
				r || t.representation === "log" || t.origin === "agent" && !t.retained ? " · Read-only" : ""
			]
		}),
		r ? null : /* @__PURE__ */ X("div", { children: /* @__PURE__ */ X(z, {
			type: "button",
			size: U.Small,
			variant: B.Ghost,
			disabled: !t.stop || i.isPending,
			onClick: () => i.mutate(),
			children: i.isPending ? "Stopping…" : t.origin === "human" ? "Close shell" : "Stop execution"
		}) }),
		i.isError ? /* @__PURE__ */ Z("p", {
			role: "alert",
			children: [i.error.message, " Stop was not confirmed; check its status."]
		}) : null,
		t.output_error ? /* @__PURE__ */ X("p", {
			role: "alert",
			children: t.output_error
		}) : null,
		t.representation === "log" ? /* @__PURE__ */ X(Kb, {
			sessionId: e,
			source: t
		}) : /* @__PURE__ */ X(dx, {
			sessionId: e,
			source: t,
			historical: r,
			onReviewSelection: !r && t.origin === "human" ? n : void 0
		})
	] });
}
function dx({ sessionId: e, source: t, onReviewSelection: n, historical: r = !1 }) {
	let i = t.id, a = { data: t }, o = Xb(e, t, r), s = q(null), c = sx(e, i, s, t, {
		readonly: r,
		inputControl: o.state ?? null,
		inputPaused: o.pending
	}), l = (e, t = !1) => {
		o.change({
			controller: e,
			acknowledge: t
		}).then((e) => {
			t && c.acknowledgeInput(e);
		}).catch(() => {});
	};
	return /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ Z("div", {
			className: "flex flex-wrap items-center gap-2",
			children: [
				/* @__PURE__ */ Z("span", {
					role: "status",
					children: [c.phase, a.data && !a.data.alive ? ` · Exited${a.data.exit_code == null ? "" : ` (${a.data.exit_code})`}` : ""]
				}),
				/* @__PURE__ */ X(z, {
					size: U.Small,
					type: "button",
					variant: B.Ghost,
					onClick: c.focus,
					children: "Focus terminal"
				}),
				/* @__PURE__ */ X(z, {
					size: U.Small,
					type: "button",
					variant: B.Ghost,
					disabled: c.phase === "Connecting",
					onClick: c.reconnect,
					children: "Reconnect"
				}),
				n ? /* @__PURE__ */ X(z, {
					size: U.Small,
					type: "button",
					variant: B.Ghost,
					onClick: () => {
						let t = c.selection();
						t && n && n(Object.freeze({
							sessionId: e,
							terminalId: i,
							selectedText: t,
							capturedAtMs: String(Date.now()),
							sourceAlive: a.data?.alive ?? !1
						}));
					},
					children: "Review selected text"
				}) : null
			]
		}),
		c.notice ? /* @__PURE__ */ X("p", {
			role: "alert",
			children: c.notice
		}) : null,
		!r && o.offered ? /* @__PURE__ */ Z("div", {
			className: "flex flex-wrap items-center gap-2",
			"aria-label": "Terminal input ownership",
			children: [
				/* @__PURE__ */ X("span", {
					role: "status",
					"aria-label": "Input controller",
					children: o.loading ? "Checking input control…" : o.state ? `Input: ${o.state.controller === "human" ? "Human" : "Agent"}${o.state.frozen ? " · Frozen" : ""}` : "Input unavailable"
				}),
				o.state?.controller === "agent" ? /* @__PURE__ */ X(z, {
					size: U.Small,
					type: "button",
					variant: B.Secondary,
					disabled: o.pending,
					onClick: () => l("human"),
					children: t.origin === "human" ? "Reclaim input" : "Take control"
				}) : o.state?.controller === "human" ? /* @__PURE__ */ X(z, {
					size: U.Small,
					type: "button",
					variant: B.Ghost,
					disabled: o.pending || o.state.frozen || c.inputFailure || c.hasActiveInput(),
					onClick: () => l("agent"),
					children: "Give agent control"
				}) : null,
				o.state?.controller === "human" && o.state.frozen || c.inputFailure ? /* @__PURE__ */ X(z, {
					size: U.Small,
					type: "button",
					variant: B.Secondary,
					disabled: o.pending || o.state?.in_flight || c.hasActiveInput(),
					onClick: () => {
						o.state ? l("human", !0) : c.acknowledgeInput();
					},
					children: "Acknowledge failure and enable fresh input"
				}) : null,
				o.unavailable ? /* @__PURE__ */ X(z, {
					type: "button",
					size: U.Small,
					onClick: () => {
						o.refresh();
					},
					children: "Refresh input control"
				}) : null
			]
		}) : null,
		!r && o.error ? /* @__PURE__ */ Z("p", {
			role: "alert",
			children: [o.error.message, " Input ownership was not confirmed; refresh before another action."]
		}) : null,
		/* @__PURE__ */ X("div", {
			ref: s,
			role: "region",
			"aria-label": "Interactive terminal",
			className: "flex-1 min-h-32 overflow-auto",
			style: { background: "#151719" }
		})
	] });
}
// src/app/features/terminal/historyQueries.ts
var fx = (e) => [
	"session",
	e,
	"execution-history"
];
function px(e) {
	let { api: t } = V();
	return xi({
		queryKey: fx(e),
		queryFn: ({ signal: n }) => t.listExecutionHistory(e, n),
		retry: !1,
		refetchInterval: 2e3
	});
}
// src/app/features/terminal/historyModel.ts
function mx(e) {
	let t = e.execution;
	return e.command ? `Human command: ${e.command.command.slice(0, 60)}` : t ? t.origin === "human" ? "Human shell" : t.representation === "pty" ? "Agent PTY" : "Agent command log" : "Unavailable execution";
}
function hx(e) {
	let t = e.command, n = e.execution;
	return t ? `${t.state.replaceAll("_", " ")}${t.exit_code == null ? "" : ` · exit ${t.exit_code}`}` : n ? n.process_state === "cleanup_pending" ? "Cleanup pending" : n.process_state === "running" ? "Running" : `${e.outcome?.replaceAll("_", " ") ?? "Settled"}${n.exit_code == null ? "" : ` · exit ${n.exit_code}`}` : "Current process status unavailable";
}
function gx(e) {
	switch (e.output.availability) {
		case "retained": return "Retained output available.";
		case "tail_gap": return `Earlier output was discarded. Retained bytes ${e.output.retained_start}–${e.output.retained_end}; the display resets before reading the tail.`;
		case "expired": return "Output expired. The recorded outcome remains available.";
		case "process_local_unavailable": return "Process-local output unavailable. It may have expired or been lost on server restart; no shell or log is restored.";
		case "not_recorded": return "No fuller output reference was recorded. This does not prove an unconfirmed command had no effects.";
	}
}
function _x(e) {
	return !!e.execution && (e.output.availability === "retained" || e.output.availability === "tail_gap");
}
function vx(e) {
	return !_x(e) || !e.execution ? null : {
		...e.execution,
		input: !1,
		resize: !1,
		stop: !1
	};
}
// src/app/features/terminal/RecentExecutionHistory.tsx
function yx({ sessionId: e, onReopen: t }) {
	let n = px(e), [r, i] = J(""), a = n.data?.history.entries ?? [], o = a.find((e) => e.id === r);
	return /* @__PURE__ */ Z("section", {
		"aria-label": "Recent terminal activity",
		className: "flex flex-col gap-2 text-sm",
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex flex-wrap items-center gap-2",
				children: [/* @__PURE__ */ X("label", {
					htmlFor: `recent-executions-${e}`,
					children: "Recent activity"
				}), /* @__PURE__ */ Z("select", {
					id: `recent-executions-${e}`,
					value: o?.id ?? "",
					onChange: (e) => i(e.target.value),
					className: "min-w-0 max-w-full rounded-md border border-muted bg-elevation-level-2 px-2 py-1",
					children: [/* @__PURE__ */ X("option", {
						value: "",
						children: "Choose recent activity"
					}), a.map((e, t) => /* @__PURE__ */ Z("option", {
						value: e.id,
						children: [
							t + 1,
							". ",
							mx(e),
							" · ",
							hx(e)
						]
					}, e.id))]
				})]
			}),
			/* @__PURE__ */ X("p", {
				className: "text-basic-secondary",
				children: "Up to 32 recent entries. Older metadata can expire. Reopening observes output and sends no input."
			}),
			n.isPending ? /* @__PURE__ */ X("p", {
				role: "status",
				children: "Loading recent activity…"
			}) : null,
			n.isError ? /* @__PURE__ */ Z("p", {
				role: "alert",
				children: [
					"Recent activity unavailable.",
					" ",
					/* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						onClick: () => void n.refetch(),
						children: "Refresh recent activity"
					})
				]
			}) : null,
			!n.isPending && !n.isError && a.length === 0 ? /* @__PURE__ */ X("p", { children: "No recent activity is available." }) : null,
			r && !o ? /* @__PURE__ */ X("p", {
				role: "status",
				children: "Selected activity is no longer in bounded history."
			}) : null,
			n.data?.history.older_entries_omitted ? /* @__PURE__ */ X("p", { children: "Older entries are omitted from this recent view." }) : null,
			o ? /* @__PURE__ */ Z("article", {
				"aria-label": "Recorded terminal activity",
				className: "flex flex-col gap-1 max-h-56 overflow-auto",
				children: [
					/* @__PURE__ */ Z("p", { children: [
						mx(o),
						" · ",
						hx(o)
					] }),
					/* @__PURE__ */ X("p", { children: gx(o) }),
					o.execution ? /* @__PURE__ */ Z("p", { children: [
						"Process: ",
						o.execution.process_state.replaceAll("_", " "),
						".",
						" ",
						o.execution.output_complete ? "Output collection ended." : "Output collection pending."
					] }) : /* @__PURE__ */ X("p", { children: "Current process status is unavailable. This entry has no restored live handle." }),
					o.execution?.output_error ? /* @__PURE__ */ Z("p", {
						role: "status",
						children: ["Output collection error: ", o.execution.output_error]
					}) : null,
					o.command ? /* @__PURE__ */ Z("div", {
						"aria-label": "Canonical command preview",
						children: [
							/* @__PURE__ */ X("pre", {
								className: "whitespace-pre-wrap break-words",
								children: o.command.command
							}),
							o.command.stdout ? /* @__PURE__ */ X("pre", {
								"aria-label": "Recorded stdout",
								className: "whitespace-pre-wrap break-words",
								children: o.command.stdout
							}) : null,
							o.command.stderr ? /* @__PURE__ */ X("pre", {
								"aria-label": "Recorded stderr",
								className: "whitespace-pre-wrap break-words",
								children: o.command.stderr
							}) : null,
							o.command.diagnostic ? /* @__PURE__ */ X("p", { children: o.command.diagnostic }) : null
						]
					}) : null,
					/* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						variant: B.Secondary,
						disabled: !_x(o),
						onClick: () => {
							let e = vx(o);
							e && t(e, o);
						},
						children: "Reopen retained output"
					})
				]
			}) : null
		]
	});
}
// src/app/features/terminal-selection/SelectionReview.tsx
function bx({ state: e, controller: t, availability: n }) {
	let r = fi(), i = e.phase === "sending", a = i || e.phase === "uncertain" || e.phase === "accepted", o = e.phase === "editing", s = e.choice.delivery === "steer" && e.choice.runId !== n.runId, c = e.phase === "reviewed" && !n.sourceUnavailable && (e.choice.delivery === "queue" || e.choice.delivery === "send" && n.mode === "idle" || e.choice.delivery === "steer" && n.mode === "busy" && !!n.runId && !s), l = e.choice.delivery === "queue" ? "Queue selection" : e.choice.delivery === "steer" ? "Steer selected run" : "Send selection";
	return /* @__PURE__ */ X(Xn, {
		open: e.phase !== "empty",
		title: "Review terminal selection",
		size: Tn.Large,
		onClose: i ? void 0 : () => t.clear(),
		onNavigate: () => t.clear(),
		closeOnOverlay: !i,
		footer: /* @__PURE__ */ Z("div", {
			className: "flex flex-wrap gap-2 justify-end",
			children: [
				/* @__PURE__ */ X(z, {
					type: "button",
					variant: B.Ghost,
					disabled: i,
					onClick: () => t.clear(),
					children: e.phase === "uncertain" ? "Dismiss unconfirmed submission" : "Dismiss review"
				}),
				e.phase === "accepted" ? null : /* @__PURE__ */ X(z, {
					type: "button",
					variant: B.Secondary,
					disabled: i,
					onClick: () => t.clear(),
					children: "Clear selection review"
				}),
				e.phase === "uncertain" ? /* @__PURE__ */ X(z, {
					type: "button",
					onClick: () => void t.retry(),
					children: "Retry same submission"
				}) : e.phase === "accepted" ? null : /* @__PURE__ */ X(z, {
					type: "button",
					disabled: !c,
					loading: i,
					onClick: () => void t.send(),
					children: i ? "Sending selection…" : l
				})
			]
		}),
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-4 text-sm",
			children: [
				/* @__PURE__ */ X("p", { children: "Only this selected text and optional accompanying text will be shared as literal, untrusted evidence. Reviewing does not send anything to the agent." }),
				e.source ? /* @__PURE__ */ Z("details", { children: [
					/* @__PURE__ */ X("summary", { children: "Selection source" }),
					/* @__PURE__ */ Z("p", {
						className: "break-all",
						children: ["Chat: ", e.source.sessionId]
					}),
					/* @__PURE__ */ Z("p", {
						className: "break-all",
						children: ["Shell: ", e.source.terminalId]
					}),
					/* @__PURE__ */ Z("p", { children: [
						"Client capture time: ",
						e.source.capturedAtMs,
						" ms"
					] })
				] }) : null,
				n.sourceAlive === !1 ? /* @__PURE__ */ X("p", {
					role: "status",
					children: "The source shell has exited. This frozen selection can still be shared while its retained source remains available."
				}) : e.source && !e.source.sourceAlive ? /* @__PURE__ */ X("p", {
					role: "status",
					children: "The shell’s running state was not confirmed at capture."
				}) : null,
				n.sourceUnavailable ? /* @__PURE__ */ X("p", {
					role: "alert",
					children: "The source is currently unavailable. A new send is disabled; an unconfirmed submission can still be reconciled with its original identity."
				}) : null,
				e.error ? /* @__PURE__ */ X("p", {
					role: "alert",
					children: e.error
				}) : null,
				e.phase === "uncertain" ? /* @__PURE__ */ X("p", { children: "Dismissing or clearing this review does not cancel accepted work. Check history before sending a new copy." }) : null,
				e.phase === "previewing" ? /* @__PURE__ */ X("p", {
					role: "status",
					children: "Preparing the server-normalized preview…"
				}) : null,
				e.preview ? /* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-2",
					children: [
						/* @__PURE__ */ X("h3", { children: "Reviewed selected text" }),
						/* @__PURE__ */ X("pre", {
							"aria-label": "Reviewed selected text",
							className: "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3",
							children: e.preview.text
						}),
						/* @__PURE__ */ Z("p", { children: [
							e.preview.text_scalars.toLocaleString(),
							" characters ·",
							" ",
							e.preview.text_utf8_bytes.toLocaleString(),
							" UTF-8 bytes. No truncation."
						] })
					]
				}) : null,
				o ? /* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-2",
					children: [
						/* @__PURE__ */ X("label", {
							htmlFor: `${r}-question`,
							children: "Accompanying literal text (optional)"
						}),
						/* @__PURE__ */ X("textarea", {
							id: `${r}-question`,
							value: e.editorText,
							rows: 4,
							onChange: (e) => t.setUserText(e.target.value),
							className: "rounded bg-bg-elevation-level-1 p-3"
						}),
						/* @__PURE__ */ X("p", { children: "Update the preview before sending. Limits apply separately to selected and accompanying text." }),
						/* @__PURE__ */ X(z, {
							type: "button",
							variant: B.Secondary,
							onClick: () => void t.preview(),
							children: "Update preview"
						})
					]
				}) : !a && e.preview ? /* @__PURE__ */ X(z, {
					type: "button",
					variant: B.Ghost,
					onClick: () => t.editUserText(),
					children: "Edit accompanying text"
				}) : null,
				!o && e.preview?.user_text != null ? /* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("h3", { children: "Reviewed accompanying text" }), /* @__PURE__ */ X("pre", {
					"aria-label": "Reviewed accompanying text",
					className: "max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3",
					children: e.preview.user_text
				})] }) : null,
				e.phase === "error" && e.canPreview ? /* @__PURE__ */ X(z, {
					type: "button",
					variant: B.Secondary,
					onClick: () => void t.preview(),
					children: "Retry preview"
				}) : null,
				/* @__PURE__ */ Z("fieldset", {
					disabled: a,
					className: "flex flex-col gap-2",
					children: [
						/* @__PURE__ */ X("legend", {
							className: "mb-2",
							children: "Delivery"
						}),
						/* @__PURE__ */ Z("label", { children: [
							/* @__PURE__ */ X("input", {
								type: "radio",
								name: `${r}-delivery`,
								checked: e.choice.delivery === "send",
								disabled: n.mode !== "idle",
								onChange: () => t.choose({ delivery: "send" })
							}),
							" ",
							"Send as a new turn (idle chat)"
						] }),
						/* @__PURE__ */ Z("label", { children: [
							/* @__PURE__ */ X("input", {
								type: "radio",
								name: `${r}-delivery`,
								checked: e.choice.delivery === "queue",
								onChange: () => t.choose({ delivery: "queue" })
							}),
							" ",
							"Queue after existing input"
						] }),
						/* @__PURE__ */ X("p", { children: "When idle, queued evidence may start the next turn." }),
						/* @__PURE__ */ Z("label", { children: [
							/* @__PURE__ */ X("input", {
								type: "radio",
								name: `${r}-delivery`,
								checked: e.choice.delivery === "steer" && !s,
								disabled: !n.runId || n.mode !== "busy",
								onChange: () => t.choose({
									delivery: "steer",
									runId: n.runId
								})
							}),
							" ",
							"Steer the displayed active run",
							n.runId ? ` (${n.runId.slice(0, 8)})` : ""
						] })
					]
				}),
				s ? /* @__PURE__ */ X("p", {
					role: "alert",
					children: "The selected run ended or changed. Choose Queue or explicitly choose the displayed run again; this selection will not be retargeted automatically."
				}) : null,
				e.phase === "reviewed" && e.choice.delivery === "send" && n.mode !== "idle" ? /* @__PURE__ */ X("p", {
					role: "status",
					children: "The chat is busy or its state is unknown. Choose a delivery option before sending."
				}) : null,
				i ? /* @__PURE__ */ X("p", {
					role: "status",
					children: "Admission is in progress. Leaving this view does not cancel accepted work."
				}) : null,
				e.receipt ? /* @__PURE__ */ Z("p", {
					role: "status",
					children: [
						e.receipt.replayed ? "Existing admission reconciled." : "Selection admission accepted.",
						" ",
						"Current inbox status: ",
						e.receipt.status,
						". Original choice:",
						" ",
						e.receipt.accepted_intent.initial_delivery,
						"; current delivery:",
						" ",
						e.receipt.current_delivery,
						"."
					]
				}) : null
			]
		})
	});
}
// src/app/features/terminal-selection/reviewWorkflow.ts
var xx = class extends Ge("SelectionFailure") {};
function Sx(e) {
	let t = yt(_r()), n = new AbortController(), r = !0;
	return yt(un(t, F(() => {
		r = !1, n.abort();
	}))), {
		signal: n.signal,
		activationCurrent: e,
		current: () => r && e(),
		close: () => yt(Dr(t, en))
	};
}
function Cx(e) {
	return xe(function* () {
		yield* F(e.started), yield* wt({
			try: () => e.request(e.operation.signal),
			catch: (e) => new xx({
				operation: "preview",
				cause: e
			})
		}).pipe(ti({
			onSuccess: (t) => F(() => e.confirmed(t)),
			onFailure: (t) => F(() => e.failed(t))
		}));
	}).pipe(ee(F(e.operation.close)));
}
function wx(e) {
	return xe(function* () {
		yield* F(e.started), yield* wt({
			try: () => e.request(e.operation.signal),
			catch: (e) => new xx({
				operation: "submit",
				cause: e
			})
		}).pipe(ti({
			onSuccess: (t) => xe(function* () {
				yield* F(e.accepted), yield* F(() => e.confirmed(t));
			}),
			onFailure: (t) => xe(function* () {
				yield* F(e.unconfirmed), yield* F(() => e.failed(t));
			})
		}));
	}).pipe(ee(F(e.operation.close)));
}
// src/app/features/terminal-selection/reviewController.ts
var Tx = Object.freeze({
	phase: "empty",
	editorText: "",
	choice: { delivery: "send" }
}), Ex = 32768, Dx = 8192;
function Ox(e) {
	let t = 0, n = e[Symbol.iterator]();
	for (; !n.next().done;) if (++t > Dx) return !1;
	return new TextEncoder().encode(e).byteLength <= Ex;
}
var kx = class {
	ports;
	#e = Tx;
	#t;
	#n;
	#r;
	#i;
	#a;
	#o = !1;
	#s = 0;
	#c = 0;
	#l = /* @__PURE__ */ new Set();
	constructor(e) {
		this.ports = e;
	}
	getSnapshot = () => this.#e;
	subscribe = (e) => (this.#l.add(e), () => this.#l.delete(e));
	checkActivation = () => {
		this.#a && !this.#a.activationCurrent() && this.#u();
	};
	#u() {
		this.#f(), this.#e.phase === "sending" && this.#i ? this.#d({
			...this.#e,
			phase: "uncertain",
			error: "The chat view was reset before submission was confirmed. It may already be accepted. Retry keeps the exact reviewed intent and submission identity."
		}) : this.#e.phase === "previewing" && this.#d({
			...this.#e,
			phase: "error",
			error: "The chat view was reset before preview was confirmed. Retry the preview explicitly; nothing was sent."
		});
	}
	retain = () => (this.#s += 1, this.#c += 1, () => {
		--this.#s, this.#s || this.#u();
		let e = ++this.#c;
		queueMicrotask(() => {
			!this.#s && this.#c === e && this.dispose();
		});
	});
	#d(e) {
		if (!this.#o) {
			this.#e = Object.freeze(e);
			for (let e of this.#l) e();
		}
	}
	capture(e, t) {
		if (this.#o) return;
		if (this.#e.phase !== "empty" && this.#e.phase !== "accepted") {
			this.#d({
				...this.#e,
				error: "Finish or clear the current selection review before capturing another."
			});
			return;
		}
		this.clear();
		let n = e.selectedText, r = Object.freeze({
			sessionId: e.sessionId,
			terminalId: e.terminalId,
			capturedAtMs: e.capturedAtMs,
			sourceAlive: e.sourceAlive
		});
		e.sessionId !== this.ports.sessionId || !n.trim() || !Ox(n) ? this.#d({
			...Tx,
			source: r,
			phase: "error",
			error: "Select visible text within 32 KiB and 8,192 characters from this chat. Nothing was truncated or sent."
		}) : (this.#t = Object.freeze({
			...r,
			selectedText: n
		}), this.#n = crypto.randomUUID(), this.#d({
			source: Object.freeze(r),
			phase: "editing",
			canPreview: !0,
			editorText: "",
			choice: Object.freeze({ ...t })
		}), this.preview());
	}
	setUserText(e) {
		this.#t && ![
			"sending",
			"uncertain",
			"accepted"
		].includes(this.#e.phase) && (Ox(e) ? (this.#f(), this.#r = e === "" ? void 0 : e, this.#d({
			...this.#e,
			phase: "editing",
			editorText: e,
			error: void 0
		})) : this.#d({
			...this.#e,
			error: "Accompanying text exceeds 32 KiB or 8,192 characters. That edit was rejected without truncation."
		}));
	}
	editUserText() {
		this.#t && ![
			"sending",
			"uncertain",
			"accepted"
		].includes(this.#e.phase) && (this.#f(), this.#d({
			...this.#e,
			phase: "editing",
			editorText: this.#r ?? "",
			error: void 0
		}));
	}
	choose(e) {
		[
			"sending",
			"uncertain",
			"accepted"
		].includes(this.#e.phase) || this.#d({
			...this.#e,
			choice: Object.freeze({ ...e }),
			error: void 0
		});
	}
	#f() {
		let e = this.#a;
		this.#a = void 0, e?.close();
	}
	#p() {
		this.#f();
		let e = Sx(this.ports.captureActivation());
		return this.#a = e, e;
	}
	#m(e, t) {
		this.#o || this.#a !== e || (e.current() ? (this.#a = void 0, t()) : this.checkActivation());
	}
	async preview() {
		let e = this.#t, t = this.#n;
		if (!e || !t || [
			"sending",
			"uncertain",
			"accepted"
		].includes(this.#e.phase)) return;
		let n = this.#p(), r = {
			protocol_version: 1,
			capture_id: t,
			client_capture_time_ms: e.capturedAtMs,
			selected_text: e.selectedText,
			user_text: this.#r
		};
		await ce(Cx({
			operation: n,
			started: () => this.#d({
				...this.#e,
				phase: "previewing",
				editorText: "",
				error: void 0
			}),
			request: (t) => this.ports.api.previewUserTerminalSelection(e.sessionId, e.terminalId, r, t),
			confirmed: (e) => this.#m(n, () => this.#d({
				...this.#e,
				phase: "reviewed",
				preview: Object.freeze(e),
				editorText: "",
				error: void 0
			})),
			failed: () => this.#m(n, () => this.#d({
				...this.#e,
				phase: "error",
				editorText: "",
				error: "This source could not provide a valid selection preview. It may be unavailable or the text may exceed its bounds. Nothing was sent."
			}))
		}));
	}
	async send() {
		let e = this.#t, t = this.#e.preview;
		if (!e || !t || this.#e.phase !== "reviewed") return;
		let n = this.#e.choice;
		(n.delivery !== "steer" || n.runId) && (this.#i = Object.freeze({
			protocol_version: 1,
			admission_id: crypto.randomUUID(),
			capture_id: t.capture_id,
			client_capture_time_ms: e.capturedAtMs,
			expected_owner_instance_id: t.owner_instance_id,
			original_selected_text: e.selectedText,
			expected_selection_text: t.text,
			original_user_text: this.#r,
			expected_user_text: t.user_text,
			delivery: n.delivery,
			expected_run_id: n.delivery === "steer" ? n.runId : void 0
		}), await this.#h(this.#i, e));
	}
	async retry() {
		this.#e.phase === "uncertain" && this.#i && this.#t && await this.#h(this.#i, this.#t);
	}
	async #h(e, t) {
		let n = this.#p();
		await ce(wx({
			operation: n,
			started: () => this.#d({
				...this.#e,
				phase: "sending",
				error: void 0
			}),
			request: (n) => this.ports.api.submitUserTerminalSelection(t.sessionId, t.terminalId, e, n),
			accepted: this.ports.accepted,
			unconfirmed: () => this.ports.unconfirmed?.(),
			confirmed: (e) => this.#m(n, () => {
				this.#t = void 0, this.#r = void 0, this.#i = void 0, this.#d({
					...this.#e,
					phase: "accepted",
					receipt: Object.freeze(e),
					editorText: "",
					error: void 0
				});
			}),
			failed: () => this.#m(n, () => this.#d({
				...this.#e,
				phase: "uncertain",
				error: "Submission was not confirmed and may already be accepted. Retry uses this exact reviewed text, delivery choice and submission identity."
			}))
		}));
	}
	clear() {
		this.#f(), this.#t = void 0, this.#n = void 0, this.#r = void 0, this.#i = void 0, this.#d(Tx);
	}
	dispose() {
		this.#o || (this.clear(), this.#o = !0, this.#l.clear());
	}
};
// src/app/features/terminal-selection/useSelectionReview.ts
function Ax(e) {
	let t = V(), n = Si(), r = K(() => {
		let r = () => {
			n.invalidateQueries({ queryKey: on.sessionRoot(e) }), n.invalidateQueries({ queryKey: on.sessionsAll });
		};
		return new kx({
			sessionId: e,
			api: t.api,
			captureActivation: () => t.stores.runtimeStore.captureRuntimeActivation(e),
			accepted: r,
			unconfirmed: r
		});
	}, [
		e,
		t,
		n
	]);
	return G(() => r.retain(), [r]), G(() => t.stores.runtimeStore.runtimeStore.subscribe(r.checkActivation), [t, r]), {
		controller: r,
		state: mi(r.subscribe, r.getSnapshot, r.getSnapshot)
	};
}
// src/app/features/terminal-selection/TerminalWorkspace.tsx
function jx({ sessionId: e }) {
	let { api: t } = V(), n = K(() => ({
		api: t,
		id: crypto.randomUUID()
	}), [t]);
	return /* @__PURE__ */ X(Mx, { sessionId: e }, `${n.id}:${e}`);
}
function Mx({ sessionId: e }) {
	let { controller: t, state: n } = Ax(e), r = gn(e, { enabled: !1 }), i = V().stores.runtimeStore.useRunning(e), a = r.data?.active_run?.run_id, o = r.data?.shell_commands?.some((e) => e.state === "accepted" || e.state === "started"), s = i || a || o ? "busy" : r.data && !r.isError ? "idle" : "unknown";
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(cx, {
		sessionId: e,
		history: (t) => /* @__PURE__ */ X(yx, {
			sessionId: e,
			onReopen: t
		}),
		onReviewSelection: (e) => t.capture(e, { delivery: s === "idle" ? "send" : "queue" })
	}), n.source ? /* @__PURE__ */ X(Nx, {
		state: n,
		controller: t,
		availability: {
			mode: s,
			runId: a
		}
	}, `${n.source.sessionId}:${n.source.terminalId}`) : null] });
}
function Nx({ state: e, controller: t, availability: n }) {
	let r = e.source, i = Ib(r.sessionId, r.terminalId);
	return /* @__PURE__ */ X(bx, {
		state: e,
		controller: t,
		availability: {
			...n,
			sourceAlive: i.data?.alive,
			sourceUnavailable: i.isError
		}
	});
}
// src/app/providers/PanelPhoneChrome.tsx
var Px = si(null);
function Fx({ value: e, children: t }) {
	return /* @__PURE__ */ X(Px.Provider, {
		value: e,
		children: t
	});
}
function Ix() {
	return di(Px);
}
// src/app/components/inspector/PanelPhoneScreen.tsx
function Lx({ title: e, titleAction: t, actions: n, back: r, bar: i = !1, children: a }) {
	let o = Ix();
	return /* @__PURE__ */ Z("div", {
		className: "relative flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-ground",
		children: [
			/* @__PURE__ */ Z("header", {
				className: "fade-from-top absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-4 p-1",
				children: [
					/* @__PURE__ */ X(Zr, {
						variant: B.Ghost,
						content: g.Icon,
						className: "shrink-0",
						"aria-label": r?.label ?? "Close",
						onClick: r?.onClick ?? o?.close,
						children: /* @__PURE__ */ X(R, { iconName: H.Left })
					}),
					/* @__PURE__ */ Z("div", {
						className: "flex min-w-0 flex-1 items-center gap-2",
						children: [/* @__PURE__ */ X("h2", {
							className: "header-md min-w-0 truncate text-basic-primary",
							children: e
						}), t]
					}),
					n ? /* @__PURE__ */ X("div", {
						className: "flex shrink-0 items-center gap-2",
						children: n
					}) : null
				]
			}),
			a,
			i ? o?.bar : null
		]
	});
}
// src/app/components/inspector/PanelSplit.tsx
function Rx({ list: e, listToolbar: t, listClassName: n, listTitle: r, title: i, titleAction: a, actions: o, children: s }) {
	let { setPanelListWidth: c, usePanelListWidth: l } = V().stores.panelWidth, { useSidePanelList: u, toggleSidePanelList: d, showSidePanelList: f } = V().stores.sessionLayoutStore, p = l(), m = N(), h = Se(), _ = u(), v = q(null), [y, b] = J(0), x = q(!1), S = q(null);
	G(() => () => S.current?.(), []), pi(() => {
		let e = v.current;
		if (!e) return;
		let t = () => b(e.clientWidth);
		t();
		let n = new ResizeObserver(t);
		return n.observe(e), () => n.disconnect();
	}, [m, h]);
	let C = y > 0 ? y * de : p ?? 208, w = be(p ?? Ye(y), C);
	return m ? _ ? /* @__PURE__ */ X(Lx, {
		title: r,
		actions: t,
		bar: !0,
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col flex-1 min-h-0 overflow-auto px-2 pt-16 pb-32 gap-1 [&>*]:shrink-0",
			children: e
		})
	}) : /* @__PURE__ */ X(Lx, {
		title: i ?? r,
		titleAction: a,
		actions: o,
		back: {
			label: "Open list",
			onClick: () => f(!0)
		},
		children: s
	}) : h ? /* @__PURE__ */ Z("div", {
		className: "flex flex-col flex-1 min-h-0 w-full",
		children: [_ ? null : /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-[10px] h-12 pl-4 pr-2 shrink-0 border-b border-muted",
			children: [
				/* @__PURE__ */ X("span", {
					className: "min-w-0 truncate header-sm text-basic-primary",
					children: i
				}),
				a,
				/* @__PURE__ */ X("span", { className: "flex-1" }),
				o,
				/* @__PURE__ */ X(z, {
					size: U.Medium,
					variant: B.Ghost,
					content: g.Icon,
					"aria-label": "Open list",
					"aria-expanded": !1,
					onClick: d,
					children: /* @__PURE__ */ X(R, { iconName: H.List })
				})
			]
		}), _ ? /* @__PURE__ */ Z("div", {
			className: "flex flex-col flex-1 min-h-0",
			children: [/* @__PURE__ */ Z("div", {
				className: "flex items-center gap-[10px] h-12 px-2 shrink-0 border-b border-muted",
				children: [/* @__PURE__ */ X(z, {
					className: "shrink-0",
					size: U.Medium,
					variant: B.Ghost,
					content: g.Icon,
					"aria-label": "Close list",
					onClick: () => f(!1),
					children: /* @__PURE__ */ X(R, { iconName: H.Left })
				}), t ? /* @__PURE__ */ X("div", {
					className: "flex min-w-0 flex-1 items-center",
					children: t
				}) : /* @__PURE__ */ X("span", {
					className: "min-w-0 truncate header-sm text-basic-primary",
					children: r
				})]
			}), /* @__PURE__ */ X("div", {
				className: "flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-2 [&>*]:shrink-0",
				children: e
			})]
		}) : /* @__PURE__ */ X("div", {
			className: "flex flex-col flex-1 min-w-0 min-h-0",
			children: s
		})]
	}) : /* @__PURE__ */ Z("div", {
		ref: v,
		className: "flex flex-1 min-h-0 w-full",
		children: [/* @__PURE__ */ X("div", {
			className: "flex flex-col flex-1 min-w-0 min-h-0",
			children: s
		}), /* @__PURE__ */ Z("div", {
			className: "relative flex flex-col shrink-0 min-h-0 border-l border-muted",
			style: { width: w },
			children: [
				t,
				/* @__PURE__ */ X("div", {
					className: I("flex flex-col flex-1 min-h-0 overflow-auto px-1 py-4 [&>*]:shrink-0", n),
					children: e
				}),
				/* @__PURE__ */ X("div", {
					role: "separator",
					"aria-orientation": "vertical",
					"aria-label": "Resize list panel",
					"aria-valuemin": 180,
					"aria-valuemax": Math.round(C),
					"aria-valuenow": w,
					tabIndex: 0,
					className: "absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none",
					onPointerDown: (e) => {
						if (e.button !== 0) return;
						let t = v.current;
						if (!t) return;
						e.preventDefault(), S.current?.(), x.current = !0, e.currentTarget.setPointerCapture(e.pointerId);
						let n = e.currentTarget, r = t.style.cursor, i = t.style.userSelect;
						t.style.cursor = "col-resize", t.style.userSelect = "none";
						let a = (n) => {
							if (!x.current || n.pointerId !== e.pointerId) return;
							let r = t.getBoundingClientRect(), i = r.right - n.clientX;
							c(be(i, r.width * de));
						}, o = () => {
							x.current = !1, t.style.cursor = r, t.style.userSelect = i, window.removeEventListener("pointermove", a), window.removeEventListener("pointerup", o), window.removeEventListener("pointercancel", o);
							try {
								n.releasePointerCapture(e.pointerId);
							} catch {}
						};
						S.current = o, window.addEventListener("pointermove", a), window.addEventListener("pointerup", o), window.addEventListener("pointercancel", o);
					},
					onKeyDown: (e) => {
						let t = e.shiftKey ? 24 : 8;
						e.key === "ArrowLeft" ? (e.preventDefault(), c(be(w + t, C))) : e.key === "ArrowRight" && (e.preventDefault(), c(be(w - t, C)));
					}
				})
			]
		})]
	});
}
function zx({ label: e, active: t = !1, disabled: n = !1, icon: r, trailing: i, title: a, onClick: o }) {
	let s = N();
	return /* @__PURE__ */ Z(Ui, {
		type: "button",
		size: s ? Bi.Large : Bi.Small,
		active: t,
		disabled: n,
		"aria-pressed": t,
		title: a,
		onClick: o,
		children: [
			r,
			/* @__PURE__ */ X("span", {
				className: "flex-1 min-w-0 truncate text-left",
				children: e
			}),
			i
		]
	});
}
function Bx({ listTitle: e }) {
	let t = N();
	return /* @__PURE__ */ X(Rx, {
		listTitle: e,
		list: /* @__PURE__ */ X("div", {
			className: "px-1",
			children: /* @__PURE__ */ X(Qa, {
				rows: 2,
				rowClassName: "h-7"
			})
		}),
		children: /* @__PURE__ */ X("div", {
			role: "status",
			"aria-label": `Loading ${e ?? "panel"}`,
			className: I("flex flex-1 flex-col min-h-0 overflow-hidden p-4", t && "pt-18"),
			children: /* @__PURE__ */ X(Qa, {
				rows: 3,
				rowClassName: "h-6"
			})
		})
	});
}
function Vx({ title: e, children: t }) {
	let n = N();
	return e === void 0 ? /* @__PURE__ */ X("div", {
		className: I("flex flex-1 flex-col min-h-0 overflow-auto p-6 label-small text-basic-muted [&>*]:shrink-0", n && "pt-20"),
		children: t
	}) : /* @__PURE__ */ Z("div", {
		className: I("flex flex-1 flex-col min-h-0 overflow-auto p-4 code code-small [&>*]:shrink-0", n && "pt-18"),
		children: [/* @__PURE__ */ X("p", {
			className: "text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ X("p", {
			className: "text-basic-muted",
			children: t
		})]
	});
}
// src/app/lib/markdownChunk.ts
var Hx = null, Ux = !1;
function Wx() {
	return Hx ??= import("./chunks/markdown-renderer-CdDZBiZ9.js").then((e) => e.t).then((e) => (Ux = !0, e)), Hx;
}
function Gx() {
	return Ux;
}
// src/app/lib/markdown.tsx
var Kx = ci(Wx);
function qx({ children: e, streaming: t = !1, className: n }) {
	return /* @__PURE__ */ X("div", {
		className: I("chat-response markdown markdown-content text-basic-primary w-full", t && "streaming", n),
		children: /* @__PURE__ */ X(oi, {
			fallback: /* @__PURE__ */ X("pre", {
				className: "whitespace-pre-wrap font-sans",
				children: e
			}),
			children: /* @__PURE__ */ X(Kx, {
				streaming: t,
				children: e
			})
		})
	});
}
// src/app/components/inspector/TaskPreview.tsx
function Jx({ text: e, active: t }) {
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(R, {
		iconName: H.Info,
		size: 16,
		className: I("shrink-0", t ? "text-basic-primary" : "text-btn-secondary")
	}), /* @__PURE__ */ X("span", {
		className: I("underline label-micro", t ? "text-basic-primary" : "text-btn-secondary"),
		children: e
	})] });
}
function Yx({ action: e, open: t, onClose: n, children: r }) {
	return /* @__PURE__ */ X(x, {
		open: t,
		onClose: n,
		placement: M.BottomRight,
		sticky: !0,
		size: "w-[430px] max-w-[calc(100vw-16px)]",
		panelClassName: "p-4 overflow-auto max-h-[70vh]",
		sheetClassName: "max-h-[70vh] overflow-auto",
		className: "shrink-0",
		content: /* @__PURE__ */ X(qx, {
			className: "text-basic-primary px-4 md:px-0",
			children: e
		}),
		children: r
	});
}
function Xx({ action: e }) {
	let [t, n] = J(!1);
	return /* @__PURE__ */ X(Yx, {
		action: e,
		open: t,
		onClose: () => n(!1),
		children: /* @__PURE__ */ X("button", {
			type: "button",
			className: "flex items-center gap-1 shrink-0",
			"aria-expanded": t,
			onClick: () => n((e) => !e),
			children: /* @__PURE__ */ X(Jx, {
				text: "Task",
				active: t
			})
		})
	});
}
function Zx({ action: e }) {
	let [t, n] = J(!1);
	return /* @__PURE__ */ X(Yx, {
		action: e,
		open: t,
		onClose: () => n(!1),
		children: /* @__PURE__ */ Z(Zr, {
			variant: B.Ghost,
			content: g.IconLeft,
			"aria-expanded": t,
			onClick: () => n((e) => !e),
			children: [/* @__PURE__ */ X(R, { iconName: H.Info }), "Task"]
		})
	});
}
// src/app/components/inspector/SteeringPromptModal.tsx
function Qx({ open: e, title: t, subheader: n, value: r, submitting: i, disabled: a = !1, footerLeading: o, onChange: s, onClose: c, onSubmit: l }) {
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: i ? void 0 : c,
		onNavigate: c,
		size: Tn.Wide,
		title: t,
		subheader: n,
		children: /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ X(tu, {
				label: "Steering message",
				"aria-label": "Steering message",
				textAreaSize: eu.Medium,
				value: r,
				onChange: (e) => s(e.target.value),
				isDisabled: i,
				textAreaClassName: "h-[140px] resize-none"
			}), /* @__PURE__ */ Z("div", {
				className: "flex flex-wrap items-center justify-between gap-3",
				children: [/* @__PURE__ */ X("div", { children: o }), /* @__PURE__ */ X(z, {
					variant: B.Primary,
					loading: i,
					disabled: a || i,
					onClick: l,
					children: "Send steering"
				})]
			})]
		})
	});
}
// src/app/components/inspector/ThreadSteeringModal.tsx
function $x({ sessionId: e, threadName: t, onClose: n }) {
	let [r, i] = J(""), a = Bt(), o = nr(), s = async () => {
		let s = r.trim();
		if (!s) o.error("A steering message is required.");
		else try {
			await a.mutateAsync({
				id: e,
				threadName: t,
				instruction: s
			}), i(""), n();
		} catch (e) {
			o.error(`Unable to steer ${t}: ${Vt(Ud(e))}`);
		}
	};
	return /* @__PURE__ */ X(Qx, {
		open: !0,
		title: `Steer ${t}`,
		value: r,
		submitting: a.isPending,
		onChange: i,
		onClose: n,
		onSubmit: () => void s()
	});
}
// src/app/components/inspector/threads/ThreadEpisodes.tsx
var eS = {
	error: {
		label: "Failed",
		color: na.Red
	},
	timed_out: {
		label: "Timed out",
		color: na.Yellow
	},
	cancelled: {
		label: "Cancelled",
		color: na.Yellow
	}
};
function tS({ episode: e, index: t }) {
	let [n, r] = J(!1), i = N(), a = eS[e.status], o = i ? "label-small" : "label-micro";
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col items-start w-full",
		children: [/* @__PURE__ */ Z("button", {
			type: "button",
			className: "group flex items-center gap-2 w-full py-3 pl-1 pr-3 md:py-2 md:pl-3 md:pr-2 rounded-[4px] btn-ghost",
			"aria-expanded": n,
			onClick: () => r((e) => !e),
			children: [
				/* @__PURE__ */ X(R, {
					iconName: n ? H.Down : H.Right,
					size: 16,
					className: "shrink-0 text-basic-muted"
				}),
				/* @__PURE__ */ X("span", {
					className: `shrink-0 ${o} text-basic-primary`,
					children: `Episode ${t + 1}`
				}),
				a ? /* @__PURE__ */ X(ia, {
					text: a.label,
					color: a.color,
					className: "shrink-0"
				}) : null
			]
		}), /* @__PURE__ */ X(Io, {
			isOpen: n,
			className: "w-full",
			children: /* @__PURE__ */ X("div", {
				className: "flex flex-col pl-1 pr-1 md:pl-3 md:pr-2 pt-2 pb-6",
				children: e.content.trim() ? /* @__PURE__ */ X(qx, {
					className: "text-basic-primary",
					children: e.content
				}) : /* @__PURE__ */ X("p", {
					className: "label-small text-basic-muted",
					children: a ? "The dispatch ended before the thread answered." : "The thread answered with nothing."
				})
			})
		})]
	});
}
function nS({ episodes: e, running: t, className: n }) {
	return e.length ? /* @__PURE__ */ X("div", {
		className: I("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", n),
		children: /* @__PURE__ */ X("div", {
			className: "pb-[128px] md:pb-4 flex flex-col",
			children: e.map((e, t) => /* @__PURE__ */ Z("div", {
				className: "flex flex-col",
				children: [t > 0 ? /* @__PURE__ */ X(nd, {}) : null, /* @__PURE__ */ X(tS, {
					episode: e,
					index: t
				})]
			}, e.id))
		})
	}) : /* @__PURE__ */ X("div", {
		className: I("flex flex-1 min-h-0", n),
		children: /* @__PURE__ */ X("p", {
			className: "p-4 max-w-prose label-small text-basic-muted",
			children: t ? "An episode records one dispatch — what the thread was asked to do and what came back. This one is written when the dispatch ends; until then Logs is the live view." : "This thread has not been dispatched yet, so it has no episodes."
		})
	});
}
// src/app/lib/scroll.ts
var rS = (e) => 1 - (1 - e) ** 3, iS = (e) => e.scrollHeight - (e.scrollTop + e.clientHeight);
function aS(e) {
	e.scrollTop = e.scrollHeight - e.clientHeight;
}
function oS(e, t, n = 300, r) {
	if (r?.aborted) return Promise.resolve(!1);
	let i = Math.max(0, e.scrollHeight - e.clientHeight), a = e.scrollTop, o = Math.min(Math.max(0, t), i), s = o - a, c = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	return !s || n <= 0 || c ? (e.scrollTop = o, Promise.resolve(!0)) : new Promise((s) => {
		let c = null, l = 0, u = !1, d = (t) => {
			u || (u = !0, cancelAnimationFrame(l), e.removeEventListener("wheel", f), e.removeEventListener("touchstart", f), r?.removeEventListener("abort", f), s(t));
		}, f = () => d(!1);
		e.addEventListener("wheel", f, {
			passive: !0,
			once: !0
		}), e.addEventListener("touchstart", f, {
			passive: !0,
			once: !0
		}), r?.addEventListener("abort", f, { once: !0 });
		let p = t >= i, m = (t) => {
			if (u) return;
			c ??= t;
			let r = Math.min(1, (t - c) / n), i = Math.max(0, e.scrollHeight - e.clientHeight), s = a + ((p ? i : Math.min(o, i)) - a) * rS(r);
			e.scrollTop = p ? Math.max(e.scrollTop, s) : s, r < 1 ? l = requestAnimationFrame(m) : d(!0);
		};
		l = requestAnimationFrame(m);
	});
}
// src/app/components/inspector/threads/ThreadLog.tsx
var sS = li(function({ entry: e, running: t }) {
	let n = e.status === "pending" && t;
	return /* @__PURE__ */ Z("div", {
		className: "pt-1",
		children: [/* @__PURE__ */ X("p", {
			className: I("code code-small whitespace-pre-wrap break-words", n ? "text-shimmer-basic" : "text-basic-tertiary"),
			children: n ? /* @__PURE__ */ Z(Y, { children: [
				"▸ ",
				`${e.toolName}: `,
				e.keyArg
			] }) : /* @__PURE__ */ Z(Y, { children: [
				/* @__PURE__ */ X("span", {
					className: "text-info-primary",
					children: "▸ "
				}),
				/* @__PURE__ */ X("span", {
					className: "text-basic-primary",
					children: `${e.toolName}: `
				}),
				e.keyArg
			] })
		}), e.resultPreview === null ? null : /* @__PURE__ */ Z("p", {
			className: "pl-4 pt-0.5 code code-small whitespace-pre-wrap break-words text-basic-tertiary",
			children: [/* @__PURE__ */ X("span", {
				className: e.isError ? "text-error-primary" : "text-success-primary",
				children: `${e.isError ? "✕" : "✓"} `
			}), e.resultPreview]
		})]
	});
}), cS = li(function({ entry: e }) {
	return /* @__PURE__ */ Z("p", {
		className: "pt-1 code code-small whitespace-pre-wrap break-words text-basic-tertiary",
		children: [
			e.mark ? /* @__PURE__ */ X("span", {
				className: e.isError ? "text-error-primary" : "text-success-primary",
				children: `${e.mark} `
			}) : null,
			e.name ? /* @__PURE__ */ X("span", {
				className: "text-basic-primary",
				children: `${e.name}: `
			}) : null,
			e.body
		]
	});
}), lS = li(function({ entry: e, running: t }) {
	return e.kind === "tool_call" ? /* @__PURE__ */ X(sS, {
		entry: e,
		running: t
	}) : /* @__PURE__ */ X(cS, { entry: e });
});
function uS({ scrollRef: e, stuckRef: t, entries: n, running: r, thinking: i, loading: a, className: o, historyControl: s }) {
	return /* @__PURE__ */ Z("div", {
		ref: e,
		className: I("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0 bg-elevation-ground", o),
		onScroll: () => {
			let n = e.current;
			n && (t.current = iS(n) <= 60);
		},
		children: [s, /* @__PURE__ */ Z("div", {
			className: "pb-[128px] md:pb-4",
			children: [
				n.map((e) => /* @__PURE__ */ X(lS, {
					entry: e,
					running: r
				}, e.kind === "tool_call" ? `call-${e.callId}` : e.key)),
				i ? /* @__PURE__ */ Z("p", {
					className: "pt-1 code code-small",
					children: [/* @__PURE__ */ X("span", {
						className: "text-info-primary",
						children: "▸ "
					}), /* @__PURE__ */ X("span", {
						className: "text-shimmer-basic",
						children: "Working…"
					})]
				}) : null,
				!n.length && !i && (a || r) ? /* @__PURE__ */ X("div", {
					role: "status",
					"aria-label": "Loading command log",
					className: "pt-4",
					children: /* @__PURE__ */ X(Qa, {
						rows: 3,
						rowClassName: "h-6"
					})
				}) : null,
				!n.length && !r && !a ? /* @__PURE__ */ X("p", {
					className: "pt-4 code code-small text-basic-muted",
					children: "No commands recorded."
				}) : null
			]
		})]
	});
}
function dS({ lines: e, running: t, hasOlder: n, loadingOlder: r, loadingInitial: i, historyError: a, onRetry: o, onLoadOlder: s, className: c }) {
	let l = q(null), u = q(null), d = q(!0), f = K(() => Cn(e), [e]), p = K(() => Yr(t, e), [t, e]), m = f[0]?.kind === "tool_call" ? `call-${f[0].callId}` : f[0]?.key ?? null;
	pi(() => {
		let e = l.current, t = u.current;
		e && t && e.firstKey !== m && (t.scrollTop = e.top + (t.scrollHeight - e.height), l.current = null);
	}, [m]), G(() => {
		let e = l.current;
		!r && e?.firstKey === m && (l.current = null);
	}, [m, r]);
	let h = () => {
		d.current = !1;
		let e = u.current;
		e && (l.current = {
			height: e.scrollHeight,
			top: e.scrollTop,
			firstKey: m
		}), s().catch(() => {
			l.current = null;
		});
	};
	return pi(() => {
		let e = u.current;
		e && d.current && aS(e);
	}, [f.length, p]), /* @__PURE__ */ X(uS, {
		scrollRef: u,
		stuckRef: d,
		entries: f,
		running: t,
		thinking: p,
		loading: i,
		className: c,
		historyControl: n || a ? /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-2 pb-3",
			children: [n ? /* @__PURE__ */ X(z, {
				size: U.Small,
				variant: B.Secondary,
				disabled: r,
				onClick: h,
				children: r ? "Loading…" : "Load older commands"
			}) : null, a ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("span", {
				className: "text-micro text-error-primary",
				children: a
			}), /* @__PURE__ */ X(z, {
				size: U.Small,
				variant: B.Ghost,
				onClick: () => {
					n ? h() : o();
				},
				children: "Try again"
			})] }) : null]
		}) : null
	});
}
// src/app/components/inspector/threads/ThreadViewControls.tsx
var fS = {
	log: "Logs",
	overview: "Overview"
}, pS = ["log", "overview"], mS = pS.map((e) => ({
	id: e,
	label: fS[e]
}));
function hS({ view: e, onChange: t }) {
	return /* @__PURE__ */ X("div", {
		className: "flex items-center gap-2 shrink-0",
		role: "group",
		"aria-label": "Thread detail view",
		children: pS.map((n) => /* @__PURE__ */ X(Bl, {
			size: Rl.Small,
			active: e === n,
			className: "!h-8",
			"aria-pressed": e === n,
			onClick: () => t(n),
			children: fS[n]
		}, n))
	});
}
function gS({ view: e, onChange: t, floating: n = !1 }) {
	return /* @__PURE__ */ X(Xu, {
		size: n ? U.Large : U.Small,
		variant: n ? B.Primary : B.Secondary,
		floating: n,
		value: e,
		items: mS,
		onValueChange: (e) => t(e)
	});
}
// src/app/components/inspector/threads/ThreadDetail.tsx
function _S({ thread: e, action: t, episodes: n, events: r, liveLog: i, running: a, hasOlder: o, loadingOlder: s, loadingInitial: c, historyError: l, onLoadOlder: u, onRetry: d, view: f, canSteer: p, onSteer: m, onViewChange: h }) {
	let g = N(), _ = Se(), v = K(() => Lt(Fr(r), i), [r, i]), y = g ? "pt-18" : void 0, b = f === "log" ? /* @__PURE__ */ X(dS, {
		lines: v,
		running: a,
		hasOlder: o,
		loadingInitial: c,
		loadingOlder: s,
		historyError: l,
		onLoadOlder: u,
		onRetry: d,
		className: y
	}) : /* @__PURE__ */ X(nS, {
		episodes: n,
		running: a,
		className: y
	});
	return _ ? /* @__PURE__ */ X("div", {
		className: "flex flex-col flex-1 min-h-0 min-w-0",
		children: b
	}) : g ? /* @__PURE__ */ Z("div", {
		className: "relative flex flex-col flex-1 min-h-0 min-w-0",
		children: [b, /* @__PURE__ */ Z("div", {
			role: "toolbar",
			"aria-label": "Thread controls",
			className: "fade-from-bottom absolute inset-x-0 bottom-0 flex items-center justify-end gap-3 p-3",
			children: [p ? /* @__PURE__ */ X(Zr, {
				variant: B.Ghost,
				onClick: m,
				children: "Steer"
			}) : null, /* @__PURE__ */ X(gS, {
				view: f,
				onChange: h,
				floating: !0
			})]
		})]
	}) : /* @__PURE__ */ Z("div", {
		className: "flex flex-col flex-1 min-h-0 min-w-0",
		children: [/* @__PURE__ */ Z("div", {
			className: "flex flex-wrap items-center gap-2 min-h-14 pl-4 pr-2 py-3 shrink-0 border-b border-muted bg-elevation-ground",
			children: [/* @__PURE__ */ Z("div", {
				className: "flex grow basis-48 min-w-0 items-center gap-3",
				children: [
					/* @__PURE__ */ X("span", {
						className: "min-w-0 truncate label-small text-basic-primary",
						children: /* @__PURE__ */ X("span", {
							className: I(a && "text-shimmer-basic"),
							children: e.name
						})
					}),
					/* @__PURE__ */ Z("span", {
						className: "shrink-0 text-micro text-basic-muted",
						children: [n.length, " ep"]
					}),
					t ? /* @__PURE__ */ X(Xx, { action: t }) : null
				]
			}), /* @__PURE__ */ Z("div", {
				className: "flex flex-wrap items-center gap-2 min-w-0",
				children: [p ? /* @__PURE__ */ X(z, {
					size: U.Small,
					variant: B.Secondary,
					onClick: m,
					children: "Steer"
				}) : null, /* @__PURE__ */ X(hS, {
					view: f,
					onChange: h
				})]
			})]
		}), b]
	});
}
// src/app/components/inspector/threads/useThreadRunState.ts
function vS(e) {
	let { useStreamStatus: t, useLiveThreads: n } = V().stores.runtimeStore, r = n(), i = t(), a = e?.active_threads, o = i === "connecting" || i === "reconnecting";
	return {
		liveThreads: r,
		runningNames: K(() => {
			let e = /* @__PURE__ */ new Set();
			for (let t of a ?? []) {
				let n = r[t]?.status;
				(n === "running" || n !== "finished" && o) && e.add(t);
			}
			for (let [t, n] of Object.entries(r)) n.status === "running" ? e.add(t) : n.status === "finished" && e.delete(t);
			return e;
		}, [
			a,
			r,
			o
		])
	};
}
function yS(e, t) {
	return e && t?.status === "running";
}
// src/app/components/inspector/transcript/TranscriptModelContext.ts
var bS = si(null);
function xS() {
	let e = di(bS);
	if (e == null) throw Error("useTranscriptModelContext must be used inside a TranscriptModelProvider");
	return e;
}
// src/app/features/insights/model/actionKinds.ts
var SS = /* @__PURE__ */ new Map([
	["thread", "thread"],
	["workset_define", "define-workset"],
	["thread_delete", "delete-thread"],
	["read", "read-file"],
	["write", "write-file"],
	["edit", "edit-file"],
	["glob", "glob"],
	["grep", "grep"],
	["exec_command", "run-command"],
	["write_stdin", "write-command"],
	["read_command_output", "read-command-output"],
	["web_search", "web-search"],
	["web_fetch", "web-fetch"],
	["create_goal", "create-goal"],
	["get_goal", "get-goal"],
	["update_goal", "update-goal"],
	["subagent", "spawn-agent"],
	["orchestrator_launch", "spawn-orchestrator"],
	["subagent_status", "session-status"],
	["orchestrator_status", "session-status"],
	["orchestrator_steer", "session-steer"],
	["orchestrator_read", "session-read"],
	["orchestrator_wait", "session-wait"],
	["subagent_cancel", "session-cancel"],
	["orchestrator_cancel", "session-cancel"]
]);
function CS(e) {
	return SS.get(e) ?? "other";
}
function wS(e) {
	return e === "spawn-agent" || e === "spawn-orchestrator";
}
function TS(e) {
	return e.kind === "reasoning" ? "reasoning" : e.kind === "workset" ? "define-workset" : e.action;
}
// src/app/features/insights/model/durations.ts
function ES(e) {
	return e.kind === "reasoning" ? e.durationMs : e.kind === "tool" ? e.presentation?.durationMs ?? null : null;
}
function DS(e) {
	let t = null;
	for (let n of e) {
		let e = ES(n);
		e !== null && (t = (t ?? 0) + e);
	}
	return t;
}
function OS(e) {
	return (Math.round(Math.max(0, e) / 100) / 10).toFixed(1);
}
function kS(e) {
	return `${OS(e)} s`;
}
function AS(e) {
	return `${OS(e)}s`;
}
// src/app/features/insights/model/status.ts
var jS = {
	pending: "running",
	running: "running",
	"awaiting-approval": "pending",
	success: "ready",
	error: "failed",
	"timed-out": "failed",
	cancelled: "failed",
	interrupted: "failed"
}, MS = {
	running: "running",
	pending: "pending",
	done: "ready",
	cancelled: "failed",
	error: "failed"
}, NS = [
	"running",
	"pending",
	"failed",
	"ready"
];
function PS(e) {
	return jS[e];
}
function FS(e) {
	return e.kind === "reasoning" ? e.streaming ? "running" : "ready" : e.kind === "tool" && e.presentation ? PS(e.presentation.status) : e.pending ? "running" : "ready";
}
function IS(e) {
	let t = NS.length - 1;
	for (let n of e) t = Math.min(t, NS.indexOf(n));
	return NS[t];
}
function LS(e) {
	return e.kind === "group" ? e.group.status : e.kind === "thread" ? MS[e.thread.state] : e.status;
}
// src/app/features/insights/model/labels.ts
var RS = {
	reasoning: {
		type: "Thoughts",
		running: "Thinking…",
		live: "Thinking…",
		meta: null
	},
	thread: {
		type: "Thread",
		running: "Running thread…",
		live: "Running thread…",
		meta: "Thread"
	},
	"define-workset": {
		type: "Define Workset",
		running: "Defining Workset…",
		live: "Defining workset…",
		meta: "Workset"
	},
	"delete-thread": {
		type: "Delete thread",
		running: "Deleting…",
		live: "Deleting thread…",
		meta: null
	},
	"read-file": {
		type: "Read File",
		running: "Reading File…",
		live: "Reading file…",
		meta: "Read"
	},
	"write-file": {
		type: "Create File",
		running: "Creating File…",
		live: "Writing file…",
		meta: "Write"
	},
	"edit-file": {
		type: "Edit File",
		running: "Editing File…",
		live: "Editing file…",
		meta: "Edit"
	},
	glob: {
		type: "Find files",
		running: "Find files…",
		live: "Finding files…",
		meta: "Glob"
	},
	grep: {
		type: "Search files",
		running: "Search files…",
		live: "Searching files…",
		meta: "Grep"
	},
	"run-command": {
		type: "Run command",
		running: "Running command…",
		live: "Running command…",
		meta: "Exec"
	},
	"write-command": {
		type: "Write command",
		running: "Write command…",
		live: "Writing to terminal…",
		meta: "Write"
	},
	"read-command-output": {
		type: "Read Output Command",
		running: "Read Output Command…",
		live: "Reading command output…",
		meta: "Read"
	},
	"web-search": {
		type: "Search",
		running: "Searching the web…",
		live: "Searching the web…",
		meta: "Search"
	},
	"web-fetch": {
		type: "Fetch",
		running: "Fetching…",
		live: "Fetching…",
		meta: "Fetch"
	},
	"create-goal": {
		type: "Create goal",
		running: "Creating goal…",
		live: "Creating goal…",
		meta: "Create"
	},
	"get-goal": {
		type: "Get goal",
		running: "Get goal…",
		live: "Reading goal…",
		meta: "Read"
	},
	"update-goal": {
		type: "Update goal",
		running: "Updating goal…",
		live: "Updating goal…",
		meta: "Edit"
	},
	"spawn-agent": {
		type: "Spawn Agent",
		running: "Spawn Agent…",
		live: "Starting agent…",
		meta: "Spawn"
	},
	"spawn-orchestrator": {
		type: "Spawn Orchestrator",
		running: "Spawn Orchestrator…",
		live: "Starting orchestrator…",
		meta: "Spawn"
	},
	"session-status": {
		type: "Check session status",
		running: "Checking session status…",
		live: "Checking session…",
		meta: "Check"
	},
	"session-steer": {
		type: "Steer session",
		running: "Steer session…",
		live: "Steering session…",
		meta: "Steer"
	},
	"session-read": {
		type: "Read session",
		running: "Reading session…",
		live: "Reading session…",
		meta: "Read"
	},
	"session-wait": {
		type: "Wait for session",
		running: "Wait for session…",
		live: "Waiting for session…",
		meta: "Wait"
	},
	"session-cancel": {
		type: "Cancel session",
		running: "Cancelling session…",
		live: "Cancelling session…",
		meta: "Cancel"
	},
	other: {
		type: "Tool",
		running: "Running tool…",
		live: "Running tool…",
		meta: "Tool"
	}
}, zS = {
	"read-file": (e) => `Reading ${e}…`,
	"write-file": (e) => `Writing ${e}…`,
	"edit-file": (e) => `Editing ${e}…`,
	"run-command": (e) => `Running ${e}…`,
	"web-fetch": (e) => `Fetching ${e}…`
}, BS = /* @__PURE__ */ new Set([
	"read-file",
	"write-file",
	"edit-file"
]), VS = /* @__PURE__ */ new Set([
	"glob",
	"grep",
	"web-search",
	"spawn-agent",
	"spawn-orchestrator",
	"session-status",
	"session-steer",
	"session-read",
	"session-wait",
	"session-cancel"
]), HS = 40, US = /\s*…+$/u, WS = "Awaiting approval…", GS = "Working…";
function KS(e) {
	let t = e.replace(/[\\/]+$/, "");
	return t.slice(Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1) || null;
}
function qS(e) {
	try {
		return new URL(e).host || null;
	} catch {
		return null;
	}
}
function JS(e) {
	return e.startsWith("(in ") ? null : e.replace(/\s+/g, " ").trim() || null;
}
function YS(e, t) {
	return (e === "run-command" ? [...t].slice(0, HS).join("") : t).replace(US, "").trimEnd();
}
function XS(e, t) {
	return t ? BS.has(e) ? KS(t) : e === "web-fetch" ? qS(t) : e === "run-command" ? JS(t) : VS.has(e) ? t : null : null;
}
function ZS(e) {
	return RS[e].type;
}
function QS(e) {
	return RS[e].running;
}
function $S(e, t = null) {
	return e === "reasoning" ? t === null ? null : kS(t) : RS[e].meta;
}
function eC(e) {
	return e.kind === "tool" && e.action === "other" ? e.presentation?.label ?? e.name : ZS(TS(e));
}
function tC(e) {
	if (e.kind === "workset" && e.worksetId) return `Worksets_${e.worksetId}`;
	if (e.kind === "tool") {
		let t = e.presentation?.summary;
		if (e.action === "delete-thread" && t) return `Deleted: ${t}`;
		let n = XS(e.action, t);
		if (n) return n;
	}
	return eC(e);
}
function nC(e) {
	return $S(TS(e), ES(e));
}
function rC(e) {
	let t = TS(e);
	if (e.kind === "tool") {
		if (t === "other") return `Running ${eC(e)}…`;
		let n = zS[t], r = XS(t, e.presentation?.summary), i = r ? YS(t, r) : "";
		if (n && i) return n(i);
	}
	return RS[t].live;
}
function iC(e) {
	let t = [...new Set(e.segments.map((e) => e.kind === "workset" ? "Workset" : eC(e)))], n = t.slice(0, 2).join(", ");
	return t.length > 2 ? `${n} and more` : n;
}
function aC(e) {
	return e.durationMs === null ? iC(e) : `Total activity: ${AS(e.durationMs)}`;
}
function oC(e) {
	for (let t = e.segments.length - 1; t >= 0; --t) {
		let n = e.segments[t];
		if (FS(n) === "running") return rC(n);
	}
	return e.status === "pending" ? WS : null;
}
function sC(e) {
	return e.kind === "thread" ? `Thread, ${e.episodes}` : e.kind === "session" ? $S(e.action) : String(e.group.segments.length);
}
function cC(e, t, n) {
	return t === "running" ? {
		action: e,
		label: n.running,
		meta: null,
		status: t
	} : t === "failed" ? {
		action: e,
		label: n.failed,
		meta: null,
		status: t
	} : {
		action: e,
		label: n.ready,
		meta: n.meta,
		status: t
	};
}
function lC(e) {
	let t = TS(e), n = eC(e);
	return cC(t, FS(e), {
		ready: tC(e),
		meta: nC(e),
		failed: n,
		running: t === "other" ? `${n}…` : QS(t)
	});
}
function uC(e) {
	if (e.kind === "thread") return {
		action: "thread",
		label: e.thread.name,
		meta: sC(e),
		status: LS(e)
	};
	if (e.kind === "session") return cC(e.action, e.status, {
		ready: e.title,
		meta: sC(e),
		failed: ZS(e.action),
		running: QS(e.action)
	});
	let { group: t } = e, [n] = t.segments.length === 1 ? t.segments : [];
	return n && (t.status === "running" || t.status === "pending") ? lC(n) : cC(n ? TS(n) : null, t.status, {
		ready: aC(t),
		meta: sC(e),
		failed: aC(t),
		running: GS
	});
}
// src/app/lib/toolMarkup.ts
var dC = "parameter|tool_use|tool_call|tool_name|invoke|arguments|parameters|function", fC = RegExp(`<(${dC})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), pC = RegExp(`<\\/?(?:${dC})\\b[^>]*>`, "gi");
function mC(e) {
	if (!e.includes("<")) return e;
	let t = e, n = "";
	for (; t !== n;) n = t, fC.lastIndex = 0, t = t.replace(fC, "");
	return pC.lastIndex = 0, t = t.replace(pC, ""), t;
}
// src/app/lib/toolPresentation.ts
function hC(e) {
	return typeof e == "string" ? {
		text: e,
		hasImage: !1
	} : {
		text: e.map((e) => e.type === "text" ? e.text : `[Image: ${e.image.mime_type}]`).join("\n\n"),
		hasImage: e.some((e) => e.type === "image")
	};
}
function gC(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role === "tool") n.set(t.tool_call_id, hC(t.content));
		else if (t.role === "assistant" || t.role === "user") break;
	}
	return n;
}
function _C(e, t, n) {
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role !== "tool") return t.role === "assistant" && typeof t.content == "string" && t.content.trim() === n;
	}
	return !1;
}
var vC = {
	read: "Read file",
	write: "Write file",
	edit: "Edit file",
	glob: "Find files",
	grep: "Search files",
	exec_command: "Run command",
	write_stdin: "Use terminal",
	read_command_output: "Read command output",
	web_search: "Search web",
	web_fetch: "Fetch web page",
	create_goal: "Create goal",
	get_goal: "Read goal",
	update_goal: "Update goal",
	find_tasks: "Find tasks",
	read_task: "Read task",
	subagent: "Start coding agent",
	subagent_status: "Check coding agent",
	subagent_cancel: "Cancel coding agent",
	orchestrator_launch: "Start NAC orchestrator",
	orchestrator_status: "Check NAC orchestrator",
	orchestrator_steer: "Steer NAC orchestrator",
	orchestrator_read: "Read NAC orchestrator",
	orchestrator_wait: "Wait for NAC orchestrator",
	orchestrator_cancel: "Cancel NAC orchestrator"
}, yC = {
	pending: "Pending",
	running: "Running",
	"awaiting-approval": "Awaiting approval",
	success: "Succeeded",
	error: "Failed",
	"timed-out": "Timed out",
	cancelled: "Cancelled",
	interrupted: "Interrupted"
}, bC = "[tool call cancelled by user]", xC = "Tool execution was interrupted; no result was recorded.", SC = 160, CC = 180, wC = /* @__PURE__ */ new Map([["subagent", "child_session_id"], ["orchestrator_launch", "orchestrator_session_id"]]), TC = /^[^\s\p{Cc}]+$/u;
function EC(e, t) {
	let n = [...e ?? ""].map((e) => {
		let t = e.codePointAt(0) ?? 0;
		return t < 32 || t === 127 ? " " : e;
	}).join("").trim();
	return [...n].length <= t ? n : `${[...n].slice(0, t - 1).join("")}…`;
}
function DC(e) {
	let t = e.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	return t ? t[0].toUpperCase() + t.slice(1) : "Tool call";
}
function OC(e) {
	return vC[e] || (e.startsWith("mcp__") ? `MCP · ${DC(e.split("__").filter(Boolean).at(-1) ?? "tool")}` : DC(e || "tool call"));
}
function kC(e) {
	if (!e) return null;
	try {
		let t = JSON.parse(e);
		return Hd(t) ? t : null;
	} catch {
		return null;
	}
}
function AC(e) {
	return !ct(e) || !TC.test(e) || [...e].length > SC ? null : e;
}
function jC(e, t, n) {
	let r = wC.get(e);
	if (!r) return null;
	let i = AC(kC(t.function?.arguments)?.[r]);
	if (i) return i;
	let a = kC(n);
	return !a || !se(a.generation) || !ct(a.status) ? null : AC(a[r]);
}
function MC(e) {
	return e.completion_status === "timed_out" ? "timed-out" : e.completion_status === "cancelled" ? "cancelled" : e.completion_status === "error" ? "error" : e.completion_status === "success" ? "success" : e.command_status === "timed_out" ? "timed-out" : e.command_status === "cancelled" ? "cancelled" : e.command_status === "spawn_error" || e.is_error || e.exit_code != null && e.exit_code !== 0 ? "error" : "success";
}
function NC(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		if (n.type !== "tool_call_started" && n.type !== "tool_call_finished" || n.thread_name) continue;
		let e = t.get(n.call_id) ?? {};
		n.type === "tool_call_started" ? e.started = n : e.finished = n, t.set(n.call_id, e);
	}
	return t;
}
function PC({ call: e, events: t, hasResult: n, resultText: r, resultHasImage: i, active: a, awaitingApproval: o, turnCancelled: s }) {
	let c = EC(t?.started?.name ?? t?.finished?.name ?? e.function?.name ?? "tool", SC) || "tool", l;
	l = t?.finished ? MC(t.finished) : r?.startsWith(bC) || s && !n ? "cancelled" : r?.trim() === xC ? "interrupted" : n ? "success" : a && o ? "awaiting-approval" : a && t?.started ? "running" : a ? "pending" : "interrupted";
	let u = EC(t?.finished?.content_preview, CC) || null;
	!u && i && (u = "Image result"), !u && l === "cancelled" && (u = "No result was retained."), !u && l === "interrupted" && (u = "No result was recorded.");
	let d = {
		callId: e.id,
		name: c,
		label: OC(c),
		summary: EC(t?.started?.key_arg_preview, CC) || null,
		resultPreview: u,
		status: l,
		statusLabel: yC[l]
	}, f = t?.finished?.execution_duration_ms;
	f != null && Number.isFinite(f) && f >= 0 && (d.durationMs = f);
	let p = jC(c, e, r);
	return p && (d.spawnedSessionId = p), d;
}
// src/app/lib/transcript.ts
var FC = "[run cancelled by user]", IC = "[run failed after this partial assistant response]";
function LC(e) {
	let t = e.trim();
	if (t === "[run failed after this partial assistant response]") return "";
	let n = `\n\n${IC}`;
	return t.endsWith(n) ? t.slice(0, -n.length).trimEnd() : t;
}
var RC = "[tool call cancelled by user]", zC = /* @__PURE__ */ new Set([
	"threads",
	"thread_read",
	"workset_read",
	"workset_list"
]), BC = "model-streaming";
function VC(e) {
	try {
		let t = JSON.parse(e.function?.arguments || "{}");
		return Object(t) === t ? t : {};
	} catch {
		return {};
	}
}
function HC(e) {
	return ct(e) ? e : "";
}
function UC(e, t, n, r, i) {
	if (n.has(e) || i.liveFinishedToolCalls[e]) return !1;
	if (!t || !r) return !0;
	let a = i.worksets.find((e) => e.id === t);
	if (!a) return !0;
	let o = Rn(a.updated_at), s = Rn(r);
	return !Number.isFinite(o) || !Number.isFinite(s) || o < s;
}
function WC(e) {
	let t = [];
	return e.forEach((e) => {
		e.type !== "thread_started" && t.length || t.push([]), t[t.length - 1].push(e);
	}), t;
}
function GC(e) {
	let t = {};
	return Object.entries(e).forEach(([e, n]) => {
		t[e] = WC(n);
	}), t;
}
function KC(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = qC(e);
			t[n] = (t[n] ?? 0) + 1;
		});
	}), t;
}
function qC(e) {
	return HC(VC(e).name) || "thread";
}
function JC(e) {
	return qC(e);
}
function YC(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = HC(VC(e).action);
			n && (t[qC(e)] = n);
		});
	}), t;
}
function XC(e) {
	let t = VC(e).threads;
	return Array.isArray(t) ? t.filter(ct) : [];
}
function ZC(e) {
	let t = e.length;
	if (t <= 1) return t ? [e] : [];
	let n = /* @__PURE__ */ new Map();
	for (let r = 0; r < t; r += 1) {
		let t = qC(e[r]);
		if (n.has(t)) return [e];
		n.set(t, r);
	}
	let r = Array.from({ length: t }, () => []), i = Array.from({ length: t }, () => 0);
	for (let a = 0; a < t; a += 1) {
		let t = /* @__PURE__ */ new Set();
		for (let o of XC(e[a])) {
			let s = n.get(o);
			if (s !== void 0) {
				if (s === a) return [e];
				t.has(s) || (t.add(s), r[s].push(a), i[a] += 1);
			}
		}
	}
	let a = [], o = Array.from({ length: t }, () => !1), s = 0, c = i.slice();
	for (; s < t;) {
		let n = [];
		for (let e = 0; e < t; e += 1) !o[e] && c[e] === 0 && n.push(e);
		if (!n.length) return [e];
		for (let e of n) {
			for (let t of r[e]) --c[t];
			o[e] = !0;
		}
		s += n.length, a.push(n.map((t) => e[t]));
	}
	return a;
}
function QC(e, t, n) {
	let r = e.threadEpisodes[t] ?? [];
	return r[n - ((e.dispatchCounts[t] ?? r.length) - r.length)];
}
function $C(e) {
	let t = /* @__PURE__ */ new Set();
	return e.forEach((n, r) => {
		if (n.role !== "assistant") return;
		let i = gC(e, r), a = (n.tool_calls ?? []).filter((e) => e.function?.name === "thread");
		if (!a.length) return;
		let o = _C(e, r, FC), s = !1;
		for (let e of a) {
			let n = i.get(e.id)?.text, r = JC(e);
			n == null ? o || t.delete(r) : n.startsWith(RC) ? (t.add(r), s = !0) : t.delete(r);
		}
		if (s || o) for (let e of a) i.get(e.id) ?? t.add(JC(e));
	}), t;
}
function ew(e, t, n, r, i, a, o) {
	let s = qC(e), c = VC(e), l = HC(c.action), u = HC(c.weight), d = u === "light" || u === "heavy" ? u : null, f = i.get(e.id)?.text ?? null, p = t === (r.dispatchCounts[s] ?? 1) - 1 ? r.liveThreads[s] : void 0, m = XC(e).some((e) => a.has(e) && !o.has(e)), h = QC(r, s, t), g = p?.status !== "running" && h?.some((e) => e.type === "thread_finished"), _ = p?.status === "finished", v = (p?.status !== "running" || p.cancelled) && (f?.startsWith(RC) === !0 || p?.cancelled || f == null && t === (r.dispatchCounts[s] ?? 1) - 1 && r.cancelledNames.has(s)) ? "cancelled" : p?.isError ? "error" : f != null || _ || g ? "done" : m ? "pending" : "running";
	return {
		key: n,
		name: s,
		action: l,
		weight: d,
		summary: f || l,
		log: Lt(Fr(h), p?.log ?? []),
		state: v
	};
}
function tw(e, t, n) {
	let r = (e) => e.replace(/\s+/g, "");
	for (let i = e.length - 1; i >= 0; --i) {
		let a = e[i];
		if (a.kind === t && (t !== "text" || a.kind !== "text" || a.text.trim() !== "[run cancelled by user]")) return r(a.text).includes(r(n));
	}
	return !1;
}
function nw(e, t) {
	return e.reduce((e, n) => n.kind === t ? e + 1 : e, 0);
}
function rw(e, t, n = !1, r = BC) {
	let i = mC(t.reasoning).trim(), a = mC(t.text).trim();
	if (!i && !a) return e;
	let o = e[e.length - 1], s = o?.kind === "model" && !n, c = s ? {
		...o,
		blocks: o.blocks.slice()
	} : {
		kind: "model",
		key: r,
		blocks: [],
		durationMs: null,
		messageIndex: null
	}, l = t.settled === !0 && a !== "" && tw(c.blocks, "text", a), u = !1;
	return i && !l && !tw(c.blocks, "thoughts", i) && (c.blocks.push({
		kind: "thoughts",
		key: `thoughts-${nw(c.blocks, "thoughts")}`,
		text: i,
		durationMs: null,
		streaming: !a && !t.settled
	}), u = !0), a && !tw(c.blocks, "text", a) && (c.blocks.push({
		kind: "text",
		key: `text-${nw(c.blocks, "text")}`,
		text: a
	}), u = !0), u ? s ? [...e.slice(0, -1), c] : [...e, c] : e;
}
function iw(e, t, n = {}, r = [], i = /* @__PURE__ */ new Set()) {
	let a = e?.messages ?? [], o = e?.response_timing.response_durations_ms ?? [], s = e?.message_created_at ?? [], c = e?.message_page?.start ?? 0, l = e?.metadata?.behavior === "direct" || e?.metadata?.behavior === "direct-with-orchestrator", u = NC(l ? [...e?.primary_tool_events ?? [], ...r] : []), d = -1;
	a.forEach((e, t) => {
		e.role === "user" && (d = t);
	});
	let f = KC(a), p = new Map((e?.threads ?? []).map((e) => [e.name, e.episode_count])), m = new Set(e?.active_threads ?? []), h = {}, g = {};
	for (let [e, t] of Object.entries(f)) {
		let n = p.get(e) ?? 0, r = Math.max(t, n + +!!m.has(e));
		h[e] = r, g[e] = Math.max(0, r - t);
	}
	let _ = {
		liveThreads: t,
		liveFinishedToolCalls: n,
		worksets: e?.worksets?.items ?? [],
		threadEpisodes: GC(e?.thread_events ?? {}),
		dispatchCounts: h,
		cancelledNames: $C(a)
	}, v = [], y = null, b = /* @__PURE__ */ new Map();
	a.forEach((t, n) => {
		let r = c + n;
		if (t.role === "system" || t.role === "tool") return;
		if (t.role === "user") {
			y = null;
			let e = k(t.content);
			if (e) {
				v.push({
					kind: "delegated-completion",
					key: `delegated-completion-${r}`,
					completion: e,
					messageIndex: r,
					createdAt: s[n] ?? null
				});
				return;
			}
			v.push({
				kind: "user",
				key: `user-${r}`,
				text: qt(t.content),
				invokedSkills: w(t.content),
				messageIndex: r,
				createdAt: s[n] ?? null
			});
			return;
		}
		y || (y = {
			kind: "model",
			key: `model-${r}`,
			blocks: [],
			durationMs: null,
			messageIndex: r
		}, v.push(y)), y.key = `model-${r}`, y.messageIndex = r;
		let o = y.blocks;
		t.tool_calls?.length || b.set(y, (b.get(y) ?? 0) + 1);
		let f = mC(t.reasoning_text ?? "").trim();
		f && o.push({
			kind: "thoughts",
			key: `thoughts-${nw(o, "thoughts")}`,
			text: f,
			durationMs: t.duration_ms ?? null,
			streaming: !1
		});
		let p = LC(mC(t.content ?? ""));
		p && o.push({
			kind: "text",
			key: `text-${nw(o, "text")}`,
			text: p
		});
		let m = gC(a, n), h = [];
		if ((t.tool_calls ?? []).forEach((t, c) => {
			let f = t.function?.name ?? "tool", p = `${f}-${r}-${c}`;
			if (f === "thread") h.push(t);
			else if (f === "workset_define") {
				let e = HC(VC(t).id);
				o.push({
					kind: "workset",
					key: p,
					worksetId: e,
					pending: UC(t.id, e, m, s[n] ?? null, _)
				});
			} else if (!zC.has(f)) {
				let s = m.get(t.id);
				l ? o.push({
					kind: "tool-detail",
					key: `tool-${r}-${t.id}`,
					presentation: PC({
						call: t,
						events: u.get(t.id),
						hasResult: s != null,
						resultText: s?.text ?? null,
						resultHasImage: s?.hasImage ?? !1,
						active: !!e?.active_run && n > d,
						awaitingApproval: i.has(t.id),
						turnCancelled: _C(a, n, FC)
					})
				}) : o.push({
					kind: "tool",
					key: p,
					name: f,
					pending: s == null
				});
			}
		}), h.length) {
			let e = new Set(h.map(qC)), t = /* @__PURE__ */ new Set();
			for (let e of h) {
				let n = qC(e);
				if (m.has(e.id) || _.liveThreads[n]?.status === "finished") {
					t.add(n);
					continue;
				}
				let r = _.threadEpisodes[n] ?? [], i = r[r.length - 1];
				_.liveThreads[n]?.status !== "running" && i?.some((e) => e.type === "thread_finished") && t.add(n);
			}
			let n = ZC(h).map((n) => n.map((n) => {
				let i = qC(n), a = g[i] ?? 0;
				return g[i] = a + 1, ew(n, a, `${i}@${r}:${n.id}`, _, m, e, t);
			}));
			o.push({
				kind: "wave",
				key: `wave-${r}`,
				rows: n
			});
		}
	});
	let x = o.length - 1, S = !!e?.active_run && v[v.length - 1]?.kind === "model";
	for (let e = v.length - 1; e >= 0; --e) {
		let t = v[e];
		if (t.kind !== "model") continue;
		if (S) {
			S = !1;
			continue;
		}
		let n = b.get(t) ?? 0;
		n && (t.durationMs = o[x] ?? null, x -= n);
	}
	return v;
}
// src/app/features/insights/model/segments.ts
var aw = "insights-leading", ow = /* @__PURE__ */ new Set([
	"pending",
	"running",
	"awaiting-approval"
]), sw = {
	"spawn-agent": "child",
	"spawn-orchestrator": "orchestrator"
};
function cw(e, t) {
	return t && t.kind !== "model" ? t.key : e.key === "model-streaming" ? BC : aw;
}
function lw(e, t) {
	return {
		id: e,
		segments: t,
		status: IS(t.map(FS)),
		durationMs: DS(t)
	};
}
function uw(e) {
	switch (e.kind) {
		case "thoughts": return e.text.trim() ? {
			kind: "reasoning",
			key: e.key,
			text: e.text,
			durationMs: e.durationMs,
			streaming: e.streaming
		} : null;
		case "workset": return {
			kind: "workset",
			key: e.key,
			worksetId: e.worksetId,
			pending: e.pending
		};
		case "tool": return {
			kind: "tool",
			key: e.key,
			name: e.name,
			action: CS(e.name),
			presentation: null,
			pending: e.pending
		};
		case "tool-detail": return {
			kind: "tool",
			key: e.key,
			name: e.presentation.name,
			action: CS(e.presentation.name),
			presentation: e.presentation,
			pending: ow.has(e.presentation.status)
		};
		default: return null;
	}
}
function dw(e, t, n) {
	let r = n.spawnedSessionId;
	return {
		kind: "session",
		id: e,
		action: t,
		rowKey: r ? `${sw[t]}:${r}` : null,
		title: n.summary ?? ZS(t),
		status: PS(n.status),
		presentation: n
	};
}
function fw(e, t) {
	let n = [], r = [], i = () => {
		if (!r.length) return;
		let e = `${t}:${r[0].key}`, i = {
			kind: "group",
			id: e,
			group: lw(e, r)
		};
		n.push(i), r = [];
	};
	for (let a of e) {
		if (a.kind === "text" || a.kind === "wave") {
			i(), n.push({
				kind: "block",
				block: a
			});
			continue;
		}
		if (a.kind === "tool-detail") {
			let e = CS(a.presentation.name);
			if (wS(e)) {
				i(), n.push(dw(`${t}:${a.key}`, e, a.presentation));
				continue;
			}
		}
		let e = uw(a);
		e && r.push(e);
	}
	return i(), n;
}
var pw = /* @__PURE__ */ new WeakMap();
function mw(e, t) {
	let n = cw(e, t), r = pw.get(e);
	if (r?.anchor === n) return r.items;
	let i = fw(e.blocks, n);
	return pw.set(e, {
		anchor: n,
		items: i
	}), i;
}
// src/app/features/insights/model/timeline.ts
var hw = {
	all: "All actions",
	tools: "Tools & reasoning",
	threads: "Threads",
	sessions: "Sessions",
	worksets: "Worksets"
}, gw = {
	orchestrator: [
		"all",
		"tools",
		"threads",
		"worksets"
	].map((e) => ({
		value: e,
		label: hw[e]
	})),
	direct: [
		"all",
		"tools",
		"sessions"
	].map((e) => ({
		value: e,
		label: hw[e]
	}))
}, _w = {
	tools: (e) => e.kind !== "workset",
	worksets: (e) => e.kind === "workset"
};
function vw(e) {
	return e.replace(/\s+/g, " ").trim();
}
function yw(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) if (n.kind === "model") {
		for (let e of n.blocks) if (e.kind === "wave") for (let n of e.rows.flat()) t.set(n.name, (t.get(n.name) ?? 0) + 1);
	}
	return t;
}
function bw(e) {
	let t = yw(e), n = [], r = null, i = 0;
	for (let [a, o] of e.entries()) {
		if (o.kind === "user") {
			i += 1, r = {
				key: o.key,
				ordinal: i,
				promptPreview: vw(o.text),
				createdAt: o.createdAt,
				entries: []
			}, n.push(r);
			continue;
		}
		if (o.kind !== "model") continue;
		let s = e[a - 1], c = cw(o, s) === BC;
		(!r || c) && (r = {
			key: c ? BC : aw,
			ordinal: null,
			promptPreview: "",
			createdAt: null,
			entries: []
		}, n.push(r));
		for (let e of mw(o, s)) if (e.kind !== "block") r.entries.push(e);
		else if (e.block.kind === "wave") for (let n of e.block.rows.flat()) r.entries.push({
			kind: "thread",
			id: n.key,
			thread: n,
			waveKey: e.block.key,
			episodes: t.get(n.name) ?? 1
		});
	}
	return n.filter((e) => e.entries.length).reverse();
}
function xw(e, t) {
	if (e.kind === "thread") return t === "threads" ? e : null;
	if (e.kind === "session") return t === "sessions" ? e : null;
	let n = _w[t];
	if (!n) return null;
	let r = e.group.segments.filter(n);
	return r.length ? r.length === e.group.segments.length ? e : {
		kind: "group",
		id: e.id,
		group: lw(e.group.id, r)
	} : null;
}
function Sw(e, t) {
	return t === "all" ? [...e] : e.flatMap((e) => {
		let n = e.entries.flatMap((e) => xw(e, t) ?? []);
		return n.length ? [{
			...e,
			entries: n
		}] : [];
	});
}
function Cw(e) {
	return e.flatMap((e) => e.entries);
}
function ww(e, t) {
	for (let n of e) {
		let e = n.entries.find((e) => e.id === t);
		if (e) return e;
	}
	return null;
}
function Tw(e) {
	return gw[e];
}
function Ew(e, t) {
	let n = t === "orchestrator" ? "the orchestrator" : "the agent";
	switch (e) {
		case "threads": return {
			title: "No threads yet.",
			body: "They appear here as the orchestrator assigns work."
		};
		case "worksets": return {
			title: "No worksets yet.",
			body: "They appear here as the orchestrator defines them."
		};
		case "sessions": return {
			title: "No sessions yet.",
			body: `They appear here as ${n} delegates work.`
		};
		case "tools": return {
			title: "No thoughts or tools yet.",
			body: `They appear here as ${n} works.`
		};
		case "all": return {
			title: "No actions yet.",
			body: `They appear here as ${n} works.`
		};
	}
}
// src/app/features/insights/presentation/actionPresentation.ts
var Dw = {
	reasoning: H.Brain,
	thread: H.Chat,
	"define-workset": H.Checklist,
	"delete-thread": H.Trash,
	"read-file": H.ReadFile,
	"write-file": H.FileUpload,
	"edit-file": H.Edit,
	glob: H.SearchFiles,
	grep: H.SearchFile,
	"run-command": H.Terminal,
	"write-command": H.WriteCommand,
	"read-command-output": H.ScreenView,
	"web-search": H.Search,
	"web-fetch": H.Globe,
	"create-goal": H.Flag,
	"get-goal": H.Important,
	"update-goal": H.Checklist,
	"spawn-agent": H.Plane,
	"spawn-orchestrator": H.Orchestrator,
	"session-status": H.Info,
	"session-steer": H.AddChat,
	"session-read": H.Eye,
	"session-wait": H.Timelaps,
	"session-cancel": H.Close,
	other: H.Code
}, Ow = {
	grep: H.SearchPage,
	"get-goal": H.Tag,
	"session-status": H.Eye
}, kw = {
	ready: Wi.Ready,
	pending: Wi.Pending,
	running: Wi.Running,
	failed: Wi.Failed
}, Aw = {
	ready: su.Default,
	pending: su.Loading,
	running: su.Loading,
	failed: su.Error
};
function jw(e) {
	return e === null ? H.MenuHorizontal : Dw[e];
}
function Mw(e) {
	return Ow[e] ?? Dw[e];
}
function Nw(e) {
	return kw[e];
}
function Pw(e) {
	return Aw[e];
}
// src/app/services/queries/toolCalls.ts
var Fw = 2e3;
function Iw(e, t, n = !0) {
	let { api: r } = V(), i = xi({
		queryKey: on.toolCallContent(e, t?.id ?? "", t?.blockKey ?? ""),
		queryFn: ({ signal: n }) => r.getToolCallContent(e, t.id, n),
		enabled: n && t != null,
		staleTime: (e) => e.state.data?.output === null ? 0 : Infinity,
		refetchInterval: (e) => e.state.status !== "error" && e.state.data?.output === null && Fw,
		retryOnMount: !1,
		refetchOnMount: (e) => e.state.status !== "error",
		refetchOnReconnect: (e) => e.state.status !== "error",
		refetchOnWindowFocus: !1,
		retry: !1
	});
	return {
		...i,
		data: i.isError ? void 0 : i.data
	};
}
// src/app/features/insights/presentation/items/useFullContent.ts
function Lw(e, t, n) {
	let [r, i] = J(!1), a = Iw(e, t, r), o = r && a.isError && !a.isFetching, s = r ? a.data : void 0, c = s && (!n || s.output !== null) ? s : void 0, l = ru.Default;
	return c ? l = ru.Expanded : r && !o && (l = ru.Loading), {
		state: l,
		content: c,
		failed: o,
		showFull: () => {
			o && a.refetch(), i(!0);
		},
		hide: () => i(!1)
	};
}
// src/app/features/insights/presentation/items/ItemCodeField.tsx
var Rw = {
	arguments: "input",
	output: "output"
}, zw = "256 KiB", Bw = " 	\n\r";
function Vw(e) {
	try {
		JSON.parse(e);
	} catch {
		return e;
	}
	let t = "", n = 0, r = () => `\n${"  ".repeat(n)}`;
	for (let i = 0; i < e.length; i += 1) {
		let a = e[i];
		if (a === "\"") {
			let n = i + 1;
			for (; e[n] !== "\"";) n += e[n] === "\\" ? 2 : 1;
			t += e.slice(i, n + 1), i = n;
		} else if (a === "{" || a === "[") {
			let o = i + 1;
			for (; Bw.includes(e[o]);) o += 1;
			e[o] === "}" || e[o] === "]" ? (t += a + e[o], i = o) : (n += 1, t += a + r());
		} else a === "}" || a === "]" ? (--n, t += r() + a) : a === "," ? t += `,${r()}` : a === ":" ? t += ": " : Bw.includes(a) || (t += a);
	}
	return t;
}
function Hw({ title: e, showHeading: t, shortContent: n, source: r, sessionId: i, call: a }) {
	let o = Lw(i, a, r === "output"), { content: s } = o, c = K(() => s ? r === "arguments" ? Vw(s.arguments) : s.output : null, [s, r]), l = r === "arguments" ? s?.arguments_truncated : s?.output_truncated, u = Rw[r];
	return /* @__PURE__ */ X(au, {
		title: e,
		showHeading: t,
		state: o.state,
		shortContent: n,
		fullContent: c,
		onShowFull: a ? o.showFull : void 0,
		onHide: o.hide,
		error: o.failed ? `Could not load the full ${u}.` : null,
		note: l ? `The server cut this ${u} at ${zw}.` : null
	});
}
// src/app/features/insights/presentation/items/itemContent.ts
var Uw = (e) => e === su.Default;
function Ww(e) {
	let t = e.presentation?.callId;
	return t ? {
		id: t,
		blockKey: e.key
	} : null;
}
var Gw = (e) => e !== su.Loading;
function Kw(e, t) {
	return t == null ? e : `${e}, ${m(t)}`;
}
// src/app/features/insights/presentation/items/CommandItems.tsx
function qw(e, t) {
	let n = e.presentation?.summary || null, r = e.presentation?.resultPreview || null, i = Ww(e);
	return {
		title: tC(e),
		copyText: n,
		body: (e) => /* @__PURE__ */ Z(Y, { children: [n && Gw(e) ? /* @__PURE__ */ X(Hw, {
			title: "Input",
			shortContent: n,
			source: "arguments",
			sessionId: t.sessionId,
			call: i
		}) : null, r && Uw(e) ? /* @__PURE__ */ X(Hw, {
			title: "Output",
			shortContent: r,
			source: "output",
			sessionId: t.sessionId,
			call: i
		}) : null] })
	};
}
function Jw(e, t) {
	let n = e.presentation?.summary || null, r = Ww(e);
	return {
		title: tC(e),
		copyText: n,
		body: (e) => n && Gw(e) ? /* @__PURE__ */ X(Hw, {
			title: "Input",
			showHeading: !1,
			shortContent: n,
			source: "arguments",
			sessionId: t.sessionId,
			call: r
		}) : null
	};
}
function Yw(e, t) {
	let n = e.presentation?.resultPreview || null, r = Ww(e);
	return {
		title: "Read output",
		copyText: n,
		body: (e) => n && Uw(e) ? /* @__PURE__ */ X(Hw, {
			title: "Output",
			shortContent: n,
			source: "output",
			sessionId: t.sessionId,
			call: r
		}) : null
	};
}
// src/app/features/insights/presentation/items/ItemFileButton.tsx
var Xw = "…";
function Zw(e) {
	if (e === "") return "";
	if (e.startsWith("/") || e.includes("\\") || /[\p{Cc}]/u.test(e) || /^[a-z][a-z0-9+.-]*:/iu.test(e)) return null;
	let t = e.split("/");
	return t.at(-1) === "" && t.pop(), t.some((e) => e === "" || e === "." || e === "..") ? null : e.endsWith("/") ? e : `${e}/`;
}
function Qw(e, t) {
	if (e.startsWith(Xw)) return {
		kind: "unmapped",
		reason: "Only the end of this path is known, so Files cannot open it."
	};
	if (e !== e.trim()) return {
		kind: "unmapped",
		reason: "This path cannot be mapped exactly, so Files cannot open it."
	};
	let n = t.filePathPrefix;
	if (n == null) return {
		kind: "unmapped",
		reason: "The file's repository location is unknown, so Files cannot open it."
	};
	let r = Zw(n), i = Qn(e, t.workspaceRoots);
	return r != null && i.kind === "workspace" ? {
		kind: "workspace",
		path: `${r}${i.path}`
	} : {
		kind: "unmapped",
		reason: "This file is outside the workspace, so Files cannot open it."
	};
}
var $w = (e) => e.split(/[\\/]/u).filter(Boolean).pop() ?? e;
function eT({ path: e, context: t, additions: n, deletions: r }) {
	let i = Qw(e, t), a = $w(e);
	return /* @__PURE__ */ X("div", {
		className: "flex w-full flex-col items-start border-l-2 border-muted py-1 pl-4",
		children: i.kind === "workspace" ? /* @__PURE__ */ X(bl, {
			path: i.path,
			label: a,
			size: hl.Small,
			additions: n,
			deletions: r,
			onClick: () => t.openFile(i.path)
		}) : /* @__PURE__ */ Z("span", {
			title: i.reason,
			className: "flex max-w-full cursor-not-allowed",
			children: [/* @__PURE__ */ X(bl, {
				path: e,
				label: a,
				size: hl.Small,
				disabled: !0,
				additions: n,
				deletions: r,
				className: "pointer-events-none"
			}), /* @__PURE__ */ X("span", {
				className: "sr-only",
				children: i.reason
			})]
		})
	});
}
// src/app/lib/unifiedDiff.ts
var tT = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u, nT = (e, t, n, r) => ({
	kind: e,
	content: t,
	old_lineno: n,
	new_lineno: r,
	has_trailing_newline: !0
});
function rT(e) {
	let t = {
		hunks: [],
		additions: 0,
		deletions: 0
	}, n = e.split("\n");
	n.at(-1) === "" && n.pop();
	let r = null, i = 0, a = 0, o = 0, s = 0;
	for (let e of n) {
		let n = tT.exec(e);
		if (n) {
			[i, o, a, s] = [
				n[1],
				n[2],
				n[3],
				n[4]
			].map((e) => Number(e ?? 1)), r = { lines: [] }, t.hunks.push(r);
			continue;
		}
		if (!r) continue;
		if (e.startsWith("\\")) {
			let e = r.lines.at(-1);
			e && (e.has_trailing_newline = !1);
			continue;
		}
		if (o <= 0 && s <= 0) continue;
		let c = e.slice(1).replace(/\r$/u, "");
		e.startsWith("+") ? (r.lines.push(nT("insert", c, null, a)), a += 1, --s, t.additions += 1) : e.startsWith("-") ? (r.lines.push(nT("delete", c, i, null)), i += 1, --o, t.deletions += 1) : (e === "" || e.startsWith(" ")) && (r.lines.push(nT("context", c, i, a)), i += 1, a += 1, --o, --s);
	}
	return t.hunks = t.hunks.filter((e) => e.lines.length > 0), t;
}
// src/app/features/insights/presentation/items/FileChange.tsx
var iT = 40, aT = /^\s*\{\s*"path"\s*:\s*("(?:[^"\\]|\\.)*")/u;
function oT(e) {
	let t = aT.exec(e);
	if (!t) return null;
	try {
		let e = JSON.parse(t[1]);
		return typeof e == "string" && e ? e : null;
	} catch {
		return null;
	}
}
function sT(e, t) {
	let n = e ?? "";
	if (!t) try {
		let e = JSON.parse(n);
		if (typeof e == "object" && e && "diff" in e) {
			let { diff: t } = e, n = "path" in e && typeof e.path == "string" ? e.path : "";
			if (typeof t == "string") return {
				path: n || null,
				diff: rT(t)
			};
		}
	} catch {}
	return {
		path: oT(n),
		diff: null
	};
}
var cT = (e, t) => ({
	kind: e.kind,
	number: e.kind === "delete" ? e.old_lineno : e.new_lineno,
	content: e.content,
	tokens: t,
	trailing: e.has_trailing_newline ? null : /* @__PURE__ */ X("span", {
		className: "italic text-basic-muted",
		children: " No newline at end of file"
	})
});
function lT({ path: e, diff: t }) {
	let n = fi(), [r, i] = J(!1), [a, o] = J(null);
	G(() => {
		if (!e) return;
		let n = !0;
		return zt(e, [t]).then((e) => {
			n && o(e);
		}), () => {
			n = !1;
		};
	}, [e, t]);
	let s = t.hunks.reduce((e, t) => e + t.lines.length, 0), c = K(() => {
		let e = r ? s : iT, n = [];
		for (let r of t.hunks) {
			if (e <= 0) break;
			let t = r.lines.slice(0, e);
			e -= t.length, n.push(t.map((e) => cT(e, a?.get(e))));
		}
		return n;
	}, [
		t,
		r,
		s,
		a
	]), l = e?.split(/[\\/]/u).pop() || e;
	return /* @__PURE__ */ Z("div", {
		className: "flex w-full min-w-0 flex-col items-start gap-2",
		children: [/* @__PURE__ */ X("div", {
			id: n,
			className: "w-full min-w-0",
			children: /* @__PURE__ */ X(oo, {
				"aria-label": l ? `Changes to ${l}` : "Changes",
				hunks: c
			})
		}), s > iT ? /* @__PURE__ */ X(nu, {
			expanded: r,
			controls: n,
			onClick: () => i((e) => !e)
		}) : null]
	});
}
function uT({ retrying: e, onRetry: t }) {
	return /* @__PURE__ */ Z("div", {
		className: "flex w-full flex-wrap items-center gap-x-2 gap-y-1",
		children: [e ? null : /* @__PURE__ */ X("p", {
			role: "alert",
			className: "break-words text-micro text-error-primary",
			children: "Could not load this change."
		}), /* @__PURE__ */ Z(z, {
			size: U.Small,
			variant: B.Tertiary,
			content: g.IconRight,
			"aria-disabled": e || void 0,
			className: I(e && "btn-disabled"),
			onClick: e ? void 0 : t,
			children: [/* @__PURE__ */ X("span", {
				className: "underline",
				children: "Retry"
			}), e ? /* @__PURE__ */ X(ut, {
				size: bt.XSmall,
				"aria-hidden": !0
			}) : /* @__PURE__ */ X(R, {
				iconName: H.Retry,
				size: 16,
				"aria-hidden": !0
			})]
		})]
	});
}
function dT(e) {
	let [t, n] = J(() => typeof IntersectionObserver > "u");
	return G(() => {
		let r = e?.parentElement;
		if (t || !r) return;
		let i = new IntersectionObserver((e) => {
			e.some((e) => e.isIntersecting) && n(!0);
		});
		return i.observe(r), () => i.disconnect();
	}, [e, t]), t;
}
function fT({ path: e, call: t, context: n }) {
	let [r, i] = J(null), a = dT(r), o = Iw(n.sessionId, t, a), { data: s } = o, c = K(() => s ? sT(s.output, s.output_truncated) : null, [s]), l = c?.diff?.hunks.length ? c.diff : null, u = c?.path ?? e, d = s?.output === null, f = o.isError ? !s || d : !s && o.errorUpdateCount > 0 && o.isFetching;
	return /* @__PURE__ */ Z(Y, { children: [
		/* @__PURE__ */ X("span", {
			ref: i,
			hidden: !0
		}),
		u ? /* @__PURE__ */ X(eT, {
			path: u,
			context: n,
			additions: l?.additions,
			deletions: l?.deletions
		}) : null,
		(o.isPending || d) && !f ? /* @__PURE__ */ Z("div", {
			role: "status",
			className: "flex items-center gap-2 text-micro text-basic-muted",
			children: [/* @__PURE__ */ X(ut, {
				size: bt.XSmall,
				"aria-hidden": !0
			}), "Loading the change…"]
		}) : null,
		f ? /* @__PURE__ */ X(uT, {
			retrying: o.isFetching,
			onRetry: () => void o.refetch()
		}) : null,
		c && !c.diff && !d ? /* @__PURE__ */ X("p", {
			className: "break-words text-micro text-basic-muted",
			children: "This change is too large to show here."
		}) : null,
		l ? /* @__PURE__ */ X(lT, {
			path: u,
			diff: l
		}) : null
	] });
}
// src/app/features/insights/presentation/items/FileItems.tsx
var pT = {
	"write-file": (e, t) => `${t ? "Created" : "Create"} ${e}`,
	"edit-file": (e) => `Edit ${e}`
};
function mT(e, t) {
	let n = e.presentation?.summary || null, r = n ? tC(e) : null, i = FS(e) === "ready", a = r ? pT[e.action]?.(r, i) : void 0, o = e.action === "read-file" ? null : Ww(e);
	return {
		title: e.action === "read-file" ? "File Read" : a ?? eC(e),
		body: (e) => Uw(e) ? o ? /* @__PURE__ */ X(fT, {
			path: n,
			call: o,
			context: t
		}) : n ? /* @__PURE__ */ X(eT, {
			path: n,
			context: t
		}) : null : null
	};
}
// src/app/features/insights/presentation/items/ItemParts.tsx
var hT = 200;
function gT({ children: e }) {
	return /* @__PURE__ */ X("p", {
		className: "whitespace-pre-wrap break-words",
		children: e
	});
}
function _T({ children: e }) {
	return /* @__PURE__ */ X("p", {
		className: "text-small text-success-primary",
		children: e
	});
}
function vT({ link: e, context: t }) {
	return e ? /* @__PURE__ */ X(ou, {
		label: e.title || "Open session",
		onClick: () => t.openSubagent(e.rowKey)
	}) : null;
}
function yT({ text: e, streaming: t }) {
	let [n, r] = J(!1), i = e.split("\n"), a = !n && i.length > hT;
	return /* @__PURE__ */ Z(Y, { children: [a ? /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-2 label-micro text-basic-muted",
		children: [/* @__PURE__ */ Z("span", { children: [
			"Last ",
			hT,
			" of ",
			i.length,
			" lines"
		] }), /* @__PURE__ */ X("button", {
			type: "button",
			className: "text-basic-primary hover:underline",
			onClick: () => r(!0),
			children: "Show all"
		})]
	}) : null, /* @__PURE__ */ X("div", {
		className: "chat-response",
		children: /* @__PURE__ */ X("div", {
			className: "thinking-content",
			children: /* @__PURE__ */ X(qx, {
				className: "text-basic-tertiary",
				streaming: t,
				children: a ? i.slice(-200).join("\n") : e
			})
		})
	})] });
}
// src/app/features/insights/presentation/items/GoalItems.tsx
function bT(e) {
	let t = e.presentation?.summary || null;
	return {
		title: ZS(e.action),
		copyText: t,
		body: (e) => t && Gw(e) ? /* @__PURE__ */ X(gT, { children: t }) : null
	};
}
function xT(e, t) {
	let n = e.presentation?.resultPreview || null, r = Ww(e);
	return {
		title: ZS("get-goal"),
		copyText: n,
		body: (e) => n && Uw(e) ? /* @__PURE__ */ X(Hw, {
			title: "Results",
			shortContent: n,
			source: "output",
			sessionId: t.sessionId,
			call: r
		}) : null
	};
}
// src/app/features/insights/presentation/items/OtherItem.tsx
function ST(e, t) {
	let n = e.presentation?.summary || null, r = e.presentation?.resultPreview || null, i = Ww(e);
	return {
		title: tC(e),
		copyText: n ?? r,
		body: (e) => /* @__PURE__ */ Z(Y, { children: [(n || i) && Gw(e) ? /* @__PURE__ */ X(Hw, {
			title: "Input",
			shortContent: n ?? "",
			source: "arguments",
			sessionId: t.sessionId,
			call: i
		}) : null, r && Uw(e) ? /* @__PURE__ */ X(Hw, {
			title: "Output",
			shortContent: r,
			source: "output",
			sessionId: t.sessionId,
			call: i
		}) : null] })
	};
}
// src/app/features/insights/presentation/items/ReasoningItem.tsx
function CT(e) {
	return {
		title: Kw(ZS("reasoning"), e.durationMs),
		copyText: e.text,
		body: () => e.text ? /* @__PURE__ */ X(yT, {
			text: e.text,
			streaming: e.streaming
		}) : null
	};
}
// src/app/features/insights/presentation/items/SearchItems.tsx
function wT(e, t) {
	let n = e.presentation?.summary || null, r = e.presentation?.resultPreview || null, i = Ww(e), a = e.action === "web-search";
	return {
		title: Kw(ZS(e.action), e.presentation?.durationMs),
		copyText: n,
		body: (e) => /* @__PURE__ */ Z(Y, { children: [n && Gw(e) ? /* @__PURE__ */ X(Hw, {
			title: a ? "Search Input" : "Input",
			showHeading: a,
			shortContent: n,
			source: "arguments",
			sessionId: t.sessionId,
			call: i
		}) : null, r && Uw(e) ? /* @__PURE__ */ X(gT, { children: r }) : null] })
	};
}
function TT(e, t) {
	let n = e.presentation?.summary || null, r = e.presentation?.resultPreview || null, i = Ww(e);
	return {
		title: ZS(e.action),
		copyText: n,
		body: (e) => /* @__PURE__ */ Z(Y, { children: [n && Gw(e) ? /* @__PURE__ */ X(Hw, {
			title: "Input",
			shortContent: n,
			source: "arguments",
			sessionId: t.sessionId,
			call: i
		}) : null, r && Uw(e) ? /* @__PURE__ */ X(Hw, {
			title: "Output",
			shortContent: r,
			source: "output",
			sessionId: t.sessionId,
			call: i
		}) : null] })
	};
}
// src/app/features/insights/presentation/useDelegatedSessions.ts
var ET = {
	subagent_status: "child",
	subagent_cancel: "child",
	orchestrator_status: "orchestrator",
	orchestrator_steer: "orchestrator",
	orchestrator_read: "orchestrator",
	orchestrator_wait: "orchestrator",
	orchestrator_cancel: "orchestrator"
};
function DT(e) {
	if (e.kind !== "tool") return null;
	let t = ET[e.name], n = e.presentation?.summary?.trim();
	return t && n ? `${t}:${n}` : null;
}
function OT(e) {
	let t = /* @__PURE__ */ new Set();
	for (let n of e) for (let e of n.entries) if (e.kind === "session" && e.rowKey && t.add(e.rowKey), e.kind === "group") for (let n of e.group.segments) {
		let e = DT(n);
		e && t.add(e);
	}
	return [...t];
}
function kT(e, t, n) {
	let r = e.filter((e) => e.startsWith(`${t}:`));
	if (!r.length) return !1;
	if (!n) return !0;
	let i = new Set(n.map((e) => `${t}:${e}`));
	return r.some((e) => !i.has(e));
}
function AT(e, t, n) {
	let { panels: r } = di(ry), i = Tt(), a = Si(), o = K(() => OT(n), [n]), s = r.includes("delegated"), c = a.getQueryData(on.traditionalChildren(e)), l = a.getQueryData(on.managedOrchestrators(e)), u = qe(e, s && kT(o, "child", c?.map((e) => e.child_session_id))), d = xt(e, s && t?.metadata.behavior === "direct-with-orchestrator" && kT(o, "orchestrator", l?.map((e) => e.orchestrator_session_id))), f = u.data, p = i.orchestrationEnabled ? d.data : void 0, m = K(() => {
		let e = /* @__PURE__ */ new Map();
		for (let t of f ?? []) e.set(`child:${t.child_session_id}`, t.description.trim());
		for (let t of p ?? []) e.set(`orchestrator:${t.orchestrator_session_id}`, t.description.trim());
		return e;
	}, [f, p]);
	return W((e) => {
		if (!e) return null;
		let t = m.get(e);
		return t === void 0 ? null : {
			rowKey: e,
			title: t
		};
	}, [m]);
}
// src/app/features/insights/presentation/items/SessionItems.tsx
function jT(e, t) {
	let n = t.resolveSession(DT(e)), r = e.presentation?.resultPreview || null, i = Ww(e), a = /* @__PURE__ */ X(vT, {
		link: n,
		context: t
	});
	switch (e.action) {
		case "session-status":
		case "session-read": return {
			title: e.action === "session-status" ? "Session status" : "Read session",
			copyText: r,
			body: (e) => /* @__PURE__ */ Z(Y, { children: [r && Uw(e) ? /* @__PURE__ */ X(Hw, {
				title: "Results",
				shortContent: r,
				source: "output",
				sessionId: t.sessionId,
				call: i
			}) : null, a] })
		};
		case "session-wait": {
			let t = e.presentation?.durationMs;
			return {
				title: Kw(ZS("session-wait"), t),
				copyText: r,
				body: (e) => /* @__PURE__ */ Z(Y, { children: [
					t != null && e !== su.Loading ? /* @__PURE__ */ Z("p", {
						className: "label-micro text-btn-secondary",
						children: ["Slept ", m(t)]
					}) : null,
					r && Uw(e) ? /* @__PURE__ */ X(gT, { children: r }) : null,
					a
				] })
			};
		}
		case "session-cancel": return {
			title: n?.title ? `${ZS("session-cancel")}: ${n.title}` : ZS("session-cancel"),
			body: (e) => /* @__PURE__ */ Z(Y, { children: [Uw(e) ? /* @__PURE__ */ X(_T, { children: "The session has been cancelled." }) : null, a] })
		};
		default: return {
			title: ZS("session-steer"),
			copyText: r,
			body: (e) => /* @__PURE__ */ Z(Y, { children: [r && Uw(e) ? /* @__PURE__ */ X(gT, { children: r }) : null, a] })
		};
	}
}
// src/app/features/insights/presentation/items/useErrorLine.tsx
var MT = "...";
function NT({ status: e, statusLabel: t }, n) {
	return e === "error" ? n || t : n ? `${t}: ${n}` : t;
}
function PT(e) {
	let t = e.trim();
	try {
		let e = JSON.parse(t);
		if (typeof e == "object" && e && "message" in e) {
			let { message: t } = e;
			if (typeof t == "string" && t) return t;
		}
	} catch {}
	return t;
}
function FT(e, t, n) {
	let r = n && e.kind === "tool" ? e : null, i = r?.presentation ?? null, a = i?.resultPreview ?? null, o = r && a?.endsWith(MT) ? Ww(r) : null, s = Lw(t, o, !0);
	if (!i) return {
		message: null,
		action: null
	};
	let c = s.content?.output, l = NT(i, c == null ? a : PT(c));
	if (!o) return {
		message: l,
		action: null
	};
	let u = s.state === ru.Expanded;
	return {
		message: l,
		action: /* @__PURE__ */ Z(Y, { children: [s.failed ? /* @__PURE__ */ X("p", {
			role: "alert",
			className: "break-words text-micro text-error-primary",
			children: "Could not load the full error."
		}) : null, /* @__PURE__ */ X(nu, {
			expanded: u,
			loading: s.state === ru.Loading,
			onClick: u ? s.hide : s.showFull
		})] })
	};
}
// src/app/features/insights/presentation/items/WorksetItems.tsx
function IT(e, t) {
	let { worksetId: n } = e;
	return {
		title: ZS("define-workset"),
		body: (r) => n && Uw(r) ? /* @__PURE__ */ X(ou, {
			label: tC(e),
			onClick: () => t.openWorkset(n)
		}) : null
	};
}
function LT(e) {
	return {
		title: tC(e),
		body: (e) => Uw(e) ? /* @__PURE__ */ X(_T, { children: "The thread has been deleted." }) : null
	};
}
// src/app/features/insights/presentation/items/InsightSegmentItem.tsx
var RT = /…$/u;
function zT(e, t) {
	switch (e.action) {
		case "read-file":
		case "write-file":
		case "edit-file": return mT(e, t);
		case "web-search":
		case "web-fetch": return wT(e, t);
		case "glob":
		case "grep": return TT(e, t);
		case "run-command": return qw(e, t);
		case "write-command": return Jw(e, t);
		case "read-command-output": return Yw(e, t);
		case "create-goal":
		case "update-goal": return bT(e);
		case "get-goal": return xT(e, t);
		case "session-status":
		case "session-steer":
		case "session-read":
		case "session-wait":
		case "session-cancel": return jT(e, t);
		case "delete-thread": return LT(e);
		default: return ST(e, t);
	}
}
function BT(e, t) {
	return e.kind === "reasoning" ? CT(e) : e.kind === "workset" ? IT(e, t) : zT(e, t);
}
function VT(e, t) {
	return t === "pending" ? "Awaiting approval" : rC(e).replace(RT, "");
}
var HT = li(function({ segment: e, active: t, context: n }) {
	let r = FS(e), i = Pw(r), a = BT(e, n), o = FT(e, n.sessionId, i === su.Error);
	return /* @__PURE__ */ X(cu, {
		icon: Mw(TS(e)),
		title: i === su.Loading ? VT(e, r) : a.title,
		state: i,
		active: t,
		copyText: a.copyText,
		errorMessage: o.message,
		errorAction: o.action,
		children: a.body?.(i)
	});
});
// src/app/features/insights/presentation/InsightsDetail.tsx
function UT(e) {
	if (!e) return "";
	if (e.kind === "reasoning") return `${e.key}:${e.text.length}`;
	if (e.kind === "workset") return `${e.key}:${e.pending}`;
	let { presentation: t } = e;
	return `${e.key}:${t?.status ?? e.pending}:${t?.resultPreview?.length ?? 0}`;
}
function WT(e, t) {
	return Array.from(e.querySelectorAll("[data-segment-key]")).find((e) => e.dataset.segmentKey === t) ?? null;
}
function GT(e, t) {
	let n = parseFloat(getComputedStyle(e).scrollPaddingTop) || 0;
	return e.scrollTop + t.getBoundingClientRect().top - e.getBoundingClientRect().top - n;
}
var KT = li(function({ group: e, segmentKey: t, focusNonce: n, context: r }) {
	let i = q(null), a = q(null), o = q(!0), s = q(null), c = q(null), l = q(null), u = e.status === "running", d = `${e.segments.length}:${UT(e.segments.at(-1))}`;
	G(() => () => l.current?.abort(), []), pi(() => {
		let e = i.current;
		e && u && o.current && aS(e);
	}, [d, u]), G(() => {
		let e = i.current, t = a.current;
		if (!e || !t) return;
		let n = new ResizeObserver(() => {
			let t = s.current, n = t ? WT(e, t.key) : null;
			if (!t || !n) return;
			let r = GT(e, n);
			Math.abs(r - t.top) < 1 || (t.top = r, l.current?.abort(), e.scrollTop = r);
		});
		return n.observe(t), () => n.disconnect();
	}, []), pi(() => {
		let e = i.current;
		if (!e || c.current === n) return;
		let r = c.current === null;
		c.current = n;
		let a = t ? WT(e, t) : null;
		if (r && !a) {
			o.current = u || iS(e) <= 60;
			return;
		}
		o.current = !a && u;
		let d = a ? GT(e, a) : u ? e.scrollHeight : 0;
		if (s.current = a && t ? {
			key: t,
			top: d
		} : null, l.current?.abort(), r) {
			e.scrollTop = d;
			return;
		}
		let f = new AbortController();
		l.current = f, oS(e, d, void 0, f.signal);
	}, [
		n,
		t,
		u
	]);
	let f = () => {
		s.current = null;
	};
	return /* @__PURE__ */ X("div", {
		ref: i,
		className: "flex min-h-0 flex-1 flex-col overflow-auto max-md:scroll-pt-14 [&>*]:shrink-0",
		onScroll: () => {
			let e = i.current;
			e && (o.current = iS(e) <= 60);
		},
		onWheel: f,
		onPointerDown: f,
		onKeyDown: f,
		children: /* @__PURE__ */ X("div", {
			ref: a,
			className: "flex flex-col max-md:py-14",
			children: e.segments.map((e) => /* @__PURE__ */ X("div", {
				"data-segment-key": e.key,
				children: /* @__PURE__ */ X(HT, {
					segment: e,
					active: e.key === t,
					context: r
				})
			}, e.key))
		})
	});
});
// src/app/features/insights/presentation/InsightsFilter.tsx
function qT(e, t) {
	let n = e.find((e) => e.value === t);
	return `Show ${!n || n.value === "all" ? "All" : n.label}`;
}
var JT = li(function({ options: e, value: t, onChange: n }) {
	let r = N(), i = Se(), a = fi(), o = e.map((e) => ({
		id: e.value,
		label: e.label
	})), s = (t) => {
		let r = e.find((e) => e.value === t);
		r && n(r.value);
	};
	return r ? /* @__PURE__ */ X(Xu, {
		items: o,
		value: t,
		onValueChange: s,
		size: U.Large,
		variant: B.Ghost,
		floating: !0,
		triggerLabel: qT(e, t)
	}) : /* @__PURE__ */ Z("div", {
		role: "group",
		"aria-labelledby": a,
		className: I("flex min-w-0 items-center gap-3", i ? "flex-1" : "h-14 shrink-0 border-b border-muted pl-3 pr-2"),
		children: [/* @__PURE__ */ X("span", {
			id: a,
			className: "flex-1 label-micro text-basic-tertiary",
			children: "Show:"
		}), /* @__PURE__ */ X(Xu, {
			items: o,
			value: t,
			onValueChange: s,
			size: U.Small,
			variant: B.Ghost,
			placement: M.BottomLeft
		})]
	});
});
new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit"
});
var YT = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "numeric",
	minute: "2-digit"
});
function XT(e) {
	let t = Rn(e);
	if (Number.isNaN(t)) return null;
	let n = Object.fromEntries(YT.formatToParts(t).map(({ type: e, value: t }) => [e, t]));
	return `${n.day} ${n.month} ${n.year} ${n.hour}:${n.minute} ${n.dayPeriod}`;
}
// src/app/features/insights/presentation/InsightsTurnSection.tsx
function ZT(e) {
	let t = [];
	for (let n of e) {
		let e = t.at(-1);
		n.kind === "thread" ? e?.kind === "wave" && e.entries[0].waveKey === n.waveKey ? e.entries.push(n) : t.push({
			kind: "wave",
			entries: [n]
		}) : t.push({
			kind: "entry",
			entry: n
		});
	}
	return t;
}
function QT({ entry: e, controller: t, size: n }) {
	let r = t.entryView(e), i = e.kind === "group" && e.group.segments.length > 1, a = i && t.expanded.has(e.id);
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(Zi, {
		...r,
		size: n,
		selected: t.entrySelected(e),
		expanded: i ? a : void 0,
		onClick: t.entryAction(e)
	}), a && e.kind === "group" ? /* @__PURE__ */ X(Qi, { children: e.group.segments.map((r) => /* @__PURE__ */ X(Zi, {
		...t.segmentView(r),
		size: n,
		selected: t.segmentSelected(e, r),
		onClick: t.segmentAction(e, r)
	}, r.key)) }) : null] });
}
var $T = li(function({ section: e, fallbackPrompt: t, controller: n, size: r }) {
	let i = XT(e.createdAt) ?? (e.promptPreview || t), a = r === Gi.Large;
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col [&>*]:shrink-0",
		children: [/* @__PURE__ */ X("h3", {
			className: I("truncate text-basic-muted", a ? "px-2 pt-6 pb-2 text-micro" : "px-1 pt-4 pb-1 text-[11px] leading-[14px]"),
			children: i
		}), /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-1 py-2 [&>*]:shrink-0",
			children: ZT(e.entries).map((e) => e.kind === "wave" ? /* @__PURE__ */ X(Qi, {
				className: I(a && "py-2"),
				children: e.entries.map((e) => /* @__PURE__ */ X(QT, {
					entry: e,
					controller: n,
					size: r
				}, e.id))
			}, `wave:${e.entries[0].id}`) : /* @__PURE__ */ X(QT, {
				entry: e.entry,
				controller: n,
				size: r
			}, e.entry.id))
		})]
	});
}), eE = "Earlier messages", tE = "New prompt";
function nE(e) {
	for (let t = e.parentElement; t; t = t.parentElement) {
		let { overflowY: e } = getComputedStyle(t);
		if (e === "auto" || e === "scroll") return t;
	}
	return null;
}
function rE(e) {
	let t = nE(e);
	if (!t) return;
	let n = getComputedStyle(t), r = parseFloat(n.paddingTop) || 0, i = parseFloat(n.paddingBottom) || 0, a = t.getBoundingClientRect().top + t.clientTop + r, o = a + t.clientHeight - r - i, { top: s, bottom: c } = e.getBoundingClientRect();
	s < a ? t.scrollTop += s - a : c > o && (t.scrollTop += Math.min(c - o, s - a));
}
var iE = li(function({ sections: e, pendingPrompt: t, emptyCopy: n, focusNonce: r, controller: i, footer: a }) {
	let o = q(null), s = N() ? Gi.Large : Gi.Small;
	if (G(() => {
		let e = o.current?.querySelectorAll("[aria-pressed=\"true\"]"), t = e?.[e.length - 1];
		t && rE(t);
	}, [r]), !e.length) return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("p", {
		className: "p-1 label-micro text-basic-muted",
		children: n.title
	}), a] });
	let c = t.replace(/\s+/g, " ").trim();
	return /* @__PURE__ */ Z("div", {
		ref: o,
		className: "flex flex-col [&>*]:shrink-0",
		children: [e.map((e) => /* @__PURE__ */ X($T, {
			section: e,
			fallbackPrompt: e.key === "model-streaming" ? c || tE : eE,
			controller: i,
			size: s
		}, e.key)), a]
	});
});
// src/app/features/insights/presentation/InsightsLoadOlder.tsx
function aE({ sessionId: e }) {
	let t = Cr(e), n = () => t.mutate();
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col items-start gap-2 p-1",
		children: [/* @__PURE__ */ X(z, {
			variant: B.Ghost,
			size: U.Small,
			content: g.Text,
			disabled: t.isPending,
			onClick: n,
			children: t.isPending ? "Loading…" : "Load older actions"
		}), t.isError ? /* @__PURE__ */ Z("div", {
			role: "alert",
			className: "flex items-center gap-2 text-basic-muted label-small",
			children: [/* @__PURE__ */ X("span", { children: "Couldn’t load older actions." }), /* @__PURE__ */ X(z, {
				variant: B.Ghost,
				size: U.Small,
				content: g.Text,
				onClick: n,
				children: "Try again"
			})]
		}) : null]
	});
}
// src/app/features/insights/presentation/rows.ts
function oE(e) {
	return {
		icon: jw(e.action),
		label: e.label,
		meta: e.meta ?? void 0,
		status: Nw(e.status)
	};
}
function sE(e, t) {
	return e.status === "ready" && t ? {
		...e,
		label: t
	} : e;
}
function cE(e, t) {
	let n = t.resolveSession(DT(e));
	return oE(sE(lC(e), n?.title));
}
function lE(e, t) {
	let n = uC(e);
	if (e.kind === "thread") {
		let r = t.episodeCounts.get(e.thread.name);
		return oE({
			...n,
			meta: r === void 0 ? $S("thread") : `Thread, ${r}`
		});
	}
	return e.kind === "session" ? oE(sE(n, t.resolveSession(e.rowKey)?.title)) : oE(n);
}
// src/app/features/insights/presentation/selection.ts
function uE(e) {
	return e.kind === "thread" || e.kind !== "session" && e.group.segments.some((e) => e.kind !== "workset");
}
function dE(e, t, n, r) {
	if (e?.kind === "group") {
		let t = ww(n, e.groupId);
		return t?.kind === "group" ? {
			kind: "group",
			entry: t,
			segmentKey: t.group.segments.some((t) => t.key === e.segmentKey) ? e.segmentKey : null
		} : null;
	}
	return e?.kind === "thread" && t.name && r(t.name) ? {
		kind: "thread",
		name: t.name,
		episode: t.episode
	} : null;
}
function fE(e, t) {
	for (let n of e) for (let e = n.entries.length - 1; e >= 0; --e) {
		let r = n.entries[e];
		if (!uE(r)) continue;
		if (r.kind === "thread") return {
			kind: "thread",
			name: r.thread.name,
			episode: r.id
		};
		let i = ww(t, r.id);
		return i?.kind === "group" ? {
			kind: "group",
			entry: i,
			segmentKey: null
		} : null;
	}
	return null;
}
function pE(e, t) {
	return e.kind !== "thread" || t.kind !== "thread" ? !1 : t.episode ? e.id === t.episode : e.thread.name === t.name;
}
function mE(e, t) {
	if (e.kind === "thread") return !t.some((t) => t.entries.some((t) => pE(t, e)));
	let n = ww(t, e.entry.id);
	return n?.kind !== "group" || e.segmentKey !== null && !n.group.segments.some((t) => t.key === e.segmentKey);
}
function hE(e, t) {
	if (uE(e)) return t ? e.kind === "thread" ? pE(e, t) : t.kind === "group" && t.entry.id === e.id : !1;
}
function gE(e, t, n) {
	if (t.kind !== "workset") return n?.kind === "group" && n.entry.id === e.id && n.segmentKey === t.key;
}
function _E(e, t) {
	return e === null || t === null ? e === t : e.kind === "group" ? t.kind === "group" && e.entry.id === t.entry.id && e.segmentKey === t.segmentKey : t.kind === "thread" && e.name === t.name && e.episode === t.episode;
}
// src/app/components/inspector/threads/useThreadEventLog.ts
function vE(e, t) {
	let n = e?.metadata.session_id ?? "", r = Qr(e ? n : null, t);
	return {
		events: K(() => r.data ? vn(r.data.pages) : void 0, [r.data]) ?? (t === null ? void 0 : e?.thread_events?.[t]),
		hasOlder: !!r.hasNextPage,
		loadingOlder: r.isFetchingNextPage,
		loadingInitial: r.isPending,
		historyError: r.error instanceof Error ? r.error.message : null,
		loadOlder: async () => {
			await r.fetchNextPage();
		},
		retry: async () => {
			r.data ? await r.fetchNextPage() : await r.refetch();
		}
	};
}
// src/app/features/insights/presentation/useInsightsThread.ts
function yE(e, t) {
	return {
		name: e,
		session_id: t,
		created_at: "",
		updated_at: "",
		episode_count: 0,
		latest_action: null
	};
}
function bE(e, t, n) {
	let r = K(() => new Set(Cw(t).flatMap((e) => e.kind === "thread" ? [e.thread.name] : [])), [t]);
	return W((t) => r.has(t) || n[t] ? !0 : e ? e.threads.some((e) => e.name === t) || Object.hasOwn(e.thread_episodes, t) || (e.active_threads ?? []).includes(t) : !1, [
		r,
		n,
		e
	]);
}
function xE(e, t, { liveThreads: n, runningNames: r }, i) {
	let a = e?.messages, o = K(() => YC(a ?? []), [a]), s = vE(e, t), c = !!(t && r.has(t));
	if (!e || !t) return null;
	let l = e.threads.find((e) => e.name === t) ?? yE(t, e.metadata.session_id ?? ""), u = n[t];
	return {
		thread: l,
		action: o[t] || l.latest_action || "",
		episodes: e.thread_episodes?.[t] ?? [],
		liveLog: u?.log ?? [],
		running: c,
		canSteer: yS(i, u),
		eventLog: s
	};
}
// src/app/lib/useSharedValue.ts
function SE(e, t) {
	let [n, r] = J(e);
	return n === e || t(n, e) ? n : (r(e), e);
}
function CE(e) {
	let [t, n] = J({
		value: e,
		shared: e
	});
	if (t.value === e) return t.shared;
	let r = _i(t.shared, e);
	return n({
		value: e,
		shared: r
	}), r;
}
// src/app/features/insights/presentation/InsightsView.tsx
function wE({ sessionId: e, snapshot: t, topology: n, canSteerWorkers: r }) {
	let { useInsightsFilter: i, useSelectedInsight: a, useSelectedThread: o, useSelectedThreadEpisode: s, useInsightFocusNonce: c, useExpandedInsightGroups: l, selectInsight: u, selectInsightsFilter: d, selectThread: f, showSidePanelList: p, toggleInsightGroup: m } = V().stores.sessionLayoutStore, h = xS(), g = iy(), _ = vS(t), v = K(() => Tw(n), [n]), y = i(), b = v.some((e) => e.value === y) ? y : "all", x = CE(K(() => bw(h.turns), [h.turns])), S = K(() => Sw(x, b), [x, b]), C = bE(t, x, _.liveThreads), w = AT(e, t, x), T = a(), E = o(), D = s(), O = c(), k = l(), ee = K(() => dE(T, {
		name: E,
		episode: D
	}, x, C), [
		T,
		E,
		D,
		x,
		C
	]), A = K(() => ee ?? fE(S, x), [
		ee,
		S,
		x
	]), te = SE(A, _E), j = q(null);
	pi(() => {
		j.current !== O && (j.current = O, ee && (b !== "all" && mE(ee, S) && d("all"), ee.kind === "group" && ee.segmentKey && ee.entry.group.segments.length > 1 && m(ee.entry.id, !0)));
	}, [
		O,
		ee,
		b,
		S,
		d,
		m
	]);
	let ne = t?.threads, re = K(() => ({
		resolveSession: w,
		episodeCounts: new Map((ne ?? []).map((e) => [e.name, e.episode_count]))
	}), [w, ne]), ie = K(() => {
		let e = (e, t) => {
			if (t.kind === "workset") {
				let { worksetId: e } = t;
				return e ? () => g.openWorkset(e) : null;
			}
			return () => {
				u({
					kind: "group",
					groupId: e.id,
					segmentKey: t.key
				}), p(!1);
			};
		};
		return {
			expanded: k,
			entryView: (e) => lE(e, re),
			segmentView: (e) => cE(e, re),
			entrySelected: (e) => hE(e, te),
			segmentSelected: (e, t) => gE(e, t, te),
			entryAction: (t) => {
				if (t.kind === "thread") return () => {
					f(t.thread.name, t.id), u({ kind: "thread" });
				};
				if (t.kind === "session") {
					let e = w(t.rowKey);
					return e ? () => g.openSubagent(e.rowKey) : null;
				}
				let { segments: n } = t.group;
				return n.length === 1 ? e(t, n[0]) : () => {
					m(t.id), u({
						kind: "group",
						groupId: t.id,
						segmentKey: null
					});
				};
			},
			segmentAction: e
		};
	}, [
		k,
		re,
		te,
		g,
		w,
		u,
		f,
		p,
		m
	]), ae = t?.workspace?.host_root, oe = t?.workspace?.file_path_prefix, se = t?.metadata.workspace_host_path, ce = t?.metadata.cwd, M = K(() => ({
		sessionId: e,
		resolveSession: w,
		openSubagent: g.openSubagent,
		openWorkset: g.openWorkset,
		workspaceRoots: [
			ae,
			se,
			ce
		],
		filePathPrefix: oe,
		openFile: g.openFile
	}), [
		e,
		w,
		g,
		ae,
		oe,
		se,
		ce
	]), [le, ue] = J("log"), [de, fe] = J(null), pe = N(), P = xE(t, A?.kind === "thread" ? A.name : null, _, r), me = ay(T, t != null && ee != null), F = q({
		picked: ee,
		timeline: x
	});
	pi(() => {
		F.current = {
			picked: ee,
			timeline: x
		};
	});
	let he = W((e) => {
		d(e);
		let t = F.current, n = Sw(t.timeline, e);
		t.picked && e !== "all" && mE(t.picked, n) && u(null);
	}, [d, u]), ge = K(() => Ew(b, n), [b, n]), _e = t?.message_page?.has_older === !0, L = K(() => _e ? /* @__PURE__ */ X(aE, { sessionId: e }) : null, [_e, e]);
	if (!t) return /* @__PURE__ */ X(Bx, { listTitle: "Insights" });
	let R, ve;
	if (A?.kind === "thread" && P) {
		let { thread: t, eventLog: n } = P;
		R = /* @__PURE__ */ X("span", {
			className: I(P.running && "text-shimmer-basic"),
			children: t.name
		}), ve = /* @__PURE__ */ X(_S, {
			thread: t,
			action: P.action,
			episodes: P.episodes,
			events: n.events,
			liveLog: P.liveLog,
			running: P.running,
			hasOlder: n.hasOlder,
			loadingOlder: n.loadingOlder,
			loadingInitial: n.loadingInitial,
			historyError: n.historyError,
			onLoadOlder: n.loadOlder,
			onRetry: n.retry,
			view: le,
			canSteer: P.canSteer,
			onSteer: () => fe(t.name),
			onViewChange: ue
		}, `${e}:${t.name}`);
	} else A?.kind === "group" ? (R = lE(A.entry, re).label, ve = /* @__PURE__ */ X(KT, {
		group: A.entry.group,
		segmentKey: A.segmentKey,
		focusNonce: O,
		context: M
	}, A.entry.id)) : ve = S.length === 0 ? /* @__PURE__ */ X(Vx, {
		title: ge.title,
		children: ge.body
	}) : /* @__PURE__ */ X(Vx, {
		title: "No action selected",
		children: "Select an action in the list to see its details."
	});
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(Rx, {
		listTitle: "Insights",
		listToolbar: /* @__PURE__ */ X(JT, {
			options: v,
			value: b,
			onChange: he
		}),
		listClassName: "p-2",
		title: R,
		titleAction: P?.action && !pe ? /* @__PURE__ */ X(Xx, { action: P.action }) : null,
		actions: pe ? P?.action ? /* @__PURE__ */ X(Zx, { action: P.action }) : null : P ? /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-2",
			children: [P.canSteer ? /* @__PURE__ */ X(z, {
				size: U.Small,
				variant: B.Secondary,
				onClick: () => fe(P.thread.name),
				children: "Steer"
			}) : null, /* @__PURE__ */ X(gS, {
				view: le,
				onChange: ue
			})]
		}) : null,
		list: /* @__PURE__ */ X(iE, {
			sections: S,
			pendingPrompt: h.pendingText,
			emptyCopy: ge,
			focusNonce: O,
			controller: ie,
			footer: L
		}),
		children: /* @__PURE__ */ X("div", {
			ref: me,
			id: ny,
			role: "region",
			"aria-label": "Insights detail",
			tabIndex: -1,
			className: "flex flex-col flex-1 min-w-0 min-h-0 -outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2",
			children: ve
		})
	}), de ? /* @__PURE__ */ X($x, {
		sessionId: e,
		threadName: de,
		onClose: () => fe(null)
	}) : null] });
}
// src/app/components/inspector/BranchPicker.tsx
function TE(e, t, n) {
	return e ? "A run is in flight; wait for it to finish." : t && !n ? "Uncommitted changes: commit or stash them before switching." : null;
}
function EE({ label: e, icon: t, active: n, disabled: r, title: i, onClick: a }) {
	let o = N();
	return /* @__PURE__ */ Z(Ui, {
		type: "button",
		size: o ? Bi.Large : Bi.Small,
		active: n,
		disabled: r,
		title: i,
		onClick: a,
		children: [/* @__PURE__ */ X(R, {
			iconName: t,
			className: "shrink-0"
		}), /* @__PURE__ */ X("span", {
			className: "flex-1 min-w-0 truncate text-left",
			children: e
		})]
	});
}
function DE({ busy: e, children: t }) {
	return /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
		children: [e ? /* @__PURE__ */ X(ut, {
			size: bt.Small,
			variant: ie.Neutral
		}) : null, t]
	});
}
function OE({ sessionId: e, branch: t, placement: n = M.TopRight, tertiary: r = !1, labelClassName: i, iconClassName: a }) {
	let { useRunning: o } = V().stores.runtimeStore, [s, c] = J(!1), [l, u] = J(""), d = o(e), { data: f, isLoading: p, error: m } = dr(e, s), h = Dt(e), _ = () => {
		c(!1), u(""), h.reset();
	}, v = () => s ? _() : c(!0), y = l.trim(), b = (f?.branches ?? []).filter((e) => e.name.toLowerCase().includes(y.toLowerCase())), S = (f?.branches ?? []).some((e) => e.name === y), C = f?.dirty ?? !1, w = TE(d, C, !0), T = TE(d, C, !1), E = N(), D = (e, t) => {
		h.mutate({
			name: e,
			create: t
		}, { onSuccess: _ });
	}, O = m ? Vt(m) : h.error ? Vt(h.error) : null;
	return /* @__PURE__ */ X(x, {
		open: s,
		onClose: _,
		placement: n,
		sticky: !0,
		className: "min-w-0",
		content: /* @__PURE__ */ Z("div", {
			className: "h-[calc(70dvh)] md:h-[280px] flex flex-col",
			children: [
				/* @__PURE__ */ Z("div", {
					className: "p-4 pt-0 md:pb-2 md:px-0 flex flex-col gap-2 shrink-0",
					children: [/* @__PURE__ */ X($, {
						autoFocus: !0,
						inputSize: E ? Q.Large : Q.Small,
						placeholder: "Find or create a branch",
						value: l,
						onChange: (e) => u(e.target.value)
					}), y && !S && !m ? /* @__PURE__ */ X(EE, {
						label: /* @__PURE__ */ Z(Y, { children: ["Create ", /* @__PURE__ */ X("span", {
							className: "text-basic-primary",
							children: y
						})] }),
						icon: H.Add,
						disabled: !!w,
						title: w ?? void 0,
						onClick: () => D(y, !0)
					}) : null]
				}),
				p ? /* @__PURE__ */ X("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ X(DE, {
						busy: !0,
						children: "Reading branches…"
					})
				}) : null,
				!p && !m ? /* @__PURE__ */ Z("div", {
					className: "flex flex-col flex-1 min-h-0 gap-2 md:gap-1 p-2 md:p-0 overflow-auto [&>*]:shrink-0",
					children: [b.map((e) => {
						let t = e.is_current ? null : T;
						return /* @__PURE__ */ X(EE, {
							label: e.name,
							icon: e.is_current ? H.Check : H.Scheme,
							active: e.is_current,
							disabled: !!t,
							title: t ?? void 0,
							onClick: e.is_current ? () => {} : () => D(e.name, !1)
						}, e.name);
					}), b.length === 0 && !y ? /* @__PURE__ */ X(DE, { children: "No local branches." }) : null]
				}) : null,
				h.isPending ? /* @__PURE__ */ X("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ X(DE, {
						busy: !0,
						children: "Working…"
					})
				}) : null,
				O ? /* @__PURE__ */ X("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ X(wu, {
						variant: hu.Error,
						title: O
					})
				}) : null,
				!O && C && !d ? /* @__PURE__ */ X("div", {
					className: "shrink-0 px-4 pt-2 md:px-0 md:pt-0",
					children: /* @__PURE__ */ X(wu, {
						variant: hu.Info,
						title: "Uncommitted changes: you can branch off them, but not switch away."
					})
				}) : null
			]
		}),
		children: r ? /* @__PURE__ */ Z(z, {
			variant: B.Tertiary,
			size: U.Small,
			content: g.IconLeft,
			className: "min-w-0",
			"aria-expanded": s,
			"aria-label": `Branch: ${t}`,
			onClick: v,
			children: [/* @__PURE__ */ X(R, {
				iconName: H.Scheme,
				size: 16,
				className: I("shrink-0", a)
			}), /* @__PURE__ */ X("span", {
				className: I("truncate max-w-[64px] xl:max-w-[128px]", i),
				children: t
			})]
		}) : /* @__PURE__ */ Z("button", {
			type: "button",
			className: "flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost",
			"aria-expanded": s,
			"aria-label": `Branch: ${t}`,
			onClick: v,
			children: [/* @__PURE__ */ X(R, {
				iconName: H.Scheme,
				size: 16,
				className: "shrink-0"
			}), /* @__PURE__ */ X("span", {
				className: I("label-micro text-btn-secondary truncate", !E && "max-w-[64px] xl:max-w-[128px]"),
				children: t
			})]
		})
	});
}
// src/app/components/inspector/CommitPopover.tsx
function kE(e, t, n) {
	return t == null ? e ? "A run is in flight; wait for it to finish." : n === 0 ? "Nothing to commit: the checkout matches HEAD." : null : "A revision is open; go back to the working tree to commit.";
}
var AE = (e, t) => `${e} ${t}${e === 1 ? "" : "s"}`;
function jE({ sessionId: e, changed: t, revision: n }) {
	let { useRunning: r } = V().stores.runtimeStore, [i, a] = J(!1), [o, s] = J(""), c = N(), l = r(e), u = nr(), d = P(e), f = kE(l, n, t.length), p = t.reduce((e, t) => e + (t.additions ?? 0), 0), m = t.reduce((e, t) => e + (t.deletions ?? 0), 0), h = () => {
		a(!1), d.reset();
	}, g = () => {
		let e = o.trim();
		!e || f || d.isPending || d.mutate({ message: e }, { onSuccess: (e) => {
			u.success(`Committed ${AE(e.files_changed, "file")} as ${e.sha.slice(0, 7)}.`), s(""), h();
		} });
	};
	return /* @__PURE__ */ X(x, {
		open: i,
		onClose: h,
		sticky: !0,
		placement: M.BottomRight,
		size: Le.Medium,
		sheetClassName: "gap-1 px-4",
		content: /* @__PURE__ */ Z(Y, { children: [
			/* @__PURE__ */ X(tu, {
				autoFocus: !0,
				rows: 3,
				textAreaSize: eu.Small,
				placeholder: "Commit message",
				value: o,
				onChange: (e) => s(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), g());
				}
			}),
			/* @__PURE__ */ Z("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [
					/* @__PURE__ */ Z("span", {
						className: "flex-1 min-w-0 truncate",
						children: ["Staging ", AE(t.length, "file")]
					}),
					/* @__PURE__ */ Z("span", {
						className: "code code-small text-success-primary",
						children: ["+", p]
					}),
					/* @__PURE__ */ Z("span", {
						className: "code code-small text-error-primary",
						children: ["-", m]
					})
				]
			}),
			d.error ? /* @__PURE__ */ X("div", {
				className: "p-1 label-micro text-error-primary",
				children: Vt(d.error)
			}) : null,
			/* @__PURE__ */ X(z, {
				size: U.Medium,
				variant: B.Secondary,
				disabled: !o.trim(),
				loading: d.isPending,
				onClick: g,
				children: "Commit"
			})
		] }),
		children: c ? /* @__PURE__ */ X(Zr, {
			className: "shrink-0",
			variant: B.Primary,
			disabled: !!f,
			"aria-expanded": i,
			title: f ?? "Commit every change in the checkout",
			onClick: () => i ? h() : a(!0),
			children: "Commit"
		}) : /* @__PURE__ */ X(z, {
			className: "max-w-[120px] shrink-0",
			size: U.Small,
			variant: B.Secondary,
			disabled: !!f,
			"aria-expanded": i,
			title: f ?? "Commit every change in the checkout",
			onClick: () => i ? h() : a(!0),
			children: "Commit"
		})
	});
}
// src/app/components/inspector/FilesListControls.tsx
var ME = [{
	listing: "tree",
	label: "All",
	name: "All files"
}, {
	listing: "changed",
	label: "Diff",
	name: "Diff of changed files"
}];
function NE({ sessionId: e, listing: t, changed: n, revision: r, readOnly: i }) {
	let { selectFileListing: a } = V().stores.sessionLayoutStore, o = N(), s = Se(), c = i ? null : /* @__PURE__ */ X(jE, {
		sessionId: e,
		changed: n,
		revision: r
	});
	if (o) return /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-2",
		children: [ME.map((e) => /* @__PURE__ */ X(Zr, {
			variant: t === e.listing ? B.GhostHighlighted : B.Ghost,
			"aria-pressed": t === e.listing,
			"aria-label": e.name,
			onClick: () => a(e.listing),
			children: e.label
		}, e.listing)), c]
	});
	let l = /* @__PURE__ */ X("div", {
		className: "flex flex-1 min-w-0 items-center gap-1",
		children: ME.map((e) => /* @__PURE__ */ X(Bl, {
			size: Rl.Small,
			active: t === e.listing,
			"aria-pressed": t === e.listing,
			"aria-label": e.name,
			onClick: () => a(e.listing),
			children: e.label
		}, e.listing))
	});
	return s ? /* @__PURE__ */ Z("div", {
		className: "flex flex-1 min-w-0 items-center gap-[10px] pr-2",
		children: [l, c]
	}) : /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-3 h-12 px-3 shrink-0 border-b border-muted @max-[560px]:gap-2 @max-[560px]:px-2",
		children: [l, c]
	});
}
function PE({ sessionId: e, branch: t, readOnly: n }) {
	return /* @__PURE__ */ X("div", {
		className: "flex min-w-0 items-center px-2 pb-2",
		children: n ? /* @__PURE__ */ Z("span", {
			className: "label-micro flex min-w-0 items-center gap-1.5 py-1 pl-1 text-btn-secondary",
			children: [/* @__PURE__ */ X(R, {
				iconName: H.Scheme,
				size: 16,
				className: "shrink-0"
			}), /* @__PURE__ */ X("span", {
				className: "truncate",
				children: t
			})]
		}) : /* @__PURE__ */ X(OE, {
			sessionId: e,
			branch: t
		})
	});
}
// src/app/components/inspector/PanelMessages.tsx
function FE({ children: e }) {
	let t = N();
	return /* @__PURE__ */ X("p", {
		className: I("text-basic-muted", t ? "px-3 py-2 label-small" : "p-1 label-micro"),
		children: e
	});
}
function IE({ listTitle: e, children: t }) {
	let n = N(), r = /* @__PURE__ */ X("div", {
		className: I("p-6 label-small text-error-primary", n && "pt-20"),
		children: t
	});
	return n ? /* @__PURE__ */ X(Lx, {
		title: e,
		bar: !0,
		children: r
	}) : r;
}
// src/app/hooks/useLiveWorkspace.ts
var LE = 3e3;
function RE(e, t) {
	let { useWorkspaceEpoch: n } = V().stores.runtimeStore, r = Si(), i = n(), a = q(null), o = q(0);
	G(() => {
		if (t != null || i === 0 || a.current !== null) return;
		let n = Math.max(0, LE - (Date.now() - o.current));
		a.current = window.setTimeout(() => {
			a.current = null, o.current = Date.now(), ei("query:invalidate.workspace", { throttleMs: 0 }), r.invalidateQueries({
				queryKey: on.sessionSnapshot(e),
				exact: !0
			}), r.invalidateQueries({ queryKey: on.workspaceFilesRoot(e) }), r.invalidateQueries({ queryKey: on.workspaceDiffRoot(e) }), r.invalidateQueries({ queryKey: on.workspaceFileRoot(e) });
		}, n);
	}, [
		r,
		i,
		t,
		e
	]), G(() => () => {
		a.current !== null && clearTimeout(a.current);
	}, []);
}
// src/app/lib/fileTree.ts
var zE = (e) => e.endsWith("/");
function BE(e) {
	let t = e.replace(/\/+$/, ""), n = t.split("/").pop() || t;
	return zE(e) ? `${n}/` : n;
}
var VE = (e, t) => ({
	name: e,
	path: t,
	dirs: /* @__PURE__ */ new Map(),
	files: []
}), HE = (e, t) => e.name.localeCompare(t.name);
function UE(e) {
	let t = e, n = e.name;
	for (; t.files.length === 0 && t.dirs.size === 1;) {
		let [e] = t.dirs.values();
		n = `${n}/${e.name}`, t = e;
	}
	let r = [...t.dirs.values()].map(UE).sort(HE), i = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: n,
		path: t.path,
		dirs: r,
		files: i,
		hasChanges: i.some((e) => e.status) || r.some((e) => e.hasChanges)
	};
}
function WE(e) {
	let t = VE("", "");
	for (let n of e) {
		let e = n.path.replace(/\/+$/, "").split("/");
		e.pop();
		let r = t, i = "";
		for (let t of e) {
			i = i ? `${i}/${t}` : t;
			let e = r.dirs.get(t);
			e || (e = VE(t, i), r.dirs.set(t, e)), r = e;
		}
		r.files.push(n);
	}
	let n = [...t.dirs.values()].map(UE).sort(HE), r = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: "",
		path: "",
		dirs: n,
		files: r,
		hasChanges: r.some((e) => e.status) || n.some((e) => e.hasChanges)
	};
}
function GE(e, t = []) {
	for (let n of e.dirs) n.hasChanges && (t.push(n.path), GE(n, t));
	return t;
}
// src/app/components/inspector/FilesView.tsx
var KE = (e) => e ? kl.Large : kl.Small;
function qE({ file: e, size: t, selected: n, onSelect: r }) {
	return /* @__PURE__ */ X(Fl, {
		name: BE(e.path),
		path: e.path,
		size: t,
		active: n === e.path,
		status: Dl(e.status),
		title: e.path,
		onClick: () => r(e.path)
	});
}
function JE({ dir: e, depth: t, open: n, selected: r, onToggle: i, onSelect: a }) {
	let o = N();
	return /* @__PURE__ */ Z("div", {
		className: I("flex flex-col gap-[2px]", t > 0 && "mb-2 border-l border-muted pl-2"),
		children: [e.dirs.map((e) => {
			let s = n.has(e.path);
			return /* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-[2px] w-full",
				children: [/* @__PURE__ */ X(Fl, {
					name: e.name,
					variant: Al.Folder,
					size: KE(o),
					active: s,
					status: e.hasChanges ? wl.Changed : null,
					onClick: () => i(e.path)
				}), s ? /* @__PURE__ */ X(JE, {
					dir: e,
					depth: t + 1,
					open: n,
					selected: r,
					onToggle: i,
					onSelect: a
				}) : null]
			}, e.path);
		}), e.files.map((e) => /* @__PURE__ */ X(qE, {
			file: e,
			size: KE(o),
			selected: r,
			onSelect: a
		}, e.path))]
	});
}
function YE({ files: e, selected: t, onSelect: n }) {
	let r = N();
	return e.length === 0 ? /* @__PURE__ */ X(FE, { children: "Nothing has changed here yet." }) : /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-1",
		children: e.map((e) => /* @__PURE__ */ X(qE, {
			file: e,
			size: KE(r),
			selected: t,
			onSelect: n
		}, e.path))
	});
}
var XE = "code code-small font-medium !leading-4 !tracking-normal", ZE = I(XE, "shrink-0 w-12 text-right opacity-50 text-basic-muted select-none");
function QE({ lineNo: e, content: t, tokens: n, tone: r, trailing: i }) {
	return /* @__PURE__ */ Z("div", {
		className: I("flex items-start w-full border-l-2 border-solid", r === "add" ? "bg-success-primary border-success-primary" : r === "delete" ? "bg-error-primary border-error-primary" : "border-transparent"),
		children: [/* @__PURE__ */ X("span", {
			className: ZE,
			children: e ?? ""
		}), /* @__PURE__ */ Z("span", {
			className: I(XE, "flex-1 min-w-0 px-2 text-basic-primary whitespace-pre-wrap break-words"),
			children: [n ? n.map((e, t) => /* @__PURE__ */ X("span", {
				style: Lr(e),
				children: e.text
			}, t)) : t, i]
		})]
	});
}
function $E({ line: e, tokens: t }) {
	let n = e.kind === "delete", r = n ? e.old_lineno : e.new_lineno ?? e.old_lineno;
	return /* @__PURE__ */ X(QE, {
		lineNo: r,
		content: e.content,
		tokens: t,
		tone: e.kind === "insert" ? "add" : n ? "delete" : void 0,
		trailing: e.has_trailing_newline === !1 ? /* @__PURE__ */ X("span", {
			className: "italic text-basic-muted",
			children: " No newline at end of file"
		}) : null
	});
}
function eD({ tone: e, children: t }) {
	return /* @__PURE__ */ X("div", {
		className: I("mx-4 my-2 rounded-md px-3 py-2 code code-small", e === "error" ? "text-error-primary bg-error-tertiary border border-error-muted" : "text-basic-muted bg-elevation-level-0-5"),
		children: t
	});
}
function tD({ section: e, highlighted: t }) {
	return e.error ? /* @__PURE__ */ Z(eD, {
		tone: "error",
		children: ["Error: ", e.error]
	}) : e.binary ? /* @__PURE__ */ X(eD, { children: "Binary or non-UTF-8 content; inline hunks are unavailable." }) : e.too_large ? /* @__PURE__ */ X(eD, { children: "File is too large for inline diff rendering." }) : e.hunks.length === 0 ? /* @__PURE__ */ X(eD, { children: "No hunks for this section." }) : /* @__PURE__ */ Z(Y, { children: [e.hunks.map((e, n) => /* @__PURE__ */ Z("div", {
		className: "flex flex-col w-full",
		children: [/* @__PURE__ */ Z("div", {
			className: "flex items-start w-full border-l-2 border-transparent bg-info-tertiary",
			children: [/* @__PURE__ */ X("span", {
				className: ZE,
				children: "@@"
			}), /* @__PURE__ */ Z("span", {
				className: I(XE, "flex-1 min-w-0 px-2 text-info-primary truncate"),
				children: [`-${e.old_start},${e.old_lines} +${e.new_start},${e.new_lines}`, e.function_context ? ` ${e.function_context}` : ""]
			})]
		}), e.lines.map((e, n) => /* @__PURE__ */ X($E, {
			line: e,
			tokens: t.get(e)
		}, n))]
	}, n)), e.truncated ? /* @__PURE__ */ X(eD, { children: "Diff was truncated by the backend." }) : null] });
}
function nD({ path: e }) {
	let t = N();
	return /* @__PURE__ */ Z("span", {
		className: "flex min-w-0 items-center gap-[10px]",
		title: e,
		children: [/* @__PURE__ */ X(cl, {
			path: e,
			size: t ? 24 : 20
		}), /* @__PURE__ */ X("span", {
			className: "min-w-0 truncate",
			children: BE(e)
		})]
	});
}
function rD({ path: e, trailing: t }) {
	return A() ? /* @__PURE__ */ Z("div", {
		className: "flex items-center gap-[10px] h-12 px-4 shrink-0 border-b border-muted bg-elevation-ground header-sm text-basic-primary",
		children: [/* @__PURE__ */ X(nD, { path: e }), t]
	}) : null;
}
function iD({ children: e }) {
	let t = N();
	return /* @__PURE__ */ X("div", {
		className: I("flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0", t ? "py-16" : "py-2"),
		children: e
	});
}
function aD(e, t, n) {
	let r = t != null && (t.additions != null || t.deletions != null), { data: i, isPlaceholderData: a } = St(e, t && !r ? t.path : null, "all", 3, n);
	return K(() => t ? r ? {
		additions: t.additions ?? 0,
		deletions: t.deletions ?? 0
	} : !i || a ? null : i.sections.reduce((e, t) => ({
		additions: e.additions + t.additions,
		deletions: e.deletions + t.deletions
	}), {
		additions: 0,
		deletions: 0
	}) : null, [
		t,
		r,
		i,
		a
	]);
}
function oD({ sessionId: e, file: t, counts: n, revision: r }) {
	let { data: i, isFetching: a, error: o } = St(e, t.path, "all", 3, r);
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(rD, {
		path: t.path,
		trailing: n ? /* @__PURE__ */ X(ml, {
			additions: n.additions,
			deletions: n.deletions
		}) : null
	}), /* @__PURE__ */ Z(iD, { children: [
		a && !i ? /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ X(ut, { size: bt.Small }), " Loading diff…"]
		}) : null,
		o ? /* @__PURE__ */ X(eD, {
			tone: "error",
			children: Vt(o)
		}) : null,
		i ? /* @__PURE__ */ X(sD, { diff: i }) : null
	] })] });
}
function sD({ diff: e }) {
	let [t, n] = J(() => /* @__PURE__ */ new Map());
	return G(() => {
		let t = !0;
		return zt(e.path, e.sections).then((e) => {
			t && n(e);
		}), () => {
			t = !1;
		};
	}, [e]), e.error ? /* @__PURE__ */ X(eD, {
		tone: "error",
		children: e.error
	}) : e.sections.length === 0 ? /* @__PURE__ */ X(eD, { children: "No diff sections returned." }) : /* @__PURE__ */ X(Y, { children: e.sections.map((e, n) => /* @__PURE__ */ X(tD, {
		section: e,
		highlighted: t
	}, n)) });
}
var cD = (e) => e < 1024 ? `${e} B` : `${Math.round(e / 1024)} KB`;
function lD({ sessionId: e, path: t, revision: n }) {
	let { data: r, isFetching: i, error: a } = Mt(e, t, n), [o, s] = J(null), c = r?.content?.replace(/\n$/, "") ?? null, l = K(() => c?.split("\n") ?? null, [c]);
	G(() => {
		if (c === null) return;
		let e = !0;
		return bn(t, c).then((t) => {
			e && t && s({
				text: c,
				lines: t
			});
		}), () => {
			e = !1;
		};
	}, [t, c]);
	let u = o?.text === c ? o.lines : null;
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(rD, {
		path: t,
		trailing: r ? /* @__PURE__ */ X("span", {
			className: I(XE, "shrink-0 text-basic-muted"),
			children: cD(r.size)
		}) : null
	}), /* @__PURE__ */ Z(iD, { children: [
		i && !r ? /* @__PURE__ */ Z("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ X(ut, { size: bt.Small }), " Loading file…"]
		}) : null,
		a ? /* @__PURE__ */ X(eD, {
			tone: "error",
			children: Vt(a)
		}) : null,
		r?.binary ? /* @__PURE__ */ X(eD, { children: "Binary file; nothing to show inline." }) : null,
		r?.too_large ? /* @__PURE__ */ Z(eD, { children: [
			"File is too large to display (",
			cD(r.size),
			")."
		] }) : null,
		l ? l.map((e, t) => /* @__PURE__ */ X(QE, {
			lineNo: t + 1,
			content: e,
			tokens: u?.[t]
		}, t)) : null
	] })] });
}
function uD({ sessionId: t, snapshot: n, revision: r = null, readOnly: i = !1 }) {
	let { useToggledFolders: a, useSelectedFile: o, useFileListing: s, toggleFolder: c, selectFile: l } = V().stores.sessionLayoutStore, u = Si(), d = N(), f = o(), p = a(), m = s(), { data: h, error: g } = We(t, r), _ = e(t, r);
	G(() => {
		r ?? u.invalidateQueries({ queryKey: on.sessionSnapshot(t) });
	}, [
		u,
		t,
		r
	]), RE(t, r);
	let v = n?.workspace ?? null, y = K(() => r == null ? v?.changed_files ?? [] : _.data?.changed_files ?? [], [
		r,
		v,
		_.data
	]), b = K(() => dD(h?.files ?? [], y), [h, y]), x = K(() => WE(b), [b]), S = K(() => b.filter((e) => e.status !== null), [b]), C = K(() => {
		let e = new Set(GE(x));
		for (let t of p) e.delete(t) || e.add(t);
		return e;
	}, [x, p]), w = K(() => new Map(S.map((e) => [e.path, e])), [S]), T = f ?? S[0]?.path ?? null, E = T ? w.get(T) : void 0, D = aD(t, E, r), O = d ? f : T, k = g ?? (r == null ? null : _.error);
	if (r == null && v?.error) return /* @__PURE__ */ X(IE, {
		listTitle: "Files",
		children: v.error
	});
	if (k) return /* @__PURE__ */ X(IE, {
		listTitle: "Files",
		children: Vt(k)
	});
	if (!h) return /* @__PURE__ */ X(Bx, { listTitle: "Files" });
	let ee = v?.branch;
	return /* @__PURE__ */ X(Rx, {
		listTitle: "Files",
		title: T ? /* @__PURE__ */ X(nD, { path: T }) : void 0,
		titleAction: D ? /* @__PURE__ */ X(ml, {
			additions: D.additions,
			deletions: D.deletions,
			size: d ? ll.Medium : ll.Small
		}) : null,
		listToolbar: /* @__PURE__ */ X(NE, {
			sessionId: t,
			listing: m,
			changed: y,
			revision: r,
			readOnly: i
		}),
		list: /* @__PURE__ */ Z(Y, { children: [d && ee ? /* @__PURE__ */ X(PE, {
			sessionId: t,
			branch: ee,
			readOnly: i
		}) : null, b.length === 0 ? /* @__PURE__ */ X(FE, { children: "No files in the workspace." }) : m === "changed" ? /* @__PURE__ */ X(YE, {
			files: S,
			selected: O,
			onSelect: l
		}) : /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(JE, {
			dir: x,
			depth: 0,
			open: C,
			selected: O,
			onToggle: c,
			onSelect: l
		}), h.truncated ? /* @__PURE__ */ X(FE, { children: "Listing truncated." }) : null] })] }),
		children: T ? E ? /* @__PURE__ */ X(oD, {
			sessionId: t,
			file: E,
			counts: D,
			revision: r
		}, T) : /* @__PURE__ */ X(lD, {
			sessionId: t,
			path: T,
			revision: r
		}, T) : /* @__PURE__ */ X(Vx, { children: b.length === 0 ? "No files in the workspace." : "Select a file to see it." })
	});
}
function dD(e, t) {
	let n = new Map(t.map((e) => [e.path, e])), r = t.filter((e) => e.path.endsWith("/")), i = e.map((e) => {
		let t = n.get(e) ?? r.find((t) => e.startsWith(t.path));
		return {
			path: e,
			status: t?.status ?? null,
			additions: t?.additions ?? null,
			deletions: t?.deletions ?? null
		};
	}), a = new Set(e);
	for (let e of t) a.has(e.path) || e.path.endsWith("/") || i.push({
		path: e.path,
		status: e.status,
		additions: e.additions ?? null,
		deletions: e.deletions ?? null
	});
	return i;
}
// src/app/components/inspector/SubagentListControls.tsx
function fD({ summary: e, title: t, isMobile: n }) {
	let { rename: r, togglePin: i } = Bm();
	return /* @__PURE__ */ X(ih, {
		title: t,
		pinned: e.pinned,
		isMobile: n,
		onPin: () => void i(e),
		onRename: () => r(e)
	});
}
// src/app/components/inspector/ChatBadge.tsx
function pD({ additions: e, deletions: t }) {
	return /* @__PURE__ */ Z("span", {
		className: "flex items-center gap-2 shrink-0 code code-small",
		children: [/* @__PURE__ */ Z("span", {
			className: "text-success-primary",
			children: ["+", e]
		}), /* @__PURE__ */ Z("span", {
			className: "text-error-primary",
			children: ["-", t]
		})]
	});
}
// src/app/components/inspector/SnapshotFiles.tsx
var mD = 8, hD = "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2";
function gD({ file: e, active: t, onOpen: n }) {
	return /* @__PURE__ */ Z("button", {
		type: "button",
		className: I("flex items-center gap-[6px] max-w-full py-2 md:py-1 px-2 rounded-[4px] shrink-0", hD, t ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": t,
		title: e.path,
		onClick: () => n(e.path),
		children: [
			/* @__PURE__ */ X(cl, { path: e.path }),
			/* @__PURE__ */ X("span", {
				className: "text-micro truncate",
				children: BE(e.path)
			}),
			e.additions != null || e.deletions != null ? /* @__PURE__ */ Z("span", {
				className: "flex items-center gap-1 shrink-0 code code-micro",
				children: [/* @__PURE__ */ Z("span", {
					className: "text-success-primary",
					children: ["+", e.additions ?? 0]
				}), /* @__PURE__ */ Z("span", {
					className: "text-error-primary",
					children: ["-", e.deletions ?? 0]
				})]
			}) : null
		]
	});
}
function _D({ files: e, selected: t, onOpen: n, onOpenAll: r }) {
	if (!e.length) return null;
	let i = e.slice(0, mD), a = e.length - i.length;
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-1 md:gap-0 w-full pl-2 pr-4 pb-1 items-start",
		children: [i.map((e) => /* @__PURE__ */ X(gD, {
			file: e,
			active: t === e.path,
			onOpen: n
		}, e.path)), a > 0 ? /* @__PURE__ */ X("button", {
			type: "button",
			className: I("btn-ghost flex items-center shrink-0 py-1 px-2 rounded-[4px] label-micro text-basic-muted shrink-0", hD),
			onClick: r,
			children: `+${a} more`
		}) : null]
	});
}
// src/app/components/inspector/SnapshotBadge.tsx
function vD({ revision: t, panel: n }) {
	let { data: r } = e(n.sessionId, t.id), i = K(() => (r?.changed_files ?? []).filter((e) => !e.path.endsWith("/")), [r]), a = n.selectedRevision === t.id;
	return /* @__PURE__ */ Z("div", {
		className: I("flex w-full min-w-0 flex-col items-start border-l-2 border-solid transition-colors duration-150", a ? "border-primary" : "border-muted"),
		children: [/* @__PURE__ */ Z("button", {
			type: "button",
			className: I("flex max-w-full items-center gap-4 rounded-[4px] px-4 py-2", "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2", a ? "btn-ghost-highlighted" : "btn-ghost"),
			"aria-pressed": a || void 0,
			onClick: () => n.onOpenPanel(t.id),
			children: [/* @__PURE__ */ X("span", {
				className: "label-small truncate text-btn-secondary",
				children: "Snapshot"
			}), /* @__PURE__ */ X(pD, {
				additions: t.additions,
				deletions: t.deletions
			})]
		}), /* @__PURE__ */ X(_D, {
			files: i,
			selected: a ? n.selectedFile : null,
			onOpen: (e) => n.onOpenFile(t.id, e),
			onOpenAll: () => n.onOpenPanel(t.id)
		})]
	});
}
// src/app/components/inspector/ThreadLogTail.tsx
var yD = 16, bD = 150;
function xD(e) {
	switch (e) {
		case 0: return "";
		case 1: return "opacity-50";
		case 2: return "opacity-10";
		default: return "opacity-0";
	}
}
function SD(e) {
	let t = q(null), n = q(e);
	return pi(() => {
		let r = t.current;
		r && e !== n.current && (n.current = e, e && (r.style.transition = "none", r.style.transform = `translateY(${yD}px)`, r.offsetHeight, r.style.transition = `transform ${bD}ms ease-out`, r.style.transform = "translateY(0)"));
	}, [e]), t;
}
function CD({ lines: e, className: t }) {
	let n = e.slice(-4), r = SD(n[n.length - 1]?.key);
	return /* @__PURE__ */ X("div", {
		className: I("flex flex-col justify-end overflow-hidden", t),
		children: /* @__PURE__ */ X("div", {
			ref: r,
			className: "flex flex-col",
			children: n.map((e, t) => /* @__PURE__ */ X("span", {
				className: I("w-full truncate code code-micro !text-[11px] !leading-[16px] !m-0 block", "transition-opacity duration-150 ease-out", "text-basic-tertiary", xD(n.length - 1 - t)),
				children: e.isError && e.mark ? /* @__PURE__ */ Z(Y, { children: [
					/* @__PURE__ */ X("span", {
						className: "text-error-primary",
						children: e.mark
					}),
					" ",
					e.body
				] }) : e.bare
			}, e.key))
		})
	});
}
// src/app/features/insights/transcript/openOptions.ts
function wD(e) {
	return e.detail === 0 ? { focusDetail: !0 } : void 0;
}
// src/app/components/inspector/ThreadWave.tsx
var TD = {
	error: 0,
	running: 1,
	pending: 2,
	cancelled: 3,
	done: 4
}, ED = {
	error: "failed",
	running: "running",
	pending: "pending",
	cancelled: "cancelled",
	done: "done"
}, DD = "size-4 xl:size-5", OD = "h-11 w-full p-1.5 xl:h-12 xl:p-2", kD = "h-11 w-full px-1.5 pb-1.5 xl:h-12 xl:px-2 xl:pb-2";
function AD({ state: e }) {
	return e === "running" ? /* @__PURE__ */ X(ut, {
		size: bt.Small,
		variant: ie.Neutral,
		className: "shrink-0 [&_svg]:size-4 xl:[&_svg]:size-5"
	}) : e === "pending" ? /* @__PURE__ */ X(R, {
		iconName: H.Timelaps,
		className: I(DD, "shrink-0 [&>path]:!fill-basic-muted")
	}) : e === "error" ? /* @__PURE__ */ X(R, {
		iconName: H.Danger,
		className: I(DD, "shrink-0 [&>path]:!fill-error-primary")
	}) : e === "cancelled" ? /* @__PURE__ */ X(R, {
		iconName: H.Close,
		className: I(DD, "shrink-0 [&>path]:!fill-basic-muted")
	}) : /* @__PURE__ */ X(R, {
		iconName: H.CheckCircle,
		className: I(DD, "shrink-0 [&>path]:!fill-basic-primary")
	});
}
function jD(e) {
	return e.reduce((e, t) => TD[t.state] < TD[e] ? t.state : e, "done");
}
function MD({ thread: e, selected: t, onSelect: n }) {
	let r = fi(), i = e.state === "running", a = e.state === "pending", o = e.state === "cancelled", s = e.log.length ? e.log : [{
		key: "action",
		text: e.action,
		bare: e.action,
		mark: null,
		name: null,
		body: e.action,
		isError: !1
	}], c = /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ Z("div", {
		className: "flex w-full shrink-0 items-center gap-1 px-1.5 py-2 xl:gap-2.5 xl:p-2",
		children: [
			/* @__PURE__ */ X(AD, { state: e.state }),
			/* @__PURE__ */ X("span", {
				className: I("min-w-0 flex-1 truncate text-xs/4 font-medium xl:text-sm/5", i ? "text-shimmer-basic" : a ? "text-basic-muted" : e.state === "error" ? "text-error-primary" : "text-basic-primary"),
				children: e.name
			}),
			e.weight && /* @__PURE__ */ X("span", {
				className: "shrink-0 rounded-[3px] bg-elevation-level-3 px-1 text-[9px] uppercase tracking-wide text-basic-muted",
				children: e.weight
			})
		]
	}), i || o ? /* @__PURE__ */ X("div", {
		id: r,
		className: "w-full",
		children: /* @__PURE__ */ X(CD, {
			lines: s,
			className: kD
		})
	}) : /* @__PURE__ */ X("div", {
		id: r,
		className: OD,
		children: /* @__PURE__ */ X("span", {
			className: "line-clamp-2 text-micro text-basic-muted",
			children: a ? "Pending..." : e.summary
		})
	})] }), l = "flex h-full w-full flex-col items-start text-left";
	return /* @__PURE__ */ X("div", {
		className: I("w-[180px] shrink-0 overflow-hidden rounded-[4px] shadow-convex xl:w-[220px]", i ? "bg-elevation-level-2" : "bg-elevation-level-1"),
		children: n ? /* @__PURE__ */ X("button", {
			type: "button",
			className: I(l, "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2", t ? "btn-ghost-highlighted" : "btn-ghost"),
			"aria-label": [
				e.name,
				e.weight,
				ED[e.state]
			].filter(Boolean).join(", "),
			"aria-describedby": r,
			"aria-pressed": t,
			"aria-controls": ny,
			onClick: (t) => n(e.name, e.key, wD(t)),
			children: c
		}) : /* @__PURE__ */ X("div", {
			className: l,
			children: c
		})
	});
}
function ND({ threads: e, selected: t, onSelect: n }) {
	let r = jD(e);
	return /* @__PURE__ */ X("div", {
		className: I("w-full min-w-0 border-l-2 border-solid py-2 xl:py-3", r === "error" ? "border-error-primary" : r === "running" ? "border-primary" : "border-muted"),
		children: /* @__PURE__ */ X("div", {
			className: "scrollbar-none overflow-x-auto overflow-y-hidden overscroll-x-contain [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)]",
			children: /* @__PURE__ */ X("div", {
				className: "flex w-max items-start gap-1 pr-8 pl-3 xl:pl-4",
				children: e.map((e) => /* @__PURE__ */ X(MD, {
					thread: e,
					selected: t === e.key,
					onSelect: n
				}, e.key))
			})
		})
	});
}
function PD({ rows: e, selected: t, onSelect: n }) {
	return /* @__PURE__ */ X("div", {
		className: "flex w-full flex-col items-start",
		children: e.map((e, r) => /* @__PURE__ */ X(ND, {
			threads: e,
			selected: t,
			onSelect: n
		}, e.map((e) => e.key).join("|") || `row-${r}`))
	});
}
// src/app/features/insights/transcript/messageDate.ts
var FD = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec"
];
function ID(e) {
	let t = Rn(e);
	if (Number.isNaN(t)) return null;
	let n = new Date(t), r = n.getHours(), i = String(n.getMinutes()).padStart(2, "0"), a = `${r % 12 || 12}:${i} ${r < 12 ? "AM" : "PM"}`;
	return `${n.getDate()} ${FD[n.getMonth()]} ${n.getFullYear()} ${a}`;
}
// src/app/features/insights/transcript/useLiveGroupLabel.ts
function LD(e, t, n) {
	return K(() => {
		if (!t) return null;
		let r = oC(e);
		if (r !== null || !n) return r;
		let i = e.segments.at(-1);
		return i ? rC(i) : null;
	}, [
		e,
		t,
		n
	]);
}
// src/app/features/insights/transcript/TranscriptGroupBadge.tsx
function RD(e) {
	return e.segments.every((e) => TS(e) === "web-fetch");
}
var zD = li(function({ group: e, active: t, trailing: n, selected: r, interactive: i }) {
	let { openGroup: a } = iy(), o = LD(e, t, n);
	return /* @__PURE__ */ X(vd, {
		label: o ?? aC(e),
		inProgress: o !== null,
		selected: r,
		leadingIcon: RD(e) ? H.Globe : void 0,
		disabled: !i,
		controls: i ? ny : void 0,
		onClick: i ? (t) => a(e.id, void 0, wD(t)) : void 0
	});
}), BD = {
	idle: { status: rd.Ready },
	running: { status: rd.Running },
	completed: { status: rd.Ready },
	failed: {
		status: rd.Failed,
		label: "Failed"
	},
	cancelled: {
		status: rd.Failed,
		label: "Cancelled"
	},
	interrupted: {
		status: rd.Failed,
		label: "Interrupted"
	}
};
function VD(e) {
	return BD[e];
}
// src/app/features/insights/transcript/transcriptTurns.ts
var HD = si(null), UD = [], WD = /* @__PURE__ */ new WeakMap();
function GD(e) {
	let t = WD.get(e);
	if (t) return t;
	let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map();
	e.forEach((t, i) => {
		n.set(t.key, e[i - 1]), t.kind === "user" && r.set(t.messageIndex, t.createdAt);
	});
	let i = {
		previous: n,
		promptTimes: r,
		last: e[e.length - 1]
	};
	return WD.set(e, i), i;
}
function KD() {
	return ui(HD)?.turns ?? UD;
}
function qD(e) {
	let t = GD(KD());
	return t.previous.has(e.key) ? t.previous.get(e.key) : e.messageIndex === null ? t.last : void 0;
}
function JD(e) {
	let { promptTimes: t } = GD(KD());
	return e === void 0 ? null : t.get(e) ?? null;
}
function YD() {
	let { sessionId: e } = Mi(), t = ui(HD);
	return t ? t.sessionId : e ?? null;
}
// src/app/features/insights/transcript/TranscriptSessionCard.tsx
var XD = {
	"spawn-agent": "traditional-child",
	"spawn-orchestrator": "managed-orchestrator"
};
function ZD(e) {
	return "child_session_id" in e ? e.child_session_id : e.orchestrator_session_id;
}
function QD(e, t) {
	return t ? e?.find((e) => ZD(e) === t) : void 0;
}
function $D(e, t) {
	let n = Si(), r = e.action === "spawn-agent", i = t ?? "", a = n.getQueryState(r ? on.traditionalChildren(i) : on.managedOrchestrators(i)), o = e.status === "running" || e.status === "pending", s = e.presentation.spawnedSessionId, c = QD(a?.data, s), l = t !== null && (o || a?.status !== "error" && (a?.data === void 0 || s !== void 0 && c === void 0) || c?.status === "running"), u = qe(i, r && l), d = xt(i, !r && l), f = r ? u : d;
	return {
		records: f.data,
		failed: f.isError
	};
}
function eO(e) {
	let t = e.presentation.statusLabel;
	return e.status === "pending" ? {
		status: rd.Running,
		label: t
	} : e.status === "failed" ? {
		status: rd.Failed,
		label: t
	} : null;
}
function tO(e, t, n) {
	let r = QD(t, e.presentation.spawnedSessionId), i = eO(e);
	if (r) return {
		...i ?? VD(r.status),
		title: r.description.trim() || e.title,
		sessionId: ZD(r)
	};
	let { title: a } = e;
	return e.status === "running" ? {
		status: rd.Running,
		title: a,
		sessionId: null
	} : i ? {
		...i,
		title: a,
		sessionId: null
	} : t === void 0 || n ? {
		status: rd.Ready,
		title: a,
		sessionId: null
	} : {
		status: rd.NotFound,
		title: a,
		sessionId: null
	};
}
var nO = li(function({ entry: e, interactive: t }) {
	let { records: n, failed: r } = $D(e, YD()), i = tO(e, n, r), a = nh(), { openSubagent: o } = iy(), s = fn.session(i.sessionId ?? ""), c = Oi(s), l = ki(s), u = t && i.sessionId !== null ? e.rowKey : null;
	return /* @__PURE__ */ X(cd, {
		title: i.title,
		status: i.status,
		statusLabel: i.label,
		error: e.status === "failed" ? e.presentation.resultPreview : null,
		lineage: XD[e.action],
		showBehaviorIcon: a,
		onOpen: u ? () => o(u) : void 0,
		sessionHref: u ? c : null,
		onSessionLinkClick: l
	});
});
// src/app/components/inspector/ModelMessage.tsx
function rO(e) {
	return e.blocks.filter((e) => e.kind === "text").map((e) => e.text).join("\n\n").trim();
}
var iO = "Compacting context…";
function aO({ label: e }) {
	return /* @__PURE__ */ Z("div", {
		role: "status",
		children: [/* @__PURE__ */ X("span", {
			className: "sr-only",
			children: e
		}), /* @__PURE__ */ X("div", {
			inert: !0,
			className: "flex",
			children: /* @__PURE__ */ X(vd, {
				label: e,
				inProgress: !0
			})
		})]
	});
}
var oO = li(function({ turn: e, previous: t, date: n, model: r, active: i, activity: a, isLast: o = !1, selectedThreadEpisode: s, selectedGroupId: c = null, onSelectThread: l, userMessageIndex: d, userText: f = "", onRefresh: p = null, onRevert: m = null, onFork: h = null, forks: _ = [], onOpenFork: v, onDismissFork: y, actionsDisabled: b = !1, readOnly: x = !1, snapshotRevision: S = null, filesPanel: C = null, interactive: w = !0 }) {
	u("ModelMessage");
	let T = K(() => mw(e, t), [e, t]), D = i && a === iO, O = !x && p != null && d != null, k = !x && m != null && d != null, ee = e.messageIndex, A = rO(e), te = e.blocks.some((e) => e.kind === "text" && e.text.trim() === "[run cancelled by user]"), j = I("flex flex-col items-start gap-6 w-full max-w-full min-w-0 py-6", o && "min-h-[calc(70vh-316px)]");
	return i && T.length === 0 && !D ? /* @__PURE__ */ X("div", {
		className: j,
		children: /* @__PURE__ */ X("p", {
			role: "status",
			className: "label-small text-shimmer-primary",
			children: "Working…"
		})
	}) : /* @__PURE__ */ Z("div", {
		className: j,
		children: [
			r || n ? /* @__PURE__ */ Z("div", {
				className: "flex items-center gap-3 w-full min-w-0",
				children: [/* @__PURE__ */ X(Du, {
					className: "flex-1",
					children: r
				}), n ? /* @__PURE__ */ X("span", {
					className: "shrink-0 label-2xs text-basic-muted whitespace-nowrap",
					children: n
				}) : null]
			}) : null,
			/* @__PURE__ */ Z("div", {
				className: "flex flex-col items-start gap-6 w-full min-w-0 md:pl-2",
				children: [
					T.map((e, t) => {
						if (e.kind === "group") return /* @__PURE__ */ X(zD, {
							group: e.group,
							active: i,
							trailing: !D && t === T.length - 1,
							selected: e.id === c,
							interactive: w
						}, e.id);
						if (e.kind === "session") return /* @__PURE__ */ X(nO, {
							entry: e,
							interactive: w
						}, e.id);
						let { block: n } = e;
						return n.kind === "wave" ? /* @__PURE__ */ X(PD, {
							rows: n.rows,
							selected: s,
							onSelect: w ? l : void 0
						}, n.key) : n.text.trim() === "[run cancelled by user]" ? null : /* @__PURE__ */ X(qx, {
							streaming: i,
							className: "[&>:first-child]:!mt-0 [&>:last-child]:!mb-0",
							children: n.text
						}, n.key);
					}),
					D ? /* @__PURE__ */ X(aO, { label: iO }) : null,
					!i && S && C ? /* @__PURE__ */ X(vD, {
						revision: S,
						panel: C
					}) : null,
					te ? /* @__PURE__ */ X(Ja, {
						variant: Wa.Danger,
						title: "Run cancelled by user"
					}) : null
				]
			}),
			!x && _.length > 0 ? /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-2 w-full min-w-0 md:pl-2 [&>*]:shrink-0",
				children: _.map((e) => /* @__PURE__ */ X(Ll, {
					sessionId: e.session_id,
					title: e.title,
					deleted: e.deleted,
					onOpen: v ? () => v(e.session_id) : void 0,
					onDismiss: y && e.deleted ? () => y(e.session_id) : void 0
				}, e.session_id))
			}) : null,
			i ? null : /* @__PURE__ */ X("div", {
				className: "flex items-center w-full min-w-0",
				children: /* @__PURE__ */ Z("div", {
					className: "flex items-center gap-3 shrink-0",
					children: [
						O ? /* @__PURE__ */ X(E, {
							title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
							position: M.BottomRight,
							children: /* @__PURE__ */ X(z, {
								size: U.Small,
								variant: B.Ghost,
								content: g.Icon,
								"aria-label": "Regenerate from original prompt",
								disabled: b,
								onClick: () => p(d),
								children: /* @__PURE__ */ X(R, {
									iconName: H.Refresh,
									size: 16
								})
							})
						}) : null,
						k ? /* @__PURE__ */ X(E, {
							title: "Revert to this snapshot",
							position: M.BottomRight,
							children: /* @__PURE__ */ X(z, {
								size: U.Small,
								variant: B.Ghost,
								content: g.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: b,
								onClick: () => m(d, f),
								children: /* @__PURE__ */ X(R, {
									iconName: H.TurnLeft,
									size: 16
								})
							})
						}) : x ? null : /* @__PURE__ */ X(E, {
							title: "This message is not in the transcript yet",
							position: M.BottomRight,
							children: /* @__PURE__ */ X("span", {
								className: "inline-flex",
								children: /* @__PURE__ */ X(z, {
									size: U.Small,
									variant: B.Ghost,
									content: g.Icon,
									"aria-label": "Revert to this snapshot",
									disabled: !0,
									children: /* @__PURE__ */ X(R, {
										iconName: H.TurnLeft,
										size: 16
									})
								})
							})
						}),
						!x && h != null && ee != null ? /* @__PURE__ */ X(E, {
							title: "Create fork",
							position: M.BottomRight,
							children: /* @__PURE__ */ X(z, {
								size: U.Small,
								variant: B.Ghost,
								content: g.Icon,
								"aria-label": "Create fork",
								disabled: b,
								onClick: () => h(ee),
								children: /* @__PURE__ */ X(R, {
									iconName: H.Scheme,
									size: 16
								})
							})
						}) : null,
						/* @__PURE__ */ X(Yt, {
							value: A,
							size: U.Small,
							variant: B.Ghost,
							title: "Copy message",
							position: M.BottomRight
						})
					]
				})
			})
		]
	});
}), sO = li(function(e) {
	let t = qD(e.turn), n = JD(e.userMessageIndex), r = t && t.kind !== "model" ? t.createdAt : n;
	return /* @__PURE__ */ X(oO, {
		...e,
		previous: t,
		date: ID(r)
	});
}), cO = li(function({ text: e, terminalSelection: t, sessionId: n, pending: r = !1, invokedSkills: i = null, date: a, messageIndex: o, onRefresh: s = null, onRevert: c = null, actionsDisabled: l = !1, readOnly: d = !1 }) {
	u("UserMessage");
	let f = !d && s != null && o != null, p = !d && c != null && o != null;
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col items-end w-full max-w-full py-6",
		children: [
			a ? /* @__PURE__ */ X("span", {
				className: "max-w-full min-w-0 pb-2 label-2xs text-basic-muted whitespace-nowrap truncate",
				children: a
			}) : null,
			/* @__PURE__ */ X("div", {
				className: I("min-w-0 max-w-full p-5 rounded-[12px] bg-elevation-sublevel-variant-B shadow-convex", "label-small text-basic-primary whitespace-pre-wrap break-words", "transition-opacity duration-150", r && "opacity-60"),
				children: t ? /* @__PURE__ */ X(sy, {
					evidence: t,
					canonicalText: e,
					sessionId: n
				}) : e
			}),
			i && i.length > 0 ? /* @__PURE__ */ Z("div", {
				className: "flex items-center gap-1 pt-1.5 pr-1 label-micro text-basic-tertiary",
				title: "Skill content was expanded into the prompt sent to the agent",
				children: [/* @__PURE__ */ X(R, {
					iconName: H.Bolt,
					size: 12,
					color: "var(--color-fill-basic-tertiary)"
				}), /* @__PURE__ */ Z("span", { children: [
					i.length === 1 ? "Skill" : "Skills",
					" expanded:",
					" ",
					i.map((e) => `$${e}`).join(", ")
				] })]
			}) : null,
			/* @__PURE__ */ Z("div", {
				"aria-hidden": r || void 0,
				className: I("flex items-center justify-end gap-3 max-w-full min-w-0 pt-2", r && "invisible"),
				children: [
					f ? /* @__PURE__ */ X(E, {
						title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
						position: M.BottomLeft,
						children: /* @__PURE__ */ X(z, {
							size: U.Small,
							variant: B.Ghost,
							content: g.Icon,
							"aria-label": "Regenerate from original prompt",
							disabled: l,
							onClick: () => s(o),
							children: /* @__PURE__ */ X(R, {
								iconName: H.Refresh,
								size: 16
							})
						})
					}) : null,
					p ? /* @__PURE__ */ X(E, {
						title: "Revert to this snapshot",
						position: M.BottomLeft,
						children: /* @__PURE__ */ X(z, {
							size: U.Small,
							variant: B.Ghost,
							content: g.Icon,
							"aria-label": "Revert to this snapshot",
							disabled: l,
							onClick: () => c(o, e),
							children: /* @__PURE__ */ X(R, {
								iconName: H.TurnLeft,
								size: 16
							})
						})
					}) : d ? null : /* @__PURE__ */ X(E, {
						title: "This message is not in the transcript yet",
						position: M.BottomLeft,
						children: /* @__PURE__ */ X("span", {
							className: "inline-flex",
							children: /* @__PURE__ */ X(z, {
								size: U.Small,
								variant: B.Ghost,
								content: g.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: !0,
								children: /* @__PURE__ */ X(R, {
									iconName: H.TurnLeft,
									size: 16
								})
							})
						})
					}),
					/* @__PURE__ */ X(Yt, {
						value: e,
						size: U.Small,
						variant: B.Ghost,
						title: t ? "Copy canonical message" : "Copy message",
						position: M.BottomLeft
					})
				]
			})
		]
	});
}), lO = li(function({ timestamp: e, ...t }) {
	let n = JD(t.messageIndex);
	return /* @__PURE__ */ X(cO, {
		...t,
		date: ID(n) ?? e ?? null
	});
}), uO = {
	"coding-agent": {
		type: "Coding agent",
		lineage: "traditional-child",
		row: "child"
	},
	"nac-orchestrator": {
		type: "NAC orchestrator",
		lineage: "managed-orchestrator",
		row: "orchestrator"
	}
};
function dO({ turn: e, interactive: t = !0 }) {
	let { completion: n } = e, r = uO[n.kind], i = Tt(), a = nh(), { openSubagent: o } = iy(), s = fn.session(n.sessionId), c = Oi(s), l = ki(s), u = t && (i.orchestrationEnabled || n.kind === "coding-agent"), d = `${r.row}:${n.sessionId}`, { status: f, label: p } = VD(n.status);
	return /* @__PURE__ */ Z("div", {
		role: "status",
		"aria-label": `${r.type} ${n.status}`,
		className: "py-6 md:pl-2",
		children: [/* @__PURE__ */ X(cd, {
			title: n.description.trim() || r.type,
			status: f,
			statusLabel: p,
			lineage: r.lineage,
			showBehaviorIcon: a,
			onOpen: u ? () => o(d) : void 0,
			sessionHref: u ? c : null,
			onSessionLinkClick: l
		}), /* @__PURE__ */ Z("details", {
			className: "mt-2 w-[320px] max-w-full min-w-0 rounded-[4px] bg-elevation-level-1 p-3 text-xs text-basic-secondary",
			children: [/* @__PURE__ */ Z("summary", {
				className: "cursor-pointer rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]",
				children: [
					"Generation ",
					n.generation,
					" result"
				]
			}), /* @__PURE__ */ Z("div", {
				className: "mt-2 flex flex-col gap-2 whitespace-pre-wrap break-words",
				children: [
					n.outcome ? /* @__PURE__ */ X("p", { children: n.outcome }) : null,
					n.changes ? /* @__PURE__ */ Z("p", { children: ["Changes: ", n.changes] }) : null,
					n.verification ? /* @__PURE__ */ Z("p", { children: ["Verification: ", n.verification] }) : null,
					!n.outcome && !n.changes && !n.verification ? /* @__PURE__ */ X("p", { children: "No result details were retained." }) : null
				]
			})]
		})]
	});
}
// src/app/features/insights/transcript/ChildTranscriptScope.tsx
var fO = [], pO = () => {};
function mO({ sessionId: e, turns: t, children: n }) {
	let r = K(() => ({
		sessionId: e,
		turns: t
	}), [e, t]);
	return /* @__PURE__ */ X(oy, {
		sessionId: e,
		panels: fO,
		focusPanel: pO,
		children: /* @__PURE__ */ X(HD, {
			value: r,
			children: n
		})
	});
}
// src/app/hooks/useDelegatedPreviewStream.ts
var hO = 250, gO = {
	text: "",
	reasoning: "",
	running: !1
};
function _O(e) {
	let { subscribeToSessionEvents: t } = { subscribeToSessionEvents: V().events }, n = Si(), [r, i] = J(gO), [a, o] = J(e);
	return a !== e && (o(e), i(gO)), G(() => {
		if (!e || typeof EventSource > "u") return;
		let r = !1, a = !1, o = null, s = () => {
			clearTimeout(o ?? void 0), o = window.setTimeout(() => {
				o = null, !r && n.invalidateQueries({
					queryKey: on.sessionSnapshot(e),
					exact: !0
				});
			}, hO);
		}, c = t(e, {
			onEnvelope: (e) => {
				let t = e.event;
				switch (t.type) {
					case "transcript_appended":
					case "snapshot_saved":
						a = !0, s();
						return;
					case "run_started":
						a = !1, i({
							text: "",
							reasoning: "",
							running: !0
						}), s();
						return;
					case "run_completed":
						a = !0, i({
							text: t.response,
							reasoning: "",
							running: !1
						}), s();
						return;
					case "run_failed":
					case "run_cancelled":
						a = !0, i((e) => ({
							...e,
							running: !1
						})), s();
						return;
					case "transcript_reverted":
						a = !0, i(gO), s();
						return;
					default: return;
				}
			},
			onAssistantDelta: (e) => {
				if (e.thread_name) return;
				if (e.reset) {
					a = !1, i(gO);
					return;
				}
				let t = a;
				a = !1, i((n) => {
					let r = t ? gO : n;
					return {
						text: r.text + (e.text ?? ""),
						reasoning: r.reasoning + (e.reasoning ?? ""),
						running: !0
					};
				});
			},
			onReplayBoundary: s,
			onReplayGap: s,
			onLagged: s,
			onSequenceGap: s,
			onBackpressure: s
		});
		return () => {
			r = !0, c(), clearTimeout(o ?? void 0);
		};
	}, [
		n,
		e,
		t
	]), r;
}
// src/app/hooks/useStickToBottom.ts
var vO = 400, yO = 60, bO = 400, xO = 200, SO = 300, CO = 1, wO = 50, TO = 150, EO = /* @__PURE__ */ new Set([
	"ArrowUp",
	"ArrowDown",
	"PageUp",
	"PageDown",
	"Home",
	"End"
]);
function DO({ resetKey: e = null } = {}) {
	let t = q(null), n = q(null), [r, i] = J(!1), a = q(!0), o = q(!1), s = q(0), c = q(!1), l = q(null), u = q(null), d = q(null), f = q(!1), p = q(xO), m = q(0), h = q(null), g = W(() => {
		h.current !== null && (clearTimeout(h.current), h.current = null), c.current = !1, o.current = !0;
	}, []), _ = W(() => {
		h.current !== null && clearTimeout(h.current), h.current = window.setTimeout(() => {
			h.current = null, o.current = !1;
		}, wO);
	}, []), v = W(() => {
		let e = t.current;
		e && i(iS(e) > vO);
	}, []), y = W(() => {
		let e = u.current !== null;
		u.current?.abort(), u.current = null, d.current !== null && (cancelAnimationFrame(d.current), d.current = null), e && _();
	}, [_]), b = W((e) => {
		let n = t.current;
		if (!n || !a.current || (p.current = e, u.current)) return;
		v();
		let r = iS(n);
		if (r <= 0) return;
		let i = !f.current;
		if (f.current = !0, i || r > n.clientHeight * CO) {
			y(), g(), aS(n), v(), _();
			return;
		}
		let o = new AbortController();
		u.current = o, g(), oS(n, n.scrollHeight, e, o.signal).then((e) => {
			u.current === o && (u.current = null, _(), v(), p.current = xO);
		});
	}, [
		g,
		y,
		_,
		v
	]);
	return G(() => {
		let e = t.current;
		if (!e) return;
		let n = () => {
			c.current = !0, l.current !== null && clearTimeout(l.current), l.current = window.setTimeout(() => {
				c.current = !1, l.current = null;
			}, TO);
		}, r = () => {
			let t = iS(e), n = s.current, r = e.scrollHeight !== n;
			s.current = e.scrollHeight, r ? t <= 60 && (a.current = !0) : (!o.current || c.current) && (t > yO ? (a.current && y(), a.current = !1) : a.current = !0, v());
		}, i = (t) => {
			n();
			let r = iS(e);
			t.deltaY < 0 && r > yO ? (y(), a.current = !1, v()) : t.deltaY > 0 && r <= 60 && (a.current = !0);
		}, u = (t) => {
			let r = e.getBoundingClientRect();
			t.clientX >= r.left + e.clientWidth && n();
		}, d = (e) => {
			EO.has(e.key) && n();
		};
		return e.addEventListener("scroll", r, { passive: !0 }), e.addEventListener("wheel", i, { passive: !0 }), e.addEventListener("pointerdown", u, { passive: !0 }), e.addEventListener("touchmove", n, { passive: !0 }), e.addEventListener("keydown", d), r(), () => {
			e.removeEventListener("scroll", r), e.removeEventListener("wheel", i), e.removeEventListener("pointerdown", u), e.removeEventListener("touchmove", n), e.removeEventListener("keydown", d), l.current !== null && clearTimeout(l.current);
		};
	}, [y, v]), G(() => {
		let e = t.current, r = n.current;
		if (!e || !r) return;
		let i = () => {
			y(), g(), aS(e), v(), _();
		}, s = () => {
			b(p.current);
		}, c = () => {
			d.current === null && (d.current = requestAnimationFrame(() => {
				d.current = null, s();
			}));
		}, l = 0, x = new ResizeObserver(() => {
			let t = e.clientWidth, n = l !== 0 && t !== l;
			l = t;
			let o = r.offsetHeight, u = o - m.current, d = m.current > 0 && u < 0;
			if (m.current = o, n) a.current && i();
			else if (!f.current) s();
			else if (d) {
				if (!a.current || iS(e) <= 60) return;
				i();
			} else c();
		});
		x.observe(r);
		let S = new ResizeObserver(() => {
			a.current && (u.current || o.current || iS(e) <= 60 || i());
		});
		return S.observe(e), () => {
			x.disconnect(), S.disconnect(), y(), h.current !== null && (clearTimeout(h.current), h.current = null);
		};
	}, [
		g,
		y,
		_,
		b,
		v
	]), pi(() => {
		y(), a.current = !0, s.current = 0, m.current = 0;
		let e = t.current;
		e ? (f.current = !0, g(), aS(e), v(), _()) : f.current = !1;
	}, [
		e,
		g,
		y,
		_,
		v
	]), {
		scrollRef: t,
		contentRef: n,
		showJumpButton: r,
		jumpToLatest: W(() => {
			let e = t.current;
			e && (y(), a.current = !0, i(!1), g(), oS(e, e.scrollHeight, bO).then((t) => {
				_(), t || (a.current = iS(e) <= 60, v());
			}));
		}, [
			g,
			y,
			_,
			v
		]),
		followLatest: W((e = SO) => {
			f.current = !0, b(e);
		}, [b])
	};
}
// src/app/hooks/useMarkdownReady.ts
function OO() {
	let [e, t] = J(Gx);
	return G(() => {
		if (e) return;
		let n = !0;
		return Wx().finally(() => {
			n && t(!0);
		}), () => {
			n = !1;
		};
	}, [e]), e;
}
// src/app/hooks/useTranscriptReveal.ts
var kO = 1500;
function AO(e, t) {
	let n = OO(), [r, i] = J(null), a = q(null), o = q(!1), s = r === e, c = vi({
		queryKey: on.sessionRoot(e),
		predicate: () => !s
	});
	return G(() => {
		if (a.current !== e && (a.current = e, o.current = t), s || !t || !n) return;
		if (o.current) {
			let t = !1;
			return queueMicrotask(() => {
				t || i(e);
			}), () => {
				t = !0;
			};
		}
		if (c > 0) return;
		let r = 0, l = requestAnimationFrame(() => {
			r = requestAnimationFrame(() => i(e));
		});
		return () => {
			cancelAnimationFrame(l), cancelAnimationFrame(r);
		};
	}, [
		s,
		t,
		n,
		c,
		e
	]), G(() => {
		if (s || !t) return;
		let n = setTimeout(() => i(e), kO);
		return () => clearTimeout(n);
	}, [
		s,
		t,
		e
	]), s;
}
// src/app/components/inspector/SubagentPreview.tsx
function jO() {}
function MO(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function NO({ sessionId: e, title: t, fallbackText: n, icon: r, header: i = !0, onOpen: a }) {
	let o = N(), s = nh(), c = gn(e, { retry: !1 }), l = _O(e), u = Cr(e), d = c.data, f = !!d?.message_page?.has_older, p = d?.message_page?.start ?? 0, [m, h] = J(!1), [_, v] = J(e), y = q(!1);
	_ !== e && (v(e), h(!1));
	let b = l.running || !!d?.active_run, x = AO(e, !!d && (!f || m) || c.isError), { scrollRef: S, contentRef: C } = DO({ resetKey: e }), T = q(null);
	pi(() => {
		let e = T.current, t = S.current;
		e && t && (t.scrollTop = e.top + (t.scrollHeight - e.height), T.current = null);
	}, [S, p]);
	let E = u.mutateAsync;
	G(() => {
		y.current = !1;
	}, [e]), G(() => {
		if (!f || m || y.current) return;
		let e = S.current;
		e && (T.current = {
			height: e.scrollHeight,
			top: e.scrollTop
		}), y.current = !0;
		let t = !1;
		return E().then((e) => {
			!t && !e && h(!0);
		}).catch(() => {
			t || h(!0);
		}).finally(() => {
			y.current = !1;
		}), () => {
			t = !0;
		};
	}, [
		f,
		E,
		m,
		S,
		p
	]);
	let D = K(() => iw(d ?? null, {}, {}, []), [d]), O = b ? d?.active_run?.submitted_user_message : void 0, k = O ? qt(O.content) : "", ee = O ? w(O.content) : null, A = !!(k && MO(D) !== k), te = l.running && !d?.active_run && !!(l.text || l.reasoning), j = K(() => rw(D, {
		text: l.text,
		reasoning: l.reasoning
	}, A || te), [
		l.reasoning,
		l.text,
		A,
		D,
		te
	]), ne = j[j.length - 1], re = b && ne?.kind === "model" && (!A || ne.key === "model-streaming"), ie = b && !re, ae = A && ne?.key === "model-streaming", oe = d?.metadata.model ?? "", se = x ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
	return /* @__PURE__ */ Z("div", {
		className: "flex min-h-0 flex-1 flex-col",
		children: [i ? /* @__PURE__ */ Z("div", {
			className: "flex h-14 shrink-0 items-center gap-2 border-b border-muted px-4",
			children: [
				s ? /* @__PURE__ */ X(R, {
					iconName: r,
					size: 20,
					className: "shrink-0 text-basic-secondary"
				}) : null,
				/* @__PURE__ */ X("p", {
					className: I("header-sm min-w-0 flex-1 truncate", b ? "text-shimmer-basic" : "text-basic-primary"),
					children: t
				}),
				/* @__PURE__ */ Z(z, {
					size: U.Small,
					variant: B.Ghost,
					content: g.IconRight,
					"aria-label": "Open",
					onClick: a,
					children: ["Open", /* @__PURE__ */ X(R, { iconName: H.External })]
				})
			]
		}) : null, /* @__PURE__ */ Z("div", {
			className: "relative min-h-0 flex-1",
			children: [/* @__PURE__ */ X("div", {
				role: "status",
				"aria-label": x ? void 0 : "Loading conversation",
				className: I("pointer-events-none absolute inset-0 px-4 transition-opacity duration-150 ease-in-out", o ? "pt-18" : "pt-4", x ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ X(Qa, {
					rows: 3,
					rowClassName: "h-[48px]"
				})
			}), /* @__PURE__ */ X("div", {
				ref: S,
				className: I("h-full overflow-y-auto", se, !x && "invisible"),
				children: /* @__PURE__ */ X("div", {
					ref: C,
					className: I("flex flex-col px-4 pb-6 [&>*]:shrink-0", o ? "pt-16" : "pt-2"),
					children: /* @__PURE__ */ Z(mO, {
						sessionId: e,
						turns: D,
						children: [
							m && f ? /* @__PURE__ */ Z("div", {
								role: "alert",
								className: "mb-4 flex items-center gap-2",
								children: [/* @__PURE__ */ X("span", {
									className: "label-small text-basic-muted",
									children: "Couldn’t load older messages."
								}), /* @__PURE__ */ X(z, {
									size: U.Small,
									variant: B.Ghost,
									onClick: () => h(!1),
									children: "Try again"
								})]
							}) : null,
							j.map((e, t) => {
								if (e.kind === "delegated-completion") return /* @__PURE__ */ X(dO, {
									turn: e,
									interactive: !1
								}, e.key);
								if (e.kind === "user") return /* @__PURE__ */ X(lO, {
									text: e.text,
									invokedSkills: e.invokedSkills,
									messageIndex: e.messageIndex,
									readOnly: !0
								}, e.key);
								let n = t === j.length - 1, r = /* @__PURE__ */ X(sO, {
									turn: e,
									model: oe,
									active: b && n,
									isLast: !1,
									selectedThreadEpisode: null,
									selectedGroupId: null,
									onSelectThread: jO,
									readOnly: !0,
									interactive: !1
								}, e.key);
								return ae && e.key === "model-streaming" ? /* @__PURE__ */ Z(ai, { children: [/* @__PURE__ */ X(lO, {
									text: k,
									invokedSkills: ee,
									pending: !0,
									readOnly: !0
								}), r] }, e.key) : r;
							}),
							A && !ae ? /* @__PURE__ */ X(lO, {
								text: k,
								invokedSkills: ee,
								pending: !0,
								readOnly: !0
							}) : null,
							ie ? /* @__PURE__ */ X(sO, {
								turn: {
									kind: "model",
									key: "model-pending",
									blocks: [],
									durationMs: null,
									messageIndex: null
								},
								model: oe,
								active: !0,
								isLast: !1,
								selectedThreadEpisode: null,
								onSelectThread: jO,
								readOnly: !0,
								interactive: !1
							}) : null,
							j.length === 0 && !b && n ? /* @__PURE__ */ X("p", {
								className: "label-small py-4 text-basic-secondary",
								children: n
							}) : null
						]
					})
				})
			})]
		})]
	});
}
// src/app/components/inspector/DelegatedWorkView.tsx
var PO = {
	child: "traditional-child",
	orchestrator: "managed-orchestrator"
};
function FO(e) {
	return e?.trim() || null;
}
function IO(e) {
	return {
		key: `child:${e.child_session_id}`,
		mode: "child",
		id: e.child_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: FO(e.failure) ?? FO(e.report) ?? FO(e.change_summary) ?? FO(e.verification_summary)
	};
}
function LO(e) {
	return {
		key: `orchestrator:${e.orchestrator_session_id}`,
		mode: "orchestrator",
		id: e.orchestrator_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: FO(e.failure) ?? FO(e.report)
	};
}
function RO() {
	return /* @__PURE__ */ Z("div", {
		className: "flex min-h-0 flex-1 flex-col items-center justify-center px-4",
		children: [
			/* @__PURE__ */ X(R, {
				iconName: H.Plane,
				size: 32,
				className: "text-basic-primary"
			}),
			/* @__PURE__ */ X("p", {
				className: "label-big mt-2 text-center text-basic-primary",
				children: "No subagents yet"
			}),
			/* @__PURE__ */ X("p", {
				className: "label-small mt-2 max-w-[311px] text-center text-basic-tertiary",
				children: "Ask the agent to delegate work. Subagents it starts appear here, where you can browse, steer, continue, and cancel them."
			})
		]
	});
}
function zO({ sessionId: e, behavior: t }) {
	let { showSidePanelList: n, selectSubagent: r, useSelectedSubagent: i, useSidePanelExpanded: a, toggleSidePanelExpanded: o } = V().stores.sessionLayoutStore, s = N(), c = Se(), l = s || c, u = ji(), d = a(), f = Tt().orchestrationEnabled && t === "direct-with-orchestrator", p = nh(), m = qe(e, !0), h = xt(e, f), _ = Zn(), v = Jn(6e4), y = i(e), b = K(() => {
		let e = (m.data ?? []).map(IO), t = f ? (h.data ?? []).map(LO) : [];
		return [...e, ...t];
	}, [
		m.data,
		h.data,
		f
	]), x = [...b].sort((e, t) => t.updatedAt.localeCompare(e.updatedAt))[0]?.key ?? null, S = b.find((e) => e.key === y) ?? b.find((e) => e.key === x) ?? null;
	G(() => {
		y == null && x != null && r(e, x);
	}, [
		x,
		r,
		y,
		e
	]);
	let C = K(() => new Map((_.data ?? []).map((e) => [e.summary.session_id, e.summary])), [_.data]), w = (e) => FO(C.get(e.id)?.title) ?? e.description, T = K(() => zd(b, (e) => ({
		updatedAt: e.updatedAt,
		pinned: !!C.get(e.id)?.pinned
	}), v), [
		b,
		C,
		v
	]), E = (t) => {
		r(e, t), n(!1);
	}, D = b.length === 0 && (m.isError || f && h.isError), O = m.isSuccess && (!f || h.isSuccess), k = /* @__PURE__ */ Z("div", {
		role: "alert",
		className: "m-2 rounded-[6px] border border-error-primary p-3",
		children: [/* @__PURE__ */ X("div", {
			className: "text-small text-error-primary",
			children: "Subagents could not be loaded."
		}), /* @__PURE__ */ X(z, {
			className: "mt-2",
			size: U.Small,
			variant: B.Ghost,
			onClick: () => {
				m.refetch(), f && h.refetch();
			},
			children: "Try again"
		})]
	}), ee = D ? k : b.length === 0 && !O ? /* @__PURE__ */ X("p", {
		role: "status",
		className: "label-small m-auto text-basic-tertiary",
		children: "Loading subagents…"
	}) : null, A = /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-8",
		children: [ee, T.map((e) => /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ Z("div", {
				className: I("flex items-baseline gap-2", s ? "px-3" : "px-2"),
				children: [/* @__PURE__ */ X("span", {
					className: "tag-label shrink-0 text-basic-muted",
					children: e.label
				}), /* @__PURE__ */ X("span", { className: "h-px min-w-0 flex-1 bg-divider-muted" })]
			}), /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let t = w(e), n = C.get(e.id);
					return /* @__PURE__ */ X(Ua, {
						title: t,
						lineage: PO[e.mode],
						showBehaviorIcon: p,
						running: e.status === "running",
						active: S?.key === e.key,
						isMobile: s,
						onClick: () => E(e.key),
						actions: n ? /* @__PURE__ */ X(fD, {
							summary: n,
							title: t,
							isMobile: s
						}) : null
					}, e.key);
				})
			})]
		}, e.label))]
	}), te = (e) => {
		d && o(), u(fn.session(e));
	}, j = S ? s ? /* @__PURE__ */ Z(Zr, {
		variant: B.Ghost,
		content: g.IconRight,
		"aria-label": "Open",
		onClick: () => te(S.id),
		children: ["Open", /* @__PURE__ */ X(R, { iconName: H.External })]
	}) : c ? /* @__PURE__ */ Z(z, {
		size: U.Small,
		variant: B.Ghost,
		content: g.IconRight,
		"aria-label": "Open",
		onClick: () => te(S.id),
		children: ["Open", /* @__PURE__ */ X(R, { iconName: H.External })]
	}) : null : null;
	return /* @__PURE__ */ X(Rx, {
		listTitle: "Subagents",
		title: S ? /* @__PURE__ */ X("span", {
			className: I(c && "font-medium", S.status === "running" && "text-shimmer-basic"),
			children: w(S)
		}) : void 0,
		actions: j,
		listClassName: "py-6",
		list: s ? O && b.length === 0 ? /* @__PURE__ */ X(RO, {}) : /* @__PURE__ */ X("div", {
			className: "pt-6",
			children: A
		}) : c ? /* @__PURE__ */ X("div", {
			className: "-mx-1 -mt-2 py-6",
			children: A
		}) : A,
		children: /* @__PURE__ */ X("div", {
			className: "flex min-h-0 flex-1 flex-col",
			children: S ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(NO, {
				sessionId: S.id,
				title: w(S),
				fallbackText: S.fallbackText,
				icon: Ma(null, PO[S.mode]),
				header: !l,
				onOpen: () => te(S.id)
			}), /* @__PURE__ */ X("div", {
				className: "shrink-0 px-4 pt-4 pb-8",
				children: /* @__PURE__ */ X(lb, {
					parentSessionId: e,
					target: S,
					permissionSessionId: S.id,
					permissionBehavior: S.mode === "orchestrator" ? "orchestrator" : "direct",
					showPermissions: !1
				}, `${S.mode}:${S.id}`)
			})] }) : ee ? l ? ee : null : /* @__PURE__ */ X(RO, {})
		})
	});
}
// src/app/lib/revisions.ts
var BO = (e) => `Snapshot ${e}`, VO = (e, t) => t - e;
function HO(e, t) {
	let n = /* @__PURE__ */ new Map();
	if (!t?.length) return n;
	let r = t.filter((e) => e.transcript_len != null).sort((e, t) => e.transcript_len - t.transcript_len), i = 0;
	for (let t of e) {
		if (t.kind !== "model") continue;
		let e = t.messageIndex;
		if (e == null) continue;
		for (; i < r.length && r[i].transcript_len <= e;) i += 1;
		if (i >= r.length) break;
		let a = r[i];
		a.changed_files > 0 && n.set(e, a), i += 1;
	}
	return n;
}
// src/app/components/inspector/HistoryView.tsx
function UO({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ Z("button", {
		type: "button",
		className: I("flex items-start gap-2 w-full p-2 rounded-[8px] text-left", r ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": r,
		onClick: i,
		children: [
			/* @__PURE__ */ X(R, {
				iconName: r ? H.Check : H.History,
				size: 20,
				className: "shrink-0 mt-[2px]"
			}),
			/* @__PURE__ */ Z("span", {
				className: "flex-1 min-w-0 flex flex-col",
				children: [/* @__PURE__ */ X("span", {
					className: "label-medium text-basic-primary truncate",
					children: e
				}), t ? /* @__PURE__ */ X("span", {
					className: "label-small text-basic-muted truncate",
					children: t
				}) : null]
			}),
			n ? /* @__PURE__ */ X("span", {
				className: "shrink-0 flex items-center gap-1 code code-small mt-[6px]",
				children: n
			}) : null
		]
	});
}
function WO({ sessionId: e, selected: t, onSelect: n }) {
	let { data: r, isLoading: i, error: a } = dn(e), o = r ?? [];
	return a ? /* @__PURE__ */ X(Vx, { children: Vt(a) }) : /* @__PURE__ */ Z("div", {
		className: "flex flex-col flex-1 min-h-0 overflow-auto px-2 pt-16 pb-32 gap-1 bg-elevation-ground [&>*]:shrink-0",
		children: [
			/* @__PURE__ */ X(UO, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => n(null)
			}),
			i ? /* @__PURE__ */ Z("div", {
				className: "flex items-center gap-2 p-2 label-small text-basic-muted",
				children: [/* @__PURE__ */ X(ut, {
					size: bt.Small,
					variant: ie.Neutral
				}), "Reading snapshots…"]
			}) : null,
			o.map((e, r) => /* @__PURE__ */ X(UO, {
				title: `${BO(VO(r, o.length))} · ${Br(e.created_at)}`,
				subtitle: e.label.trim() || null,
				selected: e.id === t,
				trailing: e.additions || e.deletions ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ Z("span", {
					className: "text-success-primary",
					children: ["+", e.additions]
				}), /* @__PURE__ */ Z("span", {
					className: "text-error-primary",
					children: ["-", e.deletions]
				})] }) : null,
				onClick: () => n(e.id)
			}, e.id)),
			!i && o.length === 0 ? /* @__PURE__ */ X("div", {
				className: "p-2 label-small text-basic-muted",
				children: "No snapshots yet. One is taken every time a run finishes."
			}) : null
		]
	});
}
// src/app/components/inspector/WorksetsView.tsx
var GO = {
	done: "text-success-primary",
	completed: "text-success-primary",
	finished: "text-success-primary",
	active: "text-info-primary",
	running: "text-info-primary",
	in_progress: "text-info-primary",
	blocked: "text-error-primary",
	failed: "text-error-primary"
}, KO = (e) => GO[e.toLowerCase()] ?? "text-basic-secondary", qO = "code text-sm font-medium !leading-5 !tracking-normal", JO = "code text-xs font-medium !leading-4 !tracking-normal";
function YO({ children: e }) {
	return /* @__PURE__ */ X("span", {
		className: "tag-label text-basic-tertiary",
		children: e
	});
}
function XO({ label: e, children: t }) {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-1",
		children: [/* @__PURE__ */ X(YO, { children: e }), t]
	});
}
function ZO({ item: e }) {
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-4 p-3 rounded-[4px] bg-elevation-sublevel-variant-A shadow-concave",
		children: [
			e.role ? /* @__PURE__ */ X(ia, {
				text: e.role,
				color: na.Blue,
				className: "self-start"
			}) : null,
			/* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-1",
				children: [/* @__PURE__ */ X("span", {
					className: "header-sm text-basic-primary",
					children: e.title
				}), e.scope ? /* @__PURE__ */ X("span", {
					className: I(JO, "text-danger-primary break-words"),
					children: e.scope
				}) : null]
			}),
			e.description ? /* @__PURE__ */ X("p", {
				className: "text-small text-basic-secondary",
				children: e.description
			}) : null,
			e.acceptance ? /* @__PURE__ */ X(XO, {
				label: "acceptance",
				children: /* @__PURE__ */ X("p", {
					className: "text-small text-basic-secondary",
					children: e.acceptance
				})
			}) : null,
			e.depends_on.length > 0 ? /* @__PURE__ */ X(XO, {
				label: "depends_on",
				children: /* @__PURE__ */ X("span", {
					className: I(JO, "text-basic-secondary break-words"),
					children: e.depends_on.join(", ")
				})
			}) : null,
			e.notes ? /* @__PURE__ */ Z("div", {
				className: "flex items-start gap-1 text-info-secondary",
				children: [/* @__PURE__ */ X(R, {
					iconName: H.Info,
					size: 16,
					className: "shrink-0"
				}), /* @__PURE__ */ X("p", {
					className: "flex-1 min-w-0 text-micro",
					children: e.notes
				})]
			}) : null
		]
	});
}
function QO({ workset: e }) {
	let t = N();
	return /* @__PURE__ */ Z("div", {
		className: I("flex flex-col gap-8 flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", t && "py-18"),
		children: [/* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-4",
			children: [
				/* @__PURE__ */ X(XO, {
					label: "id",
					children: /* @__PURE__ */ X("span", {
						className: "header-md text-basic-primary break-words",
						children: e.id
					})
				}),
				e.goal ? /* @__PURE__ */ X(XO, {
					label: "goal",
					children: /* @__PURE__ */ X("p", {
						className: "text-medium text-basic-primary",
						children: e.goal
					})
				}) : null,
				e.status ? /* @__PURE__ */ X(XO, {
					label: "status",
					children: /* @__PURE__ */ X("span", {
						className: I(qO, KO(e.status)),
						children: e.status
					})
				}) : null,
				e.summary ? /* @__PURE__ */ X(XO, {
					label: "summary",
					children: /* @__PURE__ */ X("p", {
						className: "text-medium text-basic-primary",
						children: e.summary
					})
				}) : null,
				e.verification_recipe ? /* @__PURE__ */ X(XO, {
					label: "verification_recipe",
					children: /* @__PURE__ */ X("p", {
						className: "text-medium text-basic-primary whitespace-pre-wrap",
						children: e.verification_recipe
					})
				}) : null
			]
		}), e.items.length > 0 ? /* @__PURE__ */ Z("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ X(YO, { children: "workset_items" }), e.items.map((e) => /* @__PURE__ */ X(ZO, { item: e }, e.position))]
		}) : null]
	});
}
function $O({ snapshot: e, selected: t, onSelect: n }) {
	let r = N();
	if (!e) return /* @__PURE__ */ X(Bx, { listTitle: "Worksets" });
	let i = e.worksets;
	if (i.error) return /* @__PURE__ */ X(IE, {
		listTitle: "Worksets",
		children: i.error
	});
	let a = i.items.find((e) => e.id === t) ?? i.items[0] ?? null, o = r ? t : a?.id;
	return /* @__PURE__ */ X(Rx, {
		listTitle: "Worksets",
		title: a?.id,
		listClassName: "px-2",
		list: i.items.length === 0 ? /* @__PURE__ */ X(FE, { children: "No worksets defined for this session." }) : /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-1",
			children: i.items.map((e) => /* @__PURE__ */ X(zx, {
				label: e.id,
				active: e.id === o,
				trailing: r ? /* @__PURE__ */ X(R, {
					iconName: H.Right,
					size: 24,
					className: "shrink-0"
				}) : null,
				onClick: () => n(e.id)
			}, e.id))
		}),
		children: a ? /* @__PURE__ */ X(QO, { workset: a }) : /* @__PURE__ */ X(Vx, { children: "No worksets defined for this session." })
	});
}
// src/app/hooks/useSessionFetching.ts
var ek = 150, tk = 500;
function nk(e) {
	let t = vi({ queryKey: on.sessionRoot(e) }) > 0, [n, r] = J(!1), i = q(0);
	return G(() => {
		if (t) {
			if (n) return;
			let e = window.setTimeout(() => {
				i.current = Date.now(), r(!0);
			}, ek);
			return () => clearTimeout(e);
		}
		if (!n) return;
		let e = tk - (Date.now() - i.current), a = window.setTimeout(() => r(!1), Math.max(0, e));
		return () => clearTimeout(a);
	}, [t, n]), n;
}
// src/app/components/inspector/SessionSideBox.tsx
function rk({ sessionId: e }) {
	let t = nk(e);
	return /* @__PURE__ */ X(du, {
		active: t,
		className: "absolute bottom-[-1px] left-0 right-0 z-[1]"
	});
}
function ik(e, t, n) {
	let [r, i] = J(!0), [a, o] = J(n), s = q(0);
	return a !== n && (o(n), i(!0)), pi(() => {
		let n = e.current, a = t.current;
		if (!n || !a || typeof ResizeObserver > "u") return;
		let o = () => {
			r && (s.current = a.scrollWidth), i(s.current <= n.clientWidth);
		};
		o();
		let c = new ResizeObserver(o);
		return c.observe(n), () => c.disconnect();
	}, [
		e,
		t,
		r,
		n
	]), r;
}
function ak({ sessionId: e, snapshot: t, behavior: n, panel: r, onPanelChange: i }) {
	let { useSidePanelExpanded: a, useSelectedWorkset: o, useSelectedRevision: s, toggleSidePanelExpanded: c, toggleSidePanelCollapsed: l, showSidePanelList: u, selectWorkset: d, selectRevision: f } = V().stores.sessionLayoutStore, p = a(), m = N(), h = Se(), _ = o(), v = s(), y = n === void 0 ? t?.metadata.behavior ?? "orchestrator" : n, b = y === "direct" || y === "direct-with-orchestrator", x = y == null ? null : Ra(y, t?.lineage?.kind), S = x?.readOnly ?? !1, C = x?.widePanels ?? [], w = Tt(), T = C.includes("delegated"), D = qe(e, T), O = xt(e, T && y === "direct-with-orchestrator"), k = (D.data?.length ?? 0) + (w.orchestrationEnabled ? O.data?.length ?? 0 : 0), ee = q(null), A = q(null), te = ik(ee, A, `${C.join()}|${h}|${p}`), j = q(null), ne = q(p);
	G(() => {
		m || ne.current === p || (ne.current = p, j.current?.querySelector(`[data-panel-focus="${p ? "back" : "focus"}"]`)?.focus({ preventScroll: !0 }));
	}, [p, m]);
	let re = x == null ? null : C.includes(r) || m && x.mobilePanels.includes(r) ? r : x.defaultPanel, ie = /* @__PURE__ */ Z(Y, { children: [
		re === "insights" ? /* @__PURE__ */ X(wE, {
			sessionId: e,
			snapshot: t,
			topology: b ? "direct" : "orchestrator",
			canSteerWorkers: y === "orchestrator" && !S
		}) : null,
		re === "files" ? /* @__PURE__ */ X(uD, {
			sessionId: e,
			snapshot: t,
			revision: v,
			readOnly: S
		}) : null,
		re === "delegated" && b && !S ? /* @__PURE__ */ X(zO, {
			sessionId: e,
			behavior: y
		}) : null,
		re === "terminal" && b && !S ? /* @__PURE__ */ X(jx, { sessionId: e }) : null,
		re === "worksets" ? /* @__PURE__ */ X($O, {
			snapshot: t,
			selected: _,
			onSelect: d
		}) : null,
		re === "history" ? /* @__PURE__ */ X(WO, {
			sessionId: e,
			selected: v,
			onSelect: f
		}) : null
	] });
	if (m) return /* @__PURE__ */ X("div", {
		className: "flex flex-col flex-1 min-h-0 bg-elevation-ground",
		children: re === null ? /* @__PURE__ */ X(Lx, {
			title: Hn[r],
			bar: !0,
			children: /* @__PURE__ */ X("div", {
				className: "pt-14",
				children: /* @__PURE__ */ X(FE, { children: "The panels show once the session has loaded." })
			})
		}) : re === "terminal" || re === "history" ? /* @__PURE__ */ X(Lx, {
			title: Hn[re],
			bar: !0,
			children: re === "terminal" ? /* @__PURE__ */ X("div", {
				className: "flex flex-col flex-1 min-h-0 pt-14",
				children: ie
			}) : ie
		}) : ie
	});
	let ae = re === null ? Hn[r] : Hn[re];
	return /* @__PURE__ */ Z("div", {
		className: I("flex flex-col min-h-0 h-full overflow-hidden bg-elevation-ground", p ? null : "border-l border-tertiary"),
		children: [/* @__PURE__ */ Z("div", {
			ref: j,
			className: "relative flex items-center gap-2 px-2 py-2 shrink-0 border-b border-muted",
			children: [
				/* @__PURE__ */ X(rk, { sessionId: e }),
				p ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ Z(z, {
					size: U.Medium,
					variant: B.Ghost,
					content: g.IconLeft,
					className: "shrink-0",
					"data-panel-focus": "back",
					onClick: c,
					children: [/* @__PURE__ */ X(R, { iconName: H.Left }), "Back to chat"]
				}), /* @__PURE__ */ Z("h2", {
					className: "min-w-0 shrink truncate border-l border-muted pl-3",
					children: [
						/* @__PURE__ */ X("span", {
							className: "header-sm text-basic-primary",
							children: ae
						}),
						" ",
						/* @__PURE__ */ X("span", {
							className: "label-small text-basic-tertiary",
							children: "— focused"
						})
					]
				})] }) : /* @__PURE__ */ X(E, {
					title: "Hide panel",
					position: M.BottomRight,
					className: "shrink-0",
					children: /* @__PURE__ */ X(z, {
						size: U.Medium,
						variant: B.Ghost,
						content: g.Icon,
						"aria-label": "Hide panel",
						onClick: l,
						children: /* @__PURE__ */ X(R, { iconName: H.SidebarChevronRight })
					})
				}),
				/* @__PURE__ */ X("div", {
					ref: ee,
					className: "flex flex-1 min-w-0",
					children: /* @__PURE__ */ X("div", {
						ref: A,
						className: "flex min-w-0 items-center gap-2 mx-auto",
						role: "tablist",
						children: C.map((e) => {
							let n = re === e, r = Ab(e, k, t?.worksets?.items.length ?? 0), a = () => {
								u(!1), i(e);
							}, o = h && !p || !te, s = /* @__PURE__ */ X(Bl, {
								size: Rl.Medium,
								content: o ? zl.IconOnly : void 0,
								active: n,
								iconName: kb[e],
								role: "tab",
								"aria-selected": n,
								"aria-label": Hn[e],
								onClick: a,
								children: Hn[e]
							});
							return /* @__PURE__ */ Z("span", {
								className: "relative shrink-0",
								children: [o ? /* @__PURE__ */ X(E, {
									title: Hn[e],
									position: M.BottomCenter,
									children: s
								}) : s, r > 0 ? /* @__PURE__ */ X(Mb, {
									count: r,
									className: "top-0"
								}) : null]
							}, e);
						})
					})
				}),
				p ? null : /* @__PURE__ */ X(E, {
					title: "Focus panel",
					position: M.BottomLeft,
					className: "shrink-0",
					children: /* @__PURE__ */ X(z, {
						size: U.Medium,
						variant: B.Ghost,
						content: g.Icon,
						"aria-label": "Focus panel",
						"data-panel-focus": "focus",
						onClick: c,
						children: /* @__PURE__ */ X(R, { iconName: H.FullScreen })
					})
				})
			]
		}), /* @__PURE__ */ X("div", {
			className: "flex-1 min-h-0 flex flex-col",
			children: ie
		})]
	});
}
// src/app/features/human-shell/CommandCard.tsx
function ok({ sessionId: e, command: t, readOnly: n = !1 }) {
	let { draftPrompt: r } = V().stores.composerStore, [i, a] = J(!1), [o, s] = J(0), c = _y(e, t.request_id, o, i), l = gy(e), u = t.state === "accepted" || t.state === "started";
	return /* @__PURE__ */ Z("article", {
		"aria-label": "User command",
		className: "my-3 rounded-xl border border-border-primary bg-bg-elevation-level-1 p-4",
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex flex-wrap items-center justify-between gap-2 text-sm",
				children: [/* @__PURE__ */ X("strong", { children: "Run by you" }), /* @__PURE__ */ Z("span", {
					role: "status",
					children: [t.state.replaceAll("_", " "), t.exit_code == null ? "" : ` · exit ${t.exit_code}`]
				})]
			}),
			/* @__PURE__ */ X("pre", {
				className: "mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm",
				children: `!${t.command}`
			}),
			t.stdout ? /* @__PURE__ */ X("pre", {
				className: "mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm",
				children: t.stdout
			}) : null,
			t.stderr ? /* @__PURE__ */ X("pre", {
				className: "mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm",
				children: t.stderr
			}) : null,
			t.diagnostic ? /* @__PURE__ */ X("p", {
				className: "mt-2 text-sm",
				children: t.diagnostic
			}) : null,
			/* @__PURE__ */ Z("div", {
				className: "mt-3 flex flex-wrap gap-4 text-sm",
				children: [
					u && !n ? /* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						variant: B.Ghost,
						disabled: l.isPending,
						onClick: () => l.mutate(t.request_id),
						children: "Cancel command"
					}) : null,
					!u && t.output_id ? /* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						variant: B.Ghost,
						onClick: () => a((e) => !e),
						children: i ? "Hide output" : "Full output"
					}) : null,
					!u && !n ? /* @__PURE__ */ X(z, {
						type: "button",
						size: U.Small,
						variant: B.Ghost,
						onClick: () => r(e, `Explain the result of my command ${t.request_id}:\n!${t.command}`),
						children: "Ask about this"
					}) : null
				]
			}),
			l.error ? /* @__PURE__ */ X("p", {
				role: "alert",
				children: "Unable to cancel this command."
			}) : null,
			i ? /* @__PURE__ */ Z("div", {
				className: "mt-3",
				children: [
					c.isPending ? /* @__PURE__ */ X("p", { children: "Loading output…" }) : null,
					c.error ? /* @__PURE__ */ X("p", {
						role: "status",
						children: "Full output is no longer retained."
					}) : null,
					c.data ? /* @__PURE__ */ Z(Y, { children: [
						c.data.overflowed ? /* @__PURE__ */ X("p", { children: "Only retained output is available." }) : null,
						/* @__PURE__ */ X("pre", {
							className: "overflow-x-auto whitespace-pre-wrap break-words text-sm",
							children: c.data.content
						}),
						/* @__PURE__ */ Z("div", {
							className: "mt-2 flex gap-4",
							children: [o > 0 ? /* @__PURE__ */ X(z, {
								type: "button",
								size: U.Small,
								variant: B.Ghost,
								onClick: () => s(0),
								children: "Start"
							}) : null, c.data.eof ? null : /* @__PURE__ */ X(z, {
								type: "button",
								size: U.Small,
								variant: B.Ghost,
								onClick: () => s(c.data.next_offset),
								children: "Next page"
							})]
						})
					] }) : null
				]
			}) : null
		]
	});
}
// src/app/components/inspector/InitialPrompts.tsx
var sk = [
	{
		icon: H.FolderOpen,
		title: "Explore this repository",
		prompt: "Understand the project structure, key components, and how they work together."
	},
	{
		icon: H.Eye,
		title: "Review current changes",
		prompt: "Review the working tree for bugs, regressions, and opportunities to simplify the code."
	},
	{
		icon: H.SearchPage,
		title: "Find something to improve",
		prompt: "Identify one meaningful improvement, explain its impact, and propose an implementation plan."
	},
	{
		icon: H.Bolt,
		title: "Help me get started",
		prompt: "Read the project documentation and suggest the best first task based on the current repository state"
	}
];
function ck() {
	let { sendPrompt: e } = V().stores.composerStore;
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-1 flex-col justify-center gap-2",
		children: [/* @__PURE__ */ X("p", {
			className: "text-[10px] leading-[12px] font-medium uppercase text-input-placeholder",
			children: "Get started"
		}), /* @__PURE__ */ X("div", {
			className: "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]",
			children: sk.map((t) => /* @__PURE__ */ X(Vl, {
				icon: t.icon,
				title: t.title,
				description: t.prompt,
				onClick: () => e(t.prompt)
			}, t.title))
		})]
	});
}
// src/app/components/inspector/transcript/JumpToLatest.tsx
var lk = li(function({ visible: e, onJump: t }) {
	return /* @__PURE__ */ X("div", {
		className: `absolute z-[2] left-1/2 bottom-0 -translate-x-1/2 rounded-full  transition-all duration-150 ease-out ${e ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-75 opacity-0 pointer-events-none"}`,
		children: /* @__PURE__ */ Z(z, {
			variant: B.Primary,
			size: U.Small,
			content: g.IconRight,
			className: "!rounded-b-none !shadow-3xl",
			onClick: t,
			children: ["Last messages", /* @__PURE__ */ X(R, { iconName: H.Down })]
		})
	});
}), uk = 1e4;
function dk(e, t) {
	let n = e ? Ar(e) : null, r = t !== null && n !== null, i = _n(r, r ? uk : !1), a = i.data?.providers.find((e) => e.provider === n), o = a?.signed_in ? `${a.expires_at_ms ?? ""}:${a.account ?? ""}` : null, s = $e(a?.backend ?? null, r ? t : null, o);
	return !r || i.isError || i.data != null && o === null || s.isError ? "unusable" : s.isSuccess ? "usable" : "unknown";
}
// src/app/lib/runFailure.ts
function fk(e, t, n, r) {
	return e.recovery_action === "resume_goal" ? t?.status === "blocked" ? "resume_goal" : null : e.recovery_action === "settings" ? !r || e.kind !== "authentication" ? "settings" : r === "checking" ? null : r === "needed" ? "sign_in" : t?.status === "blocked" ? "resume_goal" : n ? "regenerate" : null : e.recovery_action === "regenerate_with_rewind" && n ? "regenerate" : null;
}
// src/app/components/inspector/RunFailureRecovery.tsx
var pk = {
	unusable: "needed",
	usable: "restored"
};
function mk({ failure: e, goal: t, backend: n, onResumeGoal: r, onOpenSettings: i, onRegenerate: a }) {
	let o = n !== null && Ar(n) !== null, s = e.kind === "authentication" ? `${e.summary}\n${e.diagnostic}` : null, c = dk(n, s), [l, u] = J(), d = c === "unknown" ? null : pk[c];
	d && (l?.refusal !== s || l.login !== d) && u({
		refusal: s,
		login: d
	});
	let f = d ?? (l?.refusal === s ? l.login : "checking"), p = fk(e, t, a !== null, o ? f : void 0);
	return /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(hk, {
		failure: e,
		goal: t,
		action: p === "resume_goal" ? {
			label: "Resume goal",
			onClick: r
		} : p === "settings" ? {
			label: "Open settings",
			onClick: i
		} : p === "regenerate" && a ? {
			label: "Regenerate from original prompt",
			onClick: a
		} : void 0
	}), p === "sign_in" && n && Qt(n) ? /* @__PURE__ */ X(Bf, {
		backend: n,
		className: "mt-2",
		rejected: !0
	}) : null] });
}
function hk({ failure: e, goal: t, action: n }) {
	let r = e.recovery_action === "automatic_retry" && t?.status === "active", i = e.recovery_action === "resume_goal" && t?.status === "blocked", a = e.kind === "capacity", o = !!(e.partial_output?.text || e.partial_output?.reasoning || e.partial_output?.tool_call), s = a ? e.summary : r ? "Goal retry scheduled" : i ? "Goal stopped after repeated run failures" : o ? "Run stopped after a partial response" : e.summary, c = t?.next_attempt_at_epoch_ms ? new Date(t.next_attempt_at_epoch_ms).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit"
	}) : null, l = a ? "" : `${e.summary} `, u = r ? `${l}The durable goal and its usage were preserved. NAC will continue automatically${c ? ` at ${c}` : ""}.` : i ? `${l}The durable goal and its usage were preserved. Resume it when you want another bounded retry sequence.` : a ? `Retrying later may be necessary.${gk(e.retry_after_ms)}` : e.summary;
	return /* @__PURE__ */ Z(Ja, {
		role: r ? "status" : "alert",
		variant: r ? Wa.Info : Wa.Danger,
		title: s,
		action: n,
		children: [/* @__PURE__ */ X("span", { children: u }), /* @__PURE__ */ Z("details", {
			className: "mt-2",
			children: [/* @__PURE__ */ X("summary", {
				className: "cursor-pointer",
				children: "Diagnostics"
			}), /* @__PURE__ */ X("pre", {
				className: "mt-1 whitespace-pre-wrap break-words font-mono text-xs",
				children: e.diagnostic
			})]
		})]
	});
}
function gk(e) {
	if (e == null) return "";
	if (e >= 6e4 && e % 6e4 == 0) {
		let t = e / 6e4;
		return ` The provider asked NAC to wait at least ${t} ${t === 1 ? "minute" : "minutes"} before retrying.`;
	}
	if (e >= 1e3 && e % 1e3 == 0) {
		let t = e / 1e3;
		return ` The provider asked NAC to wait at least ${t} ${t === 1 ? "second" : "seconds"} before retrying.`;
	}
	return ` The provider asked NAC to wait at least ${e} milliseconds before retrying.`;
}
// src/app/hooks/useAuthErrorSuppressed.ts
function _k(e, t) {
	let n = t != null && tf(t, e).fix?.kind === "login", r = dk(e, n ? vk(t) : null);
	return n && r !== "unusable";
}
function vk(e) {
	return e instanceof Error ? e.message : typeof e == "string" ? e : String(e.status);
}
// src/app/hooks/useErrorNotice.ts
function yk(e, t) {
	let n = Bm(), { start: r } = Lf(), i = t ? Ar(t) : null;
	return W((a, o) => {
		let { title: s, description: c, fix: l } = tf(a, t);
		return {
			title: s,
			description: c,
			action: bk(l, {
				login: i ? () => void r(i) : null,
				settings: e ? () => n.settings(e) : null,
				retry: o ?? null
			})
		};
	}, [
		n,
		t,
		i,
		e,
		r
	]);
}
function bk(e, t) {
	if (e) switch (e.kind) {
		case "login": return t.login ? {
			label: e.label,
			onClick: t.login
		} : void 0;
		case "settings": return t.settings ? {
			label: e.label,
			onClick: t.settings
		} : void 0;
		case "retry": return t.retry ? {
			label: e.label,
			onClick: t.retry
		} : void 0;
		case "link": return e.url === void 0 ? void 0 : {
			label: e.label,
			onClick: () => window.open(e.url, "_blank", "noopener,noreferrer")
		};
	}
}
// src/app/components/modals/RevertModal.tsx
var xk = li(function({ open: e, onClose: t, sessionId: n, messageIdx: r, prompt: i }) {
	let a = nr(), o = Nr();
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: t,
		title: "Revert to this snapshot",
		size: Tn.Small,
		footer: /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(z, {
			variant: B.Ghost,
			size: U.Large,
			content: g.Text,
			onClick: t,
			disabled: o.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ X(z, {
			variant: B.SecondaryDestructive,
			size: U.Large,
			content: g.Text,
			onClick: async () => {
				if (!(r == null || o.isPending)) try {
					let e = await o.mutateAsync({
						id: n,
						messageIdx: r
					});
					a.success(e.workspace_restored ? "Reverted to this snapshot" : "Transcript reverted; no workspace snapshot covered this point"), t();
				} catch (e) {
					a.error(`Failed to revert: ${Vt(Ud(e))}`);
				}
			},
			loading: o.isPending,
			children: "Revert"
		})] }),
		children: /* @__PURE__ */ Z("p", { children: [
			"This removes ",
			/* @__PURE__ */ Z("span", {
				className: "text-basic-primary",
				children: [
					"\"",
					i,
					"\""
				]
			}),
			" and everything after it from the conversation, and restores the files to how they were when it was sent. This action cannot be undone."
		] })
	});
}), Sk = li(function({ warning: e }) {
	return e ? /* @__PURE__ */ X(Ja, {
		role: "status",
		variant: Wa.Info,
		title: "Session recovered",
		children: e
	}) : null;
});
function Ck(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n?.kind === "delegated-completion") return null;
		if (n?.kind === "user" && !n.pending) return t;
	}
	return null;
}
var wk = [];
function Tk({ sessionId: e, snapshot: t, panel: n, onFocusPanel: i, errorNotice: a = null }) {
	let { useModelRetryAttempt: o, useRunFailure: s, useRunError: c, useCancelArmed: l, useActivity: d, setOptimisticUserPrompt: f, pushLocalEvent: p } = V().stores.runtimeStore, { useSelectedThreadEpisode: m, useSelectedInsight: h, useSelectedRevision: _, useSelectedFile: v, selectRevision: y, selectFile: b } = V().stores.sessionLayoutStore, x = l(e), S = d(), C = c(), w = s(), T = o(), E = h(), D = m(), O = E?.kind === "thread" ? D : null, k = E?.kind === "group" ? E.groupId : null, ee = v(), A = _(), te = nr(), j = Bm(), ne = ji(), re = t?.metadata.backend ?? null, ie = yk(e, re), ae = _k(re, C), oe = Rr(), se = Kn(), ce = or(), M = Gt(), le = Cr(e), { data: ue } = dn(e), de = t?.metadata.behavior === "direct" || t?.metadata.behavior === "direct-with-orchestrator", fe = ve(e, de).data, pe = r(), { scrollRef: P, contentRef: me, showJumpButton: F, jumpToLatest: he, followLatest: ge } = DO({ resetKey: e }), _e = q(null), L = q(!1), R = q(!1), ye = t?.message_page?.start ?? 0;
	pi(() => {
		let e = _e.current, t = P.current;
		e && t && (t.scrollTop = e.top + (t.scrollHeight - e.height), _e.current = null);
	}, [ye, P]);
	let be = W(() => {
		let e = P.current;
		e && (_e.current = {
			height: e.scrollHeight,
			top: e.scrollTop
		}), le.mutateAsync().then((e) => {
			e || (_e.current = null);
		}).catch(() => {
			_e.current = null;
		});
	}, [le, P]);
	u("Transcript");
	let { turns: xe, baseTurns: Se, running: Ce, optimisticPrompt: we, submitted: Te, showPending: Ee, replyKey: De } = xS();
	pi(() => {
		L.current = !1, R.current = !1;
	}, [e]), G(() => {
		R.current = !0;
	}, [e]), pi(() => {
		let e = Ee && !L.current;
		L.current = Ee, e && R.current && ge(300);
	}, [Ee, ge]);
	let Oe = K(() => Ck(Se), [Se]), ke = Ce || x || oe.isPending || se.isPending || ce.isPending, [Ae, je] = J(null), Me = W(() => je(null), []), Ne = se.mutateAsync, Pe = W((t) => {
		ke || (async () => {
			try {
				let n = await Ne({
					id: e,
					messageIdx: t
				});
				p("run", `▶ regenerated: ${n.display_prompt.slice(0, 80)}`);
			} catch (e) {
				p("error", `regeneration failed: ${Vt(Ud(e))}`, !0), te.error(`Failed to regenerate: ${nf(Ud(e), re)}`);
			}
		})();
	}, [
		ke,
		re,
		p,
		Ne,
		e,
		te
	]), Fe = ce.mutateAsync, Ie = W((t) => {
		ke || (async () => {
			try {
				let n = await Fe({
					id: e,
					messageIdx: t
				});
				ne(fn.session(n.session_id));
			} catch (e) {
				te.error(`Failed to create fork: ${nf(Ud(e), re)}`);
			}
		})();
	}, [
		ke,
		re,
		Fe,
		ne,
		e,
		te
	]), Le = W((e) => {
		ne(fn.session(e));
	}, [ne]), Re = M.mutate, ze = W((t) => {
		Re({
			id: e,
			forkId: t
		}, { onError: (e) => {
			te.error(`Failed to dismiss fork: ${nf(Ud(e), re)}`);
		} });
	}, [
		re,
		Re,
		e,
		te
	]), Be = W((e, t) => {
		je({
			messageIdx: e,
			prompt: t
		});
	}, []), Ve = N(), He = t?.metadata.model ?? "", Ue = t?.lineage != null, We = K(() => HO(Se, ue), [Se, ue]), Ge = K(() => {
		let e = /* @__PURE__ */ new Map();
		for (let n of t?.forks ?? []) e.set(n.source_message_idx, [...e.get(n.source_message_idx) ?? [], n]);
		return e;
	}, [t?.forks]);
	G(() => {
		!Ee && we && f(null, "committed");
	}, [
		Ee,
		we,
		f
	]);
	let Ke = xe[xe.length - 1], qe = (Ce || Ee) && Ke?.key !== De && !(Ce && Ke?.kind === "model"), Je = K(() => ({
		kind: "model",
		key: De,
		blocks: wk,
		durationMs: null,
		messageIndex: null
	}), [De]), Ye = qe ? [...xe, Je] : xe, { openThread: Xe } = iy(), Ze = W((e) => {
		y(e), i("files");
	}, [i, y]), Qe = W((e, t) => {
		y(e), b(t), i("files");
	}, [
		i,
		b,
		y
	]), $e = K(() => ({
		sessionId: e,
		selectedFile: n === "files" ? ee : null,
		selectedRevision: n === "files" ? A : null,
		onOpenFile: Qe,
		onOpenPanel: Ze
	}), [
		e,
		n,
		ee,
		A,
		Qe,
		Ze
	]), et = !(!t || xe.length !== 0 || Ce || Ee), tt = C && !Ce ? C : null, nt = Ce ? null : w ?? t?.run_failure ?? fe?.last_failure ?? null, rt = [...xe].reverse().find((e) => e.kind === "user" && !e.pending), it = () => {
		fe && pe.mutateAsync({
			sessionId: e,
			goalId: fe.goal_id,
			payload: {
				expected_version: fe.version,
				status: "active"
			}
		}).catch((e) => te.error(`Failed to resume goal: ${nf(Ud(e), re)}`));
	}, at = nt ? null : a ?? (tt && !ae ? ie(tt) : null), ot = AO(e, !!t || a !== null), st = ot ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
	return /* @__PURE__ */ Z("div", {
		className: "relative flex-1 min-h-0",
		children: [
			/* @__PURE__ */ X("div", {
				role: "status",
				"aria-label": ot ? void 0 : "Loading conversation",
				className: I("pointer-events-none absolute inset-x-0 top-[72px] px-4 transition-opacity duration-150 ease-in-out md:top-[90px] md:px-8", ot ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ X("div", {
					className: "mx-auto w-full max-w-[640px]",
					children: /* @__PURE__ */ X(Qa, {
						rows: 3,
						rowClassName: "h-[48px]"
					})
				})
			}),
			et ? /* @__PURE__ */ X("div", {
				className: I("absolute inset-x-0 top-[72px] flex overflow-auto px-4 md:top-[90px] md:px-8", Ve ? "bottom-[128px]" : "bottom-[136px]", st),
				children: /* @__PURE__ */ X("div", {
					className: "m-auto w-full max-w-[640px]",
					children: /* @__PURE__ */ X(ck, {})
				})
			}) : null,
			/* @__PURE__ */ X("div", {
				ref: P,
				className: I("h-full overflow-auto", st, !ot && "invisible"),
				children: /* @__PURE__ */ Z("div", {
					ref: me,
					className: I("flex flex-col pt-[72px] md:pt-[90px] [&>*]:shrink-0 px-4 md:px-8", Ve ? "pb-[max(180px,calc(var(--composer-height,0px)_+_40px))]" : "pb-[max(320px,calc(var(--composer-height,0px)_+_40px))] mx-auto max-w-[704px]"),
					children: [
						t?.message_page?.has_older ? /* @__PURE__ */ Z("div", {
							className: "mb-4 flex flex-col items-start gap-2",
							children: [/* @__PURE__ */ X(z, {
								variant: B.Ghost,
								size: U.Small,
								content: g.Text,
								disabled: le.isPending,
								onClick: be,
								children: le.isPending ? "Loading…" : "Load older"
							}), le.isError ? /* @__PURE__ */ Z("div", {
								role: "alert",
								className: "flex items-center gap-2 text-basic-muted label-small",
								children: [/* @__PURE__ */ X("span", { children: "Couldn’t load older messages." }), /* @__PURE__ */ X(z, {
									variant: B.Ghost,
									size: U.Small,
									content: g.Text,
									onClick: be,
									children: "Try again"
								})]
							}) : null]
						}) : null,
						/* @__PURE__ */ X(wr, {
							id: "turns",
							children: Ye.map((r, i) => {
								if (r.kind === "delegated-completion") return /* @__PURE__ */ X(dO, { turn: r }, r.key);
								if (r.kind === "user") {
									let n = (t?.shell_commands ?? []).find((e) => e.transcript_index === r.messageIndex && r.text.startsWith("<human_shell_result>\n") && r.text.includes(`"operation_id":"${e.operation_id}"`));
									return n ? /* @__PURE__ */ X(ok, {
										sessionId: e,
										command: n,
										readOnly: Ue
									}, r.key) : /* @__PURE__ */ X(lO, {
										text: r.text,
										sessionId: e,
										pending: r.pending,
										terminalSelection: (r.pending ? Te?.terminal_selection : t?.terminal_selection_attributions?.find((e) => e.message_index === r.messageIndex)?.evidence) ?? void 0,
										invokedSkills: r.invokedSkills,
										timestamp: r.createdAt ? Br(r.createdAt) : null,
										messageIndex: r.pending ? void 0 : r.messageIndex,
										actionsDisabled: ke,
										readOnly: Ue,
										onRefresh: !Ue && Oe === i ? Pe : null,
										onRevert: Ue ? null : Be
									}, r.key);
								}
								let a = null, o = null;
								for (let e = i - 1; e >= 0; --e) {
									let t = Ye[e];
									if (t?.kind === "delegated-completion") break;
									if (t?.kind === "user") {
										a = e, o = t;
										break;
									}
								}
								let s = i === Ye.length - 1;
								return /* @__PURE__ */ X(sO, {
									turn: r,
									model: He,
									active: (Ce || r === Je) && s,
									isLast: s,
									activity: Ce && s ? S : void 0,
									selectedThreadEpisode: n === "insights" ? O : null,
									selectedGroupId: n === "insights" ? k : null,
									onSelectThread: Xe,
									userMessageIndex: o?.pending ? void 0 : o?.messageIndex,
									userText: o?.text,
									actionsDisabled: ke,
									readOnly: Ue,
									onRefresh: !Ue && a != null && Oe === a ? Pe : null,
									onRevert: Ue ? null : Be,
									onFork: Ue ? null : Ie,
									forks: Ue || r.messageIndex == null ? void 0 : Ge.get(r.messageIndex),
									onOpenFork: Le,
									onDismissFork: ze,
									snapshotRevision: r.messageIndex == null ? null : We.get(r.messageIndex) ?? null,
									filesPanel: $e
								}, r.key);
							})
						}),
						at ? /* @__PURE__ */ X(Ja, {
							role: "alert",
							variant: Wa.Error,
							title: at.title,
							action: at.action,
							children: at.description
						}) : null,
						Ce && T ? /* @__PURE__ */ X(Ja, {
							role: "status",
							variant: Wa.Info,
							title: `Connection interrupted; retrying model response (attempt ${T})`,
							children: "The abandoned partial stream was cleared before this attempt began."
						}) : null,
						nt ? /* @__PURE__ */ X(mk, {
							failure: nt,
							goal: fe,
							backend: re,
							onResumeGoal: it,
							onOpenSettings: () => j.settings(e),
							onRegenerate: rt?.kind === "user" ? () => Pe(rt.messageIndex) : null
						}) : null,
						(t?.shell_commands ?? []).filter((e) => e.state === "accepted" || e.state === "started").map((t) => /* @__PURE__ */ X(ok, {
							sessionId: e,
							command: t,
							readOnly: Ue
						}, t.operation_id)),
						/* @__PURE__ */ X(Sk, { warning: t?.transcript_recovery_warning })
					]
				})
			}),
			/* @__PURE__ */ X(lk, {
				visible: F,
				onJump: he
			}),
			/* @__PURE__ */ X(xk, {
				open: Ae !== null,
				onClose: Me,
				sessionId: e,
				messageIdx: Ae?.messageIdx ?? null,
				prompt: Ae?.prompt ?? ""
			})
		]
	});
}
// src/app/components/inspector/transcript/turnKeys.ts
function Ek({ turns: e, windowStart: t }) {
	let n = [], r = t;
	for (let t of e) t.messageIndex != null && (t.kind === "model" && n.push({
		from: r,
		to: t.messageIndex,
		key: t.key
	}), r = t.messageIndex + 1);
	return n;
}
function Dk(e, t, n) {
	let r = n ? Ek(n) : [], i = /* @__PURE__ */ new Set(), a = 0, o = t;
	return e.map((e) => {
		if (e.messageIndex == null) return e;
		let t = o;
		if (o = e.messageIndex + 1, e.kind !== "model") return e;
		for (; a < r.length && r[a].to < t;) a += 1;
		let n = r[a], s = n && n.from <= e.messageIndex && !i.has(n.key) ? n.key : `model-${t}`;
		return i.has(s) && (s = `model-${t}-${e.messageIndex}`), i.add(s), s === e.key ? e : {
			...e,
			key: s
		};
	});
}
function Ok(e, t) {
	return `model-${(e[e.length - 1]?.messageIndex ?? t - 1) + 1}`;
}
// src/app/components/inspector/transcript/useTranscriptModel.ts
function kk(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function Ak(e) {
	for (let t = e.length - 1; t >= 0; --t) if (e[t].kind === "user") return t;
	return -1;
}
function jk(e, t) {
	let { useStreamText: n, useStreamReasoning: r, useRunning: i, useOptimisticUserPrompt: a, useLiveThreads: o, usePrimaryToolEvents: s, useFinishedToolCalls: c, runtimeStore: l } = V().stores.runtimeStore, u = i(e), d = o(), f = c(), p = s(), m = n(), h = r(), g = l.useStore((e) => e.streamSettled), _ = l.useStore((e) => e.streamPredatesPrompt), v = a(), y = t?.metadata.behavior === "direct" || t?.metadata.behavior === "direct-with-orchestrator", { data: b } = he(e, y), x = K(() => new Set((b?.requests ?? []).map((e) => e.call_id).filter((e) => !!e)), [b?.requests]), S = K(() => pt("buildTranscript", () => iw(t, d, f, p, x)), [
		t,
		d,
		f,
		p,
		x
	]), C = t?.message_page?.start ?? 0, [T, E] = J(null), D = T;
	(D?.built !== S || D.sessionId !== e) && (D = {
		sessionId: e,
		built: S,
		windowStart: C,
		turns: Dk(S, C, D?.sessionId === e ? D : null)
	}, E(D));
	let O = D.turns, k = u ? t?.active_run?.submitted_user_message : void 0, ee = k ? qt(k.content) : v ?? "", A = !!(ee && kk(O) !== ee), te = C + (t?.messages.length ?? 0), j = K(() => A ? [...O, {
		kind: "user",
		key: `user-${te}`,
		text: ee,
		invokedSkills: k ? w(k.content) : null,
		messageIndex: te,
		createdAt: null,
		pending: !0
	}] : O, [
		O,
		A,
		te,
		ee,
		k
	]), ne = Ok(j, C), re = g && _, ie = K(() => {
		let e = {
			text: m,
			reasoning: h,
			settled: g
		}, t = re ? Ak(j) : -1;
		if (t < 0) return rw(j, e, !1, ne);
		let n = j.slice(0, t), r = n.length ? rw(n, e, !1, Ok(n, C)) : n;
		return r === n ? j : [...r, ...j.slice(t)];
	}, [
		j,
		m,
		h,
		g,
		re,
		ne,
		C
	]);
	return ei("transcript:turns", {
		fields: {
			turns: ie.length,
			streamChars: m.length
		},
		throttleMs: 1e3
	}), {
		turns: ie,
		baseTurns: j,
		running: u,
		optimisticPrompt: v,
		submitted: k,
		pendingText: ee,
		showPending: A,
		replyKey: ne
	};
}
// src/app/components/inspector/transcript/TranscriptModelProvider.tsx
function Mk({ sessionId: e, snapshot: t, children: n }) {
	let r = jk(e, t), i = K(() => ({
		sessionId: e,
		turns: r.baseTurns
	}), [e, r.baseTurns]);
	return /* @__PURE__ */ X(bS.Provider, {
		value: r,
		children: /* @__PURE__ */ X(HD, {
			value: i,
			children: n
		})
	});
}
// src/app/components/inspector/RevisionPicker.tsx
function Nk({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ Z("button", {
		type: "button",
		className: "flex items-start gap-2 w-full p-1 rounded-[4px] text-left btn-ghost",
		onClick: i,
		children: [
			/* @__PURE__ */ X(R, {
				iconName: r ? H.Check : H.History,
				size: 16,
				className: "shrink-0 mt-[2px]"
			}),
			/* @__PURE__ */ Z("span", {
				className: "flex-1 min-w-0 flex flex-col",
				children: [/* @__PURE__ */ X("span", {
					className: "label-micro text-btn-secondary truncate",
					children: e
				}), t ? /* @__PURE__ */ X("span", {
					className: "label-micro text-basic-muted truncate",
					children: t
				}) : null]
			}),
			n ? /* @__PURE__ */ X("span", {
				className: "shrink-0 flex items-center gap-1 code code-small mt-[2px]",
				children: n
			}) : null
		]
	});
}
function Pk({ sessionId: e, selected: t, onSelect: n, placement: r = M.TopRight, labelClassName: i, iconClassName: a }) {
	let [o, s] = J(!1), { data: c, isLoading: l, error: u } = dn(e), d = c ?? [], f = (e) => VO(e, d.length), p = d.findIndex((e) => e.id === t), m = p >= 0 ? BO(f(p)) : "Working tree", h = (e) => {
		n(e), s(!1);
	};
	return /* @__PURE__ */ X(x, {
		open: o,
		onClose: () => s(!1),
		placement: r,
		sticky: !0,
		className: "min-w-0",
		content: /* @__PURE__ */ Z(Y, { children: [
			/* @__PURE__ */ X(Nk, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => h(null)
			}),
			l ? /* @__PURE__ */ Z("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [/* @__PURE__ */ X(ut, {
					size: bt.Small,
					variant: ie.Neutral
				}), "Reading snapshots…"]
			}) : null,
			u ? /* @__PURE__ */ X("div", {
				className: "p-1 label-micro text-error-primary",
				children: Vt(u)
			}) : null,
			!l && !u ? /* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-1 max-h-[280px] overflow-auto [&>*]:shrink-0",
				children: [d.map((e, n) => /* @__PURE__ */ X(Fk, {
					revision: e,
					ordinal: f(n),
					selected: e.id === t,
					onClick: () => h(e.id)
				}, e.id)), d.length === 0 ? /* @__PURE__ */ X("div", {
					className: "p-1 label-micro text-basic-muted",
					children: "No snapshots yet. One is taken every time a run finishes."
				}) : null]
			}) : null
		] }),
		children: /* @__PURE__ */ Z(z, {
			variant: B.Tertiary,
			size: U.Small,
			content: g.IconLeft,
			className: "min-w-0",
			"aria-expanded": o,
			"aria-label": `Snapshot: ${m}`,
			onClick: () => s(!o),
			children: [/* @__PURE__ */ X(R, {
				iconName: H.History,
				size: 16,
				className: I("shrink-0", a)
			}), /* @__PURE__ */ X("span", {
				className: I("truncate", t != null && "text-info-primary", i),
				children: m
			})]
		})
	});
}
function Fk({ revision: e, ordinal: t, selected: n, onClick: r }) {
	let i = e.label.trim();
	return /* @__PURE__ */ X(Nk, {
		title: `${BO(t)} · ${Br(e.created_at)}`,
		subtitle: i || null,
		selected: n,
		trailing: e.additions || e.deletions ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ Z("span", {
			className: "text-success-primary",
			children: ["+", e.additions]
		}), /* @__PURE__ */ Z("span", {
			className: "text-error-primary",
			children: ["-", e.deletions]
		})] }) : null,
		onClick: r
	});
}
// src/app/components/inspector/TopSingleSessionHeader.tsx
var Ik = {
	direct: "Agent",
	"direct-with-orchestrator": "Agent + NAC",
	orchestrator: "Orchestrator"
};
function Lk({ sessionId: t, snapshot: n, entry: r, onShowPanel: i }) {
	let { useSessionSpend: o, useRunning: s, useRunUsage: c, useRunStartedAt: l, useLastElapsedMs: u, useCancelArmed: d, liftSessionSpend: f } = V().stores.runtimeStore, { useSelectedRevision: p, selectRevision: m } = V().stores.sessionLayoutStore, h = ji(), v = xd(), { data: y = [] } = _(), b = s(t), x = d(t), S = c(), C = o();
	G(() => {
		f(Be(n));
	}, [f, n]);
	let w = a(n, r, b || x ? S : null, C), T = Rt(), D = Be(n), O = w.usage?.total_tokens || D?.total_tokens || null, k = l(), ee = u(), A = p(), te = e(t, A), j = n?.workspace ?? null, ne = A == null ? j : te.data ?? {
		total_additions: 0,
		total_deletions: 0
	}, re = ne?.total_additions ?? 0, ie = ne?.total_deletions ?? 0, ae = j?.repo_label ?? j?.workspace_display ?? null, oe = j?.branch ?? null, se = r?.lineage ?? n?.lineage ?? null, ce = se != null, le = se?.kind === "traditional-child" ? "Traditional coding agent" : se?.kind === "managed-orchestrator" ? "Managed NAC orchestrator" : null, ue = se ? y.find((e) => e.summary.session_id === se.parent_session_id) : void 0, de = ue ? v(ue.summary) : "Parent session", fe = () => {
		se && h(fn.session(se.parent_session_id, "delegated"));
	}, N = Tt(), pe = r?.summary.behavior ?? n?.metadata.behavior ?? null, P = le ?? (pe && N.orchestrationEnabled ? Ik[pe] : null), me = v(r?.summary);
	return /* @__PURE__ */ X("div", {
		className: "pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col border-b border-muted bg-elevation-ground px-4 pt-4 pb-4",
		children: /* @__PURE__ */ Z("div", {
			className: "pointer-events-auto flex w-full flex-col gap-1.5",
			children: [/* @__PURE__ */ Z("div", {
				className: "flex w-full items-center gap-4",
				children: [
					/* @__PURE__ */ Z("div", {
						className: "flex min-w-0 flex-1 items-center gap-1",
						children: [se ? /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(z, {
							variant: B.Tertiary,
							size: U.Medium,
							className: "min-w-0 max-w-[120px]",
							"aria-label": `${de}, parent chat`,
							title: de,
							onClick: fe,
							children: /* @__PURE__ */ X("span", {
								className: "truncate underline",
								children: de
							})
						}), /* @__PURE__ */ X(R, {
							iconName: H.Right,
							size: 16,
							className: "shrink-0 text-btn-secondary"
						})] }) : null, /* @__PURE__ */ Z("div", {
							className: "flex min-w-0 items-center gap-2",
							children: [/* @__PURE__ */ X("p", {
								className: I("header-sm min-w-0 truncate", b ? "text-shimmer-basic" : "text-basic-primary"),
								children: me
							}), P ? /* @__PURE__ */ X("span", {
								className: "tag-label min-w-0 truncate rounded-full border border-tertiary px-2 py-[3px] text-basic-tertiary",
								title: P,
								children: P
							}) : null]
						})]
					}),
					/* @__PURE__ */ X(nb, {
						context: it(O),
						contextShare: bf(O, yf(T.data, n?.metadata?.backend, w.model)),
						input: it(w.usage?.input_tokens),
						output: it(w.usage?.output_tokens),
						cacheRead: w.usage?.cache_read_tokens ? it(w.usage.cache_read_tokens) : null,
						cost: et(w.usage?.cost?.total),
						running: b,
						startedAt: k,
						lastElapsedMs: ee ?? w.lastResponseMs
					}),
					i ? /* @__PURE__ */ X(E, {
						title: "Show panel",
						position: M.BottomLeft,
						children: /* @__PURE__ */ X(z, {
							size: U.Medium,
							variant: B.Ghost,
							content: g.Icon,
							"aria-label": "Show panel",
							onClick: i,
							children: /* @__PURE__ */ X(R, { iconName: H.SidebarChevronLeft })
						})
					}) : null
				]
			}), /* @__PURE__ */ Z("div", {
				className: "@container flex w-full min-w-0 items-center gap-4 overflow-x-clip",
				children: [
					ae ? /* @__PURE__ */ Z("div", {
						className: "flex shrink-0 items-center gap-0.5 @max-sm:hidden",
						children: [/* @__PURE__ */ X("span", {
							className: "label-micro max-w-[120px] truncate text-basic-tertiary",
							children: ae
						}), /* @__PURE__ */ X("span", {
							className: "tag-label text-basic-muted",
							children: Nn(r?.summary)
						})]
					}) : null,
					oe && !ce ? /* @__PURE__ */ X(OE, {
						sessionId: t,
						branch: oe,
						placement: M.BottomRight,
						tertiary: !0,
						labelClassName: "@max-sm:hidden",
						iconClassName: "@sm:!hidden"
					}) : null,
					oe && ce ? /* @__PURE__ */ Z("span", {
						className: "label-micro flex min-w-0 items-center gap-1.5 text-btn-secondary",
						children: [/* @__PURE__ */ X(R, {
							iconName: H.Scheme,
							size: 16,
							className: "shrink-0 @sm:!hidden"
						}), /* @__PURE__ */ X("span", {
							className: "truncate @max-sm:sr-only",
							children: oe
						})]
					}) : null,
					/* @__PURE__ */ X(Pk, {
						sessionId: t,
						selected: A,
						onSelect: m,
						placement: M.BottomRight,
						labelClassName: "@max-sm:hidden",
						iconClassName: "@sm:!hidden"
					}),
					re || ie ? /* @__PURE__ */ X(ml, {
						additions: re,
						deletions: ie
					}) : null
				]
			})]
		})
	});
}
// src/app/components/pages/SessionPage.tsx
var Rk = "w-[min(clamp(480px,calc(100%*4/9),800px),max(50%,100%_-_200px))]";
function zk(e, t) {
	let { useSshConnectionStatus: n, sshTargetKey: r, sshTargetFromSummary: i, markSshDisconnected: a, markSshConnected: o } = V().stores.sshConnectionStore, s = K(() => i(t), [i, t]), c = n(s), l = at(), u = q(null);
	G(() => {
		u.current = null;
	}, [e]), G(() => {
		if (!s) return;
		let e = r(s);
		c === "connected" ? u.current = e : u.current === e || l.isPending || (u.current = e, l.mutateAsync(s).then(() => o(s)).catch(() => a(s)));
	}, [
		s,
		c,
		l,
		r,
		o,
		a
	]);
}
function Bk() {
	let { useSidePanelExpanded: e, useSidePanelCollapsed: t, useSidePanelAnimate: r, useSelectedThread: i, selectInsight: a, toggleSidePanelExpanded: o, leaveFocusedSidePanel: s, toggleSidePanelCollapsed: c, showSidePanelList: l, revealSidePanel: d, setSidePanelAnimate: f, resetSessionSelection: p, unbindSidePanelProject: m, bindSidePanelProject: h } = V().stores.sessionLayoutStore, { clearAttention: g } = V().stores.attentionStore, { sessionId: _, panel: v } = Mi(), y = ji(), b = _ ?? null, x = Tt(), S = Em();
	u("SessionPage");
	let { data: C = null, error: w, refetch: T } = gn(b), { data: E = null } = ur(b), D = yk(b, E?.summary.backend), O = t(), k = r(), ee = e(), A = i(), te = N(), j = E != null || C != null, ne = j ? E?.summary.behavior ?? C?.metadata.behavior ?? "orchestrator" : null, re = !j || n(x, ne, E?.lineage ?? C?.lineage);
	Ay(re ? b : null), My(re ? C?.active_run : null), zk(re ? b : null, re ? E?.summary : null);
	let ie = ne == null ? null : Ra(ne, C?.lineage?.kind), ae = ie?.mobilePanels ?? [], oe = kr(v) ? v : yr, se = oe === "threads" ? "insights" : oe, ce = ie == null || ie.mobilePanels.includes(se) ? se : ie.defaultPanel;
	G(() => {
		if (!b || !kr(v)) return;
		let e = C ? ce : v === "threads" ? se : v;
		e !== v && (v === "threads" && A && a({ kind: "thread" }), y(fn.session(b, e), { replace: !0 }));
	}, [
		ce,
		b,
		y,
		v,
		se,
		a,
		A,
		C
	]), G(() => {
		b && g(b), p();
	}, [
		g,
		b,
		p
	]);
	let M = q(te);
	G(() => {
		M.current = te;
	}, [te]), G(() => () => {
		M.current || s();
	}, [b, s]);
	let le = E ? E.summary.project_id ?? "" : null;
	pi(() => {
		m(), le != null && h(le);
	}, [
		h,
		b,
		le,
		m
	]), G(() => {
		if (k) return;
		let e = requestAnimationFrame(() => f(!0));
		return () => cancelAnimationFrame(e);
	}, [k, f]);
	let [ue, de] = J(null), [fe, pe] = J(null);
	if (G(() => {
		if (!ue || !fe || typeof ResizeObserver > "u") return;
		let e = new ResizeObserver(() => {
			ue.style.setProperty("--composer-height", `${fe.offsetHeight}px`);
		});
		return e.observe(fe), () => e.disconnect();
	}, [ue, fe]), j && !re) return /* @__PURE__ */ Z("div", {
		className: "flex flex-1 flex-col items-center justify-center gap-4 p-8",
		children: [
			/* @__PURE__ */ X("h1", {
				className: "heading-small",
				children: "This chat is unavailable in direct-only mode"
			}),
			/* @__PURE__ */ X("p", { children: "Its saved behavior and history are preserved. An operator can enable orchestration to open it." }),
			/* @__PURE__ */ X(z, {
				onClick: () => {
					let e = E?.summary.project_id ?? C?.metadata.project_id;
					e ? S.newChat(e) : S.create();
				},
				children: "New direct chat"
			})
		]
	});
	if (!b) return /* @__PURE__ */ X(wi, {
		to: fn.list(),
		replace: !0
	});
	if (!kr(v)) return /* @__PURE__ */ X(wi, {
		to: fn.session(b, yr),
		replace: !0
	});
	let P = E?.summary.model_config_error ?? (!C && w ? w : null), me = P ? D(P, () => void T()) : null, F = (e) => y(fn.session(b, e)), he = (e) => {
		d(te), F(e);
	}, ge = ee || !te && !O, _e = ee && !te, L = O && !_e, R = (e) => {
		if (!_e || e.key !== "Escape" || e.defaultPrevented) return;
		let t = e.target;
		t instanceof Element && e.currentTarget.contains(t) && (t.closest(".xterm, [aria-expanded=\"true\"]") || (e.preventDefault(), s()));
	}, ve = /* @__PURE__ */ X(ak, {
		sessionId: b,
		snapshot: C,
		behavior: ne,
		panel: ce,
		onPanelChange: F
	}), ye = /* @__PURE__ */ Z("section", {
		className: "relative flex min-h-0 min-w-0 flex-1 h-full overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ Z("div", {
			className: "relative flex flex-1 min-w-0 h-full min-h-0",
			children: [/* @__PURE__ */ X("div", {
				className: I("flex flex-col items-center flex-1 min-w-0 h-full", _e && "invisible"),
				inert: _e,
				children: /* @__PURE__ */ Z("div", {
					ref: de,
					className: "flex flex-col flex-1 min-h-0 w-full relative",
					children: [
						te ? null : /* @__PURE__ */ X(Lk, {
							sessionId: b,
							snapshot: C,
							entry: E
						}),
						/* @__PURE__ */ X(Tk, {
							sessionId: b,
							snapshot: C,
							panel: ge ? ce : null,
							onFocusPanel: he,
							errorNotice: me
						}),
						/* @__PURE__ */ X("div", {
							ref: pe,
							className: "pointer-events-none absolute inset-x-0 bottom-0",
							children: /* @__PURE__ */ X(Ob, {
								sessionId: b,
								snapshot: C,
								entry: E
							})
						})
					]
				})
			}), te ? null : /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X("div", {
				className: I("relative h-full shrink-0", k && "transition-[width] duration-300 ease-out", O ? "w-[52px]" : Rk),
				style: k ? void 0 : { transition: "none" },
				children: O ? /* @__PURE__ */ X("div", {
					className: "absolute inset-y-0 right-0 w-[52px]",
					inert: _e,
					children: /* @__PURE__ */ X(Nb, {
						sessionId: b,
						snapshot: C,
						behavior: ne,
						panels: ie?.widePanels ?? [],
						onOpen: c,
						onSelect: he
					})
				}) : null
			}), /* @__PURE__ */ X("div", {
				className: I("absolute inset-y-0 right-0 z-[1] flex flex-col min-w-0 outline-none", _e ? "left-0" : Rk, k && "transition-transform duration-300 ease-out", L && "translate-x-full"),
				style: k ? void 0 : { transition: "none" },
				"aria-hidden": L,
				inert: L,
				tabIndex: _e ? -1 : void 0,
				onKeyDown: R,
				children: /* @__PURE__ */ X("div", {
					className: "flex flex-col flex-1 min-h-0",
					children: /* @__PURE__ */ X("div", {
						className: "flex-1 min-h-0",
						children: ve
					})
				})
			})] })]
		}), te ? /* @__PURE__ */ X(Xn, {
			open: ee,
			onClose: o,
			keepOnNavigate: !0,
			chromeless: !0,
			hideClose: !0,
			title: Hn[ce],
			bodyClassName: "relative overflow-hidden",
			children: /* @__PURE__ */ X(Fx, {
				value: {
					close: o,
					bar: ae.length > 0 ? /* @__PURE__ */ X(jb, {
						panel: ce,
						panels: ae,
						onPanelChange: (e) => {
							l(!0), F(e);
						}
					}) : null
				},
				children: ve
			})
		}) : null]
	});
	return /* @__PURE__ */ X(Mk, {
		sessionId: b,
		snapshot: C,
		children: /* @__PURE__ */ X(oy, {
			sessionId: b,
			panels: ae,
			focusPanel: he,
			children: ye
		})
	});
}
// src/app/features/managed/presentation/ManagedGitHubPanel.tsx
function Vk({ onConnected: e }) {
	let { api: t } = V(), n = nr(), r = Si(), i = It(), [a, o] = J(null), [s, c] = J(""), [l, u] = J(!1);
	G(() => {
		if (!a) return;
		let i = !1, s = new AbortController();
		return (async () => {
			for (; !i;) {
				try {
					let i = await t.pollManagedGitHubLogin(a.login_id, s.signal);
					if (i.state === "complete") {
						r.setQueryData(qn.github, i.auth), o(null), c(""), Promise.all([r.invalidateQueries({ queryKey: qn.github }), r.invalidateQueries({ queryKey: qn.hostStatus })]), n.success("GitHub connected"), e?.();
						return;
					}
					if (i.state === "failed") {
						c(i.error), o(null);
						return;
					}
				} catch (e) {
					s.signal.aborted || c(nf(Ud(e)));
					return;
				}
				await new Promise((e) => setTimeout(e, 1e3));
			}
		})(), () => {
			i = !0, s.abort();
		};
	}, [
		a,
		r,
		e,
		n,
		t
	]);
	let d = async () => {
		u(!0), c("");
		try {
			o(await t.startManagedGitHubLogin());
		} catch (e) {
			c(nf(Ud(e)));
		} finally {
			u(!1);
		}
	}, f = async () => {
		u(!0);
		try {
			await t.disconnectManagedGitHub(), await Promise.all([r.invalidateQueries({ queryKey: qn.github }), r.invalidateQueries({ queryKey: qn.hostStatus })]), n.success("GitHub disconnected");
		} catch (e) {
			n.error(`Disconnect failed: ${Vt(Ud(e))}`);
		} finally {
			u(!1);
		}
	};
	return i.isLoading ? /* @__PURE__ */ X(ut, { size: bt.Medium }) : /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-5",
		"data-testid": "managed-github-settings",
		children: [
			/* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("p", {
				className: "header-xl text-basic-primary",
				children: "GitHub"
			}), /* @__PURE__ */ X("p", {
				className: "text-small text-basic-tertiary",
				children: "Connect the private Arcee GitHub App. Tokens are never shown in NAC."
			})] }),
			i.data?.connected ? /* @__PURE__ */ Z("div", {
				className: "rounded-lg border border-basic p-4",
				children: [/* @__PURE__ */ Z("div", {
					className: "flex items-center gap-3",
					children: [
						i.data.avatar_url ? /* @__PURE__ */ X("img", {
							src: i.data.avatar_url,
							alt: "",
							className: "h-10 w-10 rounded-full"
						}) : /* @__PURE__ */ X(R, { iconName: H.Github }),
						/* @__PURE__ */ Z("div", {
							className: "min-w-0 flex-1",
							children: [/* @__PURE__ */ X("p", {
								className: "label-medium text-basic-primary truncate",
								children: i.data.name ?? i.data.login
							}), /* @__PURE__ */ Z("p", {
								className: "text-small text-basic-tertiary truncate",
								children: ["@", i.data.login]
							})]
						}),
						/* @__PURE__ */ Z("span", {
							className: "flex shrink-0 items-center gap-1.5 label-small text-success-primary",
							children: [/* @__PURE__ */ X(R, {
								iconName: H.CheckCircle,
								"aria-hidden": "true"
							}), "Connected"]
						})
					]
				}), i.data.git_name && i.data.git_email ? /* @__PURE__ */ Z("p", {
					className: "mt-3 text-small text-basic-tertiary",
					children: [
						"Git commits: ",
						i.data.git_name,
						" · ",
						i.data.git_email
					]
				}) : null]
			}) : null,
			a ? /* @__PURE__ */ Z("div", {
				className: "rounded-lg border border-info-primary p-4",
				"data-testid": "github-device-code",
				children: [
					/* @__PURE__ */ X("p", {
						className: "label-medium text-basic-primary",
						children: "Authorize this host on GitHub"
					}),
					/* @__PURE__ */ X("p", {
						className: "mt-1 text-small text-basic-tertiary",
						children: "Open GitHub and enter this code. Returning here will preserve this pending login."
					}),
					/* @__PURE__ */ Z("div", {
						className: "mt-4 flex items-center gap-2",
						children: [/* @__PURE__ */ X("code", {
							className: "flex-1 rounded bg-elevation-level-2 px-4 py-3 text-center text-xl tracking-[0.2em] text-basic-primary",
							children: a.user_code
						}), /* @__PURE__ */ X(Yt, {
							value: a.user_code,
							title: "Copy device code"
						})]
					}),
					/* @__PURE__ */ Z("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: [/* @__PURE__ */ Z(z, {
							variant: B.Primary,
							content: g.IconRight,
							onClick: () => window.open(a.verification_uri, "_blank", "noopener"),
							children: ["Open GitHub ", /* @__PURE__ */ X(R, { iconName: H.External })]
						}), /* @__PURE__ */ X(z, {
							variant: B.Tertiary,
							content: g.Text,
							onClick: () => {
								t.cancelManagedGitHubLogin(a.login_id), o(null);
							},
							children: "Cancel"
						})]
					})
				]
			}) : null,
			s ? /* @__PURE__ */ X("p", {
				className: "text-small text-error-primary",
				children: s
			}) : null,
			a ? null : /* @__PURE__ */ Z("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ X(z, {
					variant: B.Primary,
					content: g.Text,
					onClick: () => void d(),
					loading: l,
					children: i.data?.connected ? "Reconnect GitHub" : "Connect GitHub"
				}), i.data?.connected ? /* @__PURE__ */ X(z, {
					variant: B.SecondaryDestructive,
					content: g.Text,
					onClick: () => void f(),
					disabled: l,
					children: "Disconnect"
				}) : null]
			})
		]
	});
}
// src/app/features/managed/presentation/ManagedSecretsPanel.tsx
function Hk() {
	let e = Kt(), t = p(), n = Sn(), r = nr(), [i, a] = J(""), [o, s] = J(""), [c, l] = J(!1), u = K(() => c ? ye(i) : "", [c, i]), d = async () => {
		if (l(!0), !(ye(i) || o.length === 0)) try {
			await t.mutateAsync({
				name: i,
				value: o
			}), a(""), s(""), l(!1), r.success("Secret saved for future command spawns");
		} catch (e) {
			r.error(`Secret was not saved: ${Vt(Ud(e))}`);
		}
	};
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-5",
		"data-testid": "managed-secrets-settings",
		children: [
			/* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("p", {
				className: "header-xl text-basic-primary",
				children: "Host secrets"
			}), /* @__PURE__ */ X("p", {
				className: "text-small text-basic-tertiary",
				children: "Values are write-only and are injected into every newly spawned agent command on this single-owner host. Running processes keep their existing snapshot."
			})] }),
			/* @__PURE__ */ X("div", {
				className: "rounded-lg border border-warning-primary p-4 text-small text-basic-secondary",
				children: "Agents have arbitrary shell access and can print injected values. Add only secrets trusted across every Project and agent on this host."
			}),
			/* @__PURE__ */ Z("div", {
				className: "grid grid-cols-1 gap-3 sm:grid-cols-2",
				children: [/* @__PURE__ */ X($, {
					inputSize: Q.Large,
					label: "Variable name",
					"aria-label": "Variable name",
					placeholder: "SERVICE_TOKEN",
					value: i,
					onChange: (e) => {
						a(e.target.value), l(!1);
					},
					validation: !!u,
					validationText: u,
					autoCapitalize: "none",
					spellCheck: !1
				}), /* @__PURE__ */ X($, {
					inputSize: Q.Large,
					label: "New value",
					"aria-label": "New value",
					placeholder: "Write-only value",
					type: "password",
					value: o,
					onChange: (e) => s(e.target.value),
					validation: c && o.length === 0,
					validationText: "Enter a value.",
					autoComplete: "new-password"
				})]
			}),
			/* @__PURE__ */ X("div", { children: /* @__PURE__ */ X(z, {
				variant: B.Primary,
				content: g.Text,
				onClick: () => void d(),
				loading: t.isPending,
				children: "Save secret"
			}) }),
			/* @__PURE__ */ X(nd, {}),
			/* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-2",
				children: [
					/* @__PURE__ */ X("p", {
						className: "label-medium text-basic-primary",
						children: "Stored names"
					}),
					e.isLoading ? /* @__PURE__ */ X(ut, { size: bt.Small }) : null,
					e.data?.secrets.length === 0 ? /* @__PURE__ */ X("p", {
						className: "text-small text-basic-tertiary",
						children: "No host secrets saved."
					}) : null,
					e.data?.secrets.map((e) => /* @__PURE__ */ Z("div", {
						className: "flex items-center gap-3 rounded-lg border border-basic p-3",
						children: [
							/* @__PURE__ */ X(R, { iconName: H.Key }),
							/* @__PURE__ */ X("code", {
								className: "min-w-0 flex-1 truncate text-basic-primary",
								children: e.name
							}),
							/* @__PURE__ */ X("span", {
								className: "text-small text-basic-muted",
								children: "value hidden"
							}),
							/* @__PURE__ */ X(z, {
								variant: B.Ghost,
								size: U.Small,
								content: g.Icon,
								"aria-label": `Delete ${e.name}`,
								onClick: async () => {
									try {
										await n.mutateAsync(e.name), r.success(`${e.name} removed from future command spawns`);
									} catch (e) {
										r.error(`Secret was not removed: ${Vt(Ud(e))}`);
									}
								},
								loading: n.isPending,
								children: /* @__PURE__ */ X(R, { iconName: H.Trash })
							})
						]
					}, e.name))
				]
			})
		]
	});
}
// src/app/features/managed/controller/useManagedUpgrade.ts
function Uk() {
	return `nac-upgrade-${globalThis.crypto.randomUUID()}`;
}
function Wk(e) {
	if (!e) throw Error("managed upgrade action target is unavailable");
	return e;
}
async function Gk(e, t) {
	if (!t.actionable || t.action === "wait" || !t.target) throw Error("managed upgrade blocker is wait-only");
	let n = t.target;
	switch (t.action) {
		case "cancel_active_run": {
			let t = Wk(n.session_id), r = Wk(n.run_id);
			await e.cancelExactRun(t, r);
			return;
		}
		case "cancel_traditional_child":
			await e.cancelTraditionalChild(Wk(n.session_id), Wk(n.child_session_id));
			return;
		case "cancel_managed_orchestrator":
			await e.cancelManagedOrchestrator(Wk(n.session_id), Wk(n.orchestrator_session_id));
			return;
		case "terminate_terminal":
			await e.terminateTerminal(Wk(n.session_id), Wk(n.terminal_id));
			return;
		case "cancel_clone_operation":
			await e.cancelManagedClone(Wk(n.clone_operation_id));
			return;
	}
}
function Kk(e, t, n) {
	if (!t) return !1;
	let r = t.target_release ?? t.desired_release;
	return !r || !ke(r, n) ? !1 : !e || t.operation_id !== e.operation_id || t.state !== e.state || t.updated_at !== e.updated_at;
}
function qk() {
	let { api: e } = V(), t = Ur(), n = rt(), r = q(null), i = t.data?.operation?.operation_id ?? null, [a, o] = J(!1), [s, c] = J(""), [l, u] = J({}), d = q(i);
	G(() => {
		if (d.current !== i) {
			d.current = i, u({});
			return;
		}
		let e = new Set((t.data?.operation?.blockers ?? []).map((e) => e.selection_key));
		u((t) => {
			let n = Object.fromEntries(Object.entries(t).filter(([t]) => e.has(t)));
			return Object.keys(n).length === Object.keys(t).length ? t : n;
		});
	}, [i, t.data?.operation?.blockers]);
	let f = W(() => {
		c(""), o(!0);
	}, []), p = W(() => {
		n.isPending || (o(!1), c(""));
	}, [n.isPending]), m = W(async () => {
		if (n.isPending) return;
		let e = r.current ?? Uk(), i = t.data?.operation ?? null, a = t.data?.preview.latest_beta;
		r.current = e, c("");
		try {
			await n.mutateAsync(e), r.current = null, o(!1);
		} catch (e) {
			c(Mn(e).message), v(e) && (r.current = null, o(!1));
			let n = await t.refetch();
			!v(e) && !n.error && a && Kk(i, n.data?.operation, a) && (r.current = null, c(""), o(!1));
		}
	}, [t, n]), h = W(async (n) => {
		u((e) => ({
			...e,
			[n.selection_key]: "requesting"
		}));
		try {
			await Gk(e, n), u((e) => ({
				...e,
				[n.selection_key]: "settling"
			})), await t.refetch();
		} catch {
			u((e) => ({
				...e,
				[n.selection_key]: "failed"
			}));
		}
	}, [t, e]);
	return {
		snapshot: t,
		confirmationOpen: a,
		startError: s,
		startPending: n.isPending,
		settlements: l,
		requestStart: f,
		cancelStart: p,
		confirmStart: m,
		requestSettlement: h
	};
}
// src/app/features/managed/presentation/ManagedUpgradePanel.tsx
function Jk() {
	let e = qk(), t = e.snapshot, n = we(t.error);
	if (t.isLoading) return /* @__PURE__ */ Z("section", {
		"aria-labelledby": "managed-upgrade-heading",
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ X("h2", {
			id: "managed-upgrade-heading",
			className: "label-medium text-basic-primary",
			children: "Managed NAC upgrade"
		}), /* @__PURE__ */ X("div", {
			className: "mt-3",
			children: /* @__PURE__ */ X(ut, { size: bt.Small })
		})]
	});
	if (!t.data || n) {
		let e = Mn(t.error);
		return /* @__PURE__ */ Z("section", {
			"aria-labelledby": "managed-upgrade-heading",
			className: "rounded-lg border border-basic p-4",
			"data-testid": "managed-upgrade-unavailable",
			children: [
				/* @__PURE__ */ X("h2", {
					id: "managed-upgrade-heading",
					className: "label-medium text-basic-primary",
					children: "Managed NAC upgrade"
				}),
				/* @__PURE__ */ X("p", {
					className: "mt-1 text-small text-error-primary",
					children: e.message
				}),
				e.retryLabel ? /* @__PURE__ */ X(z, {
					className: "mt-3",
					size: U.Small,
					variant: B.Secondary,
					content: g.Text,
					onClick: () => void t.refetch(),
					loading: t.isFetching,
					children: e.retryLabel
				}) : null
			]
		});
	}
	let { preview: r, operation: i } = t.data, a = i ? Ln(i.state) : !1, o = r.upgrade_available && !a, s = i?.target_release, c = s && !ke(s, r.latest_beta);
	return /* @__PURE__ */ Z("section", {
		"aria-labelledby": "managed-upgrade-heading",
		className: "rounded-lg border border-basic p-4",
		"data-testid": "managed-upgrade",
		children: [
			/* @__PURE__ */ Z("div", {
				className: "flex flex-wrap items-start justify-between gap-3",
				children: [/* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("h2", {
					id: "managed-upgrade-heading",
					className: "label-medium text-basic-primary",
					children: "Managed NAC upgrade"
				}), /* @__PURE__ */ X("p", {
					className: "mt-1 text-small text-basic-tertiary",
					children: Pe(r.distance?.accepted_releases ?? null)
				})] }), o ? /* @__PURE__ */ X(z, {
					size: U.Small,
					variant: B.Primary,
					content: g.Text,
					onClick: e.requestStart,
					children: i?.state === "failed" ? "Retry upgrade to latest beta" : "Upgrade to latest beta"
				}) : !r.upgrade_available && !a ? /* @__PURE__ */ X("span", {
					className: "rounded-full bg-success-secondary px-3 py-1 text-small text-success-primary",
					children: "Up to date"
				}) : null]
			}),
			/* @__PURE__ */ Z("div", {
				className: "mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2",
				children: [
					/* @__PURE__ */ X(Yk, {
						label: "Current",
						release: r.current
					}),
					/* @__PURE__ */ X(Yk, {
						label: "Latest beta",
						release: r.latest_beta
					}),
					c ? /* @__PURE__ */ X(Yk, {
						label: "Accepted target",
						release: s,
						className: "lg:col-span-2"
					}) : null
				]
			}),
			i ? /* @__PURE__ */ X(Xk, {
				operation: i,
				settlements: e.settlements,
				onSettle: (t) => void e.requestSettlement(t)
			}) : null,
			/* @__PURE__ */ Z(Xn, {
				open: e.confirmationOpen,
				onClose: e.cancelStart,
				title: "Upgrade Managed NAC?",
				size: Tn.Small,
				footer: /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(z, {
					variant: B.Tertiary,
					content: g.Text,
					onClick: e.cancelStart,
					disabled: e.startPending,
					children: "Cancel"
				}), /* @__PURE__ */ X(z, {
					variant: B.Primary,
					content: g.Text,
					onClick: () => void e.confirmStart(),
					loading: e.startPending,
					children: "Start upgrade"
				})] }),
				children: [/* @__PURE__ */ Z("p", {
					className: "text-small text-basic-secondary",
					children: [
						"Upgrade from ",
						/* @__PURE__ */ X("strong", { children: r.current.product_version }),
						" to the exact accepted latest beta, ",
						/* @__PURE__ */ X("strong", { children: r.latest_beta.product_version }),
						". Active work must finish or be explicitly stopped before this host is replaced. The page may disconnect briefly while NAC starts and verifies the replacement."
					]
				}), e.startError ? /* @__PURE__ */ X("p", {
					role: "alert",
					className: "mt-3 text-small text-error-primary",
					children: e.startError
				}) : null]
			})
		]
	});
}
function Yk({ label: e, release: t, className: n = "" }) {
	return /* @__PURE__ */ Z("div", {
		className: `min-w-0 rounded-lg bg-elevation-level-2 p-3 ${n}`,
		children: [
			/* @__PURE__ */ X("p", {
				className: "label-small text-basic-secondary",
				children: e
			}),
			/* @__PURE__ */ X("p", {
				className: "mt-1 label-medium text-basic-primary",
				children: t.product_version
			}),
			/* @__PURE__ */ Z("dl", {
				className: "mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-1 text-small",
				children: [
					/* @__PURE__ */ X("dt", {
						className: "text-basic-tertiary",
						children: "Release"
					}),
					/* @__PURE__ */ X("dd", {
						className: "code-small break-all text-basic-primary",
						children: t.release_id
					}),
					/* @__PURE__ */ X("dt", {
						className: "text-basic-tertiary",
						children: "Source"
					}),
					/* @__PURE__ */ X("dd", {
						className: "code-small break-all text-basic-primary",
						children: t.source_revision
					}),
					/* @__PURE__ */ X("dt", {
						className: "text-basic-tertiary",
						children: "Build"
					}),
					/* @__PURE__ */ X("dd", {
						className: "code-small break-all text-basic-primary",
						children: t.build_id
					}),
					/* @__PURE__ */ X("dt", {
						className: "text-basic-tertiary",
						children: "Schema"
					}),
					/* @__PURE__ */ X("dd", {
						className: "code-small text-basic-primary",
						children: t.schema_version
					})
				]
			})
		]
	});
}
function Xk({ operation: e, settlements: t, onSettle: n }) {
	let r = e.blockers ?? [], a = e.state === "failed", o = e.state === "succeeded";
	return /* @__PURE__ */ Z("div", {
		className: `mt-4 rounded-lg border p-4 ${a ? "border-error-primary" : o ? "border-success-primary" : "border-basic"}`,
		"aria-live": "polite",
		"data-testid": "managed-upgrade-operation",
		children: [/* @__PURE__ */ Z("div", {
			className: "flex flex-wrap items-start justify-between gap-2",
			children: [/* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("p", {
				className: "label-medium text-basic-primary",
				children: i(e.state)
			}), e.message ? /* @__PURE__ */ X("p", {
				className: "mt-1 text-small text-basic-tertiary",
				children: e.message
			}) : null] }), /* @__PURE__ */ X("span", {
				className: "code-small break-all text-basic-muted",
				children: e.operation_id
			})]
		}), r.length > 0 ? /* @__PURE__ */ Z("div", {
			className: "mt-4",
			children: [/* @__PURE__ */ X("p", {
				className: "label-small text-basic-secondary",
				children: "Before replacement can begin"
			}), /* @__PURE__ */ X("ul", {
				className: "mt-2 flex flex-col gap-2",
				children: r.map((e) => {
					let r = t[e.selection_key];
					return /* @__PURE__ */ X("li", {
						className: "rounded-lg bg-elevation-level-2 p-3",
						children: /* @__PURE__ */ Z("div", {
							className: "flex flex-wrap items-center justify-between gap-3",
							children: [/* @__PURE__ */ Z("div", {
								className: "min-w-0 flex-1",
								children: [/* @__PURE__ */ X("p", {
									className: "text-small text-basic-primary",
									children: e.message
								}), e.actionable ? r === "settling" ? /* @__PURE__ */ X("p", {
									className: "mt-1 text-small text-basic-tertiary",
									children: "Stop requested. Waiting for cleanup to finish."
								}) : r === "failed" ? /* @__PURE__ */ X("p", {
									role: "alert",
									className: "mt-1 text-small text-error-primary",
									children: "The stop request failed. Refresh status or try again."
								}) : null : /* @__PURE__ */ X("p", {
									className: "mt-1 text-small text-basic-tertiary",
									children: "Wait for this work to finish safely."
								})]
							}), e.actionable ? /* @__PURE__ */ X(z, {
								size: U.Small,
								variant: B.SecondaryDestructive,
								content: g.Text,
								onClick: () => n(e),
								loading: r === "requesting",
								disabled: r === "settling",
								children: r === "settling" ? "Waiting for cleanup" : r === "failed" ? `Try again: ${C(e.action)}` : C(e.action)
							}) : /* @__PURE__ */ X("span", {
								className: "rounded-full border border-basic px-2 py-1 text-small text-basic-tertiary",
								children: "Wait only"
							})]
						})
					}, e.selection_key);
				})
			})]
		}) : null]
	});
}
// src/app/features/managed/presentation/ManagedStatusPanel.tsx
function Zk({ ready: e }) {
	return /* @__PURE__ */ X("span", {
		"aria-hidden": !0,
		className: `inline-block h-2 w-2 rounded-full ${e ? "bg-success-primary" : "bg-warning-primary"}`
	});
}
function Qk() {
	let e = Pr();
	if (e.isLoading) return /* @__PURE__ */ X(ut, { size: bt.Medium });
	if (!e.data) return /* @__PURE__ */ X("p", {
		className: "text-error-primary",
		children: "Managed host status is unavailable."
	});
	let t = e.data;
	return /* @__PURE__ */ Z("div", {
		className: "flex flex-col gap-5",
		"data-testid": "managed-host-status",
		children: [
			/* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("p", {
				className: "header-xl text-basic-primary",
				children: t.logical_host_id
			}), /* @__PURE__ */ Z("p", {
				className: "text-small text-basic-tertiary",
				children: ["Managed NAC · ", t.public_hostname]
			})] }),
			/* @__PURE__ */ X(Jk, {}),
			/* @__PURE__ */ Z("div", {
				className: "grid grid-cols-1 gap-2 sm:grid-cols-2",
				children: [
					/* @__PURE__ */ X($k, {
						label: t.model.display_name,
						value: t.model_ready ? t.model.id : "Needs attention",
						ready: t.model_ready
					}),
					/* @__PURE__ */ X($k, {
						label: "GitHub",
						value: t.github_status.replace("-", " "),
						ready: t.github_status === "connected"
					}),
					/* @__PURE__ */ X($k, {
						label: "Projects",
						value: String(t.project_count),
						ready: !0
					}),
					/* @__PURE__ */ X($k, {
						label: "Host secrets",
						value: String(t.secret_count),
						ready: !0
					})
				]
			}),
			/* @__PURE__ */ Z("div", {
				className: "rounded-lg bg-elevation-level-2 p-4",
				children: [
					/* @__PURE__ */ X("p", {
						className: "label-small text-basic-secondary",
						children: "Managed model endpoint"
					}),
					/* @__PURE__ */ X("p", {
						className: "code-small mb-3 break-all text-basic-primary",
						children: t.model.endpoint
					}),
					/* @__PURE__ */ X("p", {
						className: "label-small text-basic-secondary",
						children: "Repository root"
					}),
					/* @__PURE__ */ X("p", {
						className: "code-small break-all text-basic-primary",
						children: t.repository_root
					})
				]
			}),
			/* @__PURE__ */ Z("div", {
				className: "flex flex-col gap-2",
				children: [/* @__PURE__ */ Z("div", {
					className: "flex items-center justify-between",
					children: [/* @__PURE__ */ X("p", {
						className: "label-medium text-basic-primary",
						children: "Readiness"
					}), /* @__PURE__ */ Z("span", {
						className: "text-small text-basic-tertiary",
						children: [
							"v",
							t.version,
							" · schema ",
							t.schema_version
						]
					})]
				}), t.checks.map((e) => /* @__PURE__ */ Z("div", {
					className: "flex items-start gap-2 rounded-lg border border-basic p-3",
					children: [/* @__PURE__ */ X("span", {
						className: "mt-2",
						children: /* @__PURE__ */ X(Zk, { ready: e.ready })
					}), /* @__PURE__ */ Z("div", {
						className: "min-w-0",
						children: [/* @__PURE__ */ X("p", {
							className: "label-small text-basic-primary",
							children: e.name
						}), /* @__PURE__ */ X("p", {
							className: "text-small text-basic-tertiary break-words",
							children: e.detail
						})]
					})]
				}, e.name))]
			})
		]
	});
}
function $k({ label: e, value: t, ready: n }) {
	return /* @__PURE__ */ Z("div", {
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ X("p", {
			className: "text-small text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ Z("div", {
			className: "mt-1 flex items-center gap-2",
			children: [/* @__PURE__ */ X(Zk, { ready: n }), /* @__PURE__ */ X("p", {
				className: "label-medium capitalize text-basic-primary",
				children: t
			})]
		})]
	});
}
// src/app/features/managed/presentation/ManagedHostModal.tsx
function eA({ open: e, onClose: t, tab: n, onTabChange: r, onGitHubConnected: i }) {
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: t,
		title: "Managed host",
		size: Tn.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		bodyClassName: "min-h-0",
		children: /* @__PURE__ */ Z("div", {
			className: "flex h-full min-h-0 flex-col md:flex-row",
			children: [/* @__PURE__ */ X("nav", {
				className: "flex shrink-0 gap-1 overflow-x-auto border-b border-basic md:w-44 md:flex-col md:border-b-0 md:border-r p-2",
				children: ze.map((e) => /* @__PURE__ */ X("button", {
					type: "button",
					className: `rounded px-3 py-2 text-left label-small capitalize ${n === e ? "bg-elevation-level-2 text-basic-primary" : "text-basic-tertiary"}`,
					onClick: () => r(e),
					children: e === "github" ? "GitHub" : e
				}, e))
			}), /* @__PURE__ */ Z("div", {
				className: "min-h-0 flex-1 overflow-auto p-4 md:p-6",
				children: [
					n === "status" ? /* @__PURE__ */ X(Qk, {}) : null,
					n === "github" ? /* @__PURE__ */ X(Vk, { onConnected: i }) : null,
					n === "secrets" ? /* @__PURE__ */ X(Hk, {}) : null
				]
			})]
		})
	});
}
// src/app/features/managed/presentation/ManagedBranchPicker.tsx
function tA(e, t) {
	return e.toLowerCase().localeCompare(t.toLowerCase()) || e.localeCompare(t);
}
function nA({ branches: e, value: t, onValueChange: n, isLoading: r, error: i }) {
	let [a, o] = J(!1), [s, c] = J(""), [l, u] = J(null), d = q(null), f = q(null), p = fi(), m = N(), h = K(() => {
		let t = s.trim().toLowerCase(), n = [...e].sort(tA);
		return t ? n.filter((e) => e.toLowerCase().includes(t)) : n;
	}, [e, s]), g = l === null ? -1 : h.indexOf(l), _ = (e = !0) => {
		o(!1), c(""), u(null), e && d.current?.focus();
	}, v = () => {
		if (a) {
			_();
			return;
		}
		let n = [...e].sort(tA);
		u(t || n[0] || null), o(!0);
	};
	G(() => {
		a && f.current?.focus();
	}, [a]), G(() => {
		!a || g < 0 || document.getElementById(`${p}-option-${g}`)?.scrollIntoView?.({ block: "nearest" });
	}, [
		g,
		p,
		a
	]);
	let y = (e) => {
		n(e), _();
	}, b = (e) => {
		if (h.length === 0) return;
		let t = l === null ? -1 : h.indexOf(l), n = t < 0 ? e > 0 ? 0 : h.length - 1 : (t + e + h.length) % h.length;
		u(h[n] ?? null);
	}, S = (e) => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault(), b(1);
				break;
			case "ArrowUp":
				e.preventDefault(), b(-1);
				break;
			case "Home":
				e.preventDefault(), u(h[0] ?? null);
				break;
			case "End":
				e.preventDefault(), u(h.at(-1) ?? null);
				break;
			case "Enter": {
				let t = g >= 0 ? h[g] : null;
				if (!t) break;
				e.preventDefault(), y(t);
				break;
			}
			case "Escape":
				e.preventDefault(), e.stopPropagation(), _();
				break;
			case "Tab": _(!1);
		}
	}, C = r ? /* @__PURE__ */ Z("div", {
		role: "status",
		className: "flex items-center gap-2 p-3 text-small text-basic-tertiary",
		children: [/* @__PURE__ */ X(ut, {
			size: bt.Small,
			variant: ie.Neutral
		}), "Loading branches…"]
	}) : i ? /* @__PURE__ */ X("p", {
		role: "alert",
		className: "p-3 text-small text-error-primary",
		children: i
	}) : e.length === 0 ? /* @__PURE__ */ X("p", {
		role: "status",
		className: "p-3 text-small text-basic-tertiary",
		children: "No branches found."
	}) : h.length === 0 ? /* @__PURE__ */ Z("p", {
		role: "status",
		className: "p-3 text-small text-basic-tertiary",
		children: [
			"No branches match \"",
			s.trim(),
			"\"."
		]
	}) : null;
	return /* @__PURE__ */ Z("div", {
		className: "flex min-w-0 flex-col gap-1 text-small text-basic-secondary",
		children: [/* @__PURE__ */ X("span", { children: "Branch" }), /* @__PURE__ */ X(x, {
			open: a,
			onClose: () => _(),
			placement: M.BottomLeft,
			sticky: !0,
			className: "w-full",
			size: "w-[min(420px,calc(100vw-32px))]",
			panelClassName: "max-w-[calc(100vw-32px)]",
			sheetClassName: "px-4",
			content: /* @__PURE__ */ Z("div", {
				className: "flex h-[min(420px,70dvh)] min-h-[220px] flex-col gap-2 p-2 md:p-0",
				children: [/* @__PURE__ */ X($, {
					ref: f,
					inputSize: m ? Q.Large : Q.Medium,
					label: "Find branch",
					"aria-label": "Find branch",
					placeholder: "Search loaded branches",
					role: "combobox",
					"aria-autocomplete": "list",
					"aria-expanded": a,
					"aria-controls": p,
					"aria-activedescendant": g >= 0 ? `${p}-option-${g}` : void 0,
					value: s,
					onChange: (t) => {
						let n = t.target.value, r = n.trim().toLowerCase(), i = [...e].sort(tA).filter((e) => !r || e.toLowerCase().includes(r));
						c(n), u(i[0] ?? null);
					},
					onKeyDown: S
				}), /* @__PURE__ */ Z("div", {
					id: p,
					role: "listbox",
					"aria-label": "Branches",
					className: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded border border-basic p-1",
					children: [C, !r && !i ? h.map((e, n) => /* @__PURE__ */ Z(Ui, {
						id: `${p}-option-${n}`,
						role: "option",
						"aria-selected": e === t,
						tabIndex: -1,
						size: m ? Bi.Large : Bi.Medium,
						active: e === l,
						className: "shrink-0",
						onMouseEnter: () => u(e),
						onMouseDown: (e) => e.preventDefault(),
						onClick: () => y(e),
						children: [/* @__PURE__ */ X("span", {
							className: "min-w-0 flex-1 truncate text-left",
							title: e,
							children: e
						}), e === t ? /* @__PURE__ */ X(R, {
							iconName: H.Check,
							className: "shrink-0"
						}) : null]
					}, e)) : null]
				})]
			}),
			children: /* @__PURE__ */ Z("button", {
				ref: d,
				type: "button",
				className: "btn btn-medium btn-secondary btn-icon-right w-full max-w-full overflow-hidden",
				"aria-label": `Branch: ${t || "Select a branch"}`,
				"aria-haspopup": "listbox",
				"aria-expanded": a,
				"aria-controls": a ? p : void 0,
				onClick: v,
				onKeyDown: (e) => {
					[
						"ArrowDown",
						"ArrowUp",
						"Enter",
						" "
					].includes(e.key) && (e.preventDefault(), a || v());
				},
				children: [/* @__PURE__ */ X("span", {
					className: "min-w-0 flex-1 truncate text-left",
					title: t,
					children: t || "Select a branch"
				}), /* @__PURE__ */ X(R, {
					iconName: H.Down,
					className: `shrink-0 transition-transform duration-150 ${a ? "rotate-180" : "rotate-0"}`
				})]
			})
		})]
	});
}
// src/app/features/managed/presentation/ManagedRepositoryModal.tsx
function rA({ open: e, onClose: t, onConnect: n }) {
	let { api: r } = V(), i = ji(), a = nr(), o = Si(), s = Pr(), c = It(e), [l, u] = J(""), [d, f] = J(null), [p, m] = J(""), [h, _] = J(""), [v, y] = J(""), [b, x] = J(null), [S, C] = J(""), [w, T] = J(!1), E = xi({
		queryKey: ["managed-github-repositories"],
		queryFn: ({ signal: e }) => r.listManagedGitHubRepositories(e),
		enabled: e && c.data?.connected === !0,
		retry: !1
	}), D = $r(d?.full_name), k = xi({
		queryKey: ["managed-github-branches", d?.full_name],
		queryFn: ({ signal: e }) => r.listManagedGitHubBranches(D[0], D[1], e),
		enabled: e && D !== null,
		retry: !1
	});
	G(() => {
		if (!b || !O(b)) return;
		let e = !1, n = new AbortController();
		return (async () => {
			for (; !e;) {
				await new Promise((e) => setTimeout(e, 500));
				try {
					let e = await r.getManagedClone(b.operation_id, n.signal);
					if (x(e), e.status !== "running") {
						e.status === "completed" && (await Promise.all([o.invalidateQueries({ queryKey: on.projects }), o.invalidateQueries({ queryKey: qn.hostStatus })]), a.success(`${e.project_name} is ready`), t(), i(fn.project(e.project_id)));
						return;
					}
				} catch (e) {
					n.signal.aborted || C(nf(Ud(e)));
					return;
				}
			}
		})(), () => {
			e = !0, n.abort();
		};
	}, [
		b,
		i,
		t,
		o,
		a,
		r
	]);
	let ee = K(() => {
		let e = l.trim().toLowerCase(), t = E.data?.repositories ?? [];
		return e ? t.filter((t) => t.full_name.toLowerCase().includes(e)) : t;
	}, [E.data, l]), A = async () => {
		if (d && p && h.trim() && v.trim()) {
			T(!0), C("");
			try {
				x(await r.startManagedClone({
					repository_id: d.id,
					repository: d.full_name,
					branch: p,
					destination: h.trim(),
					project_name: v.trim(),
					project_description: null
				}));
			} catch (e) {
				C(nf(Ud(e)));
			} finally {
				T(!1);
			}
		}
	}, te = async () => {
		if (b && O(b)) try {
			x(await r.cancelManagedClone(b.operation_id));
		} catch (e) {
			C(Vt(Ud(e)));
		}
	}, j = w || O(b), ne = k.error ? nf(Ud(k.error)) : null;
	return /* @__PURE__ */ X(Xn, {
		open: e,
		onClose: j ? void 0 : t,
		title: "Add repository",
		size: Tn.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		bodyClassName: "min-h-0",
		footer: b?.status === "running" ? /* @__PURE__ */ X(z, {
			variant: B.SecondaryDestructive,
			content: g.Text,
			onClick: () => void te(),
			children: "Cancel clone"
		}) : /* @__PURE__ */ Z(Y, { children: [/* @__PURE__ */ X(z, {
			variant: B.Tertiary,
			content: g.Text,
			onClick: t,
			children: "Cancel"
		}), /* @__PURE__ */ X(z, {
			variant: B.Primary,
			content: g.Text,
			onClick: () => void A(),
			disabled: !d || !p || !h.trim() || !v.trim(),
			loading: w,
			children: "Clone repository"
		})] }),
		children: /* @__PURE__ */ Z("div", {
			className: "flex h-full min-h-0 flex-col gap-4 overflow-auto p-4 md:p-6",
			"data-testid": "managed-repository-modal",
			children: [
				c.data?.connected ? null : /* @__PURE__ */ Z("div", {
					className: "flex flex-col items-start gap-3 rounded-lg border border-basic p-4",
					children: [/* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("p", {
						className: "label-medium text-basic-primary",
						children: "Connect GitHub to browse Arcee repositories"
					}), /* @__PURE__ */ X("p", {
						className: "text-small text-basic-tertiary",
						children: "You can still create a Project through NAC's existing local or SSH flow."
					})] }), /* @__PURE__ */ X(z, {
						variant: B.Primary,
						content: g.Text,
						onClick: n,
						children: "Connect GitHub"
					})]
				}),
				c.data?.connected && !b ? /* @__PURE__ */ Z(Y, { children: [
					/* @__PURE__ */ X($, {
						inputSize: Q.Large,
						label: "Find repository",
						"aria-label": "Find repository",
						placeholder: "Search accessible repositories",
						value: l,
						onChange: (e) => u(e.target.value)
					}),
					/* @__PURE__ */ Z("div", {
						className: "min-h-[140px] max-h-60 overflow-auto rounded-lg border border-basic p-1",
						children: [
							E.isLoading ? /* @__PURE__ */ X("div", {
								className: "p-4",
								children: /* @__PURE__ */ X(ut, { size: bt.Small })
							}) : null,
							E.error ? /* @__PURE__ */ X("p", {
								className: "p-4 text-small text-error-primary",
								children: nf(Ud(E.error))
							}) : null,
							ee.map((e) => /* @__PURE__ */ Z("button", {
								type: "button",
								className: `flex w-full items-center gap-3 rounded p-3 text-left ${d?.id === e.id ? "bg-elevation-level-2" : "hover:bg-elevation-level-1"}`,
								onClick: () => {
									f(e), m(e.default_branch), _(e.name), y(e.name), C("");
								},
								children: [
									/* @__PURE__ */ X(R, { iconName: e.private ? H.Lock : H.Github }),
									/* @__PURE__ */ Z("span", {
										className: "min-w-0 flex-1",
										children: [/* @__PURE__ */ X("span", {
											className: "block label-small text-basic-primary truncate",
											children: e.full_name
										}), /* @__PURE__ */ Z("span", {
											className: "block text-small text-basic-tertiary",
											children: ["Default branch: ", e.default_branch]
										})]
									}),
									d?.id === e.id ? /* @__PURE__ */ X(R, { iconName: H.CheckCircle }) : null
								]
							}, e.id)),
							!E.isLoading && ee.length === 0 ? /* @__PURE__ */ X("p", {
								className: "p-4 text-small text-basic-tertiary",
								children: "No repositories match."
							}) : null
						]
					}),
					d ? /* @__PURE__ */ Z("div", {
						className: "grid grid-cols-1 gap-3 sm:grid-cols-2",
						children: [
							/* @__PURE__ */ X(nA, {
								branches: k.data?.branches ?? [],
								value: p,
								onValueChange: m,
								isLoading: k.isLoading,
								error: ne
							}, d.full_name),
							/* @__PURE__ */ X($, {
								inputSize: Q.Large,
								label: "Project name",
								"aria-label": "Project name",
								value: v,
								onChange: (e) => y(e.target.value)
							}),
							/* @__PURE__ */ X($, {
								className: "sm:col-span-2",
								inputSize: Q.Large,
								label: "Checkout directory",
								"aria-label": "Checkout directory",
								value: h,
								onChange: (e) => _(e.target.value),
								hintText: `${s.data?.repository_root ?? "Repository root"}/${h || "directory"}`
							})
						]
					}) : null
				] }) : null,
				b ? /* @__PURE__ */ Z("div", {
					className: "flex flex-col gap-4 rounded-lg border border-basic p-4",
					children: [
						/* @__PURE__ */ Z("div", {
							className: "flex items-center gap-3",
							children: [b.status === "running" ? /* @__PURE__ */ X(ut, { size: bt.Small }) : /* @__PURE__ */ X(R, { iconName: b.status === "completed" ? H.CheckCircle : H.Danger }), /* @__PURE__ */ Z("div", { children: [/* @__PURE__ */ X("p", {
								className: "label-medium text-basic-primary capitalize",
								children: b.status
							}), /* @__PURE__ */ Z("p", {
								className: "text-small text-basic-tertiary break-all",
								children: [
									b.repository,
									" · ",
									b.branch
								]
							})] })]
						}),
						/* @__PURE__ */ X("pre", {
							className: "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-elevation-level-2 p-3 code-small text-basic-secondary",
							children: b.progress || "Preparing clone…"
						}),
						b.error ? /* @__PURE__ */ X("p", {
							className: "text-small text-error-primary",
							children: b.error
						}) : null
					]
				}) : null,
				S ? /* @__PURE__ */ X("p", {
					className: "text-small text-error-primary",
					children: S
				}) : null
			]
		})
	});
}
// src/app/features/managed/controller/ManagedHostProvider.tsx
function iA({ children: e }) {
	let t = Pr(), [n, r] = J(!1), [i, a] = J("status"), [o, s] = J(!1), [c, l] = J(!1), u = t.data ?? null, d = W(() => {
		l(!1), a("status"), r(!0);
	}, []), f = W(() => {
		s(!1), l(!0), a("github"), r(!0);
	}, []), p = W(() => {
		u?.github_status === "connected" ? s(!0) : f();
	}, [f, u?.github_status]), m = W(() => {
		c && (l(!1), r(!1), s(!0));
	}, [c]), h = K(() => ({
		status: u,
		isManaged: u?.managed === !0,
		openSettings: d,
		addRepository: p
	}), [
		p,
		d,
		u
	]);
	return /* @__PURE__ */ Z(eh.Provider, {
		value: h,
		children: [
			e,
			/* @__PURE__ */ X(eA, {
				open: n,
				tab: i,
				onTabChange: a,
				onClose: () => {
					r(!1), l(!1);
				},
				onGitHubConnected: m
			}),
			o ? /* @__PURE__ */ X(rA, {
				open: !0,
				onClose: () => s(!1),
				onConnect: f
			}) : null
		]
	});
}
// src/App.tsx
function aA() {
	let { sessionId: e } = Mi();
	return /* @__PURE__ */ Z("section", {
		className: "relative flex h-full min-h-0 overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ X(Cg, {}), /* @__PURE__ */ X(Bk, {}, e)]
	});
}
function oA() {
	return Tt().orchestrationEnabled ? /* @__PURE__ */ X(Pv, {}) : /* @__PURE__ */ X(wi, {
		to: fn.list(),
		replace: !0
	});
}
function sA() {
	return /* @__PURE__ */ X(Li, { children: /* @__PURE__ */ X(Dn, { children: /* @__PURE__ */ X(zm, { children: /* @__PURE__ */ X(Tm, { children: /* @__PURE__ */ X(iA, { children: /* @__PURE__ */ Z(Di, { children: [
		/* @__PURE__ */ Z(Ei, {
			element: /* @__PURE__ */ X(vg, {}),
			children: [
				/* @__PURE__ */ X(Ei, {
					path: "/",
					element: /* @__PURE__ */ X(ty, {})
				}),
				/* @__PURE__ */ X(Ei, {
					path: "/project/:projectId",
					element: /* @__PURE__ */ X(Iv, {})
				}),
				/* @__PURE__ */ X(Ei, {
					path: "/session/:sessionId/:panel?",
					element: /* @__PURE__ */ X(aA, {})
				})
			]
		}),
		/* @__PURE__ */ X(Ei, {
			path: "/design",
			element: /* @__PURE__ */ X(oA, {})
		}),
		/* @__PURE__ */ X(Ei, {
			path: "*",
			element: /* @__PURE__ */ X(wi, {
				to: fn.list(),
				replace: !0
			})
		})
	] }) }) }) }) }) });
}
// src/app/providers/ThemeProvider.tsx
var cA = [
	"light",
	"dark",
	"system"
], lA = "nac-theme", uA = "dark", dA = si(null), fA = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
function pA(e) {
	return uA;
}
function mA() {
	let e = document.documentElement;
	e.setAttribute("data-theme", uA), e.classList.remove("light", "dark"), e.classList.add(uA), e.style.colorScheme = uA;
}
function hA() {
	let e = localStorage.getItem(lA);
	return e && cA.includes(e) ? e : fA() ? "dark" : "light";
}
var gA = ({ children: e, local: t = !1 }) => {
	let [n, r] = J(() => t ? "dark" : hA()), i = W((e) => {
		cA.includes(e) && (r(e), t || (localStorage.setItem(lA, e), mA()));
	}, [t]), a = W(() => {
		r((e) => {
			let n = e === "light" ? "dark" : e === "dark" ? "system" : "light";
			return t || (localStorage.setItem(lA, n), mA()), n;
		});
	}, [t]);
	return G(() => {
		t || mA();
	}, [t]), /* @__PURE__ */ X(dA.Provider, {
		value: {
			theme: n,
			resolved: pA(n),
			setTheme: i,
			toggleTheme: a
		},
		children: e
	});
};
function _A() {
	let e = di(dA);
	if (!e) throw Error("useTheme must be used within a ThemeProvider");
	return e;
}
// src/app/runtime/NativePresentationRoot.tsx
function vA(e) {
	return /* @__PURE__ */ X(yA, { ...e }, e.runtime.id);
}
function yA({ runtime: e, router: t, theme: n, className: r, styles: i, globalKeyboard: a }) {
	if (G(() => e.retain(), [e]), mi(e.subscribe, e.isClosed, e.isClosed)) return null;
	let o = /* @__PURE__ */ X(bA, {
		runtime: e,
		className: r,
		styles: i,
		globalKeyboard: a,
		children: t(/* @__PURE__ */ X(sA, {}))
	});
	return /* @__PURE__ */ X(Tr.Provider, {
		value: e,
		children: /* @__PURE__ */ X(hi, {
			client: e.queryClient,
			children: n ? n(o) : /* @__PURE__ */ X(gA, {
				local: !0,
				children: o
			})
		})
	});
}
function bA({ runtime: e, className: t, styles: n, globalKeyboard: r, children: i }) {
	let { resolved: a } = _A();
	return /* @__PURE__ */ Z("div", {
		className: `${t ?? "nac-presentation h-full min-h-0"} ${a}`,
		style: { contain: "layout paint" },
		"data-nac-runtime": e.id,
		"data-theme": a,
		children: [n, /* @__PURE__ */ X(Ze, {
			globalKeyboard: r,
			children: i
		})]
	});
}
export { vA as NativePresentationRoot, hr as NativeRuntime, Tr as RuntimeContext, On as createNativeRuntime, V as useNativeRuntime };
