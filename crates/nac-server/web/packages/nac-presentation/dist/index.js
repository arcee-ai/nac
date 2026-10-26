import { $ as e, $n as t, $r as n, $t as r, A as i, Ai as a, An as o, Ar as s, At as c, B as l, Bi as u, Bn as d, Br as f, Bt as p, C as m, Ci as h, Cn as g, Cr as _, Ct as v, D as y, Di as b, Dn as x, Dr as S, Dt as C, E as w, Ei as T, En as E, Er as D, Et as O, F as k, Fi as A, Fn as j, Fr as ee, Ft as M, G as te, Gi as ne, Gn as N, Gr as P, Gt as re, H as ie, Hi as ae, Hn as oe, Hr as se, Ht as ce, I as le, Ii as ue, In as F, Ir as I, It as de, J as fe, Jn as pe, Jr as me, Jt as he, K as ge, Ki as _e, Kn as ve, Kr as ye, Kt as be, L as xe, Li as Se, Ln as Ce, Lr as L, Lt as we, M as Te, Mi as Ee, Mn as De, Mt as Oe, N as ke, Ni as Ae, Nn as je, Nr as Me, Nt as Ne, O as Pe, Oi as Fe, On as Ie, Or as Le, Ot as Re, P as ze, Pi as Be, Pn as Ve, Pr as R, Pt as He, Q as Ue, Qn as We, Qr as Ge, Qt as Ke, R as qe, Ri as Je, Rn as Ye, Rr as z, Rt as Xe, S as Ze, Si as Qe, Sn as $e, Sr as et, St as tt, T as nt, Ti as rt, Tn as it, Tr as at, Tt as ot, U as st, Ui as ct, Un as lt, Ur as B, Ut as ut, V as dt, Vi as ft, Vn as pt, Vr as mt, Vt as ht, W as gt, Wi as _t, Wn as vt, Wr as V, Wt as yt, X as bt, Xn as xt, Xr as St, Xt as Ct, Y as wt, Yn as Tt, Yr as Et, Yt as Dt, Z as Ot, Zn as kt, Zr as At, Zt as jt, _ as Mt, _i as Nt, _n as Pt, _r as Ft, _t as It, a as Lt, ai as Rt, an as zt, ar as Bt, at as Vt, b as Ht, bi as Ut, bn as Wt, br as Gt, bt as Kt, c as qt, ci as Jt, cn as Yt, cr as Xt, ct as Zt, d as Qt, di as $t, dn as en, dr as tn, dt as nn, ei as rn, en as an, er as on, et as sn, f as cn, fi as ln, fn as un, fr as dn, ft as fn, g as pn, gi as mn, gn as hn, gr as gn, gt as _n, h as vn, hi as yn, hn as bn, hr as xn, ht as Sn, i as Cn, ii as wn, in as Tn, ir as En, it as Dn, j as On, ji as kn, jn as An, jr as jn, jt as Mn, k as Nn, ki as Pn, kn as Fn, kr as In, kt as Ln, l as Rn, li as zn, ln as Bn, lr as Vn, lt as Hn, m as Un, mi as Wn, mn as Gn, mr as Kn, mt as qn, n as Jn, ni as Yn, nn as Xn, nr as Zn, nt as Qn, o as $n, oi as er, on as tr, or as nr, ot as rr, p as ir, pi as ar, pn as or, pr as sr, pt as cr, q as lr, qi as ur, qn as dr, qr as fr, qt as pr, r as mr, ri as hr, rn as gr, rr as _r, rt as vr, s as yr, si as br, sn as xr, sr as Sr, st as Cr, t as wr, ti as Tr, tn as Er, tr as Dr, tt as Or, u as kr, ui as Ar, un as jr, ut as Mr, v as Nr, vi as Pr, vn as Fr, vr as Ir, vt as Lr, w as Rr, wi as zr, wn as Br, wr as Vr, wt as Hr, x as Ur, xi as Wr, xn as Gr, xr as Kr, xt as qr, y as Jr, yi as Yr, yn as Xr, yr as Zr, yt as Qr, z as $r, zn as ei, zr as H, zt as ti } from "./chunks/PerfProfiler-DqNS-YJ8.js";
import ni, { Fragment as ri, Suspense as ii, createContext as ai, lazy as oi, memo as si, useCallback as U, useContext as ci, useEffect as W, useId as li, useLayoutEffect as ui, useMemo as G, useRef as K, useState as q, useSyncExternalStore as di } from "react";
import { QueryClientProvider as fi, QueryObserver as pi, useIsFetching as mi, useMutation as hi, useQueries as gi, useQuery as _i, useQueryClient as vi } from "@tanstack/react-query";
import { Link as yi, Navigate as bi, Outlet as xi, Route as Si, Routes as Ci, useLocation as wi, useNavigate as Ti, useParams as Ei } from "react-router-dom";
import { Fragment as J, jsx as Y, jsxs as X } from "react/jsx-runtime";
import { flushSync as Di } from "react-dom";
// src/app/features/ui-policy/UiPolicyProvider.tsx
var Oi = /* @__PURE__ */ new WeakMap(), ki = 0;
function Ai(e) {
	let t = Oi.get(e);
	return t === void 0 && (t = ++ki, Oi.set(e, t)), t;
}
function ji({ children: e, client: t }) {
	let r = n(), i = t ?? r.client, a = _i({
		queryKey: [
			"ui-configuration",
			i.transport.endpoint,
			Ai(i)
		],
		queryFn: async ({ signal: e }) => {
			let t = await i.getUiConfiguration(e);
			if (typeof t.orchestration_enabled != "boolean" || t.diagnostic !== null && typeof t.diagnostic != "string") throw Error("Invalid UI configuration response");
			return t;
		},
		retry: !1,
		staleTime: Infinity
	}), o = G(() => ({ orchestrationEnabled: a.data?.orchestration_enabled === !0 }), [a.data]);
	return a.isPending ? /* @__PURE__ */ Y("div", {
		role: "status",
		className: "p-8",
		children: "Loading workspace configuration…"
	}) : a.isError ? /* @__PURE__ */ X("div", {
		role: "alert",
		className: "p-8",
		children: [
			"Workspace configuration could not be loaded.",
			" ",
			/* @__PURE__ */ Y("button", {
				onClick: () => void a.refetch(),
				children: "Try again"
			})
		]
	}) : /* @__PURE__ */ X(ye.Provider, {
		value: o,
		children: [a.data.diagnostic ? /* @__PURE__ */ Y("div", {
			role: "alert",
			className: "p-3",
			children: a.data.diagnostic
		}) : null, e]
	});
}
// src/app/atoms/avatar/index.tsx
var Mi = /* @__PURE__ */ function(e) {
	return e.Micro = "size-4 avatar-xs", e.Small = "size-5 avatar-sm", e.Medium = "size-6 avatar-md", e.Large = "size-8 avatar-xl", e.XLarge = "size-12 avatar-4xl", e.MediumLarge = "size-7 avatar-lg", e.X2Large = "size-9 avatar-2xl", e.X3Large = "size-10 avatar-3xl", e;
}({}), Ni = "var(--color-bg-elevation-ground-inverse)", Pi = ({ imageUrl: e, name: t, size: n = "size-6 avatar-md", color: r = Ni, glyph: i = !1, className: a = "" }) => {
	let [o, s] = ni.useState(null), c = t?.trim() ?? "", l = i ? c : c[0]?.toUpperCase() ?? "?", u = !!e && o !== e;
	return /* @__PURE__ */ Y("div", {
		className: P("avatar inline-flex items-center justify-center shrink-0 overflow-hidden rounded-full", n, u ? "border-tertiary bg-elevation-level-3" : P("border-secondary-inversed", i || r !== Ni ? "text-primary-inverse" : "text-tertiary-inverse"), a),
		style: u ? void 0 : { background: r },
		children: u ? /* @__PURE__ */ Y("img", {
			src: e ?? void 0,
			alt: c,
			className: "size-full rounded-full object-cover",
			onError: () => s(e ?? null)
		}) : l
	});
};
Pi.Size = Mi;
// src/app/atoms/badge/index.tsx
var Fi = /* @__PURE__ */ function(e) {
	return e.Neutral = "bg-elevation-sublevel-variant-B text-basic-tertiary border-tertiary", e.Green = "bg-success-secondary text-success-primary border-success-secondary", e.Blue = "bg-info-secondary text-info-primary border-info-secondary", e.Red = "bg-error-secondary text-error-primary border-error-secondary", e.Yellow = "bg-danger-secondary text-danger-primary border-danger-secondary", e.Gray = "bg-elevation-sublevel-variant-A text-basic-secondary border-muted", e;
}({}), Ii = {
	"bg-elevation-sublevel-variant-B text-basic-tertiary border-tertiary": "text-basic-muted",
	"bg-success-secondary text-success-primary border-success-secondary": "text-success-primary",
	"bg-info-secondary text-info-primary border-info-secondary": "text-info-primary",
	"bg-error-secondary text-error-primary border-error-secondary": "text-error-primary",
	"bg-danger-secondary text-danger-primary border-danger-secondary": "text-danger-primary",
	"bg-elevation-sublevel-variant-A text-basic-secondary border-muted": "text-basic-secondary"
}, Li = ({ text: e, color: t = "bg-elevation-sublevel-variant-B text-basic-tertiary border-tertiary", background: n = !0, className: r = "" }) => /* @__PURE__ */ Y("span", {
	className: P("badge inline-flex items-center justify-center whitespace-nowrap rounded-full", n ? P("badge-filled border", t) : Ii[t], r),
	children: e
});
Li.Color = Fi;
// src/app/atoms/box-surface/index.tsx
var Ri = ({ title: e, headerContent: t, footer: n, className: r = "", bodyClassName: i = "", children: a }) => {
	let o = e != null || t != null;
	return /* @__PURE__ */ X("div", {
		className: P("flex flex-col rounded-[8px] overflow-hidden bg-elevation-level-1 shadow-convex", r),
		children: [
			o ? /* @__PURE__ */ X("div", {
				className: "flex items-center gap-4 h-14 px-4 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ Y("div", {
					className: "header-md text-basic-primary flex-1 min-w-0 truncate",
					children: e
				}), t]
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: P("flex-1 min-h-0 flex flex-col [&>*]:shrink-0", i),
				children: a
			}),
			n ? /* @__PURE__ */ Y("div", {
				className: "flex items-center p-4 border-t border-muted shrink-0",
				children: n
			}) : null
		]
	});
}, zi = /* @__PURE__ */ function(e) {
	return e.Small = "w-1.5 h-1.5", e.Medium = "w-2 h-2", e.Large = "w-3 h-3", e;
}({}), Bi = ({ size: e = "w-2 h-2", className: t = "" }) => /* @__PURE__ */ Y("div", {
	role: "status",
	"aria-label": "Waiting for a response",
	className: P("flex items-end gap-1 fade", t),
	children: [
		0,
		1,
		2
	].map((t) => /* @__PURE__ */ Y("span", { className: P("chat-loader-dot rounded-full bg-divider-secondary", e) }, t))
});
Bi.Size = zi;
// src/app/atoms/chat-session-fork-mark/index.tsx
var Vi = ({ forkedFromTitle: e, running: t = !1, className: n = "" }) => {
	if (t) return /* @__PURE__ */ Y(f, {
		size: mt.XSmall,
		variant: se.Neutral,
		className: "shrink-0"
	});
	let r = e?.trim();
	if (!r) return null;
	let i = `Fork of ${r}`;
	return /* @__PURE__ */ Y(Ir, {
		title: i,
		position: Ir.Position.BottomCenter,
		sticky: !0,
		className: "shrink-0",
		children: /* @__PURE__ */ Y("span", {
			className: "inline-flex shrink-0",
			"aria-label": i,
			children: /* @__PURE__ */ Y(B, {
				iconName: V.Scheme,
				size: 16,
				className: P("shrink-0", n)
			})
		})
	});
}, Hi = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), Ui = /* @__PURE__ */ function(e) {
	return e.Default = "default", e.Accent = "accent", e;
}({}), Wi = {
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
}, Gi = {
	default: "bg-btn-primary",
	accent: "bg-accent-inverse"
}, Ki = [
	"opacity-0",
	"opacity-25",
	"opacity-100"
], qi = [
	0,
	.25,
	1
], Ji = 400, Yi = 16, Xi = "cubic-bezier(0.4, 0, 0.2, 1)", Zi = {
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
}, Qi = 1, $i = "(prefers-reduced-motion: reduce)", ea = () => typeof window.matchMedia == "function" ? window.matchMedia($i) : null, ta = (e) => {
	let t = ea();
	return t?.addEventListener("change", e), () => t?.removeEventListener("change", e);
}, na = () => ea()?.matches ?? !1, ra = () => Math.floor(Math.random() * qi.length), ia = (e) => [
	e,
	...Array.from({ length: 15 }, ra),
	e
].map((e, t) => ({
	offset: t / Yi,
	opacity: qi[e],
	easing: Xi
})), aa = ({ size: e = "medium", variant: t = "default", frame: n, label: r, className: i = "" }) => {
	let a = K(null), o = di(ta, na, na), s = n === void 0 && !o;
	W(() => {
		let e = a.current;
		if (!s || typeof e?.animate != "function") return;
		let t = Array.from(e.children, (e, t) => e.animate(ia(Zi[Qi][t]), {
			duration: Yi * Ji,
			delay: Math.random() * Ji,
			iterations: Infinity
		}));
		return () => t.forEach((e) => e.cancel());
	}, [s]);
	let { box: c, dot: l } = Wi[e];
	return /* @__PURE__ */ Y("span", {
		ref: a,
		role: r ? "status" : void 0,
		"aria-label": r,
		"aria-hidden": !r || void 0,
		"data-variant": t,
		"data-frame": n,
		className: P("grid shrink-0 grid-cols-4 grid-rows-4 gap-[2px] p-px", c, i),
		children: Zi[n ?? Qi].map((e, n) => /* @__PURE__ */ Y("span", { className: P("rounded-[1px]", l, Gi[t], Ki[e]) }, n))
	});
};
aa.Size = Hi, aa.Variant = Ui;
// src/app/lib/sessionBehavior.ts
var oa = [
	{
		id: "orchestrator",
		label: "NAC orchestrator",
		navigationLabel: "Orchestrator",
		topLevel: "A planner handles the top-level conversation.",
		editsDirectly: !1,
		editing: "The planner does not edit directly.",
		delegation: "It delegates coding to retained NAC worker threads.",
		inspection: "Threads and Worksets show the plan and worker progress."
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
function sa(e) {
	return oa.find((t) => t.id === e) ?? oa[0];
}
function ca(e, t) {
	if (t === "managed-orchestrator") return V.Orchestrator;
	if (t === "traditional-child") return V.Plane;
	switch (e) {
		case "direct": return V.Plane;
		case "direct-with-orchestrator": return V.PlaneAdd;
		default: return V.Orchestrator;
	}
}
var la = {
	widePanels: [
		"threads",
		"files",
		"worksets"
	],
	mobilePanels: [
		"threads",
		"files",
		"worksets",
		"history"
	],
	defaultPanel: "files",
	readOnly: !1
}, ua = {
	widePanels: [
		"delegated",
		"files",
		"terminal"
	],
	mobilePanels: [
		"delegated",
		"files",
		"terminal",
		"history"
	],
	defaultPanel: "files",
	readOnly: !1
}, da = {
	widePanels: ["files"],
	mobilePanels: ["files", "history"],
	defaultPanel: "files",
	readOnly: !0
}, fa = {
	...la,
	readOnly: !0
};
function pa(e, t) {
	return t === "traditional-child" ? da : t === "managed-orchestrator" ? fa : sa(e).id === "orchestrator" ? la : ua;
}
// src/app/atoms/session-behavior-icon/index.tsx
var ma = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), ha = {
	small: 16,
	medium: 20,
	large: 24
}, ga = ({ behavior: e, lineage: t, size: n = "medium", className: r }) => {
	let i = ca(e, t);
	return /* @__PURE__ */ Y(B, {
		iconName: i,
		size: ha[n],
		"aria-hidden": !0,
		"data-session-behavior-icon": i,
		className: P("shrink-0", r)
	});
}, _a = "[&_path]:fill-btn-secondary group-hover:[&_path]:fill-btn-secondary-hovered group-has-[>button:active]:[&_path]:fill-btn-secondary-pressed group-has-[>button:disabled]:[&_path]:fill-btn-secondary-disabled", va = ({ title: e, active: t = !1, running: n = !1, behavior: r, lineage: i, showBehaviorIcon: a = !1, behaviorLabel: o, forkedFromTitle: s, badge: c, badgeLabel: l, unread: u = !1, isMobile: d = !1, actions: f, className: p = "", type: m = "button", "aria-label": h, ...g }) => {
	let _ = [
		e,
		o,
		l
	].filter(Boolean);
	return /* @__PURE__ */ X("div", {
		className: P("group flex items-center min-w-0 rounded-[4px]", "-outline-offset-2 outline-[var(--color-border-focus-outline)] has-[>button:focus-visible]:outline-2", d ? "h-12 gap-3 py-2 pl-2.5 pr-3" : "h-9 gap-1.5 px-2 py-1", t ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered has-[>button:active]:bg-btn-ghost-highlighted-pressed has-[>button:disabled]:bg-btn-ghost-highlighted-disabled" : "hover:bg-btn-ghost-hovered has-[>button:active]:bg-btn-ghost-pressed has-[>button:disabled]:bg-btn-ghost-disabled", p),
		children: [/* @__PURE__ */ X("button", {
			type: m,
			title: _.join(" · "),
			"aria-label": h ?? _.join(", "),
			"aria-current": t ? "page" : void 0,
			className: P("flex flex-1 items-center min-w-0 text-left outline-none", t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered active:text-btn-secondary-pressed", "disabled:cursor-not-allowed disabled:text-btn-secondary-disabled", d ? "gap-3" : "gap-1.5"),
			...g,
			children: [
				n ? /* @__PURE__ */ Y(aa, { size: d ? Hi.Large : Hi.Medium }) : a ? /* @__PURE__ */ Y(ga, {
					behavior: r,
					lineage: i,
					size: d ? ma.Large : ma.Medium,
					className: _a
				}) : null,
				/* @__PURE__ */ Y("span", {
					className: P("min-w-0 flex-1 truncate", d ? "label-medium" : "label-small", n && "text-shimmer-basic"),
					children: e
				}),
				/* @__PURE__ */ Y(Vi, {
					forkedFromTitle: s,
					className: "[&_path]:fill-btn-secondary-disabled"
				}),
				c ? /* @__PURE__ */ Y("span", {
					title: l,
					className: "tag-label max-w-[76px] shrink-0 truncate rounded bg-elevation-level-3 px-1 text-basic-tertiary",
					children: c
				}) : null,
				u ? /* @__PURE__ */ Y("span", {
					className: "h-2 w-2 shrink-0 rounded-full bg-accent-primary",
					title: "Updated since last viewed",
					children: /* @__PURE__ */ Y("span", {
						className: "sr-only",
						children: "Unread"
					})
				}) : null
			]
		}), f ? /* @__PURE__ */ Y("div", {
			className: P("flex items-center gap-1 shrink-0", d ? null : "sr-only group-hover:not-sr-only group-has-[:focus-visible]:not-sr-only focus-within:not-sr-only group-has-[>button:disabled]:hidden"),
			children: f
		}) : null]
	});
}, ya = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), ba = {
	info: "border-info-primary text-info-primary",
	error: "border-error-primary text-error-primary",
	danger: "border-danger-primary text-danger-primary",
	success: "border-success-primary text-success-primary"
}, xa = {
	info: V.Info,
	error: V.Close,
	danger: V.Danger,
	success: V.CheckCircle
}, Sa = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, Ca = ({ title: e, variant: t = "info", action: n, className: r = "", children: i, ...a }) => /* @__PURE__ */ Y("div", {
	className: P("flex w-full items-start overflow-hidden border-l-2 px-4 py-2", ba[t], r),
	...a,
	children: /* @__PURE__ */ X("div", {
		className: "flex flex-1 min-w-0 flex-col items-start gap-2",
		children: [
			/* @__PURE__ */ X("div", {
				className: "flex w-full items-start gap-1.5",
				children: [/* @__PURE__ */ Y(B, {
					iconName: xa[t],
					size: 20,
					color: Sa[t],
					className: "shrink-0"
				}), /* @__PURE__ */ Y("p", {
					className: "flex-1 min-w-0 header-sm break-words !my-0",
					children: e
				})]
			}),
			i ? /* @__PURE__ */ Y("div", {
				className: "w-full text-small break-words",
				children: i
			}) : null,
			n ? /* @__PURE__ */ Y(I, {
				size: z.Small,
				variant: H.Primary,
				content: L.Text,
				onClick: n.onClick,
				children: n.label
			}) : null
		]
	})
});
Ca.Variant = ya;
// src/app/atoms/chat-session-orphan-avatar/index.tsx
var wa = (e) => Math.round(e * .7 / 4) * 4, Ta = (e) => Math.round(e / 10), Ea = ({ size: e = 40, isRunning: t = !1, className: n = "", ...r }) => /* @__PURE__ */ Y("div", {
	className: P("flex items-center justify-center shrink-0", "border border-muted bg-elevation-sublevel-variant-B", n),
	style: {
		width: e,
		height: e,
		borderRadius: Ta(e)
	},
	"aria-hidden": "true",
	...r,
	children: /* @__PURE__ */ Y(B, {
		iconName: V.Chat,
		size: wa(e),
		className: P("text-basic-secondary", t && "pulse-dim")
	})
}), Da = ({ rows: e = 3, className: t = "", rowClassName: n = "" }) => /* @__PURE__ */ Y("div", {
	className: P("flex flex-col gap-2", t),
	children: Array.from({ length: e }).map((e, t) => /* @__PURE__ */ Y("div", {
		className: P("relative h-4 rounded-[4px] overflow-hidden bg-elevation-level-2", n),
		children: /* @__PURE__ */ Y("div", {
			className: "absolute inset-0 animate-shimmer bg-[length:200%_100%] bg-[position:-200%_0] opacity-50",
			style: { backgroundImage: "linear-gradient(90deg, transparent 0%, var(--color-bg-btn-secondary-highlighted-hovered) 50%, transparent 100%)" }
		})
	}, t))
}), Oa = ({ title: e, active: t = !1, running: n = !1, forkedFromTitle: r, behavior: i, showBehaviorIcon: a = !1, behaviorLabel: o, onDismiss: s, className: c = "", type: l = "button", "aria-label": u, ...d }) => {
	let f = n ? "text-shimmer-basic" : r ? "text-btn-secondary group-hover:text-btn-secondary-hovered" : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered", p = t && !r ? "[&_path]:fill-btn-secondary-pressed" : "[&_path]:fill-btn-secondary group-hover:[&_path]:fill-btn-secondary-hovered", m = /* @__PURE__ */ X("button", {
		type: l,
		title: e,
		"aria-label": u ?? (o ? `${e}, ${o}` : e),
		"aria-current": t ? "page" : void 0,
		className: "flex h-10 w-full min-w-0 flex-1 items-center justify-start gap-1 py-1 pl-2 pr-2 group-hover:pr-8 group-has-[:focus-visible]:pr-8",
		...d,
		children: [
			/* @__PURE__ */ Y(Vi, {
				forkedFromTitle: r,
				running: n,
				className: n ? void 0 : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered"
			}),
			a ? /* @__PURE__ */ Y(ga, {
				behavior: i,
				size: ma.Small,
				className: p
			}) : null,
			/* @__PURE__ */ Y("span", {
				"data-session-tab-title": !0,
				className: P("label-micro w-full min-w-0 flex-1 truncate text-left", f),
				children: e
			})
		]
	});
	return /* @__PURE__ */ X("div", {
		className: P("chat-session-tab group relative flex w-32 max-w-full shrink-0 items-center justify-start gap-1", t ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered" : "hover:bg-btn-ghost-hovered", c),
		children: [o ? /* @__PURE__ */ Y(Ir, {
			title: o,
			position: Ir.Position.BottomLeft,
			sticky: !0,
			className: "min-w-0 flex-1",
			children: m
		}) : m, s ? /* @__PURE__ */ Y(I, {
			variant: H.Tertiary,
			size: z.Small,
			content: L.Icon,
			"aria-label": `Close ${e}`,
			title: "Close tab",
			onClick: (e) => {
				e.stopPropagation(), s();
			},
			className: "absolute right-1 top-1/2 -translate-y-1/2 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto",
			children: /* @__PURE__ */ Y(B, { iconName: V.Close })
		}) : null]
	});
}, ka = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ X("label", {
	className: P("group flex w-fit items-center gap-2", n ? "cursor-not-allowed" : "cursor-pointer", i),
	children: [/* @__PURE__ */ X("span", {
		className: "relative flex h-5 w-5 shrink-0 items-center justify-center",
		children: [
			/* @__PURE__ */ Y("input", {
				type: "checkbox",
				checked: e,
				onChange: (e) => t(e.target.checked),
				disabled: n,
				className: "peer sr-only",
				...a
			}),
			/* @__PURE__ */ Y("span", {
				"aria-hidden": "true",
				className: P("h-4 w-4 rounded-[4px] border bg-btn-secondary", n ? "border-muted" : "border-secondary group-hover:bg-btn-secondary-hovered group-active:bg-btn-secondary-pressed")
			}),
			e ? /* @__PURE__ */ Y(B, {
				iconName: V.Check,
				size: 20,
				"aria-hidden": "true",
				color: n ? "var(--color-fill-basic-muted)" : "var(--color-fill-basic-primary)",
				className: "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
			}) : null,
			/* @__PURE__ */ Y("span", {
				"aria-hidden": "true",
				className: "pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-[8px] border-2 border-[var(--color-border-focus-outline)] opacity-0 peer-focus-visible:opacity-100"
			})
		]
	}), r ? /* @__PURE__ */ Y("span", {
		className: P("label-small", n ? "text-basic-muted" : "text-basic-primary"),
		children: r
	}) : null]
}), Aa = "en-US", ja = new Intl.DateTimeFormat(Aa, {
	month: "long",
	year: "numeric"
}), Ma = new Intl.DateTimeFormat(Aa, { weekday: "short" }), Na = (e) => new Date(e.getFullYear(), e.getMonth(), 1), Pa = (e, t) => new Date(e.getFullYear(), e.getMonth() + t, 1), Fa = (e, t) => new Date(e.getFullYear(), e.getMonth(), e.getDate() + t), Ia = (e) => new Date(e.getFullYear(), e.getMonth(), e.getDate()), La = (e, t) => e.getFullYear() === t.getFullYear() && e.getMonth() === t.getMonth() && e.getDate() === t.getDate(), Ra = (e) => La(e, /* @__PURE__ */ new Date()), za = (e, t, n) => {
	let r = Ia(e).getTime();
	return r >= Ia(t).getTime() && r <= Ia(n).getTime();
}, Ba = (e, t, n) => {
	let r = Ia(e).getTime();
	return !!(t && r < Ia(t).getTime() || n && r > Ia(n).getTime());
}, Va = (e) => ja.format(e), Ha = () => {
	let e = new Date(2021, 7, 1);
	return Array.from({ length: 7 }, (t, n) => Ma.format(Fa(e, n)));
}, Ua = (e) => `${e.getFullYear()}-${e.getMonth()}-${e.getDate()}`;
function Wa(e) {
	let t = Na(e), n = t.getDay(), r = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate(), i = [];
	for (let e = -n; e < 0; e += 1) i.push({
		date: Fa(t, e),
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
function Ga(e, t, n, r) {
	return e || t ? H.Primary : n ? H.GhostHighlightedAccent : r ? H.SecondaryHighlighted : H.Ghost;
}
var Ka = ({ days: e, selected: t, range: n, focused: r, min: i, max: a, disabled: o = !1, onSelect: s, onFocusDay: c, onNavigate: l }) => {
	let u = K(null);
	W(() => {
		let e = u.current;
		if (!r || !e) return;
		let t = requestAnimationFrame(() => {
			let t = e.querySelector(`button[data-day="${Ua(r)}"]`);
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
	return /* @__PURE__ */ Y("div", {
		ref: u,
		className: "grid grid-cols-7 gap-y-1 p-2",
		role: "rowgroup",
		children: e.map(({ date: e, inMonth: l }) => {
			let u = t ? La(e, t) : !1, f = n?.from ? La(e, n.from) : !1, p = n?.to ? La(e, n.to) : !1, m = n?.from && n?.to ? za(e, n.from, n.to) : !1, h = o || !l || Ba(e, i, a), g = f && p ? null : f ? "rounded-r-none" : p ? "rounded-l-none" : m ? "rounded-none" : null;
			return /* @__PURE__ */ Y("div", {
				role: "gridcell",
				"aria-selected": u,
				children: /* @__PURE__ */ Y(I, {
					"data-day": Ua(e),
					variant: Ga(u, f || p, m, Ra(e)),
					size: z.Medium,
					disabled: h,
					tabIndex: r && La(e, r) ? 0 : -1,
					className: P("w-full", g, !l && "invisible"),
					onClick: () => s(e),
					onFocus: () => c(e),
					onKeyDown: (t) => d(t, e),
					children: e.getDate()
				})
			}, Ua(e));
		})
	});
}, qa = Ha(), Ja = ({ selected: e, onSelect: t, range: n, onRangeChange: r, min: i, max: a, disabled: o = !1, defaultMonth: s, className: c = "" }) => {
	let l = n ? n.to ?? n.from : e, [u, d] = q(() => Na(s ?? l ?? /* @__PURE__ */ new Date())), [f, p] = q(l), m = G(() => Wa(u), [u]);
	return /* @__PURE__ */ X("div", {
		role: "group",
		"aria-label": "Calendar",
		className: P("flex flex-col min-w-0 w-[280px]", c),
		children: [
			/* @__PURE__ */ X("div", {
				className: "flex items-center justify-between gap-2 p-1 border-b border-muted",
				children: [
					/* @__PURE__ */ Y(I, {
						variant: H.Ghost,
						size: z.Medium,
						content: L.Icon,
						"aria-label": "Previous month",
						onClick: () => d((e) => Pa(e, -1)),
						children: /* @__PURE__ */ Y(B, { iconName: V.Left })
					}),
					/* @__PURE__ */ Y("div", {
						className: "label-small text-basic-primary",
						"aria-live": "polite",
						children: Va(u)
					}),
					/* @__PURE__ */ Y(I, {
						variant: H.Ghost,
						size: z.Medium,
						content: L.Icon,
						"aria-label": "Next month",
						onClick: () => d((e) => Pa(e, 1)),
						children: /* @__PURE__ */ Y(B, { iconName: V.Right })
					})
				]
			}),
			/* @__PURE__ */ Y("div", {
				className: "grid grid-cols-7 px-2 pt-2",
				role: "row",
				children: qa.map((e) => /* @__PURE__ */ Y("div", {
					role: "columnheader",
					className: "label-micro text-basic-tertiary text-center py-1",
					children: e
				}, e))
			}),
			/* @__PURE__ */ Y(Ka, {
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
					let n = Fa(e, t);
					p(n), (n.getFullYear() !== u.getFullYear() || n.getMonth() !== u.getMonth()) && d(Na(n));
				}
			})
		]
	});
}, Ya = /* @__PURE__ */ function(e) {
	return e[e.Small = 16] = "Small", e[e.Medium = 20] = "Medium", e[e.Large = 24] = "Large", e;
}({}), Xa = ({ title: e, description: t, size: n = 16, position: r = R.TopCenter, className: i = "", muted: a = !1 }) => /* @__PURE__ */ Y(Ir, {
	title: e,
	description: t,
	position: r,
	sticky: !0,
	showTooltipOnMobile: !0,
	className: i,
	children: /* @__PURE__ */ Y(B, {
		iconName: V.Info,
		size: n,
		className: P("cursor-help shrink-0", a && "[&>path]:!fill-basic-muted"),
		color: a ? void 0 : "var(--color-fill-basic-tertiary)"
	})
});
Xa.Size = Ya;
// src/app/atoms/label/index.tsx
var Za = /* @__PURE__ */ function(e) {
	return e.Micro = "label-micro", e.Small = "label-small", e.Medium = "label-medium", e;
}({}), Qa = {
	"label-micro": 16,
	"label-small": 20,
	"label-medium": 24
}, $a = {
	"label-micro": Ya.Small,
	"label-small": Ya.Small,
	"label-medium": Ya.Medium
}, eo = ({ children: e, htmlFor: t, size: n = "label-small", icon: r, validation: i = !1, tone: a = "secondary", hoverHint: o, className: s = "" }) => /* @__PURE__ */ X("label", {
	htmlFor: t,
	className: P("flex items-center gap-1.5 min-w-0", n, i ? "text-error-primary" : a === "primary" ? "text-basic-primary" : a === "muted" ? "text-basic-muted" : "text-basic-secondary", s),
	children: [
		r ? /* @__PURE__ */ Y(B, {
			iconName: r,
			size: Qa[n],
			className: "shrink-0"
		}) : null,
		/* @__PURE__ */ Y("span", {
			className: "truncate",
			children: e
		}),
		o ? /* @__PURE__ */ Y(Xa, {
			title: o.title,
			description: o.description,
			muted: o.muted,
			size: $a[n]
		}) : null
	]
});
eo.Size = Za;
// src/app/atoms/input/InputWrapper.tsx
var to = ({ label: e, required: t, validation: n, validationText: r, hintText: i, caption: a, hoverHint: o, className: s, children: c }) => {
	let l = a === "compact" ? Za.Micro : Za.Small, u = a === "compact" ? "label-micro" : a === "large" ? "label-small" : "text-micro";
	return /* @__PURE__ */ X("div", {
		className: P("flex text-left flex-col gap-1", s),
		children: [
			e ? /* @__PURE__ */ X("div", {
				className: "flex items-baseline gap-1 min-w-0",
				children: [/* @__PURE__ */ Y(eo, {
					validation: n,
					hoverHint: o,
					tone: "primary",
					size: l,
					className: "min-w-0",
					children: e
				}), t ? /* @__PURE__ */ Y("span", {
					className: P("label-small shrink-0", n ? "text-error-primary" : "text-basic-primary"),
					children: "*"
				}) : null]
			}) : null,
			c,
			n && r ? /* @__PURE__ */ Y("p", {
				className: P(u, "text-error-primary"),
				children: r
			}) : !n && i ? /* @__PURE__ */ Y("p", {
				className: "text-micro text-basic-muted",
				children: i
			}) : null
		]
	});
}, no = (e) => `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`, ro = (e) => {
	let t = e?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (t) return new Date(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
}, io = (e) => {
	let t = ro(e);
	return t ? t.toLocaleDateString("en-US") : "";
}, ao = ({ value: e, onChange: t, range: n, onRangeChange: r, size: i = z.Medium, disabled: a = !1, validation: o, validationText: s, placement: c = R.BottomRight, min: l, max: u, placeholder: d, label: f, required: p, hintText: m, hoverHint: h, className: g = "" }) => {
	let [_, v] = q(!1), y = !!n, b = y ? n?.from || n?.to ? `${io(n?.from) || "Start"} – ${io(n?.to) || "End"}` : d ?? "Select range" : (io(e) || d) ?? "Select date", x = y ? /* @__PURE__ */ Y(Ja, {
		range: {
			from: ro(n?.from),
			to: ro(n?.to)
		},
		onRangeChange: (e) => {
			r?.({
				from: e.from ? no(e.from) : null,
				to: e.to ? no(e.to) : null
			}), e.from && e.to && v(!1);
		},
		min: ro(l),
		max: ro(u),
		disabled: a
	}) : /* @__PURE__ */ Y(Ja, {
		selected: ro(e),
		onSelect: (e) => {
			t?.(no(e)), v(!1);
		},
		min: ro(l),
		max: ro(u),
		disabled: a
	});
	return /* @__PURE__ */ Y(to, {
		label: f,
		required: p,
		validation: o,
		validationText: s,
		hintText: m,
		hoverHint: h,
		className: g,
		children: /* @__PURE__ */ Y(Zr, {
			open: _,
			onClose: () => v(!1),
			placement: c,
			size: Gt.Fit,
			sticky: !0,
			className: "w-full",
			panelClassName: "p-0",
			content: x,
			children: /* @__PURE__ */ X(I, {
				variant: _ ? H.SecondaryHighlighted : H.Secondary,
				size: i,
				content: L.IconLeft,
				disabled: a,
				"aria-haspopup": "dialog",
				"aria-expanded": _,
				className: P("w-full justify-between", o && "input-validation"),
				onClick: () => v((e) => !e),
				children: [
					/* @__PURE__ */ Y(B, { iconName: V.Calendar }),
					/* @__PURE__ */ Y("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: b
					}),
					/* @__PURE__ */ Y(B, {
						iconName: V.Down,
						className: P("transition-transform", _ && "rotate-180")
					})
				]
			})
		})
	});
}, oo = ({ isOpen: e, children: t, className: n = "", onCloseMaxHeight: r, isScrollable: i = !1, scrollToBottom: a = !1, ...o }) => {
	let s = K(null), c = K(null), [l, u] = q(0), d = K(null);
	W(() => {
		if (s.current) {
			if (e) {
				let e = s.current.scrollHeight;
				u(e);
			} else u(r ?? 0);
		}
	}, [e, r]), W(() => {
		if (!e || !s.current) return;
		let t = () => {
			s.current && u(s.current.scrollHeight);
		}, n = new ResizeObserver(t);
		return n.observe(s.current), t(), () => {
			n.disconnect();
		};
	}, [e]), W(() => {
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
	return /* @__PURE__ */ Y("div", {
		...o,
		ref: c,
		className: P(f, "transition-[height] duration-150 ease-out", n),
		style: {
			height: `${l}px`,
			...o.style
		},
		children: /* @__PURE__ */ Y("div", {
			ref: s,
			children: t
		})
	});
}, so = /* @__PURE__ */ function(e) {
	return e.Micro = "header-micro", e.Small = "header-small", e.Medium = "header-medium", e;
}({}), co = ({ value: e, onCommit: t, size: n = "header-small", placeholder: r = "Untitled", disabled: i = !1, className: a = "" }) => {
	let [o, s] = q(!1), [c, l] = q(e), u = K(null), [d, f] = q(e);
	d !== e && (f(e), o || l(e)), W(() => {
		if (!o) return;
		let e = u.current;
		e?.focus(), e?.select();
	}, [o]);
	let p = () => {
		s(!1);
		let n = c.trim();
		n && n !== e ? t(n) : l(e);
	};
	return /* @__PURE__ */ Y("div", {
		className: P("flex items-center min-w-0 h-8", n, a),
		children: o ? /* @__PURE__ */ Y("input", {
			ref: u,
			value: c,
			placeholder: r,
			className: P("w-full min-w-0 bg-btn-secondary-hovered text-basic-primary font-normal", "rounded-t-[4px] border-b border-primary outline-none px-1", n),
			onChange: (e) => l(e.target.value),
			onBlur: p,
			onKeyDown: (t) => {
				t.key === "Enter" && (t.preventDefault(), p()), t.key === "Escape" && (t.preventDefault(), l(e), s(!1));
			}
		}) : /* @__PURE__ */ Y("button", {
			type: "button",
			disabled: i,
			className: P("min-w-0 truncate text-left text-basic-primary px-1", i ? "cursor-default" : "cursor-text", n),
			onClick: () => !i && s(!0),
			children: e || r
		})
	});
};
co.Size = so;
// src/app/atoms/file-icon/icons/asciidoc.svg?raw
var lo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M4 18V8l5.39 10Zm0 4v3.67A2.33 2.33 0 0 0 6.33 28h8.9l-3.496-6Zm12.444 0 3.177 5.444A11.88 11.88 0 0 0 26.448 22Zm11.419-4A15 15 0 0 0 28 16 12 12 0 0 0 16 4L6 3.995q-.08 0-.158.005L14 18Z\"/></svg>", uo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff6e40\" d=\"M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2v-1H2V2h2V1Zm10 0v1h2v12h-2v1h2a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1ZM6 3c0 1 0 1-1 1v1h1v2h1V3Zm3 0a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm0 1h1v2H9ZM6 9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Zm4 0c0 1 0 1-1 1v1h1v2h1V9Zm-4 1h1v2H6Z\"/></svg>", fo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M12.106 25.849c-1.262-1.156-1.63-3.586-1.105-5.346a5.18 5.18 0 0 0 3.484 1.66 9.68 9.68 0 0 0 5.882-.734c.215-.106.413-.247.648-.39a3.5 3.5 0 0 1 .16 1.555 4.26 4.26 0 0 1-1.798 3.021c-.404.3-.832.569-1.25.852a2.613 2.613 0 0 0-1.15 3.372l.048.161a3.4 3.4 0 0 1-1.5-1.285 3.6 3.6 0 0 1-.578-1.962 9 9 0 0 0-.05-1.037c-.114-.831-.504-1.204-1.238-1.225a1.45 1.45 0 0 0-1.507 1.18c-.012.056-.028.112-.046.178M4.901 20a17.75 17.75 0 0 1 7.4-2l2.913-8.38a.765.765 0 0 1 1.527 0L19.7 18a14.24 14.24 0 0 1 7.399 2S20.704 2.877 20.692 2.842C20.51 2.33 20.202 2 19.787 2h-7.619c-.415 0-.71.33-.904.842z\"/></svg>", po = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m6 10h-4v8a4 4 0 1 1-4-4 3.96 3.96 0 0 1 2 .555V8h6Z\"/></svg>", mo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fbc02d\" d=\"M3 18S4.15 6.885 7 3l5 1-1 3H9v7h1c1.9-2.915 5.783-3.98 8.157-2.915 4.475 1.915 2.998 5.967.148 7.905C16.025 20.548 10.113 23.05 3 18\"/></svg>", ho = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", go = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g transform=\"translate(0 -822.52)\"><rect width=\"107.25\" height=\"156.59\" x=\"405.55\" y=\"967.22\" fill=\"#0097a7\" rx=\"12.306\" ry=\"12.31\" transform=\"matrix(-.98339 .18149 .60192 .79856 0 0)\"/><rect width=\"108.34\" height=\"123.15\" x=\"-1156.5\" y=\"1461.9\" fill=\"#3f51b5\" rx=\"10.69\" ry=\"12.31\" transform=\"matrix(-.98528 .17093 -.59175 .80612 0 0)\"/><path fill=\"#3f51b5\" d=\"M52.112 965.158c-1.343 3.515-26.292 23.248-25.744 27.277.548 4.03 29.812 16.023 32.04 19.027s10.545 41.668 13.603 42.5 18.828-31.274 21.548-32.932 32.808 2.503 34.15-1.01c1.343-3.515-18.174-35.352-18.721-39.381s9.732-40.12 7.502-43.125-30.06 9.427-33.118 8.594-26.793-27.3-29.514-25.643-.405 41.177-1.747 44.693z\"/></g></svg>", _o = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M2 2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h6v3l2-1.25L12 14v-3h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Zm0 1h4v1H2Zm6 0 2 1.25L12 3v2.5l2 1-2 1V10l-2-1.25L8 10V7.5l-2-1 2-1zM2 5h3v1H2Zm0 2h3v1H2Zm0 2h4v1H2Z\"/></svg>", vo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path fill=\"#64dd17\" d=\"M123.456 129.975a507 507 0 0 0-3.54 7.846c-4.406 9.981-9.284 22.127-11.066 29.908-.64 2.77-1.037 6.205-1.03 10.013 0 1.506.081 3.09.21 4.702a58.1 58.1 0 0 0 19.98 3.559 58.2 58.2 0 0 0 18.29-2.98c-1.352-1.237-2.642-2.554-3.816-4.038-7.796-9.942-12.146-24.512-19.028-49.01m-28.784-49.39C79.782 91.08 70.039 108.387 70.002 128c.037 19.32 9.487 36.403 24.002 46.94 3.56-14.83 12.485-28.41 25.868-55.63a219 219 0 0 0-2.714-7.083c-3.708-9.3-9.059-20.102-13.834-24.993-2.435-2.555-5.389-4.763-8.652-6.648\"/><path fill=\"#7cb342\" d=\"M178.532 194.535c-7.683-.963-14.023-2.124-19.57-4.081a69.4 69.4 0 0 1-30.958 7.249c-38.491 0-69.693-31.198-69.698-69.7 0-20.891 9.203-39.62 23.764-52.392-3.895-.94-7.956-1.49-12.104-1.482-20.45.193-42.037 11.51-51.025 42.075-.84 4.45-.64 7.813-.64 11.8 0 60.591 49.12 109.715 109.705 109.715 37.104 0 69.882-18.437 89.732-46.633-10.736 2.675-21.06 3.955-29.902 3.982-3.314 0-6.425-.177-9.305-.53\"/><path fill=\"#29b6f6\" d=\"M157.922 173.271c.678.336 2.213.884 4.35 1.49 14.375-10.553 23.717-27.552 23.754-46.764h-.005c-.055-32.03-25.974-57.945-58.011-58.009a58.2 58.2 0 0 0-18.213 2.961c11.779 13.426 17.443 32.613 22.922 53.6l.01.025c.01.017 1.752 5.828 4.743 13.538 2.97 7.7 7.203 17.231 11.818 24.178 3.03 4.655 6.363 8 8.632 8.981\"/><path fill=\"#1e88e5\" d=\"M128.009 18.29c-36.746 0-69.25 18.089-89.16 45.826 10.361-6.49 20.941-8.83 30.174-8.747 12.753.037 22.779 3.991 27.589 6.696a51 51 0 0 1 3.345 2.131 69.4 69.4 0 0 1 28.049-5.894c38.496.004 69.703 31.202 69.709 69.698h-.006c0 19.409-7.938 36.957-20.736 49.594 3.142.352 6.492.571 9.912.554 12.15.006 25.284-2.675 35.13-10.956 6.42-5.408 11.798-13.327 14.78-25.199.584-4.586.92-9.247.92-13.991 0-60.588-49.116-109.715-109.705-109.715\"/></svg>", yo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M11.94 2.984 2.928 21.017l9.875-8.47z\"/><path fill=\"#e53935\" d=\"m11.958 2.982.002.29 1.312 14.499-.002.006.023.26 7.363 2.978h.415l-.158-.31-.114-.228h-.001l-8.84-17.494z\"/><path fill=\"#7cb342\" d=\"m8.558 16.13-5.627 4.884h17.743v-.016z\"/></svg>", bo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff7043\" d=\"M2 2a1 1 0 0 0-1 1v10c0 .554.446 1 1 1h12c.554 0 1-.446 1-1V3a1 1 0 0 0-1-1zm0 3h12v8H2zm1 2 2 2-2 2 1 1 3-3-3-3zm5 3.5V12h5v-1.5z\"/></svg>", xo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#0288d1\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", So = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#cfd8dc\" d=\"m179.363 121.67-57.623 57.507c-.23.23-.576.346-.806.23l-78.713-21.09c-.346-.115-.577-.345-.577-.576L20.44 79.144c-.115-.345 0-.576.23-.806L78.294 20.83c.23-.23.576-.346.807-.23l78.713 21.09c.345.114.576.345.576.575l21.09 78.597c.23.346.115.577-.115.807zm-77.215-62.58-77.33 20.63c-.115 0-.23.23-.115.345l56.586 56.47c.115.115.346.115.346-.115l20.744-77.215c.115 0-.115-.23-.23-.116z\"/></svg>", Co = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M30 14v-2h-2V8h-2v4h-2V8h-2v4h-2v2h2v2h-2v2h2v4h2v-4h2v4h2v-4h2v-2h-2v-2Zm-4 2h-2v-2h2Zm-12.437 6A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", wo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7e57c2\" d=\"M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034\"/><path fill=\"#7e57c2\" d=\"M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z\"/></svg>", To = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#4fc3f7\" d=\"M16.83 2a1.3 1.3 0 0 0-.916.377l-.013.01L7.323 7.34l8.556 8.55v.005l10.283 10.277 1.96-3.529-7.068-16.96-3.299-3.297A1.3 1.3 0 0 0 16.828 2Z\"/><path fill=\"#01579b\" d=\"m7.343 7.32-4.955 8.565-.01.013a1.297 1.297 0 0 0 .004 1.835l.005.005 4.106 4.107 16.064 6.314 3.632-2.015-.098-.098-.025.002L15.995 15.97h-.012z\"/><path fill=\"#01579b\" d=\"m7.321 7.324 8.753 8.755h.013L26.16 26.156l3.835-.73L30 14.089l-4.049-3.965a6.5 6.5 0 0 0-3.618-1.612l.002-.043L7.323 7.325Z\"/><path fill=\"#64b5f6\" d=\"m7.332 7.335 8.758 8.75v.013l10.079 10.071L25.436 30H14.09l-3.967-4.048a6.5 6.5 0 0 1-1.611-3.618l-.045.004Z\"/></svg>", Eo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M16 24c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-8c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-12C10.477 4 6 4.895 6 6v4c0 1.1 4.475 2 10 2s10-.9 10-2V6c0-1.105-4.477-2-10-2\"/></svg>", Do = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M18 23H4c-1.1 0-2-.9-2-2V7h2v14h14zM14.5 7V5h-2v2h-2v2h2v2h2V9h2V7zm2 6h-6v2h6zM15 1H8c-1.1 0-1.99.9-1.99 2L6 17c0 1.1.89 2 1.99 2H19c1.1 0 2-.9 2-2V7zm4 16H8V3h6.17L19 7.83z\"/></svg>", Oo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#42a5f5\" d=\"M6 2a2 2 0 0 0-2 2v16c0 1.11.89 2 2 2h6v-2H6V4h7v5h5v3h2V8l-6-6m4 12a.26.26 0 0 0-.26.21l-.19 1.32c-.3.13-.59.29-.85.47l-1.24-.5c-.11 0-.24 0-.31.13l-1 1.73c-.06.11-.04.24.06.32l1.06.82a4.2 4.2 0 0 0 0 1l-1.06.82a.26.26 0 0 0-.06.32l1 1.73c.06.13.19.13.31.13l1.24-.5c.26.18.54.35.85.47l.19 1.32c.02.12.12.21.26.21h2c.11 0 .22-.09.24-.21l.19-1.32c.3-.13.57-.29.84-.47l1.23.5c.13 0 .26 0 .33-.13l1-1.73a.26.26 0 0 0-.06-.32l-1.07-.82c.02-.17.04-.33.04-.5s-.01-.33-.04-.5l1.06-.82a.26.26 0 0 0 .06-.32l-1-1.73c-.06-.13-.19-.13-.32-.13l-1.23.5c-.27-.18-.54-.35-.85-.47l-.19-1.32A.236.236 0 0 0 20 14m-1 3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5c-.84 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5\"/></svg>", ko = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M21.81 10.25c-.06-.04-.56-.43-1.64-.43-.28 0-.56.03-.84.08-.21-1.4-1.38-2.11-1.43-2.14l-.29-.17-.18.27c-.24.36-.43.77-.51 1.19-.2.8-.08 1.56.33 2.21-.49.28-1.29.35-1.46.35H2.62c-.34 0-.62.28-.62.63 0 1.15.18 2.3.58 3.38.45 1.19 1.13 2.07 2 2.61.98.6 2.59.94 4.42.94.79 0 1.61-.07 2.42-.22 1.12-.2 2.2-.59 3.19-1.16A8.3 8.3 0 0 0 16.78 16c1.05-1.17 1.67-2.5 2.12-3.65h.19c1.14 0 1.85-.46 2.24-.85.26-.24.45-.53.59-.87l.08-.24zm-17.96.99h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H3.85c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.43 0h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H6.28c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.47 0h1.75c.1 0 .17-.07.17-.16V9.5c0-.08-.06-.16-.17-.16H8.75c-.08 0-.15.07-.15.16v1.58c0 .09.06.16.15.16m2.44 0h1.77c.08 0 .15-.07.15-.16V9.5c0-.08-.06-.16-.15-.16h-1.77c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16M6.28 9h1.76c.08 0 .16-.09.16-.18V7.25c0-.09-.07-.16-.16-.16H6.28c-.09 0-.16.06-.16.16v1.57c.01.09.07.18.16.18m2.47 0h1.75c.1 0 .17-.09.17-.18V7.25c0-.09-.06-.16-.17-.16H8.75c-.08 0-.15.06-.15.16v1.57c0 .09.06.18.15.18m2.44 0h1.77c.08 0 .15-.09.15-.18V7.25c0-.09-.07-.16-.15-.16h-1.77c-.08 0-.15.06-.15.16v1.57c0 .09.07.18.15.18m0-2.28h1.77c.08 0 .15-.07.15-.16V5c0-.1-.07-.17-.15-.17h-1.77c-.08 0-.15.06-.15.17v1.56c0 .08.07.16.15.16m2.46 4.52h1.76c.09 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16h-1.76c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16\"/></svg>", Ao = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 16h8v2H8zm0-4h8v2H8zm6-10H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm4 18H6V4h7v5h5z\"/></svg>", jo = "<svg xmlns=\"http://www.w3.org/2000/svg\" clip-rule=\"evenodd\" image-rendering=\"optimizeQuality\" shape-rendering=\"geometricPrecision\" text-rendering=\"geometricPrecision\" viewBox=\"0 0 3473 3473\"><path fill=\"#ede7f6\" d=\"M989.342 1977.409c41.146-26.835 75.137-93.922 54.564-141.33-56.353 24.151-53.67 79.61-54.564 141.33m636.877 153.851c44.724-14.311 87.66-64.402 63.509-116.283-34.886 24.151-57.248 57.247-63.51 116.284z\"/><g fill=\"#fafafa\"><path d=\"M374.827 2871.899c0 56.352 14.312 117.178 53.67 138.645 144.907 81.4 652.977 17.89 825.614-20.573 90.343-20.573 163.692-87.66 248.668-124.334 191.421-83.187 330.067-150.274 483.025-262.085 110.916-81.399 287.131-310.388 305.915-447.245l-151.169-33.991c-3.578 153.852-38.463 188.737-175.32 224.517-92.132 25.046-271.925 30.413-365.846 14.312-124.334-20.574-180.687-85.871-237.04-160.114-109.128-144.907 24.151-245.985-148.485-255.824-181.582 222.728-501.81 62.614-642.244 40.252-59.93 86.765-200.366 650.294-198.577 779.1 86.766-29.517 141.33 2.684 219.15 33.097 275.503 106.444 34.885 200.366-75.137 172.636-75.137-17.89-98.394-67.086-142.224-98.393m360.48-1285.383c111.81 21.468 211.1 67.982 305.915 115.39 154.747 76.926 182.476 66.192 196.788 173.53 1.789 19.68-1.789 30.413 54.564 48.303 94.816 29.518-54.564-23.257 199.471-22.362 151.169.894 497.337 61.72 609.148 132.384 46.513 29.519 37.568 67.087 194.999 62.615-1.79-185.16-50.986-461.557-123.44-631.51-88.554-205.733-205.733-237.04-444.561-313.966-139.54-44.725-549.217-93.922-676.235-15.207-118.967 74.243-141.33 162.798-252.246 318.439-32.202 45.619-43.83 80.504-64.403 132.384\"/><path d=\"M1720.14 1966.675c89.45 36.674-4.472 273.714-128.806 216.466-40.252-113.6 55.458-178.003 81.398-228.99-53.67-8.05-206.627-32.2-252.246-15.206-59.036 22.363-72.454 148.486-42.041 207.522 143.118 280.87 775.523 220.94 708.436 2.684-26.835-88.555-51.88-102.867-142.224-133.28-72.454-24.15-144.907-49.196-224.517-49.196m-1124.374-31.307c71.56 68.875 233.462 79.61 338.117 84.976 13.418-138.646 25.046-242.407 135.963-234.356 54.564 74.242 25.94 161.902-31.307 218.255 97.5-.894 153.852-74.242 139.54-180.687-82.293-59.036-331.856-177.109-457.084-194.104-34.885 37.569-120.756 243.301-125.229 305.916\"/></g><path d=\"M427.602 2820.913c59.036-5.367 212.889 39.357 225.412 89.449-95.71 11.628-217.361 2.683-225.412-89.45zm-52.775 50.986c43.83 31.307 67.087 80.504 142.224 98.393 110.022 27.73 350.64-66.192 75.137-172.636-77.82-30.413-132.384-62.614-219.15-33.096-1.789-128.807 138.646-692.336 198.577-779.101 140.435 22.362 460.662 182.476 642.244-40.252 172.636 9.84 39.357 110.917 148.485 255.824 56.353 74.243 112.706 139.54 237.04 160.114 93.921 16.1 273.714 10.734 365.846-14.312 136.857-35.78 171.742-70.665 175.32-224.517l151.17 33.99c-18.785 136.858-195 365.847-305.916 447.246-152.958 111.81-291.604 178.898-483.025 262.085-84.976 36.674-158.325 103.761-248.668 124.334-172.637 38.463-680.707 101.972-825.614 20.574-39.358-21.468-53.67-82.294-53.67-138.646M1626.22 2131.26c6.261-59.037 28.623-92.133 63.508-116.284 24.152 51.88-18.784 101.972-63.508 116.284m93.921-164.586c79.61 0 152.063 25.045 224.517 49.197 90.344 30.412 115.39 44.724 142.224 133.279 67.087 218.255-565.318 278.186-708.436-2.684-30.413-59.036-16.995-185.16 42.041-207.522 45.619-16.995 198.577 7.156 252.246 15.207-25.94 50.986-121.65 115.389-81.398 228.99 124.334 57.247 218.255-179.793 128.806-216.467m-730.798 10.734c.894-61.72-1.79-117.179 54.564-141.33 20.573 47.408-13.418 114.495-54.564 141.33m-393.576-42.041c4.473-62.615 90.344-268.347 125.229-305.916 125.228 16.995 374.791 135.068 457.084 194.104 14.312 106.445-42.04 179.793-139.54 180.687 57.247-56.353 85.87-144.013 31.307-218.255-110.917-8.05-122.545 95.71-135.963 234.356-104.655-5.367-266.558-16.1-338.117-84.976m-89.449-71.56c-33.096-91.238-33.096-233.462 107.339-245.09l-71.56 199.471c-18.783 42.936-18.783 33.096-35.779 45.62zm228.99-277.292c20.573-51.88 32.201-86.765 64.403-132.384 110.917-155.641 133.279-244.196 252.246-318.439 127.018-78.715 536.694-29.518 676.235 15.207 238.828 76.926 356.007 108.233 444.561 313.966 72.454 169.953 121.65 446.35 123.44 631.51-157.43 4.472-148.486-33.096-195-62.615-111.81-70.664-457.978-131.49-609.147-132.384-254.035-.895-104.655 51.88-199.471 22.362-56.353-17.89-52.775-28.624-54.564-48.302-14.312-107.34-42.041-96.605-196.788-173.531-94.816-47.408-194.104-93.922-305.915-115.39m1583.247-43.83c-16.995-56.352 14.312-52.775 68.876-91.238 31.307-22.362 56.353-45.619 94.816-67.086 144.013-80.504 412.36-93.922 526.854 1.789 46.514 38.463 122.545 113.6 110.917 211.994-24.151 195.893-158.325 303.232-268.347 392.68-111.811 91.239-297.865 185.16-490.18 122.546-16.101-39.358-3.578-288.92-22.363-381.053-16.995-82.293-8.05-91.238 39.358-140.435 139.54-144.907 441.878-250.457 613.62-126.123 72.454 53.67 51.88 74.243 89.449 115.39 46.513-50.092-40.252-218.256-360.48-207.522-217.36 7.156-311.282 177.109-402.52 169.058m-1302.377-508.964c4.472-124.335 118.967-381.948 233.461-471.397 138.646-107.338 283.554-208.416 496.442-87.66 52.775 29.519 50.092 44.725 55.459 118.073 4.472 70.665-1.79 96.605-19.679 153.852-141.33 456.19-259.402 194.105-712.014 302.338 16.995-148.485 145.802-280.87 217.361-349.746 122.545-118.967 211.1-195.893 395.365-170.847 50.986 84.976 56.352 138.646-5.367 237.934-82.293 132.385-102.867 124.334-90.344 214.678 64.403-16.101 84.082-78.715 113.6-141.33 179.793-375.686-81.398-421.305-241.512-352.429-107.339 45.62-298.76 256.719-361.374 383.736-12.523 25.046-25.94 57.248-37.568 84.977zm708.436 18.784c18.784-111.811 129.7-139.54 129.7-483.92 0-148.485-182.475-281.764-421.304-182.475-204.838 84.082-236.145 148.485-345.273 313.071-102.867 155.642-99.289 326.49-187.843 470.502-25.94 41.147-49.197 55.458-77.82 96.605-20.574 30.413-35.78 68.876-56.354 104.655-42.04 68.876-84.976 118.968-118.967 201.26-107.339 2.684-197.682 4.473-208.416 115.39-14.312 152.063 57.247 189.632 57.247 246.879-.894 61.72-251.351 684.285-181.581 1055.498 19.679 101.972 86.765 102.867 194.104 115.39 258.508 31.307 593.942 20.573 825.614-72.454l420.41-201.26c106.445-59.931 285.343-173.532 364.953-256.72 56.353-58.141 85.87-107.338 134.173-176.214 66.192-96.605 67.981-94.816 82.293-226.306 87.66 16.101 251.352 54.564 305.916 101.972-6.262 61.72-36.674 32.202-36.674 87.66 34.885.895 93.027-42.935 107.339-91.238-36.675-53.67-75.138-44.724-127.913-87.66 42.042-33.096 118.073-48.302 176.215-72.453 125.229-51.88 339.012-209.311 391.787-352.43 42.04-115.389 10.734-307.704-57.248-382.841-71.559-78.715-237.934-118.967-373.897-118.967-161.902 0-329.172 116.283-459.767 166.375-50.092-43.83-53.67-93.922-90.344-142.224-42.04-57.248-315.755-200.366-446.35-228.095\"/><path fill=\"#efebe9\" d=\"M2318.554 1542.686c91.238 8.05 185.16-161.902 402.52-169.058 320.228-10.734 406.993 157.43 360.48 207.521-37.569-41.146-16.995-61.72-89.45-115.389-171.741-124.334-474.079-18.784-613.62 126.123-47.407 49.197-56.352 58.142-39.357 140.435 18.785 92.133 6.262 341.695 22.362 381.053 192.316 62.614 378.37-31.307 490.181-122.545 110.022-89.45 244.196-196.788 268.347-392.681 11.628-98.394-64.403-173.531-110.917-211.994-114.494-95.71-382.841-82.293-526.854-1.79-38.463 21.468-63.51 44.725-94.816 67.087-54.564 38.464-85.871 34.886-68.876 91.238m-1302.377-508.964 43.83-77.821c11.628-27.73 25.045-59.93 37.568-84.977 62.614-127.017 254.035-338.117 361.374-383.736 160.114-68.876 421.305-23.257 241.512 352.43-29.518 62.614-49.197 125.228-113.6 141.329-12.523-90.344 8.05-82.293 90.344-214.678 61.72-99.288 56.353-152.958 5.367-237.934-184.265-25.046-272.82 51.88-395.365 170.847-71.56 68.876-200.366 201.26-217.361 349.746 452.612-108.233 570.685 153.852 712.014-302.338 17.89-57.247 24.151-83.187 19.679-153.852-5.367-73.348-2.684-88.554-55.459-118.073-212.888-120.756-357.796-19.678-496.442 87.66-114.494 89.45-228.989 347.062-233.461 471.397\"/><path fill=\"#eee\" d=\"M506.317 1863.808c16.996-12.523 16.996-2.683 35.78-45.619l71.559-199.47c-140.435 11.627-140.435 153.851-107.339 245.09z\"/><path fill=\"#efebe9\" d=\"M653.014 2910.362c-12.523-50.092-166.376-94.816-225.412-89.45 8.05 92.133 129.701 101.078 225.412 89.45\"/></svg>", Mo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#9575cd\" d=\"M12.173 22.681c-3.86 0-6.99-3.64-6.99-8.13 0-3.678 2.773-8.172 4.916-10.91 1.014-1.296 2.93-2.322 2.93-2.322s-.982 5.239 1.683 7.319c2.366 1.847 4.106 4.25 4.106 6.363 0 4.232-2.784 7.68-6.645 7.68\"/></svg>", No = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 323 323\"><path fill=\"#ffb300\" d=\"m106.716 99.763 54.785 54.782 54.779-54.782z\"/><path fill=\"#64dd17\" d=\"M96.881 89.93H216.83l-55.18-55.184H41.7zm131.546 11.593 59.705 59.704L228.16 221.2l-59.705-59.704z\"/><path fill=\"#00b8d4\" d=\"m175.552 34.746 112.703 112.695V34.746z\"/><path fill=\"#455a64\" d=\"m34.746 281.3 119.8-119.8-119.8-119.8z\"/><path fill=\"#ffb300\" d=\"m288.255 175.01-53.148 53.149 53.148 53.14z\"/><path fill=\"#00b8d4\" d=\"M281.3 288.254 161.5 168.455l-119.8 119.8z\"/></svg>", Po = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 30 30\"><path fill=\"#f44336\" d=\"M5.207 4.33q-.072.075-.143.153Q1.5 8.476 1.5 15.33c0 4.418 1.155 7.862 3.459 10.34h19.415c2.553-1.152 4.127-3.43 4.127-3.43l-3.147-2.52L23.9 21.1c-.867.773-.845.931-2.315 1.78-1.495.674-3.04.966-4.634.966-2.515 0-4.423-.909-5.723-2.059-1.286-1.15-1.985-4.511-2.096-6.68l17.458.067-.183-1.472s-.847-7.129-2.541-9.372zm8.76.846c1.565 0 3.22.535 3.961 1.471.74.937.931 1.667.973 3.524H9.11c.112-1.955.436-2.81 1.373-3.698.936-.887 2.03-1.297 3.484-1.297\"/></svg>", Fo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#3f51b5\" d=\"M22.713 4H9.287a.5.5 0 0 0-.432.248l-6.708 11.5a.5.5 0 0 0 0 .504l6.708 11.5a.5.5 0 0 0 .432.248h13.426a.5.5 0 0 0 .432-.248l6.708-11.5a.5.5 0 0 0 0-.504l-6.708-11.5A.5.5 0 0 0 22.713 4m-6.937 20.888-7.5-3.75A.5.5 0 0 1 8 20.691v-9.382a.5.5 0 0 1 .276-.447l7.5-3.75a.5.5 0 0 1 .448 0l7.5 3.75a.5.5 0 0 1 .276.447v9.382a.5.5 0 0 1-.276.447l-7.5 3.75a.5.5 0 0 1-.448 0\"/><path fill=\"#7986cb\" d=\"M22 19.441v-6.882a.5.5 0 0 0-.276-.447l-5.5-2.75a.5.5 0 0 0-.448 0l-5.5 2.75a.5.5 0 0 0-.276.447v6.882a.5.5 0 0 0 .276.447l5.5 2.75a.5.5 0 0 0 .448 0l5.5-2.75a.5.5 0 0 0 .276-.447\"/></svg>", Io = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M28 4H4a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 22H4V10h24Z\"/></svg>", Lo = "<svg viewBox=\"0 0 16 16\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"m8.668 6h3.6641l-3.6641-3.668v3.668m-4.668-4.668h5.332l4 4v8c0 0.73828-0.59375 1.3359-1.332 1.3359h-8c-0.73828 0-1.332-0.59766-1.332-1.3359v-10.664c0-0.74219 0.59375-1.3359 1.332-1.3359m3.332 1.3359h-3.332v10.664h8v-6h-4.668z\" fill=\"#90a4ae\" /></svg>", Ro = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M24 28h4L18 4h-4L4 28h4l8-19.422\"/><path fill=\"#f44336\" d=\"M8 20h16v4H8z\"/></svg>", zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><path fill=\"#0288d1\" d=\"m236.249 36.066-213.94 213.94 213.94 213.94v-84.36l-129.7-129.7 129.7-129.7z\"/><path fill=\"#0288d1\" d=\"m236.249 156.017-93.622 93.62 93.622 93.622z\"/><path fill=\"#00b8d4\" d=\"m263.759 36.047 213.94 213.94-213.94 213.94v-84.36l129.7-129.7-129.7-129.7z\"/></svg>", Bo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M13.172 2.828 11.78 4.22l1.91 1.91 2 2A2.986 2.986 0 0 1 20 10.81a3.25 3.25 0 0 1-.31 1.31l2.06 2a2.68 2.68 0 0 1 3.37.57 2.86 2.86 0 0 1 .88 2.117 3.02 3.02 0 0 1-.856 2.109A2.9 2.9 0 0 1 23 19.81a2.93 2.93 0 0 1-2.13-.87 2.694 2.694 0 0 1-.56-3.38l-2-2.06a3 3 0 0 1-.31.12V20a3 3 0 0 1 1.44 1.09 2.92 2.92 0 0 1 .56 1.72 2.88 2.88 0 0 1-.878 2.128 2.98 2.98 0 0 1-2.048.871 2.981 2.981 0 0 1-2.514-4.719A3 3 0 0 1 16 20v-6.38a2.96 2.96 0 0 1-1.44-1.09 2.9 2.9 0 0 1-.56-1.72 2.9 2.9 0 0 1 .31-1.31l-3.9-3.9-7.579 7.572a4 4 0 0 0-.001 5.658l10.342 10.342a4 4 0 0 0 5.656 0l10.344-10.344a4 4 0 0 0 0-5.656L18.828 2.828a4 4 0 0 0-5.656 0\"/></svg>", Vo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#78909c\" d=\"M26 18h-6a2 2 0 0 0-2 2v2h-6a2 2 0 0 1-2-2v-6h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2v6a4 4 0 0 0 4 4h6v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2M6.5 12a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5ZM26 25.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5Z\"/></svg>", Ho = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"m29.532 13.083-.037-.105-3.811-10.322a1 1 0 0 0-.392-.49.985.985 0 0 0-1.39.316 1 1 0 0 0-.122.28L21.208 10H10.792L8.22 2.762a1.004 1.004 0 0 0-1.246-.721 1 1 0 0 0-.266.124 1 1 0 0 0-.392.491L2.507 12.98l-.04.103a7.52 7.52 0 0 0 2.348 8.491l.015.012.032.026 5.797 4.511 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257 5.838-4.537.016-.013a7.52 7.52 0 0 0 2.35-8.49Z\"/><path fill=\"#ef6c00\" d=\"m29.532 13.083-.037-.105a12.6 12.6 0 0 0-5.123 2.394l-8.367 6.57 5.327 4.181 5.839-4.537.016-.013a7.52 7.52 0 0 0 2.345-8.49\"/><path fill=\"#f9a825\" d=\"m10.659 26.123 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257L16 21.943Z\"/><path fill=\"#ef6c00\" d=\"M7.628 15.371a12.6 12.6 0 0 0-5.12-2.39l-.04.102a7.52 7.52 0 0 0 2.347 8.491l.015.012.032.026 5.797 4.511 5.331-4.18Z\"/></svg>", Uo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#ec407a\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", Wo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00acc1\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#00acc1\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", Go = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M16 10v2h6c-2 0-3-2-6-2\"/><path fill=\"#0097a7\" d=\"M26 4h-2a4 4 0 0 0-4 4h4a1 1 0 0 1 2 0v4H16v-2h-5.317A2.683 2.683 0 0 0 8 12.683v2.634A2.683 2.683 0 0 0 10.683 18H16v2h-5.98A4.02 4.02 0 0 1 6 16v-2c-2 0-4 4-4 8 0 5 1 6 2 6h4v-4h4v4h4v-4h4v4h4v-6a2 2 0 0 0 2-2v-2a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4m-4 12h-2a2 2 0 0 1-2-2h6a2 2 0 0 1-2 2\"/></svg>", Ko = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M6 20h20v2H6z\"/><circle cx=\"7\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"27\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 10h20v2H6z\"/><circle cx=\"7\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"5\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 12h2v10H6zm18-2h2v12h-2z\"/><path fill=\"#ec407a\" d=\"m5.014 19.41 11.674 6.866L15.674 28 4 21.134z\"/><path fill=\"#ec407a\" d=\"M26.688 21.724 15.014 28.59 14 26.866 25.674 20zM5.124 10.382l11.415-7.29 1.077 1.686L6.2 12.068z\"/><path fill=\"#ec407a\" d=\"m25.798 12.067-11.415-7.29 1.077-1.685 11.415 7.29zM6.2 19.932l11.416 7.29-1.077 1.686-11.415-7.29z\"/><path fill=\"#ec407a\" d=\"m26.875 21.619-11.415 7.29-1.077-1.687 11.415-7.289zM5.877 22.6 16.04 3.686l1.762.946L7.638 23.546z\"/><path fill=\"#ec407a\" d=\"M24.361 23.545 14.197 4.633l1.761-.947 10.165 18.913z\"/></svg>", qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26c6da\" d=\"M19.322 2a6.5 6.5 0 0 1 4.352 1.419 4.55 4.55 0 0 1 1.685 3.662 5.82 5.82 0 0 1-1.886 4.275 6.04 6.04 0 0 1-4.34 1.846 4.15 4.15 0 0 1-2.385-.649 1.91 1.91 0 0 1-.936-1.603 1.6 1.6 0 0 1 .356-1.024 1.1 1.1 0 0 1 .861-.447q.469 0 .468.504a.79.79 0 0 0 .358.693 1.43 1.43 0 0 0 .826.245 3.1 3.1 0 0 0 2.39-1.573 5.66 5.66 0 0 0 1.154-3.39 2.64 2.64 0 0 0-.891-2.064 3.28 3.28 0 0 0-2.293-.812 6.18 6.18 0 0 0-4.086 1.736 12.9 12.9 0 0 0-3.215 4.557 13.4 13.4 0 0 0-1.233 5.36 5.86 5.86 0 0 0 1.091 3.723 3.53 3.53 0 0 0 2.905 1.372q3.058 0 5.848-4.002l2.935-.388q.546-.07.545.246a8 8 0 0 1-.423 1.24q-.421 1.097-1.152 3.668A12.7 12.7 0 0 0 26 17.72v1.66a14.2 14.2 0 0 1-4.055 2.57 10.38 10.38 0 0 1-2.764 5.931 6.7 6.7 0 0 1-4.806 2.11 3.3 3.3 0 0 1-2.012-.55 1.8 1.8 0 0 1-.718-1.514q0-2.685 5.634-5.212.532-1.766 1.152-3.507a8.6 8.6 0 0 1-2.853 2.323 7.4 7.4 0 0 1-3.48 1.01 5.46 5.46 0 0 1-4.366-2.093A8.1 8.1 0 0 1 6 15.122a11.6 11.6 0 0 1 1.966-6.426 14.7 14.7 0 0 1 5.162-4.862A12.44 12.44 0 0 1 19.322 2m-2.407 22.17q-4.055 1.875-4.054 3.695a.87.87 0 0 0 .999.97q1.964 0 3.055-4.665\"/></svg>", Jo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M18.5 11a5.49 5.49 0 0 0-4.5 2.344V4H8v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", Yo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"M12.023 12a4 4 0 0 0-3.94 3.182 1 1 0 0 1-.972.818H5.229C4.446 16 4 15.552 4 15v-1H3a1 1 0 0 0-1 1v1c0 3.866 3.134 6 7 6 3.425 0 6.275-1.675 6.881-4.745.545-2.764-1.041-5.24-3.858-5.255\"/><path fill=\"#ff7043\" d=\"M29 14h-1v1c0 .552-.446 1-1.229 1H24.89a1 1 0 0 1-.973-.818A4 4 0 0 0 19.977 12c-2.817.016-4.403 2.491-3.858 5.255C16.725 20.325 19.575 22 23 22c3.866 0 7-2.134 7-6v-1a1 1 0 0 0-1-1\"/></svg>", Xo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g stroke-width=\"2.422\"><path fill=\"#ef5350\" d=\"m23.928 240.5 59.94-89.852-59.94-89.855h44.955l59.94 89.855-59.94 89.852z\"/><path fill=\"#ffa726\" d=\"m83.869 240.5 59.94-89.852-59.94-89.855h44.955l119.88 179.71h-44.95l-37.46-56.156-37.468 56.156z\"/><path fill=\"#ffee58\" d=\"m228.72 188.08-19.98-29.953h69.93v29.956h-49.95zm-29.97-44.924-19.98-29.953h99.901v29.953z\"/></g></svg>", Zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#eceff1\" d=\"M18 1.2V14h-4v-4l-4 2v16.37l4 2.43V18h4v4l4-2V3.63z\"/><path fill=\"#eceff1\" d=\"M14 1.2 2 8.49v15.02l4 2.43v-15.2l8-4.86zm12 4.86v15.2l-8 4.86v4.68l12-7.29V8.49z\"/></svg>", Qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M4 8v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2m4 14V10h4v12Zm11.999-6L18 18.001 21 21l-3 3.001L19.999 26l3.003-3 3 2.999L28 24l-3-2.999 3-3L26.001 16l-3 3z\"/></svg>", $o = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 6V2h-2v4h-6V2h-2v4h-4v2h4v4h2V8h6v4h2V8h4V6zm-15.5 5A5.49 5.49 0 0 0 8 13.344V4H2v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", es = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e65100\" d=\"m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z\"/></svg>", ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#26a69a\" d=\"M8.5 6h4l-4-4zM3.875 1H9.5l4 4v8.6c0 .773-.616 1.4-1.375 1.4h-8.25c-.76 0-1.375-.627-1.375-1.4V2.4c0-.777.612-1.4 1.375-1.4M4 13.6h8V8l-2.625 2.8L8 9.4zm1.25-7.7c-.76 0-1.375.627-1.375 1.4s.616 1.4 1.375 1.4c.76 0 1.375-.627 1.375-1.4S6.009 5.9 5.25 5.9\"/></svg>", ns = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M22 10h2v4h-2z\"/><path fill=\"#f44336\" d=\"M28 2H4a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2m-2 12a2 2 0 0 1-2 2h-2v4a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V8h18a2 2 0 0 1 2 2Z\"/></svg>", rs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", is = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#1e88e5\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", as = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ffca28\" d=\"M2 2v12h12V2zm6 6h1v4a1.003 1.003 0 0 1-1 1H7a1.003 1.003 0 0 1-1-1v-1h1v1h1zm3 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", os = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path fill=\"#f9a825\" d=\"M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z\"/></svg>", ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 50 50\"><g transform=\"translate(.21 -247.01)\"><circle cx=\"13.497\" cy=\"281.63\" r=\"9.555\" fill=\"#c62828\"/><circle cx=\"36.081\" cy=\"281.63\" r=\"9.555\" fill=\"#7e57c2\"/><circle cx=\"24.722\" cy=\"262.39\" r=\"9.555\" fill=\"#388e3c\"/></g></svg>", cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f57c00\" d=\"M6.2 18a22.7 22.7 0 0 0 9.8 2 22.7 22.7 0 0 0 9.8-2 10.002 10.002 0 0 1-19.6 0m19.6-4a22.7 22.7 0 0 0-9.8-2 22.7 22.7 0 0 0-9.8 2 10.002 10.002 0 0 1 19.6 0\"/><circle cx=\"27\" cy=\"5\" r=\"3\" fill=\"#757575\"/><circle cx=\"5\" cy=\"27\" r=\"3\" fill=\"#9e9e9e\"/><circle cx=\"5\" cy=\"5\" r=\"3\" fill=\"#616161\"/></svg>", ls = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M30 14H17.738a8 8 0 1 0 0 4H24v4h4v-4h2Zm-20 5a3 3 0 1 1 3-3 3.003 3.003 0 0 1-3 3\"/></svg>", us = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\"1.725\" x2=\"22.185\" y1=\"22.67\" y2=\"1.982\" gradientTransform=\"translate(1.306 1.129)scale(.89324)\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#7c4dff\"/><stop offset=\".5\" stop-color=\"#d500f9\"/><stop offset=\"1\" stop-color=\"#ef5350\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M2.975 2.976v18.048h18.05v-.03l-4.478-4.511-4.48-4.515 4.48-4.515 4.443-4.477z\"/></svg>", ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#448aff\" d=\"M12.074 1.424a.638.638 0 0 0-.686.691v.173c.015.2.044.402.087.588.058.358.085.73.07 1.102a.65.65 0 0 1-.201.33l-.014.258a7 7 0 0 0-1.117.17 7.9 7.9 0 0 0-4.012 2.292l-.213-.157a.56.56 0 0 1-.374-.042 6 6 0 0 1-.829-.747c-.129-.143-.26-.299-.403-.428l-.128-.1a.8.8 0 0 0-.431-.171c-.2 0-.372.07-.501.212-.2.301-.127.675.16.904l.013.014c.03.029.087.072.115.1q.258.172.515.3c.33.186.631.403.918.647a.63.63 0 0 1 .114.358l.2.17a7.82 7.82 0 0 0-1.232 5.546l-.271.07a.84.84 0 0 1-.275.274c-.358.086-.73.17-1.102.17-.186 0-.387 0-.588.057l-.156.03h-.014v.015c-.043 0-.086.014-.115.014a.62.62 0 0 0-.4.789.625.625 0 0 0 .772.386 1 1 0 0 0 .188-.045c.186-.057.37-.127.528-.213a7.4 7.4 0 0 1 1.103-.316c.114 0 .244.057.33.129l.285-.042a8.04 8.04 0 0 0 3.54 4.426l-.1.258a.8.8 0 0 1 .044.358c-.143.344-.33.687-.56.987-.114.172-.215.33-.344.501 0 .043.001.117-.056.16-.014.043-.044.072-.059.114a.615.615 0 0 0 .372.787.62.62 0 0 0 .79-.372c.028-.043.055-.143.083-.143.072-.2.131-.387.174-.574a5.4 5.4 0 0 1 .473-1.102.5.5 0 0 1 .271-.129l.143-.257c1.82.702 3.84.701 5.688.014l.115.23a.53.53 0 0 1 .3.198c.186.33.301.674.43 1.032.043.187.102.373.174.588.028 0 .055.086.084.129.014.043.03.071.044.114a.61.61 0 0 0 .845.216.614.614 0 0 0 .213-.845c-.014-.057-.056-.13-.056-.174-.115-.157-.23-.329-.344-.486-.215-.316-.371-.63-.543-.974a.48.48 0 0 1 .042-.372 1.2 1.2 0 0 1-.1-.244c1.661-1.002 2.951-2.577 3.539-4.454.086.014.17.028.271.042.086-.115.201-.115.33-.115.387.057.73.16 1.103.302q.235.128.514.213c.058.014.116.03.202.03v.015c0 .014.058.013.1.028.344.043.617-.202.689-.532a.617.617 0 0 0-.532-.7c-.057-.014-.127-.03-.17-.072h-.588a7 7 0 0 1-1.102-.202.6.6 0 0 1-.274-.257l-.272-.07a7.8 7.8 0 0 0-1.262-5.531l.23-.2a.44.44 0 0 1 .114-.343c.273-.244.589-.46.918-.647a3.6 3.6 0 0 0 .5-.3 1 1 0 0 0 .13-.1c.043-.028.086-.058.086-.087.258-.243.273-.63 0-.859-.214-.257-.601-.257-.845 0-.043 0-.1.059-.142.087a11 11 0 0 0-.403.428c-.244.272-.53.532-.831.747a.55.55 0 0 1-.372.042l-.23.171a7.98 7.98 0 0 0-5.098-2.462l-.014-.274a.5.5 0 0 1-.201-.314 5.6 5.6 0 0 1 .07-1.102 4 4 0 0 0 .087-.588v-.316a.62.62 0 0 0-.546-.548m-.842 4.773-.174 3.223h-.014a.56.56 0 0 1-.114.302.543.543 0 0 1-.745.13h-.014L7.536 7.973a6.23 6.23 0 0 1 3.035-1.662c.23-.043.446-.086.66-.115zm1.544 0a6.38 6.38 0 0 1 3.682 1.777L13.837 9.85h-.014a.66.66 0 0 1-.3.073.535.535 0 0 1-.56-.518zm-6.2 2.938 2.406 2.19v.015c.086.071.157.16.157.274a.523.523 0 0 1-.372.657v.014l-3.095.89a6.4 6.4 0 0 1 .904-4.04m10.842.042c.73 1.189 1.032 2.595.932 3.984l-3.109-.89-.014-.014a.5.5 0 0 1-.257-.17.53.53 0 0 1 .056-.761l-.014-.042zm-5.915 2.322h.988l.615.758-.215.96-.887.431-.887-.43-.23-.96zm-2.308 2.65h.115c.243 0 .46.17.545.414 0 .1.001.23-.056.302v.042l-1.22 2.966a6.33 6.33 0 0 1-2.563-3.195zm5.274 0h.344l3.193.515a6.34 6.34 0 0 1-2.563 3.223l-1.234-3.022c-.115-.258.002-.558.26-.716m-2.521 1.298a.55.55 0 0 1 .529.277h.014l1.561 2.823a5 5 0 0 1-.615.171 6.4 6.4 0 0 1-3.481-.17l1.561-2.824h.014c.043-.1.115-.144.216-.215a.5.5 0 0 1 .201-.062\"/></svg>", fs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0277bd\" d=\"M8 3a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2H3v2h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2v-2H8v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V5h2V3m6 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3z\"/></svg>", ps = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M8 1a5.5 5.5 0 0 0-4 9.26V15l4-1.5 4 1.5v-4.74A5.49 5.49 0 0 0 8 1m0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4\"/></svg>", ms = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffd54f\" d=\"M25 12h-3V8a6 6 0 0 0-12 0v4H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V13a1 1 0 0 0-1-1M14 8a2 2 0 0 1 4 0v4h-4Zm2 17a4 4 0 1 1 4-4 4 4 0 0 1-4 4\"/></svg>", hs = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#afb42b\" d=\"M19 5v9h-5v5H5V5zm0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10l6-6V5c0-1.1-.9-2-2-2m-7 11H7v-2h5zm5-4H7V8h10z\"/></svg>", gs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"M30 6a3.86 3.86 0 0 1-1.167 2.833 4.024 4.024 0 0 1-5.666 0A3.86 3.86 0 0 1 22 6a3.86 3.86 0 0 1 1.167-2.833 4.024 4.024 0 0 1 5.666 0A3.86 3.86 0 0 1 30 6m-9.208 5.208A10.6 10.6 0 0 0 13 8a10.6 10.6 0 0 0-7.792 3.208A10.6 10.6 0 0 0 2 19a10.6 10.6 0 0 0 3.208 7.792A10.6 10.6 0 0 0 13 30a10.6 10.6 0 0 0 7.792-3.208A10.6 10.6 0 0 0 24 19a10.6 10.6 0 0 0-3.208-7.792m-1.959 7.625a4.024 4.024 0 0 1-5.666 0 4.024 4.024 0 0 1 0-5.666 4.024 4.024 0 0 1 5.666 0 4.024 4.024 0 0 1 0 5.666\"/></svg>", _s = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"m29.5 24.02-1.6-.92a4.4 4.4 0 0 0 .09-.9A1.3 1.3 0 0 0 28 22a5.6 5.6 0 0 0-.1-1.1l1.6-.92a.493.493 0 0 0 .18-.68l-1.5-2.6a.45.45 0 0 0-.18-.18V6.01a2.006 2.006 0 0 0-2-2H4a2.006 2.006 0 0 0-2 2V22a2.006 2.006 0 0 0 2 2h10.53l-.03.02a.493.493 0 0 0-.18.68l1.5 2.6a.493.493 0 0 0 .68.18l1.6-.92a5.9 5.9 0 0 0 1.9 1.09v1.85a.495.495 0 0 0 .5.5h3a.495.495 0 0 0 .5-.5v-1.85a5.9 5.9 0 0 0 1.9-1.09l1.6.92a.493.493 0 0 0 .68-.18l1.5-2.6a.493.493 0 0 0-.18-.68M24 22.01a1.99 1.99 0 0 1-.88 1.65l-.18.11a2.04 2.04 0 0 1-1.88 0l-.18-.11a1.99 1.99 0 0 1-.88-1.65V22a2 2 0 0 1 .88-1.66l.18-.11a2.04 2.04 0 0 1 1.88 0l.18.11A2 2 0 0 1 24 22Zm2-4.63-.1.06a5.9 5.9 0 0 0-1.9-1.09V14.5a.495.495 0 0 0-.5-.5h-3a.495.495 0 0 0-.5.5v1.85a5.9 5.9 0 0 0-1.9 1.09l-1.6-.92a.493.493 0 0 0-.68.18l-1.5 2.6a.493.493 0 0 0 .18.68l1.6.92A5.6 5.6 0 0 0 16 22v.01L4 22V10.01h22Z\"/></svg>", vs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", ys = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\".125\" x2=\"0\" y1=\"1\" y2=\"0\"><stop offset=\"0%\" stop-color=\"#ab47bc\"/><stop offset=\"37.5%\" stop-color=\"#ab47bc\"/><stop offset=\"37.501%\" stop-color=\"#d32f2f\"/><stop offset=\"54.25%\" stop-color=\"#d32f2f\"/><stop offset=\"54.251%\" stop-color=\"#ff7043\"/><stop offset=\"69.75%\" stop-color=\"#ff7043\"/><stop offset=\"69.751%\" stop-color=\"#ffa726\"/><stop offset=\"100%\" stop-color=\"#ffa726\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M22 2s-7.64-.37-13.66 7.88C3.72 16.21 2 22 2 22l1.94-1c1.44-2.5 2.19-3.53 3.6-5 2.53.74 5.17.65 7.46-2-2-.56-3.6-.43-5.96-.19C11.69 12 13.5 11.6 16 12l1-2c-1.8-.34-3-.37-4.78.04C14.19 8.65 15.56 7.87 18 8l1.11-1.73c-1.53-.06-2.4-.02-4.19.3 1.61-1.46 3.08-2.12 5.22-2.25 0 0 1.05-1.89 1.86-2.32\"/></svg>", bs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", xs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M16 0 2 8v16l14 8 14-8V8Zm8 23a1 1 0 0 1-1 1h-2.52a1 1 0 0 1-.78-.375L12 14v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2.52a1 1 0 0 1 .78.375L20 18V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1Z\"/></svg>", Ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M6 24h20v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM30 6l-9 9-5-11-5 11-9-9 4 14h20z\"/></svg>", Cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><g stroke-width=\".395\"><path fill=\"#1976d2\" d=\"M133.347 451.499c0-.295-2.752-5.283-6.116-11.084s-6.116-10.776-6.116-11.055 9.514-16.889 21.143-36.912c11.629-20.022 21.323-36.798 21.542-37.279.346-.76-1.608-4.363-14.896-27.466-8.412-14.625-15.294-26.785-15.294-27.023 0-.5 24.46-43.501 25.206-44.31.414-.45.592-.384 1.078.395.32.513 16.876 29.256 36.791 63.87 62.62 108.85 74.852 130.01 75.41 130.46.3.242.544.554.544.694s-11.836.21-26.302.154c-23.023-.09-26.313-.175-26.393-.694-.11-.714-27.662-48.825-28.86-50.392-.746-.978-.906-1.035-1.426-.51-.688.696-28.954 49.323-29.49 50.733l-.364.96h-13.23c-10.895 0-13.228-.095-13.228-.538zm167.58-125.61c-.134-.216 1.189-2.863 2.939-5.882 6.924-11.944 84.29-145.75 96.49-166.88 7.143-12.371 13.143-22.465 13.334-22.433.362.062 25.86 43.105 25.86 43.655 0 .174-6.761 11.952-15.025 26.173-8.46 14.557-14.932 26.104-14.81 26.421.185.483 4.563.564 30.213.564h29.996l.957 1.48c.527.814 3.296 5.547 6.155 10.518s5.45 9.29 5.757 9.597c.705.705.703.724-.16 1.572-.396.388-3.36 5.323-6.588 10.965-3.228 5.643-6.056 10.387-6.285 10.543s-19.695.171-43.256.034l-42.84-.249-.803 1.15c-.442.632-7.505 12.736-15.696 26.897l-14.892 25.747h-15.486c-8.518 0-20.015.116-25.551.259-6.55.168-10.15.121-10.308-.135zm-133.75-157.86c-56.373-.055-102.5-.182-102.5-.282s5.617-10.132 12.481-22.294L89.64 123.34h30.332c27.113 0 30.332-.065 30.332-.611 0-.336-6.659-12.228-14.797-26.427s-14.797-25.917-14.797-26.04 2.682-4.853 5.96-10.51 6.003-10.578 6.056-10.934c.086-.586 1.375-.648 13.572-.648 7.412 0 13.463.143 13.446.317-.018.174.22.707.53 1.184.31.476 9.763 16.937 21.007 36.578 11.244 19.64 20.71 36.022 21.036 36.4.554.647 2.549.691 31.428.691h30.837l12.896 22.145c7.093 12.18 12.8 22.301 12.682 22.492-.117.19-4.776.303-10.352.249-5.575-.054-56.26-.143-112.63-.198z\"/><path fill=\"#64b5f6\" d=\"M23.046 238.939c-6.098 10.563-6.69 11.711-6.224 12.078.282.224 3.18 5.044 6.44 10.712s6.016 10.355 6.123 10.417c.106.061 13.585.153 29.95.204 16.367.052 29.994.23 30.285.399.473.273-1.08 3.094-14.637 26.574l-15.166 26.269 12.907 21.865c7.1 12.026 12.982 21.906 13.068 21.956s23.257-39.831 51.492-88.624c11.352-19.617 21.214-36.64 30.37-52.442 23.308-40.452 30.68-53.468 30.73-54.132-1.096-.11-6.141-.187-13.006-.216-3.945-.01-7.82-.02-12.75-.002l-25.341.092-15.42 26.706c-14.256 24.693-15.445 26.663-16.278 26.86l-.023.037c-.012.003-1.622-.001-1.826 0-4.29.062-20.453.063-40.226-.01-22.632-.082-41.615-.125-42.183-.096-.567.03-1.147-.03-1.29-.132-.141-.102-3.29 5.066-6.996 11.485zm205.16-190.3c-.123.149 5.62 10.392 12.761 22.763 12.2 21.131 89.393 155.03 96.276 167 1.503 2.613 2.92 4.803 3.443 5.348.9-1.249 3.532-5.63 7.954-13.219a1343 1343 0 0 1 10.05-17.76l6.606-11.443c.691-1.403.753-1.818.652-2.117-.161-.48-6.903-12.332-14.982-26.337-8.078-14.005-14.824-25.849-14.99-26.32a.73.73 0 0 1-.01-.366l-.426-.913 21.636-36.976c3.69-6.307 6.425-11.042 9.471-16.29 9.158-15.948 12.036-21.189 11.895-21.55-.126-.324-2.7-4.83-5.72-10.017-3.021-5.185-5.845-10.148-6.275-11.026-.483-.987-.734-1.364-1.1-1.456-.054.014-.083.018-.144.035-.42.112-5.455.195-11.19.185s-11.22.024-12.187.073l-1.76.089-14.998 25.978c-12.824 22.212-15.084 25.964-15.595 25.883-.024-.004-.15-.189-.235-.301-.109.066-.2.09-.271.05-.256-.148-7.144-11.902-15.306-26.119L279.4 48.817c-.116-.186-.444-.744-.458-.752-.476-.275-50.502.287-50.737.57zm-18.646 283.09c-.047.109-.026.262.043.48.328 1.05 25.338 43.735 25.772 43.985.206.119 14.178.239 31.05.266 26.65.044 30.749.152 31.234.832.307.43 9.987 17.214 21.513 37.296s21.152 36.627 21.394 36.767 5.926.243 12.633.23c6.705-.013 12.4.099 12.657.246.131.076.381-.141.851-.795l6.008-10.406c5.234-9.065 6.62-11.684 6.294-11.888-.575-.36-15.597-26.643-23.859-41.482-3.09-5.45-5.37-9.516-5.44-9.774-.196-.712-.066-.822 1.155-.98 1.956-.252 57.397-.057 58.071.205.237.092.79-.569 2.593-3.497 1.866-3.067 5.03-8.524 11.001-18.866 7.22-12.505 13.043-22.784 12.941-22.843s-.77-.051-1.489.016l-.046.001c-4.451.204-33.918.203-149.74.025-38.96-.06-69.786-.09-71.912-.072-1.12.01-2.095.076-2.66.172a.3.3 0 0 0-.062.083z\"/></g></svg>", ws = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#8bc34a\" d=\"M16 20.003v2h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2v-2h4v-2h-4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v2Z\"/><path fill=\"#8bc34a\" d=\"m16 3.003-12 7v14l4 2h6v-13.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v11.5H8l-2-1.034V11.15l10-5.833 10 5.833v11.703l-10 5.833-1.745-1.022L13 29.253l3 1.75 12-7v-14Z\"/></svg>", Ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"M4 4v24h24V4Zm20 20h-4V12h-4v12H8V8h16Z\"/></svg>", Es = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", Ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#ffab40\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", Os = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"m12.019 15.021.003-.008c-.005-.021-.006-.026-.003.008\"/><path fill=\"#ff9800\" d=\"M4.51 3.273a2.523 2.523 0 0 0-2.524 2.523V11.3c.361-.13.88-.898 1.043-1.085.285-.327.337-.743.478-1.006C3.83 8.612 3.886 8.2 4.62 8.2c.342 0 .478.08.71.39.16.216.438.615.568.882.15.307.396.724.503.808q.122.095.233.137c.119.044.218-.037.297-.1.102-.082.145-.247.24-.467.135-.317.283-.697.367-.83.146-.23.195-.501.352-.633.232-.195.535-.208.618-.225.466-.092.677.225.907.43.15.133.355.403.5.765.114.283.26.544.32.707.059.158.203.41.289.713.077.275.286.486.365.616 0 0 .121.34.858.65.16.067.482.176.674.246.32.116.63.101 1.025.054.281 0 .434-.408.562-.734.075-.193.148-.745.197-.902.048-.153-.064-.27.031-.405.112-.156.178-.164.242-.368.138-.436.936-.458 1.384-.458.374 0 .327.363.96.239.364-.072.714.046 1.1.149.324.086.63.184.812.398.119.139.412.834.113.863.029.035.05.099.104.134-.067.262-.357.075-.518.041-.217-.045-.37.007-.583.101-.363.162-.894.143-1.21.407-.27.223-.269.721-.394 1 0 0-.348.895-1.106 1.443-.194.14-.574.477-1.4.605a5.3 5.3 0 0 1-1.1.043c-.186-.009-.362-.018-.549-.02-.11-.002-.48-.013-.461.022l-.041.103.024.138c.015.083.019.149.022.225.006.157-.013.32-.005.478.017.328.138.627.154.958.017.368.199.758.375 1.059.067.114.169.128.213.269.052.161.003.333.028.505.1.668.292 1.366.592 1.97l.008.014c.371-.062.743-.196 1.226-.267.885-.132 2.115-.064 2.906-.138 2-.188 3.085.82 4.882.407V5.796a2.523 2.523 0 0 0-2.523-2.523zm-.907 11.144q-.022 0-.046.003c-.159.025-.313.08-.412.24-.08.13-.108.355-.164.505-.064.175-.176.338-.274.505-.18.305-.504.581-.644.879-.028.06-.053.13-.076.2v3.402c.163.028.333.062.524.113 1.407.375 1.75.407 3.13.25l.13-.018c.105-.22.187-.968.255-1.2.054-.178.127-.32.155-.5.026-.173-.003-.337-.017-.493-.04-.393.285-.533.44-.87.14-.304.22-.651.336-.963.11-.298.284-.721.579-.872-.036-.041-.617-.06-.772-.076a5 5 0 0 1-.5-.07c-.314-.064-.656-.126-.965-.2a10 10 0 0 1-.947-.328c-.298-.138-.503-.497-.732-.507m5.737.83c-.74.149-.97.876-1.32 1.451-.192.319-.396.59-.548.928-.14.312-.128.657-.368.924a2.55 2.55 0 0 0-.528.922c-.023.067-.088.776-.158.943l1.101-.078c1.026.07.73.464 2.332.378l2.529-.078a7 7 0 0 0-.228-.588c-.07-.147-.16-.434-.218-.56a3.5 3.5 0 0 0-.309-.526c-.184-.215-.227-.23-.28-.503-.095-.473-.344-1.33-.637-1.923-.151-.306-.403-.562-.634-.784-.2-.195-.655-.522-.734-.505z\"/></svg>", ks = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ef5350\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z\"/></svg>", As = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ba68c8\" d=\"M11.057 2.981c.537.735.028 1.653.141 2.472a3.42 3.42 0 0 1-1.03 2.415c-1.414 1.625-3.165 3.038-4.097 5.03a5.28 5.28 0 0 0 1.412 5.847c.706.735 1.54 1.342 2.472 1.738.17.805-1.088.184-1.455 0A6.7 6.7 0 0 1 4.361 16.4a5.44 5.44 0 0 1 .904-5.368c1.272-1.61 3.136-2.543 4.662-3.857.565-.55 1.003-1.3.932-2.119.156-.678-.254-1.469.212-2.09zm-.07 18.929c-.17.198-.467.325-.495.24-.042-.085.212-.127.381-.325.17-.183.127-.522.24-.522.1 0 .043.395-.14.607zm2.16 0c.17.198.453.31.495.24.028-.085-.212-.141-.395-.339-.156-.184-.113-.523-.24-.523-.085 0-.029.41.14.608zm-1.03.48c-.1 0-.071-.296-.071-.65 0-.367-.028-.663.07-.663.085 0 .057.296.057.663 0 .354.014.65-.057.65m-.495-20.765c.34.24.254 2.077.254 3.136 0 1.653.184 3.376-.805 4.916-.96 1.497-2.048 3.108-1.95 4.972.1 1.837.99 3.504 2.148 5.043.664.876-.353.509-.876.085a7.2 7.2 0 0 1-2.755-5.664c.142-1.907 1.597-3.348 2.628-4.803.805-1.13 1.186-1.879 1.215-3.645.028-1.412-.142-3.531.042-3.983.014-.043.07-.1.099-.057m.537 2.232c-.085 0-.043.396.028.72.424 2.26-.198 4.52-.749 6.682a12.77 12.77 0 0 0 .283 7.826c.607 1.568 1.71.791 2.161 1.568.34.593 1.272.198 1.978-.141 2.232-1.102 4.012-3.108 4.11-5.566.029-.494 0-.989-.07-1.497-.283-1.837-1.78-3.065-3.15-4.083-1.215-.89-2.74-1.483-3.659-2.613-.523-.65-.297-1.638-.381-2.458-.043-.452-.255-.042-.382-.268-.084-.127-.14-.17-.17-.17zm.72 3.616c.057 0 .17.071.325.226a20 20 0 0 0 2.161 1.921c1.272.961 2.43 2.091 2.967 3.504.339.875.339 1.836.226 2.74-.184 1.384-1.187 2.444-2.119 3.404-.339.354-1.06.791-1.074.678-.084-.367.763-1.172 1.159-1.695A5.93 5.93 0 0 0 16 10.962c-1.102-1.214-2.317-1.907-2.995-3.08-.14-.253-.183-.409-.113-.409z\"/></svg>", js = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M12 18.08c-6.63 0-12-2.72-12-6.08s5.37-6.08 12-6.08S24 8.64 24 12s-5.37 6.08-12 6.08m-5.19-7.95c.54 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.58 1.09q-.42.33-1.29.33h-.87l.53-2.76zm-3.5 5.55h1.44l.34-1.75h1.23c.54 0 .98-.06 1.33-.17.35-.12.67-.31.96-.58.24-.22.43-.46.58-.73.15-.26.26-.56.31-.88.16-.78.05-1.39-.33-1.82-.39-.44-.99-.65-1.82-.65H4.59zm7.25-8.33-1.28 6.58h1.42l.74-3.77h1.14c.36 0 .6.06.71.18s.13.34.07.66l-.57 2.93h1.45l.59-3.07c.13-.62.03-1.07-.27-1.36-.3-.27-.85-.4-1.65-.4h-1.27L12 7.35zM18 10.13c.55 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.57 1.09-.29.22-.72.33-1.3.33h-.85l.5-2.76zm-3.5 5.55h1.44l.34-1.75h1.22c.55 0 1-.06 1.35-.17.35-.12.65-.31.95-.58.24-.22.44-.46.58-.73.15-.26.26-.56.32-.88.15-.78.04-1.39-.34-1.82-.36-.44-.99-.65-1.82-.65h-2.75z\"/></svg>", Ms = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e0e0e0\" d=\"M2 22h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zM12 12h8v8h-8z\"/><path fill=\"#ffb300\" d=\"M2 2h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zm0 10h8v8h-8z\"/></svg>", Ns = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#e64a19\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM8 11v2h1v6H8v1h4v-1h-1v-2h2a3 3 0 0 0 3-3 3 3 0 0 0-3-3zm5 2a1 1 0 0 1 1 1 1 1 0 0 1-1 1h-2v-2z\"/></svg>", Ps = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#03a9f4\" d=\"M29.07 6H7.677A1.535 1.535 0 0 0 6.24 7.113l-4.2 17.774A.852.852 0 0 0 2.93 26h21.393a1.535 1.535 0 0 0 1.436-1.113L29.96 7.112A.852.852 0 0 0 29.07 6M8.626 23.797a1.4 1.4 0 0 1-1.814-.31l-.007-.009a1.075 1.075 0 0 1 .315-1.599l9.6-6.061-6.102-5.852-.01-.01a1.068 1.068 0 0 1 .084-1.625l.037-.03a1.38 1.38 0 0 1 1.8.07l7.233 6.957a1.1 1.1 0 0 1 .236.739 1.08 1.08 0 0 1-.412.79c-.074.04-.146.119-10.951 6.935ZM24 22.94A1.135 1.135 0 0 1 22.803 24h-5.634a1.061 1.061 0 1 1 .001-2.112h5.633A1.134 1.134 0 0 1 24 22.938Z\"/></svg>", Fs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#f44336\" d=\"M2 8h4v1H2zm0 6h4v1H2zm9-10h3v1h-3zM2 2h3v1H2z\"/><path fill=\"#f9a825\" d=\"M9 2h3v1H9zm1 4h4v1h-4zm-5 6h1v1H5zm-3-2h6v1H2z\"/><path fill=\"#26a69a\" d=\"M2 12h3v1H2zm7-4h5v1H9zM2 4h4v1H2zm3-2h4v1H5z\"/><path fill=\"#ba68c8\" d=\"M2 6h3v1H2zm7-2h2v1H9zm-1 6h4v1H8z\"/></svg>", Is = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"m27.777 22.617-.459-.946L18.43 3.26a2.25 2.25 0 0 0-1.914-1.256A2 2 0 0 0 16.379 2a2.23 2.23 0 0 0-1.891 1.042L4.348 19.056a2.2 2.2 0 0 0 .025 2.417l4.957 7.488A2.34 2.34 0 0 0 11.29 30a2.4 2.4 0 0 0 .655-.092l14.387-4.149a2.32 2.32 0 0 0 1.458-1.234 2.21 2.21 0 0 0-.013-1.908m-3.538.604-11.268 3.25 4.075-19.033 7.568 15.671-.376.098Z\"/></svg>", Ls = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"M16 27 2 19v-5l14 8z\"/><path fill=\"#ffeb3b\" d=\"m30 14-14 8v5l14-8z\"/><path fill=\"#ff5722\" d=\"M16 6 2 14v5l14-8z\"/><path fill=\"#00e676\" d=\"m30 19-14-8V6l14 8z\"/><path fill=\"#03a9f4\" d=\"M16 27 2 19v-5l14 8z\"/></svg>", Rs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\"><g transform=\"translate(-.25 -1.71)\"><path fill=\"#ffe0b2\" d=\"M107.4 50.9c-.2-4.4.4-8.3-1.6-11.6-4.8-8.2-16.8-13-40.8-13v.7h-.5.5v-.7c-24 0-36.6 4.8-41.4 13.1-1.9 3.4-1.7 7.2-2 11.6-.2 3.5-1.8 7.2-1.1 11.2.8 5.2 1.1 10.4 1.9 15.2.6 3.9 6 7.2 6.5 10.9 1.4 10.2 12 14.9 36 14.9v.8h-.6.7v-.8c24 0 34.2-4.7 35.5-14.9.5-3.8 5.5-7 6.1-10.9.8-4.8 1.1-10 1.9-15.2.7-4-.9-7.8-1.1-11.3\"/><path fill=\"#ffe0b2\" d=\"M64.6 54.5c4.3.1 7.3 2.8 10.1 5.3 3.3 2.9 8.9 4.9 11.2 7.4s5.3 5 6.4 8.9 1.4 8.9 1.4 10.2.7 1 2.7 0c4.7-2.3 9.9-8.5 9.9-8.5-.6 3.9-5.7 7.4-6.2 11.1C98.9 99.1 89 104 64.5 104h-.1.6\"/><path fill=\"#ffe0b2\" d=\"M80.4 46.7c.9 3.1 4.1 13.6-2.1 10.1 0 0 2.6 1.5 4.2 7.2 1.7 5.7 5.8 6.4 5.8 6.4s6.7 1.3 11.7-3c4.2-3.6 4.9-10 3.1-14.9-1.8-4.8-5-6.3-9.7-7.3-4.7-1.1-14.1-2-13 1.5\"/><circle cx=\"92.3\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"90\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#ffe0b2\" d=\"M78.9 57.7s7.9 5.4 12.2 10.7 4.2 6.3 4.2 6.3l-3.1 1.4s-4.4-8.3-9.8-11.4c-5.5-3.1-6.1-5.7-6.1-5.7zm-14-3.2c-4.3.1-7.5 2.8-10.4 5.3-3.3 2.9-9.1 4.9-11.4 7.4s-5.4 5-6.5 8.9-1.5 8.9-1.5 10.2.2 1.4-2.7 0c-4.7-2.2-9.9-8.5-9.9-8.5.6 3.9 5.7 7.4 6.2 11.1C30.1 99.1 40 104 64.5 104h.5\"/><path fill=\"#4e342e\" d=\"M88.1 71.4C83.3 65.5 75.6 60 64.9 60h-.1c-10.7 0-18.4 5.5-23.2 11.4-5 6.1-4.6 8.5-4.6 14.3 0 21 7.4 15 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.7 12.3-17.3.1-5.8.4-8.4-4.6-14.5\"/><path fill=\"#3e2723\" d=\"M64.4 65.2s-.7 9.7-2.1 11.6l2.6-.6z\"/><path fill=\"#3e2723\" d=\"M65.1 65.2s.7 9.7 2.1 11.6l-2.6-.6z\"/><path fill=\"#4e342e\" d=\"M56.7 62.9c-1-2.3 2.6-6 8.3-6.1 5.7 0 9.3 3.7 8.3 6.1S68.7 66 65 66.1c-3.6-.1-7.3-.8-8.3-3.2\"/><path d=\"M65 65.2c0-.4 3.4-.5 5.2-1.7 0 0-3.7 1.2-4.5.7-.8-.4-1-1.6-1-1.6s-.3 1.2-.9 1.6c-.7.4-4.9-.7-4.9-.7s5.6 1.4 5.6 1.7-.1 1.3-.1 2c0 2.5 0 8.7.4 9.2.6.9.4-6.7.4-9.2-.1-.8-.1-1.6-.2-2\"/><path fill=\"#795548\" d=\"M65.2 78.6c1.7 0 4.7 1.2 7.4 3.1-2.6-2.9-5.7-4.9-7.4-4.9-1.8 0-5.6 2.2-8.3 5.4 2.8-2.2 6.4-3.6 8.3-3.6\"/><g fill=\"#3e2723\"><path d=\"M64.5 96.3c-3.8 0-7.5-1.2-10.9-2.1-.7-.2-1.4.3-2.1.1-6.3-2-11.4-5.4-14.5-9.7v1c0 21 7.4 15.1 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.6 12.3-17.4 0-.8 0-1.6.1-2.3-2.9 4.7-8.2 8.4-14.8 10.6-.6.2-2-.3-2.6-.2-3.6 1.2-6.8 2.5-10.9 2.5\"/><path d=\"M55 85s-2.5 7.5-.8 10.8l-2.3-1s1.7-7.6 3.1-9.8m19.8 0s2.5 7.5.8 10.8l2.3-1s-1.8-7.6-3.1-9.8\"/></g><path fill=\"#ffe0b2\" d=\"M48.6 46.7c-.9 3.1-4.1 13.6 2.1 10.1 0 0-2.6 1.5-4.2 7.2s-5.8 6.4-5.8 6.4-6.7 1.3-11.7-3c-4.2-3.6-4.9-10-3.1-14.9s5-6.3 9.7-7.3c4.7-1.1 14-2 13 1.5\"/><path d=\"M64.9 76.8c2.7 0 11.1 5.8 11.2 12.9v-.4c0-7.4-6.8-13.3-11.2-13.3s-11.2 6-11.2 13.3v.4c.1-7.1 8.5-12.9 11.2-12.9\"/><g fill=\"#3e2723\"><ellipse cx=\"66.7\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(-14.465 66.71 61.469)\"/><ellipse cx=\"62.4\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(17.235 62.372 61.463)\"/></g><circle cx=\"37.2\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"39.5\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#795548\" d=\"M67.5 58.2c0-.1-2.3 1-2.9 1.1-.6-.1-2.9-1.2-2.9-1.1z\"/><path fill=\"#ffe0b2\" d=\"M50 57.7s-7.9 5.4-12.2 10.7-4.2 6.3-4.2 6.3l3.1 1.4s4.4-8.3 9.8-11.4 6.1-5.7 6.1-5.7z\"/><path fill=\"#ffe0b2\" d=\"M32.7 41.7S30 49.1 24 52.2c0 0 9.4-1.1 8.7-10.5m63.1 0s2.7 7.4 8.7 10.5c0 0-9.4-1.1-8.7-10.5M78.7 55.5s-5.9-6.2-13.8-6.4h.2c-8 .2-13.8 6.4-13.8 6.4 6.9-4.8 12.8-4.7 13.8-4.7-.1 0 6.7-.1 13.6 4.7m-6.9-13s-3-4.2-7-4.3h.2c-3 .1-6.9 4.3-6.9 4.3 3.4-3.3 6.9-3.2 6.9-3.2s3.3-.1 6.8 3.2M37.2 73.2s-4.7 2.3-8.1.9H29c-3-1.7-4.5-6.8-4.5-6.8s3 9 12.7 5.9m54.8 0s4.7 2.3 8.1.9c4-1.7 4.6-6.8 4.6-6.8s-3 9-12.7 5.9\"/><path fill=\"#ffe0b2\" d=\"M42.6 41.2c2.6-.5 6.9-.6 10.3.5 4.3 1.5.8 7 1.7 7.3s2.1-3.8 10.1-3.4c8.1.4 9 4 10.1 3.4s-1.1-10 11-7.8c0 0-12.7-3.4-12.1 5.8 0 0-7.3-5.6-17.5-.6.1 0 2.7-8.6-13.6-5.2m44.3 0c.2 0 .3.1.4.1s-.1-.1-.4-.1M39.1 28.9S28.3 42.5 26.7 47.7c-1.6 5.3-2.8 27-4.2 30.1l-5-21.4 9.2-22.3zm50.8 0s10.8 13.6 12.4 18.8c1.6 5.3 2.8 27 4.2 30.1l5-21.4-9.2-22.3z\"/><path fill=\"#4e342e\" d=\"M89.4 28.9s11.6 9.7 15 20.9 2 24.8 4.6 26.5c3.7 2.4 7.9-11.9 9.3-13.4 2.2-2.4 9.5-8.5 10-9.6s-14.8-17.8-21.5-21.1c-8.1-3.8-18.1-4.1-17.4-3.3\"/><path fill=\"#3e2723\" d=\"M99.3 34.9s13.7 17.5 13.5 39.3l5.5-11.2c-.1 0-4.9-14.3-19-28.1\"/><path fill=\"#4e342e\" d=\"M39.1 28.9s-11.6 9.7-15 20.9-2 24.8-4.6 26.5c-3.7 2.4-7.9-11.9-9.3-13.4C8 60.5.7 54.4.2 53.3S15 35.5 21.7 32.2c8.1-3.8 18.1-4.1 17.4-3.3\"/><path fill=\"#3e2723\" d=\"M29.2 34.9S15.5 52.4 15.7 74.2L10.3 63s4.8-14.3 18.9-28.1\"/><path fill=\"#ffe0b2\" d=\"M21.8 74.6s1 5.4 2.6 7.1.5-1.3.5-1.3-1.7-.9-1.4-7.8-1.7 2-1.7 2m85.3 0s-1 5.4-2.6 7.1-.5-1.3-.5-1.3 1.7-.9 1.4-7.8 1.7 2 1.7 2\"/><g fill=\"#3e2723\"><circle cx=\"54.5\" cy=\"70.5\" r=\".8\"/><circle cx=\"49.9\" cy=\"75.3\" r=\".8\"/><circle cx=\"48.4\" cy=\"70.5\" r=\".8\"/></g><g fill=\"#3e2723\"><circle cx=\"74\" cy=\"70.5\" r=\".8\"/><circle cx=\"78.6\" cy=\"75.3\" r=\".8\"/><circle cx=\"80.1\" cy=\"70.5\" r=\".8\"/></g></g></svg>", zs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M9.86 2A2.86 2.86 0 0 0 7 4.86v1.68h4.29c.39 0 .71.57.71.96H4.86A2.86 2.86 0 0 0 2 10.36v3.781a2.86 2.86 0 0 0 2.86 2.86h1.18v-2.68a2.85 2.85 0 0 1 2.85-2.86h5.25c1.58 0 2.86-1.271 2.86-2.851V4.86A2.86 2.86 0 0 0 14.14 2zm-.72 1.61c.4 0 .72.12.72.71s-.32.891-.72.891c-.39 0-.71-.3-.71-.89s.32-.711.71-.711\"/><path fill=\"#fdd835\" d=\"M17.959 7v2.68a2.85 2.85 0 0 1-2.85 2.859H9.86A2.85 2.85 0 0 0 7 15.389v3.75a2.86 2.86 0 0 0 2.86 2.86h4.28A2.86 2.86 0 0 0 17 19.14v-1.68h-4.291c-.39 0-.709-.57-.709-.96h7.14A2.86 2.86 0 0 0 22 13.64V9.86A2.86 2.86 0 0 0 19.14 7zM8.32 11.513l-.004.004.038-.004zm6.54 7.276c.39 0 .71.3.71.89a.71.71 0 0 1-.71.71c-.4 0-.72-.12-.72-.71s.32-.89.72-.89\"/></svg>", Bs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1976d2\" d=\"M11.956 4.05c-5.694 0-10.354 3.106-10.354 6.947 0 3.396 3.686 6.212 8.531 6.813v2.205h3.53V17.82c.88-.093 1.699-.259 2.475-.497l1.43 2.692h3.996l-2.402-4.048c1.936-1.263 3.147-3.034 3.147-4.97 0-3.841-4.659-6.947-10.354-6.947m1.584 2.712c4.349 0 7.558 1.45 7.558 4.753 0 1.77-.952 3.013-2.505 3.779a1 1 0 0 1-.228-.156c-.373-.165-.994-.352-.994-.352s3.085-.227 3.085-3.302-3.23-3.127-3.23-3.127h-7.092v7.413c-2.64-.766-4.462-2.392-4.462-4.255 0-2.63 3.52-4.753 7.868-4.753m.156 4.12h2.143s.983-.05.983.974c0 1.004-.983 1.004-.983 1.004h-2.143v-1.977m-.031 4.566h.952c.186 0 .28.052.445.207.135.103.28.3.404.476-.57.073-1.17.104-1.801.104z\"/></svg>", Vs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bcd4\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#00bcd4\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#00bcd4\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#00bcd4\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", Hs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#0288d1\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#0288d1\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#0288d1\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", Us = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 1C4.136 1 1 4.136 1 8s3.136 7 7 7 7-3.136 7-7-3.136-7-7-7m1 11H7V7.5h2zm0-6H7V4h2z\"/></svg>", Ws = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#f44336\" d=\"M18.041 3.177c2.24.382 2.879 1.919 2.843 3.527V6.67l-1.013 13.266-13.132.897h.008c-1.093-.044-3.518-.151-3.634-3.545l1.217-2.222 2.462 5.74 2.097-6.77-.045.009.018-.018 6.85 2.186L13.945 9.3l6.53-.409-5.144-4.212 2.71-1.51v.009M3.113 17.252v.017zM6.916 6.874c2.63-2.622 6.033-4.168 7.34-2.844 1.297 1.306-.072 4.523-2.702 7.135-2.666 2.613-6.015 4.248-7.322 2.933-1.306-1.324.036-4.612 2.675-7.224z\"/></svg>", Gs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"m30 12-4-2V6h-4l-2-4-4 2-4-2-2 4H6v4l-4 2 2 4-2 4 4 2v4h4l2 4 4-2 4 2 2-4h4v-4l4-2-2-4ZM6 16a9.9 9.9 0 0 1 .842-4H10v8H6.842A9.9 9.9 0 0 1 6 16m10 10a9.98 9.98 0 0 1-7.978-4H16v-2h-2v-2h4c.819.819.297 2.308 1.179 3.37a1.89 1.89 0 0 0 1.46.63h3.34A9.98 9.98 0 0 1 16 26m-2-12v-2h4a1 1 0 0 1 0 2Zm11.158 6H24a2.006 2.006 0 0 1-2-2 2 2 0 0 0-2-2 3 3 0 0 0 3-3q0-.08-.004-.161A3.115 3.115 0 0 0 19.83 10H8.022a9.986 9.986 0 0 1 17.136 10\"/></svg>", Ks = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M27.837 5.673a4.33 4.33 0 0 0-2.293-2.701c-2.362-1.261-6.11-1.298-9.548-.092a26.3 26.3 0 0 0-8.76 4.966c-2.752 2.542-3.438 4.925-3.189 6.194.523 2.668 3.274 4.539 5.485 6.042.418.284.822.559 1.175.816-1.429.76-4.261 2.444-5.088 4.248a3.88 3.88 0 0 0-.118 3.332A2.37 2.37 0 0 0 6.869 29.8a5.6 5.6 0 0 0 1.49.2 6.35 6.35 0 0 0 5.19-2.856 6.74 6.74 0 0 0 .864-5.382 7.3 7.3 0 0 1 2.044-.03 3.92 3.92 0 0 1 2.816 1.311 1.82 1.82 0 0 1 .423 1.262 1.55 1.55 0 0 1-.772 1.05c-.234.14-.586.355-.504.803.036.194.198.633.894.512a2.93 2.93 0 0 0 2.145-2.651 4 4 0 0 0-1.197-2.904 5.94 5.94 0 0 0-4.396-1.626 10.6 10.6 0 0 0-2.672.304 20 20 0 0 0-2.203-1.846c-1.712-1.3-3.33-2.529-3.235-4.26.125-2.263 2.468-4.532 6.964-6.744 4.016-1.976 7.254-2.037 8.944-1.438a2 2 0 0 1 1.204.883 2.77 2.77 0 0 1-.36 2.47 9.71 9.71 0 0 1-7.425 4.304 3.86 3.86 0 0 1-3.238-.757c-.278-.302-.593-.645-1.074-.383q-.565.31-.225 1.189a3.9 3.9 0 0 0 2.407 1.92 11.7 11.7 0 0 0 7.128-.671c3.527-1.35 6.681-5.202 5.756-8.787M11.895 24.475a4 4 0 0 1-.192.468 4.5 4.5 0 0 1-.753 1.081 2.83 2.83 0 0 1-2.533 1.107c-.056-.032-.078-.146-.085-.193a3.28 3.28 0 0 1 1.076-2.284 11.3 11.3 0 0 1 2.644-1.933 3.85 3.85 0 0 1-.157 1.754\"/></svg>", qs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#0277bd\" d=\"M105.46 209.517c-7.875 0-13.452-7.521-13.452-15.37v-.327c0-7.848 5.578-13.735 13.452-13.735h164.05c1.476-4.905 2.625-11.446 3.281-17.986h-137.81c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h137.31c-.82-6.54-1.969-13.081-3.773-17.986h-104.01c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h91.87c-21.327-37.607-60.864-61.315-106.14-61.315-67.918 0-123.04 54.448-123.04 122.3 0 67.856 55.122 123.28 123.04 123.28 46.59 0 87.112-25.507 107.95-63.114h-152.73z\"/></svg>", Js = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"m6.457 9.894 12.523 5.163-.456 1.211L6 11.105Zm7.02-3.091L26 11.966l-.457 1.21L13.02 8.015ZM6.465 18.885l12.524 5.163-.457 1.21L6.01 20.097Zm7.007-3.086 12.524 5.163-.456 1.21-12.524-5.162Z\"/><path fill=\"#f44336\" d=\"M6 24.07V30l19.997-3.106V20.96zM6 5.11v5.99l20-3.11V2zm0 9.96v5.03l20-3.11v-5.03z\"/></svg>", Ys = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.6.6 0 0 0-.18-.03c-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1q.09.03.18.03c.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64zm-1.98-1.71c.04.31.05.52.05.73s-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2\"/></svg>", Xs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"#0288d1\"><path d=\"m5.747 14.046 6.254 8.61 6.252-8.61-6.254 3.807z\"/><path d=\"M11.999 1.343 5.747 11.83l6.252 3.807 6.253-3.807z\"/></g></svg>", Zs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff4081\" d=\"m24.95 28.948-18-.9a1 1 0 0 1-.95-1V6.906a1 1 0 0 1 .9-.995l18-1.905A1 1 0 0 1 26 5v22.949a1 1 0 0 1-1.05.998Z\"/><path fill=\"#fafafa\" d=\"m20 8.52.19-4.242 3.649-.275.16 4.37a.28.28 0 0 1-.276.283.3.3 0 0 1-.188-.063L22.123 7.52l-1.668 1.23a.29.29 0 0 1-.398-.055A.27.27 0 0 1 20 8.52m-2.128 6.647c0 .487 3.448.25 3.912-.094 0-3.324-1.87-5.073-5.298-5.073-3.421 0-5.345 1.774-5.345 4.436 0 4.642 6.561 4.735 6.561 7.266a1.022 1.022 0 0 1-1.164 1.13c-1.047 0-1.459-.512-1.413-2.242 0-.375-3.984-.494-4.101 0-.308 4.198 2.426 5.41 5.56 5.41C19.619 26 22 24.45 22 21.658c0-4.973-6.653-4.842-6.653-7.31a1.08 1.08 0 0 1 1.243-1.13c.478 0 1.354.08 1.282 1.949\"/></svg>", Qs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#c0ca33\" d=\"M127.22 155.91c14.639-17.51 16.362-35.594 5.023-69.178-7.176-21.241-19.089-37.603-10.334-50.807 9.33-14.065 29.135-.43 12.63 18.371l3.301 2.296c19.806 2.297 29.566-24.83 14.783-32.58-39.038-20.38-73.197 18.802-58.127 64.155 6.459 19.232 15.501 39.613 8.181 55.831-6.315 13.922-18.515 22.103-26.695 22.39-17.079.862-5.74-38.32 13.922-48.08 1.722-.86 4.162-2.009 1.866-4.88-24.255-2.726-38.464 8.468-46.645 24.113-23.825 45.497 45.21 62.289 82.096 18.37z\"/></svg>", $s = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#ff5722\" d=\"M175.94 24.328c-13.037.252-26.009 3.872-37.471 11.174L79.912 72.818a67.13 67.13 0 0 0-30.355 44.906 70.8 70.8 0 0 0 6.959 45.445 67.2 67.2 0 0 0-10.035 25.102 71.54 71.54 0 0 0 12.236 54.156c23.351 33.41 69.468 43.311 102.81 22.07l58.559-37.158a67.36 67.36 0 0 0 30.355-44.906 70.77 70.77 0 0 0-6.982-45.422 67.65 67.65 0 0 0 10.059-25.102 71.63 71.63 0 0 0-12.236-54.156v-.18c-15.324-21.925-40.453-33.727-65.342-33.246zm5.137 28.68a46.5 46.5 0 0 1 36.09 19.969 42.98 42.98 0 0 1 7.365 32.557 45 45 0 0 1-1.393 5.455l-1.123 3.37-2.986-2.247a75.9 75.9 0 0 0-22.902-11.45l-2.244-.651.201-2.246a13.16 13.16 0 0 0-2.379-8.711 13.99 13.99 0 0 0-14.953-5.412 12.8 12.8 0 0 0-3.594 1.572l-58.578 37.25a12.24 12.24 0 0 0-5.502 8.15 13.1 13.1 0 0 0 2.246 9.834 14.03 14.03 0 0 0 14.93 5.569 13.5 13.5 0 0 0 3.594-1.573l22.453-14.234a41.8 41.8 0 0 1 11.898-5.232 46.48 46.48 0 0 1 49.914 18.502 43.02 43.02 0 0 1 7.363 32.557 40.42 40.42 0 0 1-18.254 27.078l-58.58 37.316a43 43 0 0 1-11.898 5.23A46.545 46.545 0 0 1 82.81 227.14a42.98 42.98 0 0 1-7.341-32.557 38 38 0 0 1 1.39-5.41l1.102-3.37 3.008 2.246a75.9 75.9 0 0 0 22.836 11.361l2.244.65-.201 2.247a13.25 13.25 0 0 0 2.447 8.644 14.03 14.03 0 0 0 15.043 5.569 13.1 13.1 0 0 0 3.592-1.573l58.467-37.316a12.17 12.17 0 0 0 5.502-8.173 12.96 12.96 0 0 0-2.246-9.811 14.03 14.03 0 0 0-15.043-5.568 12.8 12.8 0 0 0-3.592 1.57l-22.453 14.258a42.9 42.9 0 0 1-11.877 5.209 46.52 46.52 0 0 1-49.846-18.5 43.02 43.02 0 0 1-7.297-32.557A40.42 40.42 0 0 1 96.798 96.98l58.646-37.316a42.8 42.8 0 0 1 11.811-5.21 46.5 46.5 0 0 1 13.822-1.444z\"/></svg>", ec = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffb300\" d=\"M29.168 14.03a2.7 2.7 0 0 0-1.968-.83 2.51 2.51 0 0 0-1.929.8h-4.443l3.078-3.078a2.835 2.835 0 0 0 2.857-2.842 2.6 2.6 0 0 0-.831-1.969 2.82 2.82 0 0 0-2.014-.788 2.67 2.67 0 0 0-1.968.788 2.36 2.36 0 0 0-.812 1.922L18 11.17V6.726a2.51 2.51 0 0 0 .8-1.929 2.7 2.7 0 0 0-.832-1.968 2.745 2.745 0 0 0-3.936 0 2.7 2.7 0 0 0-.832 1.968 2.51 2.51 0 0 0 .8 1.93v4.443l-3.138-3.138a2.36 2.36 0 0 0-.812-1.922 2.66 2.66 0 0 0-1.968-.788 2.83 2.83 0 0 0-2.014.788 2.6 2.6 0 0 0-.831 1.969 2.74 2.74 0 0 0 .831 2.013 2.8 2.8 0 0 0 2.026.829l3.078 3.078H6.729a2.51 2.51 0 0 0-1.929-.8 2.7 2.7 0 0 0-1.968.831 2.745 2.745 0 0 0 0 3.937 2.7 2.7 0 0 0 1.968.832 2.51 2.51 0 0 0 1.929-.8h4.443l-3.078 3.077a2.835 2.835 0 0 0-2.857 2.842 2.6 2.6 0 0 0 .831 1.969 2.82 2.82 0 0 0 2.014.788 2.67 2.67 0 0 0 1.968-.788 2.36 2.36 0 0 0 .812-1.922L14 20.827v4.444a2.51 2.51 0 0 0-.8 1.929 2.784 2.784 0 0 0 4.768 1.968A2.7 2.7 0 0 0 18.8 27.2a2.51 2.51 0 0 0-.8-1.929v-4.444l3.138 3.138a2.36 2.36 0 0 0 .812 1.922 2.66 2.66 0 0 0 1.968.788 2.83 2.83 0 0 0 2.014-.788 2.6 2.6 0 0 0 .831-1.969 2.74 2.74 0 0 0-.831-2.013 2.8 2.8 0 0 0-2.026-.829L20.828 18h4.443a2.51 2.51 0 0 0 1.93.8 2.784 2.784 0 0 0 1.967-4.769Z\"/></svg>", tc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff6e40\" d=\"M17.087 19.721c-2.36 1.36-5.59 1.5-8.86.1a13.8 13.8 0 0 1-6.23-5.32c.67.55 1.46 1 2.3 1.4 3.37 1.57 6.73 1.46 9.1 0-3.37-2.59-6.24-5.96-8.37-8.71-.45-.45-.78-1.01-1.12-1.51 8.28 6.05 7.92 7.59 2.41-1.01 4.89 4.94 9.43 7.74 9.43 7.74.16.09.25.16.36.22.1-.25.19-.51.26-.78.79-2.85-.11-6.12-2.08-8.81 4.55 2.75 7.25 7.91 6.12 12.24-.03.11-.06.22-.05.39 2.24 2.83 1.64 5.78 1.35 5.22-1.21-2.39-3.48-1.65-4.62-1.17\"/></svg>", nc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zm4 7.5h-4v2h1l-2 1.67L10 13h1v-2H7v2h1l3 2.5L8 18H7v2h4v-2h-1l2-1.67L14 18h-1v2h4v-2h-1l-3-2.5 3-2.5h1z\"/></svg>", rc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#5c6bc0\" d=\"m2 10 8 4V6L2 2zm10 5 8 4v-8l-8-4zm0 11 8 4v-8l-8-4zm10-14v8l8-4V8z\"/></svg>", ic = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#ffca28\"/><path fill=\"#ffca28\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", ac = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#0288d1\"/><path fill=\"#0288d1\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", oc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><path fill=\"#2196f3\" d=\"M80 192 64 320h32c16-80 16-96 63.242-96H176c8.837 0 16 7.163 16 16v352c0 8.837 0 16-32 16h-32v32h192v-32h-32c-32 0-32-7.163-32-16V240c0-8.837 7.163-16 16-16h16c48 0 48 16 64 96h32l-16-128zm560 0v32c16 0 45.713 0 52.57 16L776 434.666 708.57 592c-6.857 16-52.57 16-68.57 16v32h128v-32s-34.285 0-27.428-16L792 472l51.428 120c3.103 7.24-1.52 16-11.428 16v32h128v-32c-16 0-45.713 0-52.57-16L824 397.334 891.43 240c6.857-16 52.57-16 68.57-16v-32H832v32s34.285 0 27.428 16L808 360l-51.428-120c-3.103-7.24 1.52-16 11.428-16v-32zM320 384v32h32c32 0 32 7.163 32 16v352c0 8.837 0 16-32 16h-32v32h304l16-128h-32c-16 80-16 96-64 96h-64c-32 0-32-7.163-32-16V624h80c8.837 0 16 0 16 32v16h32V544h-32v16c0 32-7.163 32-16 32h-80V432c0-8.837 0-16 32-16h64c48 0 48 16 64 96h32l-16-128z\"/></svg>", sc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7cb342\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m-1.667 22.143L6.92 16.73l3.293-3.293 4.12 4.107 7.455-7.44 3.294 3.293Z\"/></svg>", cc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#cfd8dc\" d=\"M4 6V4h8v2H9v7H7V6z\"/><path fill=\"#ef5350\" d=\"M4 1v1H2v12h2v1H1V1zm8 0v1h2v12h-2v1h3V1z\"/></svg>", lc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#757575\" d=\"M15 2H6a2.006 2.006 0 0 0-2 2v22a2.006 2.006 0 0 0 2 2h6v-4H6v-2h6v-2H6v-2h6v-2H6v-2h6v-2h2V4l8 8h2v-1Z\" data-mit-no-recolor=\"true\"/><path fill=\"#0288d1\" d=\"M12 12v18h18V12Zm8 6h-2v8h-2v-8h-2v-2h6Zm8 0h-4v2h2a2.006 2.006 0 0 1 2 2v2a2.006 2.006 0 0 1-2 2h-4v-2h4v-2h-2a2.006 2.006 0 0 1-2-2v-2a2.006 2.006 0 0 1 2-2h4Z\"/></svg>", uc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#fbc02d\" d=\"M12 10h10v2H12z\"/><path fill=\"#fbc02d\" d=\"M16 4h2v8h-2zm4 18h10v2H20zm4 2h2v4h-2zm0-20h2v14h-2zM2 18h10v2H2z\"/><path fill=\"#fbc02d\" d=\"M6 18h2v10H6zM6 4h2v10H6zm10 12h2v12h-2z\"/></svg>", dc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><g fill=\"#0288d1\"><path d=\"M2 2v12h12V2zm1 1h10v10H3z\"/><path d=\"M5 7v1h1v4h1V8h1V7zm5 0a1.003 1.003 0 0 0-1 1v1a1.003 1.003 0 0 0 1 1h1v1H9v1h2a1.003 1.003 0 0 0 1-1v-1a1.003 1.003 0 0 0-1-1h-1V8h2V7z\"/></g></svg>", fc = "<svg xmlns=\"http://www.w3.org/2000/svg\" xml:space=\"preserve\" viewBox=\"0 0 16 16\"><path fill=\"#0288d1\" d=\"M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", pc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff9800\" d=\"m24 6 2 6h-4l-2-6h-3l2 6h-4l-2-6h-3l2 6H8L6 6H5a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3V6Z\"/></svg>", mc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M22.19 4H16v4h2.19L12 14.19V8h2V4H2v4h2v20h4v-.01l.01.01L28 8V4z\"/></svg>", hc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ab47bc\" d=\"m22 11.8-5.7 4.584L22 20.8zM7.24 23.68 4 21.64v-10.8l3.6-1.2 5.16 3.996L23.2 4 28 7v18.6L22 28l-9.192-8.808zm.36-5.28 2.232-2.064L7.6 14.2Z\"/></svg>", gc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#a0f\" d=\"M29.313 12h-6.664a1.427 1.427 0 0 1-1.1-2.24l4.398-6.676A.703.703 0 0 0 25.397 2H8.428a.62.62 0 0 0-.55.289l-5.77 8.627A.703.703 0 0 0 2.658 12h8.175a1.427 1.427 0 0 1 1.099 2.24l-4.48 6.676A.702.702 0 0 0 8 22l6.695.002A1.34 1.34 0 0 1 16 23.375v5.934a.652.652 0 0 0 1.168.433l12.694-16.586a.725.725 0 0 0-.55-1.156\"/></svg>", _c = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#41b883\" d=\"M1.791 3.851 12 21.471 22.209 3.936V3.85H18.24l-6.18 10.616L5.906 3.851z\"/><path fill=\"#35495e\" d=\"m5.907 3.851 6.152 10.617L18.24 3.851h-3.723L12.084 8.03 9.66 3.85z\"/></svg>", vc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M22 18h4v4h-4z\"/><path fill=\"#7c4dff\" d=\"M20 2a4 4 0 0 1-8 0H2v28h28V2Zm-2 24h-2v2h-4v-2h-2v2H6v-2H4V16h2v10h4V16h2v10h4V16h2Zm10 2h-2v-4h-4v4h-2V18h2v-2h4v2h2Z\"/></svg>", yc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fafafa\" fill-opacity=\".785\" d=\"m19.376 15.988-7.708 4.45-7.709-4.45v-8.9l7.709-4.451 7.708 4.45z\"/><path fill=\"#90caf9\" d=\"M12.286 1.98c-.21 0-.41.059-.57.179l-7.9 4.44c-.32.17-.53.5-.53.88v9c0 .38.21.711.53.881l7.9 4.44c.16.12.36.18.57.18s.41-.06.57-.18l7.9-4.44c.32-.17.53-.5.53-.88v-9c0-.38-.21-.712-.53-.882l-7.9-4.44a.95.95 0 0 0-.57-.179zm0 2.15 7 3.94v2.103h-.016v5.177h.016v.54l-7 3.939-7-3.94V8.07zm0 2.08-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/><path fill=\"#0277bd\" d=\"m12.286 6.21-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/></svg>", bc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#01579b\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM7 13l1.5 7h2l1.5-3 1.5 3h2l1.5-7h1v-2h-4v2h1l-.9 4.2L13 15h-2l-1.1 2.2L9 13h1v-2H6v2z\"/></svg>", xc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m.12 13.5 3.74 3.74 1.42-1.41-2.33-2.33 2.33-2.33-1.42-1.41zm11.16 0-3.74-3.74-1.42 1.41 2.33 2.33-2.33 2.33 1.42 1.41z\"/></svg>", Sc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff5252\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2m12 16v-2H9v2zm-4-4v-2H6v2z\"/></svg>", Cc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M27.575 23.967a9.9 9.9 0 0 0-3.751 1.726 22.6 22.6 0 0 1-5.537 2.504 1.55 1.55 0 0 1-.931.52 59 59 0 0 1-6.11.548c-1.102.008-1.777-.282-1.965-.735a1.49 1.49 0 0 1 .82-1.965 3.6 3.6 0 0 1-.486-.359c-.163-.162-.334-.487-.385-.367-.213.52-.324 1.794-.897 2.366-.786.795-2.273.53-3.153.069-.965-.513.069-1.718.069-1.718a.69.69 0 0 1-.94-.324 4.6 4.6 0 0 1-.632-2.794 5.2 5.2 0 0 1 1.674-2.76 8.84 8.84 0 0 1 .624-4.17 9.9 9.9 0 0 1 3-3.469S7.136 11.015 7.82 9.177c.444-1.196.623-1.187.769-1.239a3.44 3.44 0 0 0 1.375-.811 4.99 4.99 0 0 1 4.178-1.607s1.094-3.357 2.12-2.7a17.4 17.4 0 0 1 1.452 2.735s1.213-.71 1.35-.445a10.74 10.74 0 0 1 .495 5.81 13.3 13.3 0 0 1-2.46 5.127c-.129.214 1.47.889 2.477 3.683.932 2.554.103 4.699.248 4.938.026.043.034.06.034.06s1.068.085 3.213-1.24a8.05 8.05 0 0 1 4.05-1.52 1.026 1.026 0 0 1 .453 2Z\"/></svg>", wc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f9a825\" d=\"M2 8h6v4H2zm8 0h12v4H10zm0 12h12v4H10zm14 0h2v4h-2zM8 20l-3 4H2V12h4v8zm14-8h-6l-6 8h6z\"/><path fill=\"#f9a825\" d=\"M16 20h-6l-6 8m12-16h6l6-8m2 4v16h-4V12h-2l3-4z\"/></svg>", Tc = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#afb42b\" d=\"M14 17h-2v-2h-2v-2h2v2h2m0-6h-2v2h2v2h-2v-2h-2V9h2V7h-2V5h2v2h2m5-4H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2\"/></svg>", Ec = "file", Dc = {
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
}, Oc = {
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
}, kc = new Map(Object.entries(/* @__PURE__ */ Object.assign({
	"./icons/asciidoc.svg": lo,
	"./icons/assembly.svg": uo,
	"./icons/astro.svg": fo,
	"./icons/audio.svg": po,
	"./icons/bicep.svg": mo,
	"./icons/c.svg": ho,
	"./icons/cabal.svg": go,
	"./icons/certificate.svg": _o,
	"./icons/clojure.svg": vo,
	"./icons/cmake.svg": yo,
	"./icons/console.svg": bo,
	"./icons/cpp.svg": xo,
	"./icons/crystal.svg": So,
	"./icons/csharp.svg": Co,
	"./icons/css.svg": wo,
	"./icons/dart.svg": To,
	"./icons/database.svg": Eo,
	"./icons/diff.svg": Do,
	"./icons/dll.svg": Oo,
	"./icons/docker.svg": ko,
	"./icons/document.svg": Ao,
	"./icons/editorconfig.svg": jo,
	"./icons/elixir.svg": Mo,
	"./icons/elm.svg": No,
	"./icons/erlang.svg": Po,
	"./icons/eslint.svg": Fo,
	"./icons/exe.svg": Io,
	"./icons/file.svg": Lo,
	"./icons/font.svg": Ro,
	"./icons/fsharp.svg": zo,
	"./icons/git.svg": Bo,
	"./icons/github-actions-workflow.svg": Vo,
	"./icons/gitlab.svg": Ho,
	"./icons/go-mod.svg": Uo,
	"./icons/go.svg": Wo,
	"./icons/gradle.svg": Go,
	"./icons/graphql.svg": Ko,
	"./icons/groovy.svg": qo,
	"./icons/h.svg": Jo,
	"./icons/handlebars.svg": Yo,
	"./icons/haskell.svg": Xo,
	"./icons/hcl.svg": Zo,
	"./icons/hex.svg": Qo,
	"./icons/hpp.svg": $o,
	"./icons/html.svg": es,
	"./icons/image.svg": ts,
	"./icons/jar.svg": ns,
	"./icons/java.svg": rs,
	"./icons/javaclass.svg": is,
	"./icons/javascript.svg": as,
	"./icons/json.svg": os,
	"./icons/julia.svg": ss,
	"./icons/jupyter.svg": cs,
	"./icons/key.svg": ls,
	"./icons/kotlin.svg": us,
	"./icons/kubernetes.svg": ds,
	"./icons/less.svg": fs,
	"./icons/license.svg": ps,
	"./icons/lock.svg": ms,
	"./icons/log.svg": hs,
	"./icons/lua.svg": gs,
	"./icons/makefile.svg": _s,
	"./icons/markdown.svg": vs,
	"./icons/maven.svg": ys,
	"./icons/mdx.svg": bs,
	"./icons/nginx.svg": xs,
	"./icons/nim.svg": Ss,
	"./icons/nix.svg": Cs,
	"./icons/nodejs.svg": ws,
	"./icons/npm.svg": Ts,
	"./icons/objective-c.svg": Es,
	"./icons/objective-cpp.svg": Ds,
	"./icons/ocaml.svg": Os,
	"./icons/pdf.svg": ks,
	"./icons/perl.svg": As,
	"./icons/php.svg": js,
	"./icons/pnpm.svg": Ms,
	"./icons/powerpoint.svg": Ns,
	"./icons/powershell.svg": Ps,
	"./icons/prettier.svg": Fs,
	"./icons/prisma.svg": Is,
	"./icons/proto.svg": Ls,
	"./icons/pug.svg": Rs,
	"./icons/python.svg": zs,
	"./icons/r.svg": Bs,
	"./icons/react.svg": Vs,
	"./icons/react_ts.svg": Hs,
	"./icons/readme.svg": Us,
	"./icons/ruby.svg": Ws,
	"./icons/rust.svg": Gs,
	"./icons/sass.svg": Ks,
	"./icons/sbt.svg": qs,
	"./icons/scala.svg": Js,
	"./icons/settings.svg": Ys,
	"./icons/solidity.svg": Xs,
	"./icons/storybook.svg": Zs,
	"./icons/stylus.svg": Qs,
	"./icons/svelte.svg": $s,
	"./icons/svg.svg": ec,
	"./icons/swift.svg": tc,
	"./icons/table.svg": nc,
	"./icons/terraform.svg": rc,
	"./icons/test-js.svg": ic,
	"./icons/test-ts.svg": ac,
	"./icons/tex.svg": oc,
	"./icons/todo.svg": sc,
	"./icons/toml.svg": cc,
	"./icons/tsconfig.svg": lc,
	"./icons/tune.svg": uc,
	"./icons/typescript-def.svg": dc,
	"./icons/typescript.svg": fc,
	"./icons/video.svg": pc,
	"./icons/vim.svg": mc,
	"./icons/visualstudio.svg": hc,
	"./icons/vite.svg": gc,
	"./icons/vue.svg": _c,
	"./icons/webassembly.svg": vc,
	"./icons/webpack.svg": yc,
	"./icons/word.svg": bc,
	"./icons/xml.svg": xc,
	"./icons/yaml.svg": Sc,
	"./icons/yarn.svg": Cc,
	"./icons/zig.svg": wc,
	"./icons/zip.svg": Tc
})).map(([e, t]) => [e.slice(8, -4), t]));
function Ac(e) {
	let t = e.slice(e.lastIndexOf("/") + 1).toLowerCase(), n = Dc[t];
	if (n) return n;
	let r = t.split(".");
	for (let e = 1; e < r.length; e++) {
		let t = Oc[r.slice(e).join(".")];
		if (t) return t;
	}
	return Ec;
}
var jc = /* @__PURE__ */ new Map(), Mc = (e) => {
	let t = jc.get(e);
	if (t) return t;
	let n = kc.get(e) ?? kc.get("file") ?? "", r = `data:image/svg+xml,${encodeURIComponent(n)}`;
	return jc.set(e, r), r;
};
function Nc({ path: e, size: t = 16, className: n }) {
	return /* @__PURE__ */ Y("img", {
		src: Mc(Ac(e)),
		alt: "",
		"aria-hidden": !0,
		width: t,
		height: t,
		className: P("shrink-0", n)
	});
}
// src/app/atoms/file-input/index.tsx
var Pc = ({ multiple: e = !1, accept: t, files: n = [], errors: r = [], hint: i, disabled: a = !1, onFilesSelected: o, onRemove: s, className: c = "" }) => {
	let l = K(null), u = r.length > 0, d = n.length === 0 || u, f = e && n.length === 0 && !u ? "Upload files" : "Upload file";
	return /* @__PURE__ */ X("div", {
		className: P("file-input flex w-full flex-col items-start gap-[10px] rounded-[8px] bg-input p-2", c),
		"data-invalid": u || void 0,
		children: [
			/* @__PURE__ */ Y("input", {
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
			n.map((e) => /* @__PURE__ */ X("div", {
				className: "file-input-row flex w-full items-center gap-1 overflow-hidden rounded-[4px] bg-elevation-level-1 shadow-convex",
				children: [
					/* @__PURE__ */ Y(B, {
						iconName: V.Attachment,
						size: 16,
						"aria-hidden": "true",
						color: "var(--color-fill-basic-primary)"
					}),
					/* @__PURE__ */ Y("span", {
						className: "file-input-meta min-w-0 flex-1 truncate text-basic-primary",
						children: e.name
					}),
					/* @__PURE__ */ Y("span", {
						className: "file-input-meta shrink-0 text-basic-tertiary",
						children: e.size
					}),
					/* @__PURE__ */ Y("button", {
						type: "button",
						"aria-label": `Remove ${e.name}`,
						disabled: a,
						className: "flex size-4 shrink-0 items-center justify-center disabled:cursor-not-allowed",
						onClick: () => s?.(e.id),
						children: /* @__PURE__ */ Y(B, {
							iconName: V.Close,
							size: 16,
							"aria-hidden": "true",
							color: a ? "var(--color-fill-basic-muted)" : "var(--color-fill-basic-primary)"
						})
					})
				]
			}, e.id)),
			d ? /* @__PURE__ */ X(I, {
				variant: H.Secondary,
				size: z.Medium,
				content: L.IconLeft,
				disabled: a,
				onClick: () => l.current?.click(),
				children: [/* @__PURE__ */ Y(B, {
					iconName: V.FileUpload,
					"aria-hidden": "true"
				}), f]
			}) : null,
			r.map((e, t) => /* @__PURE__ */ Y("p", {
				className: "label-micro w-full text-error-primary",
				children: e
			}, `${t}-${e}`)),
			i ? /* @__PURE__ */ Y("p", {
				className: "file-input-hint w-full text-basic-muted",
				children: i
			}) : null
		]
	});
};
// src/app/atoms/fork-session-item/index.tsx
function Fc(e) {
	return e.replace(/-/g, "").slice(0, 12);
}
var Ic = ({ sessionId: e, title: t, deleted: n = !1, onOpen: r, onDismiss: i }) => {
	let a = n ? "No fork found" : t?.trim() || "Fork", o = `ID: ${Fc(e)}`;
	return n ? /* @__PURE__ */ Y("div", {
		className: P("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] max-w-[540px]", "border-l-2 border-tertiary bg-elevation-sublevel-variant-A text-basic-tertiary"),
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ X("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ Y(B, {
						iconName: V.Scheme,
						size: 20,
						className: "shrink-0"
					}),
					/* @__PURE__ */ Y("span", {
						className: "header-micro",
						children: a
					}),
					i ? /* @__PURE__ */ Y("button", {
						type: "button",
						title: "Dismiss",
						"aria-label": "Dismiss deleted fork",
						onClick: i,
						className: "shrink-0 inline-flex",
						children: /* @__PURE__ */ Y(B, {
							iconName: V.Close,
							size: 20
						})
					}) : /* @__PURE__ */ Y(B, {
						iconName: V.Close,
						size: 20,
						className: "shrink-0"
					})
				]
			}), /* @__PURE__ */ Y("span", {
				className: "code-micro opacity-75 whitespace-nowrap",
				children: o
			})]
		})
	}) : /* @__PURE__ */ Y("button", {
		type: "button",
		onClick: r,
		className: P("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] text-left max-w-[540px]", "border-l-2 border-accent-primary bg-btn-ghost-accent-highlighted text-btn-accent", "hover:bg-btn-ghost-accent-highlighted-hovered", "active:bg-btn-ghost-accent-highlighted-pressed"),
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ X("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ Y(B, {
						iconName: V.Scheme,
						size: 20,
						className: "shrink-0"
					}),
					/* @__PURE__ */ Y("span", {
						className: "header-micro",
						children: a
					}),
					/* @__PURE__ */ Y(B, {
						iconName: V.Right,
						size: 20,
						className: "shrink-0"
					})
				]
			}), /* @__PURE__ */ Y("span", {
				className: "code code-micro opacity-75 whitespace-nowrap",
				children: o
			})]
		})
	});
}, Lc = /* @__PURE__ */ function(e) {
	return e.Small = "btn-small", e.Medium = "btn-medium", e.Large = "btn-large", e;
}({}), Rc = /* @__PURE__ */ function(e) {
	return e.IconLeft = "horizontal-tab-item-icon-left", e.IconRight = "horizontal-tab-item-icon-right", e.IconOnly = "horizontal-tab-item-icon", e.TextOnly = "horizontal-tab-item-text", e.Full = "horizontal-tab-item-full", e;
}({}), zc = ({ active: e = !1, size: t = "btn-large", content: n, iconName: r, trailingIcon: i, disabled: a = !1, className: o = "", children: s, type: c = "button", ...l }) => {
	let u = s != null && s !== !1 && s !== "", d = n ?? (r && i ? "horizontal-tab-item-full" : r ? u ? "horizontal-tab-item-icon-left" : "horizontal-tab-item-icon" : i ? u ? "horizontal-tab-item-icon-right" : "horizontal-tab-item-icon" : "horizontal-tab-item-text"), f = d !== "horizontal-tab-item-icon", p = !!r && (d === "horizontal-tab-item-icon-left" || d === "horizontal-tab-item-icon" || d === "horizontal-tab-item-full"), m = !!i && (d === "horizontal-tab-item-icon-right" || d === "horizontal-tab-item-full" || d === "horizontal-tab-item-icon" && !r);
	return /* @__PURE__ */ X("button", {
		type: c,
		disabled: a,
		className: P("horizontal-tab-item btn", t, d, e ? "horizontal-tab-item-active btn-ghost-highlighted" : "btn-ghost", a && "btn-disabled", o),
		...l,
		children: [
			p ? /* @__PURE__ */ Y(B, { iconName: r }) : null,
			f ? /* @__PURE__ */ Y("span", {
				className: "min-w-0 truncate",
				children: s
			}) : null,
			m ? /* @__PURE__ */ Y(B, { iconName: i }) : null
		]
	});
};
zc.Size = Lc, zc.Content = Rc;
// src/app/atoms/initial-prompt-box/index.tsx
var Bc = ({ icon: e, title: t, description: n, onClick: r, className: i = "" }) => /* @__PURE__ */ X("button", {
	type: "button",
	onClick: r,
	className: P("group relative flex h-[100px] w-full flex-col items-start overflow-hidden", "rounded-[4px] bg-elevation-level-1 text-left shadow-convex", "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--blue-500)]", i),
	children: [
		/* @__PURE__ */ Y("span", {
			"aria-hidden": !0,
			className: "absolute inset-0 bg-btn-ghost transition-colors duration-200 ease-out group-hover:bg-btn-ghost-hovered group-active:bg-btn-ghost-pressed"
		}),
		/* @__PURE__ */ X("span", {
			className: "relative flex w-full items-center gap-[10px] px-4 pb-2 pt-4",
			children: [/* @__PURE__ */ Y(B, {
				iconName: e,
				size: 20,
				className: "shrink-0 [&>path]:fill-basic-tertiary"
			}), /* @__PURE__ */ Y("span", {
				className: "flex-1 min-w-0 truncate label-small text-basic-primary",
				children: t
			})]
		}),
		/* @__PURE__ */ Y("span", {
			className: "relative flex w-full flex-col justify-end px-4 pb-4 pt-2",
			children: /* @__PURE__ */ Y("span", {
				className: "text-micro text-basic-muted line-clamp-2",
				children: n
			})
		})
	]
}), Z = /* @__PURE__ */ function(e) {
	return e.Small = "input-small", e.Medium = "input-medium", e.Large = "input-large", e;
}({}), Vc = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Hc = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Uc = {
	"input-small": z.Small,
	"input-medium": z.Medium,
	"input-large": z.Large
}, Wc = {
	"input-small": 16,
	"input-medium": 20,
	"input-large": 24
}, Gc = {
	"input-small": "pl-1",
	"input-medium": "pl-2",
	"input-large": "pl-3"
}, Kc = {
	"input-small": "pr-1",
	"input-medium": "pr-2",
	"input-large": "pr-3"
}, qc = {
	"input-small": "pl-6",
	"input-medium": "pl-9",
	"input-large": "pl-12"
}, Jc = {
	"input-small": "pr-6",
	"input-medium": "pr-9",
	"input-large": "pr-12"
}, Yc = {
	"input-small": "top-1 left-1",
	"input-medium": "top-2 left-2",
	"input-large": "top-3 left-3"
}, Xc = {
	"input-small": "top-1 right-1",
	"input-medium": "top-2 right-2",
	"input-large": "top-3 right-3"
}, Q = ({ inputSize: e = "input-large", leading: t = "none", leadingOnClick: n, leadingSlot: r, trailing: i = "none", trailingOnClick: a, leadingIconName: o = V.Add, trailingIconName: s = V.Search, inputClassName: c = "", label: l = "", required: u = !1, rounded: d = !1, placeholder: f = "", isDisabled: p = !1, validation: m = !1, validationText: h = "", hintText: g, className: _ = "", ref: v, ...y }) => {
	let b = t !== "none" || !!r, x = i !== "none", S = e === "input-large" && b && !x, C = P("w-full input font-normal", e, c, d ? "rounded-full" : "rounded-[4px]", b ? S ? "input-pad-search" : qc[e] : Gc[e], x ? Jc[e] : Kc[e], p && "input-disabled", m && "input-validation"), w = p ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)";
	return /* @__PURE__ */ Y(to, {
		label: l,
		required: u,
		validation: m,
		validationText: h,
		hintText: g,
		caption: e === "input-large" ? "large" : "compact",
		className: _,
		children: /* @__PURE__ */ X("div", {
			className: "input-wrapper relative w-full h-fit",
			children: [
				r ? /* @__PURE__ */ Y("div", {
					className: P("absolute flex items-center justify-center", S ? "top-3 left-1.5" : Yc[e]),
					style: {
						width: Wc[e],
						height: Wc[e]
					},
					children: r
				}) : null,
				!r && t === "icon" ? /* @__PURE__ */ Y(B, {
					iconName: o,
					size: Wc[e],
					className: P("absolute", S ? "top-3 left-1.5" : Yc[e]),
					color: w
				}) : null,
				!r && t === "button" ? /* @__PURE__ */ Y(I, {
					size: Uc[e],
					variant: H.Ghost,
					content: L.Icon,
					onClick: n,
					className: P("input-btn-leading", !d && "rounded-lg"),
					children: /* @__PURE__ */ Y(B, { iconName: o })
				}) : null,
				/* @__PURE__ */ Y("input", {
					ref: v,
					className: C,
					placeholder: f,
					disabled: p,
					...y
				}),
				i === "icon" ? /* @__PURE__ */ Y(B, {
					iconName: s,
					size: Wc[e],
					className: P("absolute", Xc[e]),
					color: w
				}) : null,
				i === "button" ? /* @__PURE__ */ Y(I, {
					size: Uc[e],
					variant: H.Ghost,
					content: L.Icon,
					onClick: a,
					className: P("input-btn-trailing", !d && "rounded-lg"),
					children: /* @__PURE__ */ Y(B, { iconName: s })
				}) : null
			]
		})
	});
};
Q.Size = Z, Q.Leading = Vc, Q.Trailing = Hc;
// src/app/atoms/input/StickyInput.tsx
var Zc = /* @__PURE__ */ function(e) {
	return e.Default = "default", e.Search = "search", e;
}({}), Qc = ({ variant: e = "default", leading: t = Vc.None, leadingOnClick: n, trailing: r = Hc.None, trailingOnClick: i, leadingIconName: a = V.Add, trailingIconName: o = V.Search, inputClassName: s = "", className: c = "", rounded: l = !0, isDisabled: u = !1, validation: d = !1, onClear: f, value: p, ref: m, ...h }) => {
	let g = e === "search", _ = p != null && String(p).length > 0, v = g ? Vc.Icon : t, y = g ? V.Search : a, b = g ? _ ? Hc.Button : Hc.None : r, x = g ? V.Close : o, S = g ? f : i, C = c.includes("flex-grow") || c.includes("flex-1"), w = l ? "rounded-full" : "rounded-[4px]", T = u ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)", E = {
		[Vc.None]: "pl-3",
		[Vc.Icon]: "pl-10",
		[Vc.Button]: "pl-12"
	}[v], D = {
		[Hc.None]: "pr-3",
		[Hc.Icon]: "pr-10",
		[Hc.Button]: "pr-12"
	}[b];
	return /* @__PURE__ */ Y("div", {
		className: P("bg-elevation-level-3 shadow-xl overflow-hidden h-10", C ? "flex w-full" : "inline-flex w-fit", w, c),
		children: /* @__PURE__ */ X("div", {
			className: "input-wrapper relative w-full h-full",
			children: [
				v === Vc.Icon ? /* @__PURE__ */ Y(B, {
					iconName: y,
					size: 24,
					className: "absolute top-2 left-2",
					color: T
				}) : null,
				v === Vc.Button ? /* @__PURE__ */ Y(I, {
					size: z.Large,
					variant: H.Ghost,
					content: L.Icon,
					onClick: n,
					className: "btn-sticky input-btn-leading",
					children: /* @__PURE__ */ Y(B, { iconName: y })
				}) : null,
				/* @__PURE__ */ Y("input", {
					ref: m,
					className: P("w-full input input-sticky font-normal", w, E, D, u && "input-disabled", d && "input-validation", s),
					disabled: u,
					value: p,
					...h
				}),
				b === Hc.Icon ? /* @__PURE__ */ Y(B, {
					iconName: x,
					size: 24,
					className: "absolute top-2 right-2",
					color: T
				}) : null,
				b === Hc.Button ? /* @__PURE__ */ Y(I, {
					size: z.Large,
					variant: H.Ghost,
					content: L.Icon,
					onClick: S,
					"aria-label": g ? "Clear search" : void 0,
					className: "btn-sticky input-btn-trailing",
					children: /* @__PURE__ */ Y(B, { iconName: x })
				}) : null
			]
		})
	});
};
Qc.Variant = Zc, Qc.Leading = Vc, Qc.Trailing = Hc;
// src/app/atoms/input/TextArea.tsx
var $c = /* @__PURE__ */ function(e) {
	return e.Small = "h-[93px] p-1 text-micro", e.Medium = "h-[86px] p-2 text-small", e.Large = "h-[120px] p-3 text-medium", e;
}({}), el = ({ textAreaSize: e = "h-[86px] p-2 text-small", label: t = "", required: n = !1, isDisabled: r = !1, validation: i = !1, validationText: a = "", hintText: o, className: s = "", textAreaClassName: c = "", ref: l, ...u }) => /* @__PURE__ */ Y(to, {
	label: t,
	required: n,
	validation: i,
	validationText: a,
	hintText: o,
	caption: e === "h-[120px] p-3 text-medium" ? "large" : "compact",
	className: s,
	children: /* @__PURE__ */ Y("textarea", {
		ref: l,
		className: P("w-full input font-normal rounded-[4px]", e, r && "input-disabled", i && "input-validation", c),
		disabled: r,
		...u
	})
});
el.Size = $c;
// src/app/atoms/loader/CircularLoader.tsx
var tl = /* @__PURE__ */ function(e) {
	return e.Brand = "stroke-[var(--color-fill-accent-primary)]", e.Neutral = "stroke-[var(--color-fill-basic-primary)]", e.Destructive = "stroke-[var(--color-fill-error-primary)]", e;
}({}), nl = ({ size: e = mt.Medium, variant: t = "stroke-[var(--color-fill-basic-primary)]", strokeWidth: n = 2, className: r = "", ...i }) => {
	let a = li().replace(/:/g, ""), o = `circular-loader-mask-${a}`, s = `circular-loader-gradient-${a}`, c = 12 - n / 2;
	return /* @__PURE__ */ Y("div", {
		className: P("inline-flex w-fit h-fit animate-spin", r),
		...i,
		children: /* @__PURE__ */ X("svg", {
			width: e - 2,
			height: e - 2,
			viewBox: "0 0 24 24",
			fill: "none",
			xmlns: "http://www.w3.org/2000/svg",
			children: [/* @__PURE__ */ X("defs", { children: [/* @__PURE__ */ X("linearGradient", {
				id: s,
				x1: "0",
				y1: "0",
				x2: "0",
				y2: "1",
				children: [/* @__PURE__ */ Y("stop", {
					offset: "0",
					stopColor: "white",
					stopOpacity: "1"
				}), /* @__PURE__ */ Y("stop", {
					offset: "1",
					stopColor: "white",
					stopOpacity: "0"
				})]
			}), /* @__PURE__ */ X("mask", {
				id: o,
				maskUnits: "userSpaceOnUse",
				children: [/* @__PURE__ */ Y("rect", {
					x: "0",
					y: "0",
					width: "12",
					height: "24",
					fill: "white"
				}), /* @__PURE__ */ Y("rect", {
					x: "12",
					y: "0",
					width: "12",
					height: "24",
					fill: `url(#${s})`
				})]
			})] }), /* @__PURE__ */ Y("circle", {
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
nl.Size = mt, nl.Variant = tl;
// src/app/atoms/loader/ProgressLoader.tsx
var rl = ({ active: e = !1, className: t = "" }) => /* @__PURE__ */ Y("div", {
	className: P("h-px w-full overflow-hidden transition-opacity duration-150", e ? "opacity-100" : "opacity-0", t),
	children: /* @__PURE__ */ Y("div", { className: "h-full w-full rounded-full bg-accent-inverse animate-progress" })
}), il = "M121.021 9.70276e-06C121.635 0.00562721 122.201 0.336563 122.507 0.870577L135.925 24.2549C136.063 24.7077 136.011 25.2039 135.77 25.6245C123.798 46.5422 95.5972 95.432 95.5972 95.432C95.2748 95.7673 94.8263 95.9633 94.35 95.9633C94.35 95.9633 41.4186 95.9998 14.9471 96C14.327 96 13.7541 95.6678 13.4452 95.1289L0.251482 72.1142C-0.109585 71.4843 -0.0743152 70.5531 0.308855 69.8878C0.308855 69.8878 26.8205 24.1272 39.9734 1.1421C40.3239 0.529539 40.9631 0.0326747 41.6869 0.0326651C41.6869 0.0331171 121.021 9.70276e-06 121.021 9.70276e-06ZM17.9867 92.5287H38.3062L28.0888 74.8628L17.9867 92.5287ZM71.4405 92.4921H91.3571L81.3833 75.1488L71.4405 92.4921ZM44.4776 92.3253H64.8395L54.7068 74.6392L44.4776 92.3253ZM94.3943 90.7219L104.699 72.9047H84.1208L94.3943 90.7219ZM31.4008 73.0222L41.4435 90.5842L51.4972 73.0222H31.4008ZM84.704 69.3835H104.622L94.6593 51.9934L84.704 69.3835ZM31.5361 69.3112H51.9053L41.7633 51.595L31.5361 69.3112ZM107.678 67.7382L117.965 49.7693H97.3917L107.678 67.7382ZM98.0384 46.2393H117.945L107.94 28.9421L98.0384 46.2393ZM120.957 44.5242L131.277 26.4965H110.637L120.957 44.5242ZM68.3422 44.1304L78.6021 26.3231H58.0823L68.3422 44.1304ZM110.648 23.0128H131.258L120.976 5.23426L110.648 23.0128ZM58.1921 22.8519H78.4107L68.3014 5.46138L58.1921 22.8519ZM55.0653 21.3342L65.4303 3.50386H44.7004L55.0653 21.3342ZM81.5178 21.3003L91.8827 3.46996H71.1528L81.5178 21.3003Z", al = "M153.045 9.30753e-05C153.475 0 153.734 0.165348 153.935 0.513892C156.659 5.22122 159.463 9.99634 162.212 14.7289L170.478 0.496114C170.663 0.188622 170.997 1.01676e-06 171.357 0C189.161 0.00012553 206.964 0.0226173 224.768 0.0226173C225.263 0.0226173 225.641 0.126836 225.863 0.498976L234.863 16.1296C235.046 16.4462 235.045 16.8479 234.863 17.1649L208.298 63.4387C208.131 63.7127 207.797 64 207.444 64C207.444 64 171.362 63.9773 153.308 63.9774C152.95 63.9774 152.567 63.7127 152.417 63.4632L144.303 49.3669L136.244 63.3367C136.08 63.5817 135.817 63.9484 135.411 63.9484C135.411 63.9484 96.8361 63.9773 81.4848 63.9773C81.4838 63.9773 81.4828 63.9773 81.4819 63.9773C81.479 63.9773 81.4762 63.9774 81.4734 63.9774C81.1058 63.9774 80.7662 63.7813 80.5831 63.4632L72.7738 49.8976L64.8804 63.4892C64.6968 63.8053 64.3583 64 63.9921 64C63.9921 64 27.959 63.9802 9.97191 63.9803C9.6043 63.9803 9.26474 63.7841 9.08163 63.4661L0.136438 47.9273C-0.0460772 47.6102 -0.0454374 47.2201 0.138117 46.9037C0.13793 46.9037 26.9095 0.698576 26.9095 0.698576C27.1378 0.308359 27.4681 0.0248531 27.9419 0.0248511C45.8728 0.0248511 81.7347 0 81.7347 0C82.1599 1.62705e-08 82.6177 0.296445 82.8391 0.692247L90.6841 14.2006L98.6433 0.496114C98.8288 0.188622 99.1624 1.01676e-06 99.5229 0C117.363 0.000125786 135.204 2.31608e-05 153.045 9.30753e-05ZM48.0609 61.9748H61.9268L54.9897 49.9265L48.0609 61.9748ZM191.465 61.9508H205.669L198.567 49.6279L191.465 61.9508ZM11.7777 61.9311H26.0793L18.9273 49.4798L11.7777 61.9311ZM83.2587 61.9282H97.5671L90.4129 49.5006L83.2587 61.9282ZM101.147 61.9282H115.448L108.296 49.4771L101.147 61.9282ZM29.906 61.7949H43.9006L36.9004 49.6222L29.906 61.7949ZM119.275 61.7921H133.27L126.269 49.6193L119.275 61.7921ZM63.9921 60.9321L71.1556 48.5974H56.8286L63.9921 60.9321ZM99.3581 60.8662L106.512 48.4386H92.2039L99.3581 60.8662ZM135.263 60.8448L142.361 48.5974H128.218L135.263 60.8448ZM27.8172 60.7005L34.7728 48.6002H20.7913L27.8172 60.7005ZM207.524 60.6894L214.566 48.4386H200.481L207.524 60.6894ZM20.8834 46.3924H35.0459L27.9937 34.1242L20.8834 46.3924ZM182.087 46.3895H196.249L189.197 34.1219L182.087 46.3895ZM164.037 46.3895H178.359L171.198 34.0343L164.037 46.3895ZM57.0693 46.2307H70.9708L64.0186 34.1364L57.0693 46.2307ZM128.29 46.2307H142.191L135.239 34.1364L128.29 46.2307ZM200.484 46.1626H214.258L207.38 34.1969L200.484 46.1626ZM180.223 45.5056L187.395 33.0359H173.05L180.223 45.5056ZM198.194 45.3711L205.285 33.0359H191.041L198.194 45.3711ZM216.337 45.3669L223.425 33.0359H209.23L216.337 45.3669ZM144.355 45.1453L151.299 33.0359H137.389L144.355 45.1453ZM72.8971 44.7322L79.6799 33.0359H66.1684L72.8971 44.7322ZM65.8535 30.9867H79.973L72.9494 18.7682L65.8535 30.9867ZM101.228 30.9867H115.536L108.378 18.7232L101.228 30.9867ZM137.09 30.9867H151.194L144.196 18.813L137.09 30.9867ZM173.063 30.9867H187.369L180.212 18.7239L173.063 30.9867ZM191.078 30.9867H205.279L198.165 18.6904L191.078 30.9867ZM209.219 30.9867H223.294L216.257 18.7753L209.219 30.9867ZM45.8569 29.9615L52.9107 17.7693H38.8302L45.8569 29.9615ZM207.059 29.9591L214.112 17.7693H200.034L207.059 29.9591ZM153.161 29.9309L160.23 17.6333H146.019L153.161 29.9309ZM117.363 29.9065L124.388 17.7693H110.287L117.363 29.9065ZM189.197 29.9058L196.222 17.7693H182.121L189.197 29.9058ZM225.16 29.8901L232.198 17.6787H218.122L225.16 29.8901ZM81.7234 29.5569L88.6482 17.6333H74.7987L81.7234 29.5569ZM38.6257 15.587H52.7652L45.7468 3.38717L38.6257 15.587ZM74.7873 15.5841H89.1142L81.9508 3.24932L74.7873 15.5841ZM146.008 15.5841H160.335L153.171 3.24932L146.008 15.5841ZM217.88 15.4026H232.084L224.982 3.0797L217.88 15.4026ZM164.21 15.3754L174.931 9.22166L171.357 3.06792L164.21 15.3754ZM92.4047 15.3247L103.071 9.17803L99.5229 3.06792L92.4047 15.3247ZM215.969 14.4006L223.101 2.07176H208.836L215.969 14.4006ZM54.7173 14.3916L61.9217 2.04914H47.5129L54.7173 14.3916ZM144.055 14.3915L151.259 2.04905H136.85L144.055 14.3915ZM36.917 14.3898L43.9936 2.07399H29.7281L36.917 14.3898ZM176.746 8.2023L187.531 2.04914H173.155L176.746 8.2023ZM104.85 8.15332L115.695 2.0491H101.305L104.85 8.15332Z", ol = ({ height: e = 20, markOnly: t = !1, className: n = "" }) => t ? /* @__PURE__ */ Y("svg", {
	height: e,
	viewBox: "0 0 136 96",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	className: n,
	role: "img",
	"aria-label": "NAC",
	children: /* @__PURE__ */ Y("path", {
		fill: "currentColor",
		d: il
	})
}) : /* @__PURE__ */ Y("svg", {
	height: e,
	viewBox: "0 0 235 64",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	className: n,
	role: "img",
	"aria-label": "NAC",
	children: /* @__PURE__ */ Y("path", {
		fill: "currentColor",
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: al
	})
}), sl = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), cl = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), ll = {
	info: "bg-info-primary text-info-primary border-info-primary",
	error: "bg-error-primary text-error-primary border-error-primary",
	danger: "bg-danger-primary text-danger-primary border-danger-primary",
	success: "bg-success-primary text-success-primary border-success-primary"
}, ul = {
	info: V.Info,
	error: V.Danger,
	danger: V.Danger,
	success: V.CheckCircle
}, dl = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, fl = {
	small: "p-2 gap-2",
	medium: "p-3 gap-2",
	large: "p-4 gap-3"
}, pl = {
	small: "label-micro",
	medium: "label-small",
	large: "label-medium"
}, ml = {
	small: "text-micro",
	medium: "text-small",
	large: "text-medium"
}, hl = {
	small: 16,
	medium: 20,
	large: 24
}, gl = ({ title: e, variant: t = "info", size: n = "small", className: r = "", children: i, ...a }) => /* @__PURE__ */ X("div", {
	className: P("flex rounded-[4px] border", ll[t], fl[n], r),
	...a,
	children: [/* @__PURE__ */ Y(B, {
		iconName: ul[t],
		size: hl[n],
		color: dl[t],
		className: "shrink-0"
	}), /* @__PURE__ */ X("div", {
		className: "flex-1 min-w-0 flex flex-col gap-1",
		children: [e ? /* @__PURE__ */ Y("div", {
			className: pl[n],
			children: e
		}) : null, i ? /* @__PURE__ */ Y("div", {
			className: P("opacity-80", ml[n]),
			children: i
		}) : null]
	})]
});
gl.Variant = sl, gl.Size = cl;
// src/app/atoms/model-pill/index.tsx
var _l = /* @__PURE__ */ function(e) {
	return e[e.Small = 24] = "Small", e[e.Medium = 32] = "Medium", e;
}({}), vl = {
	32: 16,
	24: 18
}, yl = {
	32: mt.Large,
	24: mt.Small
}, bl = ({ size: e = 32, active: t = !1, className: n = "", ...r }) => /* @__PURE__ */ X("div", {
	className: P("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full", "border", t ? "border-transparent" : "border-secondary", n),
	style: {
		width: e,
		height: e
	},
	...r,
	children: [
		t ? null : /* @__PURE__ */ Y("div", {
			"aria-hidden": !0,
			className: "absolute inset-0 rounded-full bg-gradient-to-b from-[var(--color-fill-basic-muted)] to-transparent [html.light_&]:bg-gradient-to-t"
		}),
		/* @__PURE__ */ Y(B, {
			iconName: V.Brain,
			size: vl[e],
			color: "var(--color-fill-basic-primary)",
			className: "relative"
		}),
		t ? /* @__PURE__ */ Y(nl, {
			size: yl[e],
			className: "absolute inset-0 m-auto"
		}) : null
	]
});
bl.Size = _l;
// src/app/atoms/number-input/index.tsx
var xl = {
	[Z.Small]: z.Small,
	[Z.Medium]: z.Medium,
	[Z.Large]: z.Large
}, Sl = (e, t, n) => Math.min(Math.max(e, t), n), Cl = ({ value: e, onChange: t, min: n = 0, max: r = 2 ** 53 - 1, step: i = 1, size: a = Z.Medium, disabled: o = !1, className: s = "", "aria-label": c }) => {
	let [l, u] = q(String(e)), [d, f] = q(e);
	d !== e && (f(e), u(String(e)));
	let p = () => {
		let i = Number(l);
		if (l.trim() === "" || Number.isNaN(i)) {
			u(String(e));
			return;
		}
		let a = Sl(i, n, r);
		u(String(a)), a !== e && t(a);
	}, m = (i) => {
		let a = Sl(e + i, n, r);
		a !== e && t(a);
	};
	return /* @__PURE__ */ X("div", {
		className: P("flex items-center gap-2 w-fit", s),
		children: [
			/* @__PURE__ */ Y(I, {
				variant: H.Secondary,
				size: xl[a],
				content: L.Icon,
				disabled: o || e <= n,
				"aria-label": "Decrease",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => m(-i),
				children: /* @__PURE__ */ Y(B, { iconName: V.Remove })
			}),
			/* @__PURE__ */ Y("input", {
				type: "text",
				inputMode: "numeric",
				role: "spinbutton",
				"aria-label": c,
				"aria-valuenow": e,
				"aria-valuemin": n,
				"aria-valuemax": r,
				className: P("input rounded-[4px] text-center w-16 px-1 font-normal", a, o && "input-disabled"),
				value: l,
				disabled: o,
				onChange: (e) => u(e.target.value),
				onBlur: p,
				onKeyDown: (e) => {
					e.key === "Enter" && (e.preventDefault(), p()), e.key === "ArrowUp" && (e.preventDefault(), m(i)), e.key === "ArrowDown" && (e.preventDefault(), m(-i));
				}
			}),
			/* @__PURE__ */ Y(I, {
				variant: H.Secondary,
				size: xl[a],
				content: L.Icon,
				disabled: o || e >= r,
				"aria-label": "Increase",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => m(i),
				children: /* @__PURE__ */ Y(B, { iconName: V.Add })
			})
		]
	});
}, wl = ({ page: e, pageSize: t, totalItems: n, onPageChange: r, itemLabel: i = "items", className: a = "" }) => {
	let o = Le(), s = Math.max(1, Math.ceil(n / t)), c = n === 0 ? 0 : (e - 1) * t + 1, l = Math.min(e * t, n);
	return /* @__PURE__ */ X("div", {
		className: P("flex items-center w-full gap-4 px-4 py-3", o ? "justify-center" : "justify-between", a),
		children: [o ? null : /* @__PURE__ */ X("div", {
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
		}), /* @__PURE__ */ X("div", {
			className: "flex items-center gap-3",
			children: [
				/* @__PURE__ */ Y(I, {
					variant: H.Tertiary,
					size: z.Small,
					content: L.Icon,
					disabled: e <= 1,
					"aria-label": "Previous page",
					onClick: () => r(e - 1),
					children: /* @__PURE__ */ Y(B, { iconName: V.Left })
				}),
				/* @__PURE__ */ X("div", {
					className: "label-small text-basic-secondary",
					children: [
						"Page ",
						e,
						" of ",
						s
					]
				}),
				/* @__PURE__ */ Y(I, {
					variant: H.Tertiary,
					size: z.Small,
					content: L.Icon,
					disabled: e >= s,
					"aria-label": "Next page",
					onClick: () => r(e + 1),
					children: /* @__PURE__ */ Y(B, { iconName: V.Right })
				})
			]
		})]
	});
}, Tl = 6, El = 36;
function Dl(e) {
	let t = String(e ?? ""), n = 2166136261;
	for (let e = 0; e < t.length; e += 1) n ^= t.charCodeAt(e), n = Math.imul(n, 16777619) >>> 0;
	return n >>> 0;
}
function Ol(e) {
	let t = e >>> 0 || 2654435769;
	return () => (t = (t ^ t << 13) >>> 0, t = (t ^ t >>> 17) >>> 0, t = (t ^ t << 5) >>> 0, t);
}
function kl(e) {
	return `hsl(${Dl(e) % 360} 75% 50%)`;
}
function Al(e) {
	let t = e % Tl, n = (e - t) / Tl, r = [];
	return n > 0 && r.push(e - Tl), n < 5 && r.push(e + Tl), t > 0 && r.push(e - 1), t < 5 && r.push(e + 1), r;
}
function jl(e) {
	let t = Array.from({ length: El }, () => !1), n = [];
	for (let e = 0; e < El; e += 1) {
		let t = e % Tl, r = (e - t) / Tl;
		(r === 0 || t === 0 || r === 5 || t === 5) && n.push(e);
	}
	let r = 4 + e() % 5, i = 0;
	for (; i < r && n.length > 0;) {
		let r = e() % 2 == 0 ? n.length - 1 : e() % n.length, a = n.splice(r, 1)[0];
		if (!t[a]) {
			t[a] = !0, i += 1;
			for (let e of Al(a)) !t[e] && !n.includes(e) && n.push(e);
		}
	}
	return t;
}
function Ml(e) {
	let t = Ol(Dl(e)), n = jl(t), r = [];
	for (let e = 0; e < El; e += 1) r.push(n[e] ? 0 : t() % 7 < 4 ? 1 : 2);
	return r;
}
var Nl = 40, Pl = 1.5;
function Fl(e) {
	let t = Math.max(1, Pl * e / Nl);
	return t * Tl / (e - t);
}
var Il = ({ id: e, size: t = 40, isRunning: n = !1, className: r = "", ...i }) => {
	let a = kl(e), o = Ml(e), s = Fl(t), c = s / 2;
	return /* @__PURE__ */ Y("svg", {
		className: P("block shrink-0", n && "pulse-dim", r),
		width: t,
		height: t,
		viewBox: `${-c} ${-c} ${Tl + s} ${Tl + s}`,
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		"aria-hidden": "true",
		...i,
		children: o.map((e, t) => e === 0 ? null : /* @__PURE__ */ Y("rect", {
			x: t % Tl,
			y: Math.floor(t / Tl),
			width: "1",
			height: "1",
			fill: e === 2 ? a : "none",
			stroke: a,
			strokeWidth: s
		}, t))
	});
}, Ll = /* @__PURE__ */ function(e) {
	return e.Project = "project", e.Orphan = "orphan", e;
}({}), Rl = ({ entityId: e, name: t, variant: n = "project", active: r = !1, running: i = !1, trailing: a, isMobile: o = !1, actions: s, className: c = "", type: l = "button", ...u }) => /* @__PURE__ */ X("div", {
	className: P("group flex items-center min-w-0 rounded-[4px] hover:bg-btn-ghost-hovered", o ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1", r && "bg-btn-ghost-highlighted", c),
	children: [
		/* @__PURE__ */ X("button", {
			type: l,
			className: P("flex flex-1 items-center min-w-0 text-left", o ? "gap-3" : "gap-1.5"),
			...u,
			children: [n === "orphan" ? /* @__PURE__ */ Y(Ea, {
				size: 24,
				isRunning: i
			}) : /* @__PURE__ */ Y(Il, {
				id: e,
				size: 24,
				isRunning: i,
				className: "rounded-[2px]"
			}), /* @__PURE__ */ Y("span", {
				className: P("flex-1 truncate", o ? "text-medium" : "label-small", i ? "text-shimmer-basic" : "text-basic-primary"),
				children: t
			})]
		}),
		a ? /* @__PURE__ */ Y("span", {
			className: P("shrink-0 label-micro text-basic-muted", s && !o && "group-hover:hidden group-has-[:focus-visible]:hidden"),
			children: a
		}) : null,
		s ? /* @__PURE__ */ Y("div", {
			className: P("items-center shrink-0", o ? "flex gap-3" : "hidden gap-1.5 group-hover:flex group-has-[:focus-visible]:flex"),
			children: s
		}) : null
	]
});
Rl.Variant = Ll;
// src/app/atoms/radio/index.tsx
var zl = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ X("label", {
	className: P("group flex w-fit items-center gap-2", n ? "cursor-not-allowed" : "cursor-pointer", i),
	children: [/* @__PURE__ */ X("span", {
		className: "relative flex size-4 shrink-0 items-center justify-center",
		children: [
			/* @__PURE__ */ Y("input", {
				type: "radio",
				checked: e,
				onChange: (e) => t(e.target.checked),
				disabled: n,
				className: "peer sr-only",
				...a
			}),
			/* @__PURE__ */ Y("span", {
				"aria-hidden": "true",
				className: P("size-4 rounded-full border shadow-concave", n ? P("bg-btn-secondary-disabled", e ? "border-primary" : "border-muted") : "border-primary bg-btn-secondary group-hover:bg-btn-secondary-hovered group-active:bg-btn-secondary-pressed")
			}),
			e ? /* @__PURE__ */ Y("span", {
				"aria-hidden": "true",
				className: P("pointer-events-none absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-convex", n ? "radio-mark-disabled" : "radio-mark")
			}) : null,
			/* @__PURE__ */ Y("span", {
				"aria-hidden": "true",
				className: "pointer-events-none absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-border-focus-outline)] opacity-0 peer-focus-visible:opacity-100"
			})
		]
	}), r ? /* @__PURE__ */ Y("span", {
		className: P("label-small", n ? "text-basic-muted" : "text-basic-primary"),
		children: r
	}) : null]
}), Bl = (e, t, n) => Math.min(Math.max(e, t), n), Vl = ({ min: e, max: t, value: n, onChange: r, step: i = 1, disabled: a = !1, label: o, className: s = "" }) => {
	let c = K(null), [l, u] = q(!1), [d, f] = q(!1), p = !a && (l || d), m = U((a) => {
		let o = Bl(Math.round(a / i) * i, e, t), s = Number(o.toFixed(4));
		s !== n && r(s);
	}, [
		i,
		e,
		t,
		n,
		r
	]), h = U((n) => {
		let r = c.current;
		if (!r) return;
		let i = r.getBoundingClientRect();
		if (i.width === 0) return;
		let a = Bl((n - i.left) / i.width, 0, 1);
		m(e + a * (t - e));
	}, [
		m,
		e,
		t
	]), g = (e) => {
		if (!a) {
			u(!0);
			try {
				e.currentTarget.setPointerCapture(e.pointerId);
			} catch {}
			h(e.clientX);
		}
	}, _ = (e) => {
		a || e.currentTarget.hasPointerCapture(e.pointerId) && h(e.clientX);
	}, v = () => u(!1), y = (r) => {
		if (a) return;
		let o = r.key === "ArrowLeft" || r.key === "ArrowDown" ? -i : r.key === "ArrowRight" || r.key === "ArrowUp" ? i : 0;
		o ? (r.preventDefault(), f(!0), m(n + o)) : (r.key === "Home" && (r.preventDefault(), f(!0), m(e)), r.key === "End" && (r.preventDefault(), f(!0), m(t)));
	}, b = t === e ? 0 : (n - e) / (t - e) * 100;
	return /* @__PURE__ */ X("div", {
		ref: c,
		role: "slider",
		tabIndex: a ? -1 : 0,
		"aria-label": o ?? "Range",
		"aria-valuemin": e,
		"aria-valuemax": t,
		"aria-valuenow": n,
		"aria-disabled": a,
		className: P("range-input relative w-full touch-none select-none", a ? "cursor-not-allowed" : "cursor-pointer", s),
		onPointerDown: g,
		onPointerMove: _,
		onPointerUp: v,
		onPointerCancel: v,
		onKeyDown: y,
		onKeyUp: () => f(!1),
		onBlur: () => {
			u(!1), f(!1);
		},
		children: [
			/* @__PURE__ */ Y("div", { className: P("pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full", p ? "bg-input-progress-bar" : "bg-input-progress-bar-disabled") }),
			/* @__PURE__ */ Y("div", {
				className: P("pointer-events-none absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full", p ? "bg-input-progress" : "bg-input-progress-disabled"),
				style: { width: `${b}%` }
			}),
			/* @__PURE__ */ Y("div", {
				className: P("range-knob absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", a ? "bg-input-knob-disabled" : "bg-input-knob"),
				style: { left: `${b}%` }
			})
		]
	});
}, Hl = /* @__PURE__ */ function(e) {
	return e.Large = "btn-large", e.Medium = "btn-medium", e.Small = "btn-small", e;
}({}), Ul = /* @__PURE__ */ function(e) {
	return e.Regular = "btn-ghost", e.Accent = "btn-ghost-accent", e.Destructive = "btn-ghost-destructive", e;
}({}), Wl = {
	"btn-ghost": "tab-btn-regular",
	"btn-ghost-accent": "tab-btn-accent",
	"btn-ghost-destructive": "tab-btn-destructive"
}, Gl = ({ size: e = "btn-medium", variant: t = "btn-ghost", active: n = !1, disabled: r, className: i = "", children: a, hoverHint: o, trailing: s, ...c }) => {
	let l = P("btn btn-icon tab-btn w-full", e, Wl[t], n && "tab-btn-active", r && "btn-disabled", i);
	return /* @__PURE__ */ X("button", {
		onClick: () => {},
		className: l,
		disabled: r,
		...c,
		children: [
			a,
			s,
			o ? /* @__PURE__ */ Y("span", {
				className: "inline-flex shrink-0",
				onClick: (e) => e.stopPropagation(),
				onMouseDown: (e) => e.stopPropagation(),
				onKeyDown: (e) => e.stopPropagation(),
				children: /* @__PURE__ */ Y(Xa, {
					title: o.title,
					description: o.description,
					muted: o.muted,
					position: R.CenterRight
				})
			}) : null
		]
	});
};
Gl.Size = Hl, Gl.Variant = Ul;
// src/app/atoms/select/index.tsx
var Kl = {
	[z.Small]: Hl.Small,
	[z.Medium]: Hl.Medium,
	[z.Large]: Hl.Large
}, ql = ({ items: e = [], value: t, onValueChange: n, size: r = z.Medium, itemSize: i, variant: a = H.Secondary, placement: o = R.BottomRight, placeholder: s = "Select...", disabled: c = !1, sticky: l = !1, className: u = "", trailingIcon: d = V.Down, triggerClassName: f = "", panelClassName: p = "", onOpenChange: m }) => {
	let [h, g] = q(!1), _ = e.find((e) => e.id === t), v = i ?? Kl[r], y = (e) => {
		g(e), m?.(e);
	}, b = (e) => {
		n?.(e), y(!1);
	};
	return /* @__PURE__ */ Y(Zr, {
		open: h,
		onClose: () => y(!1),
		placement: o,
		size: l ? Gt.Fit : "min-w-full",
		sticky: l,
		className: u,
		panelClassName: p,
		content: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-1 px-2 md:px-0",
			children: e.map((e) => /* @__PURE__ */ X(Gl, {
				size: v,
				variant: Ul.Regular,
				active: e.id === t,
				hoverHint: e.hoverHint,
				onClick: () => b(e.id),
				children: [e.icon ? /* @__PURE__ */ Y(B, { iconName: e.icon }) : null, /* @__PURE__ */ Y("span", {
					className: "text-left flex-grow",
					children: e.label
				})]
			}, e.id))
		}),
		children: /* @__PURE__ */ X(I, {
			variant: a,
			size: r,
			disabled: c,
			content: L.IconRight,
			className: `${f} overflow-hidden max-w-full`,
			onClick: () => !c && y(!h),
			"aria-expanded": h,
			children: [
				_?.icon ? /* @__PURE__ */ Y(B, { iconName: _.icon }) : null,
				/* @__PURE__ */ Y("span", {
					className: "text-left flex-grow truncate md:max-w-full",
					children: _?.label ?? s
				}),
				/* @__PURE__ */ Y(B, {
					iconName: d,
					className: P(d === V.Down && "transition-transform duration-150 ease-out", d === V.Down && (h ? "rotate-180" : "rotate-0"))
				})
			]
		})
	});
}, Jl = "M95 64.7797H79.5544V78.0484H95V96H0V31.2203H61.7894V0H95V64.7797ZM33.2129 93.6586H46.3415V80.3898H33.2129V93.6586ZM48.6585 93.6586H61.7894V80.3898H48.6585V93.6586ZM79.5544 93.6586H92.6829V80.3898H79.5544V93.6586ZM2.31707 78.0484H15.4479V64.7797H2.31707V78.0484ZM17.765 78.0484H30.8936V49.1718H17.765V78.0484ZM33.2106 78.0484H46.3415V64.7797H33.2106V78.0484ZM2.31707 62.4383H15.4479V49.1718H2.31707V62.4383ZM48.6585 62.4383H61.7894V49.1718H48.6585V62.4383ZM64.1064 62.4383H77.235V49.1718H64.1064V62.4383ZM79.5544 62.4383H92.6829V49.1718H79.5544V62.4383ZM17.765 46.8304H30.8936V33.5617H17.765V46.8304ZM33.2129 46.8282H46.3415V33.5617H33.2129V46.8282ZM79.5544 46.8282H92.6829V33.5617H79.5544V46.8282ZM64.1064 31.2203H77.235V17.9516H64.1064V31.2203ZM64.1064 15.6101H77.235V2.34141H64.1064V15.6101ZM79.5544 15.6101H92.6829V2.34141H79.5544V15.6101Z", Yl = "M48.6585 17.9516H0V0H48.6585V17.9516ZM2.31707 15.6101H15.4479V2.34141H2.31707V15.6101ZM17.765 15.6101H30.8936V2.34141H17.765V15.6101Z", Xl = ({ className: e = "" }) => /* @__PURE__ */ X("svg", {
	width: 95,
	height: 96,
	viewBox: "0 0 95 96",
	xmlns: "http://www.w3.org/2000/svg",
	className: P("fill-basic-muted", e),
	"aria-hidden": !0,
	children: [/* @__PURE__ */ Y("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: Jl
	}), /* @__PURE__ */ Y("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: Yl
	})]
}), Zl = /* @__PURE__ */ function(e) {
	return e.Muted = "muted", e.Tertiary = "tertiary", e.Secondary = "secondary", e.Primary = "primary", e;
}({}), Ql = /* @__PURE__ */ function(e) {
	return e.Horizontal = "horizontal", e.Vertical = "vertical", e;
}({}), $l = ({ variant: e = "muted", label: t, orientation: n = "horizontal", width: r, height: i, className: a = "", ...o }) => {
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
		return i && (e.height = i), r && (e.width = r), /* @__PURE__ */ Y("div", {
			className: `h-full w-px ${l} ${a}`,
			style: e,
			...f
		});
	}
	if (t) {
		let e = { ...d };
		return r && (e.width = r), i && (e.height = i), /* @__PURE__ */ X("div", {
			className: `flex items-center gap-2 w-full ${a}`,
			style: e,
			...f,
			children: [/* @__PURE__ */ Y("span", {
				className: `label-micro ${u} whitespace-nowrap`,
				children: t
			}), /* @__PURE__ */ Y("div", { className: `flex-1 h-[1px] min-h-[1px] max-h-[1px] ${l}` })]
		});
	}
	let p = { ...d };
	return r && (p.width = r), i && (p.height = i), /* @__PURE__ */ Y("div", {
		className: `h-[1px] min-h-[1px] max-h-[1px] w-full ${l} ${a}`,
		style: p,
		...f
	});
};
$l.Variant = Zl, $l.Orientation = Ql;
// src/app/atoms/switch/index.tsx
var eu = /* @__PURE__ */ function(e) {
	return e.Medium = "medium", e.Large = "large", e;
}({}), tu = {
	medium: "h-4 w-8",
	large: "h-5 w-10"
}, nu = {
	medium: "top-0.5 left-0.5 size-3",
	large: "top-0.5 left-[3px] size-4"
}, ru = {
	medium: "translate-x-4",
	large: "translate-x-[18px]"
}, iu = ({ checked: e = !1, disabled: t = !1, onChange: n, size: r = "medium", className: i = "", ...a }) => /* @__PURE__ */ Y("button", {
	type: "button",
	role: "switch",
	"aria-checked": e,
	disabled: t,
	onClick: () => !t && n?.(!e),
	className: P("relative shrink-0 rounded-full shadow-convex transition-colors duration-150", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]", tu[r], t ? P("cursor-not-allowed", e ? "bg-input-switcher-active-disabled" : "bg-input-switcher-disabled") : P("cursor-pointer", e ? "bg-input-switcher-active" : "bg-input-switcher"), i),
	...a,
	children: /* @__PURE__ */ Y("span", { className: P("absolute rounded-full transition-transform duration-150", nu[r], t ? "bg-input-knob-disabled" : e ? "bg-input-knob-active" : "bg-input-knob", e ? ru[r] : "translate-x-0") })
}), au = ({ tags: e, selected: t, onChange: n, disabled: r = !1, className: i = "" }) => {
	let a = (e) => {
		n(t.includes(e) ? t.filter((t) => t !== e) : [...t, e]);
	};
	return /* @__PURE__ */ Y("div", {
		className: P("flex flex-wrap gap-2", i),
		children: e.map((e) => {
			let n = t.includes(e);
			return /* @__PURE__ */ Y(I, {
				size: z.Small,
				variant: n ? H.SecondaryAccent : H.Secondary,
				disabled: r,
				"aria-pressed": n,
				onClick: () => a(e),
				children: e
			}, e);
		})
	});
};
// src/app/features/ui-policy/useSessionBehaviorIconVisible.ts
function ou() {
	return fr().orchestrationEnabled;
}
// src/app/components/projects/ChatSessionActions.tsx
function su({ title: e, pinned: t = !1, isMobile: n = !1, onPin: r, onRename: i, onDelete: a }) {
	let o = n ? z.Medium : z.Small;
	return /* @__PURE__ */ X(J, { children: [
		r ? /* @__PURE__ */ Y(I, {
			variant: H.Ghost,
			size: o,
			content: L.Icon,
			title: t ? "Unpin chat" : "Pin chat",
			"aria-label": `${t ? "Unpin" : "Pin"} ${e}`,
			onClick: r,
			children: /* @__PURE__ */ Y(B, { iconName: t ? V.Unpin : V.Pin })
		}) : null,
		i ? /* @__PURE__ */ Y(I, {
			variant: H.Ghost,
			size: o,
			content: L.Icon,
			title: "Rename chat",
			"aria-label": `Rename ${e}`,
			onClick: i,
			children: /* @__PURE__ */ Y(B, { iconName: V.Edit })
		}) : null,
		a ? /* @__PURE__ */ Y(I, {
			variant: H.GhostDestructive,
			size: o,
			content: L.Icon,
			title: "Delete chat",
			"aria-label": `Delete ${e}`,
			onClick: a,
			children: /* @__PURE__ */ Y(B, { iconName: V.Trash })
		}) : null
	] });
}
// src/app/components/projects/GroupLabel.tsx
function cu({ children: e, className: t }) {
	return /* @__PURE__ */ X("div", {
		className: P("flex items-baseline gap-2", t),
		children: [/* @__PURE__ */ Y("span", {
			className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
			children: e
		}), /* @__PURE__ */ Y($l, { className: "shrink" })]
	});
}
// node_modules/effect/dist/esm/Layer.js
var lu = xt;
// src/app/hooks/useSessionTitle.ts
function uu() {
	let { data: e = [] } = fn(), t = T(e);
	return (e) => a(e, t);
}
// src/app/lib/projects.ts
function du(e) {
	return e.filter((e) => e.lineage == null);
}
function fu(e, t) {
	let n = t;
	for (let t of du(e)) b(t.summary.updated_at) > b(n) && (n = t.summary.updated_at);
	return n;
}
function pu(e, t) {
	return b(t.summary.updated_at) - b(e.summary.updated_at);
}
function mu(e, t) {
	return du(e).filter((e) => e.summary.project_id === t).sort(pu)[0] ?? null;
}
function hu(e, t) {
	return du(e).filter((e) => e.summary.project_id === t).sort((e, t) => b(t.summary.created_at) - b(e.summary.created_at))[0] ?? null;
}
function gu(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let e of du(t)) {
		let t = e.summary.project_id;
		if (!t) continue;
		let r = n.get(t);
		r ? r.push(e) : n.set(t, [e]);
	}
	return e.map((e) => {
		let t = (n.get(e.project_id) ?? []).sort(pu);
		return {
			project: e,
			sessions: t,
			running: t.filter((e) => rt(e.active_run)).length,
			totalCostMicros: t.reduce((e, t) => e + (t.summary.total_cost_micros ?? 0), 0),
			updatedAt: fu(t, e.updated_at)
		};
	});
}
function _u(e) {
	return e.filter((e) => e.lineage == null && !e.summary.project_id).sort((e, t) => Re(e.summary, t.summary));
}
function vu(e) {
	return e.kind === "project" ? e.entry.project.project_id : e.session.summary.session_id;
}
function yu(e, t) {
	return [...gu(e, t).map((e) => ({
		kind: "project",
		entry: e
	})), ..._u(t).map((e) => ({
		kind: "orphan",
		session: e
	}))];
}
function bu(e, t) {
	return t ? e.find((e) => e.project_id === t) ?? null : null;
}
function xu(e, t) {
	return e.cwd === t.cwd && (e.ssh_host ?? null) === (t.ssh_host ?? null) && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function Su(e) {
	return {
		cwd: e.cwd,
		ssh_host: e.ssh_host ?? null,
		ssh_port: e.ssh_port ?? null,
		ssh_identity_file: e.ssh_identity_file ?? null
	};
}
function Cu(e, t) {
	return t ? e.find((e) => xu(e, t)) ?? null : null;
}
var wu = [
	"Pinned",
	"Today",
	"Yesterday",
	"This week",
	"This month",
	"Older"
];
function Tu(e) {
	let t = new Date(e);
	return t.setHours(0, 0, 0, 0), t;
}
function Eu(e, t) {
	let n = new Date(e);
	return n.setDate(n.getDate() - t), n.getTime();
}
function Du(e, t) {
	let n = b(e);
	if (!Number.isFinite(n)) return "Older";
	let r = Tu(t);
	return n >= r.getTime() ? "Today" : n >= Eu(r, 1) ? "Yesterday" : n >= Eu(r, 7) ? "This week" : n >= Eu(r, 30) ? "This month" : "Older";
}
function Ou(e, t, n) {
	let r = /* @__PURE__ */ new Map();
	for (let i of e) {
		let { updatedAt: e, pinned: a } = t(i), o = a ? "Pinned" : Du(e, n), s = r.get(o);
		s ? s.push(i) : r.set(o, [i]);
	}
	return wu.flatMap((e) => {
		let t = r.get(e);
		return t && t.length > 0 ? [{
			label: e,
			items: t
		}] : [];
	});
}
// src/app/components/projects/ChatSessionList.tsx
var ku = 6e4;
function Au({ sessions: e, activeSessionId: t = null, onOpen: n, onRename: r, onDelete: i, onPin: a, isMobile: o = !1, emptyLabel: s = "No chats" }) {
	let c = fr(), l = ou(), u = $t(ku), d = uu(), f = G(() => Ou(e, (e) => ({
		updatedAt: e.summary.updated_at,
		pinned: !!e.summary.pinned
	}), u), [e, u]);
	return e.length === 0 ? /* @__PURE__ */ Y("div", {
		className: "label-small text-basic-muted px-2 py-1",
		children: s
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-8",
		children: f.map((e) => /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ Y(cu, {
				className: "px-2",
				children: e.label
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let s = d(e.summary), u = sa(e.summary.behavior);
					return /* @__PURE__ */ Y(va, {
						title: s,
						behavior: e.summary.behavior,
						showBehaviorIcon: l,
						behaviorLabel: c.orchestrationEnabled ? u.label : void 0,
						active: e.summary.session_id === t,
						running: rt(e.active_run),
						forkedFromTitle: e.summary.forked_from?.title,
						isMobile: o,
						onClick: () => n(e),
						actions: a || r || i ? /* @__PURE__ */ Y(su, {
							title: s,
							pinned: e.summary.pinned,
							isMobile: o,
							onPin: a ? () => a(e) : void 0,
							onRename: r ? () => r(e) : void 0,
							onDelete: i ? () => i(e) : void 0
						}) : null
					}, e.summary.session_id);
				})
			})]
		}, e.label))
	});
}
// src/app/components/projects/ProjectsList.tsx
var ju = 6e4;
function Mu({ items: e, activeId: t = null, onOpenProject: n, onOpenSession: r, isMobile: i = !1, renderActions: a, emptyLabel: o = "No projects" }) {
	let s = $t(ju), c = uu(), l = G(() => Ou(e, (e) => e.kind === "project" ? {
		updatedAt: e.entry.updatedAt,
		pinned: e.entry.project.pinned
	} : {
		updatedAt: e.session.summary.updated_at,
		pinned: !1
	}, s), [e, s]);
	return e.length === 0 ? /* @__PURE__ */ Y("div", {
		className: "label-small text-basic-muted px-2 py-1",
		children: o
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-8",
		children: l.map((e) => /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ Y(cu, {
				className: i ? "px-3" : "px-2",
				children: e.label
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let o = vu(e), s = a?.(e);
					return e.kind === "project" ? /* @__PURE__ */ Y(Rl, {
						entityId: o,
						name: e.entry.project.name,
						active: o === t,
						running: e.entry.running > 0,
						trailing: String(e.entry.sessions.length),
						isMobile: i,
						actions: s,
						onClick: () => n(o)
					}, o) : /* @__PURE__ */ Y(Rl, {
						entityId: o,
						name: c(e.session.summary),
						variant: Ll.Orphan,
						active: o === t,
						running: rt(e.session.active_run),
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
function Nu(e) {
	return Object(e) === e && !Array.isArray(e);
}
// src/app/lib/providerError.ts
function $(e) {
	return e instanceof Error || e == null || u(e) ? e : Object(e) === e ? { status: e.status } : String(e);
}
var Pu = "/api/wallet", Fu = "/admin/workspace/workspace-settings", Iu = "platform.arcee.ai";
function Lu(e) {
	return e instanceof Error ? e.message : String(e);
}
function Ru(e, t) {
	let n = e.match(/https:\/\/[^\s"'),]+/), r = Iu;
	if (n) try {
		let { hostname: e } = new URL(n[0]);
		e.endsWith(".arcee.ai") && /^api\d*\./.test(e) && (r = e.replace(/^api(\d*)\./, "platform$1."));
	} catch {}
	return `https://${r}${t}`;
}
function zu(e, t) {
	let n = /* @__PURE__ */ new Set();
	for (let t of [
		/HTTP (\d{3})/g,
		/\((\d{3}) [A-Z]/g,
		/"code":\s*(\d{3})/g,
		/status[ _]code["']?[:=]\s*(\d{3})/gi
	]) for (let r of e.matchAll(t)) n.add(Number(r[1]));
	return t !== null && n.add(t), n;
}
function Bu(e) {
	let t = e.indexOf("{");
	if (t === -1) return e;
	let n = e.slice(t), r = Vu(n) ?? Hu(n);
	if (r === null) return e;
	let i = e.slice(0, t).trim().replace(/:$/, "");
	return i ? `${i} — ${r}` : r;
}
function Vu(e) {
	try {
		return Uu(JSON.parse(e));
	} catch {
		return null;
	}
}
function Hu(e) {
	let t = e.match(/"(?:message|detail|error_description)"\s*:\s*"((?:[^"\\]|\\.)*)/);
	if (!t) return null;
	try {
		return JSON.parse(`"${t[1]}"`);
	} catch {
		return t[1];
	}
}
function Uu(e) {
	if (u(e)) return e;
	if (!Nu(e)) return null;
	for (let t of [
		"message",
		"detail",
		"error",
		"error_description"
	]) {
		let n = Uu(e[t]);
		if (n !== null) return n;
	}
	return null;
}
var Wu = {
	title: "There was a problem with authentication",
	description: "Please sign back in to continue using the API.",
	fix: {
		kind: "login",
		label: "Sign in again"
	}
};
function Gu(e, t) {
	let n = Lu(e), r = Yu(e) ? e.status : null, i = n.toLowerCase(), a = (...e) => e.some((e) => i.includes(e)), o = zu(n, r), s = n.match(/invalid model configuration:\s*(.+)/is);
	if (s) return {
		title: "Configuration needs repair",
		description: qu(s[1]),
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
			url: Ru(n, Fu)
		}
	};
	if (a("insufficient_credits", "insufficient credits", "insufficient_quota", "top up your wallet") || o.has(402)) return {
		title: "Not enough credits for this request",
		description: "The provider reserved more than the remaining balance allows. The wallet can still show a balance. Top up, or retry.",
		fix: {
			kind: "link",
			label: "Open wallet",
			url: Ru(n, Pu)
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
	return c || a("arcee authorization was revoked", "arcee token refresh failed", "rejected this login", "authentication_error") || o.has(401) ? !(t && br(t) !== null) && (c || t === "arcee-api") ? {
		title: "There was a problem with authentication",
		description: "The API key was rejected. Add a valid Arcee API key to continue.",
		fix: {
			kind: "settings",
			label: "Open settings"
		}
	} : Wu : a("permission_error") || o.has(403) ? {
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
	} : { title: qu(Bu(n)) };
}
function Ku(e, t) {
	let { title: n, description: r } = Gu(e, t);
	return r ? `${n}. ${r}` : n;
}
function qu(e) {
	let t = e.trim();
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function Ju(e) {
	return e != null && !(e instanceof Error) && !u(e);
}
function Yu(e) {
	return Ju(e) ? Number.isFinite(e.status) : !1;
}
// src/app/components/modals/AssignToProjectModal.tsx
function Xu({ open: e, onClose: t, summary: n }) {
	let r = Cn(), i = Le(), a = uu(), { data: o } = ie(), s = qe(), c = $r(), [l, u] = q(""), [d, f] = q(null), p = G(() => Cu(o?.projects ?? [], n), [o, n]), m = s.isPending || c.isPending;
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: t,
		title: "Assign to Project",
		size: dn.Small,
		footer: /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(I, {
			variant: H.Tertiary,
			content: L.Text,
			onClick: t,
			disabled: m,
			children: "Cancel"
		}), /* @__PURE__ */ Y(I, {
			variant: H.Primary,
			content: L.Text,
			onClick: async () => {
				if (n && !m) {
					f(null);
					try {
						let e = p ?? await c.mutateAsync({
							name: l.trim() || null,
							...Su(n)
						});
						await s.mutateAsync({
							projectId: e.project_id,
							sessionId: n.session_id
						}), r.success(`Assigned to ${e.name}`), t();
					} catch (e) {
						f(Ku($(e)));
					}
				}
			},
			loading: m,
			children: p ? "Assign" : "Create and assign"
		})] }),
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-4",
			children: [
				/* @__PURE__ */ X("p", {
					className: "text-small",
					children: [/* @__PURE__ */ Y("span", {
						className: "text-basic-primary font-bold",
						children: a(n)
					}), " belongs to no project yet."]
				}),
				p ? /* @__PURE__ */ X("div", {
					className: "flex items-center gap-3 rounded-[8px] border border-muted p-3",
					children: [/* @__PURE__ */ Y(Il, {
						id: p.project_id,
						size: 32,
						className: "rounded-[4px]"
					}), /* @__PURE__ */ X("div", {
						className: "flex flex-col min-w-0",
						children: [/* @__PURE__ */ Y("span", {
							className: "label-medium text-basic-primary truncate",
							children: p.name
						}), /* @__PURE__ */ Y("span", {
							className: "text-micro text-basic-muted truncate",
							children: p.cwd
						})]
					})]
				}) : /* @__PURE__ */ Y(J, { children: /* @__PURE__ */ Y(Q, {
					label: "Project name",
					inputSize: i ? Z.Large : Z.Medium,
					placeholder: "Taken from the git remote",
					value: l,
					onChange: (e) => {
						f(null), u(e.target.value);
					}
				}) }),
				d ? /* @__PURE__ */ Y("p", {
					className: "text-error-primary text-micro",
					children: d
				}) : null
			]
		})
	});
}
// src/app/components/modals/ConfigRow.tsx
var Zu = "w-full md:w-[280px]";
function Qu({ label: e, hint: t, required: n = !1, invalid: r = !1 }) {
	return /* @__PURE__ */ X("div", {
		className: "flex items-center gap-1 w-full",
		children: [/* @__PURE__ */ X("div", {
			className: P("label-small", r ? "text-error-primary" : "text-basic-primary"),
			children: [e, n ? "*" : ""]
		}), t ? /* @__PURE__ */ Y(Xa, {
			title: t,
			position: R.TopCenter
		}) : null]
	});
}
function $u({ label: e, hint: t, required: n = !1, invalid: r = !1, secondary: i = !1, muted: a = !1, verticalOnMobile: o = !1, labelClassName: s = "", control: c }) {
	return /* @__PURE__ */ X("div", {
		className: P("flex w-full min-h-9 md:flex-row items-center md:justify-between md:min-h-5", o ? "flex-col items-stretch justify-center gap-1" : "flex-row items-center justify-between"),
		children: [/* @__PURE__ */ X("div", {
			className: P("flex items-center gap-1 min-w-0 md:flex-1 md:max-w-[220px]", o ? "max-w-none" : "flex-1 max-w-[220px]", s),
			children: [/* @__PURE__ */ X("div", {
				className: P(o ? "md:truncate" : "truncate", i ? "text-small" : "label-small", r ? "text-error-primary" : a ? "text-basic-muted" : i ? "text-basic-secondary" : "text-basic-primary"),
				children: [e, n ? "*" : ""]
			}), t ? /* @__PURE__ */ Y(Xa, {
				title: t,
				position: R.TopCenter
			}) : null]
		}), /* @__PURE__ */ Y("div", {
			className: P("shrink-0", o && "w-full md:w-auto"),
			children: c
		})]
	});
}
// src/app/lib/catalog.ts
function ed(e) {
	return e.connection?.base_url ?? e.managed_base_url ?? e.default_base_url ?? "";
}
var td = "deepseek/deepseek-v4-flash-latest", nd = ["arcee-auth", "arcee-api"];
function rd(e) {
	let t = nd.flatMap((t) => {
		let n = od(e, t);
		if (!n) return [];
		let r = ed(n);
		return r ? [{
			provider: n,
			baseUrl: r
		}] : [];
	}), n = t.find((e) => e.provider.auth_status === "ready") ?? t[0];
	return n ? {
		backend: n.provider.id,
		model: td,
		baseUrl: n.baseUrl
	} : null;
}
var id = {
	provider: null,
	model: null,
	contextWindow: null,
	supportedEfforts: [],
	estimated: !1
};
function ad(e) {
	let t = e.lastIndexOf("-");
	if (t <= 0) return null;
	let n = e.slice(t + 1);
	return n.length === 8 && /^\d{8}$/.test(n) ? e.slice(0, t) : null;
}
function od(e, t) {
	return e?.providers?.find((e) => e.id === t) ?? null;
}
function sd(e, t) {
	let n = e.models.find((e) => e.id === t);
	if (n) return n;
	let r = ad(t);
	return r ? e.models.find((e) => e.id === r) ?? null : null;
}
function cd(e, t, n) {
	let r = (n ?? "").trim(), i = od(e, (t ?? "").trim());
	if (!i || !r) return id;
	let a = sd(i, r);
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
function ld(e, t) {
	let n = t.trim();
	if (!n) return null;
	let r = (e?.providers ?? []).filter((e) => e.models.some((e) => e.id === n));
	if (r.length === 0) return null;
	let i = r.find((e) => e.id === "openai-responses"), a = r.find((e) => e.managed_base_url === null);
	return (i ?? a ?? r[0]).id;
}
// src/app/components/modals/catalogModelOverlay.ts
var ud = {
	input: 0,
	output: 0,
	cache_read: 0,
	cache_write: 0
};
function dd(e, t) {
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
			cost: ud,
			reasoning: !1,
			supported_efforts: e.default_limits.supported_efforts,
			source: "fallback"
		};
	});
}
// src/app/components/modals/CatalogModelPicker.tsx
function fd(e, t, n) {
	let r = t.trim().toLowerCase(), i = [...e?.providers ?? []].sort((e, t) => {
		let n = e.auth_status === "ready" ? 0 : 1, r = t.auth_status === "ready" ? 0 : 1;
		return n === r ? zn(e.id) - zn(t.id) : n - r;
	}), a = [];
	for (let e of i) for (let t of dd(e, n.get(e.id))) (!r || `${t.id} ${t.display_name ?? ""} ${e.id}`.toLowerCase().includes(r)) && a.push({
		provider: e,
		model: t
	});
	return a;
}
function pd(e) {
	return Number.isFinite(e) && e > 0 ? `$${Number(e.toFixed(2))}` : null;
}
function md(e) {
	let t = pd(e.input), n = pd(e.output);
	return t && n ? `${t}/${n} per 1M` : "pricing unknown";
}
function hd(e) {
	return [e.context_window > 0 ? `${h(e.context_window)} ctx` : "", md(e.cost)].filter(Boolean).join(" · ");
}
var gd = (e) => e.display_name || e.id;
function _d({ provider: e }) {
	return e.auth_status === "ready" ? /* @__PURE__ */ Y(Li, {
		text: "available",
		color: Fi.Green,
		className: "shrink-0 whitespace-nowrap"
	}) : /* @__PURE__ */ Y(Li, {
		text: e.managed_base_url ? "login required" : "no credential detected",
		color: Fi.Yellow,
		className: "shrink-0 whitespace-nowrap"
	});
}
function vd({ catalog: e, loading: t, failed: n, disabled: r = !1, compact: i = !1, liveByBackend: a, value: o, onSelect: s }) {
	let c = Le(), [l, u] = q(!1), [d, f] = q(""), [p, m] = q(null), [h, g] = q(null), _ = K(null), v = c ? Hl.Large : Hl.Medium, y = G(() => fd(e, d, a), [
		e,
		d,
		a
	]), b = p === null ? null : Math.min(p, Math.max(y.length - 1, 0)), x = h !== null && h < y.length ? h : b, S = (e) => {
		f(e), m(null), g(null);
	};
	W(() => {
		l && b !== null && _.current?.querySelector(`[data-row="${b}"]`)?.scrollIntoView({ block: "nearest" });
	}, [l, b]);
	let C = y.find((e) => e.provider.id === o?.backend && e.model.id === o?.model), w = () => {
		u(!1), m(null), g(null);
	}, T = (e) => {
		s({
			backend: e.provider.id,
			model: e.model.id,
			baseUrl: ed(e.provider)
		}), u(!1), S("");
	}, E = (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (e.preventDefault(), !y.length) return;
			let t = e.key === "ArrowDown" ? 1 : -1;
			m(((x ?? (t === 1 ? -1 : 0)) + t + y.length) % y.length), g(null);
		} else if (e.key === "Enter") {
			e.preventDefault();
			let t = y[x ?? 0];
			t && T(t);
		}
	}, D = o ? C ? gd(C.model) : o.model : t ? "Loading models…" : n ? "Model catalog unavailable" : "Select a model";
	return /* @__PURE__ */ Y(Zr, {
		open: l,
		onClose: w,
		placement: i ? R.TopRight : R.BottomLeft,
		size: "w-[520px]",
		sticky: !0,
		className: P(i ? "min-w-0" : "shrink-0", c && "w-full"),
		panelClassName: "p-2 overflow-hidden",
		sheetClassName: "h-[70dvh] max-h-[70dvh] min-h-[70dvh] overflow-hidden [&>*]:min-h-0 [&>*]:h-full [&>*]:flex [&>*]:flex-col",
		content: /* @__PURE__ */ X("div", {
			className: P("flex flex-col min-h-0", c ? "h-full" : "h-[340px]"),
			children: [/* @__PURE__ */ Y("div", {
				className: "shrink-0 p-4 pt-0 md:p-0 md:pb-2",
				children: /* @__PURE__ */ Y(Q, {
					inputSize: c ? Z.Large : Z.Medium,
					leading: Vc.Icon,
					leadingIconName: V.Search,
					placeholder: "Search models…",
					autoFocus: !0,
					autoComplete: "off",
					spellCheck: !1,
					value: d,
					onChange: (e) => S(e.target.value),
					onKeyDown: E
				})
			}), /* @__PURE__ */ Y("div", {
				ref: _,
				className: "flex flex-col flex-1 gap-1 min-h-0 overflow-auto [&>*]:shrink-0",
				children: y.length === 0 ? /* @__PURE__ */ Y("p", {
					className: "px-4 md:px-2 py-3 text-micro text-basic-muted",
					children: t ? "Reading the catalog…" : n ? "The model catalog could not be read." : `No model matches "${d.trim()}".`
				}) : y.map((e, t) => {
					let n = t === 0 || y[t - 1].provider.id !== e.provider.id, r = e.provider.id === o?.backend && e.model.id === o?.model;
					return /* @__PURE__ */ X("div", {
						className: "px-2 md:px-0",
						children: [n ? /* @__PURE__ */ X("div", {
							className: "flex items-center gap-2 px-2 pt-6 pb-2",
							children: [
								/* @__PURE__ */ Y("span", {
									className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
									children: Jt(e.provider.id)
								}),
								/* @__PURE__ */ Y($l, { className: "shrink" }),
								/* @__PURE__ */ Y(_d, { provider: e.provider })
							]
						}) : null, /* @__PURE__ */ X(Gl, {
							size: v,
							variant: Ul.Regular,
							active: r,
							"data-row": t,
							onMouseEnter: () => g(t),
							onMouseLeave: () => g((e) => e === t ? null : e),
							onClick: () => T(e),
							children: [
								/* @__PURE__ */ Y("span", {
									className: "flex-1 min-w-0 text-left truncate",
									children: gd(e.model)
								}),
								c ? null : /* @__PURE__ */ Y("span", {
									className: "code-small text-basic-muted truncate md:max-w-[180px]",
									children: e.model.id
								}),
								/* @__PURE__ */ Y("span", {
									className: "text-micro text-basic-muted shrink-0",
									children: hd(e.model)
								})
							]
						})]
					}, `${e.provider.id}/${e.model.id}`);
				})
			})]
		}),
		children: /* @__PURE__ */ X(I, {
			variant: i ? H.Ghost : H.Secondary,
			size: i ? z.Small : c ? z.Large : z.Medium,
			content: i ? L.IconLeft : L.IconRight,
			disabled: !e || r,
			onClick: () => l ? w() : u(!0),
			"aria-expanded": l,
			"aria-label": i ? "Model" : void 0,
			className: i ? "min-w-0 max-w-full !gap-1.5 !pr-3" : "w-full md:w-[280px]",
			children: [
				i ? /* @__PURE__ */ Y(B, { iconName: V.Brain }) : null,
				/* @__PURE__ */ Y("span", {
					className: P("min-w-0 text-left truncate", i ? "label-micro max-w-[96px]" : "flex-1"),
					children: D
				}),
				o && Jt(o.backend) !== D ? /* @__PURE__ */ Y("span", {
					className: P("truncate", i ? "label-micro max-w-[72px] text-basic-tertiary" : "text-micro text-basic-muted max-w-[110px]"),
					children: Jt(o.backend)
				}) : null,
				i ? null : /* @__PURE__ */ Y(B, {
					iconName: V.Down,
					className: P("transition-transform duration-150 ease-out", l ? "rotate-180" : "rotate-0")
				})
			]
		})
	});
}
// src/app/components/modals/KeyStatus.tsx
function yd({ status: e }) {
	return e === "validating" ? /* @__PURE__ */ Y(f, { size: mt.XSmall }) : e === "ready" ? /* @__PURE__ */ Y(B, {
		iconName: V.CheckCircle,
		size: 16,
		className: "text-success-primary"
	}) : /* @__PURE__ */ Y(B, {
		iconName: e === "error" ? V.Danger : V.Key,
		size: 16,
		className: P(e === "error" ? "text-error-primary" : "text-basic-muted")
	});
}
// src/app/features/setup/lifetime.ts
function bd() {
	let e = pt(on()), t = new AbortController(), n = !0;
	return pt(kt(e, N(() => {
		n = !1, t.abort();
	}))), {
		signal: t.signal,
		current: () => n,
		close: () => pt(We(e, Bt))
	};
}
function xd(e = !0) {
	let t = K(null);
	return W(() => {
		let n = bd();
		return t.current = n, e || n.close(), n.close;
	}, [e]), t;
}
// src/app/features/managed/controller/deviceLoginOperation.ts
var Sd = (e) => ["provider-device-login-attempt", e];
async function Cd(e, t) {
	let { api: n } = Yn(e), r = Sd(t), i = e.getQueryData(r);
	if (i && ["starting", "waiting"].includes(i.state.status)) return {
		attempt: i.attempt,
		fresh: !1
	};
	let a = {
		provider: t,
		cancelled: !1
	}, o = () => e.getQueryData(r)?.attempt === a, s = (t, n = !1) => {
		o() && e.setQueryData(r, {
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
		let i = await Ie(x({ command: () => n.startManagedLogin(t) }));
		if (a.prompt = i, a.cancelled) return await n.cancelManagedLogin(t, i.login_id).catch(() => {}), {
			attempt: a,
			fresh: !1
		};
		if (!o()) return {
			attempt: a,
			fresh: !1
		};
		s({
			status: "waiting",
			prompt: i
		});
		let c = [
			"provider-device-login",
			t,
			i.login_id
		], l = new pi(e, {
			queryKey: c,
			queryFn: async ({ signal: r }) => {
				let a = await n.pollManagedLogin(t, i.login_id, r);
				return a.state === "complete" && o() && await Xn(e), a;
			},
			retry: !1,
			refetchInterval: (e) => !e.state.error && (!e.state.data || e.state.data.state === "pending") && 2e3,
			refetchIntervalInBackground: !0,
			gcTime: 0
		}), u = !1, d = () => {}, f = () => {
			u || (u = !0, a.dispose = void 0, l.destroy(), d(), e.removeQueries({
				queryKey: c,
				exact: !0
			}));
		};
		return a.dispose = f, d = e.getQueryCache().subscribe((e) => {
			e.type === "removed" && e.query.queryKey[0] === r[0] && e.query.queryKey[1] === t && e.query.state.data?.attempt === a && f();
		}), l.subscribe((e) => {
			u || a.cancelled || !o() || (e.isError ? (s({
				status: "failed",
				message: mr($(e.error))
			}), f()) : e.data?.state === "complete" ? (s({ status: "idle" }, !0), f()) : e.data?.state === "failed" && (s({
				status: "failed",
				message: e.data.error
			}), f()));
		}), {
			attempt: a,
			fresh: !0
		};
	} catch (e) {
		return !a.cancelled && o() && s({
			status: "failed",
			message: mr($(e))
		}), {
			attempt: a,
			fresh: !1
		};
	}
}
async function wd(e, t) {
	let { api: n } = Yn(e), r = Sd(t), i = e.getQueryData(r);
	if (!i || !["starting", "waiting"].includes(i.state.status)) return;
	let a = i.attempt;
	a.cancelled = !0, a.dispose?.(), e.setQueryData(r, {
		attempt: a,
		state: { status: "idle" },
		completed: !1
	}), a.prompt && await n.cancelManagedLogin(t, a.prompt.login_id).catch(() => {});
}
// src/app/features/managed/controller/useDeviceLogin.ts
function Td(e, t) {
	let n = vi(), r = xd(), [i, a] = q(t ?? null), [o, s] = q(null), c = t ?? i, l = K(c);
	ui(() => {
		l.current = c;
	}, [c]);
	let u = Sd(c), d = _i({
		queryKey: u,
		queryFn: () => n.getQueryData(u) ?? null,
		enabled: !1,
		gcTime: Infinity
	}).data, f = K(e), p = K(null);
	W(() => {
		f.current = e;
	}, [e]);
	let m = U(async (e) => {
		let t = r.current;
		if (!t?.current()) return;
		l.current = e, a(e);
		let i = await Cd(n, e);
		t.current() && l.current === e && n.getQueryData(Sd(e))?.attempt === i.attempt && (s({
			attempt: i.attempt,
			current: t.current
		}), i.fresh && i.attempt.prompt && !i.attempt.cancelled && window.open(i.attempt.prompt.verification_uri, "_blank", "noopener,noreferrer"));
	}, [n, r]), h = U(async () => {
		c && await wd(n, c);
	}, [n, c]);
	return W(() => {
		d?.completed && d.attempt === o?.attempt && o.current() && p.current !== d.attempt && (p.current = d.attempt, f.current?.());
	}, [d, o]), {
		state: d?.state ?? { status: "idle" },
		start: m,
		cancel: h
	};
}
// src/app/features/managed/controller/useManagedSignIn.ts
function Ed(e) {
	let t = br(e), { data: n } = Un(!!t);
	return {
		provider: t,
		signedIn: !!(t && n?.providers.find((e) => e.provider === t)?.signed_in)
	};
}
// src/app/features/managed/presentation/ManagedAuthCallout.tsx
var Dd = {
	arcee: V.Arcee,
	codex: V.ChatGpt
};
function Od({ backend: e, className: t = "", rejected: n = !1 }) {
	let { provider: r, signedIn: i } = Ed(e), { state: a, start: o, cancel: s } = Td(void 0, r), c = Ke(), l = Mt(e, !!r && i);
	if (!r) return null;
	let u = er(r), d = a.status === "failed", p = i && l.isError, m = d || p || n, h = a.status === "waiting", g = i && !m, _ = n && i, v = h ? /* @__PURE__ */ X("div", {
		className: "flex items-center gap-2",
		children: [
			/* @__PURE__ */ Y(f, { size: mt.XSmall }),
			a.prompt.user_code ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y("span", {
				className: "text-micro text-basic-muted",
				children: "Code"
			}), /* @__PURE__ */ Y("span", {
				className: "label-small text-basic-primary tabular-nums",
				children: a.prompt.user_code
			})] }) : /* @__PURE__ */ Y("span", {
				className: "text-micro text-basic-muted",
				children: "Waiting for the browser"
			}),
			/* @__PURE__ */ X(I, {
				variant: H.Ghost,
				size: z.Medium,
				content: L.IconRight,
				onClick: () => window.open(a.prompt.verification_uri, "_blank", "noopener,noreferrer"),
				children: [/* @__PURE__ */ X("span", { children: ["Open ", u] }), /* @__PURE__ */ Y(B, { iconName: V.External })]
			}),
			/* @__PURE__ */ Y(I, {
				variant: H.Ghost,
				size: z.Medium,
				content: L.Text,
				onClick: () => void s(),
				children: "Cancel"
			})
		]
	}) : g ? /* @__PURE__ */ X("div", {
		className: "flex items-center gap-2",
		children: [/* @__PURE__ */ X("div", {
			className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
			children: [/* @__PURE__ */ Y(B, {
				iconName: V.CheckCircle,
				className: "text-success-primary"
			}), /* @__PURE__ */ Y("span", {
				className: "label-small text-success-primary",
				children: "Signed in"
			})]
		}), /* @__PURE__ */ Y(I, {
			variant: H.Ghost,
			size: z.Medium,
			content: L.Text,
			loading: c.isPending,
			onClick: () => void c.mutateAsync(r).catch(() => {}),
			children: "Sign out"
		})]
	}) : /* @__PURE__ */ X(I, {
		variant: H.Primary,
		size: z.Medium,
		content: L.IconRight,
		loading: a.status === "starting" || c.isPending,
		onClick: () => void (_ ? c.mutateAsync(r) : Promise.resolve()).then(() => o(r)).catch(() => {}),
		children: [/* @__PURE__ */ Y("span", { children: _ ? `Sign in to ${u} again` : `Sign in with ${u}` }), /* @__PURE__ */ Y(B, { iconName: V.External })]
	}), y = h ? `Approve the request on ${u}, then return here.` : g ? "NAC holds this login and every session on this provider uses it." : `This provider authenticates with ${u} in your browser instead of with an API key.`;
	return /* @__PURE__ */ X("div", {
		className: P("flex flex-col gap-3 rounded-[8px] border bg-elevation-level-2 p-3 md:flex-row md:items-center md:justify-between md:gap-4", m ? "border-error-primary" : "border-muted", t),
		children: [/* @__PURE__ */ X("div", {
			className: "flex items-start gap-2 min-w-0",
			children: [/* @__PURE__ */ Y(B, {
				iconName: Dd[r],
				className: P("shrink-0", m ? "text-error-primary" : "text-basic-secondary")
			}), /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-0.5 min-w-0",
				children: [/* @__PURE__ */ X("span", {
					className: P("label-small", m ? "text-error-primary" : "text-basic-primary"),
					children: [u, " sign-in"]
				}), /* @__PURE__ */ Y("span", {
					className: "text-micro text-basic-muted",
					children: y
				})]
			})]
		}), /* @__PURE__ */ X("div", {
			className: "flex flex-col items-stretch md:items-end gap-1 shrink-0",
			children: [v, d || p || c.isError ? /* @__PURE__ */ Y("p", {
				className: "label-micro !text-[10px] !leading-[12px] text-error-primary max-w-[280px] md:text-right pt-1 opacity-70",
				children: Ku(d ? a.message : c.isError ? c.error : l.error, e)
			}) : null]
		})]
	});
}
// src/app/lib/modelConfig.ts
function kd(e, t, n, r = null) {
	return {
		...e,
		api_key_env: e.backend === t && (!e.api_key_env || e.api_key_env === r) ? n : e.api_key_env
	};
}
function Ad(e, t) {
	return {
		...e,
		api_key_env: t !== null && e.api_key_env === t ? null : e.api_key_env
	};
}
function jd(e, t) {
	return e === t ? !0 : !e || !t ? !1 : e.model === t.model && (e.backend ?? null) === (t.backend ?? null) && (e.base_url ?? null) === (t.base_url ?? null) && (e.api_key_env ?? null) === (t.api_key_env ?? null) && (e.reasoning_effort ?? null) === (t.reasoning_effort ?? null);
}
var Md = {
	"arcee-auth": "https://api.arcee.ai/api/v1",
	"chatgpt-codex-responses": "https://chatgpt.com/backend-api"
}, Nd = "__clear__";
function Pd(e) {
	return Md[(e ?? "").trim()] ?? null;
}
function Fd(e) {
	return e === "arcee-auth" || e === "chatgpt-codex-responses";
}
function Id(e) {
	return (e ?? "").trim() || null;
}
function Ld(e) {
	return (e ?? "").split(",").map((e) => e.trim()).filter(Boolean);
}
function Rd(e, t) {
	if (e !== "inherit") {
		if (e === "none") return null;
		if (e !== "variable") throw Error("Choose how credentials are selected");
		if (!t) throw Error("API key environment variable is required when Environment variable is selected");
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) throw Error("API key environment variable must match [A-Za-z_][A-Za-z0-9_]* exactly (no whitespace)");
		return t;
	}
}
function zd(e, t) {
	if (!e) return;
	let n = Fd(e);
	if (n && t !== "none") throw Error(`${e} uses ${e === "arcee-auth" ? "stored Arcee login" : "stored Codex OAuth"} and does not accept an API key environment variable`);
	if (!n && t !== "variable") throw Error(`${e} requires an API key environment variable; explicitly select Environment variable`);
}
function Bd(e, t) {
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
	for (let [e, t] of Object.entries(i)) if (!u(t)) throw Error(`Extra Headers value for "${e}" must be a string`);
	return i;
}
function Vd(e, t) {
	let n = e.trim();
	if (!n) throw Error(`${t} is required and cannot be cleared`);
	return n;
}
function Hd(e, t) {
	let n = Object.keys(e).sort(), r = Object.keys(t).sort();
	return n.length === r.length && n.every((n, i) => n === r[i] && e[n] === t[n]);
}
function Ud(e, t, n = !1) {
	let r = Vd(e.backend, "Backend"), i = Pd(r), a, o;
	if (i) a = Id(e.base_url) ?? i, o = null;
	else {
		a = Vd(e.base_url, "Base URL");
		let t = Rd(e.credential_mode, e.api_key_env);
		if (t === void 0) throw Error("Select an API key environment variable or explicitly choose none");
		o = t, n && e.credential_mode === "none" || zd(r, e.credential_mode);
	}
	let s = {
		model: Vd(e.model, "Model"),
		base_url: a,
		allow_insecure_http: e.allow_insecure_http,
		backend: r,
		reasoning_effort: e.reasoning_effort === "__clear__" ? null : e.reasoning_effort || null,
		api_key_env: o
	}, c = {};
	s.model !== t.model && (c.model = s.model), s.base_url !== t.base_url && (c.base_url = s.base_url), s.allow_insecure_http !== t.allow_insecure_http && (c.allow_insecure_http = s.allow_insecure_http), s.backend !== t.backend && (c.backend = s.backend), s.reasoning_effort !== t.reasoning_effort && (c.reasoning_effort = s.reasoning_effort), s.api_key_env !== t.api_key_env && (c.api_key_env = s.api_key_env);
	let l = Bd(e.extra_headers, {});
	(t.extra_headers_invalid || !Hd(l, t.extra_headers)) && (c.extra_headers = l);
	let u = e.orchestrator_compaction_threshold.trim();
	if (u !== "" && !/^\d+$/.test(u)) throw Error("Context Limit must be a non-negative integer");
	let d = u === "" ? null : Number(u);
	return d !== t.orchestrator_compaction_threshold && (c.orchestrator_compaction_threshold = d), c;
}
[...wn.map((e) => ({
	id: e,
	label: Jt(e)
}))];
var Wd = wn.map((e) => ({
	id: e,
	label: Jt(e)
})), Gd = [
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
], Kd = [
	{
		id: "",
		label: "Inherit config"
	},
	{
		id: Nd,
		label: "Clear configured effort"
	},
	...Gd
], qd = /* @__PURE__ */ new Set(["", Nd]);
function Jd(e, t, n = Kd) {
	if (e.length === 0) return n;
	let r = new Set(e);
	return n.filter((e) => qd.has(String(e.id)) || r.has(String(e.id)) || e.id === t);
}
// src/app/hooks/useExitTransition.ts
var Yd = 300;
function Xd(e, t = Yd) {
	let [n, r] = q(e);
	return e && !n && r(!0), W(() => {
		if (e) return;
		let n = setTimeout(() => r(!1), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
// src/app/components/modals/PathPickerModal.tsx
function Zd({ open: e, ssh: t, ...n }) {
	return Xd(e) ? /* @__PURE__ */ Y(Qd, {
		open: e,
		ssh: t ?? null,
		...n
	}) : null;
}
function Qd({ open: e, kind: t, initialPath: n, ssh: r, title: i, showHidden: a = !1, clearLabel: o, onClear: s, onClose: c, onSelect: l }) {
	let u = t !== "directory", d = Le(), [p, m] = q(n.trim()), [h, g] = q(n.trim()), [_, v] = q(null), [y, b] = q(a), x = gr(p || null, t, y, !r), S = Wt(r ?? null, p || null, y, !!r), { data: C, error: w, isFetching: T } = r ? S : x, E = (e) => {
		m(e), g(e), v(null);
	}, D = u ? _ : C?.path ?? p;
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: c,
		title: i ?? (t === "toml" ? "Select Config File" : t === "file" ? "Select File" : r ? `Select Working Folder on ${r.ssh_host}` : "Select Working Folder"),
		size: dn.Wide,
		flush: !0,
		className: "h-[560px]",
		bodyClassName: "min-h-0",
		footer: /* @__PURE__ */ X(J, { children: [
			s ? d ? /* @__PURE__ */ Y(gn, {
				variant: H.Secondary,
				content: L.Text,
				onClick: s,
				children: o ?? "Clear"
			}) : /* @__PURE__ */ Y(I, {
				variant: H.Ghost,
				size: z.Large,
				content: L.Text,
				className: "mr-auto",
				onClick: s,
				children: o ?? "Clear"
			}) : null,
			d ? /* @__PURE__ */ Y(gn, {
				variant: H.Secondary,
				content: L.Text,
				onClick: c,
				children: "Cancel"
			}) : /* @__PURE__ */ Y(I, {
				variant: H.Secondary,
				size: z.Large,
				content: L.Text,
				onClick: c,
				children: "Cancel"
			}),
			d ? /* @__PURE__ */ Y(gn, {
				variant: H.Primary,
				content: L.Text,
				disabled: !D,
				onClick: () => {
					D && l(D);
				},
				children: "Select"
			}) : /* @__PURE__ */ Y(I, {
				variant: H.Primary,
				size: z.Large,
				content: L.Text,
				disabled: !D,
				onClick: () => {
					D && l(D);
				},
				children: "Select"
			})
		] }),
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-3 h-full min-h-0",
			children: [
				/* @__PURE__ */ X("div", {
					className: "flex items-center gap-2 shrink-0",
					children: [
						/* @__PURE__ */ Y(I, {
							variant: H.Secondary,
							size: z.Medium,
							content: L.Icon,
							disabled: !C?.parent,
							onClick: () => C?.parent && E(C.parent),
							"aria-label": "Parent directory",
							children: /* @__PURE__ */ Y(B, { iconName: V.Top })
						}),
						/* @__PURE__ */ Y(I, {
							variant: H.Secondary,
							size: z.Medium,
							content: L.Icon,
							disabled: !C?.home,
							onClick: () => C?.home && E(C.home),
							"aria-label": "Home directory",
							children: /* @__PURE__ */ Y(B, { iconName: V.Home })
						}),
						/* @__PURE__ */ Y(Q, {
							inputSize: Z.Medium,
							className: "flex-1 min-w-0",
							placeholder: r ? "~/path/on/the/host" : "/path/to/directory",
							value: h,
							onChange: (e) => g(e.target.value),
							onKeyDown: (e) => {
								e.key === "Enter" && E(h.trim());
							}
						}),
						/* @__PURE__ */ Y(I, {
							variant: y ? H.SecondaryHighlighted : H.Secondary,
							size: z.Medium,
							content: L.Icon,
							onClick: () => b((e) => !e),
							"aria-pressed": y,
							title: y ? "Hide dot-prefixed entries" : "Show hidden entries",
							"aria-label": y ? "Hide dot-prefixed entries" : "Show hidden entries",
							children: /* @__PURE__ */ Y(B, { iconName: y ? V.Eye : V.EyeStrikethrough })
						})
					]
				}),
				w ? /* @__PURE__ */ Y("p", {
					className: "label-micro text-error-primary shrink-0",
					children: mr(w)
				}) : null,
				/* @__PURE__ */ X("div", {
					className: "flex-1 min-h-0 overflow-auto rounded-[4px] bg-input shadow-concave p-1 flex flex-col [&>*]:shrink-0",
					children: [
						T && !C ? /* @__PURE__ */ Y("div", {
							className: "flex items-center justify-center py-6",
							children: /* @__PURE__ */ Y(f, { size: mt.Small })
						}) : null,
						C?.entries.length === 0 ? /* @__PURE__ */ X("p", {
							className: "text-micro text-basic-muted px-2 py-3",
							children: [t === "toml" ? "No directories or .toml files here." : t === "file" ? "Nothing here." : "No subdirectories here.", y ? "" : " Hidden entries are not listed."]
						}) : null,
						C?.entries.map((e) => /* @__PURE__ */ X("button", {
							type: "button",
							className: P("flex items-center gap-3 md:gap-2 w-full px-2 md:px-2 py-3 md:py-1.5 rounded-[4px] text-left", "hover:bg-elevation-sublevel-variant-A", _ === e.path && "bg-elevation-sublevel-variant-A"),
							onClick: () => e.is_directory ? E(e.path) : v(e.path),
							onDoubleClick: () => {
								e.is_directory || l(e.path);
							},
							children: [/* @__PURE__ */ Y(B, {
								iconName: e.is_directory ? V.Folder : V.File,
								size: d ? 20 : 16,
								className: "shrink-0 text-basic-muted"
							}), /* @__PURE__ */ Y("span", {
								className: P("text-basic-primary truncate", d ? "text-small" : "text-small "),
								children: e.name
							})]
						}, e.path)),
						C?.truncated ? /* @__PURE__ */ Y("p", {
							className: "text-micro text-basic-muted px-2 py-2",
							children: "Only the first entries are listed; type a path to go deeper."
						}) : null
					]
				}),
				/* @__PURE__ */ Y("p", {
					className: "text-micro text-basic-muted shrink-0 truncate",
					children: D ? `Selected: ${D}` : "Nothing selected yet."
				})
			]
		})
	});
}
// src/app/components/modals/SmallSelect.tsx
function $d({ items: e, value: t, onValueChange: n, placeholder: r, disabled: i = !1, size: a = z.Medium, trailingIcon: o, triggerClassName: s, placement: c = R.CenterLeft, onOpenChange: l }) {
	let u = Le();
	return /* @__PURE__ */ Y(ql, {
		items: e,
		value: t,
		onValueChange: n,
		placeholder: r,
		disabled: i,
		size: a,
		trailingIcon: o,
		triggerClassName: s,
		itemSize: u ? Hl.Large : Hl.Medium,
		variant: H.Ghost,
		placement: c,
		onOpenChange: l,
		sticky: !0,
		panelClassName: "max-h-[200px] overflow-auto min-w-[220px] max-w-[calc(100vw-16px)]"
	});
}
// src/app/lib/apiKey.ts
var ef = "*".repeat(32);
function tf(e) {
	return e.map((e) => ({
		id: e.id,
		label: e.display_name ?? e.id
	}));
}
// src/app/components/modals/ResolvedRows.tsx
function nf({ resolving: e, resolved: t, backend: n, onBackend: r, baseUrl: i, onBaseUrl: a, model: o, onModel: s, failed: c }) {
	if (e) return /* @__PURE__ */ X("div", {
		className: "flex items-center gap-2 py-1",
		children: [/* @__PURE__ */ Y(f, { size: mt.XSmall }), /* @__PURE__ */ Y("span", {
			className: "text-micro text-basic-muted",
			children: "Checking the key and reading the model list…"
		})]
	});
	if (!t || !n) return c ? null : /* @__PURE__ */ Y("p", {
		className: "text-micro text-basic-muted py-1",
		children: "Pick a configuration to see its provider and models."
	});
	let l = Ar(n), u = t.models.length > 0, d = !!t.models_error, p = u ? tf(t.models) : o ? [{
		id: o,
		label: o
	}] : [];
	return /* @__PURE__ */ X(J, { children: [
		/* @__PURE__ */ Y($u, {
			label: "Model Provider",
			required: !0,
			hint: "Service that provides the models for this session.",
			control: /* @__PURE__ */ Y($d, {
				items: Wd,
				value: n,
				onValueChange: (e) => r(e)
			})
		}),
		l ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($l, {}), /* @__PURE__ */ Y($u, {
			label: "API Key",
			required: !0,
			hint: "Held by NAC for this configuration; save a new setup to use a different key.",
			control: /* @__PURE__ */ Y(Q, {
				inputSize: Z.Medium,
				className: Zu,
				value: ef,
				isDisabled: !0,
				readOnly: !0,
				leadingSlot: /* @__PURE__ */ Y(yd, { status: "ready" })
			})
		})] }) : null,
		/* @__PURE__ */ Y($l, {}),
		u || d ? /* @__PURE__ */ Y($u, {
			label: "Default Model",
			invalid: d,
			hint: "The NAC session will start with this default and may switch to another.",
			control: /* @__PURE__ */ Y($d, {
				items: d ? [] : p,
				value: d ? "" : o,
				onValueChange: s,
				disabled: d,
				placeholder: "–"
			})
		}) : /* @__PURE__ */ X(J, { children: [
			/* @__PURE__ */ Y($u, {
				label: "Model",
				required: !0,
				hint: "Model identifier the endpoint expects.",
				control: /* @__PURE__ */ Y(Q, {
					inputSize: Z.Medium,
					className: Zu,
					placeholder: "gpt-5.5",
					value: o,
					onChange: (e) => s(e.target.value)
				})
			}),
			/* @__PURE__ */ Y($l, {}),
			/* @__PURE__ */ Y($u, {
				label: "Base URL",
				required: !0,
				hint: "Endpoint the session sends its requests to.",
				control: /* @__PURE__ */ Y(Q, {
					inputSize: Z.Medium,
					className: Zu,
					placeholder: "https://api.openai.com/v1",
					value: i,
					onChange: (e) => a(e.target.value)
				})
			})
		] })
	] });
}
// src/app/components/modals/SourceMenu.tsx
function rf({ label: e, configurations: t, activeId: n, source: r, onSelect: i, onDelete: a }) {
	let o = Le(), [s, c] = q(!1), l = o ? Hl.Large : Hl.Medium, u = o ? z.Large : z.Medium, d = (e) => {
		i(e), c(!1);
	}, f = /* @__PURE__ */ X("div", {
		className: P("flex flex-col min-h-0", o ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
		children: [/* @__PURE__ */ X("div", {
			className: "flex flex-col shrink-0 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ X(Gl, {
					size: l,
					variant: Ul.Regular,
					active: r === "catalog",
					onClick: () => d({ kind: "catalog" }),
					children: [/* @__PURE__ */ Y(B, { iconName: V.Search }), /* @__PURE__ */ Y("span", {
						className: "text-left flex-grow",
						children: "Browse Models"
					})]
				}),
				/* @__PURE__ */ X(Gl, {
					size: l,
					variant: Ul.Regular,
					active: r === "new",
					onClick: () => d({ kind: "new" }),
					children: [/* @__PURE__ */ Y(B, { iconName: V.Add }), /* @__PURE__ */ Y("span", {
						className: "text-left flex-grow",
						children: "Create New"
					})]
				}),
				/* @__PURE__ */ X(Gl, {
					size: l,
					variant: Ul.Regular,
					active: r === "file",
					onClick: () => d({ kind: "file" }),
					children: [/* @__PURE__ */ Y(B, { iconName: V.File }), /* @__PURE__ */ Y("span", {
						className: "text-left flex-grow",
						children: "From a .toml file"
					})]
				})
			]
		}), t.length > 0 ? /* @__PURE__ */ X("div", {
			className: "flex flex-col flex-1 min-h-0 min-w-0",
			children: [/* @__PURE__ */ Y("div", { className: "h-px w-full bg-divider-muted my-1 shrink-0" }), /* @__PURE__ */ Y("div", {
				className: "flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
				children: t.map((e) => /* @__PURE__ */ X("div", {
					className: "flex items-center gap-1",
					children: [/* @__PURE__ */ X(Gl, {
						size: l,
						variant: Ul.Regular,
						active: n === e.id,
						className: "flex-1 min-w-0",
						onClick: () => d({
							kind: "saved",
							configId: e.id
						}),
						children: [/* @__PURE__ */ Y(B, { iconName: V.Gear }), /* @__PURE__ */ Y("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						})]
					}), /* @__PURE__ */ Y(I, {
						variant: H.TertiaryDestructive,
						size: u,
						content: L.Icon,
						"aria-label": `Remove ${e.name}`,
						onClick: () => a(e.id, e.name),
						children: /* @__PURE__ */ Y(B, { iconName: V.Trash })
					})]
				}, e.id))
			})]
		}) : null]
	});
	return /* @__PURE__ */ Y(Zr, {
		open: s,
		onClose: () => c(!1),
		placement: R.BottomLeft,
		size: "w-auto",
		className: "shrink-0",
		panelClassName: "max-h-72 overflow-hidden",
		sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
		content: f,
		children: /* @__PURE__ */ X(I, {
			variant: H.Secondary,
			size: z.Medium,
			content: L.IconRight,
			onClick: () => c((e) => !e),
			"aria-expanded": s,
			children: [/* @__PURE__ */ Y("span", {
				className: "text-left flex-grow truncate max-w-[96px] md:max-w-[220px]",
				children: e
			}), /* @__PURE__ */ Y(B, {
				iconName: V.Down,
				className: P("transition-transform duration-150 ease-out", s ? "rotate-180" : "rotate-0")
			})]
		})
	});
}
// src/app/hooks/useDebouncedValue.ts
function af(e, t) {
	let [n, r] = q(e);
	return W(() => {
		let n = setTimeout(() => r(e), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
// src/app/features/managed/controller/useManagedModelProfile.ts
function of() {
	let e = pn(), t = e.data ?? null, n = G(() => ze(t), [t]), r = U((e) => le(t, e), [t]);
	return {
		defaultPick: n,
		configured: n !== null,
		matches: r,
		credentialReady: !!t?.model_ready,
		initializing: e.isPending
	};
}
// src/app/features/managed/presentation/ManagedModelCredentialStatus.tsx
function sf({ ready: e }) {
	return /* @__PURE__ */ Y($u, {
		label: "Credential",
		verticalOnMobile: !0,
		hint: "This managed host supplies the credential securely; it is not stored in this configuration or exposed to commands.",
		control: /* @__PURE__ */ X("div", {
			className: P("flex items-center gap-1.5 rounded-[4px] py-2 pl-2 pr-4", e ? "bg-success-secondary" : "bg-error-tertiary"),
			children: [/* @__PURE__ */ Y(B, {
				iconName: e ? V.CheckCircle : V.Repair,
				className: e ? "text-success-primary" : "text-error-primary"
			}), /* @__PURE__ */ Y("span", {
				className: P("label-small", e ? "text-success-primary" : "text-error-primary"),
				children: e ? "Detected" : "Host needs attention"
			})]
		})
	});
}
// src/app/components/modals/ConfigurationsPanel.tsx
var cf = "custom", lf = [...wn.map((e) => ({
	id: e,
	label: Jt(e)
})), {
	id: cf,
	label: "Custom"
}], uf = 400;
function df(e, t) {
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => e[n] === t[n]);
}
function ff({ invalid: e, errorText: t, onChange: n, initial: r, children: i }) {
	let a = Cn(), o = of(), { data: s, isPending: c } = bn(), l = Gn(), u = Ze(l.data), d = Yt(), f = G(() => s?.configurations ?? [], [s]), [p, m] = q(null), [h, g] = q(null), _ = r?.backend ?? "arcee-api", [v, y] = q(wn.includes(_) ? _ : cf), [b, x] = q(_), [S, C] = q(null), [w, T] = q(""), [E, D] = q(r?.model ?? ""), [O, k] = q(r?.base_url ?? ""), [A, j] = q(r?.allow_insecure_http ?? !1), [ee, M] = q(r?.model ?? ""), [te, ne] = q(""), [N, re] = q(!1), [ie, ae] = q(null), [oe, se] = q(null), [ce, le] = q(null), ue = o.defaultPick, F = ue ? u.get(ue.backend) : void 0, de = o.configured && o.credentialReady && l.isPending, fe = F === null, pe = p === null && h === null && (c || o.initializing || de || fe), me = G(() => ue ? F === void 0 ? ue : F === null ? null : F.some((e) => e.id === ue.model) ? ue : null : null, [ue, F]), he = r ? f.find((e) => (!r.config_id || e.config_id === r.config_id) && r.orchestrator_compaction_threshold !== void 0 && r.light_model !== void 0 && e.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && jd(e.light_model ?? null, r.light_model) && e.backend === r.backend && e.model === r.model && e.base_url === r.base_url && e.allow_insecure_http === (r.allow_insecure_http ?? !1) && e.api_key_env === r.api_key_env && (e.reasoning_effort ?? null) === r.reasoning_effort && df(e.extra_headers, r.extra_headers)) : null, ge = f.at(-1), _e = p ?? (r ? he ? {
		kind: "saved",
		configId: he.config_id
	} : { kind: "new" } : ge ? {
		kind: "saved",
		configId: ge.config_id
	} : { kind: "catalog" }), ve = G(() => _e.kind === "catalog" && !pe ? o.configured ? me : rd(l.data) : null, [
		_e.kind,
		l.data,
		o.configured,
		me,
		pe
	]), ye = h ?? ve, be = _e.kind === "catalog" && ye ? ye.backend : v === cf ? b : v, xe = Ar(be), Se = v !== cf && xe, Ce = G(() => {
		let e = _e.kind === "catalog" ? ye?.backend ?? "catalog" : v === cf ? "custom" : v, t = new Set(f.map((e) => e.name));
		for (let n = 1;; n += 1) {
			let r = `${e}-config-${n}`;
			if (!t.has(r)) return r;
		}
	}, [
		_e.kind,
		ye,
		v,
		f
	]), we = S ?? Ce, Te = af(w.trim(), 600), Ee = af(te.trim(), uf), De = _e.kind === "saved" ? _e.configId : null, Oe = _e.kind === "file" ? Ee : "", ke = Le(), { signedIn: Ae } = Ed(be), je = l.data?.providers.find((e) => e.id === be) ?? null, Me = _e.kind === "catalog" && o.matches(ye), Ne = Me ? o.credentialReady : xe ? je?.auth_status === "ready" : Ae, Pe = _e.kind === "catalog" && !!ye && xe && !Me && !Ne, Fe = _e.kind === "new" && Se || Pe, Ie = hn(be, Te, null, Fe), Re = Mt(be, _e.kind === "new" && v !== cf && !xe && Ae), ze = Pt(De, Oe), Be = Fe && Te ? Ie.isFetching ? { status: "validating" } : Ie.error ? {
		status: "error",
		message: Ku(Ie.error, be)
	} : Ie.data ? {
		status: "ready",
		models: Ie.data.models,
		baseUrl: Ie.data.base_url
	} : { status: "validating" } : { status: "idle" }, Ve = Be.status === "ready", R = Ie.data?.base_url ?? "", He = !!(De ?? Oe), Ue = He && ze.isFetching, We = He && !ze.error ? ze.data ?? null : null, Ge = He && ze.error ? Ku(ze.error, be) : "", Ke = ie ?? We?.backend ?? null, qe = oe ?? We?.base_url ?? "", Je = _e.kind === "new" ? (xe ? Ie.data?.models : Re.data?.models) ?? [] : We?.models ?? [], Ye = _e.kind === "new" ? "" : We?.model ?? "", Xe = _e.kind === "new" ? Je.some((e) => e.id === ee) ? ee : Je[0]?.id ?? ce ?? ee : ee || ce || Ye || Je[0]?.id || "", Qe = (e) => {
		m(e), T(""), M(""), ae(null), se(null), le(null), e?.kind !== "file" && ne(""), e?.kind !== "catalog" && g(null), e?.kind !== "new" && e?.kind !== "catalog" && C(null);
	}, $e = De ? f.find((e) => e.config_id === De) ?? null : null, et = !(!r || p !== null || _e.kind !== "new" || be !== r.backend || O.trim() !== r.base_url || A !== (r.allow_insecure_http ?? !1) || w.trim()), tt = G(() => {
		if (pe) return null;
		if (r && et) {
			let e = v === cf ? E.trim() : Xe;
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
		if (_e.kind === "catalog") {
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
			return !e || !Ve ? null : {
				kind: "save",
				request: {
					name: e,
					backend: ye.backend,
					model: ye.model,
					base_url: R || ye.baseUrl,
					allow_insecure_http: !1,
					api_key: w.trim()
				}
			};
		}
		if (_e.kind === "new") {
			let e = we.trim();
			if (!e) return null;
			let t = w.trim();
			if (xe && !t) return null;
			if (v === cf) {
				let n = O.trim(), r = E.trim();
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
			return xe ? !Ve || !Xe || !R ? null : {
				kind: "save",
				request: {
					name: e,
					backend: be,
					model: Xe,
					base_url: R,
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
			extra_headers: $e?.extra_headers ?? null,
			orchestrator_compaction_threshold: r && p === null ? r.orchestrator_compaction_threshold : $e ? $e.orchestrator_compaction_threshold ?? null : void 0,
			light_model: r && p === null ? r.light_model : $e ? $e.light_model ?? null : void 0,
			config_id: r && p === null ? r.config_id ?? $e?.config_id ?? null : $e?.config_id ?? null
		};
	}, [
		_e.kind,
		pe,
		r,
		et,
		ye,
		Ne,
		Me,
		je,
		we,
		w,
		xe,
		v,
		be,
		O,
		A,
		E,
		Ae,
		Ve,
		R,
		Xe,
		We,
		Ke,
		qe,
		$e,
		p
	]);
	W(() => {
		n(tt);
	}, [tt, n]);
	let nt = async (e, t) => {
		try {
			await d.mutateAsync(e), De === e && Qe(null), a.success(`Configuration ${t} removed`);
		} catch (e) {
			a.error(`Failed to remove the configuration: ${Ku($(e))}`);
		}
	}, rt = et ? !0 : _e.kind === "catalog" ? !!ye && (Ne || Ve) : _e.kind === "new" ? v === cf ? !!(O.trim() && E.trim()) : xe ? Ve : Ae : !!We, it = Be.status === "error", at = Re.isError ? Ku(Re.error, be) : We?.models_error ?? "", ot = e || it || !!Ge || !!at, st = Re.isError || !!(We && !Ar(We.backend) && We.models_error), ct = t ?? (it ? Be.message : Ge || (st ? "" : at)), lt = Ge || We?.models_error && Ar(We.backend) ? ze.refetch : null, ut = _e.kind === "catalog" ? ye && !xe ? be : null : _e.kind === "new" ? v !== cf && !xe ? be : null : Ke && !Ar(Ke) ? Ke : null, dt = _e.kind === "catalog" ? "Browse Models" : _e.kind === "new" ? "Create New" : _e.kind === "file" ? "From a .toml file" : $e?.name ?? "Configuration";
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-1",
		children: [
			/* @__PURE__ */ X("div", {
				className: P("flex flex-col rounded-[8px] bg-elevation-level-2 border border-muted overflow-visible", ot && "border border-error-primary"),
				children: [
					/* @__PURE__ */ X("div", {
						className: "flex items-center gap-4 px-3 py-2 bg-elevation-level-3 rounded-t-[8px] border-b border-muted",
						children: [/* @__PURE__ */ Y("div", {
							className: P("flex-1 min-w-0 truncate", ke ? "label-medium" : "label-small", ot ? "text-error-primary" : "text-basic-primary"),
							children: "Configurations"
						}), /* @__PURE__ */ Y(rf, {
							label: dt,
							configurations: f.map((e) => ({
								id: e.config_id,
								name: e.name
							})),
							activeId: De,
							source: _e.kind,
							onSelect: Qe,
							onDelete: (e, t) => void nt(e, t)
						})]
					}),
					/* @__PURE__ */ Y($l, {}),
					/* @__PURE__ */ X("div", {
						className: "flex flex-col gap-4 md:gap-2 p-3",
						children: [
							_e.kind === "catalog" ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($u, {
								label: "Model",
								required: !0,
								verticalOnMobile: !0,
								hint: "Every model this build knows about; picking one names its provider.",
								control: /* @__PURE__ */ Y(vd, {
									catalog: l.data,
									loading: l.isLoading,
									failed: l.isError,
									disabled: pe,
									liveByBackend: u,
									value: ye,
									onSelect: (e) => {
										m({ kind: "catalog" }), g(e), T(""), C(null);
									}
								})
							}), ye ? /* @__PURE__ */ X(J, { children: [
								/* @__PURE__ */ Y($l, {}),
								/* @__PURE__ */ Y($u, {
									label: "Base URL",
									hint: "Endpoint the catalog names for this provider.",
									verticalOnMobile: !0,
									control: /* @__PURE__ */ Y(Q, {
										inputSize: ke ? Z.Large : Z.Medium,
										className: Zu,
										value: ye.baseUrl,
										isDisabled: !0,
										readOnly: !0
									})
								}),
								xe ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($l, {}), Me ? /* @__PURE__ */ Y(sf, { ready: Ne }) : Ne ? /* @__PURE__ */ Y($u, {
									label: "Credential",
									verticalOnMobile: !0,
									hint: "This provider's conventional environment variable is set on the server; the session reuses it.",
									control: /* @__PURE__ */ X("div", {
										className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
										children: [/* @__PURE__ */ Y(B, {
											iconName: V.CheckCircle,
											className: "text-success-primary"
										}), /* @__PURE__ */ Y("span", {
											className: "label-small text-success-primary",
											children: "Detected"
										})]
									})
								}) : /* @__PURE__ */ X(J, { children: [
									/* @__PURE__ */ Y($u, {
										label: "Name",
										required: !0,
										verticalOnMobile: !0,
										hint: "How this setup is listed the next time a session is created.",
										control: /* @__PURE__ */ Y(Q, {
											inputSize: ke ? Z.Large : Z.Medium,
											className: Zu,
											value: we,
											onChange: (e) => C(e.target.value)
										})
									}),
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "API Key",
										required: !0,
										verticalOnMobile: !0,
										invalid: it,
										hint: je?.auth_hint ? `Stored in NAC once the setup is saved, or set ${je.auth_hint} on the server instead.` : "Stored in NAC under a generated name once the setup is saved.",
										control: /* @__PURE__ */ Y(Q, {
											inputSize: ke ? Z.Large : Z.Medium,
											className: Zu,
											type: "password",
											autoComplete: "off",
											placeholder: "Paste the provider key",
											leadingSlot: /* @__PURE__ */ Y(yd, { status: Be.status }),
											validation: it,
											value: w,
											onChange: (e) => T(e.target.value)
										})
									})
								] })] }) : null
							] }) : null] }) : null,
							_e.kind === "file" ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($u, {
								label: "Config File",
								required: !0,
								hint: "A config.toml on this machine; its [model] section is read.",
								invalid: !!Ge,
								verticalOnMobile: !0,
								control: /* @__PURE__ */ Y(Q, {
									inputSize: ke ? Z.Large : Z.Medium,
									className: Zu,
									placeholder: "Select Config File",
									trailing: Hc.Button,
									trailingIconName: V.Folder,
									trailingOnClick: () => re(!0),
									value: te,
									onChange: (e) => ne(e.target.value)
								})
							}), te.trim() ? /* @__PURE__ */ Y($l, {}) : null] }) : null,
							_e.kind === "new" ? /* @__PURE__ */ X(J, { children: [
								/* @__PURE__ */ Y($u, {
									label: "Model Provider",
									required: !0,
									hint: "Service that provides the models for this session.",
									control: /* @__PURE__ */ Y($d, {
										items: lf,
										value: v,
										onValueChange: (e) => {
											y(e), T(""), M("");
										}
									})
								}),
								/* @__PURE__ */ Y($l, {}),
								v === cf ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($u, {
									label: "Protocol",
									required: !0,
									hint: "Wire format the endpoint speaks; a URL alone cannot say.",
									control: /* @__PURE__ */ Y($d, {
										items: Wd,
										value: b,
										onValueChange: (e) => x(e)
									})
								}), /* @__PURE__ */ Y($l, {})] }) : null,
								/* @__PURE__ */ Y($u, {
									label: "Name",
									required: !0,
									hint: "How this setup is listed the next time a session is created.",
									control: /* @__PURE__ */ Y(Q, {
										inputSize: Z.Medium,
										className: Zu,
										value: we,
										onChange: (e) => C(e.target.value)
									})
								}),
								xe ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($l, {}), /* @__PURE__ */ Y($u, {
									label: "API Key",
									required: !0,
									invalid: it,
									hint: "Stored in NAC under a generated name once the setup is saved.",
									control: /* @__PURE__ */ Y(Q, {
										inputSize: Z.Medium,
										className: Zu,
										type: "password",
										autoComplete: "off",
										placeholder: "Paste the provider key",
										leadingSlot: /* @__PURE__ */ Y(yd, { status: Be.status }),
										validation: it,
										value: w,
										onChange: (e) => T(e.target.value)
									})
								})] }) : null,
								v === cf ? /* @__PURE__ */ X(J, { children: [
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "Model",
										required: !0,
										hint: "Model identifier the endpoint expects.",
										control: /* @__PURE__ */ Y(Q, {
											inputSize: Z.Medium,
											className: Zu,
											placeholder: "gpt-5.5",
											value: E,
											onChange: (e) => D(e.target.value)
										})
									}),
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "Base URL",
										required: !0,
										hint: "Endpoint the session sends its requests to.",
										control: /* @__PURE__ */ Y(Q, {
											inputSize: Z.Medium,
											className: Zu,
											placeholder: "https://api.openai.com/v1",
											value: O,
											onChange: (e) => k(e.target.value)
										})
									}),
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "Allow insecure HTTP",
										control: /* @__PURE__ */ X("div", {
											className: `${Zu} flex flex-col items-start gap-1`,
											children: [/* @__PURE__ */ Y(iu, {
												"aria-label": "Allow insecure HTTP",
												checked: A,
												onChange: j
											}), /* @__PURE__ */ Y("p", {
												className: "body-small text-basic-secondary",
												children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
											})]
										})
									})
								] }) : xe ? Be.status === "ready" ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($l, {}), /* @__PURE__ */ Y($u, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									control: /* @__PURE__ */ Y($d, {
										items: tf(Be.models),
										value: Xe,
										onValueChange: M,
										placeholder: "No models offered"
									})
								})] }) : null : Ae ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($l, {}), /* @__PURE__ */ Y($u, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									invalid: !!at,
									control: /* @__PURE__ */ Y($d, {
										items: at ? [] : tf(Je),
										value: at ? "" : Xe,
										onValueChange: M,
										disabled: !!at,
										placeholder: Re.isFetching ? "Reading the model list…" : at ? "–" : "No models offered"
									})
								})] }) : null
							] }) : null,
							_e.kind === "saved" || _e.kind === "file" ? /* @__PURE__ */ Y(nf, {
								resolving: Ue,
								resolved: We,
								backend: Ke,
								onBackend: ae,
								baseUrl: qe,
								onBaseUrl: se,
								model: Xe,
								onModel: (e) => We?.models.length ? M(e) : le(e),
								failed: !!Ge
							}) : null,
							i && rt ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($l, {}), i] }) : null
						]
					})
				]
			}),
			ut ? /* @__PURE__ */ Y(Od, {
				backend: ut,
				className: "mt-1"
			}) : null,
			ct ? /* @__PURE__ */ X("div", {
				className: "flex items-start gap-2",
				children: [/* @__PURE__ */ Y("p", {
					className: "label-micro text-error-primary flex-1 min-w-0",
					children: ct
				}), lt ? /* @__PURE__ */ Y(I, {
					variant: H.Ghost,
					size: z.Medium,
					content: L.Text,
					onClick: () => void lt(),
					children: "Try again"
				}) : null]
			}) : null,
			/* @__PURE__ */ Y("p", {
				className: "text-micro text-basic-muted",
				children: "* Required fields"
			}),
			/* @__PURE__ */ Y(Zd, {
				open: N,
				kind: "toml",
				initialPath: te.trim(),
				onClose: () => re(!1),
				onSelect: (e) => {
					ne(e), re(!1);
				}
			})
		]
	});
}
// src/app/components/modals/LightModelSection.tsx
var pf = [{
	id: "",
	label: "Model default"
}, ...Gd];
function mf(e, t) {
	if (!e?.model) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let n = e.backend ?? ld(t, e.model);
	if (!n) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let r = t?.providers?.find((e) => e.id === n), i = e.base_url ?? (r ? ed(r) : "");
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
function hf(e) {
	return e.pick ? {
		model: e.pick.model,
		backend: e.pick.backend,
		base_url: e.pick.baseUrl || null,
		api_key_env: e.apiKeyEnv,
		reasoning_effort: e.effort || null
	} : null;
}
function gf({ initial: e, onChange: t, behavior: n = "orchestrator" }) {
	let r = Gn(), i = Ze(r.data), [a, o] = q(e ? "dual" : "single"), [s, c] = q(() => mf(e, r.data)), l = G(() => {
		if (s.pick) return s;
		let t = mf(e, r.data);
		return t.pick ? t : s;
	}, [
		s,
		e,
		r.data
	]), u = G(() => a === "single" ? {
		mode: a,
		light: null
	} : {
		mode: a,
		light: hf(l)
	}, [a, l]);
	W(() => {
		t(u);
	}, [u, t]);
	let d = Jd(cd(r.data, l.pick?.backend, l.pick?.model).supportedEfforts, l.effort, pf), f = n === "direct" ? {
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
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("div", {
			className: "flex items-center justify-between",
			children: [/* @__PURE__ */ Y(Qu, {
				label: f.label,
				hint: f.hint
			}), /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2",
				children: ["single", "dual"].map((e) => /* @__PURE__ */ Y(I, {
					variant: a === e ? H.Primary : H.Secondary,
					size: z.Medium,
					content: L.Text,
					onClick: () => o(e),
					"aria-pressed": a === e,
					children: e === "single" ? "Single" : "Dual"
				}, e))
			})]
		}), a === "dual" ? /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
			children: [/* @__PURE__ */ Y($u, {
				label: "Light model",
				required: !0,
				verticalOnMobile: !0,
				hint: f.modelHint,
				control: /* @__PURE__ */ Y(vd, {
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
			}), /* @__PURE__ */ Y($u, {
				label: "Light effort",
				secondary: !0,
				hint: "Reasoning effort the light model runs with.",
				control: /* @__PURE__ */ Y(ql, {
					items: d,
					value: l.effort,
					onValueChange: (e) => c({
						...l,
						effort: e
					}),
					disabled: !l.pick,
					size: z.Medium,
					variant: H.Ghost,
					placement: R.BottomLeft,
					panelClassName: "max-h-64 overflow-auto"
				})
			})]
		}) : null]
	});
}
// src/app/components/modals/SshConnectionBox.tsx
var _f = "__new__", vf = ".ssh/config";
function yf(e) {
	let t = e.trim();
	return t ? t.replace(/\/[^/]*$/, "") || "/" : "~/.ssh";
}
function bf(e) {
	let t = e.trim();
	if (!t) return null;
	let n = Number(t);
	return !Number.isInteger(n) || n < 1 || n > 65535 ? "Port must be an integer between 1 and 65535." : null;
}
function xf(e) {
	return e.trim() || null;
}
function Sf(e, t, n) {
	let r = xf(e);
	if (!r) return { error: "An SSH host is required." };
	let i = bf(t);
	return i ? { error: i } : {
		ssh_host: r,
		ssh_port: xf(t) ? Number(t.trim()) : null,
		ssh_identity_file: xf(n)
	};
}
function Cf(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function wf(e, t) {
	return e.ssh_host === t.ssh_host && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function Tf({ mode: e, connection: t, onConnectionChange: r, seedTarget: i = null, name: a, onNameChange: o, host: s, onHostChange: c, port: l, onPortChange: u, identityFile: d, onIdentityFileChange: p, onTest: m, testing: h = !1, locked: g = !1, className: _ }) {
	let { markSshDisconnected: v, markSshConnected: y } = n().stores.sshConnectionStore, b = Cn(), { data: x } = Gr(), S = G(() => x?.configurations ?? [], [x]), C = tr(), w = $e(), T = e === "manage", E = G(() => T || !i?.ssh_host.trim() ? null : S.find((e) => wf(i, e))?.config_id ?? null, [
		T,
		i,
		S
	]), [D, O] = q(null), k = D ?? E ?? _f, [A, j] = q(!1), [ee, M] = q(() => Cf(S)), [te, ne] = q(i?.ssh_host ?? ""), [N, re] = q(i?.ssh_port ? String(i.ssh_port) : ""), [ie, ae] = q(i?.ssh_identity_file ?? ""), [oe, se] = q(null), [ce, le] = q(!1), ue = Le(), F = !!t, de = w.isPending || C.isPending || h, fe = g || F || de, pe = k === _f ? null : S.find((e) => e.config_id === k) ?? null, me = T ? a ?? "" : ee, he = T ? s ?? "" : F ? t?.ssh_host ?? "" : te, ge = T ? l ?? "" : F ? t?.ssh_port ? String(t.ssh_port) : "" : N, _e = T ? d ?? "" : F ? t?.ssh_identity_file ?? "" : ie, ve = (e) => {
		T ? o?.(e) : M(e);
	}, ye = (e) => {
		T ? c?.(e) : ne(e);
	}, be = (e) => {
		T ? u?.(e) : re(e);
	}, xe = (e) => {
		T ? p?.(e) : ae(e);
	}, Se = k === _f ? "Create New" : pe?.name ?? "SSH config", Ce = (e) => {
		if (O(e), j(!1), se(null), e === _f) {
			M(Cf(S)), ne(i?.ssh_host ?? ""), re(i?.ssh_port ? String(i.ssh_port) : ""), ae(i?.ssh_identity_file ?? "");
			return;
		}
		let t = S.find((t) => t.config_id === e);
		t && (M(t.name), ne(t.ssh_host), re(t.ssh_port ? String(t.ssh_port) : ""), ae(t.ssh_identity_file ?? ""));
	}, L = async () => {
		se(null);
		let e = Sf(he, ge, _e);
		if ("error" in e) se(e.error);
		else if (k === _f && !xf(me)) se("An SSH config name is required.");
		else try {
			let t = await w.mutateAsync(e);
			if (y(e), k === _f) {
				let t = await C.mutateAsync({
					name: me.trim(),
					ssh_host: e.ssh_host,
					ssh_port: e.ssh_port ?? null,
					ssh_identity_file: e.ssh_identity_file ?? null
				});
				O(t.config_id);
			}
			r(e, t.path);
		} catch (t) {
			v(e);
			let n = mr($(t));
			se(n), b.error(`SSH connect failed: ${n}`);
		}
	}, we = () => {
		t && v(t), r(null), se(null);
	}, Te = async () => {
		if (m) {
			se(null);
			try {
				await m();
			} catch (e) {
				let t = mr($(e));
				se(t);
			}
		}
	}, Ee = T || !F && k === _f, De = !T;
	return /* @__PURE__ */ X("div", {
		className: P("relative flex flex-col rounded-[8px] overflow-hidden shadow-convex", F ? "bg-info-primary" : "bg-elevation-sublevel-variant-A", _),
		children: [
			De ? /* @__PURE__ */ X("div", {
				className: "flex items-center gap-4 h-12 pl-3 pr-1.5 py-1 border-b border-muted bg-elevation-sublevel-variant-A",
				children: [
					/* @__PURE__ */ Y("p", {
						className: "label-small text-basic-primary flex-1 min-w-0",
						children: "SSH config"
					}),
					F ? /* @__PURE__ */ Y(Li, {
						text: "Connected",
						color: Fi.Blue,
						className: "!py-0.5 !px-1"
					}) : null,
					/* @__PURE__ */ Y(Zr, {
						open: A && !fe,
						onClose: () => j(!1),
						placement: R.BottomLeft,
						size: "w-auto",
						className: "shrink-0",
						panelClassName: "max-h-72 overflow-hidden",
						sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
						content: /* @__PURE__ */ X("div", {
							className: P("flex flex-col min-h-0", ue ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
							children: [/* @__PURE__ */ Y("div", {
								className: "flex flex-col shrink-0 [&>*]:shrink-0",
								children: /* @__PURE__ */ X(Gl, {
									size: ue ? Hl.Large : Hl.Medium,
									variant: k === _f ? Ul.Accent : Ul.Regular,
									active: k === _f,
									onClick: () => Ce(_f),
									children: [/* @__PURE__ */ Y(B, { iconName: V.Add }), /* @__PURE__ */ Y("span", {
										className: "text-left flex-grow",
										children: "Create New"
									})]
								})
							}), S.length > 0 ? /* @__PURE__ */ X("div", {
								className: "flex flex-col flex-1 min-h-0 min-w-0",
								children: [/* @__PURE__ */ Y("div", { className: "h-px w-full bg-divider-muted my-1 shrink-0" }), /* @__PURE__ */ Y("div", {
									className: "flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
									children: S.map((e) => /* @__PURE__ */ X(Gl, {
										size: ue ? Hl.Large : Hl.Medium,
										variant: k === e.config_id ? Ul.Accent : Ul.Regular,
										active: k === e.config_id,
										onClick: () => Ce(e.config_id),
										children: [/* @__PURE__ */ Y(B, { iconName: V.Globe }), /* @__PURE__ */ Y("span", {
											className: "text-left flex-grow truncate",
											children: e.name
										})]
									}, e.config_id))
								})]
							}) : null]
						}),
						children: /* @__PURE__ */ X(I, {
							size: z.Medium,
							variant: H.Secondary,
							disabled: fe,
							onClick: () => j((e) => !e),
							"aria-expanded": A,
							children: [/* @__PURE__ */ Y("span", {
								className: "truncate max-w-[140px]",
								children: Se
							}), /* @__PURE__ */ Y(B, {
								iconName: V.Down,
								className: P("shrink-0 transition-transform duration-150 ease-out", A ? "rotate-180" : "rotate-0")
							})]
						})
					})
				]
			}) : null,
			/* @__PURE__ */ X("div", {
				className: "flex flex-col gap-4 p-3",
				children: [
					Ee ? /* @__PURE__ */ X("div", {
						className: "flex flex-col gap-1 w-full",
						children: [/* @__PURE__ */ Y(Qu, {
							label: "SSH config name",
							required: !0
						}), /* @__PURE__ */ Y(Q, {
							inputSize: ue ? Z.Large : Z.Medium,
							value: me,
							isDisabled: fe,
							onChange: (e) => ve(e.target.value),
							placeholder: "SSH-config-1"
						})]
					}) : null,
					/* @__PURE__ */ X("div", {
						className: "flex flex-col md:flex-row gap-4 items-start w-full",
						children: [/* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1 w-full md:flex-1 min-w-0",
							children: [/* @__PURE__ */ Y(Qu, {
								label: "SSH Host",
								required: !0,
								hint: "user@host, a host alias from ~/.ssh/config, or an IP."
							}), /* @__PURE__ */ Y(Q, {
								inputSize: ue ? Z.Large : Z.Medium,
								value: he,
								isDisabled: fe,
								onChange: (e) => ye(e.target.value),
								placeholder: "example@192.0.2.10 or build-box"
							})]
						}), /* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1 w-full md:w-[98px] shrink-0",
							children: [/* @__PURE__ */ Y(Qu, {
								label: "Port",
								hint: "Blank uses OpenSSH's default (usually 22)."
							}), /* @__PURE__ */ Y(Q, {
								inputSize: ue ? Z.Large : Z.Medium,
								value: ge,
								isDisabled: fe,
								onChange: (e) => be(e.target.value),
								placeholder: "22"
							})]
						})]
					}),
					/* @__PURE__ */ X("div", {
						className: "flex gap-4 items-end w-full",
						children: [/* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1 flex-1 min-w-0",
							children: [/* @__PURE__ */ Y(Qu, {
								label: "Private Key",
								hint: "A key file on this machine. The default leaves the choice to your ~/.ssh/config and ssh agent."
							}), /* @__PURE__ */ X(I, {
								size: z.Medium,
								variant: H.Secondary,
								className: "w-full",
								disabled: fe,
								onClick: () => le(!0),
								children: [/* @__PURE__ */ Y("span", {
									className: "flex-1 min-w-0 truncate text-left",
									children: _e.trim() || vf
								}), /* @__PURE__ */ Y(B, {
									iconName: V.FolderOpen,
									size: 20
								})]
							})]
						}), /* @__PURE__ */ Y("div", {
							className: "md:w-[128px] shrink-0 relative",
							children: T ? /* @__PURE__ */ X(I, {
								size: z.Medium,
								variant: H.Secondary,
								className: "w-full",
								disabled: de,
								onClick: () => void Te(),
								children: [h ? /* @__PURE__ */ Y(f, { size: mt.Small }) : /* @__PURE__ */ Y(B, {
									iconName: V.Bolt,
									size: 20
								}), "Test"]
							}) : F ? /* @__PURE__ */ Y(I, {
								size: z.Medium,
								variant: H.Ghost,
								className: "w-full",
								onClick: we,
								children: "Disconnect"
							}) : /* @__PURE__ */ X(I, {
								size: z.Medium,
								variant: H.Primary,
								className: "w-full",
								disabled: de,
								onClick: () => void L(),
								children: [de ? /* @__PURE__ */ Y(f, { size: mt.Small }) : null, "Connect"]
							})
						})]
					}),
					oe ? /* @__PURE__ */ Y("p", {
						className: "text-micro text-error-primary",
						children: oe
					}) : null
				]
			}),
			/* @__PURE__ */ Y(Zd, {
				open: ce,
				kind: "file",
				title: "Select Private Key",
				showHidden: !0,
				initialPath: yf(_e),
				clearLabel: `Use ${vf}`,
				onClear: () => {
					xe(""), le(!1);
				},
				onClose: () => le(!1),
				onSelect: (e) => {
					xe(e), le(!1);
				}
			})
		]
	});
}
// src/app/components/modals/SessionBehaviorPicker.tsx
function Ef({ value: e, onChange: t, disabled: n = !1 }) {
	return /* @__PURE__ */ X("fieldset", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ Y("legend", {
				className: "label-small text-basic-primary",
				children: "How should this chat work?"
			}),
			/* @__PURE__ */ Y("div", {
				className: "grid grid-cols-1 gap-2 md:grid-cols-3",
				role: "radiogroup",
				children: oa.map((r, i) => {
					let a = r.id === e;
					return /* @__PURE__ */ X("button", {
						type: "button",
						role: "radio",
						"aria-checked": a,
						tabIndex: a ? 0 : -1,
						disabled: n,
						className: P("flex min-h-[196px] cursor-pointer flex-col gap-2 rounded-[6px] border p-3 text-left transition-colors", a ? "border-accent-primary bg-accent-secondary" : "border-border-primary bg-elevation-level-1 hover:bg-elevation-level-2", n && "cursor-not-allowed opacity-60"),
						onClick: () => t(r.id),
						onKeyDown: (e) => {
							let n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0, r = e.key === "Home" ? 0 : e.key === "End" ? oa.length - 1 : n ? (i + n + oa.length) % oa.length : null;
							r != null && (e.preventDefault(), t(oa[r].id), (e.currentTarget.parentElement?.querySelectorAll("[role=\"radio\"]"))?.[r]?.focus());
						},
						children: [
							/* @__PURE__ */ X("span", {
								className: "flex items-center justify-between gap-2",
								children: [/* @__PURE__ */ Y("span", {
									className: "text-small font-medium text-basic-primary",
									children: r.label
								}), r.id === "orchestrator" ? /* @__PURE__ */ Y("span", {
									className: "tag-label shrink-0 text-basic-tertiary",
									children: "Default"
								}) : null]
							}),
							/* @__PURE__ */ Y("span", {
								className: "text-xs text-basic-secondary",
								children: r.topLevel
							}),
							/* @__PURE__ */ Y("span", {
								className: "text-xs text-basic-secondary",
								children: r.editing
							}),
							/* @__PURE__ */ Y("span", {
								className: "text-xs text-basic-secondary",
								children: r.delegation
							}),
							/* @__PURE__ */ Y("span", {
								className: "mt-auto text-xs text-basic-muted",
								children: r.inspection
							})
						]
					}, r.id);
				})
			}),
			/* @__PURE__ */ Y("p", {
				className: "text-micro text-basic-muted",
				children: "Behavior is fixed for the lifetime of this chat. Start a new chat to choose a different behavior."
			})
		]
	});
}
// src/app/features/setup/modelSelection.ts
function Df(e) {
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
function Of(e, t) {
	if (e === t) return !0;
	if (e == null || t == null) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Object.hasOwn(t, n) && e[n] === t[n]);
}
function kf(e, t) {
	return e === void 0 || t === void 0 ? e === t : jd(e ?? null, t ?? null);
}
function Af(e, t) {
	if (e === t) return !0;
	if (!e || !t) return !1;
	if (e.kind === "resolved" && t.kind === "resolved") return e.backend === t.backend && e.model === t.model && e.base_url === t.base_url && e.allow_insecure_http === t.allow_insecure_http && e.api_key_env === t.api_key_env && e.reasoning_effort === t.reasoning_effort && Of(e.extra_headers, t.extra_headers) && e.orchestrator_compaction_threshold === t.orchestrator_compaction_threshold && kf(e.light_model, t.light_model);
	if (e.kind !== "save" || t.kind !== "save") return !1;
	let n = e.request, r = t.request;
	return n.name === r.name && n.backend === r.backend && n.model === r.model && n.base_url === r.base_url && n.allow_insecure_http === r.allow_insecure_http && n.api_key === r.api_key && n.reasoning_effort === r.reasoning_effort && n.initial_prompt === r.initial_prompt && Of(n.extra_headers, r.extra_headers) && n.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && kf(n.light_model, r.light_model);
}
// src/app/components/modals/PrimaryModelSection.tsx
var jf = [{
	id: "",
	label: "Model default"
}, ...Gd];
function Mf({ initial: e, inheritSavedDefault: t = !1, existingSession: n = !1, onChange: r }) {
	let i = Gn(), a = of(), o = Ze(i.data), [s, c] = q(null), l = bn(t && !e), u = t && !e ? l.data?.configurations.at(-1) : void 0, d = G(() => e ?? (u ? {
		...Df(u),
		extra_headers: u.extra_headers
	} : void 0), [e, u]), f = Pt(u && !s ? u.config_id : null, ""), p = t && !e && !s && (l.isPending || u && !f.data), m = G(() => d ? {
		pick: {
			backend: d.backend,
			model: d.model,
			baseUrl: d.base_url
		},
		effort: d.reasoning_effort ?? ""
	} : null, [d]), h = a.defaultPick ? o.get(a.defaultPick.backend) : void 0, g = a.configured && a.credentialReady && (i.isPending || h === null), _ = h === void 0 || a.defaultPick && h?.some((e) => e.id === a.defaultPick?.model) ? a.defaultPick : null, v = G(() => rd(i.data), [i.data]), y = G(() => s ?? m ?? (a.configured ? _ ? {
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
	]), b = i.data?.providers.find((e) => e.id === y?.pick.backend), x = !!(d && y && y.pick.backend === d.backend), S = !!(b?.auth_status === "ready" || y && a.matches(y.pick) && a.credentialReady), C = y ? a.matches(y.pick) : !1, w = C && y ? o.get(y.pick.backend) : void 0, T = G(() => {
		if (p || !y || !y.pick.baseUrl) return null;
		let e = !!(n && d && x && y.pick.model === d.model);
		if (!e && (a.initializing || g)) return null;
		if (!e && C) {
			let e = w;
			if (!a.credentialReady || e === null || e && !e.some((e) => e.id === y.pick.model)) return null;
		}
		return !e && !Ar(y.pick.backend) && !S ? null : x && d ? {
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
	W(() => r(T), [r, T]);
	let E = Jd(cd(i.data, y?.pick.backend, y?.pick.model).supportedEfforts, y?.effort ?? "", jf);
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
		children: [
			/* @__PURE__ */ Y(Qu, {
				label: "Primary model",
				hint: "Search one catalog across every connected provider. Provider accounts and advanced presets are managed separately below."
			}),
			/* @__PURE__ */ Y($u, {
				label: "Model",
				required: !0,
				verticalOnMobile: !0,
				control: /* @__PURE__ */ Y(vd, {
					catalog: i.data,
					loading: i.isLoading,
					failed: i.isError,
					liveByBackend: o,
					value: y?.pick ?? null,
					onSelect: (e) => {
						let t = cd(i.data, e.backend, e.model).supportedEfforts, n = y?.effort ?? "";
						c({
							pick: e,
							effort: n && !t.includes(n) ? "" : n
						});
					}
				})
			}),
			/* @__PURE__ */ Y($u, {
				label: "Reasoning",
				hint: "Stored with this chat and switchable independently of provider setup.",
				control: /* @__PURE__ */ Y($d, {
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
			u && f.isError ? /* @__PURE__ */ Y("p", {
				role: "alert",
				className: "text-micro text-error-primary",
				children: "The saved project setup could not be resolved. Review it in Advanced or choose another model."
			}) : null,
			y && !x && !S ? /* @__PURE__ */ X("p", {
				className: "text-micro text-error-primary",
				role: "alert",
				children: [
					"Connect ",
					Jt(y.pick.backend),
					" in Provider connections or Advanced before selecting this model."
				]
			}) : null
		]
	});
}
// src/app/features/managed/presentation/ProviderConnections.tsx
function Nf() {
	return /* @__PURE__ */ X("section", {
		"aria-label": "Provider connections",
		className: "flex flex-col gap-3",
		children: [
			/* @__PURE__ */ Y("p", {
				className: "text-micro text-basic-muted",
				children: "Connect another account without changing this chat or signing out of your current provider. API keys and custom endpoints are available in Advanced provider setup."
			}),
			/* @__PURE__ */ Y(Od, { backend: "arcee-auth" }),
			/* @__PURE__ */ Y(Od, { backend: "chatgpt-codex-responses" })
		]
	});
}
// src/app/features/setup/ModelSetupSection.tsx
function Pf({ initial: e, onChange: t, invalid: n, errorText: r, children: i, simple: a = !0, inheritSavedDefault: o = !1, existingSession: s = !1 }) {
	let [c, l] = q(!a), [u, d] = q(!1), [f, p] = q(!1), m = K(null), [h, g] = q(e), _ = U((e) => {
		m.current = e, p(e?.kind === "save"), t(e, "preset");
	}, [t]), v = U((e) => {
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
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-3",
		children: [
			c ? /* @__PURE__ */ Y(ff, {
				initial: h,
				invalid: n,
				onChange: _,
				children: i
			}) : /* @__PURE__ */ Y(Mf, {
				inheritSavedDefault: o,
				existingSession: s,
				initial: h,
				onChange: v
			}),
			/* @__PURE__ */ Y(I, {
				variant: H.Secondary,
				"aria-expanded": u,
				onClick: () => d((e) => !e),
				children: "Provider connections"
			}),
			u ? /* @__PURE__ */ Y(Nf, {}) : null,
			/* @__PURE__ */ Y(I, {
				variant: H.Secondary,
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
			!c && i ? /* @__PURE__ */ X("details", {
				className: "text-micro",
				children: [/* @__PURE__ */ Y("summary", {
					className: "cursor-pointer py-2",
					children: "Advanced execution settings"
				}), i]
			}) : null,
			r ? /* @__PURE__ */ Y("p", {
				role: "alert",
				className: "text-micro text-error-primary",
				children: r
			}) : null
		]
	});
}
// src/app/features/setup/workflow.ts
var Ff = class extends Tt("SetupFailure") {};
function If(e) {
	return e instanceof Ff && (e.kind === "unknown" || e.kind === "conflict" || e.completed.length > 0);
}
function Lf(e, t) {
	return vt(() => {
		let n = [];
		return t((t, r, i = !0) => Ve(function* () {
			if (!e.current()) return yield* je(new Ff({
				phase: t,
				kind: "cancelled",
				cause: null,
				completed: [...n]
			}));
			let a = yield* dr({
				try: r,
				catch: (r) => {
					let i = e.classify(r, t);
					return new Ff({
						phase: t,
						kind: t === "read" && i === "unknown" ? "rejected" : i,
						cause: r,
						completed: [...n]
					});
				}
			}).pipe(ve(() => i ? Ce(() => e.reconcile(t)) : Fn));
			return i && (n.push(t), yield* Ce(() => e.reconcile(t))), a;
		}));
	});
}
function Rf(e) {
	return Lf(e, (t) => Ve(function* () {
		let n = yield* t("preset", e.model, e.persistsModel ?? !0), r = yield* t("project", () => e.project(n));
		return {
			model: n,
			project: r,
			chat: yield* t("chat", () => e.chat(n, r))
		};
	}));
}
function zf(e) {
	return Lf(e, (t) => Ve(function* () {
		if (e.existing) {
			let n = yield* t("read", e.existing, !1);
			if (n !== null) return n;
		}
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("chat", () => e.chat(n));
	}));
}
function Bf(e) {
	return Lf(e, (t) => Ve(function* () {
		yield* t("read", e.check, !1);
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("configuration", () => e.configuration(n), e.configurationSaved ?? !0), e.title && (yield* t("title", e.title)), e.projectDefault && (yield* t("default", () => e.projectDefault(n))), n;
	}));
}
async function Vf(e) {
	let t = await d(e);
	if (En(t)) return t.value;
	let n = Dr(t.cause);
	throw Sr(n) ? n.value : Zn(t.cause);
}
// src/app/features/setup/useSetupAction.ts
function Hf(e = !0) {
	let t = xd(e), n = K(!1), r = K(!1), [i, a] = q(!1), [o, s] = q(!1);
	return {
		busy: i,
		needsReview: o,
		run: async (e) => {
			let i = t.current;
			if (!(!i?.current() || n.current || r.current)) {
				n.current = !0, a(!0);
				try {
					let t = await Vf(e(i));
					return i.current() ? t : void 0;
				} catch (e) {
					if (!i.current()) return;
					throw If(e) && (r.current = !0, s(!0)), e;
				} finally {
					n.current = !1, i.current() && a(!1);
				}
			}
		}
	};
}
// src/app/features/setup/browserAdapters.ts
var Uf = class extends Error {}, Wf = class extends Error {
	constructor() {
		super("This chat's settings changed. Reopen settings to review the current values before saving.");
	}
};
function Gf(e, t) {
	return e instanceof Uf ? "rejected" : e instanceof Wf ? "conflict" : e instanceof _e ? t === "project" && e.status === 409 ? "rejected" : e.status === 409 ? "conflict" : e.status >= 500 ? "unknown" : "rejected" : "unknown";
}
function Kf(e) {
	if (!(e instanceof Ff)) return Ku($(e));
	if (e.kind === "cancelled") return "This setup view was closed.";
	let t = e.completed.includes("configuration") ? "Chat settings were saved. " : e.completed.includes("project") ? "The project was saved. " : e.completed.includes("preset") ? "The preset was saved. " : "";
	return e.kind === "unknown" ? `${t}The ${e.phase} save outcome is unknown. Refresh and review the saved values before trying again.` : e.kind === "conflict" ? `${t}The ${e.phase} changed or is busy. Refresh and review before saving again. ${Ku($(e.cause))}` : `${t}${Ku($(e.cause))}${e.completed.length ? " Reopen setup to review the saved values before continuing." : ""}`;
}
function qf(e, t) {
	return async (n) => {
		let r = n === "preset" ? [
			Xt.modelConfigs,
			Xt.modelCatalog,
			Xt.credentials
		] : n === "project" || n === "default" ? [Xt.projects] : t ? [
			Xt.sessionConfig(t),
			Xt.sessionSnapshot(t),
			Xt.sessionsAll
		] : [Xt.sessionsAll];
		await Promise.all(r.map((t) => e.invalidateQueries({ queryKey: t })));
	};
}
// src/app/features/setup/projectLaunch.ts
function Jf(e) {
	let { selected: t, policy: n, light: r, sandbox: i } = e, a = {
		project_id: e.projectId,
		behavior: me(n, e.behavior),
		first_chat: !0,
		first_chat_same_behavior: !n.orchestrationEnabled,
		backend: t.backend,
		model: t.model,
		base_url: t.base_url,
		allow_insecure_http: t.allow_insecure_http,
		api_key_env: t.api_key_env,
		reasoning_effort: e.reasoning === "__clear__" ? null : e.reasoning || t.reasoning_effort || null,
		light_model: n.orchestrationEnabled ? r.mode === "dual" && r.light ? kd(r.light, t.backend, t.api_key_env) : null : e.savedLight ?? null
	}, o = e.headers ?? t.extra_headers ?? void 0;
	return o !== void 0 && (a.extra_headers = o), e.presetCompaction && t.orchestrator_compaction_threshold !== void 0 ? a.orchestrator_compaction_threshold = t.orchestrator_compaction_threshold : Id(e.compaction) !== null && (a.orchestrator_compaction_threshold = Number(e.compaction)), e.execution !== "ssh" && (a.sandbox = {
		enabled: e.execution === "sandbox",
		no_mount_cwd: i.noMount,
		image: Id(i.image),
		gpus: Ld(i.gpu),
		workdir: Id(i.workdir),
		shm_size: Id(i.shm),
		mounts: Ld(i.mounts),
		mounts_ro: [],
		activity_key: e.activityKey
	}), a;
}
// src/app/components/modals/CreateProjectModal.tsx
var Yf = [
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
], Xf = Kd.map((e) => e.id === "" ? {
	...e,
	label: "From configuration"
} : e), Zf = { paddingInline: "8px" }, Qf = {
	noMount: !1,
	image: "",
	gpu: "",
	workdir: "",
	shm: "",
	mounts: ""
};
function $f({ open: e, onClose: t }) {
	let { data: n } = Er();
	return Xd(e) ? /* @__PURE__ */ Y(ep, {
		open: e,
		defaultCwd: n?.root_cwd ?? "",
		onClose: t
	}, e ? "open" : "closing") : null;
}
function ep({ open: e, defaultCwd: t, onClose: i }) {
	let { loadLastLight: a, storeLastLight: o } = n().stores.lastLight, s = Ti(), c = Cn(), l = Hf(e), u = vi(), d = $r(), f = Or(), p = zt(), [m, h] = q("local"), g = fr(), [_, v] = q(g.orchestrationEnabled ? "orchestrator" : "direct"), [y, b] = q(t), [x, S] = q(""), [C, w] = q(""), [T, E] = q(""), [D, O] = q(""), [k, A] = q(Qf), [j, ee] = q(!1), [M, te] = q(!1), [ne, N] = q(!1), [re, ie] = q(null), [ae, oe] = q({
		mode: "single",
		light: null
	}), [se, ce] = q(null), [le, ue] = q(""), [F, de] = q(null), fe = K(""), pe = K(!0), me = K(!1), he = Gn(), ge = re?.kind === "save" ? re.request : re ?? null, _e = Jd(cd(he.data, ge?.backend, ge?.model).supportedEfforts, C, Xf), ve = Le(), ye = m === "ssh", be = an(m === "sandbox").data, xe = ye ? F : null, Se = !ye || xe !== null, Ce = l.busy, [we, Te] = q(null), Ee = f.isPending && m === "sandbox", De = r(Ee, we).data, Oe = De?.since_epoch_ms, [ke, Ae] = q(0);
	W(() => {
		if (!Ee) return;
		let e = setInterval(() => {
			Ae(Oe ? Math.max(0, Math.floor((Date.now() - Oe) / 1e3)) : 0);
		}, 1e3);
		return () => clearInterval(e);
	}, [Ee, Oe]);
	let je = (e) => (t) => {
		ce(null), e(t);
	}, Me = (e) => {
		ce(null), A((t) => ({
			...t,
			...e
		}));
	}, Ne = K(null), Pe = U((e, t) => {
		if (ie(e), !e || Af(Ne.current, e)) return;
		let n = Ne.current;
		if (Ne.current = e, t === "primary" && n?.kind === "resolved") ce((e) => e?.field === "config" ? null : e);
		else {
			if (e?.kind === "resolved" && e.orchestrator_compaction_threshold !== void 0) {
				let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
				me.current = !0, pe.current = !1, fe.current = n, E(n);
			} else {
				let e = me.current;
				me.current = !1, e && (pe.current = !0, fe.current = "", E(""));
			}
			ce((e) => e?.field === "config" ? null : e);
		}
	}, []), Fe = U((e) => {
		oe(e), ce((e) => e?.field === "config" ? null : e);
	}, []), Ie = G(() => a(), [a]), Re = re?.kind === "resolved" && re.light_model !== void 0 ? re.light_model : Ie, ze = JSON.stringify(Re), Be = G(() => {
		let e = cd(he.data, ge?.backend, ge?.model).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		he.data,
		ge?.backend,
		ge?.model
	]);
	W(() => {
		!me.current && Be !== "auto" && (fe.current === "" || pe.current) && (pe.current = !0, fe.current = Be, E(Be));
	}, [Be, re]);
	let Ve = (e) => {
		ce(null), me.current = !1, pe.current = !1, fe.current = e, E(e);
	}, He = (e) => {
		e !== m && (ce(null), h(e), de(null), b(e === "ssh" ? "" : t));
	}, Ue = (e, t) => {
		ce(null), de(e), e ? t && b(t) : b("");
	}, We = async () => {
		if (l.needsReview || Ce) return;
		if (ye && !xe) {
			ce({
				field: "ssh",
				message: "Connect to the SSH host before creating a project."
			});
			return;
		}
		if (!Id(y)) {
			ce({
				field: "cwd",
				message: "A working folder is required."
			});
			return;
		}
		if (!re) {
			ce({
				field: "config",
				message: "Complete the provider configuration before creating a project."
			});
			return;
		}
		if (g.orchestrationEnabled && ae.mode === "dual" && !ae.light) {
			ce({
				field: "config",
				message: "Pick the light model before creating a project."
			});
			return;
		}
		let e;
		try {
			e = Bd(D, void 0);
		} catch (e) {
			ce({
				field: "config",
				message: mr($(e))
			});
			return;
		}
		let t = null;
		try {
			let n = await l.run((n) => Rf({
				current: n.current,
				classify: Gf,
				reconcile: qf(u),
				persistsModel: re.kind === "save",
				model: async () => {
					if (re.kind === "save") {
						let e = ae.mode === "dual" && ae.light ? {
							...re.request,
							light_model: ae.light
						} : re.request, t = Df(await p.mutateAsync(e));
						return n.current() && ie(t), t;
					}
					return re;
				},
				project: async (e) => {
					let n = await d.mutateAsync({
						name: Id(x),
						cwd: y,
						ssh_host: xe?.ssh_host ?? null,
						ssh_port: xe?.ssh_port ?? null,
						ssh_identity_file: xe?.ssh_identity_file ?? null,
						default_model_config_id: e.config_id ?? null
					});
					return t = n.project_id, n;
				},
				chat: async (t, r) => {
					let i = m === "sandbox" ? crypto.randomUUID() : null;
					n.current() && Te(i);
					let a = Jf({
						selected: t,
						projectId: r.project_id,
						policy: g,
						behavior: _,
						reasoning: C,
						headers: e,
						compaction: T,
						presetCompaction: me.current,
						savedLight: Re,
						light: ae,
						execution: xe ? "ssh" : m,
						sandbox: k,
						activityKey: i
					});
					return {
						snapshot: await f.mutateAsync(a),
						launchLight: a.light_model ?? null,
						apiKeyEnv: t.api_key_env
					};
				}
			}));
			if (!n) return;
			let { snapshot: r, launchLight: a, apiKeyEnv: h } = n.chat;
			o(a && Ad(a, h)), c.success("Project created"), s(r.metadata.session_id ? kr.session(r.metadata.session_id) : kr.project(n.project.project_id)), i();
		} catch (e) {
			if (t && e instanceof Ff && e.kind !== "unknown") c.error(`Project created, but the first chat failed: ${Kf(e)}`), s(kr.project(t)), i();
			else {
				let t = Kf(e);
				If(e) && ue(t), ce({
					field: e instanceof Ff && e.phase === "project" && e.kind === "rejected" ? "cwd" : "config",
					message: t
				});
			}
		}
	}, Ge = (e) => se?.field === e;
	return /* @__PURE__ */ X(tn, {
		open: e,
		onClose: i,
		title: "New Project",
		size: dn.Wide,
		flush: !0,
		className: "h-[680px]",
		footer: ve ? /* @__PURE__ */ Y(gn, {
			variant: H.Primary,
			content: L.Text,
			onClick: We,
			loading: Ce,
			disabled: Ce || l.needsReview || !!se || !re || !Se,
			children: "Create Project"
		}) : /* @__PURE__ */ Y(I, {
			variant: H.Primary,
			size: z.Large,
			content: L.Text,
			onClick: We,
			loading: Ce,
			disabled: Ce || l.needsReview || !!se || !re || !Se,
			children: "Create Project"
		}),
		children: [/* @__PURE__ */ X("div", {
			className: "flex flex-col gap-8 md:gap-6 [&>*]:shrink-0",
			children: [
				g.orchestrationEnabled ? /* @__PURE__ */ Y(Ef, {
					value: _,
					onChange: v,
					disabled: Ce
				}) : null,
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-1",
					children: [
						/* @__PURE__ */ Y(Qu, {
							label: "Environment",
							hint: "Where NAC runs commands and accesses files."
						}),
						/* @__PURE__ */ Y("div", {
							className: "flex items-start gap-3",
							children: Yf.map((e) => /* @__PURE__ */ Y(I, {
								variant: m === e.id ? H.Primary : H.Secondary,
								size: z.Medium,
								content: L.Text,
								onClick: () => He(e.id),
								"aria-pressed": m === e.id,
								className: `${ve ? "!rounded-full" : ""}`,
								children: e.label
							}, e.id))
						}),
						/* @__PURE__ */ Y("p", {
							className: "pt-1 text-micro text-basic-muted",
							children: Yf.find((e) => e.id === m)?.description
						}),
						m === "sandbox" && be && be.status !== "ready" ? /* @__PURE__ */ X("div", {
							className: "pt-1",
							children: [/* @__PURE__ */ Y("p", {
								className: "text-error-primary text-micro",
								children: be.status === "missing" ? "Sandbox mode runs sessions in a podman container, and podman is not installed on this machine." : `Sandbox mode needs podman, which is not responding${be.detail ? `: ${be.detail}` : "."}`
							}), be.guidance ? /* @__PURE__ */ Y("pre", {
								className: "pt-1 whitespace-pre-wrap font-mono text-micro text-basic-muted",
								children: be.guidance
							}) : null]
						}) : null
					]
				}),
				ye ? /* @__PURE__ */ Y(Tf, {
					mode: "launch",
					connection: F,
					onConnectionChange: Ue
				}) : null,
				Se ? /* @__PURE__ */ X("div", {
					className: "flex flex-col md:flex-row items-start gap-6 md:gap-4",
					children: [/* @__PURE__ */ X("div", {
						className: "flex flex-col gap-1 flex-1 min-w-0 w-full",
						children: [
							/* @__PURE__ */ Y(Qu, {
								label: "Working Folder",
								hint: ye ? "The project folder NAC works within on the SSH host." : "The project folder NAC works within.",
								required: !0,
								invalid: Ge("cwd")
							}),
							/* @__PURE__ */ X(I, {
								variant: H.Secondary,
								size: ve ? z.Large : z.Medium,
								content: L.IconRight,
								className: P("w-full", Ge("cwd") && "input-validation"),
								style: Zf,
								onClick: () => N(!0),
								children: [/* @__PURE__ */ Y("span", {
									className: P("flex-1 min-w-0 truncate text-left font-normal", y ? "text-basic-primary" : "text-basic-muted"),
									children: y || "/path/to/project"
								}), /* @__PURE__ */ Y(B, {
									iconName: V.Folder,
									className: "shrink-0"
								})]
							}),
							Ge("cwd") ? /* @__PURE__ */ Y("p", {
								className: "pt-1 text-error-primary text-micro",
								children: se?.message
							}) : null
						]
					}), /* @__PURE__ */ X("div", {
						className: "flex flex-col gap-1 flex-1 min-w-0 w-full",
						children: [/* @__PURE__ */ Y(Qu, { label: "Project name" }), /* @__PURE__ */ Y(Q, {
							inputSize: ve ? Z.Large : Z.Medium,
							placeholder: "Taken from the git remote",
							value: x,
							onChange: (e) => je(S)(e.target.value),
							className: `${ve ? "w-full" : ""}`
						})]
					})]
				}) : null,
				Se ? /* @__PURE__ */ Y(Pf, {
					simple: !g.orchestrationEnabled,
					inheritSavedDefault: !0,
					invalid: Ge("config"),
					errorText: le || (Ge("config") ? se?.message : void 0),
					onChange: Pe,
					children: /* @__PURE__ */ X("div", {
						className: "flex flex-col gap-2",
						children: [
							g.orchestrationEnabled ? /* @__PURE__ */ Y(gf, {
								initial: Re,
								behavior: _,
								onChange: Fe
							}, ze) : null,
							/* @__PURE__ */ Y($l, {}),
							/* @__PURE__ */ Y($u, {
								label: "Reasoning Effort",
								hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
								control: ((e, t, n, r = !1) => /* @__PURE__ */ Y(ql, {
									items: e,
									value: t,
									onValueChange: n,
									disabled: r,
									size: z.Medium,
									variant: H.Ghost,
									placement: R.BottomLeft,
									sticky: !0,
									panelClassName: "max-h-64 overflow-auto min-w-[220px]"
								}))(_e, C, je(w))
							}),
							/* @__PURE__ */ Y($l, {}),
							/* @__PURE__ */ Y($u, {
								label: "Context Limit",
								hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
								control: /* @__PURE__ */ X("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ Y(Q, {
										inputSize: ve ? Z.Large : Z.Medium,
										className: "w-full md:w-[120px]",
										inputClassName: "md:text-right",
										placeholder: Be,
										inputMode: "numeric",
										value: T,
										onChange: (e) => Ve(e.target.value)
									}), /* @__PURE__ */ Y("span", {
										className: "shrink-0 text-micro text-basic-muted",
										children: "tokens"
									})]
								})
							}),
							m === "sandbox" ? /* @__PURE__ */ X(J, { children: [
								/* @__PURE__ */ Y($l, {}),
								/* @__PURE__ */ Y($u, {
									label: "Sandbox options",
									hint: "The container the session runs in: image, GPUs, workdir, shared memory and mounts.",
									control: /* @__PURE__ */ Y(iu, {
										checked: M,
										onChange: te,
										"aria-label": "Sandbox options"
									})
								}),
								M ? /* @__PURE__ */ X(J, { children: [
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "Container image",
										hint: "Image the sandbox runs; empty uses the configured default.",
										control: /* @__PURE__ */ Y(Q, {
											inputSize: Z.Medium,
											className: "w-[181px]",
											placeholder: "python:3.13-bookworm",
											value: k.image,
											onChange: (e) => Me({ image: e.target.value })
										})
									}),
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "GPUs",
										hint: "Comma-separated GPU list, e.g. all.",
										control: /* @__PURE__ */ Y(Q, {
											inputSize: Z.Medium,
											className: "w-[181px]",
											placeholder: "all",
											value: k.gpu,
											onChange: (e) => Me({ gpu: e.target.value })
										})
									}),
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "Container workdir",
										hint: "Working directory inside the container.",
										control: /* @__PURE__ */ Y(Q, {
											inputSize: Z.Medium,
											className: "w-[181px]",
											placeholder: "/workspace",
											value: k.workdir,
											onChange: (e) => Me({ workdir: e.target.value })
										})
									}),
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "Shared memory size",
										hint: "Container /dev/shm size, e.g. 1g.",
										control: /* @__PURE__ */ Y(Q, {
											inputSize: Z.Medium,
											className: "w-[181px]",
											placeholder: "0",
											value: k.shm,
											onChange: (e) => Me({ shm: e.target.value })
										})
									}),
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "Mounts (HOST:GUEST)",
										hint: "Comma-separated bind mounts.",
										control: /* @__PURE__ */ Y(Q, {
											inputSize: Z.Medium,
											className: "w-[181px]",
											placeholder: "/data:/data",
											value: k.mounts,
											onChange: (e) => Me({ mounts: e.target.value })
										})
									}),
									/* @__PURE__ */ Y($l, {}),
									/* @__PURE__ */ Y($u, {
										label: "Don't mount the working folder",
										secondary: !0,
										control: /* @__PURE__ */ Y(iu, {
											checked: k.noMount,
											onChange: (e) => Me({ noMount: e }),
											"aria-label": "Don't mount the working folder",
											size: ve ? eu.Large : eu.Medium
										})
									})
								] }) : null
							] }) : null,
							/* @__PURE__ */ Y($l, {}),
							/* @__PURE__ */ Y($u, {
								label: "Custom HTTP headers",
								hint: "Turn this on only if you need to send additional request metadata.",
								control: /* @__PURE__ */ Y(iu, {
									checked: j,
									onChange: ee,
									"aria-label": "Custom HTTP headers"
								})
							}),
							j ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($l, {}), /* @__PURE__ */ Y(el, {
								label: "Extra headers (JSON object)",
								hintText: "Blank keeps the configuration's headers. Enter {} to send none; header values must be strings.",
								placeholder: "{\"X-Title\": \"NAC\"}",
								value: D,
								onChange: (e) => je(O)(e.target.value),
								textAreaClassName: "h-[108px] resize-none"
							})] }) : null
						]
					})
				}) : null,
				Ee ? /* @__PURE__ */ X("div", {
					className: "flex items-center gap-2",
					role: "status",
					"aria-live": "polite",
					children: [/* @__PURE__ */ Y("span", {
						className: "text-micro text-basic-primary",
						children: De?.phase ?? "Creating the sandbox…"
					}), /* @__PURE__ */ X("span", {
						className: "text-micro text-basic-muted",
						children: [ke, "s"]
					})]
				}) : null
			]
		}), /* @__PURE__ */ Y(Zd, {
			open: ne,
			kind: "directory",
			initialPath: y.trim(),
			ssh: xe,
			onClose: () => N(!1),
			onSelect: (e) => {
				je(b)(e), N(!1);
			}
		})]
	});
}
// src/app/components/modals/NewChatModal.tsx
function tp(e) {
	if (!e) return {};
	try {
		let t = JSON.parse(e);
		return Object(t) !== t || Array.isArray(t) ? {} : t;
	} catch {
		return {};
	}
}
function np(e) {
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
function rp(e, t) {
	return {
		initial: {
			backend: e.backend ?? t,
			model: e.model,
			base_url: e.base_url,
			allow_insecure_http: e.allow_insecure_http,
			api_key_env: e.api_key_env ?? null,
			reasoning_effort: e.reasoning_effort ?? null,
			extra_headers: tp(e.extra_headers_json),
			orchestrator_compaction_threshold: e.orchestrator_compaction_threshold,
			light_model: e.light_model ?? null
		},
		light: e.light_model ?? null
	};
}
function ip({ projectId: e, firstChat: t = !1, onClose: n }) {
	return !Xd(e !== null) || e === null ? null : /* @__PURE__ */ Y(ap, {
		projectId: e,
		firstChat: t,
		onClose: n
	}, e);
}
function ap({ projectId: e, firstChat: t, onClose: r }) {
	let { api: i } = n(), a = Ti(), o = Hf(), s = vi(), c = Or(), l = zt(), u = ie(), d = fn(), p = bn(), m = fr(), [h, g] = q(m.orchestrationEnabled ? "orchestrator" : "direct"), [_, v] = q(null), [y, b] = q({
		mode: "single",
		light: null
	}), [x, S] = q(""), C = u.data?.projects.find((t) => t.project_id === e) ?? null, w = hu(d.data ?? [], e), T = C?.default_model_config_id ? p.data?.configurations.find((e) => e.config_id === C.default_model_config_id) ?? null : null, E = Hn(C?.default_model_config_id ? null : w?.summary.session_id ?? null), D = G(() => T ? np(T) : E.data && w ? rp(E.data, w.summary.backend) : null, [
		T,
		E.data,
		w
	]), O = u.isPending || d.isPending || p.isPending || !!w && !C?.default_model_config_id && E.isPending, k = u.error || d.error || E.error || C?.default_model_config_id && (p.error || !p.isPending && !T ? /* @__PURE__ */ Error("The project default is unavailable. Review the project settings before creating a chat.") : null), A = o.busy, j = U((e) => {
		v(e), S((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), ee = U((e) => {
		b(e), S((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), M = _?.kind === "resolved" && _.light_model !== void 0 ? _.light_model : D?.light, te = JSON.stringify(M), ne = async () => {
		if (!(A || o.needsReview || O || k)) {
			if (!_) S("Choose the primary model before creating this chat.");
			else if (m.orchestrationEnabled && y.mode === "dual" && !y.light) S("Pick the light model before creating this chat.");
			else try {
				let n = await o.run((n) => zf({
					current: n.current,
					classify: Gf,
					reconcile: qf(s),
					existing: t ? async () => {
						let [t, r] = await Promise.all([i.listProjects(n.signal), i.listSessions({ projectId: e }, n.signal)]);
						if (!t.projects.some((t) => t.project_id === e)) return kr.list();
						let a = mu(At(m, r), e);
						return a ? kr.session(a.summary.session_id) : null;
					} : void 0,
					persistsModel: _.kind === "save",
					model: async () => {
						let e;
						if (_.kind === "save") {
							let t = await l.mutateAsync({
								..._.request,
								light_model: m.orchestrationEnabled ? y.mode === "dual" ? y.light : null : M ?? null
							});
							n.current() && v({
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
						} else e = _;
						return e;
					},
					chat: async (n) => {
						let r = m.orchestrationEnabled ? y.mode === "dual" && y.light ? kd(y.light, n.backend, n.api_key_env) : null : M ?? null, i = {
							project_id: e,
							behavior: me(m, h),
							first_chat: t && Et(m, d.data ?? [], e),
							first_chat_same_behavior: !m.orchestrationEnabled,
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
						let a = await c.mutateAsync(i);
						return a.metadata.session_id ? kr.session(a.metadata.session_id) : kr.project(e);
					}
				}));
				n && (r(), a(n, { replace: t }));
			} catch (e) {
				S(Kf(e));
			}
		}
	};
	return /* @__PURE__ */ X(tn, {
		open: !0,
		onClose: r,
		size: dn.Wide,
		flush: !0,
		className: "h-[700px]",
		title: "New Chat",
		subheader: m.orchestrationEnabled ? "Choose this chat's behavior and models. These settings apply to this chat without changing the project default." : "Choose this chat's model. These settings apply to this chat without changing the project default.",
		footer: /* @__PURE__ */ Y(I, {
			variant: H.Primary,
			loading: A,
			disabled: A || o.needsReview || O || !!k || !_,
			onClick: () => void ne(),
			children: "Create chat"
		}),
		children: [m.orchestrationEnabled ? /* @__PURE__ */ Y(Ef, {
			value: h,
			onChange: g,
			disabled: A
		}) : null, k ? /* @__PURE__ */ Y("p", {
			role: "alert",
			className: "text-micro text-error-primary",
			children: "The inherited settings could not be loaded. Reopen New Chat to refresh and review them."
		}) : O ? /* @__PURE__ */ X("div", {
			className: "flex items-center gap-2 py-6 text-micro text-basic-muted",
			role: "status",
			children: [/* @__PURE__ */ Y(f, { size: mt.XSmall }), "Loading the project's model settings…"]
		}) : /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-3",
			children: [
				/* @__PURE__ */ X("p", {
					className: "text-micro text-basic-muted",
					children: [
						T ? "Inherited from the project default" : D ? "Inherited from the latest chat" : "No saved project model default",
						D ? `: ${D.initial.model} · ${D.initial.backend} · reasoning ${D.initial.reasoning_effort ?? "model default"}.` : ".",
						" ",
						"Changes below override this chat only."
					]
				}),
				/* @__PURE__ */ Y(Pf, {
					initial: D?.initial,
					onChange: j,
					invalid: !!x,
					errorText: x || void 0
				}),
				m.orchestrationEnabled ? /* @__PURE__ */ Y(gf, {
					initial: M,
					behavior: h,
					onChange: ee
				}, te) : null
			]
		})]
	});
}
// src/app/components/modals/DeleteProjectModal.tsx
var op = (e) => e === 1 ? "chat" : "chats";
function sp({ open: e, onClose: t, project: n }) {
	let r = Cn(), i = Ti(), a = wi(), o = l(), s = Le(), c = async (e) => {
		if (n && !o.isPending) try {
			let s = await o.mutateAsync({
				projectId: n.project_id,
				sessions: e
			}), c = s?.deleted_session_ids ?? [], l = Qt(a.pathname);
			(a.pathname.startsWith(`/project/${encodeURIComponent(n.project_id)}`) || l && c.includes(l)) && i(kr.list(), { replace: !0 });
			let u = s?.released_session_ids?.length ?? 0, d = c.length;
			r.success(d > 0 ? `Project and ${d} ${op(d)} removed` : u > 0 ? `Project removed; ${u} ${op(u)} kept` : "Project removed"), t();
		} catch (e) {
			r.error(`Failed to delete: ${mr($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: t,
		title: "Remove Project?",
		size: dn.Medium,
		footer: /* @__PURE__ */ X(J, { children: [
			!s && /* @__PURE__ */ Y(I, {
				variant: H.Tertiary,
				content: L.Text,
				onClick: t,
				disabled: o.isPending,
				children: "Cancel"
			}),
			/* @__PURE__ */ Y(I, {
				variant: H.Secondary,
				content: L.Text,
				onClick: () => void c("keep"),
				disabled: o.isPending,
				children: "Keep Sessions"
			}),
			/* @__PURE__ */ Y(I, {
				variant: H.SecondaryDestructive,
				content: L.Text,
				onClick: () => void c("delete"),
				loading: o.isPending,
				children: "Remove Project and Sessions"
			})
		] }),
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ X("p", { children: [
				"Remove ",
				/* @__PURE__ */ X("span", {
					className: "text-basic-primary",
					children: [
						"\"",
						n?.name,
						"\""
					]
				}),
				" from NAC?"
			] }), /* @__PURE__ */ X("p", { children: [
				"Files at ",
				/* @__PURE__ */ Y("code", {
					className: "break-all text-basic-primary",
					children: n?.cwd
				}),
				" will be preserved. Select Keep Sessions to leave its chats unassigned, or remove the Project and its chats together."
			] })]
		})
	});
}
// src/app/components/modals/RenameProjectModal.tsx
function cp({ open: e, onClose: t, project: n }) {
	return !Xd(e) || !n ? null : /* @__PURE__ */ Y(lp, {
		open: e,
		project: n,
		onClose: t
	}, n.project_id);
}
function lp({ open: e, project: t, onClose: n }) {
	let r = Cn(), i = gt(), [a, o] = q(t.name), [s, c] = q(t.description ?? ""), l = async () => {
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
			let t = e instanceof _e && e.status === 409;
			r.error(t ? "Version conflict — the project changed in the meantime" : `Error: ${mr($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: n,
		title: "Rename project",
		size: dn.Small,
		footer: /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(I, {
			variant: H.Tertiary,
			content: L.Text,
			onClick: n,
			disabled: i.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ Y(I, {
			variant: H.Primary,
			content: L.Text,
			onClick: l,
			loading: i.isPending,
			children: "Save"
		})] }),
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ Y(Q, {
				label: "Name",
				placeholder: "Project name",
				value: a,
				onChange: (e) => o(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && l();
				}
			}), /* @__PURE__ */ Y(Q, {
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
var up = /* @__PURE__ */ new Set([
	"INPUT",
	"TEXTAREA",
	"SELECT"
]);
function dp(e) {
	return e instanceof HTMLElement ? up.has(e.tagName) || e.isContentEditable : !1;
}
function fp(e) {
	let { getStackLength: t } = Me(), n = jn(), r = K(e);
	W(() => {
		r.current = e;
	}), W(() => {
		let e = (e) => {
			if (!e.repeat && n(e.target)) {
				for (let n of r.current) if (n.enabled !== !1 && D(e, n.keys)) {
					if (t() > 0 || !at(n.keys) && dp(e.target)) return;
					e.preventDefault(), n.onTrigger();
					return;
				}
			}
		};
		return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
	}, [t, n]);
}
// src/app/providers/ProjectActionsProvider.tsx
var pp = ai(null);
function mp({ children: e }) {
	let { pruneSessionNavigation: t } = n().stores.sessionNavigationStore, { pruneChatTabs: r } = n().stores.chatTabsStore, i = Cn(), { pathname: a } = wi(), o = Ti(), s = fn(), c = fr(), l = s.isSuccess, u = G(() => At(c, s.data ?? []), [s.data, c]), { data: d } = ie(), f = st(), p = qe(), [m, h] = q(null), [g, v] = q(null), [y, b] = q(null), [x, S] = q(null), [C, w] = q(!1), T = f.toggle, E = p.mutateAsync, D = U(async (e, t) => {
		try {
			await E({
				projectId: e.project_id,
				sessionId: t.session_id
			}), i.success(`Assigned to ${e.name}`);
		} catch (e) {
			i.error(`Failed to assign the chat: ${Ku($(e))}`);
		}
	}, [E, i]), O = U(async (e, t = !1) => {
		w(t), S(e);
	}, []), k = G(() => ({
		create: () => h("create"),
		assign: (e) => {
			let t = Cu(d?.projects ?? [], e);
			t ? D(t, e) : (b(e), h("assign"));
		},
		rename: (e) => {
			v(e), h("rename");
		},
		remove: (e) => {
			v(e), h("delete");
		},
		togglePin: async (e) => {
			try {
				await T(e);
			} catch (e) {
				i.error(`Failed to update pin: ${mr($(e))}`);
			}
		},
		newChat: O
	}), [
		T,
		O,
		i,
		D,
		d
	]);
	W(() => {
		let e = s.data;
		l && e && d && (r(e.map((e) => e.summary.session_id), d.projects.map((e) => e.project_id)), t(du(e).map((e) => e.summary.session_id)));
	}, [
		l,
		s.data,
		d,
		r,
		t
	]);
	let A = Qt(a), j = Rn(a) ?? s.data?.find((e) => e.summary.session_id === A)?.summary.project_id ?? null;
	fp([{
		keys: _,
		enabled: j != null,
		onTrigger: () => {
			j && O(j);
		}
	}, {
		keys: Vr,
		enabled: j == null,
		onTrigger: () => h("create")
	}]);
	let ee = () => h(null);
	return /* @__PURE__ */ X(pp.Provider, {
		value: k,
		children: [
			e,
			/* @__PURE__ */ Y($f, {
				open: m === "create",
				onClose: ee
			}),
			/* @__PURE__ */ Y(ip, {
				projectId: x,
				firstChat: C,
				onClose: () => {
					let e = x;
					S(null), w(!1), e && Rn(a) === e && !du(u).some((t) => t.summary.project_id === e) && o(kr.list(), { replace: !0 });
				}
			}),
			/* @__PURE__ */ Y(Xu, {
				open: m === "assign",
				onClose: ee,
				summary: y
			}),
			/* @__PURE__ */ Y(cp, {
				open: m === "rename",
				onClose: ee,
				project: g
			}),
			/* @__PURE__ */ Y(sp, {
				open: m === "delete",
				onClose: ee,
				project: g
			})
		]
	});
}
function hp() {
	let e = ci(pp);
	if (!e) throw Error("useProjectActions must be used within ProjectActionsProvider");
	return e;
}
// src/app/components/modals/DeleteModal.tsx
function gp(e, t) {
	let n = e.project_id?.trim();
	if (!n) return kr.list();
	let r = t.filter((t) => t.summary.project_id === n && t.summary.session_id !== e.session_id);
	r.sort((e, t) => b(t.summary.updated_at) - b(e.summary.updated_at));
	let i = r[0];
	return i ? kr.session(i.summary.session_id) : kr.project(n);
}
function _p({ open: e, onClose: t, summary: n }) {
	let r = Cn(), i = uu(), a = Ti(), o = wi(), s = Qn(), { data: c = [] } = fn();
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: t,
		title: "Delete session",
		size: dn.Small,
		footer: /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(I, {
			variant: H.Tertiary,
			content: L.Text,
			onClick: t,
			disabled: s.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ Y(I, {
			variant: H.SecondaryDestructive,
			content: L.Text,
			onClick: async () => {
				if (!n || s.isPending) return;
				let e = n.session_id, i = o.pathname, l = Qt(i) === e ? gp(n, c) : null;
				try {
					l && Di(() => {
						a(l, { replace: !0 });
					}), await s.mutateAsync(e), r.success("Session deleted"), t();
				} catch (e) {
					l && a(i, { replace: !0 }), r.error(`Failed to delete: ${mr($(e))}`);
				}
			},
			loading: s.isPending,
			children: "Delete session"
		})] }),
		children: /* @__PURE__ */ X("p", { children: [
			"Are you sure you want to delete the session",
			" ",
			/* @__PURE__ */ X("span", {
				className: "text-basic-primary",
				children: [
					"\"",
					i(n),
					"\""
				]
			}),
			" ",
			/* @__PURE__ */ X("span", {
				className: "font-mono text-basic-muted",
				children: [
					"(",
					kn(n?.session_id),
					")"
				]
			}),
			"? This action cannot be undone."
		] })
	});
}
// src/app/components/modals/RenameModal.tsx
function vp({ open: e, onClose: t, summary: n }) {
	return !Xd(e) || !n ? null : /* @__PURE__ */ Y(yp, {
		open: e,
		summary: n,
		onClose: t
	}, n.session_id);
}
function yp({ open: e, summary: t, onClose: n }) {
	let r = Cn(), i = uu(), a = Kt(), [o, s] = q(t.title ?? ""), [c, l] = q(!!t.pinned), u = !!t.project_id, d = async () => {
		if (!a.isPending) try {
			await a.mutateAsync({
				id: t.session_id,
				title: o.trim(),
				pinned: u ? c : !1,
				expectedVersion: t.presentation_version ?? 0
			}), r.success("Session presentation saved"), n();
		} catch (e) {
			let t = e instanceof _e && e.status === 409;
			r.error(t ? "Version conflict — the session changed in the meantime" : `Error: ${mr($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: n,
		title: "Rename session",
		size: dn.Small,
		footer: /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(I, {
			variant: H.Tertiary,
			content: L.Text,
			onClick: n,
			disabled: a.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ Y(I, {
			variant: H.Primary,
			content: L.Text,
			onClick: d,
			loading: a.isPending,
			children: "Save"
		})] }),
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ Y(Q, {
				label: "Title",
				placeholder: i(t) || "Session name",
				hintText: "Leave empty to restore the automatic title (last prompt).",
				value: o,
				onChange: (e) => s(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && d();
				}
			}), u ? /* @__PURE__ */ X("label", {
				className: "flex items-center gap-2 label-small text-basic-secondary select-none",
				children: [/* @__PURE__ */ Y("input", {
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
function bp({ state: e, onReconnect: t, className: n }) {
	let r = e !== "connected";
	return /* @__PURE__ */ X("div", {
		className: P("flex items-center h-4 shrink-0", r ? "gap-1" : null, n),
		children: [
			r ? /* @__PURE__ */ Y(B, {
				iconName: V.Danger,
				size: 16,
				className: "text-error-primary"
			}) : null,
			/* @__PURE__ */ Y("span", {
				className: P("tag-label uppercase", r ? "text-error-primary" : "text-info-primary"),
				children: "SSH"
			}),
			e === "reconnect" && t ? /* @__PURE__ */ Y(Ir, {
				title: "Reconnect SSH",
				position: R.TopCenter,
				children: /* @__PURE__ */ Y(I, {
					size: z.Small,
					variant: H.Ghost,
					content: L.Icon,
					"aria-label": "Reconnect SSH",
					onClick: (e) => {
						e.stopPropagation(), t();
					},
					children: /* @__PURE__ */ Y(B, {
						iconName: V.Refresh,
						size: 16
					})
				})
			}) : null
		]
	});
}
// src/app/components/modals/SettingsModal.tsx
function xp(e) {
	return Object.keys(e).length === 0 ? "" : JSON.stringify(e, null, 2);
}
function Sp(e) {
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
function Cp(e) {
	let t = Sp(e.extra_headers_json);
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
function wp({ open: e, onClose: t, footer: n, titleExtra: r, children: i }) {
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: t,
		title: r ? /* @__PURE__ */ X("div", {
			className: "flex items-center gap-4",
			children: [/* @__PURE__ */ Y("span", {
				className: "flex-1 min-w-0",
				children: "Session settings"
			}), r]
		}) : "Session settings",
		size: dn.Wide,
		flush: !0,
		className: "h-[700px]",
		footer: n,
		children: i
	});
}
function Tp({ open: e, id: t, onClose: n }) {
	let r = Xd(e), { data: i, isLoading: a } = nn(r ? t : null), { data: o, isLoading: s } = Hn(r ? t : null);
	if (!r || !t) return null;
	let c = o ? Cp(o) : null;
	return !c || !i || s ? /* @__PURE__ */ Y(wp, {
		open: e,
		onClose: n,
		children: /* @__PURE__ */ Y("p", {
			className: "text-basic-muted text-micro",
			children: s || a ? "Loading session configuration…" : "Session configuration unavailable."
		})
	}) : /* @__PURE__ */ Y(Ep, {
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
function Ep({ open: e, id: t, initial: r, initialLight: i, initialVersion: a, summary: o, diagnostics: s, onClose: c }) {
	let { useSshConnectionStatus: l, sshTargetFromSummary: u } = n().stores.sshConnectionStore, { api: d } = n(), f = Le(), p = Cn(), m = vi(), h = Hf(e), g = uu(), _ = Qr(), v = gt(), [y, b] = q(!1), x = pn(), S = x.data ?? null, C = zt(), w = fr(), [T] = q(o), [E] = q(a), D = Kt(), O = T.title ?? "", [k, A] = q(O), [j, ee] = q(r.model), [M, te] = q(r.backend), [ne, N] = q(r.reasoning_effort ?? ""), [, P] = q(r.base_url), [re, ie] = q(xp(r.extra_headers)), [ae, oe] = q(r.orchestrator_compaction_threshold == null ? "" : String(r.orchestrator_compaction_threshold)), se = K(r.orchestrator_compaction_threshold == null ? "" : String(r.orchestrator_compaction_threshold)), ce = K(!1), ue = K(!1), [F, de] = q(""), [fe, pe] = q(null), [me, he] = q({
		mode: i ? "dual" : "single",
		light: i
	}), [ge, _e] = q(i), [ve, ye] = q(!1), [be, xe] = q(!1), Se = s.some((e) => e.startsWith("malformed stored light model")), Ce = K(null), we = U((e, t) => {
		if (pe(e), !e || Af(Ce.current, e)) return;
		let n = Ce.current;
		Ce.current = e;
		let r = e.kind === "resolved" ? e : e.request;
		if (te(r.backend), ee(r.model), P(r.base_url ?? Pd(r.backend) ?? ""), e.kind === "resolved") {
			N(e.reasoning_effort ?? "");
			let r = t === "primary" && n?.kind === "resolved";
			if (r && n.backend === e.backend && n.base_url === e.base_url && n.api_key_env === e.api_key_env && n.allow_insecure_http === e.allow_insecure_http || ie(xp(e.extra_headers ?? {})), r) return;
			if (e.orchestrator_compaction_threshold !== void 0) {
				let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
				ue.current = !0, ce.current = !1, se.current = n, oe(n);
			} else {
				let e = ue.current;
				ue.current = !1, e && (ce.current = !0, se.current = "", oe(""));
			}
			e.light_model !== void 0 && (_e(e.light_model), he({
				mode: e.light_model ? "dual" : "single",
				light: e.light_model
			}));
		}
	}, []), Te = Gn(), Ee = Jd(cd(Te.data, M, j).supportedEfforts, ne), De = G(() => {
		let e = cd(Te.data, M, j).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		Te.data,
		M,
		j
	]);
	W(() => {
		!ue.current && De !== "auto" && ce.current && (ce.current = !0, se.current = De, oe(De));
	}, [De, fe]);
	let Oe = !fe || h.needsReview || h.busy, ke = h.busy || x.isPending || _.isPending || D.isPending || C.isPending, Ae = u(T), je = l(Ae), [Me, Ne] = q(void 0), Pe = Me === void 0 ? je === "connected" ? Ae : null : Me, Fe = (e) => {
		Ne(e);
	}, Ie = () => D.mutateAsync({
		id: t,
		title: k.trim(),
		pinned: !!T.pinned,
		expectedVersion: T.presentation_version ?? 0
	}), Re = (e) => {
		let t;
		try {
			let n = !!(S?.model_ready && le(S, {
				backend: e.backend,
				model: e.model,
				baseUrl: e.base_url
			}));
			t = Ud({
				model: e.model,
				backend: e.backend,
				base_url: e.base_url,
				allow_insecure_http: e.allow_insecure_http,
				reasoning_effort: ne,
				credential_mode: e.api_key_env ? "variable" : "none",
				api_key_env: e.api_key_env ?? "",
				extra_headers: re,
				orchestrator_compaction_threshold: ae
			}, r, n);
		} catch (e) {
			throw new Uf(e instanceof Error ? e.message : String(e));
		}
		if (w.orchestrationEnabled) {
			if (me.mode === "dual") {
				if (!me.light) throw new Uf("Pick the light model before saving.");
				let n = kd(me.light, e.backend, e.api_key_env, r.api_key_env);
				(Se || !jd(n, i)) && (t.light_model = n);
			} else (i || Se) && (t.light_model = null);
		} else be ? t.light_model = null : jd(me.light, i) || (t.light_model = me.light);
		return t;
	}, ze = async () => {
		if (ke || h.needsReview || !fe) return;
		if (y && fe.kind === "resolved" && !fe.config_id) {
			de("Choose a saved preset in Advanced before updating the project default.");
			return;
		}
		if (w.orchestrationEnabled && me.mode === "dual" && !me.light) {
			de("Pick the light model before saving.");
			return;
		}
		let e = !1;
		try {
			let t = fe.kind === "save" ? fe.request : fe, n = Re({
				...t,
				base_url: t.base_url ?? Pd(t.backend) ?? "",
				allow_insecure_http: t.allow_insecure_http ?? !1,
				api_key_env: fe.kind === "resolved" ? fe.api_key_env : fe.request.api_key ? "PENDING_SAVED_CREDENTIAL" : null
			});
			e = fe.kind === "save" || Object.keys(n).length > 0;
		} catch (e) {
			de(Kf(e));
			return;
		}
		try {
			if (!await h.run((n) => Bf({
				current: n.current,
				classify: Gf,
				reconcile: qf(m, t),
				check: async () => {
					let e = await d.getConfig(t, n.signal);
					if (E !== void 0 && e.config_version !== E) throw new Wf();
				},
				persistsModel: fe.kind === "save",
				model: async () => {
					if (fe.kind === "save") {
						let e = Df(await C.mutateAsync({
							...fe.request,
							light_model: me.mode === "dual" ? me.light : null
						}));
						return n.current() && pe(e), e;
					}
					return fe;
				},
				configurationSaved: e,
				configuration: async (e) => {
					let n = Re(e);
					Object.keys(n).length > 0 && await _.mutateAsync({
						id: t,
						patch: n
					});
				},
				title: k.trim() === O.trim() ? void 0 : Ie,
				projectDefault: y && T.project_id ? (e) => {
					if (!e.config_id) throw new Uf("Choose a saved preset before updating the project default.");
					return v.mutateAsync({
						projectId: T.project_id,
						payload: { default_model_config_id: e.config_id }
					});
				} : void 0
			}))) return;
			p.success("Session settings saved"), c();
		} catch (e) {
			de(Kf(e));
		}
	}, Be = /* @__PURE__ */ X(J, { children: [f ? /* @__PURE__ */ Y(gn, {
		variant: H.Tertiary,
		content: L.Text,
		onClick: c,
		disabled: ke,
		children: "Cancel"
	}) : /* @__PURE__ */ Y(I, {
		variant: H.Tertiary,
		size: z.Large,
		content: L.Text,
		onClick: c,
		disabled: ke,
		children: "Cancel"
	}), f ? /* @__PURE__ */ Y(gn, {
		variant: H.Primary,
		"aria-label": "Save",
		content: L.Text,
		onClick: ze,
		disabled: Oe,
		loading: ke,
		children: "Save"
	}) : /* @__PURE__ */ Y(I, {
		variant: H.Primary,
		"aria-label": "Save",
		size: z.Large,
		content: L.Text,
		onClick: ze,
		disabled: Oe,
		loading: ke,
		children: "Save"
	})] });
	return /* @__PURE__ */ Y(wp, {
		open: e,
		onClose: c,
		footer: Be,
		titleExtra: Ae ? /* @__PURE__ */ Y(bp, { state: je === "connected" ? "connected" : "disconnected" }) : null,
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-6 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ Y("p", {
					className: "text-micro text-basic-muted",
					children: "Changes apply to this inactive primary chat. Project defaults and existing children keep their settings."
				}),
				s.length > 0 ? /* @__PURE__ */ X("div", {
					className: "rounded-[4px] border border-error-muted bg-error-tertiary p-3 text-micro text-error-primary",
					children: [/* @__PURE__ */ Y("div", {
						className: "label-small mb-1",
						children: "Repair required"
					}), s.map((e) => /* @__PURE__ */ X("div", { children: ["• ", e] }, e))]
				}) : null,
				Ae ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Tf, {
					mode: "settings",
					connection: Pe,
					seedTarget: Ae,
					onConnectionChange: Fe
				}), /* @__PURE__ */ Y($l, {})] }) : null,
				/* @__PURE__ */ Y(Q, {
					label: "Session title",
					"aria-label": "Session title",
					inputSize: f ? Z.Large : Z.Medium,
					placeholder: g(T) || "Session name",
					hintText: "Leave empty to restore the automatic title (the last prompt).",
					value: k,
					onChange: (e) => A(e.target.value)
				}),
				/* @__PURE__ */ Y(Pf, {
					existingSession: !0,
					simple: !w.orchestrationEnabled,
					invalid: !!F,
					errorText: F || void 0,
					initial: {
						backend: r.backend,
						model: r.model,
						base_url: r.base_url,
						allow_insecure_http: r.allow_insecure_http,
						api_key_env: r.api_key_env,
						reasoning_effort: r.reasoning_effort,
						extra_headers: r.extra_headers,
						orchestrator_compaction_threshold: r.orchestrator_compaction_threshold,
						light_model: i
					},
					onChange: we,
					children: /* @__PURE__ */ X("div", {
						className: "flex flex-col gap-2",
						children: [
							w.orchestrationEnabled ? /* @__PURE__ */ Y(gf, {
								initial: me.light,
								behavior: T.behavior ?? "orchestrator",
								onChange: he
							}, JSON.stringify(ge)) : null,
							T.project_id ? /* @__PURE__ */ X("label", {
								className: "flex items-start gap-2 text-micro",
								children: [
									/* @__PURE__ */ Y("input", {
										type: "checkbox",
										checked: y,
										onChange: (e) => b(e.target.checked)
									}),
									" ",
									/* @__PURE__ */ X("span", { children: ["Use selected preset as the project default", /* @__PURE__ */ Y("span", {
										className: "block text-basic-muted",
										children: "Future chats inherit that saved preset, including its Advanced values. Existing chats and children keep their settings."
									})] })
								]
							}) : null,
							/* @__PURE__ */ Y($l, {}),
							/* @__PURE__ */ X("button", {
								type: "button",
								className: "btn-ghost flex w-full items-center gap-1.5 rounded-[4px] p-2 text-btn-secondary",
								"aria-expanded": ve,
								onClick: () => ye((e) => !e),
								children: [
									/* @__PURE__ */ Y(B, {
										iconName: V.Gear,
										size: 20
									}),
									/* @__PURE__ */ Y("span", {
										className: "label-small flex-1 text-left",
										children: "Advanced Configurations"
									}),
									/* @__PURE__ */ Y(B, {
										iconName: ve ? V.Down : V.Right,
										size: 20
									})
								]
							}),
							ve ? /* @__PURE__ */ X(J, { children: [
								Se && !w.orchestrationEnabled ? /* @__PURE__ */ X("label", {
									className: "text-micro",
									children: [
										/* @__PURE__ */ Y("input", {
											type: "checkbox",
											checked: be,
											onChange: (e) => xe(e.target.checked)
										}),
										" ",
										"Clear malformed legacy light settings"
									]
								}) : null,
								/* @__PURE__ */ Y($l, {}),
								/* @__PURE__ */ Y($u, {
									label: "Reasoning Effort",
									hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
									control: /* @__PURE__ */ Y($d, {
										items: Ee,
										value: ne,
										onValueChange: N
									})
								}),
								/* @__PURE__ */ Y($l, {}),
								/* @__PURE__ */ Y($u, {
									label: "Context Limit",
									hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
									control: /* @__PURE__ */ X("div", {
										className: "flex items-center gap-2",
										children: [/* @__PURE__ */ Y(Q, {
											inputSize: f ? Z.Large : Z.Medium,
											className: Zu,
											inputClassName: "md:text-right",
											"aria-label": "Context limit",
											placeholder: De,
											inputMode: "numeric",
											value: ae,
											onChange: (e) => {
												ue.current = !1, ce.current = !1, se.current = e.target.value, oe(e.target.value);
											}
										}), /* @__PURE__ */ Y("span", {
											className: "shrink-0 text-micro text-basic-muted",
											children: "tokens"
										})]
									})
								}),
								/* @__PURE__ */ Y($l, {}),
								/* @__PURE__ */ Y(el, {
									label: "Extra headers (JSON object)",
									textAreaSize: f ? $c.Large : $c.Medium,
									hintText: "Blank sends none; header values must be strings.",
									placeholder: "{ \"X-Title\": \"NAC\" }",
									value: re,
									onChange: (e) => ie(e.target.value),
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
var Dp = ai(null);
function Op({ children: t }) {
	let { pushLocalEvent: r, captureRuntimeActivation: i } = n().stores.runtimeStore, a = Cn(), o = Lr(), s = e(), [c, l] = q(null), [u, d] = q(null), [f, p] = q(null), m = U((e) => (t) => {
		d(t), l(e);
	}, []), h = o.toggle, g = G(() => ({
		rename: m("rename"),
		remove: m("delete"),
		settings: (e) => {
			p(e), l("settings");
		},
		togglePin: async (e) => {
			try {
				await h(e);
			} catch (e) {
				a.error(`Failed to update pin: ${mr($(e))}`);
			}
		},
		stopRun: async (e) => {
			let t = i(e);
			try {
				await s.mutateAsync(e), t() && r("run", "■ run cancellation requested"), a.success("Run cancellation requested");
			} catch (e) {
				a.error(`Failed to stop run: ${mr($(e))}`);
			}
		}
	}), [
		m,
		h,
		a,
		i,
		s,
		r
	]), _ = () => l(null);
	return /* @__PURE__ */ X(Dp.Provider, {
		value: g,
		children: [
			t,
			/* @__PURE__ */ Y(vp, {
				open: c === "rename",
				onClose: _,
				summary: u
			}),
			/* @__PURE__ */ Y(_p, {
				open: c === "delete",
				onClose: _,
				summary: u
			}),
			/* @__PURE__ */ Y(Tp, {
				open: c === "settings",
				id: f,
				onClose: _
			})
		]
	});
}
function kp() {
	let e = ci(Dp);
	if (!e) throw Error("useSessionActions must be used within SessionActionsProvider");
	return e;
}
// src/app/components/modals/MobileProjectSessionModal.tsx
function Ap(e, t, n) {
	return e.kind === "project" ? `${e.entry.project.name} ${e.entry.project.cwd}`.toLowerCase().includes(t) : `${n(e.session.summary)} ${e.session.summary.cwd}`.toLowerCase().includes(t);
}
function jp({ open: e, onClose: t, projectId: n, sessions: r, activeSessionId: i, summary: a }) {
	let o = Ti(), s = hp(), c = kp(), l = uu(), { data: u } = ie(), { data: d = [] } = qr(), f = a != null && !n, p = bu(u?.projects ?? [], n), [m, h] = q(n || a ? "chats" : "projects"), [g, _] = q(""), v = K(e);
	W(() => {
		e && !v.current && (h(n || a ? "chats" : "projects"), _("")), v.current = e;
	}, [
		e,
		n,
		a
	]);
	let y = a ? l(a) : p?.name ?? "Projects", b = a ? p?.name ?? "Not assigned" : null, x = n ? r : _u(d), S = G(() => {
		let e = g.trim().toLowerCase();
		return e ? x.filter((t) => l(t.summary).toLowerCase().includes(e)) : x;
	}, [
		x,
		g,
		l
	]), C = G(() => yu(u?.projects ?? [], d), [u, d]), w = G(() => {
		let e = g.trim().toLowerCase();
		return e ? C.filter((t) => Ap(t, e, l)) : C;
	}, [
		C,
		g,
		l
	]), T = (e) => {
		h(e), _("");
	}, E = (e) => {
		t(), e();
	};
	return /* @__PURE__ */ X(tn, {
		open: e,
		onClose: t,
		title: /* @__PURE__ */ X("div", {
			className: "flex flex-col min-w-0 justify-center",
			children: [/* @__PURE__ */ Y("span", {
				className: "truncate",
				children: y
			}), b ? /* @__PURE__ */ Y("span", {
				className: P("text-micro font-normal truncate", f ? "text-danger-primary" : "text-basic-muted"),
				children: b
			}) : null]
		}),
		bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
		children: [
			m === "assign" ? null : /* @__PURE__ */ X("div", {
				className: "absolute inset-x-0 top-0 z-10 flex items-start gap-3 px-2 py-4",
				children: [
					/* @__PURE__ */ Y(Qc, {
						className: "flex-1 min-w-0",
						variant: Zc.Search,
						placeholder: m === "chats" ? "Search Sessions..." : "Search projects...",
						value: g,
						onChange: (e) => _(e.target.value),
						onClear: () => _(""),
						"aria-label": m === "chats" ? "Search Sessions" : "Search projects"
					}),
					m === "chats" && n ? /* @__PURE__ */ Y(gn, {
						variant: H.Secondary,
						content: L.Icon,
						"aria-label": "New Session",
						onClick: () => E(() => void s.newChat(n)),
						children: /* @__PURE__ */ Y(B, { iconName: V.Add })
					}) : null,
					m === "projects" ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(gn, {
						variant: H.Secondary,
						content: L.Icon,
						"aria-label": "New project",
						onClick: () => E(s.create),
						children: /* @__PURE__ */ Y(B, { iconName: V.Add })
					}), /* @__PURE__ */ Y(gn, {
						variant: H.Secondary,
						content: L.Icon,
						"aria-label": "All projects",
						onClick: () => E(() => o(kr.list())),
						children: /* @__PURE__ */ Y(B, { iconName: V.Grid })
					})] }) : null
				]
			}),
			/* @__PURE__ */ Y("div", {
				className: P("flex-1 min-h-0 overflow-auto [&>*]:shrink-0", m === "assign" ? "px-4 py-4" : "px-2 pt-[72px] pb-[96px]"),
				children: m === "assign" && a ? /* @__PURE__ */ Y(Pp, {
					summary: a,
					onAssigned: t
				}) : m === "chats" ? /* @__PURE__ */ Y(Au, {
					sessions: S,
					activeSessionId: i,
					isMobile: !0,
					emptyLabel: g.trim() ? "No matching chats" : "No chats yet",
					onOpen: (e) => E(() => o(kr.session(e.summary.session_id))),
					onPin: (e) => void c.togglePin(e.summary),
					onRename: (e) => E(() => c.rename(e.summary)),
					onDelete: (e) => E(() => c.remove(e.summary))
				}) : /* @__PURE__ */ Y(Mu, {
					items: w,
					activeId: n ?? i,
					isMobile: !0,
					emptyLabel: g.trim() ? "No matching projects" : "No projects yet",
					onOpenProject: (e) => E(() => o(kr.project(e))),
					onOpenSession: (e) => E(() => o(kr.session(e))),
					renderActions: (e) => {
						if (e.kind === "project") {
							let { project: t } = e.entry;
							return /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Np, {
								label: `Rename ${t.name}`,
								icon: V.Edit,
								onClick: () => E(() => s.rename(t))
							}), /* @__PURE__ */ Y(Np, {
								label: `Delete ${t.name}`,
								icon: V.Trash,
								variant: H.GhostDestructive,
								onClick: () => E(() => s.remove(t))
							})] });
						}
						let { summary: t } = e.session, n = l(t);
						return /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Np, {
							label: `Rename ${n}`,
							icon: V.Edit,
							onClick: () => E(() => c.rename(t))
						}), /* @__PURE__ */ Y(Np, {
							label: `Delete ${n}`,
							icon: V.Trash,
							variant: H.GhostDestructive,
							onClick: () => E(() => c.remove(t))
						})] });
					}
				})
			}),
			/* @__PURE__ */ Y("div", {
				className: "absolute inset-x-0 bottom-0 z-10 px-2 py-4 pointer-events-none",
				children: /* @__PURE__ */ X("div", {
					className: "flex items-center gap-1 w-full p-[2px] rounded-[18px] bg-elevation-level-3 shadow-2xl overflow-hidden pointer-events-auto",
					role: "tablist",
					children: [
						f ? /* @__PURE__ */ Y(Mp, {
							active: m === "assign",
							icon: V.FolderOpen,
							label: "Assign",
							onClick: () => T("assign")
						}) : null,
						/* @__PURE__ */ Y(Mp, {
							active: m === "chats",
							icon: V.Chat,
							label: "Sessions",
							onClick: () => T("chats")
						}),
						/* @__PURE__ */ Y(Mp, {
							active: m === "projects",
							icon: V.Folder,
							label: "Projects",
							onClick: () => T("projects")
						})
					]
				})
			})
		]
	});
}
function Mp({ active: e, icon: t, label: n, onClick: r }) {
	return /* @__PURE__ */ X("button", {
		type: "button",
		role: "tab",
		"aria-selected": e,
		className: P("flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]", e ? "btn-primary" : "btn-ghost"),
		onClick: r,
		children: [/* @__PURE__ */ Y(B, {
			iconName: t,
			size: 28
		}), /* @__PURE__ */ Y("span", {
			className: P("label-micro font-bold truncate max-w-full", e ? null : "text-basic-primary"),
			children: n
		})]
	});
}
function Np({ label: e, icon: t, onClick: n, variant: r = H.Ghost }) {
	return /* @__PURE__ */ Y(I, {
		variant: r,
		size: z.Small,
		content: L.Icon,
		title: e,
		"aria-label": e,
		onClick: n,
		children: /* @__PURE__ */ Y(B, { iconName: t })
	});
}
function Pp({ summary: e, onAssigned: t }) {
	let n = Cn(), { data: r } = ie(), i = qe(), a = $r(), [o, s] = q(""), [c, l] = q(null), u = G(() => Cu(r?.projects ?? [], e), [r, e]), d = i.isPending || a.isPending, f = async () => {
		if (!d) {
			l(null);
			try {
				let r = u ?? await a.mutateAsync({
					name: o.trim() || null,
					...Su(e)
				});
				await i.mutateAsync({
					projectId: r.project_id,
					sessionId: e.session_id
				}), n.success(`Assigned to ${r.name}`), t();
			} catch (e) {
				l(Ku($(e)));
			}
		}
	};
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ Y("p", {
				className: "text-medium text-basic-secondary",
				children: "This Session will be assigned to the project (according to its working directory):"
			}),
			u ? /* @__PURE__ */ X("div", {
				className: "flex items-center gap-4 min-w-0",
				children: [/* @__PURE__ */ Y(Il, {
					id: u.project_id,
					size: 40,
					className: "rounded-[4px] shrink-0"
				}), /* @__PURE__ */ X("div", {
					className: "flex flex-col min-w-0",
					children: [/* @__PURE__ */ Y("span", {
						className: "header-md truncate",
						children: u.name
					}), /* @__PURE__ */ Y("span", {
						className: "code-micro text-basic-tertiary truncate",
						children: u.cwd
					})]
				})]
			}) : /* @__PURE__ */ Y(Q, {
				label: "Project name",
				inputSize: Z.Large,
				placeholder: "Taken from the git remote",
				value: o,
				onChange: (e) => {
					l(null), s(e.target.value);
				}
			}),
			c ? /* @__PURE__ */ Y("p", {
				className: "text-error-primary text-micro",
				children: c
			}) : null,
			/* @__PURE__ */ Y(I, {
				variant: H.Primary,
				size: z.Large,
				content: L.Text,
				className: "w-full",
				onClick: () => void f(),
				loading: d,
				children: u ? "Assign" : "Create and assign"
			})
		]
	});
}
// src/app/components/projects/ProjectPopover.tsx
function Fp({ tooltip: e, label: t, icon: n, onClick: r, variant: i = H.Ghost }) {
	return /* @__PURE__ */ Y(I, {
		variant: i,
		size: z.Small,
		content: L.Icon,
		title: e,
		"aria-label": t,
		onClick: r,
		children: /* @__PURE__ */ Y(B, { iconName: n })
	});
}
function Ip(e, t, n) {
	return (e.kind === "project" ? `${e.entry.project.name} ${e.entry.project.cwd}` : `${n(e.session.summary)} ${e.session.summary.cwd}`).toLowerCase().includes(t);
}
function Lp({ activeId: e, onClose: t }) {
	let n = Ti(), r = hp(), i = kp(), a = uu(), o = Le(), [s, c] = q(""), { data: l } = ie(), { data: u = [] } = qr(), d = G(() => yu(l?.projects ?? [], u), [l, u]), f = G(() => {
		let e = s.trim().toLowerCase();
		return e ? d.filter((t) => Ip(t, e, a)) : d;
	}, [
		d,
		s,
		a
	]);
	return /* @__PURE__ */ X("div", {
		className: P("flex flex-col", o ? "h-[calc(70dvh)]" : "max-h-[520px]"),
		children: [/* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2 shrink-0",
			children: [/* @__PURE__ */ Y(Q, {
				inputSize: o ? Z.Large : Z.Medium,
				leading: Vc.Icon,
				leadingIconName: V.Search,
				placeholder: "Search Projects",
				"aria-label": "Search projects",
				value: s,
				onChange: (e) => c(e.target.value)
			}), /* @__PURE__ */ Y($l, {})]
		}), /* @__PURE__ */ Y("div", {
			className: "flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
			children: /* @__PURE__ */ Y(Mu, {
				items: f,
				activeId: e,
				isMobile: o,
				emptyLabel: s.trim() ? "No matching projects" : "No projects yet",
				onOpenProject: (e) => {
					t(), n(kr.project(e));
				},
				onOpenSession: (e) => {
					t(), n(kr.session(e));
				},
				renderActions: (e) => {
					if (e.kind === "project") {
						let { project: n } = e.entry;
						return /* @__PURE__ */ X(J, { children: [
							/* @__PURE__ */ Y(Fp, {
								tooltip: n.pinned ? "Unpin project" : "Pin project",
								label: `${n.pinned ? "Unpin" : "Pin"} ${n.name}`,
								icon: n.pinned ? V.Unpin : V.Pin,
								onClick: () => void r.togglePin(n)
							}),
							/* @__PURE__ */ Y(Fp, {
								tooltip: "Rename project",
								label: `Rename ${n.name}`,
								icon: V.Edit,
								onClick: () => {
									t(), r.rename(n);
								}
							}),
							/* @__PURE__ */ Y(Fp, {
								tooltip: "Remove project",
								label: `Remove ${n.name}`,
								icon: V.Trash,
								variant: H.GhostDestructive,
								onClick: () => {
									t(), r.remove(n);
								}
							})
						] });
					}
					let { summary: n } = e.session, o = a(n);
					return /* @__PURE__ */ X(J, { children: [
						/* @__PURE__ */ Y(Fp, {
							tooltip: "Rename chat",
							label: `Rename ${o}`,
							icon: V.Edit,
							onClick: () => {
								t(), i.rename(n);
							}
						}),
						/* @__PURE__ */ Y(Fp, {
							tooltip: "Delete chat",
							label: `Delete ${o}`,
							icon: V.Trash,
							variant: H.GhostDestructive,
							onClick: () => {
								t(), i.remove(n);
							}
						}),
						/* @__PURE__ */ Y(Fp, {
							tooltip: "Assign to a project",
							label: `Assign ${o} to a project`,
							icon: V.Folders,
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
function Rp() {
	let { pathname: e } = wi(), t = Qt(e), n = Rn(e), r = Ti(), i = hp(), a = Le(), o = uu(), { data: s } = ie(), { data: c = [] } = qr(), [l, u] = q(!1), d = t ? c.find((e) => e.summary.session_id === t) : void 0, f = n ?? d?.summary.project_id ?? null, p = bu(s?.projects ?? [], f), m = f ? du(c).filter((e) => e.summary.project_id === f).sort((e, t) => b(t.summary.updated_at) - b(e.summary.updated_at)) : [], h = !!(f || t), g = p?.name ?? o(d?.summary) ?? t ?? "", _ = d ? o(d.summary) : null, v = p?.project_id ?? t ?? "", y = f ? m.some((e) => rt(e.active_run)) : rt(d?.active_run), x = !a || !h;
	return /* @__PURE__ */ X("nav", {
		className: P("flex items-center min-w-0 gap-1", a && h && "flex-1"),
		"aria-label": "Breadcrumb",
		children: [x ? a ? /* @__PURE__ */ Y("button", {
			type: "button",
			className: "label-medium text-btn-secondary rounded-[8px] truncate",
			onClick: () => r(kr.list()),
			"aria-current": h ? void 0 : "page",
			children: "All Projects"
		}) : /* @__PURE__ */ Y(I, {
			variant: H.Ghost,
			size: z.Medium,
			content: L.Text,
			onClick: () => r(kr.list()),
			"aria-current": h ? void 0 : "page",
			children: "All Projects"
		}) : null, h ? /* @__PURE__ */ X(J, { children: [
			x ? /* @__PURE__ */ Y(B, {
				iconName: V.Right,
				className: "text-basic-muted shrink-0"
			}) : null,
			a ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ X("button", {
				type: "button",
				className: "flex flex-1 min-w-0 items-center gap-2 rounded-[8px] text-btn-secondary",
				onClick: () => u(!0),
				"aria-expanded": l,
				"aria-label": "Switch chat or project",
				children: [/* @__PURE__ */ X("span", {
					className: "flex flex-col flex-1 min-w-0 text-left",
					children: [/* @__PURE__ */ Y("span", {
						className: P("label-medium truncate !leading-[20px]", y ? "text-shimmer-basic" : "text-basic-primary"),
						children: _ ?? g
					}), _ ? /* @__PURE__ */ Y("span", {
						className: P("text-micro truncate", p ? "text-basic-muted" : "text-danger-primary"),
						children: p?.name ?? "Not assigned"
					}) : null]
				}), /* @__PURE__ */ Y(B, {
					iconName: V.Right,
					size: 24,
					className: "shrink-0"
				})]
			}), /* @__PURE__ */ Y(jp, {
				open: l,
				onClose: () => u(!1),
				projectId: f,
				sessions: m,
				activeSessionId: t,
				summary: d?.summary ?? null
			})] }) : /* @__PURE__ */ Y(Zr, {
				open: l,
				onClose: () => u(!1),
				placement: R.BottomRight,
				size: Gt.Medium,
				className: "min-w-0",
				content: /* @__PURE__ */ Y(Lp, {
					activeId: f ?? t,
					onClose: () => u(!1)
				}),
				children: /* @__PURE__ */ X(I, {
					variant: H.Ghost,
					size: z.Medium,
					content: L.Text,
					className: "!px-2 max-w-[320px]",
					onClick: () => u((e) => !e),
					"aria-expanded": l,
					"aria-label": "Switch project",
					children: [
						p ? /* @__PURE__ */ Y(Il, {
							id: v,
							size: 24,
							isRunning: y,
							className: "rounded-[2px]"
						}) : /* @__PURE__ */ Y(Ea, {
							size: 24,
							isRunning: y
						}),
						/* @__PURE__ */ Y("span", {
							className: P("truncate max-w-[120px]", y && "text-shimmer-basic"),
							children: g
						}),
						/* @__PURE__ */ Y(B, {
							iconName: V.Down,
							className: P("transition-transform", l ? "rotate-180" : void 0)
						})
					]
				})
			}),
			a ? null : /* @__PURE__ */ Y(Ir, {
				title: "New project",
				keyboardShortcuts: p ? void 0 : Vr,
				position: Ir.Position.BottomCenter,
				children: /* @__PURE__ */ Y(I, {
					variant: H.Ghost,
					size: z.Small,
					content: L.Icon,
					"aria-label": "New project",
					onClick: i.create,
					children: /* @__PURE__ */ Y(B, { iconName: V.AddCircle })
				})
			})
		] }) : null]
	});
}
// src/app/components/HeaderMenu.tsx
var zp = "https://github.com/arcee-ai/nac", Bp = "https://github.com/arcee-ai/nac#readme";
function Vp({ onConfigurations: e, onSshConfigs: t, onManagedHost: n }) {
	let [r, i] = q(!1), a = Le(), { data: o } = Er(), s = o?.store_path ?? "store path pending", c = a ? Hl.Large : Hl.Medium, l = (e) => () => {
		i(!1), e();
	}, u = (e) => l(() => window.open(e, "_blank", "noopener"));
	return /* @__PURE__ */ Y(Zr, {
		open: r,
		onClose: () => i(!1),
		placement: R.BottomLeft,
		size: "w-[280px]",
		panelClassName: "p-1",
		sheetClassName: "px-2",
		content: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2",
			children: [
				/* @__PURE__ */ X("div", {
					className: P("flex items-center", a ? "h-16 gap-2 pl-4 pr-2" : "h-9 gap-1 pl-2"),
					children: [
						/* @__PURE__ */ Y("span", {
							className: P("text-basic-primary shrink-0", a ? "label-medium" : "label-small"),
							children: "Store:"
						}),
						/* @__PURE__ */ Y("span", {
							className: P("code text-info-primary flex-1 min-w-0 truncate", a ? "code-medium" : "code-small"),
							title: s,
							children: s
						}),
						/* @__PURE__ */ Y(Ft, {
							value: s,
							size: z.Medium,
							variant: H.Ghost,
							title: "Copy the store path"
						})
					]
				}),
				/* @__PURE__ */ Y($l, {}),
				/* @__PURE__ */ X(Gl, {
					size: c,
					onClick: l(e),
					children: [/* @__PURE__ */ Y(B, { iconName: V.Gear }), /* @__PURE__ */ Y("span", {
						className: "text-left flex-grow",
						children: "Configurations"
					})]
				}),
				/* @__PURE__ */ X(Gl, {
					size: c,
					onClick: l(t),
					children: [/* @__PURE__ */ Y(B, { iconName: V.Globe }), /* @__PURE__ */ Y("span", {
						className: "text-left flex-grow",
						children: "SSH configs"
					})]
				}),
				n ? /* @__PURE__ */ X(Gl, {
					size: c,
					onClick: l(n),
					children: [/* @__PURE__ */ Y(B, { iconName: V.Controls }), /* @__PURE__ */ Y("span", {
						className: "text-left flex-grow",
						children: "Managed host"
					})]
				}) : null,
				/* @__PURE__ */ Y($l, {}),
				/* @__PURE__ */ X(Gl, {
					size: c,
					onClick: u(Bp),
					children: [
						/* @__PURE__ */ Y(B, { iconName: V.Book }),
						/* @__PURE__ */ Y("span", {
							className: "text-left flex-grow",
							children: "See docs"
						}),
						/* @__PURE__ */ Y(B, { iconName: V.External })
					]
				}),
				/* @__PURE__ */ X(Gl, {
					size: c,
					onClick: u(zp),
					children: [
						/* @__PURE__ */ Y(B, { iconName: V.Github }),
						/* @__PURE__ */ Y("span", {
							className: "text-left flex-grow",
							children: "See Github"
						}),
						/* @__PURE__ */ Y(B, { iconName: V.External })
					]
				})
			]
		}),
		children: /* @__PURE__ */ Y(I, {
			variant: H.Ghost,
			size: z.Medium,
			content: L.Icon,
			className: P(a && "btn-round"),
			onClick: () => i((e) => !e),
			"aria-expanded": r,
			"aria-label": r ? "Close the menu" : "Open the menu",
			children: /* @__PURE__ */ Y(B, { iconName: r ? V.Close : V.Hamburger })
		})
	});
}
// src/app/components/McpServersButton.tsx
function Hp({ onOpen: e }) {
	let t = Le(), { data: n } = or(), r = n?.servers.filter((e) => e.enabled).length ?? 0, i = r ? `MCP servers, ${r} active` : "MCP servers";
	return /* @__PURE__ */ X("div", {
		className: "relative shrink-0",
		children: [t ? /* @__PURE__ */ Y(gn, {
			variant: H.Ghost,
			content: L.Icon,
			"aria-label": i,
			onClick: e,
			children: /* @__PURE__ */ Y(B, { iconName: V.Toolbox })
		}) : /* @__PURE__ */ X(I, {
			variant: H.Secondary,
			size: z.Medium,
			content: L.IconLeft,
			"aria-label": i,
			onClick: e,
			children: [/* @__PURE__ */ Y(B, { iconName: V.Toolbox }), "MCP"]
		}), r ? /* @__PURE__ */ Y("span", {
			"aria-hidden": !0,
			className: "label-micro pointer-events-none absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 bg-btn-primary text-btn-primary",
			children: r
		}) : null]
	});
}
// src/app/components/SessionHeaderActions.tsx
function Up() {
	let { toggleSidePanelExpanded: e } = n().stores.sessionLayoutStore, { pathname: t } = wi(), r = Qt(t);
	return !Le() || !r ? null : /* @__PURE__ */ Y(I, {
		variant: H.Ghost,
		size: z.Medium,
		content: L.Icon,
		className: "btn-round",
		"aria-label": "Open panel",
		onClick: e,
		children: /* @__PURE__ */ Y(B, { iconName: V.OpenMobileModal })
	});
}
// src/app/components/modals/ConfigListNav.tsx
function Wp({ draftLabel: e, draftSelected: t, onSelectDraft: n, entries: r, selectedId: i, onSelect: a, isLoading: o = !1 }) {
	let s = Le(), [c, l] = q(!1), u = t ? e : r.find((e) => e.id === i)?.name ?? e, d = () => {
		n(), l(!1);
	}, p = (e) => {
		a(e), l(!1);
	}, m = /* @__PURE__ */ X(J, { children: [
		/* @__PURE__ */ X(Gl, {
			size: s ? Hl.Large : Hl.Medium,
			variant: Ul.Regular,
			active: t,
			onClick: d,
			children: [/* @__PURE__ */ Y(B, { iconName: V.Add }), /* @__PURE__ */ Y("span", {
				className: "text-left flex-grow truncate",
				children: e
			})]
		}),
		r.length ? /* @__PURE__ */ Y($l, {}) : null,
		r.map((e) => /* @__PURE__ */ Y(Gl, {
			size: s ? Hl.Large : Hl.Medium,
			active: i === e.id,
			onClick: () => p(e.id),
			children: /* @__PURE__ */ Y("span", {
				className: "text-left flex-grow truncate",
				children: e.name
			})
		}, e.id)),
		o ? /* @__PURE__ */ X("div", {
			className: "flex items-center gap-2 px-2 py-1",
			children: [/* @__PURE__ */ Y(f, { size: mt.XSmall }), /* @__PURE__ */ Y("span", {
				className: "text-micro text-basic-muted",
				children: "Loading…"
			})]
		}) : null
	] });
	return s ? /* @__PURE__ */ Y("div", {
		className: "shrink-0 border-b border-muted px-2 py-2",
		children: /* @__PURE__ */ Y(Zr, {
			open: c,
			onClose: () => l(!1),
			placement: R.BottomLeft,
			size: "min-w-full",
			className: "w-full",
			panelClassName: "max-h-[50dvh] overflow-auto",
			content: /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1 px-2",
				children: m
			}),
			children: /* @__PURE__ */ X(I, {
				variant: H.Ghost,
				size: z.Large,
				content: L.Icon,
				className: "w-full",
				"aria-expanded": c,
				"aria-label": "Choose configuration",
				onClick: () => l((e) => !e),
				children: [
					t ? /* @__PURE__ */ Y(B, {
						iconName: V.Add,
						className: "shrink-0"
					}) : null,
					/* @__PURE__ */ Y("span", {
						className: "text-left flex-grow truncate",
						children: u
					}),
					/* @__PURE__ */ Y(B, {
						iconName: V.Down,
						className: P("shrink-0 transition-transform duration-150 ease-out", c ? "rotate-180" : "rotate-0")
					})
				]
			})
		})
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col shrink-0 gap-2 w-[240px] overflow-y-auto border-r border-muted px-2 py-4 [&>*]:shrink-0",
		children: m
	});
}
// src/app/components/modals/ConfigurationsModal.tsx
var Gp = wn.map((e) => ({
	id: e,
	label: Jt(e)
})), Kp = Kd.filter((e) => e.id !== Nd).map((e) => e.id === "" ? {
	...e,
	label: "Not set"
} : e), qp = "__new__";
function Jp({ open: e, onClose: t }) {
	return Xd(e) ? /* @__PURE__ */ Y(Yp, {
		open: e,
		onClose: t
	}) : null;
}
function Yp({ open: e, onClose: t }) {
	let n = Le(), { data: r, isLoading: i } = bn(), a = G(() => r?.configurations ?? [], [r]), [o, s] = q(null), [c, l] = q(null), u = c ?? a.at(-1)?.config_id ?? qp, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: t,
		title: "Configurations",
		size: dn.Large,
		flush: !0,
		className: "max-w-[820px] md:h-[720px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: o,
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ Y(Wp, {
				draftLabel: "New configuration",
				draftSelected: u === qp,
				onSelectDraft: () => l(qp),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: l,
				isLoading: i
			}), /* @__PURE__ */ Y(Xp, {
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
function Xp({ record: e, takenNames: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: o }) {
	let s = Cn(), c = zt(), l = it(), u = Yt(), d = e?.backend, [f, p] = q(d ?? "openai-responses"), [m, h] = q(e?.name ?? null), [g, _] = q(e?.base_url ?? ""), [v, y] = q(e?.allow_insecure_http ?? !1), [b, x] = q(""), [S, C] = q(e?.model ?? ""), [w, T] = q(e?.reasoning_effort ?? ""), [E, D] = q(e?.orchestrator_compaction_threshold?.toString() ?? ""), O = K(e?.orchestrator_compaction_threshold?.toString() ?? ""), k = K(e?.orchestrator_compaction_threshold == null), [A, j] = q(() => e && Object.keys(e.extra_headers).length ? JSON.stringify(e.extra_headers, null, 2) : ""), [ee, M] = q(e?.initial_prompt ?? ""), [te, ne] = q({
		mode: e?.light_model ? "dual" : "single",
		light: e?.light_model ?? null
	}), [N, re] = q(""), ie = m ?? Zp(f, t), ae = Ar(f), oe = Gn(), se = Jd(cd(oe.data, f, S).supportedEfforts, w, Kp), ce = G(() => {
		let e = cd(oe.data, f, S).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		oe.data,
		f,
		S
	]);
	W(() => {
		ce !== "auto" && (O.current === "" || k.current) && (k.current = !0, O.current = ce, D(ce));
	}, [ce]);
	let { signedIn: le } = Ed(f), ue = af(b.trim(), 600), F = hn(f, ue, null, ae && !!ue), de = Mt(f, !ae && le), fe = Pt(e && f === d ? e.config_id : null, ""), pe = ae && ue ? F.isFetching ? { status: "validating" } : F.error ? {
		status: "error",
		message: Ku(F.error, f)
	} : F.data ? {
		status: "ready",
		models: F.data.models,
		baseUrl: F.data.base_url
	} : { status: "validating" } : { status: "idle" }, me = F.data?.models ?? de.data?.models ?? fe.data?.models ?? [], he = me.some((e) => e.id === S) ? S : S ?? "", ge = pe.status === "idle" ? e?.api_key_env ? "ready" : "idle" : pe.status, _e = c.isPending || l.isPending || u.isPending, ve = (e) => (t) => {
		re(""), e(t);
	}, ye = async () => {
		if (_e) return;
		if (!ie.trim()) {
			re("A name is required.");
			return;
		}
		if (!he.trim()) {
			re("A model is required.");
			return;
		}
		let t;
		try {
			t = Bd(A, {});
		} catch (e) {
			re(mr($(e)));
			return;
		}
		let n = E.trim() ? Number(E.trim()) : 0, i = w || null;
		if (!Number.isSafeInteger(n) || n < 0) {
			re("The compaction threshold must be a whole number, or 0 to disable it.");
			return;
		}
		if (te.mode === "dual" && !te.light) {
			re("Pick the light model before saving.");
			return;
		}
		let a = te.mode === "dual" ? te.light : null;
		try {
			if (e) {
				let o = {
					name: ie.trim(),
					backend: f,
					model: he.trim(),
					allow_insecure_http: v,
					reasoning_effort: i,
					extra_headers: t,
					orchestrator_compaction_threshold: n,
					initial_prompt: ee.trim() || null,
					light_model: a
				};
				b.trim() && (o.api_key = b.trim()), g.trim() && (o.base_url = g.trim());
				let c = await l.mutateAsync({
					configId: e.config_id,
					payload: o
				});
				r(c.config_id), s.success(`Configuration ${c.name} saved`);
			} else {
				let e = await c.mutateAsync({
					name: ie.trim(),
					backend: f,
					model: he.trim(),
					base_url: g.trim() || null,
					allow_insecure_http: v,
					api_key: ae ? b.trim() : null,
					reasoning_effort: i,
					extra_headers: t,
					orchestrator_compaction_threshold: n,
					initial_prompt: ee.trim() || null,
					light_model: a
				});
				r(e.config_id), s.success(`Configuration ${e.name} created`);
			}
		} catch (e) {
			re(Ku($(e), f));
		}
	}, be = async () => {
		if (e && !_e) try {
			await u.mutateAsync(e.config_id), i(), s.success(`Configuration ${e.name} removed`);
		} catch (e) {
			re(Ku($(e)));
		}
	}, xe = K(ye), Se = K(be);
	return ui(() => {
		xe.current = ye, Se.current = be;
	}), ui(() => {
		let t = c.isPending || l.isPending;
		return a(/* @__PURE__ */ X(J, { children: [
			e ? o ? /* @__PURE__ */ Y(gn, {
				variant: H.SecondaryDestructive,
				content: L.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: _e,
				loading: u.isPending,
				onClick: () => void Se.current(),
				children: /* @__PURE__ */ Y(B, { iconName: V.Trash })
			}) : /* @__PURE__ */ Y(I, {
				variant: H.SecondaryDestructive,
				size: z.Large,
				content: L.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: _e,
				loading: u.isPending,
				onClick: () => void Se.current(),
				children: /* @__PURE__ */ Y(B, { iconName: V.Trash })
			}) : null,
			o ? /* @__PURE__ */ Y(gn, {
				variant: H.Secondary,
				content: L.Text,
				onClick: n,
				children: "Cancel"
			}) : /* @__PURE__ */ Y(I, {
				variant: H.Ghost,
				size: z.Large,
				content: L.Text,
				onClick: n,
				children: "Cancel"
			}),
			o ? /* @__PURE__ */ Y(gn, {
				variant: H.Primary,
				content: L.Text,
				disabled: _e,
				loading: t,
				onClick: () => void xe.current(),
				children: "Save"
			}) : /* @__PURE__ */ Y(I, {
				variant: H.Primary,
				size: z.Large,
				content: L.Text,
				disabled: _e,
				loading: t,
				onClick: () => void xe.current(),
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
	]), /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: /* @__PURE__ */ X("div", {
			className: P("flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", o && "pb-[88px]"),
			children: [
				/* @__PURE__ */ X("div", {
					className: "flex flex-col md:rounded-[8px] md:bg-elevation-level-2 md:border md:border-muted md:p-3 gap-4 md:gap-2",
					children: [
						/* @__PURE__ */ Y($u, {
							label: "Model Provider",
							required: !0,
							hint: "Service that provides the models for this session.",
							control: /* @__PURE__ */ Y($d, {
								items: Gp,
								value: f,
								onValueChange: (e) => {
									ve(p)(e), x(""), C("");
								}
							})
						}),
						/* @__PURE__ */ Y($l, {}),
						/* @__PURE__ */ Y($u, {
							label: "Name",
							required: !0,
							hint: "How this setup is listed the next time a session is created.",
							verticalOnMobile: !0,
							control: /* @__PURE__ */ Y(Q, {
								inputSize: o ? Z.Large : Z.Medium,
								className: "w-full md:w-[280px]",
								"aria-label": "Configuration name",
								value: ie,
								onChange: (e) => ve(h)(e.target.value)
							})
						}),
						/* @__PURE__ */ Y($l, {}),
						ae ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y($u, {
							label: "API Key",
							required: !0,
							invalid: pe.status === "error",
							verticalOnMobile: !0,
							hint: e ? "Held by NAC for this configuration; type a new key to replace it." : "Stored in NAC under a generated name once the setup is saved.",
							control: /* @__PURE__ */ Y(Q, {
								inputSize: o ? Z.Large : Z.Medium,
								className: "w-full md:w-[280px]",
								type: "password",
								autoComplete: "off",
								placeholder: e?.api_key_env ? ef : "Paste the provider key",
								leadingSlot: /* @__PURE__ */ Y(yd, { status: ge }),
								validation: pe.status === "error",
								value: b,
								onChange: (e) => ve(x)(e.target.value)
							})
						}), /* @__PURE__ */ Y($l, {})] }) : null,
						/* @__PURE__ */ Y($u, {
							label: "Base URL",
							hint: "Endpoint the session sends its requests to; blank uses the provider's own.",
							control: /* @__PURE__ */ Y(Q, {
								inputSize: o ? Z.Large : Z.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "https://api.openai.com/v1",
								value: g,
								onChange: (e) => ve(_)(e.target.value)
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ Y($l, {}),
						/* @__PURE__ */ Y($u, {
							label: "Allow insecure HTTP",
							control: /* @__PURE__ */ X("div", {
								className: "w-full md:w-[280px] flex flex-col items-start gap-1",
								children: [/* @__PURE__ */ Y(iu, {
									"aria-label": "Allow insecure HTTP",
									checked: v,
									onChange: ve(y)
								}), /* @__PURE__ */ Y("p", {
									className: "body-small text-basic-secondary",
									children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
								})]
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ Y($l, {}),
						/* @__PURE__ */ Y($u, {
							label: "Default Model",
							required: !0,
							hint: "Sessions started from this setup begin with this default and may switch to another.",
							verticalOnMobile: !me.length,
							control: me.length ? /* @__PURE__ */ Y($d, {
								items: tf(me),
								value: he,
								onValueChange: ve(C),
								placeholder: "No models offered"
							}) : /* @__PURE__ */ Y(Q, {
								inputSize: o ? Z.Large : Z.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "gpt-5.5",
								value: S,
								onChange: (e) => ve(C)(e.target.value)
							})
						}),
						/* @__PURE__ */ Y($l, {}),
						/* @__PURE__ */ Y($u, {
							label: "Reasoning Effort",
							hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
							control: /* @__PURE__ */ Y($d, {
								items: se,
								value: w,
								onValueChange: ve(T)
							})
						}),
						/* @__PURE__ */ Y($l, {}),
						/* @__PURE__ */ Y($u, {
							label: "Context Limit",
							verticalOnMobile: !0,
							labelClassName: "max-w-none",
							hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
							control: /* @__PURE__ */ X("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ Y(Q, {
									inputSize: o ? Z.Large : Z.Medium,
									className: "w-full md:w-[105px]",
									inputClassName: "text-right",
									placeholder: ce,
									inputMode: "numeric",
									value: E,
									onChange: (e) => {
										re(""), k.current = !1, O.current = e.target.value, D(e.target.value);
									}
								}), /* @__PURE__ */ Y("span", {
									className: "shrink-0 text-micro text-basic-muted",
									children: "tokens"
								})]
							})
						}),
						/* @__PURE__ */ Y($l, {}),
						/* @__PURE__ */ Y(gf, {
							initial: e?.light_model ?? null,
							onChange: ne
						}),
						/* @__PURE__ */ Y($l, {}),
						/* @__PURE__ */ Y(el, {
							label: "Extra headers (JSON object)",
							hintText: "Blank sends none; header values must be strings.",
							placeholder: "{\"X-Title\": \"NAC\"}",
							value: A,
							onChange: (e) => ve(j)(e.target.value),
							textAreaClassName: "h-[108px] resize-none"
						}),
						/* @__PURE__ */ Y($l, {}),
						/* @__PURE__ */ Y(el, {
							label: "Initial prompt",
							hintText: "Pre-fills the first message of a session started from this setup.",
							placeholder: "Send a message",
							value: ee,
							onChange: (e) => ve(M)(e.target.value),
							textAreaClassName: "h-[92px] resize-none"
						})
					]
				}),
				/* @__PURE__ */ Y(Od, {
					backend: f,
					className: "mt-2"
				}),
				N ? /* @__PURE__ */ Y("p", {
					className: "label-micro text-error-primary pt-2",
					children: N
				}) : null,
				/* @__PURE__ */ Y("p", {
					className: "text-micro text-basic-muted pt-2",
					children: "* Required fields"
				})
			]
		})
	});
}
function Zp(e, t) {
	let n = new Set(t);
	for (let t = 1;; t += 1) {
		let r = `${e}-config-${t}`;
		if (!n.has(r)) return r;
	}
}
// src/app/components/modals/MCPServersModal/McpEntryDetails.tsx
function Qp({ entry: e }) {
	let [t, n] = q(!1);
	return /* @__PURE__ */ Y("div", {
		className: "flex items-center justify-center size-10 shrink-0 rounded-md bg-elevation-sublevel-variant-B overflow-hidden",
		children: e.icon_url && !t ? /* @__PURE__ */ Y("img", {
			src: e.icon_url,
			alt: "",
			className: "size-8 object-contain",
			loading: "lazy",
			onError: () => n(!0)
		}) : /* @__PURE__ */ Y("span", {
			className: "text-small text-basic-muted uppercase",
			children: e.name.charAt(0)
		})
	});
}
function $p({ entry: e }) {
	let [t, n] = q(!1), [r, i] = q(!1), a = K(null), o = e.description.replace(/\bDocs:\s*https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
	return ui(() => {
		let e = a.current;
		e && i(e.scrollHeight > e.clientHeight);
	}, [o]), /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-2 rounded-lg border border-muted p-3 bg-elevation-sublevel-variant-A",
		children: [/* @__PURE__ */ X("div", {
			className: "flex items-center gap-2 min-w-0",
			children: [
				/* @__PURE__ */ Y(Qp, { entry: e }),
				/* @__PURE__ */ X("div", {
					className: "flex flex-col min-w-0 flex-grow",
					children: [/* @__PURE__ */ X("div", {
						className: "flex items-center gap-2 min-w-0",
						children: [/* @__PURE__ */ Y("span", {
							className: "header-small text-basic-primary truncate",
							children: e.name
						}), e.auth === "required_header" ? /* @__PURE__ */ Y(Li, {
							text: "Key required",
							color: Fi.Yellow
						}) : null]
					}), /* @__PURE__ */ Y("span", {
						className: "tag-label text-basic-muted",
						children: e.category
					})]
				}),
				/* @__PURE__ */ X("a", {
					href: e.docs_url,
					target: "_blank",
					rel: "noopener noreferrer",
					className: "flex items-center gap-1 shrink-0 text-small text-info-primary hover:underline",
					children: [/* @__PURE__ */ Y(B, { iconName: V.BookOpen }), "Docs"]
				})
			]
		}), o ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y("span", {
			ref: a,
			className: P("text-small text-basic-muted", !t && "line-clamp-3"),
			children: o
		}), r || t ? /* @__PURE__ */ Y("button", {
			type: "button",
			className: "self-start text-small text-basic-primary hover:underline",
			onClick: () => n((e) => !e),
			children: t ? "Show less" : "Show more"
		}) : null] }) : null]
	});
}
// src/app/components/modals/ModalFooterButton.tsx
function em({ isMobile: e, variant: t, content: n, className: r, disabled: i, onClick: a, children: o, ariaLabel: s }) {
	return e ? /* @__PURE__ */ Y(gn, {
		variant: t,
		content: n ?? L.Text,
		className: r,
		disabled: i,
		"aria-label": s,
		onClick: a,
		children: o
	}) : /* @__PURE__ */ Y(I, {
		size: z.Large,
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
function tm({ onPick: e, onCustom: t, onClose: n, setFooter: r }) {
	let i = Le(), { data: a } = jr(), { data: o } = or(), [s, c] = q(""), [l, u] = q(null), d = G(() => {
		let e = [];
		for (let t of a?.entries ?? []) e.includes(t.category) || e.push(t.category);
		return e;
	}, [a]), f = G(() => {
		let e = /* @__PURE__ */ new Set(), t = /* @__PURE__ */ new Set();
		for (let n of o?.servers ?? []) n.library_id && e.add(n.library_id), t.add(n.name);
		return (n) => e.has(n.id) || t.has(n.name);
	}, [o]), p = G(() => {
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
	return ui(() => {
		if (n && r) return r(/* @__PURE__ */ Y(em, {
			isMobile: i,
			variant: H.Tertiary,
			onClick: n,
			children: "Close"
		})), () => r(null);
	}, [
		i,
		n,
		r
	]), /* @__PURE__ */ X("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: [/* @__PURE__ */ X("div", {
			className: "shrink-0 flex flex-col gap-2",
			children: [/* @__PURE__ */ X("div", {
				className: "flex items-center gap-2 px-4 pt-4",
				children: [/* @__PURE__ */ Y(Q, {
					className: "flex-1 min-w-0",
					inputSize: Z.Medium,
					leading: Vc.Icon,
					leadingIconName: V.Search,
					placeholder: "Search the library",
					value: s,
					onChange: (e) => c(e.target.value)
				}), /* @__PURE__ */ Y(I, {
					size: z.Medium,
					variant: H.Secondary,
					content: L.Text,
					className: "shrink-0",
					onClick: t,
					children: i ? "Custom" : "Custom server"
				})]
			}), d.length > 1 ? /* @__PURE__ */ Y("div", {
				className: "overflow-x-auto scrollbar-none [&>*]:shrink-0",
				children: /* @__PURE__ */ Y("div", {
					className: "flex gap-1.5 px-4 py-2",
					children: [null, ...d].map((e) => /* @__PURE__ */ Y(I, {
						size: i ? z.Medium : z.Small,
						variant: l === e ? H.Primary : H.Secondary,
						content: L.Text,
						"aria-pressed": l === e,
						onClick: () => u(e),
						className: i ? "!rounded-full" : "",
						children: e ?? "All"
					}, e ?? "all"))
				})
			}) : null]
		}), /* @__PURE__ */ Y("div", {
			className: P("flex-1 overflow-auto px-4 pb-4 flex flex-col gap-2 [&>*]:shrink-0", i && n && "pb-[88px]"),
			children: p.map((t) => /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-2 [&>*]:shrink-0",
				children: [t.category === null ? null : /* @__PURE__ */ Y("span", {
					className: "tag-label text-basic-muted pt-6 px-1",
					children: t.category
				}), t.entries.map((t) => {
					let n = f(t);
					return /* @__PURE__ */ X(Gl, {
						size: Hl.Large,
						disabled: n,
						className: P(n && "opacity-50", "!px-2"),
						onClick: () => e(t),
						children: [
							/* @__PURE__ */ Y(Qp, { entry: t }),
							/* @__PURE__ */ X("div", {
								className: "flex flex-col items-start text-left min-w-0 flex-grow py-1",
								children: [/* @__PURE__ */ X("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ Y("span", {
										className: "label-small text-basic-primary",
										children: t.name
									}), n ? /* @__PURE__ */ Y(Li, {
										text: "Added",
										color: Fi.Green
									}) : t.auth === "required_header" ? /* @__PURE__ */ Y(Li, {
										text: "Key required",
										color: Fi.Yellow
									}) : null]
								}), /* @__PURE__ */ Y("span", {
									className: "text-micro text-basic-muted truncate w-full",
									children: t.description
								})]
							}),
							n ? null : /* @__PURE__ */ Y(B, {
								iconName: V.Right,
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
var nm = 0;
function rm(e = "") {
	return nm += 1, {
		id: nm,
		value: e
	};
}
function im(e = []) {
	return e.map((e) => rm(e));
}
function am(e) {
	return e.map((e) => e.value.trim()).filter(Boolean);
}
// src/app/components/modals/MCPServersModal/McpArgsEditor.tsx
function om({ label: e, itemLabel: t, rows: n, onChange: r }) {
	let i = Le(), a = K(/* @__PURE__ */ new Map()), o = K(null), s = K(null);
	ui(() => {
		let e = s.current;
		e !== null && (s.current = null, e === "add" ? o.current?.querySelector("button")?.focus() : a.current.get(e)?.focus());
	});
	let c = () => {
		let e = rm();
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
		} : rm(t));
		s.current = u[u.length - 1].id, r([
			...n.slice(0, e),
			...u,
			...n.slice(e + 1)
		]);
	}, d = t.toLowerCase();
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ Y(Qu, { label: e }),
			/* @__PURE__ */ Y("p", {
				className: "label-small text-basic-tertiary",
				children: "Each field is one argument. Values are passed in this order."
			}),
			n.length === 0 ? /* @__PURE__ */ Y("p", {
				className: "label-small text-basic-tertiary",
				children: "No arguments."
			}) : null,
			n.map((e, o) => /* @__PURE__ */ X("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ Y(Q, {
					ref: (t) => {
						t ? a.current.set(e.id, t) : a.current.delete(e.id);
					},
					inputSize: i ? Z.Large : Z.Medium,
					className: "flex-1 min-w-0",
					inputClassName: "font-mono",
					"aria-label": `${t} ${o + 1}`,
					value: e.value,
					onPaste: (e) => u(o, e),
					onChange: (t) => r(n.map((n) => n.id === e.id ? {
						...n,
						value: t.target.value
					} : n))
				}), /* @__PURE__ */ Y(I, {
					size: i ? z.Large : z.Medium,
					variant: H.GhostDestructive,
					content: L.Icon,
					"aria-label": `Remove ${d} ${o + 1}`,
					onClick: () => l(o),
					children: /* @__PURE__ */ Y(B, { iconName: V.Trash })
				})]
			}, e.id)),
			/* @__PURE__ */ Y("div", {
				ref: o,
				className: "flex flex-col",
				children: /* @__PURE__ */ X(Gl, {
					type: "button",
					size: i ? Hl.Large : Hl.Medium,
					className: "!border !border-tertiary !border-dashed",
					onClick: c,
					children: [/* @__PURE__ */ Y(B, { iconName: V.Add }), "Add argument"]
				})
			})
		]
	});
}
// src/app/components/modals/MCPServersModal/McpKvEditor.tsx
function sm({ label: e, hint: t, keyPlaceholder: n, rows: r, onChange: i }) {
	let a = Le(), o = (e, t) => {
		i(r.map((n, r) => r === e ? {
			...n,
			...t
		} : n));
	};
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-4 md:gap-2",
		children: [
			/* @__PURE__ */ Y(Qu, {
				label: e,
				hint: t
			}),
			r.map((e, t) => /* @__PURE__ */ X("div", {
				className: "flex flex-col md:flex-row md:items-center gap-2 p-2 md:p-0 rounded-md bg-elevation-sublevel-variant-A shadow-convex md:shadow-none md:rounded-none md:bg-transparent",
				children: [
					/* @__PURE__ */ Y(Q, {
						inputSize: a ? Z.Large : Z.Medium,
						className: "flex-1 min-w-0",
						placeholder: n,
						value: e.key,
						onChange: (e) => o(t, { key: e.target.value })
					}),
					/* @__PURE__ */ Y(Q, {
						inputSize: a ? Z.Large : Z.Medium,
						className: "flex-1 min-w-0",
						placeholder: e.placeholder ?? "value",
						value: e.value,
						onChange: (e) => o(t, { value: e.target.value })
					}),
					/* @__PURE__ */ X(I, {
						size: z.Medium,
						variant: H.GhostDestructive,
						content: a ? L.IconLeft : L.Icon,
						"aria-label": "Remove entry",
						onClick: () => i(r.filter((e, n) => n !== t)),
						className: a ? "self-end" : "",
						children: [a ? "Remove" : null, /* @__PURE__ */ Y(B, { iconName: V.Trash })]
					})
				]
			}, t)),
			/* @__PURE__ */ X(Gl, {
				size: a ? Hl.Large : Hl.Medium,
				className: "!border !border-tertiary !border-dashed",
				onClick: () => i([...r, {
					key: "",
					value: ""
				}]),
				children: [/* @__PURE__ */ Y(B, { iconName: V.Add }), "Add entry"]
			})
		]
	});
}
// src/app/components/modals/MCPServersModal/McpOAuthPanel.tsx
function cm(e) {
	switch (e) {
		case "connected": return "Connected";
		case "connecting": return "Waiting for authorization";
		case "failed": return "Authorization failed";
		case "needs_authorization": return "Ready to connect";
		case "needs_configuration": return "Not configured";
		default: return "Checking…";
	}
}
var lm = "https://slack.com/help/articles/360003125231";
function um(e) {
	try {
		return e !== void 0 && new URL(e).hostname === "mcp.slack.com";
	} catch {
		return !1;
	}
}
function dm({ serverName: e, endpoint: t }) {
	let { api: r } = n(), i = Le(), [a, o] = q(null), [s, c] = q(null), [l, u] = q(!1), [d, f] = q(null), [p, m] = q(!1), [h, g] = q(""), [_, v] = q(""), [y, b] = q("pre_registered"), [x, S] = q(""), [C, w] = q("NAC MCP Client"), [T, E] = q("channels:history\nchat:write"), [D, O] = q(""), k = U(async (t = !1) => {
		try {
			let t = await r.getMcpOAuthStatus(e);
			o(t.status), c(t.message ?? null), f(t.authorization_url ?? null);
		} catch {
			t || o("failed"), c(t ? "OAuth status is temporarily unavailable. Retrying…" : "OAuth status is unavailable.");
		}
	}, [r, e]);
	W(() => {
		let e = window.setTimeout(() => void k(), 0);
		return () => window.clearTimeout(e);
	}, [k]), W(() => {
		if (a !== "connecting" && a !== "connected") return;
		let e = !1, t, n = async () => {
			await k(!0), e || (t = window.setTimeout(() => void n(), 1e3));
		};
		return t = window.setTimeout(() => void n(), 1e3), () => {
			e = !0, t !== void 0 && window.clearTimeout(t);
		};
	}, [k, a]);
	let A = async () => {
		if (y === "pre_registered" && !h.trim()) {
			c("A protected client ID credential name is required.");
			return;
		}
		if (y === "client_metadata" && !x.trim()) {
			c("A client metadata document URL is required.");
			return;
		}
		let t;
		try {
			t = D.trim() ? JSON.parse(D) : void 0;
		} catch {
			c("The authorization metadata override must be valid JSON.");
			return;
		}
		let n = y === "pre_registered" ? {
			type: "pre_registered",
			client_id_credential: h.trim(),
			client_secret_credential: _.trim() || void 0
		} : y === "client_metadata" ? {
			type: "client_metadata",
			url: x.trim()
		} : {
			type: "dynamic",
			client_name: C.trim() || void 0
		};
		u(!0), c(null);
		try {
			let i = await r.configureMcpOAuth(e, {
				registration: n,
				scopes: T.split("\n").map((e) => e.trim()).filter(Boolean),
				authorization_metadata: t
			});
			o(i.status), f(i.authorization_url ?? null), m(!1), g(""), v("");
		} catch {
			c("OAuth configuration was rejected. Check the protected credential names.");
		} finally {
			u(!1);
		}
	}, j = async () => {
		u(!0), c(null), f(null);
		try {
			let t = await r.authenticateMcpOAuth(e);
			o(t.status), f(t.authorization_url);
		} catch {
			o("failed"), c("OAuth authentication could not start.");
		} finally {
			u(!1);
		}
	}, ee = async () => {
		u(!0), c(null), f(null);
		try {
			let t = await r.logoutMcpOAuth(e);
			o(t.status);
		} catch {
			c("OAuth logout could not complete.");
		} finally {
			u(!1);
		}
	};
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-3 p-4 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
		children: [
			/* @__PURE__ */ X("div", {
				className: "flex items-center justify-between gap-3",
				children: [/* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("div", {
					className: "text-medium text-basic-primary",
					children: "OAuth"
				}), /* @__PURE__ */ Y("div", {
					className: "text-small text-basic-muted",
					children: "Authorization Code with PKCE. Tokens and callback state stay in protected local storage."
				})] }), /* @__PURE__ */ Y("span", {
					className: "text-small text-basic-muted",
					children: cm(a)
				})]
			}),
			a === "needs_configuration" || p ? /* @__PURE__ */ X(J, { children: [
				/* @__PURE__ */ X("div", {
					className: "grid md:grid-cols-2 gap-3",
					children: [
						/* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ Y(Qu, {
								label: "Client registration",
								required: !0
							}), /* @__PURE__ */ X("select", {
								className: "h-10 rounded-md border border-border-subtle bg-elevation-surface px-3 text-small text-basic-primary",
								value: y,
								onChange: (e) => b(e.target.value),
								children: [
									/* @__PURE__ */ Y("option", {
										value: "pre_registered",
										children: "Pre-registered client"
									}),
									/* @__PURE__ */ Y("option", {
										value: "client_metadata",
										children: "Client metadata document (SEP-991)"
									}),
									/* @__PURE__ */ Y("option", {
										value: "dynamic",
										children: "Dynamic client registration"
									})
								]
							})]
						}),
						y === "pre_registered" ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ Y(Qu, {
								label: "Client ID credential",
								required: !0
							}), /* @__PURE__ */ Y(Q, {
								inputSize: i ? Z.Large : Z.Medium,
								value: h,
								placeholder: "SLACK_MCP_CLIENT_ID",
								onChange: (e) => g(e.target.value)
							})]
						}), /* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ Y(Qu, {
								label: "Client secret credential",
								hint: "Optional for public clients."
							}), /* @__PURE__ */ Y(Q, {
								inputSize: i ? Z.Large : Z.Medium,
								value: _,
								placeholder: "SLACK_MCP_CLIENT_SECRET",
								onChange: (e) => v(e.target.value)
							})]
						})] }) : null,
						y === "client_metadata" ? /* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ Y(Qu, {
								label: "Client metadata URL",
								required: !0
							}), /* @__PURE__ */ Y(Q, {
								inputSize: i ? Z.Large : Z.Medium,
								value: x,
								placeholder: "https://nac.example.com/.well-known/oauth-client.json",
								onChange: (e) => S(e.target.value)
							})]
						}) : null,
						y === "dynamic" ? /* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ Y(Qu, {
								label: "Client name",
								hint: "Sent to the authorization server."
							}), /* @__PURE__ */ Y(Q, {
								inputSize: i ? Z.Large : Z.Medium,
								value: C,
								onChange: (e) => w(e.target.value)
							})]
						}) : null
					]
				}),
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ Y(Qu, {
						label: "Scopes",
						hint: "One scope per line."
					}), /* @__PURE__ */ Y(el, {
						textAreaClassName: "min-h-[64px] font-mono text-small",
						value: T,
						onChange: (e) => E(e.target.value)
					})]
				}),
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ Y(Qu, {
						label: "Authorization metadata override",
						hint: "Optional JSON for servers without discovery metadata."
					}), /* @__PURE__ */ Y(el, {
						textAreaClassName: "min-h-[72px] font-mono text-small",
						value: D,
						placeholder: y === "client_metadata" ? "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\",\"client_id_metadata_document_supported\":true}" : "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\"}",
						onChange: (e) => O(e.target.value)
					})]
				}),
				/* @__PURE__ */ Y("div", {
					className: "flex justify-end",
					children: /* @__PURE__ */ Y(I, {
						size: z.Medium,
						variant: H.Secondary,
						content: L.Text,
						disabled: l,
						onClick: () => void A(),
						children: "Configure OAuth"
					})
				})
			] }) : null,
			a && a !== "needs_configuration" && a !== "connecting" && !p ? /* @__PURE__ */ Y("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ Y(I, {
					size: z.Medium,
					variant: H.Ghost,
					content: L.Text,
					disabled: l,
					onClick: () => m(!0),
					children: "Edit OAuth configuration"
				})
			}) : null,
			a === "needs_authorization" || a === "failed" ? /* @__PURE__ */ Y("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ Y(I, {
					size: z.Medium,
					variant: H.Secondary,
					content: L.Text,
					disabled: l,
					onClick: () => void j(),
					children: "Authenticate"
				})
			}) : null,
			d ? /* @__PURE__ */ Y("a", {
				className: "text-small text-accent-primary underline self-end",
				href: d,
				target: "_blank",
				rel: "noreferrer",
				children: "Continue OAuth authorization"
			}) : null,
			a === "connected" ? /* @__PURE__ */ X("div", {
				className: "text-small text-basic-muted",
				children: [
					"Log out deletes the tokens NAC saved on this computer, and sessions stop sending requests to this server until you authenticate again. It does not revoke NAC's access at the provider.",
					" ",
					um(t) ? /* @__PURE__ */ Y("a", {
						className: "text-accent-primary underline",
						href: lm,
						target: "_blank",
						rel: "noreferrer",
						children: "Revoke it in Slack"
					}) : "To revoke it, remove NAC's access in the provider's connected-app settings."
				]
			}) : null,
			a === "connected" || a === "connecting" ? /* @__PURE__ */ Y("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ Y(I, {
					size: z.Medium,
					variant: H.SecondaryDestructive,
					content: L.Text,
					disabled: l,
					onClick: () => void ee(),
					children: a === "connected" ? "Log out" : "Cancel authorization"
				})
			}) : null,
			s ? /* @__PURE__ */ Y("div", {
				className: "text-small text-error-primary",
				children: s
			}) : null
		]
	});
}
// src/app/lib/mcpKvRows.ts
function fm(e) {
	return Object.entries(e).map(([e, t]) => ({
		key: e,
		value: "",
		storedKey: e,
		placeholder: t
	}));
}
function pm(e) {
	let t = {};
	for (let n of e) {
		let e = n.key.trim();
		e && (n.value ? t[e] = n.value : n.storedKey && (t[e] = null));
	}
	return t;
}
function mm(e) {
	let t = {};
	for (let [n, r] of Object.entries(e)) r !== null && (t[n] = r);
	return t;
}
// src/app/components/modals/MCPServersModal/McpServerForm.tsx
var hm = [{
	id: "streamable_http",
	label: "Streamable HTTP"
}, {
	id: "stdio",
	label: "Stdio"
}], gm = [
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
function _m(e) {
	return e.split("\n").map((e) => e.trim()).filter(Boolean);
}
function vm(e) {
	return e === "stdio" || e === "streamable_http" ? e : "streamable_http";
}
function ym(e) {
	return e.trim() ? Number(e) : null;
}
function bm({ record: e, template: t, libraryEntry: n, onBack: r, onClose: i, onSaved: a, onDeleted: o, setFooter: s }) {
	let c = Le(), l = Cn(), u = Tn(), d = Br(), f = xr(), p = g(), m = un(), h = en(), [_, v] = q(e?.name ?? t?.name ?? ""), [y, b] = q(e?.enabled ?? !0), [x, S] = q(e?.required ?? !1), [C, w] = q(e?.protocol ?? "legacy"), [T, E] = q(() => vm(e?.transport ?? t?.transport)), [D, O] = q(e?.url ?? t?.url ?? ""), [k, A] = q(e?.command ?? ""), [j, ee] = q(() => im(e?.args)), [M, te] = q(e?.cwd ?? ""), [ne, N] = q(e?.env_vars.join("\n") ?? ""), [re, ie] = q(e?.startup_timeout_ms?.toString() ?? ""), [ae, oe] = q(e?.catalog_timeout_ms?.toString() ?? ""), [se, ce] = q(e?.execution_timeout_ms?.toString() ?? ""), [le, ue] = q(() => e ? fm(e.headers) : t?.auth_header ? [{
		key: t.auth_header,
		value: "",
		placeholder: t.auth_hint ?? void 0
	}] : []), [F, de] = q(e ? fm(e.env) : []), [fe, pe] = q(() => Object.entries(e?.env_headers ?? {}).map(([e, t]) => ({
		key: e,
		value: t
	}))), [me, he] = q(e?.bearer_token_env_var ?? ""), [ge, _e] = q(e?.header_helper?.command ?? ""), [ve, ye] = q(() => im(e?.header_helper?.args)), [be, xe] = q(e?.header_helper?.cwd ?? ""), [Se, Ce] = q(() => e?.header_helper ? fm(e.header_helper.env ?? {}) : []), [we, Te] = q(e?.header_helper?.env_vars?.join("\n") ?? ""), [Ee, De] = q(e?.header_helper?.timeout_ms?.toString() ?? ""), [Oe, ke] = q(null), Ae = m.data?.servers.find((t) => t.name === e?.name), je = u.isPending || d.isPending || f.isPending || p.isPending || h.isPending, Me = () => _.trim() ? T === "streamable_http" && !D.trim() ? "A URL is required." : T === "stdio" && !k.trim() ? "A command is required." : null : "A name is required.", Ne = async () => {
		let n = Me();
		if (n) {
			l.error(n);
			return;
		}
		let r = pm(le), i = pm(F), o = ge.trim() ? {
			command: ge.trim(),
			args: am(ve),
			cwd: be.trim() || null,
			env: pm(Se),
			env_vars: _m(we),
			timeout_ms: ym(Ee)
		} : null;
		try {
			e ? (a((await d.mutateAsync({
				serverName: e.name,
				payload: {
					name: _.trim(),
					enabled: y,
					required: x,
					startup_timeout_ms: ym(re),
					catalog_timeout_ms: ym(ae),
					execution_timeout_ms: ym(se),
					protocol: C,
					transport: T,
					command: T === "stdio" ? k.trim() : null,
					args: T === "stdio" ? am(j) : [],
					env: T === "stdio" ? i : {},
					env_vars: T === "stdio" ? _m(ne) : [],
					cwd: T === "stdio" && M.trim() || null,
					url: T === "streamable_http" ? D.trim() : null,
					headers: T === "streamable_http" ? r : {},
					env_headers: T === "streamable_http" ? mm(pm(fe)) : {},
					bearer_token_env_var: T === "streamable_http" && me.trim() || null,
					header_helper: T === "streamable_http" ? o : null
				}
			})).name), l.success("MCP server updated.")) : (a((await u.mutateAsync({
				name: _.trim(),
				enabled: y,
				required: x,
				startup_timeout_ms: ym(re),
				catalog_timeout_ms: ym(ae),
				execution_timeout_ms: ym(se),
				protocol: C,
				transport: T,
				command: T === "stdio" ? k.trim() : null,
				args: T === "stdio" ? am(j) : [],
				env: T === "stdio" ? mm(i) : {},
				env_vars: T === "stdio" ? _m(ne) : [],
				cwd: T === "stdio" && M.trim() || null,
				url: T === "streamable_http" ? D.trim() : null,
				headers: T === "streamable_http" ? mm(r) : {},
				env_headers: T === "streamable_http" ? mm(pm(fe)) : {},
				bearer_token_env_var: T === "streamable_http" && me.trim() || null,
				header_helper: T === "streamable_http" && o ? {
					...o,
					env: mm(o.env)
				} : null,
				library_id: t?.id ?? null
			})).name), l.success("MCP server saved."));
		} catch (e) {
			l.error(`Save failed: ${mr($(e))}`);
		}
	}, Pe = async () => {
		if (e) try {
			await f.mutateAsync(e.name), o(), l.success("MCP server deleted.");
		} catch (e) {
			l.error(`Delete failed: ${mr($(e))}`);
		}
	}, Fe = async (t) => {
		if (e) try {
			let n = await h.mutateAsync({
				serverName: e.name,
				action: t
			});
			n.state === "failed" ? l.error(n.error ?? "MCP runtime operation failed.") : l.success(`MCP server is ${n.state}.`);
		} catch (e) {
			l.error(`Runtime operation failed: ${mr($(e))}`);
		}
	}, Ie = async () => {
		let t = T === "streamable_http" && !D.trim() ? "A URL is required to test." : T === "stdio" && !k.trim() ? "A command is required to test." : null;
		if (t) l.error(t);
		else {
			ke(null);
			try {
				let t = await p.mutateAsync({
					stored_name: e?.name ?? null,
					name: _.trim() || null,
					transport: T,
					command: T === "stdio" ? k.trim() : null,
					args: T === "stdio" ? am(j) : [],
					env: T === "stdio" ? pm(F) : {},
					env_vars: T === "stdio" ? _m(ne) : [],
					cwd: T === "stdio" && M.trim() || null,
					url: T === "streamable_http" ? D.trim() : null,
					headers: T === "streamable_http" ? pm(le) : {},
					env_headers: T === "streamable_http" ? mm(pm(fe)) : {},
					bearer_token_env_var: T === "streamable_http" && me.trim() || null,
					header_helper: T === "streamable_http" && ge.trim() ? {
						command: ge.trim(),
						args: am(ve),
						cwd: be.trim() || null,
						env: pm(Se),
						env_vars: _m(we),
						timeout_ms: ym(Ee)
					} : null,
					startup_timeout_ms: ym(re),
					catalog_timeout_ms: ym(ae),
					execution_timeout_ms: ym(se),
					protocol: C
				});
				if (!t.connected) {
					l.error(`Test failed: ${t.error ?? "connection failed"}`);
					return;
				}
				ke(t.tools), l.success(`Connection succeeded: ${t.tools.length} tool${t.tools.length === 1 ? "" : "s"} found.`);
			} catch (e) {
				l.error(`Test failed: ${mr($(e))}`);
			}
		}
	}, Re = K(Ne), ze = K(Pe), Be = K(i);
	return ui(() => {
		Re.current = Ne, ze.current = Pe, Be.current = i;
	}), ui(() => (s(/* @__PURE__ */ X(J, { children: [
		e ? /* @__PURE__ */ Y(em, {
			isMobile: c,
			variant: H.SecondaryDestructive,
			content: L.Icon,
			className: "mr-auto",
			ariaLabel: "Delete server",
			disabled: je,
			onClick: () => void ze.current(),
			children: /* @__PURE__ */ Y(B, { iconName: V.Trash })
		}) : null,
		/* @__PURE__ */ Y(em, {
			isMobile: c,
			variant: H.Tertiary,
			onClick: () => Be.current(),
			children: "Cancel"
		}),
		/* @__PURE__ */ Y(em, {
			isMobile: c,
			variant: H.Primary,
			disabled: je,
			onClick: () => void Re.current(),
			children: "Save"
		})
	] })), () => s(null)), [
		c,
		je,
		e,
		s
	]), /* @__PURE__ */ X("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: [r ? /* @__PURE__ */ X("div", {
			className: "flex items-center gap-1 shrink-0 border-b border-muted px-2 py-2",
			children: [/* @__PURE__ */ Y(I, {
				size: z.Medium,
				variant: H.Ghost,
				content: L.Icon,
				"aria-label": "Back to library",
				onClick: r,
				children: /* @__PURE__ */ Y(B, { iconName: V.Left })
			}), /* @__PURE__ */ Y("span", {
				className: "text-medium text-basic-primary truncate",
				children: _.trim() || "Custom server"
			})]
		}) : null, /* @__PURE__ */ X("div", {
			className: P("flex-1 overflow-auto p-4 flex flex-col gap-4 [&>*]:shrink-0", c && "pb-[88px]"),
			children: [
				n ? /* @__PURE__ */ Y($p, { entry: n }) : null,
				/* @__PURE__ */ X("div", {
					className: "flex flex-col md:flex-row gap-4",
					children: [/* @__PURE__ */ X("div", {
						className: "flex flex-col gap-1 flex-grow",
						children: [/* @__PURE__ */ Y(Qu, {
							label: "Name",
							required: !0
						}), /* @__PURE__ */ Y(Q, {
							inputSize: c ? Z.Large : Z.Medium,
							placeholder: "my_server",
							value: _,
							onChange: (e) => v(e.target.value)
						})]
					}), /* @__PURE__ */ Y("div", {
						className: "md:pt-6",
						children: /* @__PURE__ */ X("div", {
							className: "flex gap-4 items-center px-4 py-2 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
							children: [
								/* @__PURE__ */ Y(Qu, {
									label: "Enabled",
									hint: "Disabled servers are kept but not connected when a session starts."
								}),
								/* @__PURE__ */ Y(iu, {
									checked: y,
									size: c ? eu.Large : eu.Medium,
									onChange: b
								}),
								/* @__PURE__ */ Y(Qu, {
									label: "Required",
									hint: "Fail session admission when this enabled server cannot start."
								}),
								/* @__PURE__ */ Y(iu, {
									checked: x,
									size: c ? eu.Large : eu.Medium,
									onChange: S
								})
							]
						})
					})]
				}),
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-4 p-4 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
					children: [
						/* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ Y(Qu, { label: "Transport" }), /* @__PURE__ */ Y("div", {
								className: "flex gap-2",
								children: hm.map((e) => /* @__PURE__ */ Y(I, {
									size: c ? z.Medium : z.Small,
									variant: T === e.id ? H.Primary : H.Secondary,
									content: L.Text,
									"aria-pressed": T === e.id,
									onClick: () => E(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						/* @__PURE__ */ X("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ Y(Qu, {
								label: "Protocol",
								hint: gm.find((e) => e.id === C)?.hint
							}), /* @__PURE__ */ Y("div", {
								className: "flex flex-wrap gap-2",
								children: gm.map((e) => /* @__PURE__ */ Y(I, {
									size: c ? z.Medium : z.Small,
									variant: C === e.id ? H.Primary : H.Secondary,
									content: L.Text,
									"aria-pressed": C === e.id,
									onClick: () => w(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						T === "streamable_http" ? /* @__PURE__ */ X(J, { children: [
							/* @__PURE__ */ X("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ Y(Qu, {
									label: "URL",
									required: !0
								}), /* @__PURE__ */ Y(Q, {
									inputSize: c ? Z.Large : Z.Medium,
									placeholder: "https://example.com/mcp",
									value: D,
									onChange: (e) => O(e.target.value)
								})]
							}),
							/* @__PURE__ */ Y(sm, {
								label: "Headers",
								hint: "Sent with every request. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "Authorization",
								rows: le,
								onChange: ue
							}),
							/* @__PURE__ */ X("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ Y(Qu, {
									label: "Bearer token environment variable",
									hint: "The variable value is sent as a Bearer token without persisting it."
								}), /* @__PURE__ */ Y(Q, {
									inputSize: c ? Z.Large : Z.Medium,
									placeholder: "MCP_TOKEN",
									value: me,
									onChange: (e) => he(e.target.value)
								})]
							}),
							/* @__PURE__ */ Y(sm, {
								label: "Environment-backed headers",
								hint: "Map each HTTP header name to the environment variable that supplies its value.",
								keyPlaceholder: "X-API-Key",
								rows: fe,
								onChange: pe
							}),
							/* @__PURE__ */ X("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ Y(Qu, {
									label: "Header helper command",
									hint: "Optional bounded command that prints a JSON object of same-origin request headers."
								}), /* @__PURE__ */ Y(Q, {
									inputSize: c ? Z.Large : Z.Medium,
									placeholder: "./refresh-mcp-headers",
									value: ge,
									onChange: (e) => _e(e.target.value)
								})]
							}),
							ge.trim() ? /* @__PURE__ */ X(J, { children: [
								/* @__PURE__ */ Y(om, {
									label: "Header helper arguments",
									itemLabel: "Header helper argument",
									rows: ve,
									onChange: ye
								}),
								/* @__PURE__ */ X("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ Y(Qu, { label: "Header helper working directory" }), /* @__PURE__ */ Y(Q, {
										inputSize: c ? Z.Large : Z.Medium,
										value: be,
										onChange: (e) => xe(e.target.value)
									})]
								}),
								/* @__PURE__ */ Y(sm, {
									label: "Header helper environment",
									hint: "Stored literals remain write-only.",
									keyPlaceholder: "TOKEN",
									rows: Se,
									onChange: Ce
								}),
								/* @__PURE__ */ X("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ Y(Qu, {
										label: "Header helper forwarded environment",
										hint: "One variable name per line."
									}), /* @__PURE__ */ Y(el, {
										textAreaClassName: "min-h-[64px] font-mono",
										value: we,
										onChange: (e) => Te(e.target.value)
									})]
								}),
								/* @__PURE__ */ X("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ Y(Qu, { label: "Header helper timeout (ms)" }), /* @__PURE__ */ Y(Q, {
										inputSize: c ? Z.Large : Z.Medium,
										type: "number",
										min: 100,
										max: 6e5,
										value: Ee,
										onChange: (e) => De(e.target.value)
									})]
								})
							] }) : null
						] }) : /* @__PURE__ */ X(J, { children: [
							/* @__PURE__ */ X("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ Y(Qu, {
									label: "Command",
									required: !0
								}), /* @__PURE__ */ Y(Q, {
									inputSize: c ? Z.Large : Z.Medium,
									placeholder: "npx",
									value: k,
									onChange: (e) => A(e.target.value)
								})]
							}),
							/* @__PURE__ */ Y(om, {
								label: "Arguments",
								itemLabel: "Argument",
								rows: j,
								onChange: ee
							}),
							/* @__PURE__ */ Y(sm, {
								label: "Environment",
								hint: "Set for the server process. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "API_KEY",
								rows: F,
								onChange: de
							}),
							/* @__PURE__ */ X("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ Y(Qu, {
									label: "Working directory",
									hint: "Relative paths resolve from the workspace."
								}), /* @__PURE__ */ Y(Q, {
									inputSize: c ? Z.Large : Z.Medium,
									placeholder: "packages/server",
									value: M,
									onChange: (e) => te(e.target.value)
								})]
							}),
							/* @__PURE__ */ X("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ Y(Qu, {
									label: "Forward environment variables",
									hint: "One existing host variable name per line."
								}), /* @__PURE__ */ Y(el, {
									textAreaClassName: "min-h-[64px] font-mono",
									value: ne,
									onChange: (e) => N(e.target.value)
								})]
							})
						] }),
						/* @__PURE__ */ Y("div", {
							className: "grid grid-cols-1 md:grid-cols-3 gap-3",
							children: [
								[
									"Startup timeout (ms)",
									re,
									ie
								],
								[
									"Catalog timeout (ms)",
									ae,
									oe
								],
								[
									"Execution timeout (ms)",
									se,
									ce
								]
							].map(([e, t, n]) => /* @__PURE__ */ X("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ Y(Qu, { label: e }), /* @__PURE__ */ Y(Q, {
									inputSize: c ? Z.Large : Z.Medium,
									type: "number",
									min: 100,
									max: 6e5,
									value: t,
									onChange: (e) => n(e.target.value)
								})]
							}, e))
						}),
						e ? /* @__PURE__ */ X("div", {
							className: "flex flex-wrap items-center gap-2",
							children: [/* @__PURE__ */ X("span", {
								className: "text-small text-basic-muted",
								children: [Ae?.sessions_blocked ? "Disconnected. Sessions won't use this server until you connect it." : `Runtime: ${Ae?.state ?? "disconnected"}`, Ae?.error ? ` — ${Ae.error}` : ""]
							}), [
								"connect",
								"disconnect",
								"reload"
							].map((e) => /* @__PURE__ */ Y(I, {
								size: z.Small,
								variant: H.Secondary,
								disabled: je,
								onClick: () => void Fe(e),
								children: e[0].toUpperCase() + e.slice(1)
							}, e))]
						}) : null,
						/* @__PURE__ */ X("div", {
							className: "flex items-center gap-2 justify-end",
							children: [/* @__PURE__ */ X(I, {
								size: z.Medium,
								variant: H.Secondary,
								disabled: je,
								onClick: () => void Ie(),
								content: L.IconLeft,
								children: [/* @__PURE__ */ Y(B, { iconName: V.Bolt }), p.isPending ? "Testing…" : "Test connection"]
							}), Oe ? /* @__PURE__ */ X("span", {
								className: "text-small text-basic-muted",
								children: [
									Oe.length,
									" tool",
									Oe.length === 1 ? "" : "s",
									" found"
								]
							}) : null]
						})
					]
				}),
				e && T === "streamable_http" ? /* @__PURE__ */ Y(dm, {
					serverName: e.name,
					endpoint: e.url ?? void 0
				}) : null,
				Oe && Oe.length ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: Oe.map((e) => /* @__PURE__ */ X("div", {
						className: "flex items-baseline gap-2 min-w-0",
						children: [/* @__PURE__ */ Y("span", {
							className: "code code-small text-basic-primary shrink-0",
							children: e.name
						}), e.description ? /* @__PURE__ */ Y("span", {
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
function xm({ error: e, retrying: t, onRetry: n }) {
	let r = e instanceof Error ? e.message : "The MCP configuration could not be read.";
	return /* @__PURE__ */ X("div", {
		className: "flex h-full min-h-0 flex-col items-start justify-center gap-3 overflow-auto p-6",
		children: [
			/* @__PURE__ */ Y("div", {
				className: "label-small text-error-primary",
				children: "MCP servers could not be loaded."
			}),
			/* @__PURE__ */ Y("p", {
				className: "max-w-full whitespace-pre-wrap break-words text-micro text-basic-secondary",
				children: r
			}),
			/* @__PURE__ */ Y(I, {
				variant: H.Secondary,
				size: z.Small,
				content: L.Text,
				loading: t,
				onClick: n,
				children: "Try again"
			})
		]
	});
}
// src/app/components/modals/MCPServersModal/McpServersMobile.tsx
function Sm({ open: e, onClose: t }) {
	let { data: n } = jr(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = or(), l = r?.servers ?? [], [u, d] = q(!1), [p, m] = q(null), [h, g] = q(null), [_, v] = q(null), y = l.find((e) => e.name === h) ?? null, b = p?.template ?? null, x = b ?? (y ? n?.entries.find((e) => e.id === y.library_id || e.name === y.name) ?? null : null), S = () => {
		m(null), g(null), d(!1);
	}, C = () => {
		m(null), g(null);
	};
	return /* @__PURE__ */ X(J, { children: [
		/* @__PURE__ */ Y(tn, {
			open: e,
			onClose: t,
			title: "MCP servers",
			children: a ? /* @__PURE__ */ Y(xm, {
				error: i,
				retrying: o,
				onRetry: () => {
					c();
				}
			}) : /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-1 [&>*]:shrink-0",
				children: [
					/* @__PURE__ */ X(Gl, {
						size: Hl.Large,
						onClick: () => d(!0),
						children: [
							/* @__PURE__ */ Y(B, { iconName: V.Add }),
							/* @__PURE__ */ Y("span", {
								className: "text-left flex-grow truncate",
								children: "Add server"
							}),
							/* @__PURE__ */ Y(B, {
								iconName: V.Right,
								className: "shrink-0"
							})
						]
					}),
					l.length ? /* @__PURE__ */ Y($l, {}) : null,
					l.map((e) => /* @__PURE__ */ X(Gl, {
						size: Hl.Large,
						onClick: () => g(e.name),
						children: [/* @__PURE__ */ Y("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						}), /* @__PURE__ */ Y(B, {
							iconName: V.Right,
							className: "shrink-0"
						})]
					}, e.name)),
					s ? /* @__PURE__ */ X("div", {
						className: "flex items-center gap-2 px-2 py-1",
						children: [/* @__PURE__ */ Y(f, { size: mt.XSmall }), /* @__PURE__ */ Y("span", {
							className: "text-micro text-basic-muted",
							children: "Loading…"
						})]
					}) : null
				]
			})
		}),
		/* @__PURE__ */ Y(tn, {
			open: u,
			onClose: () => d(!1),
			title: "Add server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			children: /* @__PURE__ */ Y(tm, {
				onPick: (e) => m({ template: e }),
				onCustom: () => m({ template: null })
			})
		}),
		/* @__PURE__ */ Y(tn, {
			open: p !== null || h !== null,
			onClose: C,
			title: y?.name ?? b?.name ?? "Custom server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			footer: _,
			children: /* @__PURE__ */ Y(bm, {
				record: y,
				template: b,
				libraryEntry: x,
				onClose: C,
				onSaved: S,
				onDeleted: S,
				setFooter: v
			}, y?.name ?? b?.id ?? "custom")
		})
	] });
}
// src/app/components/modals/MCPServersModal/McpServersModal.tsx
var Cm = "__new__";
function wm({ open: e, onClose: t }) {
	let n = Xd(e), r = Le();
	return n ? Y(r ? Sm : Tm, {
		open: e,
		onClose: t
	}) : null;
}
function Tm({ open: e, onClose: t }) {
	let { data: n } = jr(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = or(), l = G(() => r?.servers ?? [], [r]), [u, d] = q(null), [f, p] = q(null), [m, h] = q(!1), [g, _] = q(null), v = u ?? l.at(-1)?.name ?? Cm, y = l.find((e) => e.name === v) ?? null, b = v === Cm, x = (e) => {
		d(e), p(null), h(!1);
	}, S = f ?? (y ? n?.entries.find((e) => e.id === y.library_id || e.name === y.name) ?? null : null);
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: t,
		title: "MCP servers",
		size: dn.Large,
		flush: !0,
		className: "md:h-[740px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: g,
		children: a ? /* @__PURE__ */ Y(xm, {
			error: i,
			retrying: o,
			onRetry: () => {
				c();
			}
		}) : /* @__PURE__ */ X("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ Y(Wp, {
				draftLabel: "Add server",
				draftSelected: b,
				onSelectDraft: () => x(Cm),
				entries: l.map((e) => ({
					id: e.name,
					name: e.name
				})),
				selectedId: v,
				onSelect: x,
				isLoading: s
			}), b && !f && !m ? /* @__PURE__ */ Y(tm, {
				onPick: (e) => p(e),
				onCustom: () => h(!0),
				onClose: t,
				setFooter: _
			}) : /* @__PURE__ */ Y(bm, {
				record: y,
				template: f,
				libraryEntry: S,
				onBack: () => {
					d(Cm), p(null), h(!1);
				},
				onClose: t,
				onSaved: x,
				onDeleted: () => x(Cm),
				setFooter: _
			}, y ? y.name : f?.id ?? "custom")]
		})
	});
}
// src/app/components/modals/SshConfigsModal.tsx
var Em = "__new__";
function Dm(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function Om({ open: e, onClose: t }) {
	return Xd(e) ? /* @__PURE__ */ Y(km, {
		open: e,
		onClose: t
	}) : null;
}
function km({ open: e, onClose: t }) {
	let n = Le(), { data: r, isLoading: i } = Gr(), a = G(() => r?.configurations ?? [], [r]), [o, s] = q(null), [c, l] = q(null), u = o ?? a.at(-1)?.config_id ?? Em, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: t,
		title: "SSH configs",
		size: dn.Large,
		flush: !0,
		className: "max-w-[780px] md:h-[480px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: c,
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ Y(Wp, {
				draftLabel: "Create New",
				draftSelected: u === Em,
				onSelectDraft: () => s(Em),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: s,
				isLoading: i
			}), /* @__PURE__ */ Y(Am, {
				record: d,
				defaultName: Dm(a),
				onClose: t,
				onSaved: s,
				onDeleted: () => s(Em),
				setFooter: l,
				isMobile: n
			}, u)]
		})
	});
}
function Am({ record: e, defaultName: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: o }) {
	let s = Cn(), c = tr(), l = E(), u = Bn(), d = $e(), [f, p] = q(e?.name ?? t), [m, h] = q(e?.ssh_host ?? ""), [g, _] = q(e?.ssh_port ? String(e.ssh_port) : ""), [v, y] = q(e?.ssh_identity_file ?? ""), b = c.isPending || l.isPending || u.isPending || d.isPending, x = async () => {
		let t = f.trim(), n = m.trim();
		if (!t || !n) {
			s.error("Name and SSH host are required.");
			return;
		}
		let i = g.trim() ? Number(g.trim()) : null;
		if (g.trim() && (!Number.isInteger(i) || (i ?? 0) < 1 || (i ?? 0) > 65535)) s.error("Port must be an integer between 1 and 65535.");
		else try {
			e ? (await l.mutateAsync({
				configId: e.config_id,
				payload: {
					name: t,
					ssh_host: n,
					ssh_port: i,
					ssh_identity_file: v.trim() || null
				}
			}), s.success("SSH config updated.")) : (r((await c.mutateAsync({
				name: t,
				ssh_host: n,
				ssh_port: i,
				ssh_identity_file: v.trim() || null
			})).config_id), s.success("SSH config saved."));
		} catch (e) {
			s.error(`Save failed: ${mr($(e))}`);
		}
	}, S = async () => {
		if (e) try {
			await u.mutateAsync(e.config_id), i(), s.success("SSH config deleted.");
		} catch (e) {
			s.error(`Delete failed: ${mr($(e))}`);
		}
	}, C = async () => {
		let e = m.trim();
		if (!e) {
			s.error("An SSH host is required to test.");
			return;
		}
		let t = g.trim() ? Number(g.trim()) : null;
		await d.mutateAsync({
			ssh_host: e,
			ssh_port: t,
			ssh_identity_file: v.trim() || null
		}), s.success("SSH connection succeeded.");
	}, w = K(x), T = K(S);
	return ui(() => {
		w.current = x, T.current = S;
	}), ui(() => (a(/* @__PURE__ */ X(J, { children: [
		e ? o ? /* @__PURE__ */ Y(gn, {
			variant: H.SecondaryDestructive,
			content: L.Icon,
			className: "mr-auto",
			disabled: b,
			onClick: () => void T.current(),
			children: /* @__PURE__ */ Y(B, { iconName: V.Trash })
		}) : /* @__PURE__ */ Y(I, {
			size: z.Large,
			variant: H.SecondaryDestructive,
			content: L.Icon,
			className: "mr-auto",
			disabled: b,
			onClick: () => void T.current(),
			children: /* @__PURE__ */ Y(B, { iconName: V.Trash })
		}) : null,
		o ? /* @__PURE__ */ Y(gn, {
			variant: H.Secondary,
			content: L.Text,
			onClick: n,
			children: "Cancel"
		}) : /* @__PURE__ */ Y(I, {
			size: z.Large,
			variant: H.Ghost,
			onClick: n,
			children: "Cancel"
		}),
		o ? /* @__PURE__ */ Y(gn, {
			variant: H.Primary,
			content: L.Text,
			disabled: b,
			onClick: () => void w.current(),
			children: "Save"
		}) : /* @__PURE__ */ Y(I, {
			size: z.Large,
			variant: H.Primary,
			disabled: b,
			onClick: () => void w.current(),
			children: "Save"
		})
	] })), () => a(null)), [
		b,
		o,
		n,
		e,
		a
	]), /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: /* @__PURE__ */ Y("div", {
			className: P("flex-1 overflow-auto p-4 [&>*]:shrink-0", o && "pb-[88px]"),
			children: /* @__PURE__ */ Y(Tf, {
				mode: "manage",
				connection: null,
				onConnectionChange: () => void 0,
				name: f,
				onNameChange: p,
				host: m,
				onHostChange: h,
				port: g,
				onPortChange: _,
				identityFile: v,
				onIdentityFileChange: y,
				onTest: C,
				testing: d.isPending,
				className: "bg-elevation-level-2"
			})
		})
	});
}
// src/app/features/managed/controller/useManagedHost.ts
var jm = ai(null);
function Mm() {
	let e = ci(jm);
	if (!e) throw Error("useManagedHost must be used within ManagedHostProvider");
	return e;
}
// src/app/components/TopBar.tsx
var Nm = "linear-gradient(to bottom, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))", Pm = { backgroundImage: `${Nm}, ${Nm}` };
function Fm() {
	let { useSidebarOffset: e } = n().stores.sidebarLayoutStore, [t, r] = q(!1), [i, a] = q(!1), [o, s] = q(!1), c = Le(), l = In(), { pathname: u } = wi(), d = hp(), f = Mm(), p = e(), m = Qt(u) !== null || Rn(u) !== null;
	return !c && (Qt(u) !== null || u === kr.list()) ? null : /* @__PURE__ */ X(J, { children: [
		/* @__PURE__ */ X("header", {
			className: P("fixed top-0 right-0 z-10 flex items-center justify-between py-2 shrink-0", "transition-[left] duration-500 ease-in-out", c ? "h-16 px-3 gap-4" : l ? "h-[52px] px-3" : "h-[52px] px-4"),
			style: { left: p },
			children: [
				/* @__PURE__ */ Y("div", {
					className: P("absolute inset-x-0 top-0 pointer-events-none", c ? "-bottom-[76px]" : "-bottom-[8px]"),
					style: Pm
				}),
				/* @__PURE__ */ X("div", {
					className: P("relative flex items-center", c ? "flex-1 min-w-0 gap-4" : l ? "shrink-0 gap-4" : "shrink-0 gap-8"),
					children: [p > 0 ? null : /* @__PURE__ */ Y(yi, {
						to: kr.list(),
						className: "shrink-0",
						"aria-label": "All projects",
						children: /* @__PURE__ */ Y(ol, {
							height: 36,
							markOnly: c || l,
							className: "text-basic-primary"
						})
					}), /* @__PURE__ */ Y(Rp, {})]
				}),
				/* @__PURE__ */ X("div", {
					className: "relative flex items-center shrink-0 gap-2",
					children: [
						c && !m ? /* @__PURE__ */ Y(I, {
							variant: H.Primary,
							size: z.Medium,
							content: L.Icon,
							className: "btn-round",
							"aria-label": f.isManaged ? "Add repository" : "New project",
							onClick: f.isManaged ? f.addRepository : d.create,
							children: /* @__PURE__ */ Y(B, { iconName: V.Add })
						}) : null,
						/* @__PURE__ */ Y(Up, {}),
						/* @__PURE__ */ Y(Hp, { onOpen: () => s(!0) }),
						/* @__PURE__ */ Y(Vp, {
							onConfigurations: () => r(!0),
							onSshConfigs: () => a(!0),
							onManagedHost: f.isManaged ? f.openSettings : void 0
						})
					]
				})
			]
		}),
		/* @__PURE__ */ Y(Jp, {
			open: t,
			onClose: () => r(!1)
		}),
		/* @__PURE__ */ Y(Om, {
			open: i,
			onClose: () => a(!1)
		}),
		/* @__PURE__ */ Y(wm, {
			open: o,
			onClose: () => s(!1)
		})
	] });
}
// src/app/components/AppShell.tsx
function Im() {
	return /* @__PURE__ */ X("div", {
		className: "h-full flex flex-col bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ Y(Fm, {}), /* @__PURE__ */ Y("main", {
			className: "flex-1 min-h-0",
			children: /* @__PURE__ */ Y(xi, {})
		})]
	});
}
// src/app/components/sessions/SessionFilters.tsx
var Lm = { paddingInline: "12px" };
function Rm() {
	return /* @__PURE__ */ Y("div", { className: "h-px w-full bg-divider-muted shrink-0" });
}
function zm({ children: e, gap: t }) {
	return /* @__PURE__ */ Y("div", {
		className: P("flex flex-col px-4 py-6", t),
		children: e
	});
}
function Bm({ label: e, items: t, value: n, onValueChange: r, stacked: i, sidebar: a = !1 }) {
	return /* @__PURE__ */ X("div", {
		className: P(i ? "flex flex-col gap-1" : a ? "flex items-center gap-1" : "flex items-center justify-between gap-3"),
		children: [/* @__PURE__ */ Y("div", {
			className: P(i ? "label-medium text-basic-primary" : "label-small shrink-0", a || i ? "text-basic-primary" : "text-basic-secondary", a && "flex-1 min-w-0"),
			children: e
		}), /* @__PURE__ */ Y(ql, {
			items: t,
			value: n,
			onValueChange: r,
			size: i ? z.Large : z.Small,
			variant: H.Secondary,
			placement: R.BottomLeft,
			sticky: a,
			className: i ? "w-full" : "min-w-0",
			triggerClassName: i ? "w-full btn-field" : a ? "!gap-1.5 !pl-3" : ""
		})]
	});
}
function Vm({ label: e, options: t, selected: n, onToggle: r, labelOf: i = (e) => e, touch: a, sidebar: o = !1 }) {
	return /* @__PURE__ */ X("div", {
		className: P("flex flex-col", o ? "gap-2" : "gap-3"),
		children: [/* @__PURE__ */ Y("div", {
			className: P(a ? "label-medium text-basic-primary" : "label-small", o || a ? "text-basic-primary" : "text-basic-secondary"),
			children: e
		}), /* @__PURE__ */ Y("div", {
			className: "flex flex-wrap gap-2",
			children: t.map((e) => /* @__PURE__ */ Y(I, {
				size: a ? z.Medium : z.Small,
				content: L.Text,
				variant: n.includes(e) ? H.Primary : H.Secondary,
				onClick: () => r(e),
				"aria-pressed": n.includes(e),
				style: a ? void 0 : Lm,
				children: i(e)
			}, e))
		})]
	});
}
function Hm({ sessions: e, showSearch: t = !0, mobile: r = !1, sidebar: i = !1, onChange: a }) {
	let { useSort: o, useSessionProviders: s, useSessionEnvs: c, useSelectedProviders: l, useSelectedEnvs: u, useModifiedRange: d, useFilterQuery: f, useCreatedRange: p, toggleProvider: m, toggleEnv: h, setSort: g, setQuery: _, setModifiedRange: v, setCreatedRange: y, pruneUnavailableFacets: b, SORT_ITEMS: x, RANGE_ITEMS: S } = n().stores.sessionFiltersStore, C = f(), w = o(), T = p(), E = d(), D = u(), O = l(), k = c(e), A = s(e);
	W(() => {
		b(k, A);
	}, [
		k,
		A,
		b
	]);
	let j = (e) => (t) => {
		e(t), a?.();
	}, ee = /* @__PURE__ */ X(J, { children: [
		/* @__PURE__ */ Y(Bm, {
			label: "Sort by",
			items: x,
			value: w,
			onValueChange: j((e) => g(e)),
			stacked: r,
			sidebar: i
		}),
		/* @__PURE__ */ Y(Bm, {
			label: "Creation date",
			items: S,
			value: T,
			onValueChange: j((e) => y(e)),
			stacked: r,
			sidebar: i
		}),
		/* @__PURE__ */ Y(Bm, {
			label: "Modification date",
			items: S,
			value: E,
			onValueChange: j((e) => v(e)),
			stacked: r,
			sidebar: i
		})
	] });
	return i ? /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-6 py-2",
				children: ee
			}),
			k.length > 1 ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Rm, {}), /* @__PURE__ */ Y("div", {
				className: "py-2",
				children: /* @__PURE__ */ Y(Vm, {
					label: "Environment",
					options: k,
					selected: D,
					onToggle: j(h),
					touch: !1,
					sidebar: !0
				})
			})] }) : null,
			A.length > 1 ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Rm, {}), /* @__PURE__ */ Y("div", {
				className: "py-2",
				children: /* @__PURE__ */ Y(Vm, {
					label: "Provider",
					options: A,
					selected: O,
					onToggle: j(m),
					labelOf: Jt,
					touch: !1,
					sidebar: !0
				})
			})] }) : null
		]
	}) : /* @__PURE__ */ X("div", {
		className: "flex flex-col",
		children: [
			t ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(zm, {
				gap: "gap-4",
				children: /* @__PURE__ */ Y(Q, {
					inputSize: Z.Medium,
					leading: Vc.Icon,
					leadingIconName: V.Search,
					placeholder: "Search projects",
					value: C,
					onChange: (e) => _(e.target.value),
					"aria-label": "Search projects"
				})
			}), /* @__PURE__ */ Y(Rm, {})] }) : null,
			/* @__PURE__ */ Y(zm, {
				gap: r ? "gap-6" : "gap-4",
				children: ee
			}),
			k.length > 1 ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Rm, {}), /* @__PURE__ */ Y(zm, {
				gap: "gap-4",
				children: /* @__PURE__ */ Y(Vm, {
					label: "Environment",
					options: k,
					selected: D,
					onToggle: j(h),
					touch: r
				})
			})] }) : null,
			A.length > 1 ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Rm, {}), /* @__PURE__ */ Y(zm, {
				gap: "gap-4",
				children: /* @__PURE__ */ Y(Vm, {
					label: "Provider",
					options: A,
					selected: O,
					onToggle: j(m),
					labelOf: Jt,
					touch: r
				})
			})] }) : null
		]
	});
}
// src/app/components/LeftSidebar/NewSessionPopover.tsx
var Um = [
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
function Wm(e) {
	let t = sa(e);
	return [
		t.topLevel,
		t.editing,
		t.delegation,
		t.inspection
	].join(" ");
}
function Gm({ projectId: e, onUnavailable: t, className: n, children: r }) {
	let i = fr(), [a, o] = q(!1), s = Ti(), c = Cn(), l = Or(), u = () => {
		e ? i.orchestrationEnabled ? o((e) => !e) : d("direct") : t();
	}, d = async (t) => {
		if (e && !l.isPending) try {
			let n = (await l.mutateAsync({
				project_id: e,
				behavior: me(i, t)
			})).metadata.session_id;
			o(!1), n && s(kr.session(n));
		} catch (e) {
			c.error(`Failed to start a chat: ${Ku($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(Zr, {
		open: a,
		onClose: () => o(!1),
		sticky: !0,
		placement: R.RightTop,
		size: Gt.Medium,
		panelClassName: "gap-2",
		className: n,
		content: /* @__PURE__ */ Y(J, { children: Um.map((e) => {
			let t = sa(e.behavior);
			return /* @__PURE__ */ X(Gl, {
				disabled: l.isPending,
				hoverHint: {
					title: t.label,
					description: Wm(e.behavior),
					muted: !0
				},
				onClick: () => void d(e.behavior),
				children: [/* @__PURE__ */ Y(ga, { behavior: e.behavior }), /* @__PURE__ */ Y("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: e.label
				})]
			}, e.behavior);
		}) }),
		children: r(u)
	});
}
// src/app/components/LeftSidebar/SidebarProjectList.tsx
var Km = 6e4, qm = 4;
function Jm({ projects: e, sessions: t, query: n, activeSessionId: r, activeProjectId: i }) {
	let a = Ti(), o = uu(), s = $t(Km), [c, l] = q(() => /* @__PURE__ */ new Set()), [u, d] = q(() => /* @__PURE__ */ new Map()), [f, p] = q(() => /* @__PURE__ */ new Set()), m = n.trim().toLowerCase(), h = G(() => gu(e, t), [e, t]), g = G(() => t.filter((e) => e.lineage == null && !e.summary.project_id), [t]), _ = (e) => m ? !0 : u.get(e) === r ? !1 : c.has(e) || e === i, v = (e) => {
		_(e) ? (d((t) => new Map(t).set(e, r)), l((t) => {
			let n = new Set(t);
			return n.delete(e), n;
		})) : (l((t) => new Set(t).add(e)), d((t) => {
			let n = new Map(t);
			return n.delete(e), n;
		}));
	}, y = h.filter((e) => !m || e.project.name.toLowerCase().includes(m) ? !0 : e.sessions.some((e) => o(e.summary).toLowerCase().includes(m))), b = g.filter((e) => !m || o(e.summary).toLowerCase().includes(m));
	return y.length === 0 && b.length === 0 ? /* @__PURE__ */ Y("p", {
		className: "label-small text-basic-muted px-4 py-3",
		children: "No matching sessions"
	}) : /* @__PURE__ */ X("div", {
		className: "flex flex-col [&>*]:shrink-0",
		children: [y.map((e) => {
			let t = e.project.project_id, n = _(t), i = e.project.name.toLowerCase().includes(m), c = m && !i ? e.sessions.filter((e) => o(e.summary).toLowerCase().includes(m)) : e.sessions;
			return /* @__PURE__ */ X("section", {
				className: "border-b border-muted py-4",
				children: [/* @__PURE__ */ Y("div", {
					className: "px-2 py-1",
					children: /* @__PURE__ */ Y(Rl, {
						entityId: t,
						name: e.project.name,
						running: e.running > 0,
						"aria-expanded": n,
						onClick: () => v(t)
					})
				}), /* @__PURE__ */ Y(oo, {
					isOpen: n,
					inert: !n,
					"aria-hidden": !n,
					className: "w-full duration-500 ease-in-out",
					children: /* @__PURE__ */ Y(Zm, {
						sessions: c,
						activeSessionId: r,
						revealed: m.length > 0 || f.has(t),
						onReveal: () => p((e) => {
							let n = new Set(e);
							return n.add(t), n;
						}),
						now: s,
						onOpen: (e) => a(kr.session(e))
					})
				})]
			}, t);
		}), b.length > 0 ? /* @__PURE__ */ Y("section", {
			className: "flex flex-col px-2 py-1",
			children: b.map((e) => /* @__PURE__ */ Y(Rl, {
				entityId: e.summary.session_id,
				name: o(e.summary),
				variant: Ll.Orphan,
				active: e.summary.session_id === r,
				running: rt(e.active_run),
				onClick: () => a(kr.session(e.summary.session_id))
			}, e.summary.session_id))
		}) : null]
	});
}
function Ym(e, t, n) {
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
function Xm(e, t) {
	if (t) return e;
	let n = qm, r = [];
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
function Zm({ sessions: e, activeSessionId: t, revealed: n, onReveal: r, now: i, onOpen: a }) {
	let o = uu(), s = fr(), c = ou(), l = kp(), u = G(() => Ou(e, (e) => ({
		updatedAt: e.summary.updated_at,
		pinned: !!e.summary.pinned
	}), i), [e, i]);
	if (e.length === 0) return /* @__PURE__ */ Y("p", {
		className: "label-small text-basic-muted px-4 pb-3",
		children: "No chats yet"
	});
	let d = Ym(Xm(u, n), u, t), f = d.reduce((e, t) => e + t.items.length, 0), p = Math.max(0, e.length - f);
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-1 px-2 pb-2",
		children: [d.map((e) => /* @__PURE__ */ X("div", {
			className: "flex flex-col",
			children: [/* @__PURE__ */ Y("p", {
				className: "tag-label text-basic-tertiary uppercase px-2 pt-4 pb-4",
				children: e.label
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-0.5",
				children: e.items.map((e) => {
					let n = o(e.summary), r = sa(e.summary.behavior);
					return /* @__PURE__ */ Y(va, {
						title: n,
						behavior: e.summary.behavior,
						showBehaviorIcon: c,
						"aria-label": s.orchestrationEnabled ? `${n}, ${r.navigationLabel}` : n,
						active: e.summary.session_id === t,
						running: rt(e.active_run),
						forkedFromTitle: e.summary.forked_from?.title,
						onClick: () => a(e.summary.session_id),
						actions: /* @__PURE__ */ Y(su, {
							title: n,
							pinned: e.summary.pinned,
							onPin: () => void l.togglePin(e.summary),
							onRename: () => l.rename(e.summary),
							onDelete: () => l.remove(e.summary)
						})
					}, e.summary.session_id);
				})
			})]
		}, e.label)), p > 0 ? /* @__PURE__ */ X(Gl, {
			onClick: r,
			children: [/* @__PURE__ */ Y(B, { iconName: V.MenuHorizontal }), /* @__PURE__ */ X("span", {
				className: "text-left flex-grow",
				children: [
					"See ",
					p,
					" more"
				]
			})]
		}) : null]
	});
}
// src/app/components/LeftSidebar/LeftSidebarPanel.tsx
function Qm({ isOpen: e, onToggle: t, toggleKeys: r, commands: i, variant: a }) {
	let { useFilterQuery: o, setQuery: s } = n().stores.sessionFiltersStore, c = a === "projects", [l, u] = q(""), d = o(), { data: f = [] } = qr(), { data: p } = ie(), { data: m } = Er(), h = m?.store_path ?? "", g = p?.projects ?? [];
	return /* @__PURE__ */ X("div", {
		className: "flex h-full flex-col bg-elevation-ground border-r border-muted",
		style: { boxShadow: "var(--left-sidebar-open)" },
		children: [
			/* @__PURE__ */ X("div", {
				className: "flex items-center justify-between px-4 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ Y(ol, {
					height: 28,
					className: "text-basic-primary"
				}), /* @__PURE__ */ Y(Ir, {
					title: "Hide sidebar",
					keyboardShortcuts: r,
					position: R.CenterLeft,
					sticky: !0,
					disabled: !e,
					children: /* @__PURE__ */ Y(I, {
						variant: H.Ghost,
						content: L.Icon,
						"aria-label": "Hide sidebar",
						onClick: t,
						children: /* @__PURE__ */ Y(B, { iconName: V.SidebarChevronLeft })
					})
				})]
			}),
			/* @__PURE__ */ X("div", {
				className: "flex flex-col gap-3 px-2 py-3 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ Y("div", {
					className: "px-1",
					children: /* @__PURE__ */ Y(Q, {
						inputSize: Z.Medium,
						leading: Vc.Icon,
						leadingIconName: V.Search,
						placeholder: c ? "Search Projects" : "Search Sessions",
						value: c ? d : l,
						"aria-label": c ? "Search projects" : "Search sessions",
						onChange: (e) => c ? s(e.target.value) : u(e.target.value)
					})
				}), /* @__PURE__ */ X("div", {
					className: "flex flex-col gap-0.5",
					children: [
						c ? /* @__PURE__ */ X(Gl, {
							onClick: i.newProject,
							children: [/* @__PURE__ */ Y(B, { iconName: V.Add }), /* @__PURE__ */ Y("span", {
								className: "text-left flex-grow",
								children: i.createLabel
							})]
						}) : /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Gm, {
							projectId: i.projectId,
							onUnavailable: i.newSession,
							className: "w-full",
							children: (e) => /* @__PURE__ */ X(Gl, {
								onClick: e,
								children: [
									/* @__PURE__ */ Y(B, { iconName: V.Add }),
									/* @__PURE__ */ Y("span", {
										className: "text-left flex-grow",
										children: "New Session"
									}),
									/* @__PURE__ */ Y(B, { iconName: V.Right })
								]
							})
						}), /* @__PURE__ */ X("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ X(Gl, {
								className: "flex-1 !w-auto",
								onClick: i.openProjects,
								children: [/* @__PURE__ */ Y(B, { iconName: V.Folders }), /* @__PURE__ */ Y("span", {
									className: "text-left flex-grow truncate",
									children: "All projects"
								})]
							}), /* @__PURE__ */ Y(Ir, {
								title: "Create a new project",
								position: R.CenterRight,
								sticky: !0,
								children: /* @__PURE__ */ Y(I, {
									variant: H.Ghost,
									content: L.Icon,
									"aria-label": "New project",
									onClick: i.newProject,
									children: /* @__PURE__ */ Y(B, { iconName: V.AddCircle })
								})
							})]
						})] }),
						/* @__PURE__ */ X(Gl, {
							onClick: i.openMcp,
							"aria-label": i.mcpLabel,
							children: [
								/* @__PURE__ */ Y(B, { iconName: V.Toolbox }),
								/* @__PURE__ */ Y("span", {
									className: "text-left flex-grow",
									children: "MCP"
								}),
								i.activeMcp > 0 ? /* @__PURE__ */ Y(Li, {
									text: `${i.activeMcp} ACTIVE`,
									color: Fi.Blue
								}) : null
							]
						}),
						/* @__PURE__ */ X(Gl, {
							onClick: i.openSsh,
							children: [
								/* @__PURE__ */ Y(B, { iconName: V.Globe }),
								/* @__PURE__ */ Y("span", {
									className: "text-left flex-grow",
									children: "SSH"
								}),
								i.sshCount > 0 ? /* @__PURE__ */ Y("span", {
									className: "label-small text-basic-secondary tabular-nums",
									children: i.sshCount
								}) : null
							]
						})
					]
				})]
			}),
			c ? /* @__PURE__ */ Y("div", {
				className: "flex-1 min-h-0 overflow-y-auto p-4 [&>*]:shrink-0",
				children: /* @__PURE__ */ Y(Hm, {
					sessions: f,
					showSearch: !1,
					sidebar: !0
				})
			}) : /* @__PURE__ */ Y("div", {
				className: "flex-1 min-h-0 overflow-y-auto",
				children: /* @__PURE__ */ Y(Jm, {
					projects: g,
					sessions: f,
					query: l,
					activeSessionId: i.sessionId,
					activeProjectId: i.projectId
				})
			}),
			/* @__PURE__ */ X("div", {
				className: "shrink-0 border-t border-muted",
				children: [
					/* @__PURE__ */ X("div", {
						className: "px-2 py-1",
						children: [/* @__PURE__ */ X(Gl, {
							onClick: i.openConfigurations,
							children: [/* @__PURE__ */ Y(B, { iconName: V.Gear }), /* @__PURE__ */ Y("span", {
								className: "text-left flex-grow",
								children: "Configurations"
							})]
						}), /* @__PURE__ */ X(Gl, {
							onClick: i.openManaged,
							children: [/* @__PURE__ */ Y(B, { iconName: V.Controls }), /* @__PURE__ */ Y("span", {
								className: "text-left flex-grow",
								children: "Managed host"
							})]
						})]
					}),
					/* @__PURE__ */ Y($l, {}),
					/* @__PURE__ */ X("div", {
						className: "flex items-center gap-2 h-10 pl-4 pr-2",
						children: [
							/* @__PURE__ */ Y("span", {
								className: "label-micro text-basic-primary shrink-0",
								children: "Store:"
							}),
							/* @__PURE__ */ Y("span", {
								className: "code code-micro text-basic-tertiary flex-1 min-w-0 truncate",
								title: h,
								children: h || "store path pending"
							}),
							/* @__PURE__ */ Y(Ft, {
								value: h,
								size: z.Small,
								variant: H.Tertiary,
								title: "Copy the store path",
								disabled: !h,
								position: R.TopLeft,
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
function $m({ commands: e, onToggle: t, toggleKeys: n, variant: r }) {
	let i = r === "projects";
	return /* @__PURE__ */ X("div", {
		className: "flex h-full flex-col justify-between p-2",
		children: [/* @__PURE__ */ X("div", {
			className: "flex flex-col items-center gap-4 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ Y("button", {
					type: "button",
					className: "text-basic-primary",
					"aria-label": "All projects",
					onClick: e.openProjects,
					children: /* @__PURE__ */ Y(ol, {
						markOnly: !0,
						height: 25
					})
				}),
				/* @__PURE__ */ Y(eh, {
					label: "Show sidebar",
					keys: n,
					onClick: t,
					children: /* @__PURE__ */ Y(B, { iconName: V.SidebarChevronRight })
				}),
				i ? null : /* @__PURE__ */ Y(eh, {
					label: "All projects",
					onClick: e.openProjects,
					children: /* @__PURE__ */ Y(B, { iconName: V.Folders })
				}),
				i ? /* @__PURE__ */ Y(eh, {
					label: e.createLabel,
					onClick: e.newProject,
					children: /* @__PURE__ */ Y(B, { iconName: V.Add })
				}) : /* @__PURE__ */ Y(Gm, {
					projectId: e.projectId,
					onUnavailable: e.newSession,
					children: (e) => /* @__PURE__ */ Y(eh, {
						label: "New session",
						onClick: e,
						children: /* @__PURE__ */ Y(B, { iconName: V.Add })
					})
				}),
				/* @__PURE__ */ Y(eh, {
					label: e.mcpLabel,
					onClick: e.openMcp,
					children: /* @__PURE__ */ Y(B, { iconName: V.Toolbox })
				}),
				/* @__PURE__ */ Y(eh, {
					label: "SSH",
					onClick: e.openSsh,
					children: /* @__PURE__ */ Y(B, { iconName: V.Globe })
				})
			]
		}), /* @__PURE__ */ X("div", {
			className: "flex flex-col items-center gap-1 [&>*]:shrink-0",
			children: [/* @__PURE__ */ Y(eh, {
				label: "Configurations",
				onClick: e.openConfigurations,
				children: /* @__PURE__ */ Y(B, { iconName: V.Gear })
			}), /* @__PURE__ */ Y(eh, {
				label: "Managed host",
				onClick: e.openManaged,
				children: /* @__PURE__ */ Y(B, { iconName: V.Controls })
			})]
		})]
	});
}
function eh({ label: e, keys: t, onClick: n, children: r }) {
	return /* @__PURE__ */ Y(Ir, {
		title: e,
		keyboardShortcuts: t,
		position: R.CenterRight,
		sticky: !0,
		children: /* @__PURE__ */ Y(I, {
			variant: H.Ghost,
			content: L.Icon,
			"aria-label": e,
			onClick: n,
			children: r
		})
	});
}
// src/app/components/LeftSidebar/useSidebarCommands.tsx
function th() {
	let [e, t] = q(!1), [n, r] = q(!1), [i, a] = q(!1), { pathname: o } = wi(), s = Ti(), c = hp(), l = Mm(), { data: u = [] } = fn(), { data: d } = or(), { data: f } = Gr(), p = Qt(o), m = p != null && u.some((e) => e.summary.session_id === p), h = Rn(o) ?? u.find((e) => e.summary.session_id === p)?.summary.project_id ?? null, g = d?.servers.filter((e) => e.enabled).length ?? 0;
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
		openProjects: () => s(kr.list()),
		openMcp: () => a(!0),
		openSsh: () => r(!0),
		openConfigurations: () => t(!0),
		openManaged: l.openSettings,
		modals: /* @__PURE__ */ X(J, { children: [
			/* @__PURE__ */ Y(Jp, {
				open: e,
				onClose: () => t(!1)
			}),
			/* @__PURE__ */ Y(Om, {
				open: n,
				onClose: () => r(!1)
			}),
			/* @__PURE__ */ Y(wm, {
				open: i,
				onClose: () => a(!1)
			})
		] })
	};
}
var nh = [et, "h"];
function rh({ variant: e = "session" }) {
	let { setSidebarOffset: t, storedOpen: r, storeOpen: i } = n().stores.sidebarLayoutStore, a = Le(), o = S(), [s, c] = q(null), l = s ?? r() ?? o, u = U(() => {
		c((e) => {
			let t = !(e ?? r() ?? o);
			return i(t), t;
		});
	}, [
		o,
		r,
		i
	]), d = th();
	return ui(() => {
		t(a ? 0 : l ? 320 : 52);
	}, [
		a,
		l,
		t
	]), ui(() => () => t(0), [t]), fp([{
		keys: nh,
		onTrigger: u,
		enabled: !a
	}]), a ? null : /* @__PURE__ */ X("div", {
		"data-sidebar": "true",
		className: P("relative h-full shrink-0 transition-[width] duration-500 ease-in-out", l ? "w-[320px]" : "w-[52px]"),
		children: [
			l ? null : /* @__PURE__ */ Y("div", {
				className: "absolute inset-y-0 left-0 w-[52px]",
				children: /* @__PURE__ */ Y($m, {
					commands: d,
					onToggle: u,
					toggleKeys: nh,
					variant: e
				})
			}),
			/* @__PURE__ */ Y("div", {
				className: P("absolute inset-y-0 z-[1] h-full w-[320px] transition-[left] duration-500 ease-in-out", l ? "left-0" : "left-[-320px]"),
				"aria-hidden": !l,
				inert: !l,
				children: /* @__PURE__ */ Y(Qm, {
					isOpen: l,
					commands: d,
					onToggle: u,
					toggleKeys: nh,
					variant: e
				})
			}),
			d.modals
		]
	});
}
// src/app/components/pages/design-preview/AvatarsSection.tsx
function ih() {
	let [e, t] = q("Port the ArceeFM atoms");
	return /* @__PURE__ */ Y(Ri, {
		title: "Avatars and editable header",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ X("div", {
				className: "flex flex-wrap items-center gap-4",
				children: [
					/* @__PURE__ */ Y(Pi, {
						name: "Aleksy",
						size: Mi.Small
					}),
					/* @__PURE__ */ Y(Pi, { name: "NAC Orchestrator" }),
					/* @__PURE__ */ Y(Pi, {
						name: "Opus",
						size: Mi.Large
					}),
					/* @__PURE__ */ Y(Pi, {
						name: "🛠",
						glyph: !0,
						size: Mi.Large
					}),
					/* @__PURE__ */ Y(Pi, {
						name: "Anthropic",
						size: Mi.XLarge,
						color: "var(--color-bg-info-primary)"
					})
				]
			}), /* @__PURE__ */ Y(co, {
				value: e,
				onCommit: t,
				size: so.Medium,
				className: "max-w-[360px]"
			})]
		})
	});
}
// src/app/components/pages/design-preview/BadgesSection.tsx
function ah() {
	let [e, t] = q(!0);
	return /* @__PURE__ */ Y(Ri, {
		title: "Badges, loader, switch, tooltip",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [
				/* @__PURE__ */ Y(Li, {
					text: "Running",
					color: Fi.Green
				}),
				/* @__PURE__ */ Y(Li, {
					text: "Queued",
					color: Fi.Blue
				}),
				/* @__PURE__ */ Y(Li, {
					text: "Failed",
					color: Fi.Red
				}),
				/* @__PURE__ */ Y(Li, {
					text: "Idle",
					color: Fi.Gray
				}),
				/* @__PURE__ */ Y(f, { size: mt.Small }),
				/* @__PURE__ */ Y(iu, {
					checked: e,
					onChange: t
				}),
				/* @__PURE__ */ Y(Ir, {
					title: "Pin session",
					description: "Keeps the card at the top of the board.",
					position: R.BottomCenter,
					sticky: !0,
					showTooltipOnMobile: !0,
					children: /* @__PURE__ */ Y(B, { iconName: V.Pin })
				}),
				/* @__PURE__ */ Y(B, { iconName: V.Unpin })
			]
		})
	});
}
// src/app/components/pages/design-preview/TabsPreview.tsx
var oh = [
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
], sh = [
	{
		label: "Regular",
		variant: Ul.Regular
	},
	{
		label: "Accent",
		variant: Ul.Accent
	},
	{
		label: "Destructive",
		variant: Ul.Destructive
	}
], ch = [
	{
		label: "small",
		size: Hl.Small
	},
	{
		label: "medium",
		size: Hl.Medium
	},
	{
		label: "large",
		size: Hl.Large
	}
], lh = [
	{
		label: "Small",
		size: Lc.Small
	},
	{
		label: "Medium",
		size: Lc.Medium
	},
	{
		label: "Large",
		size: Lc.Large
	}
], uh = [
	{
		label: "Icon left",
		content: Rc.IconLeft
	},
	{
		label: "Icon right",
		content: Rc.IconRight
	},
	{
		label: "Icon",
		content: Rc.IconOnly
	},
	{
		label: "Text",
		content: Rc.TextOnly
	},
	{
		label: "Full",
		content: Rc.Full
	}
];
function dh() {
	return /* @__PURE__ */ X("div", {
		className: "grid w-fit grid-cols-[160px_repeat(4,200px)] items-center gap-x-4 gap-y-2",
		children: [
			/* @__PURE__ */ Y("span", {}),
			oh.map((e) => /* @__PURE__ */ Y("span", {
				className: "label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			sh.flatMap((e) => ch.map((t) => /* @__PURE__ */ X(ri, { children: [/* @__PURE__ */ X("span", {
				className: "label-small text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), oh.map((n) => /* @__PURE__ */ X(Gl, {
				variant: e.variant,
				size: t.size,
				active: n.active,
				disabled: n.disabled,
				children: [
					/* @__PURE__ */ Y(B, { iconName: V.Search }),
					/* @__PURE__ */ Y("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: "New chat"
					}),
					/* @__PURE__ */ Y(B, { iconName: V.Edit })
				]
			}, n.label))] }, `${e.label}-${t.label}`)))
		]
	});
}
function fh() {
	return /* @__PURE__ */ X("div", {
		className: "grid w-fit grid-cols-[160px_repeat(5,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ Y("span", {}),
			uh.map((e) => /* @__PURE__ */ Y("span", {
				className: "label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			lh.flatMap((e) => oh.map((t) => /* @__PURE__ */ X(ri, { children: [/* @__PURE__ */ X("span", {
				className: "label-small text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label.toLowerCase()
				]
			}), uh.map((n) => /* @__PURE__ */ Y(zc, {
				size: e.size,
				content: n.content,
				active: t.active,
				disabled: t.disabled,
				iconName: V.Play,
				trailingIcon: V.Right,
				"aria-label": n.content === Rc.IconOnly ? "Run" : void 0,
				children: "Run"
			}, n.label))] }, `${e.label}-${t.label}`)))
		]
	});
}
function ph() {
	return /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ X("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ Y("span", {
			className: "label-medium text-basic-primary",
			children: "Tab button"
		}), /* @__PURE__ */ Y(dh, {})]
	}), /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ Y("span", {
			className: "label-medium text-basic-primary",
			children: "Horizontal tab item"
		}), /* @__PURE__ */ Y(fh, {})]
	})] });
}
// src/app/components/pages/design-preview/ButtonsSection.tsx
var mh = [
	{
		label: "Primary",
		variant: H.Primary
	},
	{
		label: "Secondary",
		variant: H.Secondary
	},
	{
		label: "Secondary highlighted",
		variant: H.SecondaryHighlighted
	},
	{
		label: "Secondary destructive",
		variant: H.SecondaryDestructive
	},
	{
		label: "Secondary accent",
		variant: H.SecondaryAccent
	},
	{
		label: "Secondary accent highlighted",
		variant: H.SecondaryAccentHighlighted
	},
	{
		label: "Ghost",
		variant: H.Ghost
	},
	{
		label: "Ghost highlighted",
		variant: H.GhostHighlighted
	},
	{
		label: "Ghost destructive",
		variant: H.GhostDestructive
	},
	{
		label: "Ghost accent",
		variant: H.GhostAccent
	},
	{
		label: "Ghost highlighted accent",
		variant: H.GhostHighlightedAccent
	},
	{
		label: "Tertiary",
		variant: H.Tertiary
	},
	{
		label: "Tertiary destructive",
		variant: H.TertiaryDestructive
	},
	{
		label: "Tertiary accent",
		variant: H.TertiaryAccent
	}
], hh = [
	{
		label: "Secondary",
		variant: H.Secondary
	},
	{
		label: "Ghost highlighted",
		variant: H.GhostHighlighted
	},
	{
		label: "Tertiary",
		variant: H.Tertiary
	}
], gh = [
	{
		label: "small",
		size: z.Small
	},
	{
		label: "medium",
		size: z.Medium
	},
	{
		label: "large",
		size: z.Large
	}
], _h = [
	{
		label: "Icon",
		content: L.Icon
	},
	{
		label: "Icon left",
		content: L.IconLeft
	},
	{
		label: "Text",
		content: L.Text
	},
	{
		label: "Icon right",
		content: L.IconRight
	}
];
function vh({ variant: e, size: t = z.Medium, content: n = L.IconLeft, disabled: r = !1 }) {
	let i = n === L.Icon;
	return /* @__PURE__ */ X(I, {
		variant: e,
		size: t,
		content: n,
		disabled: r,
		"aria-label": i ? "Add" : void 0,
		children: [
			i || n === L.IconLeft ? /* @__PURE__ */ Y(B, { iconName: V.Add }) : null,
			i ? null : "Label",
			n === L.IconRight ? /* @__PURE__ */ Y(B, { iconName: V.Right }) : null
		]
	});
}
function yh() {
	return /* @__PURE__ */ X("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ Y("span", {}),
			[
				"Default",
				"Disabled",
				"Icon",
				"Icon, disabled"
			].map((e) => /* @__PURE__ */ Y("span", {
				className: "label-micro text-basic-muted",
				children: e
			}, e)),
			mh.map(({ label: e, variant: t }) => /* @__PURE__ */ X(ri, { children: [
				/* @__PURE__ */ Y("span", {
					className: "label-small text-basic-secondary",
					children: e
				}),
				/* @__PURE__ */ Y(vh, { variant: t }),
				/* @__PURE__ */ Y(vh, {
					variant: t,
					disabled: !0
				}),
				/* @__PURE__ */ Y(vh, {
					variant: t,
					content: L.Icon
				}),
				/* @__PURE__ */ Y(vh, {
					variant: t,
					content: L.Icon,
					disabled: !0
				})
			] }, e))
		]
	});
}
function bh() {
	return /* @__PURE__ */ X("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ Y("span", {}),
			_h.map(({ label: e }) => /* @__PURE__ */ Y("span", {
				className: "label-micro text-basic-muted",
				children: e
			}, e)),
			hh.flatMap((e) => gh.map((t) => /* @__PURE__ */ X(ri, { children: [/* @__PURE__ */ X("span", {
				className: "label-small text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), _h.map(({ label: n, content: r }) => /* @__PURE__ */ Y(vh, {
				variant: e.variant,
				size: t.size,
				content: r
			}, n))] }, `${e.label}-${t.label}`)))
		]
	});
}
function xh() {
	return /* @__PURE__ */ Y(Ri, {
		title: "Buttons",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-col gap-8 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ X("div", {
					className: "flex flex-wrap items-center gap-3",
					children: [
						/* @__PURE__ */ Y(I, {
							variant: H.Primary,
							children: "Primary"
						}),
						/* @__PURE__ */ Y(I, {
							variant: H.Secondary,
							children: "Secondary"
						}),
						/* @__PURE__ */ Y(I, {
							variant: H.Tertiary,
							children: "Tertiary"
						}),
						/* @__PURE__ */ Y(I, {
							variant: H.Ghost,
							children: "Ghost"
						}),
						/* @__PURE__ */ Y(I, {
							variant: H.GhostDestructive,
							children: "Destructive"
						}),
						/* @__PURE__ */ Y(I, {
							variant: H.Primary,
							loading: !0,
							children: "Loading"
						}),
						/* @__PURE__ */ Y(I, {
							variant: H.Secondary,
							disabled: !0,
							children: "Disabled"
						}),
						/* @__PURE__ */ X(I, {
							variant: H.Secondary,
							content: L.IconLeft,
							children: [/* @__PURE__ */ Y(B, { iconName: V.Add }), "With icon"]
						})
					]
				}),
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-3",
					children: [
						/* @__PURE__ */ Y("span", {
							className: "label-medium text-basic-primary",
							children: "Button"
						}),
						/* @__PURE__ */ Y(yh, {}),
						/* @__PURE__ */ Y(bh, {})
					]
				}),
				/* @__PURE__ */ Y(ph, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ChoicesSection.tsx
var Sh = [{
	id: "trace",
	name: "session-trace.txt",
	size: "12 KB"
}];
function Ch(e) {
	return {
		id: `${e.name}-${e.lastModified}`,
		name: e.name,
		size: `${Math.ceil(e.size / 1024)} KB`
	};
}
function wh() {
	let [e, t] = q(!0), [n, r] = q("first"), [i, a] = q(Sh);
	return /* @__PURE__ */ Y(Ri, {
		title: "Choices, multi-line and file input",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ Y(ka, {
						checked: e,
						onChange: t,
						children: "Skip permission prompts"
					}), /* @__PURE__ */ Y(ka, {
						checked: !1,
						onChange: () => {},
						disabled: !0,
						children: "Disabled"
					})]
				}),
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ Y(zl, {
						name: "preview-choice",
						checked: n === "first",
						onChange: () => r("first"),
						children: "Working tree"
					}), /* @__PURE__ */ Y(zl, {
						name: "preview-choice",
						checked: n === "second",
						onChange: () => r("second"),
						children: "Latest snapshot"
					})]
				}),
				/* @__PURE__ */ Y(el, {
					label: "System prompt",
					rows: 3,
					placeholder: "Extra instructions for the agent",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ X("div", {
					className: "flex w-[320px] flex-col gap-2",
					children: [/* @__PURE__ */ Y(Pc, {
						accept: ".txt,.md,.pdf",
						hint: "Text, Markdown or PDF.",
						onFilesSelected: (e) => a(e.map(Ch))
					}), /* @__PURE__ */ Y(Pc, {
						files: i,
						onRemove: (e) => a(i.filter((t) => t.id !== e))
					})]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/CodeBlockSection.tsx
var Th = "pub enum AgentEvent {\n    RunStarted { thread_name: Option<String> },\n    AssistantMessage {\n        thread_name: Option<String>,\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { thread_name: Option<String> },\n}";
function Eh() {
	return /* @__PURE__ */ Y(Ri, {
		title: "Code block and chat loader",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ Y(Vn, {
				code: Th,
				language: "rust",
				title: "events.rs",
				lineNumbers: !0,
				expandable: !0,
				maxHeight: "220px"
			}), /* @__PURE__ */ Y(Bi, {})]
		})
	});
}
// src/app/components/pages/design-preview/DatesSection.tsx
function Dh() {
	let [e, t] = q(null), [n, r] = q({
		from: null,
		to: null
	});
	return /* @__PURE__ */ Y(Ri, {
		title: "Dates",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ Y(ao, {
					label: "Created after",
					value: e,
					onChange: t,
					className: "w-[240px]"
				}),
				/* @__PURE__ */ Y(ao, {
					label: "Window",
					range: n,
					onRangeChange: r,
					hintText: "Two clicks pick the ends.",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ Y(Ja, {
					selected: e ? /* @__PURE__ */ new Date(`${e}T00:00:00`) : void 0,
					onSelect: (e) => t(`${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`),
					className: "rounded-[8px] border border-muted bg-elevation-level-2"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/InputsSection.tsx
var Oh = [
	{
		id: "sonnet",
		label: "Claude Sonnet",
		icon: V.Brain
	},
	{
		id: "opus",
		label: "Claude Opus",
		icon: V.Brain
	},
	{
		id: "gpt",
		label: "GPT",
		icon: V.Ai
	}
];
function kh({ onOpenModal: e }) {
	let [t, n] = q("sonnet");
	return /* @__PURE__ */ Y(Ri, {
		title: "Inputs",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-wrap items-end gap-4",
			children: [
				/* @__PURE__ */ Y(Q, {
					label: "Working directory",
					inputSize: Z.Medium,
					placeholder: "/Users/me/project",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ Y(Q, {
					label: "Search",
					inputSize: Z.Medium,
					leading: Vc.Icon,
					leadingIconName: V.Search,
					placeholder: "Filter sessions",
					hintText: "Matches name and cwd",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ Y(ql, {
					items: Oh,
					value: t,
					onValueChange: n,
					placeholder: "Pick a model"
				}),
				/* @__PURE__ */ Y(I, {
					variant: H.Secondary,
					onClick: e,
					children: "Open modal"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/ModelLoaderSection.tsx
var Ah = [{
	variant: Ui.Default,
	label: "Default"
}, {
	variant: Ui.Accent,
	label: "Accent"
}], jh = [
	{
		size: Hi.Small,
		label: "Small 16px"
	},
	{
		size: Hi.Medium,
		label: "Medium 20px"
	},
	{
		size: Hi.Large,
		label: "Large 24px"
	}
], Mh = [
	1,
	2,
	3
];
function Nh() {
	return /* @__PURE__ */ Y(Ri, {
		title: "Model loader",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(4,72px)] items-center gap-x-4 gap-y-3",
			children: [
				/* @__PURE__ */ Y("span", {}),
				/* @__PURE__ */ Y("span", {
					className: "label-micro text-basic-muted",
					children: "Animated"
				}),
				Mh.map((e) => /* @__PURE__ */ X("span", {
					className: "label-micro text-basic-muted",
					children: ["Frame ", e]
				}, e)),
				Ah.flatMap(({ variant: e, label: t }) => jh.map(({ size: n, label: r }) => /* @__PURE__ */ X(ri, { children: [
					/* @__PURE__ */ X("span", {
						className: "label-small text-basic-secondary",
						children: [
							t,
							" · ",
							r
						]
					}),
					/* @__PURE__ */ Y(aa, {
						size: n,
						variant: e
					}),
					Mh.map((t) => /* @__PURE__ */ Y(aa, {
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
function Ph() {
	return /* @__PURE__ */ Y(Ri, {
		title: "Notices and loaders",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-col gap-4",
			children: [
				/* @__PURE__ */ X("div", {
					className: "flex flex-wrap gap-3",
					children: [
						/* @__PURE__ */ Y(gl, {
							variant: sl.Info,
							title: "Read-only snapshot",
							className: "w-[280px]",
							children: "Pick the working tree to edit files again."
						}),
						/* @__PURE__ */ Y(gl, {
							variant: sl.Error,
							title: "Run failed",
							className: "w-[280px]",
							children: "The provider rejected the request."
						}),
						/* @__PURE__ */ Y(gl, {
							variant: sl.Success,
							title: "Branch switched",
							className: "w-[280px]"
						})
					]
				}),
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-2 w-[398px]",
					children: [
						/* @__PURE__ */ Y(Ca, {
							variant: ya.Danger,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						}),
						/* @__PURE__ */ Y(Ca, {
							variant: ya.Error,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						}),
						/* @__PURE__ */ Y(Ca, {
							variant: ya.Success,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						}),
						/* @__PURE__ */ Y(Ca, {
							variant: ya.Info,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						})
					]
				}),
				/* @__PURE__ */ X("div", {
					className: "flex flex-wrap items-center gap-6",
					children: [
						/* @__PURE__ */ Y(nl, { size: mt.Medium }),
						/* @__PURE__ */ Y(Da, {
							rows: 3,
							className: "w-[200px]"
						}),
						/* @__PURE__ */ Y(rl, {
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
function Fh() {
	let [e, t] = q(4), [n, r] = q(.7), [i, a] = q(["local"]), [o, s] = q(1);
	return /* @__PURE__ */ Y(Ri, {
		title: "Numeric inputs, tags and pagination",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ X("div", {
					className: "flex flex-wrap items-center gap-8",
					children: [/* @__PURE__ */ Y(Cl, {
						value: e,
						onChange: t,
						min: 1,
						max: 16,
						"aria-label": "Parallel threads"
					}), /* @__PURE__ */ X("div", {
						className: "flex items-center gap-4 w-[320px]",
						children: [/* @__PURE__ */ Y(Vl, {
							min: 0,
							max: 2,
							step: .1,
							value: n,
							onChange: r,
							label: "Temperature"
						}), /* @__PURE__ */ Y("span", {
							className: "code code-small text-basic-muted w-8 shrink-0",
							children: n.toFixed(1)
						})]
					})]
				}),
				/* @__PURE__ */ Y(au, {
					tags: [
						"local",
						"docker",
						"remote",
						"sandbox"
					],
					selected: i,
					onChange: a
				}),
				/* @__PURE__ */ Y(wl, {
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
function Ih() {
	let [e, t] = q(!1);
	return /* @__PURE__ */ Y(Ri, {
		title: "Popover, copy, shortcuts",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [
				/* @__PURE__ */ Y(Zr, {
					open: e,
					onClose: () => t(!1),
					placement: R.BottomRight,
					sticky: !0,
					content: /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y("div", {
						className: "label-small text-basic-primary px-2 py-1",
						children: "Anchored panel"
					}), /* @__PURE__ */ Y("div", {
						className: "text-micro text-basic-muted px-2 pb-1",
						children: "Closes on Escape or a click outside. On a phone it becomes a bottom sheet instead."
					})] }),
					children: /* @__PURE__ */ Y(I, {
						variant: H.Secondary,
						onClick: () => t((e) => !e),
						children: "Open popover"
					})
				}),
				/* @__PURE__ */ Y(Ft, { value: "nac" }),
				/* @__PURE__ */ Y(Kr, { keys: [
					"cmd",
					"shift",
					"k"
				] })
			]
		})
	});
}
// src/app/components/pages/design-preview/samples.ts
var Lh = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
];
// src/app/components/pages/design-preview/SessionAvatarsSection.tsx
function Rh() {
	return /* @__PURE__ */ Y(Ri, {
		title: "Session avatars",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [Lh.map((e) => /* @__PURE__ */ X("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ Y(Il, {
					id: e,
					size: 40
				}), /* @__PURE__ */ Y("span", {
					className: "code code-small text-basic-muted",
					children: e
				})]
			}, e)), /* @__PURE__ */ X("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ Y(Ea, {}), /* @__PURE__ */ Y("span", {
					className: "code code-small text-basic-muted",
					children: "unassigned"
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/SessionIdentitySection.tsx
var zh = [
	ma.Small,
	ma.Medium,
	ma.Large
], Bh = [
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
], Vh = [
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
], Hh = [
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
], Uh = () => {};
function Wh() {
	return /* @__PURE__ */ X("div", {
		className: "grid w-fit grid-cols-[200px_repeat(12,32px)] items-center gap-y-3",
		children: [
			/* @__PURE__ */ Y("span", {}),
			Bh.map((e) => /* @__PURE__ */ Y("span", {
				className: "col-span-3 label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			oa.map((e) => /* @__PURE__ */ X(ri, { children: [/* @__PURE__ */ Y("span", {
				className: "label-small truncate text-basic-secondary",
				children: e.label
			}), Bh.flatMap((t) => zh.map((n) => /* @__PURE__ */ Y("span", {
				className: P("flex items-center justify-center", t.className),
				children: /* @__PURE__ */ Y(ga, {
					behavior: e.id,
					size: n
				})
			}, `${t.label}-${n}`)))] }, e.id))
		]
	});
}
function Gh({ isMobile: e }) {
	let t = /* @__PURE__ */ Y(su, {
		title: "Chat session 1",
		isMobile: e,
		onPin: Uh,
		onRename: Uh,
		onDelete: Uh
	});
	return /* @__PURE__ */ X("div", {
		className: P("grid w-fit items-center gap-x-4 gap-y-2", e ? "grid-cols-[120px_repeat(4,240px)]" : "grid-cols-[120px_repeat(4,200px)]"),
		children: [
			/* @__PURE__ */ Y("span", {
				className: "label-micro text-basic-muted",
				children: e ? "Mobile" : "Desktop"
			}),
			Vh.map((e) => /* @__PURE__ */ Y("span", {
				className: "label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			Hh.map((n) => /* @__PURE__ */ X(ri, { children: [/* @__PURE__ */ Y("span", {
				className: "label-small text-basic-secondary",
				children: n.label
			}), Vh.map((r) => /* @__PURE__ */ Y(va, {
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
function Kh() {
	return /* @__PURE__ */ Y(Ri, {
		title: "Project navigation",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ Y(Wh, {}),
				/* @__PURE__ */ X("div", {
					className: "flex items-start gap-2",
					children: [
						/* @__PURE__ */ Y(Oa, {
							title: "Fix the parser",
							behavior: "direct",
							showBehaviorIcon: !0,
							active: !0
						}),
						/* @__PURE__ */ Y(Oa, {
							title: "Rewrite the store layer",
							behavior: "direct-with-orchestrator",
							showBehaviorIcon: !0
						}),
						/* @__PURE__ */ Y(Oa, {
							title: "Investigating",
							behavior: "orchestrator",
							showBehaviorIcon: !0,
							running: !0
						}),
						/* @__PURE__ */ Y(Oa, {
							title: "Without NAC",
							behavior: "direct"
						}),
						/* @__PURE__ */ Y(Oa, {
							title: "Fork: Fix the parser",
							forkedFromTitle: "Fix the parser"
						}),
						/* @__PURE__ */ Y(Oa, {
							title: "Fork running",
							forkedFromTitle: "Fix the parser",
							running: !0
						})
					]
				}),
				/* @__PURE__ */ Y(Gh, { isMobile: !1 }),
				/* @__PURE__ */ Y(Gh, { isMobile: !0 }),
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-2 max-w-[320px]",
					children: [/* @__PURE__ */ Y(Ic, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title"
					}), /* @__PURE__ */ Y(Ic, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title",
						deleted: !0
					})]
				}),
				/* @__PURE__ */ X("div", {
					className: "flex flex-col gap-1 max-w-[320px]",
					children: [
						/* @__PURE__ */ Y(Rl, {
							entityId: Lh[3],
							name: "arcee-ai/nac",
							trailing: "4",
							active: !0
						}),
						/* @__PURE__ */ Y(Rl, {
							entityId: Lh[4],
							name: "arcee-ai/telos",
							trailing: "1",
							running: !0
						}),
						/* @__PURE__ */ Y(Rl, {
							entityId: Lh[5],
							name: "Unassigned session",
							variant: Ll.Orphan
						})
					]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/TypographySection.tsx
function qh() {
	return /* @__PURE__ */ Y(Ri, {
		title: "Typography",
		children: /* @__PURE__ */ X("div", {
			className: "p-4 flex flex-col gap-2",
			children: [
				/* @__PURE__ */ Y("div", {
					className: "title",
					children: "Title"
				}),
				/* @__PURE__ */ Y("div", {
					className: "header-medium",
					children: "Header medium"
				}),
				/* @__PURE__ */ Y("div", {
					className: "label-small text-basic-secondary",
					children: "Label small"
				}),
				/* @__PURE__ */ Y("div", {
					className: "paragraph-medium text-basic-secondary",
					children: "Paragraph medium on the secondary text token."
				}),
				/* @__PURE__ */ Y("div", {
					className: "code code-small text-basic-muted",
					children: "code-small / IBM Plex Mono"
				})
			]
		})
	});
}
// src/app/components/pages/DesignPreviewPage.tsx
function Jh() {
	let [e, t] = q(!1);
	return /* @__PURE__ */ X("div", {
		className: "h-full overflow-y-auto bg-elevation-ground text-basic-primary",
		children: [
			/* @__PURE__ */ X("header", {
				className: "flex items-center gap-4 h-14 px-6 border-b border-secondary",
				children: [/* @__PURE__ */ Y(ol, { height: 18 }), /* @__PURE__ */ Y("span", {
					className: "text-basic-muted label-small",
					children: "design system"
				})]
			}),
			/* @__PURE__ */ X("main", {
				className: "p-6 flex flex-col gap-6 max-w-[1100px]",
				children: [
					/* @__PURE__ */ Y(xh, {}),
					/* @__PURE__ */ Y(ah, {}),
					/* @__PURE__ */ Y(kh, { onOpenModal: () => t(!0) }),
					/* @__PURE__ */ Y(Ih, {}),
					/* @__PURE__ */ Y(wh, {}),
					/* @__PURE__ */ Y(Ph, {}),
					/* @__PURE__ */ Y(Rh, {}),
					/* @__PURE__ */ Y(Kh, {}),
					/* @__PURE__ */ Y(Nh, {}),
					/* @__PURE__ */ Y(ih, {}),
					/* @__PURE__ */ Y(Fh, {}),
					/* @__PURE__ */ Y(Dh, {}),
					/* @__PURE__ */ Y(Eh, {}),
					/* @__PURE__ */ Y(qh, {})
				]
			}),
			/* @__PURE__ */ Y(tn, {
				open: e,
				onClose: () => t(!1),
				title: "Delete session",
				footer: /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(I, {
					variant: H.Secondary,
					onClick: () => t(!1),
					children: "Cancel"
				}), /* @__PURE__ */ Y(I, {
					variant: H.SecondaryDestructive,
					onClick: () => t(!1),
					children: "Delete"
				})] }),
				children: "This is the shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom."
			})
		]
	});
}
// src/app/components/pages/ProjectRedirectPage.tsx
var Yh = /* @__PURE__ */ new Map();
function Xh() {
	let { projectId: e = "" } = Ei(), t = hp(), n = fr(), r = ie(), i = fn(), [a, o] = q(null), s = r.refetch, c = i.refetch;
	W(() => {
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
	let l = G(() => r.data?.projects.find((t) => t.project_id === e) ?? null, [r.data, e]), u = G(() => mu(At(n, i.data ?? []), e), [
		i.data,
		e,
		n
	]), d = r.isLoading || i.isLoading, p = r.isFetching || i.isFetching, m = r.isError || i.isError, h = r.isSuccess && i.isSuccess, g = a === e && !d && !p && !m && h && l != null && u == null, _ = t.newChat;
	W(() => {
		if (!g) return;
		let t = Yh.get(e);
		t || (t = _(e, Et(n, i.data ?? [], e)).finally(() => {
			Yh.delete(e);
		}), Yh.set(e, t));
	}, [
		g,
		_,
		e,
		n,
		i.data
	]);
	let v = a === e;
	return v && !d && !l ? /* @__PURE__ */ Y(bi, {
		to: kr.list(),
		replace: !0
	}) : v && u ? /* @__PURE__ */ Y(bi, {
		to: kr.session(u.summary.session_id),
		replace: !0
	}) : /* @__PURE__ */ Y("div", {
		className: "flex h-full items-center justify-center",
		children: /* @__PURE__ */ Y(f, { size: mt.Large })
	});
}
// src/app/components/projects/ProjectCardActions.tsx
function Zh({ title: e, icon: t, onClick: n, variant: r = H.Ghost, disabled: i = !1 }) {
	return /* @__PURE__ */ Y(Ir, {
		title: e,
		position: R.TopCenter,
		sticky: !0,
		children: /* @__PURE__ */ Y(I, {
			variant: r,
			size: z.Small,
			content: L.Icon,
			"aria-label": e,
			disabled: i,
			onClick: (e) => {
				e.stopPropagation(), n();
			},
			children: /* @__PURE__ */ Y(B, { iconName: t })
		})
	});
}
function Qh({ orphan: e, pinned: t, onDelete: n, onTogglePin: r, onRename: i, onAssign: a, reorder: o }) {
	return /* @__PURE__ */ X("div", {
		className: o ? "flex items-center gap-1.5 shrink-0" : "flex items-center gap-4 xl:gap-1.5 shrink-0",
		children: [o ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Zh, {
			title: "Move down",
			icon: V.ArrowDown,
			disabled: !o.canMoveDown,
			onClick: o.onMoveDown
		}), /* @__PURE__ */ Y(Zh, {
			title: "Move up",
			icon: V.ArrowTop,
			disabled: !o.canMoveUp,
			onClick: o.onMoveUp
		})] }) : null, e ? /* @__PURE__ */ X(J, { children: [
			i ? /* @__PURE__ */ Y(Zh, {
				title: "Edit",
				icon: V.Edit,
				onClick: i
			}) : null,
			a ? /* @__PURE__ */ Y(Zh, {
				title: "Assign to project",
				icon: V.FolderOpen,
				onClick: a
			}) : null,
			/* @__PURE__ */ Y(Zh, {
				title: "Delete chat",
				icon: V.Trash,
				variant: H.GhostDestructive,
				onClick: n
			})
		] }) : /* @__PURE__ */ X(J, { children: [
			r ? /* @__PURE__ */ Y(Zh, {
				title: t ? "Unpin project" : "Pin project",
				icon: t ? V.Unpin : V.Pin,
				onClick: r
			}) : null,
			i ? /* @__PURE__ */ Y(Zh, {
				title: "Rename project",
				icon: V.Edit,
				onClick: i
			}) : null,
			/* @__PURE__ */ Y(Zh, {
				title: "Remove project",
				icon: V.Trash,
				variant: H.GhostDestructive,
				onClick: n
			})
		] })]
	});
}
// src/app/components/projects/ProjectCard.tsx
var $h = {
	default: "--color-bg-btn-ghost",
	hovered: "--color-bg-btn-ghost-hovered",
	pressed: "--color-bg-btn-ghost-pressed",
	highlighted: "--color-bg-btn-ghost-highlighted",
	highlightedHovered: "--color-bg-btn-ghost-highlighted-hovered",
	highlightedPressed: "--color-bg-btn-ghost-highlighted-pressed"
};
function eg({ highlighted: e, hover: t, pressed: n }) {
	return n ? e ? $h.highlightedPressed : $h.pressed : t ? e ? $h.highlightedHovered : $h.hovered : e ? $h.highlighted : $h.default;
}
function tg(e, t) {
	if (e.kind === "project") {
		let { project: t, sessions: n, running: r, totalCostMicros: i } = e.entry, a = n.find((e) => rt(e.active_run));
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
	let { summary: n, active_run: r } = e.session, i = rt(r);
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
function ng({ facts: e }) {
	let t = e.costMicros > 0 ? Yr(e.costMicros) : null;
	return /* @__PURE__ */ X("div", {
		className: "flex items-center gap-2.5 shrink-0 min-w-0",
		children: [t ? /* @__PURE__ */ Y("span", {
			className: "text-micro text-basic-primary whitespace-nowrap",
			children: t
		}) : null, e.countLabel ? /* @__PURE__ */ Y("span", {
			className: "text-micro text-info-primary whitespace-nowrap truncate",
			children: e.countLabel
		}) : null]
	});
}
function rg({ facts: e }) {
	let t = Jt(e.representative?.backend);
	return /* @__PURE__ */ X("div", {
		className: "flex flex-wrap items-center gap-2.5 min-w-0 whitespace-nowrap",
		children: [/* @__PURE__ */ Y("span", {
			className: "label-micro text-basic-tertiary",
			children: Pn(e.representative)
		}), t ? /* @__PURE__ */ Y("span", {
			className: "text-micro text-basic-muted truncate md:max-w-[128px]",
			children: t
		}) : null]
	});
}
function ig({ getCardElement: e, onReorderStart: t }) {
	return /* @__PURE__ */ X("button", {
		type: "button",
		"aria-label": "Drag to reorder",
		className: P("absolute right-1.5 top-1/2 z-1 -translate-y-1/2", "flex h-6 items-center gap-[3px]", "cursor-grab active:cursor-grabbing touch-none", "rounded-sm border-0 bg-transparent p-0"),
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
		children: [/* @__PURE__ */ Y("span", { className: "h-full w-px rounded-[2px] bg-divider-primary" }), /* @__PURE__ */ Y("span", { className: "h-full w-px rounded-[2px] bg-divider-primary" })]
	});
}
function ag({ item: e, selected: t, attention: n, onOpen: r, onDelete: i, onTogglePin: a, onRename: o, onAssign: s, reorder: c, dragging: l = !1 }) {
	let u = tg(e, uu()), d = u.representative?.model_config_error, p = Le(), m = S(), [h, g] = q(!1), [_, v] = q(!1), [y, b] = q(!1), x = K(!1), C = K(null), w = !m || h || _ || t, T = !!c && m, E = !!c && !m, D = m && h, O = () => {
		x.current ? x.current = !1 : r();
	};
	return /* @__PURE__ */ X("div", {
		ref: C,
		"data-item-id": u.id,
		"data-item-kind": u.orphan ? "orphan" : "project",
		"data-item-pinned": u.pinned ? "true" : "false",
		className: P("group fade relative flex flex-col rounded-[8px] overflow-hidden cursor-default", p ? "gap-4 px-4 pt-4 pb-2" : "gap-4 px-6 pt-5 pb-3", "shadow-convex bg-elevation-level-1", l && "shadow-lg"),
		role: "button",
		tabIndex: 0,
		"aria-pressed": t,
		onClick: O,
		onKeyDown: (e) => {
			e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), O());
		},
		onMouseEnter: () => {
			m && g(!0);
		},
		onMouseLeave: () => {
			g(!1), b(!1);
		},
		onFocus: () => v(!0),
		onBlur: () => v(!1),
		onPointerDown: (e) => {
			e.button === 0 && !e.target.closest("button, a, input, textarea") && b(!0);
		},
		onPointerUp: () => b(!1),
		onPointerCancel: () => b(!1),
		children: [
			/* @__PURE__ */ Y("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none ease-out",
				style: { backgroundColor: `var(${eg({
					highlighted: u.running,
					hover: D,
					pressed: y
				})})` }
			}),
			t || _ || l ? /* @__PURE__ */ Y("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none border-2",
				style: { borderColor: "var(--blue-500)" }
			}) : null,
			n ? /* @__PURE__ */ Y(Ir, {
				title: "Run finished",
				position: R.BottomLeft,
				sticky: !0,
				className: "absolute left-2 top-2 z-1",
				children: /* @__PURE__ */ Y("span", { className: "block size-2 rounded-full bg-accent-primary" })
			}) : null,
			T && c ? /* @__PURE__ */ Y(ig, {
				getCardElement: () => C.current,
				onReorderStart: (e) => {
					x.current = !0, c.onReorderStart(e), window.setTimeout(() => {
						x.current = !1;
					}, 100);
				}
			}) : null,
			/* @__PURE__ */ X("div", {
				className: "relative flex items-center gap-4 w-full",
				children: [u.orphan ? /* @__PURE__ */ Y(Ea, { isRunning: u.running }) : /* @__PURE__ */ Y(Il, {
					id: u.id,
					size: 40,
					isRunning: u.running
				}), /* @__PURE__ */ X("div", {
					className: "flex flex-col gap-0.5 flex-1 min-w-0",
					children: [/* @__PURE__ */ X("div", {
						className: "flex items-center gap-1.5 w-full",
						children: [
							u.pinned ? /* @__PURE__ */ Y(B, {
								iconName: V.Pin,
								className: "text-basic-secondary shrink-0"
							}) : null,
							/* @__PURE__ */ Y("div", {
								className: P("header-md flex-1 min-w-0 truncate", u.running ? "text-shimmer-basic" : "text-basic-primary"),
								children: u.title
							}),
							d ? /* @__PURE__ */ Y(Ir, {
								title: d,
								position: R.BottomRight,
								sticky: !0,
								children: /* @__PURE__ */ Y(B, {
									iconName: V.Repair,
									className: "text-error-primary shrink-0"
								})
							}) : null,
							u.running ? u.orphan ? /* @__PURE__ */ Y(f, {
								size: mt.XSmall,
								className: "shrink-0"
							}) : /* @__PURE__ */ X("div", {
								className: "flex items-center gap-1 shrink-0",
								children: [/* @__PURE__ */ Y(f, { size: mt.XSmall }), /* @__PURE__ */ X("span", {
									className: "text-micro text-basic-primary whitespace-nowrap",
									children: [u.runningCount, " Running"]
								})]
							}) : null
						]
					}), /* @__PURE__ */ Y("div", {
						className: "code code-micro text-basic-tertiary truncate w-full",
						children: u.cwd
					})]
				})]
			}),
			m ? null : /* @__PURE__ */ Y(rg, { facts: u }),
			/* @__PURE__ */ X("div", {
				className: "relative flex items-center justify-between w-full h-6 gap-2",
				children: [/* @__PURE__ */ Y(ng, { facts: u }), w ? /* @__PURE__ */ Y(Qh, {
					orphan: u.orphan,
					pinned: u.pinned,
					onTogglePin: a,
					onRename: o,
					onDelete: i,
					onAssign: s,
					reorder: E && c ? {
						canMoveUp: c.canMoveUp,
						canMoveDown: c.canMoveDown,
						onMoveUp: c.onMoveUp,
						onMoveDown: c.onMoveDown
					} : void 0
				}) : /* @__PURE__ */ Y(rg, { facts: u })]
			})
		]
	});
}
// src/app/components/projects/ProjectsEmptyState.tsx
function og({ onStart: e, onAddRepository: t, onManagedSettings: n, modelReady: r, githubConnected: i, mobile: a }) {
	let o = t != null;
	return /* @__PURE__ */ Y("div", {
		className: P("flex h-full flex-col items-center justify-center py-16", a ? "px-4" : "px-6"),
		children: /* @__PURE__ */ X("div", {
			className: "flex w-[420px] max-w-full flex-col items-center gap-6",
			children: [
				/* @__PURE__ */ Y(Xl, {}),
				/* @__PURE__ */ X("div", {
					className: "w-full text-center",
					children: [/* @__PURE__ */ Y("p", {
						className: "header-2xl text-basic-primary",
						children: "No projects yet"
					}), /* @__PURE__ */ Y("p", {
						className: "text-medium text-basic-tertiary",
						children: o ? "Connect a repository or create a Project from an existing path." : "Create your first and start building!"
					})]
				}),
				o ? /* @__PURE__ */ X("div", {
					className: "grid w-full grid-cols-1 gap-2 rounded-lg border border-basic p-4 text-left sm:grid-cols-3",
					"data-testid": "managed-empty-status",
					children: [
						/* @__PURE__ */ Y(sg, {
							label: "Arcee model",
							value: r ? "Ready" : "Needs attention",
							ready: !!r
						}),
						/* @__PURE__ */ Y(sg, {
							label: "GitHub",
							value: i ? "Connected" : "Not connected",
							ready: !!i
						}),
						/* @__PURE__ */ Y(sg, {
							label: "Projects",
							value: "None",
							ready: !1
						})
					]
				}) : null,
				/* @__PURE__ */ X("div", {
					className: "flex flex-wrap justify-center gap-2",
					children: [
						/* @__PURE__ */ Y(I, {
							variant: H.Primary,
							size: z.Large,
							content: L.Text,
							onClick: o ? t : e,
							children: o ? "Add repository" : "Get Started"
						}),
						o ? /* @__PURE__ */ Y(I, {
							variant: H.Secondary,
							size: z.Large,
							content: L.Text,
							onClick: e,
							children: "Create Project"
						}) : null,
						o && !i && n ? /* @__PURE__ */ Y(I, {
							variant: H.Tertiary,
							size: z.Large,
							content: L.Text,
							onClick: n,
							children: "Connect GitHub"
						}) : null
					]
				})
			]
		})
	});
}
function sg({ label: e, value: t, ready: n }) {
	return /* @__PURE__ */ X("div", {
		className: "min-w-0",
		children: [/* @__PURE__ */ Y("p", {
			className: "text-small text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ Y("p", {
			className: `label-small ${n ? "text-success-primary" : "text-basic-primary"}`,
			children: t
		})]
	});
}
// src/app/components/pages/ProjectsListPage.tsx
function cg({ children: e, single: t }) {
	return /* @__PURE__ */ Y("div", {
		className: P("grid gap-2", t ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]"),
		children: e
	});
}
function lg() {
	return /* @__PURE__ */ Y("div", {
		"aria-hidden": !0,
		className: "min-h-[112px] rounded-[8px] border-2",
		style: { borderColor: "var(--blue-500)" }
	});
}
function ug(e) {
	return e.kind === "project" ? e.entry.sessions.map((e) => e.summary.session_id) : [e.session.summary.session_id];
}
function dg(e) {
	return e.kind === "project" && e.entry.project.pinned;
}
function fg({ item: e, onOpen: t, reorderable: r, dragging: i, canMoveUp: a, canMoveDown: o, onMoveUp: s, onMoveDown: c, onReorderStart: l }) {
	let { useAnyAttention: u } = n().stores.attentionStore, d = hp(), f = kp(), p = {
		item: e,
		selected: !1,
		attention: u(ug(e)),
		dragging: i,
		onOpen: () => t(e),
		reorder: r ? {
			canMoveUp: a,
			canMoveDown: o,
			onMoveUp: s,
			onMoveDown: c,
			onReorderStart: l
		} : void 0
	};
	if (e.kind === "project") {
		let { project: t } = e.entry;
		return /* @__PURE__ */ Y(ag, {
			...p,
			onTogglePin: () => void d.togglePin(t),
			onRename: () => d.rename(t),
			onDelete: () => d.remove(t)
		});
	}
	let { summary: m } = e.session;
	return /* @__PURE__ */ Y(ag, {
		...p,
		onRename: () => f.rename(m),
		onDelete: () => f.remove(m),
		onAssign: () => d.assign(m)
	});
}
function pg(e, t, n, r) {
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
function mg(e, t) {
	return e.filter((e) => e.pinned === t).sort((e, t) => e.sort_order - t.sort_order);
}
function hg() {
	let { useVisibleProjectItems: e, useIsDefaultSort: t, useFilterQuery: r, setQuery: i } = n().stores.sessionFiltersStore, { trackAttention: a, clearAttentionAll: o } = n().stores.attentionStore, s = Ti(), l = Le(), u = hp(), d = Mm(), f = Cn(), p = r(), m = t(), h = dt(), g = rr(), [_, v] = q(!1), [y, b] = q(null), [x, S] = q(null), [C, w] = q(!1), T = K(null), E = K(null), D = K(!1), { data: O, isLoading: k, error: A, refetch: j } = cr(), ee = ie(), M = fr(), te = G(() => At(M, O ?? []), [O, M]), ne = G(() => ee.data?.projects ?? [], [ee.data]), N = G(() => yu(ne, te), [ne, te]), re = e(N);
	W(() => {
		O && a(O, null);
	}, [O, a]);
	let ae = (e) => {
		let t = vu(e);
		o(ug(e)), s(e.kind === "project" ? kr.project(t) : kr.session(t));
	}, oe = re.filter(dg), se = re.filter((e) => e.kind === "project" && !dg(e)), ce = re.filter((e) => e.kind === "orphan"), le = G(() => mg(ne, !0), [ne]), ue = G(() => mg(ne, !1), [ne]), F = G(() => _u(te), [te]), de = G(() => Ln(te, !1), [te]), fe = U(() => {
		T.current = null, E.current = null, D.current = !1, b(null), S(null), w(!1);
	}, []), pe = U(async (e, t, n) => {
		let r = mg(ne, t).findIndex((t) => t.project_id === e), i = ne.find((t) => t.project_id === e);
		if (i && i.pinned === t && r === n) fe();
		else try {
			await h.mutateAsync({
				projects: ne,
				projectId: e,
				targetPinned: t,
				targetIndex: n
			});
		} catch (e) {
			f.error(`Failed to reorder projects: ${mr($(e))}`);
		} finally {
			fe();
		}
	}, [
		ne,
		fe,
		h,
		f
	]), me = U(async (e, t) => {
		try {
			await g.mutateAsync({
				sessions: te,
				sessionId: e,
				targetPinned: !1,
				targetIndex: t
			});
		} catch (e) {
			f.error(`Failed to reorder chats: ${mr($(e))}`);
		} finally {
			fe();
		}
	}, [
		te,
		fe,
		g,
		f
	]), he = U(async (e, t) => {
		let n = te.find((t) => t.summary.session_id === e), r = ne.find((e) => e.project_id === t);
		if (!n || !r) fe();
		else if (Cu(ne, n.summary)?.project_id !== r.project_id) f.error("That chat does not run in this project's location"), fe();
		else try {
			u.assign(n.summary);
		} finally {
			fe();
		}
	}, [
		te,
		fe,
		u,
		ne,
		f
	]), ge = U((e, t) => {
		let n = e.pinned ? le : ue, r = n.findIndex((t) => t.project_id === e.project_id);
		if (r < 0) return;
		let i = r + t;
		i < 0 || i >= n.length || pe(e.project_id, e.pinned, i);
	}, [
		le,
		ue,
		pe
	]), _e = U((e, t) => {
		let n = F.findIndex((t) => t.summary.session_id === e), r = n < 0 ? void 0 : F[n + t];
		if (!r) return;
		let i = c(de, r.summary.session_id, t === -1 ? "before" : "after", e);
		me(e, i);
	}, [
		F,
		de,
		me
	]), ve = U((e, t, n) => {
		if (t === "orphan") {
			let t = ne.find((e) => e.project_id === n.itemId);
			if (t) {
				he(e, t.project_id);
				return;
			}
			if (n.itemId === e) {
				fe();
				return;
			}
			let r = c(de, n.itemId, n.edge, e);
			me(e, r);
			return;
		}
		let r = ne.find((e) => e.project_id === n.itemId);
		if (!r || n.itemId === e) {
			fe();
			return;
		}
		let i = mg(ne, r.pinned).map((e) => e.project_id).filter((t) => t !== e).indexOf(n.itemId);
		i < 0 ? fe() : pe(e, r.pinned, n.edge === "before" ? i : i + 1);
	}, [
		he,
		fe,
		de,
		me,
		pe,
		ne
	]), ye = U((e) => {
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
		T.current = t, b(t);
	}, []);
	W(() => {
		if (!y) return;
		let e = (e) => {
			let t = T.current;
			if (!t) return;
			let n = {
				...t,
				x: e.clientX - t.offsetX,
				y: e.clientY - t.offsetY
			};
			T.current = n, b(n);
			let r = pg(e.clientX, e.clientY, t.itemId, t.kind);
			r === "pin-zone" ? (D.current = !0, E.current = null, w(!0), S(null)) : (D.current = !1, w(!1), r && (E.current = r, S((e) => e?.itemId === r.itemId && e.edge === r.edge ? e : r)));
		}, t = () => {
			let e = T.current;
			if (!e) {
				fe();
				return;
			}
			if (D.current && e.kind === "project") {
				pe(e.itemId, !0, 0);
				return;
			}
			let t = E.current;
			t ? ve(e.itemId, e.kind, t) : fe();
		};
		return window.addEventListener("pointermove", e), window.addEventListener("pointerup", t), window.addEventListener("pointercancel", t), () => {
			window.removeEventListener("pointermove", e), window.removeEventListener("pointerup", t), window.removeEventListener("pointercancel", t);
		};
	}, [
		ve,
		fe,
		y,
		pe
	]);
	let be = (e) => {
		let t = vu(e), n = e.kind === "project" ? e.entry.project : null, r = n ? n.pinned ? le : ue : [], i = n ? r.findIndex((e) => e.project_id === n.project_id) : -1, a = e.kind === "orphan" ? F.findIndex((e) => e.summary.session_id === t) : -1, o = n ? i : a, s = n ? r.length : F.length, c = y?.itemId === t, l = !c && x?.itemId === t ? x.edge : null;
		return /* @__PURE__ */ X(ri, { children: [
			l === "before" ? /* @__PURE__ */ Y(lg, {}) : null,
			/* @__PURE__ */ Y("div", {
				"data-item-id": t,
				"data-item-kind": e.kind,
				"data-dragging": c ? "true" : void 0,
				className: "relative",
				style: c && y ? {
					position: "fixed",
					left: y.x,
					top: y.y,
					width: y.width,
					zIndex: 50,
					pointerEvents: "none",
					margin: 0
				} : void 0,
				children: /* @__PURE__ */ Y(fg, {
					item: e,
					onOpen: ae,
					reorderable: m,
					dragging: c,
					canMoveUp: o > 0,
					canMoveDown: o >= 0 && o < s - 1,
					onMoveUp: () => {
						n ? ge(n, -1) : e.kind === "orphan" && _e(t, -1);
					},
					onMoveDown: () => {
						n ? ge(n, 1) : e.kind === "orphan" && _e(t, 1);
					},
					onReorderStart: ye
				})
			}),
			l === "after" ? /* @__PURE__ */ Y(lg, {}) : null
		] }, t);
	}, xe = /* @__PURE__ */ X("div", {
		className: "fixed inset-x-0 top-16 z-10 flex items-start gap-3 px-2 py-4",
		children: [/* @__PURE__ */ Y(Qc, {
			className: "flex-1 min-w-0",
			variant: Zc.Search,
			placeholder: "Search projects…",
			value: p,
			onChange: (e) => i(e.target.value),
			onClear: () => i(""),
			"aria-label": "Search projects"
		}), /* @__PURE__ */ Y(gn, {
			variant: H.Secondary,
			content: L.Icon,
			"aria-label": "Filters",
			"aria-expanded": _,
			onClick: () => v(!0),
			children: /* @__PURE__ */ Y(B, { iconName: V.Controls })
		})]
	}), Se = /* @__PURE__ */ Y(tn, {
		open: _,
		onClose: () => v(!1),
		title: "Filters",
		bodyClassName: "p-0",
		children: /* @__PURE__ */ Y(Hm, {
			sessions: te,
			showSearch: !1,
			mobile: !0,
			onChange: () => v(!1)
		})
	});
	if (!k && !A && N.length === 0) return /* @__PURE__ */ X("div", {
		className: "flex h-full min-h-0",
		children: [l ? null : /* @__PURE__ */ Y(rh, { variant: "projects" }), /* @__PURE__ */ Y("div", {
			className: "min-h-0 min-w-0 flex-1",
			children: /* @__PURE__ */ Y(og, {
				mobile: l,
				onStart: u.create,
				onAddRepository: d.isManaged ? d.addRepository : void 0,
				onManagedSettings: d.isManaged ? d.openSettings : void 0,
				modelReady: d.status?.model_ready,
				githubConnected: d.status?.github_status === "connected"
			})
		})]
	});
	let Ce = m && y != null && y.kind === "project" && oe.length === 0 && !ne.find((e) => e.project_id === y.itemId)?.pinned;
	return /* @__PURE__ */ X("div", {
		className: "flex h-full min-h-0",
		children: [
			l ? null : /* @__PURE__ */ Y(rh, { variant: "projects" }),
			l ? xe : null,
			l ? Se : null,
			/* @__PURE__ */ Y("div", {
				className: P("flex-1 min-h-0 overflow-auto", l ? "px-2" : "px-8", y && "select-none cursor-grabbing"),
				children: /* @__PURE__ */ X("div", {
					className: P("flex flex-col gap-6 [&>*]:shrink-0", l ? "pt-36 pb-8" : "py-4"),
					children: [
						A ? /* @__PURE__ */ X("div", {
							className: "flex items-center gap-2 label-small text-error-primary",
							children: [/* @__PURE__ */ Y("span", { children: mr(A) }), /* @__PURE__ */ Y(I, {
								variant: H.Ghost,
								size: z.Small,
								content: L.Text,
								onClick: () => {
									j();
								},
								children: "Try again"
							})]
						}) : null,
						!k && !A && re.length === 0 ? /* @__PURE__ */ Y("div", {
							className: "label-small text-basic-muted text-center py-16",
							children: "No projects match the current filters."
						}) : null,
						oe.length > 0 || Ce ? /* @__PURE__ */ X(cg, {
							single: l,
							children: [oe.map(be), Ce ? /* @__PURE__ */ Y("div", {
								"data-pin-drop-zone": "true",
								className: P("min-h-[112px] rounded-[8px] border-2 border-dashed", C && "bg-info-primary/10"),
								style: { borderColor: "var(--blue-500)" }
							}) : null]
						}) : null,
						se.length > 0 ? /* @__PURE__ */ Y(cg, {
							single: l,
							children: se.map(be)
						}) : null,
						ce.length > 0 ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(cu, { children: "Unassigned chat sessions" }), /* @__PURE__ */ Y(cg, {
							single: l,
							children: ce.map(be)
						})] }) : null
					]
				})
			})
		]
	});
}
// src/app/components/inspector/BranchPicker.tsx
function gg(e, t, n) {
	return e ? "A run is in flight; wait for it to finish." : t && !n ? "Uncommitted changes: commit or stash them before switching." : null;
}
function _g({ label: e, icon: t, active: n, disabled: r, title: i, onClick: a }) {
	let o = Le();
	return /* @__PURE__ */ X(Gl, {
		type: "button",
		size: o ? Hl.Large : Hl.Small,
		active: n,
		disabled: r,
		title: i,
		onClick: a,
		children: [/* @__PURE__ */ Y(B, {
			iconName: t,
			className: "shrink-0"
		}), /* @__PURE__ */ Y("span", {
			className: "flex-1 min-w-0 truncate text-left",
			children: e
		})]
	});
}
function vg({ busy: e, children: t }) {
	return /* @__PURE__ */ X("div", {
		className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
		children: [e ? /* @__PURE__ */ Y(f, {
			size: mt.Small,
			variant: se.Neutral
		}) : null, t]
	});
}
function yg({ sessionId: e, branch: t, placement: r = R.TopRight }) {
	let { useRunning: i } = n().stores.runtimeStore, [a, o] = q(!1), [s, c] = q(""), l = i(e), { data: u, isLoading: d, error: f } = te(e, a), p = lr(e), m = () => {
		o(!1), c(""), p.reset();
	}, h = s.trim(), g = (u?.branches ?? []).filter((e) => e.name.toLowerCase().includes(h.toLowerCase())), _ = (u?.branches ?? []).some((e) => e.name === h), v = u?.dirty ?? !1, y = gg(l, v, !0), b = gg(l, v, !1), x = Le(), S = (e, t) => {
		p.mutate({
			name: e,
			create: t
		}, { onSuccess: m });
	}, C = f ? mr(f) : p.error ? mr(p.error) : null;
	return /* @__PURE__ */ Y(Zr, {
		open: a,
		onClose: m,
		placement: r,
		sticky: !0,
		className: "min-w-0",
		content: /* @__PURE__ */ X("div", {
			className: "h-[calc(70dvh)] md:h-[280px] flex flex-col",
			children: [
				/* @__PURE__ */ X("div", {
					className: "p-4 pt-0 md:pb-2 md:px-0 flex flex-col gap-2 shrink-0",
					children: [/* @__PURE__ */ Y(Q, {
						autoFocus: !0,
						inputSize: x ? Z.Large : Z.Small,
						placeholder: "Find or create a branch",
						value: s,
						onChange: (e) => c(e.target.value)
					}), h && !_ && !f ? /* @__PURE__ */ Y(_g, {
						label: /* @__PURE__ */ X(J, { children: ["Create ", /* @__PURE__ */ Y("span", {
							className: "text-basic-primary",
							children: h
						})] }),
						icon: V.Add,
						disabled: !!y,
						title: y ?? void 0,
						onClick: () => S(h, !0)
					}) : null]
				}),
				d ? /* @__PURE__ */ Y("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ Y(vg, {
						busy: !0,
						children: "Reading branches…"
					})
				}) : null,
				!d && !f ? /* @__PURE__ */ X("div", {
					className: "flex flex-col flex-1 min-h-0 gap-2 md:gap-1 p-2 md:p-0 overflow-auto [&>*]:shrink-0",
					children: [g.map((e) => {
						let t = e.is_current ? null : b;
						return /* @__PURE__ */ Y(_g, {
							label: e.name,
							icon: e.is_current ? V.Check : V.Scheme,
							active: e.is_current,
							disabled: !!t,
							title: t ?? void 0,
							onClick: e.is_current ? () => {} : () => S(e.name, !1)
						}, e.name);
					}), g.length === 0 && !h ? /* @__PURE__ */ Y(vg, { children: "No local branches." }) : null]
				}) : null,
				p.isPending ? /* @__PURE__ */ Y("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ Y(vg, {
						busy: !0,
						children: "Working…"
					})
				}) : null,
				C ? /* @__PURE__ */ Y("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ Y(gl, {
						variant: sl.Error,
						title: C
					})
				}) : null,
				!C && v && !l ? /* @__PURE__ */ Y("div", {
					className: "shrink-0 px-4 pt-2 md:px-0 md:pt-0",
					children: /* @__PURE__ */ Y(gl, {
						variant: sl.Info,
						title: "Uncommitted changes: you can branch off them, but not switch away."
					})
				}) : null
			]
		}),
		children: /* @__PURE__ */ X("button", {
			type: "button",
			className: "flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost",
			"aria-expanded": a,
			"aria-label": `Branch: ${t}`,
			onClick: () => a ? m() : o(!0),
			children: [/* @__PURE__ */ Y(B, {
				iconName: V.Scheme,
				size: 16,
				className: "shrink-0"
			}), /* @__PURE__ */ Y("span", {
				className: "label-micro text-btn-secondary truncate max-w-[64px] xl:max-w-[128px]",
				children: t
			})]
		})
	});
}
// src/app/features/terminal-selection/TerminalSelectionAttachment.tsx
function bg({ evidence: e, canonicalText: t, sessionId: n }) {
	let r = li(), i = e.attribution, a = n != null && i.source_session_id !== n;
	return /* @__PURE__ */ X("section", {
		"aria-labelledby": `${r}-title`,
		className: "w-full min-w-0 max-w-full rounded-lg border border-border-primary p-3 text-small text-basic-primary",
		children: [
			/* @__PURE__ */ Y("h3", {
				id: `${r}-title`,
				className: "font-medium",
				children: "Terminal selection"
			}),
			/* @__PURE__ */ X("p", {
				className: "text-basic-secondary mt-1",
				children: ["Reviewed rendered text · frozen capture. Live source availability is not checked.", a ? " Original source from another chat; no live access is granted." : ""]
			}),
			/* @__PURE__ */ Y("pre", {
				"aria-label": "Attached terminal output",
				tabIndex: 0,
				className: "mt-3 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3 font-mono",
				children: e.text
			}),
			e.user_text == null ? null : /* @__PURE__ */ X("div", {
				className: "mt-3",
				children: [/* @__PURE__ */ Y("span", {
					className: "text-basic-secondary",
					children: "Accompanying message"
				}), /* @__PURE__ */ Y("pre", {
					"aria-label": "Attached accompanying message",
					tabIndex: 0,
					className: "mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans",
					children: e.user_text
				})]
			}),
			/* @__PURE__ */ X("details", {
				className: "mt-3",
				children: [
					/* @__PURE__ */ Y("summary", {
						className: "cursor-pointer",
						children: "Source and capture details"
					}),
					/* @__PURE__ */ X("dl", {
						className: "mt-2 break-all",
						children: [
							/* @__PURE__ */ Y("dt", { children: "Source chat" }),
							/* @__PURE__ */ Y("dd", { children: i.source_session_id }),
							/* @__PURE__ */ Y("dt", { children: "Terminal" }),
							/* @__PURE__ */ Y("dd", { children: i.terminal_id }),
							/* @__PURE__ */ Y("dt", { children: "Process owner" }),
							/* @__PURE__ */ Y("dd", { children: i.owner_instance_id }),
							/* @__PURE__ */ Y("dt", { children: "Capture" }),
							/* @__PURE__ */ Y("dd", { children: i.capture_id }),
							i.client_capture_time_ms == null ? null : /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y("dt", { children: "Client capture time (client supplied, epoch ms)" }), /* @__PURE__ */ Y("dd", { children: i.client_capture_time_ms })] }),
							/* @__PURE__ */ Y("dt", { children: "Submission" }),
							/* @__PURE__ */ Y("dd", { children: i.admission_id })
						]
					}),
					/* @__PURE__ */ Y("p", {
						className: "mt-2 text-basic-secondary",
						children: "This evidence remains readable after the source exits or expires. It grants no terminal control."
					})
				]
			}),
			/* @__PURE__ */ X("details", {
				className: "mt-3",
				children: [/* @__PURE__ */ Y("summary", {
					className: "cursor-pointer",
					children: "Canonical message"
				}), /* @__PURE__ */ Y("pre", {
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
function xg(e) {
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
function Sg(e, t) {
	let n = K(null);
	return W(() => {
		let e = pt(on()), t = !0;
		return pt(kt(e, N(() => {
			t = !1;
		}))), n.current = { current: () => t }, () => pt(We(e, Bt));
	}, [e, t]), n;
}
// src/app/features/human-shell/workflow.ts
var Cg = class extends Tt("HumanCommandFailure") {};
function wg(e) {
	return e instanceof Cg ? e : new Cg({
		kind: "uncertain",
		cause: e
	});
}
function Tg(e) {
	return e.state === "accepted" || e.state === "started";
}
function Eg(e) {
	let { sessionId: t, intents: n } = e, r = () => o(pe({
		try: () => n.claim(t, e.command),
		catch: (e) => new Cg({
			kind: "blocked",
			cause: e
		})
	}), (e) => N(() => n.uncertain(t, e))), i = (r, i) => N(() => {
		i.kind === "uncertain" ? n.uncertain(t, r) : n.confirmed(t, r), e.settled();
	});
	return oe(Ve(function* () {
		let a = yield* r();
		if (a.request.command !== e.command) {
			let o = yield* dr({
				try: () => e.lookup(a.request.request_id),
				catch: wg
			}).pipe(ve((e) => i(a, e)));
			if (yield* N(() => {
				n.confirmed(t, a), e.settled();
			}), Tg(o)) return yield* je(new Cg({
				kind: "blocked",
				cause: /* @__PURE__ */ Error("The previous command is still active. Wait or explicitly cancel it before starting another.")
			}));
			a = yield* r();
		}
		let o = yield* dr({
			try: () => e.submit(a.request),
			catch: wg
		}).pipe(ve((e) => i(a, e)));
		return yield* N(() => {
			n.confirmed(t, a), e.settled();
		}), o;
	}));
}
async function Dg(e) {
	let t = await d(e);
	if (En(t)) return t.value;
	let n = Dr(t.cause);
	throw Sr(n) ? n.value.cause : Zn(t.cause);
}
// src/app/features/human-shell/queries.ts
function Og(e) {
	let t = vi(), { api: r, stores: { composerStore: { shellIntents: i } } } = n(), a = K(/* @__PURE__ */ new Map()).current, o = hi({
		mutationFn: (n) => {
			let o = a.get(n);
			if (a.delete(n), o === void 0) throw Error("Command attempt is unavailable.");
			return Dg(Eg({
				sessionId: e,
				command: o,
				intents: i,
				submit: (t) => r.submitShellCommand(e, t).catch((e) => {
					throw new Cg({
						kind: e instanceof _e && e.status < 500 ? "rejected" : e instanceof DOMException && e.name === "AbortError" ? "not-sent" : "uncertain",
						cause: e
					});
				}),
				lookup: (t) => r.getShellCommand(e, t).catch((e) => {
					throw new Cg({
						kind: "uncertain",
						cause: new ur(t, e)
					});
				}),
				settled: () => {
					t.invalidateQueries({ queryKey: Xt.sessionRoot(e) }), t.invalidateQueries({ queryKey: Xt.sessionsAll });
				}
			}));
		},
		retry: !1
	}), s = o.mutateAsync, c = U((e) => {
		let t = crypto.randomUUID();
		return a.set(t, e), s(t).finally(() => a.delete(t));
	}, [a, s]);
	return {
		isPending: o.isPending,
		isError: o.isError,
		error: o.error,
		data: o.data,
		mutateAsync: c
	};
}
function kg(e) {
	let { api: t } = n(), r = vi();
	return hi({
		mutationFn: (n) => t.cancelShellCommand(e, n),
		retry: !1,
		onSettled: () => r.invalidateQueries({ queryKey: Xt.sessionSnapshot(e) })
	});
}
function Ag(e, t, r, i) {
	let { api: a } = n();
	return _i({
		queryKey: [
			"session",
			e,
			"human-shell-output",
			t,
			r
		],
		queryFn: ({ signal: n }) => a.getShellOutput(e, t, r, n),
		enabled: i,
		retry: !1
	});
}
// src/app/components/inspector/ModelPicker.tsx
var jg = {
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
}, Mg = [{
	id: "",
	label: "Default effort",
	hoverHint: {
		...jg[""],
		muted: !0
	}
}, ...Gd.map((e) => ({
	...e,
	hoverHint: {
		...jg[e.id],
		muted: !0
	}
}))];
function Ng({ sessionId: e, metadata: t, label: n, disabled: r }) {
	let i = Cn(), a = Gn(), o = of(), s = Ze(a.data), c = Qr(), l = t?.model ?? n, u = t?.reasoning_effort ?? "", d = t ? {
		backend: t.backend,
		model: t.model,
		baseUrl: t.base_url ?? ""
	} : null, f = cd(a.data, t?.backend, l), p = G(() => Jd(f.supportedEfforts, u, Mg), [f.supportedEfforts, u]), m = p.find((e) => e.id === u)?.label, h = typeof m == "string" ? m : "Default effort", [g, _] = q(!1), v = async (n) => {
		if (!t || n.backend === t.backend && n.model === t.model) return;
		let r = a.data?.providers.find((e) => e.id === n.backend), s = n.backend === t.backend, l = !!(r?.auth_status === "ready" || o.matches(n) && o.credentialReady);
		if (!s && !l) {
			i.error(`Connect ${n.backend} in session settings before switching to this model.`);
			return;
		}
		if (!s && !n.baseUrl) {
			i.error(`Configure an endpoint for ${n.backend} in session settings first.`);
			return;
		}
		let d = cd(a.data, n.backend, n.model).supportedEfforts, f = u && d.includes(u) ? u : null, p = s ? {
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
			await c.mutateAsync({
				id: e,
				patch: p
			}), i.success(`Model switched to ${n.model}`);
		} catch (e) {
			i.error(`The model was not switched: ${Ku($(e), n.backend)}`);
		}
	}, y = async (n) => {
		if (t && n !== u) try {
			await c.mutateAsync({
				id: e,
				patch: { reasoning_effort: n || null }
			}), i.success(`Reasoning set to ${n || "the model default"}`);
		} catch (e) {
			i.error(`Reasoning was not changed: ${Ku($(e), t.backend)}`);
		}
	};
	return /* @__PURE__ */ X("div", {
		className: "flex min-w-0 items-center",
		children: [
			/* @__PURE__ */ Y(vd, {
				catalog: a.data,
				loading: a.isLoading,
				failed: a.isError,
				compact: !0,
				disabled: r || !t || c.isPending,
				liveByBackend: s,
				value: d,
				onSelect: (e) => void v(e)
			}),
			/* @__PURE__ */ Y("span", {
				"aria-hidden": !0,
				className: "h-6 w-px shrink-0 bg-divider-muted"
			}),
			/* @__PURE__ */ Y(Ir, {
				title: `Effort: ${h}`,
				description: "How much the model reasons before it answers.",
				position: R.TopCenter,
				sticky: !0,
				disabled: g,
				children: /* @__PURE__ */ Y($d, {
					items: p,
					value: u,
					placeholder: "Default effort",
					disabled: r || !t || c.isPending,
					size: z.Small,
					trailingIcon: V.Right,
					triggerClassName: "!gap-1.5 !pl-3",
					placement: R.TopCenter,
					onOpenChange: _,
					onValueChange: (e) => void y(e)
				})
			})
		]
	});
}
// src/app/features/direct-session/browserAdapters.ts
function Pg(e, t, n = {
	readMessages: Yn(e).api.getMessages,
	subscribe: Yn(e).events
}) {
	let { applyAssistantDelta: r, applyEnvelope: i, captureRuntimeActivation: a, clearRuntimeThreads: o, resetRuntime: s, setStreamStatus: c, syncRunFromSnapshot: l } = Yn(e).stores.runtimeStore, u = C(e, t), d = !1, f = () => !1;
	return {
		attach: () => {
			d = !0, s(t), f = a(t), l(e.getQueryData(Xt.sessionSnapshot(t))?.active_run);
		},
		detach: () => {
			d = !1, f() && s(null), v(u), e.cancelQueries({
				queryKey: Xt.sessionSnapshot(t),
				exact: !0
			}), e.cancelQueries({ queryKey: Xt.threadEventsRoot(t) }), e.removeQueries({ queryKey: Xt.threadEventsRoot(t) });
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
					permissionsChanged: n.type === "permission_asked" || n.type === "permission_replied" || n.type === "permission_dismissed" || n.type === "permission_approval_mode_changed"
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
			n && (o(), e.cancelQueries({ queryKey: Xt.threadEventsRoot(t) }), e.removeQueries({ queryKey: Xt.threadEventsRoot(t) })), e.cancelQueries({
				queryKey: Xt.sessionSnapshot(t),
				exact: !0
			}), Hr(u, n);
		},
		snapshot: async () => {
			ue("query:invalidate.session", { throttleMs: 0 }), await e.invalidateQueries({
				queryKey: Xt.sessionSnapshot(t),
				exact: !0
			});
		},
		tail: async (r) => {
			let i = tt(u), a = AbortSignal.any([r, i.controller.signal]);
			try {
				let r = await n.readMessages(t, {
					limit: 24,
					includeSystem: !0,
					signal: a
				});
				if (!d || a.aborted || !O(u, i.generation)) return { kind: "obsolete" };
				let o = !1;
				return e.setQueryData(Xt.sessionSnapshot(t), (e) => {
					if (!e) return o = !0, e;
					let t = Mn(e, r);
					return t.kind === "snapshot-required" ? (o = !0, e) : t.snapshot;
				}), o ? { kind: "snapshot-required" } : {
					kind: "accepted",
					total: r.page.total
				};
			} catch (e) {
				if (a.aborted || !O(u, i.generation)) return { kind: "obsolete" };
				throw e;
			} finally {
				ot(u, i);
			}
		},
		invalidate: (n, r) => {
			let i = n === "permissions" ? Xt.sessionPermissions(t) : n === "skills" ? Xt.sessionSkills(t) : n === "revisions" ? Xt.workspaceRevisions(t) : Xt.threadEvents(t, r ?? "");
			e.invalidateQueries({
				queryKey: i,
				exact: !0
			});
		}
	};
}
// src/app/features/direct-session/streamReconciliation.ts
var Fg = class extends nr("nac/SessionObservation")() {}, Ig = 250, Lg = Ve(function* () {
	let e = yield* Fg;
	return yield* o(N(() => {
		e.attach();
		let t = !1, n = null, r = null, i = !1, a = !1, o = !1, s = 0, c = 0, l = null, u = new AbortController();
		function d(i) {
			t || (i && (s = 0), e.fenceSnapshot(i), clearTimeout(n ?? void 0), n = null, o = !1, clearTimeout(r ?? void 0), r = setTimeout(() => {
				if (r = null, t) return;
				let n = ++c;
				a = !0, ei(dr({
					try: e.snapshot,
					catch: () => "snapshot-unavailable"
				}).pipe(j, De(N(() => {
					t || n !== c || (a = !1, o && r === null && f());
				}))));
			}, Ig));
		}
		function f() {
			if (t || i || a || r !== null) return;
			i = !0;
			let n = Ve(function* () {
				let n = 1;
				for (; !t && o && !a && r === null;) {
					o = !1;
					let r = yield* dr({
						try: () => e.tail(u.signal),
						catch: () => "tail-unavailable"
					}).pipe(An(() => lt({ kind: "snapshot-required" })));
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
			}).pipe(De(N(() => {
				i = !1;
			})));
			ei(n);
		}
		function p(e) {
			t || (s = Math.max(s, e), o = !0, !(r !== null || a || i) && (clearTimeout(n ?? void 0), n = setTimeout(() => {
				n = null, f();
			}, Ig)));
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
	}), (e) => N(e.close));
});
// src/app/features/direct-session/browserRuntime.ts
function Rg(e) {
	let n = pt(on()), r = (() => {
		try {
			return pt(Lg.pipe(Ye(lu(Fg, e)), t(n)));
		} catch (t) {
			throw e.detach(), pt(We(n, Bt)), t;
		}
	})();
	return () => {
		r.close(), pt(We(n, Bt));
	};
}
// src/app/hooks/useSessionStream.ts
function zg(e) {
	let { resetRuntime: t } = n().stores.runtimeStore, r = vi();
	W(() => {
		if (!e) t(null);
		else return Rg(Pg(r, e));
	}, [
		e,
		r,
		t
	]);
}
function Bg(e, t) {
	let { subscribeToSessionEvents: r } = { subscribeToSessionEvents: n().events }, i = vi();
	W(() => {
		if (!t) return;
		let n = () => {
			i.invalidateQueries({
				queryKey: Xt.sessionPermissions(e),
				exact: !0
			});
		};
		return r(e, {
			onEnvelope: (e) => {
				(e.event.type === "permission_asked" || e.event.type === "permission_replied" || e.event.type === "permission_dismissed" || e.event.type === "permission_approval_mode_changed") && n();
			},
			onStatus: (e) => {
				e === "live" && n();
			},
			onReplayBoundary: n,
			onReplayGap: n,
			onLagged: n,
			onSequenceGap: n,
			onBackpressure: n
		});
	}, [
		i,
		t,
		e,
		r
	]);
}
function Vg(e) {
	let { syncRunFromSnapshot: t } = n().stores.runtimeStore;
	W(() => {
		t(e);
	}, [e, t]);
}
// src/app/features/permissions/usePermissionQueue.ts
function Hg(e, t, r) {
	let { api: i } = n(), a = re(e, t), o = Dt(e, t), s = t ? o.data ?? [] : [], c = gi({ queries: s.map((e) => ({
		queryKey: Xt.sessionPermissions(e.child_session_id),
		queryFn: ({ signal: t }) => i.getPermissions(e.child_session_id, t),
		refetchInterval: 1e3,
		staleTime: 0,
		retry: !1
	})) }), l = [{
		sessionId: e,
		label: r ?? "this session",
		query: a
	}, ...s.map((e, t) => ({
		sessionId: e.child_session_id,
		label: `child agent “${e.description}”`,
		query: c[t]
	}))];
	return {
		parent: a,
		children: o,
		records: s,
		scopes: l,
		requests: l.flatMap((e) => (e.query.data?.requests ?? []).map((t) => ({
			scope: e,
			request: t,
			key: JSON.stringify([e.sessionId, t.id])
		})))
	};
}
// src/app/components/inspector/PermissionControls.tsx
function Ug({ sessionId: e, running: t }) {
	return Bg(e, t), null;
}
function Wg({ grant: e, deleting: t, disabled: n, onDelete: r }) {
	return /* @__PURE__ */ X("div", {
		className: "flex items-start gap-3 rounded-[4px] bg-elevation-level-2 px-3 py-2",
		children: [/* @__PURE__ */ X("div", {
			className: "min-w-0 flex-1",
			children: [/* @__PURE__ */ X("div", {
				className: "flex flex-wrap items-center gap-x-2 gap-y-1",
				children: [/* @__PURE__ */ Y("span", {
					className: "tag-label uppercase text-basic-secondary",
					children: e.action
				}), /* @__PURE__ */ Y("span", {
					className: "tag-label uppercase text-basic-tertiary",
					children: e.backend
				})]
			}), /* @__PURE__ */ Y("div", {
				className: "mt-1 break-all code code-small text-basic-primary",
				children: e.resource
			})]
		}), /* @__PURE__ */ Y(I, {
			size: z.Small,
			variant: H.GhostDestructive,
			content: L.Icon,
			"aria-label": `Forget ${e.action} permission`,
			loading: t,
			disabled: n,
			onClick: r,
			children: /* @__PURE__ */ Y(B, {
				iconName: V.Trash,
				size: 16
			})
		})]
	});
}
function Gg({ sessionId: e, behavior: t, label: n = "Permissions", autoApprovalAvailable: r = !0, requesterLabel: i }) {
	let a = t === "direct" || t === "direct-with-orchestrator", o = Hg(e, a, i), s = o.parent, c = ce(), l = be(), u = p(), d = Cn(), f = o.requests, m = o.scopes.flatMap((e) => e.query.data?.grants ?? []), h = s.data?.approval_mode === "auto_approve", g = h && !r, [_, v] = q(!1), [y, b] = q(""), [x, S] = q(null), [C, w] = q(null), [T, E] = q(null), D = JSON.stringify(f.map((e) => e.key)), O = _ || !!(f.length && D !== y), k = () => {
		b(D), v(!1);
	};
	if (!a) return null;
	let A = f.find((e) => e.key === T) ?? f[0] ?? null, j = A?.request ?? null, ee = A?.scope.label ?? i ?? "this session", M = A?.scope.query.isError || A?.scope.query.isPending, te = x !== null, ne = j?.resources.some((e) => e.save_resource) ?? !1, N = async (e) => {
		if (j && A && !te && !M) {
			S(A.key);
			try {
				await c.mutateAsync({
					sessionId: A.scope.sessionId,
					requestId: j.id,
					reply: e
				}), f.length === 1 && k();
			} catch (e) {
				d.error(`Unable to answer permission request: ${mr($(e))}`);
			} finally {
				S(null);
			}
		}
	}, P = async (e, t) => {
		if (!C) {
			w(JSON.stringify([e, t.id]));
			try {
				await u.mutateAsync({
					sessionId: e,
					grantId: t.id
				});
			} catch (e) {
				d.error(`Unable to forget permission: ${mr($(e))}`);
			} finally {
				w(null);
			}
		}
	}, re = async (t) => {
		v(!0);
		try {
			await l.mutateAsync({
				sessionId: e,
				mode: t ? "auto_approve" : "manual"
			});
		} catch (e) {
			d.error(`Unable to change approval mode: ${mr($(e))}`);
		}
	}, ie = f.length ? ` (${f.length})` : m.length ? ` (${m.length})` : "", ae = h ? "Accept all" : "Manually", oe = g ? "Requests are approved automatically because the parent session accepts all. Change the mode on the parent." : h ? "Requests are approved automatically for this session and the agents it owns." : "Each request pauses until you approve or deny it.";
	return /* @__PURE__ */ X(J, { children: [
		o.records.map((e) => /* @__PURE__ */ Y(Ug, {
			sessionId: e.child_session_id,
			running: e.status === "running"
		}, e.child_session_id)),
		/* @__PURE__ */ Y(Ir, {
			title: `Permission: ${ae}`,
			description: oe,
			position: R.TopCenter,
			children: /* @__PURE__ */ X(I, {
				size: z.Small,
				variant: f.length ? H.GhostHighlightedAccent : H.Ghost,
				content: L.IconLeft,
				className: "pr-3",
				"aria-label": h ? g ? `${n} — auto-approve inherited; open permissions` : "Auto-approve on — open permissions" : `${n}${ie}`,
				onClick: () => v(!0),
				children: [
					/* @__PURE__ */ Y(B, {
						iconName: V.Private,
						size: 16
					}),
					/* @__PURE__ */ Y("span", {
						className: "label-micro",
						children: h ? "Accept all" : "Manually"
					}),
					f.length ? /* @__PURE__ */ X("span", {
						className: "label-micro",
						children: [
							"(",
							f.length,
							" pending)"
						]
					}) : null
				]
			})
		}),
		/* @__PURE__ */ Y(tn, {
			open: O,
			onClose: k,
			size: dn.Wide,
			flush: !0,
			title: j ? "Permission required" : "Permissions",
			subheader: j ? `${j.tool} requested by ${ee} is paused before execution.` : g ? "Automatic approval is inherited from the parent session; change it from the parent." : h ? "Automatic approval is active for this session and its owned child agents." : "Remembered access for this session.",
			footer: j ? /* @__PURE__ */ X("div", {
				className: "flex w-full flex-wrap justify-end gap-2",
				children: [
					/* @__PURE__ */ Y(I, {
						variant: H.SecondaryDestructive,
						loading: x === A?.key && c.variables?.reply === "reject",
						disabled: te || M,
						onClick: () => void N("reject"),
						children: "Reject"
					}),
					/* @__PURE__ */ Y(I, {
						variant: H.Secondary,
						loading: x === A?.key && c.variables?.reply === "once",
						disabled: te || M,
						onClick: () => void N("once"),
						children: "Allow once"
					}),
					/* @__PURE__ */ Y(I, {
						variant: H.Primary,
						loading: x === A?.key && c.variables?.reply === "always",
						disabled: te || M || !ne,
						title: ne ? "Remember the server-derived narrow access pattern" : "This operation has no safe reusable permission pattern",
						onClick: () => void N("always"),
						children: "Always allow"
					})
				]
			}) : void 0,
			children: /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-5",
				children: [
					[{
						sessionId: "discovery",
						label: "Child request discovery",
						query: o.children
					}, ...o.scopes].map(({ sessionId: e, label: t, query: n }) => n.isError ? /* @__PURE__ */ X("div", {
						role: "alert",
						className: "rounded-[4px] bg-error-secondary p-3 text-small text-error-primary",
						children: [
							"Permissions could not be loaded for ",
							t,
							". The run remains fail-closed.",
							/* @__PURE__ */ X(I, {
								size: z.Small,
								variant: H.Secondary,
								onClick: () => void n.refetch(),
								children: ["Retry ", t]
							})
						]
					}, e) : n.isPending ? /* @__PURE__ */ X("div", {
						role: "status",
						className: "text-small text-basic-secondary",
						children: [
							"Loading permissions for ",
							t,
							"…"
						]
					}, e) : null),
					f.length ? /* @__PURE__ */ X("section", {
						"aria-label": "Pending permission requests",
						className: "flex flex-col gap-2",
						children: [/* @__PURE__ */ X("div", {
							className: "tag-label uppercase text-basic-tertiary",
							children: [
								"Pending requests (",
								f.length,
								")"
							]
						}), f.map((e) => /* @__PURE__ */ Y(I, {
							variant: e.key === A?.key ? H.Secondary : H.Ghost,
							className: "!h-auto min-h-9 min-w-0 !py-2",
							"aria-pressed": e.key === A?.key,
							disabled: te,
							onClick: () => E(e.key),
							children: /* @__PURE__ */ X("span", {
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
					}) : /* @__PURE__ */ Y("div", {
						className: "text-small text-basic-secondary",
						children: "No pending permission requests."
					}),
					r ? /* @__PURE__ */ X("section", {
						"aria-label": "Automatic approval mode",
						className: h ? "rounded-[6px] border border-accent-primary bg-elevation-level-2 p-3" : "rounded-[6px] bg-elevation-level-2 p-3",
						children: [/* @__PURE__ */ X("div", {
							className: "flex items-start justify-between gap-4",
							children: [/* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("div", {
								className: "text-small font-medium text-basic-primary",
								children: "Approve all automatically"
							}), /* @__PURE__ */ Y("div", {
								className: "mt-1 text-small text-basic-secondary",
								children: "Automatically allows ordinary requests only after they reach this session’s or an owned child agent’s permission broker. Hard and configured denials still apply."
							})] }), /* @__PURE__ */ Y(iu, {
								"aria-label": "Approve all automatically",
								checked: h,
								disabled: l.isPending || s.isError || s.isPending,
								onChange: (e) => void re(e)
							})]
						}), /* @__PURE__ */ Y("div", {
							className: "mt-2 text-small text-basic-tertiary",
							children: "This setting governs this session and all existing or future owned child agents. It stays active across restarts until you turn it off and does not create remembered permissions. Separately managed orchestrators are not included."
						})]
					}) : null,
					g ? /* @__PURE__ */ X("section", {
						"aria-label": "Inherited automatic approval mode",
						className: "rounded-[6px] border border-accent-primary bg-elevation-level-2 p-3",
						children: [/* @__PURE__ */ Y("div", {
							className: "text-small font-medium text-basic-primary",
							children: "Auto-approve inherited"
						}), /* @__PURE__ */ Y("div", {
							className: "mt-1 text-small text-basic-secondary",
							children: "Ordinary requests from this child agent inherit automatic approval from the parent session. Change this mode from the parent session; hard and configured denials still apply."
						})]
					}) : null,
					j ? /* @__PURE__ */ X("section", {
						"aria-label": "Requested access",
						children: [
							/* @__PURE__ */ X("div", {
								className: "mb-2 text-small text-basic-secondary",
								children: [
									"Requested by ",
									ee,
									" (",
									j.session_id,
									"). Manual approval is effective because automatic approval is off for this session and its owned child agents."
								]
							}),
							/* @__PURE__ */ Y("div", {
								className: "mb-2 tag-label uppercase text-basic-tertiary",
								children: "Requested access"
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-2",
								children: j.resources.map((e, t) => /* @__PURE__ */ X("div", {
									className: "rounded-[4px] bg-elevation-level-2 px-3 py-2",
									children: [
										/* @__PURE__ */ Y("div", {
											className: "tag-label uppercase text-basic-secondary",
											children: e.action
										}),
										/* @__PURE__ */ Y("div", {
											className: "mt-1 break-words text-small text-basic-primary",
											children: e.display
										}),
										e.save_resource ? /* @__PURE__ */ X("div", {
											className: "mt-2 break-all code code-small text-basic-tertiary",
											children: ["Always: ", e.save_resource]
										}) : null
									]
								}, `${e.action}:${e.resource}:${t}`))
							}),
							f.length > 1 ? /* @__PURE__ */ X("div", {
								className: "mt-2 text-small text-basic-secondary",
								children: [
									f.length - 1,
									" more request",
									f.length === 2 ? "" : "s",
									" waiting."
								]
							}) : null
						]
					}) : null,
					/* @__PURE__ */ X("section", {
						"aria-label": "Remembered permissions",
						children: [
							/* @__PURE__ */ Y("div", {
								className: "mb-2 tag-label uppercase text-basic-tertiary",
								children: "Remembered permissions by session"
							}),
							/* @__PURE__ */ Y("div", {
								className: "mb-3 text-small text-basic-secondary",
								children: "Each grant stays in its original session. A child’s grants never apply to the parent or siblings."
							}),
							o.scopes.map((t) => /* @__PURE__ */ X("section", {
								"aria-label": `Remembered for ${t.label}`,
								className: "mb-4",
								children: [
									/* @__PURE__ */ X("div", {
										className: "mb-2 break-all text-small text-basic-secondary",
										children: [
											"Remembered for ",
											t.label,
											" (",
											t.sessionId,
											")"
										]
									}),
									/* @__PURE__ */ X("div", {
										className: "flex flex-col gap-2",
										children: [t.sessionId !== e && t.query.data?.approval_mode === "auto_approve" ? /* @__PURE__ */ Y("div", {
											className: "text-small text-basic-secondary",
											children: "Auto-approve inherited from parent."
										}) : null, (t.query.data?.grants ?? []).map((e) => /* @__PURE__ */ Y(Wg, {
											grant: e,
											deleting: C === JSON.stringify([t.sessionId, e.id]),
											disabled: C !== null || t.query.isError || t.query.isPending,
											onDelete: () => void P(t.sessionId, e)
										}, e.id))]
									}),
									!t.query.isPending && !t.query.isError && !t.query.data?.grants.length ? /* @__PURE__ */ Y("div", {
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
// src/app/components/inspector/GoalControls.tsx
function Kg(e) {
	return e.replaceAll("_", " ");
}
function qg(e) {
	return e?.token_budget === null || e?.token_budget === void 0 ? "" : String(e.token_budget);
}
function Jg(e) {
	let t = e.trim();
	if (!t) return null;
	let n = Number(t);
	return Number.isSafeInteger(n) && n > 0 ? n : void 0;
}
function Yg({ sessionId: e, behavior: t, openRequest: n = 0 }) {
	let r = t === "direct" || t === "direct-with-orchestrator", i = ut(e, r), a = Xe(), o = Ct(), s = we(), c = Cn(), l = i.data ?? null, [u, d] = q(!1), [f, p] = q(""), [m, h] = q(""), g = K(0);
	if (W(() => {
		n !== 0 && n !== g.current && (g.current = n, p(l?.objective ?? ""), h(qg(l)), d(!0));
	}, [l, n]), !r) return null;
	let _ = a.isPending || o.isPending || s.isPending, v = () => {
		p(l?.objective ?? ""), h(qg(l)), d(!0);
	}, y = (e, t) => {
		c.error(`${e}: ${mr($(t))}`);
	}, b = async () => {
		let t = Jg(m);
		if (!f.trim()) c.error("Goal objective is required.");
		else if (t === void 0) c.error("Token budget must be a positive whole number or blank.");
		else try {
			l && l.status !== "complete" ? await o.mutateAsync({
				sessionId: e,
				goalId: l.goal_id,
				payload: {
					expected_version: l.version,
					objective: f.trim(),
					token_budget: t
				}
			}) : await a.mutateAsync({
				sessionId: e,
				payload: {
					objective: f.trim(),
					...t === null ? {} : { token_budget: t }
				}
			});
		} catch (e) {
			y(l && l.status !== "complete" ? "Unable to update goal" : "Unable to create goal", e);
		}
	}, x = async (t) => {
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
			y("Unable to change goal status", e);
		}
	}, S = async () => {
		if (l) try {
			await s.mutateAsync({
				sessionId: e,
				goalId: l.goal_id,
				expectedVersion: l.version
			}), p(""), h("");
		} catch (e) {
			y("Unable to clear goal", e);
		}
	};
	return /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Ir, {
		title: "Durable goal",
		position: R.TopCenter,
		children: /* @__PURE__ */ Y(I, {
			size: z.Small,
			variant: l?.status === "active" ? H.GhostHighlightedAccent : H.Ghost,
			content: L.Icon,
			"aria-label": l ? `Goal: ${Kg(l.status)}` : "Create durable goal",
			onClick: v,
			children: /* @__PURE__ */ Y(B, {
				iconName: V.Flag,
				size: 16
			})
		})
	}), /* @__PURE__ */ Y(tn, {
		open: u,
		onClose: () => d(!1),
		size: dn.Wide,
		title: l?.status === "complete" ? "Replace durable goal" : l ? "Durable goal" : "Create durable goal",
		subheader: "Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited.",
		children: i.isPending ? /* @__PURE__ */ Y("div", {
			className: "py-6 text-center text-small text-basic-secondary",
			children: "Loading goal…"
		}) : i.isError ? /* @__PURE__ */ Y("div", {
			className: "rounded-[4px] bg-error-secondary p-3 text-small text-error-primary",
			children: "Goal state could not be loaded."
		}) : /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-4",
			children: [
				l ? /* @__PURE__ */ X("div", {
					className: "rounded-[4px] bg-elevation-level-2 px-3 py-2 text-small",
					children: [/* @__PURE__ */ X("div", {
						className: "flex flex-wrap items-center justify-between gap-2",
						children: [/* @__PURE__ */ Y("span", {
							className: "tag-label uppercase text-basic-secondary",
							children: Kg(l.status)
						}), /* @__PURE__ */ X("span", {
							className: "text-basic-tertiary",
							children: [
								l.tokens_used.toLocaleString(),
								" tokens ·",
								" ",
								Math.floor(l.time_used_ms / 1e3),
								"s"
							]
						})]
					}), l.token_budget === null ? null : /* @__PURE__ */ X("div", {
						className: "mt-1 text-basic-tertiary",
						children: [Math.max(0, l.token_budget - l.tokens_used).toLocaleString(), " tokens remaining"]
					})]
				}) : null,
				/* @__PURE__ */ Y(el, {
					label: "Objective",
					textAreaSize: $c.Medium,
					placeholder: "Describe the concrete outcome",
					value: f,
					onChange: (e) => p(e.target.value),
					textAreaClassName: "h-[112px] resize-none"
				}),
				/* @__PURE__ */ Y(Q, {
					label: "Token budget (optional)",
					inputSize: Z.Medium,
					inputMode: "numeric",
					placeholder: "No limit",
					value: m,
					onChange: (e) => h(e.target.value)
				}),
				/* @__PURE__ */ X("div", {
					className: "flex flex-wrap justify-end gap-2",
					children: [l ? /* @__PURE__ */ X(J, { children: [l.status === "active" ? /* @__PURE__ */ X(J, { children: [
						/* @__PURE__ */ Y(I, {
							variant: H.Secondary,
							disabled: _,
							onClick: () => void x("paused"),
							children: "Pause"
						}),
						/* @__PURE__ */ Y(I, {
							variant: H.Secondary,
							disabled: _,
							onClick: () => void x("usage_limited"),
							children: "Usage limit"
						}),
						/* @__PURE__ */ Y(I, {
							variant: H.Secondary,
							disabled: _,
							onClick: () => void x("budget_limited"),
							children: "Budget limit"
						})
					] }) : l.status === "complete" ? null : /* @__PURE__ */ Y(I, {
						variant: H.Secondary,
						disabled: _,
						onClick: () => void x("active"),
						children: "Resume"
					}), /* @__PURE__ */ Y(I, {
						variant: H.GhostDestructive,
						disabled: _,
						onClick: () => void S(),
						children: "Clear"
					})] }) : null, /* @__PURE__ */ Y(I, {
						variant: H.Primary,
						loading: _,
						onClick: () => void b(),
						children: l?.status === "complete" ? "Replace and start" : l ? "Save" : "Create and start"
					})]
				})
			]
		})
	})] });
}
// src/app/components/inspector/GoalComposer.tsx
var Xg = "Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited.", Zg = 100, Qg = 1e6, $g = 100, e_ = 9600;
function t_(e) {
	let t = e.replaceAll("_", " ");
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function n_(e) {
	return e === "active" ? Fi.Green : e === "complete" ? Fi.Gray : Fi.Yellow;
}
function r_(e) {
	let t = Math.round(e / $g) * $g;
	return Math.min(Qg, Math.max(Zg, t));
}
function i_({ sessionId: e, className: t, onOpen: n }) {
	let r = ut(e, !0).data ?? null, i = r?.status === "active";
	return /* @__PURE__ */ Y(Ir, {
		className: t,
		position: R.TopCenter,
		title: r ? `Current Goal: ${t_(r.status)} - Click To Edit` : "Set Durable Goal",
		description: r ? r.objective : Xg,
		children: /* @__PURE__ */ Y(I, {
			type: "button",
			size: z.Large,
			variant: i ? H.GhostHighlightedAccent : H.Ghost,
			content: L.Icon,
			"aria-label": r ? `Edit goal: ${t_(r.status)}` : "Set durable goal",
			onClick: n,
			children: /* @__PURE__ */ Y(B, {
				iconName: V.Flag,
				size: 24
			})
		})
	});
}
function a_({ sessionId: e, onClose: t }) {
	let n = ut(e, !0), r = Xe(), i = Ct(), a = we(), o = Cn(), s = n.data ?? null, [c, l] = q(s?.objective ?? ""), [u, d] = q(s?.token_budget != null), [f, p] = q(r_(s?.token_budget ?? e_)), m = K(n.data !== void 0);
	W(() => {
		if (m.current || n.isPending) return;
		m.current = !0;
		let e = n.data ?? null;
		l(e?.objective ?? ""), d(e?.token_budget != null), p(r_(e?.token_budget ?? e_));
	}, [n.data, n.isPending]);
	let h = r.isPending || i.isPending || a.isPending, g = s != null && s.status !== "complete", _ = (e, t) => {
		o.error(`${e}: ${mr($(t))}`);
	}, v = async (n) => {
		let a = u ? f : null;
		if (!c.trim()) o.error("Goal objective is required.");
		else try {
			g && s ? await i.mutateAsync({
				sessionId: e,
				goalId: s.goal_id,
				payload: {
					expected_version: s.version,
					objective: c.trim(),
					token_budget: a
				}
			}) : await r.mutateAsync({
				sessionId: e,
				payload: {
					objective: c.trim(),
					...a === null ? {} : { token_budget: a }
				}
			}), n && t();
		} catch (e) {
			_(g ? "Unable to update goal" : "Unable to create goal", e);
		}
	}, y = async (t) => {
		if (s) try {
			await i.mutateAsync({
				sessionId: e,
				goalId: s.goal_id,
				payload: {
					expected_version: s.version,
					status: t
				}
			});
		} catch (e) {
			_("Unable to change goal status", e);
		}
	}, b = async () => {
		if (s) try {
			await a.mutateAsync({
				sessionId: e,
				goalId: s.goal_id,
				expectedVersion: s.version
			}), l(""), d(!1), p(e_);
		} catch (e) {
			_("Unable to clear goal", e);
		}
	}, x = o_(s, h || !c.trim());
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2 rounded-[8px] bg-input p-2",
			children: [n.isPending ? /* @__PURE__ */ Y("div", {
				className: "text-micro text-basic-secondary",
				children: "Loading goal…"
			}) : n.isError ? /* @__PURE__ */ Y("div", {
				className: "rounded-[4px] bg-error-secondary p-2 text-micro text-error-primary",
				children: "Goal state could not be loaded."
			}) : s ? /* @__PURE__ */ X("div", {
				className: "flex flex-wrap items-center gap-2",
				children: [
					/* @__PURE__ */ Y("span", {
						className: "shrink-0 text-micro font-semibold text-basic-primary",
						children: "Current Goal"
					}),
					/* @__PURE__ */ Y(Li, {
						text: t_(s.status),
						color: n_(s.status)
					}),
					/* @__PURE__ */ X("span", {
						className: "min-w-0 flex-1 truncate text-micro text-basic-secondary",
						children: [
							s.tokens_used.toLocaleString(),
							" Tokens, ",
							Math.floor(s.time_used_ms / 1e3),
							"s"
						]
					}),
					/* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						variant: H.GhostDestructive,
						disabled: h,
						onClick: () => void b(),
						children: "Clear"
					}),
					/* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						variant: H.Primary,
						loading: h,
						disabled: !c.trim(),
						onClick: () => void v(!g),
						children: s.status === "complete" ? "Replace" : "Save"
					})
				]
			}) : null, /* @__PURE__ */ X("div", {
				className: "flex items-center gap-2",
				children: [
					/* @__PURE__ */ Y(iu, {
						checked: u,
						disabled: h,
						"aria-label": "Token budget",
						onChange: d
					}),
					/* @__PURE__ */ Y("span", {
						className: "label-micro shrink-0 text-basic-primary",
						children: "Token Budget"
					}),
					u ? null : /* @__PURE__ */ Y("span", {
						className: "w-16 shrink-0 text-micro text-basic-muted",
						children: "Disabled"
					}),
					/* @__PURE__ */ Y("span", {
						className: "code code-small w-[60px] shrink-0 text-right text-basic-secondary",
						children: f.toLocaleString()
					}),
					/* @__PURE__ */ Y(Vl, {
						className: "min-w-0 flex-1",
						min: Zg,
						max: Qg,
						step: $g,
						value: f,
						disabled: h,
						label: "Token budget",
						onChange: (e) => {
							p(e), d(!0);
						}
					})
				]
			})]
		}), /* @__PURE__ */ X("div", {
			className: "relative flex items-end rounded-[4px] bg-btn-secondary-accent pr-[96px]",
			children: [
				/* @__PURE__ */ Y("textarea", {
					className: "relative block min-h-[48px] w-full resize-none border-none bg-transparent p-3 text-medium text-input outline-none placeholder:text-input-placeholder",
					rows: c.length > 80 ? 3 : 1,
					"aria-label": "Goal objective",
					placeholder: "Describe the concrete output",
					value: c,
					onChange: (e) => l(e.target.value),
					onKeyDown: (e) => {
						e.key === "Escape" ? (e.preventDefault(), t()) : e.key !== "Enter" || e.shiftKey || (e.preventDefault(), v(s == null || s.status === "complete"));
					}
				}),
				/* @__PURE__ */ Y(I, {
					type: "button",
					className: "absolute right-[48px] bottom-0",
					size: z.Large,
					variant: H.Ghost,
					content: L.Icon,
					"aria-label": "Close goal editor",
					onClick: t,
					children: /* @__PURE__ */ Y(B, {
						iconName: V.Close,
						size: 24
					})
				}),
				/* @__PURE__ */ Y(I, {
					type: "button",
					className: "absolute right-0 bottom-0",
					size: z.Large,
					variant: H.Primary,
					content: L.Icon,
					disabled: x.disabled || h,
					loading: h && x.kind === "save",
					"aria-label": x.label,
					onClick: () => {
						x.kind === "pause" ? y("paused") : x.kind === "resume" ? y("active") : v(!0);
					},
					children: /* @__PURE__ */ Y(B, { iconName: x.icon })
				})
			]
		})]
	});
}
function o_(e, t) {
	return e?.status === "active" ? {
		kind: "pause",
		label: "Pause goal",
		icon: V.Stop,
		disabled: !1
	} : e && e.status !== "complete" ? {
		kind: "resume",
		label: "Resume goal",
		icon: V.Play,
		disabled: !1
	} : {
		kind: "save",
		label: e?.status === "complete" ? "Replace goal" : "Create goal",
		icon: V.Plane,
		disabled: t
	};
}
// src/app/components/inspector/SubagentChatInputBox.tsx
var s_ = "The subagent keeps working after you leave this chat. Steer or stop it from here.", c_ = {
	completed: {
		text: "Completed",
		color: Fi.Green
	},
	cancelled: {
		text: "Cancelled",
		color: Fi.Yellow
	},
	failed: {
		text: "Failed",
		color: Fi.Red
	},
	interrupted: {
		text: "Interrupted",
		color: Fi.Yellow
	}
};
function l_({ value: e, onChange: t, onSubmit: n, onStop: r, running: i, background: a, onBackgroundChange: o, status: s = null, busy: c = !1, starting: l = !1, permission: u }) {
	let d = K(null), f = Le(), p = e.trim().length > 0 && (i || !l), m = i ? "Steer a message" : "Send a message", h = !i && s ? c_[s] : void 0, g = i ? a ? "Running in the background" : "Regular run" : "Run in the background";
	return ui(() => {
		let e = d.current;
		e && (e.style.height = "auto", e.style.height = `${e.scrollHeight}px`);
	}, [e]), /* @__PURE__ */ X("form", {
		className: "flex w-full flex-col gap-4 rounded-[8px] bg-elevation-level-2 p-4 shadow-2xl",
		onSubmit: (e) => {
			e.preventDefault(), !c && p && n();
		},
		children: [/* @__PURE__ */ X("div", {
			className: P("relative flex items-end overflow-hidden rounded-[4px] bg-input py-2 pl-2", i ? "pr-24" : "pr-12"),
			children: [
				/* @__PURE__ */ Y("textarea", {
					ref: d,
					rows: 1,
					value: e,
					placeholder: m,
					"aria-label": m,
					disabled: c,
					className: "max-h-40 min-h-5 w-full resize-none bg-transparent px-1 text-small text-input outline-none placeholder:text-input-placeholder",
					onChange: (e) => t(e.target.value),
					onKeyDown: (e) => {
						e.nativeEvent.isComposing || e.key !== "Enter" || e.shiftKey || (!f || e.metaKey || e.ctrlKey) && (e.preventDefault(), p && !c && n());
					}
				}),
				/* @__PURE__ */ Y(I, {
					type: "submit",
					size: z.Medium,
					variant: H.Primary,
					content: L.Icon,
					className: "absolute right-0 bottom-0",
					disabled: c || !p,
					"aria-label": i ? "Steer" : "Send",
					children: /* @__PURE__ */ Y(B, { iconName: V.ArrowTop })
				}),
				i ? /* @__PURE__ */ Y(I, {
					type: "button",
					size: z.Medium,
					variant: H.Ghost,
					content: L.Icon,
					className: "absolute right-12 bottom-0",
					disabled: c,
					onClick: r,
					"aria-label": "Stop",
					children: /* @__PURE__ */ Y(B, { iconName: V.Stop })
				}) : null
			]
		}), /* @__PURE__ */ X("div", {
			className: "flex items-center gap-2.5 h-6",
			children: [/* @__PURE__ */ X("div", {
				className: "flex min-w-0 flex-1 items-center gap-2",
				children: [
					i ? null : /* @__PURE__ */ Y(iu, {
						checked: a,
						disabled: c || l,
						"aria-label": "Run in the background",
						onChange: o
					}),
					/* @__PURE__ */ Y("span", {
						className: P("label-micro truncate", i && a ? "text-info-primary" : i ? "text-basic-tertiary" : "text-basic-primary"),
						children: g
					}),
					/* @__PURE__ */ Y(Ir, {
						title: g,
						description: s_,
						position: R.TopCenter,
						children: /* @__PURE__ */ Y("span", {
							className: "inline-flex text-basic-tertiary",
							children: /* @__PURE__ */ Y(B, {
								iconName: V.Info,
								size: 16
							})
						})
					}),
					h ? /* @__PURE__ */ Y(Li, {
						text: h.text,
						color: h.color,
						className: "px-1 py-[2px]"
					}) : null
				]
			}), u]
		})]
	});
}
// src/app/components/inspector/SubagentComposer.tsx
function u_({ recovery: e, hasDraft: t, onRestore: n, onDismiss: r }) {
	let { copy: i, copied: a } = ee();
	return /* @__PURE__ */ X("div", {
		className: "rounded-[4px] bg-elevation-level-2 p-3 text-small",
		children: [
			/* @__PURE__ */ Y("p", {
				role: "status",
				children: e.status === "pending" ? "Sending message…" : e.status === "not-sent" ? "Message was not sent." : "Message delivery is unconfirmed. Check the transcript before sending it again."
			}),
			/* @__PURE__ */ Y("p", {
				className: "max-h-32 overflow-auto whitespace-pre-wrap break-words",
				children: e.text
			}),
			e.status === "pending" ? null : /* @__PURE__ */ X("div", {
				className: "mt-2 flex flex-wrap gap-2",
				children: [
					/* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						variant: H.Ghost,
						disabled: t,
						onClick: n,
						children: "Restore to composer"
					}),
					/* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						variant: H.Ghost,
						onClick: () => i(e.text),
						children: a ? "Copied" : "Copy message"
					}),
					/* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						variant: H.Ghost,
						onClick: r,
						children: "Dismiss"
					})
				]
			}),
			e.status !== "pending" && t ? /* @__PURE__ */ Y("p", {
				className: "text-basic-tertiary",
				children: "Your current draft is preserved. Clear it before restoring this message."
			}) : null
		]
	});
}
function d_({ parentSessionId: e, target: t, permissionSessionId: r, permissionBehavior: i, requesterLabel: a, showPermissions: o = !0 }) {
	let s = Cn(), c = he(), l = pr(), u = de(), d = M(), f = n().stores.promptDraftStore, p = f.useDraft(t.id), m = f.useRecoveries(t.id), h = f.useSubmitting(t.id), [g, _] = q(null), v = g ?? t.background, y = t.status === "running", b = f.useCancelling(t.id), x = async () => {
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
			a && f.settleSubmission(t.id, a, "uncertain"), s.error(`Unable to update the subagent: ${mr($(e))}`);
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
			s.error(`Unable to stop the subagent: ${mr($(e))}`);
		} finally {
			n();
		}
	};
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ Y(l_, {
			value: p.text,
			onChange: (e) => f.update(t.id, e),
			onSubmit: () => void x(),
			onStop: () => void S(),
			running: y,
			background: y ? t.background : v,
			onBackgroundChange: _,
			status: t.status,
			busy: b,
			starting: h,
			permission: o ? /* @__PURE__ */ Y(Gg, {
				sessionId: r,
				behavior: i,
				autoApprovalAvailable: !1,
				requesterLabel: a
			}) : null
		}), m.length ? /* @__PURE__ */ Y("div", {
			role: "region",
			"aria-label": "Subagent message delivery",
			className: "flex max-h-48 flex-col gap-2 overflow-y-auto",
			children: m.map((e) => /* @__PURE__ */ Y(u_, {
				recovery: e,
				hasDraft: !!p.text,
				onRestore: () => f.restoreRecovery(t.id, e),
				onDismiss: () => f.dismissRecovery(t.id, e)
			}, e.id))
		}) : null]
	});
}
function f_({ parentSessionId: e, sessionId: t, kind: n, description: r, behavior: i }) {
	let a = n === "managed-orchestrator", o = Dt(e, !a), s = ht(e, a), c = a ? s.data?.find((e) => e.orchestrator_session_id === t) : o.data?.find((e) => e.child_session_id === t), l = {
		mode: a ? "orchestrator" : "child",
		id: t,
		description: c?.description || r || "Subagent",
		status: c?.status ?? "idle",
		background: c?.execution_mode !== "foreground"
	};
	return /* @__PURE__ */ Y(d_, {
		parentSessionId: e,
		target: l,
		permissionSessionId: t,
		permissionBehavior: a ? "orchestrator" : i ?? "direct",
		requesterLabel: a ? void 0 : `child agent “${l.description}”`
	}, `${l.mode}:${l.id}`);
}
// src/app/hooks/usePromptHistoryPreview.ts
var p_ = 40;
function m_(e) {
	let t = e.trim();
	if (!t) return "[empty]";
	let n = t.split("\n")[0] ?? "";
	return n.length <= p_ ? n : `${n.slice(0, p_)}…`;
}
function h_({ prompts: e, value: t, enabled: n, setValue: r, textareaRef: i, afterCommit: a }) {
	let [o, s] = q(-1), [c, l] = q(-1), u = n && o >= 0 && o < e.length, d = u ? e[o] ?? "" : "", f = U(() => {
		s(-1), l(-1);
	}, []), p = U(() => {
		r(d), s(-1), requestAnimationFrame(() => {
			let e = i.current;
			e && (e.selectionStart = d.length, e.selectionEnd = d.length, a?.());
		});
	}, [
		a,
		d,
		r,
		i
	]), m = U((r) => !n || r.nativeEvent.isComposing ? !1 : r.key === "ArrowUp" && e.length > 0 ? t !== "" && !u ? !1 : (r.preventDefault(), s(Math.min((u ? o : -1) + 1, e.length - 1)), !0) : u ? r.key === "ArrowDown" ? (r.preventDefault(), s(o - 1 >= 0 ? o - 1 : -1), !0) : r.key === "Tab" ? (r.preventDefault(), p(), !0) : r.key === "Escape" && (r.preventDefault(), s(-1), !0) : !1, [
		u,
		p,
		n,
		o,
		e.length,
		t
	]), h = U((e) => {
		n && (o >= 0 && e !== "" ? (l(o), s(-1)) : e === "" && c >= 0 && (s(c), l(-1)));
	}, [
		n,
		o,
		c
	]);
	return G(() => ({
		active: u,
		previewText: u ? m_(d) : "",
		hasHistory: n && e.length > 0,
		onKeyDown: m,
		onValueChange: h,
		reset: f
	}), [
		u,
		d,
		n,
		m,
		h,
		e.length,
		f
	]);
}
// src/app/lib/skillReferences.ts
var g_ = /[\p{Alphabetic}\p{Number}_-]/u;
function __(e, t) {
	return t >= e.length ? null : e.slice(t)[Symbol.iterator]().next().value ?? null;
}
function v_(e, t) {
	let n = __(e, t);
	return n === null || !g_.test(n);
}
function y_(e) {
	return [...e].sort((e, t) => t.name.length - e.name.length || e.name.localeCompare(t.name));
}
function b_(e, t) {
	if (!e || t.length === 0) return [{
		text: e,
		skillName: null
	}];
	let n = y_(t), r = [], i = 0, a = 0;
	for (;;) {
		let t = e.indexOf("$", a);
		if (t === -1) break;
		let o = t + 1, s = n.find((t) => e.startsWith(t.name, o) && v_(e, o + t.name.length));
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
function x_(e, t, n, r) {
	if (t === 0 || t !== n || r.length === 0 || !v_(e, n)) return null;
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
var S_ = "Ask anything…", C_ = "Ask anything, or press ↑ for an earlier prompt", w_ = {
	mobile: 40,
	wide: 48
}, T_ = {
	mobile: 128,
	wide: 200
};
function E_(e) {
	let t = /^(\s*)\/(\S*)$/u.exec(e);
	if (!t || t[0] !== e) return null;
	let n = t[2];
	return n.includes("/") || n.includes("\\") ? null : {
		leadingWhitespace: t[1],
		prefix: n
	};
}
function D_(e, t) {
	let n = e.trim();
	if (!n.startsWith("/")) return null;
	let r = n.slice(1), i = r.search(/\s/u), a = i === -1 ? r : r.slice(0, i), o = i === -1 ? "" : r.slice(i).trim();
	return t.find((e) => e.name === a && (e.accepts_arguments || !o)) ?? null;
}
function O_(e, t, n, r) {
	return `${e}:${n}:${r}:${t}`;
}
var k_ = { WebkitTextStroke: "0.45px currentColor" };
function A_(e) {
	return e.map((e, t) => e.skillName ? /* @__PURE__ */ Y("strong", {
		className: "[font-weight:inherit] text-danger-primary",
		style: k_,
		children: e.text
	}, `${e.skillName}-${t}`) : /* @__PURE__ */ Y("span", { children: e.text }, t));
}
var j_ = { backgroundImage: "linear-gradient(to top, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))" };
function M_({ iconName: e, prefix: t, value: n, iconSize: r = 14, className: i, title: a, showIcon: o = !0, labelClassName: s = "label-micro" }) {
	return /* @__PURE__ */ Y(Ir, {
		title: a,
		position: R.TopCenter,
		children: /* @__PURE__ */ X("div", {
			className: P("flex items-center gap-[2px] py-1 whitespace-nowrap", i),
			children: [t ? /* @__PURE__ */ Y("span", {
				className: s,
				children: t
			}) : o && e ? /* @__PURE__ */ Y(B, {
				iconName: e,
				size: r
			}) : null, /* @__PURE__ */ Y("span", {
				className: s,
				children: n
			})]
		})
	});
}
function N_(e, t) {
	let n = h(e), r = t.contextWindow;
	if (!r || e == null) return {
		value: n,
		title: "Orchestrator context"
	};
	let i = h(r);
	return t.estimated ? {
		value: `${n} / ${i} est.`,
		title: `Orchestrator context against ${t.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate`
	} : {
		value: `${n} / ${i}`,
		title: `Orchestrator context — ${Math.round(e / r * 100)}% of the model's context window`
	};
}
function P_({ sessionId: e, snapshot: t, entry: r }) {
	let i = n(), a = Sg(i, e), { useSshConnectionStatus: o, sshTargetFromSummary: s, markSshDisconnected: c, markSshConnected: l } = n().stores.sshConnectionStore, { useSessionSpend: u, useRunning: d, useRunUsage: p, useRunStartedAt: m, useLastElapsedMs: g, useCancelArmed: _, pushLocalEvent: v, liftSessionSpend: y, captureRuntimeActivation: b } = n().stores.runtimeStore, { consumePromptRequests: x, consumeDraftRequests: S, shellIntents: C } = n().stores.composerStore;
	Se("ChatInputBox");
	let w = i.stores.promptDraftStore, { text: T } = w.useDraft(e), E = w.useSubmitting(e), D = U((t) => {
		w.update(e, t);
	}, [w, e]), O = Le(), k = In(), A = O || k, [j, ee] = q(!1), [M, te] = q({
		start: 0,
		end: 0
	}), [ne, N] = q(null), [re, ie] = q(0), [ae, oe] = q(null), se = O && !j, ce = O ? w_.mobile : w_.wide, le = O ? T_.mobile : T_.wide, ue = d(e), F = _(e), de = Cn(), fe = kp(), pe = _n(), me = Og(e), he = qn(), ge = sn(), _e = ti(), ve = jt(), ye = He(), be = r?.summary.behavior ?? t?.metadata.behavior ?? null, xe = be === "direct" || be === "direct-with-orchestrator", Ce = r?.lineage ?? t?.lineage ?? null, Te = Ce != null, De = r !== null || t !== null, ke = yt(e, xe && !Te), Ae = ut(e, xe && !Te), je = Xe(), Me = Ct(), Pe = we(), [Ie, Re] = q(0), [ze, Be] = q(!1), [Ve, Ue] = q(e);
	Ve !== e && (Ue(e), Be(!1));
	let { data: We, isError: Ge, refetch: Ke } = Xr(e), { data: qe, isError: Je } = Fr(e), Ye = K(null), Ze = K(null), Qe = K(null), et = K([]), tt = li(), nt = p(), rt = u();
	W(() => {
		y(Ee(t));
	}, [y, t]);
	let it = Fe(t, r, ue || F ? nt : null, rt), at = r?.summary.backend ?? t?.metadata.backend ?? null, ot = Gn(), st = Ee(t), ct = it.usage?.total_tokens || st?.total_tokens || null, lt = N_(ct, cd(ot.data, t?.metadata?.backend, it.model)), dt = $t(1e3, ue), ft = m(), pt = g(), ht = (ue && ft != null ? Math.max(0, dt - ft) : null) ?? pt ?? it.lastResponseMs, gt = s(r?.summary), _t = o(gt), vt = $e(), bt = Pn(r?.summary) === "SSH", xt = ue && xe && !Te, St = ue && be === "orchestrator" && !Te, wt = xt || St, Tt = E || pe.isPending || me.isPending || he.isPending || ge.isPending || _e.isPending || ve.isPending || ye.isPending || je.isPending || Me.isPending || Pe.isPending, Et = Tt || F || ue && !wt, Dt = !!T.trim() && !Et, Ot = (ke.data ?? []).filter((e) => e.status === "pending"), kt = async (t, n, r) => {
		try {
			await ve.mutateAsync({
				sessionId: e,
				itemId: t,
				expectedVersion: n,
				delivery: r
			});
		} catch (e) {
			de.error(`Unable to change pending message: ${mr($(e))}`);
		}
	}, At = async (t, n) => {
		try {
			await ye.mutateAsync({
				sessionId: e,
				itemId: t,
				expectedVersion: n
			});
		} catch (e) {
			de.error(`Unable to cancel pending message: ${mr($(e))}`);
		}
	}, Mt = U(() => {
		let e = Ye.current;
		e && (e.style.height = `${ce}px`, e.style.height = `${Math.min(e.scrollHeight, le)}px`);
	}, [ce, le]);
	ui(() => {
		let e = Qe.current, t = Ye.current;
		e !== null && t && (Qe.current = null, Mt(), t.focus(), t.setSelectionRange(e, e));
	}, [Mt, T]);
	let Pt = h_({
		prompts: G(() => {
			let e = [];
			for (let n of t?.messages ?? []) n.role === "user" && e.push(Nt(n.content));
			return e.reverse();
		}, [t?.messages]),
		value: T,
		enabled: !O,
		setValue: D,
		textareaRef: Ye,
		afterCommit: Mt
	}), Ft = Pt.reset, It = li();
	W(() => Ft(), [e, Ft]);
	let Lt = G(() => E_(T), [T]), Rt = G(() => {
		if (!Lt || !We) return [];
		let e = Lt.prefix.toLocaleLowerCase();
		return We.filter((t) => (t.name !== "goal" || xe) && t.name.toLocaleLowerCase().startsWith(e));
	}, [
		We,
		Lt,
		xe
	]), zt = G(() => x_(T, M.start, M.end, qe ?? []), [
		M,
		qe,
		T
	]), Bt = G(() => {
		if (Lt !== null || qe !== void 0 || M.start === 0 || M.start !== M.end) return null;
		let e = T.lastIndexOf("$", M.start - 1);
		return e === -1 ? null : {
			start: e,
			end: M.end
		};
	}, [
		Lt,
		M,
		qe,
		T
	]), Vt = Lt ? "slash" : zt || Bt ? "skill" : null, Ht = G(() => Vt === "slash" ? Rt.map((e) => ({
		kind: "slash",
		key: e.command,
		name: `/${e.name}`,
		description: e.description,
		definition: e
	})) : Vt === "skill" && zt ? zt.entries.map((e) => ({
		kind: "skill",
		key: e.name,
		name: `$${e.name}`,
		description: e.description,
		definition: e
	})) : [], [
		Rt,
		zt,
		Vt
	]), Ut = Vt === "slash" ? O_("slash", T, 0, T.length) : Vt === "skill" ? O_("skill", T, zt?.start ?? Bt?.start ?? M.start, zt?.end ?? Bt?.end ?? M.end) : null, Wt = j && Vt !== null && Ut !== ne, Gt = Math.min(re, Math.max(Ht.length - 1, 0)), Kt = ae !== null && ae < Ht.length ? ae : Gt, qt = Wt ? Ht[Kt] : void 0, Jt = qt ? `${tt}-option-${Kt}` : void 0, Yt = U((e) => {
		qt && e.preventDefault();
	}, [qt]);
	W(() => {
		Wt && et.current[Gt]?.scrollIntoView({ block: "nearest" });
	}, [
		Gt,
		Wt,
		Ht
	]);
	let Xt = U(() => {
		N(Ut), oe(null);
	}, [Ut]), Zt = U((e) => {
		let t, n, r;
		if (e.kind === "slash") {
			if (!Lt) return;
			t = `${Lt.leadingWhitespace}/${e.definition.name}${e.definition.accepts_arguments ? " " : ""}`, n = t.length, r = O_("slash", t, 0, t.length);
		} else {
			if (!zt) return;
			let i = `$${e.definition.name}`;
			t = `${T.slice(0, zt.start)}${i}${T.slice(zt.end)}`, n = zt.start + i.length, r = O_("skill", t, zt.start, n);
		}
		t === T ? (Qe.current = null, Mt(), Ye.current?.focus(), Ye.current?.setSelectionRange(n, n)) : (Qe.current = n, D(t)), te({
			start: n,
			end: n
		}), N(r), oe(null);
	}, [
		Lt,
		Mt,
		D,
		zt,
		T
	]), Qt = G(() => b_(T, qe ?? []), [qe, T]), en = !Pt.active && Qt.some((e) => e.skillName !== null);
	ui(() => {
		let e = Ye.current, t = Ze.current;
		en && e && t && (t.scrollTop = e.scrollTop, t.scrollLeft = e.scrollLeft);
	}, [
		se,
		en,
		T
	]), W(() => {
		let e = Ye.current;
		e && (se ? (e.style.height = `${w_.mobile}px`, e.style.overflow = "hidden") : (e.style.overflow = "", Mt()));
	}, [
		se,
		Mt,
		T
	]);
	let tn = U(() => {
		let e = Ye.current;
		e && (e.focus(), requestAnimationFrame(() => {
			if (!Ye.current) return;
			let e = Ye.current.value.length;
			Ye.current.selectionStart = e, Ye.current.selectionEnd = e, te({
				start: e,
				end: e
			}), Ye.current.scrollTop = Ye.current.scrollHeight;
		}));
	}, []), nn = U(async () => {
		if (gt && !vt.isPending) try {
			await vt.mutateAsync(gt), l(gt);
		} catch (e) {
			c(gt), de.error(`SSH reconnect failed: ${mr($(e))}`);
		}
	}, [
		gt,
		vt,
		l,
		c,
		de
	]), rn = U(async (t) => {
		if (!xe) throw Error("Durable goals are available only in direct chats");
		let n = b(e), r = Ae.data;
		if (r === void 0) {
			let e = await Ae.refetch();
			if (!n()) return !1;
			if (e.error) throw e.error;
			r = e.data;
		}
		let i = t.trim().slice(5).trim();
		if (i === "" || i === "edit") O ? Re((e) => e + 1) : Be(!0);
		else if (i === "clear") {
			if (!r) throw Error("There is no durable goal to clear");
			await Pe.mutateAsync({
				sessionId: e,
				goalId: r.goal_id,
				expectedVersion: r.version
			});
		} else if (i === "pause" || i === "resume") {
			if (!r) throw Error(`There is no durable goal to ${i}`);
			await Me.mutateAsync({
				sessionId: e,
				goalId: r.goal_id,
				payload: {
					expected_version: r.version,
					status: i === "pause" ? "paused" : "active"
				}
			});
		} else {
			if (r && r.status !== "complete") throw Error("An unfinished durable goal already exists; use /goal edit or /goal clear first");
			await je.mutateAsync({
				sessionId: e,
				payload: { objective: i }
			});
		}
	}, [
		b,
		Pe,
		je,
		xe,
		Ae,
		O,
		e,
		Me
	]), an = U(async (n, r) => {
		let i = n ?? T, o = xg(i), s = o.kind === "prompt" ? o.prompt.trim() : i.trim();
		if (!s || Et) return;
		let c = n === void 0 || r !== void 0, l = w.get(e), u = b(e), d = () => {
			c && w.acknowledge(e, l) && u() && (te({
				start: 0,
				end: 0
			}), Ft(), Ye.current && (Ye.current.style.height = `${ce}px`));
		}, f = w.claimSubmission(e);
		if (f) try {
			if (o.kind === "command") {
				let n = a.current, r = () => u() && !!n?.current(), i = C.get(e)?.phase === "uncertain" && C.get(e)?.request.command === o.command;
				if (!xe || Te || !i && (ue || (t?.shell_commands ?? []).some((e) => e.state === "accepted" || e.state === "started"))) {
					de.error("Shell commands require an idle direct-primary chat");
					return;
				}
				if (!o.command.trim()) {
					de.error("Enter a command after !");
					return;
				}
				try {
					await me.mutateAsync(o.command), d();
				} catch (e) {
					r() && de.error(`Command outcome: ${mr($(e))}`);
				}
				return;
			}
			let n = We;
			if (i.trimStart().startsWith("/") && n === void 0) {
				let e = await Ke();
				if (!u()) return;
				if (n = e.data, n === void 0) {
					de.error("Unable to load slash commands");
					return;
				}
			}
			let c = n ? D_(i, n) : null;
			if (c?.command === "compact") {
				try {
					if (await ge.mutateAsync(e), d(), !u()) return;
					v("compaction", "▶ compacting context…");
				} catch (e) {
					if (!u()) return;
					v("error", `compact failed: ${mr($(e))}`, !0), de.error(`Failed to compact: ${Ku($(e), at)}`);
				}
				return;
			}
			if (c?.command === "goal") {
				try {
					await rn(s) !== !1 && d();
				} catch (e) {
					if (!u()) return;
					de.error(`Goal command failed: ${Ku($(e))}`);
				}
				return;
			}
			if (c && c.command !== "mcp_prompt") {
				de.error(`Unsupported slash command: /${c.name}`);
				return;
			}
			try {
				let t = await Ne(Oe({
					mode: xt ? "direct-running" : St ? "classic-running" : "idle",
					delivery: r,
					inbox: (t) => _e.mutateAsync({
						sessionId: e,
						delivery: t,
						prompt: s
					}),
					steer: () => he.mutateAsync({
						id: e,
						instruction: s
					}),
					submit: () => pe.mutateAsync({
						id: e,
						prompt: s
					})
				}));
				if (d(), !u()) return;
				t === "submitted" ? v("run", `▶ submitted: ${s.slice(0, 80)}`) : (xt || r) && v("steering", `▶ ${r ?? "steer"}: ${s.slice(0, 80)}`);
			} catch (e) {
				if (!u()) return;
				v("error", `submit failed: ${mr($(e))}`, !0), de.error(`Failed to send: ${Ku($(e), at)}`);
			}
		} finally {
			f();
		}
	}, [
		T,
		w,
		Et,
		b,
		e,
		Ft,
		ce,
		We,
		Ke,
		me,
		C,
		a,
		xe,
		Te,
		ue,
		t?.shell_commands,
		de,
		ge,
		v,
		at,
		rn,
		xt,
		St,
		_e,
		he,
		pe
	]);
	W(() => x((e) => void an(e)), [x, an]), W(() => {
		let t, n = S(e, (e) => {
			D(e), t !== void 0 && cancelAnimationFrame(t), t = requestAnimationFrame(() => Ye.current?.focus());
		});
		return () => {
			n(), t !== void 0 && cancelAnimationFrame(t);
		};
	}, [
		e,
		S,
		D
	]);
	let on = U(async () => {
		await fe.stopRun(e);
	}, [fe, e]), cn = /* @__PURE__ */ Y(Ir, {
		title: "Session settings",
		position: R.TopLeft,
		children: /* @__PURE__ */ Y(I, {
			className: O ? "btn-round" : void 0,
			size: O ? z.Medium : z.Small,
			variant: H.Ghost,
			content: L.Icon,
			"aria-label": "Session settings",
			onClick: () => fe.settings(e),
			children: /* @__PURE__ */ Y(B, {
				iconName: V.Gear,
				size: O ? void 0 : 16
			})
		})
	}), ln = !!T.trim(), un = (ue || F) && !ln, dn = /* @__PURE__ */ Y(B, { iconName: un ? V.Stop : V.ArrowTop }), fn = F ? "Stopping run" : ue && !ln ? "Stop run" : wt ? "Steer active run" : "Send", pn = un ? "button" : "submit", mn = F || !un && !Dt, hn = ue && !ln && !F ? () => void on() : void 0, vn = O ? /* @__PURE__ */ Y(gn, {
		className: "shrink-0",
		variant: H.Primary,
		content: L.Icon,
		type: pn,
		disabled: mn,
		loading: F,
		"aria-label": fn,
		onPointerDown: Yt,
		onClick: hn,
		children: dn
	}) : /* @__PURE__ */ Y(I, {
		className: "absolute bottom-0 right-0",
		size: z.Large,
		variant: H.Primary,
		content: L.Icon,
		type: pn,
		disabled: mn,
		loading: F,
		"aria-label": fn,
		onPointerDown: Yt,
		onClick: hn,
		children: dn
	}), yn = Wt ? Vt === "slash" ? We === void 0 ? Ge ? "Slash commands unavailable" : "Loading slash commands" : Ht.length ? `${Ht.length} slash ${Ht.length === 1 ? "command" : "commands"} available` : "No matching commands" : qe === void 0 ? Je ? "Skills unavailable" : "Loading skills" : `${Ht.length} ${Ht.length === 1 ? "skill" : "skills"} available` : "", bn = /* @__PURE__ */ X("div", {
		className: P("relative flex items-end", O ? P("flex-1 min-w-0 rounded-[20px] bg-elevation-level-3 shadow-2xl overflow-hidden", se && "pr-[40px]") : P("rounded-[4px] bg-input shadow-concave", xe ? "pr-[96px]" : "pr-[48px]")),
		children: [
			/* @__PURE__ */ X("div", {
				className: "relative flex-1 min-w-0",
				children: [
					/* @__PURE__ */ Y("span", {
						className: "sr-only",
						role: "status",
						"aria-live": "polite",
						"aria-atomic": "true",
						children: yn
					}),
					en && !se ? /* @__PURE__ */ X("div", {
						ref: Ze,
						"aria-hidden": "true",
						className: P("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-medium text-input [scrollbar-gutter:stable]", O ? "px-4 py-2" : "p-3"),
						children: [A_(Qt), T.endsWith("\n") ? " " : null]
					}) : null,
					/* @__PURE__ */ Y("textarea", {
						ref: Ye,
						className: P("relative block w-full bg-transparent resize-none border-none outline-none text-medium text-input placeholder:text-input-placeholder placeholder:whitespace-nowrap [scrollbar-gutter:stable]", O ? "px-4 py-2" : "p-3", se && "opacity-0 pointer-events-none"),
						rows: 1,
						role: "combobox",
						"aria-label": "Message",
						"aria-autocomplete": "list",
						"aria-haspopup": "listbox",
						"aria-expanded": Wt,
						"aria-controls": Wt ? tt : void 0,
						"aria-activedescendant": Jt,
						"aria-describedby": Pt.active ? It : void 0,
						enterKeyHint: O ? "enter" : void 0,
						placeholder: Pt.active ? "" : Pt.hasHistory && T === "" ? C_ : S_,
						spellCheck: !1,
						value: T,
						style: {
							minHeight: `${ce}px`,
							maxHeight: `${le}px`,
							color: en ? "transparent" : void 0,
							caretColor: en ? "var(--color-text-input)" : void 0
						},
						onChange: (e) => {
							e.target.value !== T && N(null), ie(0), oe(null), Pt.onValueChange(e.target.value), D(e.target.value), te({
								start: e.target.selectionStart,
								end: e.target.selectionEnd
							}), Mt();
						},
						onSelect: (e) => {
							let t = {
								start: e.currentTarget.selectionStart,
								end: e.currentTarget.selectionEnd
							};
							(t.start !== M.start || t.end !== M.end) && (ie(0), oe(null), te(t));
						},
						onScroll: (e) => {
							Ze.current && (Ze.current.scrollTop = e.currentTarget.scrollTop, Ze.current.scrollLeft = e.currentTarget.scrollLeft);
						},
						onFocus: (e) => {
							ee(!0), te({
								start: e.currentTarget.selectionStart,
								end: e.currentTarget.selectionEnd
							});
						},
						onBlur: () => {
							ee(!1), oe(null), Ft();
						},
						onKeyDown: (e) => {
							if (!e.nativeEvent.isComposing && (e.key !== "Enter" || !O || e.metaKey || e.ctrlKey)) {
								if (Wt && !e.shiftKey) {
									if (e.key === "Escape") {
										e.preventDefault(), Xt();
										return;
									}
									if ((e.key === "ArrowDown" || e.key === "ArrowUp") && Ht.length) {
										e.preventDefault(), ie(e.key === "ArrowDown" ? Math.min(Kt + 1, Ht.length - 1) : Math.max(Kt - 1, 0)), oe(null);
										return;
									}
									if (e.key === "Tab" && qt) {
										e.preventDefault(), Zt(qt);
										return;
									}
									if (e.key === "Enter" && (qt || Vt === "slash")) {
										e.preventDefault(), qt && Zt(qt);
										return;
									}
								}
								Pt.onKeyDown(e) || e.key === "Enter" && (e.shiftKey || (e.preventDefault(), an()));
							}
						}
					}),
					Pt.active ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y("span", {
						id: It,
						className: "sr-only",
						children: "Press Tab to take this prompt, Escape to leave it, or start typing to dismiss it"
					}), /* @__PURE__ */ X("div", {
						className: "pointer-events-none absolute inset-0 flex items-center gap-2 px-3",
						children: [/* @__PURE__ */ Y("span", {
							className: "min-w-0 truncate text-medium text-input-placeholder",
							children: Pt.previewText
						}), /* @__PURE__ */ Y(Kr, {
							keys: ["tab"],
							spelled: !0,
							className: "shrink-0"
						})]
					})] }) : null,
					se ? /* @__PURE__ */ Y("div", {
						className: "absolute inset-0 flex items-center px-4 cursor-text",
						onClick: tn,
						children: /* @__PURE__ */ Y("span", {
							className: P("w-full truncate text-medium", T ? "text-input" : "text-input-placeholder"),
							children: T ? A_(Qt) : S_
						})
					}) : null
				]
			}),
			!O && xe ? /* @__PURE__ */ Y(i_, {
				className: "absolute right-[48px] bottom-0",
				sessionId: e,
				onOpen: () => Be(!0)
			}) : null,
			O ? se ? /* @__PURE__ */ Y("div", {
				className: "absolute top-0 right-0",
				children: cn
			}) : null : vn
		]
	}), xn = /* @__PURE__ */ Y("div", {
		id: tt,
		role: "listbox",
		"aria-label": Vt === "skill" ? "Skills" : "Slash commands",
		children: Vt === "slash" && We === void 0 ? /* @__PURE__ */ Y("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: Ge ? "Slash commands unavailable" : "Loading commands…"
		}) : Vt === "skill" && qe === void 0 ? /* @__PURE__ */ Y("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: Je ? "Skills unavailable" : "Loading skills…"
		}) : Ht.length ? Ht.map((e, t) => /* @__PURE__ */ X("button", {
			id: `${tt}-option-${t}`,
			ref: (e) => {
				et.current[t] = e;
			},
			type: "button",
			role: "option",
			"aria-selected": t === Kt,
			tabIndex: -1,
			className: P("flex min-h-10 w-full items-center gap-3 rounded-[4px] px-3 py-2 text-left", t === Kt ? "btn-ghost-highlighted" : "btn-ghost"),
			onPointerDown: (e) => e.preventDefault(),
			onPointerMove: () => oe(t),
			onPointerLeave: () => oe((e) => e === t ? null : e),
			onClick: () => Zt(e),
			children: [/* @__PURE__ */ Y("span", {
				className: "code code-small shrink-0 text-basic-primary",
				children: e.name
			}), /* @__PURE__ */ Y("span", {
				className: P("min-w-0 flex-1 text-small text-basic-secondary", e.kind === "skill" && "truncate"),
				children: e.description
			})]
		}, `${e.kind}-${e.key}`)) : /* @__PURE__ */ Y("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: "No matching commands"
		})
	}), Sn = /* @__PURE__ */ Y(Zr, {
		open: Wt,
		onClose: Xt,
		content: xn,
		placement: R.TopRight,
		sticky: !0,
		closeOnEscape: !1,
		sheetOnMobile: !1,
		className: O ? "flex-1 min-w-0" : "w-full",
		size: "w-[min(400px,calc(100vw-16px))]",
		panelClassName: "max-h-[min(40vh,320px)] overflow-y-auto",
		children: bn
	});
	return De ? Te && Ce ? /* @__PURE__ */ Y(f_, {
		parentSessionId: Ce.parent_session_id,
		sessionId: e,
		kind: Ce.kind,
		description: Ce.description,
		behavior: be
	}) : /* @__PURE__ */ X("form", {
		className: P("flex flex-col", O ? "gap-3 px-4 pt-8 pb-8" : k ? "gap-3 px-2 pt-2 pb-4 rounded-[12px] bg-elevation-level-1 shadow-2xl" : "gap-4 p-4 rounded-[8px] bg-elevation-level-1 shadow-2xl"),
		style: O ? j_ : void 0,
		onSubmit: (e) => {
			e.preventDefault(), !ze && (qt ? Zt(qt) : an());
		},
		children: [
			O ? /* @__PURE__ */ X("div", {
				className: "flex items-end gap-2",
				children: [Sn, vn]
			}) : ze && xe ? /* @__PURE__ */ Y(a_, {
				sessionId: e,
				onClose: () => Be(!1)
			}) : Sn,
			Ot.length ? /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-2",
				"aria-label": "Pending messages",
				children: [/* @__PURE__ */ Y("div", {
					className: "tag-label uppercase text-basic-secondary",
					children: "Pending messages"
				}), Ot.map((t) => /* @__PURE__ */ X("div", {
					className: "flex flex-wrap items-center gap-2 rounded-[4px] border border-border-primary px-3 py-2",
					children: [
						/* @__PURE__ */ Y("span", {
							className: "tag-label text-accent-primary",
							children: t.delivery
						}),
						t.terminal_selection ? /* @__PURE__ */ Y(bg, {
							evidence: t.terminal_selection,
							canonicalText: t.prompt,
							sessionId: e
						}) : /* @__PURE__ */ Y("span", {
							className: "min-w-0 flex-1 truncate text-small text-basic-primary",
							children: t.prompt
						}),
						/* @__PURE__ */ X(I, {
							type: "button",
							size: z.Small,
							variant: H.Ghost,
							disabled: Tt,
							onClick: () => void kt(t.id, t.version, t.delivery === "steer" ? "queue" : "steer"),
							children: ["Change to ", t.delivery === "steer" ? "queue" : "steer"]
						}),
						/* @__PURE__ */ Y(I, {
							type: "button",
							size: z.Small,
							variant: H.GhostDestructive,
							disabled: Tt,
							onClick: () => void At(t.id, t.version),
							children: "Cancel"
						})
					]
				}, t.id))]
			}) : null,
			/* @__PURE__ */ X("div", {
				className: P("flex flex-wrap items-center gap-[10px]", O && "pl-2"),
				children: [/* @__PURE__ */ X("div", {
					className: "flex flex-1 min-w-0 flex-wrap items-center gap-y-1 gap-x-4",
					children: [
						xt ? /* @__PURE__ */ Y(I, {
							type: "button",
							size: z.Small,
							variant: H.Secondary,
							disabled: !Dt,
							onClick: () => void an(T, "queue"),
							children: "Queue Next"
						}) : null,
						/* @__PURE__ */ Y(Ng, {
							sessionId: e,
							metadata: t?.metadata ?? null,
							label: it.model,
							disabled: Et
						}),
						O ? null : /* @__PURE__ */ Y("div", { className: "flex-1" }),
						O ? /* @__PURE__ */ Y(Gg, {
							sessionId: e,
							behavior: be
						}) : /* @__PURE__ */ X("div", {
							className: "flex items-center gap-2",
							children: [
								cn,
								xe ? /* @__PURE__ */ Y("span", {
									"aria-hidden": !0,
									className: "h-6 w-px shrink-0 bg-divider-muted"
								}) : null,
								/* @__PURE__ */ Y(Gg, {
									sessionId: e,
									behavior: be
								})
							]
						}),
						O ? /* @__PURE__ */ Y(Yg, {
							sessionId: e,
							behavior: be,
							openRequest: Ie
						}) : null,
						bt ? /* @__PURE__ */ Y(bp, {
							state: _t === "connected" ? "connected" : "reconnect",
							onReconnect: () => void nn()
						}) : O ? /* @__PURE__ */ Y("span", {
							className: "text-[10px] leading-[12px] font-medium uppercase text-basic-tertiary shrink-0",
							children: it.env
						}) : null,
						O && (it.usage || ct) ? /* @__PURE__ */ X("div", {
							className: "flex items-center gap-[2px] min-w-0",
							children: [/* @__PURE__ */ Y(M_, {
								iconName: V.Timelaps,
								value: lt.value,
								className: "text-info-primary",
								title: lt.title,
								labelClassName: "tag-label"
							}), it.usage && !A ? /* @__PURE__ */ X(J, { children: [
								/* @__PURE__ */ Y(M_, {
									iconName: V.ArrowTop,
									value: h(it.usage.input_tokens),
									className: "text-info-secondary opacity-75",
									title: "Input tokens",
									labelClassName: "tag-label"
								}),
								it.usage.cache_read_tokens > 0 ? /* @__PURE__ */ Y(M_, {
									prefix: "C",
									value: h(it.usage.cache_read_tokens),
									className: "text-info-secondary opacity-75",
									title: "Cache read tokens",
									labelClassName: "tag-label"
								}) : null,
								/* @__PURE__ */ Y(M_, {
									iconName: V.ArrowDown,
									value: h(it.usage.output_tokens),
									className: "text-info-secondary opacity-75",
									title: "Output tokens",
									labelClassName: "tag-label"
								})
							] }) : null]
						}) : null
					]
				}), O ? /* @__PURE__ */ X("div", {
					className: "flex items-center gap-[10px] shrink-0",
					children: [it.usage ? /* @__PURE__ */ Y(M_, {
						iconName: V.Price,
						iconSize: 16,
						value: Yr(it.usage.cost?.total),
						className: "text-basic-primary",
						title: "Session cost",
						showIcon: !1
					}) : null, /* @__PURE__ */ Y(Ir, {
						title: ue ? "Run elapsed" : "Last response time",
						position: R.TopRight,
						children: /* @__PURE__ */ X("div", {
							className: P("flex items-center gap-1 p-1 shrink-0 label-micro", ue ? "text-basic-primary" : "text-basic-tertiary"),
							children: [A ? null : ue ? /* @__PURE__ */ Y(f, { size: mt.Small }) : /* @__PURE__ */ Y(B, {
								iconName: V.History,
								size: 16
							}), /* @__PURE__ */ Y("span", {
								className: "block w-[40px] text-center",
								children: Pr(ht)
							})]
						})
					})]
				}) : null]
			})
		]
	}) : /* @__PURE__ */ X("div", {
		className: "flex items-center gap-3 rounded-[8px] border border-border-primary bg-elevation-level-1 p-4 text-small text-basic-secondary shadow-2xl",
		children: [/* @__PURE__ */ Y("span", {
			className: "flex-1",
			children: "Loading session controls…"
		}), ue && /* @__PURE__ */ Y(I, {
			size: z.Small,
			variant: H.GhostDestructive,
			content: L.Text,
			"aria-label": "Stop run",
			onClick: () => void on(),
			children: "Stop"
		})]
	});
}
// src/app/components/inspector/MobileBottomBar.tsx
var F_ = {
	sessions: {
		label: "Sessions",
		iconName: V.Chat
	},
	threads: {
		label: "Threads",
		iconName: V.Flow
	},
	delegated: {
		label: "Subagents",
		iconName: V.Robot
	},
	files: {
		label: "Files",
		iconName: V.Folders
	},
	terminal: {
		label: "Terminal",
		iconName: V.Terminal
	},
	worksets: {
		label: "Worksets",
		iconName: V.Checklist
	},
	history: {
		label: "History",
		iconName: V.History
	}
};
function I_({ panel: e, onPanelChange: t, panels: n = $n }) {
	return /* @__PURE__ */ Y("div", {
		className: "absolute inset-x-0 bottom-0 z-10 px-2 py-4 pointer-events-none",
		children: /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-1 w-full p-[2px] rounded-[18px] bg-elevation-level-3 shadow-2xl overflow-hidden pointer-events-auto",
			role: "tablist",
			children: n.map((n) => {
				let r = e === n;
				return /* @__PURE__ */ X("button", {
					type: "button",
					role: "tab",
					"aria-selected": r,
					className: P("flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]", r ? "btn-primary" : "btn-ghost"),
					onClick: () => t(n),
					children: [/* @__PURE__ */ Y(B, {
						iconName: F_[n].iconName,
						size: 28
					}), /* @__PURE__ */ Y("span", {
						className: P("label-micro font-bold truncate max-w-full", r ? null : "text-basic-primary"),
						children: F_[n].label
					})]
				}, n);
			})
		})
	});
}
// src/app/components/inspector/PanelCountBadge.tsx
function L_({ count: e }) {
	return /* @__PURE__ */ Y("span", {
		className: "pointer-events-none absolute -top-1 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-btn-primary-disabled px-0.5 text-[9px] leading-3 font-medium text-basic-secondary",
		children: e
	});
}
// src/app/components/inspector/sessionPanelIcons.ts
var R_ = {
	sessions: V.Chat,
	threads: V.Flow,
	delegated: V.Robot,
	files: V.Folders,
	terminal: V.Terminal,
	worksets: V.Checklist,
	history: V.History
};
function z_(e, t, n) {
	return e === "delegated" ? t : e === "worksets" ? n : 0;
}
function B_({ sessionId: e, snapshot: t, behavior: n, panels: r, onOpen: i, onSelect: a }) {
	let o = fr(), s = r.includes("delegated"), c = Dt(e, s), l = ht(e, s && n === "direct-with-orchestrator"), u = (c.data?.length ?? 0) + (o.orchestrationEnabled ? l.data?.length ?? 0 : 0), d = t?.worksets?.items.length ?? 0;
	return /* @__PURE__ */ Y("div", {
		className: "flex h-full flex-col items-center p-2",
		style: { width: 52 },
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col items-center gap-4 [&>*]:shrink-0",
			children: [/* @__PURE__ */ Y(V_, {
				label: "Show panel",
				onClick: i,
				children: /* @__PURE__ */ Y(B, { iconName: V.SidebarChevronLeft })
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-col items-center gap-4",
				children: r.map((e) => {
					let t = z_(e, u, d);
					return /* @__PURE__ */ X("span", {
						className: "relative",
						children: [/* @__PURE__ */ Y(V_, {
							label: yr[e],
							onClick: () => a(e),
							children: /* @__PURE__ */ Y(B, { iconName: R_[e] })
						}), t > 0 ? /* @__PURE__ */ Y(L_, { count: t }) : null]
					}, e);
				})
			})]
		})
	});
}
function V_({ label: e, onClick: t, children: n }) {
	return /* @__PURE__ */ Y(Ir, {
		title: e,
		position: R.CenterLeft,
		sticky: !0,
		children: /* @__PURE__ */ Y(I, {
			variant: H.Ghost,
			content: L.Icon,
			"aria-label": e,
			onClick: t,
			children: n
		})
	});
}
// src/app/features/terminal/queries.ts
var H_ = {
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
function U_(e, t) {
	let { api: r } = n();
	return _i({
		queryKey: H_.status(e, t),
		queryFn: ({ signal: n }) => r.getUserTerminal(e, t, n),
		retry: !1,
		refetchInterval: (e) => !e.state.data || e.state.data.alive || !e.state.data.output_complete ? 1e3 : !1
	});
}
function W_(e) {
	let { api: t } = n(), r = vi();
	return hi({
		mutationFn: (n) => t.openUserTerminal(e, {
			protocol_version: 1,
			launch_id: n,
			cols: 80,
			rows: 24
		}),
		retry: !1,
		onSuccess: () => Promise.all([r.invalidateQueries({ queryKey: H_.list(e) }), r.invalidateQueries({ queryKey: G_.list(e) })])
	});
}
var G_ = { list: (e) => [
	"session",
	e,
	"executions"
] };
function K_(e) {
	let { api: t } = n();
	return _i({
		queryKey: G_.list(e),
		queryFn: ({ signal: n }) => t.listExecutions(e, n),
		retry: !1,
		refetchInterval: 1e3
	});
}
function q_(e, t) {
	let { api: r } = n(), i = vi();
	return hi({
		mutationFn: () => r.stopExecution(e, t),
		retry: !1,
		onSuccess: () => i.invalidateQueries({ queryKey: G_.list(e) })
	});
}
// packages/nac-client/src/userTerminalInputPump.ts
var J_ = 16384, Y_ = class extends Error {
	cause;
	constructor(e, t) {
		super(e), this.name = "TerminalInputNotSentError", this.cause = t;
	}
}, X_ = class {
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
			this.disposed = !0, this.rejectPending(new Y_("Terminal input was not sent because its consumer closed", this.signal.reason));
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
		return e.length === 0 || e.length > J_ ? Promise.reject(new Y_("Terminal input was not sent: each input must contain 1–16384 bytes")) : this.disposed ? Promise.reject(new Y_("Terminal input was not sent because its consumer closed")) : this.failed === void 0 ? this.active && this.pendingBytes + e.length > J_ ? Promise.reject(new Y_("Terminal input was not sent because the pending 16 KiB buffer is full")) : new Promise((t, n) => {
			let r = {
				resolve: t,
				reject: n
			};
			this.active ? (this.pending ??= {
				buffer: new Uint8Array(J_),
				length: 0,
				receipts: []
			}, this.pending.buffer.set(e, this.pending.length), this.pending.length += e.length, this.pending.receipts.push(r)) : (this.active = !0, this.deliver({
				bytes: e.slice(),
				receipts: [r]
			}));
		}) : Promise.reject(new Y_("Terminal input was not sent: acknowledge the preceding delivery failure first", this.failed));
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
			let n = t instanceof _t ? t : new Y_("Terminal input was not sent", t);
			for (let t of e.receipts) t.reject(n);
			this.rejectPending(new Y_("Pending terminal input was not sent after the preceding delivery failed", t));
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
		if (this.active) throw new Y_("Wait for the active input receipt before acknowledging its outcome");
		this.failed = void 0, this.connection.acknowledgeInputUncertainty();
	}
	dispose() {
		this.abort.abort(new DOMException("Terminal input consumer closed", "AbortError")), this.signal.removeEventListener("abort", this.cancelListener);
	}
}, Z_ = 65536;
function Q_(e, t) {
	let n = new TextDecoder(), r = "", i = !1, a = !1, o = (n) => {
		let i = "";
		for (let e of n) {
			let t = e.charCodeAt(0);
			i += t < 32 && t !== 9 && t !== 10 || t >= 127 && t <= 159 ? `\\x${t.toString(16).padStart(2, "0")}` : e;
		}
		let o = r + i;
		r = o.slice(-65536), e.textContent = r, e.scrollTop = e.scrollHeight, o.length > Z_ && !a && (a = !0, t?.(!0));
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
function $_({ sessionId: e, source: t }) {
	let { api: r } = n(), i = K(null), [a] = q(() => t), [o, s] = q(0), [c, l] = q("Connecting"), [u, f] = q(""), [p, m] = q(!1);
	return W(() => {
		if (!i.current) return;
		let t = pt(on()), n = new AbortController(), s = Q_(i.current, m), c = ae(r, e, a, s.renderer, { pageLimit: 32768 });
		pt(kt(t, N(() => {
			s.dispose(), c.detach().catch(() => {});
		})));
		let u = dr({
			try: async () => {
				l("Connecting"), f(""), await c.attach(n.signal, o ? "reconnect" : "attach"), !n.signal.aborted && (l("Connected"), await c.run(n.signal, (e) => {
					e.gap && !n.signal.aborted && f("Earlier output was discarded. The log was reset before replay.");
				}), n.signal.aborted || (s.finish(), l("Output complete")));
			},
			catch: (e) => e
		});
		return d(u, { signal: n.signal }).then((e) => {
			if (!n.signal.aborted && _r(e)) {
				let t = Zn(e.cause);
				l("Disconnected"), f(t instanceof Error ? t.message : "Log observation unavailable");
			}
		}), () => {
			n.abort(), pt(We(t, Bt));
		};
	}, [
		r,
		e,
		a,
		o
	]), /* @__PURE__ */ X(J, { children: [
		/* @__PURE__ */ X("div", {
			className: "flex items-center gap-2",
			children: [/* @__PURE__ */ Y("span", {
				role: "status",
				children: c
			}), /* @__PURE__ */ Y(I, {
				type: "button",
				size: z.Small,
				variant: H.Ghost,
				onClick: () => s((e) => e + 1),
				children: "Reconnect"
			})]
		}),
		u ? /* @__PURE__ */ Y("p", {
			role: "alert",
			children: u
		}) : null,
		p ? /* @__PURE__ */ Y("p", {
			role: "status",
			children: "Display limit reached. Showing the latest output; earlier text is hidden in this view."
		}) : null,
		/* @__PURE__ */ Y("pre", {
			ref: i,
			tabIndex: 0,
			role: "region",
			"aria-label": "Execution log",
			className: "flex-1 min-h-32 overflow-auto whitespace-pre-wrap break-words bg-elevation-level-1 p-2 text-sm font-mono"
		})
	] });
}
// src/app/features/terminal/useInputOwnership.ts
var ev = (e, t) => [
	"session",
	e,
	"execution",
	t,
	"input-control"
];
function tv(e, t) {
	return !t && e?.representation === "pty" && e.backend === "local" && (e.origin === "human" || e.origin === "agent" && e.retained);
}
function nv(e, t) {
	return e && BigInt(e.revision) > BigInt(t.revision) ? e : t;
}
function rv(e, t, r) {
	let { api: i } = n(), a = vi(), o = ev(e, t.id), s = tv(t, r), c = _i({
		queryKey: o,
		queryFn: ({ signal: n }) => i.getTerminalInputControl(e, t.id, n),
		enabled: s,
		retry: !1,
		refetchInterval: s ? 1e3 : !1,
		structuralSharing: (e, t) => nv(e, t)
	}), l = hi({
		mutationFn: async ({ controller: n, acknowledge: r = !1 }) => {
			if (!s || c.isError || !c.data) throw Error("Current input ownership is unavailable. Refresh before changing control.");
			let l = c.data.revision;
			return await a.cancelQueries({ queryKey: o }), i.transferTerminalInputControl(e, t.id, {
				protocol_version: 1,
				expected_revision: l,
				controller: n,
				acknowledge_uncertainty: r
			});
		},
		retry: !1,
		onSuccess: (e) => a.setQueryData(o, (t) => nv(t, e)),
		onSettled: () => a.invalidateQueries({ queryKey: o })
	});
	return {
		offered: s,
		state: s && !c.isError ? c.data : void 0,
		loading: s && c.isPending,
		unavailable: s && c.isError,
		pending: l.isPending,
		error: l.error,
		change: l.mutateAsync,
		refresh: c.refetch
	};
}
// src/app/features/terminal/xtermAdapter.ts
var iv = 14, av = 1.2, ov = "\"IBMPlexMono\", Menlo, monospace";
async function sv(e) {
	let { Terminal: t } = await import("./chunks/xterm-q3E93r5O.js"), n = new t({
		cols: 80,
		rows: 24,
		fontFamily: ov,
		fontSize: iv,
		lineHeight: av,
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
		fit: () => cv(n, e),
		dispose: () => {
			i = !0, r.dispose(), n.dispose();
		}
	};
}
function cv(e, t) {
	let n = document.createElement("canvas").getContext("2d");
	if (!n || t.clientWidth < 1 || t.clientHeight < 1) return null;
	n.font = `${iv}px ${ov}`;
	let r = n.measureText("W").width;
	if (r <= 0) return null;
	let i = Math.max(2, Math.min(500, Math.floor((t.clientWidth - 18) / r))), a = e.element ? e.element.clientHeight / e.rows : 0, o = a > 0 ? a : iv * av, s = Math.max(1, Math.min(300, Math.floor(t.clientHeight / o)));
	return e.cols === i && e.rows === s ? null : (e.resize(i, s), {
		cols: i,
		rows: s
	});
}
// src/app/features/terminal/humanInput.ts
function lv(e, t) {
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
var uv = class extends Tt("TerminalOperationFailure") {};
function dv(e, t) {
	return dr({
		try: t,
		catch: (t) => new uv({
			operation: e,
			cause: t
		})
	});
}
function fv(e, t) {
	return e instanceof Error ? e.message : t;
}
function pv(e) {
	let t = pt(on()), n = new AbortController(), r = () => !n.signal.aborted, i = (e) => {
		r() ? pt(kt(t, N(e))) : e();
	}, a, o = !1, s = !1, c = e.inputControl, l = e.inputPaused ?? !1, u = (t) => {
		r() && (o = !1, e.phase("Disconnected"), e.notice(fv(t, "Terminal observation failed")), a && (a.terminal.options.disableStdin = !0));
	}, f = (e) => {
		d(e, { signal: n.signal }).then((e) => {
			if (_r(e) && r()) {
				let t = Dr(e.cause);
				u(Sr(t) ? t.value.cause : Zn(e.cause));
			}
		}).catch(u);
	};
	return f(Ve(function* () {
		a = yield* dv("renderer", () => sv(e.host).then((e) => (i(e.dispose), n.signal.throwIfAborted(), e)));
		let t = a, u = e.source && e.api.attachExecution && e.api.pullExecution && e.api.detachExecution && e.api.stopExecution && e.api.listExecutions ? ae(e.api, e.sessionId, e.source, t.renderer, {
			pageLimit: 32768,
			readonly: e.readonly
		}, e.inputControl) : new ne(e.api, e.sessionId, e.terminalId, t.renderer, { pageLimit: 32768 });
		i(() => {
			u.detach().catch(() => {});
		});
		let d = new X_(u, n.signal), p = /* @__PURE__ */ new Set(), m = () => d.hasActiveInput || [...p].some((e) => e.hasActiveInput);
		i(() => {
			(m() || d.needsAcknowledgement) && (e.previousFailure.current = !0), d.dispose(), e.controls(null);
		});
		let h = () => {
			let n = r() && o && !e.readonly && !l && (c === void 0 ? s && e.source?.input !== !1 : !!c && c.controller === "human" && !c.frozen) && !e.previousFailure.current && e.previousFailure.available !== !1 && !d.needsAcknowledgement;
			return t.terminal.options.disableStdin = !n, n;
		}, g;
		e.controls({
			adapter: t,
			get pump() {
				return d;
			},
			restoreFreshInput: h,
			hasActiveInput: m,
			updateInput: (r, i) => {
				if (!(c && r && BigInt(r.revision) < BigInt(c.revision)) && (c?.controller !== r?.controller || c?.revision !== r?.revision || c?.frozen !== r?.frozen || c === void 0 != (r === void 0) || c === null != (r === null) || l !== i)) {
					g?.(), t.terminal.options.disableStdin = !0, (d.hasActiveInput || d.needsAcknowledgement) && (e.previousFailure.current = !0), d.hasActiveInput && p.add(d), d.dispose(), c = r, l = i, e.source && u.replaceInputTransport(ft(e.api, e.source, r, e.readonly)), d = new X_(u, n.signal);
					for (let e of p) e.hasActiveInput || p.delete(e);
					e.inputFailure(e.previousFailure.current), h();
				}
			}
		}), i(e.previousFailure.subscribe?.(() => {
			r() && (h(), e.inputFailure(e.previousFailure.current), e.notice(e.previousFailure.current ? "Input delivery was not confirmed. Check the shell before enabling fresh input." : "Previous input will not be retried. Only fresh typing will be sent."));
		}) ?? (() => {}));
		let _ = !1, v = null, y = vt(() => {
			if (e.readonly || e.source && e.source.origin !== "human" && e.source.resize === !1) return e.source && t.terminal.resize(e.source.cols, e.source.rows), Fn;
			let i = t.fit();
			return i && (v = i), _ || !o || !s || e.source?.resize === !1 ? Fn : (_ = !0, Ve(function* () {
				for (; v && r() && s;) {
					let e = v;
					v = null, yield* dv("resize", () => u.resize(e.cols, e.rows, n.signal));
				}
			}).pipe(An((t) => N(() => {
				r() && e.notice(`Terminal resize failed: ${fv(t.cause, "geometry control unavailable")}`);
			})), De(N(() => {
				_ = !1;
			}))));
		}), b = (n) => {
			let i = t.terminal.textarea;
			if (!r() || !o || e.readonly || l || t.terminal.options.disableStdin || e.previousFailure.current || e.previousFailure.available === !1 || !i || i.ownerDocument.activeElement !== i) return;
			let a = d;
			f(dv("input", () => a.send(n)).pipe(An((n) => N(() => {
				r() && (e.notice(fv(n.cause, "Terminal input failed")), n.cause instanceof Y_ && n.cause.cause instanceof ct ? (a.acknowledgeFailure(), h()) : a.needsAcknowledgement && (e.previousFailure.current = !0, t.terminal.options.disableStdin = !0, e.inputFailure(!0)));
			}))));
		}, x = lv(t.terminal, b);
		g = () => {
			x(), x = lv(t.terminal, b);
		}, i(() => {
			x(), g = void 0;
		});
		let S = new ResizeObserver(() => f(y));
		i(() => S.disconnect()), S.observe(e.host), t.terminal.element && S.observe(t.terminal.element), e.phase("Connecting"), e.notice(""), e.inputFailure(e.previousFailure.current);
		let C = yield* dv("attach", () => u.attach(n.signal, e.reconnect ? "reconnect" : "attach"));
		r() && (o = !0, s = C.alive, h(), e.previousFailure.current && e.notice("Input delivery was not confirmed. Check the shell before enabling fresh input."), e.previousFailure.available === !1 && e.notice("Input recovery storage is full. Acknowledge earlier failures, then reconnect before typing in another terminal."), e.phase(C.alive ? "Connected" : "Retained output"), yield* y, document.fonts.ready.then(() => {
			r() && f(y);
		}), yield* dv("observe", () => u.run(n.signal, (t) => {
			s = t.terminal.alive, s || (v = null), h(), t.gap && r() && e.notice("Earlier output was discarded. The display was reset before retained output was replayed.");
		})), r() && (c === void 0 && (o = !1), h(), e.phase("Output complete")));
	})), () => {
		n.abort(), pt(We(t, Bt));
	};
}
// src/app/features/terminal/useTerminalController.ts
function mv(e, t, r, i, a = {}) {
	let o = n(), { api: s } = o, c = K(null), [l, u] = q(0), [d, f] = q("Connecting"), [p, m] = q(""), [h, g] = q(!1), _ = K(null), v = a.inputControl, y = v?.controller, b = v?.revision, x = v?.frozen, S = v === void 0, C = v === null, w = G(() => S ? void 0 : C ? null : {
		controller: y,
		revision: b,
		frozen: x
	}, [
		S,
		C,
		y,
		b,
		x
	]), T = K(i);
	ui(() => {
		T.current = i;
	}, [i]);
	let E = i !== void 0, D = K({
		binding: w,
		paused: a.inputPaused ?? !1
	});
	return ui(() => {
		D.current = {
			binding: w,
			paused: a.inputPaused ?? !1
		}, c.current?.updateInput(w, a.inputPaused ?? !1);
	}, [w, a.inputPaused]), W(() => {
		let n = r.current;
		if (!n) return;
		let i = hr(o).acquire(e, t);
		_.current = i;
		let u = pv({
			api: s,
			source: T.current,
			readonly: a.readonly,
			inputControl: D.current.binding,
			inputPaused: D.current.paused,
			sessionId: e,
			terminalId: t,
			host: n,
			reconnect: l !== 0,
			previousFailure: i,
			controls: (e) => {
				c.current = e, e?.updateInput(D.current.binding, D.current.paused);
			},
			phase: f,
			notice: m,
			inputFailure: g
		});
		return () => {
			u(), i.release(), _.current === i && (_.current = null);
		};
	}, [
		o,
		s,
		e,
		t,
		l,
		r,
		E,
		i?.id,
		i?.origin,
		i?.representation,
		i?.backend,
		i?.retained,
		i?.input,
		i?.resize,
		a.readonly
	]), {
		phase: d,
		notice: p,
		inputFailure: h,
		reconnect: () => u((e) => e + 1),
		selection: () => {
			let e = c.current?.adapter.terminal.getSelection() ?? "";
			return e || m("Select text in the terminal before reviewing it."), e;
		},
		focus: () => c.current?.adapter.terminal.focus(),
		hasActiveInput: () => c.current?.hasActiveInput() === !0,
		acknowledgeInput: (e) => {
			let t = c.current;
			if (!t || t.hasActiveInput() || !_.current?.available) return !1;
			e && t.updateInput(e, !1), t.pump.acknowledgeFailure(), _.current.acknowledge();
			let n = t.restoreFreshInput();
			return g(!1), m(n ? "Previous input will not be retried. Only fresh typing will be sent." : "Previous input will not be retried. This source has no connected live input."), n && t.adapter.terminal.focus(), !0;
		}
	};
}
// src/app/features/terminal/TerminalPane.tsx
function hv(e) {
	let { api: t } = n(), r = G(() => ({
		api: t,
		id: crypto.randomUUID()
	}), [t]);
	return /* @__PURE__ */ Y(gv, { ...e }, `${r.id}:${e.sessionId}`);
}
function gv({ sessionId: e, onReviewSelection: t, history: n }) {
	let r = K_(e), i = W_(e), [a, o] = q(null), [s, c] = q(null), l = K(null), u = r.data?.executions ?? [], d = a ?? u[0]?.id, f = s?.id === d ? s : u.find((e) => e.id === d);
	return a == null && f && o(f.id), /* @__PURE__ */ X("section", {
		"aria-label": "Session terminal",
		className: "flex flex-col flex-1 min-h-0 gap-2 p-3",
		children: [
			/* @__PURE__ */ X("div", {
				className: "flex items-center flex-wrap gap-2",
				children: [
					/* @__PURE__ */ Y("label", {
						className: "sr-only",
						htmlFor: `terminal-${e}`,
						children: "Shell"
					}),
					/* @__PURE__ */ X("select", {
						id: `terminal-${e}`,
						"aria-label": "Shell",
						value: d ?? "",
						onChange: (e) => {
							c(null), o(e.target.value);
						},
						className: "min-w-0 max-w-full rounded-md border border-muted bg-elevation-level-2 px-2 py-1 text-sm",
						children: [
							d ? null : /* @__PURE__ */ Y("option", {
								value: "",
								children: "No shell"
							}),
							d && !u.some((e) => e.id === d) ? /* @__PURE__ */ Y("option", {
								value: d,
								children: "Selected shell unavailable"
							}) : null,
							u.map((e, t) => /* @__PURE__ */ X("option", {
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
					/* @__PURE__ */ Y(I, {
						size: z.Small,
						type: "button",
						variant: H.Secondary,
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
			/* @__PURE__ */ Y("p", {
				className: "text-sm text-basic-secondary",
				children: "Human shells, agent executions and ! commands use the chat’s existing execution environment."
			}),
			r.isError ? /* @__PURE__ */ X("p", {
				role: "alert",
				children: [
					"Shell list unavailable.",
					" ",
					/* @__PURE__ */ Y(I, {
						size: z.Small,
						type: "button",
						onClick: () => {
							r.refetch();
						},
						children: "Refresh"
					})
				]
			}) : null,
			i.isError ? /* @__PURE__ */ X("p", {
				role: "alert",
				children: [i.error.message, " Opening was not confirmed; retry uses the same launch identity."]
			}) : null,
			n?.((e) => {
				c(e), o(e.id);
			}),
			s ? /* @__PURE__ */ Y(I, {
				type: "button",
				size: z.Small,
				variant: H.Ghost,
				onClick: () => c(null),
				children: "Return to live source"
			}) : null,
			f ? /* @__PURE__ */ Y(_v, {
				sessionId: e,
				source: f,
				historical: s != null,
				onReviewSelection: t
			}, `${f.id}:${s ? "history" : "live"}`) : /* @__PURE__ */ Y("p", {
				role: "status",
				children: d ? "Selected execution unavailable." : r.isPending ? "Loading executions…" : "Open a shell to start typing. Terminal output stays separate from the conversation."
			})
		]
	});
}
function _v({ sessionId: e, source: t, onReviewSelection: n, historical: r = !1 }) {
	let i = q_(e, t.id);
	return /* @__PURE__ */ X(J, { children: [
		/* @__PURE__ */ Y("code", {
			"aria-label": "Execution identity",
			className: "break-all text-xs text-basic-secondary",
			children: t.id
		}),
		/* @__PURE__ */ X("p", {
			className: "text-sm text-basic-secondary break-words",
			children: [
				t.origin === "human" ? "Human shell" : t.origin === "human_command" ? "Human ! command" : "Agent execution",
				` · ${t.backend} · ${t.cwd} · ${t.process_state.replaceAll("_", " ")}`,
				t.exit_code == null ? "" : ` (${t.exit_code})`,
				t.output_complete ? " · collection complete" : " · collecting output",
				r || t.representation === "log" || t.origin === "agent" && !t.retained ? " · Read-only" : ""
			]
		}),
		r ? null : /* @__PURE__ */ Y("div", { children: /* @__PURE__ */ Y(I, {
			type: "button",
			size: z.Small,
			variant: H.Ghost,
			disabled: !t.stop || i.isPending,
			onClick: () => i.mutate(),
			children: i.isPending ? "Stopping…" : t.origin === "human" ? "Close shell" : "Stop execution"
		}) }),
		i.isError ? /* @__PURE__ */ X("p", {
			role: "alert",
			children: [i.error.message, " Stop was not confirmed; check its status."]
		}) : null,
		t.output_error ? /* @__PURE__ */ Y("p", {
			role: "alert",
			children: t.output_error
		}) : null,
		t.representation === "log" ? /* @__PURE__ */ Y($_, {
			sessionId: e,
			source: t
		}) : /* @__PURE__ */ Y(vv, {
			sessionId: e,
			source: t,
			historical: r,
			onReviewSelection: !r && t.origin === "human" ? n : void 0
		})
	] });
}
function vv({ sessionId: e, source: t, onReviewSelection: n, historical: r = !1 }) {
	let i = t.id, a = { data: t }, o = rv(e, t, r), s = K(null), c = mv(e, i, s, t, {
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
	return /* @__PURE__ */ X(J, { children: [
		/* @__PURE__ */ X("div", {
			className: "flex flex-wrap items-center gap-2",
			children: [
				/* @__PURE__ */ X("span", {
					role: "status",
					children: [c.phase, a.data && !a.data.alive ? ` · Exited${a.data.exit_code == null ? "" : ` (${a.data.exit_code})`}` : ""]
				}),
				/* @__PURE__ */ Y(I, {
					size: z.Small,
					type: "button",
					variant: H.Ghost,
					onClick: c.focus,
					children: "Focus terminal"
				}),
				/* @__PURE__ */ Y(I, {
					size: z.Small,
					type: "button",
					variant: H.Ghost,
					disabled: c.phase === "Connecting",
					onClick: c.reconnect,
					children: "Reconnect"
				}),
				n ? /* @__PURE__ */ Y(I, {
					size: z.Small,
					type: "button",
					variant: H.Ghost,
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
		c.notice ? /* @__PURE__ */ Y("p", {
			role: "alert",
			children: c.notice
		}) : null,
		!r && o.offered ? /* @__PURE__ */ X("div", {
			className: "flex flex-wrap items-center gap-2",
			"aria-label": "Terminal input ownership",
			children: [
				/* @__PURE__ */ Y("span", {
					role: "status",
					"aria-label": "Input controller",
					children: o.loading ? "Checking input control…" : o.state ? `Input: ${o.state.controller === "human" ? "Human" : "Agent"}${o.state.frozen ? " · Frozen" : ""}` : "Input unavailable"
				}),
				o.state?.controller === "agent" ? /* @__PURE__ */ Y(I, {
					size: z.Small,
					type: "button",
					variant: H.Secondary,
					disabled: o.pending,
					onClick: () => l("human"),
					children: t.origin === "human" ? "Reclaim input" : "Take control"
				}) : o.state?.controller === "human" ? /* @__PURE__ */ Y(I, {
					size: z.Small,
					type: "button",
					variant: H.Ghost,
					disabled: o.pending || o.state.frozen || c.inputFailure || c.hasActiveInput(),
					onClick: () => l("agent"),
					children: "Give agent control"
				}) : null,
				o.state?.controller === "human" && o.state.frozen || c.inputFailure ? /* @__PURE__ */ Y(I, {
					size: z.Small,
					type: "button",
					variant: H.Secondary,
					disabled: o.pending || o.state?.in_flight || c.hasActiveInput(),
					onClick: () => {
						o.state ? l("human", !0) : c.acknowledgeInput();
					},
					children: "Acknowledge failure and enable fresh input"
				}) : null,
				o.unavailable ? /* @__PURE__ */ Y(I, {
					type: "button",
					size: z.Small,
					onClick: () => {
						o.refresh();
					},
					children: "Refresh input control"
				}) : null
			]
		}) : null,
		!r && o.error ? /* @__PURE__ */ X("p", {
			role: "alert",
			children: [o.error.message, " Input ownership was not confirmed; refresh before another action."]
		}) : null,
		/* @__PURE__ */ Y("div", {
			ref: s,
			role: "region",
			"aria-label": "Interactive terminal",
			className: "flex-1 min-h-32 overflow-auto",
			style: { background: "#151719" }
		})
	] });
}
// src/app/features/terminal/historyQueries.ts
var yv = (e) => [
	"session",
	e,
	"execution-history"
];
function bv(e) {
	let { api: t } = n();
	return _i({
		queryKey: yv(e),
		queryFn: ({ signal: n }) => t.listExecutionHistory(e, n),
		retry: !1,
		refetchInterval: 2e3
	});
}
// src/app/features/terminal/historyModel.ts
function xv(e) {
	let t = e.execution;
	return e.command ? `Human command: ${e.command.command.slice(0, 60)}` : t ? t.origin === "human" ? "Human shell" : t.representation === "pty" ? "Agent PTY" : "Agent command log" : "Unavailable execution";
}
function Sv(e) {
	let t = e.command, n = e.execution;
	return t ? `${t.state.replaceAll("_", " ")}${t.exit_code == null ? "" : ` · exit ${t.exit_code}`}` : n ? n.process_state === "cleanup_pending" ? "Cleanup pending" : n.process_state === "running" ? "Running" : `${e.outcome?.replaceAll("_", " ") ?? "Settled"}${n.exit_code == null ? "" : ` · exit ${n.exit_code}`}` : "Current process status unavailable";
}
function Cv(e) {
	switch (e.output.availability) {
		case "retained": return "Retained output available.";
		case "tail_gap": return `Earlier output was discarded. Retained bytes ${e.output.retained_start}–${e.output.retained_end}; the display resets before reading the tail.`;
		case "expired": return "Output expired. The recorded outcome remains available.";
		case "process_local_unavailable": return "Process-local output unavailable. It may have expired or been lost on server restart; no shell or log is restored.";
		case "not_recorded": return "No fuller output reference was recorded. This does not prove an unconfirmed command had no effects.";
	}
}
function wv(e) {
	return !!e.execution && (e.output.availability === "retained" || e.output.availability === "tail_gap");
}
function Tv(e) {
	return !wv(e) || !e.execution ? null : {
		...e.execution,
		input: !1,
		resize: !1,
		stop: !1
	};
}
// src/app/features/terminal/RecentExecutionHistory.tsx
function Ev({ sessionId: e, onReopen: t }) {
	let n = bv(e), [r, i] = q(""), a = n.data?.history.entries ?? [], o = a.find((e) => e.id === r);
	return /* @__PURE__ */ X("section", {
		"aria-label": "Recent terminal activity",
		className: "flex flex-col gap-2 text-sm",
		children: [
			/* @__PURE__ */ X("div", {
				className: "flex flex-wrap items-center gap-2",
				children: [/* @__PURE__ */ Y("label", {
					htmlFor: `recent-executions-${e}`,
					children: "Recent activity"
				}), /* @__PURE__ */ X("select", {
					id: `recent-executions-${e}`,
					value: o?.id ?? "",
					onChange: (e) => i(e.target.value),
					className: "min-w-0 max-w-full rounded-md border border-muted bg-elevation-level-2 px-2 py-1",
					children: [/* @__PURE__ */ Y("option", {
						value: "",
						children: "Choose recent activity"
					}), a.map((e, t) => /* @__PURE__ */ X("option", {
						value: e.id,
						children: [
							t + 1,
							". ",
							xv(e),
							" · ",
							Sv(e)
						]
					}, e.id))]
				})]
			}),
			/* @__PURE__ */ Y("p", {
				className: "text-basic-secondary",
				children: "Up to 32 recent entries. Older metadata can expire. Reopening observes output and sends no input."
			}),
			n.isPending ? /* @__PURE__ */ Y("p", {
				role: "status",
				children: "Loading recent activity…"
			}) : null,
			n.isError ? /* @__PURE__ */ X("p", {
				role: "alert",
				children: [
					"Recent activity unavailable.",
					" ",
					/* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						onClick: () => void n.refetch(),
						children: "Refresh recent activity"
					})
				]
			}) : null,
			!n.isPending && !n.isError && a.length === 0 ? /* @__PURE__ */ Y("p", { children: "No recent activity is available." }) : null,
			r && !o ? /* @__PURE__ */ Y("p", {
				role: "status",
				children: "Selected activity is no longer in bounded history."
			}) : null,
			n.data?.history.older_entries_omitted ? /* @__PURE__ */ Y("p", { children: "Older entries are omitted from this recent view." }) : null,
			o ? /* @__PURE__ */ X("article", {
				"aria-label": "Recorded terminal activity",
				className: "flex flex-col gap-1 max-h-56 overflow-auto",
				children: [
					/* @__PURE__ */ X("p", { children: [
						xv(o),
						" · ",
						Sv(o)
					] }),
					/* @__PURE__ */ Y("p", { children: Cv(o) }),
					o.execution ? /* @__PURE__ */ X("p", { children: [
						"Process: ",
						o.execution.process_state.replaceAll("_", " "),
						".",
						" ",
						o.execution.output_complete ? "Output collection ended." : "Output collection pending."
					] }) : /* @__PURE__ */ Y("p", { children: "Current process status is unavailable. This entry has no restored live handle." }),
					o.execution?.output_error ? /* @__PURE__ */ X("p", {
						role: "status",
						children: ["Output collection error: ", o.execution.output_error]
					}) : null,
					o.command ? /* @__PURE__ */ X("div", {
						"aria-label": "Canonical command preview",
						children: [
							/* @__PURE__ */ Y("pre", {
								className: "whitespace-pre-wrap break-words",
								children: o.command.command
							}),
							o.command.stdout ? /* @__PURE__ */ Y("pre", {
								"aria-label": "Recorded stdout",
								className: "whitespace-pre-wrap break-words",
								children: o.command.stdout
							}) : null,
							o.command.stderr ? /* @__PURE__ */ Y("pre", {
								"aria-label": "Recorded stderr",
								className: "whitespace-pre-wrap break-words",
								children: o.command.stderr
							}) : null,
							o.command.diagnostic ? /* @__PURE__ */ Y("p", { children: o.command.diagnostic }) : null
						]
					}) : null,
					/* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						variant: H.Secondary,
						disabled: !wv(o),
						onClick: () => {
							let e = Tv(o);
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
function Dv({ state: e, controller: t, availability: n }) {
	let r = li(), i = e.phase === "sending", a = i || e.phase === "uncertain" || e.phase === "accepted", o = e.phase === "editing", s = e.choice.delivery === "steer" && e.choice.runId !== n.runId, c = e.phase === "reviewed" && !n.sourceUnavailable && (e.choice.delivery === "queue" || e.choice.delivery === "send" && n.mode === "idle" || e.choice.delivery === "steer" && n.mode === "busy" && !!n.runId && !s), l = e.choice.delivery === "queue" ? "Queue selection" : e.choice.delivery === "steer" ? "Steer selected run" : "Send selection";
	return /* @__PURE__ */ Y(tn, {
		open: e.phase !== "empty",
		title: "Review terminal selection",
		size: dn.Large,
		onClose: i ? void 0 : () => t.clear(),
		onNavigate: () => t.clear(),
		closeOnOverlay: !i,
		footer: /* @__PURE__ */ X("div", {
			className: "flex flex-wrap gap-2 justify-end",
			children: [
				/* @__PURE__ */ Y(I, {
					type: "button",
					variant: H.Ghost,
					disabled: i,
					onClick: () => t.clear(),
					children: e.phase === "uncertain" ? "Dismiss unconfirmed submission" : "Dismiss review"
				}),
				e.phase === "accepted" ? null : /* @__PURE__ */ Y(I, {
					type: "button",
					variant: H.Secondary,
					disabled: i,
					onClick: () => t.clear(),
					children: "Clear selection review"
				}),
				e.phase === "uncertain" ? /* @__PURE__ */ Y(I, {
					type: "button",
					onClick: () => void t.retry(),
					children: "Retry same submission"
				}) : e.phase === "accepted" ? null : /* @__PURE__ */ Y(I, {
					type: "button",
					disabled: !c,
					loading: i,
					onClick: () => void t.send(),
					children: i ? "Sending selection…" : l
				})
			]
		}),
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-4 text-sm",
			children: [
				/* @__PURE__ */ Y("p", { children: "Only this selected text and optional accompanying text will be shared as literal, untrusted evidence. Reviewing does not send anything to the agent." }),
				e.source ? /* @__PURE__ */ X("details", { children: [
					/* @__PURE__ */ Y("summary", { children: "Selection source" }),
					/* @__PURE__ */ X("p", {
						className: "break-all",
						children: ["Chat: ", e.source.sessionId]
					}),
					/* @__PURE__ */ X("p", {
						className: "break-all",
						children: ["Shell: ", e.source.terminalId]
					}),
					/* @__PURE__ */ X("p", { children: [
						"Client capture time: ",
						e.source.capturedAtMs,
						" ms"
					] })
				] }) : null,
				n.sourceAlive === !1 ? /* @__PURE__ */ Y("p", {
					role: "status",
					children: "The source shell has exited. This frozen selection can still be shared while its retained source remains available."
				}) : e.source && !e.source.sourceAlive ? /* @__PURE__ */ Y("p", {
					role: "status",
					children: "The shell’s running state was not confirmed at capture."
				}) : null,
				n.sourceUnavailable ? /* @__PURE__ */ Y("p", {
					role: "alert",
					children: "The source is currently unavailable. A new send is disabled; an unconfirmed submission can still be reconciled with its original identity."
				}) : null,
				e.error ? /* @__PURE__ */ Y("p", {
					role: "alert",
					children: e.error
				}) : null,
				e.phase === "uncertain" ? /* @__PURE__ */ Y("p", { children: "Dismissing or clearing this review does not cancel accepted work. Check history before sending a new copy." }) : null,
				e.phase === "previewing" ? /* @__PURE__ */ Y("p", {
					role: "status",
					children: "Preparing the server-normalized preview…"
				}) : null,
				e.preview ? /* @__PURE__ */ X("div", {
					className: "flex flex-col gap-2",
					children: [
						/* @__PURE__ */ Y("h3", { children: "Reviewed selected text" }),
						/* @__PURE__ */ Y("pre", {
							"aria-label": "Reviewed selected text",
							className: "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3",
							children: e.preview.text
						}),
						/* @__PURE__ */ X("p", { children: [
							e.preview.text_scalars.toLocaleString(),
							" characters ·",
							" ",
							e.preview.text_utf8_bytes.toLocaleString(),
							" UTF-8 bytes. No truncation."
						] })
					]
				}) : null,
				o ? /* @__PURE__ */ X("div", {
					className: "flex flex-col gap-2",
					children: [
						/* @__PURE__ */ Y("label", {
							htmlFor: `${r}-question`,
							children: "Accompanying literal text (optional)"
						}),
						/* @__PURE__ */ Y("textarea", {
							id: `${r}-question`,
							value: e.editorText,
							rows: 4,
							onChange: (e) => t.setUserText(e.target.value),
							className: "rounded bg-bg-elevation-level-1 p-3"
						}),
						/* @__PURE__ */ Y("p", { children: "Update the preview before sending. Limits apply separately to selected and accompanying text." }),
						/* @__PURE__ */ Y(I, {
							type: "button",
							variant: H.Secondary,
							onClick: () => void t.preview(),
							children: "Update preview"
						})
					]
				}) : !a && e.preview ? /* @__PURE__ */ Y(I, {
					type: "button",
					variant: H.Ghost,
					onClick: () => t.editUserText(),
					children: "Edit accompanying text"
				}) : null,
				!o && e.preview?.user_text != null ? /* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("h3", { children: "Reviewed accompanying text" }), /* @__PURE__ */ Y("pre", {
					"aria-label": "Reviewed accompanying text",
					className: "max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3",
					children: e.preview.user_text
				})] }) : null,
				e.phase === "error" && e.canPreview ? /* @__PURE__ */ Y(I, {
					type: "button",
					variant: H.Secondary,
					onClick: () => void t.preview(),
					children: "Retry preview"
				}) : null,
				/* @__PURE__ */ X("fieldset", {
					disabled: a,
					className: "flex flex-col gap-2",
					children: [
						/* @__PURE__ */ Y("legend", {
							className: "mb-2",
							children: "Delivery"
						}),
						/* @__PURE__ */ X("label", { children: [
							/* @__PURE__ */ Y("input", {
								type: "radio",
								name: `${r}-delivery`,
								checked: e.choice.delivery === "send",
								disabled: n.mode !== "idle",
								onChange: () => t.choose({ delivery: "send" })
							}),
							" ",
							"Send as a new turn (idle chat)"
						] }),
						/* @__PURE__ */ X("label", { children: [
							/* @__PURE__ */ Y("input", {
								type: "radio",
								name: `${r}-delivery`,
								checked: e.choice.delivery === "queue",
								onChange: () => t.choose({ delivery: "queue" })
							}),
							" ",
							"Queue after existing input"
						] }),
						/* @__PURE__ */ Y("p", { children: "When idle, queued evidence may start the next turn." }),
						/* @__PURE__ */ X("label", { children: [
							/* @__PURE__ */ Y("input", {
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
				s ? /* @__PURE__ */ Y("p", {
					role: "alert",
					children: "The selected run ended or changed. Choose Queue or explicitly choose the displayed run again; this selection will not be retargeted automatically."
				}) : null,
				e.phase === "reviewed" && e.choice.delivery === "send" && n.mode !== "idle" ? /* @__PURE__ */ Y("p", {
					role: "status",
					children: "The chat is busy or its state is unknown. Choose a delivery option before sending."
				}) : null,
				i ? /* @__PURE__ */ Y("p", {
					role: "status",
					children: "Admission is in progress. Leaving this view does not cancel accepted work."
				}) : null,
				e.receipt ? /* @__PURE__ */ X("p", {
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
var Ov = class extends Tt("SelectionFailure") {};
function kv(e) {
	let t = pt(on()), n = new AbortController(), r = !0;
	return pt(kt(t, N(() => {
		r = !1, n.abort();
	}))), {
		signal: n.signal,
		activationCurrent: e,
		current: () => r && e(),
		close: () => pt(We(t, Bt))
	};
}
function Av(e) {
	return Ve(function* () {
		yield* N(e.started), yield* dr({
			try: () => e.request(e.operation.signal),
			catch: (e) => new Ov({
				operation: "preview",
				cause: e
			})
		}).pipe(F({
			onSuccess: (t) => N(() => e.confirmed(t)),
			onFailure: (t) => N(() => e.failed(t))
		}));
	}).pipe(De(N(e.operation.close)));
}
function jv(e) {
	return Ve(function* () {
		yield* N(e.started), yield* dr({
			try: () => e.request(e.operation.signal),
			catch: (e) => new Ov({
				operation: "submit",
				cause: e
			})
		}).pipe(F({
			onSuccess: (t) => Ve(function* () {
				yield* N(e.accepted), yield* N(() => e.confirmed(t));
			}),
			onFailure: (t) => Ve(function* () {
				yield* N(e.unconfirmed), yield* N(() => e.failed(t));
			})
		}));
	}).pipe(De(N(e.operation.close)));
}
// src/app/features/terminal-selection/reviewController.ts
var Mv = Object.freeze({
	phase: "empty",
	editorText: "",
	choice: { delivery: "send" }
}), Nv = 32768, Pv = 8192;
function Fv(e) {
	let t = 0, n = e[Symbol.iterator]();
	for (; !n.next().done;) if (++t > Pv) return !1;
	return new TextEncoder().encode(e).byteLength <= Nv;
}
var Iv = class {
	ports;
	#e = Mv;
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
		e.sessionId !== this.ports.sessionId || !n.trim() || !Fv(n) ? this.#d({
			...Mv,
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
		].includes(this.#e.phase) && (Fv(e) ? (this.#f(), this.#r = e === "" ? void 0 : e, this.#d({
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
		let e = kv(this.ports.captureActivation());
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
		await ei(Av({
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
		await ei(jv({
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
		this.#f(), this.#t = void 0, this.#n = void 0, this.#r = void 0, this.#i = void 0, this.#d(Mv);
	}
	dispose() {
		this.#o || (this.clear(), this.#o = !0, this.#l.clear());
	}
};
// src/app/features/terminal-selection/useSelectionReview.ts
function Lv(e) {
	let t = n(), r = vi(), i = G(() => {
		let n = () => {
			r.invalidateQueries({ queryKey: Xt.sessionRoot(e) }), r.invalidateQueries({ queryKey: Xt.sessionsAll });
		};
		return new Iv({
			sessionId: e,
			api: t.api,
			captureActivation: () => t.stores.runtimeStore.captureRuntimeActivation(e),
			accepted: n,
			unconfirmed: n
		});
	}, [
		e,
		t,
		r
	]);
	return W(() => i.retain(), [i]), W(() => t.stores.runtimeStore.runtimeStore.subscribe(i.checkActivation), [t, i]), {
		controller: i,
		state: di(i.subscribe, i.getSnapshot, i.getSnapshot)
	};
}
// src/app/features/terminal-selection/TerminalWorkspace.tsx
function Rv({ sessionId: e }) {
	let { api: t } = n(), r = G(() => ({
		api: t,
		id: crypto.randomUUID()
	}), [t]);
	return /* @__PURE__ */ Y(zv, { sessionId: e }, `${r.id}:${e}`);
}
function zv({ sessionId: e }) {
	let { controller: t, state: r } = Lv(e), i = Mr(e, { enabled: !1 }), a = n().stores.runtimeStore.useRunning(e), o = i.data?.active_run?.run_id, s = i.data?.shell_commands?.some((e) => e.state === "accepted" || e.state === "started"), c = a || o || s ? "busy" : i.data && !i.isError ? "idle" : "unknown";
	return /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(hv, {
		sessionId: e,
		history: (t) => /* @__PURE__ */ Y(Ev, {
			sessionId: e,
			onReopen: t
		}),
		onReviewSelection: (e) => t.capture(e, { delivery: c === "idle" ? "send" : "queue" })
	}), r.source ? /* @__PURE__ */ Y(Bv, {
		state: r,
		controller: t,
		availability: {
			mode: c,
			runId: o
		}
	}, `${r.source.sessionId}:${r.source.terminalId}`) : null] });
}
function Bv({ state: e, controller: t, availability: n }) {
	let r = e.source, i = U_(r.sessionId, r.terminalId);
	return /* @__PURE__ */ Y(Dv, {
		state: e,
		controller: t,
		availability: {
			...n,
			sourceAlive: i.data?.alive,
			sourceUnavailable: i.isError
		}
	});
}
// src/app/components/inspector/CommitPopover.tsx
function Vv(e, t, n) {
	return t == null ? e ? "A run is in flight; wait for it to finish." : n === 0 ? "Nothing to commit: the checkout matches HEAD." : null : "A revision is open; go back to the working tree to commit.";
}
var Hv = (e, t) => `${e} ${t}${e === 1 ? "" : "s"}`;
function Uv({ sessionId: e, changed: t, revision: r }) {
	let { useRunning: i } = n().stores.runtimeStore, [a, o] = q(!1), [s, c] = q(""), l = Le(), u = i(e), d = Cn(), f = ge(e), p = Vv(u, r, t.length), m = t.reduce((e, t) => e + (t.additions ?? 0), 0), h = t.reduce((e, t) => e + (t.deletions ?? 0), 0), g = () => {
		o(!1), f.reset();
	}, _ = () => {
		let e = s.trim();
		!e || p || f.isPending || f.mutate({ message: e }, { onSuccess: (e) => {
			d.success(`Committed ${Hv(e.files_changed, "file")} as ${e.sha.slice(0, 7)}.`), c(""), g();
		} });
	};
	return /* @__PURE__ */ Y(Zr, {
		open: a,
		onClose: g,
		sticky: !0,
		placement: R.BottomRight,
		size: Gt.Medium,
		content: /* @__PURE__ */ X(J, { children: [
			/* @__PURE__ */ Y(el, {
				autoFocus: !0,
				rows: 3,
				textAreaSize: $c.Small,
				placeholder: "Commit message",
				value: s,
				onChange: (e) => c(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), _());
				}
			}),
			/* @__PURE__ */ X("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [
					/* @__PURE__ */ X("span", {
						className: "flex-1 min-w-0 truncate",
						children: ["Staging ", Hv(t.length, "file")]
					}),
					/* @__PURE__ */ X("span", {
						className: "code code-small text-success-primary",
						children: ["+", m]
					}),
					/* @__PURE__ */ X("span", {
						className: "code code-small text-error-primary",
						children: ["-", h]
					})
				]
			}),
			f.error ? /* @__PURE__ */ Y("div", {
				className: "p-1 label-micro text-error-primary",
				children: mr(f.error)
			}) : null,
			/* @__PURE__ */ Y(I, {
				size: z.Medium,
				variant: H.Secondary,
				disabled: !s.trim(),
				loading: f.isPending,
				onClick: _,
				children: "Commit"
			})
		] }),
		children: l ? /* @__PURE__ */ Y(gn, {
			className: "shrink-0",
			variant: H.Secondary,
			disabled: !!p,
			"aria-expanded": a,
			title: p ?? "Commit every change in the checkout",
			onClick: () => a ? g() : o(!0),
			children: "Commit"
		}) : /* @__PURE__ */ Y(I, {
			className: "max-w-[120px] shrink-0",
			size: z.Small,
			variant: H.Secondary,
			disabled: !!p,
			"aria-expanded": a,
			title: p ?? "Commit every change in the checkout",
			onClick: () => a ? g() : o(!0),
			children: "Commit"
		})
	});
}
// src/app/components/inspector/PanelSplit.tsx
function Wv({ list: e, listToolbar: t, listTitle: r, title: i, titleAction: a, actions: o, children: s }) {
	let { setPanelListWidth: c, usePanelListWidth: l } = n().stores.panelWidth, { useSidePanelList: u, toggleSidePanelList: d, showSidePanelList: f } = n().stores.sessionLayoutStore, p = l(), m = Le(), h = In(), g = u(), _ = K(null), [v, y] = q(0), b = K(!1), x = K(null);
	W(() => () => x.current?.(), []), W(() => {
		let e = _.current;
		if (!e) return;
		let t = () => y(e.clientWidth);
		t();
		let n = new ResizeObserver(t);
		return n.observe(e), () => n.disconnect();
	}, []);
	let S = v > 0 ? v * Be : p, C = A(p, S);
	return m ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-ground",
		children: s
	}), /* @__PURE__ */ X(tn, {
		open: g,
		onClose: () => f(!1),
		title: r,
		keepOnNavigate: !0,
		bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
		children: [/* @__PURE__ */ Y("div", {
			className: P("flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-2 gap-1 [&>*]:shrink-0", t && "pb-[80px]"),
			children: e
		}), t ? /* @__PURE__ */ Y("div", {
			className: "absolute inset-x-0 bottom-0 z-10 p-4 pointer-events-none [&>*]:pointer-events-auto",
			children: t
		}) : null]
	})] }) : h ? /* @__PURE__ */ X("div", {
		className: "flex flex-col flex-1 min-h-0 w-full",
		children: [g ? null : /* @__PURE__ */ X("div", {
			className: "flex items-center gap-[10px] h-12 px-2 shrink-0 border-b border-muted bg-elevation-ground",
			children: [
				/* @__PURE__ */ Y("span", {
					className: "min-w-0 truncate label-small text-basic-primary",
					children: i
				}),
				a,
				/* @__PURE__ */ Y("span", { className: "flex-1" }),
				o,
				/* @__PURE__ */ Y(I, {
					size: z.Medium,
					variant: H.Ghost,
					content: L.Icon,
					"aria-label": "Open list",
					"aria-expanded": !1,
					onClick: d,
					children: /* @__PURE__ */ Y(B, { iconName: V.List })
				})
			]
		}), g ? /* @__PURE__ */ X("div", {
			className: "flex flex-col flex-1 min-h-0 bg-elevation-ground",
			children: [t, /* @__PURE__ */ Y("div", {
				className: "flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-1 [&>*]:shrink-0",
				children: e
			})]
		}) : /* @__PURE__ */ Y("div", {
			className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-ground",
			children: s
		})]
	}) : /* @__PURE__ */ X("div", {
		ref: _,
		className: "flex flex-1 min-h-0 w-full",
		children: [/* @__PURE__ */ X("div", {
			className: "relative flex flex-col shrink-0 min-h-0 border-r border-muted bg-elevation-ground",
			style: { width: C },
			children: [
				t,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-h-0 overflow-auto pt-4 px-1 [&>*]:shrink-0",
					children: e
				}),
				/* @__PURE__ */ Y("div", {
					role: "separator",
					"aria-orientation": "vertical",
					"aria-label": "Resize list panel",
					"aria-valuemin": 180,
					"aria-valuemax": Math.round(S),
					"aria-valuenow": C,
					tabIndex: 0,
					className: "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none",
					onPointerDown: (e) => {
						if (e.button !== 0) return;
						let t = _.current;
						if (!t) return;
						e.preventDefault(), x.current?.(), b.current = !0, e.currentTarget.setPointerCapture(e.pointerId);
						let n = e.currentTarget, r = t.style.cursor, i = t.style.userSelect;
						t.style.cursor = "col-resize", t.style.userSelect = "none";
						let a = (n) => {
							if (!b.current || n.pointerId !== e.pointerId) return;
							let r = t.getBoundingClientRect(), i = n.clientX - r.left;
							c(A(i, r.width * Be));
						}, o = () => {
							b.current = !1, t.style.cursor = r, t.style.userSelect = i, window.removeEventListener("pointermove", a), window.removeEventListener("pointerup", o), window.removeEventListener("pointercancel", o);
							try {
								n.releasePointerCapture(e.pointerId);
							} catch {}
						};
						x.current = o, window.addEventListener("pointermove", a), window.addEventListener("pointerup", o), window.addEventListener("pointercancel", o);
					},
					onKeyDown: (e) => {
						let t = e.shiftKey ? 24 : 8;
						e.key === "ArrowLeft" ? (e.preventDefault(), c(A(C - t, S))) : e.key === "ArrowRight" && (e.preventDefault(), c(A(C + t, S)));
					}
				})
			]
		}), /* @__PURE__ */ Y("div", {
			className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-ground",
			children: s
		})]
	});
}
function Gv({ label: e, active: t = !1, disabled: n = !1, icon: r, trailing: i, labelClassName: a, title: o, onClick: s }) {
	let c = Le();
	return /* @__PURE__ */ X(Gl, {
		type: "button",
		size: c ? Hl.Large : Hl.Small,
		active: t,
		disabled: n,
		"aria-pressed": t,
		title: o,
		onClick: s,
		children: [
			r,
			/* @__PURE__ */ Y("span", {
				className: P("flex-1 min-w-0 truncate text-left", a),
				children: e
			}),
			i
		]
	});
}
function Kv({ listTitle: e }) {
	return /* @__PURE__ */ Y(Wv, {
		listTitle: e,
		list: /* @__PURE__ */ Y("div", {
			className: "px-1",
			children: /* @__PURE__ */ Y(Da, {
				rows: 2,
				rowClassName: "h-6"
			})
		}),
		children: /* @__PURE__ */ Y("div", {
			role: "status",
			"aria-label": `Loading ${e ?? "panel"}`,
			className: "flex flex-1 flex-col min-h-0 overflow-hidden p-4",
			children: /* @__PURE__ */ Y(Da, {
				rows: 3,
				rowClassName: "h-6"
			})
		})
	});
}
function qv({ title: e, children: t }) {
	return e === void 0 ? /* @__PURE__ */ Y("div", {
		className: "flex flex-1 flex-col min-h-0 overflow-auto p-6 label-small text-basic-muted [&>*]:shrink-0",
		children: t
	}) : /* @__PURE__ */ X("div", {
		className: "flex flex-1 flex-col min-h-0 overflow-auto p-4 code code-small [&>*]:shrink-0",
		children: [/* @__PURE__ */ Y("p", {
			className: "text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ Y("p", {
			className: "text-basic-muted",
			children: t
		})]
	});
}
// src/app/hooks/useLiveWorkspace.ts
var Jv = 3e3;
function Yv(e, t) {
	let { useWorkspaceEpoch: r } = n().stores.runtimeStore, i = vi(), a = r(), o = K(null), s = K(0);
	W(() => {
		if (t != null || a === 0 || o.current !== null) return;
		let n = Math.max(0, Jv - (Date.now() - s.current));
		o.current = window.setTimeout(() => {
			o.current = null, s.current = Date.now(), ue("query:invalidate.workspace", { throttleMs: 0 }), i.invalidateQueries({
				queryKey: Xt.sessionSnapshot(e),
				exact: !0
			}), i.invalidateQueries({ queryKey: Xt.workspaceFilesRoot(e) }), i.invalidateQueries({ queryKey: Xt.workspaceDiffRoot(e) }), i.invalidateQueries({ queryKey: Xt.workspaceFileRoot(e) });
		}, n);
	}, [
		i,
		a,
		t,
		e
	]), W(() => () => {
		o.current !== null && clearTimeout(o.current);
	}, []);
}
// src/app/lib/fileStatus.ts
var Xv = {
	M: "text-danger-primary",
	A: "text-info-primary",
	"?": "text-info-primary",
	R: "text-info-primary",
	C: "text-info-primary",
	D: "text-error-primary",
	U: "text-error-primary"
}, Zv = (e) => e ? Xv[e.trim()[0]] ?? "text-basic-primary" : null, Qv = (e) => P(Zv(e), e?.trim()[0] === "D" && "line-through") || void 0, $v = (e) => e.endsWith("/");
function ey(e) {
	let t = e.replace(/\/+$/, ""), n = t.split("/").pop() || t;
	return $v(e) ? `${n}/` : n;
}
var ty = (e, t) => ({
	name: e,
	path: t,
	dirs: /* @__PURE__ */ new Map(),
	files: []
}), ny = (e, t) => e.name.localeCompare(t.name);
function ry(e) {
	let t = e, n = e.name;
	for (; t.files.length === 0 && t.dirs.size === 1;) {
		let [e] = t.dirs.values();
		n = `${n}/${e.name}`, t = e;
	}
	let r = [...t.dirs.values()].map(ry).sort(ny), i = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: n,
		path: t.path,
		dirs: r,
		files: i,
		hasChanges: i.some((e) => e.status) || r.some((e) => e.hasChanges)
	};
}
function iy(e) {
	let t = ty("", "");
	for (let n of e) {
		let e = n.path.replace(/\/+$/, "").split("/");
		e.pop();
		let r = t, i = "";
		for (let t of e) {
			i = i ? `${i}/${t}` : t;
			let e = r.dirs.get(t);
			e || (e = ty(t, i), r.dirs.set(t, e)), r = e;
		}
		r.files.push(n);
	}
	let n = [...t.dirs.values()].map(ry).sort(ny), r = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: "",
		path: "",
		dirs: n,
		files: r,
		hasChanges: r.some((e) => e.status) || n.some((e) => e.hasChanges)
	};
}
function ay(e, t = []) {
	for (let n of e.dirs) n.hasChanges && (t.push(n.path), ay(n, t));
	return t;
}
// src/app/components/inspector/FilesView.tsx
function oy({ open: e }) {
	return /* @__PURE__ */ Y(B, {
		iconName: V.Right,
		size: 16,
		className: P("shrink-0 transition-transform", e && "rotate-90")
	});
}
function sy({ dir: e, depth: t, open: n, selected: r, onToggle: i, onSelect: a }) {
	let o = Le();
	return /* @__PURE__ */ X("div", {
		className: P("flex flex-col gap-[2px]", t > 0 && "pl-1 ml-[3px] border-l border-muted"),
		children: [e.dirs.map((e) => {
			let o = n.has(e.path);
			return /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-[2px] w-full",
				children: [/* @__PURE__ */ Y(Gv, {
					label: e.name,
					icon: /* @__PURE__ */ Y(oy, { open: o }),
					labelClassName: e.hasChanges ? "text-danger-primary" : void 0,
					onClick: () => i(e.path)
				}), o ? /* @__PURE__ */ Y(sy, {
					dir: e,
					depth: t + 1,
					open: n,
					selected: r,
					onToggle: i,
					onSelect: a
				}) : null]
			}, e.path);
		}), e.files.map((e) => /* @__PURE__ */ Y(Gv, {
			label: ey(e.path),
			active: r === e.path,
			title: e.path,
			labelClassName: Qv(e.status),
			icon: /* @__PURE__ */ Y(Nc, {
				path: e.path,
				size: o ? 24 : 16
			}),
			onClick: () => a(e.path)
		}, e.path))]
	});
}
function cy({ files: e, selected: t, onSelect: n }) {
	let r = Le();
	return e.length === 0 ? /* @__PURE__ */ Y("div", {
		className: "p-1 label-micro text-basic-muted",
		children: "Nothing has changed here yet."
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-[2px]",
		children: e.map((e) => /* @__PURE__ */ Y(Gv, {
			label: ey(e.path),
			active: t === e.path,
			title: e.path,
			labelClassName: Qv(e.status),
			icon: /* @__PURE__ */ Y(Nc, {
				path: e.path,
				size: r ? 24 : 16
			}),
			onClick: () => n(e.path)
		}, e.path))
	});
}
function ly({ iconName: e, label: t, active: n, round: r = !1, onClick: i }) {
	return /* @__PURE__ */ Y(I, {
		className: r ? "btn-round" : void 0,
		size: r ? z.Medium : z.Small,
		variant: n ? H.Primary : H.Ghost,
		content: L.Icon,
		"aria-pressed": n,
		"aria-label": t,
		title: t,
		onClick: i,
		children: /* @__PURE__ */ Y(B, { iconName: e })
	});
}
function uy({ sessionId: e, listing: t, changed: r, revision: i, readOnly: a }) {
	let { selectFileListing: o } = n().stores.sessionLayoutStore, s = Le(), c = /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(ly, {
		iconName: V.Folders,
		label: "Show every file",
		active: t === "tree",
		round: s,
		onClick: () => o("tree")
	}), /* @__PURE__ */ Y(ly, {
		iconName: V.Scheme,
		label: "Show changed files only",
		active: t === "changed",
		round: s,
		onClick: () => o("changed")
	})] }), l = a ? null : /* @__PURE__ */ Y(Uv, {
		sessionId: e,
		changed: r,
		revision: i
	});
	return s ? /* @__PURE__ */ X("div", {
		className: "flex items-center justify-between gap-2",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center gap-4 p-1 rounded-full bg-elevation-level-3 shadow-2xl",
			children: c
		}), l]
	}) : /* @__PURE__ */ X("div", {
		className: "flex items-center gap-3 h-12 px-3 shrink-0 border-b border-muted @max-[560px]:gap-2 @max-[560px]:px-2",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 flex-1",
			children: c
		}), l]
	});
}
function dy({ lineNo: e, content: t, tokens: n, tone: r, trailing: i }) {
	return /* @__PURE__ */ X("div", {
		className: P("flex items-start w-full border-l-2 border-solid", r === "add" ? "bg-success-primary border-success-primary" : r === "delete" ? "bg-error-primary border-error-primary" : "border-transparent"),
		children: [/* @__PURE__ */ Y("span", {
			className: "shrink-0 w-12 pr-1 text-right opacity-50 code code-small text-basic-muted select-none",
			children: e ?? ""
		}), /* @__PURE__ */ X("span", {
			className: "flex-1 min-w-0 px-2 code code-small text-basic-primary whitespace-pre-wrap break-words",
			children: [n ? n.map((e, t) => /* @__PURE__ */ Y("span", {
				style: xn(e),
				children: e.text
			}, t)) : t, i]
		})]
	});
}
function fy({ line: e, tokens: t }) {
	let n = e.kind === "delete", r = n ? e.old_lineno : e.new_lineno ?? e.old_lineno;
	return /* @__PURE__ */ Y(dy, {
		lineNo: r,
		content: e.content,
		tokens: t,
		tone: e.kind === "insert" ? "add" : n ? "delete" : void 0,
		trailing: e.has_trailing_newline === !1 ? /* @__PURE__ */ Y("span", {
			className: "italic text-basic-muted",
			children: " No newline at end of file"
		}) : null
	});
}
function py({ tone: e, children: t }) {
	return /* @__PURE__ */ Y("div", {
		className: P("mx-4 my-2 rounded-md px-3 py-2 code code-small", e === "error" ? "text-error-primary bg-error-tertiary border border-error-muted" : "text-basic-muted bg-elevation-level-0-5"),
		children: t
	});
}
function my({ section: e, highlighted: t }) {
	return e.error ? /* @__PURE__ */ X(py, {
		tone: "error",
		children: ["Error: ", e.error]
	}) : e.binary ? /* @__PURE__ */ Y(py, { children: "Binary or non-UTF-8 content; inline hunks are unavailable." }) : e.too_large ? /* @__PURE__ */ Y(py, { children: "File is too large for inline diff rendering." }) : e.hunks.length === 0 ? /* @__PURE__ */ Y(py, { children: "No hunks for this section." }) : /* @__PURE__ */ X("div", {
		className: "pb-[128px] md:pb-0",
		children: [e.hunks.map((e, n) => /* @__PURE__ */ X("div", {
			className: "flex flex-col w-full",
			children: [/* @__PURE__ */ X("div", {
				className: "flex items-start w-full border-l-2 border-transparent bg-info-tertiary",
				children: [/* @__PURE__ */ Y("span", {
					className: "shrink-0 w-12 pr-1 text-right opacity-50 code code-small text-basic-muted select-none",
					children: "@@"
				}), /* @__PURE__ */ X("span", {
					className: "flex-1 min-w-0 px-2 code code-small text-info-primary truncate",
					children: [`-${e.old_start},${e.old_lines} +${e.new_start},${e.new_lines}`, e.function_context ? ` ${e.function_context}` : ""]
				})]
			}), e.lines.map((e, n) => /* @__PURE__ */ Y(fy, {
				line: e,
				tokens: t.get(e)
			}, n))]
		}, n)), e.truncated ? /* @__PURE__ */ Y(py, { children: "Diff was truncated by the backend." }) : null]
	});
}
function hy({ path: e, trailing: t }) {
	return S() ? /* @__PURE__ */ X("div", {
		className: "flex items-center gap-2 h-10 px-4 shrink-0 border-b border-muted bg-elevation-ground",
		title: e,
		children: [/* @__PURE__ */ X("div", {
			className: "flex flex-1 items-center gap-[6px] min-w-0",
			children: [/* @__PURE__ */ Y(Nc, { path: e }), /* @__PURE__ */ Y("span", {
				className: "label-micro text-btn-secondary truncate",
				children: ey(e)
			})]
		}), /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 shrink-0 code code-small",
			children: t
		})]
	}) : null;
}
function gy({ children: e }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-h-0 overflow-auto py-2 [&>*]:shrink-0",
		children: e
	});
}
function _y({ sessionId: e, file: t, revision: n }) {
	let { data: r, isFetching: i, error: a } = fe(e, t.path, "all", 3, n), o = G(() => t.additions != null || t.deletions != null ? {
		additions: t.additions ?? 0,
		deletions: t.deletions ?? 0
	} : r ? r.sections.reduce((e, t) => ({
		additions: e.additions + t.additions,
		deletions: e.deletions + t.deletions
	}), {
		additions: 0,
		deletions: 0
	}) : null, [t, r]);
	return /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(hy, {
		path: t.path,
		trailing: o ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ X("span", {
			className: "text-success-primary",
			children: ["+", o.additions]
		}), /* @__PURE__ */ X("span", {
			className: "text-error-primary",
			children: ["-", o.deletions]
		})] }) : null
	}), /* @__PURE__ */ X(gy, { children: [
		i && !r ? /* @__PURE__ */ X("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ Y(f, { size: mt.Small }), " Loading diff…"]
		}) : null,
		a ? /* @__PURE__ */ Y(py, {
			tone: "error",
			children: mr(a)
		}) : null,
		r ? /* @__PURE__ */ Y(vy, { diff: r }) : null
	] })] });
}
function vy({ diff: e }) {
	let [t, n] = q(() => /* @__PURE__ */ new Map());
	return W(() => {
		let t = !0;
		return Kn(e.path, e.sections).then((e) => {
			t && n(e);
		}), () => {
			t = !1;
		};
	}, [e]), e.error ? /* @__PURE__ */ Y(py, {
		tone: "error",
		children: e.error
	}) : e.sections.length === 0 ? /* @__PURE__ */ Y(py, { children: "No diff sections returned." }) : /* @__PURE__ */ Y(J, { children: e.sections.map((e, n) => /* @__PURE__ */ Y(my, {
		section: e,
		highlighted: t
	}, n)) });
}
var yy = (e) => e < 1024 ? `${e} B` : `${Math.round(e / 1024)} KB`;
function by({ sessionId: e, path: t, revision: n }) {
	let { data: r, isFetching: i, error: a } = wt(e, t, n), [o, s] = q(null), c = r?.content?.replace(/\n$/, "") ?? null, l = G(() => c?.split("\n") ?? null, [c]);
	W(() => {
		if (c === null) return;
		let e = !0;
		return sr(t, c).then((t) => {
			e && t && s({
				text: c,
				lines: t
			});
		}), () => {
			e = !1;
		};
	}, [t, c]);
	let u = o?.text === c ? o.lines : null;
	return /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(hy, {
		path: t,
		trailing: r ? /* @__PURE__ */ Y("span", {
			className: "text-basic-muted",
			children: yy(r.size)
		}) : null
	}), /* @__PURE__ */ X(gy, { children: [
		i && !r ? /* @__PURE__ */ X("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ Y(f, { size: mt.Small }), " Loading file…"]
		}) : null,
		a ? /* @__PURE__ */ Y(py, {
			tone: "error",
			children: mr(a)
		}) : null,
		r?.binary ? /* @__PURE__ */ Y(py, { children: "Binary file; nothing to show inline." }) : null,
		r?.too_large ? /* @__PURE__ */ X(py, { children: [
			"File is too large to display (",
			yy(r.size),
			")."
		] }) : null,
		l ? l.map((e, t) => /* @__PURE__ */ Y(dy, {
			lineNo: t + 1,
			content: e,
			tokens: u?.[t]
		}, t)) : null
	] })] });
}
function xy({ sessionId: e, snapshot: t, revision: r = null, readOnly: i = !1 }) {
	let { useToggledFolders: a, useSelectedFile: o, useFileListing: s, toggleFolder: c, selectFile: l } = n().stores.sessionLayoutStore, u = vi(), d = o(), f = a(), p = s(), { data: m, error: h } = bt(e, r), g = Ot(e, r);
	W(() => {
		r ?? u.invalidateQueries({ queryKey: Xt.sessionSnapshot(e) });
	}, [
		u,
		e,
		r
	]), Yv(e, r);
	let _ = t?.workspace ?? null, v = G(() => r == null ? _?.changed_files ?? [] : g.data?.changed_files ?? [], [
		r,
		_,
		g.data
	]), y = G(() => Sy(m?.files ?? [], v), [m, v]), b = G(() => iy(y), [y]), x = G(() => y.filter((e) => e.status !== null), [y]), S = G(() => {
		let e = new Set(ay(b));
		for (let t of f) e.delete(t) || e.add(t);
		return e;
	}, [b, f]), C = G(() => new Map(x.map((e) => [e.path, e])), [x]), w = d ?? x[0]?.path ?? null, T = w ? C.get(w) : void 0, E = h ?? (r == null ? null : g.error);
	return r == null && _?.error ? /* @__PURE__ */ Y("div", {
		className: "p-6 label-small text-error-primary",
		children: _.error
	}) : E ? /* @__PURE__ */ Y("div", {
		className: "p-6 label-small text-error-primary",
		children: mr(E)
	}) : m ? /* @__PURE__ */ Y(Wv, {
		listTitle: "Files",
		title: w?.split("/").pop(),
		actions: T && (T.additions || T.deletions) ? /* @__PURE__ */ X("div", {
			className: "flex items-center gap-2 shrink-0 code code-small",
			children: [/* @__PURE__ */ X("span", {
				className: "text-success-primary",
				children: ["+", T.additions ?? 0]
			}), /* @__PURE__ */ X("span", {
				className: "text-error-primary",
				children: ["-", T.deletions ?? 0]
			})]
		}) : null,
		listToolbar: /* @__PURE__ */ Y(uy, {
			sessionId: e,
			listing: p,
			changed: v,
			revision: r,
			readOnly: i
		}),
		list: y.length === 0 ? /* @__PURE__ */ Y("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "No files in the workspace."
		}) : p === "changed" ? /* @__PURE__ */ Y(cy, {
			files: x,
			selected: w,
			onSelect: l
		}) : /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(sy, {
			dir: b,
			depth: 0,
			open: S,
			selected: w,
			onToggle: c,
			onSelect: l
		}), m.truncated ? /* @__PURE__ */ Y("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "Listing truncated."
		}) : null] }),
		children: w ? T ? /* @__PURE__ */ Y(_y, {
			sessionId: e,
			file: T,
			revision: r
		}, w) : /* @__PURE__ */ Y(by, {
			sessionId: e,
			path: w,
			revision: r
		}, w) : /* @__PURE__ */ Y(qv, { children: y.length === 0 ? "No files in the workspace." : "Select a file to see it." })
	}) : /* @__PURE__ */ Y(Kv, { listTitle: "Files" });
}
function Sy(e, t) {
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
// src/app/lib/markdownChunk.ts
var Cy = null, wy = !1;
function Ty() {
	return Cy ??= import("./chunks/markdown-renderer-HfQvUUbF.js").then((e) => e.t).then((e) => (wy = !0, e)), Cy;
}
function Ey() {
	return wy;
}
// src/app/lib/markdown.tsx
var Dy = oi(Ty);
function Oy({ children: e, streaming: t = !1, className: n }) {
	return /* @__PURE__ */ Y("div", {
		className: P("chat-response markdown markdown-content text-basic-primary w-full", t && "streaming", n),
		children: /* @__PURE__ */ Y(ii, {
			fallback: /* @__PURE__ */ Y("pre", {
				className: "whitespace-pre-wrap font-sans",
				children: e
			}),
			children: /* @__PURE__ */ Y(Dy, {
				streaming: t,
				children: e
			})
		})
	});
}
// src/app/components/inspector/ChatBadge.tsx
var ky = 240;
function Ay({ label: e, pending: t = !1, active: n = !1, trailing: r, preface: i, body: a, onClick: o }) {
	Se("ChatBadge");
	let [s, c] = q(!1), l = !!a, u = l || !!o, d = s || n;
	return /* @__PURE__ */ X("div", {
		className: P("flex flex-col items-start w-full my-6 border-l-2 border-solid transition-colors duration-150", d ? "border-primary" : "border-tertiary"),
		children: [
			i,
			/* @__PURE__ */ X("button", {
				type: "button",
				className: P("group flex items-center py-2 rounded-[4px] max-w-full", l ? "gap-[6px] pl-4 pr-2" : "gap-4 px-4", u ? d ? "btn-ghost-highlighted" : "btn-ghost" : "cursor-default"),
				disabled: !u,
				"aria-expanded": l ? s : void 0,
				"aria-pressed": n || void 0,
				onClick: () => {
					l && c((e) => !e), o?.();
				},
				children: [
					/* @__PURE__ */ Y("span", {
						className: P("label-small truncate", t ? "text-shimmer-basic" : "text-btn-secondary"),
						children: e
					}),
					r,
					l ? /* @__PURE__ */ Y(B, {
						iconName: s ? V.Down : V.Right,
						size: 20,
						className: P("shrink-0", s ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100")
					}) : null
				]
			}),
			l && a ? /* @__PURE__ */ Y(oo, {
				isOpen: s,
				className: "w-full",
				isScrollable: t,
				scrollToBottom: t,
				style: t ? { maxHeight: ky } : void 0,
				children: /* @__PURE__ */ Y("div", {
					className: "thinking-content w-full pl-4 py-3",
					children: /* @__PURE__ */ Y(Oy, {
						className: "text-basic-tertiary",
						streaming: t,
						children: a
					})
				})
			}) : null
		]
	});
}
function jy({ additions: e, deletions: t }) {
	return /* @__PURE__ */ X("span", {
		className: "flex items-center gap-2 shrink-0 code code-small",
		children: [/* @__PURE__ */ X("span", {
			className: "text-success-primary",
			children: ["+", e]
		}), /* @__PURE__ */ X("span", {
			className: "text-error-primary",
			children: ["-", t]
		})]
	});
}
// src/app/components/inspector/SnapshotFiles.tsx
var My = 8;
function Ny({ file: e, active: t, onOpen: n }) {
	return /* @__PURE__ */ X("button", {
		type: "button",
		className: P("flex items-center gap-[6px] max-w-full py-2 md:py-1 px-2 rounded-[4px] shrink-0", t ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": t,
		title: e.path,
		onClick: () => n(e.path),
		children: [
			/* @__PURE__ */ Y(Nc, { path: e.path }),
			/* @__PURE__ */ Y("span", {
				className: "text-micro truncate",
				children: ey(e.path)
			}),
			e.additions != null || e.deletions != null ? /* @__PURE__ */ X("span", {
				className: "flex items-center gap-1 shrink-0 code code-micro",
				children: [/* @__PURE__ */ X("span", {
					className: "text-success-primary",
					children: ["+", e.additions ?? 0]
				}), /* @__PURE__ */ X("span", {
					className: "text-error-primary",
					children: ["-", e.deletions ?? 0]
				})]
			}) : null
		]
	});
}
function Py({ files: e, selected: t, onOpen: n, onOpenAll: r }) {
	if (!e.length) return null;
	let i = e.slice(0, My), a = e.length - i.length;
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-1 md:gap-0 w-full pl-2 pr-4 pb-1 items-start",
		children: [i.map((e) => /* @__PURE__ */ Y(Ny, {
			file: e,
			active: t === e.path,
			onOpen: n
		}, e.path)), a > 0 ? /* @__PURE__ */ Y("button", {
			type: "button",
			className: "btn-ghost flex items-center shrink-0 py-1 px-2 rounded-[4px] label-micro text-basic-muted shrink-0",
			onClick: r,
			children: `+${a} more`
		}) : null]
	});
}
// src/app/components/inspector/SnapshotBadge.tsx
function Fy({ revision: e, panel: t }) {
	let { data: n } = Ot(t.sessionId, e.id), r = G(() => (n?.changed_files ?? []).filter((e) => !e.path.endsWith("/")), [n]), i = t.selectedRevision === e.id;
	return /* @__PURE__ */ Y(Ay, {
		label: "Snapshot",
		trailing: /* @__PURE__ */ Y(jy, {
			additions: e.additions,
			deletions: e.deletions
		}),
		preface: /* @__PURE__ */ Y(Py, {
			files: r,
			selected: i ? t.selectedFile : null,
			onOpen: (n) => t.onOpenFile(e.id, n),
			onOpenAll: () => t.onOpenPanel(e.id)
		}),
		active: i,
		onClick: () => t.onOpenPanel(e.id)
	});
}
// src/app/components/inspector/ThreadLogTail.tsx
var Iy = 16, Ly = 150;
function Ry(e) {
	switch (e) {
		case 0: return "";
		case 1: return "opacity-50";
		case 2: return "opacity-10";
		default: return "opacity-0";
	}
}
function zy(e) {
	let t = K(null), n = K(e);
	return ui(() => {
		let r = t.current;
		r && e !== n.current && (n.current = e, e && (r.style.transition = "none", r.style.transform = `translateY(${Iy}px)`, r.offsetHeight, r.style.transition = `transform ${Ly}ms ease-out`, r.style.transform = "translateY(0)"));
	}, [e]), t;
}
function By({ lines: e, className: t }) {
	let n = e.slice(-4), r = zy(n[n.length - 1]?.key);
	return /* @__PURE__ */ Y("div", {
		className: P("flex flex-col justify-end overflow-hidden", t),
		children: /* @__PURE__ */ Y("div", {
			ref: r,
			className: "flex flex-col",
			children: n.map((e, t) => /* @__PURE__ */ Y("span", {
				className: P("w-full truncate code code-micro !text-[11px] !leading-[16px] !m-0 block", "transition-opacity duration-150 ease-out", "text-basic-tertiary", Ry(n.length - 1 - t)),
				children: e.isError && e.mark ? /* @__PURE__ */ X(J, { children: [
					/* @__PURE__ */ Y("span", {
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
// src/app/components/inspector/ThreadWave.tsx
var Vy = {
	error: 0,
	running: 1,
	pending: 2,
	cancelled: 3,
	done: 4
};
function Hy({ state: e }) {
	return e === "running" ? /* @__PURE__ */ Y(f, {
		size: mt.Small,
		variant: se.Neutral
	}) : e === "pending" ? /* @__PURE__ */ Y(B, {
		iconName: V.Timelaps,
		size: 20,
		className: "[&>path]:!fill-basic-muted"
	}) : e === "error" ? /* @__PURE__ */ Y(B, {
		iconName: V.Danger,
		size: 20,
		className: "[&>path]:!fill-error-primary"
	}) : e === "cancelled" ? /* @__PURE__ */ Y(B, {
		iconName: V.Close,
		size: 20,
		className: "[&>path]:!fill-basic-muted"
	}) : /* @__PURE__ */ Y(B, {
		iconName: V.CheckCircle,
		size: 20,
		className: "[&>path]:!fill-basic-primary"
	});
}
function Uy(e) {
	return e.reduce((e, t) => Vy[t.state] < Vy[e] ? t.state : e, "done");
}
function Wy({ thread: e, selected: t, onSelect: n }) {
	let r = Le(), i = e.state === "running", a = e.state === "pending", o = e.state === "cancelled", s = e.log.length ? e.log : [{
		key: "action",
		text: e.action,
		bare: e.action,
		mark: null,
		name: null,
		body: e.action,
		isError: !1
	}];
	return /* @__PURE__ */ Y("div", {
		className: P("shrink-0 h-[84px] max-w-full overflow-hidden rounded-[4px]", r ? "w-[172px]" : "w-[220px]", "bg-elevation-ground"),
		children: /* @__PURE__ */ X("button", {
			type: "button",
			className: P("flex flex-col items-start w-full h-full text-left", t ? "btn-ghost-highlighted" : "btn-ghost"),
			"aria-pressed": t,
			onClick: () => n(e.name, e.key),
			children: [/* @__PURE__ */ X("div", {
				className: "flex items-center gap-2 shrink-0 p-2 w-full",
				children: [
					/* @__PURE__ */ Y(Hy, { state: e.state }),
					/* @__PURE__ */ Y("span", {
						className: P("flex-1 min-w-0 truncate label-small", i ? "text-shimmer-basic" : a ? "text-basic-muted" : e.state === "error" ? "text-error-primary" : "text-basic-primary"),
						children: e.name
					}),
					e.weight && /* @__PURE__ */ Y("span", {
						className: "shrink-0 rounded-[3px] bg-elevation-level-3 px-1 text-[9px] uppercase tracking-wide text-basic-muted",
						children: e.weight
					})
				]
			}), i || o ? /* @__PURE__ */ Y(By, {
				lines: s,
				className: "flex-1 min-h-0 w-full px-2 pb-2"
			}) : /* @__PURE__ */ Y("div", {
				className: "w-full px-2 pt-2",
				children: /* @__PURE__ */ Y("span", {
					className: "line-clamp-2 text-micro text-basic-muted !my-0 !text-[11px]",
					children: a ? "Pending..." : e.summary
				})
			})]
		})
	});
}
function Gy({ threads: e, selected: t, onSelect: n }) {
	let r = Uy(e);
	return /* @__PURE__ */ Y("div", {
		className: P("pl-4 py-3 w-full min-w-0 border-l-2 border-solid", r === "error" ? "border-error-primary" : r === "running" ? "border-primary" : "border-tertiary"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-wrap items-start gap-1 w-full min-w-0",
			children: e.map((e) => /* @__PURE__ */ Y(Wy, {
				thread: e,
				selected: t === e.key,
				onSelect: n
			}, e.key))
		})
	});
}
function Ky({ rows: e, selected: t, onSelect: n }) {
	return /* @__PURE__ */ Y("div", {
		className: "my-8 w-full flex flex-col items-start",
		children: e.map((e, r) => /* @__PURE__ */ Y(Gy, {
			threads: e,
			selected: t,
			onSelect: n
		}, e.map((e) => e.key).join("|") || `row-${r}`))
	});
}
// src/app/components/inspector/ToolCallDetail.tsx
var qy = {
	pending: "○",
	running: "▸",
	"awaiting-approval": "◇",
	success: "✓",
	error: "✕",
	"timed-out": "◷",
	cancelled: "■",
	interrupted: "!"
}, Jy = si(function({ tool: e }) {
	let t = e.status === "pending" || e.status === "running", n = e.status === "awaiting-approval";
	return /* @__PURE__ */ X("div", {
		className: "my-3 w-full max-w-full min-w-0 rounded-[6px] border border-tertiary px-3 py-2",
		"data-tool-call-id": e.callId,
		children: [/* @__PURE__ */ X("div", {
			className: "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1",
			children: [
				/* @__PURE__ */ Y("span", {
					"aria-hidden": "true",
					className: P("code code-small shrink-0", n ? "text-accent-primary" : t ? "text-shimmer-basic" : e.status === "success" ? "text-success-primary" : "text-error-primary"),
					children: qy[e.status]
				}),
				/* @__PURE__ */ Y("span", {
					className: "label-small break-words text-basic-primary",
					children: e.label
				}),
				e.summary ? /* @__PURE__ */ Y("span", {
					className: "code code-small min-w-0 break-all text-basic-tertiary",
					children: e.summary
				}) : null,
				/* @__PURE__ */ Y("span", {
					"aria-label": `${e.label} status: ${e.statusLabel}`,
					className: P("label-micro shrink-0", n ? "text-accent-primary" : t ? "text-basic-secondary" : "text-basic-muted"),
					children: e.statusLabel
				})
			]
		}), e.resultPreview ? /* @__PURE__ */ Y("p", {
			className: "code code-small mt-1 min-w-0 break-all pl-5 text-basic-tertiary",
			children: e.resultPreview
		}) : null]
	});
}), Yy = "parameter|tool_use|tool_call|tool_name|invoke|arguments|parameters|function", Xy = RegExp(`<(${Yy})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), Zy = RegExp(`<\\/?(?:${Yy})\\b[^>]*>`, "gi");
function Qy(e) {
	if (!e.includes("<")) return e;
	let t = e, n = "";
	for (; t !== n;) n = t, Xy.lastIndex = 0, t = t.replace(Xy, "");
	return Zy.lastIndex = 0, t = t.replace(Zy, ""), t;
}
// src/app/lib/toolPresentation.ts
function $y(e) {
	return typeof e == "string" ? {
		text: e,
		hasImage: !1
	} : {
		text: e.map((e) => e.type === "text" ? e.text : `[Image: ${e.image.mime_type}]`).join("\n\n"),
		hasImage: e.some((e) => e.type === "image")
	};
}
function eb(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role === "tool") n.set(t.tool_call_id, $y(t.content));
		else if (t.role === "assistant" || t.role === "user") break;
	}
	return n;
}
function tb(e, t, n) {
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role !== "tool") return t.role === "assistant" && typeof t.content == "string" && t.content.trim() === n;
	}
	return !1;
}
var nb = {
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
}, rb = {
	pending: "Pending",
	running: "Running",
	"awaiting-approval": "Awaiting approval",
	success: "Succeeded",
	error: "Failed",
	"timed-out": "Timed out",
	cancelled: "Cancelled",
	interrupted: "Interrupted"
}, ib = "[tool call cancelled by user]", ab = "Tool execution was interrupted; no result was recorded.", ob = 160, sb = 180;
function cb(e, t) {
	let n = [...e ?? ""].map((e) => {
		let t = e.codePointAt(0) ?? 0;
		return t < 32 || t === 127 ? " " : e;
	}).join("").trim();
	return [...n].length <= t ? n : `${[...n].slice(0, t - 1).join("")}…`;
}
function lb(e) {
	let t = e.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	return t ? t[0].toUpperCase() + t.slice(1) : "Tool call";
}
function ub(e) {
	return nb[e] || (e.startsWith("mcp__") ? `MCP · ${lb(e.split("__").filter(Boolean).at(-1) ?? "tool")}` : lb(e || "tool call"));
}
function db(e) {
	return e.completion_status === "timed_out" ? "timed-out" : e.completion_status === "cancelled" ? "cancelled" : e.completion_status === "error" ? "error" : e.completion_status === "success" ? "success" : e.command_status === "timed_out" ? "timed-out" : e.command_status === "cancelled" ? "cancelled" : e.command_status === "spawn_error" || e.is_error || e.exit_code != null && e.exit_code !== 0 ? "error" : "success";
}
function fb(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		if (n.type !== "tool_call_started" && n.type !== "tool_call_finished" || n.thread_name) continue;
		let e = t.get(n.call_id) ?? {};
		n.type === "tool_call_started" ? e.started = n : e.finished = n, t.set(n.call_id, e);
	}
	return t;
}
function pb({ call: e, events: t, hasResult: n, resultText: r, resultHasImage: i, active: a, awaitingApproval: o, turnCancelled: s }) {
	let c = cb(t?.started?.name ?? t?.finished?.name ?? e.function?.name ?? "tool", ob) || "tool", l;
	l = t?.finished ? db(t.finished) : r?.startsWith(ib) || s && !n ? "cancelled" : r?.trim() === ab ? "interrupted" : n ? "success" : a && o ? "awaiting-approval" : a && t?.started ? "running" : a ? "pending" : "interrupted";
	let u = cb(t?.finished?.content_preview, sb) || null;
	return !u && i && (u = "Image result"), !u && l === "cancelled" && (u = "No result was retained."), !u && l === "interrupted" && (u = "No result was recorded."), {
		callId: e.id,
		name: c,
		label: ub(c),
		summary: cb(t?.started?.key_arg_preview, sb) || null,
		resultPreview: u,
		status: l,
		statusLabel: rb[l]
	};
}
// src/app/lib/transcript.ts
var mb = "[run cancelled by user]", hb = "[run failed after this partial assistant response]";
function gb(e) {
	let t = e.trim();
	if (t === "[run failed after this partial assistant response]") return "";
	let n = `\n\n${hb}`;
	return t.endsWith(n) ? t.slice(0, -n.length).trimEnd() : t;
}
var _b = "[tool call cancelled by user]", vb = /* @__PURE__ */ new Set([
	"threads",
	"thread_read",
	"workset_read",
	"workset_list"
]), yb = "model-streaming";
function bb(e) {
	try {
		let t = JSON.parse(e.function?.arguments || "{}");
		return Object(t) === t ? t : {};
	} catch {
		return {};
	}
}
function xb(e) {
	return u(e) ? e : "";
}
function Sb(e, t, n, r, i) {
	if (n.has(e) || i.liveFinishedToolCalls[e]) return !1;
	if (!t || !r) return !0;
	let a = i.worksets.find((e) => e.id === t);
	if (!a) return !0;
	let o = b(a.updated_at), s = b(r);
	return !Number.isFinite(o) || !Number.isFinite(s) || o < s;
}
function Cb(e) {
	let t = [];
	return e.forEach((e) => {
		e.type !== "thread_started" && t.length || t.push([]), t[t.length - 1].push(e);
	}), t;
}
function wb(e) {
	let t = {};
	return Object.entries(e).forEach(([e, n]) => {
		t[e] = Cb(n);
	}), t;
}
function Tb(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = Eb(e);
			t[n] = (t[n] ?? 0) + 1;
		});
	}), t;
}
function Eb(e) {
	return xb(bb(e).name) || "thread";
}
function Db(e) {
	return Eb(e);
}
function Ob(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = xb(bb(e).action);
			n && (t[Eb(e)] = n);
		});
	}), t;
}
function kb(e) {
	let t = bb(e).threads;
	return Array.isArray(t) ? t.filter(u) : [];
}
function Ab(e) {
	let t = e.length;
	if (t <= 1) return t ? [e] : [];
	let n = /* @__PURE__ */ new Map();
	for (let r = 0; r < t; r += 1) {
		let t = Eb(e[r]);
		if (n.has(t)) return [e];
		n.set(t, r);
	}
	let r = Array.from({ length: t }, () => []), i = Array.from({ length: t }, () => 0);
	for (let a = 0; a < t; a += 1) {
		let t = /* @__PURE__ */ new Set();
		for (let o of kb(e[a])) {
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
function jb(e, t, n) {
	let r = e.threadEpisodes[t] ?? [];
	return r[n - ((e.dispatchCounts[t] ?? r.length) - r.length)];
}
function Mb(e) {
	let t = /* @__PURE__ */ new Set();
	return e.forEach((n, r) => {
		if (n.role !== "assistant") return;
		let i = eb(e, r), a = (n.tool_calls ?? []).filter((e) => e.function?.name === "thread");
		if (!a.length) return;
		let o = tb(e, r, mb), s = !1;
		for (let e of a) {
			let n = i.get(e.id)?.text, r = Db(e);
			n == null ? o || t.delete(r) : n.startsWith(_b) ? (t.add(r), s = !0) : t.delete(r);
		}
		if (s || o) for (let e of a) i.get(e.id) ?? t.add(Db(e));
	}), t;
}
function Nb(e, t, n, r, i, a, o) {
	let s = Eb(e), c = bb(e), l = xb(c.action), u = xb(c.weight), d = u === "light" || u === "heavy" ? u : null, f = i.get(e.id)?.text ?? null, p = t === (r.dispatchCounts[s] ?? 1) - 1 ? r.liveThreads[s] : void 0, m = kb(e).some((e) => a.has(e) && !o.has(e)), h = jb(r, s, t), g = p?.status !== "running" && h?.some((e) => e.type === "thread_finished"), _ = p?.status === "finished", v = (p?.status !== "running" || p.cancelled) && (f?.startsWith(_b) === !0 || p?.cancelled || f == null && t === (r.dispatchCounts[s] ?? 1) - 1 && r.cancelledNames.has(s)) ? "cancelled" : p?.isError ? "error" : f != null || _ || g ? "done" : m ? "pending" : "running";
	return {
		key: n,
		name: s,
		action: l,
		weight: d,
		summary: f || l,
		log: Wn(yn(h), p?.log ?? []),
		state: v
	};
}
function Pb(e, t) {
	for (let n = e.length - 1; n >= 0; --n) {
		let r = e[n];
		if (r.kind === t && (t !== "text" || r.kind !== "text" || r.text.trim() !== "[run cancelled by user]")) return r.text;
	}
	return null;
}
function Fb(e, t) {
	return e.reduce((e, n) => n.kind === t ? e + 1 : e, 0);
}
function Ib(e, t, n = !1) {
	let r = Qy(t.reasoning).trim(), i = Qy(t.text).trim();
	if (!r && !i) return e;
	let a = e[e.length - 1], o = a?.kind === "model" && !n, s = o ? {
		...a,
		blocks: a.blocks.slice()
	} : {
		kind: "model",
		key: yb,
		blocks: [],
		durationMs: null,
		messageIndex: null
	}, c = !1;
	return r && !Pb(s.blocks, "thoughts")?.includes(r) && (s.blocks.push({
		kind: "thoughts",
		key: `thoughts-${Fb(s.blocks, "thoughts")}`,
		text: r,
		durationMs: null,
		streaming: !i
	}), c = !0), i && !Pb(s.blocks, "text")?.includes(i) && (s.blocks.push({
		kind: "text",
		key: `text-${Fb(s.blocks, "text")}`,
		text: i
	}), c = !0), c ? o ? [...e.slice(0, -1), s] : [...e, s] : e;
}
function Lb(e, t, n = {}, r = [], i = /* @__PURE__ */ new Set()) {
	let a = e?.messages ?? [], o = e?.response_timing.response_durations_ms ?? [], s = e?.message_created_at ?? [], c = e?.message_page?.start ?? 0, l = e?.metadata?.behavior === "direct" || e?.metadata?.behavior === "direct-with-orchestrator", u = fb(l ? [...e?.primary_tool_events ?? [], ...r] : []), d = -1;
	a.forEach((e, t) => {
		e.role === "user" && (d = t);
	});
	let f = Tb(a), p = new Map((e?.threads ?? []).map((e) => [e.name, e.episode_count])), m = new Set(e?.active_threads ?? []), h = {}, g = {};
	for (let [e, t] of Object.entries(f)) {
		let n = p.get(e) ?? 0, r = Math.max(t, n + +!!m.has(e));
		h[e] = r, g[e] = Math.max(0, r - t);
	}
	let _ = {
		liveThreads: t,
		liveFinishedToolCalls: n,
		worksets: e?.worksets?.items ?? [],
		threadEpisodes: wb(e?.thread_events ?? {}),
		dispatchCounts: h,
		cancelledNames: Mb(a)
	}, v = [], y = null, b = /* @__PURE__ */ new Map();
	a.forEach((t, n) => {
		let r = c + n;
		if (t.role === "system" || t.role === "tool") return;
		if (t.role === "user") {
			y = null;
			let e = Ae(t.content);
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
				text: Nt(t.content),
				invokedSkills: zr(t.content),
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
		let f = Qy(t.reasoning_text ?? "").trim();
		f && o.push({
			kind: "thoughts",
			key: `thoughts-${Fb(o, "thoughts")}`,
			text: f,
			durationMs: t.duration_ms ?? null,
			streaming: !1
		});
		let p = gb(Qy(t.content ?? ""));
		p && o.push({
			kind: "text",
			key: `text-${Fb(o, "text")}`,
			text: p
		});
		let m = eb(a, n), h = [];
		if ((t.tool_calls ?? []).forEach((t, c) => {
			let f = t.function?.name ?? "tool", p = `${f}-${r}-${c}`;
			if (f === "thread") h.push(t);
			else if (f === "workset_define") {
				let e = xb(bb(t).id);
				o.push({
					kind: "workset",
					key: p,
					worksetId: e,
					pending: Sb(t.id, e, m, s[n] ?? null, _)
				});
			} else if (!vb.has(f)) {
				let r = m.get(t.id);
				l ? o.push({
					kind: "tool-detail",
					key: `tool-${t.id}`,
					presentation: pb({
						call: t,
						events: u.get(t.id),
						hasResult: r != null,
						resultText: r?.text ?? null,
						resultHasImage: r?.hasImage ?? !1,
						active: !!e?.active_run && n > d,
						awaitingApproval: i.has(t.id),
						turnCancelled: tb(a, n, mb)
					})
				}) : o.push({
					kind: "tool",
					key: p,
					name: f,
					pending: r == null
				});
			}
		}), h.length) {
			let e = new Set(h.map(Eb)), t = /* @__PURE__ */ new Set();
			for (let e of h) {
				let n = Eb(e);
				if (m.has(e.id) || _.liveThreads[n]?.status === "finished") {
					t.add(n);
					continue;
				}
				let r = _.threadEpisodes[n] ?? [], i = r[r.length - 1];
				_.liveThreads[n]?.status !== "running" && i?.some((e) => e.type === "thread_finished") && t.add(n);
			}
			let n = Ab(h).map((n) => n.map((n) => {
				let i = Eb(n), a = g[i] ?? 0;
				return g[i] = a + 1, Nb(n, a, `${i}@${r}:${n.id}`, _, m, e, t);
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
// src/app/components/inspector/ModelMessage.tsx
function Rb(e) {
	return e.streaming ? "Thinking" : e.durationMs == null ? "Thoughts" : `Thoughts, ${Wr(e.durationMs)}`;
}
function zb(e) {
	return e.blocks.filter((e) => e.kind === "text").map((e) => e.text).join("\n\n").trim();
}
var Bb = si(function({ turn: e, model: t, active: n, activity: r, isLast: i = !1, selectedThreadEpisode: a, selectedWorkset: o, onSelectThread: s, onSelectWorkset: c, userMessageIndex: l, userText: u = "", onRefresh: d = null, onRevert: f = null, onFork: p = null, forks: m = [], onOpenFork: h, onDismissFork: g, actionsDisabled: _ = !1, readOnly: v = !1, snapshotRevision: y = null, filesPanel: b = null }) {
	Se("ModelMessage");
	let x = !v && d != null && l != null, S = !v && f != null && l != null, C = e.messageIndex, w = zb(e), T = e.blocks.some((e) => e.kind === "text" && e.text.trim() === "[run cancelled by user]"), E = Le();
	return /* @__PURE__ */ Y("div", {
		className: P("group/model-msg flex gap-1 items-start w-full max-w-full py-8 relative", i && "min-h-[calc(70vh-316px)]"),
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col flex-grow gap-1 pt-2 md:max-w-[calc(100%-36px)] min-w-0",
			children: [
				/* @__PURE__ */ X("div", {
					className: "flex gap-3 items-center mb-4 min-w-0",
					children: [
						/* @__PURE__ */ Y(bl, { active: n }),
						/* @__PURE__ */ Y("span", {
							className: "label-small text-basic-primary truncate",
							children: t
						}),
						n && r ? /* @__PURE__ */ Y(J, { children: " " }) : e.durationMs == null ? null : /* @__PURE__ */ Y("span", {
							className: "label-micro text-basic-muted shrink-0 fade",
							children: Ut(e.durationMs)
						})
					]
				}),
				/* @__PURE__ */ X("div", {
					className: P("chat-response chat-response-content paragraph-medium text-basic-secondary relative w-full min-w-0 md:pl-3", n && "streaming"),
					children: [
						e.blocks.map((e) => {
							switch (e.kind) {
								case "thoughts": return e.text.trim() ? /* @__PURE__ */ Y(Ay, {
									label: Rb(e),
									pending: e.streaming,
									body: e.text
								}, e.key) : null;
								case "text": return e.text.trim() === "[run cancelled by user]" ? null : /* @__PURE__ */ Y(Oy, {
									streaming: n,
									children: e.text
								}, e.key);
								case "workset": return /* @__PURE__ */ Y(Ay, {
									label: e.worksetId ? `Worksets_${e.worksetId}` : e.pending ? "Defining worksets…" : "Worksets",
									pending: e.pending,
									active: o === e.worksetId,
									onClick: () => c(e.worksetId)
								}, e.key);
								case "tool": return /* @__PURE__ */ Y(Ay, {
									label: e.pending ? `${e.name}…` : e.name,
									pending: e.pending
								}, e.key);
								case "tool-detail": return /* @__PURE__ */ Y(Jy, { tool: e.presentation }, e.key);
								case "wave": return /* @__PURE__ */ Y(Ky, {
									rows: e.rows,
									selected: a,
									onSelect: s
								}, e.key);
								default: return null;
							}
						}),
						y && b ? /* @__PURE__ */ Y(Fy, {
							revision: y,
							panel: b
						}) : null,
						T ? /* @__PURE__ */ Y(Ca, {
							variant: ya.Danger,
							title: "Run cancelled by user"
						}) : null
					]
				}),
				!v && m.length > 0 ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-2 pt-4 md:pl-3 [&>*]:shrink-0",
					children: m.map((e) => /* @__PURE__ */ Y(Ic, {
						sessionId: e.session_id,
						title: e.title,
						deleted: e.deleted,
						onOpen: h ? () => h(e.session_id) : void 0,
						onDismiss: g && e.deleted ? () => g(e.session_id) : void 0
					}, e.session_id))
				}) : null,
				n ? null : /* @__PURE__ */ X("div", {
					className: P("flex items-center justify-start gap-3 pt-4 md:pl-3", "opacity-0 pointer-events-none transition-opacity duration-150", "group-hover/model-msg:opacity-100 group-hover/model-msg:pointer-events-auto", "group-focus-within/model-msg:opacity-100 group-focus-within/model-msg:pointer-events-auto", "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"),
					children: [
						x ? /* @__PURE__ */ Y(Ir, {
							title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
							position: R.BottomRight,
							children: /* @__PURE__ */ Y(I, {
								size: E ? z.Medium : z.Small,
								variant: E ? H.Ghost : H.Tertiary,
								content: L.Icon,
								"aria-label": "Regenerate from original prompt",
								disabled: _,
								onClick: () => d(l),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ Y(B, {
									iconName: V.Refresh,
									size: 16
								})
							})
						}) : null,
						S ? /* @__PURE__ */ Y(Ir, {
							title: "Revert to this snapshot",
							position: R.BottomRight,
							children: /* @__PURE__ */ Y(I, {
								size: E ? z.Medium : z.Small,
								variant: E ? H.Ghost : H.Tertiary,
								content: L.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: _,
								onClick: () => f(l, u),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ Y(B, {
									iconName: V.TurnLeft,
									size: 16
								})
							})
						}) : v ? null : /* @__PURE__ */ Y(Ir, {
							title: "This message is not in the transcript yet",
							position: R.BottomRight,
							children: /* @__PURE__ */ Y("span", {
								className: "inline-flex",
								children: /* @__PURE__ */ Y(I, {
									size: E ? z.Medium : z.Small,
									variant: E ? H.Ghost : H.Tertiary,
									content: L.Icon,
									"aria-label": "Revert to this snapshot",
									disabled: !0,
									className: "md:!h-4 md:!min-h-4 md:!p-0",
									children: /* @__PURE__ */ Y(B, {
										iconName: V.TurnLeft,
										size: 16
									})
								})
							})
						}),
						!v && p != null && C != null ? /* @__PURE__ */ Y(Ir, {
							title: "Create fork",
							position: R.BottomRight,
							children: /* @__PURE__ */ Y(I, {
								size: E ? z.Medium : z.Small,
								variant: E ? H.Ghost : H.Tertiary,
								content: L.Icon,
								"aria-label": "Create fork",
								disabled: _,
								onClick: () => p(C),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ Y(B, {
									iconName: V.Scheme,
									size: 16
								})
							})
						}) : null,
						/* @__PURE__ */ Y(Ft, {
							value: w,
							size: E ? z.Medium : z.Small,
							variant: E ? H.Ghost : H.Tertiary,
							title: "Copy message",
							position: R.BottomRight,
							className: "md:!h-4 md:!min-h-4 md:!p-0"
						})
					]
				})
			]
		})
	});
}), Vb = si(function({ text: e, terminalSelection: t, sessionId: n, pending: r = !1, invokedSkills: i = null, timestamp: a = null, messageIndex: o, onRefresh: s = null, onRevert: c = null, actionsDisabled: l = !1, readOnly: u = !1 }) {
	Se("UserMessage");
	let d = !u && s != null && o != null, f = !u && c != null && o != null, p = Le();
	return /* @__PURE__ */ X("div", {
		className: "group/user-msg flex flex-col items-end w-full max-w-full pt-4 pb-8",
		children: [
			/* @__PURE__ */ Y("div", {
				className: P("min-w-0 max-w-full py-3 px-5 rounded-[12px] bg-elevation-sublevel-variant-B shadow-convex", "label-small text-basic-primary whitespace-pre-wrap break-words", r && "opacity-60"),
				children: t ? /* @__PURE__ */ Y(bg, {
					evidence: t,
					canonicalText: e,
					sessionId: n
				}) : e
			}),
			i && i.length > 0 ? /* @__PURE__ */ X("div", {
				className: "flex items-center gap-1 pt-1.5 pr-1 label-micro text-basic-tertiary",
				title: "Skill content was expanded into the prompt sent to the agent",
				children: [/* @__PURE__ */ Y(B, {
					iconName: V.Bolt,
					size: 12,
					color: "var(--color-fill-basic-tertiary)"
				}), /* @__PURE__ */ X("span", { children: [
					i.length === 1 ? "Skill" : "Skills",
					" expanded:",
					" ",
					i.map((e) => `$${e}`).join(", ")
				] })]
			}) : null,
			r ? null : /* @__PURE__ */ X("div", {
				className: P("flex items-center justify-end gap-3 pt-3", "opacity-0 pointer-events-none transition-opacity duration-150", "group-hover/user-msg:opacity-100 group-hover/user-msg:pointer-events-auto", "group-focus-within/user-msg:opacity-100 group-focus-within/user-msg:pointer-events-auto", "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"),
				children: [
					a ? /* @__PURE__ */ Y("span", {
						className: "label-micro text-basic-tertiary whitespace-nowrap truncate",
						children: a
					}) : null,
					d ? /* @__PURE__ */ Y(Ir, {
						title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
						position: R.BottomLeft,
						children: /* @__PURE__ */ Y(I, {
							size: p ? z.Medium : z.Small,
							variant: p ? H.Ghost : H.Tertiary,
							content: L.Icon,
							"aria-label": "Regenerate from original prompt",
							disabled: l,
							onClick: () => s(o),
							className: "md:!h-4 md:!min-h-4 md:!p-0",
							children: /* @__PURE__ */ Y(B, {
								iconName: V.Refresh,
								size: 16
							})
						})
					}) : null,
					f ? /* @__PURE__ */ Y(Ir, {
						title: "Revert to this snapshot",
						position: R.BottomLeft,
						children: /* @__PURE__ */ Y(I, {
							size: p ? z.Medium : z.Small,
							variant: p ? H.Ghost : H.Tertiary,
							content: L.Icon,
							"aria-label": "Revert to this snapshot",
							disabled: l,
							onClick: () => c(o, e),
							className: "md:!h-4 md:!min-h-4 md:!p-0",
							children: /* @__PURE__ */ Y(B, {
								iconName: V.TurnLeft,
								size: 16
							})
						})
					}) : u ? null : /* @__PURE__ */ Y(Ir, {
						title: "This message is not in the transcript yet",
						position: R.BottomLeft,
						children: /* @__PURE__ */ Y("span", {
							className: "inline-flex",
							children: /* @__PURE__ */ Y(I, {
								size: p ? z.Medium : z.Small,
								variant: p ? H.Ghost : H.Tertiary,
								content: L.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: !0,
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ Y(B, {
									iconName: V.TurnLeft,
									size: 16
								})
							})
						})
					}),
					/* @__PURE__ */ Y(Ft, {
						value: e,
						size: p ? z.Medium : z.Small,
						variant: p ? H.Ghost : H.Tertiary,
						title: t ? "Copy canonical message" : "Copy message",
						position: R.BottomLeft,
						className: "md:!h-4 md:!min-h-4 md:!p-0"
					})
				]
			})
		]
	});
});
// src/app/features/delegation/presentation/DelegatedCompletionEvent.tsx
function Hb({ turn: e }) {
	let t = fr().orchestrationEnabled || e.completion.kind === "coding-agent", n = Ti(), r = e.completion.kind === "coding-agent" ? "Coding agent" : "NAC orchestrator", i = e.completion.status === "completed" ? ya.Success : e.completion.status === "failed" ? ya.Error : ya.Danger;
	return /* @__PURE__ */ Y(Ca, {
		role: "status",
		"aria-label": `${r} ${e.completion.status}`,
		className: "my-5",
		variant: i,
		title: `${r} ${e.completion.status}: ${e.completion.description}`,
		children: /* @__PURE__ */ X("span", {
			className: "flex flex-col gap-2",
			children: [
				/* @__PURE__ */ X("span", { children: ["Generation ", e.completion.generation] }),
				e.completion.outcome ? /* @__PURE__ */ Y("span", {
					className: "whitespace-pre-wrap",
					children: e.completion.outcome
				}) : null,
				e.completion.changes ? /* @__PURE__ */ X("span", {
					className: "whitespace-pre-wrap",
					children: ["Changes: ", e.completion.changes]
				}) : null,
				e.completion.verification ? /* @__PURE__ */ X("span", {
					className: "whitespace-pre-wrap",
					children: ["Verification: ", e.completion.verification]
				}) : null,
				t ? /* @__PURE__ */ Y(I, {
					size: z.Small,
					variant: H.Ghost,
					onClick: () => n(kr.session(e.completion.sessionId)),
					children: "Open exact transcript"
				}) : null
			]
		})
	});
}
// src/app/hooks/useDelegatedPreviewStream.ts
var Ub = 250, Wb = {
	text: "",
	reasoning: "",
	running: !1
};
function Gb(e) {
	let { subscribeToSessionEvents: t } = { subscribeToSessionEvents: n().events }, r = vi(), [i, a] = q(Wb), [o, s] = q(e);
	return o !== e && (s(e), a(Wb)), W(() => {
		if (!e || typeof EventSource > "u") return;
		let n = !1, i = !1, o = null, s = () => {
			clearTimeout(o ?? void 0), o = window.setTimeout(() => {
				o = null, !n && r.invalidateQueries({
					queryKey: Xt.sessionSnapshot(e),
					exact: !0
				});
			}, Ub);
		}, c = t(e, {
			onEnvelope: (e) => {
				let t = e.event;
				switch (t.type) {
					case "transcript_appended":
					case "snapshot_saved":
						i = !0, s();
						return;
					case "run_started":
						i = !1, a({
							text: "",
							reasoning: "",
							running: !0
						}), s();
						return;
					case "run_completed":
						i = !0, a({
							text: t.response,
							reasoning: "",
							running: !1
						}), s();
						return;
					case "run_failed":
					case "run_cancelled":
						i = !0, a((e) => ({
							...e,
							running: !1
						})), s();
						return;
					case "transcript_reverted":
						i = !0, a(Wb), s();
						return;
					default: return;
				}
			},
			onAssistantDelta: (e) => {
				if (e.thread_name) return;
				if (e.reset) {
					i = !1, a(Wb);
					return;
				}
				let t = i;
				i = !1, a((n) => {
					let r = t ? Wb : n;
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
			n = !0, c(), clearTimeout(o ?? void 0);
		};
	}, [
		r,
		e,
		t
	]), i;
}
// src/app/lib/scroll.ts
var Kb = (e) => 1 - (1 - e) ** 3, qb = (e) => e.scrollHeight - (e.scrollTop + e.clientHeight);
function Jb(e) {
	e.scrollTop = e.scrollHeight - e.clientHeight;
}
function Yb(e, t, n = 300, r) {
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
			let r = Math.min(1, (t - c) / n), i = Math.max(0, e.scrollHeight - e.clientHeight), s = a + ((p ? i : Math.min(o, i)) - a) * Kb(r);
			e.scrollTop = p ? Math.max(e.scrollTop, s) : s, r < 1 ? l = requestAnimationFrame(m) : d(!0);
		};
		l = requestAnimationFrame(m);
	});
}
// src/app/hooks/useStickToBottom.ts
var Xb = 400, Zb = 60, Qb = 400, $b = 200, ex = 300, tx = 1, nx = 50, rx = 150, ix = /* @__PURE__ */ new Set([
	"ArrowUp",
	"ArrowDown",
	"PageUp",
	"PageDown",
	"Home",
	"End"
]);
function ax({ resetKey: e = null } = {}) {
	let t = K(null), n = K(null), [r, i] = q(!1), a = K(!0), o = K(!1), s = K(0), c = K(!1), l = K(null), u = K(null), d = K(null), f = K(!1), p = K($b), m = K(0), h = K(null), g = U(() => {
		h.current !== null && (clearTimeout(h.current), h.current = null), c.current = !1, o.current = !0;
	}, []), _ = U(() => {
		h.current !== null && clearTimeout(h.current), h.current = window.setTimeout(() => {
			h.current = null, o.current = !1;
		}, nx);
	}, []), v = U(() => {
		let e = t.current;
		e && i(qb(e) > Xb);
	}, []), y = U(() => {
		let e = u.current !== null;
		u.current?.abort(), u.current = null, d.current !== null && (cancelAnimationFrame(d.current), d.current = null), e && _();
	}, [_]), b = U((e) => {
		let n = t.current;
		if (!n || !a.current || (p.current = e, u.current)) return;
		v();
		let r = qb(n);
		if (r <= 0) return;
		let i = !f.current;
		if (f.current = !0, i || r > n.clientHeight * tx) {
			y(), g(), Jb(n), v(), _();
			return;
		}
		let o = new AbortController();
		u.current = o, g(), Yb(n, n.scrollHeight, e, o.signal).then((e) => {
			u.current === o && (u.current = null, _(), v(), p.current = $b);
		});
	}, [
		g,
		y,
		_,
		v
	]);
	return W(() => {
		let e = t.current;
		if (!e) return;
		let n = () => {
			c.current = !0, l.current !== null && clearTimeout(l.current), l.current = window.setTimeout(() => {
				c.current = !1, l.current = null;
			}, rx);
		}, r = () => {
			let t = qb(e), n = s.current, r = e.scrollHeight !== n;
			s.current = e.scrollHeight, r ? t <= 60 && (a.current = !0) : (!o.current || c.current) && (t > Zb ? (a.current && y(), a.current = !1) : a.current = !0, v());
		}, i = (t) => {
			n();
			let r = qb(e);
			t.deltaY < 0 && r > Zb ? (y(), a.current = !1, v()) : t.deltaY > 0 && r <= 60 && (a.current = !0);
		}, u = (t) => {
			let r = e.getBoundingClientRect();
			t.clientX >= r.left + e.clientWidth && n();
		}, d = (e) => {
			ix.has(e.key) && n();
		};
		return e.addEventListener("scroll", r, { passive: !0 }), e.addEventListener("wheel", i, { passive: !0 }), e.addEventListener("pointerdown", u, { passive: !0 }), e.addEventListener("touchmove", n, { passive: !0 }), e.addEventListener("keydown", d), r(), () => {
			e.removeEventListener("scroll", r), e.removeEventListener("wheel", i), e.removeEventListener("pointerdown", u), e.removeEventListener("touchmove", n), e.removeEventListener("keydown", d), l.current !== null && clearTimeout(l.current);
		};
	}, [y, v]), W(() => {
		let e = t.current, r = n.current;
		if (!e || !r) return;
		let i = () => {
			y(), g(), Jb(e), v(), _();
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
				if (!a.current || qb(e) <= 60) return;
				i();
			} else c();
		});
		x.observe(r);
		let S = new ResizeObserver(() => {
			a.current && (u.current || o.current || qb(e) <= 60 || i());
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
	]), ui(() => {
		y(), a.current = !0, s.current = 0, m.current = 0;
		let e = t.current;
		e ? (f.current = !0, g(), Jb(e), v(), _()) : f.current = !1;
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
		jumpToLatest: U(() => {
			let e = t.current;
			e && (y(), a.current = !0, i(!1), g(), Yb(e, e.scrollHeight, Qb).then((t) => {
				_(), t || (a.current = qb(e) <= 60, v());
			}));
		}, [
			g,
			y,
			_,
			v
		]),
		followLatest: U((e = ex) => {
			f.current = !0, b(e);
		}, [b])
	};
}
// src/app/hooks/useMarkdownReady.ts
function ox() {
	let [e, t] = q(Ey);
	return W(() => {
		if (e) return;
		let n = !0;
		return Ty().finally(() => {
			n && t(!0);
		}), () => {
			n = !1;
		};
	}, [e]), e;
}
// src/app/hooks/useTranscriptReveal.ts
var sx = 1500;
function cx(e, t) {
	let n = ox(), r = mi({ queryKey: Xt.sessionRoot(e) }), [i, a] = q(null), o = K(null), s = K(!1), c = i === e;
	return W(() => {
		if (o.current !== e && (o.current = e, s.current = t), c || !t || !n) return;
		if (s.current) {
			let t = !1;
			return queueMicrotask(() => {
				t || a(e);
			}), () => {
				t = !0;
			};
		}
		if (r > 0) return;
		let i = 0, l = requestAnimationFrame(() => {
			i = requestAnimationFrame(() => a(e));
		});
		return () => {
			cancelAnimationFrame(l), cancelAnimationFrame(i);
		};
	}, [
		c,
		t,
		n,
		r,
		e
	]), W(() => {
		if (c || !t) return;
		let n = setTimeout(() => a(e), sx);
		return () => clearTimeout(n);
	}, [
		c,
		t,
		e
	]), c;
}
// src/app/components/inspector/SubagentPreview.tsx
function lx() {}
function ux() {}
function dx(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function fx({ sessionId: e, title: t, fallbackText: n, icon: r }) {
	let i = Ti(), a = ou(), o = Mr(e, { retry: !1 }), s = Gb(e), c = Vt(e), l = o.data, u = !!l?.message_page?.has_older, d = l?.message_page?.start ?? 0, [f, p] = q(!1), [m, h] = q(e), g = K(!1);
	m !== e && (h(e), p(!1));
	let _ = s.running || !!l?.active_run, v = cx(e, !!l && (!u || f) || o.isError), { scrollRef: y, contentRef: b } = ax({ resetKey: e }), x = K(null);
	ui(() => {
		let e = x.current, t = y.current;
		e && t && (t.scrollTop = e.top + (t.scrollHeight - e.height), x.current = null);
	}, [y, d]);
	let S = c.mutateAsync;
	W(() => {
		g.current = !1;
	}, [e]), W(() => {
		if (!u || f || g.current) return;
		let e = y.current;
		e && (x.current = {
			height: e.scrollHeight,
			top: e.scrollTop
		}), g.current = !0;
		let t = !1;
		return S().then((e) => {
			!t && !e && p(!0);
		}).catch(() => {
			t || p(!0);
		}).finally(() => {
			g.current = !1;
		}), () => {
			t = !0;
		};
	}, [
		u,
		S,
		f,
		y,
		d
	]);
	let C = G(() => Lb(l ?? null, {}, {}, []), [l]), w = _ ? l?.active_run?.submitted_user_message : void 0, T = w ? Nt(w.content) : "", E = w ? zr(w.content) : null, D = !!(T && dx(C) !== T), O = s.running && !l?.active_run && !!(s.text || s.reasoning), k = G(() => Ib(C, {
		text: s.text,
		reasoning: s.reasoning
	}, D || O), [
		s.reasoning,
		s.text,
		D,
		C,
		O
	]), A = k[k.length - 1], j = _ && A?.kind === "model" && (!D || A.key === "model-streaming"), ee = _ && !j, M = D && A?.key === "model-streaming", te = l?.metadata.model ?? "", ne = v ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
	return /* @__PURE__ */ X("div", {
		className: "flex min-h-0 flex-1 flex-col",
		children: [/* @__PURE__ */ X("div", {
			className: "flex h-14 shrink-0 items-center gap-2 border-b border-muted bg-elevation-ground px-4",
			children: [
				a ? /* @__PURE__ */ Y(B, {
					iconName: r,
					size: 20,
					className: "shrink-0 text-basic-secondary"
				}) : null,
				/* @__PURE__ */ Y("p", {
					className: P("label-small min-w-0 flex-1 truncate", _ ? "text-shimmer-basic" : "text-basic-primary"),
					children: t
				}),
				/* @__PURE__ */ X(I, {
					size: z.Small,
					variant: H.Ghost,
					content: L.IconRight,
					"aria-label": "Open",
					onClick: () => i(kr.session(e)),
					children: ["Open", /* @__PURE__ */ Y(B, { iconName: V.Right })]
				})
			]
		}), /* @__PURE__ */ X("div", {
			className: "relative min-h-0 flex-1",
			children: [/* @__PURE__ */ Y("div", {
				role: "status",
				"aria-label": v ? void 0 : "Loading conversation",
				className: P("pointer-events-none absolute inset-0 px-4 pt-4 transition-opacity duration-150 ease-in-out", v ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ Y(Da, {
					rows: 3,
					rowClassName: "h-[48px]"
				})
			}), /* @__PURE__ */ Y("div", {
				ref: y,
				className: P("h-full overflow-y-auto", ne, !v && "invisible"),
				children: /* @__PURE__ */ X("div", {
					ref: b,
					className: "flex flex-col px-4 pt-2 pb-6 [&>*]:shrink-0",
					children: [
						f && u ? /* @__PURE__ */ X("div", {
							role: "alert",
							className: "mb-4 flex items-center gap-2",
							children: [/* @__PURE__ */ Y("span", {
								className: "label-small text-basic-muted",
								children: "Couldn’t load older messages."
							}), /* @__PURE__ */ Y(I, {
								size: z.Small,
								variant: H.Ghost,
								onClick: () => p(!1),
								children: "Try again"
							})]
						}) : null,
						k.map((e, t) => {
							if (e.kind === "delegated-completion") return /* @__PURE__ */ Y(Hb, { turn: e }, e.key);
							if (e.kind === "user") return /* @__PURE__ */ Y(Vb, {
								text: e.text,
								invokedSkills: e.invokedSkills,
								timestamp: e.createdAt ? Qe(e.createdAt) : null,
								readOnly: !0
							}, e.key);
							let n = t === k.length - 1, r = /* @__PURE__ */ Y(Bb, {
								turn: e,
								model: te,
								active: _ && n,
								isLast: !1,
								selectedThreadEpisode: null,
								selectedWorkset: null,
								onSelectThread: lx,
								onSelectWorkset: ux,
								readOnly: !0
							}, e.key);
							return M && e.key === "model-streaming" ? /* @__PURE__ */ X(ri, { children: [/* @__PURE__ */ Y(Vb, {
								text: T,
								invokedSkills: E,
								pending: !0,
								readOnly: !0
							}), r] }, e.key) : r;
						}),
						D && !M ? /* @__PURE__ */ Y(Vb, {
							text: T,
							invokedSkills: E,
							pending: !0,
							readOnly: !0
						}) : null,
						ee ? /* @__PURE__ */ Y(Bb, {
							turn: {
								kind: "model",
								key: "model-pending",
								blocks: [],
								durationMs: null,
								messageIndex: null
							},
							model: te,
							active: !0,
							isLast: !1,
							selectedThreadEpisode: null,
							selectedWorkset: null,
							onSelectThread: lx,
							onSelectWorkset: ux,
							readOnly: !0
						}) : null,
						k.length === 0 && !_ && n ? /* @__PURE__ */ Y("p", {
							className: "label-small py-4 text-basic-secondary",
							children: n
						}) : null
					]
				})
			})]
		})]
	});
}
// src/app/components/inspector/DelegatedWorkView.tsx
var px = {
	child: "traditional-child",
	orchestrator: "managed-orchestrator"
};
function mx(e) {
	return e?.trim() || null;
}
function hx(e) {
	return {
		key: `child:${e.child_session_id}`,
		mode: "child",
		id: e.child_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: mx(e.failure) ?? mx(e.report) ?? mx(e.change_summary) ?? mx(e.verification_summary)
	};
}
function gx(e) {
	return {
		key: `orchestrator:${e.orchestrator_session_id}`,
		mode: "orchestrator",
		id: e.orchestrator_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: mx(e.failure) ?? mx(e.report)
	};
}
function _x() {
	return /* @__PURE__ */ X("div", {
		className: "flex min-h-0 flex-1 flex-col items-center justify-center px-4",
		children: [
			/* @__PURE__ */ Y(B, {
				iconName: V.Plane,
				size: 32,
				className: "text-basic-primary"
			}),
			/* @__PURE__ */ Y("p", {
				className: "label-big mt-2 text-center text-basic-primary",
				children: "No subagents yet"
			}),
			/* @__PURE__ */ Y("p", {
				className: "label-small mt-2 max-w-[311px] text-center text-basic-tertiary",
				children: "Ask the agent to delegate work. Subagents it starts appear here, where you can browse, steer, continue, and cancel them."
			})
		]
	});
}
function vx({ sessionId: e, behavior: t }) {
	let { showSidePanelList: r, selectSubagent: i, useSelectedSubagent: a } = n().stores.sessionLayoutStore, o = Le(), s = In(), c = o || s, l = fr().orchestrationEnabled && t === "direct-with-orchestrator", u = ou(), d = Dt(e, !0), f = ht(e, l), p = $t(6e4), m = a(e), h = G(() => {
		let e = (d.data ?? []).map(hx), t = l ? (f.data ?? []).map(gx) : [];
		return [...e, ...t];
	}, [
		d.data,
		f.data,
		l
	]), g = [...h].sort((e, t) => t.updatedAt.localeCompare(e.updatedAt))[0]?.key ?? null, _ = h.find((e) => e.key === m) ?? h.find((e) => e.key === g) ?? null;
	W(() => {
		m == null && g != null && i(e, g);
	}, [
		g,
		i,
		m,
		e
	]);
	let v = G(() => Ou(h, (e) => ({
		updatedAt: e.updatedAt,
		pinned: !1
	}), p), [h, p]), y = (t) => {
		i(e, t), r(!1);
	}, b = h.length === 0 && (d.isError || l && f.isError), x = d.isSuccess && (!l || f.isSuccess), S = /* @__PURE__ */ X("div", {
		role: "alert",
		className: "m-2 rounded-[6px] border border-error-primary p-3",
		children: [/* @__PURE__ */ Y("div", {
			className: "text-small text-error-primary",
			children: "Subagents could not be loaded."
		}), /* @__PURE__ */ Y(I, {
			className: "mt-2",
			size: z.Small,
			variant: H.Ghost,
			onClick: () => {
				d.refetch(), l && f.refetch();
			},
			children: "Try again"
		})]
	}), C = b ? S : h.length === 0 && !x ? /* @__PURE__ */ Y("p", {
		role: "status",
		className: "label-small m-auto text-basic-tertiary",
		children: "Loading subagents…"
	}) : null, w = /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-8",
		children: [C, v.map((e) => /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ X("div", {
				className: "flex items-baseline gap-2 px-2",
				children: [/* @__PURE__ */ Y("span", {
					className: "tag-label shrink-0 text-basic-muted",
					children: e.label
				}), /* @__PURE__ */ Y("span", { className: "h-px min-w-0 flex-1 bg-divider-muted" })]
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => /* @__PURE__ */ Y(va, {
					title: e.description,
					lineage: px[e.mode],
					showBehaviorIcon: u,
					running: e.status === "running",
					active: _?.key === e.key,
					onClick: () => y(e.key)
				}, e.key))
			})]
		}, e.label))]
	});
	return /* @__PURE__ */ Y(Wv, {
		listTitle: "Subagents",
		title: _?.description,
		list: w,
		children: /* @__PURE__ */ Y("div", {
			className: "flex min-h-0 flex-1 flex-col",
			children: _ ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(fx, {
				sessionId: _.id,
				title: _.description,
				fallbackText: _.fallbackText,
				icon: ca(null, px[_.mode])
			}), /* @__PURE__ */ Y("div", {
				className: "shrink-0 p-2 pb-[104px] md:pb-2",
				children: /* @__PURE__ */ Y(d_, {
					parentSessionId: e,
					target: _,
					permissionSessionId: _.id,
					permissionBehavior: _.mode === "orchestrator" ? "orchestrator" : "direct",
					showPermissions: !1
				}, `${_.mode}:${_.id}`)
			})] }) : C ? c ? C : null : /* @__PURE__ */ Y(_x, {})
		})
	});
}
// src/app/lib/revisions.ts
var yx = (e) => `Snapshot ${e}`, bx = (e, t) => t - e;
function xx(e, t) {
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
function Sx({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ X("button", {
		type: "button",
		className: P("flex items-start gap-2 w-full p-2 rounded-[8px] text-left", r ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": r,
		onClick: i,
		children: [
			/* @__PURE__ */ Y(B, {
				iconName: r ? V.Check : V.History,
				size: 20,
				className: "shrink-0 mt-[2px]"
			}),
			/* @__PURE__ */ X("span", {
				className: "flex-1 min-w-0 flex flex-col",
				children: [/* @__PURE__ */ Y("span", {
					className: "label-medium text-basic-primary truncate",
					children: e
				}), t ? /* @__PURE__ */ Y("span", {
					className: "label-small text-basic-muted truncate",
					children: t
				}) : null]
			}),
			n ? /* @__PURE__ */ Y("span", {
				className: "shrink-0 flex items-center gap-1 code code-small mt-[6px]",
				children: n
			}) : null
		]
	});
}
function Cx({ sessionId: e, selected: t, onSelect: n }) {
	let { data: r, isLoading: i, error: a } = Ue(e), o = r ?? [];
	return a ? /* @__PURE__ */ Y(qv, { children: mr(a) }) : /* @__PURE__ */ X("div", {
		className: "flex flex-col flex-1 min-h-0 overflow-auto p-2 gap-1 bg-elevation-ground [&>*]:shrink-0",
		children: [
			/* @__PURE__ */ Y(Sx, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => n(null)
			}),
			i ? /* @__PURE__ */ X("div", {
				className: "flex items-center gap-2 p-2 label-small text-basic-muted",
				children: [/* @__PURE__ */ Y(f, {
					size: mt.Small,
					variant: se.Neutral
				}), "Reading snapshots…"]
			}) : null,
			o.map((e, r) => /* @__PURE__ */ Y(Sx, {
				title: `${yx(bx(r, o.length))} · ${Qe(e.created_at)}`,
				subtitle: e.label.trim() || null,
				selected: e.id === t,
				trailing: e.additions || e.deletions ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ X("span", {
					className: "text-success-primary",
					children: ["+", e.additions]
				}), /* @__PURE__ */ X("span", {
					className: "text-error-primary",
					children: ["-", e.deletions]
				})] }) : null,
				onClick: () => n(e.id)
			}, e.id)),
			!i && o.length === 0 ? /* @__PURE__ */ Y("div", {
				className: "p-2 label-small text-basic-muted",
				children: "No snapshots yet. One is taken every time a run finishes."
			}) : null
		]
	});
}
// src/app/hooks/usePagedRows.ts
var wx = 50, Tx = "200px";
function Ex(e, { key: t, step: n = wx, atLeast: r = 0 }) {
	let [i, a] = q({
		key: t,
		count: n
	}), o = Math.max(i.key === t ? i.count : n, r), s = e.length > o, [c, l] = q(null), u = U(() => {
		a((e) => ({
			key: t,
			count: Math.max(e.key === t ? e.count : n, r) + n
		}));
	}, [
		t,
		n,
		r
	]);
	return W(() => {
		if (!c || !s) return;
		let e = new IntersectionObserver((e) => {
			e.some((e) => e.isIntersecting) && u();
		}, { rootMargin: Tx });
		return e.observe(c), () => e.disconnect();
	}, [
		c,
		s,
		u,
		o
	]), {
		visible: s ? e.slice(0, o) : e,
		hasMore: s,
		sentinelRef: l
	};
}
// src/app/components/inspector/TaskPreview.tsx
function Dx({ text: e, active: t, large: n = !1 }) {
	return /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(B, {
		iconName: V.Info,
		size: n ? 20 : 16,
		className: P("shrink-0", t ? "text-basic-primary" : "text-btn-secondary")
	}), /* @__PURE__ */ Y("span", {
		className: P("underline", n ? "label-small" : "label-micro", t ? "text-basic-primary" : "text-btn-secondary"),
		children: e
	})] });
}
function Ox({ action: e, open: t, onClose: n, children: r }) {
	return /* @__PURE__ */ Y(Zr, {
		open: t,
		onClose: n,
		placement: R.BottomRight,
		sticky: !0,
		size: "w-[430px] max-w-[calc(100vw-16px)]",
		panelClassName: "p-4 overflow-auto max-h-[70vh]",
		sheetClassName: "max-h-[70vh] overflow-auto",
		className: "shrink-0",
		content: /* @__PURE__ */ Y(Oy, {
			className: "text-basic-primary px-4 md:px-0",
			children: e
		}),
		children: r
	});
}
function kx({ action: e, large: t = !1 }) {
	let [n, r] = q(!1);
	return /* @__PURE__ */ Y(Ox, {
		action: e,
		open: n,
		onClose: () => r(!1),
		children: /* @__PURE__ */ Y("button", {
			type: "button",
			className: "flex items-center gap-1 shrink-0",
			"aria-expanded": n,
			onClick: () => r((e) => !e),
			children: /* @__PURE__ */ Y(Dx, {
				text: "See task",
				active: n,
				large: t
			})
		})
	});
}
function Ax({ action: e }) {
	let [t, n] = q(!1);
	return /* @__PURE__ */ Y(Ox, {
		action: e,
		open: t,
		onClose: () => n(!1),
		children: /* @__PURE__ */ Y(I, {
			size: z.Medium,
			variant: t ? H.Primary : H.Secondary,
			"aria-expanded": t,
			onClick: () => n((e) => !e),
			children: "Task"
		})
	});
}
// src/app/components/inspector/SteeringPromptModal.tsx
function jx({ open: e, title: t, subheader: n, value: r, submitting: i, disabled: a = !1, footerLeading: o, onChange: s, onClose: c, onSubmit: l }) {
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: i ? void 0 : c,
		onNavigate: c,
		size: dn.Wide,
		title: t,
		subheader: n,
		children: /* @__PURE__ */ X("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ Y(el, {
				label: "Steering message",
				"aria-label": "Steering message",
				textAreaSize: $c.Medium,
				value: r,
				onChange: (e) => s(e.target.value),
				isDisabled: i,
				textAreaClassName: "h-[140px] resize-none"
			}), /* @__PURE__ */ X("div", {
				className: "flex flex-wrap items-center justify-between gap-3",
				children: [/* @__PURE__ */ Y("div", { children: o }), /* @__PURE__ */ Y(I, {
					variant: H.Primary,
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
function Mx({ sessionId: e, threadName: t, onClose: n }) {
	let [r, i] = q(""), a = Sn(), o = Cn(), s = async () => {
		let s = r.trim();
		if (!s) o.error("A steering message is required.");
		else try {
			await a.mutateAsync({
				id: e,
				threadName: t,
				instruction: s
			}), i(""), n();
		} catch (e) {
			o.error(`Unable to steer ${t}: ${mr($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(jx, {
		open: !0,
		title: `Steer ${t}`,
		value: r,
		submitting: a.isPending,
		onChange: i,
		onClose: n,
		onSubmit: () => void s()
	});
}
// src/app/components/inspector/ThreadsView.tsx
function Nx(e, t, n, r) {
	return r ? t.has(r) || n[r] ? !0 : e ? e.threads.some((e) => e.name === r) || Object.hasOwn(e.thread_episodes, r) ? !0 : (e.active_threads ?? []).includes(r) : !1 : !1;
}
function Px(e, t) {
	return {
		name: e,
		session_id: t,
		created_at: "",
		updated_at: "",
		episode_count: 0,
		latest_action: null
	};
}
function Fx(e) {
	let t = /* @__PURE__ */ new Map();
	if (!e?.length) return t;
	for (let n = e.length - 1; n >= 0; --n) {
		let r = e[n];
		if (r.role !== "assistant") continue;
		let i = (r.tool_calls ?? []).filter((e) => e.function?.name === "thread");
		if (i.length) {
			Ab(i).forEach((e, n) => {
				for (let r of e) t.set(Db(r), n);
			});
			break;
		}
	}
	return t;
}
var Ix = si(function({ entry: e, running: t }) {
	let n = e.status === "pending" && t;
	return /* @__PURE__ */ X("div", {
		className: "pt-1",
		children: [/* @__PURE__ */ Y("p", {
			className: P("code code-small whitespace-pre-wrap break-words", n ? "text-shimmer-basic" : "text-basic-tertiary"),
			children: n ? /* @__PURE__ */ X(J, { children: [
				"▸ ",
				`${e.toolName}: `,
				e.keyArg
			] }) : /* @__PURE__ */ X(J, { children: [
				/* @__PURE__ */ Y("span", {
					className: "text-info-primary",
					children: "▸ "
				}),
				/* @__PURE__ */ Y("span", {
					className: "text-basic-primary",
					children: `${e.toolName}: `
				}),
				e.keyArg
			] })
		}), e.resultPreview === null ? null : /* @__PURE__ */ X("p", {
			className: "pl-4 pt-0.5 code code-small whitespace-pre-wrap break-words text-basic-tertiary",
			children: [/* @__PURE__ */ Y("span", {
				className: e.isError ? "text-error-primary" : "text-success-primary",
				children: `${e.isError ? "✕" : "✓"} `
			}), e.resultPreview]
		})]
	});
}), Lx = si(function({ entry: e }) {
	return /* @__PURE__ */ X("p", {
		className: "pt-1 code code-small whitespace-pre-wrap break-words text-basic-tertiary",
		children: [
			e.mark ? /* @__PURE__ */ Y("span", {
				className: e.isError ? "text-error-primary" : "text-success-primary",
				children: `${e.mark} `
			}) : null,
			e.name ? /* @__PURE__ */ Y("span", {
				className: "text-basic-primary",
				children: `${e.name}: `
			}) : null,
			e.body
		]
	});
}), Rx = si(function({ entry: e, running: t }) {
	return e.kind === "tool_call" ? /* @__PURE__ */ Y(Ix, {
		entry: e,
		running: t
	}) : /* @__PURE__ */ Y(Lx, { entry: e });
}), zx = {
	error: {
		label: "Failed",
		color: Fi.Red
	},
	timed_out: {
		label: "Timed out",
		color: Fi.Yellow
	},
	cancelled: {
		label: "Cancelled",
		color: Fi.Yellow
	}
};
function Bx({ episode: e, index: t }) {
	let [n, r] = q(!1), i = Le(), a = zx[e.status], o = i ? "label-small" : "label-micro";
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col items-start w-full",
		children: [/* @__PURE__ */ X("button", {
			type: "button",
			className: "group flex items-center gap-2 w-full py-3 pl-1 pr-3 md:py-2 md:pl-3 md:pr-2 rounded-[4px] btn-ghost",
			"aria-expanded": n,
			onClick: () => r((e) => !e),
			children: [
				/* @__PURE__ */ Y(B, {
					iconName: n ? V.Down : V.Right,
					size: 16,
					className: "shrink-0 text-basic-muted"
				}),
				/* @__PURE__ */ Y("span", {
					className: `shrink-0 ${o} text-basic-primary`,
					children: `Episode ${t + 1}`
				}),
				a ? /* @__PURE__ */ Y(Li, {
					text: a.label,
					color: a.color,
					className: "shrink-0"
				}) : null
			]
		}), /* @__PURE__ */ Y(oo, {
			isOpen: n,
			className: "w-full",
			children: /* @__PURE__ */ Y("div", {
				className: "flex flex-col pl-1 pr-1 md:pl-3 md:pr-2 pt-2 pb-6",
				children: e.content.trim() ? /* @__PURE__ */ Y(Oy, {
					className: "text-basic-primary",
					children: e.content
				}) : /* @__PURE__ */ Y("p", {
					className: "label-small text-basic-muted",
					children: a ? "The dispatch ended before the thread answered." : "The thread answered with nothing."
				})
			})
		})]
	});
}
var Vx = {
	pending: 0,
	running: 1,
	done: 2
};
function Hx({ scrollRef: e, stuckRef: t, entries: n, running: r, thinking: i, loading: a, className: o, historyControl: s }) {
	return /* @__PURE__ */ X("div", {
		ref: e,
		className: P("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0 bg-elevation-ground", o),
		onScroll: () => {
			let n = e.current;
			n && (t.current = qb(n) <= 60);
		},
		children: [s, /* @__PURE__ */ X("div", {
			className: "pb-[128px] md:pb-4",
			children: [
				n.map((e) => /* @__PURE__ */ Y(Rx, {
					entry: e,
					running: r
				}, e.kind === "tool_call" ? `call-${e.callId}` : e.key)),
				i ? /* @__PURE__ */ X("p", {
					className: "pt-1 code code-small",
					children: [/* @__PURE__ */ Y("span", {
						className: "text-info-primary",
						children: "▸ "
					}), /* @__PURE__ */ Y("span", {
						className: "text-shimmer-basic",
						children: "Working…"
					})]
				}) : null,
				!n.length && !i && (a || r) ? /* @__PURE__ */ Y("div", {
					role: "status",
					"aria-label": "Loading command log",
					className: "pt-4",
					children: /* @__PURE__ */ Y(Da, {
						rows: 3,
						rowClassName: "h-6"
					})
				}) : null,
				!n.length && !r && !a ? /* @__PURE__ */ Y("p", {
					className: "pt-4 code code-small text-basic-muted",
					children: "No commands recorded."
				}) : null
			]
		})]
	});
}
function Ux({ lines: e, running: t, hasOlder: n, loadingOlder: r, loadingInitial: i, historyError: a, onRetry: o, onLoadOlder: s, className: c }) {
	let l = K(null), u = K(null), d = K(!0), f = G(() => ln(e), [e]), p = G(() => mn(t, e), [t, e]), m = f[0]?.kind === "tool_call" ? `call-${f[0].callId}` : f[0]?.key ?? null;
	ui(() => {
		let e = l.current, t = u.current;
		e && t && e.firstKey !== m && (t.scrollTop = e.top + (t.scrollHeight - e.height), l.current = null);
	}, [m]), W(() => {
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
	return ui(() => {
		let e = u.current;
		e && d.current && Jb(e);
	}, [f.length, p]), /* @__PURE__ */ Y(Hx, {
		scrollRef: u,
		stuckRef: d,
		entries: f,
		running: t,
		thinking: p,
		loading: i,
		className: c,
		historyControl: n || a ? /* @__PURE__ */ X("div", {
			className: "flex items-center gap-2 pb-3",
			children: [n ? /* @__PURE__ */ Y(I, {
				size: z.Small,
				variant: H.Secondary,
				disabled: r,
				onClick: h,
				children: r ? "Loading…" : "Load older commands"
			}) : null, a ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y("span", {
				className: "text-micro text-error-primary",
				children: a
			}), /* @__PURE__ */ Y(I, {
				size: z.Small,
				variant: H.Ghost,
				onClick: () => {
					n ? h() : o();
				},
				children: "Try again"
			})] }) : null]
		}) : null
	});
}
function Wx({ episodes: e, running: t, className: n }) {
	return e.length ? /* @__PURE__ */ Y("div", {
		className: P("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", n),
		children: /* @__PURE__ */ Y("div", {
			className: "pb-[128px] md:pb-4 flex flex-col",
			children: e.map((e, t) => /* @__PURE__ */ X("div", {
				className: "flex flex-col",
				children: [t > 0 ? /* @__PURE__ */ Y($l, {}) : null, /* @__PURE__ */ Y(Bx, {
					episode: e,
					index: t
				})]
			}, e.id))
		})
	}) : /* @__PURE__ */ Y("div", {
		className: P("flex flex-1 min-h-0", n),
		children: /* @__PURE__ */ Y("p", {
			className: "p-4 max-w-prose label-small text-basic-muted",
			children: t ? "An episode records one dispatch — what the thread was asked to do and what came back. This one is written when the dispatch ends; until then the Command Log is the live view." : "This thread has not been dispatched yet, so it has no episodes."
		})
	});
}
var Gx = {
	log: "Command Log",
	overview: "Episodes"
}, Kx = ["log", "overview"];
function qx({ view: e, action: t, canSteer: n, onSteer: r, onChange: i }) {
	return /* @__PURE__ */ X("div", {
		className: "absolute inset-x-0 top-0 flex items-center gap-2 overflow-x-auto overscroll-x-contain p-2",
		role: "toolbar",
		"aria-label": "Thread controls",
		children: [
			Kx.map((t) => /* @__PURE__ */ Y("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ Y(I, {
					className: "w-full",
					size: z.Medium,
					variant: e === t ? H.Primary : H.Secondary,
					"aria-pressed": e === t,
					onClick: () => i(t),
					children: Gx[t]
				})
			}, t)),
			t ? /* @__PURE__ */ Y("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ Y(Ax, { action: t })
			}) : null,
			n ? /* @__PURE__ */ Y("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ Y(I, {
					size: z.Medium,
					variant: H.Secondary,
					onClick: r,
					children: "Steer"
				})
			}) : null
		]
	});
}
function Jx({ view: e, onChange: t }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 shrink-0",
		role: "tablist",
		"aria-label": "Thread detail view",
		children: Kx.map((n) => /* @__PURE__ */ Y(I, {
			size: z.Small,
			variant: e === n ? H.Primary : H.Secondary,
			className: "!rounded-full",
			"aria-pressed": e === n,
			onClick: () => t(n),
			children: Gx[n]
		}, n))
	});
}
function Yx({ view: e, onChange: t }) {
	return /* @__PURE__ */ Y(ql, {
		size: z.Small,
		variant: H.Secondary,
		value: e,
		items: Kx.map((e) => ({
			id: e,
			label: Gx[e]
		})),
		onValueChange: (e) => t(e)
	});
}
function Xx({ thread: e, action: t, episodes: n, events: r, liveLog: i, running: a, hasOlder: o, loadingOlder: s, loadingInitial: c, historyError: l, onLoadOlder: u, onRetry: d, view: f, canSteer: p, onSteer: m, onViewChange: h }) {
	let g = Le(), _ = In(), v = G(() => Wn(yn(r), i), [r, i]), y = g ? "pt-14" : void 0, b = f === "log" ? /* @__PURE__ */ Y(Ux, {
		lines: v,
		running: a,
		hasOlder: o,
		loadingInitial: c,
		loadingOlder: s,
		historyError: l,
		onLoadOlder: u,
		onRetry: d,
		className: y
	}) : /* @__PURE__ */ Y(Wx, {
		episodes: n,
		running: a,
		className: y
	});
	return g || _ ? /* @__PURE__ */ X("div", {
		className: "relative flex flex-col flex-1 min-h-0 min-w-0",
		children: [b, g ? /* @__PURE__ */ Y(qx, {
			view: f,
			action: t,
			canSteer: p,
			onSteer: m,
			onChange: h
		}) : null]
	}) : /* @__PURE__ */ X("div", {
		className: "flex flex-col flex-1 min-h-0 min-w-0",
		children: [/* @__PURE__ */ X("div", {
			className: "flex items-center gap-2 h-14 px-4 shrink-0 border-b border-muted bg-elevation-ground",
			children: [
				/* @__PURE__ */ X("div", {
					className: "flex flex-col flex-1 min-w-0 justify-center",
					children: [/* @__PURE__ */ X("div", {
						className: "flex items-center gap-3 min-w-0",
						children: [/* @__PURE__ */ Y("span", {
							className: P("label-small truncate", a ? "text-shimmer-basic" : "text-basic-primary"),
							children: e.name
						}), t ? /* @__PURE__ */ Y(kx, { action: t }) : null]
					}), /* @__PURE__ */ Y("span", {
						className: "code code-micro text-basic-muted truncate",
						children: e.updated_at
					})]
				}),
				p ? /* @__PURE__ */ Y(I, {
					size: z.Small,
					variant: H.Secondary,
					onClick: m,
					children: "Steer"
				}) : null,
				/* @__PURE__ */ Y(Jx, {
					view: f,
					onChange: h
				}),
				/* @__PURE__ */ X("span", {
					className: "shrink-0 text-micro text-basic-muted",
					children: [n.length, " ep"]
				})
			]
		}), b]
	});
}
function Zx({ snapshot: e, selected: t, onSelect: r, canSteerWorkers: i }) {
	let { setSelectedThreadRunning: a } = n().stores.sessionLayoutStore, { useStreamStatus: o, useLiveThreads: s } = n().stores.runtimeStore, c = s(), l = o(), [u, d] = q("log"), [p, m] = q(null), h = G(() => e?.threads ?? [], [e]), g = e?.active_threads, _ = e?.metadata.session_id ?? "", v = G(() => Fx(e?.messages), [e?.messages]), y = G(() => Ob(e?.messages ?? []), [e?.messages]), b = G(() => Mb(e?.messages ?? []), [e?.messages]), x = G(() => {
		let t = /* @__PURE__ */ new Set();
		for (let n of e?.messages ?? []) if (n.role === "assistant") for (let e of n.tool_calls ?? []) e.function?.name === "thread" && t.add(Db(e));
		return t;
	}, [e?.messages]), S = l === "connecting" || l === "reconnecting", { runningNames: C, pendingNames: w } = G(() => {
		let e = /* @__PURE__ */ new Set(), t = /* @__PURE__ */ new Set();
		for (let n of g ?? []) {
			let r = c[n];
			r?.status === "running" ? e.add(n) : r?.status === "finished" || (S ? e.add(n) : t.add(n));
		}
		for (let [n, r] of Object.entries(c)) r.status === "running" ? (e.add(n), t.delete(n)) : r.status === "finished" && (e.delete(n), t.delete(n));
		return {
			runningNames: e,
			pendingNames: t
		};
	}, [
		g,
		c,
		S
	]), T = G(() => {
		let n = new Set(h.map((e) => e.name)), r = /* @__PURE__ */ new Set();
		for (let e of x) n.has(e) || r.add(e);
		t && !n.has(t) && Nx(e, x, c, t) && r.add(t);
		for (let e of C) n.has(e) || r.add(e);
		for (let e of w) n.has(e) || r.add(e);
		for (let [e, t] of Object.entries(c)) t.status === "finished" && !n.has(e) && r.add(e);
		let i = [...h, ...[...r].map((e) => Px(e, _))], a = (e) => w.has(e) ? "pending" : C.has(e) ? "running" : "done";
		return i.sort((e, t) => {
			let n = Vx[a(e.name)] - Vx[a(t.name)];
			if (n !== 0) return n;
			let r = (v.get(t.name) ?? -1) - (v.get(e.name) ?? -1);
			return r === 0 ? 0 : r;
		});
	}, [
		h,
		x,
		t,
		C,
		w,
		c,
		_,
		e,
		v
	]), E = G(() => T.filter((e) => !w.has(e.name)), [T, w]), D = T.find((e) => e.name === t) ?? E[0] ?? T[0] ?? null, { visible: O, hasMore: k, sentinelRef: A } = Ex(T, {
		key: _,
		atLeast: (D ? T.findIndex((e) => e.name === D.name) : -1) + 1
	}), j = D ? c[D.name] : void 0, ee = D && (y[D.name] || D.latest_action) || "", M = D?.name ?? null, te = !!(M && C.has(M)), ne = i && j?.status === "running", N = It(e ? _ : null, M), re = G(() => N.data ? ar(N.data.pages) : void 0, [N.data]);
	return W(() => {
		M && t !== M && (t && T.some((e) => e.name === t) || r(M));
	}, [
		t,
		M,
		T,
		r
	]), W(() => {}, [
		t,
		T,
		x,
		c,
		e,
		_,
		h
	]), W(() => (a(te), () => a(!1)), [te, a]), e ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(Wv, {
		listTitle: "Threads",
		title: D?.name,
		titleAction: ee ? /* @__PURE__ */ Y(kx, { action: ee }) : null,
		actions: D ? /* @__PURE__ */ X("div", {
			className: "flex items-center gap-2",
			children: [ne ? /* @__PURE__ */ Y(I, {
				size: z.Small,
				variant: H.Secondary,
				onClick: () => m(D.name),
				children: "Steer"
			}) : null, /* @__PURE__ */ Y(Yx, {
				view: u,
				onChange: d
			})]
		}) : null,
		list: T.length === 0 ? /* @__PURE__ */ X("div", {
			className: "flex flex-col px-2 pb-4 pt-2 text-micro",
			children: [/* @__PURE__ */ Y("p", {
				className: "text-basic-tertiary",
				children: "No threads yet."
			}), /* @__PURE__ */ Y("p", {
				className: "text-basic-muted",
				children: "Start a conversation to create one."
			})]
		}) : /* @__PURE__ */ X(J, { children: [O.map((t) => {
			let n = w.has(t.name), i = C.has(t.name), a = c[t.name], o = e.thread_episodes?.[t.name]?.at(-1), s = e.thread_episodes?.[t.name]?.length ?? t.episode_count, l = !!a?.cancelled || b.has(t.name) || o?.status === "cancelled" || !i && !n && s === 0, u = a?.isError, d = y[t.name] || t.latest_action || "";
			return /* @__PURE__ */ Y(Gv, {
				label: t.name,
				active: t.name === D?.name,
				disabled: n,
				title: n ? "Waiting on source threads" : d || void 0,
				icon: n ? /* @__PURE__ */ Y(B, {
					iconName: V.Timelaps,
					size: 16,
					className: "shrink-0 [&>path]:!fill-basic-muted"
				}) : i ? /* @__PURE__ */ Y(f, {
					size: mt.XSmall,
					variant: se.Neutral
				}) : l ? /* @__PURE__ */ Y(B, {
					iconName: V.Close,
					size: 16,
					className: "shrink-0 [&>path]:!fill-basic-muted"
				}) : /* @__PURE__ */ Y(B, {
					iconName: u ? V.Danger : V.CheckCircle,
					size: 16,
					className: P("shrink-0", u && "text-error-primary")
				}),
				trailing: /* @__PURE__ */ Y("span", {
					className: "code code-micro text-basic-muted shrink-0",
					children: e.thread_episodes?.[t.name]?.length ?? t.episode_count
				}),
				onClick: () => r(t.name)
			}, t.name);
		}), k ? /* @__PURE__ */ Y("div", {
			ref: A,
			"aria-hidden": !0,
			className: "h-px"
		}) : null] }),
		children: D ? /* @__PURE__ */ Y(Xx, {
			thread: D,
			action: ee,
			episodes: e.thread_episodes?.[D.name] ?? [],
			events: re ?? e.thread_events?.[D.name],
			liveLog: j?.log ?? [],
			running: C.has(D.name),
			hasOlder: !!N.hasNextPage,
			loadingOlder: N.isFetchingNextPage,
			loadingInitial: N.isPending,
			historyError: N.error instanceof Error ? N.error.message : null,
			onLoadOlder: async () => {
				await N.fetchNextPage();
			},
			onRetry: async () => {
				N.data ? await N.fetchNextPage() : await N.refetch();
			},
			view: u,
			canSteer: ne,
			onSteer: () => m(D.name),
			onViewChange: d
		}, `${_}:${D.name}`) : /* @__PURE__ */ Y(qv, {
			title: "No thread selected",
			children: "Threads contain conversations, command output, and file changes for each task. Select a thread to view its details."
		})
	}), p ? /* @__PURE__ */ Y(Mx, {
		sessionId: _,
		threadName: p,
		onClose: () => m(null)
	}) : null] }) : /* @__PURE__ */ Y(Kv, { listTitle: "Threads" });
}
// src/app/components/inspector/WorksetsView.tsx
var Qx = {
	done: "text-success-primary",
	completed: "text-success-primary",
	finished: "text-success-primary",
	active: "text-info-primary",
	running: "text-info-primary",
	in_progress: "text-info-primary",
	blocked: "text-error-primary",
	failed: "text-error-primary"
}, $x = (e) => Qx[e.toLowerCase()] ?? "text-basic-secondary";
function eS({ label: e, children: t }) {
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-1",
		children: [/* @__PURE__ */ Y("span", {
			className: "tag-label text-basic-muted",
			children: e
		}), t]
	});
}
function tS({ item: e }) {
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-4 p-4 rounded-[8px] border border-muted bg-elevation-ground",
		children: [
			e.role ? /* @__PURE__ */ Y(Li, {
				text: e.role,
				color: Fi.Blue,
				className: "self-start"
			}) : null,
			/* @__PURE__ */ X("div", {
				className: "flex flex-col gap-1",
				children: [
					/* @__PURE__ */ Y("span", {
						className: "header-small text-basic-primary",
						children: e.title
					}),
					e.scope ? /* @__PURE__ */ Y("span", {
						className: "code code-small text-danger-primary break-words",
						children: e.scope
					}) : null,
					e.description ? /* @__PURE__ */ Y("p", {
						className: "text-small text-basic-secondary",
						children: e.description
					}) : null
				]
			}),
			e.acceptance ? /* @__PURE__ */ Y(eS, {
				label: "Acceptance",
				children: /* @__PURE__ */ Y("p", {
					className: "text-small text-basic-secondary",
					children: e.acceptance
				})
			}) : null,
			e.depends_on.length > 0 ? /* @__PURE__ */ Y(eS, {
				label: "Depends on",
				children: /* @__PURE__ */ Y("span", {
					className: "code code-small text-basic-tertiary",
					children: e.depends_on.join(", ")
				})
			}) : null,
			e.notes ? /* @__PURE__ */ Y("p", {
				className: "text-small text-basic-muted italic",
				children: e.notes
			}) : null
		]
	});
}
function nS({ workset: e }) {
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-6 flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0",
		children: [
			/* @__PURE__ */ Y(eS, {
				label: "ID",
				children: /* @__PURE__ */ Y("span", {
					className: "header-medium text-basic-primary break-words",
					children: e.id
				})
			}),
			e.goal ? /* @__PURE__ */ Y(eS, {
				label: "Goal",
				children: /* @__PURE__ */ Y("p", {
					className: "paragraph-small text-basic-primary",
					children: e.goal
				})
			}) : null,
			e.status ? /* @__PURE__ */ Y(eS, {
				label: "Status",
				children: /* @__PURE__ */ Y("span", {
					className: P("code code-medium", $x(e.status)),
					children: e.status
				})
			}) : null,
			e.summary ? /* @__PURE__ */ Y(eS, {
				label: "Summary",
				children: /* @__PURE__ */ Y("p", {
					className: "paragraph-small text-basic-primary",
					children: e.summary
				})
			}) : null,
			e.verification_recipe ? /* @__PURE__ */ Y(eS, {
				label: "Verification recipe",
				children: /* @__PURE__ */ Y("p", {
					className: "paragraph-small text-basic-primary whitespace-pre-wrap",
					children: e.verification_recipe
				})
			}) : null,
			e.items.length > 0 ? /* @__PURE__ */ Y(eS, {
				label: "Workset items",
				children: /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-2 pt-1",
					children: e.items.map((e) => /* @__PURE__ */ Y(tS, { item: e }, e.position))
				})
			}) : null
		]
	});
}
function rS({ snapshot: e, selected: t, onSelect: n }) {
	if (!e) return /* @__PURE__ */ Y(Kv, { listTitle: "Worksets" });
	let r = e.worksets;
	if (r.error) return /* @__PURE__ */ Y("div", {
		className: "p-6 label-small text-error-primary",
		children: r.error
	});
	let i = r.items.find((e) => e.id === t) ?? r.items[0] ?? null;
	return /* @__PURE__ */ Y(Wv, {
		listTitle: "Worksets",
		title: i?.id,
		list: r.items.length === 0 ? /* @__PURE__ */ Y("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "No worksets defined for this session."
		}) : r.items.map((e) => /* @__PURE__ */ Y(Gv, {
			label: e.id,
			active: e.id === i?.id,
			trailing: /* @__PURE__ */ Y("span", {
				className: "code code-micro text-basic-muted shrink-0",
				children: e.items.length
			}),
			onClick: () => n(e.id)
		}, e.id)),
		children: i ? /* @__PURE__ */ Y(nS, { workset: i }) : /* @__PURE__ */ Y(qv, { children: "No worksets defined for this session." })
	});
}
// src/app/hooks/useSessionFetching.ts
var iS = 150, aS = 500;
function oS(e) {
	let t = mi({ queryKey: Xt.sessionRoot(e) }) > 0, [n, r] = q(!1), i = K(0);
	return W(() => {
		if (t) {
			if (n) return;
			let e = window.setTimeout(() => {
				i.current = Date.now(), r(!0);
			}, iS);
			return () => clearTimeout(e);
		}
		if (!n) return;
		let e = aS - (Date.now() - i.current), a = window.setTimeout(() => r(!1), Math.max(0, e));
		return () => clearTimeout(a);
	}, [t, n]), n;
}
// src/app/components/inspector/SessionSideBox.tsx
function sS({ sessionId: e }) {
	let t = oS(e);
	return /* @__PURE__ */ Y(rl, {
		active: t,
		className: "absolute bottom-[-1px] left-0 right-0 z-[1]"
	});
}
function cS({ sessionId: e, snapshot: t, behavior: r, panel: i, onPanelChange: a }) {
	let { useSidePanelExpanded: o, useSelectedWorkset: s, useSelectedThread: c, useSelectedRevision: l, toggleSidePanelExpanded: u, toggleSidePanelCollapsed: d, showSidePanelList: f, selectWorkset: p, selectThread: m, selectRevision: h } = n().stores.sessionLayoutStore, g = o(), _ = Le(), v = c(), y = s(), b = l(), x = r === void 0 ? t?.metadata.behavior ?? "orchestrator" : r, S = x === "direct" || x === "direct-with-orchestrator", C = x == null ? null : pa(x, t?.lineage?.kind), w = C?.readOnly ?? !1, T = C?.widePanels ?? [], E = fr(), D = T.includes("delegated"), O = Dt(e, D), k = ht(e, D && x === "direct-with-orchestrator"), A = (O.data?.length ?? 0) + (E.orchestrationEnabled ? k.data?.length ?? 0 : 0), j = C == null ? null : T.includes(i) || _ && C.mobilePanels.includes(i) ? i : C.defaultPanel, ee = /* @__PURE__ */ X(J, { children: [
		j === "files" ? /* @__PURE__ */ Y(xy, {
			sessionId: e,
			snapshot: t,
			revision: b,
			readOnly: w
		}) : null,
		j === "delegated" && S && !w ? /* @__PURE__ */ Y(vx, {
			sessionId: e,
			behavior: x
		}) : null,
		j === "terminal" && S && !w ? /* @__PURE__ */ Y(Rv, { sessionId: e }) : null,
		j === "worksets" ? /* @__PURE__ */ Y(rS, {
			snapshot: t,
			selected: y,
			onSelect: p
		}) : null,
		j === "threads" ? /* @__PURE__ */ Y(Zx, {
			snapshot: t,
			selected: v,
			onSelect: m,
			canSteerWorkers: x === "orchestrator" && !w
		}) : null,
		j === "history" ? /* @__PURE__ */ Y(Cx, {
			sessionId: e,
			selected: b,
			onSelect: h
		}) : null
	] });
	return _ ? /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-h-0",
		children: ee
	}) : /* @__PURE__ */ X("div", {
		className: P("flex flex-col min-h-0 h-full overflow-hidden bg-elevation-ground", g ? null : "border-l border-tertiary"),
		children: [/* @__PURE__ */ X("div", {
			className: P("flex items-center gap-4 pl-2 pr-2 py-2 shrink-0 bg-elevation-ground relative border-b border-muted", g ? "pr-10" : null),
			children: [
				/* @__PURE__ */ Y(sS, { sessionId: e }),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-1 min-w-0 items-center gap-2",
					role: "tablist",
					children: T.map((e) => {
						let n = j === e, r = z_(e, A, t?.worksets?.items.length ?? 0);
						return /* @__PURE__ */ X("span", {
							className: "relative shrink-0",
							children: [/* @__PURE__ */ Y(zc, {
								size: Lc.Medium,
								active: n,
								iconName: R_[e],
								role: "tab",
								"aria-selected": n,
								"aria-label": yr[e],
								onClick: () => {
									f(!1), a(e);
								},
								children: yr[e]
							}), r > 0 ? /* @__PURE__ */ Y(L_, { count: r }) : null]
						}, e);
					})
				}),
				g ? null : /* @__PURE__ */ X("div", {
					className: "flex items-center gap-2 pb-[2px] shrink-0",
					children: [/* @__PURE__ */ Y(Ir, {
						title: "Expand panel",
						position: R.BottomLeft,
						children: /* @__PURE__ */ Y(I, {
							size: z.Medium,
							variant: H.Ghost,
							content: L.Icon,
							"aria-label": "Expand panel",
							onClick: u,
							children: /* @__PURE__ */ Y(B, { iconName: V.FullScreen })
						})
					}), /* @__PURE__ */ Y(Ir, {
						title: "Hide panel",
						position: R.BottomLeft,
						children: /* @__PURE__ */ Y(I, {
							size: z.Medium,
							variant: H.Ghost,
							content: L.Icon,
							"aria-label": "Hide panel",
							onClick: d,
							children: /* @__PURE__ */ Y(B, { iconName: V.SidebarChevronRight })
						})
					})]
				})
			]
		}), /* @__PURE__ */ Y("div", {
			className: "flex-1 min-h-0 flex flex-col",
			children: ee
		})]
	});
}
// src/app/features/human-shell/CommandCard.tsx
function lS({ sessionId: e, command: t, readOnly: r = !1 }) {
	let { draftPrompt: i } = n().stores.composerStore, [a, o] = q(!1), [s, c] = q(0), l = Ag(e, t.request_id, s, a), u = kg(e), d = t.state === "accepted" || t.state === "started";
	return /* @__PURE__ */ X("article", {
		"aria-label": "User command",
		className: "my-3 rounded-xl border border-border-primary bg-bg-elevation-level-1 p-4",
		children: [
			/* @__PURE__ */ X("div", {
				className: "flex flex-wrap items-center justify-between gap-2 text-sm",
				children: [/* @__PURE__ */ Y("strong", { children: "Run by you" }), /* @__PURE__ */ X("span", {
					role: "status",
					children: [t.state.replaceAll("_", " "), t.exit_code == null ? "" : ` · exit ${t.exit_code}`]
				})]
			}),
			/* @__PURE__ */ Y("pre", {
				className: "mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm",
				children: `!${t.command}`
			}),
			t.stdout ? /* @__PURE__ */ Y("pre", {
				className: "mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm",
				children: t.stdout
			}) : null,
			t.stderr ? /* @__PURE__ */ Y("pre", {
				className: "mt-2 overflow-x-auto whitespace-pre-wrap break-words text-sm",
				children: t.stderr
			}) : null,
			t.diagnostic ? /* @__PURE__ */ Y("p", {
				className: "mt-2 text-sm",
				children: t.diagnostic
			}) : null,
			/* @__PURE__ */ X("div", {
				className: "mt-3 flex flex-wrap gap-4 text-sm",
				children: [
					d && !r ? /* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						variant: H.Ghost,
						disabled: u.isPending,
						onClick: () => u.mutate(t.request_id),
						children: "Cancel command"
					}) : null,
					!d && t.output_id ? /* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						variant: H.Ghost,
						onClick: () => o((e) => !e),
						children: a ? "Hide output" : "Full output"
					}) : null,
					!d && !r ? /* @__PURE__ */ Y(I, {
						type: "button",
						size: z.Small,
						variant: H.Ghost,
						onClick: () => i(e, `Explain the result of my command ${t.request_id}:\n!${t.command}`),
						children: "Ask about this"
					}) : null
				]
			}),
			u.error ? /* @__PURE__ */ Y("p", {
				role: "alert",
				children: "Unable to cancel this command."
			}) : null,
			a ? /* @__PURE__ */ X("div", {
				className: "mt-3",
				children: [
					l.isPending ? /* @__PURE__ */ Y("p", { children: "Loading output…" }) : null,
					l.error ? /* @__PURE__ */ Y("p", {
						role: "status",
						children: "Full output is no longer retained."
					}) : null,
					l.data ? /* @__PURE__ */ X(J, { children: [
						l.data.overflowed ? /* @__PURE__ */ Y("p", { children: "Only retained output is available." }) : null,
						/* @__PURE__ */ Y("pre", {
							className: "overflow-x-auto whitespace-pre-wrap break-words text-sm",
							children: l.data.content
						}),
						/* @__PURE__ */ X("div", {
							className: "mt-2 flex gap-4",
							children: [s > 0 ? /* @__PURE__ */ Y(I, {
								type: "button",
								size: z.Small,
								variant: H.Ghost,
								onClick: () => c(0),
								children: "Start"
							}) : null, l.data.eof ? null : /* @__PURE__ */ Y(I, {
								type: "button",
								size: z.Small,
								variant: H.Ghost,
								onClick: () => c(l.data.next_offset),
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
var uS = [
	{
		icon: V.FolderOpen,
		title: "Explore this repository",
		prompt: "Understand the project structure, key components, and how they work together."
	},
	{
		icon: V.Eye,
		title: "Review current changes",
		prompt: "Review the working tree for bugs, regressions, and opportunities to simplify the code."
	},
	{
		icon: V.SearchPage,
		title: "Find something to improve",
		prompt: "Identify one meaningful improvement, explain its impact, and propose an implementation plan."
	},
	{
		icon: V.Bolt,
		title: "Help me get started",
		prompt: "Read the project documentation and suggest the best first task based on the current repository state"
	}
];
function dS() {
	let { sendPrompt: e } = n().stores.composerStore;
	return /* @__PURE__ */ X("div", {
		className: "flex flex-1 flex-col justify-center gap-2",
		children: [/* @__PURE__ */ Y("p", {
			className: "text-[10px] leading-[12px] font-medium uppercase text-input-placeholder",
			children: "Get started"
		}), /* @__PURE__ */ Y("div", {
			className: "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]",
			children: uS.map((t) => /* @__PURE__ */ Y(Bc, {
				icon: t.icon,
				title: t.title,
				description: t.prompt,
				onClick: () => e(t.prompt)
			}, t.title))
		})]
	});
}
// src/app/features/managed/controller/useLoginUsability.ts
var fS = 1e4;
function pS(e, t) {
	let n = e ? br(e) : null, r = t !== null && n !== null, i = Un(r, r ? fS : !1), a = i.data?.providers.find((e) => e.provider === n), o = a?.signed_in ? `${a.expires_at_ms ?? ""}:${a.account ?? ""}` : null, s = Ht(a?.backend ?? null, r ? t : null, o);
	return !r || i.isError || i.data != null && o === null || s.isError ? "unusable" : s.isSuccess ? "usable" : "unknown";
}
// src/app/lib/runFailure.ts
function mS(e, t, n, r) {
	return e.recovery_action === "resume_goal" ? t?.status === "blocked" ? "resume_goal" : null : e.recovery_action === "settings" ? !r || e.kind !== "authentication" ? "settings" : r === "checking" ? null : r === "needed" ? "sign_in" : t?.status === "blocked" ? "resume_goal" : n ? "regenerate" : null : e.recovery_action === "regenerate_with_rewind" && n ? "regenerate" : null;
}
// src/app/components/inspector/RunFailureRecovery.tsx
var hS = {
	unusable: "needed",
	usable: "restored"
};
function gS({ failure: e, goal: t, backend: n, onResumeGoal: r, onOpenSettings: i, onRegenerate: a }) {
	let o = n !== null && br(n) !== null, s = e.kind === "authentication" ? `${e.summary}\n${e.diagnostic}` : null, c = pS(n, s), [l, u] = q(), d = c === "unknown" ? null : hS[c];
	d && (l?.refusal !== s || l.login !== d) && u({
		refusal: s,
		login: d
	});
	let f = d ?? (l?.refusal === s ? l.login : "checking"), p = mS(e, t, a !== null, o ? f : void 0);
	return /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(_S, {
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
	}), p === "sign_in" && n && Rt(n) ? /* @__PURE__ */ Y(Od, {
		backend: n,
		className: "mt-2",
		rejected: !0
	}) : null] });
}
function _S({ failure: e, goal: t, action: n }) {
	let r = e.recovery_action === "automatic_retry" && t?.status === "active", i = e.recovery_action === "resume_goal" && t?.status === "blocked", a = e.kind === "capacity", o = !!(e.partial_output?.text || e.partial_output?.reasoning || e.partial_output?.tool_call), s = a ? e.summary : r ? "Goal retry scheduled" : i ? "Goal stopped after repeated run failures" : o ? "Run stopped after a partial response" : e.summary, c = t?.next_attempt_at_epoch_ms ? new Date(t.next_attempt_at_epoch_ms).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit"
	}) : null, l = a ? "" : `${e.summary} `, u = r ? `${l}The durable goal and its usage were preserved. NAC will continue automatically${c ? ` at ${c}` : ""}.` : i ? `${l}The durable goal and its usage were preserved. Resume it when you want another bounded retry sequence.` : a ? `Retrying later may be necessary.${vS(e.retry_after_ms)}` : e.summary;
	return /* @__PURE__ */ X(Ca, {
		role: r ? "status" : "alert",
		variant: r ? ya.Info : ya.Danger,
		title: s,
		action: n,
		children: [/* @__PURE__ */ Y("span", { children: u }), /* @__PURE__ */ X("details", {
			className: "mt-2",
			children: [/* @__PURE__ */ Y("summary", {
				className: "cursor-pointer",
				children: "Diagnostics"
			}), /* @__PURE__ */ Y("pre", {
				className: "mt-1 whitespace-pre-wrap break-words font-mono text-xs",
				children: e.diagnostic
			})]
		})]
	});
}
function vS(e) {
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
function yS(e, t) {
	let n = t != null && Gu(t, e).fix?.kind === "login", r = pS(e, n ? bS(t) : null);
	return n && r !== "unusable";
}
function bS(e) {
	return e instanceof Error ? e.message : typeof e == "string" ? e : String(e.status);
}
// src/app/hooks/useErrorNotice.ts
function xS(e, t) {
	let n = kp(), { start: r } = Td(), i = t ? br(t) : null;
	return U((a, o) => {
		let { title: s, description: c, fix: l } = Gu(a, t);
		return {
			title: s,
			description: c,
			action: SS(l, {
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
function SS(e, t) {
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
function CS({ open: e, onClose: t, sessionId: n, messageIdx: r, prompt: i }) {
	let a = Cn(), o = Zt();
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: t,
		title: "Revert to this snapshot",
		size: dn.Small,
		footer: /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(I, {
			variant: H.Ghost,
			size: z.Large,
			content: L.Text,
			onClick: t,
			disabled: o.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ Y(I, {
			variant: H.SecondaryDestructive,
			size: z.Large,
			content: L.Text,
			onClick: async () => {
				if (!(r == null || o.isPending)) try {
					let e = await o.mutateAsync({
						id: n,
						messageIdx: r
					});
					a.success(e.workspace_restored ? "Reverted to this snapshot" : "Transcript reverted; no workspace snapshot covered this point"), t();
				} catch (e) {
					a.error(`Failed to revert: ${mr($(e))}`);
				}
			},
			loading: o.isPending,
			children: "Revert"
		})] }),
		children: /* @__PURE__ */ X("p", { children: [
			"This removes ",
			/* @__PURE__ */ X("span", {
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
}
// src/app/components/inspector/Transcript.tsx
function wS({ warning: e }) {
	return e ? /* @__PURE__ */ Y(Ca, {
		role: "status",
		variant: ya.Info,
		title: "Session recovered",
		children: e
	}) : null;
}
function TS(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		if (e[t]?.kind === "delegated-completion") return null;
		if (e[t]?.kind === "user") return t;
	}
	return null;
}
function ES(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function DS({ sessionId: e, snapshot: t, panel: r, onFocusPanel: i, errorNotice: a = null }) {
	let { useStreamText: o, useStreamReasoning: s, useModelRetryAttempt: c, useRunning: l, useRunFailure: u, useRunError: d, useOptimisticUserPrompt: f, useLiveThreads: p, useCancelArmed: m, usePrimaryToolEvents: h, useFinishedToolCalls: g, useActivity: _, setOptimisticUserPrompt: v, pushLocalEvent: y } = n().stores.runtimeStore, { useSelectedWorkset: b, useSelectedThreadEpisode: x, useSelectedRevision: S, useSelectedFile: C, selectWorkset: w, selectThread: T, selectRevision: E, selectFile: D } = n().stores.sessionLayoutStore, O = l(e), k = m(e), A = _(), j = d(), ee = u(), M = c(), te = p(), ne = g(), N = h(), ie = o(), ae = s(), oe = f(), se = x(), ce = b(), le = C(), F = S(), de = Cn(), fe = kp(), pe = Ti(), me = t?.metadata.backend ?? null, he = xS(e, me), ge = yS(me, j), _e = _n(), ve = Cr(), ye = Dn(), be = vr(), xe = Vt(e), { data: Ce } = Ue(e), we = t?.metadata.behavior === "direct" || t?.metadata.behavior === "direct-with-orchestrator", Te = ut(e, we), Ee = Ct(), { data: De } = re(e, we), Oe = G(() => new Set((De?.requests ?? []).map((e) => e.call_id).filter((e) => !!e)), [De?.requests]), { scrollRef: ke, contentRef: Ae, showJumpButton: je, jumpToLatest: Me, followLatest: Ne } = ax({ resetKey: e }), Pe = K(null), Fe = K(!1), Ie = K(!1), Re = t?.message_page?.start ?? 0;
	ui(() => {
		let e = Pe.current, t = ke.current;
		e && t && (t.scrollTop = e.top + (t.scrollHeight - e.height), Pe.current = null);
	}, [Re, ke]);
	let ze = U(() => {
		let e = ke.current;
		e && (Pe.current = {
			height: e.scrollHeight,
			top: e.scrollTop
		}), xe.mutateAsync().then((e) => {
			e || (Pe.current = null);
		}).catch(() => {
			Pe.current = null;
		});
	}, [xe, ke]);
	Se("Transcript");
	let Be = G(() => Je("buildTranscript", () => Lb(t, te, ne, N, Oe)), [
		t,
		te,
		ne,
		N,
		Oe
	]), Ve = O ? t?.active_run?.submitted_user_message : void 0, R = Ve ? Nt(Ve.content) : oe ?? "", He = Ve ? zr(Ve.content) : null, We = !!(R && ES(Be) !== R);
	ui(() => {
		Fe.current = !1, Ie.current = !1;
	}, [e]), W(() => {
		Ie.current = !0;
	}, [e]), ui(() => {
		let e = We && !Fe.current;
		Fe.current = We, e && Ie.current && Ne(300);
	}, [We, Ne]);
	let Ge = G(() => Ib(Be, {
		text: ie,
		reasoning: ae
	}, We), [
		Be,
		ie,
		ae,
		We
	]), Ke = We && Ge[Ge.length - 1]?.key === "model-streaming";
	ue("transcript:turns", {
		fields: {
			turns: Ge.length,
			streamChars: ie.length
		},
		throttleMs: 1e3
	});
	let qe = G(() => TS(Ge), [Ge]), Ye = O || k || _e.isPending || ve.isPending || ye.isPending, [Xe, Ze] = q(null), $e = ve.mutateAsync, et = U((t) => {
		Ye || (async () => {
			try {
				let n = await $e({
					id: e,
					messageIdx: t
				});
				y("run", `▶ regenerated: ${n.display_prompt.slice(0, 80)}`);
			} catch (e) {
				y("error", `regeneration failed: ${mr($(e))}`, !0), de.error(`Failed to regenerate: ${Ku($(e), me)}`);
			}
		})();
	}, [
		Ye,
		me,
		y,
		$e,
		e,
		de
	]), tt = ye.mutateAsync, nt = U((t) => {
		Ye || (async () => {
			try {
				let n = await tt({
					id: e,
					messageIdx: t
				});
				pe(kr.session(n.session_id));
			} catch (e) {
				de.error(`Failed to create fork: ${Ku($(e), me)}`);
			}
		})();
	}, [
		Ye,
		me,
		tt,
		pe,
		e,
		de
	]), rt = U((e) => {
		pe(kr.session(e));
	}, [pe]), it = be.mutate, at = U((t) => {
		it({
			id: e,
			forkId: t
		}, { onError: (e) => {
			de.error(`Failed to dismiss fork: ${Ku($(e), me)}`);
		} });
	}, [
		me,
		it,
		e,
		de
	]), ot = U((e, t) => {
		Ze({
			messageIdx: e,
			prompt: t
		});
	}, []), st = Le(), ct = t?.metadata.model ?? "", lt = t?.lineage != null, dt = G(() => xx(Ge, Ce), [Ge, Ce]);
	W(() => {
		!We && oe && v(null);
	}, [
		We,
		oe,
		v
	]);
	let ft = Ge[Ge.length - 1], pt = O && ft?.kind === "model" && (!We || ft.key === "model-streaming"), mt = (O || We) && !pt, ht = U((e, t) => {
		T(e, t), i("threads");
	}, [i, T]), gt = U((e) => {
		w(e), i("worksets");
	}, [i, w]), _t = U((e) => {
		E(e), i("files");
	}, [i, E]), vt = U((e, t) => {
		E(e), D(t), i("files");
	}, [
		i,
		D,
		E
	]), yt = G(() => ({
		sessionId: e,
		selectedFile: r === "files" ? le : null,
		selectedRevision: r === "files" ? F : null,
		onOpenFile: vt,
		onOpenPanel: _t
	}), [
		e,
		r,
		le,
		F,
		vt,
		_t
	]), bt = !(!t || Ge.length !== 0 || O || We), xt = j && !O ? j : null, St = O ? null : ee ?? t?.run_failure ?? Te.data?.last_failure ?? null, wt = [...Ge].reverse().find((e) => e.kind === "user"), Tt = () => {
		let t = Te.data;
		t && Ee.mutateAsync({
			sessionId: e,
			goalId: t.goal_id,
			payload: {
				expected_version: t.version,
				status: "active"
			}
		}).catch((e) => de.error(`Failed to resume goal: ${Ku($(e), me)}`));
	}, Et = St ? null : a ?? (xt && !ge ? he(xt) : null), Dt = cx(e, !!t || a !== null), Ot = Dt ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
	return /* @__PURE__ */ X("div", {
		className: "relative flex-1 min-h-0",
		children: [
			/* @__PURE__ */ Y("div", {
				role: "status",
				"aria-label": Dt ? void 0 : "Loading conversation",
				className: P("pointer-events-none absolute inset-x-0 top-[96px] px-4 transition-opacity duration-150 ease-in-out md:top-[72px] md:px-0", Dt ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ Y("div", {
					className: "mx-auto w-full max-w-[720px]",
					children: /* @__PURE__ */ Y(Da, {
						rows: 3,
						rowClassName: "h-[48px]"
					})
				})
			}),
			bt ? /* @__PURE__ */ Y("div", {
				className: P("absolute inset-x-0 top-[96px] flex overflow-auto px-4 md:top-[72px] md:px-0", st ? "bottom-[128px]" : "bottom-[136px]", Ot),
				children: /* @__PURE__ */ Y("div", {
					className: "m-auto w-full max-w-[720px]",
					children: /* @__PURE__ */ Y(dS, {})
				})
			}) : null,
			/* @__PURE__ */ Y("div", {
				ref: ke,
				className: P("h-full overflow-auto", Ot, !Dt && "invisible"),
				children: /* @__PURE__ */ X("div", {
					ref: Ae,
					className: P("flex flex-col pt-[96px] md:pt-[72px] [&>*]:shrink-0 px-4 md:px-0", st ? "pb-[180px]" : "pb-[320px] mx-auto max-w-[720px]"),
					children: [
						t?.message_page?.has_older ? /* @__PURE__ */ X("div", {
							className: "mb-4 flex flex-col items-start gap-2",
							children: [/* @__PURE__ */ Y(I, {
								variant: H.Ghost,
								size: z.Small,
								content: L.Text,
								disabled: xe.isPending,
								onClick: ze,
								children: xe.isPending ? "Loading…" : "Load older"
							}), xe.isError ? /* @__PURE__ */ X("div", {
								role: "alert",
								className: "flex items-center gap-2 text-basic-muted label-small",
								children: [/* @__PURE__ */ Y("span", { children: "Couldn’t load older messages." }), /* @__PURE__ */ Y(I, {
									variant: H.Ghost,
									size: z.Small,
									content: L.Text,
									onClick: ze,
									children: "Try again"
								})]
							}) : null]
						}) : null,
						/* @__PURE__ */ Y(wr, {
							id: "turns",
							children: Ge.map((n, i) => {
								if (n.kind === "delegated-completion") return /* @__PURE__ */ Y(Hb, { turn: n }, n.key);
								if (n.kind === "user") {
									let r = (t?.shell_commands ?? []).find((e) => e.transcript_index === n.messageIndex && n.text.startsWith("<human_shell_result>\n") && n.text.includes(`"operation_id":"${e.operation_id}"`));
									return r ? /* @__PURE__ */ Y(lS, {
										sessionId: e,
										command: r,
										readOnly: lt
									}, n.key) : /* @__PURE__ */ Y(Vb, {
										text: n.text,
										sessionId: e,
										terminalSelection: t?.terminal_selection_attributions?.find((e) => e.message_index === n.messageIndex)?.evidence ?? void 0,
										invokedSkills: n.invokedSkills,
										timestamp: n.createdAt ? Qe(n.createdAt) : null,
										messageIndex: n.messageIndex,
										actionsDisabled: Ye,
										readOnly: lt,
										onRefresh: !lt && qe === i ? et : null,
										onRevert: lt ? null : ot
									}, n.key);
								}
								let a = null, o = null;
								for (let e = i - 1; e >= 0; --e) {
									let t = Ge[e];
									if (t?.kind === "delegated-completion") break;
									if (t?.kind === "user") {
										a = e, o = t;
										break;
									}
								}
								let s = i === Ge.length - 1 && !(We && n.key !== "model-streaming"), c = /* @__PURE__ */ Y(Bb, {
									turn: n,
									model: ct,
									active: O && s,
									isLast: s && !mt,
									activity: O && s ? A : void 0,
									selectedThreadEpisode: r === "threads" ? se : null,
									selectedWorkset: r === "worksets" ? ce : null,
									onSelectThread: ht,
									onSelectWorkset: gt,
									userMessageIndex: o?.messageIndex,
									userText: o?.text,
									actionsDisabled: Ye,
									readOnly: lt,
									onRefresh: !lt && a != null && qe === a ? et : null,
									onRevert: lt ? null : ot,
									onFork: lt ? null : nt,
									forks: lt ? [] : (t?.forks ?? []).filter((e) => e.source_message_idx === n.messageIndex),
									onOpenFork: rt,
									onDismissFork: at,
									snapshotRevision: n.messageIndex == null ? null : dt.get(n.messageIndex) ?? null,
									filesPanel: yt
								}, n.key);
								return Ke && n.key === "model-streaming" ? /* @__PURE__ */ X(ri, { children: [/* @__PURE__ */ Y(Vb, {
									text: R,
									invokedSkills: He,
									pending: !0,
									sessionId: e,
									terminalSelection: Ve?.terminal_selection ?? void 0
								}), c] }, n.key) : c;
							})
						}),
						We && !Ke ? /* @__PURE__ */ Y(Vb, {
							text: R,
							invokedSkills: He,
							pending: !0,
							sessionId: e,
							terminalSelection: Ve?.terminal_selection ?? void 0
						}) : null,
						mt ? /* @__PURE__ */ Y(Bb, {
							turn: {
								kind: "model",
								key: "model-pending",
								blocks: [],
								durationMs: null,
								messageIndex: null
							},
							model: ct,
							active: !0,
							isLast: !0,
							selectedThreadEpisode: r === "threads" ? se : null,
							selectedWorkset: r === "worksets" ? ce : null,
							onSelectThread: ht,
							onSelectWorkset: gt
						}) : null,
						Et ? /* @__PURE__ */ Y(Ca, {
							role: "alert",
							variant: ya.Error,
							title: Et.title,
							action: Et.action,
							children: Et.description
						}) : null,
						O && M ? /* @__PURE__ */ Y(Ca, {
							role: "status",
							variant: ya.Info,
							title: `Connection interrupted; retrying model response (attempt ${M})`,
							children: "The abandoned partial stream was cleared before this attempt began."
						}) : null,
						St ? /* @__PURE__ */ Y(gS, {
							failure: St,
							goal: Te.data,
							backend: me,
							onResumeGoal: Tt,
							onOpenSettings: () => fe.settings(e),
							onRegenerate: wt?.kind === "user" ? () => et(wt.messageIndex) : null
						}) : null,
						(t?.shell_commands ?? []).filter((e) => e.state === "accepted" || e.state === "started").map((t) => /* @__PURE__ */ Y(lS, {
							sessionId: e,
							command: t,
							readOnly: lt
						}, t.operation_id)),
						/* @__PURE__ */ Y(wS, { warning: t?.transcript_recovery_warning })
					]
				})
			}),
			/* @__PURE__ */ Y("div", {
				className: `absolute z-[2] left-1/2 bottom-0 -translate-x-1/2 rounded-full  transition-all duration-150 ease-out ${je ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-75 opacity-0 pointer-events-none"}`,
				children: /* @__PURE__ */ X(I, {
					variant: H.Primary,
					size: z.Small,
					content: L.IconRight,
					className: "!rounded-b-none !shadow-3xl",
					onClick: Me,
					children: ["Last messages", /* @__PURE__ */ Y(B, { iconName: V.Down })]
				})
			}),
			/* @__PURE__ */ Y(CS, {
				open: Xe !== null,
				onClose: () => Ze(null),
				sessionId: e,
				messageIdx: Xe?.messageIdx ?? null,
				prompt: Xe?.prompt ?? ""
			})
		]
	});
}
// src/app/features/direct-session/RunDetails.tsx
function OS({ context: e, input: t, output: n, cost: r, elapsed: i }) {
	return /* @__PURE__ */ X("details", {
		className: "group relative shrink-0",
		children: [/* @__PURE__ */ Y("summary", {
			className: "label-micro cursor-pointer rounded px-2 py-1 text-basic-tertiary hover:text-basic-primary focus-visible:outline focus-visible:outline-2",
			children: "Run details"
		}), /* @__PURE__ */ X("dl", {
			className: "absolute right-0 top-full z-30 mt-1 grid w-52 grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-tertiary bg-elevation-level-3 p-3 text-micro shadow-xl",
			children: [
				/* @__PURE__ */ Y("dt", { children: "Context tokens" }),
				/* @__PURE__ */ Y("dd", {
					className: "text-right",
					children: e
				}),
				/* @__PURE__ */ Y("dt", { children: "Input tokens" }),
				/* @__PURE__ */ Y("dd", {
					className: "text-right",
					children: t
				}),
				/* @__PURE__ */ Y("dt", { children: "Output tokens" }),
				/* @__PURE__ */ Y("dd", {
					className: "text-right",
					children: n
				}),
				/* @__PURE__ */ Y("dt", { children: "Session cost" }),
				/* @__PURE__ */ Y("dd", {
					className: "text-right",
					children: r
				}),
				/* @__PURE__ */ Y("dt", { children: "Elapsed" }),
				/* @__PURE__ */ Y("dd", {
					className: "text-right",
					children: i
				})
			]
		})]
	});
}
// src/app/components/inspector/RevisionPicker.tsx
function kS({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ X("button", {
		type: "button",
		className: "flex items-start gap-2 w-full p-1 rounded-[4px] text-left btn-ghost",
		onClick: i,
		children: [
			/* @__PURE__ */ Y(B, {
				iconName: r ? V.Check : V.History,
				size: 16,
				className: "shrink-0 mt-[2px]"
			}),
			/* @__PURE__ */ X("span", {
				className: "flex-1 min-w-0 flex flex-col",
				children: [/* @__PURE__ */ Y("span", {
					className: "label-micro text-btn-secondary truncate",
					children: e
				}), t ? /* @__PURE__ */ Y("span", {
					className: "label-micro text-basic-muted truncate",
					children: t
				}) : null]
			}),
			n ? /* @__PURE__ */ Y("span", {
				className: "shrink-0 flex items-center gap-1 code code-small mt-[2px]",
				children: n
			}) : null
		]
	});
}
function AS({ sessionId: e, selected: t, onSelect: n, placement: r = R.TopRight }) {
	let [i, a] = q(!1), { data: o, isLoading: s, error: c } = Ue(e), l = o ?? [], u = (e) => bx(e, l.length), d = l.findIndex((e) => e.id === t), p = d >= 0 ? yx(u(d)) : "Working tree", m = (e) => {
		n(e), a(!1);
	};
	return /* @__PURE__ */ Y(Zr, {
		open: i,
		onClose: () => a(!1),
		placement: r,
		className: "min-w-0",
		content: /* @__PURE__ */ X(J, { children: [
			/* @__PURE__ */ Y(kS, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => m(null)
			}),
			s ? /* @__PURE__ */ X("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [/* @__PURE__ */ Y(f, {
					size: mt.Small,
					variant: se.Neutral
				}), "Reading snapshots…"]
			}) : null,
			c ? /* @__PURE__ */ Y("div", {
				className: "p-1 label-micro text-error-primary",
				children: mr(c)
			}) : null,
			!s && !c ? /* @__PURE__ */ X("div", {
				className: "flex flex-col gap-1 max-h-[280px] overflow-auto [&>*]:shrink-0",
				children: [l.map((e, n) => /* @__PURE__ */ Y(jS, {
					revision: e,
					ordinal: u(n),
					selected: e.id === t,
					onClick: () => m(e.id)
				}, e.id)), l.length === 0 ? /* @__PURE__ */ Y("div", {
					className: "p-1 label-micro text-basic-muted",
					children: "No snapshots yet. One is taken every time a run finishes."
				}) : null]
			}) : null
		] }),
		children: /* @__PURE__ */ X("button", {
			type: "button",
			className: P("flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost", t != null && "text-info-primary"),
			"aria-expanded": i,
			"aria-label": `Snapshot: ${p}`,
			onClick: () => a(!i),
			children: [/* @__PURE__ */ Y(B, {
				iconName: V.History,
				size: 16,
				className: "shrink-0"
			}), /* @__PURE__ */ Y("span", {
				className: "label-micro text-btn-secondary truncate max-w-[64px] xl:max-w-[128px]",
				children: p
			})]
		})
	});
}
function jS({ revision: e, ordinal: t, selected: n, onClick: r }) {
	let i = e.label.trim();
	return /* @__PURE__ */ Y(kS, {
		title: `${yx(t)} · ${Qe(e.created_at)}`,
		subtitle: i || null,
		selected: n,
		trailing: e.additions || e.deletions ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ X("span", {
			className: "text-success-primary",
			children: ["+", e.additions]
		}), /* @__PURE__ */ X("span", {
			className: "text-error-primary",
			children: ["-", e.deletions]
		})] }) : null,
		onClick: r
	});
}
// src/app/components/inspector/TopSingleSessionHeader.tsx
var MS = {
	direct: "Agent",
	"direct-with-orchestrator": "Agent + NAC",
	orchestrator: "Orchestrator"
};
function NS(e, t) {
	let n = t.contextWindow;
	return !n || e == null ? "Context tokens" : t.estimated ? `Context against ${t.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate` : `Context — ${Math.round(e / n * 100)}% of the model's context window`;
}
function PS({ iconName: e, value: t, title: n, className: r, labelClassName: i }) {
	return /* @__PURE__ */ Y(Ir, {
		title: n,
		position: R.BottomCenter,
		children: /* @__PURE__ */ X("div", {
			className: P("flex items-center gap-0.5 whitespace-nowrap", r),
			children: [/* @__PURE__ */ Y(B, {
				iconName: e,
				size: 14
			}), /* @__PURE__ */ Y("span", {
				className: i,
				children: t
			})]
		})
	});
}
function FS({ sessionId: e, snapshot: t, entry: r, onShowPanel: i }) {
	let { useSessionSpend: a, useRunning: o, useRunUsage: s, useRunStartedAt: c, useLastElapsedMs: l, useCancelArmed: u, liftSessionSpend: d } = n().stores.runtimeStore, { useSelectedRevision: f, selectRevision: p } = n().stores.sessionLayoutStore, m = Ti(), g = uu(), { data: _ = [] } = qr(), v = o(e), y = u(e), b = s(), x = a();
	W(() => {
		d(Ee(t));
	}, [d, t]);
	let S = Fe(t, r, v || y ? b : null, x), C = Gn(), w = Ee(t), T = S.usage?.total_tokens || w?.total_tokens || null, E = NS(T, cd(C.data, t?.metadata?.backend, S.model)), D = $t(1e3, v), O = c(), k = l(), A = (v && O != null ? Math.max(0, D - O) : null) ?? k ?? S.lastResponseMs, j = f(), ee = Ot(e, j), M = t?.workspace ?? null, te = j == null ? M : ee.data ?? {
		total_additions: 0,
		total_deletions: 0
	}, ne = te?.total_additions ?? 0, N = te?.total_deletions ?? 0, re = M?.repo_label ?? M?.workspace_display ?? null, ie = M?.branch ?? null, ae = r?.lineage ?? t?.lineage ?? null, oe = ae != null, se = ae?.kind === "traditional-child" ? "Traditional coding agent" : ae?.kind === "managed-orchestrator" ? "Managed NAC orchestrator" : null, ce = ae ? _.find((e) => e.summary.session_id === ae.parent_session_id) : void 0, le = ce ? g(ce.summary) : "Parent session", ue = () => {
		ae && m(kr.session(ae.parent_session_id, "delegated"));
	}, F = fr(), de = r?.summary.behavior ?? t?.metadata.behavior ?? null, fe = g(r?.summary);
	return /* @__PURE__ */ Y("div", {
		className: "pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col justify-center px-4 py-2 bg-elevation-ground",
		children: /* @__PURE__ */ X("div", {
			className: "pointer-events-auto flex w-full flex-col",
			children: [/* @__PURE__ */ X("div", {
				className: "flex w-full items-center gap-4",
				children: [
					/* @__PURE__ */ X("div", {
						className: "flex min-w-0 flex-1 items-center gap-2",
						children: [
							ae ? /* @__PURE__ */ X(J, { children: [
								/* @__PURE__ */ Y(I, {
									size: z.Large,
									variant: H.Ghost,
									content: L.Icon,
									className: "!h-6 !w-6 !min-h-0 !p-0",
									"aria-label": "Parent chat",
									onClick: ue,
									children: /* @__PURE__ */ Y(B, { iconName: V.Left })
								}),
								/* @__PURE__ */ Y("button", {
									type: "button",
									className: "label-medium max-w-[120px] truncate text-btn-secondary",
									title: le,
									onClick: ue,
									children: le
								}),
								/* @__PURE__ */ Y(B, {
									iconName: V.Right,
									size: 16,
									className: "shrink-0 text-btn-secondary"
								})
							] }) : null,
							/* @__PURE__ */ Y("p", {
								className: P("header-md min-w-0 truncate", v ? "text-shimmer-basic" : "text-basic-primary"),
								children: fe
							}),
							se ? /* @__PURE__ */ Y("span", {
								className: "tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-1 py-[2px] text-basic-tertiary",
								children: se
							}) : de && F.orchestrationEnabled ? /* @__PURE__ */ Y("span", {
								className: "tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-1 py-[2px] text-basic-tertiary",
								children: MS[de]
							}) : null
						]
					}),
					de === "direct" || de === "direct-with-orchestrator" ? /* @__PURE__ */ Y(OS, {
						context: h(T),
						input: h(S.usage?.input_tokens),
						output: h(S.usage?.output_tokens),
						cost: Yr(S.usage?.cost?.total),
						elapsed: Pr(A)
					}) : /* @__PURE__ */ X(J, { children: [S.usage || T ? /* @__PURE__ */ X("div", {
						className: "shrink-0 items-center gap-0.5 hidden xl:flex",
						children: [/* @__PURE__ */ Y(PS, {
							iconName: V.Timelaps,
							value: h(T),
							title: E,
							className: "text-info-primary",
							labelClassName: "label-micro"
						}), S.usage ? /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(PS, {
							iconName: V.ArrowTop,
							value: h(S.usage.input_tokens),
							title: "Input tokens",
							className: "text-info-secondary opacity-75",
							labelClassName: "text-micro"
						}), /* @__PURE__ */ Y(PS, {
							iconName: V.ArrowDown,
							value: h(S.usage.output_tokens),
							title: "Output tokens",
							className: "text-info-secondary opacity-75",
							labelClassName: "text-micro"
						})] }) : null]
					}) : null, /* @__PURE__ */ X("div", {
						className: "flex shrink-0 items-center",
						children: [S.usage ? /* @__PURE__ */ Y(Ir, {
							title: "Session cost",
							position: R.BottomCenter,
							children: /* @__PURE__ */ Y("span", {
								className: "text-micro whitespace-nowrap text-basic-primary",
								children: Yr(S.usage.cost?.total)
							})
						}) : null, /* @__PURE__ */ Y(Ir, {
							title: v ? "Run elapsed" : "Last response time",
							position: R.BottomRight,
							children: /* @__PURE__ */ Y("span", {
								className: "label-micro flex h-6 w-14 items-center justify-end text-basic-tertiary",
								children: Pr(A)
							})
						})]
					})] }),
					i ? /* @__PURE__ */ Y(Ir, {
						title: "Show panel",
						position: R.BottomLeft,
						children: /* @__PURE__ */ Y(I, {
							size: z.Medium,
							variant: H.Ghost,
							content: L.Icon,
							"aria-label": "Show panel",
							onClick: i,
							children: /* @__PURE__ */ Y(B, { iconName: V.SidebarChevronLeft })
						})
					}) : null
				]
			}), /* @__PURE__ */ X("div", {
				className: "flex w-full items-center gap-2",
				children: [
					/* @__PURE__ */ X("div", {
						className: "flex min-w-0 flex-1 items-center gap-4 overflow-hidden",
						children: [
							ae?.description ? /* @__PURE__ */ Y("span", {
								className: "label-micro min-w-0 truncate text-basic-secondary",
								children: ae.description
							}) : null,
							re ? /* @__PURE__ */ X("div", {
								className: "flex shrink-0 items-center gap-0.5",
								children: [/* @__PURE__ */ Y("span", {
									className: "label-micro max-w-[120px] truncate text-basic-tertiary",
									children: re
								}), /* @__PURE__ */ Y("span", {
									className: "tag-label text-basic-muted",
									children: Pn(r?.summary)
								})]
							}) : null,
							ie && !oe ? /* @__PURE__ */ Y(yg, {
								sessionId: e,
								branch: ie,
								placement: R.BottomRight
							}) : null,
							ie && oe ? /* @__PURE__ */ X("span", {
								className: "label-micro flex min-w-0 items-center gap-1.5 text-btn-secondary",
								children: [/* @__PURE__ */ Y(B, {
									iconName: V.Scheme,
									size: 16,
									className: "shrink-0"
								}), /* @__PURE__ */ Y("span", {
									className: "truncate",
									children: ie
								})]
							}) : null
						]
					}),
					/* @__PURE__ */ Y(AS, {
						sessionId: e,
						selected: j,
						onSelect: p,
						placement: R.BottomLeft
					}),
					ne || N ? /* @__PURE__ */ X("div", {
						className: "code code-small flex shrink-0 items-center gap-2",
						children: [/* @__PURE__ */ X("span", {
							className: "text-success-primary",
							children: ["+", ne]
						}), /* @__PURE__ */ X("span", {
							className: "text-error-primary",
							children: ["-", N]
						})]
					}) : null
				]
			})]
		})
	});
}
// src/app/components/pages/SessionPage.tsx
function IS(e, t) {
	let { useSshConnectionStatus: r, sshTargetKey: i, sshTargetFromSummary: a, markSshDisconnected: o, markSshConnected: s } = n().stores.sshConnectionStore, c = G(() => a(t), [a, t]), l = r(c), u = $e(), d = K(null);
	W(() => {
		d.current = null;
	}, [e]), W(() => {
		if (!c) return;
		let e = i(c);
		l === "connected" ? d.current = e : d.current === e || u.isPending || (d.current = e, u.mutateAsync(c).then(() => s(c)).catch(() => o(c)));
	}, [
		c,
		l,
		u,
		i,
		s,
		o
	]);
}
function LS() {
	let { useSidePanelExpanded: e, useSidePanelCollapsed: t, useSidePanelAnimate: r, useSelectedWorkset: i, useSelectedThreadRunning: a, useSelectedThread: o, useSelectedRevision: s, useSelectedFile: c, toggleSidePanelList: l, toggleSidePanelExpanded: u, toggleSidePanelCollapsed: d, showSidePanelList: f, revealSidePanel: p, setSidePanelAnimate: m, resetSessionSelection: h, unbindSidePanelProject: g, bindSidePanelProject: _ } = n().stores.sessionLayoutStore, { clearAttention: v } = n().stores.attentionStore, { sessionId: y, panel: b } = Ei(), x = Ti(), S = y ?? null, C = fr(), w = hp();
	Se("SessionPage");
	let { data: T = null, error: E, refetch: D } = Mr(S), { data: O = null } = nn(S), k = xS(S, O?.summary.backend), A = t(), j = r(), ee = e(), M = o(), te = a(), ne = i(), N = c(), re = s(), ie = Le(), ae = O != null || T != null, oe = ae ? O?.summary.behavior ?? T?.metadata.behavior ?? "orchestrator" : null, se = !ae || St(C, oe, O?.lineage ?? T?.lineage);
	zg(se ? S : null), Vg(se ? T?.active_run : null), IS(se ? S : null, se ? O?.summary : null);
	let ce = oe == null ? null : pa(oe, T?.lineage?.kind), le = ce?.mobilePanels ?? [], ue = qt(b) ? b : Lt, F = ce == null || ce.mobilePanels.includes(ue) ? ue : ce.defaultPanel;
	W(() => {
		S && T && qt(b) && b !== F && x(kr.session(S, F), { replace: !0 });
	}, [
		F,
		S,
		x,
		b,
		T
	]);
	let de = Ot(S, ie && F === "files" ? re : null);
	W(() => {
		S && v(S), h();
	}, [
		v,
		S,
		h
	]);
	let fe = O ? O.summary.project_id ?? "" : null;
	if (ui(() => {
		g(), fe != null && _(fe);
	}, [
		_,
		S,
		fe,
		g
	]), W(() => {
		if (j) return;
		let e = requestAnimationFrame(() => m(!0));
		return () => cancelAnimationFrame(e);
	}, [j, m]), ae && !se) return /* @__PURE__ */ X("div", {
		className: "flex flex-1 flex-col items-center justify-center gap-4 p-8",
		children: [
			/* @__PURE__ */ Y("h1", {
				className: "heading-small",
				children: "This chat is unavailable in direct-only mode"
			}),
			/* @__PURE__ */ Y("p", { children: "Its saved behavior and history are preserved. An operator can enable orchestration to open it." }),
			/* @__PURE__ */ Y(I, {
				onClick: () => {
					let e = O?.summary.project_id ?? T?.metadata.project_id;
					e ? w.newChat(e) : w.create();
				},
				children: "New direct chat"
			})
		]
	});
	if (!S) return /* @__PURE__ */ Y(bi, {
		to: kr.list(),
		replace: !0
	});
	if (!qt(b)) return /* @__PURE__ */ Y(bi, {
		to: kr.session(S, Lt),
		replace: !0
	});
	let pe = O?.summary.model_config_error ?? (!T && E ? E : null), me = pe ? k(pe, () => void D()) : null, he = (e) => x(kr.session(S, e)), ge = (e) => {
		p(ie), he(e);
	}, _e = re == null ? T?.workspace?.changed_files ?? [] : de.data?.changed_files ?? [], ve = N ?? _e[0]?.path ?? null, ye = ve ? _e.find((e) => e.path === ve) : void 0, be = ye && (ye.additions || ye.deletions) ? /* @__PURE__ */ X("div", {
		className: "flex items-center gap-2 shrink-0 code code-small",
		children: [/* @__PURE__ */ X("span", {
			className: "text-success-primary",
			children: ["+", ye.additions ?? 0]
		}), /* @__PURE__ */ X("span", {
			className: "text-error-primary",
			children: ["-", ye.deletions ?? 0]
		})]
	}) : null, xe = M, Ce = F === "threads" && te, we = /* @__PURE__ */ Y(cS, {
		sessionId: S,
		snapshot: T,
		behavior: oe,
		panel: F,
		onPanelChange: he
	});
	return /* @__PURE__ */ X("section", {
		className: "relative flex min-h-0 min-w-0 flex-1 h-full overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ X("div", {
			className: "relative flex flex-1 min-w-0 h-full min-h-0",
			children: [/* @__PURE__ */ Y("div", {
				className: P("flex flex-col items-center flex-1 min-w-0 h-full", ie ? "px-0" : "px-2"),
				children: /* @__PURE__ */ X("div", {
					className: "flex flex-col flex-1 min-h-0 w-full relative",
					children: [
						ie && (O?.lineage ?? T?.lineage) ? /* @__PURE__ */ Y("div", {
							className: "pointer-events-none absolute inset-x-0 top-16 z-20 flex items-center px-3 pt-2",
							children: /* @__PURE__ */ Y(I, {
								className: "pointer-events-auto relative",
								size: z.Small,
								variant: H.Ghost,
								onClick: () => {
									let e = (O?.lineage ?? T?.lineage)?.parent_session_id;
									e && x(kr.session(e, "delegated"));
								},
								children: "Parent chat"
							})
						}) : null,
						ie ? null : /* @__PURE__ */ Y(FS, {
							sessionId: S,
							snapshot: T,
							entry: O
						}),
						/* @__PURE__ */ Y(DS, {
							sessionId: S,
							snapshot: T,
							panel: F,
							onFocusPanel: ge,
							errorNotice: me
						}),
						/* @__PURE__ */ Y("div", {
							className: P("absolute bottom-0 left-0 right-0", ie ? "-mx-2" : "pb-2 mx-auto max-w-[720px]"),
							children: /* @__PURE__ */ Y(P_, {
								sessionId: S,
								snapshot: T,
								entry: O
							})
						})
					]
				})
			}), ie ? null : /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y("div", {
				className: P("relative h-full shrink-0", j && "transition-[width] duration-500 ease-in-out", A ? "w-[52px]" : "w-1/2"),
				style: j ? void 0 : { transition: "none" },
				children: A ? /* @__PURE__ */ Y("div", {
					className: "absolute inset-y-0 right-0 w-[52px]",
					children: /* @__PURE__ */ Y(B_, {
						sessionId: S,
						snapshot: T,
						behavior: oe,
						panels: ce?.widePanels ?? [],
						onOpen: d,
						onSelect: ge
					})
				}) : null
			}), /* @__PURE__ */ Y("div", {
				className: P("absolute inset-y-0 right-0 z-[1] flex flex-col min-w-0 w-1/2", j && "transition-transform duration-500 ease-in-out", A && "translate-x-full"),
				style: j ? void 0 : { transition: "none" },
				"aria-hidden": A,
				inert: A,
				children: /* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-h-0",
					children: /* @__PURE__ */ Y("div", {
						className: "flex-1 min-h-0",
						children: ee ? null : we
					})
				})
			})] })]
		}), ie ? /* @__PURE__ */ X(tn, {
			open: ee,
			onClose: u,
			keepOnNavigate: !0,
			title: /* @__PURE__ */ X("div", {
				className: "flex items-center gap-2 min-w-0",
				children: [/* @__PURE__ */ X("div", {
					className: "flex flex-col flex-1 min-w-0 justify-center",
					children: [/* @__PURE__ */ Y("div", {
						className: "min-w-0 truncate",
						children: /* @__PURE__ */ Y("span", {
							className: P("header-small", Ce ? "text-shimmer-basic" : "text-basic-primary"),
							children: F === "threads" ? xe ?? yr.threads : F === "worksets" ? ne ?? T?.worksets.items[0]?.id ?? yr.worksets : F === "files" ? N?.split("/").pop() ?? T?.workspace?.changed_files?.[0]?.path.split("/").pop() ?? yr.files : yr[F]
						})
					}), F === "files" ? be : null]
				}), T?.workspace?.branch && !T.lineage ? /* @__PURE__ */ Y(yg, {
					sessionId: S,
					branch: T.workspace.branch
				}) : null]
			}),
			headerActions: F === "history" ? null : /* @__PURE__ */ Y(I, {
				size: z.Large,
				variant: H.Ghost,
				content: L.Icon,
				"aria-label": "Open list",
				onClick: l,
				children: /* @__PURE__ */ Y(B, {
					iconName: V.List,
					size: 24
				})
			}),
			bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex flex-col flex-1 min-h-0",
				children: we
			}), le.length > 0 ? /* @__PURE__ */ Y(I_, {
				panel: F,
				panels: le,
				onPanelChange: (e) => {
					f(!1), he(e);
				}
			}) : null]
		}) : /* @__PURE__ */ Y(tn, {
			open: ee,
			onClose: u,
			fullScreen: !0,
			chromeless: !0,
			keepOnNavigate: !0,
			children: /* @__PURE__ */ Y("div", {
				className: "flex flex-col flex-1 min-h-0",
				children: we
			})
		})]
	});
}
// src/app/features/managed/presentation/ManagedGitHubPanel.tsx
function RS({ onConnected: e }) {
	let { api: t } = n(), r = Cn(), i = vi(), a = vn(), [o, s] = q(null), [c, l] = q(""), [u, d] = q(!1);
	W(() => {
		if (!o) return;
		let n = !1, a = new AbortController();
		return (async () => {
			for (; !n;) {
				try {
					let n = await t.pollManagedGitHubLogin(o.login_id, a.signal);
					if (n.state === "complete") {
						i.setQueryData(cn.github, n.auth), s(null), l(""), Promise.all([i.invalidateQueries({ queryKey: cn.github }), i.invalidateQueries({ queryKey: cn.hostStatus })]), r.success("GitHub connected"), e?.();
						return;
					}
					if (n.state === "failed") {
						l(n.error), s(null);
						return;
					}
				} catch (e) {
					a.signal.aborted || l(Ku($(e)));
					return;
				}
				await new Promise((e) => setTimeout(e, 1e3));
			}
		})(), () => {
			n = !0, a.abort();
		};
	}, [
		o,
		i,
		e,
		r,
		t
	]);
	let p = async () => {
		d(!0), l("");
		try {
			s(await t.startManagedGitHubLogin());
		} catch (e) {
			l(Ku($(e)));
		} finally {
			d(!1);
		}
	}, m = async () => {
		d(!0);
		try {
			await t.disconnectManagedGitHub(), await Promise.all([i.invalidateQueries({ queryKey: cn.github }), i.invalidateQueries({ queryKey: cn.hostStatus })]), r.success("GitHub disconnected");
		} catch (e) {
			r.error(`Disconnect failed: ${mr($(e))}`);
		} finally {
			d(!1);
		}
	};
	return a.isLoading ? /* @__PURE__ */ Y(f, { size: mt.Medium }) : /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-5",
		"data-testid": "managed-github-settings",
		children: [
			/* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("p", {
				className: "header-xl text-basic-primary",
				children: "GitHub"
			}), /* @__PURE__ */ Y("p", {
				className: "text-small text-basic-tertiary",
				children: "Connect the private Arcee GitHub App. Tokens are never shown in NAC."
			})] }),
			a.data?.connected ? /* @__PURE__ */ X("div", {
				className: "rounded-lg border border-basic p-4",
				children: [/* @__PURE__ */ X("div", {
					className: "flex items-center gap-3",
					children: [
						a.data.avatar_url ? /* @__PURE__ */ Y("img", {
							src: a.data.avatar_url,
							alt: "",
							className: "h-10 w-10 rounded-full"
						}) : /* @__PURE__ */ Y(B, { iconName: V.Github }),
						/* @__PURE__ */ X("div", {
							className: "min-w-0 flex-1",
							children: [/* @__PURE__ */ Y("p", {
								className: "label-medium text-basic-primary truncate",
								children: a.data.name ?? a.data.login
							}), /* @__PURE__ */ X("p", {
								className: "text-small text-basic-tertiary truncate",
								children: ["@", a.data.login]
							})]
						}),
						/* @__PURE__ */ X("span", {
							className: "flex shrink-0 items-center gap-1.5 label-small text-success-primary",
							children: [/* @__PURE__ */ Y(B, {
								iconName: V.CheckCircle,
								"aria-hidden": "true"
							}), "Connected"]
						})
					]
				}), a.data.git_name && a.data.git_email ? /* @__PURE__ */ X("p", {
					className: "mt-3 text-small text-basic-tertiary",
					children: [
						"Git commits: ",
						a.data.git_name,
						" · ",
						a.data.git_email
					]
				}) : null]
			}) : null,
			o ? /* @__PURE__ */ X("div", {
				className: "rounded-lg border border-info-primary p-4",
				"data-testid": "github-device-code",
				children: [
					/* @__PURE__ */ Y("p", {
						className: "label-medium text-basic-primary",
						children: "Authorize this host on GitHub"
					}),
					/* @__PURE__ */ Y("p", {
						className: "mt-1 text-small text-basic-tertiary",
						children: "Open GitHub and enter this code. Returning here will preserve this pending login."
					}),
					/* @__PURE__ */ X("div", {
						className: "mt-4 flex items-center gap-2",
						children: [/* @__PURE__ */ Y("code", {
							className: "flex-1 rounded bg-elevation-level-2 px-4 py-3 text-center text-xl tracking-[0.2em] text-basic-primary",
							children: o.user_code
						}), /* @__PURE__ */ Y(Ft, {
							value: o.user_code,
							title: "Copy device code"
						})]
					}),
					/* @__PURE__ */ X("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: [/* @__PURE__ */ X(I, {
							variant: H.Primary,
							content: L.IconRight,
							onClick: () => window.open(o.verification_uri, "_blank", "noopener"),
							children: ["Open GitHub ", /* @__PURE__ */ Y(B, { iconName: V.External })]
						}), /* @__PURE__ */ Y(I, {
							variant: H.Tertiary,
							content: L.Text,
							onClick: () => {
								t.cancelManagedGitHubLogin(o.login_id), s(null);
							},
							children: "Cancel"
						})]
					})
				]
			}) : null,
			c ? /* @__PURE__ */ Y("p", {
				className: "text-small text-error-primary",
				children: c
			}) : null,
			o ? null : /* @__PURE__ */ X("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ Y(I, {
					variant: H.Primary,
					content: L.Text,
					onClick: () => void p(),
					loading: u,
					children: a.data?.connected ? "Reconnect GitHub" : "Connect GitHub"
				}), a.data?.connected ? /* @__PURE__ */ Y(I, {
					variant: H.SecondaryDestructive,
					content: L.Text,
					onClick: () => void m(),
					disabled: u,
					children: "Disconnect"
				}) : null]
			})
		]
	});
}
// src/app/features/managed/presentation/ManagedSecretsPanel.tsx
function zS() {
	let e = Nr(), t = Ur(), n = ir(), r = Cn(), [i, a] = q(""), [o, s] = q(""), [c, l] = q(!1), u = G(() => c ? k(i) : "", [c, i]), d = async () => {
		if (l(!0), !(k(i) || o.length === 0)) try {
			await t.mutateAsync({
				name: i,
				value: o
			}), a(""), s(""), l(!1), r.success("Secret saved for future command spawns");
		} catch (e) {
			r.error(`Secret was not saved: ${mr($(e))}`);
		}
	};
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-5",
		"data-testid": "managed-secrets-settings",
		children: [
			/* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("p", {
				className: "header-xl text-basic-primary",
				children: "Host secrets"
			}), /* @__PURE__ */ Y("p", {
				className: "text-small text-basic-tertiary",
				children: "Values are write-only and are injected into every newly spawned agent command on this single-owner host. Running processes keep their existing snapshot."
			})] }),
			/* @__PURE__ */ Y("div", {
				className: "rounded-lg border border-warning-primary p-4 text-small text-basic-secondary",
				children: "Agents have arbitrary shell access and can print injected values. Add only secrets trusted across every Project and agent on this host."
			}),
			/* @__PURE__ */ X("div", {
				className: "grid grid-cols-1 gap-3 sm:grid-cols-2",
				children: [/* @__PURE__ */ Y(Q, {
					inputSize: Z.Large,
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
				}), /* @__PURE__ */ Y(Q, {
					inputSize: Z.Large,
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
			/* @__PURE__ */ Y("div", { children: /* @__PURE__ */ Y(I, {
				variant: H.Primary,
				content: L.Text,
				onClick: () => void d(),
				loading: t.isPending,
				children: "Save secret"
			}) }),
			/* @__PURE__ */ Y($l, {}),
			/* @__PURE__ */ X("div", {
				className: "flex flex-col gap-2",
				children: [
					/* @__PURE__ */ Y("p", {
						className: "label-medium text-basic-primary",
						children: "Stored names"
					}),
					e.isLoading ? /* @__PURE__ */ Y(f, { size: mt.Small }) : null,
					e.data?.secrets.length === 0 ? /* @__PURE__ */ Y("p", {
						className: "text-small text-basic-tertiary",
						children: "No host secrets saved."
					}) : null,
					e.data?.secrets.map((e) => /* @__PURE__ */ X("div", {
						className: "flex items-center gap-3 rounded-lg border border-basic p-3",
						children: [
							/* @__PURE__ */ Y(B, { iconName: V.Key }),
							/* @__PURE__ */ Y("code", {
								className: "min-w-0 flex-1 truncate text-basic-primary",
								children: e.name
							}),
							/* @__PURE__ */ Y("span", {
								className: "text-small text-basic-muted",
								children: "value hidden"
							}),
							/* @__PURE__ */ Y(I, {
								variant: H.Ghost,
								size: z.Small,
								content: L.Icon,
								"aria-label": `Delete ${e.name}`,
								onClick: async () => {
									try {
										await n.mutateAsync(e.name), r.success(`${e.name} removed from future command spawns`);
									} catch (e) {
										r.error(`Secret was not removed: ${mr($(e))}`);
									}
								},
								loading: n.isPending,
								children: /* @__PURE__ */ Y(B, { iconName: V.Trash })
							})
						]
					}, e.name))
				]
			})
		]
	});
}
// src/app/features/managed/controller/useManagedUpgrade.ts
function BS() {
	return `nac-upgrade-${globalThis.crypto.randomUUID()}`;
}
function VS(e) {
	if (!e) throw Error("managed upgrade action target is unavailable");
	return e;
}
async function HS(e, t) {
	if (!t.actionable || t.action === "wait" || !t.target) throw Error("managed upgrade blocker is wait-only");
	let n = t.target;
	switch (t.action) {
		case "cancel_active_run": {
			let t = VS(n.session_id), r = VS(n.run_id);
			await e.cancelExactRun(t, r);
			return;
		}
		case "cancel_traditional_child":
			await e.cancelTraditionalChild(VS(n.session_id), VS(n.child_session_id));
			return;
		case "cancel_managed_orchestrator":
			await e.cancelManagedOrchestrator(VS(n.session_id), VS(n.orchestrator_session_id));
			return;
		case "terminate_terminal":
			await e.terminateTerminal(VS(n.session_id), VS(n.terminal_id));
			return;
		case "cancel_clone_operation":
			await e.cancelManagedClone(VS(n.clone_operation_id));
			return;
	}
}
function US(e, t, n) {
	if (!t) return !1;
	let r = t.target_release ?? t.desired_release;
	return !r || !On(r, n) ? !1 : !e || t.operation_id !== e.operation_id || t.state !== e.state || t.updated_at !== e.updated_at;
}
function WS() {
	let { api: e } = n(), t = Jr(), r = m(), i = K(null), a = t.data?.operation?.operation_id ?? null, [o, s] = q(!1), [c, l] = q(""), [u, d] = q({}), f = K(a);
	W(() => {
		if (f.current !== a) {
			f.current = a, d({});
			return;
		}
		let e = new Set((t.data?.operation?.blockers ?? []).map((e) => e.selection_key));
		d((t) => {
			let n = Object.fromEntries(Object.entries(t).filter(([t]) => e.has(t)));
			return Object.keys(n).length === Object.keys(t).length ? t : n;
		});
	}, [a, t.data?.operation?.blockers]);
	let p = U(() => {
		l(""), s(!0);
	}, []), h = U(() => {
		r.isPending || (s(!1), l(""));
	}, [r.isPending]), g = U(async () => {
		if (r.isPending) return;
		let e = i.current ?? BS(), n = t.data?.operation ?? null, a = t.data?.preview.latest_beta;
		i.current = e, l("");
		try {
			await r.mutateAsync(e), i.current = null, s(!1);
		} catch (e) {
			l(Nn(e).message), nt(e) && (i.current = null, s(!1));
			let r = await t.refetch();
			!nt(e) && !r.error && a && US(n, r.data?.operation, a) && (i.current = null, l(""), s(!1));
		}
	}, [t, r]), _ = U(async (n) => {
		d((e) => ({
			...e,
			[n.selection_key]: "requesting"
		}));
		try {
			await HS(e, n), d((e) => ({
				...e,
				[n.selection_key]: "settling"
			})), await t.refetch();
		} catch {
			d((e) => ({
				...e,
				[n.selection_key]: "failed"
			}));
		}
	}, [t, e]);
	return {
		snapshot: t,
		confirmationOpen: o,
		startError: c,
		startPending: r.isPending,
		settlements: u,
		requestStart: p,
		cancelStart: h,
		confirmStart: g,
		requestSettlement: _
	};
}
// src/app/features/managed/presentation/ManagedUpgradePanel.tsx
function GS() {
	let e = WS(), t = e.snapshot, n = i(t.error);
	if (t.isLoading) return /* @__PURE__ */ X("section", {
		"aria-labelledby": "managed-upgrade-heading",
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ Y("h2", {
			id: "managed-upgrade-heading",
			className: "label-medium text-basic-primary",
			children: "Managed NAC upgrade"
		}), /* @__PURE__ */ Y("div", {
			className: "mt-3",
			children: /* @__PURE__ */ Y(f, { size: mt.Small })
		})]
	});
	if (!t.data || n) {
		let e = Nn(t.error);
		return /* @__PURE__ */ X("section", {
			"aria-labelledby": "managed-upgrade-heading",
			className: "rounded-lg border border-basic p-4",
			"data-testid": "managed-upgrade-unavailable",
			children: [
				/* @__PURE__ */ Y("h2", {
					id: "managed-upgrade-heading",
					className: "label-medium text-basic-primary",
					children: "Managed NAC upgrade"
				}),
				/* @__PURE__ */ Y("p", {
					className: "mt-1 text-small text-error-primary",
					children: e.message
				}),
				e.retryLabel ? /* @__PURE__ */ Y(I, {
					className: "mt-3",
					size: z.Small,
					variant: H.Secondary,
					content: L.Text,
					onClick: () => void t.refetch(),
					loading: t.isFetching,
					children: e.retryLabel
				}) : null
			]
		});
	}
	let { preview: r, operation: a } = t.data, o = a ? y(a.state) : !1, s = r.upgrade_available && !o, c = a?.target_release, l = c && !On(c, r.latest_beta);
	return /* @__PURE__ */ X("section", {
		"aria-labelledby": "managed-upgrade-heading",
		className: "rounded-lg border border-basic p-4",
		"data-testid": "managed-upgrade",
		children: [
			/* @__PURE__ */ X("div", {
				className: "flex flex-wrap items-start justify-between gap-3",
				children: [/* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("h2", {
					id: "managed-upgrade-heading",
					className: "label-medium text-basic-primary",
					children: "Managed NAC upgrade"
				}), /* @__PURE__ */ Y("p", {
					className: "mt-1 text-small text-basic-tertiary",
					children: w(r.distance?.accepted_releases ?? null)
				})] }), s ? /* @__PURE__ */ Y(I, {
					size: z.Small,
					variant: H.Primary,
					content: L.Text,
					onClick: e.requestStart,
					children: a?.state === "failed" ? "Retry upgrade to latest beta" : "Upgrade to latest beta"
				}) : !r.upgrade_available && !o ? /* @__PURE__ */ Y("span", {
					className: "rounded-full bg-success-secondary px-3 py-1 text-small text-success-primary",
					children: "Up to date"
				}) : null]
			}),
			/* @__PURE__ */ X("div", {
				className: "mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2",
				children: [
					/* @__PURE__ */ Y(KS, {
						label: "Current",
						release: r.current
					}),
					/* @__PURE__ */ Y(KS, {
						label: "Latest beta",
						release: r.latest_beta
					}),
					l ? /* @__PURE__ */ Y(KS, {
						label: "Accepted target",
						release: c,
						className: "lg:col-span-2"
					}) : null
				]
			}),
			a ? /* @__PURE__ */ Y(qS, {
				operation: a,
				settlements: e.settlements,
				onSettle: (t) => void e.requestSettlement(t)
			}) : null,
			/* @__PURE__ */ X(tn, {
				open: e.confirmationOpen,
				onClose: e.cancelStart,
				title: "Upgrade Managed NAC?",
				size: dn.Small,
				footer: /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(I, {
					variant: H.Tertiary,
					content: L.Text,
					onClick: e.cancelStart,
					disabled: e.startPending,
					children: "Cancel"
				}), /* @__PURE__ */ Y(I, {
					variant: H.Primary,
					content: L.Text,
					onClick: () => void e.confirmStart(),
					loading: e.startPending,
					children: "Start upgrade"
				})] }),
				children: [/* @__PURE__ */ X("p", {
					className: "text-small text-basic-secondary",
					children: [
						"Upgrade from ",
						/* @__PURE__ */ Y("strong", { children: r.current.product_version }),
						" to the exact accepted latest beta, ",
						/* @__PURE__ */ Y("strong", { children: r.latest_beta.product_version }),
						". Active work must finish or be explicitly stopped before this host is replaced. The page may disconnect briefly while NAC starts and verifies the replacement."
					]
				}), e.startError ? /* @__PURE__ */ Y("p", {
					role: "alert",
					className: "mt-3 text-small text-error-primary",
					children: e.startError
				}) : null]
			})
		]
	});
}
function KS({ label: e, release: t, className: n = "" }) {
	return /* @__PURE__ */ X("div", {
		className: `min-w-0 rounded-lg bg-elevation-level-2 p-3 ${n}`,
		children: [
			/* @__PURE__ */ Y("p", {
				className: "label-small text-basic-secondary",
				children: e
			}),
			/* @__PURE__ */ Y("p", {
				className: "mt-1 label-medium text-basic-primary",
				children: t.product_version
			}),
			/* @__PURE__ */ X("dl", {
				className: "mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-1 text-small",
				children: [
					/* @__PURE__ */ Y("dt", {
						className: "text-basic-tertiary",
						children: "Release"
					}),
					/* @__PURE__ */ Y("dd", {
						className: "code-small break-all text-basic-primary",
						children: t.release_id
					}),
					/* @__PURE__ */ Y("dt", {
						className: "text-basic-tertiary",
						children: "Source"
					}),
					/* @__PURE__ */ Y("dd", {
						className: "code-small break-all text-basic-primary",
						children: t.source_revision
					}),
					/* @__PURE__ */ Y("dt", {
						className: "text-basic-tertiary",
						children: "Build"
					}),
					/* @__PURE__ */ Y("dd", {
						className: "code-small break-all text-basic-primary",
						children: t.build_id
					}),
					/* @__PURE__ */ Y("dt", {
						className: "text-basic-tertiary",
						children: "Schema"
					}),
					/* @__PURE__ */ Y("dd", {
						className: "code-small text-basic-primary",
						children: t.schema_version
					})
				]
			})
		]
	});
}
function qS({ operation: e, settlements: t, onSettle: n }) {
	let r = e.blockers ?? [], i = e.state === "failed", a = e.state === "succeeded";
	return /* @__PURE__ */ X("div", {
		className: `mt-4 rounded-lg border p-4 ${i ? "border-error-primary" : a ? "border-success-primary" : "border-basic"}`,
		"aria-live": "polite",
		"data-testid": "managed-upgrade-operation",
		children: [/* @__PURE__ */ X("div", {
			className: "flex flex-wrap items-start justify-between gap-2",
			children: [/* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("p", {
				className: "label-medium text-basic-primary",
				children: Pe(e.state)
			}), e.message ? /* @__PURE__ */ Y("p", {
				className: "mt-1 text-small text-basic-tertiary",
				children: e.message
			}) : null] }), /* @__PURE__ */ Y("span", {
				className: "code-small break-all text-basic-muted",
				children: e.operation_id
			})]
		}), r.length > 0 ? /* @__PURE__ */ X("div", {
			className: "mt-4",
			children: [/* @__PURE__ */ Y("p", {
				className: "label-small text-basic-secondary",
				children: "Before replacement can begin"
			}), /* @__PURE__ */ Y("ul", {
				className: "mt-2 flex flex-col gap-2",
				children: r.map((e) => {
					let r = t[e.selection_key];
					return /* @__PURE__ */ Y("li", {
						className: "rounded-lg bg-elevation-level-2 p-3",
						children: /* @__PURE__ */ X("div", {
							className: "flex flex-wrap items-center justify-between gap-3",
							children: [/* @__PURE__ */ X("div", {
								className: "min-w-0 flex-1",
								children: [/* @__PURE__ */ Y("p", {
									className: "text-small text-basic-primary",
									children: e.message
								}), e.actionable ? r === "settling" ? /* @__PURE__ */ Y("p", {
									className: "mt-1 text-small text-basic-tertiary",
									children: "Stop requested. Waiting for cleanup to finish."
								}) : r === "failed" ? /* @__PURE__ */ Y("p", {
									role: "alert",
									className: "mt-1 text-small text-error-primary",
									children: "The stop request failed. Refresh status or try again."
								}) : null : /* @__PURE__ */ Y("p", {
									className: "mt-1 text-small text-basic-tertiary",
									children: "Wait for this work to finish safely."
								})]
							}), e.actionable ? /* @__PURE__ */ Y(I, {
								size: z.Small,
								variant: H.SecondaryDestructive,
								content: L.Text,
								onClick: () => n(e),
								loading: r === "requesting",
								disabled: r === "settling",
								children: r === "settling" ? "Waiting for cleanup" : r === "failed" ? `Try again: ${Rr(e.action)}` : Rr(e.action)
							}) : /* @__PURE__ */ Y("span", {
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
function JS({ ready: e }) {
	return /* @__PURE__ */ Y("span", {
		"aria-hidden": !0,
		className: `inline-block h-2 w-2 rounded-full ${e ? "bg-success-primary" : "bg-warning-primary"}`
	});
}
function YS() {
	let e = pn();
	if (e.isLoading) return /* @__PURE__ */ Y(f, { size: mt.Medium });
	if (!e.data) return /* @__PURE__ */ Y("p", {
		className: "text-error-primary",
		children: "Managed host status is unavailable."
	});
	let t = e.data;
	return /* @__PURE__ */ X("div", {
		className: "flex flex-col gap-5",
		"data-testid": "managed-host-status",
		children: [
			/* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("p", {
				className: "header-xl text-basic-primary",
				children: t.logical_host_id
			}), /* @__PURE__ */ X("p", {
				className: "text-small text-basic-tertiary",
				children: ["Managed NAC · ", t.public_hostname]
			})] }),
			/* @__PURE__ */ Y(GS, {}),
			/* @__PURE__ */ X("div", {
				className: "grid grid-cols-1 gap-2 sm:grid-cols-2",
				children: [
					/* @__PURE__ */ Y(XS, {
						label: t.model.display_name,
						value: t.model_ready ? t.model.id : "Needs attention",
						ready: t.model_ready
					}),
					/* @__PURE__ */ Y(XS, {
						label: "GitHub",
						value: t.github_status.replace("-", " "),
						ready: t.github_status === "connected"
					}),
					/* @__PURE__ */ Y(XS, {
						label: "Projects",
						value: String(t.project_count),
						ready: !0
					}),
					/* @__PURE__ */ Y(XS, {
						label: "Host secrets",
						value: String(t.secret_count),
						ready: !0
					})
				]
			}),
			/* @__PURE__ */ X("div", {
				className: "rounded-lg bg-elevation-level-2 p-4",
				children: [
					/* @__PURE__ */ Y("p", {
						className: "label-small text-basic-secondary",
						children: "Managed model endpoint"
					}),
					/* @__PURE__ */ Y("p", {
						className: "code-small mb-3 break-all text-basic-primary",
						children: t.model.endpoint
					}),
					/* @__PURE__ */ Y("p", {
						className: "label-small text-basic-secondary",
						children: "Repository root"
					}),
					/* @__PURE__ */ Y("p", {
						className: "code-small break-all text-basic-primary",
						children: t.repository_root
					})
				]
			}),
			/* @__PURE__ */ X("div", {
				className: "flex flex-col gap-2",
				children: [/* @__PURE__ */ X("div", {
					className: "flex items-center justify-between",
					children: [/* @__PURE__ */ Y("p", {
						className: "label-medium text-basic-primary",
						children: "Readiness"
					}), /* @__PURE__ */ X("span", {
						className: "text-small text-basic-tertiary",
						children: [
							"v",
							t.version,
							" · schema ",
							t.schema_version
						]
					})]
				}), t.checks.map((e) => /* @__PURE__ */ X("div", {
					className: "flex items-start gap-2 rounded-lg border border-basic p-3",
					children: [/* @__PURE__ */ Y("span", {
						className: "mt-2",
						children: /* @__PURE__ */ Y(JS, { ready: e.ready })
					}), /* @__PURE__ */ X("div", {
						className: "min-w-0",
						children: [/* @__PURE__ */ Y("p", {
							className: "label-small text-basic-primary",
							children: e.name
						}), /* @__PURE__ */ Y("p", {
							className: "text-small text-basic-tertiary break-words",
							children: e.detail
						})]
					})]
				}, e.name))]
			})
		]
	});
}
function XS({ label: e, value: t, ready: n }) {
	return /* @__PURE__ */ X("div", {
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ Y("p", {
			className: "text-small text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ X("div", {
			className: "mt-1 flex items-center gap-2",
			children: [/* @__PURE__ */ Y(JS, { ready: n }), /* @__PURE__ */ Y("p", {
				className: "label-medium capitalize text-basic-primary",
				children: t
			})]
		})]
	});
}
// src/app/features/managed/presentation/ManagedHostModal.tsx
function ZS({ open: e, onClose: t, tab: n, onTabChange: r, onGitHubConnected: i }) {
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: t,
		title: "Managed host",
		size: dn.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		bodyClassName: "min-h-0",
		children: /* @__PURE__ */ X("div", {
			className: "flex h-full min-h-0 flex-col md:flex-row",
			children: [/* @__PURE__ */ Y("nav", {
				className: "flex shrink-0 gap-1 overflow-x-auto border-b border-basic md:w-44 md:flex-col md:border-b-0 md:border-r p-2",
				children: Te.map((e) => /* @__PURE__ */ Y("button", {
					type: "button",
					className: `rounded px-3 py-2 text-left label-small capitalize ${n === e ? "bg-elevation-level-2 text-basic-primary" : "text-basic-tertiary"}`,
					onClick: () => r(e),
					children: e === "github" ? "GitHub" : e
				}, e))
			}), /* @__PURE__ */ X("div", {
				className: "min-h-0 flex-1 overflow-auto p-4 md:p-6",
				children: [
					n === "status" ? /* @__PURE__ */ Y(YS, {}) : null,
					n === "github" ? /* @__PURE__ */ Y(RS, { onConnected: i }) : null,
					n === "secrets" ? /* @__PURE__ */ Y(zS, {}) : null
				]
			})]
		})
	});
}
// src/app/features/managed/presentation/ManagedBranchPicker.tsx
function QS(e, t) {
	return e.toLowerCase().localeCompare(t.toLowerCase()) || e.localeCompare(t);
}
function $S({ branches: e, value: t, onValueChange: n, isLoading: r, error: i }) {
	let [a, o] = q(!1), [s, c] = q(""), [l, u] = q(null), d = K(null), p = K(null), m = li(), h = Le(), g = G(() => {
		let t = s.trim().toLowerCase(), n = [...e].sort(QS);
		return t ? n.filter((e) => e.toLowerCase().includes(t)) : n;
	}, [e, s]), _ = l === null ? -1 : g.indexOf(l), v = (e = !0) => {
		o(!1), c(""), u(null), e && d.current?.focus();
	}, y = () => {
		if (a) {
			v();
			return;
		}
		let n = [...e].sort(QS);
		u(t || n[0] || null), o(!0);
	};
	W(() => {
		a && p.current?.focus();
	}, [a]), W(() => {
		!a || _ < 0 || document.getElementById(`${m}-option-${_}`)?.scrollIntoView?.({ block: "nearest" });
	}, [
		_,
		m,
		a
	]);
	let b = (e) => {
		n(e), v();
	}, x = (e) => {
		if (g.length === 0) return;
		let t = l === null ? -1 : g.indexOf(l), n = t < 0 ? e > 0 ? 0 : g.length - 1 : (t + e + g.length) % g.length;
		u(g[n] ?? null);
	}, S = (e) => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault(), x(1);
				break;
			case "ArrowUp":
				e.preventDefault(), x(-1);
				break;
			case "Home":
				e.preventDefault(), u(g[0] ?? null);
				break;
			case "End":
				e.preventDefault(), u(g.at(-1) ?? null);
				break;
			case "Enter": {
				let t = _ >= 0 ? g[_] : null;
				if (!t) break;
				e.preventDefault(), b(t);
				break;
			}
			case "Escape":
				e.preventDefault(), e.stopPropagation(), v();
				break;
			case "Tab": v(!1);
		}
	}, C = r ? /* @__PURE__ */ X("div", {
		role: "status",
		className: "flex items-center gap-2 p-3 text-small text-basic-tertiary",
		children: [/* @__PURE__ */ Y(f, {
			size: mt.Small,
			variant: se.Neutral
		}), "Loading branches…"]
	}) : i ? /* @__PURE__ */ Y("p", {
		role: "alert",
		className: "p-3 text-small text-error-primary",
		children: i
	}) : e.length === 0 ? /* @__PURE__ */ Y("p", {
		role: "status",
		className: "p-3 text-small text-basic-tertiary",
		children: "No branches found."
	}) : g.length === 0 ? /* @__PURE__ */ X("p", {
		role: "status",
		className: "p-3 text-small text-basic-tertiary",
		children: [
			"No branches match \"",
			s.trim(),
			"\"."
		]
	}) : null;
	return /* @__PURE__ */ X("div", {
		className: "flex min-w-0 flex-col gap-1 text-small text-basic-secondary",
		children: [/* @__PURE__ */ Y("span", { children: "Branch" }), /* @__PURE__ */ Y(Zr, {
			open: a,
			onClose: () => v(),
			placement: R.BottomLeft,
			sticky: !0,
			className: "w-full",
			size: "w-[min(420px,calc(100vw-32px))]",
			panelClassName: "max-w-[calc(100vw-32px)]",
			sheetClassName: "px-4",
			content: /* @__PURE__ */ X("div", {
				className: "flex h-[min(420px,70dvh)] min-h-[220px] flex-col gap-2 p-2 md:p-0",
				children: [/* @__PURE__ */ Y(Q, {
					ref: p,
					inputSize: h ? Z.Large : Z.Medium,
					label: "Find branch",
					"aria-label": "Find branch",
					placeholder: "Search loaded branches",
					role: "combobox",
					"aria-autocomplete": "list",
					"aria-expanded": a,
					"aria-controls": m,
					"aria-activedescendant": _ >= 0 ? `${m}-option-${_}` : void 0,
					value: s,
					onChange: (t) => {
						let n = t.target.value, r = n.trim().toLowerCase(), i = [...e].sort(QS).filter((e) => !r || e.toLowerCase().includes(r));
						c(n), u(i[0] ?? null);
					},
					onKeyDown: S
				}), /* @__PURE__ */ X("div", {
					id: m,
					role: "listbox",
					"aria-label": "Branches",
					className: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded border border-basic p-1",
					children: [C, !r && !i ? g.map((e, n) => /* @__PURE__ */ X(Gl, {
						id: `${m}-option-${n}`,
						role: "option",
						"aria-selected": e === t,
						tabIndex: -1,
						size: h ? Hl.Large : Hl.Medium,
						active: e === l,
						className: "shrink-0",
						onMouseEnter: () => u(e),
						onMouseDown: (e) => e.preventDefault(),
						onClick: () => b(e),
						children: [/* @__PURE__ */ Y("span", {
							className: "min-w-0 flex-1 truncate text-left",
							title: e,
							children: e
						}), e === t ? /* @__PURE__ */ Y(B, {
							iconName: V.Check,
							className: "shrink-0"
						}) : null]
					}, e)) : null]
				})]
			}),
			children: /* @__PURE__ */ X("button", {
				ref: d,
				type: "button",
				className: "btn btn-medium btn-secondary btn-icon-right w-full max-w-full overflow-hidden",
				"aria-label": `Branch: ${t || "Select a branch"}`,
				"aria-haspopup": "listbox",
				"aria-expanded": a,
				"aria-controls": a ? m : void 0,
				onClick: y,
				onKeyDown: (e) => {
					[
						"ArrowDown",
						"ArrowUp",
						"Enter",
						" "
					].includes(e.key) && (e.preventDefault(), a || y());
				},
				children: [/* @__PURE__ */ Y("span", {
					className: "min-w-0 flex-1 truncate text-left",
					title: t,
					children: t || "Select a branch"
				}), /* @__PURE__ */ Y(B, {
					iconName: V.Down,
					className: `shrink-0 transition-transform duration-150 ${a ? "rotate-180" : "rotate-0"}`
				})]
			})
		})]
	});
}
// src/app/features/managed/presentation/ManagedRepositoryModal.tsx
function eC({ open: e, onClose: t, onConnect: r }) {
	let { api: i } = n(), a = Ti(), o = Cn(), s = vi(), c = pn(), l = vn(e), [u, d] = q(""), [p, m] = q(null), [h, g] = q(""), [_, v] = q(""), [y, b] = q(""), [x, S] = q(null), [C, w] = q(""), [T, E] = q(!1), D = _i({
		queryKey: ["managed-github-repositories"],
		queryFn: ({ signal: e }) => i.listManagedGitHubRepositories(e),
		enabled: e && l.data?.connected === !0,
		retry: !1
	}), O = xe(p?.full_name), k = _i({
		queryKey: ["managed-github-branches", p?.full_name],
		queryFn: ({ signal: e }) => i.listManagedGitHubBranches(O[0], O[1], e),
		enabled: e && O !== null,
		retry: !1
	});
	W(() => {
		if (!x || !ke(x)) return;
		let e = !1, n = new AbortController();
		return (async () => {
			for (; !e;) {
				await new Promise((e) => setTimeout(e, 500));
				try {
					let e = await i.getManagedClone(x.operation_id, n.signal);
					if (S(e), e.status !== "running") {
						e.status === "completed" && (await Promise.all([s.invalidateQueries({ queryKey: Xt.projects }), s.invalidateQueries({ queryKey: cn.hostStatus })]), o.success(`${e.project_name} is ready`), t(), a(kr.project(e.project_id)));
						return;
					}
				} catch (e) {
					n.signal.aborted || w(Ku($(e)));
					return;
				}
			}
		})(), () => {
			e = !0, n.abort();
		};
	}, [
		x,
		a,
		t,
		s,
		o,
		i
	]);
	let A = G(() => {
		let e = u.trim().toLowerCase(), t = D.data?.repositories ?? [];
		return e ? t.filter((t) => t.full_name.toLowerCase().includes(e)) : t;
	}, [D.data, u]), j = async () => {
		if (p && h && _.trim() && y.trim()) {
			E(!0), w("");
			try {
				S(await i.startManagedClone({
					repository_id: p.id,
					repository: p.full_name,
					branch: h,
					destination: _.trim(),
					project_name: y.trim(),
					project_description: null
				}));
			} catch (e) {
				w(Ku($(e)));
			} finally {
				E(!1);
			}
		}
	}, ee = async () => {
		if (x && ke(x)) try {
			S(await i.cancelManagedClone(x.operation_id));
		} catch (e) {
			w(mr($(e)));
		}
	}, M = T || ke(x), te = k.error ? Ku($(k.error)) : null;
	return /* @__PURE__ */ Y(tn, {
		open: e,
		onClose: M ? void 0 : t,
		title: "Add repository",
		size: dn.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		bodyClassName: "min-h-0",
		footer: x?.status === "running" ? /* @__PURE__ */ Y(I, {
			variant: H.SecondaryDestructive,
			content: L.Text,
			onClick: () => void ee(),
			children: "Cancel clone"
		}) : /* @__PURE__ */ X(J, { children: [/* @__PURE__ */ Y(I, {
			variant: H.Tertiary,
			content: L.Text,
			onClick: t,
			children: "Cancel"
		}), /* @__PURE__ */ Y(I, {
			variant: H.Primary,
			content: L.Text,
			onClick: () => void j(),
			disabled: !p || !h || !_.trim() || !y.trim(),
			loading: T,
			children: "Clone repository"
		})] }),
		children: /* @__PURE__ */ X("div", {
			className: "flex h-full min-h-0 flex-col gap-4 overflow-auto p-4 md:p-6",
			"data-testid": "managed-repository-modal",
			children: [
				l.data?.connected ? null : /* @__PURE__ */ X("div", {
					className: "flex flex-col items-start gap-3 rounded-lg border border-basic p-4",
					children: [/* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("p", {
						className: "label-medium text-basic-primary",
						children: "Connect GitHub to browse Arcee repositories"
					}), /* @__PURE__ */ Y("p", {
						className: "text-small text-basic-tertiary",
						children: "You can still create a Project through NAC's existing local or SSH flow."
					})] }), /* @__PURE__ */ Y(I, {
						variant: H.Primary,
						content: L.Text,
						onClick: r,
						children: "Connect GitHub"
					})]
				}),
				l.data?.connected && !x ? /* @__PURE__ */ X(J, { children: [
					/* @__PURE__ */ Y(Q, {
						inputSize: Z.Large,
						label: "Find repository",
						"aria-label": "Find repository",
						placeholder: "Search accessible repositories",
						value: u,
						onChange: (e) => d(e.target.value)
					}),
					/* @__PURE__ */ X("div", {
						className: "min-h-[140px] max-h-60 overflow-auto rounded-lg border border-basic p-1",
						children: [
							D.isLoading ? /* @__PURE__ */ Y("div", {
								className: "p-4",
								children: /* @__PURE__ */ Y(f, { size: mt.Small })
							}) : null,
							D.error ? /* @__PURE__ */ Y("p", {
								className: "p-4 text-small text-error-primary",
								children: Ku($(D.error))
							}) : null,
							A.map((e) => /* @__PURE__ */ X("button", {
								type: "button",
								className: `flex w-full items-center gap-3 rounded p-3 text-left ${p?.id === e.id ? "bg-elevation-level-2" : "hover:bg-elevation-level-1"}`,
								onClick: () => {
									m(e), g(e.default_branch), v(e.name), b(e.name), w("");
								},
								children: [
									/* @__PURE__ */ Y(B, { iconName: e.private ? V.Lock : V.Github }),
									/* @__PURE__ */ X("span", {
										className: "min-w-0 flex-1",
										children: [/* @__PURE__ */ Y("span", {
											className: "block label-small text-basic-primary truncate",
											children: e.full_name
										}), /* @__PURE__ */ X("span", {
											className: "block text-small text-basic-tertiary",
											children: ["Default branch: ", e.default_branch]
										})]
									}),
									p?.id === e.id ? /* @__PURE__ */ Y(B, { iconName: V.CheckCircle }) : null
								]
							}, e.id)),
							!D.isLoading && A.length === 0 ? /* @__PURE__ */ Y("p", {
								className: "p-4 text-small text-basic-tertiary",
								children: "No repositories match."
							}) : null
						]
					}),
					p ? /* @__PURE__ */ X("div", {
						className: "grid grid-cols-1 gap-3 sm:grid-cols-2",
						children: [
							/* @__PURE__ */ Y($S, {
								branches: k.data?.branches ?? [],
								value: h,
								onValueChange: g,
								isLoading: k.isLoading,
								error: te
							}, p.full_name),
							/* @__PURE__ */ Y(Q, {
								inputSize: Z.Large,
								label: "Project name",
								"aria-label": "Project name",
								value: y,
								onChange: (e) => b(e.target.value)
							}),
							/* @__PURE__ */ Y(Q, {
								className: "sm:col-span-2",
								inputSize: Z.Large,
								label: "Checkout directory",
								"aria-label": "Checkout directory",
								value: _,
								onChange: (e) => v(e.target.value),
								hintText: `${c.data?.repository_root ?? "Repository root"}/${_ || "directory"}`
							})
						]
					}) : null
				] }) : null,
				x ? /* @__PURE__ */ X("div", {
					className: "flex flex-col gap-4 rounded-lg border border-basic p-4",
					children: [
						/* @__PURE__ */ X("div", {
							className: "flex items-center gap-3",
							children: [x.status === "running" ? /* @__PURE__ */ Y(f, { size: mt.Small }) : /* @__PURE__ */ Y(B, { iconName: x.status === "completed" ? V.CheckCircle : V.Danger }), /* @__PURE__ */ X("div", { children: [/* @__PURE__ */ Y("p", {
								className: "label-medium text-basic-primary capitalize",
								children: x.status
							}), /* @__PURE__ */ X("p", {
								className: "text-small text-basic-tertiary break-all",
								children: [
									x.repository,
									" · ",
									x.branch
								]
							})] })]
						}),
						/* @__PURE__ */ Y("pre", {
							className: "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-elevation-level-2 p-3 code-small text-basic-secondary",
							children: x.progress || "Preparing clone…"
						}),
						x.error ? /* @__PURE__ */ Y("p", {
							className: "text-small text-error-primary",
							children: x.error
						}) : null
					]
				}) : null,
				C ? /* @__PURE__ */ Y("p", {
					className: "text-small text-error-primary",
					children: C
				}) : null
			]
		})
	});
}
// src/app/features/managed/controller/ManagedHostProvider.tsx
function tC({ children: e }) {
	let t = pn(), [n, r] = q(!1), [i, a] = q("status"), [o, s] = q(!1), [c, l] = q(!1), u = t.data ?? null, d = U(() => {
		l(!1), a("status"), r(!0);
	}, []), f = U(() => {
		s(!1), l(!0), a("github"), r(!0);
	}, []), p = U(() => {
		u?.github_status === "connected" ? s(!0) : f();
	}, [f, u?.github_status]), m = U(() => {
		c && (l(!1), r(!1), s(!0));
	}, [c]), h = G(() => ({
		status: u,
		isManaged: u?.managed === !0,
		openSettings: d,
		addRepository: p
	}), [
		p,
		d,
		u
	]);
	return /* @__PURE__ */ X(jm.Provider, {
		value: h,
		children: [
			e,
			/* @__PURE__ */ Y(ZS, {
				open: n,
				tab: i,
				onTabChange: a,
				onClose: () => {
					r(!1), l(!1);
				},
				onGitHubConnected: m
			}),
			o ? /* @__PURE__ */ Y(eC, {
				open: !0,
				onClose: () => s(!1),
				onConnect: f
			}) : null
		]
	});
}
// src/App.tsx
function nC() {
	let { sessionId: e } = Ei();
	return /* @__PURE__ */ X("section", {
		className: "relative flex h-full min-h-0 overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ Y(rh, {}), /* @__PURE__ */ Y(LS, {}, e)]
	});
}
function rC() {
	return fr().orchestrationEnabled ? /* @__PURE__ */ Y(Jh, {}) : /* @__PURE__ */ Y(bi, {
		to: kr.list(),
		replace: !0
	});
}
function iC() {
	return /* @__PURE__ */ Y(ji, { children: /* @__PURE__ */ Y(Jn, { children: /* @__PURE__ */ Y(Op, { children: /* @__PURE__ */ Y(mp, { children: /* @__PURE__ */ Y(tC, { children: /* @__PURE__ */ X(Ci, { children: [
		/* @__PURE__ */ X(Si, {
			element: /* @__PURE__ */ Y(Im, {}),
			children: [
				/* @__PURE__ */ Y(Si, {
					path: "/",
					element: /* @__PURE__ */ Y(hg, {})
				}),
				/* @__PURE__ */ Y(Si, {
					path: "/project/:projectId",
					element: /* @__PURE__ */ Y(Xh, {})
				}),
				/* @__PURE__ */ Y(Si, {
					path: "/session/:sessionId/:panel?",
					element: /* @__PURE__ */ Y(nC, {})
				})
			]
		}),
		/* @__PURE__ */ Y(Si, {
			path: "/design",
			element: /* @__PURE__ */ Y(rC, {})
		}),
		/* @__PURE__ */ Y(Si, {
			path: "*",
			element: /* @__PURE__ */ Y(bi, {
				to: kr.list(),
				replace: !0
			})
		})
	] }) }) }) }) }) });
}
// src/app/providers/ThemeProvider.tsx
var aC = [
	"light",
	"dark",
	"system"
], oC = "nac-theme", sC = "dark", cC = ai(null), lC = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
function uC(e) {
	return sC;
}
function dC() {
	let e = document.documentElement;
	e.setAttribute("data-theme", sC), e.classList.remove("light", "dark"), e.classList.add(sC), e.style.colorScheme = sC;
}
function fC() {
	let e = localStorage.getItem(oC);
	return e && aC.includes(e) ? e : lC() ? "dark" : "light";
}
var pC = ({ children: e, local: t = !1 }) => {
	let [n, r] = q(() => t ? "dark" : fC()), i = U((e) => {
		aC.includes(e) && (r(e), t || (localStorage.setItem(oC, e), dC()));
	}, [t]), a = U(() => {
		r((e) => {
			let n = e === "light" ? "dark" : e === "dark" ? "system" : "light";
			return t || (localStorage.setItem(oC, n), dC()), n;
		});
	}, [t]);
	return W(() => {
		t || dC();
	}, [t]), /* @__PURE__ */ Y(cC.Provider, {
		value: {
			theme: n,
			resolved: uC(n),
			setTheme: i,
			toggleTheme: a
		},
		children: e
	});
};
function mC() {
	let e = ci(cC);
	if (!e) throw Error("useTheme must be used within a ThemeProvider");
	return e;
}
// src/app/runtime/NativePresentationRoot.tsx
function hC(e) {
	return /* @__PURE__ */ Y(gC, { ...e }, e.runtime.id);
}
function gC({ runtime: e, router: t, theme: n, className: r, styles: i, globalKeyboard: a }) {
	if (W(() => e.retain(), [e]), di(e.subscribe, e.isClosed, e.isClosed)) return null;
	let o = /* @__PURE__ */ Y(_C, {
		runtime: e,
		className: r,
		styles: i,
		globalKeyboard: a,
		children: t(/* @__PURE__ */ Y(iC, {}))
	});
	return /* @__PURE__ */ Y(Ge.Provider, {
		value: e,
		children: /* @__PURE__ */ Y(fi, {
			client: e.queryClient,
			children: n ? n(o) : /* @__PURE__ */ Y(pC, {
				local: !0,
				children: o
			})
		})
	});
}
function _C({ runtime: e, className: t, styles: n, globalKeyboard: r, children: i }) {
	let { resolved: a } = mC();
	return /* @__PURE__ */ X("div", {
		className: `${t ?? "nac-presentation h-full min-h-0"} ${a}`,
		style: { contain: "layout paint" },
		"data-nac-runtime": e.id,
		"data-theme": a,
		children: [n, /* @__PURE__ */ Y(s, {
			globalKeyboard: r,
			children: i
		})]
	});
}
export { hC as NativePresentationRoot, rn as NativeRuntime, Ge as RuntimeContext, Tr as createNativeRuntime, n as useNativeRuntime };
